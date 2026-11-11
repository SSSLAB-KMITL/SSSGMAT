"""Module (หัวข้อ 7.1 ของ spec): ค่าตั้งต้นและช่วงค่าตาม Gpredict 2.7 (ref §3-§7), layout code และการตรวจ module

ชื่อคอลัมน์ ชื่อช่อง และ hint ทุกตัวคัดมาจาก reference ตรงตัว (ตัวพิมพ์ เครื่องหมาย) เพราะ web ใช้เป็นป้ายและ tooltip
"""

import re
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

# §6 Polar view
POLAR_ORIENTATIONS = ("N/E/S/W", "N/W/S/E", "S/E/N/W", "S/W/N/E")
POLAR_CONTENTS = ("Satellite Name", "Satellite Marker", "QTH Info", "Next Event", "Cursor Position", "Extra Az Ticks")
POLAR_DEFAULT_OFF = {"Extra Az Ticks"}

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
            "track_orbits": TRACK_ORBITS_DEFAULT, "center_lon": CENTER_LON_DEFAULT}


def _default_polar() -> dict:
    return {"orientation": POLAR_ORIENTATIONS[0], "contents": _default_contents(POLAR_CONTENTS, POLAR_DEFAULT_OFF),
            "auto_skytrack": False}


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


def _norad_subset(d: dict, key: str, label: str, satellites: list[int]) -> list[int]:
    v = d.get(key, [])
    if not isinstance(v, list) or not all(_is_int(n) for n in v):
        raise _invalid(key, f"{label} ({key}) ต้องเป็นรายการหมายเลข NORAD")
    if len(set(v)) != len(v) or not set(v) <= set(satellites):
        raise _invalid(key, f"{label} ({key}) ต้องไม่ซ้ำและเป็นดาวที่อยู่ใน satellites")
    return list(v)


def module_from_dict(d, qth_names: set[str] | None, norads: set[int] | None) -> ModuleConfig:
    """สร้างและตรวจ module จาก JSON ช่องที่ไม่มีใช้ค่าตั้งต้นของ Gpredict ช่องที่ไม่รู้จักถูกข้าม

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
        sky_track=_norad_subset(d, "sky_track", "ดาวที่เปิด Sky track", sats))


def module_to_dict(m: ModuleConfig) -> dict:
    """dict ของ JSON ที่เก็บและส่งทาง API (สำเนาลึก ไม่ใช้ร่วมกับ m)"""
    return asdict(m)
