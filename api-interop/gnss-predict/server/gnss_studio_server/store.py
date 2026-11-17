"""เก็บ scenario ลงดิสก์ที่ `<data>/scenarios/<ชื่อ>/` (`scenario.json`, `workbook.json`; ผลลัพธ์อยู่ใน `ephem/` และ `access/`)

- ชื่อ scenario ตรง `^[A-Za-z0-9_-]{1,32}$` และถูกตรวจก่อนสร้าง path ทุกครั้ง path จึงอยู่ใต้ `<data>/scenarios/` เสมอ
  การอ่านไม่สร้างโฟลเดอร์ใดเลย
- ETag ของ scenario คือ 16 ตัวแรกของ SHA-256 ของไฟล์ (`etag`) `If-Match` รับแบบมีเครื่องหมายคำพูด ไม่มี หรือขึ้นต้นด้วย `W/`
- เขียนทุกครั้งผ่านไฟล์ชั่วคราวข้างปลายทางแล้ว `os.replace` ไฟล์ชั่วคราวผ่าน `load_scenario` ของ engine ก่อนจึงถูกแทนที่
  ผู้อ่านเห็นไฟล์เก่าหรือไฟล์ใหม่ครบเสมอ
- เก็บเอกสารของ client ตรงตัว (ไม่ใช่ผลของ pydantic) ช่องที่ไม่รู้จักทุกระดับจึงอยู่ครบ
- ล็อก `threading.Lock` ต่อชื่อ scenario (P8: ผู้ใช้คนเดียว server process เดียว) ครอบการตรวจ ETag + เขียน ชื่อที่ต่างกันแค่ตัวพิมพ์
  ใช้ล็อกเดียวกัน
"""

import hashlib
import json
import os
import shutil
import threading
import uuid
from contextlib import ExitStack, contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from gnss_predict.scenario import EngineScenario, load_scenario

from .errors import ApiError
from .schema import NAME_RE, validate_scenario

SCENARIOS_DIR = "scenarios"
SCENARIO_FILE = "scenario.json"
WORKBOOK_FILE = "workbook.json"
WORKBOOK_MAX_BYTES = 1_048_576
_Dicts = list[dict]
_Strs = list[str]                      # ใช้แทน list[...] ในคลาสที่มี method ชื่อ list


def etag(data: bytes) -> str:
    """16 ตัวแรกของ SHA-256 ของเนื้อไฟล์"""
    return hashlib.sha256(data).hexdigest()[:16]


def normalize_etag(value: str) -> str:
    """ค่าของ If-Match -> ETag เปล่า: ตัดช่องว่าง, คำนำหน้า W/ และเครื่องหมายคำพูด"""
    value = value.strip()
    if value[:2] in ("W/", "w/"):
        value = value[2:]
    return value.strip().strip('"')


def check_etag(current: str, if_match: str | None) -> None:
    """If-Match ไม่ตรงกับ ETag ปัจจุบัน -> ApiError 412 (detail คือ ETag ปัจจุบัน) None = ไม่ตรวจ"""
    if if_match is not None and normalize_etag(if_match) != current:
        raise ApiError(412, "ETAG_MISMATCH", "scenario ถูกแก้จากที่อื่นแล้ว โหลดใหม่ก่อนบันทึก", detail=current)


def write_atomic(path: Path, data: bytes) -> None:
    """เขียนไฟล์ข้างปลายทางแล้ว os.replace (ผู้อ่านเห็นไฟล์เก่าหรือไฟล์ใหม่ครบ ไม่เห็นไฟล์ที่เขียนค้าง) ใช้ร่วมกับ settings"""
    tmp = path.with_name(f"{path.name}.tmp-{uuid.uuid4().hex[:8]}")
    try:
        tmp.write_bytes(data)
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


def _serialize(doc: Any) -> bytes:
    try:
        return (json.dumps(doc, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode("utf-8")
    except (TypeError, ValueError):
        raise ApiError(422, "SCENARIO_INVALID", "บันทึกข้อมูลนี้เป็น JSON ไม่ได้ (เช่น มีค่า NaN หรือ Infinity)") from None


def _iso_z(timestamp: float) -> str:
    return datetime.fromtimestamp(timestamp, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class ScenarioStore:
    def __init__(self, data_dir: Path):
        self.data_dir = Path(data_dir)
        self.root = self.data_dir / SCENARIOS_DIR
        self._locks: dict[str, threading.Lock] = {}
        self._guard = threading.Lock()

    # ---------- ชื่อและ path ----------

    def path(self, name: str, field: str = "name") -> Path:
        """โฟลเดอร์ของ scenario (ไม่ต้องมีอยู่จริง ไม่สร้าง) ชื่อผิดรูปแบบ -> ApiError 422 ที่ field นั้น (ตั้งต้น name)"""
        if not isinstance(name, str) or not NAME_RE.fullmatch(name):
            raise ApiError(422, "SCENARIO_INVALID", "ชื่อ scenario ต้องเป็นตัวอักษร A-Z a-z ตัวเลข _ หรือ - ยาว 1 ถึง 32 ตัว",
                           field)
        return self.root / name

    def _scenario_names(self) -> _Strs:
        """ชื่อโฟลเดอร์ที่มี scenario.json อยู่จริง"""
        try:
            with os.scandir(self.root) as entries:
                return [e.name for e in entries if e.is_dir() and (Path(e.path) / SCENARIO_FILE).is_file()]
        except FileNotFoundError:
            return []

    def _existing(self, name: str) -> Path:
        """โฟลเดอร์ของ scenario ที่มีอยู่ ชื่อตรงทุกตัวอักษร (macOS แยกตัวพิมพ์ไม่ได้ จึงเทียบกับรายการจริง) ไม่มี -> 404"""
        path = self.path(name)
        if name not in self._scenario_names():
            raise ApiError(404, "NOT_FOUND", f"ไม่พบ scenario {name}")
        return path

    def ensure_free(self, name: str, field: str = "name") -> Path:
        """ชื่อถูกต้องและยังไม่ถูกใช้ (ไม่แยกตัวพิมพ์เล็กใหญ่ เหมือนชื่อ object ของ engine) ไม่งั้น 422 / 409 ที่ field นั้น"""
        path = self.path(name, field)
        taken = [n for n in self._scenario_names() if n.casefold() == name.casefold()]
        if taken:
            raise ApiError(409, "NAME_EXISTS", f"มี scenario ชื่อ {taken[0]} อยู่แล้ว (ชื่อไม่แยกตัวพิมพ์เล็กใหญ่)", field, taken[0])
        return path

    @contextmanager
    def _locked(self, *names: str):
        keys = sorted({n.casefold() for n in names})          # เรียงลำดับเสมอ กัน deadlock เมื่อล็อกสองชื่อ
        with self._guard:
            locks = [self._locks.setdefault(k, threading.Lock()) for k in keys]
        with ExitStack() as stack:
            for lock in locks:
                stack.enter_context(lock)
            yield

    # ---------- อ่าน ----------

    def list(self) -> _Dicts:
        """name, start, stop, modified_utc, daily ของทุก scenario เรียงตามชื่อ ข้ามโฟลเดอร์ที่อ่าน scenario.json ไม่ได้"""
        out = []
        for name in sorted(self._scenario_names(), key=str.casefold):
            if not NAME_RE.fullmatch(name):
                continue
            file = self.root / name / SCENARIO_FILE
            try:
                doc = json.loads(file.read_bytes())
                modified = file.stat().st_mtime
            except (OSError, ValueError):
                continue
            if not isinstance(doc, dict):
                continue
            period = doc.get("analysis_period")
            period = period if isinstance(period, dict) else {}
            out.append({"name": name, "start": period.get("start"), "stop": period.get("stop"),
                        "modified_utc": _iso_z(modified), "daily": doc.get("daily") is not None})
        return out

    def read(self, name: str) -> tuple[dict, str]:
        """(เอกสาร, ETag เปล่า) จากไฟล์ชุดเดียวกัน"""
        path = self._existing(name)
        try:
            data = (path / SCENARIO_FILE).read_bytes()
        except FileNotFoundError:
            raise ApiError(404, "NOT_FOUND", f"ไม่พบ scenario {name}") from None
        try:
            doc = json.loads(data)
        except ValueError:
            doc = None
        if not isinstance(doc, dict):
            raise ApiError(422, "SCENARIO_INVALID", f"scenario.json ของ {name} อ่านไม่ได้ (ไม่ใช่ JSON object ที่ถูกต้อง)", "<file>")
        return doc, etag(data)

    def current_etag(self, name: str) -> str:
        """ETag ปัจจุบันของไฟล์ โดยไม่แปลงเป็น JSON (ไฟล์ที่เสียก็ได้ ETag) ไม่มี scenario -> 404"""
        try:
            return etag((self._existing(name) / SCENARIO_FILE).read_bytes())
        except FileNotFoundError:
            raise ApiError(404, "NOT_FOUND", f"ไม่พบ scenario {name}") from None

    # ---------- เขียน ----------

    def _prepare(self, name: str, doc: Any) -> bytes:
        """ตรวจ schema ของ pydantic และชื่อ แล้วแปลงเป็นไบต์ที่จะเขียน"""
        validate_scenario(doc)
        if doc["name"] != name:
            raise ApiError(422, "SCENARIO_INVALID", f"ช่อง name ({doc['name']}) ต้องตรงกับชื่อ scenario ใน path ({name})", "name")
        return _serialize(doc)

    def _commit(self, directory: Path, data: bytes) -> str:
        """เขียนไฟล์ชั่วคราว ให้ engine ตรวจ (load_scenario) แล้ว os.replace เข้าที่ ผิด -> ไฟล์เดิมไม่เปลี่ยน"""
        tmp = directory / f"{SCENARIO_FILE}.tmp-{uuid.uuid4().hex[:8]}"
        try:
            tmp.write_bytes(data)
            load_scenario(tmp)
            os.replace(tmp, directory / SCENARIO_FILE)
        finally:
            tmp.unlink(missing_ok=True)
        return etag(data)

    def engine_view(self, name: str, doc: Any) -> EngineScenario:
        """ส่วนที่ engine ใช้ (ผล `load_scenario`) ของ doc ถ้าบันทึกเป็น scenario นี้ ตรวจแบบเดียวกับ `write` (schema แล้วผ่านไฟล์ชั่วคราว)
        แต่ไม่แตะ scenario.json และไม่ตรวจ ETag ผิด -> ApiError / ScenarioError เหมือน `write`"""
        directory = self._existing(name)
        data = self._prepare(name, doc)
        tmp = directory / f"{SCENARIO_FILE}.tmp-{uuid.uuid4().hex[:8]}"
        try:
            tmp.write_bytes(data)
            return load_scenario(tmp)
        finally:
            tmp.unlink(missing_ok=True)

    def write(self, name: str, doc: Any, if_match: str | None) -> str:
        """บันทึก scenario ที่มีอยู่ทั้งก้อน คืน ETag ใหม่ if_match เป็น None = เขียนจากฝั่ง server เอง ไม่ตรวจ ETag"""
        directory = self._existing(name)
        with self._locked(name):
            try:
                current = etag((directory / SCENARIO_FILE).read_bytes())
            except FileNotFoundError:
                raise ApiError(404, "NOT_FOUND", f"ไม่พบ scenario {name}") from None
            check_etag(current, if_match)
            return self._commit(directory, self._prepare(name, doc))

    def create(self, name: str, doc: Any) -> str:
        """สร้าง scenario ใหม่ ชื่อซ้ำ (ไม่แยกตัวพิมพ์เล็กใหญ่) -> 409 NAME_EXISTS คืน ETag"""
        self.path(name)                                    # ตรวจชื่อก่อนทำอย่างอื่น
        data = self._prepare(name, doc)
        with self._locked(name):
            directory = self.ensure_free(name)
            fresh = not directory.exists()
            directory.mkdir(parents=True, exist_ok=True)
            try:
                return self._commit(directory, data)
            except BaseException:
                if fresh:
                    shutil.rmtree(directory, ignore_errors=True)
                raise

    def copy(self, name: str, new_name: str) -> str:
        """Save As: คัดลอก scenario.json (แก้ name, ตัด daily) กับ workbook.json เท่านั้น ไม่คัดลอก ephem/ และ access/ คืน ETag ของสำเนา"""
        source = self.path(name)
        target = self.path(new_name, "new_name")
        with self._locked(name, new_name):
            self._existing(name)
            self.ensure_free(new_name, "new_name")
            doc, _ = self.read(name)
            doc["name"] = new_name
            doc.pop("daily", None)                 # สำเนาเป็นของผู้ใช้ ไม่ใช่งานประจำวัน (ไม่ให้การเก็บรักษาผลเก่านับรวม)
            data = _serialize(doc)
            fresh = not target.exists()
            target.mkdir(parents=True, exist_ok=True)
            try:
                write_atomic(target / SCENARIO_FILE, data)
                try:
                    workbook = (source / WORKBOOK_FILE).read_bytes()
                except FileNotFoundError:
                    workbook = None
                if workbook is not None:
                    write_atomic(target / WORKBOOK_FILE, workbook)
            except BaseException:
                if fresh:
                    shutil.rmtree(target, ignore_errors=True)
                raise
            return etag(data)

    def delete(self, name: str) -> None:
        """ลบโฟลเดอร์ scenario ทั้งโฟลเดอร์ (route ตรวจก่อนว่าไม่มี job ของ scenario นี้ที่ยังรอหรือกำลังรัน)"""
        self.path(name)
        with self._locked(name):
            shutil.rmtree(self._existing(name))

    # ---------- workbook ----------

    def read_workbook(self, name: str) -> dict | None:
        """layout หน้าต่างที่เก็บไว้ ยังไม่มีหรืออ่านไม่ได้คืน None"""
        path = self._existing(name)
        try:
            doc = json.loads((path / WORKBOOK_FILE).read_bytes())
        except (OSError, ValueError):
            return None
        return doc if isinstance(doc, dict) else None

    def write_workbook(self, name: str, doc: Any) -> None:
        """เก็บเป็นก้อนทึบ ไม่ตีความ จำกัด 1 MB (ขนาดตอน serialize แบบกะทัดรัด)"""
        if not isinstance(doc, dict):
            raise ApiError(422, "SCENARIO_INVALID", "workbook ต้องเป็น JSON object", "workbook")
        try:
            data = json.dumps(doc, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
        except (TypeError, ValueError):
            raise ApiError(422, "SCENARIO_INVALID", "workbook มีค่าที่บันทึกเป็น JSON ไม่ได้", "workbook") from None
        if len(data) > WORKBOOK_MAX_BYTES:
            raise ApiError(422, "SCENARIO_INVALID", f"workbook ใหญ่เกิน {WORKBOOK_MAX_BYTES} ไบต์ (ได้ {len(data)} ไบต์)", "workbook")
        directory = self._existing(name)
        with self._locked(name):
            if not (directory / SCENARIO_FILE).is_file():
                raise ApiError(404, "NOT_FOUND", f"ไม่พบ scenario {name}")
            write_atomic(directory / WORKBOOK_FILE, data)
