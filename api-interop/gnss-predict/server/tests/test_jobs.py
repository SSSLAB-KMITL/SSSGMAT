"""คิว job (หัวข้อ 7 ของ spec server) ด้วย InlineRunner: ไม่สร้าง process ฟังก์ชันของ engine ถูกแทนด้วยของปลอมเมื่อไม่ต้องการผลจริง

fetch_snapshot ถูกแทนเสมอ (ใช้เน็ต) test ที่ใช้ process จริงและ GMAT ปลอมอยู่ใน test_jobs_process.py
ทุกการรอมีขอบเวลา (TIMEOUT) ไม่มีการวนรอไม่รู้จบ
"""

import json
import logging
import os
import re
import signal
import threading
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from gnss_predict import studio
from gnss_predict.errors import GmatRunError, Message

from gnss_studio_server import jobs as jobs_module
from gnss_studio_server import worker
from gnss_studio_server.app import create_app
from gnss_studio_server.config import Config
from gnss_studio_server.errors import ApiError
from gnss_studio_server.events import EventBus
from gnss_studio_server.jobs import InlineRunner, JobManager, JobRecord, ProcessRunner
from gnss_studio_server.store import SCENARIOS_DIR

TIMEOUT = 5.0
JOB_ID_RE = re.compile(r"^j-\d{8}T\d{6}-[0-9a-f]{4}$")
ISO_Z_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$")
RECORD_KEYS = {"id", "kind", "scenario", "params", "state", "progress", "messages", "result", "error",
               "created_utc", "started_utc", "finished_utc", "origin", "gmat_pgid"}
FINISHED = ("succeeded", "failed", "cancelled")


# ---------- เครื่องมือ ----------

class RecordingBus(EventBus):
    """EventBus ที่จำทุก event ที่ publish (ไม่ต้องมี event loop)"""

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

    def job(self, job_id: str) -> list[dict]:
        return [d for d in self.of("job") if d["id"] == job_id]


class FakeEngine:
    """แทนฟังก์ชันของ engine: บันทึกการเรียก รายงาน progress เรียก on_gmat_start และรอ release (มีขอบเวลา) ถ้า block

    คืน (args[0] / out_rel, messages) args[0] คือ scenario_dir (หรือ data_dir ของ fetch)"""

    def __init__(self, out_rel: str = "ephem/h1", stages=(("done", 1.0),), messages=(), pgid: int | None = None,
                 raises: BaseException | None = None, block: bool = False, sleep_s: float = 0.0):
        self.out_rel, self.stages, self.messages = out_rel, stages, list(messages)
        self.pgid, self.raises, self.sleep_s = pgid, raises, sleep_s
        self.calls: list[tuple[tuple, dict]] = []
        self.spans: list[tuple[float, float]] = []
        self.entered = threading.Event()
        self.release = threading.Event()
        if not block:
            self.release.set()

    def __call__(self, *args, **kw):
        t0 = time.monotonic()
        self.calls.append((args, kw))
        self.entered.set()
        assert self.release.wait(TIMEOUT), "test ไม่ปล่อย FakeEngine"
        if self.pgid is not None and kw.get("on_gmat_start") is not None:
            kw["on_gmat_start"](self.pgid)
        progress = kw.get("progress") or (lambda stage, fraction: None)
        for stage, fraction in self.stages:
            progress(stage, fraction)
        time.sleep(self.sleep_s)
        self.spans.append((t0, time.monotonic()))
        if self.raises is not None:
            raise self.raises
        return Path(args[0]) / self.out_rel, list(self.messages)


def wait_until(pred, timeout: float = TIMEOUT, what: str = "เงื่อนไข"):
    deadline = time.monotonic() + timeout
    while not pred():
        assert time.monotonic() < deadline, f"รอ {what} เกิน {timeout} วินาที"
        time.sleep(0.005)


def wait_state(mgr: JobManager, job_id: str, *states: str) -> JobRecord:
    wait_until(lambda: mgr.get(job_id).state in states, what=f"{job_id} เป็น {states}")
    return mgr.get(job_id)


def wait_done(mgr: JobManager, job_id: str) -> JobRecord:
    return wait_state(mgr, job_id, *FINISHED)


def parse_z(text: str) -> datetime:
    return datetime.fromisoformat(text.replace("Z", "+00:00"))


def job_file(data_dir: Path, job_id: str) -> Path:
    return data_dir / "jobs" / f"{job_id}.json"


def write_record(data_dir: Path, **fields) -> dict:
    rec = {"id": "j-20261001T000000-0001", "kind": "propagate", "scenario": "S1", "params": {}, "state": "succeeded",
           "progress": None, "messages": [], "result": None, "error": None, "created_utc": "2026-10-01T00:00:00Z",
           "started_utc": None, "finished_utc": None, "origin": "user", "gmat_pgid": None, **fields}
    path = job_file(data_dir, rec["id"])
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(rec))
    return rec


@pytest.fixture
def bus():
    return RecordingBus()


@pytest.fixture
def mgr_inline(data_dir, bus):
    mgr = JobManager(data_dir, bus, runner=InlineRunner())
    mgr.start()
    yield mgr
    mgr.stop()
    assert not any(t.name == jobs_module.THREAD_NAME for t in threading.enumerate()), "thread ของคิวยังไม่จบ"


@pytest.fixture
def mgr_idle(data_dir, bus):
    """JobManager ที่ไม่เริ่ม thread: job ที่ส่งเข้าไปค้าง queued"""
    return JobManager(data_dir, bus, runner=InlineRunner())


# ---------- บันทึก job ----------

def test_submit_creates_queued_record_file_and_event(mgr_idle, bus, data_dir, s1):
    j = mgr_idle.submit("propagate", "S1", {})
    assert JOB_ID_RE.match(j.id)
    d = j.to_dict()
    assert set(d) == RECORD_KEYS
    assert (d["kind"], d["scenario"], d["params"], d["state"], d["origin"]) == ("propagate", "S1", {}, "queued", "user")
    assert d["messages"] == [] and d["result"] is None and d["error"] is None and d["gmat_pgid"] is None
    assert ISO_Z_RE.match(d["created_utc"]) and d["started_utc"] is None and d["finished_utc"] is None
    assert json.loads(job_file(data_dir, j.id).read_text()) == d
    assert bus.job(j.id) == [{"id": j.id, "kind": "propagate", "scenario": "S1", "state": "queued", "progress": None}]
    assert not list((data_dir / "jobs").glob("*.tmp*")), "ไฟล์ชั่วคราวต้องไม่ค้าง"


def test_job_id_uses_clock(data_dir, bus, s1):
    clock = lambda: datetime(2026, 11, 11, 21, 0, 41, tzinfo=timezone.utc)      # noqa: E731
    mgr = JobManager(data_dir, bus, runner=InlineRunner(), clock=clock)
    j = mgr.submit("propagate", "S1", {}, origin="scheduler")
    assert j.id.startswith("j-20261111T210041-") and JOB_ID_RE.match(j.id)
    assert j.created_utc == "2026-11-11T21:00:41.000Z" and j.origin == "scheduler"


def test_ids_are_unique_within_the_same_second(data_dir, bus, s1):
    clock = lambda: datetime(2026, 11, 11, 21, 0, 41, tzinfo=timezone.utc)      # noqa: E731
    mgr = JobManager(data_dir, bus, runner=InlineRunner(), clock=clock)
    ids = {mgr.submit("analyze", "S1", {"facility": f"F{i}"}).id for i in range(40)}
    assert len(ids) == 40


def test_get_returns_a_copy(mgr_idle, s1):
    j = mgr_idle.submit("propagate", "S1", {})
    got = mgr_idle.get(j.id)
    got.state = "succeeded"
    got.params["x"] = 1
    assert mgr_idle.get(j.id).state == "queued" and mgr_idle.get(j.id).params == {}


def test_get_unknown_is_404(mgr_idle):
    with pytest.raises(ApiError) as e:
        mgr_idle.get("j-20261111T000000-dead")
    assert (e.value.status, e.value.code) == (404, "NOT_FOUND")


# ---------- ตรวจ kind และ params ----------

@pytest.mark.parametrize("kind, scenario, params, field", [
    ("bogus", "S1", {}, "kind"),
    ("propagate", "S1", {"x": 1}, "x"),
    ("propagate", "S1", [], "params"),
    ("propagate", None, {}, "scenario"),
    ("propagate", "../S1", {}, "scenario"),
    ("analyze", "S1", {}, "facility"),
    ("analyze", "S1", {"facility": "../THBK"}, "facility"),
    ("analyze", "S1", {"facility": 3}, "facility"),
    ("validate", "S1", {}, "day"),
    ("validate", "S1", {"day": "2026-13-01"}, "day"),
    ("validate", "S1", {"day": "20261110"}, "day"),
    ("validate", "S1", {"day": "2026-11-10", "sp3": "../../etc/passwd"}, "sp3"),
    ("validate", "S1", {"day": "2026-11-10", "sp3": "/etc/passwd"}, "sp3"),
    ("validate", "S1", {"day": "2026-11-10", "sp3": 5}, "sp3"),
    ("validate", "S1", {"day": "2026-11-10", "facility": ""}, "facility"),
    ("fetch", "S1", {}, "scenario"),
    ("fetch", None, {"systems": "GX"}, "systems"),
    ("fetch", None, {"systems": ""}, "systems"),
    ("fetch", None, {"systems": ["G"]}, "systems"),
    ("daily", "S1", {}, "scenario"),
])
def test_submit_rejects_bad_kind_and_params(mgr_idle, data_dir, s1, kind, scenario, params, field):
    with pytest.raises(ApiError) as e:
        mgr_idle.submit(kind, scenario, params)
    assert (e.value.status, e.value.code, e.value.field) == (422, "SCENARIO_INVALID", field)
    assert mgr_idle.list() == []
    assert not (data_dir / "jobs").exists() or not list((data_dir / "jobs").iterdir())


def test_submit_rejects_bad_origin(mgr_idle, s1):
    with pytest.raises(ApiError) as e:
        mgr_idle.submit("propagate", "S1", {}, origin="robot")
    assert (e.value.status, e.value.code, e.value.field) == (422, "SCENARIO_INVALID", "origin")


def test_submit_missing_scenario_is_404(mgr_idle, s1):
    with pytest.raises(ApiError) as e:
        mgr_idle.submit("propagate", "Nope", {})
    assert (e.value.status, e.value.code) == (404, "NOT_FOUND")


def test_submit_accepts_valid_params(mgr_idle, s1):
    assert mgr_idle.submit("validate", "S1", {"day": "2026-11-10", "sp3": "truth/x.sp3", "facility": "THBK"}).state == "queued"
    assert mgr_idle.submit("fetch", None, {"systems": "ge"}).params == {"systems": "GE"}
    assert mgr_idle.submit("fetch", None, {}).scenario is None
    assert mgr_idle.submit("daily", None, {}).kind == "daily"


# ---------- คิวเดียว ----------

def test_jobs_run_one_at_a_time(mgr_inline, s1, monkeypatch):
    prop = FakeEngine(sleep_s=0.05)
    ana = FakeEngine(out_rel="access/THBK/h2", sleep_s=0.05)
    monkeypatch.setattr(studio, "run_propagate", prop)
    monkeypatch.setattr(studio, "run_analyze", ana)
    a = mgr_inline.submit("propagate", "S1", {})
    b = mgr_inline.submit("analyze", "S1", {"facility": "THBK"})
    a, b = wait_done(mgr_inline, a.id), wait_done(mgr_inline, b.id)
    assert a.state == b.state == "succeeded"
    assert parse_z(a.started_utc) <= parse_z(a.finished_utc) <= parse_z(b.started_utc) <= parse_z(b.finished_utc)
    (_, a_end), = prop.spans
    (b_start, _), = ana.spans
    assert a_end <= b_start, "job ที่สองเริ่มก่อน job แรกจบ"


def test_duplicate_submit_returns_same_job(mgr_inline, s1, monkeypatch):
    prop = FakeEngine(block=True)
    monkeypatch.setattr(studio, "run_propagate", prop)
    monkeypatch.setattr(studio, "run_analyze", FakeEngine(out_rel="access/THBK/h2"))
    try:
        a = mgr_inline.submit("propagate", "S1", {})
        assert prop.entered.wait(TIMEOUT)
        assert mgr_inline.get(a.id).state == "running"
        assert mgr_inline.submit("propagate", "S1", {}).id == a.id                       # กำลังรัน
        assert mgr_inline.submit("propagate", "S1", {}, origin="scheduler").id == a.id   # origin ไม่นับ
        q = mgr_inline.submit("analyze", "S1", {"facility": "THBK"})
        assert mgr_inline.submit("analyze", "S1", {"facility": "THBK"}).id == q.id       # ยังรอ
        assert mgr_inline.submit("analyze", "S1", {"facility": "OTHER"}).id != q.id      # params ต่าง = งานใหม่
    finally:
        prop.release.set()
    wait_done(mgr_inline, a.id)
    wait_until(lambda: all(j.state in FINISHED for j in mgr_inline.list()), what="ทุก job จบ")
    assert len(mgr_inline.list()) == 3
    again = mgr_inline.submit("propagate", "S1", {})
    assert again.id != a.id                                                               # ตัวเดิมจบแล้ว


def test_cancel_queued_job_never_starts(mgr_inline, bus, s1, monkeypatch):
    prop = FakeEngine(block=True)
    ana = FakeEngine(out_rel="access/THBK/h2")
    monkeypatch.setattr(studio, "run_propagate", prop)
    monkeypatch.setattr(studio, "run_analyze", ana)
    try:
        a = mgr_inline.submit("propagate", "S1", {})
        assert prop.entered.wait(TIMEOUT)
        b = mgr_inline.submit("analyze", "S1", {"facility": "THBK"})
        got = mgr_inline.cancel(b.id)
        assert got.state == "cancelled" and got.started_utc is None and ISO_Z_RE.match(got.finished_utc)
    finally:
        prop.release.set()
    wait_done(mgr_inline, a.id)
    time.sleep(0.05)                                                     # ให้โอกาสคิวหยิบ b ถ้ามีบั๊ก
    b = mgr_inline.get(b.id)
    assert b.state == "cancelled" and b.started_utc is None
    assert ana.calls == []
    assert [e["state"] for e in bus.job(b.id)] == ["queued", "cancelled"]
    assert json.loads(job_file(mgr_inline.data_dir, b.id).read_text())["state"] == "cancelled"


def test_cancel_running_job_ends_cancelled_even_if_engine_succeeds(mgr_inline, bus, s1, monkeypatch):
    prop = FakeEngine(block=True)
    monkeypatch.setattr(studio, "run_propagate", prop)
    a = mgr_inline.submit("propagate", "S1", {})
    assert prop.entered.wait(TIMEOUT)
    result = {}
    canceller = threading.Thread(target=lambda: result.setdefault("rec", mgr_inline.cancel(a.id)))
    canceller.start()
    try:
        wait_until(lambda: mgr_inline.get(a.id).cancel_requested, what="cancel_requested")
    finally:
        prop.release.set()
    canceller.join(TIMEOUT)
    assert not canceller.is_alive()
    assert result["rec"].state == "cancelled"
    a = mgr_inline.get(a.id)
    assert a.state == "cancelled" and a.result is None and a.error is None and a.gmat_pgid is None
    assert a.started_utc is not None and a.finished_utc is not None
    assert bus.job(a.id)[-1]["state"] == "cancelled"


def test_cancel_finished_job_is_unchanged_and_unknown_is_404(mgr_inline, s1, monkeypatch):
    monkeypatch.setattr(studio, "run_propagate", FakeEngine())
    a = wait_done(mgr_inline, mgr_inline.submit("propagate", "S1", {}).id)
    assert a.state == "succeeded"
    assert mgr_inline.cancel(a.id).to_dict() == a.to_dict()
    assert mgr_inline.get(a.id).state == "succeeded"
    with pytest.raises(ApiError) as e:
        mgr_inline.cancel("j-20261111T000000-beef")
    assert (e.value.status, e.value.code) == (404, "NOT_FOUND")


# ---------- ผลลัพธ์และข้อผิดพลาด ----------

def test_propagate_result_messages_and_events(mgr_inline, bus, data_dir, s1, monkeypatch):
    msg = Message("SAT_NOT_IN_SNAPSHOT", "warning", "ไม่มี G99 ใน snapshot", "*/Satellite/G99")
    prop = FakeEngine(out_rel="ephem/abc", messages=[msg])
    monkeypatch.setattr(studio, "run_propagate", prop)
    j = wait_done(mgr_inline, mgr_inline.submit("propagate", "S1", {}).id)
    assert j.state == "succeeded" and j.error is None
    assert j.result == {"path": "scenarios/S1/ephem/abc"}
    assert j.messages == [msg.to_dict()]
    (args, kw), = prop.calls
    assert Path(args[0]) == data_dir / SCENARIOS_DIR / "S1" and Path(args[1]) == data_dir
    assert kw["console"] is None and callable(kw["progress"]) and callable(kw["on_gmat_start"])
    logged = bus.messages_since(None)
    assert [(m["code"], m["level"], m["text"], m["object"]) for m in logged] == [
        ("SAT_NOT_IN_SNAPSHOT", "warning", "ไม่มี G99 ใน snapshot", "*/Satellite/G99")]
    assert json.loads(job_file(data_dir, j.id).read_text()) == j.to_dict()


def test_job_events_order(mgr_inline, bus, s1, monkeypatch):
    prop = FakeEngine(stages=[("scenario", 0.0), ("catalog", 0.05), ("gmat", 0.1), ("write", 0.9), ("done", 1.0)],
                      messages=[Message("X", "info", "สวัสดี")])
    monkeypatch.setattr(studio, "run_propagate", prop)
    j = wait_done(mgr_inline, mgr_inline.submit("propagate", "S1", {}).id)
    events = bus.job(j.id)
    states = [e["state"] for e in events]
    assert states[0] == "queued" and states[1] == "running" and states[-1] == "succeeded"
    assert set(states[1:-1]) == {"running"}
    assert events[0]["progress"] is None and events[1]["progress"] is None
    stages = [e["progress"]["stage"] for e in events[2:-1]]
    assert stages == ["scenario", "catalog", "gmat", "write", "done"]                # เปลี่ยนขั้น = ส่งทุกครั้ง
    assert events[-1]["progress"] == {"stage": "done", "fraction": 1.0}
    assert all(set(e) == {"id", "kind", "scenario", "state", "progress"} for e in events)   # ไม่มี error
    # ข้อความของ engine ส่งก่อน event ที่บอกว่าสำเร็จ
    order = [(e, d.get("state")) for e, d in bus.events if e == "message" or (e == "job" and d["id"] == j.id)]
    assert order.index(("message", None)) < order.index(("job", "succeeded"))


def test_progress_events_are_throttled_but_stage_changes_always_sent(mgr_inline, bus, s1, monkeypatch):
    burst = [("gmat", 0.1 + i * 0.004) for i in range(200)]
    prop = FakeEngine(stages=[("catalog", 0.05), *burst, ("write", 0.9), ("done", 1.0)])
    monkeypatch.setattr(studio, "run_propagate", prop)
    j = wait_done(mgr_inline, mgr_inline.submit("propagate", "S1", {}).id)
    stages = [e["progress"]["stage"] for e in bus.job(j.id) if e["progress"] is not None]
    assert 1 <= stages.count("gmat") <= 2, stages
    assert "catalog" in stages and "write" in stages and stages[-1] == "done"
    assert len(bus.job(j.id)) < 12


def test_error_recorded_with_code(mgr_inline, bus, data_dir, s1):
    # engine จริง: scenario.json ที่ช่วงเวลาผิด (เขียนตรงลงดิสก์ ข้าม store) -> ScenarioError
    path = data_dir / SCENARIOS_DIR / "S1" / "scenario.json"
    doc = json.loads(path.read_text())
    doc["analysis_period"]["stop"] = doc["analysis_period"]["start"]
    path.write_text(json.dumps(doc))
    j = wait_done(mgr_inline, mgr_inline.submit("propagate", "S1", {}).id)
    assert j.state == "failed" and j.result is None
    assert set(j.error) == {"code", "text", "detail"}
    assert j.error["code"] == "SCENARIO_INVALID" and j.error["text"] and j.error["detail"] is None
    last = bus.job(j.id)[-1]
    assert last["state"] == "failed" and last["error"] == j.error
    assert any(m["code"] == "SCENARIO_INVALID" and m["level"] == "error" for m in bus.messages_since(None))


def test_gmat_error_detail_is_last_20_log_lines(mgr_inline, s1, monkeypatch):
    log = "\n".join(f"log line {i}" for i in range(30))
    prop = FakeEngine(pgid=4242, stages=[("gmat", 0.1)], raises=GmatRunError(f"GMAT จบด้วย exit code 1\n{log}"))
    monkeypatch.setattr(studio, "run_propagate", prop)
    j = wait_done(mgr_inline, mgr_inline.submit("propagate", "S1", {}).id)
    assert j.state == "failed" and j.gmat_pgid is None
    assert j.error == {"code": "GMAT_FAILED", "text": "GMAT จบด้วย exit code 1",
                       "detail": "\n".join(f"log line {i}" for i in range(10, 30))}


def test_unexpected_exception_is_internal_and_traceback_logged(mgr_inline, s1, monkeypatch, caplog):
    monkeypatch.setattr(studio, "run_propagate", FakeEngine(raises=RuntimeError("kaboom")))
    with caplog.at_level(logging.ERROR, logger="gnss_studio_server.jobs"):
        j = wait_done(mgr_inline, mgr_inline.submit("propagate", "S1", {}).id)
    assert j.state == "failed" and j.error["code"] == "INTERNAL" and j.error["detail"] is None
    assert "Traceback" not in j.error["text"] and len(j.error["text"]) < 300
    logged = "\n".join(r.getMessage() + (r.exc_text or "") for r in caplog.records)
    assert j.id in logged and "Traceback" in logged and "kaboom" in logged


def test_fetch_job(mgr_inline, data_dir, monkeypatch):
    fetch = FakeEngine(out_rel="orbits/20261111T2100Z", stages=[("omm", 0.0), ("done", 1.0)])
    monkeypatch.setattr(studio, "fetch_snapshot", fetch)
    j = wait_done(mgr_inline, mgr_inline.submit("fetch", None, {"systems": "GE"}).id)
    assert j.state == "succeeded" and j.scenario is None
    assert j.result == {"path": "orbits/20261111T2100Z", "snapshot": "20261111T2100Z"}
    (args, kw), = fetch.calls
    assert Path(args[0]) == data_dir and kw["systems"] == "GE" and callable(kw["progress"])
    now = args[1] if len(args) > 1 else kw["now"]
    assert now.tzinfo is not None and abs(now - datetime.now(timezone.utc)) < timedelta(minutes=1)
    j2 = wait_done(mgr_inline, mgr_inline.submit("fetch", None, {}).id)
    assert j2.state == "succeeded" and fetch.calls[1][1]["systems"] == "GREC"


def test_analyze_and_validate_arguments(data_dir, bus, s1, monkeypatch):
    mgr = JobManager(data_dir, bus, runner=InlineRunner(gmat_bin="/opt/gmat/GmatConsole"))
    ana = FakeEngine(out_rel="access/THBK/h2")
    val = FakeEngine(out_rel="ephem/h1")
    monkeypatch.setattr(studio, "run_analyze", ana)
    monkeypatch.setattr(studio, "run_validate", val)
    mgr.start()
    try:
        a = wait_done(mgr, mgr.submit("analyze", "S1", {"facility": "THBK"}).id)
        v = wait_done(mgr, mgr.submit("validate", "S1", {"day": "2026-11-10", "sp3": "truth/x.sp3",
                                                         "facility": "THBK"}).id)
    finally:
        mgr.stop()
    scenario_dir = data_dir / SCENARIOS_DIR / "S1"
    assert a.result == {"path": "scenarios/S1/access/THBK/h2", "facility": "THBK"}
    (args, kw), = ana.calls
    assert (Path(args[0]), args[1], Path(args[2])) == (scenario_dir, "THBK", data_dir)
    assert kw["console"] == Path("/opt/gmat/GmatConsole")
    assert v.result == {"path": "scenarios/S1/ephem/h1"}
    (args, kw), = val.calls
    assert (Path(args[0]), args[1], Path(args[2])) == (scenario_dir, date(2026, 11, 10), data_dir)
    assert kw["sp3"] == data_dir / "truth" / "x.sp3" and kw["facility"] == "THBK"
    assert kw["console"] == Path("/opt/gmat/GmatConsole") and callable(kw["on_gmat_start"])


def test_daily_is_registered_but_not_implemented_yet(mgr_inline):
    assert "daily" in worker.JOB_BODIES
    j = wait_done(mgr_inline, mgr_inline.submit("daily", None, {}).id)
    assert j.state == "failed" and j.error["code"] == "NOT_IMPLEMENTED" and j.error["text"]


def test_worker_scenarios_dir_matches_store():
    assert worker.SCENARIOS_DIR == SCENARIOS_DIR


# ---------- worker.run_job โดยตรง: โพรโทคอลของคิว ----------

def _run_job_messages(kind, scenario, params, data_dir, gmat_bin=None) -> list[tuple]:
    import queue
    out = queue.Queue()
    worker.run_job(kind, scenario, params, str(data_dir), gmat_bin, out)
    items = []
    while not out.empty():
        items.append(out.get_nowait())
    return items


def test_run_job_clears_pgid_when_progress_leaves_gmat(data_dir, monkeypatch):
    def fake(scenario_dir, data_dir, console=None, progress=None, on_gmat_start=None):
        progress("propagate.catalog", 0.02)
        progress("propagate.gmat", 0.05)
        on_gmat_start(777)
        progress("propagate.gmat", 0.3)
        progress("propagate.write", 0.45)
        progress("done", 1.0)
        return Path(scenario_dir) / "ephem" / "h", []
    monkeypatch.setattr(studio, "run_propagate", fake)
    items = _run_job_messages("propagate", "S1", {}, data_dir)
    assert items == [
        ("progress", "propagate.catalog", 0.02), ("progress", "propagate.gmat", 0.05), ("gmat_pgid", 777),
        ("progress", "propagate.gmat", 0.3), ("gmat_pgid", None), ("progress", "propagate.write", 0.45),
        ("progress", "done", 1.0), ("result", {"path": "scenarios/S1/ephem/h"})]


def test_run_job_clears_pgid_when_engine_raises_or_returns(data_dir, monkeypatch):
    log = "\n".join(f"l{i}" for i in range(25))
    killed = GmatRunError(f"GMAT จบด้วย exit code -9\n{log}")
    monkeypatch.setattr(studio, "run_propagate", FakeEngine(pgid=99, stages=[("gmat", 0.1)], raises=killed))
    items = _run_job_messages("propagate", "S1", {}, data_dir)
    assert items[0] == ("gmat_pgid", 99) and items[-2] == ("gmat_pgid", None)
    assert items[-1] == ("error", {"code": "GMAT_FAILED", "text": "GMAT จบด้วย exit code -9",
                                   "detail": "\n".join(f"l{i}" for i in range(5, 25))})
    monkeypatch.setattr(studio, "run_propagate", FakeEngine(pgid=98, stages=[]))
    items = _run_job_messages("propagate", "S1", {}, data_dir)
    assert items == [("gmat_pgid", 98), ("gmat_pgid", None), ("result", {"path": "scenarios/S1/ephem/h1"})]


def test_run_job_error_without_log_has_no_detail(data_dir, monkeypatch):
    monkeypatch.setattr(studio, "run_propagate", FakeEngine(raises=GmatRunError("เรียก GMAT ไม่ได้: ไม่มีไฟล์")))
    assert _run_job_messages("propagate", "S1", {}, data_dir)[-1] == (
        "error", {"code": "GMAT_FAILED", "text": "เรียก GMAT ไม่ได้: ไม่มีไฟล์", "detail": None})


# ---------- ยกเลิกขณะรัน: ลำดับ killpg / terminate และ pgid ที่ล้าสมัย (runner ปลอม) ----------

class ScriptedHandle:
    """handle ปลอม: ส่ง items ตามลำดับ "WAIT_TERMINATE" = ส่ง None (tick) จนกว่าจะถูก terminate (มีขอบเวลา)"""

    def __init__(self, items, calls):
        self.items, self.calls = items, calls
        self.terminated = threading.Event()

    def messages(self):
        for item in self.items:
            if item == "WAIT_TERMINATE":
                deadline = time.monotonic() + TIMEOUT
                while not self.terminated.is_set() and time.monotonic() < deadline:
                    yield None
                    time.sleep(0.005)
                continue
            yield item

    def terminate(self):
        self.calls.append(("terminate",))
        self.terminated.set()


class ScriptedRunner:
    def __init__(self, items, calls):
        self.items, self.calls = items, calls
        self.handles: list[ScriptedHandle] = []

    def start(self, job, data_dir):
        handle = ScriptedHandle(self.items, self.calls)
        self.handles.append(handle)
        return handle


@pytest.fixture
def killpg_calls(monkeypatch):
    calls = []
    monkeypatch.setattr(os, "killpg", lambda pgid, sig: calls.append(("killpg", pgid, sig)))
    return calls


def _scripted_manager(data_dir, bus, items, calls):
    mgr = JobManager(data_dir, bus, runner=ScriptedRunner(items, calls))
    mgr.start()
    return mgr


def test_cancel_kills_known_gmat_group_then_terminates_then_kills_late_pgid(data_dir, bus, s1, killpg_calls):
    items = [("progress", "gmat", 0.1), ("gmat_pgid", 4242), "WAIT_TERMINATE",
             ("gmat_pgid", 5555), ("error", {"code": "GMAT_FAILED", "text": "exit code -9", "detail": None})]
    mgr = _scripted_manager(data_dir, bus, items, killpg_calls)
    try:
        j = mgr.submit("propagate", "S1", {})
        wait_until(lambda: mgr.get(j.id).gmat_pgid == 4242, what="pgid 4242")
        got = mgr.cancel(j.id)
    finally:
        mgr.stop()
    assert killpg_calls == [("killpg", 4242, signal.SIGKILL), ("terminate",), ("killpg", 5555, signal.SIGKILL)]
    assert got.state == "cancelled" and got.error is None and got.gmat_pgid is None
    assert mgr.get(j.id).state == "cancelled"


def test_cancel_never_kills_a_cleared_pgid(data_dir, bus, s1, killpg_calls):
    items = [("progress", "gmat", 0.1), ("gmat_pgid", 4242), ("gmat_pgid", None), ("progress", "write", 0.9),
             "WAIT_TERMINATE"]
    mgr = _scripted_manager(data_dir, bus, items, killpg_calls)
    try:
        j = mgr.submit("propagate", "S1", {})
        wait_until(lambda: (mgr.get(j.id).progress or {}).get("stage") == "write", what="ขั้น write")
        assert mgr.get(j.id).gmat_pgid is None
        got = mgr.cancel(j.id)
    finally:
        mgr.stop()
    assert killpg_calls == [("terminate",)]
    assert got.state == "cancelled"


def test_child_gone_without_result_is_internal(data_dir, bus, s1, killpg_calls):
    items = [("progress", "gmat", 0.1), ("gmat_pgid", 4242)]          # จบโดยไม่มี result/error
    mgr = _scripted_manager(data_dir, bus, items, killpg_calls)
    try:
        j = wait_done(mgr, mgr.submit("propagate", "S1", {}).id)
    finally:
        mgr.stop()
    assert j.state == "failed" and j.error["code"] == "INTERNAL" and j.gmat_pgid is None
    assert killpg_calls == [("killpg", 4242, signal.SIGKILL)]          # GMAT ที่ไม่มีใครถือแล้วถูกฆ่า


def test_kill_group_guards(monkeypatch):
    calls = []

    def fake_killpg(pgid, sig):
        calls.append(pgid)
        if pgid == 7:
            raise ProcessLookupError
        if pgid == 8:
            raise PermissionError

    monkeypatch.setattr(os, "killpg", fake_killpg)
    for pgid in (None, 0, 1, -5, os.getpgrp(), 7, 8, 4242):
        jobs_module.kill_group(pgid)                                    # ไม่ raise
    assert calls == [7, 8, 4242]


# ---------- เปิด/ปิด, กู้คืน, ลบของเก่า ----------

def test_recover_marks_interrupted(data_dir, bus):
    running = write_record(data_dir, id="j-20261110T000000-aaaa", state="running", started_utc="2026-11-10T00:00:01Z",
                           gmat_pgid=1234, progress={"stage": "gmat", "fraction": 0.4})
    queued = write_record(data_dir, id="j-20261110T000000-bbbb", state="queued")
    done = write_record(data_dir, id="j-20261110T000000-cccc", state="succeeded", finished_utc="2026-11-10T00:01:00Z",
                        result={"path": "scenarios/S1/ephem/h"})
    (data_dir / "jobs" / "j-broken.json").write_text("{not json")
    clock = lambda: datetime(2026, 11, 11, 3, 0, 0, tzinfo=timezone.utc)        # noqa: E731
    mgr = JobManager(data_dir, bus, runner=InlineRunner(), clock=clock)
    mgr.recover()
    for rec in (running, queued):
        got = mgr.get(rec["id"])
        assert got.state == "failed" and got.error["code"] == "INTERRUPTED" and got.error["text"]
        assert got.finished_utc == "2026-11-11T03:00:00.000Z" and got.gmat_pgid is None
        assert json.loads(job_file(data_dir, rec["id"]).read_text()) == got.to_dict()
    assert mgr.get(running["id"]).started_utc == "2026-11-10T00:00:01Z"
    assert mgr.get(done["id"]).to_dict() == done
    assert {j.id for j in mgr.list()} == {running["id"], queued["id"], done["id"]}


def test_prune_30_days(data_dir, bus):
    now = datetime(2026, 11, 11, 0, 0, 0, tzinfo=timezone.utc)
    iso = lambda dt: dt.strftime("%Y-%m-%dT%H:%M:%SZ")                         # noqa: E731
    old = write_record(data_dir, id="j-20261001T000000-0001", state="succeeded", finished_utc=iso(now - timedelta(days=31)))
    recent = write_record(data_dir, id="j-20261001T000000-0002", state="failed", finished_utc=iso(now - timedelta(days=29)))
    old_created = write_record(data_dir, id="j-20261001T000000-0003", state="cancelled",
                               created_utc=iso(now - timedelta(days=40)), finished_utc=None)
    active = write_record(data_dir, id="j-20261001T000000-0004", state="queued", created_utc=iso(now - timedelta(days=40)))
    mgr = JobManager(data_dir, bus, runner=InlineRunner(), clock=lambda: now)
    mgr.prune(now)                                                       # ก่อน recover: active ยัง queued บนดิสก์
    assert not job_file(data_dir, old["id"]).exists() and not job_file(data_dir, old_created["id"]).exists()
    assert job_file(data_dir, recent["id"]).exists() and job_file(data_dir, active["id"]).exists()
    mgr.recover()
    assert {j.id for j in mgr.list()} == {recent["id"], active["id"]}
    mgr.prune(now + timedelta(days=31))                                  # ลบจากหน่วยความจำด้วย
    assert mgr.list() == [] and not list((data_dir / "jobs").glob("*.json"))


def test_start_recovers_prunes_and_stop_ends_thread(data_dir, bus):
    write_record(data_dir, id="j-20261110T000000-aaaa", state="running")
    write_record(data_dir, id="j-20200101T000000-0001", state="succeeded", finished_utc="2020-01-01T00:00:00Z")
    mgr = JobManager(data_dir, bus, runner=InlineRunner())
    mgr.start()
    try:
        assert any(t.name == jobs_module.THREAD_NAME for t in threading.enumerate())
        assert mgr.get("j-20261110T000000-aaaa").error["code"] == "INTERRUPTED"
        assert not job_file(data_dir, "j-20200101T000000-0001").exists()
    finally:
        mgr.stop()
    assert not any(t.name == jobs_module.THREAD_NAME for t in threading.enumerate())


def test_stop_marks_queued_jobs_interrupted(data_dir, bus, s1, monkeypatch):
    prop = FakeEngine(block=True)
    monkeypatch.setattr(studio, "run_propagate", prop)
    monkeypatch.setattr(studio, "run_analyze", FakeEngine(out_rel="access/THBK/h2"))
    mgr = JobManager(data_dir, bus, runner=InlineRunner())
    mgr.start()
    a = mgr.submit("propagate", "S1", {})
    assert prop.entered.wait(TIMEOUT)
    b = mgr.submit("analyze", "S1", {"facility": "THBK"})
    stopper = threading.Thread(target=mgr.stop)
    stopper.start()
    time.sleep(0.05)
    prop.release.set()                                                   # inline: งานที่รันอยู่ทำต่อจนเสร็จ
    stopper.join(TIMEOUT)
    assert not stopper.is_alive()
    assert mgr.get(a.id).state == "succeeded"
    b = mgr.get(b.id)
    assert b.state == "failed" and b.error["code"] == "INTERRUPTED" and b.started_utc is None
    assert not any(t.name == jobs_module.THREAD_NAME for t in threading.enumerate())


def test_active_for(mgr_idle, s1):
    assert not mgr_idle.active_for("S1")
    j = mgr_idle.submit("propagate", "S1", {})
    assert mgr_idle.active_for("S1") and not mgr_idle.active_for("S2")
    mgr_idle.cancel(j.id)
    assert not mgr_idle.active_for("S1")


# ---------- route ----------

def test_delete_scenario_with_running_job_409(client_inline, s1, monkeypatch):
    prop = FakeEngine(block=True)
    monkeypatch.setattr(studio, "run_propagate", prop)
    jobs = client_inline.app.state.jobs
    try:
        j = jobs.submit("propagate", "S1", {})
        assert prop.entered.wait(TIMEOUT)
        r = client_inline.delete("/api/scenarios/S1")
        assert r.status_code == 409 and r.json()["code"] == "JOB_RUNNING" and r.json()["text"]
        assert client_inline.get("/api/scenarios/S1").status_code == 200
    finally:
        prop.release.set()
    wait_done(jobs, j.id)
    assert client_inline.delete("/api/scenarios/S1").status_code == 204


def test_delete_scenario_with_queued_job_409(client, s1):
    jobs = client.app.state.jobs                                       # start_background=False: job ค้าง queued
    j = jobs.submit("propagate", "S1", {})
    r = client.delete("/api/scenarios/S1")
    assert r.status_code == 409 and r.json()["code"] == "JOB_RUNNING"
    assert client.post(f"/api/jobs/{j.id}/cancel").json()["state"] == "cancelled"
    assert client.delete("/api/scenarios/S1").status_code == 204


def test_job_routes(client, s1):
    jobs = client.app.state.jobs
    a = jobs.submit("propagate", "S1", {})
    b = jobs.submit("analyze", "S1", {"facility": "THBK"})
    listed = client.get("/api/jobs").json()
    assert [j["id"] for j in listed] == [b.id, a.id]                     # ใหม่ก่อน
    assert listed[1] == a.to_dict()
    assert client.get(f"/api/jobs/{a.id}").json() == a.to_dict()
    r = client.post(f"/api/jobs/{b.id}/cancel")
    assert r.status_code == 200 and r.json()["state"] == "cancelled" and r.json()["started_utc"] is None
    assert [j["id"] for j in client.get("/api/jobs", params={"state": "queued"}).json()] == [a.id]
    assert [j["id"] for j in client.get("/api/jobs", params={"state": "cancelled"}).json()] == [b.id]
    bad = client.get("/api/jobs", params={"state": "bogus"})
    assert bad.status_code == 422 and bad.json()["code"] == "SCENARIO_INVALID" and bad.json()["field"] == "state"
    for r in (client.get("/api/jobs/j-20261111T000000-dead"), client.post("/api/jobs/j-20261111T000000-dead/cancel"),
              client.get("/api/jobs/..%2F..%2Fsettings")):
        assert r.status_code == 404 and r.json()["code"] == "NOT_FOUND"


# ---------- การผูกกับแอป ----------

def test_app_wires_process_runner_with_gmat_bin(data_dir, no_web_dist):
    app = create_app(Config(data_dir=data_dir, web_dist=no_web_dist, gmat_bin="/opt/gmat/GmatConsole"),
                     start_background=False)
    assert isinstance(app.state.jobs, JobManager)
    assert isinstance(app.state.jobs.runner, ProcessRunner) and app.state.jobs.runner.gmat_bin == "/opt/gmat/GmatConsole"
    with TestClient(app):
        assert not any(t.name == jobs_module.THREAD_NAME for t in threading.enumerate())   # ไม่เริ่มคิว


def test_app_starts_and_stops_jobs_with_lifespan(data_dir, no_web_dist):
    write_record(data_dir, id="j-20261110T000000-aaaa", state="running")
    app = create_app(Config(data_dir=data_dir, web_dist=no_web_dist))
    with TestClient(app) as c:
        assert any(t.name == jobs_module.THREAD_NAME for t in threading.enumerate())
        got = c.get("/api/jobs/j-20261110T000000-aaaa").json()
        assert got["state"] == "failed" and got["error"]["code"] == "INTERRUPTED"
    assert not any(t.name == jobs_module.THREAD_NAME for t in threading.enumerate())
