import unittest
from datetime import datetime, timezone
from pathlib import Path

from gnss_predict.gmat_time import format_gmat_epoch, parse_gmat_epoch
from gnss_predict.script_gen import render_script
from gnss_predict.tle_fetch import parse_tle_file

UTC = timezone.utc
FX = Path(__file__).parent / "fixtures"

class TestGmatTime(unittest.TestCase):
    def test_format(self):
        self.assertEqual(format_gmat_epoch(datetime(2026, 11, 10, tzinfo=UTC)), "10 Nov 2026 00:00:00.000")
        self.assertEqual(format_gmat_epoch(datetime(2026, 1, 5, 7, 8, 9, 400, UTC)), "05 Jan 2026 07:08:09.000")

    def test_parse(self):
        self.assertEqual(parse_gmat_epoch("10 Nov 2026 00:00:29.999"),
                         datetime(2026, 11, 10, 0, 0, 29, 999000, UTC))

    def test_round_trip_all_months(self):
        for m in range(1, 13):
            t = datetime(2026, m, 28, 23, 59, 30, tzinfo=UTC)
            self.assertEqual(parse_gmat_epoch(format_gmat_epoch(t)), t)

class TestRender(unittest.TestCase):
    def setUp(self):
        self.entries, _ = parse_tle_file(FX / "gps_2sat.tle")

    def test_golden(self):
        got = render_script(self.entries, Path("/fixtures/gps_2sat.tle"),
                            datetime(2026, 11, 10, tzinfo=UTC), 1, 30, Path("/work"))
        self.assertEqual(got, (FX / "expected_2sat.script").read_text())

    def test_24h(self):
        got = render_script(self.entries, Path("/f.tle"), datetime(2026, 11, 10, tzinfo=UTC), 24, 30, Path("/w"))
        self.assertIn("ElapsedSecs = 86400", got)
        self.assertIn("InitialStepSize = 30", got)

    def test_path_with_space(self):
        got = render_script(self.entries, Path("/tmp/my dir/gps.tle"), datetime(2026, 11, 10, tzinfo=UTC), 1, 30, Path("/w"))
        self.assertIn("G16.EphemerisName = '/tmp/my dir/gps.tle';", got)

    def test_empty_entries(self):
        with self.assertRaises(ValueError):
            render_script([], Path("/f.tle"), datetime(2026, 11, 10, tzinfo=UTC), 1, 30, Path("/w"))


if __name__ == "__main__":
    unittest.main()
