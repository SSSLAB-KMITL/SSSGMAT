"""AOS/LOS ภายในช่วงคำนวณของ GMAT (หัวข้อ 6.3 ของ spec) ไม่มี I/O และไม่มี thread

ขั้นตอน: El ของทุก epoch -> ช่วงคร่าวๆ ด้วย `analyze.intervals_from_elevations` ของ engine -> เพิ่ม pass สั้นที่โผล่ระหว่างสองตัวอย่าง
-> ปรับ AOS และ LOS ด้วยการแบ่งครึ่งบน El ที่ interpolate (SatEphem.state_at) จนช่วงเหลือไม่เกิน 0.1 วินาที -> Max El ด้วย golden-section

ค่าที่ interpolate ได้มีเฉพาะ [start + 5·STEP_S, stop − 5·STEP_S] ของช่วง (usable_span) จึงสรุปว่า
- AOS หรือ LOS ที่อยู่นอกช่วงนั้นหรือบนขอบช่วงเป็น None (ไม่รู้ ไม่ใช่ "ไม่มี")
- ส่วนของ pass ที่อยู่ในช่วงใช้ได้ว่างเปล่า (pass ทั้งก้อนอยู่ในขอบ 150 วินาทีแรกหรือท้าย) ไม่ถูกนับ ช่วงถัดไปที่ซ้อนกันจะเจอ pass นั้นเอง
- pass สั้นระหว่างสองตัวอย่างที่ตัวอย่างข้างเคียงล้ำเข้าไปในขอบ ไม่ถูกตรวจ (ไม่มีค่า interpolate ที่ตัวอย่างนั้น)
ฟังก์ชันไม่สมมติความยาวช่วง ใช้กับช่วงหลายวันได้เมื่อมี SatEphem ที่ยาวขึ้น
"""

import math
from bisect import bisect_left, bisect_right
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta

from gnss_predict.analyze import intervals_from_elevations
from gnss_predict.geometry import ecef_to_aer

from .config import STEP_S
from .ephem import HALF_WINDOW, SatEphem
from .observe import QthGeo

REFINE_S = 0.1                       # ความกว้างของช่วงที่แบ่งครึ่ง/golden-section เมื่อหยุด (วินาที)
SHORT_PASS_FLOOR_DEG = -2.0          # ตัวอย่างข้างจุด local max ต้องสูงกว่านี้ (และใต้ 0°) จึงลองหา pass สั้น
_INV_PHI = (math.sqrt(5.0) - 1.0) / 2.0


@dataclass(frozen=True)
class Pass:
    """aos/los เป็น None เมื่อ pass ถูกช่วงคำนวณตัด (ไม่รู้ค่า) max_el เป็นองศา t_max_el เป็นเวลาของ max_el"""
    aos: datetime | None
    los: datetime | None
    max_el: float
    t_max_el: datetime


# ---------------------------------------------------------------- ช่วงที่ใช้ได้และ El

def usable_span(eph: SatEphem) -> tuple[datetime, datetime] | None:
    """[start + 5·STEP_S, stop − 5·STEP_S] ช่วงที่ state_at ให้ค่า (None ถ้าช่วงสั้นเกินไปจนไม่เหลือช่วงที่ใช้ได้)"""
    if not eph.times:
        return None
    margin = timedelta(seconds=HALF_WINDOW * STEP_S)
    lo, hi = eph.times[0] + margin, eph.times[-1] - margin
    return (lo, hi) if lo < hi else None


def elevation_at(eph: SatEphem, q: QthGeo, t: datetime) -> float | None:
    """El (องศา) ของสถานะที่ interpolate ที่ t, None ถ้า t อยู่นอกช่วงที่ใช้ได้"""
    state = eph.state_at(t)
    if state is None:
        return None
    return ecef_to_aer(state[0], q.ecef_km, q.lat_deg, q.lon_deg)[1]


def pass_containing(passes: Sequence[Pass], t: datetime) -> Pass | None:
    """pass ที่ AOS <= t <= LOS (AOS หรือ LOS ที่เป็น None ถือว่าไม่จำกัดด้านนั้น)"""
    for p in passes:
        if (p.aos is None or p.aos <= t) and (p.los is None or t <= p.los):
            return p
    return None


# ---------------------------------------------------------------- ตัวช่วยเชิงตัวเลข (ทำงานในหน่วยวินาทีนับจาก times[0])

def _bisect(f: Callable[[float], float], lo: float, hi: float, rising: bool) -> float:
    """รากของ f ในช่วง [lo, hi] จนช่วงเหลือไม่เกิน REFINE_S คืนจุดกึ่งกลาง
    rising: f(lo) < 0 <= f(hi) (AOS) ไม่งั้น f(lo) >= 0 > f(hi) (LOS)"""
    while hi - lo > REFINE_S:
        mid = 0.5 * (lo + hi)
        if (f(mid) >= 0.0) == rising:
            hi = mid
        else:
            lo = mid
    return 0.5 * (lo + hi)


def _golden_max(f: Callable[[float], float], lo: float, hi: float) -> tuple[float, float]:
    """(x, f(x)) ที่ f สูงสุดในช่วง [lo, hi] (f ต้องมียอดเดียว) จนช่วงเหลือไม่เกิน REFINE_S"""
    c, d = hi - _INV_PHI * (hi - lo), lo + _INV_PHI * (hi - lo)
    fc, fd = f(c), f(d)
    while hi - lo > REFINE_S:
        if fc > fd:
            hi, d, fd = d, c, fc
            c = hi - _INV_PHI * (hi - lo)
            fc = f(c)
        else:
            lo, c, fc = c, d, fd
            d = lo + _INV_PHI * (hi - lo)
            fd = f(d)
    x = 0.5 * (lo + hi)
    return x, f(x)


# ---------------------------------------------------------------- pass

def find_passes(eph: SatEphem, q: QthGeo) -> list[Pass]:
    """pass ทั้งหมดของ eph เหนือ El 0° ตามหัวข้อ 6.3 เรียงตามเวลา"""
    span = usable_span(eph)
    if span is None:
        return []
    times = eph.times
    t0 = times[0]
    xs = [(t - t0).total_seconds() for t in times]
    lo_x, hi_x = (span[0] - t0).total_seconds(), (span[1] - t0).total_seconds()

    def at(x: float) -> datetime:
        return t0 + timedelta(seconds=x)

    def el(x: float) -> float:
        return elevation_at(eph, q, at(x))

    els = [ecef_to_aer(p, q.ecef_km, q.lat_deg, q.lon_deg)[1] for p in eph.pos]
    passes: list[Pass] = []

    def refined_aos(start: datetime) -> float | None:
        """AOS (วินาที) ของช่วงที่เริ่มด้วยการข้าม 0° ที่ start; None ถ้าอยู่ที่ขอบช่วงหรือนอกช่วงที่ใช้ได้"""
        if start <= t0:
            return None
        j = bisect_right(times, start) - 1                       # ตัวอย่างใต้ขอบฟ้าล่าสุดก่อนการข้าม
        if j >= 0 and els[j] >= 0.0:
            j -= 1
        if j < 0 or j + 1 >= len(times):
            return None
        lo, hi = xs[j], xs[j + 1]
        if hi < lo_x or lo > hi_x:
            return None
        if lo < lo_x:                                            # ปลายซ้ายของกรอบอยู่ในขอบ: ต้องใต้ขอบฟ้าที่ขอบของช่วงใช้ได้
            lo = lo_x
            if el(lo) >= 0.0:
                return None
        if hi > hi_x:
            hi = hi_x
            if el(hi) < 0.0:
                return None
        return _bisect(el, lo, hi, rising=True)

    def refined_los(stop: datetime) -> float | None:
        if stop >= times[-1]:
            return None
        j = bisect_left(times, stop)                             # ตัวอย่างใต้ขอบฟ้าแรกหลังการข้าม
        if j < len(times) and els[j] >= 0.0:
            j += 1
        if j < 1 or j >= len(times):
            return None
        lo, hi = xs[j - 1], xs[j]
        if hi < lo_x or lo > hi_x:
            return None
        if lo < lo_x:
            lo = lo_x
            if el(lo) < 0.0:
                return None
        if hi > hi_x:
            hi = hi_x
            if el(hi) >= 0.0:
                return None
        return _bisect(el, lo, hi, rising=False)

    # 1. ช่วงคร่าวๆ จากตัวอย่าง 3. ปรับ AOS/LOS 4. Max El
    for iv in intervals_from_elevations(times, els, 0.0):
        aos_x, los_x = refined_aos(iv.start), refined_los(iv.stop)
        a = aos_x if aos_x is not None else max((iv.start - t0).total_seconds(), lo_x)
        b = los_x if los_x is not None else min((iv.stop - t0).total_seconds(), hi_x)
        if a >= b:
            continue                                             # ไม่มีส่วนที่ interpolate ได้
        x_max, max_el = _golden_max(el, a, b)
        if max_el < 0.0:
            continue                                             # ช่วงใช้ได้ทั้งหมดอยู่ใต้ขอบฟ้า (ขอบเขตเส้นตรงหลวมกว่าของจริง)
        passes.append(Pass(None if aos_x is None else at(aos_x), None if los_x is None else at(los_x),
                           max_el, at(x_max)))

    # 2. pass สั้นระหว่างสองตัวอย่าง: local max ใต้ 0° ที่ตัวอย่างข้างเคียงอยู่ระหว่าง −2° ถึง 0°
    for k in range(1, len(times) - 1):
        if not (els[k] < 0.0 and els[k] > els[k - 1] and els[k] >= els[k + 1]):
            continue
        if not (SHORT_PASS_FLOOR_DEG < els[k - 1] and SHORT_PASS_FLOOR_DEG < els[k + 1]):
            continue
        if xs[k - 1] < lo_x or xs[k + 1] > hi_x:
            continue
        x_max, max_el = _golden_max(el, xs[k - 1], xs[k + 1])
        if max_el <= 0.0:
            continue
        passes.append(Pass(at(_bisect(el, xs[k - 1], x_max, rising=True)),
                           at(_bisect(el, x_max, xs[k + 1], rising=False)), max_el, at(x_max)))

    passes.sort(key=lambda p: p.t_max_el)
    return passes


def next_events(passes: Sequence[Pass], eph: SatEphem, q: QthGeo, t: datetime
                ) -> tuple[datetime | None, datetime | None, str | None]:
    """(next_aos, next_los, always) ที่เวลา t

    next_aos: AOS แรกที่เกิน t; next_los: LOS ของ pass ที่ t อยู่ข้างใน ไม่งั้นของ pass ถัดไป (None ถ้าไม่รู้หรือไม่มี)
    always: ไม่มี pass ไหนรู้ AOS หรือ LOS เลย -> "in" เมื่อ El(t) > 0, "out" เมื่อ El(t) <= 0 (ไม่รู้ El(t) -> None); นอกนั้น None
    """
    upcoming = min((p for p in passes if p.aos is not None and p.aos > t), key=lambda p: p.aos, default=None)
    current = pass_containing(passes, t)
    next_aos = None if upcoming is None else upcoming.aos
    if current is not None:
        next_los = current.los
    else:
        next_los = None if upcoming is None else upcoming.los
    always = None
    if not any(p.aos is not None or p.los is not None for p in passes):
        elevation = elevation_at(eph, q, t)
        if elevation is not None:
            always = "in" if elevation > 0.0 else "out"
    return next_aos, next_los, always
