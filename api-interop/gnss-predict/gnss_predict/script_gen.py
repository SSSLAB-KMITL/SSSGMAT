"""สร้าง GMAT script สำหรับคำนวณตำแหน่งดาวเทียมในกรอบ Topocentric ของ THBK (หัวข้อ 5.3 ของ spec)"""

from datetime import datetime
from pathlib import Path
from string import Template

from .config import TEMPLATE_PATH, THBK_HEIGHT_M, THBK_LAT_DEG, THBK_LON_DEG
from .gmat_time import format_gmat_epoch
from .tle_fetch import TleEntry

REPORT_NAME = "report.txt"


def sat_name(prn: int) -> str:
    return f"G{prn:02d}"


def _spacecraft_block(name: str, entry: TleEntry, epoch: str, tle_path: Path) -> str:
    return (f"Create Spacecraft {name};\n"
            f"{name}.DateFormat    = UTCGregorian;\n"
            f"{name}.Epoch         = '{epoch}';\n"
            f"{name}.Id            = '{entry.norad}';\n"
            f"{name}.EphemerisName = '{tle_path}';\n"
            "\n")


def render_script(entries: list[TleEntry], tle_path: Path, start: datetime, hours: float,
                  step_s: int, work_dir: Path) -> str:
    """GMAT script ที่ propagate ทุกดวงพร้อมกันและเขียนรายงานลง work_dir/report.txt"""
    if not entries:
        raise ValueError("ไม่มี TLE ให้สร้าง script")
    entries = sorted(entries, key=lambda e: e.prn)
    names = [sat_name(e.prn) for e in entries]
    epoch = format_gmat_epoch(start)
    columns = [f"{names[0]}.UTCGregorian"] + [f"{n}.THBKTopo.{c}" for n in names for c in "XYZ"]
    report_columns = "\n".join([f"    {c}, ..." for c in columns[:-1]] + [f"    {columns[-1]}"])
    return Template(TEMPLATE_PATH.read_text()).substitute(
        spacecraft_blocks="".join(_spacecraft_block(n, e, epoch, tle_path) for n, e in zip(names, entries)),
        lat=f"{THBK_LAT_DEG:.6f}",
        lon=f"{THBK_LON_DEG:.6f}",
        height_km=f"{THBK_HEIGHT_M / 1000:.4f}",
        step_s=str(int(step_s)),
        report_path=str(Path(work_dir) / REPORT_NAME),
        report_columns=report_columns,
        sat_list=", ".join(names),
        first_sat=names[0],
        elapsed_s=str(round(hours * 3600)),
    )
