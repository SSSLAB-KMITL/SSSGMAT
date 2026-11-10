"""อ่าน RINEX 3 broadcast navigation แบบ mixed แล้วบอกสถานะดาวและคำนวณตำแหน่ง G/E/C (หัวข้อ 5.4 และ 7.4 ของ spec)

เวลา toc ของแต่ละ record ถูกเก็บตามที่เขียนในไฟล์ (เวลาของระบบนั้น: GPST, GST, BDT หรือ UTC สำหรับ GLONASS)
เป็น datetime ที่ติด tzinfo=UTC เป็นป้ายเท่านั้น ส่วนเวลาที่ถามตำแหน่งเป็น GPST เหมือน sp3.py
"""

import gzip
import math
import os
import subprocess
import zlib
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from .config import (
    BDS_GEO_PRNS, BDS_GEO_TILT_DEG, BDT_GPST_OFFSET_S, BRDC_GM, BRDC_MAX_TK_S, BRDC_OMEGA_E, CDDIS_BRDC_URL,
    KEPLER_ITERATIONS,
)
from .errors import BrdcUnavailableError

# curl FTPS แบบ anonymous เหมือน sp3._CURL
_CURL = ["curl", "-s", "--fail", "--ssl-reqd", "--max-time", "120", "-u", "anonymous:anonymous"]
_CURL_REMOTE_FILE_NOT_FOUND = 78

Position = tuple[float, float, float]

# จำนวนบรรทัดต่อ record (รวมบรรทัดแรก) ตาม RINEX 3.04
_RECORD_LINES = {"G": 8, "E": 8, "C": 8, "J": 8, "I": 8, "R": 4, "S": 4}
_STATUS_SYSTEMS = "GREC"
_WEEK_S = 604800
# เริ่มสัปดาห์ของแต่ละระบบ (BDT และ GPST/GST นับเลขสัปดาห์ต่อเนื่องของตัวเอง)
_GPS_EPOCH = datetime(1980, 1, 6, tzinfo=timezone.utc)
_BDT_EPOCH = datetime(2006, 1, 1, tzinfo=timezone.utc)
_WEEK_EPOCH = {"G": _GPS_EPOCH, "E": _GPS_EPOCH, "C": _BDT_EPOCH}

# ตำแหน่งในลำดับค่า NavRecord.fields: ค่า 3 ตัวของบรรทัดแรก แล้วตามด้วยบรรทัดละ 4 ค่า
# (G/E/C) ORBIT-1 เริ่มที่ 3, ORBIT-6 เริ่มที่ 23 | (R) ORBIT-1 เริ่มที่ 3
_TOE, _WEEK = 11, 21
_HEALTH_INDEX = {"G": 24, "E": 24, "C": 24, "R": 6}      # ช่องที่ 2 ของ ORBIT-6 / ช่องที่ 4 ของ ORBIT-1 (R)


@dataclass(frozen=True)
class BroadcastStatus:
    prn: str
    last_toc: datetime
    healthy: bool


@dataclass(frozen=True)
class NavRecord:
    prn: str
    toc: datetime
    fields: tuple[float, ...]       # ตามลำดับในไฟล์: clock 3 ค่า แล้ว BROADCAST ORBIT - n ละ 4 ค่า ค่าที่ว่างเป็น 0


@dataclass(frozen=True)
class Nav:
    records: dict[str, list[NavRecord]]       # PRN -> record เรียงตามลำดับในไฟล์


def fetch_brdc(day: date, dest_dir: Path) -> Path:
    """ดาวน์โหลด broadcast รายวันแบบ mixed ของวันนั้นจาก CDDIS ผ่าน FTPS แบบ anonymous"""
    name = f"BRDC00IGS_R_{day.year}{day.timetuple().tm_yday:03d}0000_01D_MN.rnx.gz"
    url = CDDIS_BRDC_URL.format(year=day.year)
    dest_dir = Path(dest_dir)
    dest_dir.mkdir(parents=True, exist_ok=True)
    dst = dest_dir / name
    if dst.exists():
        return dst
    part = dst.with_name(name + ".part")
    r = subprocess.run(_CURL + ["-o", str(part), url + name])
    if r.returncode != 0 or not part.exists() or part.stat().st_size == 0:
        part.unlink(missing_ok=True)
        if r.returncode == _CURL_REMOTE_FILE_NOT_FOUND:
            raise BrdcUnavailableError(f"ยังไม่มีไฟล์ {name} ใน {url}")
        raise BrdcUnavailableError(f"ดาวน์โหลด {url + name} ไม่สำเร็จ (curl exit {r.returncode})")
    os.replace(part, dst)
    return dst


def _number(text: str) -> float:
    text = text.strip()
    return float(text.replace("D", "E").replace("d", "e")) if text else 0.0


def _record_values(lines: list[str]) -> tuple[float, ...]:
    """ค่าของ record ตามลำดับในไฟล์: บรรทัดแรกที่ [23:42] [42:61] [61:80] บรรทัดต่อที่ [4:23] [23:42] [42:61] [61:80]"""
    first = lines[0].ljust(80)
    values = [_number(first[a:a + 19]) for a in (23, 42, 61)]
    for line in lines[1:]:
        line = line.ljust(80)
        values.extend(_number(line[a:a + 19]) for a in (4, 23, 42, 61))
    return tuple(values)


def _parse_record(lines: list[str]) -> NavRecord:
    head = lines[0]
    prn = f"{head[0]}{int(head[1:3]):02d}"
    y, mo, d, h, mi, s = (int(x) for x in head[4:23].split())
    return NavRecord(prn, datetime(y, mo, d, h, mi, s, tzinfo=timezone.utc), _record_values(lines))


def read_nav(path: Path) -> Nav:
    """อ่าน RINEX 3.x navigation (.gz หรือไม่ก็ได้) ข้ามระบบที่ไม่รู้จักและ record ที่ถูกตัดท้าย

    ไฟล์ที่อ่านไม่ได้ ไม่ใช่ RINEX 3 navigation หรือไม่มี record เลย ได้ BrdcUnavailableError
    """
    path = Path(path)
    opener = gzip.open if path.name.endswith(".gz") else open
    try:
        with opener(path, "rt", encoding="ascii", errors="replace") as f:
            lines = f.read().splitlines()
    except (OSError, EOFError, zlib.error) as e:       # gzip ที่ถูกตัดท้าย (EOFError) หรือข้อมูลเสียกลางทาง (zlib.error)
        raise BrdcUnavailableError(f"อ่าน {path.name} ไม่ได้ ({e})") from e
    try:
        version, kind = float(lines[0][:9]), lines[0][20:21]
    except (IndexError, ValueError):
        version, kind = 0.0, ""
    if not 3.0 <= version < 4.0 or kind != "N":
        raise BrdcUnavailableError(f"{path.name}: ไม่ใช่ไฟล์ RINEX 3 navigation (เวอร์ชัน {version} ชนิด '{kind}')")
    end = next((i for i, line in enumerate(lines) if "END OF HEADER" in line[60:]), None)
    if end is None:
        raise BrdcUnavailableError(f"{path.name}: ไม่พบ END OF HEADER")
    records: dict[str, list[NavRecord]] = {}
    i = end + 1
    while i < len(lines):
        n = _RECORD_LINES.get(lines[i][:1])
        chunk = lines[i:i + n] if n else []
        if len(chunk) != n or any(c[:1] != " " for c in chunk[1:]):
            i += 1                      # ระบบที่ไม่รู้จัก บรรทัดต่อลอย หรือ record ที่ถูกตัดท้าย
            continue
        try:
            rec = _parse_record(chunk)
        except ValueError as e:
            raise BrdcUnavailableError(f"{path.name}: อ่าน record ไม่ได้ ({e}): {chunk[0].rstrip()!r}") from e
        records.setdefault(rec.prn, []).append(rec)
        i += n
    if not records:
        raise BrdcUnavailableError(f"{path.name}: ไม่มี record ของ G, R, E, C เลย")
    return Nav(records)


def broadcast_status(nav: Nav) -> dict[str, BroadcastStatus]:
    """ดาว G, R, E, C ที่มี record พร้อม health ของ record ที่ toc ล่าสุด

    healthy เป็น False ถ้ามี record ใดที่ toc ล่าสุดมี health ≠ 0 (Galileo มีทั้ง I/NAV และ F/NAV ที่ toc เดียวกัน)
    """
    result = {}
    for prn in sorted(nav.records):
        if prn[0] not in _STATUS_SYSTEMS:
            continue
        recs = nav.records[prn]
        last_toc = max(r.toc for r in recs)
        index = _HEALTH_INDEX[prn[0]]
        healthy = all(r.fields[index] == 0 for r in recs if r.toc == last_toc)
        result[prn] = BroadcastStatus(prn, last_toc, healthy)
    return result


def position_km(nav: Nav, prn: str, t_gpst: datetime) -> Position | None:
    """ตำแหน่ง ECEF (กม.) ของดาว G, E, C ที่เวลา GPST จาก record ที่ |tk| น้อยที่สุด

    คืน None ถ้าไม่มีดาวนี้ ไม่ใช่ G/E/C หรือ |tk| > BRDC_MAX_TK_S
    tk = t − toe ในเวลาของระบบ (BDT = GPST − 14 วินาที) โดย toe รวมเลขสัปดาห์ในไฟล์ จึงไม่ต้องห่อค่าเข้า ±302400
    วินาที และเวลาที่ห่างจากไฟล์เป็นสัปดาห์เต็มจะไม่ถูกจับคู่ผิด
    """
    system = prn[:1]
    recs = nav.records.get(prn)
    if system not in _WEEK_EPOCH or not recs:
        return None
    t_sys = t_gpst - timedelta(seconds=BDT_GPST_OFFSET_S) if system == "C" else t_gpst
    t_s = (t_sys - _WEEK_EPOCH[system]).total_seconds()
    best_tk, best = min(((t_s - (r.fields[_WEEK] * _WEEK_S + r.fields[_TOE]), r) for r in recs),
                        key=lambda pair: abs(pair[0]))
    if abs(best_tk) > BRDC_MAX_TK_S:
        return None
    return _kepler_position(system, prn, best, best_tk)


def _kepler_position(system: str, prn: str, rec: NavRecord, tk: float) -> Position:
    """สูตรหัวข้อ 7.4 ของ spec (ICD ของ GPS, Galileo และ BDS)"""
    (_, crs, dn, m0, cuc, ecc, cus, sqrt_a, toe, cic, omega0, cis,
     i0, crc, omega, omega_dot, idot) = rec.fields[3:20]
    gm, omega_e = BRDC_GM[system], BRDC_OMEGA_E[system]
    a = sqrt_a ** 2
    mean_anomaly = m0 + (math.sqrt(gm / a ** 3) + dn) * tk
    ecc_anomaly = mean_anomaly
    for _ in range(KEPLER_ITERATIONS):
        ecc_anomaly = mean_anomaly + ecc * math.sin(ecc_anomaly)
    nu = math.atan2(math.sqrt(1 - ecc * ecc) * math.sin(ecc_anomaly), math.cos(ecc_anomaly) - ecc)
    phi = nu + omega
    s2, c2 = math.sin(2 * phi), math.cos(2 * phi)
    u = phi + cus * s2 + cuc * c2
    r = a * (1 - ecc * math.cos(ecc_anomaly)) + crs * s2 + crc * c2
    inc = i0 + idot * tk + cis * s2 + cic * c2
    xp, yp = r * math.cos(u), r * math.sin(u)
    geo = prn in BDS_GEO_PRNS
    node = omega0 + (omega_dot if geo else omega_dot - omega_e) * tk - omega_e * toe
    sn, cn, ci = math.sin(node), math.cos(node), math.cos(inc)
    x, y, z = xp * cn - yp * ci * sn, xp * sn + yp * ci * cn, yp * math.sin(inc)
    if geo:
        tilt = math.radians(-BDS_GEO_TILT_DEG)
        y, z = y * math.cos(tilt) + z * math.sin(tilt), -y * math.sin(tilt) + z * math.cos(tilt)
        rot = omega_e * tk
        x, y = x * math.cos(rot) + y * math.sin(rot), -x * math.sin(rot) + y * math.cos(rot)
    return (x / 1000.0, y / 1000.0, z / 1000.0)
