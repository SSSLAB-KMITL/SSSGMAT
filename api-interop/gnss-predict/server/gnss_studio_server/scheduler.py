"""ตัวตั้งเวลางานประจำวัน (หัวข้อ 9 ของ spec server; ข้อ P7)

`Scheduler.tick(now)` เป็นตรรกะล้วน (test เรียกตรงด้วยเวลาที่กำหนด) คืน id ของ job ที่สั่งในรอบนั้น ทำตามลำดับ:

1. พยากรณ์ (9.2, 9.3): ให้ D = วันถัดไปของวันที่ของ now (UTC) ถ้า `enabled` และ now >= วันนี้ `run_at_utc` สั่ง job `daily`
   `{"for_date": D}` (origin scheduler) เว้นแต่มีอย่างใดอย่างหนึ่งของ D แล้ว:
   job daily ที่ succeeded, queued หรือ running; ที่ cancelled (ผู้ใช้กด Stop); ที่ failed ด้วยรหัสอื่นนอกจาก `INTERRUPTED`
   (รอรอบวันถัดไป ไม่สั่งซ้ำทุกนาที); หรือไฟล์ `data/daily/thbk_gnss_pred_<YYYYMMDD>_24h.csv` มีอยู่แล้ว
   ครอบคลุมงานที่พลาด: เปิด server หลังเวลารัน หรือรอบก่อนถูกขัดจังหวะ (`INTERRUPTED` จาก `JobManager.recover`) ก็สั่งทันที
2. ตรวจย้อนหลัง (9.4): ไม่บ่อยกว่าทุก `validation_retry_hours` นับจากครั้งล่าสุดที่สั่ง validate (รอบที่ไม่ได้สั่งอะไรไม่นับ)
   ไล่ scenario รายวัน (scenario.json มี `daily.for_date`) ที่ for_date <= วันนี้ − 1 ยังไม่มี `validation_<for_date>.json`
   (ใน ephem bundle ที่ current หรือ `data/validation/<scenario>/`) ไม่อยู่ในชุดที่เลิกแล้ว และไม่มี job validate ของวันนั้นที่ยังรอ/รัน
   แล้วสั่ง `validate` `{"day": for_date}` ถ้า job validate ล่าสุดของวันนั้นล้มเหลวด้วย `TRUTH_UNAVAILABLE` และเลย
   for_date + `validation_give_up_days` แล้ว: ข้อความ warning `VALIDATION_GAVE_UP` บันทึกว่าเลิก และไม่สั่งอีกเลย
3. เก็บรักษา (9.5): scenario รายวันที่ for_date < วันนี้ − `retention_days` ย้ายไฟล์ `validation_*.json/.md` จาก
   `ephem/<hash>/` ไป `data/validation/<scenario>/` (ไม่ทับไฟล์ชื่อเดียวกันที่มีอยู่: ไฟล์ที่ชนไปอยู่ใต้ `<hash>/` แทน)
   แล้วลบ `ephem/` และ `access/` เก็บ `scenario.json` และไฟล์ใน `data/daily/` scenario ที่มี job ยังรอ/รันอยู่ข้ามไปก่อน (มี log)
   scenario ที่ไม่ใช่รายวันไม่ถูกแตะ
4. `jobs.prune(now)` วันละครั้ง (UTC)
5. ส่ง SSE `daily` `{state, last_run_utc, next_run_utc, for_date}` เมื่อสถานะต่างจากที่ส่งครั้งก่อน (`daily_status`)

- ค่าตั้งอ่านใหม่ทุก tick (`settings.load`) ไม่ cache ปิด `enabled` (รวมไฟล์ค่าตั้งเสียที่ fail safe เป็นปิด) = ไม่ทำข้อ 1-3
  (ไม่ดึงข้อมูลและไม่ลบผลตามค่าตั้งที่ไม่ได้ยืนยัน) ข้อ 4-5 ยังทำ
- สถานะของการตรวจย้อนหลังอยู่ที่ `data/daily/state.json` `{"last_validation_attempt_utc", "given_up": [{scenario, day}]}`
  เขียนแบบ atomic อ่านครั้งแรกที่ใช้ ไฟล์เสียถือเป็นว่าง (มี log) ไม่ทำให้ tick ล้ม
- แต่ละข้อแยก try: ข้อหนึ่งผิดพลาด (log พร้อม traceback) ข้อถัดไปยังทำ
- `start()` เริ่ม thread ที่เรียก `tick(clock())` ทันทีแล้วทุก `interval_s` (60) วินาที exception ใน tick ลง log แล้ววนต่อ
  `wake()` ปลุกก่อนครบคาบ (ใช้เป็น `settings_on_change`) `stop()` จบทันทีผ่าน Event ไม่รอครบคาบ
"""

import json
import logging
import os
import re
import shutil
import threading
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

from gnss_predict import studio
from gnss_predict.errors import GnssPredictError, Sp3UnavailableError

from . import settings as settings_module
from .daily import DAILY_DIR, csv_path
from .errors import ApiError
from .events import EventBus, message as post_message
from .jobs import ACTIVE, JobManager, JobRecord, utcnow
from .schema import NAME_RE, parse_utc_z
from .settings import Daily, Settings
from .store import SCENARIO_FILE, SCENARIOS_DIR, write_atomic
from .templates import iso_utc

STATE_FILE = "state.json"
TICK_S = 60.0
STOP_JOIN_S = 10.0
THREAD_NAME = "gnss-studio-scheduler"
INTERRUPTED = "INTERRUPTED"
TRUTH_UNAVAILABLE = Sp3UnavailableError.code
VALIDATION_FILE_RE = re.compile(r"^validation_\d{4}-\d{2}-\d{2}\.(json|md)$", re.ASCII)
EPHEM_DIR, ACCESS_DIR, VALIDATION_DIR = studio.EPHEM_DIR, studio.ACCESS_DIR, studio.VALIDATION_DIR
STATUS_OF_JOB = {"queued": "running", "running": "running", "succeeded": "ok", "failed": "failed", "cancelled": "failed"}


# ---------- เวลาและสถานะ ----------

def _at(day: date, hhmm: str) -> datetime:
    hours, minutes = hhmm.split(":")
    return datetime.combine(day, time(int(hours), int(minutes)), tzinfo=timezone.utc)


def next_run(now: datetime, daily: Daily) -> datetime | None:
    """เวลารันตามกำหนดครั้งถัดไป: วันนี้ run_at_utc ถ้ายังไม่ถึง ไม่งั้นพรุ่งนี้ ปิดงานประจำวัน = None"""
    if not daily.enabled:
        return None
    today = _at(now.date(), daily.run_at_utc)
    return today if now < today else today + timedelta(days=1)


def _latest(records: list[JobRecord]) -> JobRecord | None:
    return max(records, key=lambda r: (r.created_utc, r.id), default=None)


def daily_status(jobs: JobManager, daily: Daily, now: datetime) -> dict:
    """สถานะงานประจำวัน (event `daily` และ `GET /api/health`) จาก job daily ล่าสุด:
    state idle (ยังไม่เคยมี) | running (queued/running) | ok | failed (failed/cancelled)
    last_run_utc = เวลาเริ่มของ job นั้น (ยังไม่เริ่ม = เวลาที่สั่ง) for_date = D ของ job นั้น"""
    latest = _latest([r for r in jobs.list() if r.kind == "daily"])
    when = next_run(now.astimezone(timezone.utc), daily)
    return {"state": "idle" if latest is None else STATUS_OF_JOB[latest.state],
            "last_run_utc": None if latest is None else latest.started_utc or latest.created_utc,
            "next_run_utc": None if when is None else iso_utc(when),
            "for_date": None if latest is None else latest.params.get("for_date")}


# ---------- scenario รายวัน ----------

def _for_date(doc) -> date | None:
    info = doc.get("daily") if isinstance(doc, dict) else None
    value = info.get("for_date") if isinstance(info, dict) else None
    try:
        day = date.fromisoformat(value) if isinstance(value, str) else None
    except ValueError:
        return None
    return day if day is not None and day.isoformat() == value else None


def daily_scenarios(data_dir: Path) -> list[tuple[str, date]]:
    """(ชื่อ, for_date) ของ scenario ที่ scenario.json มี `daily.for_date` ถูกต้อง เรียงตามชื่อ
    ข้ามชื่อผิดกติกา, symlink และไฟล์ที่อ่านไม่ได้ (การเก็บรักษาลบไฟล์: ห้ามตาม symlink ออกนอก data/)"""
    root = Path(data_dir) / SCENARIOS_DIR
    try:
        with os.scandir(root) as entries:
            names = sorted(e.name for e in entries if NAME_RE.fullmatch(e.name) and e.is_dir(follow_symlinks=False))
    except OSError:
        return []
    out = []
    for name in names:
        try:
            day = _for_date(json.loads((root / name / SCENARIO_FILE).read_bytes()))
        except (OSError, ValueError, RecursionError):
            continue
        if day is not None:
            out.append((name, day))
    return out


# ---------- สถานะที่เก็บไว้ (data/daily/state.json) ----------

@dataclass
class _State:
    last_attempt: datetime | None = None
    given_up: set[tuple[str, str]] = field(default_factory=set)          # (scenario, day)

    def to_bytes(self) -> bytes:
        doc = {"last_validation_attempt_utc": None if self.last_attempt is None else iso_utc(self.last_attempt),
               "given_up": [{"scenario": s, "day": d} for s, d in sorted(self.given_up)]}
        return (json.dumps(doc, ensure_ascii=False, indent=2) + "\n").encode("utf-8")

    @classmethod
    def from_bytes(cls, raw: bytes) -> "_State":
        """ValueError ถ้ารูปแบบผิด"""
        doc = json.loads(raw)
        if not isinstance(doc, dict):
            raise ValueError("ราก JSON ต้องเป็น object")
        last = doc.get("last_validation_attempt_utc")
        if last is not None and not isinstance(last, str):
            raise ValueError("last_validation_attempt_utc ต้องเป็นเวลาแบบ ISO 8601 ลงท้าย Z หรือ null")
        items = doc.get("given_up", [])
        if not isinstance(items, list) or not all(
                isinstance(i, dict) and isinstance(i.get("scenario"), str) and isinstance(i.get("day"), str) for i in items):
            raise ValueError("given_up ต้องเป็นรายการของ {scenario, day}")
        return cls(None if last is None else parse_utc_z(last), {(i["scenario"], i["day"]) for i in items})


# ---------- ตัวตั้งเวลา ----------

class Scheduler:
    def __init__(self, data_dir: Path, jobs: JobManager, settings_provider: Callable[[], Settings] | None = None,
                 bus: EventBus | None = None, *, clock: Callable[[], datetime] = utcnow, interval_s: float = TICK_S,
                 logger: logging.Logger | None = None):
        """settings_provider: เรียกทุก tick (ตั้งต้น `settings.load(data_dir)`) bus: ตั้งต้นใช้ bus ของ jobs"""
        self.data_dir = Path(data_dir)
        self.jobs = jobs
        self.bus = bus if bus is not None else jobs.bus
        self.logger = logger or logging.getLogger("gnss_studio_server.scheduler")
        self.settings_provider = settings_provider or (lambda: settings_module.load(self.data_dir, self.logger))
        self.clock = clock
        self.interval_s = interval_s
        self._tick_lock = threading.Lock()
        self._state: _State | None = None
        self._pruned_on: date | None = None
        self._last_status: dict | None = None
        self._wake = threading.Event()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    # ---------- tick ----------

    def tick(self, now: datetime) -> list[str]:
        """หนึ่งรอบตามหัวไฟล์ คืน id ของ job ที่สั่งในรอบนี้ (พยากรณ์ก่อน แล้วตรวจย้อนหลัง)"""
        now = now.astimezone(timezone.utc)
        with self._tick_lock:
            daily = self.settings_provider().daily
            submitted: list[str] = []
            if daily.enabled:
                submitted += self._guarded("พยากรณ์", self._forecast, now, daily)
                submitted += self._guarded("ตรวจย้อนหลัง", self._validation, now, daily)
                self._guarded("เก็บรักษา", self._retention, now, daily)
            if self._pruned_on != now.date():
                self._guarded("ลบบันทึก job เก่า", self._prune, now)
            self._guarded("ส่งสถานะ", self._publish_status, now, daily)
            return submitted

    def _guarded(self, what: str, step, *args) -> list[str]:
        try:
            return step(*args) or []
        except Exception:
            self.logger.exception("ตัวตั้งเวลา: ขั้น%sผิดพลาด", what)
            return []

    def _forecast(self, now: datetime, daily: Daily) -> list[str]:
        if now < _at(now.date(), daily.run_at_utc):
            return []
        day = now.date() + timedelta(days=1)
        if csv_path(self.data_dir, day).exists():
            return []
        same_day = [r for r in self.jobs.list() if r.kind == "daily" and r.params.get("for_date") == day.isoformat()]
        if any(not (r.state == "failed" and (r.error or {}).get("code") == INTERRUPTED) for r in same_day):
            return []
        rec = self.jobs.submit("daily", None, {"for_date": day.isoformat()}, origin="scheduler")
        self.logger.info("ตัวตั้งเวลา: สั่งพยากรณ์ของวันที่ %s (job %s)", day.isoformat(), rec.id)
        return [rec.id]

    # ---------- ตรวจย้อนหลัง ----------

    def _validated(self, name: str, day: str) -> bool:
        """มี validation_<day>.json แล้ว: ที่ย้ายไปเก็บแล้วดูก่อน (ถูก) แล้วจึง ephem bundle ที่ current (ต้องสร้าง catalog)"""
        file = f"validation_{day}.json"
        if (self.data_dir / VALIDATION_DIR / name / file).is_file():
            return True
        scenario_dir = self.data_dir / SCENARIOS_DIR / name
        try:
            current = studio.plan_propagate(scenario_dir, self.data_dir).hash
        except GnssPredictError:                         # หา bundle ที่ current ไม่ได้ (เช่น snapshot หาย): ให้ validate บอกเอง
            return False
        return (scenario_dir / EPHEM_DIR / current / file).is_file()

    def _validation(self, now: datetime, daily: Daily) -> list[str]:
        state = self._load_state()
        if state.last_attempt is not None and now - state.last_attempt < timedelta(hours=daily.validation_retry_hours):
            return []
        records = [r for r in self.jobs.list() if r.kind == "validate"]
        latest_day = now.date() - timedelta(days=1)
        submitted = []
        for name, for_date in daily_scenarios(self.data_dir):
            day = for_date.isoformat()
            if for_date > latest_day or (name, day) in state.given_up:
                continue
            mine = [r for r in records if r.scenario == name and r.params.get("day") == day]
            if any(r.state in ACTIVE for r in mine) or self._validated(name, day):
                continue
            latest = _latest(mine)
            deadline = datetime.combine(for_date, time(0), tzinfo=timezone.utc) + timedelta(days=daily.validation_give_up_days)
            if (latest is not None and latest.state == "failed" and (latest.error or {}).get("code") == TRUTH_UNAVAILABLE
                    and now > deadline):
                self._give_up(state, name, day, daily)
                continue
            try:
                rec = self.jobs.submit("validate", name, {"day": day}, origin="scheduler")
            except ApiError as exc:                      # เช่น scenario ถูกลบระหว่างรอบ
                self.logger.warning("ตัวตั้งเวลา: สั่งตรวจย้อนหลัง %s วันที่ %s ไม่ได้: %s %s", name, day, exc.code, exc.text)
                continue
            submitted.append(rec.id)
        if submitted:
            state.last_attempt = now
            self._save_state(state)
        return submitted

    def _give_up(self, state: _State, name: str, day: str, daily: Daily) -> None:
        state.given_up.add((name, day))
        self._save_state(state)
        text = (f"เลิกตรวจย้อนหลังผลพยากรณ์ของวันที่ {day} ({name}): ยังไม่มีข้อมูลวงโคจรจริง (SP3 ของ MGEX) "
                f"หลังผ่านไป {daily.validation_give_up_days} วัน จะไม่ลองอีก")
        post_message(self.bus, "warning", "VALIDATION_GAVE_UP", text, f"{SCENARIOS_DIR}/{name}")
        self.logger.warning("ตัวตั้งเวลา: %s", text)

    def _load_state(self) -> _State:
        if self._state is None:
            path = self.data_dir / DAILY_DIR / STATE_FILE
            try:
                self._state = _State.from_bytes(path.read_bytes())
            except FileNotFoundError:
                self._state = _State()
            except (OSError, ValueError, RecursionError) as exc:
                self.logger.warning("อ่าน %s ไม่ได้ ถือว่ายังไม่มีสถานะการตรวจย้อนหลัง: %s: %s", path, type(exc).__name__, exc)
                self._state = _State()
        return self._state

    def _save_state(self, state: _State) -> None:
        """เขียนไม่ได้แค่ log: สถานะในหน่วยความจำยังใช้ได้จนกว่าจะเปิด server ใหม่"""
        path = self.data_dir / DAILY_DIR / STATE_FILE
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            write_atomic(path, state.to_bytes())
        except OSError as exc:
            self.logger.error("เขียน %s ไม่ได้: %s", path, exc)

    # ---------- เก็บรักษา ----------

    def _retention(self, now: datetime, daily: Daily) -> list[str]:
        cutoff = now.date() - timedelta(days=daily.retention_days)
        for name, for_date in daily_scenarios(self.data_dir):
            scenario_dir = self.data_dir / SCENARIOS_DIR / name
            if for_date >= cutoff or not ((scenario_dir / EPHEM_DIR).exists() or (scenario_dir / ACCESS_DIR).exists()):
                continue
            if self.jobs.active_for(name):
                self.logger.info("ตัวตั้งเวลา: ข้ามการลบผลเก่าของ %s ไว้รอบหน้า เพราะมี job ที่ยังรอหรือกำลังรัน", name)
                continue
            if any((scenario_dir / sub).is_symlink() for sub in (EPHEM_DIR, ACCESS_DIR)):
                self.logger.warning("ตัวตั้งเวลา: ไม่ลบผลเก่าของ %s เพราะ ephem/ หรือ access/ เป็น symlink", name)
                continue
            try:
                self._archive_validation(name, scenario_dir)
                for sub in (EPHEM_DIR, ACCESS_DIR):
                    if (scenario_dir / sub).exists():
                        shutil.rmtree(scenario_dir / sub)
            except OSError as exc:
                self.logger.error("ตัวตั้งเวลา: ลบผลเก่าของ %s ไม่สำเร็จ: %s", name, exc)
                continue
            self.logger.info("ตัวตั้งเวลา: ลบ ephem/ และ access/ ของ %s (for_date %s เก่ากว่า %d วัน)", name,
                             for_date.isoformat(), daily.retention_days)
        return []

    def _archive_validation(self, name: str, scenario_dir: Path) -> None:
        """ย้าย validation_<วัน>.json/.md ทุกไฟล์ใน ephem/<hash>/ ไป data/validation/<scenario>/ ใหม่สุดก่อน
        ชื่อชนกับไฟล์ที่มีอยู่ ไปอยู่ใต้ data/validation/<scenario>/<hash>/ แทน ไม่ทับไฟล์ใด OSError ส่งต่อ (ยังไม่ลบอะไร)"""
        sources = [p for p in (scenario_dir / EPHEM_DIR).glob("*/validation_*")    # ไม่ตามโฟลเดอร์ bundle ที่เป็น symlink
                   if VALIDATION_FILE_RE.fullmatch(p.name) and not p.parent.is_symlink() and p.is_file()]
        sources.sort(key=lambda p: p.stat().st_mtime, reverse=True)
        dest = self.data_dir / VALIDATION_DIR / name
        for src in sources:
            target = dest / src.name
            if target.exists():
                target = dest / src.parent.name / src.name
            if target.exists():
                self.logger.warning("ตัวตั้งเวลา: มี %s อยู่แล้ว ไม่ย้าย %s ทับ", target, src)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(src, target)

    # ---------- prune และสถานะ ----------

    def _prune(self, now: datetime) -> list[str]:
        self.jobs.prune(now)
        self._pruned_on = now.date()
        return []

    def status(self, now: datetime | None = None) -> dict:
        """สถานะงานประจำวันตอนนี้ (ค่าตั้งอ่านใหม่)"""
        return daily_status(self.jobs, self.settings_provider().daily, now if now is not None else self.clock())

    def _publish_status(self, now: datetime, daily: Daily) -> list[str]:
        status = daily_status(self.jobs, daily, now)
        if status != self._last_status:
            self.bus.publish("daily", status)
            self._last_status = status
        return []

    # ---------- thread ----------

    def start(self) -> None:
        """เริ่ม thread (เรียกซ้ำไม่มีผล) tick แรกทันที"""
        if self._thread is not None:
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, name=THREAD_NAME, daemon=True)
        self._thread.start()

    def wake(self, *_args) -> None:
        """ให้ thread tick ทันทีไม่ต้องรอครบคาบ ใช้เป็น `settings_on_change(new)` (เร็ว: แค่ตั้ง Event)"""
        self._wake.set()

    def stop(self, timeout: float = STOP_JOIN_S) -> None:
        """หยุด thread: รอแค่ tick ที่กำลังทำอยู่ (ถ้ามี) ไม่รอครบคาบ"""
        self._stop.set()
        self._wake.set()
        if self._thread is not None:
            self._thread.join(timeout)
            if self._thread.is_alive():
                self.logger.warning("thread ของตัวตั้งเวลาไม่จบภายใน %.0f วินาที", timeout)
            self._thread = None

    def _loop(self) -> None:
        while True:
            self._wake.clear()                           # ล้างก่อนตรวจ _stop: stop() ตั้ง _stop ก่อน _wake จึงไม่มีทางพลาดทั้งคู่
            if self._stop.is_set():
                return
            try:
                self.tick(self.clock())
            except Exception:                            # thread ของตัวตั้งเวลาต้องไม่ตาย
                self.logger.exception("ตัวตั้งเวลา: tick ผิดพลาด")
            self._wake.wait(self.interval_s)
