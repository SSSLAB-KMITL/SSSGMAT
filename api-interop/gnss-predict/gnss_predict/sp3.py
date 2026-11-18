"""ดาวน์โหลดและอ่านวงโคจร SP3 ของ IGS แล้ว interpolate ตำแหน่ง (หัวข้อ 5.8 ของ spec)

ใช้เฉพาะตอนตรวจความแม่นยำ เวลาใน SP3 เป็น GPST และถูกเก็บเป็น datetime ที่ติด tzinfo=UTC
ไว้เป็นป้ายเท่านั้น ผู้เรียกต้องบวก GPS_UTC_OFFSET_S เองเมื่อแปลงจาก UTC

ส่วนแรกเป็นของ GPS อย่างเดียว (read_sp3, interpolate, fetch_sp3) ส่วนหลังรองรับทุกระบบ:
read_sp3_all, lagrange_at, choose_mgx_sp3_name, fetch_mgx_sp3 และ write_sp3 (SP3-d)
"""

import gzip
import os
import subprocess
import zlib
from bisect import bisect_left
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from .config import CDDIS_PRODUCTS_URL, GPS_UTC_OFFSET_S, MGX_SP3_PREFERENCE
from .errors import Sp3FormatError, Sp3UnavailableError

_HALF_WINDOW = 5          # Lagrange 10 จุด: 5 จุดก่อนและ 5 จุดหลัง t
_GPS_EPOCH = date(1980, 1, 6)
_MJD_EPOCH = date(1858, 11, 17)
_CURL = ["curl", "-s", "--fail", "--ssl-reqd", "--max-time", "120", "-u", "anonymous:anonymous"]

Position = tuple[float, float, float]


@dataclass(frozen=True)
class Sp3Orbit:
    time_system: str
    epochs: list[datetime]
    positions: dict[int, list[Position | None]]


def gps_week(day: date) -> int:
    return (day - _GPS_EPOCH).days // 7


def choose_sp3_name(listing: list[str], day: date) -> str | None:
    """เลือกไฟล์ IGS final ก่อน ถ้าไม่มีจึงใช้ rapid"""
    doy = day.timetuple().tm_yday
    names = set(listing)
    for kind in ("FIN", "RAP"):
        name = f"IGS0OPS{kind}_{day.year}{doy:03d}0000_01D_15M_ORB.SP3.gz"
        if name in names:
            return name
    return None


def fetch_sp3(day: date, cache_dir: Path) -> Path:
    """ดาวน์โหลด SP3 ของวันนั้นจาก CDDIS ผ่าน FTPS แบบ anonymous (list ไดเรกทอรีก่อนเสมอ)"""
    url = f"{CDDIS_PRODUCTS_URL}/{gps_week(day)}/"
    listing = subprocess.run(_CURL + ["--list-only", url], capture_output=True, text=True)
    if listing.returncode != 0:
        raise Sp3UnavailableError(f"list {url} ไม่ได้ (curl exit {listing.returncode}) ดาวน์โหลด SP3 เองแล้วใช้ --sp3")
    name = choose_sp3_name(listing.stdout.split(), day)
    if name is None:
        raise Sp3UnavailableError(f"ยังไม่มี SP3 แบบ FIN หรือ RAP ของวันที่ {day} ใน {url}")
    cache_dir = Path(cache_dir)
    cache_dir.mkdir(parents=True, exist_ok=True)
    dst = cache_dir / name
    if dst.exists():
        return dst
    part = dst.with_name(name + ".part")
    r = subprocess.run(_CURL + ["-o", str(part), url + name])
    if r.returncode != 0 or not part.exists() or part.stat().st_size == 0:
        part.unlink(missing_ok=True)
        raise Sp3UnavailableError(f"ดาวน์โหลด {url + name} ไม่สำเร็จ (curl exit {r.returncode})")
    os.replace(part, dst)
    return dst


def _parse_epoch(line: str) -> datetime:
    y, mo, d, h, mi, s = line[1:].split()[:6]
    sec = float(s)
    whole = int(sec)
    return datetime(int(y), int(mo), int(d), int(h), int(mi), whole,
                    round((sec - whole) * 1e6), tzinfo=timezone.utc)


def _read_lines(path: Path) -> list[str]:
    """บรรทัดทั้งหมดของไฟล์ SP3 (.gz หรือไม่ก็ได้) เปิดหรืออ่านไม่ได้ได้ Sp3FormatError ที่บอก path เต็ม"""
    opener = gzip.open if path.name.endswith(".gz") else open
    try:
        with opener(path, "rt", encoding="ascii", errors="replace") as f:
            return f.read().splitlines()
    # gzip.BadGzipFile (เช่นหน้า HTML ที่บันทึกเป็น .gz) เป็น OSError, gzip ที่ถูกตัดท้ายได้ EOFError
    except (OSError, EOFError, zlib.error, UnicodeDecodeError) as exc:
        raise Sp3FormatError(f"อ่านไฟล์ SP3 {path} ไม่ได้ ({type(exc).__name__}: {exc}) ไฟล์อาจเสีย ดาวน์โหลดไม่ครบ "
                             "หรือไม่ใช่ SP3 ถ้าเป็นไฟล์ที่ดาวน์โหลดเก็บไว้ ให้ลบไฟล์นี้แล้วรันใหม่") from exc


def read_sp3(path: Path) -> Sp3Orbit:
    path = Path(path)
    lines = _read_lines(path)
    time_system = next((l[9:12] for l in lines if l.startswith("%c")), "")
    if time_system != "GPS":
        raise Sp3FormatError(f"{path.name}: time system คือ '{time_system}' ต้องเป็น 'GPS'")
    epochs: list[datetime] = []
    per_epoch: list[dict[int, Position | None]] = []
    for line in lines:
        if line.startswith("*"):
            epochs.append(_parse_epoch(line))
            per_epoch.append({})
        elif line.startswith("PG") and per_epoch:
            prn = int(line[2:4])
            xyz = (float(line[4:18]), float(line[18:32]), float(line[32:46]))
            per_epoch[-1][prn] = None if xyz == (0.0, 0.0, 0.0) else xyz
    prns = sorted({p for e in per_epoch for p in e})
    positions = {p: [e.get(p) for e in per_epoch] for p in prns}
    return Sp3Orbit(time_system, epochs, positions)


def prns_with_data(orbit: Sp3Orbit) -> set[int]:
    return {p for p, pos in orbit.positions.items() if any(x is not None for x in pos)}


def _lagrange(xs: list[float], points: list[Position], x: float) -> Position:
    """พหุนาม Lagrange ผ่านจุด (xs[i], points[i]) ประเมินที่ x ทีละแกน"""
    result = [0.0, 0.0, 0.0]
    for a, (xa, pa) in enumerate(zip(xs, points)):
        w = 1.0
        for b, xb in enumerate(xs):
            if b != a:
                w *= (x - xb) / (xa - xb)
        for c in range(3):
            result[c] += w * pa[c]
    return (result[0], result[1], result[2])


def interpolate(orbit: Sp3Orbit, prn: int, t_gpst: datetime) -> Position | None:
    """ตำแหน่ง ECEF (กม.) ที่เวลา t_gpst ด้วย Lagrange 10 จุด คืน None ถ้ามีจุดไม่พอหรือมีช่องว่าง"""
    pos = orbit.positions.get(prn)
    if pos is None:
        return None
    epochs = orbit.epochs
    i = bisect_left(epochs, t_gpst)
    if i < len(epochs) and epochs[i] == t_gpst:
        return pos[i]
    k = i - 1                                   # epochs[k] < t < epochs[k + 1]
    lo, hi = k - (_HALF_WINDOW - 1), k + _HALF_WINDOW
    if lo < 0 or hi >= len(epochs):
        return None
    window = pos[lo:hi + 1]
    if any(p is None for p in window):
        return None
    t0 = epochs[k]
    xs = [(epochs[j] - t0).total_seconds() for j in range(lo, hi + 1)]
    return _lagrange(xs, window, (t_gpst - t0).total_seconds())


# ---- หลายระบบ (GNSS Studio) ----

_SP3_WIDTH = 80
_SATS_PER_LINE = 17
_MIN_SAT_LINES = 5          # SP3-c/d: บรรทัด '+' และ '++' อย่างน้อย 5 บรรทัด
_BAD_VALUE = 999999.0       # SP3 ใช้ 999999.999999 แทนค่าที่ไม่มี (ตำแหน่ง 0.000000 ก็คือไม่มีเช่นกัน)
_CLOCK_UNKNOWN = 999999.999999
MAX_SATELLITES = 999
_MAX_STEP_RATIO = 1.5       # lagrange_at: ระยะห่างระหว่างจุดในหน้าต่างห่างกันเกินอัตรานี้ถือว่ามีช่องว่าง
_COMMENT = "GNSS Studio predicted orbit from TLE/SGP4 (GMAT)"

SatSeries = dict[datetime, Position]


def read_sp3_all(path: Path) -> dict[str, SatSeries]:
    """อ่านตำแหน่งของทุกระบบ คืน {รหัสดาว เช่น 'G01': {เวลา GPST: (x, y, z) กม.}}

    ข้ามตำแหน่งที่เป็น 0 ทั้งสามแกนและค่าที่ |v| ≥ 999999 ไม่เชื่อจำนวน epoch และดาวใน header
    (ไฟล์ที่ตัดย่อยังมี header เดิม) อ่านถึง 'EOF' หรือท้ายไฟล์
    ไฟล์ที่เปิดหรืออ่านไม่ได้ (gzip เสียหรือถูกตัดท้าย) หรือไม่ใช่ SP3 ของเวลา GPS: Sp3FormatError
    """
    path = Path(path)
    lines = _read_lines(path)
    time_system = next((l[9:12] for l in lines if l.startswith("%c")), "")
    if time_system != "GPS":
        raise Sp3FormatError(f"{path.name}: time system คือ '{time_system}' ต้องเป็น 'GPS'")
    result: dict[str, SatSeries] = {}
    epoch: datetime | None = None
    for line in lines:
        if line.startswith("EOF"):
            break
        try:
            if line.startswith("*"):
                epoch = _parse_epoch(line)
                continue
            if not line.startswith("P") or epoch is None:
                continue
            sat = line[1:4]
            xyz = (float(line[4:18]), float(line[18:32]), float(line[32:46]))
        except ValueError as e:
            raise Sp3FormatError(f"{path.name}: อ่านบรรทัดไม่ได้ ({e}): {line.rstrip()!r}") from e
        if xyz == (0.0, 0.0, 0.0) or any(abs(v) >= _BAD_VALUE for v in xyz):
            continue
        result.setdefault(sat, {})[epoch] = xyz
    return result


def lagrange_at(series: SatSeries, t: datetime, half_window: int = _HALF_WINDOW,
                times: list[datetime] | None = None) -> Position | None:
    """ตำแหน่งที่เวลา t ด้วย Lagrange 2 × half_window จุด (ค่าเริ่มต้น 10 จุด)

    times คือ sorted(series) ที่ผู้เรียกเรียงไว้แล้ว (ต้องเรียงจากน้อยไปมากและตรงกับคีย์ของ series พอดี)
    ส่งมาเมื่อเรียกหลายครั้งกับอนุกรมเดิม จะได้ไม่เรียงใหม่ทุกครั้ง ผลเท่ากับไม่ส่ง

    ต้องมีจุดก่อน t และหลัง t ข้างละ half_window จุด ไม่งั้นคืน None ถ้า t ตรงกับจุดที่มี คืนค่านั้นเลย
    (เหมือน interpolate) ถ้าในหน้าต่างมีช่องว่าง (ระยะห่างระหว่างจุดที่ติดกันมากสุด > 1.5 เท่าของน้อยสุด
    เช่น read_sp3_all ตัด epoch ที่เป็น 0 หรือ 999999 ออก) คืน None
    """
    if half_window < 1:
        raise ValueError("half_window ต้องมากกว่า 0")
    if t in series:
        return series[t]
    if times is None:
        times = sorted(series)
    i = bisect_left(times, t)                       # times[i - 1] < t < times[i]
    lo, hi = i - half_window, i + half_window
    if lo < 0 or hi > len(times):
        return None
    window = times[lo:hi]
    t0 = window[half_window - 1]
    xs = [(w - t0).total_seconds() for w in window]
    steps = [b - a for a, b in zip(xs, xs[1:])]
    if max(steps) > _MAX_STEP_RATIO * min(steps):   # มีช่องว่างในหน้าต่าง (รวมช่วงที่ t อยู่) ไม่ interpolate ข้าม
        return None
    return _lagrange(xs, [series[w] for w in window], (t - t0).total_seconds())


def _mgx_sp3_names(day: date) -> list[str]:
    """ชื่อไฟล์ SP3 MGEX ของวันนั้นตามลำดับ MGX_SP3_PREFERENCE"""
    doy = day.timetuple().tm_yday
    return [f"{prefix}_{day.year}{doy:03d}0000_01D_05M_ORB.SP3.gz" for prefix in MGX_SP3_PREFERENCE]


def choose_mgx_sp3_name(listing: list[str], day: date) -> str | None:
    """เลือก SP3 MGEX ของวันนั้นตามลำดับ MGX_SP3_PREFERENCE ตัวแรกที่มีในรายการ"""
    names = set(listing)
    return next((name for name in _mgx_sp3_names(day) if name in names), None)


def fetch_mgx_sp3(day: date, cache_dir: Path) -> Path:
    """SP3 MGEX ของวันนั้น: ถ้ามีใน cache_dir แล้วคืนไฟล์นั้นทันทีโดยไม่ใช้เน็ต (ตัวแรกตามลำดับ MGX_SP3_PREFERENCE)
    ไม่งั้น list ไดเรกทอรีของ CDDIS ผ่าน FTPS แบบ anonymous แล้วดาวน์โหลดตัวแรกตามลำดับที่มี"""
    cache_dir = Path(cache_dir)
    cached = next((cache_dir / name for name in _mgx_sp3_names(day) if (cache_dir / name).is_file()), None)
    if cached is not None:
        return cached
    url = f"{CDDIS_PRODUCTS_URL}/{gps_week(day)}/"      # ไฟล์ MGEX อยู่ในไดเรกทอรีเดียวกับ IGS ไม่ใช่ mgex/
    listing = subprocess.run(_CURL + ["--list-only", url], capture_output=True, text=True)
    if listing.returncode != 0:
        raise Sp3UnavailableError(f"list {url} ไม่ได้ (curl exit {listing.returncode}) ดาวน์โหลด SP3 เองแล้วใช้ --sp3")
    name = choose_mgx_sp3_name(listing.stdout.split(), day)
    if name is None:
        raise Sp3UnavailableError(
            f"ยังไม่มี SP3 MGEX ({', '.join(MGX_SP3_PREFERENCE)}) ของวันที่ {day} ใน {url}")
    cache_dir.mkdir(parents=True, exist_ok=True)
    dst = cache_dir / name
    if dst.exists():
        return dst
    part = dst.with_name(name + ".part")
    r = subprocess.run(_CURL + ["-o", str(part), url + name])
    if r.returncode != 0 or not part.exists() or part.stat().st_size == 0:
        part.unlink(missing_ok=True)
        raise Sp3UnavailableError(f"ดาวน์โหลด {url + name} ไม่สำเร็จ (curl exit {r.returncode})")
    os.replace(part, dst)
    return dst


def _fixed(text: str) -> str:
    return text.ljust(_SP3_WIDTH)


def _sat_block(sats: list[str]) -> list[str]:
    """บรรทัด '+' (รายชื่อดาว) และ '++' (accuracy = 0) ละ 17 ดวง อย่างน้อย 5 บรรทัด เติมช่องที่เหลือด้วย '  0'"""
    n_lines = max(_MIN_SAT_LINES, -(-len(sats) // _SATS_PER_LINE))
    out = []
    for k in range(n_lines):
        chunk = sats[k * _SATS_PER_LINE:(k + 1) * _SATS_PER_LINE]
        lead = f"+  {len(sats):3d}   " if k == 0 else "+" + " " * 8
        out.append(_fixed(lead + "".join(chunk) + "  0" * (_SATS_PER_LINE - len(chunk))))
    for _ in range(n_lines):
        out.append(_fixed("++" + " " * 7 + "  0" * _SATS_PER_LINE))
    return out


def _epoch_fields(t: datetime) -> str:
    sec = t.second + t.microsecond / 1e6
    return f"{t.year:4d} {t.month:2d} {t.day:2d} {t.hour:2d} {t.minute:2d} {sec:11.8f}"


def write_sp3(times_utc: list[datetime], positions_km: dict[str, list[Position]], path: Path,
              agency: str = "GSTD") -> None:
    """เขียนวงโคจรที่ทำนายแล้วเป็น SP3-d (เวลาในไฟล์เป็น GPST = UTC + GPS_UTC_OFFSET_S)

    times_utc เป็นเวลา UTC (tzinfo=UTC) positions_km เป็น {รหัสดาว 3 ตัวอักษร เช่น 'G01': ตำแหน่ง ECEF กม.
    ต่อ epoch ตาม times_utc} ความละเอียด 1 มม. นาฬิกาใส่ 999999.999999 (ไม่มีค่า)
    """
    if not times_utc:
        raise ValueError("write_sp3 ต้องมีอย่างน้อย 1 epoch")
    if len(positions_km) > MAX_SATELLITES:
        raise ValueError(f"SP3-d รองรับสูงสุด {MAX_SATELLITES} ดวงต่อไฟล์")
    for sat, series in positions_km.items():
        if len(sat) != 3:
            raise ValueError(f"รหัสดาว '{sat}' ต้องยาว 3 ตัวอักษร เช่น G01")
        if len(series) != len(times_utc):
            raise ValueError(f"{sat}: มี {len(series)} ตำแหน่ง แต่มี {len(times_utc)} epoch")
    offset = timedelta(seconds=GPS_UTC_OFFSET_S)
    epochs_gpst = [t + offset for t in times_utc]
    start = epochs_gpst[0]
    interval_s = (epochs_gpst[1] - epochs_gpst[0]).total_seconds() if len(epochs_gpst) > 1 else 0.0
    days = (start.date() - _GPS_EPOCH).days
    sec_of_day = start.hour * 3600 + start.minute * 60 + start.second + start.microsecond / 1e6
    sats = sorted(positions_km)
    lines = [
        _fixed(f"#dP{_epoch_fields(start)} {len(epochs_gpst):7d} {'TLE':<5} {'ITRF':<5} {'EXT'} {agency[:4]:<4}"),
        _fixed(f"## {days // 7:4d} {days % 7 * 86400 + sec_of_day:15.8f} {interval_s:14.8f} "
               f"{(start.date() - _MJD_EPOCH).days:5d} {sec_of_day / 86400:15.13f}"),
        *_sat_block(sats),
        _fixed("%c M  cc GPS ccc cccc cccc cccc cccc ccccc ccccc ccccc ccccc"),
        _fixed("%c cc cc ccc ccc cccc cccc cccc cccc ccccc ccccc ccccc ccccc"),
        _fixed("%f  0.0000000  0.000000000  0.00000000000  0.000000000000000"),
        _fixed("%f  0.0000000  0.000000000  0.00000000000  0.000000000000000"),
        _fixed("%i    0    0    0    0      0      0      0      0         0"),
        _fixed("%i    0    0    0    0      0      0      0      0         0"),
        _fixed("/* " + _COMMENT),
        _fixed("/*"),
        _fixed("/*"),
        _fixed("/*"),
    ]
    for k, t in enumerate(epochs_gpst):
        lines.append(_fixed(f"*  {_epoch_fields(t)}"))
        for sat in sats:
            x, y, z = positions_km[sat][k]
            lines.append(_fixed(f"P{sat}{x:14.6f}{y:14.6f}{z:14.6f}{_CLOCK_UNKNOWN:14.6f}"))
    lines.append(_fixed("EOF"))
    with open(path, "w", encoding="ascii", newline="\n") as f:
        f.write("\n".join(lines) + "\n")
