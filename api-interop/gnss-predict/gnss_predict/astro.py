"""ดาราศาสตร์ความแม่นยำต่ำ: เวลาสากลแบบ Julian, GMST, ตำแหน่งดวงอาทิตย์ และการหมุนระหว่างกรอบ ECEF/ECI

เวลาทุกค่าที่รับเข้ามาเป็น datetime ที่มี tzinfo (UTC) และถือว่า UT1 = UTC (ผิดไม่เกิน 0.9 วินาที ≈ 0.004°)
ตำแหน่งดวงอาทิตย์แม่นราว 0.01° พอสำหรับเส้นแบ่งกลางวัน-กลางคืนและการตัดสิน Visibility ไม่ใช่ ephemeris ที่แม่นยำสูง
ระยะเป็นกิโลเมตร มุมที่คืนจาก gmst_rad เป็นเรเดียน มุมที่คืนจาก subpoint เป็นองศา
"""

import math
from datetime import datetime, timezone

from .geometry import ecef_to_geodetic

Position = tuple[float, float, float]

AU_KM = 149597870.7
_J2000 = datetime(2000, 1, 1, 12, tzinfo=timezone.utc)
_J2000_JD = 2451545.0


def _days_since_j2000(t: datetime) -> float:
    """จำนวนวัน (ทศนิยม) นับจาก J2000.0 คำนวณจาก timedelta ตรง ๆ เพื่อไม่เสียความละเอียดจาก JD ที่ตัวเลขใหญ่"""
    return (t - _J2000).total_seconds() / 86400.0


def julian_date(t: datetime) -> float:
    """Julian Date ของเวลา UTC"""
    return _J2000_JD + _days_since_j2000(t)


def gmst_rad(t: datetime) -> float:
    """Greenwich Mean Sidereal Time (rad ในช่วง [0, 2π)) ตาม Meeus สมการ 12.4 (IAU 1982)"""
    d = _days_since_j2000(t)
    c = d / 36525.0
    deg = 280.46061837 + 360.98564736629 * d + 0.000387933 * c * c - c ** 3 / 38710000.0
    return math.radians(deg % 360.0)


def sun_eci_km(t: datetime) -> Position:
    """ตำแหน่งดวงอาทิตย์ในกรอบ mean equator of date (กม.) ตามสูตรความแม่นยำต่ำของ Astronomical Almanac"""
    n = _days_since_j2000(t)
    big_l = 280.460 + 0.9856474 * n
    g = math.radians(357.528 + 0.9856003 * n)
    lam = math.radians(big_l + 1.915 * math.sin(g) + 0.020 * math.sin(2.0 * g))
    eps = math.radians(23.439 - 0.0000004 * n)
    r = (1.00014 - 0.01671 * math.cos(g) - 0.00014 * math.cos(2.0 * g)) * AU_KM
    return (r * math.cos(lam), r * math.cos(eps) * math.sin(lam), r * math.sin(eps) * math.sin(lam))


def _rot_z(vec: Position, angle: float) -> Position:
    c, s = math.cos(angle), math.sin(angle)
    return (c * vec[0] - s * vec[1], s * vec[0] + c * vec[1], vec[2])


def ecef_to_eci(vec: Position, t: datetime) -> Position:
    """หมุนเวกเตอร์ ECEF → ECI รอบแกน z ด้วย +GMST (ไม่รวม precession/nutation/polar motion)"""
    return _rot_z(vec, gmst_rad(t))


def eci_to_ecef(vec: Position, t: datetime) -> Position:
    """หมุนเวกเตอร์ ECI → ECEF รอบแกน z ด้วย −GMST (ไม่รวม precession/nutation/polar motion)"""
    return _rot_z(vec, -gmst_rad(t))


def sun_ecef_km(t: datetime) -> Position:
    """ตำแหน่งดวงอาทิตย์ในกรอบ ECEF (กม.)"""
    return eci_to_ecef(sun_eci_km(t), t)


def subpoint(ecef_km: Position) -> tuple[float, float]:
    """จุดบนพื้นโลกใต้วัตถุ → (ละติจูด geodetic°, ลองจิจูด°) ตามแนวเส้นตั้งฉากกับ ellipsoid WGS84"""
    lat, lon, _ = ecef_to_geodetic(*ecef_km)
    return lat, lon
