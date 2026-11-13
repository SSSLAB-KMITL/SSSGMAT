"""ค่าของวิทยุและ rotator (หัวข้อ 6.2 และ 9.1 ของ spec งานย่อย 3, ref-R §8 และ §9): ชนิด ช่วง และค่าตั้งต้นของทุก key อยู่ในตาราง
RADIO_FIELDS และ ROTATOR_FIELDS ที่เดียว ทั้งไฟล์และ API ใช้ key ของ Gpredict (Host, Port, Cycle, LO, ...) บวก "name"

- วิทยุเก็บที่ data/hwconf/<name>.rig.json และ rotator ที่ <name>.rot.json (ไม่มี key "name" ในไฟล์ ชื่อคือชื่อไฟล์) เขียนผ่านไฟล์ชั่วคราวแล้ว rename
  Cycle ไม่เขียนเมื่อ 1000, Threshold ไม่เขียนเมื่อ 5.0, VFO_UP/VFO_DOWN เขียนเฉพาะวิทยุ Type 3 (Full-duplex) เหมือน Gpredict
- ตรวจค่าตามช่วงของ editor ผิดช่องไหนตอบ 422 HWCONF_INVALID ที่ object = ชื่อ key (ชื่อ = "name") ข้อความไทยมีป้ายของ editor กับช่วงที่รับ
- อ่านไฟล์ตามกติกาของ Gpredict: Cycle < 10 เป็น 10, Threshold < 0.1 เป็น 0.1, ไม่มี AzStopPos ใช้ MinAz ฯลฯ (ใส่ค่าแล้ว log INFO)
  ไฟล์ที่อ่านไม่ได้ (ไม่ใช่ JSON, ไม่มี Host/Port/Type/PTT, ค่าเกินช่วง, ชื่อผิดรูป) ถูกข้ามพร้อม log WARNING ไม่แก้และไม่ลบไฟล์
- อ่านจากดิสก์ทุกครั้ง (แก้ไฟล์ด้วยมือแล้วเห็นทันที) แต่จำผลที่แยกแล้วต่อไฟล์ไว้ตาม (mtime, ขนาด) controller จึงเรียกทุกรอบได้
  โดยไม่แยกซ้ำและไฟล์พังไม่ log ซ้ำทุกรอบ
- replace (Preferences → OK) แทนทั้งชุด: ตรวจทุกตัวก่อน เขียนทุกไฟล์ แล้วลบไฟล์ที่ไม่อยู่ในชุด Cycle กับ Threshold ใน dict ถูกละ
  ใช้ค่าในไฟล์เดิมของชื่อเดียวกัน (แก้ข้อบกพร่อง ref-R §13 ข้อ 1: OK ของ Gpredict ล้างสองค่านี้) ผู้เปลี่ยนค่าคือหน้าต่างควบคุมผ่าน save_*
"""

import dataclasses
import json
import logging
import os
import threading
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from .config import NAME_RE
from .errors import ApiError
from .store import write_json_atomic

HWCONF_DIR = "hwconf"
RIG_SUFFIX = ".rig.json"
ROT_SUFFIX = ".rot.json"

RIG_TYPES = ("RX only", "TX only", "Half-duplex", "Full-duplex", "FT817/857/897 (auto)", "FT817/857/897 (manual)")
PTT_TYPES = ("None", "Read PTT", "Read DCD")
VFO_NAMES = {1: "VFOA", 2: "VFOB", 3: "Main", 4: "Sub"}             # ชื่อ VFO ของ hamlib ตามเลข VFO_UP / VFO_DOWN
FULL_DUPLEX = 3                                                     # Type ที่มี VFO_UP / VFO_DOWN

CYCLE_MS = (10, 30000)
CYCLE_DEFAULT_MS = 1000
THRESHOLD_DEG = (0.01, 50.0)
THRESHOLD_DEFAULT_DEG = 5.0
THRESHOLD_READ_MIN_DEG = 0.1                                        # อ่านไฟล์แล้วน้อยกว่านี้ถูกยกขึ้น (ref-R §9.2)
FREQ_LIMIT_HZ = 10_000_000_000.0                                    # spin ของ editor: LO ±10000 MHz, ความถี่ 0–10000 MHz
DEFAULT_FREQ_HZ = 145_890_000.0
_MISSING = object()

_log = logging.getLogger(__name__)


@dataclass(frozen=True)
class RadioConf:
    name: str
    host: str
    port: int
    cycle: int = CYCLE_DEFAULT_MS
    lo: float = 0.0
    lo_up: float = 0.0
    default_up: float = DEFAULT_FREQ_HZ
    default_down: float = DEFAULT_FREQ_HZ
    type: int = 0
    ptt: int = 0
    vfo_up: int = 0
    vfo_down: int = 0
    signal_aos: bool = False
    signal_los: bool = False
    signal_aoiq: bool = False
    signal_loiq: bool = False


@dataclass(frozen=True)
class RotConf:
    name: str
    host: str
    port: int
    cycle: int = CYCLE_DEFAULT_MS
    threshold: float = THRESHOLD_DEFAULT_DEG
    az_type: int = 0
    min_az: float = 0.0
    max_az: float = 360.0
    min_el: float = 0.0
    max_el: float = 90.0
    az_stop: float = 0.0


# ---------------------------------------------------------------- ตารางช่อง

@dataclass(frozen=True)
class _Field:
    """kind: "str" (ความยาว lo–hi), "int" (ไม่รับ bool), "num" (int หรือ float ไม่รับ bool), "bool" (ไม่รับ 0/1)
    default: ค่าที่ใช้เมื่อไม่มี key, _MISSING = ขาดไม่ได้, ฟังก์ชัน = คำนวณจากช่องที่แยกแล้ว
    scale และ unit: หน่วยที่ editor แสดงในข้อความ error (ค่าเก็บเป็น Hz แต่ editor เป็น MHz)
    full_duplex: มีเฉพาะวิทยุ Type 3"""
    key: str
    attr: str
    label: str
    kind: str
    lo: float | None = None
    hi: float | None = None
    default: object = _MISSING
    scale: float = 1.0
    unit: str = ""
    full_duplex: bool = False


_CYCLE = _Field("Cycle", "cycle", "Cycle", "int", *CYCLE_MS, CYCLE_DEFAULT_MS, unit=" มิลลิวินาที")
_THRESHOLD = _Field("Threshold", "threshold", "Threshold", "num", *THRESHOLD_DEG, THRESHOLD_DEFAULT_DEG, unit=" องศา")

# ป้ายและช่วงตาม editor ของ Gpredict (ref-R §8.2 และ §8.4)
RADIO_FIELDS = (
    _Field("Host", "host", "Host", "str", 1, 50),
    _Field("Port", "port", "Port", "int", 1024, 65535),
    _CYCLE,
    _Field("LO", "lo", "LO Down", "num", -FREQ_LIMIT_HZ, FREQ_LIMIT_HZ, 0.0, scale=1e6, unit=" MHz"),
    _Field("LO_UP", "lo_up", "LO Up", "num", -FREQ_LIMIT_HZ, FREQ_LIMIT_HZ, 0.0, scale=1e6, unit=" MHz"),
    _Field("DefaultUplinkFreqHz", "default_up", "Default uplink", "num", 0.0, FREQ_LIMIT_HZ, DEFAULT_FREQ_HZ,
           scale=1e6, unit=" MHz"),
    _Field("DefaultDownlinkFreqHz", "default_down", "Default downlink", "num", 0.0, FREQ_LIMIT_HZ, DEFAULT_FREQ_HZ,
           scale=1e6, unit=" MHz"),
    _Field("Type", "type", "Radio type", "int", 0, len(RIG_TYPES) - 1),
    _Field("PTT", "ptt", "PTT status", "int", 0, len(PTT_TYPES) - 1),
    _Field("VFO_UP", "vfo_up", "VFO Up", "int", 1, len(VFO_NAMES), full_duplex=True),
    _Field("VFO_DOWN", "vfo_down", "VFO Down", "int", 1, len(VFO_NAMES), full_duplex=True),
    _Field("SIGNAL_AOS", "signal_aos", "Signalling AOS", "bool", default=False),
    _Field("SIGNAL_LOS", "signal_los", "Signalling LOS", "bool", default=False),
    _Field("SIGNAL_AOIQ", "signal_aoiq", "Signalling AOIQ", "bool", default=False),
    _Field("SIGNAL_LOIQ", "signal_loiq", "Signalling LOIQ", "bool", default=False),
)

ROTATOR_FIELDS = (
    _Field("Host", "host", "Host", "str", 1, 50),
    _Field("Port", "port", "Port", "int", 1024, 65535),
    _CYCLE,
    _THRESHOLD,
    _Field("AzType", "az_type", "Az type", "int", 0, 1, 0),
    _Field("MinAz", "min_az", "Min Az", "num", -200.0, 100.0, 0.0, unit=" องศา"),
    _Field("MaxAz", "max_az", "Max Az", "num", 0.0, 450.0, 360.0, unit=" องศา"),
    _Field("MinEl", "min_el", "Min El", "num", -10.0, 180.0, 0.0, unit=" องศา"),
    _Field("MaxEl", "max_el", "Max El", "num", -10.0, 180.0, 90.0, unit=" องศา"),
    _Field("AzStopPos", "az_stop", "Azimuth end stop position", "num", -180.0, 360.0, lambda kw: kw["min_az"],
           unit=" องศา"),
)


def _invalid(key: str, text: str) -> ApiError:
    return ApiError("HWCONF_INVALID", 422, text, key)


def _range(f: _Field) -> str:
    lo, hi = f.lo / f.scale, f.hi / f.scale
    if f.kind == "str":
        return f"ต้องเป็นข้อความยาว {lo:g}–{hi:g} ตัวอักษร"
    if f.kind == "int":
        return f"ต้องเป็นจำนวนเต็ม {lo:g}–{hi:g}{f.unit}"
    return f"ต้องเป็นตัวเลขระหว่าง {lo:g} ถึง {hi:g}{f.unit}"


def _parse(f: _Field, d: dict, parsed: dict):
    """ค่าของช่อง f ใน d (ใช้ค่าตั้งต้นเมื่อไม่มี key) หรือ raise 422 HWCONF_INVALID ที่ object = f.key"""
    if f.key in d:
        v = d[f.key]
    else:
        v = f.default(parsed) if callable(f.default) else f.default
    if f.kind == "bool":
        ok, text = isinstance(v, bool), f"{f.label} ต้องเป็น true หรือ false"
    else:
        text = f"{f.label} {_range(f)}"
        if f.kind == "str":
            ok = isinstance(v, str) and f.lo <= len(v) <= f.hi
        elif isinstance(v, bool):
            ok = False
        elif f.kind == "int":
            ok = isinstance(v, int) and f.lo <= v <= f.hi
        else:                                       # ช่วงจำกัดทั้งสองด้าน nan, inf และ int ใหญ่เกินจึงตกที่การเทียบ ไม่ต้องเรียก isfinite
            ok = isinstance(v, (int, float)) and f.lo <= v <= f.hi
            v = float(v) if ok else v
    if not ok:
        raise _invalid(f.key, text)
    return v


def _from_dict(d, fields: tuple[_Field, ...], cls, label: str):
    if not isinstance(d, dict):
        raise ApiError("HWCONF_INVALID", 422, f"ข้อมูล {label} ต้องเป็น JSON object")
    name = d.get("name")
    if not (isinstance(name, str) and NAME_RE.fullmatch(name)):
        raise _invalid("name", "Name ต้องเป็นตัวอักษร A-Z, a-z, ตัวเลข, _ หรือ - ยาว 1-25 ตัว")
    parsed: dict = {}
    for f in fields:
        if f.full_duplex and parsed["type"] != FULL_DUPLEX:
            continue                                # วิทยุชนิดอื่นไม่เก็บและไม่ตรวจ VFO (ref-R §9.1)
        parsed[f.attr] = _parse(f, d, parsed)
    return cls(name=name, **parsed)


def radio_from_dict(d: dict) -> RadioConf:
    """RadioConf จาก dict ที่มี key ของ Gpredict บวก name ขาดได้เฉพาะ Cycle, LO, LO_UP, ความถี่ตั้งต้นและ SIGNAL_*"""
    return _from_dict(d, RADIO_FIELDS, RadioConf, "radio")


def rot_from_dict(d: dict) -> RotConf:
    """RotConf จาก dict ที่มี key ของ Gpredict บวก name ขาดได้ทุกช่องยกเว้น Host และ Port (AzStopPos ที่ขาด = MinAz)"""
    return _from_dict(d, ROTATOR_FIELDS, RotConf, "rotator")


def _to_dict(conf, fields: tuple[_Field, ...]) -> dict:
    d = {"name": conf.name}
    for f in fields:
        if not (f.full_duplex and conf.type != FULL_DUPLEX):
            d[f.key] = getattr(conf, f.attr)
    return d


def radio_to_dict(r: RadioConf) -> dict:
    """name แล้วทุก key ของ Gpredict ตามลำดับใน spec §6.2 (Cycle เสมอ, VFO_UP/VFO_DOWN เฉพาะ Type 3)"""
    return _to_dict(r, RADIO_FIELDS)


def rot_to_dict(r: RotConf) -> dict:
    return _to_dict(r, ROTATOR_FIELDS)


# ---------------------------------------------------------------- ชนิดไฟล์

def _is_number(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _clamp_read(raw: dict, key: str, lo, hi) -> None:
    if _is_number(raw.get(key)):
        raw[key] = min(max(raw[key], lo), hi)


def _radio_read_rules(raw: dict, name: str) -> None:
    """กติกาอ่านของ Gpredict (ref-R §9.1): Cycle < 10 เป็น 10 (เกินช่วงขวา: ตัดที่ 30000 เพราะหน้าต่างควบคุมรับไม่เกินนั้น)
    VFO ของ Type 3 ที่ขาดหรือผิด: Main สำหรับ up และ Sub สำหรับ down"""
    _clamp_read(raw, "Cycle", *CYCLE_MS)
    if raw.get("Type") == FULL_DUPLEX:
        for key, fallback in (("VFO_UP", 3), ("VFO_DOWN", 4)):
            v = raw.get(key)
            if isinstance(v, bool) or not isinstance(v, int) or not 1 <= v <= len(VFO_NAMES):
                raw[key] = fallback


def _rot_read_rules(raw: dict, name: str) -> None:
    """กติกาอ่านของ Gpredict (ref-R §9.2): Cycle < 10 เป็น 10, Threshold < 0.1 เป็น 0.1 (เกินช่วงขวาตัดที่ปลายช่วง) ช่องที่ขาดใส่ค่าตั้งต้นพร้อม log INFO"""
    _clamp_read(raw, "Cycle", *CYCLE_MS)
    _clamp_read(raw, "Threshold", THRESHOLD_READ_MIN_DEG, THRESHOLD_DEG[1])
    if "AzType" not in raw:
        _log.info("Az type not defined for %s. Assuming 0..360°", name)
        raw["AzType"] = 0
    for key, fallback in (("MinAz", 0), ("MaxAz", 360), ("MinEl", 0), ("MaxEl", 90)):
        if key not in raw:
            _log.info("%s not defined for %s. Assuming %d°", key, name, fallback)
            raw[key] = fallback
    if "AzStopPos" not in raw and _is_number(raw["MinAz"]):
        _log.info("AzStopPos not defined for %s. Assuming at minaz (%f°).", name, raw["MinAz"])


def _radio_file(r: RadioConf) -> dict:
    d = radio_to_dict(r)
    del d["name"]
    if d["Cycle"] == CYCLE_DEFAULT_MS:
        del d["Cycle"]
    return d


def _rot_file(r: RotConf) -> dict:
    d = rot_to_dict(r)
    del d["name"]
    if d["Cycle"] == CYCLE_DEFAULT_MS:
        del d["Cycle"]
    if d["Threshold"] == THRESHOLD_DEFAULT_DEG:
        del d["Threshold"]
    return d


@dataclass(frozen=True)
class _Kind:
    suffix: str
    label: str                                       # "radio" และ "rotator" (ใช้ใน log และข้อความ error)
    from_dict: Callable
    read_rules: Callable[[dict, str], None]
    file_dict: Callable


_RADIO = _Kind(RIG_SUFFIX, "radio", radio_from_dict, _radio_read_rules, _radio_file)
_ROTATOR = _Kind(ROT_SUFFIX, "rotator", rot_from_dict, _rot_read_rules, _rot_file)


def _reject_duplicates(confs: list, kind: _Kind) -> None:
    """(ของเรา) Gpredict ยอมให้ชื่อซ้ำแล้วตัวหลังทับตัวแรก (ref-R §8.1) เราปฏิเสธเพื่อไม่ให้ข้อมูลหาย
    เทียบแบบไม่แยกตัวพิมพ์เล็ก-ใหญ่ เพราะ macOS ถือว่า IC910.rig.json กับ ic910.rig.json เป็นไฟล์เดียวกัน"""
    first: dict[str, str] = {}
    for c in confs:
        key = c.name.casefold()
        if key in first:
            raise _invalid("name", f"ชื่อ {kind.label} {c.name} ซ้ำกับ {first[key]} (Name ต้องไม่ซ้ำกันและไม่แยกตัวพิมพ์เล็ก-ใหญ่)")
        first[key] = c.name


def _same_file(a: Path, b: Path) -> bool:
    try:
        return a.samefile(b)
    except OSError:
        return False


# ---------------------------------------------------------------- ที่เก็บ

class HwConf:
    """thread-safe: ทุกการอ่านและเขียนอยู่ใต้ lock เดียว (controller อ่านใน event loop, PUT /api/hwconf รันใน thread pool)"""

    def __init__(self, data_dir: Path):
        self._dir = Path(data_dir) / HWCONF_DIR
        self._lock = threading.RLock()
        self._parsed: dict[str, dict[Path, tuple[tuple[int, int], object]]] = {RIG_SUFFIX: {}, ROT_SUFFIX: {}}

    # ---------- อ่าน

    def _filenames(self, kind: _Kind) -> list[str]:
        """ชื่อไฟล์ชนิดนี้ตามลำดับของ os.scandir (ลำดับในไดเรกทอรีแบบ Gpredict) ไม่มีโฟลเดอร์ = ว่าง"""
        try:
            with os.scandir(self._dir) as entries:
                return [e.name for e in entries if e.name.endswith(kind.suffix)]
        except FileNotFoundError:
            return []

    def _read_file(self, kind: _Kind, path: Path):
        name = path.name.removesuffix(kind.suffix)
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(raw, dict):
                raise ValueError("ไม่ใช่ JSON object")
            raw["name"] = name
            kind.read_rules(raw, name)
            return kind.from_dict(raw)
        except (OSError, ValueError) as exc:        # ValueError: JSONDecodeError, UnicodeDecodeError และ int เกิน 4300 หลัก
            reason = exc
        except ApiError as exc:
            reason = exc.text
        _log.warning("Error reading %s conf from %s (%s).", kind.label, path, reason)
        return None

    def _confs(self, kind: _Kind) -> list:
        """ค่าที่อ่านได้ตามลำดับใน os.scandir ไฟล์ที่อ่านไม่ได้ถูกข้าม (log เมื่อแยกครั้งแรกหรือหลังไฟล์เปลี่ยน)"""
        with self._lock:
            before, now, confs = self._parsed[kind.suffix], {}, []
            for filename in self._filenames(kind):
                path = self._dir / filename
                try:
                    st = path.stat()
                except OSError:                     # ถูกลบระหว่างสแกน
                    continue
                sig = (st.st_mtime_ns, st.st_size)
                hit = before.get(path)
                conf = hit[1] if hit is not None and hit[0] == sig else self._read_file(kind, path)
                now[path] = (sig, conf)
                if conf is not None:
                    confs.append(conf)
            self._parsed[kind.suffix] = now
            return confs

    def radios(self) -> list[RadioConf]:
        """เรียงตามชื่อ (ตาราง Radios และ "1. Device")"""
        return sorted(self._confs(_RADIO), key=lambda c: c.name)

    def radios_dir_order(self) -> list[RadioConf]:
        """ตามลำดับของ os.scandir ("2. Device" เรียงตามลำดับไฟล์ ref-R §13 ข้อ 10)"""
        return self._confs(_RADIO)

    def radio(self, name: str) -> RadioConf | None:
        return next((c for c in self._confs(_RADIO) if c.name == name), None)

    def rotators(self) -> list[RotConf]:
        return sorted(self._confs(_ROTATOR), key=lambda c: c.name)

    def rotator(self, name: str) -> RotConf | None:
        return next((c for c in self._confs(_ROTATOR) if c.name == name), None)

    # ---------- เขียน

    def _write(self, kind: _Kind, conf) -> Path:
        path = self._dir / f"{conf.name}{kind.suffix}"
        write_json_atomic(path, kind.file_dict(conf))
        return path

    def _forget(self) -> None:
        """ทิ้งผลที่จำไว้หลังเขียน (ไม่พึ่งว่า mtime จะต่างจากครั้งก่อน)"""
        self._parsed = {RIG_SUFFIX: {}, ROT_SUFFIX: {}}

    def replace(self, radios: list[dict], rotators: list[dict]) -> None:
        """แทนทั้งชุด: ตรวจทุกตัวและชื่อซ้ำก่อน (ผิดตัวเดียว raise 422 HWCONF_INVALID และไม่แตะไฟล์ใดเลย) แล้วเขียนทุกไฟล์
        แล้วลบไฟล์ .rig.json/.rot.json ที่ชื่อไม่อยู่ในชุด (รวมไฟล์ที่พัง) Cycle และ Threshold ใน dict ถูกละเสมอ ใช้ค่าในไฟล์เดิมของชื่อเดียวกัน
        (อุปกรณ์ใหม่ได้ 1000 และ 5.0) เขียนไฟล์ไม่สำเร็จ: raise OSError"""
        new = [(_RADIO, [radio_from_dict(d) for d in radios]), (_ROTATOR, [rot_from_dict(d) for d in rotators])]
        for kind, confs in new:
            _reject_duplicates(confs, kind)
        with self._lock:
            try:
                written: list[Path] = []
                for kind, confs in new:
                    old = {c.name: c for c in self._confs(kind)}
                    for c in confs:
                        before = old.get(c.name)
                        keep = {"cycle": before.cycle if before else CYCLE_DEFAULT_MS}
                        if kind is _ROTATOR:
                            keep["threshold"] = before.threshold if before else THRESHOLD_DEFAULT_DEG
                        written.append(self._write(kind, dataclasses.replace(c, **keep)))
                for kind, confs in new:
                    names = {c.name for c in confs}
                    for filename in self._filenames(kind):
                        stem = filename.removesuffix(kind.suffix)
                        path = self._dir / filename
                        # ไฟล์เดียวกับที่เพิ่งเขียนไม่ลบ (macOS: Ic910 กับ ic910 เป็นไฟล์เดียวกัน)
                        if NAME_RE.fullmatch(stem) and stem not in names and not any(_same_file(path, w) for w in written):
                            path.unlink(missing_ok=True)
            finally:
                self._forget()

    def save_radio_cycle(self, name: str, cycle: int) -> None:
        """หน้าต่าง Radio Control ปิด: เก็บ Cycle ปัจจุบันลงไฟล์ของ "1. Device" (ref-R §9.3) ไม่มีไฟล์ (ผู้ใช้ลบอุปกรณ์แล้ว) = ไม่ทำอะไร"""
        _parse(_CYCLE, {"Cycle": cycle}, {})
        with self._lock:
            conf = self.radio(name)
            if conf is not None:
                self._write(_RADIO, dataclasses.replace(conf, cycle=cycle))
                self._forget()

    def save_rotator_runtime(self, name: str, cycle: int, threshold: float) -> None:
        """หน้าต่าง Antenna Control ปิด: เก็บ Cycle และ Threshold ปัจจุบันลงไฟล์ของ rotator ที่เลือก (ref-R §9.3)"""
        _parse(_CYCLE, {"Cycle": cycle}, {})
        threshold = _parse(_THRESHOLD, {"Threshold": threshold}, {})
        with self._lock:
            conf = self.rotator(name)
            if conf is not None:
                self._write(_ROTATOR, dataclasses.replace(conf, cycle=cycle, threshold=threshold))
                self._forget()
