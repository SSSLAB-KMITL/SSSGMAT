"""ค่าตั้งงานประจำวัน `data/settings.json` (หัวข้อ 9.1 ของ spec server)

- `Settings` (pydantic) รูปแบบตรง 9.1: `{"daily": {enabled, run_at_utc, facility, retention_days, validation_retry_hours,
  validation_give_up_days}, "cesium_ion_token": "", "online_imagery": {"enabled": false}}` ทุกช่องมีค่าตั้งต้นของ 9.1 ตรวจแบบ strict
  (ชนิดต้องตรง ไม่แปลง "30" เป็น 30)
  - `online_imagery.enabled`: ภาพออนไลน์ NASA GIBS ค่าตั้งต้น `false` ทุกกรณี (ไม่มีไฟล์ ไฟล์เสีย หรือไฟล์รุ่นเก่าที่ไม่มีช่องนี้):
    ต่างจาก `daily.enabled` ตรงที่ไม่มีค่า "อนุมัติแล้ว" ให้เปิดเอง ผู้ใช้ต้องเปิดเองเท่านั้น
  - `run_at_utc`: `HH:MM` ชั่วโมง 00-23 นาที 00-59, `facility`: ตรงกติกาชื่อ object, `retention_days` 1-3650,
    `validation_retry_hours` 1-168, `validation_give_up_days` 1-365
- `SettingsIn` / `DailyIn` / `OnlineImageryIn` คือรูปแบบของ body ที่ PUT: ไม่รับช่องที่ไม่รู้จัก (พิมพ์ชื่อช่องผิดต้องได้ 422) และ `missing_field` บอกช่องแรกที่
  ไม่ได้ส่ง (PUT ต้องส่งทั้งเอกสาร: ช่องที่หายจะไม่ถูกเติมเป็นค่าตั้งต้น เพราะค่าตั้งต้นของ `daily.enabled` คือเปิด)
- `load(data_dir)` ไม่มีการดึงข้อมูลจากเน็ตโดยที่ผู้ใช้ไม่ยินยอม:
  - ไม่มีไฟล์ = ค่าตั้งต้นของ 9.1 (เปิดงานประจำวัน เป็นการตั้งที่ผู้ใช้อนุมัติแล้ว) symlink ที่ชี้ไปไฟล์ที่ไม่มีไม่นับเป็น "ไม่มีไฟล์"
    (มีชื่อนี้อยู่แต่อ่านไม่ได้ = fail safe ข้างล่าง)
  - ไฟล์เสียหรือค่าผิด (ไม่ใช่ JSON, ชนิดหรือช่วงผิด ฯลฯ) = ค่าตั้งต้นแต่ `daily.enabled = False` (fail safe) พร้อม log เตือน
    ครั้งเดียวต่อสถานะของไฟล์ (path, mtime_ns, size): ตัวตั้งเวลาเรียก load ทุก 60 วินาที ไม่ควรท่วม log
  - ไฟล์ที่มีอยู่แต่ไม่ได้ระบุ `daily.enabled` เป็น true/false (ไม่มี `daily`, `daily` ว่าง หรือพิมพ์ชื่อช่องผิดเช่น `enable`) นับเป็นไม่ได้ยืนยัน
    = fail safe เหมือนไฟล์เสีย (PUT เขียน `enabled` เสมอ จึงกระทบเฉพาะไฟล์ที่แก้มือ)
  - ผ่อนปรนเฉพาะสิ่งที่ไม่เสียหาย: อ่านแบบ utf-8-sig (BOM ที่โปรแกรมแก้ไขบางตัวใส่ให้), ข้ามช่องที่ไม่รู้จัก, ช่องอื่นที่หายได้ค่าตั้งต้น
    (`{"daily": {"enabled": false}}` จึงโหลดเป็นปิดเสมอ)
- `save(data_dir, settings)`: เขียนแบบ atomic
"""

import json
import logging
import os
import threading
from pathlib import Path
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, ValidationError

from .schema import Name
from .store import write_atomic

SETTINGS_FILE = "settings.json"
TIME_PATTERN = r"^([01][0-9]|2[0-3]):[0-5][0-9]$"               # ระบุ [0-9] ตรง ๆ: \d ของ regex รับเลขอื่นนอก ASCII ด้วย

_logger = logging.getLogger(__name__)
_warned: dict[Path, tuple] = {}                                 # path -> (mtime_ns, size) ของไฟล์เสียที่เตือนไปแล้ว
_warned_lock = threading.Lock()


class _Model(BaseModel):
    model_config = ConfigDict(strict=True, extra="ignore")


class Daily(_Model):
    enabled: bool = True
    run_at_utc: Annotated[str, StringConstraints(pattern=TIME_PATTERN)] = "21:00"
    facility: Name = "THBK"
    retention_days: Annotated[int, Field(ge=1, le=3650)] = 30
    validation_retry_hours: Annotated[int, Field(ge=1, le=168)] = 3
    validation_give_up_days: Annotated[int, Field(ge=1, le=365)] = 14


class OnlineImagery(_Model):
    enabled: bool = False


class Settings(_Model):
    daily: Daily = Field(default_factory=Daily)
    cesium_ion_token: str = ""
    online_imagery: OnlineImagery = Field(default_factory=OnlineImagery)


class DailyIn(Daily):
    model_config = ConfigDict(extra="forbid")


class OnlineImageryIn(OnlineImagery):
    model_config = ConfigDict(extra="forbid")


class SettingsIn(Settings):
    """body ของ PUT /api/settings (ใช้ `Settings.model_validate(body.model_dump())` ก่อนบันทึก)"""
    model_config = ConfigDict(extra="forbid")
    daily: DailyIn = Field(default_factory=DailyIn)
    online_imagery: OnlineImageryIn = Field(default_factory=OnlineImageryIn)


def missing_field(model: BaseModel) -> str | None:
    """ช่องแรก (path แบบ `daily.run_at_utc`) ที่ผู้เรียกไม่ได้ส่งมาในเอกสาร ทุกระดับ หรือ None ถ้าส่งครบ"""
    return _missing(model, "")


def _missing(model: BaseModel, prefix: str) -> str | None:
    for name in type(model).model_fields:
        if name not in model.model_fields_set:
            return prefix + name
        value = getattr(model, name)
        if isinstance(value, BaseModel):
            inner = _missing(value, f"{prefix}{name}.")
            if inner is not None:
                return inner
    return None


def _reason(exc: Exception) -> str:
    if isinstance(exc, ValidationError):
        first = exc.errors()[0]
        return f"{'.'.join(str(p) for p in first['loc']) or 'ราก'}: {first['msg']}"
    return f"{type(exc).__name__}: {exc}"


def _fail_safe() -> Settings:
    """ค่าตั้งต้นที่ปิดงานประจำวัน: ใช้เมื่ออ่านไฟล์ค่าตั้งไม่ได้ ผู้ใช้ยังไม่ได้ยืนยันว่าจะให้ดึงข้อมูลเอง"""
    return Settings(daily=Daily(enabled=False))


def _signature(path: Path) -> tuple:
    try:
        st = path.stat()
        return st.st_mtime_ns, st.st_size
    except OSError:
        return None, None


def _warn_once(path: Path, reason: str, logger: logging.Logger) -> None:
    """เตือนเรื่องไฟล์เสียหนึ่งครั้งต่อสถานะของไฟล์ (mtime_ns, size) ไฟล์ที่ยังไม่เปลี่ยนไม่เตือนซ้ำ"""
    signature = _signature(path)
    with _warned_lock:
        if _warned.get(path) == signature:
            return
        _warned[path] = signature
    logger.warning("อ่าน %s ไม่ได้ ใช้ค่าตั้งต้นแต่ปิดงานประจำวันไว้ก่อน แก้ไฟล์หรือบันทึกค่าตั้งใหม่เพื่อเปิด (%s)", path, reason)


def load(data_dir: Path, logger: logging.Logger | None = None) -> Settings:
    """ค่าตั้งใน `<data_dir>/settings.json` (กติกาที่หัวไฟล์) ไฟล์ไม่ถูกแก้ ผู้ใช้แก้เองหรือ PUT ทับได้ ไม่ raise"""
    path = Path(data_dir) / SETTINGS_FILE
    try:
        loaded = Settings.model_validate(json.loads(path.read_bytes().decode("utf-8-sig")))
        if "enabled" not in loaded.daily.model_fields_set:      # ไม่มี daily ก็เข้าข้อนี้ (daily มาจากค่าตั้งต้น fields_set ว่าง)
            raise ValueError("daily.enabled: ต้องระบุเป็น true หรือ false อย่างชัดเจน")
    except FileNotFoundError as exc:
        if not os.path.lexists(path):
            return Settings()
        _warn_once(path, f"symlink ชี้ไปไฟล์ที่ไม่มี ({exc.filename or path})", logger or _logger)   # มีชื่ออยู่แต่อ่านไม่ได้
        return _fail_safe()
    except (OSError, ValueError, RecursionError) as exc:       # รวม UnicodeDecodeError, JSONDecodeError และ ValidationError
        _warn_once(path, _reason(exc), logger or _logger)
        return _fail_safe()
    with _warned_lock:
        _warned.pop(path, None)                                 # ไฟล์กลับมาใช้ได้: ถ้าเสียอีกต้องเตือนใหม่
    return loaded


def save(data_dir: Path, settings: Settings) -> None:
    """เขียน `<data_dir>/settings.json` แบบ atomic"""
    root = Path(data_dir)
    root.mkdir(parents=True, exist_ok=True)
    write_atomic(root / SETTINGS_FILE, (json.dumps(settings.model_dump(), ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
