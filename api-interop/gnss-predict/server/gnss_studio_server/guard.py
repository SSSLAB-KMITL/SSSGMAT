"""กันคำขอข้ามเว็บไซต์ (CSRF) และ DNS rebinding: server ไม่มี login หน้าเว็บอื่นที่เปิดในเบราว์เซอร์เครื่องเดียวกันจึงต้องสั่งงานไม่ได้

- `Host` ต้องเป็นชื่อของ server เอง (`TrustedHostMiddleware` ของ Starlette เทียบเฉพาะชื่อ ไม่เทียบ port):
  `127.0.0.1`, `localhost`, `[::1]` และ `Config.host` ไม่ใช่ -> 400 `Invalid host header` (ข้อความธรรมดาของ Starlette)
  หน้าเว็บที่ใช้ DNS rebinding ส่ง Host เป็นชื่อโดเมนของตัวเอง จึงอ่านหรือแก้อะไรไม่ได้เลย
- คำขอที่ไม่ใช่ GET, HEAD, OPTIONS ที่มี `Origin` ต้องมาจาก origin ของ server เอง (`http://<ชื่อที่รับ>:<port>`)
  ไม่ใช่ -> 403 `FORBIDDEN_ORIGIN` (detail คือ Origin ที่ส่งมา) คำขอที่ไม่มี Origin (curl, TestClient) ผ่าน
- ไม่ใส่ header CORS ใด ๆ: หน้าเว็บอื่นส่ง GET ได้แต่เบราว์เซอร์ไม่ให้อ่านผล
- `Config.host` ที่ไม่ใช่ loopback: เตือนใน log ตอนสร้างแอป (server ไม่มี login และ HTTPS)
"""

import ipaddress
import logging

from fastapi import FastAPI
from starlette.datastructures import Headers
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.types import ASGIApp, Receive, Scope, Send

from .config import Config
from .errors import error_response

LOOPBACK_HOSTS = ("127.0.0.1", "localhost", "[::1]")
SAFE_METHODS = ("GET", "HEAD", "OPTIONS")
FORBIDDEN_ORIGIN_TEXT = "server ไม่รับคำสั่งที่แก้ข้อมูลจากหน้าเว็บอื่น รับเฉพาะจากหน้าเว็บของ server เองหรือจากโปรแกรมที่ไม่ส่ง Origin"
NOT_LOOPBACK_TEXT = ("GNSS_STUDIO_HOST=%s ไม่ใช่ที่อยู่ loopback: เครื่องอื่นในเครือข่ายเรียก server ได้ ซึ่งไม่มี login และ HTTPS "
                     "ควรใช้ 127.0.0.1")


def host_name(host: str) -> str:
    """ชื่อใน header Host ของที่อยู่นั้น: ตัวพิมพ์เล็ก IPv6 อยู่ในวงเล็บเหลี่ยม (`::1` -> `[::1]`)"""
    host = host.strip().lower()
    return f"[{host}]" if ":" in host and not host.startswith("[") else host


def is_loopback(host: str) -> bool:
    """`localhost` หรือที่อยู่ IP แบบ loopback (127.0.0.0/8, ::1)"""
    name = host.strip().lower().strip("[]")
    if name == "localhost":
        return True
    try:
        return ipaddress.ip_address(name).is_loopback
    except ValueError:
        return False


def allowed_hosts(config: Config) -> list[str]:
    """ชื่อที่รับใน header Host: loopback ทั้งสามแบบ และ `Config.host`"""
    return list(dict.fromkeys([*LOOPBACK_HOSTS, host_name(config.host)]))


def allowed_origins(config: Config) -> set[str]:
    """origin ของ server เอง: `http://<ชื่อที่รับ>:<port>` (port 80 รับแบบไม่มี port ด้วย เพราะเบราว์เซอร์ตัดออก)"""
    origins = {f"http://{host}:{config.port}" for host in allowed_hosts(config)}
    if config.port == 80:
        origins |= {f"http://{host}" for host in allowed_hosts(config)}
    return origins


class OriginGuard:
    """ASGI middleware: คำขอที่แก้ข้อมูลได้ (ไม่ใช่ SAFE_METHODS) ที่มี Origin ที่ไม่อยู่ใน origins -> 403 FORBIDDEN_ORIGIN
    ไม่อ่าน body และไม่ห่อ response (SSE ผ่านตรง)"""

    def __init__(self, app: ASGIApp, origins: set[str]):
        self.app = app
        self.origins = {o.lower() for o in origins}

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and scope["method"] not in SAFE_METHODS:
            origin = Headers(scope=scope).get("origin")
            if origin is not None and origin.strip().lower() not in self.origins:
                response = error_response(403, "FORBIDDEN_ORIGIN", FORBIDDEN_ORIGIN_TEXT, detail=origin)
                await response(scope, receive, send)
                return
        await self.app(scope, receive, send)


def install_guards(app: FastAPI, config: Config, logger: logging.Logger) -> None:
    """ผูก middleware ทั้งสอง (Host นอกสุด แล้ว Origin) และเตือนถ้า Config.host ไม่ใช่ loopback"""
    app.add_middleware(OriginGuard, origins=allowed_origins(config))
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=allowed_hosts(config), www_redirect=False)
    if not is_loopback(config.host):
        logger.warning(NOT_LOOPBACK_TEXT, config.host)
