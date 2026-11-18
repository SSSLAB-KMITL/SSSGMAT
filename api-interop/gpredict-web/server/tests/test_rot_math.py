"""rot.py ส่วนบริสุทธิ์: set-point (ref-R §6.2), flip pass (§6.3), ตรวจ Threshold และ lead-ahead (§6.4), กติกาเปลี่ยน pass (§6.5)
และข้อความคำสั่ง/คำตอบของ rotctld (§7) ไม่มี I/O"""

import locale
import unittest
from datetime import datetime, timedelta, timezone

from gpredict_web.hwconf import RotConf
from gpredict_web.pass_predict import PassData
from gpredict_web.rot import (
    CMD_GET_POS, CMD_STOP, LEAD_DEFAULT, NO_PASS_SETPOINT, QTH_MOVE_KM, adjust, clamp_to, cmd_set_pos, is_flip_pass,
    lead_ahead, move_due, parse_pos, parse_rprt, pass_needs_refresh, setpoint, wrap360, wrap_into,
)

T0 = datetime(2026, 11, 14, 12, 0, 0, tzinfo=timezone.utc)


def at(seconds: float) -> datetime:
    return T0 + timedelta(seconds=seconds)


def conf(**fields) -> RotConf:
    return RotConf(name="Test rotator", host="localhost", port=4533, **fields)


# type 1 (−180…+180): เหมือน rotator ที่ rotctld รายงาน Az ติดลบ
CONF_180 = dict(az_type=1, min_az=-180.0, max_az=180.0, az_stop=-180.0)


def make_pass(aos_s: float = 600.0, los_s: float = 1200.0, aos_az: float = 100.0, los_az: float = 250.0) -> PassData:
    return PassData(orbit=1, aos=at(aos_s), tca=at((aos_s + los_s) / 2), los=at(los_s), max_el=40.0, aos_az=aos_az,
                    max_el_az=180.0, los_az=los_az, vis="V", rows=[])


class WrapTest(unittest.TestCase):
    def test_wrap_into_half_open_window(self):
        self.assertEqual(wrap_into(10.0, 0.0), 10.0)
        self.assertEqual(wrap_into(370.0, 0.0), 10.0)
        self.assertEqual(wrap_into(-10.0, 0.0), 350.0)
        self.assertEqual(wrap_into(360.0, 0.0), 0.0)                       # ขอบบนเปิด
        self.assertEqual(wrap_into(190.0, -180.0), -170.0)
        self.assertEqual(wrap_into(-180.0, -180.0), -180.0)
        self.assertEqual(wrap_into(180.0, -180.0), -180.0)
        self.assertEqual(wrap_into(-720.5, 0.0), 359.5)
        self.assertEqual(wrap_into(170.3, -180.0), 170.3)                  # ค่าที่อยู่ในช่วงแล้วไม่ถูกแตะ (ไม่มี error ปัดเศษ)
        # ค่าติดลบเล็กมากห่อแล้วต้องไม่ได้ lo + 360 พอดี (ออกนอก [lo, lo + 360))
        for az in (-1e-20, -1e-300, 360.0 - 1e-14):
            self.assertLess(wrap_into(az, 0.0), 360.0)
            self.assertGreaterEqual(wrap_into(az, 0.0), 0.0)

    def test_wrap360(self):
        self.assertEqual(wrap360(-90.0), 270.0)
        self.assertEqual(wrap360(450.0), 90.0)
        self.assertEqual(wrap360(0.0), 0.0)
        self.assertEqual(wrap360(360.0), 0.0)


class SetpointTest(unittest.TestCase):
    KNOBS = (123.0, 17.0)

    def test_setpoint_above_horizon_clamped(self):
        c = conf(max_el=90.0)
        self.assertEqual(setpoint(T0, (350.0, 95.0), None, c, False, self.KNOBS, True), (350.0, 90.0))
        self.assertEqual(setpoint(T0, (20.0, 30.0), None, conf(min_az=30.0), False, self.KNOBS, True), (30.0, 30.0))
        self.assertEqual(setpoint(T0, (20.0, 5.0), None, conf(min_el=10.0), False, self.KNOBS, True), (20.0, 10.0))
        self.assertEqual(setpoint(T0, (200.0, 30.0), None, conf(max_az=180.0), False, self.KNOBS, True), (180.0, 30.0))
        self.assertEqual(setpoint(T0, (100.0, 0.0), None, c, False, self.KNOBS, True), (100.0, 0.0))   # El = 0 ยังเหนือขอบฟ้า

    def test_setpoint_before_aos_and_after_los(self):
        p = make_pass(aos_az=100.0, los_az=250.0)
        c = conf()
        # ใต้ขอบฟ้า ก่อน AOS: ไปรอที่ Az ของ AOS ที่ El 0; หลัง LOS: Az ของ LOS
        self.assertEqual(setpoint(at(0), (0.0, -10.0), p, c, False, self.KNOBS, True), (100.0, 0.0))
        self.assertEqual(setpoint(at(1800), (0.0, -10.0), p, c, False, self.KNOBS, True), (250.0, 0.0))
        # ทั้งสองกรณีถูก clamp
        self.assertEqual(setpoint(at(0), (0.0, -10.0), p, conf(min_az=120.0, min_el=5.0), False, self.KNOBS, True),
                         (120.0, 5.0))
        self.assertEqual(setpoint(at(1800), (0.0, -10.0), p, conf(max_az=200.0), False, self.KNOBS, True), (200.0, 0.0))

    def test_setpoint_no_pass_is_0_45(self):
        c = conf(min_el=10.0, min_az=30.0, max_az=90.0)
        self.assertEqual(NO_PASS_SETPOINT, (0.0, 45.0))
        # ไม่มี pass: ไม่ clamp แม้ MinEl 10 และ MinAz 30 (ตามที่ Gpredict ทำ, spec §9.2)
        self.assertEqual(setpoint(T0, (200.0, -3.0), None, c, False, self.KNOBS, True), (0.0, 45.0))
        # อยู่ในช่วง pass ที่เก็บไว้แต่ดาวยังอยู่ใต้ขอบฟ้า: ค่าเดียวกัน
        self.assertEqual(setpoint(at(900), (200.0, -3.0), make_pass(), c, False, self.KNOBS, True), (0.0, 45.0))
        # ขอบของช่วง pass นับว่าอยู่ในช่วง (t < AOS และ t > LOS เท่านั้นที่ไปรอที่ขอบฟ้า)
        self.assertEqual(setpoint(at(600), (200.0, -3.0), make_pass(), c, False, self.KNOBS, True), (0.0, 45.0))
        self.assertEqual(setpoint(at(1200), (200.0, -3.0), make_pass(), c, False, self.KNOBS, True), (0.0, 45.0))

    def test_setpoint_track_off_is_knobs(self):
        c = conf()
        self.assertEqual(setpoint(T0, (200.0, 30.0), None, c, False, self.KNOBS, False), self.KNOBS)
        # Track เปิดแต่ไม่มีดาวเป้าหมาย: ก็ใช้ค่าของปุ่มหมุน (ref-R §6.2 else-branch)
        self.assertEqual(setpoint(T0, None, None, c, False, self.KNOBS, True), self.KNOBS)
        # ค่าของปุ่มหมุนไม่ถูกแปลงใดๆ (ปุ่มจำกัดช่วงตามอุปกรณ์อยู่แล้ว)
        self.assertEqual(setpoint(T0, (200.0, 30.0), None, conf(max_el=180.0), True, (300.0, 100.0), False), (300.0, 100.0))

    def test_minus180_type(self):
        c = conf(**CONF_180)
        # Az 270 → −90 ไม่ใช่ 180 (decision 9: แปลงเป็น −180…+180 ก่อน clamp)
        self.assertEqual(setpoint(T0, (270.0, 30.0), None, c, False, self.KNOBS, True), (-90.0, 30.0))
        self.assertEqual(setpoint(T0, (350.0, 30.0), None, c, False, self.KNOBS, True), (-10.0, 30.0))
        self.assertEqual(setpoint(T0, (180.0, 30.0), None, c, False, self.KNOBS, True), (180.0, 30.0))
        self.assertEqual(setpoint(T0, (90.0, 30.0), None, c, False, self.KNOBS, True), (90.0, 30.0))
        # ก่อน AOS / หลัง LOS ก็ผ่านการแปลงเดียวกัน
        self.assertEqual(setpoint(at(0), (0.0, -5.0), make_pass(aos_az=300.0), c, False, self.KNOBS, True), (-60.0, 0.0))

    def test_setpoint_flip_then_wrap_then_clamp(self):
        # flip ก่อน clamp: target (20, 30), MinAz 30, flip + MaxEl 180 → flip ได้ 200 (ไม่ใช่ clamp เป็น 30 ก่อนแล้ว flip เป็น 210)
        c = conf(min_az=30.0, max_el=180.0)
        self.assertEqual(setpoint(T0, (20.0, 30.0), None, c, True, self.KNOBS, True), (200.0, 150.0))
        # El หลัง flip ยัง clamp เข้า [MinEl, MaxEl]
        self.assertEqual(setpoint(T0, (20.0, 0.0), None, conf(max_el=180.0, min_el=10.0), True, self.KNOBS, True),
                         (200.0, 180.0))
        # flip ไม่ทำงานเมื่อ MaxEl < 180 แม้ pass จะ flip
        self.assertEqual(setpoint(T0, (20.0, 30.0), None, conf(max_el=90.0), True, self.KNOBS, True), (20.0, 30.0))
        # no-pass default ผ่าน flip เหมือน Gpredict (ไม่ clamp) → ทิศเดียวกันทางกายภาพ
        self.assertEqual(setpoint(at(900), (200.0, -3.0), make_pass(), conf(max_el=180.0), True, self.KNOBS, True),
                         (180.0, 135.0))


class AdjustTest(unittest.TestCase):
    def test_flip_applied_only_with_max_el_180(self):
        self.assertEqual(adjust(10.0, 30.0, conf(max_el=180.0), True), (190.0, 150.0))
        self.assertEqual(adjust(200.0, 30.0, conf(max_el=180.0), True), (20.0, 150.0))
        self.assertEqual(adjust(180.0, 30.0, conf(max_el=180.0), True), (360.0, 150.0))    # "> 180" เท่านั้นที่ลบ
        self.assertEqual(adjust(10.0, 30.0, conf(max_el=90.0), True), (10.0, 30.0))
        self.assertEqual(adjust(10.0, 30.0, conf(max_el=179.9), True), (10.0, 30.0))
        self.assertEqual(adjust(10.0, 30.0, conf(max_el=180.0), False), (10.0, 30.0))

    def test_flip_wraps_into_az_limits(self):
        # Az หลัง ±180 ห่อทีละ 360 เข้า [MinAz, MaxAz] ก่อน (ref-R §6.2 แถว Flip pass)
        self.assertEqual(adjust(10.0, 30.0, conf(max_el=180.0, min_az=-180.0, max_az=180.0), True), (-170.0, 150.0))
        self.assertEqual(adjust(100.0, 30.0, conf(max_el=180.0, min_az=-90.0, max_az=270.0), True), (-80.0, 150.0))
        self.assertEqual(adjust(100.0, 30.0, conf(max_el=180.0, min_az=0.0, max_az=450.0), True), (280.0, 150.0))
        # type 1 (−180…+180): 100 + 180 = 280 → ห่อเป็น −80
        self.assertEqual(adjust(100.0, 30.0, conf(max_el=180.0, **CONF_180), True), (-80.0, 150.0))
        # ขอบบนของช่วงไม่ถูกห่อ (Gpredict วน while az > max)
        self.assertEqual(adjust(0.0, 30.0, conf(max_el=180.0), True), (180.0, 150.0))
        self.assertEqual(adjust(10.0, 30.0, conf(max_el=180.0, min_az=-180.0, max_az=190.0), True), (190.0, 150.0))

    def test_type_1_subtracts_360_above_180(self):
        c = conf(**CONF_180)
        self.assertEqual(adjust(270.0, 10.0, c, False), (-90.0, 10.0))
        self.assertEqual(adjust(180.0, 10.0, c, False), (180.0, 10.0))
        self.assertEqual(adjust(181.0, 10.0, c, False), (-179.0, 10.0))
        self.assertEqual(adjust(270.0, 10.0, conf(), False), (270.0, 10.0))               # type 0 ไม่แปลง

    def test_wrap_terminates_for_narrow_range(self):
        # MaxAz − MinAz < 360: ห่อลงเข้า MaxAz แล้วขึ้นเข้า MinAz สองรอบแยกกันเหมือน Gpredict (จบเสมอ ไม่วนไม่รู้จบ)
        # ค่าที่ออกนอกช่วงถูก clamp ต่อด้วย clamp_to: 100 + 180 = 280 → −80 → 280
        c = conf(max_el=180.0, min_az=0.0, max_az=270.0)
        self.assertEqual(adjust(100.0, 30.0, c, True), (280.0, 150.0))
        self.assertEqual(clamp_to(280.0, 150.0, c), (270.0, 150.0))

    def test_clamp_to(self):
        c = conf(min_az=10.0, max_az=350.0, min_el=5.0, max_el=85.0)
        self.assertEqual(clamp_to(0.0, 0.0, c), (10.0, 5.0))
        self.assertEqual(clamp_to(360.0, 90.0, c), (350.0, 85.0))
        self.assertEqual(clamp_to(180.0, 45.0, c), (180.0, 45.0))
        self.assertEqual(clamp_to(10.0, 85.0, c), (10.0, 85.0))


class FlipPassTest(unittest.TestCase):
    def test_flip_detection(self):
        c0 = conf(az_type=0, az_stop=0.0)
        self.assertTrue(is_flip_pass([350.0, 10.0, 30.0], c0))               # ข้ามทิศเหนือ: ถ้าตามต่อ Az ต้องวิ่งย้อนผ่านปลาย stop
        self.assertFalse(is_flip_pass([100.0, 150.0, 200.0], c0))
        c1 = conf(az_type=1, az_stop=-180.0)
        self.assertTrue(is_flip_pass([170.0, -170.0], c1))                   # −170 = 190: วิ่งข้าม ±180
        self.assertTrue(is_flip_pass([170.0, 190.0], c1))                    # ห่อ 190 เป็น −170 ก่อนเทียบ
        self.assertFalse(is_flip_pass([-170.0, -100.0, 0.0, 100.0], c1))

    def test_flip_window_shifted_by_az_stop(self):
        # หน้าต่าง [az_stop, az_stop + 360]: stop ที่ 180 ทำให้ 350 → 10 (= 370) ไม่ข้ามปลาย
        self.assertFalse(is_flip_pass([350.0, 10.0, 30.0], conf(az_type=0, az_stop=180.0)))
        self.assertTrue(is_flip_pass([350.0, 10.0, 30.0], conf(az_type=0, az_stop=0.0)))
        self.assertFalse(is_flip_pass([350.0, 10.0, 30.0], conf(az_type=0, az_stop=90.0)))
        # type 1 ที่ stop 0: หน้าต่าง [−180, 180] เลื่อน (0 − (−180)) = [0, 360] เหมือน type 0
        self.assertTrue(is_flip_pass([350.0, 10.0], conf(az_type=1, az_stop=0.0)))
        self.assertFalse(is_flip_pass([350.0, 10.0], conf(az_type=1, az_stop=-90.0)))

    def test_flip_threshold_is_more_than_180(self):
        c0 = conf()
        self.assertFalse(is_flip_pass([0.0, 180.0], c0))                      # ต่างกันพอดี 180 ยังไม่ flip
        self.assertTrue(is_flip_pass([0.0, 180.5], c0))
        self.assertFalse(is_flip_pass([], c0))
        self.assertFalse(is_flip_pass([123.0], c0))

    def test_flip_window_upper_end_is_inclusive(self):
        # Gpredict ห่อด้วย while az > max → az == max อยู่ที่ max (ไม่ถูกห่อเป็น min)
        self.assertFalse(is_flip_pass([350.0, 360.0], conf()))
        self.assertTrue(is_flip_pass([360.0, 10.0], conf()))

    def test_flip_checks_every_consecutive_pair(self):
        c0 = conf()
        self.assertTrue(is_flip_pass([100.0, 150.0, 200.0, 350.0, 20.0, 30.0], c0))
        self.assertFalse(is_flip_pass([100.0, 150.0, 200.0, 250.0, 300.0, 350.0], c0))
        # ค่าที่ออกนอกหน้าต่างถูกห่อก่อนเทียบ: −10 → 350 จึงห่างจาก 10 ถึง 340
        self.assertTrue(is_flip_pass([-10.0, 10.0], c0))
        self.assertFalse(is_flip_pass([350.0, 370.0, 390.0], conf(az_stop=180.0)))


class MoveDueTest(unittest.TestCase):
    def test_move_due_same_frame(self):
        # type 1: setp (−90, 30) เทียบกับค่าที่อ่านในหน่วยเดียวกัน (spec §9.1 ข้อ 13, decision 10)
        self.assertFalse(move_due((-90.0, 30.0), (-90.02, 30.01), 0.1))
        self.assertTrue(move_due((-90.0, 30.0), (-80.0, 30.0), 0.1))
        # ค่าที่อ่านต้องไม่ถูกห่อ 0–360 ก่อนเทียบ (−90 กับ 270 คือคนละค่าในหน่วยของอุปกรณ์)
        self.assertTrue(move_due((-90.0, 30.0), (270.0, 30.0), 0.1))

    def test_move_due_is_strictly_greater_than_threshold(self):
        self.assertFalse(move_due((10.0, 10.0), (10.5, 10.0), 0.5))
        self.assertFalse(move_due((10.0, 10.0), (9.5, 10.5), 0.5))
        self.assertTrue(move_due((10.0, 10.0), (10.51, 10.0), 0.5))
        self.assertTrue(move_due((10.0, 10.0), (10.0, 10.6), 0.5))         # El เกินอย่างเดียวก็ต้องสั่ง
        self.assertTrue(move_due((10.0, 10.0), (10.0, 9.4), 0.5))
        self.assertFalse(move_due((10.0, 10.0), (10.0, 10.0), 0.0))


class LeadAheadTest(unittest.TestCase):
    """predict ของ test เป็นเส้นตรงตามเวลา จึงรู้เวลาของผลจากค่า Az ที่ได้"""

    @staticmethod
    def linear(az0: float = 100.0, az_rate: float = 0.1, el0: float = 30.0, el_rate: float = 0.0):
        queried: list[float] = []

        def predict(t: datetime):
            s = (t - T0).total_seconds()
            queried.append(s)
            return az0 + az_rate * s, el0 + el_rate * s

        return predict, queried

    def test_lead_ahead(self):
        predict, _ = self.linear()
        setp = (100.0, 30.0)
        az, el = lead_ahead(T0, at(600), 1.0, 5.0, setp, predict, conf(), False)
        self.assertLessEqual(abs(az - setp[0]), 5.0)
        self.assertEqual(el, 30.0)
        # ค้นละเอียดถึง cycle/4: ผลอยู่ใกล้ขอบของ tolerance ไม่ใช่แค่ไกลกว่า setp เล็กน้อย
        t_result = (az - 100.0) / 0.1
        self.assertGreater(predict(at(t_result + 1.0))[0] - setp[0], 5.0 - 0.1)
        self.assertGreater(az - setp[0], 4.8)

    def test_lead_ahead_never_looks_past_los(self):
        predict, queried = self.linear(az_rate=0.001)                      # ช้ามาก ไม่เคยเกิน tolerance
        az, _ = lead_ahead(T0, at(600), 1.0, 5.0, (100.0, 30.0), predict, conf(), False)
        self.assertLessEqual(max(queried), 600.0)
        self.assertGreater(max(queried), 599.0)
        self.assertAlmostEqual(az, 100.0 + 0.001 * max(queried), delta=0.001)

    def test_lead_ahead_stops_at_horizon(self):
        queried: list[float] = []

        def predict(t: datetime):
            s = (t - T0).total_seconds()
            queried.append(s)
            return 100.0 + 0.01 * s, (30.0 if s <= 30.0 else -1.0)         # ตกขอบฟ้าที่ t + 30 s

        az, el = lead_ahead(T0, at(600), 1.0, 5.0, (100.0, 30.0), predict, conf(), False)
        t_result = (az - 100.0) / 0.01
        self.assertLessEqual(t_result, 30.0)
        self.assertGreater(t_result, 29.0)
        self.assertEqual(el, 30.0)

    def test_lead_ahead_stops_when_ephemeris_ends(self):
        def predict(t: datetime):
            s = (t - T0).total_seconds()
            return None if s > 30.0 else (100.0 + 0.01 * s, 30.0)          # ephemeris หมดที่ t + 30 s

        az, _ = lead_ahead(T0, at(600), 1.0, 5.0, (100.0, 30.0), predict, conf(), False)
        self.assertLessEqual((az - 100.0) / 0.01, 30.0)
        self.assertGreater((az - 100.0) / 0.01, 29.0)

    def test_lead_ahead_el_limit_governs(self):
        predict, _ = self.linear(az_rate=0.0, el0=30.0, el_rate=0.2)       # El ไต่ 0.2°/s: เกิน 5° ที่ 25 s
        az, el = lead_ahead(T0, at(600), 1.0, 5.0, (100.0, 30.0), predict, conf(), False)
        self.assertLessEqual(el - 30.0, 5.0)
        self.assertGreater((el - 30.0) / 0.2, 24.0)

    def test_lead_ahead_el_above_180_is_not_ok(self):
        # flip: El ที่ปรับแล้ว (180 − el) ต้องไม่เกิน 180; el ดิบ −1 ให้ 181 (threshold 50 จึงไม่ใช่ตัวกันไว้)
        c = conf(max_el=180.0)

        def predict(t: datetime):
            s = (t - T0).total_seconds()
            return 100.0, (30.0 if s <= 40.0 else -1.0)

        az, el = lead_ahead(T0, at(600), 1.0, 50.0, (280.0, 150.0), predict, c, True)
        self.assertEqual((az, el), (280.0, 150.0))                         # ถ้าไม่เช็ก ≤ 180 จะได้ (280, 181) แล้ว clamp เป็น 180

    def test_lead_ahead_applies_flip_like_setpoint(self):
        # predict ให้ค่าดิบ (az, el) ผล adjust(…, flip): (100 + 0.1 s, 30) → (280 + 0.1 s, 150)
        predict, _ = self.linear()
        c = conf(max_el=180.0)
        setp = setpoint(T0, (100.0, 30.0), None, c, True, (0.0, 0.0), True)
        self.assertEqual(setp, (280.0, 150.0))
        az, el = lead_ahead(T0, at(600), 1.0, 5.0, setp, predict, c, True)
        self.assertLessEqual(abs(az - 280.0), 5.0)
        self.assertGreater(az - 280.0, 4.8)
        self.assertEqual(el, 150.0)

    def test_lead_ahead_type_1_uses_device_frame(self):
        # Az ดิบ 269…: type 1 แปลงเป็นลบ (−91…) ผลต้องอยู่ในหน่วยเดียวกับ setp (−90)
        predict, _ = self.linear(az0=270.0)
        c = conf(**CONF_180)
        az, _ = lead_ahead(T0, at(600), 1.0, 5.0, (-90.0, 30.0), predict, c, False)
        self.assertLessEqual(abs(az - (-90.0)), 5.0)
        self.assertGreater(az, -90.0 + 4.8)

    def test_lead_ahead_result_is_clamped(self):
        predict, _ = self.linear()
        az, el = lead_ahead(T0, at(600), 1.0, 5.0, (100.0, 30.0), predict, conf(max_az=102.0, max_el=20.0), False)
        self.assertEqual((az, el), (102.0, 20.0))

    def test_lead_ahead_without_progress_returns_setpoint(self):
        # ทุกเวลาไกลเกิน tolerance (ดาวเร็วมาก): ไม่มีเวลาไหน ok ใช้ set-point เดิม
        predict, _ = self.linear(az_rate=100.0)
        self.assertEqual(lead_ahead(T0, at(600), 1.0, 5.0, (100.0, 30.0), predict, conf(), False), (100.0, 30.0))

    def test_lead_ahead_without_pass_uses_20_minutes(self):
        self.assertEqual(LEAD_DEFAULT, timedelta(days=1 / 72))
        predict, queried = self.linear(az_rate=0.0)                        # ไม่เคยเกิน tolerance
        lead_ahead(T0, None, 1.0, 5.0, (100.0, 30.0), predict, conf(), False)
        self.assertLessEqual(max(queried), 1200.0)
        self.assertGreater(max(queried), 1199.0)

    def test_lead_ahead_minimum_step_is_one_cycle(self):
        # LOS อีก 1 s แต่ cycle 2 s: step เริ่ม max(0.5, 2) = 2 s ค้นต่อได้ ไม่วนไม่รู้จบ
        predict, queried = self.linear(az_rate=0.0)
        lead_ahead(T0, at(1), 2.0, 5.0, (100.0, 30.0), predict, conf(), False)
        self.assertTrue(queried)
        self.assertLess(len(queried), 20)
        # LOS ผ่านไปแล้ว (delta ติดลบ): ก็จบได้ ไม่ค้าง
        queried.clear()
        lead_ahead(T0, at(-30), 2.0, 5.0, (100.0, 30.0), predict, conf(), False)
        self.assertLess(len(queried), 20)

    def test_lead_ahead_trial_count_is_bounded(self):
        predict, queried = self.linear()
        lead_ahead(T0, at(5400), 1.0, 5.0, (100.0, 30.0), predict, conf(), False)
        self.assertLessEqual(len(queried), 20)                             # log2(5400 / 0.25) ≈ 14


class PassRefreshTest(unittest.TestCase):
    CYCLE = 1.0

    def test_pass_needs_refresh_rules(self):
        p = make_pass(aos_s=600.0, los_s=1200.0)
        inside, outside = at(900), at(1800)

        # ไม่มี pass เก็บไว้ (เปิดหน้าต่าง / เลือกดาว): ต้องหา
        self.assertTrue(pass_needs_refresh(None, T0, -5.0, at(600), self.CYCLE, 0.0))
        self.assertTrue(pass_needs_refresh(None, T0, 30.0, None, self.CYCLE, 0.0))
        # ไม่มีดาวเป้าหมาย: ไม่มีอะไรต้องหา
        self.assertFalse(pass_needs_refresh(None, T0, None, None, self.CYCLE, 0.0))
        self.assertFalse(pass_needs_refresh(p, T0, None, None, self.CYCLE, 5.0))

        # ข้อ 1: สถานีย้ายเกิน QTH_MOVE_KM
        self.assertEqual(QTH_MOVE_KM, 1.0)
        self.assertTrue(pass_needs_refresh(p, inside, 30.0, p.aos, self.CYCLE, 1.5))
        self.assertFalse(pass_needs_refresh(p, inside, 30.0, p.aos, self.CYCLE, 0.5))
        self.assertFalse(pass_needs_refresh(p, inside, 30.0, p.aos, self.CYCLE, 1.0))     # "มากกว่า" 1.0

        # ข้อ 2: อยู่นอกช่วง pass ที่เก็บไว้ และดาวขึ้นเหนือขอบฟ้าอยู่ (pass ที่ไม่คาดไว้)
        self.assertTrue(pass_needs_refresh(p, outside, 10.0, p.aos, self.CYCLE, 0.0))
        self.assertTrue(pass_needs_refresh(p, outside, 0.0, p.aos, self.CYCLE, 0.0))      # El 0 นับว่าขึ้นแล้ว (>= 0)
        self.assertTrue(pass_needs_refresh(p, at(0), 10.0, p.aos, self.CYCLE, 0.0))        # ก่อน AOS ก็นับ
        self.assertFalse(pass_needs_refresh(p, outside, -10.0, p.aos, self.CYCLE, 0.0))

        # ข้อ 3: AOS ถัดไปของดาวช้ากว่า AOS ที่เก็บไว้เกิน Cycle/4 (ดาวยังอยู่ใต้ขอบฟ้า นอกช่วง pass)
        self.assertFalse(pass_needs_refresh(p, outside, -10.0, p.aos + timedelta(seconds=0.25), self.CYCLE, 0.0))
        self.assertTrue(pass_needs_refresh(p, outside, -10.0, p.aos + timedelta(seconds=0.3), self.CYCLE, 0.0))
        self.assertTrue(pass_needs_refresh(p, at(0), -10.0, p.aos + timedelta(minutes=95), self.CYCLE, 0.0))
        self.assertFalse(pass_needs_refresh(p, outside, -10.0, None, self.CYCLE, 0.0))
        self.assertFalse(pass_needs_refresh(p, outside, -10.0, p.aos - timedelta(seconds=5), self.CYCLE, 0.0))

        # ข้อ 4: อยู่ในช่วง pass แต่ดาวตกขอบฟ้าแล้ว
        self.assertTrue(pass_needs_refresh(p, inside, -0.5, p.aos, self.CYCLE, 0.0))
        self.assertFalse(pass_needs_refresh(p, inside, 0.0, p.aos, self.CYCLE, 0.0))      # El 0 ยังไม่ใต้ขอบฟ้า (< 0)
        self.assertFalse(pass_needs_refresh(p, inside, 30.0, p.aos, self.CYCLE, 0.0))
        # ขอบของช่วงนับว่าอยู่ในช่วง
        self.assertTrue(pass_needs_refresh(p, p.aos, -0.5, p.aos, self.CYCLE, 0.0))
        self.assertTrue(pass_needs_refresh(p, p.los, -0.5, p.aos, self.CYCLE, 0.0))
        self.assertFalse(pass_needs_refresh(p, p.los, 10.0, p.aos, self.CYCLE, 0.0))

    def test_stored_pass_for_up_satellite_is_stable(self):
        # ดาวอยู่ในช่วง pass ตลอด: ไม่ต้องหาใหม่ทุก tick
        p = make_pass()
        for s in range(600, 1201, 60):
            self.assertFalse(pass_needs_refresh(p, at(s), 20.0, p.aos, self.CYCLE, 0.0))


class CommandTest(unittest.TestCase):
    def test_command_strings(self):
        self.assertEqual(cmd_set_pos(180, 45), "P 180.00 45.00\n")
        self.assertEqual(cmd_set_pos(-90.0, 0.5), "P -90.00 0.50\n")
        self.assertEqual(cmd_set_pos(0.0, 0.0), "P 0.00 0.00\n")
        self.assertEqual(cmd_set_pos(359.996, 89.994), "P 360.00 89.99\n")           # %.2f ปัดแบบ printf
        self.assertEqual(cmd_set_pos(12.345678, 1.0), "P 12.35 1.00\n")
        self.assertEqual(CMD_GET_POS, "p\n")
        self.assertEqual(CMD_STOP, "S\n")

    def test_decimal_point_is_independent_of_locale(self):
        saved = locale.setlocale(locale.LC_NUMERIC)
        self.addCleanup(locale.setlocale, locale.LC_NUMERIC, saved)
        for name in ("de_DE.UTF-8", "de_DE", "fr_FR.UTF-8"):
            try:
                locale.setlocale(locale.LC_NUMERIC, name)
            except locale.Error:
                continue
            self.assertEqual(locale.localeconv()["decimal_point"], ",")            # locale ติดจริง
            self.assertEqual(cmd_set_pos(180.5, 45.25), "P 180.50 45.25\n")
            return
        self.skipTest("ไม่มี locale ที่ใช้จุลภาคเป็นจุดทศนิยมในเครื่องนี้")


class ParseTest(unittest.TestCase):
    def test_parse(self):
        self.assertEqual(parse_pos(["180.000000", "45.000000"]), (180.0, 45.0))
        self.assertEqual(parse_pos(["-90.5", "0.0"]), (-90.5, 0.0))
        self.assertEqual(parse_pos(["12", "3"]), (12.0, 3.0))
        self.assertIsNone(parse_pos(["RPRT -1"]))
        self.assertIsNone(parse_pos(["RPRT -1", "45.0"]))                         # ขึ้นต้น RPRT คือ error เสมอ
        self.assertIsNone(parse_pos(["180.000000"]))                              # บรรทัดเดียว = bad response
        self.assertIsNone(parse_pos([]))
        self.assertIsNone(parse_pos(["abc", "45.0"]))
        self.assertIsNone(parse_pos(["180.0", "RPRT -1"]))
        self.assertIsNone(parse_pos(["nan", "45.0"]))
        self.assertIsNone(parse_pos(["180.0", "inf"]))
        self.assertEqual(parse_pos(["10.0", "20.0", "ส่วนเกิน"]), (10.0, 20.0))    # Gpredict อ่านสองบรรทัดแรก

        self.assertEqual(parse_rprt(["RPRT 0"]), 0)
        self.assertEqual(parse_rprt(["RPRT -5"]), -5)
        self.assertEqual(parse_rprt(["RPRT -1"]), -1)
        self.assertIsNone(parse_rprt([]))
        self.assertIsNone(parse_rprt(["180.0"]))
        self.assertIsNone(parse_rprt(["RPRT"]))
        self.assertIsNone(parse_rprt(["RPRT x"]))


if __name__ == "__main__":
    unittest.main()
