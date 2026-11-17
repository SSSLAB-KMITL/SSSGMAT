"""Ground track และ sky track (หัวข้อ 7.3 ของ spec) ไม่มี I/O และไม่มี thread

ทั้งสองอย่างอ่านจาก SatEphem เท่านั้น จึงตัดที่ขอบของช่วงที่ interpolate ได้ (passes.usable_span)
"""

from bisect import bisect_left, bisect_right
from collections.abc import Sequence
from datetime import datetime, timedelta

from gnss_predict.geometry import ecef_to_aer, ecef_to_geodetic

from .ephem import SatEphem
from .observe import QthGeo, TleElements, orbit_number, orbit_start
from .passes import Pass, elevation_at, pass_containing, usable_span

SKY_STEP_S = 10.0                     # ระยะห่างของจุดใน sky track
LON_JUMP_DEG = 180.0                  # ลองจิจูดกระโดดเกินนี้ระหว่างจุดติดกัน = ข้ามเส้น ±180°
_MAX_ORBIT_STEPS = 8                  # จำนวนครั้งที่เลื่อนเมื่อเดากลางรอบของ orbit ที่ k + orbits ไม่ตรงครั้งแรก


# ---------------------------------------------------------------- ground track

def _orbit_end(el: TleElements, start: datetime, t: datetime, orbits: int) -> datetime:
    """ต้นรอบของ orbit number (ของ t) + orbits หาด้วยสูตรเดียวกับ orbit_start: เดาเวลากลางรอบนั้นจากต้นรอบปัจจุบัน
    เลื่อนทีละรอบจน orbit number ตรง แล้วขอต้นรอบจาก orbit_start"""
    target = orbit_number(el, t) + orbits
    period = timedelta(days=1.0 / el.mean_motion) if el.mean_motion > 1e-6 else timedelta(days=1)
    guess = start + (orbits + 0.5) * period
    for _ in range(_MAX_ORBIT_STEPS):
        n = orbit_number(el, guess)
        if n == target:
            break
        guess += period * (target - n)
    return orbit_start(el, guess)


def ground_track(eph: SatEphem, el: TleElements, t: datetime, orbits: int) -> list[list[tuple[float, float]]]:
    """ground track (lat, lon องศา) จากต้นรอบปัจจุบันไปข้างหน้า orbits รอบ ตัดที่ช่วงที่ interpolate ได้

    จุดคือตัวอย่างของช่วงบวกจุดปลายสองด้านที่ interpolate; แยกเป็นเส้นใหม่เมื่อลองจิจูดของจุดติดกันต่างกันเกิน 180°
    (ข้ามเส้น ±180°) ไม่เพิ่มจุดที่ขอบ คืน [] เมื่อไม่มีส่วนของวงอยู่ในช่วง
    """
    span = usable_span(eph)
    if span is None or orbits < 1:
        return []
    start = orbit_start(el, t)
    a, b = max(start, span[0]), min(_orbit_end(el, start, t, orbits), span[1])
    if a >= b:
        return []
    first, last = eph.state_at(a), eph.state_at(b)
    if first is None or last is None:
        return []
    times = eph.times
    points = [first[0]]
    points.extend(eph.pos[i] for i in range(bisect_right(times, a), bisect_left(times, b)))
    points.append(last[0])

    lines: list[list[tuple[float, float]]] = []
    prev_lon: float | None = None
    for pos in points:
        lat, lon, _ = ecef_to_geodetic(*pos)
        if prev_lon is None or abs(lon - prev_lon) > LON_JUMP_DEG:
            lines.append([])
        lines[-1].append((lat, lon))
        prev_lon = lon
    return lines


# ---------------------------------------------------------------- sky track

def sky_track(eph: SatEphem, q: QthGeo, passes: Sequence[Pass], t: datetime) -> list[dict] | None:
    """Az/El ทุก 10 วินาทีจาก AOS ถึง LOS ของ pass ที่ t อยู่ข้างใน ([{"t", "az", "el"}]) ปลายทางคือ LOS เสมอ
    (เพิ่มเป็นจุดสุดท้ายเมื่อเศษไม่ลงตัวกับ 10 วินาที) None ถ้า El(t) < 0, t อยู่นอกช่วงที่ interpolate ได้ หรือ t ไม่อยู่ใน pass
    AOS หรือ LOS ที่เป็น None (pass ถูกช่วงตัด) ใช้ขอบของช่วงที่ interpolate ได้แทน"""
    span = usable_span(eph)
    elevation = elevation_at(eph, q, t)
    if span is None or elevation is None or elevation < 0.0:
        return None
    current = pass_containing(passes, t)
    if current is None:
        return None
    start = span[0] if current.aos is None else max(current.aos, span[0])
    end = span[1] if current.los is None else min(current.los, span[1])
    if start > end:
        return None
    count = int((end - start).total_seconds() // SKY_STEP_S) + 1
    times = [start + timedelta(seconds=SKY_STEP_S * k) for k in range(count)]
    if times[-1] < end:
        times.append(end)
    track = []
    for when in times:
        state = eph.state_at(when)
        if state is None:
            continue
        az, el, _ = ecef_to_aer(state[0], q.ecef_km, q.lat_deg, q.lon_deg)
        track.append({"t": when, "az": az, "el": el})
    return track
