"""rig.py RigController: state machine และ cycle ของทุกชนิดวิทยุ (ref-R §2.7, §3.1-§3.8, spec §4, §8, §9.1)
เทียบคำสั่งที่ FakeHamlib ได้รับทุกตัวอักษร controller สร้างด้วย timer=False แล้ว test เรียก act/on_tick/run_cycle เอง
(ยกเว้น test ของจังหวะ timer) วิทยุอยู่ใน data dir ชั่วคราว Host "localhost" port ของ fake"""

import asyncio
import gc
import json
import time
import unittest
import warnings
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from unittest import mock

from gpredict_web import hamlib, rig
from gpredict_web.errors import ApiError
from gpredict_web.hwconf import HwConf
from gpredict_web.rig import RigController, doppler_down, doppler_up
from tests.fake_hamlib import FakeHamlib
from tests.helpers import temp_config

LOGGER = "gpredict_web.rig"
T0 = datetime(2026, 11, 14, 12, 0, 0, tzinfo=timezone.utc)
PROBE = [b"\\set_vfo_opt 1\n", b"\\chk_vfo\n"]

SATS = [(25544, "ISS"), (27607, "SO-50"), (43017, "AO-91")]
LINEAR = {"name": "Mode U/V linear", "up_low": 435_000_000, "up_high": 435_100_000,
          "down_low": 145_900_000, "down_high": 146_000_000, "invert": False, "mode": "SSB", "baud": 0.0}
BEACON = {"name": "Beacon", "up_low": 0, "up_high": 0, "down_low": 145_800_000, "down_high": 145_800_000,
          "invert": False, "mode": "CW", "baud": 0.0}
INVERTING = dict(LINEAR, name="Mode U/V inverting", invert=True)
FM = {"name": "FM voice", "up_low": 145_850_000, "up_high": 145_850_000, "down_low": 436_795_000, "down_high": 436_795_000,
      "invert": False, "mode": "FM", "baud": 0.0}
TRSP = {25544: [LINEAR, BEACON, INVERTING], 27607: [FM], 43017: []}


def row(el: float = 10.0, rate: float = 0.0, az: float = 180.0, range_km: float = 1000.0,
        next_aos: str | None = None, next_los: str | None = None) -> dict:
    """แถวของดาวเป้าหมายใน tick (ช่องที่ controller ใช้)"""
    return {"az": az, "el": el, "range_km": range_km, "range_rate_kms": rate, "next_aos": next_aos, "next_los": next_los}


def iso(t: datetime) -> str:
    return t.isoformat(timespec="milliseconds").replace("+00:00", "Z")


async def until(predicate, timeout: float = 1.0) -> None:
    """รอให้ fake อ่านคำสั่งที่ส่งไปแล้วแต่ไม่ได้ตอบ (เช่น q) จนเงื่อนไขเป็นจริง"""
    deadline = time.monotonic() + timeout
    while not predicate():
        if time.monotonic() > deadline:
            raise AssertionError("fake did not see the expected command in time")
        await asyncio.sleep(0.002)


class RigTestCase(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.cfg = temp_config(self)
        self.hw = HwConf(self.cfg.data_dir)
        self.fake = await self.start_fake()

    async def start_fake(self) -> FakeHamlib:
        fake = FakeHamlib()
        await fake.start()
        self.addAsyncCleanup(fake.stop)
        return fake

    def write_radio(self, name: str = "A", port: int | None = None, **keys) -> None:
        """ไฟล์ <name>.rig.json ค่าตั้งต้น: RX only, PTT None, LO 0, downlink 145.9 MHz, uplink 435.1 MHz"""
        d = {"Host": "localhost", "Port": self.fake.port if port is None else port, "Type": 0, "PTT": 0,
             "LO": 0.0, "LO_UP": 0.0, "DefaultUplinkFreqHz": 435_100_000.0, "DefaultDownlinkFreqHz": 145_900_000.0,
             **keys}
        path = self.cfg.data_dir / "hwconf" / f"{name}.rig.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(d), encoding="utf-8")

    def controller(self, target: int | None = None, timer: bool = False) -> RigController:
        ctl = RigController("Amateur", self.hw, SATS, target, lambda norad: TRSP.get(norad, []), timer=timer)
        self.addAsyncCleanup(ctl.close)                 # ทำก่อน fake.stop (cleanup ทำย้อนลำดับ)
        return ctl

    async def engage(self, ctl: RigController) -> None:
        await ctl.act({"action": "engage", "on": True})
        self.assertTrue(ctl.engaged)

    def since(self, n: int, fake: FakeHamlib | None = None) -> list[bytes]:
        return (fake or self.fake).log[n:]


class InitialStateTest(RigTestCase):
    async def test_initial_state(self):
        self.write_radio("B", Type=0)
        self.write_radio("A", Type=2, PTT=1, Cycle=500, LO=-100_000_000.0, LO_UP=200_000_000.0,
                         DefaultDownlinkFreqHz=145_800_000.0, DefaultUplinkFreqHz=435_200_000.0)
        self.write_radio("C", Type=1)
        snap = self.controller().snapshot()
        self.assertEqual(snap, {
            "devices": ["A", "B", "C"],
            "devices2": ["None", *[r.name for r in self.hw.radios_dir_order() if r.type != 0]],
            "device1": "A", "device2": "None", "engaged": False, "track": False, "lock": False, "cycle_ms": 500,
            "sats": [{"norad": 25544, "name": "ISS"}, {"norad": 27607, "name": "SO-50"}, {"norad": 43017, "name": "AO-91"}],
            "norad": 25544, "transponders": ["Mode U/V linear", "Beacon", "Mode U/V inverting"], "transponder": 0,
            # ไม่มีเป้าหมาย: transponder แรกถูกเลือกโดยไม่จูน ปุ่มหมุนดาวจึงเป็นค่าตั้งต้นของอุปกรณ์ 1 ปุ่มหมุนวิทยุยังเป็น 145 890 000
            "down": {"sat_hz": 145_800_000.0, "radio_hz": 145_890_000.0, "doppler_hz": None, "lo_mhz": -100.0},
            "up": {"sat_hz": 435_200_000.0, "radio_hz": 145_890_000.0, "doppler_hz": None, "lo_mhz": 200.0},
            "az": None, "el": None, "range_km": None, "rate_kms": None,
            "countdown": "ΔT: 00:00:00", "space_ptt": False, "status": None,
        })
        self.assertEqual(sorted(snap["devices2"]), ["A", "C", "None"])           # B เป็น RX only (spec §9.2)

    async def test_target_tunes_first_transponder(self):
        self.write_radio("A")
        snap = self.controller(target=27607).snapshot()
        self.assertEqual((snap["norad"], snap["transponders"], snap["transponder"]), (27607, ["FM voice"], 0))
        self.assertEqual((snap["down"]["sat_hz"], snap["up"]["sat_hz"]), (436_795_000, 145_850_000))

    async def test_engage_probes_vfo_option(self):
        self.write_radio("A")
        self.fake.vfo_opt = "1"
        ctl = self.controller()
        await self.engage(ctl)
        self.assertEqual(self.fake.log, [])                                     # คำสั่งไปกับรอบถัดไป (spec §8)
        await ctl.run_cycle()
        self.assertEqual(self.fake.log, [*PROBE, b"F currVFO  145900000\n", b"f currVFO\n"])

    async def test_engage_without_configuration(self):
        self.write_radio("A")
        ctl = self.controller()
        (self.cfg.data_dir / "hwconf" / "A.rig.json").unlink()
        with self.assertLogs(LOGGER, "ERROR") as logs:
            await ctl.act({"action": "device1", "name": "A"})                   # อ่านไฟล์ไม่ได้แล้ว
            await ctl.act({"action": "engage", "on": True})
        self.assertIn("Failed to load radio configuration A", logs.output[0])
        self.assertIn("Controller does not have a valid configuration", logs.output[1])
        self.assertFalse(ctl.engaged)
        self.assertIsNotNone(ctl.snapshot()["status"])


class CycleTest(RigTestCase):
    async def test_rx_only_cycle(self):
        self.write_radio("A", LO=100_000_000.0)
        stamps: dict[bytes, float] = {}
        self.fake.reply = lambda cmd: (stamps.setdefault(cmd, time.monotonic()), self.fake.default_reply(cmd))[1]
        ctl = self.controller()
        await ctl.act({"action": "track", "on": True})
        ctl.on_tick(T0, row(rate=7.0))
        await self.engage(ctl)
        await ctl.run_cycle()
        # f_sat + dd - LO = 145 900 000 - 3406.69 - 100 000 000 แล้วรอ 5 ms อ่านกลับ
        self.assertEqual(self.fake.log, [*PROBE, b"F   45896593\n", b"f\n"])
        self.assertGreaterEqual(stamps[b"f\n"] - stamps[b"F   45896593\n"], 0.004)
        self.assertAlmostEqual(ctl.snapshot()["down"]["radio_hz"],
                               145_900_000 + doppler_down(145_900_000, 7.0) - 100_000_000)
        n = len(self.fake.log)
        await ctl.run_cycle()                                                   # ค่าเดิม: อ่านอย่างเดียว
        self.assertEqual(self.since(n), [b"f\n"])

    async def test_threshold_one_hz(self):
        self.write_radio("A")
        ctl = self.controller()
        await self.engage(ctl)
        await ctl.run_cycle()
        self.assertEqual(self.fake.log, [*PROBE, b"F  145900000\n", b"f\n"])
        n = len(self.fake.log)
        await ctl.act({"action": "freq", "link": "down", "hz": 145_900_000.9})
        await ctl.run_cycle()
        self.assertEqual(self.since(n), [b"f\n"])                              # ต่าง 0.9 Hz: ไม่ส่ง
        n = len(self.fake.log)
        await ctl.act({"action": "freq", "link": "down", "hz": 145_900_001.0})
        await ctl.run_cycle()
        self.assertEqual(self.since(n), [b"f\n", b"F  145900001\n", b"f\n"])    # ต่าง 1.0 Hz: ส่ง

    async def test_dial_feedback(self):
        self.write_radio("A", LO=100_000_000.0, DefaultDownlinkFreqHz=145_950_000.0, DefaultUplinkFreqHz=435_050_000.0)
        ctl = self.controller()
        await ctl.act({"action": "track", "on": True})
        ctl.on_tick(T0, row(rate=7.0))
        dd = doppler_down(145_950_000, 7.0)
        await self.engage(ctl)
        await ctl.run_cycle()
        sent = self.fake.freq                                                   # ค่าที่วิทยุอ่านกลับได้หลัง F
        await ctl.act({"action": "lock", "on": True})                           # uplink ตาม downlink ทันที
        self.assertEqual(ctl.snapshot()["up"]["sat_hz"], 435_050_000)
        self.fake.freq = sent + 500                                             # ผู้ใช้หมุนปุ่มบนวิทยุ
        n = len(self.fake.log)
        await ctl.run_cycle()
        self.assertEqual(self.since(n), [b"f\n"])                              # ไม่มี F ในรอบนั้น
        snap = ctl.snapshot()
        self.assertEqual(snap["down"]["radio_hz"], sent + 500)
        self.assertAlmostEqual(snap["down"]["sat_hz"], sent + 500 + 100_000_000 - dd)
        self.assertAlmostEqual(snap["up"]["sat_hz"], 435_000_000 + (snap["down"]["sat_hz"] - 145_900_000))
        n = len(self.fake.log)
        await ctl.run_cycle()                                                   # ปุ่มหมุนตรงกับวิทยุแล้ว
        self.assertEqual(self.since(n), [b"f\n"])

    async def test_tune_suppresses_feedback_one_cycle(self):
        self.write_radio("A")
        ctl = self.controller()
        await self.engage(ctl)
        await ctl.run_cycle()
        n = len(self.fake.log)
        await ctl.act({"action": "tune"})
        snap = ctl.snapshot()
        self.assertEqual((snap["down"]["sat_hz"], snap["up"]["sat_hz"]), (145_950_000, 435_050_000))
        await ctl.run_cycle()
        self.assertEqual(self.since(n), [b"F  145950000\n", b"f\n"])            # ไม่อ่าน f ก่อนส่ง

    async def test_tx_only_ptt_none_always_tunes(self):
        self.write_radio("A", Type=1)
        ctl = self.controller()
        await self.engage(ctl)
        await ctl.run_cycle()
        self.assertEqual(self.fake.log, [*PROBE, b"F  435100000\n", b"f\n"])
        n = len(self.fake.log)
        await ctl.act({"action": "freq", "link": "up", "hz": 435_100_100})
        await ctl.run_cycle()
        self.assertEqual(self.since(n), [b"f\n", b"F  435100100\n", b"f\n"])

    async def test_half_duplex_switches_on_ptt(self):
        self.write_radio("A", Type=2, PTT=1)
        ctl = self.controller()
        await self.engage(ctl)
        await ctl.run_cycle()                                                   # PTT 0: RX ส่ง downlink, TX ไม่ทำอะไร
        self.assertEqual(self.fake.log, [*PROBE, b"t\n", b"F  145900000\n", b"f\n", b"t\n"])
        n = len(self.fake.log)
        self.fake.ptt = 1
        await ctl.run_cycle()                                                   # PTT 1: TX ส่ง uplink บน VFO เดียวกัน
        self.assertEqual(self.since(n), [b"t\n", b"t\n", b"F  435100000\n", b"f\n"])
        n = len(self.fake.log)
        self.fake.ptt = 0
        await ctl.run_cycle()                                                   # ค่าที่ส่งล่าสุดของ downlink ถูกล้าง: ส่งเลยไม่อ่านก่อน
        self.assertEqual(self.since(n), [b"t\n", b"F  145900000\n", b"f\n", b"t\n"])
        n = len(self.fake.log)
        self.fake.ptt = 1
        await ctl.run_cycle()
        self.assertEqual(self.since(n), [b"t\n", b"t\n", b"F  435100000\n", b"f\n"])

    async def test_full_duplex(self):
        self.write_radio("A", Type=3, VFO_UP=4, VFO_DOWN=3)
        ctl = self.controller()
        await ctl.act({"action": "track", "on": True})
        ctl.on_tick(T0, row(rate=7.0))
        await self.engage(ctl)
        await ctl.run_cycle()
        self.assertEqual(self.fake.log, [*PROBE, b"S 1 Sub\n", b"F  145896593\n", b"f\n", b"I  435110159\n", b"i\n"])
        n = len(self.fake.log)
        ctl.on_tick(T0, row(rate=7.1))
        await ctl.run_cycle()
        self.assertEqual(self.since(n), [b"f\n", b"F  145896545\n", b"f\n", b"i\n", b"I  435110304\n", b"i\n"])

    async def test_full_duplex_uplink_dial_feedback(self):
        self.write_radio("A", Type=3, VFO_UP=1, VFO_DOWN=2)
        self.fake.vfo_opt = "1"
        ctl = self.controller()
        await self.engage(ctl)
        await ctl.run_cycle()
        self.assertEqual(self.fake.log, [*PROBE, b"S VFOB 1 VFOA\n", b"F currVFO  145900000\n", b"f currVFO\n",
                                         b"I VFOA  435100000\n", b"i currVFO\n"])
        self.fake.split_freq = 435_100_300.0
        n = len(self.fake.log)
        await ctl.run_cycle()
        self.assertEqual(self.since(n), [b"f currVFO\n", b"i currVFO\n"])
        self.assertEqual(ctl.snapshot()["up"]["sat_hz"], 435_100_300)

    async def test_tick_during_a_cycle_keeps_its_doppler(self):
        """tick ของ module ที่มาถึงขณะรอบรอคำตอบของ rigctld ไม่เปลี่ยน Doppler ของส่วนที่เหลือของรอบนั้น ปุ่มหมุน "Radio:" ทั้งสองจึงเป็น
        ค่าที่วิทยุได้รับ (Gpredict ทำทั้งรอบรวดเดียวใน timer เดียว Doppler เปลี่ยนกลางรอบไม่ได้) Doppler ใหม่ใช้ในรอบถัดไป"""
        self.write_radio("A", Type=3, VFO_UP=4, VFO_DOWN=3)
        ctl = self.controller()
        await ctl.act({"action": "track", "on": True})
        ctl.on_tick(T0, row(rate=7.0))
        await self.engage(ctl)

        def reply(cmd: bytes) -> bytes | None:
            if cmd.startswith(b"F "):                                           # tick ถัดไปมาถึงระหว่างรอคำตอบของ F
                ctl.on_tick(T0 + timedelta(seconds=0.3), row(rate=7.1))
            return self.fake.default_reply(cmd)

        self.fake.reply = reply
        await ctl.run_cycle()
        self.assertEqual(self.fake.log, [*PROBE, b"S 1 Sub\n", b"F  145896593\n", b"f\n", b"I  435110159\n", b"i\n"])
        snap = ctl.snapshot()
        self.assertEqual((round(snap["down"]["radio_hz"]), round(snap["up"]["radio_hz"])), (145_896_593, 435_110_159))
        self.assertAlmostEqual(snap["down"]["doppler_hz"], doppler_down(145_900_000, 7.1))    # ป้าย Doppler ตาม tick ล่าสุด
        n = len(self.fake.log)
        await ctl.run_cycle()
        self.assertEqual(self.since(n), [b"f\n", b"F  145896545\n", b"f\n", b"i\n", b"I  435110304\n", b"i\n"])

    async def test_ft817_auto(self):
        self.write_radio("A", Type=4, PTT=1)
        clock = [1000.0]
        ctl = self.controller()
        with mock.patch.object(rig, "_clock", lambda: clock[0]):
            await self.engage(ctl)
            await ctl.run_cycle()                                               # รอบแรก: ส่ง I
            self.assertEqual(self.fake.log, [*PROBE, b"S 1 VFOB\n", b"t\n", b"F  145900000\n", b"f\n",
                                             b"t\n", b"I  435100000\n"])
            n = len(self.fake.log)
            clock[0] = 1009.9
            await ctl.run_cycle()                                               # ยังไม่ครบ 10 s
            self.assertEqual(self.since(n), [b"t\n", b"f\n"])
            n = len(self.fake.log)
            await ctl.act({"action": "freq", "link": "up", "hz": 435_100_009})
            clock[0] = 1010.0
            await ctl.run_cycle()                                               # ครบ 10 s แต่ต่างไม่ถึง 10 Hz
            self.assertEqual(self.since(n), [b"t\n", b"f\n", b"t\n"])
            n = len(self.fake.log)
            await ctl.act({"action": "freq", "link": "up", "hz": 435_100_010})
            clock[0] = 1015.0
            await ctl.run_cycle()                                               # ต่างครบ 10 Hz แต่ยังไม่ครบ 10 s จากครั้งก่อน
            self.assertEqual(self.since(n), [b"t\n", b"f\n"])
            n = len(self.fake.log)
            clock[0] = 1020.0
            await ctl.run_cycle()
            self.assertEqual(self.since(n), [b"t\n", b"f\n", b"t\n", b"I  435100010\n"])
        self.assertNotIn(b"i\n", self.fake.log)                                 # ไม่มีการอ่านกลับฝั่ง TX

    async def test_ft817_manual_space(self):
        self.write_radio("A", Type=5, PTT=1)
        ctl = self.controller()
        self.assertTrue(ctl.snapshot()["space_ptt"])
        await self.engage(ctl)
        await ctl.run_cycle()                                                   # manual: ไม่มีการตั้ง TX ในรอบ
        self.assertEqual(self.fake.log, [*PROBE, b"S 1 VFOB\n", b"t\n", b"F  145900000\n", b"f\n"])
        n = len(self.fake.log)
        with self.assertLogs(LOGGER, "DEBUG") as logs:
            await ctl.act({"action": "ptt_toggle"})
        self.assertEqual(self.since(n), [b"t\n", b"t\n", b"I  435100000\n", b"T 1\n"])
        self.assertIn("Detected SPACEBAR pressed event", logs.output[0])
        self.assertTrue(any("PTT is OFF => Set TX freq and PTT=ON" in line for line in logs.output))
        self.assertEqual(self.fake.ptt, 1)
        n = len(self.fake.log)
        with self.assertLogs(LOGGER, "DEBUG") as logs:
            await ctl.act({"action": "ptt_toggle"})
        self.assertEqual(self.since(n), [b"t\n", b"T 0\n"])
        self.assertTrue(any("PTT is ON = Set PTT=OFF" in line for line in logs.output))
        self.assertNotIn(b"q\n", self.fake.log)                                 # spec §9.1 ข้อ 5: ไม่มี q ต่อท้าย T

    async def test_space_not_engaged(self):
        self.write_radio("A", Type=5, PTT=1)
        ctl = self.controller()
        with self.assertLogs(LOGGER, "INFO") as logs:
            await ctl.act({"action": "ptt_toggle"})
        self.assertIn("Controller not engaged; PTT event ignored (Hint: Enable the Engage button)", logs.output[-1])
        self.assertEqual(self.fake.log, [])

    async def test_space_ignored_for_other_types(self):
        self.write_radio("A", Type=0, PTT=1)
        ctl = self.controller()
        self.assertFalse(ctl.snapshot()["space_ptt"])
        await self.engage(ctl)
        await ctl.run_cycle()
        n = len(self.fake.log)
        with self.assertLogs(LOGGER, "INFO") as logs:
            await ctl.act({"action": "ptt_toggle"})
        self.assertEqual(self.since(n), [])
        self.assertEqual(len(logs.output), 1)                                   # แค่ "Detected SPACEBAR pressed event"

    async def test_read_dcd(self):
        self.write_radio("A", PTT=2)
        ctl = self.controller()
        await self.engage(ctl)
        await ctl.run_cycle()
        self.assertEqual(self.fake.log, [*PROBE, b"\x8b\n", b"F  145900000\n", b"f\n"])

    async def test_read_dcd_with_vfo_option_keeps_replies_in_step(self):
        """spec §9.1: DCD ส่ง `\\x8b` ไม่มีชื่อ VFO เสมอ เพราะ rigctld 4.7.2 ตอบ `\\x8b currVFO` สองบรรทัด (fake ทำแบบเดียวกัน)
        บรรทัดที่เกินจะเป็นคำตอบของคำสั่งถัดไปทีละคำสั่ง ความถี่ที่ไปถึงวิทยุจึงผิด (เคยส่ง I VFOA ที่เป็นค่าที่อ่านค้าง)"""
        self.write_radio("A", Type=3, PTT=2, VFO_UP=1, VFO_DOWN=2)
        self.fake.vfo_opt = "1"
        ctl = self.controller()
        await ctl.act({"action": "track", "on": True})
        await self.engage(ctl)
        for k in range(4):
            rate = 7.0 - 0.1 * k
            ctl.on_tick(T0 + timedelta(seconds=k), row(rate=rate))
            n = len(self.fake.log)
            await ctl.run_cycle()
            down = round(145_900_000 + doppler_down(145_900_000, rate))
            up = round(435_100_000 + doppler_up(435_100_000, rate))
            head = [*PROBE, b"S VFOB 1 VFOA\n", b"\x8b\n"] if k == 0 else [b"\x8b\n", b"f currVFO\n"]
            middle = [b"I VFOA %10d\n" % up] if k == 0 else [b"i currVFO\n", b"I VFOA %10d\n" % up]
            with self.subTest(cycle=k):
                self.assertEqual(self.since(n), [*head, b"F currVFO %10d\n" % down, b"f currVFO\n",
                                                 *middle, b"i currVFO\n"])
                self.assertEqual((self.fake.freq, self.fake.split_freq), (down, up))
                self.assertTrue(ctl.engaged)
                self.assertIsNone(ctl.snapshot()["status"])

    async def test_unknown_radio_type_runs_rx_cycle(self):
        self.write_radio("A")
        ctl = self.controller()
        ctl._conf1 = replace(ctl._conf1, type=9)                                # HwConf ไม่ยอมให้มี จึงใส่ตรงๆ
        await self.engage(ctl)
        with self.assertLogs(LOGGER, "ERROR") as logs:
            await ctl.run_cycle()
        self.assertIn("Invalid radio type 9. Setting type to RIG_TYPE_RX", logs.output[0])
        self.assertEqual(self.fake.log, [*PROBE, b"F  145900000\n", b"f\n"])


class DualRigTest(RigTestCase):
    async def test_dual_rig(self):
        fake2 = await self.start_fake()
        fake2.vfo_opt = "1"                                                     # device 2 ใช้ VFO option ของตัวเอง (decision 6)
        order: list[tuple[str, bytes]] = []
        for label, fake in (("1", self.fake), ("2", fake2)):
            fake.reply = (lambda f, n: lambda cmd: (order.append((n, cmd)), f.default_reply(cmd))[1])(fake, label)
        self.write_radio("A", Type=2, PTT=1, LO_UP=1_000_000.0)                # ชนิดและ PTT ของทั้งสองตัวไม่ถูกใช้
        self.write_radio("B", port=fake2.port, Type=1, LO_UP=0.0)
        ctl = self.controller()
        await ctl.act({"action": "device2", "name": "B"})
        self.assertEqual((ctl.snapshot()["device2"], ctl.snapshot()["up"]["lo_mhz"]), ("B", 0.0))
        await ctl.act({"action": "track", "on": True})
        ctl.on_tick(T0, row(rate=7.0))
        await self.engage(ctl)
        await ctl.run_cycle()
        self.assertEqual(order, [("1", PROBE[0]), ("1", PROBE[1]), ("2", PROBE[0]), ("2", PROBE[1]),
                                 ("1", b"F  145896593\n"), ("1", b"f\n"),
                                 ("2", b"F currVFO  435110159\n"), ("2", b"f currVFO\n")])     # LO_UP ของ device 2
        order.clear()
        ctl.on_tick(T0, row(rate=7.1))
        await ctl.run_cycle()
        self.assertEqual(order, [("1", b"f\n"), ("1", b"F  145896545\n"), ("1", b"f\n"),
                                 ("2", b"f currVFO\n"), ("2", b"F currVFO  435110304\n"), ("2", b"f currVFO\n")])
        await ctl.act({"action": "lock", "on": True})
        order.clear()
        self.fake.freq += 500                                                   # หมุนวิทยุ downlink: retune เฉพาะ uplink
        await ctl.run_cycle()
        self.assertEqual([(n, cmd.split()[0]) for n, cmd in order], [("1", b"f"), ("2", b"F"), ("2", b"f")])
        order.clear()
        fake2.freq += 300                                                       # หมุนวิทยุ uplink: retune downlink
        await ctl.run_cycle()
        self.assertEqual([(n, cmd.split()[0]) for n, cmd in order], [("1", b"f"), ("2", b"f"), ("1", b"F"), ("1", b"f")])

    async def test_device2_same_as_device1_resets(self):
        self.write_radio("A", Type=2, LO_UP=-50_000_000.0)
        self.write_radio("B", Type=2, LO_UP=10_000_000.0)
        ctl = self.controller()
        await ctl.act({"action": "device2", "name": "B"})
        self.assertEqual(ctl.snapshot()["up"]["lo_mhz"], 10.0)
        await ctl.act({"action": "freq", "link": "up", "hz": 437_000_000})
        await ctl.act({"action": "device2", "name": "A"})
        snap = ctl.snapshot()
        self.assertEqual((snap["device2"], snap["up"]["lo_mhz"], snap["up"]["sat_hz"]), ("None", -50.0, 435_100_000))

    async def test_device_change_refused_while_engaged(self):
        self.write_radio("A", Type=2)
        self.write_radio("B", Type=2)
        ctl = self.controller()
        await self.engage(ctl)
        for body in ({"action": "device1", "name": "B"}, {"action": "device2", "name": "B"},
                     {"action": "device2", "name": "None"}):
            with self.assertRaises(ApiError) as raised:
                await ctl.act(body)
            self.assertEqual((raised.exception.code, raised.exception.status), ("CONTROLLER_INVALID", 422))
        self.assertEqual((ctl.snapshot()["device1"], ctl.snapshot()["device2"]), ("A", "None"))


class SignallingTest(RigTestCase):
    async def test_aos_los_signalling(self):
        self.write_radio("A", SIGNAL_AOS=True, SIGNAL_LOIQ=True)
        ctl = self.controller(target=25544)
        await ctl.act({"action": "track", "on": True})
        ctl.on_tick(T0, row(el=-1.0))
        await self.engage(ctl)
        await ctl.run_cycle()
        self.assertEqual(self.fake.log, [*PROBE, b"F  145950000\n", b"f\n"])
        cases = [(1.0, [b"AOS\n", b"f\n"]), (-1.0, [b"U IQRECORD 0\n", b"f\n"])]
        for el, expected in cases:
            n = len(self.fake.log)
            ctl.on_tick(T0, row(el=el))
            await ctl.run_cycle()
            self.assertEqual(self.since(n), expected)
        await ctl.act({"action": "track", "on": False})                         # Track ปิด: ไม่ส่งสัญญาณ
        await ctl.run_cycle()
        for el in (1.0, -1.0):
            n = len(self.fake.log)
            ctl.on_tick(T0, row(el=el))
            await ctl.run_cycle()
            self.assertEqual(self.since(n), [b"f\n"])

    async def test_unanswered_signal_is_not_an_error(self):
        self.write_radio("A", SIGNAL_AOS=True, SIGNAL_LOS=True)
        self.fake.reply = lambda cmd: None if cmd in (b"AOS\n", b"LOS\n") else self.fake.default_reply(cmd)
        ctl = self.controller(target=25544)
        await ctl.act({"action": "track", "on": True})
        ctl.on_tick(T0, row(el=-1.0))
        await self.engage(ctl)
        await ctl.run_cycle()
        with mock.patch.object(hamlib, "REPLY_TIMEOUT_S", 0.05):
            for k in range(6):                                                  # มากกว่า MAX_ERROR_COUNT รอบ
                n = len(self.fake.log)
                el = 1.0 if k % 2 == 0 else -1.0
                ctl.on_tick(T0, row(el=el))
                await ctl.run_cycle()
                # timeout ปิดการเชื่อมต่อ (decision 12): ต่อใหม่ ตรวจ VFO option ใหม่ แล้วจึงทำ cycle
                self.assertEqual(self.since(n), [b"AOS\n" if el > 0 else b"LOS\n", *PROBE, b"f\n"])
        self.assertTrue(ctl.engaged)
        self.assertIsNone(ctl.snapshot()["status"])

    async def test_initial_previous_elevation_is_zero(self):
        # Gpredict เริ่ม prev_ele = 0.0 และไม่ตั้งใหม่ถ้าไม่มีเป้าหมายของ module: รอบแรกที่ดาวอยู่ใต้ขอบฟ้าจึงเป็น LOS
        self.write_radio("A", SIGNAL_LOS=True)
        ctl = self.controller()
        await ctl.act({"action": "track", "on": True})
        ctl.on_tick(T0, row(el=-5.0))
        await self.engage(ctl)
        await ctl.run_cycle()
        self.assertEqual(self.fake.log, [*PROBE, b"LOS\n", b"F  145900000\n", b"f\n"])


    async def test_selection_elevation_is_remembered(self):
        # Gpredict จำ el ตอนเลือกดาว (prev_ele) และ cycle ไม่ทำงานระหว่างไม่ได้ Engage: ดาวขึ้นระหว่างนั้น = AOS ในรอบแรก
        self.write_radio("A", SIGNAL_AOS=True)
        ctl = self.controller(target=25544)
        ctl.on_tick(T0, row(el=-1.0))
        ctl.on_tick(T0, row(el=2.0))
        await ctl.act({"action": "track", "on": True})
        await self.engage(ctl)
        await ctl.run_cycle()
        self.assertEqual(self.fake.log, [*PROBE, b"AOS\n", b"F  145950000\n", b"f\n"])


class ErrorAndTimerTest(RigTestCase):
    async def test_dead_rigctld_disengages_after_five_cycles(self):
        self.write_radio("A")
        port = self.fake.port
        ctl = self.controller()
        await self.engage(ctl)
        await ctl.run_cycle()
        await self.fake.stop()
        with self.assertLogs(LOGGER, "ERROR") as logs:
            for _ in range(4):
                await ctl.run_cycle()
            self.assertTrue(ctl.engaged)
            await ctl.run_cycle()
        self.assertFalse(ctl.engaged)
        self.assertIn("MAX_ERROR_COUNT (5) reached. Disengaging device!", logs.output[-1])
        status = ctl.snapshot()["status"]
        self.assertIn(f"localhost:{port}", status)
        self.assertIn("ปลด Engage", status)

    async def test_rejected_set_counts_until_success(self):
        self.write_radio("A")
        accept = [False]
        self.fake.reply = lambda cmd: (b"RPRT -11\n" if cmd.startswith(b"F") and not accept[0]
                                       else self.fake.default_reply(cmd))
        ctl = self.controller()
        await self.engage(ctl)
        with self.assertLogs(LOGGER, "ERROR") as logs:
            for _ in range(4):                                                  # ถูกปฏิเสธ 4 รอบ: ยัง Engage
                await ctl.run_cycle()
        self.assertIn("F  145900000 rigctld returned error (RPRT -11)", logs.output[0])
        self.assertIn('ตอบ "RPRT -11"', ctl.snapshot()["status"])
        self.assertTrue(ctl.engaged)
        accept[0] = True
        await ctl.run_cycle()                                                   # ตั้งสำเร็จ: ตัวนับเป็น 0 และ status หาย
        self.assertIsNone(ctl.snapshot()["status"])
        accept[0] = False
        await ctl.act({"action": "freq", "link": "down", "hz": 145_900_100})
        with self.assertLogs(LOGGER, "ERROR") as logs:
            for _ in range(4):
                await ctl.run_cycle()
            self.assertTrue(ctl.engaged)
            await ctl.run_cycle()                                               # ครั้งที่ 5 ติดกัน
        self.assertFalse(ctl.engaged)
        self.assertIn("MAX_ERROR_COUNT (5) reached. Disengaging device!", logs.output[-1])
        self.assertIn("RPRT -11", ctl.snapshot()["status"])

    async def test_skipped_cycles_do_not_queue(self):
        self.write_radio("A")
        # อ่านกลับได้ค่าอื่นเสมอ: ทุกรอบต้องส่ง F ใหม่ จำนวน F จึงเท่ากับจำนวนรอบที่ทำจริง
        self.fake.reply = lambda cmd: b"100000000\n" if cmd == b"f\n" else self.fake.default_reply(cmd)
        self.fake.delay_s = 0.05
        ctl = self.controller(timer=True)
        await ctl.act({"action": "cycle", "ms": 10})
        with self.assertLogs(LOGGER, "DEBUG") as logs:
            await self.engage(ctl)
            await asyncio.sleep(0.3)
            await ctl.act({"action": "engage", "on": False})
        sets = [cmd for cmd in self.fake.log if cmd.startswith(b"F")]
        self.assertGreaterEqual(len(sets), 1)
        self.assertLessEqual(len(sets), 4)                                      # ไม่สะสมเป็น 30 รอบ
        self.assertTrue(any("Amateur missed the deadline" in line for line in logs.output))
        await until(lambda: self.fake.log[-1:] == [b"q\n"])
        self.assertEqual(self.fake.log.count(b"q\n"), 1)

    async def test_cycle_change_restarts_timer(self):
        self.write_radio("A")
        ctl = self.controller(timer=True)
        await ctl.act({"action": "cycle", "ms": 30000})
        await self.engage(ctl)
        await until(lambda: b"f\n" in self.fake.log)                            # รอบแรกทำทันทีที่ Engage
        n = len(self.fake.log)
        await asyncio.sleep(0.1)
        self.assertEqual(self.since(n), [])                                     # รอบถัดไปอีก 30 s
        await ctl.act({"action": "cycle", "ms": 10})                            # เริ่ม timer ใหม่ทันที
        await until(lambda: self.fake.log.count(b"f\n") >= 4)
        await ctl.act({"action": "engage", "on": False})
        self.assertFalse(ctl.engaged)

    async def test_concurrent_engage_off_and_on(self):
        # สองคำขอซ้อนกัน (ดับเบิลคลิกหรือสองแท็บ) ระหว่างรอบที่ rigctld ตอบช้า: off ต้องปิดการเชื่อมต่อเดิมให้จบก่อน on เริ่ม
        self.write_radio("A")
        ctl = self.controller(timer=True)
        await ctl.act({"action": "cycle", "ms": 10})
        with warnings.catch_warnings(record=True) as caught, self.assertNoLogs(LOGGER, "ERROR"):
            warnings.simplefilter("always", ResourceWarning)
            await self.engage(ctl)
            await until(lambda: b"f\n" in self.fake.log)                       # รอบแรกจบ การเชื่อมต่อเปิดอยู่
            self.fake.delay_s = 0.1
            reads = self.fake.log.count(b"f\n")
            await until(lambda: self.fake.log.count(b"f\n") > reads)           # มีรอบที่รอคำตอบอยู่
            off = asyncio.create_task(ctl.act({"action": "engage", "on": False}))
            await asyncio.sleep(0)
            on = asyncio.create_task(ctl.act({"action": "engage", "on": True}))
            await asyncio.gather(off, on)
            self.fake.delay_s = 0.0
            await until(lambda: self.fake.log.count(b"\\set_vfo_opt 1\n") == 2)   # การเชื่อมต่อใหม่ถูกตรวจ VFO option
            self.assertTrue(ctl.engaged)
            log = self.fake.log
            self.assertEqual(log.count(b"q\n"), 1)                              # q ไปที่การเชื่อมต่อเดิมครั้งเดียว ก่อนการเชื่อมต่อใหม่
            self.assertLess(log.index(b"q\n"), len(log) - 1 - log[::-1].index(b"\\set_vfo_opt 1\n"))
            await ctl.act({"action": "engage", "on": False})
            await until(lambda: self.fake.log.count(b"q\n") == 2)                # การเชื่อมต่อใหม่ก็ปิดด้วย q
            gc.collect()
        self.assertEqual([w for w in caught if issubclass(w.category, ResourceWarning)], [])

    async def test_disengage_ft817_split_off_then_q(self):
        self.write_radio("A", Type=4)
        ctl = self.controller()
        await self.engage(ctl)
        await ctl.run_cycle()
        await ctl.act({"action": "engage", "on": False})
        self.assertFalse(ctl.engaged)
        await until(lambda: self.fake.log[-1:] == [b"q\n"])
        self.assertEqual(self.fake.log[-2:], [b"S 0 VFOA\n", b"q\n"])

    async def test_close_saves_cycle(self):
        self.write_radio("A")
        ctl = self.controller()
        await ctl.act({"action": "cycle", "ms": 2000})
        await self.engage(ctl)
        await ctl.run_cycle()
        await ctl.close()                                                       # disengage แล้วบันทึก Cycle
        self.assertFalse(ctl.engaged)
        self.assertEqual(self.hw.radio("A").cycle, 2000)
        await until(lambda: self.fake.log[-1:] == [b"q\n"])

    async def test_act_after_close_is_refused(self):
        self.write_radio("A")
        ctl = self.controller()
        await ctl.close()
        with self.assertRaises(ApiError) as raised:
            await ctl.act({"action": "engage", "on": True})
        self.assertEqual((raised.exception.code, raised.exception.status), ("CONTROLLER_INVALID", 422))
        self.assertFalse(ctl.engaged)
        self.assertEqual(self.fake.log, [])

    async def test_close_logs_save_failure(self):
        self.write_radio("A")
        ctl = self.controller()
        with mock.patch.object(self.hw, "save_radio_cycle", side_effect=OSError("disk full")):
            with self.assertLogs(LOGGER, "ERROR"):
                await ctl.close()


class TargetAndActionTest(RigTestCase):
    async def test_satellite_change_retunes_first_transponder(self):
        self.write_radio("A")
        ctl = self.controller()
        await self.engage(ctl)
        await ctl.run_cycle()
        n = len(self.fake.log)
        await ctl.act({"action": "satellite", "norad": 27607})
        snap = ctl.snapshot()
        self.assertEqual((snap["norad"], snap["transponders"], snap["transponder"]), (27607, ["FM voice"], 0))
        self.assertEqual((snap["down"]["sat_hz"], snap["up"]["sat_hz"]), (436_795_000, 145_850_000))
        await ctl.run_cycle()
        self.assertEqual(self.since(n), [b"F  436795000\n", b"f\n"])            # ค่าที่ส่งล่าสุดถูกล้าง
        await ctl.act({"action": "satellite", "norad": 43017})                  # ไม่มี transponder: ปุ่มหมุนคงเดิม
        snap = ctl.snapshot()
        self.assertEqual((snap["transponders"], snap["transponder"], snap["down"]["sat_hz"]), ([], None, 436_795_000))

    async def test_set_target(self):
        self.write_radio("A")
        ctl = self.controller()
        ctl.set_target(27607)
        self.assertEqual((ctl.snapshot()["norad"], ctl.snapshot()["down"]["sat_hz"]), (27607, 436_795_000))
        ctl.set_target(99999)                                                   # ไม่อยู่ใน module: ไม่เปลี่ยน
        self.assertEqual(ctl.snapshot()["norad"], 27607)

    async def test_transponder_and_lock(self):
        self.write_radio("A")
        ctl = self.controller()
        await ctl.act({"action": "transponder", "index": 1})                    # beacon: จูนเฉพาะ downlink
        snap = ctl.snapshot()
        self.assertEqual((snap["transponder"], snap["down"]["sat_hz"], snap["up"]["sat_hz"]), (1, 145_800_000, 435_100_000))
        await ctl.act({"action": "transponder", "index": 2})                    # inverting
        await ctl.act({"action": "lock", "on": True})
        await ctl.act({"action": "freq", "link": "down", "hz": 145_910_000})
        self.assertEqual(ctl.snapshot()["up"]["sat_hz"], 435_090_000)          # UP_HIGH - Δ
        await ctl.act({"action": "freq", "link": "up", "hz": 435_020_000})
        self.assertEqual(ctl.snapshot()["down"]["sat_hz"], 145_980_000)        # DOWN_HIGH - Δ
        await ctl.act({"action": "lock", "on": False})
        await ctl.act({"action": "freq", "link": "down", "hz": 145_900_000})
        self.assertEqual(ctl.snapshot()["up"]["sat_hz"], 435_020_000)

    async def test_on_tick_values(self):
        self.write_radio("A")
        ctl = self.controller()
        ctl.on_tick(T0, row(az=123.456, el=-3.0, range_km=1234.5, rate=7.0,
                            next_aos=iso(T0 + timedelta(seconds=125.6)), next_los=iso(T0 + timedelta(seconds=725))))
        snap = ctl.snapshot()
        self.assertAlmostEqual(snap["down"]["doppler_hz"], doppler_down(145_900_000, 7.0))
        self.assertAlmostEqual(snap["up"]["doppler_hz"], doppler_up(435_100_000, 7.0))
        self.assertEqual((snap["az"], snap["el"], snap["range_km"], snap["rate_kms"]), (123.456, -3.0, 1234.5, 7.0))
        self.assertEqual(snap["countdown"], "AOS in 02:05")
        ctl.on_tick(T0, row(el=10.0, next_los=iso(T0 + timedelta(seconds=3725))))
        self.assertEqual(ctl.snapshot()["countdown"], "LOS in 01:02:05")
        ctl.on_tick(T0, row(el=-10.0))                                          # ไม่รู้เวลา AOS
        self.assertEqual(ctl.snapshot()["countdown"], "ΔT: 00:00:00")
        ctl.on_tick(T0, None)                                                   # ไม่มีแถวของดาว: ค่าเดิม
        self.assertEqual(ctl.snapshot()["el"], -10.0)

    async def test_invalid_actions(self):
        self.write_radio("A")
        ctl = self.controller()
        bodies = [
            [], {}, {"action": "fly"}, {"action": "engage"}, {"action": "engage", "on": 1},
            {"action": "satellite", "norad": 1}, {"action": "satellite", "norad": "25544"},
            {"action": "transponder", "index": 3}, {"action": "transponder", "index": True},
            {"action": "device1", "name": "Z"}, {"action": "device2", "name": "Z"},
            {"action": "cycle", "ms": 5}, {"action": "cycle", "ms": 30010}, {"action": "cycle", "ms": 100.0},
            {"action": "freq", "link": "side", "hz": 1}, {"action": "freq", "link": "down", "hz": -1},
            {"action": "freq", "link": "down", "hz": 10_000_000_000}, {"action": "freq", "link": "down", "hz": float("nan")},
            {"action": "freq", "link": "up", "hz": "435"},
        ]
        for body in bodies:
            with self.subTest(body=body):
                with self.assertRaises(ApiError) as raised:
                    await ctl.act(body)
                self.assertEqual((raised.exception.code, raised.exception.status), ("CONTROLLER_INVALID", 422))
        self.assertFalse(ctl.engaged)


if __name__ == "__main__":
    unittest.main()
