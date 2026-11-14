"""ค่าตั้งงานประจำวัน (`data/settings.json`) และ validation (หัวข้อ 6.1, 6.8 และ 9.1 ของ spec server)

- settings: GET/PUT `/api/settings`, `settings.load/save`, callback `app.state.settings_on_change` ที่ PUT เรียก (Task 11 ต่อกับตัวตั้งเวลา)
- validate: `POST /scenarios/{sc}/validate` ส่ง job ผ่าน `JobManager.submit` (ตรวจ day/sp3 ที่นั่น) ส่วน test ที่ต้องการผลใช้ engine ปลอมที่เขียน
  `validation_<day>.json` ลง ephem ที่ current และต่อท้าย `history.jsonl` เหมือนของจริง
- ประวัติและไฟล์ผลรายวัน: อ่านแบบไม่ล้ม (บรรทัดเสียข้ามพร้อม log) ไฟล์ทุกไฟล์ต้องอยู่ใต้ `data/` หลังตาม symlink
"""

import copy
import json
import logging
import os
import re
import threading
import time

import pytest

from gnss_predict import studio

SC = "S1"
DAY = "2026-11-10"
ERROR_KEYS = {"code", "text", "field", "detail"}
THAI = re.compile("[฀-๿]")
DEFAULT_DAILY = {"enabled": True, "run_at_utc": "21:00", "facility": "THBK", "retention_days": 30,
                 "validation_retry_hours": 3, "validation_give_up_days": 14}
DEFAULTS = {"daily": DEFAULT_DAILY, "cesium_ion_token": "", "online_imagery": {"enabled": False}}
FAIL_SAFE = {**DEFAULTS, "daily": {**DEFAULT_DAILY, "enabled": False}}       # ไฟล์ค่าตั้งเสีย: ไม่เปิดงานดึงข้อมูลเอง
CUSTOM = {"daily": {"enabled": False, "run_at_utc": "06:05", "facility": "BKK_2", "retention_days": 7,
                    "validation_retry_hours": 12, "validation_give_up_days": 3},
          "cesium_ion_token": "tok-123", "online_imagery": {"enabled": True}}
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


def capture_logger(name="capture"):
    """(logger, รายการ record ที่ถูก log) สำหรับตรวจว่า settings.load เตือนกี่ครั้ง"""
    logger, seen = logging.Logger(name), []
    logger.addHandler(type("H", (logging.Handler,), {"emit": lambda self, rec: seen.append(rec)})())
    return logger, seen


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
    from conftest import make_client
    from gnss_studio_server.app import create_app
    from gnss_studio_server.config import Config
    assert client.put("/api/settings", json=CUSTOM).status_code == 200
    again = make_client(create_app(Config(data_dir=data_dir, web_dist=no_web_dist), start_background=False))
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
    assert_error(client.put("/api/settings", json={**CUSTOM, "online_imagery": True}), 422, "SCENARIO_INVALID", "online_imagery")
    assert_error(client.put("/api/settings", json={**CUSTOM, "online_imagery": None}), 422, "SCENARIO_INVALID", "online_imagery")
    assert client.put("/api/settings", json=[1]).status_code == 422
    assert client.put("/api/settings", json=None).status_code == 422
    assert client.put("/api/settings", content=b"{not json", headers={"Content-Type": "application/json"}).status_code == 422
    assert not (data_dir / "settings.json").exists()


def test_settings_rejects_unknown_fields(client, data_dir):                       # พิมพ์ชื่อช่องผิดต้องไม่ถูกเมินเงียบ ๆ
    assert_error(client.put("/api/settings", json={**CUSTOM, "daily": {**CUSTOM["daily"], "retention_day": 5}}), 422,
                 "SCENARIO_INVALID", "daily.retention_day")
    assert_error(client.put("/api/settings", json={**CUSTOM, "extra": 1}), 422, "SCENARIO_INVALID", "extra")
    assert not (data_dir / "settings.json").exists()


def test_settings_put_requires_the_whole_document(client, data_dir):
    client.put("/api/settings", json=CUSTOM)
    before = (data_dir / "settings.json").read_bytes()
    r = client.put("/api/settings", json={"daily": CUSTOM["daily"]})                  # ไม่ส่ง token: ไม่เติมค่าตั้งต้นให้
    assert_error(r, 422, "SCENARIO_INVALID", "cesium_ion_token")
    assert (data_dir / "settings.json").read_bytes() == before
    assert client.get("/api/settings").json() == CUSTOM


MISSING_PATHS = ["daily", "cesium_ion_token", "online_imagery", "online_imagery.enabled", *(f"daily.{name}" for name in DEFAULT_DAILY)]


@pytest.mark.parametrize("path", MISSING_PATHS)
def test_settings_put_missing_field_is_422_and_saves_nothing(client, data_dir, path):
    calls = []
    client.app.state.settings_on_change = calls.append
    body = copy.deepcopy(CUSTOM)
    parent = body
    *parents, leaf = path.split(".")
    for key in parents:
        parent = parent[key]
    del parent[leaf]
    assert_error(client.put("/api/settings", json=body), 422, "SCENARIO_INVALID", path)
    assert not (data_dir / "settings.json").exists() and calls == []                  # ไม่บันทึก ไม่แจ้งตัวตั้งเวลา


def test_settings_put_empty_documents_never_enable_the_daily_job(client, data_dir):
    for body, field in [({}, "daily"), ({"daily": {}}, "daily.enabled"), ({"cesium_ion_token": ""}, "daily")]:
        assert_error(client.put("/api/settings", json=body), 422, "SCENARIO_INVALID", field)
    assert not (data_dir / "settings.json").exists()
    assert client.put("/api/settings", json=FAIL_SAFE).json() == FAIL_SAFE            # ครบทั้งก้อนแล้ว enabled=false ต้องคงอยู่


def test_settings_keeps_non_ascii_token_intact(client, data_dir):
    r = client.put("/api/settings", json={**CUSTOM, "cesium_ion_token": "โทเคน-ü"})
    assert r.status_code == 200 and client.get("/api/settings").json()["cesium_ion_token"] == "โทเคน-ü"


# ---------- settings: online_imagery (ภาพออนไลน์ NASA GIBS ปิดไว้ก่อน) ----------

OLD_DOCUMENT = {"daily": {**DEFAULT_DAILY, "enabled": False}, "cesium_ion_token": ""}   # ไฟล์ที่รุ่นก่อนเขียน (ไม่มี online_imagery)


def test_settings_default_has_online_imagery_off(client, data_dir):
    r = client.get("/api/settings")
    assert r.status_code == 200 and r.json()["online_imagery"] == {"enabled": False}
    assert not (data_dir / "settings.json").exists()


def test_old_settings_file_without_online_imagery_loads_off(client, data_dir):
    path = data_dir / "settings.json"
    path.write_text(json.dumps(OLD_DOCUMENT, indent=2) + "\n", encoding="utf-8")
    before = path.read_bytes()
    r = client.get("/api/settings")
    assert r.status_code == 200
    assert r.json()["online_imagery"]["enabled"] is False
    assert r.json()["daily"] == OLD_DOCUMENT["daily"]
    assert path.read_bytes() == before                                                # โหลดแล้วไม่เขียนไฟล์
    assert "settings.json" not in server_log(data_dir)                                # ไฟล์เก่าไม่ใช่ไฟล์เสีย: ไม่เตือน


def test_hand_edited_online_imagery_is_read_and_never_written_on_load(client, data_dir):
    path = data_dir / "settings.json"
    path.write_text(json.dumps({"daily": {"enabled": False}, "online_imagery": {"enabled": True}}), encoding="utf-8")
    before = path.read_bytes()
    assert client.get("/api/settings").json()["online_imagery"] == {"enabled": True}
    assert path.read_bytes() == before


def test_put_requires_online_imagery(client, data_dir):
    calls = []
    client.app.state.settings_on_change = calls.append
    assert_error(client.put("/api/settings", json=OLD_DOCUMENT), 422, "SCENARIO_INVALID", "online_imagery")
    assert_error(client.put("/api/settings", json={**OLD_DOCUMENT, "online_imagery": {}}), 422, "SCENARIO_INVALID",
                 "online_imagery.enabled")
    assert not (data_dir / "settings.json").exists() and calls == []                  # ไม่บันทึก ไม่แจ้งใคร


def test_put_online_imagery_strict_bool(client, data_dir):
    for bad in ("true", 1, None):
        assert_error(client.put("/api/settings", json={**OLD_DOCUMENT, "online_imagery": {"enabled": bad}}), 422,
                     "SCENARIO_INVALID", "online_imagery.enabled")
    assert_error(client.put("/api/settings", json={**OLD_DOCUMENT, "online_imagery": {"enabled": True, "x": 1}}), 422,
                 "SCENARIO_INVALID", "online_imagery.x")
    assert not (data_dir / "settings.json").exists()
    r = client.put("/api/settings", json={**OLD_DOCUMENT, "online_imagery": {"enabled": True}})
    assert r.status_code == 200 and r.json()["online_imagery"] == {"enabled": True}
    assert json.loads((data_dir / "settings.json").read_text(encoding="utf-8"))["online_imagery"] == {"enabled": True}
    assert client.get("/api/settings").json()["online_imagery"] == {"enabled": True}


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


def test_overlapping_puts_are_serialised(client, data_dir):
    first, second = settings_with(run_at_utc="01:00"), settings_with(run_at_utc="02:00")
    entered, release, order = threading.Event(), threading.Event(), []

    def on_change(new):
        order.append(("start", new.daily.run_at_utc))
        if new.daily.run_at_utc == "01:00":
            entered.set()
            assert release.wait(10)
        order.append(("end", new.daily.run_at_utc))

    client.app.state.settings_on_change = on_change
    results = {}
    thread_a = threading.Thread(target=lambda: results.update(a=client.put("/api/settings", json=first)))
    thread_b = threading.Thread(target=lambda: results.update(b=client.put("/api/settings", json=second)))
    thread_a.start()
    assert entered.wait(10)                                                           # A บันทึกแล้วและค้างใน callback
    thread_b.start()
    time.sleep(0.3)                                                                   # ให้ B ถึงล็อก
    assert order == [("start", "01:00")]                                              # B ยังไม่บันทึกและไม่เรียก callback
    assert json.loads((data_dir / "settings.json").read_text(encoding="utf-8")) == first
    release.set()
    thread_a.join(10)
    thread_b.join(10)
    assert results["a"].status_code == results["b"].status_code == 200
    assert order == [("start", "01:00"), ("end", "01:00"), ("start", "02:00"), ("end", "02:00")]
    assert client.get("/api/settings").json() == second                              # ไฟล์กับ callback ครั้งสุดท้ายตรงกัน


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
    b'{"daily": {"enabled": NaN}}', b'{"daily": {"enabled": "false"}}', b'{"daily": {"enabled": 0}}',
    b'\xef\xbb\xbf{not json', b'{"daily": {"enabled": false, "retention_days": "30"}}',
    b'{"daily": {"enabled": true, "retention_days": "30"}}', b'{"daily": {"enabled": false, "facility": "a b"}}',
    b'{"daily": {"enabled": true}, "online_imagery": {"enabled": "true"}}', b'{"daily": {"enabled": true}, "online_imagery": 1}',
    b'{"daily": {"enabled": false}, "online_imagery": {"enabled": 1}}',                 # ภาพออนไลน์ผิดชนิด: ทั้งไฟล์ fail safe (ปิดทั้งคู่)
])
def test_settings_corrupt_or_invalid_file_fails_safe_and_logs(client, data_dir, content):
    (data_dir / "settings.json").write_bytes(content)
    r = client.get("/api/settings")
    assert r.status_code == 200 and r.json() == FAIL_SAFE                            # ค่าตั้งต้นแต่ปิดงานประจำวัน (ไม่ดึง CelesTrak เอง)
    assert "settings.json" in server_log(data_dir)                                    # เตือนใน server.log ของแอป


def test_settings_missing_file_keeps_the_approved_defaults_enabled(client, data_dir):
    from gnss_studio_server import settings
    assert not (data_dir / "settings.json").exists()
    assert client.get("/api/settings").json()["daily"]["enabled"] is True
    assert settings.load(data_dir).daily.enabled is True
    assert "settings.json" not in server_log(data_dir)


@pytest.mark.parametrize("content", [
    b'{"daily": {"enabled": false}}',                                                  # ไฟล์ไม่ครบ: ช่องที่หายได้ค่าตั้งต้น
    b'\xef\xbb\xbf{"daily": {"enabled": false}}',                                      # BOM ที่ Notepad ใส่ให้
    b'{"daily": {"enabled": false, "future_field": 1}}',                              # ช่องที่ไม่รู้จัก (รุ่นใหม่กว่าหรือพิมพ์ผิด) ถูกเมิน
    b'{"daily": {"enabled": false}, "future_top": {"a": 1}}',
    b'\xef\xbb\xbf{"daily": {"enabled": false, "oops": 1}, "oops2": 2}',
    b'{"daily": {"enabled": false}, "cesium_ion_token": ""}',
])
def test_settings_harmless_noise_never_flips_enabled_false(client, data_dir, content):
    (data_dir / "settings.json").write_bytes(content)
    assert client.get("/api/settings").json() == FAIL_SAFE
    assert "settings.json" not in server_log(data_dir)                                # ไม่ใช่ไฟล์เสีย: ไม่เตือน


def test_settings_partial_file_fills_missing_fields_with_defaults(client, data_dir):
    path = data_dir / "settings.json"
    path.write_text(json.dumps({"daily": {"enabled": True, "run_at_utc": "06:00", "retention_days": 7}}))
    assert client.get("/api/settings").json() == {**DEFAULTS, "daily": {**DEFAULT_DAILY, "run_at_utc": "06:00", "retention_days": 7}}
    path.write_text(json.dumps({"daily": {"enabled": True}}))                          # มี enabled อย่างเดียว: ที่เหลือเป็นค่าตั้งต้น
    assert client.get("/api/settings").json() == DEFAULTS
    path.write_text(json.dumps({"daily": {"enabled": False, "facility": "BKK"}, "cesium_ion_token": "t"}))
    assert client.get("/api/settings").json() == {"daily": {**DEFAULT_DAILY, "enabled": False, "facility": "BKK"},
                                                  "cesium_ion_token": "t", "online_imagery": {"enabled": False}}


@pytest.mark.parametrize("content", [
    b"{}", b'{"daily": {}}', b'{"cesium_ion_token": "x"}',                             # ไม่ได้ระบุ daily.enabled เลย
    b'{"daily": {"enable": false}}', b'{"daily": {"Enabled": false}}',                  # พิมพ์ชื่อช่องผิด ถูกเมินโดย extra="ignore"
    b'{"daily": {"run_at_utc": "06:00", "retention_days": 7}}', b'\xef\xbb\xbf{"daily": {"enabled_": true}}',
])
def test_settings_file_without_an_explicit_enabled_fails_safe(client, data_dir, content):
    from gnss_studio_server import settings
    (data_dir / "settings.json").write_bytes(content)
    assert client.get("/api/settings").json() == FAIL_SAFE                            # ไม่ยืนยัน enabled: ไม่เปิดงานดึงข้อมูลเอง
    assert settings.load(data_dir).daily.enabled is False
    assert sum("settings.json" in line for line in server_log(data_dir).splitlines()) == 1     # เตือนครั้งเดียวต่อสถานะไฟล์
    assert "daily.enabled" in server_log(data_dir)                                    # บอกว่าขาดอะไร


def test_settings_missing_enabled_warns_once_and_recovers_when_added(data_dir):
    from gnss_studio_server import settings
    logger, seen = capture_logger()
    path = data_dir / "settings.json"
    path.write_text("{}", encoding="utf-8")
    for _ in range(4):
        assert settings.load(data_dir, logger) == settings.Settings(daily=settings.Daily(enabled=False))
    assert len(seen) == 1 and seen[0].levelno == logging.WARNING
    path.write_text(json.dumps({"daily": {"enabled": True}}), encoding="utf-8")        # ผู้ใช้ใส่ enabled แล้ว ใช้ค่าในไฟล์ ไม่เตือน
    assert settings.load(data_dir, logger) == settings.Settings()
    assert len(seen) == 1


def test_settings_lenient_load_still_checks_types_and_ranges(client, data_dir):
    (data_dir / "settings.json").write_text(json.dumps({"daily": {"enabled": True, "retention_days": 99999, "x": 1}}))
    assert client.get("/api/settings").json() == FAIL_SAFE


def test_settings_load_logs_a_warning_with_the_given_logger(data_dir, caplog):
    from gnss_studio_server import settings
    (data_dir / "settings.json").write_text("{nope", encoding="utf-8")
    with caplog.at_level(logging.WARNING):
        assert settings.load(data_dir) == settings.Settings(daily=settings.Daily(enabled=False))
    assert [r.levelno for r in caplog.records] == [logging.WARNING] and "settings.json" in caplog.records[0].getMessage()
    own, seen = capture_logger()
    (data_dir / "settings.json").write_text("{nope, different size}", encoding="utf-8")       # ไฟล์เปลี่ยนแล้ว: เตือนใหม่ได้
    settings.load(data_dir, own)
    assert len(seen) == 1 and seen[0].levelno == logging.WARNING


def test_settings_fail_safe_warns_once_per_file_state(data_dir):
    from gnss_studio_server import settings
    logger, seen = capture_logger()
    path = data_dir / "settings.json"
    path.write_text("{nope", encoding="utf-8")
    for _ in range(5):                                                                # ตัวตั้งเวลาเรียก load ทุก 60 วินาที
        assert settings.load(data_dir, logger).daily.enabled is False
    assert len(seen) == 1
    path.write_text("{still bad}", encoding="utf-8")                                  # ไฟล์เปลี่ยน (ขนาดต่าง): เตือนอีกครั้ง
    settings.load(data_dir, logger)
    settings.load(data_dir, logger)
    assert len(seen) == 2
    bad_state = path.stat()
    path.write_text(json.dumps(CUSTOM), encoding="utf-8")                             # แก้แล้ว: ไม่เตือน และใช้ค่าในไฟล์
    assert settings.load(data_dir, logger) == settings.Settings.model_validate(CUSTOM)
    assert len(seen) == 2
    path.write_text("{still bad}", encoding="utf-8")                                  # เสียอีกครั้งด้วย mtime และขนาดเท่ารอบก่อนทุกประการ
    os.utime(path, ns=(bad_state.st_atime_ns, bad_state.st_mtime_ns))
    assert (path.stat().st_mtime_ns, path.stat().st_size) == (bad_state.st_mtime_ns, bad_state.st_size)
    settings.load(data_dir, logger)
    assert len(seen) == 3                                                             # เคยกลับมาใช้ได้แล้ว: เสียใหม่ต้องเตือนใหม่


def test_settings_fail_safe_warns_once_through_the_route(client, data_dir):
    (data_dir / "settings.json").write_text("{nope", encoding="utf-8")
    for _ in range(4):
        assert client.get("/api/settings").json() == FAIL_SAFE
    assert sum("settings.json" in line for line in server_log(data_dir).splitlines()) == 1


def test_settings_file_is_a_directory_fails_safe_once(client, data_dir):
    (data_dir / "settings.json").mkdir()
    for _ in range(3):
        assert client.get("/api/settings").json() == FAIL_SAFE
    assert sum("settings.json" in line for line in server_log(data_dir).splitlines()) == 1


def test_settings_dangling_symlink_fails_safe_and_warns_once(client, data_dir, tmp_path):
    """settings.json ที่เป็น symlink ชี้ไปไฟล์ที่ไม่มี = มีไฟล์แต่อ่านไม่ได้ (ไม่ใช่ "ไม่มีไฟล์" ซึ่งเปิดงานประจำวัน)"""
    from gnss_studio_server import settings
    (data_dir / "settings.json").symlink_to(tmp_path / "gone" / "settings.json")
    for _ in range(3):
        assert client.get("/api/settings").json() == FAIL_SAFE
    warnings = [line for line in server_log(data_dir).splitlines() if "settings.json" in line]
    assert len(warnings) == 1 and " WARNING " in warnings[0]
    logger, seen = capture_logger()
    for _ in range(3):                                                                  # ตัวตั้งเวลาอ่านทุก tick: ไม่เตือนซ้ำ
        assert settings.load(data_dir, logger).daily.enabled is False
    assert seen == []
    assert client.put("/api/settings", json=CUSTOM).status_code == 200                 # PUT แทนที่ตัว link ด้วยไฟล์จริง
    assert client.get("/api/settings").json() == CUSTOM


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


def test_day_check_is_shared_by_the_job_and_the_day_route(client, s1):
    from gnss_studio_server.errors import ApiError
    from gnss_studio_server.schema import check_day
    assert check_day("2026-11-10", "day") == "2026-11-10"
    texts = set()
    for bad in ["2026-13-01", "20261110", "", "2026-02-30", 20261110, None]:
        with pytest.raises(ApiError) as caught:
            check_day(bad, "when")
        err = caught.value
        assert (err.status, err.code, err.field) == (422, "SCENARIO_INVALID", "when") and THAI.search(err.text)
        texts.add(err.text)
    assert len(texts) == 1
    text = texts.pop()
    assert validate(client, {"day": "20261110"}).json()["text"] == text               # job: field day
    assert client.get(day_url(day="20261110")).json()["text"] == text                  # route: field day


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


def test_day_file_in_a_stale_bundle_is_still_served(client, s1_computed, data_dir):
    """ตัวตั้งเวลานับไฟล์ใน ephem bundle ใดก็ได้ว่าตรวจแล้ว (หลักฐานของพยากรณ์ที่ส่งออกไปแล้ว) route ต้องหาเจอเหมือนกัน
    ลำดับ: bundle ที่ current, ที่เก็บรักษา, แล้ว bundle อื่น"""
    put_day_file(s1_computed["ephem_dir"], {**DAY_RECORD, "where": "bundle"})
    put_doc(client, lambda doc: doc["analysis_period"].update(stop="2026-11-10T05:00:00Z"))   # hash ของ ephem เปลี่ยน → bundle เดิม stale
    assert client.get(f"/api/scenarios/{SC}/results").json()["ephem"]["status"] == "stale"
    assert client.get(day_url()).json()["where"] == "bundle"
    put_day_file(moved_dir(data_dir), {**DAY_RECORD, "where": "moved"})
    assert client.get(day_url()).json()["where"] == "moved"


def _set_mtime(folder, when):
    os.utime(folder / f"validation_{DAY}.json", (when, when))


def test_day_file_from_any_bundle_newest_first(client, s1_computed, data_dir):
    ephem = s1_computed["ephem_dir"].parent
    put_day_file(ephem / "aaaaaaaaaaaa", {**DAY_RECORD, "where": "old"})
    put_day_file(ephem / "bbbbbbbbbbbb", {**DAY_RECORD, "where": "new"})
    put_day_file(ephem / "cccccccccccc", {**DAY_RECORD, "where": "middle"})
    _set_mtime(ephem / "aaaaaaaaaaaa", 1_700_000_000)
    _set_mtime(ephem / "bbbbbbbbbbbb", 1_800_000_000)
    _set_mtime(ephem / "cccccccccccc", 1_750_000_000)
    assert client.get(day_url()).json()["where"] == "new"                                # bundle ที่ current ไม่มีไฟล์ของวันนี้
    (ephem / "bbbbbbbbbbbb" / f"validation_{DAY}.json").write_bytes(b"{bad")              # ไฟล์เสีย: ข้ามไปตัวถัดไป
    _set_mtime(ephem / "bbbbbbbbbbbb", 1_800_000_000)
    assert client.get(day_url()).json()["where"] == "middle"
    put_day_file(s1_computed["ephem_dir"], {**DAY_RECORD, "where": "current"})
    assert client.get(day_url()).json()["where"] == "current"


def test_day_file_from_any_bundle_matches_the_scheduler(client, s1_computed, data_dir):
    from gnss_studio_server.scheduler import Scheduler
    sched = Scheduler(data_dir, client.app.state.jobs)
    other = s1_computed["ephem_dir"].parent / "0123456789ab"
    assert not sched._validated(SC, DAY)
    assert_error(client.get(day_url()), 404, "NOT_FOUND")
    put_day_file(other, {**DAY_RECORD, "where": "other"})
    assert sched._validated(SC, DAY)
    assert client.get(day_url()).json()["where"] == "other"


def test_day_file_from_any_bundle_skips_symlinks(client, s1_computed, data_dir, tmp_path):
    ephem = s1_computed["ephem_dir"].parent
    elsewhere = data_dir / "elsewhere"                                                    # ใต้ data/ แต่ไม่ใช่ bundle จริง
    put_day_file(elsewhere, {**DAY_RECORD, "where": "linked"})
    (ephem / "linkedbundle").symlink_to(elsewhere, target_is_directory=True)              # bundle ที่เป็น symlink
    (ephem / "realbundle").mkdir()
    (ephem / "realbundle" / f"validation_{DAY}.json").symlink_to(elsewhere / f"validation_{DAY}.json")   # ไฟล์ที่เป็น symlink
    outside = tmp_path / "outside"
    put_day_file(outside, {"secret": True})
    (ephem / "outsidebundle").symlink_to(outside, target_is_directory=True)
    r = client.get(day_url())
    assert_error(r, 404, "NOT_FOUND")
    assert "secret" not in r.text


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
