"""คิว job เดียว ทำทีละตัวตามลำดับ (หัวข้อ 7 ของ spec server; ข้อ P2 และ P3)

- บันทึก job อยู่ที่ `<data>/jobs/<id>.json` (id = `j-<YYYYMMDDTHHMMSS>-<hex 4 ตัว>`) ทุกการเปลี่ยนสถานะเขียนแบบ atomic
  (ไฟล์ชั่วคราว + os.replace) และส่ง event `job` `{id, kind, scenario, state, progress, error?}` (error เฉพาะเมื่อมี)
  progress ส่งไม่เกิน 4 ครั้งต่อวินาทีต่อ job ยกเว้นเปลี่ยนขั้น (stage) หรือเปลี่ยนสถานะซึ่งส่งเสมอ
- สถานะ: queued -> running -> succeeded | failed | cancelled (queued -> cancelled ได้โดยไม่เคยเริ่ม)
- thread ของคิวหนึ่งตัวหยิบ job ส่งให้ runner (`start(job, data_dir) -> Handle`) แล้วอ่าน `Handle.messages()` จนจบ
  `ProcessRunner` รัน `worker.run_job` ใน process ลูกแบบ spawn ส่งผลกลับทางท่อทางเดียว (`Pipe(duplex=False)`) ที่ process แม่
  ไม่ถือปลายเขียน: process ลูกตายกลางข้อความ = EOF ไม่ใช่รอค้าง ส่วน `InlineRunner` เรียกใน thread ของคิวเลย (ใช้ใน test)
- ยกเลิกขณะรัน: ตั้ง cancel_requested -> SIGKILL กลุ่ม process ของ GMAT ถ้ารู้ pgid -> `Handle.terminate()`
  (SIGTERM แล้ว SIGKILL หลัง 1 วินาที) -> pgid ที่ process ลูกส่งมาช้ากว่านั้นถูก SIGKILL ทันทีที่อ่านได้ job จบเป็น cancelled เสมอ
- pgid ที่ล้าสมัยอันตราย (GMAT จบแล้ว pid ถูกใช้ซ้ำได้): process ลูกส่ง pgid เป็น None ทันทีที่ GMAT ไม่ได้ทำงาน
  และ `kill_group` ไม่แตะ pgid <= 1 หรือกลุ่มของ server เอง
- เปิด server (`start`): `recover` เปลี่ยน queued/running ที่ค้างบนดิสก์เป็น failed `INTERRUPTED` แล้ว `prune` ลบบันทึกที่จบเกิน 30 วัน
  (ตัวตั้งเวลาของงานประจำวันเรียก `prune` ซ้ำวันละครั้ง server ที่เปิดค้างไว้นานจึงไม่สะสมบันทึกเก่า)
  ปิด server (`stop`): ฆ่างานที่รันอยู่ งานนั้นและงานที่ยังรอเป็น failed `INTERRUPTED`
"""

import copy
import json
import logging
import multiprocessing
import os
import secrets
import threading
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from multiprocessing.connection import wait as wait_ready
from pathlib import Path

from gnss_predict.config import GNSS_GROUPS
from gnss_predict.imaging import IMAGING_LETTER

from .errors import ApiError
from .events import EventBus, message as post_message
from .schema import NAME_RE, check_day
from .store import ScenarioStore
from .worker import PipeOut, kill_group, run_job

KINDS = ("fetch", "propagate", "analyze", "validate", "daily")
SCENARIO_KINDS = ("propagate", "analyze", "validate")
ORIGINS = ("user", "scheduler")
STATES = ("queued", "running", "succeeded", "failed", "cancelled")
ACTIVE = ("queued", "running")
FINISHED = ("succeeded", "failed", "cancelled")
TERMINAL = ("result", "error")
GNSS_LETTERS = "".join(GNSS_GROUPS)
SYSTEM_LETTERS = GNSS_LETTERS + IMAGING_LETTER    # X = กลุ่มดาวถ่ายภาพ (weather, science, visual) ใช้ได้เมื่อมี GNSS อย่างน้อยหนึ่งตัว
# params ของแต่ละ kind: ชื่อ -> บังคับหรือไม่ (daily: for_date คือวัน D ที่พยากรณ์ YYYY-MM-DD)
PARAMS = {
    "propagate": {},
    "analyze": {"facility": True},
    "validate": {"day": True, "sp3": False, "facility": False},
    "fetch": {"systems": False},
    "daily": {"for_date": True},
}
RECORD_FIELDS = ("id", "kind", "scenario", "params", "state", "progress", "messages", "result", "error",
                 "created_utc", "started_utc", "finished_utc", "origin", "gmat_pgid")

JOBS_DIR = "jobs"
RETENTION = timedelta(days=30)
PROGRESS_MIN_INTERVAL_S = 0.25           # ไม่เกิน 4 event ต่อวินาทีต่อ job
POLL_S = 0.1                             # คาบที่ thread ของคิวตรวจว่า process ลูกยังอยู่ (ยกเลิกได้ไว)
DRAIN_S = 0.05                           # รอข้อความที่ค้างในท่อหลัง process ลูกจบ
TERM_GRACE_S = 1.0                       # SIGTERM แล้วรอเท่านี้ก่อน SIGKILL
JOIN_S = 5.0
CANCEL_WAIT_S = 5.0                      # cancel() รอให้ thread ของคิวปิดบันทึกเป็น cancelled
STOP_JOIN_S = 10.0
THREAD_NAME = "gnss-studio-jobs"
INTERRUPTED_TEXT = "งานถูกขัดจังหวะเพราะ server ปิดก่อนทำเสร็จ"
CRASH_TEXT = "process ที่ทำ job หยุดทำงานกะทันหันโดยไม่ส่งผลลัพธ์ ดูรายละเอียดใน data/logs/server.log"


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def iso_ms(t: datetime) -> str:
    """เวลา UTC ISO 8601 ถึงมิลลิวินาที ลงท้าย Z"""
    t = t.astimezone(timezone.utc)
    return f"{t:%Y-%m-%dT%H:%M:%S}.{t.microsecond // 1000:03d}Z"


def _parse_time(text) -> datetime | None:
    if not isinstance(text, str):
        return None
    try:
        t = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    return t if t.tzinfo is not None else t.replace(tzinfo=timezone.utc)


def _invalid(field_name: str, text: str) -> ApiError:
    return ApiError(422, "SCENARIO_INVALID", text, field_name)


def _error(code: str, text: str, detail: str | None = None) -> dict:
    return {"code": code, "text": text, "detail": detail}


# ---------- บันทึก job ----------

@dataclass
class JobRecord:
    id: str
    kind: str
    scenario: str | None
    params: dict
    state: str = "queued"
    progress: dict | None = None                 # {"stage", "fraction"} ล่าสุด
    messages: list = field(default_factory=list)
    result: dict | None = None
    error: dict | None = None                    # {code, text, detail}
    created_utc: str = ""
    started_utc: str | None = None
    finished_utc: str | None = None
    origin: str = "user"
    gmat_pgid: int | None = None                 # กลุ่ม process ของ GMAT ที่กำลังทำงาน (None = ไม่มี)
    cancel_requested: bool = False               # ภายใน: ไม่อยู่ใน to_dict และไฟล์

    def to_dict(self) -> dict:
        """บันทึกตามหัวข้อ 7.1 ของ spec เพิ่ม gmat_pgid (สำเนา แก้ได้ไม่กระทบตัวบันทึก)"""
        return {name: copy.deepcopy(getattr(self, name)) for name in RECORD_FIELDS}

    @classmethod
    def from_dict(cls, data) -> "JobRecord":
        """จากไฟล์บันทึก ช่องที่ขาด (id, kind, state, created_utc) หรือผิดชนิด -> ValueError (recover ข้ามบันทึกนั้น)"""
        if not isinstance(data, dict):
            raise ValueError("บันทึก job ต้องเป็น JSON object")
        for name, ok in _RECORD_TYPES.items():
            if name not in data:
                if name in _RECORD_REQUIRED:
                    raise ValueError(f"บันทึก job ไม่มีช่อง {name}")
            elif not ok(data[name]):
                raise ValueError(f"ช่อง {name} ของบันทึก job ผิดชนิด ({type(data[name]).__name__})")
        values = {name: data[name] for name in RECORD_FIELDS if name in data}
        values.setdefault("scenario", None)
        values.setdefault("params", {})
        return cls(**values)


_Records = list[JobRecord]                       # ใช้แทน list[...] ในคลาสที่มี method ชื่อ list
_RECORD_REQUIRED = ("id", "kind", "state", "created_utc")


def _opt(kind: type):
    return lambda v: v is None or isinstance(v, kind)


_RECORD_TYPES = {
    "id": lambda v: isinstance(v, str), "kind": lambda v: v in KINDS, "state": lambda v: v in STATES,
    "created_utc": lambda v: isinstance(v, str), "origin": lambda v: v in ORIGINS,
    "scenario": _opt(str), "started_utc": _opt(str), "finished_utc": _opt(str),
    "params": lambda v: isinstance(v, dict), "messages": lambda v: isinstance(v, list),
    "progress": _opt(dict), "result": _opt(dict), "error": _opt(dict),
    "gmat_pgid": lambda v: v is None or (isinstance(v, int) and not isinstance(v, bool)),
}


def _written_scenario(rec: JobRecord) -> str | None:
    """scenario ที่ job นี้อ่านหรือเขียน: ช่อง scenario หรือของ job daily คือ `daily_<YYYYMMDD>` (ชื่อเดียวกับ daily.scenario_name)"""
    if rec.scenario is not None:
        return rec.scenario
    for_date = rec.params.get("for_date") if rec.kind == "daily" else None
    return f"daily_{for_date.replace('-', '')}" if isinstance(for_date, str) else None


def _event(rec: JobRecord) -> dict:
    data = {"id": rec.id, "kind": rec.kind, "scenario": rec.scenario, "state": rec.state,
            "progress": copy.deepcopy(rec.progress)}
    if rec.error is not None:
        data["error"] = dict(rec.error)
    return data


# ---------- runner ----------

class _Collect(list):
    """คิวของ InlineRunner: run_job เรียกแค่ put"""
    put = list.append


class InlineHandle:
    def __init__(self, items: list):
        self._items = items

    def messages(self):
        yield from self._items

    def terminate(self) -> None:
        """งานทำเสร็จไปแล้วตอน start ไม่มีอะไรให้ยุติ"""


class InlineRunner:
    """เรียก run_job ใน thread ของคิวเลย (ไม่สร้าง process) ผลทั้งหมดอ่านได้หลังงานจบ ยกเลิกกลางทางไม่ได้"""

    def __init__(self, gmat_bin: str | None = None):
        self.gmat_bin = gmat_bin

    def start(self, job: JobRecord, data_dir: Path) -> InlineHandle:
        out = _Collect()
        run_job(job.kind, job.scenario, copy.deepcopy(job.params), str(data_dir), self.gmat_bin, out)
        return InlineHandle(out)


class ProcessHandle:
    """process ลูกหนึ่งตัวกับปลายอ่านของท่อ เรียก terminate() ได้จากทุก thread (การ join/reap อยู่ใต้ล็อกเดียว)"""

    def __init__(self, proc, reader):
        self._proc, self._reader = proc, reader
        self._lock = threading.Lock()
        self._eof = False

    def _exited(self) -> bool:
        return bool(wait_ready([self._proc.sentinel], 0))

    def _get(self, timeout: float):
        """ข้อความถัดไป หรือ None ถ้าหมดเวลา

        ท่อปิด (process ลูกจบ หรือตายกลางข้อความ: กรอบที่ขาดกลางได้ EOF เพราะ process แม่ไม่ถือปลายเขียน) = เลิกอ่าน
        แล้วแค่รอ process จบ ข้อความที่แปลงกลับไม่ได้ถูกข้าม (กรอบถัดไปยังอ่านได้)"""
        if self._eof:
            wait_ready([self._proc.sentinel], timeout)
            return None
        try:
            if not self._reader.poll(timeout):
                return None
            return self._reader.recv()
        except (EOFError, OSError):
            self._eof = True
            return None
        except Exception:
            return None

    def _reap(self, timeout: float) -> int | None:
        with self._lock:
            self._proc.join(timeout)
            return self._proc.exitcode

    def messages(self):
        """ข้อความจาก process ลูกตามลำดับ ส่ง None ทุก POLL_S วินาทีที่เงียบ (ให้ผู้อ่านตรวจการยกเลิก)

        จบหลังข้อความ result/error หรือเมื่อ process ลูกจบโดยไม่ส่งข้อความเหล่านั้น (ส่ง error INTERNAL พร้อม exit code แทน)"""
        try:
            while True:
                msg = self._get(POLL_S)
                if msg is not None:
                    yield msg
                    if msg[0] in TERMINAL:
                        if self._reap(JOIN_S) is None:          # ส่งผลแล้วแต่ไม่ยอมจบ
                            self.terminate()
                        return
                    continue
                if not self._exited():
                    yield None
                    continue
                while (msg := self._get(DRAIN_S)) is not None:  # ข้อความที่ส่งก่อนจบยังอยู่ในท่อ
                    yield msg
                    if msg[0] in TERMINAL:
                        self._reap(JOIN_S)
                        return
                yield ("error", _error("INTERNAL", CRASH_TEXT, f"exit code {self._reap(JOIN_S)}"))
                return
        finally:
            self._reader.close()

    def terminate(self) -> None:
        """SIGTERM แล้วรอ TERM_GRACE_S วินาที ยังไม่จบ SIGKILL (เรียกซ้ำหรือเรียกหลัง process จบแล้วได้)"""
        with self._lock:
            if self._proc.exitcode is not None:
                return
            self._proc.terminate()
            self._proc.join(TERM_GRACE_S)
            if self._proc.exitcode is None:
                self._proc.kill()
                self._proc.join(JOIN_S)


class ProcessRunner:
    """รัน job ใน process ลูก (multiprocessing แบบ spawn: ไม่สืบทอด thread/ล็อกของ server) ส่ง gmat_bin ให้ลูกทาง argument

    target: ฟังก์ชันที่ process ลูกเรียก (ตั้งต้น worker.run_job) ต้อง import ได้ใน process ลูก"""

    def __init__(self, gmat_bin: str | None = None, target=None):
        self.gmat_bin = gmat_bin
        self.target = target if target is not None else run_job

    def start(self, job: JobRecord, data_dir: Path) -> ProcessHandle:
        ctx = multiprocessing.get_context("spawn")
        reader, writer = ctx.Pipe(duplex=False)
        proc = ctx.Process(target=self.target, name=f"gnss-studio-job-{job.id}", daemon=True,
                           args=(job.kind, job.scenario, copy.deepcopy(job.params), str(data_dir), self.gmat_bin,
                                 PipeOut(writer)))
        try:
            proc.start()
        except BaseException:
            reader.close()
            raise
        finally:
            writer.close()              # process ลูกได้สำเนาของตัวเองแล้ว แม่ต้องไม่ถือไว้ (ไม่งั้นกรอบที่ขาดกลางไม่เจอ EOF)
        return ProcessHandle(proc, reader)


# ---------- คิว ----------

class JobManager:
    def __init__(self, data_dir: Path, bus: EventBus, runner=None, clock=utcnow, logger: logging.Logger | None = None):
        self.data_dir = Path(data_dir)
        self.jobs_dir = self.data_dir / JOBS_DIR
        self.bus = bus
        self.runner = runner if runner is not None else ProcessRunner()
        self.clock = clock
        self.logger = logger or logging.getLogger("gnss_studio_server.jobs")
        self._store = ScenarioStore(self.data_dir)
        self._cond = threading.Condition()               # ครอบทุกช่องข้างล่างและทุกบันทึก
        self._jobs: dict[str, JobRecord] = {}            # ตามลำดับที่สร้าง (บันทึกเก่าจากดิสก์มาก่อน)
        self._queue: deque[str] = deque()
        self._current: JobRecord | None = None
        self._handle = None
        self._stop_kill = False                          # stop() ฆ่างานที่กำลังรัน
        self._stopping = False
        self._thread: threading.Thread | None = None
        self._last_progress: dict[str, tuple[str, float]] = {}

    # ---------- อ่าน ----------

    def _require(self, job_id: str) -> JobRecord:
        rec = self._jobs.get(job_id)
        if rec is None:
            raise ApiError(404, "NOT_FOUND", f"ไม่พบ job {job_id}")
        return rec

    def get(self, job_id: str) -> JobRecord:
        """สำเนาของบันทึก ไม่มี -> ApiError 404"""
        with self._cond:
            return copy.deepcopy(self._require(job_id))

    def list(self, state: str | None = None) -> _Records:
        """สำเนาของบันทึกทั้งหมด (หรือเฉพาะสถานะนั้น) ใหม่ก่อน"""
        if state is not None and state not in STATES:
            raise _invalid("state", f"สถานะ job ต้องเป็นหนึ่งใน {', '.join(STATES)}")
        with self._cond:
            recs = [copy.deepcopy(r) for r in self._jobs.values() if state is None or r.state == state]
        return recs[::-1]

    def active_for(self, scenario: str) -> bool:
        """มี job ของ scenario นี้ที่ยังรอหรือกำลังรัน (ชื่อไม่แยกตัวพิมพ์เหมือน store) job daily ไม่มีช่อง scenario
        แต่สร้างและเขียน `daily_<YYYYMMDD ของ for_date>` จึงนับเป็น job ของ scenario นั้น"""
        key = scenario.casefold()
        with self._cond:
            return any(r.state in ACTIVE and (_written_scenario(r) or "").casefold() == key for r in self._jobs.values())

    def wait(self, job_id: str, timeout: float | None = None) -> JobRecord:
        """รอจน job จบหรือหมดเวลา แล้วคืนสำเนา"""
        with self._cond:
            rec = self._require(job_id)
            self._cond.wait_for(lambda: rec.state in FINISHED, timeout)
            return copy.deepcopy(rec)

    # ---------- ส่งงาน ----------

    def _check_scenario(self, kind: str, scenario) -> None:
        if kind in SCENARIO_KINDS:
            if not isinstance(scenario, str) or not NAME_RE.fullmatch(scenario):
                raise _invalid("scenario", "ชื่อ scenario ต้องเป็นตัวอักษร A-Z a-z ตัวเลข _ หรือ - ยาว 1 ถึง 32 ตัว")
        elif scenario is not None:
            raise _invalid("scenario", f"job {kind} ไม่ใช้ scenario")

    def _check_value(self, name: str, value):
        if name == "facility":
            if not isinstance(value, str) or not NAME_RE.fullmatch(value):
                raise _invalid(name, "ชื่อ Facility ต้องเป็นตัวอักษร A-Z a-z ตัวเลข _ หรือ - ยาว 1 ถึง 32 ตัว")
            return value
        if name in ("day", "for_date"):
            return check_day(value, name)
        if name == "sp3":
            root = self.data_dir.resolve()
            try:
                target = (self.data_dir / value).resolve() if isinstance(value, str) and value else None
            except (OSError, ValueError):
                target = None
            if target is None or target == root or not target.is_relative_to(root):
                raise _invalid(name, "ไฟล์ SP3 ต้องเป็น path ของไฟล์ใต้ data/")
            return value
        if name == "systems":
            # กติกาเดียวกับ engine (studio._system_letters): snapshot ที่ไม่มี OMM ของ GNSS ใช้ propagate ไม่ได้
            letters = value.upper() if isinstance(value, str) else ""
            if not set(letters) & set(GNSS_LETTERS) or set(letters) - set(SYSTEM_LETTERS):
                raise _invalid(name, f"ระบบดาวเทียมต้องเป็นตัวอักษร {GNSS_LETTERS} อย่างน้อยหนึ่งตัว "
                                     f"(เพิ่ม {IMAGING_LETTER} เพื่อดึงกลุ่มดาวถ่ายภาพ)")
            return "".join(l for l in SYSTEM_LETTERS if l in letters)    # ลำดับ GREC แล้ว X ไม่ซ้ำ: GRECX, XGREC, xgrec เป็น job เดียวกัน
        raise _invalid(name, f"ไม่รู้จักค่า {name}")

    def _check_params(self, kind: str, params) -> dict:
        if not isinstance(params, dict):
            raise _invalid("params", "params ต้องเป็น JSON object")
        allowed = PARAMS[kind]
        for name in params:
            if name not in allowed:
                raise _invalid(name, f"job {kind} ไม่รับค่า {name}")
        for name, required in allowed.items():
            if required and name not in params:
                raise _invalid(name, f"job {kind} ต้องมีค่า {name}")
        return {name: self._check_value(name, value) for name, value in params.items()}

    def _new_id(self, now: datetime) -> str:
        stamp = now.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%S")
        while True:
            job_id = f"j-{stamp}-{secrets.token_hex(2)}"
            if job_id not in self._jobs and not (self.jobs_dir / f"{job_id}.json").exists():
                return job_id

    def submit(self, kind: str, scenario: str | None, params: dict, origin: str = "user", *,
               reuse_active: bool = True) -> JobRecord:
        """เพิ่ม job เข้าคิว ค่าผิด -> ApiError 422 SCENARIO_INVALID (field ชี้ค่าที่ผิด) ไม่มี scenario -> 404

        job ที่ kind, scenario และ params เหมือน job ที่ยังรอหรือกำลังรัน คืนตัวเดิม (ไม่สนใจ origin)
        หรือ ApiError 409 JOB_RUNNING (detail = id ของตัวเดิม) ถ้า reuse_active เป็น False (ตรวจใต้ล็อกเดียวกับการเพิ่ม)"""
        if kind not in KINDS:
            raise _invalid("kind", f"ชนิด job ต้องเป็นหนึ่งใน {', '.join(KINDS)}")
        if origin not in ORIGINS:
            raise _invalid("origin", f"origin ต้องเป็นหนึ่งใน {', '.join(ORIGINS)}")
        self._check_scenario(kind, scenario)
        params = self._check_params(kind, params)
        if scenario is not None:
            self._store.current_etag(scenario)                  # ไม่มี scenario นี้ -> 404
        with self._cond:
            for rec in self._jobs.values():
                if rec.state in ACTIVE and (rec.kind, rec.scenario, rec.params) == (kind, scenario, params):
                    if not reuse_active:
                        raise ApiError(409, "JOB_RUNNING", f"มี job {kind} แบบเดียวกันที่รออยู่หรือกำลังทำงาน ({rec.id}) "
                                                           "รอให้จบหรือยกเลิกก่อนจึงสั่งใหม่ได้", detail=rec.id)
                    return copy.deepcopy(rec)
            now = self.clock()
            rec = JobRecord(id=self._new_id(now), kind=kind, scenario=scenario, params=params,
                            created_utc=iso_ms(now), origin=origin)
            self._write(rec)                                     # เขียนไม่ได้ -> ไม่รับงาน
            self._jobs[rec.id] = rec
            self._queue.append(rec.id)
            self._publish(rec)
            self._cond.notify_all()
            return copy.deepcopy(rec)

    # ---------- ยกเลิก ----------

    def cancel(self, job_id: str) -> JobRecord:
        """ยกเลิก job: ที่ยังรอเป็น cancelled ทันที (ไม่สร้าง process) ที่จบแล้วคืนตามเดิม ที่กำลังรันฆ่า GMAT และ process ลูก
        แล้วรอ (ไม่เกิน CANCEL_WAIT_S) ให้บันทึกเป็น cancelled ไม่มี job -> ApiError 404"""
        with self._cond:
            rec = self._require(job_id)
            if rec.state in FINISHED:
                return copy.deepcopy(rec)
            if rec.state == "queued":
                try:
                    self._queue.remove(job_id)
                except ValueError:
                    pass
                rec.state, rec.finished_utc = "cancelled", iso_ms(self.clock())
                self._changed(rec)
                self._cond.notify_all()
                return copy.deepcopy(rec)
            rec.cancel_requested = True
            pgid, rec.gmat_pgid = rec.gmat_pgid, None
            handle = self._handle if self._current is rec else None
        kill_group(pgid)
        if handle is not None:
            handle.terminate()
        return self.wait(job_id, CANCEL_WAIT_S)

    # ---------- เปิด/ปิด ----------

    def start(self) -> None:
        """recover, prune แล้วเริ่ม thread ของคิว (เรียกซ้ำไม่มีผล)"""
        if self._thread is not None:
            return
        self.recover()
        self.prune(self.clock())
        self._stopping = False
        self._thread = threading.Thread(target=self._loop, name=THREAD_NAME, daemon=True)
        self._thread.start()

    def stop(self, timeout: float = STOP_JOIN_S) -> None:
        """หยุด thread ของคิว: ฆ่า GMAT และ process ลูกของงานที่รันอยู่ งานนั้นและงานที่ยังรอเป็น failed INTERRUPTED"""
        with self._cond:
            self._stopping = True
            pgid, handle = None, None
            if self._current is not None:
                self._stop_kill = True
                pgid, self._current.gmat_pgid = self._current.gmat_pgid, None
                handle = self._handle
            self._cond.notify_all()
        kill_group(pgid)
        if handle is not None:
            handle.terminate()
        if self._thread is not None:
            self._thread.join(timeout)
            if self._thread.is_alive():
                self.logger.warning("thread ของคิว job ไม่จบภายใน %.0f วินาที", timeout)
            self._thread = None
        with self._cond:
            now = iso_ms(self.clock())
            for job_id in self._queue:
                rec = self._jobs.get(job_id)
                if rec is not None and rec.state == "queued":
                    rec.state, rec.finished_utc = "failed", now
                    rec.error = _error("INTERRUPTED", INTERRUPTED_TEXT)
                    self._changed(rec)
            self._queue.clear()
            self._cond.notify_all()

    def recover(self) -> None:
        """อ่านบันทึกทั้งหมดใน data/jobs/ (ที่ยังไม่อยู่ในหน่วยความจำ) queued/running ที่ค้างเป็น failed INTERRUPTED"""
        try:
            paths = sorted(self.jobs_dir.glob("*.json"))
        except OSError:
            return
        loaded = []
        for path in paths:
            try:
                rec = JobRecord.from_dict(json.loads(path.read_text(encoding="utf-8")))
            except (OSError, ValueError, TypeError) as exc:
                self.logger.warning("ข้ามบันทึก job ที่อ่านไม่ได้ %s: %s", path.name, exc)
                continue
            if rec.id != path.stem:
                self.logger.warning("ข้ามบันทึก job %s: id ในไฟล์ (%s) ไม่ตรงกับชื่อไฟล์", path.name, rec.id)
                continue
            loaded.append(rec)
        loaded.sort(key=lambda r: (r.created_utc, r.id))
        with self._cond:
            now = iso_ms(self.clock())
            older = {}
            for rec in loaded:
                if rec.id in self._jobs:
                    continue
                if rec.state in ACTIVE:
                    rec.state, rec.finished_utc, rec.gmat_pgid = "failed", now, None
                    rec.error = _error("INTERRUPTED", INTERRUPTED_TEXT)
                    self._changed(rec)
                older[rec.id] = rec
            self._jobs = {**older, **self._jobs}

    def prune(self, now: datetime) -> None:
        """ลบบันทึกของ job ที่จบแล้วซึ่ง finished_utc (หรือ created_utc ถ้าไม่มี) เก่ากว่า 30 วันก่อน now ทั้งไฟล์และหน่วยความจำ"""
        cutoff = now - RETENTION
        try:
            paths = list(self.jobs_dir.glob("*.json"))
        except OSError:
            return
        for path in paths:
            with self._cond:
                rec = self._jobs.get(path.stem)
                if rec is not None:
                    data = rec.to_dict()
                else:
                    try:
                        data = json.loads(path.read_text(encoding="utf-8"))
                    except (OSError, ValueError):
                        continue
                if not isinstance(data, dict) or data.get("state") not in FINISHED:
                    continue
                when = _parse_time(data.get("finished_utc") or data.get("created_utc"))
                if when is None or when >= cutoff:
                    continue
                try:
                    path.unlink(missing_ok=True)
                except OSError as exc:
                    self.logger.warning("ลบบันทึก job %s ไม่ได้: %s", path.name, exc)
                    continue
                self._jobs.pop(path.stem, None)

    # ---------- เขียนและส่ง event (เรียกใต้ล็อก) ----------

    def _write(self, rec: JobRecord) -> None:
        self.jobs_dir.mkdir(parents=True, exist_ok=True)
        path = self.jobs_dir / f"{rec.id}.json"
        tmp = path.with_name(f"{path.name}.tmp-{uuid.uuid4().hex[:8]}")
        try:
            tmp.write_bytes((json.dumps(rec.to_dict(), ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
            os.replace(tmp, path)
        finally:
            tmp.unlink(missing_ok=True)

    def _publish(self, rec: JobRecord) -> None:
        self.bus.publish("job", _event(rec))

    def _changed(self, rec: JobRecord) -> None:
        """เขียนไฟล์ (เขียนไม่ได้แค่ log: หน่วยความจำยังถูกต้อง คิวทำงานต่อได้) แล้วส่ง event"""
        try:
            self._write(rec)
        except OSError as exc:
            self.logger.error("เขียนบันทึก job %s ไม่ได้: %s", rec.id, exc)
        self._publish(rec)

    # ---------- thread ของคิว ----------

    def _next(self) -> JobRecord | None:
        with self._cond:
            while True:
                if self._stopping:
                    return None
                while self._queue:
                    rec = self._jobs.get(self._queue.popleft())
                    if rec is not None and rec.state == "queued":
                        rec.state, rec.started_utc = "running", iso_ms(self.clock())
                        self._current, self._stop_kill = rec, False
                        self._changed(rec)
                        return rec
                self._cond.wait()

    def _loop(self) -> None:
        while (rec := self._next()) is not None:
            try:
                self._run(rec)
            except Exception:                                    # thread ของคิวต้องไม่ตาย
                self.logger.exception("คิว job ผิดพลาดระหว่างทำ job %s", rec.id)
                with self._cond:
                    unfinished = rec.state == "running"
                    handle = self._handle if self._current is rec else None
                    pgid, rec.gmat_pgid = rec.gmat_pgid, None
                kill_group(pgid)                                 # อย่าให้ GMAT/process ลูกทำงานคู่กับ job ถัดไป
                if handle is not None:
                    handle.terminate()
                if unfinished:
                    self._finish(rec, ("error", _error("INTERNAL", CRASH_TEXT)))

    def _run(self, rec: JobRecord) -> None:
        with self._cond:
            job = copy.deepcopy(rec)
            skip = rec.cancel_requested or self._stopping           # ยกเลิก/ปิดหลังหยิบ job แต่ก่อนสร้าง process
            if self._stopping:
                self._stop_kill = True
        if skip:
            self._finish(rec, None)                              # cancelled หรือ INTERRUPTED โดยไม่สร้าง process
            return
        try:
            handle = self.runner.start(job, self.data_dir)
        except Exception as exc:
            self.logger.exception("เริ่ม job %s ไม่ได้", rec.id)
            self._finish(rec, ("error", _error("INTERNAL", f"เริ่ม job ไม่ได้: {type(exc).__name__}")))
            return
        with self._cond:
            self._handle = handle
            stop_now = rec.cancel_requested or self._stopping       # ยกเลิก/ปิดมาก่อนได้ handle
            if self._stopping:
                self._stop_kill = True
        if stop_now:
            handle.terminate()
        outcome = None
        for msg in handle.messages():
            if msg is None:
                continue
            if msg[0] in TERMINAL:
                outcome = outcome or msg
                continue
            self._apply(rec, msg)
        self._finish(rec, outcome)

    def _apply(self, rec: JobRecord, msg: tuple) -> None:
        with self._cond:
            if msg[0] == "progress":
                _, stage, fraction = msg
                rec.progress = {"stage": stage, "fraction": fraction}
                last_stage, last_t = self._last_progress.get(rec.id, (None, 0.0))
                now = time.monotonic()
                if stage != last_stage or now - last_t >= PROGRESS_MIN_INTERVAL_S:
                    self._last_progress[rec.id] = (stage, now)
                    self._changed(rec)
            elif msg[0] == "gmat_pgid":
                pgid = msg[1]
                if pgid is not None and (rec.cancel_requested or self._stop_kill):
                    kill_group(pgid)                             # GMAT เริ่มหลังสั่งยกเลิก/ปิด
                    pgid = None
                rec.gmat_pgid = pgid
            elif msg[0] == "message":
                m = msg[1]
                rec.messages.append(m)
                post_message(self.bus, m.get("level", "info"), m.get("code", ""), m.get("text", ""), m.get("object"))
            else:
                self.logger.warning("job %s: ข้อความจาก worker ที่ไม่รู้จัก %r", rec.id, msg[0])

    def _finish(self, rec: JobRecord, outcome: tuple | None) -> None:
        with self._cond:
            leftover, rec.gmat_pgid = rec.gmat_pgid, None
            kill_group(leftover)                                 # process ลูกจบโดยไม่บอกว่า GMAT จบ: อย่าทิ้ง GMAT ค้าง
            if rec.cancel_requested:
                rec.state = "cancelled"
            elif outcome is not None and outcome[0] == "result":
                rec.state, rec.result = "succeeded", outcome[1]
            elif self._stop_kill:
                rec.state, rec.error = "failed", _error("INTERRUPTED", INTERRUPTED_TEXT)
            else:
                raw = dict(outcome[1]) if outcome is not None else _error("INTERNAL", CRASH_TEXT)
                trace = raw.pop("traceback", None)
                rec.state = "failed"
                rec.error = _error(str(raw.get("code") or "INTERNAL"), str(raw.get("text") or ""), raw.get("detail"))
                if rec.error["code"] == "INTERNAL":
                    self.logger.error("INTERNAL job=%s kind=%s scenario=%s: %s %s\n%s", rec.id, rec.kind, rec.scenario,
                                      rec.error["text"], rec.error["detail"] or "", trace or "")
            if rec.state == "failed":
                post_message(self.bus, "error", rec.error["code"], f"job {rec.kind} ({rec.id}) ไม่สำเร็จ: {rec.error['text']}")
            rec.finished_utc = iso_ms(self.clock())
            self._changed(rec)
            self._last_progress.pop(rec.id, None)
            if self._current is rec:
                self._current, self._handle = None, None
            self._cond.notify_all()
