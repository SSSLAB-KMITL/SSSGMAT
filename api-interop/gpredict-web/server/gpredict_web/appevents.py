"""ช่องเหตุการณ์ระดับโปรแกรม WS /ws/app (spec งานย่อย 4 §5.3 และ §12): server บอกทุก browser ว่าค่า Preferences หรือรายการ module
เปลี่ยน และว่า TLE เก่า หน้าเว็บโหลดข้อมูลที่เกี่ยวข้องใหม่ (ของเรา: Gpredict เป็นโปรแกรมเดียว จึงไม่มีช่องนี้)

เหตุการณ์ = dict ที่มีช่อง type: {"type": "prefs_changed"}, {"type": "modules_changed"}, {"type": "tle_old", "text": ...}
- publish(event) เรียกจาก thread ไหนก็ได้ (route ของ FastAPI รันใน thread pool, Update TLE รันใน worker thread): ฝากเข้าคิวของ
  event loop แล้ว task เดียว (pump) ส่งให้ทุก socket ตามลำดับที่ publish (ทุกเหตุการณ์ถึงทุก socket ตามลำดับเดียวกัน)
- publish_or_hold(event) เหมือนกัน แต่ถ้าตอนส่งไม่มี socket เลย: เก็บไว้ส่งให้ socket แรกที่ต่อเข้ามา (คำเตือน TLE เก่าแจ้งครั้งเดียว
  ต่อการเปิด server จึงต้องไม่หายไปเมื่อยังไม่มี browser เปิดอยู่)
- socket ที่ส่งไม่ทัน SEND_TIMEOUT_S หรือส่งไม่สำเร็จถูกปิดด้วย 1013 (หน้าเว็บต่อใหม่) ตัวอื่นไม่กระทบ แบบเดียวกับ tick ของ module
- ปิด server: shutdown() หยุด pump และปิดทุก socket ด้วย 1001
"""

import asyncio
import json
import logging
import threading
from typing import Any

SEND_TIMEOUT_S = 10.0              # เท่ากับ app.SEND_TIMEOUT_S ของ tick (เขียนซ้ำที่นี่เพราะ app.py import ไฟล์นี้)
CLOSE_SERVER_STOP = 1001           # close code: server กำลังปิด (เท่ากับ app.WS_SERVER_STOP)
CLOSE_SEND_FAILED = 1013           # close code: ส่งให้ socket นี้ไม่ทันหรือไม่สำเร็จ (เท่ากับ app.WS_SEND_FAILED)
_log = logging.getLogger(__name__)

# รายการในคิวของ pump: ("event", event, hold) ส่งเหตุการณ์ หรือ ("attach", ws) socket ใหม่รับเหตุการณ์ที่ถูกเก็บไว้
_Item = tuple


def _text(event: dict) -> str:
    return json.dumps(event, ensure_ascii=False, separators=(",", ":"))


class AppEvents:
    """socket ทั้งหมดของ /ws/app และคิวเหตุการณ์ที่รอส่ง ทุกอย่างยกเว้น publish, publish_or_hold และ bound ทำใน event loop เดียว
    (ที่ bind ไว้) จึงไม่ต้องล็อกยกเว้นรายการที่ถูกเก็บไว้ ซึ่ง publish_or_hold ก่อน bind แตะจาก thread อื่นได้"""

    def __init__(self) -> None:
        self._loop: asyncio.AbstractEventLoop | None = None
        self._queue: asyncio.Queue[_Item] | None = None
        self._pump: asyncio.Task | None = None
        self._sockets: set[Any] = set()
        self._held: list[dict] = []
        self._held_lock = threading.Lock()

    @property
    def bound(self) -> bool:
        """True ตั้งแต่ bind จนถึง shutdown (ระหว่างนั้นเหตุการณ์ถึง socket)"""
        return self._loop is not None

    def bind(self, loop: asyncio.AbstractEventLoop) -> None:
        """เริ่ม pump ใน loop นี้ (เรียกใน loop เองตอน lifespan เริ่ม) bind ใหม่หลัง shutdown ได้"""
        self._queue = asyncio.Queue()
        self._pump = loop.create_task(self._run(self._queue), name="app-events")
        self._loop = loop

    def sockets(self) -> list[Any]:
        """socket ที่รับเหตุการณ์อยู่ (สำเนา)"""
        return list(self._sockets)

    async def add(self, ws) -> None:
        """socket ที่ accept แล้วเริ่มรับเหตุการณ์ socket แรกหลังไม่มี socket ได้เหตุการณ์ที่ถูกเก็บไว้ก่อน แล้วจึงตามด้วยเหตุการณ์ใหม่"""
        self._sockets.add(ws)
        self._put(("attach", ws))

    def remove(self, ws) -> None:
        """socket หลุดหรือปิด (เรียกซ้ำได้)"""
        self._sockets.discard(ws)

    def publish(self, event: dict) -> None:
        """ส่งให้ทุก socket ที่เปิดอยู่ตอนส่ง ไม่มี socket = ทิ้ง เรียกจาก thread ไหนก็ได้"""
        self._post(event, False)

    def publish_or_hold(self, event: dict) -> None:
        """เหมือน publish แต่ไม่มี socket เลย = เก็บไว้ส่งให้ socket แรกที่ต่อเข้ามา เรียกจาก thread ไหนก็ได้"""
        self._post(event, True)

    async def shutdown(self) -> None:
        """หยุด pump แล้วปิดทุก socket ด้วย 1001 หลังจากนี้ publish ไม่ทำอะไร (เรียกซ้ำได้)"""
        pump, self._pump = self._pump, None
        self._loop = self._queue = None
        if pump is not None:
            pump.cancel()
            await asyncio.gather(pump, return_exceptions=True)
        sockets, self._sockets = list(self._sockets), set()
        await asyncio.gather(*(self._close(ws, CLOSE_SERVER_STOP) for ws in sockets))

    # ---------------- ภายใน

    def _post(self, event: dict, hold: bool) -> None:
        loop = self._loop
        if loop is None:                           # ยังไม่ได้ bind หรือปิดไปแล้ว: ไม่มี socket ใดรับ
            if hold:
                self._hold([event])
            return
        try:
            loop.call_soon_threadsafe(self._put, ("event", event, hold))
        except RuntimeError:                       # loop ปิดไปแล้ว (server หยุดระหว่างที่ thread อื่นกำลัง publish)
            pass

    def _put(self, item: _Item) -> None:
        if self._queue is not None:
            self._queue.put_nowait(item)

    def _hold(self, events: list[dict], front: bool = False) -> None:
        with self._held_lock:
            self._held = [*events, *self._held] if front else [*self._held, *events]

    def _take_held(self) -> list[dict]:
        with self._held_lock:
            held, self._held = self._held, []
        return held

    async def _run(self, queue: asyncio.Queue) -> None:
        while True:
            item = await queue.get()
            try:
                if item[0] == "attach":
                    await self._flush_held(item[1])
                else:
                    await self._deliver(item[1], item[2])
            except Exception:
                _log.exception("ส่งเหตุการณ์ของโปรแกรมทาง /ws/app ไม่สำเร็จ ข้ามเหตุการณ์นี้")

    async def _deliver(self, event: dict, hold: bool) -> None:
        sockets = list(self._sockets)
        if not sockets:
            if hold:
                self._hold([event])
            return
        text = _text(event)
        results = await asyncio.gather(*(self._send(ws, text) for ws in sockets))
        for ws, ok in zip(sockets, results):
            if not ok:
                await self._drop(ws)
        if hold and not any(results):                       # ไม่มี socket ไหนรับได้: ยังไม่มีใครเห็นข้อความนี้
            self._hold([event])

    async def _flush_held(self, ws) -> None:
        if ws not in self._sockets:                         # หลุดไปก่อนถึงคิว
            return
        held = self._take_held()
        for i, event in enumerate(held):
            if not await self._send(ws, _text(event)):
                self._hold(held[i:], front=True)            # socket แรกไม่ได้รับ: socket ถัดไปยังได้เหตุการณ์ที่เหลือ
                await self._drop(ws)
                return

    @staticmethod
    async def _send(ws, text: str) -> bool:
        try:
            await asyncio.wait_for(ws.send_text(text), SEND_TIMEOUT_S)
        except Exception:                                   # client หลุด ส่งไม่ทัน หรือ socket ปิดแล้ว
            return False
        return True

    async def _drop(self, ws) -> None:
        self._sockets.discard(ws)
        await self._close(ws, CLOSE_SEND_FAILED)

    @staticmethod
    async def _close(ws, code: int) -> None:
        try:
            await ws.close(code=code)
        except Exception:                                   # ปิดไปแล้ว หรือ client หลุดไปก่อน
            pass
