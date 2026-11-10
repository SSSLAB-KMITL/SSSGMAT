"""อ่านและตรวจ `scenario.json` ของ GNSS Studio เฉพาะช่องที่ engine ใช้คำนวณ (หัวข้อ 5.6 ของ spec engine, 7.2 ของ spec หลัก)

- ช่องที่ไม่รู้จักถูกข้ามโดยไม่ error (ช่องอื่นเป็นของหน้าเว็บ)
- ผิดข้อใดให้ raise `ScenarioError` ที่ระบุ path ของช่อง เช่น `objects[0].position.lat_deg`
  ความผิดระดับไฟล์ (ไม่มีไฟล์, JSON เสีย, รากไม่ใช่ object) ใช้ field `<file>`
- ค่าตั้งต้นเมื่อไม่มีช่อง: `ionosphere.shell_km` = SHELL_KM, `satellite_filter.*` = False,
  `constraints.elevation_angle_min_deg` = 0.0 (D5: STK ไม่มี constraint ตั้งต้น)
- ชื่อ object ต้องตรง `^[A-Za-z0-9_-]{1,32}$` (D6) เพราะใช้เป็นชื่อโฟลเดอร์และ id ของ CZML และต้องไม่ซ้ำกัน
  (นับทุก class รวม Constellation)
- เฉพาะ class Facility และ Satellite ที่ส่งต่อให้ engine ตามลำดับใน `objects`
"""

import json
import math
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .config import SHELL_KM
from .errors import ScenarioError

FORMAT = "gnss-studio-scenario/1"
MAX_PERIOD = timedelta(days=7)
MAX_STEP_S = 3600
SECONDS_PER_DAY = 86400
_SAFE_NAME = re.compile(r"[A-Za-z0-9_-]{1,32}")
FILE_FIELD = "<file>"


@dataclass(frozen=True)
class Facility:
    name: str
    lat_deg: float
    lon_deg: float
    alt_m: float
    min_el_deg: float


@dataclass(frozen=True)
class EngineScenario:
    name: str
    start: datetime
    stop: datetime
    step_s: int
    orbit_snapshot: str
    shell_km: float
    show_too_old: bool
    show_no_broadcast: bool
    facilities: list[Facility]
    satellites: list[tuple[str, int]]   # (name, norad)


def _fail(field: str, text: str) -> ScenarioError:
    return ScenarioError(f"scenario.json ช่อง {field}: {text}", field)


def _is_number(value) -> bool:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    try:
        return math.isfinite(float(value))
    except OverflowError:       # จำนวนเต็มใหญ่เกิน float
        return False


def _number(parent: dict, key: str, path: str, *, lo: float | None = None, hi: float | None = None,
            positive: bool = False) -> float:
    """ช่องบังคับที่เป็นตัวเลขจำกัดค่า (ไม่รับ bool, NaN, Infinity)"""
    value = parent.get(key)
    field = f"{path}.{key}"
    if value is None:
        raise _fail(field, "ต้องมีค่า")
    if not _is_number(value):
        raise _fail(field, "ต้องเป็นตัวเลข")
    if positive and value <= 0:
        raise _fail(field, "ต้องมากกว่า 0")
    if lo is not None and hi is not None and not lo <= value <= hi:
        raise _fail(field, f"ต้องอยู่ระหว่าง {lo:g} ถึง {hi:g}")
    return float(value)


def _section(parent: dict, key: str, path: str) -> dict:
    """ส่วนที่ไม่บังคับ: ไม่มีหรือเป็น null ได้ {} แต่ถ้ามีต้องเป็น object"""
    value = parent.get(key)
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise _fail(f"{path}.{key}" if path else key, "ต้องเป็น object")
    return value


def _flag(parent: dict, key: str, path: str) -> bool:
    value = parent.get(key)
    if value is None:
        return False
    if not isinstance(value, bool):
        raise _fail(f"{path}.{key}", "ต้องเป็น true หรือ false")
    return value


def _parse_time(parent: dict, key: str, path: str) -> datetime:
    field = f"{path}.{key}"
    value = parent.get(key)
    if not isinstance(value, str):
        raise _fail(field, "ต้องเป็นเวลา UTC แบบ ISO 8601 ลงท้าย Z เช่น 2026-11-12T00:00:00Z")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise _fail(field, f"อ่านเวลา '{value}' ไม่ได้ ต้องเป็นรูปแบบ ISO 8601 ลงท้าย Z") from None
    if parsed.tzinfo is None:
        raise _fail(field, f"เวลา '{value}' ไม่ระบุเขตเวลา ต้องลงท้าย Z (UTC)")
    try:
        return parsed.astimezone(timezone.utc)
    except OverflowError:
        raise _fail(field, f"เวลา '{value}' อยู่นอกช่วงที่รองรับ") from None


def _safe_name(value, field: str) -> str:
    if not isinstance(value, str) or not _SAFE_NAME.fullmatch(value):
        raise _fail(field, "ชื่อต้องเป็นตัวอักษร A-Z a-z ตัวเลข _ หรือ - ยาว 1 ถึง 32 ตัว")
    return value


def _read_json(path: Path) -> dict:
    try:
        text = Path(path).read_text(encoding="utf-8")
    except FileNotFoundError:
        raise _fail(FILE_FIELD, f"ไม่พบไฟล์ {path}") from None
    except (OSError, UnicodeDecodeError) as exc:
        raise _fail(FILE_FIELD, f"อ่านไฟล์ {path} ไม่ได้ ({exc.__class__.__name__})") from None
    try:
        data = json.loads(text)
    except ValueError as exc:
        raise _fail(FILE_FIELD, f"ไฟล์ {path} ไม่ใช่ JSON ที่ถูกต้อง ({exc})") from None
    if not isinstance(data, dict):
        raise _fail(FILE_FIELD, "ราก JSON ต้องเป็น object")
    return data


def _facility(obj: dict, name: str, path: str) -> Facility:
    position = obj.get("position")
    if not isinstance(position, dict):
        raise _fail(f"{path}.position", "Facility ต้องมี position เป็น object")
    pos = f"{path}.position"
    lat = _number(position, "lat_deg", pos, lo=-90.0, hi=90.0)
    lon = _number(position, "lon_deg", pos, lo=-180.0, hi=180.0)
    alt = _number(position, "alt_m", pos)
    constraints = _section(obj, "constraints", path)
    if constraints.get("elevation_angle_min_deg") is None:
        min_el = 0.0
    else:
        min_el = _number(constraints, "elevation_angle_min_deg", f"{path}.constraints", lo=-90.0, hi=90.0)
    return Facility(name, lat, lon, alt, min_el)


def _satellite(obj: dict, name: str, path: str) -> tuple[str, int]:
    norad = obj.get("norad")
    if isinstance(norad, bool) or not isinstance(norad, int) or norad <= 0:
        raise _fail(f"{path}.norad", "NORAD ต้องเป็นจำนวนเต็มบวก")
    return name, norad


def load_scenario(path: Path) -> EngineScenario:
    data = _read_json(path)

    if data.get("format") != FORMAT:
        raise _fail("format", f"ต้องเป็น '{FORMAT}'")

    name = data.get("name")
    if not isinstance(name, str) or not name:
        raise _fail("name", "ต้องเป็นข้อความที่ไม่ว่าง")

    period = data.get("analysis_period")
    if not isinstance(period, dict):
        raise _fail("analysis_period", "ต้องมี start และ stop")
    start = _parse_time(period, "start", "analysis_period")
    stop = _parse_time(period, "stop", "analysis_period")
    if not start < stop:
        raise _fail("analysis_period", "เวลาเริ่มต้องอยู่ก่อนเวลาจบ")
    if stop - start > MAX_PERIOD:
        raise _fail("analysis_period", "ช่วงวิเคราะห์ต้องไม่เกิน 7 วัน")

    step_s = data.get("step_s")
    if isinstance(step_s, bool) or not isinstance(step_s, int):
        raise _fail("step_s", "ต้องเป็นจำนวนเต็มวินาที")
    if not 1 <= step_s <= MAX_STEP_S or SECONDS_PER_DAY % step_s:
        raise _fail("step_s", "ต้องอยู่ระหว่าง 1 ถึง 3600 และหาร 86400 ลงตัว")

    snapshot = data.get("orbit_snapshot")
    if not isinstance(snapshot, str) or not _SAFE_NAME.fullmatch(snapshot):
        raise _fail("orbit_snapshot", "ต้องเป็นชื่อ snapshot เช่น 20261111T0600Z (ใช้เป็นชื่อโฟลเดอร์)")

    iono = _section(data, "ionosphere", "")
    shell_km = SHELL_KM if iono.get("shell_km") is None else _number(iono, "shell_km", "ionosphere", positive=True)
    flt = _section(data, "satellite_filter", "")
    show_too_old = _flag(flt, "show_too_old", "satellite_filter")
    show_no_broadcast = _flag(flt, "show_no_broadcast", "satellite_filter")

    objects = data.get("objects")
    if not isinstance(objects, list):
        raise _fail("objects", "ต้องเป็นรายการ")
    facilities: list[Facility] = []
    satellites: list[tuple[str, int]] = []
    seen: set[str] = set()
    for i, obj in enumerate(objects):
        path_i = f"objects[{i}]"
        if not isinstance(obj, dict):
            raise _fail(path_i, "ต้องเป็น object")
        cls = obj.get("class")
        if not isinstance(cls, str):
            raise _fail(f"{path_i}.class", "ต้องระบุ class เป็นข้อความ")
        obj_name = _safe_name(obj.get("name"), f"{path_i}.name")
        if obj_name in seen:
            raise _fail(f"{path_i}.name", f"ชื่อ '{obj_name}' ซ้ำกับ object ก่อนหน้า")
        seen.add(obj_name)
        if cls == "Facility":
            facilities.append(_facility(obj, obj_name, path_i))
        elif cls == "Satellite":
            satellites.append(_satellite(obj, obj_name, path_i))
        # Constellation และ class อื่นที่ไม่รู้จัก engine ไม่ใช้

    return EngineScenario(name, start, stop, step_s, snapshot, shell_km, show_too_old, show_no_broadcast,
                          facilities, satellites)
