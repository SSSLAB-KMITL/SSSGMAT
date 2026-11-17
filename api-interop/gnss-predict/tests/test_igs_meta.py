import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from http.client import IncompleteRead
from pathlib import Path
from urllib.error import HTTPError, URLError

from gnss_predict.config import IGS_META_MAX_AGE_S, IGS_META_URL
from gnss_predict.errors import IgsMetadataUnavailableError
from gnss_predict.igs_meta import SatIdentity, fetch_metadata, read_metadata

FXS = Path(__file__).parent / "fixtures" / "studio"
FIXTURE = FXS / "snapshot" / "igs_satellite_metadata.snx"
NOW = datetime(2026, 11, 11, 6, 0, tzinfo=timezone.utc)


def T(*a):
    return datetime(*a, tzinfo=timezone.utc)


class TestIdentity(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = read_metadata(FIXTURE)

    def test_identity_g01(self):
        self.assertEqual(self.m.identity_at(62339, T(2026, 11, 9, 12)),
                         SatIdentity("G01", "G080", 62339, "2024-242A", "GPS-IIIA"))

    def test_identity_other_systems(self):
        self.assertEqual(self.m.identity_at(37846, T(2026, 11, 9)),
                         SatIdentity("E11", "E101", 37846, "2011-060A", "GAL-1"))
        self.assertEqual(self.m.identity_at(43508, T(2026, 11, 9)),
                         SatIdentity("R05", "R856", 43508, "2018-053A", "GLO-M+"))

    def test_beidou_reassigned(self):
        self.assertEqual(self.m.identity_at(56564, T(2026, 11, 9)).prn, "C01")
        self.assertEqual(self.m.identity_at(56564, T(2026, 4, 1)).prn, "C59")
        self.assertIsNone(self.m.identity_at(56564, T(2026, 4, 20, 13)))      # ช่องว่าง 2026:110:43200–57600
        self.assertEqual(self.m.identity_at(44542, T(2026, 11, 9)).prn, "C40")
        self.assertEqual(self.m.identity_at(44542, T(2026, 4, 20)).prn, "C46")

    def test_ended_prn_returns_none(self):
        self.assertIsNone(self.m.identity_at(36828, T(2026, 11, 9)))          # C005 สิ้นสุด 2026:100

    def test_six_digit_satcat(self):
        self.assertEqual(self.m.identity_at(100744, T(2026, 11, 9)).prn, "R10")

    def test_valid_to_is_exclusive(self):
        self.assertEqual(self.m.identity_at(100744, T(2026, 10, 20, 5, 29, 59)).prn, "R28")
        self.assertIsNone(self.m.identity_at(100744, T(2026, 10, 20, 5, 30, 0)))

    def test_valid_from_is_inclusive(self):
        self.assertIsNone(self.m.identity_at(100744, T(2026, 10, 20, 5, 30, 59)))
        self.assertEqual(self.m.identity_at(100744, T(2026, 10, 20, 5, 31, 0)).prn, "R10")

    def test_open_ended_and_before_first_period(self):
        self.assertEqual(self.m.identity_at(62339, T(2099, 1, 1)).prn, "G01")
        self.assertIsNone(self.m.identity_at(62339, T(2024, 12, 16, 23, 59, 59)))   # PRN G01 เริ่ม 2024:352
        self.assertEqual(self.m.identity_at(62339, T(2024, 12, 17)).prn, "G01")

    def test_gps_prn_reuse_by_another_svn(self):
        self.assertIsNone(self.m.identity_at(26407, T(2022, 11, 1)))          # G044 ว่างระหว่าง 2022:299 และ 2023:222
        self.assertEqual(self.m.identity_at(26407, T(2022, 10, 1)).prn, "G28")
        self.assertEqual(self.m.identity_at(26407, T(2026, 11, 9)).prn, "G22")

    def test_unknown_norad(self):
        self.assertIsNone(self.m.identity_at(99999, T(2026, 11, 9)))
        self.assertEqual(self.m.prn_changes(99999, T(2026, 1, 1), T(2026, 12, 31)), [])


class TestPrnChanges(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = read_metadata(FIXTURE)

    def test_prn_changes_with_gap(self):                                     # Review Focus 2
        self.assertEqual(self.m.prn_changes(100744, T(2026, 10, 20), T(2026, 10, 21)),
                         [(T(2026, 10, 20, 5, 30), None), (T(2026, 10, 20, 5, 31), "R10")])

    def test_no_change(self):
        self.assertEqual(self.m.prn_changes(62339, T(2026, 1, 1), T(2026, 12, 31)), [])
        self.assertEqual(self.m.prn_changes(100744, T(2026, 10, 21), T(2026, 10, 22)), [])

    def test_interval_is_open_at_start_and_closed_at_stop(self):
        # การเปลี่ยนที่ start พอดีถือเป็นสถานะตอนเริ่ม ไม่นับ ส่วนที่ stop พอดีนับ
        self.assertEqual(self.m.prn_changes(100744, T(2026, 10, 20, 5, 30), T(2026, 10, 21)),
                         [(T(2026, 10, 20, 5, 31), "R10")])
        self.assertEqual(self.m.prn_changes(100744, T(2026, 10, 20), T(2026, 10, 20, 5, 30)),
                         [(T(2026, 10, 20, 5, 30), None)])
        self.assertEqual(self.m.prn_changes(100744, T(2026, 10, 20), T(2026, 10, 20, 5, 29, 59)), [])

    def test_change_without_gap_and_chained_changes(self):
        # C222: C46 สิ้นสุด 2026:110:82800 (20 เม.ย. 23:00) แล้ว C40 เริ่ม 2026:111:10800 (21 เม.ย. 03:00)
        self.assertEqual(self.m.prn_changes(44542, T(2026, 4, 20), T(2026, 4, 22)),
                         [(T(2026, 4, 20, 23, 0), None), (T(2026, 4, 21, 3, 0), "C40")])
        # C231 ผ่านสามช่วงต่อกัน: C62 -> C59 (ช่องว่าง 30 วินาที) -> ว่าง -> C01
        self.assertEqual(self.m.prn_changes(56564, T(2026, 3, 1), T(2026, 5, 1)),
                         [(T(2026, 3, 31, 13, 4, 0), None), (T(2026, 3, 31, 13, 4, 30), "C59"),
                          (T(2026, 4, 20, 12, 0), None), (T(2026, 4, 20, 16, 0), "C01")])

    def test_start_inside_gap(self):
        self.assertEqual(self.m.prn_changes(100744, T(2026, 10, 20, 5, 30, 30), T(2026, 10, 21)),
                         [(T(2026, 10, 20, 5, 31), "R10")])

    def test_ended_prn(self):
        self.assertEqual(self.m.prn_changes(36828, T(2026, 4, 1), T(2026, 12, 1)),
                         [(T(2026, 4, 10, 12, 0), None)])                    # C005 สิ้นสุด 2026:100:43200


SNX_HEAD = "%=SNX 2.02 DLR 26:295:28054 DLR 78:053:00000 00:000:00000 P 00000 0\r\n"


def snx(identifier_rows=(), prn_rows=(), extra=""):
    parts = [SNX_HEAD, "+SATELLITE/IDENTIFIER\r\n*\r\n", *[r + "\r\n" for r in identifier_rows],
             "-SATELLITE/IDENTIFIER\r\n", extra, "+SATELLITE/PRN\r\n*\r\n", *[r + "\r\n" for r in prn_rows],
             "-SATELLITE/PRN\r\n"]
    return "".join(parts)


class TestReadMetadata(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)

    def write(self, text: str) -> Path:
        p = self.dir / "meta.snx"
        p.write_bytes(text.encode("utf-8"))
        return p

    def test_non_numeric_satcat_skipped(self):
        p = self.write(snx([" G001 1978-020A  10684 GPS-I           Launched 1978-02-22",
                            " G099 2030-001A  ?????  GPS-IIIF        not yet launched",
                            " G098 2030-002A         GPS-IIIF        satcat missing"],
                           [" G001 1978:053:00000 0000:000:00000 G04 ",
                            " G099 2030:001:00000 0000:000:00000 G32 ",
                            " G098 2030:001:00000 0000:000:00000 G31 "]))
        m = read_metadata(p)
        self.assertEqual(m.identity_at(10684, T(2026, 1, 1)), SatIdentity("G04", "G001", 10684, "1978-020A", "GPS-I"))
        self.assertEqual(m.prn_changes(10684, T(2025, 1, 1), T(2027, 1, 1)), [])

    def test_only_two_sections_are_read(self):
        # ส่วนอื่นของไฟล์จริง (PLANE, FREQUENCY_CHANNEL, ...) ก็ขึ้นต้นบรรทัดด้วย SVN
        # แถวหลอกในส่วนอื่นมีรูปแบบเหมือนแถวของสองส่วนนี้ทุกประการ ถ้าถูกอ่านจะทำให้ผลเปลี่ยน
        decoy = ("+SATELLITE/PLANE\r\n*\r\n G001 1978:053:00000 0000:000:00000 A        [PL01]\r\n"
                 " G001 2000:001:00000 0000:000:00000 G99 decoy PRN\r\n"
                 " G002 2001-001A  77777 GPS-X           decoy identifier\r\n-SATELLITE/PLANE\r\n"
                 "+SATELLITE/FREQUENCY_CHANNEL\r\n*\r\n R001 1990:001:00000 0000:000:00000   1 test\r\n"
                 "-SATELLITE/FREQUENCY_CHANNEL\r\n")
        rows = [" G001 1978-020A  10684 GPS-I           Launched 1978-02-22"]
        prn = [" G001 1978:053:00000 0000:000:00000 G04 "]
        p = self.write(snx(rows, prn, extra=decoy) + decoy + "%ENDSNX\r\n")
        m = read_metadata(p)
        self.assertEqual(m.identity_at(10684, T(2026, 1, 1)).prn, "G04")
        self.assertIsNone(m.identity_at(77777, T(2026, 1, 1)))
        self.assertEqual(m.prn_changes(10684, T(1999, 1, 1), T(2030, 1, 1)), [])

    def test_accepts_lf_only_and_no_endsnx(self):
        p = self.write(snx([" G001 1978-020A  10684 GPS-I           Launched"],
                           [" G001 1978:053:00000 0000:000:00000 G04 "]).replace("\r\n", "\n"))
        self.assertEqual(read_metadata(p).identity_at(10684, T(2026, 1, 1)).prn, "G04")

    def test_comment_and_blank_lines_ignored(self):
        p = self.write(snx([" G001 1978-020A  10684 GPS-I           Launched", "*  G002 1978-025A  10684 BAD", ""],
                           [" G001 1978:053:00000 0000:000:00000 G04 ", "* G001 1978:053:00000 0000:000:00000 G05", ""]))
        m = read_metadata(p)
        self.assertEqual(m.identity_at(10684, T(2026, 1, 1)).svn, "G001")
        self.assertEqual(m.identity_at(10684, T(2026, 1, 1)).prn, "G04")

    def test_malformed_prn_row_skipped(self):
        p = self.write(snx([" G001 1978-020A  10684 GPS-I           Launched"],
                           [" G001 1978:053:00000 0000:000:00000 G04 ",
                            " G001 bad:time:here 0000:000:00000 G05 ",
                            " G001 1990:001:00000"]))
        self.assertEqual(read_metadata(p).identity_at(10684, T(2026, 1, 1)).prn, "G04")

    def test_missing_sections_raise_value_error(self):
        for text in ("", SNX_HEAD, snx(), "<html>Not found</html>",
                     snx([" G001 1978-020A  10684 GPS-I           Launched"]),
                     snx(prn_rows=[" G001 1978:053:00000 0000:000:00000 G04 "])):
            with self.subTest(text=text[:30]):
                with self.assertRaises(ValueError):
                    read_metadata(self.write(text))


class FakeOpener:
    """opener ปลอม: คืนผลตามลำดับ (bytes = ตอบ 200, Exception = raise) และนับ request"""

    def __init__(self, *outcomes):
        self.outcomes = list(outcomes)
        self.calls = []

    def __call__(self, request, timeout=None):
        self.calls.append((request.full_url, timeout))
        if not self.outcomes:
            raise AssertionError("opener ถูกเรียกเกินที่คาดไว้")
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return _Resp(outcome)


class ReadFails:
    """ตัวแทน body ที่ resp.read() จะ raise (เช่น อ่านคำตอบไม่จบ)"""

    def __init__(self, exc: Exception):
        self.exc = exc


class _Resp:
    def __init__(self, body):
        self._body = body

    def read(self):
        if isinstance(self._body, ReadFails):
            raise self._body.exc
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


FIXTURE_BYTES = FIXTURE.read_bytes()


class TestFetchMetadata(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name) / "meta"

    def seed(self, age: timedelta, body: bytes = FIXTURE_BYTES) -> Path:
        self.dir.mkdir(parents=True, exist_ok=True)
        p = self.dir / f"igs_satellite_metadata_{NOW - age:%Y%m%dT%H%MZ}.snx"
        p.write_bytes(body)
        return p

    def files(self):
        return sorted(p.name for p in self.dir.iterdir()) if self.dir.exists() else []

    def test_fresh_file_sends_no_request(self):
        old = self.seed(timedelta(hours=23, minutes=59))
        op = FakeOpener()
        path, msgs = fetch_metadata(self.dir, NOW, opener=op)
        self.assertEqual((path, msgs), (old, []))
        self.assertEqual(op.calls, [])

    def test_exactly_max_age_is_still_fresh(self):
        old = self.seed(timedelta(seconds=IGS_META_MAX_AGE_S))
        op = FakeOpener()
        self.assertEqual(fetch_metadata(self.dir, NOW, opener=op), (old, []))
        self.assertEqual(op.calls, [])

    def test_stale_file_triggers_download(self):
        self.seed(timedelta(hours=24, minutes=1))
        op = FakeOpener(FIXTURE_BYTES)
        path, msgs = fetch_metadata(self.dir, NOW, opener=op, timeout_s=12)
        self.assertEqual(msgs, [])
        self.assertEqual(path, self.dir / "igs_satellite_metadata_20261111T0600Z.snx")
        self.assertEqual(op.calls, [(IGS_META_URL, 12)])
        self.assertEqual(path.read_bytes(), FIXTURE_BYTES)               # เก็บไบต์ตามต้นฉบับ (CRLF)
        self.assertEqual(read_metadata(path).identity_at(62339, T(2026, 11, 9)).prn, "G01")
        self.assertFalse([n for n in self.files() if n.endswith(".tmp")])

    def test_default_timeout_is_60(self):
        op = FakeOpener(FIXTURE_BYTES)
        fetch_metadata(self.dir, NOW, opener=op)
        self.assertEqual(op.calls, [(IGS_META_URL, 60)])

    def test_no_file_downloads_and_creates_dir(self):
        self.assertFalse(self.dir.exists())
        path, msgs = fetch_metadata(self.dir, NOW, opener=FakeOpener(FIXTURE_BYTES))
        self.assertEqual((path.name, msgs), ("igs_satellite_metadata_20261111T0600Z.snx", []))
        self.assertTrue(path.is_file())

    def test_download_failure_falls_back_to_previous_file(self):
        failures = [HTTPError(IGS_META_URL, 404, "Not Found", {}, None), URLError("ไม่มีเน็ต"),
                    TimeoutError("timed out"), ReadFails(IncompleteRead(b"abc", 10)),
                    ReadFails(TimeoutError("read timed out"))]
        for exc in failures:
            with self.subTest(exc=repr(exc)[:40]):
                self.setUp()
                old = self.seed(timedelta(days=3))
                op = FakeOpener(exc)
                path, msgs = fetch_metadata(self.dir, NOW, opener=op)
                self.assertEqual(path, old)
                self.assertEqual(len(op.calls), 1)                      # ไม่ลองซ้ำ
                self.assertEqual([(m.code, m.level) for m in msgs], [("IGS_META_STALE", "warning")])
                self.assertIn(old.name, msgs[0].text)
                self.assertEqual(self.files(), [old.name])

    def test_unusable_body_does_not_replace_file(self):
        for body in (b"<html>Service Unavailable</html>", b"", b"\xff\xfe\x00bad", FIXTURE_BYTES[:20]):
            with self.subTest(body=body[:20]):
                self.setUp()
                old = self.seed(timedelta(days=2))
                path, msgs = fetch_metadata(self.dir, NOW, opener=FakeOpener(body))
                self.assertEqual(path, old)
                self.assertEqual([m.code for m in msgs], ["IGS_META_STALE"])
                self.assertEqual(self.files(), [old.name])

    def test_latest_file_is_the_newest_by_name(self):
        self.seed(timedelta(days=5))
        newer = self.seed(timedelta(hours=30))
        (self.dir / "igs_satellite_metadata_notes.txt").write_text("x")
        (self.dir / "igs_satellite_metadata_backup.snx").write_text("x")
        path, msgs = fetch_metadata(self.dir, NOW, opener=FakeOpener(HTTPError(IGS_META_URL, 403, "Forbidden", {}, None)))
        self.assertEqual(path, newer)
        self.assertEqual([m.code for m in msgs], ["IGS_META_STALE"])

    def test_no_file_and_download_fails_raises(self):
        for outcome in (URLError("ไม่มีเน็ต"), HTTPError(IGS_META_URL, 500, "err", {}, None), b"not sinex"):
            with self.subTest(outcome=repr(outcome)[:30]):
                self.setUp()
                with self.assertRaises(IgsMetadataUnavailableError) as ctx:
                    fetch_metadata(self.dir, NOW, opener=FakeOpener(outcome))
                self.assertEqual(ctx.exception.code, "IGS_META_UNAVAILABLE")
                self.assertEqual(self.files(), [])


if __name__ == "__main__":
    unittest.main()
