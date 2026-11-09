"""ลำดับการพยากรณ์และการเขียนผลลัพธ์ (หัวข้อ 5.7 และ 7 ของ spec)"""

import csv
import hashlib
import json
import os
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .config import THBK_HEIGHT_M, THBK_LAT_DEG, THBK_LON_DEG
from .geometry import ipp, mapping_factor, sez_to_az_el
from .report import SezSample, check_epochs, read_report
from .run_gmat import run_script
from .script_gen import render_script, sat_name
from .tle_fetch import TleEntry

HEADER = ["DAY", "Time", "PRN", "Az", "El", "IPP_Lat", "IPP_Lon", "MF"]
_DATE_ONLY = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _iso_z(t: datetime) -> str:
    return f"{t.astimezone(timezone.utc):%Y-%m-%dT%H:%M:%S}Z"


def parse_start(text: str | None, now: datetime) -> datetime:
    """ไม่ระบุ = 00:00 UTC ของวันถัดไป, ใส่แค่วันที่ = 00:00 UTC, ไม่มี timezone = UTC"""
    if text is None:
        day = now.astimezone(timezone.utc).date() + timedelta(days=1)
        return datetime(day.year, day.month, day.day, tzinfo=timezone.utc)
    text = text.strip()
    if _DATE_ONLY.match(text):
        return datetime.fromisoformat(text).replace(tzinfo=timezone.utc)
    t = datetime.fromisoformat(text[:-1] + "+00:00" if text.endswith(("Z", "z")) else text)
    return t.replace(tzinfo=timezone.utc) if t.tzinfo is None else t.astimezone(timezone.utc)


def output_name(start: datetime, hours: float) -> str:
    return f"thbk_gnss_pred_{start:%Y%m%dT%H%M}Z_{hours:g}h.csv"


def rows_from_samples(samples: list[SezSample], min_el: float, shell_km: float) -> list[list[str]]:
    rows = []
    for s in samples:
        az, el = sez_to_az_el(s.s_km, s.e_km, s.z_km)
        if el < min_el:
            continue
        lat, lon = ipp(THBK_LAT_DEG, THBK_LON_DEG, az, el, shell_km=shell_km)
        t = s.t.astimezone(timezone.utc)
        az_out = round(az, 3) % 360.0          # 359.9997 ปัดแล้วได้ 360.000 ต้องวนกลับเป็น 0.000
        rows.append([f"{t:%Y-%m-%d}", f"{t:%H:%M:%S}", sat_name(s.prn), f"{az_out:.3f}", f"{el:.3f}",
                     f"{lat:.4f}", f"{lon:.4f}", f"{mapping_factor(el, shell_km=shell_km):.5f}"])
    rows.sort(key=lambda r: (r[0], r[1], r[2]))
    return rows


def build_meta(start: datetime, hours: float, step_s: int, min_el: float, shell_km: float, tle_path: Path,
               entries: list[TleEntry], warnings: list[str], gmat_version: str, now: datetime) -> dict:
    included = sorted(e.prn for e in entries)
    epochs = [e.epoch for e in entries]
    return {
        "start_utc": _iso_z(start),
        "hours": hours,
        "step_s": step_s,
        "min_el": min_el,
        "shell_km": shell_km,
        "station": {"lat_deg": THBK_LAT_DEG, "lon_deg": THBK_LON_DEG, "height_m": THBK_HEIGHT_M},
        "tle_file": str(tle_path),
        "tle_sha256": hashlib.sha256(Path(tle_path).read_bytes()).hexdigest(),
        "tle_epoch_min": _iso_z(min(epochs)) if epochs else None,
        "tle_epoch_max": _iso_z(max(epochs)) if epochs else None,
        "prns_included": included,
        "prns_missing": [p for p in range(1, 33) if p not in included],
        "warnings": list(warnings),
        "gmat_version": gmat_version,
        "generated_at_utc": _iso_z(now),
    }


def _replace_atomic(path: Path, write) -> None:
    tmp = path.with_name(path.name + ".tmp")
    with open(tmp, "w", encoding="utf-8", newline="") as f:
        write(f)
    os.replace(tmp, path)


def write_outputs(rows: list[list[str]], meta: dict, out_dir: Path, name: str) -> Path:
    """เขียน CSV และ <ชื่อ>.meta.json ผ่านไฟล์ .tmp แล้วค่อย rename เพื่อไม่ให้ผู้อ่านเห็นไฟล์ที่เขียนไม่เสร็จ"""
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / name

    def write_csv(f):
        w = csv.writer(f, lineterminator="\n")
        w.writerow(HEADER)
        w.writerows(rows)

    _replace_atomic(path, write_csv)
    _replace_atomic(path.with_name(Path(name).stem + ".meta.json"),
                    lambda f: (json.dump(meta, f, indent=2, ensure_ascii=False), f.write("\n")))
    return path


def predict_samples(entries: list[TleEntry], tle_path: Path, start: datetime, hours: float, step_s: int,
                    work_dir: Path, console: Path) -> list[SezSample]:
    """สร้าง script, รัน GMAT, อ่านรายงาน และตรวจ epoch คืนตำแหน่ง SEZ ของทุกดวงทุก epoch"""
    work_dir = Path(work_dir).resolve()
    work_dir.mkdir(parents=True, exist_ok=True)
    script = work_dir / "visibility.script"
    script.write_text(render_script(entries, Path(tle_path).resolve(), start, hours, step_s, work_dir))
    run_script(console, script, work_dir / "gmat.log")
    samples = read_report(work_dir, [e.prn for e in entries])
    check_epochs(samples, start, hours, step_s)
    return samples
