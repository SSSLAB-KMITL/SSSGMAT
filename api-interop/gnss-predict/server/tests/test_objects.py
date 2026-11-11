"""object แบบ STK (หัวข้อ 6.4 ของ spec server): Object Browser, Insert STK Objects, Properties Browser, rename/delete, groups

fixture `s1` (thbk-gnss) และ `s_empty` (empty) อยู่ใน conftest.py ทั้งคู่สร้าง scenario ชื่อ S1
"""

import copy
import os
import re
import shutil
from datetime import datetime, timezone

import pytest

from gnss_predict.catalog import build_catalog
from gnss_predict.scenario import load_scenario
from gnss_studio_server import objects
from gnss_studio_server import templates
from gnss_studio_server.errors import ApiError

SC = "S1"
CURRENT = object()                       # ค่าตั้งต้นของ etag: ใช้ ETag ปัจจุบันของไฟล์ (None = ไม่ส่ง If-Match)
ERROR_KEYS = {"code", "text", "field", "detail"}
THAI = re.compile("[฀-๿]")
SYSTEM_COLORS = {"G": "#ffd23f", "R": "#ff6b6b", "E": "#4fd47e", "C": "#45c8ff"}
CATALOG_INSERT = {"class": "Satellite", "method": "From Satellite Catalog"}
# access เพิ่มเติมไว้ทดสอบการอ้างถึงดาว (access แรกของแม่แบบชี้ไป Constellation ทั้ง 4)
EXTRA_ACCESS = {"from": "*/Facility/THBK", "to": ["*/Satellite/G01", "*/Satellite/G22"], "time_period": {"mode": "object"},
                "timeline": True, "computed": False}


# ---------- helpers ----------

def assert_error(r, status, code, field=None):
    assert r.status_code == status, r.text
    j = r.json()
    assert set(j) == ERROR_KEYS and j["code"] == code and j["field"] == field, j
    assert THAI.search(j["text"])
    return j


def etag_of(client):
    return client.get(f"/api/scenarios/{SC}").headers["ETag"].strip('"')


def _headers(client, etag):
    if etag is CURRENT:
        etag = etag_of(client)
    return {} if etag is None else {"If-Match": f'"{etag}"'}


def doc_of(client):
    return client.get(f"/api/scenarios/{SC}").json()


def file_bytes(data_dir):
    return (data_dir / "scenarios" / SC / "scenario.json").read_bytes()


def put_doc(client, mutate):
    """อ่าน scenario, แก้ด้วย mutate แล้ว PUT กลับ (เตรียมข้อมูลที่ API ของ object ยังสร้างไม่ได้ เช่น access เพิ่ม)"""
    r = client.get(f"/api/scenarios/{SC}")
    doc = r.json()
    mutate(doc)
    ok = client.put(f"/api/scenarios/{SC}", json=doc, headers={"If-Match": r.headers["ETag"]})
    assert ok.status_code == 200, ok.text
    return doc


def patch(client, obj, body, etag=CURRENT):
    return client.patch(f"/api/scenarios/{SC}/objects/{obj}", json=body, headers=_headers(client, etag))


def pages(client, obj):
    r = client.get(f"/api/scenarios/{SC}/objects/{obj}")
    assert r.status_code == 200, r.text
    return r.json()


def insert(client, body, etag=CURRENT):
    return client.post(f"/api/scenarios/{SC}/objects", json=body, headers=_headers(client, etag))


def rename(client, obj, new_name, etag=CURRENT):
    return client.post(f"/api/scenarios/{SC}/objects/{obj}/rename", json={"new_name": new_name}, headers=_headers(client, etag))


def delete(client, obj, etag=CURRENT):
    return client.delete(f"/api/scenarios/{SC}/objects/{obj}", headers=_headers(client, etag))


def group(client, name, members, etag=CURRENT):
    return client.post(f"/api/scenarios/{SC}/groups", json={"name": name, "members": members}, headers=_headers(client, etag))


def tree_of(client):
    r = client.get(f"/api/scenarios/{SC}/objects")
    assert r.status_code == 200, r.text
    return r.json()


def obj_in(doc, cls, name):
    return next(o for o in doc["objects"] if o["class"] == cls and o["name"] == name)


def names_of(doc, cls):
    return [o["name"] for o in doc["objects"] if o["class"] == cls]


def catalog_norads(snapshot):
    """PRN -> NORAD ของ snapshot ใน fixture (ช่วงเวลาเดียวกับ s1/s_empty)"""
    start, stop = datetime(2026, 11, 10, tzinfo=timezone.utc), datetime(2026, 11, 10, 6, tzinfo=timezone.utc)
    return {c.prn: c.norad for c in build_catalog(snapshot, (start, stop), {"G", "R", "E", "C"}).satellites}


def assert_saved(r, client, status=200):
    """ผลของการแก้ที่สำเร็จ: {etag, results_stale} + header ETag ตรงกับไฟล์ปัจจุบัน"""
    assert r.status_code == status, r.text
    j = r.json()
    assert {"etag", "results_stale"} <= set(j) and isinstance(j["results_stale"], bool)
    assert j["etag"] == etag_of(client) and r.headers["ETag"] == f'"{j["etag"]}"'
    return j


# ---------- ฟังก์ชันของโมดูล ----------

def test_path_of_and_find(s1):
    doc, _ = s1
    assert objects.path_of({"class": "Satellite", "name": "G01"}) == "*/Satellite/G01"
    i, o = objects.find(doc, "Satellite", "G01")
    assert doc["objects"][i] is o and o["norad"] == 62339
    for cls, name in [("Satellite", "G99"), ("Satellite", "g01"), ("Facility", "G01"), ("Spaceship", "G01")]:
        with pytest.raises(ApiError) as e:
            objects.find(doc, cls, name)
        assert e.value.status == 404 and e.value.code == "NOT_FOUND" and THAI.search(e.value.text)


# ---------- Object Browser: ต้นไม้ ----------

def test_tree_shape(client, s1):
    doc, tag = s1
    r = client.get(f"/api/scenarios/{SC}/objects")
    assert r.status_code == 200 and r.headers["ETag"] == f'"{tag}"'
    tree = r.json()
    assert tree["path"] == "*" and tree["class"] == "Scenario" and tree["name"] == "S1"
    kids = tree["children"]
    assert kids[0] == {"path": "*/Facility/THBK", "class": "Facility", "name": "THBK", "color": "#ff79e6", "show": True}
    assert [k["path"] for k in kids[1:5]] == [f"*/Constellation/{n}" for n in ("GPS", "GLONASS", "Galileo", "BeiDou")]
    assert kids[1] == {"path": "*/Constellation/GPS", "class": "Constellation", "name": "GPS", "color": "#ffd23f", "show": True}
    folders = kids[5:]
    assert [f["group"] for f in folders] == ["GPS sats", "GLONASS sats", "Galileo sats", "BeiDou sats"]
    assert all(set(f) == {"group", "children"} for f in folders)
    gps = folders[0]["children"]
    assert [n["path"] for n in gps] == next(g for g in doc["groups"] if g["name"] == "GPS sats")["members"]
    assert "*/Satellite/G01" in [n["path"] for n in gps]
    assert next(n for n in gps if n["name"] == "G01") == {"path": "*/Satellite/G01", "class": "Satellite", "name": "G01",
                                                          "color": "#ffd23f", "show": True}
    # ทุกดาวอยู่ในโฟลเดอร์ของระบบตัวเองเพียงโฟลเดอร์เดียว ไม่มีดาวนอกโฟลเดอร์
    in_folders = [n["path"] for f in folders for n in f["children"]]
    assert sorted(in_folders) == sorted(f"*/Satellite/{n}" for n in names_of(doc, "Satellite"))
    assert len(kids) == 5 + 4


def test_tree_effective_color_ungrouped_and_show(client, s1):
    ungrouped_paths = ["*/Satellite/E11", "*/Satellite/E14", "*/Satellite/R05"]

    def edit(d):
        d["objects"][0]["graphics2d"]["show"] = False                             # THBK ปิด Show
        obj_in(d, "Constellation", "GPS")["color"] = "#111111"
        obj_in(d, "Satellite", "G01")["graphics2d"]["color"] = "#aaaaaa"          # inherit true -> ใช้สีของ Constellation
        g22 = obj_in(d, "Satellite", "G22"); g22["graphics2d"].update({"inherit": False, "color": "#222222", "show": False})
        for g in d["groups"]:
            g["members"] = [m for m in g["members"] if m not in ungrouped_paths]
        obj_in(d, "Constellation", "Galileo")["assigned_objects"].remove("*/Satellite/E11")      # E11 ไม่อยู่ใน Constellation
        obj_in(d, "Satellite", "E11")["graphics2d"]["color"] = "#444444"
        obj_in(d, "Satellite", "E14")["graphics2d"].pop("color")                  # ไม่มีสีเอง -> สีของ Galileo
        obj_in(d, "Constellation", "GLONASS")["assigned_objects"].remove("*/Satellite/R05")
        obj_in(d, "Satellite", "R05")["graphics2d"].pop("color")                  # ไม่มีสีและไม่มี Constellation -> สีตั้งต้น
    put_doc(client, edit)
    kids = tree_of(client)["children"]
    assert kids[0]["show"] is False
    nodes = {n["name"]: n for f in kids[5:9] for n in f["children"]}
    assert nodes["G01"]["color"] == "#111111" and nodes["G22"]["color"] == "#222222"
    assert nodes["G22"]["show"] is False and nodes["G01"]["show"] is True
    assert not {"E11", "E14", "R05"} & set(nodes)
    ungrouped = kids[9:]                                                           # ดาวนอกกลุ่มอยู่หลังโฟลเดอร์ทั้งหมด ตามลำดับใน objects
    assert [n["path"] for n in ungrouped] == ungrouped_paths and all("group" not in n for n in ungrouped)
    assert [n["color"] for n in ungrouped] == ["#444444", "#4fd47e", templates.DEFAULT_COLOR]


def test_tree_needs_no_catalog(client, s1, snapshot):
    """ต้นไม้ไม่สร้าง catalog: snapshot หายก็ยังตอบได้"""
    shutil.rmtree(snapshot)
    assert tree_of(client)["children"][0]["path"] == "*/Facility/THBK"


def test_tree_of_empty_scenario(client, s_empty):
    assert tree_of(client) == {"path": "*", "class": "Scenario", "name": "S1", "children": []}


def test_tree_missing_scenario_is_404(client, snapshot):
    assert_error(client.get("/api/scenarios/nope/objects"), 404, "NOT_FOUND")


# ---------- Properties Browser: อ่านหน้า ----------

def test_get_pages(client, s1):
    p = client.get("/api/scenarios/S1/objects/Satellite/G01").json()
    assert p["graphics2d"]["pass"]["lead_type"] == "Time" and p["basic"]["norad"] == 62339
    assert set(p) == {"basic", "graphics2d", "graphics3d", "constraints"}
    assert p["basic"] == {"description": "", "norad": 62339}
    assert p["graphics3d"] == {"show": True, "orbit_system": "Fixed by Window"} and p["constraints"] == {}
    assert p["graphics2d"]["color"] == "#ffd23f" and p["graphics2d"]["swath"]["elevation_deg"] == 10.0


def test_get_pages_facility_and_constellation(client, s1):
    fac = pages(client, "Facility/THBK")
    assert fac["basic"] == {"description": "", "position": {"type": "Geodetic", "lat_deg": 13.729779, "lon_deg": 100.781151, "alt_m": 6.4}}
    assert fac["constraints"] == {"elevation_angle_min_deg": 10.0}
    assert fac["graphics2d"] == {"show": True, "color": "#ff79e6", "marker_style": "Triangle", "inherit": True}
    assert fac["graphics3d"] == {"show": True}
    con = pages(client, "Constellation/GPS")
    members = obj_in(doc_of(client), "Constellation", "GPS")["assigned_objects"]
    assert con["basic"] == {"description": "", "system": "G", "color": "#ffd23f", "assigned_objects": members} and members
    assert con["graphics2d"] == {} and con["graphics3d"] == {} and con["constraints"] == {}


def test_get_pages_is_a_copy_and_carries_etag(client, s1):
    _, tag = s1
    r = client.get("/api/scenarios/S1/objects/Satellite/G01")
    assert r.headers["ETag"] == f'"{tag}"'
    r.json()["graphics2d"]["color"] = "#000000"
    assert pages(client, "Satellite/G01")["graphics2d"]["color"] == "#ffd23f"


@pytest.mark.parametrize("obj", ["Satellite/G99", "Satellite/g01", "Facility/G01", "Spaceship/G01", "Group/GPS%20sats", "Scenario/S1"])
def test_get_missing_object_is_404(client, s1, obj):
    assert_error(client.get(f"/api/scenarios/S1/objects/{obj}"), 404, "NOT_FOUND")


def test_get_object_of_missing_scenario_is_404(client, snapshot):
    assert_error(client.get("/api/scenarios/nope/objects/Satellite/G01"), 404, "NOT_FOUND")


# ---------- Properties Browser: Apply (PATCH) ----------

def test_patch_color_not_stale(client, s1):
    e = etag_of(client)
    r = patch(client, "Satellite/G01", {"graphics2d": {"color": "#00ff00"}})
    assert r.json()["results_stale"] is False
    j = assert_saved(r, client)
    assert j["etag"] != e and set(j) == {"etag", "results_stale"}
    assert pages(client, "Satellite/G01")["graphics2d"]["color"] == "#00ff00"


def test_patch_merges_only_the_groups_sent_deeply(client, s1):
    before = doc_of(client)
    r = patch(client, "Satellite/G01", {"graphics2d": {"pass": {"lead_time_s": 600}, "line_width": 2}, "basic": {"description": "ดาวทดสอบ"}})
    assert_saved(r, client)
    after = doc_of(client)
    new, old = obj_in(after, "Satellite", "G01"), obj_in(before, "Satellite", "G01")
    expected = copy.deepcopy(old)
    expected["graphics2d"]["pass"]["lead_time_s"] = 600
    expected["graphics2d"]["line_width"] = 2
    expected["description"] = "ดาวทดสอบ"
    assert new == expected                                                        # ที่ไม่ได้ส่ง (lead_type, trail_time_s, graphics3d ฯลฯ) ไม่เปลี่ยน
    others_before = [o for o in before["objects"] if o["name"] != "G01"]
    assert [o for o in after["objects"] if o["name"] != "G01"] == others_before
    assert {k: v for k, v in after.items() if k != "objects"} == {k: v for k, v in before.items() if k != "objects"}
    assert pages(client, "Satellite/G01")["basic"]["description"] == "ดาวทดสอบ"


def test_patch_min_el_makes_access_stale(client, s1):
    r = patch(client, "Facility/THBK", {"constraints": {"elevation_angle_min_deg": 15}})
    assert r.json()["results_stale"] is True
    assert_saved(r, client)
    assert pages(client, "Facility/THBK")["constraints"]["elevation_angle_min_deg"] == 15


def test_patch_facility_position_is_stale_and_merges(client, s1):
    r = patch(client, "Facility/THBK", {"basic": {"position": {"lat_deg": 14.0}}})
    assert r.json()["results_stale"] is True
    assert pages(client, "Facility/THBK")["basic"]["position"] == {"type": "Geodetic", "lat_deg": 14.0, "lon_deg": 100.781151, "alt_m": 6.4}


def test_patch_facility_max_elevation(client, s1):
    r = patch(client, "Facility/THBK", {"constraints": {"elevation_angle_max_deg": 80}})
    assert_saved(r, client); assert r.json()["results_stale"] is False             # engine ใช้เฉพาะมุมเงยต่ำสุด
    assert pages(client, "Facility/THBK")["constraints"] == {"elevation_angle_min_deg": 10.0, "elevation_angle_max_deg": 80}
    assert_saved(patch(client, "Facility/THBK", {"constraints": {"elevation_angle_max_deg": None}}), client)
    assert pages(client, "Facility/THBK")["constraints"]["elevation_angle_max_deg"] is None
    assert_error(patch(client, "Facility/THBK", {"constraints": {"elevation_angle_max_deg": 91}}), 422, "SCENARIO_INVALID",
                 "constraints.elevation_angle_max_deg")


def test_patch_same_value_or_graphics_only_is_not_stale(client, s1):
    assert patch(client, "Facility/THBK", {"constraints": {"elevation_angle_min_deg": 10}}).json()["results_stale"] is False
    assert patch(client, "Facility/THBK", {"graphics2d": {"color": "#123456", "marker_style": "Star"}}).json()["results_stale"] is False
    assert patch(client, "Satellite/G01", {"graphics3d": {"show": False}}).json()["results_stale"] is False


def test_stale_etag_patch_rejected(client, s1, data_dir):          # Review Focus 2
    e = etag_of(client); patch(client, "Satellite/G01", {"graphics2d": {"color": "#00ff00"}}, etag=e)
    before = file_bytes(data_dir)
    r = patch(client, "Satellite/G01", {"graphics2d": {"color": "#ff0000"}}, etag=e); assert r.status_code == 412
    assert pages(client, "Satellite/G01")["graphics2d"]["color"] == "#00ff00"
    j = assert_error(r, 412, "ETAG_MISMATCH")
    assert j["detail"] == etag_of(client) and file_bytes(data_dir) == before


def test_patch_without_if_match_is_412(client, s1, data_dir):
    before = file_bytes(data_dir)
    assert_error(patch(client, "Satellite/G01", {"graphics2d": {"color": "#00ff00"}}, etag=None), 412, "ETAG_MISMATCH")
    assert file_bytes(data_dir) == before


def test_stale_etag_wins_over_a_bad_body(client, s1):
    """If-Match ตรวจก่อนแก้: ผู้ส่ง ETag เก่าได้ 412 ไม่ใช่ 422 ที่คำนวณจากเอกสารที่ไม่ได้เห็น"""
    assert_error(patch(client, "Satellite/G01", {"graphics2d": {"color": "red"}}, etag="0123456789abcdef"), 412, "ETAG_MISMATCH")
    assert_error(patch(client, "Satellite/G99", {"graphics2d": {"color": "#00ff00"}}, etag="0123456789abcdef"), 412, "ETAG_MISMATCH")


@pytest.mark.parametrize("body,field", [
    ({"graphics2d": {"color": "red"}}, "graphics2d.color"),
    ({"graphics2d": {"marker_style": "Blob"}}, "graphics2d.marker_style"),
    ({"graphics2d": {"pass": {"lead_type": "Forever"}}}, "graphics2d.pass.lead_type"),
    ({"graphics2d": {"swath": {"options": "Hatched"}}}, "graphics2d.swath.options"),
    ({"graphics3d": {"orbit_system": "Rotating"}}, "graphics3d.orbit_system"),
    ({"graphics2d": {"show": "yes"}}, "graphics2d.show"),
    ({"basic": {"description": 5}}, "basic.description"),
])
def test_patch_invalid_value_names_the_page_field(client, s1, data_dir, body, field):
    before = file_bytes(data_dir)
    j = assert_error(patch(client, "Satellite/G01", body), 422, "SCENARIO_INVALID", field)
    assert field in j["text"] and file_bytes(data_dir) == before


@pytest.mark.parametrize("body,field", [
    ({"constraints": {"elevation_angle_min_deg": 95}}, "constraints.elevation_angle_min_deg"),
    ({"constraints": {"elevation_angle_min_deg": "ten"}}, "constraints.elevation_angle_min_deg"),
    ({"basic": {"position": {"lat_deg": 91}}}, "basic.position.lat_deg"),
    ({"basic": {"position": {"lon_deg": -181}}}, "basic.position.lon_deg"),
    ({"graphics2d": {"color": "#12345"}}, "graphics2d.color"),
])
def test_patch_invalid_facility_value(client, s1, data_dir, body, field):
    before = file_bytes(data_dir)
    assert_error(patch(client, "Facility/THBK", body), 422, "SCENARIO_INVALID", field)
    assert file_bytes(data_dir) == before


def test_patch_unknown_page_group_is_422(client, s1, data_dir):
    before = file_bytes(data_dir)
    assert_error(patch(client, "Satellite/G01", {"graphics4d": {"show": True}}), 422, "SCENARIO_INVALID", "graphics4d")
    assert_error(patch(client, "Satellite/G01", {"graphics2d": {"color": "#00ff00"}, "name": {"x": 1}}), 422, "SCENARIO_INVALID", "name")
    assert_error(patch(client, "Satellite/G01", {"graphics2d": "#00ff00"}), 422, "SCENARIO_INVALID", "graphics2d")
    assert file_bytes(data_dir) == before                                          # ไม่แก้ครึ่งเดียว


def test_patch_satellite_norad_is_read_only(client, s1, data_dir):
    before = file_bytes(data_dir)
    assert_error(patch(client, "Satellite/G01", {"basic": {"norad": 12345}}), 422, "SCENARIO_INVALID", "basic.norad")
    assert_error(patch(client, "Satellite/G01", {"basic": {"norad": True}}), 422, "SCENARIO_INVALID", "basic.norad")
    assert file_bytes(data_dir) == before
    r = patch(client, "Satellite/G01", {"basic": {"norad": 62339, "description": "same norad"}})         # ส่งค่าเดิมกลับมาได้
    assert_saved(r, client); assert r.json()["results_stale"] is False
    assert pages(client, "Satellite/G01")["basic"] == {"description": "same norad", "norad": 62339}


def test_patch_basic_rejects_keys_outside_the_page(client, s1, data_dir):
    before = file_bytes(data_dir)
    for obj, key in [("Satellite/G01", "name"), ("Satellite/G01", "class"), ("Satellite/G01", "graphics2d"),
                     ("Facility/THBK", "norad"), ("Constellation/GPS", "position")]:
        assert_error(patch(client, obj, {"basic": {key: "X"}}), 422, "SCENARIO_INVALID", f"basic.{key}")
    assert file_bytes(data_dir) == before


def test_patch_constellation_basic(client, s1):
    r = patch(client, "Constellation/GPS", {"basic": {"description": "GPS", "color": "#010203"}})
    assert_saved(r, client); assert r.json()["results_stale"] is False
    con = pages(client, "Constellation/GPS")["basic"]
    assert con["color"] == "#010203" and con["description"] == "GPS" and con["system"] == "G"
    members = con["assigned_objects"]
    r = patch(client, "Constellation/GPS", {"basic": {"assigned_objects": members + ["*/Satellite/E11"], "system": None}})
    assert_saved(r, client)
    after = pages(client, "Constellation/GPS")["basic"]
    assert after["assigned_objects"] == members + ["*/Satellite/E11"] and after["system"] is None


def test_patch_constellation_members_must_exist(client, s1, data_dir):
    before = file_bytes(data_dir)
    assert_error(patch(client, "Constellation/GPS", {"basic": {"assigned_objects": ["*/Satellite/NOPE"]}}),
                 422, "SCENARIO_INVALID", "basic.assigned_objects")
    assert_error(patch(client, "Constellation/GPS", {"basic": {"assigned_objects": ["G01"]}}),
                 422, "SCENARIO_INVALID", "basic.assigned_objects[0]")
    assert file_bytes(data_dir) == before


def test_patch_constellation_has_no_graphics_pages(client, s1, data_dir):
    before = file_bytes(data_dir)
    for group_name in ("graphics2d", "graphics3d", "constraints"):
        assert_error(patch(client, "Constellation/GPS", {group_name: {"show": True}}), 422, "SCENARIO_INVALID", group_name)
    assert_error(patch(client, "Satellite/G01", {"constraints": {"elevation_angle_min_deg": 5}}), 422, "SCENARIO_INVALID", "constraints")
    assert file_bytes(data_dir) == before
    assert_saved(patch(client, "Constellation/GPS", {"graphics2d": {}}), client)                  # หน้าว่างไม่ทำอะไร


def test_patch_missing_object_or_scenario_is_404(client, s1):
    body = {"graphics2d": {"color": "#00ff00"}}
    assert_error(patch(client, "Satellite/G99", body), 404, "NOT_FOUND")
    assert_error(patch(client, "Spaceship/G01", body), 404, "NOT_FOUND")
    assert_error(client.patch("/api/scenarios/nope/objects/Satellite/G01", json=body, headers={"If-Match": "x"}), 404, "NOT_FOUND")


def test_patch_when_snapshot_missing_is_stale(client, s1, snapshot):
    shutil.rmtree(snapshot)                                                        # คำนวณ plan ไม่ได้ -> ถือว่า stale
    r = patch(client, "Satellite/G01", {"graphics2d": {"color": "#00ff00"}})
    assert_saved(r, client); assert r.json()["results_stale"] is True
    assert pages(client, "Satellite/G01")["graphics2d"]["color"] == "#00ff00"


def test_patch_in_scenario_without_satellites_is_not_stale(client, s_empty):
    insert(client, {"class": "Facility", "method": "Insert Default"})
    r = patch(client, "Facility/Facility1", {"constraints": {"elevation_angle_min_deg": 15}})
    assert_saved(r, client); assert r.json()["results_stale"] is False             # ไม่มีดาว: ไม่มีผลที่จะไม่ตรง


# ---------- Insert STK Objects ----------

def test_insert_from_catalog_with_constellation(client, s_empty, snapshot):
    norads = catalog_norads(snapshot)
    assert norads["G01"] == 62339 and norads["E11"] == 37846
    r = insert(client, {**CATALOG_INSERT, "norads": [62339, 37846], "create_constellation": "Mine"})
    assert set(r.json()["created"]) == {"*/Satellite/G01", "*/Satellite/E11", "*/Constellation/Mine"}
    j = assert_saved(r, client, 201)
    assert j["created"] == ["*/Satellite/G01", "*/Satellite/E11", "*/Constellation/Mine"] and j["results_stale"] is True
    doc = doc_of(client)
    g01, e11 = obj_in(doc, "Satellite", "G01"), obj_in(doc, "Satellite", "E11")
    assert g01["norad"] == 62339 and e11["norad"] == 37846
    assert g01["graphics2d"]["color"] == "#ffd23f" and e11["graphics2d"]["color"] == "#4fd47e"          # สีของระบบ
    assert g01["graphics2d"]["inherit"] is True and g01["graphics2d"]["pass"]["lead_time_s"] == 1800
    assert g01["graphics2d"]["swath"] == {"type": "Ground Elevation", "elevation_deg": 10.0, "options": "No Graphics"}
    assert g01["graphics3d"] == {"show": True, "orbit_system": "Fixed by Window"}
    mine = obj_in(doc, "Constellation", "Mine")
    assert mine["assigned_objects"] == ["*/Satellite/G01", "*/Satellite/E11"]
    assert mine["system"] is None and re.fullmatch(r"#[0-9a-fA-F]{6}", mine["color"])                    # หลายระบบ: system เป็น null
    assert mine["color"] not in SYSTEM_COLORS.values()
    assert doc["groups"] == [] and doc["accesses"] == []


def test_insert_from_catalog_single_system_constellation(client, s_empty, snapshot):
    norads = catalog_norads(snapshot)
    r = insert(client, {**CATALOG_INSERT, "norads": [norads["G01"], norads["G22"]], "create_constellation": "OnlyGps"})
    assert r.json()["created"] == ["*/Satellite/G01", "*/Satellite/G22", "*/Constellation/OnlyGps"]
    mine = obj_in(doc_of(client), "Constellation", "OnlyGps")
    assert mine["system"] == "G" and mine["color"] == "#ffd23f"


def test_insert_from_catalog_without_constellation(client, s_empty, snapshot):
    norads = catalog_norads(snapshot)
    r = insert(client, {**CATALOG_INSERT, "norads": [norads["R05"], norads["C01"], norads["R05"]]})          # NORAD ซ้ำในคำขอนับครั้งเดียว
    assert r.json()["created"] == ["*/Satellite/R05", "*/Satellite/C01"]
    doc = doc_of(client)
    assert names_of(doc, "Constellation") == [] and names_of(doc, "Satellite") == ["R05", "C01"]
    assert obj_in(doc, "Satellite", "R05")["graphics2d"]["color"] == "#ff6b6b"
    assert obj_in(doc, "Satellite", "C01")["graphics2d"]["color"] == "#45c8ff"


def test_insert_from_catalog_into_scenario_with_satellites_is_stale(client, s1, snapshot):
    norads = catalog_norads(snapshot)
    put_doc(client, lambda d: d["objects"].remove(obj_in(d, "Satellite", "G01")))
    r = insert(client, {**CATALOG_INSERT, "norads": [norads["G01"]]})
    assert_saved(r, client, 201); assert r.json()["results_stale"] is True         # ชุดดาวที่ propagate เปลี่ยน
    assert "G01" in names_of(doc_of(client), "Satellite")


def test_insert_from_catalog_unknown_norad_is_422_and_writes_nothing(client, s_empty, data_dir):
    before = file_bytes(data_dir)
    j = assert_error(insert(client, {**CATALOG_INSERT, "norads": [62339, 99999999]}), 422, "SCENARIO_INVALID", "norads")
    assert "99999999" in j["text"]
    assert file_bytes(data_dir) == before


@pytest.mark.parametrize("norads", [[], "62339", [62339.5], ["62339"], [0], [-5], [True], None])
def test_insert_from_catalog_bad_norads_is_422(client, s_empty, data_dir, norads):
    before = file_bytes(data_dir)
    assert_error(insert(client, {**CATALOG_INSERT, "norads": norads}), 422, "SCENARIO_INVALID", "norads")
    assert_error(insert(client, CATALOG_INSERT), 422, "SCENARIO_INVALID", "norads")
    assert file_bytes(data_dir) == before


@pytest.mark.parametrize("name", ["a b", "", "x" * 33, "ไทย", "a/b", 5])
def test_insert_from_catalog_bad_constellation_name_is_422(client, s_empty, data_dir, name):
    before = file_bytes(data_dir)
    assert_error(insert(client, {**CATALOG_INSERT, "norads": [62339], "create_constellation": name}),
                 422, "SCENARIO_INVALID", "create_constellation")
    assert file_bytes(data_dir) == before


def test_insert_from_catalog_for_other_class_is_422(client, s_empty):
    assert_error(insert(client, {"class": "Facility", "method": "From Satellite Catalog", "norads": [62339]}), 422, "SCENARIO_INVALID", "class")


def test_insert_from_catalog_when_snapshot_missing(client, s_empty, snapshot, data_dir):
    shutil.rmtree(snapshot)
    before = file_bytes(data_dir)
    assert_error(insert(client, {**CATALOG_INSERT, "norads": [62339]}), 422, "ORBIT_SOURCE_UNAVAILABLE", "orbit_snapshot")
    assert file_bytes(data_dir) == before


def test_insert_default_facility_name(client, s1):
    r = insert(client, {"class": "Facility", "method": "Insert Default"})
    assert r.json()["created"] == ["*/Facility/Facility1"]
    j = assert_saved(r, client, 201); assert j["results_stale"] is True            # Facility ใหม่ต้องมีผล access ของตัวเอง
    fac = obj_in(doc_of(client), "Facility", "Facility1")
    assert fac["position"] == {"type": "Geodetic", "lat_deg": 0, "lon_deg": 0, "alt_m": 0}
    assert fac["constraints"] == {"elevation_angle_min_deg": 0}
    assert fac["graphics2d"] == {"show": True, "color": "#ff79e6", "marker_style": "Triangle", "inherit": True}
    assert fac["graphics3d"] == {"show": True} and fac["description"] == ""
    assert pages(client, "Facility/Facility1")["basic"]["position"]["lat_deg"] == 0
    assert tree_of(client)["children"][1]["path"] == "*/Facility/Facility1"       # อยู่ในหมู่ Facility ของต้นไม้


def test_insert_default_picks_first_free_name(client, s1):
    assert insert(client, {"class": "Facility", "method": "Insert Default"}).json()["created"] == ["*/Facility/Facility1"]
    assert insert(client, {"class": "Facility", "method": "Insert Default"}).json()["created"] == ["*/Facility/Facility2"]
    assert_saved(delete(client, "Facility/Facility1"), client)
    assert insert(client, {"class": "Facility", "method": "Insert Default"}).json()["created"] == ["*/Facility/Facility1"]
    put_doc(client, lambda d: obj_in(d, "Facility", "Facility2").update({"name": "FACILITY2"}))
    assert insert(client, {"class": "Facility", "method": "Insert Default"}).json()["created"] == ["*/Facility/Facility3"]    # ไม่สนตัวพิมพ์


def test_insert_default_name_taken_by_other_class(client, s1):
    put_doc(client, lambda d: obj_in(d, "Constellation", "GPS").update({"name": "Facility1"}))
    assert insert(client, {"class": "Facility", "method": "Insert Default"}).json()["created"] == ["*/Facility/Facility2"]


def test_insert_default_constellation(client, s1):
    r = insert(client, {"class": "Constellation", "method": "Insert Default"})
    assert r.json()["created"] == ["*/Constellation/Constellation1"]
    j = assert_saved(r, client, 201); assert j["results_stale"] is False
    con = obj_in(doc_of(client), "Constellation", "Constellation1")
    assert con["assigned_objects"] == [] and con["system"] is None and con["description"] == ""
    assert re.fullmatch(r"#[0-9a-fA-F]{6}", con["color"])
    assert insert(client, {"class": "Constellation", "method": "Insert Default"}).json()["created"] == ["*/Constellation/Constellation2"]


def test_insert_default_satellite_is_422(client, s1, data_dir):
    before = file_bytes(data_dir)
    assert_error(insert(client, {"class": "Satellite", "method": "Insert Default"}), 422, "SCENARIO_INVALID", "method")
    assert file_bytes(data_dir) == before


def test_insert_into_empty_scenario_facility_is_not_stale(client, s_empty):
    r = insert(client, {"class": "Facility", "method": "Insert Default"})
    assert_saved(r, client, 201); assert r.json()["results_stale"] is False        # ไม่มีดาว -> ยังไม่มีอะไรให้คำนวณ


def test_insert_define_properties_facility(client, s1):
    body = {"class": "Facility", "method": "Define Properties", "name": "CHMA", "description": "Chiang Mai",
            "position": {"type": "Geodetic", "lat_deg": 18.76, "lon_deg": 98.97, "alt_m": 310},
            "constraints": {"elevation_angle_min_deg": 5}, "graphics2d": {"color": "#112233"}}
    r = insert(client, body)
    assert r.json()["created"] == ["*/Facility/CHMA"]
    assert_saved(r, client, 201)
    fac = obj_in(doc_of(client), "Facility", "CHMA")
    assert fac["position"] == body["position"] and fac["constraints"] == {"elevation_angle_min_deg": 5}
    assert fac["description"] == "Chiang Mai" and "method" not in fac
    assert fac["graphics2d"] == {"show": True, "color": "#112233", "marker_style": "Triangle", "inherit": True}      # ที่ไม่ส่งใช้ค่าตั้งต้น
    assert fac["graphics3d"] == {"show": True}


def test_insert_define_properties_facility_minimal(client, s1):
    r = insert(client, {"class": "Facility", "method": "Define Properties", "name": "ABC",
                        "position": {"lat_deg": 1.5, "lon_deg": 2.5, "alt_m": 3}})
    assert r.status_code == 201, r.text
    fac = obj_in(doc_of(client), "Facility", "ABC")
    assert fac["position"] == {"type": "Geodetic", "lat_deg": 1.5, "lon_deg": 2.5, "alt_m": 3}
    assert fac["constraints"] == {"elevation_angle_min_deg": 0} and fac["graphics2d"]["color"] == "#ff79e6"


def test_insert_define_properties_satellite(client, s_empty):
    r = insert(client, {"class": "Satellite", "method": "Define Properties", "name": "MYSAT", "norad": 62339,
                        "graphics2d": {"color": "#abcdef", "pass": {"lead_time_s": 60}}})
    assert r.json()["created"] == ["*/Satellite/MYSAT"]
    assert_saved(r, client, 201); assert r.json()["results_stale"] is True        # NORAD อยู่ใน snapshot: มีดาวให้ propagate เพิ่ม
    sat = obj_in(doc_of(client), "Satellite", "MYSAT")
    assert sat["norad"] == 62339 and sat["graphics2d"]["color"] == "#abcdef" and sat["graphics2d"]["inherit"] is True
    assert sat["graphics2d"]["pass"]["lead_time_s"] == 60 and sat["graphics2d"]["pass"]["lead_type"] == "Time"      # ผสมกับค่าตั้งต้น
    assert sat["graphics3d"] == {"show": True, "orbit_system": "Fixed by Window"}


def test_insert_define_properties_satellite_outside_the_snapshot_is_not_stale(client, s_empty):
    """NORAD ที่ไม่มีใน snapshot สร้างได้ แต่ engine ไม่มีดาวให้ propagate เพิ่ม ผลจึงไม่เปลี่ยน"""
    r = insert(client, {"class": "Satellite", "method": "Define Properties", "name": "OFFSNAP", "norad": 12345})
    assert_saved(r, client, 201); assert r.json()["results_stale"] is False
    assert obj_in(doc_of(client), "Satellite", "OFFSNAP")["graphics2d"]["color"] == "#cccccc"


def test_insert_define_properties_constellation(client, s1):
    r = insert(client, {"class": "Constellation", "method": "Define Properties", "name": "Mix", "system": "G",
                        "assigned_objects": ["*/Satellite/G01", "*/Satellite/G22"]})
    assert r.json()["created"] == ["*/Constellation/Mix"]
    con = obj_in(doc_of(client), "Constellation", "Mix")
    assert con["system"] == "G" and con["color"] == "#ffd23f" and con["assigned_objects"] == ["*/Satellite/G01", "*/Satellite/G22"]
    r = insert(client, {"class": "Constellation", "method": "Define Properties", "name": "Empty2", "color": "#010101"})
    assert r.status_code == 201
    con = obj_in(doc_of(client), "Constellation", "Empty2")
    assert con["assigned_objects"] == [] and con["color"] == "#010101" and con["system"] is None


@pytest.mark.parametrize("body,field", [
    ({"class": "Facility", "name": "A", "position": {"lat_deg": 91, "lon_deg": 0, "alt_m": 0}}, "position.lat_deg"),
    ({"class": "Facility", "name": "A", "position": {"lat_deg": 0, "lon_deg": 0}}, "position.alt_m"),
    ({"class": "Facility", "name": "A"}, "position"),
    ({"class": "Facility", "name": "A", "position": {"lat_deg": 0, "lon_deg": 0, "alt_m": 0}, "graphics2d": {"color": "red"}}, "graphics2d.color"),
    ({"class": "Facility", "position": {"lat_deg": 0, "lon_deg": 0, "alt_m": 0}}, "name"),
    ({"class": "Facility", "name": "a b", "position": {"lat_deg": 0, "lon_deg": 0, "alt_m": 0}}, "name"),
    ({"class": "Facility", "name": "x" * 33, "position": {"lat_deg": 0, "lon_deg": 0, "alt_m": 0}}, "name"),
    ({"class": "Facility", "name": "A", "position": {"lat_deg": 0, "lon_deg": 0, "alt_m": 0}, "norad": 5}, "norad"),
    ({"class": "Satellite", "name": "A"}, "norad"),
    ({"class": "Satellite", "name": "A", "norad": 0}, "norad"),
    ({"class": "Satellite", "name": "A", "norad": "5"}, "norad"),
    ({"class": "Constellation", "name": "A", "system": "X"}, "system"),
    ({"class": "Constellation", "name": "A", "assigned_objects": ["*/Satellite/NOPE"]}, "assigned_objects"),
])
def test_insert_define_properties_invalid(client, s1, data_dir, body, field):
    before = file_bytes(data_dir)
    assert_error(insert(client, {"method": "Define Properties", **body}), 422, "SCENARIO_INVALID", field)
    assert file_bytes(data_dir) == before


@pytest.mark.parametrize("body,field", [
    ({"class": "Facility"}, "method"),
    ({"class": "Facility", "method": "Fill In"}, "method"),
    ({"class": "Facility", "method": 5}, "method"),
    ({"method": "Insert Default"}, "class"),
    ({"class": "Spaceship", "method": "Insert Default"}, "class"),
    ({"class": "Scenario", "method": "Insert Default"}, "class"),
    ({"class": ["Facility"], "method": "Insert Default"}, "class"),
    ({"class": "Facility", "method": "Insert Default", "name": "Mine"}, "name"),
    ({"class": "Satellite", "method": "From Satellite Catalog", "norads": [62339], "position": {}}, "position"),
])
def test_insert_bad_class_or_method_is_422(client, s1, data_dir, body, field):
    before = file_bytes(data_dir)
    assert_error(insert(client, body), 422, "SCENARIO_INVALID", field)
    assert file_bytes(data_dir) == before


def test_insert_requires_if_match(client, s_empty, data_dir):
    before = file_bytes(data_dir)
    assert_error(insert(client, {"class": "Facility", "method": "Insert Default"}, etag=None), 412, "ETAG_MISMATCH")
    assert_error(insert(client, {"class": "Facility", "method": "Insert Default"}, etag="0123456789abcdef"), 412, "ETAG_MISMATCH")
    assert file_bytes(data_dir) == before


def test_insert_into_missing_scenario_is_404(client, snapshot):
    r = client.post("/api/scenarios/nope/objects", json={"class": "Facility", "method": "Insert Default"}, headers={"If-Match": "x"})
    assert_error(r, 404, "NOT_FOUND")


def test_name_collision_409(client, s1, data_dir):
    before = file_bytes(data_dir)
    fac = {"class": "Facility", "method": "Define Properties", "position": {"lat_deg": 0, "lon_deg": 0, "alt_m": 0}}
    j = assert_error(insert(client, {**fac, "name": "THBK"}), 409, "NAME_EXISTS", "name")
    assert j["detail"] == "THBK"
    assert_error(insert(client, {**fac, "name": "thbk"}), 409, "NAME_EXISTS", "name")                  # ไม่แยกตัวพิมพ์เล็กใหญ่
    assert_error(insert(client, {**fac, "name": "g01"}), 409, "NAME_EXISTS", "name")                   # ชื่อซ้ำข้าม class
    assert_error(insert(client, {"class": "Satellite", "method": "Define Properties", "name": "gps", "norad": 5}), 409, "NAME_EXISTS", "name")
    assert_error(insert(client, {**CATALOG_INSERT, "norads": [62339]}), 409, "NAME_EXISTS", "norads")
    assert_error(insert(client, {**CATALOG_INSERT, "norads": [62339], "create_constellation": "New"}), 409, "NAME_EXISTS", "norads")
    assert file_bytes(data_dir) == before                                                              # ไม่เขียนอะไรเลย


def test_name_collision_in_catalog_insert_writes_nothing_even_for_free_names(client, s1, data_dir, snapshot):
    """ชุดที่มีดวงชนชื่อหนึ่งดวง ไม่สร้างดวงอื่นของชุดนั้นเลย และชื่อ Constellation ที่ซ้ำก็ 409 เช่นกัน"""
    norads = catalog_norads(snapshot)
    put_doc(client, lambda d: [d["objects"].remove(o) for o in list(d["objects"]) if o["name"] == "E11"])
    before = file_bytes(data_dir)
    j = assert_error(insert(client, {**CATALOG_INSERT, "norads": [norads["E11"], norads["G01"]]}), 409, "NAME_EXISTS", "norads")
    assert j["detail"] == "G01" and file_bytes(data_dir) == before and "E11" not in names_of(doc_of(client), "Satellite")
    assert_error(insert(client, {**CATALOG_INSERT, "norads": [norads["E11"]], "create_constellation": "gps"}),
                 409, "NAME_EXISTS", "create_constellation")
    assert_error(insert(client, {**CATALOG_INSERT, "norads": [norads["E11"]], "create_constellation": "E11"}),
                 409, "NAME_EXISTS", "create_constellation")                                           # ชนกับดาวที่กำลังสร้างในชุดเดียวกัน
    assert file_bytes(data_dir) == before


# ---------- Rename ----------

def _with_extra_access(client):
    put_doc(client, lambda d: d["accesses"].append(copy.deepcopy(EXTRA_ACCESS)))


def test_rename_updates_references(client, s1):
    _with_extra_access(client)
    before = doc_of(client)
    r = rename(client, "Satellite/G01", "GPS01")
    j = assert_saved(r, client); assert j["results_stale"] is False and set(j) == {"etag", "results_stale"}
    doc = doc_of(client)
    assert "G01" not in names_of(doc, "Satellite") and obj_in(doc, "Satellite", "GPS01")["norad"] == 62339
    assert doc["objects"].index(obj_in(doc, "Satellite", "GPS01")) == before["objects"].index(obj_in(before, "Satellite", "G01"))
    gps = obj_in(doc, "Constellation", "GPS")["assigned_objects"]
    assert "*/Satellite/GPS01" in gps and "*/Satellite/G01" not in gps
    assert gps == [m.replace("*/Satellite/G01", "*/Satellite/GPS01") for m in obj_in(before, "Constellation", "GPS")["assigned_objects"]]
    gps_sats = next(g for g in doc["groups"] if g["name"] == "GPS sats")["members"]
    assert "*/Satellite/GPS01" in gps_sats and "*/Satellite/G01" not in gps_sats
    assert doc["accesses"][1]["to"] == ["*/Satellite/GPS01", "*/Satellite/G22"]
    assert "G01" not in str(doc["groups"]) and "Satellite/G01" not in str(doc["objects"]) + str(doc["accesses"])
    # ที่ไม่เกี่ยวต้องไม่เปลี่ยน
    assert doc["accesses"][0] == before["accesses"][0]
    assert [o for o in doc["objects"] if o["name"] not in ("GPS01", "GPS", "G01")] == [o for o in before["objects"] if o["name"] not in ("G01", "GPS")]
    assert pages(client, "Satellite/GPS01")["basic"]["norad"] == 62339
    assert_error(client.get("/api/scenarios/S1/objects/Satellite/G01"), 404, "NOT_FOUND")


def test_rename_facility_updates_access_from_and_is_stale(client, s1):
    _with_extra_access(client)
    r = rename(client, "Facility/THBK", "BKK")
    j = assert_saved(r, client); assert j["results_stale"] is True                 # access ของ Facility เก็บตามชื่อ จึงต้องคำนวณใหม่
    doc = doc_of(client)
    assert [a["from"] for a in doc["accesses"]] == ["*/Facility/BKK", "*/Facility/BKK"]
    assert names_of(doc, "Facility") == ["BKK"]


def test_rename_constellation_updates_access_to(client, s1):
    r = rename(client, "Constellation/GPS", "Navstar")
    assert_saved(r, client)
    doc = doc_of(client)
    assert doc["accesses"][0]["to"] == ["*/Constellation/Navstar", "*/Constellation/GLONASS", "*/Constellation/Galileo", "*/Constellation/BeiDou"]
    assert pages(client, "Constellation/Navstar")["basic"]["system"] == "G"


def test_rename_collision_409(client, s1, data_dir):
    before = file_bytes(data_dir)
    j = assert_error(rename(client, "Satellite/G01", "G22"), 409, "NAME_EXISTS", "new_name")
    assert j["detail"] == "G22"
    assert_error(rename(client, "Satellite/G01", "g22"), 409, "NAME_EXISTS", "new_name")               # ไม่สนตัวพิมพ์
    assert_error(rename(client, "Satellite/G01", "THBK"), 409, "NAME_EXISTS", "new_name")              # ชนข้าม class
    assert_error(rename(client, "Facility/THBK", "gps"), 409, "NAME_EXISTS", "new_name")
    assert file_bytes(data_dir) == before


def test_rename_to_own_name_in_other_case_or_same_is_allowed(client, s1):
    assert_saved(rename(client, "Satellite/G01", "g01"), client)
    assert "g01" in names_of(doc_of(client), "Satellite") and "*/Satellite/g01" in obj_in(doc_of(client), "Constellation", "GPS")["assigned_objects"]
    assert_saved(rename(client, "Satellite/g01", "g01"), client)


@pytest.mark.parametrize("bad", ["a b", "", "x" * 33, "ไทย", "../evil", "a/b", "a.b", "THBK\n"])
def test_rename_invalid_name_is_422(client, s1, data_dir, bad):
    before = file_bytes(data_dir)
    assert_error(rename(client, "Satellite/G01", bad), 422, "SCENARIO_INVALID", "new_name")
    assert file_bytes(data_dir) == before


def test_rename_requires_new_name_string(client, s1):
    r = client.post("/api/scenarios/S1/objects/Satellite/G01/rename", json={}, headers=_headers(client, CURRENT))
    assert_error(r, 422, "SCENARIO_INVALID", "new_name")
    r = client.post("/api/scenarios/S1/objects/Satellite/G01/rename", json={"new_name": 5}, headers=_headers(client, CURRENT))
    assert r.status_code == 422 and r.json()["field"] == "new_name"


def test_rename_requires_if_match_and_existing_object(client, s1, data_dir):
    before = file_bytes(data_dir)
    assert_error(rename(client, "Satellite/G01", "GPS01", etag=None), 412, "ETAG_MISMATCH")
    assert_error(rename(client, "Satellite/G01", "GPS01", etag="0123456789abcdef"), 412, "ETAG_MISMATCH")
    assert file_bytes(data_dir) == before
    assert_error(rename(client, "Satellite/G99", "GPS99"), 404, "NOT_FOUND")
    assert_error(rename(client, "Spaceship/G01", "GPS01"), 404, "NOT_FOUND")


# ---------- Delete ----------

def test_delete_removes_references(client, s1):
    _with_extra_access(client)
    before = doc_of(client)
    r = delete(client, "Satellite/G01")
    j = assert_saved(r, client); assert j["results_stale"] is True and set(j) == {"etag", "results_stale"}         # ชุดดาวเปลี่ยน
    doc = doc_of(client)
    assert "G01" not in names_of(doc, "Satellite") and len(doc["objects"]) == len(before["objects"]) - 1
    assert "*/Satellite/G01" not in obj_in(doc, "Constellation", "GPS")["assigned_objects"]
    assert next(g for g in doc["groups"] if g["name"] == "GPS sats")["members"] == [
        m for m in next(g for g in before["groups"] if g["name"] == "GPS sats")["members"] if m != "*/Satellite/G01"]
    assert doc["accesses"][1]["to"] == ["*/Satellite/G22"] and doc["accesses"][0] == before["accesses"][0]
    assert "Satellite/G01" not in str(doc["groups"]) + str(doc["accesses"]) + str(doc["objects"])
    assert_error(client.get("/api/scenarios/S1/objects/Satellite/G01"), 404, "NOT_FOUND")
    assert len(doc["groups"]) == 4                                                                         # กลุ่มไม่ถูกลบแม้ว่าง


def test_delete_access_left_without_targets_is_removed(client, s1):
    put_doc(client, lambda d: d["accesses"].append({**copy.deepcopy(EXTRA_ACCESS), "to": ["*/Satellite/G01"]}))
    assert_saved(delete(client, "Satellite/G01"), client)
    doc = doc_of(client)
    assert len(doc["accesses"]) == 1 and doc["accesses"][0]["to"][0] == "*/Constellation/GPS"


def test_delete_facility_removes_its_accesses(client, s1):
    insert(client, {"class": "Facility", "method": "Insert Default"})
    put_doc(client, lambda d: d["accesses"].append({**copy.deepcopy(EXTRA_ACCESS), "from": "*/Facility/Facility1"}))
    j = assert_saved(delete(client, "Facility/THBK"), client)
    assert j["results_stale"] is True                                              # ชุด access ที่ต้องใช้เปลี่ยน
    doc = doc_of(client)
    assert names_of(doc, "Facility") == ["Facility1"]
    assert [a["from"] for a in doc["accesses"]] == ["*/Facility/Facility1"] and doc["accesses"][0]["to"] == EXTRA_ACCESS["to"]


def test_delete_constellation_keeps_its_satellites(client, s1):
    before = doc_of(client)
    members = obj_in(before, "Constellation", "GPS")["assigned_objects"]
    j = assert_saved(delete(client, "Constellation/GPS"), client); assert j["results_stale"] is False
    doc = doc_of(client)
    assert "GPS" not in names_of(doc, "Constellation") and names_of(doc, "Satellite") == names_of(before, "Satellite")
    assert doc["accesses"][0]["to"] == ["*/Constellation/GLONASS", "*/Constellation/Galileo", "*/Constellation/BeiDou"]
    assert next(g for g in doc["groups"] if g["name"] == "GPS sats")["members"] == members                 # ดาวยังอยู่ในกลุ่ม


def test_delete_only_constellation_target_removes_access(client, s1):
    for name in ("GPS", "GLONASS", "Galileo", "BeiDou"):
        assert_saved(delete(client, f"Constellation/{name}"), client)
    assert doc_of(client)["accesses"] == []


def test_delete_requires_if_match_and_existing_object(client, s1, data_dir):
    before = file_bytes(data_dir)
    assert_error(delete(client, "Satellite/G01", etag=None), 412, "ETAG_MISMATCH")
    assert_error(delete(client, "Satellite/G01", etag="0123456789abcdef"), 412, "ETAG_MISMATCH")
    assert file_bytes(data_dir) == before
    assert_error(delete(client, "Satellite/G99"), 404, "NOT_FOUND")
    assert_error(delete(client, "Satellite/g01"), 404, "NOT_FOUND")
    assert_error(delete(client, "Group/GPS%20sats"), 404, "NOT_FOUND")
    assert file_bytes(data_dir) == before


def test_insert_and_delete_in_empty_scenario_are_never_stale(client, s_empty):
    insert(client, {"class": "Constellation", "method": "Insert Default"})
    r = delete(client, "Constellation/Constellation1")
    assert_saved(r, client); assert r.json()["results_stale"] is False
    assert doc_of(client)["objects"] == []


# ---------- Groups ----------

def _folders(client):
    return {f["group"]: [n["path"] for n in f["children"]] for f in tree_of(client)["children"] if "group" in f}


def test_group_create_moves_satellite_out_of_other_group(client, s1):
    gps_before = _folders(client)["GPS sats"]
    r = group(client, "Mine", ["*/Satellite/G01", "*/Satellite/E11"])
    j = assert_saved(r, client); assert j["results_stale"] is False and set(j) == {"etag", "results_stale"}
    folders = _folders(client)
    assert folders["Mine"] == ["*/Satellite/G01", "*/Satellite/E11"]
    assert folders["GPS sats"] == [m for m in gps_before if m != "*/Satellite/G01"]
    assert "*/Satellite/E11" not in folders["Galileo sats"]
    assert list(folders)[-1] == "Mine"                                                                     # กลุ่มใหม่ต่อท้าย
    doc = doc_of(client)
    assert [g["name"] for g in doc["groups"]] == ["GPS sats", "GLONASS sats", "Galileo sats", "BeiDou sats", "Mine"]
    assert sum("*/Satellite/G01" in g["members"] for g in doc["groups"]) == 1


def test_group_set_members_replaces_and_ungroups_the_rest(client, s1):
    gps = _folders(client)["GPS sats"]
    keep = gps[:1]
    assert_saved(group(client, "GPS sats", keep), client)
    folders = _folders(client)
    assert folders["GPS sats"] == keep and list(folders)[:1] == ["GPS sats"]
    tree = tree_of(client)["children"]
    ungrouped = [n["path"] for n in tree if "group" not in n and n["class"] == "Satellite"]
    assert ungrouped == gps[1:] == ["*/Satellite/G22"]                                                                           # หลุดกลุ่มแล้วขึ้นรากต่อจากโฟลเดอร์
    assert len(obj_in(doc_of(client), "Constellation", "GPS")["assigned_objects"]) == len(gps) == 2        # Constellation ไม่เกี่ยว
    assert len(doc_of(client)["groups"]) == 4


def test_group_name_matches_existing_case_insensitively(client, s1):
    assert_saved(group(client, "gps SATS", ["*/Satellite/G01"]), client)
    doc = doc_of(client)
    assert [g["name"] for g in doc["groups"]][:1] == ["GPS sats"] and len(doc["groups"]) == 4
    assert next(g for g in doc["groups"] if g["name"] == "GPS sats")["members"] == ["*/Satellite/G01"]


def test_group_new_empty_and_dedup(client, s1):
    assert_saved(group(client, "ดาวของฉัน", []), client)
    assert _folders(client)["ดาวของฉัน"] == []
    assert_saved(group(client, "ดาวของฉัน", ["*/Satellite/G01", "*/Satellite/G01"]), client)
    assert _folders(client)["ดาวของฉัน"] == ["*/Satellite/G01"]


def test_group_requires_members(client, s1, data_dir):
    """ไม่ส่ง members ต้องไม่ล้างสมาชิกของกลุ่มเดิม (กลุ่มว่างต้องส่ง [] เอง)"""
    before = file_bytes(data_dir)
    for body in ({"name": "GPS sats"}, {"name": "NoMembers"}, {"name": "GPS sats", "members": None}):
        r = client.post("/api/scenarios/S1/groups", json=body, headers=_headers(client, CURRENT))
        assert_error(r, 422, "SCENARIO_INVALID", "members")
    assert file_bytes(data_dir) == before


def test_group_members_must_be_existing_satellites(client, s1, data_dir):
    before = file_bytes(data_dir)
    for members in (["*/Satellite/NOPE"], ["*/Facility/THBK"], ["*/Constellation/GPS"], ["G01"], ["*/Satellite/G01", "*/Satellite/NOPE"],
                    [5], "*/Satellite/G01"):
        assert_error(group(client, "Mine", members), 422, "SCENARIO_INVALID", "members")
    assert file_bytes(data_dir) == before


@pytest.mark.parametrize("name", ["", "   ", None, 5])
def test_group_name_must_not_be_blank(client, s1, data_dir, name):
    before = file_bytes(data_dir)
    r = client.post("/api/scenarios/S1/groups", json={"name": name, "members": []}, headers=_headers(client, CURRENT))
    assert_error(r, 422, "SCENARIO_INVALID", "name")
    assert file_bytes(data_dir) == before


def test_group_requires_if_match(client, s1, data_dir):
    before = file_bytes(data_dir)
    assert_error(group(client, "Mine", [], etag=None), 412, "ETAG_MISMATCH")
    assert_error(group(client, "Mine", [], etag="0123456789abcdef"), 412, "ETAG_MISMATCH")
    assert file_bytes(data_dir) == before
    assert_error(client.post("/api/scenarios/nope/groups", json={"name": "x", "members": []}, headers={"If-Match": "x"}), 404, "NOT_FOUND")


def test_deleting_a_group_member_object_keeps_group(client, s1):
    group(client, "Mine", ["*/Satellite/G01"])
    assert_saved(delete(client, "Satellite/G01"), client)
    assert _folders(client)["Mine"] == []


# ---------- ความปลอดภัยของชื่อ ----------

def test_unsafe_scenario_names_rejected_by_object_routes(client, s1, data_dir):          # Review Focus 1
    outside = data_dir.parent
    before_outside, before_scenarios = sorted(os.listdir(outside)), sorted(os.listdir(data_dir / "scenarios"))
    bad_names = ["..", "a..b%2F..", "..%2Fvictim", "%2e%2e%2Fvictim", "x" * 33, "ทดสอบ", "a b", "S1%00", "S1/../victim"]
    hdr = {"If-Match": "x"}
    for bad in bad_names:
        base = f"/api/scenarios/{bad}"
        calls = [("get", f"{base}/objects", {}), ("get", f"{base}/objects/Satellite/G01", {}),
                 ("post", f"{base}/objects", {"json": {"class": "Facility", "method": "Insert Default"}, "headers": hdr}),
                 ("patch", f"{base}/objects/Satellite/G01", {"json": {"graphics2d": {"show": False}}, "headers": hdr}),
                 ("post", f"{base}/objects/Satellite/G01/rename", {"json": {"new_name": "X"}, "headers": hdr}),
                 ("delete", f"{base}/objects/Satellite/G01", {"headers": hdr}),
                 ("post", f"{base}/groups", {"json": {"name": "g", "members": []}, "headers": hdr})]
        for method, url, kw in calls:
            r = getattr(client, method)(url, **kw)
            assert r.status_code in (404, 405, 422), (method, url, r.status_code)
            if r.status_code in (404, 422):
                assert set(r.json()) == ERROR_KEYS
    assert sorted(os.listdir(outside)) == before_outside and sorted(os.listdir(data_dir / "scenarios")) == before_scenarios


# ---------- ภาพรวม ----------

def test_edits_keep_unknown_fields_and_scenario_valid(client, s1, data_dir):
    """การแก้ผ่าน API ไม่ทำให้ช่องที่ไม่รู้จักหาย และไฟล์ที่ได้ engine อ่านได้เสมอ"""
    def mark(d):
        d["x_custom"] = {"a": 1}
        obj_in(d, "Satellite", "G01")["x_svn"] = "G080"
        obj_in(d, "Satellite", "G01")["graphics2d"]["x_halo"] = True
    put_doc(client, mark)
    assert_saved(patch(client, "Satellite/G01", {"graphics2d": {"color": "#00ff00"}}), client)
    assert_saved(rename(client, "Satellite/G01", "GPS01"), client)
    assert_saved(group(client, "Mine", ["*/Satellite/GPS01"]), client)
    doc = doc_of(client)
    sat = obj_in(doc, "Satellite", "GPS01")
    assert doc["x_custom"] == {"a": 1} and sat["x_svn"] == "G080" and sat["graphics2d"]["x_halo"] is True
    sc = load_scenario(data_dir / "scenarios" / SC / "scenario.json")
    assert ("GPS01", 62339) in sc.satellites
