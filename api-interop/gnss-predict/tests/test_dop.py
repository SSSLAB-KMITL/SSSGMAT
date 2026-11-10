import math
import random
import unittest
from datetime import datetime, timedelta, timezone

from gnss_predict.analyze import AerRow
from gnss_predict.dop import Dop, dop, dop_series
from gnss_predict.scenario import Facility

UTC = timezone.utc
T0 = datetime(2026, 11, 10, tzinfo=UTC)
FAC = Facility("THBK", 13.7, 100.5, 0.0, 10.0)


def geom(n, th):
    """ดาวที่จุดยอด + n ดวงมุมเงย th ทิศกระจายเท่ากัน"""
    return [(0.0, 90.0)] + [(360.0 * k / n, th) for k in range(n)]


def row(prn, el, az=0.0, time_utc=T0):
    return AerRow(time_utc, prn, az, el, 20000.0, 0.0, 0.0, 1.0)


class TestDop(unittest.TestCase):
    def test_closed_form_n3_30deg(self):
        d = dop(geom(3, 30.0))
        self.assertIsInstance(d, Dop)
        for got, ref in ((d.hdop, 1.333333), (d.vdop, 2.309401), (d.tdop, 1.527525), (d.pdop, 2.666667),
                         (d.gdop, 3.073181), (d.edop, 0.942809), (d.ndop, 0.942809)):
            self.assertAlmostEqual(got, ref, delta=1e-6)

    def test_closed_form_n5_15deg(self):
        d = dop(geom(5, 15.0))
        for got, ref in ((d.gdop, 1.878256), (d.pdop, 1.744087), (d.hdop, 0.925979), (d.vdop, 1.477973),
                         (d.edop, 0.654766), (d.tdop, 0.697142)):
            self.assertAlmostEqual(got, ref, delta=1e-6)

    def test_closed_form_formulas_match_spec(self):
        """EDOP = NDOP = √(2/(n cos²θ)), VDOP = √((1+n)/(n(1−sin θ)²)), TDOP = √((1+n sin²θ)/(n(1−sin θ)²))"""
        for n, th in ((3, 30.0), (5, 15.0), (6, 40.0)):
            d = dop(geom(n, th))
            s, c = math.sin(math.radians(th)), math.cos(math.radians(th))
            self.assertAlmostEqual(d.edop, math.sqrt(2.0 / (n * c * c)), delta=1e-9)
            self.assertAlmostEqual(d.ndop, math.sqrt(2.0 / (n * c * c)), delta=1e-9)
            self.assertAlmostEqual(d.vdop, math.sqrt((1 + n) / (n * (1 - s) ** 2)), delta=1e-9)
            self.assertAlmostEqual(d.tdop, math.sqrt((1 + n * s * s) / (n * (1 - s) ** 2)), delta=1e-9)

    def test_identities(self):
        rng = random.Random(20261111)
        sats = [(rng.uniform(0.0, 360.0), rng.uniform(10.0, 85.0)) for _ in range(7)]
        d = dop(sats)
        self.assertIsNotNone(d)
        self.assertAlmostEqual(d.hdop ** 2, d.edop ** 2 + d.ndop ** 2, delta=1e-12)
        self.assertAlmostEqual(d.gdop ** 2, d.pdop ** 2 + d.tdop ** 2, delta=1e-12)
        self.assertAlmostEqual(d.pdop ** 2, d.hdop ** 2 + d.vdop ** 2, delta=1e-12)

    def test_input_order_does_not_matter(self):
        sats = geom(5, 25.0)
        a, b = dop(sats), dop(list(reversed(sats)))
        for x, y in zip((a.gdop, a.pdop, a.hdop, a.vdop, a.edop, a.ndop, a.tdop),
                        (b.gdop, b.pdop, b.hdop, b.vdop, b.edop, b.ndop, b.tdop)):
            self.assertAlmostEqual(x, y, delta=1e-12)

    def test_too_few_or_singular(self):
        self.assertIsNone(dop(geom(2, 30.0)))              # 3 ดวง
        self.assertIsNone(dop([]))
        self.assertIsNone(dop([(10.0, 45.0)] * 5))         # ทิศเดียวกันหมด


class TestDopSeries(unittest.TestCase):
    def test_series_systems_and_exclusions(self):
        rows = [row("G01", 85.0), row("G02", 30.0, 0.0), row("G03", 30.0, 120.0), row("G04", 30.0, 240.0),
                row("E14", 45.0, 60.0)]
        flags = {"E14": frozenset({"unhealthy"}), "G01": frozenset({"stale"})}
        out = dop_series(rows, FAC, flags)
        self.assertEqual([r["system"] for r in out], ["ALL", "G", "R", "E", "C"])
        by = {r["system"]: r for r in out}
        for r in out:
            self.assertEqual(r["time_utc"], T0)
            self.assertEqual(set(r), {"time_utc", "system", "n_visible", "gdop", "pdop", "hdop", "vdop",
                                      "edop", "ndop", "tdop"})
        self.assertEqual(by["G"]["n_visible"], 4)
        self.assertEqual(by["ALL"]["n_visible"], 4)        # ALL ไม่นับ E14
        expected = dop([(0.0, 85.0), (0.0, 30.0), (120.0, 30.0), (240.0, 30.0)])
        for key in ("gdop", "pdop", "hdop", "vdop", "edop", "ndop", "tdop"):
            self.assertAlmostEqual(by["G"][key], getattr(expected, key), delta=1e-12)
            self.assertAlmostEqual(by["ALL"][key], getattr(expected, key), delta=1e-12)
        for system in ("R", "E", "C"):
            self.assertEqual(by[system]["n_visible"], 0)
            for key in ("gdop", "pdop", "hdop", "vdop", "edop", "ndop", "tdop"):
                self.assertIsNone(by[system][key])

    def test_elevation_threshold_and_all_flags(self):
        rows = [row("G01", 9.999), row("G02", 10.0), row("G03", 50.0), row("G04", 50.0), row("G05", 50.0),
                row("G06", 50.0), row("G07", 50.0)]
        flags = {"G03": frozenset({"too_old"}), "G04": frozenset({"no_broadcast", "stale"}),
                 "G05": frozenset({"prn_changed", "name_mismatch"})}
        by = {r["system"]: r for r in dop_series(rows, FAC, flags)}
        self.assertEqual(by["G"]["n_visible"], 4)          # G02 (El = เกณฑ์), G05 (ธงไม่ตัด), G06, G07

    def test_every_time_gets_five_rows_even_when_empty(self):
        t1 = T0 + timedelta(seconds=30)
        t2 = T0 + timedelta(seconds=60)
        rows = [row("G01", 50.0, time_utc=T0), row("R01", 50.0, time_utc=t2)]
        out = dop_series(rows, FAC, {})
        self.assertEqual(len(out), 10)
        self.assertEqual([r["time_utc"] for r in out], [T0] * 5 + [t2] * 5)
        self.assertEqual([r["system"] for r in out[5:]], ["ALL", "G", "R", "E", "C"])
        self.assertEqual({r["system"]: r["n_visible"] for r in out[5:]}, {"ALL": 1, "G": 0, "R": 1, "E": 0, "C": 0})
        self.assertNotIn(t1, [r["time_utc"] for r in out])
        self.assertEqual(dop_series([], FAC, {}), [])

    def test_below_threshold_only_time_still_listed(self):
        out = dop_series([row("G01", 5.0)], FAC, {})
        self.assertEqual(len(out), 5)
        self.assertTrue(all(r["n_visible"] == 0 and r["gdop"] is None for r in out))

    def test_all_combines_systems_with_single_clock(self):
        rows = [row("G01", 90.0), row("R01", 30.0, 0.0), row("E01", 30.0, 120.0), row("C01", 30.0, 240.0)]
        by = {r["system"]: r for r in dop_series(rows, FAC, {})}
        self.assertEqual(by["ALL"]["n_visible"], 4)
        self.assertIsNotNone(by["ALL"]["gdop"])
        for system in ("G", "R", "E", "C"):
            self.assertLess(by[system]["n_visible"], 4)
            self.assertIsNone(by[system]["gdop"])
        expected = dop(geom(3, 30.0))
        self.assertAlmostEqual(by["ALL"]["gdop"], expected.gdop, delta=1e-12)


if __name__ == "__main__":
    unittest.main()
