"""controllers.py ControllerHub (Task 8): controller ทุกตัวของทุก module, เป้าหมายของ module และการส่งแถวของดาวเป้าหมายจาก tick
Hub และ EphemManager จริงกับ propagate ปลอมของ test_runtime (start_worker=False แล้ว drain()) rigctld/rotctld เป็น FakeHamlib
ControllerHub สร้าง controller ด้วย timer จริง rotator ในไฟล์จึงตั้ง Cycle 30000 ms (timer ควบคุมไม่ทำงานระหว่าง test)"""

import asyncio
import json
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

from gpredict_web.controllers import ControllerHub
from gpredict_web.ephem import EphemManager
from gpredict_web.errors import ApiError
from gpredict_web.hwconf import HwConf
from gpredict_web.module import module_from_dict
from gpredict_web.pass_service import PassService
from gpredict_web.prefs import Prefs
from gpredict_web.rig import RigController, doppler_down
from gpredict_web.runtime import Hub
from gpredict_web.store import Store
from tests.fake_hamlib import FakeHamlib
from tests.helpers import FakeNow, temp_config
from tests.test_pass_service import write_satdb
from tests.test_runtime import NORADS, ORIGIN, T0, OrbitPropagate, iso, record

FIRST_BY_NAME = 7530                    # SAT-7530 < SAT-25544 < SAT-43017 (เลขในชื่อเทียบตามค่า) ดาวแรกใน module คือ 25544
READ = b"p\n"


async def until(predicate, timeout: float = 3.0) -> None:
    deadline = time.monotonic() + timeout
    while not predicate():
        if time.monotonic() > deadline:
            raise AssertionError("condition not reached in time")
        await asyncio.sleep(0.002)


class ControllerHubTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.cfg = temp_config(self)
        self.fake = OrbitPropagate()
        self.ephem = EphemManager(self.cfg, propagate_fn=self.fake, find_console=lambda: Path("/fake/GmatConsole"),
                                  start_worker=False)
        self.addCleanup(self.ephem.close)
        self.wall = FakeNow(T0)
        store = Store(self.cfg.data_dir)
        store.put_qth(ORIGIN)
        store.set_default_qth("ORIGIN")
        satdb = write_satdb(self.cfg.data_dir / "satdb.json", [record(n) for n in NORADS])
        store.put_module(module_from_dict({"name": "M", "qth": None, "satellites": list(NORADS)}, None, None))
        prefs = Prefs(self.cfg.data_dir)
        self.hub = Hub(store, satdb, self.ephem, self.wall, prefs=prefs)
        self.hub.open("M")
        self.addCleanup(self.hub.close, "M")
        self.hw = HwConf(self.cfg.data_dir)
        self.rig = await self.start_fake()
        self.rot = await self.start_fake()
        self.woken: list[str] = []
        self.controllers = ControllerHub(self.hub, self.hw, self.cfg.data_dir, PassService(self.hub, self.ephem, prefs,
                                                                                          self.wall), self.woken.append)
        self.addAsyncCleanup(self.controllers.shutdown)        # ทำก่อน fake.stop (cleanup ทำย้อนลำดับ)

    async def start_fake(self) -> FakeHamlib:
        fake = FakeHamlib()
        await fake.start()
        self.addAsyncCleanup(fake.stop)
        return fake

    def write_hw(self, name: str, suffix: str, keys: dict) -> None:
        path = self.cfg.data_dir / "hwconf" / f"{name}.{suffix}.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(keys), encoding="utf-8")

    def write_radio(self, name: str = "A") -> None:
        self.write_hw(name, "rig", {"Host": "localhost", "Port": self.rig.port, "Type": 0, "PTT": 0, "LO": 0.0,
                                    "LO_UP": 0.0, "DefaultUplinkFreqHz": 435_100_000.0,
                                    "DefaultDownlinkFreqHz": 145_900_000.0})

    def write_rotator(self, name: str = "R", cycle: int = 30000) -> None:
        self.write_hw(name, "rot", {"Host": "localhost", "Port": self.rot.port, "Cycle": cycle, "Threshold": 5.0,
                                    "AzType": 0, "MinAz": 0.0, "MaxAz": 360.0, "MinEl": 0.0, "MaxEl": 90.0,
                                    "AzStopPos": 0.0})

    async def open_both(self) -> None:
        self.write_radio()
        self.write_rotator()
        await self.controllers.open("M", "radio")
        await self.controllers.open("M", "rotator")

    def snapshots(self, module: str = "M") -> dict:
        """snapshot ของ controller ที่เปิดอยู่ จาก tick ที่ยังไม่มีค่าของดาว (computing): controller คงค่าเดิม"""
        return self.controllers.on_tick(module, {"t": iso(T0), "status": "computing",
                                                 "qth": {"lat_deg": 0.0, "lon_deg": 0.0}})

    def ok_tick(self) -> dict:
        self.ephem.drain()
        tick = self.hub.get("M").tick()
        self.assertEqual(tick["status"], "ok")
        return tick

    async def assert_api_error(self, awaitable, status: int, code: str) -> ApiError:
        with self.assertRaises(ApiError) as raised:
            await awaitable
        self.assertEqual((raised.exception.status, raised.exception.code), (status, code))
        self.assertRegex(raised.exception.text, r"[ก-๙]")
        return raised.exception

    # ---------------------------------------------------------------- เปิด

    async def test_open_without_radio_is_409(self):
        await self.assert_api_error(self.controllers.open("M", "radio"), 409, "NO_RADIO_CONFIG")
        self.write_radio()                                                  # มีวิทยุแต่ไม่มี rotator
        await self.assert_api_error(self.controllers.open("M", "rotator"), 409, "NO_ROTATOR_CONFIG")
        self.assertEqual((self.controllers.open_list(), self.controllers.active("M"), self.woken), ([], False, []))
        await self.assert_api_error(self.controllers.open("Nope", "radio"), 404, "NOT_FOUND")    # module ไม่ได้เปิด

    async def test_open_twice_keeps_one(self):
        self.write_radio()
        await asyncio.gather(self.controllers.open("M", "radio"), self.controllers.open("M", "radio"))
        await self.controllers.open("M", "radio")
        self.assertEqual(self.controllers.open_list(), [{"module": "M", "kind": "radio"}])
        self.assertTrue(self.controllers.active("M"))
        self.assertFalse(self.controllers.active("N"))
        self.assertEqual(self.woken, ["M"])                                  # producer ของ module เริ่มแม้ไม่มี socket

    async def test_hold_blocks_open_and_close_until_released(self):
        # PUT module ตรวจ active() แล้วเขียนใต้ hold: controller ไม่ถูกเปิดหรือปิดแทรกระหว่างนั้น
        self.write_radio()
        async with self.controllers.hold("M"):
            opening = asyncio.create_task(self.controllers.open("M", "radio"))
            await asyncio.sleep(0.05)
            self.assertFalse(self.controllers.active("M"))
            self.assertFalse(opening.done())
        await opening
        self.assertTrue(self.controllers.active("M"))
        async with self.controllers.hold("M"):
            closing = asyncio.create_task(self.controllers.close("M", "radio"))
            await asyncio.sleep(0.05)
            self.assertTrue(self.controllers.active("M"))
        await closing
        self.assertFalse(self.controllers.active("M"))

    async def test_initial_target(self):
        self.write_radio()
        self.write_rotator()
        await self.controllers.set_target("M", 25544)
        self.assertEqual(self.controllers.target("M"), 25544)
        await self.controllers.open("M", "radio")
        await self.controllers.open("M", "rotator")
        snaps = self.snapshots()
        self.assertEqual((snaps["radio"]["norad"], snaps["rotator"]["norad"]), (25544, 25544))
        await self.controllers.close_module("M")                            # module ปิด: ลืมเป้าหมายด้วย
        self.assertIsNone(self.controllers.target("M"))
        await self.controllers.open("M", "radio")
        await self.controllers.open("M", "rotator")
        snaps = self.snapshots()
        self.assertEqual((snaps["radio"]["norad"], snaps["rotator"]["norad"]), (FIRST_BY_NAME, FIRST_BY_NAME))
        by_name = [{"norad": n, "name": f"SAT-{n}"} for n in (7530, 25544, 43017)]   # combo เรียงตามชื่อ (decision 17)
        self.assertEqual((snaps["radio"]["sats"], snaps["rotator"]["sats"]), (by_name, by_name))

    async def test_target_switches_both(self):
        await self.open_both()
        await self.controllers.set_target("M", 43017)
        snaps = self.snapshots()
        self.assertEqual((snaps["radio"]["norad"], snaps["rotator"]["norad"]), (43017, 43017))
        self.assertEqual(self.controllers.target("M"), 43017)
        error = await self.assert_api_error(self.controllers.set_target("M", 99999), 404, "NOT_FOUND")
        self.assertEqual(error.object, "99999")
        self.assertEqual(self.controllers.target("M"), 43017)
        await self.assert_api_error(self.controllers.set_target("Nope", 25544), 404, "NOT_FOUND")

    async def test_latest_target_wins(self):
        # สองการเลือกดาวติดกัน: การเลือกแรกรอรายชื่อดาว (lock ของ runtime ที่ tick ถือ) นานกว่าการเลือกที่สอง
        # ต้องได้ดาวของการเลือกล่าสุด ไม่ใช่ของคำขอที่เสร็จทีหลัง
        await self.open_both()
        rt = self.hub.get("M")
        names, release, calls = rt.sat_names, threading.Event(), []

        def sat_names():
            calls.append(None)
            if len(calls) == 1:
                release.wait(2.0)
            return names()

        with mock.patch.object(rt, "sat_names", sat_names):
            first = asyncio.create_task(self.controllers.set_target("M", 43017))
            await until(lambda: len(calls) == 1)
            await self.controllers.set_target("M", 25544)
            release.set()
            await first
        self.assertEqual(self.controllers.target("M"), 25544)
        snaps = self.snapshots()
        self.assertEqual((snaps["radio"]["norad"], snaps["rotator"]["norad"]), (25544, 25544))

    # ---------------------------------------------------------------- tick

    async def test_on_tick_passes_target_row(self):
        self.write_radio()
        self.assertEqual(self.controllers.on_tick("M", self.ok_tick()), {})         # ไม่มี controller: ไม่เติมอะไร
        await self.controllers.open("M", "radio")
        tick = self.ok_tick()
        rows = {s["norad"]: s for s in tick["sats"]}
        self.assertNotEqual(rows[FIRST_BY_NAME]["range_rate_kms"], rows[43017]["range_rate_kms"])
        out = self.controllers.on_tick("M", tick)
        self.assertEqual(list(out), ["radio"])
        radio, row = out["radio"], rows[FIRST_BY_NAME]
        self.assertEqual((radio["norad"], radio["az"], radio["el"], radio["rate_kms"]),
                         (FIRST_BY_NAME, row["az"], row["el"], row["range_rate_kms"]))
        self.assertEqual(radio["down"]["doppler_hz"], doppler_down(radio["down"]["sat_hz"], row["range_rate_kms"]))
        # เปลี่ยนดาวแล้ว tick เดิม: ใช้แถวของดาวใหม่จาก tick เดียวกัน ไม่ใช่แถวของดาวก่อน
        await self.controllers.act("M", "radio", {"action": "satellite", "norad": 43017})
        radio = self.controllers.on_tick("M", tick)["radio"]
        self.assertEqual((radio["az"], radio["rate_kms"]), (rows[43017]["az"], rows[43017]["range_rate_kms"]))
        self.assertEqual(self.snapshots()["radio"]["rate_kms"], rows[43017]["range_rate_kms"])   # ไม่มีแถว: คงค่าเดิม

    async def test_controller_error_in_a_tick_is_contained(self):
        # controller ที่ล้มใน on_tick หรือ snapshot ไม่ทำให้ tick ของ module ล้ม: อีกตัวได้ค่าต่อ log ครั้งเดียวต่อ controller
        await self.open_both()
        tick = self.ok_tick()
        with mock.patch.object(RigController, "on_tick", side_effect=RuntimeError("boom")):
            with self.assertLogs("gpredict_web.controllers", "ERROR") as logs:
                first = self.controllers.on_tick("M", tick)
                second = self.controllers.on_tick("M", tick)
                with mock.patch.object(RigController, "snapshot", side_effect=RuntimeError("boom")):
                    third = self.controllers.on_tick("M", tick)
        self.assertEqual(len(logs.records), 1)
        self.assertIn("Radio Control", logs.output[0])
        self.assertEqual((list(first), list(second)), (["radio", "rotator"], ["radio", "rotator"]))
        self.assertIsNone(first["radio"]["az"])                             # snapshot ยังได้ (ค่าก่อน tick นี้)
        self.assertEqual(list(third), ["rotator"])                         # snapshot ล้ม: tick ไม่มี radio
        self.assertEqual(third["rotator"]["norad"], FIRST_BY_NAME)

    async def test_act_returns_snapshot_and_404_when_not_open(self):
        await self.assert_api_error(self.controllers.act("M", "radio", {"action": "track", "on": True}), 404, "NOT_FOUND")
        self.write_radio()
        await self.controllers.open("M", "radio")
        snap = await self.controllers.act("M", "radio", {"action": "track", "on": True})
        self.assertTrue(snap["track"])
        await self.assert_api_error(self.controllers.act("M", "radio", {"action": "fly"}), 422, "CONTROLLER_INVALID")
        await self.controllers.close("M", "radio")
        await self.controllers.close("M", "radio")                          # ปิดซ้ำได้
        await self.assert_api_error(self.controllers.act("M", "radio", {"action": "track", "on": False}), 404,
                                    "NOT_FOUND")
        self.assertEqual(self.controllers.open_list(), [])

    # ---------------------------------------------------------------- ปิด

    async def engage_both(self) -> None:
        await self.controllers.act("M", "radio", {"action": "engage", "on": True})
        await self.controllers.act("M", "rotator", {"action": "engage", "on": True})
        await until(lambda: self.rig.log and READ in self.rot.log)            # ต่ออุปกรณ์ทั้งสองแล้ว

    async def test_close_module_disengages_and_saves(self):
        await self.open_both()
        await self.controllers.set_target("M", 43017)
        await self.controllers.act("M", "radio", {"action": "cycle", "ms": 700})
        await self.controllers.act("M", "rotator", {"action": "cycle", "ms": 20000})
        await self.engage_both()
        await self.controllers.close_module("M")
        self.assertEqual((self.controllers.open_list(), self.controllers.active("M")), ([], False))
        self.assertIsNone(self.controllers.target("M"))
        await until(lambda: self.rot.log[-1:] == [b"q\n"] and b"q\n" in self.rig.log)
        self.assertEqual(self.rot.log[-2:], [b"S\n", b"q\n"])
        self.assertEqual((self.hw.radio("A").cycle, self.hw.rotator("R").cycle), (700, 20000))

    async def test_close_rotator_releases_its_pass_days(self):
        self.write_rotator(cycle=10)
        await self.controllers.open("M", "rotator")
        self.controllers.on_tick("M", self.ok_tick())                       # timer ควบคุมขอ pass ของดาวเป้าหมาย
        await until(lambda: "rot:M" in self.ephem._day_pairs)                # block รายวันของ owner rot:M
        await self.controllers.close("M", "rotator")
        self.assertNotIn("rot:M", self.ephem._day_pairs)

    async def test_shutdown_closes_all(self):
        await self.open_both()
        await self.engage_both()
        await self.controllers.shutdown()
        self.assertEqual(self.controllers.open_list(), [])
        await until(lambda: self.rot.log[-1:] == [b"q\n"] and b"q\n" in self.rig.log)
        self.assertEqual(self.rot.log[-2:], [b"S\n", b"q\n"])
        await self.assert_api_error(self.controllers.open("M", "radio"), 404, "NOT_FOUND")       # server กำลังปิด
        self.assertEqual(self.controllers.open_list(), [])

    async def test_cancelled_requests_still_finish(self):
        # route ที่ถูกยกเลิก (browser ตัดการเชื่อมต่อ) ต้องไม่ตัดการปลด Engage กลางทาง: S และ q ยังถูกส่ง
        await self.open_both()
        await self.engage_both()
        self.rig.delay_s = self.rot.delay_s = 0.1
        n = len(self.rig.log)
        await until(lambda: len(self.rig.log) > n)                          # รอบถัดไปของวิทยุกำลังรอคำตอบที่ช้า
        off = asyncio.create_task(self.controllers.act("M", "radio", {"action": "engage", "on": False}))
        await asyncio.sleep(0.02)                                           # engage off รอรอบนั้นให้จบ
        self.assertNotIn(b"q\n", self.rig.log)
        off.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await off
        await until(lambda: self.rig.log[-1:] == [b"q\n"])
        close = asyncio.create_task(self.controllers.close("M", "rotator"))
        await until(lambda: b"S\n" in self.rot.log)
        close.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await close
        await until(lambda: self.rot.log[-1:] == [b"q\n"])
        self.assertEqual(self.rot.log[-2:], [b"S\n", b"q\n"])
        self.assertEqual(self.controllers.open_list(), [{"module": "M", "kind": "radio"}])


if __name__ == "__main__":
    unittest.main()
