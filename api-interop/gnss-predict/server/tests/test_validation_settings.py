"""ค่าตั้งงานประจำวัน (`data/settings.json`) และ validation (หัวข้อ 6.1, 6.8 และ 9.1 ของ spec server)

- settings: GET/PUT `/api/settings`, `settings.load/save`, callback `app.state.settings_on_change` ที่ PUT เรียก (Task 11 ต่อกับตัวตั้งเวลา)
- validate: `POST /scenarios/{sc}/validate` ส่ง job ผ่าน `JobManager.submit` (ตรวจ day/sp3 ที่นั่น) ส่วน test ที่ต้องการผลใช้ engine ปลอมที่เขียน
  `validation_<day>.json` ลง ephem ที่ current และต่อท้าย `history.jsonl` เหมือนของจริง
- ประวัติและไฟล์ผลรายวัน: อ่านแบบไม่ล้ม (บรรทัดเสียข้ามพร้อม log) ไฟล์ทุกไฟล์ต้องอยู่ใต้ `data/` หลังตาม symlink
"""

import json
import logging
import re
import time

import pytest

from gnss_predict import studio

SC = "S1"
DAY = "2026-11-10"
ERROR_KEYS = {"code", "text", "field", "detail"}
THAI = re.compile("[฀-๿]")
DEFAULT_DAILY = {"enabled": True, "run_at_utc": "21:00", "facility": "THBK", "retention_days": 30,
                 "validation_retry_hours": 3, "validation_give_up_days": 14}
DEFAULTS = {"daily": DEFAULT_DAILY, "cesium_ion_token": ""}
CUSTOM = {"daily": {"enabled": False, "run_at_utc": "06:05", "facility": "BKK_2", "retention_days": 7,
                    "validation_retry_hours": 12, "validation_give_up_days": 3},
          "cesium_ion_token": "tok-123"}
DAY_RECORD = {"day": DAY, "scenario": SC, "ephem_hash": "0123456789ab", "facility": "THBK", "pass": True,
              "systems": {"G": {"n": 2}}, "failing": [], "created_utc": "2026-11-11T01:00:00Z"}


# ---------- helpers ----------

def assert_error(r, status, code, field=None):
    assert r.status_code == status, r.text
    j = r.json()
    assert set(j) == ERROR_KEYS and j["code"] == code and j["field"] == field, j
    assert THAI.search(j["text"])
    return j


def settings_with(**daily):
    return {**CUSTOM, "daily": {**CUSTOM["daily"], **daily}}


def server_log(data_dir):
    path = data_dir / "logs" / "server.log"
    return path.read_text(encoding="utf-8") if path.exists() else ""


def wait_job(client, job_id, timeout=10):
    deadline = time.monotonic() + timeout
    while (job := client.get(f"/api/jobs/{job_id}").json())["state"] in ("queued", "running"):
        assert time.monotonic() < deadline, job
        time.sleep(0.02)
    return job


def history_path(data_dir):
    return data_dir / "validation" / "history.jsonl"


def put_day_file(folder, record=DAY_RECORD, day=DAY):
    folder.mkdir(parents=True, exist_ok=True)
    (folder / f"validation_{day}.json").write_text(json.dumps(record), encoding="utf-8")


def moved_dir(data_dir, sc=SC):
    return data_dir / "validation" / sc


def put_doc(client, mutate):
    """แก้ scenario S1 ทั้งเอกสารด้วย PUT พร้อม If-Match"""
    r = client.get(f"/api/scenarios/{SC}")
    doc = r.json()
    mutate(doc)
    ok = client.put(f"/api/scenarios/{SC}", json=doc, headers={"If-Match": r.headers["ETag"]})
    assert ok.status_code == 200, ok.text


# ---------- settings: GET ----------

def test_settings_defaults(client): assert client.get("/api/settings").json()["daily"] == {"enabled": True, "run_at_utc": "21:00", "facility": "THBK", "retention_days": 30, "validation_retry_hours": 3, "validation_give_up_days": 14}


def test_settings_defaults_full_document_and_no_file_written(client, data_dir):
    r = client.get("/api/settings")
    assert r.status_code == 200 and r.json() == DEFAULTS
    assert not (data_dir / "settings.json").exists()                  # GET ไม่เขียนอะไร


# ---------- settings: PUT ----------

def test_settings_put_saves_and_returns_the_document(client, data_dir):
    r = client.put("/api/settings", json=CUSTOM)
    assert r.status_code == 200 and r.json() == CUSTOM
    assert client.get("/api/settings").json() == CUSTOM
    assert json.loads((data_dir / "settings.json").read_text(encoding="utf-8")) == CUSTOM
    assert [p.name for p in data_dir.iterdir() if ".tmp" in p.name] == []        # atomic: ไม่มีไฟล์ชั่วคราวค้าง


def test_settings_put_survives_a_new_app_on_the_same_data(client, data_dir, no_web_dist):
    from fastapi.testclient import TestClient
    from gnss_studio_server.app import create_app
    from gnss_studio_server.config import Config
    assert client.put("/api/settings", json=CUSTOM).status_code == 200
    again = TestClient(create_app(Config(data_dir=data_dir, web_dist=no_web_dist), start_background=False))
    assert again.get("/api/settings").json() == CUSTOM


@pytest.mark.parametrize("bad", ["25:00", "24:00", "12:60", "9:00", "21:0", "21:00:00", "ab:cd", "", "2100", " 21:00", "21:00\n",
                                 "２１:００"])
def test_settings_rejects_bad_time(client, data_dir, bad):
    assert_error(client.put("/api/settings", json=settings_with(run_at_utc=bad)), 422, "SCENARIO_INVALID", "daily.run_at_utc")
    assert not (data_dir / "settings.json").exists()
    assert client.get("/api/settings").json() == DEFAULTS


def test_settings_rejects_bad_time_inside_the_default_document(client):                  # 25:00 → field daily.run_at_utc
    body = {**DEFAULTS, "daily": {**DEFAULT_DAILY, "run_at_utc": "25:00"}}
    assert_error(client.put("/api/settings", json=body), 422, "SCENARIO_INVALID", "daily.run_at_utc")


@pytest.mark.parametrize("hhmm", ["00:00", "23:59", "09:30", "21:00"])
def test_settings_accepts_valid_times(client, hhmm):
    assert client.put("/api/settings", json=settings_with(run_at_utc=hhmm)).json()["daily"]["run_at_utc"] == hhmm


@pytest.mark.parametrize("field, value", [
    ("retention_days", 0), ("retention_days", 3651), ("retention_days", -1),
    ("validation_retry_hours", 0), ("validation_retry_hours", 169),
    ("validation_give_up_days", 0), ("validation_give_up_days", 366),
    ("facility", ""), ("facility", "a b"), ("facility", "x" * 33), ("facility", "../evil"), ("facility", "ทดสอบ"),
    ("facility", "a.b"), ("facility", "TH\n"),
    ("enabled", "yes"), ("enabled", 1), ("enabled", None),
    ("retention_days", "30"), ("retention_days", 30.5), ("retention_days", True), ("retention_days", None),
    ("validation_retry_hours", "3"), ("validation_give_up_days", 14.0), ("run_at_utc", 2100), ("run_at_utc", None),
    ("facility", 5),
])
def test_settings_rejects_out_of_range_and_wrong_types(client, data_dir, field, value):
    assert_error(client.put("/api/settings", json=settings_with(**{field: value})), 422, "SCENARIO_INVALID", f"daily.{field}")
    assert not (data_dir / "settings.json").exists()


@pytest.mark.parametrize("field, low, high", [("retention_days", 1, 3650), ("validation_retry_hours", 1, 168),
                                              ("validation_give_up_days", 1, 365)])
def test_settings_range_boundaries_are_accepted(client, field, low, high):
    for value in (low, high):
        r = client.put("/api/settings", json=settings_with(**{field: value}))
        assert r.status_code == 200 and r.json()["daily"][field] == value


@pytest.mark.parametrize("facility", ["THBK", "a", "x" * 32, "Fac_1-b"])
def test_settings_accepts_facility_names(client, facility):
    assert client.put("/api/settings", json=settings_with(facility=facility)).json()["daily"]["facility"] == facility


def test_settings_rejects_wrong_types_of_the_whole_document(client, data_dir):
    assert_error(client.put("/api/settings", json=settings_with() | {"cesium_ion_token": 5}), 422, "SCENARIO_INVALID", "cesium_ion_token")
    assert_error(client.put("/api/settings", json={**CUSTOM, "daily": "x"}), 422, "SCENARIO_INVALID", "daily")
    assert_error(client.put("/api/settings", json={**CUSTOM, "daily": None}), 422, "SCENARIO_INVALID", "daily")
    assert client.put("/api/settings", json=[1]).status_code == 422
    assert client.put("/api/settings", json=None).status_code == 422
    assert client.put("/api/settings", content=b"{not json", headers={"Content-Type": "application/json"}).status_code == 422
    assert not (data_dir / "settings.json").exists()


def test_settings_rejects_unknown_fields(client, data_dir):                       # พิมพ์ชื่อช่องผิดต้องไม่ถูกเมินเงียบ ๆ
    assert_error(client.put("/api/settings", json={**CUSTOM, "daily": {**CUSTOM["daily"], "retention_day": 5}}), 422,
                 "SCENARIO_INVALID", "daily.retention_day")
    assert_error(client.put("/api/settings", json={**CUSTOM, "extra": 1}), 422, "SCENARIO_INVALID", "extra")
    assert not (data_dir / "settings.json").exists()


def test_settings_put_replaces_the_whole_document(client):
    client.put("/api/settings", json=CUSTOM)
    r = client.put("/api/settings", json={"daily": CUSTOM["daily"]})                # ไม่ส่ง token: ค่าตั้งต้น ไม่ใช่ค่าเก่า
    assert r.status_code == 200 and r.json() == {**CUSTOM, "cesium_ion_token": ""}


def test_settings_keeps_non_ascii_token_intact(client, data_dir):
    r = client.put("/api/settings", json={**CUSTOM, "cesium_ion_token": "โทเคน-ü"})
    assert r.status_code == 200 and client.get("/api/settings").json()["cesium_ion_token"] == "โทเคน-ü"


# ---------- settings: callback ไปยังตัวตั้งเวลา ----------

def test_settings_put_calls_the_callback_once_with_the_new_settings(client, data_dir):
    from gnss_studio_server import settings as settings_module
    calls = []

    def on_change(new):
        calls.append((new, json.loads((data_dir / "settings.json").read_text(encoding="utf-8"))))   # เรียกหลังบันทึกแล้ว

    client.app.state.settings_on_change = on_change
    assert client.get("/api/settings").status_code == 200
    assert calls == []                                                               # GET ไม่เรียก
    assert client.put("/api/settings", json=CUSTOM).status_code == 200
    assert len(calls) == 1
    new, on_disk = calls[0]
    assert isinstance(new, settings_module.Settings) and new == settings_module.Settings.model_validate(CUSTOM)
    assert on_disk == CUSTOM


def test_settings_put_default_callback_is_a_noop(client):
    assert callable(client.app.state.settings_on_change)
    assert client.put("/api/settings", json=CUSTOM).status_code == 200


def test_settings_rejected_put_does_not_call_the_callback(client):
    calls = []
    client.app.state.settings_on_change = calls.append
    assert client.put("/api/settings", json=settings_with(run_at_utc="25:00")).status_code == 422
    assert calls == []


def test_settings_callback_failure_is_logged_and_the_save_stands(client, data_dir):
    def boom(new):
        raise RuntimeError("scheduler down")

    client.app.state.settings_on_change = boom
    r = client.put("/api/settings", json=CUSTOM)
    assert r.status_code == 200 and r.json() == CUSTOM                               # บันทึกแล้ว ผู้ใช้ไม่ต้องเห็น 500
    assert client.get("/api/settings").json() == CUSTOM
    log = server_log(data_dir)
    assert "scheduler down" in log and "Traceback" in log


# ---------- settings: load/save และไฟล์เสีย ----------

def test_settings_load_missing_file_gives_defaults(data_dir):
    from gnss_studio_server import settings
    assert settings.load(data_dir) == settings.Settings()
    assert settings.Settings().model_dump() == DEFAULTS


def test_settings_save_then_load_roundtrip_is_atomic(data_dir):
    from gnss_studio_server import settings
    new = settings.Settings.model_validate(CUSTOM)
    settings.save(data_dir, new)
    assert settings.load(data_dir) == new
    assert json.loads((data_dir / "settings.json").read_text(encoding="utf-8")) == CUSTOM
    settings.save(data_dir, settings.Settings())                                      # เขียนทับได้
    assert settings.load(data_dir) == settings.Settings()
    assert sorted(p.name for p in data_dir.iterdir()) == ["settings.json"]            # ไม่มีไฟล์ชั่วคราวค้าง


@pytest.mark.parametrize("content", [
    b"{not json", b"", b"[]", b'"x"', b"null", b"\xff\xfe\x00bad", b'{"daily": {"run_at_utc": "25:00"}}',
    b'{"daily": {"retention_days": 0}}', b'{"daily": {"retention_days": "30"}}', b'{"daily": 5}', b'{"cesium_ion_token": 7}',
    b'{"daily": {"enabled": NaN}}', b'{"daily": {"nope": 1}}',
])
def test_settings_corrupt_or_invalid_file_gives_defaults_and_logs(client, data_dir, content):
    (data_dir / "settings.json").write_bytes(content)
    r = client.get("/api/settings")
    assert r.status_code == 200 and r.json() == DEFAULTS
    assert "settings.json" in server_log(data_dir)                                    # เตือนใน server.log ของแอป


def test_settings_load_logs_a_warning_with_the_given_logger(data_dir, caplog):
    from gnss_studio_server import settings
    (data_dir / "settings.json").write_text("{nope", encoding="utf-8")
    with caplog.at_level(logging.WARNING):
        assert settings.load(data_dir) == settings.Settings()
    assert [r.levelno for r in caplog.records] == [logging.WARNING] and "settings.json" in caplog.records[0].getMessage()
    own = logging.Logger("own")
    seen = []
    own.addHandler(type("H", (logging.Handler,), {"emit": lambda self, rec: seen.append(rec)})())
    settings.load(data_dir, own)
    assert len(seen) == 1 and seen[0].levelno == logging.WARNING


def test_settings_file_is_a_directory_gives_defaults(client, data_dir):
    (data_dir / "settings.json").mkdir()
    assert client.get("/api/settings").json() == DEFAULTS


def test_put_after_corrupt_file_replaces_it(client, data_dir):
    (data_dir / "settings.json").write_text("{nope", encoding="utf-8")
    assert client.put("/api/settings", json=CUSTOM).status_code == 200
    assert client.get("/api/settings").json() == CUSTOM


# ---------- validate: ส่ง job ----------

def validate(client, body=None, sc=SC):
    return client.post(f"/api/scenarios/{sc}/validate", json=body if body is not None else {"day": DAY})


def test_validate_returns_202_and_a_queued_job(client, s1):
    r = validate(client)
    assert r.status_code == 202 and set(r.json()) == {"job"}
    job = client.get(f"/api/jobs/{r.json()['job']}").json()
    assert job["kind"] == "validate" and job["scenario"] == SC and job["params"] == {"day": DAY} and job["state"] == "queued"
    again = validate(client)                                                         # ซ้ำกับงานที่ยังรอ: id เดิม (ผ่าน jobs.submit)
    assert again.status_code == 202 and again.json() == r.json()


def test_validate_passes_sp3_through(client, s1, data_dir):
    (data_dir / "sp3").mkdir()
    (data_dir / "sp3" / "truth.sp3").write_text("x")
    r = validate(client, {"day": DAY, "sp3": "sp3/truth.sp3"})
    assert r.status_code == 202
    assert client.get(f"/api/jobs/{r.json()['job']}").json()["params"] == {"day": DAY, "sp3": "sp3/truth.sp3"}


def test_validate_sp3_outside_data_rejected(client, s1):
    for bad in ["../outside.sp3", "/etc/passwd", "sp3/../../x.sp3", "", ".", "..", "a/../.."]:
        assert_error(validate(client, {"day": DAY, "sp3": bad}), 422, "SCENARIO_INVALID", "sp3")
    assert client.get("/api/jobs").json() == []                                       # ไม่มี job ถูกสร้าง


def test_validate_sp3_symlink_out_of_data_rejected(client, s1, data_dir, tmp_path):
    outside = tmp_path / "outside.sp3"
    outside.write_text("x")
    (data_dir / "link.sp3").symlink_to(outside)
    assert_error(validate(client, {"day": DAY, "sp3": "link.sp3"}), 422, "SCENARIO_INVALID", "sp3")
    assert client.get("/api/jobs").json() == []


@pytest.mark.parametrize("bad", ["2026-13-01", "20261110", "2026-1-1", "", "tomorrow", "2026-02-30", " 2026-11-10", None, 20261110])
def test_validate_bad_day_rejected(client, s1, bad):
    assert_error(validate(client, {"day": bad}), 422, "SCENARIO_INVALID", "day")
    assert client.get("/api/jobs").json() == []


def test_validate_missing_or_wrong_body(client, s1):
    assert_error(validate(client, {}), 422, "SCENARIO_INVALID", "day")
    assert_error(validate(client, {"day": DAY, "sp3": 5}), 422, "SCENARIO_INVALID", "sp3")
    assert_error(validate(client, {"day": DAY, "bogus": 1}), 422, "SCENARIO_INVALID", "bogus")
    assert client.post(f"/api/scenarios/{SC}/validate", content=b"not json", headers={"Content-Type": "application/json"}).status_code == 422
    assert client.get("/api/jobs").json() == []


def test_validate_missing_scenario_is_404(client, s1):
    assert_error(validate(client, sc="Nope"), 404, "NOT_FOUND")
    assert client.get("/api/jobs").json() == []


@pytest.mark.parametrize("bad", ["a.b", "x" * 33, "ทดสอบ", "a b"])
def test_validate_unsafe_scenario_name_is_422(client, s1, bad):
    assert_error(validate(client, sc=bad), 422, "SCENARIO_INVALID", "scenario")


def test_validate_job_and_day_file(client_inline, s1_computed, data_dir, monkeypatch):
    ephem_dir = s1_computed["ephem_dir"]
    calls = []

    def fake_run_validate(scenario_dir, day, data_dir_, sp3=None, facility=None, console=None, progress=None,
                          on_gmat_start=None):
        calls.append((scenario_dir, day, data_dir_, sp3, facility))
        document = {**DAY_RECORD, "ephem_hash": ephem_dir.name, "detail": {"G01": [0.1, 0.2]}, "thai": "ผ่าน"}
        (ephem_dir / f"validation_{day.isoformat()}.json").write_text(json.dumps(document, ensure_ascii=False), encoding="utf-8")
        history_path(data_dir_).parent.mkdir(parents=True, exist_ok=True)
        with open(history_path(data_dir_), "ab") as f:
            f.write((json.dumps({**DAY_RECORD, "ephem_hash": ephem_dir.name}) + "\n").encode("utf-8"))
        return ephem_dir, []

    monkeypatch.setattr(studio, "run_validate", fake_run_validate)
    assert client_inline.get(f"/api/validation/{SC}/{DAY}").status_code == 404        # ก่อนรัน ยังไม่มีไฟล์
    r = validate(client_inline)
    assert r.status_code == 202
    job = wait_job(client_inline, r.json()["job"])
    assert job["state"] == "succeeded", job
    assert job["result"]["path"] == f"scenarios/{SC}/ephem/{ephem_dir.name}"
    assert len(calls) == 1
    scenario_dir, day, data_dir_, sp3, facility = calls[0]
    assert (scenario_dir.name, str(day), data_dir_, sp3, facility) == (SC, DAY, data_dir, None, None)

    got = client_inline.get(f"/api/validation/{SC}/{DAY}")
    assert got.status_code == 200 and got.headers["content-type"].startswith("application/json")
    assert got.json() == {**DAY_RECORD, "ephem_hash": ephem_dir.name, "detail": {"G01": [0.1, 0.2]}, "thai": "ผ่าน"}
    history = client_inline.get("/api/validation/history")
    assert history.status_code == 200 and history.json() == [{**DAY_RECORD, "ephem_hash": ephem_dir.name}]


def test_validate_job_passes_sp3_under_data_to_the_engine(client_inline, s1_computed, data_dir, monkeypatch):
    (data_dir / "truth").mkdir()
    (data_dir / "truth" / "day.sp3").write_text("x")
    seen = {}

    def fake_run_validate(scenario_dir, day, data_dir_, sp3=None, **kw):
        seen["sp3"] = sp3
        return s1_computed["ephem_dir"], []

    monkeypatch.setattr(studio, "run_validate", fake_run_validate)
    job = wait_job(client_inline, validate(client_inline, {"day": DAY, "sp3": "truth/day.sp3"}).json()["job"])
    assert job["state"] == "succeeded", job
    assert seen["sp3"] == data_dir / "truth" / "day.sp3"


# ---------- GET /validation/{sc}/{day} ----------

def day_url(sc=SC, day=DAY):
    return f"/api/validation/{sc}/{day}"


def test_day_file_from_the_current_bundle(client, s1_computed):
    put_day_file(s1_computed["ephem_dir"])
    r = client.get(day_url())
    assert r.status_code == 200 and r.json() == DAY_RECORD
    assert client.get(day_url(day="2026-11-09")).status_code == 404                     # วันอื่นไม่มี


def test_day_file_prefers_the_current_bundle_over_the_moved_copy(client, s1_computed, data_dir):
    put_day_file(s1_computed["ephem_dir"], {**DAY_RECORD, "where": "bundle"})
    put_day_file(moved_dir(data_dir), {**DAY_RECORD, "where": "moved"})
    assert client.get(day_url()).json()["where"] == "bundle"


def test_day_file_falls_back_to_the_moved_copy(client, s1_computed, data_dir):
    put_day_file(moved_dir(data_dir), {**DAY_RECORD, "where": "moved"})                # หลังเก็บรักษา ephem/ ถูกลบ
    assert client.get(day_url()).json()["where"] == "moved"
    import shutil
    shutil.rmtree(s1_computed["ephem_dir"].parent)                                      # ไม่มี ephem/ เลย
    assert client.get(day_url()).json()["where"] == "moved"


def test_day_file_in_a_stale_bundle_is_not_current(client, s1_computed, data_dir):
    put_day_file(s1_computed["ephem_dir"], {**DAY_RECORD, "where": "bundle"})
    put_doc(client, lambda doc: doc["analysis_period"].update(stop="2026-11-10T05:00:00Z"))   # hash ของ ephem เปลี่ยน → bundle เดิม stale
    assert client.get(f"/api/scenarios/{SC}/results").json()["ephem"]["status"] == "stale"
    assert_error(client.get(day_url()), 404, "NOT_FOUND")
    put_day_file(moved_dir(data_dir), {**DAY_RECORD, "where": "moved"})
    assert client.get(day_url()).json()["where"] == "moved"


def test_day_file_with_no_computed_bundle_is_404(client, s1):
    j = assert_error(client.get(day_url()), 404, "NOT_FOUND")
    assert j["detail"] is None


def test_day_file_of_a_deleted_scenario_is_still_served_from_validation(client, data_dir):
    put_day_file(moved_dir(data_dir, "Gone"), {**DAY_RECORD, "scenario": "Gone"})
    assert client.get(day_url("Gone")).json()["scenario"] == "Gone"                     # data/validation/ เก็บไว้ถึงแม้ scenario หาย
    assert_error(client.get(day_url("Other")), 404, "NOT_FOUND")


@pytest.mark.parametrize("bad", ["2026-13-01", "20261110", "2026-1-1", "abc", "2026-02-30", "2026-11-10 ", "๒๐๒๖-๑๑-๑๐", "x" * 100])
def test_day_file_bad_day_is_422(client, s1_computed, bad):
    assert_error(client.get(day_url(day=bad)), 422, "SCENARIO_INVALID", "day")


@pytest.mark.parametrize("bad", ["a.b", "x" * 33, "ทดสอบ", "a b", "%2e%2e", "S1%2F..%2F..", "S1%00"])
def test_day_file_bad_scenario_name_is_422_or_404(client, s1_computed, data_dir, bad):
    r = client.get(day_url(bad))
    assert r.status_code in (404, 422), r.text
    assert set(r.json()) == ERROR_KEYS


@pytest.mark.parametrize("day", ["..", "2026-11-10%2F..", "%2e%2e", "..%2F..%2Fetc", "2026-11-10%00"])
def test_day_file_traversal_in_day_never_serves_a_file(client, s1_computed, data_dir, tmp_path, day):
    (tmp_path / "victim.json").write_text('{"secret": true}')
    r = client.get(f"/api/validation/{SC}/{day}")
    assert r.status_code in (404, 422), r.text
    assert set(r.json()) == ERROR_KEYS and "secret" not in r.text


def test_day_file_bad_scenario_name_is_422_on_name(client, s1_computed):
    assert_error(client.get(day_url("a.b")), 422, "SCENARIO_INVALID", "name")
    assert_error(client.get(day_url("x" * 33)), 422, "SCENARIO_INVALID", "name")


def test_day_file_never_reads_outside_data(client, s1_computed, data_dir, tmp_path):
    outside = tmp_path / "outside"
    outside.mkdir()
    put_day_file(outside, {"secret": True})
    # scenario ที่ชี้ออกนอก: data/validation/S1 และไฟล์ในนั้นเป็น symlink ออกนอก data/
    (data_dir / "validation").mkdir()
    (data_dir / "validation" / SC).symlink_to(outside, target_is_directory=True)
    assert_error(client.get(day_url()), 404, "NOT_FOUND")
    (data_dir / "validation" / SC).unlink()
    (data_dir / "validation" / SC).mkdir()
    (data_dir / "validation" / SC / f"validation_{DAY}.json").symlink_to(outside / f"validation_{DAY}.json")
    assert_error(client.get(day_url()), 404, "NOT_FOUND")
    # ไฟล์ใน bundle เป็น symlink ออกนอก data/
    (s1_computed["ephem_dir"] / f"validation_{DAY}.json").symlink_to(outside / f"validation_{DAY}.json")
    assert_error(client.get(day_url()), 404, "NOT_FOUND")


@pytest.mark.parametrize("content", [b"{bad", b"", b"[1]", b'"x"', b"null", b"\xff\xfe\x00", b'{"x": NaN}', b'{"x": Infinity}', b'{"x": 1e999}'])
def test_day_file_unreadable_is_not_served(client, s1_computed, data_dir, content):
    (s1_computed["ephem_dir"] / f"validation_{DAY}.json").write_bytes(content)
    assert_error(client.get(day_url()), 404, "NOT_FOUND")
    assert "validation_" in server_log(data_dir)                                         # เตือนใน log
    put_day_file(moved_dir(data_dir), {**DAY_RECORD, "where": "moved"})                  # ไฟล์เสียใน bundle: ใช้ที่เก็บรักษาแทน
    assert client.get(day_url()).json()["where"] == "moved"


def test_day_file_directory_in_place_of_file_is_404(client, s1_computed):
    (s1_computed["ephem_dir"] / f"validation_{DAY}.json").mkdir()
    assert_error(client.get(day_url()), 404, "NOT_FOUND")


# ---------- GET /validation/history ----------

def test_history_missing_file_is_empty_list(client, data_dir):
    r = client.get("/api/validation/history")
    assert r.status_code == 200 and r.json() == []
    (data_dir / "validation").mkdir()
    assert client.get("/api/validation/history").json() == []


def test_history_returns_lines_in_file_order(client, data_dir):
    records = [{**DAY_RECORD, "day": f"2026-11-{d:02d}", "n": n} for n, d in enumerate((10, 3, 12, 3))]       # ไม่เรียงใหม่
    history_path(data_dir).parent.mkdir(parents=True)
    history_path(data_dir).write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in records), encoding="utf-8")
    assert client.get("/api/validation/history").json() == records


def test_history_skips_bad_lines(client, data_dir):
    good_a, good_b, good_c = ({**DAY_RECORD, "n": n} for n in range(3))
    bad = [b"{not json", b"[1, 2]", b'"text"', b"42", b"null", b"true", b'{"x": NaN}', b"\xff\xfe broken utf8", b'{"day": "2026-11-1',
           b'{"a": 1} trailing', b'{"x": 1e999}']
    lines = [json.dumps(good_a).encode(), *bad[:4], b"", json.dumps(good_b).encode(), *bad[4:], b"   ", json.dumps(good_c).encode()]
    history_path(data_dir).parent.mkdir(parents=True)
    history_path(data_dir).write_bytes(b"\n".join(lines))                                # ไม่มี \n ท้ายไฟล์: บรรทัดสุดท้ายยังอ่านได้
    r = client.get("/api/validation/history")
    assert r.status_code == 200 and r.json() == [good_a, good_b, good_c]
    warnings = [line for line in server_log(data_dir).splitlines() if "history.jsonl" in line]
    assert len(warnings) == len(bad)                                                     # log ทุกบรรทัดที่ข้าม (ไม่รวมบรรทัดว่าง)
    assert all(" WARNING " in line for line in warnings)
    for number in (2, 3, 4, 5, 8, 13, 14):                                              # บอกเลขบรรทัดให้ไปหาได้
        assert any(f"บรรทัด {number} " in line for line in warnings), number
    assert not any(f"บรรทัด {number} " in line for line in warnings for number in (1, 6, 7, 15, 16))


def test_history_that_is_a_directory_or_unreadable_is_empty(client, data_dir):
    history_path(data_dir).mkdir(parents=True)
    assert client.get("/api/validation/history").json() == []
    assert "history.jsonl" in server_log(data_dir)


def test_history_outside_data_is_not_read(client, data_dir, tmp_path):
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "history.jsonl").write_text(json.dumps({"secret": True}) + "\n", encoding="utf-8")
    (data_dir / "validation").symlink_to(outside, target_is_directory=True)
    assert client.get("/api/validation/history").json() == []
    (data_dir / "validation").unlink()
    (data_dir / "validation").mkdir()
    (data_dir / "validation" / "history.jsonl").symlink_to(outside / "history.jsonl")
    assert client.get("/api/validation/history").json() == []


def test_history_route_is_not_shadowed_by_the_day_route(client, data_dir):
    history_path(data_dir).parent.mkdir(parents=True)
    history_path(data_dir).write_text(json.dumps(DAY_RECORD) + "\n", encoding="utf-8")
    assert client.get("/api/validation/history").json() == [DAY_RECORD]
    assert_error(client.get(day_url("history")), 404, "NOT_FOUND")                      # scenario ชื่อ history ไม่มี
