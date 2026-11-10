#!/usr/bin/env python3
"""ตัดย่อไฟล์ที่ดาวน์โหลดมาให้เป็น fixture ของ GNSS Studio engine (กฎการตัดอยู่ใน SOURCES.md)

รันแบบ python3 -I เพราะไฟล์ต้นทางเป็นข้อมูลที่ดาวน์โหลดมา ใช้อ่านเป็นข้อมูลเท่านั้น
ไม่ดาวน์โหลดอะไรเอง ถ้าไฟล์ต้นทางหายให้ดาวน์โหลดใหม่ตามขั้นตอนใน SOURCES.md
"""

import argparse
import gzip
import json
import sys
from pathlib import Path

OMM_IDS = (62339, 26407, 37846, 40129, 43508, 56564, 44542, 41434, 36828, 100744)
TLE_IDS = OMM_IDS[:9]     # 100744 เป็นเลข 6 หลัก จึงไม่มี TLE
SNAPSHOT_GROUPS = {
    "gps-ops": (62339, 26407),
    "glo-ops": (43508, 100744),
    "galileo": (37846, 40129),
    "beidou": (56564, 44542, 41434, 36828),
}
META_SVNS = ("G080", "G044", "E101", "E202", "R856", "R809", "C231", "C222", "C017", "C005")
META_SECTIONS = ("SATELLITE/IDENTIFIER", "SATELLITE/PRN")
BRDC_ALL = ("G01", "R05", "R13", "C01", "C09", "C19", "C38", "C40")
BRDC_LIMITED = ("E11", "E14")
BRDC_LIMIT_EPOCH = (2026, 11, 9, 4, 0, 0)
BRDC_RECORD_LINES = {"R": 4, "S": 4}      # ระบบอื่นทั้งหมดมี 8 บรรทัดต่อ record
SP3_SATS = ("C19", "C38", "E11", "G01", "R05")
SP3_LAST_EPOCH = (2026, 11, 9, 3, 0, 0)


def _read_text(path: Path) -> str:
    opener = gzip.open if path.name.endswith(".gz") else open
    with opener(path, "rb") as f:
        return f.read().decode("utf-8")


def _write(path: Path, text: str, newline: str = "\n") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline=newline) as f:
        f.write(text)


def _json_text(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, indent=2) + "\n"


def extract_omm(src: Path, out: Path) -> None:
    by_id = {int(o["NORAD_CAT_ID"]): o for o in json.loads(_read_text(src))}
    missing = [n for n in OMM_IDS if n not in by_id]
    if missing:
        raise SystemExit(f"ไม่พบ NORAD {missing} ใน {src}")
    _write(out / "omm_sample.json", _json_text([by_id[n] for n in OMM_IDS]))
    for group, ids in SNAPSHOT_GROUPS.items():
        _write(out / "snapshot" / f"{group}.json", _json_text([by_id[n] for n in ids]))


def extract_tle(tle_dir: Path, out: Path) -> None:
    found: dict[int, str] = {}
    for path in sorted(tle_dir.glob("*.tle")):
        lines = _read_text(path).splitlines(keepends=True)     # คง CRLF เดิม
        for i, line in enumerate(lines):
            if i > 0 and line.startswith("1 ") and i + 1 < len(lines) and lines[i + 1].startswith("2 "):
                found.setdefault(int(line[2:7]), lines[i - 1] + line + lines[i + 1])
    missing = [n for n in TLE_IDS if n not in found]
    if missing:
        raise SystemExit(f"ไม่พบ NORAD {missing} ใน {tle_dir}")
    _write(out / "tle_sample.tle", "".join(found[n] for n in TLE_IDS), newline="")


def extract_meta(src: Path, out: Path) -> None:
    lines = _read_text(src).split("\n")
    kept = [lines[0]]
    for section in META_SECTIONS:
        start = next(i for i, l in enumerate(lines) if l.rstrip() == f"+{section}")
        end = next(i for i in range(start, len(lines)) if lines[i].rstrip() == f"-{section}")
        for line in lines[start:end + 1]:
            if line[:1] in ("+", "-", "*") or line[1:5] in META_SVNS:
                kept.append(line)
    _write(out / "snapshot" / "igs_satellite_metadata.snx", "\n".join(kept) + "\n")


def _nav_records(lines: list[str], first: int) -> list[list[str]]:
    """แยก record ของ RINEX 3 nav: บรรทัดแรกขึ้นต้นด้วยรหัสดาว บรรทัดต่อขึ้นต้นด้วยช่องว่าง"""
    records: list[list[str]] = []
    for line in lines[first:]:
        if not line.strip():
            continue
        if line[0] != " ":
            records.append([line])
        else:
            records[-1].append(line)
    for rec in records:
        want = BRDC_RECORD_LINES.get(rec[0][0], 8)
        if len(rec) != want:
            raise SystemExit(f"record {rec[0][:23]} มี {len(rec)} บรรทัด ควรเป็น {want}")
    return records


def extract_nav(src: Path, out: Path) -> None:
    lines = _read_text(src).split("\n")
    end_header = next(i for i, l in enumerate(lines) if "END OF HEADER" in l)
    kept = lines[:end_header + 1]
    for rec in _nav_records(lines, end_header + 1):
        sat = rec[0][:3]
        epoch = tuple(int(x) for x in rec[0][4:23].split())
        if sat in BRDC_ALL or (sat in BRDC_LIMITED and epoch <= BRDC_LIMIT_EPOCH):
            kept.extend(rec)
    _write(out / "snapshot" / "brdc" / "BRDC00IGS_R_20263130000_01D_MN.rnx", "\n".join(kept) + "\n")


def extract_sp3(src: Path, out: Path) -> None:
    lines = _read_text(src).split("\n")
    first_epoch = next(i for i, l in enumerate(lines) if l.startswith("*"))
    kept = lines[:first_epoch]
    keep_epoch = False
    for line in lines[first_epoch:]:
        if line.startswith("*"):
            keep_epoch = tuple(int(float(x)) for x in line[1:].split()) <= SP3_LAST_EPOCH
            if keep_epoch:
                kept.append(line)
        elif keep_epoch and line.startswith("P") and line[1:4] in SP3_SATS:
            kept.append(line)
    kept.append(next(l for l in lines if l.startswith("EOF")))
    _write(out / "mgx_sample.sp3", "\n".join(kept) + "\n")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--omm", type=Path, required=True, help="gnss.json (OMM ของ CelesTrak ทั้งกลุ่ม gnss)")
    ap.add_argument("--tle-dir", type=Path, required=True, help="โฟลเดอร์ที่มี gps-ops.tle, glo-ops.tle, galileo.tle, beidou.tle")
    ap.add_argument("--meta", type=Path, required=True, help="igs_satellite_metadata.snx")
    ap.add_argument("--nav", type=Path, required=True, help="BRDC00IGS_R_*_MN.rnx.gz")
    ap.add_argument("--sp3", type=Path, required=True, help="GFZ0MGXRAP_*_ORB.SP3.gz")
    ap.add_argument("--out", type=Path, required=True, help="โฟลเดอร์ปลายทาง (tests/fixtures/studio)")
    a = ap.parse_args(argv)
    extract_omm(a.omm, a.out)
    extract_tle(a.tle_dir, a.out)
    extract_meta(a.meta, a.out)
    extract_nav(a.nav, a.out)
    extract_sp3(a.sp3, a.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
