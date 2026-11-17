import math
import unittest
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from gnss_predict.analyze import (AerRow, Interval, aer_rows, access_intervals, global_statistics,
                                  intervals_from_elevations, legacy_rows)
from gnss_predict.config import THBK_HEIGHT_M, THBK_LAT_DEG, THBK_LON_DEG
from gnss_predict.geometry import (ecef_to_aer, ecef_to_az_el, geodetic_to_ecef, ipp, mapping_factor,
                                   sez_to_az_el)
from gnss_predict.predict import rows_from_samples
from gnss_predict.propagate import Ephemeris
from gnss_predict.report import SezSample
from gnss_predict.scenario import Facility
from tests.report_fixture import circular_ecef_km, fake_propagate, slot_table

UTC = timezone.utc
T0 = datetime(2026, 11, 10, tzinfo=UTC)
THBK = Facility("THBK", THBK_LAT_DEG, THBK_LON_DEG, THBK_HEIGHT_M, 10.0)


@dataclass
class Iv:
    """ตัวแทน Interval ที่มีเฉพาะ start และ stop"""
    start: datetime
    stop: datetime


def t(seconds: float) -> datetime:
    return T0 + timedelta(seconds=seconds)


def spans(intervals: list[Interval]) -> list[tuple[datetime, datetime]]:
    return [(i.start, i.stop) for i in intervals]


def up_unit(lat_deg: float, lon_deg: float) -> tuple[float, float, float]:
    lat, lon = math.radians(lat_deg), math.radians(lon_deg)
    return math.cos(lat) * math.cos(lon), math.cos(lat) * math.sin(lon), math.sin(lat)


class TestIntervalsFromElevations(unittest.TestCase):
    def test_rising_crossing_interpolated(self):
        iv = intervals_from_elevations([t(0), t(30), t(60)], [5, 15, 25], 10)
        self.assertEqual([(i.start, i.stop, i.max_el_deg) for i in iv], [(t(15), t(60), 25)])

    def test_setting_crossing(self):
        self.assertEqual(spans(intervals_from_elevations([t(0), t(30), t(60)], [25, 15, 5], 10)),
                         [(t(0), t(45))])

    def test_always_visible_clipped_to_period(self):        # Review Focus 4
        iv = intervals_from_elevations([t(0), t(30), t(60)], [20, 30, 20], 10)
        self.assertEqual(spans(iv), [(t(0), t(60))])
        self.assertEqual(iv[0].max_el_deg, 30)

    def test_threshold_touch_dropped(self):                 # Review Focus 4, D7
        self.assertEqual(intervals_from_elevations([t(0), t(30), t(60)], [5, 10, 5], 10), [])

    def test_touch_at_period_edge_dropped(self):
        self.assertEqual(intervals_from_elevations([t(0), t(30), t(60)], [10, 5, 5], 10), [])
        self.assertEqual(intervals_from_elevations([t(0), t(30), t(60)], [5, 5, 10], 10), [])

    def test_sample_exactly_at_threshold_is_inside(self):
        iv = intervals_from_elevations([t(0), t(30), t(60), t(90)], [5, 10, 20, 5], 10)
        self.assertEqual(spans(iv), [(t(30), t(80))])
        self.assertEqual(iv[0].max_el_deg, 20)

    def test_pass_between_samples_has_positive_length(self):
        # ดาวขึ้นแล้วตกระหว่างจุด 30 ถึง 60 วินาที โดยไม่มีจุดตัวอย่างใดอยู่ในช่วง: ไม่เห็นเลยตามนิยามจุดตัวอย่าง
        self.assertEqual(intervals_from_elevations([t(0), t(30), t(60)], [5, 5, 5], 10), [])
        iv = intervals_from_elevations([t(0), t(30), t(60)], [5, 12, 5], 10)
        self.assertEqual(len(iv), 1)
        self.assertGreater(iv[0].stop, iv[0].start)
        self.assertEqual(iv[0].max_el_deg, 12)

    def test_two_passes_with_own_max(self):
        els = [20, 5, 5, 30, 40, 5]
        times = [t(30 * k) for k in range(6)]
        iv = intervals_from_elevations(times, els, 10)
        self.assertEqual([i.max_el_deg for i in iv], [20, 40])
        self.assertEqual(spans(iv), [(t(0), t(20)), (t(66), t(145.714))])

    def test_millisecond_rounding(self):                    # จุดตัดที่ 10.0004 s -> 10.000 s
        times = [t(0), t(30), t(60)]
        iv = intervals_from_elevations(times, [0.0, 30.0, 30.0], 10.0004)
        self.assertEqual(iv[0].start, t(10.0))
        self.assertEqual(iv[0].start.microsecond, 0)
        iv = intervals_from_elevations(times, [0.0, 30.0, 30.0], 10.0006)
        self.assertEqual(iv[0].start, t(10.001))
        self.assertEqual(iv[0].start.microsecond % 1000, 0)

    def test_setting_millisecond_rounding(self):            # จุดตัดที่ 39.9996 s -> 40.000 s
        iv = intervals_from_elevations([t(0), t(30), t(60)], [30.0, 30.0, 0.0], 20.0004)
        self.assertEqual(iv[0].stop, t(40.0))
        self.assertEqual(iv[0].stop.microsecond, 0)

    def test_no_samples_or_never_visible(self):
        self.assertEqual(intervals_from_elevations([], [], 10), [])
        self.assertEqual(intervals_from_elevations([t(0), t(30)], [1, 2], 10), [])

    def test_length_mismatch_raises(self):
        with self.assertRaises(ValueError):
            intervals_from_elevations([t(0), t(30)], [1.0], 10)


class TestGlobalStatistics(unittest.TestCase):
    def test_global_statistics(self):
        g = global_statistics({"G01": [Iv(t(0), t(100))], "E11": [Iv(t(0), t(300))], "R05": []})
        self.assertEqual(g, {"count": 2, "total_duration_s": 400.0, "min_duration_s": 100.0,
                             "max_duration_s": 300.0, "mean_duration_s": 200.0})
        self.assertEqual(global_statistics({})["min_duration_s"], None)

    def test_empty(self):
        self.assertEqual(global_statistics({"G01": []}),
                         {"count": 0, "total_duration_s": 0.0, "min_duration_s": None,
                          "max_duration_s": None, "mean_duration_s": None})

    def test_several_intervals_per_satellite(self):
        g = global_statistics({"G01": [Iv(t(0), t(10)), Iv(t(20), t(50))]})
        self.assertEqual((g["count"], g["total_duration_s"], g["mean_duration_s"]), (2, 40.0, 20.0))


class TestAerRows(unittest.TestCase):
    def test_aer_zenith_and_below_horizon(self):
        sta = geodetic_to_ecef(THBK.lat_deg, THBK.lon_deg, THBK.alt_m)
        u = up_unit(THBK.lat_deg, THBK.lon_deg)
        zenith = tuple(s + 20000.0 * c for s, c in zip(sta, u))
        far = tuple(-26560.0 * c for c in u)                # ฝั่งตรงข้ามโลก
        eph = Ephemeris([t(0)], {"G01": [zenith], "G02": [far]})
        rows = aer_rows(eph, THBK, 400.0)
        self.assertEqual([r.prn for r in rows], ["G01"])
        self.assertAlmostEqual(rows[0].el_deg, 90.0, places=9)
        self.assertAlmostEqual(rows[0].range_km, 20000.0, places=6)
        self.assertEqual(rows[0].time_utc, t(0))
        self.assertAlmostEqual(rows[0].mf, 1.0, places=12)

    def test_el_zero_is_included(self):
        sta = geodetic_to_ecef(0.0, 0.0, 0.0)
        eph = Ephemeris([t(0)], {"G01": [(sta[0], 20000.0, 0.0)]})
        rows = aer_rows(eph, Facility("EQ", 0.0, 0.0, 0.0, 0.0), 400.0)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].el_deg, 0.0)

    def test_ipp_mf_columns(self):
        sta = geodetic_to_ecef(THBK.lat_deg, THBK.lon_deg, THBK.alt_m)
        pos = (sta[0] - 9000.0, sta[1] + 7000.0, sta[2] + 12000.0)
        eph = Ephemeris([t(0)], {"E11": [pos]})
        for shell in (400.0, 450.0):
            (row,) = aer_rows(eph, THBK, shell)
            az, el, rng = ecef_to_aer(pos, sta, THBK.lat_deg, THBK.lon_deg)
            self.assertGreater(el, 0.0)
            self.assertEqual((row.az_deg, row.el_deg, row.range_km), (az, el, rng))
            self.assertEqual((row.ipp_lat_deg, row.ipp_lon_deg),
                             ipp(THBK.lat_deg, THBK.lon_deg, az, el, shell_km=shell))
            self.assertEqual(row.mf, mapping_factor(el, shell_km=shell))
        (a,), (b,) = aer_rows(eph, THBK, 400.0), aer_rows(eph, THBK, 450.0)
        self.assertNotEqual(a.mf, b.mf)

    def test_ipp_uses_facility_position(self):
        other = Facility("AAA", -33.0, 151.0, 0.0, 0.0)
        pos = tuple(c * 26560.0 for c in up_unit(-30.0, 150.0))
        (row,) = aer_rows(Ephemeris([t(0)], {"G01": [pos]}), other, 400.0)
        self.assertEqual((row.ipp_lat_deg, row.ipp_lon_deg),
                         ipp(other.lat_deg, other.lon_deg, row.az_deg, row.el_deg, shell_km=400.0))

    def test_sorted_by_time_then_prn(self):
        sta = geodetic_to_ecef(THBK.lat_deg, THBK.lon_deg, THBK.alt_m)
        u = up_unit(THBK.lat_deg, THBK.lon_deg)
        pos = tuple(s + 20000.0 * c for s, c in zip(sta, u))
        eph = Ephemeris([t(0), t(30)], {"R05": [pos, pos], "C01": [pos, pos], "G01": [pos, pos]})
        rows = aer_rows(eph, THBK, 400.0)
        self.assertEqual([(r.time_utc, r.prn) for r in rows],
                         [(t(0), "C01"), (t(0), "G01"), (t(0), "R05"),
                          (t(30), "C01"), (t(30), "G01"), (t(30), "R05")])


class TestImagingRows(unittest.TestCase):
    """ดาวถ่ายภาพ (ระบบ X) มี AER และช่วง access แต่ไม่มี IPP/MF (Ruling c)"""

    def test_aer_rows_x_have_no_ipp(self):
        from gnss_predict import studio
        sta = geodetic_to_ecef(THBK.lat_deg, THBK.lon_deg, THBK.alt_m)
        u = up_unit(THBK.lat_deg, THBK.lon_deg)
        g01 = (sta[0] - 9000.0, sta[1] + 7000.0, sta[2] + 12000.0)
        overhead = tuple(s + 700.0 * c for s, c in zip(sta, u))
        slant = (sta[0] - 300.0, sta[1] + 200.0, sta[2] + 600.0)
        far = tuple(-7000.0 * c for c in u)                  # ฝั่งตรงข้ามโลก (El < 0)
        times = [t(0), t(30), t(60), t(90)]
        both = Ephemeris(times, {"G01": [g01] * 4, "X04": [overhead, slant, slant, far]})
        gnss = Ephemeris(times, {"G01": [g01] * 4})
        rows = aer_rows(both, THBK, 400.0)
        x_rows = [r for r in rows if r.prn == "X04"]
        self.assertEqual(len(x_rows), 3)
        for r, pos in zip(x_rows, [overhead, slant, slant], strict=True):
            self.assertIsNone(r.ipp_lat_deg)
            self.assertIsNone(r.ipp_lon_deg)
            self.assertIsNone(r.mf)
            self.assertEqual((r.az_deg, r.el_deg, r.range_km), ecef_to_aer(pos, sta, THBK.lat_deg, THBK.lon_deg))
            self.assertGreaterEqual(r.el_deg, 0.0)
        self.assertAlmostEqual(x_rows[0].range_km, 700.0, places=6)
        self.assertEqual([r for r in rows if r.prn == "G01"], aer_rows(gnss, THBK, 400.0))
        self.assertEqual(studio._aer_csv_row(x_rows[0])[5:], ["", "", ""])
        self.assertTrue(all(studio._aer_csv_row(x_rows[0])[2:5]))
        intervals = access_intervals(both, THBK)
        self.assertIn("X04", intervals)
        self.assertEqual(intervals["G01"], access_intervals(gnss, THBK)["G01"])
        self.assertEqual(len(intervals["X04"]), 1)
        self.assertEqual(legacy_rows(rows), legacy_rows(aer_rows(gnss, THBK, 400.0)))


def _equator_sat(el_deg: float) -> tuple[float, float, float]:
    """ดาวเหนือสถานี (lat 0, lon 0, h 0) ที่ El ตามต้องการ: ความสูง 20000 กม. ระยะราบตามมุม"""
    sta = geodetic_to_ecef(0.0, 0.0, 0.0)
    return sta[0] + 20000.0, 20000.0 / math.tan(math.radians(el_deg)), 0.0


class TestAccessIntervals(unittest.TestCase):
    fac = Facility("EQ", 0.0, 0.0, 0.0, 10.0)

    def test_every_prn_is_a_key_and_intervals_follow_threshold(self):
        times = [t(0), t(30), t(60)]
        eph = Ephemeris(times, {
            "G01": [_equator_sat(e) for e in (5, 15, 25)],      # ขึ้น
            "E11": [_equator_sat(e) for e in (25, 15, 5)],      # ตก
            "R05": [_equator_sat(e) for e in (1, 2, 3)],        # ไม่เคยเห็น
            "C01": [_equator_sat(e) for e in (20, 30, 20)],     # เห็นตลอด
        })
        result = access_intervals(eph, self.fac)
        self.assertEqual(sorted(result), ["C01", "E11", "G01", "R05"])
        self.assertEqual(spans(result["G01"]), [(t(15), t(60))])
        self.assertEqual(spans(result["E11"]), [(t(0), t(45))])
        self.assertEqual(result["R05"], [])
        self.assertEqual(spans(result["C01"]), [(t(0), t(60))])
        self.assertAlmostEqual(result["G01"][0].max_el_deg, 25.0, places=9)

    def test_uses_facility_min_el(self):
        times = [t(0), t(30), t(60)]
        eph = Ephemeris(times, {"G01": [_equator_sat(e) for e in (5, 15, 25)]})
        low = Facility("EQ", 0.0, 0.0, 0.0, 0.0)
        self.assertEqual(spans(access_intervals(eph, low)["G01"]), [(t(0), t(60))])
        high = Facility("EQ", 0.0, 0.0, 0.0, 20.0)
        self.assertEqual(spans(access_intervals(eph, high)["G01"]), [(t(30 + 30 * 5 / 10), t(60))])


class TestMappingFactorParity(unittest.TestCase):
    """เทียบ mapping_factor กับ mapping() ใน TrainingModel/src/t02_5_rebuild_tec.py ทุก 0.001 องศา

    t02_5 คำนวณด้วย numpy array ซึ่งยกกำลังสองด้วยการคูณ (k * k) ส่วน `** 2` ของ float ใน Python เรียก pow()
    ของ libm ซึ่งบนเครื่องนี้ (macOS arm64, Python 3.14) คลาดจาก k * k ไป 1 ulp ใน 59 จาก 90001 ค่า
    ตรวจแล้วว่า mapping_factor ตรงกับ np.sqrt(1 - (...) ** 2) แบบ array ทุกบิต (numpy 2.5.3)
    """

    @staticmethod
    def _reference(el: float, square) -> float:
        k = 6371.0 * math.cos(math.radians(el)) / (6371.0 + 400.0)
        return math.sqrt(1.0 - square(k))

    def test_mf_identical_to_trainingmodel(self):
        for k in range(90001):
            el = k / 1000
            self.assertEqual(mapping_factor(el), self._reference(el, lambda x: x * x))

    def test_mf_within_libm_pow_ulp_of_scalar_formula(self):
        worst = max(abs(mapping_factor(k / 1000) - self._reference(k / 1000, lambda x: x ** 2))
                    for k in range(90001))
        self.assertLessEqual(worst, 2e-16)                      # วัดได้ 1.67e-16


def _aer_from_sez(samples: list[SezSample]) -> list[AerRow]:
    rows = []
    for s in samples:
        az, el = sez_to_az_el(s.s_km, s.e_km, s.z_km)
        lat, lon = ipp(THBK_LAT_DEG, THBK_LON_DEG, az, el, shell_km=400.0)
        rows.append(AerRow(s.t, f"G{s.prn:02d}", az, el, math.sqrt(s.s_km ** 2 + s.e_km ** 2 + s.z_km ** 2),
                           lat, lon, mapping_factor(el, shell_km=400.0)))
    return rows


class TestLegacyRows(unittest.TestCase):
    samples = [
        SezSample(datetime(2026, 11, 11, 0, 0, 0, tzinfo=UTC), 22, 0.0, 0.0, 20200.0),
        SezSample(datetime(2026, 11, 10, 23, 59, 30, tzinfo=UTC), 5, 3000.0, -12000.0, 18000.0),
        SezSample(datetime(2026, 11, 10, 23, 59, 30, tzinfo=UTC), 16, -20000.0, 0.0, 0.0),
        SezSample(datetime(2026, 11, 10, 23, 59, 30, tzinfo=UTC), 19, 0.0, 20000.0, -100.0),   # El < 0
        SezSample(datetime(2026, 11, 11, 0, 0, 30, tzinfo=UTC), 1, -20000.0, -1e-6, 5000.0),   # Az ปัดเป็น 360.000
        SezSample(datetime(2026, 11, 11, 0, 0, 30, tzinfo=UTC), 31, 7000.0, 9000.0, 15000.0),
        SezSample(datetime(2026, 11, 11, 0, 1, 0, tzinfo=UTC), 12, -5000.0, 16000.0, 9000.0),
        SezSample(datetime(2026, 11, 11, 0, 1, 0, tzinfo=UTC), 7, 12345.678, 23456.789, 3456.789),
    ]

    def test_legacy_rows_match_old_formatter(self):
        aer = _aer_from_sez(self.samples)
        self.assertEqual(legacy_rows(aer, 0.0), rows_from_samples(self.samples, 0.0, 400.0))
        self.assertEqual(legacy_rows(aer), rows_from_samples(self.samples, 0.0, 400.0))
        self.assertEqual(legacy_rows(aer, 30.0), rows_from_samples(self.samples, 30.0, 400.0))
        self.assertEqual(legacy_rows(aer, -90.0), rows_from_samples(self.samples, -90.0, 400.0))

    def test_az_rounding_wraps_to_zero(self):
        rows = legacy_rows(_aer_from_sez(self.samples), 0.0)
        g01 = next(r for r in rows if r[2] == "G01")
        self.assertEqual(g01[3], "0.000")

    def test_legacy_rows_gps_only(self):
        base = _aer_from_sez(self.samples[:1])[0]
        mixed = [base,
                 AerRow(base.time_utc, "E11", 10.0, 45.0, 25000.0, 1.0, 2.0, 0.9),
                 AerRow(base.time_utc, "C01", 10.0, 45.0, 25000.0, 1.0, 2.0, 0.9),
                 AerRow(base.time_utc, "R05", 10.0, 45.0, 25000.0, 1.0, 2.0, 0.9)]
        rows = legacy_rows(mixed, 0.0)
        self.assertEqual([r[2] for r in rows], ["G22"])

    def test_legacy_rows_use_row_columns(self):
        row = AerRow(datetime(2026, 11, 11, 1, 2, 3, tzinfo=UTC), "G07", 359.9996, 12.3456,
                     22000.0, -5.43219, 101.98765, 0.987654)
        self.assertEqual(legacy_rows([row]),
                         [["2026-11-11", "01:02:03", "G07", "0.000", "12.346", "-5.4322", "101.9877", "0.98765"]])


class TestAccessEdgesAgainstOneSecondSampling(unittest.TestCase):
    """§10.2 แถว 4: ขอบช่วง access จากจุดห่าง 30 วินาที (ประมาณเชิงเส้น) ตรงกับการสุ่มมุมเงยทุก 1 วินาที ไม่เกิน 1 วินาที

    ขอบจากการสุ่ม: ต้นช่วง = วินาทีแรกที่ El ≥ เกณฑ์, ท้ายช่วง = วินาทีสุดท้ายที่ El ≥ เกณฑ์
    ขอบที่ถูกตัดที่ต้นหรือท้ายช่วงวิเคราะห์ (วินาทีที่ 0 และ 86400) ต้องเท่ากันพอดี
    """
    PRNS = ["G01", "G05", "G10", "G15", "G20", "G25", "E03", "E11", "E19", "R05", "R12", "C01", "C08"]
    SECONDS = 86400

    def test_edges_within_one_second(self):
        sats = [SimpleNamespace(prn=prn, system=prn[0]) for prn in self.PRNS]
        eph, _ = fake_propagate(sats, T0, T0 + timedelta(seconds=self.SECONDS), 30, None, None)
        found = access_intervals(eph, THBK)
        sta = geodetic_to_ecef(THBK.lat_deg, THBK.lon_deg, THBK.alt_m)
        checked = clipped = 0
        for prn, (system, slot, slots) in slot_table(sats).items():
            inside = [ecef_to_az_el(circular_ecef_km(system, slot, slots, s), sta, THBK.lat_deg, THBK.lon_deg)[1]
                      >= THBK.min_el_deg for s in range(self.SECONDS + 1)]
            sampled: list[tuple[int, int]] = []
            first = None
            for s, ok in enumerate(inside):
                if ok and first is None:
                    first = s
                elif not ok and first is not None:
                    sampled.append((first, s - 1))
                    first = None
            if first is not None:
                sampled.append((first, self.SECONDS))
            got = [((iv.start - T0).total_seconds(), (iv.stop - T0).total_seconds()) for iv in found[prn]]
            self.assertEqual(len(got), len(sampled), prn)
            for (got_start, got_stop), (want_start, want_stop) in zip(got, sampled):
                for name, g, w, cut in (("start", got_start, want_start, 0), ("stop", got_stop, want_stop, self.SECONDS)):
                    with self.subTest(prn=prn, edge=name, sampled_s=w):
                        if w == cut:
                            self.assertEqual(g, float(cut))
                            clipped += 1
                        else:
                            self.assertAlmostEqual(g, w, delta=1.0)
                            checked += 1
        self.assertGreater(checked, 20)
        self.assertGreater(clipped, 0)                      # ทดสอบทั้งกิ่งขอบที่ถูกตัดด้วย


if __name__ == "__main__":
    unittest.main()
