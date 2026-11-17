import json
import shutil
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from gnss_predict.catalog import Catalog, CatalogSatellite, build_catalog
from gnss_predict.errors import OrbitUnavailableError
from gnss_predict.imaging import (GEO_AGE_OK_DAYS, GEO_AGE_SHOWN_MAX_DAYS, GEO_MEAN_MOTION_MAX, IMAGING_GROUPS,
                                  IMAGING_LETTER, IMAGING_NORADS, IMAGING_SATELLITES, build_imaging_catalog,
                                  imaging_group_files, preset_by_norad)

FXS = Path(__file__).parent / "fixtures" / "studio"
SNAP = FXS / "snapshot"
IMG = FXS / "imaging"
DEEP_JSON = "[" * 200_000 + "]" * 200_000        # ไฟล์ร้าย: json.loads ให้ RecursionError


def T(*a):
    return datetime(*a, tzinfo=timezone.utc)


PERIOD = (T(2026, 11, 10, 0), T(2026, 11, 10, 6))
MID = T(2026, 11, 10, 3)

SPEC_LIST = [("X01", 41836), ("X02", 51850), ("X03", 60133), ("X04", 25994),
             ("X05", 27424), ("X06", 37849), ("X07", 43013), ("X08", 54234)]


def sat(c: Catalog, prn: str) -> CatalogSatellite:
    return next(s for s in c.satellites if s.prn == prn)


def codes(c: Catalog, code: str) -> list:
    return [m for m in c.messages if m.code == code]


class TempSnapshot(unittest.TestCase):
    """snapshot ชั่วคราว = snapshot GNSS ของ fixture + ไฟล์กลุ่ม imaging"""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.gnss_only = Path(self._tmp.name) / "gnss_only"
        shutil.copytree(SNAP, self.gnss_only)
        self.snap = Path(self._tmp.name) / "snapshot"
        shutil.copytree(SNAP, self.snap)
        for f in IMG.glob("*.json"):
            shutil.copy(f, self.snap / f.name)


class TestPresets(unittest.TestCase):
    def test_constants(self):
        self.assertEqual(IMAGING_LETTER, "X")
        self.assertEqual(IMAGING_GROUPS, ("weather", "science", "visual"))
        self.assertEqual((GEO_MEAN_MOTION_MAX, GEO_AGE_OK_DAYS, GEO_AGE_SHOWN_MAX_DAYS), (1.1, 7.0, 14.0))

    def test_presets_table(self):
        self.assertEqual([(p.prn, p.norad) for p in IMAGING_SATELLITES], SPEC_LIST)
        self.assertEqual([p.name for p in IMAGING_SATELLITES],
                         ["Himawari-9", "GOES-18", "GOES-19", "Terra", "Aqua", "Suomi NPP", "NOAA-20", "NOAA-21"])
        self.assertEqual([p.block for p in IMAGING_SATELLITES],
                         ["Himawari-8/9", "GOES-R", "GOES-R", "EOS AM-1", "EOS PM-1", "JPSS", "JPSS", "JPSS"])
        self.assertEqual([p.groups for p in IMAGING_SATELLITES],
                         [("weather",), ("weather",), ("weather",), ("science", "visual"), ("visual",),
                          ("weather",), ("weather",), ("weather",)])
        self.assertEqual([p.camera for p in IMAGING_SATELLITES],
                         ["AHI", "ABI", "ABI", "MODIS", "MODIS", "VIIRS", "VIIRS", "VIIRS"])
        geo = {"type": "Simple Conic", "cone_half_angle": 8.7}
        modis = {"type": "Rectangular", "vertical_half_angle": 55.0, "horizontal_half_angle": 0.41}
        viirs = {"type": "Rectangular", "vertical_half_angle": 56.28, "horizontal_half_angle": 0.42}
        self.assertEqual([p.sensor.definition() for p in IMAGING_SATELLITES],
                         [geo, geo, geo, modis, modis, viirs, viirs, viirs])
        self.assertEqual([p.gibs_layer for p in IMAGING_SATELLITES], [
            "Himawari_AHI_Band3_Red_Visible_1km", "GOES-West_ABI_GeoColor", "GOES-East_ABI_GeoColor",
            "MODIS_Terra_CorrectedReflectance_TrueColor", "MODIS_Aqua_CorrectedReflectance_TrueColor",
            "VIIRS_SNPP_CorrectedReflectance_TrueColor", "VIIRS_NOAA20_CorrectedReflectance_TrueColor",
            "VIIRS_NOAA21_CorrectedReflectance_TrueColor"])
        for p in IMAGING_SATELLITES:
            self.assertIsInstance(p.gibs_layer, str)
            self.assertTrue(p.gibs_layer, p.prn)

    def test_lookup_by_norad(self):
        self.assertEqual(IMAGING_NORADS, frozenset(n for _, n in SPEC_LIST))
        self.assertEqual(preset_by_norad(25994).prn, "X04")
        self.assertIsNone(preset_by_norad(60243))
        self.assertIsNone(preset_by_norad(99001))


class TestImagingCatalog(TempSnapshot):
    def test_matches_by_norad_only(self):
        c = build_imaging_catalog(self.snap, PERIOD)
        self.assertEqual(sorted(s.norad for s in c.satellites), sorted(n for _, n in SPEC_LIST))
        self.assertEqual([s.prn for s in c.satellites], [p for p, _ in SPEC_LIST])
        self.assertEqual(c.unmapped, [])
        unmapped_norads = {u["norad"] for u in c.unmapped}
        for decoy in (60243, 99001):
            self.assertNotIn(decoy, {s.norad for s in c.satellites})
            self.assertNotIn(decoy, unmapped_norads)
        x04 = sat(c, "X04")
        self.assertEqual((x04.system, x04.svn, x04.block, x04.celestrak_name), ("X", "", "EOS AM-1", "TERRA"))
        self.assertEqual(sat(c, "X07").celestrak_name, "NOAA 20 (JPSS-1)")
        self.assertEqual(len(x04.tle_lines), 2)
        self.assertTrue(x04.tle_lines[0].startswith("1 25994U"))

    def test_newest_epoch_wins(self):
        c = build_imaging_catalog(self.snap, PERIOD)
        self.assertEqual(sat(c, "X04").omm_epoch, MID - timedelta(days=0.5))
        self.assertAlmostEqual(sat(c, "X04").age_days, 0.5)

    def test_newest_epoch_wins_when_in_earlier_file(self):
        # สลับ EPOCH ของ Terra: record ใหม่กว่าอยู่ใน science.json ซึ่งอ่านก่อน visual.json
        science, visual = self.snap / "science.json", self.snap / "visual.json"
        sci, vis = json.loads(science.read_text()), json.loads(visual.read_text())
        s_rec = next(r for r in sci if r["NORAD_CAT_ID"] == 25994)
        v_rec = next(r for r in vis if r["NORAD_CAT_ID"] == 25994)
        s_rec["EPOCH"], v_rec["EPOCH"] = v_rec["EPOCH"], s_rec["EPOCH"]
        science.write_text(json.dumps(sci))
        visual.write_text(json.dumps(vis))
        c = build_imaging_catalog(self.snap, PERIOD)
        self.assertEqual(sat(c, "X04").omm_epoch, MID - timedelta(days=0.5))
        self.assertEqual(sat(c, "X04").tle_lines[1].split()[-1][:11], "14.57320000")   # MEAN_MOTION ของ science

    def test_age_flags_geo_and_leo(self):
        c = build_imaging_catalog(self.snap, PERIOD)
        self.assertEqual(sat(c, "X01").flags, frozenset())
        self.assertEqual(sat(c, "X02").flags, frozenset({"stale"}))
        self.assertEqual(sat(c, "X03").flags, frozenset({"too_old"}))
        self.assertEqual(sat(c, "X08").flags, frozenset({"stale"}))
        self.assertEqual(sat(c, "X06").flags, frozenset({"too_old"}))
        self.assertEqual(sat(c, "X04").flags, frozenset())
        flagged = {m.object: m for m in codes(c, "SAT_FLAGGED")}
        self.assertEqual(set(flagged), {"X02", "X03", "X06", "X08"})
        self.assertIn("เก่ากว่า 7 วัน", flagged["X02"].text)
        self.assertIn("เก่ากว่า 2 วัน", flagged["X08"].text)
        self.assertIn("เก่าเกิน 14 วัน", flagged["X03"].text)
        self.assertIn("เก่าเกิน 7 วัน", flagged["X06"].text)
        self.assertTrue(all(m.level == "warning" for m in flagged.values()))

    def test_missing_is_tle_unavailable(self):
        visual = self.snap / "visual.json"
        records = [r for r in json.loads(visual.read_text()) if r["NORAD_CAT_ID"] != 27424]
        visual.write_text(json.dumps(records))
        c = build_imaging_catalog(self.snap, PERIOD)
        self.assertEqual(c.unmapped, [{"norad": 27424, "celestrak_name": "", "object_id": "",
                                       "reason": "TLE_UNAVAILABLE"}])
        self.assertNotIn("X05", [s.prn for s in c.satellites])

    def test_no_gnss_flags(self):
        self.assertTrue((self.snap / "brdc").is_dir())
        c = build_imaging_catalog(self.snap, PERIOD)
        gnss_flags = {"no_broadcast", "unhealthy", "prn_changed", "name_mismatch"}
        for s in c.satellites:
            self.assertEqual(s.flags & gnss_flags, frozenset(), s.prn)
            self.assertLessEqual(s.flags, {"stale", "too_old"}, s.prn)
        self.assertEqual(codes(c, "BRDC_UNAVAILABLE"), [])

    def test_unreadable_group_is_skipped(self):
        (self.snap / "weather.json").write_bytes(b"not json")
        c = build_imaging_catalog(self.snap, PERIOD)
        (warn,) = codes(c, "IMAGING_GROUP_UNREADABLE")
        self.assertEqual(warn.level, "warning")
        self.assertIn("weather", warn.text)
        self.assertEqual([s.prn for s in c.satellites], ["X04", "X05"])
        weather_only = [41836, 51850, 60133, 37849, 43013, 54234]          # X01–X03, X06–X08
        self.assertEqual(c.unmapped, [{"norad": n, "celestrak_name": "", "object_id": "",
                                       "reason": "TLE_UNAVAILABLE"} for n in weather_only])

    def test_infinite_norad_is_unreadable_group(self):
        # NORAD_CAT_ID เป็น Infinity: int(inf) ให้ OverflowError ต้องกลายเป็นกลุ่มที่อ่านไม่ได้ ไม่หลุดออกมา
        (self.snap / "weather.json").write_text('[{"NORAD_CAT_ID": Infinity, "EPOCH": "2026-11-09T00:00:00"}]')
        c = build_imaging_catalog(self.snap, PERIOD)
        self.assertEqual(len(codes(c, "IMAGING_GROUP_UNREADABLE")), 1)
        self.assertEqual([s.prn for s in c.satellites], ["X04", "X05"])

    def test_deeply_nested_group_is_unreadable_group(self):
        # JSON ซ้อนลึกจน json.loads ให้ RecursionError: ต้องเป็นกลุ่มที่อ่านไม่ได้ (ข้ามกลุ่ม) ไม่หลุดเป็น 500 ของ server
        (self.snap / "weather.json").write_text(DEEP_JSON)
        c = build_imaging_catalog(self.snap, PERIOD)
        (msg,) = codes(c, "IMAGING_GROUP_UNREADABLE")
        self.assertEqual(msg.level, "warning")
        self.assertIn("weather", msg.text)
        self.assertEqual([s.prn for s in c.satellites], ["X04", "X05"])

    def test_age_boundaries(self):
        # (MEAN_MOTION, อายุเป็นวัน, ธงที่คาด) เกณฑ์ใช้ ">" จึงอายุเท่ากับเกณฑ์พอดียังไม่ตั้งธงนั้น
        cases = [
            (1.0027, 7.0, frozenset()),              # GEO ครบ 7 วันพอดี: ยังไม่ stale
            (1.0027, 14.0, frozenset({"stale"})),    # GEO ครบ 14 วันพอดี: stale ยังไม่ too_old
            (14.2, 2.0, frozenset()),                # LEO ครบ 2 วันพอดี: ยังไม่ stale
            (14.2, 7.0, frozenset({"stale"})),       # LEO ครบ 7 วันพอดี: stale ยังไม่ too_old
            (1.1, 5.0, frozenset({"stale"})),        # 1.1 พอดีไม่ใช่ GEO: ใช้เกณฑ์ LEO
            (1.1, 8.0, frozenset({"too_old"})),
        ]
        template = next(r for r in json.loads((IMG / "weather.json").read_text()) if r["NORAD_CAT_ID"] == 41836)
        for mean_motion, age, expected in cases:
            with self.subTest(mean_motion=mean_motion, age=age):
                rec = dict(template, MEAN_MOTION=mean_motion,
                           EPOCH=(MID - timedelta(days=age)).replace(tzinfo=None).isoformat(timespec="microseconds"))
                (self.snap / "weather.json").write_text(json.dumps([rec]))
                x01 = sat(build_imaging_catalog(self.snap, PERIOD), "X01")
                self.assertEqual(x01.age_days, age)
                self.assertEqual(x01.flags, expected)

    def test_group_files(self):
        self.assertEqual(imaging_group_files(self.gnss_only), [])
        self.assertEqual(imaging_group_files(self.snap), ["weather.json", "science.json", "visual.json"])

    def test_no_imaging_files_gives_empty_catalog(self):
        c = build_imaging_catalog(self.gnss_only, PERIOD)
        self.assertEqual((c.satellites, c.unmapped, c.messages), ([], [], []))


class TestGnssPath(unittest.TestCase):
    def test_gnss_stale_text_uses_gnss_thresholds(self):
        c = build_catalog(SNAP, (T(2026, 11, 10), T(2026, 11, 11)), set("GREC"))
        (msg,) = [m for m in c.messages if m.code == "SAT_FLAGGED" and m.object == "C40"]
        self.assertIn("เก่ากว่า 2 วัน", msg.text)

    def test_gnss_infinite_norad_is_orbit_unavailable(self):
        # ทาง GNSS: OverflowError จาก NORAD_CAT_ID = Infinity ต้องเป็น OrbitUnavailableError ของกลุ่มนั้น
        with tempfile.TemporaryDirectory() as tmp:
            snap = Path(tmp) / "snapshot"
            shutil.copytree(SNAP, snap)
            (snap / "galileo.json").write_text('[{"NORAD_CAT_ID": Infinity, "EPOCH": "2026-11-09T00:00:00"}]')
            with self.assertRaises(OrbitUnavailableError) as cm:
                build_catalog(snap, (T(2026, 11, 10), T(2026, 11, 11)), set("GREC"))
            self.assertIn("galileo", str(cm.exception))


    def test_gnss_deeply_nested_group_is_orbit_unavailable(self):
        # ทาง GNSS: RecursionError จาก JSON ซ้อนลึกต้องเป็น OrbitUnavailableError ของกลุ่มนั้น (server ตอบ 422 ไม่ใช่ 500)
        with tempfile.TemporaryDirectory() as tmp:
            snap = Path(tmp) / "snapshot"
            shutil.copytree(SNAP, snap)
            (snap / "galileo.json").write_text(DEEP_JSON)
            with self.assertRaises(OrbitUnavailableError) as cm:
                build_catalog(snap, (T(2026, 11, 10), T(2026, 11, 11)), set("GREC"))
            self.assertIn("galileo", str(cm.exception))


if __name__ == "__main__":
    unittest.main()
