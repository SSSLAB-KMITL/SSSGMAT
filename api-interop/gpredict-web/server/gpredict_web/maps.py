"""ภาพแผนที่พื้นหลังของ Map View (หัวข้อ 9.3 ของ spec งานย่อย 4, ref-D §11)

มี 15 ภาพของ Gpredict (โฟลเดอร์ maps/ ข้างไฟล์นี้ ที่มาใน maps/SOURCE.md) กับภาพที่ผู้ใช้อัปโหลดเก็บที่ <data dir>/maps/
(ของเรา: Gpredict ให้เลือกไฟล์บนดิสก์ แต่ browser เลือกไฟล์บนดิสก์ของ server ไม่ได้)

ชื่อไฟล์ใช้กติกาเดียวกับค่าของ module และ MODULES/MAP_FILE (module.is_map_file: [A-Za-z0-9_.-]{1,100} ไม่มี path)
ชื่อที่ใช้ได้ใน module จึงใช้ที่นี่ได้ด้วย และชื่อไม่มีทางพาออกนอกสองโฟลเดอร์นี้
ไม่ใช้ library ภาพ: อ่านขนาดจากหัว PNG (IHDR) และ JPEG (SOFn) เอง และตรวจ magic bytes ตอนอัปโหลด (ไม่ถอดรหัสภาพ)
"""

import io
import struct
from pathlib import Path
from typing import BinaryIO

from .errors import ApiError
from .module import is_map_file
from .store import _write_bytes_atomic

# ref-D §11 "Stock maps shipped" ตามลำดับในเอกสาร
STOCK_MAPS = ("earth_800.png", "nasa-bmng-01_1024.jpg", "nasa-bmng-01_2048.jpg", "nasa-bmng-03_1024.jpg",
              "nasa-bmng-03_2048.jpg", "nasa-bmng-05_1024.jpg", "nasa-bmng-05_2048.jpg", "nasa-bmng-07_1024.jpg",
              "nasa-bmng-07_2048.jpg", "nasa-bmng-08_1024.jpg", "nasa-bmng-08_2048.jpg", "nasa-topo_800.png",
              "nasa-topo_1024.jpg", "nasa-topo_1600.jpg", "nasa-topo_2048.jpg")
STOCK_DIR = Path(__file__).resolve().parent / "maps"
UPLOAD_DIR = "maps"                      # ใต้ data dir
MAP_UPLOAD_MAX = 10 * 1024 * 1024        # ไบต์ของภาพที่อัปโหลด (รวม 10 MB พอดี)

PNG, JPEG = "image/png", "image/jpeg"
# นามสกุล (ตัวพิมพ์เล็ก) -> ชนิดภาพที่ Content-Type และ magic bytes ต้องตรง
_KIND_OF_EXT = {".png": PNG, ".jpg": JPEG, ".jpeg": JPEG}
_PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
_JPEG_SIGNATURE = b"\xff\xd8\xff"
# SOF0-SOF15 ยกเว้น DHT (C4), JPG (C8) และ DAC (CC) ซึ่งเลข marker อยู่ในช่วงเดียวกันแต่ไม่ใช่หัวภาพ
_JPEG_SOF = frozenset(range(0xC0, 0xD0)) - {0xC4, 0xC8, 0xCC}
_JPEG_NO_LENGTH = frozenset({0x01, 0xD8, 0xD9, *range(0xD0, 0xD8)})        # marker ที่ไม่มีความยาวตามหลัง
_JPEG_SOS = 0xDA


def _ext(name: str) -> str:
    """นามสกุลตัวพิมพ์เล็กที่รับ ("" ถ้าไม่ใช่ .png/.jpg/.jpeg หรือไม่มีชื่อหน้านามสกุล)"""
    lower = name.lower()
    for ext in _KIND_OF_EXT:
        if lower.endswith(ext) and len(lower) > len(ext):
            return ext
    return ""


def _png_size(f: BinaryIO) -> tuple[int, int]:
    """f อยู่หลัง signature: chunk แรกต้องเป็น IHDR (ความยาว 4, ชนิด 4, กว้าง 4, สูง 4 ไบต์)"""
    ihdr = f.read(16)
    if len(ihdr) < 16 or ihdr[4:8] != b"IHDR":
        raise ValueError("PNG ไม่มี IHDR เป็น chunk แรก")
    return struct.unpack(">II", ihdr[8:16])


def _jpeg_size(f: BinaryIO) -> tuple[int, int]:
    """f อยู่หลัง SOI: เดินตาม marker จนพบ SOFn (ความแม่นยำ 1 ไบต์, สูง 2 ไบต์, กว้าง 2 ไบต์) ข้าม segment อื่นด้วย seek
    ไม่เข้าไปในข้อมูลภาพ (SOS) จึงอ่านเฉพาะส่วนหัวแม้ไฟล์ใหญ่หรือมี metadata ยาว"""
    while True:
        byte = f.read(1)
        if not byte:
            raise ValueError("ไฟล์ JPEG สั้นเกินไป อ่านหัวภาพไม่ได้")
        if byte != b"\xff":
            raise ValueError("โครงสร้าง JPEG ผิด (ไม่พบ marker)")
        while byte == b"\xff":                                   # ไบต์ FF เติมได้ก่อน marker
            byte = f.read(1)
        if not byte:
            raise ValueError("ไฟล์ JPEG สั้นเกินไป อ่านหัวภาพไม่ได้")
        marker = byte[0]
        if marker in _JPEG_NO_LENGTH:
            continue
        if marker == _JPEG_SOS:
            raise ValueError("ไม่พบหัวภาพ JPEG (SOFn) ก่อนข้อมูลภาพ")
        raw = f.read(2)
        if len(raw) < 2:
            raise ValueError("ไฟล์ JPEG สั้นเกินไป อ่านหัวภาพไม่ได้")
        (length,) = struct.unpack(">H", raw)
        if length < 2:
            raise ValueError("โครงสร้าง JPEG ผิด (ความยาว segment ต่ำกว่า 2)")
        if marker in _JPEG_SOF:
            frame = f.read(5)
            if length < 7 or len(frame) < 5:
                raise ValueError("หัวภาพ JPEG (SOFn) สั้นเกินไป")
            height, width = struct.unpack(">HH", frame[1:5])
            return width, height
        f.seek(length - 2, io.SEEK_CUR)


def _read_size(f: BinaryIO) -> tuple[int, int]:
    """(กว้าง, สูง) จากหัว PNG หรือ JPEG ใน f (เริ่มที่ต้นไฟล์) ValueError ถ้าไม่ใช่ภาพสองชนิดนี้ หัวเสีย หรือขนาดเป็น 0"""
    head = f.read(8)
    if head == _PNG_SIGNATURE:
        width, height = _png_size(f)
    elif head[:3] == _JPEG_SIGNATURE:
        f.seek(2)
        width, height = _jpeg_size(f)
    else:
        raise ValueError("ไม่ใช่ไฟล์ PNG หรือ JPEG")
    if width <= 0 or height <= 0:
        raise ValueError("ขนาดภาพต้องมากกว่า 0")
    return width, height


def image_size(path: Path) -> tuple[int, int]:
    """(กว้าง, สูง) เป็นพิกเซลของไฟล์ PNG หรือ JPEG อ่านหัวไฟล์เอง OSError ถ้าเปิดไม่ได้, ValueError ถ้าไม่ใช่ภาพที่หัวถูกต้อง"""
    with open(path, "rb") as f:
        return _read_size(f)


def _entry(path: Path, name: str, stock: bool) -> dict | None:
    """รายการของ list_maps (None ถ้าอ่านไม่ได้หรือไม่ใช่ภาพ จึงไม่ถูกแสดง)"""
    try:
        width, height = image_size(path)
        size = path.stat().st_size
    except (OSError, ValueError):
        return None
    return {"file": name, "stock": stock, "width": width, "height": height, "bytes": size}


def _upload_dir(data_dir: Path) -> Path:
    return Path(data_dir) / UPLOAD_DIR


def list_maps(data_dir: Path) -> list[dict]:
    """{file, stock, width, height, bytes} ภาพของ Gpredict ก่อน (ตามลำดับใน STOCK_MAPS) แล้วภาพที่อัปโหลดเรียงตามชื่อ (ไม่สนตัวพิมพ์)
    ไฟล์ใน data/maps/ ที่ชื่อหรือนามสกุลไม่เข้ากติกา อ่านหัวภาพไม่ได้ หรือไม่ใช่ไฟล์ ไม่ถูกแสดง"""
    listed = [e for name in STOCK_MAPS if (e := _entry(STOCK_DIR / name, name, True))]
    try:
        names = sorted((p.name for p in _upload_dir(data_dir).iterdir()), key=lambda n: (n.casefold(), n))
    except OSError:                                              # ยังไม่เคยอัปโหลด
        return listed
    for name in names:
        if name in STOCK_MAPS or not is_map_file(name) or not _ext(name):
            continue
        if (e := _entry(_upload_dir(data_dir) / name, name, False)):
            listed.append(e)
    return listed


def resolve(data_dir: Path, file: str) -> Path | None:
    """path ของไฟล์ภาพชื่อ file (ภาพของ Gpredict ก่อน แล้วภาพที่อัปโหลด) None ถ้าชื่อไม่เข้ากติกา ไม่ใช่ภาพ หรือไม่มีไฟล์
    ชื่อที่ผ่านกติกาไม่มี "/" จึงออกนอกสองโฟลเดอร์ไม่ได้"""
    if not is_map_file(file):
        return None
    if file in STOCK_MAPS:
        path = STOCK_DIR / file
    elif _ext(file):
        path = _upload_dir(data_dir) / file
    else:
        return None
    return path if path.is_file() else None


def map_entry(data_dir: Path, file: str) -> dict | None:
    """รายการแบบเดียวกับ list_maps ของภาพชื่อ file ภาพเดียว (None ถ้า resolve ไม่ได้หรืออ่านหัวภาพไม่ได้)"""
    path = resolve(data_dir, file)
    return None if path is None else _entry(path, file, file in STOCK_MAPS)


def _invalid(text: str, obj: str) -> ApiError:
    return ApiError("MAP_INVALID", 422, text, obj)


def check_upload_size(size: int) -> None:
    """ApiError 422 MAP_INVALID (object body) ถ้า size ไบต์เกิน MAP_UPLOAD_MAX (ผู้เรียก body ดิบเรียกระหว่างอ่านเพื่อหยุดก่อนเก็บทั้งก้อน)"""
    if size > MAP_UPLOAD_MAX:
        raise _invalid(f"ภาพต้องไม่เกิน {MAP_UPLOAD_MAX // (1024 * 1024)} MB", "body")


def save_upload(data_dir: Path, name: str, content_type: str | None, body: bytes) -> str:
    """เก็บภาพที่อัปโหลดเป็น <data dir>/maps/<name> แล้วคืนชื่อไฟล์ ชื่อเดิมที่เคยอัปโหลดแล้วถูกแทนที่
    ApiError 422 MAP_INVALID (object = name / Content-Type / body) ถ้า
    - name ไม่เข้ากติกาชื่อไฟล์ภาพ ไม่ลงท้าย .jpg/.jpeg/.png (ตัวพิมพ์ใดก็ได้) หรือซ้ำชื่อภาพของ Gpredict
    - Content-Type ไม่ใช่ image/png (.png) หรือ image/jpeg (.jpg, .jpeg) (พารามิเตอร์ท้ายชนิดไม่นับ)
    - body เกิน MAP_UPLOAD_MAX, magic bytes ไม่ตรงนามสกุล หรืออ่านหัวภาพ (ขนาด) ไม่ได้"""
    if not is_map_file(name):
        raise _invalid("ชื่อไฟล์ภาพ (name) ใช้ได้เฉพาะ A-Z a-z 0-9 _ . - ยาว 1-100 ตัว และไม่มี path", "name")
    ext = _ext(name)
    if not ext:
        raise _invalid(f"ชื่อไฟล์ภาพ ({name}) ต้องลงท้ายด้วย .jpg, .jpeg หรือ .png และมีชื่อนำหน้า", "name")
    if name in STOCK_MAPS:
        raise _invalid(f"ชื่อ {name} ซ้ำกับภาพของ Gpredict ให้ใช้ชื่ออื่น", "name")
    kind = _KIND_OF_EXT[ext]
    declared = (content_type or "").split(";", 1)[0].strip().lower()
    if declared != kind:
        raise _invalid(f"Content-Type ต้องเป็น {kind} สำหรับไฟล์ {ext} (ได้ {content_type or 'ไม่มี'})", "Content-Type")
    check_upload_size(len(body))
    if not body.startswith(_PNG_SIGNATURE if kind == PNG else _JPEG_SIGNATURE):
        raise _invalid(f"เนื้อไฟล์ไม่ใช่ภาพ {'PNG' if kind == PNG else 'JPEG'} ตามนามสกุล {ext}", "body")
    try:
        _read_size(io.BytesIO(body))
    except ValueError as exc:
        raise _invalid(f"อ่านหัวภาพไม่ได้: {exc}", "body") from None
    _write_bytes_atomic(_upload_dir(data_dir) / name, body)
    return name
