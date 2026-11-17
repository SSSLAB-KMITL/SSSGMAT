import json
import math
import os
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

from gnss_predict import config, studio
from gnss_predict.__main__ import main
from gnss_predict.errors import TleUnavailableError
from gnss_predict.predict import build_meta, output_name, parse_start, rows_from_samples, write_outputs
from gnss_predict.report import SezSample
from gnss_predict.tle_fetch import parse_tle_file

UTC = timezone.utc
NOW = datetime(2026, 11, 10, 15, 20, tzinfo=UTC)
FX = Path(__file__).parent / "fixtures"

class TestParseStart(unittest.TestCase):
    def test_cases(self):
        self.assertEqual(parse_start(None, NOW), datetime(2026, 11, 11, tzinfo=UTC))
        self.assertEqual(parse_start("2026-11-11", NOW), datetime(2026, 11, 11, tzinfo=UTC))
        self.assertEqual(parse_start("2026-11-11T06:30Z", NOW), datetime(2026, 11, 11, 6, 30, tzinfo=UTC))
        self.assertEqual(parse_start("2026-11-11T13:30+07:00", NOW), datetime(2026, 11, 11, 6, 30, tzinfo=UTC))
        self.assertEqual(parse_start("2026-11-11T06:30", NOW), datetime(2026, 11, 11, 6, 30, tzinfo=UTC))
        with self.assertRaises(ValueError):
            parse_start("tomorrow", NOW)

class TestNames(unittest.TestCase):
    def test_output_name(self):
        self.assertEqual(output_name(datetime(2026, 11, 11, tzinfo=UTC), 24), "thbk_gnss_pred_20261111T0000Z_24h.csv")
        self.assertEqual(output_name(datetime(2026, 11, 11, 6, 30, tzinfo=UTC), 1.5), "thbk_gnss_pred_20261111T0630Z_1.5h.csv")

class TestRows(unittest.TestCase):
    def test_rows_cross_midnight(self):
        s = [SezSample(datetime(2026, 11, 11, 0, 0, tzinfo=UTC), 5, 0.0, 0.0, 20200.0),
             SezSample(datetime(2026, 11, 10, 23, 59, 30, tzinfo=UTC), 5, 0.0, 0.0, 20200.0)]
        rows = rows_from_samples(s, 0.0, 400.0)
        self.assertEqual([r[:3] for r in rows], [["2026-11-10", "23:59:30", "G05"], ["2026-11-11", "00:00:00", "G05"]])

    def test_format_and_filter(self):
        t = datetime(2026, 11, 10, tzinfo=UTC)
        s = [SezSample(t, 22, 0.0, 0.0, 20200.0),          # El 90
             SezSample(t, 16, -20000.0, 0.0, 0.0),         # El 0 พอดี
             SezSample(t, 19, 0.0, 20000.0, -100.0)]       # El < 0
        rows = rows_from_samples(s, 0.0, 400.0)
        self.assertEqual([r[2] for r in rows], ["G16", "G22"])       # เรียงตาม PRN, El = min_el ยังอยู่
        self.assertRegex(rows[1][3], r"^\d{1,3}\.\d{3}$")             # Az ที่จุดเหนือศีรษะไม่มีนิยาม ตรวจแค่รูปแบบ
        self.assertEqual(rows[1][4:], ["90.000", "13.7298", "100.7812", "1.00000"])
        self.assertEqual(len(rows_from_samples(s, -90.0, 400.0)), 3)

    def test_az_just_below_360_prints_as_zero(self):
        # Az = 359.9997° ปัดทศนิยม 3 ตำแหน่งแล้วต้องได้ "0.000" ไม่ใช่ "360.000" (ช่วงที่ README บอกคือ [0, 360))
        e = -20000.0 * math.tan(math.radians(0.0003))
        rows = rows_from_samples([SezSample(datetime(2026, 11, 10, tzinfo=UTC), 7, -20000.0, e, 10000.0)], 0.0, 400.0)
        self.assertEqual(rows[0][3], "0.000")

class TestOutputs(unittest.TestCase):
    def test_meta_counts_invisible_prns_as_included(self):
        entries, _ = parse_tle_file(FX / "gps_sample.tle")
        m = build_meta(datetime(2026, 11, 10, tzinfo=UTC), 24, 30, 0.0, 400.0, FX / "gps_sample.tle",
                       entries, ["w"], "GMAT R2026a", NOW)
        self.assertEqual(m["prns_included"], [16, 19, 22])
        self.assertEqual(len(m["prns_missing"]), 29)
        self.assertNotIn(16, m["prns_missing"])
        self.assertEqual(m["start_utc"], "2026-11-10T00:00:00Z")
        self.assertEqual(len(m["tle_sha256"]), 64)

    def test_write_outputs(self):
        rows = [["2026-11-10", "00:00:00", "G16", "1.000", "2.000", "3.0000", "4.0000", "0.50000"],
                ["2026-11-10", "00:00:30", "G16", "1.000", "2.000", "3.0000", "4.0000", "0.50000"]]
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "out"                      # ยังไม่มี ต้องถูกสร้าง
            p = write_outputs(rows, {"k": "ค่า"}, out, "x.csv")
            self.assertEqual(p, out / "x.csv")
            raw = p.read_bytes()
            self.assertFalse(raw.startswith(b"\xef\xbb\xbf"))
            self.assertNotIn(b"\r", raw)
            lines = raw.decode("utf-8").splitlines()
            self.assertEqual(lines[0], "DAY,Time,PRN,Az,El,IPP_Lat,IPP_Lon,MF")
            self.assertEqual(len(lines), 3)
            self.assertEqual(json.loads((out / "x.meta.json").read_text(encoding="utf-8")), {"k": "ค่า"})
            write_outputs(rows[:1], {"k": 2}, out, "x.csv")   # เขียนทับ
            self.assertEqual(len(p.read_text().splitlines()), 2)
            self.assertEqual(list(out.glob("*.tmp")), [])

class TestMainWithoutGmat(unittest.TestCase):
    def test_old_tle_exits_1(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(main(["--start", "2026-12-20", "--tle-file", str(FX / "gps_2sat.tle"), "--out-dir", d], now=NOW), 1)

    def test_missing_gmat_exits_1(self):
        with tempfile.TemporaryDirectory() as d, mock.patch.dict(os.environ, {"GMAT_BIN": "/nonexistent/GmatConsole"}):
            self.assertEqual(main(["--start", "2026-11-10", "--tle-file", str(FX / "gps_2sat.tle"), "--out-dir", d], now=NOW), 1)

    def test_download_uses_studio_omm_cache(self):
        # CLI เดิมเก็บ OMM และ celestrak_state.json ที่เดียวกับ studio เพื่อนับกติกา 2 ชม. ร่วมกัน
        self.assertEqual(config.OMM_CACHE_DIR, config.DATA_DIR / studio.ORBITS_DIR / studio.CACHE_DIR)
        with tempfile.TemporaryDirectory() as d, \
                mock.patch("gnss_predict.__main__.fetch_gps_tle", side_effect=TleUnavailableError("ไม่มีเน็ต")) as fetch:
            self.assertEqual(main(["--start", "2026-11-11", "--cache-dir", d, "--out-dir", d], now=NOW), 1)
        fetch.assert_called_once_with(Path(d).resolve(), now=NOW, omm_cache_dir=config.OMM_CACHE_DIR)

    def test_bad_start_exits_2(self):
        with self.assertRaises(SystemExit) as cm:
            main(["--start", "tomorrow"], now=NOW)
        self.assertEqual(cm.exception.code, 2)


if __name__ == "__main__":
    unittest.main()
