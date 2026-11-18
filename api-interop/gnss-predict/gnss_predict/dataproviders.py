"""Data Provider ของรายงานและกราฟ (หัวข้อ 3.2 ของ spec งานย่อยที่ 4) อ่านจาก bundle ของ propagate และ analyze

- ชื่อ provider, group และ element ใช้คำของ STK ยกเว้น IPP Data ที่เพิ่มเอง (`ours = True`)
- object เป็น path แบบ STK: `*/Facility/THBK`, `*/Satellite/G01` และ Access เป็นสอง path คั่นด้วยช่องว่างหนึ่งตัว
  `*/Facility/THBK */Satellite/G01` (P1) ถ้าดาวมาก่อนก็สลับเป็น Facility→ดาว เพราะช่วง access เท่ากัน
- `ResultSet` ใช้เฉพาะ bundle ที่ hash ตรงกับ `studio.plan_propagate`/`plan_analyze` ของ scenario ปัจจุบัน
  ไม่มี bundle ที่ต้องใช้: `ResultsNotCurrentError`
- `provider_rows` คืนแถวเป็น dict ชื่อ element -> ค่า เวลาเป็น datetime UTC ไม่มีค่าเป็น None
  ช่วงเวลา [start, stop] ปิดทั้งสองข้าง ช่วงที่อยู่นอกช่วงวิเคราะห์ทั้งหมดได้แถวว่าง
  `step_s = None` คือ Use default time points (ทุกจุดของ scenario) ไม่งั้นต้องเป็นจำนวนเท่าของ step ของ scenario
  และเก็บเฉพาะเวลา t ที่ (t − start ของ scenario) หารด้วย step_s ลงตัว Access Data ไม่ขึ้นกับ step
- `TableCache` เก็บตารางที่อ่านแล้วต่อโฟลเดอร์ bundle (กุญแจคือ path.resolve()) ไม่เกิน max_bundles โฟลเดอร์
  แบบ LRU (P12)
- import studio ทั้งโมดูลแล้วเรียก attribute ตอนใช้งาน เพราะ CLI ของ studio จะ import ตัวสร้างรายงานที่ใช้โมดูลนี้
"""

import csv
import json
import re
import threading
from bisect import bisect_left, bisect_right
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from operator import itemgetter
from pathlib import Path
from typing import Literal

from . import studio
from .errors import (NoSatellitesError, OrbitUnavailableError, ResultCorruptError, ResultsNotCurrentError,
                     ScenarioError, StyleError)
from .geometry import ecef_to_geodetic
from .propagate import Ephemeris, ephemeris_from_sp3
from .scenario import EngineScenario, load_scenario

Kind = Literal["time", "number", "int"]
Interp = Literal["linear", "angle", "previous", "none"]

AER_FILE = "aer.csv"
DOP_FILE = "dop.csv"
INTERVALS_FILE = "intervals.json"
OBJECT_FIELD = "object"


@dataclass(frozen=True)
class ElementInfo:
    """interp: วิธีประมาณค่าระหว่างจุดของ Dynamic Display (angle วนรอบ 360°, previous ใช้จุดก่อนหน้า, none ไม่ประมาณ)
    header: หัวคอลัมน์ในรายงาน (P14: Access Number แสดงเป็น Access)"""
    name: str
    unit: str | None
    kind: Kind
    interp: Interp
    header: str


@dataclass(frozen=True)
class ProviderInfo:
    name: str
    groups: list[str] | None
    object_type: str
    elements: list[ElementInfo]
    uses: list[str]                     # ⊂ ["Reports", "Dynamic Displays"]
    ours: bool


def _el(name: str, unit: str | None = None, kind: Kind = "number", interp: Interp = "linear",
        header: str | None = None) -> ElementInfo:
    return ElementInfo(name, unit, kind, interp, header if header is not None else name)


def _time(interp: Interp = "linear") -> ElementInfo:
    return _el("Time", kind="time", interp=interp)


DOP_GROUPS = {"All Systems": "ALL", "GPS": "G", "GLONASS": "R", "Galileo": "E", "BeiDou": "C"}
_DOP_KEYS = {"GDOP": "gdop", "PDOP": "pdop", "HDOP": "hdop", "VDOP": "vdop", "EDOP": "edop", "NDOP": "ndop",
             "TDOP": "tdop"}
_COVERAGE = {"Total": "ALL", "GPS": "G", "GLONASS": "R", "Galileo": "E", "BeiDou": "C"}
_REPORTS = ["Reports"]
_REPORTS_DYNAMIC = ["Reports", "Dynamic Displays"]

# ตาราง provider ตาม spec หัวข้อ 3.2 (ลำดับนี้คือลำดับที่ list_providers คืน)
PROVIDERS: dict[str, ProviderInfo] = {p.name: p for p in [
    ProviderInfo("Access Data", None, "Access", [
        _el("Access Number", kind="int", interp="none", header="Access"),
        _el("Start Time", kind="time", interp="none"),
        _el("Stop Time", kind="time", interp="none"),
        _el("Duration", "sec", interp="none"),
    ], _REPORTS, False),
    ProviderInfo("AER Data", ["Default"], "Access", [
        _time(), _el("Azimuth", "deg", interp="angle"), _el("Elevation", "deg"), _el("Range", "km"),
    ], _REPORTS_DYNAMIC, False),
    ProviderInfo("LLA State", ["Fixed"], "Satellite", [
        _time(), _el("Lat", "deg"), _el("Lon", "deg", interp="angle"), _el("Alt", "km"),
        _el("Lat Rate", "deg/sec"), _el("Lon Rate", "deg/sec"), _el("Alt Rate", "km/sec"),
    ], _REPORTS_DYNAMIC, False),
    ProviderInfo("Dilution of Precision", list(DOP_GROUPS), "Facility", [
        _time(), *(_el(name) for name in _DOP_KEYS), _el("N Visible", kind="int", interp="previous"),
    ], _REPORTS_DYNAMIC, False),
    ProviderInfo("N Asset Coverage", None, "Facility", [
        _time("previous"), *(_el(name, kind="int", interp="previous") for name in _COVERAGE),
    ], _REPORTS_DYNAMIC, False),
    ProviderInfo("IPP Data", None, "Access", [
        _time(), _el("IPP Lat", "deg"), _el("IPP Lon", "deg", interp="angle"), _el("MF"), _el("Elevation", "deg"),
    ], _REPORTS_DYNAMIC, True),
]}


def list_providers(object_type: str) -> list[ProviderInfo]:
    """provider ของชนิด object (Access, Facility, Satellite) ชนิดอื่นรวม Constellation ได้รายการว่าง"""
    return [p for p in PROVIDERS.values() if p.object_type == object_type]


# ---------- path ของ object ----------

_PATH = re.compile(r"\*/(Facility|Satellite)/([A-Za-z0-9_-]{1,32})")


def access_path(facility: str, satellite: str) -> str:
    return f"*/Facility/{facility} */Satellite/{satellite}"


def _bad_object(obj) -> ScenarioError:
    return ScenarioError(f"object '{obj}' ไม่ใช่ path ที่รองรับ ต้องเป็น */Facility/<ชื่อ>, */Satellite/<ชื่อ> "
                         "หรือคู่ */Facility/<ชื่อ> */Satellite/<ชื่อ> คั่นด้วยช่องว่างหนึ่งตัว", OBJECT_FIELD)


def parse_object(obj: str) -> tuple[str, str, str | None]:
    """("Access", facility, satellite) / ("Facility", ชื่อ, None) / ("Satellite", ชื่อ, None)"""
    if not isinstance(obj, str):
        raise _bad_object(obj)
    matches = [_PATH.fullmatch(part) for part in obj.split(" ")]
    if not 1 <= len(matches) <= 2 or not all(matches):
        raise _bad_object(obj)
    if len(matches) == 1:
        return matches[0].group(1), matches[0].group(2), None
    names = {m.group(1): m.group(2) for m in matches}
    if set(names) != {"Facility", "Satellite"}:
        raise _bad_object(obj)
    return "Access", names["Facility"], names["Satellite"]


def display_name(obj: str) -> str:
    """ชื่อที่แสดงในรายงาน: THBK-To-G01, THBK, G01"""
    kind, name, satellite = parse_object(obj)
    return f"{name}-To-{satellite}" if kind == "Access" else name


# ---------- ตารางที่อ่านจาก bundle ----------

@dataclass(frozen=True)
class AccessTables:
    """ตารางของ access/<facility>/<hash>/ เรียงตามเวลา
    aer: PRN -> (time, az, el, range, ipp_lat, ipp_lon, mf), intervals: PRN -> (start, stop, duration_s),
    dop: ระบบ (ALL, G, R, E, C) -> {"time_utc", "n_visible", "gdop", ..., "tdop"} (ช่องว่างใน csv เป็น None)"""
    facility: str
    aer: dict[str, list[tuple]]
    intervals: dict[str, list[tuple[datetime, datetime, float]]]
    global_statistics: dict
    dop: dict[str, list[dict]]


_AER_TIME, _AER_AZ, _AER_EL, _AER_RANGE, _AER_IPP_LAT, _AER_IPP_LON, _AER_MF = range(7)
_by_time = itemgetter(0)


def _dop_time(row: dict) -> datetime:
    return row["time_utc"]


def _missing_bundle(path: Path, exc: Exception) -> ResultsNotCurrentError:
    return ResultsNotCurrentError(f"ไม่พบผลลัพธ์ที่ {path} ({exc}) ให้ Compute ใหม่")


def _corrupt(path: Path, exc: Exception) -> ResultCorruptError:
    return ResultCorruptError(f"อ่าน {path} ไม่ได้ ({type(exc).__name__}: {exc}) "
                              f"ให้ลบโฟลเดอร์ {path.parent} แล้วรันใหม่")


def _parse_time(text: str, memo: dict[str, datetime]) -> datetime:
    """เวลา ISO ลงท้าย Z ของไฟล์ engine (ทั้งแบบวินาทีและมิลลิวินาที) เวลาเดียวกันซ้ำหลายแถวจึงจำไว้"""
    t = memo.get(text)
    if t is None:
        t = datetime.fromisoformat(text)
        if t.tzinfo is None:
            raise ValueError(f"เวลา '{text}' ไม่ระบุเขตเวลา")
        t = memo[text] = t.astimezone(timezone.utc)
    return t


def _optional(text: str) -> float | None:
    return None if text == "" else float(text)


def _rows(path: Path, header: list[str]):
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.reader(f)
        if next(reader, None) != header:
            raise ValueError(f"หัวคอลัมน์ไม่ใช่ {','.join(header)}")
        yield from reader


def _load_access(bundle_dir: Path) -> AccessTables:
    path = bundle_dir / INTERVALS_FILE
    try:
        memo: dict[str, datetime] = {}
        doc = json.loads(path.read_bytes().decode("utf-8"))
        intervals = {prn: [(_parse_time(iv["start"], memo), _parse_time(iv["stop"], memo), float(iv["duration_s"]))
                           for iv in ivs] for prn, ivs in doc["intervals"].items()}
        facility, stats = doc["facility"], doc["global_statistics"]

        path = bundle_dir / AER_FILE
        aer: dict[str, list[tuple]] = {}
        for t, prn, az, el, rng, lat, lon, mf in _rows(path, studio.AER_HEADER):
            # ดาวถ่ายภาพ (ระบบ X) ไม่มี IPP/MF: ช่องว่างอ่านเป็น None ไม่ใช่ไฟล์เสีย
            aer.setdefault(prn, []).append((_parse_time(t, memo), float(az), float(el), float(rng), _optional(lat),
                                            _optional(lon), _optional(mf)))

        path = bundle_dir / DOP_FILE
        keys = studio.DOP_HEADER[3:]
        dop: dict[str, list[dict]] = {system: [] for system in DOP_GROUPS.values()}
        for row in _rows(path, studio.DOP_HEADER):
            entry = {"time_utc": _parse_time(row[0], memo), "n_visible": int(row[2])}
            entry.update(zip(keys, map(_optional, row[3:]), strict=True))
            dop.setdefault(row[1], []).append(entry)
    except FileNotFoundError as exc:
        raise _missing_bundle(path, exc) from exc
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as exc:
        raise _corrupt(path, exc) from exc
    # ไฟล์ของ engine เรียงตามเวลาอยู่แล้ว เรียงซ้ำ (stable) กันไฟล์ที่ไม่เรียงให้ bisect ใช้ได้เสมอ
    for series in aer.values():
        series.sort(key=_by_time)
    for series in dop.values():
        series.sort(key=_dop_time)
    return AccessTables(facility, aer, intervals, stats, dop)


def _load_manifest(bundle_dir: Path) -> dict:
    path = bundle_dir / studio.MANIFEST
    try:
        doc = json.loads(path.read_bytes().decode("utf-8"))
    except FileNotFoundError as exc:
        raise _missing_bundle(path, exc) from exc
    except (OSError, ValueError) as exc:
        raise _corrupt(path, exc) from exc
    if not isinstance(doc, dict):
        raise _corrupt(path, ValueError("ราก JSON ไม่ใช่ object"))
    return doc


def _load_ephem(bundle_dir: Path) -> Ephemeris:
    path = bundle_dir / studio.PREDICTED_SP3
    if not path.is_file():
        raise _missing_bundle(path, FileNotFoundError(path.name))
    return ephemeris_from_sp3(path)


class TableCache:
    """ตารางที่อ่านแล้วต่อโฟลเดอร์ bundle ไม่เกิน max_bundles โฟลเดอร์ (LRU รวมทุกชนิด) ใช้ข้าม thread ได้

    loads นับครั้งที่อ่านไฟล์จากดิสก์ (ตารางหนึ่งชนิดของหนึ่งโฟลเดอร์นับหนึ่งครั้ง)
    """

    def __init__(self, max_bundles: int = 8):
        if max_bundles < 1:
            raise ValueError(f"max_bundles ต้องอย่างน้อย 1 ได้ {max_bundles}")
        self.max_bundles = max_bundles
        self.loads = 0
        self._entries: OrderedDict[Path, dict[str, object]] = OrderedDict()
        self._lock = threading.Lock()

    def _get(self, kind: str, path: Path, loader: Callable[[Path], object]):
        key = Path(path).resolve()
        with self._lock:
            entry = self._entries.setdefault(key, {})
            self._entries.move_to_end(key)
            if kind not in entry:
                try:
                    entry[kind] = loader(key)
                except BaseException:
                    if not entry:
                        del self._entries[key]
                    raise
                self.loads += 1
            while len(self._entries) > self.max_bundles:
                self._entries.popitem(last=False)
            return entry[kind]

    def access(self, path: Path) -> AccessTables:
        return self._get("access", path, _load_access)

    def ephem_manifest(self, path: Path) -> dict:
        return self._get("manifest", path, _load_manifest)

    def ephem(self, path: Path) -> Ephemeris:
        return self._get("ephem", path, _load_ephem)


# ---------- ชุดผลลัพธ์ของ scenario ----------

@dataclass(frozen=True)
class ResultSet:
    """bundle ที่ตรงกับ scenario ปัจจุบัน ยังไม่มีผลหรือผลไม่ตรง: ephem_dir เป็น None
    และ access_dirs ไม่มี Facility นั้น"""
    scenario: EngineScenario
    ephem_dir: Path | None
    access_dirs: dict[str, Path]          # ชื่อ Facility -> access/<facility>/<hash>/
    tables: TableCache

    def prn_of(self, satellite_name: str) -> str | None:
        """PRN ของดาวชื่อนี้ใน scenario จาก NORAD กับ manifest ของ ephem (เฉพาะดวงที่ propagate แล้ว)"""
        norad = next((n for name, n in self.scenario.satellites if name.casefold() == satellite_name.casefold()),
                     None)
        if norad is None or self.ephem_dir is None:
            return None
        for sat in self.tables.ephem_manifest(self.ephem_dir).get("satellites", []):
            if sat.get("norad") == norad and sat.get("propagated"):
                return sat.get("prn")
        return None


def open_result_set(scenario_dir: Path, data_dir: Path, tables: TableCache | None = None) -> ResultSet:
    """อ่าน scenario แล้วหา bundle ที่ hash ตรงกับ plan_propagate/plan_analyze และมีอยู่จริง (ไม่รัน GMAT ไม่เขียนไฟล์)
    snapshot ไม่มีหรือไม่มีดาวให้ propagate ถือว่ายังไม่มีผลลัพธ์ scenario.json ผิด: ScenarioError"""
    scenario_dir = Path(scenario_dir)
    sc = load_scenario(scenario_dir / studio.SCENARIO_FILE)
    tables = tables if tables is not None else TableCache()
    try:
        ephem_hash = studio.plan_propagate(scenario_dir, data_dir).hash
        access_hashes = {fac.name: studio.plan_analyze(scenario_dir, fac.name, data_dir) for fac in sc.facilities}
    except (NoSatellitesError, OrbitUnavailableError):
        return ResultSet(sc, None, {}, tables)
    ephem_dir = scenario_dir / studio.EPHEM_DIR / ephem_hash
    access_dirs = {name: scenario_dir / studio.ACCESS_DIR / name / digest for name, digest in access_hashes.items()}
    return ResultSet(sc, ephem_dir if ephem_dir.is_dir() else None,
                     {name: path for name, path in access_dirs.items() if path.is_dir()}, tables)


# ---------- ตรวจคำขอ ----------

def _provider(name: str) -> ProviderInfo:
    info = PROVIDERS.get(name) if isinstance(name, str) else None
    if info is None:
        raise StyleError(f"ไม่มี Data Provider ชื่อ '{name}' (ที่มี: {', '.join(PROVIDERS)})", "provider")
    return info


def _check_elements(info: ProviderInfo, elements: list[str]) -> None:
    known = {e.name for e in info.elements}
    if not isinstance(elements, list):
        raise StyleError("elements ต้องเป็นรายการชื่อ element", "elements")
    for i, name in enumerate(elements):
        if not isinstance(name, str) or name not in known:
            raise StyleError(f"{info.name} ไม่มี element ชื่อ '{name}' "
                             f"(ที่มี: {', '.join(e.name for e in info.elements)})", f"elements[{i}]")


def _group(info: ProviderInfo, group: str | None) -> str | None:
    """group ที่ใช้ (None = group แรกของ provider ที่มี group)"""
    if info.groups is None:
        if group is not None:
            raise StyleError(f"{info.name} ไม่มี group (ได้ '{group}')", "group")
        return None
    if group is None:
        return info.groups[0]
    if group not in info.groups:
        raise StyleError(f"{info.name} ไม่มี group ชื่อ '{group}' (ที่มี: {', '.join(info.groups)})", "group")
    return group


def _scenario_name(names: list[str], name: str, kind: str, obj: str) -> str:
    """ชื่อตามที่เขียนใน scenario (ชื่อ object ไม่ซ้ำกันแบบไม่แยกตัวพิมพ์)"""
    for known in names:
        if known.casefold() == name.casefold():
            return known
    raise ScenarioError(f"scenario ไม่มี {kind} ชื่อ '{name}' (object {obj})", OBJECT_FIELD)


def _resolve_object(sc: EngineScenario, obj: str, object_type: str | None = None) -> tuple[str, str, str | None]:
    kind, name, satellite = parse_object(obj)
    if object_type is not None and kind != object_type:
        raise ScenarioError(f"object {obj} เป็นชนิด {kind} แต่ provider นี้ใช้กับ {object_type}", OBJECT_FIELD)
    facilities = [f.name for f in sc.facilities]
    satellites = [n for n, _ in sc.satellites]
    if kind == "Satellite":
        return kind, _scenario_name(satellites, name, "Satellite", obj), None
    name = _scenario_name(facilities, name, "Facility", obj)
    if kind == "Access":
        satellite = _scenario_name(satellites, satellite, "Satellite", obj)
    return kind, name, satellite


def _window(start: datetime, stop: datetime) -> tuple[datetime, datetime]:
    for value, field in ((start, "time.start"), (stop, "time.stop")):
        if not isinstance(value, datetime) or value.tzinfo is None:
            raise ScenarioError("เวลาเริ่มและเวลาจบต้องเป็นเวลาที่ระบุเขตเวลา (UTC)", field)
    start, stop = start.astimezone(timezone.utc), stop.astimezone(timezone.utc)
    if start >= stop:
        raise ScenarioError("เวลาเริ่มต้องอยู่ก่อนเวลาจบ", "time.start")
    return start, stop


def _step(sc: EngineScenario, step_s: int | None) -> int | None:
    if step_s is None:
        return None
    if isinstance(step_s, bool) or not isinstance(step_s, int) or step_s <= 0 or step_s % sc.step_s:
        raise ScenarioError(f"Step ต้องเป็นจำนวนเท่าของ step ของ scenario ({sc.step_s} วินาที) ได้ {step_s}",
                            "time.step")
    return step_s


def object_period(bundle: ResultSet, obj: str) -> tuple[datetime, datetime]:
    """ช่วงเวลาของ object (Use Object Time Period) คือช่วงวิเคราะห์ของ scenario object ที่ไม่มี: ScenarioError"""
    _resolve_object(bundle.scenario, obj)
    return bundle.scenario.start, bundle.scenario.stop


# ---------- แถวของแต่ละ provider ----------

@dataclass(frozen=True)
class _Query:
    sc: EngineScenario
    start: datetime
    stop: datetime
    step: timedelta | None

    def on_step(self, t: datetime) -> bool:
        return self.step is None or (t - self.sc.start) % self.step == timedelta(0)


def _to_millisecond(t: datetime) -> datetime:
    return t.replace(microsecond=0) + timedelta(milliseconds=round(t.microsecond / 1000))


def _access_tables(bundle: ResultSet, facility: str) -> AccessTables:
    path = bundle.access_dirs.get(facility)
    if path is None:
        raise ResultsNotCurrentError(f"ยังไม่มีผลลัพธ์ของ Facility {facility} ที่ตรงกับ scenario ปัจจุบัน "
                                     "ให้ Compute ก่อน")
    return bundle.tables.access(path)


def _require_ephem(bundle: ResultSet) -> Path:
    if bundle.ephem_dir is None:
        raise ResultsNotCurrentError("ยังไม่มีผล propagate ที่ตรงกับ scenario ปัจจุบัน ให้ Compute ก่อน")
    return bundle.ephem_dir


def _access_data(tables: AccessTables, prn: str, q: _Query) -> list[dict]:
    """ช่วงที่คร่อมขอบถูกตัดที่ start/stop (ปัดมิลลิวินาที) พร้อม Duration ใหม่ และนับ Access Number ใหม่จาก 1"""
    rows = []
    for start, stop, duration in tables.intervals.get(prn, []):
        if stop <= q.start or start >= q.stop:
            continue
        if start < q.start or stop > q.stop:
            start, stop = _to_millisecond(max(start, q.start)), _to_millisecond(min(stop, q.stop))
            if stop <= start:
                continue
            duration = round((stop - start).total_seconds(), 3) + 0.0
        rows.append({"Access Number": len(rows) + 1, "Start Time": start, "Stop Time": stop, "Duration": duration})
    return rows


def _aer_in_access(tables: AccessTables, prn: str, q: _Query) -> list[tuple]:
    """แถวของ aer.csv ใน [start, stop] ที่อยู่ในช่วง access ใดช่วงหนึ่ง (P10) และตรงกับ step"""
    series = tables.aer.get(prn, [])
    intervals = tables.intervals.get(prn, [])
    out, k = [], 0
    for row in series[bisect_left(series, q.start, key=_by_time):bisect_right(series, q.stop, key=_by_time)]:
        t = row[_AER_TIME]
        while k < len(intervals) and intervals[k][1] < t:        # ทั้งเวลาและช่วงเรียงจากน้อยไปมาก
            k += 1
        if k < len(intervals) and intervals[k][0] <= t and q.on_step(t):
            out.append(row)
    return out


def _aer_data(tables: AccessTables, prn: str, q: _Query) -> list[dict]:
    return [{"Time": r[_AER_TIME], "Azimuth": r[_AER_AZ], "Elevation": r[_AER_EL], "Range": r[_AER_RANGE]}
            for r in _aer_in_access(tables, prn, q)]


def _ipp_data(tables: AccessTables, prn: str, q: _Query) -> list[dict]:
    return [{"Time": r[_AER_TIME], "IPP Lat": r[_AER_IPP_LAT], "IPP Lon": r[_AER_IPP_LON], "MF": r[_AER_MF],
             "Elevation": r[_AER_EL]} for r in _aer_in_access(tables, prn, q)]


def _dop_window(tables: AccessTables, system: str, q: _Query) -> list[dict]:
    series = tables.dop.get(system, [])
    window = series[bisect_left(series, q.start, key=_dop_time):bisect_right(series, q.stop, key=_dop_time)]
    return [r for r in window if q.on_step(r["time_utc"])]


def _dop_data(tables: AccessTables, system: str, q: _Query) -> list[dict]:
    rows = []
    for r in _dop_window(tables, system, q):
        row = {"Time": r["time_utc"]}
        row.update({name: r[key] for name, key in _DOP_KEYS.items()})
        row["N Visible"] = r["n_visible"]
        rows.append(row)
    return rows


def _coverage_data(tables: AccessTables, q: _Query) -> list[dict]:
    """จำนวนดาวที่ใช้ได้ (n_visible) ของทุกระบบที่เวลาเดียวกัน แกนเวลาตามแถว ALL"""
    counts = {system: {r["time_utc"]: r["n_visible"] for r in _dop_window(tables, system, q)}
              for system in _COVERAGE.values()}
    return [{"Time": t, **{name: counts[system].get(t) for name, system in _COVERAGE.items()}}
            for t in counts["ALL"]]


def _lla_data(eph: Ephemeris, prn: str, q: _Query) -> list[dict]:
    """Lat/Lon/Alt จาก ecef_to_geodetic และ rate จากผลต่างของจุดก่อน/หลังบนกริดของ scenario (ก่อนเลือกตาม step)
    จุดแรกและจุดสุดท้ายของกริดใช้ผลต่างข้างเดียว ผลต่างลองจิจูด unwrap เข้าช่วง [−180, 180) ก่อนหาร"""
    positions = eph.positions_km.get(prn)
    times = eph.times_utc
    lo, hi = bisect_left(times, q.start), bisect_right(times, q.stop)
    if positions is None or lo >= hi:
        return []
    first, last = max(lo - 1, 0), min(hi, len(times) - 1)
    geo = {k: ecef_to_geodetic(*positions[k]) for k in range(first, last + 1)}
    rows = []
    for k in range(lo, hi):
        if not q.on_step(times[k]):
            continue
        lat, lon, alt = geo[k]
        before, after = max(k - 1, 0), min(k + 1, len(times) - 1)
        if before == after:                              # กริดมีจุดเดียว
            rates = (None, None, None)
        else:
            dt = (times[after] - times[before]).total_seconds()
            dlon = (geo[after][1] - geo[before][1] + 180.0) % 360.0 - 180.0
            rates = ((geo[after][0] - geo[before][0]) / dt, dlon / dt, (geo[after][2] - geo[before][2]) / dt)
        rows.append({"Time": times[k], "Lat": lat, "Lon": lon, "Alt": alt,
                     "Lat Rate": rates[0], "Lon Rate": rates[1], "Alt Rate": rates[2]})
    return rows


def provider_rows(bundle: ResultSet, obj: str, provider: str, group: str | None, elements: list[str],
                  start: datetime, stop: datetime, step_s: int | None) -> list[dict]:
    """แถวของ provider สำหรับ object ในช่วง [start, stop] แต่ละแถวมีเฉพาะ elements ตามลำดับที่ขอ

    ชื่อ provider/group/element ผิด: StyleError (field provider, group, elements[i])
    object ผิดรูป ผิดชนิด หรือไม่มีใน scenario: ScenarioError(field="object")
    start ≥ stop: ScenarioError(field="time.start") step ผิด: ScenarioError(field="time.step")
    ไม่มีผลลัพธ์ที่ตรงกับ scenario: ResultsNotCurrentError
    """
    info = _provider(provider)
    _check_elements(info, elements)
    group = _group(info, group)
    sc = bundle.scenario
    kind, name, satellite = _resolve_object(sc, obj, info.object_type)
    q_start, q_stop = _window(start, stop)
    step = _step(sc, step_s)

    prn, eph, tables = None, None, None
    if kind == "Satellite":
        ephem_dir = _require_ephem(bundle)
        prn = bundle.prn_of(name)
        eph = bundle.tables.ephem(ephem_dir) if prn is not None else None
    else:
        tables = _access_tables(bundle, name)
        if kind == "Access":
            _require_ephem(bundle)
            prn = bundle.prn_of(satellite)
    if q_start > sc.stop or q_stop < sc.start:
        return []
    q = _Query(sc, q_start, q_stop, None if step is None else timedelta(seconds=step))

    if info.name == "LLA State":
        rows = [] if eph is None else _lla_data(eph, prn, q)
    elif info.name == "Dilution of Precision":
        rows = _dop_data(tables, DOP_GROUPS[group], q)
    elif info.name == "N Asset Coverage":
        rows = _coverage_data(tables, q)
    elif prn is None:                       # ดาวใน scenario ที่ไม่ได้ propagate (ถูกซ่อนหรือไม่มีใน snapshot)
        rows = []
    elif info.name == "Access Data":
        rows = _access_data(tables, prn, q)
    elif info.name == "AER Data":
        rows = _aer_data(tables, prn, q)
    else:
        rows = _ipp_data(tables, prn, q)
    return [{e: row[e] for e in elements} for row in rows]
