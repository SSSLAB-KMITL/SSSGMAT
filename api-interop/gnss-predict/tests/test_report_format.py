"""ตัวจัดรูปแบบรายงาน (spec งานย่อยที่ 4 หัวข้อ 3.5, หัวข้อ 9 แถว 6, เกณฑ์ข้อ 3 / P13)

ค่าที่คาดอ่านจาก intervals.json ของ bundle ที่ build_computed_scenario เขียน ด้วย json ตรง ๆ ไม่ผ่าน report_style
ไฟล์ต้นแบบใน tests/fixtures/reports/ สร้างด้วย GNSS_WRITE_GOLDEN=1 แล้วตรวจด้วยตาเทียบ intervals.json ก่อน commit
"""

import json
import math
import os
import re
import shutil
import tempfile
import time
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from gnss_predict import studio
from gnss_predict.config import THBK_HEIGHT_M, THBK_LAT_DEG, THBK_LON_DEG
from gnss_predict.dataproviders import TableCache, access_path, open_result_set
from gnss_predict.errors import ScenarioError
from gnss_predict.geometry import geodetic_to_ecef
from gnss_predict.report_format import (ExportSetup, format_csv, format_time, format_txt, report_filename,
                                        report_json, time_format_of, time_unit)
from gnss_predict.report_style import Column, Report, Section, build_report, installed_styles, resolve_style
from tests.report_fixture import (SATELLITES, SCENARIO_NAME, SNAPSHOT_NAME, SNAPSHOT_SRC, build_computed_scenario,
                                  scenario_doc)

UTC = timezone.utc
START = datetime(2026, 11, 10, 0, 0, tzinfo=UTC)
STOP = datetime(2026, 11, 10, 6, 0, tzinfo=UTC)
NOW = datetime(2026, 11, 15, 0, 0, tzinfo=UTC)
THBK = "*/Facility/THBK"
G01 = access_path("THBK", "G01")
E11 = access_path("THBK", "E11")
G22 = access_path("THBK", "G22")
GOLDEN_DIR = Path(__file__).parent / "fixtures" / "reports"
ISO_MS = re.compile(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$")


def _t(text: str) -> datetime:
    return datetime.fromisoformat(text.replace("Z", "+00:00")).astimezone(UTC)


def ecef_from_az_el(az_deg: float, el_deg: float, range_km: float = 22000.0) -> tuple[float, float, float]:
    """ตำแหน่ง ECEF (กม.) ของจุดที่ Az/El/ระยะ ที่กำหนดจาก THBK (แกน ENU ตามเส้นตั้งฉากทรงรี)"""
    sta = geodetic_to_ecef(THBK_LAT_DEG, THBK_LON_DEG, THBK_HEIGHT_M)
    az, el = math.radians(az_deg), math.radians(el_deg)
    lat, lon = math.radians(THBK_LAT_DEG), math.radians(THBK_LON_DEG)
    e, n, u = (range_km * math.cos(el) * math.sin(az), range_km * math.cos(el) * math.cos(az),
               range_km * math.sin(el))
    dx = -math.sin(lon) * e - math.sin(lat) * math.cos(lon) * n + math.cos(lat) * math.cos(lon) * u
    dy = math.cos(lon) * e - math.sin(lat) * math.sin(lon) * n + math.cos(lat) * math.sin(lon) * u
    dz = math.cos(lat) * n + math.sin(lat) * u
    return sta[0] + dx, sta[1] + dy, sta[2] + dz


# ช่วงที่ G01 ขึ้นเหนือขอบฟ้า (วินาทีหลังต้นช่วง) เป็นครึ่งจำนวนเต็มของ 600 s ขอบช่วงจึงไม่ตรงแถวของไฟล์ต้นแบบ
# (step 600) และไม่ติดแถวที่ใช้ผลต่างกลางหา rate ทำให้ไม่มีแถวที่ rate กระโดดข้ามขอบ
G01_WINDOWS = [(3900, 5100), (7500, 9900), (12300, 18300)]


def _scene_ecef():
    """ดาวที่ Az/El จาก THBK ต่อเวลา t (วินาทีหลังต้นช่วง) ทำให้ค่าในไฟล์ต้นแบบต่างกันทุกแถวและคำนวณมือได้:
    G01 Az 20° + t/200 °/s El 60° ในสามช่วง G01_WINDOWS (นอกช่วงต่ำกว่าขอบฟ้า), C01 Az 300° El 50° ตั้งแต่ 3000 s,
    E11 Az 120° − t/300 °/s El 40° ตั้งแต่ 6000 s, R05 Az 240° El 30° ตั้งแต่ 7000 s จึงเห็นครบสี่ดวงที่เข้า DOP เฉพาะ
    ในช่วงที่ 2 และ 3 ของ G01 (G22 ถูกธง no_broadcast ไม่เข้า DOP) ส่วน G22 อยู่ใต้ขอบฟ้าตลอด (ไม่มี access เลย)"""
    def ecef(prn: str, t_s: float):
        if prn == "G01":
            on = any(a <= t_s < b for a, b in G01_WINDOWS)
            return ecef_from_az_el(20.0 + t_s / 200.0, 60.0 if on else -30.0)
        if prn == "C01":
            return ecef_from_az_el(300.0, 50.0 if t_s >= 3000 else -30.0)
        if prn == "E11":
            return ecef_from_az_el(120.0 - t_s / 300.0, 40.0 if t_s >= 6000 else -30.0)
        if prn == "R05":
            return ecef_from_az_el(240.0, 30.0 if t_s >= 7000 else -30.0)
        return ecef_from_az_el(180.0, -30.0)                            # G22
    return ecef


class _Computed(unittest.TestCase):
    """scenario 6 ชม. step 60 s ที่ G01 มี access สามช่วง E11 ช่วงเดียวถึงปลายช่วง และ G22 ไม่มี access เลย"""

    @classmethod
    def setUpClass(cls):
        cls._tmp = tempfile.TemporaryDirectory()
        cls.scenario_dir, cls.data_dir = build_computed_scenario(Path(cls._tmp.name), ecef=_scene_ecef())
        access_dir = next(p for p in (cls.scenario_dir / "access" / "THBK").iterdir() if p.is_dir())
        cls.doc = json.loads((access_dir / "intervals.json").read_text(encoding="utf-8"))
        cls.rs = open_result_set(cls.scenario_dir, cls.data_dir)

    @classmethod
    def tearDownClass(cls):
        cls._tmp.cleanup()

    def report(self, style, objects, start=None, stop=None, step_s=None) -> Report:
        if isinstance(style, tuple):                          # (ชื่อ,) หรือ (ชื่อ, ชนิด)
            style = resolve_style(style[0], style[1] if len(style) > 1 else "report", [], [])
        return build_report(self.rs, style, objects, start, stop, step_s, NOW)


def _sample_report(rows, *, summary=(), global_statistics=(), title="THBK-To-G01", style="Mine",
                   summary_only=False) -> Report:
    """รายงานที่ประกอบเอง (ไม่ผ่าน bundle) สำหรับทดสอบการจัดรูปแบบของค่าแต่ละแบบ"""
    columns = [Column("Time", None, "time"), Column("Azimuth", "deg", "number"), Column("MF", None, "number"),
               Column("N Visible", None, "int")]
    section = Section(G01, title, columns, [list(r) for r in rows], list(summary), summary_only)
    return Report("Test_Scen", style, "report", NOW, [section], list(global_statistics), None, False)


class TestFormatTime(unittest.TestCase):
    def test_format_time(self):
        self.assertEqual(format_time(datetime(2026, 1, 1, 16, tzinfo=UTC), "UTCG", "+07:00"),
                         "1 Jan 2026 16:00:00.000 UTCG")
        self.assertEqual(format_time(_t("2026-11-12T07:00:00.5Z"), "LTZG", "+07:00"),
                         "12 Nov 2026 14:00:00.500 LTZG+07:00")

    def test_same_cases_as_the_web_formatter(self):
        # web/tests/unit/time-format.test.ts
        cases = [("2026-11-12T20:30:00.500Z", "LTZG", "+07:00", "13 Nov 2026 03:30:00.500 LTZG+07:00"),
                 ("2026-01-01T03:00:00Z", "LTZG", "-05:00", "31 Dec 2025 22:00:00.000 LTZG-05:00"),
                 ("1969-12-31T23:59:59.999Z", "UTCG", "+07:00", "31 Dec 1969 23:59:59.999 UTCG"),
                 ("1969-12-31T20:00:00.000Z", "LTZG", "+07:00", "1 Jan 1970 03:00:00.000 LTZG+07:00"),
                 ("2024-02-29T23:59:59.999Z", "UTCG", "+07:00", "29 Feb 2024 23:59:59.999 UTCG"),
                 ("2100-03-01T00:00:00.000Z", "UTCG", "+07:00", "1 Mar 2100 00:00:00.000 UTCG"),
                 ("2026-11-12T07:00:00Z", "LTZG", "+00:00", "12 Nov 2026 07:00:00.000 LTZG+00:00"),
                 ("2026-11-12T07:00:00Z", "LTZG", "+05:45", "12 Nov 2026 12:45:00.000 LTZG+05:45"),
                 # offset เพี้ยน: ป้ายท้ายบอกว่าเป็น UTC เหมือนหน้าเว็บ
                 ("2026-11-12T07:00:00Z", "LTZG", "seven", "12 Nov 2026 07:00:00.000 UTCG"),
                 ("2026-11-12T07:00:00Z", "LTZG", "+24:00", "12 Nov 2026 07:00:00.000 UTCG"),
                 # เลขอารบิก-อินดิกไม่ใช่ตัวเลขของ offset (regex \\d ของ JS รับแค่ ASCII)
                 ("2026-11-12T07:00:00Z", "LTZG", "+\u0660\u0667:\u0660\u0660", "12 Nov 2026 07:00:00.000 UTCG")]
        for iso, fmt, offset, want in cases:
            with self.subTest(iso=iso, fmt=fmt, offset=offset):
                self.assertEqual(format_time(_t(iso), fmt, offset), want)

    def test_sub_millisecond_is_truncated_and_other_zones_are_converted(self):
        self.assertEqual(format_time(datetime(2026, 1, 1, 0, 0, 0, 999999, tzinfo=UTC), "UTCG", "+07:00"),
                         "1 Jan 2026 00:00:00.999 UTCG")
        local = datetime(2026, 1, 1, 7, 0, tzinfo=timezone(timedelta(hours=7)))
        self.assertEqual(format_time(local, "UTCG", "+07:00"), "1 Jan 2026 00:00:00.000 UTCG")

    def test_bad_arguments(self):
        with self.assertRaises(ValueError):
            format_time(datetime(2026, 1, 1), "UTCG", "+07:00")          # ไม่ระบุเขตเวลา
        with self.assertRaises(ValueError):
            format_time(datetime(2026, 1, 1, tzinfo=UTC), "GPS", "+07:00")

    def test_time_unit(self):
        self.assertEqual(time_unit("UTCG", "+07:00"), "UTCG")
        self.assertEqual(time_unit("LTZG", "+07:00"), "LTZG+07:00")
        self.assertEqual(time_unit("LTZG", "-05:30"), "LTZG-05:30")
        self.assertEqual(time_unit("LTZG", "bad"), "UTCG")
        with self.assertRaises(ValueError):
            time_unit("local", "+07:00")

    def test_time_format_of_scenario_units(self):
        self.assertEqual(time_format_of({}), ("UTCG", "+07:00"))
        self.assertEqual(time_format_of({"units": {"date_format": "LTZG", "ltz_offset": "-05:00"}}),
                         ("LTZG", "-05:00"))
        self.assertEqual(time_format_of({"units": {"date_format": "LTZG"}}), ("LTZG", "+07:00"))
        for units, field in [("x", "units"), ({"date_format": "GPS"}, "units.date_format"),
                             ({"ltz_offset": "7"}, "units.ltz_offset"), ({"ltz_offset": "+24:00"}, "units.ltz_offset"),
                             ({"date_format": 5}, "units.date_format"),
                             ({"ltz_offset": "+\u0660\u0667:\u0660\u0660"}, "units.ltz_offset")]:
            with self.subTest(units=units), self.assertRaises(ScenarioError) as cm:
                time_format_of({"units": units})
            self.assertEqual(cm.exception.field, field)


class TestTxtLayout(_Computed):
    def test_txt_layout(self):
        report = self.report(("Access",), [G01, E11])
        lines = format_txt(report, "UTCG", "+07:00").split("\n")
        self.assertEqual(lines[0], "Test_Scen    15 Nov 2026 00:00:00.000 UTCG")
        self.assertIn("THBK-To-G01:  Access", lines)
        self.assertIn("THBK-To-E11:  Access", lines)
        self.assertEqual(lines[-1], "")                                  # จบด้วย newline
        for name in ("G01", "E11"):
            with self.subTest(name=name):
                title = lines.index(f"THBK-To-{name}:  Access")
                self.assertEqual(lines[title + 1], "")
                header, underline = lines[title + 2], lines[title + 3]
                self.assertIn("Start Time (UTCG)", header)
                self.assertIn("Stop Time (UTCG)", header)
                self.assertIn("Duration (sec)", header)
                self.assertTrue(set(underline) <= {"-", " "} and "-" in underline)
                self.assertEqual(len(underline), len(header))
                data = []
                for line in lines[title + 4:]:
                    if not line:
                        break
                    data.append(line)
                self.assertEqual(len(data), len(self.doc["intervals"][name]))
                self.assertEqual({len(line) for line in data}, {len(header)})          # คอลัมน์กว้างคงที่
                for k, (line, iv) in enumerate(zip(data, self.doc["intervals"][name], strict=True), start=1):
                    self.assertEqual(line[:6], f"{k:>6}")                            # จำนวนเต็มชิดขวา
                    self.assertRegex(line, rf"UTCG\s+{iv['duration_s']:.3f}$")
                self.assertEqual({line.rindex(".") for line in data}, {len(header) - 4})   # จุดทศนิยมตรงกัน

        at = lines.index("Global Statistics")
        self.assertEqual(lines[at + 1], "-----------------")
        names = [line.split("  ")[0] for line in lines[at + 2:] if line]
        self.assertEqual(names, ["Min Duration", "Max Duration", "Mean Duration", "Total Duration"])

    def test_global_statistics_values_by_hand(self):
        durations = [iv["duration_s"] for n in ("G01", "E11") for iv in self.doc["intervals"][n]]
        self.assertEqual(len(durations), 4)
        total = math.fsum(durations)
        want = {"Min Duration": min(durations), "Max Duration": max(durations),
                "Mean Duration": total / len(durations), "Total Duration": total}
        lines = format_txt(self.report(("Access",), [G01, E11]), "UTCG", "+07:00").split("\n")
        at = lines.index("Global Statistics")
        got = {line.rsplit(None, 1)[0].strip(): line.rsplit(None, 1)[1] for line in lines[at + 2:] if line}
        self.assertEqual(got, {name: f"{value:.3f}" for name, value in want.items()})
        # ค่าอยู่ชิดขวาในคอลัมน์เดียวกัน
        self.assertEqual(len({len(line) for line in lines[at + 2:] if line}), 1)

    def test_txt_no_data_and_na(self):
        # G22 ไม่มี access ทั้งช่วง; หน้าต่าง 00:00–00:30 ไม่มี access ของ G01 ด้วย → Global Statistics ว่างทั้งหมด
        end = START + timedelta(minutes=30)
        empty = self.report(("Access",), [G01, G22], START, end)
        lines = format_txt(empty, "UTCG", "+07:00").split("\n")
        for name in ("G01", "G22"):
            title = lines.index(f"THBK-To-{name}:  Access")
            self.assertEqual(lines[title + 4], "No Data")
            self.assertIn("Duration (sec)", lines[title + 2])
        at = lines.index("Global Statistics")
        self.assertEqual(lines[at + 1], "-----------------")
        stats = [line for line in lines[at + 2:] if line]
        self.assertEqual(len(stats), 4)
        self.assertTrue(all(line.endswith("N/A") for line in stats), stats)
        csv_text = format_csv(empty, "UTCG", "+07:00")
        self.assertNotIn("No Data", csv_text)
        self.assertEqual(csv_text.split("\n")[0], "Access,Start Time (UTCG),Stop Time (UTCG),Duration (sec)")

        mixed = format_txt(self.report(("Access",), [G01, G22]), "UTCG", "+07:00").split("\n")
        self.assertEqual(mixed[mixed.index("THBK-To-G22:  Access") + 4], "No Data")
        self.assertFalse(any(line.endswith("N/A") for line in mixed[mixed.index("Global Statistics"):]))

    def test_summary_only_section_has_no_table(self):
        lines = format_txt(self.report(("AccessSummary",), [G01, G22]), "UTCG", "+07:00").split("\n")
        g01 = lines.index("THBK-To-G01:  AccessSummary")
        durations = [iv["duration_s"] for iv in self.doc["intervals"]["G01"]]
        self.assertEqual(lines[g01 + 1], "")
        got = [line for line in lines[g01 + 2:lines.index("THBK-To-G22:  AccessSummary") - 1]]
        self.assertEqual([line.split("  ")[0] for line in got],
                         ["Number of Accesses", "Min Duration", "Max Duration", "Mean Duration", "Total Duration"])
        self.assertTrue(got[0].endswith(" 3"))
        self.assertTrue(got[1].endswith(f" {min(durations):.3f}"))
        self.assertFalse(any("Start Time" in line or "Duration (sec)" in line for line in lines))
        g22 = lines[lines.index("THBK-To-G22:  AccessSummary") + 2:]
        self.assertTrue(g22[0].endswith(" 0"))                       # Number of Accesses = 0
        self.assertTrue(g22[1].endswith("N/A"))
        self.assertNotIn("Global Statistics", lines)

    def test_summary_only_flag_comes_from_the_style(self):
        for name, flag in (("AccessSummary", True), ("Access", False), ("Gaps", False)):
            with self.subTest(name=name):
                report = self.report((name,), [G01, G22])
                self.assertEqual([s.summary_only for s in report.sections], [flag, flag])
        self.assertEqual([s["summary_only"] for s in report_json(self.report(("AccessSummary",), [G01]))["sections"]],
                         [True])
        self.assertEqual([s["summary_only"] for s in report_json(self.report(("Access",), [G01]))["sections"]],
                         [False])

    def test_zero_rows_with_statistics_is_no_data_unless_summary_only(self):
        """style ที่มีสถิติต่อ object แต่ไม่ใช่ Summary Only: object ที่ไม่มี access ต้องยังมีตารางและ No Data"""
        style = {"name": "Mine", "kind": "report", "object_type": "Access",
                 "content": [{"provider": "Access Data", "group": None,
                              "elements": ["Access Number", "Start Time", "Stop Time", "Duration"]}],
                 "summary": {"per_object": ["Number of Accesses", "Min Duration"], "global_statistics": [],
                             "summary_only": False}}
        report = self.report(style, [G01, G22])
        self.assertEqual([s.summary_only for s in report.sections], [False, False])
        self.assertEqual(report.sections[1].rows, [])
        self.assertEqual(report.sections[1].summary, [("Number of Accesses", 0), ("Min Duration", None)])
        lines = format_txt(report, "UTCG", "+07:00").split("\n")
        at = lines.index("THBK-To-G22:  Mine")
        self.assertEqual(lines[at + 1], "")
        self.assertIn("Start Time (UTCG)", lines[at + 2])                 # ยังมีหัวคอลัมน์และเส้นขีด
        self.assertTrue(set(lines[at + 3]) <= {"-", " "})
        self.assertEqual(lines[at + 4], "No Data")
        self.assertEqual(lines[at + 5], "")
        self.assertEqual([line.split("  ")[0] for line in lines[at + 6:at + 8]], ["Number of Accesses", "Min Duration"])
        self.assertTrue(lines[at + 6].endswith(" 0") and lines[at + 7].endswith("N/A"))
        g01 = lines.index("THBK-To-G01:  Mine")
        self.assertIn("Start Time (UTCG)", lines[g01 + 2])
        blank = lines.index("", g01 + 4)                                  # หลังแถวของ G01 มีสถิติต่อท้าย
        self.assertEqual(blank - (g01 + 4), 3)
        self.assertTrue(lines[blank + 1].startswith("Number of Accesses") and lines[blank + 1].endswith(" 3"))
        # csv: object ที่ไม่มีแถวมีแต่หัวคอลัมน์ ไม่มีแถวสถิติ ส่วนที่มีแถวไม่มีสถิติต่อท้าย
        csv_lines = format_csv(report, "UTCG", "+07:00").split("\n")
        header = "Access,Start Time (UTCG),Stop Time (UTCG),Duration (sec)"
        self.assertEqual(csv_lines[-3:], ["", header, ""])
        self.assertEqual(csv_lines.count(header), 2)
        self.assertFalse(any(line.startswith(("Number of Accesses", "Min Duration")) for line in csv_lines))
        # สถิติล้วนเกิดเฉพาะเมื่อ style เป็น Summary Only
        only = dict(style, summary=dict(style["summary"], summary_only=True))
        only_lines = format_txt(self.report(only, [G01, G22]), "UTCG", "+07:00").split("\n")
        self.assertFalse(any("Start Time" in line or line == "No Data" for line in only_lines))
        self.assertEqual(format_csv(self.report(only, [G22]), "UTCG", "+07:00"),
                         "Number of Accesses,0\nMin Duration,\n")

    def test_summary_only_without_statistics_prints_no_data(self):
        style = {"name": "Mine", "kind": "report", "object_type": "Access",
                 "content": [{"provider": "Access Data", "group": None, "elements": ["Duration"]}],
                 "summary": {"per_object": [], "global_statistics": [], "summary_only": True}}
        report = self.report(style, [G01])
        self.assertEqual(report.sections[0].summary_only, True)
        lines = format_txt(report, "UTCG", "+07:00").split("\n")
        self.assertEqual(lines[2:5], ["THBK-To-G01:  Mine", "", "No Data"])
        self.assertEqual(format_csv(report, "UTCG", "+07:00"), "")

    def test_date_format_ltzg(self):
        report = self.report(("Access",), [G01])
        text = format_txt(report, "LTZG", "+07:00")
        self.assertIn("Start Time (LTZG+07:00)", text)
        self.assertIn("Stop Time (LTZG+07:00)", text)
        first = _t(self.doc["intervals"]["G01"][0]["start"]) + timedelta(hours=7)
        want = (f"{first.day} {first:%b} {first.year} {first:%H:%M:%S}.{first.microsecond // 1000:03d} "
                "LTZG+07:00")
        self.assertIn(want, text)
        self.assertEqual(text.split("\n")[0], "Test_Scen    15 Nov 2026 00:00:00.000 UTCG")   # เวลาสร้างเป็น UTCG เสมอ
        csv_text = format_csv(report, "LTZG", "+07:00")
        self.assertEqual(csv_text.split("\n")[0],
                         "Access,Start Time (LTZG+07:00),Stop Time (LTZG+07:00),Duration (sec)")
        self.assertIn(want, csv_text)


class TestValues(unittest.TestCase):
    """รูปแบบค่าแต่ละชนิด (P9) และค่าที่ไม่มี โดยไม่ต้องมี bundle"""

    def test_numbers_decimals_and_alignment(self):
        t = datetime(2026, 11, 10, 1, 2, 3, 400000, tzinfo=UTC)
        report = _sample_report([[t, 359.99951, 0.123456, 12], [t + timedelta(days=30), -0.0004, 1.0, 7]])
        lines = format_txt(report, "UTCG", "+07:00").split("\n")
        gap = " " * 4
        # กว้าง: Time 29 ("10 Nov 2026 01:02:03.400 UTCG"), Azimuth (deg) 13, MF 7 (0.12346), N Visible 9
        self.assertEqual(lines[4], "Time (UTCG)" + " " * 18 + gap + "Azimuth (deg)" + gap + " " * 5 + "MF" + gap
                         + "N Visible")
        self.assertEqual(lines[5], "-" * 29 + gap + "-" * 13 + gap + "-" * 7 + gap + "-" * 9)
        self.assertEqual(lines[6], "10 Nov 2026 01:02:03.400 UTCG" + gap + " " * 6 + "360.000" + gap + "0.12346" + gap
                         + " " * 7 + "12")
        self.assertEqual(lines[7], "10 Dec 2026 01:02:03.400 UTCG" + gap + " " * 8 + "0.000" + gap + "1.00000" + gap
                         + " " * 8 + "7")                          # -0.0004 ปัดเป็น 0.000 ไม่ใช่ -0.000
        self.assertEqual({len(line) for line in lines[4:8]}, {len(lines[4])})

    def test_decimals_by_element(self):
        cases = {"IPP Lat": (27.18562, "27.1856"), "IPP Lon": (85.30157, "85.3016"), "MF": (0.338621, "0.33862"),
                 "Lat Rate": (0.0012344, "0.001234"), "Lon Rate": (-0.0012344, "-0.001234"),
                 "Alt Rate": (0.0012344, "0.001234"), "Azimuth": (123.4567, "123.457"),
                 "Range": (22000.1234, "22000.123"), "GDOP": (1.5, "1.500"), "Duration": (600.25, "600.250"),
                 "Lat": (13.7563, "13.756")}
        for name, (value, want) in cases.items():
            section = Section(G01, "T", [Column(name, None, "number")], [[value]], [])
            report = Report("S", "x", "report", NOW, [section], [], None, False)
            with self.subTest(name=name):
                self.assertEqual(format_csv(report, "UTCG", "+07:00").split("\n")[1], want)

    def test_none_and_non_finite_values(self):
        t = datetime(2026, 11, 10, tzinfo=UTC)
        report = _sample_report([[t, None, math.nan, None], [t, math.inf, 0.5, 3]],
                                summary=[("Min Azimuth", None), ("Max Azimuth", math.nan), ("Number of Accesses", 0)])
        txt = format_txt(report, "UTCG", "+07:00").split("\n")
        self.assertEqual(txt[6].split()[5:], ["N/A", "N/A", "N/A"])
        self.assertEqual(txt[7].split()[5:], ["N/A", "0.50000", "3"])
        self.assertEqual({len(line) for line in txt[4:8]}, {len(txt[4])})
        stats = txt[9:12]
        self.assertEqual([line.split("  ")[0] for line in stats], ["Min Azimuth", "Max Azimuth", "Number of Accesses"])
        self.assertEqual([line.split()[-1] for line in stats], ["N/A", "N/A", "0"])
        self.assertEqual(len({len(line) for line in stats}), 1)
        csv_lines = format_csv(report, "UTCG", "+07:00").split("\n")
        self.assertEqual(csv_lines[1], "10 Nov 2026 00:00:00.000 UTCG,,,")
        self.assertEqual(csv_lines[2], "10 Nov 2026 00:00:00.000 UTCG,,0.50000,3")
        data = report_json(report)
        self.assertEqual(data["sections"][0]["rows"], [["2026-11-10T00:00:00.000Z", None, None, None],
                                                       ["2026-11-10T00:00:00.000Z", None, 0.5, 3]])
        self.assertEqual(data["sections"][0]["summary"], [{"name": "Min Azimuth", "value": None},
                                                          {"name": "Max Azimuth", "value": None},
                                                          {"name": "Number of Accesses", "value": 0}])
        json.dumps(data, allow_nan=False)

    def test_statistic_values_follow_their_element(self):
        report = _sample_report([], summary=[("Mean MF", 0.123456), ("Min N Visible", 4), ("Mean N Visible", 4.5),
                                             ("Std Deviation Azimuth", 1.23456), ("Total Lat Rate", 0.0000012)],
                                summary_only=True)
        lines = format_txt(report, "UTCG", "+07:00").split("\n")
        self.assertEqual([line.rsplit(None, 1)[1] for line in lines[4:9]],
                         ["0.12346", "4", "4.500", "1.235", "0.000001"])

    def test_csv_header_and_setup(self):
        report = build_report_for_setup()
        text = format_csv(report, "UTCG", "+07:00")
        lines = text.split("\n")
        self.assertEqual(lines[0], "Access,Start Time (UTCG),Stop Time (UTCG),Duration (sec)")
        self.assertNotIn("Global Statistics", text)
        self.assertEqual(lines[1], "1,10 Nov 2026 01:00:00.000 UTCG,10 Nov 2026 01:10:00.250 UTCG,600.250")
        self.assertEqual(lines[-1], "")
        self.assertEqual(text, format_csv(report, "UTCG", "+07:00", ExportSetup()))

        custom = format_csv(report, "UTCG", "+07:00", ExportSetup(delimiter=";", quote_headers=True, title=True))
        lines = custom.split("\n")
        self.assertEqual(lines[0], "THBK-To-G01:  Access")
        self.assertEqual(lines[1], '"Access";"Start Time (UTCG)";"Stop Time (UTCG)";"Duration (sec)"')
        self.assertEqual(lines[2], "1;10 Nov 2026 01:00:00.000 UTCG;10 Nov 2026 01:10:00.250 UTCG;600.250")

        bare = format_csv(report, "UTCG", "+07:00", ExportSetup(headers=False))
        self.assertTrue(bare.startswith("1,10 Nov 2026 01:00:00.000 UTCG,"))
        self.assertNotIn("Start Time", bare)
        titled_bare = format_csv(report, "UTCG", "+07:00", ExportSetup(headers=False, title=True)).split("\n")
        self.assertEqual(titled_bare[0], "THBK-To-G01:  Access")
        self.assertTrue(titled_bare[1].startswith("1,"))

    def test_csv_quotes_fields_that_contain_the_delimiter(self):
        report = build_report_for_setup()
        lines = format_csv(report, "UTCG", "+07:00", ExportSetup(delimiter=" ")).split("\n")
        self.assertEqual(lines[1], '1 "10 Nov 2026 01:00:00.000 UTCG" "10 Nov 2026 01:10:00.250 UTCG" 600.250')
        tab = format_csv(report, "UTCG", "+07:00", ExportSetup(delimiter="\t")).split("\n")
        self.assertEqual(tab[0], "Access\tStart Time (UTCG)\tStop Time (UTCG)\tDuration (sec)")

    def test_export_setup_rules(self):
        self.assertEqual(ExportSetup(), ExportSetup(",", False, False, True))
        for bad in ["", ";;", '"', "\n", "\r"]:
            with self.subTest(delimiter=bad), self.assertRaises(ScenarioError) as cm:
                ExportSetup(delimiter=bad)
            self.assertEqual(cm.exception.field, "export.delimiter")

    def test_csv_with_several_sections(self):
        one = build_report_for_setup()
        two = Report("Test_Scen", "Access", "report", NOW, [one.sections[0], one.sections[0]], [], None, False)
        lines = format_csv(two, "UTCG", "+07:00").split("\n")
        self.assertEqual(len(lines), 6)                      # (หัว + 1 แถว) × 2 คั่นด้วยบรรทัดว่าง + บรรทัดท้าย
        self.assertEqual(lines[2], "")
        titled = format_csv(two, "UTCG", "+07:00", ExportSetup(title=True)).split("\n")
        self.assertEqual([line for line in titled if line.startswith("THBK")], ["THBK-To-G01:  Access"] * 2)

    def test_csv_summary_only_section_lists_the_statistics(self):
        section = Section(G01, "THBK-To-G01", [Column("Duration", "sec", "number")], [],
                          [("Number of Accesses", 3), ("Mean Duration", 11245.7966), ("Min Duration", None)], True)
        report = Report("S", "AccessSummary", "report", NOW, [section], [("Min Duration", 1.0)], None, False)
        self.assertEqual(format_csv(report, "UTCG", "+07:00"), "Number of Accesses,3\nMean Duration,11245.797\n"
                                                              "Min Duration,\n")


def build_report_for_setup() -> Report:
    """Access ของ THBK-To-G01 หนึ่งช่วง (ไม่ผ่าน bundle)"""
    columns = [Column("Access", None, "int"), Column("Start Time", None, "time"), Column("Stop Time", None, "time"),
               Column("Duration", "sec", "number")]
    row = [1, datetime(2026, 11, 10, 1, 0, tzinfo=UTC), datetime(2026, 11, 10, 1, 10, 0, 250000, tzinfo=UTC), 600.25]
    section = Section(G01, "THBK-To-G01", columns, [row], [])
    return Report("Test_Scen", "Access", "report", NOW, [section], [], None, False)


class TestJsonAndFilename(_Computed):
    def test_report_json_shape(self):
        report = self.report(("AER",), [G01])
        data = report_json(report)
        self.assertEqual(list(data), ["scenario", "style", "kind", "created_utc", "sections", "global_statistics",
                                      "graph", "dynamic"])
        self.assertEqual((data["scenario"], data["style"], data["kind"], data["created_utc"], data["graph"],
                          data["dynamic"], data["global_statistics"]),
                         ("Test_Scen", "AER", "report", "2026-11-15T00:00:00.000Z", None, True, []))
        section = data["sections"][0]
        self.assertEqual(list(section), ["object", "title", "columns", "rows", "summary", "summary_only"])
        self.assertEqual((section["object"], section["title"], section["summary"], section["summary_only"]),
                         (G01, "THBK-To-G01", [], False))
        self.assertEqual(section["columns"], [{"name": "Time", "unit": None, "kind": "time"},
                                              {"name": "Azimuth", "unit": "deg", "kind": "number"},
                                              {"name": "Elevation", "unit": "deg", "kind": "number"},
                                              {"name": "Range", "unit": "km", "kind": "number"}])
        self.assertTrue(section["rows"])
        for row in section["rows"]:
            self.assertRegex(row[0], ISO_MS)
            self.assertEqual(len(row), 4)
        self.assertEqual(section["rows"][0][0], report.sections[0].rows[0][0].strftime("%Y-%m-%dT%H:%M:%S.000Z"))
        self.assertEqual(section["rows"][0][1:], report.sections[0].rows[0][1:])
        json.dumps(data, allow_nan=False)

    def test_report_json_access_statistics_and_graph(self):
        data = report_json(self.report(("Access",), [G01, E11]))
        self.assertEqual([s["name"] for s in data["global_statistics"]],
                         ["Min Duration", "Max Duration", "Mean Duration", "Total Duration"])
        first = data["sections"][0]["rows"][0]
        iv = self.doc["intervals"]["G01"][0]
        self.assertEqual(first, [1, iv["start"], iv["stop"], iv["duration_s"]])
        graph = report_json(build_report(self.rs, resolve_style("AER", "graph", [], []), [G01], None, None, None, NOW))
        self.assertEqual(graph["graph"], {"type": "time_xy", "y1": ["Azimuth", "Elevation"], "y2": ["Range"],
                                          "stack": False})
        summary = report_json(self.report(("AccessSummary",), [G01]))
        self.assertEqual(summary["sections"][0]["rows"], [])
        self.assertEqual(summary["sections"][0]["summary"][0], {"name": "Number of Accesses", "value": 3})

    def test_report_filename(self):
        self.assertEqual(report_filename(self.report(("Access",), [G01]), "txt"), "THBK-To-G01_Access.txt")
        self.assertEqual(report_filename(self.report(("Access",), [G01]), "csv"), "THBK-To-G01_Access.csv")
        self.assertEqual(report_filename(self.report(("Access",), [G01, E11]), "txt"), "Access.txt")
        polar = build_report(self.rs, resolve_style("Az El Polar", "graph", [], []), [E11], None, None, None, NOW)
        self.assertEqual(report_filename(polar, "csv"), "THBK-To-E11_Az_El_Polar.csv")
        self.assertEqual(report_filename(self.report(("Access",), [G01]), ".txt"), "THBK-To-G01_Access.txt")
        hostile = Report("S", 'a/b "c"\r\n', "report", NOW, self.report(("Access",), [G01]).sections, [], None, False)
        self.assertEqual(report_filename(hostile, "txt"), "THBK-To-G01_a_b__c___.txt")


class TestGolden(_Computed):
    """§9 แถว 6: txt และ csv ของ Installed Styles ทุกตัวต้องตรงไฟล์ต้นแบบทุกตัวอักษร"""

    OBJECTS = {"Access": [G01, E11], "Facility": [THBK], "Satellite": ["*/Satellite/G01"]}

    @staticmethod
    def slug(style: dict) -> str:
        return f"{style['name'].lower().replace(' ', '_')}_{style['kind']}"

    def test_golden_files(self):
        write = os.environ.get("GNSS_WRITE_GOLDEN") == "1"
        styles = installed_styles()
        self.assertEqual(len(styles), 14)
        produced = {}
        for style in styles:
            report = build_report(self.rs, style, self.OBJECTS[style["object_type"]], None, None, 600, NOW)
            produced[f"{self.slug(style)}.txt"] = format_txt(report, "UTCG", "+07:00")
            produced[f"{self.slug(style)}.csv"] = format_csv(report, "UTCG", "+07:00")
        self.assertEqual(len(produced), 28)
        if write:
            GOLDEN_DIR.mkdir(parents=True, exist_ok=True)
            for name, text in produced.items():
                (GOLDEN_DIR / name).write_bytes(text.encode("utf-8"))
            self.skipTest(f"เขียนไฟล์ต้นแบบ {len(produced)} ไฟล์ที่ {GOLDEN_DIR} แล้ว ตรวจด้วยตาก่อน commit")
        for name, text in produced.items():
            with self.subTest(name=name):
                path = GOLDEN_DIR / name
                self.assertTrue(path.is_file(), f"ไม่มีไฟล์ต้นแบบ {path} (สร้างด้วย GNSS_WRITE_GOLDEN=1)")
                self.assertEqual(text, path.read_bytes().decode("utf-8"))
        extra = sorted(p.name for p in GOLDEN_DIR.iterdir() if p.suffix in (".txt", ".csv"))      # ข้าม .DS_Store
        self.assertEqual(extra, sorted(produced), "มีไฟล์ต้นแบบเกินหรือขาด")


# ---------- เกณฑ์ความเร็ว (ข้อ 3, P13) ----------

SYSTEMS = {"G": 32, "R": 24, "E": 36, "C": 38}
PRNS = [f"{system}{n:02d}" for system, count in SYSTEMS.items() for n in range(1, count + 1)]
EPOCHS = 2881                                                    # 1 วัน step 30 s
DAY_START = datetime(2026, 11, 10, tzinfo=UTC)
# access ของทุกดาว: สองช่วง ช่วงละ 4 ชม.
SYNTHETIC_ACCESS = [(timedelta(hours=2), timedelta(hours=6)), (timedelta(hours=14), timedelta(hours=18))]


def _iso_s(t: datetime) -> str:
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


def _iso_ms(t: datetime) -> str:
    return t.strftime("%Y-%m-%dT%H:%M:%S.000Z")


def write_synthetic_bundle(root: Path) -> tuple[Path, Path]:
    """scenario 1 วัน step 30 s ที่มี bundle เขียนเอง: aer.csv ทุก PRN ทุกจุด El = 45 (374,530 แถว)"""
    data_dir = root / "data"
    shutil.copytree(SNAPSHOT_SRC, data_dir / "orbits" / SNAPSHOT_NAME)
    scenario_dir = data_dir / "scenarios" / SCENARIO_NAME
    scenario_dir.mkdir(parents=True)
    (scenario_dir / studio.SCENARIO_FILE).write_text(
        json.dumps(scenario_doc("2026-11-10T00:00:00Z", "2026-11-11T00:00:00Z", 30)), encoding="utf-8")
    ephem_dir = scenario_dir / studio.EPHEM_DIR / studio.plan_propagate(scenario_dir, data_dir).hash
    access_dir = scenario_dir / studio.ACCESS_DIR / "THBK" / studio.plan_analyze(scenario_dir, "THBK", data_dir)
    ephem_dir.mkdir(parents=True)
    access_dir.mkdir(parents=True)
    satellites = [{"norad": norad, "prn": name, "propagated": True} for name, norad in SATELLITES]
    (ephem_dir / studio.MANIFEST).write_text(json.dumps({"satellites": satellites}), encoding="utf-8")

    times = [DAY_START + timedelta(seconds=30 * k) for k in range(EPOCHS)]
    stamps = [_iso_s(t) for t in times]
    with open(access_dir / "aer.csv", "w", encoding="utf-8", newline="") as f:
        f.write(",".join(studio.AER_HEADER) + "\n")
        for stamp in stamps:
            f.write("".join(f"{stamp},{prn},123.456,45.000,22000.123,12.3456,100.1234,0.70711\n" for prn in PRNS))
    intervals = {prn: [{"start": _iso_ms(DAY_START + a), "stop": _iso_ms(DAY_START + b),
                        "duration_s": (b - a).total_seconds(), "max_el_deg": 45.0}
                       for a, b in SYNTHETIC_ACCESS] for prn in PRNS}
    count = len(PRNS) * len(SYNTHETIC_ACCESS)
    stats = {"count": count, "total_duration_s": count * 14400.0, "min_duration_s": 14400.0,
             "max_duration_s": 14400.0, "mean_duration_s": 14400.0}
    (access_dir / "intervals.json").write_text(
        json.dumps({"facility": "THBK", "min_el_deg": 10.0, "intervals": intervals, "global_statistics": stats}),
        encoding="utf-8")
    with open(access_dir / "dop.csv", "w", encoding="utf-8", newline="") as f:
        f.write(",".join(studio.DOP_HEADER) + "\n")
        for stamp in stamps:
            f.write("".join(f"{stamp},{system},12,1.500,1.200,0.800,0.900,0.500,0.600,0.700\n"
                            for system in ("ALL", "G", "R", "E", "C")))
    return scenario_dir, data_dir


class TestOneDayUnder2s(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._tmp = tempfile.TemporaryDirectory()
        cls.scenario_dir, cls.data_dir = write_synthetic_bundle(Path(cls._tmp.name))

    @classmethod
    def tearDownClass(cls):
        cls._tmp.cleanup()

    RUNS = 3

    def cold_run(self, style_name: str) -> tuple[float, Report, str]:
        """เวลาที่เร็วที่สุดจาก RUNS รอบ แต่ละรอบ: TableCache ใหม่ว่าง → open_result_set (รวม hash ของแผน)
        → build_report → format_txt (เครื่องที่ถูกรบกวนช้าได้เป็นรอบ ๆ จึงวัดรอบที่เร็วที่สุด เกณฑ์ยัง 2.0 s)"""
        style = resolve_style(style_name, "report", [], [])
        best, report, text = math.inf, None, ""
        for _ in range(self.RUNS):
            begin = time.perf_counter()
            rs = open_result_set(self.scenario_dir, self.data_dir, TableCache())
            report = build_report(rs, style, [G01], None, None, None, NOW)
            text = format_txt(report, "UTCG", "+07:00")
            best = min(best, time.perf_counter() - begin)
        return best, report, text

    def test_access_report_one_day_under_2s(self):
        elapsed, report, text = self.cold_run("Access")
        self.assertLess(elapsed, 2.0)
        rows = report.sections[0].rows
        self.assertEqual([r[0] for r in rows], [1, 2])
        self.assertEqual([r[3] for r in rows], [14400.0, 14400.0])
        self.assertIn("THBK-To-G01:  Access", text)

    def test_aer_report_one_day_under_2s(self):
        elapsed, report, text = self.cold_run("AER")
        self.assertLess(elapsed, 2.0)
        rows = report.sections[0].rows
        self.assertEqual(len(rows), 2 * (4 * 3600 // 30 + 1))                  # สองช่วง ปลายปิดทั้งสองข้าง
        self.assertTrue(all(r[2] == 45.0 for r in rows))
        self.assertEqual(len(text.split("\n")), len(rows) + 7)


if __name__ == "__main__":
    unittest.main()
