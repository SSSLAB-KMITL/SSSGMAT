"""ทั้งสายผ่าน HTTP API ด้วย GMAT จริงและ ProcessRunner จริง (ข้ามถ้าหา GmatConsole ไม่เจอ)

New จากแม่แบบ thbk-gnss (6 ชม. snapshot ย่อของ test) -> propagate -> Access THBK -> GPS -> ช่วง access มี G01 -> scene.czml เปิดเป็น JSON

ไม่ใช้เน็ต: ไม่มี fetch, validate หรืองานประจำวัน คิว job เริ่มเองและตัวตั้งเวลาไม่ถูกสร้างเป็น thread (start_background=False)
settings.json ปิดงานประจำวันไว้ด้วย เผื่อมีใครเปิดตัวตั้งเวลาในแอปนี้ ทุกการรอมีขอบเวลา
"""

import json
import multiprocessing
import threading
import time

import pytest
from fastapi.testclient import TestClient

from gnss_predict.errors import GmatNotFoundError
from gnss_predict.run_gmat import find_gmat_console
from gnss_studio_server import jobs as jobs_module
from gnss_studio_server.app import create_app
from gnss_studio_server.config import Config
from gnss_studio_server.jobs import JobManager, ProcessRunner

try:
    GMAT_CONSOLE = find_gmat_console()
except GmatNotFoundError as exc:
    pytest.skip(f"ไม่มี GmatConsole: {exc}", allow_module_level=True)

PROPAGATE_TIMEOUT_S = 180.0
ANALYZE_TIMEOUT_S = 180.0
FINISHED = ("succeeded", "failed", "cancelled")
SCENARIO = {"name": "IT6H", "template": "thbk-gnss", "start": "2026-11-10T00:00:00Z", "stop": "2026-11-10T06:00:00Z",
            "snapshot": "20261110T0000Z"}
FACILITY_PATH, GPS_PATH = "*/Facility/THBK", "*/Constellation/GPS"
DAILY_OFF = {"daily": {"enabled": False, "run_at_utc": "21:00", "facility": "THBK", "retention_days": 30,
                       "validation_retry_hours": 3, "validation_give_up_days": 14}, "cesium_ion_token": ""}


@pytest.fixture
def real_client(data_dir, no_web_dist):
    """client ที่คิว job รัน GMAT จริงใน process ลูก หยุดคิวตอนจบและตรวจว่าไม่เหลือ process หรือ thread ค้าง"""
    (data_dir / "settings.json").write_text(json.dumps(DAILY_OFF), encoding="utf-8")
    config = Config(data_dir=data_dir, web_dist=no_web_dist, gmat_bin=str(GMAT_CONSOLE))
    app = create_app(config, start_background=False)                      # ไม่เริ่มคิวและตัวตั้งเวลาเอง
    app.state.jobs = JobManager(data_dir, app.state.bus, runner=ProcessRunner(gmat_bin=str(GMAT_CONSOLE)),
                                logger=app.state.logger)
    app.state.jobs.start()
    try:
        yield TestClient(app)
    finally:
        app.state.jobs.stop()
        assert not any(t.name == jobs_module.THREAD_NAME for t in threading.enumerate())
        assert multiprocessing.active_children() == []


def wait_job(client, job_id: str, timeout_s: float) -> dict:
    """รอ job จบ (สำเร็จ ล้ม หรือยกเลิก) ไม่เกิน timeout_s วินาที แล้วคืนบันทึก job"""
    deadline = time.monotonic() + timeout_s
    while True:
        r = client.get(f"/api/jobs/{job_id}")
        assert r.status_code == 200, r.text
        job = r.json()
        if job["state"] in FINISHED:
            return job
        assert time.monotonic() < deadline, f"job {job_id} ยังเป็น {job['state']} เกิน {timeout_s:g} วินาที"
        time.sleep(0.25)


def test_new_propagate_access_intervals_czml_with_real_gmat(real_client, snapshot):
    client = real_client
    assert client.get("/api/health").json()["gmat_found"] is True

    # New จากแม่แบบ (6 ชม.)
    created = client.post("/api/scenarios", json=SCENARIO)
    assert created.status_code == 201, created.text
    assert "G01" in {o["name"] for o in created.json()["objects"] if o["class"] == "Satellite"}
    etag = created.headers["ETag"]

    # ยังไม่มีผลอะไร
    results = client.get("/api/scenarios/IT6H/results").json()
    assert results["error"] is None
    assert results["ephem"]["status"] == "missing" and results["access"]["THBK"]["status"] == "missing"

    # Propagate ด้วย GMAT จริง
    sub = client.post("/api/scenarios/IT6H/propagate")
    assert sub.status_code == 202, sub.text
    job = wait_job(client, sub.json()["job"], PROPAGATE_TIMEOUT_S)
    assert job["state"] == "succeeded", job
    assert job["kind"] == "propagate" and job["error"] is None

    results = client.get("/api/scenarios/IT6H/results").json()
    ephem_hash = results["ephem"]["hash"]
    assert results["ephem"]["status"] == "current" and results["ephem"]["available"] == [ephem_hash]
    assert results["access"]["THBK"]["status"] == "missing"       # propagate อย่างเดียว ยังไม่มีผล access

    # ผลมาจาก GMAT จริง: manifest บอกรุ่น GMAT และ G01 ถูก propagate, SP3 มีตำแหน่งของ G01
    manifest = client.get(f"/api/scenarios/IT6H/ephem/{ephem_hash}/manifest.json").json()
    assert manifest["gmat_version"] and "Fake" not in manifest["gmat_version"]
    assert {s["prn"]: s["propagated"] for s in manifest["satellites"]}["G01"] is True
    assert "\nPG01" in client.get(f"/api/scenarios/IT6H/ephem/{ephem_hash}/predicted.sp3").text

    # Access: THBK -> GPS ต้องสั่ง analyze (ตอบ 202 พร้อม job) แล้วรอ
    comp = client.post("/api/scenarios/IT6H/access/compute", json={"from": FACILITY_PATH, "to": [GPS_PATH]},
                       headers={"If-Match": etag})
    assert comp.status_code == 202, comp.text
    analyze = wait_job(client, comp.json()["job"], ANALYZE_TIMEOUT_S)
    assert analyze["state"] == "succeeded", analyze
    assert analyze["kind"] == "analyze" and analyze["error"] is None

    results = client.get("/api/scenarios/IT6H/results").json()
    assert results["access"]["THBK"]["status"] == "current"

    # ช่วง access ของ GPS: มี G01 และช่วงที่ได้มีเวลาเริ่มก่อนจบ
    r = client.get("/api/scenarios/IT6H/access/intervals", params={"from": FACILITY_PATH, "to": GPS_PATH})
    assert r.status_code == 200, r.text
    intervals = r.json()
    assert "G01" in intervals
    assert intervals["G01"], "G01 ควรมีช่วง access อย่างน้อยหนึ่งช่วงใน 6 ชม."
    assert "G22" not in intervals                                    # no_broadcast: ถูกซ่อนตามตัวกรองตั้งต้น

    # scene.czml ของ ephem เปิดเป็น JSON: packet แรกคือ document
    r = client.get(f"/api/scenarios/IT6H/ephem/{ephem_hash}/scene.czml")
    assert r.status_code == 200, r.text
    packets = json.loads(r.content)
    assert isinstance(packets, list) and packets
    assert packets[0]["id"] == "document"
