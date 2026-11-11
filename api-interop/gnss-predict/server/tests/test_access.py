"""Access tool (หัวข้อ 6.6 ของ spec server): รายการ, Compute, Clear, Remove และช่วง access ของคู่ที่เลือก

ส่วนแรกตรวจฟังก์ชันของ `access.py` กับเอกสารสังเคราะห์ ส่วนที่เหลือตรวจ route กับ bundle จริงที่ engine เขียนใน fixture `s1_computed`
(conftest.py) ด้วย GMAT ปลอม: scenario S1 ของแม่แบบ thbk-gnss มี Facility THBK กับดาว 9 ดวง ดาว G22 และ R10 ซ่อน (propagated: false)
แม่แบบมี access แรก THBK -> Constellation ทั้ง 4 (ยังไม่ computed) และ client ในเทสต์เหล่านี้ไม่เริ่มคิว job (job ที่ส่งค้าง queued)
"""

import copy
import json
import re
import shutil
import time
from datetime import datetime
from unittest import mock

import pytest

from gnss_studio_server import access
from gnss_studio_server.errors import ApiError

SC = "S1"
BASE = f"/api/scenarios/{SC}"
ACCESS = f"{BASE}/access"
CURRENT = object()                       # ค่าตั้งต้นของ etag: ใช้ ETag ปัจจุบันของไฟล์ (None = ไม่ส่ง If-Match)
ERROR_KEYS = {"code", "text", "field", "detail"}
THAI = re.compile("[฀-๿]")
JOB_ID_RE = re.compile(r"^j-\d{8}T\d{6}-[0-9a-f]{4}$")

FAC = "*/Facility/THBK"
GPS, GLONASS, GALILEO, BEIDOU = ("*/Constellation/GPS", "*/Constellation/GLONASS", "*/Constellation/Galileo",
                                 "*/Constellation/BeiDou")
ALL_FOUR = [GPS, GLONASS, GALILEO, BEIDOU]
DEFAULT_COMPUTED = ["G01", "R05", "E11", "E14", "C01", "C09", "C40"]      # สมาชิกที่ไม่ซ่อนของทั้ง 4 ระบบ ตามลำดับใน `to`
GRAPHICS = {"show": False, "static_highlight": True, "animate_highlight": False, "animate_line": False,
            "color_mode": "custom", "custom_color": "#112233", "inherit": False}


# ---------- helpers ----------

def assert_error(r, status, code, field=None):
    assert r.status_code == status, r.text
    j = r.json()
    assert set(j) == ERROR_KEYS and j["code"] == code and j["field"] == field, j
    assert THAI.search(j["text"])
    return j


def etag_of(client):
    return client.get(BASE).headers["ETag"].strip('"')


def _headers(client, etag):
    if etag is CURRENT:
        etag = etag_of(client)
    return {} if etag is None else {"If-Match": f'"{etag}"'}


def doc_of(client):
    return client.get(BASE).json()


def file_bytes(data_dir):
    return (data_dir / "scenarios" / SC / "scenario.json").read_bytes()


def put_doc(client, mutate):
    r = client.get(BASE)
    doc = r.json()
    mutate(doc)
    return client.put(BASE, json=doc, headers={"If-Match": r.headers["ETag"]})


def make_stale(client):
    """แก้มุมเงยต่ำสุดของ THBK: ephem ยัง current แต่ access ของ THBK stale"""
    r = client.patch(f"{BASE}/objects/Facility/THBK", json={"constraints": {"elevation_angle_min_deg": 15}},
                     headers=_headers(client, CURRENT))
    assert r.status_code == 200 and r.json()["results_stale"] is True, r.text


def compute(client, body, etag=CURRENT):
    return client.post(f"{ACCESS}/compute", json=body, headers=_headers(client, etag))


def clear(client, body, etag=CURRENT):
    return client.post(f"{ACCESS}/clear", json=body, headers=_headers(client, etag))


def remove(client, body, etag=CURRENT):
    return client.post(f"{ACCESS}/remove", json=body, headers=_headers(client, etag))


def intervals(client, frm, *to):
    return client.get(f"{ACCESS}/intervals", params=[("from", frm), *[("to", t) for t in to]])


def bundle_intervals(s1_computed):
    """intervals.json ที่ engine เขียน: {PRN: [ช่วง]}"""
    return json.loads((s1_computed["access_dir"] / "intervals.json").read_text())["intervals"]


def insert_facility(client):
    """เพิ่ม Facility ที่สอง (ชื่อ Facility1) แล้วคืนชื่อ"""
    r = client.post(f"{BASE}/objects", json={"class": "Facility", "method": "Insert Default"}, headers=_headers(client, CURRENT))
    assert r.status_code == 201, r.text
    return r.json()["created"][0].rsplit("/", 1)[1]


def at(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


# ---------- ฟังก์ชันของ access.py (เอกสารสังเคราะห์) ----------

def _sat(name, norad):
    return {"class": "Satellite", "name": name, "norad": norad}


def synthetic_doc():
    return {"objects": [
        {"class": "Facility", "name": "THBK"}, {"class": "Facility", "name": "BKK"},
        _sat("G01", 1), _sat("G22", 22), _sat("E11", 11), _sat("E14", 14),
        {"class": "Constellation", "name": "GPS", "assigned_objects": ["*/Satellite/G01", "*/Satellite/G22"]},
        {"class": "Constellation", "name": "Mixed", "assigned_objects": ["*/Satellite/E11", "*/Satellite/G22", "*/Satellite/G01"]},
        {"class": "Constellation", "name": "Empty", "assigned_objects": []},
    ]}


def test_expand_constellation_drops_hidden_members():
    assert access.expand_targets(synthetic_doc(), ["*/Constellation/GPS"], {"G22"}) == ["G01"]
    assert access.expand_targets(synthetic_doc(), ["*/Constellation/GPS"], set()) == ["G01", "G22"]
    assert access.expand_targets(synthetic_doc(), ["*/Constellation/GPS"], {"G01", "G22"}) == []
    assert access.expand_targets(synthetic_doc(), ["*/Constellation/Empty"], set()) == []


def test_expand_satellite_target_stays_itself_even_when_hidden():
    assert access.expand_targets(synthetic_doc(), ["*/Satellite/G22"], {"G22"}) == ["G22"]


def test_expand_dedupes_and_keeps_first_seen_order():
    got = access.expand_targets(synthetic_doc(), ["*/Satellite/E14", "*/Constellation/Mixed", "*/Constellation/GPS", "*/Satellite/E14"], {"G22"})
    assert got == ["E14", "E11", "G01"]


def test_expand_skips_members_that_no_longer_exist_or_are_not_satellites():
    doc = synthetic_doc()
    doc["objects"][-3]["assigned_objects"] = ["*/Satellite/G01", "*/Satellite/GONE", "*/Facility/THBK", "*/Satellite/G22"]
    assert access.expand_targets(doc, ["*/Constellation/GPS"], set()) == ["G01", "G22"]


@pytest.mark.parametrize("to", [["*/Satellite/NOPE"], ["*/Constellation/Nope"], ["*/Facility/THBK"], ["G01"], [7],
                                ["*/Satellite/G01", "*/Satellite/NOPE"]])
def test_expand_unknown_or_non_target_path_is_422_on_to(to):
    with pytest.raises(ApiError) as exc:
        access.expand_targets(synthetic_doc(), to, set())
    assert (exc.value.status, exc.value.code, exc.value.field) == (422, "SCENARIO_INVALID", "to")
    assert THAI.search(exc.value.text)


def test_expand_does_not_modify_the_document():
    doc = synthetic_doc()
    before = copy.deepcopy(doc)
    access.expand_targets(doc, ["*/Constellation/GPS"], {"G22"})
    assert doc == before


def test_normalize_keeps_facility_from():
    assert access.normalize(synthetic_doc(), "*/Facility/THBK", ["*/Constellation/GPS", "*/Satellite/E11"]) == \
        ("*/Facility/THBK", ["*/Constellation/GPS", "*/Satellite/E11"])


def test_normalize_swaps_satellite_from_with_single_facility_to():
    assert access.normalize(synthetic_doc(), "*/Satellite/G01", ["*/Facility/THBK"]) == ("*/Facility/THBK", ["*/Satellite/G01"])
    assert access.normalize(synthetic_doc(), "*/Satellite/G01", ["*/Facility/THBK", "*/Facility/THBK"]) == \
        ("*/Facility/THBK", ["*/Satellite/G01"])                    # to ซ้ำ นับเป็น Facility เดียว


def test_normalize_dedupes_to_keeping_first_seen_order():
    assert access.normalize(synthetic_doc(), "*/Facility/THBK", ["*/Satellite/G01", "*/Constellation/GPS", "*/Satellite/G01"])[1] == \
        ["*/Satellite/G01", "*/Constellation/GPS"]


@pytest.mark.parametrize("frm,to,field", [
    ("*/Satellite/G01", ["*/Facility/THBK", "*/Facility/BKK"], "from"),       # ดาวสลับได้เฉพาะเมื่อ to เป็น Facility เดียว
    ("*/Satellite/G01", ["*/Facility/THBK", "*/Satellite/E11"], "from"),
    ("*/Satellite/G01", ["*/Satellite/E11"], "from"),
    ("*/Satellite/G01", ["*/Constellation/GPS"], "from"),
    ("*/Constellation/GPS", ["*/Satellite/G01"], "from"),
    ("*/Constellation/GPS", ["*/Facility/THBK"], "from"),
    ("*/Facility/THBK", ["*/Facility/BKK"], "to"),                              # Facility -> Facility ไม่ใช่ Access ของ GNSS
    ("*/Facility/THBK", ["*/Satellite/G01", "*/Facility/BKK"], "to"),
    ("*/Facility/THBK", [], "to"),
    ("*/Facility/THBK", "*/Satellite/G01", "to"),
    ("*/Facility/THBK", ["*/Satellite/NOPE"], "to"),
    ("*/Facility/NOPE", ["*/Satellite/G01"], "from"),
    ("THBK", ["*/Satellite/G01"], "from"),
    (None, ["*/Satellite/G01"], "from"),
])
def test_normalize_rejects_with_the_field_to_fix(frm, to, field):
    with pytest.raises(ApiError) as exc:
        access.normalize(synthetic_doc(), frm, to)
    assert (exc.value.status, exc.value.code, exc.value.field) == (422, "SCENARIO_INVALID", field)
    assert THAI.search(exc.value.text)


def _row(start, stop, duration_s, max_el_deg):
    return {"start": start, "stop": stop, "duration_s": duration_s, "max_el_deg": max_el_deg}


def test_clip_intervals_to_the_window():
    inside = _row("2026-11-10T01:10:00.000Z", "2026-11-10T01:20:00.000Z", 600.0, 40.0)
    rows = [
        _row("2026-11-10T00:00:00.000Z", "2026-11-10T00:30:10.830Z", 1810.83, 18.458),         # คร่อมต้นหน้าต่าง
        inside,                                                                                  # อยู่ในหน้าต่างทั้งช่วง
        _row("2026-11-10T01:50:00.000Z", "2026-11-10T02:30:00.000Z", 2400.0, 50.0),              # คร่อมท้ายหน้าต่าง
        _row("2026-11-10T03:00:00.000Z", "2026-11-10T04:00:00.000Z", 3600.0, 60.0),              # อยู่นอกหน้าต่างทั้งช่วง
        _row("2026-11-09T22:00:00.000Z", "2026-11-10T00:10:00.000Z", 7800.0, 70.0),              # จบพอดีที่ต้นหน้าต่าง -> ว่าง
        _row("2026-11-10T02:00:00.000Z", "2026-11-10T03:00:00.000Z", 3600.0, 80.0),              # เริ่มพอดีที่ท้ายหน้าต่าง -> ว่าง
        _row("2026-11-09T22:00:00.000Z", "2026-11-10T05:00:00.000Z", 25200.0, 90.0),             # ครอบทั้งหน้าต่าง
    ]
    got = access.clip_intervals(rows, at("2026-11-10T00:10:00Z"), at("2026-11-10T02:00:00Z"))
    assert got == [
        _row("2026-11-10T00:10:00.000Z", "2026-11-10T00:30:10.830Z", 1210.83, 18.458),          # duration คำนวณใหม่ max_el เท่าเดิม
        inside,
        _row("2026-11-10T01:50:00.000Z", "2026-11-10T02:00:00.000Z", 600.0, 50.0),
        _row("2026-11-10T00:10:00.000Z", "2026-11-10T02:00:00.000Z", 6600.0, 90.0),
    ]
    assert rows[0]["start"] == "2026-11-10T00:00:00.000Z"                                      # ไม่แก้รายการเดิม


def test_clip_intervals_keeps_untouched_rows_verbatim():
    row = _row("2026-11-10T01:10:00.000Z", "2026-11-10T01:20:00.000Z", 599.9996, 40.0)          # duration ของ engine ไม่ถูกคำนวณใหม่
    assert access.clip_intervals([row], at("2026-11-10T01:00:00Z"), at("2026-11-10T02:00:00Z")) == [row]
    assert access.clip_intervals([], at("2026-11-10T01:00:00Z"), at("2026-11-10T02:00:00Z")) == []


def test_clip_intervals_formats_milliseconds_in_utc():
    got = access.clip_intervals([_row("2026-11-10T00:00:00.000Z", "2026-11-10T06:00:00.000Z", 21600.0, 33.0)],
                                at("2026-11-10T01:02:03.4567Z"), at("2026-11-10T01:02:04Z"))
    assert got == [_row("2026-11-10T01:02:03.456Z", "2026-11-10T01:02:04.000Z", 0.544, 33.0)]


def test_hidden_satellites_follow_the_ephem_manifest():
    doc = synthetic_doc()
    manifest = {"satellites": [{"prn": "G01", "norad": 1, "propagated": True}, {"prn": "G22", "norad": 22, "propagated": False},
                               {"prn": "E11", "norad": 11, "propagated": True}]}
    assert access.hidden_satellites(doc, manifest) == {"G22", "E14"}          # E14 ไม่อยู่ใน manifest = ซ่อน
    assert access.hidden_satellites(doc, None) == set()                      # ไม่มี ephem ที่ current = ไม่ซ่อนอะไร
    assert access.hidden_satellites(doc, {"satellites": []}) == {"G01", "G22", "E11", "E14"}


def test_satellite_prns_map_object_name_to_prn_through_norad():
    doc = synthetic_doc()
    doc["objects"][2]["name"] = "MyGps"                                       # ชื่อที่ผู้ใช้ตั้งเอง NORAD ยังเป็น 1
    manifest = {"satellites": [{"prn": "G01", "norad": 1, "propagated": True}, {"prn": "G22", "norad": 22, "propagated": False}]}
    assert access.satellite_prns(doc, manifest) == {"MyGps": "G01", "G22": "G22"}


# ---------- schema: time_period แบบ specify ----------

@pytest.mark.parametrize("time_period,field", [
    ({"mode": "specify"}, "start"),
    ({"mode": "specify", "stop": "2026-11-10T02:00:00Z"}, "start"),
    ({"mode": "specify", "start": "2026-11-10T01:00:00Z"}, "stop"),
    ({"mode": "specify", "start": "2026-11-10T02:00:00Z", "stop": "2026-11-10T02:00:00Z"}, "stop"),
    ({"mode": "specify", "start": "2026-11-10T03:00:00Z", "stop": "2026-11-10T02:00:00Z"}, "stop"),
    ({"mode": "specify", "start": "2026-11-10T02:00:00.600Z", "stop": "2026-11-10T02:00:00.500Z"}, "stop"),
])
def test_specify_time_period_in_scenario_document_needs_start_before_stop(client, s1, time_period, field):
    r = put_doc(client, lambda d: d["accesses"][0].update(time_period=time_period))
    j = assert_error(r, 422, "SCENARIO_INVALID", f"accesses[0].time_period.{field}")
    assert j["field"] and "time_period" in j["text"]


def test_valid_specify_time_period_is_stored_verbatim(client, s1):
    tp = {"mode": "specify", "start": "2026-11-10T01:00:00Z", "stop": "2026-11-10T01:00:00.500Z"}
    assert put_doc(client, lambda d: d["accesses"][0].update(time_period=tp)).status_code == 200
    assert doc_of(client)["accesses"][0]["time_period"] == tp


# ---------- GET /access/intervals ----------

def test_constellation_expands_without_hidden(client, s1_computed):
    r = client.get(f"{ACCESS}/intervals", params={"from": FAC, "to": GPS})
    assert r.status_code == 200, r.text
    assert set(r.json()) == {"G01"}                # G22 ซ่อน (no_broadcast)
    assert r.json()["G01"] == bundle_intervals(s1_computed)["G01"] and r.json()["G01"]


def test_intervals_have_one_key_per_expanded_target_in_order(client, s1_computed):
    r = intervals(client, FAC, GALILEO, GPS, "*/Satellite/E11")                 # E11 ซ้ำกับสมาชิก Galileo นับครั้งเดียว
    assert r.status_code == 200, r.text
    assert list(r.json()) == ["E11", "E14", "G01"]
    expected = bundle_intervals(s1_computed)
    assert r.json() == {"E11": expected["E11"], "E14": [], "G01": expected["G01"]}


def test_intervals_empty_for_no_access_and_for_hidden_target(client, s1_computed):
    r = intervals(client, FAC, "*/Satellite/G22", "*/Satellite/C09", "*/Satellite/R10")
    assert r.status_code == 200, r.text
    assert r.json() == {"G22": [], "C09": [], "R10": []}                      # ซ่อนแต่ระบุตรง ๆ ได้ key ว่าง ไม่ใช่ error


def test_intervals_of_every_visible_satellite_with_the_default_targets(client, s1_computed):
    r = intervals(client, FAC, *ALL_FOUR)
    assert list(r.json()) == DEFAULT_COMPUTED
    expected = bundle_intervals(s1_computed)
    assert r.json() == {name: expected.get(name, []) for name in DEFAULT_COMPUTED}


def test_intervals_follow_a_renamed_satellite_through_norad(client, s1_computed):
    rename = client.post(f"{BASE}/objects/Satellite/G01/rename", json={"new_name": "GPS01"}, headers=_headers(client, CURRENT))
    assert rename.status_code == 200 and rename.json()["results_stale"] is False
    r = intervals(client, FAC, GPS)
    assert list(r.json()) == ["GPS01"] and r.json()["GPS01"] == bundle_intervals(s1_computed)["G01"]


def test_from_satellite_swapped(client, s1_computed):
    swapped = intervals(client, "*/Satellite/G01", FAC)
    direct = intervals(client, FAC, "*/Satellite/G01")
    assert swapped.status_code == 200, swapped.text
    assert swapped.json() == direct.json() == {"G01": bundle_intervals(s1_computed)["G01"]}
    assert direct.json()["G01"]


def test_intervals_need_current_results(client, s1):
    j = assert_error(intervals(client, FAC, GPS), 409, "RESULTS_NOT_CURRENT")           # ยังไม่เคยคำนวณ
    assert j["field"] is None


def test_intervals_of_stale_results_is_409(client, s1_computed):
    assert intervals(client, FAC, GPS).status_code == 200
    make_stale(client)
    assert_error(intervals(client, FAC, GPS), 409, "RESULTS_NOT_CURRENT")


def test_intervals_when_the_bundle_file_is_gone_is_409(client, s1_computed):
    (s1_computed["access_dir"] / "intervals.json").unlink()
    assert_error(intervals(client, FAC, GPS), 409, "RESULTS_NOT_CURRENT")


def test_intervals_when_the_ephem_manifest_is_gone_is_409(client, s1_computed):
    (s1_computed["ephem_dir"] / "manifest.json").unlink()
    assert_error(intervals(client, FAC, GPS), 409, "RESULTS_NOT_CURRENT")


def test_intervals_of_facility_without_results_is_409(client, s1_computed):
    other = insert_facility(client)
    assert_error(intervals(client, f"*/Facility/{other}", GPS), 409, "RESULTS_NOT_CURRENT")
    assert intervals(client, FAC, GPS).status_code == 200                      # THBK ยัง current


@pytest.mark.parametrize("frm,to,field", [
    (FAC, ["*/Satellite/NOPE"], "to"),
    (FAC, [FAC], "to"),
    (FAC, [GPS, "*/Satellite/NOPE"], "to"),
    ("*/Constellation/GPS", ["*/Satellite/G01"], "from"),
    ("*/Facility/NOPE", [GPS], "from"),
    ("*/Satellite/G01", [GPS], "from"),
    ("*/Satellite/G01", [FAC, "*/Satellite/E11"], "from"),
    ("nonsense", [GPS], "from"),
])
def test_intervals_bad_arguments_name_the_field(client, s1_computed, frm, to, field):
    assert_error(intervals(client, frm, *to), 422, "SCENARIO_INVALID", field)


def test_intervals_missing_arguments(client, s1_computed):
    assert_error(client.get(f"{ACCESS}/intervals", params={"to": GPS}), 422, "SCENARIO_INVALID", "from")
    assert_error(client.get(f"{ACCESS}/intervals", params={"from": FAC}), 422, "SCENARIO_INVALID", "to")
    assert_error(client.get(f"{ACCESS}/intervals"), 422, "SCENARIO_INVALID", "from")


def test_intervals_unknown_or_unsafe_scenario(client, s1_computed):
    assert_error(client.get("/api/scenarios/nope/access/intervals", params={"from": FAC, "to": GPS}), 404, "NOT_FOUND")
    assert client.get("/api/scenarios/a.b/access/intervals", params={"from": FAC, "to": GPS}).status_code == 422


# ---------- time_period ของ access ที่เก็บไว้ ----------

SPECIFY = {"mode": "specify", "start": "2026-11-10T00:10:00Z", "stop": "2026-11-10T03:00:00Z"}


def test_specify_time_period_clips(client, s1_computed):
    to = [GPS, GALILEO, BEIDOU]
    unclipped = intervals(client, FAC, *to).json()
    r = compute(client, {"from": FAC, "to": to, "time_period": SPECIFY})
    assert r.status_code == 200, r.text
    got = intervals(client, FAC, *to)
    assert got.status_code == 200, got.text
    base = bundle_intervals(s1_computed)
    assert got.json() == {
        "E11": [],                                                                       # เริ่ม 03:17 หลังท้ายหน้าต่าง -> ช่วงว่างถูกทิ้ง
        "E14": [],
        "G01": [{"start": "2026-11-10T02:38:19.004Z", "stop": "2026-11-10T03:00:00.000Z", "duration_s": 1300.996,
                 "max_el_deg": base["G01"][0]["max_el_deg"]}],
        "C01": [{"start": "2026-11-10T02:54:24.164Z", "stop": "2026-11-10T03:00:00.000Z", "duration_s": 335.836,
                 "max_el_deg": base["C01"][0]["max_el_deg"]}],
        "C09": [],
        "C40": [{"start": "2026-11-10T00:10:00.000Z", "stop": "2026-11-10T00:30:10.830Z", "duration_s": 1210.83,
                 "max_el_deg": base["C40"][0]["max_el_deg"]}],
    }
    assert list(got.json()) == list(unclipped) and unclipped["E11"] != []                 # key เท่าเดิม มีแต่ช่วงที่ถูกตัด
    assert doc_of(client)["accesses"][-1]["time_period"] == SPECIFY


def test_clip_applies_only_to_the_matching_stored_access(client, s1_computed):
    to = [GPS, GALILEO, BEIDOU]
    assert compute(client, {"from": FAC, "to": to, "time_period": SPECIFY}).status_code == 200
    base = bundle_intervals(s1_computed)
    assert intervals(client, FAC, BEIDOU, GALILEO, GPS).json()["E11"] == []                   # ลำดับของ to ไม่มีผลต่อการจับคู่
    assert intervals(client, FAC, GALILEO).json() == {"E11": base["E11"], "E14": []}           # to ต่างจากที่เก็บไว้ = ใช้ช่วงของ object ไม่ตัด
    assert intervals(client, FAC, *ALL_FOUR).json()["G01"] == base["G01"]                      # access แรกของแม่แบบ (mode object)


def test_specify_clip_applies_to_a_swapped_access(client, s1_computed):
    window = {"mode": "specify", "start": "2026-11-10T03:00:00Z", "stop": "2026-11-10T04:00:00Z"}
    assert compute(client, {"from": "*/Satellite/G01", "to": [FAC], "time_period": window}).status_code == 200
    expected = [{"start": "2026-11-10T03:00:00.000Z", "stop": "2026-11-10T04:00:00.000Z", "duration_s": 3600.0,
                 "max_el_deg": bundle_intervals(s1_computed)["G01"][0]["max_el_deg"]}]
    assert intervals(client, "*/Satellite/G01", FAC).json() == {"G01": expected}
    assert intervals(client, FAC, "*/Satellite/G01").json() == {"G01": expected}


def test_object_time_period_does_not_clip(client, s1_computed):
    assert compute(client, {"from": FAC, "to": [GPS], "time_period": {"mode": "object"}}).status_code == 200
    assert intervals(client, FAC, GPS).json() == {"G01": bundle_intervals(s1_computed)["G01"]}


def test_clip_window_outside_every_interval_gives_empty_lists(client, s1_computed):
    window = {"mode": "specify", "start": "2026-11-10T00:00:00Z", "stop": "2026-11-10T00:01:00Z"}
    assert compute(client, {"from": FAC, "to": [GPS], "time_period": window}).status_code == 200
    assert intervals(client, FAC, GPS).json() == {"G01": []}


# ---------- POST /access/compute ----------

def test_compute_when_current_returns_200(client, s1_computed):
    before = etag_of(client)
    r = compute(client, {"from": FAC, "to": ALL_FOUR})
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == {"computed", "etag"}
    assert body["computed"] == DEFAULT_COMPUTED                                    # G22 และ R10 ซ่อน
    assert body["etag"] != before and r.headers["ETag"] == f'"{body["etag"]}"' and etag_of(client) == body["etag"]
    acc, = doc_of(client)["accesses"]                                               # ทับรายการของแม่แบบ ไม่เพิ่มรายการ
    assert acc["computed"] is True and acc["to"] == ALL_FOUR
    assert client.get("/api/jobs").json() == []                                     # ไม่ส่ง job


def test_compute_when_stale_returns_job(client, s1_computed):
    make_stale(client)
    r = compute(client, {"from": FAC, "to": [GPS]})
    assert r.status_code == 202, r.text
    body = r.json()
    assert set(body) == {"job", "etag"} and JOB_ID_RE.fullmatch(body["job"])
    assert r.headers["ETag"] == f'"{body["etag"]}"' and etag_of(client) == body["etag"]
    job = client.get(f"/api/jobs/{body['job']}").json()
    assert (job["kind"], job["scenario"], job["params"], job["state"]) == ("analyze", SC, {"facility": "THBK"}, "queued")
    assert doc_of(client)["accesses"][-1]["computed"] is True                       # บันทึกรายการแล้วแม้ผลยังไม่เสร็จ
    again = compute(client, {"from": FAC, "to": [GPS]})
    assert again.status_code == 202 and again.json()["job"] == body["job"]          # job เดิมที่ยังรอ ได้ id เดิม


def test_compute_without_any_results_returns_job(client, s1):
    r = compute(client, {"from": FAC, "to": [GPS]})
    assert r.status_code == 202, r.text
    job = client.get(f"/api/jobs/{r.json()['job']}").json()
    assert (job["kind"], job["scenario"], job["params"]) == ("analyze", SC, {"facility": "THBK"})


def test_compute_job_runs_then_results_are_current(client_inline, s1, fake_gmat):
    r = compute(client_inline, {"from": FAC, "to": [GPS]})
    assert r.status_code == 202, r.text
    deadline = time.monotonic() + 10
    while (job := client_inline.get(f"/api/jobs/{r.json()['job']}").json())["state"] in ("queued", "running"):
        assert time.monotonic() < deadline, job
        time.sleep(0.02)
    assert job["state"] == "succeeded", job
    listed = client_inline.get(ACCESS).json()["accesses"]
    assert [a["status"] for a in listed] == ["current", "current"]
    assert list(intervals(client_inline, FAC, GPS).json()) == ["G01"]
    again = compute(client_inline, {"from": FAC, "to": [GPS]})
    assert again.status_code == 200 and again.json()["computed"] == ["G01"]


def test_compute_adds_a_new_access_with_defaults(client, s1_computed):
    r = compute(client, {"from": FAC, "to": ["*/Satellite/G01", "*/Constellation/Galileo"]})
    assert r.status_code == 200 and r.json()["computed"] == ["G01", "E11", "E14"]
    first, new = doc_of(client)["accesses"]
    assert first["computed"] is False                                               # รายการอื่นไม่ถูกแตะ
    assert new == {"from": FAC, "to": ["*/Satellite/G01", "*/Constellation/Galileo"], "time_period": {"mode": "object"},
                   "graphics": {"show": True, "static_highlight": False, "animate_highlight": False, "animate_line": True,
                                "color_mode": "object", "custom_color": "#9dff6b", "inherit": True},
                   "timeline": True, "computed": True}


def test_compute_stores_what_the_request_gives(client, s1_computed):
    r = compute(client, {"from": FAC, "to": [GPS], "time_period": SPECIFY, "graphics": GRAPHICS, "timeline": False})
    assert r.status_code == 200, r.text
    assert doc_of(client)["accesses"][-1] == {"from": FAC, "to": [GPS], "time_period": SPECIFY, "graphics": GRAPHICS,
                                              "timeline": False, "computed": True}


def test_compute_upserts_by_from_and_to(client, s1_computed):
    compute(client, {"from": FAC, "to": [GPS, GALILEO], "graphics": GRAPHICS, "timeline": False})
    assert len(doc_of(client)["accesses"]) == 2
    r = compute(client, {"from": FAC, "to": [GALILEO, GPS], "time_period": SPECIFY})            # to ชุดเดียวกัน ลำดับต่าง = รายการเดิม
    assert r.status_code == 200 and r.json()["computed"] == ["E11", "E14", "G01"]
    accesses = doc_of(client)["accesses"]
    assert len(accesses) == 2
    assert accesses[-1]["time_period"] == SPECIFY and accesses[-1]["computed"] is True
    assert accesses[-1]["graphics"] == GRAPHICS and accesses[-1]["timeline"] is False         # ช่องที่ไม่ส่งมา คงค่าเดิม
    compute(client, {"from": FAC, "to": [GPS]})                                                 # to ต่างชุด = รายการใหม่
    assert len(doc_of(client)["accesses"]) == 3


def test_compute_recompute_sets_computed_again_and_keeps_unknown_fields(client, s1_computed):
    put_doc(client, lambda d: d["accesses"][0].update(x_note="keep"))
    assert clear(client, {"from": FAC, "to": ALL_FOUR}).json()["cleared"] == 1
    assert compute(client, {"from": FAC, "to": ALL_FOUR}).status_code == 200
    acc, = doc_of(client)["accesses"]
    assert acc["computed"] is True and acc["x_note"] == "keep"


def test_compute_from_satellite_is_stored_swapped(client, s1_computed):
    r = compute(client, {"from": "*/Satellite/G01", "to": [FAC]})
    assert r.status_code == 200 and r.json()["computed"] == ["G01"]
    acc = doc_of(client)["accesses"][-1]
    assert (acc["from"], acc["to"], acc["computed"]) == (FAC, ["*/Satellite/G01"], True)
    again = compute(client, {"from": FAC, "to": ["*/Satellite/G01"]})                          # เป็นรายการเดียวกัน
    assert again.status_code == 200 and len(doc_of(client)["accesses"]) == 2


def test_compute_hidden_satellite_targeted_directly_is_kept(client, s1_computed):
    r = compute(client, {"from": FAC, "to": ["*/Satellite/G22", GPS]})
    assert r.status_code == 200 and r.json()["computed"] == ["G22", "G01"]


def test_compute_without_if_match_is_412(client, s1_computed, data_dir):
    before = file_bytes(data_dir)
    assert_error(compute(client, {"from": FAC, "to": [GPS]}, etag=None), 412, "ETAG_MISMATCH")
    assert file_bytes(data_dir) == before and client.get("/api/jobs").json() == []


def test_compute_with_old_etag_is_412_and_changes_nothing(client, s1_computed, data_dir):
    old = etag_of(client)
    make_stale(client)                                                                           # ใครอีกคนแก้ไปแล้ว
    before = file_bytes(data_dir)
    j = assert_error(compute(client, {"from": FAC, "to": [GPS]}, etag=old), 412, "ETAG_MISMATCH")
    assert j["detail"] == etag_of(client)
    assert file_bytes(data_dir) == before and client.get("/api/jobs").json() == []


def test_compute_unknown_scenario_is_404(client, s1_computed):
    r = client.post("/api/scenarios/nope/access/compute", json={"from": FAC, "to": [GPS]}, headers={"If-Match": '"x"'})
    assert_error(r, 404, "NOT_FOUND")


@pytest.mark.parametrize("body,field", [
    ({"from": FAC, "to": [GPS], "time_period": {"mode": "specify", "start": "2026-11-10T02:00:00Z", "stop": "2026-11-10T01:00:00Z"}},
     "time_period.stop"),
    ({"from": FAC, "to": [GPS], "time_period": {"mode": "specify", "start": "2026-11-10T02:00:00Z", "stop": "2026-11-10T02:00:00Z"}},
     "time_period.stop"),
    ({"from": FAC, "to": [GPS], "time_period": {"mode": "specify", "stop": "2026-11-10T01:00:00Z"}}, "time_period.start"),
    ({"from": FAC, "to": [GPS], "time_period": {"mode": "specify", "start": "2026-11-10T01:00:00Z"}}, "time_period.stop"),
    ({"from": FAC, "to": [GPS], "time_period": {"mode": "specify"}}, "time_period.start"),
    ({"from": FAC, "to": [GPS], "time_period": {"mode": "specify", "start": "2026-11-10 01:00", "stop": "2026-11-10T02:00:00Z"}},
     "time_period.start"),
    ({"from": FAC, "to": [GPS], "time_period": {"mode": "specify", "start": "2026-11-10T01:00:00+07:00", "stop": "2026-11-10T02:00:00Z"}},
     "time_period.start"),
    ({"from": FAC, "to": [GPS], "time_period": {"mode": "forever"}}, "time_period.mode"),
    ({"from": FAC, "to": [GPS], "graphics": {"color_mode": "rainbow"}}, "graphics.color_mode"),
    ({"from": FAC, "to": [GPS], "timeline": "yes"}, "timeline"),
    ({"from": FAC, "to": []}, "to"),
    ({"from": FAC, "to": [FAC]}, "to"),
    ({"from": FAC, "to": ["*/Satellite/NOPE"]}, "to"),
    ({"from": FAC, "to": GPS}, "to"),
    ({"from": FAC}, "to"),
    ({"to": [GPS]}, "from"),
    ({"from": "*/Facility/NOPE", "to": [GPS]}, "from"),
    ({"from": "*/Constellation/GPS", "to": ["*/Satellite/G01"]}, "from"),
    ({"from": "*/Satellite/G01", "to": [FAC, "*/Satellite/E11"]}, "from"),
    ({"from": "*/Satellite/G01", "to": [GPS]}, "from"),
])
def test_compute_bad_body_is_422_and_changes_nothing(client, s1_computed, data_dir, body, field):
    before = file_bytes(data_dir)
    assert_error(compute(client, body), 422, "SCENARIO_INVALID", field)
    assert file_bytes(data_dir) == before and client.get("/api/jobs").json() == []


def test_compute_body_must_be_an_object(client, s1_computed):
    r = client.post(f"{ACCESS}/compute", content=b"[1]", headers={**_headers(client, CURRENT), "Content-Type": "application/json"})
    assert r.status_code == 422 and set(r.json()) == ERROR_KEYS


# ---------- GET /access ----------

def test_list_accesses_with_status(client, s1):
    r = client.get(ACCESS)
    assert r.status_code == 200, r.text
    assert r.headers["ETag"] == f'"{etag_of(client)}"'
    assert set(r.json()) == {"accesses"}
    acc, = r.json()["accesses"]
    assert acc == {**doc_of(client)["accesses"][0], "status": "missing"}               # ยังไม่เคยคำนวณ
    assert acc["computed"] is False and acc["from"] == FAC and acc["to"] == ALL_FOUR


def test_list_accesses_status_follows_the_facility_results(client, s1_computed):
    assert [a["status"] for a in client.get(ACCESS).json()["accesses"]] == ["current"]
    make_stale(client)
    assert [a["status"] for a in client.get(ACCESS).json()["accesses"]] == ["stale"]


def test_list_accesses_status_is_per_facility(client, s1_computed):
    other = insert_facility(client)
    put_doc(client, lambda d: d["accesses"].append({"from": f"*/Facility/{other}", "to": [GPS], "time_period": {"mode": "object"},
                                                    "timeline": True, "computed": True}))
    listed = client.get(ACCESS).json()["accesses"]
    assert [(a["from"], a["status"]) for a in listed] == [(FAC, "current"), (f"*/Facility/{other}", "missing")]


def test_list_accesses_of_scenario_the_engine_cannot_plan_is_missing(client, s1_computed, data_dir):
    shutil.rmtree(data_dir / "orbits" / "20261110T0000Z")
    assert [a["status"] for a in client.get(ACCESS).json()["accesses"]] == ["missing"]


def test_list_accesses_empty_and_unknown_scenario(client, s_empty):
    assert client.get(ACCESS).json() == {"accesses": []}
    assert_error(client.get("/api/scenarios/nope/access"), 404, "NOT_FOUND")


# ---------- POST /access/clear และ /access/remove ----------

def two_computed(client):
    """S1 ที่มี access ของแม่แบบ (ทั้ง 4 ระบบ) กับ THBK -> GPS ที่ computed ทั้งคู่ และ Facility1 -> GPS ที่ computed"""
    other = insert_facility(client)
    assert compute(client, {"from": FAC, "to": ALL_FOUR}).status_code == 200
    assert compute(client, {"from": FAC, "to": [GPS]}).status_code == 200
    put_doc(client, lambda d: d["accesses"].append({"from": f"*/Facility/{other}", "to": [GPS], "time_period": {"mode": "object"},
                                                    "timeline": True, "computed": True}))
    return f"*/Facility/{other}"


def computed_flags(client):
    return [(a["from"].rsplit("/", 1)[1], len(a["to"]), a["computed"]) for a in doc_of(client)["accesses"]]


def test_clear_and_remove_all(client, s1_computed):
    other = two_computed(client)
    assert computed_flags(client) == [("THBK", 4, True), ("THBK", 1, True), ("Facility1", 1, True)]

    r = clear(client, {"from": FAC, "to": "all"})
    assert r.status_code == 200, r.text
    assert set(r.json()) == {"etag", "cleared"} and r.json()["cleared"] == 2
    assert r.headers["ETag"] == f'"{r.json()["etag"]}"' == f'"{etag_of(client)}"'
    assert computed_flags(client) == [("THBK", 4, False), ("THBK", 1, False), ("Facility1", 1, True)]    # Facility อื่นไม่ถูกแตะ

    r = remove(client, {"from": FAC, "to": "all"})
    assert r.status_code == 200, r.text
    assert set(r.json()) == {"etag", "removed"} and r.json()["removed"] == 2
    assert r.headers["ETag"] == f'"{r.json()["etag"]}"' == f'"{etag_of(client)}"'
    assert [(a["from"], a["to"]) for a in doc_of(client)["accesses"]] == [(other, [GPS])]


def test_clear_listed_targets_only(client, s1_computed):
    two_computed(client)
    r = clear(client, {"from": FAC, "to": [GPS]})
    assert r.json()["cleared"] == 1
    assert computed_flags(client) == [("THBK", 4, True), ("THBK", 1, False), ("Facility1", 1, True)]
    assert clear(client, {"from": FAC, "to": [GPS]}).json()["cleared"] == 1                         # ตั้ง False ซ้ำก็นับว่าตรงรายการ
    r = clear(client, {"from": FAC, "to": [BEIDOU, GALILEO, GLONASS, GPS]})                         # ลำดับต่าง ชุดเดียวกัน
    assert r.json()["cleared"] == 1 and computed_flags(client)[0] == ("THBK", 4, False)


def test_remove_listed_targets_only(client, s1_computed):
    two_computed(client)
    r = remove(client, {"from": FAC, "to": [GPS]})
    assert r.status_code == 200 and r.json()["removed"] == 1
    assert computed_flags(client) == [("THBK", 4, True), ("Facility1", 1, True)]


def test_clear_and_remove_accept_the_swapped_form(client, s1_computed):
    compute(client, {"from": "*/Satellite/G01", "to": [FAC]})
    assert computed_flags(client) == [("THBK", 4, False), ("THBK", 1, True)]
    assert clear(client, {"from": "*/Satellite/G01", "to": [FAC]}).json()["cleared"] == 1
    assert computed_flags(client) == [("THBK", 4, False), ("THBK", 1, False)]
    assert remove(client, {"from": "*/Satellite/G01", "to": [FAC]}).json()["removed"] == 1
    assert computed_flags(client) == [("THBK", 4, False)]


@pytest.mark.parametrize("action,key", [(clear, "cleared"), (remove, "removed")])
def test_nothing_matching_writes_nothing(client, s1_computed, data_dir, action, key):
    before, tag = file_bytes(data_dir), etag_of(client)
    with mock.patch.object(client.app.state.bus, "publish") as publish:
        for to in ([GALILEO], [GPS, GALILEO], ["*/Satellite/G01"]):               # ชุด to ไม่ตรงกับ access ใดที่เก็บไว้
            r = action(client, {"from": FAC, "to": to})
            assert r.status_code == 200 and r.json() == {"etag": tag, key: 0}, r.text
            assert r.headers["ETag"] == f'"{tag}"'
        publish.assert_not_called()
    assert file_bytes(data_dir) == before


@pytest.mark.parametrize("action,key", [(clear, "cleared"), (remove, "removed")])
def test_all_for_a_facility_without_accesses_is_zero(client, s1_computed, data_dir, action, key):
    other = insert_facility(client)
    before, tag = file_bytes(data_dir), etag_of(client)
    r = action(client, {"from": f"*/Facility/{other}", "to": "all"})
    assert r.status_code == 200 and r.json() == {"etag": tag, key: 0}
    assert file_bytes(data_dir) == before


@pytest.mark.parametrize("action", [clear, remove])
def test_clear_remove_need_a_current_if_match(client, s1_computed, data_dir, action):
    old = etag_of(client)
    before = file_bytes(data_dir)
    assert_error(action(client, {"from": FAC, "to": "all"}, etag=None), 412, "ETAG_MISMATCH")
    make_stale(client)
    after_edit = file_bytes(data_dir)
    j = assert_error(action(client, {"from": FAC, "to": "all"}, etag=old), 412, "ETAG_MISMATCH")
    assert j["detail"] == etag_of(client) and file_bytes(data_dir) == after_edit != before
    nothing_to_do = action(client, {"from": FAC, "to": [GALILEO]}, etag=old)                          # ไม่มีรายการตรงก็ยังต้อง If-Match ที่ถูก
    assert_error(nothing_to_do, 412, "ETAG_MISMATCH")


@pytest.mark.parametrize("action", [clear, remove])
@pytest.mark.parametrize("body,field", [
    ({"from": FAC}, "to"),
    ({"from": FAC, "to": "everything"}, "to"),
    ({"from": FAC, "to": []}, "to"),
    ({"from": FAC, "to": [FAC]}, "to"),
    ({"from": FAC, "to": ["*/Satellite/NOPE"]}, "to"),
    ({"to": "all"}, "from"),
    ({"from": "*/Facility/NOPE", "to": "all"}, "from"),
    ({"from": "*/Satellite/G01", "to": "all"}, "from"),                    # "all" ไม่มี Facility ให้สลับ
    ({"from": "*/Constellation/GPS", "to": [GPS]}, "from"),
])
def test_clear_remove_bad_body_is_422_and_changes_nothing(client, s1_computed, data_dir, action, body, field):
    before = file_bytes(data_dir)
    assert_error(action(client, body), 422, "SCENARIO_INVALID", field)
    assert file_bytes(data_dir) == before


@pytest.mark.parametrize("action", [clear, remove])
def test_clear_remove_unknown_scenario_is_404(client, s1_computed, action):
    r = client.post(f"/api/scenarios/nope/access/{action.__name__}", json={"from": FAC, "to": "all"}, headers={"If-Match": '"x"'})
    assert_error(r, 404, "NOT_FOUND")


# ---------- event และการเขียน ----------

def test_edits_publish_one_scenario_event_each(client, s1_computed):
    with mock.patch.object(client.app.state.bus, "publish") as publish:
        compute(client, {"from": FAC, "to": [GPS]})
        clear(client, {"from": FAC, "to": "all"})
        remove(client, {"from": FAC, "to": "all"})
    assert [c.args[0] for c in publish.call_args_list] == ["scenario"] * 3
    tags = [c.args[1]["etag"] for c in publish.call_args_list]
    assert len(set(tags)) == 3 and tags[-1] == etag_of(client)
    assert all(c.args[1]["name"] == SC and c.args[1]["results_stale"] is False for c in publish.call_args_list)


def test_access_edits_leave_the_results_current(client, s1_computed):
    compute(client, {"from": FAC, "to": [GPS], "time_period": SPECIFY})
    clear(client, {"from": FAC, "to": "all"})
    results = client.get(f"{BASE}/results").json()
    assert results["ephem"]["status"] == "current" and results["access"]["THBK"]["status"] == "current"


def test_access_routes_are_in_openapi(client):
    paths = client.get("/api/openapi.json").json()["paths"]
    assert set(paths[f"/api/scenarios/{{sc}}/access"]) == {"get"}
    assert set(paths["/api/scenarios/{sc}/access/intervals"]) == {"get"}
    for name in ("compute", "clear", "remove"):
        assert set(paths[f"/api/scenarios/{{sc}}/access/{name}"]) == {"post"}
