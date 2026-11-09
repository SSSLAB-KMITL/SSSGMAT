"""ตรวจความแม่นยำของการพยากรณ์เทียบกับวงโคจร SP3 ของ IGS (หัวข้อ 5.9 และ 11.4 ของ spec)

python3 -m gnss_predict.validate --tle-file PATH (--day YYYY-MM-DD | --sp3 PATH)
                                 [--min-el 10] [--cache-dir DIR] [--out-dir DIR]
"""

import argparse
import json
import shutil
import statistics
import sys
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from .config import (AZ_EL_LIMIT, AZ_MEDIAN_MAX, AZ_P99_MAX, DEFAULT_CACHE_DIR, DEFAULT_OUT_DIR, EL_MEDIAN_MAX,
                     EL_P99_MAX, GPS_UTC_OFFSET_S, STEP_S, THBK_ECEF_M, THBK_LAT_DEG, THBK_LON_DEG,
                     VALIDATION_MAX_TLE_AGE_DAYS, VALIDATION_MIN_EL)
from .errors import GnssPredictError, TleUnavailableError
from .geometry import ecef_to_az_el, sez_to_az_el
from .predict import predict_samples
from .report import SezSample
from .run_gmat import find_gmat_console
from .script_gen import sat_name
from .sp3 import Sp3Orbit, fetch_sp3, interpolate, prns_with_data, read_sp3
from .tle_fetch import check_tle_age, parse_tle_file

STA_KM = tuple(c / 1000.0 for c in THBK_ECEF_M)


@dataclass(frozen=True)
class Pair:
    prn: int
    t: datetime
    az_pred: float
    el_pred: float
    az_ref: float
    el_ref: float


def reference_az_el(orbit: Sp3Orbit, prn: int, t_utc: datetime) -> tuple[float, float] | None:
    """Az/El จาก SP3 ที่เวลา t (UTC) โดยแปลงเป็น GPST ด้วยการบวก GPS_UTC_OFFSET_S"""
    pos = interpolate(orbit, prn, t_utc + timedelta(seconds=GPS_UTC_OFFSET_S))
    if pos is None:
        return None
    return ecef_to_az_el(pos, STA_KM, THBK_LAT_DEG, THBK_LON_DEG)


def make_pairs(samples: list[SezSample], orbit: Sp3Orbit, min_el: float) -> list[Pair]:
    pairs = []
    for s in samples:
        ref = reference_az_el(orbit, s.prn, s.t)
        if ref is None or ref[1] < min_el:
            continue
        az, el = sez_to_az_el(s.s_km, s.e_km, s.z_km)
        pairs.append(Pair(s.prn, s.t, az, el, ref[0], ref[1]))
    return pairs


def az_diff(a: float, b: float) -> float:
    return ((a - b + 180.0) % 360.0) - 180.0


def _median(v: list[float]) -> float | None:
    return statistics.median(v) if v else None


def _p99(v: list[float]) -> float | None:
    return statistics.quantiles(v, n=100, method="inclusive")[98] if len(v) >= 2 else None


def summarize(pairs: list[Pair], prns_pred: set[int], prns_sp3: set[int]) -> dict:
    d_el = [abs(p.el_pred - p.el_ref) for p in pairs]
    d_az = [abs(az_diff(p.az_pred, p.az_ref)) for p in pairs if p.el_ref < AZ_EL_LIMIT]
    stats = {"el_median": _median(d_el), "el_p99": _p99(d_el), "az_median": _median(d_az), "az_p99": _p99(d_az)}
    limits = {"el_median": (EL_MEDIAN_MAX, d_el), "el_p99": (EL_P99_MAX, d_el),
              "az_median": (AZ_MEDIAN_MAX, d_az), "az_p99": (AZ_P99_MAX, d_az)}
    failed = [k for k, (lim, v) in limits.items() if len(v) < 2 or stats[k] > lim]
    not_in_sp3 = sorted(prns_pred - prns_sp3)
    if not_in_sp3:
        failed.append("prns_not_in_sp3")
    groups: dict[int, list[Pair]] = defaultdict(list)
    for p in pairs:
        groups[p.prn].append(p)
    per_prn = {}
    for prn in sorted(groups):
        g = groups[prn]
        de = [abs(p.el_pred - p.el_ref) for p in g]
        da = [abs(az_diff(p.az_pred, p.az_ref)) for p in g if p.el_ref < AZ_EL_LIMIT]
        per_prn[prn] = {"n": len(g), "el_median": _median(de), "el_max": max(de), "az_median": _median(da)}
    return {"n": len(pairs), **{k: stats[k] for k in ("el_median", "el_p99")}, "az_n": len(d_az),
            **{k: stats[k] for k in ("az_median", "az_p99")},
            "prns_not_in_sp3": not_in_sp3, "prns_not_predicted": sorted(prns_sp3 - prns_pred),
            "per_prn": per_prn, "failed_checks": failed, "passed": not failed}


def _fmt(x: float | None, digits: int = 4) -> str:
    return "-" if x is None else f"{x:.{digits}f}"


def _markdown(day: date, s: dict, info: dict) -> str:
    verdict = "ผ่าน" if s["passed"] else "ไม่ผ่าน (" + ", ".join(s["failed_checks"]) + ")"
    lines = [f"# ผลตรวจความแม่นยำ {day}", "", f"ผล: **{verdict}**", "",
             f"- TLE: `{info['tle_file']}`", f"- SP3: `{info['sp3_file']}`",
             f"- จำนวนคู่ที่เทียบ (El อ้างอิง ≥ {info['min_el']}°): {s['n']} (Az: {s['az_n']} คู่ที่ El < {AZ_EL_LIMIT}°)", "",
             "| ค่า | ได้ | เกณฑ์ |", "|---|---|---|",
             f"| ค่ากลาง \\|ΔEl\\| (°) | {_fmt(s['el_median'])} | ≤ {EL_MEDIAN_MAX} |",
             f"| P99 \\|ΔEl\\| (°) | {_fmt(s['el_p99'])} | ≤ {EL_P99_MAX} |",
             f"| ค่ากลาง \\|ΔAz\\| (°) | {_fmt(s['az_median'])} | ≤ {AZ_MEDIAN_MAX} |",
             f"| P99 \\|ΔAz\\| (°) | {_fmt(s['az_p99'])} | ≤ {AZ_P99_MAX} |",
             f"| PRN ที่พยากรณ์แต่ไม่มีใน SP3 | {s['prns_not_in_sp3'] or '-'} | ต้องไม่มี |",
             f"| PRN ใน SP3 ที่ไม่ได้พยากรณ์ | {s['prns_not_predicted'] or '-'} | รายงานเท่านั้น |", "",
             "| PRN | คู่ | ค่ากลาง \\|ΔEl\\| | สูงสุด \\|ΔEl\\| | ค่ากลาง \\|ΔAz\\| |", "|---|---|---|---|---|"]
    for prn, r in s["per_prn"].items():
        lines.append(f"| {sat_name(prn)} | {r['n']} | {_fmt(r['el_median'])} | {_fmt(r['el_max'])} | {_fmt(r['az_median'])} |")
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="python3 -m gnss_predict.validate",
                                description="เทียบ Az/El ที่พยากรณ์ด้วย GMAT กับค่าที่คำนวณจากวงโคจร SP3 ของ IGS")
    p.add_argument("--tle-file", type=Path, required=True)
    src = p.add_mutually_exclusive_group(required=True)
    src.add_argument("--day", type=date.fromisoformat, help="วันที่ตรวจ (ดาวน์โหลด SP3 จาก CDDIS)")
    src.add_argument("--sp3", type=Path, help="ใช้ไฟล์ SP3 นี้ (.SP3 หรือ .SP3.gz)")
    p.add_argument("--min-el", type=float, default=VALIDATION_MIN_EL)
    p.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE_DIR)
    p.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
    args = p.parse_args(argv)
    try:
        tle_path = args.tle_file.resolve()
        entries, _ = parse_tle_file(tle_path)
        if not entries:
            raise TleUnavailableError(f"ไม่มี TLE ที่ใช้ได้ใน {tle_path}")
        sp3_path = args.sp3.resolve() if args.sp3 else fetch_sp3(args.day, args.cache_dir.resolve())
        orbit = read_sp3(sp3_path)
        day = args.day or orbit.epochs[0].date()
        start = datetime(day.year, day.month, day.day, tzinfo=timezone.utc)
        check_tle_age(entries, start, 24, VALIDATION_MAX_TLE_AGE_DAYS, VALIDATION_MAX_TLE_AGE_DAYS)
        console = find_gmat_console()
        out_dir = args.out_dir.resolve()
        work_dir = out_dir / f"validate-work-{day}"
        samples = predict_samples(entries, tle_path, start, 24, STEP_S, work_dir, console)
        pairs = make_pairs(samples, orbit, args.min_el)
        summary = summarize(pairs, {e.prn for e in entries}, prns_with_data(orbit))
    except GnssPredictError as exc:
        print(f"ผิดพลาด: {exc}", file=sys.stderr)
        return 1
    info = {"day": str(day), "tle_file": str(tle_path), "sp3_file": str(sp3_path), "min_el": args.min_el}
    (out_dir / f"validation_{day}.json").write_text(
        json.dumps({**info, **summary}, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (out_dir / f"validation_{day}.md").write_text(_markdown(day, summary, info), encoding="utf-8")
    shutil.rmtree(work_dir, ignore_errors=True)
    print(f"{'ผ่าน' if summary['passed'] else 'ไม่ผ่าน'}: {summary['n']} คู่, "
          f"ΔEl ค่ากลาง {_fmt(summary['el_median'])}° P99 {_fmt(summary['el_p99'])}°, "
          f"ΔAz ค่ากลาง {_fmt(summary['az_median'])}° P99 {_fmt(summary['az_p99'])}°")
    if summary["failed_checks"]:
        print("ไม่ผ่าน: " + ", ".join(summary["failed_checks"]), file=sys.stderr)
    print(out_dir / f"validation_{day}.md")
    return 0 if summary["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
