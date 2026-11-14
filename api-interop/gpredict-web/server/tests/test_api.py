"""REST API (หัวข้อ 7.3 และ 7.4 ของ spec) ด้วย TestClient: EphemManager จริงกับ propagate ปลอม (start_worker=False แล้ว drain()),
นาฬิกาเครื่องปลอม, opener ปลอม (ห้ามใช้เน็ต) และ data dir ชั่วคราว"""

import asyncio
import json
import threading
import time
import unittest
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
from gpredict_web.module import (LAYOUT_PRESETS, LIST_COLUMNS, LIST_HINTS, MAP_CONTENTS, POLAR_CONTENTS,
                                 POLAR_ORIENTATIONS, SINGLE_FIELDS, SINGLE_HINTS, module_from_dict, module_to_dict)
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

    def test_get_hwconf_skips_a_broken_file(self):
        """แก้ไฟล์ด้วยมือจนพัง: GET ยังตอบได้ ข้ามไฟล์นั้นพร้อม log (ไม่ใช่ 500)"""
        self.client.put("/api/hwconf", json={"radios": [HW_RADIO], "rotators": [HW_ROTATOR]})
        (self.hwconf_dir / "BROKEN.rig.json").write_text("{not json", encoding="utf-8")
        with self.assertLogs("gpredict_web.hwconf", "WARNING") as logs:
            r = self.client.get("/api/hwconf")
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json(), {"radios": [HW_RADIO], "rotators": [HW_ROTATOR]})
        self.assertIn("BROKEN.rig.json", "\n".join(logs.output))


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
