import math
import unittest
from gnss_predict.geometry import (sez_to_az_el, ipp, mapping_factor, ecef_to_az_el, geodetic_to_ecef, ecef_to_aer,
                                   ecef_to_geodetic)
from gnss_predict.config import THBK_LAT_DEG, THBK_LON_DEG, THBK_HEIGHT_M, THBK_ECEF_M, WGS84_A_KM, WGS84_F


class TestSezToAzEl(unittest.TestCase):
    def test_zenith(self):
        self.assertAlmostEqual(sez_to_az_el(0, 0, 20000)[1], 90.0, places=9)

    def test_cardinal_directions(self):
        for (s, e), az_exp in {(-20000, 0): 0.0, (0, 20000): 90.0, (20000, 0): 180.0, (0, -20000): 270.0}.items():
            az, el = sez_to_az_el(s, e, 0)
            self.assertAlmostEqual(az, az_exp, places=9)
            self.assertAlmostEqual(el, 0.0, places=9)

    def test_az_always_in_0_360(self):
        # e ติดลบนิดเดียว: atan2 ได้ราว −2.9e-16 องศา และค่านี้ % 360 ได้ 360.0 พอดีใน float
        for s, e in [(-20000, -1e-13), (-20000, 0.0), (-20000, -0.0), (5, -5), (-5, -5)]:
            az, _ = sez_to_az_el(s, e, 100)
            self.assertGreaterEqual(az, 0.0)
            self.assertLess(az, 360.0)


class TestMappingFactor(unittest.TestCase):
    def test_reference_values(self):
        for el, mf in [(90, 1.00000), (30, 0.57965), (10, 0.37598)]:
            self.assertAlmostEqual(mapping_factor(el), mf, places=5)

    def test_matches_t02_5_formula(self):
        for el in range(0, 91, 5):
            ref = math.sqrt(1.0 - (6371.0 * math.cos(math.radians(el)) / (6371.0 + 400.0)) ** 2)
            self.assertAlmostEqual(mapping_factor(el), ref, places=12)


class TestIpp(unittest.TestCase):
    def test_zenith_is_station(self):
        lat, lon = ipp(THBK_LAT_DEG, THBK_LON_DEG, 123.0, 90.0)
        self.assertAlmostEqual(lat, THBK_LAT_DEG, places=9)
        self.assertAlmostEqual(lon, THBK_LON_DEG, places=9)

    def test_north_el30(self):
        lat, lon = ipp(THBK_LAT_DEG, THBK_LON_DEG, 0.0, 30.0)
        self.assertAlmostEqual(lat, THBK_LAT_DEG + 5.4260, places=4)
        self.assertAlmostEqual(lon, THBK_LON_DEG, places=9)

    def test_east_west(self):
        self.assertGreater(ipp(THBK_LAT_DEG, THBK_LON_DEG, 90.0, 30.0)[1], THBK_LON_DEG)
        self.assertLess(ipp(THBK_LAT_DEG, THBK_LON_DEG, 270.0, 30.0)[1], THBK_LON_DEG)

    def test_dateline_wrap(self):
        _, lon = ipp(0.0, 179.9, 90.0, 30.0)
        self.assertGreater(lon, -180.0)
        self.assertLessEqual(lon, 180.0)
        self.assertLess(lon, 0.0)


class TestEcefToAzEl(unittest.TestCase):
    STA = (6378.137, 0.0, 0.0)   # (lat 0, lon 0) บนผิวโลก

    def test_overhead(self):
        self.assertAlmostEqual(ecef_to_az_el((26000.0, 0.0, 0.0), self.STA, 0.0, 0.0)[1], 90.0, places=9)

    def test_north(self):
        az, el = ecef_to_az_el((26000.0, 0.0, 5000.0), self.STA, 0.0, 0.0)
        self.assertAlmostEqual(az, 0.0, places=9)
        self.assertTrue(0.0 < el < 90.0)

    def test_consistent_with_sez(self):
        # ที่ (0°, 0°): N = dz, E = dy, U = dx  ดังนั้น S = −dz, Z = dx
        for d in [(15000.0, 3000.0, -4000.0), (2000.0, -9000.0, 7000.0), (100.0, 1.0, -20000.0)]:
            sat = tuple(a + b for a, b in zip(self.STA, d))
            got = ecef_to_az_el(sat, self.STA, 0.0, 0.0)
            exp = sez_to_az_el(-d[2], d[1], d[0])
            self.assertAlmostEqual(got[0], exp[0], places=9)
            self.assertAlmostEqual(got[1], exp[1], places=9)


class TestGeodeticToEcef(unittest.TestCase):
    def test_geodetic_to_ecef_matches_thbk_header(self):
        x, y, z = geodetic_to_ecef(THBK_LAT_DEG, THBK_LON_DEG, THBK_HEIGHT_M)
        for got, ref in zip((x, y, z), THBK_ECEF_M):
            self.assertAlmostEqual(got, ref / 1000, delta=0.001)       # ≤ 1 ม. (ผลจริงราว 6 ซม.)

    def test_equator_and_poles(self):
        a, b = 6378.137, 6378.137 * (1 - 1 / 298.257223563)
        for got, ref in zip(geodetic_to_ecef(0.0, 0.0, 0.0), (a, 0.0, 0.0)):
            self.assertAlmostEqual(got, ref, places=9)
        for got, ref in zip(geodetic_to_ecef(0.0, 90.0, 1000.0), (0.0, a + 1.0, 0.0)):
            self.assertAlmostEqual(got, ref, places=9)
        for got, ref in zip(geodetic_to_ecef(90.0, 0.0, 0.0), (0.0, 0.0, b)):
            self.assertAlmostEqual(got, ref, places=9)

    def test_height_adds_along_the_normal(self):
        lo = geodetic_to_ecef(45.0, 30.0, 0.0)
        hi = geodetic_to_ecef(45.0, 30.0, 10000.0)
        self.assertAlmostEqual(math.dist(lo, hi), 10.0, places=9)


class TestEcefToGeodetic(unittest.TestCase):
    def test_round_trip(self):
        count = 0
        for lat in (-89.5, -45.0, 0.0, 13.729779, 60.0, 89.5):
            for lon in (-179.9, 0.0, 100.781151, 180.0):
                for h_m in (0.0, 6.4, 20_000_000.0):
                    lat2, lon2, h2 = ecef_to_geodetic(*geodetic_to_ecef(lat, lon, h_m))
                    with self.subTest(lat=lat, lon=lon, h_m=h_m):
                        self.assertAlmostEqual(lat2, lat, delta=1e-9)
                        # lon = 180 ที่ได้คืนเป็น 180 (ช่วง (−180, 180]) ตรงกับค่าที่ใส่เข้าไป
                        self.assertAlmostEqual(lon2, lon, delta=1e-9)
                        self.assertAlmostEqual(h2, h_m / 1000.0, delta=1e-6)          # 1 มม.
                    count += 1
        self.assertEqual(count, 72)

    def test_poles(self):
        b = WGS84_A_KM * (1.0 - WGS84_F)
        lat, _, h = ecef_to_geodetic(0.0, 0.0, b)
        self.assertAlmostEqual(lat, 90.0, delta=1e-9)
        self.assertAlmostEqual(h, 0.0, delta=1e-6)
        lat, _, h = ecef_to_geodetic(0.0, 0.0, -b - 1.0)                      # ไม่หารด้วยศูนย์ที่ p = 0
        self.assertAlmostEqual(lat, -90.0, delta=1e-9)
        self.assertAlmostEqual(h, 1.0, delta=1e-6)

    def test_equator(self):
        for got, ref in zip(ecef_to_geodetic(6378.137, 0.0, 0.0), (0.0, 0.0, 0.0)):
            self.assertAlmostEqual(got, ref, delta=1e-9)
        for got, ref in zip(ecef_to_geodetic(0.0, 6378.137 + 20000.0, 0.0), (0.0, 90.0, 20000.0)):
            self.assertAlmostEqual(got, ref, delta=1e-9)

    def test_lon_range(self):
        lon = ecef_to_geodetic(-6378.137, 0.0, 0.0)[1]
        self.assertEqual(lon, 180.0)                                          # ไม่ใช่ −180.0
        self.assertEqual(ecef_to_geodetic(-6378.137, -0.0, 0.0)[1], 180.0)    # y = −0.0 ก็ต้องได้ 180


class TestEcefToAer(unittest.TestCase):
    def test_ecef_to_aer_zenith(self):
        sta = geodetic_to_ecef(0.0, 0.0, 0.0)
        az, el, rng = ecef_to_aer((sta[0] + 20000.0, sta[1], sta[2]), sta, 0.0, 0.0)
        self.assertAlmostEqual(el, 90.0, places=6)
        self.assertAlmostEqual(rng, 20000.0, places=6)

    def test_matches_ecef_to_az_el_and_range(self):
        sta = geodetic_to_ecef(THBK_LAT_DEG, THBK_LON_DEG, THBK_HEIGHT_M)
        sat = (sta[0] + 12000.0, sta[1] - 8000.0, sta[2] + 15000.0)
        az, el, rng = ecef_to_aer(sat, sta, THBK_LAT_DEG, THBK_LON_DEG)
        self.assertEqual((az, el), ecef_to_az_el(sat, sta, THBK_LAT_DEG, THBK_LON_DEG))
        self.assertAlmostEqual(rng, math.sqrt(12000.0 ** 2 + 8000.0 ** 2 + 15000.0 ** 2), places=9)


if __name__ == "__main__":
    unittest.main()
