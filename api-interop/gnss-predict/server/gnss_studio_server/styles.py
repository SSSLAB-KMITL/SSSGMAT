"""My Styles บนดิสก์ (หัวข้อ 6.7 ของ spec server, P4, P5): style ของผู้ใช้หนึ่งตัวต่อไฟล์ `<data>/styles/<ชื่อ>.json`

- ชื่อตรงกฎ P5 (`report_style.NAME_RE`) และถูกตรวจก่อนสร้าง path ทุกครั้ง path จึงอยู่ใต้ `<data>/styles/` เสมอ (`../x`, `a/b` ใช้ไม่ได้)
- ชื่อไม่แยกตัวพิมพ์เล็กใหญ่ เหมือนชื่อ scenario และชื่อ object: macOS แยก `Mine.json` กับ `mine.json` ไม่ได้ จึงถือว่าเป็นชื่อเดียวกันทุกระบบ
  เขียนทับได้เฉพาะชื่อที่สะกดตรงกันทุกตัวอักษร ส่วนสะกดต่างแค่ตัวพิมพ์ = `FileExistsError` (route ตอบ 409 NAME_EXISTS)
- `save` เขียนผ่านไฟล์ชั่วคราวข้างปลายทางแล้ว `os.replace` (ผู้อ่านเห็นไฟล์เก่าหรือใหม่ครบ) ล็อกตัวเดียวครอบการตรวจชื่อกับการเขียน
- `list` อ่านเฉพาะไฟล์ `*.json` ปกติ (ไม่ใช่โฟลเดอร์หรือ symlink) ที่ชื่อไฟล์ตรงกฎ เป็น JSON object และช่อง `name` ตรงชื่อไฟล์
  ไฟล์ที่แก้มือแล้วเสีย ข้ามพร้อมเตือนใน log (ชื่อไฟล์และเหตุผล) ไม่ทำให้ทั้งรายการล้ม
  ไฟล์ที่เป็น JSON object ถูกรูปแต่เนื้อหา style ผิด (เช่น อ้าง element ที่ไม่มี) ยังอยู่ในรายการ: ข้อผิดพลาดขึ้นตอนสร้างรายงานตาม P6
- ขนาดไฟล์ไม่เกิน `MAX_STYLE_BYTES` (256 KB): `list` ตรวจก่อนอ่านและอ่านแค่เพดาน+1 ไบต์ ไฟล์ที่ใหญ่กว่าข้ามพร้อมเตือนใน log เหมือนไฟล์เสียอื่น
  (แทนที่ได้ด้วย PUT) `save` ปฏิเสธ style ที่เขียนออกมาแล้วเกินเพดานด้วย StyleError field `body` ไฟล์ที่เขียนเองจึงอ่านกลับได้เสมอ
"""

import json
import logging
import os
import threading
from pathlib import Path

from gnss_predict.errors import StyleError
from gnss_predict.report_style import NAME_RE

from .store import write_atomic

STYLES_DIR = "styles"
MAX_STYLE_BYTES = 256 * 1024          # ขนาดไฟล์และ body ของ My Style
SUFFIX = ".json"
NAME_TEXT = "ชื่อ style ต้องขึ้นต้นด้วยตัวอักษรหรือตัวเลข ตามด้วยตัวอักษร ตัวเลข ช่องว่าง _ หรือ - ยาวไม่เกิน 48 ตัว"


def check_name(name) -> str:
    """ชื่อที่ใช้เป็นชื่อไฟล์ได้ (P5) ไม่ตรงกฎ: StyleError ที่ field name"""
    if not isinstance(name, str) or not NAME_RE.fullmatch(name):
        raise StyleError(NAME_TEXT, "name")
    return name


class MyStyles:
    def __init__(self, data_dir: Path, logger: logging.Logger | None = None):
        self.directory = Path(data_dir) / STYLES_DIR
        self._logger = logger
        self._lock = threading.Lock()

    def _warn(self, file: str, reason: str) -> None:
        if self._logger is not None:
            self._logger.warning("My Style %s ใช้ไม่ได้ ข้ามไป: %s", file, reason)

    def _stems(self) -> dict[str, str]:
        """ชื่อ (ไม่รวม .json) ของทุกรายการ *.json ในโฟลเดอร์ -> ชื่อไฟล์ ไม่มีโฟลเดอร์ = ว่าง (ไม่สร้างโฟลเดอร์)"""
        try:
            with os.scandir(self.directory) as entries:
                return {e.name[:-len(SUFFIX)]: e.name for e in entries if e.name.endswith(SUFFIX)}
        except FileNotFoundError:
            return {}

    def _taken(self, name: str) -> str | None:
        """ชื่อที่สะกดต่างจาก `name` แค่ตัวพิมพ์เล็กใหญ่หรือตรงกันทุกตัว และมีรายการอยู่แล้ว (ไม่ว่าไฟล์จะใช้ได้หรือไม่) ไม่มี = None"""
        return next((stem for stem in self._stems() if stem.casefold() == name.casefold()), None)

    def _read(self, stem: str, file: str) -> dict | None:
        path = self.directory / file
        if path.is_symlink() or not path.is_file():
            self._warn(file, "ไม่ใช่ไฟล์ธรรมดา")
            return None
        if not NAME_RE.fullmatch(stem):
            self._warn(file, "ชื่อไฟล์ไม่ตรงกฎชื่อ style")
            return None
        try:
            with path.open("rb") as f:
                raw = f.read(MAX_STYLE_BYTES + 1)               # อ่านแค่เพดาน+1: ไฟล์ใหญ่ผิดปกติไม่เข้าหน่วยความจำทั้งก้อน
        except OSError as exc:
            self._warn(file, f"อ่านไฟล์ไม่ได้ ({type(exc).__name__})")
            return None
        if len(raw) > MAX_STYLE_BYTES:
            self._warn(file, f"ไฟล์ใหญ่เกิน {MAX_STYLE_BYTES // 1024} KB")
            return None
        try:
            style = json.loads(raw)
        except (ValueError, RecursionError) as exc:             # ValueError รวม JSON เสียและ UnicodeDecodeError RecursionError = ซ้อนลึกเกิน
            self._warn(file, f"อ่านเป็น JSON ไม่ได้ ({type(exc).__name__})")
            return None
        if not isinstance(style, dict):
            self._warn(file, "ไม่ใช่ JSON object")
            return None
        if style.get("name") != stem:
            self._warn(file, f"ช่อง name ({style.get('name')!r}) ไม่ตรงชื่อไฟล์")
            return None
        return style

    def list(self) -> list[dict]:
        """style ที่ใช้ได้ทุกตัว เรียงตามชื่อ (ไม่แยกตัวพิมพ์)"""
        styles = [style for stem, file in self._stems().items() if (style := self._read(stem, file)) is not None]
        return sorted(styles, key=lambda s: s["name"].casefold())

    def save(self, style: dict, *, exclusive: bool = False) -> None:
        """เขียน style ลง `<ชื่อ>.json` (สร้างโฟลเดอร์ถ้ายังไม่มี) ชื่อผิดกฎ: StyleError (field name)

        ชื่อที่สะกดต่างแค่ตัวพิมพ์เล็กใหญ่ของรายการที่มีอยู่: FileExistsError(ชื่อที่เก็บไว้) exclusive=True ใช้ชื่อที่มีอยู่แล้วไม่ได้เลย (สร้างใหม่เท่านั้น)
        การเขียนไม่สำเร็จไม่แตะไฟล์เดิม ไม่ทิ้งไฟล์ชั่วคราว"""
        name = check_name(style.get("name") if isinstance(style, dict) else None)
        data = (json.dumps(style, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode("utf-8")
        if len(data) > MAX_STYLE_BYTES:
            raise StyleError(f"style ใหญ่เกิน {MAX_STYLE_BYTES // 1024} KB เมื่อเขียนเป็นไฟล์ (ได้ {len(data) // 1024 + 1} KB)", "body")
        with self._lock:
            taken = self._taken(name)
            if taken is not None and (exclusive or taken != name):
                raise FileExistsError(taken)
            self.directory.mkdir(parents=True, exist_ok=True)
            write_atomic(self.directory / f"{name}{SUFFIX}", data)

    def delete(self, name: str) -> None:
        """ลบ style ชื่อนี้ (ต้องสะกดตรงกับที่เก็บไว้) ชื่อผิดกฎ: StyleError ไม่มี: FileNotFoundError"""
        check_name(name)
        with self._lock:
            if self._taken(name) != name:
                raise FileNotFoundError(name)
            (self.directory / f"{name}{SUFFIX}").unlink()
