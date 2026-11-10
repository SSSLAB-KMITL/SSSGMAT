"""run_propagate + run_analyze ด้วย GMAT จริงกับ snapshot ย่อใน fixture (ไม่ใช้เน็ต ข้ามถ้าไม่มี GmatConsole)"""

import json
import math
import shutil
import tempfile
import unittest
from pathlib import Path

from gnss_predict.config import THBK_HEIGHT_M, THBK_LAT_DEG, THBK_LON_DEG
from gnss_predict.errors import GmatNotFoundError
from gnss_predict.run_gmat import find_gmat_console
from gnss_predict.sp3 import read_sp3_all
from gnss_predict.studio import run_analyze, run_propagate

SNAP = Path(__file__).parent / "fixtures" / "studio" / "snapshot"
SATELLITES = [("G01", 62339), ("E11", 37846), ("R05", 43508), ("C01", 56564), ("C40", 44542), ("R10", 100744)]


def gmat_available() -> bool:
    try:
        find_gmat_console()
        return True
    except GmatNotFoundError:
        return False


@unittest.skipUnless(gmat_available(), "ไม่มี GmatConsole")
class TestStudioIntegration(unittest.TestCase):
    def setUp(self):
        root = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, root, ignore_errors=True)
        self.data = root / "data"
        shutil.copytree(SNAP, self.data / "orbits" / "20261110T0000Z")
        self.sc = root / "scen"
        self.sc.mkdir()
        scenario = {
            "format": "gnss-studio-scenario/1",
            "name": "THBK_Integration",
            "analysis_period": {"start": "2026-11-10T00:00:00Z", "stop": "2026-11-10T06:00:00Z"},
            "step_s": 30,
            "orbit_snapshot": "20261110T0000Z",
            "satellite_filter": {"show_too_old": True, "show_no_broadcast": True},
            "objects": [{"class": "Facility", "name": "THBK",
                         "position": {"type": "Geodetic", "lat_deg": THBK_LAT_DEG, "lon_deg": THBK_LON_DEG,
                                      "alt_m": THBK_HEIGHT_M},
                         "constraints": {"elevation_angle_min_deg": 10.0}}]
                       + [{"class": "Satellite", "name": n, "norad": norad} for n, norad in SATELLITES],
        }
        (self.sc / "scenario.json").write_text(json.dumps(scenario), encoding="utf-8")

    def test_propagate_then_analyze(self):
        calls = []
        ephem, _ = run_propagate(self.sc, data_dir=self.data, progress=lambda s, f: calls.append((s, f)))
        sp3 = read_sp3_all(ephem / "predicted.sp3")
        self.assertEqual(set(sp3), {"G01", "E11", "R05", "C01", "C40", "R10"})       # รวมดาวเลข 6 หลัก (R10)
        for prn, s in sp3.items():
            self.assertEqual(len(s), 721, prn)
            self.assertTrue(all(19000 < math.dist(p, (0, 0, 0)) < 43000 for p in s.values()), prn)
        man = json.loads((ephem / "manifest.json").read_text(encoding="utf-8"))
        r10 = next(x for x in man["satellites"] if x["prn"] == "R10")
        self.assertTrue(r10["propagated"])
        self.assertIn("too_old", r10["flags"])
        self.assertTrue(man["gmat_version"].startswith("GmatConsole"))
        self.assertEqual((calls[0][1], calls[-1][1]), (0.0, 1.0))
        self.assertEqual(run_propagate(self.sc, data_dir=self.data)[0], ephem)            # ใช้ผลเดิม

        calls.clear()
        acc, _ = run_analyze(self.sc, "THBK", data_dir=self.data, progress=lambda s, f: calls.append((s, f)))
        for f in ("manifest.json", "aer.csv", "intervals.json", "dop.csv", "access.czml", "legacy_gps.csv"):
            self.assertTrue((acc / f).is_file(), f)
        self.assertEqual((acc / "aer.csv").read_text(encoding="utf-8").splitlines()[0],
                         "time_utc,prn,az_deg,el_deg,range_km,ipp_lat_deg,ipp_lon_deg,mf")
        legacy = (acc / "legacy_gps.csv").read_text(encoding="utf-8").splitlines()
        self.assertEqual(legacy[0], "DAY,Time,PRN,Az,El,IPP_Lat,IPP_Lon,MF")
        self.assertTrue(all(r.split(",")[2].startswith("G") for r in legacy[1:]))
        self.assertEqual(len((acc / "dop.csv").read_text(encoding="utf-8").splitlines()) - 1, 721 * 5)
        self.assertEqual((calls[0][1], calls[-1][1]), (0.0, 1.0))


if __name__ == "__main__":
    unittest.main()
