"""fixture ที่ test ฝั่งรายงานและกราฟใช้ร่วมกัน (ไม่ใช้ GMAT ไม่ใช้เน็ต)

- `circular_ecef_km`: วงโคจรวงกลมใน ECEF สูตรเดียวกับ `_fake_ecef_km` ใน server/conftest.py
- `fake_propagate`: แทน `gnss_predict.studio.propagate` (GMAT) โดยวางดาวทุกดวงบนวงโคจรวงกลมของระบบตัวเอง
- `build_computed_scenario`: สร้าง scenario `Test_Scen` แล้ว run_propagate + run_analyze("THBK") ให้พร้อมอ่านผล

ไฟล์นี้ไม่ขึ้นกับ test ไฟล์อื่น (import ผ่าน `from tests.report_fixture import ...` จากโฟลเดอร์ gnss-predict)
"""

import json
import math
import shutil
from collections.abc import Callable
from datetime import datetime, timedelta
from pathlib import Path
from unittest import mock

from gnss_predict import studio
from gnss_predict.config import THBK_HEIGHT_M, THBK_LAT_DEG, THBK_LON_DEG
from gnss_predict.propagate import Ephemeris

SNAPSHOT_SRC = Path(__file__).parent / "fixtures" / "studio" / "snapshot"
SNAPSHOT_NAME = "20261110T0000Z"
SCENARIO_NAME = "Test_Scen"
# ดาวใน scenario: (ชื่อ, NORAD) ทั้งห้าดวงมีใน snapshot fixture และไม่ถูกซ่อน (ต้อง propagate ให้ครบทั้งห้า)
SATELLITES = [("G01", 62339), ("G22", 26407), ("E11", 37846), ("R05", 43508), ("C01", 56564)]

EARTH_MU_KM3_S2 = 398600.4418
EARTH_ROTATION_RAD_S = 7.2921151467e-5
# ระบบ -> (รัศมีวงโคจร กม., ความเอียง องศา) ของวงโคจรวงกลมที่ใกล้ของจริงที่สุดในแต่ละกลุ่ม
GNSS_ORBITS = {"G": (26560.0, 55.0), "R": (25508.0, 64.8), "E": (29600.0, 56.0), "C": (27906.0, 55.0)}

Ecef = tuple[float, float, float]


def circular_ecef_km(system: str, slot: int, slots: int, t_s: float) -> Ecef:
    """ตำแหน่ง ECEF (กม.) ที่ t_s วินาทีหลังต้นช่วง ของดาวช่องที่ slot จาก slots ดวงในระบบเดียวกัน (วงกลม กระจายสามระนาบ)"""
    radius, inclination = GNSS_ORBITS[system]
    inc = math.radians(inclination)
    rate = math.sqrt(EARTH_MU_KM3_S2 / radius ** 3)
    u = 2 * math.pi * slot / slots + rate * t_s                    # argument of latitude
    raan = 2 * math.pi * (slot % 3) / 3
    x = radius * (math.cos(raan) * math.cos(u) - math.sin(raan) * math.sin(u) * math.cos(inc))
    y = radius * (math.sin(raan) * math.cos(u) + math.cos(raan) * math.sin(u) * math.cos(inc))
    z = radius * math.sin(u) * math.sin(inc)
    theta = EARTH_ROTATION_RAD_S * t_s                               # หมุนจากกรอบเฉื่อยเป็น EarthFixed
    return (x * math.cos(theta) + y * math.sin(theta), -x * math.sin(theta) + y * math.cos(theta), z)


def slot_table(sats) -> dict[str, tuple[str, int, int]]:
    """PRN -> (ระบบ, ช่องที่ slot, จำนวนดวงในระบบ slots) เรียงตาม PRN ในแต่ละระบบ (กฎเดียวกับที่ fake_propagate ใช้)"""
    by_system: dict[str, list[str]] = {}
    for sat in sorted(sats, key=lambda s: s.prn):
        by_system.setdefault(sat.system, []).append(sat.prn)
    return {prn: (system, slot, len(prns)) for system, prns in by_system.items() for slot, prn in enumerate(prns)}


def _propagate(sats, start: datetime, stop: datetime, step_s: int,
               ecef: Callable[[str, float], Ecef] | None) -> tuple[Ephemeris, list]:
    n = int((stop - start).total_seconds()) // step_s
    times = [start + timedelta(seconds=k * step_s) for k in range(n + 1)]
    table = slot_table(sats)
    if ecef is None:
        def ecef(prn: str, t_s: float) -> Ecef:
            system, slot, slots = table[prn]
            return circular_ecef_km(system, slot, slots, t_s)
    positions = {prn: [ecef(prn, k * step_s) for k in range(n + 1)] for prn in table}
    return Ephemeris(times, positions), []


def fake_propagate(sats, start, stop, step_s, work_dir, console, timeout_s=900, **_):
    """แทน gnss_predict.studio.propagate (GMAT): วางดาวทุกดวงบนวงโคจรวงกลมของระบบตัวเอง ไม่รัน GMAT ไม่ใช้เน็ต"""
    return _propagate(sats, start, stop, step_s, None)


def scenario_doc(start: str, stop: str, step_s: int) -> dict:
    return {
        "format": "gnss-studio-scenario/1",
        "name": SCENARIO_NAME,
        "analysis_period": {"start": start, "stop": stop},
        "step_s": step_s,
        "orbit_snapshot": SNAPSHOT_NAME,
        "ionosphere": {"shell_km": 400.0},
        "satellite_filter": {"show_too_old": False, "show_no_broadcast": True},
        "objects": [{"class": "Facility", "name": "THBK",
                     "position": {"type": "Geodetic", "lat_deg": THBK_LAT_DEG, "lon_deg": THBK_LON_DEG,
                                  "alt_m": THBK_HEIGHT_M},
                     "constraints": {"elevation_angle_min_deg": 10.0}}]
                   + [{"class": "Satellite", "name": name, "norad": norad} for name, norad in SATELLITES],
    }


def build_computed_scenario(root: Path, *, start: str = "2026-11-10T00:00:00Z", stop: str = "2026-11-10T06:00:00Z",
                            step_s: int = 60,
                            ecef: Callable[[str, float], Ecef] | None = None) -> tuple[Path, Path]:
    """สร้าง scenario `Test_Scen` ใต้ root แล้ว propagate และ analyze Facility THBK ด้วย GMAT ปลอม

    ecef(prn, t_s) กำหนดตำแหน่ง ECEF ของดาวเอง (t_s = วินาทีหลัง start) ไม่ใส่ = วงโคจรวงกลมของ circular_ecef_km
    คืน (scenario_dir, data_dir): `<data_dir>/scenarios/Test_Scen` ที่มี ephem/ และ access/THBK/ แล้ว
    GMAT ปลอมมีผลเฉพาะในฟังก์ชันนี้ ผลที่เขียนลงดิสก์อ่านต่อได้โดยไม่ต้อง patch
    """
    root = Path(root)
    data_dir = root / "data"
    shutil.copytree(SNAPSHOT_SRC, data_dir / "orbits" / SNAPSHOT_NAME)
    scenario_dir = data_dir / "scenarios" / SCENARIO_NAME
    scenario_dir.mkdir(parents=True)
    (scenario_dir / "scenario.json").write_text(json.dumps(scenario_doc(start, stop, step_s)), encoding="utf-8")

    def propagate(sats, start_t, stop_t, step, work_dir, console, timeout_s=900, **_):
        return _propagate(sats, start_t, stop_t, step, ecef)

    with (mock.patch.object(studio, "propagate", side_effect=propagate),
          mock.patch.object(studio, "find_gmat_console", return_value=Path("/fake/GmatConsole")),
          mock.patch.object(studio, "gmat_version", return_value="FakeGmat")):
        studio.run_propagate(scenario_dir, data_dir)
        studio.run_analyze(scenario_dir, "THBK", data_dir)
    return scenario_dir, data_dir
