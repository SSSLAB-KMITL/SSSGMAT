"""Data provider, ข้อมูล และ style ของรายงาน/กราฟ (หัวข้อ 6.7 ของ spec server) route แค่เรียก engine (`dataproviders`, `report_style`)

- `GET /scenarios/{sc}/dataproviders?class=&name=`: `[{name, groups, elements: [{name, unit, kind, interp}], uses, ours}]` ของชนิด object
  (Facility, Satellite, Access) ชนิดอื่นรวม Constellation ได้ `[]` `name` ไม่ระบุ (หรือว่าง) = รายการของชนิดนั้นเฉย ๆ ระบุแล้ว object ต้องมีใน scenario
  Facility/Satellite ใช้ชื่อเปล่า (`THBK`) หรือ path (`*/Facility/THBK`) Access ใช้ path คู่ตาม P1 (`*/Facility/THBK */Satellite/G01`)
  ไม่พบหรือไม่ตรงชนิด: 422 ที่ `name` ไม่ต้องมีผลลัพธ์ (ถามได้ก่อน Compute)
- `GET /scenarios/{sc}/data?object=&provider=&group=&elements=&start=&stop=&step=` (`elements` ซ้ำได้): `{columns: [{name, unit, kind}], rows}`
  แถวเรียงตาม `elements` เวลาเป็น ISO มิลลิวินาทีลงท้าย Z ไม่มีค่า = null `group` ว่าง = ไม่ระบุ (engine เลือก group แรก) `start`/`stop` ไม่ระบุทั้งคู่
  = ช่วงวิเคราะห์ ระบุข้างเดียวหรือผิดรูป: 422 ที่ `time.start`/`time.stop` `step` (วินาที) ว่างหรือไม่ระบุ = ทุกจุดของ scenario ผิด: 422 ที่ `time.step`
  ผลลัพธ์ไม่ตรงกับ scenario หรือยังไม่มี: 409 `RESULTS_NOT_CURRENT` (แปลงใน errors.py) ชื่อ provider/group/element ผิด: 422 `STYLE_INVALID`
- `GET /styles?object_type=&scenario=`: `{installed, my, scenario}` กรองตาม `object_type` ถ้าระบุ `scenario` ไม่ระบุ = `[]`
  Scenario Styles อยู่ใน `styles` ของ scenario.json (เขียนผ่าน `PUT /scenarios/{sc}` เดิม P4) ที่นี่แค่อ่าน ข้ามรายการที่ไม่ใช่ object
- `POST /styles/{name}` (สร้าง ซ้ำ 409), `PUT` (สร้างหรือแทน), `DELETE` (204 ไม่มี 404): My Styles ใน `data/styles/` body คือ style JSON ที่ `name` ต้องเท่ากับ path
  ชื่อผิดกฎ P5 หรือ name ไม่ตรง path: 422 `STYLE_INVALID` ที่ `name` เนื้อหาผิด (`check_style`): 422 `STYLE_INVALID` ที่ช่องนั้น เช่น `content[0].elements[0]`
  ชื่อซ้ำกับ Installed Styles (ไม่แยกตัวพิมพ์) หรือกับ My Style ที่มีอยู่: 409 `NAME_EXISTS` ที่ `name` (ชื่อซ้ำกับ Scenario Style เป็นเรื่องของหน้าเว็บ ที่รู้ scenario)
  path เป็น `{name:path}` เพื่อให้ `a/b` ถึง route แล้วตอบ 422 (ไม่ใช่ 404) และชื่อถูกตรวจก่อนสร้าง path ทุกครั้ง

- `POST /scenarios/{sc}/reports` `{style, kind?, objects[], time?, format, dynamic, export?}`: รายงานหรือกราฟของ style กับ object ที่เลือก
  `format` `json` (`report_json` ของ engine) หรือไฟล์ `txt` / `csv` (`text/plain` / `text/csv` charset utf-8 พร้อม `Content-Disposition: attachment`
  ชื่อไฟล์จาก `report_filename`) DateFormat/LTZ ของไฟล์มาจาก `units` ของ scenario `export` (ตัวคั่น ฯลฯ) ใช้กับ csv เท่านั้นแต่ตรวจทุก format
  - style: Scenario Styles → My Styles → Installed Styles (ไม่สนตัวพิมพ์) `kind` ไม่ระบุ = report ก่อน ไม่พบ/เสีย: 422 `STYLE_INVALID`
    (`style` หรือช่องในตัว style เช่น `content[0].elements[1]`) `dynamic: true` กับ style ที่ `dynamic: false`: 422 ที่ `dynamic`
    ช่อง `dynamic` ในคำตอบคือที่ขอ (ไม่ใช่ที่ style รองรับ)
  - เวลา: `time` ไม่ส่ง = ใช้ `time` ของ style (`specify` ในตัว style ถูกแปลงเป็น start/stop/step ที่นี่ เพราะ engine ไม่อ่าน) ส่งแล้วตามคำขอทั้งก้อน
    `mode: object` = Use Object Time Period: object แบบ Access ที่ access ครอบมัน (`to` ตรงดาวพอดี หรือเป็น Constellation ที่มีดาวนี้ ขยายแบบ
    `GET /access/intervals` เพื่อให้ตรงกับ Timeline) มี `time_period` mode `specify` ใช้ช่วงนั้น (ไม่ต้องคำนวณใหม่ spec §4) ไม่งั้นช่วงวิเคราะห์
    `start`/`stop` ใน mode นี้ไม่ใช้ (เหมือน `time_period` ของ access)
    `mode: specify` ต้องมี start และ stop (422 `time.start` / `time.stop`) และ start < stop (422 `time.start`) step ไม่ใช่จำนวนเท่าหรือ ≤ 0: 422 `time.step`
    หลาย object ที่ช่วงที่เก็บต่างกันตัดเป็นรายงานเดียวไม่ได้ (Global Statistics รวมแถวทุก object): 422 ที่ `objects`
  - object เลือกจาก Facility ได้ไม่เกิน 4 แห่งต่อ request (ชื่อไม่แยกตัวพิมพ์ ดาวไม่นับ): เกิน 422 ที่ `objects` (ตารางตรึงพร้อมกัน แห่งละราว 135 MB)
  - ผลลัพธ์ไม่ตรงกับ scenario หรือยังไม่มี: 409 `RESULTS_NOT_CURRENT` (ตรวจหลังตรวจคำขอทุกข้อ)
  - ตารางของ request เดียวถูกตรึง (`PinnedTables`): cache ของ server มี 4 bundle แต่รายงานหลาย Facility ใช้ ephem 1 + access N bundle
    ถ้าไม่ตรึงจะอ่านซ้ำใน request เดียว

ข้อมูลอ่านจาก bundle ที่ `current` เท่านั้น (`server_result_set`) ผ่าน `PlanCache` (hash ของ plan ไม่คำนวณซ้ำต่อ request) กับ `app.state.tables`
(ตารางที่อ่านแล้วต่อ bundle) ไม่เรียก `open_result_set` ของ engine ซึ่งคำนวณ hash ใหม่ทุกครั้ง (0.42-0.45 วินาทีกับข้อมูลจริง)
route ที่อ่านดิสก์เป็น `def` ธรรมดา (รันใน thread pool)
"""

import logging
import math
import re
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Literal

from fastapi import APIRouter, Depends, Query, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from gnss_predict.dataproviders import (PROVIDERS, ProviderInfo, ResultSet, TableCache, list_providers, object_period,
                                        parse_object, provider_rows)
from gnss_predict.errors import ScenarioError, StyleError
from gnss_predict.report_format import (ExportSetup, format_csv, format_txt, report_filename, report_json,
                                        time_format_of)
from gnss_predict.report_style import build_report, check_style, installed_styles, resolve_style
from gnss_predict.scenario import EngineScenario, load_scenario

from .. import access
from ..errors import ApiError
from ..jobs import iso_ms
from ..objects import path_of
from ..plans import PlanCache
from ..schema import UtcZ, parse_utc_z
from ..store import SCENARIO_FILE, ScenarioStore
from ..styles import MyStyles, check_name
from . import get_logger, get_my_styles, get_plans, get_store, get_tables
from .results import ACCESS_DIR, EPHEM_DIR, access_entries, ephem_entry

router = APIRouter()

INVALID = "SCENARIO_INVALID"
STEP_RE = re.compile(r"-?[0-9]{1,9}")


# ---------- ผลลัพธ์ของ scenario ----------

def server_result_set(store: ScenarioStore, plans: PlanCache, tables: TableCache, sc: str) -> ResultSet:
    """`ResultSet` ของ scenario ที่ประกอบจาก plan ที่แคชไว้ (ไม่คำนวณ hash ใหม่) เฉพาะ bundle ที่ status `current` และยังมีบนดิสก์
    ephem หรือ access ของ Facility ที่ไม่ current = ไม่ใส่ (engine ตอบ `ResultsNotCurrentError` เมื่อแถวนั้นต้องใช้)
    ไม่มี scenario: ApiError 404 scenario.json อ่านไม่ได้: ScenarioError (422) สถานะของ bundle ตรวจจากดิสก์ทุกครั้ง ที่แคชไว้มีแค่ hash"""
    directory = store.path(sc)
    plan = plans.get(sc)                                   # ไม่มี scenario -> 404
    scenario = load_scenario(directory / SCENARIO_FILE)
    ephem = ephem_entry(directory, plan)
    ephem_dir = directory / EPHEM_DIR / ephem["hash"] if ephem["status"] == "current" else None
    access_dirs = {name: directory / ACCESS_DIR / name / entry["hash"]
                   for name, entry in access_entries(directory, plan).items() if entry["status"] == "current"}
    return ResultSet(scenario, ephem_dir, access_dirs, tables)


class PinnedTables(TableCache):
    """ตารางของ request เดียวที่ตรึงไว้ ดึงจาก cache ของ server (`shared`) ครั้งแรกที่ขอ แล้วถือ reference ไว้จน request จบ

    cache ของ server เก็บแค่ 4 bundle (LRU) แต่รายงานหลาย Facility ต้องใช้ ephem 1 + access ของทุก Facility ที่เลือก ถ้าเกิน 4 แล้วเรียงสลับ
    (THBK-G01, PHUK-G01, ..., THBK-E11) bundle ที่เพิ่งใช้ถูกไล่ออกแล้วอ่านซ้ำจากดิสก์ใน request เดียว (0.2-0.5 วินาทีต่อครั้ง)
    ที่นี่แต่ละ (ชนิด, bundle) อ่านผ่าน cache ครั้งเดียวต่อ request หน่วยความจำเพิ่มชั่วคราวตามจำนวน Facility ใน request (ราว 135 MB ต่อ bundle)
    ใช้ในเธรดเดียวของ request (build_report เรียงทีละ object) จึงไม่ต้องล็อก ใช้ตัวนี้แทน `TableCache` ที่ส่งให้ `ResultSet`"""

    def __init__(self, shared: TableCache):
        super().__init__(1)                                # ไม่ใช้ที่เก็บของคลาสแม่ ทุกอย่างอยู่ใน _pinned
        self._shared = shared
        self._pinned: dict[tuple[str, Path], object] = {}

    def _pin(self, kind: str, path: Path, load: Callable[[Path], object]):
        key = kind, Path(path)
        if key not in self._pinned:
            self._pinned[key] = load(path)
        return self._pinned[key]

    def access(self, path: Path):
        return self._pin("access", path, self._shared.access)

    def ephem_manifest(self, path: Path):
        return self._pin("manifest", path, self._shared.ephem_manifest)

    def ephem(self, path: Path):
        return self._pin("ephem", path, self._shared.ephem)


# ---------- พารามิเตอร์ ----------

def _blank_none(value: str | None) -> str | None:
    """พารามิเตอร์ query ที่ส่งมาว่าง (`group=`) เท่ากับไม่ส่ง"""
    return None if value is None or value == "" else value


def _time(value: str | None, field: str) -> datetime | None:
    value = _blank_none(value)
    if value is None:
        return None
    try:
        return parse_utc_z(value)
    except ValueError as exc:
        raise ApiError(422, INVALID, f"{field}: {exc}", field) from None


def _step(value: str | None) -> int | None:
    value = _blank_none(value)
    if value is None:
        return None
    if not STEP_RE.fullmatch(value):
        raise ApiError(422, INVALID, f"Step ต้องเป็นจำนวนเต็มวินาที ได้ '{value}'", "time.step")
    return int(value)                                      # เท่าของ step ของ scenario และ > 0 engine ตรวจ (time.step)


def _window(rs: ResultSet, obj: str, start: datetime | None, stop: datetime | None) -> tuple[datetime, datetime]:
    """ช่วงของคำขอ: ไม่ระบุทั้งคู่ = ช่วงวิเคราะห์ (Use Object Time Period) ระบุข้างเดียว = 422"""
    if start is None and stop is None:
        return object_period(rs, obj)
    if stop is None:
        raise ApiError(422, INVALID, "ต้องระบุทั้ง start และ stop (ไม่มี stop)", "time.stop")
    if start is None:
        raise ApiError(422, INVALID, "ต้องระบุทั้ง start และ stop (ไม่มี start)", "time.start")
    return start, stop


# ---------- /dataproviders ----------

class ElementOut(BaseModel):
    name: str
    unit: str | None
    kind: Literal["time", "number", "int"]
    interp: Literal["linear", "angle", "previous", "none"]


class ProviderOut(BaseModel):
    name: str
    groups: list[str] | None
    elements: list[ElementOut]
    uses: list[Literal["Reports", "Dynamic Displays"]]
    ours: bool


def _provider_out(info: ProviderInfo) -> dict:
    return {"name": info.name, "groups": info.groups, "uses": info.uses, "ours": info.ours,
            "elements": [{"name": e.name, "unit": e.unit, "kind": e.kind, "interp": e.interp} for e in info.elements]}


def _check_object_name(scenario: EngineScenario, tables: TableCache, cls: str, name: str) -> None:
    """object ชนิด cls ชื่อ name ต้องมีใน scenario ไม่งั้น 422 ที่ `name` (engine ตอบที่ field `object` จึงแปลงใหม่)"""
    obj = name if name.startswith("*/") else f"*/{cls}/{name}"
    try:
        if parse_object(obj)[0] != cls:
            raise ScenarioError(f"name '{name}' ไม่ใช่ object ชนิด {cls}", "name")
        object_period(ResultSet(scenario, None, {}, tables), obj)          # แค่ตรวจว่า object มี (ไม่ต้องมีผลลัพธ์)
    except ScenarioError as exc:
        raise ApiError(422, exc.code, str(exc), "name") from None


@router.get("/scenarios/{sc}/dataproviders", response_model=list[ProviderOut])
def get_dataproviders(sc: str, cls: str = Query(alias="class"), name: str | None = None, store: ScenarioStore = Depends(get_store),
                      tables: TableCache = Depends(get_tables)) -> list[dict]:
    store.current_etag(sc)                                 # ไม่มี scenario -> 404
    infos, name = list_providers(cls), _blank_none(name)
    if infos and name is not None:
        _check_object_name(load_scenario(store.path(sc) / SCENARIO_FILE), tables, cls, name)
    return [_provider_out(info) for info in infos]


# ---------- /data ----------

class ColumnOut(BaseModel):
    name: str
    unit: str | None
    kind: Literal["time", "number", "int"]


class DataOut(BaseModel):
    columns: list[ColumnOut]
    rows: list[list[str | int | float | None]]


def _json_value(value):
    """ค่าในแถวสำหรับ JSON: เวลา -> ISO มิลลิวินาที Z, ค่าที่ไม่จำกัด (NaN, inf) -> null (JSON ไม่มีค่าเหล่านี้)"""
    if isinstance(value, datetime):
        return iso_ms(value)
    return None if isinstance(value, float) and not math.isfinite(value) else value


@router.get("/scenarios/{sc}/data", response_model=DataOut)
def get_data(sc: str, obj: str = Query(alias="object"), provider: str = Query(), group: str | None = None,
             elements: list[str] = Query(), start: str | None = None, stop: str | None = None, step: str | None = None,
             store: ScenarioStore = Depends(get_store), plans: PlanCache = Depends(get_plans),
             tables: TableCache = Depends(get_tables)) -> dict:
    lo, hi, step_s = _time(start, "time.start"), _time(stop, "time.stop"), _step(step)
    rs = server_result_set(store, plans, tables, sc)
    lo, hi = _window(rs, obj, lo, hi)
    rows = provider_rows(rs, obj, provider, _blank_none(group), elements, lo, hi, step_s)     # engine ตรวจ provider/group/element/object/step
    by_name = {e.name: e for e in PROVIDERS[provider].elements}
    return {"columns": [{"name": e, "unit": by_name[e].unit, "kind": by_name[e].kind} for e in elements],
            "rows": [[_json_value(row[e]) for e in elements] for row in rows]}


# ---------- /styles ----------

class StylesOut(BaseModel):
    installed: list[dict[str, Any]]
    my: list[dict[str, Any]]
    scenario: list[dict[str, Any]]


def _scenario_styles(doc: dict, sc: str, logger: logging.Logger) -> list[dict]:
    """Scenario Styles ใน `doc` (scenario.json ของ sc) รายการที่ไม่ใช่ object ข้ามพร้อมเตือน (ไฟล์ที่แก้มือ)"""
    styles = doc.get("styles", [])
    if not isinstance(styles, list):
        logger.warning("Scenario Styles ของ %s ใช้ไม่ได้ ข้ามไป: styles ไม่ใช่รายการ", sc)
        return []
    kept = [style for style in styles if isinstance(style, dict)]
    if len(kept) != len(styles):
        logger.warning("Scenario Styles ของ %s: ข้าม %d รายการที่ไม่ใช่ object", sc, len(styles) - len(kept))
    return kept


@router.get("/styles", response_model=StylesOut)
def get_styles(object_type: str | None = None, scenario: str | None = None, store: ScenarioStore = Depends(get_store),
               my: MyStyles = Depends(get_my_styles), logger: logging.Logger = Depends(get_logger)) -> dict:
    object_type, scenario = _blank_none(object_type), _blank_none(scenario)
    scenario_styles = _scenario_styles(store.read(scenario)[0], scenario, logger) if scenario is not None else []   # ไม่มี scenario -> 404

    def keep(styles: list[dict]) -> list[dict]:
        return [s for s in styles if object_type is None or s.get("object_type") == object_type]

    return {"installed": keep(installed_styles()), "my": keep(my.list()), "scenario": keep(scenario_styles)}


def _checked_style(name: str, body: dict) -> dict:
    """style ที่จะบันทึกเป็น My Style ชื่อ `name`: ชื่อถูกกฎ ตรงกับ body เนื้อหาผ่าน check_style และไม่ซ้ำ Installed (ไม่แยกตัวพิมพ์)"""
    check_name(name)
    if body.get("name") != name:
        raise StyleError(f"ช่อง name ในตัว style ({body.get('name')!r}) ต้องตรงกับชื่อใน path ({name})", "name")
    check_style(body)
    installed = next((s["name"] for s in installed_styles() if s["name"].casefold() == name.casefold()), None)
    if installed is not None:
        raise ApiError(409, "NAME_EXISTS", f"ชื่อ {installed} เป็นของ Installed Style ใช้เป็นชื่อ My Style ไม่ได้", "name", installed)
    return body


def _save(my: MyStyles, name: str, body: dict, exclusive: bool) -> dict:
    style = _checked_style(name, body)
    try:
        my.save(style, exclusive=exclusive)
    except FileExistsError as exc:
        taken = exc.args[0] if exc.args else name
        raise ApiError(409, "NAME_EXISTS", f"มี My Style ชื่อ {taken} อยู่แล้ว (ชื่อไม่แยกตัวพิมพ์เล็กใหญ่)", "name", taken) from None
    return style


@router.post("/styles/{name:path}", status_code=201, response_model=dict[str, Any])
def create_style(name: str, body: dict[str, Any], my: MyStyles = Depends(get_my_styles)) -> dict:
    return _save(my, name, body, True)


@router.put("/styles/{name:path}", response_model=dict[str, Any])
def put_style(name: str, body: dict[str, Any], my: MyStyles = Depends(get_my_styles)) -> dict:
    return _save(my, name, body, False)


@router.delete("/styles/{name:path}", status_code=204)
def delete_style(name: str, my: MyStyles = Depends(get_my_styles)) -> Response:
    try:
        my.delete(name)
    except FileNotFoundError:
        raise ApiError(404, "NOT_FOUND", f"ไม่พบ My Style ชื่อ {name}") from None
    return Response(status_code=204)


# ---------- /reports ----------

MAX_REPORT_FACILITIES = 4           # Facility ต่อ request: ตรึงตารางของทุกแห่งพร้อมกัน (PinnedTables) แห่งละราว 135 MB
MAX_STEP_S = 999_999_999            # เท่ากับ /data (9 หลัก) เกินนี้ timedelta ล้น: ต้องตอบ 422 ไม่ใช่ 500
REPORT_MEDIA = {"txt": "text/plain; charset=utf-8", "csv": "text/csv; charset=utf-8"}


class _Body(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")


class ReportTime(_Body):
    """ตัวเลือกเวลาของ Generate: `object` = Use Object Time Period (start/stop ไม่ใช้ ไม่ตรวจเหมือน `time_period` ของ access)
    `specify` = Specify Time Properties (ต้องมี start และ stop) `step_s` ว่าง = Use default time points"""
    mode: Literal["object", "specify"] = "object"
    start: UtcZ | None = None
    stop: UtcZ | None = None
    step_s: int | None = None                  # เท่าของ step ของ scenario และ > 0: engine ตรวจ (422 time.step)


class ExportBody(_Body):
    """Export Setup ของ csv (ค่าตั้งต้นตรงกับ `ExportSetup` ของ engine)"""
    delimiter: str = Field(",", min_length=1, max_length=1)
    quote_headers: bool = False
    title: bool = False
    headers: bool = True


class ReportBody(_Body):
    style: str
    kind: Literal["report", "graph"] | None = None
    objects: list[str] = Field(min_length=1)
    time: ReportTime | None = None             # ไม่ส่ง = ใช้ time ของ style
    format: Literal["json", "txt", "csv"] = "json"
    dynamic: bool = False
    export: ExportBody | None = None


class StatisticOut(BaseModel):
    name: str
    value: float | int | None


class SectionOut(BaseModel):
    object: str
    title: str
    columns: list[ColumnOut]
    rows: list[list[str | int | float | None]]
    summary: list[StatisticOut]
    summary_only: bool


class ReportOut(BaseModel):
    scenario: str
    style: str
    kind: Literal["report", "graph"]
    created_utc: str
    sections: list[SectionOut]
    global_statistics: list[StatisticOut]
    graph: dict[str, Any] | None
    dynamic: bool


def _check_facility_count(objects: list[str]) -> None:
    """รายงานหนึ่งครั้งใช้ผล access ได้ไม่เกิน MAX_REPORT_FACILITIES Facility (ชื่อไม่แยกตัวพิมพ์ ดาวไม่นับ) เกิน = 422 ที่ `objects`"""
    parsed = [parse_object(obj) for obj in objects]
    names = {name.casefold() for kind, name, _ in parsed if kind != "Satellite"}
    if len(names) > MAX_REPORT_FACILITIES:
        raise ApiError(422, INVALID, f"รายงานหนึ่งครั้งเลือก object ได้จาก Facility ไม่เกิน {MAX_REPORT_FACILITIES} แห่ง (ได้ {len(names)} แห่ง) "
                                     "เพราะต้องอ่านผลของทุก Facility เข้าหน่วยความจำพร้อมกัน ให้แบ่งเป็นหลายรายงาน", "objects")


def _checked_step(step: int | None) -> int | None:
    if step is not None and step > MAX_STEP_S:
        raise ApiError(422, INVALID, f"Step ต้องไม่เกิน {MAX_STEP_S} วินาที ได้ {step}", "time.step")
    return step


def _style_time(style: dict) -> tuple[bool, datetime | None, datetime | None, int | None]:
    """`time` ของ style (ผ่าน check_style แล้ว) เป็น (specify, start, stop, step_s) engine ไม่อ่านช่องนี้ ผู้เรียกต้องแปลงเอง"""
    time = style.get("time") or {}
    step = _checked_step(time.get("step_s"))
    if time.get("mode") != "specify":
        return False, None, None, step
    return (True, *(datetime.fromisoformat(time[key]).astimezone(timezone.utc) for key in ("start", "stop")), step)


def _report_time(time: ReportTime | None, style: dict) -> tuple[bool, datetime | None, datetime | None, int | None]:
    """(specify, start, stop, step_s) ของคำขอ: ไม่ส่ง `time` = ของ style ส่งแล้วตามคำขอทั้งก้อน"""
    if time is None:
        return _style_time(style)
    step = _checked_step(time.step_s)
    if time.mode != "specify":
        return False, None, None, step
    if time.start is None or time.stop is None:
        field = "time.start" if time.start is None else "time.stop"
        raise ApiError(422, INVALID, f"Specify Time Properties ต้องมีทั้ง start และ stop (ไม่มี {field.split('.')[1]})", field)
    start, stop = parse_utc_z(time.start), parse_utc_z(time.stop)
    if start >= stop:
        raise ApiError(422, INVALID, "เวลาเริ่มต้องอยู่ก่อนเวลาจบ", "time.start")
    return True, start, stop, step


def _named_path(doc: dict, cls: str, name: str) -> str | None:
    """path ใน scenario ของ object ชนิด cls ชื่อ name (ชื่อไม่แยกตัวพิมพ์ เหมือน engine) ไม่มี = None"""
    wanted = name.casefold()
    return next((path_of(o) for o in doc.get("objects", []) if isinstance(o, dict) and o.get("class") == cls
                 and isinstance(o.get("name"), str) and o["name"].casefold() == wanted), None)


def _stored_period(doc: dict, obj: str, from_path: str, sat_path: str) -> dict | None:
    """`time_period` ของ access ที่ครอบ (Facility, ดาว) ตามที่ `GET /access/intervals` (Timeline) ตัด: access ของ Facility นั้นที่ `to` ตรงกับ
    ดาวพอดี หรือขยายแล้ว (`access.expand_targets` เหมือน intervals: Constellation เป็นสมาชิก) มีดาวนี้ ไม่มี = None
    มีหลายรายการ: ที่ Compute อยู่ก่อนที่ Clear แล้ว แล้วแบบระบุดาวตรง ๆ ก่อนแบบ Constellation แล้วตามลำดับในไฟล์"""
    sat_name, best = sat_path.rsplit("/", 1)[1], None
    for index, entry in enumerate(doc.get("accesses", [])):
        to = entry.get("to") if isinstance(entry, dict) and entry.get("from") == from_path else None
        if not isinstance(to, list):
            continue
        exact = set(to) == {sat_path}
        try:
            if not exact and sat_name not in access.expand_targets(doc, to, set()):
                continue
        except ApiError:                                     # `to` ที่ชี้ไป object ที่ไม่มี (ไฟล์ที่แก้มือ)
            raise ApiError(422, INVALID, f"access ของ {from_path} ใน scenario.json มีปลายทางที่ใช้ไม่ได้ ({obj})", "accesses") from None
        rank = (not entry.get("computed"), not exact, index)
        if best is None or rank < best[0]:
            best = rank, entry
    return None if best is None else best[1].get("time_period") or {"mode": "object"}


def _access_window(doc: dict, obj: str) -> tuple[datetime, datetime] | None:
    """ช่วงที่ตัดของ object แบบ Access ตาม `time_period` (mode specify) ของ access ที่ครอบมัน ไม่มี = None (ช่วงวิเคราะห์)
    object ชนิดอื่น หรือ object ที่ไม่มีใน scenario (engine ตอบ 422 ที่ `object` เอง) = None"""
    kind, facility, satellite = parse_object(obj)
    if kind != "Access":
        return None
    from_path, sat_path = _named_path(doc, "Facility", facility), _named_path(doc, "Satellite", satellite)
    if from_path is None or sat_path is None:
        return None
    from_path, to = access.normalize(doc, from_path, [sat_path])
    period = _stored_period(doc, obj, from_path, to[0]) or {}
    if period.get("mode") != access.MODE_SPECIFY:
        return None
    try:
        return parse_utc_z(period["start"]), parse_utc_z(period["stop"])
    except (KeyError, TypeError, ValueError):
        raise ApiError(422, INVALID, f"time_period ของ access {obj} ใน scenario.json อ่านไม่ได้", "accesses") from None


def _stored_window(doc: dict, objects: list[str]) -> tuple[datetime | None, datetime | None]:
    """Use Object Time Period: ช่วงของ object ทั้งชุด (build_report รับช่วงเดียว) ต่างกัน = 422 ที่ `objects`"""
    windows = {_access_window(doc, obj) for obj in objects}
    if len(windows) > 1:
        raise ApiError(422, INVALID, "object ที่เลือกมี Time Period ของ access ไม่เท่ากัน รวมเป็นรายงานเดียวไม่ได้ "
                                     "ให้เลือกทีละช่วงเดียวกัน หรือใช้ Specify Time Properties", "objects")
    return windows.pop() or (None, None)


@router.post("/scenarios/{sc}/reports", response_model=None, responses={200: {
    "model": ReportOut, "description": "format json: ตารางของรายงาน; txt/csv: ไฟล์แนบ",
    "content": {"text/plain": {"schema": {"type": "string"}}, "text/csv": {"schema": {"type": "string"}}}}})
def create_report(sc: str, body: ReportBody, store: ScenarioStore = Depends(get_store), plans: PlanCache = Depends(get_plans),
                  tables: TableCache = Depends(get_tables), my: MyStyles = Depends(get_my_styles),
                  logger: logging.Logger = Depends(get_logger)) -> Response:
    doc, _ = store.read(sc)                                                      # ไม่มี scenario -> 404
    style = resolve_style(body.style, body.kind, my.list(), _scenario_styles(doc, sc, logger))
    check_style(style)                                                           # style ที่แก้มือผิด: 422 ที่ช่องนั้น
    if body.dynamic and not style.get("dynamic", False):
        raise StyleError(f"style {style['name']} ใช้กับ Dynamic Display/Strip Chart ไม่ได้", "dynamic")
    export = ExportSetup(**body.export.model_dump()) if body.export is not None else None
    specify, start, stop, step = _report_time(body.time, style)
    _check_facility_count(body.objects)
    date_format, ltz_offset = time_format_of(doc) if body.format != "json" else ("UTCG", "+07:00")
    rs = server_result_set(store, plans, PinnedTables(tables), sc)
    if not specify:
        start, stop = _stored_window(doc, body.objects)
    built = build_report(rs, style, body.objects, start, stop, step, datetime.now(timezone.utc))
    built = replace(built, dynamic=body.dynamic)
    if body.format == "json":
        return JSONResponse(report_json(built))
    text = (format_txt(built, date_format, ltz_offset) if body.format == "txt"
            else format_csv(built, date_format, ltz_offset, export or ExportSetup()))
    return Response(text, media_type=REPORT_MEDIA[body.format],
                    headers={"Content-Disposition": f'attachment; filename="{report_filename(built, body.format)}"'})
