"""เขียน CZML แบบเก็บเฉพาะข้อมูลสำหรับ Cesium (หัวข้อ 5.9 ของ spec engine)

- `satellites_czml` ให้ packet `document` ตามด้วยดาวละหนึ่ง packet (`sat/<PRN>`)
- `access_czml` ให้ packet ของ facility (`fac/<name>`) และเส้น access (`access/<name>/<PRN>`) ไม่มี packet
  `document` ผู้เรียกต่อผลของสองฟังก์ชันเข้าเป็นไฟล์เดียว เพราะเส้น access อ้างตำแหน่ง `sat/<PRN>#position`
- ตำแหน่งเป็น `cartesian` ในกรอบ FIXED หน่วยเมตร (Ephemeris เก็บกิโลเมตร) เวลาของตัวอย่างเป็นวินาทีจาก `epoch`
- ไม่ใส่สี ความหนา วัสดุ label หรือ path สไตล์มาจาก `scenario.json` ฝั่ง Web
- Cesium ถือว่า `show` ที่ไม่ระบุเป็นจริง จึงระบุ `show` ครอบคลุมทั้งช่วงวิเคราะห์ทั้งส่วนที่เป็นเท็จและจริง
"""

from datetime import datetime, timedelta, timezone
from typing import Protocol

from .config import CZML_LAGRANGE_DEGREE, CZML_STEP_S
from .propagate import Ephemeris
from .scenario import Facility


class _Span(Protocol):
    """ช่วงเวลาใดก็ได้ที่มี start และ stop (analyze.Interval)"""
    @property
    def start(self) -> datetime: ...

    @property
    def stop(self) -> datetime: ...


def _utc(t: datetime) -> datetime:
    if t.tzinfo is None:
        raise ValueError(f"เวลาต้องมี tzinfo ได้ {t!r}")
    return t.astimezone(timezone.utc)


def _iso(t: datetime) -> str:
    """YYYY-MM-DDTHH:MM:SSZ เติมเศษวินาทีเฉพาะเมื่อเวลานั้นมี"""
    t = _utc(t)
    text = t.strftime("%Y-%m-%dT%H:%M:%S")
    if t.microsecond:
        text += f".{t.microsecond:06d}".rstrip("0")
    return text + "Z"


def _interval(a: datetime, b: datetime) -> str:
    return f"{_iso(a)}/{_iso(b)}"


def _sample_indices(times: list[datetime], step_s: int) -> list[int]:
    """index ของจุดที่เก็บ: ทุก step_s วินาทีของตาราง (ปัดเป็นจำนวนจุดเต็ม) และจุดสุดท้ายเสมอ"""
    if isinstance(step_s, bool) or not isinstance(step_s, int) or step_s < 1:
        raise ValueError(f"step_s ต้องเป็นจำนวนเต็มบวก ได้ {step_s!r}")
    if len(times) < 2:
        raise ValueError("Ephemeris ต้องมีอย่างน้อย 2 จุดเวลา")
    grid = times[1] - times[0]
    if grid <= timedelta(0):
        raise ValueError("เวลาของ Ephemeris ต้องเพิ่มขึ้น")
    stride = max(1, timedelta(seconds=step_s) // grid)
    last = len(times) - 1
    indices = list(range(0, last + 1, stride))
    if indices[-1] != last:
        indices.append(last)
    return indices


def _seconds(t: datetime, epoch: datetime) -> int | float:
    s = (t - epoch).total_seconds()
    return int(s) if s.is_integer() else s


def satellites_czml(eph: Ephemeris, step_s: int = CZML_STEP_S) -> list[dict]:
    """packet `document` และ `sat/<PRN>` ของทุกดาวใน eph จุดตัวอย่างทุก step_s และใส่จุดสุดท้ายเสมอ"""
    times = [_utc(t) for t in eph.times_utc]
    indices = _sample_indices(times, step_s)
    epoch = times[0]
    span = _interval(epoch, times[-1])
    sample_times = [_seconds(times[i], epoch) for i in indices]

    packets: list[dict] = [{"id": "document", "version": "1.0",
                            "clock": {"interval": span, "currentTime": _iso(epoch)}}]
    for prn, positions in eph.positions_km.items():
        if len(positions) != len(times):
            raise ValueError(f"{prn}: ตำแหน่ง {len(positions)} จุด ไม่ตรงกับเวลา {len(times)} จุด")
        cartesian: list[float] = []
        for sample_t, i in zip(sample_times, indices):
            x, y, z = positions[i]
            cartesian += [sample_t, x * 1000.0, y * 1000.0, z * 1000.0]
        packets.append({
            "id": f"sat/{prn}",
            "availability": span,
            "position": {
                "epoch": _iso(epoch),
                "cartesian": cartesian,
                "referenceFrame": "FIXED",
                "interpolationAlgorithm": "LAGRANGE",
                "interpolationDegree": CZML_LAGRANGE_DEGREE,
            },
        })
    return packets


def _merged_access(intervals: list[_Span], start: datetime, stop: datetime) -> list[tuple[datetime, datetime]]:
    """ช่วง access ที่ตัดด้วยช่วงวิเคราะห์ เรียงตามเวลา รวมช่วงที่ซ้อนหรือต่อกัน และทิ้งช่วงยาว 0"""
    clipped = sorted((max(_utc(iv.start), start), min(_utc(iv.stop), stop)) for iv in intervals)
    merged: list[tuple[datetime, datetime]] = []
    for a, b in clipped:
        if b <= a:
            continue
        if merged and a <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], b))
        else:
            merged.append((a, b))
    return merged


def _show_intervals(merged: list[tuple[datetime, datetime]], start: datetime, stop: datetime) -> list[dict]:
    """show ที่เป็นเท็จนอก access และจริงใน access ต่อเนื่องครอบคลุม start ถึง stop"""
    show: list[dict] = []
    cursor = start
    for a, b in merged:
        if a > cursor:
            show.append({"interval": _interval(cursor, a), "boolean": False})
        show.append({"interval": _interval(a, b), "boolean": True})
        cursor = b
    if cursor < stop:
        show.append({"interval": _interval(cursor, stop), "boolean": False})
    return show


def access_czml(facility: Facility, intervals: dict[str, list[_Span]],
                period: tuple[datetime, datetime]) -> list[dict]:
    """packet ของ facility และเส้น access ของดาวที่มี access ในช่วงวิเคราะห์ (ดาวที่ไม่มี access ไม่มีเส้น)"""
    start, stop = _utc(period[0]), _utc(period[1])
    if stop <= start:
        raise ValueError("ช่วงวิเคราะห์ต้องมี stop หลัง start")
    packets: list[dict] = [{
        "id": f"fac/{facility.name}",
        "position": {"cartographicDegrees": [facility.lon_deg, facility.lat_deg, facility.alt_m]},
    }]
    for prn, ivs in intervals.items():
        merged = _merged_access(ivs, start, stop)
        if not merged:
            continue
        packets.append({
            "id": f"access/{facility.name}/{prn}",
            "polyline": {
                "positions": {"references": [f"fac/{facility.name}#position", f"sat/{prn}#position"]},
                "show": _show_intervals(merged, start, stop),
            },
        })
    return packets
