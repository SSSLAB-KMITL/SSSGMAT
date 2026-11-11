"""event bus ในโพรเซสเดียว และบันทึกข้อความล่าสุด (หัวข้อ 6.1 และ 8 ของ spec server; ข้อ P4)

- ผู้ฟังแต่ละคน (`Subscription`) มี `asyncio.Queue(maxsize=1000)` ของตัวเอง ผูกกับ loop ที่สมัครฟัง
  `EventBus.publish` เรียกได้จากทุก thread (route ที่เป็น `def` รันใน threadpool, job thread ของ Task 6, ตัวตั้งเวลาของ Task 11):
  ส่งเข้าคิวผ่าน `loop.call_soon_threadsafe` ของ loop นั้น ลำดับจาก thread เดียวกันจึงคงเดิม และแต่ละแท็บ/การเชื่อมต่อมี loop ของตัวเองได้
- คิวผู้ฟังเต็ม (อ่านไม่ทัน) = ทิ้ง event ใหม่ของผู้ฟังคนนั้นคนเดียว ไม่กระทบคนอื่นหรือผู้ส่ง และเตือนใน log ครั้งเดียวต่อ episode
  (จากครั้งแรกที่ทิ้งจนผู้ฟังอ่านคิวจนหมด) client ที่ตกหล่นโหลดสถานะใหม่จาก API ได้เสมอ
- event ที่ส่งเข้า bus ถูกใช้ร่วมกันทุกผู้ฟัง (ไม่ copy): ผู้ส่งและผู้ฟังห้ามแก้ dict หลังส่ง
- ข้อความ (`message`) เก็บล่าสุด 1,000 รายการไว้ให้ Message Viewer โหลดตอนเปิดหน้า (`messages_since`)
"""

import asyncio
import collections
import logging
import threading
import weakref
from datetime import datetime, timezone

SUBSCRIBER_QUEUE_MAX = 1000
MESSAGE_RING_MAX = 1000
_END = object()                          # ใส่เข้าคิวตอนปิดผู้ฟัง เพื่อปลุกคนที่รอ get() อยู่


class SubscriptionClosed(Exception):
    """get() บนผู้ฟังที่ปิดแล้ว (หรือปิดระหว่างรอ)"""


class Subscription:
    """ผู้ฟังหนึ่งคน: async iterator ของ (ชื่อ event, data) สร้างด้วย `EventBus.subscribe()` (ต้องเรียกใน loop ที่จะอ่าน)

    ลงทะเบียนทันทีที่สร้าง ไม่ใช่ตอนอ่านครั้งแรก: event ที่ publish หลัง subscribe() ถึงแน่นอน
    เลิกฟังเมื่อ `aclose()`, ออกจาก `async with`, ถูกยกเลิก (task ที่รออยู่ใน `async for` ถูก cancel) หรือไม่มีใครถืออีกแล้ว
    (bus อ้างผู้ฟังแบบอ่อน)
    """

    def __init__(self, bus: "EventBus", sub_id: int, loop: asyncio.AbstractEventLoop, logger: logging.Logger):
        self.id = sub_id
        self.dropped = 0                                 # จำนวน event ที่ทิ้งเพราะคิวเต็ม (รวมทุก episode)
        self._bus, self._loop, self._logger = bus, loop, logger
        self._queue: asyncio.Queue = asyncio.Queue(maxsize=SUBSCRIBER_QUEUE_MAX)
        self._closed = False
        self._overflowing = False

    # ---------- ฝั่ง bus (รันใน thread ของ loop ผ่าน call_soon_threadsafe) ----------

    def _deliver(self, item: tuple[str, dict]) -> None:
        if self._closed:
            return
        try:
            self._queue.put_nowait(item)
        except asyncio.QueueFull:
            self.dropped += 1
            if not self._overflowing:
                self._overflowing = True
                self._logger.warning("ผู้ฟัง event #%d อ่านไม่ทัน (คิวเต็ม %d รายการ): ทิ้ง event ใหม่จนกว่าจะอ่านคิวหมด",
                                     self.id, SUBSCRIBER_QUEUE_MAX)

    # ---------- ฝั่งผู้ฟัง ----------

    async def get(self, timeout: float | None = None) -> tuple[str, dict]:
        """event ถัดไป หมดเวลา -> TimeoutError (ผู้ฟังยังอยู่ ใช้ได้ต่อ) ปิดแล้ว -> SubscriptionClosed

        ต่างจาก `__anext__`: การถูกยกเลิกระหว่างรอไม่ปิดผู้ฟัง (wait_for/timeout ยกเลิกการรอเป็นปกติ) ผู้เรียกปิดเอง"""
        if self._closed:
            raise SubscriptionClosed
        if timeout is None:
            item = await self._queue.get()
        else:
            async with asyncio.timeout(timeout):
                item = await self._queue.get()
        if item is _END:
            raise SubscriptionClosed
        if self._queue.empty():
            self._overflowing = False                    # อ่านหมดแล้ว: จบ episode
        return item

    def __aiter__(self) -> "Subscription":
        return self

    async def __anext__(self) -> tuple[str, dict]:
        try:
            return await self.get()
        except SubscriptionClosed:
            raise StopAsyncIteration from None
        except asyncio.CancelledError:
            self.close()
            raise

    def close(self) -> None:
        """เลิกฟัง ปิดซ้ำได้ ต้องเรียกใน thread ของ loop ที่สมัครฟัง"""
        if self._closed:
            return
        self._closed = True
        self._bus._detach(self.id)
        try:
            self._queue.put_nowait(_END)                 # คิวว่างเท่านั้นที่มีคนรออยู่ ถ้าเต็มไม่มีใครรอ get() ตรวจ _closed เอง
        except asyncio.QueueFull:
            pass

    async def aclose(self) -> None:
        self.close()

    async def __aenter__(self) -> "Subscription":
        return self

    async def __aexit__(self, *exc) -> None:
        self.close()


class EventBus:
    def __init__(self, logger: logging.Logger | None = None):
        self._logger = logger or logging.getLogger("gnss_studio_server.events")
        self._lock = threading.Lock()                    # ครอบ _subs และ _messages: ทุก thread เรียก publish/message ได้
        # อ้างผู้ฟังแบบอ่อน: ผู้ถือที่ลืมปิดแล้วทิ้งไป (เช่น generator ที่ถูกยกเลิกก่อนเริ่ม) หลุดจากทะเบียนเองเมื่อถูกเก็บกวาด
        self._subs: weakref.WeakValueDictionary[int, Subscription] = weakref.WeakValueDictionary()
        self._next_id = 1
        self._messages: collections.deque = collections.deque(maxlen=MESSAGE_RING_MAX)

    @property
    def subscriber_count(self) -> int:
        with self._lock:
            return len(self._subs)

    def subscribe(self) -> Subscription:
        """สมัครฟัง (เรียกใน loop ที่จะอ่าน; ไม่มี loop = RuntimeError) ได้ async iterator ของ (event, data)"""
        loop = asyncio.get_running_loop()
        with self._lock:
            sub = Subscription(self, self._next_id, loop, self._logger)
            self._subs[sub.id] = sub
            self._next_id += 1
        return sub

    def _detach(self, sub_id: int) -> None:
        with self._lock:
            self._subs.pop(sub_id, None)

    def publish(self, event: str, data: dict) -> None:
        """ส่ง event ถึงผู้ฟังทุกคนที่สมัครอยู่ตอนนี้ เรียกได้จากทุก thread ไม่รอ ไม่ raise"""
        item = (event, data)
        with self._lock:
            subs = list(self._subs.values())
        for sub in subs:
            try:
                sub._loop.call_soon_threadsafe(sub._deliver, item)
            except RuntimeError:                         # loop ของผู้ฟังปิดไปแล้วโดยไม่ได้ปิดผู้ฟัง
                self._detach(sub.id)

    # ---------- ข้อความ ----------

    def record_message(self, when: datetime, msg: dict) -> None:
        """เก็บข้อความเข้า ring (ล่าสุด 1,000) when คือเวลาเดียวกับ msg["time"] ที่ตัดเป็นมิลลิวินาทีแล้ว"""
        with self._lock:
            self._messages.append((when, msg))

    def messages_since(self, since: datetime | None) -> list[dict]:
        """ข้อความหลัง since (ไม่รวมเท่ากับ) เก่า -> ใหม่ since เป็น None = ทั้งหมดที่เก็บไว้ (ไม่เกิน 1,000) ได้สำเนา

        ข้อความที่เกิดในมิลลิวินาทีเดียวกันมี time เท่ากัน since ที่เท่ากับ time ของข้อความล่าสุดที่เห็นจะไม่ได้ข้อความพวกนั้น"""
        if since is not None and since.tzinfo is None:
            since = since.replace(tzinfo=timezone.utc)
        with self._lock:
            snapshot = list(self._messages)
        return [dict(msg) for when, msg in snapshot if since is None or when > since]


def _now() -> datetime:
    return datetime.now(timezone.utc)


def message(bus: EventBus, level: str, code: str, text: str, object: str | None = None) -> dict:
    """สร้างข้อความของ Message Viewer {time, level, code, text, object} เก็บเข้า ring และ publish "message" แล้วคืนข้อความนั้น

    level: "info" | "warning" | "error" object: path ของ object ที่เกี่ยวข้อง เช่น "*/Facility/THBK" หรือ None
    time: UTC ISO 8601 ตัดเป็นมิลลิวินาที ลงท้าย Z"""
    now = _now().astimezone(timezone.utc)
    when = now.replace(microsecond=now.microsecond // 1000 * 1000)
    msg = {"time": f"{when:%Y-%m-%dT%H:%M:%S}.{when.microsecond // 1000:03d}Z", "level": level, "code": code, "text": text,
           "object": object}
    bus.record_message(when, msg)
    bus.publish("message", msg)
    return msg
