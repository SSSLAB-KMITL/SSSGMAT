import math
import unittest
from datetime import datetime, timedelta, timezone

from gnss_predict.config import THBK_ECEF_M, THBK_LAT_DEG, THBK_LON_DEG
from gnss_predict.geometry import ecef_to_az_el
from gnss_predict.report import SezSample
from gnss_predict.sp3 import Sp3Orbit
from gnss_predict.validate import Pair, az_diff, make_pairs, reference_az_el, summarize

T0 = datetime(2026, 11, 10, tzinfo=timezone.utc)
STA = tuple(c / 1000.0 for c in THBK_ECEF_M)

def pairs(n, d_el=0.0, d_az=0.0, el=45.0, prn=16):
    return [Pair(prn, T0 + timedelta(seconds=30 * i), 100.0 + d_az, el + d_el, 100.0, el) for i in range(n)]

class TestAzDiff(unittest.TestCase):
    def test_wrap(self):
        self.assertAlmostEqual(az_diff(359.9, 0.1), -0.2, places=9)
        self.assertAlmostEqual(az_diff(0.1, 359.9), 0.2, places=9)

class TestSummarize(unittest.TestCase):
    def test_perfect_passes(self):
        self.assertTrue(summarize(pairs(100), {16}, {16})["passed"])

    def test_el_median_fails(self):
        s = summarize(pairs(100, d_el=0.06), {16}, {16})
        self.assertFalse(s["passed"]); self.assertIn("el_median", s["failed_checks"])

    def test_el_p99_fails(self):
        s = summarize(pairs(98) + pairs(2, d_el=0.5), {16}, {16})
        self.assertAlmostEqual(s["el_median"], 0.0); self.assertIn("el_p99", s["failed_checks"])

    def test_az_ignored_near_zenith(self):
        self.assertTrue(summarize(pairs(50) + pairs(50, d_az=5.0, el=85.0), {16}, {16})["passed"])

    def test_predicted_prn_missing_from_sp3_fails(self):
        s = summarize(pairs(100), {16, 5}, {16})
        self.assertIn("prns_not_in_sp3", s["failed_checks"]); self.assertEqual(s["prns_not_in_sp3"], [5])

    def test_extra_sp3_prn_only_reported(self):
        s = summarize(pairs(100), {16}, {16, 7})
        self.assertTrue(s["passed"]); self.assertEqual(s["prns_not_predicted"], [7])

    def test_too_few_pairs_fails(self):
        self.assertFalse(summarize(pairs(1), {16}, {16})["passed"])

EPOCHS = [T0 + timedelta(minutes=15 * i) for i in range(30)]

def moving(t):
    # จุดเริ่มอยู่ห่างสถานี 20000 กม. ตามแกน z แล้วเคลื่อนที่ตามแกน y 3.9 กม./วินาที
    # ทิศที่มองจากสถานีจึงเปลี่ยนตามเวลา (ถ้าเคลื่อนที่ในแนวเส้นตรงผ่านสถานี มุมจะคงที่และเทสต์จะตรวจอะไรไม่ได้)
    dt = (t - T0).total_seconds()
    return (STA[0], STA[1] + 3.9 * dt, STA[2] + 20000.0)

def enu_point(el_deg, az_deg, rng=20000.0):
    la, lo = math.radians(THBK_LAT_DEG), math.radians(THBK_LON_DEG)
    up = (math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la))
    north = (-math.sin(la) * math.cos(lo), -math.sin(la) * math.sin(lo), math.cos(la))
    east = (-math.sin(lo), math.cos(lo), 0.0)
    e, a = math.radians(el_deg), math.radians(az_deg)
    return tuple(STA[j] + rng * (math.cos(e) * math.cos(a) * north[j] + math.cos(e) * math.sin(a) * east[j]
                                 + math.sin(e) * up[j]) for j in range(3))

class TestReference(unittest.TestCase):
    def test_uses_gps_time_offset(self):
        orbit = Sp3Orbit("GPS", EPOCHS, {16: [moving(e) for e in EPOCHS]})   # เส้นตรง Lagrange จึงคืนค่าได้ตรง
        t = T0 + timedelta(hours=3, minutes=7)
        got = reference_az_el(orbit, 16, t)
        exp = ecef_to_az_el(moving(t + timedelta(seconds=18)), STA, THBK_LAT_DEG, THBK_LON_DEG)
        self.assertAlmostEqual(got[0], exp[0], places=6)
        self.assertAlmostEqual(got[1], exp[1], places=6)
        wrong = ecef_to_az_el(moving(t), STA, THBK_LAT_DEG, THBK_LON_DEG)
        self.assertGreater(abs(got[0] - wrong[0]) + abs(got[1] - wrong[1]), 1e-3)

    def test_make_pairs_filters_min_el(self):
        orbit = Sp3Orbit("GPS", EPOCHS, {16: [enu_point(60.0, 30.0)] * 30, 22: [enu_point(5.0, 0.0)] * 30})
        t = T0 + timedelta(hours=3)
        samples = [SezSample(t, 16, 0.0, 0.0, 20200.0), SezSample(t, 22, -20000.0, 0.0, 0.0)]
        got = make_pairs(samples, orbit, 10.0)
        self.assertEqual([p.prn for p in got], [16])
        self.assertAlmostEqual(got[0].el_ref, 60.0, places=6)
        self.assertAlmostEqual(got[0].az_ref, 30.0, places=6)
        self.assertAlmostEqual(got[0].el_pred, 90.0, places=6)


if __name__ == "__main__":
    unittest.main()
