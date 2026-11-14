"""ที่เก็บข้อมูลบนดิสก์: QTH ที่ data/qth/<name>.json, สถานีตั้งต้นและธง bootstrap_done ที่ data/settings.json,
module ที่ data/modules/<name>.json และ session (module ที่เปิดค้างตามลำดับแท็บ) ที่ data/session.json (หัวข้อ 7.1 ของ spec)

ทุกไฟล์เขียนลงไฟล์ชั่วคราวในโฟลเดอร์เดียวกันแล้ว rename ทับ จึงไม่มีไฟล์ที่เขียนค้างครึ่งเดียว

ไฟล์ module แบบ version 2 (spec งานย่อย 4 §9.1) เก็บเฉพาะค่าที่ module ตั้งเอง ค่าที่ใช้จริงประกอบตอนอ่านตามลำดับ
ค่าของ module → ค่ารวม (globals_ ที่ผู้สร้าง Store ส่งมา คือ Prefs.values: ไฟล์นี้ import prefs.py ไม่ได้) → ค่าตั้งต้นของ Gpredict
ไฟล์เต็มแบบ core (ไม่มี "version": 2) อ่านได้ด้วยกติกาเดียวกัน (path ที่ไม่มีในไฟล์สืบทอด) และถูกย้ายครั้งเดียวตอนเปิด server
"""

import dataclasses
import json
import logging
import math
import os
import threading
import uuid
from collections.abc import Callable, Iterable, Mapping
from dataclasses import asdict, dataclass, replace
from pathlib import Path

from .config import NAME_RE
from .errors import ApiError
from .module import (MODULE_KEYS, OWN_VERSION, ModuleConfig, effective_dict, get_path, module_from_dict, module_to_dict,
                     own_dict, strip_defaults)

SETTINGS_FILE = "settings.json"
SESSION_FILE = "session.json"
QTH_DIR = "qth"
MODULES_DIR = "modules"
BACKUP_V1_DIR = "_backup_v1"          # สำเนาไฟล์ module แบบ core ก่อนย้าย: data/modules/_backup_v1/<name>.json (ของเรา)

DESCRIPTION_MAX = 256
LOCATION_MAX = 50
WEATHER_STATION_MAX = 4
LAT_MAX, LON_MAX = 90.0, 180.0
ALT_MIN_M, ALT_MAX_M = 0.0, 5000.0                    # ขอบเขตของ Gpredict

_log = logging.getLogger(__name__)


def _write_bytes_atomic(path: Path, data: bytes) -> None:
    """เขียนลงไฟล์ชั่วคราวข้างๆ แล้ว rename ทับ ถ้าล้มไฟล์เดิมยังอยู่และไม่มีไฟล์ชั่วคราวค้าง"""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        with open(tmp, "xb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise


def write_json_atomic(path: Path, obj) -> None:
    """เขียน JSON (UTF-8 ไม่ escape ภาษาไทย) แบบ _write_bytes_atomic (obj ที่แปลงเป็น JSON ไม่ได้ล้มก่อนสร้างไฟล์ใดๆ)"""
    _write_bytes_atomic(path, (json.dumps(obj, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))


def _gpredict_globals() -> dict[str, object]:
    """ค่ารวมเมื่อไม่มี Preferences: ค่าตั้งต้นของ Gpredict ทุก key ใน MODULE_KEYS (module ได้ค่าเหมือน core)"""
    base = module_to_dict(ModuleConfig(name=""))
    return {key: get_path(base, path) for path, key in MODULE_KEYS.items()}


class _NotMigrated(Exception):
    """ไฟล์ module แบบ core ที่ย้ายไม่ได้ (เหตุผลภาษาไทย) ไฟล์คงเดิมและยังอ่านได้แบบเดิม"""


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
    def __init__(self, data_dir: Path, globals_: Callable[[], Mapping[str, object]] | None = None):
        """globals_: คืนค่ารวมปัจจุบัน {key ของ Gpredict: ค่า} ทุกครั้งที่ประกอบ module (None = ค่าตั้งต้นของ Gpredict แบบ core)"""
        self.data_dir = Path(data_dir)
        self._globals = globals_ if globals_ is not None else _gpredict_globals
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

    def replace_qth(self, stations: list[Qth], default: str, dry_run: bool = False) -> list[str]:
        """แทนทั้งชุดสถานีและสถานีตั้งต้นในครั้งเดียวแบบ OK ของ Preferences → Ground Stations (spec งานย่อย 4 §4) คืนชื่อ module
        (เรียงตามชื่อ) ที่ถูกเปลี่ยนเป็น ** DEFAULT ** เพราะสถานีของมันหายไป
        - ตรวจทุกอย่างก่อนแตะดิสก์: ว่าง -> 422 QTH_LAST, สถานีผิดช่องใด/ชื่อซ้ำ (ไม่สนตัวพิมพ์) หรือ default ไม่ใช่ชื่อในรายการ
          (เทียบชื่อเต็มตรงตัว) -> 422 QTH_INVALID dry_run=True ตรวจเหมือนกันและคืนรายการเดียวกันแต่ไม่เขียน ไม่ลบ ไม่ log
        - ลำดับเขียน: สถานีทุกตัว -> สถานีตั้งต้น -> module ที่ใช้สถานีที่หาย (qth = None แล้ว log ERROR) -> ลบไฟล์สถานีที่ไม่อยู่ในรายการ
          ไฟล์สถานีที่หายถูกลบหลังสุด ดิสก์ล้มกลางทางจึงไม่มี module หรือสถานีตั้งต้นที่ชี้ไฟล์ที่ไม่มี
        - module ที่ช่องอื่นผิดก็เปลี่ยนเป็น ** DEFAULT ** (แก้เฉพาะ qth ในไฟล์) ไม่งั้น OK ของ Preferences จะค้างเพราะไฟล์ module เสีย
          ไฟล์ที่ไม่ใช่ JSON object ไม่ถูกแตะ (modules_using_qth ก็ไม่นับ)
        - ไม่แตะ runtime ที่เปิดอยู่: ผู้เรียกไม่ hub.reload module ที่เปิดอยู่ใช้สถานีเดิมจนกว่าจะถูกสร้างใหม่ (spec §4.2 เหมือน Gpredict)"""
        if not stations:
            raise ApiError("QTH_LAST", 422, "ลบสถานีทั้งหมดไม่ได้ ต้องมีสถานีอย่างน้อย 1 สถานี", "stations")
        new = [validate_qth(q) for q in stations]
        seen: dict[str, str] = {}
        for q in new:
            if q.name.casefold() in seen:
                raise _invalid("name", f"ชื่อสถานี {q.name} ซ้ำกับ {seen[q.name.casefold()]} "
                                       "ชื่อที่ต่างกันแค่ตัวพิมพ์เล็ก-ใหญ่ใช้ด้วยกันไม่ได้ (ดิสก์ของ macOS ไม่แยกตัวพิมพ์)")
            seen[q.name.casefold()] = q.name
        names = {q.name for q in new}
        if not isinstance(default, str) or default not in names:
            raise _invalid("default", "สถานีตั้งต้น (default) ต้องเป็นชื่อหนึ่งในรายการสถานี")
        with self._lock:
            gone = set(self._qth_names()) - names
            users: dict[str, str] = {}                           # module ที่ใช้สถานีที่หาย -> ชื่อสถานีนั้น
            for n in self._module_names():
                ref = self._module_qth_ref(n)
                if isinstance(ref, str) and ref in gone:
                    users[n] = ref
            if dry_run:
                return list(users)
            for q in new:
                write_json_atomic(self._qth_path(q.name), asdict(q))
            self._write_default(default)
            for module, station in users.items():
                self._use_default_qth(module)
                # (ของเรา) Gpredict log ERROR ตอนสร้าง module ที่ใช้สถานีที่หาย แต่ module ที่เปิดอยู่ไม่ถูกสร้างใหม่ตอนกด OK จึง log ตอนลบ
                _log.error("module %s ใช้สถานี %s ที่ถูกลบ จึงเปลี่ยนเป็น ** DEFAULT ** และบันทึกไฟล์ module แล้ว", module, station)
            self._remove_stale_qth(names)
            return list(users)

    def _use_default_qth(self, name: str) -> None:
        """qth ของ module เป็น None (** DEFAULT **) ค่าอื่นของไฟล์คงเดิม ผ่าน put_module_own (ตรวจค่าในไฟล์และค่าที่ใช้จริงก่อนเขียน)
        ไฟล์ที่ผิดช่องอื่นแก้ qth ในเนื้อไฟล์ตรงๆ (เหมือน Gpredict ที่ลบ key QTHFILE โดยไม่ตรวจช่องอื่น)"""
        try:
            own = self.get_module_own(name)
        except ApiError:
            write_json_atomic(self._module_path(name), {**self._read_module(name), "qth": None})
        else:
            self.put_module_own(name, {**own, "qth": None})

    def _remove_stale_qth(self, keep: set[str]) -> None:
        """ลบไฟล์สถานีที่ชื่อไม่อยู่ใน keep ดิสก์ที่ไม่แยกตัวพิมพ์ (macOS) เขียน "ABC" ทับไฟล์ "abc" แล้วไฟล์ยังชื่อ "abc.json":
        ไฟล์นั้นคือสถานีใหม่ ไม่ลบ แต่เปลี่ยนชื่อให้ตรงตัวพิมพ์ (ดิสก์ที่แยกตัวพิมพ์มีสองไฟล์ ลบ abc.json ตามปกติ)"""
        by_fold = {n.casefold(): n for n in keep}
        for n in self._qth_names():
            if n in keep:
                continue
            path, right = self._qth_path(n), self._qth_path(by_fold.get(n.casefold(), n))
            if right != path and right.exists() and path.samefile(right):
                os.replace(path, right)
            else:
                path.unlink(missing_ok=True)

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

    @staticmethod
    def _parse_module(name: str, raw: bytes) -> dict:
        """JSON object ของไฟล์ module ไม่งั้น 422 MODULE_INVALID (object = ชื่อ module)"""
        try:
            data = json.loads(raw.decode("utf-8"))
        except ValueError:                     # JSONDecodeError และ UnicodeDecodeError
            raise ApiError("MODULE_INVALID", 422, f"ไฟล์ module ของ {name} อ่านไม่ได้ (ไม่ใช่ JSON ที่ถูกต้อง)", name) from None
        if not isinstance(data, dict):
            raise ApiError("MODULE_INVALID", 422, f"ไฟล์ module ของ {name} ต้องเป็น JSON object", name)
        return data

    def _read_module(self, name: str) -> dict:
        """เนื้อไฟล์ module (version 2 หรือแบบ core) 404 ถ้าไม่มี 422 ถ้าอ่านไม่ได้"""
        try:
            raw = self._module_path(name).read_bytes()
        except FileNotFoundError:
            raise _module_not_found(name) from None
        return self._parse_module(name, raw)

    @staticmethod
    def _effective(name: str, own: dict, globals_: Mapping[str, object]) -> ModuleConfig:
        """ค่าที่ใช้จริงของเนื้อไฟล์ own ตรวจสองชั้น: ทุกช่องที่ไฟล์ตั้งไว้ต้องถูก (section ที่เสียไม่ถูกข้ามเงียบๆ เหมือน core)
        แล้วค่าที่ประกอบกับค่ารวมต้องเป็น module ที่ถูก ผิด -> 422 MODULE_INVALID"""
        module_from_dict(own, None, None)
        m = module_from_dict(effective_dict(own, globals_), None, None)
        if m.name != name:
            raise ApiError("MODULE_INVALID", 422, f"ไฟล์ module {name} มีชื่อข้างในเป็น {m.name}", name)
        return m

    @staticmethod
    def _own_of(data: dict, globals_: Mapping[str, object]) -> dict:
        """ค่าที่ตั้งเองในรูปของ version 2: ไฟล์แบบ core ลบค่าที่เท่าค่ารวมตอนนี้ (สิ่งที่ migrate_modules จะเขียน)"""
        return data if data.get("version") == OWN_VERSION else strip_defaults(data, globals_)

    def get_module(self, name: str) -> ModuleConfig:
        """ค่าที่ module ใช้จริง: ค่าในไฟล์ → ค่ารวมตอนนี้ → ค่าตั้งต้นของ Gpredict (ไม่ตรวจว่า QTH หรือ NORAD ยังมีอยู่
        เพราะ store ไม่รู้จักดัชนีดาว) 404 ถ้าไม่มี, 422 ถ้าไฟล์เสีย"""
        return self._effective(name, self._read_module(name), self._globals())

    def get_module_own(self, name: str) -> dict:
        """ค่าที่ module ตั้งเอง (เนื้อไฟล์ version 2) ไฟล์แบบ core ที่ยังไม่ย้ายคืนรูปที่จะย้ายเป็น (ไม่เขียน) ตรวจเหมือน get_module"""
        data, g = self._read_module(name), self._globals()
        self._effective(name, data, g)
        return self._own_of(data, g)

    def _old_own(self, name: str, globals_: Mapping[str, object]) -> dict | None:
        """ค่าที่ตั้งเองของไฟล์เดิมให้ own_dict: ไม่มีไฟล์ อ่านไม่ได้ หรือค่าผิด = None (เขียนแทนเหมือน module ใหม่ เหมือน core)"""
        try:
            data = self._read_module(name)
            self._effective(name, data, globals_)
        except ApiError:
            return None
        return self._own_of(data, globals_)

    def _write_own(self, name: str, own: dict, globals_: Mapping[str, object]) -> None:
        """ตรวจค่าในไฟล์ ค่าที่ใช้จริง และว่า QTH มีอยู่ แล้วเขียน (ผู้เรียกถือ lock เดียวกับ delete_qth)"""
        m = self._effective(name, own, globals_)
        if m.qth is not None and m.qth not in self._qth_names():
            raise ApiError("MODULE_INVALID", 422, f"ไม่พบ QTH ชื่อ {m.qth} (qth)", "qth")
        write_json_atomic(self._module_path(name), own)

    def put_module(self, m: ModuleConfig, pin: Iterable[str] = (), unpin: Iterable[str] = ()) -> None:
        """สร้างหรือแทนที่ module ด้วยค่าเต็ม m (decision 3 ของแผนงานย่อย 4, own_dict):
        ช่องของ module อย่างเดียวเก็บเสมอ (ยกเว้น window ที่คงของไฟล์เดิม) ค่าที่สืบทอดได้เก็บเฉพาะ path ใน pin หรือที่ไฟล์ตั้งไว้แล้ว
        นอกนั้นข้าม (ยังสืบทอด) path ใน unpin กลับไปสืบทอด pin/unpin ผิด -> 422 MODULE_INVALID ไม่เขียนอะไร
        การตรวจว่า NORAD อยู่ในดัชนีดาวเป็นหน้าที่ของผู้เรียก (module_from_dict ... norads)"""
        body = module_to_dict(module_from_dict(module_to_dict(m), None, None))
        with self._lock:
            g = self._globals()
            self._write_own(m.name, own_dict(body, self._old_own(m.name, g), pin, unpin), g)

    def put_module_own(self, name: str, own: dict) -> None:
        """เขียนค่าที่ตั้งเอง (เนื้อไฟล์ version 2 แบบที่ get_module_own คืน) ตรงๆ หลังตรวจค่าในไฟล์ ค่าที่ใช้จริง และว่า QTH มีอยู่"""
        if not isinstance(own, dict):
            raise ApiError("MODULE_INVALID", 422, "ข้อมูล module ต้องเป็น JSON object")
        if own.get("name") != name:
            raise ApiError("MODULE_INVALID", 422, f"ชื่อ module (name) ต้องเป็น {name}", "name")
        own = {"version": OWN_VERSION, **{k: v for k, v in own.items() if k != "version"}}
        with self._lock:
            self._write_own(name, own, self._globals())

    def migrate_modules(self) -> list[str]:
        """ย้ายไฟล์ module ที่ไม่มี "version": 2 (ไฟล์เต็มแบบ core) เป็นแบบเก็บเฉพาะค่าที่ตั้งเอง ทำตอนเปิด server คืนชื่อที่ย้าย
        - ลบค่าที่เท่ากับค่ารวมที่ใช้อยู่ตอนนี้ (strip_defaults กับ globals_()) path ที่ไม่มีในไฟล์เดิมสืบทอดต่อ ค่าที่ใช้จริงจึงไม่เปลี่ยน
          (ตรวจซ้ำก่อนเขียน ไม่เท่าเดิมไม่ย้าย)
        - สำเนาไฟล์เดิมทุกไบต์ไว้ที่ _backup_v1/<name>.json ก่อนเขียน ไม่ทับสำเนาที่มีอยู่: สำเนาที่มีต่างจากไฟล์นี้ = ไม่ย้ายไฟล์นี้
        - ไฟล์ที่อ่านไม่ได้หรือค่าผิดไม่ถูกแตะ (log WARNING ทีละไฟล์) เปิด server ต่อได้ เรียกซ้ำไม่ย้ายซ้ำ"""
        migrated = []
        with self._lock:
            g = self._globals()
            for name in self._module_names():
                try:
                    if self._migrate_one(name, g):
                        migrated.append(name)
                except ApiError as exc:
                    _log.warning("ไม่ย้ายไฟล์ module %s (คงไฟล์เดิม): %s", name, exc.text)
                except (_NotMigrated, OSError) as exc:
                    _log.warning("ไม่ย้ายไฟล์ module %s (คงไฟล์เดิม): %s", name, exc)
                except Exception:
                    _log.exception("ย้ายไฟล์ module %s ไม่สำเร็จ (คงไฟล์เดิม)", name)
        return migrated

    def _migrate_one(self, name: str, globals_: Mapping[str, object]) -> bool:
        """True = ย้ายแล้ว, False = เป็น version 2 อยู่แล้ว ย้ายไม่ได้ raise (ApiError, _NotMigrated, OSError) โดยไม่แตะไฟล์"""
        path = self._module_path(name)
        raw = path.read_bytes()
        data = self._parse_module(name, raw)
        if data.get("version") == OWN_VERSION:
            return False
        before = self._effective(name, data, globals_)
        own = strip_defaults(data, globals_)
        if self._effective(name, own, globals_) != before:
            raise _NotMigrated("ค่าที่ใช้จริงหลังย้ายไม่เท่าเดิม")
        backup = self._module_dir / BACKUP_V1_DIR / path.name
        if not backup.exists():
            _write_bytes_atomic(backup, raw)
        elif backup.read_bytes() != raw:
            raise _NotMigrated(f"มีสำเนาเดิมที่ {backup} ซึ่งต่างจากไฟล์นี้อยู่แล้ว (ไม่ทับสำเนา)")
        write_json_atomic(path, own)
        return True

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
