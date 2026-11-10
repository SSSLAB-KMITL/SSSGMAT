import copy
import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from gnss_predict.errors import ScenarioError
from gnss_predict.scenario import EngineScenario, Facility, load_scenario

START = "2026-11-12T00:00:00Z"
STOP = "2026-11-13T00:00:00Z"

VALID = {
    "format": "gnss-studio-scenario/1",
    "name": "THBK_Scen",
    "analysis_period": {"start": START, "stop": STOP},
    "step_s": 30,
    "orbit_snapshot": "20261111T0600Z",
    "ionosphere": {"shell_km": 400.0},
    "satellite_filter": {"show_too_old": False, "show_no_broadcast": False},
    "animation": {"start": START, "time_step_s": 60, "update_mode": "time_step", "cycle": "loop"},
    "units": {"date_format": "UTCG", "ltz_offset": "+07:00"},
    "objects": [
        {"class": "Facility", "name": "THBK",
         "position": {"type": "Geodetic", "lat_deg": 13.729779, "lon_deg": 100.781151, "alt_m": 6.4},
         "constraints": {"elevation_angle_min_deg": 10.0}, "graphics": {}},
        {"class": "Constellation", "name": "GPS", "system": "G", "assigned_objects": ["G01"], "graphics": {}},
        {"class": "Satellite", "name": "G01", "norad": 62339, "svn": "G080", "graphics": {}},
    ],
    "groups": [{"name": "GPS sats", "members": ["G01"]}],
    "accesses": [{"from": "THBK", "to": ["GPS"], "time_period": "object", "graphics": {}}],
}


def utc(*a):
    return datetime(*a, tzinfo=timezone.utc)


def valid():
    return copy.deepcopy(VALID)


def merge(base, patch):
    out = copy.deepcopy(base)
    out.update(patch)
    return out


def with_object(index, **changes):
    """VALID ที่แก้ object ลำดับ index (ใส่ None เพื่อลบช่อง)"""
    d = valid()
    for key, value in changes.items():
        if value is None:
            d["objects"][index].pop(key)
        else:
            d["objects"][index][key] = value
    return d


def with_position(**changes):
    d = valid()
    for key, value in changes.items():
        if value is None:
            d["objects"][0]["position"].pop(key)
        else:
            d["objects"][0]["position"][key] = value
    return d


def lat(value):
    return with_position(lat_deg=value)


def dup_name():
    d = valid()
    d["objects"].insert(1, {"class": "Facility", "name": "THBK",
                            "position": {"type": "Geodetic", "lat_deg": 0.0, "lon_deg": 0.0, "alt_m": 0.0}})
    return d   # objects[0]=THBK, objects[1]=THBK (ซ้ำ)


def rename_facility(name):
    return with_object(0, name=name)


class ScenarioTestCase(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dir = Path(tmp.name)

    def write(self, data):
        path = self.dir / "scenario.json"
        path.write_text(json.dumps(data), encoding="utf-8")
        return path

    def assertInvalid(self, data, field):
        with self.assertRaises(ScenarioError) as cm:
            load_scenario(self.write(data))
        self.assertEqual(cm.exception.field, field, str(cm.exception))
        return cm.exception


class TestLoad(ScenarioTestCase):
    def test_load_minimal(self):
        s = load_scenario(self.write(valid()))
        self.assertIsInstance(s, EngineScenario)
        self.assertEqual(s.facilities, [Facility("THBK", 13.729779, 100.781151, 6.4, 10.0)])
        self.assertEqual(s.satellites, [("G01", 62339)])
        self.assertEqual((s.step_s, s.shell_km, s.show_too_old), (30, 400.0, False))
        self.assertEqual((s.name, s.orbit_snapshot, s.show_no_broadcast), ("THBK_Scen", "20261111T0600Z", False))
        self.assertEqual((s.start, s.stop), (utc(2026, 11, 12), utc(2026, 11, 13)))
        self.assertEqual(s.start.tzinfo, timezone.utc)

    def test_objects_keep_file_order_and_constellations_are_ignored(self):
        d = valid()
        pos = {"type": "Geodetic", "lat_deg": 1.0, "lon_deg": 2.0, "alt_m": 3.0}
        d["objects"] = [
            {"class": "Satellite", "name": "E05", "norad": 2},
            {"class": "Constellation", "name": "GAL", "system": "E"},
            {"class": "Facility", "name": "B", "position": pos},
            {"class": "Satellite", "name": "C01", "norad": 1},
            {"class": "Facility", "name": "A", "position": pos, "constraints": {"elevation_angle_min_deg": 5}},
            {"class": "Satellite", "name": "G01", "norad": 3},
        ]
        s = load_scenario(self.write(d))
        self.assertEqual([f.name for f in s.facilities], ["B", "A"])
        self.assertEqual(s.satellites, [("E05", 2), ("C01", 1), ("G01", 3)])
        self.assertEqual(s.facilities[1], Facility("A", 1.0, 2.0, 3.0, 5.0))
        self.assertIsInstance(s.facilities[1].min_el_deg, float)

    def test_no_objects_of_interest_is_allowed(self):
        s = load_scenario(self.write(merge(valid(), {"objects": []})))
        self.assertEqual((s.facilities, s.satellites), ([], []))

    def test_unknown_fields_ignored(self):
        d = valid()
        d["workbook_hint"] = {"anything": [1, 2, 3]}
        d["ui_state"] = "x"
        d["ionosphere"]["future_flag"] = True
        d["objects"][0]["graphics"] = {"color": "#ff0000", "label": {"show": True}}
        d["objects"][0]["position"]["datum"] = "WGS84"
        d["objects"][2]["notes"] = "ok"
        d["objects"].append({"class": "Sensor", "name": "S1", "fov_deg": 30})
        s = load_scenario(self.write(d))
        self.assertEqual(len(s.facilities), 1)
        self.assertEqual(s.satellites, [("G01", 62339)])

    def test_missing_constraint_defaults_zero(self):
        d = with_object(0, constraints=None)
        self.assertEqual(load_scenario(self.write(d)).facilities[0].min_el_deg, 0.0)
        d = with_object(0, constraints={})
        self.assertEqual(load_scenario(self.write(d)).facilities[0].min_el_deg, 0.0)
        d = with_object(0, constraints={"elevation_angle_min_deg": None})
        self.assertEqual(load_scenario(self.write(d)).facilities[0].min_el_deg, 0.0)

    def test_optional_sections_have_defaults(self):
        d = valid()
        del d["ionosphere"]
        del d["satellite_filter"]
        s = load_scenario(self.write(d))
        self.assertEqual((s.shell_km, s.show_too_old, s.show_no_broadcast), (400.0, False, False))
        d = valid()
        d["ionosphere"] = {}
        d["satellite_filter"] = {"show_too_old": True}
        s = load_scenario(self.write(d))
        self.assertEqual((s.shell_km, s.show_too_old, s.show_no_broadcast), (400.0, True, False))

    def test_explicit_values_are_read(self):
        d = valid()
        d["ionosphere"] = {"shell_km": 350}
        d["satellite_filter"] = {"show_too_old": True, "show_no_broadcast": True}
        d["step_s"] = 1
        s = load_scenario(self.write(d))
        self.assertEqual((s.shell_km, s.show_too_old, s.show_no_broadcast, s.step_s),
                         (350.0, True, True, 1))

    def test_bounds_are_inclusive(self):
        d = valid()
        d["analysis_period"] = {"start": START, "stop": "2026-11-19T00:00:00Z"}   # 7 วันพอดี
        d["step_s"] = 3600
        d["objects"][0]["position"].update(lat_deg=-90, lon_deg=-180)
        s = load_scenario(self.write(d))
        self.assertEqual((s.stop - s.start).days, 7)
        self.assertEqual((s.facilities[0].lat_deg, s.facilities[0].lon_deg), (-90.0, -180.0))
        d["objects"][0]["position"].update(lat_deg=90, lon_deg=180)
        s = load_scenario(self.write(d))
        self.assertEqual((s.facilities[0].lat_deg, s.facilities[0].lon_deg), (90.0, 180.0))

    def test_time_with_offset_is_converted_to_utc(self):
        d = valid()
        d["analysis_period"] = {"start": "2026-11-12T07:00:00+07:00", "stop": STOP}
        self.assertEqual(load_scenario(self.write(d)).start, utc(2026, 11, 12))


class TestErrors(ScenarioTestCase):
    def test_errors_name_the_field(self):
        cases = [({"format": "x"}, "format"),
                 ({"analysis_period": {"start": STOP, "stop": START}}, "analysis_period"),
                 ({"analysis_period": {"start": START, "stop": "2026-11-20T00:00:00Z"}}, "analysis_period"),
                 ({"step_s": 7}, "step_s"),
                 (lat(91.0), "objects[0].position.lat_deg"),
                 (dup_name(), "objects[1].name")]
        for patch, field in cases:
            with self.subTest(field=field):
                with self.assertRaises(ScenarioError) as cm:
                    load_scenario(self.write(merge(VALID, patch)))
                self.assertEqual(cm.exception.field, field)

    def test_error_is_a_scenario_error_with_code_and_thai_text_naming_the_field(self):
        e = self.assertInvalid(lat(91.0), "objects[0].position.lat_deg")
        self.assertEqual(e.code, "SCENARIO_INVALID")
        self.assertIn("objects[0].position.lat_deg", str(e))
        self.assertTrue(any("฀" <= ch <= "๿" for ch in str(e)))

    def test_period_equal_start_stop(self):
        self.assertInvalid(merge(valid(), {"analysis_period": {"start": START, "stop": START}}),
                           "analysis_period")

    def test_period_just_over_seven_days(self):
        self.assertInvalid(merge(valid(), {"analysis_period": {"start": START, "stop": "2026-11-19T00:00:01Z"}}),
                           "analysis_period")

    def test_bad_times(self):
        bad = {"start": "not a time", "stop": STOP}
        self.assertInvalid(merge(valid(), {"analysis_period": bad}), "analysis_period.start")
        self.assertInvalid(merge(valid(), {"analysis_period": {"start": START, "stop": 123}}),
                           "analysis_period.stop")
        edge = {"start": "0001-01-01T00:00:00+07:00", "stop": STOP}
        self.assertInvalid(merge(valid(), {"analysis_period": edge}), "analysis_period.start")
        naive = {"start": "2026-11-12T00:00:00", "stop": STOP}
        self.assertInvalid(merge(valid(), {"analysis_period": naive}), "analysis_period.start")
        self.assertInvalid(merge(valid(), {"analysis_period": {"stop": STOP}}), "analysis_period.start")
        self.assertInvalid(merge(valid(), {"analysis_period": "x"}), "analysis_period")
        d = valid()
        del d["analysis_period"]
        self.assertInvalid(d, "analysis_period")

    def test_bad_step(self):
        for step in (0, -30, 7, 3601, 7200, 86400, 30.0, 30.5, "30", True, None):
            with self.subTest(step=step):
                self.assertInvalid(merge(valid(), {"step_s": step}), "step_s")

    def test_missing_step_defaults_to_30(self):
        d = valid()
        del d["step_s"]
        self.assertEqual(load_scenario(self.write(d)).step_s, 30)

    def test_good_steps_that_divide_a_day(self):
        for step in (1, 2, 5, 30, 60, 300, 900, 3600):
            with self.subTest(step=step):
                self.assertEqual(load_scenario(self.write(merge(valid(), {"step_s": step}))).step_s, step)

    def test_bad_format(self):
        d = valid()
        del d["format"]
        self.assertInvalid(d, "format")
        self.assertInvalid(merge(valid(), {"format": "gnss-studio-scenario/2"}), "format")

    def test_bad_scenario_name_and_snapshot(self):
        self.assertInvalid(merge(valid(), {"name": ""}), "name")
        self.assertInvalid(merge(valid(), {"name": 5}), "name")
        self.assertInvalid(merge(valid(), {"orbit_snapshot": ""}), "orbit_snapshot")
        self.assertInvalid(merge(valid(), {"orbit_snapshot": "../x"}), "orbit_snapshot")
        d = valid()
        del d["orbit_snapshot"]
        self.assertInvalid(d, "orbit_snapshot")

    def test_bad_position(self):
        self.assertInvalid(lat(-90.5), "objects[0].position.lat_deg")
        self.assertInvalid(with_position(lon_deg=180.01), "objects[0].position.lon_deg")
        self.assertInvalid(with_position(lon_deg=-181), "objects[0].position.lon_deg")
        self.assertInvalid(lat("13.7"), "objects[0].position.lat_deg")
        self.assertInvalid(lat(True), "objects[0].position.lat_deg")
        self.assertInvalid(lat(float("nan")), "objects[0].position.lat_deg")
        self.assertInvalid(with_position(alt_m=10 ** 400), "objects[0].position.alt_m")
        self.assertInvalid(with_position(lon_deg=float("inf")), "objects[0].position.lon_deg")
        self.assertInvalid(with_position(lat_deg=None), "objects[0].position.lat_deg")
        self.assertInvalid(with_position(lon_deg=None), "objects[0].position.lon_deg")
        self.assertInvalid(with_position(alt_m=None), "objects[0].position.alt_m")
        self.assertInvalid(with_position(alt_m="6.4"), "objects[0].position.alt_m")
        self.assertInvalid(with_object(0, position=None), "objects[0].position")
        self.assertInvalid(with_object(0, position=[1, 2]), "objects[0].position")

    def test_bad_constraint(self):
        d = with_object(0, constraints={"elevation_angle_min_deg": "10"})
        self.assertInvalid(d, "objects[0].constraints.elevation_angle_min_deg")
        d = with_object(0, constraints={"elevation_angle_min_deg": 91})
        self.assertInvalid(d, "objects[0].constraints.elevation_angle_min_deg")
        self.assertInvalid(with_object(0, constraints=[]), "objects[0].constraints")

    def test_bad_optional_sections(self):
        self.assertInvalid(merge(valid(), {"ionosphere": {"shell_km": 0}}), "ionosphere.shell_km")
        self.assertInvalid(merge(valid(), {"ionosphere": {"shell_km": "400"}}), "ionosphere.shell_km")
        self.assertInvalid(merge(valid(), {"ionosphere": []}), "ionosphere")
        self.assertInvalid(merge(valid(), {"satellite_filter": {"show_too_old": "no"}}),
                           "satellite_filter.show_too_old")
        self.assertInvalid(merge(valid(), {"satellite_filter": {"show_no_broadcast": 1}}),
                           "satellite_filter.show_no_broadcast")

    def test_bad_satellite(self):
        self.assertInvalid(with_object(2, norad=None), "objects[2].norad")
        self.assertInvalid(with_object(2, norad="62339"), "objects[2].norad")
        self.assertInvalid(with_object(2, norad=0), "objects[2].norad")
        self.assertInvalid(with_object(2, norad=True), "objects[2].norad")
        self.assertInvalid(with_object(2, norad=62339.0), "objects[2].norad")

    def test_bad_objects_list(self):
        d = valid()
        del d["objects"]
        self.assertInvalid(d, "objects")
        self.assertInvalid(merge(valid(), {"objects": {}}), "objects")
        self.assertInvalid(merge(valid(), {"objects": ["THBK"]}), "objects[0]")
        self.assertInvalid(with_object(0, **{"class": None}), "objects[0].class")
        self.assertInvalid(with_object(0, **{"class": 3}), "objects[0].class")

    def test_unsafe_name_rejected(self):                # Review Focus 3, D6
        with self.assertRaises(ScenarioError) as cm:
            load_scenario(self.write(rename_facility("TH/BK")))
        self.assertEqual(cm.exception.field, "objects[0].name")

    def test_unsafe_and_malformed_names(self):
        for name in ("", "TH BK", "TH.BK", "..", "../x", "TH\\BK", "ไทย", "A" * 33, "TH\nBK", 7, None):
            with self.subTest(name=name):
                self.assertInvalid(rename_facility(name), "objects[0].name")
        self.assertInvalid(with_object(1, name="G/PS"), "objects[1].name")        # Constellation ก็ตรวจ
        self.assertInvalid(with_object(2, name="G 01"), "objects[2].name")
        d = valid()
        del d["objects"][0]["name"]
        self.assertInvalid(d, "objects[0].name")

    def test_safe_names_accepted(self):
        for name in ("A", "TH-BK_01", "a" * 32, "0"):
            with self.subTest(name=name):
                s = load_scenario(self.write(rename_facility(name)))
                self.assertEqual(s.facilities[0].name, name)

    def test_duplicate_names_include_constellations_and_report_the_second(self):
        self.assertInvalid(with_object(1, name="THBK"), "objects[1].name")
        self.assertInvalid(with_object(2, name="GPS"), "objects[2].name")
        d = valid()
        d["objects"].append({"class": "Satellite", "name": "G01", "norad": 5})
        self.assertInvalid(d, "objects[3].name")

    def test_duplicate_names_are_case_insensitive(self):
        d = valid()
        d["objects"].insert(1, {"class": "Facility", "name": "thbk",
                                "position": {"type": "Geodetic", "lat_deg": 0.0, "lon_deg": 0.0, "alt_m": 0.0}})
        self.assertInvalid(d, "objects[1].name")                  # THBK มาก่อน thbk
        self.assertInvalid(with_object(1, name="thbk"), "objects[1].name")   # Constellation ชนกับ Facility
        d = valid()
        d["objects"].append({"class": "Satellite", "name": "g01", "norad": 5})
        self.assertInvalid(d, "objects[3].name")


class TestFile(ScenarioTestCase):
    def test_missing_file(self):
        with self.assertRaises(ScenarioError) as cm:
            load_scenario(self.dir / "nope.json")
        self.assertEqual(cm.exception.field, "<file>")

    def test_directory_instead_of_file(self):
        with self.assertRaises(ScenarioError) as cm:
            load_scenario(self.dir)
        self.assertEqual(cm.exception.field, "<file>")

    def test_invalid_json(self):
        path = self.dir / "scenario.json"
        path.write_text("{not json", encoding="utf-8")
        with self.assertRaises(ScenarioError) as cm:
            load_scenario(path)
        self.assertEqual(cm.exception.field, "<file>")

    def test_not_utf8(self):
        path = self.dir / "scenario.json"
        path.write_bytes(b"\xff\xfe\x00{")
        with self.assertRaises(ScenarioError) as cm:
            load_scenario(path)
        self.assertEqual(cm.exception.field, "<file>")

    def test_root_is_not_an_object(self):
        with self.assertRaises(ScenarioError) as cm:
            load_scenario(self.write([1, 2]))
        self.assertEqual(cm.exception.field, "<file>")


if __name__ == "__main__":
    unittest.main()
