"""ดึง OMM (JSON) จาก CelesTrak ตามกติกาของเขา อ่าน OMM และแปลงเป็นบรรทัด TLE (หัวข้อ 5.2 ของ spec engine)

กติกา CelesTrak: ส่ง request ได้ไม่เกิน 1 ครั้งต่อกลุ่มต่อ CELESTRAK_MIN_INTERVAL_S และห้ามลองซ้ำหลังได้คำตอบที่ใช้ไม่ได้
state file เก็บ {"<group>": {"last_request": "<ISO Z>", "last_success": "<ISO Z>"}}
- last_request บันทึกทุกครั้งที่ได้คำตอบจาก server (ทุก HTTP status รวม 200 ที่เนื้อหาใช้ไม่ได้)
- last_success บันทึกเมื่อได้ OMM ที่ใช้ได้และเขียน cache แล้ว
- error ที่ต่อ server ไม่ได้เลย (URLError, timeout) ไม่บันทึก เพราะ server ไม่ได้รับ request
"""

import json
import os
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from http.client import HTTPException
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from .config import CELESTRAK_GP_URL, CELESTRAK_MIN_INTERVAL_S
from .errors import Message, OrbitUnavailableError

_UTC = timezone.utc
_GROUP_RE = re.compile(r"^[A-Za-z0-9-]{1,32}$")
_OBJECT_ID_RE = re.compile(r"^(\d{4})-(\d{3})([A-Z]{0,3})$")
_FRACTION_RE = re.compile(r"\.(\d+)")
_ALPHA5 = "ABCDEFGHJKLMNPQRSTUVWXYZ"       # A–Z ข้าม I และ O แทน 10–33
_STATE_TIME_FMT = "%Y-%m-%dT%H:%M:%SZ"


@dataclass(frozen=True)
class OmmRecord:
    norad: int
    name: str
    object_id: str
    epoch: datetime          # UTC
    raw: dict                # ทุกช่องจาก JSON


# ---------- อ่าน OMM ----------

def _parse_epoch(text: str) -> datetime:
    """EPOCH ของ OMM ไม่มี timezone และเป็น UTC (เศษวินาทีปรับให้เป็น 6 หลักเพื่อให้ fromisoformat รับได้ทุกเวอร์ชัน)"""
    s = _FRACTION_RE.sub(lambda m: "." + m.group(1)[:6].ljust(6, "0"), text.strip().removesuffix("Z"))
    dt = datetime.fromisoformat(s)
    return dt.replace(tzinfo=_UTC) if dt.tzinfo is None else dt.astimezone(_UTC)


def _parse_records(text: str) -> list[OmmRecord]:
    data = json.loads(text)
    if not isinstance(data, list):
        raise ValueError("ข้อมูลไม่ใช่ JSON array ของ OMM")
    records = []
    for i, item in enumerate(data):
        if not isinstance(item, dict) or "NORAD_CAT_ID" not in item or "EPOCH" not in item:
            raise ValueError(f"รายการที่ {i} ไม่ใช่ OMM (ต้องมี NORAD_CAT_ID และ EPOCH)")
        try:
            norad, epoch = int(item["NORAD_CAT_ID"]), _parse_epoch(str(item["EPOCH"]))
        except (TypeError, ValueError) as exc:
            raise ValueError(f"รายการที่ {i} มี NORAD_CAT_ID หรือ EPOCH ที่อ่านไม่ได้: {exc}") from exc
        records.append(OmmRecord(norad, str(item.get("OBJECT_NAME", "")), str(item.get("OBJECT_ID", "")), epoch, item))
    return records


def read_omm(path: Path) -> list[OmmRecord]:
    """อ่านไฟล์ OMM JSON ถ้าไม่ใช่ JSON array ของ object ที่มี NORAD_CAT_ID และ EPOCH ให้ ValueError"""
    return _parse_records(Path(path).read_bytes().decode("utf-8"))


# ---------- OMM -> TLE ----------

def catalog_field(norad: int) -> str:
    """ช่องหมายเลข catalog 5 ตัวอักษร: ≤ 99999 เป็นเลข 5 หลัก, 100000–339999 เป็น Alpha-5"""
    if not 0 <= norad <= 339999:
        raise ValueError(f"NORAD {norad} อยู่นอกช่วงที่ TLE รองรับ (0–339999)")
    if norad <= 99999:
        return f"{norad:05d}"
    return f"{_ALPHA5[norad // 10000 - 10]}{norad % 10000:04d}"


def _with_checksum(body: str) -> str:
    if len(body) != 68:
        raise ValueError(f"บรรทัด TLE ยาว {len(body)} ตัวอักษร (ต้อง 68 ก่อนต่อ checksum): {body!r}")
    from .tle_fetch import tle_checksum    # นำเข้าตอนเรียก: tle_fetch จะเรียก omm.fetch_group (spec หัวข้อ 8) จึงห้าม import วนที่ระดับโมดูล
    return body + str(tle_checksum(body))


def _international_designator(object_id: str) -> str:
    m = _OBJECT_ID_RE.match(object_id)
    return f"{m.group(1)[2:]}{m.group(2)}{m.group(3)}".ljust(8) if m else " " * 8


def _tle_epoch(epoch: datetime) -> str:
    year_start = datetime(epoch.year, 1, 1, tzinfo=_UTC)
    day = 1 + (epoch - year_start) / timedelta(days=1)
    return f"{epoch.year % 100:02d}{day:012.8f}"


def _mean_motion_dot(x: float) -> str:
    """10 ช่อง: เครื่องหมายหรือช่องว่าง + '.dddddddd'"""
    digits = f"{abs(x):.8f}"
    if not digits.startswith("0."):
        raise ValueError(f"MEAN_MOTION_DOT {x} เกินช่วงที่ TLE รองรับ")
    return ("-" if x < 0 else " ") + digits[1:]


def _implied_decimal(x: float) -> str:
    """ทศนิยมสมมติ 8 ช่อง เช่น ' 12345-3' หมายถึง +0.12345e-3"""
    if x == 0:
        return " 00000+0"
    mantissa, exp = f"{abs(x):.4e}".split("e")
    exp = int(exp) + 1
    if not -9 <= exp <= 9:
        raise ValueError(f"ค่า {x} เกินช่วงที่ TLE รองรับในรูปทศนิยมสมมติ")
    return f"{'-' if x < 0 else ' '}{mantissa.replace('.', '')}{'-' if exp < 0 else '+'}{abs(exp)}"


def to_tle_lines(rec: OmmRecord) -> tuple[str, str]:
    """แปลง OMM เป็น TLE สองบรรทัด (ไม่มี CR/LF) ความเยื้องศูนย์กลางตัดเหลือ 7 หลัก ไม่ปัดเศษ
    (ตรงกับ TLE ของ CelesTrak 144/144 ดวงที่ทดลองเมื่อ 2026-11-11)"""
    r = rec.raw
    try:
        cat = catalog_field(rec.norad)
        ecc = int(float(r["ECCENTRICITY"]) * 1e7 + 1e-6)
        if not 0 <= ecc <= 9999999:
            raise ValueError(f"ECCENTRICITY {r['ECCENTRICITY']} เกินช่วงที่ TLE รองรับ")
        line1 = (f"1 {cat}{str(r['CLASSIFICATION_TYPE'])[:1] or 'U'} {_international_designator(rec.object_id)} "
                 f"{_tle_epoch(rec.epoch)} {_mean_motion_dot(float(r['MEAN_MOTION_DOT']))} "
                 f"{_implied_decimal(float(r['MEAN_MOTION_DDOT']))} {_implied_decimal(float(r['BSTAR']))} "
                 f"{int(r['EPHEMERIS_TYPE']) % 10} {int(r['ELEMENT_SET_NO']) % 10000:4d}")
        line2 = (f"2 {cat} {float(r['INCLINATION']):8.4f} {float(r['RA_OF_ASC_NODE']):8.4f} {ecc:07d} "
                 f"{float(r['ARG_OF_PERICENTER']):8.4f} {float(r['MEAN_ANOMALY']):8.4f} "
                 f"{float(r['MEAN_MOTION']):11.8f}{int(r['REV_AT_EPOCH']) % 100000:5d}")
    except KeyError as exc:
        raise ValueError(f"OMM ของ NORAD {rec.norad} ขาดช่อง {exc.args[0]}") from exc
    except TypeError as exc:
        raise ValueError(f"OMM ของ NORAD {rec.norad} มีค่าที่อ่านไม่ได้: {exc}") from exc
    return _with_checksum(line1), _with_checksum(line2)


# ---------- ดึง OMM จาก CelesTrak ----------

def _fmt_time(t: datetime) -> str:
    return t.astimezone(_UTC).strftime(_STATE_TIME_FMT)


def _parse_time(text) -> datetime | None:
    try:
        return datetime.strptime(text, _STATE_TIME_FMT).replace(tzinfo=_UTC)
    except (TypeError, ValueError):
        return None


def _read_state(path: Path) -> dict:
    try:
        state = json.loads(Path(path).read_bytes().decode("utf-8"))
    except (OSError, ValueError):
        return {}
    return state if isinstance(state, dict) else {}


def _write_atomic(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_bytes(data)
    os.replace(tmp, path)


def _record_state(state_file: Path, group: str, now: datetime, success: bool) -> None:
    state = _read_state(state_file)
    entry = state.get(group) if isinstance(state.get(group), dict) else {}
    entry["last_request"] = _fmt_time(now)
    if success:
        entry["last_success"] = _fmt_time(now)
    state[group] = entry
    _write_atomic(Path(state_file), (json.dumps(state, indent=2, ensure_ascii=False) + "\n").encode("utf-8"))


def fetch_group(group: str, dest_dir: Path, state_file: Path, now: datetime,
                opener=urlopen, timeout_s: float = 30, url: str | None = None) -> tuple[Path, list[Message]]:
    """ดึง OMM ของกลุ่ม CelesTrak แล้วเก็บเป็น <dest_dir>/<group>_<YYYYMMDDTHHMMZ>.json

    คืน (ไฟล์ล่าสุดของกลุ่ม, ข้อความ) ไฟล์ล่าสุดคือชื่อที่เรียงแล้วมากที่สุดของ <group>_*.json
    - ส่ง request ไปไม่ถึง CELESTRAK_MIN_INTERVAL_S จาก last_request: ไม่ส่ง ใช้ไฟล์เดิม + ORBIT_RATE_LIMITED_LOCAL (info)
    - ได้คำตอบที่ใช้ไม่ได้ (HTTP error, เนื้อหาไม่ใช่ OMM) หรือต่อเน็ตไม่ได้: ไม่ลองซ้ำ ใช้ไฟล์เดิม + ORBIT_DOWNLOAD_FAILED (warning)
    - ไม่มีไฟล์ให้ใช้: OrbitUnavailableError
    url: ใช้แทน URL ของ CelesTrak (เช่น file:// ใน CLI เดิมและ test)
    """
    if not _GROUP_RE.match(group):
        raise ValueError(f"ชื่อกลุ่ม CelesTrak ไม่ถูกต้อง: {group!r}")
    dest_dir, state_file = Path(dest_dir), Path(state_file)
    cached = sorted(dest_dir.glob(f"{group}_*.json"))
    latest = cached[-1] if cached else None

    entry = _read_state(state_file).get(group)
    last_request = _parse_time(entry.get("last_request")) if isinstance(entry, dict) else None
    if last_request is not None and (now - last_request).total_seconds() < CELESTRAK_MIN_INTERVAL_S:
        text = (f"ข้ามการดาวน์โหลด OMM กลุ่ม {group}: ส่งคำขอครั้งก่อนเมื่อ {_fmt_time(last_request)} "
                f"ยังไม่ครบ {CELESTRAK_MIN_INTERVAL_S // 3600} ชั่วโมง")
        if latest is None:
            raise OrbitUnavailableError(f"{text} และไม่มีไฟล์ OMM ของกลุ่ม {group} ใน {dest_dir}")
        return latest, [Message("ORBIT_RATE_LIMITED_LOCAL", "info", f"{text} ใช้ไฟล์เดิม {latest.name}")]

    request = Request(url or CELESTRAK_GP_URL.format(group=group), headers={"User-Agent": "gnss-predict/0.2"})
    server_replied = True
    try:
        with opener(request, timeout=timeout_s) as resp:
            data = resp.read()
        if not _parse_records(data.decode("utf-8")):
            raise ValueError("ไม่มีรายการ OMM")
    except HTTPError as exc:
        reason = f"HTTP {exc.code}"
    except HTTPException as exc:           # อ่านคำตอบไม่จบ (IncompleteRead) ไม่ใช่ OSError
        reason = f"อ่านคำตอบไม่จบ: {exc}"
    except ValueError as exc:              # เนื้อหาไม่ใช่ JSON ของ OMM (UnicodeDecodeError และ JSONDecodeError เป็น ValueError)
        reason = f"คำตอบไม่ใช่ OMM: {exc}"
    except OSError as exc:                 # URLError, timeout, ต่อไม่ได้
        reason = str(exc)
        server_replied = False
    else:
        path = dest_dir / f"{group}_{now.astimezone(_UTC):%Y%m%dT%H%MZ}.json"
        _write_atomic(path, data)
        _record_state(state_file, group, now, success=True)
        return path, []

    if server_replied:
        _record_state(state_file, group, now, success=False)
    if latest is None:
        raise OrbitUnavailableError(f"ดึง OMM กลุ่ม {group} ไม่สำเร็จ ({reason}) และไม่มีไฟล์ใน {dest_dir}")
    return latest, [Message("ORBIT_DOWNLOAD_FAILED", "warning",
                            f"ดาวน์โหลด OMM กลุ่ม {group} ไม่สำเร็จ ({reason}) ใช้ไฟล์เดิม {latest.name}")]
