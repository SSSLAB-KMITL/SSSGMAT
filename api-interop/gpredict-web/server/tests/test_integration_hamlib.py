"""integration กับ hamlib จริง (spec §10 "ตรวจรับกับ hamlib จริง", Task 15): rigctld และ rotctld รุ่น dummy (-m 1)
ที่ test สตาร์ตเองบน port ว่างของ 127.0.0.1 แล้วปิดเมื่อจบ ข้ามเมื่อหาโปรแกรมไม่เจอ (shutil.which)

controller สร้างด้วย timer=False แล้ว test เรียก act/on_tick/run_cycle (หรือ control_tick/client_once) เอง เหมือน test_rig และ test_rot
แต่ปลายทางเป็นโปรแกรมของ hamlib จึงเห็นว่าคำสั่งที่เราสร้างตรงกับที่ rigctld/rotctld รับจริง ค่าที่ตั้งได้อ่านกลับด้วยการเชื่อมต่ออีกเส้น"""

import asyncio
import json
import shutil
import socket
import subprocess
import time
import unittest
from datetime import datetime, timedelta, timezone

from gpredict_web.hamlib import HamlibClient
from gpredict_web.hwconf import HwConf
from gpredict_web.rig import RigController
from gpredict_web.rot import RotController
from tests.helpers import temp_config

RIGCTLD = shutil.which("rigctld")
ROTCTLD = shutil.which("rotctld")
HOST = "127.0.0.1"
START_TIMEOUT_S = 5.0
T0 = datetime(2026, 11, 14, 12, 0, 0, tzinfo=timezone.utc)
QTH = (13.7563, 100.5018)                        # (lat, lon)
C_KMS = 299792.458                               # ความเร็วแสงที่ Gpredict ใช้ (เขียนซ้ำที่นี่เพื่อคำนวณคำตอบแยกจากโค้ดที่ตรวจ)


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind((HOST, 0))
        return s.getsockname()[1]


def row(az: float, el: float, rate: float) -> dict:
    """แถวของดาวเป้าหมายใน tick (ช่องที่ controller ใช้)"""
    return {"az": az, "el": el, "range_km": 1000.0, "range_rate_kms": rate, "next_aos": None, "next_los": None}


class HamlibDaemonTestCase(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.cfg = temp_config(self)
        self.hw = HwConf(self.cfg.data_dir)

    async def start_daemon(self, program: str) -> int:
        """`<program> -m 1 -T 127.0.0.1 -t <port ว่าง>` แล้วรอจนรับการเชื่อมต่อ ปิดด้วย terminate เมื่อ test จบ"""
        port = free_port()
        proc = subprocess.Popen([program, "-m", "1", "-T", HOST, "-t", str(port)],
                                stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

        def stop() -> None:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()

        self.addCleanup(stop)
        deadline = time.monotonic() + START_TIMEOUT_S
        while True:
            try:
                _, writer = await asyncio.open_connection(HOST, port)
            except OSError:
                if proc.poll() is not None or time.monotonic() > deadline:
                    self.fail(f"{program} did not start on port {port}")
                await asyncio.sleep(0.05)
                continue
            writer.close()
            await writer.wait_closed()
            return port

    def write_conf(self, name: str, keys: dict) -> None:
        path = self.cfg.data_dir / "hwconf" / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(keys), encoding="utf-8")

    async def reader(self, port: int, label: str) -> HamlibClient:
        """การเชื่อมต่ออีกเส้นสำหรับอ่านค่าจาก daemon (ไม่ตั้ง VFO option คำสั่งจึงไม่มีชื่อ VFO)"""
        client = HamlibClient(HOST, port, label)
        await client.connect()
        self.addAsyncCleanup(client.close)
        return client


@unittest.skipIf(RIGCTLD is None, "rigctld (hamlib) not installed")
class DummyRigctldTest(HamlibDaemonTestCase):
    LO = 2_256_000_000.0                         # downconverter 2.4 GHz → 2 m: ความถี่ของวิทยุ = f_sat + dd − LO
    RATE_KMS = 5.0
    DOWN_HZ = 145_900_000.0                      # ค่าตั้งต้นของปุ่มหมุนดาวในไฟล์ (ไม่มี transponder) LO และ LO_UP เป็น 0
    UP_HZ = 435_100_000.0

    async def engaged_rig(self, keys: dict) -> tuple[RigController, HamlibClient]:
        """rigctld dummy, ไฟล์วิทยุ DUMMY (ค่าที่ไม่ได้ให้มาเป็นค่าตั้งต้นข้างบน), controller ที่ Engage และ Track แล้ว และการเชื่อมต่อสำหรับอ่าน"""
        port = await self.start_daemon(RIGCTLD)
        self.write_conf("DUMMY.rig.json", {"Host": HOST, "Port": port, "LO": 0.0, "LO_UP": 0.0,
                                           "DefaultUplinkFreqHz": self.UP_HZ, "DefaultDownlinkFreqHz": self.DOWN_HZ, **keys})
        ctl = RigController("Amateur", self.hw, [(25544, "ISS")], 25544, lambda norad: [], timer=False)
        self.addAsyncCleanup(ctl.close)                  # ทำก่อนปิด daemon (cleanup ทำย้อนลำดับ)
        rig = await self.reader(port, "rigctld")
        await ctl.act({"action": "engage", "on": True})
        await ctl.act({"action": "track", "on": True})
        return ctl, rig

    async def cycle(self, ctl: RigController, k: int) -> tuple[float, float]:
        """รอบที่ k: range rate เปลี่ยนทุกรอบ (Doppler เปลี่ยนหลายร้อย Hz จึงต้องส่งใหม่) คืนความถี่ของวิทยุตามสูตร (downlink, uplink)
        และตรวจว่า controller ยัง Engage โดยไม่มีข้อผิดพลาด"""
        rate = 5.0 - 0.7 * k
        ctl.on_tick(T0 + timedelta(seconds=k), row(180.0, 10.0, rate))
        await ctl.run_cycle()
        self.assertTrue(ctl.engaged)
        self.assertIsNone(ctl.snapshot()["status"])
        return self.DOWN_HZ - self.DOWN_HZ * rate / C_KMS, self.UP_HZ + self.UP_HZ * rate / C_KMS

    @staticmethod
    async def frequencies(rig: HamlibClient) -> tuple[float, float]:
        """(f, i) ที่ rigctld ถืออยู่: ความถี่ของ VFO ปัจจุบันและความถี่ส่งของ split"""
        return float((await rig.command("f\n"))[0]), float((await rig.command("i\n"))[0])

    async def test_full_duplex_read_dcd_against_dummy_rigctld(self):
        """Read DCD กับ VFO option ที่ rigctld จริงรับ (ตรวจรับพบว่า `\\x8b currVFO` ได้คำตอบสองบรรทัด คำตอบเหลื่อม
        จนส่ง `I VFOA` เป็นค่าที่อ่านค้าง) dummy สลับ DCD ทุกครั้งที่อ่าน: รอบที่ DCD เปิด downlink ไม่ถูกส่งและ rigctld คงค่าเดิม
        uplink (split) ถูกส่งทุกรอบเพราะ Full-duplex ไม่สน PTT"""
        ctl, rig = await self.engaged_rig({"Type": 3, "PTT": 2, "VFO_UP": 2, "VFO_DOWN": 1})
        f_prev, _ = await self.frequencies(rig)
        sent = 0
        for k in range(6):
            down, up = await self.cycle(ctl, k)
            f, i = await self.frequencies(rig)
            with self.subTest(cycle=k):
                self.assertAlmostEqual(i, up, delta=1.0)
                self.assertTrue(abs(f - down) <= 1.0 or f == f_prev, f"f {f} is neither {down:.0f} nor {f_prev:.0f}")
            sent += abs(f - down) <= 1.0
            f_prev = f
        self.assertGreaterEqual(sent, 1)                 # DCD ปิดอย่างน้อยหนึ่งรอบ downlink จึงถูกส่งจริง

    async def test_full_duplex_read_ptt_against_dummy_rigctld(self):
        """Read PTT (`t currVFO`) ค่า PTT ตั้งจากการเชื่อมต่ออีกเส้น: PTT ปิดส่ง downlink, เปิดไม่ส่ง uplink (split) ส่งทุกรอบ"""
        ctl, rig = await self.engaged_rig({"Type": 3, "PTT": 1, "VFO_UP": 2, "VFO_DOWN": 1})
        f_prev = None
        for k, ptt in enumerate((0, 1, 1, 0, 1, 0)):
            self.assertEqual(await rig.command(f"T {ptt}\n"), ["RPRT 0"])
            down, up = await self.cycle(ctl, k)
            f, i = await self.frequencies(rig)
            with self.subTest(cycle=k, ptt=ptt):
                self.assertAlmostEqual(f, down if ptt == 0 else f_prev, delta=1.0)
                self.assertAlmostEqual(i, up, delta=1.0)
            f_prev = f

    async def test_half_duplex_against_dummy_rigctld(self):
        """Half-duplex กับ Read PTT: VFO เดียวกันได้ downlink เมื่อ PTT ปิด และ uplink เมื่อ PTT เปิด (รวม PTT เปิดสองรอบติดกัน)"""
        ctl, rig = await self.engaged_rig({"Type": 2, "PTT": 1})
        for k, ptt in enumerate((0, 1, 0, 1, 1, 0)):
            self.assertEqual(await rig.command(f"T {ptt}\n"), ["RPRT 0"])
            down, up = await self.cycle(ctl, k)
            f, _ = await self.frequencies(rig)
            with self.subTest(cycle=k, ptt=ptt):
                self.assertAlmostEqual(f, up if ptt else down, delta=1.0)

    async def test_rx_only_against_dummy_rigctld(self):
        port = await self.start_daemon(RIGCTLD)
        self.write_conf("DUMMY.rig.json", {"Host": HOST, "Port": port, "Type": 0, "PTT": 0, "LO": self.LO, "LO_UP": 0.0,
                                           "DefaultUplinkFreqHz": 0.0, "DefaultDownlinkFreqHz": 2_400_100_000.0})
        ctl = RigController("Amateur", self.hw, [(25544, "ISS")], 25544, lambda norad: [], timer=False)
        self.addAsyncCleanup(ctl.close)                  # ทำก่อนปิด daemon (cleanup ทำย้อนลำดับ)
        rig = await self.reader(port, "rigctld")
        await ctl.act({"action": "engage", "on": True})
        await ctl.act({"action": "track", "on": True})

        for k in range(5):
            # ผู้ใช้หมุนปุ่มของดาวทุกรอบ ความถี่จึงต้องถูกส่งใหม่ทุกรอบ (เศษ .3 Hz ทำให้เห็นการปัดของ %10.0f)
            f_sat = 2_400_100_000.0 + 12_345.3 * k
            await ctl.act({"action": "freq", "link": "down", "hz": f_sat})
            ctl.on_tick(T0 + timedelta(seconds=k), row(180.0, 10.0, self.RATE_KMS))
            await ctl.run_cycle()
            dd = -f_sat * self.RATE_KMS / C_KMS
            expected = round(f_sat + dd - self.LO)
            read = float((await rig.command("f\n"))[0])
            with self.subTest(cycle=k):
                self.assertAlmostEqual(read, expected, delta=1.0)
                self.assertAlmostEqual(ctl.snapshot()["down"]["doppler_hz"], dd, delta=1e-6)    # ราว −40 kHz ที่ 2.4 GHz
                self.assertTrue(ctl.engaged)
                self.assertIsNone(ctl.snapshot()["status"])


@unittest.skipIf(ROTCTLD is None, "rotctld (hamlib) not installed")
class DummyRotctldTest(HamlibDaemonTestCase):
    TARGET = (20.0, 5.0)                         # dummy หมุนราว 6°/s จาก (0, 0): ราว 3.5 วินาที (สลับ Az/El แล้วห่างเกิน Threshold)
    DEADLINE_S = 15.0

    async def test_rotator_against_dummy_rotctld(self):
        port = await self.start_daemon(ROTCTLD)
        self.write_conf("ROT.rot.json", {"Host": HOST, "Port": port, "Cycle": 1000, "Threshold": 5.0, "AzType": 0,
                                         "MinAz": 0.0, "MaxAz": 360.0, "MinEl": 0.0, "MaxEl": 90.0, "AzStopPos": 0.0})
        ctl = RotController("Amateur", self.hw, [(25544, "ISS")], 25544,
                            lambda norad, t: None, lambda norad, t: ("ok", None), timer=False)
        self.addAsyncCleanup(ctl.close)
        rot = await self.reader(port, "rotctld")
        await ctl.act({"action": "engage", "on": True})
        await ctl.act({"action": "track", "on": True})
        ctl.on_tick(T0, row(*self.TARGET, 0.0), QTH)

        # รอบของ timer (set-point → P) และของ client (P, p) จน dummy หยุดหมุน: อ่านได้ค่าเดิมสองครั้งติดกัน
        previous = None
        deadline = time.monotonic() + self.DEADLINE_S
        while True:
            await ctl.control_tick()
            await ctl.client_once()
            reply = await rot.command("p\n", lines=2)
            pos = (float(reply[0]), float(reply[1]))
            if pos == previous and pos != (0.0, 0.0):
                break
            if time.monotonic() > deadline:
                self.fail(f"rotctld did not settle, last position {pos}")
            previous = pos
            await asyncio.sleep(0.3)

        snap = ctl.snapshot()
        threshold = snap["threshold_deg"]
        self.assertEqual((snap["setpoint"]["az"], snap["setpoint"]["el"]), self.TARGET)
        self.assertLessEqual(abs(pos[0] - self.TARGET[0]), threshold)
        self.assertLessEqual(abs(pos[1] - self.TARGET[1]), threshold)
        await ctl.control_tick()                         # "Read:" และกากบาทเป็นค่าที่ client อ่านได้รอบล่าสุด
        self.assertEqual(ctl.snapshot()["read"], {"az": f"{pos[0]:.2f}°", "el": f"{pos[1]:.2f}°"})
        self.assertEqual(ctl.snapshot()["rotor"], {"az": pos[0], "el": pos[1]})
        self.assertIsNone(ctl.snapshot()["status"])


if __name__ == "__main__":
    unittest.main()
