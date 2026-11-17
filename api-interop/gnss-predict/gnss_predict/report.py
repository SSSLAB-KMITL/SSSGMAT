"""อ่านรายงานของ GMAT เป็นตำแหน่งในกรอบ SEZ และตรวจว่า epoch ครบ (หัวข้อ 5.5 ของ spec)"""

import csv
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path

from .errors import ReportError
from .gmat_time import parse_gmat_epoch
from .script_gen import REPORT_NAME, sat_name


@dataclass(frozen=True)
class SezSample:
    t: datetime
    prn: int
    s_km: float
    e_km: float
    z_km: float


def _round_to_second(t: datetime) -> datetime:
    # GMAT อาจเขียนเวลาคลาดเล็กน้อย เช่น 00:00:29.999 แทน 00:00:30.000
    return (t + timedelta(microseconds=500_000)).replace(microsecond=0)


def read_report(work_dir: Path, prns: list[int]) -> list[SezSample]:
    path = Path(work_dir) / REPORT_NAME
    if not path.is_file():
        raise ReportError(f"ไม่พบไฟล์รายงานของ GMAT: {path}")
    with open(path, newline="") as f:
        rows = [r for r in csv.reader(f) if any(c.strip() for c in r)]
    if not rows:
        raise ReportError(f"ไฟล์รายงานว่าง: {path}")
    col = {h.strip(): i for i, h in enumerate(rows[0])}
    time_col = next((h for h in col if h.endswith(".UTCGregorian")), None)
    wanted = {p: [f"{sat_name(p)}.THBKTopo.{c}" for c in "XYZ"] for p in prns}
    missing = [h for hs in wanted.values() for h in hs if h not in col]
    if time_col is None or missing:
        raise ReportError(f"รายงานไม่มีคอลัมน์ที่ต้องใช้: {missing or ['*.UTCGregorian']}")
    samples: list[SezSample] = []
    seen: set[tuple[int, datetime]] = set()
    for lineno, row in enumerate(rows[1:], start=2):
        try:
            t = _round_to_second(parse_gmat_epoch(row[col[time_col]].strip()))
            values = {p: [float(row[col[h]]) for h in hs] for p, hs in wanted.items()}
        except (ValueError, IndexError) as exc:
            raise ReportError(f"{path.name} บรรทัด {lineno} อ่านไม่ได้: {exc}") from exc
        for p in prns:
            if (p, t) in seen:
                continue
            seen.add((p, t))
            samples.append(SezSample(t, p, *values[p]))
    return samples


def check_epochs(samples: list[SezSample], start: datetime, hours: float, step_s: int) -> None:
    """ทุกดวงต้องมี epoch ตั้งแต่ start ถึง start + hours ทุก step_s วินาที ไม่ขาดและไม่เกิน"""
    if not samples:
        raise ReportError("รายงานไม่มีข้อมูล")
    n = round(hours * 3600 / step_s)
    expected = {start + timedelta(seconds=i * step_s) for i in range(n + 1)}
    by_prn: dict[int, set[datetime]] = defaultdict(set)
    for s in samples:
        by_prn[s.prn].add(s.t)
    for prn in sorted(by_prn):
        absent = sorted(expected - by_prn[prn])
        if absent:
            raise ReportError(f"{sat_name(prn)}: ไม่มี epoch {absent[0].isoformat()} (ขาด {len(absent)} epoch)")
        extra = sorted(by_prn[prn] - expected)
        if extra:
            raise ReportError(f"{sat_name(prn)}: มี epoch เกินมา {extra[0].isoformat()} ({len(extra)} epoch)")
