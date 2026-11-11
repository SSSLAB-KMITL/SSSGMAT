import os
import shutil
import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from gnss_predict.config import ENGINE_VERSION
from gnss_predict.errors import GmatNotFoundError
from gnss_predict.run_gmat import find_gmat_console

from ..config import Config
from . import get_config

router = APIRouter()


class Health(BaseModel):
    engine_version: str
    gmat_found: bool
    data_dir: str
    free_bytes: int | None
    writable: bool
    daily: dict | None = None            # สถานะงานประจำวัน: ตัวตั้งเวลาเริ่มมีใน Task 11


def _gmat_found(config: Config) -> bool:
    environ = {"GMAT_BIN": config.gmat_bin} if config.gmat_bin else {}
    try:
        find_gmat_console(environ)
    except GmatNotFoundError:
        return False
    return True


def _free_bytes(data_dir: Path) -> int | None:
    try:
        return shutil.disk_usage(data_dir).free
    except OSError:
        return None


def _writable(data_dir: Path) -> bool:
    """ลองสร้างไฟล์ชั่วคราวจริง (os.access ไม่รู้เรื่อง read-only mount)"""
    try:
        with tempfile.NamedTemporaryFile(dir=data_dir):
            return True
    except OSError:
        return False


@router.get("/health", response_model=Health)
def health(config: Config = Depends(get_config)) -> Health:
    return Health(engine_version=ENGINE_VERSION, gmat_found=_gmat_found(config), data_dir=str(config.data_dir),
                  free_bytes=_free_bytes(config.data_dir), writable=_writable(config.data_dir))
