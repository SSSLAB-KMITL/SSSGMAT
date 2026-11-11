"""มุมมองดาวเทียมจากสถานี และจุดตัดชั้นไอโอโนสเฟียร์ (สูตรอยู่ในหัวข้อ 6 ของ spec)

มุมทั้งหมดเป็นองศา ระยะเป็นกิโลเมตร
"""

import math

from .config import RE_KM, SHELL_KM, WGS84_A_KM, WGS84_F


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


def geodetic_to_ecef(lat_deg: float, lon_deg: float, h_m: float) -> tuple[float, float, float]:
    """พิกัดภูมิศาสตร์ WGS84 (องศา, เมตรเหนือ ellipsoid) → ECEF (กม.) ตามหัวข้อ 7.1 ของ spec engine"""
    lat, lon = math.radians(lat_deg), math.radians(lon_deg)
    e2 = WGS84_F * (2.0 - WGS84_F)
    n = WGS84_A_KM / math.sqrt(1.0 - e2 * math.sin(lat) ** 2)
    h = h_m / 1000.0
    return ((n + h) * math.cos(lat) * math.cos(lon),
            (n + h) * math.cos(lat) * math.sin(lon),
            (n * (1.0 - e2) + h) * math.sin(lat))


def ecef_to_aer(sat_km: tuple[float, float, float], sta_km: tuple[float, float, float],
                lat_deg: float, lon_deg: float) -> tuple[float, float, float]:
    """ตำแหน่ง ECEF ของดาวเทียมและสถานี → (Az, El, ระยะ กม.)"""
    az, el = ecef_to_az_el(sat_km, sta_km, lat_deg, lon_deg)
    return az, el, math.dist(sat_km, sta_km)


def ecef_to_geodetic(x_km: float, y_km: float, z_km: float) -> tuple[float, float, float]:
    """ECEF (กม.) → (ละติจูด°, ลองจิจูด° ในช่วง (−180, 180], ความสูงเหนือ ellipsoid WGS84 กม.)

    วนซ้ำจนละติจูดเปลี่ยนไม่เกิน 1e-12 rad (สูงสุด 10 รอบ) ที่ขั้วโลก (hypot(x, y) < 1e-9) คืนละติจูด ±90 และลองจิจูด 0
    หมายเหตุหน่วย: ที่นี่ความสูงเป็นกม. ส่วน geodetic_to_ecef รับความสูงเป็นเมตร
    """
    e2 = WGS84_F * (2.0 - WGS84_F)
    p = math.hypot(x_km, y_km)
    if p < 1e-9:
        b_km = WGS84_A_KM * (1.0 - WGS84_F)
        return math.copysign(90.0, z_km), 0.0, abs(z_km) - b_km
    lon = math.degrees(math.atan2(y_km, x_km))
    if lon <= -180.0:
        lon += 360.0
    lat = math.atan2(z_km, p * (1.0 - e2))
    for _ in range(10):
        n = WGS84_A_KM / math.sqrt(1.0 - e2 * math.sin(lat) ** 2)
        new = math.atan2(z_km + e2 * n * math.sin(lat), p)
        done = abs(new - lat) <= 1e-12
        lat = new
        if done:
            break
    n = WGS84_A_KM / math.sqrt(1.0 - e2 * math.sin(lat) ** 2)
    # ใช้สูตรที่ไม่หารด้วยค่าที่เข้าใกล้ศูนย์: cos(lat) เล็กใกล้ขั้ว, sin(lat) เล็กใกล้เส้นศูนย์สูตร
    if abs(lat) < math.pi / 4:
        h = p / math.cos(lat) - n
    else:
        h = z_km / math.sin(lat) - n * (1.0 - e2)
    return math.degrees(lat), lon, h
