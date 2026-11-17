"""Module (หัวข้อ 7.1 ของ spec): ค่าตั้งต้นและช่วงค่าตาม Gpredict 2.7 (ref §3-§7), layout code และการตรวจ module

ชื่อคอลัมน์ ชื่อช่อง และ hint ทุกตัวคัดมาจาก reference ตรงตัว (ตัวพิมพ์ เครื่องหมาย) เพราะ web ใช้เป็นป้ายและ tooltip

ท้ายไฟล์เป็นโมเดลการสืบทอดค่า (หัวข้อ 9.1 ของ spec งานย่อย 4, ไม่มี I/O): ไฟล์ module แบบ version 2 เก็บเฉพาะค่าที่ตั้งเอง
(own) ค่าที่ใช้จริง (effective) = ของ module → ค่ารวม (key MODULES/* ของ prefs.py) → ค่าตั้งต้นของ Gpredict
ไฟล์นี้ห้าม import prefs.py (prefs.py import ไฟล์นี้) จึงรับค่ารวมเป็น Mapping ที่ผู้เรียกส่งมา
"""

import copy
import re
from collections.abc import Iterable, Mapping
from dataclasses import asdict, dataclass, field

from .config import MAX_SATS, NAME_RE
from .errors import ApiError

# ---------- ค่าคงที่จาก reference ----------

# §3 Built-in presets เรียง 0-8 (ป้าย, layout code) ส่วน "Custom" ไม่อยู่ในรายการ
LAYOUT_PRESETS: list[tuple[str, str]] = [
    ("World map, polar and single sat", "1;0;2;0;1;2;0;1;1;2;3;1;2;1;2"),
    ("World map", "1;0;2;0;1"),
    ("Table", "0;0;2;0;1"),
    ("World map and table", "1;0;2;0;2;0;0;2;2;3"),
    ("Polar and single sat", "2;0;1;0;1;3;1;2;0;1"),
    ("Polar and upcoming passes", "2;0;1;0;1;4;1;2;0;1"),
    ("All views (narrow)", "1;0;3;0;4;0;0;3;4;6;2;0;1;6;8;3;1;2;6;8;4;2;3;6;8"),
    ("All views (wide)", "1;0;3;0;3;0;0;3;3;4;2;3;4;0;2;4;3;4;2;3;3;3;4;3;4"),
    ("Map, table, polar and single sat (wide)", "1;0;3;0;3;0;0;3;3;4;2;3;4;0;2;3;3;4;2;4"),
]
DEFAULT_LAYOUT_CODE = LAYOUT_PRESETS[0][1]

VIEW_TYPES = (0, 1, 2, 3, 4)          # 0 List, 1 Map, 2 Polar, 3 Single sat, 4 Event list

# §3 Refresh Rates: data_ms 100-10000 msec, ที่เหลือเป็นจำนวนรอบ 1-50 (event list มีค่าแต่ไม่มี control ใน UI)
REFRESH_DEFAULT = {"data_ms": 300, "list": 1, "map": 10, "polar": 3, "single": 1, "event": 1}
DATA_MS_RANGE = (100, 10000)
CYCLE_RANGE = (1, 50)
REFRESH_LABELS = {"data_ms": "Refresh data every", "list": "Refresh list view every",
                  "map": "Refresh map view every", "polar": "Refresh polar view every",
                  "single": "Refresh single-sat view every", "event": "Refresh event list every"}

# §4 List view: (ชื่อคอลัมน์, hint)
_LIST = (
    ("Satellite", "Satellite Name"), ("Catnum", "Catalogue Number"), ("Az", "Azimuth"), ("El", "Elevation"),
    ("Dir", "Direction"), ("Ra", "Right Ascension"), ("Dec", "Declination"), ("Range", "Slant Range"),
    ("Rate", "Range Rate"), ("Next Event", "Next Event"), ("Next AOS", "Next AOS"), ("Next LOS", "Next LOS"),
    ("Lat", "Latitude"), ("Lon", "Longitude"), ("SSP", "Sub-Satellite Point"), ("Footp", "Footprint"),
    ("Alt", "Altitude"), ("Vel", "Velocity"), ("Dop", "Doppler Shift @ 100MHz"), ("Loss", "Signal Loss @ 100MHz"),
    ("Del", "Signal Delay"), ("MA", "Mean Anomaly"), ("Phase", "Orbit Phase"), ("Orbit", "Orbit Number"),
    ("Vis", "Visibility"), ("Decayed", "Decayed"), ("Status", "Operational Status"),
)
LIST_COLUMNS = tuple(t for t, _ in _LIST)
LIST_HINTS = dict(_LIST)
LIST_DEFAULT = ["Satellite", "Az", "El", "Dir", "Range", "Next Event", "Alt", "Orbit"]
LIST_SORT_DEFAULT = {"column": "Satellite", "ascending": True}

# §5 Map view: Contents (เรียงตาม preference page) และค่าตั้งต้น
MAP_CONTENTS = ("Satellite Name", "Satellite Footprint", "Satellite Marker", "QTH Info", "Next Event",
                "Cursor Position", "Grid Lines", "Solar Terminator")
MAP_DEFAULT_OFF = {"Cursor Position", "Solar Terminator"}
TRACK_ORBITS_RANGE = (1, 10)
TRACK_ORBITS_DEFAULT = 3
CENTER_LON_RANGE = (-180, 180)
CENTER_LON_DEFAULT = 0
DEFAULT_MAP = "nasa-bmng-07_1024.jpg"              # ภาพพื้นหลังตั้งต้น (ref-D §11, sat-cfg.c MAP_FILE)
MAP_FILE_RE = re.compile(r"[A-Za-z0-9_.-]{1,100}")  # ชื่อไฟล์ภาพ (ไม่มี path) ใน data/maps/ หรือของ Gpredict (ของเรา)
RGBA_MAX = 0xFFFFFFFF                              # สีเป็น int 0xRRGGBBAA
SHADOW_ALPHA_RANGE = (0, 255)
MAP_SHADOW_DEFAULT = 0xDD                          # "Shadow:" ความทึบของเงาใต้ดาว 0-255 (ref §5)
# สีตั้งต้นของ Map view เป็น 0xRRGGBBAA (ref §5, sat-cfg.c) ต้องเท่ากับ MAP_COLORS ใน web/src/colors.ts ชื่อสีตามไฟล์นั้น
MAP_COLOURS_DEFAULT = {
    "infoFg": 0x00FF00FF, "infoBg": 0x000000FF, "groundStation": 0x00FFFFFF, "satellite": 0xF0F000FF,
    "selected": 0xFFFFFFFF, "footprint": 0xFFFFFF1F, "grid": 0x7F7F7FC8, "terminator": 0xFFFF0080,
    "earthShadow": 0x00000060, "tick": 0x7F7F7FC8, "track": 0xFF1200BB,
}

# §6 Polar view
POLAR_ORIENTATIONS = ("N/E/S/W", "N/W/S/E", "S/E/N/W", "S/W/N/E")
POLAR_CONTENTS = ("Satellite Name", "Satellite Marker", "QTH Info", "Next Event", "Cursor Position", "Extra Az Ticks")
POLAR_DEFAULT_OFF = {"Extra Az Ticks"}
POLAR_AUTO_SKYTRACK_DEFAULT = False                # "Show the sky tracks automatically"
# สีตั้งต้นของ Polar view เป็น 0xRRGGBBAA (ref §6) ต้องเท่ากับ POLAR_COLORS ใน web/src/colors.ts
POLAR_COLOURS_DEFAULT = {
    "background": 0xFFFFFFFF, "axes": 0x0F0F0F7F, "tick": 0x007F00FF, "satellite": 0x8F0000FF,
    "selected": 0xFF0D0BFF, "track": 0x0000FFFF, "info": 0x00007FFF,
}

# หน้าต่างแยก (Detach) ของ module (ของเรา, หัวข้อ 8 ของ spec งานย่อย 4): state 0 = อยู่ในแท็บ, 1 = หน้าต่างแยก
# x, y = ตำแหน่ง (px, ≥ 0) width, height = ขนาด (px) None = ยังไม่เคยจำ
WINDOW_DEFAULT = {"state": 0, "x": None, "y": None, "width": None, "height": None}
WINDOW_STATE_RANGE = (0, 1)
WINDOW_SIZE_RANGE = (100, 10000)

# §7 Single-sat view: (ชื่อช่อง, hint)
_SINGLE = (
    ("Azimuth", "Azimuth of the satellite"), ("Elevation", "Elevation of the satellite"),
    ("Direction", "Direction of the satellite"), ("Right Asc.", "Right Ascension of the satellite"),
    ("Declination", "Declination of the satellite"), ("Slant Range", "The range between satellite and observer"),
    ("Range Rate", "The rate at which the Slant Range changes"), ("Next Event", "The time of next AOS or LOS"),
    ("Next AOS", "The time of next AOS"), ("Next LOS", "The time of next LOS"),
    ("SSP Lat.", "Latitude of the sub-satellite point"), ("SSP Lon.", "Longitude of the sub-satellite point"),
    ("SSP Loc.", "Sub-Satellite Point as Maidenhead grid square"), ("Footprint", "Diameter of the satellite footprint"),
    ("Altitude", "Altitude of the satellite"), ("Velocity", "Tangential velocity of the satellite"),
    ("Doppler@100M", "Doppler Shift @ 100MHz"), ("Sig. Loss", "Signal loss @ 100MHz"),
    ("Sig. Delay", "Signal Delay"), ("Mean Anom.", "Mean Anomaly"), ("Orbit Phase", "Orbit Phase"),
    ("Orbit Num.", "Orbit Number"), ("Visibility", "Visibility of the satellite"),
)
SINGLE_FIELDS = tuple(t for t, _ in _SINGLE)
SINGLE_HINTS = dict(_SINGLE)
SINGLE_DEFAULT = ["Azimuth", "Elevation", "Slant Range", "Range Rate", "Next Event", "SSP Loc.", "Footprint",
                  "Altitude", "Velocity", "Doppler@100M", "Sig. Loss", "Sig. Delay", "Mean Anom.", "Orbit Phase",
                  "Orbit Num.", "Visibility"]


# ---------- layout code ----------

@dataclass(frozen=True)
class ViewCell:
    """หนึ่งช่องของ layout: view ชนิด type วางบน grid ตั้งแต่คอลัมน์ left ถึง right และแถว top ถึง bottom"""
    type: int
    left: int
    right: int
    top: int
    bottom: int


_LAYOUT_INT = re.compile(r"[0-9]+")        # ไม่ใช้ int() ตรงๆ เพราะรับช่องว่าง + - และ _ ที่เราไม่ต้องการ


def parse_layout(code: str) -> list[ViewCell]:
    """layout code = กลุ่มละ 5 จำนวนเต็ม type;left;right;top;bottom คั่นด้วย ; ผิดรูปแบบ -> ValueError"""
    if not isinstance(code, str):
        raise ValueError("layout code ต้องเป็นข้อความ")
    parts = code.split(";")
    if not all(_LAYOUT_INT.fullmatch(p) for p in parts):
        raise ValueError("layout code ต้องเป็นจำนวนเต็มไม่ติดลบคั่นด้วย ;")
    if len(parts) % 5:
        raise ValueError("layout code ต้องเป็นกลุ่มละ 5 จำนวน (type;left;right;top;bottom)")
    cells = []
    for i in range(0, len(parts), 5):
        cell = ViewCell(*map(int, parts[i:i + 5]))
        if cell.type not in VIEW_TYPES:
            raise ValueError(f"ชนิด view {cell.type} ไม่มี (ต้องเป็น 0-4)")
        if cell.left >= cell.right or cell.top >= cell.bottom:
            raise ValueError(f"ช่องที่ {i // 5 + 1} ต้องมี left < right และ top < bottom")
        cells.append(cell)
    return cells


# ---------- ModuleConfig ----------

def _default_contents(names, off) -> dict[str, bool]:
    return {n: n not in off for n in names}


def _default_map() -> dict:
    return {"contents": _default_contents(MAP_CONTENTS, MAP_DEFAULT_OFF),
            "track_orbits": TRACK_ORBITS_DEFAULT, "center_lon": CENTER_LON_DEFAULT,
            "file": DEFAULT_MAP, "colours": dict(MAP_COLOURS_DEFAULT), "shadow_alpha": MAP_SHADOW_DEFAULT}


def _default_polar() -> dict:
    return {"orientation": POLAR_ORIENTATIONS[0], "contents": _default_contents(POLAR_CONTENTS, POLAR_DEFAULT_OFF),
            "auto_skytrack": POLAR_AUTO_SKYTRACK_DEFAULT, "colours": dict(POLAR_COLOURS_DEFAULT)}


@dataclass
class ModuleConfig:
    name: str
    qth: str | None = None                      # None = "** DEFAULT **" (ใช้สถานีตั้งต้น)
    satellites: list[int] = field(default_factory=list)   # NORAD
    layout_code: str = DEFAULT_LAYOUT_CODE
    refresh: dict = field(default_factory=lambda: dict(REFRESH_DEFAULT))
    list_columns: list[str] = field(default_factory=lambda: list(LIST_DEFAULT))
    list_sort: dict = field(default_factory=lambda: dict(LIST_SORT_DEFAULT))
    map: dict = field(default_factory=_default_map)
    polar: dict = field(default_factory=_default_polar)
    single: dict = field(default_factory=lambda: {"fields": list(SINGLE_DEFAULT), "selected": None})
    footprint_off: list[int] = field(default_factory=list)   # ดาวที่ปิด Highlight footprint (ตั้งต้นเปิดทุกดวง)
    ground_track: list[int] = field(default_factory=list)    # ดาวที่เปิด Ground Track
    sky_track: list[int] = field(default_factory=list)       # ดาวที่เปิด Sky track
    window: dict = field(default_factory=lambda: dict(WINDOW_DEFAULT))   # หน้าต่างแยก (ช่องของ module อย่างเดียว)


# ---------- ตรวจและสร้างจาก dict ----------

def _invalid(field_name: str, text: str) -> ApiError:
    return ApiError("MODULE_INVALID", 422, text, field_name)


def _is_int(v) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def _section(d: dict, key: str) -> dict:
    v = d.get(key, {})
    if not isinstance(v, dict):
        raise _invalid(key, f"{key} ต้องเป็น JSON object")
    return v


def _int_in(v, lo: int, hi: int, path: str, label: str, unit: str = "") -> int:
    if not _is_int(v) or not lo <= v <= hi:
        raise _invalid(path, f"{label} ({path}) ต้องเป็นจำนวนเต็มระหว่าง {lo} ถึง {hi}{unit}")
    return v


def _name_list(v, allowed: tuple, path: str, label: str) -> list[str]:
    if not isinstance(v, list) or not all(isinstance(n, str) and n in allowed for n in v):
        raise _invalid(path, f"{label} ({path}) ต้องเป็นรายการชื่อที่มีอยู่ ได้แก่ {', '.join(allowed)}")
    if len(set(v)) != len(v):
        raise _invalid(path, f"{label} ({path}) มีชื่อซ้ำ")
    return list(v)


def _flags(v, names: tuple, off: set, path: str, label: str) -> dict[str, bool]:
    """Contents: ชื่อ -> เปิด/ปิด ช่องที่ไม่ส่งมาใช้ค่าตั้งต้น ชื่อที่ไม่รู้จักหรือค่าที่ไม่ใช่ bool -> ผิด"""
    if not isinstance(v, dict):
        raise _invalid(path, f"{label} ({path}) ต้องเป็น JSON object ของชื่อ -> true/false")
    out = _default_contents(names, off)
    for k, val in v.items():
        if k not in out:
            raise _invalid(path, f"{label} ({path}) ไม่มีชื่อ {k!r} (มี {', '.join(names)})")
        if not isinstance(val, bool):
            raise _invalid(path, f"{label} ({path}) ค่าของ {k!r} ต้องเป็น true หรือ false")
        out[k] = val
    return out


def _colours(v, defaults: dict[str, int], path: str, label: str) -> dict[str, int]:
    """สี: ชื่อ -> int 0xRRGGBBAA ช่องที่ไม่ส่งมาใช้ค่าตั้งต้น ชื่อที่ไม่รู้จักหรือค่านอกช่วง -> ผิด"""
    if not isinstance(v, dict):
        raise _invalid(path, f"{label} ({path}) ต้องเป็น JSON object ของชื่อสี -> จำนวนเต็ม")
    out = dict(defaults)
    for k, val in v.items():
        if k not in defaults:
            raise _invalid(path, f"{label} ({path}) ไม่มีสีชื่อ {k!r} (มี {', '.join(defaults)})")
        out[k] = _int_in(val, 0, RGBA_MAX, f"{path}.{k}", f"สี {k} ของ {label}", " (0xRRGGBBAA)")
    return out


MAP_FILE_TEXT = "ต้องเป็นชื่อไฟล์ยาว 1-100 ตัวอักษร A-Z, a-z, ตัวเลข, _, . หรือ - (ไม่มี path)"


def is_map_file(v) -> bool:
    """ชื่อไฟล์ภาพแผนที่ที่รับ (ของ module และค่ารวม MODULES/MAP_FILE ใช้กติกาเดียวกัน): ตาม MAP_FILE_RE และไม่ใช่จุดล้วน"""
    return isinstance(v, str) and MAP_FILE_RE.fullmatch(v) is not None and set(v) != {"."}


def _map_file(v) -> str:
    if not is_map_file(v):
        raise _invalid("map.file", f"ภาพแผนที่ (map.file) {MAP_FILE_TEXT}")
    return v


def _window(given: dict) -> dict:
    window = dict(WINDOW_DEFAULT)
    if "state" in given:
        window["state"] = _int_in(given["state"], *WINDOW_STATE_RANGE, "window.state",
                                  "สถานะหน้าต่าง (0 = อยู่ในแท็บ, 1 = หน้าต่างแยก)")
    for key, label in (("x", "ตำแหน่งแนวนอนของหน้าต่าง"), ("y", "ตำแหน่งแนวตั้งของหน้าต่าง")):
        v = given.get(key)
        if v is not None:
            if not _is_int(v) or v < 0:
                raise _invalid(f"window.{key}", f"{label} (window.{key}) ต้องเป็น null หรือจำนวนเต็มตั้งแต่ 0 ขึ้นไป")
            window[key] = v
    for key, label in (("width", "ความกว้างของหน้าต่าง"), ("height", "ความสูงของหน้าต่าง")):
        v = given.get(key)
        if v is not None:
            window[key] = _int_in(v, *WINDOW_SIZE_RANGE, f"window.{key}", label, " px")
    return window


def _norad_subset(d: dict, key: str, label: str, satellites: list[int]) -> list[int]:
    v = d.get(key, [])
    if not isinstance(v, list) or not all(_is_int(n) for n in v):
        raise _invalid(key, f"{label} ({key}) ต้องเป็นรายการหมายเลข NORAD")
    if len(set(v)) != len(v) or not set(v) <= set(satellites):
        raise _invalid(key, f"{label} ({key}) ต้องไม่ซ้ำและเป็นดาวที่อยู่ใน satellites")
    return list(v)


def module_from_dict(d, qth_names: set[str] | None, norads: set[int] | None) -> ModuleConfig:
    """สร้างและตรวจ module จาก JSON ช่องที่ไม่มีใช้ค่าตั้งต้นของ Gpredict ช่องที่ไม่รู้จักถูกข้าม (รวม version, pin, unpin)

    qth_names / norads = ชื่อ QTH ที่มีอยู่ / NORAD ในดัชนีดาว (None = ไม่ตรวจการมีอยู่ ใช้ตอนอ่านไฟล์ที่เก็บไว้)
    ผิด -> 422 MODULE_INVALID (object = ชื่อช่อง) ดาวเกิน MAX_SATS -> 422 MODULE_TOO_MANY_SATS
    """
    if not isinstance(d, dict):
        raise ApiError("MODULE_INVALID", 422, "ข้อมูล module ต้องเป็น JSON object")

    name = d.get("name")
    if not (isinstance(name, str) and NAME_RE.fullmatch(name)):
        raise _invalid("name", "ชื่อ module (name) ต้องเป็นตัวอักษร A-Z, a-z, ตัวเลข, _ หรือ - ยาว 1-25 ตัว")

    qth = d.get("qth")
    if qth is not None and not (isinstance(qth, str) and (qth_names is None or qth in qth_names)):
        raise _invalid("qth", f"สถานี (qth) ต้องเป็น null (สถานีตั้งต้น) หรือชื่อ QTH ที่มีอยู่ แต่ได้ {qth!r}")

    sats = d.get("satellites")
    if not isinstance(sats, list) or not sats:
        raise _invalid("satellites", "ต้องเลือกดาวอย่างน้อย 1 ดวง (satellites)")
    if len(sats) > MAX_SATS:
        raise ApiError("MODULE_TOO_MANY_SATS", 422,
                       f"module มีดาวได้ไม่เกิน {MAX_SATS} ดวง แต่เลือกมา {len(sats)} ดวง (satellites)", "satellites")
    for n in sats:
        if not _is_int(n) or n < 1:
            raise _invalid("satellites", f"หมายเลข NORAD ใน satellites ต้องเป็นจำนวนเต็มบวก แต่ได้ {n!r}")
        if norads is not None and n not in norads:
            raise _invalid("satellites", f"NORAD {n} ไม่อยู่ในดัชนีดาว (satellites)")
    if len(set(sats)) != len(sats):
        raise _invalid("satellites", "satellites มี NORAD ซ้ำ")
    sats = list(sats)

    layout_code = d.get("layout_code", DEFAULT_LAYOUT_CODE)
    try:
        parse_layout(layout_code)
    except ValueError as e:
        raise _invalid("layout_code", f"layout code (layout_code) ไม่ถูกต้อง: {e}") from None

    refresh = dict(REFRESH_DEFAULT)
    given = _section(d, "refresh")
    for key in REFRESH_DEFAULT:
        if key in given:
            lo, hi = DATA_MS_RANGE if key == "data_ms" else CYCLE_RANGE
            refresh[key] = _int_in(given[key], lo, hi, f"refresh.{key}", REFRESH_LABELS[key],
                                   " msec" if key == "data_ms" else " cycle")

    list_columns = (_name_list(d["list_columns"], LIST_COLUMNS, "list_columns", "คอลัมน์ของ List view")
                    if "list_columns" in d else list(LIST_DEFAULT))
    list_sort = dict(LIST_SORT_DEFAULT)
    given = _section(d, "list_sort")
    if "column" in given:
        if not (isinstance(given["column"], str) and given["column"] in LIST_COLUMNS):
            raise _invalid("list_sort.column", f"คอลัมน์ที่เรียง (list_sort.column) ต้องเป็นหนึ่งใน {', '.join(LIST_COLUMNS)}")
        list_sort["column"] = given["column"]
    if "ascending" in given:
        if not isinstance(given["ascending"], bool):
            raise _invalid("list_sort.ascending", "ทิศที่เรียง (list_sort.ascending) ต้องเป็น true หรือ false")
        list_sort["ascending"] = given["ascending"]

    map_cfg = _default_map()
    given = _section(d, "map")
    if "contents" in given:
        map_cfg["contents"] = _flags(given["contents"], MAP_CONTENTS, MAP_DEFAULT_OFF, "map.contents",
                                     "Contents ของ Map view")
    if "track_orbits" in given:
        map_cfg["track_orbits"] = _int_in(given["track_orbits"], *TRACK_ORBITS_RANGE, "map.track_orbits",
                                          "จำนวน orbit ของ ground track", " orbit")
    if "center_lon" in given:
        map_cfg["center_lon"] = _int_in(given["center_lon"], *CENTER_LON_RANGE, "map.center_lon",
                                        "ลองจิจูดกลางแผนที่", " องศา")
    if "file" in given:
        map_cfg["file"] = _map_file(given["file"])
    if "colours" in given:
        map_cfg["colours"] = _colours(given["colours"], MAP_COLOURS_DEFAULT, "map.colours", "Map view")
    if "shadow_alpha" in given:
        map_cfg["shadow_alpha"] = _int_in(given["shadow_alpha"], *SHADOW_ALPHA_RANGE, "map.shadow_alpha",
                                          "ความทึบของเงาใต้ดาว (Shadow)")

    polar = _default_polar()
    given = _section(d, "polar")
    if "orientation" in given:
        if given["orientation"] not in POLAR_ORIENTATIONS:
            raise _invalid("polar.orientation", f"ทิศของ Polar view (polar.orientation) ต้องเป็นหนึ่งใน {', '.join(POLAR_ORIENTATIONS)}")
        polar["orientation"] = given["orientation"]
    if "contents" in given:
        polar["contents"] = _flags(given["contents"], POLAR_CONTENTS, POLAR_DEFAULT_OFF, "polar.contents",
                                   "Contents ของ Polar view")
    if "auto_skytrack" in given:
        if not isinstance(given["auto_skytrack"], bool):
            raise _invalid("polar.auto_skytrack", "การแสดง sky track อัตโนมัติ (polar.auto_skytrack) ต้องเป็น true หรือ false")
        polar["auto_skytrack"] = given["auto_skytrack"]
    if "colours" in given:
        polar["colours"] = _colours(given["colours"], POLAR_COLOURS_DEFAULT, "polar.colours", "Polar view")

    single = {"fields": list(SINGLE_DEFAULT), "selected": None}
    given = _section(d, "single")
    if "fields" in given:
        single["fields"] = _name_list(given["fields"], SINGLE_FIELDS, "single.fields", "ช่องของ Single-sat view")
    selected = given.get("selected")
    if selected is not None:
        if not _is_int(selected) or selected not in sats:
            raise _invalid("single.selected", "ดาวที่เลือก (single.selected) ต้องเป็น null หรือ NORAD ที่อยู่ใน satellites")
        single["selected"] = selected

    return ModuleConfig(
        name=name, qth=qth, satellites=sats, layout_code=layout_code, refresh=refresh,
        list_columns=list_columns, list_sort=list_sort, map=map_cfg, polar=polar, single=single,
        footprint_off=_norad_subset(d, "footprint_off", "ดาวที่ปิด footprint", sats),
        ground_track=_norad_subset(d, "ground_track", "ดาวที่เปิด Ground Track", sats),
        sky_track=_norad_subset(d, "sky_track", "ดาวที่เปิด Sky track", sats),
        window=_window(_section(d, "window")))


def module_to_dict(m: ModuleConfig) -> dict:
    """dict ของ JSON ที่เก็บและส่งทาง API (สำเนาลึก ไม่ใช้ร่วมกับ m)"""
    return asdict(m)


# ---------- การสืบทอดค่า ----------

OWN_VERSION = 2                       # "version" ของไฟล์ module ที่เก็บเฉพาะค่าที่ตั้งเอง (v1 = ไฟล์เต็มแบบ core)

# หน้าของ Module properties / Preferences → Modules: path ของค่า (คั่นด้วย . ส่วนสุดท้ายมีช่องว่างได้) -> key ของ Gpredict
# ชื่อ key ตรงกับ prefs.PREFS (test_module เทียบ key และค่าตั้งต้นของทั้งสองฝั่ง) ลำดับตามหน้า Preferences ของ Gpredict
_PAGES: dict[str, dict[str, str]] = {
    "layout": {"layout_code": "MODULES/GRID"},
    "refresh": {f"refresh.{name}": f"MODULES/{key}" for name, key in (
        ("data_ms", "DATA_TIMEOUT"), ("list", "LIST_REFRESH"), ("map", "MAP_REFRESH"), ("polar", "POLAR_REFRESH"),
        ("single", "SINGLE_SAT_REFRESH"), ("event", "EVENT_LIST_REFRESH"))},
    "list": {"list_columns": "MODULES/LIST_COLUMNS"},
    "map": {
        **{f"map.contents.{name}": f"MODULES/{key}" for name, key in zip(
            MAP_CONTENTS, ("MAP_SAT_NAME", "MAP_SAT_FOTPRINT", "MAP_SAT_MARKER", "MAP_QTH_INFO", "MAP_NEXT_EVENT",
                           "MAP_CURSOR_TRACK", "MAP_SHOW_GRID", "MAP_SHOW_TERMINATOR"), strict=True)},
        "map.track_orbits": "MODULES/MAP_TRACK_NUM", "map.center_lon": "MODULES/MAP_CENTER",
        "map.file": "MODULES/MAP_FILE", "map.shadow_alpha": "MODULES/MAP_SHADOW_ALPHA",
        **{f"map.colours.{name}": f"MODULES/{key}" for name, key in (
            ("groundStation", "MAP_QTH_COLOUR"), ("grid", "MAP_GRID_COLOUR"), ("tick", "MAP_TICK_COLOUR"),
            ("satellite", "MAP_SAT_COLOUR"), ("selected", "MAP_SELECTED_SAT_COLOUR"), ("track", "MAP_TRACK_COLOUR"),
            ("footprint", "MAP_COV_AREA_COLOUR"), ("infoFg", "MAP_INFO_COLOUR"), ("infoBg", "MAP_INFO_BGD_COLOUR"),
            ("terminator", "MAP_TERMINATOR_COLOUR"), ("earthShadow", "MAP_EARTH_SHADOW_COLOUR"))},
    },
    "polar": {
        "polar.orientation": "MODULES/POLAR_CHART_ORIENT",
        **{f"polar.contents.{name}": f"MODULES/{key}" for name, key in zip(
            POLAR_CONTENTS, ("POLAR_SAT_NAME", "POLAR_SAT_MARKER", "POLAR_QTH_INFO", "POLAR_NEXT_EVENT",
                             "POLAR_CURSOR_TRACK", "POLAR_EXTRA_AZ_TICKS"), strict=True)},
        "polar.auto_skytrack": "MODULES/POLAR_SHOW_TRACK_AUTO",
        **{f"polar.colours.{name}": f"MODULES/{key}" for name, key in (
            ("background", "POLAR_BGD_COLOUR"), ("axes", "POLAR_AXIS_COLOUR"), ("tick", "POLAR_TICK_COLOUR"),
            ("satellite", "POLAR_SAT_COLOUR"), ("selected", "POLAR_SELECTED_SAT_COL"), ("track", "POLAR_TRACK_COLOUR"),
            ("info", "POLAR_INFO_COLOUR"))},
    },
    "single": {"single.fields": "MODULES/SINGLE_SAT_FIELDS"},
}
PAGE_PATHS: dict[str, tuple[str, ...]] = {page: tuple(paths) for page, paths in _PAGES.items()}
MODULE_KEYS: dict[str, str] = {path: key for paths in _PAGES.values() for path, key in paths.items()}

# key ที่หน้า Layout ของกลุ่ม Modules เขียนเพิ่มจาก MODULES/GRID (Window Placements, ref-D §10) ไม่เกี่ยวกับ module ใด
GLOBAL_LAYOUT_EXTRA = ("GLOBAL/MAIN_WIN_POS", "GLOBAL/MOD_WIN_POS", "GLOBAL/MOD_STATE")

# ช่องของ module อย่างเดียว: เก็บในไฟล์เสมอ ไม่สืบทอด (window เปลี่ยนได้ทาง PUT /api/modules/{name}/window เท่านั้น)
_OWN_ONLY = ("name", "qth", "satellites", "list_sort", "single.selected", "footprint_off", "ground_track", "sky_track",
             "window")
# ค่าของช่องข้างบนที่ใช้เมื่อไม่มีใครให้มา (name และ satellites ไม่มีค่าตั้งต้น ปล่อยให้ module_from_dict ปฏิเสธ)
_OWN_DEFAULTS = {"qth": None, "list_sort": LIST_SORT_DEFAULT, "single.selected": None, "footprint_off": [],
                 "ground_track": [], "sky_track": [], "window": WINDOW_DEFAULT}

_MISSING = object()                   # "ไม่มีค่า" (ต่างจาก None ซึ่งเป็นค่าจริง เช่น qth)
_RAISE = object()


def get_path(d: dict, path: str, default=_RAISE):
    """ค่าที่ path (เช่น "map.contents.Satellite Name") ไม่มี (รวมถึงกลางทางไม่ใช่ dict) -> KeyError หรือ default ถ้าส่งมา"""
    cur = d
    for part in path.split("."):
        if not isinstance(cur, dict) or part not in cur:
            if default is _RAISE:
                raise KeyError(path)
            return default
        cur = cur[part]
    return cur


def set_path(d: dict, path: str, v) -> None:
    """ตั้งค่าที่ path สร้าง dict กลางทางให้ (กลางทางที่ไม่ใช่ dict ถูกแทน)"""
    *parents, last = path.split(".")
    cur = d
    for part in parents:
        nxt = cur.get(part)
        if not isinstance(nxt, dict):
            nxt = cur[part] = {}
        cur = nxt
    cur[last] = v


def del_path(d: dict, path: str) -> None:
    """ลบค่าที่ path พร้อม dict กลางทางที่ว่างเพราะการลบ path ที่ไม่มีไม่ทำอะไร"""
    parts = path.split(".")
    chain = [d]
    for part in parts[:-1]:
        nxt = chain[-1].get(part)
        if not isinstance(nxt, dict):
            return
        chain.append(nxt)
    if parts[-1] not in chain[-1]:
        return
    del chain[-1][parts[-1]]
    for part, parent, child in reversed(list(zip(parts[:-1], chain, chain[1:]))):
        if child:
            break
        del parent[part]


def _first(path: str, *sources):
    for src in sources:
        v = get_path(src, path, _MISSING)
        if v is not _MISSING:
            return v
    return _MISSING


def _need_dict(v, what: str) -> None:
    if not isinstance(v, dict):
        raise ApiError("MODULE_INVALID", 422, f"{what} ต้องเป็น JSON object")


def _path_set(v, field_name: str) -> set[str]:
    """pin / unpin: รายการ path ที่สืบทอดได้ (อยู่ใน MODULE_KEYS) ไม่งั้น 422 MODULE_INVALID"""
    if isinstance(v, (str, bytes)) or not isinstance(v, Iterable):
        raise _invalid(field_name, f"{field_name} ต้องเป็นรายการ path")
    out = set()
    for p in v:
        if not isinstance(p, str) or p not in MODULE_KEYS:
            raise _invalid(field_name, f"{field_name} ต้องเป็น path ของค่าที่ module สืบทอดได้ แต่ได้ {p!r}")
        out.add(p)
    return out


def _copy_own_only(out: dict, sources: tuple, window_sources: tuple) -> None:
    """ใส่ช่องของ module อย่างเดียวลง out จากแหล่งแรกที่มี (ไม่มีทุกแหล่งใช้ _OWN_DEFAULTS) ช่อง window ใช้ window_sources"""
    for path in _OWN_ONLY:
        v = _first(path, *(window_sources if path == "window" else sources))
        if v is _MISSING:
            if path not in _OWN_DEFAULTS:
                continue
            v = _OWN_DEFAULTS[path]
        set_path(out, path, copy.deepcopy(v))


def effective_dict(own: dict, globals_: Mapping[str, object]) -> dict:
    """ค่าที่ module ใช้จริงเป็น dict รูปเดียวกับ module_to_dict: ช่องของ module อย่างเดียวจาก own, ค่าที่สืบทอดได้ใช้ของ module
    ถ้าตั้งไว้ ไม่งั้นค่ารวม globals_[key ของ Gpredict] ไม่งั้นค่าตั้งต้นของ Gpredict (ผ่าน module_from_dict ต่อเพื่อตรวจ)"""
    base = module_to_dict(ModuleConfig(name=""))
    out: dict = {}
    for path in _OWN_ONLY:
        v = get_path(own, path, _MISSING)
        if v is not _MISSING:
            set_path(out, path, copy.deepcopy(v))
    for path, key in MODULE_KEYS.items():
        v = get_path(own, path, _MISSING)
        if v is _MISSING:
            v = globals_.get(key, _MISSING)
        if v is _MISSING:
            v = get_path(base, path)
        set_path(out, path, copy.deepcopy(v))
    return out


def own_dict(body: dict, old_own: dict | None, pin: Iterable[str], unpin: Iterable[str]) -> dict:
    """ค่าที่เก็บในไฟล์ module (version 2) เมื่อบันทึก body (ค่าเต็มแบบ module_to_dict) ทับ old_own (None = module ใหม่)

    - ช่องของ module อย่างเดียวเก็บเสมอ ยกเว้น window: ใช้ของ old_own ไม่ก็ค่าตั้งต้น ไม่เอาจาก body
    - ค่าที่สืบทอดได้เก็บเมื่อ path อยู่ใน pin หรืออยู่ใน old_own แล้ว (ใช้ค่าจาก body) นอกนั้นข้ามเพราะยังสืบทอดอยู่
      (ค่าเก่าที่หน้าเว็บถือไว้จึงไม่ตรึงค่ารวมโดยไม่ตั้งใจ) path ใน unpin ถูกลบ
    - pin / unpin ต้องเป็น path ใน MODULE_KEYS และไม่ซ้ำกันสองฝั่ง ไม่งั้น 422 MODULE_INVALID
    """
    _need_dict(body, "ข้อมูล module")
    pinned, unpinned = _path_set(pin, "pin"), _path_set(unpin, "unpin")
    both = sorted(pinned & unpinned)
    if both:
        raise _invalid("unpin", f"path อยู่ทั้งใน pin และ unpin: {', '.join(both)}")
    out: dict = {"version": OWN_VERSION}
    _copy_own_only(out, (body, old_own), (old_own,))
    for path in MODULE_KEYS:
        if path in unpinned or (path not in pinned and get_path(old_own, path, _MISSING) is _MISSING):
            continue
        v = _first(path, body, old_own)
        if v is _MISSING:
            raise _invalid(path, f"ตรึงค่า ({path}) ไม่ได้ เพราะไม่มีค่าส่งมา")
        set_path(out, path, copy.deepcopy(v))
    return out


def _same(a, b) -> bool:
    return type(a) is type(b) and a == b          # True ไม่เท่ากับ 1


def strip_defaults(v1: dict, defaults: Mapping[str, object]) -> dict:
    """แปลงไฟล์ module แบบเต็ม (version 1 ของ core) เป็นแบบเก็บเฉพาะค่าที่ตั้งเอง: ลบ path ที่ค่าเท่ากับ defaults[key ของ Gpredict]
    ส่วนที่เหลือคงไว้ (ช่องของ module อย่างเดียวเก็บเสมอ ไม่มี window ใช้ค่าตั้งต้น) path ที่ไม่มีในไฟล์เดิมก็ไม่ใส่
    ให้ค่าที่ใช้จริงไม่เปลี่ยนต้องส่งค่ารวมที่ใช้อยู่ตอนนั้นเป็น defaults (ถ้ายังไม่มีใครตั้งค่ารวมก็คือค่าตั้งต้นของ Gpredict)"""
    _need_dict(v1, "ข้อมูล module")
    out: dict = {"version": OWN_VERSION}
    _copy_own_only(out, (v1,), (v1,))
    for path, key in MODULE_KEYS.items():
        v = get_path(v1, path, _MISSING)
        if v is _MISSING or (key in defaults and _same(v, defaults[key])):
            continue
        set_path(out, path, copy.deepcopy(v))
    return out
