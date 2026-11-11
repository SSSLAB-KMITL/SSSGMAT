"""Scenario (File menu และ New Scenario Wizard) หัวข้อ 6.3 ของ spec server

ETag ส่งทาง header `ETag` (รูปแบบ RFC: `"<16 hex>"`) และรับทาง `If-Match` ทุกการแก้ scenario ต้องส่ง If-Match ไม่ส่ง = 412
"""

from typing import Any, Literal

from fastapi import APIRouter, Depends, Header, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ..config import Config
from ..store import ScenarioStore
from ..templates import new_scenario
from . import get_config, get_store

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


@router.get("/scenarios")
def list_scenarios(store: ScenarioStore = Depends(get_store)) -> list[dict]:
    return store.list()


@router.post("/scenarios")
def create_scenario(body: NewScenario, config: Config = Depends(get_config),
                    store: ScenarioStore = Depends(get_store)) -> JSONResponse:
    store.ensure_free(body.name)                        # ชื่อผิด/ซ้ำตอบก่อนเสียเวลาอ่าน catalog
    doc = new_scenario(body.name, body.start, body.stop, body.template, body.snapshot, config.data_dir)
    tag = store.create(body.name, doc)
    return JSONResponse(doc, status_code=201, headers={**_etag_header(tag), "Location": f"/api/scenarios/{body.name}"})


@router.get("/scenarios/{sc}")
def get_scenario(sc: str, store: ScenarioStore = Depends(get_store)) -> JSONResponse:
    doc, tag = store.read(sc)
    return JSONResponse(doc, headers=_etag_header(tag))


@router.put("/scenarios/{sc}")
def put_scenario(sc: str, doc: dict[str, Any], if_match: str | None = Header(None),
                 store: ScenarioStore = Depends(get_store)) -> JSONResponse:
    # ไม่ส่ง If-Match = ค่าว่างซึ่งไม่ตรงกับ ETag ใดเลย -> 412 (หลังตรวจว่ามี scenario นี้อยู่ ไม่งั้น 404)
    tag = store.write(sc, doc, if_match if if_match is not None else "")
    return JSONResponse(doc, headers=_etag_header(tag))


@router.post("/scenarios/{sc}/copy")
def copy_scenario(sc: str, body: CopyScenario, store: ScenarioStore = Depends(get_store)) -> JSONResponse:
    tag = store.copy(sc, body.new_name)
    doc, _ = store.read(body.new_name)
    return JSONResponse(doc, status_code=201, headers={**_etag_header(tag), "Location": f"/api/scenarios/{body.new_name}"})


@router.delete("/scenarios/{sc}", status_code=204)
def delete_scenario(sc: str, store: ScenarioStore = Depends(get_store)) -> Response:
    store.delete(sc)
    return Response(status_code=204)


@router.get("/scenarios/{sc}/workbook")
def get_workbook(sc: str, store: ScenarioStore = Depends(get_store)) -> JSONResponse:
    return JSONResponse(store.read_workbook(sc))        # ยังไม่มี workbook = 200 null


@router.put("/scenarios/{sc}/workbook", status_code=204)
def put_workbook(sc: str, doc: dict[str, Any], store: ScenarioStore = Depends(get_store)) -> Response:
    store.write_workbook(sc, doc)
    return Response(status_code=204)
