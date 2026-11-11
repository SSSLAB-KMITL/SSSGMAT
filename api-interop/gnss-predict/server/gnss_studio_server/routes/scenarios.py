"""Scenario (File menu และ New Scenario Wizard) หัวข้อ 6.3 ของ spec server

ETag ส่งทาง header `ETag` (รูปแบบ RFC: `"<16 hex>"`) และรับทาง `If-Match` ทุกการแก้ scenario ต้องส่ง If-Match ไม่ส่ง = 412

หลังเขียนสำเร็จทุก route ส่ง event `scenario` `{name, etag, results_stale}` เข้า bus (หัวข้อ 8) ที่ตอบ 4xx ไม่ส่งอะไร:
- PUT เทียบ fingerprint ของ plan ก่อน/หลังเขียนด้วย `plans.py` เหมือน route แก้ object แล้วใส่ `results_stale` ในคำตอบด้วย
- สร้างและคัดลอก `results_stale` เป็น false (ยังไม่มีผลของ scenario นั้น) ลบส่ง `etag` เป็น null
- workbook เป็นแค่ layout หน้าต่าง ไม่ส่ง event
"""

from typing import Any, Literal

from fastapi import APIRouter, Depends, Header, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ..config import Config
from ..events import EventBus
from ..plans import fingerprint, is_stale
from ..store import ScenarioStore, check_etag
from ..templates import new_scenario
from . import get_bus, get_config, get_store

router = APIRouter()


class NewScenario(BaseModel):
    name: str
    start: str
    stop: str
    template: Literal["thbk-gnss", "empty"]
    snapshot: str | None = None


class CopyScenario(BaseModel):
    new_name: str


def _etag_header(tag: str) -> dict[str, str]:
    return {"ETag": f'"{tag}"'}


def publish_scenario(bus: EventBus, name: str, tag: str | None, results_stale: bool) -> None:
    """event `scenario` ของ scenario ที่เพิ่งเขียนสำเร็จ (tag เป็น None = ถูกลบ)"""
    bus.publish("scenario", {"name": name, "etag": tag, "results_stale": results_stale})


@router.get("/scenarios")
def list_scenarios(store: ScenarioStore = Depends(get_store)) -> list[dict]:
    return store.list()


@router.post("/scenarios")
def create_scenario(body: NewScenario, config: Config = Depends(get_config), store: ScenarioStore = Depends(get_store),
                    bus: EventBus = Depends(get_bus)) -> JSONResponse:
    store.ensure_free(body.name)                        # ชื่อผิด/ซ้ำตอบก่อนเสียเวลาอ่าน catalog
    doc = new_scenario(body.name, body.start, body.stop, body.template, body.snapshot, config.data_dir)
    tag = store.create(body.name, doc)
    publish_scenario(bus, body.name, tag, False)
    return JSONResponse(doc, status_code=201, headers={**_etag_header(tag), "Location": f"/api/scenarios/{body.name}"})


@router.get("/scenarios/{sc}")
def get_scenario(sc: str, store: ScenarioStore = Depends(get_store)) -> JSONResponse:
    doc, tag = store.read(sc)
    return JSONResponse(doc, headers=_etag_header(tag))


@router.put("/scenarios/{sc}")
def put_scenario(sc: str, request: Request, doc: dict[str, Any], if_match: str | None = Header(None),
                 store: ScenarioStore = Depends(get_store), bus: EventBus = Depends(get_bus)) -> JSONResponse:
    """คำตอบคือเอกสารที่บันทึก (ตรงตัว) บวกช่อง `results_stale` ช่องเดียว: ผู้เรียกที่เอาคำตอบไป PUT ต่อต้องตัดช่องนี้ออกก่อน"""
    # ไม่ส่ง If-Match = ค่าว่างซึ่งไม่ตรงกับ ETag ใดเลย -> 412 (หลังตรวจว่ามี scenario นี้อยู่ ไม่งั้น 404)
    if_match = if_match if if_match is not None else ""
    check_etag(store.current_etag(sc), if_match)        # ตรวจก่อนคำนวณ plan: 404/412 ไม่เสียเวลา (store.write ตรวจซ้ำใต้ล็อก)
    directory, logger = store.path(sc), request.app.state.logger
    before = fingerprint(directory, store.data_dir, logger)
    tag = store.write(sc, doc, if_match)
    stale = is_stale(before, fingerprint(directory, store.data_dir, logger))
    publish_scenario(bus, sc, tag, stale)
    return JSONResponse({**doc, "results_stale": stale}, headers=_etag_header(tag))


@router.post("/scenarios/{sc}/copy")
def copy_scenario(sc: str, body: CopyScenario, store: ScenarioStore = Depends(get_store),
                  bus: EventBus = Depends(get_bus)) -> JSONResponse:
    tag = store.copy(sc, body.new_name)
    publish_scenario(bus, body.new_name, tag, False)
    doc, _ = store.read(body.new_name)
    return JSONResponse(doc, status_code=201, headers={**_etag_header(tag), "Location": f"/api/scenarios/{body.new_name}"})


@router.delete("/scenarios/{sc}", status_code=204)
def delete_scenario(sc: str, store: ScenarioStore = Depends(get_store), bus: EventBus = Depends(get_bus)) -> Response:
    store.delete(sc)
    publish_scenario(bus, sc, None, False)
    return Response(status_code=204)


@router.get("/scenarios/{sc}/workbook")
def get_workbook(sc: str, store: ScenarioStore = Depends(get_store)) -> JSONResponse:
    return JSONResponse(store.read_workbook(sc))        # ยังไม่มี workbook = 200 null


@router.put("/scenarios/{sc}/workbook", status_code=204)
def put_workbook(sc: str, doc: dict[str, Any], store: ScenarioStore = Depends(get_store)) -> Response:
    store.write_workbook(sc, doc)
    return Response(status_code=204)
