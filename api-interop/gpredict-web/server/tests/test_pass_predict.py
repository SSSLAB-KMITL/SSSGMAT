import math
import unittest
from datetime import datetime, timedelta, timezone

from gpredict_web.ephem import SatEphem
from gpredict_web.observe import GP_RE_KM, MU_EARTH, TleElements, observe, orbit_number
from gpredict_web.pass_predict import (
    NEXT_PASS_OFFSET, PASS_GAP, PassData, describe, get_pass, get_passes, has_aos, pass_to_dict, sample_times,
)
from gpredict_web.passes import Pass, find_passes
from gpredict_web.runtime import iso_ms
from gnss_predict.astro import sun_ecef_km
from gnss_predict.geometry import ecef_to_aer
from tests.helpers import W_RAD_S, WINDOW_START, circular_ephem, origin_qth, window_times

UTC = timezone.utc
T0 = datetime(2026, 11, 12, 0, 0, 0, tzinfo=UTC)
START = datetime(2026, 11, 12, 6, 0, 0, tzinfo=UTC)
Q = origin_qth()
T_PEAK = WINDOW_START + timedelta(hours=8, seconds=7)                 # 13:00:07 UTC ดวงอาทิตย์ที่ QTH อยู่สูง
DAWN_PEAK = WINDOW_START + timedelta(minutes=10, seconds=7)           # 05:10:07 UTC ช่วงต้นของ pass อยู่ในเงาโลก
ENTRIES, RESOLUTION_S = 20, 10
EXPECTED_ROW_KEYS = ("t", "az", "el", "ra", "dec", "range_km", "rate_kms", "lat_deg", "lon_deg", "ssp",
                     "footprint_km", "alt_km", "vel_kms", "doppler_hz", "loss_db", "delay_ms", "ma", "phase_deg",
                     "vis")


def secs(a, b) -> float:
    return (a - b).total_seconds()


def elements(**kw) -> TleElements:
    base = dict(epoch=T0, mean_motion=15.5, ndot2=0.0, bstar=0.0, incl_deg=51.6, raan_deg=10.0, ecc=0.0005,
                argp_deg=0.0, m0_deg=0.0, revnum=1000)
    base.update(kw)
    return TleElements(**base)


def mean_motion_for_apogee(apogee_km: float, ecc: float = 0.0) -> float:
    """รอบต่อวันของวงโคจรที่ apogee สูงจากผิว GP_RE_KM ตามที่ให้ (a·(1+e) − R = apogee)"""
    a = (GP_RE_KM + apogee_km) / (1.0 + ecc)
    return math.sqrt(MU_EARTH / a ** 3) * 86400.0 / (2.0 * math.pi)


def equatorial_elements(t_orbit_start: datetime) -> TleElements:
    """ดาววงกลมของ helpers ที่ orbit number เพิ่มขึ้นทีละ 1 ที่ t_orbit_start + k·คาบ"""
    return TleElements(epoch=t_orbit_start, mean_motion=86400.0 * W_RAD_S / (2.0 * math.pi), ndot2=0.0, bstar=0.0,
                       incl_deg=0.0, raan_deg=0.0, ecc=0.0, argp_deg=0.0, m0_deg=0.0, revnum=100)


def pass_at(t_peak: datetime) -> tuple[Pass, SatEphem]:
    """pass ของดาววงกลม β = 0 ที่ใกล้ t_peak (ข้อมูลช่วง t_peak ± 1 ชั่วโมง) และ SatEphem ของมัน"""
    eph = circular_ephem(t_peak, 0.0, window_times(start=t_peak - timedelta(hours=1), hours=2))
    found = [p for p in find_passes(eph, Q) if abs(secs(p.t_max_el, t_peak)) < 60.0]
    assert len(found) == 1, f"ต้องเจอ pass เดียวใกล้ {t_peak} ได้ {len(found)}"
    return found[0], eph


def describe_at(t_peak: datetime, twilight_deg: float = -6.0) -> PassData:
    p, eph = pass_at(t_peak)
    return describe(p, eph, Q, equatorial_elements(t_peak), ENTRIES, RESOLUTION_S, twilight_deg)


def make_pass(aos: datetime, minutes: float = 10.0, max_el: float = 40.0) -> Pass:
    los = aos + timedelta(minutes=minutes)
    return Pass(aos, los, max_el, aos + (los - aos) / 2)


class ConstantsTest(unittest.TestCase):
    def test_offsets_in_days(self):
        self.assertEqual(NEXT_PASS_OFFSET, timedelta(days=0.007))
        self.assertEqual(PASS_GAP, timedelta(days=0.014))


class SampleTimesTest(unittest.TestCase):
    def test_sample_times_by_entries(self):
        los = START + timedelta(seconds=600)
        times = sample_times(START, los, 20, 10)
        self.assertEqual(len(times), 21)
        self.assertEqual(times[0], START)
        self.assertTrue(all(b - a == timedelta(seconds=30) for a, b in zip(times, times[1:])))
        self.assertEqual(times[-1], los)

    def test_sample_times_by_resolution(self):
        times = sample_times(START, START + timedelta(seconds=150), 20, 10)
        self.assertEqual(len(times), 16)                                        # floor(150/10) + 1
        self.assertTrue(all(b - a == timedelta(seconds=10) for a, b in zip(times, times[1:])))
        self.assertEqual(times[-1], START + timedelta(seconds=150))
        # pass ไม่ลงตัวกับ resolution: แถวสุดท้ายอยู่ก่อน LOS
        times = sample_times(START, START + timedelta(seconds=155), 20, 10)
        self.assertEqual(len(times), 16)
        self.assertEqual(times[-1], START + timedelta(seconds=150))

    def test_sample_times_multiplied_not_accumulated(self):
        aos = START + timedelta(microseconds=123457)
        los = aos + timedelta(seconds=1000)
        times = sample_times(aos, los, 7, 10)
        # บวก timedelta(1000/7 วินาที) ที่ปัดเป็นไมโครวินาทีสะสม 7 ครั้งจะเกิน LOS 1 ไมโครวินาทีและหายไปหนึ่งแถว
        self.assertEqual(len(times), 8)
        for k, t in enumerate(times):
            self.assertEqual(t, aos + timedelta(seconds=k * 1000 / 7), f"k={k}")
        self.assertEqual(times[-1], los)


class HasAosTest(unittest.TestCase):
    def test_has_aos_cases(self):
        t = T0 + timedelta(days=1)
        self.assertTrue(has_aos(elements(), 13.7, t))                           # แบบ ISS: incl 51.6° ที่ lat 13.7°
        self.assertFalse(has_aos(elements(mean_motion=1.0027, incl_deg=0.05, ecc=0.0002), 13.7, t))      # GEO
        decaying = elements(ndot2=0.01)                                          # decayed เมื่อ epoch + 11.67 วัน
        self.assertTrue(has_aos(decaying, 13.7, t))
        self.assertFalse(has_aos(decaying, 13.7, T0 + timedelta(days=30)))
        self.assertFalse(has_aos(elements(mean_motion=0.0), 13.7, t))
        low = elements(incl_deg=10.0, ecc=0.0, mean_motion=mean_motion_for_apogee(500.0))   # 10° + acos(R/(R+500)) ≈ 32°
        self.assertFalse(has_aos(low, 60.0, t))
        self.assertFalse(has_aos(low, -60.0, t))
        self.assertTrue(has_aos(low, 30.0, t))
        retrograde = elements(incl_deg=170.0, ecc=0.0, mean_motion=mean_motion_for_apogee(500.0))   # พับเป็น 10°
        self.assertFalse(has_aos(retrograde, 60.0, t))
        self.assertTrue(has_aos(retrograde, 30.0, t))
        self.assertFalse(has_aos(elements(mean_motion=18.0, ecc=0.0), 0.0, t))  # apogee ใต้ผิวโลก: acos ของ C ได้ NaN


class DescribeTest(unittest.TestCase):
    def test_describe_values(self):
        p, eph = pass_at(T_PEAK)
        el = equatorial_elements(T_PEAK - timedelta(seconds=100))               # orbit ขึ้นรอบใหม่ระหว่าง AOS กับ TCA
        d = describe(p, eph, Q, el, ENTRIES, RESOLUTION_S, -6.0)
        self.assertLessEqual(abs(secs(d.tca, T_PEAK)), 0.1)
        # El ที่จุดเหนือศีรษะเป็นยอดแหลมที่เปลี่ยน 0.7°/s และ golden-section หยุดที่ช่วง 0.1 s (TCA คลาดได้ 0.05 s)
        self.assertLessEqual(abs(d.max_el - 90.0), 0.04)
        self.assertEqual((d.aos, d.tca, d.los, d.max_el), (p.aos, p.t_max_el, p.los, p.max_el))

        def az(t):
            return ecef_to_aer(eph.state_at(t)[0], Q.ecef_km, Q.lat_deg, Q.lon_deg)[0]
        self.assertAlmostEqual(d.aos_az, az(p.aos), places=9)
        self.assertAlmostEqual(d.los_az, az(p.los), places=9)
        self.assertAlmostEqual(d.max_el_az, az(d.tca), places=9)
        self.assertAlmostEqual(d.aos_az, 270.0, delta=0.01)                     # ขึ้นทางทิศตะวันตก ตกทางทิศตะวันออก
        self.assertAlmostEqual(d.los_az, 90.0, delta=0.01)
        self.assertEqual(d.orbit, orbit_number(el, p.aos))
        self.assertNotEqual(d.orbit, orbit_number(el, d.tca))
        times = sample_times(p.aos, p.los, ENTRIES, RESOLUTION_S)
        self.assertEqual(len(d.rows), len(times))
        self.assertEqual([row["t"] for row in d.rows], times)
        r, v = eph.state_at(times[5])
        obs = observe(r, v, times[5], Q, el, None, -6.0)
        self.assertEqual(tuple(d.rows[5]), EXPECTED_ROW_KEYS)
        for key in EXPECTED_ROW_KEYS[1:]:
            self.assertEqual(d.rows[5][key], obs["range_rate_kms" if key == "rate_kms" else key], key)

    def test_describe_vis_letters(self):
        noon = describe_at(T_PEAK, twilight_deg=-18.0)
        self.assertTrue(all(row["vis"] == "D" for row in noon.rows))
        self.assertEqual(noon.vis, "-D-")
        dawn = describe_at(DAWN_PEAK, twilight_deg=-6.0)                        # ดวงอาทิตย์ที่ QTH ราว −14°
        self.assertEqual({row["vis"] for row in dawn.rows}, {"V", "E"})
        self.assertEqual(dawn.vis, "V-E")
        dawn_strict = describe_at(DAWN_PEAK, twilight_deg=-18.0)
        self.assertEqual({row["vis"] for row in dawn_strict.rows}, {"D", "E"})
        self.assertEqual(dawn_strict.vis, "-DE")

    def test_vis_includes_tca_point(self):
        # สองแถว (AOS ในเงา, AOS + 600 s โดนแสง) Twilight threshold อยู่ระหว่างระดับดวงอาทิตย์ที่ TCA กับที่แถวที่สอง
        # จึงมีแค่จุด TCA ที่เป็น V
        p, eph = pass_at(DAWN_PEAK)

        def sun_el(t):                                                            # QTH ที่ (0°, 0°): ทิศตั้งฉากคือแกน +x
            s = sun_ecef_km(t)
            return math.degrees(math.asin(s[0] / math.hypot(*s)))
        threshold = 0.5 * (sun_el(p.t_max_el) + sun_el(p.aos + timedelta(seconds=600)))
        d = describe(p, eph, Q, equatorial_elements(DAWN_PEAK), 10, 600, threshold)
        self.assertEqual([row["vis"] for row in d.rows], ["E", "D"])
        self.assertEqual(d.vis, "VDE")

    def test_describe_needs_known_aos_and_los(self):
        p, eph = pass_at(T_PEAK)
        for cut in (Pass(None, p.los, p.max_el, p.t_max_el), Pass(p.aos, None, p.max_el, p.t_max_el)):
            with self.assertRaises(ValueError):
                describe(cut, eph, Q, equatorial_elements(T_PEAK), ENTRIES, RESOLUTION_S, -6.0)

    def test_rows_ma_is_phase_scaled(self):
        d = describe_at(T_PEAK)
        for row in d.rows:
            self.assertAlmostEqual(row["ma"], row["phase_deg"] * 256.0 / 360.0, places=12)


class GetPassTest(unittest.TestCase):
    def test_get_pass_skips_low_pass(self):
        passes = [make_pass(START + timedelta(hours=1), max_el=3.0), make_pass(START + timedelta(hours=2.6))]
        self.assertIs(get_pass(passes, START, 3.0, 5.0), passes[1])

    def test_get_pass_limit_from_call_start(self):
        # จุดค้นหลัง pass ต่ำคือ start + 0.104 วัน: ถ้านับ limit จากจุดนั้น pass ที่ 2 จะอยู่ในช่วง
        passes = [make_pass(START + timedelta(hours=2), max_el=3.0), make_pass(START + timedelta(days=3.1))]
        self.assertIsNone(get_pass(passes, START, 3.0, 5.0))
        self.assertIs(get_pass(passes, START, 3.2, 5.0), passes[1])

    def test_in_progress_pass_counts(self):
        a = Pass(START - timedelta(minutes=3), START + timedelta(minutes=7), 40.0, START + timedelta(minutes=2))
        passes = [a, make_pass(START + timedelta(hours=1.5))]
        self.assertIs(get_pass(passes, START, 3.0, 5.0), a)

    def test_in_progress_exception(self):
        a = Pass(START - timedelta(minutes=3), START + timedelta(minutes=7), 40.0, START + timedelta(minutes=2))
        passes = [a, make_pass(START + timedelta(days=3.5))]
        self.assertIsNone(get_pass(passes, START, 3.0, 5.0))
        self.assertIsNone(get_pass([a], START, 3.0, 5.0))                     # ไม่มี AOS ถัดไปในข้อมูล

    def test_in_progress_after_skip_limit_from_call_start(self):
        # B เริ่มภายใน 20 นาทีหลัง LOS ของ A ที่ต่ำ จุดค้นถัดไป (LOS ของ A + 0.014 วัน) จึงอยู่กลาง B
        a = make_pass(START + timedelta(hours=1), max_el=3.0)
        b = Pass(START + timedelta(hours=1, minutes=20), START + timedelta(hours=2), 40.0,
                 START + timedelta(hours=1, minutes=40))
        far = make_pass(START + timedelta(days=3, hours=1))                     # เกิน start + 3 วัน แต่ไม่เกินจุดค้น + 3 วัน
        self.assertIsNone(get_pass([a, b, far], START, 3.0, 5.0))
        near = make_pass(START + timedelta(days=2.9))
        self.assertIs(get_pass([a, b, near], START, 3.0, 5.0), b)

    def test_unknown_los_is_end_of_data(self):
        open_end = Pass(START + timedelta(hours=1), None, 40.0, START + timedelta(hours=1, minutes=5))
        self.assertIsNone(get_pass([open_end], START, 3.0, 5.0))
        self.assertIsNone(get_pass([make_pass(START + timedelta(minutes=30), max_el=3.0), open_end],
                                   START, 3.0, 5.0))
        # pass ที่ไม่รู้ AOS (ขอบต้นของข้อมูล) ถูกข้าม
        open_start = Pass(None, START + timedelta(minutes=5), 40.0, START)
        nxt = make_pass(START + timedelta(hours=1))
        self.assertIs(get_pass([open_start, nxt], START, 3.0, 5.0), nxt)

    def test_get_passes_slides_window(self):
        passes = [make_pass(START + timedelta(days=0.5 + k)) for k in range(10)]
        # pass ที่ 3 จบที่ start + 2.507 วัน จุดค้นถัดไป start + 2.521 วัน < start + 3 วัน จึงได้ pass ที่ 4 (AOS start + 3.5 วัน)
        self.assertEqual(get_passes(passes, START, 3.0, 10, 5.0), passes[:4])

    def test_get_passes_count_limit(self):
        passes = [make_pass(START + timedelta(minutes=30 + 90 * k)) for k in range(48)]
        self.assertEqual(get_passes(passes, START, 3.0, 5, 5.0), passes[:5])

    def test_all_passes_below_min_el_gives_none(self):
        passes = [make_pass(START + timedelta(minutes=30 + 90 * k), max_el=3.0) for k in range(48)]
        self.assertIsNone(get_pass(passes, START, 3.0, 5.0))
        self.assertEqual(get_passes(passes, START, 3.0, 10, 5.0), [])


class PassToDictTest(unittest.TestCase):
    def test_pass_to_dict_keys(self):
        d = describe_at(T_PEAK)
        out = pass_to_dict(d)
        self.assertEqual(tuple(out), ("orbit", "aos", "tca", "los", "max_el", "aos_az", "max_el_az", "los_az", "vis",
                                      "rows"))
        self.assertEqual((out["aos"], out["tca"], out["los"]), (iso_ms(d.aos), iso_ms(d.tca), iso_ms(d.los)))
        self.assertEqual((out["orbit"], out["max_el"], out["vis"]), (d.orbit, d.max_el, d.vis))
        self.assertEqual(len(out["rows"]), len(d.rows))
        for row, src in zip(out["rows"], d.rows):
            self.assertEqual(tuple(row), EXPECTED_ROW_KEYS)
            self.assertEqual(row["t"], iso_ms(src["t"]))
            self.assertEqual(row["az"], src["az"])
        self.assertIsInstance(d.rows[0]["t"], datetime)                          # PassData ไม่ถูกแก้
        summary = pass_to_dict(d, rows=False)
        self.assertNotIn("rows", summary)
        self.assertEqual(summary, {k: v for k, v in out.items() if k != "rows"})


if __name__ == "__main__":
    unittest.main()
