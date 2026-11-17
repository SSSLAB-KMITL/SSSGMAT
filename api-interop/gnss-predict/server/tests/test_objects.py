"""object แบบ STK (หัวข้อ 6.4 ของ spec server): Object Browser, Insert STK Objects, Properties Browser, rename/delete, groups

fixture `s1` (thbk-gnss) และ `s_empty` (empty) อยู่ใน conftest.py ทั้งคู่สร้าง scenario ชื่อ S1
"""

import copy
import os
import re
import shutil
from datetime import datetime, timezone

import pytest

from conftest import SNAPSHOT_SRC
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
    assert p["basic"] == {"description": "", "long_description": "", "norad": 62339}
    assert p["graphics3d"] == {"show": True, "orbit_system": "Fixed by Window"} and p["constraints"] == {}
    assert p["graphics2d"]["color"] == "#ffd23f" and p["graphics2d"]["swath"]["elevation_deg"] == 10.0


def test_get_pages_facility_and_constellation(client, s1):
    fac = pages(client, "Facility/THBK")
    assert fac["basic"] == {"description": "", "long_description": "", "position": {"type": "Geodetic", "lat_deg": 13.729779, "lon_deg": 100.781151, "alt_m": 6.4}}
    assert fac["constraints"] == {"elevation_angle_min_deg": 10.0}
    assert fac["graphics2d"] == {"show": True, "color": "#ff79e6", "marker_style": "Triangle", "inherit": True}
    assert fac["graphics3d"] == {"show": True}
    con = pages(client, "Constellation/GPS")
    members = obj_in(doc_of(client), "Constellation", "GPS")["assigned_objects"]
    assert con["basic"] == {"description": "", "long_description": "", "system": "G", "color": "#ffd23f", "assigned_objects": members} and members
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
    assert pages(client, "Satellite/G01")["basic"] == {"description": "same norad", "long_description": "", "norad": 62339}


@pytest.mark.parametrize("obj", ["Satellite/G01", "Facility/THBK", "Constellation/GPS"])
def test_patch_long_description_is_a_basic_page_field(client, s1, obj):
    assert pages(client, obj)["basic"]["long_description"] == ""                    # ค่าตั้งต้นของทุก class
    r = patch(client, obj, {"basic": {"long_description": "คำอธิบายยาว\nบรรทัดสอง"}})
    assert_saved(r, client); assert r.json()["results_stale"] is False
    assert pages(client, obj)["basic"]["long_description"] == "คำอธิบายยาว\nบรรทัดสอง"
    cls, name = obj.split("/")
    assert obj_in(doc_of(client), cls, name)["long_description"] == "คำอธิบายยาว\nบรรทัดสอง"


def test_insert_define_properties_accepts_long_description(client, s1):
    r = insert(client, {"class": "Facility", "method": "Define Properties", "name": "LONGD", "long_description": "ยาว",
                        "position": {"lat_deg": 1.0, "lon_deg": 2.0, "alt_m": 3.0}})
    assert_saved(r, client, 201)
    assert pages(client, "Facility/LONGD")["basic"]["long_description"] == "ยาว"


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


# ---------- Sensor: object ลูกของดาว ----------

SENSOR_DEFINE = {"class": "Sensor", "method": "Define Properties"}
SENSOR_DEFAULT = {"class": "Sensor", "method": "Insert Default"}
G01 = "*/Satellite/G01"


def _add_sensor(client, name="S1", parent=G01, **extra):
    r = insert(client, {**SENSOR_DEFINE, "name": name, "parent": parent, **extra})
    assert_saved(r, client, 201)
    return r


def test_insert_sensor_define_properties_defaults(client, s1):
    r = insert(client, {**SENSOR_DEFINE, "name": "S1", "parent": G01})
    assert r.json()["created"] == ["*/Sensor/S1"]
    j = assert_saved(r, client, 201)
    sensor = obj_in(doc_of(client), "Sensor", "S1")
    assert sensor == templates.sensor("S1", G01) and "method" not in sensor
    assert sensor["definition"] == {"type": "Simple Conic", "cone_half_angle": 45.0}
    assert sensor["pointing"] == {"type": "Fixed", "orientation": "Az-El", "azimuth": 0.0, "elevation": 90.0, "about_boresight": "Rotate"}
    assert sensor["graphics2d"] == {"show": True, "color": "#e8c547", "fill": False, "fill_translucency": 50}
    assert sensor["graphics3d"] == {"show": True, "color": "#e8c547", "show_radial_lines": True, "show_boresight_marker": False}
    assert j["results_stale"] is False and set(j) == {"etag", "results_stale", "created"}


def test_insert_sensor_define_properties_merges_given_fields_with_defaults(client, s1):
    _add_sensor(client, "S2", description="กล้อง", definition={"cone_half_angle": 20}, pointing={"azimuth": 90, "elevation": 30},
                graphics2d={"color": "#112233", "fill": True}, graphics3d={"show_boresight_marker": True})
    sensor = obj_in(doc_of(client), "Sensor", "S2")
    expected = templates.sensor("S2", G01)
    expected["description"] = "กล้อง"
    expected["definition"]["cone_half_angle"] = 20
    expected["pointing"].update({"azimuth": 90, "elevation": 30})
    expected["graphics2d"].update({"color": "#112233", "fill": True})
    expected["graphics3d"]["show_boresight_marker"] = True
    assert sensor == expected


def test_templates_sensor_cone_half_angle_argument():
    assert templates.sensor("S1", G01, 10.0)["definition"]["cone_half_angle"] == 10.0
    assert templates.sensor("S1", G01)["definition"] == {"type": "Simple Conic", "cone_half_angle": 45.0}


def test_insert_sensor_insert_default_names_sensor1_then_sensor2(client, s1):
    r = insert(client, {**SENSOR_DEFAULT, "parent": G01})
    assert r.json()["created"] == ["*/Sensor/Sensor1"]
    assert_saved(r, client, 201)
    assert obj_in(doc_of(client), "Sensor", "Sensor1") == templates.sensor("Sensor1", G01)
    assert insert(client, {**SENSOR_DEFAULT, "parent": "*/Satellite/G22"}).json()["created"] == ["*/Sensor/Sensor2"]
    assert obj_in(doc_of(client), "Sensor", "Sensor2")["parent"] == "*/Satellite/G22"
    assert_saved(delete(client, "Sensor/Sensor1"), client)
    assert insert(client, {**SENSOR_DEFAULT, "parent": G01}).json()["created"] == ["*/Sensor/Sensor1"]      # ชื่อว่างตัวแรก
    put_doc(client, lambda d: obj_in(d, "Sensor", "Sensor2").update({"name": "SENSOR2"}))
    assert insert(client, {**SENSOR_DEFAULT, "parent": G01}).json()["created"] == ["*/Sensor/Sensor3"]      # ไม่สนตัวพิมพ์


@pytest.mark.parametrize("method", ["Define Properties", "Insert Default"])
@pytest.mark.parametrize("parent", [None, "*/Facility/THBK", "*/Constellation/GPS", "*/Satellite/NOPE", "G01", 5, ["*/Satellite/G01"]])
def test_insert_sensor_requires_existing_satellite_parent(client, s1, data_dir, method, parent):
    body = {"class": "Sensor", "method": method}
    if method == "Define Properties":
        body["name"] = "S1"
    if parent is not None:
        body["parent"] = parent
    before = file_bytes(data_dir)
    assert_error(insert(client, body), 422, "SCENARIO_INVALID", "parent")
    assert file_bytes(data_dir) == before


def test_insert_sensor_define_properties_requires_name(client, s1, data_dir):
    before = file_bytes(data_dir)
    assert_error(insert(client, {**SENSOR_DEFINE, "parent": G01}), 422, "SCENARIO_INVALID", "name")
    assert_error(insert(client, {**SENSOR_DEFINE, "name": "a b", "parent": G01}), 422, "SCENARIO_INVALID", "name")
    assert file_bytes(data_dir) == before


def test_insert_sensor_insert_default_accepts_only_parent(client, s1, data_dir):
    before = file_bytes(data_dir)
    assert_error(insert(client, {**SENSOR_DEFAULT, "parent": G01, "name": "Mine"}), 422, "SCENARIO_INVALID", "name")
    assert_error(insert(client, {**SENSOR_DEFAULT, "parent": G01, "definition": {}}), 422, "SCENARIO_INVALID", "definition")
    assert file_bytes(data_dir) == before


@pytest.mark.parametrize("body", [
    {"class": "Facility", "method": "Insert Default", "parent": G01},
    {"class": "Constellation", "method": "Insert Default", "parent": G01},
    {"class": "Satellite", "method": "Define Properties", "name": "A", "norad": 5, "parent": G01},
    {"class": "Facility", "method": "Define Properties", "name": "A", "position": {"lat_deg": 0, "lon_deg": 0, "alt_m": 0}, "parent": G01},
])
def test_insert_other_class_does_not_accept_parent(client, s1, data_dir, body):
    before = file_bytes(data_dir)
    assert_error(insert(client, body), 422, "SCENARIO_INVALID", "parent")
    assert file_bytes(data_dir) == before


def test_insert_sensor_from_catalog_rejected(client, s1, data_dir):
    before = file_bytes(data_dir)
    assert_error(insert(client, {"class": "Sensor", "method": "From Satellite Catalog", "norads": [62339]}), 422, "SCENARIO_INVALID", "class")
    assert file_bytes(data_dir) == before


# ค่าที่ผิดของ Sensor: (ส่วนของ object, ช่อง, ค่า) ใน Define Properties ชื่อช่องคือ path ใน object ใน PATCH หน้า Basic ขึ้นต้นด้วย `basic.`
SENSOR_BAD_VALUES = [
    ("definition", "cone_half_angle", 0),
    ("definition", "cone_half_angle", 90.5),
    ("definition", "cone_half_angle", -1),
    ("definition", "cone_half_angle", "45"),
    ("definition", "cone_half_angle", True),
    ("definition", "type", "Custom"),
    ("definition", "vertical_half_angle", 0),
    ("definition", "horizontal_half_angle", 89.5),
    ("pointing", "azimuth", 360),
    ("pointing", "azimuth", -1),
    ("pointing", "elevation", 91),
    ("pointing", "elevation", -90.5),
    ("pointing", "type", "Targeted"),
    ("pointing", "orientation", "Euler Angles"),
    ("pointing", "about_boresight", "Hold"),
    ("graphics2d", "color", "red"),
    ("graphics2d", "fill_translucency", 101),
    ("graphics2d", "fill_translucency", -1),
    ("graphics2d", "fill_translucency", 50.5),
    ("graphics2d", "fill", "yes"),
    ("graphics3d", "color", "#12345"),
    ("graphics3d", "show_radial_lines", 1),
]


@pytest.mark.parametrize("section,key,value", SENSOR_BAD_VALUES)
def test_sensor_invalid_values_define_properties(client, s1, data_dir, section, key, value):
    before = file_bytes(data_dir)
    j = assert_error(insert(client, {**SENSOR_DEFINE, "name": "S1", "parent": G01, section: {key: value}}), 422, "SCENARIO_INVALID",
                     f"{section}.{key}")
    assert f"{section}.{key}" in j["text"] and file_bytes(data_dir) == before


@pytest.mark.parametrize("section,key,value", SENSOR_BAD_VALUES)
def test_sensor_invalid_values_patch(client, s1, data_dir, section, key, value):
    _add_sensor(client)
    before = file_bytes(data_dir)
    body, field = ({"basic": {section: {key: value}}}, f"basic.{section}.{key}") if section in ("definition", "pointing") else (
        {section: {key: value}}, f"{section}.{key}")
    j = assert_error(patch(client, "Sensor/S1", body), 422, "SCENARIO_INVALID", field)
    assert field in j["text"] and file_bytes(data_dir) == before


@pytest.mark.parametrize("section,key,value", [
    ("definition", "cone_half_angle", 90), ("definition", "cone_half_angle", 0.001), ("definition", "cone_half_angle", 13.9),
    ("pointing", "azimuth", 0), ("pointing", "azimuth", 359.99), ("pointing", "elevation", -90), ("pointing", "elevation", 90),
    ("graphics2d", "fill_translucency", 0), ("graphics2d", "fill_translucency", 100), ("graphics3d", "color", "#AbCdEf"),
])
def test_sensor_boundary_values_accepted(client, s1, section, key, value):
    r = insert(client, {**SENSOR_DEFINE, "name": "S1", "parent": G01, section: {key: value}})
    assert_saved(r, client, 201)
    assert obj_in(doc_of(client), "Sensor", "S1")[section][key] == value


def test_patch_sensor_pages(client, s1):
    _add_sensor(client)
    p = pages(client, "Sensor/S1")
    assert set(p) == {"basic", "graphics2d", "graphics3d", "constraints"} and p["constraints"] == {}
    assert p["basic"] == {"description": "", "long_description": "", "parent": G01,
                          "definition": {"type": "Simple Conic", "cone_half_angle": 45.0},
                          "pointing": {"type": "Fixed", "orientation": "Az-El", "azimuth": 0.0, "elevation": 90.0, "about_boresight": "Rotate"}}
    assert p["graphics2d"] == {"show": True, "color": "#e8c547", "fill": False, "fill_translucency": 50}
    assert p["graphics3d"] == {"show": True, "color": "#e8c547", "show_radial_lines": True, "show_boresight_marker": False}
    assert_saved(patch(client, "Sensor/S1", {"basic": {"definition": {"cone_half_angle": 13.9}}}), client)
    assert pages(client, "Sensor/S1")["basic"]["definition"] == {"type": "Simple Conic", "cone_half_angle": 13.9}   # ผสมทีละชั้น type ยังอยู่
    assert_saved(patch(client, "Sensor/S1", {"basic": {"pointing": {"azimuth": 120, "elevation": 20}, "description": "ตัวทดสอบ"},
                                              "graphics2d": {"fill": True, "fill_translucency": 80}, "graphics3d": {"show": False}}), client)
    after = pages(client, "Sensor/S1")
    assert after["basic"]["pointing"] == {"type": "Fixed", "orientation": "Az-El", "azimuth": 120, "elevation": 20, "about_boresight": "Rotate"}
    assert after["basic"]["description"] == "ตัวทดสอบ" and after["basic"]["parent"] == G01
    assert after["graphics2d"] == {"show": True, "color": "#e8c547", "fill": True, "fill_translucency": 80}
    assert after["graphics3d"]["show"] is False and after["graphics3d"]["show_radial_lines"] is True


def test_patch_sensor_parent_is_read_only(client, s1, data_dir):
    _add_sensor(client)
    before = file_bytes(data_dir)
    for parent in ("*/Satellite/G22", "*/Satellite/NOPE", "*/Facility/THBK", None, 5):
        assert_error(patch(client, "Sensor/S1", {"basic": {"parent": parent}}), 422, "SCENARIO_INVALID", "basic.parent")
    assert file_bytes(data_dir) == before
    r = patch(client, "Sensor/S1", {"basic": {"parent": G01, "description": "same parent"}})                   # ส่งค่าเดิมกลับมาได้
    assert_saved(r, client); assert r.json()["results_stale"] is False
    assert pages(client, "Sensor/S1")["basic"]["parent"] == G01 and pages(client, "Sensor/S1")["basic"]["description"] == "same parent"


def test_patch_sensor_rejects_keys_outside_the_page_and_constraints(client, s1, data_dir):
    _add_sensor(client)
    before = file_bytes(data_dir)
    for key in ("name", "class", "norad", "position", "graphics2d"):
        assert_error(patch(client, "Sensor/S1", {"basic": {key: "X"}}), 422, "SCENARIO_INVALID", f"basic.{key}")
    assert_error(patch(client, "Sensor/S1", {"constraints": {"elevation_angle_min_deg": 5}}), 422, "SCENARIO_INVALID", "constraints")
    assert file_bytes(data_dir) == before


def test_sensor_basic_keys_do_not_leak_into_other_classes(client, s1, data_dir):
    before = file_bytes(data_dir)
    for obj in ("Satellite/G01", "Facility/THBK", "Constellation/GPS"):
        for key in ("parent", "definition", "pointing"):
            assert_error(patch(client, obj, {"basic": {key: {}}}), 422, "SCENARIO_INVALID", f"basic.{key}")
    assert file_bytes(data_dir) == before


def test_tree_nests_sensors_under_satellite(client, s1):
    _add_sensor(client, "S1", G01)
    _add_sensor(client, "S2", "*/Satellite/G22")
    _add_sensor(client, "S3", G01)
    kids = tree_of(client)["children"]
    nodes = {n["name"]: n for f in kids if "group" in f for n in f["children"]}
    assert nodes["G01"]["children"] == [
        {"path": "*/Sensor/S1", "class": "Sensor", "name": "S1", "color": "#e8c547", "show": True},
        {"path": "*/Sensor/S3", "class": "Sensor", "name": "S3", "color": "#e8c547", "show": True}]
    assert nodes["G22"]["children"] == [{"path": "*/Sensor/S2", "class": "Sensor", "name": "S2", "color": "#e8c547", "show": True}]
    assert all("children" not in n for name, n in nodes.items() if name not in ("G01", "G22"))
    assert not [k for k in kids if k.get("class") == "Sensor"]                                                    # sensor ไม่อยู่ที่ราก
    assert "children" not in kids[0] and kids[0]["path"] == "*/Facility/THBK"                                      # Facility ไม่มี children


def test_tree_sensor_node_color_and_show_follow_graphics2d(client, s1):
    _add_sensor(client, "S1", G01)
    assert_saved(patch(client, "Sensor/S1", {"graphics2d": {"color": "#010203", "show": False}, "graphics3d": {"color": "#aabbcc", "show": True}}), client)
    nodes = {n["name"]: n for f in tree_of(client)["children"] if "group" in f for n in f["children"]}
    assert nodes["G01"]["children"] == [{"path": "*/Sensor/S1", "class": "Sensor", "name": "S1", "color": "#010203", "show": False}]


def test_tree_sensors_follow_an_ungrouped_satellite(client, s1):
    put_doc(client, lambda d: [g.update({"members": [m for m in g["members"] if m != G01]}) for g in d["groups"]])
    _add_sensor(client, "S1", G01)
    kids = tree_of(client)["children"]
    ungrouped = [k for k in kids if k.get("class") == "Satellite"]
    assert [k["path"] for k in ungrouped][:1] == [G01] and [c["name"] for c in ungrouped[0]["children"]] == ["S1"]
    assert not [k for k in kids if k.get("class") == "Sensor"]


def test_tree_ignores_sensor_whose_parent_is_missing(s1):
    """ไฟล์ที่แก้มือนอก API จนมี sensor กำพร้า: ต้นไม้ไม่พัง และไม่แสดง sensor นั้น"""
    doc, _ = s1
    doc["objects"].append(templates.sensor("Orphan", "*/Satellite/NOPE"))
    kids = objects.tree(doc)["children"]
    assert not [k for k in kids if k.get("class") == "Sensor"]
    assert all("children" not in n for f in kids if "group" in f for n in f["children"])


def test_sensor_name_collides_with_satellite(client, s1, data_dir):
    before = file_bytes(data_dir)
    j = assert_error(insert(client, {**SENSOR_DEFINE, "name": "G22", "parent": G01}), 409, "NAME_EXISTS", "name")
    assert j["detail"] == "G22"
    assert_error(insert(client, {**SENSOR_DEFINE, "name": "g22", "parent": G01}), 409, "NAME_EXISTS", "name")     # ไม่แยกตัวพิมพ์เล็กใหญ่
    assert_error(insert(client, {**SENSOR_DEFINE, "name": "THBK", "parent": G01}), 409, "NAME_EXISTS", "name")
    assert file_bytes(data_dir) == before
    _add_sensor(client, "S1")
    assert_error(insert(client, {**SENSOR_DEFINE, "name": "s1", "parent": "*/Satellite/G22"}), 409, "NAME_EXISTS", "name")
    assert_error(insert(client, {"class": "Satellite", "method": "Define Properties", "name": "s1", "norad": 5}), 409, "NAME_EXISTS", "name")
    assert_error(rename(client, "Sensor/S1", "G22"), 409, "NAME_EXISTS", "new_name")
    assert_error(rename(client, "Satellite/G22", "S1"), 409, "NAME_EXISTS", "new_name")


def test_rename_sensor_keeps_parent(client, s1):
    _add_sensor(client)
    assert_saved(rename(client, "Sensor/S1", "Cam"), client)
    sensor = obj_in(doc_of(client), "Sensor", "Cam")
    assert sensor["parent"] == G01 and "S1" not in names_of(doc_of(client), "Sensor")
    assert pages(client, "Sensor/Cam")["basic"]["parent"] == G01


def test_rename_satellite_updates_sensor_parent(client, s1):
    _add_sensor(client, "S1", G01)
    _add_sensor(client, "S2", "*/Satellite/G22")
    _add_sensor(client, "S3", G01)
    r = rename(client, "Satellite/G01", "GPS01")
    j = assert_saved(r, client); assert set(j) == {"etag", "results_stale"}
    doc = doc_of(client)
    assert obj_in(doc, "Sensor", "S1")["parent"] == "*/Satellite/GPS01" and obj_in(doc, "Sensor", "S3")["parent"] == "*/Satellite/GPS01"
    assert obj_in(doc, "Sensor", "S2")["parent"] == "*/Satellite/G22"                                            # ของดาวอื่นไม่เปลี่ยน
    nodes = {n["name"]: n for f in tree_of(client)["children"] if "group" in f for n in f["children"]}
    assert [c["name"] for c in nodes["GPS01"]["children"]] == ["S1", "S3"]
    assert pages(client, "Sensor/S1")["basic"]["parent"] == "*/Satellite/GPS01"


def test_rename_satellite_updates_sensor_parent_for_case_only_change(client, s1):
    _add_sensor(client, "S1", G01)
    assert_saved(rename(client, "Satellite/G01", "g01"), client)
    assert obj_in(doc_of(client), "Sensor", "S1")["parent"] == "*/Satellite/g01"


def test_delete_satellite_deletes_its_sensors(client, s1):
    _add_sensor(client, "S1", G01)
    _add_sensor(client, "S2", "*/Satellite/G22")
    _add_sensor(client, "S3", G01)
    before = doc_of(client)
    assert_saved(delete(client, "Satellite/G01"), client)
    doc = doc_of(client)
    assert names_of(doc, "Sensor") == ["S2"] and "G01" not in names_of(doc, "Satellite")
    assert len(doc["objects"]) == len(before["objects"]) - 3
    assert obj_in(doc, "Sensor", "S2") == obj_in(before, "Sensor", "S2")
    assert "Satellite/G01" not in str(doc["objects"]) + str(doc["groups"]) + str(doc["accesses"])
    assert_error(client.get("/api/scenarios/S1/objects/Sensor/S1"), 404, "NOT_FOUND")
    assert_error(client.get("/api/scenarios/S1/objects/Sensor/S3"), 404, "NOT_FOUND")


def test_delete_sensor_directly(client, s1):
    _add_sensor(client, "S1", G01)
    _add_sensor(client, "S2", G01)
    before = doc_of(client)
    assert_saved(delete(client, "Sensor/S1"), client)
    doc = doc_of(client)
    assert names_of(doc, "Sensor") == ["S2"] and "G01" in names_of(doc, "Satellite")
    assert len(doc["objects"]) == len(before["objects"]) - 1
    assert_error(delete(client, "Sensor/S1"), 404, "NOT_FOUND")
    assert_error(delete(client, "Sensor/s2"), 404, "NOT_FOUND")


def test_delete_other_class_keeps_sensors(client, s1):
    _add_sensor(client, "S1", G01)
    assert_saved(delete(client, "Constellation/GPS"), client)
    assert_saved(delete(client, "Facility/THBK"), client)
    assert names_of(doc_of(client), "Sensor") == ["S1"]


def test_sensor_edits_do_not_make_results_stale(client, s1_computed):
    r = insert(client, {**SENSOR_DEFINE, "name": "S1", "parent": G01})
    assert_saved(r, client, 201); assert r.json()["results_stale"] is False
    r = insert(client, {**SENSOR_DEFAULT, "parent": "*/Satellite/G22"})
    assert_saved(r, client, 201); assert r.json()["results_stale"] is False
    r = patch(client, "Sensor/S1", {"basic": {"definition": {"cone_half_angle": 10}}, "graphics2d": {"color": "#00ff00"}})
    assert_saved(r, client); assert r.json()["results_stale"] is False
    r = rename(client, "Sensor/S1", "Cam")
    assert_saved(r, client); assert r.json()["results_stale"] is False
    r = delete(client, "Sensor/Cam")
    assert_saved(r, client); assert r.json()["results_stale"] is False
    r = delete(client, "Sensor/Sensor1")
    assert_saved(r, client); assert r.json()["results_stale"] is False


def test_sensor_is_ignored_by_the_engine(client, s1_computed, data_dir):
    """engine ข้าม class Sensor: ไฟล์ที่มี sensor โหลดได้ และ hash ของ ephem กับ access ไม่เปลี่ยน"""
    from gnss_predict.studio import plan_analyze, plan_propagate
    scenario_dir = data_dir / "scenarios" / SC
    ephem, access = plan_propagate(scenario_dir, data_dir).hash, plan_analyze(scenario_dir, "THBK", data_dir)
    assert (ephem, access) == (s1_computed["ephem_hash"], s1_computed["access_hash"])
    _add_sensor(client, "S1", G01)
    assert_saved(patch(client, "Sensor/S1", {"basic": {"pointing": {"azimuth": 10}}}), client)
    assert (plan_propagate(scenario_dir, data_dir).hash, plan_analyze(scenario_dir, "THBK", data_dir)) == (ephem, access)
    sc = load_scenario(scenario_dir / "scenario.json")
    assert ("G01", 62339) in sc.satellites and all(f.name != "S1" for f in sc.facilities)


def test_sensor_edits_require_if_match(client, s1, data_dir):
    _add_sensor(client)
    before = file_bytes(data_dir)
    assert_error(insert(client, {**SENSOR_DEFAULT, "parent": G01}, etag=None), 412, "ETAG_MISMATCH")
    assert_error(patch(client, "Sensor/S1", {"graphics2d": {"show": False}}, etag="0123456789abcdef"), 412, "ETAG_MISMATCH")
    assert_error(delete(client, "Sensor/S1", etag=None), 412, "ETAG_MISMATCH")
    assert file_bytes(data_dir) == before


def test_sensor_edits_keep_unknown_fields(client, s1):
    _add_sensor(client)
    def mark(d):
        obj_in(d, "Sensor", "S1")["x_note"] = "keep"
        obj_in(d, "Sensor", "S1")["pointing"]["x_axes"] = "body"
    put_doc(client, mark)
    assert_saved(patch(client, "Sensor/S1", {"basic": {"pointing": {"azimuth": 5}}, "graphics3d": {"show": False}}), client)
    assert_saved(rename(client, "Satellite/G01", "GPS01"), client)
    sensor = obj_in(doc_of(client), "Sensor", "S1")
    assert sensor["x_note"] == "keep" and sensor["pointing"]["x_axes"] == "body" and sensor["parent"] == "*/Satellite/GPS01"


# ---------- Sensor แบบ Rectangular (Ruling g, v) ----------

RECTANGULAR_MODIS = {"type": "Rectangular", "vertical_half_angle": 55.0, "horizontal_half_angle": 0.41}


def test_insert_rectangular_sensor_define_properties_has_no_cone_half_angle(client, s1):
    _add_sensor(client, "Cam", definition=RECTANGULAR_MODIS)
    sensor = obj_in(doc_of(client), "Sensor", "Cam")
    assert sensor["definition"] == RECTANGULAR_MODIS                     # แม่แบบมี cone_half_angle 45 แต่ Rectangular ไม่เก็บ
    assert pages(client, "Sensor/Cam")["basic"]["definition"] == RECTANGULAR_MODIS


def test_patch_simple_conic_to_rectangular_drops_cone_half_angle(client, s1, data_dir):
    _add_sensor(client)
    before = file_bytes(data_dir)
    assert_error(patch(client, "Sensor/S1", {"basic": {"definition": {"type": "Rectangular"}}}), 422, "SCENARIO_INVALID",
                 "basic.definition")                                    # ต้องมีทั้งสองครึ่งมุม
    assert_error(patch(client, "Sensor/S1", {"basic": {"definition": {**RECTANGULAR_MODIS, "vertical_half_angle": 89.5}}}),
                 422, "SCENARIO_INVALID", "basic.definition.vertical_half_angle")
    assert file_bytes(data_dir) == before
    assert_saved(patch(client, "Sensor/S1", {"basic": {"definition": RECTANGULAR_MODIS}}), client)
    assert obj_in(doc_of(client), "Sensor", "S1")["definition"] == RECTANGULAR_MODIS
    assert_saved(patch(client, "Sensor/S1", {"basic": {"definition": {"horizontal_half_angle": 0.5}}}), client)
    assert obj_in(doc_of(client), "Sensor", "S1")["definition"] == {**RECTANGULAR_MODIS, "horizontal_half_angle": 0.5}
    assert_saved(patch(client, "Sensor/S1", {"basic": {"definition": {"type": "Simple Conic", "cone_half_angle": 20}}}), client)
    assert obj_in(doc_of(client), "Sensor", "S1")["definition"]["cone_half_angle"] == 20


def test_templates_imaging_sensor():
    definition = {"type": "Simple Conic", "cone_half_angle": 8.7}
    sensor = templates.imaging_sensor("AHI", "*/Satellite/X01", definition)
    assert sensor == {**templates.sensor("AHI", "*/Satellite/X01"), "definition": definition}
    assert sensor["definition"] is not definition                       # สำเนา แก้แล้วไม่กระทบ preset


# ---------- Insert ดาวถ่ายภาพพร้อม primary sensor (Ruling l, m) ----------

TERRA, AQUA, HIMAWARI, G01_NORAD = 25994, 27424, 41836, 62339
POINTING_NADIR = {"type": "Fixed", "orientation": "Az-El", "azimuth": 0.0, "elevation": 90.0, "about_boresight": "Rotate"}


@pytest.fixture
def imaging_snapshot(snapshot):
    """snapshot ของ fixture พร้อมไฟล์กลุ่มดาวถ่ายภาพทั้งสาม (OMM ปลอมเขียนมือ)"""
    for path in sorted((SNAPSHOT_SRC.parent / "imaging").glob("*.json")):
        shutil.copyfile(path, snapshot / path.name)
    return snapshot


def test_imaging_sensor_presets(client, s_empty, imaging_snapshot):
    r = insert(client, {**CATALOG_INSERT, "norads": [TERRA], "primary_sensors": True})
    assert r.json()["created"] == ["*/Satellite/X04", "*/Sensor/MODIS"]
    assert_saved(r, client, 201)
    doc = doc_of(client)
    modis = obj_in(doc, "Sensor", "MODIS")
    assert modis["definition"] == {"type": "Rectangular", "vertical_half_angle": 55.0, "horizontal_half_angle": 0.41}
    assert modis["parent"] == "*/Satellite/X04" and modis["pointing"] == POINTING_NADIR
    assert modis == templates.imaging_sensor("MODIS", "*/Satellite/X04", modis["definition"])
    r = insert(client, {**CATALOG_INSERT, "norads": [HIMAWARI], "primary_sensors": True})
    assert r.json()["created"] == ["*/Satellite/X01", "*/Sensor/AHI"]
    ahi = obj_in(doc_of(client), "Sensor", "AHI")
    assert ahi["definition"] == {"type": "Simple Conic", "cone_half_angle": 8.7}
    assert ahi["parent"] == "*/Satellite/X01" and ahi["pointing"] == POINTING_NADIR
    assert [n["name"] for n in next(c for c in tree_of(client)["children"] if c["name"] == "X04")["children"]] == ["MODIS"]


def test_catalog_insert_primary_sensors_names_and_order(client, s_empty, imaging_snapshot):
    r = insert(client, {**CATALOG_INSERT, "norads": [TERRA, AQUA, G01_NORAD], "create_constellation": "EO", "primary_sensors": True})
    assert r.json()["created"] == ["*/Satellite/X04", "*/Satellite/X05", "*/Satellite/G01", "*/Constellation/EO",
                                   "*/Sensor/MODIS", "*/Sensor/MODIS_X05"]
    assert_saved(r, client, 201)
    doc = doc_of(client)
    assert [o["name"] for o in doc["objects"]] == ["X04", "X05", "G01", "EO", "MODIS", "MODIS_X05"]
    assert obj_in(doc, "Constellation", "EO")["assigned_objects"] == ["*/Satellite/X04", "*/Satellite/X05", "*/Satellite/G01"]
    assert obj_in(doc, "Sensor", "MODIS")["parent"] == "*/Satellite/X04"
    assert obj_in(doc, "Sensor", "MODIS_X05")["parent"] == "*/Satellite/X05"
    assert obj_in(doc, "Sensor", "MODIS_X05")["definition"] == RECTANGULAR_MODIS
    assert [o["parent"] for o in doc["objects"] if o["class"] == "Sensor"] == ["*/Satellite/X04", "*/Satellite/X05"]   # G01 ไม่มี sensor


def test_primary_sensor_name_taken_case_insensitively_uses_prn(client, s_empty, imaging_snapshot):
    assert_saved(insert(client, {"class": "Facility", "method": "Define Properties", "name": "modis",
                                 "position": {"lat_deg": 0, "lon_deg": 0, "alt_m": 0}}), client, 201)
    r = insert(client, {**CATALOG_INSERT, "norads": [TERRA], "primary_sensors": True})
    assert r.json()["created"] == ["*/Satellite/X04", "*/Sensor/MODIS_X04"]


def test_primary_sensor_name_clash_creates_nothing(client, s_empty, imaging_snapshot, data_dir):
    assert_saved(insert(client, {**CATALOG_INSERT, "norads": [G01_NORAD]}), client, 201)
    for name in ("MODIS", "MODIS_X04"):
        assert_saved(insert(client, {**SENSOR_DEFINE, "name": name, "parent": "*/Satellite/G01"}), client, 201)
    before_doc, before = doc_of(client), file_bytes(data_dir)
    j = assert_error(insert(client, {**CATALOG_INSERT, "norads": [TERRA, AQUA], "create_constellation": "EO", "primary_sensors": True}),
                     409, "NAME_EXISTS", "primary_sensors")
    assert j["detail"] == "MODIS_X04"
    assert doc_of(client)["objects"] == before_doc["objects"] and file_bytes(data_dir) == before


def test_primary_sensors_default_false(client, s_empty, imaging_snapshot, data_dir):
    r = insert(client, {**CATALOG_INSERT, "norads": [TERRA, HIMAWARI]})
    assert r.json()["created"] == ["*/Satellite/X04", "*/Satellite/X01"]
    assert names_of(doc_of(client), "Sensor") == []
    before = file_bytes(data_dir)
    for bad in ("yes", 1, 0, None, [True]):
        assert_error(insert(client, {**CATALOG_INSERT, "norads": [AQUA], "primary_sensors": bad}), 422, "SCENARIO_INVALID", "primary_sensors")
    assert file_bytes(data_dir) == before
    r = insert(client, {**CATALOG_INSERT, "norads": [AQUA], "primary_sensors": False})
    assert r.json()["created"] == ["*/Satellite/X05"] and names_of(doc_of(client), "Sensor") == []


def test_primary_sensors_only_with_from_satellite_catalog(client, s1, data_dir):
    before = file_bytes(data_dir)
    assert_error(insert(client, {"class": "Satellite", "method": "Define Properties", "name": "A", "norad": 5, "primary_sensors": True}),
                 422, "SCENARIO_INVALID", "primary_sensors")
    assert_error(insert(client, {**SENSOR_DEFAULT, "parent": G01, "primary_sensors": True}), 422, "SCENARIO_INVALID", "primary_sensors")
    assert file_bytes(data_dir) == before


def test_primary_sensors_for_gnss_only_creates_no_sensor(client, s_empty, imaging_snapshot):
    r = insert(client, {**CATALOG_INSERT, "norads": [G01_NORAD], "primary_sensors": True})
    assert r.json()["created"] == ["*/Satellite/G01"]
