import csv
import json
import math
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from gnss_predict.__main__ import main
from gnss_predict.errors import GmatNotFoundError
from gnss_predict.predict import predict_samples
from gnss_predict.run_gmat import find_gmat_console
from gnss_predict.tle_fetch import parse_tle_file

FX = Path(__file__).parent.resolve() / "fixtures"
START = datetime(2026, 11, 10, tzinfo=timezone.utc)


def gmat_available() -> bool:
    try:
        find_gmat_console()
        return True
    except GmatNotFoundError:
        return False


@unittest.skipUnless(gmat_available(), "ไม่มี GmatConsole")
class TestIntegration(unittest.TestCase):
    def test_predict_samples_ranges(self):
        entries, _ = parse_tle_file(FX / "gps_2sat.tle")
        with tempfile.TemporaryDirectory() as d:
            s = predict_samples(entries, FX / "gps_2sat.tle", START, 1, 30, Path(d), find_gmat_console())
        self.assertEqual(len(s), 242)
        for x in s:
            rng = math.sqrt(x.s_km ** 2 + x.e_km ** 2 + x.z_km ** 2)
            self.assertTrue(19000.0 < rng < 34000.0)       # ใต้ขอบฟ้าไกลได้ถึงราว 33,000 กม.
            if x.z_km >= 0:
                self.assertLess(rng, 27000.0)              # เหนือขอบฟ้าอยู่ราว 20,200–25,800 กม.

    def test_cli_end_to_end(self):
        with tempfile.TemporaryDirectory() as d:
            rc = main(["--start", "2026-11-10T00:00Z", "--hours", "1", "--min-el", "-90",
                       "--tle-file", str(FX / "gps_2sat.tle"), "--out-dir", d])
            self.assertEqual(rc, 0)
            out = Path(d) / "thbk_gnss_pred_20261110T0000Z_1h.csv"
            with out.open(newline="") as f:
                rows = list(csv.reader(f))
            self.assertEqual(rows[0], ["DAY", "Time", "PRN", "Az", "El", "IPP_Lat", "IPP_Lon", "MF"])
            self.assertEqual(len(rows) - 1, 242)
            meta = json.loads((Path(d) / "thbk_gnss_pred_20261110T0000Z_1h.meta.json").read_text())
            self.assertEqual(meta["prns_included"], [16, 22])
            self.assertEqual(list(Path(d).glob("work-*")), [])


if __name__ == "__main__":
    unittest.main()
