"""ค่าตั้ง (หัวข้อ 6.1 และ 9.1 ของ spec server)

- `GET /settings`: ค่าตั้งที่บันทึกไว้ ไม่มีไฟล์ (หรือไฟล์เสีย) ได้ค่าตั้งต้นของ 9.1
- `PUT /settings`: รับเอกสารค่าตั้งทั้งก้อน (ช่องที่ไม่ส่งได้ค่าตั้งต้น) ตรวจแล้วบันทึกแบบ atomic แล้วเรียก
  `app.state.settings_on_change(settings)` หนึ่งครั้ง (ตัวตั้งเวลาอ่านค่าใหม่ผ่านตัวนี้) ตอบค่าที่บันทึก ค่าผิด -> 422 ที่ field แบบ
  `daily.run_at_utc` โดยไม่บันทึกและไม่เรียก callback callback ล้มเหลวแค่ log: ค่าตั้งบันทึกไปแล้ว
"""

import logging

from fastapi import APIRouter, Depends, Request

from ..config import Config
from ..settings import Settings, load, save
from . import get_config, get_logger

router = APIRouter()


@router.get("/settings")
def get_settings(config: Config = Depends(get_config), logger: logging.Logger = Depends(get_logger)) -> dict:
    return load(config.data_dir, logger).model_dump()


@router.put("/settings")
def put_settings(new: Settings, request: Request, config: Config = Depends(get_config),
                 logger: logging.Logger = Depends(get_logger)) -> dict:
    save(config.data_dir, new)
    try:
        request.app.state.settings_on_change(new)
    except Exception:                                      # บันทึกสำเร็จแล้ว: ตอบ 500 จะทำให้ผู้ใช้เข้าใจว่าไม่ได้บันทึก
        logger.exception("บันทึกค่าตั้งแล้ว แต่แจ้งการเปลี่ยนค่าตั้งให้ตัวตั้งเวลาไม่สำเร็จ")
    return new.model_dump()
