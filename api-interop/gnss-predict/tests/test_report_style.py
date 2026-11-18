"""Style และการประกอบรายงาน (spec งานย่อยที่ 4 หัวข้อ 3.3–3.4, หัวข้อ 9 แถว 4–5)

ค่าที่คาดอ่านจาก intervals.json ของ bundle ที่ build_computed_scenario เขียน ด้วย json ตรง ๆ ไม่ผ่าน report_style
"""

import json
import math
import statistics
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from gnss_predict.config import THBK_HEIGHT_M, THBK_LAT_DEG, THBK_LON_DEG
from gnss_predict.dataproviders import access_path, open_result_set
from gnss_predict.errors import ScenarioError, StyleError
from gnss_predict.geometry import geodetic_to_ecef
from gnss_predict.report_style import (MAX_CONTENT, MAX_STEP_S, Column, Report, Section, build_report, check_style,
                                       installed_styles, resolve_style)
from tests.report_fixture import build_computed_scenario, circular_ecef_km

UTC = timezone.utc
START = datetime(2026, 11, 10, 0, 0, tzinfo=UTC)
STOP = datetime(2026, 11, 10, 6, 0, tzinfo=UTC)
NOW = datetime(2026, 11, 15, 0, 0, tzinfo=UTC)
NAMES = ["C01", "E11", "G01", "G22", "R05"]          # ใน fixture ชื่อดาวตรงกับ PRN
THBK = "*/Facility/THBK"

INSTALLED_TABLE = [
    ("Access", "report", "Access", False),
    ("AccessSummary", "report", "Access", False),
    ("AER", "report", "Access", True),
    ("Gaps", "report", "Access", False),
    ("IPP Data", "report", "Access", True),
    ("Access", "graph", "Access", False),
    ("AER", "graph", "Access", True),
    ("Elevation Angle", "graph", "Access", True),
    ("Az El Polar", "graph", "Access", False),
    ("LLA Position", "report", "Satellite", True),
    ("All DOPs", "report", "Facility", True),
    ("All DOPs", "graph", "Facility", True),
    ("N Asset Coverage", "report", "Facility", True),
    ("N Asset Coverage", "graph", "Facility", True),
]


def _t(text: str) -> datetime:
    return datetime.fromisoformat(text.replace("Z", "+00:00")).astimezone(UTC)


def _installed(name: str, kind: str = "report") -> dict:
    return resolve_style(name, kind, [], [])


def _intervals(scenario_dir: Path) -> dict:
    access_dir = next(p for p in (scenario_dir / "access" / "THBK").iterdir() if p.is_dir())
    return json.loads((access_dir / "intervals.json").read_text(encoding="utf-8"))


def _user_style(**overrides) -> dict:
    style = {"name": "Mine", "kind": "report", "object_type": "Access",
             "content": [{"provider": "Access Data", "group": None,
                          "elements": ["Access Number", "Start Time", "Stop Time", "Duration"]}],
             "time": {"mode": "object_period", "step_s": None},
             "summary": {"per_object": [], "global_statistics": [], "summary_only": False},
             "graph": None, "dynamic": False, "derive": None, "ours": False}
    style.update(overrides)
    return style


def _field(test: unittest.TestCase, style: dict) -> str:
    with test.assertRaises(StyleError) as cm:
        check_style(style)
    return cm.exception.field


class TestInstalledStyles(unittest.TestCase):
    def test_installed_styles_table(self):
        styles = installed_styles()
        self.assertEqual([(s["name"], s["kind"], s["object_type"], s["dynamic"]) for s in styles], INSTALLED_TABLE)
        for s in styles:
            with self.subTest(name=s["name"], kind=s["kind"]):
                check_style(s)
                self.assertEqual(set(s), {"name", "kind", "object_type", "content", "time", "summary", "graph",
                                          "dynamic", "derive", "ours"})
                self.assertIs(s["ours"], s["name"] == "IPP Data")
                self.assertEqual(s["time"], {"mode": "object_period", "step_s": None})
                self.assertEqual(s["graph"] is None, s["kind"] == "report")

    def test_installed_contents(self):
        def content(name, kind="report"):
            return [(c["provider"], c["group"], c["elements"]) for c in _installed(name, kind)["content"]]

        aer = [("AER Data", "Default", ["Time", "Azimuth", "Elevation", "Range"])]
        dops = [("Dilution of Precision", "All Systems", ["Time", "GDOP", "PDOP", "HDOP", "VDOP", "TDOP"])]
        coverage = [("N Asset Coverage", None, ["Time", "Total", "GPS", "GLONASS", "Galileo", "BeiDou"])]
        self.assertEqual(content("Access"),
                         [("Access Data", None, ["Access Number", "Start Time", "Stop Time", "Duration"])])
        self.assertEqual(content("AccessSummary"), [("Access Data", None, ["Duration"])])
        self.assertEqual(content("AER"), aer)
        self.assertEqual(content("Gaps"), [("Access Data", None, ["Start Time", "Stop Time", "Duration"])])
        self.assertEqual(content("IPP Data"), [("IPP Data", None, ["Time", "IPP Lat", "IPP Lon", "MF", "Elevation"])])
        self.assertEqual(content("Access", "graph"), [("Access Data", None, ["Start Time", "Stop Time"])])
        self.assertEqual(content("AER", "graph"), aer)
        self.assertEqual(content("Elevation Angle", "graph"), [("AER Data", "Default", ["Time", "Elevation"])])
        self.assertEqual(content("Az El Polar", "graph"), [("AER Data", "Default", ["Time", "Azimuth", "Elevation"])])
        self.assertEqual(content("LLA Position"), [("LLA State", "Fixed", ["Time", "Lat", "Lon", "Alt", "Lat Rate",
                                                                           "Lon Rate", "Alt Rate"])])
        self.assertEqual(content("All DOPs"), dops)
        self.assertEqual(content("All DOPs", "graph"), dops)
        self.assertEqual(content("N Asset Coverage"), coverage)
        self.assertEqual(content("N Asset Coverage", "graph"), coverage)

        durations = ["Min Duration", "Max Duration", "Mean Duration", "Total Duration"]
        self.assertEqual(_installed("Access")["summary"],
                         {"per_object": [], "global_statistics": durations, "summary_only": False})
        self.assertEqual(_installed("AccessSummary")["summary"],
                         {"per_object": ["Number of Accesses", *durations], "global_statistics": [],
                          "summary_only": True})
        self.assertEqual(_installed("Gaps")["derive"], "gaps")
        self.assertEqual([s["name"] for s in installed_styles() if s["derive"] is not None], ["Gaps"])

        graphs = {s["name"]: s["graph"] for s in installed_styles() if s["kind"] == "graph"}
        self.assertEqual(graphs, {
            "Access": {"type": "interval", "y1": [], "y2": [], "stack": False},
            "AER": {"type": "time_xy", "y1": ["Azimuth", "Elevation"], "y2": ["Range"], "stack": False},
            "Elevation Angle": {"type": "time_xy", "y1": ["Elevation"], "y2": [], "stack": False},
            "Az El Polar": {"type": "polar90", "y1": [], "y2": [], "stack": False},
            "All DOPs": {"type": "time_xy", "y1": ["GDOP", "PDOP", "HDOP", "VDOP", "TDOP"], "y2": [],
                         "stack": False},
            "N Asset Coverage": {"type": "time_xy", "y1": ["GPS", "GLONASS", "Galileo", "BeiDou"], "y2": [],
                                 "stack": True},
        })

    def test_installed_styles_returns_copies(self):
        styles = installed_styles()
        styles[0]["name"] = "Changed"
        styles[0]["content"][0]["elements"].append("Bogus")
        fresh = installed_styles()
        self.assertEqual(fresh[0]["name"], "Access")
        self.assertNotIn("Bogus", fresh[0]["content"][0]["elements"])


class TestCheckStyle(unittest.TestCase):
    def test_check_style_errors(self):
        bogus = _user_style(content=[{"provider": "Access Data", "group": None, "elements": ["Start Time", "Bogus"]}])
        self.assertEqual(_field(self, bogus), "content[0].elements[1]")
        wrong_type = _user_style(content=[{"provider": "LLA State", "group": "Fixed", "elements": ["Time"]}])
        self.assertEqual(_field(self, wrong_type), "content[0].provider")
        graph = _user_style(kind="graph", content=[{"provider": "AER Data", "group": "Default",
                                                    "elements": ["Time", "Elevation"]}],
                            graph={"type": "time_xy", "y1": ["Range"], "y2": []})
        self.assertEqual(_field(self, graph), "graph.y1[0]")

    def test_check_style_more_errors(self):
        aer = [{"provider": "AER Data", "group": "Default", "elements": ["Time", "Elevation", "Range"]}]
        cases = {
            "name": _user_style(name="../x"),
            "kind": _user_style(kind="table"),
            "object_type": _user_style(object_type="Constellation"),
            "content": _user_style(content=[]),
            "content[0].provider": _user_style(content=[{"provider": "Nope", "group": None, "elements": ["Time"]}]),
            "content[0].group": _user_style(content=[{"provider": "Access Data", "group": "Default",
                                                      "elements": ["Duration"]}]),
            "content[0].elements": _user_style(content=[{"provider": "Access Data", "group": None, "elements": []}]),
            "content[0].elements[1]": _user_style(content=[{"provider": "Access Data", "group": None,
                                                            "elements": ["Duration", "Duration"]}]),
            "content[1].elements": _user_style(content=[aer[0], {"provider": "IPP Data", "group": None,
                                                                 "elements": ["MF"]}]),
            "graph": _user_style(graph={"type": "time_xy", "y1": ["Duration"], "y2": []}),
            "graph.type": _user_style(kind="graph", content=aer, graph={"type": "pie", "y1": [], "y2": []}),
            "graph.y1": _user_style(kind="graph", content=aer, graph={"type": "time_xy", "y1": [], "y2": []}),
            "graph.y2[0]": _user_style(kind="graph", content=aer,
                                       graph={"type": "time_xy", "y1": ["Elevation"], "y2": ["Time"]}),
            "summary.per_object[0]": _user_style(summary={"per_object": ["Median Duration"],
                                                          "global_statistics": [], "summary_only": False}),
            "summary.global_statistics[0]": _user_style(summary={"per_object": [],
                                                                 "global_statistics": ["Min Start Time"],
                                                                 "summary_only": False}),
            "dynamic": _user_style(dynamic=True),
            "derive": _user_style(derive="gaps", content=aer),
            "bogus": _user_style(bogus=1),
            "time.step_s": _user_style(time={"mode": "object_period", "step_s": 0}),
        }
        for field, style in cases.items():
            with self.subTest(field=field):
                self.assertEqual(_field(self, style), field)
        with self.assertRaises(StyleError) as cm:
            check_style([])
        self.assertEqual(cm.exception.field, "style")

    def test_step_is_capped_like_the_report_request(self):
        """style ที่ step เกิน MAX_STEP_S สร้างรายงานไม่ได้ (timedelta ล้น) จึงบันทึกเป็น style ไม่ได้ตั้งแต่ต้น"""
        self.assertEqual(MAX_STEP_S, 999_999_999)
        check_style(_user_style(time={"mode": "object_period", "step_s": MAX_STEP_S}))
        for step in (MAX_STEP_S + 1, 10 ** 12):
            for time in ({"mode": "object_period", "step_s": step},
                         {"mode": "specify", "start": "2026-11-10T00:00:00Z", "stop": "2026-11-10T01:00:00Z", "step_s": step}):
                with self.subTest(step=step, mode=time["mode"]):
                    self.assertEqual(_field(self, _user_style(time=time)), "time.step_s")

    def test_content_is_capped_at_16_entries(self):
        self.assertEqual(MAX_CONTENT, 16)
        entry = {"provider": "AER Data", "group": "Default", "elements": ["Time", "Elevation"]}
        check_style(_user_style(content=[dict(entry) for _ in range(MAX_CONTENT)]))
        with self.assertRaises(StyleError) as caught:
            check_style(_user_style(content=[dict(entry) for _ in range(MAX_CONTENT + 1)]))
        self.assertEqual(caught.exception.field, "content")
        self.assertRegex(str(caught.exception), "[฀-๿]")                      # ข้อความเป็นภาษาไทย
        installed = [len(s["content"]) for s in installed_styles()]
        self.assertLessEqual(max(installed), MAX_CONTENT)

    def test_valid_user_styles(self):
        check_style(_user_style())
        check_style(_user_style(name="My Style_2-x", summary={"per_object": ["Std Deviation Duration"],
                                                              "global_statistics": ["Number of Accesses"],
                                                              "summary_only": True}))
        # ช่องที่ไม่บังคับละได้ (group/time/summary/graph/dynamic/derive/ours)
        check_style({"name": "Small", "kind": "report", "object_type": "Facility",
                     "content": [{"provider": "Dilution of Precision", "elements": ["Time", "GDOP"]}]})
        # หลาย provider ที่มี Time ทุกตัว
        check_style(_user_style(dynamic=True, content=[
            {"provider": "AER Data", "group": "Default", "elements": ["Time", "Elevation"]},
            {"provider": "IPP Data", "group": None, "elements": ["Time", "MF"]}]))


class TestResolveStyle(unittest.TestCase):
    def test_resolve_order(self):
        mine_sc = _user_style(name="Mine", summary={"per_object": ["Number of Accesses"], "global_statistics": [],
                                                    "summary_only": False})
        mine_my = _user_style(name="Mine")
        self.assertEqual(resolve_style("Mine", None, [mine_my], [mine_sc]), mine_sc)
        self.assertEqual(resolve_style("mine", "report", [mine_my], []), mine_my)
        access = resolve_style("access", None, [], [])
        self.assertEqual((access["name"], access["kind"]), ("Access", "report"))
        self.assertEqual(resolve_style("ACCESS", "graph", [], [])["kind"], "graph")
        self.assertEqual(resolve_style("Az El Polar", None, [], [])["kind"], "graph")
        for name, kind in [("Nope", None), ("Az El Polar", "report"), ("Mine", "graph")]:
            with self.subTest(name=name, kind=kind), self.assertRaises(StyleError) as cm:
                resolve_style(name, kind, [mine_my], [])
            self.assertEqual(cm.exception.field, "style")

    def test_resolve_returns_copy(self):
        style = resolve_style("Access", "report", [], [])
        style["content"][0]["elements"].clear()
        self.assertEqual(len(resolve_style("Access", "report", [], [])["content"][0]["elements"]), 4)


class _Computed(unittest.TestCase):
    ecef = None

    @classmethod
    def setUpClass(cls):
        cls._tmp = tempfile.TemporaryDirectory()
        cls.scenario_dir, cls.data_dir = build_computed_scenario(Path(cls._tmp.name), ecef=cls.ecef)
        cls.doc = _intervals(cls.scenario_dir)
        cls.rs = open_result_set(cls.scenario_dir, cls.data_dir)

    @classmethod
    def tearDownClass(cls):
        cls._tmp.cleanup()

    def report(self, style, objects, start=None, stop=None, step_s=None):
        style = style if isinstance(style, dict) else _installed(*style)
        return build_report(self.rs, style, objects, start, stop, step_s, NOW)

    def durations(self, name):
        return [iv["duration_s"] for iv in self.doc["intervals"][name]]


class TestBuildReport(_Computed):
    def test_access_report_columns_match_stk_style(self):
        report = self.report(("Access",), [access_path("THBK", "G01")])
        self.assertIsInstance(report, Report)
        section = report.sections[0]
        self.assertIsInstance(section, Section)
        self.assertEqual([c.name for c in section.columns], ["Access", "Start Time", "Stop Time", "Duration"])
        self.assertEqual(section.columns[0], Column("Access", None, "int"))
        self.assertEqual(section.columns[1], Column("Start Time", None, "time"))
        self.assertEqual(section.columns[3], Column("Duration", "sec", "number"))
        self.assertEqual((section.object, section.title), (access_path("THBK", "G01"), "THBK-To-G01"))
        expected = [[k + 1, _t(iv["start"]), _t(iv["stop"]), iv["duration_s"]]
                    for k, iv in enumerate(self.doc["intervals"]["G01"])]
        self.assertTrue(expected)
        self.assertEqual(section.rows, expected)
        self.assertEqual(section.summary, [])
        self.assertEqual((report.scenario, report.style, report.kind, report.created, report.graph, report.dynamic),
                         ("Test_Scen", "Access", "report", NOW, None, False))

        aer = self.report(("AER",), [access_path("THBK", "G01")])
        self.assertEqual([c.name for c in aer.sections[0].columns], ["Time", "Azimuth", "Elevation", "Range"])
        self.assertEqual([c.unit for c in aer.sections[0].columns], [None, "deg", "deg", "km"])
        self.assertTrue(aer.sections[0].rows)
        self.assertTrue(aer.dynamic)
        dops = self.report(("All DOPs",), [THBK])
        self.assertEqual([c.name for c in dops.sections[0].columns], ["Time", "GDOP", "PDOP", "HDOP", "VDOP", "TDOP"])
        self.assertEqual(dops.sections[0].title, "THBK")
        self.assertEqual(len(dops.sections[0].rows), 361)

    def test_other_installed_styles_build(self):
        g01 = access_path("THBK", "G01")
        for style in installed_styles():
            obj = {"Access": g01, "Facility": THBK, "Satellite": "*/Satellite/G01"}[style["object_type"]]
            with self.subTest(name=style["name"], kind=style["kind"]):
                report = self.report(style, [obj])
                self.assertEqual(report.kind, style["kind"])
                self.assertEqual(report.graph, style["graph"])
                self.assertEqual(report.dynamic, style["dynamic"])
                section = report.sections[0]
                for row in section.rows:
                    self.assertEqual(len(row), len(section.columns))
        lla = self.report(("LLA Position",), ["*/Satellite/G01"])
        self.assertEqual(lla.sections[0].title, "G01")
        self.assertEqual([c.unit for c in lla.sections[0].columns],
                         [None, "deg", "deg", "km", "deg/sec", "deg/sec", "km/sec"])
        coverage = self.report(("N Asset Coverage", "graph"), [THBK])
        self.assertTrue(coverage.graph["stack"])
        self.assertEqual([c.kind for c in coverage.sections[0].columns], ["time"] + ["int"] * 5)

    def test_global_statistics_match_intervals_json(self):
        names = [name for name, ivs in self.doc["intervals"].items() if ivs]
        self.assertGreater(len(names), 1)
        report = self.report(("Access",), [access_path("THBK", n) for n in names])
        self.assertEqual([s.title for s in report.sections], [f"THBK-To-{n}" for n in names])
        stats = dict(report.global_statistics)
        self.assertEqual(list(stats), ["Min Duration", "Max Duration", "Mean Duration", "Total Duration"])
        expected = self.doc["global_statistics"]
        # intervals.json เก็บ duration_s ที่ปัด 3 ตำแหน่งแล้ว ส่วน global_statistics ของไฟล์ปัดหลังคิดจากค่าที่ยังไม่ปัด
        # Min/Max: การปัดเป็นฟังก์ชันไม่ลด ค่าจึงเท่ากันพอดี
        # Mean: ค่าเฉลี่ยของค่าที่ปัดแล้วต่างจากค่าเฉลี่ยจริง ≤ 0.0005 บวกการปัดของไฟล์อีก ≤ 0.0005 รวม ≤ 0.001
        # Total: ผลรวมของ n ค่าที่ปัดแล้วต่าง ≤ n·0.0005 บวกการปัดของไฟล์ ≤ 0.0005
        count = expected["count"]
        bounds = {"Min Duration": ("min_duration_s", 0.0), "Max Duration": ("max_duration_s", 0.0),
                  "Mean Duration": ("mean_duration_s", 0.001),
                  "Total Duration": ("total_duration_s", 0.0005 * (count + 1))}
        self.assertEqual(count, sum(len(self.doc["intervals"][n]) for n in names))
        for name, (key, delta) in bounds.items():
            with self.subTest(name=name):
                self.assertAlmostEqual(stats[name], expected[key], delta=delta + 1e-9)

    def test_single_object_has_no_global_statistics(self):
        report = self.report(("Access",), [access_path("THBK", "G01")])
        self.assertEqual(report.global_statistics, [])

    def test_global_statistics_with_no_rows_are_none(self):
        report = self.report(("Access",), [access_path("THBK", "G22"), access_path("THBK", "G22")])
        self.assertEqual(report.global_statistics, [("Min Duration", None), ("Max Duration", None),
                                                    ("Mean Duration", None), ("Total Duration", None)])

    def test_access_summary(self):
        names = ["G01", "E11"]
        report = self.report(("AccessSummary",), [access_path("THBK", n) for n in names])
        for section, name in zip(report.sections, names, strict=True):
            with self.subTest(name=name):
                durations = self.durations(name)
                self.assertTrue(durations)
                self.assertEqual(section.rows, [])
                self.assertEqual([c.name for c in section.columns], ["Duration"])
                summary = dict(section.summary)
                self.assertEqual(list(summary), ["Number of Accesses", "Min Duration", "Max Duration",
                                                 "Mean Duration", "Total Duration"])
                self.assertEqual(summary["Number of Accesses"], len(durations))
                self.assertEqual(summary["Min Duration"], min(durations))
                self.assertEqual(summary["Max Duration"], max(durations))
                self.assertAlmostEqual(summary["Mean Duration"], sum(durations) / len(durations), places=9)
                self.assertAlmostEqual(summary["Total Duration"], sum(durations), places=9)
        self.assertEqual(report.global_statistics, [])

    def test_access_with_no_intervals_has_empty_section(self):
        self.assertEqual(self.doc["intervals"]["G22"], [])
        g22 = access_path("THBK", "G22")
        access = self.report(("Access",), [g22])
        self.assertEqual(len(access.sections), 1)
        self.assertEqual(access.sections[0].rows, [])
        self.assertEqual(access.sections[0].title, "THBK-To-G22")
        summary = self.report(("AccessSummary",), [g22]).sections[0]
        self.assertEqual(summary.rows, [])
        self.assertEqual(summary.summary, [("Number of Accesses", 0), ("Min Duration", None), ("Max Duration", None),
                                           ("Mean Duration", None), ("Total Duration", None)])

    def test_window_and_step(self):
        start, stop = datetime(2026, 11, 10, 3, 0, tzinfo=UTC), datetime(2026, 11, 10, 4, 0, tzinfo=UTC)
        aer = self.report(("AER",), [access_path("THBK", "G01")], start, stop, 120).sections[0]
        self.assertTrue(aer.rows)
        for row in aer.rows:
            self.assertTrue(start <= row[0] <= stop)
            self.assertEqual((row[0] - START).total_seconds() % 120, 0)
        access = self.report(("Access",), [access_path("THBK", "G01")], start, stop).sections[0]
        self.assertEqual(access.rows, [[1, start, stop, 3600.0]])

    def test_bad_requests(self):
        g01 = access_path("THBK", "G01")
        with self.assertRaises(ScenarioError) as cm:
            self.report(("Access",), [THBK])
        self.assertEqual(cm.exception.field, "object")
        with self.assertRaises(ScenarioError) as cm:
            self.report(("Access",), [])
        self.assertEqual(cm.exception.field, "objects")
        with self.assertRaises(ScenarioError) as cm:
            self.report(("Access",), [g01], start=START)
        self.assertEqual(cm.exception.field, "time.stop")
        with self.assertRaises(ScenarioError) as cm:
            self.report(("Access",), [g01], stop=STOP)
        self.assertEqual(cm.exception.field, "time.start")
        with self.assertRaises(ScenarioError) as cm:
            self.report(("AER",), [g01], step_s=90)
        self.assertEqual(cm.exception.field, "time.step")
        bad = _user_style(content=[{"provider": "Access Data", "group": None, "elements": ["Start Time", "Bogus"]}])
        with self.assertRaises(StyleError) as cm:
            self.report(bad, [g01])
        self.assertEqual(cm.exception.field, "content[0].elements[1]")

    def test_multiple_providers_join_on_time(self):
        style = _user_style(content=[
            {"provider": "AER Data", "group": "Default", "elements": ["Time", "Elevation"]},
            {"provider": "IPP Data", "group": None, "elements": ["MF", "Time"]}])
        section = self.report(style, [access_path("THBK", "G01")]).sections[0]
        self.assertEqual([c.name for c in section.columns], ["Time", "Elevation", "MF"])
        aer = self.report(("AER",), [access_path("THBK", "G01")]).sections[0]
        self.assertEqual([r[0] for r in section.rows], [r[0] for r in aer.rows])
        self.assertEqual([r[1] for r in section.rows], [r[2] for r in aer.rows])
        self.assertTrue(all(isinstance(r[2], float) for r in section.rows))


def _toggle_ecef():
    """G01 ขึ้นเหนือ THBK สามช่วงที่ยาวต่างกัน, G22 อยู่เหนือ THBK ตลอด, R05 อยู่ใต้ขอบฟ้าตลอด, E/C วงโคจรวงกลม"""
    up = geodetic_to_ecef(THBK_LAT_DEG, THBK_LON_DEG, THBK_HEIGHT_M)
    norm = math.sqrt(sum(c * c for c in up))
    overhead = tuple(c / norm * 26560.0 for c in up)
    below = tuple(-c for c in overhead)
    windows = [(3600, 4800), (7200, 9600), (12000, 18000)]

    def ecef(prn: str, t_s: float):
        if prn == "G01":
            return overhead if any(a <= t_s < b for a, b in windows) else below
        if prn == "G22":
            return overhead
        if prn == "R05":
            return below
        return circular_ecef_km(prn[0], 0, 1, t_s)
    return ecef


class TestGaps(_Computed):
    ecef = staticmethod(_toggle_ecef())

    def gap_rows(self, name, start=None, stop=None):
        return self.report(("Gaps",), [access_path("THBK", name)], start, stop).sections[0].rows

    def assert_complement(self, name, lo, hi, window=(None, None)):
        """Gap ∪ Access ของ name = [lo, hi] พอดี ไม่ทับกัน เรียงตามเวลา
        window คือ start/stop ที่ส่งให้ build_report"""
        gaps = self.gap_rows(name, *window)
        self.assertEqual([g[0] for g in gaps], list(range(1, len(gaps) + 1)))
        for g in gaps:
            self.assertAlmostEqual(g[3], (g[2] - g[1]).total_seconds(), places=9)
        access = [(max(_t(iv["start"]), lo), min(_t(iv["stop"]), hi)) for iv in self.doc["intervals"][name]
                  if _t(iv["stop"]) > lo and _t(iv["start"]) < hi]
        pieces = sorted([(g[1], g[2], "gap") for g in gaps] + [(a, b, "access") for a, b in access])
        self.assertEqual(pieces[0][0], lo)
        self.assertEqual(pieces[-1][1], hi)
        for (_, b0, k0), (a1, _, k1) in zip(pieces, pieces[1:]):
            self.assertEqual(b0, a1)                  # ต่อกันพอดี ไม่ทับ ไม่เว้น
            self.assertNotEqual(k0, k1)               # สลับ gap กับ access
        for a, b, _ in pieces:
            self.assertLess(a, b)
        return gaps

    def test_gaps_complement(self):
        self.assertEqual(len(self.doc["intervals"]["G01"]), 3)
        for name in NAMES:
            with self.subTest(name=name):
                self.assert_complement(name, START, STOP)
        self.assertEqual(len(self.gap_rows("G01")), 4)

    def test_gaps_never_and_always(self):
        self.assertEqual(self.doc["intervals"]["R05"], [])
        self.assertEqual(self.gap_rows("R05"), [[1, START, STOP, 21600.0]])
        self.assertEqual([(_t(iv["start"]), _t(iv["stop"])) for iv in self.doc["intervals"]["G22"]], [(START, STOP)])
        self.assertEqual(self.gap_rows("G22"), [])

    def test_gaps_columns(self):
        section = self.report(("Gaps",), [access_path("THBK", "G01")]).sections[0]
        self.assertEqual(section.columns, [Column("Gap", None, "int"), Column("Start Time", None, "time"),
                                           Column("Stop Time", None, "time"), Column("Duration", "sec", "number")])

    def test_gaps_in_window(self):
        lo, hi = datetime(2026, 11, 10, 1, 30, tzinfo=UTC), datetime(2026, 11, 10, 4, 0, 0, 123456, tzinfo=UTC)
        hi_ms = datetime(2026, 11, 10, 4, 0, 0, 123000, tzinfo=UTC)
        gaps = self.assert_complement("G01", lo, hi_ms, window=(lo, hi))
        self.assertEqual(len(gaps), 2)
        self.assertEqual(gaps[0][1], lo)
        # ช่วงที่อยู่ใน access ตลอด
        inside = self.doc["intervals"]["G01"][2]
        a, b = _t(inside["start"]) + timedelta(minutes=5), _t(inside["stop"]) - timedelta(minutes=5)
        self.assertEqual(self.gap_rows("G01", a, b), [])
        # ช่วงนอกช่วงวิเคราะห์ทั้งหมด: ไม่มีแถว
        self.assertEqual(self.gap_rows("R05", STOP + timedelta(hours=1), STOP + timedelta(hours=2)), [])

    def test_gaps_for_a_satellite_without_a_prn_have_no_rows(self):
        """ดาวที่ไม่ได้ propagate (ไม่มี PRN) ไม่มีข้อมูลเลย: Gaps ไม่คิดว่าทั้งช่วงเป็นช่วงว่าง (ต่างจากดาวที่ propagate แล้วแต่ไม่ขึ้นเลย
        ซึ่งได้ช่วงว่างเต็มช่วง) ปักไว้ตามที่ตัดสินใจแล้ว (`_gaps`: ไม่มี PRN = [])"""
        manifest_path = next((self.scenario_dir / "ephem").glob("*/manifest.json"))
        original = manifest_path.read_text(encoding="utf-8")
        manifest = json.loads(original)
        entry = next(s for s in manifest["satellites"] if s["prn"] == "R05")
        entry["propagated"] = False
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
        try:
            rs = open_result_set(self.scenario_dir, self.data_dir)           # TableCache ใหม่: อ่าน manifest ที่แก้
            self.assertIsNone(rs.prn_of("R05"))
            style = _installed("Gaps")
            rows = build_report(rs, style, [access_path("THBK", "R05")], None, None, None, NOW).sections[0].rows
            self.assertEqual(rows, [])
            self.assertEqual(build_report(rs, _installed("Access"), [access_path("THBK", "R05")], None, None, None,
                                          NOW).sections[0].rows, [])           # Access Data ของดาวนั้นก็ไม่มีแถว
            # ดาวที่ propagate แล้วแต่ไม่ขึ้นเลยยังได้ช่วงว่างเต็มช่วง (ปักคู่กัน)
            self.assertEqual(self.gap_rows("R05"), [[1, START, STOP, 21600.0]])
        finally:
            manifest_path.write_text(original, encoding="utf-8")

    def test_std_deviation_population(self):
        durations = self.durations("G01")
        self.assertEqual(len(durations), 3)
        self.assertGreater(len(set(durations)), 1)
        style = _user_style(summary={"per_object": ["Std Deviation Duration", "Number of Accesses"],
                                     "global_statistics": ["Std Deviation Duration"], "summary_only": False})
        report = self.report(style, [access_path("THBK", "G01"), access_path("THBK", "G22")])
        g01, g22 = (dict(s.summary) for s in report.sections)
        self.assertAlmostEqual(g01["Std Deviation Duration"], statistics.pstdev(durations), places=9)
        self.assertEqual(g01["Number of Accesses"], 3)
        self.assertEqual(g22["Std Deviation Duration"], 0.0)            # หนึ่งช่วง: หารด้วย N = 0
        everything = durations + self.durations("G22")
        self.assertAlmostEqual(dict(report.global_statistics)["Std Deviation Duration"],
                               statistics.pstdev(everything), places=9)
        self.assertEqual(len(report.sections[0].rows), 3)


if __name__ == "__main__":
    unittest.main()
