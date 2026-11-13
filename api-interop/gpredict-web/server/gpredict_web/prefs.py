"""ค่า Preferences ของ Gpredict (หัวข้อ 8.2 ของ spec งานย่อย 2): ชนิด ช่วง และค่าตั้งต้นของทุก key อยู่ในตาราง PREFS ที่เดียว

- ชื่อ key ใช้ GROUP/KEY ของ gpredict.cfg เก็บเฉพาะค่าที่ผู้ใช้ตั้งที่ data/preferences.json เป็น {"version": 1, "values": {...}}
  key ที่ไม่มีในไฟล์ใช้ค่าตั้งต้นของ Gpredict (Reset ใน Preferences = ลบ key ออกจากไฟล์ ไม่ใช่เขียนค่าตั้งต้นทับ)
- ค่าผิดตอบ 422 PREFS_INVALID ข้อความไทยมีป้ายของ Gpredict (ref-P §9) กับช่วงที่รับ เช่น "Minimum elevation ต้องเป็นจำนวนเต็ม 1–90"
- ไฟล์ที่แก้ด้วยมือจนอ่านไม่ได้หรือบาง key ผิด: เปิด server ได้ ข้ามเฉพาะส่วนที่ผิด (ใช้ค่าตั้งต้น) แล้ว log WARNING ไม่แก้และไม่ลบไฟล์
- งานย่อย 3 และ 4 เพิ่มแถวใน PREFS ไฟล์นี้ import จาก store.py ได้แค่ write_json_atomic (Store ต้องไม่ import ไฟล์นี้)
"""

import copy
import json
import logging
import math
import re
import threading
from dataclasses import dataclass, field
from pathlib import Path

from .errors import ApiError
from .store import write_json_atomic

PREFS_FILE = "preferences.json"
FILE_VERSION = 1

# ชื่อคอลัมน์ตามลำดับที่แสดงจริง (ref-P §2.2 และ §3.2) ลำดับคงที่ ผู้ใช้เลือกได้แค่แสดงหรือซ่อน
SINGLE_PASS_COLUMNS = ("Time", "Az", "El", "Ra", "Dec", "Range", "Rate", "Lat", "Lon", "SSP",
                       "Footp", "Alt", "Vel", "Dop", "Loss", "Del", "MA", "Phase", "Vis")
MULTI_PASS_COLUMNS = ("AOS", "TCA", "LOS", "Duration", "Max El", "AOS Az", "Max El Az", "LOS Az", "Orbit", "Vis")

# สีของดาวลำดับที่ 1..10 ใน Sky at a glance (ref-P §7.4, sat-cfg.c:196-205)
SKY_COLOURS = ("#3c46c8", "#00500a", "#d5472b", "#d06b38", "#cf477a",
               "#bf041f", "#688522", "#0420bf", "#a304bf", "#04bdbf")

_COLOUR_RE = re.compile(r"#[0-9a-fA-F]{6}")
_log = logging.getLogger(__name__)


@dataclass(frozen=True)
class PrefSpec:
    """kind: "int", "float", "bool", "colour" (#rrggbb ตัวเล็ก), "columns" (รายการชื่อใน choices ไม่ซ้ำ เรียงตาม choices), "str"
    lo และ hi คือช่วงที่รับ (รวมปลาย) ของ int และ float, label คือป้ายของ Gpredict ที่ใช้ในข้อความ error (ไม่ใส่ = ใช้ชื่อ key)
    field หลัง default ไม่บังคับทั้งหมด งานย่อยที่เพิ่มชนิดหรือ field ใหม่จึงไม่ต้องแก้แถวเดิม"""
    kind: str
    default: object
    lo: float | None = None
    hi: float | None = None
    choices: tuple[str, ...] | None = None
    label: str = field(default="", kw_only=True)


PREFS: dict[str, PrefSpec] = {
    # Preferences -> Predict -> Pass Conditions (ref-P §9.1)
    "PREDICT/MINIMUM_ELEV": PrefSpec("int", 5, 1, 90, label="Minimum elevation"),
    "PREDICT/NUMBER_OF_PASSES": PrefSpec("int", 10, 5, 50, label="Number of passes to predict"),
    "PREDICT/LOOK_AHEAD": PrefSpec("int", 3, 1, 14, label="Passes should occur within"),
    "PREDICT/TIME_RESOLUTION": PrefSpec("int", 10, 1, 600, label="Time resolution"),
    "PREDICT/NUMBER_OF_ENTRIES": PrefSpec("int", 20, 10, 200, label="Number of entries"),
    "PREDICT/TWILIGHT_THRESHOLD": PrefSpec("int", -6, -18, 0, label="Twilight threshold"),
    "PREDICT/USE_REAL_T0": PrefSpec("bool", False, label="Always use real time for pass predictions"),
    # Single Pass (ref-P §9.3) และ Multiple Passes (ref-P §9.2): ค่าคือชื่อคอลัมน์ที่แสดง
    "PREDICT/SINGLE_PASS_COL": PrefSpec("columns", ["Time", "Az", "El", "Range", "Footp"], choices=SINGLE_PASS_COLUMNS,
                                        label="Visible Columns (Single Pass)"),
    "PREDICT/MULTI_PASS_COL": PrefSpec("columns", ["AOS", "LOS", "Duration", "Max El", "AOS Az", "LOS Az"],
                                       choices=MULTI_PASS_COLUMNS, label="Visible Columns (Multiple Passes)"),
    # ตัวเลือก "File contents:" ของกล่อง Save Pass Details (ref-P §8.1): 0 Info+header+data, 1 Header + data, 2 Data only
    "PREDICT/SAVE_CONTENTS": PrefSpec("int", 0, 0, 2, label="File contents"),
    # Sky at a Glance (ref-P §9.4)
    "SKY_AT_GLANCE/TIME_SPAN_HOURS": PrefSpec("int", 8, 1, 24, label="Find and show passes that occur within"),
}
PREFS.update({f"SKY_AT_GLANCE/COLOUR_{i:02d}": PrefSpec("colour", colour, label=f"Satellite {i}")
              for i, colour in enumerate(SKY_COLOURS, 1)})


# ---------------------------------------------------------------- ตรวจค่า

class _Rejected(Exception):
    """ค่าไม่ผ่าน: ข้อความ (ภาษาไทย) ที่ต่อท้ายป้ายของ Gpredict"""


def _range_text(spec: PrefSpec) -> str:
    return f" {spec.lo}–{spec.hi}" if spec.lo is not None and spec.hi is not None else ""


def _within(spec: PrefSpec, v) -> bool:
    return (spec.lo is None or v >= spec.lo) and (spec.hi is None or v <= spec.hi)


def _check_int(spec: PrefSpec, v):
    if isinstance(v, bool) or not isinstance(v, int) or not _within(spec, v):      # bool เป็น int ใน Python แต่ไม่รับ
        raise _Rejected(f"ต้องเป็นจำนวนเต็ม{_range_text(spec)}")
    return v


def _check_float(spec: PrefSpec, v):
    if not isinstance(v, bool) and isinstance(v, (int, float)) and (not isinstance(v, float) or math.isfinite(v)) \
            and _within(spec, v):
        try:
            return float(v)
        except OverflowError:                       # int ใหญ่เกิน float (เกิดได้เมื่อไม่กำหนดช่วง)
            pass
    raise _Rejected(f"ต้องเป็นตัวเลข{_range_text(spec)}")


def _check_bool(spec: PrefSpec, v):
    if not isinstance(v, bool):                     # ไม่รับ 0/1
        raise _Rejected("ต้องเป็น true หรือ false")
    return v


def _check_colour(spec: PrefSpec, v):
    if not (isinstance(v, str) and _COLOUR_RE.fullmatch(v)):
        raise _Rejected("ต้องเป็นสีรูปแบบ #rrggbb (เลขฐานสิบหก 6 หลัก)")
    return v.lower()


def _check_columns(spec: PrefSpec, v):
    names = spec.choices or ()
    valid = ", ".join(names)
    if not isinstance(v, list) or not all(isinstance(n, str) for n in v):
        raise _Rejected(f"ต้องเป็นรายการชื่อคอลัมน์จาก {valid}")
    unknown = [n for n in v if n not in names]
    if unknown:
        raise _Rejected(f"มีคอลัมน์ที่ไม่รู้จัก {', '.join(unknown)} (ต้องเป็นชื่อจาก {valid})")
    if len(set(v)) != len(v):
        raise _Rejected(f"มีคอลัมน์ซ้ำ {', '.join(sorted({n for n in v if v.count(n) > 1}))}")
    return [n for n in names if n in v]             # เรียงตามลำดับคงที่ของ choices


def _check_str(spec: PrefSpec, v):
    if not isinstance(v, str):
        raise _Rejected("ต้องเป็นข้อความ")
    return v


_CHECKS = {"int": _check_int, "float": _check_float, "bool": _check_bool, "colour": _check_colour,
           "columns": _check_columns, "str": _check_str}


def _spec(key: str) -> PrefSpec:
    spec = PREFS.get(key)
    if spec is None:
        raise ApiError("PREFS_INVALID", 422, f"ไม่รู้จัก key ของ Preferences: {key}", key)
    return spec


def validate(key: str, value) -> object:
    """ค่าที่ normalize แล้ว (สีเป็นตัวเล็ก คอลัมน์เรียงตามลำดับคงที่) หรือ raise 422 PREFS_INVALID ที่ object = key"""
    spec = _spec(key)
    try:
        return _CHECKS[spec.kind](spec, value)
    except _Rejected as rejected:
        raise ApiError("PREFS_INVALID", 422, f"{spec.label or key} {rejected}", key) from None


# ---------------------------------------------------------------- ที่เก็บค่า

class Prefs:
    """ค่าที่ใช้อยู่ = ค่าที่ผู้ใช้ตั้ง (จาก data/preferences.json) ทับค่าตั้งต้นใน PREFS

    thread-safe: ค่าของผู้ใช้เป็น dict ที่ถูกแทนทั้งก้อนทุกครั้งที่เปลี่ยน (copy-on-write) ผู้อ่านจึงอ่านได้โดยไม่ต้องล็อก
    ส่วน update ล็อกตลอดการอ่าน-แก้-เขียนไฟล์ ค่าที่คืนเป็นสำเนา แก้แล้วไม่กระทบค่าที่เก็บ"""

    def __init__(self, data_dir: Path):
        self._path = Path(data_dir) / PREFS_FILE
        self._write_lock = threading.Lock()
        self._user: dict[str, object] = self._load()

    def _load(self) -> dict[str, object]:
        try:
            raw = json.loads(self._path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return {}
        except (OSError, ValueError) as exc:        # ValueError: JSONDecodeError และ UnicodeDecodeError
            _log.warning("อ่าน %s ไม่ได้ จึงใช้ค่าตั้งต้นของ Preferences ทั้งหมด (ไม่แก้ไฟล์): %s", self._path, exc)
            return {}
        values = raw.get("values") if isinstance(raw, dict) else None
        if not isinstance(values, dict):
            _log.warning("%s ไม่มี values ที่เป็น object จึงใช้ค่าตั้งต้นของ Preferences ทั้งหมด (ไม่แก้ไฟล์)", self._path)
            return {}
        user = {}
        for key, value in values.items():
            try:
                user[key] = validate(key, value)
            except ApiError as exc:
                _log.warning("%s: ข้าม %s ใช้ค่าตั้งต้นแทน: %s", self._path.name, key, exc.text)
        return {key: user[key] for key in PREFS if key in user}

    def get(self, key: str):
        """ค่าที่ใช้อยู่ของ key (KeyError ถ้าไม่มี key นี้ใน PREFS)"""
        spec = PREFS[key]
        return copy.deepcopy(self._user.get(key, spec.default))

    def values(self) -> dict[str, object]:
        """ค่าที่ใช้อยู่ของทุก key ตามลำดับใน PREFS"""
        user = self._user
        return {key: copy.deepcopy(user.get(key, spec.default)) for key, spec in PREFS.items()}

    def defaults(self) -> dict[str, object]:
        return {key: copy.deepcopy(spec.default) for key, spec in PREFS.items()}

    def user_keys(self) -> list[str]:
        """key ที่ผู้ใช้ตั้งเอง (อยู่ในไฟล์) ตามลำดับใน PREFS"""
        user = self._user
        return [key for key in PREFS if key in user]

    def update(self, set_: dict, remove: list[str]) -> None:
        """ตั้งค่าใน set_ และลบ key ใน remove (กลับไปใช้ค่าตั้งต้น) ตรวจทุก key ก่อน ผิดตัวเดียว (ไม่รู้จัก ค่าผิด หรืออยู่ทั้งสองฝั่ง)
        raise 422 PREFS_INVALID และไม่เขียนอะไรเลย เขียนไฟล์ไม่สำเร็จ: raise OSError และค่าที่ใช้อยู่ไม่เปลี่ยน"""
        clean = {key: validate(key, value) for key, value in set_.items()}
        for key in remove:
            _spec(key)
            if key in clean:
                raise ApiError("PREFS_INVALID", 422,
                               f"{PREFS[key].label or key} อยู่ทั้งในรายการที่จะตั้งค่า (set) และที่จะลบ (remove)", key)
        with self._write_lock:
            new = {**self._user, **clean}
            for key in remove:
                new.pop(key, None)
            if new == self._user:
                return
            new = {key: new[key] for key in PREFS if key in new}
            write_json_atomic(self._path, {"version": FILE_VERSION, "values": new})
            self._user = new
