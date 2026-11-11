"""ที่เก็บข้อมูลบนดิสก์: QTH ที่ data/qth/<name>.json, สถานีตั้งต้นและธง bootstrap_done ที่ data/settings.json,
module ที่ data/modules/<name>.json และ session (module ที่เปิดค้างตามลำดับแท็บ) ที่ data/session.json (หัวข้อ 7.1 ของ spec)

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
from .module import ModuleConfig, module_from_dict, module_to_dict

SETTINGS_FILE = "settings.json"
SESSION_FILE = "session.json"
QTH_DIR = "qth"
MODULES_DIR = "modules"

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
    """int หรือ float ที่จำกัดค่า (ไม่นับ bool) isfinite เรียกเฉพาะ float เพราะ int ใหญ่เกินจะ OverflowError (int ที่เกินช่วงตกที่การเทียบ lo <= v <= hi)"""
    if isinstance(v, bool):
        return False
    return math.isfinite(v) if isinstance(v, float) else isinstance(v, int)


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


def _module_not_found(name: str) -> ApiError:
    return ApiError("NOT_FOUND", 404, f"ไม่พบ module ชื่อ {name}", name)


_UNREADABLE = object()          # _module_qth_ref อ่านไฟล์ module ไม่ได้


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

    def qth_names(self) -> list[str]:
        """ชื่อ QTH ทุกตัวที่มีไฟล์ เรียงตามชื่อ (ไม่อ่านเนื้อไฟล์ ไฟล์ที่เสียจึงไม่ทำให้รายชื่อทั้งหมดใช้ไม่ได้)"""
        with self._lock:
            return self._qth_names()

    def get_qth(self, name: str) -> Qth:
        """404 ถ้าไม่มี, 422 QTH_INVALID ถ้าไฟล์เสีย (ไม่ใช่ JSON/UTF-8 ที่ถูกต้อง หรือช่องผิด) เหมือน get_module"""
        path = self._qth_path(name)
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            raise _not_found(name) from None
        except ValueError:                     # JSONDecodeError, UnicodeDecodeError และ int เกิน 4300 หลัก
            raise ApiError("QTH_INVALID", 422, f"ไฟล์ QTH ของ {name} อ่านไม่ได้ (ไม่ใช่ JSON ที่ถูกต้อง)", name) from None
        return qth_from_dict(data)

    def list_qth_checked(self) -> tuple[list[Qth], list[tuple[str, ApiError]]]:
        """(QTH ที่ใช้ได้เรียงตามชื่อ, [(ชื่อไฟล์ เช่น "Broken.json", error)] ของไฟล์ที่ถูกข้าม) ไฟล์ที่เสียไม่ทำให้ทั้งรายการล้ม
        ไฟล์ที่หายไประหว่างอ่าน (ถูกลบพอดี) ไม่นับว่าเสีย"""
        with self._lock:
            good, skipped = [], []
            for n in self._qth_names():
                try:
                    good.append(self.get_qth(n))
                except ApiError as exc:
                    if exc.status != 404:
                        skipped.append((f"{n}.json", exc))
            return sorted(good, key=lambda q: q.name), skipped

    def list_qth(self) -> list[Qth]:
        """QTH ที่ใช้ได้ทุกตัว (ข้ามไฟล์ที่เสีย ดู list_qth_checked)"""
        return self.list_qth_checked()[0]

    def put_qth(self, q: Qth) -> None:
        q = validate_qth(q)
        with self._lock:
            write_json_atomic(self._qth_path(q.name), asdict(q))

    def delete_qth(self, name: str) -> None:
        """404 ถ้าไม่มี, 409 IN_USE ถ้าเป็นสถานีสุดท้าย หรือมี module ใช้อยู่ (รวม module ที่ใช้สถานีตั้งต้นเมื่อ name คือสถานีตั้งต้น)
        ถ้าลบสถานีตั้งต้นที่ไม่มี module ใช้จะย้ายสถานีตั้งต้นไปที่ชื่อแรกที่เหลือ"""
        with self._lock:
            path = self._qth_path(name)
            if not path.is_file():
                raise _not_found(name)
            remaining = [n for n in self._qth_names() if n != name]
            if not remaining:
                raise ApiError("IN_USE", 409, f"ลบ QTH {name} ไม่ได้ เพราะเป็นสถานีสุดท้าย", name)
            users = self.modules_using_qth(name)
            if users:
                raise ApiError("IN_USE", 409, f"ลบ QTH {name} ไม่ได้ เพราะ module เหล่านี้ใช้อยู่: {', '.join(users)}", name)
            if self._stored_default() == name:
                self._write_default(remaining[0])
            path.unlink()

    # ---------- สถานีตั้งต้น ----------

    def _read_settings(self) -> dict:
        """settings.json ที่หายหรืออ่านไม่ได้ถือเป็นว่าง (มีแค่ตัวชี้สถานีตั้งต้น เขียนใหม่ได้)"""
        try:
            data = json.loads((self.data_dir / SETTINGS_FILE).read_text(encoding="utf-8"))
        except (FileNotFoundError, ValueError):            # ValueError: JSONDecodeError และ UnicodeDecodeError
            return {}
        return data if isinstance(data, dict) else {}

    def _stored_default(self) -> str | None:
        name = self._read_settings().get("default_qth")
        return name if isinstance(name, str) else None

    def _write_default(self, name: str) -> None:
        settings = self._read_settings()
        settings["default_qth"] = name
        write_json_atomic(self.data_dir / SETTINGS_FILE, settings)

    def bootstrap_done(self) -> bool:
        """module Amateur ถูกสร้างแล้ว (bootstrap_done: true ใน settings.json) ผู้ใช้ลบ module หมดก็ไม่สร้างกลับมา"""
        with self._lock:
            return self._read_settings().get("bootstrap_done") is True

    def set_bootstrap_done(self) -> None:
        with self._lock:
            settings = self._read_settings()
            settings["bootstrap_done"] = True
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

    # ---------- module ----------

    @property
    def _module_dir(self) -> Path:
        return self.data_dir / MODULES_DIR

    def _module_path(self, name: str) -> Path:
        """path ของ module ชื่อที่ผ่าน NAME_RE เท่านั้น (ชื่ออื่นเป็น 404 และไม่หลุดออกนอกโฟลเดอร์)"""
        if not (isinstance(name, str) and NAME_RE.fullmatch(name)):
            raise _module_not_found(str(name))
        return self._module_dir / f"{name}.json"

    def _module_names(self) -> list[str]:
        if not self._module_dir.is_dir():
            return []
        return sorted(p.stem for p in self._module_dir.glob("*.json") if NAME_RE.fullmatch(p.stem))

    def list_modules(self) -> list[str]:
        with self._lock:
            return self._module_names()

    def get_module(self, name: str) -> ModuleConfig:
        """อ่านและตรวจรูปแบบ module (ไม่ตรวจว่า QTH หรือ NORAD ยังมีอยู่ เพราะ store ไม่รู้จักดัชนีดาว) 404 ถ้าไม่มี, 422 ถ้าไฟล์เสีย"""
        path = self._module_path(name)
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            raise _module_not_found(name) from None
        except ValueError:                     # JSONDecodeError และ UnicodeDecodeError
            raise ApiError("MODULE_INVALID", 422, f"ไฟล์ module ของ {name} อ่านไม่ได้ (ไม่ใช่ JSON ที่ถูกต้อง)", name) from None
        m = module_from_dict(data, None, None)
        if m.name != name:
            raise ApiError("MODULE_INVALID", 422, f"ไฟล์ module {name} มีชื่อข้างในเป็น {m.name}", name)
        return m

    def put_module(self, m: ModuleConfig) -> None:
        """สร้างหรือแทนที่ module ตรวจรูปแบบและว่า QTH มีอยู่ (ภายใต้ lock เดียวกับ delete_qth)
        การตรวจว่า NORAD อยู่ในดัชนีดาวเป็นหน้าที่ของผู้เรียก (module_from_dict ... norads)"""
        m = module_from_dict(module_to_dict(m), None, None)
        with self._lock:
            if m.qth is not None and m.qth not in self._qth_names():
                raise ApiError("MODULE_INVALID", 422, f"ไม่พบ QTH ชื่อ {m.qth} (qth)", "qth")
            write_json_atomic(self._module_path(m.name), module_to_dict(m))

    def delete_module(self, name: str) -> None:
        """404 ถ้าไม่มี ลบแล้วเอาออกจาก session ด้วย"""
        with self._lock:
            path = self._module_path(name)
            if not path.is_file():
                raise _module_not_found(name)
            path.unlink()
            stored = self._stored_session()
            if name in stored:
                self._write_session([n for n in stored if n != name])

    def _module_qth_ref(self, name: str):
        """ช่อง qth ดิบของ module (None = สถานีตั้งต้น) อ่านจาก JSON ตรงๆ เพื่อให้ module ที่ช่องอื่นเสียก็ยังนับว่าใช้ QTH นี้อยู่"""
        try:
            data = json.loads(self._module_path(name).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return _UNREADABLE
        if not isinstance(data, dict):
            return _UNREADABLE
        qth = data.get("qth")
        return qth if qth is None or isinstance(qth, str) else _UNREADABLE

    def modules_using_qth(self, name: str) -> list[str]:
        """ชื่อ module (เรียงตามชื่อ) ที่ใช้ QTH นี้ module ที่ qth เป็น None ใช้สถานีตั้งต้น จึงนับเมื่อ name คือสถานีตั้งต้น"""
        with self._lock:
            default = self.default_qth()
            users = []
            for n in self._module_names():
                ref = self._module_qth_ref(n)
                if ref is not _UNREADABLE and (ref == name or (ref is None and default == name)):
                    users.append(n)
            return users

    # ---------- session ----------

    def _stored_session(self) -> list[str]:
        """ชื่อใน session.json ตามลำดับ ข้ามค่าที่ไม่ใช่ชื่อที่ถูกต้องหรือซ้ำ ไฟล์หายหรืออ่านไม่ได้ถือเป็นว่าง"""
        try:
            data = json.loads((self.data_dir / SESSION_FILE).read_text(encoding="utf-8"))
        except (FileNotFoundError, ValueError):
            return []
        names = data.get("modules") if isinstance(data, dict) else None
        if not isinstance(names, list):
            return []
        out = []
        for n in names:
            if isinstance(n, str) and NAME_RE.fullmatch(n) and n not in out:
                out.append(n)
        return out

    def _write_session(self, names: list[str]) -> None:
        write_json_atomic(self.data_dir / SESSION_FILE, {"modules": names})

    def session(self) -> list[str]:
        """module ที่เปิดค้างตามลำดับแท็บ (เฉพาะที่ยังมีไฟล์)"""
        with self._lock:
            return [n for n in self._stored_session() if self._module_path(n).is_file()]

    def set_session(self, names: list[str]) -> None:
        """422 MODULE_INVALID ถ้าไม่ใช่รายการชื่อที่ไม่ซ้ำ, 404 ถ้ามีชื่อที่ไม่ใช่ module ที่มีอยู่"""
        if not isinstance(names, list) or not all(isinstance(n, str) for n in names) or len(set(names)) != len(names):
            raise ApiError("MODULE_INVALID", 422, "ลำดับแท็บ (session) ต้องเป็นรายการชื่อ module ที่ไม่ซ้ำกัน", "session")
        with self._lock:
            for n in names:
                if not self._module_path(n).is_file():
                    raise _module_not_found(n)
            self._write_session(list(names))
