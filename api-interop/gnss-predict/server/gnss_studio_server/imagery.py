"""ภาพถ่ายออนไลน์จาก NASA GIBS: รายการชั้นภาพ ตัวดึงชิ้นภาพ และ cache บนดิสก์ (spec ภาพออนไลน์ §3, §4, §6)

server เป็นจุดเดียวที่ต่อ GIBS: URL ปลายทางประกอบจาก `CATALOG` กับค่าที่ผ่าน `valid_time` / `tile_in_range` เท่านั้น ไม่รับ URL, host หรือ path จากผู้ใช้
สวิตช์ `online_imagery.enabled` ตรวจที่ route ทุกคำขอ (อ่านจาก settings.json) และตัวดึงตรวจซ้ำอีกครั้งด้วย `enabled` ที่ฉีดเข้ามา
หลังได้คิวและก่อนต่อเน็ตเสมอ (คำขอที่รอคิวอยู่ตอนผู้ใช้ปิดสวิตช์ต้องไม่ถูกส่งไป GIBS) แต่ยังห้ามเรียก `TileFetcher.get` นอก route ที่ตรวจสวิตช์แล้ว

- `CATALOG`: ตารางเดียวของชั้นภาพ (ลำดับ = ลำดับวาด ชั้นหลังทับชั้นก่อน) ค่า TileMatrixSet / ext / รูปแบบเวลายังรอยืนยันกับ GIBS จริง (ขั้น B0)
  แก้ที่ตารางนี้ที่เดียว
- `TileFetcher.get(layer, time, z, y, x)` -> (ไบต์, media type) หรือ `ApiError`:
  1. ชิ้นที่อยู่ใน cache ส่งเลย (แตะ mtime) แม้กำลังพักการดึง; ชิ้นที่ cache เสีย (ไม่ใช่ JPEG/PNG ตาม ext) ถูกลบแล้วนับเป็นไม่มี
  2. ชิ้นที่ GIBS เคยตอบ 400/404 ไม่ถามซ้ำ 1 ชั่วโมง (จำในหน่วยความจำ สูงสุด 10,000 รายการ) -> 404 `IMAGERY_NOT_AVAILABLE`
  3. กำลังพัก -> 503 `IMAGERY_PAUSED` (detail = เวลา UTC ที่ลองได้อีก)
  4. ดึงพร้อมกันได้ไม่เกิน 4 ชิ้น รอคิวเกิน 15 วินาที -> 503 `IMAGERY_BUSY` (หลังได้คิวตรวจข้อ 1-3 ซ้ำ แล้วตรวจสวิตช์อีกครั้ง
     ปิดอยู่ -> 403 `IMAGERY_DISABLED` ไม่ต่อเน็ต)
  5. ดึงครั้งเดียว ไม่ลองซ้ำ timeout 20 วินาที ไม่ตาม redirect (3xx = ล้มเหลว) อ่านไม่เกิน 2 MB + 1 ไบต์
     400/404 -> จำว่าไม่มีภาพ; 403/429 -> พักทุกชั้นภาพ 15 นาที (log ครั้งเดียวต่อการพัก);
     ผิดพลาดอื่น (เครือข่าย timeout 5xx redirect ตอบผิดรูป ภาพที่ตัดกลางทาง ภาพเกิน 2 MB ไม่ใช่ JPEG/PNG ตรงกับ ext) -> 502 `IMAGERY_FETCH_FAILED`
     และนับ: ติดกัน 20 ครั้ง -> พัก 5 นาที (ตัวนับกลับเป็น 0 เมื่อพัก และเมื่อได้ภาพที่ใช้ได้หนึ่งชิ้น)
  6. ภาพที่ผ่านการตรวจเขียน cache แบบ atomic (เขียนไม่ได้ = log เตือนครั้งเดียว ส่งภาพให้อยู่ดี)
  ชิ้นที่ "ยังไม่นิ่ง" (`is_settled` เป็นเท็จ: daily ที่วันที่ UTC >= วันนี้ - 1 วัน, 10min ที่เวลาของ token >= ตอนนี้ - 3 ชั่วโมง รวมอนาคต)
  ดึงและส่งได้ตามปกติแต่ไม่เขียน cache ไม่อ่านจาก cache (ไฟล์เก่าของ token นั้นถูกมองข้าม) และ "ไม่มีภาพ" จำแค่ 10 นาที: GIBS
  ยังประมวลผลภาพของช่วงนี้อยู่ ภาพที่ได้ตอนนี้อาจไม่ครบหรือถูกแทนที่ภายหลัง; static (`default`) นิ่งเสมอ
  ไม่ถอดรหัสภาพ ไม่เชื่อ Content-Type ของ GIBS: media type มาจากชนิดที่ตรวจได้จาก magic bytes
- `TileCache`: `<data>/imagery/tiles/<layer>/<time ที่ ':' เป็น '-'>/<z>/<y>/<x>.<ext>` path ถูก resolve แล้วต้องอยู่ใต้ root (symlink ที่ชี้ออกนอก = ValueError)
  นับขนาดรวมครั้งแรกด้วยการสแกนแล้วจำยอดในหน่วยความจำ เกิน `CACHE_CAP_BYTES` ลบไฟล์ mtime เก่าสุดจนเหลือ `CACHE_LOW_WATER` ของเพดาน
- `now` เป็นนาฬิกาแบบ monotonic (วินาที) ใช้กับการพักและอายุของ "ไม่มีภาพ"; `utcnow` เป็นนาฬิกาเวลาจริง (UTC, มี tzinfo) ใช้ตัดสินว่าชิ้นภาพนิ่งหรือยัง
  และคำนวณเวลาที่ตอบใน `IMAGERY_PAUSED` (เวลา UTC ปัจจุบันบวกเวลาพักที่เหลือ) ทั้งสองฉีดเข้าได้ใน test
"""

import http.client
import logging
import os
import re
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable, Literal

from .errors import ApiError
from .store import write_atomic

# ---------- ค่าคงที่ (Global Constraints) ----------

GIBS_URL = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/{layer}/default/{time}/{tms}/{z}/{y}/{x}.{ext}"
USER_AGENT = "gnss-studio/0.1"
FETCH_TIMEOUT_S = 20
MAX_CONCURRENT = 4
QUEUE_WAIT_S = 15
PAUSE_FORBIDDEN_S = 15 * 60                    # GIBS ตอบ 403 หรือ 429
FAILURE_LIMIT = 20                             # ผิดพลาดติดกันกี่ครั้งถึงพัก
PAUSE_FAILURES_S = 5 * 60
MAX_BODY_BYTES = 2 * 1024 * 1024
CACHE_CAP_BYTES = 2 * 1024 ** 3
CACHE_LOW_WATER = 0.9                          # เกินเพดานแล้วลบจนเหลือสัดส่วนนี้ของเพดาน
MEMO_TTL_S = 3600
MEMO_UNSETTLED_TTL_S = 10 * 60                 # "ไม่มีภาพ" ของชิ้นที่ยังไม่นิ่งจำสั้นกว่า: ภาพอาจมาทีหลัง
MEMO_MAX_ENTRIES = 10_000
SETTLE_DAILY_DAYS = 1                          # daily นิ่งเมื่อวันที่ UTC < วันนี้ - 1 วัน
SETTLE_10MIN_HOURS = 3                         # 10min นิ่งเมื่อเวลาของ token < ตอนนี้ - 3 ชั่วโมง

MEDIA_TYPES = {"jpg": "image/jpeg", "png": "image/png"}

NOT_AVAILABLE_TEXT = "ไม่มีภาพของชั้นนี้ ณ เวลานี้"
FETCH_FAILED_TEXT = "ดึงภาพจาก NASA GIBS ไม่สำเร็จ"
BUSY_TEXT = "มีคำขอภาพค้างอยู่มาก ลองใหม่อีกครั้ง"
PAUSED_TEXT = "หยุดดึงภาพจาก NASA GIBS ชั่วคราว"
TIME_TEXT = "เวลาของภาพไม่ถูกต้องสำหรับชั้นภาพนี้"
COORD_TEXT = "{name} ต้องเป็นจำนวนเต็มตั้งแต่ 0 ถึง {top}"
DISABLED_TEXT = "ภาพออนไลน์ปิดอยู่ เปิดได้ที่ View → Globe Manager"


# ---------- catalog ----------

@dataclass(frozen=True)
class Layer:
    id: str
    title: str
    period: Literal["static", "daily", "10min"]
    tms: str
    max_level: int
    ext: Literal["jpg", "png"]
    credit: str


CATALOG: tuple[Layer, ...] = (
    Layer("BlueMarble_NextGeneration", "Blue Marble", "static", "GoogleMapsCompatible_Level8", 8, "jpg", "NASA GIBS / EOSDIS"),
    Layer("VIIRS_NOAA20_CorrectedReflectance_TrueColor", "VIIRS NOAA-20 True Color", "daily", "GoogleMapsCompatible_Level9", 9, "jpg",
          "NASA GIBS / EOSDIS"),
    Layer("VIIRS_SNPP_CorrectedReflectance_TrueColor", "VIIRS Suomi NPP True Color", "daily", "GoogleMapsCompatible_Level9", 9, "jpg",
          "NASA GIBS / EOSDIS"),
    Layer("MODIS_Terra_CorrectedReflectance_TrueColor", "MODIS Terra True Color", "daily", "GoogleMapsCompatible_Level9", 9, "jpg",
          "NASA GIBS / EOSDIS"),
    Layer("Himawari_AHI_Band3_Red_Visible_1km", "Himawari-9 Red Visible", "10min", "GoogleMapsCompatible_Level7", 7, "png",
          "NASA GIBS / EOSDIS, JMA"),
    Layer("Himawari_AHI_Band13_Clean_Infrared", "Himawari-9 Clean Infrared", "10min", "GoogleMapsCompatible_Level6", 6, "png",
          "NASA GIBS / EOSDIS, JMA"),
    Layer("GOES-East_ABI_GeoColor", "GOES-East GeoColor", "10min", "GoogleMapsCompatible_Level7", 7, "jpg", "NASA GIBS / EOSDIS, NOAA"),
    Layer("GOES-West_ABI_GeoColor", "GOES-West GeoColor", "10min", "GoogleMapsCompatible_Level7", 7, "jpg", "NASA GIBS / EOSDIS, NOAA"),
)
_BY_ID = {layer.id: layer for layer in CATALOG}


def layer_by_id(id: str) -> Layer | None:
    """ชั้นภาพที่ id ตรงทุกตัวอักษร (แยกตัวพิมพ์เล็กใหญ่) หรือ None"""
    return _BY_ID.get(id) if isinstance(id, str) else None


# ---------- ตรวจค่าที่ประกอบเป็นที่อยู่ของชิ้นภาพ ----------
# ใช้ [0-9] ไม่ใช่ \d: \d ของ regex (และ int()) รับเลขนอก ASCII ด้วย; ใช้ fullmatch ไม่ใช่ $: $ ยอมให้มี \n ต่อท้าย

_DAY_RE = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")
_SLOT_RE = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-5]0:00Z")
_COORD_RE = re.compile(r"[0-9]{1,3}")


def valid_time(layer: Layer, time: str) -> bool:
    """token เวลาที่ถูกต้องของรอบภาพของชั้นนั้น: static `default`; daily วันที่จริง `YYYY-MM-DD`; 10min เวลาจริงที่นาทีเป็น 00,10,..,50"""
    if not isinstance(time, str):
        return False
    if layer.period == "static":
        return time == "default"
    pattern, fmt = (_DAY_RE, "%Y-%m-%d") if layer.period == "daily" else (_SLOT_RE, "%Y-%m-%dT%H:%M:%SZ")
    if not pattern.fullmatch(time):
        return False
    try:
        datetime.strptime(time, fmt)                  # วันที่หรือเวลาที่ไม่มีจริง (30 ก.พ., ชั่วโมง 24) ไม่ผ่าน
    except ValueError:
        return False
    return True


def is_settled(layer: Layer, time: str, now: datetime) -> bool:
    """ชิ้นภาพของ token เวลานี้นิ่งแล้วหรือยัง (cache ได้ถาวรหรือไม่): static นิ่งเสมอ; daily นิ่งเมื่อวันที่ < (วันนี้ UTC - 1 วัน)
    คือวันนี้ เมื่อวาน และอนาคตยังไม่นิ่ง; 10min นิ่งเมื่อเวลาของ token < ตอนนี้ - 3 ชั่วโมง (พอดี 3 ชั่วโมงและอนาคตยังไม่นิ่ง)
    `now` ต้องมี tzinfo; `time` ต้องผ่าน `valid_time` แล้ว"""
    if layer.period == "static":
        return True
    now = now.astimezone(timezone.utc)
    if layer.period == "daily":
        return datetime.strptime(time, "%Y-%m-%d").date() < now.date() - timedelta(days=SETTLE_DAILY_DAYS)
    token = datetime.strptime(time, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    return token < now - timedelta(hours=SETTLE_10MIN_HOURS)


def tile_in_range(layer: Layer, z: int, y: int, x: int) -> bool:
    """z อยู่ใน 0..max_level และ y, x อยู่ใน 0..2^z-1 (ต้องเป็น int จริง ไม่ใช่ bool หรือสตริง)"""
    if any(type(v) is not int for v in (z, y, x)):
        return False
    return 0 <= z <= layer.max_level and 0 <= y < 2 ** z and 0 <= x < 2 ** z


def check_time(layer: Layer, time: str) -> None:
    if not valid_time(layer, time):
        raise ApiError(422, "SCENARIO_INVALID", TIME_TEXT, "time", f"expected a {layer.period} token for {layer.id}")


def _coord(raw: str, name: str, limit: int) -> int:
    if not isinstance(raw, str) or not _COORD_RE.fullmatch(raw) or int(raw) >= limit:
        text = COORD_TEXT.format(name=("ระดับซูม z" if name == "z" else f"ตำแหน่งชิ้นภาพ {name}"), top=limit - 1)
        raise ApiError(422, "SCENARIO_INVALID", text, name, f"expected an integer in 0..{limit - 1}")
    return int(raw)


def parse_tile_coords(layer: Layer, z: str, y: str, x: str) -> tuple[int, int, int]:
    """z, y, x จาก path (สตริง) เป็น int: ตัวเลขทศนิยม ASCII 1-3 หลักเท่านั้นและอยู่ในช่วง ไม่ตรง -> ApiError 422 ที่ field นั้น (ตรวจ z ก่อน y และ x)"""
    zi = _coord(z, "z", layer.max_level + 1)
    return zi, _coord(y, "y", 2 ** zi), _coord(x, "x", 2 ** zi)


def upstream_url(layer: Layer, time: str, z: int, y: int, x: int) -> str:
    """URL ของชิ้นภาพบน GIBS (WMTS REST, EPSG:3857) ประกอบจากชั้นภาพและค่าที่ตรวจแล้วเท่านั้น"""
    return GIBS_URL.format(layer=layer.id, time=time, tms=layer.tms, z=z, y=y, x=x, ext=layer.ext)


def detect_format(data: bytes) -> str | None:
    """ชนิดภาพจาก magic bytes (`jpg` = FF D8 FF, `png` = 89 50 4E 47 0D 0A 1A 0A) ไม่ใช่ทั้งสองอย่าง = None"""
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    return None


# ---------- ดึงจากเน็ต ----------

class NoRedirect(urllib.request.HTTPRedirectHandler):
    """ไม่ตาม redirect เลย: 3xx กลายเป็น HTTPError (นับเป็นดึงไม่สำเร็จ) ไม่มีทางถูกพาไปโฮสต์อื่น"""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def make_opener() -> urllib.request.OpenerDirector:
    """opener ตั้งต้นของตัวดึง: urllib ธรรมดาแต่ใช้ `NoRedirect` แทนตัวตาม redirect"""
    return urllib.request.build_opener(NoRedirect)


def _short(text: object) -> str:
    return " ".join(str(text).split())[:200]


def _content_length(resp) -> int | None:
    headers = getattr(resp, "headers", None)
    value = headers.get("Content-Length") if headers is not None else None
    return int(value) if isinstance(value, str) and value.strip().isascii() and value.strip().isdigit() else None


# ---------- cache บนดิสก์ ----------

class TileCache:
    """ที่เก็บชิ้นภาพ `<root>/<layer>/<time>/<z>/<y>/<x>.<ext>` พร้อมเพดานขนาดรวม

    ขนาดรวมสแกนครั้งแรกที่ต้องใช้แล้วจำในหน่วยความจำ (ปรับตามที่เขียนและลบเอง); เกินเพดานทีไรสแกนอีกครั้งเพื่อเลือกไฟล์ที่ mtime เก่าสุดไปลบ"""

    def __init__(self, root: Path):
        self.root = Path(root)
        self._lock = threading.Lock()
        self._size: int | None = None

    def path(self, layer: Layer, time: str, z: int, y: int, x: int) -> Path:
        """path ของชิ้นภาพ (ไม่ต้องมีอยู่จริง) resolve แล้ว ต้องอยู่ใต้ root มิฉะนั้น ValueError (เช่น symlink ใน cache ที่ชี้ออกนอก)"""
        root = self.root.resolve()
        path = (root / layer.id / time.replace(":", "-") / str(z) / str(y) / f"{x}.{layer.ext}").resolve()
        if not path.is_relative_to(root):
            raise ValueError(f"tile path escapes the cache root: {path}")
        return path

    def read(self, path: Path, ext: str) -> bytes | None:
        """ไบต์ของชิ้นภาพที่เก็บไว้ (แตะ mtime) หรือ None ถ้าไม่มี; ไฟล์ที่ใหญ่เกิน 2 MB หรือไม่ใช่ภาพชนิด `ext` ถูกลบทิ้งแล้วนับเป็นไม่มี"""
        try:
            with open(path, "rb") as f:
                data = f.read(MAX_BODY_BYTES + 1)
        except OSError:
            return None
        if len(data) > MAX_BODY_BYTES or detect_format(data) != ext:
            self._discard(path)
            return None
        try:
            os.utime(path)
        except OSError:
            pass
        return data

    def write(self, path: Path, data: bytes) -> None:
        """เขียนแบบ atomic แล้วบวกขนาดเข้ายอด; เกินเพดานแล้วลบไฟล์เก่าสุด OSError (ดิสก์เต็ม ฯลฯ) ส่งให้ผู้เรียก"""
        self.size_bytes                                       # สแกนก่อนเขียน (ถ้ายังไม่เคย): ไม่งั้นไฟล์ใหม่ถูกนับสองรอบ
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            old = path.stat().st_size
        except OSError:
            old = 0
        write_atomic(path, data)
        with self._lock:
            self._size = (self._size or 0) + len(data) - old
            over = self._size > CACHE_CAP_BYTES
        if over:
            self._evict()

    @property
    def size_bytes(self) -> int:
        with self._lock:
            if self._size is None:
                self._size = sum(size for _, size, _ in self._files())
            return self._size

    def _discard(self, path: Path) -> None:
        try:
            size = path.stat().st_size
            path.unlink()
        except OSError:
            return
        with self._lock:
            if self._size is not None:
                self._size = max(0, self._size - size)

    def _files(self) -> list[tuple[int, int, Path]]:
        """(mtime_ns, ไบต์, path) ของไฟล์ธรรมดาทุกไฟล์ใต้ root (ไม่ตาม symlink)"""
        found, stack = [], [self.root]
        while stack:
            try:
                with os.scandir(stack.pop()) as entries:
                    for entry in entries:
                        if entry.is_symlink():
                            continue
                        if entry.is_dir(follow_symlinks=False):
                            stack.append(Path(entry.path))
                        elif entry.is_file(follow_symlinks=False):
                            st = entry.stat(follow_symlinks=False)
                            found.append((st.st_mtime_ns, st.st_size, Path(entry.path)))
            except OSError:
                continue
        return found

    def _evict(self) -> None:
        with self._lock:                                      # ผู้เขียนอื่นรอตรงนี้สั้น ๆ; ยอดที่สแกนได้แทนยอดในหน่วยความจำ (แก้ความคลาด)
            files = sorted(self._files(), key=lambda f: (f[0], str(f[2])))
            total = sum(size for _, size, _ in files)
            if total > CACHE_CAP_BYTES:
                target = int(CACHE_CAP_BYTES * CACHE_LOW_WATER)
                for _, size, path in files:
                    if total <= target:
                        break
                    try:
                        path.unlink()
                    except FileNotFoundError:
                        pass
                    except OSError:
                        continue
                    total -= size
            self._size = total


# ---------- ตัวดึง ----------

class TileFetcher:
    """ดึงชิ้นภาพ GIBS ตามกติกาที่หัวไฟล์ (ตัวเดียวต่อแอป: เก็บสถานะการพัก ตัวนับ และ "ไม่มีภาพ" ที่จำไว้)

    opener: callable(request, timeout=...) -> response ที่มี `.read(n)` (และ `.status`, `.headers`, `.close()` ถ้ามี) ตั้งต้นคือ `make_opener().open`
    now: นาฬิกา monotonic เป็นวินาที (การพักและอายุของ "ไม่มีภาพ")
    utcnow: นาฬิกาเวลาจริง คืน datetime ที่มี tzinfo ตั้งต้น `datetime.now(timezone.utc)` (ตัดสินว่าชิ้นภาพนิ่งหรือยัง)
    enabled: callable() -> bool อ่านสวิตช์ `online_imagery.enabled` ตอนนั้น (app ต่อเข้ากับ settings.json); ตั้งต้นเปิดเสมอ"""

    def __init__(self, data_dir: Path, opener=None, now=time.monotonic, logger: logging.Logger | None = None,
                 utcnow: Callable[[], datetime] | None = None, enabled: Callable[[], bool] | None = None):
        self.opener = opener if opener is not None else make_opener().open
        self.now = now
        self.utcnow = utcnow if utcnow is not None else (lambda: datetime.now(timezone.utc))
        self.enabled = enabled if enabled is not None else (lambda: True)
        self.logger = logger or logging.getLogger(__name__)
        self.cache = TileCache(Path(data_dir) / "imagery" / "tiles")
        self._slots = threading.BoundedSemaphore(MAX_CONCURRENT)
        self._lock = threading.Lock()                         # ปกป้อง _memo, _paused_until, _failures, _cache_ok
        self._memo: dict[tuple, float] = {}                   # ที่อยู่ของชิ้น -> เวลาหมดอายุ (เรียงตามการใส่)
        self._paused_until = 0.0
        self._failures = 0
        self._cache_ok = True

    def get(self, layer: Layer, time: str, z: int, y: int, x: int) -> tuple[bytes, str]:
        """(ไบต์ของภาพ, media type) หรือ ApiError ตามกติกาที่หัวไฟล์ ค่าที่ไม่ผ่านการตรวจ = ValueError (route ตรวจก่อนเรียกเสมอ)"""
        if not (valid_time(layer, time) and tile_in_range(layer, z, y, x)):
            raise ValueError(f"invalid tile address: {layer.id} {time!r} {z!r}/{y!r}/{x!r}")
        path = self.cache.path(layer, time, z, y, x)
        key = (layer.id, time, z, y, x)
        settled = self.is_settled(layer, time)                # ตัดสินครั้งเดียวต่อคำขอ ใช้ทั้งอ่าน/เขียน cache และอายุของ memo
        data = self._local(layer, key, path, settled)
        if data is None:
            data = self._fetch(layer, key, path, time, z, y, x, settled)
        return data, MEDIA_TYPES[layer.ext]

    def is_settled(self, layer: Layer, time: str) -> bool:
        """ชิ้นภาพของ token นี้นิ่งแล้วหรือยัง ณ ตอนนี้ (ดู `is_settled`): route ใช้เลือก Cache-Control"""
        return is_settled(layer, time, self.utcnow())

    def _local(self, layer: Layer, key: tuple, path: Path, settled: bool) -> bytes | None:
        """คำตอบที่ไม่ต้องต่อเน็ต: ไบต์จาก cache (เฉพาะชิ้นที่นิ่ง), หรือ ApiError (จำว่าไม่มีภาพ / กำลังพัก) ไม่มีคำตอบ = None"""
        data = self.cache.read(path, layer.ext) if settled else None
        if data is not None:
            return data
        with self._lock:
            now = self.now()
            expires = self._memo.get(key)
            if expires is not None:
                if now < expires:
                    raise ApiError(404, "IMAGERY_NOT_AVAILABLE", NOT_AVAILABLE_TEXT)
                del self._memo[key]
            if now < self._paused_until:
                raise self._paused_error(now)
        return None

    def _fetch(self, layer: Layer, key: tuple, path: Path, time: str, z: int, y: int, x: int, settled: bool) -> bytes:
        if not self._slots.acquire(timeout=QUEUE_WAIT_S):
            raise ApiError(503, "IMAGERY_BUSY", BUSY_TEXT)
        try:
            data = self._local(layer, key, path, settled)     # ระหว่างรอคิว อีกคำขอเก็บชิ้นนี้ไว้แล้ว หรือเกิดการพักขึ้น
            if data is not None:
                return data
            if not self.enabled():                            # ระหว่างรอคิว ผู้ใช้อาจปิดสวิตช์: ต้องไม่ต่อเน็ตหลังปิด
                raise ApiError(403, "IMAGERY_DISABLED", DISABLED_TEXT)
            data = self._download(layer, key, upstream_url(layer, time, z, y, x), settled)
            if settled:                                       # ชิ้นที่ยังไม่นิ่งส่งได้แต่ไม่เก็บ: GIBS ยังเติมภาพช่วงนี้อยู่
                self._store(path, data)
            return data
        finally:
            self._slots.release()

    def _download(self, layer: Layer, key: tuple, url: str, settled: bool) -> bytes:
        """ดึงหนึ่งครั้งแล้วตรวจ: ได้ไบต์ของภาพที่ใช้ได้ หรือ ApiError"""
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        try:
            resp = self.opener(request, timeout=FETCH_TIMEOUT_S)
            try:
                status = getattr(resp, "status", 200)
                body = resp.read(MAX_BODY_BYTES + 1)
                announced = _content_length(resp)
            finally:
                close = getattr(resp, "close", None)
                if close is not None:
                    close()
        except urllib.error.HTTPError as exc:                 # ก่อน URLError/OSError: HTTPError เป็นลูกของทั้งสอง
            code = exc.code
            exc.close()
            if code in (400, 404):
                self._remember_missing(key, settled)
                raise ApiError(404, "IMAGERY_NOT_AVAILABLE", NOT_AVAILABLE_TEXT) from None
            if code in (403, 429):
                with self._lock:
                    self._pause_locked(PAUSE_FORBIDDEN_S, f"HTTP {code}")
                raise self._fail(f"HTTP {code}", count=False) from None
            raise self._fail(f"HTTP {code}") from None
        except (OSError, http.client.HTTPException) as exc:   # URLError, timeout, connection reset, IncompleteRead ฯลฯ
            reason = exc.reason if isinstance(exc, urllib.error.URLError) else (str(exc) or type(exc).__name__)
            raise self._fail(f"network error: {_short(reason)}") from None
        if status != 200:
            raise self._fail(f"HTTP {status}")
        if len(body) > MAX_BODY_BYTES:
            raise self._fail(f"body larger than {MAX_BODY_BYTES} bytes")
        if announced is not None and announced != len(body):
            raise self._fail(f"truncated body ({len(body)} of {announced} bytes)")
        if detect_format(body) != layer.ext:
            raise self._fail(f"body is not a {layer.ext} image")
        with self._lock:
            self._failures = 0
        return body

    def _store(self, path: Path, data: bytes) -> None:
        try:
            self.cache.write(path, data)
        except OSError as exc:                                # เก็บไม่ได้ก็ยังส่งภาพให้ผู้ใช้ แต่เตือนครั้งเดียว (ไม่ท่วม log ทุกชิ้น)
            with self._lock:
                first, self._cache_ok = self._cache_ok, False
            if first:
                self.logger.warning("เก็บภาพลง %s ไม่ได้ ส่งภาพให้โดยไม่เก็บ: %s", self.cache.root, exc)
        else:
            with self._lock:
                self._cache_ok = True

    def _remember_missing(self, key: tuple, settled: bool) -> None:
        ttl = MEMO_TTL_S if settled else MEMO_UNSETTLED_TTL_S
        with self._lock:
            self._memo.pop(key, None)
            while len(self._memo) >= MEMO_MAX_ENTRIES:       # เต็มแล้วทิ้งรายการที่ใส่ไว้นานสุด (ไม่จำเป็นต้องเป็นรายการที่หมดอายุก่อน)
                del self._memo[next(iter(self._memo))]
            self._memo[key] = self.now() + ttl

    def _fail(self, reason: str, count: bool = True) -> ApiError:
        """502 `IMAGERY_FETCH_FAILED` และนับความล้มเหลว (ติดกัน FAILURE_LIMIT ครั้ง = พัก) 403/429 ไม่นับ: มีการพักของตัวเอง"""
        if count:
            with self._lock:
                self._failures += 1
                if self._failures >= FAILURE_LIMIT:
                    self._failures = 0
                    self._pause_locked(PAUSE_FAILURES_S, f"{FAILURE_LIMIT} consecutive failures, last: {reason}")
        return ApiError(502, "IMAGERY_FETCH_FAILED", FETCH_FAILED_TEXT, detail=reason)

    def _pause_locked(self, seconds: float, why: str) -> None:
        """พักการดึงทุกชั้นภาพ (เรียกขณะถือ _lock) log ครั้งเดียวต่อการพัก: ผู้ที่ล้มเหลวพร้อมกันระหว่างพักอยู่แล้วไม่ log ซ้ำ"""
        now = self.now()
        was_paused = now < self._paused_until
        self._paused_until = max(self._paused_until, now + seconds)
        if not was_paused:
            self.logger.warning("%s %d นาที (%s)", PAUSED_TEXT, seconds // 60, why)

    def _paused_error(self, now: float) -> ApiError:
        resume = self.utcnow() + timedelta(seconds=self._paused_until - now)
        return ApiError(503, "IMAGERY_PAUSED", PAUSED_TEXT, detail=resume.strftime("%Y-%m-%dT%H:%M:%SZ"))
