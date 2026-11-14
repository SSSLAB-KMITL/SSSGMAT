"""FastAPI app ของ Gpredict Web: REST /api, WebSocket /ws/modules/{name} และไฟล์หน้าเว็บที่ build แล้ว (หัวข้อ 3 และ 7 ของ spec)

- route ตามตารางหัวข้อ 7.3 ทุกบรรทัด + GET /api/meta (ค่าคงที่ของ module.py ให้หน้าเว็บ) + GET /api/license + GET /api/readme (Help → Online help)
  + GET/PUT /api/prefs (Preferences: ตรวจ schema ที่ prefs.py ที่เดียว) + POST /api/modules/{name}/passes (pass_service.py)
  + GET/PUT /api/hwconf (Preferences → Interfaces: วิทยุและ rotator ตรวจและเก็บที่ hwconf.py)
  + PUT /api/qth/batch (Preferences → Ground Stations: แทนทั้งชุดสถานีและสถานีตั้งต้น store.replace_qth)
  PUT ทั้งสามรับ ?dry_run=true: ตรวจเหมือนจริงและตอบรูปเดียวกันแต่ไม่เขียนไฟล์ (OK ของ Preferences ตรวจทุกส่วนก่อนเขียนจริง)
  + POST /api/trsp/update และ GET /api/trsp/{norad} (Edit → Update transponder data และรายการ transponder ของดาว: trsp.py)
  + GET /api/controllers, POST /api/modules/{name}/target, /radio[/open|/close] และ /rotator[/open|/close] (Radio Control และ
    Antenna Control: controllers.py) PUT module ที่เปลี่ยน qth หรือ satellites ขณะ controller เปิดอยู่ตอบ 409 CONTROLLER_ACTIVE
  + GET/DELETE /api/modules/{name}/skyglance (pass_service.py)
  + POST /api/tle/local (Edit → Update TLE data from local files) POST /api/tle/update และ GET /api/tle/groups ตาม TLE sources ของ
    Preferences (tlesources.py: CelesTrak, ข้อความ TLE เช่น AMSAT, proxy)
  + WS /ws/app: เหตุการณ์ระดับโปรแกรมถึงทุก browser (appevents.py) prefs_changed หลัง PUT /api/prefs และ PUT /api/qth/batch ที่ไม่ใช่ dry run,
    modules_changed หลัง PUT/DELETE/open/close/clone module และ PUT …/window, tle_old จากตัวตรวจอายุ TLE (tleage.py),
    module_config_changed {"modules": [ชื่อ]} เมื่อ config ของ runtime ของ module ที่เปิดอยู่เปลี่ยน (หน้าเว็บที่แสดง module นั้นอ่าน GET ใหม่):
    PUT module ที่เปลี่ยนค่า, Configure → OK (?recreate=true) เสมอ, batch ที่เปลี่ยน module เป็น ** DEFAULT **, PUT /api/qth/{name}
    ของสถานีที่ module ที่เปิดอยู่ใช้ และ Update TLE ที่ reload แล้ว config เปลี่ยน
  + PUT /api/modules/{name}/window (Detach/Attach และจำขนาด/ตำแหน่งหน้าต่างแยก) GET /api/modules มี windows = module ที่เปิดอยู่และเป็นหน้าต่างแยก
    ตามลำดับ session (open ยังมีทุกตัวที่เปิดอยู่: หน้าเว็บกรองแท็บเอง) ไม่ผ่าน controllers.hold เพราะไม่แตะ qth หรือ satellites
- module (spec งานย่อย 4 §9.1): ไฟล์เก็บเฉพาะค่าที่ตั้งเอง ค่าที่ไม่ได้ตั้งสืบทอดค่ารวมของ Preferences → Modules
  PUT /api/modules/{name} รับ pin/unpin (รายการ path ใน module.MODULE_KEYS) ค่าที่สืบทอดอยู่เปลี่ยนเฉพาะเมื่อ pin
  GET และคำตอบของ PUT/clone เป็นค่าที่ใช้จริง ตอนเริ่มย้ายไฟล์ module แบบเดิมก่อนเปิด module (store.migrate_modules)
  ค่ารวมมีผลกับ module ที่เปิดอยู่เมื่อมันถูกสร้างใหม่เท่านั้น (spec §4.2, §9.1 เหมือน Gpredict): runtime จำค่ารวมตอนถูกสร้าง (เปิด,
  เปิดค้างจาก session, clone ที่เปิด) การบันทึก view, PUT QTH และ Update TLE ประกอบ module กับค่าที่จำไว้
  GET ของ module ที่เปิดอยู่ = config ของ runtime (window จากไฟล์) ?fresh=1 = ไฟล์ + ค่ารวมตอนนี้ (Edit module)
  PUT ?recreate=true = Configure → OK: บันทึกแล้วสร้างใหม่ (ค่ารวมตอนนี้ สถานีหาใหม่ ** DEFAULT ** = สถานีตั้งต้นตอนนี้)
  controller เปิดอยู่และสถานีหรือรายชื่อดาวจะเปลี่ยน: 409 CONTROLLER_ACTIVE ไม่เปลี่ยนอะไร
- error ทุกชนิดตอบเป็น {code, level, text, object} (หัวข้อ 7.4) ข้อมูลที่อ่านไม่ได้หรือผิดชนิดตาม route เป็น 422 REQUEST_INVALID
- เวลาใน API เป็น ISO 8601 UTC ความละเอียดมิลลิวินาที ลงท้าย Z
  + GET /api/logs/current (ข้อความของ data/logs/gpredict.log ไม่มีไฟล์ = "") และ POST /api/log (ข้อความจากหน้าเว็บ: gplog.py)
- ตอนเริ่ม (start_background=True): เปิด log session (gplog.start_session ระดับ LOG/LEVEL) ก่อนอย่างอื่น แล้วลบช่วงคำนวณเก่า,
  bootstrap (หัวข้อ 7.1) เปิด module ที่ค้างอยู่ใน session.json และเริ่ม task ตรวจอายุ TLE (ทุก tle_check_interval_s วินาที ครั้งแรกหลังครบช่วงแรก)
  ช่องเหตุการณ์ /ws/app เริ่มทุกครั้ง (ไม่ขึ้นกับ start_background)
  ตอนปิด: ปลด controller ทุกตัว (S, q ถึงอุปกรณ์ทันที) -> หยุด task ตรวจอายุ TLE (รอ update ที่กำลังทำอยู่ให้จบ เหมือน Gpredict) -> หยุด tick ->
  ปิด runtime ทุกตัว และ EphemManager.close() (kill GMAT ที่กำลังรัน เพราะ GMAT อยู่ใน session ของตัวเอง) ขั้นที่ล้มไม่ข้ามขั้นถัดไป
  จบด้วยปิด log session (gplog.end_session หมุนไฟล์ตาม LOG/CLEAN_AGE ที่อ่านตอนนี้) แล้วปิดช่อง /ws/app
- dev: `uvicorn gpredict_web.app:app --reload --port 8740` (app สร้างเมื่อถูกอ่านครั้งแรก การ import เฉยๆ จึงไม่แตะ data จริง)
"""

import asyncio
import json
import logging
import math
import threading
import time
import uuid
from collections.abc import Callable, Iterable
from contextlib import asynccontextmanager
from dataclasses import asdict, replace
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import urlopen

from fastapi import Body, FastAPI, Query, Request, WebSocket
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, Response
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.datastructures import Headers

from gnss_predict.config import REPO_ROOT
from gnss_predict.errors import Message

from . import gplog
from . import module as M
from . import store as S
from . import trsp
from .appevents import AppEvents
from .bootstrap import bootstrap
from .clock import STATES, THROTTLE_MAX, THROTTLE_MIN, ModuleClock, parse_clock_time
from .config import MAX_SATS, NAME_RE, TLE_GROUPS, Config
from .controllers import RADIO, ROTATOR, ControllerHub
from .ephem import EphemManager
from .errors import ApiError
from .hwconf import HwConf, radio_to_dict, rot_to_dict
from .locations import locations_json
from .maps import STOCK_MAPS, check_upload_size, list_maps, map_entry, resolve as resolve_map, save_upload
from .pass_service import PassService, gmat_failed, parse_sky_t
from .prefs import Prefs
from .runtime import Hub, ModuleClosedError, ModuleRuntime, iso_ms, sky_owner
from .satdb import SatDb, SatRecord, UpdateResult
from .satinfo import orbit_info
from .store import Store, qth_from_dict
from .tleage import TLE_CHECK_INTERVAL_S, TleAgeChecker
from .tlesources import make_opener, source_times, update_from_files, update_from_sources

SATDB_FILE = "satdb.json"
SEARCH_LIMIT = 500                     # GET /api/satellites สูงสุด 500 แถว (หัวข้อ 7.3)
SEARCH_Q_MAX = 64                      # q ยาวกว่านี้ไม่ใช่ชื่อหรือ NORAD (และ int ยาวเกิน 4300 หลักทำให้ search ล้ม)
SEND_TIMEOUT_S = 10.0                  # socket ที่รับ tick ไม่ทันนานกว่านี้ถูกตัด (ไม่ให้ขวาง tab อื่นของ module เดียวกัน)
WS_NOT_OPEN = 1008                     # close code: module ไม่ได้เปิดอยู่ (policy violation)
WS_MODULE_CLOSED = 1000                # close code: module ถูกปิดหรือลบ (ใช้กับกรณีนี้เท่านั้น หน้าเว็บไม่ต่อใหม่)
WS_SERVER_STOP = 1001                  # close code: server กำลังปิด
WS_INTERNAL_ERROR = 1011               # close code: producer หยุดเพราะ error ภายใน (หน้าเว็บต่อใหม่)
WS_SEND_FAILED = 1013                  # close code: ส่ง tick ให้ socket นี้ไม่ทันหรือไม่สำเร็จ (Try Again Later)
LOCAL_HOSTS = ("127.0.0.1", "localhost", "::1")     # ชื่อของเครื่องตัวเองที่ browser ใช้เปิด server
PASS_POLL_S = 0.2                      # คำขอ pass: ถาม days_status และตรวจว่า browser ตัดการเชื่อมต่อหรือยังทุกเท่านี้วินาที
CLIENT_CLOSED = 499                    # status ของคำขอที่ browser ตัดไปแล้ว (ไม่มีใครอ่าน แค่ให้ log เห็น)
LICENSE_FILE = REPO_ROOT / "License.txt"
README_FILE = REPO_ROOT / "api-interop" / "gpredict-web" / "README.md"      # คู่มือที่ Help → Online help แสดงในหน้าเว็บ
LOG_DIR = "logs"                       # โฟลเดอร์ log ใต้ data dir (spec งานย่อย 4 §6.1: data/logs/gpredict.log)
# POST /api/tle/local (ของเรา: Gpredict อ่านโฟลเดอร์เอง ไม่มีขีดจำกัด) จำนวนไฟล์, ขนาดรวมของข้อความเป็นไบต์ UTF-8, ความยาวชื่อไฟล์
TLE_LOCAL_FILES_MAX = 200
TLE_LOCAL_BYTES_MAX = 20 * 1024 * 1024
TLE_LOCAL_NAME_MAX = 255
# body JSON ของ /api/tle/local ที่อ่านได้: ข้อความ 20 MB เข้ารหัสใน JSON ยาวขึ้นได้ (\n เป็นสองไบต์ ฯลฯ) จึงเผื่อเป็นสองเท่า
# Content-Length ที่เกินปฏิเสธก่อนอ่าน ส่วน chunked หยุดอ่านเมื่อเกิน ไม่ส่งก้อนใหญ่ให้ตัวแปลง JSON
TLE_LOCAL_BODY_MAX = 2 * TLE_LOCAL_BYTES_MAX
# function ในบรรทัด log ของ Update TLE ตามต้นฉบับ (tle-update.c): รวม TLE แล้ว / Update จาก network หยุดก่อนรวม
TLE_LOG_FUNCTION = "tle_update_from_files"
TLE_NET_LOG_FUNCTION = "tle_update_from_network"
# เหตุการณ์ของ /ws/app ที่ route ส่ง (tle_old ส่งจาก tleage.py) หน้าเว็บโหลดค่าที่เกี่ยวข้องใหม่เมื่อได้รับ
EVENT_PREFS_CHANGED = "prefs_changed"
EVENT_MODULES_CHANGED = "modules_changed"
EVENT_MODULE_CONFIG_CHANGED = "module_config_changed"   # {"modules": [...]}: config ของ runtime ของ module ที่เปิดอยู่เปลี่ยน
_SAFE_METHODS = ("GET", "HEAD", "OPTIONS")          # ไม่เปลี่ยนสถานะ จึงไม่ตรวจ Origin
_UTC = timezone.utc
_log = logging.getLogger(__name__)


def utcnow() -> datetime:
    return datetime.now(_UTC)


# ---------------------------------------------------------------- error

def _error(status: int, code: str, text: str, obj: str | None = None, headers=None) -> JSONResponse:
    return JSONResponse({"code": code, "level": "error", "text": text, "object": obj}, status_code=status,
                        headers=headers)


def _not_open(name: str) -> ApiError:
    return ApiError("NOT_FOUND", 404, f"module {name} ไม่ได้เปิดอยู่ (เปิดด้วย File → Open module)", name)


def _validation_text(err: dict, field: str | None) -> str:
    kind = err.get("type")
    ctx = err.get("ctx") or {}
    if kind == "json_invalid":
        return "ข้อมูลที่ส่งมาไม่ใช่ JSON ที่ถูกต้อง"
    if kind == "string_too_long":
        return f"{field} ยาวเกิน {ctx.get('max_length')} ตัวอักษร"
    if kind in ("int_parsing", "int_type", "int_from_float"):
        return f"{field} ต้องเป็นจำนวนเต็ม"
    if field is None:
        return "ข้อมูลที่ส่งมาต้องเป็น JSON object"
    if kind == "missing":
        return f"ไม่มี {field}"
    return f"ค่าของ {field} ไม่ถูกต้อง"


async def _on_api_error(request: Request, exc: ApiError) -> JSONResponse:
    return JSONResponse(exc.to_dict(), status_code=exc.status)


async def _on_validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
    """ข้อมูลผิดชนิดตาม route (path, query, body ที่ไม่ใช่ JSON object) และ JSON ที่อ่านไม่ได้ (Ruling ของ Task 11)
    object = ชื่อช่องโดยตัด body/query/path ออก (JSON ที่อ่านไม่ได้มี loc เป็นตำแหน่งตัวอักษร จึงเป็น null)"""
    errors = exc.errors()
    first = errors[0] if errors else {}
    loc = [] if first.get("type") == "json_invalid" else [str(p) for p in first.get("loc", ())[1:]]
    field = ".".join(loc) or None
    return _error(422, "REQUEST_INVALID", _validation_text(first, field), field)


def _web_file(web_root: Path, url_path: str) -> Path | None:
    """ไฟล์ใต้ web_root ที่ตรงกับ url_path (ไม่ยอมออกนอก web_root)"""
    try:
        candidate = (web_root / url_path.lstrip("/")).resolve()
        if candidate.is_file() and candidate.is_relative_to(web_root):
            return candidate
    except (OSError, ValueError):
        pass
    return None


def _on_http_error(web_root: Path | None):
    def handler(request: Request, exc: StarletteHTTPException) -> Response:
        path = request.url.path
        is_api = path == "/api" or path.startswith(("/api/", "/ws/"))
        if exc.status_code == 404:
            if web_root is not None and not is_api and request.method in ("GET", "HEAD"):
                target = _web_file(web_root, path) or _web_file(web_root, "index.html")   # path ของหน้าเว็บ: index.html
                if target is not None:
                    return FileResponse(target)
            return _error(404, "NOT_FOUND", f"ไม่พบ {path}", None, exc.headers)
        if exc.status_code == 400:          # FastAPI อ่าน body ไม่ได้: ไม่ใช่ UTF-8 หรือ int ยาวเกิน 4300 หลัก
            return _error(422, "REQUEST_INVALID", "อ่านข้อมูลที่ส่งมาไม่ได้ (ต้องเป็น JSON ที่ถูกต้อง)")
        if exc.status_code == 405:
            return _error(405, "REQUEST_INVALID", f"{path} ไม่รองรับการเรียกแบบ {request.method}", None, exc.headers)
        return _error(exc.status_code, "REQUEST_INVALID", "คำขอไม่สำเร็จ", None, exc.headers)
    return handler


async def _on_internal_error(request: Request, exc: Exception) -> JSONResponse:
    _log.error("error ที่ไม่คาดไว้ใน %s %s", request.method, request.url.path, exc_info=exc)
    return _error(500, "INTERNAL", "เกิดข้อผิดพลาดภายในของ server ดูรายละเอียดใน log ของ server")


# ---------------------------------------------------------------- Host และ Origin (ของเรา)

def _norm_host(name: str) -> str:
    return name.strip().removeprefix("[").removesuffix("]").lower()


def host_allow_list(bind_host: str = LOCAL_HOSTS[0]) -> frozenset[str]:
    """ชื่อเครื่องที่ยอมให้อยู่ใน Host และ Origin: เครื่องตัวเองและ --host เมื่อไม่ใช่เครื่องตัวเอง
    (ไม่มี testserver: test ที่ใช้ TestClient ส่ง allowed_hosts เข้า create_app เอง)"""
    return frozenset(_norm_host(h) for h in (*LOCAL_HOSTS, bind_host) if h and h.strip())


def _host_name(value: str | None, *, origin: bool) -> str | None:
    """ชื่อเครื่องจาก Host ("127.0.0.1:8740", "[::1]:8740") หรือ Origin ("http://localhost:5173")
    อ่านไม่ได้, "null", มี user@ หรือ path หรือ Origin ที่ไม่ใช่ http(s) คืน None (ไม่อยู่ใน allow list จึงถูกปฏิเสธ)"""
    if not value:
        return None
    try:
        parts = urlsplit(value if origin else "//" + value)
        parts.port                                      # port ที่ไม่ใช่ตัวเลขทำให้ ValueError
    except ValueError:
        return None
    if "@" in parts.netloc or parts.path or parts.query or parts.fragment:
        return None
    if origin and parts.scheme not in ("http", "https"):
        return None
    return parts.hostname


class _HostOriginGuard:
    """กันหน้าเว็บอื่นที่ผู้ใช้เปิดอยู่สั่ง server นี้ (ไม่มี login)
    - Host ต้องอยู่ใน allow list ทุกคำขอและ WebSocket (กัน DNS rebinding) ไม่งั้น 403 FORBIDDEN_HOST
    - คำขอที่ไม่ใช่ GET/HEAD/OPTIONS และ WebSocket ที่มี Origin ต้องมาจากชื่อใน allow list (กัน POST และ socket ข้ามเว็บ)
      ไม่งั้น 403 FORBIDDEN_ORIGIN (WebSocket ปิดด้วย 1008 ก่อน accept) คำขอที่ไม่มี Origin (curl, TestClient) ผ่าน"""

    def __init__(self, app, allowed: frozenset[str]):
        self.app = app
        self.allowed = allowed

    async def __call__(self, scope, receive, send):
        kind = scope["type"]
        if kind in ("http", "websocket"):
            headers = Headers(scope=scope)
            if _host_name(headers.get("host"), origin=False) not in self.allowed:
                return await self._reject(scope, receive, send, "FORBIDDEN_HOST",
                                          "ไม่รับคำขอนี้: ชื่อเครื่องใน Host ไม่ใช่ของ Gpredict Web (กันเว็บอื่นเข้าถึงผ่าน DNS "
                                          "rebinding) ให้เปิดด้วย 127.0.0.1, localhost หรือชื่อที่ตั้งด้วย --host")
            origin = headers.get("origin")
            checked = kind == "websocket" or scope["method"] not in _SAFE_METHODS
            if checked and origin is not None and _host_name(origin, origin=True) not in self.allowed:
                return await self._reject(scope, receive, send, "FORBIDDEN_ORIGIN",
                                          "ไม่รับคำสั่งจากหน้าเว็บอื่น (Origin ไม่ใช่ของ Gpredict Web) "
                                          "ให้สั่งจากหน้าเว็บของ Gpredict Web เอง")
        await self.app(scope, receive, send)

    @staticmethod
    async def _reject(scope, receive, send, code: str, text: str) -> None:
        if scope["type"] == "websocket":
            await WebSocket(scope, receive, send).close(code=WS_NOT_OPEN)       # 1008 policy violation ก่อน accept
            return
        await _error(403, code, text)(scope, receive, send)


# ---------------------------------------------------------------- WebSocket tick

def _finite(obj):
    """แทน NaN/Infinity ด้วย null (JSON ไม่มีค่าเหล่านี้ และ JSON.parse ของ browser ไม่รับ) tuple กลายเป็น list แบบเดียวกับ json"""
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    if isinstance(obj, dict):
        return {k: _finite(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_finite(v) for v in obj]
    return obj


def _tick_json(tick: dict) -> tuple[str, bool]:
    """(JSON ของ tick, มีค่า NaN/Infinity ที่ถูกแทนด้วย null หรือไม่)"""
    try:
        return json.dumps(tick, ensure_ascii=False, allow_nan=False, separators=(",", ":")), False
    except ValueError:
        return json.dumps(_finite(tick), ensure_ascii=False, allow_nan=False, separators=(",", ":")), True


def _compute_round(rt: ModuleRuntime) -> tuple[dict, int]:
    """งานใน thread ของหนึ่งรอบ: tick และ refresh.data_ms ล่าสุด (อ่านใหม่ทุกรอบ)
    ModuleClosedError และ error อื่นส่งต่อให้ producer ตัดสิน"""
    return rt.tick(), rt.module.refresh["data_ms"]


async def _close_all(sockets, code: int) -> None:
    for ws in sockets:
        try:
            await ws.close(code=code)
        except Exception:                    # ปิดไปแล้ว หรือ client หลุดไปก่อน
            pass


class _StateLog:
    """log ของ producer เฉพาะตอนสถานะเปลี่ยน (เริ่มพัง / กลับมาปกติ) ไม่ใช่ทุกรอบ (ทุก 300 ms)"""

    def __init__(self, name: str):
        self._name = name
        self._active: set[str] = set()

    def enter(self, kind: str, level: int, text: str, exc_info: bool = False) -> None:
        if kind not in self._active:
            self._active.add(kind)
            _log.log(level, "module %s: %s (log ครั้งเดียวจนกว่าจะกลับมาปกติ)", self._name, text, exc_info=exc_info)

    def leave(self, kind: str, text: str) -> None:
        if kind in self._active:
            self._active.discard(kind)
            _log.info("module %s: %s", self._name, text)


class Ticks:
    """ส่ง tick ทาง WebSocket (หัวข้อ 6.4): producer หนึ่ง task ต่อ module ที่เปิดอยู่ขณะที่มี socket อย่างน้อยหนึ่งตัว
    หรือ keep_alive(name) เป็นจริง (Radio/Antenna Control เปิดอยู่: คำนวณต่อแม้ไม่มี browser, spec §3.2 ของงานย่อย 3)
    tick() มีสถานะ (range rate ของ tick ก่อน, ช่วงถัดไป, การหา pass) จึงเรียกครั้งเดียวต่อรอบแล้วส่งก้อนเดียวกันให้ทุก socket
    ของ module นั้น ทุกรอบห่าง refresh.data_ms (อ่านใหม่ทุกรอบ) งาน tick และแปลง JSON ทำใน thread ด้วย asyncio.to_thread
    decorate(name, tick) คืน tick ที่จะส่ง (เติม radio/rotator) เรียกใน event loop ระหว่างสองงานนั้น (decision 3: controller
    ไม่ถูกแตะจาก thread) รอบที่ไม่มี socket ไม่แปลง JSON ทุกเมธอดถูกเรียกใน event loop เดียวกัน จึงไม่ต้องมี lock

    close code ที่หน้าเว็บใช้ตัดสินว่าจะต่อใหม่หรือไม่: 1000 เฉพาะ module ถูกปิดหรือลบ (ไม่ต่อใหม่), 1008 module ไม่ได้เปิด,
    1001 server ปิด, 1011 producer หยุดเพราะ error ภายใน, 1013 ส่ง tick ให้ socket นั้นไม่ทันหรือไม่สำเร็จ
    รอบที่พัง (tick, decorate, แปลง JSON, ส่ง) ถูกข้ามและ log ครั้งเดียว socket ไม่ถูกปิด"""

    def __init__(self, hub: Hub, keep_alive: Callable[[str], bool] = lambda name: False,
                 decorate: Callable[[str, dict], dict] | None = None):
        self._hub = hub
        self._keep_alive = keep_alive
        self._decorate = decorate
        self._sockets: dict[str, set[WebSocket]] = {}
        self._tasks: dict[str, asyncio.Task] = {}

    def producers(self) -> list[str]:
        """ชื่อ module ที่มี producer ทำงานอยู่"""
        return list(self._tasks)

    def sockets(self, name: str) -> list[WebSocket]:
        """socket ที่รับ tick ของ module นี้อยู่ (สำเนา)"""
        return list(self._sockets.get(name, ()))

    def attach(self, name: str, ws: WebSocket) -> None:
        self._sockets.setdefault(name, set()).add(ws)
        self.wake(name)

    def wake(self, name: str) -> None:
        """เริ่ม producer ของ module ถ้ายังไม่ทำงาน (socket แรก หรือ controller เพิ่งเปิดโดยไม่มี socket)
        producer หยุดเองเมื่อไม่มีทั้ง socket และ keep_alive"""
        if name not in self._tasks:
            self._tasks[name] = asyncio.get_running_loop().create_task(self._produce(name), name=f"ticks:{name}")

    def detach(self, name: str, ws: WebSocket) -> None:
        """socket หลุดหรือปิด: socket สุดท้ายของ module ออกแล้วหยุด producer (module ยังเปิดอยู่) ยกเว้น keep_alive"""
        sockets = self._sockets.get(name)
        if sockets is None:
            return
        sockets.discard(ws)
        if not sockets:
            del self._sockets[name]
            if self._keep_alive(name):
                return
            task = self._tasks.pop(name, None)
            if task is not None:
                task.cancel()

    async def end(self, name: str, code: int = WS_MODULE_CLOSED) -> None:
        """module ถูกปิดหรือลบ: หยุด producer แล้วปิดทุก socket ของ module นั้น"""
        task = self._tasks.pop(name, None)
        if task is not None:
            task.cancel()
        await _close_all(self._sockets.pop(name, set()), code)

    async def shutdown(self) -> None:
        for name in list(self._sockets.keys() | self._tasks.keys()):
            await self.end(name, WS_SERVER_STOP)

    async def _produce(self, name: str) -> None:
        me = asyncio.current_task()
        loop = asyncio.get_running_loop()
        logs = _StateLog(name)
        data_ms = M.REFRESH_DEFAULT["data_ms"]          # ใช้ค่าล่าสุดที่อ่านได้ ถ้ารอบนี้พังก่อนอ่าน
        code = WS_MODULE_CLOSED
        try:
            while self._sockets.get(name) or self._keep_alive(name):
                rt = self._hub.get(name)
                if rt is None:                   # ปิดแล้ว หรือกำลังสร้างใหม่ (socket ต้องต่อใหม่กับ runtime ตัวใหม่)
                    break
                started = loop.time()
                nonfinite = None                 # None = รอบนี้ไม่มี socket จึงไม่ได้แปลง JSON
                try:
                    tick, data_ms = await asyncio.to_thread(_compute_round, rt)
                    if self._decorate is not None:
                        tick = self._decorate(name, tick)
                    if self._sockets.get(name):
                        text, nonfinite = await asyncio.to_thread(_tick_json, tick)
                        await self._broadcast(name, text)
                except ModuleClosedError:
                    break
                except Exception:
                    logs.enter("round", logging.ERROR, "รอบ tick ล้มเหลว ข้ามรอบนี้", exc_info=True)
                else:
                    logs.leave("round", "ส่ง tick ได้อีกครั้ง")
                    if nonfinite:
                        logs.enter("nonfinite", logging.WARNING, "tick มีค่า NaN/Infinity ส่งเป็น null แทน")
                    elif nonfinite is not None:
                        logs.leave("nonfinite", "tick ไม่มีค่า NaN/Infinity แล้ว")
                await asyncio.sleep(max(0.0, data_ms / 1000.0 - (loop.time() - started)))
        except asyncio.CancelledError:
            raise
        except Exception:
            _log.exception("producer ของ module %s หยุดเพราะ error ที่ไม่คาดไว้", name)
            code = WS_INTERNAL_ERROR
        finally:
            if self._tasks.get(name) is me:      # จบเอง (module ปิด, error, ไม่มี socket และ controller แล้ว) ไม่ใช่ถูกยกเลิก
                del self._tasks[name]
                await _close_all(self._sockets.pop(name, set()), code)

    async def _broadcast(self, name: str, text: str) -> None:
        """ส่งข้อความเดียวกันให้ทุก socket socket ที่ส่งไม่ทัน SEND_TIMEOUT_S หรือส่งไม่สำเร็จถูกปิดด้วย 1013 (ตัวอื่นไม่กระทบ)"""
        sockets = list(self._sockets.get(name, ()))
        if not sockets:
            return
        results = await asyncio.gather(*(asyncio.wait_for(ws.send_text(text), SEND_TIMEOUT_S) for ws in sockets),
                                       return_exceptions=True)
        dead = [ws for ws, r in zip(sockets, results) if isinstance(r, BaseException)]
        if dead:
            live = self._sockets.get(name)
            if live is not None:
                live.difference_update(dead)
            await _close_all(dead, WS_SEND_FAILED)


# ---------------------------------------------------------------- แปลงเป็น JSON

def _sat_dict(r: SatRecord, with_tle: bool = False) -> dict:
    d = {"norad": r.norad, "name": r.name, "groups": list(r.groups), "epoch": iso_ms(r.epoch),
         "updated": iso_ms(r.updated)}
    if with_tle:
        d["tle"] = list(r.tle_lines)
    return d


async def _read_body(request: Request, check_size: Callable[[int], None]) -> bytes:
    """body ดิบที่จำกัดขนาด: check_size(จำนวนไบต์) raise เมื่อเกิน Content-Length ที่บอกว่าเกินปฏิเสธก่อนอ่านเลย
    ส่วน chunked (หรือ Content-Length ที่ไม่จริง) นับระหว่างอ่านและหยุดที่ก้อนแรกที่เกิน ไม่เก็บทั้งก้อนไว้ในหน่วยความจำ"""
    declared = request.headers.get("content-length", "")
    if declared.isascii() and declared.isdigit():
        check_size(int(declared))
    chunks, total = [], 0
    async for chunk in request.stream():
        total += len(chunk)
        check_size(total)
        chunks.append(chunk)
    return b"".join(chunks)


async def _read_map_body(request: Request) -> bytes:
    """body ดิบของการอัปโหลดภาพ: เกิน MAP_UPLOAD_MAX แล้วหยุดอ่านและตอบ 422 MAP_INVALID"""
    return await _read_body(request, check_upload_size)


def _check_tle_local_size(size: int) -> None:
    if size > TLE_LOCAL_BODY_MAX:
        raise ApiError("TLE_FILE_INVALID", 422,
                       f"ข้อมูลไฟล์ที่ส่งมาใหญ่เกิน {TLE_LOCAL_BODY_MAX // (1024 * 1024)} MB (ข้อความรวมได้ไม่เกิน "
                       f"{TLE_LOCAL_BYTES_MAX // (1024 * 1024)} MB)", "files")


async def _read_tle_local_body(request: Request) -> bytes:
    """body ของ POST /api/tle/local: เกิน TLE_LOCAL_BODY_MAX แล้วหยุดอ่านและตอบ 422 TLE_FILE_INVALID (object "files")"""
    return await _read_body(request, _check_tle_local_size)


def _json_object(raw: bytes) -> dict:
    """body ที่อ่านเองเป็น JSON object: อ่านไม่ได้หรือไม่ใช่ object -> 422 REQUEST_INVALID ข้อความเดียวกับที่ FastAPI ตอบ"""
    try:
        value = json.loads(raw)
    except ValueError:                       # JSONDecodeError, UnicodeDecodeError และ int เกิน 4300 หลัก
        raise ApiError("REQUEST_INVALID", 422, "ข้อมูลที่ส่งมาไม่ใช่ JSON ที่ถูกต้อง") from None
    if not isinstance(value, dict):
        raise ApiError("REQUEST_INVALID", 422, "ข้อมูลที่ส่งมาต้องเป็น JSON object")
    return value


def _clock_dict(clock: ModuleClock) -> dict:
    t, state, throttle, label = clock.snapshot()
    return {"state": state, "throttle": throttle, "time": iso_ms(t), "label": label}


def _prefs_dict(prefs: Prefs) -> dict:
    """GET และ PUT /api/prefs: ค่าที่ใช้อยู่ทุก key, ค่าตั้งต้น (ให้ปุ่ม Reset ของหน้าเว็บไม่ต้องมีสำเนา) และ key ที่ผู้ใช้ตั้งเอง"""
    return {"values": prefs.values(), "defaults": prefs.defaults(), "user": prefs.user_keys()}


def _hwconf_dict(radios, rotators) -> dict:
    """GET และ PUT /api/hwconf: วิทยุและ rotator เรียงตามชื่อ (key ของ Gpredict บวก name)"""
    return {"radios": [radio_to_dict(r) for r in radios], "rotators": [rot_to_dict(r) for r in rotators]}


def log_file(cfg: Config) -> Path:
    """gpredict.log ของ data dir นี้ (spec งานย่อย 4 §6.1: data/logs/gpredict.log) ที่เดียวที่สร้างที่อยู่นี้: ไฟล์ที่ log session เขียน
    (โฟลเดอร์ของมันคือ log_dir ของ /api/meta), ที่ Log browser อ่าน และที่ python -m gpredict_web พิมพ์ตอนเริ่ม"""
    return cfg.data_dir / LOG_DIR / gplog.LOG_FILE


def _meta(cfg: Config) -> dict:
    """ค่าคงที่ที่หน้าเว็บใช้เป็นป้าย tooltip และค่าตั้งต้น (ชุดเดียวกับที่ server ใช้ตรวจ module)
    module_keys: หน้าของ Module properties -> {path ของค่าใน module: key ของค่ารวมที่สืบทอด} (spec งานย่อย 4 §9.1)
    log_dir: โฟลเดอร์ log จริง แทน "<conf dir>/logs/" ในหน้า Message Logs (decision 17)"""
    defaults = M.module_to_dict(M.ModuleConfig(name=""))
    del defaults["name"]
    return {
        "list_columns": [{"name": c, "hint": M.LIST_HINTS[c]} for c in M.LIST_COLUMNS],
        "list_default": list(M.LIST_DEFAULT),
        "list_sort_default": dict(M.LIST_SORT_DEFAULT),
        "single_fields": [{"name": f, "hint": M.SINGLE_HINTS[f]} for f in M.SINGLE_FIELDS],
        "single_default": list(M.SINGLE_DEFAULT),
        "map_contents": list(M.MAP_CONTENTS),
        "map_track_orbits": {"min": M.TRACK_ORBITS_RANGE[0], "max": M.TRACK_ORBITS_RANGE[1],
                             "default": M.TRACK_ORBITS_DEFAULT},
        "map_center_lon": {"min": M.CENTER_LON_RANGE[0], "max": M.CENTER_LON_RANGE[1], "default": M.CENTER_LON_DEFAULT},
        "polar_orientations": list(M.POLAR_ORIENTATIONS),
        "polar_contents": list(M.POLAR_CONTENTS),
        "layout_presets": [{"name": n, "code": c} for n, c in M.LAYOUT_PRESETS],
        "refresh_labels": dict(M.REFRESH_LABELS),
        "refresh_ranges": {"data_ms": list(M.DATA_MS_RANGE), "cycle": list(M.CYCLE_RANGE)},
        "module_defaults": defaults,
        "max_sats": MAX_SATS,
        "tle_groups": list(TLE_GROUPS),
        "qth_limits": {"lat_deg": [-S.LAT_MAX, S.LAT_MAX], "lon_deg": [-S.LON_MAX, S.LON_MAX],
                       "alt_m": [S.ALT_MIN_M, S.ALT_MAX_M], "description": S.DESCRIPTION_MAX,
                       "location": S.LOCATION_MAX, "weather_station": S.WEATHER_STATION_MAX},
        "module_keys": {page: {path: M.MODULE_KEYS[path] for path in paths} for page, paths in M.PAGE_PATHS.items()},
        "global_layout_extra": list(M.GLOBAL_LAYOUT_EXTRA),
        "log_dir": str(log_file(cfg).parent.absolute()),
    }


def _local_files(body: dict) -> list[tuple[str, str]]:
    """{"files": [{"name", "text"}]} ของ POST /api/tle/local เป็น [(ชื่อ, ข้อความ)] (ชื่อเทียบกับโฟลเดอร์ที่เลือก หน้าเว็บอ่านไฟล์เป็นข้อความ)
    รูปผิด, เกิน TLE_LOCAL_FILES_MAX ไฟล์ หรือข้อความรวมเกิน TLE_LOCAL_BYTES_MAX ไบต์: 422 TLE_FILE_INVALID (object "files")"""
    def invalid(text: str) -> ApiError:
        return ApiError("TLE_FILE_INVALID", 422, text, "files")

    items = body.get("files")
    if not isinstance(items, list):
        raise invalid("รายการไฟล์ (files) ต้องเป็นรายการของ {name, text}")
    if len(items) > TLE_LOCAL_FILES_MAX:
        raise invalid(f"ส่งไฟล์ได้ไม่เกิน {TLE_LOCAL_FILES_MAX} ไฟล์ต่อครั้ง (ได้ {len(items)} ไฟล์)")
    files = []
    size = 0
    for i, item in enumerate(items, 1):
        name = item.get("name") if isinstance(item, dict) else None
        text = item.get("text") if isinstance(item, dict) else None
        if not isinstance(name, str) or not isinstance(text, str):
            raise invalid(f"ไฟล์ที่ {i} ต้องเป็น object ที่มีชื่อ (name) และข้อความ (text) เป็นข้อความ")
        if len(name) > TLE_LOCAL_NAME_MAX:
            raise invalid(f"ชื่อไฟล์ที่ {i} ยาวเกิน {TLE_LOCAL_NAME_MAX} ตัวอักษร")
        size += len(text.encode("utf-8"))
        if size > TLE_LOCAL_BYTES_MAX:
            raise invalid(f"ไฟล์รวมกันใหญ่เกิน {TLE_LOCAL_BYTES_MAX // (1024 * 1024)} MB")
        files.append((name, text))
    return files


def _path_list(body: dict, key: str) -> list:
    """pin / unpin ของ PUT /api/modules/{name}: ไม่ส่ง = ว่าง ต้องเป็นรายการ (path แต่ละตัวตรวจที่ module.own_dict)"""
    v = body.get(key, [])
    if not isinstance(v, list):
        raise ApiError("MODULE_INVALID", 422, f"{key} ต้องเป็นรายการ path ของค่าที่ module สืบทอดได้", key)
    return v


# ---------------------------------------------------------------- ตรวจข้อมูล

def _check_case_clash(existing: list[str], name: str, code: str, field: str, kind: str) -> None:
    """ดิสก์ของ macOS ไม่แยกตัวพิมพ์: ชื่อที่ต่างกันแค่ตัวพิมพ์เล็ก-ใหญ่จะเขียนทับไฟล์ของอีกชื่อ"""
    clash = [n for n in existing if n != name and n.casefold() == name.casefold()]
    if clash:
        raise ApiError(code, 422, f"มี {kind} ชื่อ {clash[0]} อยู่แล้ว ชื่อที่ต่างกันแค่ตัวพิมพ์เล็ก-ใหญ่ใช้ด้วยกันไม่ได้", field)


def _clock_invalid(field: str | None, text: str) -> ApiError:
    return ApiError("CLOCK_INVALID", 422, text, field)


def _parse_clock_time(value) -> datetime:
    try:
        return parse_clock_time(value)
    except ValueError as exc:
        raise _clock_invalid("time", f"เวลา (time) ต้องเป็น {exc}") from None


def _clock_args(body: dict) -> dict:
    """{state, throttle, time} -> อาร์กิวเมนต์ของ ModuleClock.set (null หรือไม่ส่ง = ไม่เปลี่ยน) ตรวจครบก่อนเปลี่ยนอะไร"""
    state, throttle, time = body.get("state"), body.get("throttle"), body.get("time")
    if state is not None and not (isinstance(state, str) and state in STATES):
        raise _clock_invalid("state", "สถานะนาฬิกา (state) ต้องเป็น forward, backward หรือ stop")
    if throttle is not None and (isinstance(throttle, bool) or not isinstance(throttle, int)
                                 or not THROTTLE_MIN <= throttle <= THROTTLE_MAX):
        raise _clock_invalid("throttle", f"Throttle (throttle) ต้องเป็นจำนวนเต็ม {THROTTLE_MIN}-{THROTTLE_MAX}")
    return {"state": state, "throttle": throttle, "time": None if time is None else _parse_clock_time(time)}


# ---------------------------------------------------------------- app

def create_app(cfg: Config, start_background: bool = True, opener=urlopen, now: Callable[[], datetime] = utcnow,
               on_quit: Callable[[], None] | None = None, ephem: EphemManager | None = None,
               allowed_hosts: Iterable[str] | None = None, tle_check_interval_s: float = TLE_CHECK_INTERVAL_S) -> FastAPI:
    """- start_background=False (test): ไม่ prune/bootstrap/เปิด session ตอนเริ่ม และ EphemManager ที่สร้างเองไม่มี worker thread
    - opener: ใช้ดึง OMM และข้อมูล transponder จาก SatNOGS (test ส่งตัวปลอม), now: เวลาเครื่อง (UTC), on_quit: เรียกเมื่อ POST /api/quit
      Update TLE ใช้ make_opener(TLE/PROXY) เมื่อ opener เป็น urlopen ส่วน opener อื่น (ตัวปลอมของ test) ใช้กับทุก TLE source แทน
    - ephem: EphemManager ที่ใช้แทน (test ส่งตัวที่ใช้ propagate ปลอม) ตัวที่ส่งมาก็ถูก close() ตอนปิด app
    - allowed_hosts: ชื่อเครื่องที่รับใน Host และ Origin (None = host_allow_list() คือเครื่องตัวเองเท่านั้น)
    - tle_check_interval_s: ช่วงตรวจอายุ TLE (ตั้งต้น 600 วินาทีแบบ Gpredict) test ส่งช่วงสั้นหรือยาวมาก task นี้เริ่มเฉพาะ start_background"""
    prefs = Prefs(cfg.data_dir)
    store = Store(cfg.data_dir, globals_=prefs.values)      # module ที่ไม่ได้ตั้งค่าเองใช้ค่ารวมของ Preferences → Modules
    satdb = SatDb(cfg.data_dir / SATDB_FILE)
    ephem = ephem if ephem is not None else EphemManager(cfg, start_worker=start_background)
    hwconf = HwConf(cfg.data_dir)
    hub = Hub(store, satdb, ephem, now, prefs=prefs)
    pass_service = PassService(hub, ephem, prefs, now)
    # module ที่มี controller เปิดอยู่คำนวณต่อแม้ไม่มี socket และ tick ของมันมีสถานะของ controller (spec §3.2, §8 ของงานย่อย 3)
    ticks = Ticks(hub, keep_alive=lambda name: controllers.active(name),
                  decorate=lambda name, tick: {**tick, **controllers.on_tick(name, tick)})
    controllers = ControllerHub(hub, hwconf, cfg.data_dir, pass_service, ticks.wake)
    events = AppEvents()                     # /ws/app: เหตุการณ์ระดับโปรแกรมถึงทุก browser (publish เรียกจาก thread ไหนก็ได้)
    session_lock = threading.Lock()          # อ่าน-แก้-เขียน session.json ทีละคำขอ (และ windowed ให้ตรงกับไฟล์ของ module)
    windowed: set[str] = set()               # module ที่เป็นหน้าต่างแยก (window.state == 1) แก้ใต้ session_lock; startup เริ่มจากไฟล์เมื่อ MOD_STATE เปิด
    tle_lock = threading.Lock()              # Update TLE ทีละครั้ง (state file ของ engine และของ tlesources ไม่มี lock)
    tle_opener_factory = make_opener if opener is urlopen else (lambda proxy: opener)       # opener ของ test ไม่ผ่าน proxy
    trsp_lock = threading.Lock()             # Update transponder ทีละครั้ง: คำขอที่ซ้อนรอตัวแรกจบแล้วได้ข้อมูลจาก cache (decision 13)

    def open_list() -> list[str]:
        """module ที่เปิดอยู่ตามลำดับแท็บ"""
        opened = set(hub.open_names())
        return [n for n in store.session() if n in opened]

    def session_add(name: str) -> None:
        with session_lock:
            names = store.session()
            if name not in names:
                store.set_session([*names, name])

    def session_remove(name: str) -> None:
        with session_lock:
            names = store.session()
            if name in names:
                store.set_session([n for n in names if n != name])

    def clear_startup_messages() -> None:
        """ข้อความตอนเปิด (เช่น ให้ Update TLE) หมดความหมายเมื่อผู้ใช้สร้างหรือแก้ module หรือ Update TLE แล้ว"""
        app.state.startup_messages = []

    def startup() -> list[Message]:
        migrated = store.migrate_modules()          # ก่อนเปิด module ใดๆ (Review Focus 1 ของงานย่อย 4)
        if migrated:
            _log.info("ย้ายไฟล์ module เป็นแบบเก็บเฉพาะค่าที่ตั้งเอง (สำเนาเดิมอยู่ที่ %s): %s",
                      cfg.data_dir / S.MODULES_DIR / S.BACKUP_V1_DIR, ", ".join(migrated))
        t = now()
        ephem.prune(t)
        messages = bootstrap(store, satdb, cfg, t, opener)
        restore_windows = prefs.get("GLOBAL/MOD_STATE")     # Restore the state of modules when reopened (docked or window)
        for name in store.session():
            try:
                hub.open(name)
            except ApiError as exc:
                _log.warning("เปิด module %s ที่ค้างใน session ไม่ได้: %s", name, exc.text)
                session_remove(name)
                messages.append(Message(exc.code, "error",
                                        f"เปิด module {name} ที่เปิดค้างไว้ไม่ได้ จึงเอาออกจากแท็บ: {exc.text}", name))
            else:
                if restore_windows and store.get_module(name).window["state"] == 1:
                    with session_lock:
                        windowed.add(name)
        return messages

    def shutdown() -> None:
        for name in hub.open_names():
            try:
                hub.close(name)
            except Exception:
                _log.exception("ปิด module %s ไม่สำเร็จ", name)
        ephem.close()

    async def stop_services() -> None:
        """ตอนปิดตามลำดับ ขั้นที่ล้มไม่ข้ามขั้นถัดไป: GMAT ที่ค้างต้องถูก kill เสมอ
        controller ก่อน: rig และ rotor ได้ S, q ทันที ไม่รอ update TLE ที่อาจดึงจากเน็ตหลายนาที (ขณะนั้น browser หลุดไปแล้ว)
        controllers.shutdown ไม่ปิด module tick ที่ยังวิ่งได้ {} จาก on_tick แล้วหยุดเองเมื่อไม่มีทั้ง socket และ controller"""
        try:
            await controllers.shutdown()     # disengage (S, q) และเก็บ Cycle ก่อนอย่างอื่น
        finally:
            try:
                await stop_tle_age()         # ก่อนหยุด tick และปิด module: update ที่ค้างอยู่ reload module ทุกตัวตอนจบ
            finally:
                try:
                    await ticks.shutdown()
                finally:
                    await asyncio.to_thread(shutdown)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        events.bind(asyncio.get_running_loop())         # /ws/app รับเหตุการณ์ตั้งแต่ server เริ่ม (ไม่ขึ้นกับ start_background)
        try:
            # log session ครอบทั้งชีวิตของ server: ระดับอ่านตอนเริ่มครั้งเดียว (มีผลครั้งถัดไปเหมือน Gpredict) ส่วน LOG/CLEAN_AGE อ่านตอนจบ
            session = gplog.start_session(log_file(cfg).parent, prefs.get("LOG/LEVEL")) if start_background else None
            try:
                if start_background:
                    app.state.startup_messages = await asyncio.to_thread(startup)
                    app.state.tle_age_task = asyncio.create_task(tle_age_loop(), name="tle-age")
                try:
                    yield
                finally:
                    await stop_services()
            finally:
                if session is not None:
                    gplog.end_session(session, prefs.get("LOG/CLEAN_AGE"), time.time())
        finally:
            await events.shutdown()

    app = FastAPI(title="Gpredict Web", lifespan=lifespan, openapi_url="/api/openapi.json", docs_url="/api/docs",
                  redoc_url=None)
    app.state.config = cfg
    app.state.store = store
    app.state.prefs = prefs
    app.state.hwconf = hwconf
    app.state.satdb = satdb
    app.state.ephem = ephem
    app.state.hub = hub
    app.state.pass_service = pass_service
    app.state.ticks = ticks
    app.state.controllers = controllers
    app.state.events = events
    app.state.tle_age_task = None            # task ตรวจอายุ TLE (เฉพาะ start_background)
    app.state.tle_lock = tle_lock
    app.state.trsp_lock = trsp_lock
    app.state.on_quit = on_quit
    app.state.startup_messages = []
    app.state.allowed_hosts = (host_allow_list() if allowed_hosts is None
                               else frozenset(_norm_host(h) for h in allowed_hosts))
    app.add_middleware(_HostOriginGuard, allowed=app.state.allowed_hosts)
    web_root = cfg.web_dist.resolve() if cfg.web_dist.is_dir() else None
    app.add_exception_handler(ApiError, _on_api_error)
    app.add_exception_handler(RequestValidationError, _on_validation_error)
    app.add_exception_handler(StarletteHTTPException, _on_http_error(web_root))
    app.add_exception_handler(Exception, _on_internal_error)

    def runtime_of(name: str) -> ModuleRuntime:
        rt = hub.get(name)                   # None ระหว่างที่ module กำลังถูกสร้าง: ถือว่ายังไม่เปิด
        if rt is None:
            raise _not_open(name)
        return rt

    def module_answer(name: str, fresh: bool = False) -> dict:
        """config ของ module ที่หน้าเว็บอ่าน (GET, คำตอบของ PUT และ clone): module ที่เปิดอยู่ = config ของ runtime (ค่ารวมตอนถูกสร้าง)
        แต่ window จากไฟล์ (PUT …/window ไม่ reload runtime และ Detach ต้องได้ขนาดล่าสุด) ไม่ได้เปิดหรือ fresh (Edit module) =
        ไฟล์ + ค่ารวมตอนนี้"""
        saved = store.get_module(name)
        rt = None if fresh else hub.get(name)
        if rt is None:
            return M.module_to_dict(saved)
        return M.module_to_dict(replace(rt.module, window=saved.window))

    def config_changed(names: list[str]) -> None:
        """บอกหน้าเว็บว่า config ของ runtime ของ module เหล่านี้ (ที่เปิดอยู่) เปลี่ยน ไม่มีชื่อ: ไม่ส่ง"""
        if names:
            events.publish({"type": EVENT_MODULE_CONFIG_CHANGED, "modules": list(names)})

    # ---------------- QTH

    @app.get("/api/qth")
    def list_qth():
        """ไฟล์ QTH ที่เสียถูกข้าม (ไม่ล้มทั้งรายการ) และรายงานใน messages เป็น warning ที่ object = ชื่อไฟล์"""
        good, skipped = store.list_qth_checked()
        messages = [Message("QTH_INVALID", "warning", f"ข้ามไฟล์ QTH {file} เพราะใช้ไม่ได้: {exc.text}", file)
                    for file, exc in skipped]
        return {"qth": [asdict(q) for q in good], "default": store.default_qth(),
                "messages": [m.to_dict() for m in messages]}

    @app.get("/api/qth/{name}")
    def get_qth(name: str):
        return asdict(store.get_qth(name))

    @app.put("/api/qth/batch")          # ต้องมาก่อน /api/qth/{name} ไม่งั้น "batch" ถูกตีเป็นชื่อสถานี
    def put_qth_batch(body: dict = Body(...), dry_run: bool = Query(False)):
        """{"stations": [QTH], "default": ชื่อ} แทนทั้งชุดสถานีและสถานีตั้งต้นในครั้งเดียว (OK ของ Preferences → Ground Stations)
        ตรวจทุกตัวก่อนเขียน ผิดตัวเดียวไม่เขียนเลย: ว่าง -> QTH_LAST, ผิดช่อง/ชื่อซ้ำ/default ไม่อยู่ในรายการ -> QTH_INVALID
        module ที่ใช้สถานีที่หายเปลี่ยนเป็น ** DEFAULT ** (changed_modules) ส่วน module ที่เปิดอยู่ไม่ถูก reload ใช้สถานีเดิมต่อจน
        เปิดใหม่ รวมถึงที่มี controller เปิดอยู่ (spec §4.2): hub.drop_qth_reference ตั้งอ้างอิง qth ของ runtime เป็น None ตามไฟล์
        แต่เก็บสถานีที่ถืออยู่ (Hub.reload ครั้งหลังก็ไม่ย้าย) ?dry_run=true: ตรวจและตอบรูปเดียวกันแต่ไม่เขียน ไม่ลบ ไม่ log ไม่ส่งเหตุการณ์
        ที่เขียนจริงส่ง prefs_changed ทาง /ws/app และ module_config_changed ของ module ที่เปิดอยู่ซึ่งเปลี่ยนเป็น ** DEFAULT **
        (หน้าที่แสดงมันอ่าน config ใหม่ ไม่งั้นการบันทึก view ครั้งต่อไปส่งชื่อสถานีที่ถูกลบแล้วได้ 422)"""
        stations = body.get("stations")
        if not isinstance(stations, list):
            raise ApiError("QTH_INVALID", 422, "รายการสถานี (stations) ต้องเป็นรายการของ object", "stations")
        parsed = []
        for i, item in enumerate(stations, 1):
            try:
                parsed.append(qth_from_dict(item))
            except ApiError as exc:                       # บอกว่าสถานีไหน (หน้า Preferences ส่งมาทีละหลายตัว)
                name = item.get("name") if isinstance(item, dict) else None
                label = f"สถานีที่ {i}" + (f" ({name})" if isinstance(name, str) and name else "")
                raise ApiError(exc.code, exc.status, f"{label}: {exc.text}", exc.object) from None
        default = body.get("default")
        changed = store.replace_qth(parsed, default, dry_run)
        if not dry_run:
            # module ที่เปิดอยู่ถือสถานีเดิมต่อ แต่อ้างอิง qth ตามไฟล์ (** DEFAULT **)
            dropped = [name for name in changed if hub.drop_qth_reference(name)]
            events.publish({"type": EVENT_PREFS_CHANGED})
            config_changed(dropped)
        return {"qth": [asdict(q) for q in sorted(parsed, key=lambda q: q.name)], "default": default,
                "changed_modules": changed}

    @app.put("/api/qth/{name}")
    def put_qth(name: str, body: dict = Body(...)):
        if body.get("name") != name:
            raise ApiError("QTH_INVALID", 422, f"ชื่อ QTH (name) ต้องตรงกับชื่อใน URL ({name})", "name")
        _check_case_clash(store.qth_names(), name, "QTH_INVALID", "name", "QTH")
        q = qth_from_dict(body)
        store.put_qth(q)
        # module ที่เปิดอยู่และใช้สถานีนี้ (ตามไฟล์ หรือสถานีที่ runtime ถืออยู่) ได้ตำแหน่งใหม่ใน tick ถัดไป ค่ารวมยังเป็นของตอนสร้าง
        users = dict.fromkeys(store.modules_using_qth(name))
        users.update(dict.fromkeys(n for n in hub.open_names() if (rt := hub.get(n)) is not None and rt.qth.name == name))
        reloaded = []
        for m in users:
            try:
                hub.reload(m)
            except ApiError as exc:
                _log.warning("อ่าน module %s ใหม่หลังแก้ QTH %s ไม่ได้: %s", m, name, exc.text)
            else:
                if hub.get(m) is not None:
                    reloaded.append(m)
        config_changed(reloaded)
        return asdict(q)

    @app.delete("/api/qth/{name}", status_code=204)
    def delete_qth(name: str):
        store.delete_qth(name)
        return Response(status_code=204)

    # ---------------- ดาวและ TLE

    @app.get("/api/satellites")
    def search_satellites(q: str = Query("", max_length=SEARCH_Q_MAX), group: str | None = Query(None, max_length=64)):
        return {"satellites": [_sat_dict(r) for r in satdb.search(q, group, SEARCH_LIMIT)]}

    @app.get("/api/satellites/{norad}")
    def get_satellite(norad: int):
        r = satdb.get(norad)
        if r is None:
            raise ApiError("NOT_FOUND", 404, f"ไม่พบดาว NORAD {norad} ในดัชนีดาว", str(norad))
        try:
            info = orbit_info(r)
        except ValueError:                   # (ของเรา) ไฟล์ดัชนีที่แก้มือจน TLE อ่านไม่ได้: ยังตอบดาวได้ Satellite Info ไม่มีค่า Orbit Info
            info = None
        return {**_sat_dict(r, with_tle=True), "status": r.status, "orbit_info": info}

    # ---------------- รายชื่อเมืองและสถานีอากาศ (ปุ่ม Select ของ Location และ Weather St)

    @app.get("/api/locations")
    def get_locations():
        """เนื้อของ data/locations.json {source, downloaded, locations: [[continent, country, city, lat, lon, alt_m, icao], ...]}
        (สร้างจาก NOAA) อ่านจากดิสก์ครั้งเดียวแล้วส่งไบต์เดิมทุกครั้ง"""
        try:
            data = locations_json()
        except OSError:
            raise ApiError("NOT_FOUND", 404, "ไม่พบไฟล์รายชื่อเมือง locations.json") from None
        return Response(data, media_type="application/json")

    # ---------------- ภาพแผนที่ (Map View: Background Map)

    @app.get("/api/maps")
    def get_maps():
        return {"maps": list_maps(cfg.data_dir), "default": M.DEFAULT_MAP}

    @app.post("/api/maps")
    async def upload_map(request: Request, name: str = Query("")):
        """อัปโหลดภาพ (ของเรา): body ดิบ ไม่เกิน MAP_UPLOAD_MAX, Content-Type image/png หรือ image/jpeg ตรงกับนามสกุลของ name
        คืนรายการของภาพนั้นแบบเดียวกับ GET /api/maps"""
        body = await _read_map_body(request)
        saved = await asyncio.to_thread(save_upload, cfg.data_dir, name, request.headers.get("content-type"), body)
        return map_entry(cfg.data_dir, saved)

    @app.get("/api/maps/{file}")
    def get_map(file: str):
        """ภาพที่อัปโหลด: no-cache ให้ browser ถามใหม่ทุกครั้ง (ได้ 304 ถ้าไม่เปลี่ยน) ภาพที่อัปโหลดชื่อเดิมซ้ำจึงไม่ค้างภาพเก่า
        ภาพของ Gpredict ไม่เปลี่ยน จึงใช้ cache ตามปกติ"""
        path = resolve_map(cfg.data_dir, file)
        if path is None:
            raise ApiError("NOT_FOUND", 404, f"ไม่พบภาพแผนที่ {file}", file)
        headers = {"X-Content-Type-Options": "nosniff"}                              # ภาพของผู้ใช้: ห้าม browser เดาชนิดเอง
        if file not in STOCK_MAPS:
            headers["Cache-Control"] = "no-cache"
        return FileResponse(path, headers=headers)

    @app.get("/api/tle/groups")
    def tle_groups():
        """กลุ่มของ TLE sources ตามลำดับใน Preferences พร้อมเวลาขอล่าสุด (CelesTrak จาก celestrak_state.json ที่ใช้ร่วมกับ
        GNSS Studio, URL อื่นจาก state ของ tlesources) ต่อด้วยกลุ่มในดัชนีดาวที่ไม่มี source (null ทั้งสองช่อง)"""
        listed = source_times(cfg, prefs.get("TLE/URLS"))
        names = {group for group, _, _ in listed}
        return {"groups": [{"name": group, "last_request": iso_ms(req), "last_success": iso_ms(ok)} for group, req, ok in listed]
                + [{"name": group, "last_request": None, "last_success": None} for group in satdb.groups() if group not in names]}

    def tle_result(result: UpdateResult) -> dict:
        """หลัง Update TLE (ถือ tle_lock อยู่): อ่านดาวของทุก module ที่เปิดอยู่ใหม่ log แบบ Gpredict (tle-update.c) แล้วคืนตัวนับ
        - รวม TLE แล้ว: INFO "Added %d new satellites…" (เมื่อ add_new) และ "TLE elements updated."
        - หยุดก่อนรวม (result.aborted): ERROR ข้อความของ Gpredict แทนสองบรรทัดนั้น
        add_new = ค่าที่รอบนี้ใช้รวม TLE (หน้าต่าง TLE Update แสดงบรรทัด "New Satellites:" เมื่อเป็น true, หยุดก่อนรวม = false)"""
        messages = list(result.messages)
        changed = []
        for name in hub.open_names():
            try:
                if hub.reload(name):             # ค่ารวมของตอนสร้าง: config เปลี่ยนเฉพาะเมื่อไฟล์ถูกแก้นอกโปรแกรม
                    changed.append(name)
            except ApiError as exc:
                messages.append(Message(exc.code, "warning",
                                        f"อ่าน module {name} ใหม่หลังอัปเดต TLE ไม่ได้: {exc.text}", name))
        config_changed(changed)
        if result.aborted:
            _log.error("%s", result.aborted, extra={"gp_function": TLE_NET_LOG_FUNCTION})
        else:
            gp = {"gp_function": TLE_LOG_FUNCTION}
            if result.add_new:
                _log.info("Added %d new satellites to local database", result.new, extra=gp)
            _log.info("TLE elements updated.", extra=gp)
        clear_startup_messages()
        return {"updated": result.updated, "skipped": result.skipped, "missing": result.missing, "new": result.new,
                "add_new": result.add_new, "messages": [m.to_dict() for m in messages]}

    def update_tle() -> dict:
        """Edit → Update TLE data from network ตาม TLE sources และ proxy ของ Preferences (tlesources.update_from_sources)"""
        with tle_lock:
            return tle_result(update_from_sources(satdb, cfg, prefs, now(), tle_opener_factory))

    # ตรวจอายุ TLE ทุก tle_check_interval_s วินาที (ref-D §5.1): Notify me ส่ง tle_old ทาง /ws/app (เก็บไว้ถ้ายังไม่มี browser)
    # Perform automatic update in the background เรียก update_tle เดิม (ถือ tle_lock, ผลแล้ว reload module ทุกตัว, ติดกติกา 2 ชม. ต่อ source)
    tle_checker = TleAgeChecker(prefs.values, update_tle, events.publish_or_hold, now)
    app.state.tle_age_checker = tle_checker

    async def tle_age_loop() -> None:
        """sleep แล้วตรวจใน thread วนทุกช่วง (ไม่ตรวจตอนเริ่ม) รอบที่ล้มถูกบันทึกแล้วตรวจรอบต่อไป ยกเลิกตอนปิด server:
        รอบที่กำลังทำอยู่ (update ที่ดึงจากเน็ต) ทำจนจบก่อน เหมือน Gpredict ที่รอ thread update ก่อนปิดโปรแกรม (main.c:558-564)
        เพื่อไม่ให้ update reload module ที่กำลังถูกปิด"""
        def failed(work: asyncio.Future) -> None:
            if not work.cancelled() and work.exception() is not None:
                _log.error("ตรวจอายุ TLE ไม่สำเร็จ จะตรวจใหม่ในรอบถัดไป", exc_info=work.exception())

        while True:
            await asyncio.sleep(tle_check_interval_s)
            work = asyncio.ensure_future(asyncio.to_thread(tle_checker.check))
            work.add_done_callback(failed)
            try:
                await asyncio.shield(work)
            except asyncio.CancelledError:
                await asyncio.wait([work])
                raise
            except Exception:
                pass                         # failed() บันทึกไปแล้ว

    async def stop_tle_age() -> None:
        task = app.state.tle_age_task
        if task is not None:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    @app.post("/api/tle/update")
    async def tle_update():
        return await asyncio.to_thread(update_tle)

    def update_tle_local(files: list[tuple[str, str]]) -> dict:
        with tle_lock:
            return tle_result(update_from_files(satdb, prefs, files, now()))

    @app.post("/api/tle/local")
    async def tle_local(request: Request):
        """Edit → Update TLE data from local files: {"files": [{"name", "text"}]} ไฟล์ระดับบนที่ลงท้าย .tle/.txt (ไม่สนตัวพิมพ์)
        ถูกอ่าน ไฟล์อื่นถูกข้าม ตอบตัวนับแบบ POST /api/tle/update body เกิน TLE_LOCAL_BODY_MAX: 422 TLE_FILE_INVALID ก่อนแปลง JSON
        (_read_tle_local_body) JSON ที่อ่านไม่ได้หรือไม่ใช่ object: 422 REQUEST_INVALID จำนวนและขนาดของข้อความตรวจที่ _local_files"""
        files = _local_files(_json_object(await _read_tle_local_body(request)))
        return await asyncio.to_thread(update_tle_local, files)

    # ---------------- transponder (Edit -> Update transponder data, spec §7)

    def update_trsp() -> dict:
        with trsp_lock:
            result = trsp.update_from_network(cfg.data_dir, now(), opener)
        # status เป็น "Finished" เสมอ เหมือน Gpredict ที่แสดง "Finished" แม้ดึงไม่ได้ (ref-R §11.1) เหตุผลอยู่ใน messages
        return {"status": "Finished", "cached": result.cached, "fetched_at": iso_ms(result.fetched_at),
                "satellites": result.satellites, "messages": [m.to_dict() for m in result.messages]}

    @app.post("/api/trsp/update")
    async def trsp_update():
        return await asyncio.to_thread(update_trsp)

    @app.get("/api/trsp/{norad}")
    def get_trsp(norad: int):
        return {"norad": norad, "transponders": trsp.load_transponders(cfg.data_dir, norad)}

    # ---------------- module

    @app.get("/api/modules")
    def list_modules():
        opened = open_list()
        return {"modules": store.list_modules(), "open": opened, "windows": [n for n in opened if n in windowed],
                "messages": [m.to_dict() for m in app.state.startup_messages]}

    @app.get("/api/modules/{name}")
    def get_module(name: str, fresh: bool = Query(False)):
        """module ที่เปิดอยู่: config ของ runtime (ค่ารวมตอนถูกสร้าง) window จากไฟล์ ?fresh=1 หรือไม่ได้เปิด: ไฟล์ + ค่ารวมตอนนี้
        (Edit module ใช้ ?fresh=1 เพื่อแสดงและตรึงค่าปัจจุบัน)"""
        return module_answer(name, fresh)

    def check_configurable(name: str, m: M.ModuleConfig) -> None:
        """controller เปิดอยู่: ห้ามเปลี่ยนสถานี (qth) และรายชื่อดาว (satellites) ที่ controller สร้างจากมัน (spec §4.6, decision 4)
        ค่าของ view (Ground Track, Highlight footprint, Sky track, ดาวของ Single sat, Map) ที่ core บันทึกด้วย PUT เดียวกันเปลี่ยนได้
        เทียบกับ config ที่ runtime ใช้อยู่ ไม่ใช่ไฟล์ (ไฟล์ที่ถูกแก้ด้วยมือยังไม่ถึง runtime)"""
        rt = hub.get(name)
        if rt is None:                       # ไม่ได้เปิดอยู่ (controller ค้างไม่ได้): ไม่มีอะไรให้ป้องกัน
            return
        current = rt.module
        for field in ("qth", "satellites"):
            if getattr(m, field) != getattr(current, field):
                raise ApiError("CONTROLLER_ACTIVE", 409,
                               f"แก้สถานีหรือรายชื่อดาวของ module {name} ไม่ได้ขณะที่ Radio Control หรือ Antenna Control เปิดอยู่ "
                               "ให้ปิด Radio Control และ Antenna Control ของ module นี้ก่อน แล้วลองบันทึกใหม่", field)

    def check_recreatable(name: str, m: M.ModuleConfig, controller_active: bool) -> None:
        """ก่อน Configure → OK เขียนไฟล์ของ module ที่เปิดอยู่: หาสถานีที่การสร้างใหม่จะได้ (ไม่มีสถานีตั้งต้น -> 422 QTH_INVALID
        ไม่เขียนอะไร) controller เปิดอยู่และจะได้สถานีอื่น (เช่น module ** DEFAULT ** หลังเปลี่ยนสถานีตั้งต้น): 409 CONTROLLER_ACTIVE
        (SP3 decision 4 แบบ check_configurable ซึ่งตรวจรายชื่อดาว) เทียบชื่อสถานี: พิกัดใหม่ของสถานีเดิมถึง module ที่มี controller
        เปิดอยู่ได้อยู่แล้วทาง PUT /api/qth/{name}"""
        rt = hub.get(name)
        if rt is None:
            return
        station = hub.station_for(m)
        held = rt.qth
        if controller_active and station.name != held.name:
            raise ApiError("CONTROLLER_ACTIVE", 409,
                           f"สร้าง module {name} ใหม่ (Configure → OK) จะเปลี่ยนสถานีจาก {held.name} เป็น {station.name} "
                           "ซึ่งทำไม่ได้ขณะที่ Radio Control หรือ Antenna Control เปิดอยู่ ให้ปิด Radio Control และ Antenna Control "
                           "ของ module นี้ก่อน แล้วกด OK ใหม่", "qth")

    def put_module_sync(name: str, body: dict, controller_active: bool, recreate: bool) -> tuple[dict, bool]:
        """body = ค่าเต็มของ module + pin/unpin (decision 3): ค่าที่สืบทอดอยู่เปลี่ยนเฉพาะเมื่อ pin
        recreate (Configure → OK): บันทึกแล้วสร้าง module ที่เปิดอยู่ใหม่ (Hub.recreate) ไม่งั้น reload ด้วยค่ารวมที่ runtime จำไว้
        คืน (config ที่หน้าเว็บอ่าน, config ของ runtime เปลี่ยนหรือถูกสร้างใหม่)"""
        if body.get("name") != name:
            raise ApiError("MODULE_INVALID", 422, f"ชื่อ module (name) ต้องตรงกับชื่อใน URL ({name})", "name")
        _check_case_clash(store.list_modules(), name, "MODULE_INVALID", "name", "module")
        m = M.module_from_dict(body, set(store.qth_names()), satdb.norads())
        pin, unpin = _path_list(body, "pin"), _path_list(body, "unpin")
        if controller_active:
            check_configurable(name, m)
        if recreate:
            check_recreatable(name, m, controller_active)
        store.put_module(m, pin, unpin)
        # เปิดอยู่: tick ถัดไปของทุกแท็บใช้ค่าใหม่ (ไม่ได้เปิด: ไม่ทำอะไร)
        changed = hub.recreate(name) if recreate else hub.reload(name)
        clear_startup_messages()
        return module_answer(name), changed

    @app.put("/api/modules/{name}")
    async def put_module(name: str, body: dict = Body(...), recreate: bool = Query(False)):
        """?recreate=true: Configure → OK ซึ่งหน้าเว็บส่งทุกครั้งแม้ไม่มีอะไรเปลี่ยน (Gpredict สร้าง module ใหม่ทุกครั้งที่กด OK, ref-D §9)"""
        async with controllers.hold(name):   # controller ของ module นี้ไม่ถูกเปิดแทรกระหว่างตรวจกับเขียน
            saved, changed = await asyncio.to_thread(put_module_sync, name, body, controllers.active(name), recreate)
        events.publish({"type": EVENT_MODULES_CHANGED})
        if changed:
            config_changed([name])
        return saved

    def put_window_sync(name: str, body: dict) -> dict:
        """เปลี่ยนเฉพาะช่อง window ของ module (store.put_module_window) แล้วให้ windowed และลำดับ session ตามสถานะใหม่
        state 1 = หน้าต่างแยก (module ยังอยู่ใน session ตามเดิม หน้าเว็บกรองออกจากแท็บเอง) state 0 ของ module ที่เป็นหน้าต่างอยู่ = Attach:
        เป็นแท็บสุดท้าย (ย้ายชื่อไปท้าย session เฉพาะที่อยู่ใน session แล้ว module ที่ปิดอยู่ไม่ถูกเติมเข้า session) ส่งแต่ขนาดหรือตำแหน่ง
        หรือส่ง state 0 ซ้ำไม่ย้ายแท็บ ทั้งหมดใต้ session_lock สองคำขอซ้อนกันจึงไม่ทำให้ windowed ต่างจากไฟล์"""
        with session_lock:
            window = store.put_module_window(name, body)
            if window["state"] == 1:
                windowed.add(name)
            elif name in windowed:
                windowed.discard(name)
                names = store.session()
                if name in names:
                    store.set_session([*(n for n in names if n != name), name])
            return window

    @app.put("/api/modules/{name}/window")
    async def put_window(name: str, body: dict = Body(...)):
        """ไม่ผ่าน controllers.hold: ไม่เปลี่ยน qth หรือ satellites จึงบันทึกได้ขณะ Radio/Antenna Control เปิดอยู่ ไม่ reload runtime"""
        window = await asyncio.to_thread(put_window_sync, name, body)
        events.publish({"type": EVENT_MODULES_CHANGED})
        return window

    def delete_module_sync(name: str) -> None:
        hub.close(name)                      # เปิดอยู่: ปิดก่อน
        with session_lock:
            store.delete_module(name)        # เอาออกจาก session ด้วย
            windowed.discard(name)           # ชื่อนี้สร้างใหม่ภายหลังต้องไม่เป็นหน้าต่างแยกตามของเก่า

    async def retire_module[T](name: str, work: Callable[[], T]) -> T:
        """ปิดหรือลบ module: ปลด controller ก่อน (S, q ถึงอุปกรณ์ขณะ runtime ยังอยู่) ทำ work (ปิด runtime) แล้วปิด WebSocket ของ module
        controller ที่อีกแท็บเปิดแทรกระหว่าง work (hub.close รอ tick ที่กำลังคำนวณได้หลายวินาที) ถูกปิดด้วยการปิดครั้งที่สอง
        ไม่ให้ค้างอยู่กับ module ที่ปิดไปแล้ว"""
        await controllers.close_module(name)
        result = await asyncio.to_thread(work)
        await controllers.close_module(name)
        await ticks.end(name)
        return result

    @app.delete("/api/modules/{name}", status_code=204)
    async def delete_module(name: str):
        await retire_module(name, lambda: delete_module_sync(name))
        events.publish({"type": EVENT_MODULES_CHANGED})
        return Response(status_code=204)

    @app.post("/api/modules/{name}/open")
    def open_module(name: str):
        hub.open(name)
        session_add(name)
        events.publish({"type": EVENT_MODULES_CHANGED})
        return {"open": open_list()}

    def close_module_sync(name: str) -> list[str]:
        if hub.get(name) is None and name not in store.list_modules():
            raise ApiError("NOT_FOUND", 404, f"ไม่พบ module ชื่อ {name}", name)
        hub.close(name)
        session_remove(name)
        return open_list()

    @app.post("/api/modules/{name}/close")
    async def close_module(name: str):
        opened = await retire_module(name, lambda: close_module_sync(name))
        events.publish({"type": EVENT_MODULES_CHANGED})
        return {"open": opened}

    @app.post("/api/modules/{name}/clone")
    def clone_module(name: str, body: dict = Body(...)):
        """คัดลอกค่าที่ module เดิมตั้งเอง (ค่าที่ตรึงไว้ยังตรึง ค่าที่สืบทอดยังสืบทอด) ตรวจ QTH และดาวด้วยค่าที่ใช้จริง
        module ใหม่เป็นแท็บเสมอ (window.state 0) ขนาดและตำแหน่งหน้าต่างที่จำไว้คงอยู่"""
        src = store.get_module(name)
        src_own = store.get_module_own(name)
        new_name, want_open = body.get("new_name"), body.get("open", True)    # Gpredict: "Open module when created" ตั้งต้นเปิด
        if not (isinstance(new_name, str) and NAME_RE.fullmatch(new_name)):
            raise ApiError("MODULE_INVALID", 422,
                           "ชื่อ module ใหม่ (new_name) ต้องเป็นตัวอักษร A-Z, a-z, ตัวเลข, _ หรือ - ยาว 1-25 ตัว", "new_name")
        if not isinstance(want_open, bool):
            raise ApiError("MODULE_INVALID", 422, "การเปิด module ที่สร้าง (open) ต้องเป็น true หรือ false", "open")
        clash = [n for n in store.list_modules() if n.casefold() == new_name.casefold()]
        if clash:
            raise ApiError("MODULE_INVALID", 422, f"มี module ชื่อ {clash[0]} อยู่แล้ว (new_name)", "new_name")
        M.module_from_dict({**M.module_to_dict(src), "name": new_name}, set(store.qth_names()), satdb.norads())
        # เปิดเป็นแท็บ (window.state 0) แม้ต้นฉบับเป็นหน้าต่างแยก: หน้าต่างเปิดเองไม่ได้ถ้าไม่มีการคลิก ขนาดและตำแหน่งที่จำไว้คงอยู่
        window = {**src_own.get("window", M.WINDOW_DEFAULT), "state": 0}
        store.put_module_own(new_name, {**src_own, "name": new_name, "window": window})
        clear_startup_messages()
        if want_open:
            hub.open(new_name)
            session_add(new_name)
        events.publish({"type": EVENT_MODULES_CHANGED})
        return {"module": module_answer(new_name), "open": open_list()}

    @app.put("/api/session/tabs")
    def put_tabs(body: dict = Body(...)):
        tabs = body.get("open")
        with session_lock:
            current = open_list()
            if (not isinstance(tabs, list) or not all(isinstance(n, str) for n in tabs)
                    or len(set(tabs)) != len(tabs) or set(tabs) != set(current)):
                raise ApiError("MODULE_INVALID", 422,
                               "ลำดับแท็บ (open) ต้องมีชื่อ module ที่เปิดอยู่ทุกตัว ตัวละครั้ง", "open")
            store.set_session(tabs)
        return {"open": open_list()}

    # ---------------- runtime: retry, นาฬิกา, track

    @app.post("/api/modules/{name}/retry", status_code=204)
    def retry(name: str):
        try:
            runtime_of(name).retry()
        except ModuleClosedError:
            raise _not_open(name) from None
        return Response(status_code=204)

    @app.get("/api/modules/{name}/clock")
    def get_clock(name: str):
        return _clock_dict(runtime_of(name).clock)

    @app.put("/api/modules/{name}/clock")
    def put_clock(name: str, body: dict = Body(...)):
        clock = runtime_of(name).clock
        args = _clock_args(body)
        try:
            clock.set(**args)
        except (ValueError, OverflowError) as exc:
            text = str(exc) if isinstance(exc, ValueError) else ""
            raise _clock_invalid(None, f"ตั้งนาฬิกาไม่ได้: {text or 'เวลาอยู่นอกช่วงที่คำนวณได้'}") from None
        return _clock_dict(clock)

    @app.post("/api/modules/{name}/clock/reset")
    def reset_clock(name: str):
        clock = runtime_of(name).clock
        clock.reset()
        return _clock_dict(clock)

    @app.get("/api/modules/{name}/track/{norad}")
    def track(name: str, norad: int):
        return {"lines": runtime_of(name).track(norad)}

    @app.get("/api/modules/{name}/skytrack/{norad}")
    def skytrack(name: str, norad: int):
        points = runtime_of(name).skytrack(norad)
        if points is None:
            raise ApiError("NOT_FOUND", 404,
                           f"ดาว NORAD {norad} อยู่ใต้ขอบฟ้า (หรือยังไม่มีค่าจาก GMAT) จึงไม่มี sky track ของ pass ปัจจุบัน",
                           str(norad))
        return {"points": points}

    # ---------------- Pass predictions

    @app.post("/api/modules/{name}/passes")
    async def predict_passes(name: str, request: Request, body: dict = Body(...)):
        """Show next pass / Show current pass / Future passes และ pass ที่รู้ AOS (kind "at") ของดาวหนึ่งดวง (spec §9)
        รอ block รายวันจาก GMAT โดยถาม days_status ทุก PASS_POLL_S วินาที browser ตัดการเชื่อมต่อ (Cancel) -> หยุดรอ
        owner pass:<uuid4> ถูกปล่อยใน finally เสมอ งาน GMAT ที่ไม่มีคำขอไหนต้องการแล้วจึงถูกตัดหรือ kill"""
        try:
            plan = await asyncio.to_thread(pass_service.plan, name, body)
        except ModuleClosedError:
            raise _not_open(name) from None
        if isinstance(plan, dict):                       # PASS_NO_AOS: ตอบทันทีโดยไม่สั่ง GMAT
            return plan
        owner = f"pass:{uuid.uuid4()}"
        try:
            ephem.ensure_days(owner, [plan.spec], plan.first, plan.last)
            while True:
                status, messages = await asyncio.to_thread(ephem.days_status, owner)
                if status == "ok":
                    break
                if status == "failed":
                    raise gmat_failed(plan, messages)
                if await request.is_disconnected():
                    return Response(status_code=CLIENT_CLOSED)
                await asyncio.sleep(PASS_POLL_S)
            return _finite(await asyncio.to_thread(pass_service.answer, plan, messages))
        finally:
            ephem.release_days(owner)

    @app.get("/api/modules/{name}/skyglance")
    async def get_skyglance(name: str, t: str | None = Query(None, max_length=64)):
        """Sky at a glance (spec §7 และ §9) ไม่รอ GMAT: ตอบ status ของ block รายวันทันที หน้าเว็บถามซ้ำทุก 1 วินาทีระหว่าง computing
        เมื่อ ok การหา pass ของทุกดาวอยู่ใน thread (ใช้ CPU ได้หลายวินาทีเมื่อ module มีดาวมาก) ไม่ขวาง event loop
        owner sky:<module> คงอยู่จนหน้าต่างปิด (DELETE) หรือ module ปิด คำขอที่ค้างอยู่ใน thread ขณะ DELETE มาถึงอาจตั้ง owner ซ้ำ
        owner นั้นหายเมื่อ module ปิดหรือ DELETE ครั้งต่อไป"""
        t0 = parse_sky_t(t)
        try:
            return _finite(await asyncio.to_thread(pass_service.sky, name, t0))
        except ModuleClosedError:
            raise _not_open(name) from None

    @app.delete("/api/modules/{name}/skyglance", status_code=204)
    async def release_skyglance(name: str):
        """ปล่อย owner sky:<module> เมื่อปิดหน้าต่าง Sky at a glance (module ปิดไปแล้วหรือไม่เคยขอก็ 204) เบาพอจะทำบน event loop
        เหมือน release_days ของคำขอ pass (ทำใน thread แล้วถูกยกเลิกกลางทางไม่ได้ปล่อยแน่)"""
        ephem.release_days(sky_owner(name))
        return Response(status_code=204)

    # ---------------- Preferences

    @app.get("/api/prefs")
    def get_prefs():
        return _prefs_dict(prefs)

    @app.put("/api/prefs")
    def put_prefs(body: dict = Body(...), dry_run: bool = Query(False)):
        """{"set": {key: ค่า}, "remove": [key]} (ไม่ใส่ = ว่าง) ตรวจทุก key ก่อนเขียน ผิดตัวเดียวไม่เขียนเลย
        ?dry_run=true: ตรวจเหมือนกันทุกอย่างและตอบรูปเดียวกัน (ค่าที่จะใช้หลังเขียน) แต่ไม่เขียนไฟล์ (OK ของ Preferences ตรวจทุกส่วนก่อน)
        ไม่ส่งเหตุการณ์ ที่เขียนจริงส่ง prefs_changed ทาง /ws/app (เฉพาะเมื่อมีค่าเปลี่ยนและเขียนไฟล์)"""
        set_ = body.get("set", {})
        remove = body.get("remove", [])
        if not isinstance(set_, dict):
            raise ApiError("PREFS_INVALID", 422, "ค่าที่จะตั้ง (set) ต้องเป็น object ที่มี key ของ Preferences เป็นชื่อ", "set")
        if not isinstance(remove, list) or not all(isinstance(k, str) for k in remove):
            raise ApiError("PREFS_INVALID", 422, "รายการที่จะลบ (remove) ต้องเป็นรายการชื่อ key ของ Preferences", "remove")
        if dry_run:
            return _prefs_dict(prefs.preview(set_, remove))
        if prefs.update(set_, remove):       # ไม่มีอะไรเปลี่ยน (เช่น GLOBAL/CURRENT_PAGE เดิม): ไม่ให้ทุกหน้าอ่าน Preferences ใหม่
            events.publish({"type": EVENT_PREFS_CHANGED})
        return _prefs_dict(prefs)

    # ---------------- Preferences → Interfaces

    @app.get("/api/hwconf")
    def get_hwconf():
        return _hwconf_dict(hwconf.radios(), hwconf.rotators())

    @app.put("/api/hwconf")
    def put_hwconf(body: dict = Body(...), dry_run: bool = Query(False)):
        """{"radios": [...], "rotators": [...]} แทนทั้งชุด (ต้องมีทั้งสอง key ไม่งั้นการลืมส่งฝั่งหนึ่งจะลบอุปกรณ์ทั้งฝั่ง)
        ตรวจทุกตัวก่อนเขียน ผิดตัวเดียวไม่เขียนเลย
        ?dry_run=true: ตรวจเหมือนกันทุกอย่างและตอบรูปเดียวกัน (ชุดที่จะอ่านได้หลังเขียน) แต่ไม่เขียนหรือลบไฟล์ใด"""
        radios, rotators = body.get("radios"), body.get("rotators")
        for key, value in (("radios", radios), ("rotators", rotators)):
            if not isinstance(value, list):
                raise ApiError("HWCONF_INVALID", 422, f"รายการ {key} ต้องเป็นรายการของ object (ส่งมาทั้งชุดที่จะเก็บ)", key)
        if dry_run:
            return _hwconf_dict(*hwconf.preview(radios, rotators))
        hwconf.replace(radios, rotators)
        return _hwconf_dict(hwconf.radios(), hwconf.rotators())

    # ---------------- Radio Control และ Antenna Control (spec §8)

    @app.get("/api/controllers")
    async def list_controllers():
        """controller ที่เปิดอยู่ทุก module (หน้าเว็บอ่านตอนเปิดหน้าเพื่อคืนหน้าต่างที่ยังเปิดอยู่ใน server)"""
        return {"open": controllers.open_list()}

    @app.post("/api/modules/{name}/target", status_code=204)
    async def set_target(name: str, body: dict = Body(...)):
        """ดาวเป้าหมายของ module เปลี่ยน (Select satellite, คลิกเลือกใน view, Autotrack): controller ที่เปิดอยู่เลือกดาวตาม"""
        norad = body.get("norad")
        if isinstance(norad, bool) or not isinstance(norad, int):
            raise ApiError("CONTROLLER_INVALID", 422, "ดาวเป้าหมาย (norad) ต้องเป็นจำนวนเต็ม", "norad")
        await controllers.set_target(name, norad)
        return Response(status_code=204)

    def controller_routes(kind: str) -> None:
        """เปิด ปิด และสั่งงาน controller ชนิดหนึ่ง (radio หรือ rotator) งานจริงอยู่ใน task ของ ControllerHub (shield): คำขอที่ถูกยกเลิก
        ไม่ตัดการปลด Engage กลางทาง"""
        base = f"/api/modules/{{name}}/{kind}"

        @app.post(f"{base}/open")
        async def open_controller(name: str):
            await controllers.open(name, kind)
            return {"open": controllers.open_list()}

        @app.post(f"{base}/close")
        async def close_controller(name: str):
            await controllers.close(name, kind)
            return {"open": controllers.open_list()}

        @app.post(base)
        async def act_controller(name: str, body: dict = Body(...)):
            return {kind: _finite(await controllers.act(name, kind, body))}

    controller_routes(RADIO)
    controller_routes(ROTATOR)

    # ---------------- อื่นๆ

    @app.post("/api/quit", status_code=204)
    def quit_server():
        """หยุด server (ของเรา: แทน File → Quit) ไม่มีตัวหยุด (dev: uvicorn โดยตรง) ตอบ 409 QUIT_UNAVAILABLE ไม่ใช่ 204
        เพื่อให้หน้าเว็บไม่ขึ้นว่า server หยุดแล้วทั้งที่ยังทำงานอยู่"""
        if on_quit is None:
            _log.warning("POST /api/quit แต่ไม่มีตัวหยุด server (รันด้วย python -m gpredict_web เพื่อใช้ Quit)")
            raise ApiError("QUIT_UNAVAILABLE", 409,
                           "server นี้ไม่ได้รันด้วย python -m gpredict_web จึงปิดจากหน้าเว็บไม่ได้")
        on_quit()
        return Response(status_code=204)

    @app.get("/api/meta")
    def meta():
        return _meta(cfg)

    # ---------------- Log (File → Log browser, Preferences → Message Logs)

    @app.get("/api/logs/current")
    def current_log():
        """ข้อความของ gpredict.log ของ session นี้ (Log browser อ่านครั้งเดียวตอนเปิด) ไม่มีไฟล์ = ข้อความว่าง (log ลง stderr อยู่)
        มีแต่อ่านไม่ได้ (สิทธิ์, เป็นโฟลเดอร์ ฯลฯ): 500 LOG_UNREADABLE (ของเรา) ไม่ใช่ข้อความว่างที่ดูเหมือนไม่มี log"""
        path = log_file(cfg)
        try:
            data = path.read_bytes()
        except FileNotFoundError:
            data = b""
        except OSError as exc:
            _log.warning("อ่าน %s ให้ Log browser ไม่ได้: %s", path, exc)
            raise ApiError("LOG_UNREADABLE", 500, f"อ่านไฟล์ log {path} ไม่ได้: {exc}", gplog.LOG_FILE) from None
        return Response(data, media_type="text/plain; charset=utf-8")

    @app.post("/api/log", status_code=204)
    def post_log(body: dict = Body(...)):
        """บรรทัด log จากหน้าเว็บ {level 1-4, function, text} เช่น Print ของ Upcoming passes ("multi_pass_response: PRINT not implemented")
        ผ่านตัวกรองระดับของ session เหมือน record อื่น ผิดรูปแบบ: 422 LOG_INVALID"""
        level, function, text = gplog.parse_entry(body)
        _log.log(gplog.PYTHON_LEVEL[level], "%s", text, extra={"gp_function": function})
        return Response(status_code=204)

    def repo_text(path: Path) -> PlainTextResponse:
        try:
            return PlainTextResponse(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):                # ไม่มีไฟล์ อ่านไม่ได้ หรือไม่ใช่ UTF-8
            raise ApiError("NOT_FOUND", 404, f"ไม่พบหรืออ่านไฟล์ {path.name} ของ repo ไม่ได้") from None

    @app.get("/api/license", response_class=PlainTextResponse)
    def license_text():
        return repo_text(LICENSE_FILE)

    @app.get("/api/readme", response_class=PlainTextResponse)
    def readme_text():
        """README ของ Gpredict Web ให้ Help → Online help แสดงในหน้าเว็บ (ไม่ลิงก์ออกนอกโปรแกรม)"""
        return repo_text(README_FILE)

    @app.websocket("/ws/modules/{name}")
    async def module_socket(ws: WebSocket, name: str):
        await ws.accept()
        if hub.get(name) is None:
            await ws.close(code=WS_NOT_OPEN, reason="module ไม่ได้เปิดอยู่")
            return
        ticks.attach(name, ws)
        try:
            while (await ws.receive())["type"] != "websocket.disconnect":
                pass                             # ไม่มีคำสั่งจาก browser ทาง socket (ใช้ REST)
        finally:
            ticks.detach(name, ws)

    @app.websocket("/ws/app")
    async def app_socket(ws: WebSocket):
        """เหตุการณ์ระดับโปรแกรม (appevents.py) ส่งทางเดียวจาก server ไม่มีคำสั่งจาก browser ทาง socket (ใช้ REST) Host และ Origin
        ตรวจที่ _HostOriginGuard เหมือนทุก endpoint"""
        await ws.accept()
        await events.add(ws)
        try:
            while (await ws.receive())["type"] != "websocket.disconnect":
                pass
        finally:
            events.remove(ws)

    return app


def __getattr__(name: str):
    """`gpredict_web.app:app` สำหรับ uvicorn --reload: สร้างจาก Config.from_env() เมื่อถูกอ่านครั้งแรกเท่านั้น"""
    if name == "app":
        global app
        app = create_app(Config.from_env())
        return app
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
