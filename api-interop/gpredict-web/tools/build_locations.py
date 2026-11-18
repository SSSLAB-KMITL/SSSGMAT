"""สร้าง server/gpredict_web/data/locations.json จาก nsd_cccc.txt ของ NOAA (spec งานย่อย 4 §4.3)

    python3 -I tools/build_locations.py <nsd_cccc.txt> <locations.json> [--downloaded 2026-11-14T12:05:35Z]

ไฟล์ที่ดาวน์โหลดมาเป็นข้อมูลภายนอกที่ไม่เชื่อถือ: สคริปต์นี้อ่านเป็นข้อความ latin-1 เท่านั้น ไม่รันอะไรจากมัน (ใช้ `-I` เสมอ)
`downloaded` ตั้งต้นเป็นเวลาแก้ไขของไฟล์ (เวลาที่ curl เขียนเสร็จ) เป็น UTC ส่งค่าอื่นด้วย --downloaded ได้
ขั้นตอนทั้งหมดและที่มาอยู่ใน server/gpredict_web/data/SOURCE.md
"""

import argparse
import hashlib
import json
import os
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "server"))     # `-I` ไม่ใส่โฟลเดอร์ใดให้เอง
from gpredict_web.locations import NSD_URL, parse_nsd                        # noqa: E402

TIME_FORMAT = "%Y-%m-%dT%H:%M:%SZ"


def iso_utc(text: str) -> str:
    try:
        return datetime.strptime(text, TIME_FORMAT).strftime(TIME_FORMAT)
    except ValueError:
        raise argparse.ArgumentTypeError(f"เวลาต้องเป็นแบบ 2026-11-14T12:05:35Z (UTC): {text!r}") from None


def render(downloaded: str, rows: list[list]) -> str:
    """JSON ที่หนึ่งแถวต่อหนึ่งบรรทัด (อ่านและ diff ง่าย) ลำดับ key: source, downloaded, locations"""
    body = ",\n".join(json.dumps(row, ensure_ascii=False, separators=(",", ":")) for row in rows)
    return (f'{{"source":{json.dumps(NSD_URL)},"downloaded":{json.dumps(downloaded)},"locations":[\n{body}\n]}}\n')


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("nsd", type=Path, help="nsd_cccc.txt ที่ดาวน์โหลดจาก NOAA")
    parser.add_argument("out", type=Path, help="locations.json ที่จะเขียน")
    parser.add_argument("--downloaded", type=iso_utc, help="เวลาดาวน์โหลด (UTC) ตั้งต้นคือเวลาแก้ไขของไฟล์")
    args = parser.parse_args(argv)

    try:
        raw = args.nsd.read_bytes()
        mtime = args.nsd.stat().st_mtime
    except OSError as exc:
        parser.exit(1, f"อ่าน {args.nsd} ไม่ได้: {exc}\n")
    downloaded = args.downloaded or datetime.fromtimestamp(mtime, timezone.utc).strftime(TIME_FORMAT)
    rows = parse_nsd(raw.decode("latin-1"))
    if not rows:
        parser.exit(1, f"{args.nsd} ไม่มีสถานีที่ใช้ได้สักแถว ไม่เขียน {args.out}\n")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=args.out.parent, prefix=".locations-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
            f.write(render(downloaded, rows))
        os.chmod(tmp, 0o644)                   # mkstemp ให้ 0600
        os.replace(tmp, args.out)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise
    print(f"wrote {args.out}: {len(rows)} locations; source {args.nsd.name} {len(raw)} bytes "
          f"sha256 {hashlib.sha256(raw).hexdigest()} downloaded {downloaded}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
