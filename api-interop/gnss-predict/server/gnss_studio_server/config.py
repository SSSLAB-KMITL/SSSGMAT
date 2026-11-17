"""ค่าตั้งของ server อ่านจาก environment variable (หัวข้อ 4 และ 11 ของ spec)"""

import os
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parents[1]               # api-interop/gnss-predict/server
PKG_ROOT = SERVER_DIR.parent                                   # api-interop/gnss-predict
DEFAULT_DATA_DIR = PKG_ROOT / "data"
DEFAULT_WEB_DIST = PKG_ROOT / "web" / "dist"                   # server/../web/dist: เว็บที่ build แล้ว (งานย่อยที่ 3-4)
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8000


def _parse_port(text: str) -> int:
    try:
        port = int(text)
    except ValueError:
        raise ValueError(f"GNSS_STUDIO_PORT ต้องเป็นจำนวนเต็ม ไม่ใช่ {text!r}") from None
    if not 1 <= port <= 65535:
        raise ValueError(f"GNSS_STUDIO_PORT ต้องอยู่ระหว่าง 1 ถึง 65535 ไม่ใช่ {port}")
    return port


@dataclass(frozen=True)
class Config:
    data_dir: Path
    host: str = DEFAULT_HOST
    port: int = DEFAULT_PORT
    gmat_bin: str | None = None
    cesium_ion_token: str = ""
    web_dist: Path = DEFAULT_WEB_DIST

    @classmethod
    def from_env(cls, environ: Mapping[str, str] = os.environ) -> "Config":
        data = environ.get("GNSS_STUDIO_DATA")
        return cls(
            data_dir=Path(os.path.abspath(os.path.expanduser(data))) if data else DEFAULT_DATA_DIR,
            host=environ.get("GNSS_STUDIO_HOST") or DEFAULT_HOST,
            port=_parse_port(environ["GNSS_STUDIO_PORT"]) if environ.get("GNSS_STUDIO_PORT") else DEFAULT_PORT,
            gmat_bin=environ.get("GMAT_BIN") or None,
            cesium_ion_token=environ.get("CESIUM_ION_TOKEN", ""),
        )
