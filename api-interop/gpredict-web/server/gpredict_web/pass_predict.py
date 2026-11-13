"""ค่าของ pass และการเลือก pass แบบ Gpredict (หัวข้อ 3.3 และ 3.4 ของ spec) ไม่มี I/O และไม่มี thread

รับรายการ pass จาก passes.find_passes (AOS/LOS แบ่งครึ่งถึง 0.1 วินาที, Max El จาก golden-section) แล้ว
- has_aos: ดาวขึ้นเหนือขอบฟ้าของสถานีได้ไหม ตัดสินจาก TLE ตามกติกา has_aos ของ Gpredict (ref-P §4.1)
- get_pass / get_passes: เลือก pass ตามกติกา get_pass_engine / get_passes ของ Gpredict (ref-P §3.5, §4.5, §4.8)
- describe: ค่าของ pass และแถวของแท็บ Data ที่สุ่มตามเวลาแบบ ref-P §2.3 (ค่าแต่ละแถวจาก observe)
"""

import math
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta

from gnss_predict.geometry import ecef_to_aer

from .ephem import SatEphem
from .observe import (
    GP_RE_KM, MU_EARTH, QthGeo, TleElements, Vec3, is_decayed, is_geo, observe, orbit_number, visibility,
)
from .passes import Pass
from .runtime import iso_ms

NEXT_PASS_OFFSET = timedelta(days=0.007)        # "Show next pass" ขณะดาวอยู่เหนือขอบฟ้าเริ่มค้นที่ LOS + ค่านี้
PASS_GAP = timedelta(days=0.014)                # pass ที่ไม่ผ่านหรือ pass ก่อนหน้าของ get_passes: ค้นต่อจาก LOS + ค่านี้

# ช่องของแถวในแท็บ Data ตามลำดับคอลัมน์ของ Gpredict (spec §9) ช่องที่ชื่อต่างจาก observe() อยู่ใน _OBSERVE_NAME
ROW_KEYS = ("t", "az", "el", "ra", "dec", "range_km", "rate_kms", "lat_deg", "lon_deg", "ssp", "footprint_km",
            "alt_km", "vel_kms", "doppler_hz", "loss_db", "delay_ms", "ma", "phase_deg", "vis")
_OBSERVE_NAME = {"rate_kms": "range_rate_kms"}
_VIS_LETTERS = "VDE"                            # ตำแหน่ง 1, 2, 3 ของสตริง Vis


# ---------------------------------------------------------------- ดาวขึ้นได้ไหม

def has_aos(el: TleElements, qth_lat_deg: float, t: datetime) -> bool:
    """False เมื่อดาวเป็น GEO, decayed ที่เวลา t, mean motion เป็น 0 หรือรูปวงโคจรไปไม่ถึงละติจูดของสถานี
    ข้อสุดท้าย: acos(R / (apogee + R)) + ความเอียง (เกิน 90° พับเป็น 180° − i) ต้องมากกว่า |ละติจูด|
    โดย a = (μ/n²)^(1/3) จาก mean motion และ apogee = a(1 + e) − R"""
    if is_geo(el) or is_decayed(el, t) or el.mean_motion == 0.0:
        return False
    incl = el.incl_deg if el.incl_deg < 90.0 else 180.0 - el.incl_deg
    n_rad_s = el.mean_motion * 2.0 * math.pi / 86400.0
    a = (MU_EARTH / n_rad_s ** 2) ** (1.0 / 3.0)
    ratio = GP_RE_KM / (a * (1.0 + el.ecc))                       # = R / (apogee + R)
    if ratio > 1.0:
        return False                                              # apogee ใต้ผิวโลก: acos ของ Gpredict ได้ NaN จึงเป็น FALSE
    return math.degrees(math.acos(ratio)) + incl > abs(qth_lat_deg)


# ---------------------------------------------------------------- แถวและค่าของ pass

def sample_times(aos: datetime, los: datetime, n_entries: int, resolution_s: int) -> list[datetime]:
    """เวลาแถวของ pass: step = max((LOS − AOS) / n_entries, resolution_s) แถวที่ k อยู่ที่ AOS + k·step ตราบที่ไม่เกิน LOS
    คูณ ไม่บวกสะสม เมื่อ step มาจาก n_entries จึงได้ n_entries + 1 แถวพอดีและแถวสุดท้ายคือ LOS"""
    dt_s = (los - aos).total_seconds()
    by_entries = dt_s / n_entries
    if by_entries >= resolution_s:
        step_s, last = by_entries, n_entries                      # k·dt/N <= dt  <=>  k <= N
    else:
        step_s, last = float(resolution_s), math.floor(dt_s / resolution_s)
    return [min(aos + timedelta(seconds=k * step_s), los) for k in range(last + 1)]


@dataclass(frozen=True)
class PassData:
    """ค่าของ pass หนึ่งรอบ rows คือแถวของแท็บ Data ช่องตาม ROW_KEYS (t เป็น datetime)"""
    orbit: int
    aos: datetime
    tca: datetime
    los: datetime
    max_el: float
    aos_az: float
    max_el_az: float
    los_az: float
    vis: str
    rows: list[dict]


def _state(eph: SatEphem, t: datetime) -> tuple[Vec3, Vec3]:
    state = eph.state_at(t)
    if state is None:
        raise ValueError(f"ไม่มีตำแหน่งของดาวที่ {t.isoformat()} (อยู่นอกช่วงข้อมูลที่ใช้ได้)")
    return state


def describe(p: Pass, eph: SatEphem, q: QthGeo, el: TleElements, n_entries: int, resolution_s: int,
             twilight_deg: float) -> PassData:
    """ค่าของ pass และแถวของแท็บ Data (spec §3.3)

    AOS, LOS, TCA และ Max El มาจาก p (จุดสูงสุดจริง ไม่ใช่แถวที่สุ่มแบบ Gpredict **(ของเรา)** spec §10.1)
    Az ที่ AOS, TCA และ LOS คำนวณที่เวลานั้นพอดี Orbit คือ orbit number ที่ AOS
    Vis มาจากทุกแถวและจุด TCA (Gpredict ใช้แค่แถว จุด TCA เป็น **(ของเรา)**) twilight_deg คือ Twilight threshold
    p ต้องรู้ทั้ง AOS และ LOS (pass ที่ get_pass คืนเป็นแบบนี้เสมอ) ไม่งั้น ValueError
    """
    if p.aos is None or p.los is None:
        raise ValueError("pass ที่ไม่รู้ AOS หรือ LOS สร้างแถวของ Data ไม่ได้")
    rows = []
    for t in sample_times(p.aos, p.los, n_entries, resolution_s):
        r, v = _state(eph, t)
        values = observe(r, v, t, q, el, None, twilight_deg)
        rows.append({"t": t, **{key: values[_OBSERVE_NAME.get(key, key)] for key in ROW_KEYS[1:]}})

    def azimuth(t: datetime) -> float:
        return ecef_to_aer(_state(eph, t)[0], q.ecef_km, q.lat_deg, q.lon_deg)[0]

    r_tca = _state(eph, p.t_max_el)[0]
    tca_az, tca_el, _ = ecef_to_aer(r_tca, q.ecef_km, q.lat_deg, q.lon_deg)
    seen = {row["vis"] for row in rows}
    seen.add(visibility(r_tca, p.t_max_el, q.lat_deg, q.lon_deg, tca_el, twilight_deg))
    return PassData(
        orbit=orbit_number(el, p.aos), aos=p.aos, tca=p.t_max_el, los=p.los, max_el=p.max_el,
        aos_az=azimuth(p.aos), max_el_az=tca_az, los_az=azimuth(p.los),
        vis="".join(c if c in seen else "-" for c in _VIS_LETTERS), rows=rows,
    )


def pass_to_dict(d: PassData, rows: bool = True) -> dict:
    """pass ใน API (spec §9) เวลาเป็น iso_ms rows=False ไม่มีช่อง rows (สรุปของ Sky at a glance)"""
    out = {"orbit": d.orbit, "aos": iso_ms(d.aos), "tca": iso_ms(d.tca), "los": iso_ms(d.los), "max_el": d.max_el,
           "aos_az": d.aos_az, "max_el_az": d.max_el_az, "los_az": d.los_az, "vis": d.vis}
    if rows:
        out["rows"] = [{**row, "t": iso_ms(row["t"])} for row in d.rows]
    return out


# ---------------------------------------------------------------- เลือก pass

def get_pass(passes: Sequence[Pass], start: datetime, limit_days: float, min_el: float) -> Pass | None:
    """pass แรกตั้งแต่ start ที่ Max El >= min_el แบบ get_pass_engine ของ Gpredict (spec §3.4) None = ไม่มี pass

    - pass ที่ไม่ผ่าน: ค้นต่อจาก LOS + PASS_GAP แต่ limit ยังนับจาก start ของการเรียกนี้
    - AOS ต้องไม่เกิน start + limit_days ส่วน LOS เกินได้
    - pass ที่กำลังผ่านที่จุดค้นนับเป็น pass แรก แต่คืนให้เฉพาะเมื่อ AOS ถัดไปไม่เกิน start + limit_days (ref-P §3.5 ข้อ 7)
    - pass ที่ไม่รู้ AOS ถูกข้าม ถ้าต้องใช้ LOS หรือ AOS ถัดไปที่อยู่เลยข้อมูล ถือว่าไม่มี pass
    passes ต้องเรียงตามเวลา (ผลของ find_passes)
    """
    limit = start + timedelta(days=limit_days)
    t0 = start
    while True:
        cand = next((p for p in passes if p.aos is not None and (p.los is None or p.los > t0)), None)
        if cand is None or cand.los is None:
            return None
        if cand.aos <= t0:                                        # กำลังผ่าน
            nxt = next((p for p in passes if p.aos is not None and p.aos > cand.los), None)
            if nxt is None or nxt.aos > limit:
                return None
        elif cand.aos > limit:
            return None
        if cand.max_el >= min_el:
            return cand
        t0 = cand.los + PASS_GAP


def get_passes(passes: Sequence[Pass], start: datetime, days: float, count: int, min_el: float) -> list[Pass]:
    """สูงสุด count pass แบบ get_passes ของ Gpredict: แต่ละรอบเรียก get_pass จาก LOS + PASS_GAP ของ pass ก่อนหน้า
    ด้วย limit = days นับจากจุดนั้น (ช่วงเลื่อนตาม) หยุดเมื่อหาไม่เจอ หรือเมื่อจุดเริ่มค้นถัดไป >= start + days"""
    end = start + timedelta(days=days)
    found: list[Pass] = []
    t = start
    while len(found) < count:
        p = get_pass(passes, t, days, min_el)
        if p is None:
            break
        found.append(p)
        t = p.los + PASS_GAP
        if t >= end:
            break
    return found
