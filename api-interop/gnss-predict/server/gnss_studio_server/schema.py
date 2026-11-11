"""schema ของ scenario.json ฉบับเต็ม (หัวข้อ 5.1 ของ spec server) ด้วย pydantic

- ตรวจรูปแบบและค่าที่เลือกได้ (`Literal[...]` ด้วยคำของ STK ตรงตัว) ของทุกช่องที่หน้าจอใช้ ช่องของ engine
  (ช่วงเวลา, step_s ที่หารลงตัว, ชื่อ object ไม่ซ้ำ ฯลฯ) ตรวจซ้ำด้วย `gnss_predict.scenario.load_scenario` อีกชั้นใน store
- ทุก model รับช่องที่ไม่รู้จัก (`extra="allow"`) ผลตรวจใช้แค่บอกถูกหรือผิด สิ่งที่เก็บลงดิสก์คือเอกสารของ client ตรงตัว
  ช่องที่ไม่รู้จักทุกระดับจึงไม่หาย
- `objects` เป็น discriminated union ตามช่อง `class`; ค่าผิดแปลงเป็น `ApiError` 422 ที่ `field` ใช้รูปแบบ path เดียวกับ engine
  เช่น `objects[0].position.lat_deg`
"""

import re
from collections.abc import Callable
from datetime import date, datetime
from typing import Annotated, Any, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints, ValidationError, ValidationInfo, field_validator

from .errors import ApiError

FORMAT = "gnss-studio-scenario/1"
NAME_PATTERN = r"^[A-Za-z0-9_-]{1,32}$"
NAME_RE = re.compile(NAME_PATTERN)
OBJECT_CLASSES = ("Facility", "Satellite", "Constellation")
_UTC_Z_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$")

# ค่าที่เลือกได้ (คำของ STK ตรงตัว)
MarkerStyle = Literal["Point", "Plus", "Star", "Square", "Circle", "Diamond", "Triangle", "Cross"]
LineStyle = Literal["Solid", "Dashed", "Dotted", "Dot Dashed", "Long Dashed", "Dash Dot Dot", "Medium Dashed", "Short Dashed"]
LeadType = Literal["Time", "Percent", "Quarter", "Half", "Full", "All", "None", "One Pass", "Current Interval"]
TrailType = Literal["Time", "Percent", "Quarter", "Half", "Full", "All", "None", "One Pass", "Current Interval",
                    "Same As Lead"]


def parse_utc_z(value: str) -> datetime:
    """เวลา UTC แบบ ISO 8601 ลงท้าย Z (ข้อกำหนดของ API: เวลาทุกค่าลงท้าย Z) เป็น datetime ที่มีเขตเวลา UTC รับเศษวินาทีได้
    รูปแบบผิดหรือไม่มีจริง -> ValueError"""
    if not _UTC_Z_RE.fullmatch(value):
        raise ValueError("ต้องเป็นเวลา UTC แบบ ISO 8601 ลงท้าย Z เช่น 2026-11-12T00:00:00Z")
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise ValueError("อ่านเวลานี้ไม่ได้") from None


def _utc_z(value: str) -> str:
    parse_utc_z(value)
    return value


DAY_TEXT = "วันที่ต้องอยู่ในรูปแบบ YYYY-MM-DD"


def check_day(value: Any, field: str) -> str:
    """วันที่แบบ YYYY-MM-DD ที่มีอยู่จริง (ไม่รับ YYYYMMDD ที่ Python 3.11+ รับ) ผิด -> ApiError 422 SCENARIO_INVALID ที่ `field`
    ใช้ร่วมกันระหว่างค่า `day` ของ job validate กับ path `/validation/{sc}/{day}`"""
    try:
        if not isinstance(value, str) or date.fromisoformat(value).isoformat() != value:
            raise ValueError(value)
    except ValueError:
        raise ApiError(422, "SCENARIO_INVALID", DAY_TEXT, field) from None
    return value


UtcZ = Annotated[str, AfterValidator(_utc_z)]
Name = Annotated[str, StringConstraints(pattern=NAME_PATTERN)]
Color = Annotated[str, StringConstraints(pattern=r"^#[0-9a-fA-F]{6}$")]
ObjectPath = Annotated[str, StringConstraints(pattern=r"^\*/(Facility|Satellite|Constellation)/[A-Za-z0-9_-]{1,32}$")]
LtzOffset = Annotated[str, StringConstraints(pattern=r"^[+-]\d{2}:\d{2}$")]


class _Model(BaseModel):
    model_config = ConfigDict(extra="allow", strict=True)


# ---------- ระดับ scenario ----------

class AnalysisPeriod(_Model):
    start: str                         # engine ตรวจรูปแบบ ลำดับ และความยาว (field `analysis_period`)
    stop: str


class Ionosphere(_Model):
    shell_km: float = Field(400.0, gt=0, allow_inf_nan=False)


class SatelliteFilter(_Model):
    show_too_old: bool = False
    show_no_broadcast: bool = False


class Animation(_Model):
    start: UtcZ | None = None
    time_step_s: float = Field(60.0, gt=0, allow_inf_nan=False)
    update_mode: Literal["time_step", "real_time", "x_real_time"] = "time_step"
    x_real_time_multiplier: float = Field(60.0, gt=0, allow_inf_nan=False)
    cycle: Literal["off", "stop", "loop"] = "loop"


class Units(_Model):
    date_format: Literal["UTCG", "LTZG"] = "UTCG"
    ltz_offset: LtzOffset = "+07:00"
    distance: Literal["km"] = "km"
    angle: Literal["deg"] = "deg"


class Graphics2DGlobal(_Model):
    show_labels: bool = True


# ---------- object ----------

class Position(_Model):
    type: Literal["Geodetic"] = "Geodetic"
    lat_deg: float = Field(ge=-90, le=90, allow_inf_nan=False)
    lon_deg: float = Field(ge=-180, le=180, allow_inf_nan=False)
    alt_m: float = Field(allow_inf_nan=False)


class FacilityConstraints(_Model):
    elevation_angle_min_deg: float = Field(0.0, ge=-90, le=90, allow_inf_nan=False)
    elevation_angle_max_deg: float | None = Field(None, ge=-90, le=90, allow_inf_nan=False)


class Graphics2DFac(_Model):
    show: bool = True
    color: Color | None = None
    marker_style: MarkerStyle | None = None
    inherit: bool = True


class Graphics3DFac(_Model):
    show: bool = True


class PassSettings(_Model):
    lead_type: LeadType = "Time"
    lead_time_s: float | None = Field(None, ge=0, allow_inf_nan=False)
    lead_percent: float | None = Field(None, ge=0, le=100, allow_inf_nan=False)
    trail_type: TrailType = "Time"
    trail_time_s: float | None = Field(None, ge=0, allow_inf_nan=False)
    trail_percent: float | None = Field(None, ge=0, le=100, allow_inf_nan=False)
    visible_sides: Literal["Both", "Ascending", "Descending"] = "Both"
    show_pass_labels: bool = False
    show_path_labels: bool = False


class SwathSettings(_Model):
    type: Literal["Ground Elevation"] = "Ground Elevation"
    elevation_deg: float = Field(10.0, ge=0, le=90, allow_inf_nan=False)
    options: Literal["No Graphics", "Edge Limits", "Filled Limits"] = "No Graphics"


class Graphics2DSat(_Model):
    show: bool = True
    color: Color | None = None
    line_style: LineStyle | None = None
    line_width: float | None = Field(None, gt=0, allow_inf_nan=False)
    marker_style: MarkerStyle | None = None
    inherit: bool = True
    pass_: PassSettings | None = Field(None, alias="pass")
    swath: SwathSettings | None = None


class Graphics3DSat(_Model):
    show: bool = True
    orbit_system: Literal["Fixed by Window", "Inertial by Window"] = "Fixed by Window"


class FacilityObj(_Model):
    class_: Literal["Facility"] = Field(alias="class")
    name: Name
    description: str = ""
    position: Position
    constraints: FacilityConstraints | None = None
    graphics2d: Graphics2DFac | None = None
    graphics3d: Graphics3DFac | None = None


class SatelliteObj(_Model):
    class_: Literal["Satellite"] = Field(alias="class")
    name: Name
    norad: int = Field(gt=0)
    description: str = ""
    graphics2d: Graphics2DSat | None = None
    graphics3d: Graphics3DSat | None = None


class ConstellationObj(_Model):
    class_: Literal["Constellation"] = Field(alias="class")
    name: Name
    system: Literal["G", "R", "E", "C"] | None = None
    description: str = ""
    color: Color | None = None
    assigned_objects: list[ObjectPath] = []


SceneObject = Annotated[FacilityObj | SatelliteObj | ConstellationObj, Field(discriminator="class_")]


def _not_blank(value: str) -> str:
    if not value.strip():
        raise ValueError("ชื่อกลุ่มต้องไม่ว่าง")
    return value


class Group(_Model):
    """โฟลเดอร์ใน Object Browser: ชื่อเป็นข้อความอิสระ (มีช่องว่างได้ เช่น "GPS sats") ไม่ใช่ชื่อ object จึงไม่ใช้ NAME_PATTERN
    ต้องไม่ว่างและไม่ซ้ำกันแบบไม่สนตัวพิมพ์เล็กใหญ่ (ตรวจความไม่ซ้ำใน `validate_scenario`)"""
    name: Annotated[str, StringConstraints(min_length=1), AfterValidator(_not_blank)]
    members: list[ObjectPath] = []


# ---------- access ----------

class AccessTimePeriod(_Model):
    """mode `specify` ต้องมีทั้ง start และ stop และ start ต้องมาก่อน stop (ผิดที่ช่อง start ที่ขาด หรือช่อง stop ที่ขาดหรือไม่เลย start)
    mode `object` ไม่ใช้ start/stop จึงไม่ตรวจ"""
    mode: Literal["object", "specify"] = "object"      # Use Object Time Period / Specify Time Period
    start: UtcZ | None = Field(None, validate_default=True)
    stop: UtcZ | None = Field(None, validate_default=True)

    @field_validator("start", mode="after")
    @classmethod
    def _start_given_when_specify(cls, value: str | None, info: ValidationInfo) -> str | None:
        if value is None and info.data.get("mode") == "specify":
            raise ValueError("ต้องมีค่าเมื่อ mode เป็น specify")
        return value

    @field_validator("stop", mode="after")
    @classmethod
    def _stop_after_start_when_specify(cls, value: str | None, info: ValidationInfo) -> str | None:
        if info.data.get("mode") != "specify":
            return value
        if value is None:
            raise ValueError("ต้องมีค่าเมื่อ mode เป็น specify")
        start = info.data.get("start")                 # ไม่มี = start ผิดเอง รายงานที่ช่อง start แล้ว
        if start is not None and parse_utc_z(start) >= parse_utc_z(value):
            raise ValueError("stop ต้องอยู่หลัง start")
        return value


class AccessGraphics(_Model):
    show: bool = True
    static_highlight: bool = False
    animate_highlight: bool = False
    animate_line: bool = True
    color_mode: Literal["object", "custom"] = "object"  # Use Object Colors / Use Custom Color
    custom_color: Color | None = None
    inherit: bool = True


class AccessDef(_Model):
    from_: ObjectPath = Field(alias="from")
    to: list[ObjectPath]
    time_period: AccessTimePeriod | None = None
    graphics: AccessGraphics | None = None
    timeline: bool = True
    computed: bool = False


class DailyInfo(_Model):
    for_date: str
    created_utc: UtcZ


class ScenarioDoc(_Model):
    format: Literal["gnss-studio-scenario/1"]
    name: Name
    description: str = ""
    analysis_period: AnalysisPeriod
    step_s: int = Field(30, ge=1, le=3600)
    orbit_snapshot: Name
    ionosphere: Ionosphere | None = None
    satellite_filter: SatelliteFilter | None = None
    animation: Animation | None = None
    units: Units | None = None
    graphics2d_global: Graphics2DGlobal | None = None
    objects: list[SceneObject]
    groups: list[Group] = []
    accesses: list[AccessDef] = []
    styles: list[Any] = []
    daily: DailyInfo | None = None


# ---------- แปลงผลตรวจเป็น ApiError ----------

_TAGGED_ERRORS = ("union_tag_invalid", "union_tag_not_found")
_RANGE_ERRORS = ("greater_than", "greater_than_equal", "less_than", "less_than_equal")


def field_path(loc: tuple) -> str:
    """loc ของ pydantic -> path แบบเดียวกับ engine: ดัชนี `[i]`, จุดคั่นชื่อ, ตัดชื่อ class ของ union ที่แทรกหลังดัชนี object"""
    parts = list(loc)
    if len(parts) >= 3 and parts[0] == "objects" and isinstance(parts[1], int) and parts[2] in OBJECT_CLASSES:
        del parts[2]
    out = ""
    for part in parts:
        if isinstance(part, int):
            out += f"[{part}]"
        else:
            out += f".{part}" if out else str(part)
    return out


def _reason(error: dict) -> str:
    kind = error["type"]
    if kind == "missing":
        return "ต้องมีค่า"
    if kind in _TAGGED_ERRORS:
        return "class ต้องเป็น Facility, Satellite หรือ Constellation"
    if kind == "literal_error":
        expected = str(error.get("ctx", {}).get("expected", "")).replace(" or ", " หรือ ")
        return f"ต้องเป็นหนึ่งใน {expected}"
    if kind in _RANGE_ERRORS:
        return "ค่าอยู่นอกช่วงที่กำหนด"
    if kind == "string_pattern_mismatch":
        return "รูปแบบไม่ถูกต้อง"
    if kind == "value_error":
        return error["msg"].removeprefix("Value error, ")
    if kind == "finite_number":
        return "ต้องเป็นตัวเลขที่จำกัดค่า"
    if kind in ("model_type", "model_attributes_type", "dict_type"):
        return "ต้องเป็น object"
    if kind.endswith(("_type", "_parsing")):
        return "ชนิดของค่าไม่ถูกต้อง"
    return "ค่าไม่ถูกต้อง"


def to_api_error(exc: ValidationError) -> ApiError:
    """ApiError 422 SCENARIO_INVALID จากข้อผิดพลาดแรกของ pydantic (`detail` เก็บข้อความเดิมของ pydantic)"""
    first = exc.errors(include_url=False, include_input=False, include_context=True)[0]
    loc = tuple(first["loc"])
    if first["type"] in _TAGGED_ERRORS:
        loc += ("class",)
    field = field_path(loc)
    return ApiError(422, "SCENARIO_INVALID", f"scenario.json ช่อง {field}: {_reason(first)}", field, first["msg"])


OBJECT_MODELS = {"Facility": FacilityObj, "Satellite": SatelliteObj, "Constellation": ConstellationObj}


def validate_object(cls: str, obj: Any, field_of: Callable[[str], str] = lambda field: field) -> None:
    """ตรวจ object เดี่ยวด้วย model ของ class นั้น (ใช้กับ Insert และ Apply ของ Properties Browser) ผิด -> ApiError 422
    `field` เป็น path ภายใน object (เช่น `position.lat_deg`) ส่งผ่าน `field_of` ก่อน เมื่อหน้าจอเรียกช่องต่างจากชื่อใน scenario.json"""
    try:
        OBJECT_MODELS[cls].model_validate(obj)
    except ValidationError as exc:
        first = exc.errors(include_url=False, include_input=False, include_context=True)[0]
        field = field_of(field_path(tuple(first["loc"])))
        raise ApiError(422, "SCENARIO_INVALID", f"ช่อง {field}: {_reason(first)}", field, first["msg"]) from None


def validate_scenario(doc: Any) -> None:
    """ตรวจเอกสารทั้งก้อน ผิดแล้ว raise ApiError (ไม่แก้ doc ไม่คืนสำเนา)"""
    if not isinstance(doc, dict):
        raise ApiError(422, "SCENARIO_INVALID", "scenario.json ราก JSON ต้องเป็น object", "<file>")
    try:
        parsed = ScenarioDoc.model_validate(doc)
    except ValidationError as exc:
        raise to_api_error(exc) from None
    seen: set[str] = set()
    for i, group in enumerate(parsed.groups):
        key = group.name.casefold()
        if key in seen:
            raise ApiError(422, "SCENARIO_INVALID", f"scenario.json ช่อง groups[{i}].name: ชื่อกลุ่ม '{group.name}' ซ้ำกับกลุ่มก่อนหน้า "
                           "(ไม่แยกตัวพิมพ์เล็กใหญ่)", f"groups[{i}].name", "duplicate group name")
        seen.add(key)
