"""มุมมองดาวเทียมจากสถานี และจุดตัดชั้นไอโอโนสเฟียร์ (สูตรอยู่ในหัวข้อ 6 ของ spec)

มุมทั้งหมดเป็นองศา ระยะเป็นกิโลเมตร
"""

import math

from .config import RE_KM, SHELL_KM


def _azimuth(east: float, north: float) -> float:
    az = math.degrees(math.atan2(east, north)) % 360.0
    # มุมติดลบที่เล็กมาก % 360 ได้ 360.0 พอดีใน float
    return az - 360.0 if az >= 360.0 else az


def sez_to_az_el(s_km: float, e_km: float, z_km: float) -> tuple[float, float]:
    """ตำแหน่งในกรอบ South-East-Zenith ของสถานี → (Az วัดจากทิศเหนือตามเข็มนาฬิกา, El)"""
    return _azimuth(e_km, -s_km), math.degrees(math.atan2(z_km, math.hypot(s_km, e_km)))


def mapping_factor(el_deg: float, re_km: float = RE_KM, shell_km: float = SHELL_KM) -> float:
    """MF ของ thin-shell แบบเดียวกับ mapping() ใน t02_5_rebuild_tec.py: VTEC = STEC × MF"""
    k = re_km * math.cos(math.radians(el_deg)) / (re_km + shell_km)
    return math.sqrt(1.0 - k * k)


def ipp(lat_deg: float, lon_deg: float, az_deg: float, el_deg: float,
        re_km: float = RE_KM, shell_km: float = SHELL_KM) -> tuple[float, float]:
    """ละติจูดและลองจิจูดของจุดตัดชั้นไอโอโนสเฟียร์ ลองจิจูดอยู่ในช่วง (−180, 180]"""
    el, az, lat = math.radians(el_deg), math.radians(az_deg), math.radians(lat_deg)
    k = re_km * math.cos(el) / (re_km + shell_km)
    psi = math.pi / 2 - el - math.asin(k)
    lat_ipp = math.asin(math.sin(lat) * math.cos(psi) + math.cos(lat) * math.sin(psi) * math.cos(az))
    dlon = math.atan2(math.sin(psi) * math.sin(az) * math.cos(lat),
                      math.cos(psi) - math.sin(lat) * math.sin(lat_ipp))
    lon = (lon_deg + math.degrees(dlon) + 180.0) % 360.0 - 180.0
    if lon <= -180.0:
        lon += 360.0
    return math.degrees(lat_ipp), lon


def ecef_to_az_el(sat_km: tuple[float, float, float], sta_km: tuple[float, float, float],
                  lat_deg: float, lon_deg: float) -> tuple[float, float]:
    """ตำแหน่ง ECEF ของดาวเทียมและสถานี → (Az, El) โดยไม่ผ่าน GMAT (ใช้ตอนตรวจกับ SP3)"""
    lat, lon = math.radians(lat_deg), math.radians(lon_deg)
    dx, dy, dz = (a - b for a, b in zip(sat_km, sta_km))
    north = (-math.sin(lat) * math.cos(lon) * dx - math.sin(lat) * math.sin(lon) * dy
             + math.cos(lat) * dz)
    east = -math.sin(lon) * dx + math.cos(lon) * dy
    up = math.cos(lat) * math.cos(lon) * dx + math.cos(lat) * math.sin(lon) * dy + math.sin(lat) * dz
    return _azimuth(east, north), math.degrees(math.atan2(up, math.hypot(north, east)))
