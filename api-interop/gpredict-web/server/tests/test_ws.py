"""WebSocket /ws/modules/{name} (หัวข้อ 6.4 และ 7.3 ของ spec): producer เดียวต่อ module ที่เปิดอยู่ ส่ง tick เดียวกันให้ทุก socket
ทุก refresh.data_ms ปิดหรือลบ module แล้ว socket ปิดด้วย 1000 module ที่ไม่ได้เปิดปิดด้วย 1008"""

import time
import unittest
from datetime import datetime, timedelta, timezone
from unittest import mock

from starlette.websockets import WebSocketDisconnect

from gpredict_web.runtime import ModuleClosedError
from tests.test_api import ApiTestBase
from tests.test_runtime import NORADS, SAT_KEYS, T0, TICK_KEYS, iso, parse_iso

UTC = timezone.utc


class StepNow:
    """นาฬิกาเครื่องปลอมที่เดินหน้า 1 วินาทีทุกครั้งที่ถูกอ่าน: tick แต่ละก้อนจึงมี t ไม่ซ้ำกัน"""

    def __init__(self, start: datetime):
        self.t = start

    def __call__(self) -> datetime:
        self.t += timedelta(seconds=1)
        return self.t


def wait_for(predicate, timeout=2.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.01)
    return predicate()


class WebSocketTest(ApiTestBase):
    def setUp(self):
        super().setUp()
        self.put_module(refresh={"data_ms": 100})

    def close_code(self, ws, limit=200) -> int:
        """อ่านจน server ปิด socket แล้วคืน close code"""
        for _ in range(limit):
            try:
                ws.receive_json()
            except WebSocketDisconnect as exc:
                return exc.code
        self.fail("socket ไม่ถูกปิด")

    def test_first_message_has_every_tick_key(self):
        self.open_module()
        with self.client.websocket_connect("/ws/modules/M") as ws:
            tick = ws.receive_json()
        self.assertEqual(list(tick), TICK_KEYS)
        self.assertEqual(tick["status"], "ok")
        self.assertEqual(tick["t"], iso(T0))
        self.assertEqual([s["norad"] for s in tick["sats"]], list(NORADS))
        for s in tick["sats"]:
            self.assertEqual(list(s), SAT_KEYS)
        self.assertEqual(list(tick["clock"]), ["state", "throttle", "label"])
        self.assertEqual(list(tick["qth"]), ["name", "location", "lat_deg", "lon_deg", "alt_m"])
        self.assertEqual(list(tick["sun"]), ["lat_deg", "lon_deg"])
        self.assertEqual(list(tick["window"]), ["start", "stop"])

    def test_computing_tick_before_gmat_finishes(self):
        self.open_module(drain=False)
        with self.client.websocket_connect("/ws/modules/M") as ws:
            tick = ws.receive_json()
            self.assertEqual(tick["status"], "computing")
            self.assertNotIn("sats", tick)
            self.ephem.drain()
            for _ in range(50):
                if ws.receive_json()["status"] == "ok":
                    break
            else:
                self.fail("ไม่ได้ tick ok หลัง GMAT เสร็จ")

    def test_interval_follows_refresh_data_ms(self):
        """Ruling 2: ช่วงห่างของ tick ที่ติดกันอยู่ใน [0.5, 3] × refresh.data_ms (วัดจาก t ของ tick ซึ่งเป็นเวลาจริงของ server)"""
        app = self.make_app(now=lambda: datetime.now(UTC))
        client = self.enter(app)
        data_ms = 200
        self.put_module(refresh={"data_ms": data_ms})
        self.assertEqual(client.post("/api/modules/M/open").status_code, 200)
        self.ephem.drain()
        with client.websocket_connect("/ws/modules/M") as ws:
            times = [parse_iso(ws.receive_json()["t"]) for _ in range(5)]
        gaps = [(b - a).total_seconds() * 1000 for a, b in zip(times[1:], times[2:])]     # ข้ามก้อนแรก
        for gap in gaps:
            self.assertGreaterEqual(gap, 0.5 * data_ms, gaps)
            self.assertLessEqual(gap, 3 * data_ms, gaps)

    def test_interval_follows_data_ms_changed_while_open(self):
        app = self.make_app(now=lambda: datetime.now(UTC))
        client = self.enter(app)
        self.assertEqual(client.post("/api/modules/M/open").status_code, 200)
        self.ephem.drain()
        with client.websocket_connect("/ws/modules/M") as ws:
            ws.receive_json()
            self.assertEqual(client.put("/api/modules/M", json=self.module_body(refresh={"data_ms": 400})).status_code, 200)
            times = [parse_iso(ws.receive_json()["t"]) for _ in range(5)]      # ก้อนแรกๆ อาจออกก่อน PUT ตอบ
        gap = (times[4] - times[3]).total_seconds() * 1000
        self.assertGreaterEqual(gap, 0.5 * 400)
        self.assertLessEqual(gap, 3 * 400)

    def test_one_producer_sends_the_same_tick_to_every_socket(self):
        app = self.make_app(now=StepNow(T0))
        client = self.enter(app)
        self.assertEqual(client.post("/api/modules/M/open").status_code, 200)
        self.ephem.drain()
        with client.websocket_connect("/ws/modules/M") as a, client.websocket_connect("/ws/modules/M") as b:
            first_b = b.receive_json()["t"]
            for _ in range(200):                                             # a ต่อก่อน: ข้าม tick ที่ b ไม่ได้รับ
                if a.receive_json()["t"] == first_b:
                    break
            else:
                self.fail("socket a ไม่ได้ tick เดียวกับ b")
            ts_a = [a.receive_json()["t"] for _ in range(5)]
            ts_b = [b.receive_json()["t"] for _ in range(5)]
        self.assertEqual(ts_a, ts_b)                                         # producer สองตัวจะได้ t สลับกันคนละชุด
        steps = [(parse_iso(y) - parse_iso(x)).total_seconds() for x, y in zip(ts_a, ts_a[1:])]
        self.assertEqual(steps, [1.0] * 4)                                   # อ่านนาฬิกาครั้งเดียวต่อ tick
        self.assertTrue(wait_for(lambda: list(app.state.ticks.producers()) == []))

    def test_close_module_closes_socket_1000(self):
        self.open_module()
        with self.client.websocket_connect("/ws/modules/M") as ws:
            ws.receive_json()
            self.assertEqual(self.client.post("/api/modules/M/close").status_code, 200)
            self.assertEqual(self.close_code(ws), 1000)
        self.assertTrue(wait_for(lambda: list(self.app.state.ticks.producers()) == []))

    def test_delete_module_closes_socket_1000(self):
        self.open_module()
        with self.client.websocket_connect("/ws/modules/M") as a, self.client.websocket_connect("/ws/modules/M") as b:
            a.receive_json()
            b.receive_json()
            self.assertEqual(self.client.delete("/api/modules/M").status_code, 204)
            self.assertEqual(self.close_code(a), 1000)
            self.assertEqual(self.close_code(b), 1000)

    def test_module_not_open_closes_1008(self):
        for path in ("/ws/modules/M", "/ws/modules/Nope"):
            with self.subTest(path=path), self.client.websocket_connect(path) as ws:
                with self.assertRaises(WebSocketDisconnect) as ctx:
                    ws.receive_json()
                self.assertEqual(ctx.exception.code, 1008)
        self.assertEqual(list(self.app.state.ticks.producers()), [])

    def test_module_closed_error_ends_producer_with_1000(self):
        self.open_module()
        rt = self.hub.get("M")
        with self.client.websocket_connect("/ws/modules/M") as ws:
            ws.receive_json()
            with mock.patch.object(rt, "tick", side_effect=ModuleClosedError("ปิดแล้ว")):
                self.assertEqual(self.close_code(ws), 1000)
        self.assertTrue(wait_for(lambda: list(self.app.state.ticks.producers()) == []))

    def test_unexpected_tick_error_is_logged_and_loop_continues(self):
        self.open_module()
        rt = self.hub.get("M")
        real_tick = rt.tick
        calls = {"n": 0}

        def flaky():
            calls["n"] += 1
            if calls["n"] == 1:
                raise RuntimeError("พังครั้งเดียว")
            return real_tick()

        with mock.patch.object(rt, "tick", side_effect=flaky), \
                self.assertLogs("gpredict_web.app", level="ERROR") as logs, \
                self.client.websocket_connect("/ws/modules/M") as ws:
            tick = ws.receive_json()                                         # tick แรกพัง: ได้ tick ถัดไปแทน
            self.assertEqual(tick["status"], "ok")
        self.assertGreaterEqual(calls["n"], 2)
        self.assertIn("พังครั้งเดียว", "\n".join(logs.output))

    def test_producer_stops_after_last_socket_leaves(self):
        self.open_module()
        ticks = self.app.state.ticks
        with self.client.websocket_connect("/ws/modules/M") as a:
            a.receive_json()
            with self.client.websocket_connect("/ws/modules/M") as b:
                b.receive_json()
                self.assertEqual(list(ticks.producers()), ["M"])
            a.receive_json()                                                 # b ออกแล้ว a ยังได้ tick
            self.assertEqual(list(ticks.producers()), ["M"])
        self.assertTrue(wait_for(lambda: list(ticks.producers()) == []))
        self.assertIsNotNone(self.hub.get("M"))                              # ไม่มีคนดูก็ยังเปิดอยู่


if __name__ == "__main__":
    unittest.main()
