"""WebSocket /ws/app: เหตุการณ์ระดับโปรแกรม prefs_changed, modules_changed และ tle_old ถึงทุก browser (spec งานย่อย 4 §5.3, §12)
ส่วนแรกเป็น test ของ AppEvents ด้วย socket ปลอม ส่วนที่สองเป็น test ของ route ด้วย TestClient"""

import asyncio
import json
import threading
import unittest
from unittest import mock

from starlette.websockets import WebSocketDisconnect

from gpredict_web import appevents
from gpredict_web.appevents import AppEvents
from gpredict_web.tleage import TLE_OLD_TEXT
from tests.helpers import ws_receive_json
from tests.test_api import ApiTestBase, wait_until

TLE_OLD = {"type": "tle_old", "text": TLE_OLD_TEXT}
PREFS = {"type": "prefs_changed"}
MODULES = {"type": "modules_changed"}
FLUSH = {"type": "flush"}


class FakeSocket:
    """WebSocket ปลอมของ AppEvents: จดข้อความที่ส่งและ close code; fail = ส่งไม่ได้ (client หลุด), hang = ส่งไม่ทัน"""

    def __init__(self, fail: bool = False, hang: bool = False):
        self.fail, self.hang = fail, hang
        self.sent: list[dict] = []
        self.closed: list[int] = []

    async def send_text(self, text: str) -> None:
        if self.hang:
            await asyncio.sleep(3600)
        if self.fail:
            raise RuntimeError("client หลุดไปแล้ว")
        self.sent.append(json.loads(text))

    async def close(self, code: int = 1000) -> None:
        self.closed.append(code)


async def until(predicate, timeout: float = 3.0) -> bool:
    for _ in range(int(timeout / 0.005)):
        if predicate():
            return True
        await asyncio.sleep(0.005)
    return predicate()


class AppEventsTest(unittest.IsolatedAsyncioTestCase):
    @staticmethod
    def pumps() -> list[asyncio.Task]:
        return [t for t in asyncio.all_tasks() if t.get_name() == "app-events" and not t.done()]

    async def asyncSetUp(self):
        self.events = AppEvents()
        self.events.bind(asyncio.get_running_loop())
        self.addAsyncCleanup(self.events.shutdown)

    async def test_publish_reaches_every_socket_in_order(self):
        a, b = FakeSocket(), FakeSocket()
        await self.events.add(a)
        await self.events.add(b)
        for n in range(3):
            self.events.publish({"type": "n", "n": n})
        self.assertTrue(await until(lambda: len(a.sent) == 3 and len(b.sent) == 3))
        expected = [{"type": "n", "n": n} for n in range(3)]
        self.assertEqual((a.sent, b.sent), (expected, expected))

    async def test_publish_without_socket_is_dropped(self):
        self.events.publish(PREFS)
        await asyncio.sleep(0.05)                                # pump ทิ้งเหตุการณ์นี้ (ไม่มี socket)
        a = FakeSocket()
        await self.events.add(a)
        self.events.publish(MODULES)
        self.assertTrue(await until(lambda: a.sent))
        self.assertEqual(a.sent, [MODULES])                      # publish ธรรมดาไม่ถูกเก็บไว้ให้ socket ที่มาทีหลัง

    async def test_publish_from_another_thread(self):
        a = FakeSocket()
        await self.events.add(a)
        worker = threading.Thread(target=self.events.publish, args=(PREFS,))
        worker.start()
        worker.join()
        self.assertTrue(await until(lambda: a.sent))
        self.assertEqual(a.sent, [PREFS])

    async def test_removed_socket_gets_nothing(self):
        a, b = FakeSocket(), FakeSocket()
        await self.events.add(a)
        await self.events.add(b)
        self.events.remove(a)
        self.events.remove(a)                                    # ซ้ำได้
        self.events.publish(PREFS)
        self.assertTrue(await until(lambda: b.sent))
        self.assertEqual((a.sent, b.sent, self.events.sockets()), ([], [PREFS], [b]))

    async def test_held_event_goes_to_the_first_socket_only(self):
        self.events.publish_or_hold(TLE_OLD)
        await asyncio.sleep(0.05)                                # ให้ event ถูกเก็บไว้ก่อน (ไม่มี socket)
        first, second = FakeSocket(), FakeSocket()
        await self.events.add(first)
        self.assertTrue(await until(lambda: first.sent))
        await self.events.add(second)
        self.events.publish(MODULES)
        self.assertTrue(await until(lambda: second.sent))
        self.assertEqual(first.sent, [TLE_OLD, MODULES])
        self.assertEqual(second.sent, [MODULES])

    async def test_held_events_keep_their_order_before_later_events(self):
        for n in range(3):
            self.events.publish_or_hold({"type": "h", "n": n})
        await asyncio.sleep(0.05)
        a = FakeSocket()
        await self.events.add(a)
        self.events.publish(PREFS)
        self.assertTrue(await until(lambda: len(a.sent) == 4))
        self.assertEqual(a.sent, [{"type": "h", "n": 0}, {"type": "h", "n": 1}, {"type": "h", "n": 2}, PREFS])

    async def test_publish_or_hold_with_sockets_sends_to_all_and_holds_nothing(self):
        a, b = FakeSocket(), FakeSocket()
        await self.events.add(a)
        await self.events.add(b)
        self.events.publish_or_hold(TLE_OLD)
        self.assertTrue(await until(lambda: a.sent and b.sent))
        c = FakeSocket()
        await self.events.add(c)
        self.events.publish(PREFS)
        self.assertTrue(await until(lambda: c.sent))
        self.assertEqual((a.sent, b.sent, c.sent), ([TLE_OLD, PREFS], [TLE_OLD, PREFS], [PREFS]))

    async def test_publish_or_hold_after_last_socket_left_holds_again(self):
        a = FakeSocket()
        await self.events.add(a)
        self.events.remove(a)
        self.events.publish_or_hold(TLE_OLD)
        await asyncio.sleep(0.05)
        b = FakeSocket()
        await self.events.add(b)
        self.assertTrue(await until(lambda: b.sent))
        self.assertEqual((a.sent, b.sent), ([], [TLE_OLD]))

    async def test_held_event_survives_a_first_socket_that_cannot_receive(self):
        self.events.publish_or_hold(TLE_OLD)
        await asyncio.sleep(0.05)
        dead = FakeSocket(fail=True)
        await self.events.add(dead)
        self.assertTrue(await until(lambda: dead.closed))
        self.assertEqual(dead.closed, [appevents.CLOSE_SEND_FAILED])
        live = FakeSocket()
        await self.events.add(live)
        self.assertTrue(await until(lambda: live.sent))
        self.assertEqual(live.sent, [TLE_OLD])

    async def test_dead_socket_is_closed_and_dropped_without_blocking_others(self):
        dead, live = FakeSocket(fail=True), FakeSocket()
        await self.events.add(dead)
        await self.events.add(live)
        self.events.publish(PREFS)
        self.events.publish(MODULES)
        self.assertTrue(await until(lambda: len(live.sent) == 2))
        self.assertEqual(live.sent, [PREFS, MODULES])
        self.assertEqual(dead.closed, [appevents.CLOSE_SEND_FAILED])
        self.assertEqual(self.events.sockets(), [live])

    async def test_socket_that_cannot_keep_up_is_dropped(self):
        slow, live = FakeSocket(hang=True), FakeSocket()
        await self.events.add(slow)
        await self.events.add(live)
        with mock.patch.object(appevents, "SEND_TIMEOUT_S", 0.05):
            self.events.publish(PREFS)
            self.assertTrue(await until(lambda: slow.closed))
        self.assertEqual((slow.closed, live.sent, self.events.sockets()), ([appevents.CLOSE_SEND_FAILED], [PREFS], [live]))

    async def test_shutdown_closes_sockets_and_stops_the_pump(self):
        a, b = FakeSocket(), FakeSocket()
        await self.events.add(a)
        await self.events.add(b)
        self.assertTrue(self.events.bound)
        self.assertEqual(len(self.pumps()), 1)
        await self.events.shutdown()
        self.assertFalse(self.events.bound)
        self.assertEqual(self.pumps(), [])
        self.assertEqual((a.closed, b.closed), ([appevents.CLOSE_SERVER_STOP], [appevents.CLOSE_SERVER_STOP]))
        self.assertEqual(self.events.sockets(), [])
        self.events.publish(PREFS)                               # หลังปิด: ไม่ error ไม่มีใครรับ
        self.events.publish_or_hold(TLE_OLD)
        await self.events.shutdown()                             # ปิดซ้ำได้
        self.assertEqual((a.sent, b.sent), ([], []))

    async def test_can_bind_again_after_shutdown(self):
        await self.events.shutdown()
        self.events.bind(asyncio.get_running_loop())
        a = FakeSocket()
        await self.events.add(a)
        self.events.publish(PREFS)
        self.assertTrue(await until(lambda: a.sent))
        self.assertEqual(a.sent, [PREFS])

    async def test_a_failing_delivery_does_not_stop_later_ones(self):
        a = FakeSocket()
        await self.events.add(a)
        self.events.publish({"bad": {1, 2}})                     # JSON ไม่ได้: ข้ามอันนี้ (log) อันถัดไปยังถึง
        self.events.publish(PREFS)
        with self.assertLogs("gpredict_web.appevents", "ERROR"):
            self.assertTrue(await until(lambda: a.sent))
        self.assertEqual(a.sent, [PREFS])


class AppSocketTest(ApiTestBase):
    """route /ws/app และเหตุการณ์ที่ route อื่นส่ง: ตรวจลำดับด้วย sentinel (เหตุการณ์ FIFO จึงมาก่อน sentinel เสมอ)"""

    @property
    def events(self):
        return self.app.state.events

    def connect(self, **kw):
        """socket ใหม่ที่ server ลงทะเบียนแล้ว (เหตุการณ์ที่ส่งก่อนลงทะเบียนไม่ถึง socket นี้)"""
        expected = len(self.events.sockets()) + 1
        ws = self.client.websocket_connect("/ws/app", **kw)
        session = ws.__enter__()
        self.addCleanup(ws.__exit__, None, None, None)
        self.assertTrue(wait_until(lambda: len(self.events.sockets()) == expected))
        return session

    def flush(self, ws) -> list[dict]:
        """เหตุการณ์ที่ socket ได้รับจนถึง sentinel ที่ส่งตอนนี้"""
        self.events.publish(FLUSH)
        got = []
        while (message := ws_receive_json(ws)) != FLUSH:
            got.append(message)
        return got

    # ---- route

    def test_prefs_changed_event(self):
        ws = self.connect()
        r = self.client.put("/api/prefs", json={"set": {"PREDICT/NUMBER_OF_PASSES": 25}})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(ws_receive_json(ws), PREFS)
        station = {"name": "NEW", "location": "NEW town", "lat_deg": 1.5, "lon_deg": 2.5, "alt_m": 3.0}
        r = self.client.put("/api/qth/batch", json={"stations": [station], "default": "NEW"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(ws_receive_json(ws), PREFS)
        self.assertEqual(self.flush(ws), [])                                  # ครั้งละหนึ่งเหตุการณ์

    def test_dry_run_and_rejected_changes_publish_nothing(self):
        ws = self.connect()
        station = {"name": "NEW", "location": "NEW town", "lat_deg": 1.5, "lon_deg": 2.5, "alt_m": 3.0}
        self.assertEqual(self.client.put("/api/prefs?dry_run=true", json={"set": {"PREDICT/NUMBER_OF_PASSES": 25}}).status_code, 200)
        self.assertEqual(self.client.put("/api/qth/batch?dry_run=true", json={"stations": [station], "default": "NEW"}).status_code, 200)
        self.assertEqual(self.client.put("/api/prefs", json={"set": {"NO/SUCH_KEY": 1}}).status_code, 422)
        self.assertEqual(self.client.put("/api/qth/batch", json={"stations": [], "default": "NEW"}).status_code, 422)
        self.assertEqual(self.flush(ws), [])
        self.assertEqual(self.app.state.prefs.get("PREDICT/NUMBER_OF_PASSES"), self.app.state.prefs.defaults()["PREDICT/NUMBER_OF_PASSES"])
        self.assertEqual(self.store.qth_names(), ["ORIGIN", "OTHER"])

    def test_modules_changed_event(self):
        ws = self.connect()
        self.put_module()                                                     # PUT
        self.assertEqual(ws_receive_json(ws), MODULES)
        self.open_module()                                                    # open
        self.assertEqual(ws_receive_json(ws), MODULES)
        r = self.client.post("/api/modules/M/clone", json={"new_name": "C", "open": False})        # clone
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(ws_receive_json(ws), MODULES)
        r = self.client.put("/api/modules/M/window", json={"state": 1})                           # Detach
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(ws_receive_json(ws), MODULES)
        r = self.client.put("/api/modules/M/window", json={"width": 800, "height": 600})          # จำขนาดหน้าต่าง
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(ws_receive_json(ws), MODULES)
        r = self.client.put("/api/modules/M/window", json={"state": 0})                           # Attach
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(ws_receive_json(ws), MODULES)
        self.assertEqual(self.client.post("/api/modules/M/close").status_code, 200)               # close
        self.assertEqual(ws_receive_json(ws), MODULES)
        self.assertEqual(self.client.delete("/api/modules/C").status_code, 204)                   # DELETE
        self.assertEqual(ws_receive_json(ws), MODULES)
        self.assertEqual(self.flush(ws), [])

    def config_changed(self, *names: str) -> dict:
        return {"type": "module_config_changed", "modules": list(names)}

    def test_station_delete_names_the_module_and_its_reread_config_saves(self):
        """(v) Preferences → Ground Stations ลบสถานีของ module M ที่เปิดอยู่: module_config_changed บอกชื่อ M หน้าที่แสดง M อ่าน config
        ใหม่ (qth null ตามไฟล์และ runtime) แล้วบันทึก view ได้ ไม่ 422 (final review server Important 2 / web I1)"""
        self.put_module()                                                     # M ใช้ ORIGIN
        self.put_module("N", qth="OTHER")
        self.open_module()
        held = self.client.get("/api/modules/M").json()                      # ที่หน้าเว็บถือไว้ตั้งแต่แสดงแท็บ
        ws = self.connect()
        station = {"name": "OTHER", "location": "There", "lat_deg": 1.5, "lon_deg": 2.5, "alt_m": 3.0}
        with self.assertLogs("gpredict_web.store", "ERROR"):
            r = self.client.put("/api/qth/batch", json={"stations": [station], "default": "OTHER"})
        self.assertEqual((r.status_code, r.json()["changed_modules"]), (200, ["M"]))
        self.assertEqual(self.flush(ws), [PREFS, self.config_changed("M")])
        stale = self.client.put("/api/modules/M", json={**held, "ground_track": [held["satellites"][0]]})
        self.assert_error(stale, 422, "MODULE_INVALID", "qth")                # ค่าเก่าที่ยังไม่อ่านใหม่ (เหตุที่ต้องอ่านใหม่)
        reread = self.client.get("/api/modules/M").json()
        self.assertIsNone(reread["qth"])
        r = self.client.put("/api/modules/M", json={**reread, "ground_track": [held["satellites"][0]]})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(self.hub.get("M").qth.name, "ORIGIN")                # สถานีเดิมจนกว่าจะสร้างใหม่

    def test_module_config_changed_event(self):
        """เหตุการณ์บอกชื่อ module ที่เปิดอยู่ซึ่ง config ของ runtime เปลี่ยนจากนอกหน้าที่แสดงมัน: บันทึก module (view save จากอีกหน้า),
        Configure → OK (?recreate=true) และ PUT /api/qth/{name} ที่ module ที่เปิดอยู่ใช้ module ที่ไม่ได้เปิดหรือไม่เปลี่ยนไม่ถูกบอก"""
        self.put_module()                                                     # M ใช้ ORIGIN
        self.put_module("C", qth="ORIGIN")                                    # C ใช้ ORIGIN แต่ไม่ได้เปิด
        self.open_module()
        ws = self.connect()
        body = self.client.get("/api/modules/M").json()
        self.assertEqual(self.client.put("/api/modules/M", json={**body, "ground_track": [body["satellites"][0]]}).status_code, 200)
        self.assertEqual(self.flush(ws), [MODULES, self.config_changed("M")])
        self.assertEqual(self.client.put("/api/modules/M", json=self.client.get("/api/modules/M").json()).status_code, 200)
        self.assertEqual(self.flush(ws), [MODULES])                           # ไม่มีอะไรเปลี่ยน
        self.assertEqual(self.client.put("/api/modules/M?recreate=true", json=self.client.get("/api/modules/M").json()).status_code, 200)
        self.assertEqual(self.flush(ws), [MODULES, self.config_changed("M")])  # Configure → OK บอกเสมอ
        station = {"name": "ORIGIN", "location": "Moved", "lat_deg": 0.5, "lon_deg": 0.0, "alt_m": 0.0}
        self.assertEqual(self.client.put("/api/qth/ORIGIN", json=station).status_code, 200)
        self.assertEqual(self.flush(ws), [self.config_changed("M")])
        self.assertEqual(self.client.put("/api/qth/OTHER", json={**station, "name": "OTHER"}).status_code, 200)
        self.assertEqual(self.flush(ws), [])                                  # ไม่มี module ที่เปิดอยู่ใช้ OTHER
        with self.assertLogs("gpredict_web.app", "ERROR"):                     # ไม่มีเน็ต: reload ทุก module แต่ config ไม่เปลี่ยน
            self.assertEqual(self.client.post("/api/tle/update").status_code, 200)
        self.assertEqual(self.flush(ws), [])

    def test_failed_module_requests_publish_nothing(self):
        self.put_module()
        ws = self.connect()
        self.assert_error(self.client.put("/api/modules/M", json={**self.module_body(), "qth": "NOPE"}), 422, "MODULE_INVALID")
        self.assert_error(self.client.put("/api/modules/M", json={**self.module_body("X")}), 422, "MODULE_INVALID", "name")
        self.assert_error(self.client.post("/api/modules/NOPE/open"), 404, "NOT_FOUND")
        self.assert_error(self.client.post("/api/modules/NOPE/close"), 404, "NOT_FOUND")
        self.assert_error(self.client.post("/api/modules/M/clone", json={"new_name": "bad name"}), 422, "MODULE_INVALID")
        self.assert_error(self.client.post("/api/modules/M/clone", json={"new_name": "M"}), 422, "MODULE_INVALID")
        self.assert_error(self.client.put("/api/modules/M/window", json={"width": 10}), 422, "MODULE_INVALID", "window.width")
        self.assert_error(self.client.put("/api/modules/M/window", json={"state": 2}), 422, "MODULE_INVALID", "window.state")
        self.assert_error(self.client.put("/api/modules/M/window", json=[1]), 422, "REQUEST_INVALID")
        self.assert_error(self.client.put("/api/modules/NOPE/window", json={"state": 1}), 404, "NOT_FOUND")
        self.assertEqual(self.flush(ws), [])

    def test_events_reach_every_browser(self):
        one, two = self.connect(), self.connect()
        self.client.put("/api/prefs", json={"set": {"PREDICT/NUMBER_OF_PASSES": 25}})
        self.assertEqual((ws_receive_json(one), ws_receive_json(two)), (PREFS, PREFS))

    def test_closed_browser_does_not_break_publishing(self):
        gone = self.connect()
        stays = self.connect()
        gone.close()
        self.assertTrue(wait_until(lambda: len(self.events.sockets()) == 1))
        self.client.put("/api/prefs", json={"set": {"PREDICT/NUMBER_OF_PASSES": 25}})
        self.assertEqual(ws_receive_json(stays), PREFS)

    def test_held_tle_old_goes_to_first_socket(self):
        """ไม่มี browser เปิดตอนแจ้ง: ข้อความถูกเก็บไว้ให้ socket แรกที่ต่อเข้ามา socket ถัดไปไม่ได้"""
        self.events.publish_or_hold(TLE_OLD)                                  # เรียกจาก thread ของ test (นอก event loop)
        first = self.connect()
        self.assertEqual(ws_receive_json(first), TLE_OLD)
        second = self.connect()
        self.client.put("/api/prefs", json={"set": {"PREDICT/NUMBER_OF_PASSES": 25}})
        self.assertEqual((ws_receive_json(first), ws_receive_json(second)), (PREFS, PREFS))
        self.assertEqual(self.flush(second), [])

    def test_app_ws_rejects_foreign_origin(self):
        """Origin http://evil.example: ปิด 1008 ก่อน accept และไม่ลงทะเบียน socket (ผ่าน _HostOriginGuard ของ core)"""
        for headers in ({"origin": "http://evil.example"}, {"origin": "null"}, {"host": "evil.example"}):
            with self.subTest(headers=headers), self.assertRaises(WebSocketDisconnect) as ctx:
                with self.client.websocket_connect("/ws/app", headers=headers):
                    pass
            self.assertEqual(ctx.exception.code, 1008)
        self.assertEqual(self.events.sockets(), [])
        ws = self.connect(headers={"origin": "http://localhost:5173"})
        self.client.put("/api/prefs", json={"set": {"PREDICT/NUMBER_OF_PASSES": 25}})
        self.assertEqual(ws_receive_json(ws), PREFS)

    def test_lifespan_binds_and_stops_the_event_channel(self):
        app = self.make_app()
        self.assertFalse(app.state.events.bound)
        with self.client.__class__(app) as client:
            self.assertTrue(app.state.events.bound)
            with client.websocket_connect("/ws/app"):
                self.assertTrue(wait_until(lambda: len(app.state.events.sockets()) == 1))
        self.assertFalse(app.state.events.bound)
        self.assertEqual(app.state.events.sockets(), [])

    def test_app_socket_does_not_disturb_module_ticks(self):
        """/ws/app ไม่รบกวน /ws/modules/{name}"""
        self.put_module(refresh={"data_ms": 100}, pin=["refresh.data_ms"])
        self.open_module()
        app_ws = self.connect()
        with self.client.websocket_connect("/ws/modules/M") as tick_ws:
            self.assertEqual(ws_receive_json(tick_ws)["status"], "ok")
            self.assertEqual(self.flush(app_ws), [])


if __name__ == "__main__":
    unittest.main()
