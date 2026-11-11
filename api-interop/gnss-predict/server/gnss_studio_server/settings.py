"""ค่าตั้งงานประจำวัน `data/settings.json` (หัวข้อ 9.1 ของ spec server)

- `Settings` (pydantic) รูปแบบตรง 9.1: `{"daily": {enabled, run_at_utc, facility, retention_days, validation_retry_hours,
  validation_give_up_days}, "cesium_ion_token": ""}` ทุกช่องมีค่าตั้งต้นของ 9.1 ตรวจแบบ strict (ชนิดต้องตรง ไม่แปลง "30" เป็น 30)
  และไม่รับช่องที่ไม่รู้จัก (พิมพ์ชื่อช่องผิดต้องได้ 422 ไม่ใช่ถูกเมินเงียบ ๆ)
  - `run_at_utc`: `HH:MM` ชั่วโมง 00-23 นาที 00-59, `facility`: ตรงกติกาชื่อ object, `retention_days` 1-3650,
    `validation_retry_hours` 1-168, `validation_give_up_days` 1-365
- `load(data_dir)`: ไม่มีไฟล์ = ค่าตั้งต้น ไฟล์เสียหรือค่าผิด = ค่าตั้งต้นพร้อม log เตือน (ไม่ทำให้ server หรือตัวตั้งเวลาล้ม)
- `save(data_dir, settings)`: เขียนแบบ atomic
- `ignore_change`: ค่าตั้งต้นของ `app.state.settings_on_change` ที่ PUT /api/settings เรียกหลังบันทึกแล้ว (ตัวตั้งเวลาแทนที่ใน Task 11)
"""

import json
import logging
from pathlib import Path
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, ValidationError

from .schema import Name
from .store import write_atomic

SETTINGS_FILE = "settings.json"
TIME_PATTERN = r"^([01][0-9]|2[0-3]):[0-5][0-9]$"               # ระบุ [0-9] ตรง ๆ: \d ของ regex รับเลขอื่นนอก ASCII ด้วย

_logger = logging.getLogger(__name__)


class _Model(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")


class Daily(_Model):
    enabled: bool = True
    run_at_utc: Annotated[str, StringConstraints(pattern=TIME_PATTERN)] = "21:00"
    facility: Name = "THBK"
    retention_days: Annotated[int, Field(ge=1, le=3650)] = 30
    validation_retry_hours: Annotated[int, Field(ge=1, le=168)] = 3
    validation_give_up_days: Annotated[int, Field(ge=1, le=365)] = 14


class Settings(_Model):
    daily: Daily = Field(default_factory=Daily)
    cesium_ion_token: str = ""


def _reason(exc: Exception) -> str:
    if isinstance(exc, ValidationError):
        first = exc.errors()[0]
        return f"{'.'.join(str(p) for p in first['loc']) or 'ราก'}: {first['msg']}"
    return f"{type(exc).__name__}: {exc}"


def load(data_dir: Path, logger: logging.Logger | None = None) -> Settings:
    """ค่าตั้งใน `<data_dir>/settings.json` ไม่มีไฟล์ = ค่าตั้งต้น ไฟล์อ่านไม่ได้ ไม่ใช่ JSON หรือค่าไม่ผ่านการตรวจ = ค่าตั้งต้น
    พร้อม log เตือนที่ `logger` (ค่าตั้งต้น: logger ของโมดูล) ไฟล์ไม่ถูกแก้ ผู้ใช้แก้เองหรือ PUT ทับได้"""
    path = Path(data_dir) / SETTINGS_FILE
    try:
        return Settings.model_validate(json.loads(path.read_bytes().decode("utf-8")))
    except FileNotFoundError:
        return Settings()
    except (OSError, ValueError, RecursionError) as exc:       # รวม UnicodeDecodeError, JSONDecodeError และ ValidationError
        (logger or _logger).warning("อ่าน %s ไม่ได้ ใช้ค่าตั้งต้นแทน (%s)", path, _reason(exc))
        return Settings()


def save(data_dir: Path, settings: Settings) -> None:
    """เขียน `<data_dir>/settings.json` แบบ atomic"""
    root = Path(data_dir)
    root.mkdir(parents=True, exist_ok=True)
    write_atomic(root / SETTINGS_FILE, (json.dumps(settings.model_dump(), ensure_ascii=False, indent=2) + "\n").encode("utf-8"))


def ignore_change(new: Settings) -> None:
    """ตัวตั้งต้นของ `app.state.settings_on_change`: ไม่ทำอะไร"""
