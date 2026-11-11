import math
import unittest
from datetime import timedelta

from gpredict_web.observe import TleElements, orbit_start
from gpredict_web.passes import find_passes
from gpredict_web.tracks import ground_track, sky_track
from gnss_predict.geometry import ecef_to_aer
from tests.helpers import (
    PERIOD_S, W_RAD_S, WINDOW_HOURS, WINDOW_START, circular_ephem, circular_state, fixed_ephem, half_pass_s,
    origin_qth,
)

WINDOW_STOP = WINDOW_START + timedelta(hours=WINDOW_HOURS)
USABLE_START = WINDOW_START + timedelta(seconds=150)
USABLE_STOP = WINDOW_STOP - timedelta(seconds=150)
T_PEAK = WINDOW_START + timedelta(hours=8, seconds=7)
Q = origin_qth()


def secs(a, b) -> float:
    return (a - b).total_seconds()


def equatorial_elements(t_ref) -> TleElements:
    """ดาวที่ตกลงลองจิจูด 0 ที่ t_ref และครบรอบทุก PERIOD_S: ต้นรอบ (M0 + ω = 0) อยู่ที่ t_ref + k·PERIOD_S"""
    return TleElements(epoch=t_ref, mean_motion=86400.0 * W_RAD_S / (2.0 * math.pi), ndot2=0.0, bstar=0.0,
                       incl_deg=0.0, raan_deg=0.0, ecc=0.0, argp_deg=0.0, m0_deg=0.0, revnum=1)


def wrap(deg: float) -> float:
    return (deg + 180.0) % 360.0 - 180.0


def lon_at(t_ref, t) -> float:
    return wrap(math.degrees(W_RAD_S * secs(t, t_ref)))


class GroundTrackTest(unittest.TestCase):
    def setUp(self):
        self.t_ref = WINDOW_START + timedelta(hours=1)
        self.eph = circular_ephem(self.t_ref, 0.0)                 # ในระนาบศูนย์สูตร: ลองจิจูดเพิ่มทางตะวันออก
        self.el = equatorial_elements(self.t_ref)

    def test_ground_track_splits_at_antimeridian(self):
        t = self.t_ref + timedelta(seconds=1.3 * PERIOD_S)          # รอบที่ 1 (นับจาก 0) ต้นรอบที่ t_ref + P
        track = ground_track(self.eph, self.el, t, 2)
        # สองรอบ: ลองจิจูด 0 → 720° ข้าม 180° สองครั้ง ได้ 3 เส้น
        self.assertEqual(len(track), 3)
        for line in track:
            self.assertGreater(len(line), 2)
            for (lat, lon), (lat2, lon2) in zip(line, line[1:]):
                self.assertAlmostEqual(lat, 0.0, places=6)
                self.assertLess(abs(lon2 - lon), 180.0)
                self.assertGreater(lon2, lon)                      # เดินทางตะวันออกเสมอ ไม่ย้อน
        self.assertAlmostEqual(track[0][-1][1], 180.0, delta=360.0 * 30.0 / PERIOD_S)
        self.assertAlmostEqual(track[1][0][1], -180.0, delta=360.0 * 30.0 / PERIOD_S)

    def test_ground_track_starts_at_orbit_start_and_stops_at_window_end(self):
        t = self.t_ref + timedelta(seconds=1.3 * PERIOD_S)
        start = orbit_start(self.el, t)
        self.assertAlmostEqual(secs(start, self.t_ref), PERIOD_S, delta=0.01)
        track = ground_track(self.eph, self.el, t, 2)
        first, last = track[0][0], track[-1][-1]
        self.assertAlmostEqual(first[1], lon_at(self.t_ref, start), delta=1e-3)
        # สิ้นสุดที่ต้นรอบที่ k + 2 = t_ref + 3P (ลองจิจูด 0 อีกครั้ง) ยังอยู่ในช่วง
        self.assertAlmostEqual(wrap(last[1]), 0.0, delta=1e-3)
        n_points = sum(len(line) for line in track)
        self.assertAlmostEqual(n_points, 2 * PERIOD_S / 30.0 + 2, delta=2)

        # orbits มากจนเลยท้ายช่วง: ตัดที่ stop − 150 วินาที ด้วยจุดปลายที่ interpolate
        long_track = ground_track(self.eph, self.el, t, 20)
        self.assertAlmostEqual(long_track[-1][-1][1], lon_at(self.t_ref, USABLE_STOP), delta=1e-3)
        self.assertAlmostEqual(long_track[-1][-1][0], 0.0, places=6)

    def test_ground_track_is_clipped_at_window_start(self):
        t_ref = WINDOW_START + timedelta(seconds=100)               # ต้นรอบอยู่ในขอบ 150 วินาทีแรก (interpolate ไม่ได้)
        eph, el = circular_ephem(t_ref, 0.0), equatorial_elements(t_ref)
        t = WINDOW_START + timedelta(seconds=1000)
        self.assertAlmostEqual(secs(orbit_start(el, t), t_ref), 0.0, delta=0.01)
        track = ground_track(eph, el, t, 1)
        self.assertAlmostEqual(track[0][0][1], lon_at(t_ref, USABLE_START), delta=1e-3)
        self.assertAlmostEqual(track[-1][-1][1], 0.0, delta=1e-3)            # จบที่ t_ref + P

    def test_ground_track_is_empty_when_the_orbit_is_outside_the_window(self):
        el = equatorial_elements(self.t_ref)
        t = WINDOW_STOP + timedelta(hours=3)
        self.assertEqual(ground_track(self.eph, el, t, 1), [])

    def test_no_orbits_means_no_track(self):
        self.assertEqual(ground_track(self.eph, self.el, self.t_ref + timedelta(hours=1), 0), [])


class SkyTrackTest(unittest.TestCase):
    def setUp(self):
        self.beta = 10.0
        self.eph = circular_ephem(T_PEAK, self.beta)
        self.passes = find_passes(self.eph, Q)
        self.half = half_pass_s(self.beta)

    def expected(self, t):
        pos, _ = circular_state(T_PEAK, self.beta, t)
        az, el, _ = ecef_to_aer(pos, Q.ecef_km, Q.lat_deg, Q.lon_deg)
        return az, el

    def test_sky_track_every_10s_only_when_up(self):
        track = sky_track(self.eph, Q, self.passes, T_PEAK + timedelta(seconds=30))
        self.assertIsNotNone(track)
        p = next(p for p in self.passes if abs(secs(p.t_max_el, T_PEAK)) < 60)
        self.assertEqual(track[0]["t"], p.aos)
        self.assertEqual(track[-1]["t"], p.los)                      # ปลายทางคือ LOS (เพิ่มให้เมื่อเศษไม่ลงตัวกับ 10 วินาที)
        for a, b in zip(track, track[1:-1]):
            self.assertEqual(secs(b["t"], a["t"]), 10.0)
        self.assertLessEqual(secs(track[-1]["t"], track[-2]["t"]), 10.0)
        self.assertGreater(secs(track[-1]["t"], track[-2]["t"]), 0.0)
        self.assertEqual(len(track), math.floor(secs(p.los, p.aos) / 10.0) + 1 + 1)
        for pt in track:
            self.assertEqual(set(pt), {"t", "az", "el"})
            az, el = self.expected(pt["t"])
            self.assertAlmostEqual(pt["el"], el, delta=1e-3)
            self.assertAlmostEqual((pt["az"] - az + 180.0) % 360.0 - 180.0, 0.0, delta=1e-3)
            self.assertGreater(pt["el"], -0.01)                      # AOS/LOS แม่นถึง 0.1 วินาที: El ที่ปลายห่างศูนย์ไม่เกินเศษขององศา
        self.assertAlmostEqual(max(pt["el"] for pt in track), p.max_el, delta=0.5)

    def test_sky_track_is_none_when_below_horizon(self):
        t = T_PEAK + timedelta(seconds=PERIOD_S / 2.0)
        self.assertIsNone(sky_track(self.eph, Q, self.passes, t))
        # El(t) < 0 หลัง LOS เล็กน้อย
        p = next(p for p in self.passes if abs(secs(p.t_max_el, T_PEAK)) < 60)
        self.assertIsNone(sky_track(self.eph, Q, self.passes, p.los + timedelta(seconds=5)))

    def test_sky_track_is_none_outside_usable_range_or_without_passes(self):
        self.assertIsNone(sky_track(self.eph, Q, self.passes, WINDOW_START + timedelta(seconds=30)))
        self.assertIsNone(sky_track(self.eph, Q, [], T_PEAK))

    def test_pass_cut_by_window_start_begins_at_first_usable_time(self):
        eph = circular_ephem(WINDOW_START + timedelta(seconds=100), 0.0)
        passes = find_passes(eph, Q)
        track = sky_track(eph, Q, passes, USABLE_START)
        self.assertEqual(track[0]["t"], USABLE_START)
        self.assertEqual(track[-1]["t"], passes[0].los)

    def test_pass_cut_by_window_end_stops_at_last_usable_time(self):
        eph = circular_ephem(WINDOW_STOP - timedelta(seconds=100), 0.0)
        passes = find_passes(eph, Q)
        track = sky_track(eph, Q, passes, USABLE_STOP)
        self.assertEqual(track[0]["t"], passes[-1].aos)
        self.assertEqual(track[-1]["t"], USABLE_STOP)

    def test_always_visible_satellite_covers_the_whole_usable_range(self):
        eph = fixed_ephem((7000.0, 0.0, 0.0))
        passes = find_passes(eph, Q)
        track = sky_track(eph, Q, passes, WINDOW_START + timedelta(hours=8))
        self.assertEqual(track[0]["t"], USABLE_START)
        self.assertEqual(track[-1]["t"], USABLE_STOP)
        self.assertEqual(len(track), int(secs(USABLE_STOP, USABLE_START) / 10.0) + 1)
        self.assertTrue(all(abs(pt["el"] - 90.0) < 1e-6 for pt in track))


if __name__ == "__main__":
    unittest.main()
