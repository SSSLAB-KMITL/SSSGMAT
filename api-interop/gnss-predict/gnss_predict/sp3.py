"""ดาวน์โหลดและอ่านวงโคจร SP3 ของ IGS แล้ว interpolate ตำแหน่ง (หัวข้อ 5.8 ของ spec)

ใช้เฉพาะตอนตรวจความแม่นยำ เวลาใน SP3 เป็น GPST และถูกเก็บเป็น datetime ที่ติด tzinfo=UTC
ไว้เป็นป้ายเท่านั้น ผู้เรียกต้องบวก GPS_UTC_OFFSET_S เองเมื่อแปลงจาก UTC
"""

import gzip
import os
import subprocess
from bisect import bisect_left
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from .config import CDDIS_PRODUCTS_URL
from .errors import Sp3FormatError, Sp3UnavailableError

_HALF_WINDOW = 5          # Lagrange 10 จุด: 5 จุดก่อนและ 5 จุดหลัง t
_GPS_EPOCH = date(1980, 1, 6)
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


def read_sp3(path: Path) -> Sp3Orbit:
    path = Path(path)
    opener = gzip.open if path.name.endswith(".gz") else open
    with opener(path, "rt", encoding="ascii", errors="replace") as f:
        lines = f.read().splitlines()
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
    x = (t_gpst - t0).total_seconds()
    result = [0.0, 0.0, 0.0]
    for a, (xa, pa) in enumerate(zip(xs, window)):
        w = 1.0
        for b, xb in enumerate(xs):
            if b != a:
                w *= (x - xb) / (xa - xb)
        for c in range(3):
            result[c] += w * pa[c]
    return (result[0], result[1], result[2])
