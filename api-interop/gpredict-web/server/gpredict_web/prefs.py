"""ค่า Preferences ของ Gpredict (หัวข้อ 8.2 ของ spec งานย่อย 2): ชนิด ช่วง และค่าตั้งต้นของทุก key อยู่ในตาราง PREFS ที่เดียว

- ชื่อ key ใช้ GROUP/KEY ของ gpredict.cfg เก็บเฉพาะค่าที่ผู้ใช้ตั้งที่ data/preferences.json เป็น {"version": 1, "values": {...}}
  key ที่ไม่มีในไฟล์ใช้ค่าตั้งต้นของ Gpredict (Reset ใน Preferences = ลบ key ออกจากไฟล์ ไม่ใช่เขียนค่าตั้งต้นทับ)
- ค่าผิดตอบ 422 PREFS_INVALID ข้อความไทยมีป้ายของ Gpredict (ref-P §9) กับช่วงที่รับ เช่น "Minimum elevation ต้องเป็นจำนวนเต็ม 1–90"
- ไฟล์ที่แก้ด้วยมือจนอ่านไม่ได้หรือบาง key ผิด: เปิด server ได้ ข้ามเฉพาะส่วนที่ผิด (ใช้ค่าตั้งต้น) แล้ว log WARNING ไม่แก้และไม่ลบไฟล์
- งานย่อย 3 และ 4 เพิ่มแถวใน PREFS ไฟล์นี้ import จาก store.py ได้แค่ write_json_atomic (Store ต้องไม่ import ไฟล์นี้)
- ค่าตั้งต้นของ key MODULES/* อ่านจากค่าคงที่ใน module.py ที่เดียว (ไม่พิมพ์ซ้ำ) งานย่อย 4 เพิ่ม key ของ General, TLE, LOG และ Modules
"""

import copy
import json
import logging
import math
import re
import threading
from dataclasses import dataclass, field
from pathlib import Path

from . import module as mod
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

# General → Message Logs "Delete log files older than:" Always delete, 1 day, 1 week, 1 month (ref-D §7.1)
# 1 month = 30 วัน (ของ Gpredict เก็บ 18144000 วินาที = 210 วัน spec §11)
LOG_CLEAN_AGES = (0, 86400, 604800, 2592000)
TIME_FORMAT_MAX = 50                    # ความยาวสูงสุดของ "Time format:" (sat-cfg.h:30)
TLE_PROXY_MAX = 200
URLS_COUNT = (1, 50)                    # จำนวน URL ใน TLE sources ที่รับ
URL_MAX = 500
# General → TLE Update "TLE sources:" ตั้งต้น 1 AMSAT + 10 CelesTrak ตัวที่ 6 สะกด tlet ตาม Gpredict (ref-D §4, sat-cfg.c:235-246)
TLE_URLS_DEFAULT = (
    "https://www.amsat.org/amsat/ftp/keps/current/nasabare.txt",
    "https://celestrak.org/NORAD/elements/gp.php?GROUP=amateur&FORMAT=tle",
    "https://celestrak.org/NORAD/elements/gp.php?GROUP=cubesat&FORMAT=tle",
    "https://celestrak.org/NORAD/elements/gp.php?GROUP=galileo&FORMAT=tle",
    "https://celestrak.org/NORAD/elements/gp.php?GROUP=glo-ops&FORMAT=tle",
    "https://celestrak.org/NORAD/elements/gp.php?GROUP=gps-ops&FORMAT=tlet",
    "https://celestrak.org/NORAD/elements/gp.php?GROUP=iridium-NEXT&FORMAT=tle",
    "https://celestrak.org/NORAD/elements/gp.php?GROUP=science&FORMAT=tle",
    "https://celestrak.org/NORAD/elements/gp.php?GROUP=last-30-days&FORMAT=tle",
    "https://celestrak.org/NORAD/elements/gp.php?GROUP=visual&FORMAT=tle",
    "https://celestrak.org/NORAD/elements/gp.php?GROUP=weather&FORMAT=tle",
)

_COLOUR_RE = re.compile(r"#[0-9a-fA-F]{6}")
_URL_RE = re.compile(r"https?://[^\s;]+")
_TOKEN_RE = re.compile(r"[^\s;]*")
_log = logging.getLogger(__name__)


@dataclass(frozen=True)
class PrefSpec:
    """kind: "int", "float", "bool", "colour" (#rrggbb ตัวเล็ก), "columns" (รายการชื่อใน choices ไม่ซ้ำ เรียงตาม choices),
    "str" (ถ้ามี choices ต้องเป็นหนึ่งในนั้น), "token" ("str" ที่ไม่มีช่องว่างหรือ ; ใช้กับ proxy), "rgba" (int 0xRRGGBBAA),
    "urls" (รายการ URL http/https), "layout" (layout code ที่ module.parse_layout รับ),
    "map_file" (ชื่อไฟล์ภาพแผนที่ที่ module.is_map_file รับ)
    ค่ารวม MODULES/* ต้องผ่านการตรวจของ module.py ด้วยเสมอ ไม่งั้นทุก module ที่สืบทอดค่านั้นเปิดไม่ได้
    lo และ hi คือช่วงที่รับ (รวมปลาย) ของ int และ float (ใส่แค่ lo = ตั้งแต่ lo ขึ้นไป), allowed คือชุดค่าที่รับของ int,
    max_len คือความยาวสูงสุดของ str และ token (นับตัวอักษร), label คือป้ายของ Gpredict ที่ใช้ในข้อความ error (ไม่ใส่ = ใช้ชื่อ key)
    field หลัง default ไม่บังคับทั้งหมด งานย่อยที่เพิ่มชนิดหรือ field ใหม่จึงไม่ต้องแก้แถวเดิม"""
    kind: str
    default: object
    lo: float | None = None
    hi: float | None = None
    choices: tuple[str, ...] | None = None
    max_len: int | None = None
    allowed: tuple | None = None
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


# ---------------------------------------------------------------- งานย่อย 4: General, TLE, LOG และ Modules (ref-D §14, sat-cfg.c)
# ป้ายของ Modules ที่ Map view และ Polar view ใช้ชื่อซ้ำกัน (Satellite Name, Tick Labels ฯลฯ) ต่อท้ายด้วยหน้า (ของเรา)

PREFS.update({
    # General → Number Formats (ref-D §2) และ Layout → Window Placements (ref-D §10)
    "GLOBAL/USE_LOCAL_TIME": PrefSpec("bool", False, label="Show local time instead of UTC."),
    "GLOBAL/USE_NSEW": PrefSpec("bool", False, label="Use N/S/E/W for geographical coordinates."),
    "GLOBAL/USE_IMPERIAL": PrefSpec("bool", False, label="Use Imperial units instead of Metric."),
    "GLOBAL/MAIN_WIN_POS": PrefSpec("bool", False, label="Restore position of main window"),
    "GLOBAL/MOD_WIN_POS": PrefSpec("bool", False, label="Restore position of module windows"),
    "GLOBAL/MOD_STATE": PrefSpec("bool", False, label="Restore the state of modules when reopened (docked or window)"),
    "GLOBAL/TIME_FORMAT": PrefSpec("str", "%Y/%m/%d %H:%M:%S", max_len=TIME_FORMAT_MAX, label="Time format"),
    "GLOBAL/CURRENT_PAGE": PrefSpec("int", -1, -1, 999),        # ลำดับแท็บที่เปิดอยู่ (ไม่มีหน้า Preferences)
    # General → TLE Update (ref-D §4)
    "TLE/AUTO_UPDATE_FREQ": PrefSpec("int", 2, allowed=(0, 1, 2, 3), label="Check the age of TLE data"),
    "TLE/AUTO_UPDATE_ACTION": PrefSpec("int", 1, allowed=(1, 2), label="If TLEs are too old"),
    "TLE/PROXY": PrefSpec("token", "", max_len=TLE_PROXY_MAX, label="Proxy server"),
    "TLE/URLS": PrefSpec("urls", list(TLE_URLS_DEFAULT), label="TLE sources"),
    "TLE/ADD_NEW_SATS": PrefSpec("bool", True, label="Add new satellites to local database"),
    "TLE/LAST_UPDATE": PrefSpec("int", 0, 0),                   # เวลา (วินาที unix) ที่ Update ล่าสุด ไม่มีหน้า Preferences
    # General → Message Logs (ref-D §7.1)
    "LOG/LEVEL": PrefSpec("int", 2, 0, 4, label="Debug level"),
    "LOG/CLEAN_AGE": PrefSpec("int", 0, allowed=LOG_CLEAN_AGES, label="Delete log files older than"),
    # Modules → Layout และ Refresh Rates (ref-D §10, ref §3)
    "MODULES/GRID": PrefSpec("layout", mod.DEFAULT_LAYOUT_CODE, label="Module layout"),
    "MODULES/DATA_TIMEOUT": PrefSpec("int", mod.REFRESH_DEFAULT["data_ms"], *mod.DATA_MS_RANGE,
                                     label=mod.REFRESH_LABELS["data_ms"]),
})
PREFS.update({f"MODULES/{key}": PrefSpec("int", mod.REFRESH_DEFAULT[name], *mod.CYCLE_RANGE, label=mod.REFRESH_LABELS[name])
              for key, name in (("LIST_REFRESH", "list"), ("MAP_REFRESH", "map"), ("POLAR_REFRESH", "polar"),
                                ("SINGLE_SAT_REFRESH", "single"), ("EVENT_LIST_REFRESH", "event"))})
PREFS.update({
    # List View และ Single Sat View: ชื่อคอลัมน์และช่องที่แสดง (Gpredict เก็บเป็นบิตมาสก์ เราเก็บเป็นชื่อเหมือน PREDICT/*_COL)
    "MODULES/LIST_COLUMNS": PrefSpec("columns", list(mod.LIST_DEFAULT), choices=mod.LIST_COLUMNS,
                                     label="Visible Fields (List View)"),
    "MODULES/SINGLE_SAT_FIELDS": PrefSpec("columns", list(mod.SINGLE_DEFAULT), choices=mod.SINGLE_FIELDS,
                                          label="Visible Fields (Single Sat View)"),
})
# Map View (ref-D §11): Contents เรียงตาม mod.MAP_CONTENTS (ชื่อ key สะกดตาม Gpredict เช่น MAP_SAT_FOTPRINT)
PREFS.update({f"MODULES/{key}": PrefSpec("bool", name not in mod.MAP_DEFAULT_OFF, label=f"{name} (Map View)")
              for key, name in zip(("MAP_SAT_NAME", "MAP_SAT_FOTPRINT", "MAP_SAT_MARKER", "MAP_QTH_INFO", "MAP_NEXT_EVENT",
                                    "MAP_CURSOR_TRACK", "MAP_SHOW_GRID", "MAP_SHOW_TERMINATOR"), mod.MAP_CONTENTS, strict=True)})
PREFS.update({
    "MODULES/MAP_TRACK_NUM": PrefSpec("int", mod.TRACK_ORBITS_DEFAULT, *mod.TRACK_ORBITS_RANGE,
                                      label="Display ground track for"),
    "MODULES/MAP_CENTER": PrefSpec("int", mod.CENTER_LON_DEFAULT, *mod.CENTER_LON_RANGE, label="Center map at longitude"),
    "MODULES/MAP_FILE": PrefSpec("map_file", mod.DEFAULT_MAP, label="Background Map"),
    "MODULES/MAP_SHADOW_ALPHA": PrefSpec("int", mod.MAP_SHADOW_DEFAULT, *mod.SHADOW_ALPHA_RANGE, label="Shadow"),
})
# (key ของ Gpredict, ชื่อสีใน mod.MAP_COLOURS_DEFAULT, ป้ายของปุ่มสี)
PREFS.update({f"MODULES/{key}": PrefSpec("rgba", mod.MAP_COLOURS_DEFAULT[name], label=f"{label} (Map View)")
              for key, name, label in (("MAP_QTH_COLOUR", "groundStation", "Ground Station"),
                                       ("MAP_GRID_COLOUR", "grid", "Grid"),
                                       ("MAP_TICK_COLOUR", "tick", "Tick Labels"),
                                       ("MAP_SAT_COLOUR", "satellite", "Satellite"),
                                       ("MAP_SELECTED_SAT_COLOUR", "selected", "Selected Sat."),
                                       ("MAP_TRACK_COLOUR", "track", "Ground Track"),
                                       ("MAP_COV_AREA_COLOUR", "footprint", "Footprint"),
                                       ("MAP_INFO_COLOUR", "infoFg", "Info Text FG"),
                                       ("MAP_INFO_BGD_COLOUR", "infoBg", "Info Text BG"),
                                       ("MAP_TERMINATOR_COLOUR", "terminator", "Solar terminator"),
                                       ("MAP_EARTH_SHADOW_COLOUR", "earthShadow", "Global shadow"))})
# Polar View (ref-D §12): ทิศเก็บเป็นชื่อ ("N/E/S/W" ...) แทนเลข 0-3 ของ Gpredict
PREFS["MODULES/POLAR_CHART_ORIENT"] = PrefSpec("str", mod.POLAR_ORIENTATIONS[0], choices=mod.POLAR_ORIENTATIONS,
                                               label="Orientation")
PREFS.update({f"MODULES/{key}": PrefSpec("bool", name not in mod.POLAR_DEFAULT_OFF, label=f"{name} (Polar View)")
              for key, name in zip(("POLAR_SAT_NAME", "POLAR_SAT_MARKER", "POLAR_QTH_INFO", "POLAR_NEXT_EVENT",
                                    "POLAR_CURSOR_TRACK", "POLAR_EXTRA_AZ_TICKS"), mod.POLAR_CONTENTS, strict=True)})
PREFS["MODULES/POLAR_SHOW_TRACK_AUTO"] = PrefSpec("bool", mod.POLAR_AUTO_SKYTRACK_DEFAULT,
                                                  label="Show the sky tracks automatically")
PREFS.update({f"MODULES/{key}": PrefSpec("rgba", mod.POLAR_COLOURS_DEFAULT[name], label=f"{label} (Polar View)")
              for key, name, label in (("POLAR_BGD_COLOUR", "background", "Background"),
                                       ("POLAR_AXIS_COLOUR", "axes", "Axes/Circles"),
                                       ("POLAR_TICK_COLOUR", "tick", "Tick Labels"),
                                       ("POLAR_SAT_COLOUR", "satellite", "Satellite"),
                                       ("POLAR_SELECTED_SAT_COL", "selected", "Selected Sat."),
                                       ("POLAR_TRACK_COLOUR", "track", "Sky Track"),
                                       ("POLAR_INFO_COLOUR", "info", "Info Text"))})


# ---------------------------------------------------------------- ตรวจค่า

class _Rejected(Exception):
    """ค่าไม่ผ่าน: ข้อความ (ภาษาไทย) ที่ต่อท้ายป้ายของ Gpredict"""


def _range_text(spec: PrefSpec) -> str:
    if spec.lo is not None and spec.hi is not None:
        return f" {spec.lo}–{spec.hi}"
    return f" ตั้งแต่ {spec.lo} ขึ้นไป" if spec.lo is not None else ""


def _within(spec: PrefSpec, v) -> bool:
    return (spec.lo is None or v >= spec.lo) and (spec.hi is None or v <= spec.hi)


def _check_int(spec: PrefSpec, v):
    if isinstance(v, bool) or not isinstance(v, int) or not _within(spec, v) \
            or (spec.allowed is not None and v not in spec.allowed):                # bool เป็น int ใน Python แต่ไม่รับ
        hint = f" หนึ่งใน {', '.join(map(str, spec.allowed))}" if spec.allowed is not None else _range_text(spec)
        raise _Rejected(f"ต้องเป็นจำนวนเต็ม{hint}")
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
    if spec.max_len is not None and len(v) > spec.max_len:
        raise _Rejected(f"ต้องเป็นข้อความยาวไม่เกิน {spec.max_len} ตัวอักษร")
    if spec.choices is not None and v not in spec.choices:
        raise _Rejected(f"ต้องเป็นหนึ่งใน {', '.join(spec.choices)}")
    return v


def _check_token(spec: PrefSpec, v):
    """ข้อความที่ไม่มีช่องว่างหรือ ; (ค่าที่เก็บคู่กับรายการที่คั่นด้วย ; และ URL ของ proxy ไม่มีช่องว่าง)"""
    if not _TOKEN_RE.fullmatch(_check_str(spec, v)):
        raise _Rejected("ต้องไม่มีช่องว่างหรือเครื่องหมาย ;")
    return v


def _check_rgba(spec: PrefSpec, v):
    if isinstance(v, bool) or not isinstance(v, int) or not 0 <= v <= mod.RGBA_MAX:
        raise _Rejected(f"ต้องเป็นสีรูปแบบ 0xRRGGBBAA (จำนวนเต็ม 0–{mod.RGBA_MAX})")
    return v


def _check_map_file(spec: PrefSpec, v):
    if not mod.is_map_file(v):
        raise _Rejected(mod.MAP_FILE_TEXT)
    return v


def _check_urls(spec: PrefSpec, v):
    lo, hi = URLS_COUNT
    if not isinstance(v, list) or not lo <= len(v) <= hi:
        raise _Rejected(f"ต้องเป็นรายการ URL {lo}–{hi} รายการ")
    for url in v:
        if not (isinstance(url, str) and len(url) <= URL_MAX and _URL_RE.fullmatch(url)):
            raise _Rejected(f"มี URL ที่ไม่ถูกต้อง {url!r:.100} (ต้องขึ้นต้นด้วย http:// หรือ https:// "
                            f"ไม่มีช่องว่างหรือ ; และยาวไม่เกิน {URL_MAX} ตัวอักษร)")
    return list(v)


def _check_layout(spec: PrefSpec, v):
    try:
        mod.parse_layout(v)
    except ValueError as exc:
        raise _Rejected(f"ไม่ใช่ layout code ที่ถูกต้อง: {exc}") from None
    return v


_CHECKS = {"int": _check_int, "float": _check_float, "bool": _check_bool, "colour": _check_colour,
           "columns": _check_columns, "str": _check_str, "token": _check_token, "rgba": _check_rgba,
           "urls": _check_urls, "layout": _check_layout, "map_file": _check_map_file}


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

    @staticmethod
    def _checked(set_: dict, remove: list[str]) -> dict[str, object]:
        """ค่าใน set_ ที่ตรวจและปรับรูปแล้ว: ตรวจทุก key ก่อน ผิดตัวเดียว (ไม่รู้จัก ค่าผิด หรืออยู่ทั้งสองฝั่ง) raise 422 PREFS_INVALID"""
        clean = {key: validate(key, value) for key, value in set_.items()}
        for key in remove:
            _spec(key)
            if key in clean:
                raise ApiError("PREFS_INVALID", 422,
                               f"{PREFS[key].label or key} อยู่ทั้งในรายการที่จะตั้งค่า (set) และที่จะลบ (remove)", key)
        return clean

    @staticmethod
    def _merged(user: dict[str, object], clean: dict[str, object], remove: list[str]) -> dict[str, object]:
        new = {**user, **clean}
        for key in remove:
            new.pop(key, None)
        return {key: new[key] for key in PREFS if key in new}

    def update(self, set_: dict, remove: list[str]) -> None:
        """ตั้งค่าใน set_ และลบ key ใน remove (กลับไปใช้ค่าตั้งต้น) ตรวจทุก key ก่อน ผิดตัวเดียว (ไม่รู้จัก ค่าผิด หรืออยู่ทั้งสองฝั่ง)
        raise 422 PREFS_INVALID และไม่เขียนอะไรเลย เขียนไฟล์ไม่สำเร็จ: raise OSError และค่าที่ใช้อยู่ไม่เปลี่ยน"""
        clean = self._checked(set_, remove)
        with self._write_lock:
            new = self._merged(self._user, clean, remove)
            if new == self._user:
                return
            write_json_atomic(self._path, {"version": FILE_VERSION, "values": new})
            self._user = new

    def preview(self, set_: dict, remove: list[str]) -> "Prefs":
        """(ของเรา) dry run ของ update: ตรวจเหมือนกันทุกอย่าง แล้วคืนค่าที่จะใช้หลัง update เป็น Prefs อ่านอย่างเดียว
        ไม่เขียนไฟล์และไม่แตะค่าที่ใช้อยู่ (OK ของ Preferences ตรวจทุกส่วนก่อนเขียนจริง)"""
        return _Preview(self._merged(self._user, self._checked(set_, remove), remove))


class _Preview(Prefs):
    """ค่าที่ Prefs.preview คำนวณไว้ อ่านได้เหมือน Prefs แต่เขียนไม่ได้"""

    def __init__(self, user: dict[str, object]):
        self._user = user

    def update(self, set_: dict, remove: list[str]) -> None:
        raise TypeError("ตัวอย่างค่าจาก Prefs.preview แก้ไม่ได้")
