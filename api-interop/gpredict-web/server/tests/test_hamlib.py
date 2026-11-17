"""hamlib.py: client TCP แบบ asyncio ของ rigctld/rotctld (ref-R §4.2, spec §9.1) กับ FakeHamlib บน 127.0.0.1
คำสั่งเรียงทีละคำสั่ง อ่านคำตอบทีละบรรทัดจนครบหรือเจอ RPRT, ทุกบรรทัดรอไม่เกิน REPLY_TIMEOUT_S, ต่อไม่ได้หรือต่อช้าเกิน CONNECT_TIMEOUT_S
เป็น HamlibError ข้อความไทยมี host:port ค่า timeout ใน test เล็กเสมอ (patch ค่าคงที่ของ module)"""

import asyncio
import errno
import time
import unittest
from unittest import mock

from gpredict_web import hamlib
from gpredict_web.hamlib import HamlibClient, HamlibError, is_error, is_ok
from tests.fake_hamlib import FakeHamlib

LABEL = "rigctld"


async def until(predicate, timeout: float = 1.0) -> None:
    """รอให้ฝั่ง fake อ่านคำสั่งที่ client ส่งไปแล้วแต่ยังไม่ตอบ (เช่น q) จนเงื่อนไขเป็นจริง"""
    deadline = time.monotonic() + timeout
    while not predicate():
        if time.monotonic() > deadline:
            raise AssertionError("fake did not see the expected command in time")
        await asyncio.sleep(0.002)


class HamlibClientTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.fake = FakeHamlib()
        self.port = await self.fake.start()
        self.addAsyncCleanup(self.fake.stop)
        self.client = HamlibClient("127.0.0.1", self.port, LABEL)
        self.addAsyncCleanup(self.client.close)
        await self.client.connect()

    async def test_set_and_get(self):
        self.assertTrue(self.client.connected)
        self.assertEqual(await self.client.command("F  145890000\n"), ["RPRT 0"])
        self.assertEqual(self.fake.freq, 145_890_000)                    # คำสั่งตั้งค่าถูกจำไว้เหมือนวิทยุจริง
        self.fake.freq = 435_000_000
        self.assertEqual(await self.client.command("f\n"), ["435000000"])
        self.assertEqual(self.fake.log, [b"F  145890000\n", b"f\n"])

    async def test_two_line_reply(self):
        self.fake.pos = (180.0, 45.0)
        self.assertEqual(await self.client.command("p\n", lines=2), ["180.000000", "45.000000"])

    async def test_error_reply_stops_early(self):
        self.fake.reply = lambda cmd: b"RPRT -1\n"
        with mock.patch.object(hamlib, "REPLY_TIMEOUT_S", 0.3):          # รอบรรทัดที่สองจะ timeout เป็น HamlibError
            self.assertEqual(await self.client.command("p\n", lines=2), ["RPRT -1"])
        self.assertTrue(self.client.connected)

    async def test_crlf_is_stripped(self):
        self.fake.reply = lambda cmd: b"145890000\r\n"
        self.assertEqual(await self.client.command("f\n"), ["145890000"])

    async def test_reply_timeout(self):
        self.fake.reply = lambda cmd: None
        with mock.patch.object(hamlib, "REPLY_TIMEOUT_S", 0.05):
            started = time.monotonic()
            with self.assertRaises(HamlibError) as raised:
                await self.client.command("f\n")
        self.assertLess(time.monotonic() - started, 0.5)
        self.assertIn(f"127.0.0.1:{self.port}", str(raised.exception))
        # คำตอบที่มาช้าจะกลายเป็นคำตอบของคำสั่งถัดไป จึงปิดการเชื่อมต่อ ผู้เรียกต่อใหม่เอง
        self.assertFalse(self.client.connected)
        with self.assertRaises(HamlibError):
            await self.client.command("f\n")

    async def test_second_line_timeout_is_an_error(self):
        self.fake.reply = lambda cmd: b"180.000000\n"                    # p ต้องตอบสองบรรทัดแต่ได้บรรทัดเดียว
        with mock.patch.object(hamlib, "REPLY_TIMEOUT_S", 0.05):
            with self.assertRaises(HamlibError):
                await self.client.command("p\n", lines=2)

    async def test_overlong_reply_is_an_error(self):
        self.fake.reply = lambda cmd: b"x" * 70_000 + b"\n"
        with self.assertRaises(HamlibError):
            await self.client.command("f\n")
        self.assertFalse(self.client.connected)

    async def test_set_answered_with_a_value_drops_the_connection(self):
        # คำตอบเหลื่อมกับคำสั่ง (spec §4.3): คำสั่งตั้งค่าได้ค่าแทน RPRT คือได้คำตอบของคำสั่งก่อนหน้า ปิดการเชื่อมต่อให้ผู้เรียกต่อใหม่
        self.fake.reply = lambda cmd: b"145890000\n"
        with self.assertRaises(HamlibError) as raised:
            await self.client.command("F  145900000\n", expect=hamlib.SET)
        self.assertIn(f"127.0.0.1:{self.port}", str(raised.exception))
        self.assertIn('"145890000"', str(raised.exception))
        self.assertFalse(self.client.connected)

    async def test_read_answered_rprt_0_drops_the_connection(self):
        self.fake.reply = lambda cmd: b"RPRT 0\n"
        with self.assertRaises(HamlibError) as raised:
            await self.client.command("f\n", expect=hamlib.READ)
        self.assertIn('"RPRT 0"', str(raised.exception))
        self.assertFalse(self.client.connected)

    async def test_replies_in_step_keep_the_connection(self):
        self.assertEqual(await self.client.command("F  145900000\n", expect=hamlib.SET), ["RPRT 0"])
        self.assertEqual(await self.client.command("f\n", expect=hamlib.READ), ["145900000"])
        self.fake.reply = lambda cmd: b"RPRT -11\n"                       # ถูกปฏิเสธก็ยังตรงกับคำสั่ง
        self.assertEqual(await self.client.command("F  1\n", expect=hamlib.SET), ["RPRT -11"])
        self.assertEqual(await self.client.command("f\n", expect=hamlib.READ), ["RPRT -11"])
        self.fake.reply = lambda cmd: b"RPRT 0\n"
        self.assertEqual(await self.client.command("f\n"), ["RPRT 0"])   # ไม่บอกชนิดคำสั่ง: ไม่ตรวจ
        self.assertTrue(self.client.connected)

    async def test_bytes_command(self):
        self.assertEqual(await self.client.command(b"\x8b\n"), ["0"])
        self.assertEqual(self.fake.log[-1], b"\x8b\n")

    async def test_close_sends_q(self):
        await self.client.close()
        await until(lambda: self.fake.log and self.fake.log[-1] == b"q\n")
        self.assertFalse(self.client.connected)
        await self.client.close()                                       # ซ้ำไม่ raise และไม่ส่ง q อีก
        self.assertEqual(self.fake.log, [b"q\n"])

    async def test_close_after_peer_closed_does_not_raise(self):
        self.fake.drop()
        with self.assertRaises(HamlibError):
            await self.client.command("f\n")
        await self.client.close()
        self.assertFalse(self.client.connected)

    async def test_peer_closed(self):
        self.fake.drop()
        with self.assertRaises(HamlibError) as raised:
            await self.client.command("f\n")
        self.assertIn(f"127.0.0.1:{self.port}", str(raised.exception))
        self.assertFalse(self.client.connected)

    async def test_command_without_connection(self):
        client = HamlibClient("127.0.0.1", self.port, LABEL)
        with self.assertRaises(HamlibError) as raised:
            await client.command("f\n")
        self.assertIn(f"127.0.0.1:{self.port}", str(raised.exception))
        self.assertFalse(client.connected)

    async def test_connect_again_after_failure(self):
        self.fake.drop()
        with self.assertRaises(HamlibError):
            await self.client.command("f\n")
        await self.client.connect()                                      # เหมือน controller ที่ต่อใหม่ทุกรอบเมื่อไม่มี socket
        self.assertTrue(self.client.connected)
        self.assertEqual(await self.client.command("f\n"), ["145890000"])

    async def test_commands_are_serialised(self):
        self.fake.delay_s = 0.02
        self.fake.freq, self.fake.split_freq = 145_890_000, 435_000_000
        first, second = await asyncio.gather(self.client.command("f\n"), self.client.command("i\n"))
        self.assertEqual(self.fake.log, [b"f\n", b"i\n"])
        self.assertEqual(first, ["145890000"])
        self.assertEqual(second, ["435000000"])


class HamlibConnectTest(unittest.IsolatedAsyncioTestCase):
    async def test_connect_refused_and_bad_host(self):
        fake = FakeHamlib()
        port = await fake.start()
        await fake.stop()                                               # port นี้ไม่มีใครฟังแล้ว
        with mock.patch.object(hamlib, "CONNECT_TIMEOUT_S", 2.0):
            for host in ("127.0.0.1", "no-such-host.invalid"):
                client = HamlibClient(host, port, LABEL)
                with self.subTest(host=host):
                    with self.assertRaises(HamlibError) as raised:
                        await client.connect()
                    self.assertIn(f"{host}:{port}", str(raised.exception))
                    self.assertFalse(client.connected)

    async def test_connect_failure_text_is_thai(self):
        # ข้อความที่เพิ่มเองเป็นภาษาไทยทั้งหมด ไม่มีข้อความดิบของระบบหรือ asyncio (Connect call failed, Multiple exceptions)
        # รวมกรณี localhost ที่ asyncio ลองหลาย address (::1 แล้ว 127.0.0.1)
        fake = FakeHamlib()
        port = await fake.start()
        await fake.stop()
        with mock.patch.object(hamlib, "CONNECT_TIMEOUT_S", 2.0):
            for host in ("127.0.0.1", "localhost", "no-such-host.invalid"):
                client = HamlibClient(host, port, LABEL)
                with self.subTest(host=host):
                    with self.assertRaises(HamlibError) as raised:
                        await client.connect()
                    self.assertThai(str(raised.exception), f"{LABEL} {host}:{port}")
        for host in ("127.0.0.1", "localhost"):                          # เหตุผลของการถูกปฏิเสธต้องบอกตรงๆ ไม่ใช่เหตุผลกลาง
            with self.subTest(refused=host):
                with self.assertRaises(HamlibError) as raised:
                    await HamlibClient(host, port, LABEL).connect()
                self.assertIn("ปฏิเสธ", str(raised.exception))

    async def test_connect_error_reasons(self):
        refused = ConnectionRefusedError(errno.ECONNREFUSED, "Connect call failed ('::1', 4532, 0, 0)")
        cases = {
            # OSError(ETIMEDOUT) คือ TimeoutError จึงต้องมาในกลุ่มของ all_errors (กรณีจริง) ไม่ปนกับ timeout ของเราเอง
            "timed out": (ExceptionGroup("create_connection failed", [OSError(errno.ETIMEDOUT, "Operation timed out")]),
                          "หมดเวลารอ"),
            "host unreachable": (OSError(errno.EHOSTUNREACH, "No route to host"), "ไปไม่ถึงเครื่อง"),
            "network unreachable": (OSError(errno.ENETUNREACH, "Network is unreachable"), "ไปไม่ถึงเครือข่าย"),
            "unknown errno": (OSError(errno.EPERM, "Operation not permitted"), "ข้อผิดพลาดของเครือข่าย (รหัส"),
            "no errno": (OSError("Multiple exceptions: [Errno 61] ..."), "ข้อผิดพลาดของเครือข่าย"),
            "all candidates refused": (ExceptionGroup("create_connection failed", [refused, refused]), "ปฏิเสธ"),
            "mixed candidates": (ExceptionGroup("create_connection failed",
                                                [refused, OSError(errno.ENETUNREACH, "Network is unreachable")]),
                                 "ปฏิเสธ"),
        }
        for name, (error, expected) in cases.items():
            async def failing(host, port, **kwargs):
                raise error

            client = HamlibClient("localhost", 4532, LABEL)
            with self.subTest(name), mock.patch("asyncio.open_connection", failing):
                with self.assertRaises(HamlibError) as raised:
                    await client.connect()
            message = str(raised.exception)
            self.assertIn(expected, message)
            self.assertThai(message, f"{LABEL} localhost:4532")
            if expected == "ปฏิเสธ":
                self.assertEqual(message.count("ปฏิเสธ"), 1, name)       # ล้มเหมือนกันทุก address แสดงเหตุผลเดียว

    def assertThai(self, message: str, where: str) -> None:
        """มี host:port และนอกจากส่วนนั้นไม่มีตัวอักษรละตินเลย"""
        self.assertIn(where, message)
        self.assertRegex(message, "[\u0e00-\u0e7f]")
        self.assertNotRegex(message.replace(where, ""), "[A-Za-z]")

    async def test_connect_timeout(self):
        async def never(host, port, **kwargs):
            await asyncio.sleep(10)

        client = HamlibClient("127.0.0.1", 4532, LABEL)
        with (mock.patch.object(hamlib, "CONNECT_TIMEOUT_S", 0.05), mock.patch("asyncio.open_connection", never)):
            started = time.monotonic()
            with self.assertRaises(HamlibError) as raised:
                await client.connect()
        self.assertLess(time.monotonic() - started, 0.5)
        self.assertIn("127.0.0.1:4532", str(raised.exception))
        self.assertFalse(client.connected)


class FakeHamlibTest(unittest.IsolatedAsyncioTestCase):
    """ตัว fake เองที่ test ของ controller (Task 4, 6, 8, 9) พึ่งพา: ค่าตั้งต้นของคำตอบ, การจำค่า, q, drop, stop"""

    async def asyncSetUp(self):
        self.fake = FakeHamlib()
        self.port = await self.fake.start()
        self.addAsyncCleanup(self.fake.stop)
        self.client = HamlibClient("127.0.0.1", self.port, LABEL)
        self.addAsyncCleanup(self.client.close)
        await self.client.connect()

    async def test_set_commands_are_remembered(self):
        for cmd in ("F currVFO  145890000\n", "I VFOA  435000000\n", "T currVFO 1\n", "P 120.00 30.00\n"):
            self.assertEqual(await self.client.command(cmd), ["RPRT 0"])
        self.assertEqual((self.fake.freq, self.fake.split_freq, self.fake.ptt, self.fake.pos),
                         (145_890_000, 435_000_000, 1, (120.0, 30.0)))
        self.assertEqual(await self.client.command("i currVFO\n"), ["435000000"])
        self.assertEqual(await self.client.command("t\n"), ["1"])
        self.assertEqual(await self.client.command("p\n", lines=2), ["120.000000", "30.000000"])

    async def test_other_commands_answer_rprt_0(self):
        for cmd in ("\\set_vfo_opt 1\n", "S 1 VFOA\n", "AOS\n", "U IQRECORD 1\n", "S\n"):
            self.assertEqual(await self.client.command(cmd), ["RPRT 0"], cmd)
        self.assertEqual(await self.client.command("F bad\n"), ["RPRT -1"])

    async def test_chk_vfo_follows_vfo_opt(self):
        for value, expected in ((False, "0"), (True, "1"), ("1", "1")):
            self.fake.vfo_opt = value
            self.assertEqual(await self.client.command("\\chk_vfo\n"), [expected])
        self.assertEqual(await self.client.command("\\set_vfo_opt 1\n"), ["RPRT 0"])
        self.fake.vfo_opt = False
        self.assertEqual(await self.client.command("\\chk_vfo\n"), ["0"])    # \set_vfo_opt ไม่เปลี่ยนค่าที่ test ตั้ง

    async def test_dcd_with_a_vfo_name_answers_two_lines(self):
        # แบบ rigctld 4.7.2 หลัง \set_vfo_opt 1 (ตรวจกับของจริง): ชื่อ VFO ต่อท้าย 0x8b ถูกอ่านเป็นคำสั่งอีกตัวที่ตอบ RPRT -1
        self.assertEqual(await self.client.command(b"\x8b\n"), ["0"])
        self.assertEqual(await self.client.command(b"\x8b currVFO\n", lines=2), ["0", "RPRT -1"])

    async def test_reply_none_is_silence_and_default_reply_is_reusable(self):
        self.fake.reply = lambda cmd: None if cmd.startswith(b"AOS") else self.fake.default_reply(cmd)
        with mock.patch.object(hamlib, "REPLY_TIMEOUT_S", 0.05):
            with self.assertRaises(HamlibError):
                await self.client.command("AOS\n")
        await self.client.connect()
        self.assertEqual(await self.client.command("f\n"), ["145890000"])
        self.fake.reply = None
        with mock.patch.object(hamlib, "REPLY_TIMEOUT_S", 0.05):
            with self.assertRaises(HamlibError):
                await self.client.command("f\n")

    async def test_q_closes_the_connection_but_not_the_server(self):
        await self.client.close()
        await until(lambda: self.fake.log == [b"q\n"])
        await self.client.connect()
        self.assertEqual(await self.client.command("f\n"), ["145890000"])

    async def test_drop_keeps_listening_and_stop_refuses_new_connections(self):
        self.fake.drop()
        with self.assertRaises(HamlibError):
            await self.client.command("f\n")
        await self.client.connect()
        self.assertEqual(await self.client.command("f\n"), ["145890000"])
        await self.fake.stop()
        await self.fake.stop()                                          # เรียกซ้ำได้
        with self.assertRaises(HamlibError):
            await self.client.command("f\n")
        with self.assertRaises(HamlibError):
            await self.client.connect()


class ReplyHelpersTest(unittest.TestCase):
    def test_is_ok(self):
        self.assertTrue(is_ok(["RPRT 0"]))
        self.assertFalse(is_ok(["RPRT -1"]))
        self.assertFalse(is_ok(["145890000"]))
        self.assertFalse(is_ok([]))

    def test_is_error(self):
        self.assertTrue(is_error(["RPRT -1"]))
        self.assertTrue(is_error(["RPRT 0"]))                            # ขึ้นต้น RPRT ทุกแบบ (ผู้เรียกแยกด้วย is_ok เอง)
        self.assertFalse(is_error(["145890000"]))
        self.assertFalse(is_error([]))


if __name__ == "__main__":
    unittest.main()
