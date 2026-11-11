"""event bus, SSE และข้อความ (หัวข้อ 6.1 และ 8 ของ spec server)

test ของ bus ใช้ asyncio.run ตรง ๆ (ไม่มี pytest-asyncio) ส่วน test ของ SSE อ่าน /api/events จริงผ่าน TestClient.stream
บน daemon thread เพื่อให้รอ frame ด้วย timeout ได้: ถ้า stream ไม่ส่งอะไร test ล้มพร้อมข้อความ ไม่ค้าง
"""

import asyncio
import gc
import hashlib
import json
import logging
import queue
import re
import threading
import time
from datetime import datetime, timedelta, timezone

import pytest

from gnss_studio_server import events
from gnss_studio_server.events import EventBus

TIMEOUT = 5.0
THAI = re.compile("[฀-๿]")
ERROR_KEYS = {"code", "text", "field", "detail"}
TIME_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")
MESSAGE_KEYS = {"time", "level", "code", "text", "object"}


def run(coro):
    """รัน coroutine ใน loop ใหม่ มี timeout รวม (ล้มแทนค้าง)"""
    async def bounded():
        return await asyncio.wait_for(coro, TIMEOUT)
    return asyncio.run(bounded())


class ListHandler(logging.Handler):
    def __init__(self):
        super().__init__()
        self.records = []

    def emit(self, record):
        self.records.append(record)


@pytest.fixture
def bus_log():
    """(logger, records) ของ logger เปล่าที่เก็บ record ไว้ใน list ไม่ผ่าน logging ส่วนกลาง"""
    logger = logging.Logger("test-bus")
    handler = ListHandler()
    logger.addHandler(handler)
    return logger, handler.records


async def wait_until(predicate, timeout=TIMEOUT):
    deadline = time.monotonic() + timeout
    while not predicate():
        assert time.monotonic() < deadline, "รอเงื่อนไขไม่เกิดขึ้นภายในเวลาที่กำหนด"
        await asyncio.sleep(0.005)


# ---------- EventBus: การส่งถึงผู้ฟัง ----------

def test_publish_reaches_two_subscribers():
    async def main():
        bus = EventBus()
        a, b = bus.subscribe(), bus.subscribe()
        assert bus.subscriber_count == 2
        sent = [("scenario", {"name": "S1", "etag": "e1", "results_stale": False}),
                ("message", {"text": "ทดสอบ"}),
                ("job", {"id": "j-1", "state": "queued"})]
        for event, data in sent:
            bus.publish(event, data)
        got_a = [await anext(a) for _ in sent]
        got_b = [await anext(b) for _ in sent]
        assert got_a == sent and got_b == sent                       # ทั้งสองคนได้ครบ ตามลำดับที่ส่ง
        await a.aclose()
        await b.aclose()
        assert bus.subscriber_count == 0
    run(main())


def test_subscribe_works_with_async_for():
    async def main():
        bus = EventBus()

        async def listen(n):
            got = []
            async for event, data in bus.subscribe():
                got.append((event, data))
                if len(got) == n:
                    return got

        first, second = asyncio.create_task(listen(3)), asyncio.create_task(listen(3))
        await wait_until(lambda: bus.subscriber_count == 2)
        for i in range(3):
            bus.publish("job", {"i": i})
        want = [("job", {"i": i}) for i in range(3)]
        assert await first == want and await second == want
        await wait_until(lambda: bus.subscriber_count == 0)          # return ใน async for ปิดผู้ฟังเอง
    run(main())


def test_late_subscriber_only_gets_later_events():
    async def main():
        bus = EventBus()
        bus.publish("job", {"i": 0})                                 # ไม่มีใครฟัง: ไม่เก็บ ไม่ error
        sub = bus.subscribe()
        bus.publish("job", {"i": 1})
        assert await anext(sub) == ("job", {"i": 1})
        await sub.aclose()
    run(main())


def test_publish_from_thread():
    async def main():
        bus = EventBus()
        sub = bus.subscribe()

        def worker(tag):
            for i in range(25):
                bus.publish("job", {"tag": tag, "i": i})

        threads = [threading.Thread(target=worker, args=(tag,)) for tag in "abc"]
        for t in threads:
            t.start()
        got = [await anext(sub) for _ in range(75)]
        for t in threads:
            t.join()
        for tag in "abc":                                            # ลำดับของแต่ละ thread คงเดิม
            assert [d["i"] for _, d in got if d["tag"] == tag] == list(range(25))
        await sub.aclose()
    run(main())


def test_publish_from_thread_is_delivered_on_the_subscribers_loop():
    async def main():
        bus = EventBus()
        sub = bus.subscribe()
        threading.Thread(target=bus.publish, args=("ping", {"from": "thread"})).start()
        assert await asyncio.wait_for(anext(sub), TIMEOUT) == ("ping", {"from": "thread"})   # ตื่นจาก await โดยไม่ต้อง poll
        await sub.aclose()
    run(main())


def test_subscribers_in_different_loops_each_get_their_own_events():
    """แต่ละแท็บ/การเชื่อมต่อมี loop ของตัวเอง (TestClient สร้าง loop ใหม่ต่อ request): publish ข้าม loop ได้"""
    bus = EventBus()
    results, ready = {}, [threading.Event(), threading.Event()]

    def listener(n):
        async def main():
            sub = bus.subscribe()
            ready[n].set()
            results[n] = await asyncio.wait_for(anext(sub), TIMEOUT)
            await sub.aclose()
        asyncio.run(main())

    threads = [threading.Thread(target=listener, args=(n,)) for n in range(2)]
    for t in threads:
        t.start()
    for r in ready:
        assert r.wait(TIMEOUT)
    bus.publish("scenario", {"name": "S1"})
    for t in threads:
        t.join(TIMEOUT)
    assert results == {0: ("scenario", {"name": "S1"}), 1: ("scenario", {"name": "S1"})}
    assert bus.subscriber_count == 0


def test_subscribe_needs_a_running_loop():
    with pytest.raises(RuntimeError):
        EventBus().subscribe()


# ---------- EventBus: ผู้ฟังอ่านไม่ทัน ----------

def test_full_queue_drops_events_and_warns_once_per_episode(bus_log):
    logger, records = bus_log

    def warnings():
        return [r for r in records if r.levelno == logging.WARNING]

    async def main():
        bus = EventBus(logger)
        slow, fast = bus.subscribe(), bus.subscribe()
        got_fast = []

        async def drain():
            async for item in fast:
                got_fast.append(item)

        drainer = asyncio.create_task(drain())
        for start in range(0, 1005, 50):                             # คิวละ 1,000: ของ slow เกินมา 5; fast อ่านทันทุกรอบ
            for i in range(start, min(start + 50, 1005)):
                bus.publish("job", {"i": i})
            await asyncio.sleep(0)
            await asyncio.sleep(0)
        await wait_until(lambda: len(got_fast) == 1005)
        assert fast.dropped == 0 and slow.dropped == 5               # ล้นเฉพาะผู้ฟังที่อ่านไม่ทัน
        assert len(warnings()) == 1                                  # ตก 5 ครั้งใน episode เดียว: เตือนครั้งเดียว
        got = [await anext(slow) for _ in range(1000)]
        assert [d["i"] for _, d in got] == list(range(1000))         # ที่ตกคือ event ใหม่ ที่คิวอยู่ครบและเรียงเดิม
        with pytest.raises(TimeoutError):
            await slow.get(timeout=0.05)                             # ไม่มี event ที่ 1,001
        drainer.cancel()
        await fast.aclose()                                          # เหลือ slow คนเดียว (ส่งรวดเดียวโดยไม่คืน loop ให้ fast อ่านทัน)
        for i in range(1002):                                        # อ่านคิวจนหมดแล้ว = จบ episode: เต็มอีกรอบต้องเตือนอีกครั้ง
            bus.publish("job", {"i": i})
        await asyncio.sleep(0)
        assert slow.dropped == 7 and len(warnings()) == 2
        await slow.aclose()
    run(main())


def test_overflow_does_not_break_other_publishers(bus_log):
    logger, _ = bus_log

    async def main():
        bus = EventBus(logger)
        slow = bus.subscribe()
        for i in range(1100):
            bus.publish("job", {"i": i})                             # ต้องไม่ raise แม้คิวของ slow เต็ม
        await asyncio.sleep(0)
        assert bus.subscriber_count == 1                             # ล้นแล้วยังเป็นผู้ฟังอยู่ ไม่ถูกตัดออก
        await slow.aclose()
    run(main())


# ---------- EventBus: เลิกฟัง ----------

def test_aclose_unsubscribes_and_ends_iteration():
    async def main():
        bus = EventBus()
        sub = bus.subscribe()
        assert bus.subscriber_count == 1
        await sub.aclose()
        assert bus.subscriber_count == 0
        await sub.aclose()                                           # ปิดซ้ำได้
        bus.publish("job", {})
        with pytest.raises(StopAsyncIteration):
            await anext(sub)
    run(main())


def test_cancelled_listener_task_unsubscribes():
    async def main():
        bus = EventBus()

        async def listen():
            async for _ in bus.subscribe():
                pass

        task = asyncio.create_task(listen())
        await wait_until(lambda: bus.subscriber_count == 1)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert bus.subscriber_count == 0
    run(main())


def test_closing_wakes_a_waiting_listener():
    async def main():
        bus = EventBus()
        sub = bus.subscribe()
        waiting = asyncio.create_task(anext(sub))
        await asyncio.sleep(0.01)
        await sub.aclose()
        with pytest.raises(StopAsyncIteration):
            await asyncio.wait_for(waiting, TIMEOUT)
    run(main())


def test_async_with_unsubscribes():
    async def main():
        bus = EventBus()
        async with bus.subscribe() as sub:
            assert bus.subscriber_count == 1
            bus.publish("job", {"i": 1})
            assert await anext(sub) == ("job", {"i": 1})
        assert bus.subscriber_count == 0
    run(main())


def test_get_timeout_keeps_the_subscription():
    """ping ของ SSE ใช้ get(timeout): หมดเวลาแล้วต้องยังฟังต่อได้ ไม่ใช่ถูกยกเลิก"""
    async def main():
        bus = EventBus()
        async with bus.subscribe() as sub:
            with pytest.raises(TimeoutError):
                await sub.get(timeout=0.02)
            assert bus.subscriber_count == 1
            bus.publish("job", {"i": 2})
            assert await sub.get(timeout=TIMEOUT) == ("job", {"i": 2})
    run(main())


def test_abandoned_subscription_is_cleaned_up():
    async def main():
        bus = EventBus()
        bus.subscribe()                                              # ไม่เก็บตัวแปร ไม่ปิด
        gc.collect()
        assert bus.subscriber_count == 0
    run(main())


def test_dead_loop_subscriber_is_dropped_on_publish():
    bus = EventBus()
    keep = []

    async def main():
        keep.append(bus.subscribe())                                 # ไม่ปิด แล้ว loop จบ
    asyncio.run(main())
    assert bus.subscriber_count == 1
    bus.publish("job", {})                                           # loop ปิดแล้ว: ต้องไม่ raise
    assert bus.subscriber_count == 0


# ---------- ข้อความ ----------

def test_message_shape_and_publish():
    async def main():
        bus = EventBus()
        sub = bus.subscribe()
        msg = events.message(bus, "warning", "PRN_MISSING", "ไม่พบดาว G99", "*/Satellite/G99")
        assert set(msg) == MESSAGE_KEYS and TIME_RE.fullmatch(msg["time"])
        assert (msg["level"], msg["code"], msg["text"], msg["object"]) == ("warning", "PRN_MISSING", "ไม่พบดาว G99", "*/Satellite/G99")
        assert await anext(sub) == ("message", msg)
        assert events.message(bus, "info", "X", "y")["object"] is None
        await sub.aclose()
        assert [m["code"] for m in bus.messages_since(None)] == ["PRN_MISSING", "X"]
    run(main())


def test_message_time_is_utc_with_milliseconds_and_z(monkeypatch):
    monkeypatch.setattr(events, "_now", lambda: datetime(2026, 11, 11, 3, 4, 5, 678901, tzinfo=timezone.utc))
    msg = events.message(EventBus(), "info", "C", "t")
    assert msg["time"] == "2026-11-11T03:04:05.678Z"                  # ตัดเป็นมิลลิวินาที ไม่ปัดขึ้น


def test_messages_ring_keeps_1000():
    bus = EventBus()
    for i in range(1005):
        events.message(bus, "info", "N", f"m{i}")
    kept = bus.messages_since(None)
    assert len(kept) == 1000
    assert kept[0]["text"] == "m5" and kept[-1]["text"] == "m1004"    # ทิ้งของเก่าสุด เรียงเก่า -> ใหม่
    assert [m["text"] for m in kept] == [f"m{i}" for i in range(5, 1005)]


def test_messages_since_is_strictly_after(monkeypatch):
    bus = EventBus()
    clock = iter(datetime(2026, 11, 11, 0, 0, s, tzinfo=timezone.utc) for s in (1, 2, 3))
    monkeypatch.setattr(events, "_now", lambda: next(clock))
    for text in ("a", "b", "c"):
        events.message(bus, "info", "N", text)

    def texts(since):
        return [m["text"] for m in bus.messages_since(since)]

    at = lambda s: datetime(2026, 11, 11, 0, 0, s, tzinfo=timezone.utc)      # noqa: E731
    assert texts(None) == ["a", "b", "c"]
    assert texts(at(0)) == ["a", "b", "c"]
    assert texts(at(1)) == ["b", "c"]                                # เท่ากับ since ไม่รวม
    assert texts(at(2)) == ["c"]
    assert texts(at(3)) == [] and texts(at(9)) == []
    assert texts(datetime(2026, 11, 11, 7, 0, 2, tzinfo=timezone(timedelta(hours=7)))) == ["c"]   # 07:00:02+07:00 = 00:00:02Z


def test_messages_since_returns_copies():
    bus = EventBus()
    events.message(bus, "info", "N", "a")
    bus.messages_since(None)[0]["text"] = "changed"
    assert bus.messages_since(None)[0]["text"] == "a"


def test_messages_from_threads_all_kept():
    bus = EventBus()

    def worker(tag):
        for i in range(100):
            events.message(bus, "info", "N", f"{tag}{i}")

    threads = [threading.Thread(target=worker, args=(tag,)) for tag in "ab"]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(bus.messages_since(None)) == 200


# ---------- GET /api/messages ----------

def get_bus(client):
    return client.app.state.bus


def test_messages_route_empty_then_lists_oldest_first(client):
    r = client.get("/api/messages")
    assert r.status_code == 200 and r.json() == []
    bus = get_bus(client)
    first = events.message(bus, "info", "A", "แรก")
    second = events.message(bus, "error", "B", "สอง", "*/Facility/THBK")
    r = client.get("/api/messages")
    assert r.status_code == 200 and r.json() == [first, second]
    assert all(set(m) == MESSAGE_KEYS for m in r.json())


def test_messages_route_caps_at_1000(client):
    bus = get_bus(client)
    for i in range(1010):
        events.message(bus, "info", "N", f"m{i}")
    got = client.get("/api/messages").json()
    assert len(got) == 1000 and got[0]["text"] == "m10" and got[-1]["text"] == "m1009"


def test_messages_route_since(client, monkeypatch):
    clock = iter(datetime(2026, 11, 11, 0, 0, s, 250000, tzinfo=timezone.utc) for s in (1, 2, 3))
    monkeypatch.setattr(events, "_now", lambda: next(clock))
    bus = get_bus(client)
    for text in ("a", "b", "c"):
        events.message(bus, "info", "N", text)

    def texts(**params):
        r = client.get("/api/messages", params=params)
        assert r.status_code == 200, r.text
        return [m["text"] for m in r.json()]

    assert texts() == ["a", "b", "c"]
    assert texts(since="2026-11-11T00:00:00Z") == ["a", "b", "c"]
    assert texts(since="2026-11-11T00:00:01.250Z") == ["b", "c"]       # ค่า time ของข้อความที่เห็นแล้ว: เอาเฉพาะหลังจากนั้น
    assert texts(since="2026-11-11T00:00:02.250Z") == ["c"]
    assert texts(since="2026-11-11T00:00:02.249Z") == ["b", "c"]
    assert texts(since="2026-11-11T00:00:02Z") == ["b", "c"]
    assert texts(since="2026-11-11T00:00:03.250Z") == []


@pytest.mark.parametrize("bad", ["yesterday", "2026-11-11", "2026-11-11T00:00:00", "2026-11-11T00:00:00+07:00",
                                 "2026-13-45T00:00:00Z", "", "1700000000"])
def test_messages_route_bad_since_is_422_on_since(client, bad):
    r = client.get("/api/messages", params={"since": bad})
    assert r.status_code == 422, r.text
    j = r.json()
    assert set(j) == ERROR_KEYS and j["code"] == "SCENARIO_INVALID" and j["field"] == "since" and THAI.search(j["text"])


# ---------- GET /api/events ----------

class SseStream:
    """เปิด GET path ด้วย TestClient.stream บน daemon thread แล้วส่ง chunk ต่อให้ test อ่านทีละ frame ด้วย timeout

    TestClient ของ Starlette รุ่นนี้ส่งตัว body ทีละก้อนจริง (ไม่รอจบ response) จึงอ่าน stream ไม่รู้จบได้ ปิดด้วย close()
    ซึ่งยกเลิก app task เหมือน client ตัดการเชื่อมต่อ"""

    def __init__(self, client, path="/api/events"):
        self.status = self.headers = self.response = None
        self._chunks: queue.Queue = queue.Queue()
        self._buffer = b""
        self._opened = threading.Event()
        threading.Thread(target=self._read, args=(client, path), daemon=True).start()
        assert self._opened.wait(TIMEOUT), "เปิด stream ไม่สำเร็จภายในเวลาที่กำหนด"

    def _read(self, client, path):
        try:
            with client.stream("GET", path) as response:
                self.response, self.status, self.headers = response, response.status_code, response.headers
                self._opened.set()
                for chunk in response.iter_bytes():
                    self._chunks.put(chunk)
        except Exception as exc:                                     # noqa: BLE001  ปิดระหว่างอ่านอาจ raise: ส่งให้ test ตัดสิน
            self._chunks.put(exc)
        finally:
            self._opened.set()
            self._chunks.put(None)

    def next_frame(self, timeout=TIMEOUT) -> bytes:
        """frame ถัดไปทั้งก้อนรวม \\n\\n ท้าย (ไม่ขึ้นกับว่า server แบ่ง chunk อย่างไร)"""
        deadline = time.monotonic() + timeout
        while b"\n\n" not in self._buffer:
            try:
                chunk = self._chunks.get(timeout=max(deadline - time.monotonic(), 0))
            except queue.Empty:
                raise AssertionError(f"ไม่ได้ frame ภายใน {timeout} วินาที (buffer={self._buffer!r})") from None
            if chunk is None:
                raise AssertionError(f"stream จบก่อนได้ frame (buffer={self._buffer!r})")
            if isinstance(chunk, Exception):
                raise chunk
            self._buffer += chunk
        frame, _, self._buffer = self._buffer.partition(b"\n\n")
        return frame + b"\n\n"

    def next_event(self, timeout=TIMEOUT) -> tuple[str, dict]:
        lines = self.next_frame(timeout).decode("utf-8").split("\n")
        assert lines[0].startswith("event: ") and lines[1].startswith("data: "), lines
        return lines[0][len("event: "):], json.loads(lines[1][len("data: "):])

    def close(self):
        if self.response is not None:
            self.response.close()


@pytest.fixture
def open_stream(client):
    """open_stream(path?) -> SseStream ปิดให้เองตอนจบ test"""
    opened = []

    def open_(path="/api/events"):
        stream = SseStream(client, path)
        opened.append(stream)
        return stream

    yield open_
    for stream in opened:
        stream.close()


def wait_for_count(bus, n, timeout=TIMEOUT):
    deadline = time.monotonic() + timeout
    while bus.subscriber_count != n:
        assert time.monotonic() < deadline, f"subscriber_count = {bus.subscriber_count} (ต้องการ {n})"
        time.sleep(0.005)


def test_sse_stream_format(client, open_stream):
    stream = open_stream()
    assert stream.status == 200
    assert stream.headers["content-type"].startswith("text/event-stream")
    assert stream.headers["cache-control"] == "no-cache" and stream.headers["x-accel-buffering"] == "no"
    assert stream.next_frame() == b"event: ping\ndata: {}\n\n"        # ส่งทันทีที่เชื่อมต่อ = สมัครฟังเรียบร้อยแล้ว
    bus = get_bus(client)
    assert bus.subscriber_count == 1

    msg = events.message(bus, "info", "TEST", "ทดสอบ", "*/Facility/THBK")
    raw = stream.next_frame()
    assert raw == ("event: message\ndata: " + json.dumps(msg, ensure_ascii=False, separators=(",", ":")) + "\n\n").encode("utf-8")
    assert "ทดสอบ".encode("utf-8") in raw and b"\\u0e" not in raw      # ภาษาไทยไม่ escape
    assert raw.count(b"\n") == 3                                       # event, data, บรรทัดว่างปิด: JSON กะทัดรัดบรรทัดเดียว

    bus.publish("job", {"id": "j-1", "state": "running", "progress": 0.5})
    assert stream.next_event() == ("job", {"id": "j-1", "state": "running", "progress": 0.5})


def test_sse_events_arrive_in_publish_order(client, open_stream):
    stream = open_stream()
    assert stream.next_event()[0] == "ping"
    bus = get_bus(client)
    for i in range(20):
        bus.publish("job", {"i": i})
    assert [stream.next_event()[1]["i"] for _ in range(20)] == list(range(20))


def test_sse_ping_interval_is_injectable(client, open_stream):
    assert client.app.state.sse_ping_s == 15.0                         # ค่าตั้งต้นตาม spec
    client.app.state.sse_ping_s = 0.05
    stream = open_stream()
    start = time.monotonic()
    assert [stream.next_event() for _ in range(4)] == [("ping", {})] * 4   # ping ตอนเชื่อมต่อ + ping ตามรอบอีก 3 ครั้ง
    assert time.monotonic() - start < TIMEOUT


def test_sse_event_after_ping_keeps_stream_alive(client, open_stream):
    client.app.state.sse_ping_s = 0.05
    stream = open_stream()
    assert stream.next_event()[0] == "ping"
    time.sleep(0.2)                                                    # ผ่าน ping ไปหลายรอบ แล้วยังรับ event ได้
    get_bus(client).publish("scenario", {"name": "S1", "etag": "e", "results_stale": False})
    while (item := stream.next_event())[0] == "ping":
        pass                                                           # ping ที่ค้างอยู่ก่อน event ข้ามได้
    assert item == ("scenario", {"name": "S1", "etag": "e", "results_stale": False})


def test_sse_two_tabs_both_receive(client, open_stream):
    one, two = open_stream(), open_stream()
    assert one.next_event()[0] == "ping" and two.next_event()[0] == "ping"
    assert get_bus(client).subscriber_count == 2
    events.message(get_bus(client), "info", "TAB", "ทั้งสองแท็บ")
    a, b = one.next_event(), two.next_event()
    assert a == b and a[0] == "message" and a[1]["code"] == "TAB"


def test_sse_disconnect_unsubscribes(client, open_stream):
    bus = get_bus(client)
    stream = open_stream()
    assert stream.next_event()[0] == "ping"
    assert bus.subscriber_count == 1
    stream.close()                                                     # client ตัดการเชื่อมต่อ
    wait_for_count(bus, 0)                                             # generator หยุดและเลิกฟัง ไม่ทิ้งผู้ฟังค้าง
    bus.publish("job", {"i": 1})                                       # ไม่มีผู้ฟังเหลือ: ไม่ error


def test_sse_frame_helper_escapes_nothing_and_is_compact():
    from gnss_studio_server.routes.events import sse_frame
    frame = sse_frame("message", {"text": "ดาว\nสอง", "n": [1, 2], "x": None})
    assert frame == 'event: message\ndata: {"text":"ดาว\\nสอง","n":[1,2],"x":null}\n\n'.encode("utf-8")
    assert sse_frame("ping", {}) == b"event: ping\ndata: {}\n\n"


def test_main_limits_graceful_shutdown_so_open_sse_tabs_cannot_block_exit(monkeypatch, tmp_path):
    """uvicorn รอให้การเชื่อมต่อที่ค้างอยู่ (SSE ของแท็บที่เปิดไว้) ปิดเองก่อนหยุด ถ้าไม่ตั้ง timeout Ctrl-C จะไม่ทำงาน"""
    import uvicorn
    from gnss_studio_server import __main__ as entry
    calls = []
    monkeypatch.setattr(uvicorn, "run", lambda app, **kw: calls.append(kw))
    entry.main({"GNSS_STUDIO_DATA": str(tmp_path / "d")})
    (kw,) = calls
    assert 0 < kw["timeout_graceful_shutdown"] <= 5


# ---------- scenario event หลังเขียน ----------

@pytest.fixture
def published(client):
    """รายการ (event, data) ที่ route ส่งเข้า bus (ดักที่ publish ไม่ผ่าน SSE; ยังส่งต่อให้ bus จริงด้วย)"""
    bus, sent, original = get_bus(client), [], get_bus(client).publish

    def spy(event, data):
        sent.append((event, data))
        original(event, data)

    bus.publish = spy
    return sent


def etag_of(client, name="S1"):
    return client.get(f"/api/scenarios/{name}").headers["ETag"].strip('"')


def headers(client, name="S1"):
    return {"If-Match": f'"{etag_of(client, name)}"'}


def scenario_events(sent):
    return [d for e, d in sent if e == "scenario"]


def test_scenario_event_after_patch(client, s1, open_stream):
    stream = open_stream()
    assert stream.next_event()[0] == "ping"
    r = client.patch("/api/scenarios/S1/objects/Facility/THBK", json={"constraints": {"elevation_angle_min_deg": 15}},
                     headers=headers(client))
    assert r.status_code == 200, r.text
    event, data = stream.next_event()
    assert event == "scenario"
    assert data == {"name": "S1", "etag": r.json()["etag"], "results_stale": True}
    assert data["etag"] == etag_of(client)


def test_object_edits_publish_one_scenario_event_each(client, s1, published):
    published.clear()
    sc = "/api/scenarios/S1"

    def check(r, status=200):
        assert r.status_code == status, r.text
        assert scenario_events(published) == [{"name": "S1", "etag": r.json()["etag"], "results_stale": r.json()["results_stale"]}]
        assert [e for e, _ in published] == ["scenario"]
        published.clear()
        return r.json()

    assert check(client.patch(f"{sc}/objects/Satellite/G01", json={"graphics2d": {"color": "#00ff00"}}, headers=headers(client)))["results_stale"] is False
    assert check(client.patch(f"{sc}/objects/Facility/THBK", json={"basic": {"position": {"lat_deg": 14.0}}}, headers=headers(client)))["results_stale"] is True
    assert check(client.post(f"{sc}/objects", json={"class": "Facility", "method": "Insert Default"}, headers=headers(client)), 201)["results_stale"] is True
    check(client.post(f"{sc}/objects/Satellite/G01/rename", json={"new_name": "Gx1"}, headers=headers(client)))
    check(client.post(f"{sc}/groups", json={"name": "Mine", "members": ["*/Satellite/Gx1"]}, headers=headers(client)))
    check(client.delete(f"{sc}/objects/Satellite/Gx1", headers=headers(client)))


def test_failed_requests_publish_nothing(client, s1, published):
    published.clear()
    sc = "/api/scenarios/S1"
    old = headers(client)
    assert client.patch(f"{sc}/objects/Satellite/G01", json={"graphics2d": {"color": "#00ff00"}}, headers=old).status_code == 200
    published.clear()

    assert client.patch(f"{sc}/objects/Satellite/G22", json={"graphics2d": {"color": "#00ff00"}}, headers=old).status_code == 412   # ETag เก่า
    assert client.patch(f"{sc}/objects/Satellite/G22", json={"graphics2d": {"color": "#00ff00"}}).status_code == 412                # ไม่ส่ง If-Match
    assert client.patch(f"{sc}/objects/Satellite/Nope", json={"graphics2d": {"color": "#00ff00"}}, headers=headers(client)).status_code == 404
    assert client.patch(f"{sc}/objects/Satellite/G22", json={"graphics2d": {"color": "red"}}, headers=headers(client)).status_code == 422
    assert client.post(f"{sc}/objects/Satellite/G22/rename", json={"new_name": "G01"}, headers=headers(client)).status_code == 409
    assert client.delete(f"{sc}/objects/Satellite/Nope", headers=headers(client)).status_code == 404
    assert client.patch("/api/scenarios/nope/objects/Satellite/G01", json={}, headers={"If-Match": "abc"}).status_code == 404
    assert client.post("/api/scenarios", json={"name": "S1", "start": "2026-11-10T00:00:00Z", "stop": "2026-11-10T06:00:00Z",
                                                "template": "empty"}).status_code == 409
    assert client.post(f"{sc}/copy", json={"new_name": "S1"}).status_code == 409
    assert client.post("/api/scenarios/nope/copy", json={"new_name": "N2"}).status_code == 404
    assert client.put(sc, json=client.get(sc).json(), headers=old).status_code == 412
    assert client.put(sc, json=client.get(sc).json()).status_code == 412
    assert client.put(sc, json={**client.get(sc).json(), "name": "other"}, headers=headers(client)).status_code == 422
    assert client.put("/api/scenarios/nope", json={"name": "nope"}, headers={"If-Match": "abc"}).status_code == 404
    assert client.delete("/api/scenarios/nope").status_code == 404
    assert published == []


def test_reads_publish_nothing(client, s1, published):
    published.clear()
    assert client.get("/api/scenarios/S1").status_code == 200
    assert client.get("/api/scenarios/S1/objects").status_code == 200
    assert client.get("/api/scenarios/S1/objects/Satellite/G01").status_code == 200
    assert client.get("/api/scenarios").status_code == 200
    assert published == []                                             # อ่านอย่างเดียว ไม่ส่ง event


def test_create_publishes_scenario_not_stale(client, snapshot, published):
    r = client.post("/api/scenarios", json={"name": "S1", "start": "2026-11-10T00:00:00Z", "stop": "2026-11-10T06:00:00Z",
                                             "template": "thbk-gnss", "snapshot": "20261110T0000Z"})
    assert r.status_code == 201, r.text
    assert published == [("scenario", {"name": "S1", "etag": r.headers["ETag"].strip('"'), "results_stale": False})]


def test_copy_publishes_the_new_name_not_stale(client, s1, published):
    published.clear()
    r = client.post("/api/scenarios/S1/copy", json={"new_name": "S2"})
    assert r.status_code == 201, r.text
    assert published == [("scenario", {"name": "S2", "etag": r.headers["ETag"].strip('"'), "results_stale": False})]
    assert etag_of(client, "S2") == published[0][1]["etag"]


def test_delete_publishes_null_etag(client, s1, published):
    published.clear()
    assert client.delete("/api/scenarios/S1").status_code == 204
    assert published == [("scenario", {"name": "S1", "etag": None, "results_stale": False})]


def test_workbook_write_publishes_nothing(client, s1, published):
    published.clear()
    assert client.put("/api/scenarios/S1/workbook", json={"layout": [1]}).status_code == 204
    assert published == []


def stale_header(response):
    """ค่า X-Results-Stale ของ PUT เป็นบูลีน (ต้องเป็น "true" หรือ "false" เท่านั้น)"""
    value = response.headers["X-Results-Stale"]
    assert value in ("true", "false"), value
    return value == "true"


def test_put_publishes_etag_and_results_stale(client, s1, published):
    published.clear()
    doc = client.get("/api/scenarios/S1").json()

    same = client.put("/api/scenarios/S1", json=doc, headers=headers(client))                 # บันทึกเนื้อเดิม
    assert same.status_code == 200 and stale_header(same) is False
    doc["description"] = "เปลี่ยนแค่คำอธิบาย"
    desc = client.put("/api/scenarios/S1", json=doc, headers=headers(client))
    assert desc.status_code == 200 and stale_header(desc) is False
    doc["analysis_period"]["stop"] = "2026-11-10T05:00:00Z"                                    # ช่วงเวลาเปลี่ยน = hash ของ propagate เปลี่ยน
    period = client.put("/api/scenarios/S1", json=doc, headers=headers(client))
    assert period.status_code == 200 and stale_header(period) is True

    assert scenario_events(published) == [
        {"name": "S1", "etag": r.headers["ETag"].strip('"'), "results_stale": stale_header(r)}
        for r in (same, desc, period)]
    assert [e for e, _ in published] == ["scenario"] * 3


def test_put_response_body_is_exactly_the_saved_document(client, s1):
    """results_stale อยู่ใน header X-Results-Stale ไม่ใช่ในตัวเอกสาร (client เอาตัวตอบไป PUT ต่อได้โดยไม่ต้องตัดช่อง)"""
    doc = client.get("/api/scenarios/S1").json()
    doc["description"] = "x"
    r = client.put("/api/scenarios/S1", json=doc, headers=headers(client))
    assert r.status_code == 200 and r.json() == doc == client.get("/api/scenarios/S1").json()
    assert "results_stale" not in r.json()
    assert stale_header(r) is False
    assert r.headers["ETag"].strip('"') == etag_of(client)

    doc["analysis_period"]["stop"] = "2026-11-10T05:00:00Z"
    r = client.put("/api/scenarios/S1", json=doc, headers=headers(client))
    assert r.json() == doc and "results_stale" not in r.json() and stale_header(r) is True


def test_put_round_trip_never_stores_results_stale(client, s1, data_dir):
    """GET -> PUT -> PUT ตัวตอบกลับไปอีกครั้งด้วย ETag ใหม่: scenario.json ต้องไม่มีช่อง results_stale"""
    doc = client.get("/api/scenarios/S1").json()
    doc["description"] = "รอบแรก"
    first = client.put("/api/scenarios/S1", json=doc, headers=headers(client))
    assert first.status_code == 200, first.text
    second = client.put("/api/scenarios/S1", json=first.json(), headers={"If-Match": first.headers["ETag"]})
    assert second.status_code == 200, second.text
    saved = (data_dir / "scenarios" / "S1" / "scenario.json").read_bytes()
    assert b"results_stale" not in saved
    assert json.loads(saved) == doc and stale_header(second) is False
    assert second.headers["ETag"] == first.headers["ETag"]                    # เนื้อเดิมทุกไบต์: ETag เดิม


def test_put_can_repair_a_corrupted_scenario_file(client, s1, data_dir, published):
    """PUT ไม่ต้องอ่านไฟล์เดิมเป็น JSON ได้ (ตรวจแค่ ETag ของไบต์) ไฟล์ที่เสียต้องเขียนทับได้เหมือนก่อนมี event"""
    doc = client.get("/api/scenarios/S1").json()
    file = data_dir / "scenarios" / "S1" / "scenario.json"
    file.write_text("{not json")
    tag = hashlib.sha256(file.read_bytes()).hexdigest()[:16]
    published.clear()
    r = client.put("/api/scenarios/S1", json=doc, headers={"If-Match": f'"{tag}"'})
    assert r.status_code == 200, r.text
    assert stale_header(r) is True                                     # คำนวณ plan ของไฟล์เดิมไม่ได้ = ถือว่าผลไม่ตรง
    assert json.loads(file.read_text()) == doc and len(scenario_events(published)) == 1
