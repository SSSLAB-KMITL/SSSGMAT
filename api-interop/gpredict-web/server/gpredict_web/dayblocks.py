"""block ephemeris รายวัน (spec §3.1 ของงานย่อย 2): ชื่อโฟลเดอร์ ช่วงเวลา การตัด และการต่อ block ไม่มี I/O

- block คือค่าของดาว 1 ดวงใน 1 วัน UTC เวลา [d 00:00Z, d+1 00:00Z] ทุก STEP_S วินาที รวม BLOCK_EPOCHS = 2881 epoch
  epoch เที่ยงคืนจึงอยู่ทั้งใน block ของวันก่อนและของวันถัดไป
- ไฟล์ของ block อยู่ที่ <ephem>/day/<YYYYMMDD>/<tle key>.f64 รูปแบบเดียวกับไฟล์ของช่วง module (x y z vx vy vz ต่อ epoch)
- งาน GMAT หนึ่งงานคำนวณ day_window(first, last) แล้ว split_days ตัดเป็น block รายวัน
  stitch ต่อ block ของวันติดกันกลับเป็น SatEphem เส้นเดียว ใช้ epoch เที่ยงคืนจุดเดียว
"""

from __future__ import annotations                   # Window/SatEphem นำเข้าแค่ใต้ TYPE_CHECKING: Python ก่อน 3.14 ต้องไม่ประเมิน

from array import array
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from typing import TYPE_CHECKING

from .config import STEP_S

if TYPE_CHECKING:
    from .ephem import SatEphem, Window

DAY_DIR = "day"
BLOCK_EPOCHS = 86400 // STEP_S + 1                    # 2881 epoch ต่อวัน (รวมเที่ยงคืนทั้งสองฝั่ง)
_STRIDE = BLOCK_EPOCHS - 1                            # จำนวน epoch จากเที่ยงคืนหนึ่งถึงเที่ยงคืนถัดไป
_VALUES = 6                                           # x y z vx vy vz ต่อ epoch (รูปแบบเดียวกับ ephem)
_DIR_DAY = "%Y%m%d"
_UTC = timezone.utc


def _check_days(first: date, last: date) -> None:
    for d in (first, last):
        if not isinstance(d, date) or isinstance(d, datetime):
            raise ValueError(f"วันต้องเป็น date ไม่ใช่ datetime (ได้ {d!r})")
    if first > last:
        raise ValueError(f"วันแรก ({first}) อยู่หลังวันสุดท้าย ({last})")


def day_dir(root: Path, d: date) -> Path:
    """<root>/day/<YYYYMMDD> (root คือโฟลเดอร์ ephem)"""
    return root / DAY_DIR / f"{d:{_DIR_DAY}}"


def day_of_dir(name: str) -> date | None:
    """วันจากชื่อโฟลเดอร์ YYYYMMDD ชื่อแบบอื่นคืน None"""
    try:
        d = datetime.strptime(name, _DIR_DAY).date()
    except ValueError:
        return None
    return d if f"{d:{_DIR_DAY}}" == name else None


def day_range(first: date, last: date) -> list[date]:
    """ทุกวันตั้งแต่ first ถึง last (รวมทั้งสองวัน)"""
    _check_days(first, last)
    return [first + timedelta(days=i) for i in range((last - first).days + 1)]


def day_window(first: date, last: date) -> Window:
    """(first 00:00Z, (last + 1 วัน) 00:00Z)"""
    _check_days(first, last)
    return (datetime.combine(first, time(), _UTC),
            datetime.combine(last + timedelta(days=1), time(), _UTC))


def window_days(w: Window) -> tuple[date, date]:
    """(วันแรก, วันสุดท้าย) ของช่วงที่ day_window สร้าง"""
    return w[0].astimezone(_UTC).date(), (w[1].astimezone(_UTC) - timedelta(days=1)).date()


def split_days(first: date, last: date, a: array) -> dict[date, array]:
    """ตัดค่าของ day_window(first, last) เป็น block รายวัน ยาว BLOCK_EPOCHS × 6 ค่าต่อ block"""
    days = day_range(first, last)
    if len(a) != (len(days) * _STRIDE + 1) * _VALUES:
        raise ValueError(f"มี {len(a)} ค่า ไม่ตรงกับ {len(days)} วัน")
    return {d: a[i * _STRIDE * _VALUES:(i * _STRIDE + BLOCK_EPOCHS) * _VALUES] for i, d in enumerate(days)}


def stitch(first: date, blocks: list[array]) -> SatEphem:
    """ต่อ block ของวัน first, first + 1, ... เป็นเส้นเดียว epoch เที่ยงคืนใช้ของ block ก่อนจุดเดียว"""
    from .ephem import _from_array, _times            # ephem นำเข้าโมดูลนี้ จึงนำเข้าตอนเรียก (ไม่ให้ import วน)
    if not blocks:
        raise ValueError("ต้องมีอย่างน้อย 1 block")
    if any(len(b) != BLOCK_EPOCHS * _VALUES for b in blocks):
        raise ValueError(f"block ต้องยาว {BLOCK_EPOCHS * _VALUES} ค่า")
    a = array("d", blocks[0])                         # สำเนา: block ในหน่วยความจำใช้ร่วมกัน ห้ามแก้
    for b in blocks[1:]:
        a.extend(b[_VALUES:])
    last = first + timedelta(days=len(blocks) - 1)
    return _from_array(_times(*day_window(first, last)), a)
