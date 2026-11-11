"""คิว job กับ process ลูกจริง (multiprocessing แบบ spawn) และ GMAT ปลอม (สคริปต์ shell)

GMAT ปลอมตอบ `--version` ทันที (engine เรียก gmat_version ก่อนรันจริง) ส่วนการรันจริงเป็น `sleep 30`
ทุกการรอมีขอบเวลา ทั้งไฟล์ควรใช้เวลาไม่เกินราว 20 วินาที
"""

import multiprocessing
import os
import threading
import time
from pathlib import Path

import pytest

import job_targets
from gnss_studio_server import jobs as jobs_module
from gnss_studio_server.events import EventBus
from gnss_studio_server.jobs import JobManager, ProcessRunner

TIMEOUT = 10.0
FINISHED = ("succeeded", "failed", "cancelled")
VERSION_FAST = 'case "$1" in --version) echo "Build Date: fake"; exit 0;; esac\n'


def fake_console(d: Path, body: str) -> Path:
    """GmatConsole ปลอมแบบเดียวกับ tests/test_run_gmat.py ของ engine: `#!/bin/sh` ตามด้วย body"""
    d.mkdir(parents=True, exist_ok=True)
    p = d / "GmatConsole"
    p.write_text("#!/bin/sh\n" + body + "\n")
    p.chmod(0o755)
    return p


def process_group_alive(pgid: int) -> bool:
    try:
        os.killpg(pgid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:                  # macOS: กลุ่มที่เหลือแต่ zombie ตอบ EPERM
        return False
    return True


def wait_until(pred, timeout: float = TIMEOUT, what: str = "เงื่อนไข"):
    deadline = time.monotonic() + timeout
    while not pred():
        assert time.monotonic() < deadline, f"รอ {what} เกิน {timeout} วินาที"
        time.sleep(0.01)


def wait_state(mgr, job_id, *states):
    wait_until(lambda: mgr.get(job_id).state in states, what=f"{job_id} เป็น {states}")
    return mgr.get(job_id)


def wait_progress_stage(mgr, job_id, stage):
    wait_until(lambda: (mgr.get(job_id).progress or {}).get("stage") == stage, what=f"ขั้น {stage}")


def wait_gmat_pgid(mgr, job_id) -> int:
    wait_until(lambda: mgr.get(job_id).gmat_pgid is not None, what="pgid ของ GMAT")
    return mgr.get(job_id).gmat_pgid


def no_job_thread() -> bool:
    return not any(t.name == jobs_module.THREAD_NAME for t in threading.enumerate())


@pytest.fixture
def fake_gmat_sleep(tmp_path):
    return fake_console(tmp_path / "gmat", VERSION_FAST + "sleep 30")


def _manager(data_dir, gmat_bin, **runner_kw):
    mgr = JobManager(data_dir, EventBus(), runner=ProcessRunner(gmat_bin=str(gmat_bin) if gmat_bin else None, **runner_kw))
    mgr.start()
    return mgr


@pytest.fixture
def mgr_process(data_dir, fake_gmat_sleep):
    mgr = _manager(data_dir, fake_gmat_sleep)
    yield mgr
    mgr.stop()
    assert no_job_thread() and multiprocessing.active_children() == []


def test_cancel_kills_gmat_within_2s(mgr_process, s1):
    mgr = mgr_process
    j = mgr.submit("propagate", "S1", {})
    wait_state(mgr, j.id, "running")
    wait_progress_stage(mgr, j.id, "gmat")
    pgid = wait_gmat_pgid(mgr, j.id)
    assert process_group_alive(pgid)
    t0 = time.monotonic()                                                # นับจากตอนสั่งยกเลิก
    got = mgr.cancel(j.id)
    assert time.monotonic() - t0 < 2, "cancel ไม่เสร็จภายใน 2 วินาที"
    assert got.state == "cancelled"
    while process_group_alive(pgid):
        assert time.monotonic() - t0 < 2, "GMAT ยังไม่ตายภายใน 2 วินาทีหลังสั่งยกเลิก"
        time.sleep(0.05)
    assert mgr.get(j.id).state == "cancelled"
    assert mgr.get(j.id).gmat_pgid is None and mgr.get(j.id).error is None


def test_cancelled_running_job_leaves_no_child_process(mgr_process, s1):
    mgr = mgr_process
    j = mgr.submit("propagate", "S1", {})
    pgid = wait_gmat_pgid(mgr, j.id)
    children = multiprocessing.active_children()
    assert len(children) == 1
    child = children[0]
    t0 = time.monotonic()
    got = mgr.cancel(j.id)
    assert got.state == "cancelled" and time.monotonic() - t0 < 3
    assert not child.is_alive() and child.exitcode is not None
    assert multiprocessing.active_children() == []
    with pytest.raises(ProcessLookupError):
        os.kill(child.pid, 0)                                            # ถูกเก็บกวาดแล้ว ไม่เหลือ zombie
    wait_until(lambda: not process_group_alive(pgid), timeout=2, what="GMAT ตาย")


def test_gmat_failure_in_child_reports_code_and_detail(data_dir, s1, tmp_path):
    lines = "\n".join(f"echo 'gmat says {i}'" for i in range(25))
    console = fake_console(tmp_path / "gmat-fail", VERSION_FAST + lines + "\nexit 1")
    mgr = _manager(data_dir, console)
    try:
        j = wait_state(mgr, mgr.submit("propagate", "S1", {}).id, *FINISHED)
    finally:
        mgr.stop()
    assert j.state == "failed" and j.error["code"] == "GMAT_FAILED" and j.gmat_pgid is None
    assert j.error["text"] == "GMAT จบด้วย exit code 1"
    assert j.error["detail"].splitlines()[-1] == "gmat says 24" and len(j.error["detail"].splitlines()) <= 20
    assert multiprocessing.active_children() == [] and no_job_thread()


def test_child_crash_becomes_internal(data_dir, s1):
    mgr = _manager(data_dir, None, target=job_targets.exit_3)
    try:
        j = wait_state(mgr, mgr.submit("propagate", "S1", {}).id, *FINISHED)
    finally:
        mgr.stop()
    assert j.state == "failed" and j.error["code"] == "INTERNAL" and j.error["text"]
    assert "exit code 3" in j.error["detail"]
    assert multiprocessing.active_children() == [] and no_job_thread()


def test_truncated_message_from_dying_child_is_internal_not_hang(data_dir, s1):
    # process แม่ต้องไม่ถือปลายเขียนของท่อไว้: อ่านกรอบที่ขาดกลางแล้วได้ EOF ไม่ใช่รอส่วนที่เหลือไปตลอด
    mgr = _manager(data_dir, None, target=job_targets.partial_message_then_exit)
    try:
        j = wait_state(mgr, mgr.submit("propagate", "S1", {}).id, *FINISHED)
        assert (mgr.get(j.id).progress or {}).get("stage") == "gmat"     # ข้อความก่อนหน้ายังถึงครบ
        nxt = wait_state(mgr, mgr.submit("propagate", "S1", {}).id, "running", *FINISHED)   # คิวยังเดินต่อได้
        assert nxt.id != j.id
    finally:
        mgr.stop()
    assert j.state == "failed" and j.error["code"] == "INTERNAL" and "exit code 5" in j.error["detail"]
    assert multiprocessing.active_children() == [] and no_job_thread()


def test_stop_kills_running_job_and_marks_it_interrupted(data_dir, s1, fake_gmat_sleep):
    mgr = _manager(data_dir, fake_gmat_sleep)
    j = mgr.submit("propagate", "S1", {})
    pgid = wait_gmat_pgid(mgr, j.id)
    t0 = time.monotonic()
    mgr.stop()
    assert time.monotonic() - t0 < 5
    wait_until(lambda: not process_group_alive(pgid), timeout=2, what="GMAT ตาย")
    got = mgr.get(j.id)
    assert got.state == "failed" and got.error["code"] == "INTERRUPTED" and got.gmat_pgid is None
    assert multiprocessing.active_children() == [] and no_job_thread()
