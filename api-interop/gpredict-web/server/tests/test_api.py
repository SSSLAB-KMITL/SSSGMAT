"""REST API (หัวข้อ 7.3 และ 7.4 ของ spec) ด้วย TestClient: EphemManager จริงกับ propagate ปลอม (start_worker=False แล้ว drain()),
นาฬิกาเครื่องปลอม, opener ปลอม (ห้ามใช้เน็ต) และ data dir ชั่วคราว"""

import json
import unittest
from datetime import timedelta
from pathlib import Path
from unittest import mock
from urllib.error import URLError

from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from gpredict_web import app as app_module
from gpredict_web.app import create_app, host_allow_list
from gpredict_web.config import MAX_SATS, TLE_GROUPS
from gpredict_web.ephem import EphemManager
from gpredict_web.module import (LAYOUT_PRESETS, LIST_COLUMNS, LIST_HINTS, MAP_CONTENTS, POLAR_CONTENTS,
                                 POLAR_ORIENTATIONS, SINGLE_FIELDS, SINGLE_HINTS, module_from_dict, module_to_dict)
from gpredict_web.prefs import PREFS
from gpredict_web.store import Store
from gnss_predict.config import REPO_ROOT
from gnss_predict.errors import GmatRunError
from tests.helpers import TEST_HOSTS, FakeNow, temp_config
from tests.test_bootstrap import SAMPLE, _Resp
from tests.test_runtime import NORADS, ORIGIN, OTHER, T0, OrbitPropagate, dusk_station, iso, peak, record

ERROR_KEYS = ["code", "level", "text", "object"]


class GroupOpener:
    """opener ปลอมตามชื่อกลุ่มใน URL: bytes = ตอบ 200 ไม่มีในตาราง = ต่อเน็ตไม่ได้ (URLError) จด URL ที่ถูกเรียก"""

    def __init__(self, bodies: dict[str, bytes] | None = None, on_call=None):
        self.bodies = bodies or {}
        self.on_call = on_call
        self.urls: list[str] = []

    def __call__(self, request, timeout=None):
        self.urls.append(request.full_url)
        if self.on_call is not None:
            self.on_call()
        group = request.full_url.split("GROUP=")[1].split("&")[0]
        if group in self.bodies:
            return _Resp(self.bodies[group])
        raise URLError("ไม่มีเน็ตใน test")


class ApiTestBase(unittest.TestCase):
    """app ที่มี QTH ORIGIN (สถานีตั้งต้น) และ OTHER, ดาวสังเคราะห์ NORADS ในดัชนี, ยังไม่มี module"""

    start_background = False

    def setUp(self):
        self.cfg = temp_config(self)
        self.fake = OrbitPropagate()
        self.ephem = EphemManager(self.cfg, propagate_fn=self.fake, find_console=lambda: Path("/fake/GmatConsole"),
                                  start_worker=False)
        self.addCleanup(self.ephem.close)
        self.wall = FakeNow(T0)
        self.store = Store(self.cfg.data_dir)
        self.store.put_qth(ORIGIN)
        self.store.put_qth(OTHER)
        self.store.set_default_qth("ORIGIN")
        self.write_satdb([record(n) for n in NORADS])
        self.opener = GroupOpener()
        self.quits = 0
        self.app = self.make_app()
        self.client = self.enter(self.app)

    def make_app(self, **kw):
        def on_quit():
            self.quits += 1
        args = dict(start_background=self.start_background, opener=self.opener, now=self.wall, on_quit=on_quit,
                    ephem=self.ephem, allowed_hosts=TEST_HOSTS)
        args.update(kw)
        return create_app(self.cfg, **args)

    def enter(self, app) -> TestClient:
        client = TestClient(app)
        client.__enter__()                                               # lifespan + event loop เดียวตลอด test
        self.addCleanup(client.__exit__, None, None, None)
        return client

    def write_satdb(self, records) -> None:
        path = self.cfg.data_dir / "satdb.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"version": 1, "satellites": {
            str(r.norad): {"name": r.name, "groups": r.groups, "tle": list(r.tle_lines),
                           "epoch": iso(r.epoch), "updated": iso(r.updated)} for r in records}}), encoding="utf-8")

    @property
    def hub(self):
        return self.app.state.hub

    def module_body(self, name="M", qth="ORIGIN", sats=NORADS, **extra) -> dict:
        return {"name": name, "qth": qth, "satellites": list(sats), **extra}

    def put_module(self, name="M", **kw) -> dict:
        r = self.client.put(f"/api/modules/{name}", json=self.module_body(name, **kw))
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()

    def open_module(self, name="M", drain=True) -> None:
        r = self.client.post(f"/api/modules/{name}/open")
        self.assertEqual(r.status_code, 200, r.text)
        if drain:
            self.ephem.drain()

    def assert_error(self, r, status: int, code: str, obj="__any__") -> dict:
        self.assertEqual(r.status_code, status, r.text)
        body = r.json()
        self.assertEqual(list(body), ERROR_KEYS)
        self.assertEqual((body["code"], body["level"]), (code, "error"))
        self.assertRegex(body["text"], r"[ก-๙]")                                 # ข้อความถึงผู้ใช้เป็นภาษาไทย
        if obj != "__any__":
            self.assertEqual(body["object"], obj)
        return body


# ---------------------------------------------------------------- QTH

class QthApiTest(ApiTestBase):
    def test_list_qth_with_default(self):
        r = self.client.get("/api/qth")
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(body["default"], "ORIGIN")
        self.assertEqual([q["name"] for q in body["qth"]], ["ORIGIN", "OTHER"])
        self.assertEqual(body["qth"][0], {"name": "ORIGIN", "description": "", "location": "Gulf of Guinea",
                                          "lat_deg": 0.0, "lon_deg": 0.0, "alt_m": 0.0, "weather_station": ""})

    def test_list_qth_has_no_messages_when_all_files_are_good(self):
        self.assertEqual(self.client.get("/api/qth").json()["messages"], [])

    def test_list_qth_skips_bad_files_and_reports_them(self):
        qth_dir = self.cfg.data_dir / "qth"
        (qth_dir / "Broken.json").write_text("{", encoding="utf-8")
        (qth_dir / "Latin.json").write_bytes(b'{"name": "Latin", "location": "\xff"}')      # ไม่ใช่ UTF-8
        (qth_dir / "Range.json").write_text('{"name": "Range", "lat_deg": 99}', encoding="utf-8")
        r = self.client.get("/api/qth")
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertEqual([q["name"] for q in body["qth"]], ["ORIGIN", "OTHER"])
        self.assertEqual(body["default"], "ORIGIN")
        self.assertEqual([(m["code"], m["level"], m["object"]) for m in body["messages"]],
                         [("QTH_INVALID", "warning", "Broken.json"), ("QTH_INVALID", "warning", "Latin.json"),
                          ("QTH_INVALID", "warning", "Range.json")])
        for m in body["messages"]:
            self.assertEqual(list(m), ERROR_KEYS)
            self.assertRegex(m["text"], r"[ก-๙]")
            self.assertIn(m["object"], m["text"])

    def test_get_bad_qth_file_is_qth_invalid(self):
        qth_dir = self.cfg.data_dir / "qth"
        (qth_dir / "Latin.json").write_bytes(b"\xff\xfe")
        (qth_dir / "Big.json").write_text('{"name": "Big", "lat_deg": ' + "9" * 5000 + "}", encoding="utf-8")
        self.assert_error(self.client.get("/api/qth/Latin"), 422, "QTH_INVALID", "Latin")
        self.assert_error(self.client.get("/api/qth/Big"), 422, "QTH_INVALID", "Big")

    def test_put_get_delete_qth(self):
        q = {"name": "NEW", "description": "สถานีทดลอง", "location": "Chiang Mai", "lat_deg": 18.79,
             "lon_deg": 98.98, "alt_m": 310, "weather_station": "VTCC"}
        r = self.client.put("/api/qth/NEW", json=q)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json(), {**q, "alt_m": 310.0})
        self.assertEqual(self.client.get("/api/qth/NEW").json(), {**q, "alt_m": 310.0})
        r = self.client.delete("/api/qth/NEW")
        self.assertEqual(r.status_code, 204)
        self.assert_error(self.client.get("/api/qth/NEW"), 404, "NOT_FOUND", "NEW")
        self.assert_error(self.client.delete("/api/qth/NEW"), 404, "NOT_FOUND", "NEW")

    def test_put_qth_invalid(self):
        bad = {"name": "NEW", "lat_deg": 91}
        self.assert_error(self.client.put("/api/qth/NEW", json=bad), 422, "QTH_INVALID", "lat_deg")
        self.assert_error(self.client.put("/api/qth/NEW", json={"name": "NEW", "alt_m": "high"}), 422, "QTH_INVALID", "alt_m")
        self.assert_error(self.client.put("/api/qth/NEW", json={"name": "OTHER"}), 422, "QTH_INVALID", "name")
        self.assert_error(self.client.put("/api/qth/NEW", json={}), 422, "QTH_INVALID", "name")
        self.assert_error(self.client.put("/api/qth/origin", json={"name": "origin"}), 422, "QTH_INVALID", "name")
        self.assertEqual(self.store.qth_names(), ["ORIGIN", "OTHER"])

    def test_delete_qth_in_use_or_last(self):
        self.put_module(qth="OTHER")
        self.put_module("D", qth=None)                                       # ใช้สถานีตั้งต้น (ORIGIN)
        self.assert_error(self.client.delete("/api/qth/OTHER"), 409, "IN_USE", "OTHER")
        self.assert_error(self.client.delete("/api/qth/ORIGIN"), 409, "IN_USE", "ORIGIN")
        self.client.delete("/api/modules/D")
        self.assertEqual(self.client.delete("/api/qth/ORIGIN").status_code, 204)
        self.client.delete("/api/modules/M")
        self.assert_error(self.client.delete("/api/qth/OTHER"), 409, "IN_USE", "OTHER")      # สถานีสุดท้าย

    def test_put_qth_used_by_open_module_updates_tick(self):
        self.put_module(qth="OTHER")
        self.open_module()
        self.assertEqual(self.hub.get("M").tick()["qth"]["lat_deg"], 10.0)
        r = self.client.put("/api/qth/OTHER", json={"name": "OTHER", "location": "Moved", "lat_deg": 11.5,
                                                     "lon_deg": 20.0, "alt_m": 100.0})
        self.assertEqual(r.status_code, 200, r.text)
        qth = self.hub.get("M").tick()["qth"]
        self.assertEqual((qth["location"], qth["lat_deg"]), ("Moved", 11.5))


# ---------------------------------------------------------------- ดาวและ TLE

class SatelliteApiTest(ApiTestBase):
    def test_search(self):
        r = self.client.get("/api/satellites", params={"q": "sat-255"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json(), {"satellites": [{"norad": 25544, "name": "SAT-25544", "groups": ["amateur"],
                                                    "epoch": iso(T0 - timedelta(days=1)),
                                                    "updated": iso(T0 - timedelta(days=1))}]})
        all_sats = self.client.get("/api/satellites").json()["satellites"]
        self.assertEqual([s["name"] for s in all_sats], sorted(f"SAT-{n}" for n in NORADS))
        self.assertEqual(len(self.client.get("/api/satellites", params={"group": "amateur"}).json()["satellites"]), 3)
        self.assertEqual(self.client.get("/api/satellites", params={"group": "weather"}).json(), {"satellites": []})
        self.assertEqual(self.client.get("/api/satellites", params={"q": "43017"}).json()["satellites"][0]["norad"], 43017)

    def test_search_is_capped_at_500(self):
        self.write_satdb([record(n) for n in range(1000, 1600)])
        app = self.make_app()
        client = self.enter(app)
        self.assertEqual(len(client.get("/api/satellites").json()["satellites"]), 500)

    def test_search_q_too_long_is_request_invalid(self):
        self.assert_error(self.client.get("/api/satellites", params={"q": "9" * 65}), 422, "REQUEST_INVALID", "q")
        self.assertEqual(self.client.get("/api/satellites", params={"q": "9" * 64}).status_code, 200)

    def test_get_satellite(self):
        r = self.client.get("/api/satellites/25544")
        self.assertEqual(r.status_code, 200)
        rec = record(25544)
        self.assertEqual(r.json(), {"norad": 25544, "name": "SAT-25544", "groups": ["amateur"],
                                    "epoch": iso(rec.epoch), "updated": iso(rec.updated), "tle": list(rec.tle_lines)})
        self.assert_error(self.client.get("/api/satellites/11111"), 404, "NOT_FOUND", "11111")
        self.assert_error(self.client.get("/api/satellites/abc"), 422, "REQUEST_INVALID", "norad")


class TleApiTest(ApiTestBase):
    def test_groups_with_last_fetch_from_shared_state_file(self):
        self.cfg.state_file.parent.mkdir(parents=True, exist_ok=True)
        self.cfg.state_file.write_text(json.dumps({
            "amateur": {"last_request": "2026-11-12T06:00:00Z", "last_success": "2026-11-12T04:00:00Z"},
            "weather": {"last_request": "2026-11-12T05:30:00Z"},
            "gps-ops": "เสีย"}), encoding="utf-8")
        r = self.client.get("/api/tle/groups")
        self.assertEqual(r.status_code, 200)
        groups = r.json()["groups"]
        self.assertEqual([g["name"] for g in groups], list(TLE_GROUPS))
        by_name = {g["name"]: g for g in groups}
        self.assertEqual(by_name["amateur"], {"name": "amateur", "last_request": "2026-11-12T06:00:00.000Z",
                                              "last_success": "2026-11-12T04:00:00.000Z"})
        self.assertEqual(by_name["weather"], {"name": "weather", "last_request": "2026-11-12T05:30:00.000Z",
                                              "last_success": None})
        self.assertEqual(by_name["gps-ops"], {"name": "gps-ops", "last_request": None, "last_success": None})

    def test_groups_without_state_file(self):
        groups = self.client.get("/api/tle/groups").json()["groups"]
        self.assertTrue(all(g["last_request"] is None and g["last_success"] is None for g in groups))

    def test_update_counts_and_reloads_open_modules(self):
        self.put_module()
        self.open_module()
        self.opener.bodies["amateur"] = json.dumps(SAMPLE).encode("utf-8")
        self.opener.on_call = lambda: self.assertTrue(self.app.state.tle_lock.locked())   # ทีละงาน
        with mock.patch.object(self.hub, "reload", wraps=self.hub.reload) as reload:
            r = self.client.post("/api/tle/update")
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertEqual(list(body), ["updated", "skipped", "missing", "messages"])
        self.assertEqual((body["updated"], body["skipped"], body["missing"]), (len(SAMPLE), 0, len(NORADS)))
        failed = [m for m in body["messages"] if m["code"] == "ORBIT_DOWNLOAD_FAILED"]
        self.assertEqual(sorted(m["object"] for m in failed), sorted(g for g in TLE_GROUPS if g != "amateur"))
        for m in body["messages"]:
            self.assertEqual(list(m), ERROR_KEYS)
        self.assertEqual(len(self.opener.urls), len(TLE_GROUPS))
        reload.assert_called_once_with("M")
        self.assertEqual(self.client.get(f"/api/satellites/{SAMPLE[0]['NORAD_CAT_ID']}").status_code, 200)
        self.assertEqual(self.client.get("/api/tle/groups").json()["groups"][0]["last_success"], iso(T0))


# ---------------------------------------------------------------- module

class ModuleApiTest(ApiTestBase):
    def test_list_modules(self):
        self.assertEqual(self.client.get("/api/modules").json(), {"modules": [], "open": [], "messages": []})
        self.put_module("B")
        self.put_module("A")
        self.open_module("B")
        self.assertEqual(self.client.get("/api/modules").json(), {"modules": ["A", "B"], "open": ["B"], "messages": []})

    def test_put_get_delete_module(self):
        body = self.put_module(single={"selected": NORADS[1]})
        expected = module_to_dict(module_from_dict(self.module_body(single={"selected": NORADS[1]}), None, None))
        self.assertEqual(body, expected)                                    # ช่องที่ไม่ส่งได้ค่าตั้งต้นของ Gpredict
        self.assertEqual(self.client.get("/api/modules/M").json(), expected)
        self.assertEqual(self.client.delete("/api/modules/M").status_code, 204)
        self.assert_error(self.client.get("/api/modules/M"), 404, "NOT_FOUND", "M")
        self.assert_error(self.client.delete("/api/modules/M"), 404, "NOT_FOUND", "M")

    def test_put_module_invalid(self):
        cases = [
            (self.module_body(layout_code="1;0;2"), "layout_code"),
            (self.module_body(sats=[*NORADS, 11111]), "satellites"),          # NORAD ไม่อยู่ในดัชนี
            (self.module_body(sats=[]), "satellites"),
            (self.module_body(qth="NOPE"), "qth"),
            (self.module_body(name="Other"), "name"),                          # ชื่อใน body ไม่ตรงกับ URL
            ({"qth": None, "satellites": list(NORADS)}, "name"),
        ]
        for body, field in cases:
            with self.subTest(field=field, body=body):
                self.assert_error(self.client.put("/api/modules/M", json=body), 422, "MODULE_INVALID", field)
        self.assertEqual(self.store.list_modules(), [])

    def test_put_module_name_differing_only_in_case_is_invalid(self):
        self.put_module("Amateur")
        r = self.client.put("/api/modules/amateur", json=self.module_body("amateur"))
        self.assert_error(r, 422, "MODULE_INVALID", "name")
        self.assertEqual(self.store.get_module("Amateur").name, "Amateur")

    def test_put_module_too_many_sats(self):
        body = self.module_body(sats=range(1, MAX_SATS + 2))
        self.assert_error(self.client.put("/api/modules/M", json=body), 422, "MODULE_TOO_MANY_SATS", "satellites")

    def test_open_and_close_follow_session(self):
        self.put_module("A")
        self.put_module("B")
        self.assertEqual(self.client.post("/api/modules/B/open").json(), {"open": ["B"]})
        self.assertEqual(self.client.post("/api/modules/A/open").json(), {"open": ["B", "A"]})
        self.assertEqual(self.client.post("/api/modules/A/open").json(), {"open": ["B", "A"]})   # เปิดซ้ำไม่เพิ่มแท็บ
        self.assertEqual(self.hub.open_names(), ["B", "A"])
        self.assertEqual(self.store.session(), ["B", "A"])
        self.assertEqual(self.client.post("/api/modules/B/close").json(), {"open": ["A"]})
        self.assertIsNone(self.hub.get("B"))
        self.assertEqual(self.store.session(), ["A"])
        self.assertEqual(self.client.post("/api/modules/B/close").json(), {"open": ["A"]})       # ปิดซ้ำได้

    def test_open_close_unknown_module_not_found(self):
        self.assert_error(self.client.post("/api/modules/Nope/open"), 404, "NOT_FOUND", "Nope")
        self.assert_error(self.client.post("/api/modules/Nope/close"), 404, "NOT_FOUND", "Nope")
        self.assertEqual(self.store.session(), [])

    def test_clone(self):
        self.put_module(qth="OTHER", refresh={"data_ms": 1000})
        self.open_module()
        r = self.client.post("/api/modules/M/clone", json={"new_name": "M2", "open": True})
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertEqual(body["open"], ["M", "M2"])
        self.assertEqual(body["module"], {**self.client.get("/api/modules/M").json(), "name": "M2"})
        self.assertIsNotNone(self.hub.get("M2"))
        r = self.client.post("/api/modules/M/clone", json={"new_name": "M3", "open": False})
        self.assertEqual(r.json()["open"], ["M", "M2"])
        self.assertIsNone(self.hub.get("M3"))
        self.assertEqual(self.store.list_modules(), ["M", "M2", "M3"])
        r = self.client.post("/api/modules/M/clone", json={"new_name": "M4"})             # open ตั้งต้นเปิด (Gpredict)
        self.assertEqual(r.json()["open"], ["M", "M2", "M4"])

    def test_clone_errors(self):
        self.put_module()
        self.put_module("Taken")
        self.assert_error(self.client.post("/api/modules/M/clone", json={"new_name": "taken"}), 422,
                          "MODULE_INVALID", "new_name")
        self.assert_error(self.client.post("/api/modules/M/clone", json={"new_name": "bad name"}), 422,
                          "MODULE_INVALID", "new_name")
        self.assert_error(self.client.post("/api/modules/M/clone", json={}), 422, "MODULE_INVALID", "new_name")
        self.assert_error(self.client.post("/api/modules/M/clone", json={"new_name": "M5", "open": "yes"}), 422,
                          "MODULE_INVALID", "open")
        self.assert_error(self.client.post("/api/modules/Nope/clone", json={"new_name": "M6"}), 404, "NOT_FOUND", "Nope")
        self.assertEqual(self.store.list_modules(), ["M", "Taken"])

    def test_session_tabs(self):
        for n in ("A", "B", "C"):
            self.put_module(n)
            self.open_module(n, drain=False)
        r = self.client.put("/api/session/tabs", json={"open": ["C", "A", "B"]})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json(), {"open": ["C", "A", "B"]})
        self.assertEqual(self.client.get("/api/modules").json()["open"], ["C", "A", "B"])
        self.assertEqual(self.store.session(), ["C", "A", "B"])
        for tabs in (["C", "A"], ["C", "A", "B", "D"], ["C", "A", "A"], "C", [1, 2, 3]):
            with self.subTest(tabs=tabs):
                self.assert_error(self.client.put("/api/session/tabs", json={"open": tabs}), 422,
                                  "MODULE_INVALID", "open")
        self.assertEqual(self.store.session(), ["C", "A", "B"])

    def test_delete_open_module_closes_it(self):
        self.put_module()
        self.open_module()
        rt = self.hub.get("M")
        self.assertEqual(self.client.delete("/api/modules/M").status_code, 204)
        self.assertIsNone(self.hub.get("M"))
        self.assertTrue(rt.closed)
        self.assertEqual(self.store.session(), [])
        self.assertEqual(self.client.get("/api/modules").json()["open"], [])

    def test_put_module_while_open_updates_tick(self):
        """Review Focus 5: แก้ QTH และดาวของ module ที่เปิดอยู่ในอีกแท็บ tick ถัดไปของทุกแท็บใช้ค่าใหม่"""
        self.put_module(qth="ORIGIN", refresh={"data_ms": 100})
        self.open_module()
        with self.client.websocket_connect("/ws/modules/M") as tab1, \
                self.client.websocket_connect("/ws/modules/M") as tab2:
            for tab in (tab1, tab2):
                tick = tab.receive_json()
                self.assertEqual((tick["status"], tick["qth"]["name"]), ("ok", "ORIGIN"))
                self.assertEqual([s["norad"] for s in tick["sats"]], list(NORADS))
            self.put_module(qth="OTHER", sats=NORADS[:2], refresh={"data_ms": 100})
            # tick ที่อ่านนาฬิกาหลังจากนี้เริ่มหลัง PUT ตอบแล้ว (reload เสร็จก่อนตอบ) จึงต้องใช้ค่าใหม่ทุกก้อน
            self.wall.advance(1)
            after = iso(T0 + timedelta(seconds=1))
            for tab in (tab1, tab2):
                for _ in range(200):                                        # ข้าม tick เก่าที่ค้างอยู่ในคิวของ socket
                    tick = tab.receive_json()
                    if tick["t"] == after:
                        break
                else:
                    self.fail("ไม่ได้ tick ที่เริ่มหลัง PUT")
                for tick in (tick, tab.receive_json(), tab.receive_json()):
                    self.assertEqual(tick["t"], after)
                    self.assertEqual((tick["status"], tick["qth"]["name"]), ("ok", "OTHER"))
                    self.assertEqual([s["norad"] for s in tick["sats"]], list(NORADS[:2]))
        self.assertEqual(self.hub.get("M").tick()["qth"]["name"], "OTHER")


# ---------------------------------------------------------------- runtime: retry, นาฬิกา, track

class RuntimeApiTest(ApiTestBase):
    def setUp(self):
        super().setUp()
        self.put_module()

    def clock(self) -> dict:
        r = self.client.get("/api/modules/M/clock")
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()

    def test_retry_after_gmat_failure(self):
        self.fake.fail = GmatRunError("GMAT ล้ม")
        self.open_module()
        self.assertEqual(self.hub.get("M").tick()["status"], "failed")
        self.fake.fail = None
        self.assertEqual(self.client.post("/api/modules/M/retry").status_code, 204)
        self.ephem.drain()
        self.assertEqual(self.hub.get("M").tick()["status"], "ok")

    def test_retry_requires_open_module(self):
        self.assert_error(self.client.post("/api/modules/M/retry"), 404, "NOT_FOUND", "M")
        self.assert_error(self.client.post("/api/modules/Nope/retry"), 404, "NOT_FOUND", "Nope")

    def test_clock_get_put_reset(self):
        self.open_module()
        self.assertEqual(self.clock(), {"state": "forward", "throttle": 1, "time": iso(T0), "label": "Real-Time"})
        later = T0 + timedelta(days=3, milliseconds=250)
        r = self.client.put("/api/modules/M/clock", json={"state": "stop", "time": iso(later)})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json(), {"state": "stop", "throttle": 1, "time": iso(later), "label": "Manual Control"})
        self.assertEqual(self.hub.get("M").tick()["t"], iso(later))          # tick ใช้นาฬิกาเดียวกัน
        r = self.client.put("/api/modules/M/clock", json={"state": "backward", "throttle": 50})
        self.assertEqual(r.json(), {"state": "backward", "throttle": 50, "time": iso(later),
                                    "label": "Simulated Real-Time"})
        self.wall.advance(2)
        self.assertEqual(self.clock()["time"], iso(later - timedelta(seconds=100)))
        r = self.client.put("/api/modules/M/clock", json={"time": "2026-11-20T01:02:03+07:00"})   # offset แปลงเป็น UTC
        self.assertEqual(r.json()["time"], "2026-11-19T18:02:03.000Z")
        r = self.client.post("/api/modules/M/clock/reset")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json(), {"state": "forward", "throttle": 1, "time": iso(self.wall.t), "label": "Real-Time"})

    def test_clock_invalid(self):
        self.open_module()
        before = self.clock()
        cases = [({"state": "fast"}, "state"), ({"state": 1}, "state"), ({"throttle": 0}, "throttle"),
                 ({"throttle": 101}, "throttle"), ({"throttle": "5"}, "throttle"), ({"throttle": True}, "throttle"),
                 ({"throttle": 2.0}, "throttle"), ({"time": "garbage"}, "time"), ({"time": 12345}, "time"),
                 ({"time": "2026-11-12T00:00:00"}, "time"),                                # ไม่มี timezone
                 ({"time": "1957-10-03T23:59:59.999Z"}, "time"), ({"time": "2101-01-01T00:00:00Z"}, "time"),
                 ({"state": "stop", "time": "0001-01-01T00:00:00Z"}, "time")]
        for body, field in cases:
            with self.subTest(body=body):
                self.assert_error(self.client.put("/api/modules/M/clock", json=body), 422, "CLOCK_INVALID", field)
                self.assertEqual(self.clock(), before)                     # ผิดแล้วไม่เปลี่ยนอะไรเลย
        for edge in ("1957-10-04T00:00:00.000Z", "2100-12-31T23:59:59.999Z"):
            r = self.client.put("/api/modules/M/clock", json={"state": "stop", "time": edge})
            self.assertEqual((r.status_code, r.json().get("time")), (200, edge))

    def test_clock_errors_from_clock_are_clock_invalid(self):
        self.open_module()
        for exc in (OverflowError("date value out of range"), ValueError("เวลาผิด")):
            with self.subTest(exc=type(exc).__name__), \
                    mock.patch.object(self.hub.get("M").clock, "set", side_effect=exc):
                self.assert_error(self.client.put("/api/modules/M/clock", json={"throttle": 2}), 422, "CLOCK_INVALID")

    def test_clock_requires_open_module(self):
        self.assert_error(self.client.get("/api/modules/M/clock"), 404, "NOT_FOUND", "M")
        self.assert_error(self.client.put("/api/modules/M/clock", json={"state": "stop"}), 404, "NOT_FOUND", "M")
        self.assert_error(self.client.post("/api/modules/M/clock/reset"), 404, "NOT_FOUND", "M")

    def test_track(self):
        self.open_module()
        r = self.client.get(f"/api/modules/M/track/{NORADS[0]}")
        self.assertEqual(r.status_code, 200, r.text)
        lines = r.json()["lines"]
        self.assertGreaterEqual(len(lines), 2)                          # ข้ามเส้น 180° จึงแยกเป็นหลายเส้น
        self.assertTrue(all(len(p) == 2 for line in lines for p in line))
        self.assert_error(self.client.get("/api/modules/M/track/11111"), 404, "NOT_FOUND", "11111")
        self.assert_error(self.client.get("/api/modules/M/track/abc"), 422, "REQUEST_INVALID", "norad")
        self.client.post("/api/modules/M/close")
        self.assert_error(self.client.get(f"/api/modules/M/track/{NORADS[0]}"), 404, "NOT_FOUND", "M")

    def test_skytrack(self):
        n = NORADS[0]
        self.open_module()
        self.client.put("/api/modules/M/clock", json={"state": "stop", "time": iso(peak(n) + timedelta(hours=-0.5))})
        self.assert_error(self.client.get(f"/api/modules/M/skytrack/{n}"), 404, "NOT_FOUND", str(n))   # ใต้ขอบฟ้า
        self.client.put("/api/modules/M/clock", json={"time": iso(peak(n))})
        r = self.client.get(f"/api/modules/M/skytrack/{n}")
        self.assertEqual(r.status_code, 200, r.text)
        points = r.json()["points"]
        self.assertGreater(len(points), 10)
        self.assertEqual(list(points[0]), ["t", "az", "el"])
        self.assert_error(self.client.get("/api/modules/M/skytrack/11111"), 404, "NOT_FOUND", "11111")
        self.client.post("/api/modules/M/close")
        self.assert_error(self.client.get(f"/api/modules/M/skytrack/{n}"), 404, "NOT_FOUND", "M")


# ---------------------------------------------------------------- อื่นๆ

class MiscApiTest(ApiTestBase):
    def test_meta(self):
        r = self.client.get("/api/meta")
        self.assertEqual(r.status_code, 200)
        meta = r.json()
        self.assertEqual(meta["list_columns"], [{"name": c, "hint": LIST_HINTS[c]} for c in LIST_COLUMNS])
        self.assertEqual(meta["single_fields"], [{"name": f, "hint": SINGLE_HINTS[f]} for f in SINGLE_FIELDS])
        self.assertEqual(meta["map_contents"], list(MAP_CONTENTS))
        self.assertEqual(meta["polar_contents"], list(POLAR_CONTENTS))
        self.assertEqual(meta["polar_orientations"], list(POLAR_ORIENTATIONS))
        self.assertEqual(meta["layout_presets"], [{"name": n, "code": c} for n, c in LAYOUT_PRESETS])
        self.assertEqual(meta["tle_groups"], list(TLE_GROUPS))
        self.assertEqual(meta["max_sats"], MAX_SATS)
        defaults = meta["module_defaults"]
        self.assertEqual(defaults["layout_code"], LAYOUT_PRESETS[0][1])
        self.assertEqual(defaults["refresh"]["data_ms"], 300)
        self.assertEqual(defaults["map"]["contents"]["Solar Terminator"], False)
        for key in ("list_default", "list_sort_default", "single_default", "refresh_labels", "refresh_ranges",
                    "map_track_orbits", "map_center_lon"):
            self.assertIn(key, meta)

    def test_license(self):
        r = self.client.get("/api/license")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.headers["content-type"].startswith("text/plain"))
        self.assertEqual(r.text, (REPO_ROOT / "License.txt").read_text(encoding="utf-8"))

    def test_license_missing_is_not_found(self):
        with mock.patch.object(app_module, "LICENSE_FILE", self.cfg.data_dir / "nope" / "License.txt"):
            self.assert_error(self.client.get("/api/license"), 404, "NOT_FOUND", None)

    def test_readme(self):
        """Help → Online help แสดง README ของโปรแกรมในหน้าเว็บ (ไม่มีลิงก์ออกนอก)"""
        r = self.client.get("/api/readme")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.headers["content-type"].startswith("text/plain"))
        self.assertEqual(r.text, (REPO_ROOT / "api-interop" / "gpredict-web" / "README.md").read_text(encoding="utf-8"))
        self.assertIn("Gpredict Web", r.text)

    def test_readme_missing_is_not_found(self):
        with mock.patch.object(app_module, "README_FILE", self.cfg.data_dir / "nope" / "README.md"):
            self.assert_error(self.client.get("/api/readme"), 404, "NOT_FOUND", None)

    def test_readme_not_utf8_is_not_found(self):
        bad = self.cfg.data_dir / "README.md"
        bad.parent.mkdir(parents=True, exist_ok=True)
        bad.write_bytes(b"\xff\xfe")
        with mock.patch.object(app_module, "README_FILE", bad):
            self.assert_error(self.client.get("/api/readme"), 404, "NOT_FOUND", None)

    def test_quit_calls_hook(self):
        self.assertEqual(self.quits, 0)
        r = self.client.post("/api/quit")
        self.assertEqual(r.status_code, 204)
        self.assertEqual(self.quits, 1)

    def test_quit_without_hook_is_conflict_not_204(self):
        """dev (uvicorn โดยตรง) ไม่มีตัวหยุด server: ตอบ 409 QUIT_UNAVAILABLE เพื่อให้หน้าเว็บไม่ขึ้นว่า server หยุดแล้ว"""
        client = self.enter(self.make_app(on_quit=None))
        with self.assertLogs("gpredict_web.app", "WARNING"):
            r = client.post("/api/quit")
        body = self.assert_error(r, 409, "QUIT_UNAVAILABLE", None)
        self.assertIn("python -m gpredict_web", body["text"])
        self.assertEqual(self.quits, 0)

    def test_static_served_when_dist_exists(self):
        dist = self.cfg.web_dist
        (dist / "assets").mkdir(parents=True)
        (dist / "index.html").write_text("<!doctype html><title>Gpredict Web</title>", encoding="utf-8")
        (dist / "assets" / "app.js").write_text("console.log(1)", encoding="utf-8")
        client = self.enter(self.make_app())
        r = client.get("/")
        self.assertEqual((r.status_code, r.text), (200, "<!doctype html><title>Gpredict Web</title>"))
        self.assertEqual(client.get("/assets/app.js").text, "console.log(1)")
        self.assertEqual(client.get("/modules/Amateur").text, r.text)        # path ของหน้าเว็บ: index.html
        self.assertEqual(client.get("/assets/../../secret").text, r.text)
        self.assert_error(client.get("/api/nope"), 404, "NOT_FOUND")            # API ไม่ตกไปที่ index.html
        self.assertEqual(client.get("/api/meta").status_code, 200)

    def test_no_static_without_dist(self):
        self.assert_error(self.client.get("/"), 404, "NOT_FOUND")
        self.assert_error(self.client.get("/api/nope"), 404, "NOT_FOUND")

    def test_malformed_requests_are_request_invalid(self):
        headers = {"content-type": "application/json"}
        self.assert_error(self.client.put("/api/modules/M", content=b"{not json", headers=headers), 422,
                          "REQUEST_INVALID", None)
        self.assert_error(self.client.put("/api/modules/M", content=b'{"name": ' + b"9" * 5000 + b"}", headers=headers),
                          422, "REQUEST_INVALID", None)                     # int เกิน 4300 หลัก
        self.assert_error(self.client.put("/api/modules/M", content=b'"\xff"', headers=headers), 422,
                          "REQUEST_INVALID", None)
        self.assert_error(self.client.put("/api/modules/M", json=[1, 2]), 422, "REQUEST_INVALID", None)
        self.assert_error(self.client.put("/api/qth/X", json="X"), 422, "REQUEST_INVALID", None)
        self.assert_error(self.client.put("/api/modules/M/clock", json=None), 422, "REQUEST_INVALID")
        self.assertEqual(self.store.list_modules(), [])

    def test_method_not_allowed_has_error_shape(self):
        r = self.client.post("/api/qth")
        self.assertEqual(r.status_code, 405)
        self.assertEqual(list(r.json()), ERROR_KEYS)


# ---------------------------------------------------------------- Preferences (งานย่อย 2: หัวข้อ 8.2 และ 9 ของ spec)

class PrefsApiTest(ApiTestBase):
    @property
    def prefs_file(self) -> Path:
        return self.cfg.data_dir / "preferences.json"

    def test_get_prefs_shape(self):
        r = self.client.get("/api/prefs")
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertEqual(list(body), ["values", "defaults", "user"])
        self.assertEqual(list(body["values"]), list(PREFS))
        self.assertEqual(body["values"], body["defaults"])
        self.assertEqual(body["user"], [])
        self.assertEqual(body["values"]["PREDICT/MINIMUM_ELEV"], 5)
        self.assertEqual(body["values"]["PREDICT/SINGLE_PASS_COL"], ["Time", "Az", "El", "Range", "Footp"])
        self.assertEqual(body["values"]["SKY_AT_GLANCE/COLOUR_01"], "#3c46c8")
        self.assertIs(body["values"]["PREDICT/USE_REAL_T0"], False)
        self.assertIs(self.app.state.prefs.get("PREDICT/USE_REAL_T0"), False)
        self.assertFalse(self.prefs_file.exists())

    def test_put_prefs_set_and_remove(self):
        r = self.client.put("/api/prefs", json={"set": {"PREDICT/MINIMUM_ELEV": 30, "SKY_AT_GLANCE/COLOUR_01": "#ABCDEF",
                                                        "PREDICT/SINGLE_PASS_COL": ["El", "Time"]}, "remove": []})
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertEqual(list(body), ["values", "defaults", "user"])
        self.assertEqual(body["values"]["PREDICT/MINIMUM_ELEV"], 30)
        self.assertEqual(body["values"]["SKY_AT_GLANCE/COLOUR_01"], "#abcdef")
        self.assertEqual(body["values"]["PREDICT/SINGLE_PASS_COL"], ["Time", "El"])
        self.assertEqual(body["defaults"]["PREDICT/MINIMUM_ELEV"], 5)
        self.assertEqual(body["user"], ["PREDICT/MINIMUM_ELEV", "PREDICT/SINGLE_PASS_COL", "SKY_AT_GLANCE/COLOUR_01"])
        self.assertEqual(json.loads(self.prefs_file.read_text(encoding="utf-8")),
                         {"version": 1, "values": {"PREDICT/MINIMUM_ELEV": 30, "PREDICT/SINGLE_PASS_COL": ["Time", "El"],
                                                   "SKY_AT_GLANCE/COLOUR_01": "#abcdef"}})
        self.assertEqual(self.client.get("/api/prefs").json(), body)
        self.assertEqual(self.app.state.prefs.get("PREDICT/MINIMUM_ELEV"), 30)
        r = self.client.put("/api/prefs", json={"set": {"PREDICT/LOOK_AHEAD": 7},
                                                "remove": ["PREDICT/MINIMUM_ELEV", "PREDICT/SINGLE_PASS_COL"]})
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertEqual(body["values"]["PREDICT/MINIMUM_ELEV"], 5)
        self.assertEqual(body["values"]["PREDICT/SINGLE_PASS_COL"], ["Time", "Az", "El", "Range", "Footp"])
        self.assertEqual(body["values"]["PREDICT/LOOK_AHEAD"], 7)
        self.assertEqual(body["user"], ["PREDICT/LOOK_AHEAD", "SKY_AT_GLANCE/COLOUR_01"])
        self.assertEqual(self.client.get("/api/prefs").json(), body)

    def test_put_prefs_set_and_remove_are_optional(self):
        self.assertEqual(self.client.put("/api/prefs", json={"set": {"PREDICT/LOOK_AHEAD": 7}}).status_code, 200)
        r = self.client.put("/api/prefs", json={"remove": ["PREDICT/LOOK_AHEAD"]})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["user"], [])
        self.assertEqual(self.client.put("/api/prefs", json={}).status_code, 200)

    def test_prefs_survive_a_restart(self):
        self.client.put("/api/prefs", json={"set": {"PREDICT/NUMBER_OF_PASSES": 25}})
        client = self.enter(self.make_app())
        self.assertEqual(client.get("/api/prefs").json()["values"]["PREDICT/NUMBER_OF_PASSES"], 25)

    def test_put_prefs_invalid_is_422_and_unchanged(self):
        self.client.put("/api/prefs", json={"set": {"PREDICT/MINIMUM_ELEV": 30}})
        before = self.client.get("/api/prefs").json()
        file_before = self.prefs_file.read_text(encoding="utf-8")
        r = self.client.put("/api/prefs", json={"set": {"PREDICT/NUMBER_OF_PASSES": 20, "PREDICT/LOOK_AHEAD": 15}})
        body = self.assert_error(r, 422, "PREFS_INVALID", "PREDICT/LOOK_AHEAD")
        self.assertEqual(body["text"], "Passes should occur within ต้องเป็นจำนวนเต็ม 1–14")
        for bad in ({"set": {"PREDICT/NOPE": 1}}, {"set": {"PREDICT/USE_REAL_T0": 1}},
                    {"set": {"SKY_AT_GLANCE/COLOUR_01": "red"}}, {"set": {"PREDICT/MULTI_PASS_COL": ["Bogus"]}},
                    {"remove": ["PREDICT/NOPE"]}, {"set": {"PREDICT/LOOK_AHEAD": 3}, "remove": ["PREDICT/LOOK_AHEAD"]}):
            with self.subTest(bad=bad):
                self.assert_error(self.client.put("/api/prefs", json=bad), 422, "PREFS_INVALID")
        self.assertEqual(self.client.get("/api/prefs").json(), before)
        self.assertEqual(self.prefs_file.read_text(encoding="utf-8"), file_before)

    def test_put_prefs_invalid_on_a_fresh_install_creates_no_file(self):
        self.assert_error(self.client.put("/api/prefs", json={"set": {"PREDICT/MINIMUM_ELEV": 0}}), 422, "PREFS_INVALID",
                          "PREDICT/MINIMUM_ELEV")
        self.assertFalse(self.prefs_file.exists())

    def test_put_prefs_body_not_object_is_422(self):
        for bad in ([1], "x", 5, None):
            with self.subTest(body=bad):
                self.assert_error(self.client.put("/api/prefs", json=bad), 422, "REQUEST_INVALID", None)
        self.assert_error(self.client.put("/api/prefs", content=b"{not json", headers={"content-type": "application/json"}),
                          422, "REQUEST_INVALID", None)
        for bad, obj in (({"set": [1]}, "set"), ({"set": "PREDICT/MINIMUM_ELEV"}, "set"), ({"set": None}, "set"),
                         ({"set": {}, "remove": "PREDICT/MINIMUM_ELEV"}, "remove"), ({"remove": [1]}, "remove"),
                         ({"remove": ["PREDICT/LOOK_AHEAD", None]}, "remove"), ({"remove": {"PREDICT/LOOK_AHEAD": 1}}, "remove"),
                         ({"remove": None}, "remove")):
            with self.subTest(body=bad):
                self.assert_error(self.client.put("/api/prefs", json=bad), 422, "PREFS_INVALID", obj)
        self.assertFalse(self.prefs_file.exists())

    def test_put_prefs_twilight_threshold_changes_the_open_module_tick(self):
        """Hub ของ app ได้ Prefs ตัวเดียวกับ /api/prefs: ตั้ง Twilight threshold แล้ว tick ถัดไปของ module ที่เปิดอยู่ใช้ค่าใหม่"""
        dusk, t = dusk_station(NORADS[0], -8.0)                          # ดวงอาทิตย์ที่ QTH −8° ดาวอยู่เหนือขอบฟ้า
        self.store.put_qth(dusk)
        self.put_module(qth="DUSK", sats=[NORADS[0]])
        self.wall.t = t
        self.open_module()
        self.assertEqual(self.hub.get("M").tick()["sats"][0]["vis"], "V")        # ค่าตั้งต้น −6
        r = self.client.put("/api/prefs", json={"set": {"PREDICT/TWILIGHT_THRESHOLD": -18}, "remove": []})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(self.hub.get("M").tick()["sats"][0]["vis"], "D")        # −8 > −18

    def test_prefs_file_with_bad_value_does_not_stop_the_server(self):
        """แก้ preferences.json ด้วยมือจนค่าผิด: server เปิดได้ ใช้ค่าตั้งต้นของ key นั้นและบันทึก log"""
        self.prefs_file.write_text(json.dumps({"version": 1, "values": {"PREDICT/MINIMUM_ELEV": 500,
                                                                       "PREDICT/LOOK_AHEAD": 7}}), encoding="utf-8")
        with self.assertLogs("gpredict_web.prefs", "WARNING"):
            client = self.enter(self.make_app())
        body = client.get("/api/prefs").json()
        self.assertEqual((body["values"]["PREDICT/MINIMUM_ELEV"], body["values"]["PREDICT/LOOK_AHEAD"]), (5, 7))
        self.assertEqual(body["user"], ["PREDICT/LOOK_AHEAD"])


# ---------------------------------------------------------------- Host และ Origin (ของเรา: กันเว็บอื่นสั่ง server)

class HostOriginTest(ApiTestBase):
    """Host ต้องเป็นเครื่องตัวเอง, testserver หรือ --host ที่ไม่ใช่เครื่องตัวเอง (กัน DNS rebinding)
    คำขอที่เปลี่ยนสถานะและ WebSocket ที่มี Origin ต้องมาจากชื่อเดียวกัน (กันหน้าเว็บอื่นส่ง POST หรือเปิด socket)
    คำขอที่ไม่มี Origin (curl, TestClient) ผ่าน"""

    FOREIGN = "http://evil.example"

    def test_local_hosts_allowed(self):
        for host in ("127.0.0.1:8740", "127.0.0.1", "localhost", "LOCALHOST:8740", "[::1]:8740", "testserver"):
            with self.subTest(host=host):
                self.assertEqual(self.client.get("/api/meta", headers={"host": host}).status_code, 200)

    def test_foreign_host_rejected(self):
        for host in ("evil.example", "evil.example:8740", "127.0.0.1.evil.example", "localhost.evil.example:80",
                     "192.168.1.5:8740", "[::1", "", "evil.example@localhost", "localhost/x", "localhost:abc"):
            with self.subTest(host=host):
                self.assert_error(self.client.get("/api/meta", headers={"host": host}), 403, "FORBIDDEN_HOST", None)
        self.assert_error(self.client.post("/api/quit", headers={"host": "evil.example"}), 403, "FORBIDDEN_HOST", None)
        self.assert_error(self.client.get("/", headers={"host": "evil.example"}), 403, "FORBIDDEN_HOST", None)
        self.assertEqual(self.quits, 0)

    def test_foreign_origin_rejected_for_state_changing_requests(self):
        for origin in (self.FOREIGN, "http://evil.example:8740", "null", "http://127.0.0.1.evil.example",
                       "http://evil.example@localhost", "file://localhost", "chrome-extension://localhost"):
            with self.subTest(origin=origin):
                h = {"origin": origin}
                self.assert_error(self.client.post("/api/quit", headers=h), 403, "FORBIDDEN_ORIGIN", None)
                self.assert_error(self.client.post("/api/tle/update", headers=h), 403, "FORBIDDEN_ORIGIN", None)
                self.assert_error(self.client.put("/api/modules/M", json=self.module_body(), headers=h), 403,
                                  "FORBIDDEN_ORIGIN", None)
                self.assert_error(self.client.delete("/api/qth/OTHER", headers=h), 403, "FORBIDDEN_ORIGIN", None)
        self.assertEqual(self.quits, 0)
        self.assertEqual(self.opener.urls, [])
        self.assertEqual(self.store.list_modules(), [])
        self.assertEqual(self.store.qth_names(), ["ORIGIN", "OTHER"])

    def test_local_origin_allowed(self):
        for origin in ("http://127.0.0.1:8740", "http://localhost:5173", "http://[::1]:8740", "http://testserver"):
            with self.subTest(origin=origin):
                self.assertEqual(self.client.post("/api/quit", headers={"origin": origin}).status_code, 204)
        self.assertEqual(self.quits, 4)

    def test_safe_methods_with_foreign_origin_allowed(self):
        """GET อ่านอย่างเดียว และ browser ไม่ให้หน้าเว็บอื่นอ่านคำตอบ (ไม่มี CORS header)"""
        r = self.client.get("/api/meta", headers={"origin": self.FOREIGN})
        self.assertEqual(r.status_code, 200)
        self.assertNotIn("access-control-allow-origin", r.headers)

    def test_websocket_foreign_origin_or_host_closes_1008(self):
        self.put_module(refresh={"data_ms": 100})
        self.open_module()
        for headers in ({"origin": self.FOREIGN}, {"origin": "null"}, {"host": "evil.example"}):
            with self.subTest(headers=headers), self.assertRaises(WebSocketDisconnect) as ctx:
                with self.client.websocket_connect("/ws/modules/M", headers=headers):
                    pass
            self.assertEqual(ctx.exception.code, 1008)
        self.assertEqual(self.app.state.ticks.producers(), [])
        with self.client.websocket_connect("/ws/modules/M", headers={"origin": "http://localhost:5173"}) as ws:
            self.assertEqual(ws.receive_json()["status"], "ok")

    def test_allow_list_is_a_create_app_parameter(self):
        client = self.enter(self.make_app(allowed_hosts=host_allow_list("192.168.1.5")))
        h = {"host": "192.168.1.5:8740", "origin": "http://192.168.1.5:8740"}
        self.assertEqual(client.get("/api/meta", headers={"host": h["host"]}).status_code, 200)
        self.assertEqual(client.post("/api/quit", headers=h).status_code, 204)
        self.assertEqual(client.get("/api/meta", headers={"host": "localhost"}).status_code, 200)
        self.assert_error(client.get("/api/meta", headers={"host": "evil.example"}), 403, "FORBIDDEN_HOST", None)
        self.assert_error(self.client.get("/api/meta", headers={"host": h["host"]}), 403, "FORBIDDEN_HOST", None)

    def test_default_allow_list_has_no_testserver(self):
        """allow list ตั้งต้นของ server จริงไม่มี testserver (test ส่งเองผ่าน allowed_hosts)"""
        client = self.enter(create_app(self.cfg, start_background=False, ephem=self.ephem))
        self.assert_error(client.get("/api/meta"), 403, "FORBIDDEN_HOST", None)          # Host ของ TestClient = testserver
        self.assert_error(client.get("/api/meta", headers={"host": "testserver"}), 403, "FORBIDDEN_HOST", None)
        for host in ("127.0.0.1:8740", "localhost:8740", "[::1]:8740"):
            self.assertEqual(client.get("/api/meta", headers={"host": host}).status_code, 200, host)
        self.assertEqual(client.app.state.allowed_hosts, {"127.0.0.1", "localhost", "::1"})

    def test_host_allow_list(self):
        base = {"127.0.0.1", "localhost", "::1"}
        self.assertEqual(host_allow_list(), base)
        self.assertEqual(host_allow_list("localhost"), base)
        self.assertEqual(host_allow_list("[::1]"), base)
        self.assertEqual(host_allow_list("0.0.0.0"), base | {"0.0.0.0"})
        self.assertEqual(host_allow_list("GS.Example"), base | {"gs.example"})


# ---------------------------------------------------------------- ตอนเปิดและปิด server

class LifespanTest(ApiTestBase):
    """start_background=True: prune ช่วงเก่า, bootstrap, เปิด module ใน session.json; ตอนปิดปิด runtime และ EphemManager"""

    def setUp(self):
        self.cfg = temp_config(self)
        self.fake = OrbitPropagate()
        self.ephem = EphemManager(self.cfg, propagate_fn=self.fake, find_console=lambda: Path("/fake/GmatConsole"),
                                  start_worker=False)
        self.addCleanup(self.ephem.close)
        self.wall = FakeNow(T0)
        self.store = Store(self.cfg.data_dir)
        self.opener = GroupOpener()
        self.quits = 0

    def start(self, **kw) -> TestClient:
        self.app = self.make_app(start_background=True, **kw)
        return self.enter(self.app)

    def test_first_start_offline(self):
        """Review Focus 1: ไม่มีเน็ตและไม่มี OMM cache ได้ THBK, ไม่มี module และข้อความไทยให้ Update TLE"""
        with mock.patch.object(self.ephem, "prune", wraps=self.ephem.prune) as prune:
            client = self.start()
        prune.assert_called_once_with(T0)
        qth = client.get("/api/qth").json()
        self.assertEqual((qth["default"], [q["name"] for q in qth["qth"]]), ("THBK", ["THBK"]))
        modules = client.get("/api/modules").json()
        self.assertEqual((modules["modules"], modules["open"]), ([], []))
        need = [m for m in modules["messages"] if m["code"] == "TLE_UPDATE_NEEDED"]
        self.assertEqual(len(need), 1)
        self.assertIn("Update TLE data from network", need[0]["text"])

    def test_first_start_creates_and_opens_amateur(self):
        self.opener.bodies["amateur"] = json.dumps(SAMPLE).encode("utf-8")
        client = self.start()
        self.assertEqual(client.get("/api/modules").json(), {"modules": ["Amateur"], "open": ["Amateur"], "messages": []})
        self.assertIsNotNone(self.app.state.hub.get("Amateur"))
        self.assertEqual(client.get("/api/modules/Amateur").json()["qth"], None)

    def test_restart_after_deleting_every_module_does_not_bring_amateur_back(self):
        self.opener.bodies["amateur"] = json.dumps(SAMPLE).encode("utf-8")
        client = self.start()
        self.assertEqual(client.get("/api/modules").json()["modules"], ["Amateur"])
        self.assertEqual(client.delete("/api/modules/Amateur").status_code, 204)
        self.opener.urls.clear()
        client = self.start()                                               # เริ่ม server ใหม่บน data dir เดิม
        self.assertEqual(client.get("/api/modules").json(), {"modules": [], "open": [], "messages": []})
        self.assertEqual(self.opener.urls, [])

    def test_offline_first_start_then_online_start_creates_amateur(self):
        client = self.start()
        self.assertEqual(client.get("/api/modules").json()["modules"], [])
        self.opener.bodies["amateur"] = json.dumps(SAMPLE).encode("utf-8")
        client = self.start()
        self.assertEqual(client.get("/api/modules").json(), {"modules": ["Amateur"], "open": ["Amateur"], "messages": []})

    def test_startup_message_cleared_after_tle_update(self):
        client = self.start()
        self.assertTrue(client.get("/api/modules").json()["messages"])
        client.post("/api/tle/update")
        self.assertEqual(client.get("/api/modules").json()["messages"], [])

    def test_restart_reopens_session_and_drops_broken_module(self):
        self.store.put_qth(ORIGIN)
        self.store.set_default_qth("ORIGIN")
        self.write_satdb([record(n) for n in NORADS])
        for name in ("A", "B"):
            self.store.put_module(module_from_dict({"name": name, "satellites": list(NORADS)}, None, None))
        (self.cfg.data_dir / "modules" / "Broken.json").write_text("{", encoding="utf-8")
        self.store.set_session(["B", "Broken", "A"])
        with self.assertLogs("gpredict_web.app", "WARNING") as logs:
            client = self.start()
        self.assertIn("Broken", "\n".join(logs.output))
        self.assertEqual(self.opener.urls, [])                              # มี module แล้ว: ไม่ bootstrap module
        self.assertEqual(self.app.state.hub.open_names(), ["B", "A"])
        body = client.get("/api/modules").json()
        self.assertEqual(body["open"], ["B", "A"])
        self.assertEqual(self.store.session(), ["B", "A"])
        self.assertEqual([(m["code"], m["object"]) for m in body["messages"]], [("MODULE_INVALID", "Broken")])

    def test_shutdown_closes_runtimes_and_ephem(self):
        self.opener.bodies["amateur"] = json.dumps(SAMPLE).encode("utf-8")
        with mock.patch.object(self.ephem, "close", wraps=self.ephem.close) as close:
            client = TestClient(self.make_app(start_background=True))
            with client:
                rt = client.app.state.hub.get("Amateur")
                self.assertFalse(rt.closed)
            close.assert_called_once_with()
        self.assertTrue(rt.closed)
        self.assertEqual(self.store.session(), ["Amateur"])                  # ปิด server ไม่ใช่ปิด module: เปิดค้างไว้ครั้งหน้า

    def test_no_background_work_without_start_background(self):
        with mock.patch.object(self.ephem, "prune") as prune:
            self.app = self.make_app(start_background=False)
            client = self.enter(self.app)
        prune.assert_not_called()
        self.assertEqual(client.get("/api/qth").json(), {"qth": [], "default": None, "messages": []})
        self.assertEqual(self.opener.urls, [])


if __name__ == "__main__":
    unittest.main()
