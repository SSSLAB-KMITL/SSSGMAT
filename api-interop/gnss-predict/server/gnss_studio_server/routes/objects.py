"""Object (Object Browser, Insert STK Objects, Properties Browser) หัวข้อ 6.4 ของ spec server

- ทุกการแก้ต้องส่ง `If-Match` (ไม่ส่งหรือไม่ตรง = 412 เหมือน PUT ของ scenario) ตรวจก่อนแก้เอกสารเพื่อให้ผู้ส่ง ETag เก่าได้ 412
  ไม่ใช่ 422/404/409 ที่คำนวณจากเอกสารที่เขาไม่ได้เห็น แล้ว `store.write` ตรวจซ้ำใต้ล็อกตอนเขียน
- ตอบ `{"etag", "results_stale"}` (Insert เพิ่ม `created`) พร้อม header `ETag` ใหม่ `results_stale` เทียบ hash ของ propagate และ analyze
  ก่อนเขียน (จากไฟล์บนดิสก์) กับหลังเขียนสำเร็จ (`plans.py`) แล้วส่ง event `scenario` ด้วยค่าชุดเดียวกัน (ที่ตอบ 4xx ไม่ส่ง)
- `{cls}` ที่ไม่ใช่ Facility/Satellite/Constellation และ object ที่ไม่มี = 404 NOT_FOUND
"""

from collections.abc import Callable
from typing import Any

from fastapi import APIRouter, Depends, Header, Request
from fastapi.responses import JSONResponse

from .. import objects
from ..events import EventBus
from ..plans import fingerprint, is_stale
from ..store import ScenarioStore, check_etag
from . import get_bus, get_store
from .scenarios import _etag_header, publish_scenario

router = APIRouter()


def _edit(request: Request, store: ScenarioStore, bus: EventBus, sc: str, if_match: str | None,
          change: Callable[[dict], Any]) -> tuple[Any, str, bool]:
    """อ่าน scenario, ตรวจ If-Match, เรียก change(doc) แก้ doc, เขียน, ส่ง event scenario แล้วคืน (ผลของ change, ETag ใหม่, results_stale)"""
    doc, current = store.read(sc)
    # ไม่ส่ง If-Match = ค่าว่างซึ่งไม่ตรงกับ ETag ใดเลย -> 412 (หลังตรวจว่ามี scenario นี้อยู่ ไม่งั้น 404)
    if_match = if_match if if_match is not None else ""
    check_etag(current, if_match)
    directory, logger = store.path(sc), request.app.state.logger
    before = fingerprint(directory, store.data_dir, logger)
    result = change(doc)
    tag = store.write(sc, doc, if_match)
    stale = is_stale(before, fingerprint(directory, store.data_dir, logger))
    publish_scenario(bus, sc, tag, stale)
    return result, tag, stale


def _saved(tag: str, stale: bool, status: int = 200, **extra: Any) -> JSONResponse:
    return JSONResponse({**extra, "etag": tag, "results_stale": stale}, status_code=status, headers=_etag_header(tag))


@router.get("/scenarios/{sc}/objects")
def get_tree(sc: str, store: ScenarioStore = Depends(get_store)) -> JSONResponse:
    doc, tag = store.read(sc)
    return JSONResponse(objects.tree(doc), headers=_etag_header(tag))


@router.post("/scenarios/{sc}/objects")
def insert_object(sc: str, request: Request, body: dict[str, Any], if_match: str | None = Header(None),
                  store: ScenarioStore = Depends(get_store), bus: EventBus = Depends(get_bus)) -> JSONResponse:
    def change(doc: dict) -> list[str]:
        return objects.insert(doc, body, lambda: objects.scenario_catalog(doc, store.data_dir))
    created, tag, stale = _edit(request, store, bus, sc, if_match, change)
    return _saved(tag, stale, 201, created=created)


@router.get("/scenarios/{sc}/objects/{cls}/{name}")
def get_object(sc: str, cls: str, name: str, store: ScenarioStore = Depends(get_store)) -> JSONResponse:
    doc, tag = store.read(sc)
    _, obj = objects.find(doc, cls, name)
    return JSONResponse(objects.pages(obj), headers=_etag_header(tag))


@router.patch("/scenarios/{sc}/objects/{cls}/{name}")
def patch_object(sc: str, cls: str, name: str, request: Request, patch: dict[str, Any], if_match: str | None = Header(None),
                 store: ScenarioStore = Depends(get_store),
                 bus: EventBus = Depends(get_bus)) -> JSONResponse:
    _, tag, stale = _edit(request, store, bus, sc, if_match, lambda doc: objects.apply_pages(doc, cls, name, patch))
    return _saved(tag, stale)


@router.post("/scenarios/{sc}/objects/{cls}/{name}/rename")
def rename_object(sc: str, cls: str, name: str, request: Request, body: dict[str, Any], if_match: str | None = Header(None),
                  store: ScenarioStore = Depends(get_store),
                  bus: EventBus = Depends(get_bus)) -> JSONResponse:
    _, tag, stale = _edit(request, store, bus, sc, if_match, lambda doc: objects.rename(doc, cls, name, body.get("new_name")))
    return _saved(tag, stale)


@router.delete("/scenarios/{sc}/objects/{cls}/{name}")
def delete_object(sc: str, cls: str, name: str, request: Request, if_match: str | None = Header(None),
                  store: ScenarioStore = Depends(get_store),
                  bus: EventBus = Depends(get_bus)) -> JSONResponse:
    _, tag, stale = _edit(request, store, bus, sc, if_match, lambda doc: objects.delete(doc, cls, name))
    return _saved(tag, stale)


@router.post("/scenarios/{sc}/groups")
def set_group(sc: str, request: Request, body: dict[str, Any], if_match: str | None = Header(None),
              store: ScenarioStore = Depends(get_store),
              bus: EventBus = Depends(get_bus)) -> JSONResponse:
    _, tag, stale = _edit(request, store, bus, sc, if_match,
                          lambda doc: objects.set_group(doc, body.get("name"), body.get("members", [])))
    return _saved(tag, stale)
