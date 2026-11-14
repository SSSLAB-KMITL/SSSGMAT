"""Data provider, ข้อมูล และ style ของรายงาน (หัวข้อ 6.7 ของ spec server): `/dataproviders`, `/data`, `/styles`, cache ของตาราง

route แค่เรียก engine (`gnss_predict.dataproviders`, `report_style`) ค่าที่คาดอ่านจาก engine โดยตรงบน bundle เดียวกับที่ fixture
`s1_computed` เขียน (GMAT ปลอม ไม่ใช้เน็ต) scenario S1 ของแม่แบบ thbk-gnss: 6 ชั่วโมง step 30 วินาที Facility THBK และดาว G01 มี access 1 ช่วง
"""

import json
import re
from datetime import datetime, timezone
from urllib.parse import quote

import pytest

from gnss_predict import studio
from gnss_predict.dataproviders import TableCache, open_result_set, provider_rows
from gnss_predict.errors import StyleError
from gnss_predict.report_style import installed_styles
from gnss_studio_server import plans as plans_module
from gnss_studio_server.errors import ApiError
from gnss_studio_server.routes.reports import server_result_set
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
