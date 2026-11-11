"""SHA-256 ของไฟล์ผลลัพธ์ สำหรับ `ETag` ของ route ส่งไฟล์ (หัวข้อ 6.5 ของ spec server)

bundle ไม่เปลี่ยนหลังเขียน แต่ `predicted.sp3` ของงาน 7 วันใหญ่ได้ถึงร้อยกว่า MB จึงไม่คำนวณซ้ำทุก request: แคชตาม
(path, ขนาด, เวลาแก้ไขเป็น ns) ถ้าไฟล์ถูกแทนที่ ขนาดหรือเวลาแก้ไขเปลี่ยน แล้วคำนวณใหม่ แคชมีขอบเขต (ตัวที่ไม่ได้ใช้นานสุดถูกเขี่ยออก) และปลอดภัยเมื่อใช้หลาย thread
"""

import hashlib
import threading
from collections import OrderedDict
from pathlib import Path

CACHE_SIZE = 256
CHUNK_BYTES = 1 << 20


def read_sha256(path: Path) -> str:
    """SHA-256 (hex 64 ตัว) ของเนื้อไฟล์ อ่านทีละ 1 MiB"""
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(CHUNK_BYTES):
            digest.update(chunk)
    return digest.hexdigest()


class FileDigests:
    def __init__(self, size: int = CACHE_SIZE):
        self.size = size
        self._entries: OrderedDict[tuple[str, int, int], str] = OrderedDict()
        self._lock = threading.Lock()

    def __len__(self) -> int:
        with self._lock:
            return len(self._entries)

    def sha256(self, path: Path) -> str:
        """SHA-256 ของไฟล์ ไม่มีไฟล์ -> OSError คำนวณนอกล็อก (request อื่นไม่ต้องรอไฟล์ใหญ่) สองคนขอไฟล์เดียวกันพร้อมกันอาจคำนวณซ้ำได้"""
        stat = Path(path).stat()
        key = (str(path), stat.st_size, stat.st_mtime_ns)
        with self._lock:
            cached = self._entries.get(key)
            if cached is not None:
                self._entries.move_to_end(key)
                return cached
        digest = read_sha256(path)
        with self._lock:
            self._entries[key] = digest
            self._entries.move_to_end(key)
            while len(self._entries) > self.size:
                self._entries.popitem(last=False)
        return digest
