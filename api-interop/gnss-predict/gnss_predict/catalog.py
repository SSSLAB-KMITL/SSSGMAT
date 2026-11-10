"""รวม OMM, IGS metadata และสถานะ broadcast จาก snapshot เป็นรายการดาวพร้อม PRN ของ IGS และธงสถานะ
(หัวข้อ 5.5 และ 6 ของ spec engine)

snapshot_dir ประกอบด้วย
- <group>.json ต่อกลุ่ม CelesTrak ที่ขอ (GNSS_GROUPS) เช่น gps-ops.json
- igs_satellite_metadata.snx
- brdc/ ไฟล์ RINEX nav หนึ่งไฟล์ (ชื่ออะไรก็ได้ ลงท้าย .rnx หรือ .rnx.gz ถ้ามีหลายไฟล์ใช้ชื่อที่เรียงแล้วมากที่สุด)
  ไม่มีโฟลเดอร์ ไม่มีไฟล์ หรืออ่านไฟล์ไม่ได้: ไม่ตั้งธง no_broadcast และ unhealthy + Message BRDC_UNAVAILABLE

ข้อผิดพลาดที่คืนเป็น exception ของ engine เสมอ (ไม่ปล่อย ValueError/OSError ดิบ):
ไฟล์ OMM ของกลุ่มที่ขอใช้ไม่ได้ -> OrbitUnavailableError ที่ระบุชื่อกลุ่ม, IGS metadata ใช้ไม่ได้ -> IgsMetadataUnavailableError
"""

import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from .brdc import BroadcastStatus, broadcast_status, read_nav
from .config import AGE_OK_DAYS, AGE_SHOWN_MAX_DAYS, GNSS_GROUPS
from .errors import BrdcUnavailableError, IgsMetadataUnavailableError, Message, OrbitUnavailableError
from .igs_meta import IgsMetadata, read_metadata
from .omm import OmmRecord, read_omm, to_tle_lines

IGS_METADATA_FILE = "igs_satellite_metadata.snx"
BRDC_DIR = "brdc"

# ธงที่ทำให้ดาวไม่ถูกนำไปคำนวณ DOP (หัวข้อ 6)
DOP_EXCLUDED_FLAGS = frozenset({"too_old", "no_broadcast", "unhealthy"})
# ธงที่ทำให้ SAT_FLAGGED เป็น warning ถ้ามีแต่ name_mismatch เป็น info
_WARNING_FLAGS = frozenset({"stale", "too_old", "no_broadcast", "unhealthy", "prn_changed"})

_GPS_NAME_RE = re.compile(r"\(PRN\s*(\d{1,2})\)")
_BDS_NAME_RE = re.compile(r"\((C\d{2})\)")

_FLAG_TEXT = {
    "stale": "ข้อมูลวงโคจร (OMM) เก่ากว่า {ok:g} วัน (อายุ {age:.2f} วัน)",
    "too_old": "ข้อมูลวงโคจร (OMM) เก่าเกิน {max:g} วัน (อายุ {age:.2f} วัน)",
    "no_broadcast": "ไม่พบดาวนี้ในไฟล์ broadcast",
    "unhealthy": "ephemeris ล่าสุดใน broadcast ระบุว่าดาวไม่สมบูรณ์ (health ไม่เป็น 0)",
    "prn_changed": "PRN เปลี่ยนระหว่างช่วงวิเคราะห์",
    "name_mismatch": "ชื่อใน CelesTrak ({name}) มี PRN ไม่ตรงกับ IGS",
}
_FLAG_ORDER = ("stale", "too_old", "no_broadcast", "unhealthy", "prn_changed", "name_mismatch")


@dataclass(frozen=True)
class CatalogSatellite:
    prn: str
    system: str
    svn: str
    norad: int
    block: str
    celestrak_name: str
    omm_epoch: datetime
    age_days: float
    flags: frozenset[str]
    tle_lines: tuple[str, str]


@dataclass
class Catalog:
    satellites: list[CatalogSatellite]
    unmapped: list[dict]            # norad, celestrak_name, object_id, reason (NO_PRN, DUPLICATE_PRN, TLE_UNAVAILABLE)
    messages: list[Message]


def is_shown(sat: CatalogSatellite, show_too_old: bool, show_no_broadcast: bool) -> bool:
    """ดาวถูกซ่อนถ้ามีธงที่ซ่อนอย่างน้อยหนึ่งธงและตัวกรองของธงนั้นปิดอยู่ (หัวข้อ 6)"""
    if "too_old" in sat.flags and not show_too_old:
        return False
    if "no_broadcast" in sat.flags and not show_no_broadcast:
        return False
    return True


def _read_group(snapshot_dir: Path, group: str) -> list[OmmRecord]:
    path = snapshot_dir / f"{group}.json"
    try:
        return read_omm(path)
    except (OSError, ValueError) as exc:             # ไม่มีไฟล์, อ่านไม่ได้, ไม่ใช่ JSON ของ OMM (รวม UnicodeDecodeError)
        raise OrbitUnavailableError(f"อ่านข้อมูลวงโคจรของกลุ่ม {group} ไม่ได้ ({path}): {exc}") from exc


def _read_igs(snapshot_dir: Path) -> IgsMetadata:
    path = snapshot_dir / IGS_METADATA_FILE
    try:
        return read_metadata(path)
    except (OSError, ValueError) as exc:
        raise IgsMetadataUnavailableError(f"อ่าน IGS metadata ไม่ได้ ({path}): {exc}") from exc


def _read_broadcast(snapshot_dir: Path) -> tuple[dict[str, BroadcastStatus] | None, Message | None]:
    """(สถานะ broadcast ของแต่ละ PRN, None) หรือ (None, BRDC_UNAVAILABLE) เมื่อใช้ไฟล์ broadcast ไม่ได้"""
    folder = snapshot_dir / BRDC_DIR
    try:
        files = sorted(p for p in folder.iterdir() if p.is_file() and p.name.lower().endswith((".rnx", ".rnx.gz")))
    except OSError:                                    # ไม่มีโฟลเดอร์, ไม่ใช่โฟลเดอร์, อ่านไม่ได้
        files = []
    if not files:
        reason = f"ไม่พบไฟล์ broadcast (.rnx หรือ .rnx.gz) ใน {folder}"
    else:
        try:
            return broadcast_status(read_nav(files[-1])), None
        except BrdcUnavailableError as exc:
            reason = str(exc)
    return None, Message("BRDC_UNAVAILABLE", "warning",
                         f"ไม่มีข้อมูล broadcast ที่ใช้ได้ ({reason}) จึงไม่ตรวจธง no_broadcast และ unhealthy")


def _name_prn(system: str, name: str) -> str | None:
    """PRN ที่อ่านได้จากชื่อใน CelesTrak (เฉพาะ GPS และ BeiDou) ไม่มีหรือไม่ใช่สองระบบนี้คืน None"""
    if system == "G":
        m = _GPS_NAME_RE.search(name)
        return f"G{int(m.group(1)):02d}" if m else None
    if system == "C":
        m = _BDS_NAME_RE.search(name)
        return m.group(1) if m else None
    return None


def _unmapped(rec: OmmRecord, reason: str) -> dict:
    return {"norad": rec.norad, "celestrak_name": rec.name, "object_id": rec.object_id, "reason": reason}


def _flagged_message(sat: CatalogSatellite) -> Message:
    parts = [_FLAG_TEXT[f].format(ok=AGE_OK_DAYS, max=AGE_SHOWN_MAX_DAYS, age=sat.age_days, name=sat.celestrak_name)
             for f in _FLAG_ORDER if f in sat.flags]
    level = "warning" if sat.flags & _WARNING_FLAGS else "info"
    return Message("SAT_FLAGGED", level, f"ดาว {sat.prn} (NORAD {sat.norad}): " + "; ".join(parts), sat.prn)


def build_catalog(snapshot_dir: Path, period: tuple[datetime, datetime], systems: set[str]) -> Catalog:
    """รายการดาวของระบบใน systems (ตัวอักษร G, R, E, C ตัวที่ไม่อยู่ใน GNSS_GROUPS ข้าม) เรียงตาม PRN

    PRN, SVN และบล็อกมาจาก IgsMetadata.identity_at(norad, ต้นช่วง) เท่านั้น ระบบของดาวคือตัวอักษรแรกของ PRN
    ดาวที่ไม่มี PRN ณ ต้นช่วง (NO_PRN), ดาวที่แปลงเป็น TLE ไม่ได้ (TLE_UNAVAILABLE) และดาวที่อ้าง PRN ซ้ำกับดวงที่ epoch ใหม่กว่า
    (DUPLICATE_PRN) ไปอยู่ใน unmapped
    """
    snapshot_dir = Path(snapshot_dir)
    start, stop = period
    midpoint = start + (stop - start) / 2

    records: list[OmmRecord] = []
    for system, group in GNSS_GROUPS.items():
        if system in systems:
            records.extend(_read_group(snapshot_dir, group))
    igs = _read_igs(snapshot_dir)
    status, brdc_message = _read_broadcast(snapshot_dir)

    unmapped: list[dict] = []
    chosen: dict = {}                                  # PRN -> (OmmRecord, SatIdentity, tle_lines)
    for rec in records:
        ident = igs.identity_at(rec.norad, start)
        if ident is None:
            unmapped.append(_unmapped(rec, "NO_PRN"))
            continue
        try:
            tle = to_tle_lines(rec)
        except (ValueError, OverflowError):            # ช่องของ OMM ขาด ผิดรูป หรือเกินช่วงที่ TLE รองรับ
            unmapped.append(_unmapped(rec, "TLE_UNAVAILABLE"))
            continue
        other = chosen.get(ident.prn)
        if other is None:
            chosen[ident.prn] = (rec, ident, tle)
            continue
        # PRN ซ้ำ: เลือกดวงที่ epoch ใหม่กว่า (เท่ากันเลือก NORAD น้อยกว่า)
        if (rec.epoch, -rec.norad) > (other[0].epoch, -other[0].norad):
            chosen[ident.prn] = (rec, ident, tle)
            unmapped.append(_unmapped(other[0], "DUPLICATE_PRN"))
        else:
            unmapped.append(_unmapped(rec, "DUPLICATE_PRN"))

    satellites = []
    for prn in sorted(chosen):
        rec, ident, tle = chosen[prn]
        age_days = abs((midpoint - rec.epoch).total_seconds()) / 86400
        flags = set()
        if age_days > AGE_SHOWN_MAX_DAYS:
            flags.add("too_old")
        elif age_days > AGE_OK_DAYS:
            flags.add("stale")
        if status is not None:
            if prn not in status:
                flags.add("no_broadcast")
            elif not status[prn].healthy:
                flags.add("unhealthy")
        if igs.prn_changes(rec.norad, start, stop):
            flags.add("prn_changed")
        name_prn = _name_prn(prn[0], rec.name)
        if name_prn is not None and name_prn != prn:
            flags.add("name_mismatch")
        satellites.append(CatalogSatellite(prn, prn[0], ident.svn, rec.norad, ident.block, rec.name, rec.epoch,
                                           age_days, frozenset(flags), tle))

    messages = [brdc_message] if brdc_message is not None else []
    messages.extend(_flagged_message(s) for s in satellites if s.flags)
    return Catalog(satellites, unmapped, messages)
