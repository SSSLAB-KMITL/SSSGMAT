"""อ่าน IGS satellite metadata (SINEX) แล้วจับคู่ NORAD -> PRN/SVN/Block ตามเวลา (หัวข้อ 5.3 ของ spec engine)

อ่านเฉพาะสองส่วนของไฟล์:
- SATELLITE/IDENTIFIER: `SVN COSPAR SatCat Block Comment...`
- SATELLITE/PRN:        `SVN valid_from valid_to PRN comment...` เวลาเป็น `YYYY:DOY:SSSSS` (UTC)
ส่วนอื่น (SATELLITE/PLANE, SATELLITE/FREQUENCY_CHANNEL, ...) ก็ขึ้นต้นบรรทัดด้วย SVN จึงต้องไม่อ่าน
แถวที่อ่านไม่ได้ (SatCat ไม่ใช่ตัวเลข, เวลาหรือ PRN ผิดรูปแบบ) ถูกข้าม
"""

import os
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from http.client import HTTPException
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .config import IGS_META_MAX_AGE_S, IGS_META_URL
from .errors import IgsMetadataUnavailableError, Message

_UTC = timezone.utc
_TIME_RE = re.compile(r"^(\d{4}):(\d{3}):(\d{5})$")
_PRN_RE = re.compile(r"^[A-Z]\d{2}$")
_FILE_RE = re.compile(r"^igs_satellite_metadata_(\d{8}T\d{4}Z)\.snx$")
_FILE_TIME_FMT = "%Y%m%dT%H%MZ"
_IDENTIFIER = "SATELLITE/IDENTIFIER"
_PRN = "SATELLITE/PRN"


@dataclass(frozen=True)
class SatIdentity:
    prn: str
    svn: str
    norad: int
    cospar: str
    block: str


@dataclass(frozen=True)
class _PrnPeriod:
    start: datetime
    stop: datetime | None      # None = ไม่มีวันสิ้นสุด (0000:000:00000), ช่วงใช้งานคือ start <= t < stop
    prn: str


class IgsMetadata:
    def __init__(self, satellites: dict[int, tuple[str, str, str]], periods: dict[str, list[_PrnPeriod]]):
        """satellites: NORAD -> (svn, cospar, block), periods: svn -> ช่วงใช้ PRN เรียงตามเวลาเริ่ม"""
        self._satellites = satellites
        self._periods = {svn: sorted(rows, key=lambda p: p.start) for svn, rows in periods.items()}

    def _prn_at(self, svn: str, t: datetime) -> str | None:
        # ช่วงทับกันไม่มีในไฟล์จริง ถ้ามีเอาช่วงที่เริ่มทีหลัง
        for p in reversed(self._periods.get(svn, [])):
            if p.start <= t and (p.stop is None or t < p.stop):
                return p.prn
        return None

    def identity_at(self, norad: int, t: datetime) -> SatIdentity | None:
        """ตัวตนของดาว NORAD ณ เวลา t คืน None ถ้าไม่รู้จัก NORAD นี้หรือ ณ เวลานั้นไม่มี PRN"""
        sat = self._satellites.get(norad)
        if sat is None:
            return None
        svn, cospar, block = sat
        prn = self._prn_at(svn, t)
        return None if prn is None else SatIdentity(prn, svn, norad, cospar, block)

    def prn_changes(self, norad: int, start: datetime, stop: datetime) -> list[tuple[datetime, str | None]]:
        """ทุกจุดใน (start, stop] ที่ PRN เปลี่ยน คู่ (เวลา, PRN ใหม่) PRN ใหม่เป็น None เมื่อกลายเป็นไม่มี PRN
        การเปลี่ยนที่ start พอดีถือเป็นสถานะตอนเริ่ม จึงไม่นับ"""
        sat = self._satellites.get(norad)
        if sat is None:
            return []
        svn = sat[0]
        edges = sorted({edge for p in self._periods.get(svn, []) for edge in (p.start, p.stop)
                        if edge is not None and start < edge <= stop})
        changes, previous = [], self._prn_at(svn, start)
        for edge in edges:
            current = self._prn_at(svn, edge)
            if current != previous:
                changes.append((edge, current))
                previous = current
        return changes


def _parse_time(text: str) -> datetime | None:
    """`YYYY:DOY:SSSSS` -> UTC, `0000:000:00000` -> None (ไม่มีวันสิ้นสุด) รูปแบบผิดให้ ValueError"""
    m = _TIME_RE.match(text)
    if not m:
        raise ValueError(f"เวลา {text!r} ไม่ใช่รูปแบบ YYYY:DOY:SSSSS")
    year, doy, sec = (int(g) for g in m.groups())
    if (year, doy, sec) == (0, 0, 0):
        return None
    if not 1 <= doy <= 366:
        raise ValueError(f"วันของปีผิด: {text!r}")
    return datetime(year, 1, 1, tzinfo=_UTC) + timedelta(days=doy - 1, seconds=sec)


def _parse(text: str) -> IgsMetadata:
    satellites: dict[int, tuple[str, str, str]] = {}
    periods: dict[str, list[_PrnPeriod]] = {}
    section = None
    for line in text.replace("\r", "").split("\n"):
        if line.startswith("+"):
            section = line[1:].strip()
            continue
        if line.startswith("-"):
            section = None
            continue
        if section not in (_IDENTIFIER, _PRN) or line.startswith("*"):
            continue
        parts = line.split()
        if section == _IDENTIFIER:
            if len(parts) >= 4 and parts[2].isdigit():
                satellites[int(parts[2])] = (parts[0], parts[1], parts[3])
        elif len(parts) >= 4 and _PRN_RE.match(parts[3]):
            try:
                start, stop = _parse_time(parts[1]), _parse_time(parts[2])
            except ValueError:
                continue
            if start is not None:
                periods.setdefault(parts[0], []).append(_PrnPeriod(start, stop, parts[3]))
    if not satellites or not periods:
        raise ValueError("ไม่พบส่วน SATELLITE/IDENTIFIER และ SATELLITE/PRN ที่มีข้อมูลในไฟล์ IGS metadata")
    return IgsMetadata(satellites, periods)


def read_metadata(path: Path) -> IgsMetadata:
    """อ่านไฟล์ IGS metadata ถ้าไม่พบข้อมูลของสองส่วนข้างต้นให้ ValueError"""
    return _parse(Path(path).read_bytes().decode("utf-8", errors="replace"))


def _write_atomic(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_bytes(data)
    os.replace(tmp, path)


def _latest_cached(dest_dir: Path) -> tuple[Path, datetime] | None:
    """ไฟล์ igs_satellite_metadata_<YYYYMMDDTHHMMZ>.snx ที่ใหม่ที่สุด พร้อมเวลาดาวน์โหลดจากชื่อไฟล์"""
    found = []
    for path in dest_dir.glob("igs_satellite_metadata_*.snx"):
        m = _FILE_RE.match(path.name)
        if m:
            try:
                found.append((datetime.strptime(m.group(1), _FILE_TIME_FMT).replace(tzinfo=_UTC), path))
            except ValueError:
                continue
    if not found:
        return None
    fetched, path = max(found)
    return path, fetched


def fetch_metadata(dest_dir: Path, now: datetime, opener=urlopen,
                   timeout_s: float = 60) -> tuple[Path, list[Message]]:
    """คืน (ไฟล์ IGS metadata ล่าสุด, ข้อความ) ไฟล์ที่ดาวน์โหลดเก็บเป็น <dest_dir>/igs_satellite_metadata_<YYYYMMDDTHHMMZ>.snx

    - ไฟล์ล่าสุดอายุไม่เกิน IGS_META_MAX_AGE_S (นับจากเวลาในชื่อไฟล์): ไม่ส่ง request
    - ไม่มีไฟล์หรือไฟล์เก่ากว่านั้น: ส่ง request หนึ่งครั้ง ไม่ลองซ้ำ เนื้อหาต้องอ่านเป็น IGS metadata ได้ก่อนเก็บ
    - ดึงไม่สำเร็จ (HTTP error, ต่อเน็ตไม่ได้, อ่านไม่จบ, เนื้อหาใช้ไม่ได้): ใช้ไฟล์เดิม + IGS_META_STALE (warning)
    - ดึงไม่สำเร็จและไม่มีไฟล์เดิม: IgsMetadataUnavailableError
    """
    dest_dir = Path(dest_dir)
    now = now.astimezone(_UTC)
    cached = _latest_cached(dest_dir)
    if cached is not None and (now - cached[1]).total_seconds() <= IGS_META_MAX_AGE_S:
        return cached[0], []

    request = Request(IGS_META_URL, headers={"User-Agent": "gnss-predict/0.2"})
    try:
        with opener(request, timeout=timeout_s) as resp:
            data = resp.read()
        _parse(data.decode("utf-8", errors="replace"))
    except HTTPError as exc:
        reason = f"HTTP {exc.code}"
    except HTTPException as exc:           # อ่านคำตอบไม่จบ (IncompleteRead) ไม่ใช่ OSError
        reason = f"อ่านคำตอบไม่จบ: {exc}"
    except ValueError as exc:              # เนื้อหาไม่ใช่ IGS metadata
        reason = f"คำตอบไม่ใช่ IGS metadata: {exc}"
    except URLError as exc:
        reason = str(exc)
    except OSError as exc:                 # timeout, connection reset
        reason = str(exc) or type(exc).__name__
    else:
        path = dest_dir / f"igs_satellite_metadata_{now:{_FILE_TIME_FMT}}.snx"
        _write_atomic(path, data)
        return path, []

    if cached is None:
        raise IgsMetadataUnavailableError(f"ดึง IGS metadata ไม่สำเร็จ ({reason}) และไม่มีไฟล์ใน {dest_dir}")
    age_h = (now - cached[1]).total_seconds() / 3600
    return cached[0], [Message("IGS_META_STALE", "warning",
                               f"ดึง IGS metadata ใหม่ไม่สำเร็จ ({reason}) ใช้ไฟล์เดิม {cached[0].name} อายุ {age_h:.1f} ชั่วโมง")]
