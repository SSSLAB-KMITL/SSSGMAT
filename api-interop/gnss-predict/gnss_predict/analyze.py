"""AER, IPP/MF, ช่วง access และสถิติรวมของแต่ละ Facility (หัวข้อ 5.10, 7.2 และ 7.3 ของ spec engine)

- ตำแหน่ง Facility คือ WGS84 ตามหัวข้อ 7.1 (`geometry.geodetic_to_ecef`)
- ช่วง access ใช้มุมเงยของทุกจุดเวลา: จุดอยู่ในช่วงเมื่อ El ≥ min_el
  ขอบช่วงที่อยู่ระหว่างสองจุดหาด้วยการประมาณเชิงเส้น แล้วปัดเป็นมิลลิวินาที
  ช่วงที่เริ่มก่อนหรือจบหลังช่วงวิเคราะห์ถูกตัดที่เวลาจุดแรกและจุดสุดท้าย
  ช่วงยาว 0 วินาที (จุดเดียวแตะเกณฑ์) ถูกตัดทิ้ง (D7)
"""

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from .geometry import ecef_to_aer, ecef_to_az_el, geodetic_to_ecef, ipp, mapping_factor
from .imaging import IMAGING_LETTER
from .propagate import Ephemeris
from .scenario import Facility


@dataclass(frozen=True)
class AerRow:
    time_utc: datetime
    prn: str
    az_deg: float
    el_deg: float
    range_km: float
    ipp_lat_deg: float | None              # None สำหรับดาวถ่ายภาพ (ระบบ X) ซึ่งไม่ใช่สัญญาณ GNSS จึงไม่มี IPP/MF
    ipp_lon_deg: float | None
    mf: float | None


@dataclass(frozen=True)
class Interval:
    start: datetime
    stop: datetime
    max_el_deg: float


def aer_rows(eph: Ephemeris, fac: Facility, shell_km: float) -> list[AerRow]:
    """ทุกแถวที่ El ≥ 0 เรียงตามเวลาแล้ว PRN ดาวถ่ายภาพ (ระบบ X) มี Az/El/ระยะ แต่ IPP และ MF เป็น None"""
    sta = geodetic_to_ecef(fac.lat_deg, fac.lon_deg, fac.alt_m)
    prns = sorted(eph.positions_km)
    rows: list[AerRow] = []
    for i, time_utc in enumerate(eph.times_utc):
        for prn in prns:
            az, el, rng = ecef_to_aer(eph.positions_km[prn][i], sta, fac.lat_deg, fac.lon_deg)
            if el < 0.0:
                continue
            if prn[:1] == IMAGING_LETTER:
                rows.append(AerRow(time_utc, prn, az, el, rng, None, None, None))
                continue
            lat, lon = ipp(fac.lat_deg, fac.lon_deg, az, el, shell_km=shell_km)
            rows.append(AerRow(time_utc, prn, az, el, rng, lat, lon, mapping_factor(el, shell_km=shell_km)))
    return rows


def _to_millisecond(t: datetime) -> datetime:
    return t.replace(microsecond=0) + timedelta(milliseconds=round(t.microsecond / 1000))


def _crossing(t0: datetime, t1: datetime, el0: float, el1: float, min_el: float) -> datetime:
    """จุดที่มุมเงยเท่ากับ min_el ระหว่างจุด t0 และ t1 (el0 กับ el1 อยู่คนละฝั่งของเกณฑ์ จึง el1 ≠ el0)"""
    fraction = (min_el - el0) / (el1 - el0)
    return _to_millisecond(t0 + timedelta(seconds=fraction * (t1 - t0).total_seconds()))


def intervals_from_elevations(times: list[datetime], els: list[float], min_el: float) -> list[Interval]:
    if len(times) != len(els):
        raise ValueError(f"จำนวนเวลา ({len(times)}) ไม่เท่ากับจำนวนมุมเงย ({len(els)})")
    intervals: list[Interval] = []
    start: datetime | None = None
    peak = 0.0

    def close(stop: datetime) -> None:
        if stop > start:                                   # D7: ช่วงยาว 0 ถูกตัดทิ้ง
            intervals.append(Interval(start, stop, peak))

    for i, el in enumerate(els):
        if el >= min_el:
            if start is None:
                start = times[0] if i == 0 else _crossing(times[i - 1], times[i], els[i - 1], el, min_el)
                peak = el
            else:
                peak = max(peak, el)
        elif start is not None:
            close(_crossing(times[i - 1], times[i], els[i - 1], el, min_el))
            start = None
    if start is not None:
        close(times[-1])
    return intervals


def access_intervals(eph: Ephemeris, fac: Facility) -> dict[str, list[Interval]]:
    """ทุก PRN ใน eph เป็น key แม้ไม่มีช่วง"""
    sta = geodetic_to_ecef(fac.lat_deg, fac.lon_deg, fac.alt_m)
    result: dict[str, list[Interval]] = {}
    for prn in sorted(eph.positions_km):
        els = [ecef_to_az_el(pos, sta, fac.lat_deg, fac.lon_deg)[1] for pos in eph.positions_km[prn]]
        result[prn] = intervals_from_elevations(eph.times_utc, els, fac.min_el_deg)
    return result


def global_statistics(intervals: dict[str, list[Interval]]) -> dict:
    """จำนวนและระยะเวลา (วินาที) ของทุกช่วงของทุกดาวรวมกัน ไม่มีช่วงเลย: ค่า min, max, mean เป็น None"""
    durations = [(iv.stop - iv.start).total_seconds() for ivs in intervals.values() for iv in ivs]
    total = float(sum(durations))
    return {
        "count": len(durations),
        "total_duration_s": total,
        "min_duration_s": min(durations) if durations else None,
        "max_duration_s": max(durations) if durations else None,
        "mean_duration_s": total / len(durations) if durations else None,
    }


def legacy_rows(rows: list[AerRow], min_el: float = 0.0) -> list[list[str]]:
    """แถว CSV แบบเดิม (DAY, Time, PRN, Az, El, IPP_Lat, IPP_Lon, MF) เฉพาะ GPS จัดรูปแบบเหมือน predict.rows_from_samples"""
    out = []
    for r in rows:
        if not r.prn.startswith("G") or r.el_deg < min_el:
            continue
        t = r.time_utc.astimezone(timezone.utc)
        az_out = round(r.az_deg, 3) % 360.0               # 359.9997 ปัดแล้วได้ 360.000 ต้องวนกลับเป็น 0.000
        out.append([f"{t:%Y-%m-%d}", f"{t:%H:%M:%S}", r.prn, f"{az_out:.3f}", f"{r.el_deg:.3f}",
                    f"{r.ipp_lat_deg:.4f}", f"{r.ipp_lon_deg:.4f}", f"{r.mf:.5f}"])
    out.sort(key=lambda r: (r[0], r[1], r[2]))
    return out
