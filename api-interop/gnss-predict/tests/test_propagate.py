import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

from gnss_predict.catalog import CatalogSatellite
from gnss_predict.errors import GmatRunError, ReportError, Sp3FormatError
from gnss_predict.propagate import (Ephemeris, ephemeris_from_sp3, parse_ecef_report, propagate,
                                    render_ecef_script, write_tle_file)
from gnss_predict.sp3 import write_sp3

START = datetime(2026, 11, 10, tzinfo=timezone.utc)
TLE_G = ("1 26407U 00040A   26313.12355163  .00000023  00000+0  00000+0 0  9997",
         "2 26407  54.8262 209.4116 0115222 305.0160 227.7848  2.00558950192856")
TLE_C = ("1 37210U 10057A   26313.50000000  .00000010  00000+0  00000+0 0  9990",
         "2 37210   1.5000  80.0000 0002000  10.0000 350.0000  1.00270000 12345")


def make_sat(prn: str, norad: int, tle_lines: tuple[str, str]) -> CatalogSatellite:
    return CatalogSatellite(prn=prn, system=prn[0], svn="X000", norad=norad, block="BLK",
                            celestrak_name=f"SAT {prn}", omm_epoch=START, age_days=0.5,
                            flags=frozenset(), tle_lines=tle_lines)


G01 = make_sat("G01", 26407, TLE_G)
C01 = make_sat("C01", 37210, TLE_C)


class TempDirCase(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dir = Path(tmp.name)


class TestRenderScript(unittest.TestCase):
    def test_script_names_ids_and_one_statement_per_line(self):
        s = render_ecef_script([G01, C01], Path("/x/all.tle"), START, START + timedelta(days=1), 30,
                               Path("/x/r.txt"))
        for frag in ("Create Spacecraft G01;", "G01.Id = 'G01';", "C01.EphemerisName = '/x/all.tle';",
                     "TLEProp.Type = SPICESGP4;", "TLEProp.InitialStepSize = 30;", "C01.EarthFixed.Z",
                     "{G01.ElapsedSecs = 86400}"):
            self.assertIn(frag, s)
        self.assertTrue(all(l.count(";") <= 1 for l in s.splitlines()))

    def test_exact_statements(self):
        s = render_ecef_script([G01, C01], Path("/x/all.tle"), START, START + timedelta(hours=1), 60,
                               Path("/x/r.txt"))
        lines = s.splitlines()
        self.assertEqual(lines[lines.index("Create Spacecraft G01;"):][:5], [
            "Create Spacecraft G01;",
            "G01.DateFormat = UTCGregorian;",
            "G01.Epoch = '10 Nov 2026 00:00:00.000';",
            "G01.Id = 'G01';",
            "G01.EphemerisName = '/x/all.tle';"])
        self.assertIn("C01.Id = 'C01';", lines)
        self.assertIn("C01.Epoch = '10 Nov 2026 00:00:00.000';", lines)
        for stmt in ("Create Propagator TLEProp;", "TLEProp.InitialStepSize = 60;", "Create ReportFile RF;",
                     "RF.Filename = '/x/r.txt';", "RF.Precision = 16;", "RF.WriteHeaders = true;",
                     "RF.FixedWidth = false;", "RF.Delimiter = ',';", "BeginMissionSequence;"):
            self.assertIn(stmt, lines)
        self.assertIn("RF.Add = {G01.UTCGregorian, G01.EarthFixed.X, G01.EarthFixed.Y, G01.EarthFixed.Z, "
                      "C01.EarthFixed.X, C01.EarthFixed.Y, C01.EarthFixed.Z};", lines)
        self.assertEqual(lines[-1], "Propagate TLEProp(G01, C01) {G01.ElapsedSecs = 3600};")
        self.assertLess(lines.index("BeginMissionSequence;"), len(lines) - 1)
        self.assertLess(lines.index("Create ReportFile RF;"), lines.index("BeginMissionSequence;"))

    def test_epoch_uses_start_time(self):
        start = datetime(2026, 12, 31, 23, 59, 30, tzinfo=timezone.utc)
        s = render_ecef_script([G01], Path("/x/all.tle"), start, start + timedelta(seconds=60), 30, Path("/x/r.txt"))
        self.assertIn("G01.Epoch = '31 Dec 2026 23:59:30.000';", s.splitlines())
        self.assertIn("{G01.ElapsedSecs = 60}", s)

    def test_no_satellites_is_rejected(self):
        with self.assertRaises(ValueError):
            render_ecef_script([], Path("/x/all.tle"), START, START + timedelta(hours=1), 30, Path("/x/r.txt"))

    def test_grid_must_be_whole_seconds_and_divisible(self):
        for stop, step in ((START + timedelta(seconds=50), 30), (START, 30), (START - timedelta(hours=1), 30),
                           (START + timedelta(hours=1), 0), (START + timedelta(seconds=30.5), 30)):
            with self.subTest(stop=stop, step=step):
                with self.assertRaises(ValueError):
                    render_ecef_script([G01], Path("/x/all.tle"), START, stop, step, Path("/x/r.txt"))


class TestTleFile(TempDirCase):
    def test_tle_file_name_lines_are_prns(self):
        p = self.dir / "all.tle"
        write_tle_file([G01, C01], p)
        self.assertEqual(p.read_text().splitlines(), ["G01", *G01.tle_lines, "C01", *C01.tle_lines])
        self.assertTrue(p.read_text().endswith("\n"))


def report_text(header: list[str], rows: list[list[str]]) -> str:
    return "\n".join(",".join(r) for r in [header, *rows]) + "\n"


HEADER_G01 = ["G01.UTCGregorian", "G01.EarthFixed.X", "G01.EarthFixed.Y", "G01.EarthFixed.Z"]
ROW0 = ["10 Nov 2026 00:00:00.000", "1.5", "-2.5", "3.5"]
ROW1 = ["10 Nov 2026 00:00:30.000", "1.75", "-2.25", "3.75"]


class TestParseReport(TempDirCase):
    def write(self, text: str) -> Path:
        p = self.dir / "r.txt"
        p.write_text(text)
        return p

    def parse(self, text: str, prns=("G01",), seconds=30, step=30):
        return parse_ecef_report(self.write(text), list(prns), START, START + timedelta(seconds=seconds), step)

    def test_parse_report_rounds_time_and_drops_bad_columns(self):
        # G01 ครบ 3 แกน, C01 ไม่มีคอลัมน์ Z; แถวที่สองเวลา 00:00:29.999
        header = HEADER_G01 + ["C01.EarthFixed.X", "C01.EarthFixed.Y"]
        rows = [ROW0 + ["10", "20"], ["10 Nov 2026 00:00:29.999", "1.75", "-2.25", "3.75", "11", "21"]]
        p = self.write(report_text(header, rows))
        eph, msgs = parse_ecef_report(p, ["G01", "C01"], START, START + timedelta(seconds=30), 30)
        self.assertEqual(eph.times_utc, [START, START + timedelta(seconds=30)])
        self.assertEqual(list(eph.positions_km), ["G01"])
        self.assertEqual(eph.positions_km["G01"], [(1.5, -2.5, 3.5), (1.75, -2.25, 3.75)])
        self.assertEqual([m.code for m in msgs], ["SAT_MISSING_FROM_GMAT"])
        self.assertEqual((msgs[0].level, msgs[0].object), ("warning", "C01"))
        self.assertTrue(any("฀" <= ch <= "๿" for ch in msgs[0].text))
        self.assertTrue(all(t.tzinfo == timezone.utc for t in eph.times_utc))

    def test_all_sats_present_no_messages(self):
        header = HEADER_G01 + ["C01.EarthFixed.X", "C01.EarthFixed.Y", "C01.EarthFixed.Z"]
        rows = [ROW0 + ["10", "20", "30"], ROW1 + ["11", "21", "31"]]
        eph, msgs = self.parse(report_text(header, rows), prns=["G01", "C01"])
        self.assertEqual(msgs, [])
        self.assertEqual(list(eph.positions_km), ["G01", "C01"])
        self.assertEqual(eph.positions_km["C01"], [(10.0, 20.0, 30.0), (11.0, 21.0, 31.0)])

    def test_non_numeric_value_drops_that_satellite_only(self):
        header = HEADER_G01 + ["C01.EarthFixed.X", "C01.EarthFixed.Y", "C01.EarthFixed.Z"]
        for bad in ("abc", "nan", "inf", ""):
            with self.subTest(bad=bad):
                rows = [ROW0 + ["10", "20", "30"], ROW1 + ["11", bad, "31"]]
                eph, msgs = self.parse(report_text(header, rows), prns=["G01", "C01"])
                self.assertEqual(list(eph.positions_km), ["G01"])
                self.assertEqual([(m.code, m.object) for m in msgs], [("SAT_MISSING_FROM_GMAT", "C01")])

    def test_duplicate_last_row_is_ignored(self):
        eph, msgs = self.parse(report_text(HEADER_G01, [ROW0, ROW1, ROW1]))
        self.assertEqual(len(eph.times_utc), 2)
        self.assertEqual(eph.positions_km["G01"], [(1.5, -2.5, 3.5), (1.75, -2.25, 3.75)])
        self.assertEqual(msgs, [])

    def test_parse_report_grid_mismatch_raises(self):
        # ขาดแถวกลาง
        with self.assertRaises(ReportError) as cm:
            self.parse(report_text(HEADER_G01, [ROW0, ["10 Nov 2026 00:01:00.000", "1", "2", "3"]]), seconds=60)
        self.assertIn("2026-11-10T00:00:30", str(cm.exception))
        # ขาดแถวสุดท้าย
        with self.assertRaises(ReportError):
            self.parse(report_text(HEADER_G01, [ROW0]))
        # เกินจาก grid
        with self.assertRaises(ReportError):
            self.parse(report_text(HEADER_G01, [ROW0, ROW1, ["10 Nov 2026 00:01:00.000", "1", "2", "3"]]))
        # เวลาไม่ตรง grid
        with self.assertRaises(ReportError):
            self.parse(report_text(HEADER_G01, [ROW0, ["10 Nov 2026 00:00:31.000", "1", "2", "3"]]))
        # เรียงไม่ตามเวลา
        with self.assertRaises(ReportError):
            self.parse(report_text(HEADER_G01, [ROW1, ROW0]))

    def test_unreadable_report_raises(self):
        with self.assertRaises(ReportError):
            parse_ecef_report(self.dir / "missing.txt", ["G01"], START, START + timedelta(seconds=30), 30)
        with self.assertRaises(ReportError):
            self.parse("")
        with self.assertRaises(ReportError):                     # ไม่มีคอลัมน์เวลา
            self.parse(report_text(HEADER_G01[1:], [ROW0[1:], ROW1[1:]]))
        with self.assertRaises(ReportError):                     # เวลาอ่านไม่ได้
            self.parse(report_text(HEADER_G01, [ROW0, ["not a time", "1", "2", "3"]]))
        with self.assertRaises(ReportError):                     # ช่องเวลาว่าง
            self.parse(report_text(HEADER_G01, [ROW0, ["", "1", "2", "3"]]))

    def test_grid_arguments_are_validated(self):
        p = self.write(report_text(HEADER_G01, [ROW0, ROW1]))
        with self.assertRaises(ValueError):
            parse_ecef_report(p, ["G01"], START, START + timedelta(seconds=50), 30)

    def test_empty_prns_gives_empty_ephemeris_with_grid(self):
        eph, msgs = self.parse(report_text(HEADER_G01, [ROW0, ROW1]), prns=[])
        self.assertEqual((eph.positions_km, msgs), ({}, []))
        self.assertEqual(len(eph.times_utc), 2)


class TestEphemerisFromSp3(TempDirCase):
    def test_ephemeris_from_sp3_shifts_back_to_utc(self):
        times = [START + timedelta(seconds=30 * k) for k in range(4)]
        pos = {"G01": [(14825.366872 + k, -13665.223306, 17225.758431) for k in range(4)],
               "C01": [(-30000.5, 20000.25 + k, 100.125) for k in range(4)]}
        p = self.dir / "predicted.sp3"
        write_sp3(times, pos, p)
        eph = ephemeris_from_sp3(p)
        self.assertEqual(eph.times_utc, times)
        self.assertTrue(all(t.tzinfo == timezone.utc for t in eph.times_utc))
        self.assertEqual(sorted(eph.positions_km), ["C01", "G01"])
        for prn in pos:
            for got, want in zip(eph.positions_km[prn], pos[prn]):
                for a, b in zip(got, want):
                    self.assertAlmostEqual(a, b, places=6)

    def test_satellite_with_missing_epoch_raises(self):
        times = [START + timedelta(seconds=30 * k) for k in range(3)]
        pos = {"G01": [(1.0, 2.0, 3.0)] * 3, "C01": [(4.0, 5.0, 6.0)] * 3}
        p = self.dir / "predicted.sp3"
        write_sp3(times, pos, p)
        lines = p.read_text().splitlines(keepends=True)
        i = max(k for k, l in enumerate(lines) if l.startswith("PC01"))
        del lines[i]
        p.write_text("".join(lines))
        with self.assertRaises(Sp3FormatError):
            ephemeris_from_sp3(p)

    def test_file_without_positions_raises(self):
        p = self.dir / "predicted.sp3"
        p.write_text("EOF\n")
        with self.assertRaises(Sp3FormatError):
            ephemeris_from_sp3(p)


class TestPropagate(TempDirCase):
    def fake_run(self, rows_for):
        """แทน run_script: อ่านชื่อรายงานจาก script แล้วเขียนรายงานปลอม"""
        def run(console, script, log, timeout_s):
            self.calls.append((console, script, log, timeout_s))
            text = Path(script).read_text()
            report = next(l.split("'")[1] for l in text.splitlines() if l.startswith("RF.Filename"))
            Path(report).write_text(rows_for())
        return run

    def setUp(self):
        super().setUp()
        self.calls = []

    def test_propagate_writes_inputs_runs_gmat_and_parses(self):
        header = HEADER_G01 + ["C01.EarthFixed.X", "C01.EarthFixed.Y", "C01.EarthFixed.Z"]
        text = report_text(header, [ROW0 + ["10", "20", "30"], ROW1 + ["11", "21", "31"]])
        work = self.dir / "w"                                  # ยังไม่มีโฟลเดอร์
        console = Path("/opt/gmat/GmatConsole")
        with mock.patch("gnss_predict.propagate.run_script", side_effect=self.fake_run(lambda: text)):
            eph, msgs = propagate([G01, C01], START, START + timedelta(seconds=30), 30, work, console)
        self.assertEqual(msgs, [])
        self.assertEqual(eph.times_utc, [START, START + timedelta(seconds=30)])
        self.assertEqual(eph.positions_km["C01"], [(10.0, 20.0, 30.0), (11.0, 21.0, 31.0)])
        self.assertEqual(len(self.calls), 1)
        c_console, c_script, c_log, c_timeout = self.calls[0]
        work = work.resolve()
        self.assertEqual((c_console, c_script, c_log, c_timeout),
                         (console, work / "ecef.script", work / "gmat.log", 900))
        self.assertEqual((work / "all.tle").read_text().splitlines(), ["G01", *G01.tle_lines, "C01", *C01.tle_lines])
        script = (work / "ecef.script").read_text()
        self.assertIn(f"C01.EphemerisName = '{work / 'all.tle'}';", script)
        self.assertIn("Propagate TLEProp(G01, C01) {G01.ElapsedSecs = 30};", script)

    def test_timeout_is_passed_through(self):
        text = report_text(HEADER_G01, [ROW0, ROW1])
        with mock.patch("gnss_predict.propagate.run_script", side_effect=self.fake_run(lambda: text)):
            propagate([G01], START, START + timedelta(seconds=30), 30, self.dir, Path("/c"), timeout_s=12.5)
        self.assertEqual(self.calls[0][3], 12.5)

    def test_on_gmat_start_is_passed_to_run_script(self):
        text = report_text(HEADER_G01, [ROW0, ROW1])
        hook = mock.Mock()
        with mock.patch("gnss_predict.propagate.run_script") as run:
            run.side_effect = lambda console, script, log, timeout_s, on_start: self.fake_run(lambda: text)(
                console, script, log, timeout_s)
            propagate([G01], START, START + timedelta(seconds=30), 30, self.dir, Path("/c"), on_gmat_start=hook)
        self.assertIs(run.call_args.kwargs["on_start"], hook)

    def test_gmat_failure_propagates(self):
        with mock.patch("gnss_predict.propagate.run_script", side_effect=GmatRunError("boom")):
            with self.assertRaises(GmatRunError):
                propagate([G01], START, START + timedelta(seconds=30), 30, self.dir, Path("/c"))

    def test_stale_report_from_earlier_run_is_not_read(self):
        stale = self.dir / "w"
        stale.mkdir()
        # ถ้า GMAT ไม่เขียนรายงานใหม่ ต้องไม่อ่านรายงานเก่า
        text = report_text(HEADER_G01, [ROW0, ROW1])
        with mock.patch("gnss_predict.propagate.run_script", side_effect=self.fake_run(lambda: text)):
            propagate([G01], START, START + timedelta(seconds=30), 30, stale, Path("/c"))
        with mock.patch("gnss_predict.propagate.run_script"):          # GMAT "สำเร็จ" แต่ไม่เขียนรายงาน
            with self.assertRaises(ReportError):
                propagate([G01], START, START + timedelta(seconds=30), 30, stale, Path("/c"))

    def test_bad_grid_fails_before_running_gmat(self):
        with mock.patch("gnss_predict.propagate.run_script") as run:
            with self.assertRaises(ValueError):
                propagate([G01], START, START + timedelta(seconds=50), 30, self.dir, Path("/c"))
        run.assert_not_called()
        self.assertFalse((self.dir / "all.tle").exists())


if __name__ == "__main__":
    unittest.main()

class TestBulkPropagation(TempDirCase):
    def test_batches_merge_by_time_and_keep_cancellation_hook(self):
        from gnss_predict.propagate import GMAT_BATCH_SIZE
        from gnss_predict.custom_satellites import CODES
        sats=[make_sat(code,20000+i,TLE_G) for i,code in enumerate(CODES[:906])]
        stop=START+timedelta(minutes=1)
        seen=[]
        hook=mock.Mock()
        def parse(path,prns,start,end,step):
            seen.append((path,prns))
            return Ephemeris([START,stop],{p:[(7000.,1.,2.),(7001.,2.,3.)] for p in prns}),[]
        with mock.patch('gnss_predict.propagate.run_script') as run, mock.patch('gnss_predict.propagate.parse_ecef_report',side_effect=parse):
            result,messages=propagate(sats,START,stop,60,self.dir,Path('/GMAT'),on_gmat_start=hook)
        self.assertEqual(len(result.positions_km),906)
        self.assertEqual(run.call_count,(906+GMAT_BATCH_SIZE-1)//GMAT_BATCH_SIZE)
        self.assertTrue(all(len(prns)<=GMAT_BATCH_SIZE for _,prns in seen))
        self.assertTrue(all(call.kwargs['on_start'] is hook for call in run.call_args_list))
        self.assertEqual(len({path.parent for path,_ in seen}),run.call_count)
        self.assertEqual(messages,[])

    def test_real_gmat_crosses_import_identifier_boundary(self):
        import os
        from gnss_predict.run_gmat import find_gmat_console
        from gnss_predict.errors import GmatNotFoundError
        from gnss_predict.custom_satellites import CODES
        try:console=find_gmat_console()
        except GmatNotFoundError:self.skipTest('GMAT not built')
        sats=[make_sat(code,26407,TLE_G) for code in CODES[:105]]
        eph,messages=propagate(sats,START,START+timedelta(minutes=2),60,self.dir,console)
        self.assertEqual(len(eph.positions_km),105)
        self.assertEqual(eph.positions_km['U99'],eph.positions_km['V01'])
        self.assertEqual(eph.positions_km['U01'],eph.positions_km['V06'])
        self.assertEqual(messages,[])
