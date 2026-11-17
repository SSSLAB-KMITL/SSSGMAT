"""python3 -m gnss_predict: พยากรณ์การมองเห็นดาวเทียม GPS จาก THBK (หัวข้อ 5.7 ของ spec)

exit code: 0 สำเร็จ, 1 ข้อผิดพลาดที่คาดไว้ (TLE, GMAT, รายงาน), 2 ใส่ตัวเลือกผิด
"""

import argparse
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

from .config import DEFAULT_CACHE_DIR, DEFAULT_OUT_DIR, OMM_CACHE_DIR, SHELL_KM, STEP_S
from .errors import GnssPredictError, TleUnavailableError
from .predict import build_meta, output_name, parse_start, predict_samples, rows_from_samples, write_outputs
from .run_gmat import find_gmat_console, gmat_version
from .tle_fetch import check_tle_age, fetch_gps_tle, parse_tle_file


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="python3 -m gnss_predict",
                                description="พยากรณ์ Az, El, IPP และ MF ของดาวเทียม GPS ที่มองเห็นได้จากสถานี THBK")
    p.add_argument("--start", help="เวลาเริ่ม (UTC) เช่น 2026-11-11 หรือ 2026-11-11T06:30Z "
                                   "ค่าเริ่มต้นคือ 00:00 UTC ของวันถัดไป")
    p.add_argument("--hours", type=float, default=24.0, help="ความยาวช่วงพยากรณ์ (ชั่วโมง)")
    p.add_argument("--step", type=int, default=STEP_S, help="ระยะห่างของ epoch (วินาที)")
    p.add_argument("--min-el", type=float, default=0.0, help="ส่งออกเฉพาะแถวที่ El ≥ ค่านี้ (องศา)")
    p.add_argument("--shell-km", type=float, default=SHELL_KM, help="ความสูงของ shell ไอโอโนสเฟียร์ (กม.)")
    p.add_argument("--tle-file", type=Path, help="ใช้ไฟล์ TLE นี้แทนการดาวน์โหลด")
    p.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE_DIR,
                   help="ที่เก็บ TLE ที่แปลงจาก OMM (OMM และเวลาที่ส่งคำขอเก็บร่วมกับ studio ใน data/orbits/_cache/)")
    p.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR, help="ที่เก็บผลลัพธ์")
    p.add_argument("--keep-work", action="store_true", help="เก็บ script, รายงาน และ log ของ GMAT ไว้")
    return p


def _run(args: argparse.Namespace, start: datetime, now: datetime) -> int:
    warnings: list[str] = []
    if args.tle_file:
        tle_path = args.tle_file.resolve()
        if not tle_path.is_file():
            raise TleUnavailableError(f"ไม่พบไฟล์ TLE: {tle_path}")
    else:
        tle_path, w = fetch_gps_tle(args.cache_dir.resolve(), now=now, omm_cache_dir=OMM_CACHE_DIR)
        warnings += w
    entries, w = parse_tle_file(tle_path)
    warnings += w
    if not entries:
        raise TleUnavailableError(f"ไม่มี TLE ที่ใช้ได้ใน {tle_path}")
    warnings += check_tle_age(entries, start, args.hours)
    console = find_gmat_console()

    out_dir = args.out_dir.resolve()
    work_dir = out_dir / f"work-{now:%Y%m%dT%H%M%S}Z"
    try:
        samples = predict_samples(entries, tle_path, start, args.hours, args.step, work_dir, console)
    except GnssPredictError:
        print(f"เก็บไฟล์ของ GMAT ไว้ตรวจที่ {work_dir}", file=sys.stderr)
        raise
    rows = rows_from_samples(samples, args.min_el, args.shell_km)
    meta = build_meta(start, args.hours, args.step, args.min_el, args.shell_km, tle_path, entries,
                      warnings, gmat_version(console), datetime.now(timezone.utc))
    path = write_outputs(rows, meta, out_dir, output_name(start, args.hours))
    if not args.keep_work:
        shutil.rmtree(work_dir, ignore_errors=True)
    print(path)
    for w in warnings:
        print(f"คำเตือน: {w}", file=sys.stderr)
    return 0


def main(argv: list[str] | None = None, now: datetime | None = None) -> int:
    parser = _parser()
    args = parser.parse_args(argv)
    now = now or datetime.now(timezone.utc)
    try:
        start = parse_start(args.start, now)
    except ValueError as exc:
        parser.error(f"--start ไม่ถูกต้อง: {exc}")
    if args.hours <= 0 or args.step <= 0:
        parser.error("--hours และ --step ต้องมากกว่า 0")
    try:
        return _run(args, start, now)
    except GnssPredictError as exc:
        print(f"ผิดพลาด: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
