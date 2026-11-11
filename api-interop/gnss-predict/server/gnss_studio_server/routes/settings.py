"""ค่าตั้ง (หัวข้อ 6.1 และ 9.1 ของ spec server)

- `GET /settings`: ค่าตั้งที่บันทึกไว้ ไม่มีไฟล์ได้ค่าตั้งต้นของ 9.1 ไฟล์เสียได้ค่าตั้งต้นที่ปิดงานประจำวัน (ดู settings.py)
- `PUT /settings`: รับเอกสารค่าตั้ง **ทั้งก้อน** ช่องที่หายที่ระดับใดก็ได้ -> 422 ที่ field แบบ `daily.retention_days` ไม่เติมค่าตั้งต้นให้
  (ค่าตั้งต้นของ `daily.enabled` คือเปิด การส่งมาไม่ครบจึงต้องไม่ทำให้งานดึงข้อมูลเปิดขึ้นเอง) ค่าผิดหรือช่องที่ไม่รู้จัก -> 422 ที่ field แบบ
  `daily.run_at_utc` ผ่านแล้วบันทึกแบบ atomic แล้วเรียก `app.state.settings_on_change(settings)` หนึ่งครั้ง
  (ตัวตั้งเวลาอ่านค่าใหม่ผ่านตัวนี้) ตอบค่าที่บันทึก ผิดแล้วไม่บันทึกและไม่เรียก callback
  callback ล้มเหลวแค่ log: ค่าตั้งบันทึกไปแล้ว
- บันทึกและเรียก callback ทำใต้ล็อกเดียว PUT ที่ซ้อนกันจึงเรียงทีละตัว: ไฟล์สุดท้ายกับ callback ครั้งสุดท้ายเป็นค่าเดียวกันเสมอ
"""

import logging
import threading

from fastapi import APIRouter, Depends, Request

from ..config import Config
from ..errors import ApiError
from ..settings import Settings, SettingsIn, load, missing_field, save
from . import get_config, get_logger

router = APIRouter()

MISSING_TEXT = "ต้องส่งค่าตั้งครบทั้งเอกสาร ขาดช่อง {field}"
_put_lock = threading.Lock()


@router.get("/settings")
def get_settings(config: Config = Depends(get_config), logger: logging.Logger = Depends(get_logger)) -> dict:
    return load(config.data_dir, logger).model_dump()


@router.put("/settings")
def put_settings(body: SettingsIn, request: Request, config: Config = Depends(get_config),
                 logger: logging.Logger = Depends(get_logger)) -> dict:
    field = missing_field(body)
    if field is not None:
        raise ApiError(422, "SCENARIO_INVALID", MISSING_TEXT.format(field=field), field, "Field required")
    new = Settings.model_validate(body.model_dump())
    with _put_lock:
        save(config.data_dir, new)
        try:
            request.app.state.settings_on_change(new)
        except Exception:                                  # บันทึกสำเร็จแล้ว: ตอบ 500 จะทำให้ผู้ใช้เข้าใจว่าไม่ได้บันทึก
            logger.exception("บันทึกค่าตั้งแล้ว แต่แจ้งการเปลี่ยนค่าตั้งให้ตัวตั้งเวลาไม่สำเร็จ")
    return new.model_dump()
