import shutil
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from datetime import datetime, timezone
from pathlib import Path

from gnss_predict.errors import TleTooOldError, TleUnavailableError
from gnss_predict.tle_fetch import check_tle_age, fetch_gps_tle, parse_tle_file, parse_tle_text, tle_checksum

FX = Path(__file__).parent / "fixtures"
UTC = timezone.utc


class TestParse(unittest.TestCase):
    def test_sample(self):
        entries, warns = parse_tle_file(FX / "gps_sample.tle")
        self.assertEqual([e.prn for e in entries], [16, 19, 22])
        self.assertEqual([e.norad for e in entries], ["27663", "28190", "26407"])
        self.assertEqual(entries[2].name, "GPS BIIR-5  (PRN 22)")
        exp = {16: datetime(2026, 11, 8, 10, 52, 38, 727264, UTC),
               19: datetime(2026, 11, 9, 1, 1, 14, 796768, UTC),
               22: datetime(2026, 11, 9, 2, 57, 54, 860832, UTC)}
        for e in entries:
            self.assertLess(abs((e.epoch - exp[e.prn]).total_seconds()), 1e-3)
        self.assertEqual(len(warns), 2)
        self.assertTrue(any("28474" in w for w in warns))   # checksum ผิด
        self.assertTrue(any("28874" in w for w in warns))   # ไม่มี PRN

    def test_lf_and_crlf_parse_identically(self):
        crlf = (FX / "gps_sample.tle").read_bytes().decode()
        self.assertEqual(parse_tle_text(crlf), parse_tle_text(crlf.replace("\r\n", "\n")))

    def test_duplicate_prn_keeps_newer_epoch(self):
        name, l1, l2 = [l for l in (FX / "gps_2sat.tle").read_text().splitlines()][:3]   # PRN 22
        l1b = l1[:18] + "26314.00000000" + l1[32:68]
        l1b += str(tle_checksum(l1b))
        entries, _ = parse_tle_text("\n".join([name, l1, l2, name, l1b, l2]) + "\n")
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0].epoch, datetime(2026, 11, 10, tzinfo=UTC))


class TestAge(unittest.TestCase):
    def setUp(self):
        self.entries, _ = parse_tle_file(FX / "gps_sample.tle")   # epoch เก่าสุด 2026-11-08 10:52

    def test_fresh(self):
        self.assertEqual(check_tle_age(self.entries, datetime(2026, 11, 10, tzinfo=UTC), 24), [])

    def test_warn_after_7_days(self):
        self.assertEqual(len(check_tle_age(self.entries, datetime(2026, 11, 16, tzinfo=UTC), 24)), 1)

    def test_epoch_after_start_uses_absolute_age(self):
        self.assertEqual(len(check_tle_age(self.entries, datetime(2026, 11, 1, tzinfo=UTC), 24)), 1)

    def test_too_old(self):
        with self.assertRaises(TleTooOldError):
            check_tle_age(self.entries, datetime(2026, 12, 10, tzinfo=UTC), 24)


class TestFetch(unittest.TestCase):
    NOW = datetime(2026, 11, 10, 12, 0, tzinfo=UTC)

    def test_success_writes_timestamped_cache(self):
        with tempfile.TemporaryDirectory() as d:
            path, warns = fetch_gps_tle(Path(d), url=(FX / "gps_sample.tle").as_uri(), now=self.NOW)
            self.assertEqual(path.name, "gps_20261110T1200Z.tle")
            self.assertEqual(warns, [])
            self.assertEqual(len(parse_tle_file(path)[0]), 3)

    def test_failure_falls_back_to_newest_cache(self):
        with tempfile.TemporaryDirectory() as d:
            for n in ("gps_20261101T0000Z.tle", "gps_20261105T0000Z.tle"):
                shutil.copy(FX / "gps_sample.tle", Path(d) / n)
            path, warns = fetch_gps_tle(Path(d), url=(Path(d) / "missing.tle").as_uri(), now=self.NOW)
            self.assertEqual(path.name, "gps_20261105T0000Z.tle")
            self.assertEqual(len(warns), 1)

    def test_failure_without_cache_raises(self):
        with tempfile.TemporaryDirectory() as d, self.assertRaises(TleUnavailableError):
            fetch_gps_tle(Path(d), url=(Path(d) / "missing.tle").as_uri(), now=self.NOW)

    def test_fetch_truncated_body_falls_back(self):
        # เซิร์ฟเวอร์ประกาศ Content-Length 5000 แต่ส่งมาแค่บางส่วนแล้วตัดการเชื่อมต่อ → http.client.IncompleteRead
        class Truncating(BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200)
                self.send_header("Content-Length", "5000")
                self.end_headers()
                self.wfile.write(b"GPS BIIR-5  (PRN 22)\r\n1 26407U")
                self.close_connection = True

            def log_message(self, *args):
                pass

        server = HTTPServer(("127.0.0.1", 0), Truncating)
        thread = threading.Thread(target=server.handle_request, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as d:
                shutil.copy(FX / "gps_sample.tle", Path(d) / "gps_20261105T0000Z.tle")
                url = f"http://127.0.0.1:{server.server_address[1]}/gps.tle"
                path, warns = fetch_gps_tle(Path(d), url=url, timeout_s=5, now=self.NOW)
                self.assertEqual(path.name, "gps_20261105T0000Z.tle")
                self.assertEqual(len(warns), 1)
        finally:
            thread.join(5)
            server.server_close()

    def test_fetch_non_tle_body_falls_back(self):
        with tempfile.TemporaryDirectory() as d:
            junk = Path(d) / "junk.txt"
            junk.write_text("GP data has not updated since your last successful download\n")
            cache = Path(d) / "cache"
            cache.mkdir()
            shutil.copy(FX / "gps_sample.tle", cache / "gps_20261105T0000Z.tle")
            path, warns = fetch_gps_tle(cache, url=junk.as_uri(), now=self.NOW)
            self.assertEqual(path.name, "gps_20261105T0000Z.tle")
            self.assertEqual(sorted(p.name for p in cache.iterdir()), ["gps_20261105T0000Z.tle"])


if __name__ == "__main__":
    unittest.main()
