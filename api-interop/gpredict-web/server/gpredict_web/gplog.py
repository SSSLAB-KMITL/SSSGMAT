"""Logger รูปแบบ Gpredict (sat-log.c, ref-D §7.2): ไฟล์ data/logs/gpredict.log ที่หน้า Log browser อ่านได้

- บรรทัด `YYYY/MM/DD HH:MM:SS|<ระดับ 1-4>|<function>: <ข้อความ>` เวลาท้องถิ่นของเครื่องรูปแบบคงที่ ข้อความหลายบรรทัดแยกเป็นหลายบรรทัด
  (บรรทัดละหนึ่ง record มี function นำหน้าทุกบรรทัด) ท้ายข้อความที่เป็น whitespace ถูกตัด
  <function> = record.gp_function (extra ของ logging) ถ้ามี ไม่งั้น record.funcName ข้อความที่ขึ้นต้นด้วย "<function>: " อยู่แล้วไม่ถูกเติมซ้ำ
  (ข้อความของ Gpredict ฝัง __func__ ไว้เองเช่น "%s: PRINT not implemented" และหน้าเว็บส่งข้อความนั้นมาทั้งประโยค)
- ระดับ: 0 ไม่เขียนอะไร, 1 ERROR, 2 WARNING, 3 INFO, 4 DEBUG บรรทัดถูกเขียนเมื่อระดับของมัน ≤ ระดับที่ตั้ง
  ระดับมาจาก LOG/LEVEL ตอนเริ่ม server ครั้งเดียว (Gpredict ไม่ปรับระดับระหว่างทำงาน) แต่ "Session started" เป็น INFO และถูกเขียนเสมอ
- handler ติดกับ logger "gpredict_web" จึงรับ record ของทุกส่วน (งานย่อย 1-3 log ด้วย logging.getLogger(__name__)) ไม่เปลี่ยน propagation
  ระดับ 3 และ 4 ลดระดับของ logger ลงชั่วคราวให้ INFO และ DEBUG ผ่านถึง handler (ปกติ root เป็น WARNING) แล้วคืนตอนจบ session
- เปิดไฟล์ไม่ได้: พิมพ์สาเหตุที่ stderr แล้ว record ลง stderr รูปแบบเดียวกัน ไม่มีไฟล์จึงไม่มี Session started/ended และไม่หมุนไฟล์
- จบ session: "Session ended" (INFO จึงมีเมื่อระดับ ≥ 3) ปิดไฟล์ clean_age > 0 เปลี่ยนชื่อเป็น gpredict-<unix time>.log แล้วลบ
  gpredict-<timestamp>.log ที่ timestamp ≤ now − clean_age (clean_age 0 = ลบทุกไฟล์ที่หมุนแล้ว gpredict.log อยู่จนเริ่มครั้งถัดไป)
  เทียบ timestamp เป็นตัวเลข (Gpredict เทียบเป็นสตริง) และแตะเฉพาะไฟล์ชื่อ gpredict-<ตัวเลข>.log
- POST /api/log (Log ของหน้าเว็บ): parse_entry ตรวจรูปแบบอย่างเข้ม ผิดตอบ 422 LOG_INVALID
"""

import logging
import os
import re
import sys
import time
from pathlib import Path

from .errors import ApiError

LOG_FILE = "gpredict.log"
LOGGER_NAME = "gpredict_web"
LEVEL_OF = {logging.CRITICAL: 1, logging.ERROR: 1, logging.WARNING: 2, logging.INFO: 3, logging.DEBUG: 4}
PYTHON_LEVEL = {1: logging.ERROR, 2: logging.WARNING, 3: logging.INFO, 4: logging.DEBUG}      # ระดับของ Gpredict -> logging
LOG_TEXT_MAX = 500
FUNCTION_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]{0,63}")
ENTRY_KEYS = ("level", "function", "text")
START_FUNCTION = "sat_log_init"                      # ชื่อ function ของ Gpredict ที่เขียน "Session started" และ "Session ended"
END_FUNCTION = "sat_log_close"
_TIME_FORMAT = "%Y/%m/%d %H:%M:%S"
_ROTATED_RE = re.compile(r"gpredict-(\d+)\.log")
_INFO = LEVEL_OF[logging.INFO]


def gp_level(levelno: int) -> int:
    """ระดับ 1-4 ของ Gpredict ของ levelno ของ logging ระดับที่อยู่ระหว่างกันนับเป็นระดับถัดลงไป (35 = WARNING) ต่ำกว่า DEBUG = 4"""
    for python_level in (logging.ERROR, logging.WARNING, logging.INFO):
        if levelno >= python_level:
            return LEVEL_OF[python_level]
    return LEVEL_OF[logging.DEBUG]


class GpredictLogHandler(logging.Handler):
    """เขียน record ลง log_dir/gpredict.log (หรือ stderr ถ้าเปิดไฟล์ไม่ได้) ตามระดับ gp_level ทุกบรรทัด flush ทันที"""

    def __init__(self, log_dir: Path):
        super().__init__()
        self.log_dir = Path(log_dir)
        self.gp_level = LEVEL_OF[logging.DEBUG]      # ก่อนอ่านค่าตั้งกรองที่ DEBUG เหมือน sat-log.c:55 start_session ตั้งระดับจริงทีหลัง
        self.closed = False
        self.saved_logger_level = logging.NOTSET     # ระดับเดิมของ logger ที่ start_session ลดไว้ end_session คืน
        self._file = self._open()

    @property
    def has_file(self) -> bool:
        return self._file is not None

    def _open(self):
        """สร้างโฟลเดอร์ ลบ gpredict.log ของรอบก่อนแล้วเปิดไฟล์ใหม่ (sat-log.c:90-120) ข้อผิดพลาดพิมพ์ที่ stderr ไฟล์เปิดไม่ได้คืน None"""
        path = self.log_dir / LOG_FILE
        try:
            self.log_dir.mkdir(mode=0o755, parents=True, exist_ok=True)
        except OSError:
            print(f"ERROR: Could not create {self.log_dir}", file=sys.stderr)
        try:
            path.unlink(missing_ok=True)
        except OSError:
            print(f"{START_FUNCTION}: Failed to delete old log file {path}", file=sys.stderr)
        try:
            return open(path, "w", encoding="utf-8", errors="replace", newline="\n")
        except OSError as exc:
            print(f"\n\nERROR: Failed to create {path}\n{exc}\n\n", file=sys.stderr)
            return None

    def write(self, level: int, function: str, text: str, created: float) -> None:
        """เขียนข้อความหนึ่งรายการโดยไม่กรองระดับ: แยกเป็นบรรทัด (ตัด whitespace ท้ายข้อความ) บรรทัดละหนึ่ง record"""
        stamp = time.strftime(_TIME_FORMAT, time.localtime(created))
        prefix = f"{function}: "
        lines = text.rstrip().replace("\r\n", "\n").replace("\r", "\n").split("\n")
        out = "".join(f"{stamp}|{level}|{line if line.startswith(prefix) else prefix + line}\n" for line in lines)
        with self.lock:
            if self.closed:
                return
            stream = self._file if self._file is not None else sys.stderr
            stream.write(out)
            stream.flush()

    def emit(self, record: logging.LogRecord) -> None:
        try:
            level = gp_level(record.levelno)
            if level > self.gp_level:
                return
            function = getattr(record, "gp_function", None) or record.funcName
            self.write(level, function, self.format(record), record.created)
        except Exception:
            self.handleError(record)

    def close(self) -> None:
        with self.lock:
            self.closed = True
            file, self._file = self._file, None
            if file is not None:
                file.close()
        super().close()


def _session_line(handler: GpredictLogHandler, function: str, text: str, created: float) -> None:
    """บรรทัด Session started/ended: เขียนไม่ได้ (ดิสก์เต็ม, ไฟล์ถูกปิด) บอกที่ stderr แล้วไปต่อ (ของเรา) ไม่ให้บรรทัดเดียว
    ทำให้ server เริ่มหรือปิดไม่ได้ เหมือน emit ที่ทนการเขียนไม่ได้อยู่แล้ว"""
    try:
        handler.write(_INFO, function, text, created)
    except (OSError, ValueError) as exc:     # ValueError: เขียนลงไฟล์ที่ถูกปิดแล้ว
        print(f"{function}: เขียน \"{text}\" ลง {handler.log_dir / LOG_FILE} ไม่ได้: {exc}", file=sys.stderr)


def start_session(log_dir: Path, level: int) -> GpredictLogHandler:
    """ลบ gpredict.log ของรอบก่อน เขียน "Session started" (INFO เสมอ แม้ level = 0) แล้วกรองที่ level และติด handler กับ logger gpredict_web"""
    handler = GpredictLogHandler(log_dir)
    if handler.has_file:
        _session_line(handler, START_FUNCTION, "Session started", time.time())
    handler.gp_level = level
    logger = logging.getLogger(LOGGER_NAME)
    handler.saved_logger_level = logger.level
    wanted = PYTHON_LEVEL.get(level)                 # level 0 ไม่ต้องรับ record ใดเพิ่ม
    if wanted is not None and logger.getEffectiveLevel() > wanted:
        logger.setLevel(wanted)
    logger.addHandler(handler)
    return handler


def end_session(handler: GpredictLogHandler, clean_age: int, now: float) -> None:
    """เขียน "Session ended" (INFO) ถอด handler คืนระดับของ logger ปิดไฟล์ แล้วหมุนและลบไฟล์เก่าตาม clean_age (เรียกซ้ำได้ ครั้งหลังไม่ทำอะไร)"""
    if handler.closed:
        return
    if handler.has_file and handler.gp_level >= _INFO:
        _session_line(handler, END_FUNCTION, "Session ended", now)
    logger = logging.getLogger(LOGGER_NAME)
    logger.removeHandler(handler)
    logger.setLevel(handler.saved_logger_level)
    had_file = handler.has_file
    handler.close()
    if had_file:
        _rotate(handler.log_dir, clean_age, now)


def _rotate(log_dir: Path, clean_age: int, now: float) -> None:
    """log_rotate และ clean_log_dir ของ sat-log.c:253-339"""
    stamp = int(now)
    if clean_age > 0:
        current, rotated = log_dir / LOG_FILE, log_dir / f"gpredict-{stamp}.log"
        try:
            current.rename(rotated)
        except OSError:
            print(f"log_rotate: Failed to rename {current} to {rotated}", file=sys.stderr)
    cutoff = stamp - clean_age
    try:
        names = os.listdir(log_dir)
    except OSError:
        return
    for name in names:
        found = _ROTATED_RE.fullmatch(name)
        if found and int(found[1]) <= cutoff:
            try:
                (log_dir / name).unlink()
            except OSError:
                print(f"clean_log_dir: Failed to delete old log file {log_dir / name}", file=sys.stderr)


def parse_entry(body: dict) -> tuple[int, str, str]:
    """{level, function, text} ของ POST /api/log เป็น (level, function, text) level จำนวนเต็ม 1-4 (bool และสตริงไม่ใช่)
    function ตรง FUNCTION_RE, text ยาว 1-LOG_TEXT_MAX ตัว, ช่องอื่นไม่รับ ผิด: 422 LOG_INVALID (object = ชื่อช่อง)"""
    def invalid(field: str, text: str) -> ApiError:
        return ApiError("LOG_INVALID", 422, text, field)

    level, function, text = (body.get(key) for key in ENTRY_KEYS)
    if type(level) is not int or level not in PYTHON_LEVEL:
        raise invalid("level", "ระดับ (level) ต้องเป็นจำนวนเต็ม 1-4 (1 = ERROR, 2 = WARNING, 3 = INFO, 4 = DEBUG)")
    if not isinstance(function, str) or not FUNCTION_RE.fullmatch(function):
        raise invalid("function", "ชื่อ function ต้องขึ้นต้นด้วยตัวอักษรหรือ _ และมีเฉพาะตัวอักษร ตัวเลขและ _ ยาวไม่เกิน 64 ตัว")
    if not isinstance(text, str) or not 1 <= len(text) <= LOG_TEXT_MAX:
        raise invalid("text", f"ข้อความ (text) ต้องยาว 1-{LOG_TEXT_MAX} ตัวอักษร")
    for key in body:
        if key not in ENTRY_KEYS:
            raise invalid(key, f"ไม่รับช่อง {key} (รับเฉพาะ level, function และ text)")
    return level, function, text
