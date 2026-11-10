"""GNSS Studio engine: ดึงข้อมูลวงโคจร, propagate และ analyze (หัวข้อ 5.13 ของ spec engine)

    python3 -m gnss_predict.studio fetch     [--data DIR] [--systems GREC]
    python3 -m gnss_predict.studio propagate --scenario DIR [--data DIR]
    python3 -m gnss_predict.studio analyze   --scenario DIR --facility NAME [--data DIR]

- ทุกคำสั่งเป็นฟังก์ชันที่ server เรียกได้ตรง (`fetch_snapshot`, `run_propagate`, `run_analyze`) CLI แค่แปลง argument
- โครงสร้างบนดิสก์ตามหัวข้อ 7.1 ของ spec ภาพรวม: `<data>/orbits/<YYYYMMDDTHHMMZ>/` (cache ดาวน์โหลดอยู่ที่
  `<data>/orbits/_cache/`), `<scenario>/ephem/<hash>/` และ `<scenario>/access/<facility>/<hash>/`
- โฟลเดอร์ผลลัพธ์เขียนครั้งเดียวด้วย `write_bundle` ถ้ามีโฟลเดอร์ของ hash เดียวกันอยู่แล้วคืนโฟลเดอร์นั้นทันที (ผลเดิม)
  และคืนข้อความที่บันทึกไว้ใน manifest.json ของผลนั้น
- `progress(stage, fraction)`: stage เป็นชื่อขั้นภาษาอังกฤษ fraction 0–1 ของทั้งฟังก์ชัน
  เรียกด้วย 0.0 ตอนเริ่มและ 1.0 ตอนจบ (ไม่เรียก 1.0 ถ้าจบด้วย exception)
- CLI พิมพ์ path ผลลัพธ์บรรทัดแรกตามด้วย `<level>: <text>` ของแต่ละ Message ลง stdout
  exit code: 0 สำเร็จ, 1 GnssPredictError (พิมพ์ลง stderr), 2 argument ผิด
"""

import argparse
import csv
import hashlib
import io
import json
import sys
import tempfile
from collections.abc import Callable
from dataclasses import asdict, dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.request import urlopen

from . import brdc
from .analyze import AerRow, Interval, access_intervals, aer_rows, global_statistics, legacy_rows
from .bundle import build_manifest, file_sha256, input_hash, write_bundle
from .catalog import BRDC_DIR, IGS_METADATA_FILE, Catalog, CatalogSatellite, broadcast_file, build_catalog, is_shown
from .config import BRDC_DAYS_BACK, DATA_DIR, ENGINE_VERSION, GNSS_GROUPS
from .czml import access_czml, satellites_czml
from .dop import dop_series
from .errors import (BrdcUnavailableError, GnssPredictError, Message, NoSatellitesError, OrbitUnavailableError,
                     ScenarioError)
from .igs_meta import fetch_metadata
from .omm import fetch_group
from .predict import HEADER as LEGACY_HEADER
from .propagate import ephemeris_from_sp3, propagate
from .run_gmat import find_gmat_console, gmat_version
from .scenario import EngineScenario, Facility, load_scenario
from .sp3 import write_sp3

Progress = Callable[[str, float], None]

ORBITS_DIR = "orbits"
CACHE_DIR = "_cache"
CELESTRAK_STATE_FILE = "celestrak_state.json"
SHA256SUMS = "SHA256SUMS"
SNAPSHOT_TIME_FMT = "%Y%m%dT%H%MZ"

SCENARIO_FILE = "scenario.json"
EPHEM_DIR = "ephem"
ACCESS_DIR = "access"
MANIFEST = "manifest.json"
PREDICTED_SP3 = "predicted.sp3"
SCENE_CZML = "scene.czml"

AER_HEADER = ["time_utc", "prn", "az_deg", "el_deg", "range_km", "ipp_lat_deg", "ipp_lon_deg", "mf"]
DOP_HEADER = ["time_utc", "system", "n_visible", "gdop", "pdop", "hdop", "vdop", "edop", "ndop", "tdop"]
# ทศนิยมตามหัวข้อ 8.2 ของ spec engine
ANGLE_DECIMALS = RANGE_DECIMALS = DOP_DECIMALS = DURATION_DECIMALS = 3
IPP_DECIMALS = 4
MF_DECIMALS = 5

_UNMAPPED_REASON = {
    "NO_PRN": "IGS metadata ไม่มี PRN ของดาวนี้ ณ เวลาเริ่มช่วงวิเคราะห์",
    "DUPLICATE_PRN": "PRN ซ้ำกับดาวดวงอื่นที่ข้อมูลวงโคจรใหม่กว่า",
    "TLE_UNAVAILABLE": "แปลง OMM ของดาวนี้เป็น TLE ไม่ได้",
}


def _reporter(progress: Progress | None) -> Progress:
    return progress if progress is not None else (lambda stage, fraction: None)


# ---------- รูปแบบไฟล์ (หัวข้อ 8 ของ spec engine) ----------

def _iso_s(t: datetime) -> str:
    return t.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _iso_ms(t: datetime) -> str:
    """เวลาของช่วง access ถูกปัดเป็นมิลลิวินาทีแล้วใน analyze"""
    t = t.astimezone(timezone.utc)
    return f"{t:%Y-%m-%dT%H:%M:%S}.{t.microsecond // 1000:03d}Z"


def _round(value: float | None, decimals: int) -> float | None:
    # + 0.0 เปลี่ยน -0.0 (เช่นค่าลบเล็ก ๆ ที่ปัดแล้วเป็นศูนย์) เป็น 0.0
    return None if value is None else round(value, decimals) + 0.0


def _fmt(value: float | None, decimals: int) -> str:
    """ช่อง CSV: None เป็นช่องว่าง"""
    return "" if value is None else f"{_round(value, decimals):.{decimals}f}"


def _json_bytes(obj, compact: bool = False) -> bytes:
    text = (json.dumps(obj, ensure_ascii=False, separators=(",", ":")) if compact
            else json.dumps(obj, ensure_ascii=False, indent=2))
    return (text + "\n").encode("utf-8")


def _csv_bytes(header: list[str], rows: list[list[str]]) -> bytes:
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(header)
    writer.writerows(rows)
    return buf.getvalue().encode("utf-8")


def _aer_csv_row(r: AerRow) -> list[str]:
    az = round(r.az_deg, ANGLE_DECIMALS) % 360.0          # 359.9997 ปัดแล้วได้ 360.000 ต้องวนกลับเป็น 0.000
    return [_iso_s(r.time_utc), r.prn, _fmt(az, ANGLE_DECIMALS), _fmt(r.el_deg, ANGLE_DECIMALS),
            _fmt(r.range_km, RANGE_DECIMALS), _fmt(r.ipp_lat_deg, IPP_DECIMALS), _fmt(r.ipp_lon_deg, IPP_DECIMALS),
            _fmt(r.mf, MF_DECIMALS)]


def _dop_csv_row(row: dict) -> list[str]:
    return ([_iso_s(row["time_utc"]), row["system"], str(row["n_visible"])]
            + [_fmt(row[key], DOP_DECIMALS) for key in DOP_HEADER[3:]])


def _intervals_doc(fac: Facility, intervals: dict[str, list[Interval]]) -> dict:
    stats = global_statistics(intervals)
    return {
        "facility": fac.name,
        "min_el_deg": fac.min_el_deg,
        "intervals": {prn: [{"start": _iso_ms(iv.start), "stop": _iso_ms(iv.stop),
                             "duration_s": _round((iv.stop - iv.start).total_seconds(), DURATION_DECIMALS),
                             "max_el_deg": _round(iv.max_el_deg, ANGLE_DECIMALS)} for iv in ivs]
                      for prn, ivs in intervals.items()},
        "global_statistics": {key: _round(v, DURATION_DECIMALS) if isinstance(v, float) else v
                              for key, v in stats.items()},
    }


@dataclass(frozen=True)
class _StoredManifest:
    data: dict
    messages: list[Message]
    flags: dict[str, frozenset[str]]       # PRN -> ธง


def _read_manifest(bundle_dir: Path) -> _StoredManifest:
    path = bundle_dir / MANIFEST
    try:
        data = json.loads(path.read_bytes().decode("utf-8"))
        messages = [Message(m["code"], m["level"], m["text"], m.get("object")) for m in data["messages"]]
        flags = {s["prn"]: frozenset(s["flags"]) for s in data["satellites"]}
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as exc:
        raise GnssPredictError(f"อ่าน {path} ไม่ได้ ({type(exc).__name__}: {exc}) "
                               f"ให้ลบโฟลเดอร์ {bundle_dir} แล้วรันใหม่") from exc
    return _StoredManifest(data, messages, flags)


# ---------- fetch ----------

def _system_letters(systems: str) -> list[str]:
    """ตัวอักษรระบบเรียงตาม GNSS_GROUPS ไม่ว่างและไม่มีตัวที่ไม่รู้จัก ไม่งั้น ValueError"""
    letters = systems.upper() if isinstance(systems, str) else ""
    unknown = sorted(set(letters) - set(GNSS_GROUPS))
    if not letters or unknown:
        raise ValueError(f"ระบบดาวเทียมต้องเป็นตัวอักษร {''.join(GNSS_GROUPS)} อย่างน้อยหนึ่งตัว ได้ {systems!r}")
    return [s for s in GNSS_GROUPS if s in letters]


def _fetch_latest_brdc(today: date, cache: Path, fetcher) -> tuple[Path | None, list[Message]]:
    reasons = []
    for back in BRDC_DAYS_BACK:
        day = today - timedelta(days=back)
        try:
            return Path(fetcher(day, cache)), []
        except (BrdcUnavailableError, OSError) as exc:      # OSError: เรียก curl ไม่ได้
            reasons.append(f"{day.isoformat()}: {exc}")
    return None, [Message("BRDC_UNAVAILABLE", "warning",
                          f"ดึงไฟล์ broadcast ไม่สำเร็จ ({'; '.join(reasons)}) snapshot นี้จึงไม่มี broadcast "
                          "และจะไม่ตรวจธง no_broadcast และ unhealthy")]


def _sha256sums(files: dict[str, bytes]) -> bytes:
    """บรรทัด `<sha256>  <path สัมพัทธ์>` เรียงตาม path แบบเดียวกับ sha256sum"""
    return "".join(f"{hashlib.sha256(data).hexdigest()}  {name}\n"
                   for name, data in sorted(files.items())).encode("utf-8")


def fetch_snapshot(data_dir: Path, now: datetime, systems: str = "GREC", opener=urlopen,
                   brdc_fetcher=brdc.fetch_brdc, progress: Progress | None = None) -> tuple[Path, list[Message]]:
    """ดึง OMM ของทุกกลุ่มใน systems, IGS metadata และ broadcast ลง cache แล้วรวมเป็น snapshot
    `<data_dir>/orbits/<now:%Y%m%dT%H%MZ>/` (`<group>.json`, `igs_satellite_metadata.snx`, `brdc/<ชื่อไฟล์>`, SHA256SUMS)

    กติกาการดาวน์โหลด (CelesTrak 2 ชม., IGS วันละครั้ง) อยู่ใน fetch_group และ fetch_metadata ซึ่งใช้ไฟล์ใน cache แทนเมื่อดึงไม่ได้
    broadcast ลองของเมื่อวาน (UTC) แล้วของสองวันก่อน ไม่ได้ทั้งคู่ได้ BRDC_UNAVAILABLE และ snapshot ไม่มีโฟลเดอร์ brdc
    """
    report = _reporter(progress)
    letters = _system_letters(systems)
    now = now.astimezone(timezone.utc)
    orbits = Path(data_dir) / ORBITS_DIR
    cache = orbits / CACHE_DIR
    report("omm", 0.0)
    messages: list[Message] = []
    files: dict[str, bytes] = {}
    for i, system in enumerate(letters):
        group = GNSS_GROUPS[system]
        path, msgs = fetch_group(group, cache, cache / CELESTRAK_STATE_FILE, now, opener=opener)
        files[f"{group}.json"] = path.read_bytes()
        messages += msgs
        report("omm", 0.6 * (i + 1) / len(letters))
    path, msgs = fetch_metadata(cache, now, opener=opener)
    files[IGS_METADATA_FILE] = path.read_bytes()
    messages += msgs
    report("brdc", 0.7)
    path, msgs = _fetch_latest_brdc(now.date(), cache, brdc_fetcher)
    if path is not None:
        files[f"{BRDC_DIR}/{path.name}"] = path.read_bytes()
    messages += msgs
    report("write", 0.9)
    files[SHA256SUMS] = _sha256sums(files)
    snapshot = write_bundle(orbits / now.strftime(SNAPSHOT_TIME_FMT), files)
    report("done", 1.0)
    return snapshot, messages


# ---------- propagate ----------

def _load(scenario_dir: Path) -> EngineScenario:
    return load_scenario(scenario_dir / SCENARIO_FILE)


def _snapshot(data_dir: Path, sc: EngineScenario) -> tuple[Path, set[str]]:
    """โฟลเดอร์ snapshot และระบบที่มีไฟล์ OMM ใน snapshot นั้น"""
    snapshot_dir = Path(data_dir) / ORBITS_DIR / sc.orbit_snapshot
    if not snapshot_dir.is_dir():
        raise OrbitUnavailableError(f"ไม่พบ snapshot ข้อมูลวงโคจร {sc.orbit_snapshot} ที่ {snapshot_dir} "
                                    "ให้รันคำสั่ง fetch หรือแก้ช่อง orbit_snapshot ใน scenario.json")
    systems = {s for s, group in GNSS_GROUPS.items() if (snapshot_dir / f"{group}.json").is_file()}
    if not systems:
        raise OrbitUnavailableError(f"snapshot {snapshot_dir} ไม่มีไฟล์ OMM ของกลุ่มใดเลย "
                                    f"({', '.join(f'{g}.json' for g in GNSS_GROUPS.values())})")
    return snapshot_dir, systems


def _files_sha256(snapshot_dir: Path, systems: set[str]) -> dict[str, str]:
    """SHA-256 ของทุกไฟล์ใน snapshot ที่ build_catalog อ่าน (OMM ของระบบที่ใช้, IGS metadata, broadcast ถ้ามี)"""
    names = [f"{group}.json" for system, group in GNSS_GROUPS.items() if system in systems] + [IGS_METADATA_FILE]
    nav = broadcast_file(snapshot_dir)
    if nav is not None:
        names.append(nav.relative_to(snapshot_dir).as_posix())
    return {name: file_sha256(snapshot_dir / name) for name in names}


@dataclass(frozen=True)
class _Selection:
    names: dict[int, str]                  # NORAD -> ชื่อใน scenario (ไม่ซ้ำ ตามลำดับใน scenario)
    scoped: Catalog                        # catalog เฉพาะดาวใน scenario (สำหรับ manifest)
    selected: list[CatalogSatellite]       # ดาวที่แสดงและจะ propagate
    messages: list[Message]


def _select(sc: EngineScenario, catalog: Catalog) -> _Selection:
    names: dict[int, str] = {}
    for name, norad in sc.satellites:
        names.setdefault(norad, name)
    by_norad = {s.norad: s for s in catalog.satellites}
    unmapped = {u["norad"]: u for u in catalog.unmapped}
    missing = []
    for norad, name in names.items():
        if norad in by_norad:
            continue
        u = unmapped.get(norad)
        why = _UNMAPPED_REASON.get(u["reason"], u["reason"]) if u else "ไม่มีข้อมูล OMM ของดาวนี้"
        missing.append(Message("SAT_NOT_IN_SNAPSHOT", "warning",
                               f"ดาว {name} (NORAD {norad}) ไม่มีใน snapshot {sc.orbit_snapshot}: {why}", name))
    in_scenario = [s for s in catalog.satellites if s.norad in names]
    prns = {s.prn for s in in_scenario}
    # SAT_FLAGGED ของ catalog มีทุกดวงใน snapshot เก็บเฉพาะดวงใน scenario (object ของข้อความคือ PRN)
    catalog_messages = [m for m in catalog.messages if m.code != "SAT_FLAGGED" or m.object in prns]
    scoped = Catalog(in_scenario, [u for u in catalog.unmapped if u["norad"] in names], catalog_messages)
    selected = [s for s in in_scenario if is_shown(s, sc.show_too_old, sc.show_no_broadcast)]
    return _Selection(names, scoped, selected, catalog_messages + missing)


def _no_satellites(sel: _Selection) -> NoSatellitesError:
    parts = []
    hidden = [s.prn for s in sel.scoped.satellites]
    if hidden:
        parts.append(f"ถูกซ่อนด้วยตัวกรอง {len(hidden)} ดวง ({', '.join(hidden)}) "
                     "เปิด satellite_filter.show_too_old หรือ show_no_broadcast เพื่อแสดง")
    absent = len(sel.names) - len(hidden)
    if absent:
        parts.append(f"ไม่มีใน snapshot {absent} ดวง")
    detail = "; ".join(parts) if parts else "scenario ไม่มีดาวเทียม"
    return NoSatellitesError(f"ไม่มีดาวที่จะ propagate จากดาวใน scenario {len(sel.names)} ดวง: {detail}")


def run_propagate(scenario_dir: Path, data_dir: Path = DATA_DIR, console: Path | None = None,
                  progress: Progress | None = None) -> tuple[Path, list[Message]]:
    """propagate ดาวใน scenario ที่แสดง (is_shown) ด้วย GMAT แล้วเขียน `<scenario_dir>/ephem/<hash>/`
    (manifest.json, predicted.sp3, scene.czml) ถ้ามีโฟลเดอร์ของ hash นี้แล้วคืนทันทีโดยไม่รัน GMAT

    catalog สร้างจากทุกระบบที่มีไฟล์ OMM ใน snapshot, ดาวที่ไม่มีใน catalog ได้ SAT_NOT_IN_SNAPSHOT (D8)
    ไม่มีดาวให้ propagate หรือ GMAT ไม่ได้ผลของดวงใดเลย: NoSatellitesError
    console เป็น None: หา GmatConsole เองเมื่อต้องรันจริงเท่านั้น
    """
    report = _reporter(progress)
    report("scenario", 0.0)
    scenario_dir = Path(scenario_dir)
    sc = _load(scenario_dir)
    snapshot_dir, systems = _snapshot(data_dir, sc)
    report("catalog", 0.05)
    catalog = build_catalog(snapshot_dir, (sc.start, sc.stop), systems)
    sel = _select(sc, catalog)
    if not sel.selected:
        raise _no_satellites(sel)

    files_sha256 = _files_sha256(snapshot_dir, systems)
    prn_of = {s.norad: s.prn for s in catalog.satellites}
    ephem_dir = scenario_dir / EPHEM_DIR / input_hash({
        "engine_version": ENGINE_VERSION,
        "files_sha256": files_sha256,
        "start": _iso_s(sc.start),
        "stop": _iso_s(sc.stop),
        "step_s": sc.step_s,
        "satellites": [{"prn": prn_of.get(norad), "norad": norad} for norad in sorted(sel.names)],
        "show_too_old": sc.show_too_old,
        "show_no_broadcast": sc.show_no_broadcast,
    })
    if ephem_dir.is_dir():
        messages = _read_manifest(ephem_dir).messages
        report("done", 1.0)
        return ephem_dir, messages

    report("gmat", 0.1)
    console = Path(console) if console is not None else find_gmat_console()
    version = gmat_version(console)
    messages = list(sel.messages)
    with tempfile.TemporaryDirectory(prefix="gnss-studio-") as tmp:
        work_dir = Path(tmp)
        eph, gmat_messages = propagate(sel.selected, sc.start, sc.stop, sc.step_s, work_dir, console)
        messages += gmat_messages
        if not eph.positions_km:
            raise NoSatellitesError(f"GMAT ไม่ได้ตำแหน่งของดาวดวงใดเลยจาก {len(sel.selected)} ดวง: "
                                    + "; ".join(m.text for m in gmat_messages))
        report("write", 0.9)
        write_sp3(eph.times_utc, eph.positions_km, work_dir / PREDICTED_SP3)
        sp3_bytes = (work_dir / PREDICTED_SP3).read_bytes()

    inputs = {"orbit_snapshot": sc.orbit_snapshot, "files_sha256": files_sha256, "start": _iso_s(sc.start),
              "stop": _iso_s(sc.stop), "step_s": sc.step_s, "show_too_old": sc.show_too_old,
              "show_no_broadcast": sc.show_no_broadcast}
    manifest = build_manifest("ephem", inputs, sel.scoped, messages, {"gmat_version": version},
                              propagated=frozenset(eph.positions_km))
    out = write_bundle(ephem_dir, {
        MANIFEST: _json_bytes(manifest),
        PREDICTED_SP3: sp3_bytes,
        SCENE_CZML: _json_bytes(satellites_czml(eph), compact=True),
    })
    report("done", 1.0)
    return out, messages


# ---------- analyze ----------

def _find_facility(sc: EngineScenario, name: str) -> Facility:
    """ชื่อ object ใน scenario ไม่ซ้ำกันแบบไม่แยกตัวพิมพ์ จึงเทียบแบบไม่แยกตัวพิมพ์ได้"""
    for fac in sc.facilities:
        if fac.name.casefold() == name.casefold():
            return fac
    known = ", ".join(f.name for f in sc.facilities) or "ไม่มี"
    raise ScenarioError(f"scenario.json ไม่มี Facility ชื่อ '{name}' (Facility ที่มี: {known})", "objects")


def _dop_gaps(dops: list[dict], fac: Facility) -> list[Message]:
    all_rows = [r for r in dops if r["system"] == "ALL"]
    gaps = sum(1 for r in all_rows if r["gdop"] is None)
    if not gaps:
        return []
    return [Message("DOP_GAPS", "warning",
                    f"Facility {fac.name}: คำนวณ DOP รวมทุกระบบไม่ได้ {gaps} จาก {len(all_rows)} จุดเวลา "
                    "(ดาวที่ใช้ได้น้อยกว่า 4 ดวงหรือเรขาคณิตของดาวไม่พอ)", fac.name)]


def run_analyze(scenario_dir: Path, facility: str, data_dir: Path = DATA_DIR, console: Path | None = None,
                progress: Progress | None = None) -> tuple[Path, list[Message]]:
    """AER, ช่วง access, DOP และ CZML ของ Facility จากผล propagate เขียน `<scenario_dir>/access/<facility>/<hash>/`

    เรียก run_propagate ก่อนเสมอ (D10: ถ้ามีผลเดิมจะใช้ทันที) ตำแหน่งดาวมาจาก predicted.sp3 และธงจาก manifest.json ของ ephem
    คืนข้อความของ propagate ต่อด้วยข้อความของ analyze (manifest ของ access เก็บเฉพาะข้อความของ analyze)
    """
    report = _reporter(progress)
    report("scenario", 0.0)
    scenario_dir = Path(scenario_dir)
    sc = _load(scenario_dir)
    fac = _find_facility(sc, facility)                 # ตรวจก่อนเสียเวลา propagate
    ephem_dir, messages = run_propagate(scenario_dir, data_dir, console,
                                        progress=lambda stage, f: report(f"propagate.{stage}", 0.5 * f))
    ephem = _read_manifest(ephem_dir)
    inputs = {"ephem_hash": ephem_dir.name, "facility": asdict(fac), "shell_km": sc.shell_km}
    access_dir = scenario_dir / ACCESS_DIR / fac.name / input_hash(inputs)
    if access_dir.is_dir():
        messages = messages + _read_manifest(access_dir).messages
        report("done", 1.0)
        return access_dir, messages

    report("aer", 0.5)
    eph = ephemeris_from_sp3(ephem_dir / PREDICTED_SP3)
    rows = aer_rows(eph, fac, sc.shell_km)
    intervals = access_intervals(eph, fac)
    report("dop", 0.7)
    dops = dop_series(rows, fac, ephem.flags, times_utc=eph.times_utc)
    access_messages = _dop_gaps(dops, fac)
    report("write", 0.9)
    # โครงเดียวกับ manifest ของ ephem: รายชื่อดาวและธงคัดมาจาก ephem
    manifest = build_manifest("access", inputs, None, access_messages,
                              {"satellites": ephem.data["satellites"], "unmapped": ephem.data["unmapped"]})
    out = write_bundle(access_dir, {
        MANIFEST: _json_bytes(manifest),
        "aer.csv": _csv_bytes(AER_HEADER, [_aer_csv_row(r) for r in rows]),
        "intervals.json": _json_bytes(_intervals_doc(fac, intervals)),
        "dop.csv": _csv_bytes(DOP_HEADER, [_dop_csv_row(r) for r in dops]),
        "access.czml": _json_bytes(access_czml(fac, intervals, (eph.times_utc[0], eph.times_utc[-1])), compact=True),
        "legacy_gps.csv": _csv_bytes(LEGACY_HEADER, legacy_rows(rows)),
    })
    report("done", 1.0)
    return out, messages + access_messages


# ---------- CLI ----------

def _systems_arg(text: str) -> str:
    try:
        _system_letters(text)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(str(exc)) from None
    return text.upper()


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="python3 -m gnss_predict.studio",
                                description="GNSS Studio engine: ดึงข้อมูลวงโคจร, propagate ด้วย GMAT "
                                            "และคำนวณ access/DOP ของ scenario")
    sub = p.add_subparsers(dest="command", required=True)
    data_help = "โฟลเดอร์ข้อมูลที่มี orbits/ (ค่าเริ่มต้นจากตัวแปร GNSS_STUDIO_DATA หรือ data/ ของแพ็กเกจ)"
    scenario_help = "โฟลเดอร์ scenario ที่มี scenario.json"

    fetch = sub.add_parser("fetch", help="ดึง OMM, IGS metadata และ broadcast เป็น snapshot ใหม่ใน <data>/orbits/")
    fetch.add_argument("--data", type=Path, default=DATA_DIR, help=data_help)
    fetch.add_argument("--systems", type=_systems_arg, default="GREC",
                       help="ระบบที่ดึง: G (GPS), R (GLONASS), E (Galileo), C (BeiDou) ค่าเริ่มต้น GREC")

    prop = sub.add_parser("propagate", help="propagate ดาวใน scenario ด้วย GMAT ได้ ephem/<hash>/")
    prop.add_argument("--scenario", type=Path, required=True, help=scenario_help)
    prop.add_argument("--data", type=Path, default=DATA_DIR, help=data_help)

    analyze = sub.add_parser("analyze", help="คำนวณ AER, ช่วง access และ DOP ของ Facility ได้ access/<facility>/<hash>/")
    analyze.add_argument("--scenario", type=Path, required=True, help=scenario_help)
    analyze.add_argument("--facility", required=True, help="ชื่อ Facility ใน scenario")
    analyze.add_argument("--data", type=Path, default=DATA_DIR, help=data_help)
    return p


def main(argv: list[str] | None = None, now: datetime | None = None) -> int:
    try:
        args = _parser().parse_args(argv)
    except SystemExit as exc:              # argparse: ตัวเลือกผิด exit 2, --help exit 0
        return exc.code if isinstance(exc.code, int) else (0 if exc.code is None else 2)
    data_dir = args.data.resolve()
    try:
        if args.command == "fetch":
            path, messages = fetch_snapshot(data_dir, now or datetime.now(timezone.utc), systems=args.systems)
        elif args.command == "propagate":
            path, messages = run_propagate(args.scenario.resolve(), data_dir)
        else:
            path, messages = run_analyze(args.scenario.resolve(), args.facility, data_dir)
    except GnssPredictError as exc:
        print(f"error: {getattr(exc, 'code', type(exc).__name__)}: {exc}", file=sys.stderr)
        return 1
    print(path)
    for m in messages:
        print(f"{m.level}: {m.text}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
