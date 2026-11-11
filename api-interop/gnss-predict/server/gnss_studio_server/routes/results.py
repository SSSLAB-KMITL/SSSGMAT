"""ผลลัพธ์และการคำนวณ (หัวข้อ 6.5 ของ spec server)

- `GET /scenarios/{sc}/results`: hash ที่ scenario ปัจจุบันต้องใช้ (`plan_propagate`, `plan_analyze` ต่อ Facility ผ่าน `PlanCache`) เทียบกับ
  โฟลเดอร์ hash ที่มีบนดิสก์ ตอบ `{"ephem": {hash, status, available}, "access": {<Facility>: {...}}, "error": null | {code, text}}`
  - `available` คือชื่อโฟลเดอร์ hash ที่มีจริง เรียงตามตัวอักษร
  - `status`: `current` = hash ที่ต้องใช้อยู่ใน available, `stale` = มี bundle แต่ไม่ใช่ hash นี้ (ผลของ scenario รุ่นก่อน), `missing` = ไม่มีเลย
  - คำนวณ plan ไม่ได้ (snapshot หาย, ไม่มีดาว, scenario อ่านไม่ได้): hash เป็น null, status เป็น `missing` แม้มี bundle เก่า
    และ `error` เป็นรหัสของ engine ตอบ 200 เสมอ ไม่ใช่ 500
- `POST /scenarios/{sc}/propagate`: ส่ง job `propagate` เข้าคิว ตอบ 202 `{"job": id}` (job เดิมที่ยังรอ/รันอยู่ได้ id เดิม)
- `GET /scenarios/{sc}/ephem/{hash}/{file}` และ `.../access/{facility}/{hash}/{file}`: ส่งไฟล์ใน bundle เฉพาะชื่อที่ spec กำหนด
  ด้วย `ETag` เป็น SHA-256 เต็มของไฟล์ (มีเครื่องหมายคำพูด) และ `Cache-Control: public, max-age=31536000, immutable` เพราะ bundle
  ไม่เปลี่ยนหลังเขียน `If-None-Match` ที่ตรงตอบ 304 ชื่อไฟล์นอกรายการ ไม่มีไฟล์ hash หรือ Facility ผิดรูปแบบ ไฟล์ที่ชี้ออกนอก `data/`
  (symlink) ตอบ 404 NOT_FOUND ทั้งหมด hash และ Facility ถูกตรวจรูปแบบก่อนสร้าง path ทุกครั้ง
"""

import os
import re
from pathlib import Path

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import FileResponse

from ..config import Config
from ..digests import FileDigests
from ..errors import ApiError
from ..jobs import JobManager
from ..plans import PlanCache
from ..schema import NAME_RE
from ..store import ScenarioStore
from . import get_config, get_digests, get_jobs, get_plans, get_store

router = APIRouter()

EPHEM_DIR = "ephem"
ACCESS_DIR = "access"
HASH_RE = re.compile(r"[0-9a-f]{12}")
CACHE_CONTROL = "public, max-age=31536000, immutable"
JSON, TEXT, CSV = "application/json", "text/plain", "text/csv"
EPHEM_FILES = {"manifest.json": JSON, "scene.czml": JSON, "predicted.sp3": TEXT}
ACCESS_FILES = {"manifest.json": JSON, "access.czml": JSON, "intervals.json": JSON, "aer.csv": CSV, "dop.csv": CSV, "legacy_gps.csv": CSV}
NOT_FOUND_TEXT = "ไม่พบไฟล์ผลลัพธ์ที่ร้องขอ"


def _available(folder: Path) -> list[str]:
    """ชื่อโฟลเดอร์ hash (hex 12 ตัว) ใต้ folder เรียงตามตัวอักษร ไม่มี folder = ว่าง (ไม่รวมไฟล์ โฟลเดอร์ชั่วคราว และ symlink)"""
    try:
        with os.scandir(folder) as entries:
            return sorted(e.name for e in entries if HASH_RE.fullmatch(e.name) and e.is_dir(follow_symlinks=False))
    except OSError:
        return []


def _entry(hash_: str | None, available: list[str]) -> dict:
    if hash_ is None or not available:
        status = "missing"
    else:
        status = "current" if hash_ in available else "stale"
    return {"hash": hash_, "status": status, "available": available}


@router.get("/scenarios/{sc}/results")
def get_results(sc: str, store: ScenarioStore = Depends(get_store), plans: PlanCache = Depends(get_plans)) -> dict:
    directory = store.path(sc)
    plan = plans.get(sc)                                    # ไม่มี scenario -> 404
    return {"ephem": _entry(plan.propagate, _available(directory / EPHEM_DIR)),
            "access": {name: _entry(plan.analyze.get(name), _available(directory / ACCESS_DIR / name)) for name in plan.facilities},
            "error": plan.error}


@router.post("/scenarios/{sc}/propagate", status_code=202)
def propagate(sc: str, jobs: JobManager = Depends(get_jobs)) -> dict:
    return {"job": jobs.submit("propagate", sc, {}).id}


def _not_found() -> ApiError:
    return ApiError(404, "NOT_FOUND", NOT_FOUND_TEXT)


def _etag_matches(header: str | None, digest: str) -> bool:
    """If-None-Match (รายการคั่นด้วย , หรือ *) มี ETag ของไฟล์นี้ (เทียบแบบอ่อนได้ W/)"""
    if header is None:
        return False
    return any(tag.strip() in ("*", f'"{digest}"', f'W/"{digest}"') for tag in header.split(","))


def _send(request: Request, config: Config, digests: FileDigests, path: Path, media_type: str) -> Response:
    """ส่งไฟล์ใน bundle: ไฟล์ต้องมีจริงและอยู่ใต้ data/ หลังตาม symlink ทั้งหมด ไม่งั้น 404"""
    try:
        real = path.resolve(strict=True)
        if not real.is_file() or not real.is_relative_to(config.data_dir.resolve()):
            raise _not_found()
        digest = digests.sha256(real)
    except (OSError, RuntimeError):                        # ไม่มีไฟล์, อ่านไม่ได้, symlink วนซ้ำ
        raise _not_found() from None
    headers = {"ETag": f'"{digest}"', "Cache-Control": CACHE_CONTROL}
    if _etag_matches(request.headers.get("if-none-match"), digest):
        return Response(status_code=304, headers=headers)
    return FileResponse(real, media_type=media_type, headers=headers)


@router.get("/scenarios/{sc}/ephem/{hash}/{file}")
def get_ephem_file(sc: str, hash: str, file: str, request: Request, store: ScenarioStore = Depends(get_store),
                   config: Config = Depends(get_config), digests: FileDigests = Depends(get_digests)) -> Response:
    media_type = EPHEM_FILES.get(file)
    directory = store.path(sc)
    if media_type is None or not HASH_RE.fullmatch(hash):
        raise _not_found()
    return _send(request, config, digests, directory / EPHEM_DIR / hash / file, media_type)


@router.get("/scenarios/{sc}/access/{facility}/{hash}/{file}")
def get_access_file(sc: str, facility: str, hash: str, file: str, request: Request, store: ScenarioStore = Depends(get_store),
                    config: Config = Depends(get_config), digests: FileDigests = Depends(get_digests)) -> Response:
    media_type = ACCESS_FILES.get(file)
    directory = store.path(sc)
    if media_type is None or not NAME_RE.fullmatch(facility) or not HASH_RE.fullmatch(hash):
        raise _not_found()
    return _send(request, config, digests, directory / ACCESS_DIR / facility / hash / file, media_type)
