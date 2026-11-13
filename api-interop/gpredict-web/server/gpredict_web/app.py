"""FastAPI app ของ Gpredict Web: REST /api, WebSocket /ws/modules/{name} และไฟล์หน้าเว็บที่ build แล้ว (หัวข้อ 3 และ 7 ของ spec)

- route ตามตารางหัวข้อ 7.3 ทุกบรรทัด + GET /api/meta (ค่าคงที่ของ module.py ให้หน้าเว็บ) + GET /api/license + GET /api/readme (Help → Online help)
  + GET/PUT /api/prefs (Preferences: ตรวจ schema ที่ prefs.py ที่เดียว)
- error ทุกชนิดตอบเป็น {code, level, text, object} (หัวข้อ 7.4) ข้อมูลที่อ่านไม่ได้หรือผิดชนิดตาม route เป็น 422 REQUEST_INVALID
- เวลาใน API เป็น ISO 8601 UTC ความละเอียดมิลลิวินาที ลงท้าย Z
- ตอนเริ่ม (start_background=True): ลบช่วงคำนวณเก่า, bootstrap (หัวข้อ 7.1) แล้วเปิด module ที่ค้างอยู่ใน session.json
  ตอนปิด: ปิด runtime ทุกตัว และ EphemManager.close() (kill GMAT ที่กำลังรัน เพราะ GMAT อยู่ใน session ของตัวเอง)
- dev: `uvicorn gpredict_web.app:app --reload --port 8740` (app สร้างเมื่อถูกอ่านครั้งแรก การ import เฉยๆ จึงไม่แตะ data จริง)
"""

import asyncio
import json
import logging
import math
import threading
from collections.abc import Callable, Iterable
from contextlib import asynccontextmanager
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import urlopen

from fastapi import Body, FastAPI, Query, Request, WebSocket
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, Response
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.datastructures import Headers

from gnss_predict import omm
from gnss_predict.config import REPO_ROOT
from gnss_predict.errors import Message

from . import module as M
from . import store as S
from .bootstrap import bootstrap
from .clock import STATES, THROTTLE_MAX, THROTTLE_MIN, ModuleClock
from .config import MAX_SATS, NAME_RE, TLE_GROUPS, Config
from .ephem import EphemManager
from .errors import ApiError
from .prefs import Prefs
from .runtime import Hub, ModuleClosedError, ModuleRuntime, iso_ms
from .satdb import SatDb, SatRecord, update_from_network
from .store import Store, qth_from_dict

SATDB_FILE = "satdb.json"
SEARCH_LIMIT = 500                     # GET /api/satellites สูงสุด 500 แถว (หัวข้อ 7.3)
SEARCH_Q_MAX = 64                      # q ยาวกว่านี้ไม่ใช่ชื่อหรือ NORAD (และ int ยาวเกิน 4300 หลักทำให้ search ล้ม)
CLOCK_MIN = datetime(1957, 10, 4, tzinfo=timezone.utc)      # นาฬิการับเวลาตั้งแต่ Sputnik 1
CLOCK_END = datetime(2101, 1, 1, tzinfo=timezone.utc)       # ถึงสิ้นปี 2100 (ไม่รวมค่านี้)
SEND_TIMEOUT_S = 10.0                  # socket ที่รับ tick ไม่ทันนานกว่านี้ถูกตัด (ไม่ให้ขวาง tab อื่นของ module เดียวกัน)
WS_NOT_OPEN = 1008                     # close code: module ไม่ได้เปิดอยู่ (policy violation)
WS_MODULE_CLOSED = 1000                # close code: module ถูกปิดหรือลบ (ใช้กับกรณีนี้เท่านั้น หน้าเว็บไม่ต่อใหม่)
WS_SERVER_STOP = 1001                  # close code: server กำลังปิด
WS_INTERNAL_ERROR = 1011               # close code: producer หยุดเพราะ error ภายใน (หน้าเว็บต่อใหม่)
WS_SEND_FAILED = 1013                  # close code: ส่ง tick ให้ socket นี้ไม่ทันหรือไม่สำเร็จ (Try Again Later)
LOCAL_HOSTS = ("127.0.0.1", "localhost", "::1")     # ชื่อของเครื่องตัวเองที่ browser ใช้เปิด server
LICENSE_FILE = REPO_ROOT / "License.txt"
README_FILE = REPO_ROOT / "api-interop" / "gpredict-web" / "README.md"      # คู่มือที่ Help → Online help แสดงในหน้าเว็บ
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


def _compute_round(rt: ModuleRuntime) -> tuple[str, bool, int]:
    """งานใน thread ของหนึ่งรอบ: tick, แปลงเป็น JSON และ refresh.data_ms ล่าสุด (อ่านใหม่ทุกรอบ)
    ModuleClosedError และ error อื่นส่งต่อให้ producer ตัดสิน"""
    text, nonfinite = _tick_json(rt.tick())
    return text, nonfinite, rt.module.refresh["data_ms"]


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
    tick() มีสถานะ (range rate ของ tick ก่อน, ช่วงถัดไป, การหา pass) จึงเรียกครั้งเดียวต่อรอบแล้วส่งก้อนเดียวกันให้ทุก socket
    ของ module นั้น ทุกรอบห่าง refresh.data_ms (อ่านใหม่ทุกรอบ) งาน tick และแปลง JSON ทำใน thread ด้วย asyncio.to_thread
    ทุกเมธอดถูกเรียกใน event loop เดียวกัน จึงไม่ต้องมี lock

    close code ที่หน้าเว็บใช้ตัดสินว่าจะต่อใหม่หรือไม่: 1000 เฉพาะ module ถูกปิดหรือลบ (ไม่ต่อใหม่), 1008 module ไม่ได้เปิด,
    1001 server ปิด, 1011 producer หยุดเพราะ error ภายใน, 1013 ส่ง tick ให้ socket นั้นไม่ทันหรือไม่สำเร็จ
    รอบที่พัง (tick, แปลง JSON, ส่ง) ถูกข้ามและ log ครั้งเดียว socket ไม่ถูกปิด"""

    def __init__(self, hub: Hub):
        self._hub = hub
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
        if name not in self._tasks:
            self._tasks[name] = asyncio.get_running_loop().create_task(self._produce(name), name=f"ticks:{name}")

    def detach(self, name: str, ws: WebSocket) -> None:
        """socket หลุดหรือปิด: socket สุดท้ายของ module ออกแล้วหยุด producer (module ยังเปิดอยู่)"""
        sockets = self._sockets.get(name)
        if sockets is None:
            return
        sockets.discard(ws)
        if not sockets:
            del self._sockets[name]
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
            while self._sockets.get(name):
                rt = self._hub.get(name)
                if rt is None:                   # ปิดแล้ว หรือกำลังสร้างใหม่ (socket ต้องต่อใหม่กับ runtime ตัวใหม่)
                    break
                started = loop.time()
                try:
                    text, nonfinite, data_ms = await asyncio.to_thread(_compute_round, rt)
                    await self._broadcast(name, text)
                except ModuleClosedError:
                    break
                except Exception:
                    logs.enter("round", logging.ERROR, "รอบ tick ล้มเหลว ข้ามรอบนี้", exc_info=True)
                else:
                    logs.leave("round", "ส่ง tick ได้อีกครั้ง")
                    if nonfinite:
                        logs.enter("nonfinite", logging.WARNING, "tick มีค่า NaN/Infinity ส่งเป็น null แทน")
                    else:
                        logs.leave("nonfinite", "tick ไม่มีค่า NaN/Infinity แล้ว")
                await asyncio.sleep(max(0.0, data_ms / 1000.0 - (loop.time() - started)))
        except asyncio.CancelledError:
            raise
        except Exception:
            _log.exception("producer ของ module %s หยุดเพราะ error ที่ไม่คาดไว้", name)
            code = WS_INTERNAL_ERROR
        finally:
            if self._tasks.get(name) is me:      # จบเอง (module ปิด, error, ไม่มี socket แล้ว) ไม่ใช่ถูก end/detach ยกเลิก
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


def _clock_dict(clock: ModuleClock) -> dict:
    t, state, throttle, label = clock.snapshot()
    return {"state": state, "throttle": throttle, "time": iso_ms(t), "label": label}


def _prefs_dict(prefs: Prefs) -> dict:
    """GET และ PUT /api/prefs: ค่าที่ใช้อยู่ทุก key, ค่าตั้งต้น (ให้ปุ่ม Reset ของหน้าเว็บไม่ต้องมีสำเนา) และ key ที่ผู้ใช้ตั้งเอง"""
    return {"values": prefs.values(), "defaults": prefs.defaults(), "user": prefs.user_keys()}


def _meta() -> dict:
    """ค่าคงที่ที่หน้าเว็บใช้เป็นป้าย tooltip และค่าตั้งต้น (ชุดเดียวกับที่ server ใช้ตรวจ module)"""
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
    }


# ---------------------------------------------------------------- ตรวจข้อมูล

def _check_case_clash(existing: list[str], name: str, code: str, field: str, kind: str) -> None:
    """ดิสก์ของ macOS ไม่แยกตัวพิมพ์: ชื่อที่ต่างกันแค่ตัวพิมพ์เล็ก-ใหญ่จะเขียนทับไฟล์ของอีกชื่อ"""
    clash = [n for n in existing if n != name and n.casefold() == name.casefold()]
    if clash:
        raise ApiError(code, 422, f"มี {kind} ชื่อ {clash[0]} อยู่แล้ว ชื่อที่ต่างกันแค่ตัวพิมพ์เล็ก-ใหญ่ใช้ด้วยกันไม่ได้", field)


def _clock_invalid(field: str | None, text: str) -> ApiError:
    return ApiError("CLOCK_INVALID", 422, text, field)


def _parse_clock_time(value) -> datetime:
    text = (f"เวลา (time) ต้องเป็น ISO 8601 ที่มี timezone (เช่น 2026-11-12T07:00:00.000Z) "
            f"ระหว่าง {CLOCK_MIN:%Y-%m-%d} ถึง 2100-12-31 UTC")
    if not isinstance(value, str):
        raise _clock_invalid("time", text)
    try:
        t = datetime.fromisoformat(value)
        if t.tzinfo is None or t.utcoffset() is None:
            raise ValueError("ไม่มี timezone")
        t = t.astimezone(_UTC)
    except (ValueError, OverflowError):
        raise _clock_invalid("time", text) from None
    if not CLOCK_MIN <= t < CLOCK_END:
        raise _clock_invalid("time", text)
    return t


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
               allowed_hosts: Iterable[str] | None = None) -> FastAPI:
    """- start_background=False (test): ไม่ prune/bootstrap/เปิด session ตอนเริ่ม และ EphemManager ที่สร้างเองไม่มี worker thread
    - opener: ใช้ดึง OMM (test ส่งตัวปลอม), now: เวลาเครื่อง (UTC), on_quit: เรียกเมื่อ POST /api/quit
    - ephem: EphemManager ที่ใช้แทน (test ส่งตัวที่ใช้ propagate ปลอม) ตัวที่ส่งมาก็ถูก close() ตอนปิด app
    - allowed_hosts: ชื่อเครื่องที่รับใน Host และ Origin (None = host_allow_list() คือเครื่องตัวเองเท่านั้น)"""
    store = Store(cfg.data_dir)
    satdb = SatDb(cfg.data_dir / SATDB_FILE)
    ephem = ephem if ephem is not None else EphemManager(cfg, start_worker=start_background)
    prefs = Prefs(cfg.data_dir)
    hub = Hub(store, satdb, ephem, now, prefs=prefs)
    ticks = Ticks(hub)
    session_lock = threading.Lock()          # อ่าน-แก้-เขียน session.json ทีละคำขอ
    tle_lock = threading.Lock()              # Update TLE ทีละครั้ง (state file ของ engine ไม่มี lock)

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
        t = now()
        ephem.prune(t)
        messages = bootstrap(store, satdb, cfg, t, opener)
        for name in store.session():
            try:
                hub.open(name)
            except ApiError as exc:
                _log.warning("เปิด module %s ที่ค้างใน session ไม่ได้: %s", name, exc.text)
                session_remove(name)
                messages.append(Message(exc.code, "error",
                                        f"เปิด module {name} ที่เปิดค้างไว้ไม่ได้ จึงเอาออกจากแท็บ: {exc.text}", name))
        return messages

    def shutdown() -> None:
        for name in hub.open_names():
            try:
                hub.close(name)
            except Exception:
                _log.exception("ปิด module %s ไม่สำเร็จ", name)
        ephem.close()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if start_background:
            app.state.startup_messages = await asyncio.to_thread(startup)
        try:
            yield
        finally:
            await ticks.shutdown()
            await asyncio.to_thread(shutdown)

    app = FastAPI(title="Gpredict Web", lifespan=lifespan, openapi_url="/api/openapi.json", docs_url="/api/docs",
                  redoc_url=None)
    app.state.config = cfg
    app.state.store = store
    app.state.prefs = prefs
    app.state.satdb = satdb
    app.state.ephem = ephem
    app.state.hub = hub
    app.state.ticks = ticks
    app.state.tle_lock = tle_lock
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

    @app.put("/api/qth/{name}")
    def put_qth(name: str, body: dict = Body(...)):
        if body.get("name") != name:
            raise ApiError("QTH_INVALID", 422, f"ชื่อ QTH (name) ต้องตรงกับชื่อใน URL ({name})", "name")
        _check_case_clash(store.qth_names(), name, "QTH_INVALID", "name", "QTH")
        q = qth_from_dict(body)
        store.put_qth(q)
        for m in store.modules_using_qth(name):       # module ที่เปิดอยู่และใช้สถานีนี้ได้ตำแหน่งใหม่ใน tick ถัดไป
            try:
                hub.reload(m)
            except ApiError as exc:
                _log.warning("อ่าน module %s ใหม่หลังแก้ QTH %s ไม่ได้: %s", m, name, exc.text)
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
        return _sat_dict(r, with_tle=True)

    @app.get("/api/tle/groups")
    def tle_groups():
        state = omm.read_state(cfg.state_file)            # celestrak_state.json ที่ใช้ร่วมกับ GNSS Studio
        out = []
        for g in TLE_GROUPS:
            entry = state.get(g) if isinstance(state.get(g), dict) else {}
            out.append({"name": g, "last_request": iso_ms(omm.parse_state_time(entry.get("last_request"))),
                        "last_success": iso_ms(omm.parse_state_time(entry.get("last_success")))})
        return {"groups": out}

    def update_tle() -> dict:
        with tle_lock:
            result = update_from_network(satdb, cfg, now(), TLE_GROUPS, opener)
            messages = list(result.messages)
            for name in hub.open_names():
                try:
                    hub.reload(name)
                except ApiError as exc:
                    messages.append(Message(exc.code, "warning",
                                            f"อ่าน module {name} ใหม่หลังอัปเดต TLE ไม่ได้: {exc.text}", name))
        clear_startup_messages()
        return {"updated": result.updated, "skipped": result.skipped, "missing": result.missing,
                "messages": [m.to_dict() for m in messages]}

    @app.post("/api/tle/update")
    async def tle_update():
        return await asyncio.to_thread(update_tle)

    # ---------------- module

    @app.get("/api/modules")
    def list_modules():
        return {"modules": store.list_modules(), "open": open_list(),
                "messages": [m.to_dict() for m in app.state.startup_messages]}

    @app.get("/api/modules/{name}")
    def get_module(name: str):
        return M.module_to_dict(store.get_module(name))

    @app.put("/api/modules/{name}")
    def put_module(name: str, body: dict = Body(...)):
        if body.get("name") != name:
            raise ApiError("MODULE_INVALID", 422, f"ชื่อ module (name) ต้องตรงกับชื่อใน URL ({name})", "name")
        _check_case_clash(store.list_modules(), name, "MODULE_INVALID", "name", "module")
        m = M.module_from_dict(body, set(store.qth_names()), satdb.norads())
        store.put_module(m)
        hub.reload(name)                     # เปิดอยู่: tick ถัดไปของทุกแท็บใช้ค่าใหม่ (ไม่ได้เปิด: ไม่ทำอะไร)
        clear_startup_messages()
        return M.module_to_dict(m)

    def delete_module_sync(name: str) -> None:
        hub.close(name)                      # เปิดอยู่: ปิดก่อน
        with session_lock:
            store.delete_module(name)        # เอาออกจาก session ด้วย

    @app.delete("/api/modules/{name}", status_code=204)
    async def delete_module(name: str):
        await asyncio.to_thread(delete_module_sync, name)
        await ticks.end(name)
        return Response(status_code=204)

    @app.post("/api/modules/{name}/open")
    def open_module(name: str):
        hub.open(name)
        session_add(name)
        return {"open": open_list()}

    def close_module_sync(name: str) -> list[str]:
        if hub.get(name) is None and name not in store.list_modules():
            raise ApiError("NOT_FOUND", 404, f"ไม่พบ module ชื่อ {name}", name)
        hub.close(name)
        session_remove(name)
        return open_list()

    @app.post("/api/modules/{name}/close")
    async def close_module(name: str):
        opened = await asyncio.to_thread(close_module_sync, name)
        await ticks.end(name)
        return {"open": opened}

    @app.post("/api/modules/{name}/clone")
    def clone_module(name: str, body: dict = Body(...)):
        src = store.get_module(name)
        new_name, want_open = body.get("new_name"), body.get("open", True)    # Gpredict: "Open module when created" ตั้งต้นเปิด
        if not (isinstance(new_name, str) and NAME_RE.fullmatch(new_name)):
            raise ApiError("MODULE_INVALID", 422,
                           "ชื่อ module ใหม่ (new_name) ต้องเป็นตัวอักษร A-Z, a-z, ตัวเลข, _ หรือ - ยาว 1-25 ตัว", "new_name")
        if not isinstance(want_open, bool):
            raise ApiError("MODULE_INVALID", 422, "การเปิด module ที่สร้าง (open) ต้องเป็น true หรือ false", "open")
        clash = [n for n in store.list_modules() if n.casefold() == new_name.casefold()]
        if clash:
            raise ApiError("MODULE_INVALID", 422, f"มี module ชื่อ {clash[0]} อยู่แล้ว (new_name)", "new_name")
        m = M.module_from_dict({**M.module_to_dict(src), "name": new_name}, set(store.qth_names()), satdb.norads())
        store.put_module(m)
        clear_startup_messages()
        if want_open:
            hub.open(new_name)
            session_add(new_name)
        return {"module": M.module_to_dict(m), "open": open_list()}

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

    # ---------------- Preferences

    @app.get("/api/prefs")
    def get_prefs():
        return _prefs_dict(prefs)

    @app.put("/api/prefs")
    def put_prefs(body: dict = Body(...)):
        """{"set": {key: ค่า}, "remove": [key]} (ไม่ใส่ = ว่าง) ตรวจทุก key ก่อนเขียน ผิดตัวเดียวไม่เขียนเลย"""
        set_ = body.get("set", {})
        remove = body.get("remove", [])
        if not isinstance(set_, dict):
            raise ApiError("PREFS_INVALID", 422, "ค่าที่จะตั้ง (set) ต้องเป็น object ที่มี key ของ Preferences เป็นชื่อ", "set")
        if not isinstance(remove, list) or not all(isinstance(k, str) for k in remove):
            raise ApiError("PREFS_INVALID", 422, "รายการที่จะลบ (remove) ต้องเป็นรายการชื่อ key ของ Preferences", "remove")
        prefs.update(set_, remove)
        return _prefs_dict(prefs)

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
        return _meta()

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

    return app


def __getattr__(name: str):
    """`gpredict_web.app:app` สำหรับ uvicorn --reload: สร้างจาก Config.from_env() เมื่อถูกอ่านครั้งแรกเท่านั้น"""
    if name == "app":
        global app
        app = create_app(Config.from_env())
        return app
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
