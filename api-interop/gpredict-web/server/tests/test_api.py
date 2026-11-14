"""REST API (หัวข้อ 7.3 และ 7.4 ของ spec) ด้วย TestClient: EphemManager จริงกับ propagate ปลอม (start_worker=False แล้ว drain()),
นาฬิกาเครื่องปลอม, opener ปลอม (ห้ามใช้เน็ต) และ data dir ชั่วคราว"""

import asyncio
import json
import threading
import time
import unittest
from dataclasses import asdict
from datetime import date, datetime, timedelta
from pathlib import Path
from unittest import mock
from urllib.error import URLError

from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from gpredict_web import app as app_module
from gpredict_web.app import create_app, host_allow_list
from gpredict_web.clock import CLOCK_TIME_TEXT
from gpredict_web.config import MAX_SATS, TLE_GROUPS
from gpredict_web.ephem import EphemManager
from gpredict_web.module import (LAYOUT_PRESETS, LIST_COLUMNS, LIST_HINTS, MAP_CONTENTS, MODULE_KEYS, PAGE_PATHS,
                                 POLAR_CONTENTS, POLAR_ORIENTATIONS, SINGLE_FIELDS, SINGLE_HINTS, module_from_dict,
                                 module_to_dict)
from gpredict_web.observe import qth_geo
from gpredict_web.passes import find_passes
from gpredict_web.prefs import PREFS
from gpredict_web.store import Store
from gpredict_web.trsp import MODES_URL, TRANSMITTERS_URL
from gnss_predict.config import REPO_ROOT
from gnss_predict.errors import GmatRunError
from tests.helpers import TEST_HOSTS, FakeNow, half_pass_s, temp_config
from tests.test_bootstrap import SAMPLE, _Resp
from tests.test_pass_service import GEO, HIDDEN, WOBBLE, PassPropagate, is_day_job, pass_records
from tests.test_runtime import ISO_MS, NORADS, ORIGIN, OTHER, T0, OrbitPropagate, dusk_station, iso, peak, record
from tests.fake_hamlib import FakeHamlib
from tests.test_trsp import FakeSatnogs

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


class HamlibThread:
    """rigctld/rotctld ปลอม (FakeHamlib) ใน event loop และ thread ของตัวเอง: อยู่ได้นอกเหนือ loop ของ TestClient
    จึงเห็นคำสั่ง S และ q ที่ส่งตอน server ปิด (หลังออกจาก with TestClient)"""

    def __init__(self, testcase: unittest.TestCase):
        self.fake = FakeHamlib()
        self._loop = asyncio.new_event_loop()
        self._thread = threading.Thread(target=self._loop.run_forever, daemon=True)
        self._thread.start()
        testcase.addCleanup(self.close)
        self.port = self._run(self.fake.start())

    @property
    def log(self) -> list[bytes]:
        return list(self.fake.log)

    def _run(self, coro):
        return asyncio.run_coroutine_threadsafe(coro, self._loop).result(5)

    def close(self) -> None:
        self._run(self.fake.stop())
        self._loop.call_soon_threadsafe(self._loop.stop)
        self._thread.join(5)
        self._loop.close()


def wait_until(predicate, timeout: float = 3.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.01)
    return predicate()


class ApiTestBase(unittest.TestCase):
    """app ที่มี QTH ORIGIN (สถานีตั้งต้น) และ OTHER, ดาวสังเคราะห์ NORADS ในดัชนี, ยังไม่มี module"""

    start_background = False
    ephem_worker = False                  # True: EphemManager มี worker thread ของคิว GMAT (ห้าม drain)

    def setUp(self):
        self.cfg = temp_config(self)
        self.fake = self.make_propagate()
        self.ephem = EphemManager(self.cfg, propagate_fn=self.fake, find_console=lambda: Path("/fake/GmatConsole"),
                                  start_worker=self.ephem_worker)
        self.addCleanup(self.ephem.close)
        self.wall = FakeNow(T0)
        self.store = Store(self.cfg.data_dir)
        self.store.put_qth(ORIGIN)
        self.store.put_qth(OTHER)
        self.store.set_default_qth("ORIGIN")
        self.write_satdb(self.satdb_records())
        self.opener = GroupOpener()
        self.quits = 0
        self.app = self.make_app()
        self.client = self.enter(self.app)

    def make_propagate(self):
        return OrbitPropagate()

    def satdb_records(self) -> list:
        return [record(n) for n in NORADS]

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

    # ---- PUT /api/qth/batch (OK ของ Preferences → Ground Stations)

    def station(self, name: str, **over) -> dict:
        return {"name": name, "location": f"{name} town", "lat_deg": 1.5, "lon_deg": 2.5, "alt_m": 3.0, **over}

    def put_batch(self, stations, default, query: str = ""):
        return self.client.put(f"/api/qth/batch{query}", json={"stations": stations, "default": default})

    def qth_state(self) -> dict:
        """ทุกอย่างที่ batch แตะได้: ไฟล์ใต้ data dir ทั้งหมด (สถานี, สถานีตั้งต้น, module) และรายการจาก GET /api/qth"""
        files = {str(p.relative_to(self.cfg.data_dir)): p.read_bytes()
                 for p in sorted(self.cfg.data_dir.rglob("*")) if p.is_file()}
        return {"files": files, "listed": self.client.get("/api/qth").json()}

    def test_batch_replaces_whole_set(self):
        edited, new = self.station("OTHER", location="Moved", alt_m=310), self.station("NEW", description="สถานีใหม่")
        r = self.put_batch([new, edited], "NEW")                                     # ลำดับในคำขอไม่สำคัญ: คำตอบเรียงตามชื่อ
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertEqual(list(body), ["qth", "default", "changed_modules"])
        self.assertEqual(body["qth"], [{"weather_station": "", **new, "alt_m": 3.0},
                                       {"description": "", "weather_station": "", **edited, "alt_m": 310.0}])
        self.assertEqual((body["default"], body["changed_modules"]), ("NEW", []))
        listed = self.client.get("/api/qth").json()
        self.assertEqual((listed["qth"], listed["default"]), (body["qth"], "NEW"))
        self.assertEqual(self.store.qth_names(), ["NEW", "OTHER"])                   # ORIGIN หายไป

    def test_batch_delete_in_use_and_default(self):
        """Review Focus 4: ลบสถานีตั้งต้นพร้อมสถานีที่ module ที่เปิดอยู่ใช้ใน OK ครั้งเดียว ไม่ 500 module เปลี่ยนเป็น ** DEFAULT **
        แต่ module ที่เปิดอยู่ยังทำงานด้วยสถานีเดิม (ไม่ hub.reload) จนถูกเปิดใหม่"""
        self.put_module()                                                            # M ใช้ ORIGIN (ตั้งต้น)
        self.put_module("N", qth=None)                                               # N ใช้ ** DEFAULT ** (= ORIGIN)
        self.put_module("K", qth="OTHER")                                            # K ใช้สถานีที่ยังอยู่
        self.open_module()
        rt = self.hub.get("M")
        self.assertEqual(self.hub.get("M").tick()["qth"]["name"], "ORIGIN")
        kept = (self.cfg.data_dir / "modules" / "K.json").read_bytes()
        with self.assertLogs("gpredict_web.store", "ERROR") as logs:
            r = self.put_batch([self.station("OTHER", lat_deg=10.0, lon_deg=20.0)], "OTHER")
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual((r.json()["default"], r.json()["changed_modules"]), ("OTHER", ["M"]))
        self.assertEqual(len(logs.records), 1)
        self.assertIn("M", logs.records[0].args)
        self.assertIn("ORIGIN", logs.records[0].args)
        self.assertIsNone(self.client.get("/api/modules/M").json()["qth"])           # ไฟล์ M เป็น ** DEFAULT ** แล้ว
        self.assertIsNone(self.store.get_module_own("M")["qth"])
        self.assertEqual((self.cfg.data_dir / "modules" / "K.json").read_bytes(), kept)
        self.assertIs(self.hub.get("M"), rt)                                         # runtime เดิมยังอยู่ ไม่ถูกสร้างใหม่
        self.assertEqual(rt.qth, ORIGIN)
        self.assertEqual(rt._q, qth_geo(ORIGIN))                                     # ยังใช้ QthGeo ของสถานีเดิม
        self.assertEqual(rt.tick()["qth"]["name"], "ORIGIN")
        self.assertEqual(self.client.get("/api/modules").json()["open"], ["M"])
        self.assertEqual(self.client.post("/api/modules/M/close").status_code, 200)   # เปิดใหม่ = ใช้สถานีตั้งต้นใหม่
        self.open_module()
        self.assertEqual(self.hub.get("M").tick()["qth"]["name"], "OTHER")

    def test_batch_dry_run_changes_nothing(self):
        self.put_module("N", qth="ORIGIN")
        before = self.qth_state()
        body = [self.station("OTHER", lat_deg=10.0, lon_deg=20.0), self.station("NEW")]
        with self.assertNoLogs("gpredict_web.store", "ERROR"):
            dry = self.put_batch(body, "NEW", "?dry_run=true")
        self.assertEqual(dry.status_code, 200, dry.text)
        self.assertEqual((dry.json()["default"], dry.json()["changed_modules"]), ("NEW", ["N"]))
        self.assertEqual(self.qth_state(), before)
        with self.assertLogs("gpredict_web.store", "ERROR"):
            real = self.put_batch(body, "NEW", "?dry_run=false")
        self.assertEqual(real.status_code, 200, real.text)
        self.assertEqual(real.json(), dry.json())                                    # คำตอบรูปเดียวกับของจริง
        self.assertNotEqual(self.qth_state(), before)
        self.assertEqual(self.store.qth_names(), ["NEW", "OTHER"])

    def test_batch_invalid_is_422_and_changes_nothing(self):
        self.put_module("N", qth="ORIGIN")
        before = self.qth_state()
        ok = self.station("A1")
        for stations, default, code, obj in (
                ([], "A1", "QTH_LAST", "stations"),
                ([ok, self.station("a1")], "A1", "QTH_INVALID", "name"),             # ชื่อซ้ำไม่สนตัวพิมพ์
                ([ok, ok], "A1", "QTH_INVALID", "name"),
                ([ok], "ORIGIN", "QTH_INVALID", "default"),                          # ไม่อยู่ในรายการ
                ([ok], "a1", "QTH_INVALID", "default"),
                ([ok], None, "QTH_INVALID", "default"),
                ([ok], ["A1"], "QTH_INVALID", "default"),
                ([ok, self.station("B2", lat_deg=91)], "A1", "QTH_INVALID", "lat_deg"),
                ([ok, self.station("B2", alt_m="high")], "A1", "QTH_INVALID", "alt_m"),
                ([ok, self.station("bad name")], "A1", "QTH_INVALID", "name"),
                ([ok, {"location": "no name"}], "A1", "QTH_INVALID", "name"),
                ([ok, "B2"], "A1", "QTH_INVALID", None),
                ("A1", "A1", "QTH_INVALID", "stations"),
                (None, "A1", "QTH_INVALID", "stations")):
            with self.subTest(stations=stations, default=default):
                real = self.put_batch(stations, default)
                self.assert_error(real, 422, code, obj)
                dry = self.put_batch(stations, default, "?dry_run=true")
                self.assertEqual((dry.status_code, dry.json()), (422, real.json()))   # dry run ตอบ error เดียวกับของจริง
                self.assertEqual(self.qth_state(), before)
        self.assert_error(self.client.put("/api/qth/batch", json={"default": "A1"}), 422, "QTH_INVALID", "stations")
        self.assert_error(self.client.put("/api/qth/batch", json={"stations": [ok]}), 422, "QTH_INVALID", "default")
        self.assert_error(self.client.put("/api/qth/batch", json=[ok]), 422, "REQUEST_INVALID", None)
        self.assert_error(self.client.put("/api/qth/batch?dry_run=maybe", json={"stations": [ok], "default": "A1"}), 422,
                          "REQUEST_INVALID", "dry_run")
        self.assertEqual(self.qth_state(), before)

    def test_batch_error_names_the_station(self):
        r = self.put_batch([self.station("A1"), self.station("B2", lat_deg=91)], "A1")
        body = self.assert_error(r, 422, "QTH_INVALID", "lat_deg")
        self.assertIn("B2", body["text"])

    def test_batch_route_is_not_taken_as_a_station_name(self):
        """/api/qth/batch ต้องมาก่อน /api/qth/{name}: PUT ไม่ถูกตีว่าเป็นสถานีชื่อ batch"""
        self.assertEqual(self.put_batch([self.station("A1")], "A1").status_code, 200)
        self.assertEqual(self.store.qth_names(), ["A1"])
        self.assert_error(self.client.get("/api/qth/batch"), 404, "NOT_FOUND", "batch")

    def test_delete_endpoint_still_refuses_in_use(self):
        """DELETE /api/qth/{name} ยังเป็นแบบ core (409 IN_USE) มีแต่ batch ที่ทำตาม Gpredict"""
        self.put_module(qth="OTHER")
        self.put_module("D", qth=None)                                               # ใช้สถานีตั้งต้น (ORIGIN)
        before = self.qth_state()
        self.assert_error(self.client.delete("/api/qth/OTHER"), 409, "IN_USE", "OTHER")
        self.assert_error(self.client.delete("/api/qth/ORIGIN"), 409, "IN_USE", "ORIGIN")
        self.assertEqual(self.qth_state(), before)
        with self.assertLogs("gpredict_web.store", "ERROR"):
            r = self.put_batch([self.station("ORIGIN")], "ORIGIN")                  # batch ลบ OTHER ที่ module M ใช้ได้
        self.assertEqual((r.status_code, r.json()["changed_modules"]), (200, ["M"]))


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


class TrspApiTest(ApiTestBase):
    """Edit -> Update transponder data และรายการ transponder ของดาว (spec §7, §8) opener เป็น SatNOGS ปลอมจาก fixture"""

    UPDATE_KEYS = ["status", "cached", "fetched_at", "satellites", "messages"]
    TRSP_KEYS = ["name", "up_low", "up_high", "down_low", "down_high", "invert", "mode", "baud"]

    def make_app(self, **kw):
        self.satnogs = FakeSatnogs()
        return super().make_app(opener=self.satnogs, **kw)

    def test_trsp_update_route(self):
        self.satnogs.on_call = lambda request: self.assertTrue(self.app.state.trsp_lock.locked())   # ทีละงาน
        r = self.client.post("/api/trsp/update")
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertEqual(list(body), self.UPDATE_KEYS)
        self.assertEqual((body["status"], body["cached"], body["fetched_at"], body["satellites"]),
                         ("Finished", False, iso(T0), 3))
        self.assertRegex(body["fetched_at"], ISO_MS)
        self.assertEqual([m["code"] for m in body["messages"]], ["TRSP_UPDATED"])
        for m in body["messages"]:
            self.assertEqual(list(m), ERROR_KEYS)
            self.assertRegex(m["text"], r"[ก-๙]")
        self.assertEqual(len(self.satnogs.calls), 2)
        self.assertTrue((self.cfg.data_dir / "trsp" / "25544.json").is_file())

        again = self.client.post("/api/trsp/update").json()                      # ภายใน 2 ชม.: ใช้ cache ไม่ส่ง request
        self.assertEqual((again["status"], again["cached"], again["fetched_at"], again["satellites"]),
                         ("Finished", True, iso(T0), 3))
        self.assertEqual([m["code"] for m in again["messages"]], ["TRSP_RATE_LIMITED_LOCAL"])
        self.assertEqual(len(self.satnogs.calls), 2)

        self.wall.advance(2 * 3600 + 1)
        third = self.client.post("/api/trsp/update").json()
        self.assertEqual((third["cached"], len(self.satnogs.calls)), (False, 4))

    def test_overlapping_trsp_updates_run_one_at_a_time(self):
        second: list = []
        workers: list[threading.Thread] = []

        def start_second_request(request):
            if not workers:                                        # ระหว่างที่คำขอแรกกำลังดึง modes
                workers.append(threading.Thread(target=lambda: second.append(self.client.post("/api/trsp/update").json())))
                workers[0].start()
                time.sleep(0.3)                                    # ให้คำขอที่สองถึง server และรอ lock

        self.satnogs.on_call = start_second_request
        first = self.client.post("/api/trsp/update").json()
        workers[0].join(10)
        self.assertEqual((first["cached"], first["satellites"]), (False, 3))
        self.assertEqual(len(second), 1)
        self.assertEqual((second[0]["cached"], second[0]["satellites"]), (True, 3))     # รอคำขอแรกจบแล้วได้ข้อมูลจาก cache
        self.assertEqual(len(self.satnogs.calls), 2)                                    # ไม่ส่ง request ซ้ำ

    def test_trsp_update_failure_is_finished_with_a_warning(self):
        self.client.post("/api/trsp/update")
        before = self.client.get("/api/trsp/25544").json()
        self.wall.advance(3 * 3600)
        self.satnogs.replies[TRANSMITTERS_URL] = b"<html>"
        with self.assertLogs("gpredict_web.trsp", "WARNING"):
            r = self.client.post("/api/trsp/update")
        self.assertEqual(r.status_code, 200, r.text)                              # Gpredict แสดง "Finished" แม้ดึงไม่ได้
        body = r.json()
        self.assertEqual((body["status"], body["cached"], body["fetched_at"], body["satellites"]),
                         ("Finished", True, iso(T0), 0))
        self.assertEqual([(m["code"], m["level"]) for m in body["messages"]], [("TRSP_DOWNLOAD_FAILED", "warning")])
        self.assertRegex(body["messages"][0]["text"], r"[ก-๙]")
        self.assertEqual(self.client.get("/api/trsp/25544").json(), before)       # transponder เดิมอยู่ครบ

    def test_trsp_update_failure_without_any_data(self):
        self.satnogs.replies[MODES_URL] = URLError("ไม่มีเน็ตใน test")
        with self.assertLogs("gpredict_web.trsp", "WARNING"):
            body = self.client.post("/api/trsp/update").json()
        self.assertEqual((body["status"], body["cached"], body["fetched_at"], body["satellites"]),
                         ("Finished", True, None, 0))
        self.assertEqual(body["messages"][0]["code"], "TRSP_DOWNLOAD_FAILED")

    def test_trsp_update_uses_only_satnogs_with_no_user_data(self):
        self.client.post("/api/trsp/update", headers={"Origin": "http://localhost", "Cookie": "a=b"})
        self.assertEqual([r.header_items() for r, _ in self.satnogs.calls], [[("User-agent", "gpredict-web")]] * 2)

    def test_get_trsp_route_shape(self):
        empty = self.client.get("/api/trsp/25544")
        self.assertEqual(empty.status_code, 200, empty.text)
        self.assertEqual(empty.json(), {"norad": 25544, "transponders": []})        # ไม่มีไฟล์ -> รายการว่าง ไม่ใช่ 404
        self.client.post("/api/trsp/update")
        body = self.client.get("/api/trsp/25544").json()
        self.assertEqual(list(body), ["norad", "transponders"])
        self.assertEqual(body["norad"], 25544)
        self.assertEqual(len(body["transponders"]), 4)
        for t in body["transponders"]:
            self.assertEqual(list(t), self.TRSP_KEYS)
        first = body["transponders"][0]
        self.assertEqual((first["name"], first["mode"], first["invert"], first["baud"]),
                         ("Mode V/U FM Voice Repeater", "FM", False, 0))
        self.assertEqual((first["up_low"], first["up_high"]), (145_990_000, 145_990_000))   # ค่าเดียวถูกคัดลอกตอนอ่าน (ref-R §10.1)
        self.assertEqual((first["down_low"], first["down_high"]), (437_800_000, 437_800_000))
        self.assertEqual(self.client.get("/api/trsp/43770").json()["transponders"][0]["invert"], True)

    def test_get_trsp_route_rejects_a_non_number(self):
        self.assert_error(self.client.get("/api/trsp/abc"), 422, "REQUEST_INVALID", "norad")
        self.assert_error(self.client.get("/api/trsp/update"), 422, "REQUEST_INVALID", "norad")


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
        self.put_module(qth="OTHER", refresh={"data_ms": 1000}, pin=["refresh.data_ms"])
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
        self.put_module(qth="ORIGIN", refresh={"data_ms": 100}, pin=["refresh.data_ms"])
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


class ModuleInheritanceApiTest(ApiTestBase):
    """ไฟล์ module เก็บเฉพาะค่าที่ตั้งเอง: PUT /api/modules/{name} ตรึงหรือปล่อยค่าด้วย pin/unpin (decision 3), clone และ meta
    (spec งานย่อย 4 §9.1)"""

    MODULE_ONLY_KEYS = {"version", "name", "qth", "satellites", "list_sort", "single", "footprint_off", "ground_track",
                        "sky_track", "window"}

    def file_json(self, name: str = "M") -> dict:
        return json.loads((self.cfg.data_dir / "modules" / f"{name}.json").read_text(encoding="utf-8"))

    def set_global(self, key: str, value) -> None:
        r = self.client.put("/api/prefs", json={"set": {key: value}})
        self.assertEqual(r.status_code, 200, r.text)

    def get(self, name: str = "M") -> dict:
        r = self.client.get(f"/api/modules/{name}")
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()

    def test_put_module_without_pin_keeps_inheritance(self):
        self.put_module()
        full = self.get()
        full["layout_code"] = "1;0;2;0;1"                                   # ต่างจากค่ารวม แต่ไม่ได้ตรึง
        full["map"]["center_lon"] = 50
        r = self.client.put("/api/modules/M", json=full)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["layout_code"], LAYOUT_PRESETS[0][1])      # คำตอบคือค่าที่ใช้จริง
        self.assertEqual(r.json(), self.get())
        self.assertNotIn("layout_code", self.file_json())
        self.assertNotIn("map", self.file_json())
        self.set_global("MODULES/GRID", "0;0;2;0;1")
        self.assertEqual(self.get()["layout_code"], "0;0;2;0;1")

    def test_put_module_pin_unpin(self):
        self.put_module()
        full = self.get()
        full["layout_code"] = "1;0;2;0;1"
        full["map"]["center_lon"] = 50
        r = self.client.put("/api/modules/M", json={**full, "pin": ["layout_code", "map.center_lon"]})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual((r.json()["layout_code"], r.json()["map"]["center_lon"]), ("1;0;2;0;1", 50))
        self.assertNotIn("pin", r.json())
        own = self.file_json()
        self.assertEqual((own["layout_code"], own["map"]), ("1;0;2;0;1", {"center_lon": 50}))
        self.assertNotIn("pin", own)
        self.set_global("MODULES/GRID", "0;0;2;0;1")
        self.assertEqual(self.get()["layout_code"], "1;0;2;0;1")             # ตรึงไว้: ไม่ตามค่ารวม
        r = self.client.put("/api/modules/M", json={**self.get(), "unpin": ["layout_code"]})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["layout_code"], "0;0;2;0;1")
        self.assertNotIn("layout_code", self.file_json())
        self.assertEqual(self.file_json()["map"], {"center_lon": 50})

    def test_put_module_bad_pin_path_is_422(self):
        self.put_module()
        file = self.cfg.data_dir / "modules" / "M.json"
        before = file.read_bytes()
        for label, extra, field in [
            ("unknown path", {"pin": ["nope"]}, "pin"),
            ("module-only field", {"pin": ["satellites"]}, "pin"),
            ("window", {"pin": ["window"]}, "pin"),
            ("whole section", {"pin": ["map"]}, "pin"),
            ("not a string", {"pin": [1]}, "pin"),
            ("string not list", {"pin": "layout_code"}, "pin"),
            ("object not list", {"pin": {"layout_code": True}}, "pin"),
            ("null", {"pin": None}, "pin"),
            ("unpin unknown", {"unpin": ["map.nope"]}, "unpin"),
            ("unpin string", {"unpin": "layout_code"}, "unpin"),
            ("both", {"pin": ["layout_code"], "unpin": ["layout_code"]}, "unpin"),
        ]:
            with self.subTest(label):
                self.assert_error(self.client.put("/api/modules/M", json=self.module_body(**extra)), 422,
                                  "MODULE_INVALID", field)
        self.assertEqual(file.read_bytes(), before)
        self.assert_error(self.client.put("/api/modules/N", json=self.module_body("N", pin=["nope"])), 422,
                          "MODULE_INVALID", "pin")
        self.assertEqual(self.store.list_modules(), ["M"])

    def test_new_module_stores_only_module_fields(self):
        body = self.module_body(layout_code="1;0;2;0;1", refresh={"data_ms": 700}, list_columns=["Az"],
                                map={"center_lon": 10, "file": "earth_800.png"}, polar={"orientation": "S/W/N/E"},
                                single={"fields": ["Azimuth"], "selected": NORADS[0]},
                                window={"state": 1, "x": 1, "y": 1, "width": 300, "height": 300})
        r = self.client.put("/api/modules/M", json=body)
        self.assertEqual(r.status_code, 200, r.text)
        own = self.file_json()
        self.assertEqual(set(own), self.MODULE_ONLY_KEYS)
        self.assertEqual(own["version"], 2)
        self.assertEqual(own["single"], {"selected": NORADS[0]})
        self.assertEqual(own["window"]["state"], 0)                          # window เปลี่ยนผ่าน PUT นี้ไม่ได้ (decision 4)
        self.assertEqual(r.json(), module_to_dict(module_from_dict(self.module_body(single={"selected": NORADS[0]}),
                                                                   None, None)))
        r = self.client.post("/api/modules/M/clone", json={"new_name": "M2", "open": False})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(self.file_json("M2"), {**own, "name": "M2"})

    def test_clone_keeps_pinned_values(self):
        self.put_module(qth="OTHER", layout_code="1;0;2;0;1", refresh={"data_ms": 1000}, map={"center_lon": 30},
                        pin=["layout_code", "map.center_lon"])
        source = self.get()
        r = self.client.post("/api/modules/M/clone", json={"new_name": "M2", "open": False})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["module"], {**source, "name": "M2"})
        self.assertEqual(self.file_json("M2"), {**self.file_json("M"), "name": "M2"})
        self.set_global("MODULES/GRID", "0;0;2;0;1")
        self.set_global("MODULES/DATA_TIMEOUT", 500)
        clone = self.get("M2")
        self.assertEqual((clone["layout_code"], clone["map"]["center_lon"]), ("1;0;2;0;1", 30))     # ยังตรึง
        self.assertEqual((clone["refresh"]["data_ms"], clone["qth"]), (500, "OTHER"))             # ยังสืบทอด

    def test_meta_module_keys(self):
        meta = self.client.get("/api/meta").json()
        self.assertEqual(meta["module_keys"]["layout"], {"layout_code": "MODULES/GRID"})
        self.assertEqual(list(meta["module_keys"]), list(PAGE_PATHS))
        for page, paths in PAGE_PATHS.items():
            self.assertEqual(meta["module_keys"][page], {p: MODULE_KEYS[p] for p in paths}, page)
        self.assertEqual(meta["module_keys"]["refresh"]["refresh.data_ms"], "MODULES/DATA_TIMEOUT")
        self.assertEqual(meta["global_layout_extra"], ["GLOBAL/MAIN_WIN_POS", "GLOBAL/MOD_WIN_POS", "GLOBAL/MOD_STATE"])
        self.assertEqual(meta["log_dir"], str(self.cfg.data_dir / "logs"))


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
        time_text = ("เวลา (time) ต้องเป็น ISO 8601 ที่มี timezone (เช่น 2026-11-12T07:00:00.000Z) "
                     "ระหว่าง 1957-10-04 ถึง 2100-12-31 UTC")
        for body, field in cases:
            with self.subTest(body=body):
                err = self.assert_error(self.client.put("/api/modules/M/clock", json=body), 422, "CLOCK_INVALID",
                                        field)
                self.assertEqual(self.clock(), before)                     # ผิดแล้วไม่เปลี่ยนอะไรเลย
                if field == "time":
                    self.assertEqual(err["text"], time_text)
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

    def test_put_prefs_dry_run_writes_nothing(self):
        body = {"set": {"PREDICT/MINIMUM_ELEV": 30, "GLOBAL/USE_IMPERIAL": True, "MODULES/MAP_QTH_COLOUR": 0x11223344,
                        "SKY_AT_GLANCE/COLOUR_01": "#ABCDEF"}, "remove": []}
        before = self.client.get("/api/prefs").json()
        r = self.client.put("/api/prefs?dry_run=true", json=body)
        self.assertEqual(r.status_code, 200, r.text)
        dry = r.json()
        self.assertEqual(list(dry), ["values", "defaults", "user"])                       # รูปเดียวกับ PUT จริง
        self.assertEqual(dry["values"]["PREDICT/MINIMUM_ELEV"], 30)
        self.assertIs(dry["values"]["GLOBAL/USE_IMPERIAL"], True)
        self.assertEqual(dry["values"]["MODULES/MAP_QTH_COLOUR"], 0x11223344)
        self.assertEqual(dry["values"]["SKY_AT_GLANCE/COLOUR_01"], "#abcdef")             # ปรับรูปแล้วเหมือนจริง
        self.assertEqual(dry["defaults"], before["defaults"])
        self.assertEqual(dry["user"], ["PREDICT/MINIMUM_ELEV", "SKY_AT_GLANCE/COLOUR_01", "GLOBAL/USE_IMPERIAL",
                                       "MODULES/MAP_QTH_COLOUR"])
        self.assertEqual(self.client.get("/api/prefs").json(), before)                    # ค่าเดิมยังอยู่
        self.assertEqual(self.app.state.prefs.get("PREDICT/MINIMUM_ELEV"), 5)
        self.assertFalse(self.prefs_file.exists())
        # PUT จริงด้วย body เดียวกันได้คำตอบเดียวกับ dry run
        real = self.client.put("/api/prefs", json=body)
        self.assertEqual(real.status_code, 200, real.text)
        self.assertEqual(real.json(), dry)
        self.assertEqual(self.client.get("/api/prefs").json(), dry)

    def test_put_prefs_dry_run_leaves_an_existing_file_byte_for_byte(self):
        self.client.put("/api/prefs", json={"set": {"PREDICT/MINIMUM_ELEV": 30, "PREDICT/LOOK_AHEAD": 7}})
        before, file_before = self.client.get("/api/prefs").json(), self.prefs_file.read_bytes()
        r = self.client.put("/api/prefs?dry_run=true", json={"set": {"PREDICT/NUMBER_OF_PASSES": 25},
                                                             "remove": ["PREDICT/MINIMUM_ELEV"]})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual((r.json()["values"]["PREDICT/MINIMUM_ELEV"], r.json()["values"]["PREDICT/NUMBER_OF_PASSES"]), (5, 25))
        self.assertEqual(r.json()["user"], ["PREDICT/NUMBER_OF_PASSES", "PREDICT/LOOK_AHEAD"])
        self.assertEqual(self.prefs_file.read_bytes(), file_before)
        self.assertEqual(self.client.get("/api/prefs").json(), before)
        self.assertEqual(sorted(p.name for p in self.cfg.data_dir.iterdir() if p.name.startswith("preferences")),
                         ["preferences.json"])                                              # ไม่มีไฟล์ชั่วคราวค้าง

    def test_put_prefs_dry_run_validates_like_a_real_put(self):
        self.client.put("/api/prefs", json={"set": {"PREDICT/MINIMUM_ELEV": 30}})
        before, file_before = self.client.get("/api/prefs").json(), self.prefs_file.read_bytes()
        for bad, code, obj in (({"set": {"PREDICT/NUMBER_OF_PASSES": 20, "PREDICT/LOOK_AHEAD": 15}}, "PREFS_INVALID", "PREDICT/LOOK_AHEAD"),
                               ({"set": {"MODULES/MAP_QTH_COLOUR": 2 ** 32}}, "PREFS_INVALID", "MODULES/MAP_QTH_COLOUR"),
                               ({"set": {"TLE/URLS": []}}, "PREFS_INVALID", "TLE/URLS"),
                               ({"set": {"PREDICT/NOPE": 1}}, "PREFS_INVALID", "PREDICT/NOPE"),
                               ({"remove": ["PREDICT/NOPE"]}, "PREFS_INVALID", "PREDICT/NOPE"),
                               ({"set": {"PREDICT/LOOK_AHEAD": 3}, "remove": ["PREDICT/LOOK_AHEAD"]}, "PREFS_INVALID", "PREDICT/LOOK_AHEAD"),
                               ({"set": [1]}, "PREFS_INVALID", "set"), ({"remove": "x"}, "PREFS_INVALID", "remove")):
            with self.subTest(bad=bad):
                dry = self.client.put("/api/prefs?dry_run=true", json=bad)
                real = self.client.put("/api/prefs", json=bad)
                self.assert_error(dry, 422, code, obj)
                self.assertEqual(dry.json(), real.json())                                 # ข้อความเดียวกับของจริง
        self.assert_error(self.client.put("/api/prefs?dry_run=true", json=[1]), 422, "REQUEST_INVALID", None)
        self.assertEqual(self.client.get("/api/prefs").json(), before)
        self.assertEqual(self.prefs_file.read_bytes(), file_before)

    def test_put_prefs_dry_run_flag_values(self):
        for flag in ("false", "0", "False"):
            with self.subTest(dry_run=flag):
                self.assertEqual(self.client.put(f"/api/prefs?dry_run={flag}", json={"set": {"PREDICT/LOOK_AHEAD": 7}}).status_code, 200)
                self.assertEqual(self.app.state.prefs.get("PREDICT/LOOK_AHEAD"), 7)       # dry_run=false = PUT จริง
                self.client.put("/api/prefs", json={"remove": ["PREDICT/LOOK_AHEAD"]})
        self.assertEqual(self.client.put("/api/prefs?dry_run=1", json={"set": {"PREDICT/LOOK_AHEAD": 7}}).status_code, 200)
        self.assertEqual(self.app.state.prefs.get("PREDICT/LOOK_AHEAD"), 3)
        self.assert_error(self.client.put("/api/prefs?dry_run=maybe", json={"set": {"PREDICT/LOOK_AHEAD": 7}}), 422,
                          "REQUEST_INVALID", "dry_run")
        self.assertEqual(self.app.state.prefs.get("PREDICT/LOOK_AHEAD"), 3)               # ค่าผิดไม่เขียนเช่นกัน

    def test_put_prefs_accepts_the_data_keys(self):
        body = {"set": {"TLE/URLS": ["http://server.com/file.txt"], "LOG/CLEAN_AGE": 604800, "MODULES/GRID": "1;0;2;0;1",
                        "MODULES/POLAR_CHART_ORIENT": "S/E/N/W", "MODULES/LIST_COLUMNS": ["Orbit", "Satellite"]}}
        r = self.client.put("/api/prefs", json=body)
        self.assertEqual(r.status_code, 200, r.text)
        values = r.json()["values"]
        self.assertEqual((values["TLE/URLS"], values["LOG/CLEAN_AGE"], values["MODULES/GRID"]),
                         (["http://server.com/file.txt"], 604800, "1;0;2;0;1"))
        self.assertEqual((values["MODULES/POLAR_CHART_ORIENT"], values["MODULES/LIST_COLUMNS"]), ("S/E/N/W", ["Satellite", "Orbit"]))
        self.assertEqual(len(values["TLE/URLS"]), 1)
        self.assertEqual(len(r.json()["defaults"]["TLE/URLS"]), 11)

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


# ---------------------------------------------------------------- Radio และ Rotator (งานย่อย 3: หัวข้อ 6 และ 8 ของ spec)

HW_RADIO = {"name": "DUMMY", "Host": "localhost", "Port": 4532, "Cycle": 1000, "LO": 0.0, "LO_UP": 0.0,
            "DefaultUplinkFreqHz": 145_890_000.0, "DefaultDownlinkFreqHz": 145_890_000.0, "Type": 3, "PTT": 0,
            "VFO_UP": 3, "VFO_DOWN": 4, "SIGNAL_AOS": False, "SIGNAL_LOS": False, "SIGNAL_AOIQ": False, "SIGNAL_LOIQ": False}
HW_ROTATOR = {"name": "ROT", "Host": "localhost", "Port": 4533, "Cycle": 1000, "Threshold": 5.0, "AzType": 0,
              "MinAz": 0.0, "MaxAz": 360.0, "MinEl": 0.0, "MaxEl": 90.0, "AzStopPos": 0.0}


class HwconfApiTest(ApiTestBase):
    @property
    def hwconf_dir(self) -> Path:
        return self.cfg.data_dir / "hwconf"

    def hwconf_files(self) -> dict[str, bytes]:
        return {p.name: p.read_bytes() for p in sorted(self.hwconf_dir.iterdir())} if self.hwconf_dir.is_dir() else {}

    def test_get_hwconf_empty(self):
        r = self.client.get("/api/hwconf")
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json(), {"radios": [], "rotators": []})
        self.assertFalse(self.hwconf_dir.exists())

    def test_put_hwconf_replaces(self):
        r = self.client.put("/api/hwconf", json={"radios": [HW_RADIO, {**HW_RADIO, "name": "AAA", "Type": 0, "PTT": 2}],
                                                 "rotators": [HW_ROTATOR]})
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertEqual(list(body), ["radios", "rotators"])
        self.assertEqual([x["name"] for x in body["radios"]], ["AAA", "DUMMY"])          # เรียงตามชื่อ
        self.assertEqual(body["radios"][1], HW_RADIO)
        self.assertNotIn("VFO_UP", body["radios"][0])                                      # VFO_* มีเฉพาะ Full-duplex
        self.assertEqual(body["rotators"], [HW_ROTATOR])
        self.assertEqual(self.client.get("/api/hwconf").json(), body)
        self.assertEqual(sorted(self.hwconf_files()), ["AAA.rig.json", "DUMMY.rig.json", "ROT.rot.json"])
        self.assertEqual(self.app.state.hwconf.radio("DUMMY").port, 4532)
        # PUT ใหม่แทนทั้งชุด: ของที่ไม่อยู่ในชุดหายไป
        r = self.client.put("/api/hwconf", json={"radios": [{**HW_RADIO, "Port": 4600}], "rotators": []})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json(), {"radios": [{**HW_RADIO, "Port": 4600}], "rotators": []})
        self.assertEqual(sorted(self.hwconf_files()), ["DUMMY.rig.json"])
        client = self.enter(self.make_app())                                               # อยู่รอดหลังเริ่ม server ใหม่
        self.assertEqual(client.get("/api/hwconf").json(), r.json())

    def test_put_hwconf_keeps_cycle_and_threshold(self):
        self.client.put("/api/hwconf", json={"radios": [HW_RADIO], "rotators": [HW_ROTATOR]})
        self.app.state.hwconf.save_radio_cycle("DUMMY", 500)
        self.app.state.hwconf.save_rotator_runtime("ROT", 200, 2.5)
        body = self.client.put("/api/hwconf", json={"radios": [HW_RADIO], "rotators": [HW_ROTATOR]}).json()
        self.assertEqual(body["radios"][0]["Cycle"], 500)
        self.assertEqual((body["rotators"][0]["Cycle"], body["rotators"][0]["Threshold"]), (200, 2.5))

    def test_put_hwconf_invalid_is_422_and_unchanged(self):
        self.client.put("/api/hwconf", json={"radios": [HW_RADIO], "rotators": [HW_ROTATOR]})
        before, files = self.client.get("/api/hwconf").json(), self.hwconf_files()
        body = self.assert_error(self.client.put("/api/hwconf", json={"radios": [{**HW_RADIO, "name": "NEW"},
                                                                                {**HW_RADIO, "Port": 80}], "rotators": []}),
                                 422, "HWCONF_INVALID", "Port")
        self.assertEqual(body["text"], "Port ต้องเป็นจำนวนเต็ม 1024–65535")
        self.assert_error(self.client.put("/api/hwconf", json={"radios": [], "rotators": [{**HW_ROTATOR, "MinAz": -201}]}),
                          422, "HWCONF_INVALID", "MinAz")
        self.assert_error(self.client.put("/api/hwconf", json={"radios": [HW_RADIO, {**HW_RADIO, "name": "dummy"}],
                                                               "rotators": []}), 422, "HWCONF_INVALID", "name")
        self.assertEqual(self.client.get("/api/hwconf").json(), before)
        self.assertEqual(self.hwconf_files(), files)

    def test_put_hwconf_bad_shape_is_422_and_unchanged(self):
        self.client.put("/api/hwconf", json={"radios": [HW_RADIO], "rotators": []})
        files = self.hwconf_files()
        for bad, obj in (({}, "radios"), ({"radios": []}, "rotators"), ({"rotators": []}, "radios"),
                         ({"radios": {}, "rotators": []}, "radios"), ({"radios": [], "rotators": "x"}, "rotators"),
                         ({"radios": None, "rotators": []}, "radios"), ({"radios": [5], "rotators": []}, None),
                         ({"radios": [], "rotators": [None]}, None)):
            with self.subTest(body=bad):
                self.assert_error(self.client.put("/api/hwconf", json=bad), 422, "HWCONF_INVALID", obj)
        for bad in ([1], "x", None):
            with self.subTest(body=bad):
                self.assert_error(self.client.put("/api/hwconf", json=bad), 422, "REQUEST_INVALID", None)
        self.assertEqual(self.hwconf_files(), files)

    def test_put_hwconf_dry_run_writes_nothing(self):
        self.client.put("/api/hwconf", json={"radios": [HW_RADIO], "rotators": [HW_ROTATOR]})
        self.app.state.hwconf.save_radio_cycle("DUMMY", 500)
        self.app.state.hwconf.save_rotator_runtime("ROT", 200, 2.5)
        before, files = self.client.get("/api/hwconf").json(), self.hwconf_files()
        body = {"radios": [{**HW_RADIO, "Port": 4600}, {**HW_RADIO, "name": "AAA", "Type": 0, "PTT": 2}],
                "rotators": [{**HW_ROTATOR, "Cycle": 77, "Threshold": 9.0, "MaxEl": 80.0}, {**HW_ROTATOR, "name": "NEWROT"}]}
        r = self.client.put("/api/hwconf?dry_run=true", json=body)
        self.assertEqual(r.status_code, 200, r.text)
        dry = r.json()
        self.assertEqual(list(dry), ["radios", "rotators"])
        self.assertEqual([x["name"] for x in dry["radios"]], ["AAA", "DUMMY"])                 # เรียงตามชื่อเหมือนจริง
        self.assertEqual(dry["radios"][1]["Port"], 4600)
        self.assertEqual(dry["radios"][1]["Cycle"], 500)                                       # Cycle ใช้ค่าในไฟล์เดิม
        self.assertEqual(dry["radios"][0]["Cycle"], 1000)                                      # อุปกรณ์ใหม่ได้ค่าตั้งต้น
        self.assertNotIn("VFO_UP", dry["radios"][0])
        self.assertEqual([x["name"] for x in dry["rotators"]], ["NEWROT", "ROT"])
        self.assertEqual((dry["rotators"][1]["Cycle"], dry["rotators"][1]["Threshold"], dry["rotators"][1]["MaxEl"]),
                         (200, 2.5, 80.0))                                                     # ไม่ใช้ Cycle/Threshold ใน body
        self.assertEqual((dry["rotators"][0]["Cycle"], dry["rotators"][0]["Threshold"]), (1000, 5.0))
        self.assertEqual(self.client.get("/api/hwconf").json(), before)                        # ของเดิมยังอยู่
        self.assertEqual(self.hwconf_files(), files)
        self.assertEqual(self.app.state.hwconf.radio("DUMMY").port, 4532)
        # PUT จริงด้วย body เดียวกันได้คำตอบเดียวกับ dry run
        real = self.client.put("/api/hwconf", json=body)
        self.assertEqual(real.status_code, 200, real.text)
        self.assertEqual(real.json(), dry)
        self.assertNotEqual(self.hwconf_files(), files)

    def test_put_hwconf_dry_run_on_a_fresh_install_creates_nothing(self):
        r = self.client.put("/api/hwconf?dry_run=true", json={"radios": [HW_RADIO], "rotators": [HW_ROTATOR]})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json(), {"radios": [HW_RADIO], "rotators": [HW_ROTATOR]})
        self.assertFalse(self.hwconf_dir.exists())
        self.assertEqual(self.client.get("/api/hwconf").json(), {"radios": [], "rotators": []})

    def test_put_hwconf_dry_run_validates_like_a_real_put(self):
        self.client.put("/api/hwconf", json={"radios": [HW_RADIO], "rotators": [HW_ROTATOR]})
        before, files = self.client.get("/api/hwconf").json(), self.hwconf_files()
        for bad, obj in (({"radios": [{**HW_RADIO, "Port": 80}], "rotators": []}, "Port"),
                         ({"radios": [], "rotators": [{**HW_ROTATOR, "MinAz": -201}]}, "MinAz"),
                         ({"radios": [HW_RADIO, {**HW_RADIO, "name": "dummy"}], "rotators": []}, "name"),
                         ({"radios": [{**HW_RADIO, "name": "bad name"}], "rotators": []}, "name"),
                         ({"radios": [], "rotators": [HW_ROTATOR, HW_ROTATOR]}, "name"),
                         ({}, "radios"), ({"radios": []}, "rotators"), ({"radios": [], "rotators": "x"}, "rotators"),
                         ({"radios": [5], "rotators": []}, None)):
            with self.subTest(body=bad):
                dry = self.client.put("/api/hwconf?dry_run=true", json=bad)
                real = self.client.put("/api/hwconf", json=bad)
                self.assert_error(dry, 422, "HWCONF_INVALID", obj)
                self.assertEqual(dry.json(), real.json())                                      # รหัสและข้อความเดียวกับของจริง
        self.assert_error(self.client.put("/api/hwconf?dry_run=true", json=[1]), 422, "REQUEST_INVALID", None)
        self.assert_error(self.client.put("/api/hwconf?dry_run=maybe", json={"radios": [], "rotators": []}), 422,
                          "REQUEST_INVALID", "dry_run")
        self.assertEqual(self.client.get("/api/hwconf").json(), before)
        self.assertEqual(self.hwconf_files(), files)

    def test_put_hwconf_dry_run_false_is_a_real_put(self):
        r = self.client.put("/api/hwconf?dry_run=false", json={"radios": [HW_RADIO], "rotators": []})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(sorted(self.hwconf_files()), ["DUMMY.rig.json"])

    def test_get_hwconf_skips_a_broken_file(self):
        """แก้ไฟล์ด้วยมือจนพัง: GET ยังตอบได้ ข้ามไฟล์นั้นพร้อม log (ไม่ใช่ 500)"""
        self.client.put("/api/hwconf", json={"radios": [HW_RADIO], "rotators": [HW_ROTATOR]})
        (self.hwconf_dir / "BROKEN.rig.json").write_text("{not json", encoding="utf-8")
        with self.assertLogs("gpredict_web.hwconf", "WARNING") as logs:
            r = self.client.get("/api/hwconf")
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json(), {"radios": [HW_RADIO], "rotators": [HW_ROTATOR]})
        self.assertIn("BROKEN.rig.json", "\n".join(logs.output))


# ---------------------------------------------------------------- Radio Control และ Antenna Control (Task 9)

LINEAR = {"name": "Mode U/V linear", "up_low": 435_000_000, "up_high": 435_100_000,
          "down_low": 145_900_000, "down_high": 146_000_000, "invert": False, "mode": "SSB", "baud": 0.0}
BEACON = {"name": "Beacon", "up_low": 0, "up_high": 0, "down_low": 145_800_000, "down_high": 145_800_000,
          "invert": False, "mode": "CW", "baud": 0.0}
INVERTING = {**LINEAR, "name": "Mode U/V inverting", "invert": True}
ISS, AO91, SAT_BY_NAME = NORADS[0], NORADS[1], NORADS[2]          # SAT-7530 มาก่อนในลำดับชื่อ: เป้าหมายตั้งต้นของ controller
RX_ONLY, TX_ONLY, FT817_MANUAL = 0, 1, 5


class ControllerApiTest(ApiTestBase):
    """route ของ controller ด้วย rigctld/rotctld ปลอม (HamlibThread) ControllerHub อยู่ใน event loop ของ app (portal ของ TestClient)"""

    def setUp(self):
        super().setUp()
        self.rig = HamlibThread(self)
        self.rot = HamlibThread(self)
        self.put_module(refresh={"data_ms": 100}, pin=["refresh.data_ms"])
        trsp = self.cfg.data_dir / "trsp"
        trsp.mkdir(parents=True, exist_ok=True)
        (trsp / f"{ISS}.json").write_text(json.dumps([LINEAR, BEACON, INVERTING]), encoding="utf-8")

    def radio(self, name: str, kind: int = RX_ONLY) -> dict:
        return {**HW_RADIO, "name": name, "Port": self.rig.port, "Type": kind, "PTT": 0}

    def rotator(self, name: str) -> dict:
        return {**HW_ROTATOR, "name": name, "Port": self.rot.port}

    def put_hw(self, radios=(), rotators=(), cycles: dict[str, int] | None = None) -> None:
        """เก็บอุปกรณ์ทางหน้า Preferences (PUT /api/hwconf ไม่รับ Cycle: ค่านั้นเป็นของหน้าต่างควบคุม) แล้วตั้ง Cycle ของแต่ละชื่อ"""
        r = self.client.put("/api/hwconf", json={"radios": list(radios), "rotators": list(rotators)})
        self.assertEqual(r.status_code, 200, r.text)
        hwconf = self.app.state.hwconf
        for name, ms in (cycles or {}).items():
            if hwconf.radio(name) is not None:
                hwconf.save_radio_cycle(name, ms)
            else:
                hwconf.save_rotator_runtime(name, ms, 5.0)

    def post(self, path: str, body=None):
        return self.client.post(f"/api/modules/M/{path}", json=body)

    def open_ctl(self, kind: str) -> list[dict]:
        r = self.post(f"{kind}/open")
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()["open"]

    def act(self, kind: str, **body) -> dict:
        r = self.post(kind, body)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(list(r.json()), [kind])
        return r.json()[kind]

    def listed(self) -> list[dict]:
        r = self.client.get("/api/controllers")
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(list(r.json()), ["open"])
        return r.json()["open"]

    # ---------------------------------------------------------------- เปิด ปิด รายการ

    def test_open_close_and_list(self):
        self.put_hw([self.radio("A")], [self.rotator("R")])
        self.assertEqual(self.listed(), [])
        self.open_module()
        self.assertEqual(self.open_ctl("radio"), [{"module": "M", "kind": "radio"}])
        both = [{"module": "M", "kind": "radio"}, {"module": "M", "kind": "rotator"}]
        self.assertEqual(self.open_ctl("rotator"), both)
        self.assertEqual(self.open_ctl("radio"), both)                          # เปิดซ้ำคงเดิม
        self.assertEqual(self.listed(), both)
        r = self.post("radio/close")
        self.assertEqual((r.status_code, r.json()), (200, {"open": [{"module": "M", "kind": "rotator"}]}))
        self.assertEqual(self.post("radio/close").json(), {"open": [{"module": "M", "kind": "rotator"}]})    # ปิดซ้ำได้
        self.assertEqual(self.post("rotator/close").json(), {"open": []})
        self.assertEqual(self.listed(), [])

    def test_open_without_config_is_409(self):
        self.open_module()
        self.assert_error(self.post("radio/open"), 409, "NO_RADIO_CONFIG")
        self.assert_error(self.post("rotator/open"), 409, "NO_ROTATOR_CONFIG")
        self.put_hw([self.radio("A")])                                            # มีวิทยุแต่ไม่มี rotator
        self.assertEqual(self.open_ctl("radio"), [{"module": "M", "kind": "radio"}])
        self.assert_error(self.post("rotator/open"), 409, "NO_ROTATOR_CONFIG")
        self.assertEqual(self.listed(), [{"module": "M", "kind": "radio"}])

    def test_open_module_not_open_is_404(self):
        self.put_hw([self.radio("A")], [self.rotator("R")])
        for kind in ("radio", "rotator"):
            with self.subTest(kind=kind):
                self.assert_error(self.post(f"{kind}/open"), 404, "NOT_FOUND")                 # module มีแต่ไม่ได้เปิด
                self.assert_error(self.client.post(f"/api/modules/Nope/{kind}/open"), 404, "NOT_FOUND")
        self.assertEqual(self.listed(), [])

    # ---------------------------------------------------------------- action

    def test_every_radio_action(self):
        """ทุก action ของ spec §8 ตอบ 200 พร้อม snapshot ใหม่ และ engage/ptt_toggle ส่งคำสั่งถึง rigctld จริง"""
        self.put_hw([self.radio("A"), self.radio("B"), self.radio("C", TX_ONLY), self.radio("F", FT817_MANUAL)],
                    cycles={"B": 500, "F": 300})
        self.open_module()
        self.open_ctl("radio")
        snap = self.act("radio", action="track", on=True)
        self.assertEqual((snap["track"], snap["lock"], snap["engaged"], snap["norad"]), (True, False, False, SAT_BY_NAME))
        self.assertEqual((snap["devices"], snap["device1"], snap["device2"]), (["A", "B", "C", "F"], "A", "None"))
        self.assertEqual((snap["devices2"][0], sorted(snap["devices2"][1:])), ("None", ["C", "F"]))   # ไม่รวม RX only
        snap = self.act("radio", action="satellite", norad=ISS)                  # เลือกดาวแล้วจูนไป transponder แรก
        self.assertEqual((snap["norad"], snap["transponders"], snap["transponder"]),
                         (ISS, ["Mode U/V linear", "Beacon", "Mode U/V inverting"], 0))
        self.assertEqual((snap["down"]["sat_hz"], snap["up"]["sat_hz"]), (145_950_000, 435_050_000))
        snap = self.act("radio", action="transponder", index=1)
        self.assertEqual((snap["transponder"], snap["down"]["sat_hz"]), (1, 145_800_000))
        snap = self.act("radio", action="freq", link="down", hz=145_810_000)
        self.assertEqual(snap["down"]["sat_hz"], 145_810_000)
        snap = self.act("radio", action="freq", link="up", hz=435_020_000)
        self.assertEqual(snap["up"]["sat_hz"], 435_020_000)
        snap = self.act("radio", action="tune")
        self.assertEqual(snap["down"]["sat_hz"], 145_800_000)
        snap = self.act("radio", action="lock", on=True)
        self.assertTrue(snap["lock"])
        snap = self.act("radio", action="lock", on=False)
        self.assertFalse(snap["lock"])
        snap = self.act("radio", action="device1", name="B")
        self.assertEqual((snap["device1"], snap["cycle_ms"]), ("B", 500))        # Cycle ตามไฟล์ของอุปกรณ์
        snap = self.act("radio", action="device2", name="C")
        self.assertEqual(snap["device2"], "C")
        snap = self.act("radio", action="device2", name="None")
        self.assertEqual(snap["device2"], "None")
        snap = self.act("radio", action="cycle", ms=700)
        self.assertEqual(snap["cycle_ms"], 700)
        snap = self.act("radio", action="device1", name="F")
        self.assertEqual((snap["device1"], snap["space_ptt"], snap["cycle_ms"]), ("F", True, 300))
        snap = self.act("radio", action="engage", on=True)
        self.assertTrue(snap["engaged"])
        self.assertTrue(wait_until(lambda: any(c.startswith(b"F") for c in self.rig.log)))        # ส่งความถี่แล้ว
        self.assert_error(self.post("radio", {"action": "device1", "name": "A"}), 422, "CONTROLLER_INVALID", "name")
        self.assertEqual(self.act("radio", action="ptt_toggle")["engaged"], True)
        self.assertTrue(wait_until(lambda: b"T 1\n" in self.rig.log))              # SPACE: PTT เปิด
        snap = self.act("radio", action="engage", on=False)
        self.assertFalse(snap["engaged"])
        self.assertTrue(wait_until(lambda: self.rig.log[-1:] == [b"q\n"]))

    def test_every_rotator_action(self):
        self.put_hw(rotators=[self.rotator("R1"), self.rotator("R2")], cycles={"R2": 400})
        self.open_module()
        self.open_ctl("rotator")
        snap = self.act("rotator", action="satellite", norad=AO91)
        self.assertEqual((snap["norad"], snap["device"], snap["devices"]), (AO91, "R1", ["R1", "R2"]))
        snap = self.act("rotator", action="device", name="R2")
        self.assertEqual((snap["device"], snap["cycle_ms"]), ("R2", 400))
        snap = self.act("rotator", action="cycle", ms=700)
        self.assertEqual(snap["cycle_ms"], 700)
        snap = self.act("rotator", action="threshold", deg=2.5)
        self.assertEqual(snap["threshold_deg"], 2.5)
        snap = self.act("rotator", action="az", deg=90)
        self.assertEqual(snap["knob"]["az"], 90)
        snap = self.act("rotator", action="el", deg=30)
        self.assertEqual((snap["knob"], snap["setpoint"]), ({"az": 90, "el": 30}, {"az": 90, "el": 30}))
        snap = self.act("rotator", action="monitor", on=True)
        self.assertEqual((snap["monitor"], snap["knobs_enabled"]), (True, False))
        self.assert_error(self.post("rotator", {"action": "track", "on": True}), 422, "CONTROLLER_INVALID", "on")
        snap = self.act("rotator", action="monitor", on=False)
        self.assertEqual((snap["monitor"], snap["knobs_enabled"]), (False, True))
        snap = self.act("rotator", action="track", on=True)
        self.assertEqual((snap["track"], snap["monitor_enabled"], snap["knobs_enabled"]), (True, False, False))
        snap = self.act("rotator", action="track", on=False)
        self.assertEqual((snap["track"], snap["monitor_enabled"]), (False, True))
        snap = self.act("rotator", action="engage", on=True)
        self.assertTrue(snap["engaged"])
        self.assertTrue(wait_until(lambda: b"p\n" in self.rot.log))                # อ่านตำแหน่งแล้ว
        snap = self.act("rotator", action="engage", on=False)
        self.assertFalse(snap["engaged"])
        self.assertTrue(wait_until(lambda: self.rot.log[-1:] == [b"q\n"]))
        self.assertEqual(self.rot.log[-2:], [b"S\n", b"q\n"])                      # หยุด rotator แล้วปิดการเชื่อมต่อ

    def test_invalid_action_is_422(self):
        self.put_hw([self.radio("A")], [self.rotator("R")])
        self.open_module()
        self.open_ctl("radio")
        self.open_ctl("rotator")
        self.act("radio", action="cycle", ms=700)
        self.act("rotator", action="threshold", deg=2.5)
        radio_bad = [{"action": "fly"}, {}, {"action": 5}, {"action": "engage"}, {"action": "engage", "on": "yes"},
                     {"action": "freq", "link": "down", "hz": -1}, {"action": "freq", "link": "down", "hz": 10_000_000_000},
                     {"action": "freq", "link": "side", "hz": 145_000_000}, {"action": "freq", "link": "up"},
                     {"action": "cycle", "ms": 5}, {"action": "cycle", "ms": 30001}, {"action": "cycle", "ms": "700"},
                     {"action": "satellite", "norad": 99999}, {"action": "satellite", "norad": "25544"},
                     {"action": "transponder", "index": 0}, {"action": "device1", "name": "Nope"},
                     {"action": "device2", "name": "A"}]
        rotator_bad = [{"action": "fly"}, {}, {"action": "threshold", "deg": 60}, {"action": "threshold", "deg": 0},
                       {"action": "cycle", "ms": 5}, {"action": "az", "deg": "north"}, {"action": "el"},
                       {"action": "device", "name": "Nope"}, {"action": "satellite", "norad": 99999},
                       {"action": "monitor", "on": 1}]
        for kind, bodies in (("radio", radio_bad), ("rotator", rotator_bad)):
            for body in bodies:
                with self.subTest(kind=kind, body=body):
                    self.assert_error(self.post(kind, body), 422, "CONTROLLER_INVALID")
        self.assert_error(self.post("radio", [1]), 422, "REQUEST_INVALID", None)            # ไม่ใช่ JSON object
        self.assertEqual(self.act("radio", action="track", on=False)["cycle_ms"], 700)       # ไม่มีอะไรเปลี่ยน
        self.assertEqual(self.act("rotator", action="track", on=False)["threshold_deg"], 2.5)

    def test_action_on_closed_controller_is_404(self):
        self.put_hw([self.radio("A")], [self.rotator("R")])
        self.open_module()
        for kind in ("radio", "rotator"):
            with self.subTest(kind=kind):
                self.assert_error(self.post(kind, {"action": "track", "on": True}), 404, "NOT_FOUND")    # ยังไม่เปิด
                self.open_ctl(kind)
                self.act(kind, action="track", on=True)
                self.post(f"{kind}/close")
                self.assert_error(self.post(kind, {"action": "track", "on": False}), 404, "NOT_FOUND")  # ปิดแล้ว
                self.assert_error(self.post(kind, {"action": "fly"}), 404, "NOT_FOUND")                  # 404 มาก่อน 422
        self.assert_error(self.client.post("/api/modules/Nope/radio", json={"action": "tune"}), 404, "NOT_FOUND")

    # ---------------------------------------------------------------- เป้าหมาย

    def test_target_route(self):
        self.put_hw([self.radio("A")], [self.rotator("R")])
        self.open_module()
        r = self.post("target", {"norad": AO91})
        self.assertEqual((r.status_code, r.content), (204, b""))
        self.open_ctl("radio")                                                      # เปิดตามเป้าหมายของ module
        self.open_ctl("rotator")
        self.assertEqual(self.act("radio", action="track", on=False)["norad"], AO91)
        self.assertEqual(self.act("rotator", action="track", on=False)["norad"], AO91)
        self.assertEqual(self.post("target", {"norad": ISS}).status_code, 204)      # controller ที่เปิดอยู่เปลี่ยนดาวตาม
        self.assertEqual(self.act("radio", action="track", on=False)["norad"], ISS)
        self.assertEqual(self.act("rotator", action="track", on=False)["norad"], ISS)
        for bad in ({}, {"norad": "25544"}, {"norad": 25544.5}, {"norad": True}, {"norad": None}, {"norad": [ISS]}):
            with self.subTest(body=bad):
                self.assert_error(self.post("target", bad), 422, "CONTROLLER_INVALID", "norad")
        self.assert_error(self.post("target", [ISS]), 422, "REQUEST_INVALID", None)
        self.assert_error(self.post("target", {"norad": 99999}), 404, "NOT_FOUND", "99999")      # ไม่อยู่ใน module
        self.assert_error(self.client.post("/api/modules/Nope/target", json={"norad": ISS}), 404, "NOT_FOUND")
        self.assertEqual(self.act("radio", action="track", on=False)["norad"], ISS)             # เป้าหมายเดิมคงอยู่

    def test_target_on_module_not_open_is_404(self):
        self.assert_error(self.post("target", {"norad": ISS}), 404, "NOT_FOUND")

    # ---------------------------------------------------------------- Configure ถูกห้ามขณะ controller เปิดอยู่

    def test_configure_blocked_while_active(self):
        self.put_hw([self.radio("A")], [self.rotator("R")])
        self.put_module(single={"selected": ISS})
        self.open_module()
        file = self.cfg.data_dir / "modules" / "M.json"
        before = file.read_bytes()
        for kind in ("radio", "rotator"):                                           # controller ตัวเดียวก็ห้าม
            with self.subTest(kind=kind):
                self.open_ctl(kind)
                for field, body in (("satellites", self.module_body(sats=NORADS[:2])),
                                    ("satellites", self.module_body(sats=NORADS[::-1])),       # ลำดับก็นับว่าเปลี่ยน
                                    ("qth", self.module_body(qth="OTHER")),
                                    ("qth", self.module_body(qth=None)),
                                    ("qth", self.module_body(qth="OTHER", sats=NORADS[:2]))):
                    r = self.client.put("/api/modules/M", json=body)
                    err = self.assert_error(r, 409, "CONTROLLER_ACTIVE", field)
                    self.assertIn("Radio Control", err["text"])
                    self.assertIn("Antenna Control", err["text"])
                self.assertEqual(file.read_bytes(), before)                         # ไฟล์ module ไม่เปลี่ยน
                self.assertEqual(self.hub.get("M").module.qth, "ORIGIN")
                self.post(f"{kind}/close")
        self.put_module(sats=NORADS[:2])                                            # ปิด controller แล้วแก้ได้
        self.assertEqual(self.store.get_module("M").satellites, list(NORADS[:2]))

    def test_batch_deleting_the_station_of_a_module_with_open_controllers(self):
        """ลบสถานีของ module ที่มี controller เปิดอยู่ใน OK ของ Preferences: ไฟล์ module เป็น ** DEFAULT ** (ตามที่ Gpredict ทำ)
        แต่ runtime และ controller ไม่ถูกบังคับให้เปลี่ยนสถานี (batch ไม่ผ่าน PUT module และไม่ hub.reload) จนกว่า controller จะปิดแล้วถูกบันทึกใหม่"""
        self.put_hw([self.radio("A")], [self.rotator("R")])
        self.open_module()
        self.open_ctl("radio")
        self.open_ctl("rotator")
        both = [{"module": "M", "kind": "radio"}, {"module": "M", "kind": "rotator"}]
        rt = self.hub.get("M")
        with self.assertLogs("gpredict_web.store", "ERROR"):
            r = self.client.put("/api/qth/batch", json={"stations": [asdict(OTHER)], "default": "OTHER"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["changed_modules"], ["M"])
        self.assertIsNone(self.store.get_module_own("M")["qth"])
        self.assertEqual(self.listed(), both)                                       # controller ยังเปิดอยู่ ไม่ถูกปิด
        self.assertIs(self.hub.get("M"), rt)
        self.assertEqual((rt.qth.name, rt.module.qth, rt.tick()["qth"]["name"]), ("ORIGIN", "ORIGIN", "ORIGIN"))
        self.assertEqual(self.act("radio", action="track", on=False)["norad"], SAT_BY_NAME)    # ยังสั่ง controller ได้ตามปกติ
        self.assertEqual(self.act("rotator", action="track", on=False)["norad"], SAT_BY_NAME)
        # กฎ 409 ยังอยู่: runtime ใช้ ORIGIN แต่ไฟล์เป็น ** DEFAULT ** (= OTHER) การบันทึกที่ส่ง qth: None จึงเป็นการเปลี่ยนสถานี
        self.assert_error(self.client.put("/api/modules/M", json=self.module_body(qth=None)), 409, "CONTROLLER_ACTIVE", "qth")
        self.assertEqual(rt.qth.name, "ORIGIN")
        self.post("radio/close")
        self.post("rotator/close")
        self.put_module(qth=None)                                                   # ปิด controller แล้วบันทึกได้ runtime ตามสถานีตั้งต้นใหม่
        self.assertEqual(self.hub.get("M").qth.name, "OTHER")

    def test_configure_validation_comes_before_conflict(self):
        self.put_hw([self.radio("A")])
        self.put_module()
        self.open_module()
        self.open_ctl("radio")
        self.assert_error(self.client.put("/api/modules/M", json=self.module_body(qth="NOPE")), 422, "MODULE_INVALID", "qth")

    def test_put_module_view_change_allowed_while_active(self):
        """Review Focus 2: เลือกดาวใน Map, Ground Track, Autotrack (PUT module ของ core) บันทึกได้ขณะ controller เปิดอยู่"""
        self.put_hw([self.radio("A")], [self.rotator("R")])
        self.put_module()
        self.open_module()
        self.open_ctl("radio")
        self.open_ctl("rotator")
        file = self.cfg.data_dir / "modules" / "M.json"
        before = file.read_bytes()
        body = self.put_module(ground_track=[ISS], single={"selected": AO91}, map={"track_orbits": 5},
                               pin=["map.track_orbits"])
        self.assertNotEqual(file.read_bytes(), before)
        saved = self.store.get_module("M")
        self.assertEqual((saved.ground_track, saved.single["selected"], saved.map["track_orbits"]), ([ISS], AO91, 5))
        self.assertEqual((body["ground_track"], body["single"]["selected"], body["map"]["track_orbits"]), ([ISS], AO91, 5))
        self.put_module(sats=NORADS, qth="ORIGIN", ground_track=[], footprint_off=[ISS], sky_track=[AO91])    # ค่าเดิมของ qth และดาว
        self.assertEqual(self.listed(), [{"module": "M", "kind": "radio"}, {"module": "M", "kind": "rotator"}])

    # ---------------------------------------------------------------- อายุของ controller กับ module

    def engage_both(self) -> None:
        self.put_hw([self.radio("A")], [self.rotator("R")])
        self.open_module()
        self.open_ctl("radio")
        self.open_ctl("rotator")
        self.act("radio", action="engage", on=True)
        self.act("rotator", action="engage", on=True)
        self.assertTrue(wait_until(lambda: self.rig.log and b"p\n" in self.rot.log))      # ต่ออุปกรณ์ทั้งสองแล้ว

    def assert_disengaged(self) -> None:
        self.assertEqual(self.listed(), [])
        self.assertTrue(wait_until(lambda: self.rig.log[-1:] == [b"q\n"] and self.rot.log[-1:] == [b"q\n"]))
        self.assertEqual(self.rot.log[-2:], [b"S\n", b"q\n"])

    def test_close_module_closes_controllers(self):
        self.engage_both()
        self.assertEqual(self.client.post("/api/modules/M/close").json(), {"open": []})
        self.assert_disengaged()
        self.assertIsNone(self.hub.get("M"))

    def test_close_module_forgets_target(self):
        self.put_hw([self.radio("A")])
        self.open_module()
        self.assertEqual(self.post("target", {"norad": AO91}).status_code, 204)
        self.assertEqual(self.client.post("/api/modules/M/close").status_code, 200)
        self.open_module()
        self.open_ctl("radio")
        self.assertEqual(self.act("radio", action="track", on=False)["norad"], SAT_BY_NAME)     # เป้าหมายเก่าถูกลืม

    def test_delete_module_closes_controllers(self):
        self.engage_both()
        self.assertEqual(self.client.delete("/api/modules/M").status_code, 204)
        self.assert_disengaged()
        self.assertIsNone(self.hub.get("M"))
        self.assertEqual(self.store.list_modules(), [])

    def test_close_unknown_module_is_404_and_changes_no_controller(self):
        self.put_hw([self.radio("A")])
        self.open_module()
        self.open_ctl("radio")
        self.assert_error(self.client.post("/api/modules/Nope/close"), 404, "NOT_FOUND", "Nope")
        self.assertEqual(self.listed(), [{"module": "M", "kind": "radio"}])

    def test_closing_one_module_keeps_the_other_modules_controllers(self):
        self.put_hw([self.radio("A")])
        self.put_module("N")
        self.open_module("M")
        self.open_module("N")
        self.open_ctl("radio")
        self.assertEqual(self.client.post("/api/modules/N/radio/open").status_code, 200)
        self.assertEqual(self.client.post("/api/modules/N/close").json(), {"open": ["M"]})
        self.assertEqual(self.listed(), [{"module": "M", "kind": "radio"}])

    def assert_controller_opened_during_retire_is_closed(self, retire) -> None:
        """อีกแท็บเปิด controller หลังที่ route ปิด controller รอบแรกแล้ว แต่ก่อน hub.close ของ module เสร็จ: ต้องไม่ค้างอยู่"""
        self.put_hw([self.radio("A")])
        self.open_module()
        real_close = self.hub.close

        def close_after_another_tab_opens(name):
            self.client.portal.call(self.app.state.controllers.open, name, "radio")
            real_close(name)

        with mock.patch.object(self.hub, "close", close_after_another_tab_opens):
            retire()
        self.assertEqual(self.listed(), [])
        self.assertIsNone(self.hub.get("M"))

    def test_controller_opened_while_module_closes_is_closed(self):
        self.assert_controller_opened_during_retire_is_closed(lambda: self.client.post("/api/modules/M/close"))

    def test_controller_opened_while_module_is_deleted_is_closed(self):
        self.assert_controller_opened_during_retire_is_closed(lambda: self.client.delete("/api/modules/M"))

    def test_shutdown_disengages(self):
        """ออกจาก TestClient context (lifespan จบ): ปลด Engage ก่อนปิด server rotator ได้ S แล้ว q"""
        self.put_hw([self.radio("A")], [self.rotator("R")])
        app = self.make_app()
        with TestClient(app) as client:
            self.assertEqual(client.post("/api/modules/M/open").status_code, 200)
            self.ephem.drain()
            for kind in ("radio", "rotator"):
                self.assertEqual(client.post(f"/api/modules/M/{kind}/open").status_code, 200)
                self.assertEqual(client.post(f"/api/modules/M/{kind}", json={"action": "engage", "on": True}).status_code, 200)
            self.assertTrue(wait_until(lambda: self.rig.log and b"p\n" in self.rot.log))
            self.assertNotEqual(self.rot.log[-1:], [b"q\n"])                          # ยังไม่ปลด
        self.assertTrue(wait_until(lambda: self.rig.log[-1:] == [b"q\n"] and self.rot.log[-1:] == [b"q\n"]))
        self.assertEqual(self.rot.log[-2:], [b"S\n", b"q\n"])
        self.assertEqual(app.state.controllers.open_list(), [])


# ---------------------------------------------------------------- Pass predictions

PASS_KEYS = ["orbit", "aos", "tca", "los", "max_el", "aos_az", "max_el_az", "los_az", "vis", "rows"]
PASS_ROW_KEYS = ["t", "az", "el", "ra", "dec", "range_km", "rate_kms", "lat_deg", "lon_deg", "ssp", "footprint_km",
                 "alt_km", "vel_kms", "doppler_hz", "loss_db", "delay_ms", "ma", "phase_deg", "vis"]
ORIGIN_DICT = {"name": "ORIGIN", "location": "Gulf of Guinea", "lat_deg": 0.0, "lon_deg": 0.0, "alt_m": 0.0}
NO_AOS_LONG = ("Satellite SAT-40001 has no passes for\nthe current ground station!\n\n"
               "This can be because the satellite\nis geostationary, decayed or simply\nnever comes above the horizon")
NO_AOS_SHORT = "Satellite SAT-40001 has no passes for\nthe current ground station!"


class DisconnectingRequest:
    """Request ปลอมของ route: is_disconnected() ครั้งแรกรอจน GMAT (ปลอม) เริ่มงาน block แล้วตอบ False ครั้งต่อไปตอบ True"""

    def __init__(self, started: threading.Event):
        self.started = started
        self.calls = 0

    async def is_disconnected(self) -> bool:
        self.calls += 1
        if self.calls == 1:
            await asyncio.to_thread(self.started.wait, 5)
            return False
        return True


class PassApiTestBase(ApiTestBase):
    """worker thread จริงของ EphemManager กับ PassPropagate: module M มีดาวทุกดวงของ pass_records
    (NORADS, GEO, HIDDEN, WOBBLE) ใช้สถานี ORIGIN และเปิดอยู่ โดยงานช่วงของ module เสร็จแล้ว"""

    ephem_worker = True

    def make_propagate(self):
        return PassPropagate()

    def satdb_records(self) -> list:
        return pass_records()

    def setUp(self):
        super().setUp()
        self.put_module(sats=[r.norad for r in pass_records()])
        self.open_module(drain=False)
        self.wait_until(lambda: self.hub.get("M").tick()["status"] == "ok")      # งานช่วงของ module เสร็จก่อน
        self.addCleanup(self.wait_until, self.worker_idle)                       # ไม่มีงานเขียนลง data dir ที่กำลังถูกลบ

    def wait_until(self, condition, timeout_s: float = 10.0) -> None:
        deadline = time.monotonic() + timeout_s
        while not condition():
            self.assertLess(time.monotonic(), deadline, "รอนานเกินไป")
            time.sleep(0.01)

    def worker_idle(self) -> bool:
        with self.ephem._lock:
            return self.ephem._running is None and not self.ephem._queue

    def ok(self, r) -> dict:
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()

    def set_prefs(self, values: dict) -> None:
        r = self.client.put("/api/prefs", json={"set": values})
        self.assertEqual(r.status_code, 200, r.text)


class PassesApiTest(PassApiTestBase):
    """POST /api/modules/{name}/passes (route รอ GMAT แบบ async ทุก 0.2 วินาที)"""

    def passes(self, kind: str, t, norad: int = NORADS[0], aos=None, name: str = "M", los=None):
        body = {"norad": norad, "kind": kind, "t": iso(t)}
        if aos is not None:
            body["aos"] = iso(aos)
        if los is not None:
            body["los"] = iso(los)
        return self.client.post(f"/api/modules/{name}/passes", json=body)

    def pass_owners(self) -> list[str]:
        with self.ephem._lock:
            return [o for o in self.ephem._day_pairs if o.startswith("pass:")]

    def test_next_pass_shape(self):
        n = NORADS[0]
        body = self.ok(self.passes("next", T0, n))
        self.assertEqual(list(body), ["sat", "qth", "pass"])
        self.assertEqual(body["sat"], {"norad": n, "name": f"SAT-{n}"})
        self.assertEqual(body["qth"], ORIGIN_DICT)
        p = body["pass"]
        self.assertEqual(list(p), PASS_KEYS)
        for key in ("aos", "tca", "los"):
            self.assertRegex(p[key], ISO_MS)
        aos = datetime.fromisoformat(p["aos"].replace("Z", "+00:00"))
        self.assertAlmostEqual((aos - peak(n)).total_seconds(), -half_pass_s(), delta=1.0)     # ใต้ขอบฟ้าที่ T0
        self.assertGreater(p["max_el"], 89.0)
        self.assertRegex(p["vis"], r"^[V-][D-][E-]$")
        self.assertEqual(len(p["rows"]), 21)
        self.assertEqual(list(p["rows"][0]), PASS_ROW_KEYS)
        self.assertEqual((p["rows"][0]["t"], p["rows"][-1]["t"]), (p["aos"], p["los"]))
        self.assertEqual(self.pass_owners(), [])

    def test_future_passes_respect_count_and_min_el(self):
        self.set_prefs({"PREDICT/NUMBER_OF_PASSES": 5, "PREDICT/MINIMUM_ELEV": 20})
        body = self.ok(self.passes("future", T0, WOBBLE))
        self.assertEqual(list(body), ["sat", "qth", "passes"])
        found = body["passes"]
        self.assertEqual(len(found), 5)
        self.assertTrue(all(p["max_el"] >= 20 for p in found), [p["max_el"] for p in found])
        self.assertTrue(all(list(p) == PASS_KEYS and p["rows"] for p in found))
        aos = [datetime.fromisoformat(p["aos"].replace("Z", "+00:00")) for p in found]
        self.assertEqual(aos, sorted(aos))
        self.assertGreater(aos[0], T0)
        # pass ที่ต่ำกว่า Minimum elevation ระหว่างนั้นถูกข้ามจริง
        spec = self.hub.get("M").sat_orbit(WOBBLE)[1]
        eph = self.ephem.get_days(spec, date(2026, 11, 11), date(2026, 11, 16))
        between = [p for p in find_passes(eph, qth_geo(ORIGIN)) if p.aos is not None and aos[0] <= p.aos <= aos[-1]]
        self.assertTrue(any(p.max_el < 20 for p in between))

    def test_no_aos_message_texts(self):
        for kind, text in (("next", NO_AOS_LONG), ("current", NO_AOS_LONG), ("future", NO_AOS_SHORT)):
            with self.subTest(kind=kind):
                body = self.ok(self.passes(kind, T0, GEO))
                self.assertEqual(list(body), ["sat", "qth", "message"])
                self.assertEqual(body["sat"], {"norad": GEO, "name": "SAT-40001"})
                self.assertEqual(body["message"], {"code": "PASS_NO_AOS", "level": "error", "text": text})
        self.assertFalse([c for c in self.fake.calls if is_day_job(c)])          # ไม่สั่ง GMAT เลย

    def test_no_pass_within_message(self):
        within3 = {"code": "PASS_NONE_WITHIN", "level": "info",
                   "text": f"Satellite SAT-{HIDDEN} has no passes\nwithin the next 3 days"}
        for kind in ("future", "next", "current"):
            with self.subTest(kind=kind):
                body = self.ok(self.passes(kind, T0, HIDDEN))
                self.assertEqual(list(body), ["sat", "qth", "message"])
                self.assertEqual(body["message"], within3)
        self.set_prefs({"PREDICT/LOOK_AHEAD": 1})
        self.assertEqual(self.ok(self.passes("future", T0, HIDDEN))["message"]["text"],
                         f"Satellite SAT-{HIDDEN} has no passes\nwithin the next 1 days")

    def test_at_finds_pass_by_aos(self):
        n = NORADS[0]
        target = self.ok(self.passes("future", T0, n))["passes"][1]
        aos = datetime.fromisoformat(target["aos"].replace("Z", "+00:00"))
        for shift in (-0.5, 0.5):
            with self.subTest(shift=shift):
                p = self.ok(self.passes("at", T0, n, aos=aos + timedelta(seconds=shift)))["pass"]
                self.assertEqual((p["aos"], p["los"], p["orbit"]), (target["aos"], target["los"], target["orbit"]))
                self.assertEqual(p["rows"], target["rows"])
        for shift in (2.0, 30 * 60.0):
            with self.subTest(shift=shift):
                self.assert_error(self.passes("at", T0, n, aos=aos + timedelta(seconds=shift)), 404, "NOT_FOUND",
                                  str(n))
        self.assertEqual(self.pass_owners(), [])

    def test_at_with_los_reads_only_the_days_of_the_pass(self):
        # Sky at a glance ส่ง LOS ของแท่งที่คลิกมาด้วย: ข้อมูลวันของ AOS ถึงวันของ LOS (spec §3.2) ไม่ใช่ ±1 วัน
        n = NORADS[0]
        target = self.ok(self.passes("future", T0, n))["passes"][1]
        aos, los = (datetime.fromisoformat(target[k].replace("Z", "+00:00")) for k in ("aos", "los"))
        self.assertEqual((aos.date(), los.date()), (date(2026, 11, 12), date(2026, 11, 12)))
        calls = len(self.fake.calls)
        with mock.patch.object(self.ephem, "ensure_days", wraps=self.ephem.ensure_days) as ensure:
            p = self.ok(self.passes("at", T0, n, aos=aos + timedelta(seconds=0.5), los=los))["pass"]
        self.assertEqual((p["aos"], p["los"], p["rows"]), (target["aos"], target["los"], target["rows"]))
        self.assertEqual([c.args[2:] for c in ensure.call_args_list], [(date(2026, 11, 12), date(2026, 11, 12))])
        self.assertEqual(len(self.fake.calls), calls)                     # วันนั้นมีอยู่แล้วจาก Future passes: ไม่สั่ง GMAT
        self.assertEqual(self.pass_owners(), [])

    def test_invalid_body_is_422(self):
        n, t = NORADS[0], iso(T0)
        cases = [({"norad": n, "kind": "later", "t": t}, "kind"),
                 ({"norad": n, "t": t}, "kind"),
                 ({"norad": n, "kind": "next", "t": "garbage"}, "t"),
                 ({"norad": n, "kind": "next", "t": "2026-11-12T07:20:00"}, "t"),           # ไม่มี timezone
                 ({"norad": n, "kind": "next", "t": 12345}, "t"),
                 ({"norad": n, "kind": "next", "t": "0001-01-01T00:00:00Z"}, "t"),
                 ({"norad": n, "kind": "next"}, "t"),
                 ({"norad": "25544", "kind": "next", "t": t}, "norad"),
                 ({"norad": True, "kind": "next", "t": t}, "norad"),
                 ({"norad": 25544.0, "kind": "next", "t": t}, "norad"),
                 ({"kind": "next", "t": t}, "norad"),
                 ({"norad": n, "kind": "at", "t": t}, "aos"),
                 ({"norad": n, "kind": "at", "t": t, "aos": "x"}, "aos"),
                 ({"norad": n, "kind": "at", "t": t, "aos": t, "los": "x"}, "los"),
                 ({"norad": n, "kind": "at", "t": t, "aos": t, "los": 12345}, "los"),
                 ({"norad": n, "kind": "at", "t": t, "aos": t, "los": "0001-01-01T00:00:00Z"}, "los")]
        for body, field in cases:
            with self.subTest(body=body):
                err = self.assert_error(self.client.post("/api/modules/M/passes", json=body), 422, "PASS_INVALID",
                                        field)
                if field in ("t", "aos", "los"):                         # ช่วงเวลาเดียวกับนาฬิกาของ module
                    self.assertTrue(err["text"].endswith(f"({field}) ต้องเป็น {CLOCK_TIME_TEXT}"), err["text"])
        # LOS ก่อน AOS หรือหลัง AOS เกิน 1 วัน (ไม่ใช่ pass ที่ Sky at a glance แสดงได้ และจะสั่ง GMAT หลายวันโดยไม่จำเป็น)
        for los in (T0 - timedelta(seconds=1), T0 + timedelta(days=1, seconds=1)):
            with self.subTest(los=los):
                body = {"norad": n, "kind": "at", "t": t, "aos": t, "los": iso(los)}
                err = self.assert_error(self.client.post("/api/modules/M/passes", json=body), 422, "PASS_INVALID", "los")
                self.assertRegex(err["text"], r"[ก-๙]")
        for body in ({"norad": n, "kind": "at", "t": t, "aos": t, "los": None},       # null = ไม่ส่ง
                     {"norad": n, "kind": "next", "t": t, "los": "x"}):                # kind อื่นไม่อ่าน los
            with self.subTest(body=body):
                self.assertNotEqual(self.client.post("/api/modules/M/passes", json=body).status_code, 422)
        self.assert_error(self.client.post("/api/modules/Nope/passes", json={"norad": n, "kind": "soon", "t": t}),
                          422, "PASS_INVALID", "kind")                                # ตรวจ body ก่อน module
        self.assert_error(self.client.post("/api/modules/M/passes", json=[1]), 422, "REQUEST_INVALID")

    def test_satellite_not_in_module_is_404(self):
        self.assert_error(self.passes("next", T0, 11111), 404, "NOT_FOUND", "11111")
        n = NORADS[0]
        self.put_module(sats=[r.norad for r in pass_records() if r.norad != n])    # เอาดาวออกขณะ module เปิดอยู่
        self.assert_error(self.passes("future", T0, n), 404, "NOT_FOUND", str(n))

    def test_module_not_open_is_404(self):
        self.assert_error(self.passes("next", T0, name="Nope"), 404, "NOT_FOUND", "Nope")
        self.client.post("/api/modules/M/close")
        self.assert_error(self.passes("next", T0), 404, "NOT_FOUND", "M")

    def test_gmat_failure_answers_503(self):
        n = NORADS[0]
        self.fake.fail = GmatRunError("GMAT ล้ม")
        body = self.assert_error(self.passes("next", T0, n), 503, "GMAT_FAILED", str(n))
        self.assertIn("GMAT ล้ม", body["text"])
        self.assertEqual(self.pass_owners(), [])
        self.fake.fail = None                                                    # Retry ในกล่องรอส่งคำขอใหม่
        self.ok(self.passes("next", T0, n))

    def test_satellite_missing_from_gmat_answers_503(self):
        n = NORADS[0]
        self.fake.drop = {n}
        self.assert_error(self.passes("next", T0, n), 503, "SAT_MISSING_FROM_GMAT", str(n))
        self.assertEqual(self.pass_owners(), [])

    def test_client_disconnect_releases_owner(self):
        self.fake.gate = threading.Event()
        self.addCleanup(self.fake.gate.set)
        route = next(r for r in self.app.routes if getattr(r, "path", None) == "/api/modules/{name}/passes")
        request = DisconnectingRequest(self.fake.started)
        response = asyncio.run(route.endpoint(name="M", request=request,
                                              body={"norad": NORADS[0], "kind": "future", "t": iso(T0)}))
        self.assertEqual(response.status_code, 499)
        self.assertTrue(self.fake.started.is_set())                             # GMAT กำลังรันตอน browser ตัด
        self.assertEqual(request.calls, 2)
        self.assertEqual(self.pass_owners(), [])
        with self.ephem._lock:
            running = self.ephem._running
        self.assertTrue(running is not None and running.cancelled)              # ไม่มีใครต้องการแล้ว: งานถูกตัด


class SkyGlanceApiTest(PassApiTestBase):
    """GET/DELETE /api/modules/{name}/skyglance: GET ไม่รอ GMAT (หน้าเว็บถามซ้ำทุก 1 วินาทีระหว่าง computing)
    owner ของ EphemManager คือ sky:<module> ปล่อยด้วย DELETE หรือเมื่อปิด module"""

    def sky(self, t=None, name: str = "M"):
        return self.client.get(f"/api/modules/{name}/skyglance", params={} if t is None else {"t": iso(t)})

    def sky_owners(self) -> list[str]:
        with self.ephem._lock:
            return [o for o in self.ephem._day_pairs if o.startswith("sky:")]

    def wait_status(self, status: str, t=T0) -> dict:
        self.wait_until(lambda: self.ok(self.sky(t))["status"] == status)
        return self.ok(self.sky(t))

    def test_get_does_not_wait_for_gmat_then_ok(self):
        self.fake.gate = threading.Event()
        self.addCleanup(self.fake.gate.set)
        begin = time.monotonic()
        body = self.ok(self.sky(T0))
        self.assertEqual(list(body), ["status", "t0", "hours", "sats", "messages"])
        self.assertEqual((body["status"], body["t0"], body["hours"], body["sats"]), ("computing", iso(T0), 8, []))
        self.assertTrue(self.fake.started.wait(10))                              # งาน block รายวันกำลังรันและถูกกั้นไว้
        self.assertEqual(self.ok(self.sky(T0))["status"], "computing")
        self.assertLess(time.monotonic() - begin, 5.0)                           # ไม่ได้รอ GMAT (gate รอได้สูงสุด 10 วินาที)
        self.fake.gate.set()
        body = self.wait_status("ok")
        self.assertEqual([s["name"] for s in body["sats"]],
                         ["SAT-7530", "SAT-25544", "SAT-40001", "SAT-40002", "SAT-40003", "SAT-43017"])
        sat = body["sats"][1]
        self.assertEqual(list(sat), ["norad", "name", "colour", "passes"])
        self.assertRegex(sat["colour"], r"^#[0-9a-f]{6}$")
        self.assertGreater(len(sat["passes"]), 3)
        self.assertEqual(list(sat["passes"][0]), PASS_KEYS[:-1])                  # สรุป pass ไม่มี rows
        for key in ("aos", "tca", "los"):
            self.assertRegex(sat["passes"][0][key], ISO_MS)
        self.assertEqual(self.sky_owners(), ["sky:M"])

    def test_t_is_optional_and_means_module_time(self):
        self.assertEqual(self.ok(self.sky())["t0"], iso(T0))
        self.client.put("/api/modules/M/clock", json={"state": "stop", "time": iso(T0 + timedelta(hours=2))})
        self.assertEqual(self.ok(self.sky())["t0"], iso(T0 + timedelta(hours=2)))
        self.assertEqual(self.ok(self.sky(T0 + timedelta(hours=1)))["t0"], iso(T0 + timedelta(hours=1)))
        self.set_prefs({"PREDICT/USE_REAL_T0": True})
        self.assertEqual(self.ok(self.sky(T0 + timedelta(hours=1)))["t0"], iso(self.wall.t))
        self.assertEqual(self.ok(self.sky())["t0"], iso(T0 + timedelta(hours=2)))

    def test_hours_follow_preference(self):
        self.set_prefs({"SKY_AT_GLANCE/TIME_SPAN_HOURS": 12, "SKY_AT_GLANCE/COLOUR_01": "#010203"})
        body = self.wait_status("ok")
        self.assertEqual((body["hours"], body["sats"][0]["colour"]), (12, "#010203"))

    def test_delete_releases_owner(self):
        self.ok(self.sky(T0))
        self.assertEqual(self.sky_owners(), ["sky:M"])
        r = self.client.delete("/api/modules/M/skyglance")
        self.assertEqual((r.status_code, r.content), (204, b""))
        self.assertEqual(self.sky_owners(), [])
        self.assertEqual(self.client.delete("/api/modules/M/skyglance").status_code, 204)        # ปล่อยซ้ำไม่เป็นไร
        self.assertEqual(self.client.delete("/api/modules/Nope/skyglance").status_code, 204)     # module ปิดไปก่อนแล้ว

    def test_close_module_releases_sky_owner(self):
        self.ok(self.sky(T0))
        self.assertEqual(self.sky_owners(), ["sky:M"])
        self.assertEqual(self.client.post("/api/modules/M/close").status_code, 200)
        self.assertEqual(self.sky_owners(), [])

    def test_module_not_open_is_404(self):
        self.assert_error(self.sky(T0, "Nope"), 404, "NOT_FOUND", "Nope")
        self.client.post("/api/modules/M/close")
        self.assert_error(self.sky(T0), 404, "NOT_FOUND", "M")

    def test_invalid_t_is_422(self):
        for value in ("garbage", "2026-11-12T07:20:00", "0001-01-01T00:00:00Z", ""):
            with self.subTest(t=value):
                err = self.assert_error(self.client.get("/api/modules/M/skyglance", params={"t": value}), 422,
                                        "PASS_INVALID", "t")
                self.assertTrue(err["text"].endswith(f"(t) ต้องเป็น {CLOCK_TIME_TEXT}"), err["text"])
        self.assertEqual(self.sky_owners(), [])

    def test_gmat_failure_shows_failed_and_reopening_retries(self):
        self.fake.fail = GmatRunError("GMAT ล้ม")
        self.ok(self.sky(T0))
        body = self.wait_status("failed")
        self.assertEqual(body["sats"], [])
        self.assertEqual([(m["code"], m["level"]) for m in body["messages"]], [("GMAT_FAILED", "error")])
        self.assertIn("GMAT ล้ม", body["messages"][0]["text"])
        self.fake.fail = None
        self.client.delete("/api/modules/M/skyglance")                           # ปิดหน้าต่างแล้วเปิดใหม่ = ลองใหม่
        self.ok(self.sky(T0))
        self.assertEqual(self.wait_status("ok")["status"], "ok")


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
        self.put_module(refresh={"data_ms": 100}, pin=["refresh.data_ms"])
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
        with self.assertLogs("gpredict_web", "WARNING") as logs:          # store: ย้ายไม่ได้, app: เปิดไม่ได้
            client = self.start()
        self.assertIn("Broken", "\n".join(r.getMessage() for r in logs.records if r.name == "gpredict_web.app"))
        self.assertIn("Broken", "\n".join(r.getMessage() for r in logs.records if r.name == "gpredict_web.store"))
        self.assertEqual(self.opener.urls, [])                              # มี module แล้ว: ไม่ bootstrap module
        self.assertEqual(self.app.state.hub.open_names(), ["B", "A"])
        body = client.get("/api/modules").json()
        self.assertEqual(body["open"], ["B", "A"])
        self.assertEqual(self.store.session(), ["B", "A"])
        self.assertEqual([(m["code"], m["object"]) for m in body["messages"]], [("MODULE_INVALID", "Broken")])

    def test_startup_migrates_core_module_files_before_opening_the_session(self):
        """Review Focus 1: เปิด server ครั้งแรกหลังอัปเกรด ไฟล์ module แบบ core ถูกย้ายก่อนเปิด module ที่ค้างใน session"""
        self.store.put_qth(ORIGIN)
        self.store.set_default_qth("ORIGIN")
        self.write_satdb([record(n) for n in NORADS])
        core = module_to_dict(module_from_dict({"name": "Old", "satellites": list(NORADS), "layout_code": "1;0;2;0;1",
                                                "refresh": {"data_ms": 100}}, None, None))
        for path in ("window", "map.file", "map.colours", "map.shadow_alpha", "polar.colours"):
            *parents, last = path.split(".")                                  # ช่องที่ core ยังไม่มี
            section = core
            for p in parents:
                section = section[p]
            del section[last]
        modules = self.cfg.data_dir / "modules"
        modules.mkdir(parents=True)
        original = json.dumps(core).encode("utf-8")
        (modules / "Old.json").write_bytes(original)
        self.store.set_session(["Old"])
        with self.assertLogs("gpredict_web.app", "INFO") as logs:
            client = self.start()
        self.assertIn("Old", "\n".join(logs.output))
        own = json.loads((modules / "Old.json").read_text(encoding="utf-8"))
        self.assertEqual((own["version"], own["layout_code"], own["refresh"]), (2, "1;0;2;0;1", {"data_ms": 100}))
        self.assertEqual((modules / "_backup_v1" / "Old.json").read_bytes(), original)
        self.assertEqual(client.get("/api/modules").json()["open"], ["Old"])
        self.assertEqual(self.app.state.hub.get("Old").module.layout_code, "1;0;2;0;1")
        self.assertEqual(client.get("/api/modules/Old").json(), module_to_dict(module_from_dict(core, None, None)))

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

    def shutdown_steps(self, controllers_fail: bool) -> tuple[list[str], object]:
        """เริ่มแล้วปิด app (มี module Amateur เปิดอยู่) คืนลำดับขั้นตอนตอนปิด และ runtime ของ Amateur
        controllers.shutdown พังเมื่อ controllers_fail (RuntimeError ส่งออกจาก with TestClient)"""
        self.opener.bodies["amateur"] = json.dumps(SAMPLE).encode("utf-8")
        app = self.make_app(start_background=True)
        controllers, ticks, hub = app.state.controllers, app.state.ticks, app.state.hub
        steps: list[str] = []
        real_controllers, real_ticks, real_hub, real_ephem = controllers.shutdown, ticks.shutdown, hub.close, self.ephem.close

        async def controllers_shutdown():
            steps.append("controllers")
            if controllers_fail:
                raise RuntimeError("ปิด controller ไม่สำเร็จ")
            await real_controllers()

        async def ticks_shutdown():
            steps.append("ticks")
            await real_ticks()

        def hub_close(name):
            steps.append(f"hub:{name}")
            real_hub(name)

        def ephem_close():
            steps.append("ephem")
            real_ephem()

        with (mock.patch.object(controllers, "shutdown", controllers_shutdown), mock.patch.object(ticks, "shutdown", ticks_shutdown),
              mock.patch.object(hub, "close", hub_close), mock.patch.object(self.ephem, "close", ephem_close)):
            if controllers_fail:
                with self.assertRaisesRegex(RuntimeError, "ปิด controller ไม่สำเร็จ"):
                    with TestClient(app):
                        rt = hub.get("Amateur")
            else:
                with TestClient(app):
                    rt = hub.get("Amateur")
        return steps, rt

    def test_shutdown_order_is_controllers_ticks_hub_ephem(self):
        steps, rt = self.shutdown_steps(controllers_fail=False)
        self.assertEqual(steps, ["controllers", "ticks", "hub:Amateur", "ephem"])
        self.assertTrue(rt.closed)

    def test_shutdown_continues_when_controllers_fail(self):
        """controllers.shutdown พัง: ticks, runtime ของ module และ EphemManager (kill GMAT) ยังถูกปิด"""
        steps, rt = self.shutdown_steps(controllers_fail=True)
        self.assertEqual(steps, ["controllers", "ticks", "hub:Amateur", "ephem"])
        self.assertTrue(rt.closed)

    def test_no_background_work_without_start_background(self):
        with mock.patch.object(self.ephem, "prune") as prune:
            self.app = self.make_app(start_background=False)
            client = self.enter(self.app)
        prune.assert_not_called()
        self.assertEqual(client.get("/api/qth").json(), {"qth": [], "default": None, "messages": []})
        self.assertEqual(self.opener.urls, [])


if __name__ == "__main__":
    unittest.main()
