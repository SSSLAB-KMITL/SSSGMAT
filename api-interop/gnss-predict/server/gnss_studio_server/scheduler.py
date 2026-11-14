"""ตัวตั้งเวลางานประจำวัน (หัวข้อ 9 ของ spec server; ข้อ P7)

`Scheduler.tick(now)` เป็นตรรกะล้วน (test เรียกตรงด้วยเวลาที่กำหนด) คืน id ของ job ที่สั่งในรอบนั้น ทำตามลำดับ:

1. พยากรณ์ (9.2, 9.3): ให้ D = วันถัดไปของวันที่ของ now (UTC) ถ้า `enabled` และ now >= วันนี้ `run_at_utc` สั่ง job `daily`
   `{"for_date": D}` (origin scheduler) เว้นแต่มีอย่างใดอย่างหนึ่งของ D แล้ว:
   job daily ที่ succeeded, queued หรือ running; ที่ cancelled (ผู้ใช้กด Stop); ที่ failed ด้วยรหัสอื่นนอกจาก `INTERRUPTED`
   (รอรอบวันถัดไป ไม่สั่งซ้ำทุกนาที); หรือไฟล์ `data/daily/thbk_gnss_pred_<YYYYMMDD>_24h.csv` มีอยู่แล้ว
   ครอบคลุมงานที่พลาด: เปิด server หลังเวลารัน หรือรอบก่อนถูกขัดจังหวะ (`INTERRUPTED` จาก `JobManager.recover`) ก็สั่งทันที
2. ตรวจย้อนหลัง (9.4): ไม่บ่อยกว่าทุก `validation_retry_hours` นับจากรอบล่าสุดที่สั่งหรือพยายามสั่ง validate
   (รอบที่ไม่มีอะไรให้สั่งไม่นับ; สั่งไม่สำเร็จ เช่น ดิสก์เต็ม ก็นับ จึงไม่ลองซ้ำทุกนาที)
   ไล่ scenario รายวัน (scenario.json มี `daily.for_date`) ที่ for_date <= วันนี้ − 1 ยังไม่มี `validation_<for_date>.json`
   (ใน `data/validation/<scenario>/` หรือ ephem bundle ใดก็ได้ของ scenario: ตรวจด้วยไฟล์ ไม่สร้าง catalog)
   ไม่อยู่ในชุดที่เลิกแล้ว และไม่มี job validate ของวันนั้นที่ยังรอ/รัน แล้วสั่ง `validate` `{"day": for_date}`
   เลยเส้นตาย (`give_up_deadline`: D+1 00:00Z + `validation_give_up_days`) และมี job validate ของวันนั้นที่จบโดยไม่สำเร็จ
   อย่างน้อยหนึ่งตัว (failed รหัสใดก็ได้ หรือ cancelled): ข้อความ warning `VALIDATION_GAVE_UP` บันทึกว่าเลิก และไม่สั่งอีกเลย
   (เลยเส้นตายแต่ยังไม่เคยลอง: ลองหนึ่งครั้งก่อน) ก่อนเส้นตายลองใหม่ตามรอบเสมอ
3. เก็บรักษา (9.5): scenario รายวันที่ for_date < วันนี้ − `retention_days` ลบเฉพาะ bundle `ephem/<hash>` และ
   `access/<facility>/<hash>` ที่ mtime ของโฟลเดอร์เก่ากว่า now − `retention_days` (ผลที่เพิ่งคำนวณบน scenario เก่าอยู่ต่อ)
   ก่อนลบ ย้ายไฟล์ `validation_<วัน>.json/.md` ของ bundle ไป `data/validation/<scenario>/` โดยไม่ทับไฟล์ใด (ชื่อชน:
   `<hash>/<ชื่อ>` แล้ว `<hash>/<stem>.<n>.<ext>`) bundle ที่ย้ายไฟล์ validation ไม่ได้ไม่ถูกลบ (มี log) โฟลเดอร์ที่ว่างแล้วถูกลบ
   เก็บ `scenario.json` และไฟล์ใน `data/daily/` ไม่ตาม symlink ใด ๆ scenario ที่มี job ยังรอ/รันอยู่ข้ามไปก่อน (มี log)
   scenario ที่ไม่ใช่รายวันไม่ถูกแตะ
4. `jobs.prune(now)` วันละครั้ง (UTC)
5. ส่ง SSE `daily` `{state, last_run_utc, next_run_utc, for_date}` เมื่อสถานะต่างจากที่ส่งครั้งก่อน (`daily_status`)

- `Scheduler.pending(now)` (อ่านอย่างเดียว ไม่สั่ง job ไม่เขียน state; ใช้กับ `GET /api/validation/pending`): วันของ scenario รายวันที่
  ถึงเวลาตรวจแล้วแต่ยังไม่มี `validation_<วัน>.json` เป็น `pending` (พร้อมเวลาที่จะลองครั้งถัดไป) หรือ `gave_up` (อยู่ใน `given_up`)
- ค่าตั้งอ่านใหม่ทุก tick (`settings.load`) ไม่ cache ปิด `enabled` (รวมไฟล์ค่าตั้งเสียที่ fail safe เป็นปิด) = ไม่ทำข้อ 1-3
  (ไม่ดึงข้อมูลและไม่ลบผลตามค่าตั้งที่ไม่ได้ยืนยัน) ข้อ 4-5 ยังทำ
- สถานะของการตรวจย้อนหลังอยู่ที่ `data/daily/state.json` `{"last_validation_attempt_utc", "given_up": [{scenario, day}]}`
  เขียนแบบ atomic อ่านครั้งแรกที่ใช้ ไฟล์เสียถือเป็นว่าง (มี log) ไม่ทำให้ tick ล้ม
- แต่ละข้อแยก try: ข้อหนึ่งผิดพลาด (log พร้อม traceback) ข้อถัดไปยังทำ
- `start()` เริ่ม thread ที่เรียก `tick(clock())` ทันทีแล้วทุก `interval_s` (60) วินาที exception ใน tick ลง log แล้ววนต่อ
  `wake()` ปลุกก่อนครบคาบ (ใช้เป็น `settings_on_change`) `stop()` จบทันทีผ่าน Event ไม่รอครบคาบ ถ้า join หมดเวลา
  thread เดิมยังถูกเก็บไว้ และ `start()` จะไม่เริ่ม loop ที่สองจนกว่าตัวเดิมจะจบ
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

from . import settings as settings_module
from .daily import DAILY_DIR, csv_path
from .errors import ApiError
from .events import EventBus, message as post_message
from .jobs import ACTIVE, FINISHED, JobManager, JobRecord, utcnow
from .schema import NAME_RE, parse_utc_z
from .settings import Daily, Settings
from .store import SCENARIO_FILE, SCENARIOS_DIR, write_atomic
from .templates import iso_utc

STATE_FILE = "state.json"
TICK_S = 60.0
STOP_JOIN_S = 10.0
THREAD_NAME = "gnss-studio-scheduler"
INTERRUPTED = "INTERRUPTED"
ARCHIVE_COPIES_MAX = 1000             # ชื่อสำรอง validation_<วัน>.<n>.json ใต้ <hash>/ ของที่เก็บ (n = 2..)
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


def give_up_deadline(for_date: date, daily: Daily) -> datetime:
    """เลิกตรวจย้อนหลังของวันนั้นได้เมื่อเลยเวลานี้: `validation_give_up_days` วันหลังวันนั้นจบ (D+1 00:00Z) ตาม 9.4"""
    end_of_day = datetime.combine(for_date + timedelta(days=1), time(0), tzinfo=timezone.utc)
    return end_of_day + timedelta(days=daily.validation_give_up_days)


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


# ---------- โฟลเดอร์ผลลัพธ์ (เก็บรักษา) ----------

def _subdirs(folder: Path) -> list[Path]:
    """โฟลเดอร์ย่อยจริง (ไม่ใช่ symlink) ของ folder ที่เป็นโฟลเดอร์จริง folder ที่เป็น symlink หรือไม่มี = ว่าง (ไม่ตามออกนอก data/)"""
    if folder.is_symlink() or not folder.is_dir():
        return []
    with os.scandir(folder) as entries:
        return sorted(Path(e.path) for e in entries if e.is_dir(follow_symlinks=False))


def old_bundles(scenario_dir: Path, cutoff: float) -> list[Path]:
    """bundle `ephem/<hash>` และ `access/<facility>/<hash>` ที่แก้ล่าสุด (mtime ของโฟลเดอร์ ไม่ตาม symlink) ก่อน cutoff (timestamp)
    ผลที่ผู้ใช้เพิ่งคำนวณบน scenario เก่าจึงไม่ถูกลบจนกว่าจะเก่าพอเอง"""
    parents = [scenario_dir / EPHEM_DIR, *_subdirs(scenario_dir / ACCESS_DIR)]
    return [b for parent in parents for b in _subdirs(parent) if b.lstat().st_mtime < cutoff]


def _validation_files(bundle: Path) -> list[Path]:
    """ไฟล์ validation_<วัน>.json/.md ที่เป็นไฟล์จริงใน bundle (symlink ไม่นับ: ไม่ใช่ผลของ engine ลบได้แค่ตัว link)"""
    return [p for p in bundle.iterdir() if VALIDATION_FILE_RE.fullmatch(p.name) and not p.is_symlink() and p.is_file()]


def _archive_targets(dest: Path, src: Path):
    """ชื่อที่ลองตามลำดับ: <dest>/<ชื่อ>, <dest>/<hash>/<ชื่อ>, <dest>/<hash>/<stem>.<n>.<ext> (n = 2..)"""
    yield dest / src.name
    yield dest / src.parent.name / src.name
    stem, ext = src.name.rsplit(".", 1)
    for n in range(2, ARCHIVE_COPIES_MAX):
        yield dest / src.parent.name / f"{stem}.{n}.{ext}"


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
        self._state_lock = threading.Lock()         # โหลด state ครั้งแรก: `pending` (thread ของ route) กับ tick โหลดพร้อมกันได้
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
                scenarios = daily_scenarios(self.data_dir)          # อ่าน scenario.json ครั้งเดียวต่อ tick ใช้ร่วมสองขั้น
                submitted += self._guarded("ตรวจย้อนหลัง", self._validation, now, daily, scenarios)
                self._guarded("เก็บรักษา", self._retention, now, daily, scenarios)
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
        """มี validation_<day>.json แล้ว: ที่ย้ายไปเก็บแล้ว หรือใน ephem bundle ใดก็ได้ของ scenario ตรวจด้วยไฟล์อย่างเดียว
        (ไม่สร้าง catalog: รอบที่ทุกวันตรวจแล้วเกิดทุก tick ต้องถูก) ผลตรวจของ bundle ที่ไม่ current แล้วก็นับ เพราะเป็นหลักฐาน
        ความแม่นยำของพยากรณ์ที่ส่งออกไปแล้ว เหมือนไฟล์ที่การเก็บรักษาย้ายไป data/validation/"""
        file = f"validation_{day}.json"
        if (self.data_dir / VALIDATION_DIR / name / file).is_file():
            return True
        return any(p.is_file() for p in (self.data_dir / SCENARIOS_DIR / name / EPHEM_DIR).glob(f"*/{file}"))

    def _validation(self, now: datetime, daily: Daily, scenarios: list[tuple[str, date]]) -> list[str]:
        state = self._load_state()
        if state.last_attempt is not None and now - state.last_attempt < timedelta(hours=daily.validation_retry_hours):
            return []
        records = [r for r in self.jobs.list() if r.kind == "validate"]
        latest_day = now.date() - timedelta(days=1)
        submitted: list[str] = []
        attempted = False
        try:
            for name, for_date in scenarios:
                day = for_date.isoformat()
                if for_date > latest_day or (name, day) in state.given_up:
                    continue
                try:
                    mine = [r for r in records if r.scenario == name and r.params.get("day") == day]
                    if any(r.state in ACTIVE for r in mine) or self._validated(name, day):
                        continue
                    failed = [r for r in mine if r.state in FINISHED and r.state != "succeeded"]
                    if failed and now > give_up_deadline(for_date, daily):
                        self._give_up(state, name, day, daily, _latest(failed))
                        continue
                    attempted = True
                    submitted.append(self.jobs.submit("validate", name, {"day": day}, origin="scheduler").id)
                except ApiError as exc:                  # เช่น scenario ถูกลบระหว่างรอบ
                    self.logger.warning("ตัวตั้งเวลา: สั่งตรวจย้อนหลัง %s วันที่ %s ไม่ได้: %s %s", name, day, exc.code,
                                        exc.text)
                except Exception:                        # เช่น ดิสก์เต็ม: scenario อื่นในรอบยังทำต่อ
                    self.logger.exception("ตัวตั้งเวลา: ตรวจย้อนหลัง %s วันที่ %s ไม่สำเร็จ", name, day)
        finally:
            if attempted:                                # สั่งหรือพยายามสั่งแล้ว: รอบหน้าต้องรอครบช่วง (ไม่ลองซ้ำทุกนาที)
                state.last_attempt = now
                self._save_state(state)
        return submitted

    def pending(self, now: datetime) -> list[dict]:
        """วันที่ยังรอผลตรวจย้อนหลัง เรียงตามวันแล้วชื่อ scenario: `{"scenario", "day", "state", "next_attempt_utc"}`
        ต่อ scenario รายวันที่ for_date <= วันนี้ − 1 (UTC) และยังไม่มี validation_<day>.json (เกณฑ์เดียวกับ `_validation`)

        - `gave_up`: อยู่ใน `given_up` (ตัวตั้งเวลาเลิกแล้ว) `next_attempt_utc` เป็น None
        - `pending`: มี job validate ของวันนั้นที่รอ/รันอยู่ = `now` ไม่งั้น max(now, ครั้งล่าสุดที่สั่ง + `validation_retry_hours`)
          (ไม่เคยสั่งเลย = `now`) งานประจำวันปิดอยู่ (`enabled: false`) = None เพราะตัวตั้งเวลาไม่สั่งเอง

        อ่านอย่างเดียว: ไม่สั่ง job ไม่เขียน state.json (อ่านเข้า memory เหมือน tick) เรียกจาก thread ของ route ได้ระหว่าง tick:
        `given_up` ถูกคัดลอกก่อนใช้ ส่วน job อ่านผ่าน `jobs.list()` (มีล็อกของตัวเอง)"""
        now = now.astimezone(timezone.utc)
        daily = self.settings_provider().daily
        state = self._load_state()
        given_up, last_attempt = set(state.given_up), state.last_attempt
        retry_at = None if last_attempt is None else last_attempt + timedelta(hours=daily.validation_retry_hours)
        busy = {(r.scenario, r.params.get("day")) for r in self.jobs.list() if r.kind == "validate" and r.state in ACTIVE}
        latest_day = now.date() - timedelta(days=1)
        out = []
        for name, for_date in daily_scenarios(self.data_dir):
            day = for_date.isoformat()
            if for_date > latest_day or self._validated(name, day):
                continue
            if (name, day) in given_up:
                label, when = "gave_up", None
            elif not daily.enabled:
                label, when = "pending", None
            elif (name, day) in busy or retry_at is None:
                label, when = "pending", now
            else:
                label, when = "pending", max(now, retry_at)
            out.append({"scenario": name, "day": day, "state": label,
                        "next_attempt_utc": None if when is None else iso_utc(when)})
        return sorted(out, key=lambda item: (item["day"], item["scenario"]))

    def _give_up(self, state: _State, name: str, day: str, daily: Daily, last: JobRecord) -> None:
        state.given_up.add((name, day))
        self._save_state(state)
        reason = ((last.error or {}).get("code") or "ไม่ทราบสาเหตุ") if last.state == "failed" else "ถูกยกเลิก"
        text = (f"เลิกตรวจย้อนหลังผลพยากรณ์ของวันที่ {day} ({name}): ตรวจไม่สำเร็จจนเลย {daily.validation_give_up_days} วัน"
                f"หลังวันนั้น (ครั้งล่าสุด: {reason}) จะไม่ลองอีก")
        post_message(self.bus, "warning", "VALIDATION_GAVE_UP", text, f"{SCENARIOS_DIR}/{name}")
        self.logger.warning("ตัวตั้งเวลา: %s", text)

    def _load_state(self) -> _State:
        with self._state_lock:                           # ต้องได้ object เดียวกันทุก thread: tick แก้แล้วบันทึกต่อจากตัวนี้
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

    def _retention(self, now: datetime, daily: Daily, scenarios: list[tuple[str, date]]) -> list[str]:
        cutoff_day = now.date() - timedelta(days=daily.retention_days)
        cutoff = (now - timedelta(days=daily.retention_days)).timestamp()
        for name, for_date in scenarios:
            if for_date >= cutoff_day:
                continue
            scenario_dir = self.data_dir / SCENARIOS_DIR / name
            try:
                bundles = old_bundles(scenario_dir, cutoff)
                if not bundles:
                    continue
                if self.jobs.active_for(name):
                    self.logger.info("ตัวตั้งเวลา: ข้ามการลบผลเก่าของ %s ไว้รอบหน้า เพราะมี job ที่ยังรอหรือกำลังรัน", name)
                    continue
                self._expire(name, scenario_dir, bundles, daily)
            except OSError as exc:
                self.logger.error("ตัวตั้งเวลา: ลบผลเก่าของ %s ไม่สำเร็จ: %s", name, exc)
        return []

    def _expire(self, name: str, scenario_dir: Path, bundles: list[Path], daily: Daily) -> None:
        """ย้ายไฟล์ validation ของ bundle ที่จะลบไป data/validation/<scenario>/ (ใหม่สุดก่อน) แล้วลบ bundle
        bundle ที่ยังเหลือไฟล์ validation (ย้ายไม่ได้) ไม่ถูกลบ: ไฟล์เหล่านี้คือหลักฐานความแม่นยำ ห้ามหาย
        จบแล้วลบโฟลเดอร์ ephem/, access/<facility>/ และ access/ ที่ว่าง"""
        sources = sorted((f for b in bundles if b.parent == scenario_dir / EPHEM_DIR for f in _validation_files(b)),
                         key=lambda f: f.stat().st_mtime, reverse=True)
        for src in sources:
            try:
                self._archive(name, src)
            except OSError as exc:
                self.logger.error("ตัวตั้งเวลา: ย้าย %s ไปเก็บไม่ได้ จะไม่ลบ bundle นั้น: %s", src, exc)
        removed = 0
        for bundle in bundles:
            if _validation_files(bundle):
                continue
            try:
                shutil.rmtree(bundle)
                removed += 1
            except OSError as exc:
                self.logger.error("ตัวตั้งเวลา: ลบ %s ไม่สำเร็จ: %s", bundle, exc)
        for folder in [*_subdirs(scenario_dir / ACCESS_DIR), scenario_dir / ACCESS_DIR, scenario_dir / EPHEM_DIR]:
            if folder.is_dir() and not folder.is_symlink():
                try:
                    folder.rmdir()                       # ลบเฉพาะโฟลเดอร์ว่าง
                except OSError:
                    pass
        if removed:
            self.logger.info("ตัวตั้งเวลา: ลบผลเก่า %d โฟลเดอร์ของ %s (เก่ากว่า %d วัน)", removed, name, daily.retention_days)

    def _archive(self, name: str, src: Path) -> Path:
        """ย้ายไฟล์ไปชื่อแรกที่ยังว่างตาม `_archive_targets` ไม่ทับไฟล์ใด ไม่มีชื่อว่างหรือย้ายไม่ได้ -> OSError"""
        dest = self.data_dir / VALIDATION_DIR / name
        for target in _archive_targets(dest, src):
            if not os.path.lexists(target):
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(src, target)
                return target
        raise OSError(f"ไม่มีชื่อว่างสำหรับเก็บ {src.name} ใต้ {dest}")

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
        """เริ่ม thread (เรียกซ้ำไม่มีผล) tick แรกทันที thread เดิมที่ stop แล้วแต่ยังไม่จบ (join หมดเวลา): ไม่เริ่ม loop ที่สองซ้อน"""
        if self._thread is not None:
            if self._thread.is_alive():
                if self._stop.is_set():
                    self.logger.warning("thread เดิมของตัวตั้งเวลายังไม่จบ ยังเริ่มใหม่ไม่ได้")
                return
            self._thread = None
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
            if self._thread.is_alive():                  # เก็บไว้: start() จะไม่เริ่ม loop ที่สองจนกว่าตัวนี้จะจบ
                self.logger.warning("thread ของตัวตั้งเวลาไม่จบภายใน %.0f วินาที", timeout)
                return
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
