import csv
import shutil
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from gnss_predict.errors import ReportError
from gnss_predict.report import check_epochs, read_report

FX = Path(__file__).parent / "fixtures"
START = datetime(2026, 11, 10, tzinfo=timezone.utc)


class ReportCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.work = Path(self._tmp.name)
        shutil.copy(FX / "report_2sat.txt", self.work / "report.txt")

    def tearDown(self):
        self._tmp.cleanup()

    def edit(self, fn) -> None:
        p = self.work / "report.txt"
        p.write_text("".join(fn(p.read_text().splitlines(keepends=True))))


class TestReadReport(ReportCase):
    def test_reads_all(self):
        s = read_report(self.work, [16, 22])
        self.assertEqual(len(s), 242)
        self.assertEqual(s[0].t, START)
        with open(FX / "report_2sat.txt", newline="") as f:
            rows = list(csv.reader(f))
        first = {h.strip(): v.strip() for h, v in zip(rows[0], rows[1])}
        g16 = next(x for x in s if x.prn == 16 and x.t == START)
        self.assertEqual((g16.s_km, g16.e_km, g16.z_km),
                         tuple(float(first[f"G16.THBKTopo.{c}"]) for c in "XYZ"))

    def test_duplicate_last_row_dropped(self):
        self.edit(lambda L: L + [L[-1] if L[-1].endswith("\n") else "\n" + L[-1]])
        self.assertEqual(len(read_report(self.work, [16, 22])), 242)

    def test_time_rounding(self):
        self.edit(lambda L: [l.replace("10 Nov 2026 00:00:30.000", "10 Nov 2026 00:00:29.999") for l in L])
        s = read_report(self.work, [16, 22])
        self.assertIn(START + timedelta(seconds=30), {x.t for x in s})
        self.assertTrue(all(x.t.microsecond == 0 for x in s))
        check_epochs(s, START, 1, 30)

    def test_missing_prn_column(self):
        with self.assertRaises(ReportError):
            read_report(self.work, [16, 22, 5])

    def test_missing_file(self):
        with self.assertRaises(ReportError):
            read_report(self.work / "nope", [16])


class TestCheckEpochs(ReportCase):
    def test_complete(self):
        check_epochs(read_report(self.work, [16, 22]), START, 1, 30)

    def test_gap(self):
        self.edit(lambda L: [l for l in L if "10 Nov 2026 00:10:00.000" not in l])
        with self.assertRaises(ReportError) as cm:
            check_epochs(read_report(self.work, [16, 22]), START, 1, 30)
        self.assertIn("00:10:00", str(cm.exception))

    def test_wrong_start(self):
        with self.assertRaises(ReportError):
            check_epochs(read_report(self.work, [16, 22]), START + timedelta(seconds=30), 1, 30)


if __name__ == "__main__":
    unittest.main()
