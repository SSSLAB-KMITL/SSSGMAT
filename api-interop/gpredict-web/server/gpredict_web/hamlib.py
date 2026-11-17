"""client TCP แบบ asyncio ของ hamlib rigctld/rotctld (ref-R §4.2 และ §7, spec §3.1 และ §9.1)

- หนึ่ง client = หนึ่งการเชื่อมต่อ คำสั่งเรียงทีละคำสั่งด้วย lock (Gpredict ใช้ mutex) ส่งหนึ่งบรรทัดแล้วอ่านคำตอบทีละบรรทัด
  จนครบจำนวนบรรทัดที่คำสั่งนั้นตอบ หรือเจอบรรทัดที่ขึ้นต้น RPRT (rigctld ตอบ RPRT <รหัส> แทนค่าเมื่อคำสั่งล้มเหลว)
- แก้ข้อบกพร่อง ref-R §13 ข้อ 8: Gpredict รอตลอดไป ของเราเชื่อมต่อไม่เกิน CONNECT_TIMEOUT_S และรอแต่ละบรรทัดไม่เกิน REPLY_TIMEOUT_S
  ชื่อ host ที่หาไม่เจอเป็น error ปกติ ทุกกรณีเป็น HamlibError ข้อความไทยมีป้ายอุปกรณ์กับ host:port พร้อมแสดงเป็น status ของ controller
- คำสั่งที่ล้ม (timeout, ปลายทางปิด, เครือข่ายขัดข้อง, ถูกยกเลิกกลางทาง) ปิดการเชื่อมต่อทันทีโดยไม่ส่ง q เพราะคำตอบที่ยังค้างจะถูกอ่านเป็น
  คำตอบของคำสั่งถัดไป connected เป็น False และ controller เรียก connect ใหม่เอง (Gpredict ก็ต่อใหม่ทุกรอบเมื่อไม่มี socket)
- safety net ของคำตอบที่เหลื่อมกับคำสั่ง (ของเรา, spec §4.3): ผู้เรียกบอกชนิดคำสั่งได้ คำสั่งตั้งค่า (SET) ที่ได้บรรทัดที่ไม่ใช่ RPRT
  หรือคำสั่งอ่าน (READ) ที่ได้ RPRT 0 แทนค่า คือได้คำตอบของคำสั่งอื่น (rigctld ตอบบางคำสั่งเกินมา) ล้มเป็น HamlibError
  และปิดการเชื่อมต่อแบบเดียวกับข้อบน การต่อใหม่ทำให้คำตอบกลับมาตรงกับคำสั่ง แทนที่จะเหลื่อมไปตลอด
- ต่อด้วยชื่อ host ทุกตระกูลที่ resolver ให้ (ลำดับของ getaddrinfo) ไม่ใช่เฉพาะ IPv4 แบบ gethostbyname ของ Gpredict เพราะ rigctld บน macOS
  อาจฟังเฉพาะ ::1 เมื่อใช้ localhost (ของเรา)
"""

import asyncio
import errno
import socket

CONNECT_TIMEOUT_S = 3.0
REPLY_TIMEOUT_S = 2.0

_RPRT = "RPRT"

SET = "set"                                     # คำสั่งตั้งค่า: คำตอบต้องเป็นบรรทัด RPRT
READ = "read"                                   # คำสั่งอ่านค่า: คำตอบต้องไม่ใช่ RPRT 0


class HamlibError(Exception):
    """ข้อความเป็นภาษาไทย ขึ้นต้นด้วยป้ายอุปกรณ์และ host:port พร้อมแสดงให้ผู้ใช้"""


def is_ok(reply: list[str]) -> bool:
    """คำตอบของคำสั่งตั้งค่าที่สำเร็จ: บรรทัดแรกขึ้นต้น "RPRT 0" (ref-R §4.2)"""
    return bool(reply) and reply[0].startswith("RPRT 0")


def is_error(reply: list[str]) -> bool:
    """คำตอบของคำสั่งอ่านที่ล้ม: บรรทัดแรกขึ้นต้น "RPRT" (ref-R §4.2)"""
    return bool(reply) and reply[0].startswith(_RPRT)


# เหตุผลที่ผู้ใช้เห็นเป็นภาษาไทยเสมอ: ข้อความดิบของระบบ (strerror, "Connect call failed (...)") เป็นภาษาอังกฤษและมี address ยาว
_ERRNO_REASONS = {
    errno.ECONNREFUSED: "ถูกปฏิเสธ ยังไม่ได้เปิดโปรแกรมหรือพอร์ตผิด",
    errno.ETIMEDOUT: "หมดเวลารอ",
    errno.EHOSTUNREACH: "ไปไม่ถึงเครื่องปลายทาง",
    errno.ENETUNREACH: "ไปไม่ถึงเครือข่ายปลายทาง",
    errno.ECONNRESET: "การเชื่อมต่อถูกตัด",
    errno.ECONNABORTED: "การเชื่อมต่อถูกยกเลิก",
    errno.EPIPE: "การเชื่อมต่อถูกปิด",
}


def _reason(exc: BaseException) -> str:
    """เหตุผลภาษาไทยของ OSError หรือของ ExceptionGroup จาก open_connection(all_errors=True) (ต่อด้วยชื่อ host ที่ได้หลาย address
    เช่น localhost = ::1 และ 127.0.0.1) ที่ไม่ใช่ errno ในตาราง ใช้ข้อความกลางพร้อมรหัส ไม่ใช้ข้อความของระบบ"""
    errors = exc.exceptions if isinstance(exc, BaseExceptionGroup) else (exc,)
    reasons = []
    for error in errors:
        code = getattr(error, "errno", None)
        reason = _ERRNO_REASONS.get(code) or ("ข้อผิดพลาดของเครือข่าย" + (f" (รหัส {code})" if code else ""))
        if reason not in reasons:                       # หลาย address ล้มเหมือนกัน (ถูกปฏิเสธทั้ง ::1 และ 127.0.0.1) แสดงครั้งเดียว
            reasons.append(reason)
    return ", ".join(reasons)


def _out_of_step(reply: list[str], expect: str | None) -> bool:
    """คำตอบเป็นของคำสั่งอื่น: SET ได้บรรทัดที่ไม่ใช่ RPRT หรือ READ ได้ RPRT 0 (ถูกปฏิเสธด้วย RPRT อื่นยังตรงกับคำสั่ง)"""
    if expect == SET:
        return not is_error(reply)
    if expect == READ:
        return is_ok(reply)
    return False


class HamlibClient:
    def __init__(self, host: str, port: int, label: str) -> None:
        self.host = host
        self.port = port
        self.label = label
        self._reader: asyncio.StreamReader | None = None
        self._writer: asyncio.StreamWriter | None = None
        self._lock = asyncio.Lock()

    @property
    def connected(self) -> bool:
        """ยังต่ออยู่และปลายทางยังไม่ปิด (ตรวจเท่าที่ฝั่งเราเห็น ปลายทางที่เงียบหายต้องรอ timeout ของคำสั่งถัดไป)"""
        return (self._writer is not None and not self._writer.is_closing()
                and self._reader is not None and not self._reader.at_eof())

    @property
    def _where(self) -> str:
        return f"{self.label} {self.host}:{self.port}"

    async def connect(self) -> None:
        """เปิดการเชื่อมต่อใหม่ (ปิดของเดิมที่ยังค้างอยู่ก่อนโดยไม่ส่ง q)"""
        async with self._lock:
            self._abort()
            try:
                # all_errors: ถ้าไม่ใส่ ชื่อ host ที่ได้หลาย address ล้มแล้ว asyncio ยุบเป็น OSError("Multiple exceptions: ...") ที่ไม่มี errno
                self._reader, self._writer = await asyncio.wait_for(
                    asyncio.open_connection(self.host, self.port, all_errors=True), CONNECT_TIMEOUT_S)
            except TimeoutError:
                raise HamlibError(f"เชื่อมต่อ {self._where} ไม่ได้ภายใน {CONNECT_TIMEOUT_S:g} วินาที") from None
            except socket.gaierror:
                raise HamlibError(f"หาที่อยู่ของ {self._where} ไม่พบ") from None
            except (OSError, ExceptionGroup) as exc:
                raise HamlibError(f"เชื่อมต่อ {self._where} ไม่ได้ ({_reason(exc)})") from None

    async def command(self, cmd: str | bytes, lines: int = 1, expect: str | None = None) -> list[str]:
        """ส่งหนึ่งคำสั่ง (ผู้เรียกใส่ \\n ท้ายเอง; str ส่งเป็น ASCII) แล้วอ่านคำตอบไม่เกิน lines บรรทัด หยุดเมื่อเจอบรรทัดที่ขึ้นต้น RPRT
        บรรทัดตัด \\r และ \\n ท้ายออก ล้มเป็น HamlibError และปิดการเชื่อมต่อ expect (SET หรือ READ) ตรวจว่าคำตอบเหลื่อมหรือไม่
        None ไม่ตรวจ"""
        data = cmd.encode("ascii") if isinstance(cmd, str) else cmd
        async with self._lock:
            if self._writer is None:
                raise HamlibError(f"ยังไม่ได้เชื่อมต่อ {self._where}")
            try:
                reply = await self._exchange(data, lines)
                if _out_of_step(reply, expect):
                    raise HamlibError(f"คำตอบของ {self._where} เหลื่อมกับคำสั่ง (ได้ \"{reply[0]}\") จึงตัดการเชื่อมต่อ")
                return reply
            except BaseException:                       # ล้มหรือถูกยกเลิกกลางทาง คำตอบที่ค้างอยู่ทำให้ stream เหลื่อมกับคำสั่ง
                self._abort()
                raise

    async def close(self) -> None:
        """ส่ง q ถ้ายังต่ออยู่ (ไม่อ่านคำตอบ rigctld ปิดเอง) แล้วปิด ไม่ raise เรียกซ้ำได้"""
        async with self._lock:
            writer, alive = self._writer, self.connected
            self._reader = self._writer = None
            if writer is None:
                return
            try:
                if alive:
                    writer.write(b"q\n")
                    await asyncio.wait_for(writer.drain(), REPLY_TIMEOUT_S)
            except (TimeoutError, OSError):
                pass
            writer.close()
            try:
                await asyncio.wait_for(writer.wait_closed(), REPLY_TIMEOUT_S)
            except (TimeoutError, OSError):
                pass

    async def _exchange(self, data: bytes, lines: int) -> list[str]:
        reply: list[str] = []
        try:
            self._writer.write(data)
            await asyncio.wait_for(self._writer.drain(), REPLY_TIMEOUT_S)
            for _ in range(lines):
                raw = await asyncio.wait_for(self._reader.readline(), REPLY_TIMEOUT_S)
                if not raw.endswith(b"\n"):             # ปลายทางปิดก่อนจบบรรทัด (b"" คือไม่มีอะไรมาเลย)
                    raise HamlibError(f"{self._where} ปิดการเชื่อมต่อก่อนตอบ")
                line = raw.decode("utf-8", "replace").rstrip("\r\n")
                reply.append(line)
                if line.startswith(_RPRT):
                    break
        except TimeoutError:
            raise HamlibError(f"{self._where} ไม่ตอบภายใน {REPLY_TIMEOUT_S:g} วินาที") from None
        except ValueError:                              # StreamReader: บรรทัดยาวเกิน limit (64 KiB) ไม่ใช่คำตอบของ hamlib
            raise HamlibError(f"{self._where} ตอบผิดรูป (บรรทัดยาวเกินไป)") from None
        except OSError as exc:
            raise HamlibError(f"ติดต่อ {self._where} ไม่ได้ ({_reason(exc)})") from None
        return reply

    def _abort(self) -> None:
        writer, self._reader, self._writer = self._writer, None, None
        if writer is not None:
            writer.transport.abort()
