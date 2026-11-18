import math
import unittest
from datetime import datetime, timedelta, timezone

from gnss_predict.astro import (ecef_to_eci, eci_to_ecef, gmst_rad, julian_date, subpoint,
                                sun_ecef_km, sun_eci_km)
from gnss_predict.geometry import ecef_to_geodetic

UTC = timezone.utc
AU_KM = 149597870.7


def _wrap180(deg: float) -> float:
    return (deg + 180.0) % 360.0 - 180.0


class TestJulianDate(unittest.TestCase):
    def test_j2000(self):
        self.assertAlmostEqual(julian_date(datetime(2000, 1, 1, 12, tzinfo=UTC)), 2451545.0, delta=1e-9)

    def test_meeus_example(self):
        # Meeus ตัวอย่าง 7.a: 1957-10-04.81 → JD 2436116.31
        self.assertAlmostEqual(julian_date(datetime(1957, 10, 4, 19, 26, 24, tzinfo=UTC)), 2436116.31, delta=1e-6)

    def test_non_utc_aware_datetime_is_converted(self):
        tz = timezone(timedelta(hours=7))
        self.assertAlmostEqual(julian_date(datetime(2000, 1, 1, 19, tzinfo=tz)), 2451545.0, delta=1e-9)


class TestGmst(unittest.TestCase):
    def test_gmst_meeus_12a(self):
        self.assertAlmostEqual(math.degrees(gmst_rad(datetime(1987, 4, 10, tzinfo=UTC))), 197.693195, delta=1e-5)

    def test_gmst_meeus_12b(self):
        self.assertAlmostEqual(math.degrees(gmst_rad(datetime(1987, 4, 10, 19, 21, tzinfo=UTC))),
                               128.7378734, delta=1e-5)

    def test_gmst_in_range(self):
        t = datetime(2026, 1, 1, tzinfo=UTC)
        for k in range(0, 400, 7):
            g = gmst_rad(t + timedelta(hours=k * 1.3))
            self.assertGreaterEqual(g, 0.0)
            self.assertLess(g, 2 * math.pi)

    def test_gmst_rate_per_hour(self):
        t = datetime(2026, 11, 11, tzinfo=UTC)
        d = (gmst_rad(t + timedelta(hours=1)) - gmst_rad(t)) % (2 * math.pi)
        self.assertAlmostEqual(math.degrees(d), 15.0410686, delta=1e-5)


class TestSun(unittest.TestCase):
    def test_sun_meeus_25a(self):
        x, y, z = sun_eci_km(datetime(1992, 10, 13, tzinfo=UTC))
        self.assertAlmostEqual(math.degrees(math.atan2(y, x)) % 360, 198.38083, delta=0.01)
        self.assertAlmostEqual(math.degrees(math.asin(z / math.dist((0, 0, 0), (x, y, z)))), -7.78507, delta=0.01)
        self.assertAlmostEqual(math.dist((0, 0, 0), (x, y, z)) / AU_KM, 0.99766, delta=1e-4)

    def test_sun_subpoint_matches_ra_minus_gmst(self):
        for t in (datetime(1992, 10, 13, 6, tzinfo=UTC), datetime(2026, 11, 11, 3, 30, tzinfo=UTC),
                  datetime(2026, 6, 21, 18, tzinfo=UTC)):
            x, y, z = sun_eci_km(t)
            ra = math.degrees(math.atan2(y, x))
            dec = math.degrees(math.asin(z / math.dist((0, 0, 0), (x, y, z))))
            lat, lon = subpoint(sun_ecef_km(t))
            self.assertAlmostEqual(lat, dec, delta=0.01)
            self.assertAlmostEqual(_wrap180(lon - _wrap180(ra - math.degrees(gmst_rad(t)))), 0.0, delta=0.01)

    def test_sun_distance_range(self):
        for month in range(1, 13):
            r = math.dist((0, 0, 0), sun_eci_km(datetime(2026, month, 1, tzinfo=UTC))) / AU_KM
            self.assertGreater(r, 0.98)
            self.assertLess(r, 1.02)

    def test_sun_ecef_norm_equals_eci_norm(self):
        t = datetime(2026, 3, 20, 9, tzinfo=UTC)
        self.assertAlmostEqual(math.dist((0, 0, 0), sun_ecef_km(t)), math.dist((0, 0, 0), sun_eci_km(t)), delta=1e-6)


class TestFrameRotation(unittest.TestCase):
    def test_round_trip(self):
        t = datetime(2026, 11, 11, 4, 5, 6, tzinfo=UTC)
        v = (7000.0, -1234.5, 4321.0)
        back = eci_to_ecef(ecef_to_eci(v, t), t)
        for a, b in zip(back, v):
            self.assertAlmostEqual(a, b, delta=1e-9)

    def test_z_is_unchanged_and_norm_preserved(self):
        t = datetime(2026, 11, 11, 4, tzinfo=UTC)
        v = (7000.0, -1234.5, 4321.0)
        w = eci_to_ecef(v, t)
        self.assertAlmostEqual(w[2], v[2], delta=1e-12)
        self.assertAlmostEqual(math.dist((0, 0, 0), w), math.dist((0, 0, 0), v), delta=1e-9)

    def test_eci_to_ecef_rotates_by_minus_gmst(self):
        # แกน x ของ ECI ชี้ที่จุดวสันตวิษุวัต; ใน ECEF จะอยู่ที่ลองจิจูด −GMST
        t = datetime(1987, 4, 10, 19, 21, tzinfo=UTC)
        x, y, z = eci_to_ecef((1.0, 0.0, 0.0), t)
        lon = math.degrees(math.atan2(y, x))
        self.assertAlmostEqual(_wrap180(lon + math.degrees(gmst_rad(t))), 0.0, delta=1e-9)
        self.assertAlmostEqual(z, 0.0, delta=1e-15)

    def test_ecef_to_eci_rotates_by_plus_gmst(self):
        # จุดที่ลองจิจูด 0 ใน ECEF จะมี RA = GMST ใน ECI
        t = datetime(2026, 11, 11, 4, tzinfo=UTC)
        x, y, _ = ecef_to_eci((1.0, 0.0, 0.0), t)
        self.assertAlmostEqual(_wrap180(math.degrees(math.atan2(y, x)) - math.degrees(gmst_rad(t))), 0.0, delta=1e-9)


class TestSubpoint(unittest.TestCase):
    def test_cardinal_points(self):
        self.assertEqual(subpoint((7000.0, 0.0, 0.0)), (0.0, 0.0))
        lat, lon = subpoint((0.0, 7000.0, 0.0))
        self.assertAlmostEqual(lat, 0.0, delta=1e-12)
        self.assertAlmostEqual(lon, 90.0, delta=1e-12)
        lat, lon = subpoint((-7000.0, 0.0, 0.0))
        self.assertAlmostEqual(abs(lon), 180.0, delta=1e-12)

    def test_is_geodetic_and_matches_ecef_to_geodetic(self):
        # subpoint ใช้ละติจูด geodetic ของ WGS84 (ไม่ใช่ geocentric): 45° geocentric ≈ 45.19° geodetic
        pos = (5000.0, 0.0, 5000.0)
        lat, lon = subpoint(pos)
        self.assertEqual((lat, lon), ecef_to_geodetic(*pos)[:2])
        self.assertGreater(lat, 45.1)
        self.assertLess(lat, 45.3)

    def test_pole_returns_lon_zero(self):
        lat, lon = subpoint((0.0, 0.0, 7000.0))
        self.assertAlmostEqual(lat, 90.0, delta=1e-12)
        self.assertEqual(lon, 0.0)


if __name__ == "__main__":
    unittest.main()
