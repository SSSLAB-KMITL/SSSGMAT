"""Validation (หัวข้อ 6.8 ของ spec server): สั่งตรวจ ประวัติ และผลรายวัน

- `POST /scenarios/{sc}/validate` `{day, sp3?}`: ส่ง job `validate` ตอบ 202 `{"job": id}` ตรวจ `day` (YYYY-MM-DD ที่มีจริง) และ `sp3`
  (path ใต้ `data/`) ที่ `JobManager.submit` ที่เดียว ไม่มี scenario -> 404 (job ซ้ำที่ยังรอ/รันอยู่ได้ id เดิม)
- `GET /validation/history`: บรรทัดของ `data/validation/history.jsonl` ที่แปลงแล้ว ตามลำดับในไฟล์ บรรทัดที่อ่านไม่ได้ (ไม่ใช่ JSON,
  ไม่ใช่ object, มี NaN/Infinity ซึ่งส่งเป็น JSON ไม่ได้, UTF-8 เสีย) ข้ามพร้อม log ไม่มีไฟล์ = `[]`
- `GET /validation/{sc}/{day}`: เนื้อ `validation_<day>.json` หาตามลำดับ (1) ephem bundle ที่ current ของ scenario (2)
  `data/validation/<sc>/` ซึ่งเป็นที่ที่การเก็บรักษา (Task 11) ย้ายไปไว้ก่อนลบ `ephem/` (ใช้ได้แม้ scenario ถูกลบไปแล้ว)
  ไม่มีทั้งสองที่ ไฟล์เสีย หรือไม่ใช่ JSON object -> 404 NOT_FOUND (ไฟล์เสียมี log) bundle ที่ stale ไม่นับเป็น current
  ทุกไฟล์ต้องอยู่ใต้ `data/` หลังตาม symlink ไม่งั้นถือว่าไม่มี
"""

import json
import logging
import math
from pathlib import Path

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict

from gnss_predict.studio import HISTORY_FILE, VALIDATION_DIR

from ..config import Config
from ..errors import ApiError
from ..jobs import JobManager
from ..plans import PlanCache
from ..schema import check_day
from ..store import ScenarioStore
from . import get_config, get_jobs, get_logger, get_plans, get_store
from .results import EPHEM_DIR, ephem_entry

router = APIRouter()

NOT_FOUND_TEXT = "ไม่พบผลการตรวจสอบของ scenario และวันที่นี้"


class ValidateBody(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")
    day: str
    sp3: str | None = None


@router.post("/scenarios/{sc}/validate", status_code=202)
def validate(sc: str, body: ValidateBody, jobs: JobManager = Depends(get_jobs)) -> dict:
    params = {"day": body.day}
    if body.sp3 is not None:                                # "" ก็ส่งต่อ: jobs.submit ปฏิเสธเอง
        params["sp3"] = body.sp3
    return {"job": jobs.submit("validate", sc, params).id}


# ---------- อ่านไฟล์ใต้ data/ ----------

def _reject_constant(name: str):
    raise ValueError(f"ค่า {name} ไม่ใช่ JSON ที่ส่งต่อได้")


def _finite(text: str) -> float:
    value = float(text)
    if not math.isfinite(value):                            # เช่น 1e999
        raise ValueError(f"ค่า {text} ใหญ่เกินกว่าจะส่งเป็น JSON")
    return value


def _loads(raw: bytes):
    """JSON ที่ปฏิเสธ NaN/Infinity/1e999 (ส่งออกเป็น JSON ไม่ได้) และ UTF-8 เสีย"""
    return json.loads(raw.decode("utf-8"), parse_constant=_reject_constant, parse_float=_finite)


def _safe_file(data_dir: Path, path: Path, logger: logging.Logger) -> Path | None:
    """path จริงของไฟล์ที่ต้องอยู่ใต้ data/ หลังตาม symlink ไม่มีไฟล์ = None เงียบ ๆ ออกนอก data/ หรือไม่ใช่ไฟล์ = None พร้อม log"""
    try:
        real = path.resolve(strict=True)
        if not real.is_relative_to(data_dir.resolve()):
            logger.warning("ไม่อ่าน %s: ชี้ออกนอก data/", path)
            return None
        if not real.is_file():
            logger.warning("ไม่อ่าน %s: ไม่ใช่ไฟล์", path)
            return None
    except (FileNotFoundError, NotADirectoryError):
        return None
    except (OSError, RuntimeError) as exc:                  # symlink วนซ้ำ, สิทธิ์
        logger.warning("ไม่อ่าน %s: %s", path, exc)
        return None
    return real


def _read_object(data_dir: Path, path: Path, logger: logging.Logger) -> dict | None:
    """JSON object ในไฟล์ ไม่มี อ่านไม่ได้ หรือไม่ใช่ object = None (กรณีที่ไฟล์มีอยู่แต่ใช้ไม่ได้มี log)"""
    real = _safe_file(data_dir, path, logger)
    if real is None:
        return None
    try:
        data = _loads(real.read_bytes())
    except (OSError, ValueError, RecursionError) as exc:    # รวม UnicodeDecodeError และ JSONDecodeError
        logger.warning("ไม่อ่าน %s: %s: %s", path, type(exc).__name__, exc)
        return None
    if not isinstance(data, dict):
        logger.warning("ไม่อ่าน %s: ราก JSON ต้องเป็น object", path)
        return None
    return data


# ---------- ประวัติ ----------

@router.get("/validation/history")
def history(config: Config = Depends(get_config), logger: logging.Logger = Depends(get_logger)) -> list[dict]:
    path = config.data_dir / VALIDATION_DIR / HISTORY_FILE
    real = _safe_file(config.data_dir, path, logger)
    if real is None:
        return []
    try:
        raw = real.read_bytes()
    except OSError as exc:
        logger.warning("ไม่อ่าน %s: %s", path, exc)
        return []
    records = []
    for number, line in enumerate(raw.splitlines(), 1):
        if not line.strip():
            continue
        try:
            record = _loads(line)
        except (ValueError, RecursionError) as exc:
            logger.warning("ข้ามบรรทัด %d ของ %s: อ่านไม่ได้ (%s)", number, HISTORY_FILE, exc)
            continue
        if not isinstance(record, dict):
            logger.warning("ข้ามบรรทัด %d ของ %s: ไม่ใช่ JSON object", number, HISTORY_FILE)
            continue
        records.append(record)
    return records


# ---------- ผลรายวัน ----------

def _current_bundle(directory: Path, sc: str, plans: PlanCache) -> Path | None:
    """โฟลเดอร์ ephem ที่ current ของ scenario หรือ None (ไม่มี scenario, ยังไม่ได้คำนวณ, หรือผลที่มีเป็นของ scenario รุ่นก่อน)"""
    try:
        entry = ephem_entry(directory, plans.get(sc))
    except ApiError:                                        # ไม่มี scenario (ผลที่ย้ายไป data/validation/ ยังอ่านได้)
        return None
    return directory / EPHEM_DIR / entry["hash"] if entry["status"] == "current" else None


@router.get("/validation/{sc}/{day}")
def get_day(sc: str, day: str, store: ScenarioStore = Depends(get_store), plans: PlanCache = Depends(get_plans),
            config: Config = Depends(get_config), logger: logging.Logger = Depends(get_logger)) -> dict:
    directory = store.path(sc)
    check_day(day, "day")
    name = f"validation_{day}.json"
    bundle = _current_bundle(directory, sc, plans)
    for path in ([bundle / name] if bundle is not None else []) + [config.data_dir / VALIDATION_DIR / sc / name]:
        found = _read_object(config.data_dir, path, logger)
        if found is not None:
            return found
    raise ApiError(404, "NOT_FOUND", NOT_FOUND_TEXT)
