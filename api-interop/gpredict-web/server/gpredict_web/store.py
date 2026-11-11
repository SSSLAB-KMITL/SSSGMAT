"""ที่เก็บข้อมูลบนดิสก์: QTH ที่ data/qth/<name>.json และสถานีตั้งต้นที่ data/settings.json (หัวข้อ 7.1 ของ spec)

ทุกไฟล์เขียนลงไฟล์ชั่วคราวในโฟลเดอร์เดียวกันแล้ว rename ทับ จึงไม่มีไฟล์ที่เขียนค้างครึ่งเดียว
"""

import dataclasses
import json
import math
import os
import threading
import uuid
from dataclasses import asdict, dataclass, replace
from pathlib import Path

from .config import NAME_RE
from .errors import ApiError

SETTINGS_FILE = "settings.json"
QTH_DIR = "qth"

DESCRIPTION_MAX = 256
LOCATION_MAX = 50
WEATHER_STATION_MAX = 4
LAT_MAX, LON_MAX = 90.0, 180.0
ALT_MIN_M, ALT_MAX_M = 0.0, 5000.0                    # ขอบเขตของ Gpredict


def write_json_atomic(path: Path, obj) -> None:
    """เขียน JSON (UTF-8 ไม่ escape ภาษาไทย) ลงไฟล์ชั่วคราวข้างๆ แล้ว rename ทับ ถ้าล้มไฟล์เดิมยังอยู่และไม่มีไฟล์ชั่วคราวค้าง"""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        with open(tmp, "x", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, indent=2)
            f.write("\n")
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise


@dataclass
class Qth:
    name: str
    description: str = ""
    location: str = ""
    lat_deg: float = 0.0
    lon_deg: float = 0.0
    alt_m: float = 0.0
    weather_station: str = ""


def _invalid(field: str, text: str) -> ApiError:
    return ApiError("QTH_INVALID", 422, text, field)


def _is_number(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def validate_qth(q: Qth) -> Qth:
    """ตรวจทุกช่องตามหัวข้อ 7.1 คืนสำเนาที่ lat/lon/alt เป็น float ผิดช่องไหน -> 422 QTH_INVALID ที่ object = ชื่อช่องนั้น"""
    if not (isinstance(q.name, str) and NAME_RE.fullmatch(q.name)):
        raise _invalid("name", "ชื่อ QTH (name) ต้องเป็นตัวอักษร A-Z, a-z, ตัวเลข, _ หรือ - ยาว 1-25 ตัว")
    for field, label, limit in (("description", "คำอธิบาย", DESCRIPTION_MAX), ("location", "ที่ตั้ง", LOCATION_MAX),
                                ("weather_station", "รหัสสถานีอากาศ", WEATHER_STATION_MAX)):
        v = getattr(q, field)
        if not isinstance(v, str) or len(v) > limit:
            raise _invalid(field, f"{label} ({field}) ต้องเป็นข้อความยาวไม่เกิน {limit} ตัวอักษร")
    for field, label, lo, hi, unit in (("lat_deg", "ละติจูด", -LAT_MAX, LAT_MAX, "องศา"),
                                       ("lon_deg", "ลองจิจูด", -LON_MAX, LON_MAX, "องศา"),
                                       ("alt_m", "ความสูง", ALT_MIN_M, ALT_MAX_M, "เมตร")):
        v = getattr(q, field)
        if not _is_number(v) or not lo <= v <= hi:
            raise _invalid(field, f"{label} ({field}) ต้องเป็นตัวเลขระหว่าง {lo:g} ถึง {hi:g} {unit}")
    return replace(q, lat_deg=float(q.lat_deg), lon_deg=float(q.lon_deg), alt_m=float(q.alt_m))


def qth_from_dict(d) -> Qth:
    """สร้าง Qth จาก JSON ช่องที่ไม่มีใช้ค่าตั้งต้น ช่องที่ไม่รู้จักถูกข้าม ตรวจด้วย validate_qth"""
    if not isinstance(d, dict):
        raise ApiError("QTH_INVALID", 422, "ข้อมูล QTH ต้องเป็น JSON object")
    fields = {f.name: d[f.name] for f in dataclasses.fields(Qth) if f.name in d}
    return validate_qth(Qth(**{"name": None, **fields}))


def _not_found(name: str) -> ApiError:
    return ApiError("NOT_FOUND", 404, f"ไม่พบ QTH ชื่อ {name}", name)


class Store:
    def __init__(self, data_dir: Path):
        self.data_dir = Path(data_dir)
        self._lock = threading.RLock()

    # ---------- QTH ----------

    @property
    def _qth_dir(self) -> Path:
        return self.data_dir / QTH_DIR

    def _qth_path(self, name: str) -> Path:
        """path ของ QTH ชื่อที่ผ่าน NAME_RE เท่านั้น (ชื่ออื่นไม่มีทางมีไฟล์ จึงเป็น 404 และไม่มีการหลุดออกนอกโฟลเดอร์)"""
        if not (isinstance(name, str) and NAME_RE.fullmatch(name)):
            raise _not_found(str(name))
        return self._qth_dir / f"{name}.json"

    def _qth_names(self) -> list[str]:
        if not self._qth_dir.is_dir():
            return []
        return sorted(p.stem for p in self._qth_dir.glob("*.json") if NAME_RE.fullmatch(p.stem))

    def get_qth(self, name: str) -> Qth:
        path = self._qth_path(name)
        try:
            raw = path.read_text(encoding="utf-8")
        except FileNotFoundError:
            raise _not_found(name) from None
        try:
            return qth_from_dict(json.loads(raw))
        except json.JSONDecodeError:
            raise ApiError("QTH_INVALID", 422, f"ไฟล์ QTH ของ {name} อ่านไม่ได้ (ไม่ใช่ JSON ที่ถูกต้อง)", name) from None

    def list_qth(self) -> list[Qth]:
        with self._lock:
            return sorted((self.get_qth(n) for n in self._qth_names()), key=lambda q: q.name)

    def put_qth(self, q: Qth) -> None:
        q = validate_qth(q)
        with self._lock:
            write_json_atomic(self._qth_path(q.name), asdict(q))

    def delete_qth(self, name: str) -> None:
        """404 ถ้าไม่มี, 409 IN_USE ถ้าเป็นสถานีสุดท้าย ถ้าลบสถานีตั้งต้นจะย้ายสถานีตั้งต้นไปที่ชื่อแรกที่เหลือ"""
        with self._lock:
            path = self._qth_path(name)
            if not path.is_file():
                raise _not_found(name)
            remaining = [n for n in self._qth_names() if n != name]
            if not remaining:
                raise ApiError("IN_USE", 409, f"ลบ QTH {name} ไม่ได้ เพราะเป็นสถานีสุดท้าย", name)
            if self._stored_default() == name:
                self._write_default(remaining[0])
            path.unlink()

    # ---------- สถานีตั้งต้น ----------

    def _read_settings(self) -> dict:
        """settings.json ที่หายหรืออ่านไม่ได้ถือเป็นว่าง (มีแค่ตัวชี้สถานีตั้งต้น เขียนใหม่ได้)"""
        try:
            data = json.loads((self.data_dir / SETTINGS_FILE).read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError):
            return {}
        return data if isinstance(data, dict) else {}

    def _stored_default(self) -> str | None:
        name = self._read_settings().get("default_qth")
        return name if isinstance(name, str) else None

    def _write_default(self, name: str) -> None:
        settings = self._read_settings()
        settings["default_qth"] = name
        write_json_atomic(self.data_dir / SETTINGS_FILE, settings)

    def default_qth(self) -> str | None:
        """ชื่อสถานีตั้งต้น หรือ None ถ้ายังไม่ตั้งหรือสถานีนั้นไม่มีไฟล์แล้ว"""
        with self._lock:
            name = self._stored_default()
            if name is not None and NAME_RE.fullmatch(name) and self._qth_path(name).is_file():
                return name
            return None

    def set_default_qth(self, name: str) -> None:
        with self._lock:
            if not self._qth_path(name).is_file():
                raise _not_found(name)
            self._write_default(name)
