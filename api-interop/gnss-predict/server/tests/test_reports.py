"""Data provider, ข้อมูล และ style ของรายงาน (หัวข้อ 6.7 ของ spec server): `/dataproviders`, `/data`, `/styles`, `/reports`, cache ของตาราง

route แค่เรียก engine (`gnss_predict.dataproviders`, `report_style`) ค่าที่คาดอ่านจาก engine โดยตรงบน bundle เดียวกับที่ fixture
`s1_computed` เขียน (GMAT ปลอม ไม่ใช้เน็ต) scenario S1 ของแม่แบบ thbk-gnss: 6 ชั่วโมง step 30 วินาที Facility THBK และดาว G01 มี access 1 ช่วง
"""

import json
import re
import time
from datetime import datetime, timezone
from urllib.parse import quote

import pytest

from gnss_predict import report_style, studio
from gnss_predict.dataproviders import TableCache, open_result_set, provider_rows
from gnss_predict.errors import StyleError
from gnss_predict.report_format import ExportSetup, format_csv, format_txt, report_json, time_unit
from gnss_predict.report_style import build_report, installed_styles, resolve_style
from gnss_studio_server import plans as plans_module
from gnss_studio_server.errors import ApiError
from gnss_studio_server.plans import PlanCache
from gnss_studio_server.routes.reports import PinnedTables, server_result_set
from gnss_studio_server.styles import MyStyles

SC = "S1"
BASE = f"/api/scenarios/{SC}"
OBJ = "*/Facility/THBK */Satellite/G01"
FAC = "*/Facility/THBK"
SAT = "*/Satellite/G01"
ERROR_KEYS = {"code", "text", "field", "detail"}
THAI = re.compile("[฀-๿]")
AER = ["Time", "Azimuth", "Elevation", "Range"]


# ---------- helpers ----------

def assert_error(r, status, code, field=None):
    assert r.status_code == status, r.text
    j = r.json()
    assert set(j) == ERROR_KEYS and j["code"] == code and j["field"] == field, j
    assert THAI.search(j["text"])
    return j


def iso(t: datetime) -> str:
    t = t.astimezone(timezone.utc)
    return f"{t:%Y-%m-%dT%H:%M:%S}.{t.microsecond // 1000:03d}Z"


def utc(text: str) -> datetime:
    return datetime.fromisoformat(text.replace("Z", "+00:00"))


def data(client, obj=OBJ, provider="AER Data", elements=tuple(AER), **extra):
    params = [("object", obj), ("provider", provider), *[("elements", e) for e in elements]]
    params += list(extra.items())
    return client.get(f"{BASE}/data", params=params)


def providers(client, cls, name=None):
    params = {"class": cls} if name is None else {"class": cls, "name": name}
    return client.get(f"{BASE}/dataproviders", params=params)


def scenario_dir(data_dir):
    return data_dir / "scenarios" / SC


def engine_rows(data_dir, obj, provider, group, elements, start=None, stop=None, step=None):
    """provider_rows ของ engine บน open_result_set ของ scenario S1 (ช่วงตั้งต้น = ช่วงวิเคราะห์) แปลงเวลาเป็น ISO ms Z"""
    rs = open_result_set(scenario_dir(data_dir), data_dir)
    rows = provider_rows(rs, obj, provider, group, list(elements), start or rs.scenario.start, stop or rs.scenario.stop, step)
    return [[iso(row[e]) if isinstance(row[e], datetime) else row[e] for e in elements] for row in rows]


def etag_of(client):
    return client.get(BASE).headers["ETag"]


def make_stale(client):
    """แก้มุมเงยต่ำสุดของ THBK: ephem ยัง current แต่ access ของ THBK stale"""
    r = client.patch(f"{BASE}/objects/Facility/THBK", json={"constraints": {"elevation_angle_min_deg": 15}},
                     headers={"If-Match": etag_of(client)})
    assert r.status_code == 200 and r.json()["results_stale"] is True, r.text


def put_doc(client, mutate):
    r = client.get(BASE)
    doc = r.json()
    mutate(doc)
    ok = client.put(BASE, json=doc, headers={"If-Match": r.headers["ETag"]})
    assert ok.status_code == 200, ok.text


def style(name="Mine", **over):
    """style ที่ผ่าน check_style (AER ของ Access: เวลา มุมทั้งสอง)"""
    return {"name": name, "kind": "report", "object_type": "Access",
            "content": [{"provider": "AER Data", "group": "Default", "elements": ["Time", "Azimuth", "Elevation"]}],
            **over}


def put_style(client, name, body=None, **kw):
    return client.put(f"/api/styles/{quote(name, safe='')}", json=style(name) if body is None else body, **kw)


def post_style(client, name, body=None, **kw):
    return client.post(f"/api/styles/{quote(name, safe='')}", json=style(name) if body is None else body, **kw)


def style_files(data_dir):
    folder = data_dir / "styles"
    return sorted(p.name for p in folder.iterdir()) if folder.exists() else []


def server_log(data_dir):
    path = data_dir / "logs" / "server.log"
    return path.read_text(encoding="utf-8") if path.exists() else ""


# ---------- /dataproviders ----------

def test_dataproviders_by_class(client, s1):
    r = providers(client, "Facility", "THBK")
    assert r.status_code == 200, r.text
    assert [p["name"] for p in r.json()] == ["Dilution of Precision", "N Asset Coverage"]

    r = providers(client, "Access", OBJ)
    assert [p["name"] for p in r.json()] == ["Access Data", "AER Data", "IPP Data"]
    by_name = {p["name"]: p for p in r.json()}
    assert by_name["IPP Data"]["ours"] is True and by_name["AER Data"]["ours"] is False

    assert providers(client, "Constellation").json() == []
    assert providers(client, "Constellation", "GPS").json() == []
    assert_error(providers(client, "Facility", "NOPE"), 422, "SCENARIO_INVALID", "name")


def test_dataprovider_shape(client, s1):
    aer = next(p for p in providers(client, "Access", OBJ).json() if p["name"] == "AER Data")
    assert set(aer) == {"name", "groups", "elements", "uses", "ours"}
    assert aer["groups"] == ["Default"] and aer["uses"] == ["Reports", "Dynamic Displays"]
    assert aer["elements"] == [
        {"name": "Time", "unit": None, "kind": "time", "interp": "linear"},
        {"name": "Azimuth", "unit": "deg", "kind": "number", "interp": "angle"},
        {"name": "Elevation", "unit": "deg", "kind": "number", "interp": "linear"},
        {"name": "Range", "unit": "km", "kind": "number", "interp": "linear"},
    ]
    access_data = next(p for p in providers(client, "Access", OBJ).json() if p["name"] == "Access Data")
    assert access_data["groups"] is None and access_data["uses"] == ["Reports"]
    dop = providers(client, "Facility", "THBK").json()[0]
    assert dop["groups"] == ["All Systems", "GPS", "GLONASS", "Galileo", "BeiDou"]


def test_dataproviders_name_rules(client, s1):
    assert [p["name"] for p in providers(client, "Satellite", "G01").json()] == ["LLA State"]
    assert [p["name"] for p in providers(client, "Satellite", "g01").json()] == ["LLA State"]       # ชื่อ object ไม่แยกตัวพิมพ์
    assert [p["name"] for p in providers(client, "Facility", FAC).json()] == ["Dilution of Precision", "N Asset Coverage"]
    assert [p["name"] for p in providers(client, "Satellite").json()] == ["LLA State"]              # ไม่ระบุ name: รายการของชนิดนั้น
    for cls, name in (("Satellite", "NOPE"), ("Access", "*/Facility/THBK */Satellite/NOPE"), ("Access", "*/Facility/NOPE */Satellite/G01"),
                      ("Access", FAC), ("Facility", SAT), ("Facility", "A B"), ("Facility", "../x")):
        assert_error(providers(client, cls, name), 422, "SCENARIO_INVALID", "name")
    assert [p["name"] for p in providers(client, "Satellite", "").json()] == ["LLA State"]           # name ว่าง = ไม่ระบุ


def test_dataproviders_missing_class_and_scenario(client, s1):
    assert_error(client.get(f"{BASE}/dataproviders"), 422, "SCENARIO_INVALID", "class")
    assert_error(client.get("/api/scenarios/NOPE/dataproviders", params={"class": "Facility"}), 404, "NOT_FOUND")
    assert providers(client, "Bogus").json() == []


# ---------- /data ----------

def test_data_matches_engine(client, s1_computed, data_dir):
    r = data(client)
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == {"columns", "rows"}
    assert body["columns"] == [{"name": "Time", "unit": None, "kind": "time"}, {"name": "Azimuth", "unit": "deg", "kind": "number"},
                               {"name": "Elevation", "unit": "deg", "kind": "number"}, {"name": "Range", "unit": "km", "kind": "number"}]
    expected = engine_rows(data_dir, OBJ, "AER Data", None, AER)
    assert len(expected) > 100 and body["rows"] == expected
    assert re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z", body["rows"][0][0])

    r = data(client, step="45")
    assert_error(r, 422, "SCENARIO_INVALID", "time.step")


def test_data_window_and_step(client, s1_computed, data_dir):
    start, stop = "2026-11-10T03:00:00Z", "2026-11-10T03:10:00Z"
    r = data(client, start=start, stop=stop, step="60")
    assert r.status_code == 200, r.text
    expected = engine_rows(data_dir, OBJ, "AER Data", None, AER, utc(start), utc(stop), 60)
    assert r.json()["rows"] == expected and len(expected) == 11
    assert all(utc(start) <= utc(row[0]) <= utc(stop) for row in r.json()["rows"])
    # หน้าต่างอยู่นอกช่วงวิเคราะห์ทั้งหมด: แถวว่าง ไม่ใช่ error
    r = data(client, start="2026-11-12T00:00:00Z", stop="2026-11-12T01:00:00Z")
    assert r.status_code == 200 and r.json()["rows"] == [] and len(r.json()["columns"]) == 4


@pytest.mark.parametrize("obj, provider, group, elements", [
    (OBJ, "Access Data", None, ["Access Number", "Start Time", "Stop Time", "Duration"]),
    (OBJ, "IPP Data", None, ["Time", "IPP Lat", "IPP Lon", "MF", "Elevation"]),
    (SAT, "LLA State", None, ["Time", "Lat", "Lon", "Alt", "Lat Rate", "Lon Rate", "Alt Rate"]),
    (SAT, "LLA State", "Fixed", ["Time", "Lat", "Lon"]),
    (FAC, "Dilution of Precision", "GPS", ["Time", "GDOP", "N Visible"]),
    (FAC, "N Asset Coverage", None, ["Time", "Total", "GPS"]),
])
def test_data_every_provider_matches_engine(client, s1_computed, data_dir, obj, provider, group, elements):
    extra = {} if group is None else {"group": group}
    r = data(client, obj, provider, elements, **extra)
    assert r.status_code == 200, r.text
    expected = engine_rows(data_dir, obj, provider, group, elements)
    assert expected and r.json()["rows"] == expected
    assert [c["name"] for c in r.json()["columns"]] == elements


def test_data_blank_group_is_none(client, s1_computed, data_dir):
    # provider ที่ไม่มี group: group ว่างต้องเป็น None ไม่ใช่สตริงว่างที่ engine ปฏิเสธ
    access = ["Access Number", "Start Time", "Stop Time", "Duration"]
    assert data(client, OBJ, "Access Data", access, group="").json() == data(client, OBJ, "Access Data", access).json()
    # provider ที่มี group: None = group แรก
    dop = ["Time", "GDOP", "N Visible"]
    blank = data(client, FAC, "Dilution of Precision", dop, group="")
    assert blank.status_code == 200 and blank.json() == data(client, FAC, "Dilution of Precision", dop, group="All Systems").json()
    assert data(client, OBJ, "AER Data", group="").json() == data(client, OBJ, "AER Data").json()


@pytest.mark.parametrize("params, status, code, field", [
    ({"provider": "Bogus"}, 422, "STYLE_INVALID", "provider"),
    ({"elements": ["Time", "Bogus"]}, 422, "STYLE_INVALID", "elements[1]"),
    ({"elements": [""]}, 422, "STYLE_INVALID", "elements[0]"),
    ({"group": "Nope"}, 422, "STYLE_INVALID", "group"),
    ({"obj": "*/Facility/NOPE */Satellite/G01"}, 422, "SCENARIO_INVALID", "object"),
    ({"obj": FAC}, 422, "SCENARIO_INVALID", "object"),                                    # ชนิด object ไม่ตรง provider
    ({"obj": "THBK"}, 422, "SCENARIO_INVALID", "object"),
    ({"start": "2026-11-10T03:00:00Z", "stop": "2026-11-10T03:00:00Z"}, 422, "SCENARIO_INVALID", "time.start"),
    ({"start": "2026-11-10T04:00:00Z", "stop": "2026-11-10T03:00:00Z"}, 422, "SCENARIO_INVALID", "time.start"),
    ({"start": "2026-11-10T03:00:00Z"}, 422, "SCENARIO_INVALID", "time.stop"),
    ({"stop": "2026-11-10T03:00:00Z"}, 422, "SCENARIO_INVALID", "time.start"),
    ({"start": "yesterday", "stop": "2026-11-10T03:00:00Z"}, 422, "SCENARIO_INVALID", "time.start"),
    ({"start": "2026-11-10T03:00:00Z", "stop": "2026-11-10T03:00:00+07:00"}, 422, "SCENARIO_INVALID", "time.stop"),
    ({"step": "abc"}, 422, "SCENARIO_INVALID", "time.step"),
    ({"step": "1.5"}, 422, "SCENARIO_INVALID", "time.step"),
    ({"step": "0"}, 422, "SCENARIO_INVALID", "time.step"),
    ({"step": "-30"}, 422, "SCENARIO_INVALID", "time.step"),
    ({"step": "45"}, 422, "SCENARIO_INVALID", "time.step"),
])
def test_data_errors(client, s1_computed, params, status, code, field):
    params = dict(params)
    kw = {"obj": params.pop("obj", OBJ), "provider": params.pop("provider", "AER Data"),
          "elements": params.pop("elements", AER)}
    assert_error(data(client, kw["obj"], kw["provider"], kw["elements"], **params), status, code, field)


def test_data_missing_params_and_scenario(client, s1_computed):
    assert_error(client.get(f"{BASE}/data", params={"provider": "AER Data", "elements": "Time"}), 422, "SCENARIO_INVALID", "object")
    assert_error(client.get(f"{BASE}/data", params={"object": OBJ, "elements": "Time"}), 422, "SCENARIO_INVALID", "provider")
    assert_error(client.get(f"{BASE}/data", params={"object": OBJ, "provider": "AER Data"}), 422, "SCENARIO_INVALID", "elements")
    assert_error(client.get("/api/scenarios/NOPE/data", params={"object": OBJ, "provider": "AER Data", "elements": "Time"}),
                 404, "NOT_FOUND")


def test_data_on_stale_results_is_409(client, s1_computed):
    assert data(client).status_code == 200
    make_stale(client)
    assert_error(data(client), 409, "RESULTS_NOT_CURRENT")
    assert_error(data(client, FAC, "Dilution of Precision", ["Time", "GDOP"]), 409, "RESULTS_NOT_CURRENT")


def test_data_before_any_compute_is_409(client, s1):
    assert_error(data(client), 409, "RESULTS_NOT_CURRENT")
    assert_error(data(client, SAT, "LLA State", ["Time", "Lat"]), 409, "RESULTS_NOT_CURRENT")
    # คำขอที่ผิดรูปยังได้ 422 ก่อน (ตรวจชื่อก่อนดูผลลัพธ์)
    assert_error(data(client, provider="Bogus"), 422, "STYLE_INVALID", "provider")


def test_data_stale_edit_reaches_new_results_after_compute(client, s1_computed, data_dir):
    """แก้ scenario แล้ว plan เปลี่ยน: /data ต้องไม่ใช้ plan ที่แคชไว้ของ scenario รุ่นก่อน"""
    make_stale(client)
    assert data(client).status_code == 409
    studio.run_analyze(scenario_dir(data_dir), "THBK", data_dir)
    r = data(client)
    assert r.status_code == 200 and r.json()["rows"] == engine_rows(data_dir, OBJ, "AER Data", None, AER)


# ---------- cache ของตาราง และ plan ----------

def test_tables_cached_per_bundle(client, s1_computed):
    tables = client.app.state.tables
    assert isinstance(tables, TableCache) and tables.max_bundles == 4       # ตัดสินใจ: LRU 4 bundle (ราว 135 MB ต่อ bundle)
    assert tables.loads == 0
    assert data(client).status_code == 200
    first = tables.loads
    assert first > 0
    assert data(client).status_code == 200
    assert data(client, step="60").status_code == 200
    assert data(client, OBJ, "IPP Data", ["Time", "IPP Lat"]).status_code == 200      # provider อื่นจาก bundle เดียวกันใช้ตารางที่อ่านแล้ว
    assert tables.loads == first


def test_plan_hash_is_cached_across_requests(client, s1_computed, monkeypatch):
    """open_result_set คำนวณ hash ใหม่ทุกครั้ง (0.42-0.45 วินาทีกับข้อมูลจริง): route ต้องใช้ PlanCache ไม่เรียกมัน"""
    calls = {"engine": 0, "plans": 0}

    def count(key, real):
        def spy(*args, **kw):
            calls[key] += 1
            return real(*args, **kw)
        return spy

    monkeypatch.setattr(studio, "plan_propagate", count("engine", studio.plan_propagate))
    monkeypatch.setattr(studio, "plan_analyze", count("engine", studio.plan_analyze))
    monkeypatch.setattr(plans_module, "plan_propagate", count("plans", plans_module.plan_propagate))
    monkeypatch.setattr(plans_module, "plan_analyze", count("plans", plans_module.plan_analyze))
    assert data(client).status_code == 200
    warm = dict(calls)
    assert warm["plans"] == 2                              # propagate หนึ่งครั้งกับ analyze ของ THBK หนึ่งครั้ง (ขณะ cache ว่าง)
    for _ in range(3):
        assert data(client).status_code == 200
        assert data(client, FAC, "Dilution of Precision", ["Time", "GDOP"]).status_code == 200
    assert calls == warm                                   # ไม่คำนวณ hash เพิ่มเลย ทั้งของ PlanCache และของ open_result_set
    # แก้จนผลที่ต้องใช้เปลี่ยน: คำนวณ plan ใหม่หนึ่งรอบ แล้ว request ต่อ ๆ ไปใช้ของใหม่
    make_stale(client)
    edited = dict(calls)
    assert edited["plans"] > warm["plans"]
    assert data(client).status_code == 409 and data(client).status_code == 409
    assert calls == edited


def test_server_result_set_has_current_bundles_only(client, s1_computed, data_dir):
    app = client.app
    tables = TableCache()
    rs = server_result_set(app.state.store, app.state.plans, tables, SC)
    assert rs.ephem_dir == s1_computed["ephem_dir"] and rs.access_dirs == {"THBK": s1_computed["access_dir"]}
    assert rs.tables is tables and rs.scenario.name == "S1"
    make_stale(client)
    rs = server_result_set(app.state.store, app.state.plans, tables, SC)
    assert rs.ephem_dir == s1_computed["ephem_dir"] and rs.access_dirs == {}      # ephem ยัง current, access ของ THBK stale


def test_server_result_set_without_results(client, s1):
    app = client.app
    rs = server_result_set(app.state.store, app.state.plans, TableCache(), SC)
    assert rs.ephem_dir is None and rs.access_dirs == {}
    with pytest.raises(ApiError) as caught:
        server_result_set(app.state.store, app.state.plans, TableCache(), "NOPE")
    assert caught.value.status == 404


# ---------- /styles ----------

def test_styles_tiers(client, s1, data_dir):
    r = client.get("/api/styles", params={"object_type": "Access"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == {"installed", "my", "scenario"}
    assert [(s["name"], s["kind"]) for s in body["installed"]] == [
        ("Access", "report"), ("AccessSummary", "report"), ("AER", "report"), ("Gaps", "report"), ("IPP Data", "report"),
        ("Access", "graph"), ("AER", "graph"), ("Elevation Angle", "graph"), ("Az El Polar", "graph")]
    assert all(s["object_type"] == "Access" for s in body["installed"]) and len(body["installed"]) == 9
    assert body["my"] == [] and body["scenario"] == []

    mine = style("Mine")
    r = put_style(client, "Mine", mine)
    assert r.status_code == 200 and r.json() == mine, r.text
    assert (data_dir / "styles" / "Mine.json").is_file()
    assert json.loads((data_dir / "styles" / "Mine.json").read_text(encoding="utf-8")) == mine
    body = client.get("/api/styles", params={"object_type": "Access"}).json()
    assert body["my"] == [mine]
    assert client.get("/api/styles", params={"object_type": "Facility"}).json()["my"] == []        # กรองตามชนิด object

    r = client.delete("/api/styles/Mine")
    assert r.status_code == 204 and r.content == b""
    assert not (data_dir / "styles" / "Mine.json").exists()
    assert client.get("/api/styles", params={"object_type": "Access"}).json()["my"] == []

    sc_style = style("ScStyle")
    put_doc(client, lambda doc: doc.update(styles=[sc_style, style("FacStyle", object_type="Facility", content=[
        {"provider": "Dilution of Precision", "group": "GPS", "elements": ["Time", "GDOP"]}]), "junk"]))
    body = client.get("/api/styles", params={"scenario": SC, "object_type": "Access"}).json()
    assert [s["name"] for s in body["scenario"]] == ["ScStyle"]
    assert [s["name"] for s in client.get("/api/styles", params={"scenario": SC}).json()["scenario"]] == ["ScStyle", "FacStyle"]
    assert client.get("/api/styles", params={"object_type": "Access"}).json()["scenario"] == []     # ไม่ระบุ scenario = ว่าง
    assert client.get("/api/styles", params={"scenario": ""}).json()["scenario"] == []
    assert_error(client.get("/api/styles", params={"scenario": "NOPE"}), 404, "NOT_FOUND")


def test_styles_installed_counts_by_object_type(client):
    counts = {t: len(client.get("/api/styles", params={"object_type": t}).json()["installed"])
              for t in ("Access", "Facility", "Satellite")}
    assert counts == {"Access": 9, "Facility": 4, "Satellite": 1}
    everything = client.get("/api/styles").json()["installed"]
    assert everything == installed_styles()
    assert client.get("/api/styles", params={"object_type": ""}).json()["installed"] == everything
    assert client.get("/api/styles", params={"object_type": "Bogus"}).json() == {"installed": [], "my": [], "scenario": []}


def test_my_style_create_replace_delete(client, data_dir):
    first = style("Mine")
    r = post_style(client, "Mine", first)
    assert r.status_code == 201 and r.json() == first, r.text
    assert_error(post_style(client, "Mine", first), 409, "NAME_EXISTS", "name")
    assert_error(post_style(client, "mine", style("mine")), 409, "NAME_EXISTS", "name")      # ไม่แยกตัวพิมพ์ (macOS ไฟล์ชื่อเดียวกัน)
    assert_error(put_style(client, "mine", style("mine")), 409, "NAME_EXISTS", "name")
    assert style_files(data_dir) == ["Mine.json"]

    second = style("Mine", content=[{"provider": "AER Data", "group": "Default", "elements": ["Time", "Range"]}])
    r = put_style(client, "Mine", second)                      # PUT แทนของเดิม
    assert r.status_code == 200 and r.json() == second
    assert client.get("/api/styles").json()["my"] == [second]
    r = put_style(client, "Other One", style("Other One"))    # PUT สร้างใหม่ (ชื่อมีช่องว่างได้)
    assert r.status_code == 200
    assert [s["name"] for s in client.get("/api/styles").json()["my"]] == ["Mine", "Other One"]
    assert style_files(data_dir) == ["Mine.json", "Other One.json"]       # ไม่มีไฟล์ชั่วคราวค้าง

    assert client.delete("/api/styles/Other%20One").status_code == 204
    assert_error(client.delete("/api/styles/Other%20One"), 404, "NOT_FOUND")
    assert_error(client.delete("/api/styles/NoSuchStyle"), 404, "NOT_FOUND")
    assert_error(client.delete("/api/styles/Access"), 404, "NOT_FOUND")       # Installed ลบไม่ได้
    assert style_files(data_dir) == ["Mine.json"]


@pytest.mark.parametrize("name", ["../x", "a/b", "", " lead", "x" * 49, "-lead", "a.b", "a\\b", "a%b"])
def test_my_style_name_rules(client, data_dir, name):
    assert_error(put_style(client, name, style(name)), 422, "STYLE_INVALID", "name")
    assert_error(post_style(client, name, style(name)), 422, "STYLE_INVALID", "name")
    assert_error(client.delete(f"/api/styles/{quote(name, safe='')}"), 422, "STYLE_INVALID", "name")
    assert style_files(data_dir) == []
    assert not any(p.name.endswith(".json") for p in data_dir.parent.iterdir())            # ไม่เขียนออกนอก data/styles


def test_my_style_longest_name_is_accepted(client, data_dir):
    name = "A" + "b c-_" * 9 + "z" * 2                                    # 48 ตัว
    assert len(name) == 48
    assert put_style(client, name, style(name)).status_code == 200
    assert style_files(data_dir) == [f"{name}.json"]


@pytest.mark.parametrize("name", ["access", "Access", "AER", "ACCESSSUMMARY", "az el polar", "All DOPs"])
def test_my_style_cannot_reuse_installed_name(client, data_dir, name):
    assert_error(put_style(client, name, style(name)), 409, "NAME_EXISTS", "name")
    assert_error(post_style(client, name, style(name)), 409, "NAME_EXISTS", "name")
    assert style_files(data_dir) == []


def test_my_style_body_errors(client, data_dir):
    assert_error(put_style(client, "Mine", style("Other")), 422, "STYLE_INVALID", "name")              # name ≠ path
    assert_error(post_style(client, "Mine", style("Other")), 422, "STYLE_INVALID", "name")
    no_name = style("Mine")
    del no_name["name"]
    assert_error(put_style(client, "Mine", no_name), 422, "STYLE_INVALID", "name")
    bogus = style("Mine", content=[{"provider": "AER Data", "group": "Default", "elements": ["Bogus"]}])
    assert_error(put_style(client, "Mine", bogus), 422, "STYLE_INVALID", "content[0].elements[0]")
    bogus = style("Mine", content=[{"provider": "AER Data", "group": "Default", "elements": ["Time", "Range", "Nope"]}])
    assert_error(post_style(client, "Mine", bogus), 422, "STYLE_INVALID", "content[0].elements[2]")
    assert_error(put_style(client, "Mine", style("Mine", mystery=1)), 422, "STYLE_INVALID", "mystery")
    assert_error(put_style(client, "Mine", style("Mine", kind="chart")), 422, "STYLE_INVALID", "kind")
    assert_error(put_style(client, "Mine", style("Mine", dynamic="yes")), 422, "STYLE_INVALID", "dynamic")
    assert client.put("/api/styles/Mine", json=[1, 2]).status_code == 422
    assert client.put("/api/styles/Mine", content=b"{", headers={"content-type": "application/json"}).status_code == 422
    assert style_files(data_dir) == []


def test_my_style_failed_replace_keeps_the_old_file(client, data_dir):
    good = style("Mine")
    assert put_style(client, "Mine", good).status_code == 200
    bad = style("Mine", content=[{"provider": "AER Data", "group": "Default", "elements": ["Bogus"]}])
    assert_error(put_style(client, "Mine", bad), 422, "STYLE_INVALID", "content[0].elements[0]")
    assert json.loads((data_dir / "styles" / "Mine.json").read_text(encoding="utf-8")) == good
    assert style_files(data_dir) == ["Mine.json"]


def test_broken_style_file_is_skipped(client, data_dir):
    folder = data_dir / "styles"
    folder.mkdir()
    (folder / "Bad.json").write_text("{", encoding="utf-8")
    (folder / "Arr.json").write_text("[]", encoding="utf-8")
    (folder / "Bin.json").write_bytes(b"\xff\xfe\x00{")
    (folder / "NoName.json").write_text(json.dumps({"kind": "report"}), encoding="utf-8")
    (folder / "Other.json").write_text(json.dumps(style("Different")), encoding="utf-8")                  # ชื่อในไฟล์ไม่ตรงชื่อไฟล์
    (folder / "bad name!.json").write_text(json.dumps(style("bad name!")), encoding="utf-8")             # ชื่อไฟล์ผิดกฎ
    (folder / "notes.txt").write_text("not a style", encoding="utf-8")
    (folder / "Mine.json.tmp-1234abcd").write_text(json.dumps(style("Mine")), encoding="utf-8")         # ไฟล์ชั่วคราวที่ค้าง
    (folder / "Dir.json").mkdir()
    good = style("Good")
    (folder / "Good.json").write_text(json.dumps(good), encoding="utf-8")
    r = client.get("/api/styles")
    assert r.status_code == 200, r.text
    assert r.json()["my"] == [good]
    log = server_log(data_dir)
    for broken in ("Bad.json", "Arr.json", "Bin.json", "NoName.json", "Other.json", "bad name!.json"):
        assert broken in log, broken
    # ไฟล์เสียแทนที่ได้ด้วย PUT และสร้างซ้ำด้วย POST ไม่ได้ถ้ามีไฟล์ชื่อนั้นอยู่ (กันเขียนทับไฟล์ที่แก้มือ)
    assert_error(post_style(client, "Bad", style("Bad")), 409, "NAME_EXISTS", "name")
    assert put_style(client, "Bad", style("Bad")).status_code == 200
    assert [s["name"] for s in client.get("/api/styles").json()["my"]] == ["Bad", "Good"]


def test_hand_edited_style_with_bogus_element_is_still_listed(client, data_dir):
    """ไฟล์ที่เป็น JSON object ถูกรูปแต่อ้าง element ที่ไม่มี แสดงในรายการ: ข้อผิดพลาดขึ้นตอนสร้างรายงาน (P6) ไม่ใช่ซ่อนไป"""
    folder = data_dir / "styles"
    folder.mkdir()
    bogus = style("Hand", content=[{"provider": "AER Data", "group": "Default", "elements": ["Time", "Bogus"]}])
    (folder / "Hand.json").write_text(json.dumps(bogus), encoding="utf-8")
    assert client.get("/api/styles").json()["my"] == [bogus]


def test_style_write_needs_same_origin(client, data_dir):
    evil = {"Origin": "http://evil.example"}
    r = put_style(client, "Mine", headers=evil)
    assert r.status_code == 403 and r.json()["code"] == "FORBIDDEN_ORIGIN"
    assert post_style(client, "Mine", headers=evil).status_code == 403
    assert client.delete("/api/styles/Mine", headers=evil).status_code == 403
    assert style_files(data_dir) == []
    assert put_style(client, "Mine", headers={"Origin": "http://127.0.0.1:8000"}).status_code == 200


def test_styles_listing_is_read_only_from_any_origin(client, data_dir):
    assert client.get("/api/styles", headers={"Origin": "http://evil.example"}).status_code == 200


def test_style_list_is_sorted_and_survives_missing_dir(client, data_dir):
    assert client.get("/api/styles").json()["my"] == []
    assert not (data_dir / "styles").exists()                          # อ่านไม่สร้างโฟลเดอร์
    for name in ("b style", "A style", "c"):
        assert put_style(client, name, style(name)).status_code == 200
    assert [s["name"] for s in client.get("/api/styles").json()["my"]] == ["A style", "b style", "c"]


# ---------- MyStyles ----------

def test_my_styles_unit(data_dir):
    store = MyStyles(data_dir)
    assert store.list() == []
    store.save(style("One"))
    store.save(style("One", content=[{"provider": "AER Data", "group": "Default", "elements": ["Time"]}]))
    assert [s["content"][0]["elements"] for s in store.list()] == [["Time"]]
    assert style_files(data_dir) == ["One.json"]
    store.delete("One")
    assert store.list() == []
    with pytest.raises(FileNotFoundError):
        store.delete("One")
    for bad in ("../x", "a/b", "", " x", "x\n", "..", "a" * 49):                  # fullmatch: ท้ายบรรทัดใหม่ไม่ผ่าน
        with pytest.raises(StyleError) as caught:
            store.save(style(bad))
        assert caught.value.field == "name"
        with pytest.raises(StyleError):
            store.delete(bad)
    assert style_files(data_dir) == []


# ---------- POST /reports ----------

T0300, T0400 = "2026-11-10T03:00:00Z", "2026-11-10T04:00:00Z"


def report(client, objects=(OBJ,), style_name="Access", **extra):
    return client.post(f"{BASE}/reports", json={"style": style_name, "objects": list(objects), **extra})


def stored_intervals(s1_computed, prn):
    stored = json.loads((s1_computed["access_dir"] / "intervals.json").read_text(encoding="utf-8"))
    return stored["intervals"][prn]


def compute_access(client, to, time_period=None):
    """Compute THBK -> to (ผล analyze ของ THBK current อยู่แล้ว จึงตอบ 200 ทันทีไม่ส่ง job)"""
    body = {"from": FAC, "to": to, **({} if time_period is None else {"time_period": time_period})}
    r = client.post(f"{BASE}/access/compute", json=body, headers={"If-Match": etag_of(client)})
    assert r.status_code == 200, r.text


def engine_report(data_dir, style_name, objects, kind=None, start=None, stop=None, step=None, doc_styles=()):
    rs = open_result_set(scenario_dir(data_dir), data_dir)
    style_doc = resolve_style(style_name, kind, [], list(doc_styles))
    return build_report(rs, style_doc, list(objects), start, stop, step, datetime(2026, 11, 15, tzinfo=timezone.utc))


def test_report_json_matches_engine(client, s1_computed, data_dir):
    r = report(client)
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("application/json")
    body = r.json()
    assert set(body) == {"scenario", "style", "kind", "created_utc", "sections", "global_statistics", "graph", "dynamic"}
    assert (body["scenario"], body["style"], body["kind"], body["dynamic"]) == ("S1", "Access", "report", False)
    assert re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z", body["created_utc"])
    section = body["sections"][0]
    assert len(body["sections"]) == 1 and section["title"] == "THBK-To-G01" and section["object"] == OBJ
    assert [c["name"] for c in section["columns"]] == ["Access", "Start Time", "Stop Time", "Duration"]
    stored = stored_intervals(s1_computed, "G01")
    assert stored and section["rows"] == [[i, iv["start"], iv["stop"], iv["duration_s"]] for i, iv in enumerate(stored, 1)]
    expected = report_json(engine_report(data_dir, "Access", [OBJ]))
    assert body["sections"] == expected["sections"] and body["global_statistics"] == expected["global_statistics"]


def test_report_txt_csv_files(client, s1_computed, data_dir):
    engine = engine_report(data_dir, "Access", [OBJ])
    r = report(client, format="txt")
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "text/plain; charset=utf-8"
    assert r.headers["content-disposition"] == 'attachment; filename="THBK-To-G01_Access.txt"'
    assert "THBK-To-G01:  Access" in r.text and "Start Time (UTCG)" in r.text
    assert r.text.split("\n", 1)[1] == format_txt(engine, "UTCG", "+07:00").split("\n", 1)[1]        # บรรทัดแรกคือเวลาสร้าง

    r = report(client, format="csv")
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "text/csv; charset=utf-8"
    assert r.headers["content-disposition"] == 'attachment; filename="THBK-To-G01_Access.csv"'
    assert r.text.splitlines()[0] == "Access,Start Time (UTCG),Stop Time (UTCG),Duration (sec)"
    assert r.text == format_csv(engine, "UTCG", "+07:00")

    quoted = {"delimiter": ";", "quote_headers": True, "title": False, "headers": True}
    r = report(client, format="csv", export=quoted)
    assert r.text.splitlines()[0] == '"Access";"Start Time (UTCG)";"Stop Time (UTCG)";"Duration (sec)"'
    assert r.text == format_csv(engine, "UTCG", "+07:00", ExportSetup(";", True, False, True))

    titled = {"delimiter": "\t", "quote_headers": False, "title": True, "headers": False}
    r = report(client, format="csv", export=titled)
    assert r.text.splitlines()[0] == "THBK-To-G01:  Access" and "Start Time" not in r.text
    assert r.text == format_csv(engine, "UTCG", "+07:00", ExportSetup("\t", False, True, False))

    assert report(client, format="csv", export={"delimiter": ";"}).text.splitlines()[0].startswith("Access;Start Time")   # ช่องที่ไม่ส่ง = ค่าตั้งต้น
    assert report(client, format="json", export=quoted).headers["content-type"].startswith("application/json")      # export ใช้กับ csv เท่านั้น


def test_report_file_names(client, s1_computed):
    two = [OBJ, "*/Facility/THBK */Satellite/E11"]
    r = report(client, two, format="txt")
    assert r.headers["content-disposition"] == 'attachment; filename="Access.txt"'
    assert "Global Statistics" in r.text and "THBK-To-E11:  Access" in r.text
    assert report(client, ["*/Facility/THBK */Satellite/G01"], "AER", format="csv").headers["content-disposition"] == \
        'attachment; filename="THBK-To-G01_AER.csv"'
    assert report(client, ["*/Facility/THBK */Satellite/G01"], "Az El Polar", format="txt").headers["content-disposition"] == \
        'attachment; filename="THBK-To-G01_Az_El_Polar.txt"'                                           # ช่องว่างในชื่อ style เป็น _


def test_report_multiple_objects_has_global_statistics(client, s1_computed, data_dir):
    objects = [OBJ, "*/Facility/THBK */Satellite/E11"]
    body = report(client, objects).json()
    expected = report_json(engine_report(data_dir, "Access", objects))
    assert [s["title"] for s in body["sections"]] == ["THBK-To-G01", "THBK-To-E11"]
    assert body["global_statistics"] and body["global_statistics"] == expected["global_statistics"]
    assert body["sections"] == expected["sections"]
    assert report(client).json()["global_statistics"] == []                                        # หนึ่ง object ไม่มี


@pytest.mark.parametrize("period, rows", [
    ({"mode": "specify", "start": "2026-11-10T01:00:00Z", "stop": "2026-11-10T02:00:00Z"}, []),       # ช่วงก่อน access ของ G01
    ({"mode": "specify", "start": T0300, "stop": T0400}, [[1, "2026-11-10T03:00:00.000Z", "2026-11-10T04:00:00.000Z", 3600.0]]),
])
def test_report_uses_stored_time_period(client, s1_computed, period, rows):
    full = report(client).json()["sections"][0]["rows"]
    assert full == [[1, "2026-11-10T02:38:19.004Z", "2026-11-10T06:00:00.000Z", 12100.996]]       # ยังไม่เก็บช่วง: ช่วงวิเคราะห์เต็ม
    compute_access(client, [SAT], period)
    body = report(client).json()
    assert body["sections"][0]["rows"] == rows
    lo, hi = utc(period["start"]), utc(period["stop"])
    assert all(lo <= utc(row[1]) and utc(row[2]) <= hi for row in body["sections"][0]["rows"])
    aer = report(client, style_name="AER").json()["sections"][0]["rows"]                          # รายงานอื่นของ access เดียวกันตัดเหมือนกัน
    assert all(lo <= utc(row[0]) <= hi for row in aer) and bool(aer) == bool(rows)
    gaps = report(client, style_name="Gaps").json()["sections"][0]["rows"]                        # Gaps คิดในช่วงเดียวกัน (ส่วนเติมเต็ม)
    assert gaps == ([] if rows else [[1, "2026-11-10T01:00:00.000Z", "2026-11-10T02:00:00.000Z", 3600.0]])


def test_report_stored_time_period_applies_only_to_the_matching_access(client, s1_computed):
    compute_access(client, [SAT], {"mode": "specify", "start": T0300, "stop": T0400})
    other = report(client, ["*/Facility/THBK */Satellite/E11"]).json()["sections"][0]["rows"]
    assert other == [[1, "2026-11-10T03:17:40.700Z", "2026-11-10T06:00:00.000Z", 9739.3]]           # ไม่ใช่ access นั้น: ช่วงวิเคราะห์เต็ม
    assert report(client, [FAC], "All DOPs").status_code == 200                                    # ชนิดอื่นไม่ใช้ time_period ของ access
    compute_access(client, [SAT], {"mode": "object"})                                              # แก้กลับเป็น object: เต็มช่วง
    assert report(client).json()["sections"][0]["rows"][0][1] == "2026-11-10T02:38:19.004Z"


def test_report_request_time_overrides_stored_time_period(client, s1_computed, data_dir):
    compute_access(client, [SAT], {"mode": "specify", "start": T0300, "stop": T0400})
    window = {"mode": "specify", "start": "2026-11-10T02:00:00Z", "stop": "2026-11-10T05:00:00Z"}
    rows = report(client, time=window).json()["sections"][0]["rows"]
    assert rows == [[1, "2026-11-10T02:38:19.004Z", "2026-11-10T05:00:00.000Z", 8500.996]]
    start, stop = datetime(2026, 11, 10, 2, tzinfo=timezone.utc), datetime(2026, 11, 10, 5, tzinfo=timezone.utc)
    assert rows == report_json(engine_report(data_dir, "Access", [OBJ], start=start, stop=stop))["sections"][0]["rows"]
    # mode object ไม่ใช้ start/stop (เหมือน time_period ของ access) จึงไม่ตรวจและไม่ตัด
    ignored = report(client, time={"mode": "object", "start": "2026-11-10T01:00:00Z", "stop": "2026-11-10T02:00:00Z"})
    assert ignored.json()["sections"][0]["rows"][0][2] == "2026-11-10T04:00:00.000Z"                # ใช้ time_period ที่เก็บ


def test_report_objects_with_different_stored_periods_are_refused(client, s1_computed):
    e11 = "*/Facility/THBK */Satellite/E11"
    compute_access(client, [SAT], {"mode": "specify", "start": T0300, "stop": T0400})
    assert_error(report(client, [OBJ, e11]), 422, "SCENARIO_INVALID", "objects")                   # หนึ่งช่วงตัด อีกอันช่วงวิเคราะห์
    assert report(client, [OBJ, e11], time={"mode": "specify", "start": T0300, "stop": T0400}).status_code == 200
    compute_access(client, [e11.split(" ")[1]], {"mode": "specify", "start": T0300, "stop": T0400})
    assert report(client, [OBJ, e11]).status_code == 200                                           # ช่วงเท่ากัน ตัดทั้งคู่


CONSTELLATIONS = ["*/Constellation/GPS", "*/Constellation/GLONASS", "*/Constellation/Galileo", "*/Constellation/BeiDou"]
WINDOW = {"mode": "specify", "start": T0300, "stop": T0400}
E11 = "*/Facility/THBK */Satellite/E11"
C01 = "*/Facility/THBK */Satellite/C01"


def report_rows(client, obj):
    r = report(client, [obj])
    assert r.status_code == 200, r.text
    return r.json()["sections"][0]["rows"]


def test_report_uses_time_period_of_a_constellation_access(client, s1_computed):
    """access ของแม่แบบ thbk-gnss เก็บปลายทางเป็น Constellation: ดาวที่เป็นสมาชิกต้องถูกตัดตาม time_period ของ access นั้น
    เหมือน GET /access/intervals ที่ Timeline ใช้ (ไม่งั้นรายงานกับ Timeline ไม่ตรงกัน)"""
    put_doc(client, lambda doc: doc["accesses"][0].update(time_period=WINDOW, computed=True))
    assert report_rows(client, OBJ) == [[1, "2026-11-10T03:00:00.000Z", "2026-11-10T04:00:00.000Z", 3600.0]]
    assert report_rows(client, E11) == [[1, "2026-11-10T03:17:40.700Z", "2026-11-10T04:00:00.000Z", 2539.3]]
    timeline = client.get(f"{BASE}/access/intervals", params={"from": FAC, "to": CONSTELLATIONS}).json()
    for name, obj in (("G01", OBJ), ("E11", E11)):
        assert [[iv["start"], iv["stop"], iv["duration_s"]] for iv in timeline[name]] == [row[1:] for row in report_rows(client, obj)]
    both = report(client, [OBJ, E11])                                      # สมาชิกของ access เดียวกัน ช่วงเท่ากัน รวมเป็นรายงานเดียวได้
    assert both.status_code == 200 and both.json()["global_statistics"]


def test_report_stored_period_choice_among_accesses(client, s1_computed):
    """มีหลาย access ที่ครอบดาวเดียวกัน: ที่ Compute อยู่ก่อนที่ Clear แล้ว จากนั้นแบบระบุดาวตรง ๆ ก่อน Constellation แล้วตามลำดับในไฟล์"""
    put_doc(client, lambda doc: doc["accesses"][0].update(to=CONSTELLATIONS[:3], time_period=WINDOW, computed=True))
    full = report_rows(client, C01)                                        # BeiDou ไม่อยู่ใน access นี้: ช่วงวิเคราะห์เต็ม
    assert full == [[1, "2026-11-10T02:54:24.164Z", "2026-11-10T06:00:00.000Z", 11135.836]]
    compute_access(client, [SAT], {"mode": "specify", "start": "2026-11-10T05:00:00Z", "stop": "2026-11-10T06:00:00Z"})
    assert report_rows(client, OBJ) == [[1, "2026-11-10T05:00:00.000Z", "2026-11-10T06:00:00.000Z", 3600.0]]     # ระบุดาวตรง ๆ ชนะ
    assert report_rows(client, E11)[0][2] == "2026-11-10T04:00:00.000Z"                                       # ดาวอื่นยังตามของ Constellation
    r = client.post(f"{BASE}/access/clear", json={"from": FAC, "to": [SAT]}, headers={"If-Match": etag_of(client)})
    assert r.status_code == 200 and r.json()["cleared"] == 1
    assert report_rows(client, OBJ) == [[1, "2026-11-10T03:00:00.000Z", "2026-11-10T04:00:00.000Z", 3600.0]]   # Clear แล้วแพ้ access ที่ยัง Compute อยู่


def test_report_specify_time_and_step(client, s1_computed, data_dir):
    window = {"mode": "specify", "start": T0300, "stop": "2026-11-10T03:10:00Z", "step_s": 60}
    r = report(client, style_name="AER", time=window)
    assert r.status_code == 200, r.text
    start, stop = utc(T0300), utc("2026-11-10T03:10:00Z")
    expected = engine_rows(data_dir, OBJ, "AER Data", None, AER, start, stop, 60)
    assert r.json()["sections"][0]["rows"] == expected and len(expected) == 11
    default = report(client, style_name="AER", time={"mode": "specify", "start": T0300, "stop": "2026-11-10T03:10:00Z"})
    assert len(default.json()["sections"][0]["rows"]) == 21                                         # step_s ว่าง = ทุกจุดของ scenario (30 วินาที)
    stepped = report(client, style_name="AER", time={"mode": "object", "step_s": 600}).json()["sections"][0]["rows"]
    assert stepped == engine_rows(data_dir, OBJ, "AER Data", None, AER, step=600)
    outside = report(client, style_name="AER", time={"mode": "specify", "start": "2026-11-12T00:00:00Z", "stop": "2026-11-12T01:00:00Z"})
    assert outside.status_code == 200 and outside.json()["sections"][0]["rows"] == []              # นอกช่วงวิเคราะห์ทั้งหมด: แถวว่าง ไม่ใช่ error


def test_report_style_time_applies_when_request_has_none(client, s1_computed, data_dir):
    timed = style("Timed", time={"mode": "specify", "start": T0300, "stop": "2026-11-10T03:10:00Z", "step_s": 60})
    put_doc(client, lambda doc: doc.update(styles=[timed]))
    rows = report(client, style_name="Timed").json()["sections"][0]["rows"]                        # ไม่ส่ง time: ใช้ time ของ style
    assert rows == engine_rows(data_dir, OBJ, "AER Data", None, ["Time", "Azimuth", "Elevation"], utc(T0300), utc("2026-11-10T03:10:00Z"), 60)
    assert len(rows) == 11
    whole = report(client, style_name="Timed", time={"mode": "object"}).json()["sections"][0]["rows"]
    assert len(whole) > 11 and whole == engine_rows(data_dir, OBJ, "AER Data", None, ["Time", "Azimuth", "Elevation"])   # ส่ง time: ตามคำขอ
    other = report(client, style_name="Timed", time={"mode": "specify", "start": T0300, "stop": T0400}).json()
    assert len(other["sections"][0]["rows"]) == 121                                                # step ของ style ไม่ตามมา (step_s ว่าง = 30 วินาที)
    only_step = style("OnlyStep", time={"mode": "object_period", "step_s": 600})
    put_doc(client, lambda doc: doc.update(styles=[only_step]))
    assert report(client, style_name="OnlyStep").json()["sections"][0]["rows"] == engine_rows(
        data_dir, OBJ, "AER Data", None, ["Time", "Azimuth", "Elevation"], step=600)
    bad_step = style("BadStep", time={"mode": "object_period", "step_s": 45})                      # style ที่เก็บ step ผิด: 422 ที่ time.step
    put_doc(client, lambda doc: doc.update(styles=[bad_step]))
    assert_error(report(client, style_name="BadStep"), 422, "SCENARIO_INVALID", "time.step")


T_RANGE = ("2026-11-10T03:00:00Z", "2026-11-10T04:00:00Z")


@pytest.mark.parametrize("time_body, field", [
    ({"mode": "object", "step_s": 45}, "time.step"),
    ({"mode": "object", "step_s": 0}, "time.step"),
    ({"mode": "object", "step_s": -30}, "time.step"),
    ({"mode": "object", "step_s": 3_000_000_000}, "time.step"),                                    # ใหญ่เกิน timedelta: ต้องไม่ล้มเป็น 500
    ({"mode": "specify", "start": T_RANGE[0], "step_s": 60}, "time.stop"),
    ({"mode": "specify", "stop": T_RANGE[1]}, "time.start"),
    ({"mode": "specify"}, "time.start"),
    ({"mode": "specify", "start": T_RANGE[0], "stop": T_RANGE[0]}, "time.start"),
    ({"mode": "specify", "start": T_RANGE[1], "stop": T_RANGE[0]}, "time.start"),
    ({"mode": "specify", "start": T_RANGE[0], "stop": T_RANGE[1], "step_s": 45}, "time.step"),
    ({"mode": "specify", "start": "yesterday", "stop": T_RANGE[1]}, "time.start"),
    ({"mode": "specify", "start": T_RANGE[0], "stop": "2026-11-10T04:00:00+07:00"}, "time.stop"),
    ({"mode": "bogus"}, "time.mode"),
    ({"mode": "object", "mystery": 1}, "time.mystery"),
])
def test_report_time_errors(client, s1_computed, time_body, field):
    assert_error(report(client, time=time_body), 422, "SCENARIO_INVALID", field)


def test_report_time_errors_win_over_stale_results(client, s1_computed):
    make_stale(client)
    assert_error(report(client, time={"mode": "object", "step_s": 45}), 422, "SCENARIO_INVALID", "time.step")
    assert_error(report(client, time={"mode": "specify", "start": T_RANGE[1], "stop": T_RANGE[0]}), 422, "SCENARIO_INVALID", "time.start")


def test_report_on_stale_results_is_409(client, s1_computed):
    assert report(client).status_code == 200
    make_stale(client)
    assert_error(report(client), 409, "RESULTS_NOT_CURRENT")
    assert_error(report(client, format="txt"), 409, "RESULTS_NOT_CURRENT")
    assert_error(report(client, [FAC], "All DOPs"), 409, "RESULTS_NOT_CURRENT")


def test_report_before_any_compute_is_409(client, s1):
    assert_error(report(client), 409, "RESULTS_NOT_CURRENT")
    assert_error(report(client, ["*/Satellite/G01"], "LLA Position"), 409, "RESULTS_NOT_CURRENT")


def test_report_style_errors(client, s1_computed, data_dir):
    assert_error(report(client, style_name="NoSuchStyle"), 422, "STYLE_INVALID", "style")
    assert_error(report(client, style_name="Gaps", kind="graph"), 422, "STYLE_INVALID", "style")        # ชื่อมี แต่ไม่มีชนิดนี้
    (data_dir / "styles").mkdir()
    bogus = style("Hand", content=[{"provider": "AER Data", "group": "Default", "elements": ["Time", "Bogus"]}])
    (data_dir / "styles" / "Hand.json").write_text(json.dumps(bogus), encoding="utf-8")
    assert_error(report(client, style_name="Hand"), 422, "STYLE_INVALID", "content[0].elements[1]")
    assert_error(report(client, style_name="Access", dynamic=True), 422, "STYLE_INVALID", "dynamic")      # Access ใช้ Dynamic Display ไม่ได้
    assert_error(report(client, style_name="Access", kind="graph", dynamic=True), 422, "STYLE_INVALID", "dynamic")
    assert_error(report(client, style_name="Hand", dynamic=True), 422, "STYLE_INVALID", "content[0].elements[1]")   # style เสียก่อน dynamic


def test_report_object_errors(client, s1_computed):
    assert_error(report(client, [FAC]), 422, "SCENARIO_INVALID", "object")                           # ชนิดไม่ตรง style
    assert_error(report(client, ["*/Facility/NOPE */Satellite/G01"]), 422, "SCENARIO_INVALID", "object")
    assert_error(report(client, ["*/Facility/THBK */Satellite/NOPE"]), 422, "SCENARIO_INVALID", "object")
    assert_error(report(client, ["THBK-To-G01"]), 422, "SCENARIO_INVALID", "object")
    assert report(client, ["*/Facility/thbk */Satellite/g01"]).status_code == 200                       # ชื่อ object ไม่แยกตัวพิมพ์เหมือน engine


@pytest.mark.parametrize("body, field", [
    ({"style": "Access", "objects": []}, "objects"),
    ({"style": "Access"}, "objects"),
    ({"objects": [OBJ]}, "style"),
    ({"style": "Access", "objects": [OBJ], "format": "pdf"}, "format"),
    ({"style": "Access", "objects": [OBJ], "kind": "chart"}, "kind"),
    ({"style": "Access", "objects": [OBJ], "dynamic": "yes"}, "dynamic"),
    ({"style": "Access", "objects": [OBJ], "mystery": 1}, "mystery"),
    ({"style": "Access", "objects": [OBJ], "time": "now"}, "time"),
    ({"style": "Access", "objects": [OBJ], "time": {"mode": "object", "step_s": "60"}}, "time.step_s"),
    ({"style": "Access", "objects": [OBJ], "export": {"delimiter": ";;"}}, "export.delimiter"),
    ({"style": "Access", "objects": [OBJ], "export": {"delimiter": ""}}, "export.delimiter"),
    ({"style": "Access", "objects": [OBJ], "export": {"delimiter": '"'}}, "export.delimiter"),          # engine ปฏิเสธตัวคั่นที่ชนกับ CSV
    ({"style": "Access", "objects": [OBJ], "export": {"delimiter": "\n"}, "format": "json"}, "export.delimiter"),
    ({"style": "Access", "objects": [OBJ], "export": {"title": 1}}, "export.title"),
    ({"style": "Access", "objects": [OBJ], "export": {"mystery": True}}, "export.mystery"),
])
def test_report_body_errors(client, s1_computed, body, field):
    assert_error(client.post(f"{BASE}/reports", json=body), 422, "SCENARIO_INVALID", field)


def test_report_scenario_not_found_and_bad_body(client, s1_computed):
    assert_error(client.post("/api/scenarios/NOPE/reports", json={"style": "Access", "objects": [OBJ]}), 404, "NOT_FOUND")
    assert client.post(f"{BASE}/reports", content=b"{", headers={"content-type": "application/json"}).status_code == 422
    assert client.post(f"{BASE}/reports", json=[1]).status_code == 422
    assert client.get(f"{BASE}/reports").status_code == 405


def test_report_style_tiers_and_kinds(client, s1_computed):
    assert report(client).json()["kind"] == "report"                                                 # ไม่ระบุ kind: report ก่อน
    graph = report(client, style_name="Access", kind="graph").json()
    assert graph["kind"] == "graph" and graph["graph"]["type"] == "interval" and graph["dynamic"] is False
    assert report(client, style_name="Az El Polar").json()["graph"]["type"] == "polar90"
    mine = style("Mine")
    assert put_style(client, "Mine", mine).status_code == 200
    body = report(client, style_name="mine").json()                                                  # My Style (ชื่อไม่แยกตัวพิมพ์)
    assert body["style"] == "Mine" and [c["name"] for c in body["sections"][0]["columns"]] == ["Time", "Azimuth", "Elevation"]
    shadow = style("Mine", content=[{"provider": "AER Data", "group": "Default", "elements": ["Time", "Range"]}])
    put_doc(client, lambda doc: doc.update(styles=[shadow, style("AER", content=[
        {"provider": "AER Data", "group": "Default", "elements": ["Time", "Elevation"]}])]))
    assert [c["name"] for c in report(client, style_name="Mine").json()["sections"][0]["columns"]] == ["Time", "Range"]    # Scenario ก่อน My
    assert [c["name"] for c in report(client, style_name="AER").json()["sections"][0]["columns"]] == ["Time", "Elevation"]  # และก่อน Installed


def test_report_dynamic_flag_follows_the_request(client, s1_computed):
    assert report(client, style_name="AER").json()["dynamic"] is False                               # style รองรับ แต่คำขอไม่ได้ขอ
    assert report(client, style_name="AER", dynamic=True).json()["dynamic"] is True
    strip = report(client, style_name="AER", kind="graph", dynamic=True).json()
    assert strip["dynamic"] is True and strip["graph"]["type"] == "time_xy"
    assert report(client, [FAC], "All DOPs", dynamic=True).json()["dynamic"] is True


def test_report_uses_scenario_units(client, s1_computed):
    put_doc(client, lambda doc: doc["units"].update(date_format="LTZG", ltz_offset="+05:30"))
    unit = time_unit("LTZG", "+05:30")
    assert unit != "UTCG"
    assert f"Start Time ({unit})" in report(client, format="txt").text
    assert report(client, format="csv").text.splitlines()[0] == f"Access,Start Time ({unit}),Stop Time ({unit}),Duration (sec)"
    assert report(client).json()["sections"][0]["rows"][0][1].endswith("Z")                          # JSON เป็น UTC เสมอ


def test_report_with_unreadable_units_is_422(client, s1_computed, data_dir):
    path = scenario_dir(data_dir) / "scenario.json"
    doc = json.loads(path.read_text(encoding="utf-8"))
    doc["units"] = {"date_format": "JULIAN"}
    path.write_text(json.dumps(doc), encoding="utf-8")
    assert_error(report(client, format="txt"), 422, "SCENARIO_INVALID", "units.date_format")


def test_report_uses_plan_and_table_caches(client, s1_computed, monkeypatch):
    """รายงานใช้ PlanCache และ TableCache เหมือน /data: ซ้ำกันกี่ครั้งก็ไม่คำนวณ hash หรืออ่านดิสก์เพิ่ม (open_result_set ช้า 0.42-0.45 วินาที)"""
    calls = []
    for module in (studio, plans_module):
        for name in ("plan_propagate", "plan_analyze"):
            real = getattr(module, name)
            monkeypatch.setattr(module, name, lambda *a, _real=real, **kw: (calls.append(1), _real(*a, **kw))[1])
    assert report(client).status_code == 200
    warm, loads = len(calls), client.app.state.tables.loads
    assert warm >= 2 and loads > 0                         # PlanCache คำนวณ hash ครั้งแรก (ขณะ cache ว่าง) หลังจากนี้ไม่เพิ่ม
    for _ in range(3):
        assert report(client, format="txt").status_code == 200
        assert report(client, style_name="AER", dynamic=True).status_code == 200
    assert len(calls) == warm and client.app.state.tables.loads == loads


FACILITIES = ["THBK", "PHUK", "CMAI", "SONG"]


def add_facilities(client, data_dir):
    """เพิ่ม Facility สามแห่งต่อจาก THBK แล้ว analyze ทุกแห่ง (GMAT ปลอมจาก s1_computed): ephem 1 + access 4 bundle > cache 4"""
    def mutate(doc):
        thbk = next(o for o in doc["objects"] if o["name"] == "THBK")
        for i, name in enumerate(FACILITIES[1:], 1):
            doc["objects"].append({**thbk, "name": name, "position": {**thbk["position"], "lat_deg": 7.9 + 2.5 * i, "lon_deg": 98.4 + i}})
    put_doc(client, mutate)
    for name in FACILITIES:
        studio.run_analyze(scenario_dir(data_dir), name, data_dir)


def test_report_pins_bundles_across_four_facilities(client, s1_computed, data_dir):
    """cache ของ server มี 4 bundle: รายงานที่เรียง object สลับ Facility (THBK-G01, PHUK-G01, ..., THBK-E11, ...) ใช้ ephem 1 + access 4 bundle
    ถ้าไม่ตรึงจะไล่กันออกแล้วอ่านซ้ำใน request เดียว แต่ละ bundle ต้องอ่านครั้งเดียวต่อ request"""
    add_facilities(client, data_dir)
    objects = [f"*/Facility/{fac} */Satellite/{sat}" for sat in ("G01", "E11", "C01") for fac in FACILITIES]
    expected = report_json(engine_report(data_dir, "AER", objects))["sections"]
    app = client.app
    assert app.state.tables.max_bundles == 4
    app.state.tables = tables = TableCache(4)
    r = report(client, objects, "AER")
    assert r.status_code == 200, r.text
    assert r.json()["sections"] == expected and len(expected) == 12
    assert tables.loads == 1 + 4                                      # manifest ของ ephem 1 ครั้ง กับตาราง access ของแต่ละ Facility อย่างละครั้ง
    first = tables.loads
    assert report(client, objects, "AER", format="csv").status_code == 200       # request ถัดไป: ที่เหลือใน cache ใช้ต่อ ที่หลุดอ่านใหม่ครั้งเดียวต่อ bundle
    assert tables.loads - first <= 1 + 4
    app.state.tables = tables = TableCache(4)
    assert report(client, [f"*/Facility/{fac}" for fac in FACILITIES], "All DOPs").status_code == 200
    assert tables.loads == 4                                          # Facility ล้วน: ตาราง access 4 ชุด ไม่แตะ ephem


def test_report_caps_distinct_facilities_at_four(client, s1_computed, data_dir):
    """หนึ่ง request ตรึงตารางของทุก Facility ไว้พร้อมกัน (ราว 135 MB ต่อแห่ง) จึงจำกัด 4 Facility: เกินนี้ 422 ที่ `objects`
    ตรวจก่อนอ่านผลลัพธ์ (Facility ที่ห้าไม่ต้องมีผล analyze ก็ได้ 422 ไม่ใช่ 409)"""
    add_facilities(client, data_dir)
    put_doc(client, lambda doc: doc["objects"].append({**next(o for o in doc["objects"] if o["name"] == "THBK"), "name": "UBON"}))
    five = [f"*/Facility/{fac} */Satellite/G01" for fac in (*FACILITIES, "UBON")]
    j = assert_error(report(client, five, "AER"), 422, "SCENARIO_INVALID", "objects")
    assert "4" in j["text"]
    assert_error(report(client, five, "AER", format="csv"), 422, "SCENARIO_INVALID", "objects")
    assert_error(report(client, [f"*/Facility/{fac}" for fac in (*FACILITIES, "UBON")], "All DOPs"), 422, "SCENARIO_INVALID", "objects")
    assert_error(report(client, [f"*/Facility/{fac}" for fac in ("a", "b", "c", "d", "e")], "All DOPs"), 422, "SCENARIO_INVALID", "objects")
    # สี่แห่งพอดีได้ แม้มี object มากกว่าสี่ตัว และชื่อ Facility ซ้ำต่างตัวพิมพ์นับเป็นแห่งเดียว
    ok = [f"*/Facility/{fac} */Satellite/{sat}" for sat in ("G01", "E11") for fac in FACILITIES] + ["*/Facility/thbk */Satellite/C01"]
    r = report(client, ok, "AER")
    assert r.status_code == 200 and len(r.json()["sections"]) == 9, r.text
    # ดาวไม่ใช้ตาราง access ของ Facility จึงไม่นับ
    sats = [f"*/Satellite/{name}" for name in ("C01", "C09", "C40", "E11", "E14", "G01", "G22", "R05", "R10")]
    assert report(client, sats, "LLA Position").status_code == 200


def test_pinned_tables_read_each_bundle_once(tmp_path):
    """PinnedTables ถือ reference ของ request: cache ข้างใต้เล็กแค่ 1 bundle ก็อ่านแต่ละ (ชนิด, bundle) ครั้งเดียว และ cache ข้างใต้ไม่ถูกแตะซ้ำ"""
    class Counting(TableCache):
        def __init__(self):
            super().__init__(1)
            self.calls = []

        def access(self, path):
            self.calls.append(("access", path))
            return object()

        def ephem_manifest(self, path):
            self.calls.append(("manifest", path))
            return {"path": path}

    shared = Counting()
    pinned = PinnedTables(shared)
    a, b = tmp_path / "a", tmp_path / "b"
    first = [pinned.access(a), pinned.access(b), pinned.ephem_manifest(a)]
    assert [pinned.access(a), pinned.access(b), pinned.ephem_manifest(a)] == first
    assert [pinned.access(a) for _ in range(3)] == [first[0]] * 3
    assert shared.calls == [("access", a), ("access", b), ("manifest", a)]
    other = PinnedTables(shared)                                       # request ใหม่ตรึงใหม่ (ผ่าน cache ของ server อีกครั้ง)
    other.access(a)
    assert len(shared.calls) == 4


def test_report_one_day_under_2s(client, snapshot, fake_gmat, data_dir):
    """เกณฑ์ข้อ 3 (P13): รายงาน Access ของ THBK กับดาวหนึ่งดวงในหนึ่งวัน แบบ cache ว่างทุกชั้น ภายใน 2 วินาที
    เวลารวมทุกอย่างบน request: อ่านและแปลง style (Installed ที่อ่านไฟล์ใหม่, My Styles, Scenario Styles) hash ของ plan อ่านตารางจาก bundle
    และจัดรูปแบบ วัดที่ดีที่สุดจาก 3 รอบที่ล้าง cache ใหม่ทุกรอบ เพื่อไม่ให้เครื่องที่กำลังทำงานอื่นทำให้ล้ม"""
    r = client.post("/api/scenarios", json={"name": "D1", "template": "thbk-gnss", "start": "2026-11-10T00:00:00Z",
                                            "stop": "2026-11-11T00:00:00Z", "snapshot": "20261110T0000Z"})
    assert r.status_code == 201, r.text
    directory = data_dir / "scenarios" / "D1"
    studio.run_propagate(directory, data_dir)
    studio.run_analyze(directory, "THBK", data_dir)
    app = client.app
    url = "/api/scenarios/D1/reports"
    body = {"style": "Access", "objects": ["*/Facility/THBK */Satellite/G01"]}
    timings = []
    for _ in range(3):
        app.state.tables = TableCache(4)
        app.state.plans = PlanCache(app.state.store, app.state.logger)
        report_style._installed.cache_clear()
        began = time.perf_counter()
        r = client.post(url, json=body)
        timings.append(time.perf_counter() - began)
        assert r.status_code == 200, r.text
        assert r.json()["sections"][0]["rows"], "ต้องมีแถว access อย่างน้อยหนึ่งช่วง"
    print(f"cold report timings (s): {[round(t, 3) for t in timings]}")
    assert min(timings) < 2.0, timings
