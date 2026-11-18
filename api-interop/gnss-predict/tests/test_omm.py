import json
import tempfile
import unittest
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError

from gnss_predict.config import CELESTRAK_GP_URL, CELESTRAK_MIN_INTERVAL_S, OMM_MAX_BYTES
from gnss_predict.errors import OrbitUnavailableError
from gnss_predict.omm import catalog_field, fetch_group, parse_state_time, read_omm, read_state, to_tle_lines
from gnss_predict.tle_fetch import tle_checksum

FX = Path(__file__).parent / "fixtures"
FXS = FX / "studio"
UTC = timezone.utc
T0 = datetime(2026, 11, 11, 6, 0, tzinfo=UTC)
NON_OMM_BODY = b"GP data has not updated since your last successful download\n"


def tle_pairs(path: Path):
    """คู่บรรทัด 1/2 ของ TLE (ตัด CR และช่องว่างท้ายบรรทัดแล้ว)"""
    lines = [l.rstrip() for l in path.read_bytes().decode().replace("\r", "").split("\n")]
    return [(l, lines[i + 1]) for i, l in enumerate(lines[:-1]) if l.startswith("1 ") and lines[i + 1].startswith("2 ")]


class ReadFails:
    """ตัวแทน body ที่ resp.read() จะ raise (เช่น timeout ระหว่างอ่าน)"""

    def __init__(self, exc: Exception):
        self.exc = exc


class Endless:
    """ตัวแทน body ที่ไม่มีวันจบ: read(n) ได้ n ไบต์เสมอ ส่วน read() ที่ไม่จำกัดขนาดถือว่าผิด (อ่านไม่จำกัดจะกินหน่วยความจำ)"""


class _Resp:
    def __init__(self, body):
        self._body = body

    def read(self, amt=None):
        if isinstance(self._body, ReadFails):
            raise self._body.exc
        if isinstance(self._body, Endless):
            if amt is None or amt < 0:
                raise AssertionError("resp.read() ไม่จำกัดขนาด")
            return b" " * amt
        return self._body if amt is None or amt < 0 else self._body[:amt]

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class FakeOpener:
    """opener ปลอม: คืนผลตามลำดับที่กำหนด (bytes = ตอบ 200, Exception = raise) และนับจำนวนครั้งที่ถูกเรียก"""

    def __init__(self, *outcomes):
        self.outcomes = list(outcomes)
        self.calls = []

    def __call__(self, request, timeout=None):
        self.calls.append((request.full_url, timeout))
        if not self.outcomes:
            raise AssertionError("opener ถูกเรียกเกินที่คาดไว้")
        out = self.outcomes.pop(0)
        if isinstance(out, Exception):
            raise out
        return _Resp(out)


class TestConvert(unittest.TestCase):
    def test_to_tle_lines_matches_celestrak(self):            # ค่าจริง: TLE ที่ดาวน์โหลดคู่กัน
        tle = {int(l1[2:7]): (l1, l2) for l1, l2 in tle_pairs(FXS / "tle_sample.tle")}
        recs = [r for r in read_omm(FXS / "omm_sample.json") if r.norad in tle]
        self.assertEqual(len(recs), 9)                       # รวม 26407 ที่ต้องตัดความเยื้องศูนย์กลาง
        for r in recs:
            self.assertEqual(to_tle_lines(r), tle[r.norad], r.norad)

    def test_eccentricity_truncated_not_rounded(self):
        r = next(r for r in read_omm(FXS / "omm_sample.json") if r.norad == 26407)
        self.assertEqual(r.raw["ECCENTRICITY"], 0.01151548)
        self.assertEqual(to_tle_lines(r)[1][26:33], "0115154")

    def test_catalog_field(self):
        self.assertEqual(catalog_field(5), "00005")
        self.assertEqual(catalog_field(99999), "99999")
        self.assertEqual(catalog_field(100000), "A0000")
        self.assertEqual(catalog_field(100744), "A0744")
        self.assertEqual(catalog_field(339999), "Z9999")
        with self.assertRaises(ValueError):
            catalog_field(340000)
        with self.assertRaises(ValueError):
            catalog_field(-1)

    def test_catalog_field_alpha5_skips_i_and_o(self):
        self.assertEqual(catalog_field(170000), "H0000")      # H = 17
        self.assertEqual(catalog_field(180000), "J0000")      # ข้าม I
        self.assertEqual(catalog_field(220000), "N0000")      # N = 22
        self.assertEqual(catalog_field(230000), "P0000")      # ข้าม O

    def test_six_digit_record_uses_alpha5(self):
        r = next(r for r in read_omm(FXS / "omm_sample.json") if r.norad == 100744)
        l1, l2 = to_tle_lines(r)
        self.assertEqual((l1[2:7], l2[2:7]), ("A0744", "A0744"))
        self.assertEqual(int(l1[68]), tle_checksum(l1))
        self.assertEqual(int(l2[68]), tle_checksum(l2))

    def test_lines_are_69_columns_with_valid_checksum(self):
        for r in read_omm(FXS / "omm_sample.json"):
            for line in to_tle_lines(r):
                self.assertEqual(len(line), 69, r.norad)
                self.assertEqual(int(line[68]), tle_checksum(line), r.norad)

    def test_implied_decimal_fields(self):
        base = next(r for r in read_omm(FXS / "omm_sample.json") if r.norad == 62339)
        raw = dict(base.raw, BSTAR=0.00010412, MEAN_MOTION_DDOT=-1.2345e-05)
        l1, _ = to_tle_lines(replace(base, raw=raw))
        self.assertEqual(l1[44:52], "-12345-4")        # MEAN_MOTION_DDOT
        self.assertEqual(l1[53:61], " 10412-3")        # BSTAR
        self.assertEqual(int(l1[68]), tle_checksum(l1))
        self.assertEqual(to_tle_lines(base)[0][53:61], " 00000+0")

    def test_missing_field_is_value_error(self):
        base = next(r for r in read_omm(FXS / "omm_sample.json") if r.norad == 62339)
        raw = {k: v for k, v in base.raw.items() if k != "INCLINATION"}
        with self.assertRaises(ValueError):
            to_tle_lines(replace(base, raw=raw))


class TestRead(unittest.TestCase):
    def test_read_omm_epoch_is_utc(self):
        r = next(r for r in read_omm(FXS / "omm_sample.json") if r.norad == 62339)
        self.assertEqual(r.epoch, datetime(2026, 11, 10, 4, 12, 45, 624384, tzinfo=UTC))
        self.assertEqual((r.name, r.object_id), ("GPS BIII-7  (PRN 01)", "2024-242A"))
        self.assertEqual(r.raw["NORAD_CAT_ID"], 62339)

    def test_read_omm_sample_has_ten_records(self):
        self.assertEqual(len(read_omm(FXS / "omm_sample.json")), 10)

    def test_read_omm_rejects_non_omm(self):
        bad = {"not json": NON_OMM_BODY.decode(),
               "object not array": '{"NORAD_CAT_ID": 1, "EPOCH": "2026-01-01T00:00:00"}',
               "item not object": "[1, 2]",
               "missing EPOCH": '[{"NORAD_CAT_ID": 1}]',
               "missing NORAD": '[{"EPOCH": "2026-01-01T00:00:00"}]',
               "bad EPOCH": '[{"NORAD_CAT_ID": 1, "EPOCH": "yesterday"}]'}
        with tempfile.TemporaryDirectory() as d:
            for label, text in bad.items():
                p = Path(d) / "x.json"
                p.write_text(text, encoding="utf-8")
                with self.subTest(label), self.assertRaises(ValueError):
                    read_omm(p)


class TestStateHelpers(unittest.TestCase):
    """read_state / parse_state_time: ตัวอ่าน celestrak_state.json แบบสาธารณะ (Gpredict Web แสดงเวลาดึงล่าสุดของแต่ละกลุ่ม)"""

    def test_parse_state_time(self):
        self.assertEqual(parse_state_time("2026-11-11T06:00:00Z"), datetime(2026, 11, 11, 6, 0, tzinfo=UTC))
        for bad in (None, 12, "", "2026-11-11T06:00:00", "2026-11-11T06:00:00.000Z", "yesterday"):
            with self.subTest(bad=bad):
                self.assertIsNone(parse_state_time(bad))

    def test_read_state(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "celestrak_state.json"
            self.assertEqual(read_state(path), {})                                  # ไม่มีไฟล์
            for text in ("{", "[1, 2]", "\"x\""):
                path.write_text(text, encoding="utf-8")
                with self.subTest(text=text):
                    self.assertEqual(read_state(path), {})                          # เสียหรือไม่ใช่ object
            path.write_bytes(b"\xff\xfe")
            self.assertEqual(read_state(path), {})                                  # ไม่ใช่ UTF-8
            state = {"amateur": {"last_request": "2026-11-11T06:00:00Z"}}
            path.write_text(json.dumps(state), encoding="utf-8")
            self.assertEqual(read_state(str(path)), state)                          # รับ str ได้


class TestFetch(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dest = Path(tmp.name) / "omm"
        self.state = Path(tmp.name) / "state" / "celestrak.json"
        self.body = (FXS / "snapshot" / "gps-ops.json").read_bytes()

    def fetch(self, opener, now=T0, **kw):
        return fetch_group("gps-ops", self.dest, self.state, now, opener=opener, **kw)

    def state_of(self, group="gps-ops"):
        return json.loads(self.state.read_text(encoding="utf-8"))[group]

    def test_fetch_writes_cache_and_state(self):
        op = FakeOpener(self.body)
        path, msgs = self.fetch(op, timeout_s=12)
        self.assertEqual(path, self.dest / "gps-ops_20261111T0600Z.json")
        self.assertEqual(path.read_bytes(), self.body)
        self.assertEqual(msgs, [])
        self.assertEqual(self.state_of(), {"last_request": "2026-11-11T06:00:00Z", "last_success": "2026-11-11T06:00:00Z"})
        self.assertEqual(op.calls, [(CELESTRAK_GP_URL.format(group="gps-ops"), 12)])
        self.assertEqual(len(read_omm(path)), 2)

    def test_fetch_within_interval_skips_request(self):
        op = FakeOpener(self.body)
        first, _ = self.fetch(op)
        path, msgs = self.fetch(op, now=T0 + timedelta(seconds=CELESTRAK_MIN_INTERVAL_S - 1))
        self.assertEqual(len(op.calls), 1)
        self.assertEqual(path, first)
        self.assertEqual([(m.code, m.level) for m in msgs], [("ORBIT_RATE_LIMITED_LOCAL", "info")])
        self.assertEqual(self.state_of()["last_request"], "2026-11-11T06:00:00Z")

    def test_fetch_after_interval_requests_again(self):
        op = FakeOpener(self.body, self.body)
        first, _ = self.fetch(op)
        later = T0 + timedelta(seconds=CELESTRAK_MIN_INTERVAL_S)
        path, msgs = self.fetch(op, now=later)
        self.assertEqual(len(op.calls), 2)
        self.assertEqual(msgs, [])
        self.assertEqual(path, self.dest / "gps-ops_20261111T0800Z.json")
        self.assertGreater(path.name, first.name)
        self.assertEqual(self.state_of(), {"last_request": "2026-11-11T08:00:00Z", "last_success": "2026-11-11T08:00:00Z"})

    def test_fetch_returns_latest_by_sorted_name(self):
        self.dest.mkdir(parents=True)
        for stamp in ("20261110T0000Z", "20261109T1800Z"):
            (self.dest / f"gps-ops_{stamp}.json").write_bytes(self.body)
        (self.dest / "glo-ops_20261112T0000Z.json").write_bytes(self.body)    # คนละกลุ่ม ต้องไม่ถูกเลือก
        self.state.parent.mkdir(parents=True)
        self.state.write_text(json.dumps({"gps-ops": {"last_request": "2026-11-11T05:00:00Z",
                                                      "last_success": "2026-11-10T00:00:00Z"}}))
        op = FakeOpener()
        path, msgs = self.fetch(op)
        self.assertEqual(path.name, "gps-ops_20261110T0000Z.json")
        self.assertEqual(op.calls, [])
        self.assertEqual(msgs[0].code, "ORBIT_RATE_LIMITED_LOCAL")

    def test_fetch_403_falls_back_without_retry(self):
        op = FakeOpener(self.body, HTTPError("u", 403, "Forbidden", {}, None))
        first, _ = self.fetch(op)
        later = T0 + timedelta(seconds=CELESTRAK_MIN_INTERVAL_S)
        path, msgs = self.fetch(op, now=later)
        self.assertEqual(len(op.calls), 2)
        self.assertEqual(path, first)
        self.assertEqual([(m.code, m.level) for m in msgs], [("ORBIT_DOWNLOAD_FAILED", "warning")])
        self.assertIn("403", msgs[0].text)
        self.assertEqual(self.state_of(), {"last_request": "2026-11-11T08:00:00Z", "last_success": "2026-11-11T06:00:00Z"})
        self.assertEqual(len(list(self.dest.glob("*.json"))), 1)
        # ไม่ลองซ้ำหลังได้คำตอบที่ใช้ไม่ได้: เรียกอีกครั้งก่อนครบ 2 ชม. ต้องไม่ส่ง request
        path2, msgs2 = self.fetch(op, now=later + timedelta(seconds=60))
        self.assertEqual(len(op.calls), 2)
        self.assertEqual((path2, msgs2[0].code), (first, "ORBIT_RATE_LIMITED_LOCAL"))

    def test_fetch_non_json_body_falls_back(self):         # Review Focus 1
        op = FakeOpener(self.body, NON_OMM_BODY)
        first, _ = self.fetch(op)
        later = T0 + timedelta(seconds=CELESTRAK_MIN_INTERVAL_S)
        path, msgs = self.fetch(op, now=later)
        self.assertEqual(path, first)
        self.assertEqual([(m.code, m.level) for m in msgs], [("ORBIT_DOWNLOAD_FAILED", "warning")])
        self.assertEqual(len(list(self.dest.iterdir())), 1)   # ไม่มีไฟล์ใหม่และไม่มีไฟล์ .tmp ค้าง
        self.assertEqual(self.state_of(), {"last_request": "2026-11-11T08:00:00Z", "last_success": "2026-11-11T06:00:00Z"})
        self.fetch(op, now=later + timedelta(seconds=60))      # ต้องไม่ส่งซ้ำใน 2 ชม.
        self.assertEqual(len(op.calls), 2)

    def test_fetch_valid_json_but_not_omm_falls_back(self):
        for label, body in (("empty array", b"[]"), ("object", b'{"error": "no data"}'),
                            ("no EPOCH", b'[{"NORAD_CAT_ID": 1}]')):
            with self.subTest(label):
                self.setUp()
                op = FakeOpener(self.body, body)
                first, _ = self.fetch(op)
                path, msgs = self.fetch(op, now=T0 + timedelta(seconds=CELESTRAK_MIN_INTERVAL_S))
                self.assertEqual(path, first)
                self.assertEqual(msgs[0].code, "ORBIT_DOWNLOAD_FAILED")
                self.assertEqual(len(list(self.dest.iterdir())), 1)

    def test_fetch_network_error_falls_back_and_does_not_record_request(self):
        op = FakeOpener(self.body, URLError("ต่อไม่ได้"), URLError("ต่อไม่ได้"))
        first, _ = self.fetch(op)
        later = T0 + timedelta(seconds=CELESTRAK_MIN_INTERVAL_S)
        path, msgs = self.fetch(op, now=later)
        self.assertEqual((path, msgs[0].code, msgs[0].level), (first, "ORBIT_DOWNLOAD_FAILED", "warning"))
        self.assertEqual(self.state_of()["last_request"], "2026-11-11T06:00:00Z")   # ต่อ server ไม่ได้ ไม่บันทึกเวลา request
        self.fetch(op, now=later + timedelta(seconds=60))                           # จึงลองใหม่ได้
        self.assertEqual(len(op.calls), 3)

    def test_fetch_failure_after_request_sent_is_recorded(self):
        # urlopen ห่อเฉพาะความล้มเหลวก่อนส่ง request ใน URLError: timeout/reset ตอนรอคำตอบหรืออ่าน body ออกมาเป็น OSError ตรง ๆ
        # server ได้รับ request แล้ว จึงต้องบันทึก last_request เพื่อไม่ให้เกิน 1 ครั้งต่อ 2 ชม.
        later = T0 + timedelta(seconds=CELESTRAK_MIN_INTERVAL_S)
        failures = {"opener raises TimeoutError": TimeoutError(),
                    "read raises TimeoutError": ReadFails(TimeoutError("timed out")),
                    "opener raises ConnectionResetError": ConnectionResetError(104, "Connection reset by peer")}
        for label, failure in failures.items():
            with self.subTest(label):
                self.setUp()
                op = FakeOpener(self.body, failure)
                first, _ = self.fetch(op)
                path, msgs = self.fetch(op, now=later)
                self.assertEqual((path, msgs[0].code, msgs[0].level), (first, "ORBIT_DOWNLOAD_FAILED", "warning"))
                self.assertTrue(msgs[0].text.strip())
                self.assertEqual(self.state_of(), {"last_request": "2026-11-11T08:00:00Z",
                                                   "last_success": "2026-11-11T06:00:00Z"})
                self.assertEqual(len(list(self.dest.iterdir())), 1)
                path2, msgs2 = self.fetch(op, now=later + timedelta(seconds=60))   # ต้องไม่ส่งซ้ำใน 2 ชม.
                self.assertEqual((len(op.calls), path2, msgs2[0].code), (2, first, "ORBIT_RATE_LIMITED_LOCAL"))

    def test_fetch_timeout_without_cache_raises_and_records_request(self):
        for label, failure in {"opener": TimeoutError(), "read": ReadFails(TimeoutError())}.items():
            with self.subTest(label):
                self.setUp()
                op = FakeOpener(failure)
                with self.assertRaises(OrbitUnavailableError):
                    self.fetch(op)
                self.assertEqual(self.state_of(), {"last_request": "2026-11-11T06:00:00Z"})
                with self.assertRaises(OrbitUnavailableError):
                    self.fetch(op, now=T0 + timedelta(seconds=60))
                self.assertEqual(len(op.calls), 1)

    def test_fetch_connect_timeout_wrapped_in_urlerror_is_not_recorded(self):
        op = FakeOpener(URLError(TimeoutError("timed out")))
        with self.assertRaises(OrbitUnavailableError):
            self.fetch(op)
        self.assertFalse(self.state.exists())

    def padded_body(self, size: int) -> bytes:
        """OMM ที่ใช้ได้ (JSON array) เติมช่องว่างท้ายให้ยาวพอดี size ไบต์"""
        return self.body + b" " * (size - len(self.body))

    def test_fetch_body_at_cap_is_accepted_and_over_cap_is_not(self):
        # เพดานอ่านคำตอบ OMM: ยาวพอดี OMM_MAX_BYTES รับ เกิน 1 ไบต์ปฏิเสธ (เป็น OMM ที่ใช้ได้ทั้งคู่ถ้าไม่มีเพดาน)
        self.assertEqual(OMM_MAX_BYTES, 32 * 1024 * 1024)
        path, msgs = self.fetch(FakeOpener(self.padded_body(OMM_MAX_BYTES)))
        self.assertEqual((msgs, path.stat().st_size), ([], OMM_MAX_BYTES))
        self.setUp()
        first, _ = self.fetch(FakeOpener(self.body))
        later = T0 + timedelta(seconds=CELESTRAK_MIN_INTERVAL_S)
        path, msgs = self.fetch(FakeOpener(self.padded_body(OMM_MAX_BYTES + 1)), now=later)
        self.assertEqual((path, [m.code for m in msgs]), (first, ["ORBIT_DOWNLOAD_FAILED"]))

    def test_fetch_endless_body_falls_back_like_a_failed_download(self):
        # body ที่ไม่มีวันจบอ่านแค่ OMM_MAX_BYTES + 1 ไบต์ แล้วถือเป็นดาวน์โหลดไม่สำเร็จ: ใช้ไฟล์เดิม บันทึก last_request
        later = T0 + timedelta(seconds=CELESTRAK_MIN_INTERVAL_S)
        op = FakeOpener(self.body, Endless())
        first, _ = self.fetch(op)
        path, msgs = self.fetch(op, now=later)
        self.assertEqual((path, [(m.code, m.level) for m in msgs]), (first, [("ORBIT_DOWNLOAD_FAILED", "warning")]))
        self.assertIn("32 MB", msgs[0].text)
        self.assertIn(first.name, msgs[0].text)
        self.assertEqual(self.state_of(), {"last_request": "2026-11-11T08:00:00Z",
                                           "last_success": "2026-11-11T06:00:00Z"})
        self.assertEqual(list(self.dest.iterdir()), [first])               # ไม่เขียนไฟล์ใหม่ ไม่ทิ้งไฟล์ชั่วคราว
        path2, msgs2 = self.fetch(op, now=later + timedelta(seconds=60))   # ต้องไม่ส่งซ้ำใน 2 ชม.
        self.assertEqual((len(op.calls), path2, msgs2[0].code), (2, first, "ORBIT_RATE_LIMITED_LOCAL"))

    def test_fetch_endless_body_without_cache_raises_and_records_request(self):
        op = FakeOpener(Endless())
        with self.assertRaises(OrbitUnavailableError) as cm:
            self.fetch(op)
        self.assertIn("32 MB", str(cm.exception))
        self.assertEqual(self.state_of(), {"last_request": "2026-11-11T06:00:00Z"})
        self.assertFalse(self.dest.exists() and list(self.dest.iterdir()))

    def test_fetch_no_cache_raises(self):
        op = FakeOpener(URLError("ต่อไม่ได้"))
        with self.assertRaises(OrbitUnavailableError) as cm:
            self.fetch(op)
        self.assertIn("gps-ops", str(cm.exception))
        self.assertFalse(self.state.exists())

    def test_fetch_403_without_cache_raises_and_records_request(self):
        op = FakeOpener(HTTPError("u", 403, "Forbidden", {}, None))
        with self.assertRaises(OrbitUnavailableError):
            self.fetch(op)
        self.assertEqual(self.state_of(), {"last_request": "2026-11-11T06:00:00Z"})
        with self.assertRaises(OrbitUnavailableError):         # ภายใน 2 ชม. ไม่ส่งซ้ำ
            self.fetch(op, now=T0 + timedelta(seconds=60))
        self.assertEqual(len(op.calls), 1)

    def test_fetch_keeps_other_groups_in_state(self):
        self.state.parent.mkdir(parents=True)
        other = {"glo-ops": {"last_request": "2026-11-11T05:00:00Z", "last_success": "2026-11-11T05:00:00Z"}}
        self.state.write_text(json.dumps(other))
        self.fetch(FakeOpener(self.body))
        state = json.loads(self.state.read_text(encoding="utf-8"))
        self.assertEqual(state["glo-ops"], other["glo-ops"])
        self.assertEqual(set(state), {"glo-ops", "gps-ops"})

    def test_fetch_corrupt_state_is_ignored(self):
        self.state.parent.mkdir(parents=True)
        self.state.write_text("{ not json")
        path, msgs = self.fetch(FakeOpener(self.body))
        self.assertEqual((path.name, msgs), ("gps-ops_20261111T0600Z.json", []))

    def test_fetch_url_override_with_file_scheme(self):    # D2: ใช้ urlopen จริงกับ file:// ไม่ใช้เน็ต
        src = FXS / "snapshot" / "gps-ops.json"
        path, msgs = fetch_group("gps-ops", self.dest, self.state, T0, url=src.as_uri())
        self.assertEqual((path.read_bytes(), msgs), (self.body, []))

    def test_fetch_rejects_unsafe_group(self):
        for group in ("", "../x", "a/b", "gps ops", "gps_ops"):
            with self.subTest(group), self.assertRaises(ValueError):
                fetch_group(group, self.dest, self.state, T0, opener=FakeOpener(self.body))


if __name__ == "__main__":
    unittest.main()
