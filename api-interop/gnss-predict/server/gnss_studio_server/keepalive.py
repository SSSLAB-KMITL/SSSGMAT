"""ตัวส่ง HTTPS แบบ keep-alive ของตัวดึงภาพ (stdlib เท่านั้น: `http.client.HTTPSConnection`)

ตัวดึงเดิมเปิด TCP + TLS ใหม่ทุกชิ้นภาพ (เพิ่ม ~0.2-0.5 วินาทีต่อชิ้น) ตัวนี้เก็บ connection ไว้ใช้ซ้ำแทน แต่กติกาการดึงทั้งหมดอยู่ที่เดิม (ที่ `imagery.py`):
`open(request, timeout=...)` ทำตัวเหมือน opener ของ urllib ที่ `TileFetcher` เรียก: 2xx -> response ที่มี `.status`, `.headers`, `.read(n)`, `.close()`;
สถานะอื่นทุกค่า (รวม 3xx: ไม่ตาม redirect เลย) -> `urllib.error.HTTPError`; ล้มเหลวทางเครือข่าย -> `OSError` / `http.client.HTTPException`

- ใช้ได้เฉพาะ `https` ไปยัง host ที่ผู้เรียกกำหนด (`pool_sizes` = host -> ขนาด pool; ใน server นี้มาจากตาราง `SOURCES` เท่านั้น) พอร์ต 443 และไม่มี userinfo:
  อย่างอื่น = `ValueError` (ผิดที่โปรแกรม ไม่ใช่ความล้มเหลวของเครือข่าย) URL ที่ถูกประกอบจาก catalog ไม่มีทางเข้าเงื่อนไขนี้
- pool ต่อ (scheme, host) ขนาดคงที่: connection ทั้งหมดของ host (ที่ว่าง + ที่กำลังใช้) ไม่เกินขนาด; แต่ละคำขอได้ connection ของตัวเองตั้งแต่ `open` จนถึง
  `close` ของ response (thread-safe); เต็มแล้วรอได้ถึง `POOL_WAIT_S` แล้ว `TimeoutError` (ตัวดึงจำกัดดึงพร้อมกันต่อแหล่งไว้ไม่เกินขนาด pool อยู่แล้ว จึงไม่เกิดในการใช้จริง)
- ใช้ connection ซ้ำเมื่อ response อ่านครบ (อ่านจนจบ ได้ตรงตาม Content-Length ไม่เกินเพดานขนาด และเซิร์ฟเวอร์ไม่ส่ง `Connection: close`) เท่านั้น
  ปิดแล้วทิ้งเมื่อ: เกิดข้อผิดพลาดใด ๆ, อ่านไม่ครบ (ผู้เรียกปิดก่อนอ่านจบ รวมกรณีเกิน 2 MB + 1 ไบต์), ได้ไบต์ไม่ตรง Content-Length (ตัดกลางทาง), เกินเพดานขนาด,
  หรือเซิร์ฟเวอร์ส่ง `Connection: close` (ถ้า response ไม่มี Content-Length และไม่ chunked `http.client` ถือว่าต้องปิดอยู่แล้ว)
- เนื้อของ response ที่ไม่ใช่ 2xx อ่านทิ้งได้ไม่เกิน `ERROR_BODY_LIMIT` เพื่อให้ใช้ connection ซ้ำได้ (404 ของชิ้นที่ไม่มีภาพพบบ่อย); เกินหรืออ่านไม่ได้ = ทิ้ง connection
  (รหัสสถานะยังเป็นตัวตัดสินเสมอ)
- connection ที่ว่างอยู่นานเซิร์ฟเวอร์อาจปิดไปแล้ว: ถ้าคำขอบน connection ที่เคยใช้แล้วล้มด้วยการที่ปลายทางตัดการเชื่อมต่อก่อนตอบ (`STALE_ERRORS`) จะทิ้งตัวที่ว่างทั้งหมดของ host นั้น
  แล้วส่งซ้ำ **ครั้งเดียว** บน connection ใหม่ (คำขอ GET ที่ปลายทางไม่เคยตอบ) connection ใหม่ที่ล้มเหลว timeout หรือข้อผิดพลาดระหว่างอ่านเนื้อไม่ส่งซ้ำ
  ดังนั้นกติกา "ดึงครั้งเดียว ไม่ลองซ้ำ" ต่อเซิร์ฟเวอร์ปลายทางยังเหมือนเดิม: ไม่มีคำขอใดถึงปลายทางสองครั้ง
"""

import functools
import http.client
import io
import ssl
import threading
import urllib.error
import urllib.parse
from typing import Callable, Mapping

POOL_WAIT_S = 15                       # รอที่ว่างใน pool นานสุด (ปกติไม่เคยรอ: ดูหัวไฟล์)
ERROR_BODY_LIMIT = 64 * 1024           # เนื้อของ response ที่ไม่ใช่ 2xx ที่ยอมอ่านทิ้งเพื่อใช้ connection ซ้ำ
STALE_ERRORS = (http.client.RemoteDisconnected, ConnectionResetError, ConnectionAbortedError, BrokenPipeError,
                ssl.SSLEOFError, ssl.SSLZeroReturnError)


@functools.cache
def _tls_context() -> ssl.SSLContext:
    """context ตั้งต้นของ Python (ตรวจ certificate และชื่อ host) สร้างครั้งเดียวแล้วใช้ร่วมกันทุก connection: โหลดที่เก็บ CA ซ้ำทุก connection ช้า"""
    return ssl.create_default_context()


def https_connection(host: str, timeout: float | None) -> http.client.HTTPSConnection:
    """connection factory ตั้งต้น: HTTPSConnection ที่ยังไม่ต่อ (ต่อตอนส่งคำขอแรก)"""
    return http.client.HTTPSConnection(host, timeout=timeout, context=_tls_context())


def content_length(headers) -> int | None:
    """Content-Length ที่เซิร์ฟเวอร์ประกาศ (ตัวเลข ASCII เท่านั้น) หรือ None"""
    value = headers.get("Content-Length") if headers is not None else None
    return int(value) if isinstance(value, str) and value.strip().isascii() and value.strip().isdigit() else None


def _close_quietly(conn) -> None:
    try:
        conn.close()
    except Exception:                  # connection ที่พังอยู่แล้วปิดไม่สำเร็จ ไม่ใช่เรื่องที่ผู้เรียกต้องรู้
        pass


def _wants_close(resp) -> bool:
    if getattr(resp, "will_close", False):
        return True
    return "close" in (token.strip() for token in (resp.headers.get("Connection") or "").lower().split(","))


def _reusable(resp, total: int, limit: int) -> bool:
    """response ที่เพิ่งอ่านมา `total` ไบต์ทำให้ connection กลับไปใช้ต่อได้หรือไม่"""
    announced = content_length(resp.headers)
    return resp.isclosed() and total <= limit and (announced is None or announced == total) and not _wants_close(resp)


class _HostPool:
    """connection ของ host เดียว: ที่ว่าง (`_idle`, ตัวที่ใช้ล่าสุดก่อน) + ที่กำลังใช้ = `_live` ไม่เกิน `size`"""

    def __init__(self, size: int):
        self.size = size
        self._idle: list = []
        self._live = 0
        self._cond = threading.Condition()

    def live(self) -> int:
        with self._cond:
            return self._live

    def checkout(self, factory: Callable, host: str, timeout, wait_s: float):
        """(connection, เคยใช้แล้วหรือไม่): ตัวที่ว่างก่อน ไม่มีและยังไม่ถึงขนาดก็สร้างใหม่ ถึงขนาดแล้วรอที่ว่าง"""
        with self._cond:
            if not self._cond.wait_for(lambda: self._idle or self._live < self.size, wait_s):
                raise TimeoutError(f"connection pool for {host} is full ({self.size} in use)")
            if self._idle:
                return self._idle.pop(), True
            self._live += 1
        try:
            return factory(host, timeout), False
        except BaseException:
            self._forget(1)
            raise

    def release(self, conn, reuse: bool) -> None:
        if reuse:
            with self._cond:
                self._idle.append(conn)
                self._cond.notify()
        else:
            self.discard(conn)

    def discard(self, conn) -> None:
        _close_quietly(conn)           # ปิดก่อนคืนที่ว่าง: จำนวน connection ที่เปิดอยู่จริงไม่เกินขนาดแม้ชั่วขณะ
        self._forget(1)

    def flush_idle(self) -> None:
        with self._cond:
            idle, self._idle = self._idle, []
        for conn in idle:
            _close_quietly(conn)
        self._forget(len(idle))

    def _forget(self, count: int) -> None:
        with self._cond:
            self._live -= count
            self._cond.notify_all()


class _PooledResponse:
    """response ของคำขอที่สำเร็จ (2xx): `.status`, `.headers`, `.read(n)`, `.close()` ผู้เรียกต้อง `close()` เสมอ (ตัวดึงทำใน finally)
    `close()` เป็นจุดตัดสินว่า connection กลับ pool หรือถูกทิ้ง"""

    def __init__(self, resp, conn, pool: _HostPool, limit: int):
        self.status, self.reason, self.headers = resp.status, getattr(resp, "reason", ""), resp.headers
        self._resp, self._conn, self._pool, self._limit = resp, conn, pool, limit
        self._total = 0
        self._failed = False
        self._released = False

    def read(self, amt: int | None = None) -> bytes:
        try:
            data = self._resp.read() if amt is None else self._resp.read(amt)
        except BaseException:
            self._failed = True
            raise
        self._total += len(data)
        return data

    def close(self) -> None:
        if self._released:
            return
        self._released = True
        reuse = not self._failed and _reusable(self._resp, self._total, self._limit)   # ตัดสินก่อน close: close ทำให้ isclosed() เป็นจริงเสมอ
        try:
            self._resp.close()
        finally:
            self._pool.release(self._conn, reuse)


class KeepAliveTransport:
    """opener ที่ใช้ connection ซ้ำ ดูหัวไฟล์

    pool_sizes: host -> ขนาด pool ของ host นั้น (ต้องไม่น้อยกว่าจำนวนคำขอที่ผู้เรียกส่งพร้อมกันไป host นั้น)
    max_body: เพดานขนาดเนื้อที่ผู้เรียกยอมรับ (เนื้อที่อ่านไปเกินนี้ = ทิ้ง connection)
    connection_factory: callable(host, timeout) -> connection แบบ HTTPSConnection (ตั้งต้น `https_connection`; test ฉีดตัวปลอม)"""

    def __init__(self, pool_sizes: Mapping[str, int], max_body: int, connection_factory: Callable | None = None):
        self.pool_sizes = dict(pool_sizes)
        self.max_body = max_body
        self.connection_factory = connection_factory if connection_factory is not None else https_connection
        self._pools = {("https", host): _HostPool(size) for host, size in self.pool_sizes.items()}

    def live_connections(self) -> int:
        """จำนวน connection ที่เปิดอยู่ทั้งหมด (ที่ว่าง + ที่กำลังใช้) ทุก host"""
        return sum(pool.live() for pool in self._pools.values())

    def open(self, request, timeout: float | None = None):
        host, target = self._locate(request.full_url)
        pool = self._pools[("https", host)]
        headers = {"Host": host, "Accept-Encoding": "identity"}        # identity: Content-Length ต้องตรงกับไบต์ที่อ่านจริง
        headers.update(request.header_items())                        # User-Agent จากตัวดึง
        conn, resp = self._send(pool, host, target, headers, timeout)
        if 200 <= resp.status < 300:
            return _PooledResponse(resp, conn, pool, self.max_body)
        raise self._http_error(request.full_url, resp, conn, pool)

    def _locate(self, url: str) -> tuple[str, str]:
        parts = urllib.parse.urlsplit(url)
        try:
            port = parts.port
        except ValueError:
            port = -1
        if (parts.scheme != "https" or ("https", parts.hostname) not in self._pools or port not in (None, 443)
                or parts.username is not None or parts.password is not None):
            raise ValueError(f"refusing {parts.scheme}://{parts.hostname}: only https to {sorted(self.pool_sizes)} is allowed")
        return parts.hostname, (parts.path or "/") + (f"?{parts.query}" if parts.query else "")

    def _send(self, pool: _HostPool, host: str, target: str, headers: dict, timeout):
        """(connection, response ที่อ่านหัวแล้ว); ล้มเหลว = ทิ้ง connection แล้วส่งข้อผิดพลาดต่อ (ยกเว้นกรณี connection เก่าที่ว่างอยู่ ดูหัวไฟล์)"""
        retry_stale = True
        while True:
            conn, reused = pool.checkout(self.connection_factory, host, timeout, POOL_WAIT_S)
            try:
                conn.timeout = timeout                                 # connection ที่ใช้ซ้ำรับ timeout ของคำขอนี้ด้วย
                if getattr(conn, "sock", None) is not None:
                    conn.sock.settimeout(timeout)
                conn.request("GET", target, headers=headers)
                return conn, conn.getresponse()
            except BaseException as exc:
                pool.discard(conn)
                if reused and retry_stale and isinstance(exc, STALE_ERRORS):
                    retry_stale = False
                    pool.flush_idle()
                    continue
                raise

    def _http_error(self, url: str, resp, conn, pool: _HostPool) -> urllib.error.HTTPError:
        """ทุกสถานะที่ไม่ใช่ 2xx (รวม 3xx) เป็น HTTPError เหมือน opener ของ urllib ที่ไม่ตาม redirect; อ่านเนื้อทิ้งแล้วคืน connection ถ้าอ่านจบได้เล็ก ๆ"""
        body, reuse = b"", False
        try:
            body = resp.read(ERROR_BODY_LIMIT + 1)
            reuse = _reusable(resp, len(body), ERROR_BODY_LIMIT)
        except (OSError, http.client.HTTPException):
            pass                                                       # อ่านเนื้อไม่ได้ก็ยังตอบตามรหัสสถานะ
        except BaseException:
            pool.discard(conn)
            raise
        try:
            resp.close()
        finally:
            pool.release(conn, reuse)
        return urllib.error.HTTPError(url, resp.status, getattr(resp, "reason", ""), resp.headers, io.BytesIO(body[:ERROR_BODY_LIMIT]))
