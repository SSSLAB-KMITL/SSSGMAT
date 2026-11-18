"""Satellite Info -> แท็บ "Orbit Info" (หัวข้อ 7 ของ spec งานย่อย 4, ref-D §8.1, sat-info.c)

ค่าในหน้าต่างนี้เป็นค่าของ TLE เอง ไม่ใช่ตำแหน่งดาว จึงอ่านจากบรรทัด TLE ตรงๆ ไม่ผ่าน GMAT (ไม่ขัดกติกา GMAT ของ core)
server ส่งตัวเลขดิบ หน้าเว็บจัดรูปแบบเอง (`%.4f°`, `%.7f`, `%.8f [rev/day]`, `%.5e [...]`) และจัดเวลา Epoch ตาม Time format ของ Preferences
ไม่มี I/O
"""

import re

from .observe import _implied_decimal, parse_tle
from .runtime import iso_ms
from .satdb import SatRecord

ECC_MIN = 1e-6                          # Gpredict ปรับ eccentricity ที่ต่ำกว่านี้เป็นค่านี้ตอนอ่าน TLE (sgp_in.c:250)
_LEADING_INT_RE = re.compile(r"[ \t\n\v\f\r]*([0-9]+)")


def _atoi(text: str) -> int:
    """atoi ของ C: เลขนำหน้า (ข้ามช่องว่างหน้า) ไม่มีเลข = 0 (ช่อง element set ว่างได้ 0 แบบ Gpredict)"""
    m = _LEADING_INT_RE.match(text)
    return int(m[1]) if m else 0


def orbit_info(r: SatRecord) -> dict:
    """ช่องของแท็บ Orbit Info ตามลำดับแถว (ref-D §8.1) ValueError ถ้า TLE ของดาวอ่านไม่ได้

    - catnum: (ของเรา) เลข NORAD ของดวงนั้น (Gpredict อ่านคอลัมน์ 3-7 ด้วย atoi ซึ่งได้ 0 กับดาว Alpha-5) TLE ปกติได้ค่าเท่ากัน
    - intl_designator: 8 ตัวดิบของคอลัมน์ 10-17 รวมช่องว่างท้าย ("98067A  ")
    - epoch: ISO 8601 UTC ที่ parse_tle อ่าน (ปีสองหลัก >= 57 เป็น 19xx, decision 12) หน้าเว็บตัดเศษวินาทีเอง
    - ecc: ต่ำกว่า 1e-6 เป็น 1e-6, mean_motion รอบต่อวัน, ndot2 = ½ d/dt (rev/day²) จากคอลัมน์ 34-43
    - nddot6: 1/6 d²/dt² (rev/day³) จากคอลัมน์ 45-52 แบบทศนิยมสมมติ (ตัวเลขของ TLE เป็นค่านี้อยู่แล้ว ไม่ต้องหาร)
    - bstar: B* × ae เมื่อ ae = 1.0 จึงเท่าค่าใน TLE (หน่วย 1/R_E)"""
    el = parse_tle(r.tle_lines)
    line1 = r.tle_lines[0]
    return {
        "name": r.name,
        "status": r.status,
        "catnum": r.norad,
        "intl_designator": line1[9:17],
        "element_set": _atoi(line1[64:68]),
        "epoch": iso_ms(el.epoch),
        "revnum": el.revnum,
        "incl_deg": el.incl_deg,
        "raan_deg": el.raan_deg,
        "ecc": max(el.ecc, ECC_MIN),
        "argp_deg": el.argp_deg,
        "ma_deg": el.m0_deg,
        "mean_motion": el.mean_motion,
        "ndot2": el.ndot2,
        "nddot6": _implied_decimal(line1[44:52]),
        "bstar": el.bstar,
    }
