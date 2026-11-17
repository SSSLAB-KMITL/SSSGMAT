"""DOP นาฬิกาเดียวของชุดดาวรวมทุกระบบและแยกระบบ (หัวข้อ 5.11 และ 7.5 ของ spec engine)

- แต่ละดาวมีแถว H = [cos El sin Az, cos El cos Az, sin El, 1] (แกน E, N, U และนาฬิกา)
  ใช้คอลัมน์นาฬิกาเดียวกับทุกระบบ เหมือน STK และ `dops()` ของ RTKLIB
- Q = (HᵀH)⁻¹ หาด้วยการกำจัดแบบเกาส์-จอร์แดนพร้อมเลือก pivot ถ้า pivot เล็กกว่า 1e-12 ถือว่าไม่มีตัวผกผัน
- ดาวที่ใช้ใน `dop_series`: ดาว GNSS (G/R/E/C) ที่ El ≥ min_el_deg ของ Facility และไม่มีธงใน `DOP_EXCLUDED_FLAGS`
  ดาวถ่ายภาพ (ระบบ X) ไม่เข้า DOP ทั้งราย system และ ALL
"""

import math
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime

from .analyze import AerRow
from .catalog import DOP_EXCLUDED_FLAGS
from .config import GNSS_GROUPS
from .scenario import Facility

_PIVOT_MIN = 1e-12
_SYSTEMS = ("ALL", "G", "R", "E", "C")
_DOP_KEYS = ("gdop", "pdop", "hdop", "vdop", "edop", "ndop", "tdop")


@dataclass(frozen=True)
class Dop:
    gdop: float
    pdop: float
    hdop: float
    vdop: float
    edop: float
    ndop: float
    tdop: float


def _invert4(m: list[list[float]]) -> list[list[float]] | None:
    """ตัวผกผันของเมทริกซ์ 4×4 ด้วยเกาส์-จอร์แดนเลือก pivot คืน None ถ้ามี pivot เล็กกว่า 1e-12"""
    n = 4
    a = [list(m[i]) + [1.0 if i == j else 0.0 for j in range(n)] for i in range(n)]
    for col in range(n):
        pivot_row = max(range(col, n), key=lambda r: abs(a[r][col]))
        if abs(a[pivot_row][col]) < _PIVOT_MIN:
            return None
        a[col], a[pivot_row] = a[pivot_row], a[col]
        pivot = a[col][col]
        a[col] = [v / pivot for v in a[col]]
        for r in range(n):
            if r != col and a[r][col] != 0.0:
                factor = a[r][col]
                a[r] = [v - factor * p for v, p in zip(a[r], a[col])]
    return [row[n:] for row in a]


def dop(az_el_deg: list[tuple[float, float]]) -> Dop | None:
    """ดาวน้อยกว่า 4 ดวงหรือเมทริกซ์ไม่มีตัวผกผัน: None"""
    if len(az_el_deg) < 4:
        return None
    normal = [[0.0] * 4 for _ in range(4)]                 # HᵀH
    for az_deg, el_deg in az_el_deg:
        az, el = math.radians(az_deg), math.radians(el_deg)
        h = (math.cos(el) * math.sin(az), math.cos(el) * math.cos(az), math.sin(el), 1.0)
        for i in range(4):
            for j in range(4):
                normal[i][j] += h[i] * h[j]
    q = _invert4(normal)
    if q is None:
        return None
    return Dop(
        gdop=math.sqrt(q[0][0] + q[1][1] + q[2][2] + q[3][3]),
        pdop=math.sqrt(q[0][0] + q[1][1] + q[2][2]),
        hdop=math.sqrt(q[0][0] + q[1][1]),
        vdop=math.sqrt(q[2][2]),
        edop=math.sqrt(q[0][0]),
        ndop=math.sqrt(q[1][1]),
        tdop=math.sqrt(q[3][3]),
    )


def dop_series(rows: list[AerRow], fac: Facility, flags: dict[str, frozenset[str]],
               times_utc: Iterable[datetime] | None = None) -> list[dict]:
    """หนึ่งแถวต่อเวลาต่อ system เรียง ALL, G, R, E, C
    แกนเวลาคือเวลาที่เรียงแล้วของ `times_utc` (ถ้าให้) รวมกับเวลาทุกแถวใน rows ทุกเวลาได้ครบ 5 แถวแม้ไม่มีดาวที่ใช้ได้
    ต้องส่ง `times_utc` (เช่น eph.times_utc) เมื่อ rows มาจาก aer_rows เพราะ aer_rows ตัดแถว El < 0 ทิ้ง
    จุดเวลาที่ไม่มีดาวเหนือขอบฟ้าเลยจึงไม่อยู่ใน rows
    n_visible นับดาวที่ El ≥ min_el_deg และไม่มีธงใน DOP_EXCLUDED_FLAGS (PRN ที่ไม่อยู่ใน flags ไม่มีธง)
    ค่า DOP เป็น None เมื่อ `dop` คืน None
    แถวของดาวที่ไม่ใช่ GNSS (เช่นดาวถ่ายภาพระบบ X) ถูกข้ามทั้งแถว ไม่เพิ่มจุดเวลาด้วย ผลจึงเหมือนไม่มีแถวนั้น"""
    by_time: dict = {t: [] for t in times_utc} if times_utc is not None else {}
    for r in rows:
        if r.prn[:1] not in GNSS_GROUPS:
            continue
        by_time.setdefault(r.time_utc, [])
        if r.el_deg >= fac.min_el_deg and not (flags.get(r.prn, frozenset()) & DOP_EXCLUDED_FLAGS):
            by_time[r.time_utc].append(r)
    out: list[dict] = []
    for time_utc in sorted(by_time):
        usable = by_time[time_utc]
        for system in _SYSTEMS:
            sats = usable if system == "ALL" else [r for r in usable if r.prn.startswith(system)]
            d = dop([(r.az_deg, r.el_deg) for r in sats])
            row = {"time_utc": time_utc, "system": system, "n_visible": len(sats)}
            row.update({key: getattr(d, key) if d is not None else None for key in _DOP_KEYS})
            out.append(row)
    return out
