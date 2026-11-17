import json
import math
import unittest
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from gnss_predict.czml import access_czml, satellites_czml
from gnss_predict.propagate import Ephemeris
from gnss_predict.scenario import Facility

T0 = datetime(2026, 11, 10, tzinfo=timezone.utc)
THBK = Facility("THBK", 13.729779, 100.781151, 6.4, 10.0)

GM_KM3_S2 = 398600.4418
OMEGA_E = 7.2921151467e-5


@dataclass
class Iv:
    """ตัวแทน analyze.Interval (Task 10) ที่มีเฉพาะ start และ stop"""
    start: datetime
    stop: datetime


def t(seconds: float) -> datetime:
    return T0 + timedelta(seconds=seconds)


def iso(seconds: int) -> str:
    return t(seconds).strftime("%Y-%m-%dT%H:%M:%SZ")


def orbit_ecef_km(t_s: float, phase: float, ecc: float = 0.01) -> tuple[float, float, float]:
    """วงโคจร MEO จำลอง (a = 26560 กม. i = 55°) ในกรอบหมุนตามโลก ใช้เป็นค่าจริงของ test"""
    a = 26560.0
    inc = math.radians(55.0)
    n = math.sqrt(GM_KM3_S2 / a ** 3)
    m = phase + n * t_s
    big_e = m
    for _ in range(20):
        big_e -= (big_e - ecc * math.sin(big_e) - m) / (1 - ecc * math.cos(big_e))
    xp = a * (math.cos(big_e) - ecc)
    yp = a * math.sqrt(1 - ecc * ecc) * math.sin(big_e)
    xi, yi, zi = xp, yp * math.cos(inc), yp * math.sin(inc)
    th = OMEGA_E * t_s
    return (xi * math.cos(th) + yi * math.sin(th), -xi * math.sin(th) + yi * math.cos(th), zi)


def make_eph(span_s: int, step_s: int = 30, prns: tuple[str, ...] = ("G01", "R05")) -> Ephemeris:
    times = [t(k * step_s) for k in range(span_s // step_s + 1)]
    pos = {p: [orbit_ecef_km(k * step_s, 0.5 + i) for k in range(len(times))] for i, p in enumerate(prns)}
    return Ephemeris(times_utc=times, positions_km=pos)


def lagrange(ts: list[float], vs: list[float], x: float) -> float:
    total = 0.0
    for i, (ti, vi) in enumerate(zip(ts, vs)):
        w = 1.0
        for j, tj in enumerate(ts):
            if j != i:
                w *= (x - tj) / (ti - tj)
        total += w * vi
    return total


class TestSatellitesCzml(unittest.TestCase):
    def test_document_and_satellite_packet(self):
        eph = make_eph(3600)
        self.assertEqual(len(eph.times_utc), 121)
        pk = satellites_czml(eph)
        self.assertEqual(pk[0]["id"], "document")
        self.assertEqual(pk[0]["version"], "1.0")
        self.assertEqual(pk[0]["clock"]["interval"], "2026-11-10T00:00:00Z/2026-11-10T01:00:00Z")
        s = next(p for p in pk if p["id"] == "sat/G01")
        pos = s["position"]
        self.assertEqual((pos["referenceFrame"], pos["interpolationAlgorithm"], pos["interpolationDegree"]),
                         ("FIXED", "LAGRANGE", 7))
        self.assertEqual(pos["epoch"], "2026-11-10T00:00:00Z")
        self.assertEqual(s["availability"], "2026-11-10T00:00:00Z/2026-11-10T01:00:00Z")
        self.assertEqual(len(pos["cartesian"]), 4 * 13)
        self.assertEqual(pos["cartesian"][0], 0)
        self.assertAlmostEqual(pos["cartesian"][1], eph.positions_km["G01"][0][0] * 1000)
        self.assertAlmostEqual(pos["cartesian"][2], eph.positions_km["G01"][0][1] * 1000)
        self.assertAlmostEqual(pos["cartesian"][3], eph.positions_km["G01"][0][2] * 1000)
        # sample ที่ 2 คือเวลา 300 s ซึ่งเป็นจุดที่ 11 (index 10) ของตาราง 30 s
        self.assertEqual(pos["cartesian"][4], 300)
        self.assertAlmostEqual(pos["cartesian"][5], eph.positions_km["G01"][10][0] * 1000)
        self.assertNotIn("label", s)
        self.assertNotIn("path", s)
        self.assertEqual({p["id"] for p in pk}, {"document", "sat/G01", "sat/R05"})
        self.assertEqual(set(s), {"id", "availability", "position"})
        json.dumps(pk)

    def test_last_sample_is_stop(self):
        eph = make_eph(3720)          # 1 ชม. 2 นาที: 3720 ไม่หาร 300 ลงตัว
        pos = next(p for p in satellites_czml(eph) if p["id"] == "sat/G01")["position"]["cartesian"]
        times = pos[0::4]
        self.assertEqual(times[-2:], [3600, 3720])
        self.assertEqual(len(times), 14)
        self.assertAlmostEqual(pos[-3], eph.positions_km["G01"][-1][0] * 1000)

    def test_step_s_changes_sample_spacing(self):
        eph = make_eph(3600)
        pos = next(p for p in satellites_czml(eph, step_s=600) if p["id"] == "sat/G01")["position"]["cartesian"]
        self.assertEqual(pos[0::4], list(range(0, 3601, 600)))

    def test_step_s_not_multiple_of_grid_uses_whole_grid_steps(self):
        # grid 45 s, step_s 300 → ขั้นละ 6 จุด (270 s) ไม่ข้ามไปที่ 900 s (lcm)
        eph = make_eph(2700, step_s=45)
        pos = next(p for p in satellites_czml(eph) if p["id"] == "sat/G01")["position"]["cartesian"]
        self.assertEqual(pos[0::4], list(range(0, 2701, 270)))

    def test_fractional_second_start_is_written_with_fraction(self):
        start = T0 + timedelta(milliseconds=500)
        eph = Ephemeris([start, start + timedelta(seconds=30)],
                        {"G01": [(7000.0, 0.0, 0.0), (7000.0, 1.0, 0.0)]})
        pk = satellites_czml(eph)
        self.assertEqual(pk[0]["clock"]["interval"], "2026-11-10T00:00:00.5Z/2026-11-10T00:00:30.5Z")
        self.assertEqual(pk[1]["position"]["cartesian"][4], 30)

    def test_non_utc_input_is_written_as_utc(self):
        tz = timezone(timedelta(hours=7))
        eph = Ephemeris([T0.astimezone(tz), (T0 + timedelta(seconds=30)).astimezone(tz)],
                        {"G01": [(7000.0, 0.0, 0.0), (7000.0, 1.0, 0.0)]})
        self.assertEqual(satellites_czml(eph)[0]["clock"]["interval"],
                         "2026-11-10T00:00:00Z/2026-11-10T00:00:30Z")

    def test_bad_input_raises_value_error(self):
        good = {"G01": [(1.0, 2.0, 3.0), (1.0, 2.0, 3.0)]}
        with self.assertRaises(ValueError):
            satellites_czml(Ephemeris([T0], {"G01": [(1.0, 2.0, 3.0)]}))
        with self.assertRaises(ValueError):
            satellites_czml(Ephemeris([T0, T0], good))
        with self.assertRaises(ValueError):
            satellites_czml(Ephemeris([T0, t(30)], {"G01": [(1.0, 2.0, 3.0)]}))
        with self.assertRaises(ValueError):
            satellites_czml(Ephemeris([T0.replace(tzinfo=None), t(30)], good))
        for bad in (0, -300, 1.5, True):
            with self.assertRaises(ValueError):
                satellites_czml(Ephemeris([T0, t(30)], good), step_s=bad)

    def test_lagrange_degree7_error_below_1m(self):
        # วงโคจรจำลอง 24 ชม. ทุก 30 s → sample 300 s ของ CZML → Lagrange 8 จุดรอบเวลา t เทียบค่าจริงทุก 30 s
        eph = make_eph(86400, prns=("G01",))
        cart = next(p for p in satellites_czml(eph) if p["id"] == "sat/G01")["position"]["cartesian"]
        ts = cart[0::4]
        cols = [cart[1::4], cart[2::4], cart[3::4]]
        self.assertEqual(ts[:3], [0, 300, 600])
        self.assertEqual(ts[-1], 86400)
        worst = 0.0
        for k in range(3 * 300, 86400 - 4 * 300 + 1, 30):
            j = k // 300                                     # sample ที่อยู่ก่อนหรือที่เวลา k
            window = slice(j - 3, j + 5)                     # 8 จุด: j−3 … j+4 คร่อมเวลา k
            truth = eph.positions_km["G01"][k // 30]
            for axis in range(3):
                est = lagrange(ts[window], cols[axis][window], k)
                worst = max(worst, abs(est - truth[axis] * 1000))
        self.assertLessEqual(worst, 1.0)


class TestAccessCzml(unittest.TestCase):
    def test_access_show_intervals_cover_period(self):
        pk = access_czml(THBK, {"G01": [Iv(t(600), t(1200))]}, (t(0), t(3600)))
        a = next(p for p in pk if p["id"] == "access/THBK/G01")
        self.assertEqual(a["polyline"]["positions"]["references"], ["fac/THBK#position", "sat/G01#position"])
        self.assertEqual([(x["interval"], x["boolean"]) for x in a["polyline"]["show"]],
                         [(f"{iso(0)}/{iso(600)}", False), (f"{iso(600)}/{iso(1200)}", True),
                          (f"{iso(1200)}/{iso(3600)}", False)])
        self.assertNotIn("material", a["polyline"])
        self.assertEqual(a["polyline"]["arcType"], "NONE")
        self.assertEqual(set(a["polyline"]), {"positions", "show", "arcType"})
        self.assertEqual(pk[0], {"id": "document", "version": "1.0"})
        f = next(p for p in pk if p["id"] == "fac/THBK")
        self.assertEqual(f["position"]["cartographicDegrees"], [100.781151, 13.729779, 6.4])
        self.assertEqual(set(f), {"id", "position"})
        json.dumps(pk)

    def test_intervals_touching_period_edges_have_no_empty_segments(self):
        pk = access_czml(THBK, {"G01": [Iv(t(0), t(600)), Iv(t(3000), t(3600))]}, (t(0), t(3600)))
        a = next(p for p in pk if p["id"] == "access/THBK/G01")
        self.assertEqual([(x["interval"], x["boolean"]) for x in a["polyline"]["show"]],
                         [(f"{iso(0)}/{iso(600)}", True), (f"{iso(600)}/{iso(3000)}", False),
                          (f"{iso(3000)}/{iso(3600)}", True)])

    def test_whole_period_visible_is_a_single_true_segment(self):
        pk = access_czml(THBK, {"G01": [Iv(t(-100), t(4000))]}, (t(0), t(3600)))
        a = next(p for p in pk if p["id"] == "access/THBK/G01")
        self.assertEqual(a["polyline"]["show"], [{"interval": f"{iso(0)}/{iso(3600)}", "boolean": True}])

    def test_overlapping_and_unsorted_intervals_are_merged(self):
        ivs = [Iv(t(1000), t(1500)), Iv(t(400), t(1000)), Iv(t(1400), t(2000)), Iv(t(2500), t(2600))]
        pk = access_czml(THBK, {"G01": ivs}, (t(0), t(3600)))
        a = next(p for p in pk if p["id"] == "access/THBK/G01")
        self.assertEqual([(x["interval"], x["boolean"]) for x in a["polyline"]["show"]],
                         [(f"{iso(0)}/{iso(400)}", False), (f"{iso(400)}/{iso(2000)}", True),
                          (f"{iso(2000)}/{iso(2500)}", False), (f"{iso(2500)}/{iso(2600)}", True),
                          (f"{iso(2600)}/{iso(3600)}", False)])

    def test_sat_without_access_in_period_gets_no_line(self):
        pk = access_czml(THBK, {"G01": [], "G02": [Iv(t(5000), t(6000))], "G03": [Iv(t(100), t(200))]},
                         (t(0), t(3600)))
        self.assertEqual([p["id"] for p in pk], ["document", "fac/THBK", "access/THBK/G03"])

    def test_no_intervals_gives_only_the_facility(self):
        pk = access_czml(THBK, {}, (t(0), t(3600)))
        self.assertEqual([p["id"] for p in pk], ["document", "fac/THBK"])

    def test_bad_period_raises_value_error(self):
        with self.assertRaises(ValueError):
            access_czml(THBK, {}, (t(3600), t(0)))
        with self.assertRaises(ValueError):
            access_czml(THBK, {}, (t(0), t(0)))
        with self.assertRaises(ValueError):
            access_czml(THBK, {}, (T0.replace(tzinfo=None), t(60)))


if __name__ == "__main__":
    unittest.main()
