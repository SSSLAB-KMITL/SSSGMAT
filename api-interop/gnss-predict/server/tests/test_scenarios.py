import copy
import hashlib
import json
import os
import re
import shutil
import threading
from datetime import datetime, timezone

import pytest

from gnss_predict.catalog import build_catalog
from gnss_predict.scenario import load_scenario
from gnss_studio_server import templates
from gnss_studio_server.errors import ApiError
from gnss_studio_server.schema import field_path
from gnss_studio_server.store import ScenarioStore, etag, normalize_etag

NEW = {"name": "S1", "start": "2026-11-10T00:00:00Z", "stop": "2026-11-10T06:00:00Z", "template": "thbk-gnss", "snapshot": "20261110T0000Z"}
ERROR_KEYS = {"code", "text", "field", "detail"}
THAI = re.compile("[\u0e00-\u0e7f]")


def make(client, **over):
    """สร้าง scenario ตาม NEW (ทับค่าด้วย over) แล้วคืน response"""
    return client.post("/api/scenarios", json={**NEW, **over})


def tag_of(response):
    return response.headers["ETag"].strip('"')


def scenario_dir(data_dir, name="S1"):
    return data_dir / "scenarios" / name


def file_bytes(data_dir, name="S1"):
    return (scenario_dir(data_dir, name) / "scenario.json").read_bytes()


def assert_error(r, status, code, field=None):
    assert r.status_code == status, r.text
    j = r.json()
    assert set(j) == ERROR_KEYS and j["code"] == code and j["field"] == field, j
    assert THAI.search(j["text"])
    return j


# ---------- New: แม่แบบ ----------

def test_new_from_template(client, snapshot):
    r = client.post("/api/scenarios", json=NEW); assert r.status_code == 201 and r.headers["ETag"]
    doc = client.get("/api/scenarios/S1").json()
    fac = [o for o in doc["objects"] if o["class"] == "Facility"]; sats = [o for o in doc["objects"] if o["class"] == "Satellite"]
    assert fac[0]["name"] == "THBK" and fac[0]["constraints"]["elevation_angle_min_deg"] == 10.0
    assert {s["name"] for s in sats} >= {"G01", "G22", "E11", "E14", "R05", "C01", "C40", "C09", "R10"}
    assert {o["name"] for o in doc["objects"] if o["class"] == "Constellation"} == {"GPS", "GLONASS", "Galileo", "BeiDou"}
    assert [a["to"] for a in doc["accesses"]] == [["*/Constellation/GPS", "*/Constellation/GLONASS", "*/Constellation/Galileo", "*/Constellation/BeiDou"]]
    assert doc["step_s"] == 30 and doc["animation"]["time_step_s"] == 60


def test_new_response_headers_and_body(client, snapshot, data_dir):
    r = make(client)
    assert r.status_code == 201
    assert re.fullmatch(r'"[0-9a-f]{16}"', r.headers["ETag"])                 # รูปแบบ RFC: มีเครื่องหมายคำพูด
    assert r.headers["Location"] == "/api/scenarios/S1"
    assert r.json() == client.get("/api/scenarios/S1").json()
    assert tag_of(r) == hashlib.sha256(file_bytes(data_dir)).hexdigest()[:16]
    assert tag_of(client.get("/api/scenarios/S1")) == tag_of(r)
    assert sorted(p.name for p in scenario_dir(data_dir).iterdir()) == ["scenario.json"]       # ไม่มีไฟล์ชั่วคราวค้าง


def test_new_template_content(client, snapshot, data_dir):
    doc = make(client).json()
    assert doc["format"] == "gnss-studio-scenario/1" and doc["name"] == "S1" and doc["orbit_snapshot"] == "20261110T0000Z"
    assert doc["analysis_period"] == {"start": "2026-11-10T00:00:00Z", "stop": "2026-11-10T06:00:00Z"}
    assert doc["styles"] == [] and "daily" not in doc
    assert doc["animation"] == {"start": "2026-11-10T00:00:00Z", "time_step_s": 60, "update_mode": "time_step",
                                "x_real_time_multiplier": 60, "cycle": "loop"}
    assert doc["units"] == {"date_format": "UTCG", "ltz_offset": "+07:00", "distance": "km", "angle": "deg"}
    assert doc["ionosphere"] == {"shell_km": 400.0} and doc["graphics2d_global"] == {"show_labels": True}
    assert doc["satellite_filter"] == {"show_too_old": False, "show_no_broadcast": False}

    fac = doc["objects"][0]                                                    # Facility เป็นตัวแรก
    assert fac == {"class": "Facility", "name": "THBK", "description": "",
                   "position": {"type": "Geodetic", "lat_deg": 13.729779, "lon_deg": 100.781151, "alt_m": 6.4},
                   "constraints": {"elevation_angle_min_deg": 10.0},
                   "graphics2d": {"show": True, "color": "#ff79e6", "marker_style": "Triangle", "inherit": True},
                   "graphics3d": {"show": True}}

    # ดาวทุกดวงที่มี PRN ใน catalog (ชื่อ = PRN) ตรงกับที่ engine สร้างจาก snapshot เดียวกัน
    start, stop = datetime(2026, 11, 10, tzinfo=timezone.utc), datetime(2026, 11, 10, 6, tzinfo=timezone.utc)
    catalog = build_catalog(snapshot, (start, stop), {"G", "R", "E", "C"})
    sats = [o for o in doc["objects"] if o["class"] == "Satellite"]
    assert [s["name"] for s in sats] == [c.prn for c in catalog.satellites]
    assert {s["name"]: s["norad"] for s in sats} == {c.prn: c.norad for c in catalog.satellites}

    colors = {"G": "#ffd23f", "R": "#ff6b6b", "E": "#4fd47e", "C": "#45c8ff"}
    cons = {o["system"]: o for o in doc["objects"] if o["class"] == "Constellation"}
    assert [(c["name"], s, c["color"]) for s, c in cons.items()] == [("GPS", "G", "#ffd23f"), ("GLONASS", "R", "#ff6b6b"),
                                                                       ("Galileo", "E", "#4fd47e"), ("BeiDou", "C", "#45c8ff")]
    for system, con in cons.items():
        members = [s["name"] for s in sats if s["name"][0] == system]
        assert con["assigned_objects"] == [f"*/Satellite/{n}" for n in members] and members
        for s in (s for s in sats if s["name"][0] == system):
            assert s["graphics2d"]["color"] == colors[system] and s["graphics2d"]["inherit"] is True
    sat = next(s for s in sats if s["name"] == "G01")
    assert sat["graphics2d"]["pass"] == {"lead_type": "Time", "lead_time_s": 1800, "trail_type": "Time", "trail_time_s": 1800,
                                         "visible_sides": "Both", "show_pass_labels": False, "show_path_labels": False}
    assert sat["graphics2d"]["swath"] == {"type": "Ground Elevation", "elevation_deg": 10.0, "options": "No Graphics"}
    assert sat["graphics2d"]["line_style"] == "Solid" and sat["graphics2d"]["marker_style"] == "Square"
    assert sat["graphics3d"] == {"show": True, "orbit_system": "Fixed by Window"}

    # โฟลเดอร์ใน Object Browser ละระบบ: "GPS sats" ฯลฯ สมาชิกเรียงเหมือน assigned_objects ของ Constellation
    assert [g["name"] for g in doc["groups"]] == ["GPS sats", "GLONASS sats", "Galileo sats", "BeiDou sats"]
    assert [g["members"] for g in doc["groups"]] == [cons[s]["assigned_objects"] for s in ("G", "R", "E", "C")]
    gps_sats = next(g for g in doc["groups"] if g["name"] == "GPS sats")
    assert gps_sats["members"] == cons["G"]["assigned_objects"] and "*/Satellite/G01" in gps_sats["members"]
    assert all(g["members"] for g in doc["groups"]) and all(set(g) == {"name", "members"} for g in doc["groups"])

    acc, = doc["accesses"]
    assert acc["from"] == "*/Facility/THBK" and acc["time_period"] == {"mode": "object"}
    assert acc["timeline"] is True and acc["computed"] is False
    assert acc["graphics"] == {"show": True, "static_highlight": False, "animate_highlight": False, "animate_line": True,
                               "color_mode": "object", "custom_color": "#9dff6b", "inherit": True}
    load_scenario(scenario_dir(data_dir) / "scenario.json")                    # engine อ่านได้


def test_new_empty_template(client, snapshot, data_dir):
    r = make(client, template="empty"); assert r.status_code == 201
    doc = r.json()
    assert doc["objects"] == [] and doc["accesses"] == [] and doc["groups"] == []
    assert doc["orbit_snapshot"] == "20261110T0000Z" and doc["step_s"] == 30
    assert client.get("/api/scenarios/S1").json() == doc


def test_new_defaults_to_newest_snapshot(client, snapshot, data_dir):
    shutil.copytree(snapshot, data_dir / "orbits" / "20261109T1800Z")
    (data_dir / "orbits" / "_cache").mkdir()
    (data_dir / "orbits" / "zzz-not-a-snapshot").mkdir()
    r = client.post("/api/scenarios", json={k: v for k, v in NEW.items() if k != "snapshot"})
    assert r.status_code == 201 and r.json()["orbit_snapshot"] == "20261110T0000Z"
    shutil.copytree(snapshot, data_dir / "orbits" / "20261110T2100Z")
    r = client.post("/api/scenarios", json={**{k: v for k, v in NEW.items() if k != "snapshot"}, "name": "S2", "template": "empty"})
    assert r.json()["orbit_snapshot"] == "20261110T2100Z"


@pytest.mark.parametrize("template", ["thbk-gnss", "empty"])
def test_new_without_any_snapshot_is_orbit_source_unavailable(client, data_dir, template):
    (data_dir / "orbits" / "_cache").mkdir(parents=True)                       # _cache ไม่นับเป็น snapshot
    r = client.post("/api/scenarios", json={k: v for k, v in NEW.items() if k != "snapshot"} | {"template": template})
    assert_error(r, 422, "ORBIT_SOURCE_UNAVAILABLE", "snapshot")
    assert not (data_dir / "scenarios").exists()


@pytest.mark.parametrize("snap", ["20250101T0000Z", "../orbits", "_cache", "a b", "x" * 33])
def test_new_with_unknown_or_unsafe_snapshot_is_422(client, snapshot, data_dir, snap):
    (data_dir / "orbits" / "_cache").mkdir(exist_ok=True)
    assert_error(make(client, snapshot=snap), 422, "SCENARIO_INVALID", "snapshot")
    assert not (data_dir / "scenarios").exists()


@pytest.mark.parametrize("bad", ["a b", "x" * 33, "", "ทดสอบ", "../evil", "a/b", "a.b"])
def test_new_invalid_name_is_422(client, snapshot, data_dir, bad):
    assert_error(make(client, name=bad), 422, "SCENARIO_INVALID", "name")
    assert not (data_dir / "scenarios").exists()


def test_new_duplicate_409(client, snapshot, data_dir):
    first = make(client); assert first.status_code == 201
    before = file_bytes(data_dir)
    j = assert_error(make(client), 409, "NAME_EXISTS", "name")
    assert j["detail"] == "S1"
    assert file_bytes(data_dir) == before
    assert_error(make(client, name="s1"), 409, "NAME_EXISTS", "name")           # ไม่แยกตัวพิมพ์เล็กใหญ่
    assert not scenario_dir(data_dir, "s1").exists() or scenario_dir(data_dir, "s1").samefile(scenario_dir(data_dir, "S1"))
    assert [s["name"] for s in client.get("/api/scenarios").json()] == ["S1"]


def test_new_invalid_period_is_422_and_creates_nothing(client, snapshot, data_dir):
    for over, field in [({"stop": "2026-11-09T00:00:00Z"}, "analysis_period"),             # จบก่อนเริ่ม
                        ({"stop": "2026-11-20T00:00:00Z"}, "analysis_period"),             # เกิน 7 วัน
                        ({"stop": "2026-11-10T06:00:10Z"}, "analysis_period"),             # ไม่หารด้วย step_s ลงตัว... 10 วินาที ไม่ใช่ทวีคูณของ 30
                        ({"start": "ไม่ใช่เวลา"}, "start"),
                        ({"stop": "2026-11-10T06:00:00"}, "stop"),                         # ไม่มีเขตเวลา
                        ({"start": "2026-11-10T00:00:00.5Z"}, "start")]:                   # เศษวินาที
        assert_error(make(client, **over), 422, "SCENARIO_INVALID", field)
    assert not any((data_dir / "scenarios").iterdir()) if (data_dir / "scenarios").exists() else True


def test_new_unknown_template_is_422(client, snapshot):
    assert_error(make(client, template="gps-only"), 422, "SCENARIO_INVALID", "template")
    assert_error(client.post("/api/scenarios", json={"name": "S1", "start": NEW["start"], "stop": NEW["stop"]}),
                 422, "SCENARIO_INVALID", "template")


# ---------- list / get ----------

def test_list_empty_and_reads_create_nothing(client, data_dir):
    assert client.get("/api/scenarios").json() == []
    assert client.get("/api/scenarios/S1").status_code == 404
    assert client.get("/api/scenarios/S1/workbook").status_code == 404
    assert not (data_dir / "scenarios").exists()


def test_list_entries(client, snapshot, data_dir):
    make(client, name="beta"); make(client, name="Alpha", start="2026-11-10T12:00:00Z", stop="2026-11-11T00:00:00Z")
    rows = client.get("/api/scenarios").json()
    assert [r["name"] for r in rows] == ["Alpha", "beta"]
    assert all(set(r) == {"name", "start", "stop", "modified_utc", "daily"} for r in rows)
    assert rows[0]["start"] == "2026-11-10T12:00:00Z" and rows[0]["stop"] == "2026-11-11T00:00:00Z"
    assert all(re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", r["modified_utc"]) for r in rows)
    assert rows[0]["daily"] is False
    file = scenario_dir(data_dir, "Alpha") / "scenario.json"
    mtime = datetime.fromtimestamp(file.stat().st_mtime, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    assert rows[0]["modified_utc"] == mtime


def test_list_marks_daily_and_skips_unreadable(client, snapshot, data_dir):
    doc, tag = make(client).json(), None
    tag = tag_of(client.get("/api/scenarios/S1"))
    doc["daily"] = {"for_date": "2026-11-10", "created_utc": "2026-11-09T21:00:41Z"}
    assert client.put("/api/scenarios/S1", json=doc, headers={"If-Match": tag}).status_code == 200
    make(client, name="good")
    (data_dir / "scenarios" / "broken").mkdir()
    (data_dir / "scenarios" / "broken" / "scenario.json").write_text("{not json")
    (data_dir / "scenarios" / "empty_dir").mkdir()
    (data_dir / "scenarios" / "binary").mkdir()
    (data_dir / "scenarios" / "binary" / "scenario.json").write_bytes(b"\xff\xfe\x00")
    (data_dir / "scenarios" / "not a name").mkdir()
    (data_dir / "scenarios" / "not a name" / "scenario.json").write_text("{}")
    (data_dir / "scenarios" / "stray.txt").write_text("x")
    rows = client.get("/api/scenarios").json()
    assert [(r["name"], r["daily"]) for r in rows] == [("good", False), ("S1", True)]


def test_get_missing_is_404(client, snapshot):
    assert_error(client.get("/api/scenarios/nope"), 404, "NOT_FOUND")
    make(client)
    assert_error(client.get("/api/scenarios/s1"), 404, "NOT_FOUND")             # ชื่อต้องตรงทุกตัวอักษร (macOS แยกตัวพิมพ์ไม่ได้)


# ---------- PUT และ ETag ----------

def test_put_requires_matching_etag(client, snapshot, data_dir):
    r = make(client); old = tag_of(r); doc = r.json()
    doc["description"] = "first"
    ok = client.put("/api/scenarios/S1", json=doc, headers={"If-Match": f'"{old}"'})
    assert ok.status_code == 200
    new = tag_of(ok)
    assert new != old and client.get("/api/scenarios/S1").json()["description"] == "first"
    assert tag_of(client.get("/api/scenarios/S1")) == new == hashlib.sha256(file_bytes(data_dir)).hexdigest()[:16]

    before = file_bytes(data_dir)
    doc["description"] = "second"
    stale = client.put("/api/scenarios/S1", json=doc, headers={"If-Match": f'"{old}"'})        # ETag เก่า
    j = assert_error(stale, 412, "ETAG_MISMATCH")
    assert j["detail"] == new                                                   # บอก ETag ปัจจุบัน
    assert file_bytes(data_dir) == before                                       # ไฟล์ไม่เปลี่ยน
    assert client.get("/api/scenarios/S1").json()["description"] == "first"


def test_put_without_if_match_is_412(client, snapshot, data_dir):
    doc = make(client).json(); before = file_bytes(data_dir)
    doc["description"] = "changed"
    assert_error(client.put("/api/scenarios/S1", json=doc), 412, "ETAG_MISMATCH")
    assert_error(client.put("/api/scenarios/S1", json=doc, headers={"If-Match": ""}), 412, "ETAG_MISMATCH")
    assert file_bytes(data_dir) == before


def test_put_accepts_quoted_bare_and_weak_etag(client, snapshot):
    r = make(client); doc = r.json(); tag = tag_of(r)
    for i, wrap in enumerate(['"{}"', "{}", 'W/"{}"', "w/{}", ' "{}" ']):
        doc["description"] = f"v{i}"
        form = wrap.format(tag)                                                  # ETag เปลี่ยนทุกรอบ สร้างรูปแบบใหม่จากค่าล่าสุด
        ok = client.put("/api/scenarios/S1", json=doc, headers={"If-Match": form})
        assert ok.status_code == 200, form
        tag = tag_of(ok)
    assert_error(client.put("/api/scenarios/S1", json=doc, headers={"If-Match": "0123456789abcdef"}), 412, "ETAG_MISMATCH")


def test_put_response_body_is_saved_document(client, snapshot):
    r = make(client); doc = r.json(); doc["description"] = "x"
    ok = client.put("/api/scenarios/S1", json=doc, headers={"If-Match": tag_of(r)})
    assert ok.json() == doc == client.get("/api/scenarios/S1").json()


def test_put_missing_scenario_is_404(client, snapshot):
    doc = make(client).json()
    assert_error(client.put("/api/scenarios/nope", json={**doc, "name": "nope"}, headers={"If-Match": "abc"}), 404, "NOT_FOUND")
    assert_error(client.put("/api/scenarios/nope", json={**doc, "name": "nope"}), 404, "NOT_FOUND")      # ไม่มี If-Match ก็ 404 ก่อน


def test_put_name_must_match_path(client, snapshot, data_dir):
    r = make(client); doc = r.json(); before = file_bytes(data_dir)
    assert_error(client.put("/api/scenarios/S1", json={**doc, "name": "other"}, headers={"If-Match": tag_of(r)}),
                 422, "SCENARIO_INVALID", "name")
    assert file_bytes(data_dir) == before and not scenario_dir(data_dir, "other").exists()


def test_put_invalid_value_names_field(client, snapshot):
    r = make(client); etag_ = tag_of(r)
    doc = client.get("/api/scenarios/S1").json(); doc["objects"][0]["position"]["lat_deg"] = 91
    r = client.put("/api/scenarios/S1", json=doc, headers={"If-Match": etag_}); assert r.status_code == 422
    assert r.json()["field"] == "objects[0].position.lat_deg"


def _invalid_cases(doc):
    """(ฟังก์ชันแก้ doc, field ที่คาดไว้) ผิดที่ชั้น pydantic และชั้น engine"""
    sat = next(i for i, o in enumerate(doc["objects"]) if o["class"] == "Satellite")
    con = next(i for i, o in enumerate(doc["objects"]) if o["class"] == "Constellation")
    new = len(doc["objects"])                                   # ตำแหน่งของ sensor ที่เพิ่มต่อท้ายใน doc
    return [
        (lambda d: d["objects"][0]["position"].__setitem__("lat_deg", -90.5), "objects[0].position.lat_deg"),
        (lambda d: d["objects"][0]["position"].__setitem__("lon_deg", 181), "objects[0].position.lon_deg"),
        (lambda d: d["objects"][0]["position"].__setitem__("lat_deg", "13.7"), "objects[0].position.lat_deg"),
        (lambda d: d["objects"][0]["position"].__setitem__("lat_deg", True), "objects[0].position.lat_deg"),
        (lambda d: d["objects"][0]["position"].__setitem__("lat_deg", float("nan")), "objects[0].position.lat_deg"),
        (lambda d: d["objects"][0]["position"].__setitem__("type", "ECF"), "objects[0].position.type"),
        (lambda d: d["objects"][0].pop("position"), "objects[0].position"),
        (lambda d: d["objects"][0]["constraints"].__setitem__("elevation_angle_min_deg", 95), "objects[0].constraints.elevation_angle_min_deg"),
        (lambda d: d["objects"][0]["graphics2d"].__setitem__("color", "red"), "objects[0].graphics2d.color"),
        (lambda d: d["objects"][0]["graphics2d"].__setitem__("marker_style", "Blob"), "objects[0].graphics2d.marker_style"),
        (lambda d: d["objects"][sat].__setitem__("class", "Spaceship"), f"objects[{sat}].class"),
        (lambda d: d["objects"][sat].pop("class"), f"objects[{sat}].class"),
        (lambda d: d["objects"][sat].update({"class_": d["objects"][sat].pop("class")}), f"objects[{sat}].class"),   # ต้องใช้ชื่อ `class`
        (lambda d: d.__setitem__("groups", [{"name": "", "members": []}]), "groups[0].name"),
        (lambda d: d.__setitem__("groups", [{"name": "   ", "members": []}]), "groups[0].name"),
        (lambda d: d["groups"].__setitem__(2, {**d["groups"][2], "name": "gps SATS"}), "groups[2].name"),     # ซ้ำแบบไม่สนตัวพิมพ์
        (lambda d: d["groups"].__setitem__(1, {**d["groups"][1], "name": "GPS sats"}), "groups[1].name"),
        (lambda d: d.__setitem__("groups", [{"name": "g", "members": ["G01"]}]), "groups[0].members[0]"),
        (lambda d: d["objects"][sat].__setitem__("norad", 0), f"objects[{sat}].norad"),
        (lambda d: d["objects"][sat].__setitem__("norad", "62339"), f"objects[{sat}].norad"),
        (lambda d: d["objects"][sat].__setitem__("name", "G 01"), f"objects[{sat}].name"),
        (lambda d: d["objects"][sat]["graphics2d"]["pass"].__setitem__("lead_type", "Forever"), f"objects[{sat}].graphics2d.pass.lead_type"),
        (lambda d: d["objects"][sat]["graphics2d"]["pass"].__setitem__("visible_sides", "Left"), f"objects[{sat}].graphics2d.pass.visible_sides"),
        (lambda d: d["objects"][sat]["graphics2d"]["swath"].__setitem__("options", "Hatched"), f"objects[{sat}].graphics2d.swath.options"),
        (lambda d: d["objects"][sat]["graphics3d"].__setitem__("orbit_system", "Rotating"), f"objects[{sat}].graphics3d.orbit_system"),
        (lambda d: d["objects"][con].__setitem__("system", "X"), f"objects[{con}].system"),
        (lambda d: d["objects"][con]["assigned_objects"].append("G01"), f"objects[{con}].assigned_objects[{len(doc['objects'][con]['assigned_objects'])}]"),
        (lambda d: d["accesses"][0].__setitem__("from", "THBK"), "accesses[0].from"),
        (lambda d: d["accesses"][0]["graphics"].__setitem__("color_mode", "rainbow"), "accesses[0].graphics.color_mode"),
        (lambda d: d["accesses"][0]["time_period"].__setitem__("mode", "forever"), "accesses[0].time_period.mode"),
        (lambda d: d["animation"].__setitem__("update_mode", "warp"), "animation.update_mode"),
        (lambda d: d["animation"].__setitem__("cycle", "bounce"), "animation.cycle"),
        (lambda d: d["animation"].__setitem__("start", "2026-11-10 00:00"), "animation.start"),
        (lambda d: d["units"].__setitem__("date_format", "JDate"), "units.date_format"),
        (lambda d: d["units"].__setitem__("ltz_offset", "UTC+7"), "units.ltz_offset"),
        (lambda d: d["ionosphere"].__setitem__("shell_km", -1), "ionosphere.shell_km"),
        (lambda d: d["satellite_filter"].__setitem__("show_too_old", "no"), "satellite_filter.show_too_old"),
        (lambda d: d.__setitem__("objects", {}), "objects"),
        (lambda d: d.__setitem__("format", "gnss-studio-scenario/2"), "format"),
        (lambda d: d.__setitem__("daily", {"for_date": "2026-11-10"}), "daily.created_utc"),
        (lambda d: d["objects"].append({"class": "Sensor", "name": "S1"}), f"objects[{new}].parent"),             # ขาด parent
        (lambda d: d["objects"].append(templates.sensor("S1", "*/Facility/THBK")), f"objects[{new}].parent"),       # parent ต้องเป็นดาว
        (lambda d: d["objects"].append(templates.sensor("S1", "*/Satellite/NOPE")), f"objects[{new}].parent"),      # ไม่มีดาวนั้น
        (lambda d: d["objects"].append({**templates.sensor("S1", "*/Satellite/G01"), "definition": {"cone_half_angle": 0}}),
         f"objects[{new}].definition.cone_half_angle"),
        (lambda d: d["objects"].append({**templates.sensor("S1", "*/Satellite/G01"), "pointing": {"type": "Targeted", "orientation": "Az-El",
                                                                                                    "about_boresight": "Rotate"}}),
         f"objects[{new}].pointing.type"),
        (lambda d: d["objects"].append(templates.sensor("THBK", "*/Satellite/G01")), f"objects[{new}].name"),      # ชื่อซ้ำกับ Facility
        # ชั้น engine (pydantic ผ่าน)
        (lambda d: d.__setitem__("step_s", 7), "step_s"),
        (lambda d: d["analysis_period"].__setitem__("stop", "2026-11-20T00:00:00Z"), "analysis_period"),
        (lambda d: d["analysis_period"].__setitem__("stop", d["analysis_period"]["start"]), "analysis_period"),
        (lambda d: d["objects"][sat].__setitem__("name", "THBK"), f"objects[{sat}].name"),              # ชื่อซ้ำ
        (lambda d: d["objects"][sat].__setitem__("name", "thbk"), f"objects[{sat}].name"),              # ซ้ำแบบไม่สนตัวพิมพ์
    ]


def test_put_invalid_values_name_the_field_and_keep_file(client, snapshot, data_dir):
    r = make(client); tag = tag_of(r); original = r.json(); before = file_bytes(data_dir)
    for mutate, field in _invalid_cases(original):
        doc = copy.deepcopy(original); mutate(doc)
        body = json.dumps(doc, allow_nan=True)                                   # lat_deg = NaN ส่งเป็นข้อความ NaN
        resp = client.put("/api/scenarios/S1", content=body, headers={"If-Match": tag, "Content-Type": "application/json"})
        j = assert_error(resp, 422, "SCENARIO_INVALID", field)
        assert field in j["text"]
        assert file_bytes(data_dir) == before, field                             # ไม่เขียนทับ
        assert sorted(p.name for p in scenario_dir(data_dir).iterdir()) == ["scenario.json"], field


def test_put_doc_with_orphan_sensor_rejected(client, snapshot, data_dir):
    r = make(client); tag = tag_of(r); original = r.json(); before = file_bytes(data_dir)
    n = len(original["objects"])
    for parent in ("*/Satellite/NOPE", "*/Satellite/g01", "*/Facility/THBK", "*/Sensor/S1"):
        doc = copy.deepcopy(original)
        doc["objects"].append(templates.sensor("S1", parent))
        resp = client.put("/api/scenarios/S1", json=doc, headers={"If-Match": tag})
        j = assert_error(resp, 422, "SCENARIO_INVALID", f"objects[{n}].parent")
        assert f"objects[{n}].parent" in j["text"]
        assert file_bytes(data_dir) == before
    doc = copy.deepcopy(original)
    doc["objects"].append(templates.sensor("S1", "*/Satellite/NOPE"))
    doc["objects"].insert(0, templates.sensor("S2", "*/Satellite/NOPE"))                    # รายงานตัวแรกที่กำพร้า
    assert_error(client.put("/api/scenarios/S1", json=doc, headers={"If-Match": tag}), 422, "SCENARIO_INVALID", "objects[0].parent")
    assert file_bytes(data_dir) == before


def test_put_doc_with_sensor_roundtrips_and_sensor_may_precede_its_satellite(client, snapshot, data_dir):
    r = make(client); original = r.json()
    doc = copy.deepcopy(original)
    sensor = templates.sensor("S1", "*/Satellite/G01"); sensor["x_note"] = "keep"
    doc["objects"].insert(0, sensor)                                                         # sensor อยู่ก่อนดาวแม่ได้
    ok = client.put("/api/scenarios/S1", json=doc, headers={"If-Match": tag_of(r)})
    assert ok.status_code == 200, ok.text
    assert client.get("/api/scenarios/S1").json() == doc and json.loads(file_bytes(data_dir)) == doc
    load_scenario(scenario_dir(data_dir) / "scenario.json")                                 # engine ข้าม class Sensor


def test_put_nan_in_unknown_field_is_422_and_keeps_file(client, snapshot, data_dir):
    r = make(client); before = file_bytes(data_dir)
    body = json.dumps({**r.json(), "x_custom": float("nan")})                    # "NaN" บันทึกเป็น JSON มาตรฐานไม่ได้
    resp = client.put("/api/scenarios/S1", content=body, headers={"If-Match": tag_of(r), "Content-Type": "application/json"})
    assert_error(resp, 422, "SCENARIO_INVALID")
    assert file_bytes(data_dir) == before


def test_put_non_object_body_is_422(client, snapshot, data_dir):
    r = make(client); before = file_bytes(data_dir)
    for body in ("[]", '"x"', "{bad json", ""):
        resp = client.put("/api/scenarios/S1", content=body, headers={"If-Match": tag_of(r), "Content-Type": "application/json"})
        assert_error(resp, 422, "SCENARIO_INVALID")                             # field เป็น null ไม่ใช่ตำแหน่งตัวอักษรของ JSON
    assert file_bytes(data_dir) == before


def test_unknown_fields_kept(client, snapshot, data_dir):
    r = make(client); doc = r.json()
    doc["x_custom"] = {"a": [1, 2, {"b": None}]}
    doc["animation"]["x_anim"] = 5
    doc["objects"][0]["x_note"] = "ทดสอบ"
    doc["objects"][0]["position"]["x_datum"] = "WGS84"
    doc["objects"][0]["graphics2d"]["x_halo"] = True
    sat = next(o for o in doc["objects"] if o["class"] == "Satellite")
    sat["graphics2d"]["pass"]["x_pass"] = 1
    sat["x_svn"] = "G080"
    doc["accesses"][0]["x_access"] = "keep"
    doc["accesses"][0]["graphics"]["x_g"] = 0
    ok = client.put("/api/scenarios/S1", json=doc, headers={"If-Match": tag_of(r)}); assert ok.status_code == 200
    assert client.get("/api/scenarios/S1").json() == doc
    on_disk = json.loads(file_bytes(data_dir))
    assert on_disk == doc and on_disk["x_custom"] == {"a": [1, 2, {"b": None}]} and on_disk["objects"][0]["x_note"] == "ทดสอบ"
    assert "ทดสอบ" in file_bytes(data_dir).decode("utf-8")                       # เก็บเป็น UTF-8 ตรงตัว ไม่ escape


def test_group_names_are_free_text_not_object_names(client, snapshot):
    r = make(client); doc = r.json()
    doc["groups"] = [{"name": "GPS sats", "members": ["*/Satellite/G01"]}, {"name": "ดาวทดสอบ & more", "members": []},
                     {"name": "x" * 100, "members": []}]
    ok = client.put("/api/scenarios/S1", json=doc, headers={"If-Match": tag_of(r)})
    assert ok.status_code == 200 and client.get("/api/scenarios/S1").json()["groups"] == doc["groups"]


def test_put_saved_document_is_the_clients_not_a_dump(client, snapshot):
    """ช่องที่ pydantic จะเติมค่าตั้งต้นให้ ต้องไม่โผล่ในไฟล์ถ้า client ไม่ได้ส่งมา"""
    r = make(client); doc = r.json()
    del doc["objects"][0]["graphics3d"]; del doc["units"]; del doc["animation"]["cycle"]
    ok = client.put("/api/scenarios/S1", json=doc, headers={"If-Match": tag_of(r)}); assert ok.status_code == 200
    saved = client.get("/api/scenarios/S1").json()
    assert saved == doc and "graphics3d" not in saved["objects"][0] and "units" not in saved


# ---------- copy / delete ----------

def test_copy_and_delete(client, snapshot, data_dir):
    r = make(client); doc = r.json()
    src = scenario_dir(data_dir)
    (src / "ephem" / "abc123").mkdir(parents=True); (src / "ephem" / "abc123" / "scene.czml").write_text("[]")
    (src / "access" / "THBK" / "def456").mkdir(parents=True); (src / "access" / "THBK" / "def456" / "aer.csv").write_text("x")
    wb = {"layout": {"grid": [1, 2, 3]}, "windows": ["3d", "2d"]}
    assert client.put("/api/scenarios/S1/workbook", json=wb).status_code == 204
    doc["daily"] = {"for_date": "2026-11-10", "created_utc": "2026-11-09T21:00:41Z"}
    doc["x_custom"] = 1
    tag = tag_of(client.put("/api/scenarios/S1", json=doc, headers={"If-Match": tag_of(r)}))
    src_bytes = file_bytes(data_dir)

    c = client.post("/api/scenarios/S1/copy", json={"new_name": "S2"})
    assert c.status_code == 201, c.text
    copy_doc = c.json()
    assert copy_doc["name"] == "S2" and copy_doc["x_custom"] == 1 and "daily" not in copy_doc
    assert {k: v for k, v in copy_doc.items() if k not in ("name", "daily")} == {k: v for k, v in doc.items() if k not in ("name", "daily")}
    assert c.headers["Location"] == "/api/scenarios/S2" and tag_of(c) == tag_of(client.get("/api/scenarios/S2"))
    assert tag_of(c) == hashlib.sha256(file_bytes(data_dir, "S2")).hexdigest()[:16]
    assert sorted(p.name for p in scenario_dir(data_dir, "S2").iterdir()) == ["scenario.json", "workbook.json"]   # ไม่มี ephem/ access/
    assert client.get("/api/scenarios/S2/workbook").json() == wb
    assert file_bytes(data_dir) == src_bytes and tag_of(client.get("/api/scenarios/S1")) == tag      # ต้นฉบับไม่เปลี่ยน
    assert (src / "ephem" / "abc123" / "scene.czml").exists()
    assert [s["name"] for s in client.get("/api/scenarios").json()] == ["S1", "S2"]

    assert_error(client.post("/api/scenarios/S1/copy", json={"new_name": "S2"}), 409, "NAME_EXISTS", "new_name")
    assert_error(client.post("/api/scenarios/S1/copy", json={"new_name": "s2"}), 409, "NAME_EXISTS", "new_name")
    assert_error(client.post("/api/scenarios/S1/copy", json={"new_name": "S1"}), 409, "NAME_EXISTS", "new_name")
    assert_error(client.post("/api/scenarios/nope/copy", json={"new_name": "S3"}), 404, "NOT_FOUND")
    assert client.get("/api/scenarios/S3").status_code == 404

    d = client.delete("/api/scenarios/S1"); assert d.status_code == 204 and d.content == b""
    assert not src.exists()
    assert_error(client.get("/api/scenarios/S1"), 404, "NOT_FOUND")
    assert_error(client.delete("/api/scenarios/S1"), 404, "NOT_FOUND")
    assert client.get("/api/scenarios/S2").json()["name"] == "S2"                # สำเนาไม่เกี่ยวกับต้นฉบับ
    assert scenario_dir(data_dir, "S2").is_dir()


def test_copy_without_workbook(client, snapshot, data_dir):
    make(client)
    assert client.post("/api/scenarios/S1/copy", json={"new_name": "S2"}).status_code == 201
    assert sorted(p.name for p in scenario_dir(data_dir, "S2").iterdir()) == ["scenario.json"]
    assert client.get("/api/scenarios/S2/workbook").json() is None


def test_copy_invalid_new_name_is_422(client, snapshot, data_dir):
    make(client)
    for bad in ["../evil", "a b", "x" * 33, "ทดสอบ", ""]:
        assert_error(client.post("/api/scenarios/S1/copy", json={"new_name": bad}), 422, "SCENARIO_INVALID", "new_name")
    assert [p.name for p in (data_dir / "scenarios").iterdir()] == ["S1"]
    assert not (data_dir.parent / "evil").exists()


def test_delete_leaves_other_scenarios(client, snapshot, data_dir):
    make(client); make(client, name="S2")
    assert client.delete("/api/scenarios/S2").status_code == 204
    assert [s["name"] for s in client.get("/api/scenarios").json()] == ["S1"]


# ---------- workbook ----------

def test_workbook_roundtrip_and_limit(client, snapshot, data_dir):
    r = make(client); tag = tag_of(r)
    g = client.get("/api/scenarios/S1/workbook"); assert g.status_code == 200 and g.json() is None and g.text == "null"
    wb = {"dockview": {"grid": {"root": {"type": "branch", "data": []}}}, "windows": [{"id": "3d"}], "ชื่อ": "ไทย"}
    p = client.put("/api/scenarios/S1/workbook", json=wb); assert p.status_code == 204
    assert client.get("/api/scenarios/S1/workbook").json() == wb
    assert "ETag" not in client.get("/api/scenarios/S1/workbook").headers
    assert tag_of(client.get("/api/scenarios/S1")) == tag                        # workbook ไม่กระทบ ETag ของ scenario
    on_disk = (scenario_dir(data_dir) / "workbook.json").read_bytes()
    assert len(on_disk) <= 1_048_576 and json.loads(on_disk) == wb

    def sized(n):                                                                # ขนาด serialize แบบกะทัดรัดพอดี n ไบต์
        overhead = len(json.dumps({"blob": ""}, separators=(",", ":")).encode())
        return {"blob": "x" * (n - overhead)}
    exactly = sized(1_048_576)
    assert len(json.dumps(exactly, separators=(",", ":")).encode()) == 1_048_576
    assert client.put("/api/scenarios/S1/workbook", json=exactly).status_code == 204
    stored = (scenario_dir(data_dir) / "workbook.json").read_bytes()
    over = sized(1_048_577)
    j = assert_error(client.put("/api/scenarios/S1/workbook", json=over), 422, "SCENARIO_INVALID", "workbook")
    assert (scenario_dir(data_dir) / "workbook.json").read_bytes() == stored      # เกินแล้วไม่เขียนทับ
    assert sorted(p.name for p in scenario_dir(data_dir).iterdir()) == ["scenario.json", "workbook.json"]


def test_workbook_requires_existing_scenario_and_object_body(client, snapshot, data_dir):
    assert_error(client.get("/api/scenarios/nope/workbook"), 404, "NOT_FOUND")
    assert_error(client.put("/api/scenarios/nope/workbook", json={"a": 1}), 404, "NOT_FOUND")
    assert not (data_dir / "scenarios").exists()
    make(client)
    assert_error(client.put("/api/scenarios/S1/workbook", json=[1, 2]), 422, "SCENARIO_INVALID")
    assert not (scenario_dir(data_dir) / "workbook.json").exists()


def test_workbook_corrupt_file_reads_as_null(client, snapshot, data_dir):
    make(client)
    (scenario_dir(data_dir) / "workbook.json").write_text("{broken")
    assert client.get("/api/scenarios/S1/workbook").json() is None


# ---------- ความปลอดภัยของชื่อ ----------

def test_unsafe_scenario_names_rejected(client, data_dir):       # Review Focus 1
    for bad in ["..", "a..b%2F..", "x" * 33, "ทดสอบ", "a b"]:
        r = client.get(f"/api/scenarios/{bad}"); assert r.status_code in (404, 422)
    assert not (data_dir.parent / "a").exists()


def test_unsafe_names_never_touch_files_outside_data(client, snapshot, data_dir):
    make(client)
    outside = data_dir.parent
    victim = outside / "victim"; victim.mkdir(); (victim / "scenario.json").write_text("{}")
    before = sorted(os.listdir(outside))
    bad_names = ["..", "a..b%2F..", "..%2Fvictim", "%2e%2e%2Fvictim", "..%2F..%2Fetc", "x" * 33, "ทดสอบ", "a b",
                 "S1%00", "S1%0A", "%2Fetc%2Fpasswd", "S1/../victim", "S1%2F..%2F..%2Fvictim"]
    for bad in bad_names:
        for method, suffix, kw in [("get", "", {}), ("get", "/workbook", {}), ("delete", "", {}),
                                   ("put", "", {"json": {"name": "S1"}, "headers": {"If-Match": "x"}}),
                                   ("put", "/workbook", {"json": {"a": 1}}), ("post", "/copy", {"json": {"new_name": "S9"}})]:
            r = getattr(client, method)(f"/api/scenarios/{bad}{suffix}", **kw)
            assert r.status_code in (404, 405, 422), (method, bad, suffix, r.status_code)
            if r.status_code in (404, 422):
                assert set(r.json()) == ERROR_KEYS
    for bad in ["..", "../victim", "a/b", "%2e%2e", "x" * 33, "ทดสอบ"]:
        assert client.post("/api/scenarios", json={**NEW, "name": bad}).status_code == 422
        assert client.post("/api/scenarios/S1/copy", json={"new_name": bad}).status_code == 422
    assert sorted(os.listdir(outside)) == before
    assert (victim / "scenario.json").read_text() == "{}"
    assert [s["name"] for s in client.get("/api/scenarios").json()] == ["S1"]
    assert sorted(p.name for p in (data_dir / "scenarios").iterdir()) == ["S1"]


# ---------- ScenarioStore ตรง ๆ ----------

def test_etag_function_and_normalizer():
    assert etag(b"hello") == hashlib.sha256(b"hello").hexdigest()[:16] and len(etag(b"")) == 16
    for form in ['"abc"', "abc", 'W/"abc"', "w/abc", ' "abc" ', '  W/ "abc"  ']:
        assert normalize_etag(form) == "abc", form


def test_store_path_validates_before_building(data_dir):
    store = ScenarioStore(data_dir)
    assert store.path("S1") == data_dir / "scenarios" / "S1"
    for bad in ["..", ".", "", "a/b", "a\\b", "x" * 33, "ทดสอบ", "a b", "S1\n", ".hidden"]:
        with pytest.raises(ApiError) as e:
            store.path(bad)
        assert (e.value.status, e.value.code, e.value.field) == (422, "SCENARIO_INVALID", "name")
    assert not (data_dir / "scenarios").exists()                                  # path() ไม่สร้างอะไร


def test_store_write_without_if_match_skips_check(client, snapshot, data_dir):
    doc = make(client).json(); store = client.app.state.store
    doc["description"] = "server-side"
    tag = store.write("S1", doc, None)
    assert tag == etag(file_bytes(data_dir)) and store.read("S1") == (doc, tag)
    with pytest.raises(ApiError) as e:
        store.write("S1", doc, "0000000000000000")
    assert e.value.status == 412 and e.value.code == "ETAG_MISMATCH"


def test_store_create_conflict_and_invalid_leave_no_directory(client, snapshot, data_dir):
    doc = make(client).json(); store = client.app.state.store
    with pytest.raises(ApiError) as e:
        store.create("S1", doc)
    assert e.value.status == 409 and e.value.code == "NAME_EXISTS"
    bad = {**doc, "name": "S7", "step_s": 7}
    with pytest.raises(Exception) as e2:                                         # ScenarioError ของ engine
        store.create("S7", bad)
    assert getattr(e2.value, "field", None) == "step_s"
    assert not scenario_dir(data_dir, "S7").exists()
    with pytest.raises(ApiError) as e3:
        store.create("S8", {**doc, "name": "other"})
    assert e3.value.field == "name" and not scenario_dir(data_dir, "S8").exists()


def test_concurrent_puts_with_same_etag_only_one_wins(client, snapshot, data_dir):
    r = make(client); doc = r.json(); tag = tag_of(r); store = client.app.state.store
    results = []
    barrier = threading.Barrier(8)

    def worker(i):
        d = copy.deepcopy(doc); d["description"] = f"writer {i}"
        barrier.wait()
        try:
            results.append(("ok", store.write("S1", d, f'"{tag}"')))
        except ApiError as exc:
            results.append(("err", exc.status))

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(8)]
    for t in threads: t.start()
    for t in threads: t.join()
    assert sorted(kind for kind, _ in results) == ["err"] * 7 + ["ok"]
    assert all(v == 412 for kind, v in results if kind == "err")
    saved, saved_tag = store.read("S1")
    assert saved_tag == next(v for kind, v in results if kind == "ok") and saved["description"].startswith("writer ")
    assert sorted(p.name for p in scenario_dir(data_dir).iterdir()) == ["scenario.json"]


# ---------- schema ----------

def test_field_path_style():
    assert field_path(("objects", 0, "Facility", "position", "lat_deg")) == "objects[0].position.lat_deg"
    assert field_path(("objects", 12, "Satellite", "graphics2d", "pass", "lead_type")) == "objects[12].graphics2d.pass.lead_type"
    assert field_path(("accesses", 0, "to", 3)) == "accesses[0].to[3]"
    assert field_path(("step_s",)) == "step_s" and field_path(("objects", 1, "class")) == "objects[1].class"


def test_scenario_routes_in_openapi(client):
    paths = client.get("/api/openapi.json").json()["paths"]
    assert set(paths["/api/scenarios"]) == {"get", "post"}
    assert set(paths["/api/scenarios/{sc}"]) == {"get", "put", "delete"}
    assert set(paths["/api/scenarios/{sc}/copy"]) == {"post"}
    assert set(paths["/api/scenarios/{sc}/workbook"]) == {"get", "put"}
