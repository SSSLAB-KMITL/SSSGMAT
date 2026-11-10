"""ดาวน์โหลด, เก็บ cache และอ่าน TLE ของดาวเทียม GPS (หัวข้อ 5.2 ของ spec)"""

import os
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .config import CELESTRAK_GPS_URL, TLE_MAX_DAYS, TLE_WARN_DAYS
from .errors import OrbitUnavailableError, TleTooOldError, TleUnavailableError
from .omm import fetch_group, read_omm, to_tle_lines

_PRN_RE = re.compile(r"\(PRN\s*(\d{1,2})\)")


@dataclass(frozen=True)
class TleEntry:
    prn: int
    norad: str
    name: str
    epoch: datetime


def tle_checksum(line: str) -> int:
    """checksum ของ TLE: ผลรวมตัวเลขใน 68 ตัวอักษรแรก นับ '-' เป็น 1 แล้ว mod 10"""
    return sum(int(c) if c.isdigit() else (1 if c == "-" else 0) for c in line[:68]) % 10


def _valid(line: str) -> bool:
    return len(line) >= 69 and line[68].isdigit() and tle_checksum(line) == int(line[68])


def _epoch(line1: str) -> datetime:
    field = line1[18:32]
    yy, doy = int(field[:2]), float(field[2:])
    year = 2000 + yy if yy < 57 else 1900 + yy
    return datetime(year, 1, 1, tzinfo=timezone.utc) + timedelta(days=doy - 1)


def parse_tle_text(text: str) -> tuple[list[TleEntry], list[str]]:
    """อ่าน TLE รูปแบบ 3 บรรทัด คืน (รายการที่ใช้ได้เรียงตาม PRN, คำเตือน)"""
    lines = [l.rstrip() for l in text.replace("\r", "").split("\n")]
    by_prn: dict[int, TleEntry] = {}
    warnings: list[str] = []
    i = 0
    while i < len(lines):
        l1 = lines[i]
        if not (l1.startswith("1 ") and i + 1 < len(lines) and lines[i + 1].startswith("2 ")):
            i += 1
            continue
        l2 = lines[i + 1]
        name = lines[i - 1] if i > 0 and not lines[i - 1].startswith(("1 ", "2 ")) else ""
        norad = l1[2:7].strip()
        i += 2
        if not (_valid(l1) and _valid(l2)):
            warnings.append(f"ข้าม TLE ของ NORAD {norad} ({name}): checksum ไม่ถูกต้อง")
            continue
        m = _PRN_RE.search(name)
        if not m:
            warnings.append(f"ข้าม TLE ของ NORAD {norad} ({name}): ไม่พบเลข PRN ในชื่อ")
            continue
        prn = int(m.group(1))
        if not 1 <= prn <= 32:
            warnings.append(f"ข้าม TLE ของ NORAD {norad} ({name}): PRN {prn} อยู่นอกช่วง 1–32")
            continue
        entry = TleEntry(prn, norad, name, _epoch(l1))
        if prn not in by_prn or entry.epoch > by_prn[prn].epoch:
            by_prn[prn] = entry
    return [by_prn[p] for p in sorted(by_prn)], warnings


def parse_tle_file(path: Path) -> tuple[list[TleEntry], list[str]]:
    return parse_tle_text(Path(path).read_bytes().decode("utf-8", errors="replace"))


def check_tle_age(entries: list[TleEntry], start: datetime, hours: float,
                  warn_days: float = TLE_WARN_DAYS, max_days: float = TLE_MAX_DAYS) -> list[str]:
    """อายุ TLE = ค่ามากสุดของ |t − epoch| เมื่อ t คือเวลาเริ่มหรือสิ้นสุดช่วง คิดจากทุกดวง"""
    end = start + timedelta(hours=hours)
    ages = [max(abs((start - e.epoch).total_seconds()), abs((end - e.epoch).total_seconds())) / 86400.0
            for e in entries]
    if not ages:
        return []
    age = max(ages)
    if age > max_days:
        raise TleTooOldError(f"TLE เก่าเกินไป: อายุสูงสุด {age:.1f} วัน (เกณฑ์ {max_days:g} วัน)")
    if age > warn_days:
        return [f"TLE อายุสูงสุด {age:.1f} วัน เกิน {warn_days:g} วัน ความแม่นยำอาจลดลง"]
    return []


def _write_tle_from_omm(omm_path: Path, tle_path: Path) -> list[str]:
    """แปลง OMM เป็นไฟล์ TLE 3 บรรทัด (บรรทัดชื่อ = OBJECT_NAME) เขียนแบบ atomic คืนคำเตือนของรายการที่ข้าม
    ถ้าไม่มีรายการที่แปลงได้เลยให้ ValueError"""
    blocks: list[str] = []
    warnings: list[str] = []
    for rec in read_omm(omm_path):
        try:
            line1, line2 = to_tle_lines(rec)
        except ValueError as exc:
            warnings.append(f"ข้าม OMM ของ NORAD {rec.norad} ({rec.name}): {exc}")
            continue
        blocks.append(f"{rec.name}\n{line1}\n{line2}\n")
    if not blocks:
        raise ValueError(f"ไม่มี OMM ที่แปลงเป็น TLE ได้ใน {omm_path.name}")
    tmp = tle_path.with_name(tle_path.name + ".tmp")
    tmp.write_bytes("".join(blocks).encode("utf-8"))
    os.replace(tmp, tle_path)
    return warnings


def fetch_gps_tle(cache_dir: Path, url: str = CELESTRAK_GPS_URL, timeout_s: float = 30,
                  now: datetime | None = None) -> tuple[Path, list[str]]:
    """ดึง OMM กลุ่ม gps-ops (omm.fetch_group) แล้วแปลงเป็น cache/gps_<เวลา UTC>.tle ถ้ายังไม่มี

    เลขแคตตาล็อกเกิน 99999 ใช้ Alpha-5 ในช่อง 5 ตัวอักษรของบรรทัด 1 ถ้าดึงหรือแปลงไม่สำเร็จ
    ใช้ gps_*.tle ล่าสุดใน cache พร้อมคำเตือน และถ้าไม่มีเลยจึง TleUnavailableError
    """
    cache_dir = Path(cache_dir)
    cache_dir.mkdir(parents=True, exist_ok=True)
    now = now or datetime.now(timezone.utc)
    warnings: list[str] = []
    try:
        omm_path, messages = fetch_group("gps-ops", cache_dir, cache_dir / "celestrak_state.json", now,
                                         timeout_s=timeout_s, url=url)
        warnings = [m.text for m in messages]
        stamp = omm_path.stem.removeprefix("gps-ops_")
        path = cache_dir / f"gps_{stamp}.tle"
        if not path.exists():
            warnings += _write_tle_from_omm(omm_path, path)
    except (OrbitUnavailableError, ValueError) as exc:   # ValueError: OMM ในไฟล์เสียหรือแปลงไม่ได้
        cached = sorted(cache_dir.glob("gps_*.tle"))
        if not cached:
            raise TleUnavailableError(f"ดาวน์โหลด TLE ไม่สำเร็จ ({exc}) และไม่มีไฟล์ใน {cache_dir}") from exc
        return cached[-1], [f"ดาวน์โหลด TLE ไม่สำเร็จ ({exc}) ใช้ไฟล์ใน cache แทน: {cached[-1].name}"]
    return path, warnings
