import math
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from gpredict_web.observe import (
    OBSERVE_KEYS, QthGeo, TleElements, delay_ms, direction, doppler_hz, footprint_km, inertial_speed_kms,
    is_decayed, is_geo, loss_db, maidenhead, observe, orbit_number, orbit_start, osculating_phase_deg,
    parse_tle, qth_geo, radec_deg, visibility,
)
from gpredict_web.store import Qth
from gnss_predict import omm
from gnss_predict.astro import eci_to_ecef, gmst_rad, subpoint, sun_ecef_km
from gnss_predict.geometry import ecef_to_aer, geodetic_to_ecef

OMM_SAMPLE = Path(__file__).resolve().parents[3] / "gnss-predict" / "tests" / "fixtures" / "studio" / "omm_sample.json"
UTC = timezone.utc
T0 = datetime(2026, 11, 12, 7, 0, 0, tzinfo=UTC)
OMEGA = 7.292115e-5
MU = 398600.4418

# TLE ตัวอย่างมาตรฐานของ ISS (epoch 2008 วันที่ 264.51782528)
ISS1 = "1 25544U 98067A   08264.51782528 -.00002182  00000-0 -11606-4 0  2927"
ISS2 = "2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.72125391563537"


def elements(**kw) -> TleElements:
    base = dict(epoch=T0, mean_motion=15.5, ndot2=0.0, bstar=0.0, incl_deg=51.6, raan_deg=10.0, ecc=0.001,
                argp_deg=90.0, m0_deg=90.0, revnum=1000)                       # M0 + omega = 180 องศา
    base.update(kw)
    return TleElements(**base)


def kepler_eci(a, e, incl, raan, argp, mean_anomaly):
    """r (กม.), v (กม./วินาที) ในกรอบเฉื่อยจาก element คลาสสิก (องศา) สร้างด้วยสูตรแยกจาก observe.py"""
    m = math.radians(mean_anomaly)
    ecc_anom = m
    for _ in range(50):
        ecc_anom -= (ecc_anom - e * math.sin(ecc_anom) - m) / (1.0 - e * math.cos(ecc_anom))
    x, y = a * (math.cos(ecc_anom) - e), a * math.sqrt(1.0 - e * e) * math.sin(ecc_anom)
    rate = math.sqrt(MU / a ** 3) / (1.0 - e * math.cos(ecc_anom))             # dE/dt
    vx, vy = -a * math.sin(ecc_anom) * rate, a * math.sqrt(1.0 - e * e) * math.cos(ecc_anom) * rate
    i, o, w = math.radians(incl), math.radians(raan), math.radians(argp)

    def rot(px, py):
        x1, y1 = px * math.cos(w) - py * math.sin(w), px * math.sin(w) + py * math.cos(w)
        return (x1 * math.cos(o) - y1 * math.cos(i) * math.sin(o),
                x1 * math.sin(o) + y1 * math.cos(i) * math.cos(o),
                y1 * math.sin(i))
    return rot(x, y), rot(vx, vy)


def earth_fixed(r_eci, v_eci, t):
    """สถานะเฉื่อย → EarthFixed ตามที่ GMAT ให้: v สัมพัทธ์กับโลกที่หมุน"""
    r = eci_to_ecef(r_eci, t)
    v = eci_to_ecef(v_eci, t)
    return r, (v[0] + OMEGA * r[1], v[1] - OMEGA * r[0], v[2])


def unit(vec):
    n = math.sqrt(sum(c * c for c in vec))
    return tuple(c / n for c in vec)


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


class MaidenheadTest(unittest.TestCase):
    def test_maidenhead(self):
        self.assertEqual(maidenhead(13.729779, 100.781151), "OK03jr")
        self.assertEqual(maidenhead(0.0, 0.0), "JJ00aa")
        self.assertEqual(maidenhead(-90.0, -180.0), "AA00aa")
        self.assertEqual(maidenhead(89.999, 179.999), "RR99xx")

    def test_maidenhead_poles_and_antimeridian_stay_in_range(self):
        self.assertEqual(maidenhead(90.0, 180.0), "RR99xx")
        self.assertEqual(maidenhead(-90.0, 180.0), "RA90xa")


class RadioValuesTest(unittest.TestCase):
    def test_radio_values(self):
        self.assertAlmostEqual(doppler_hz(-1.0), 333.564095, places=6)
        self.assertAlmostEqual(doppler_hz(1.0), -333.564095, places=6)
        self.assertAlmostEqual(loss_db(1000.0), 132.4, places=9)
        self.assertAlmostEqual(delay_ms(299.792458), 1.0, places=12)

    def test_footprint(self):
        self.assertAlmostEqual(footprint_km(400.0), 12756.33 * math.acos(6378.135 / 6778.135))
        self.assertEqual(footprint_km(0.0), 0.0)

    def test_footprint_below_surface_is_zero_not_a_domain_error(self):
        self.assertEqual(footprint_km(-5.0), 0.0)

    def test_loss_at_zero_range_does_not_raise(self):
        self.assertTrue(math.isfinite(loss_db(0.0)))

    def test_inertial_speed(self):
        self.assertAlmostEqual(inertial_speed_kms((7000, 0, 0), (0, 7.0, 0)), 7.0 + OMEGA * 7000)


class DirectionTest(unittest.TestCase):
    def test_direction(self):
        self.assertEqual(direction(0.002, None, geo=True, decayed=False), "G")
        self.assertEqual(direction(0.002, None, geo=False, decayed=True), "D")
        self.assertEqual(direction(0.002, None, geo=True, decayed=True), "G")          # GEO ชนะ decayed
        self.assertEqual(direction(0.002, None, geo=False, decayed=False), "↓")
        self.assertEqual(direction(-0.002, None, geo=False, decayed=False), "↑")
        self.assertEqual(direction(0.0005, 0.0008, geo=False, decayed=False), "↺")
        self.assertEqual(direction(0.0005, 0.0001, geo=False, decayed=False), "↷")

    def test_direction_without_previous_rate_is_tilde_arrow(self):
        self.assertEqual(direction(0.0, None, geo=False, decayed=False), "↷")

    def test_direction_thresholds_are_exclusive(self):
        self.assertEqual(direction(0.001, 0.0, geo=False, decayed=False), "↷")
        self.assertEqual(direction(-0.001, 0.0, geo=False, decayed=False), "↺")


class ParseTleTest(unittest.TestCase):
    def test_parse_standard_columns(self):
        el = parse_tle((ISS1, ISS2))
        self.assertEqual(el.epoch.tzinfo, UTC)
        self.assertLess(abs((el.epoch - (datetime(2008, 1, 1, tzinfo=UTC) + timedelta(days=263.51782528))).total_seconds()), 1e-3)
        self.assertAlmostEqual(el.ndot2, -0.00002182)
        self.assertAlmostEqual(el.bstar, -0.11606e-4)
        self.assertAlmostEqual(el.incl_deg, 51.6416)
        self.assertAlmostEqual(el.raan_deg, 247.4627)
        self.assertAlmostEqual(el.ecc, 0.0006703)
        self.assertAlmostEqual(el.argp_deg, 130.5360)
        self.assertAlmostEqual(el.m0_deg, 325.0288)
        self.assertAlmostEqual(el.mean_motion, 15.72125391)
        self.assertEqual(el.revnum, 56353)

    def test_bstar_implied_decimal_and_exponent(self):
        line1 = ISS1[:53] + " 30164-3" + ISS1[61:]
        self.assertAlmostEqual(parse_tle((line1, ISS2)).bstar, 0.30164e-3)
        line1 = ISS1[:53] + " 30164+1" + ISS1[61:]
        self.assertAlmostEqual(parse_tle((line1, ISS2)).bstar, 0.30164e1)
        line1 = ISS1[:53] + " 00000-0" + ISS1[61:]
        self.assertEqual(parse_tle((line1, ISS2)).bstar, 0.0)

    def test_two_digit_year_pivot(self):
        year = lambda yy: parse_tle((ISS1[:18] + f"{yy}264.51782528" + ISS1[32:], ISS2)).epoch.year
        self.assertEqual(year("56"), 2056)
        self.assertEqual(year("57"), 1957)
        self.assertEqual(year("99"), 1999)
        self.assertEqual(year("00"), 2000)

    def test_positive_ndot2_and_leap_day_epoch(self):
        line1 = ISS1[:18] + "24366.50000000" + " " + "+.00001234" + ISS1[43:]
        el = parse_tle((line1, ISS2))
        self.assertAlmostEqual(el.ndot2, 0.00001234)
        self.assertEqual(el.epoch, datetime(2024, 12, 31, 12, tzinfo=UTC))             # 2024 เป็นปีอธิกสุรทิน: วันที่ 366

    def test_rejects_malformed_lines(self):
        for bad in ((ISS2, ISS1), (ISS1[:60], ISS2), (ISS1, ISS2[:60]), (ISS1,), ("", "")):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                parse_tle(bad)

    def test_rejects_unreadable_number(self):
        with self.assertRaises(ValueError):
            parse_tle((ISS1, ISS2[:52] + "xx.72125391" + ISS2[63:]))


class ParseTleFromOmmTest(unittest.TestCase):
    def test_every_sample_satellite_round_trips_through_omm_tle_lines(self):
        """TLE ที่ satdb เก็บมาจาก omm.to_tle_lines: parse_tle ต้องอ่านกลับได้ตรงกับ OMM เดิมทุกดวง"""
        records = omm.read_omm(OMM_SAMPLE)
        self.assertGreater(len(records), 5)
        for rec in records:
            with self.subTest(norad=rec.norad):
                el = parse_tle(omm.to_tle_lines(rec))
                raw = rec.raw
                self.assertLess(abs((el.epoch - rec.epoch).total_seconds()), 1e-3)
                self.assertAlmostEqual(el.mean_motion, float(raw["MEAN_MOTION"]), places=8)
                self.assertAlmostEqual(el.ndot2, float(raw["MEAN_MOTION_DOT"]), places=8)
                self.assertAlmostEqual(el.incl_deg, float(raw["INCLINATION"]), places=4)
                self.assertAlmostEqual(el.raan_deg, float(raw["RA_OF_ASC_NODE"]), places=4)
                self.assertAlmostEqual(el.ecc, float(raw["ECCENTRICITY"]), delta=1e-7)        # TLE ตัดเหลือ 7 หลัก
                self.assertAlmostEqual(el.argp_deg, float(raw["ARG_OF_PERICENTER"]), places=4)
                self.assertAlmostEqual(el.m0_deg, float(raw["MEAN_ANOMALY"]), places=4)
                self.assertEqual(el.revnum, int(raw["REV_AT_EPOCH"]) % 100000)
                bstar = float(raw["BSTAR"])
                self.assertAlmostEqual(el.bstar, bstar, delta=abs(bstar) * 1e-4 + 1e-12)


class GeoAndDecayTest(unittest.TestCase):
    def test_geo_and_decay(self):
        self.assertTrue(is_geo(elements(mean_motion=1.0027)))
        self.assertTrue(is_geo(elements(mean_motion=1.0027 + 0.00019)))
        self.assertFalse(is_geo(elements(mean_motion=1.0030)))
        self.assertFalse(is_geo(elements(mean_motion=15.5)))
        el = elements(ndot2=0.001, mean_motion=15.9)
        self.assertFalse(is_decayed(el, el.epoch + timedelta(days=76.6)))
        self.assertTrue(is_decayed(el, el.epoch + timedelta(days=76.7)))
        self.assertFalse(is_decayed(el, el.epoch))
        self.assertFalse(is_decayed(elements(ndot2=0.0, mean_motion=15.9), el.epoch + timedelta(days=100000)))

    def test_decay_uses_absolute_value_of_ndot2(self):
        el = elements(ndot2=-0.001, mean_motion=15.9)
        self.assertFalse(is_decayed(el, el.epoch + timedelta(days=76.6)))
        self.assertTrue(is_decayed(el, el.epoch + timedelta(days=76.7)))


class OrbitNumberTest(unittest.TestCase):
    def test_orbit_number(self):
        el = elements()                                            # M0 + omega = 180 องศา, n = 15.5, B* = 0, rev 1000
        self.assertEqual(orbit_number(el, el.epoch), 1000)
        self.assertEqual(orbit_number(el, el.epoch + timedelta(days=0.5)), 1008)
        self.assertEqual(orbit_number(el, el.epoch + timedelta(days=1)), 1016)

    def test_orbit_number_includes_bstar_drag_term(self):
        el = elements(bstar=1.0)                                   # (15.5 + 1·1)·1 + 0.5 = 17
        self.assertEqual(orbit_number(el, el.epoch + timedelta(days=1)), 1017)

    def test_orbit_number_subtracts_whole_turns_of_m0_plus_omega(self):
        el = elements(m0_deg=300.0, argp_deg=200.0)                # (M0 + omega)/2π = 500/360 = 1.388…
        self.assertEqual(orbit_number(el, el.epoch), 1000)
        self.assertEqual(orbit_number(el, el.epoch + timedelta(days=1)), 1015)

    def test_orbit_start(self):
        el = elements()
        t = el.epoch + timedelta(days=0.5)
        expected = el.epoch + timedelta(days=(8 - 0.5) / 15.5)
        self.assertLessEqual(abs((orbit_start(el, t) - expected).total_seconds()), 1.0)

    def test_orbit_start_before_t_and_belongs_to_the_same_orbit(self):
        el = elements(bstar=2e-4, ndot2=1e-5)
        for days in (0.0, 0.3, 1.7, 12.25, -0.4):
            t = el.epoch + timedelta(days=days)
            start = orbit_start(el, t)
            self.assertLessEqual(start, t)
            self.assertLess((t - start).total_seconds(), 86400.0 / 15.5 + 1.0)
            self.assertEqual(orbit_number(el, start), orbit_number(el, t))
            self.assertEqual(orbit_number(el, start - timedelta(seconds=1)), orbit_number(el, t) - 1)

    def test_orbit_start_just_after_a_crossing_returns_that_crossing(self):
        el = elements()
        crossing = el.epoch + timedelta(days=7.5 / 15.5)           # f = 8 พอดี
        self.assertLessEqual(abs((orbit_start(el, crossing + timedelta(seconds=2)) - crossing).total_seconds()), 1.0)


class OsculatingPhaseTest(unittest.TestCase):
    def test_osculating_phase(self):
        t = T0
        r_eci, v_eci = kepler_eci(7000.0, 0.01, 51.6, 30.0, 40.0, 123.4)
        r, v = earth_fixed(r_eci, v_eci, t)
        self.assertAlmostEqual(osculating_phase_deg(r, v, t), 123.4, delta=1e-6)

    def test_phase_in_zero_to_360_for_the_whole_orbit(self):
        for m in (0.5, 90.0, 179.9, 180.1, 270.0, 359.5):
            r_eci, v_eci = kepler_eci(26560.0, 0.02, 55.0, 200.0, 15.0, m)
            r, v = earth_fixed(r_eci, v_eci, T0)
            phase = osculating_phase_deg(r, v, T0)
            self.assertGreaterEqual(phase, 0.0)
            self.assertLess(phase, 360.0)
            self.assertAlmostEqual(phase, m, delta=1e-6)

    def test_unbound_orbit_is_rejected(self):
        with self.assertRaises(ValueError):
            osculating_phase_deg((7000.0, 0.0, 0.0), (0.0, 12.0, 0.0), T0)


class VisibilityTest(unittest.TestCase):
    def setUp(self):
        self.sun = unit(sun_ecef_km(T0))
        lat, lon = subpoint(sun_ecef_km(T0))
        self.night = (-lat, lon + 180.0)                           # จุดตรงข้ามจุดใต้ดวงอาทิตย์: ดวงอาทิตย์ −90°
        self.day = (lat, lon)

    def scale(self, k):
        return tuple(k * c for c in self.sun)

    def test_visibility_eclipsed_behind_earth(self):
        self.assertEqual(visibility(self.scale(-7000.0), T0, *self.night, 30.0), "E")
        self.assertEqual(visibility(self.scale(-7000.0), T0, *self.day, -30.0), "E")          # E ชนะทุกเงื่อนไขอื่น

    def test_visibility_cylindrical_shadow_edge(self):
        perp = unit(cross(self.sun, (0.0, 0.0, 1.0)))
        base = self.scale(-2000.0)
        inside = tuple(b + 6300.0 * p for b, p in zip(base, perp))
        outside = tuple(b + 6500.0 * p for b, p in zip(base, perp))
        self.assertEqual(visibility(inside, T0, *self.night, 30.0), "E")
        self.assertEqual(visibility(outside, T0, *self.night, 30.0), "V")

    def test_sunlit_side_is_never_eclipsed_even_over_the_axis(self):
        self.assertNotEqual(visibility(self.scale(7000.0), T0, *self.night, 30.0), "E")

    def test_visibility_visible_when_sunlit_night_and_above_horizon(self):
        self.assertEqual(visibility(self.scale(7000.0), T0, *self.night, 10.0), "V")
        self.assertEqual(visibility(self.scale(7000.0), T0, *self.night, 0.0), "V")

    def test_below_horizon_is_daylight(self):
        self.assertEqual(visibility(self.scale(7000.0), T0, *self.night, -0.5), "D")

    def test_high_sun_is_daylight(self):
        self.assertEqual(visibility(self.scale(7000.0), T0, *self.day, 60.0), "D")

    def test_civil_twilight_threshold_is_minus_six_degrees(self):
        decl = math.asin(self.sun[2])
        sun_lon = math.degrees(math.atan2(self.sun[1], self.sun[0]))

        def station_with_sun_elevation(el_deg):                    # ที่เส้นศูนย์สูตร sin(El) = cos(dec)·cos(H)
            h = math.degrees(math.acos(math.sin(math.radians(el_deg)) / math.cos(decl)))
            return 0.0, sun_lon + h
        sat = self.scale(7000.0)
        self.assertEqual(visibility(sat, T0, *station_with_sun_elevation(-5.5), 20.0), "D")
        self.assertEqual(visibility(sat, T0, *station_with_sun_elevation(-6.5), 20.0), "V")


class RaDecTest(unittest.TestCase):
    def test_radec_overhead(self):
        q = geodetic_to_ecef(0.0, 0.0, 0.0)
        r = geodetic_to_ecef(0.0, 0.0, 800_000.0)
        ra, dec = radec_deg(r, q, T0)
        self.assertAlmostEqual(ra, math.degrees(gmst_rad(T0)) % 360.0, delta=1e-6)
        self.assertAlmostEqual(dec, 0.0, delta=1e-6)

    def test_radec_range_and_polar_direction(self):
        q = geodetic_to_ecef(10.0, 20.0, 0.0)
        ra, dec = radec_deg((q[0], q[1], q[2] + 1000.0), q, T0)
        self.assertAlmostEqual(dec, 90.0, delta=1e-9)
        for lon in (-170.0, -10.0, 0.0, 10.0, 170.0, 359.0):
            r = geodetic_to_ecef(0.0, lon, 800_000.0)
            ra, _ = radec_deg(r, geodetic_to_ecef(0.0, lon, 0.0), T0)
            self.assertGreaterEqual(ra, 0.0)
            self.assertLess(ra, 360.0)
            self.assertAlmostEqual(ra, (math.degrees(gmst_rad(T0)) + lon) % 360.0, delta=1e-6)


class QthGeoTest(unittest.TestCase):
    def test_qth_geo(self):
        q = Qth("THBK", "ที่ทำงาน", "Bangkok", 13.729779, 100.781151, 6.4)
        g = qth_geo(q)
        self.assertIsInstance(g, QthGeo)
        self.assertEqual((g.name, g.location, g.lat_deg, g.lon_deg, g.alt_m), ("THBK", "Bangkok", 13.729779, 100.781151, 6.4))
        self.assertEqual(g.ecef_km, geodetic_to_ecef(13.729779, 100.781151, 6.4))


class ObserveTest(unittest.TestCase):
    def setUp(self):
        self.q = qth_geo(Qth("THBK", "", "Bangkok", 13.729779, 100.781151, 6.4))

    def overhead(self):
        r = geodetic_to_ecef(13.729779, 100.781151, 400_000.0)
        lon = math.radians(100.781151)
        east = (-math.sin(lon), math.cos(lon), 0.0)
        return r, tuple(7.0 * c for c in east)

    def test_observe_keys_match_tick_example(self):
        r, v = self.overhead()
        out = observe(r, v, T0, self.q, elements(), None)
        self.assertEqual(set(out), {"az", "el", "dir", "ra", "dec", "range_km", "range_rate_kms", "lat_deg", "lon_deg",
                                    "ssp", "footprint_km", "alt_km", "vel_kms", "doppler_hz", "loss_db", "delay_ms",
                                    "ma", "phase_deg", "orbit", "vis"})
        self.assertEqual(set(out), set(OBSERVE_KEYS))

    def test_observe_overhead_values(self):
        r, v = self.overhead()
        el = elements()
        out = observe(r, v, T0, self.q, el, None)
        self.assertAlmostEqual(out["el"], 90.0, delta=1e-6)
        self.assertAlmostEqual(out["range_km"], 399.9936, places=6)
        self.assertAlmostEqual(out["range_rate_kms"], 0.0, places=9)
        self.assertAlmostEqual(out["lat_deg"], 13.729779, places=6)
        self.assertAlmostEqual(out["lon_deg"], 100.781151, places=6)
        self.assertAlmostEqual(out["alt_km"], 400.0, places=6)
        self.assertEqual(out["ssp"], "OK03jr")
        self.assertAlmostEqual(out["footprint_km"], footprint_km(out["alt_km"]))
        self.assertAlmostEqual(out["vel_kms"], inertial_speed_kms(r, v))
        self.assertAlmostEqual(out["doppler_hz"], 0.0, places=6)
        self.assertAlmostEqual(out["loss_db"], 72.4 + 20.0 * math.log10(399.9936))
        self.assertAlmostEqual(out["delay_ms"], 399.9936 / 299.792458)
        self.assertEqual(out["orbit"], 1000)
        self.assertEqual(out["dir"], "↷")
        self.assertIn(out["vis"], "VDE")

    def test_observe_matches_building_blocks(self):
        t = T0 + timedelta(seconds=37)
        r_eci, v_eci = kepler_eci(6778.0, 0.001, 51.6, 100.0, 60.0, 200.0)
        r, v = earth_fixed(r_eci, v_eci, t)
        el = elements(epoch=t - timedelta(hours=3))
        out = observe(r, v, t, self.q, el, -0.01)
        az, elev, rng = ecef_to_aer(r, self.q.ecef_km, self.q.lat_deg, self.q.lon_deg)
        self.assertEqual((out["az"], out["el"], out["range_km"]), (az, elev, rng))
        self.assertAlmostEqual(out["phase_deg"], 200.0, delta=1e-6)
        self.assertAlmostEqual(out["ma"], 200.0 * 256.0 / 360.0, delta=1e-6)
        self.assertEqual((out["ra"], out["dec"]), radec_deg(r, self.q.ecef_km, t))
        self.assertEqual(out["vis"], visibility(r, t, self.q.lat_deg, self.q.lon_deg, elev))
        self.assertEqual(out["orbit"], orbit_number(el, t))
        self.assertAlmostEqual(out["doppler_hz"], doppler_hz(out["range_rate_kms"]))

    def test_range_rate_is_the_time_derivative_of_range(self):
        r_eci, v_eci = kepler_eci(6778.0, 0.001, 51.6, 100.0, 60.0, 200.0)
        r, v = earth_fixed(r_eci, v_eci, T0)
        rate = observe(r, v, T0, self.q, elements(), None)["range_rate_kms"]
        h = 1e-3
        r2 = tuple(a + h * b for a, b in zip(r, v))
        r1 = tuple(a - h * b for a, b in zip(r, v))
        numeric = (ecef_to_aer(r2, self.q.ecef_km, 0, 0)[2] - ecef_to_aer(r1, self.q.ecef_km, 0, 0)[2]) / (2 * h)
        self.assertAlmostEqual(rate, numeric, places=6)

    def test_observe_direction_uses_previous_rate_and_orbit_class(self):
        r, v = self.overhead()                                     # range rate ≈ 0
        self.assertEqual(observe(r, v, T0, self.q, elements(), 0.5)["dir"], "↺")              # 0 < 0.5
        self.assertEqual(observe(r, v, T0, self.q, elements(), -0.5)["dir"], "↷")
        self.assertEqual(observe(r, v, T0, self.q, elements(mean_motion=1.0027), 0.5)["dir"], "G")
        decayed = elements(ndot2=0.001, mean_motion=15.9, epoch=T0 - timedelta(days=80))
        self.assertEqual(observe(r, v, T0, self.q, decayed, 0.5)["dir"], "D")

    def test_observe_values_are_plain_floats_ints_and_strings(self):
        r, v = self.overhead()
        out = observe(r, v, T0, self.q, elements(), None)
        for key, value in out.items():
            expected = int if key == "orbit" else str if key in ("dir", "ssp", "vis") else float
            self.assertIs(type(value), expected, key)


if __name__ == "__main__":
    unittest.main()
