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

ข้อมูลอ่านจาก bundle ที่ `current` เท่านั้น (`server_result_set`) ผ่าน `PlanCache` (hash ของ plan ไม่คำนวณซ้ำต่อ request) กับ `app.state.tables`
(ตารางที่อ่านแล้วต่อ bundle) ไม่เรียก `open_result_set` ของ engine ซึ่งคำนวณ hash ใหม่ทุกครั้ง (0.42-0.45 วินาทีกับข้อมูลจริง)
route ที่อ่านดิสก์เป็น `def` ธรรมดา (รันใน thread pool)
"""

import logging
import math
import re
from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel

from gnss_predict.dataproviders import (PROVIDERS, ProviderInfo, ResultSet, TableCache, list_providers, object_period,
                                        parse_object, provider_rows)
from gnss_predict.errors import ScenarioError, StyleError
from gnss_predict.report_style import check_style, installed_styles
from gnss_predict.scenario import EngineScenario, load_scenario

from ..errors import ApiError
from ..jobs import iso_ms
from ..plans import PlanCache
from ..schema import parse_utc_z
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


def _scenario_styles(store: ScenarioStore, sc: str, logger: logging.Logger) -> list[dict]:
    """Scenario Styles ใน scenario.json (ไม่มี scenario -> 404) รายการที่ไม่ใช่ object ข้ามพร้อมเตือน (ไฟล์ที่แก้มือ)"""
    styles = store.read(sc)[0].get("styles", [])
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
    scenario_styles = _scenario_styles(store, scenario, logger) if scenario is not None else []

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
