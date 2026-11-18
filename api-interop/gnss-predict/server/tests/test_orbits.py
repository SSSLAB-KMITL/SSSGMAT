"""ข้อมูลวงโคจรและรายชื่อดาว (หัวข้อ 6.2 ของ spec server): GET /api/orbits, POST /api/orbits/fetch, GET /api/orbits/fetch-status, GET /api/catalog

fixture `snapshot` (conftest.py) คือ snapshot ของ engine ที่ copy ไป data/orbits/20261110T0000Z (4 กลุ่ม, IGS metadata, brdc/)
`client` ไม่เริ่มคิว job: job fetch ที่ส่งเข้าไปค้าง queued ไม่แตะเน็ต
"""

import json
import re
import shutil
import subprocess
import urllib.request
from datetime import datetime

import pytest

from conftest import SNAPSHOT_ID, SNAPSHOT_SRC
from gnss_predict import igs_meta, omm
from gnss_predict.catalog import build_catalog

ERROR_KEYS = {"code", "text", "field", "detail"}
THAI = re.compile("[฀-๿]")
PERIOD = {"start": "2026-11-10T00:00:00Z", "stop": "2026-11-11T00:00:00Z"}
ENTRY_KEYS = {"prn", "system", "svn", "norad", "block", "celestrak_name", "omm_epoch", "age_days", "flags", "category",
              "display_name"}
ALL_PRNS = ["C01", "C09", "C40", "E11", "E14", "G01", "G22", "R05", "R10"]
IMAGING_SRC = SNAPSHOT_SRC.parent / "imaging"              # OMM ปลอมเขียนมือของดาวถ่ายภาพ (weather, science, visual)
IMAGING_PRNS = ["X01", "X02", "X03", "X04", "X05", "X06", "X07", "X08"]


# ---------- helpers ----------

def assert_error(r, status, code, field=None):
    assert r.status_code == status, r.text
    j = r.json()
    assert set(j) == ERROR_KEYS and j["code"] == code and j["field"] == field, j
    assert THAI.search(j["text"])
    return j


def add_snapshot(data_dir, name, drop=()):
    """copy snapshot ของ engine ไปไว้ที่ data/orbits/<name> แล้วลบไฟล์/โฟลเดอร์ใน drop ออก"""
    dest = data_dir / "orbits" / name
    shutil.copytree(SNAPSHOT_SRC, dest)
    for item in drop:
        target = dest / item
        shutil.rmtree(target) if target.is_dir() else target.unlink()
    return dest


def prns(r):
    assert r.status_code == 200, r.text
    return [s["prn"] for s in r.json()]


def catalog(client, **params):
    return client.get("/api/catalog", params={"snapshot": SNAPSHOT_ID, **PERIOD, **params})


def add_imaging_files(snapshot_dir):
    """copy ไฟล์กลุ่มดาวถ่ายภาพทั้งสามไปไว้ใน snapshot (เหมือนที่ engine คัดลอกตอน fetch)"""
    for path in sorted(IMAGING_SRC.glob("*.json")):
        shutil.copyfile(path, snapshot_dir / path.name)


# ---------- GET /api/orbits ----------

def test_orbits_list(client, snapshot):
    r = client.get("/api/orbits")
    assert r.status_code == 200
    assert r.json() == [{"name": "20261110T0000Z", "time_utc": "2026-11-10T00:00:00Z",
                         "groups": {"G": 2, "R": 2, "E": 2, "C": 4}, "has_brdc": True}]


def test_orbits_list_empty_without_orbits_dir(client, data_dir):
    assert not (data_dir / "orbits").exists()
    r = client.get("/api/orbits")
    assert r.status_code == 200 and r.json() == []


def test_orbits_list_newest_first_ignores_cache_and_foreign_names(client, data_dir, snapshot):
    add_snapshot(data_dir, "20261109T0600Z")
    add_snapshot(data_dir, "20261111T1230Z")
    # ไม่ใช่ snapshot: _cache (เรียงหลังตัวเลขใน ASCII จึงต้องถูกกรองจริง), ชื่ออื่น, ชื่อเลขไม่ครบ, วันที่ที่ไม่มีจริง, ไฟล์ที่ชื่อเหมือน snapshot
    for name in ("_cache", "notes", "20261110T0000", "20261110T000Z", "20261399T9999Z", "z20261112T0000Z"):
        add_snapshot(data_dir, name)
    (data_dir / "orbits" / "20261112T0000Z").write_text("not a folder")

    r = client.get("/api/orbits")
    assert r.status_code == 200
    got = r.json()
    assert [e["name"] for e in got] == ["20261111T1230Z", "20261110T0000Z", "20261109T0600Z"]
    assert [e["time_utc"] for e in got] == ["2026-11-11T12:30:00Z", "2026-11-10T00:00:00Z", "2026-11-09T06:00:00Z"]
    assert all(e["groups"] == {"G": 2, "R": 2, "E": 2, "C": 4} and e["has_brdc"] is True for e in got)


def test_orbits_list_leaves_out_missing_or_unreadable_groups(client, data_dir, snapshot):
    other = add_snapshot(data_dir, "20261111T0000Z", drop=("glo-ops.json",))     # ไม่มีไฟล์ GLONASS
    (other / "beidou.json").write_text("{ this is not json")                      # JSON เสีย
    (other / "galileo.json").write_text('{"NORAD_CAT_ID": 1}')                    # ไม่ใช่ array
    (other / "gps-ops.json").write_bytes(b"\xff\xfe\x00 not utf-8")               # ไม่ใช่ UTF-8
    r = client.get("/api/orbits")
    assert r.status_code == 200
    by = {e["name"]: e for e in r.json()}
    assert by["20261111T0000Z"]["groups"] == {}
    assert by["20261110T0000Z"]["groups"] == {"G": 2, "R": 2, "E": 2, "C": 4}      # snapshot เสียหนึ่งอันไม่ทำให้อันอื่นหาย

    (other / "gps-ops.json").write_text((SNAPSHOT_SRC / "gps-ops.json").read_text())
    assert {e["name"]: e["groups"] for e in client.get("/api/orbits").json()}["20261111T0000Z"] == {"G": 2}


def test_orbits_list_counts_empty_array_but_leaves_out_array_of_non_objects(client, snapshot):
    (snapshot / "gps-ops.json").write_text("[]")
    (snapshot / "glo-ops.json").write_text("[1, 2]")
    assert client.get("/api/orbits").json()[0]["groups"] == {"G": 0, "E": 2, "C": 4}


def test_orbits_list_group_file_that_is_a_folder_is_left_out(client, data_dir, snapshot):
    (snapshot / "beidou.json").unlink()
    (snapshot / "beidou.json").mkdir()
    groups = client.get("/api/orbits").json()[0]["groups"]
    assert groups == {"G": 2, "R": 2, "E": 2}


def test_orbits_list_counts_only_json_without_catalog(client, data_dir):
    """snapshot ที่มีแค่ไฟล์กลุ่ม (ไม่มี IGS metadata และ brdc/ ซึ่ง build_catalog ใช้ไม่ได้) ยังแสดงจำนวนดาว และ has_brdc เป็น false"""
    folder = data_dir / "orbits" / "20261110T0000Z"
    folder.mkdir(parents=True)
    shutil.copy(SNAPSHOT_SRC / "gps-ops.json", folder / "gps-ops.json")
    r = client.get("/api/orbits")
    assert r.status_code == 200
    assert r.json() == [{"name": "20261110T0000Z", "time_utc": "2026-11-10T00:00:00Z", "groups": {"G": 2}, "has_brdc": False}]


def test_orbits_list_without_brdc_folder_is_false(client, snapshot):
    shutil.rmtree(snapshot / "brdc")
    assert client.get("/api/orbits").json()[0]["has_brdc"] is False


def test_orbits_list_empty_brdc_folder_is_false(client, snapshot):
    for f in (snapshot / "brdc").iterdir():
        f.unlink()
    assert client.get("/api/orbits").json()[0]["has_brdc"] is False


# ---------- POST /api/orbits/fetch ----------

def test_fetch_creates_job(client, snapshot):
    r = client.post("/api/orbits/fetch")
    assert r.status_code == 202
    body = r.json()
    assert set(body) == {"job"} and body["job"].startswith("j-")
    job = client.get(f"/api/jobs/{body['job']}")
    assert job.status_code == 200
    j = job.json()
    assert j["id"] == body["job"] and j["kind"] == "fetch" and j["scenario"] is None and j["origin"] == "user"
    assert j["params"] == {"systems": "GREC"}
    assert j["state"] == "queued"                       # คิวไม่ได้เริ่ม: ไม่มีอะไรไปแตะเน็ต


@pytest.mark.parametrize("kwargs", [{}, {"json": {}}, {"json": None}, {"content": b"null", "headers": {"Content-Type": "application/json"}}])
def test_fetch_default_systems_for_empty_bodies(client, kwargs):
    r = client.post("/api/orbits/fetch", **kwargs)
    assert r.status_code == 202, r.text
    assert client.get(f"/api/jobs/{r.json()['job']}").json()["params"] == {"systems": "GREC"}


def test_fetch_with_systems_body(client):
    r = client.post("/api/orbits/fetch", json={"systems": "ge"})
    assert r.status_code == 202
    assert client.get(f"/api/jobs/{r.json()['job']}").json()["params"] == {"systems": "GE"}


def test_fetch_repeated_returns_same_queued_job(client):
    first = client.post("/api/orbits/fetch").json()["job"]
    again = client.post("/api/orbits/fetch", json={"systems": "GREC"})
    assert again.status_code == 202 and again.json() == {"job": first}
    assert len(client.get("/api/jobs").json()) == 1


@pytest.mark.parametrize("systems", ["", "X", "x", "XX", "GRXZ", "GRECZ", 5, None, ["G"]])
def test_fetch_invalid_systems_is_422(client, systems):
    r = client.post("/api/orbits/fetch", json={"systems": systems})
    assert_error(r, 422, "SCENARIO_INVALID", "systems")
    assert client.get("/api/jobs").json() == []


@pytest.mark.parametrize("systems, stored", [("GRECX", "GRECX"), ("grecx", "GRECX"), ("GX", "GX")])
def test_fetch_with_imaging_letter(client, systems, stored):
    """X (ดาวถ่ายภาพ) ใช้ได้เมื่อมีระบบ GNSS อย่างน้อยหนึ่งตัว: job ค้าง queued (client ไม่เริ่มคิว ไม่แตะเน็ต)"""
    r = client.post("/api/orbits/fetch", json={"systems": systems})
    assert r.status_code == 202, r.text
    j = client.get(f"/api/jobs/{r.json()['job']}").json()
    assert j["params"] == {"systems": stored} and j["state"] == "queued"


def test_fetch_not_a_json_object_is_422(client):
    r = client.post("/api/orbits/fetch", content=b"[1]", headers={"Content-Type": "application/json"})
    assert r.status_code == 422 and set(r.json()) == ERROR_KEYS
    assert client.get("/api/jobs").json() == []


# ---------- GET /api/orbits/fetch-status ----------

STATUS_GROUPS = ["gps-ops", "glo-ops", "galileo", "beidou"]
NULL_STATUS = {"last_request_utc": None, "next_allowed_utc": None}


def write_state(data_dir, content):
    """เขียน data/orbits/_cache/celestrak_state.json แบบที่ engine เขียน (dict -> JSON, bytes/str -> ตามตัว)"""
    path = data_dir / "orbits" / "_cache" / "celestrak_state.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(content, dict):
        content = json.dumps(content)
    path.write_bytes(content if isinstance(content, bytes) else content.encode("utf-8"))
    return path


@pytest.fixture
def no_network(monkeypatch):
    """endpoint อ่านอย่างเดียว: ถ้าไปแตะเน็ตให้ test ล้ม

    omm.py และ igs_meta.py ทำ `from urllib.request import urlopen` ตอน import (และใช้เป็นค่าตั้งต้นของพารามิเตอร์ opener) การแทน urllib.request.urlopen
    อย่างเดียวจึงไม่ครอบคลุม: แทนชื่อที่ผูกในสองโมดูลนั้นด้วย และ OpenerDirector.open ที่ urlopen ตัวเดิมเรียกจริง กับ curl (subprocess) ของ broadcast จาก CDDIS
    """
    def refuse(*args, **kwargs):
        raise AssertionError("fetch-status must not touch the network")
    monkeypatch.setattr(urllib.request, "urlopen", refuse)
    monkeypatch.setattr(omm, "urlopen", refuse)
    monkeypatch.setattr(igs_meta, "urlopen", refuse)
    monkeypatch.setattr(urllib.request.OpenerDirector, "open", refuse)
    monkeypatch.setattr(subprocess, "run", refuse)


def test_no_network_guard_covers_every_binding_the_engine_downloads_through(no_network):
    for opener in (urllib.request.urlopen, omm.urlopen, igs_meta.urlopen):
        with pytest.raises(AssertionError, match="network"):
            opener("https://celestrak.org/")
    with pytest.raises(AssertionError, match="network"):
        urllib.request.build_opener().open("https://files.igs.org/")      # ที่ urlopen ตัวเดิม (ค่าตั้งต้นของ opener ในโมดูล) เรียกจริง
    with pytest.raises(AssertionError, match="network"):
        subprocess.run(["curl", "ftp://gdc.cddis.eosdis.nasa.gov/"])


def test_fetch_status_without_state_file(client, data_dir, no_network):
    r = client.get("/api/orbits/fetch-status")
    assert r.status_code == 200
    assert r.json() == {"groups": {g: NULL_STATUS for g in STATUS_GROUPS}}
    assert not (data_dir / "orbits").exists()                       # อ่านอย่างเดียว: ไม่สร้างโฟลเดอร์


def test_fetch_status_adds_two_hours(client, data_dir, no_network):
    write_state(data_dir, {"gps-ops": {"last_request": "2026-11-11T10:00:00Z", "last_success": "2026-11-11T10:00:00Z"}})
    groups = client.get("/api/orbits/fetch-status").json()["groups"]
    assert groups["gps-ops"] == {"last_request_utc": "2026-11-11T10:00:00Z", "next_allowed_utc": "2026-11-11T12:00:00Z"}
    assert [g for g in STATUS_GROUPS if groups[g] != NULL_STATUS] == ["gps-ops"]


def test_fetch_status_uses_last_request_not_last_success(client, data_dir):
    write_state(data_dir, {"galileo": {"last_request": "2026-11-11T23:30:00Z", "last_success": "2026-11-10T08:00:00Z"}})
    assert client.get("/api/orbits/fetch-status").json()["groups"]["galileo"] == {
        "last_request_utc": "2026-11-11T23:30:00Z", "next_allowed_utc": "2026-11-12T01:30:00Z"}      # ข้ามวัน


def test_fetch_status_reports_each_group_separately(client, data_dir):
    write_state(data_dir, {"gps-ops": {"last_request": "2026-11-11T10:00:00Z"}, "glo-ops": {"last_request": "2026-11-11T09:15:30Z"},
                           "beidou": {"last_request": "2026-11-11T11:59:59Z"}, "not-a-gnss-group": {"last_request": "2026-11-11T11:00:00Z"}})
    groups = client.get("/api/orbits/fetch-status").json()["groups"]
    assert list(groups) == STATUS_GROUPS                                   # เฉพาะสี่กลุ่ม GNSS ตามลำดับของ engine
    assert groups["glo-ops"]["next_allowed_utc"] == "2026-11-11T11:15:30Z"
    assert groups["beidou"]["next_allowed_utc"] == "2026-11-11T13:59:59Z"
    assert groups["galileo"] == NULL_STATUS


@pytest.mark.parametrize("content", [b"", b"{not json", b"\xff\xfe\x00", b"[]", b"null", b'"text"', b"42", b"[" * 100000])
def test_fetch_status_corrupt_state_is_null(client, data_dir, content):
    write_state(data_dir, content)
    r = client.get("/api/orbits/fetch-status")
    assert r.status_code == 200
    assert r.json() == {"groups": {g: NULL_STATUS for g in STATUS_GROUPS}}


def test_fetch_status_state_file_that_is_a_folder_is_null(client, data_dir):
    (data_dir / "orbits" / "_cache" / "celestrak_state.json").mkdir(parents=True)
    r = client.get("/api/orbits/fetch-status")
    assert r.status_code == 200 and r.json() == {"groups": {g: NULL_STATUS for g in STATUS_GROUPS}}


@pytest.mark.parametrize("entry", [
    {"last_request": "yesterday"}, {"last_request": "2026-11-11 10:00:00"}, {"last_request": "2026-11-11T10:00:00"},
    {"last_request": "2026-11-11T10:00:00+07:00"}, {"last_request": "2026-13-45T10:00:00Z"}, {"last_request": ""}, {"last_request": None},
    {"last_request": 1762855200}, {"last_request": ["2026-11-11T10:00:00Z"]}, {"last_success": "2026-11-11T10:00:00Z"}, {},
    "2026-11-11T10:00:00Z", None, 7, ["2026-11-11T10:00:00Z"],
    {"last_request": "9999-12-31T23:59:59Z"},                              # บวก 2 ชม. แล้วเกินช่วงเวลาที่รองรับ
])
def test_fetch_status_bad_entry_is_null_for_that_group_only(client, data_dir, entry):
    write_state(data_dir, {"gps-ops": entry, "glo-ops": {"last_request": "2026-11-11T10:00:00Z"}})
    r = client.get("/api/orbits/fetch-status")
    assert r.status_code == 200
    groups = r.json()["groups"]
    assert groups["gps-ops"] == NULL_STATUS
    assert groups["glo-ops"] == {"last_request_utc": "2026-11-11T10:00:00Z", "next_allowed_utc": "2026-11-11T12:00:00Z"}


def test_fetch_status_does_not_submit_a_job(client, data_dir, no_network):
    write_state(data_dir, {"gps-ops": {"last_request": "2026-11-11T10:00:00Z"}})
    assert client.get("/api/orbits/fetch-status").status_code == 200
    assert client.get("/api/jobs").json() == []


def test_fetch_status_is_get_only(client):
    assert client.post("/api/orbits/fetch-status").status_code == 405
    assert client.put("/api/orbits/fetch-status", json={}).status_code == 405


# ---------- GET /api/catalog ----------

def test_catalog_flags(client, snapshot):
    r = client.get("/api/catalog", params={"snapshot": "20261110T0000Z", "start": "2026-11-10T00:00:00Z", "stop": "2026-11-11T00:00:00Z"})
    assert r.status_code == 200
    by = {s["prn"]: s for s in r.json()}
    assert by["C40"]["flags"] == ["name_mismatch", "stale"] and by["G22"]["flags"] == ["no_broadcast"]
    assert by["R10"]["flags"] == ["no_broadcast", "too_old"] and by["E14"]["flags"] == ["unhealthy"]
    assert by["G01"]["flags"] == [] and by["E11"]["flags"] == []
    assert list(by) == ALL_PRNS                         # เรียงตาม PRN เหมือน catalog


def test_catalog_entries_match_engine_catalog(client, snapshot):
    r = catalog(client)
    assert r.status_code == 200
    start, stop = (datetime.fromisoformat(PERIOD[k].replace("Z", "+00:00")) for k in ("start", "stop"))
    expected = build_catalog(snapshot, (start, stop), set("GREC")).satellites
    got = r.json()
    assert len(got) == len(expected) == len(ALL_PRNS)
    for entry, sat in zip(got, expected):
        assert set(entry) == ENTRY_KEYS
        assert entry["prn"] == sat.prn and entry["system"] == sat.system and entry["svn"] == sat.svn
        assert entry["norad"] == sat.norad and entry["block"] == sat.block and entry["celestrak_name"] == sat.celestrak_name
        assert entry["age_days"] == round(sat.age_days, 3)
        assert entry["flags"] == sorted(sat.flags)
        assert entry["category"] == "gnss" and entry["display_name"] == sat.celestrak_name
        to_ms = sat.omm_epoch.replace(microsecond=sat.omm_epoch.microsecond // 1000 * 1000)
        assert datetime.fromisoformat(entry["omm_epoch"].replace("Z", "+00:00")) == to_ms


def test_catalog_entry_values(client, snapshot):
    by = {s["prn"]: s for s in catalog(client).json()}
    assert by["G01"] == {"prn": "G01", "system": "G", "svn": "G080", "norad": 62339, "block": "GPS-IIIA",
                         "celestrak_name": "GPS BIII-7  (PRN 01)", "omm_epoch": "2026-11-10T04:12:45.624Z",
                         "age_days": 0.324, "flags": [], "category": "gnss", "display_name": "GPS BIII-7  (PRN 01)"}
    assert by["C01"]["celestrak_name"] == "BEIDOU-3 G4 (C62)" and by["C01"]["svn"] == "C231" and by["C01"]["system"] == "C"
    assert by["R10"]["age_days"] == 19.442 and isinstance(by["R10"]["age_days"], float)
    assert all(s["omm_epoch"].endswith("Z") and "+" not in s["omm_epoch"] for s in by.values())


def test_catalog_age_is_measured_at_period_midpoint(client, snapshot):
    a = {s["prn"]: s["age_days"] for s in catalog(client).json()}
    b = {s["prn"]: s["age_days"] for s in catalog(client, start="2026-11-12T00:00:00Z", stop="2026-11-13T00:00:00Z").json()}
    assert a["G01"] == 0.324 and b["G01"] == 2.324


def test_catalog_search(client, snapshot):
    assert prns(catalog(client, q="beidou-3 g4")) == ["C01"]
    assert prns(catalog(client, system="E")) == ["E11", "E14"]
    assert prns(catalog(client, q="BEIDOU-3 G4")) == ["C01"]            # ไม่แยกตัวพิมพ์
    assert prns(catalog(client, q="g22")) == ["G22"]                    # PRN
    assert prns(catalog(client, q="62339")) == ["G01"]                  # NORAD
    assert prns(catalog(client, q="1434")) == ["C09"]                   # NORAD บางส่วน
    assert prns(catalog(client, q="cosmos")) == ["R05", "R10"]          # ชื่อ CelesTrak
    assert prns(catalog(client, q="prn 22")) == ["G22"]
    assert prns(catalog(client, q="no-such-satellite")) == []
    assert prns(catalog(client, q="")) == ALL_PRNS


def test_catalog_search_combines_with_system(client, snapshot):
    assert prns(catalog(client, system="C", q="beidou-2")) == ["C09"]
    assert prns(catalog(client, system="G", q="cosmos")) == []
    assert prns(catalog(client, system="R")) == ["R05", "R10"]
    assert prns(catalog(client, system="G")) == ["G01", "G22"]


def test_catalog_does_not_list_satellites_without_prn(client, snapshot):
    assert 36828 not in {s["norad"] for s in catalog(client).json()}   # C005 ไม่มี PRN ณ ต้นช่วง


def test_catalog_defaults_use_snapshot_time_and_one_day(client, snapshot):
    explicit = catalog(client).json()
    assert [s["prn"] for s in explicit] == ALL_PRNS
    assert client.get("/api/catalog").json() == explicit               # ไม่ส่งอะไรเลย = snapshot ใหม่สุด, ต้นช่วง = เวลา snapshot, +1 วัน
    assert client.get("/api/catalog", params={"snapshot": SNAPSHOT_ID}).json() == explicit


def test_catalog_default_stop_is_start_plus_one_day(client, snapshot):
    start = "2026-11-10T12:00:00Z"
    default = client.get("/api/catalog", params={"snapshot": SNAPSHOT_ID, "start": start}).json()
    explicit = client.get("/api/catalog", params={"snapshot": SNAPSHOT_ID, "start": start, "stop": "2026-11-11T12:00:00Z"}).json()
    assert [s["prn"] for s in explicit] == ALL_PRNS
    assert default == explicit
    assert default != catalog(client).json()                           # start ที่ส่งมามีผลจริง (อายุที่กลางช่วงต่างกัน)


def test_catalog_omitted_snapshot_uses_newest(client, data_dir, snapshot):
    add_snapshot(data_dir, "20261111T0000Z", drop=("galileo.json",))   # ใหม่กว่า แต่ไม่มี Galileo
    assert prns(client.get("/api/catalog", params=PERIOD)) == [p for p in ALL_PRNS if p[0] != "E"]
    assert prns(catalog(client)) == ALL_PRNS                           # ระบุชื่อ = ตามนั้น
    assert prns(client.get("/api/catalog")) == [p for p in ALL_PRNS if p[0] != "E"]


def test_catalog_ignores_cache_folder(client, data_dir, snapshot):
    add_snapshot(data_dir, "_cache", drop=("galileo.json",))
    assert prns(client.get("/api/catalog", params=PERIOD)) == ALL_PRNS  # _cache เรียงหลังตัวเลขแต่ไม่ถูกเลือกเป็นใหม่สุด
    assert_error(client.get("/api/catalog", params={"snapshot": "_cache", **PERIOD}), 422, "SCENARIO_INVALID", "snapshot")


def test_catalog_snapshot_without_timestamp_name_needs_start(client, data_dir, snapshot):
    add_snapshot(data_dir, "manual")
    assert_error(client.get("/api/catalog", params={"snapshot": "manual"}), 422, "SCENARIO_INVALID", "start")
    assert prns(client.get("/api/catalog", params={"snapshot": "manual", "start": PERIOD["start"]})) == ALL_PRNS


# ---------- GET /api/catalog: 422 ----------

def test_catalog_without_any_snapshot_is_orbit_source_unavailable(client, data_dir):
    assert_error(client.get("/api/catalog"), 422, "ORBIT_SOURCE_UNAVAILABLE", "snapshot")
    (data_dir / "orbits" / "_cache").mkdir(parents=True)                # มีแต่ _cache ก็นับว่าไม่มี
    assert_error(client.get("/api/catalog"), 422, "ORBIT_SOURCE_UNAVAILABLE", "snapshot")


@pytest.mark.parametrize("name", ["20990101T0000Z", "..", "../x", "%2e%2e%2f", "%2e%2e", "a/b", "ข้อมูล", "x" * 33, "", " ", "_cache", "orbits"])
def test_catalog_unsafe_or_missing_snapshot_is_422(client, snapshot, name):
    r = client.get("/api/catalog", params={"snapshot": name, **PERIOD})
    assert_error(r, 422, "SCENARIO_INVALID", "snapshot")


def test_catalog_snapshot_must_stay_under_orbits(client, data_dir, snapshot):
    (data_dir / "scenarios").mkdir()
    r = client.get("/api/catalog?snapshot=..%2Fscenarios&start=2026-11-10T00:00:00Z")
    assert_error(r, 422, "SCENARIO_INVALID", "snapshot")


def test_catalog_snapshot_without_omm_files_is_orbit_source_unavailable(client, data_dir):
    (data_dir / "orbits" / "20261111T0000Z").mkdir(parents=True)
    r = client.get("/api/catalog", params={"snapshot": "20261111T0000Z"})
    assert_error(r, 422, "ORBIT_SOURCE_UNAVAILABLE", "snapshot")


def test_catalog_unreadable_omm_file_is_orbit_source_unavailable(client, snapshot):
    (snapshot / "gps-ops.json").write_text("{ broken")
    j = assert_error(catalog(client), 422, "ORBIT_SOURCE_UNAVAILABLE")
    assert "gps-ops" in j["text"]


@pytest.mark.parametrize("value", ["garbage", "2026-11-10", "2026-11-10T00:00:00", "2026-11-10T00:00:00.500Z", "2026-13-10T00:00:00Z", ""])
def test_catalog_bad_time_names_its_field(client, snapshot, value):
    assert_error(client.get("/api/catalog", params={"snapshot": SNAPSHOT_ID, "start": value}), 422, "SCENARIO_INVALID", "start")
    assert_error(client.get("/api/catalog", params={"snapshot": SNAPSHOT_ID, "start": PERIOD["start"], "stop": value}),
                 422, "SCENARIO_INVALID", "stop")


def test_catalog_stop_not_after_start_is_422(client, snapshot):
    for stop in ("2026-11-10T00:00:00Z", "2026-11-09T23:59:59Z"):
        assert_error(catalog(client, stop=stop), 422, "SCENARIO_INVALID", "stop")
    # ไม่ส่ง start = เวลา snapshot: stop ก่อนหรือเท่ากับเวลานั้นผิดเช่นกัน
    r = client.get("/api/catalog", params={"snapshot": SNAPSHOT_ID, "stop": "2026-11-09T00:00:00Z"})
    assert_error(r, 422, "SCENARIO_INVALID", "stop")


@pytest.mark.parametrize("system", ["Q", "g", "x", "GR", "GX", "gps", "", "1"])
def test_catalog_bad_system_is_422(client, snapshot, system):
    assert_error(catalog(client, system=system), 422, "SCENARIO_INVALID", "system")


def test_catalog_system_checked_even_without_snapshot(client):
    assert_error(client.get("/api/catalog", params={"system": "Q"}), 422, "SCENARIO_INVALID", "system")


def test_catalog_system_without_file_in_snapshot_is_empty(client, data_dir, snapshot):
    (snapshot / "galileo.json").unlink()
    assert prns(catalog(client, system="E")) == []
    assert prns(catalog(client)) == [p for p in ALL_PRNS if p[0] != "E"]


def test_catalog_default_stop_overflow_is_422_on_stop(client, snapshot):
    r = client.get("/api/catalog", params={"snapshot": SNAPSHOT_ID, "start": "9999-12-31T23:59:59Z"})
    assert_error(r, 422, "SCENARIO_INVALID", "stop")


# ---------- GET /api/catalog: ดาวถ่ายภาพ (ระบบ X) ----------

def test_catalog_imaging_rows(client, snapshot):
    add_imaging_files(snapshot)
    rows = catalog(client).json()
    assert [e["prn"] for e in rows if e["category"] == "imaging"] == IMAGING_PRNS
    assert [e["prn"] for e in rows if e["category"] == "gnss"] == ALL_PRNS          # GNSS ก่อน แล้วดาวถ่ายภาพต่อท้าย
    assert [e["prn"] for e in rows] == ALL_PRNS + IMAGING_PRNS
    by = {e["prn"]: e for e in rows}
    assert all(set(e) == ENTRY_KEYS for e in rows)
    assert by["X04"]["display_name"] == "Terra" and by["X04"]["system"] == "X" and by["X04"]["celestrak_name"] == "TERRA"
    assert by["X04"]["norad"] == 25994 and by["X04"]["svn"] == "" and by["X04"]["block"] == "EOS AM-1"
    assert by["X03"]["flags"] == ["too_old"]                  # แสดงเหมือน R10 (too_old) การซ่อนเป็นหน้าที่ตัวกรองของเว็บ
    assert by["X08"]["display_name"] == "NOAA-21" and by["X08"]["celestrak_name"] == "NOAA 21 (JPSS-2)"
    assert by["G01"]["category"] == "gnss" and by["G01"]["display_name"] == by["G01"]["celestrak_name"]
    assert 99001 not in {e["norad"] for e in rows} and 60243 not in {e["norad"] for e in rows}   # ดาวหลอกไม่ติดมา


def test_catalog_imaging_search_uses_display_name(client, snapshot):
    add_imaging_files(snapshot)
    assert prns(catalog(client, q="noaa-21")) == ["X08"]                # ชื่อ preset (ชื่อ CelesTrak คือ NOAA 21 (JPSS-2))
    assert prns(catalog(client, q="jpss-2")) == ["X08"]                 # ชื่อ CelesTrak ยังค้นได้
    assert prns(catalog(client, q="25994")) == ["X04"]


def test_catalog_without_imaging_files_has_no_imaging_rows(client, snapshot):
    rows = catalog(client).json()
    assert [e["prn"] for e in rows] == ALL_PRNS and all(e["category"] == "gnss" for e in rows)


def test_catalog_system_x_filter(client, snapshot):
    add_imaging_files(snapshot)
    r = catalog(client, system="X")
    assert prns(r) == IMAGING_PRNS
    assert all(e["system"] == "X" and e["category"] == "imaging" for e in r.json())
    assert prns(catalog(client, system="G")) == ["G01", "G22"]
    assert_error(catalog(client, system="Q"), 422, "SCENARIO_INVALID", "system")


def test_catalog_system_x_without_imaging_files_is_empty(client, snapshot):
    r = catalog(client, system="X")
    assert r.status_code == 200 and r.json() == []


DEEP_JSON = "[" * 200_000 + "]" * 200_000                # ไฟล์ร้าย: json.loads ให้ RecursionError


def test_catalog_deeply_nested_imaging_file_skips_that_group(client, snapshot):
    add_imaging_files(snapshot)
    (snapshot / "weather.json").write_text(DEEP_JSON)
    r = catalog(client)
    assert r.status_code == 200, r.text
    assert [e["prn"] for e in r.json()] == ALL_PRNS + ["X04", "X05"]   # weather ถูกข้าม science/visual ยังอยู่


def test_catalog_deeply_nested_gnss_file_is_orbit_source_unavailable(client, snapshot):
    (snapshot / "galileo.json").write_text(DEEP_JSON)
    j = assert_error(catalog(client), 422, "ORBIT_SOURCE_UNAVAILABLE")
    assert "galileo" in j["text"]
