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
