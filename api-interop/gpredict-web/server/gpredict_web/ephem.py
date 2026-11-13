"""ตัวจัดการช่วงคำนวณของ GMAT (หัวข้อ 5 ของ spec) เป็นที่เดียวในแอปที่รัน GMAT

- ช่วง (Window) คือ (start, stop) UTC ยาว WINDOW_SPAN_H ชม. ทุก STEP_S วินาที เวลาเดินหน้าหรือหยุดเริ่มที่
  floor_hour(T) − 2 ชม. เวลาเดินถอยหลังจบที่ ceil_hour(T) + 2 ชม. interpolate ได้ใน [start + 5·STEP_S, stop − 5·STEP_S]
- cache รายดวงต่อช่วง key คือ tle_key (12 ตัวแรกของ sha256 ของ TLE 2 บรรทัด) อยู่ในหน่วยความจำและที่
  data/ephem/<start>_<stop>_<step>/<key>.f64 (float64 little-endian เรียง x y z vx vy vz ต่อ epoch)
- owner (module) ถือได้หลายช่วงพร้อมกัน (ช่วงปัจจุบัน + ช่วงถัดไปที่สั่งล่วงหน้า) แต่ละคู่ (owner, window) มีรายการดาวของตัวเอง
  ensure สั่ง GMAT หนึ่งงานเฉพาะดาวของคู่นั้นที่ยังไม่มีค่า ไม่ถูก GMAT ตัดทิ้ง และไม่มีงานไหนรออยู่หรือกำลังทำ
- คิวเดียว ทำทีละงาน งานที่ไม่มีคู่ไหนต้องการแล้วถูกตัดออกจากคิว หรือถูก os.killpg ถ้ากำลังรัน
- GMAT ล้มเหลวแล้วคู่นั้นเป็น failed และไม่ลองใหม่เองจนกว่าจะ retry หรือ owner ย้ายไปช่วงอื่น
- สถานะทั้งหมดอยู่ใต้ lock เดียว ไม่ถือ lock ระหว่างรัน GMAT (อ่าน cache จากดิสก์ใน ensure ทำใต้ lock ให้ ensure เป็นขั้นเดียว)
- block รายวันสำหรับ pass (spec §3.1 ของงานย่อย 2, ชื่อ การตัด และการต่อ block อยู่ที่ dayblocks.py) ใช้คิวเดียวกัน
  owner ถือคำขอเดียว (ดาว, วันแรก, วันสุดท้าย) ensure_days สั่งงานเดียวตั้งแต่วันแรกถึงวันสุดท้ายที่ขาดของทุกดาว
  งานของช่วง module มาก่อนงาน block เสมอ block ที่โหลดแล้วอยู่ในหน่วยความจำแบบ LRU ไม่เกิน DAY_LRU_BLOCKS
"""

import logging
import os
import shutil
import signal
import sys
import threading
import uuid
from array import array
from bisect import bisect_left
from collections import OrderedDict, deque
from collections.abc import Callable, Iterable, Iterator, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from functools import lru_cache, partial
from hashlib import sha256
from pathlib import Path

from gnss_predict.errors import GmatNotFoundError, GmatRunError, Message, ReportError
from gnss_predict.propagate import propagate
from gnss_predict.run_gmat import find_gmat_console
from gnss_predict.sp3 import lagrange_at

from .config import (DAY_KEEP_DAYS, DAY_LRU_BLOCKS, GMAT_TIMEOUT_S, REFRESH_MARGIN_H, STEP_S, WINDOW_BACK_H,
                     WINDOW_SPAN_H, Config)
from .dayblocks import (BLOCK_EPOCHS, DAY_DIR, day_dir, day_of_dir, day_range, day_window, split_days, stitch,
                        window_days)

Position = tuple[float, float, float]
Window = tuple[datetime, datetime]

EPHEM_DIR = "ephem"
WORK_DIR = "_work"
KEEP_DAYS = 7                                         # prune ลบช่วงที่ stop เก่ากว่านี้ และ work dir ที่เก่ากว่านี้
HALF_WINDOW = 5                                       # Lagrange 10 จุด ต้องมีจุดข้างละ 5
_MARGIN = timedelta(seconds=HALF_WINDOW * STEP_S)
_DIR_TIME = "%Y%m%dT%H%MZ"
_VALUES = 6                                           # x y z vx vy vz ต่อ epoch
_UTC = timezone.utc
_log = logging.getLogger(__name__)


# ---------------------------------------------------------------- ช่วงเวลา

def _floor_hour(t: datetime) -> datetime:
    return t.astimezone(_UTC).replace(minute=0, second=0, microsecond=0)


def window_for(t: datetime, direction: int) -> Window:
    """ช่วงที่ต้องใช้ที่เวลา T: direction ≥ 0 (เดินหน้าหรือหยุด) หรือ < 0 (ถอยหลัง)"""
    floor = _floor_hour(t)
    if direction >= 0:
        start = floor - timedelta(hours=WINDOW_BACK_H)
        return start, start + timedelta(hours=WINDOW_SPAN_H)
    ceil = floor if floor == t else floor + timedelta(hours=1)
    stop = ceil + timedelta(hours=WINDOW_BACK_H)
    return stop - timedelta(hours=WINDOW_SPAN_H), stop


def usable(w: Window, t: datetime) -> bool:
    """t อยู่ในช่วงที่ interpolate ได้ [start + 5·STEP_S, stop − 5·STEP_S] (รวมปลาย)"""
    return w[0] + _MARGIN <= t <= w[1] - _MARGIN


def needs_next(w: Window, t: datetime, direction: int) -> bool:
    """เหลือช่วงด้านที่เวลาเดินไปน้อยกว่า REFRESH_MARGIN_H: ถึงเวลาสั่งช่วงถัดไปจาก T"""
    margin = timedelta(hours=REFRESH_MARGIN_H)
    return t - w[0] < margin if direction < 0 else w[1] - t < margin


def _check_window(window: Window) -> Window:
    """คืนช่วงเป็น UTC ต้องเป็นนาทีเต็ม (ชื่อโฟลเดอร์ cache ละเอียดแค่นาที) ยาวเป็นบวกและหารด้วย STEP_S ลงตัว"""
    start, stop = window
    for t in (start, stop):
        if not isinstance(t, datetime) or t.utcoffset() is None:
            raise ValueError(f"ช่วงเวลาต้องเป็น datetime ที่มี timezone (ได้ {t!r})")
        if t.second or t.microsecond:
            raise ValueError(f"ขอบของช่วงเวลาต้องเป็นนาทีเต็ม (ได้ {t.isoformat()})")
    span_s = (stop - start).total_seconds()
    if span_s <= 0 or span_s % STEP_S:
        raise ValueError(f"ความยาวช่วง ({span_s:g} วินาที) ต้องเป็นบวกและหารด้วย {STEP_S} ลงตัว")
    return start.astimezone(_UTC), stop.astimezone(_UTC)


@lru_cache(maxsize=32)
def _times(start: datetime, stop: datetime) -> list[datetime]:
    """epoch ของช่วง start + k·STEP_S รวมทั้งสองปลาย ใช้ list เดียวร่วมกันทุกดวงของช่วง (ห้ามแก้)"""
    n = int((stop - start).total_seconds()) // STEP_S
    return [start + timedelta(seconds=k * STEP_S) for k in range(n + 1)]


def _dir_name(w: Window) -> str:
    return f"{w[0]:{_DIR_TIME}}_{w[1]:{_DIR_TIME}}_{STEP_S}"


def _parse_dir_name(name: str) -> Window | None:
    parts = name.split("_")
    if len(parts) != 3:
        return None
    try:
        return (datetime.strptime(parts[0], _DIR_TIME).replace(tzinfo=_UTC),
                datetime.strptime(parts[1], _DIR_TIME).replace(tzinfo=_UTC))
    except ValueError:
        return None


# ---------------------------------------------------------------- ดาวและค่าของดาว

@dataclass(frozen=True)
class SatSpec:
    """ดาวที่ต้องการค่า prn คือชื่อ object ใน GMAT (satdb.gmat_name) จึงเข้ากับ propagate.TleSatellite"""
    norad: int
    prn: str
    tle_lines: tuple[str, str]


def tle_key(tle_lines: tuple[str, str]) -> str:
    return sha256(f"{tle_lines[0]}\n{tle_lines[1]}".encode()).hexdigest()[:12]


class _Triples(Sequence):
    """ลำดับของ (x, y, z) หรือ (vx, vy, vz) ที่อ่านจาก array('d') แบบ x y z vx vy vz ต่อ epoch
    เก็บแค่ array ก้อนเดียว (ราว 92 KB ต่อดวงต่อช่วง) ไม่เก็บ tuple ของทุก epoch ไว้"""
    __slots__ = ("_a", "_off")

    def __init__(self, a: array, off: int):
        self._a, self._off = a, off

    def __len__(self) -> int:
        return len(self._a) // _VALUES

    def __getitem__(self, i):
        if isinstance(i, slice):
            return [self[j] for j in range(*i.indices(len(self)))]
        n = len(self)
        if i < 0:
            i += n
        if not 0 <= i < n:
            raise IndexError(i)
        j = _VALUES * i + self._off
        a = self._a
        return (a[j], a[j + 1], a[j + 2])


class _Series(Mapping):
    """dict[datetime, Position] ที่ lagrange_at ต้องการ หา index ใน times ที่เรียงแล้วด้วย bisect ไม่สร้าง dict ต่อดวง"""
    __slots__ = ("_times", "_values")

    def __init__(self, times: Sequence[datetime], values: Sequence[Position]):
        self._times, self._values = times, values

    def __getitem__(self, t: datetime) -> Position:
        i = bisect_left(self._times, t)
        if i < len(self._times) and self._times[i] == t:
            return self._values[i]
        raise KeyError(t)

    def __iter__(self) -> Iterator[datetime]:
        return iter(self._times)

    def __len__(self) -> int:
        return len(self._times)


@dataclass(eq=False)
class SatEphem:
    """ตำแหน่ง (กม.) และความเร็ว (กม./วินาที) ECEF ของดาวหนึ่งดวงที่แต่ละเวลาใน times (เรียงจากน้อยไปมาก)"""
    times: list[datetime] = field(repr=False)
    pos: Sequence[Position] = field(repr=False)
    vel: Sequence[Position] = field(repr=False)
    _pos: _Series = field(init=False, repr=False)
    _vel: _Series = field(init=False, repr=False)

    def __post_init__(self):
        self._pos = _Series(self.times, self.pos)
        self._vel = _Series(self.times, self.vel)

    def state_at(self, t: datetime) -> tuple[Position, Position] | None:
        """(ตำแหน่ง, ความเร็ว) ที่ t ด้วย Lagrange 10 จุดคนละชุด None ถ้า t อยู่นอกช่วงที่ใช้ได้"""
        if not self.times or not usable((self.times[0], self.times[-1]), t):
            return None
        p = lagrange_at(self._pos, t, HALF_WINDOW, times=self.times)
        v = lagrange_at(self._vel, t, HALF_WINDOW, times=self.times)
        return None if p is None or v is None else (p, v)


def _pack(pos: Sequence[Position], vel: Sequence[Position]) -> array:
    a = array("d")
    for p, v in zip(pos, vel):
        a.extend(p)
        a.extend(v)
    return a


def _from_array(times: list[datetime], a: array) -> SatEphem:
    return SatEphem(times, _Triples(a, 0), _Triples(a, 3))


def _file_bytes(epochs: int) -> int:
    return epochs * _VALUES * array("d").itemsize


def _has_file(path: Path, epochs: int) -> bool:
    """มีไฟล์ cache ที่ยาวตรงกับจำนวน epoch (ไฟล์ยาวผิดถือว่าไม่มี งานถัดไปเขียนทับ)"""
    try:
        return path.stat().st_size == _file_bytes(epochs)
    except OSError:
        return False


def _read_array(path: Path, epochs: int) -> array | None:
    """ไฟล์ที่ไม่มี อ่านไม่ได้ หรือยาวไม่ตรงกับจำนวน epoch ถือว่าไม่มี (งานถัดไปเขียนทับ)"""
    try:
        raw = path.read_bytes()
    except OSError:
        return None
    if len(raw) != _file_bytes(epochs):
        return None
    a = array("d")
    a.frombytes(raw)
    if sys.byteorder == "big":
        a.byteswap()
    return a


# ---------------------------------------------------------------- งานและตัวจัดการ

WINDOW, DAYS = "window", "days"                       # ชนิดงาน: ช่วงของ module หรือ block รายวัน
_PRIORITY = {WINDOW: 0, DAYS: 1}                      # เลขน้อยได้ทำก่อน: การติดตามดาวไม่ต้องรองาน pass

Item = tuple[date, str]                               # (วัน, tle_key) ของ block หนึ่ง


@dataclass(eq=False)
class _Job:
    id: str
    window: Window                                    # งาน DAYS: day_window(วันแรก, วันสุดท้าย)
    specs: dict[str, SatSpec]                         # tle_key -> ดาว (ตัดได้ระหว่างรอในคิว ไม่เปลี่ยนหลังเริ่มรัน)
    kind: str = WINDOW
    pgid: int | None = None                           # process group ของ GMAT ระหว่างที่ GMAT ยังรันอยู่
    cancelled: bool = False

    @property
    def priority(self) -> int:
        return _PRIORITY[self.kind]


def _new_job_id() -> str:
    return f"{datetime.now(_UTC):%Y%m%dT%H%M%SZ}-{uuid.uuid4().hex[:8]}"


def _items(keys: Iterable[str], first: date, last: date) -> set[Item]:
    days = day_range(first, last)
    return {(d, k) for k in keys for d in days}


def _job_items(job: _Job) -> set[Item]:
    return _items(job.specs, *window_days(job.window))


class _Cancelled(Exception):
    """งานถูกยกเลิกก่อน GMAT ได้ pgid: on_gmat_start raise อันนี้ให้ run_script ฆ่า GMAT ที่เพิ่งเริ่มทันที"""


def _kill(pgid: int) -> None:
    try:
        os.killpg(pgid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):     # จบไปแล้ว (macOS ตอบ EPERM เมื่อเหลือแต่ zombie)
        pass


def _failure(exc: Exception) -> Message:
    if isinstance(exc, GmatNotFoundError):
        return Message("GMAT_NOT_FOUND", "error", str(exc))
    if isinstance(exc, (GmatRunError, ReportError)):
        return Message("GMAT_FAILED", "error", str(exc))
    return Message("GMAT_FAILED", "error", f"คำนวณช่วงด้วย GMAT ไม่สำเร็จ: {exc}")


def _missing(prn: str) -> Message:
    return Message("SAT_MISSING_FROM_GMAT", "warning", f"GMAT ไม่ได้คืนตำแหน่งและความเร็วของดาว {prn}", prn)


class EphemManager:
    """ช่วงคำนวณของทุก module, cache รายดวง และคิว GMAT

    start_worker=True มี thread (daemon) เดียวทำงานในคิว ถ้า False ผู้เรียกใช้ drain() ทำคิวให้หมดใน thread ตัวเอง (ใช้ใน test)
    """

    def __init__(self, cfg: Config, propagate_fn: Callable = propagate,
                 find_console: Callable[[], Path] = find_gmat_console, start_worker: bool = True):
        self._root = Path(cfg.data_dir) / EPHEM_DIR
        self._work_root = self._root / WORK_DIR
        self._propagate = propagate_fn
        self._find_console = find_console
        self._lock = threading.Lock()
        self._wake = threading.Condition(self._lock)
        self._pairs: dict[tuple[str, Window], dict[str, SatSpec]] = {}
        self._latest: dict[str, Window] = {}          # owner -> ช่วงของ ensure ครั้งล่าสุด
        self._failed: dict[tuple[str, Window], Message] = {}
        self._mem: dict[Window, dict[str, SatEphem]] = {}         # มีเฉพาะช่วงที่บางคู่ใช้อยู่
        self._missing: dict[Window, dict[str, Message]] = {}      # ดาวที่ GMAT ตัดทิ้งในช่วงนั้น
        self._day_pairs: dict[str, tuple[dict[str, SatSpec], date, date]] = {}   # owner -> (ดาว, วันแรก, วันสุดท้าย)
        self._day_failed: dict[str, Message] = {}                 # owner -> ความล้มเหลวที่รอ retry_days
        self._day_mem: OrderedDict[Item, array] = OrderedDict()   # LRU ตัวที่ใช้ล่าสุดอยู่ท้าย
        self._day_missing: dict[Item, Message] = {}               # block ที่ GMAT ตัดดาวทิ้ง (มีเฉพาะที่คำขอยังต้องการ)
        self._queue: deque[_Job] = deque()
        self._running: _Job | None = None
        self._closed = False
        self._worker: threading.Thread | None = None
        if start_worker:
            self._worker = threading.Thread(target=self._work_loop, name="gpredict-web-gmat", daemon=True)
            self._worker.start()

    # ---- API

    def ensure(self, owner: str, sats: list[SatSpec], window: Window) -> None:
        """ตั้งรายการดาวของคู่ (owner, window) แล้วสั่ง GMAT เฉพาะดาวที่ยังไม่มีค่า
        คู่ที่ failed ไม่ลองใหม่เองถ้าชุดดาวเดิม (รอ Retry) แต่ถ้าชุดดาวต่างจากเดิม (Configure เพิ่ม/ลดดาว หรือ TLE ใหม่)
        ล้างความล้มเหลวของคู่นั้นแล้วสั่งดาวที่ยังไม่มีค่าใหม่"""
        w = _check_window(window)
        specs = {tle_key(s.tle_lines): s for s in sats}
        with self._lock:
            pair = (owner, w)
            if pair in self._failed and specs.keys() != self._pairs.get(pair, {}).keys():
                del self._failed[pair]
            self._pairs[(owner, w)] = specs
            self._latest[owner] = w
            self._mem.setdefault(w, {})
            self._reconcile_locked()
            self._request_locked((owner, w))

    def get(self, spec: SatSpec, window: Window) -> SatEphem | None:
        """ค่าของดาวในช่วงนั้นจากหน่วยความจำ ถ้าไม่มีอ่านจาก cache บนดิสก์ ถ้าไม่มีทั้งคู่คืน None"""
        w = _check_window(window)
        key = tle_key(spec.tle_lines)
        with self._lock:
            e = self._mem.get(w, {}).get(key)
        if e is not None:
            return e
        e = self._read(w, key)
        if e is not None:
            with self._lock:
                mem = self._mem.get(w)
                if mem is not None:                   # เก็บไว้เฉพาะช่วงที่มีคนใช้ (ปล่อยพร้อมช่วง)
                    e = mem.setdefault(key, e)
        return e

    def status(self, owner: str, window: Window | None = None) -> tuple[str, list[Message]]:
        """ok / computing / failed ของคู่ (owner, window) (None = ช่วงของ ensure ครั้งล่าสุดของ owner) พร้อมข้อความ"""
        w = None if window is None else _check_window(window)
        with self._lock:
            if w is None:
                w = self._latest.get(owner)
            specs = self._pairs.get((owner, w))
            if not specs:
                return "ok", []
            mem, missing = self._mem.get(w, {}), self._missing.get(w, {})
            warnings = [missing[k] for k in specs if k in missing]
            lacking = [k for k in specs if k not in mem and k not in missing]
            failure = self._failed.get((owner, w))
            if lacking and failure is not None:
                return "failed", [failure, *warnings]
            busy = self._busy_locked(w)
            if any(k in busy for k in lacking):
                return "computing", warnings
            return "ok", warnings

    def release(self, owner: str, window: Window | None = None) -> None:
        """ปล่อยคู่ (owner, window) (None = ทุกช่วงของ owner) งานที่ไม่มีใครต้องการแล้วถูกตัดออกจากคิวหรือถูก kill"""
        w = None if window is None else _check_window(window)
        with self._lock:
            for pair in [p for p in self._pairs if p[0] == owner and (w is None or p[1] == w)]:
                del self._pairs[pair]
                self._failed.pop(pair, None)
            if w is None:
                self._latest.pop(owner, None)
            self._reconcile_locked()

    def retry(self, owner: str) -> None:
        """สั่งคู่ที่ failed ของ owner ใหม่ (ปุ่ม Retry)"""
        with self._lock:
            for pair in [p for p in self._failed if p[0] == owner]:
                del self._failed[pair]
                self._request_locked(pair)

    # ---- block รายวัน (owner เช่น pass:<uuid4> หรือ sky:<module> ถือคำขอได้ทีละคำขอ)

    def ensure_days(self, owner: str, sats: list[SatSpec], first: date, last: date) -> None:
        """ตั้งคำขอของ owner แล้วสั่ง GMAT งานเดียวตั้งแต่วันแรกถึงวันสุดท้ายที่ขาดของทุกดาวในคำขอ
        (ดาว, วัน) ที่ขาดคือไม่มีทั้งในหน่วยความจำและบนดิสก์ ไม่ถูก GMAT ตัดทิ้ง และไม่มีงานไหนรออยู่หรือกำลังทำ
        owner ที่ failed ไม่ลองใหม่เองถ้าคำขอเดิม (รอ retry_days) คำขอที่ต่างจากเดิมล้างความล้มเหลวแล้วสั่งใหม่"""
        day_range(first, last)                        # ตรวจวันก่อนแตะสถานะ
        specs = {tle_key(s.tle_lines): s for s in sats}
        with self._lock:
            old = self._day_pairs.get(owner)                  # owner ที่ failed มีคำขออยู่เสมอ (release_days ลบทั้งคู่)
            if old is not None and (old[0].keys(), old[1], old[2]) != (specs.keys(), first, last):
                self._day_failed.pop(owner, None)
            self._day_pairs[owner] = (specs, first, last)
            self._reconcile_locked()
            self._request_days_locked(owner)

    def days_status(self, owner: str) -> tuple[str, list[Message]]:
        """ok / computing / failed ของคำขอของ owner พร้อมข้อความ (แบบเดียวกับ status)"""
        with self._lock:
            entry = self._day_pairs.get(owner)
            if entry is None:
                return "ok", []
            specs, first, last = entry
            days = day_range(first, last)
            warnings = []
            for key in specs:
                dropped = next((self._day_missing[(d, key)] for d in days if (d, key) in self._day_missing), None)
                if dropped is not None:
                    warnings.append(dropped)
            lacking = [(d, key) for key in specs for d in days if self._day_lacking_locked((d, key))]
            failure = self._day_failed.get(owner)
            if lacking and failure is not None:
                return "failed", [failure, *warnings]
            busy = self._busy_days_locked()
            if any(item in busy for item in lacking):
                return "computing", warnings
            return "ok", warnings

    def get_days(self, spec: SatSpec, first: date, last: date) -> SatEphem | None:
        """block ของดาวตั้งแต่วัน first ถึง last ต่อเป็นเส้นเดียว (หน่วยความจำก่อน ไม่มีอ่านจากดิสก์) None ถ้าขาด block ใด"""
        key = tle_key(spec.tle_lines)
        blocks = []
        for d in day_range(first, last):
            item = (d, key)
            with self._lock:
                block = self._day_mem.get(item)
                if block is not None:
                    self._day_mem.move_to_end(item)
            if block is None:
                block = _read_array(self._day_path(item), BLOCK_EPOCHS)
                if block is None:
                    return None
                with self._lock:
                    self._remember_locked(item, block)
            blocks.append(block)
        return stitch(first, blocks)

    def release_days(self, owner: str) -> None:
        """ปล่อยคำขอของ owner (ปิดหน้าต่างหรือกด Cancel) งานที่ไม่มีคำขอไหนต้องการแล้วถูกตัดออกจากคิวหรือถูก kill"""
        with self._lock:
            self._day_pairs.pop(owner, None)
            self._day_failed.pop(owner, None)
            self._reconcile_locked()

    def retry_days(self, owner: str) -> None:
        """สั่งคำขอที่ failed ของ owner ใหม่ (ปุ่ม Retry ในกล่องรอ)"""
        with self._lock:
            if self._day_failed.pop(owner, None) is not None:
                self._request_days_locked(owner)

    # ---- ดูแลดิสก์

    def prune(self, now: datetime) -> None:
        """ลบโฟลเดอร์ช่วงที่ stop เก่ากว่า now − 7 วัน (ยกเว้นช่วงที่ใช้อยู่) work dir ที่แก้ไขล่าสุดเก่ากว่า 7 วัน
        และโฟลเดอร์ day/<YYYYMMDD> ของวันที่เก่ากว่าวันของ now − DAY_KEEP_DAYS วัน (ยกเว้นวันที่คำขอยังใช้อยู่)"""
        cutoff = now - timedelta(days=KEEP_DAYS)
        day_cutoff = (now - timedelta(days=DAY_KEEP_DAYS)).astimezone(_UTC).date()
        with self._lock:
            in_use = set(self._mem)
            days_in_use = {d for _, first, last in self._day_pairs.values() for d in day_range(first, last)}
            running = self._running.id if self._running is not None else None
        if not self._root.is_dir():
            return
        for d in self._root.iterdir():
            if not d.is_dir():
                continue
            if d.name == DAY_DIR:
                for dd in d.iterdir():
                    day = day_of_dir(dd.name)
                    if dd.is_dir() and day is not None and day < day_cutoff and day not in days_in_use:
                        shutil.rmtree(dd, ignore_errors=True)
                continue
            if d.name == WORK_DIR:
                for wd in d.iterdir():
                    try:
                        old = wd.is_dir() and wd.name != running and wd.stat().st_mtime < cutoff.timestamp()
                    except OSError:
                        continue
                    if old:
                        shutil.rmtree(wd, ignore_errors=True)
                continue
            w = _parse_dir_name(d.name)
            if w is not None and w[1] < cutoff and w not in in_use:
                shutil.rmtree(d, ignore_errors=True)

    def drain(self) -> None:
        """ทำงานในคิวให้หมดใน thread ที่เรียก ใช้ได้เฉพาะ start_worker=False (คิวมีผู้รันได้คนเดียว: _running มีช่องเดียว)"""
        if self._worker is not None:
            raise RuntimeError("drain() ใช้ไม่ได้เมื่อมี worker thread ของคิว GMAT (start_worker=True)")
        while True:
            with self._lock:
                job = self._take_locked()
            if job is None:
                return
            self._run(job)

    def close(self) -> None:
        """หยุด worker ทิ้งคิว และ kill GMAT ที่กำลังรัน (GMAT อยู่ใน session ของตัวเอง ไม่จบตาม server)"""
        with self._lock:
            self._closed = True
            self._queue.clear()
            if self._running is not None and not self._running.cancelled:
                self._cancel_running_locked()
            self._wake.notify_all()

    # ---- สถานะ (ทุกเมธอด *_locked เรียกขณะถือ lock)

    def _live_jobs_locked(self, kind: str) -> Iterator[_Job]:
        """งานชนิดนั้นที่ยังไม่ถูกยกเลิกซึ่งรออยู่ในคิวหรือกำลังรัน"""
        for job in (*self._queue, self._running):
            if job is not None and job.kind == kind and not job.cancelled:
                yield job

    def _busy_locked(self, w: Window) -> set[str]:
        """key ที่มีงานที่ยังไม่ถูกยกเลิกรออยู่ในคิวหรือกำลังรันสำหรับช่วง w"""
        keys: set[str] = set()
        for job in self._live_jobs_locked(WINDOW):
            if job.window == w:
                keys.update(job.specs)
        return keys

    def _busy_days_locked(self) -> set[Item]:
        """(วัน, key) ที่งาน block ที่ยังไม่ถูกยกเลิกจะคำนวณให้"""
        items: set[Item] = set()
        for job in self._live_jobs_locked(DAYS):
            items |= _job_items(job)
        return items

    def _day_lacking_locked(self, item: Item) -> bool:
        """block ที่ไม่มีทั้งในหน่วยความจำและบนดิสก์ และ GMAT ไม่ได้ตัดดาวทิ้ง"""
        return (item not in self._day_mem and item not in self._day_missing
                and not _has_file(self._day_path(item), BLOCK_EPOCHS))

    def _remember_locked(self, item: Item, block: array) -> None:
        """เก็บ block เป็นตัวใช้ล่าสุด แล้วตัดตัวที่ใช้นานที่สุดจนเหลือไม่เกิน DAY_LRU_BLOCKS"""
        self._day_mem[item] = block
        self._day_mem.move_to_end(item)
        while len(self._day_mem) > DAY_LRU_BLOCKS:
            self._day_mem.popitem(last=False)

    def _request_days_locked(self, owner: str) -> None:
        """ดาวที่มีวันขาดเข้างานเดียว ช่วงตั้งแต่วันแรกถึงวันสุดท้ายที่ขาด (วันที่มีแล้วที่คั่นอยู่ถูกคำนวณซ้ำไปด้วย)"""
        entry = self._day_pairs.get(owner)
        if entry is None or owner in self._day_failed:
            return
        specs, first, last = entry
        days, busy = day_range(first, last), self._busy_days_locked()
        need: dict[str, SatSpec] = {}
        lacking: list[date] = []
        for key, s in specs.items():
            for d in days:
                if (d, key) not in busy and self._day_lacking_locked((d, key)):
                    need[key] = s
                    lacking.append(d)
        if need:
            self._queue.append(_Job(_new_job_id(), day_window(min(lacking), max(lacking)), need, DAYS))
            self._wake.notify()

    def _request_locked(self, pair: tuple[str, Window]) -> None:
        """โหลด cache บนดิสก์ของดาวที่ยังไม่มีค่า ที่เหลือสั่ง GMAT เป็นงานเดียว"""
        specs = self._pairs.get(pair)
        if specs is None or pair in self._failed:
            return
        w = pair[1]
        mem, missing, busy = self._mem[w], self._missing.get(w, {}), self._busy_locked(w)
        need: dict[str, SatSpec] = {}
        for key, s in specs.items():
            if key in mem or key in missing or key in busy:
                continue
            e = self._read(w, key)
            if e is not None:
                mem[key] = e
            else:
                need[key] = s
        if need:
            self._queue.append(_Job(_new_job_id(), w, need))
            self._wake.notify()

    def _reconcile_locked(self) -> None:
        """ตัดดาวที่ไม่มีคู่หรือคำขอไหนต้องการออกจากงานในคิว (งานว่างถูกทิ้ง) kill งานที่รันอยู่ถ้าไม่มีดาวไหนที่ยังต้องการ
        และปล่อยหน่วยความจำของช่วงที่ไม่มีคู่ไหนใช้ (block รายวันอยู่ใน LRU ต่อ ไม่ผูกกับคำขอ)"""
        needed: dict[Window, set[str]] = {}
        for (_, w), specs in self._pairs.items():
            needed.setdefault(w, set()).update(specs)
        day_needed: set[Item] = set()
        for specs, first, last in self._day_pairs.values():
            day_needed |= _items(specs, first, last)

        def wanted(job: _Job) -> set[str]:
            if job.kind == DAYS:
                return {k for _, k in _job_items(job) & day_needed}
            return needed.get(job.window, set())

        for job in self._queue:
            keep = wanted(job)
            job.specs = {k: s for k, s in job.specs.items() if k in keep}
        self._queue = deque(job for job in self._queue if job.specs)
        job = self._running
        if job is not None and not job.cancelled and wanted(job).isdisjoint(job.specs):
            self._cancel_running_locked()
        for w in [w for w in self._mem if w not in needed]:
            del self._mem[w]
            self._missing.pop(w, None)
        for pair in [p for p in self._failed if p not in self._pairs]:
            del self._failed[pair]
        for item in [i for i in self._day_missing if i not in day_needed]:
            del self._day_missing[item]

    def _cancel_running_locked(self) -> None:
        job = self._running
        job.cancelled = True
        if job.pgid is not None:
            _kill(job.pgid)

    def _take_locked(self) -> _Job | None:
        """งานที่ priority น้อยสุด (งานของช่วง module ก่อนงาน block) ระดับเดียวกันตามลำดับเข้าคิว"""
        if self._closed or not self._queue:
            return None
        job = min(self._queue, key=lambda j: j.priority)      # min คืนตัวแรกในบรรดาตัวที่น้อยสุด
        self._queue.remove(job)
        self._running = job
        return job

    # ---- worker

    def _work_loop(self) -> None:
        while True:
            with self._lock:
                while not self._closed and not self._queue:
                    self._wake.wait()
                job = self._take_locked()
            if job is None:
                return
            self._run(job)

    def _gmat_started(self, job: _Job, pgid: int) -> None:
        with self._lock:
            job.pgid = pgid
            if job.cancelled:
                raise _Cancelled("งานถูกยกเลิกก่อน GMAT เริ่ม")

    def _run(self, job: _Job) -> None:
        """ทำงานหนึ่งงาน (เรียกหลัง _take_locked) ไม่ว่าสำเร็จหรือล้มเหลว _running ถูกล้างเสมอ worker จึงไม่ตาย"""
        work = self._work_root / job.id
        try:
            packed, missing = self._compute(job, work)
            blocks = self._save(job, packed)
        except Exception as exc:
            if not isinstance(exc, (GmatNotFoundError, GmatRunError, ReportError, _Cancelled)):
                _log.exception("งาน GMAT %s ล้มเหลว", job.id)
            with self._lock:
                self._running = None
                cancelled = job.cancelled
                if not cancelled:
                    self._fail_locked(job, _failure(exc))
            if cancelled:
                shutil.rmtree(work, ignore_errors=True)       # เก็บ work dir ไว้ดูสาเหตุเฉพาะงานที่ล้มเหลวจริง
            return
        with self._lock:
            self._running = None
            if job.kind == DAYS:                      # block อยู่ใน LRU แม้คำขอถูกปล่อยระหว่างรัน (มีขอบเขตอยู่แล้ว)
                for item, block in blocks.items():
                    self._remember_locked(item, block)
                days = day_range(*window_days(job.window))
                for key, message in missing.items():
                    self._day_missing.update(((d, key), message) for d in days)
            else:
                mem = self._mem.get(job.window)
                if mem is not None:                   # ช่วงที่ไม่มีใครใช้แล้ว (ยกเลิกระหว่างรัน) เก็บแค่บนดิสก์
                    times = _times(*job.window)
                    mem.update((k, _from_array(times, a)) for k, a in packed.items())
                    self._missing.setdefault(job.window, {}).update(missing)
        shutil.rmtree(work, ignore_errors=True)

    def _fail_locked(self, job: _Job, failure: Message) -> None:
        """คู่หรือคำขอที่ต้องการดาวของงานที่ล้มเหลวเป็น failed"""
        if job.kind == DAYS:
            items = _job_items(job)
            for owner, (specs, first, last) in self._day_pairs.items():
                if not items.isdisjoint(_items(specs, first, last)):
                    self._day_failed[owner] = failure
            return
        for pair, specs in self._pairs.items():
            if pair[1] == job.window and not specs.keys().isdisjoint(job.specs):
                self._failed[pair] = failure

    def _save(self, job: _Job, packed: dict[str, array]) -> dict[Item, array]:
        """เขียนค่าลงดิสก์โดยไม่ถือ lock งาน block ตัดเป็นรายวันก่อนแล้วคืน block ที่เขียน (งานของช่วงคืน {})"""
        if job.kind != DAYS:
            for key, a in packed.items():
                self._write(self._path(job.window, key), a)
            return {}
        first, last = window_days(job.window)
        blocks = {(d, key): b for key, a in packed.items() for d, b in split_days(first, last, a).items()}
        for item, b in blocks.items():
            self._write(self._day_path(item), b)
        return blocks

    def _compute(self, job: _Job, work: Path) -> tuple[dict[str, array], dict[str, Message]]:
        """หา GmatConsole แล้วรัน GMAT โดยไม่ถือ lock คืน (array ของทั้งงานต่อ key, ดาวที่ GMAT ตัดทิ้ง)"""
        start, stop = job.window
        console = self._find_console()
        with self._lock:
            if job.cancelled:
                raise _Cancelled("งานถูกยกเลิกก่อนเรียก GMAT")
        try:
            eph, messages = self._propagate(list(job.specs.values()), start, stop, STEP_S, work, console,
                                            timeout_s=GMAT_TIMEOUT_S, on_gmat_start=partial(self._gmat_started, job),
                                            with_velocity=True)
        finally:
            with self._lock:
                job.pgid = None                       # GMAT จบแล้ว pgid อาจถูกใช้ซ้ำ ห้าม kill อีก
        times = _times(start, stop)
        dropped = {m.object: m for m in messages if m.code == "SAT_MISSING_FROM_GMAT"}
        velocities = eph.velocities_kms or {}
        packed: dict[str, array] = {}
        missing: dict[str, Message] = {}
        for key, s in job.specs.items():
            pos, vel = eph.positions_km.get(s.prn), velocities.get(s.prn)
            if pos is None or vel is None or len(pos) != len(times) or len(vel) != len(times):
                missing[key] = dropped.get(s.prn) or _missing(s.prn)
            else:
                packed[key] = _pack(pos, vel)
        return packed, missing

    # ---- ดิสก์

    def _path(self, w: Window, key: str) -> Path:
        return self._root / _dir_name(w) / f"{key}.f64"

    def _day_path(self, item: Item) -> Path:
        d, key = item
        return day_dir(self._root, d) / f"{key}.f64"

    def _read(self, w: Window, key: str) -> SatEphem | None:
        times = _times(*w)
        a = _read_array(self._path(w, key), len(times))
        return None if a is None else _from_array(times, a)

    def _write(self, path: Path, a: array) -> None:
        """เขียนลงไฟล์ชั่วคราวในโฟลเดอร์เดียวกันแล้ว os.replace เขียนไม่ได้แค่บันทึก log (ค่ายังอยู่ในหน่วยความจำ)"""
        if sys.byteorder == "big":
            a = array("d", a)
            a.byteswap()
        tmp = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            with open(tmp, "xb") as f:
                a.tofile(f)
            os.replace(tmp, path)
        except OSError as exc:
            tmp.unlink(missing_ok=True)
            _log.warning("เขียน cache %s ไม่ได้: %s", path, exc)
