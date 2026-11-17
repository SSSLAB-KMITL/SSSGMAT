"""ข้อมูลวงโคจรและรายชื่อดาว (หัวข้อ 6.2 ของ spec server)

- `GET /orbits`: snapshot ใต้ `data/orbits/` ใหม่สุดก่อน นับจำนวนดาวต่อกลุ่มจากไฟล์ JSON ตรง ๆ (ไม่สร้าง catalog) ไฟล์กลุ่มที่ไม่มีหรืออ่านไม่ได้
  ไม่อยู่ใน `groups` และ snapshot เสียอันเดียวไม่ทำให้รายการทั้งหมดล้ม
- `POST /orbits/fetch`: ส่ง job `fetch` เข้าคิว ตอบ 202 `{"job": id}` (job เดิมที่ยังรอ/รันอยู่ได้ id เดิม)
- `GET /orbits/fetch-status`: เวลาที่ส่งคำขอไป CelesTrak ล่าสุดของแต่ละกลุ่มและเวลาที่ส่งได้อีกครั้ง อ่านอย่างเดียวจากไฟล์ที่ engine เขียน
  (`<data>/orbits/_cache/celestrak_state.json`) ไม่ดึงเน็ต ไม่ส่ง job ไม่สร้างไฟล์หรือโฟลเดอร์
- `GET /catalog`: ดาว GNSS ใน snapshot เรียงตาม PRN ณ ช่วงเวลาที่ส่งมา แล้วต่อท้ายด้วยดาวถ่ายภาพ X01…X08 (ระบบ `X`) ที่มีในไฟล์กลุ่ม
  weather/science/visual ของ snapshot ทุกแถวบอก `category` (`gnss` | `imaging`) และ `display_name` (ชื่อ preset ของดาว X,
  ชื่อ CelesTrak ของ GNSS) แถว too_old ยังอยู่ในรายการ (การซ่อนเป็นหน้าที่ตัวกรองของเว็บ)
- `GET /imaging/presets`: ตาราง preset ของดาวถ่ายภาพ (รหัส, NORAD, ชื่อ, กล้อง, ชั้นภาพ GIBS, Sensor หลัก) คงที่ ไม่อ่าน snapshot ไม่ต่อเน็ต
"""

import json
from datetime import timedelta
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from gnss_predict.catalog import broadcast_file
from gnss_predict.config import CELESTRAK_MIN_INTERVAL_S, CELESTRAK_STATE_FILE, GNSS_GROUPS
from gnss_predict.imaging import IMAGING_LETTER, IMAGING_SATELLITES, preset_by_norad
# ฟังก์ชันอ่านไฟล์สถานะของ engine (ขึ้นต้นด้วย _ แต่คงที่): ใช้ตัวเดียวกับที่ engine เขียนและอ่าน เวลารูปแบบเดียวกันเสมอ
from gnss_predict.omm import _parse_time, _read_state
from gnss_predict.studio import CACHE_DIR

from ..config import Config
from ..errors import ApiError
from ..jobs import JobManager, iso_ms
from ..templates import ORBITS_DIR, iso_utc, load_catalog, parse_utc, resolve_snapshot, snapshot_names, snapshot_time
from . import get_config, get_jobs

router = APIRouter()

DEFAULT_PERIOD = timedelta(days=1)
MIN_FETCH_INTERVAL = timedelta(seconds=CELESTRAK_MIN_INTERVAL_S)
DEFAULT_FETCH_SYSTEMS = "".join(GNSS_GROUPS)


CATALOG_SYSTEMS = (*GNSS_GROUPS, IMAGING_LETTER)


class FetchRequest(BaseModel):
    systems: str = DEFAULT_FETCH_SYSTEMS


class SensorDefinitionOut(BaseModel):
    """Sensor หลักของ preset: Simple Conic ใช้ cone_half_angle, Rectangular ใช้ vertical/horizontal (ช่องของอีกชนิดเป็น null)"""
    type: Literal["Simple Conic", "Rectangular"]
    cone_half_angle: float | None
    vertical_half_angle: float | None
    horizontal_half_angle: float | None


class ImagingPresetOut(BaseModel):
    prn: str
    norad: int
    name: str
    camera: str
    gibs_layer: str
    sensor: SensorDefinitionOut


def _group_count(path: Path) -> int | None:
    """จำนวนดาว (จำนวน object ใน array) ของไฟล์ OMM ของกลุ่ม ไม่มีไฟล์ อ่านไม่ได้ ไม่ใช่ JSON หรือไม่ใช่ array ของ object = None"""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, RecursionError):            # ValueError รวม JSONDecodeError และ UnicodeDecodeError
        return None
    if not isinstance(data, list) or not all(isinstance(item, dict) for item in data):
        return None
    return len(data)


def _snapshot_entry(folder: Path) -> dict:
    groups = {}
    for system, group in GNSS_GROUPS.items():
        count = _group_count(folder / f"{group}.json")
        if count is not None:
            groups[system] = count
    return {"name": folder.name, "time_utc": iso_utc(snapshot_time(folder.name)), "groups": groups,
            "has_brdc": broadcast_file(folder) is not None}


@router.get("/orbits")
def list_orbits(config: Config = Depends(get_config)) -> list[dict]:
    return [_snapshot_entry(config.data_dir / ORBITS_DIR / name) for name in snapshot_names(config.data_dir)]


@router.post("/orbits/fetch", status_code=202)
def fetch_orbits(body: FetchRequest | None = None, jobs: JobManager = Depends(get_jobs)) -> dict:
    """ตัวอักษรระบบผิด -> 422 ที่ field systems (ตรวจโดยคิว job)"""
    systems = body.systems if body is not None else DEFAULT_FETCH_SYSTEMS
    return {"job": jobs.submit("fetch", None, {"systems": systems}).id}


def _read_fetch_state(path: Path) -> dict:
    """เนื้อไฟล์สถานะ CelesTrak ของ engine ไม่มีไฟล์ อ่านไม่ได้ หรือเสีย = {} (RecursionError: JSON ซ้อนลึกเกินที่ json อ่านได้ ถือว่าเสีย)"""
    try:
        return _read_state(path)
    except RecursionError:
        return {}


def _group_fetch_status(entry: object) -> dict:
    """{last_request_utc, next_allowed_utc} ของกลุ่มหนึ่ง: entry ไม่ใช่ dict หรือ last_request อ่านไม่ได้ (รูปแบบเวลาของ engine เท่านั้น) = null ทั้งคู่"""
    last = _parse_time(entry.get("last_request")) if isinstance(entry, dict) else None
    if last is not None:
        try:
            return {"last_request_utc": iso_utc(last), "next_allowed_utc": iso_utc(last + MIN_FETCH_INTERVAL)}
        except OverflowError:                       # ปลายช่วงเวลาที่รองรับ: บวกไม่ได้
            pass
    return {"last_request_utc": None, "next_allowed_utc": None}


@router.get("/orbits/fetch-status")
def fetch_status(config: Config = Depends(get_config)) -> dict:
    """ต่อกลุ่ม CelesTrak: เวลาคำขอล่าสุด และเวลาที่ส่งได้อีกครั้ง (= คำขอล่าสุด + CELESTRAK_MIN_INTERVAL_S) null = ไม่เคยส่งหรืออ่านไม่ได้
    ไฟล์หายหรือเสียก็ตอบ 200 (ทุกกลุ่ม null) หน้า Fetch Orbit Data ใช้บอกเวลาที่กด Fetch Now ได้ ตัว server ไม่ดึงเอง"""
    state = _read_fetch_state(config.data_dir / ORBITS_DIR / CACHE_DIR / CELESTRAK_STATE_FILE)
    return {"groups": {group: _group_fetch_status(state.get(group)) for group in GNSS_GROUPS.values()}}


@router.get("/imaging/presets", response_model=list[ImagingPresetOut])
def imaging_presets() -> list[ImagingPresetOut]:
    """preset X01…X08 ตามลำดับ (ตารางเดียวของ engine: gnss_predict.imaging) เว็บรู้ว่าดาวใดเป็นดาวถ่ายภาพจาก NORAD"""
    return [ImagingPresetOut(prn=p.prn, norad=p.norad, name=p.name, camera=p.camera, gibs_layer=p.gibs_layer,
                             sensor=SensorDefinitionOut(type=p.sensor.type, cone_half_angle=p.sensor.cone_half_angle,
                                                        vertical_half_angle=p.sensor.vertical_half_angle,
                                                        horizontal_half_angle=p.sensor.horizontal_half_angle))
            for p in IMAGING_SATELLITES]


def _display_name(sat) -> str:
    """ชื่อที่แสดง: ชื่อ preset ของดาวถ่ายภาพ (เช่น Terra) ชื่อ CelesTrak ของ GNSS"""
    preset = preset_by_norad(sat.norad) if sat.system == IMAGING_LETTER else None
    return preset.name if preset is not None else sat.celestrak_name


@router.get("/catalog")
def get_catalog(snapshot: str | None = None, start: str | None = None, stop: str | None = None, system: str | None = None,
                q: str | None = None, config: Config = Depends(get_config)) -> list[dict]:
    """snapshot ไม่ระบุ = ใหม่สุด, start ไม่ระบุ = เวลาในชื่อ snapshot, stop ไม่ระบุ = start + 1 วัน (age_days วัดที่กลางช่วง)
    system ต้องเป็น G R E C หรือ X (ดาวถ่ายภาพ; ไม่ระบุ = ทุกระบบ) q ค้นแบบไม่แยกตัวพิมพ์ใน PRN, NORAD, ชื่อ CelesTrak และชื่อที่แสดง"""
    if system is not None and system not in CATALOG_SYSTEMS:
        raise ApiError(422, "SCENARIO_INVALID", f"ระบบดาวเทียมต้องเป็นหนึ่งใน {', '.join(CATALOG_SYSTEMS)} ไม่ใช่ '{system}'", "system")
    name = resolve_snapshot(config.data_dir, snapshot)
    if start is not None:
        start_t = parse_utc(start, "start")
    else:
        start_t = snapshot_time(name)
        if start_t is None:
            raise ApiError(422, "SCENARIO_INVALID", f"ชื่อ snapshot {name} ไม่บอกเวลา ต้องระบุ start", "start")
    if stop is not None:
        stop_t = parse_utc(stop, "stop")
    else:
        try:
            stop_t = start_t + DEFAULT_PERIOD
        except OverflowError:
            raise ApiError(422, "SCENARIO_INVALID", "start อยู่ใกล้ปลายช่วงเวลาที่รองรับจนบวก 1 วันไม่ได้ ต้องระบุ stop", "stop") from None
    if stop_t <= start_t:
        raise ApiError(422, "SCENARIO_INVALID", "stop ต้องหลัง start", "stop")

    needle = q.casefold() if q else None
    rows = []
    for sat in load_catalog(config.data_dir, name, start_t, stop_t).satellites:
        display_name = _display_name(sat)
        if system is not None and sat.system != system:
            continue
        if needle is not None and not (needle in sat.prn.casefold() or needle in str(sat.norad)
                                       or needle in sat.celestrak_name.casefold() or needle in display_name.casefold()):
            continue
        rows.append({"prn": sat.prn, "system": sat.system, "svn": sat.svn, "norad": sat.norad, "block": sat.block,
                     "celestrak_name": sat.celestrak_name, "omm_epoch": iso_ms(sat.omm_epoch), "age_days": round(sat.age_days, 3),
                     "flags": sorted(sat.flags), "category": "imaging" if sat.system == IMAGING_LETTER else "gnss",
                     "display_name": display_name})
    return rows
