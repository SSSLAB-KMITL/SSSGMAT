"""ค่าต่อดาวของ Gpredict (List / Single sat) จากสถานะ GMAT (หัวข้อ 6.1 และ 6.2 ของ spec)

รับ r (กม.) และ v (กม./วินาที) ในกรอบ EarthFixed ที่ interpolate จาก GMAT, เวลา T และสถานีผู้สังเกต แล้วคำนวณค่าทุกช่อง
ที่ Gpredict แสดง สูตรที่ Gpredict กำหนดไว้ใช้ค่าคงที่เดียวกับมัน ไม่มี I/O และไม่มี thread

ค่าที่ไม่ได้มาจาก GMAT (หัวข้อ 6.2): Orbit number (สูตรของ Gpredict จาก TLE), ตำแหน่งดวงอาทิตย์ (astro.py), GEO และ Decayed (จาก TLE)
มุมเป็นองศา ระยะเป็นกิโลเมตร เวลาเป็น datetime ที่มี tzinfo (UTC)
"""

import math
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from gnss_predict.astro import ecef_to_eci, sun_ecef_km
from gnss_predict.config import WGS84_A_KM
from gnss_predict.geometry import ecef_to_aer, ecef_to_geodetic, geodetic_to_ecef

from .store import Qth

Vec3 = tuple[float, float, float]

OMEGA_EARTH = 7.292115e-5               # rad/s รอบแกน z
MU_EARTH = 398600.4418                  # km^3/s^2
C_KMS = 299792.458
GP_RE_KM = 6378.135                     # รัศมีโลกที่ Gpredict ใช้คำนวณ Footprint
GP_FOOTPRINT_K = 12756.33
DOPPLER_REF_HZ = 100e6                  # Gpredict แสดง Doppler ที่ 100 MHz
GEO_MEAN_MOTION, GEO_TOLERANCE = 1.0027, 0.0002          # รอบต่อวัน
DECAY_RATE_LIMIT = 16.666666
DIR_THRESHOLD_KMS = 0.001
TWILIGHT_SUN_EL_DEG = -6.0
AE = 1.0                                # หน่วยรัศมีโลกในสูตร orbit number (B* ของ TLE)
ORBIT_START_TOLERANCE_S = 1e-3

# ช่องที่ observe() คืน ลำดับตามตัวอย่าง tick ในหัวข้อ 7.3 (ไม่รวม norad, name, next_aos, next_los, always)
OBSERVE_KEYS = ("az", "el", "dir", "ra", "dec", "range_km", "range_rate_kms", "lat_deg", "lon_deg", "ssp",
                "footprint_km", "alt_km", "vel_kms", "doppler_hz", "loss_db", "delay_ms", "ma", "phase_deg",
                "orbit", "vis")

_UTC = timezone.utc
_IMPLIED_DECIMAL_RE = re.compile(r"([+-]?)(\d+)([+-]\d)")


# ---------- TLE ----------

@dataclass(frozen=True)
class TleElements:
    """element ที่ observe ใช้จาก TLE: mean_motion เป็นรอบต่อวัน, ndot2 คือช่อง "first derivative of mean motion / 2"
    (รอบต่อวัน² ตามที่เขียนใน TLE), bstar เป็นค่าดิบของ TLE, มุมเป็นองศา"""
    epoch: datetime
    mean_motion: float
    ndot2: float
    bstar: float
    incl_deg: float
    raan_deg: float
    ecc: float
    argp_deg: float
    m0_deg: float
    revnum: int


def _implied_decimal(field: str) -> float:
    """ทศนิยมสมมติของ TLE เช่น ' 30164-3' = +0.30164e-3"""
    m = _IMPLIED_DECIMAL_RE.fullmatch(field.strip())
    if not m:
        raise ValueError(f"ช่องทศนิยมสมมติอ่านไม่ได้: {field!r}")
    return (-1.0 if m[1] == "-" else 1.0) * float("0." + m[2]) * 10.0 ** int(m[3])


def parse_tle(lines) -> TleElements:
    """อ่าน TLE สองบรรทัดตามคอลัมน์มาตรฐาน (ไม่ตรวจ checksum) บรรทัดสั้นกว่า 68 ตัวอักษร ขึ้นต้นผิด หรืออ่านตัวเลขไม่ได้ -> ValueError

    ปี 57-99 เป็น 19xx และ 00-56 เป็น 20xx
    """
    try:
        line1, line2 = lines
    except (TypeError, ValueError):
        raise ValueError("TLE ต้องมีสองบรรทัด") from None
    if not (isinstance(line1, str) and isinstance(line2, str)):
        raise ValueError("บรรทัดของ TLE ต้องเป็นข้อความ")
    if not (line1.startswith("1 ") and line2.startswith("2 ")):
        raise ValueError("บรรทัดของ TLE ต้องขึ้นต้นด้วย '1 ' และ '2 ' ตามลำดับ")
    if len(line1) < 68 or len(line2) < 68:
        raise ValueError("บรรทัดของ TLE สั้นกว่า 68 ตัวอักษร")
    try:
        yy, doy = int(line1[18:20]), float(line1[20:32])
        if not 1.0 <= doy < 367.0:
            raise ValueError(f"วันที่ของปี {doy} อยู่นอกช่วง")
        year = 2000 + yy if yy < 57 else 1900 + yy
        return TleElements(
            epoch=datetime(year, 1, 1, tzinfo=_UTC) + timedelta(days=doy - 1.0),
            mean_motion=float(line2[52:63]),
            ndot2=float(line1[33:43]),
            bstar=_implied_decimal(line1[53:61]),
            incl_deg=float(line2[8:16]),
            raan_deg=float(line2[17:25]),
            ecc=int(line2[26:33]) / 1e7,
            argp_deg=float(line2[34:42]),
            m0_deg=float(line2[43:51]),
            revnum=int(line2[63:68]),
        )
    except ValueError as exc:
        raise ValueError(f"อ่านค่าใน TLE ไม่ได้: {exc}") from exc


def is_geo(el: TleElements) -> bool:
    """GEO ตามกติกา Gpredict: |mean motion - 1.0027| < 0.0002 รอบต่อวัน"""
    return abs(el.mean_motion - GEO_MEAN_MOTION) < GEO_TOLERANCE


def is_decayed(el: TleElements, t: datetime) -> bool:
    """Decayed ตามกติกา Gpredict: epoch + (16.666666 - mean motion) / (10·|ndot2|) วัน < T ถ้า ndot2 = 0 ไม่เคย decayed
    เทียบเป็นจำนวนวันตรง ๆ เพื่อไม่ให้ timedelta ล้นเมื่อ ndot2 เล็กมาก"""
    if el.ndot2 == 0.0:
        return False
    return _days_since_epoch(el, t) > (DECAY_RATE_LIMIT - el.mean_motion) / (10.0 * abs(el.ndot2))


# ---------- Orbit number ----------

def _days_since_epoch(el: TleElements, t: datetime) -> float:
    return (t - el.epoch).total_seconds() / 86400.0


def _revs(el: TleElements, days: float) -> float:
    """ค่าในวงเล็บแรกของสูตร orbit number ของ Gpredict: (n + Δt·B*·ae)·Δt + (M0 + ω)/2π"""
    return (el.mean_motion + days * el.bstar * AE) * days + (el.m0_deg + el.argp_deg) / 360.0


def orbit_number(el: TleElements, t: datetime) -> int:
    """Orbit number ของ Gpredict: floor((n + Δt·B*·ae)·Δt + (M0+ω)/2π) - floor((M0+ω)/2π) + rev number"""
    base = math.floor((el.m0_deg + el.argp_deg) / 360.0)
    return math.floor(_revs(el, _days_since_epoch(el, t))) - base + el.revnum


def orbit_start(el: TleElements, t: datetime) -> datetime:
    """ต้นรอบปัจจุบัน: เวลา <= t ที่ค่าในวงเล็บของ orbit number ข้ามจำนวนเต็ม floor(ค่า ณ t) ล่าสุด หาด้วยการแบ่งครึ่งจนช่วง <= 1 มิลลิวินาที
    คืนปลายบน (ขณะแรกที่ค่าถึงจำนวนเต็ม) จึงได้ orbit_number เท่า t เสมอ"""
    days = _days_since_epoch(el, t)
    k = math.floor(_revs(el, days))
    step = 1.0 / el.mean_motion if el.mean_motion > 1e-6 else 1.0          # ถอยทีละ 1 รอบ เพิ่มเป็นสองเท่าจนข้ามจุดตัด
    lo = days - step
    for _ in range(16):
        if _revs(el, lo) < k:
            break
        step *= 2.0
        lo = days - step
    hi = days
    for _ in range(64):
        if (hi - lo) * 86400.0 <= ORBIT_START_TOLERANCE_S:
            break
        mid = 0.5 * (lo + hi)
        if _revs(el, mid) < k:
            lo = mid
        else:
            hi = mid
    return min(el.epoch + timedelta(days=hi), t)


# ---------- ค่าทีละช่อง ----------

def maidenhead(lat: float, lon: float) -> str:
    """Maidenhead locator 6 ตัวอักษร (ฟิลด์ตัวใหญ่ 2, ตัวเลข 2, subsquare ตัวเล็ก 2; ลองจิจูดมาก่อน) ค่าสุดขอบ lat 90 / lon 180 ปัดลงช่องสุดท้าย"""
    lon_i = min(max(int((lon + 180.0) * 12.0), 0), 4319)              # ช่องละ 5' = 1/12 องศา
    lat_i = min(max(int((lat + 90.0) * 24.0), 0), 4319)               # ช่องละ 2.5' = 1/24 องศา

    def split(i: int) -> tuple[str, str, str]:
        return chr(ord("A") + i // 240), str(i // 24 % 10), chr(ord("a") + i % 24)
    (lon_f, lon_s, lon_u), (lat_f, lat_s, lat_u) = split(lon_i), split(lat_i)
    return lon_f + lat_f + lon_s + lat_s + lon_u + lat_u


def footprint_km(alt_km: float) -> float:
    """Footprint ของ Gpredict: 12756.33 · acos(6378.135 / (6378.135 + Alt)) (Alt ติดลบนับเป็น 0)"""
    return GP_FOOTPRINT_K * math.acos(GP_RE_KM / (GP_RE_KM + max(alt_km, 0.0)))


def doppler_hz(rate_kms: float) -> float:
    """Doppler ที่ 100 MHz: -100e6 · range rate / c (Hz) range rate บวกคือกำลังห่างออก"""
    return -DOPPLER_REF_HZ * rate_kms / C_KMS


def loss_db(range_km: float) -> float:
    """Path loss: 72.4 + 20·log10(Range กม.) (ระยะ <= 0 ใช้ 1e-6 กม. แทนเพื่อไม่ให้ log ล้ม)"""
    return 72.4 + 20.0 * math.log10(max(range_km, 1e-6))


def delay_ms(range_km: float) -> float:
    """Signal delay: Range / 299.792458 (มิลลิวินาที)"""
    return range_km / (C_KMS / 1000.0)


def _shifted_velocity(r: Vec3, v: Vec3) -> Vec3:
    """v + ω⊕ × r โดย ω⊕ ชี้ +z: ความเร็วเทียบกับกรอบเฉื่อย แต่ยังแสดงในแกน EarthFixed"""
    return (v[0] - OMEGA_EARTH * r[1], v[1] + OMEGA_EARTH * r[0], v[2])


def inertial_speed_kms(r: Vec3, v: Vec3) -> float:
    """Velocity ของ Gpredict: |v + ω⊕ × r|"""
    return math.hypot(*_shifted_velocity(r, v))


def radec_deg(r: Vec3, q: Vec3, t: datetime) -> tuple[float, float]:
    """RA (0-360) และ Dec topocentric: เวกเตอร์ r - q (ECEF) หมุนรอบแกน z ด้วย GMST เป็นกรอบเฉื่อยของวันนั้น"""
    x, y, z = ecef_to_eci((r[0] - q[0], r[1] - q[1], r[2] - q[2]), t)
    ra = math.degrees(math.atan2(y, x)) % 360.0
    return (0.0 if ra >= 360.0 else ra), math.degrees(math.atan2(z, math.hypot(x, y)))


def osculating_phase_deg(r: Vec3, v: Vec3, t: datetime) -> float:
    """Orbit Phase: mean anomaly (0-360 องศา) ของวงโคจร osculating จาก r, v ในกรอบเฉื่อย
    (r หมุนด้วย GMST, v + ω⊕ × r) ใช้ e·sinE = r·v/√(μa), e·cosE = 1 - r/a จึงไม่ต้องแก้สมการ Kepler
    วงโคจรที่ไม่ปิด (พลังงาน >= 0) -> ValueError"""
    r_i = ecef_to_eci(r, t)
    v_i = ecef_to_eci(_shifted_velocity(r, v), t)
    dist = math.hypot(*r_i)
    energy = 0.5 * (v_i[0] ** 2 + v_i[1] ** 2 + v_i[2] ** 2) - MU_EARTH / dist
    if energy >= 0.0:
        raise ValueError("วงโคจร osculating ไม่ปิด (พลังงาน >= 0) หา mean anomaly ไม่ได้")
    a = -MU_EARTH / (2.0 * energy)
    e_sin = (r_i[0] * v_i[0] + r_i[1] * v_i[1] + r_i[2] * v_i[2]) / math.sqrt(MU_EARTH * a)
    e_cos = 1.0 - dist / a
    m = math.degrees(math.atan2(e_sin, e_cos) - e_sin) % 360.0
    return 0.0 if m >= 360.0 else m


def _unit_sun(t: datetime) -> Vec3:
    s = sun_ecef_km(t)
    n = math.hypot(*s)
    return s[0] / n, s[1] / n, s[2] / n


def visibility(r: Vec3, t: datetime, q_lat: float, q_lon: float, el_deg: float,
               twilight_deg: float = TWILIGHT_SUN_EL_DEG) -> str:
    """Visibility: ดาวอยู่ในเงาทรงกระบอกของโลก -> 'E'; โดนแสง, El >= 0 และดวงอาทิตย์ที่ QTH <= twilight_deg -> 'V'; นอกนั้น 'D'
    twilight_deg คือ Twilight threshold ของ Preferences (ตั้งต้น -6°, Gpredict รับ -18..0)
    เงาคือครึ่งหลังโลกที่ระยะตั้งฉากกับแกนโลก-ดวงอาทิตย์ < รัศมีเส้นศูนย์สูตร WGS84 ส่วนระดับดวงอาทิตย์ที่ QTH วัดจากเส้นตั้งฉากกับ ellipsoid"""
    s = _unit_sun(t)
    along = r[0] * s[0] + r[1] * s[1] + r[2] * s[2]
    if along < 0.0 and math.hypot(r[0] - along * s[0], r[1] - along * s[1], r[2] - along * s[2]) < WGS84_A_KM:
        return "E"
    if el_deg < 0.0:
        return "D"
    lat, lon = math.radians(q_lat), math.radians(q_lon)
    sin_sun_el = (s[0] * math.cos(lat) * math.cos(lon) + s[1] * math.cos(lat) * math.sin(lon) + s[2] * math.sin(lat))
    sun_el = math.degrees(math.asin(max(-1.0, min(1.0, sin_sun_el))))
    return "V" if sun_el <= twilight_deg else "D"


def direction(rate: float, prev_rate: float | None, geo: bool, decayed: bool) -> str:
    """Dir: 'G' GEO, 'D' decayed, '↓' ถ้า range rate > 0.001, '↑' ถ้า < -0.001; ระหว่างนั้นเทียบ tick ก่อน
    ลดลง '↺' (เริ่มเข้าใกล้) ไม่ลดหรือไม่มี tick ก่อน '↷'"""
    if geo:
        return "G"
    if decayed:
        return "D"
    if rate > DIR_THRESHOLD_KMS:
        return "↓"
    if rate < -DIR_THRESHOLD_KMS:
        return "↑"
    return "↺" if prev_rate is not None and rate < prev_rate else "↷"


# ---------- สถานีผู้สังเกตและค่ารวม ----------

@dataclass(frozen=True)
class QthGeo:
    """QTH ที่แปลงเป็น ECEF แล้ว (คำนวณครั้งเดียวต่อสถานี ไม่ใช่ทุก tick)"""
    name: str
    location: str
    lat_deg: float
    lon_deg: float
    alt_m: float
    ecef_km: Vec3


def qth_geo(q: Qth) -> QthGeo:
    return QthGeo(q.name, q.location, q.lat_deg, q.lon_deg, q.alt_m, geodetic_to_ecef(q.lat_deg, q.lon_deg, q.alt_m))


def observe(r: Vec3, v: Vec3, t: datetime, q: QthGeo, el: TleElements, prev_rate: float | None,
            twilight_deg: float = TWILIGHT_SUN_EL_DEG) -> dict:
    """ค่าของดาวหนึ่งดวง ณ เวลา T ครบทุกช่องของ OBSERVE_KEYS (ช่องในตัวอย่าง tick ของหัวข้อ 7.3 ยกเว้น norad, name, next_aos, next_los, always)

    r, v: EarthFixed จาก GMAT (v เทียบกับโลกที่หมุน) prev_rate: range rate ของ tick ก่อน (None ถ้าไม่มี)
    twilight_deg: Twilight threshold ที่ใช้ตัดสิน vis ('V' เมื่อดวงอาทิตย์ที่ QTH <= ค่านี้)
    """
    az, elev, rng = ecef_to_aer(r, q.ecef_km, q.lat_deg, q.lon_deg)
    d = (r[0] - q.ecef_km[0], r[1] - q.ecef_km[1], r[2] - q.ecef_km[2])
    rate = (d[0] * v[0] + d[1] * v[1] + d[2] * v[2]) / rng if rng > 0.0 else 0.0     # บวกคือกำลังห่างออก
    lat, lon, alt = ecef_to_geodetic(*r)
    ra, dec = radec_deg(r, q.ecef_km, t)
    phase = osculating_phase_deg(r, v, t)
    return {
        "az": az, "el": elev,
        "dir": direction(rate, prev_rate, is_geo(el), is_decayed(el, t)),
        "ra": ra, "dec": dec,
        "range_km": rng, "range_rate_kms": rate,
        "lat_deg": lat, "lon_deg": lon, "ssp": maidenhead(lat, lon),
        "footprint_km": footprint_km(alt), "alt_km": alt,
        "vel_kms": inertial_speed_kms(r, v),
        "doppler_hz": doppler_hz(rate), "loss_db": loss_db(rng), "delay_ms": delay_ms(rng),
        "ma": phase * 256.0 / 360.0, "phase_deg": phase,
        "orbit": orbit_number(el, t),
        "vis": visibility(r, t, q.lat_deg, q.lon_deg, elev, twilight_deg),
    }
