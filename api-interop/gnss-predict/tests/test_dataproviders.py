"""Data Provider (spec งานย่อยที่ 4 หัวข้อ 3.2) เทียบกับไฟล์ใน bundle ที่ build_computed_scenario เขียน

ค่าที่คาดอ่านจาก aer.csv, intervals.json, dop.csv และ predicted.sp3 ตรง ๆ ด้วย csv/json ไม่ผ่าน dataproviders
"""

import csv
import json
import math
import shutil
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from gnss_predict.dataproviders import (DOP_GROUPS, PROVIDERS, AccessTables, TableCache, access_path,
                                        display_name, list_providers, object_period, open_result_set,
                                        parse_object, provider_rows)
from gnss_predict.errors import GnssPredictError, ResultsNotCurrentError, ScenarioError, StyleError
from gnss_predict.geometry import geodetic_to_ecef
from gnss_predict.sp3 import read_sp3_all
from tests.report_fixture import EARTH_MU_KM3_S2, EARTH_ROTATION_RAD_S, build_computed_scenario

UTC = timezone.utc
START = datetime(2026, 11, 10, 0, 0, tzinfo=UTC)
STOP = datetime(2026, 11, 10, 6, 0, tzinfo=UTC)
G01 = access_path("THBK", "G01")
AER = ["Time", "Azimuth", "Elevation", "Range"]
IPP = ["Time", "IPP Lat", "IPP Lon", "MF", "Elevation"]
ACCESS = ["Access Number", "Start Time", "Stop Time", "Duration"]
DOP_ELEMENTS = ["Time", "GDOP", "PDOP", "HDOP", "VDOP", "EDOP", "NDOP", "TDOP", "N Visible"]
LLA = ["Time", "Lat", "Lon", "Alt", "Lat Rate", "Lon Rate", "Alt Rate"]


def _t(text: str) -> datetime:
    return datetime.fromisoformat(text.replace("Z", "+00:00")).astimezone(UTC)


def _float(text: str) -> float | None:
    return None if text == "" else float(text)


def _only_dir(parent: Path) -> Path:
    dirs = [p for p in parent.iterdir() if p.is_dir()]
    assert len(dirs) == 1, dirs
    return dirs[0]


class _Bundle:
    """ไฟล์ใน bundle ที่ fixture เขียน อ่านด้วย csv/json ตรง ๆ"""

    def __init__(self, scenario_dir: Path):
        self.ephem_dir = _only_dir(scenario_dir / "ephem")
        self.access_dir = _only_dir(scenario_dir / "access" / "THBK")
        manifest = json.loads((self.ephem_dir / "manifest.json").read_text(encoding="utf-8"))
        self.prn_by_norad = {s["norad"]: s["prn"] for s in manifest["satellites"]}
        with open(self.access_dir / "aer.csv", newline="", encoding="utf-8") as f:
            self.aer = list(csv.DictReader(f))
        with open(self.access_dir / "dop.csv", newline="", encoding="utf-8") as f:
            self.dop = list(csv.DictReader(f))
        self.intervals = json.loads((self.access_dir / "intervals.json").read_text(encoding="utf-8"))["intervals"]

    def aer_of(self, prn: str) -> list[dict]:
        return [r for r in self.aer if r["prn"] == prn]

    def in_access(self, prn: str, t: datetime) -> bool:
        return any(_t(iv["start"]) <= t <= _t(iv["stop"]) for iv in self.intervals[prn])


class _ComputedScenario(unittest.TestCase):
    """scenario Test_Scen (6 ชม. step 60 s) ที่ propagate และ analyze THBK แล้ว ใช้ร่วมกันแบบอ่านอย่างเดียว"""

    @classmethod
    def setUpClass(cls):
        cls._tmp = tempfile.TemporaryDirectory()
        cls.scenario_dir, cls.data_dir = build_computed_scenario(Path(cls._tmp.name))
        cls.files = _Bundle(cls.scenario_dir)
        cls.rs = open_result_set(cls.scenario_dir, cls.data_dir)
        cls.g01 = cls.files.prn_by_norad[62339]

    @classmethod
    def tearDownClass(cls):
        cls._tmp.cleanup()

    def rows(self, obj, provider, elements, start=START, stop=STOP, step_s=None, group=None):
        return provider_rows(self.rs, obj, provider, group, elements, start, stop, step_s)


class TestProviderCatalog(unittest.TestCase):
    def test_list_providers(self):
        self.assertEqual([p.name for p in list_providers("Access")], ["Access Data", "AER Data", "IPP Data"])
        self.assertEqual([p.name for p in list_providers("Facility")], ["Dilution of Precision", "N Asset Coverage"])
        self.assertEqual([p.name for p in list_providers("Satellite")], ["LLA State"])
        self.assertEqual(list_providers("Constellation"), [])
        self.assertEqual(list_providers("Sensor"), [])
        for p in PROVIDERS.values():
            self.assertIs(p.ours, p.name == "IPP Data", p.name)
        access = PROVIDERS["Access Data"]
        self.assertEqual([e.name for e in access.elements], ACCESS)
        self.assertEqual({e.name: e.unit for e in access.elements}["Duration"], "sec")
        self.assertEqual([e.header for e in access.elements], ["Access", "Start Time", "Stop Time", "Duration"])
        self.assertEqual({e.interp for e in access.elements}, {"none"})
        self.assertEqual(access.uses, ["Reports"])
        self.assertEqual(PROVIDERS["Dilution of Precision"].groups, list(DOP_GROUPS))
        self.assertEqual(DOP_GROUPS, {"All Systems": "ALL", "GPS": "G", "GLONASS": "R", "Galileo": "E", "BeiDou": "C"})
        self.assertEqual(PROVIDERS["AER Data"].groups, ["Default"])
        self.assertEqual(PROVIDERS["LLA State"].groups, ["Fixed"])
        interp = {(p.name, e.name): e.interp for p in PROVIDERS.values() for e in p.elements}
        self.assertEqual(interp[("AER Data", "Azimuth")], "angle")
        self.assertEqual(interp[("LLA State", "Lon")], "angle")
        self.assertEqual(interp[("AER Data", "Elevation")], "linear")
        self.assertEqual(interp[("Dilution of Precision", "N Visible")], "previous")
        self.assertEqual({e.interp for e in PROVIDERS["N Asset Coverage"].elements}, {"previous"})
        units = {(p.name, e.name): e.unit for p in PROVIDERS.values() for e in p.elements}
        self.assertEqual(units[("LLA State", "Lon Rate")], "deg/sec")
        self.assertEqual(units[("LLA State", "Alt Rate")], "km/sec")
        self.assertEqual(units[("AER Data", "Range")], "km")
        for p in PROVIDERS.values():
            self.assertTrue(set(p.uses) <= {"Reports", "Dynamic Displays"})

    def test_object_paths(self):
        self.assertEqual(G01, "*/Facility/THBK */Satellite/G01")
        self.assertEqual(parse_object(G01), ("Access", "THBK", "G01"))
        self.assertEqual(parse_object("*/Satellite/G01 */Facility/THBK"), ("Access", "THBK", "G01"))   # P1
        self.assertEqual(parse_object("*/Facility/THBK"), ("Facility", "THBK", None))
        self.assertEqual(parse_object("*/Satellite/G01"), ("Satellite", "G01", None))
        self.assertEqual(display_name(G01), "THBK-To-G01")
        self.assertEqual(display_name("*/Facility/THBK"), "THBK")
        self.assertEqual(display_name("*/Satellite/G01"), "G01")
        for bad in ["", "THBK", "*/Facility/", "*/Sensor/S1", "*/Facility/THBK */Facility/X",
                    "*/Facility/THBK  */Satellite/G01", "*/Facility/../x", "*/Constellation/GPS"]:
            with self.subTest(bad=bad), self.assertRaises(ScenarioError) as cm:
                parse_object(bad)
            self.assertEqual(cm.exception.field, "object")

    def test_error_codes(self):
        self.assertEqual(ResultsNotCurrentError.code, "RESULTS_NOT_CURRENT")
        self.assertEqual(StyleError.code, "STYLE_INVALID")
        self.assertTrue(issubclass(ResultsNotCurrentError, GnssPredictError))
        e = StyleError("ผิด", field="elements[2]")
        self.assertEqual((str(e), e.field), ("ผิด", "elements[2]"))


class TestProviderRows(_ComputedScenario):
    def test_result_set(self):
        self.assertEqual(self.rs.ephem_dir, self.files.ephem_dir)
        self.assertEqual(self.rs.access_dirs, {"THBK": self.files.access_dir})
        self.assertEqual(self.rs.prn_of("G01"), self.g01)
        self.assertEqual(self.rs.prn_of("E11"), self.files.prn_by_norad[37846])
        self.assertIsNone(self.rs.prn_of("NOPE"))
        self.assertEqual(object_period(self.rs, G01), (START, STOP))
        self.assertEqual(object_period(self.rs, "*/Facility/THBK"), (START, STOP))

    def test_access_data_matches_intervals_json(self):
        rows = self.rows(G01, "Access Data", ACCESS)
        expected = self.files.intervals[self.g01]
        self.assertGreater(len(expected), 0)
        self.assertEqual([r["Access Number"] for r in rows], list(range(1, len(expected) + 1)))
        for row, iv in zip(rows, expected, strict=True):
            self.assertEqual(list(row), ACCESS)
            self.assertEqual(row["Start Time"], _t(iv["start"]))
            self.assertEqual(row["Stop Time"], _t(iv["stop"]))
            self.assertEqual(row["Duration"], iv["duration_s"])
            self.assertIs(row["Start Time"].tzinfo, UTC)

    def test_aer_only_inside_access(self):
        rows = self.rows(G01, "AER Data", AER)
        expected = [r for r in self.files.aer_of(self.g01) if self.files.in_access(self.g01, _t(r["time_utc"]))]
        self.assertGreater(len(expected), 0)
        self.assertLess(len(expected), len(self.files.aer_of(self.g01)))      # มีแถวนอก access ที่ต้องถูกตัด
        self.assertEqual(len(rows), len(expected))
        for row, r in zip(rows, expected, strict=True):
            self.assertTrue(self.files.in_access(self.g01, row["Time"]))
            self.assertEqual(row, {"Time": _t(r["time_utc"]), "Azimuth": float(r["az_deg"]),
                                   "Elevation": float(r["el_deg"]), "Range": float(r["range_km"])})

    def test_aer_with_no_access_is_empty(self):
        g22 = self.files.prn_by_norad[26407]
        self.assertEqual(self.files.intervals[g22], [])
        self.assertEqual(self.rows(access_path("THBK", "G22"), "AER Data", AER), [])
        self.assertEqual(self.rows(access_path("THBK", "G22"), "Access Data", ACCESS), [])

    def test_ipp_data_matches_aer_csv(self):
        rows = self.rows(G01, "IPP Data", IPP)
        expected = [r for r in self.files.aer_of(self.g01) if self.files.in_access(self.g01, _t(r["time_utc"]))]
        self.assertEqual(len(rows), len(expected))
        for row, r in zip(rows, expected, strict=True):
            self.assertEqual(row, {"Time": _t(r["time_utc"]), "IPP Lat": float(r["ipp_lat_deg"]),
                                   "IPP Lon": float(r["ipp_lon_deg"]), "MF": float(r["mf"]),
                                   "Elevation": float(r["el_deg"])})

    def test_dop_every_group(self):
        keys = {"GDOP": "gdop", "PDOP": "pdop", "HDOP": "hdop", "VDOP": "vdop", "EDOP": "edop", "NDOP": "ndop",
                "TDOP": "tdop"}
        saw_none = False
        for group, system in DOP_GROUPS.items():
            with self.subTest(group=group):
                rows = self.rows("*/Facility/THBK", "Dilution of Precision", DOP_ELEMENTS, group=group)
                expected = [r for r in self.files.dop if r["system"] == system]
                self.assertEqual(len(rows), len(expected))
                for row, r in zip(rows, expected, strict=True):
                    want = {"Time": _t(r["time_utc"]), "N Visible": int(r["n_visible"])}
                    want.update({name: _float(r[key]) for name, key in keys.items()})
                    self.assertEqual(row, {k: want[k] for k in DOP_ELEMENTS})
                    self.assertIsInstance(row["N Visible"], int)
                    saw_none = saw_none or row["GDOP"] is None
        self.assertTrue(saw_none)                    # มีช่องว่างใน csv ที่ต้องออกเป็น None

    def test_dop_default_group_is_all_systems(self):
        self.assertEqual(self.rows("*/Facility/THBK", "Dilution of Precision", DOP_ELEMENTS),
                         self.rows("*/Facility/THBK", "Dilution of Precision", DOP_ELEMENTS, group="All Systems"))

    def test_n_asset_coverage(self):
        names = ["Time", "Total", "GPS", "GLONASS", "Galileo", "BeiDou"]
        rows = self.rows("*/Facility/THBK", "N Asset Coverage", names)
        by_time: dict[datetime, dict[str, int]] = {}
        for r in self.files.dop:
            by_time.setdefault(_t(r["time_utc"]), {})[r["system"]] = int(r["n_visible"])
        self.assertEqual(len(rows), len(by_time))
        for row, (t, n) in zip(rows, sorted(by_time.items()), strict=True):
            self.assertEqual(row, {"Time": t, "Total": n["ALL"], "GPS": n["G"], "GLONASS": n["R"],
                                   "Galileo": n["E"], "BeiDou": n["C"]})
        self.assertGreater(max(r["Total"] for r in rows), 0)

    def test_lla_round_trip(self):
        rows = self.rows("*/Satellite/G01", "LLA State", LLA, step_s=60)
        sp3 = read_sp3_all(self.files.ephem_dir / "predicted.sp3")[self.g01]
        self.assertEqual(len(rows), len(sp3))
        offset = timedelta(seconds=18)
        for row in rows:
            x, y, z = geodetic_to_ecef(row["Lat"], row["Lon"], row["Alt"] * 1000.0)
            want = sp3[row["Time"] + offset]
            self.assertLessEqual(math.dist((x, y, z), want), 1e-6, row["Time"])
            self.assertTrue(-180.0 < row["Lon"] <= 180.0)

    def test_step_rules(self):
        aer_all = self.rows(G01, "AER Data", AER)
        self.assertEqual(self.rows(G01, "AER Data", AER, step_s=60), aer_all)
        aer_120 = self.rows(G01, "AER Data", AER, step_s=120)
        self.assertEqual(aer_120, [r for r in aer_all if (r["Time"] - START).total_seconds() % 120 == 0])
        self.assertLess(len(aer_120), len(aer_all))
        lla_all = self.rows("*/Satellite/G01", "LLA State", LLA)
        self.assertEqual(len(lla_all), 361)
        self.assertEqual(self.rows("*/Satellite/G01", "LLA State", LLA, step_s=120),
                         [r for r in lla_all if (r["Time"] - START).total_seconds() % 120 == 0])
        for bad in [90, 30, 0, -60]:
            with self.subTest(step=bad), self.assertRaises(ScenarioError) as cm:
                self.rows(G01, "AER Data", AER, step_s=bad)
            self.assertEqual(cm.exception.field, "time.step")
        access = self.rows(G01, "Access Data", ACCESS)
        for step in [None, 60, 120, 180, 3600]:
            self.assertEqual(self.rows(G01, "Access Data", ACCESS, step_s=step), access)

    def test_window_clips(self):
        start = datetime(2026, 11, 10, 3, 0, 0, 123456, tzinfo=UTC)
        stop = datetime(2026, 11, 10, 5, 0, tzinfo=UTC)
        iv = self.files.intervals[self.g01][0]
        self.assertTrue(_t(iv["start"]) < start and stop < _t(iv["stop"]))    # ช่วงของ G01 คร่อมทั้งสองขอบ
        rows = self.rows(G01, "Access Data", ACCESS, start=start, stop=stop)
        self.assertEqual(rows, [{"Access Number": 1, "Start Time": datetime(2026, 11, 10, 3, 0, 0, 123000, tzinfo=UTC),
                                 "Stop Time": stop, "Duration": 7199.877}])
        aer = self.rows(G01, "AER Data", AER, start=start, stop=stop)
        self.assertGreater(len(aer), 0)
        self.assertTrue(all(start <= r["Time"] <= stop for r in aer))
        self.assertEqual(aer, [r for r in self.rows(G01, "AER Data", AER) if start <= r["Time"] <= stop])
        self.assertEqual(aer[-1]["Time"], stop)                     # ขอบปิดทั้งสองข้าง

    def test_window_outside_period_is_empty(self):
        after = STOP + timedelta(hours=1)
        cases = [(G01, "Access Data", ACCESS, None), (G01, "AER Data", AER, None), (G01, "IPP Data", IPP, None),
                 ("*/Facility/THBK", "Dilution of Precision", DOP_ELEMENTS, "GPS"),
                 ("*/Facility/THBK", "N Asset Coverage", ["Time", "Total"], None),
                 ("*/Satellite/G01", "LLA State", LLA, None)]
        for obj, provider, elements, group in cases:
            with self.subTest(provider=provider):
                self.assertEqual(self.rows(obj, provider, elements, start=after, stop=after + timedelta(hours=1),
                                           group=group), [])
                for start, stop in [(STOP, START), (START, START)]:
                    with self.assertRaises(ScenarioError) as cm:
                        self.rows(obj, provider, elements, start=start, stop=stop, group=group)
                    self.assertEqual(cm.exception.field, "time.start")

    def test_unknown_names(self):
        with self.assertRaises(StyleError) as cm:
            self.rows(G01, "Nope Data", AER)
        self.assertEqual(cm.exception.field, "provider")
        with self.assertRaises(StyleError) as cm:
            self.rows(G01, "AER Data", ["Time", "Azimuth", "Bogus"])
        self.assertEqual(cm.exception.field, "elements[2]")
        with self.assertRaises(StyleError) as cm:
            self.rows("*/Facility/THBK", "Dilution of Precision", DOP_ELEMENTS, group="QZSS")
        self.assertEqual(cm.exception.field, "group")
        with self.assertRaises(StyleError) as cm:
            self.rows(G01, "Access Data", ACCESS, group="Default")
        self.assertEqual(cm.exception.field, "group")
        self.assertEqual(self.rows(G01, "AER Data", AER, group="Default"), self.rows(G01, "AER Data", AER))
        for obj, provider, elements in [("*/Facility/THBK", "LLA State", LLA), ("*/Satellite/G01", "AER Data", AER),
                                        (G01, "N Asset Coverage", ["Time"])]:
            with self.subTest(obj=obj, provider=provider), self.assertRaises(ScenarioError) as cm:
                self.rows(obj, provider, elements)
            self.assertEqual(cm.exception.field, "object")

    def test_only_requested_elements_in_order(self):
        rows = self.rows(G01, "AER Data", ["Range", "Time"])
        self.assertEqual(list(rows[0]), ["Range", "Time"])


class TestMissingResults(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.scenario_dir, self.data_dir = build_computed_scenario(Path(self._tmp.name))

    def test_missing_results_raise(self):
        rs_before = open_result_set(self.scenario_dir, self.data_dir)
        shutil.rmtree(self.scenario_dir / "access" / "THBK")
        rs = open_result_set(self.scenario_dir, self.data_dir)
        self.assertEqual(rs.access_dirs, {})
        for bundle in (rs, rs_before):                   # เปิดหลังลบ และเปิดไว้ก่อนแล้วโฟลเดอร์หายไป
            for provider, obj, elements in [("Access Data", G01, ACCESS), ("AER Data", G01, AER),
                                            ("Dilution of Precision", "*/Facility/THBK", ["Time", "GDOP"])]:
                with self.subTest(provider=provider), self.assertRaises(ResultsNotCurrentError):
                    provider_rows(bundle, obj, provider, None, elements, START, STOP, None)
        rows = provider_rows(rs, "*/Satellite/G01", "LLA State", None, ["Time"], START, STOP, None)
        self.assertEqual(len(rows), 361)                                       # ephem ยังอยู่
        for obj in [access_path("THBK", "G99"), access_path("XXXX", "G01"), "*/Satellite/G99"]:
            provider = "LLA State" if obj.startswith("*/Satellite") else "Access Data"
            with self.subTest(obj=obj), self.assertRaises(ScenarioError) as cm:
                provider_rows(rs, obj, provider, None, ["Time"] if provider == "LLA State" else ACCESS,
                              START, STOP, None)
            self.assertEqual(cm.exception.field, "object")

    def test_scenario_changed_after_compute(self):
        doc = json.loads((self.scenario_dir / "scenario.json").read_text(encoding="utf-8"))
        doc["step_s"] = 120                                     # hash ของ ephem และ access เปลี่ยน
        (self.scenario_dir / "scenario.json").write_text(json.dumps(doc), encoding="utf-8")
        rs = open_result_set(self.scenario_dir, self.data_dir)
        self.assertIsNone(rs.ephem_dir)
        self.assertEqual(rs.access_dirs, {})
        self.assertIsNone(rs.prn_of("G01"))
        with self.assertRaises(ResultsNotCurrentError):
            provider_rows(rs, "*/Satellite/G01", "LLA State", None, ["Time"], START, STOP, None)
        with self.assertRaises(ResultsNotCurrentError):
            provider_rows(rs, G01, "AER Data", None, AER, START, STOP, None)


def _equatorial_ecef(radius_km: float, lon0_deg):
    """ดาวทุกดวงบนวงโคจรวงกลมเส้นศูนย์สูตร (ความเอียง 0) รัศมี radius_km ลองจิจูดตั้งต้น lon0_deg(prn) องศา"""
    rate = math.sqrt(EARTH_MU_KM3_S2 / radius_km ** 3) - EARTH_ROTATION_RAD_S      # rad/s เทียบกับโลก

    def ecef(prn: str, t_s: float):
        theta = math.radians(lon0_deg(prn)) + rate * t_s
        return radius_km * math.cos(theta), radius_km * math.sin(theta), 0.0
    return ecef


class TestLlaRates(unittest.TestCase):
    def test_lla_rates_circular_orbit(self):
        radius = 26560.0
        with tempfile.TemporaryDirectory() as tmp:
            # ดาว GPS เริ่มที่ลองจิจูด 150° (ข้าม ±180 ราว 2 ชม. หลังเริ่ม) ดวงอื่นที่ 100° (เหนือ THBK)
            positions = _equatorial_ecef(radius, lambda prn: 150.0 if prn.startswith("G") else 100.0)
            scenario_dir, data_dir = build_computed_scenario(Path(tmp), ecef=positions)
            rs = open_result_set(scenario_dir, data_dir)
            rows = provider_rows(rs, "*/Satellite/G01", "LLA State", None, LLA, START, STOP, None)
        self.assertEqual(len(rows), 361)
        lon_rate = math.degrees(math.sqrt(EARTH_MU_KM3_S2 / radius ** 3) - EARTH_ROTATION_RAD_S)
        crossings = [i for i in range(1, len(rows)) if rows[i - 1]["Lon"] > 0 > rows[i]["Lon"]]
        self.assertEqual(len(crossings), 1)              # ข้าม +180 → −180 หนึ่งครั้ง (แถวนั้นตรวจในลูปด้านล่างด้วย)
        # ตำแหน่งใน predicted.sp3 ละเอียด 1 มม. ต่อแกน: ความสูงคลาดได้ถึง √2·0.5 มม. ต่อจุด
        # ผลต่างสองจุดห่างกันอย่างน้อย 60 s จึงคลาดได้ถึง 2·√2·0.5e-6 / 60 ≈ 2.4e-8 km/s (วัดได้ราว 1.3e-8)
        # จึงใช้ 1e-9 ตาม brief ไม่ได้ ส่วน Lat ได้ 0 พอดีเพราะ z = 0
        alt_tol = 2.5e-8
        for k, row in enumerate(rows):                   # รวมแถวแรก/สุดท้าย (ผลต่างข้างเดียว) และแถวที่ข้าม ±180
            with self.subTest(k=k):
                self.assertLessEqual(abs(row["Lat Rate"]), 1e-9)
                self.assertLessEqual(abs(row["Alt Rate"]), alt_tol)
                self.assertLessEqual(abs(row["Lon Rate"] - lon_rate), 1e-9)
                self.assertAlmostEqual(row["Alt"], radius - 6378.137, delta=1e-5)


class TestTableCache(unittest.TestCase):
    def test_table_cache_lru(self):
        with tempfile.TemporaryDirectory() as tmp:
            scenario_dir, _ = build_computed_scenario(Path(tmp))
            source = _only_dir(scenario_dir / "access" / "THBK")
            copies = []
            for k in range(3):
                dst = Path(tmp) / f"bundle{k}"
                shutil.copytree(source, dst)
                copies.append(dst)
            cache = TableCache(2)
            self.assertEqual(cache.loads, 0)
            first = cache.access(copies[0])
            self.assertIsInstance(first, AccessTables)
            self.assertEqual(first.facility, "THBK")
            self.assertEqual(cache.loads, 1)
            self.assertIs(cache.access(copies[0]), first)
            self.assertIs(cache.access(Path(tmp) / "bundle0" / ".." / "bundle0"), first)   # กุญแจคือ path.resolve()
            self.assertEqual(cache.loads, 1)
            cache.access(copies[1])
            cache.access(copies[2])
            self.assertEqual(cache.loads, 3)
            cache.access(copies[0])                       # ถูกไล่ออกไปแล้ว ต้องอ่านใหม่
            self.assertEqual(cache.loads, 4)
            cache.access(copies[0])
            self.assertEqual(cache.loads, 4)
            cache.access(copies[2])                        # ยังอยู่ (ใช้ล่าสุดรองจาก bundle0)
            self.assertEqual(cache.loads, 4)

    def test_ephem_tables(self):
        with tempfile.TemporaryDirectory() as tmp:
            scenario_dir, _ = build_computed_scenario(Path(tmp))
            ephem_dir = _only_dir(scenario_dir / "ephem")
            cache = TableCache()
            manifest = cache.ephem_manifest(ephem_dir)
            self.assertEqual(manifest["kind"], "ephem")
            eph = cache.ephem(ephem_dir)
            self.assertEqual(len(eph.times_utc), 361)
            self.assertEqual(eph.times_utc[0], START)
            loads = cache.loads
            cache.ephem(ephem_dir)
            cache.ephem_manifest(ephem_dir)
            self.assertEqual(cache.loads, loads)


if __name__ == "__main__":
    unittest.main()
