"""แม่แบบของ New Scenario Wizard (หัวข้อ 6.3 ของ spec server, ข้อตัดสินใจ P5)

- `thbk-gnss`: Facility THBK + ดาวทุกดวงใน catalog ที่มี PRN (ชื่อดาว = PRN) + Constellation 4 ระบบ + access จาก THBK ไปทั้ง 4 ระบบ
  + โฟลเดอร์ใน Object Browser ละระบบ (`GPS sats`, `GLONASS sats`, `Galileo sats`, `BeiDou sats`)
- `empty`: ไม่มี object, access และกลุ่ม
- `snapshot` ที่ไม่ระบุใช้โฟลเดอร์ใต้ `<data>/orbits/` ที่ใหม่ที่สุด (ชื่อ `YYYYMMDDTHHMMZ`; `_cache` ไม่นับ)
"""

import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from gnss_predict.catalog import Catalog, build_catalog
from gnss_predict.config import GNSS_GROUPS, SHELL_KM, STEP_S

from .errors import ApiError
from .schema import FORMAT, NAME_RE

ORBITS_DIR = "orbits"
SNAPSHOT_RE = re.compile(r"\d{8}T\d{4}Z", re.ASCII)

FACILITY_COLOR = "#ff79e6"
THBK = {"name": "THBK", "lat_deg": 13.729779, "lon_deg": 100.781151, "alt_m": 6.4, "elevation_angle_min_deg": 10.0}
# (ตัวอักษรระบบ, ชื่อ Constellation, สีตั้งต้น) ตามลำดับที่ใช้ใน access และใน groups (โฟลเดอร์ "<ชื่อ> sats" ละระบบ)
CONSTELLATIONS = (
    ("G", "GPS", "#ffd23f"),
    ("R", "GLONASS", "#ff6b6b"),
    ("E", "Galileo", "#4fd47e"),
    ("C", "BeiDou", "#45c8ff"),
)
SYSTEM_COLORS = {system: color for system, _, color in CONSTELLATIONS}
DEFAULT_COLOR = "#cccccc"                    # สีตั้งต้นของ object ที่ไม่มีสีของระบบ (Constellation ผสมหลายระบบ, ดาวที่กำหนดเอง)
ANIMATION_TIME_STEP_S = 60
ANIMATION_X_REAL_TIME = 60
DEFAULT_PASS_S = 1800
DEFAULT_SWATH_ELEVATION_DEG = 10.0
ACCESS_CUSTOM_COLOR = "#9dff6b"
SENSOR_COLOR = "#e8c547"
SENSOR_CONE_HALF_ANGLE_DEG = 45.0            # ค่าตั้งต้นของ STK


def parse_utc(value: str | datetime, field: str) -> datetime:
    """เวลา UTC แบบ ISO 8601 เป็นวินาทีเต็ม ผิด -> ApiError 422 ที่ field นั้น"""
    if isinstance(value, datetime):
        parsed = value
    else:
        try:
            parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            raise ApiError(422, "SCENARIO_INVALID", f"อ่านเวลา '{value}' ไม่ได้ ต้องเป็น ISO 8601 UTC ลงท้าย Z เช่น 2026-11-12T00:00:00Z",
                           field) from None
    if parsed.tzinfo is None:
        raise ApiError(422, "SCENARIO_INVALID", f"เวลา '{value}' ไม่ระบุเขตเวลา ต้องลงท้าย Z (UTC)", field)
    try:
        parsed = parsed.astimezone(timezone.utc)
    except OverflowError:
        raise ApiError(422, "SCENARIO_INVALID", f"เวลา '{value}' อยู่นอกช่วงที่รองรับ", field) from None
    if parsed.microsecond:
        raise ApiError(422, "SCENARIO_INVALID", f"เวลา '{value}' ต้องเป็นวินาทีเต็ม (ไม่มีเศษวินาที)", field)
    return parsed


def iso_utc(t: datetime) -> str:
    """เวลา UTC ISO 8601 เป็นวินาทีเต็ม ลงท้าย Z"""
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


def snapshot_time(name: str) -> datetime | None:
    """เวลา UTC ที่อยู่ในชื่อ snapshot `YYYYMMDDTHHMMZ` หรือ None ถ้าชื่อไม่ตรงรูปแบบหรือเป็นวันเวลาที่ไม่มีจริง"""
    if not SNAPSHOT_RE.fullmatch(name):
        return None
    try:
        return datetime(int(name[0:4]), int(name[4:6]), int(name[6:8]), int(name[9:11]), int(name[11:13]), tzinfo=timezone.utc)
    except ValueError:
        return None


def snapshot_names(data_dir: Path) -> list[str]:
    """ชื่อ snapshot ใต้ `<data>/orbits/` เรียงใหม่สุดก่อน นับเฉพาะโฟลเดอร์ที่ชื่อเป็น `YYYYMMDDTHHMMZ` ของวันเวลาที่มีจริง
    (`_cache` และชื่ออื่นไม่นับ) ไม่มีโฟลเดอร์ orbits หรืออ่านไม่ได้ = รายการว่าง"""
    try:
        names = [p.name for p in (Path(data_dir) / ORBITS_DIR).iterdir() if snapshot_time(p.name) is not None and p.is_dir()]
    except OSError:
        return []
    return sorted(names, reverse=True)


def latest_snapshot(data_dir: Path) -> str | None:
    """ชื่อ snapshot ที่ใหม่ที่สุดใต้ `<data>/orbits/` หรือ None ถ้ายังไม่มี"""
    names = snapshot_names(data_dir)
    return names[0] if names else None


def resolve_snapshot(data_dir: Path, snapshot: str | None) -> str:
    """ชื่อ snapshot ที่ใช้จริง ไม่ระบุ = ใหม่สุด ไม่มีเลย -> ORBIT_SOURCE_UNAVAILABLE ชื่อที่ระบุแต่ไม่มี -> 422 field snapshot"""
    if snapshot is None:
        found = latest_snapshot(data_dir)
        if found is None:
            raise ApiError(422, "ORBIT_SOURCE_UNAVAILABLE",
                           "ยังไม่มี snapshot ข้อมูลวงโคจร ให้ดึงข้อมูลวงโคจร (Utilities → Fetch Orbit Data) ก่อนสร้าง scenario", "snapshot")
        return found
    if not NAME_RE.fullmatch(snapshot) or snapshot.startswith("_") or not (Path(data_dir) / ORBITS_DIR / snapshot).is_dir():
        raise ApiError(422, "SCENARIO_INVALID", f"ไม่พบ snapshot ข้อมูลวงโคจร {snapshot}", "snapshot")
    return snapshot


def facility(name: str, lat_deg: float, lon_deg: float, alt_m: float, elevation_angle_min_deg: float) -> dict:
    """Facility พร้อมกราฟิกตั้งต้น (ใช้ทั้งแม่แบบและ Insert ของ Object Browser)"""
    return {"class": "Facility", "name": name, "description": "",
            "position": {"type": "Geodetic", "lat_deg": lat_deg, "lon_deg": lon_deg, "alt_m": alt_m},
            "constraints": {"elevation_angle_min_deg": elevation_angle_min_deg},
            "graphics2d": {"show": True, "color": FACILITY_COLOR, "marker_style": "Triangle", "inherit": True},
            "graphics3d": {"show": True}}


def satellite(name: str, norad: int, color: str) -> dict:
    """ดาวพร้อมกราฟิกตั้งต้น (ชื่อดาวจาก catalog คือ PRN)"""
    return {"class": "Satellite", "name": name, "norad": norad, "description": "",
            "graphics2d": {"show": True, "color": color, "line_style": "Solid", "line_width": 1, "marker_style": "Square",
                           "inherit": True,
                           "pass": {"lead_type": "Time", "lead_time_s": DEFAULT_PASS_S, "trail_type": "Time",
                                    "trail_time_s": DEFAULT_PASS_S, "visible_sides": "Both", "show_pass_labels": False,
                                    "show_path_labels": False},
                           "swath": {"type": "Ground Elevation", "elevation_deg": DEFAULT_SWATH_ELEVATION_DEG,
                                     "options": "No Graphics"}},
            "graphics3d": {"show": True, "orbit_system": "Fixed by Window"}}


def sensor(name: str, parent: str, cone_half_angle: float = SENSOR_CONE_HALF_ANGLE_DEG) -> dict:
    """Sensor ของดาว `parent` (path `*/Satellite/<ชื่อ>`) พร้อมค่าตั้งต้นของ STK: Simple Conic, ชี้ Fixed Az 0 El 90 (ตรงลงโลก) ใช้ทั้ง
    Insert Default และเป็นฐานให้ Define Properties ผสมค่าที่ผู้ใช้ส่ง"""
    return {"class": "Sensor", "name": name, "parent": parent, "description": "", "long_description": "",
            "definition": {"type": "Simple Conic", "cone_half_angle": cone_half_angle},
            "pointing": {"type": "Fixed", "orientation": "Az-El", "azimuth": 0.0, "elevation": 90.0, "about_boresight": "Rotate"},
            "graphics2d": {"show": True, "color": SENSOR_COLOR, "fill": False, "fill_translucency": 50},
            "graphics3d": {"show": True, "color": SENSOR_COLOR, "show_radial_lines": True, "show_boresight_marker": False}}


def constellation(name: str, system: str | None, color: str, assigned_objects: list[str]) -> dict:
    """Constellation ของเรา system เป็น None เมื่อสมาชิกมาจากหลายระบบหรือยังไม่มีสมาชิก"""
    return {"class": "Constellation", "name": name, "system": system, "description": "", "color": color,
            "assigned_objects": assigned_objects}


def access_graphics() -> dict:
    """กราฟิกตั้งต้นของ access (ใช้ทั้งแม่แบบและ Compute ของ Access tool)"""
    return {"show": True, "static_highlight": False, "animate_highlight": False, "animate_line": True,
            "color_mode": "object", "custom_color": ACCESS_CUSTOM_COLOR, "inherit": True}


def load_catalog(data_dir: Path, snapshot: str, start: datetime, stop: datetime, field: str = "snapshot") -> Catalog:
    """catalog ของทุกระบบที่มีไฟล์ OMM ใน snapshot (ช่วงเวลากำหนด PRN ที่ใช้ ณ ต้นช่วง) ไม่มี snapshot หรือไม่มีไฟล์ OMM เลย
    -> ApiError 422 ORBIT_SOURCE_UNAVAILABLE ที่ field นั้น"""
    snapshot_dir = Path(data_dir) / ORBITS_DIR / snapshot
    systems = {system for system, group in GNSS_GROUPS.items() if (snapshot_dir / f"{group}.json").is_file()}
    if not systems:
        raise ApiError(422, "ORBIT_SOURCE_UNAVAILABLE", f"snapshot {snapshot} ไม่มีอยู่หรือไม่มีไฟล์ข้อมูลวงโคจร (OMM) ของระบบใดเลย", field)
    return build_catalog(snapshot_dir, (start, stop), systems)


def _thbk_gnss_content(data_dir: Path, snapshot: str, start: datetime,
                       stop: datetime) -> tuple[list[dict], list[dict], list[dict]]:
    """(objects, accesses, groups) ของแม่แบบ thbk-gnss groups = โฟลเดอร์ใน Object Browser ละระบบ สมาชิกเรียงเหมือน assigned_objects"""
    catalog = load_catalog(data_dir, snapshot, start, stop)

    objects: list[dict] = [facility(**THBK)]
    members: dict[str, list[str]] = {system: [] for system, _, _ in CONSTELLATIONS}
    for sat in catalog.satellites:
        if sat.system not in SYSTEM_COLORS:
            continue
        objects.append(satellite(sat.prn, sat.norad, SYSTEM_COLORS[sat.system]))
        members[sat.system].append(f"*/Satellite/{sat.prn}")
    for system, name, color in CONSTELLATIONS:
        objects.append(constellation(name, system, color, members[system]))
    groups = [{"name": f"{name} sats", "members": list(members[system])} for system, name, _ in CONSTELLATIONS]
    accesses = [{"from": f"*/Facility/{THBK['name']}", "to": [f"*/Constellation/{name}" for _, name, _ in CONSTELLATIONS],
                 "time_period": {"mode": "object"}, "graphics": access_graphics(), "timeline": True, "computed": False}]
    return objects, accesses, groups


def new_scenario(name: str, start: str | datetime, stop: str | datetime, template: Literal["thbk-gnss", "empty"],
                 snapshot: str | None, data_dir: Path) -> dict:
    """เอกสาร scenario.json ใหม่ตามแม่แบบ (ยังไม่เขียนลงดิสก์) ตรวจเวลาและ snapshot ก่อน ส่วนช่วงวิเคราะห์ที่ผิดกติกาให้ store ตรวจด้วย engine"""
    start_t, stop_t = parse_utc(start, "start"), parse_utc(stop, "stop")
    snapshot = resolve_snapshot(data_dir, snapshot)
    if template == "thbk-gnss":
        objects, accesses, groups = _thbk_gnss_content(data_dir, snapshot, start_t, stop_t)
    elif template == "empty":
        objects, accesses, groups = [], [], []
    else:
        raise ApiError(422, "SCENARIO_INVALID", f"ไม่รู้จักแม่แบบ {template} (ใช้ thbk-gnss หรือ empty)", "template")
    return {
        "format": FORMAT,
        "name": name,
        "description": "",
        "analysis_period": {"start": iso_utc(start_t), "stop": iso_utc(stop_t)},
        "step_s": STEP_S,
        "orbit_snapshot": snapshot,
        "ionosphere": {"shell_km": SHELL_KM},
        "satellite_filter": {"show_too_old": False, "show_no_broadcast": False},
        "animation": {"start": iso_utc(start_t), "time_step_s": ANIMATION_TIME_STEP_S, "update_mode": "time_step",
                      "x_real_time_multiplier": ANIMATION_X_REAL_TIME, "cycle": "loop"},
        "units": {"date_format": "UTCG", "ltz_offset": "+07:00", "distance": "km", "angle": "deg"},
        "graphics2d_global": {"show_labels": True},
        "objects": objects,
        "groups": groups,
        "accesses": accesses,
        "styles": [],
    }
