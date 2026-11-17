"""Scenario (File menu และ New Scenario Wizard) หัวข้อ 6.3 ของ spec server

ETag ส่งทาง header `ETag` (รูปแบบ RFC: `"<16 hex>"`) และรับทาง `If-Match` ทุกการแก้ scenario ต้องส่ง If-Match ไม่ส่ง = 412

หลังเขียนสำเร็จทุก route ส่ง event `scenario` `{name, etag, results_stale}` เข้า bus (หัวข้อ 8) ที่ตอบ 4xx ไม่ส่งอะไร:
- PUT เขียนผ่าน `tracking.write_tracked` เหมือน route แก้ object (เทียบ fingerprint ของ plan ก่อน/หลังเขียน) คำตอบคือเอกสารที่บันทึก
  ตรงตัว ส่วน `results_stale` อยู่ใน header `X-Results-Stale: true|false` (ไม่ใส่ในตัวเอกสาร กัน client เอาตัวตอบไป PUT ต่อแล้วเก็บช่องนี้ลงไฟล์)
- สร้างและคัดลอก `results_stale` เป็น false (ยังไม่มีผลของ scenario นั้น) ลบส่ง `etag` เป็น null
- workbook เป็นแค่ layout หน้าต่าง ไม่ส่ง event
"""

from typing import Any, Literal

from fastapi import APIRouter, Depends, Header, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ..config import Config
from ..errors import ApiError
from ..events import EventBus
from ..jobs import JobManager
from ..store import ScenarioStore, check_etag
from ..templates import new_scenario
from ..tracking import etag_header, publish_scenario, write_tracked
from . import get_bus, get_config, get_jobs, get_store

router = APIRouter()

RESULTS_STALE_HEADER = "X-Results-Stale"


class NewScenario(BaseModel):
    name: str
    start: str
    stop: str
    template: Literal["thbk-gnss", "empty"]
    snapshot: str | None = None


class CopyScenario(BaseModel):
    new_name: str


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
    return JSONResponse(doc, status_code=201, headers={**etag_header(tag), "Location": f"/api/scenarios/{body.name}"})


@router.get("/scenarios/{sc}")
def get_scenario(sc: str, store: ScenarioStore = Depends(get_store)) -> JSONResponse:
    doc, tag = store.read(sc)
    return JSONResponse(doc, headers=etag_header(tag))


@router.put("/scenarios/{sc}")
def put_scenario(sc: str, request: Request, doc: dict[str, Any], if_match: str | None = Header(None),
                 store: ScenarioStore = Depends(get_store), bus: EventBus = Depends(get_bus)) -> JSONResponse:
    """คำตอบคือเอกสารที่บันทึกตรงตัว ไม่เพิ่มช่องใด; results_stale อยู่ใน header X-Results-Stale"""
    # ไม่ส่ง If-Match = ค่าว่างซึ่งไม่ตรงกับ ETag ใดเลย -> 412 (หลังตรวจว่ามี scenario นี้อยู่ ไม่งั้น 404)
    if_match = if_match if if_match is not None else ""
    check_etag(store.current_etag(sc), if_match)        # ตรวจก่อนคำนวณ plan: 404/412 ไม่เสียเวลา (store.write ตรวจซ้ำใต้ล็อก)
    tag, stale = write_tracked(store, bus, request.app.state.plans, sc, doc, if_match)
    return JSONResponse(doc, headers={**etag_header(tag), RESULTS_STALE_HEADER: "true" if stale else "false"})


@router.post("/scenarios/{sc}/copy")
def copy_scenario(sc: str, body: CopyScenario, store: ScenarioStore = Depends(get_store),
                  bus: EventBus = Depends(get_bus)) -> JSONResponse:
    tag = store.copy(sc, body.new_name)
    publish_scenario(bus, body.new_name, tag, False)
    doc, _ = store.read(body.new_name)
    return JSONResponse(doc, status_code=201, headers={**etag_header(tag), "Location": f"/api/scenarios/{body.new_name}"})


@router.delete("/scenarios/{sc}", status_code=204)
def delete_scenario(sc: str, store: ScenarioStore = Depends(get_store), bus: EventBus = Depends(get_bus),
                    jobs: JobManager = Depends(get_jobs)) -> Response:
    """มี job ของ scenario นี้ที่ยังรอหรือกำลังรัน -> 409 JOB_RUNNING (ยกเลิก job ก่อนจึงลบได้)"""
    if jobs.active_for(sc):
        raise ApiError(409, "JOB_RUNNING", f"scenario {sc} มี job ที่รอหรือกำลังทำงานอยู่ ยกเลิก job ก่อนจึงลบได้")
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
