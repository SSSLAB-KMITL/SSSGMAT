"""fake_hamlib.py: rigctld/rotctld ปลอมสำหรับ test (spec §10, ref-R §4 และ §7) เป็น asyncio TCP server บน 127.0.0.1 port ชั่วคราว
test ห้ามใช้ hamlib จริงหรือเน็ต

- start() คืน port, stop() ปิดทั้ง server และทุกการเชื่อมต่อ (เรียกซ้ำได้), drop() ปิดเฉพาะการเชื่อมต่อที่มีอยู่ server ยังฟังต่อ
- log เก็บทุกคำสั่งที่ได้รับตามไบต์ รวม \\n ท้ายบรรทัด (ก่อน delay_s และก่อนตอบ)
- reply เป็น Callable[[bytes], bytes | None] รับคำสั่งทั้งบรรทัด คืนไบต์ที่จะส่งกลับ หรือ None = ไม่ตอบ (reply = None ก็ไม่ตอบทุกคำสั่ง)
  ค่าตั้งต้นคือ default_reply ซึ่ง test เรียกต่อได้ เช่น lambda cmd: None if cmd.startswith(b"AOS") else fake.default_reply(cmd)
- default_reply: คำสั่งตั้งค่าตอบ "RPRT 0" และจำค่าไว้ (F -> freq, I -> split_freq, T -> ptt, P -> pos) คำสั่งอ่านตอบค่าที่จำไว้
  (f, i, t, p ตอบสองบรรทัด az กับ el, \\chk_vfo, 0x8b ตอบ DCD "0") คำสั่งอื่นตอบ "RPRT 0"
- vfo_opt ตอบแค่ \\chk_vfo (True หรือ "1" -> "1", นอกนั้น "0") \\set_vfo_opt ไม่เปลี่ยนค่านี้ test จึงจำลอง rigctld ที่ไม่รับ VFO option ได้
- q ปิดการเชื่อมต่อนั้นโดยไม่ตอบ เหมือน rigctld
- delay_s หน่วงก่อนตอบทุกคำสั่ง (จำลอง rigctld ช้า)
"""

import asyncio
from collections.abc import Callable


class FakeHamlib:
    def __init__(self) -> None:
        self.freq: float = 145_890_000.0
        self.split_freq: float = 145_890_000.0
        self.ptt: int = 0
        self.pos: tuple[float, float] = (0.0, 0.0)             # (az, el) ที่ p ตอบ
        self.vfo_opt: bool | str = False
        self.log: list[bytes] = []
        self.reply: Callable[[bytes], bytes | None] | None = self.default_reply
        self.delay_s: float = 0.0
        self.port: int = 0
        self._server: asyncio.Server | None = None
        self._tasks: set[asyncio.Task] = set()

    async def start(self) -> int:
        self._server = await asyncio.start_server(self._serve, "127.0.0.1", 0)
        self.port = self._server.sockets[0].getsockname()[1]
        return self.port

    async def stop(self) -> None:
        server, self._server = self._server, None
        if server is not None:
            server.close()
            server.close_clients()
            await server.wait_closed()
        tasks = list(self._tasks)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    def drop(self) -> None:
        """ปิดทุกการเชื่อมต่อที่มีอยู่ (rigctld ถูกปิดหรือสายหลุด) server ยังรับการเชื่อมต่อใหม่"""
        if self._server is not None:
            self._server.close_clients()

    def default_reply(self, cmd: bytes) -> bytes:
        words = cmd.split()
        name = words[0] if words else b""
        try:
            if name == b"f":
                return f"{self.freq:.0f}\n".encode("ascii")
            if name == b"i":
                return f"{self.split_freq:.0f}\n".encode("ascii")
            if name == b"t":
                return f"{self.ptt}\n".encode("ascii")
            if name == b"p":
                return f"{self.pos[0]:f}\n{self.pos[1]:f}\n".encode("ascii")
            if name == b"\\chk_vfo":
                return b"1\n" if self.vfo_opt in (1, "1") else b"0\n"
            if name == b"\x8b":
                return b"0\n"
            if name == b"F":
                self.freq = float(words[-1])
            elif name == b"I":
                self.split_freq = float(words[-1])
            elif name == b"T":
                self.ptt = int(words[-1])
            elif name == b"P":
                self.pos = (float(words[1]), float(words[2]))
        except (ValueError, IndexError):
            return b"RPRT -1\n"
        return b"RPRT 0\n"

    async def _serve(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        task = asyncio.current_task()
        self._tasks.add(task)
        try:
            while True:
                line = await reader.readline()
                if not line.endswith(b"\n"):                    # ปลายทางปิดแล้ว
                    break
                self.log.append(line)
                if line.strip() == b"q":
                    break
                if self.delay_s:
                    await asyncio.sleep(self.delay_s)
                data = self.reply(line) if self.reply is not None else None
                if data is not None:
                    writer.write(data)
                    await writer.drain()
        except ConnectionError:                                 # ฝั่ง client ปิดหรือ drop() ระหว่างรอ
            pass
        finally:
            self._tasks.discard(task)
            writer.close()
