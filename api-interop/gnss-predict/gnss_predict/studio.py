"""GNSS Studio engine: ดึงข้อมูลวงโคจร, propagate, analyze และ validate (หัวข้อ 5.13 ของ spec engine)

    python3 -m gnss_predict.studio fetch     [--data DIR] [--systems GREC[X]]
    python3 -m gnss_predict.studio propagate --scenario DIR [--data DIR]
    python3 -m gnss_predict.studio analyze   --scenario DIR --facility NAME [--data DIR]
    python3 -m gnss_predict.studio validate  --scenario DIR --day YYYY-MM-DD [--sp3 FILE] [--facility NAME] [--data DIR]
    python3 -m gnss_predict.studio report    --scenario DIR --style NAME --object PATH [--object PATH ...]
                                             [--kind report|graph] [--format txt|csv] [--start T --stop T] [--step S]
                                             [--data DIR]

- ทุกคำสั่งเป็นฟังก์ชันที่ server เรียกได้ตรง (`fetch_snapshot`, `run_propagate`, `run_analyze`, `run_validate`)
  CLI แค่แปลง argument
- `plan_propagate` และ `plan_analyze` คืน hash ของโฟลเดอร์ผลลัพธ์โดยไม่รัน GMAT และไม่เขียนไฟล์ (ใช้ตรวจว่ามีผลเดิมหรือไม่)
- `on_gmat_start(pgid)` ของ run_propagate, run_analyze และ run_validate ถูกเรียกเมื่อ GMAT เริ่มทำงาน (server ใช้ยกเลิกงาน)
- โครงสร้างบนดิสก์ตามหัวข้อ 7.1 ของ spec ภาพรวม: `<data>/orbits/<YYYYMMDDTHHMMZ>/` (cache ดาวน์โหลดอยู่ที่
  `<data>/orbits/_cache/`), `<scenario>/ephem/<hash>/` และ `<scenario>/access/<facility>/<hash>/`
- โฟลเดอร์ผลลัพธ์เขียนครั้งเดียวด้วย `write_bundle` ถ้ามีโฟลเดอร์ของ hash เดียวกันอยู่แล้วคืนโฟลเดอร์นั้นทันที (ผลเดิม)
  และคืนข้อความที่บันทึกไว้ใน manifest.json ของผลนั้น (validate ไม่สร้างโฟลเดอร์ใหม่: เขียน validation_<วัน>.json/.md
  เพิ่มในโฟลเดอร์ ephem แบบ atomic ทีละไฟล์ แทนที่ไฟล์ของวันเดียวกันที่มีอยู่)
- `progress(stage, fraction)`: stage เป็นชื่อขั้นภาษาอังกฤษ fraction 0–1 ของทั้งฟังก์ชัน
  เรียกด้วย 0.0 ตอนเริ่มและ 1.0 ตอนจบ (ไม่เรียก 1.0 ถ้าจบด้วย exception)
- CLI พิมพ์ path ผลลัพธ์บรรทัดแรกตามด้วย `<level>: <text>` ของแต่ละ Message ลง stdout
  exit code: 0 สำเร็จ, 1 GnssPredictError (พิมพ์ลง stderr), 2 argument ผิด
- `report` อ่านผลที่ propagate/analyze ไว้แล้วเท่านั้น (ไม่รัน GMAT ไม่ analyze ให้ ไม่มีผลที่ตรง = RESULTS_NOT_CURRENT)
  พิมพ์ตัวรายงาน (.txt หรือ .csv) ลง stdout ไม่พิมพ์ path: style หาจาก Scenario Styles (`styles` ใน scenario.json)
  แล้ว Installed Styles, DateFormat จาก `units` ของ scenario.json, `--object` ซ้ำได้ (Access = คู่ path ในข้อเดียว)
  start/stop เป็นเวลา ISO ที่ระบุเขตเวลา ไม่ส่ง = ช่วงวิเคราะห์ของ scenario ไม่ส่ง --step = ทุกจุดของ scenario
  ต่างจากรายงานของ server/หน้าเว็บ: CLI ไม่อ่าน `time` ของ style, ช่วงเวลาที่เก็บไว้ของ access (Use Object Time Period) และ My Styles
  ช่วงเวลาและ step มาจาก --start/--stop/--step เท่านั้น
"""

import argparse
import csv
import hashlib
import io
import json
import os
import sys
import tempfile
from collections.abc import Callable, Sequence
from dataclasses import asdict, dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.request import urlopen

from . import brdc, imaging
from .analyze import AerRow, Interval, access_intervals, aer_rows, global_statistics, legacy_rows
from .brdc import Nav, brdc_file_name, fetch_brdc, read_nav
from .bundle import build_manifest, file_sha256, input_hash, write_bundle
from .catalog import BRDC_DIR, IGS_METADATA_FILE, Catalog, CatalogSatellite, broadcast_file, is_shown
from .config import BRDC_DAYS_BACK, CELESTRAK_STATE_FILE, DATA_DIR, ENGINE_VERSION, GNSS_GROUPS
from .czml import access_czml, satellites_czml
from .dop import dop_series
from .errors import (BrdcUnavailableError, GnssPredictError, Message, NoSatellitesError, OrbitUnavailableError,
                     ResultCorruptError, ScenarioError, Sp3FormatError, Sp3UnavailableError)
from .igs_meta import fetch_metadata
from .imaging import GEO_AGE_SHOWN_MAX_DAYS, IMAGING_GROUPS, IMAGING_LETTER, IMAGING_NORADS
from .omm import fetch_group
from .predict import HEADER as LEGACY_HEADER
from .propagate import ephemeris_from_sp3, propagate
from .run_gmat import find_gmat_console, gmat_version
from .scenario import EngineScenario, Facility, load_scenario
from .sp3 import MAX_SATELLITES as MAX_PROPAGATED_SATELLITES, fetch_mgx_sp3, write_sp3
from .studio_validate import imaging_skipped_text, validate_ephemeris, validation_markdown

Progress = Callable[[str, float], None]

ORBITS_DIR = "orbits"
CACHE_DIR = "_cache"                       # <data>/orbits/_cache เดียวกับ config.OMM_CACHE_DIR ของ CLI เดิม
SHA256SUMS = "SHA256SUMS"
SNAPSHOT_TIME_FMT = "%Y%m%dT%H%MZ"

SCENARIO_FILE = "scenario.json"
EPHEM_DIR = "ephem"
ACCESS_DIR = "access"
MANIFEST = "manifest.json"
PREDICTED_SP3 = "predicted.sp3"
SCENE_CZML = "scene.czml"
TRUTH_DIR = "truth"
VALIDATION_DIR = "validation"
HISTORY_FILE = "history.jsonl"

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
        raise ResultCorruptError(f"อ่าน {path} ไม่ได้ ({type(exc).__name__}: {exc}) "
                                 f"ให้ลบโฟลเดอร์ {bundle_dir} แล้วรันใหม่") from exc
    return _StoredManifest(data, messages, flags)


# ---------- fetch ----------

def _system_letters(systems: str) -> list[str]:
    """ตัวอักษรระบบ GNSS เรียงตาม GNSS_GROUPS แล้วตามด้วย X (กลุ่มดาวถ่ายภาพ) ถ้ามี
    ต้องมีระบบ GNSS อย่างน้อยหนึ่งตัวและไม่มีตัวที่ไม่รู้จัก ไม่งั้น ValueError (snapshot ที่ไม่มี OMM ของ GNSS ใช้ propagate ไม่ได้)"""
    letters = systems.upper() if isinstance(systems, str) else ""
    gnss = [s for s in GNSS_GROUPS if s in letters]
    if not gnss or set(letters) - set(GNSS_GROUPS) - {IMAGING_LETTER}:
        raise ValueError(f"ระบบดาวเทียมต้องเป็นตัวอักษร {''.join(GNSS_GROUPS)} อย่างน้อยหนึ่งตัว "
                         f"(เพิ่ม {IMAGING_LETTER} เพื่อดึงกลุ่มดาวถ่ายภาพ) ได้ {systems!r}")
    return gnss + ([IMAGING_LETTER] if IMAGING_LETTER in letters else [])


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


def _cache_time(group: str, path: Path) -> datetime | None:
    """เวลาที่ดาวน์โหลดจากชื่อไฟล์ <group>_<YYYYMMDDTHHMMZ>.json ใน cache (ชื่อผิดรูป: None)"""
    try:
        return datetime.strptime(path.stem[len(group) + 1:], SNAPSHOT_TIME_FMT).replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _latest_cached(cache: Path, group: str) -> Path | None:
    """ไฟล์ <group>_*.json ใน cache ที่ดาวน์โหลดล่าสุด (เฉพาะชื่อที่อ่านเวลาได้) ไม่มี: None"""
    dated = [(t, p) for p in cache.glob(f"{group}_*.json") if (t := _cache_time(group, p)) is not None]
    return max(dated)[1] if dated else None


def _imaging_file_problem(group: str, path: Path, now: datetime) -> str | None:
    """ไฟล์กลุ่ม imaging จาก cache ใส่ใน snapshot ได้เมื่อ |อายุ| (จากเวลาในชื่อไฟล์) ไม่เกิน GEO_AGE_SHOWN_MAX_DAYS
    (Ruling y: ไฟล์ที่เก่ากว่านี้ทำให้ดาว GEO ถูกซ่อนอยู่แล้ว เวลาในอนาคตคือนาฬิกาเพี้ยน จึงเทียบค่าสัมบูรณ์เหมือน catalog)
    ใช้ได้: None ใช้ไม่ได้: เหตุผลภาษาไทยที่มีชื่อไฟล์"""
    fetched = _cache_time(group, path)
    if fetched is None:
        return f"{path.name} อ่านเวลาที่ดาวน์โหลดจากชื่อไฟล์ไม่ได้"
    age_days = (now - fetched).total_seconds() / 86400
    if abs(age_days) <= GEO_AGE_SHOWN_MAX_DAYS:
        return None
    if age_days < 0:
        return f"{path.name} เวลาในชื่อไฟล์เลยเวลาปัจจุบันไป {-age_days:.1f} วัน"
    return f"{path.name} อายุ {age_days:.1f} วัน เกิน {GEO_AGE_SHOWN_MAX_DAYS:g} วัน"


def _imaging_too_old(level: str, dropped: list[tuple[str, str]]) -> Message:
    """ข้อความเดียวของทุกกลุ่ม imaging ที่ไม่ใส่ใน snapshot: dropped = [(กลุ่ม, เหตุผล)]"""
    groups = ", ".join(group for group, _ in dropped)
    reasons = "; ".join(reason for _, reason in dropped)
    return Message("IMAGING_CACHE_TOO_OLD", level,
                   f"ไม่ใส่ข้อมูลวงโคจรกลุ่ม {groups} ของดาวถ่ายภาพใน snapshot นี้: ไฟล์ล่าสุดใน cache ({reasons}) "
                   f"ให้ดึงข้อมูลวงโคจรพร้อมดาวถ่ายภาพ (ระบบ {IMAGING_LETTER}) ใหม่")


def _sha256sums(files: dict[str, bytes]) -> bytes:
    """บรรทัด `<sha256>  <path สัมพัทธ์>` เรียงตาม path แบบเดียวกับ sha256sum"""
    return "".join(f"{hashlib.sha256(data).hexdigest()}  {name}\n"
                   for name, data in sorted(files.items())).encode("utf-8")


def _differs_from_existing(final_dir: Path, sums: bytes) -> bool:
    """snapshot ของนาทีนี้มีอยู่แล้วและ SHA256SUMS ต่างจากที่เพิ่งประกอบ (อ่าน SHA256SUMS เดิมไม่ได้นับว่าต่าง)
    write_bundle จะคงโฟลเดอร์เดิมไว้ ข้อมูลที่เพิ่งดึง (เช่นกลุ่ม imaging ของ fetch รอบหลัง) จึงไม่เข้า snapshot นี้"""
    if not final_dir.exists():
        return False
    try:
        return (final_dir / SHA256SUMS).read_bytes() != sums
    except OSError:
        return True


def fetch_snapshot(data_dir: Path, now: datetime, systems: str = "GREC", opener=urlopen,
                   brdc_fetcher=brdc.fetch_brdc, progress: Progress | None = None) -> tuple[Path, list[Message]]:
    """ดึง OMM ของทุกกลุ่มใน systems, IGS metadata และ broadcast ลง cache แล้วรวมเป็น snapshot
    `<data_dir>/orbits/<now:%Y%m%dT%H%MZ>/` (`<group>.json`, `igs_satellite_metadata.snx`, `brdc/<ชื่อไฟล์>`, SHA256SUMS)

    กติกาการดาวน์โหลด (CelesTrak 2 ชม., IGS วันละครั้ง) อยู่ใน fetch_group และ fetch_metadata ซึ่งใช้ไฟล์ใน cache แทนเมื่อดึงไม่ได้
    broadcast ลองของเมื่อวาน (UTC) แล้วของสองวันก่อน ไม่ได้ทั้งคู่ได้ BRDC_UNAVAILABLE และ snapshot ไม่มีโฟลเดอร์ brdc

    กลุ่มดาวถ่ายภาพ (IMAGING_GROUPS) อยู่ใน snapshot ทุกครั้งที่มีไฟล์ให้ใช้ (Ruling q, y):
    - มี X ใน systems: ดึงด้วย fetch_group ตามกติกาเดิม ดึงไม่ได้และไม่มี cache ได้ IMAGING_GROUP_UNAVAILABLE (ไม่ raise)
    - ไม่มี X: คัดลอกไฟล์ล่าสุดใน cache โดยไม่ส่ง request (ไม่มีไฟล์: ไม่มีกลุ่มนั้นและไม่มีข้อความ)
    - ทั้งสองกรณีใส่เฉพาะไฟล์ที่ |อายุ| ไม่เกิน GEO_AGE_SHOWN_MAX_DAYS วัน ที่เกินได้ IMAGING_CACHE_TOO_OLD:
      มี X เป็น warning ต่อกลุ่ม ไม่มี X (เช่นงานรายวัน) เป็น info ข้อความเดียวที่บอกทุกกลุ่มที่ไม่ใส่

    snapshot ที่มีอยู่แล้วไม่ถูกแก้ไข: ถ้า fetch อีกครั้งในนาทีเดียวกัน (โฟลเดอร์ชื่อเดียวกัน) แล้ว SHA256SUMS ต่างจากของเดิม
    (เช่น GREC แล้ว GRECX กลุ่ม imaging จึงไม่เข้า snapshot) ได้ warning SNAPSHOT_SAME_MINUTE ข้อมูลที่ดึงอยู่ใน cache แล้ว
    """
    report = _reporter(progress)
    letters = _system_letters(systems)
    now = now.astimezone(timezone.utc)
    orbits = Path(data_dir) / ORBITS_DIR
    cache = orbits / CACHE_DIR
    report("omm", 0.0)
    messages: list[Message] = []
    files: dict[str, bytes] = {}
    with_imaging = IMAGING_LETTER in letters
    groups = [GNSS_GROUPS[s] for s in letters if s in GNSS_GROUPS] + (list(IMAGING_GROUPS) if with_imaging else [])
    for i, group in enumerate(groups):
        if group in IMAGING_GROUPS:
            try:
                path, msgs = fetch_group(group, cache, cache / CELESTRAK_STATE_FILE, now, opener=opener)
            except OrbitUnavailableError as exc:            # กลุ่ม imaging ไม่ทำให้ snapshot ของ GNSS ล้ม
                path, msgs = None, [Message("IMAGING_GROUP_UNAVAILABLE", "warning",
                                            f"{exc} snapshot นี้จึงไม่มีข้อมูลวงโคจรกลุ่ม {group} ของดาวถ่ายภาพ")]
            problem = _imaging_file_problem(group, path, now) if path is not None else None
            if problem is not None:
                path, msgs = None, msgs + [_imaging_too_old("warning", [(group, problem)])]
        else:
            path, msgs = fetch_group(group, cache, cache / CELESTRAK_STATE_FILE, now, opener=opener)
        if path is not None:
            files[f"{group}.json"] = path.read_bytes()
        messages += msgs
        report("omm", 0.6 * (i + 1) / len(groups))
    if not with_imaging:
        dropped: list[tuple[str, str]] = []
        for group in IMAGING_GROUPS:
            path = _latest_cached(cache, group)
            if path is None:
                continue
            problem = _imaging_file_problem(group, path, now)
            if problem is None:
                files[f"{group}.json"] = path.read_bytes()
            else:
                dropped.append((group, problem))
        if dropped:
            messages.append(_imaging_too_old("info", dropped))
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
    final_dir = orbits / now.strftime(SNAPSHOT_TIME_FMT)
    if _differs_from_existing(final_dir, files[SHA256SUMS]):
        messages.append(Message("SNAPSHOT_SAME_MINUTE", "warning",
                                f"ข้อมูลที่ดึงครั้งนี้เข้า cache แล้ว แต่ snapshot ของนาทีนี้ ({final_dir.name}) มีอยู่แล้วจึงไม่ถูกแก้ไข "
                                "ให้กด Fetch Now อีกครั้งในนาทีถัดไปเพื่อสร้าง snapshot ใหม่จากข้อมูลใน cache "
                                "(ครั้งนั้นจะไม่ส่งคำขอใหม่ไปยัง CelesTrak)"))
    snapshot = write_bundle(final_dir, files)           # โฟลเดอร์ที่มีอยู่แล้วคงเดิม (snapshot immutable)
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


def _files_sha256(snapshot_dir: Path, systems: set[str], imaging_files: Sequence[str] = ()) -> dict[str, str]:
    """SHA-256 ของทุกไฟล์ใน snapshot ที่ catalog ของฉากอ่าน (OMM ของระบบที่ใช้, ไฟล์กลุ่ม imaging ที่ส่งมา,
    IGS metadata, broadcast ถ้ามี) imaging_files ว่างเมื่อฉากไม่มีดาวถ่ายภาพ จึงได้ dict เดิมของฉาก GNSS ล้วน"""
    names = ([f"{group}.json" for system, group in GNSS_GROUPS.items() if system in systems] + list(imaging_files)
             + [IGS_METADATA_FILE])
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


@dataclass(frozen=True)
class PropagatePlan:
    """สิ่งที่ run_propagate จะทำ โดยไม่รัน GMAT: hash ของโฟลเดอร์ ephem, PRN ที่จะ propagate และข้อความจาก catalog/การเลือกดาว"""
    hash: str
    satellites: list[str]
    messages: list[Message]


@dataclass(frozen=True)
class _Plan:
    sc: EngineScenario
    sel: _Selection
    files_sha256: dict[str, str]
    hash: str


def _plan(scenario_dir: Path, data_dir: Path, report: Progress | None = None) -> _Plan:
    """โหลด scenario, สร้าง catalog, เลือกดาว และคำนวณ hash ของ ephem (ไม่รัน GMAT ไม่เขียนไฟล์)
    ไม่มีดาวให้ propagate: NoSatellitesError"""
    sc = _load(Path(scenario_dir))
    snapshot_dir, systems = _snapshot(data_dir, sc)
    if report is not None:
        report("catalog", 0.05)
    # อ่านไฟล์กลุ่ม imaging และรวมเข้า hash เฉพาะฉากที่มีดาวถ่ายภาพ (Ruling a) ฉาก GNSS ล้วนจึงได้ hash เดิม
    with_imaging = not {n for _, n in sc.satellites}.isdisjoint(IMAGING_NORADS)
    from . import custom_satellites as custom
    with_custom = custom.selected(snapshot_dir, {n for _, n in sc.satellites})
    catalog = imaging.scenario_catalog(snapshot_dir, (sc.start, sc.stop), systems, with_imaging, with_custom)
    sel = _select(sc, catalog)
    if not sel.selected:
        raise _no_satellites(sel)
    if len(sel.selected) > MAX_PROPAGATED_SATELLITES:
        raise ScenarioError(f"เลือกคำนวณได้สูงสุด {MAX_PROPAGATED_SATELLITES} ดวงต่อ Scenario ให้ลดดาวที่เลือกก่อนคำนวณ", "objects")

    extra_files = imaging.imaging_group_files(snapshot_dir) if with_imaging else []
    if with_custom:
        extra_files.append(custom.FILE)
    files_sha256 = _files_sha256(snapshot_dir, systems, extra_files)
    prn_of = {s.norad: s.prn for s in catalog.satellites}
    digest = input_hash({
        "engine_version": ENGINE_VERSION,
        "files_sha256": files_sha256,
        "start": _iso_s(sc.start),
        "stop": _iso_s(sc.stop),
        "step_s": sc.step_s,
        "satellites": [{"prn": prn_of.get(norad), "norad": norad} for norad in sorted(sel.names)],
        "show_too_old": sc.show_too_old,
        "show_no_broadcast": sc.show_no_broadcast,
    })
    return _Plan(sc, sel, files_sha256, digest)


def plan_propagate(scenario_dir: Path, data_dir: Path = DATA_DIR) -> PropagatePlan:
    """hash ของ `<scenario_dir>/ephem/<hash>/` ที่ run_propagate จะใช้ พร้อม PRN ที่จะ propagate (ไม่รัน GMAT ไม่เขียนไฟล์)
    ไม่มีดาวให้ propagate: NoSatellitesError เหมือน run_propagate"""
    plan = _plan(scenario_dir, data_dir)
    return PropagatePlan(plan.hash, [s.prn for s in plan.sel.selected], list(plan.sel.messages))


def run_propagate(scenario_dir: Path, data_dir: Path = DATA_DIR, console: Path | None = None,
                  progress: Progress | None = None,
                  on_gmat_start: Callable[[int], None] | None = None) -> tuple[Path, list[Message]]:
    """propagate ดาวใน scenario ที่แสดง (is_shown) ด้วย GMAT แล้วเขียน `<scenario_dir>/ephem/<hash>/`
    (manifest.json, predicted.sp3, scene.czml) ถ้ามีโฟลเดอร์ของ hash นี้แล้วคืนทันทีโดยไม่รัน GMAT

    catalog สร้างจากทุกระบบที่มีไฟล์ OMM ใน snapshot (รวมดาวถ่ายภาพเมื่อฉากมี NORAD ของดาวถ่ายภาพ)
    ดาวที่ไม่มีใน catalog ได้ SAT_NOT_IN_SNAPSHOT (D8)
    ไม่มีดาวให้ propagate หรือ GMAT ไม่ได้ผลของดวงใดเลย: NoSatellitesError
    console เป็น None: หา GmatConsole เองเมื่อต้องรันจริงเท่านั้น
    on_gmat_start(pgid): เรียกเมื่อ GMAT เริ่มทำงาน (process group id สำหรับยกเลิกงาน) ไม่เรียกถ้าใช้ผลเดิม
    """
    report = _reporter(progress)
    report("scenario", 0.0)
    scenario_dir = Path(scenario_dir)
    plan = _plan(scenario_dir, data_dir, report)
    sc, sel, files_sha256 = plan.sc, plan.sel, plan.files_sha256
    ephem_dir = scenario_dir / EPHEM_DIR / plan.hash
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
        hook = {} if on_gmat_start is None else {"on_gmat_start": on_gmat_start}
        eph, gmat_messages = propagate(sel.selected, sc.start, sc.stop, sc.step_s, work_dir, console, **hook)
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


def _access_inputs(ephem_hash: str, fac: Facility, sc: EngineScenario) -> dict:
    """ข้อมูลตั้งต้นของ access (ใช้ทำ hash และเก็บใน manifest)"""
    return {"ephem_hash": ephem_hash, "facility": asdict(fac), "shell_km": sc.shell_km}


def plan_analyze(scenario_dir: Path, facility: str, data_dir: Path = DATA_DIR) -> str:
    """hash ของ `<scenario_dir>/access/<facility>/<hash>/` ที่ run_analyze จะใช้ (ไม่รัน GMAT ไม่เขียนไฟล์)
    Facility ไม่มีใน scenario: ScenarioError ไม่มีดาวให้ propagate: NoSatellitesError เหมือน run_analyze"""
    scenario_dir = Path(scenario_dir)
    sc = _load(scenario_dir)
    fac = _find_facility(sc, facility)
    return input_hash(_access_inputs(plan_propagate(scenario_dir, data_dir).hash, fac, sc))


def run_analyze(scenario_dir: Path, facility: str, data_dir: Path = DATA_DIR, console: Path | None = None,
                progress: Progress | None = None,
                on_gmat_start: Callable[[int], None] | None = None) -> tuple[Path, list[Message]]:
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
                                        progress=lambda stage, f: report(f"propagate.{stage}", 0.5 * f),
                                        on_gmat_start=on_gmat_start)
    ephem = _read_manifest(ephem_dir)
    inputs = _access_inputs(ephem_dir.name, fac, sc)
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


# ---------- validate ----------

def _write_atomic(path: Path, data: bytes) -> None:
    """เขียนไฟล์ข้างปลายทางแล้ว os.replace (ผู้อ่านเห็นไฟล์เก่าหรือไฟล์ใหม่ครบ ไม่เห็นไฟล์ที่เขียนค้าง)"""
    tmp = path.with_name(f"{path.name}.tmp-{os.getpid()}")
    try:
        tmp.write_bytes(data)
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


def _validate_nav(day: date, data_dir: Path, snapshot_dir: Path) -> tuple[Nav | None, list[Message]]:
    """broadcast ของวัน day สำหรับดาว G/E/C ที่ไม่มีใน SP3 จริง

    ใช้ไฟล์ของวันนั้นที่มีอยู่แล้วใน `<snapshot>/brdc/` หรือ `<data>/orbits/_cache/` (cache เดียวกับที่ fetch ใช้)
    ก่อน ถ้าไม่มีจึงดึงลง `<data>/orbits/_cache/` ดึงหรืออ่านไม่ได้: ไม่มี nav พร้อม BRDC_UNAVAILABLE
    """
    cache = Path(data_dir) / ORBITS_DIR / CACHE_DIR
    gz = brdc_file_name(day)
    candidates = [folder / name for folder in (Path(snapshot_dir) / BRDC_DIR, cache)
                  for name in (gz, gz.removesuffix(".gz"))]
    local = next((p for p in candidates if p.is_file()), None)
    try:
        return read_nav(local if local is not None else fetch_brdc(day, cache)), []
    except (BrdcUnavailableError, OSError) as exc:      # OSError: เรียก curl ไม่ได้
        return None, [Message("BRDC_UNAVAILABLE", "warning",
                              f"ไม่มีไฟล์ broadcast ของวันที่ {day.isoformat()} ({exc}) "
                              "ดาว GPS, Galileo และ BeiDou ที่ไม่มีใน SP3 จริงจึงตรวจไม่ได้")]


def _check_sp3_arg(sp3: Path) -> None:
    """ไฟล์ SP3 ที่ผู้ใช้ระบุต้องมีอยู่และเปิดอ่านได้ ตรวจก่อน propagate เพื่อไม่เสียเวลารัน GMAT
    (เนื้อไฟล์ตรวจตอน read_sp3_all ซึ่งให้ Sp3FormatError)"""
    if not Path(sp3).is_file():
        raise Sp3UnavailableError(f"ไม่พบไฟล์ SP3 {sp3}")
    try:
        with open(sp3, "rb"):
            pass
    except OSError as exc:
        raise Sp3FormatError(f"เปิดไฟล์ SP3 {sp3} ไม่ได้ ({exc})") from exc


def _validate_truth(day: date, data_dir: Path, sp3: Path | None) -> Path:
    if sp3 is not None:
        return Path(sp3)                                 # ตรวจแล้วด้วย _check_sp3_arg
    try:
        return fetch_mgx_sp3(day, Path(data_dir) / TRUTH_DIR)
    except OSError as exc:                               # เรียก curl ไม่ได้
        raise Sp3UnavailableError(f"ดาวน์โหลด SP3 ของวันที่ {day.isoformat()} ไม่ได้ ({exc}) "
                                  "ดาวน์โหลด SP3 เองแล้วใช้ --sp3") from exc


def run_validate(scenario_dir: Path, day: date, data_dir: Path = DATA_DIR, sp3: Path | None = None,
                 facility: str | None = None, console: Path | None = None,
                 progress: Progress | None = None,
                 on_gmat_start: Callable[[int], None] | None = None) -> tuple[Path, list[Message]]:
    """เทียบ predicted.sp3 ของวัน day กับ SP3 MGEX จริง (ดึงเองถ้าไม่ระบุ sp3) แล้วเขียน
    `validation_<day>.json` และ `.md` ลงโฟลเดอร์ ephem และต่อท้าย `<data_dir>/validation/history.jsonl` หนึ่งบรรทัด

    คืนโฟลเดอร์ ephem กับข้อความของ propagate (ถ้ามีผลเดิมใช้ทันทีเหมือน run_analyze) ต่อด้วยข้อความของ validate
    facility เป็นจุดที่วัด Az/El ค่าตั้งต้นคือ Facility แรกใน scenario ดวงที่ไม่มีใน SP3 ใช้ broadcast ของวันนั้นแทน
    ผลที่ไม่ผ่านเกณฑ์ไม่ใช่ error: ดูได้จากช่อง pass ของ JSON
    """
    report = _reporter(progress)
    report("scenario", 0.0)
    scenario_dir = Path(scenario_dir)
    sc = _load(scenario_dir)
    if facility is not None:
        fac = _find_facility(sc, facility)
    elif sc.facilities:
        fac = sc.facilities[0]
    else:
        raise ScenarioError("scenario.json ไม่มี Facility ให้เป็นจุดวัด Az/El ของการตรวจ", "objects")
    day_start = datetime(day.year, day.month, day.day, tzinfo=timezone.utc)
    if not (sc.start < day_start + timedelta(days=1) and sc.stop >= day_start):        # ตรวจก่อนดาวน์โหลดอะไร
        raise ScenarioError(f"ช่วงวิเคราะห์ของ scenario ({_iso_s(sc.start)} ถึง {_iso_s(sc.stop)}) "
                            f"ไม่ครอบคลุมวันที่ {day.isoformat()}", "analysis_period")
    if sp3 is not None:
        _check_sp3_arg(sp3)

    ephem_dir, messages = run_propagate(scenario_dir, data_dir, console,
                                        progress=lambda stage, f: report(f"propagate.{stage}", 0.6 * f),
                                        on_gmat_start=on_gmat_start)
    report("truth", 0.6)
    truth = _validate_truth(day, data_dir, sp3)
    report("brdc", 0.7)
    nav, validate_messages = _validate_nav(day, data_dir, Path(data_dir) / ORBITS_DIR / sc.orbit_snapshot)
    report("compare", 0.8)
    manifest = _read_manifest(ephem_dir)
    ages = {s["prn"]: s.get("age_days") for s in manifest.data["satellites"]}
    result = validate_ephemeris(ephem_dir / PREDICTED_SP3, truth, nav, fac, manifest.flags, ages, day)
    # ดาวถ่ายภาพที่ propagate แล้วไม่มีค่าอ้างอิง validate_ephemeris จึงข้าม (Ruling u) บอกผู้ใช้หนึ่งข้อความ
    skipped = sum(1 for s in manifest.data["satellites"] if s["prn"][:1] == IMAGING_LETTER and s.get("propagated"))
    if skipped:
        validate_messages = validate_messages + [Message("IMAGING_SKIPPED", "info", imaging_skipped_text(skipped))]

    report("write", 0.9)
    created = _iso_s(datetime.now(timezone.utc))
    document = {**result, "scenario": sc.name, "ephem_hash": ephem_dir.name, "facility": fac.name,
                "created_utc": created, "messages": [m.to_dict() for m in validate_messages]}
    _write_atomic(ephem_dir / f"validation_{day.isoformat()}.json", _json_bytes(document))
    _write_atomic(ephem_dir / f"validation_{day.isoformat()}.md",
                  validation_markdown(result, scenario=sc.name, ephem_hash=ephem_dir.name,
                                      facility=fac.name, skipped_imaging=skipped).encode("utf-8"))
    history = Path(data_dir) / VALIDATION_DIR / HISTORY_FILE
    history.parent.mkdir(parents=True, exist_ok=True)
    record = {key: document[key] for key in ("day", "scenario", "ephem_hash", "truth_file", "pass", "systems",
                                             "failing", "created_utc")}
    with open(history, "ab") as f:
        f.write(_json_bytes(record, compact=True))
    report("done", 1.0)
    return ephem_dir, messages + validate_messages


# ---------- CLI ----------

def _systems_arg(text: str) -> str:
    try:
        _system_letters(text)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(str(exc)) from None
    return text.upper()


def _day_arg(text: str) -> date:
    try:
        day = date.fromisoformat(text)
        if day.isoformat() != text:                      # Python 3.11+ รับ YYYYMMDD ด้วย
            raise ValueError(text)
        return day
    except ValueError:
        raise argparse.ArgumentTypeError(f"วันที่ต้องอยู่ในรูปแบบ YYYY-MM-DD ได้ {text!r}") from None


def _time_arg(text: str) -> datetime:
    try:
        t = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        t = None
    if t is None or t.tzinfo is None:
        raise argparse.ArgumentTypeError(f"เวลาต้องเป็น ISO 8601 ที่ระบุเขตเวลา เช่น 2026-11-10T01:00:00Z ได้ {text!r}")
    return t.astimezone(timezone.utc)


def _report_text(args: argparse.Namespace, now: datetime) -> str:
    """ประกอบและจัดรูปแบบรายงานตาม argument (import ในฟังก์ชัน: dataproviders import โมดูลนี้ทั้งโมดูลอยู่แล้ว)"""
    from .dataproviders import open_result_set
    from .report_format import format_csv, format_txt, time_format_of
    from .report_style import build_report, resolve_style

    scenario_dir = args.scenario.resolve()
    rs = open_result_set(scenario_dir, args.data.resolve())              # อ่าน scenario.json และตรวจก่อน
    doc = json.loads((scenario_dir / SCENARIO_FILE).read_bytes().decode("utf-8"))
    styles = doc.get("styles")
    style = resolve_style(args.style, args.kind, [], styles if isinstance(styles, list) else [])
    date_format, ltz_offset = time_format_of(doc)
    report = build_report(rs, style, args.object, args.start, args.stop, args.step, now)
    return (format_csv if args.format == "csv" else format_txt)(report, date_format, ltz_offset)


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
                       help="ระบบที่ดึง: G (GPS), R (GLONASS), E (Galileo), C (BeiDou) อย่างน้อยหนึ่งตัว "
                            "เพิ่ม X เพื่อดึงกลุ่มดาวถ่ายภาพ (weather, science, visual) ค่าเริ่มต้น GREC")

    prop = sub.add_parser("propagate", help="propagate ดาวใน scenario ด้วย GMAT ได้ ephem/<hash>/")
    prop.add_argument("--scenario", type=Path, required=True, help=scenario_help)
    prop.add_argument("--data", type=Path, default=DATA_DIR, help=data_help)

    analyze = sub.add_parser("analyze", help="คำนวณ AER, ช่วง access และ DOP ของ Facility ได้ access/<facility>/<hash>/")
    analyze.add_argument("--scenario", type=Path, required=True, help=scenario_help)
    analyze.add_argument("--facility", required=True, help="ชื่อ Facility ใน scenario")
    analyze.add_argument("--data", type=Path, default=DATA_DIR, help=data_help)

    validate = sub.add_parser("validate", help="เทียบ predicted.sp3 ของวันที่ระบุกับ SP3 MGEX จริง "
                                               "ได้ validation_<วัน>.json/.md ใน ephem/<hash>/")
    validate.add_argument("--scenario", type=Path, required=True, help=scenario_help)
    validate.add_argument("--day", type=_day_arg, required=True, help="วันที่ตรวจ (UTC) รูปแบบ YYYY-MM-DD")
    validate.add_argument("--sp3", type=Path, help="ใช้ไฟล์ SP3 นี้แทนการดาวน์โหลด SP3 MGEX ของวันนั้น")
    validate.add_argument("--facility", help="ชื่อ Facility ที่วัด Az/El (ค่าเริ่มต้น: Facility แรกใน scenario)")
    validate.add_argument("--data", type=Path, default=DATA_DIR, help=data_help)

    rep = sub.add_parser("report", help="สร้างรายงาน .txt/.csv จากผล propagate/analyze ที่มีอยู่ (พิมพ์ลง stdout)")
    rep.add_argument("--scenario", type=Path, required=True, help=scenario_help)
    rep.add_argument("--style", required=True, help="ชื่อ style (Scenario Styles แล้ว Installed Styles ไม่สนตัวพิมพ์)")
    rep.add_argument("--object", action="append", required=True,
                     help="path ของ object เช่น '*/Facility/THBK', '*/Satellite/G01' หรือคู่ Access "
                          "'*/Facility/THBK */Satellite/G01' (ซ้ำได้)")
    rep.add_argument("--kind", choices=["report", "graph"],
                     help="ชนิดของ style เมื่อชื่อเดียวกันมีทั้งสองชนิด (เช่น Access) ไม่ส่ง = report ก่อน")
    rep.add_argument("--format", choices=["txt", "csv"], default="txt", help="รูปแบบไฟล์ (ค่าเริ่มต้น txt)")
    rep.add_argument("--start", type=_time_arg, help="เวลาเริ่ม (Specify Time Period) ต้องใช้คู่กับ --stop")
    rep.add_argument("--stop", type=_time_arg, help="เวลาจบ (Specify Time Period) ต้องใช้คู่กับ --start")
    rep.add_argument("--step", type=int, help="Step (วินาที) ต้องเป็นจำนวนเท่าของ step ของ scenario "
                                              "ไม่ส่ง = ทุกจุดของ scenario")
    rep.add_argument("--data", type=Path, default=DATA_DIR, help=data_help)
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
        elif args.command == "analyze":
            path, messages = run_analyze(args.scenario.resolve(), args.facility, data_dir)
        elif args.command == "report":
            sys.stdout.write(_report_text(args, now or datetime.now(timezone.utc)))
            return 0
        else:
            path, messages = run_validate(args.scenario.resolve(), args.day, data_dir,
                                          args.sp3.resolve() if args.sp3 else None, args.facility)
    except GnssPredictError as exc:
        print(f"error: {exc.code}: {exc}", file=sys.stderr)
        return 1
    print(path)
    for m in messages:
        print(f"{m.level}: {m.text}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
