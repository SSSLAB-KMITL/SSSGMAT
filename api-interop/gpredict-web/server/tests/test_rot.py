"""rot.py RotController: timer ควบคุมและ client loop ของ Antenna Control (ref-R §5-§7, spec §5, §8, §9.1 ข้อ 12, 15, 16, §9.2)
เทียบคำสั่งที่ FakeHamlib ได้รับทุกตัวอักษร controller สร้างด้วย timer=False แล้ว test เรียก act/on_tick/control_tick/client_once เอง
(ยกเว้น test ของจังหวะ timer ที่ย่อค่าคงที่ให้สั้น) rotator อยู่ใน data dir ชั่วคราว Host "localhost" port ของ fake"""

import asyncio
import gc
import json
import time
import unittest
import warnings
from datetime import datetime, timedelta, timezone
from unittest import mock

from gpredict_web import rot
from gpredict_web.errors import ApiError
from gpredict_web.hwconf import HwConf
from gpredict_web.pass_predict import PassData, pass_to_dict
from gpredict_web.rot import RotController
from tests.fake_hamlib import FakeHamlib
from tests.helpers import temp_config

LOGGER = "gpredict_web.rot"
T0 = datetime(2026, 11, 14, 12, 0, 0, tzinfo=timezone.utc)
SATS = [(25544, "ISS"), (27607, "SO-50")]
QTH = (13.7563, 100.5018)                       # (lat, lon)
READ = b"p\n"


def row(az: float = 120.0, el: float = 30.0, next_aos: str | None = None, next_los: str | None = None) -> dict:
    """แถวของดาวเป้าหมายใน tick (ช่องที่ controller ใช้)"""
    return {"az": az, "el": el, "range_km": 1000.0, "range_rate_kms": 0.0, "next_aos": next_aos, "next_los": next_los}


def iso(t: datetime) -> str:
    return t.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def make_pass(azimuths: list[float], aos_s: float = 600.0, los_s: float = 1200.0) -> PassData:
    """pass ที่แถวมี Az ตาม azimuths (แถวแรกคือ AOS แถวสุดท้ายคือ LOS) เวลาเรียงห่างเท่ากัน"""
    step = (los_s - aos_s) / (len(azimuths) - 1)
    rows = [{"t": T0 + timedelta(seconds=aos_s + k * step), "az": az, "el": 0.0} for k, az in enumerate(azimuths)]
    return PassData(orbit=1, aos=T0 + timedelta(seconds=aos_s), tca=T0 + timedelta(seconds=(aos_s + los_s) / 2),
                    los=T0 + timedelta(seconds=los_s), max_el=40.0, aos_az=azimuths[0], max_el_az=azimuths[len(azimuths) // 2],
                    los_az=azimuths[-1], vis="V", rows=rows)


async def until(predicate, timeout: float = 1.0) -> None:
    """รอให้ fake อ่านคำสั่งที่ส่งไปแล้วแต่ไม่ได้ตอบ (เช่น q) จนเงื่อนไขเป็นจริง"""
    deadline = time.monotonic() + timeout
    while not predicate():
        if time.monotonic() > deadline:
            raise AssertionError("fake did not see the expected command in time")
        await asyncio.sleep(0.002)


class RotTestCase(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.cfg = temp_config(self)
        self.hw = HwConf(self.cfg.data_dir)
        self.fake = await self.start_fake()

    async def start_fake(self) -> FakeHamlib:
        fake = FakeHamlib()
        await fake.start()
        self.addAsyncCleanup(fake.stop)
        return fake

    def write_rotator(self, name: str = "R", port: int | None = None, **keys) -> None:
        """ไฟล์ <name>.rot.json ค่าตั้งต้น: 0–360, El 0–90, Cycle 1000 ms, Threshold 5°"""
        d = {"Host": "localhost", "Port": self.fake.port if port is None else port, "Cycle": 1000, "Threshold": 5.0,
             "AzType": 0, "MinAz": 0.0, "MaxAz": 360.0, "MinEl": 0.0, "MaxEl": 90.0, "AzStopPos": 0.0, **keys}
        path = self.cfg.data_dir / "hwconf" / f"{name}.rot.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(d), encoding="utf-8")

    def controller(self, target: int | None = None, timer: bool = False, predict=None, pass_for=None) -> RotController:
        ctl = RotController("Amateur", self.hw, SATS, target,
                            predict or (lambda norad, t: None), pass_for or (lambda norad, t: ("ok", None)), timer=timer)
        self.addAsyncCleanup(ctl.close)                 # ทำก่อน fake.stop (cleanup ทำย้อนลำดับ)
        return ctl

    async def track(self, ctl: RotController, az: float = 120.0, el: float = 30.0) -> None:
        await ctl.act({"action": "track", "on": True})
        ctl.on_tick(T0, row(az, el), QTH)

    async def engage(self, ctl: RotController) -> None:
        await ctl.act({"action": "engage", "on": True})
        self.assertTrue(ctl.engaged)

    def count_ticks(self) -> list[float]:
        """นับการเรียก control_tick ของทุก controller (ตั้งก่อนสร้าง controller)"""
        calls: list[float] = []
        original = RotController.control_tick

        async def counting(ctl):
            calls.append(time.monotonic())
            await original(ctl)

        patcher = mock.patch.object(RotController, "control_tick", counting)
        patcher.start()
        self.addCleanup(patcher.stop)
        return calls

    def since(self, n: int) -> list[bytes]:
        return self.fake.log[n:]


class InitialStateTest(RotTestCase):
    async def test_initial_knobs_and_read(self):
        snap = self.controller().snapshot()                                     # ยังไม่มีอุปกรณ์ให้โหลด
        self.assertEqual(snap, {
            "devices": [], "device": None, "engaged": False, "track": False, "monitor": False,
            "monitor_enabled": True, "knobs_enabled": True, "cycle_ms": 1000, "threshold_deg": 5.0,
            "sats": [{"norad": 25544, "name": "ISS"}, {"norad": 27607, "name": "SO-50"}], "norad": 25544,
            "knob": {"az": 180.0, "el": 45.0},
            "limits": {"min_az": 0.0, "max_az": 360.0, "min_el": 0.0, "max_el": 90.0, "az_type": 0},
            "target": None, "countdown": "00:00:00", "read": {"az": " --- ", "el": " --- "},
            "setpoint": {"az": 180.0, "el": 45.0}, "rotor": None, "pass": None, "status": None,
        })
        self.write_rotator("B")
        self.write_rotator("A", Cycle=500, Threshold=2.5, AzType=1, MinAz=-180.0, MaxAz=90.0, MinEl=10.0, MaxEl=30.0,
                           AzStopPos=-180.0)
        snap = self.controller().snapshot()                                     # อุปกรณ์แรกตามชื่อถูกโหลด
        self.assertEqual((snap["devices"], snap["device"], snap["cycle_ms"], snap["threshold_deg"]), (["A", "B"], "A", 500, 2.5))
        self.assertEqual(snap["limits"], {"min_az": -180.0, "max_az": 90.0, "min_el": 10.0, "max_el": 30.0, "az_type": 1})
        self.assertEqual(snap["knob"], {"az": 90.0, "el": 30.0})                # 180/45 ถูกบีบเข้าช่วงของอุปกรณ์
        self.assertEqual((snap["read"], snap["countdown"]), ({"az": " --- ", "el": " --- "}, "00:00:00"))

    async def test_initial_target(self):
        self.write_rotator()
        self.assertEqual(self.controller(target=27607).snapshot()["norad"], 27607)
        self.assertEqual(self.controller(target=99999).snapshot()["norad"], 25544)   # ไม่อยู่ใน module: ดาวแรก

    async def test_on_tick_target_and_countdown(self):
        ctl = self.controller()
        ctl.on_tick(T0, row(az=10.0, el=-3.0, next_aos=iso(T0 + timedelta(minutes=5, seconds=7)),
                            next_los=iso(T0 + timedelta(minutes=15))), QTH)
        snap = ctl.snapshot()
        self.assertEqual((snap["target"], snap["countdown"]), ({"az": 10.0, "el": -3.0}, "05:07"))     # El < 0 นับถึง AOS
        ctl.on_tick(T0, row(el=20.0, next_los=iso(T0 + timedelta(hours=1, minutes=2, seconds=3))), QTH)
        self.assertEqual(ctl.snapshot()["countdown"], "01:02:03")                                     # El ≥ 0 นับถึง LOS
        ctl.on_tick(T0, None, QTH)                                              # ไม่มีแถวของดาว: คงค่าเดิม
        self.assertEqual(ctl.snapshot()["countdown"], "01:02:03")
        ctl.on_tick(T0, row(el=20.0), QTH)                                      # ไม่รู้ LOS
        self.assertEqual(ctl.snapshot()["countdown"], "00:00:00")

    async def test_set_target(self):
        ctl = self.controller()
        ctl.on_tick(T0, row(), QTH)
        ctl.set_target(27607)
        snap = ctl.snapshot()
        self.assertEqual((snap["norad"], snap["target"]), (27607, None))        # ค่าของดาวเดิมไม่ใช้กับดาวใหม่
        ctl.set_target(99999)
        self.assertEqual(ctl.snapshot()["norad"], 27607)


class ControlTimerTest(RotTestCase):
    async def test_preview_when_not_engaged(self):
        self.write_rotator()
        ctl = self.controller()
        await self.track(ctl, 120.0, 30.0)
        await ctl.control_tick()
        snap = ctl.snapshot()
        self.assertEqual((snap["knob"], snap["setpoint"]), ({"az": 120.0, "el": 30.0}, {"az": 120.0, "el": 30.0}))
        self.assertEqual(self.fake.log, [])

    async def test_track_off_keeps_knobs(self):
        self.write_rotator()
        ctl = self.controller()
        ctl.on_tick(T0, row(120.0, 30.0), QTH)
        await ctl.act({"action": "az", "deg": 200.0})
        await ctl.control_tick()
        self.assertEqual(ctl.snapshot()["knob"], {"az": 200.0, "el": 45.0})

    async def test_knobs_clamped_to_device(self):
        self.write_rotator(MaxAz=350.0, MinEl=5.0, MaxEl=85.0)
        ctl = self.controller()
        await ctl.act({"action": "az", "deg": 400})
        await ctl.act({"action": "el", "deg": 0})
        self.assertEqual(ctl.snapshot()["knob"], {"az": 350.0, "el": 5.0})
        await ctl.act({"action": "az", "deg": -20.5})
        await ctl.act({"action": "el", "deg": 100})
        self.assertEqual(ctl.snapshot()["knob"], {"az": 0.0, "el": 85.0})
        await self.engage(ctl)                                                  # Track ปิด: set-point คือปุ่มหมุน
        await ctl.control_tick()
        await ctl.client_once()
        self.assertEqual(self.fake.log, [b"P 0.00 85.00\n", READ])

    async def test_flip_pass_and_no_pass_default(self):
        self.write_rotator(MaxEl=180.0)
        flip = make_pass([350.0, 355.0, 5.0, 10.0])                             # ข้ามทิศเหนือ: Az กระโดด 350° ใน 0–360
        answers = {25544: ("ok", flip), 27607: ("ok", None)}
        ctl = self.controller(pass_for=lambda norad, t: answers[norad])
        await self.track(ctl, 340.0, -5.0)
        await ctl.control_tick()                                                # ก่อน AOS: (350, 0) แล้ว flip
        self.assertEqual(ctl.snapshot()["knob"], {"az": 170.0, "el": 180.0})
        await ctl.act({"action": "satellite", "norad": 27607})
        ctl.on_tick(T0, row(200.0, -5.0), QTH)
        await ctl.control_tick()                                                # ไม่มี pass: flip ไม่ค้างจากดาวก่อน (spec §9.2)
        self.assertEqual(ctl.snapshot()["knob"], {"az": 0.0, "el": 45.0})

    async def test_lead_ahead_uses_module_prediction(self):
        self.write_rotator()
        asked = []

        def predict(norad, t):
            asked.append((norad, t))
            return 122.0, 30.0                                                  # ข้างหน้ายังห่างไม่เกิน Threshold 5°

        ctl = self.controller(predict=predict)
        await self.track(ctl, 120.0, 30.0)
        await self.engage(ctl)
        await ctl.control_tick()
        await ctl.client_once()
        self.assertEqual(self.fake.log, [b"P 122.00 30.00\n", READ])
        self.assertTrue(asked)
        self.assertTrue(all(norad == 25544 and t > T0 for norad, t in asked))
        self.assertEqual(ctl.snapshot()["knob"], {"az": 122.0, "el": 30.0})

    async def test_pass_refresh_and_plot(self):
        self.write_rotator()
        p = make_pass([100.0, 180.0, 250.0])
        answers = [("computing", None), ("ok", p)]
        calls = []

        def pass_for(norad, t):
            calls.append((norad, t))
            return answers.pop(0) if answers else ("ok", p)

        ctl = self.controller(pass_for=pass_for)
        ctl.on_tick(T0, row(90.0, -5.0, next_aos=iso(p.aos), next_los=iso(p.los)), QTH)
        await ctl.control_tick()
        self.assertEqual((calls, ctl.snapshot()["pass"]), ([(25544, T0)], None))
        await ctl.control_tick()                                                # ยังคำนวณอยู่: ขอใหม่รอบถัดไป
        self.assertEqual(len(calls), 2)
        self.assertEqual(ctl.snapshot()["pass"], pass_to_dict(p))
        ctl.on_tick(T0 + timedelta(seconds=1), row(90.0, -5.0, next_aos=iso(p.aos)), QTH)
        await ctl.control_tick()                                                # pass เดิมยังใช้ได้
        self.assertEqual(len(calls), 2)
        await ctl.act({"action": "satellite", "norad": 27607})                  # ดาวใหม่: ขอใหม่
        self.assertEqual(ctl.snapshot()["pass"], None)
        t2 = T0 + timedelta(seconds=2)
        ctl.on_tick(t2, row(90.0, -5.0), QTH)
        await ctl.control_tick()
        self.assertEqual(calls[-1], (27607, t2))

    async def test_pass_requested_once_per_tick(self):
        calls = []
        ctl = self.controller(pass_for=lambda norad, t: calls.append(t) or ("ok", None))   # ไม่มี pass ใน 3 วัน
        for k in range(3):
            ctl.on_tick(T0 + timedelta(seconds=k), row(90.0, -5.0), QTH)
            ctl.on_tick(T0 + timedelta(seconds=k, milliseconds=500), row(90.0, -5.0), QTH)
            await ctl.control_tick()
        self.assertEqual(len(calls), 3)
        await ctl.control_tick()                                                # ไม่มี tick ใหม่ของ module
        self.assertEqual(len(calls), 3)


class ClientLoopTest(RotTestCase):
    async def test_client_loop_sends_p_then_reads(self):
        self.write_rotator()
        ctl = self.controller()
        await self.track(ctl, 120.0, 30.0)
        await self.engage(ctl)
        await ctl.control_tick()                                                # ยังไม่รู้ตำแหน่ง: ต่างเกิน Threshold
        self.assertEqual(self.fake.log, [])
        await ctl.client_once()
        self.assertEqual(self.fake.log, [b"P 120.00 30.00\n", READ])
        await ctl.control_tick()
        snap = ctl.snapshot()
        self.assertEqual(snap["read"], {"az": "120.00°", "el": "30.00°"})
        self.assertEqual(snap["rotor"], {"az": 120.0, "el": 30.0})
        await ctl.client_once()                                                 # อยู่ที่เป้าแล้ว: อ่านอย่างเดียว
        self.assertEqual(self.since(2), [READ])

    async def test_client_loop_min_period(self):
        self.assertEqual((rot.ROT_SETTLE_S, rot.ROT_LOOP_MIN_S), (0.1, 0.8))
        self.write_rotator(Cycle=10)
        ctl = self.controller(timer=True)
        with mock.patch.object(rot, "ROT_SETTLE_S", 0.025), mock.patch.object(rot, "ROT_LOOP_MIN_S", 0.2):
            await self.engage(ctl)
            await asyncio.sleep(0.5)                                            # Cycle 10 ms = timer ควบคุม ~50 รอบ
            await ctl.act({"action": "engage", "on": False})
        await until(lambda: self.fake.log[-1:] == [b"q\n"])
        reads = self.fake.log.count(READ)
        self.assertGreaterEqual(reads, 2)
        self.assertLessEqual(reads, 3)                                          # ไม่ขึ้นกับ Cycle (spec §9.2)
        sets = self.fake.log.count(b"P 180.00 45.00\n")                         # เป้าใหม่ทุก 10 ms แต่ส่งได้รอบละครั้ง
        self.assertGreaterEqual(sets, 1)
        self.assertLessEqual(sets, 3)
        self.assertEqual(self.fake.log[-2:], [b"S\n", b"q\n"])

    async def test_threshold_blocks_small_moves(self):
        self.write_rotator(Threshold=0.1)
        self.fake.pos = (120.05, 30.0)
        ctl = self.controller()
        await self.track(ctl, 120.0, 30.0)
        await self.engage(ctl)
        await ctl.client_once()                                                 # ยังไม่มีเป้า: อ่านอย่างเดียว
        await ctl.control_tick()                                                # ห่าง 0.05° ไม่เกิน 0.1°
        await ctl.client_once()
        self.assertEqual(self.fake.log, [READ, READ])
        self.fake.pos = (120.2, 30.0)
        await ctl.client_once()
        await ctl.control_tick()                                                # ห่าง 0.2° เกิน 0.1°
        await ctl.client_once()
        self.assertEqual(self.since(3), [b"P 120.00 30.00\n", READ])

    async def test_read_wraps_closed_and_compares_raw(self):
        self.write_rotator("A", AzType=1, MinAz=-180.0, MaxAz=180.0, AzStopPos=-180.0)
        self.write_rotator("B", MaxAz=450.0)
        self.fake.pos = (-90.0, 30.0)
        ctl = self.controller()
        await self.track(ctl, 270.0, 30.0)                                      # set-point Az −90 ของ rotator −180…+180
        await self.engage(ctl)
        await ctl.client_once()
        await ctl.control_tick()
        snap = ctl.snapshot()
        self.assertEqual(snap["read"], {"az": "270.00°", "el": "30.00°"})       # แสดงห่อเป็น 0–360
        self.assertEqual(snap["rotor"], {"az": 270.0, "el": 30.0})
        await ctl.client_once()                                                 # เทียบ −90 กับ −90 ในหน่วยของอุปกรณ์: ไม่ส่ง P
        self.assertEqual(self.fake.log, [READ, READ])
        await ctl.act({"action": "engage", "on": False})
        await ctl.act({"action": "track", "on": False})
        await ctl.act({"action": "device", "name": "B"})
        self.fake.pos = (360.0, 10.0)
        await self.engage(ctl)
        await ctl.client_once()
        await ctl.control_tick()
        self.assertEqual(ctl.snapshot()["read"], {"az": "360.00°", "el": "10.00°"})   # ห่อแบบช่วงปิด: 360 คงเป็น 360

    async def test_monitor_reads_only(self):
        self.write_rotator()
        ctl = self.controller()
        await ctl.act({"action": "monitor", "on": True})
        snap = ctl.snapshot()
        self.assertEqual((snap["monitor"], snap["knobs_enabled"]), (True, False))
        await self.engage(ctl)
        await ctl.control_tick()                                                # ปุ่มหมุน 180/45 ต่างจากตำแหน่งที่ยังไม่รู้
        await ctl.client_once()
        self.assertEqual(self.fake.log, [READ])
        await ctl.client_once()
        self.assertEqual(self.fake.log, [READ, READ])

    async def test_monitor_enabled_follows_track_and_engage(self):
        self.write_rotator()
        ctl = self.controller()
        self.assertTrue(ctl.snapshot()["monitor_enabled"])
        await self.engage(ctl)
        self.assertFalse(ctl.snapshot()["monitor_enabled"])                     # ไม่ต้องกด Track (spec §9.1 ข้อ 15)
        with self.assertRaises(ApiError):
            await ctl.act({"action": "monitor", "on": True})
        await ctl.act({"action": "engage", "on": False})
        self.assertTrue(ctl.snapshot()["monitor_enabled"])
        await ctl.act({"action": "track", "on": True})
        self.assertFalse(ctl.snapshot()["monitor_enabled"])
        await ctl.act({"action": "track", "on": False})
        self.assertTrue(ctl.snapshot()["monitor_enabled"])

    async def test_rejected_set_position_is_retried(self):
        self.write_rotator()
        answers = [b"OK\n", b"RPRT -1\n"]                                       # คำตอบที่แยกไม่ได้ไม่นับว่าสำเร็จ (ไม่ใช่ 0)
        self.fake.reply = lambda cmd: (answers.pop(0) if cmd.startswith(b"P") and answers
                                       else self.fake.default_reply(cmd))
        ctl = self.controller()
        await self.track(ctl, 120.0, 30.0)
        await self.engage(ctl)
        await ctl.control_tick()
        with self.assertLogs(LOGGER, "ERROR") as logs:
            await ctl.client_once()
            await ctl.client_once()
        self.assertIn("rotctld returned bad response (OK)", logs.output[0])
        self.assertIn("rotctld returned error -1 with az 120.000000 el 30.000000(RPRT -1)", logs.output[1])
        self.assertIn('ตอบ "RPRT -1" ต่อคำสั่ง "P 120.00 30.00"', ctl.snapshot()["status"])
        await ctl.client_once()                                                 # เป้าเดิมถูกเก็บไว้ส่งรอบหน้า
        self.assertEqual(self.fake.log, [b"P 120.00 30.00\n", READ] * 3)
        await ctl.control_tick()
        snap = ctl.snapshot()
        self.assertEqual((snap["read"]["az"], snap["status"]), ("120.00°", None))

    async def test_bad_position_reply_is_an_error(self):
        self.write_rotator()
        self.fake.pos = (10.0, 20.0)
        ctl = self.controller()
        await ctl.act({"action": "monitor", "on": True})                        # ไม่ส่ง P ตำแหน่งของ fake จึงคงเดิม
        await self.engage(ctl)
        for reply, text in ((b"RPRT -6\n", "rotctld returned error (RPRT -6)"),
                            (b"abc\ndef\n", "rotctld returned bad response (abc def)")):
            self.fake.reply = lambda cmd, reply=reply: reply if cmd == READ else self.fake.default_reply(cmd)
            with self.assertLogs(LOGGER, "ERROR") as logs:
                await ctl.client_once()
            self.assertIn(text, logs.output[0])
            await ctl.control_tick()
            snap = ctl.snapshot()
            self.assertEqual((snap["read"], snap["rotor"]), ({"az": "ERROR", "el": "ERROR"}, None))   # ไม่ใช่ 0.00°
        self.fake.reply = self.fake.default_reply
        await ctl.client_once()
        await ctl.control_tick()
        self.assertEqual(ctl.snapshot()["read"], {"az": "10.00°", "el": "20.00°"})


class EngageTest(RotTestCase):
    async def test_unreachable_rotctld_shows_error_and_disengages(self):
        port = self.fake.port
        await self.fake.stop()
        self.write_rotator(port=port)
        ctl = self.controller()
        await self.engage(ctl)
        with self.assertLogs(LOGGER, "ERROR") as logs:
            await ctl.client_once()
            await ctl.control_tick()
            self.assertEqual(ctl.snapshot()["read"], {"az": "ERROR", "el": "ERROR"})   # spec §9.1 ข้อ 12
            for _ in range(3):
                await ctl.control_tick()
            self.assertTrue(ctl.engaged)
            await ctl.control_tick()                                            # ครั้งที่ 5
        self.assertFalse(ctl.engaged)
        self.assertIn(f"Connection to rotctld server at localhost:{port} failed", logs.output[0])
        self.assertIn("MAX_ERROR_COUNT (5) reached. Disengaging device!", logs.output[-1])
        snap = ctl.snapshot()
        self.assertEqual(snap["read"], {"az": "---", "el": "---"})
        self.assertIn("ปลด Engage", snap["status"])
        self.assertIn(f"localhost:{port}", snap["status"])

    async def test_error_free_tick_resets_counter(self):
        self.write_rotator()
        fail = [True]
        self.fake.reply = lambda cmd: b"RPRT -6\n" if fail[0] and cmd == READ else self.fake.default_reply(cmd)
        ctl = self.controller()
        await self.engage(ctl)
        with self.assertLogs(LOGGER, "ERROR"):
            await ctl.client_once()
        for _ in range(4):
            await ctl.control_tick()
        fail[0] = False
        await ctl.client_once()
        await ctl.control_tick()                                                # ไม่มี error: ตัวนับเป็น 0
        fail[0] = True
        with self.assertLogs(LOGGER, "ERROR"):
            await ctl.client_once()
        for _ in range(4):
            await ctl.control_tick()
        self.assertTrue(ctl.engaged)

    async def test_disengage_sends_s_then_q(self):
        self.write_rotator()
        ctl = self.controller()
        await self.engage(ctl)
        await ctl.client_once()
        await ctl.act({"action": "engage", "on": False})
        self.assertFalse(ctl.engaged)
        await until(lambda: self.fake.log[-1:] == [b"q\n"])
        self.assertEqual(self.fake.log, [READ, b"S\n", b"q\n"])
        snap = ctl.snapshot()
        self.assertEqual((snap["read"], snap["rotor"]), ({"az": "---", "el": "---"}, None))
        await self.engage(ctl)                                                  # ยังไม่ได้ต่อ: ไม่มีอะไรให้หยุด
        await ctl.act({"action": "engage", "on": False})
        self.assertEqual(self.fake.log, [READ, b"S\n", b"q\n"])

    async def test_engage_without_configuration(self):
        self.write_rotator("R")
        ctl = self.controller()
        (self.cfg.data_dir / "hwconf" / "R.rot.json").unlink()
        with self.assertLogs(LOGGER, "ERROR") as logs:
            await ctl.act({"action": "device", "name": "R"})                    # อ่านไฟล์ไม่ได้แล้ว
            await ctl.act({"action": "engage", "on": True})
        self.assertIn("Failed to load rotator configuration R", logs.output[0])
        self.assertIn("Controller does not have a valid configuration", logs.output[1])
        self.assertFalse(ctl.engaged)
        self.assertIsNotNone(ctl.snapshot()["status"])

    async def test_device_change(self):
        self.write_rotator("A")
        self.write_rotator("B", Cycle=2000, Threshold=1.5, MaxAz=450.0, MaxEl=180.0)
        ctl = self.controller()
        with self.assertLogs(LOGGER, "INFO") as logs:
            await ctl.act({"action": "device", "name": "B"})
        self.assertIn("Loaded new rotator configuration B", logs.output[0])
        snap = ctl.snapshot()
        self.assertEqual((snap["device"], snap["cycle_ms"], snap["threshold_deg"]), ("B", 2000, 1.5))
        self.assertEqual((snap["limits"]["max_az"], snap["limits"]["max_el"]), (450.0, 180.0))
        await self.engage(ctl)
        with self.assertRaises(ApiError):                                       # "Device:" กดไม่ได้ระหว่าง Engage
            await ctl.act({"action": "device", "name": "A"})
        self.assertEqual(ctl.snapshot()["device"], "B")

    async def test_close_saves_cycle_and_threshold(self):
        self.write_rotator()
        ctl = self.controller()
        await ctl.act({"action": "cycle", "ms": 2000})
        await ctl.act({"action": "threshold", "deg": 2.5})
        await self.engage(ctl)
        await ctl.client_once()
        await ctl.close()                                                       # disengage แล้วบันทึก
        self.assertFalse(ctl.engaged)
        conf = self.hw.rotator("R")
        self.assertEqual((conf.cycle, conf.threshold), (2000, 2.5))
        await until(lambda: self.fake.log[-1:] == [b"q\n"])
        self.assertEqual(self.fake.log[-2:], [b"S\n", b"q\n"])
        await ctl.close()                                                       # ซ้ำได้

    async def test_close_logs_save_failure(self):
        self.write_rotator()
        ctl = self.controller()
        failure = ApiError("HWCONF_INVALID", 422, "Cycle ผิด", "Cycle")
        with mock.patch.object(self.hw, "save_rotator_runtime", side_effect=failure):
            with self.assertLogs(LOGGER, "ERROR"):
                await ctl.close()

    async def test_act_after_close_is_refused(self):
        self.write_rotator()
        ctl = self.controller()
        await ctl.close()
        with self.assertRaises(ApiError) as raised:
            await ctl.act({"action": "engage", "on": True})
        self.assertEqual((raised.exception.code, raised.exception.status), ("CONTROLLER_INVALID", 422))
        self.assertFalse(ctl.engaged)
        self.assertEqual(self.fake.log, [])

    async def test_invalid_actions(self):
        self.write_rotator()
        ctl = self.controller()
        before = ctl.snapshot()
        for body in ({"action": "park"}, {}, {"action": "engage"}, {"action": "engage", "on": 1},
                     {"action": "cycle", "ms": 5}, {"action": "cycle", "ms": 1.5}, {"action": "threshold", "deg": 0.0},
                     {"action": "threshold", "deg": 51}, {"action": "threshold", "deg": True},
                     {"action": "satellite", "norad": 1}, {"action": "device", "name": "X"},
                     {"action": "az", "deg": "10"}, {"action": "el", "deg": float("nan")}):
            with self.subTest(body=body), self.assertRaises(ApiError) as raised:
                await ctl.act(body)
            self.assertEqual((raised.exception.code, raised.exception.status), ("CONTROLLER_INVALID", 422))
        self.assertEqual(ctl.snapshot(), before)
        await ctl.act({"action": "track", "on": True})                          # Track: ปุ่มหมุนและ Monitor กดไม่ได้
        for body in ({"action": "az", "deg": 10}, {"action": "monitor", "on": True}):
            with self.subTest(body=body), self.assertRaises(ApiError):
                await ctl.act(body)
        await ctl.act({"action": "track", "on": False})
        await ctl.act({"action": "monitor", "on": True})                        # Monitor: ปุ่มหมุนและ Track กดไม่ได้
        for body in ({"action": "el", "deg": 10}, {"action": "track", "on": True}):
            with self.subTest(body=body), self.assertRaises(ApiError):
                await ctl.act(body)
        self.assertEqual(ctl.snapshot()["knob"], before["knob"])


class TimerTest(RotTestCase):
    async def test_one_timer(self):
        ticks = self.count_ticks()
        self.write_rotator(Cycle=100)
        self.controller(timer=True)
        await asyncio.sleep(1.0)
        self.assertGreaterEqual(len(ticks), 9)                                  # ลงทะเบียนครั้งเดียว (spec §9.1 ข้อ 16)
        self.assertLessEqual(len(ticks), 11)

    async def test_cycle_change_restarts_timer(self):
        ticks = self.count_ticks()
        self.write_rotator(Cycle=30000)
        ctl = self.controller(timer=True)
        await asyncio.sleep(0.1)
        self.assertEqual(ticks, [])                                             # รอบแรกอีก 30 s
        await ctl.act({"action": "cycle", "ms": 10})                            # เริ่ม timer ใหม่ทันที
        await until(lambda: len(ticks) >= 3)

    async def test_concurrent_engage_off_and_on(self):
        # สองคำขอซ้อนกัน (ดับเบิลคลิกหรือสองแท็บ) ระหว่างรอบที่ rotctld ตอบช้า: off ต้องหยุดและปิดการเชื่อมต่อเดิมให้จบก่อน on เริ่ม
        self.write_rotator(Cycle=10)
        ctl = self.controller(timer=True)
        with (mock.patch.object(rot, "ROT_SETTLE_S", 0.005), mock.patch.object(rot, "ROT_LOOP_MIN_S", 0.05),
              warnings.catch_warnings(record=True) as caught, self.assertNoLogs(LOGGER, "ERROR")):
            warnings.simplefilter("always", ResourceWarning)
            await self.engage(ctl)
            await until(lambda: READ in self.fake.log)                         # การเชื่อมต่อเปิดอยู่
            self.fake.delay_s = 0.1
            reads = self.fake.log.count(READ)
            await until(lambda: self.fake.log.count(READ) > reads)             # มีรอบที่รอคำตอบอยู่
            off = asyncio.create_task(ctl.act({"action": "engage", "on": False}))
            await asyncio.sleep(0)
            on = asyncio.create_task(ctl.act({"action": "engage", "on": True}))
            await asyncio.gather(off, on)
            self.fake.delay_s = 0.0
            self.assertTrue(ctl.engaged)
            log = self.fake.log
            self.assertEqual((log.count(b"S\n"), log.count(b"q\n")), (1, 1))    # หยุดและปิดการเชื่อมต่อเดิมครั้งเดียว
            n = len(log)
            await until(lambda: READ in self.fake.log[n:])                     # การเชื่อมต่อใหม่อ่านตำแหน่งหลัง q
            await ctl.act({"action": "engage", "on": False})
            await until(lambda: self.fake.log.count(b"q\n") == 2)
            gc.collect()
        self.assertEqual([w for w in caught if issubclass(w.category, ResourceWarning)], [])


if __name__ == "__main__":
    unittest.main()
