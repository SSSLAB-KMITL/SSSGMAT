import gzip
import math
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path

from gnss_predict.errors import Sp3FormatError
from gnss_predict.sp3 import Sp3Orbit, choose_sp3_name, gps_week, interpolate, prns_with_data, read_sp3

FX = Path(__file__).parent / "fixtures"

class TestNames(unittest.TestCase):
    def test_gps_week(self):
        self.assertEqual(gps_week(date(2026, 11, 8)), 2444)
        self.assertEqual(gps_week(date(2026, 11, 7)), 2443)
        self.assertEqual(gps_week(date(2026, 1, 4)), 2400)

    def test_choose_prefers_final(self):
        d = date(2026, 11, 8)
        fin = "IGS0OPSFIN_20263120000_01D_15M_ORB.SP3.gz"
        rap = "IGS0OPSRAP_20263120000_01D_15M_ORB.SP3.gz"
        self.assertEqual(choose_sp3_name([rap, fin, "x"], d), fin)
        self.assertEqual(choose_sp3_name([rap], d), rap)
        self.assertIsNone(choose_sp3_name(["IGS0OPSRAP_20263130000_01D_15M_ORB.SP3.gz"], d))

class TestRead(unittest.TestCase):
    def setUp(self):
        self.orbit = read_sp3(FX / "sample.sp3")

    def test_structure(self):
        o = self.orbit
        self.assertEqual(o.time_system, "GPS")
        self.assertEqual(len(o.epochs), 24)
        self.assertEqual(o.epochs[1] - o.epochs[0], timedelta(minutes=15))
        self.assertEqual(set(o.positions), {16, 22})
        self.assertIsNone(o.positions[22][2])
        for prn, pos in o.positions.items():
            for k, p in enumerate(pos):
                if (prn, k) != (22, 2):
                    self.assertTrue(25000 < math.hypot(*p) < 27500)

    def test_gz_same_as_plain(self):
        with tempfile.TemporaryDirectory() as d:
            gz = Path(d) / "sample.sp3.gz"
            gz.write_bytes(gzip.compress((FX / "sample.sp3").read_bytes()))
            self.assertEqual(read_sp3(gz), self.orbit)

    def test_non_gps_time_system_rejected(self):
        lines = (FX / "sample.sp3").read_text().splitlines(keepends=True)
        i = next(k for k, l in enumerate(lines) if l.startswith("%c"))
        lines[i] = lines[i].replace(" GPS ", " UTC ", 1)
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "utc.sp3"
            p.write_text("".join(lines))
            with self.assertRaises(Sp3FormatError):
                read_sp3(p)

    def test_prns_with_data(self):
        self.assertEqual(prns_with_data(self.orbit), {16, 22})

class TestInterpolate(unittest.TestCase):
    def setUp(self):
        self.orbit = read_sp3(FX / "sample.sp3")

    def test_exact_epoch_returns_stored(self):
        for k in (0, 10, 23):
            self.assertEqual(interpolate(self.orbit, 16, self.orbit.epochs[k]), self.orbit.positions[16][k])

    def test_30min_data_predicts_15min_point(self):
        o = self.orbit
        half = Sp3Orbit(o.time_system, o.epochs[::2], {16: o.positions[16][::2]})
        for j in (9, 11, 13):
            got = interpolate(half, 16, o.epochs[j])
            self.assertLess(math.dist(got, o.positions[16][j]), 0.001)   # < 1 m

    def test_none_near_edges(self):
        o = self.orbit
        self.assertIsNone(interpolate(o, 16, o.epochs[1] + timedelta(minutes=7.5)))
        self.assertIsNone(interpolate(o, 16, o.epochs[-1] - timedelta(minutes=7.5)))

    def test_none_when_window_has_gap(self):
        o = self.orbit   # PG22 ไม่มีข้อมูลที่ epoch 2
        self.assertIsNone(interpolate(o, 22, o.epochs[5] + timedelta(minutes=7.5)))
        self.assertIsNotNone(interpolate(o, 22, o.epochs[12] + timedelta(minutes=7.5)))


if __name__ == "__main__":
    unittest.main()
