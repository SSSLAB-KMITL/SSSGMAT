"""Server-Sent Events และข้อความล่าสุด (หัวข้อ 6.1 และ 8 ของ spec server)

- `GET /api/events` ส่ง `event: <ชื่อ>\ndata: <JSON กะทัดรัดบรรทัดเดียว>\n\n` เป็น UTF-8 (ภาษาไทยไม่ escape) ส่ง `ping` ทันทีที่
  สมัครฟังเสร็จ (header ถึง client และ client รู้ว่าฟังอยู่แล้ว) แล้วส่งซ้ำทุก `app.state.sse_ping_s` วินาทีที่เงียบ (ตั้งต้น 15)
- client ตัดการเชื่อมต่อ: Starlette ยกเลิก task ที่ส่ง response ค้างอยู่ generator ออกจาก `async with` และเลิกฟัง
- `GET /api/messages?since=<iso>` ข้อความที่เก็บไว้ (ไม่เกิน 1,000) หลัง since เก่า -> ใหม่ ไม่ส่ง since = ทั้งหมด
"""

import json
from collections.abc import AsyncIterator
from datetime import datetime

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from ..events import EventBus, SubscriptionClosed
from ..schema import UtcZ
from . import get_bus

router = APIRouter()

SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}      # ห้าม cache และห้าม proxy (nginx) buffer


def sse_frame(event: str, data: dict) -> bytes:
    body = json.dumps(data, ensure_ascii=False, separators=(",", ":"), default=str)
    return f"event: {event}\ndata: {body}\n\n".encode("utf-8")


async def event_stream(bus: EventBus, ping_s: float) -> AsyncIterator[bytes]:
    async with bus.subscribe() as sub:
        yield sse_frame("ping", {})                      # สมัครฟังแล้วจึงส่ง: event หลังจากนี้ไม่หลุด
        while True:
            try:
                event, data = await sub.get(timeout=ping_s)
            except TimeoutError:
                yield sse_frame("ping", {})
                continue
            except SubscriptionClosed:
                return
            yield sse_frame(event, data)


@router.get("/events")
async def events(request: Request, bus: EventBus = Depends(get_bus)) -> StreamingResponse:
    return StreamingResponse(event_stream(bus, request.app.state.sse_ping_s), media_type="text/event-stream",
                             headers=SSE_HEADERS)


@router.get("/messages")
def messages(since: UtcZ | None = None, bus: EventBus = Depends(get_bus)) -> list[dict]:
    """since: เวลา UTC ลงท้าย Z (ค่า `time` ของข้อความที่เคยได้) ผิดรูปแบบ -> 422 ที่ field since"""
    return bus.messages_since(datetime.fromisoformat(since.replace("Z", "+00:00")) if since is not None else None)
