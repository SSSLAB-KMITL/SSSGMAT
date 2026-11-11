"""Access tool (หัวข้อ 6.6 ของ spec server)

- `GET /scenarios/{sc}/access`: `{"accesses": [<access ที่เก็บไว้> + "status"]}` พร้อม header `ETag` ของ scenario `status` คือสถานะผล analyze
  ของ Facility ที่ `from` (`current`, `stale`, `missing` ตัวเดียวกับ `GET /results`)
- `POST /scenarios/{sc}/access/compute` `{from, to[], time_period?, graphics?, timeline?}`: normalize (ดาว + Facility สลับเป็น Facility -> ดาว)
  บันทึก access เป็น `computed: true` (ซ้ำกับ (from, ชุด to) ที่มีอยู่ = แก้รายการเดิม) ผ่าน `write_tracked` ถ้าผล analyze ของ Facility นั้น current
  ตอบ 200 `{"computed": [ชื่อดาวที่ Constellation ขยายแล้ว ไม่รวมดาวที่ซ่อน], "etag"}` ไม่งั้นส่ง job `analyze` ตอบ 202 `{"job", "etag"}`
  ทั้งสองแบบมี header `ETag` ใหม่
- `POST .../access/clear` และ `.../access/remove` `{from, to[] | "all"}`: ตั้ง `computed: false` / ลบ access ที่ตรง ตอบ `{etag, cleared | removed: n}`
  ไม่มี access ตรง n เป็น 0 และไม่เขียนอะไร (ตอบ ETag ปัจจุบัน)
- `GET .../access/intervals?from=&to=` (`to` ซ้ำได้): `{ชื่อดาว: [ช่วง]}` ต่อดาวที่ขยายแล้ว จาก bundle ของ Facility ที่ current ตัดตาม `time_period`
  ของ access ที่เก็บไว้ซึ่งตรงกัน (mode `specify`) ผลไม่ current หรืออ่านไม่ได้ -> 409 `RESULTS_NOT_CURRENT`
- การแก้ทุกแบบต้องส่ง `If-Match` (ไม่ส่งหรือไม่ตรง = 412 ตรวจก่อนแก้เอกสาร) และส่ง event `scenario` เมื่อเขียนจริง
- ผิดรูปแบบ -> 422 `SCENARIO_INVALID` ที่ `from`, `to` หรือ `time_period.start` / `time_period.stop`
"""

import json
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, Header, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from .. import access
from ..config import Config
from ..errors import ApiError
from ..events import EventBus
from ..jobs import JobManager
from ..plans import PlanCache, Plans
from ..schema import AccessGraphics, AccessTimePeriod, parse_utc_z
from ..store import ScenarioStore, check_etag
from ..tracking import etag_header, write_tracked
from . import get_bus, get_config, get_jobs, get_plans, get_store
from .results import ACCESS_DIR, EPHEM_DIR, access_entries, ephem_entry

router = APIRouter()

NOT_CURRENT = "RESULTS_NOT_CURRENT"
MANIFEST, INTERVALS = "manifest.json", "intervals.json"


class _Body(BaseModel):
    model_config = ConfigDict(strict=True)


class ComputeBody(_Body):
    from_: str = Field(alias="from")
    to: list[str]
    time_period: AccessTimePeriod | None = None
    graphics: AccessGraphics | None = None
    timeline: bool | None = None


class SelectBody(_Body):
    from_: str = Field(alias="from")
    to: Any = Field(description='รายการ path ของดาวหรือ Constellation หรือ "all"')    # ตรวจใน access.matching (field `to` ตรงตัว)


def _facility_of(from_path: str) -> str:
    return from_path.rsplit("/", 1)[1]


def _not_current(facility: str) -> ApiError:
    return ApiError(409, NOT_CURRENT, f"ผล access ของ {facility} ไม่ตรงกับ scenario ปัจจุบันหรือยังไม่มี ให้กด Compute ก่อน")


def _read_json(data_dir: Path, path: Path) -> dict | None:
    """JSON object ในไฟล์ของ bundle ที่ต้องอยู่ใต้ data/ หลังตาม symlink อ่านไม่ได้หรือไม่ใช่ object = None"""
    try:
        real = path.resolve(strict=True)
        if not real.is_file() or not real.is_relative_to(data_dir.resolve()):
            return None
        data = json.loads(real.read_bytes())
    except (OSError, RuntimeError, ValueError):                 # ไม่มีไฟล์, symlink วนซ้ำ, JSON เสีย (รวม UnicodeDecodeError)
        return None
    return data if isinstance(data, dict) else None


def _ephem_manifest(directory: Path, plan: Plans, data_dir: Path) -> dict | None:
    """manifest ของ ephem ที่ current ไม่มีหรืออ่านไม่ได้ = None"""
    entry = ephem_entry(directory, plan)
    return _read_json(data_dir, directory / EPHEM_DIR / entry["hash"] / MANIFEST) if entry["status"] == "current" else None


def _checked(store: ScenarioStore, sc: str, if_match: str | None) -> tuple[dict, str]:
    """(เอกสาร, ETag) ของ scenario ตรวจ If-Match ก่อนทำอย่างอื่น (ไม่ส่ง = 412 หลังตรวจว่ามี scenario นี้อยู่ ไม่งั้น 404)"""
    doc, current = store.read(sc)
    check_etag(current, if_match if if_match is not None else "")
    return doc, current


def _json(body: dict, tag: str, status: int = 200) -> JSONResponse:
    return JSONResponse(body, status_code=status, headers=etag_header(tag))


@router.get("/scenarios/{sc}/access")
def list_accesses(sc: str, store: ScenarioStore = Depends(get_store), plans: PlanCache = Depends(get_plans)) -> JSONResponse:
    doc, tag = store.read(sc)
    entries = access_entries(store.path(sc), plans.get(sc))
    listed = [{**entry, "status": entries.get(_facility_of(entry["from"]), {}).get("status", "missing")}
              for entry in doc.get("accesses", [])]
    return _json({"accesses": listed}, tag)


@router.post("/scenarios/{sc}/access/compute")
def compute(sc: str, body: ComputeBody, if_match: str | None = Header(None), store: ScenarioStore = Depends(get_store),
            bus: EventBus = Depends(get_bus), plans: PlanCache = Depends(get_plans), jobs: JobManager = Depends(get_jobs),
            config: Config = Depends(get_config)) -> JSONResponse:
    doc, _ = _checked(store, sc, if_match)
    from_path, to = access.normalize(doc, body.from_, body.to)
    directory = store.path(sc)
    hidden = access.hidden_satellites(doc, _ephem_manifest(directory, plans.get(sc), config.data_dir))
    computed = access.expand_targets(doc, to, hidden)
    time_period = body.time_period.model_dump(exclude_none=True) if body.time_period is not None else None
    graphics = body.graphics.model_dump(exclude_none=True) if body.graphics is not None else None
    access.upsert(doc, from_path, to, time_period, graphics, body.timeline)
    tag, _ = write_tracked(store, bus, plans, sc, doc, if_match)
    facility = _facility_of(from_path)
    if access_entries(directory, plans.get(sc)).get(facility, {}).get("status") == "current":
        return _json({"computed": computed, "etag": tag}, tag)
    job = jobs.submit("analyze", sc, {"facility": facility})
    return _json({"job": job.id, "etag": tag}, tag, 202)


def _select(sc: str, body: SelectBody, if_match: str | None, store: ScenarioStore, bus: EventBus, plans: PlanCache,
            action, key: str) -> JSONResponse:
    doc, current = _checked(store, sc, if_match)
    count = action(doc, body.from_, body.to)
    if count == 0:                                              # ไม่มีรายการตรง: ไม่เขียน ไม่ส่ง event
        return _json({"etag": current, key: 0}, current)
    tag, _ = write_tracked(store, bus, plans, sc, doc, if_match)
    return _json({"etag": tag, key: count}, tag)


@router.post("/scenarios/{sc}/access/clear")
def clear_accesses(sc: str, body: SelectBody, if_match: str | None = Header(None), store: ScenarioStore = Depends(get_store),
                   bus: EventBus = Depends(get_bus), plans: PlanCache = Depends(get_plans)) -> JSONResponse:
    return _select(sc, body, if_match, store, bus, plans, access.clear, "cleared")


@router.post("/scenarios/{sc}/access/remove")
def remove_accesses(sc: str, body: SelectBody, if_match: str | None = Header(None), store: ScenarioStore = Depends(get_store),
                    bus: EventBus = Depends(get_bus), plans: PlanCache = Depends(get_plans)) -> JSONResponse:
    return _select(sc, body, if_match, store, bus, plans, access.remove, "removed")


@router.get("/scenarios/{sc}/access/intervals")
def get_intervals(sc: str, from_: str = Query(alias="from"), to: list[str] = Query(), store: ScenarioStore = Depends(get_store),
                  plans: PlanCache = Depends(get_plans), config: Config = Depends(get_config)) -> dict[str, list]:
    doc, _ = store.read(sc)
    from_path, targets = access.normalize(doc, from_, to)
    facility, directory, plan = _facility_of(from_path), store.path(sc), plans.get(sc)
    bundle = access_entries(directory, plan).get(facility)
    if bundle is None or bundle["status"] != "current":
        raise _not_current(facility)
    manifest = _ephem_manifest(directory, plan, config.data_dir)
    stored = _read_json(config.data_dir, directory / ACCESS_DIR / facility / bundle["hash"] / INTERVALS)
    by_prn = stored.get("intervals") if stored is not None else None
    if manifest is None or not isinstance(by_prn, dict):
        raise _not_current(facility)
    hidden, prns = access.hidden_satellites(doc, manifest), access.satellite_prns(doc, manifest)
    period = access.stored_time_period(doc, from_path, targets)
    out = {}
    for name in access.expand_targets(doc, targets, hidden):
        rows = by_prn.get(prns[name]) if name in prns and name not in hidden else None
        rows = rows if isinstance(rows, list) else []
        if period.get("mode") == access.MODE_SPECIFY:
            rows = access.clip_intervals(rows, parse_utc_z(period["start"]), parse_utc_z(period["stop"]))
        out[name] = rows
    return out
