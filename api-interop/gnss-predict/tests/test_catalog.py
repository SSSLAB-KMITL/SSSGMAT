import json
import shutil
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from gnss_predict.catalog import DOP_EXCLUDED_FLAGS, Catalog, CatalogSatellite, build_catalog, is_shown
from gnss_predict.errors import IgsMetadataUnavailableError, OrbitUnavailableError
from gnss_predict.omm import read_omm, to_tle_lines

FXS = Path(__file__).parent / "fixtures" / "studio"
SNAP = FXS / "snapshot"
ALL = set("GREC")


def T(*a):
    return datetime(*a, tzinfo=timezone.utc)


PERIOD = (T(2026, 11, 10), T(2026, 11, 11))


def sat(c: Catalog, prn: str) -> CatalogSatellite:
    return next(s for s in c.satellites if s.prn == prn)


def omm_record(norad: int):
    for path in SNAP.glob("*.json"):
        for rec in read_omm(path):
            if rec.norad == norad:
                return rec
    raise KeyError(norad)


def codes(c: Catalog, code: str) -> list:
    return [m for m in c.messages if m.code == code]


class TempSnapshot(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.snap = Path(self._tmp.name) / "snapshot"
        shutil.copytree(SNAP, self.snap)


class TestBuildCatalog(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.c = build_catalog(SNAP, PERIOD, ALL)

    def test_flags_match_design(self):
        c = self.c
        self.assertEqual({s.prn: set(s.flags) for s in c.satellites}, {
            "G01": set(), "G22": {"no_broadcast"}, "E11": set(), "E14": {"unhealthy"}, "R05": set(),
            "R10": {"too_old", "no_broadcast"}, "C01": {"name_mismatch"},
            "C40": {"stale", "name_mismatch"}, "C09": {"name_mismatch"}})
        self.assertEqual([u["norad"] for u in c.unmapped], [36828])
        self.assertEqual(c.unmapped[0]["reason"], "NO_PRN")
        self.assertEqual(c.unmapped[0]["celestrak_name"], "BEIDOU-2 IGSO-1 (C06)")
        self.assertEqual(c.unmapped[0]["object_id"], "2010-036A")

    def test_flags_are_frozensets(self):
        for s in self.c.satellites:
            self.assertIsInstance(s.flags, frozenset)

    def test_identity_from_igs(self):
        c01 = sat(self.c, "C01")
        self.assertEqual((c01.svn, c01.norad, c01.celestrak_name), ("C231", 56564, "BEIDOU-3 G4 (C62)"))
        self.assertEqual(c01.system, "C")
        self.assertEqual(c01.block, "BDS-3G")
        self.assertEqual(c01.tle_lines, to_tle_lines(omm_record(56564)))
        self.assertEqual(c01.omm_epoch, omm_record(56564).epoch)
        g01 = sat(self.c, "G01")
        self.assertEqual((g01.svn, g01.norad, g01.system, g01.block), ("G080", 62339, "G", "GPS-IIIA"))
        # ดวงเลข 6 หลักก็ได้ TLE (Alpha-5)
        r10 = sat(self.c, "R10")
        self.assertEqual((r10.svn, r10.norad, r10.system), ("R809", 100744, "R"))
        self.assertEqual(r10.tle_lines, to_tle_lines(omm_record(100744)))

    def test_age_is_midpoint_distance_in_days(self):
        mid = T(2026, 11, 10, 12)
        for s in self.c.satellites:
            expected = abs((mid - omm_record(s.norad).epoch).total_seconds()) / 86400
            self.assertAlmostEqual(s.age_days, expected, places=9, msg=s.prn)
        self.assertAlmostEqual(sat(self.c, "C40").age_days, 2.354, places=3)

    def test_satellites_sorted_by_prn(self):
        prns = [s.prn for s in self.c.satellites]
        self.assertEqual(prns, sorted(prns))

    def test_sat_flagged_messages(self):
        flagged = {m.object: m for m in codes(self.c, "SAT_FLAGGED")}
        self.assertEqual(set(flagged), {"G22", "E14", "R10", "C01", "C40", "C09"})   # ดวงไม่มีธงไม่มีข้อความ
        for prn in ("G22", "E14", "R10", "C40"):
            self.assertEqual(flagged[prn].level, "warning", prn)
        for prn in ("C01", "C09"):                       # name_mismatch อย่างเดียวเป็น info
            self.assertEqual(flagged[prn].level, "info", prn)
        self.assertEqual(len(codes(self.c, "SAT_FLAGGED")), 6)               # หนึ่งข้อความต่อดวง
        for m in flagged.values():
            self.assertTrue(any("฀" <= ch <= "๿" for ch in m.text), m.text)    # ข้อความเป็นภาษาไทย

    def test_no_brdc_message_when_brdc_present(self):
        self.assertEqual(codes(self.c, "BRDC_UNAVAILABLE"), [])

    def test_is_shown_defaults(self):
        c = self.c
        self.assertFalse(is_shown(sat(c, "G22"), False, False))
        self.assertTrue(is_shown(sat(c, "G22"), False, True))
        self.assertFalse(is_shown(sat(c, "R10"), True, False))
        self.assertTrue(is_shown(sat(c, "R10"), True, True))
        self.assertFalse(is_shown(sat(c, "R10"), False, True))
        self.assertTrue(is_shown(sat(c, "E14"), False, False))      # unhealthy แสดง
        self.assertTrue(is_shown(sat(c, "C40"), False, False))      # stale แสดง
        self.assertTrue(is_shown(sat(c, "G01"), False, False))

    def test_dop_excluded_flags(self):
        self.assertEqual(DOP_EXCLUDED_FLAGS, frozenset({"too_old", "no_broadcast", "unhealthy"}))

    def test_unmapped_dicts_have_all_keys(self):
        for u in self.c.unmapped:
            self.assertEqual(set(u), {"norad", "celestrak_name", "object_id", "reason"})


class TestPeriodDependence(unittest.TestCase):
    def test_age_uses_absolute_difference(self):
        # ช่วง 2026-11-05..06 อยู่ก่อน epoch ของทุกดวง อายุต้องเป็นบวก
        c = build_catalog(SNAP, (T(2026, 11, 5), T(2026, 11, 6)), ALL)
        g01 = sat(c, "G01")
        self.assertAlmostEqual(g01.age_days, (omm_record(62339).epoch - T(2026, 11, 5, 12)).total_seconds() / 86400,
                               places=9)
        self.assertGreater(g01.age_days, 4.0)
        self.assertTrue(all(s.age_days > 0 for s in c.satellites))
        self.assertIn("stale", g01.flags)

    def test_age_boundaries_use_config_thresholds(self):
        epoch = omm_record(62339).epoch
        for days, expected in ((2.0, set()), (2.0001, {"stale"}), (7.0, {"stale"}), (7.0001, {"too_old"})):
            mid = epoch + timedelta(days=days)
            c = build_catalog(SNAP, (mid - timedelta(hours=12), mid + timedelta(hours=12)), {"G"})
            self.assertEqual(set(sat(c, "G01").flags) - {"no_broadcast"}, expected, days)

    def test_prn_changed_flag(self):
        # R809: R28 ถึง 2026-10-20 05:30:00 แล้วไม่มี PRN 1 นาที แล้วเป็น R10
        c = build_catalog(SNAP, (T(2026, 10, 20), T(2026, 10, 21)), ALL)
        r28 = sat(c, "R28")
        self.assertEqual(r28.norad, 100744)
        self.assertIn("prn_changed", r28.flags)
        self.assertEqual(r28.svn, "R809")
        self.assertEqual(codes(c, "SAT_FLAGGED")[0].level, "warning")
        self.assertNotIn("prn_changed", sat(build_catalog(SNAP, PERIOD, ALL), "R10").flags)

    def test_prn_changed_is_warning_message(self):
        c = build_catalog(SNAP, (T(2026, 10, 20), T(2026, 10, 21)), {"R"})
        (msg,) = [m for m in codes(c, "SAT_FLAGGED") if m.object == "R28"]
        self.assertEqual(msg.level, "warning")

    def test_prn_for_period_start_is_used(self):
        # เริ่มช่วงหลังเปลี่ยน PRN: R10 ไม่มี prn_changed
        c = build_catalog(SNAP, (T(2026, 10, 21), T(2026, 10, 22)), {"R"})
        self.assertEqual([s.prn for s in c.satellites], ["R05", "R10"])
        self.assertNotIn("prn_changed", sat(c, "R10").flags)

    def test_systems_subset(self):
        with tempfile.TemporaryDirectory() as d:
            snap = Path(d) / "snap"
            shutil.copytree(SNAP, snap)
            (snap / "beidou.json").unlink()                   # ไม่ขอ C จึงไม่ต้องมีไฟล์
            c = build_catalog(snap, PERIOD, {"G", "E"})
        self.assertEqual([s.prn for s in c.satellites], ["E11", "E14", "G01", "G22"])
        self.assertEqual(c.unmapped, [])


class TestDuplicatePrn(TempSnapshot):
    def test_duplicate_prn_keeps_newer(self):
        gps = self.snap / "gps-ops.json"
        records = json.loads(gps.read_text())
        fake = dict(next(r for r in records if r["NORAD_CAT_ID"] == 62339))
        fake.update(NORAD_CAT_ID=99001, OBJECT_NAME="GPS FAKE  (PRN 01)", EPOCH="2026-11-09T04:12:45.624384")
        gps.write_text(json.dumps(records + [fake]))
        snx = self.snap / "igs_satellite_metadata.snx"
        text = snx.read_bytes().decode()
        text = text.replace("-SATELLITE/IDENTIFIER", " G999 2024-242B   99001 GPS-IIIA        fake\r\n-SATELLITE/IDENTIFIER", 1)
        text = text.replace("-SATELLITE/PRN", " G999 2024:352:00000 0000:000:00000 G01 \r\n-SATELLITE/PRN", 1)
        snx.write_bytes(text.encode())

        c = build_catalog(self.snap, PERIOD, {"G"})
        self.assertEqual(sat(c, "G01").norad, 62339)
        self.assertEqual([s.prn for s in c.satellites].count("G01"), 1)
        self.assertEqual(c.unmapped, [{"norad": 99001, "celestrak_name": "GPS FAKE  (PRN 01)",
                                       "object_id": fake["OBJECT_ID"], "reason": "DUPLICATE_PRN"}])

    def test_duplicate_prn_keeps_newer_when_listed_first(self):
        gps = self.snap / "gps-ops.json"
        records = json.loads(gps.read_text())
        fake = dict(next(r for r in records if r["NORAD_CAT_ID"] == 62339))
        fake.update(NORAD_CAT_ID=99001, EPOCH="2026-11-09T04:12:45.624384")
        gps.write_text(json.dumps([fake] + records))              # ดวงเก่าอยู่ก่อน
        snx = self.snap / "igs_satellite_metadata.snx"
        text = snx.read_bytes().decode()
        text = text.replace("-SATELLITE/IDENTIFIER", " G999 2024-242B   99001 GPS-IIIA        fake\r\n-SATELLITE/IDENTIFIER", 1)
        text = text.replace("-SATELLITE/PRN", " G999 2024:352:00000 0000:000:00000 G01 \r\n-SATELLITE/PRN", 1)
        snx.write_bytes(text.encode())
        c = build_catalog(self.snap, PERIOD, {"G"})
        self.assertEqual(sat(c, "G01").norad, 62339)
        self.assertEqual([u["norad"] for u in c.unmapped], [99001])


class TestErrors(TempSnapshot):
    def test_missing_group_file_raises(self):
        (self.snap / "beidou.json").unlink()
        with self.assertRaises(OrbitUnavailableError) as cm:
            build_catalog(self.snap, PERIOD, ALL)
        self.assertIn("beidou", str(cm.exception))

    def test_corrupt_group_file_raises(self):
        (self.snap / "galileo.json").write_text("GP data has not updated since your last successful download")
        with self.assertRaises(OrbitUnavailableError) as cm:
            build_catalog(self.snap, PERIOD, ALL)
        self.assertIn("galileo", str(cm.exception))

    def test_non_utf8_group_file_raises(self):
        (self.snap / "glo-ops.json").write_bytes(b"\xff\xfe\x00")
        with self.assertRaises(OrbitUnavailableError) as cm:
            build_catalog(self.snap, PERIOD, {"R"})
        self.assertIn("glo-ops", str(cm.exception))

    def test_group_path_is_a_directory_raises(self):
        (self.snap / "gps-ops.json").unlink()
        (self.snap / "gps-ops.json").mkdir()
        with self.assertRaises(OrbitUnavailableError):
            build_catalog(self.snap, PERIOD, {"G"})

    def test_missing_snapshot_dir_raises(self):
        with self.assertRaises(OrbitUnavailableError):
            build_catalog(self.snap / "nope", PERIOD, {"G"})

    def test_missing_igs_metadata_raises(self):
        (self.snap / "igs_satellite_metadata.snx").unlink()
        with self.assertRaises(IgsMetadataUnavailableError):
            build_catalog(self.snap, PERIOD, ALL)

    def test_corrupt_igs_metadata_raises(self):
        (self.snap / "igs_satellite_metadata.snx").write_text("not a sinex file\n")
        with self.assertRaises(IgsMetadataUnavailableError):
            build_catalog(self.snap, PERIOD, ALL)


class TestBroadcastMissing(TempSnapshot):
    def assert_no_broadcast_flags(self, c: Catalog):
        for s in c.satellites:
            self.assertFalse(s.flags & {"no_broadcast", "unhealthy"}, s.prn)
        (msg,) = codes(c, "BRDC_UNAVAILABLE")
        self.assertEqual(msg.level, "warning")
        self.assertTrue(any("฀" <= ch <= "๿" for ch in msg.text), msg.text)

    def test_without_brdc(self):
        shutil.rmtree(self.snap / "brdc")
        c = build_catalog(self.snap, PERIOD, ALL)
        self.assert_no_broadcast_flags(c)
        self.assertEqual(sat(c, "R10").flags, {"too_old"})
        self.assertEqual(sat(c, "G22").flags, set())
        self.assertEqual(sat(c, "E14").flags, set())

    def test_empty_brdc_folder(self):
        for f in (self.snap / "brdc").iterdir():
            f.unlink()
        self.assert_no_broadcast_flags(build_catalog(self.snap, PERIOD, ALL))

    def test_corrupt_gzip_brdc(self):
        for f in (self.snap / "brdc").iterdir():
            f.unlink()
        (self.snap / "brdc" / "BRDC00IGS_R_20263130000_01D_MN.rnx.gz").write_bytes(b"\x1f\x8b\x08\x00garbage")
        self.assert_no_broadcast_flags(build_catalog(self.snap, PERIOD, ALL))

    def test_not_rinex_brdc(self):
        for f in (self.snap / "brdc").iterdir():
            f.write_text("hello\n")
        self.assert_no_broadcast_flags(build_catalog(self.snap, PERIOD, ALL))

    def test_brdc_is_a_file_not_folder(self):
        shutil.rmtree(self.snap / "brdc")
        (self.snap / "brdc").write_text("x")
        self.assert_no_broadcast_flags(build_catalog(self.snap, PERIOD, ALL))

    def test_gz_brdc_with_any_name(self):
        import gzip
        src = next((self.snap / "brdc").iterdir())
        data = src.read_bytes()
        src.unlink()
        (self.snap / "brdc" / "nav_today.rnx.gz").write_bytes(gzip.compress(data))
        c = build_catalog(self.snap, PERIOD, ALL)
        self.assertEqual(codes(c, "BRDC_UNAVAILABLE"), [])
        self.assertEqual(sat(c, "G22").flags, {"no_broadcast"})
        self.assertEqual(sat(c, "E14").flags, {"unhealthy"})


class TestNameMismatch(TempSnapshot):
    def test_gps_name_with_matching_prn_has_no_flag(self):
        c = build_catalog(self.snap, PERIOD, {"G"})
        self.assertNotIn("name_mismatch", sat(c, "G01").flags)
        self.assertNotIn("name_mismatch", sat(c, "G22").flags)

    def test_gps_name_with_other_prn_is_flagged(self):
        gps = self.snap / "gps-ops.json"
        records = json.loads(gps.read_text())
        for r in records:
            if r["NORAD_CAT_ID"] == 62339:
                r["OBJECT_NAME"] = "GPS BIII-7  (PRN 7)"
        gps.write_text(json.dumps(records))
        c = build_catalog(self.snap, PERIOD, {"G"})
        self.assertIn("name_mismatch", sat(c, "G01").flags)

    def test_name_without_prn_is_not_flagged(self):
        gps = self.snap / "gps-ops.json"
        records = json.loads(gps.read_text())
        for r in records:
            r["OBJECT_NAME"] = "GPS BIII-7"
        gps.write_text(json.dumps(records))
        c = build_catalog(self.snap, PERIOD, {"G"})
        self.assertFalse(any("name_mismatch" in s.flags for s in c.satellites))

    def test_glonass_and_galileo_never_checked(self):
        c = build_catalog(self.snap, PERIOD, {"R", "E"})
        self.assertFalse(any("name_mismatch" in s.flags for s in c.satellites))

    def test_beidou_name_matching_prn_has_no_flag(self):
        beidou = self.snap / "beidou.json"
        records = json.loads(beidou.read_text())
        for r in records:
            if r["NORAD_CAT_ID"] == 56564:
                r["OBJECT_NAME"] = "BEIDOU-3 G4 (C01)"
        beidou.write_text(json.dumps(records))
        c = build_catalog(self.snap, PERIOD, {"C"})
        self.assertNotIn("name_mismatch", sat(c, "C01").flags)


class TestBadOmmRecord(TempSnapshot):
    def test_record_without_tle_fields_goes_to_unmapped(self):
        gps = self.snap / "gps-ops.json"
        records = json.loads(gps.read_text())
        for r in records:
            if r["NORAD_CAT_ID"] == 26407:
                del r["BSTAR"]
        gps.write_text(json.dumps(records))
        c = build_catalog(self.snap, PERIOD, {"G"})
        self.assertEqual([s.prn for s in c.satellites], ["G01"])
        self.assertEqual([(u["norad"], u["reason"]) for u in c.unmapped], [(26407, "TLE_UNAVAILABLE")])


if __name__ == "__main__":
    unittest.main()
