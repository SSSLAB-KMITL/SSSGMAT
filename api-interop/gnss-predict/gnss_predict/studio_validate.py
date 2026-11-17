"""ตรวจความแม่นยำของ predicted.sp3 หลายระบบเทียบกับ SP3 MGEX และ broadcast (หัวข้อ 5.14 ของ spec engine)

- เทียบทุก epoch ของ predicted.sp3 ที่วันที่ UTC ตรงกับ `day` (เวลาในไฟล์เป็น GPST = UTC + GPS_UTC_OFFSET_S)
  ค่าจริง ณ เวลานั้นมาจาก Lagrange 10 จุดของ SP3 จริง เพราะ grid ของเราไม่ตรง grid ของ SP3 จริง
- ดาวที่ไม่มีใน SP3 จริง: G/E/C ใช้ตำแหน่งจาก broadcast (`truth` = "brdc") R หรือไม่มีใน broadcast ด้วยคือ "unverified"
- คู่ที่นับคือคู่ที่ El อ้างอิง ≥ VALIDATION_MIN_EL ส่วน Az นับเฉพาะ El อ้างอิง < AZ_EL_LIMIT
- สถิติระดับระบบรวมคู่ของดาวที่ `truth` = "sp3" และอายุข้อมูล ≤ AGE_OK_DAYS เท่านั้น (รวมคู่ของดาวที่คู่ไม่ถึงเกณฑ์รายดวงด้วย)
  สถิติรายดวงมีทุกดวงและทุกแหล่งค่าจริง
- ผลรายดวง: คู่ ≥ VALIDATION_MIN_SAT_PAIRS ตัดสินด้วยเกณฑ์ 4 ข้อเดียวกับระดับระบบ น้อยกว่านั้นคือ insufficient_data
  และ unverified เมื่อไม่มีค่าจริงเลย ค่าสถิติที่คำนวณไม่ได้ (คู่น้อยกว่า 2) นับว่าไม่ผ่านข้อนั้นเหมือน validate.summarize เดิม
- `pass` ของทั้งก้อนคือทุกระบบที่มีสถิติผ่าน และต้องมีอย่างน้อยหนึ่งระบบ (ไม่มีระบบใดตรวจได้ไม่ถือว่าผ่าน)
- ดาวถ่ายภาพ (ระบบ X) ไม่มีข้อมูลอ้างอิง จึงข้ามทั้งดวง (ไม่มีแถว unverified) ผลเหมือนไม่มีดาวนั้นใน predicted.sp3
"""

from bisect import bisect_left
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from math import dist
from pathlib import Path

from .brdc import Nav, position_km
from .config import (AGE_OK_DAYS, AZ_EL_LIMIT, AZ_MEDIAN_MAX, AZ_P99_MAX, EL_MEDIAN_MAX, EL_P99_MAX, GNSS_GROUPS,
                     GPS_UTC_OFFSET_S, VALIDATION_MIN_EL, VALIDATION_MIN_SAT_PAIRS)
from .geometry import ecef_to_aer, geodetic_to_ecef
from .imaging import IMAGING_LETTER
from .scenario import Facility
from .sp3 import Position, SatSeries, lagrange_at, read_sp3_all
from .validate import _median, _p99, az_diff     # ตัวเดียวกับ validate.py เดิม เพื่อให้ค่ากลางและ P99 คิดแบบเดียวกัน

SYSTEM_NAMES = {"G": "GPS", "R": "GLONASS", "E": "Galileo", "C": "BeiDou"}
BRDC_SYSTEMS = "GEC"                         # ระบบที่ brdc.position_km คำนวณได้
LIMITS = {"el_median": EL_MEDIAN_MAX, "el_p99": EL_P99_MAX, "az_median": AZ_MEDIAN_MAX, "az_p99": AZ_P99_MAX}
ANGLE_DECIMALS = 6
DISTANCE_DECIMALS = 4                        # กม. (0.1 ม.)

_OFFSET = timedelta(seconds=GPS_UTC_OFFSET_S)
_HALF_WINDOW = 5                             # Lagrange 10 จุด เท่ากับค่าเริ่มต้นของ sp3.lagrange_at
_NEARBY = _HALF_WINDOW + 1                   # จำนวนจุดข้างละด้านที่ส่งให้ lagrange_at (ต้อง ≥ _HALF_WINDOW)


class _TruthTrack:
    """ตำแหน่งจริงของดาวหนึ่งดวงจากอนุกรม SP3

    ผลเท่ากับ lagrange_at(series, t) ทุกประการ แต่ส่งเฉพาะจุดใกล้ t เพราะ lagrange_at เรียงเวลาทั้งอนุกรมทุกครั้งที่เรียก
    """

    def __init__(self, series: SatSeries):
        self.series = series
        self.times = sorted(series)

    def at(self, t_gpst: datetime) -> Position | None:
        i = bisect_left(self.times, t_gpst)
        nearby = {k: self.series[k] for k in self.times[max(0, i - _NEARBY):i + _NEARBY]}
        return lagrange_at(nearby, t_gpst, _HALF_WINDOW)


@dataclass
class _Deltas:
    el: list[float] = field(default_factory=list)       # |ΔEl| ของทุกคู่ (องศา)
    az: list[float] = field(default_factory=list)       # |ΔAz| ของคู่ที่ El อ้างอิง < AZ_EL_LIMIT
    d3_km: list[float] = field(default_factory=list)    # ระยะคลาด 3 มิติของทุกคู่

    def extend(self, other: "_Deltas") -> None:
        self.el += other.el
        self.az += other.az
        self.d3_km += other.d3_km


def _stats(d: _Deltas) -> dict[str, float | None]:
    return {"el_median": _median(d.el), "el_p99": _p99(d.el), "az_median": _median(d.az), "az_p99": _p99(d.az)}


def within_limits(stats: dict[str, float | None]) -> bool:
    """ทั้ง 4 ข้อต้องไม่เกินเกณฑ์ (ค่าที่เท่าเกณฑ์พอดีผ่าน) ค่า None คือคำนวณไม่ได้ จึงนับว่าไม่ผ่าน"""
    return all(stats[key] is not None and stats[key] <= limit for key, limit in LIMITS.items())


def _round(value: float | None, decimals: int) -> float | None:
    return None if value is None else round(value, decimals) + 0.0      # + 0.0 เปลี่ยน -0.0 เป็น 0.0


def _rounded_stats(stats: dict[str, float | None]) -> dict[str, float | None]:
    return {key: _round(value, ANGLE_DECIMALS) for key, value in stats.items()}


def _truth_source(prn: str, truth: dict[str, SatSeries], nav: Nav | None):
    """(แหล่งค่าจริง, ฟังก์ชันเวลา GPST -> ตำแหน่ง) ดาวที่มีใน SP3 ใช้ SP3 ทุก epoch ไม่สลับไปใช้ broadcast"""
    if prn in truth:
        return "sp3", _TruthTrack(truth[prn]).at
    if nav is not None and prn[:1] in BRDC_SYSTEMS and prn in nav.records:
        return "brdc", lambda t_gpst: position_km(nav, prn, t_gpst)
    return "unverified", None


def _compare(series: SatSeries, truth_at, day: date, fac: Facility, sta_km: Position) -> _Deltas:
    out = _Deltas()
    for t_gpst in sorted(series):
        if (t_gpst - _OFFSET).date() != day:          # วันที่ UTC ของ epoch ไม่ใช่วันที่ GPST
            continue
        ref = truth_at(t_gpst)
        if ref is None:
            continue
        az_ref, el_ref, _ = ecef_to_aer(ref, sta_km, fac.lat_deg, fac.lon_deg)
        if el_ref < VALIDATION_MIN_EL:
            continue
        pred = series[t_gpst]
        az, el, _ = ecef_to_aer(pred, sta_km, fac.lat_deg, fac.lon_deg)
        out.el.append(abs(el - el_ref))
        if el_ref < AZ_EL_LIMIT:
            out.az.append(abs(az_diff(az, az_ref)))
        out.d3_km.append(dist(pred, ref))
    return out


def validate_ephemeris(pred_sp3: Path, truth_sp3: Path, nav: Nav | None, fac: Facility,
                       flags: dict[str, frozenset[str]], ages: dict[str, float], day: date) -> dict:
    """เทียบ Az/El ที่ Facility ของ predicted.sp3 กับค่าจริง คืน dict ที่ json.dumps ได้ตรง ๆ

    {"day", "truth_file", "systems": {ระบบ: {"sats", "pairs", "az_pairs", "el_median", "el_p99", "az_median",
    "az_p99", "pass"}}, "satellites": {PRN: {"truth", "pairs", "az_pairs", "el_median", "el_p99", "az_median",
    "az_p99", "d3_median_km", "d3_max_km", "age_days", "flags", "result"}}, "failing": [PRN], "pass": bool}

    flags และ ages (PRN -> ธง, อายุข้อมูลเป็นวัน) มาจาก manifest ของ ephem ดาวที่ไม่มีใน ages (อายุไม่ทราบ)
    ไม่นับในระดับระบบ failing คือดาวที่ result = "fail" ทุกดวง (รวมดาวที่อายุเกินหรือค่าจริงมาจาก broadcast)
    """
    pred = read_sp3_all(pred_sp3)
    truth = read_sp3_all(truth_sp3)
    sta_km = geodetic_to_ecef(fac.lat_deg, fac.lon_deg, fac.alt_m)
    satellites: dict[str, dict] = {}
    pooled: dict[str, tuple[int, _Deltas]] = {}
    for prn in sorted(pred):
        if prn[:1] == IMAGING_LETTER:                 # ดาวถ่ายภาพ: ไม่มีค่าอ้างอิง ข้ามทั้งดวง
            continue
        source, truth_at = _truth_source(prn, truth, nav)
        d = _compare(pred[prn], truth_at, day, fac, sta_km) if truth_at is not None else _Deltas()
        stats, pairs, age = _stats(d), len(d.el), ages.get(prn)
        if source == "unverified":
            result = "unverified"
        elif pairs < VALIDATION_MIN_SAT_PAIRS:
            result = "insufficient_data"
        else:
            result = "pass" if within_limits(stats) else "fail"
        if source == "sp3" and pairs and age is not None and age <= AGE_OK_DAYS:
            sats, total = pooled.get(prn[:1], (0, _Deltas()))
            total.extend(d)
            pooled[prn[:1]] = (sats + 1, total)
        satellites[prn] = {
            "truth": source, "pairs": pairs, "az_pairs": len(d.az), **_rounded_stats(stats),
            "d3_median_km": _round(_median(d.d3_km), DISTANCE_DECIMALS),
            "d3_max_km": _round(max(d.d3_km), DISTANCE_DECIMALS) if d.d3_km else None,
            "age_days": age, "flags": sorted(flags.get(prn, ())), "result": result,
        }

    systems: dict[str, dict] = {}
    for letter in [s for s in GNSS_GROUPS if s in pooled] + sorted(set(pooled) - set(GNSS_GROUPS)):
        sats, total = pooled[letter]
        stats = _stats(total)
        systems[letter] = {"sats": sats, "pairs": len(total.el), "az_pairs": len(total.az),
                           **_rounded_stats(stats), "pass": within_limits(stats)}
    return {
        "day": day.isoformat(),
        "truth_file": Path(truth_sp3).name,
        "systems": systems,
        "satellites": satellites,
        "failing": [prn for prn, sat in satellites.items() if sat["result"] == "fail"],
        "pass": bool(systems) and all(s["pass"] for s in systems.values()),
    }


def imaging_skipped_text(n: int) -> str:
    """ข้อความเดียวกันทั้งใน Message IMAGING_SKIPPED และบรรทัดในรายงาน markdown"""
    return f"ข้ามดาวถ่ายภาพ {n} ดวง (ไม่มีข้อมูลอ้างอิง)"


# ---------- รายงาน markdown ----------

_RESULT_TH = {"pass": "ผ่าน", "fail": "ไม่ผ่าน", "insufficient_data": "ข้อมูลไม่พอ", "unverified": "ตรวจไม่ได้"}
_TRUTH_TH = {"sp3": "SP3", "brdc": "broadcast", "unverified": "ไม่มี"}
_CHECK_TH = {"el_median": "ค่ากลาง \\|ΔEl\\|", "el_p99": "P99 \\|ΔEl\\|",
             "az_median": "ค่ากลาง \\|ΔAz\\|", "az_p99": "P99 \\|ΔAz\\|"}
_STAT_HEADER = "| ค่ากลาง \\|ΔEl\\| (°) | P99 \\|ΔEl\\| (°) | ค่ากลาง \\|ΔAz\\| (°) | P99 \\|ΔAz\\| (°) |"


def _num(value: float | None, digits: int = 4) -> str:
    return "-" if value is None else f"{value:.{digits}f}"


def _system_label(letter: str) -> str:
    return f"{SYSTEM_NAMES.get(letter, letter)} ({letter})"


def _exceeded(sat: dict) -> list[str]:
    """ข้อที่เกินเกณฑ์พร้อมค่า (ค่าที่คำนวณไม่ได้ก็นับ)"""
    return [f"{_CHECK_TH[key]} {_num(sat[key])}° (เกณฑ์ ≤ {limit})" if sat[key] is not None
            else f"{_CHECK_TH[key]} คำนวณไม่ได้ (เกณฑ์ ≤ {limit})"
            for key, limit in LIMITS.items() if sat[key] is None or sat[key] > limit]


def validation_markdown(result: dict, *, scenario: str, ephem_hash: str, facility: str,
                        skipped_imaging: int = 0) -> str:
    """รายงานภาษาไทยของผล validate_ephemeris: ตารางต่อระบบ ดาวที่ไม่ผ่านพร้อมค่าคลาด และตารางทุกดวง
    skipped_imaging > 0: เพิ่มบรรทัดจำนวนดาวถ่ายภาพที่ข้าม (0 ได้รายงานเหมือนเดิมทุกไบต์)"""
    systems, sats = result["systems"], result["satellites"]
    verdict = "ผ่าน" if result["pass"] else "ไม่ผ่าน"
    lines = [f"# ผลตรวจความแม่นยำ {result['day']}", "", f"ผล: **{verdict}**", ""]
    if not systems:
        lines += [f"ไม่มีระบบใดมีคู่ที่ค่าจริงมาจาก SP3 และอายุข้อมูลไม่เกิน {AGE_OK_DAYS:g} วัน จึงตัดสินไม่ได้", ""]
    lines += [f"- Scenario: `{scenario}` (ephem `{ephem_hash}`)", f"- Facility: {facility}",
              f"- SP3 จริง: `{result['truth_file']}`",
              f"- เทียบเฉพาะคู่ที่ El อ้างอิง ≥ {VALIDATION_MIN_EL:g}° (Az เฉพาะ El < {AZ_EL_LIMIT:g}°)",
              f"- สถิติระดับระบบนับเฉพาะดาวที่ค่าจริงมาจาก SP3 และอายุข้อมูลไม่เกิน {AGE_OK_DAYS:g} วัน",
              f"- ดาวที่มีคู่น้อยกว่า {VALIDATION_MIN_SAT_PAIRS} คู่ไม่ตัดสิน ดาวที่ไม่มีใน SP3 ใช้ broadcast "
              "(GPS, Galileo, BeiDou) ส่วน GLONASS ที่ไม่มีใน SP3 ตรวจไม่ได้"]
    if skipped_imaging > 0:
        lines.append(f"- {imaging_skipped_text(skipped_imaging)}")
    lines += ["", "## ระดับระบบ", "",
              "| ระบบ | ดาว | คู่ El | คู่ Az " + _STAT_HEADER + " ผล |", "|---|---|---|---|---|---|---|---|---|",
              "| เกณฑ์ | | | | " + " | ".join(f"≤ {limit}" for limit in LIMITS.values()) + " | |"]
    for letter, s in systems.items():
        lines.append(f"| {_system_label(letter)} | {s['sats']} | {s['pairs']} | {s['az_pairs']} | "
                     f"{_num(s['el_median'])} | {_num(s['el_p99'])} | {_num(s['az_median'])} | {_num(s['az_p99'])} | "
                     f"{_RESULT_TH['pass' if s['pass'] else 'fail']} |")
    missing = [letter for letter in dict.fromkeys(prn[:1] for prn in sats) if letter not in systems]
    if missing:
        lines += ["", "ระบบที่ไม่มีสถิติระดับระบบ (ไม่มีดาวที่ค่าจริงมาจาก SP3 อายุข้อมูลไม่เกิน "
                  f"{AGE_OK_DAYS:g} วัน และมีคู่): " + ", ".join(_system_label(letter) for letter in missing)]

    lines += ["", "## ดาวที่ไม่ผ่าน", ""]
    if result["failing"]:
        lines += ["| PRN | ค่าจริง | อายุข้อมูล (วัน) | คู่ | ค่าที่เกินเกณฑ์ | ระยะคลาด 3 มิติ ค่ากลาง / สูงสุด (กม.) | ธง |",
                  "|---|---|---|---|---|---|---|"]
        for prn in result["failing"]:
            s = sats[prn]
            lines.append(f"| {prn} | {_TRUTH_TH[s['truth']]} | {_num(s['age_days'], 2)} | {s['pairs']} | "
                         f"{'; '.join(_exceeded(s))} | {_num(s['d3_median_km'], 3)} / {_num(s['d3_max_km'], 3)} | "
                         f"{', '.join(s['flags']) or '-'} |")
    else:
        lines.append("ไม่มี")

    lines += ["", "## ทุกดวง", "",
              "| PRN | ค่าจริง | อายุข้อมูล (วัน) | คู่ El | คู่ Az " + _STAT_HEADER
              + " ระยะคลาด 3 มิติ ค่ากลาง / สูงสุด (กม.) | ผล |",
              "|---|---|---|---|---|---|---|---|---|---|---|"]
    for prn, s in sats.items():
        lines.append(f"| {prn} | {_TRUTH_TH[s['truth']]} | {_num(s['age_days'], 2)} | {s['pairs']} | {s['az_pairs']} | "
                     f"{_num(s['el_median'])} | {_num(s['el_p99'])} | {_num(s['az_median'])} | {_num(s['az_p99'])} | "
                     f"{_num(s['d3_median_km'], 3)} / {_num(s['d3_max_km'], 3)} | {_RESULT_TH[s['result']]} |")
    return "\n".join(lines) + "\n"
