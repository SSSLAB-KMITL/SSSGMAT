import math
import unittest
from dataclasses import FrozenInstanceError
from datetime import timedelta

from gpredict_web.passes import Pass, find_passes, next_events
from gnss_predict.geometry import ecef_to_aer
from tests.helpers import (
    PERIOD_S, R_ORBIT_KM, WGS84_A, WINDOW_HOURS, WINDOW_START, W_RAD_S, circular_ephem, fixed_ephem, half_pass_s,
    origin_qth, window_times,
)

WINDOW_STOP = WINDOW_START + timedelta(hours=WINDOW_HOURS)
USABLE_START = WINDOW_START + timedelta(seconds=150)          # ใช้ interpolate ได้ตั้งแต่ start + 5 ตัวอย่าง
USABLE_STOP = WINDOW_STOP - timedelta(seconds=150)
T_PEAK = WINDOW_START + timedelta(hours=8, seconds=7)         # ไม่ตรงตัวอย่าง (ตัวอย่างอยู่ที่ทวีคูณของ 30 วินาที)
Q = origin_qth()


def secs(a, b) -> float:
    return (a - b).total_seconds()


def pass_near(passes, t, within_s=60.0):
    found = [p for p in passes if abs(secs(p.t_max_el, t)) < within_s]
    assert len(found) == 1, f"ต้องเจอ pass เดียวใกล้ {t} ได้ {len(found)}"
    return found[0]


class ClosedFormPassTest(unittest.TestCase):
    def test_aos_los_match_closed_form(self):
        half = half_pass_s(0.0)
        self.assertAlmostEqual(half, math.acos(WGS84_A / R_ORBIT_KM) / W_RAD_S, places=9)
        passes = find_passes(circular_ephem(T_PEAK, 0.0), Q)
        # จุดใกล้สุดทุก 5828.5 วินาทีจากต้นช่วง 28807 วินาที: k = −4..4 ได้ 9 pass; k = −5 และ k = 5 จบหรือเริ่มภายใน 150 วินาทีแรก/สุดท้าย
        self.assertEqual(len(passes), 9)
        for k in range(-4, 5):
            p = pass_near(passes, T_PEAK + timedelta(seconds=k * PERIOD_S))
            t_peak = T_PEAK + timedelta(seconds=k * PERIOD_S)
            self.assertLessEqual(abs(secs(p.aos, t_peak) + half), 0.1, f"AOS k={k}")
            self.assertLessEqual(abs(secs(p.los, t_peak) - half), 0.1, f"LOS k={k}")
            self.assertAlmostEqual(p.max_el, 90.0, delta=0.1)
            self.assertLess(abs(secs(p.t_max_el, t_peak)), 0.2)
        self.assertEqual([p.t_max_el for p in passes], sorted(p.t_max_el for p in passes))

    def test_max_el_and_time_of_an_inclined_pass(self):
        beta = 10.0
        passes = find_passes(circular_ephem(T_PEAK, beta), Q)
        p = pass_near(passes, T_PEAK)
        expected = math.degrees(math.atan2(R_ORBIT_KM * math.cos(math.radians(beta)) - WGS84_A,
                                           R_ORBIT_KM * math.sin(math.radians(beta))))
        self.assertAlmostEqual(p.max_el, expected, delta=0.02)
        self.assertLess(abs(secs(p.t_max_el, T_PEAK)), 0.5)
        half = half_pass_s(beta)
        self.assertLessEqual(abs(secs(p.aos, T_PEAK) + half), 0.1)
        self.assertLessEqual(abs(secs(p.los, T_PEAK) - half), 0.1)

    def test_short_pass_between_samples(self):
        beta = 24.32
        t_peak = WINDOW_START + timedelta(hours=8, seconds=15)         # กลางระหว่างตัวอย่างสองตัว
        eph = circular_ephem(t_peak, beta)
        near = [ecef_to_aer(p, Q.ecef_km, Q.lat_deg, Q.lon_deg)[1] for t, p in zip(eph.times, eph.pos)
                if abs(secs(t, t_peak)) < 100]
        self.assertLess(max(near), 0.0, "ตัวอย่างรอบ pass นี้ต้องใต้ขอบฟ้าทั้งหมด มิฉะนั้นไม่ได้ทดสอบ pass สั้นระหว่างตัวอย่าง")
        expected = 2.0 * half_pass_s(beta)
        self.assertTrue(10.0 < expected < 30.0, expected)
        passes = find_passes(eph, Q)
        p = pass_near(passes, t_peak)
        self.assertAlmostEqual(secs(p.los, p.aos), expected, delta=0.5)
        self.assertAlmostEqual(secs(p.aos, t_peak), -expected / 2.0, delta=0.1)
        self.assertGreater(p.max_el, 0.0)
        self.assertLess(p.max_el, 0.1)
        # pass อื่นของวงเดียวกันตกคนละเฟสกับตัวอย่าง (บางอันมีตัวอย่างอยู่ข้างใน) ทุกอันต้องยาวเท่ากัน
        self.assertEqual(len(passes), 9)
        for p in passes:
            self.assertAlmostEqual(secs(p.los, p.aos), expected, delta=0.5)

    def test_short_pass_beside_unusable_margin_is_skipped(self):
        # ตัวอย่างข้างเคียงของจุด local max ตกในขอบ 150 วินาที: ไม่มีค่า interpolate จึงไม่ตรวจ (ช่วงที่ซ้อนกันจะเจอเอง) และต้องไม่ล้ม
        half = half_pass_s(24.32)
        for t_peak in (WINDOW_START + timedelta(seconds=164), WINDOW_STOP - timedelta(seconds=164)):
            passes = find_passes(circular_ephem(t_peak, 24.32), Q)
            self.assertFalse([p for p in passes if abs(secs(p.t_max_el, t_peak)) < half], t_peak)

    def test_near_miss_between_samples_is_not_a_pass(self):
        # จุดสูงสุดจริงใต้ขอบฟ้า (x = 7000·cos 24.5° < 6378.137) แต่ตัวอย่างข้างๆ อยู่ระหว่าง −2° ถึง 0°
        eph = circular_ephem(WINDOW_START + timedelta(hours=8, seconds=15), 24.5)
        elevations = [ecef_to_aer(p, Q.ecef_km, Q.lat_deg, Q.lon_deg)[1] for p in eph.pos]
        self.assertTrue(-2.0 < max(elevations) < 0.0)
        self.assertEqual(find_passes(eph, Q), [])

    def test_bisection_is_independent_of_sample_phase(self):
        half = half_pass_s(0.0)
        for offset in (0.0, 0.4, 14.9, 29.7):
            t_peak = WINDOW_START + timedelta(hours=8, seconds=offset)
            p = pass_near(find_passes(circular_ephem(t_peak, 0.0), Q), t_peak)
            self.assertLessEqual(abs(secs(p.aos, t_peak) + half), 0.1, offset)
            self.assertLessEqual(abs(secs(p.los, t_peak) - half), 0.1, offset)


class WindowEdgeTest(unittest.TestCase):
    def test_pass_cut_by_window_has_none(self):
        half = half_pass_s(0.0)
        t_peak = WINDOW_START + timedelta(seconds=100)             # AOS ก่อนต้นช่วง
        passes = find_passes(circular_ephem(t_peak, 0.0), Q)
        first = passes[0]
        self.assertIsNone(first.aos)
        self.assertLessEqual(abs(secs(first.los, t_peak) - half), 0.1)
        self.assertTrue(all(p.aos is not None and p.los is not None for p in passes[1:]))

        t_peak = WINDOW_STOP - timedelta(seconds=100)              # LOS หลังท้ายช่วง
        passes = find_passes(circular_ephem(t_peak, 0.0), Q)
        last = passes[-1]
        self.assertIsNone(last.los)
        self.assertLessEqual(abs(secs(last.aos, t_peak) + half), 0.1)
        self.assertTrue(all(p.aos is not None and p.los is not None for p in passes[:-1]))

    def test_crossing_inside_unusable_margin_is_unknown(self):
        half = half_pass_s(0.0)
        for crossing_s, known in ((100.0, False), (140.0, False), (170.0, True), (200.0, True)):
            t_peak = WINDOW_START + timedelta(seconds=crossing_s + half)
            first = find_passes(circular_ephem(t_peak, 0.0), Q)[0]
            if known:
                self.assertLessEqual(abs(secs(first.aos, WINDOW_START) - crossing_s), 0.1, crossing_s)
            else:
                self.assertIsNone(first.aos, crossing_s)
            self.assertLessEqual(abs(secs(first.los, t_peak) - half), 0.1)

    def test_los_inside_unusable_margin_is_unknown(self):
        half = half_pass_s(0.0)
        for crossing_s, known in ((100.0, False), (140.0, False), (170.0, True), (200.0, True)):
            t_peak = WINDOW_STOP - timedelta(seconds=crossing_s + half)
            last = find_passes(circular_ephem(t_peak, 0.0), Q)[-1]
            if known:
                self.assertLessEqual(abs(secs(WINDOW_STOP, last.los) - crossing_s), 0.1, crossing_s)
            else:
                self.assertIsNone(last.los, crossing_s)
            self.assertLessEqual(abs(secs(last.aos, t_peak) + half), 0.1)

    def test_pass_wholly_inside_unusable_margin_is_dropped(self):
        half = half_pass_s(0.0)
        # LOS ที่ +60 s: ส่วนที่อยู่เหนือขอบฟ้าอยู่ในขอบ 150 วินาทีแรกทั้งหมด ไม่มีช่วงที่ interpolate ได้
        passes = find_passes(circular_ephem(WINDOW_START + timedelta(seconds=60 - half), 0.0), Q)
        self.assertGreater(passes[0].t_max_el, USABLE_START)
        self.assertIsNotNone(passes[0].aos)
        # AOS ที่ stop − 60 s: อยู่ในขอบท้ายทั้งหมด
        passes = find_passes(circular_ephem(WINDOW_STOP - timedelta(seconds=60 - half), 0.0), Q)
        self.assertLess(passes[-1].t_max_el, USABLE_STOP)
        self.assertIsNotNone(passes[-1].los)

    def test_window_shorter_than_two_margins_has_no_usable_range(self):
        eph = circular_ephem(T_PEAK, 0.0, times=window_times()[:10])
        self.assertEqual(find_passes(eph, Q), [])


class AlwaysTest(unittest.TestCase):
    def test_always_in_and_out(self):
        above = fixed_ephem((R_ORBIT_KM, 0.0, 0.0))
        passes = find_passes(above, Q)
        self.assertEqual(len(passes), 1)
        self.assertIsNone(passes[0].aos)
        self.assertIsNone(passes[0].los)
        self.assertAlmostEqual(passes[0].max_el, 90.0, places=6)
        t = WINDOW_START + timedelta(hours=8)
        self.assertEqual(next_events(passes, above, Q, t), (None, None, "in"))

        below = fixed_ephem((-R_ORBIT_KM, 0.0, 0.0))
        passes = find_passes(below, Q)
        self.assertEqual(passes, [])
        self.assertEqual(next_events(passes, below, Q, t), (None, None, "out"))

    def test_always_is_none_when_time_is_outside_usable_range(self):
        above = fixed_ephem((R_ORBIT_KM, 0.0, 0.0))
        passes = find_passes(above, Q)
        self.assertEqual(next_events(passes, above, Q, WINDOW_START + timedelta(seconds=60)), (None, None, None))
        self.assertEqual(next_events(passes, above, Q, WINDOW_STOP + timedelta(hours=1)), (None, None, None))

    def test_always_is_none_when_any_edge_is_known(self):
        eph = circular_ephem(T_PEAK, 0.0)
        passes = find_passes(eph, Q)
        for t in (T_PEAK, T_PEAK + timedelta(seconds=PERIOD_S / 2.0)):
            self.assertIsNone(next_events(passes, eph, Q, t)[2])


class NextEventsTest(unittest.TestCase):
    def setUp(self):
        self.eph = circular_ephem(T_PEAK, 0.0)
        self.passes = find_passes(self.eph, Q)
        self.half = half_pass_s(0.0)

    def peak(self, k):
        return T_PEAK + timedelta(seconds=k * PERIOD_S)

    def test_inside_a_pass(self):
        t = self.peak(0) + timedelta(seconds=20)
        aos, los, always = next_events(self.passes, self.eph, Q, t)
        self.assertLessEqual(abs(secs(aos, self.peak(1)) + self.half), 0.1)         # AOS ของ pass ถัดไป
        self.assertLessEqual(abs(secs(los, self.peak(0)) - self.half), 0.1)         # LOS ของ pass ปัจจุบัน
        self.assertIsNone(always)

    def test_between_passes(self):
        t = self.peak(0) + timedelta(seconds=PERIOD_S / 2.0)
        aos, los, always = next_events(self.passes, self.eph, Q, t)
        self.assertLessEqual(abs(secs(aos, self.peak(1)) + self.half), 0.1)
        self.assertLessEqual(abs(secs(los, self.peak(1)) - self.half), 0.1)         # LOS ของ pass ถัดไป
        self.assertIsNone(always)

    def test_next_aos_is_strictly_after_t(self):
        p = pass_near(self.passes, self.peak(1))
        aos, los, _ = next_events(self.passes, self.eph, Q, p.aos)
        self.assertEqual(los, p.los)                                                # ที่ t = AOS อยู่ใน pass นั้นแล้ว
        self.assertGreater(aos, p.los)                                              # AOS ถัดไปเป็นของ pass หลังจากนั้น

    def test_last_pass_of_window_has_no_next_aos(self):
        t = self.peak(4) + timedelta(seconds=20)
        aos, los, always = next_events(self.passes, self.eph, Q, t)
        self.assertIsNone(aos)
        self.assertLessEqual(abs(secs(los, self.peak(4)) - self.half), 0.1)
        self.assertIsNone(always)

    def test_after_the_last_pass_has_nothing(self):
        t = self.peak(4) + timedelta(seconds=PERIOD_S / 2.0)
        self.assertEqual(next_events(self.passes, self.eph, Q, t)[:2], (None, None))

    def test_pass_cut_at_window_start_reports_its_los(self):
        eph = circular_ephem(WINDOW_START + timedelta(seconds=100), 0.0)
        passes = find_passes(eph, Q)
        t = USABLE_START
        aos, los, always = next_events(passes, eph, Q, t)
        self.assertEqual(los, passes[0].los)
        self.assertEqual(aos, passes[1].aos)
        self.assertIsNone(always)

    def test_pass_cut_at_window_end_has_unknown_los(self):
        eph = circular_ephem(WINDOW_STOP - timedelta(seconds=100), 0.0)
        passes = find_passes(eph, Q)
        t = USABLE_STOP
        self.assertEqual(next_events(passes, eph, Q, t), (None, None, None))

    def test_pass_is_a_frozen_dataclass(self):
        p = Pass(None, None, 1.0, T_PEAK)
        with self.assertRaises(FrozenInstanceError):
            p.max_el = 2.0


if __name__ == "__main__":
    unittest.main()
