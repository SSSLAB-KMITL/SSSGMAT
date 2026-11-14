"""ภาพถ่ายออนไลน์ NASA GIBS (spec ภาพออนไลน์ §4.2)

- `GET /imagery/layers`: รายการชั้นภาพและสวิตช์ `online_imagery.enabled` ไม่ต่อเน็ต ใช้ได้เสมอแม้สวิตช์ปิด
- `GET /imagery/tiles/{layer}/{time}/{z}/{y}/{x}`: ไบต์ของชิ้นภาพ ตรวจตามลำดับ (ไม่ผ่านข้อใด ตอบทันที ไม่ต่อเน็ต ไม่แตะดิสก์):
  สวิตช์ปิด 403 `IMAGERY_DISABLED` (แม้ชิ้นนั้นอยู่ใน cache) -> ไม่รู้จักชั้นภาพ 404 `IMAGERY_UNKNOWN_LAYER` -> เวลาผิดรูปแบบของรอบภาพ
  422 field `time` -> z, y, x ไม่ใช่จำนวนเต็มทศนิยมในช่วง 422 field `z`/`y`/`x`
  ผ่านแล้วส่งต่อให้ `TileFetcher` (app.state.imagery) ที่ส่งจาก cache หรือดึงจาก GIBS ตอบด้วย `Content-Type` ที่ server กำหนดจากชนิดภาพที่ตรวจได้
  กับ `X-Content-Type-Options: nosniff` และ `Cache-Control: private, max-age=86400` (ชิ้นที่ยังไม่นิ่ง: `Cache-Control: no-store`
  เพราะ server ไม่เก็บชิ้นนั้นและภาพอาจเปลี่ยนภายหลัง; นิ่งหรือยังตัดสินโดย `TileFetcher.is_settled`)
- z, y, x รับเป็นสตริงแล้วแปลงเอง: ตัวแปลง int ของ FastAPI ยอมรับ `+1` และ ` 1` ซึ่งต้องไม่ผ่าน
- สวิตช์อ่านจาก settings.json ทุกคำขอ (ไฟล์เล็ก): PUT /api/settings มีผลทันทีโดยไม่ต้องมี callback
"""

import logging
from typing import Literal

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from pydantic import BaseModel

from ..config import Config
from ..errors import ApiError
from ..imagery import CATALOG, DISABLED_TEXT, TileFetcher, check_time, layer_by_id, parse_tile_coords
from ..settings import load as load_settings
from . import get_config, get_imagery, get_logger

router = APIRouter()

UNKNOWN_LAYER_TEXT = "ไม่รู้จักชั้นภาพนี้"
SETTLED_HEADERS = {"X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=86400"}
UNSETTLED_HEADERS = {"X-Content-Type-Options": "nosniff", "Cache-Control": "no-store"}


class LayerOut(BaseModel):
    id: str
    title: str
    period: Literal["static", "daily", "10min"]
    max_level: int
    format: Literal["jpg", "png"]
    credit: str


class LayersOut(BaseModel):
    enabled: bool
    layers: list[LayerOut]


def imagery_enabled(config: Config, logger: logging.Logger) -> bool:
    """สวิตช์ `online_imagery.enabled` ตอนนี้ (อ่านไฟล์ทุกครั้ง): route อ่านทุกคำขอ และ app ส่งให้ `TileFetcher` ตรวจซ้ำก่อนต่อเน็ต"""
    return load_settings(config.data_dir, logger).online_imagery.enabled


@router.get("/imagery/layers", response_model=LayersOut)
def get_layers(config: Config = Depends(get_config), logger: logging.Logger = Depends(get_logger)) -> LayersOut:
    layers = [LayerOut(id=layer.id, title=layer.title, period=layer.period, max_level=layer.max_level, format=layer.ext,
                       credit=layer.credit) for layer in CATALOG]
    return LayersOut(enabled=imagery_enabled(config, logger), layers=layers)


@router.get("/imagery/tiles/{layer}/{time}/{z}/{y}/{x}", response_class=Response,
            responses={200: {"description": "ภาพ JPEG หรือ PNG ของชิ้นภาพ",
                             "content": {"image/jpeg": {"schema": {"type": "string", "format": "binary"}},
                                         "image/png": {"schema": {"type": "string", "format": "binary"}}}}})
def get_tile(layer: str, time: str, z: str, y: str, x: str, config: Config = Depends(get_config),
             logger: logging.Logger = Depends(get_logger), fetcher: TileFetcher = Depends(get_imagery)) -> Response:
    if not imagery_enabled(config, logger):
        raise ApiError(403, "IMAGERY_DISABLED", DISABLED_TEXT)
    found = layer_by_id(layer)
    if found is None:
        raise ApiError(404, "IMAGERY_UNKNOWN_LAYER", UNKNOWN_LAYER_TEXT)
    check_time(found, time)
    zi, yi, xi = parse_tile_coords(found, z, y, x)
    settled = fetcher.is_settled(found, time)             # อ่านก่อนดึง: นิ่งก่อนดึงย่อมนิ่งตอนดึง (ไม่มีทางส่ง max-age ให้ชิ้นที่ไม่ได้ cache)
    data, media_type = fetcher.get(found, time, zi, yi, xi)
    return Response(content=data, media_type=media_type, headers=SETTLED_HEADERS if settled else UNSETTLED_HEADERS)
