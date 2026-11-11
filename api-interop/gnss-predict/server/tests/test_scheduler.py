"""งานประจำวัน (หัวข้อ 9 ของ spec server; ข้อ P7): `Scheduler.tick(now)` ด้วยนาฬิกาจำลอง และ `daily.run_daily`

- ไม่ใช้เน็ตเด็ดขาด: `studio.fetch_snapshot` และ `studio.run_validate` ถูกแทนในทุก test (fixture `no_network`)
  fetch ปลอมคัดลอก snapshot ของ test ไปเป็น snapshot ใหม่ GMAT เป็นของปลอม (`fake_gmat` ของ conftest)
- JobManager ใช้ InlineRunner และนาฬิกาเดียวกับตัวตั้งเวลา job ที่ tick สั่งรันใน thread ของคิว test รอจนจบเอง (มีขอบเวลา)
- ไม่เริ่ม thread ของตัวตั้งเวลาจริง ยกเว้น test ของ thread เองที่ใช้คาบสั้นและนาฬิกาจำลอง
"""

import json
import logging
import os
import re
import shutil
import threading
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest

from conftest import SNAPSHOT_ID, SNAPSHOT_SRC
from gnss_predict import studio
from gnss_predict.errors import GmatRunError, GnssPredictError, Message, Sp3UnavailableError, TleUnavailableError

from gnss_studio_server import daily as daily_module
from gnss_studio_server import scheduler as scheduler_module
from gnss_studio_server.events import EventBus
from gnss_studio_server.jobs import InlineRunner, JobManager
from gnss_studio_server.scheduler import Scheduler
from gnss_studio_server.settings import Daily, Settings, save as save_settings
from gnss_studio_server.store import ScenarioStore
from gnss_studio_server.templates import new_scenario

TIMEOUT = 10.0
FINISHED = ("succeeded", "failed", "cancelled")
ISO_Z_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$")


def T(text: str) -> datetime:
    return datetime.fromisoformat(text.replace("Z", "+00:00"))


# ---------- เครื่องมือ ----------

class FakeClock:
    def __init__(self, t: datetime):
        self.t = t

    def __call__(self) -> datetime:
        return self.t


class RecordingBus(EventBus):
    """EventBus ที่จำทุก event (ไม่ต้องมี event loop)"""

    def __init__(self):
        super().__init__()
        self.events: list[tuple[str, dict]] = []
        self._rec_lock = threading.Lock()

    def publish(self, event: str, data: dict) -> None:
        with self._rec_lock:
            self.events.append((event, data))
        super().publish(event, data)

    def of(self, event: str) -> list[dict]:
        with self._rec_lock:
            return [d for e, d in self.events if e == event]

    def messages(self, code: str) -> list[dict]:
        return [m for m in self.of("message") if m["code"] == code]


class FakeFetch:
    """แทน studio.fetch_snapshot: คัดลอก snapshot ของ test ไปที่ data/orbits/<now:%Y%m%dT%H%MZ> (ไม่ใช้เน็ต)

    empty=True: สร้าง snapshot เปล่า (ไม่มีไฟล์ OMM) raises: raise แทน"""

    def __init__(self):
        self.calls: list[dict] = []
        self.raises: BaseException | None = None
        self.empty = False

    def __call__(self, data_dir, now, systems="GREC", progress=None, **kw):
        self.calls.append({"now": now, "systems": systems})
        if self.raises is not None:
            raise self.raises
        report = progress or (lambda stage, fraction: None)
        report("omm", 0.0)
        dest = Path(data_dir) / "orbits" / now.astimezone(timezone.utc).strftime("%Y%m%dT%H%MZ")
        if self.empty:
            dest.mkdir(parents=True, exist_ok=True)
        else:
            shutil.copytree(SNAPSHOT_SRC, dest, dirs_exist_ok=True)
        report("done", 1.0)
        return dest, [Message("OMM_FROM_CACHE", "info", "ใช้ข้อมูลวงโคจรจาก cache (test)")]


class FakeValidate:
    """แทน studio.run_validate: mode "truth" = ยังไม่มี SP3 จริง (TRUTH_UNAVAILABLE) mode "ok" = เขียน validation_<day>.json
    ลง ephem bundle ที่ current (hash จาก plan_propagate)"""

    def __init__(self):
        self.calls: list[tuple[str, str]] = []
        self.mode = "truth"

    def __call__(self, scenario_dir, day, data_dir, sp3=None, facility=None, console=None, progress=None,
                 on_gmat_start=None):
        self.calls.append((Path(scenario_dir).name, day.isoformat()))
        if self.mode == "truth":
            raise Sp3UnavailableError(f"ยังไม่มี SP3 ของ MGEX สำหรับวันที่ {day.isoformat()} (test)")
        bundle = Path(scenario_dir) / "ephem" / studio.plan_propagate(scenario_dir, data_dir).hash
        bundle.mkdir(parents=True, exist_ok=True)
        (bundle / f"validation_{day.isoformat()}.json").write_text("{}")
        return bundle, []


class FakeDaily:
    """แทน daily.run_daily ใน test กติกาของ tick: ไม่ fetch ไม่ propagate คืนผลตามรูปแบบจริง
    block=True รอ release (มีขอบเวลา) ก่อนจบ raises: raise แทน"""

    def __init__(self, block: bool = False):
        self.calls: list[date] = []
        self.raises: BaseException | None = None
        self.release = threading.Event()
        self.entered = threading.Event()
        if not block:
            self.release.set()

    def __call__(self, data_dir, for_date, settings, now, progress=None, *, console=None, on_gmat_start=None):
        self.calls.append(for_date)
        self.entered.set()
        assert self.release.wait(TIMEOUT), "test ไม่ปล่อย FakeDaily"
        if self.raises is not None:
            raise self.raises
        return {"path": Path(data_dir) / "daily" / f"thbk_gnss_pred_{for_date:%Y%m%d}_24h.csv",
                "scenario": f"daily_{for_date:%Y%m%d}", "messages": []}


def _raise(exc):
    def fn(*args, **kw):
        raise exc
    return fn


def wait_until(pred, timeout: float = TIMEOUT, what: str = "เงื่อนไข"):
    deadline = time.monotonic() + timeout
    while not pred():
        assert time.monotonic() < deadline, f"รอ {what} เกิน {timeout} วินาที"
        time.sleep(0.005)


def wait_done(jobs: JobManager, job_id: str):
    wait_until(lambda: jobs.get(job_id).state in FINISHED, what=f"job {job_id} จบ")
    return jobs.get(job_id)


def write_job(data_dir: Path, **fields) -> dict:
    """บันทึก job บนดิสก์เหมือนที่ server รุ่นก่อนทิ้งไว้ (อ่านเข้าด้วย jobs.recover())"""
    rec = {"id": "j-20261111T210000-0001", "kind": "daily", "scenario": None, "params": {}, "state": "succeeded",
           "progress": None, "messages": [], "result": None, "error": None, "created_utc": "2026-11-11T21:00:00.000Z",
           "started_utc": None, "finished_utc": None, "origin": "scheduler", "gmat_pgid": None, **fields}
    path = data_dir / "jobs" / f"{rec['id']}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(rec))
    return rec


def make_scenario(data_dir: Path, name: str, day: str, daily: bool = True, description: str = "") -> Path:
    """scenario จากแม่แบบ thbk-gnss ช่วง 24 ชม. ของ day (snapshot ของ test) daily=True ใส่ช่อง daily แบบงานประจำวัน"""
    d = date.fromisoformat(day)
    doc = new_scenario(name, f"{day}T00:00:00Z", f"{d + timedelta(days=1)}T00:00:00Z", "thbk-gnss", SNAPSHOT_ID, data_dir)
    doc["description"] = description
    if daily:
        doc["daily"] = {"for_date": day, "created_utc": f"{d - timedelta(days=1)}T21:00:00Z"}
    ScenarioStore(data_dir).create(name, doc)
    return data_dir / "scenarios" / name


def make_daily(data_dir: Path, day: str, **kw) -> Path:
    return make_scenario(data_dir, f"daily_{date.fromisoformat(day):%Y%m%d}", day, **kw)


def state_file(data_dir: Path) -> Path:
    return data_dir / "daily" / "state.json"


def write_state(data_dir: Path, last_attempt: str | None, given_up=()) -> None:
    path = state_file(data_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"last_validation_attempt_utc": last_attempt,
                                "given_up": [{"scenario": s, "day": d} for s, d in given_up]}))


def disable(data_dir: Path) -> None:
    save_settings(data_dir, Settings(daily=Daily(enabled=False)))


# ---------- fixture ----------

@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    """ทุก test ในไฟล์นี้: ห้ามดึงข้อมูลจริง (fetch และ validate ถูกแทนด้วยของปลอม)"""
    fetch, validate = FakeFetch(), FakeValidate()
    monkeypatch.setattr(studio, "fetch_snapshot", fetch)
    monkeypatch.setattr(studio, "run_validate", validate)
    monkeypatch.setattr(studio, "propagate", _raise(AssertionError("ห้ามรัน GMAT จริงใน test (ใช้ fake_gmat)")))
    return fetch, validate


@pytest.fixture
def fetch(no_network) -> FakeFetch:
    return no_network[0]


@pytest.fixture
def validate(no_network) -> FakeValidate:
    return no_network[1]


@pytest.fixture
def clock():
    return FakeClock(T("2026-11-11T12:00Z"))


@pytest.fixture
def bus():
    return RecordingBus()


@pytest.fixture
def jobs(data_dir, bus, clock):
    mgr = JobManager(data_dir, bus, runner=InlineRunner(), clock=clock)
    mgr.start()
    yield mgr
    mgr.stop()


@pytest.fixture
def sched(data_dir, jobs, bus, clock):
    return Scheduler(data_dir, jobs, bus=bus, clock=clock)


@pytest.fixture
def at(sched, jobs, clock):
    """ตั้งนาฬิกาแล้ว tick คืน id ที่สั่ง และรอให้ job พวกนั้นจบ (wait=False ไม่รอ)"""
    def tick(text: str, wait: bool = True) -> list[str]:
        clock.t = T(text)
        ids = sched.tick(clock.t)
        if wait:
            for job_id in ids:
                wait_done(jobs, job_id)
        return ids
    return tick


@pytest.fixture
def quick_daily(monkeypatch) -> FakeDaily:
    fake = FakeDaily()
    monkeypatch.setattr(daily_module, "run_daily", fake)
    return fake


# ---------- พยากรณ์: เวลาและกติกาการสั่ง ----------

def test_runs_at_2100(sched, at, jobs, quick_daily):
    assert sched.tick(T("2026-11-11T20:59Z")) == []
    ids = at("2026-11-11T21:00Z")
    assert len(ids) == 1
    j = jobs.get(ids[0])
    assert (j.kind, j.scenario, j.params, j.origin) == ("daily", None, {"for_date": "2026-11-12"}, "scheduler")
    assert j.state == "succeeded"
    assert j.result == {"path": "daily/thbk_gnss_pred_20261112_24h.csv", "scenario": "daily_20261112"}
    assert quick_daily.calls == [date(2026, 11, 12)]


def test_no_second_run_same_day(at, jobs, quick_daily):
    assert len(at("2026-11-11T21:00Z")) == 1
    assert at("2026-11-11T21:05Z") == []
    assert at("2026-11-11T23:59Z") == []
    assert at("2026-11-12T20:59Z") == []
    nxt = at("2026-11-12T21:00Z")                                  # วันถัดไป: D เลื่อนเป็น 13
    assert len(nxt) == 1 and jobs.get(nxt[0]).params == {"for_date": "2026-11-13"}
    assert quick_daily.calls == [date(2026, 11, 12), date(2026, 11, 13)]


def test_missed_run_after_interrupted_daily(sched, data_dir, jobs, quick_daily):          # Review Focus 4
    write_job(data_dir, kind="daily", params={"for_date": "2026-11-12"}, state="running",
              started_utc="2026-11-11T21:00:01.000Z")
    jobs.recover()
    old = jobs.get("j-20261111T210000-0001")
    assert old.state == "failed" and old.error["code"] == "INTERRUPTED"
    ids = sched.tick(T("2026-11-11T23:30Z"))
    assert len(ids) == 1
    new = wait_done(jobs, ids[0])
    assert new.params == {"for_date": "2026-11-12"} and new.state == "succeeded" and new.origin == "scheduler"
    assert sched.tick(T("2026-11-11T23:31Z")) == []                # สำเร็จแล้ว: ไม่รันซ้ำ


def test_restart_after_successful_daily_does_not_rerun(sched, data_dir, jobs, quick_daily):  # Review Focus 4
    write_job(data_dir, kind="daily", params={"for_date": "2026-11-12"}, state="succeeded",
              started_utc="2026-11-11T21:00:01.000Z", finished_utc="2026-11-11T21:04:00.000Z",
              result={"path": "daily/thbk_gnss_pred_20261112_24h.csv", "scenario": "daily_20261112"})
    jobs.recover()
    assert sched.tick(T("2026-11-11T23:30Z")) == []
    assert quick_daily.calls == []


def test_missed_run_runs_when_server_starts_late(at, jobs, quick_daily):
    ids = at("2026-11-11T23:45Z")                                  # เปิด server หลัง 21:00 โดยไม่เคยรันของ D
    assert len(ids) == 1 and jobs.get(ids[0]).params == {"for_date": "2026-11-12"}


def test_failed_daily_is_not_resubmitted(at, jobs, bus, quick_daily):
    quick_daily.raises = GmatRunError("GMAT ทำงานไม่สำเร็จ (test)")
    ids = at("2026-11-11T21:00Z")
    j = jobs.get(ids[0])
    assert j.state == "failed" and j.error["code"] == "GMAT_FAILED"
    errors = [m for m in bus.messages("GMAT_FAILED") if m["level"] == "error"]
    assert errors, "ความล้มเหลวของงานประจำวันต้องมีข้อความระดับ error"
    assert at("2026-11-11T21:01Z") == []                           # รอรอบวันถัดไป ไม่สั่งซ้ำทุกนาที
    assert at("2026-11-11T23:59Z") == []
    assert quick_daily.calls == [date(2026, 11, 12)]
    quick_daily.raises = None
    nxt = at("2026-11-12T21:00Z")
    assert len(nxt) == 1 and jobs.get(nxt[0]).params == {"for_date": "2026-11-13"}


def test_existing_csv_skips_forecast(at, data_dir, quick_daily):
    out = data_dir / "daily" / "thbk_gnss_pred_20261112_24h.csv"
    out.parent.mkdir(parents=True)
    out.write_text("ทำไว้แล้ว\n")
    assert at("2026-11-11T21:00Z") == []
    assert quick_daily.calls == []


def test_queued_daily_is_not_duplicated(data_dir, bus, clock):
    idle = JobManager(data_dir, bus, runner=InlineRunner(), clock=clock)        # ไม่เริ่มคิว: job ค้าง queued
    sched = Scheduler(data_dir, idle, bus=bus, clock=clock)
    first = sched.tick(T("2026-11-11T21:00Z"))
    assert len(first) == 1 and idle.get(first[0]).state == "queued"
    assert sched.tick(T("2026-11-11T21:01Z")) == []
    assert len(idle.list()) == 1


def test_cancelled_daily_is_not_resubmitted(data_dir, bus, clock):
    idle = JobManager(data_dir, bus, runner=InlineRunner(), clock=clock)
    sched = Scheduler(data_dir, idle, bus=bus, clock=clock)
    (job_id,) = sched.tick(T("2026-11-11T21:00Z"))
    assert idle.cancel(job_id).state == "cancelled"                 # Stop บนแถบสถานะ: ผู้ใช้ไม่ต้องการรอบนี้
    assert sched.tick(T("2026-11-11T21:01Z")) == []


def test_run_at_and_enabled_are_reread_every_tick(at, data_dir, jobs, quick_daily):
    disable(data_dir)
    assert at("2026-11-11T21:00Z") == []
    save_settings(data_dir, Settings(daily=Daily(enabled=True, run_at_utc="22:30")))
    assert at("2026-11-11T22:29Z") == []
    ids = at("2026-11-11T22:30Z")
    assert len(ids) == 1 and jobs.get(ids[0]).params == {"for_date": "2026-11-12"}


# ---------- ปิดงานประจำวัน ----------

@pytest.mark.parametrize("settings_bytes", [None, b"{not json", b'{"daily": {}}'])
def test_disabled_does_nothing(sched, at, data_dir, jobs, quick_daily, validate, snapshot, settings_bytes):
    if settings_bytes is None:
        disable(data_dir)
    else:                                                          # ไฟล์ค่าตั้งเสียหรือไม่ยืนยัน enabled = fail safe ปิด
        (data_dir / "settings.json").write_bytes(settings_bytes)
    sc = make_daily(data_dir, "2026-11-12")                       # ทั้งรอตรวจย้อนหลังและเก่าพอให้ลบผลได้
    (sc / "ephem" / "abc123").mkdir(parents=True)
    (sc / "ephem" / "abc123" / "predicted.sp3").write_text("x")
    for when in ("2026-11-11T21:00Z", "2026-11-13T06:00Z", "2026-11-30T21:00Z", "2027-01-30T21:00Z"):
        assert at(when) == []
    assert jobs.list() == [] and quick_daily.calls == [] and validate.calls == []
    assert (sc / "ephem" / "abc123" / "predicted.sp3").is_file()
    assert not (data_dir / "daily").exists() and not (data_dir / "validation").exists()


# ---------- run_daily ----------

def _legacy_csv(data_dir: Path, scenario: str, facility: str = "THBK") -> Path:
    sc = data_dir / "scenarios" / scenario
    return sc / "access" / facility / studio.plan_analyze(sc, facility, data_dir) / "legacy_gps.csv"


def test_daily_outputs(sched, at, data_dir, jobs, bus, fetch, fake_gmat):
    ids = at("2026-11-11T21:00Z")
    j = jobs.get(ids[0])
    assert j.state == "succeeded", j.error
    assert j.result == {"path": "daily/thbk_gnss_pred_20261112_24h.csv", "scenario": "daily_20261112"}
    assert len(fetch.calls) == 1 and fetch.calls[0]["systems"] == "GREC"

    doc, _ = ScenarioStore(data_dir).read("daily_20261112")
    assert doc["daily"]["for_date"] == "2026-11-12" and ISO_Z_RE.match(doc["daily"]["created_utc"])
    assert doc["analysis_period"] == {"start": "2026-11-12T00:00:00Z", "stop": "2026-11-13T00:00:00Z"}
    snapshots = sorted(p.name for p in (data_dir / "orbits").iterdir())
    assert doc["orbit_snapshot"] in snapshots                     # snapshot ที่เพิ่งดึง
    assert [o["name"] for o in doc["objects"] if o["class"] == "Facility"] == ["THBK"]

    legacy = _legacy_csv(data_dir, "daily_20261112").read_bytes()
    assert legacy.startswith(b"DAY,Time,PRN,Az,El") and legacy.count(b"\n") > 1      # มีแถวข้อมูลจริง
    assert (data_dir / "daily" / "thbk_gnss_pred_20261112_24h.csv").read_bytes() == legacy
    assert (data_dir / "daily" / "latest.csv").read_bytes() == legacy
    assert not list((data_dir / "daily").glob("*.tmp*")), "ไฟล์ชั่วคราวต้องไม่ค้าง"

    codes = [m["code"] for m in j.messages]
    assert "OMM_FROM_CACHE" in codes and codes[-1] == "DAILY_PUBLISHED"     # ข้อความของ engine ส่งผ่าน + ข้อความผลลัพธ์
    assert bus.messages("DAILY_PUBLISHED")[0]["level"] == "info"
    assert j.progress == {"stage": "done", "fraction": 1.0}
    assert at("2026-11-11T21:05Z") == []


def test_daily_overwrites_existing_scenario(at, data_dir, jobs, snapshot, fake_gmat):
    make_daily(data_dir, "2026-11-12", description="ของเก่า")
    (job_id,) = at("2026-11-11T21:00Z")
    assert jobs.get(job_id).state == "succeeded"
    doc, _ = ScenarioStore(data_dir).read("daily_20261112")
    assert doc["description"] == "" and doc["orbit_snapshot"] != SNAPSHOT_ID
    assert doc["daily"]["created_utc"] != "2026-11-11T21:00:00Z"


def test_run_daily_reports_stages_and_uses_settings(data_dir, fetch, fake_gmat, monkeypatch):
    seen = []
    real_analyze = studio.run_analyze

    def spy_analyze(scenario_dir, facility, *args, **kw):
        seen.append(facility)
        return real_analyze(scenario_dir, facility, *args, **kw)

    monkeypatch.setattr(studio, "run_analyze", spy_analyze)
    stages: list[tuple[str, float]] = []
    out = daily_module.run_daily(data_dir, date(2026, 11, 12), Settings(), T("2026-11-11T21:00:41Z"),
                                 lambda stage, fraction: stages.append((stage, fraction)))
    assert out["path"] == data_dir / "daily" / "thbk_gnss_pred_20261112_24h.csv" and out["path"].is_file()
    assert out["scenario"] == "daily_20261112"
    assert all(isinstance(m, Message) for m in out["messages"])
    assert seen == ["THBK"]
    assert fetch.calls[0]["now"] == T("2026-11-11T21:00:41Z")
    doc, _ = ScenarioStore(data_dir).read("daily_20261112")
    assert doc["daily"] == {"for_date": "2026-11-12", "created_utc": "2026-11-11T21:00:41Z"}
    assert doc["orbit_snapshot"] == "20261111T2100Z"

    order = []
    for stage, _ in stages:
        head = stage.split(".")[0]
        if not order or order[-1] != head:
            order.append(head)
    assert order == ["fetch", "scenario", "propagate", "analyze", "publish", "done"]
    fractions = [f for _, f in stages]
    assert fractions == sorted(fractions) and stages[-1] == ("done", 1.0)
    assert any(stage.endswith(".gmat") for stage, _ in stages)                  # worker รู้ว่า GMAT ทำงานอยู่ (ยกเลิกได้)


@pytest.mark.parametrize("case, code", [
    ("fetch", "ORBIT_SOURCE_UNAVAILABLE"),
    ("empty_snapshot", "ORBIT_SOURCE_UNAVAILABLE"),                # ApiError ของแม่แบบ: คงรหัสไว้ ไม่ใช่ INTERNAL
    ("gmat", "GMAT_FAILED"),
    ("facility", "SCENARIO_INVALID"),
])
def test_run_daily_fails_with_the_step_code(data_dir, fetch, fake_gmat, monkeypatch, case, code):
    settings = Settings()
    if case == "fetch":
        fetch.raises = TleUnavailableError("ดึง OMM ไม่ได้ (test)")
    elif case == "empty_snapshot":
        fetch.empty = True
    elif case == "gmat":
        monkeypatch.setattr(studio, "propagate", _raise(GmatRunError("GMAT ล้มเหลว (test)")))
    else:
        settings = Settings(daily=Daily(facility="NOPE"))
    with pytest.raises(GnssPredictError) as e:
        daily_module.run_daily(data_dir, date(2026, 11, 12), settings, T("2026-11-11T21:00Z"), None)
    assert e.value.code == code and str(e.value)
    assert not (data_dir / "daily").exists(), "ล้มเหลวแล้วต้องไม่มีไฟล์ CSV"
    if case in ("fetch", "empty_snapshot"):
        assert not (data_dir / "scenarios" / "daily_20261112").exists()


def test_daily_job_failure_keeps_engine_code(at, jobs, fetch, fake_gmat):
    fetch.empty = True
    (job_id,) = at("2026-11-11T21:00Z")
    j = jobs.get(job_id)
    assert j.state == "failed" and j.error["code"] == "ORBIT_SOURCE_UNAVAILABLE" and j.error["text"]


# ---------- ตรวจย้อนหลัง ----------

def test_validation_retry_then_give_up(at, data_dir, jobs, bus, clock, validate, snapshot):
    make_daily(data_dir, "2026-11-12")
    assert at("2026-11-12T06:00Z") == []                           # ยังไม่ผ่านไปหนึ่งวัน
    (first,) = at("2026-11-13T06:00Z")
    j = jobs.get(first)
    assert (j.kind, j.scenario, j.params, j.origin) == ("validate", "daily_20261112", {"day": "2026-11-12"}, "scheduler")
    assert j.state == "failed" and j.error["code"] == "TRUTH_UNAVAILABLE"
    assert json.loads(state_file(data_dir).read_text())["last_validation_attempt_utc"] == "2026-11-13T06:00:00Z"
    assert at("2026-11-13T07:00Z") == []
    assert at("2026-11-13T08:59Z") == []                           # ยังไม่ครบ 3 ชม. จากครั้งก่อน
    assert len(at("2026-11-13T09:00Z")) == 1
    assert len(at("2026-11-25T20:00Z")) == 1                       # ยังไม่เกิน 14 วันหลัง for_date
    assert bus.messages("VALIDATION_GAVE_UP") == []

    assert at("2026-11-26T02:00Z") == []                           # เกิน 14 วันแล้ว และครั้งล่าสุดได้ TRUTH_UNAVAILABLE
    (gave_up,) = bus.messages("VALIDATION_GAVE_UP")
    assert gave_up["level"] == "warning" and gave_up["object"] == "scenarios/daily_20261112"
    assert "2026-11-12" in gave_up["text"]
    state = json.loads(state_file(data_dir).read_text())
    assert {"scenario": "daily_20261112", "day": "2026-11-12"} in state["given_up"]
    calls = len(validate.calls)
    assert at("2026-11-26T06:00Z") == [] and at("2026-12-01T06:00Z") == []
    assert len(validate.calls) == calls and len(bus.messages("VALIDATION_GAVE_UP")) == 1

    restarted = Scheduler(data_dir, jobs, bus=bus, clock=clock)    # เปิด server ใหม่: การเลิกยังอยู่ใน state.json
    assert restarted.tick(T("2026-12-02T06:00Z")) == []
    assert len(bus.messages("VALIDATION_GAVE_UP")) == 1 and len(validate.calls) == calls


def test_validation_starts_when_a_day_becomes_eligible(at, data_dir, jobs, validate, snapshot, quick_daily):
    make_daily(data_dir, "2026-11-12")
    at("2026-11-12T23:00Z")                                        # รอบนี้ไม่มีวันที่ตรวจได้: ไม่นับเป็นการลอง
    assert not state_file(data_dir).exists()
    ids = at("2026-11-13T00:30Z")                                  # ผ่านเที่ยงคืน: ตรวจทันที ไม่ต้องรอ 3 ชม. จากรอบที่ว่าง
    assert [jobs.get(i).kind for i in ids] == ["validate"]
    assert validate.calls == [("daily_20261112", "2026-11-12")]


def test_validation_interval_survives_restart(at, data_dir, jobs, bus, clock, validate, snapshot):
    make_daily(data_dir, "2026-11-12")
    assert len(at("2026-11-13T06:00Z")) == 1
    restarted = Scheduler(data_dir, jobs, bus=bus, clock=clock)
    assert restarted.tick(T("2026-11-13T07:00Z")) == []
    assert len(restarted.tick(T("2026-11-13T09:00Z"))) == 1


def test_validation_stops_once_the_file_exists(at, data_dir, jobs, validate, snapshot):
    make_daily(data_dir, "2026-11-12")
    validate.mode = "ok"
    (job_id,) = at("2026-11-13T06:00Z")
    assert jobs.get(job_id).state == "succeeded"
    assert at("2026-11-13T09:00Z") == [] and at("2026-11-14T09:00Z") == []
    assert validate.calls == [("daily_20261112", "2026-11-12")]


def test_validation_counts_archived_file_and_skips_other_scenarios(at, data_dir, validate, snapshot):
    make_daily(data_dir, "2026-11-12")
    archived = data_dir / "validation" / "daily_20261112" / "validation_2026-11-12.json"
    archived.parent.mkdir(parents=True)
    archived.write_text("{}")
    make_scenario(data_dir, "S1", "2026-11-12", daily=False)       # ไม่ใช่ scenario รายวัน: ไม่ตรวจเอง
    make_daily(data_dir, "2026-11-13")                             # for_date ยังไม่ผ่านไปหนึ่งวัน
    assert at("2026-11-13T20:00Z") == []
    assert validate.calls == []


def test_validation_waits_for_active_job(data_dir, bus, clock, snapshot):
    idle = JobManager(data_dir, bus, runner=InlineRunner(), clock=clock)
    sched = Scheduler(data_dir, idle, bus=bus, clock=clock)
    make_daily(data_dir, "2026-11-12")
    (job_id,) = sched.tick(T("2026-11-13T06:00Z"))
    assert idle.get(job_id).state == "queued"
    assert sched.tick(T("2026-11-13T09:30Z")) == []                # ครบรอบแล้วแต่ job ของวันนั้นยังรออยู่
    assert len(idle.list()) == 1


def test_corrupt_state_file_is_treated_as_empty(at, data_dir, validate, snapshot, caplog):
    make_daily(data_dir, "2026-11-12")
    state_file(data_dir).parent.mkdir(parents=True)
    state_file(data_dir).write_bytes(b"{not json")
    with caplog.at_level(logging.WARNING):
        assert len(at("2026-11-13T06:00Z")) == 1
    assert "state.json" in caplog.text
    assert json.loads(state_file(data_dir).read_text())["last_validation_attempt_utc"] == "2026-11-13T06:00:00Z"


# ---------- เก็บรักษา ----------

def _bundle(sc: Path, rel: str, files: dict[str, str], mtime: float | None = None) -> Path:
    folder = sc / rel
    folder.mkdir(parents=True, exist_ok=True)
    for name, text in files.items():
        (folder / name).write_text(text)
        if mtime is not None:
            os.utime(folder / name, (mtime, mtime))
    return folder


def test_retention_keeps_validation(at, data_dir, snapshot):
    old = make_daily(data_dir, "2026-11-12")
    recent = make_daily(data_dir, "2026-11-25")
    plain = make_scenario(data_dir, "S1", "2026-11-12", daily=False)
    now = time.time()
    _bundle(old, "ephem/aaa111", {"predicted.sp3": "sp3", "manifest.json": "{}",
                                  "validation_2026-11-12.json": '{"v": "new"}', "validation_2026-11-12.md": "# new",
                                  "validation_2026-11-12.json.tmp-99": "partial"}, mtime=now)
    _bundle(old, "ephem/bbb222", {"validation_2026-11-12.json": '{"v": "older"}'}, mtime=now - 3600)
    _bundle(old, "access/THBK/ccc333", {"legacy_gps.csv": "x"})
    for sc in (recent, plain):
        _bundle(sc, "ephem/ddd444", {"predicted.sp3": "sp3"})
        _bundle(sc, "access/THBK/eee555", {"legacy_gps.csv": "x"})
    published = data_dir / "daily" / "thbk_gnss_pred_20261112_24h.csv"
    published.parent.mkdir(parents=True)
    published.write_text("csv")
    write_state(data_dir, "2026-12-20T05:00:00Z")                 # ตรวจย้อนหลังยังไม่ถึงรอบ (test นี้ดูแค่การเก็บรักษา)

    assert at("2026-12-20T06:00Z") == []                           # เก่ากว่า 30 วัน: 2026-11-12 < 2026-11-20
    assert not (old / "ephem").exists() and not (old / "access").exists()
    assert (old / "scenario.json").is_file()
    kept = data_dir / "validation" / "daily_20261112"
    assert json.loads((kept / "validation_2026-11-12.json").read_text()) == {"v": "new"}
    assert (kept / "validation_2026-11-12.md").read_text() == "# new"
    assert json.loads((kept / "bbb222" / "validation_2026-11-12.json").read_text()) == {"v": "older"}  # ไม่ทับกัน
    assert not list(kept.rglob("*.tmp*"))
    assert published.read_text() == "csv"
    for sc in (recent, plain):                                     # ยังไม่เก่า / ไม่ใช่ scenario รายวัน: ไม่แตะ
        assert (sc / "ephem" / "ddd444" / "predicted.sp3").is_file()
        assert (sc / "access" / "THBK" / "eee555" / "legacy_gps.csv").is_file()


def test_retention_does_not_overwrite_archived_file(at, data_dir, snapshot):
    old = make_daily(data_dir, "2026-11-12")
    _bundle(old, "ephem/aaa111", {"validation_2026-11-12.json": '{"v": "bundle"}'})
    kept = data_dir / "validation" / "daily_20261112"
    kept.mkdir(parents=True)
    (kept / "validation_2026-11-12.json").write_text('{"v": "archived"}')
    write_state(data_dir, "2026-12-20T05:00:00Z")
    assert at("2026-12-20T06:00Z") == []
    assert json.loads((kept / "validation_2026-11-12.json").read_text()) == {"v": "archived"}
    assert json.loads((kept / "aaa111" / "validation_2026-11-12.json").read_text()) == {"v": "bundle"}
    assert not (old / "ephem").exists()


def test_retention_skips_scenario_with_active_job(data_dir, bus, clock, snapshot, caplog):
    idle = JobManager(data_dir, bus, runner=InlineRunner(), clock=clock)
    sched = Scheduler(data_dir, idle, bus=bus, clock=clock)
    old = make_daily(data_dir, "2026-11-12")
    _bundle(old, "ephem/aaa111", {"predicted.sp3": "sp3"})
    write_state(data_dir, "2026-12-20T05:00:00Z")
    job = idle.submit("propagate", "daily_20261112", {})
    with caplog.at_level(logging.INFO):
        assert sched.tick(T("2026-12-20T06:00Z")) == []
    assert (old / "ephem" / "aaa111" / "predicted.sp3").is_file()
    assert "daily_20261112" in caplog.text
    idle.cancel(job.id)
    assert sched.tick(T("2026-12-20T06:01Z")) == []
    assert not (old / "ephem").exists()


def test_retention_never_follows_symlinks(at, data_dir, tmp_path, snapshot):
    outside = tmp_path / "outside"
    _bundle(outside, "bundle", {"validation_2026-11-12.json": "{}", "keep.txt": "x"})
    linked = make_daily(data_dir, "2026-11-12")
    (linked / "ephem").symlink_to(outside, target_is_directory=True)            # ephem/ ทั้งโฟลเดอร์ชี้ออกนอก data/
    inner = make_daily(data_dir, "2026-11-13")
    _bundle(inner, "ephem/aaa111", {"predicted.sp3": "sp3"})
    (inner / "ephem" / "bbb222").symlink_to(outside / "bundle", target_is_directory=True)   # bundle เดียวที่ชี้ออกนอก
    write_state(data_dir, "2026-12-20T05:00:00Z")
    assert at("2026-12-20T06:00Z") == []
    assert (outside / "bundle" / "validation_2026-11-12.json").is_file() and (outside / "bundle" / "keep.txt").is_file()
    assert (linked / "ephem").is_symlink()                         # ไม่ลบผ่าน symlink
    assert not (inner / "ephem").exists()                          # ลบได้ แต่ไม่ย้ายไฟล์จาก bundle ที่ชี้ออกนอก
    assert not (data_dir / "validation" / "daily_20261113").exists()


# ---------- prune, สถานะ และ health ----------

def test_prune_runs_once_per_utc_day(at, jobs, monkeypatch):
    calls = []
    monkeypatch.setattr(jobs, "prune", lambda now: calls.append(now))
    disable(jobs.data_dir)                                         # prune เป็นงานของคิว job ทำแม้ปิดงานประจำวัน
    at("2026-11-11T06:00Z")
    at("2026-11-11T07:00Z")
    at("2026-11-11T23:59Z")
    at("2026-11-12T00:00Z")
    assert calls == [T("2026-11-11T06:00Z"), T("2026-11-12T00:00Z")]


def test_daily_status_event_follows_latest_daily_job(sched, jobs, bus, clock, monkeypatch):
    fake = FakeDaily(block=True)
    monkeypatch.setattr(daily_module, "run_daily", fake)
    clock.t = T("2026-11-11T20:00Z")
    assert sched.tick(clock.t) == []
    assert bus.of("daily") == [{"state": "idle", "last_run_utc": None, "next_run_utc": "2026-11-11T21:00:00Z",
                                "for_date": None}]
    sched.tick(T("2026-11-11T20:30Z"))
    assert len(bus.of("daily")) == 1                              # สถานะไม่เปลี่ยน: ไม่ส่งซ้ำ

    clock.t = T("2026-11-11T21:00Z")
    (job_id,) = sched.tick(clock.t)
    running = bus.of("daily")[-1]
    assert running["state"] == "running" and running["for_date"] == "2026-11-12"
    assert running["next_run_utc"] == "2026-11-12T21:00:00Z"
    fake.release.set()
    j = wait_done(jobs, job_id)
    clock.t = T("2026-11-11T21:01Z")
    sched.tick(clock.t)
    assert bus.of("daily")[-1] == {"state": "ok", "last_run_utc": j.started_utc,
                                   "next_run_utc": "2026-11-12T21:00:00Z", "for_date": "2026-11-12"}
    assert sched.status(T("2026-11-11T21:01Z")) == bus.of("daily")[-1]


def test_daily_status_failed(sched, at, bus, quick_daily):
    quick_daily.raises = GmatRunError("GMAT ล้มเหลว (test)")
    at("2026-11-11T21:00Z")
    at("2026-11-11T21:01Z")
    assert bus.of("daily")[-1]["state"] == "failed"


def test_health_reports_daily_status(client, data_dir):
    daily = client.get("/api/health").json()["daily"]
    assert set(daily) == {"state", "last_run_utc", "next_run_utc", "for_date"}
    assert daily["state"] == "idle" and daily["last_run_utc"] is None and daily["for_date"] is None
    nxt = T(daily["next_run_utc"])
    now = datetime.now(timezone.utc)
    assert ISO_Z_RE.match(daily["next_run_utc"]) and now - timedelta(minutes=1) < nxt <= now + timedelta(days=1)
    assert (nxt.hour, nxt.minute) == (21, 0)

    job = client.app.state.jobs.submit("daily", None, {"for_date": "2026-11-12"})       # คิวไม่ได้เริ่ม: ค้าง queued
    daily = client.get("/api/health").json()["daily"]
    assert daily["state"] == "running" and daily["for_date"] == "2026-11-12"
    assert daily["last_run_utc"] == job.created_utc
    disable(data_dir)
    assert client.get("/api/health").json()["daily"]["next_run_utc"] is None


def test_app_wires_scheduler_without_starting_it(client):
    app = client.app
    assert isinstance(app.state.scheduler, Scheduler)
    assert app.state.settings_on_change == app.state.scheduler.wake
    assert not any(t.name == scheduler_module.THREAD_NAME for t in threading.enumerate())


# ---------- thread ----------

def test_thread_ticks_survives_exceptions_and_stops_promptly(data_dir, jobs, bus, clock, caplog):
    calls = []

    def flaky(now):
        calls.append(now)
        if len(calls) == 1:
            raise RuntimeError("boom in tick")
        return []

    sched = Scheduler(data_dir, jobs, bus=bus, clock=clock, interval_s=0.01)
    sched.tick = flaky
    with caplog.at_level(logging.ERROR):
        sched.start()
        sched.start()                                              # เรียกซ้ำไม่มีผล
        wait_until(lambda: len(calls) >= 3, what="tick หลัง exception")
        sched.stop()
    assert "boom in tick" in caplog.text
    assert all(c == clock.t for c in calls)
    assert not any(t.name == scheduler_module.THREAD_NAME for t in threading.enumerate())

    slow_calls = []
    slow = Scheduler(data_dir, jobs, bus=bus, clock=clock, interval_s=60)
    slow.tick = lambda now: slow_calls.append(now) or []
    slow.start()
    try:
        wait_until(lambda: len(slow_calls) == 1, what="tick แรกทันทีที่เริ่ม")
        slow.wake()                                                # ค่าตั้งเปลี่ยน: ปลุกก่อนครบ 60 วินาที
        wait_until(lambda: len(slow_calls) == 2, what="tick หลัง wake")
    finally:
        t0 = time.monotonic()
        slow.stop()
        assert time.monotonic() - t0 < 1.0, "stop ต้องไม่รอครบคาบ 60 วินาที"
    assert not any(t.name == scheduler_module.THREAD_NAME for t in threading.enumerate())
