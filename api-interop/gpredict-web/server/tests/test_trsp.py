"""trsp.py: แปลง SatNOGS JSON เป็น transponder ต่อดาว (ref-R §11.3), ปรับค่าตอนอ่าน (ref-R §10.1) และ Update transponder data
ที่ส่งได้ 2 ชม. ต่อครั้ง (spec §7) ทุก test ใช้ opener ปลอมกับ fixture JSON เล็กๆ ใน tests/fixtures (ห้ามต่อ SatNOGS จริง)
และ data dir ชั่วคราว"""

import io
import json
import unittest
from datetime import datetime, timedelta, timezone
from http.client import IncompleteRead
from pathlib import Path
from urllib.error import HTTPError, URLError

from gpredict_web import trsp
from gpredict_web.trsp import (MODES_URL, SATNOGS_API, TRANSMITTERS_URL, TRSP_MIN_INTERVAL, TRSP_TIMEOUT_S, USER_AGENT,
                               TrspUpdateResult, convert, load_transponders, normalise, update_from_network)
from tests.helpers import temp_config

LOGGER = "gpredict_web.trsp"
FIXTURES = Path(__file__).parent / "fixtures"
MODES = (FIXTURES / "satnogs_modes.json").read_bytes()
TRANSMITTERS = (FIXTURES / "satnogs_transmitters.json").read_bytes()
T = datetime(2026, 11, 12, 7, 20, tzinfo=timezone.utc)
KEYS = ["name", "up_low", "up_high", "down_low", "down_high", "invert", "mode", "baud"]


def item(name, up_low=0, up_high=0, down_low=0, down_high=0, invert=False, mode="", baud=0.0) -> dict:
    return dict(zip(KEYS, (name, up_low, up_high, down_low, down_high, invert, mode, baud)))


LONG_NAME = "0123456789" * 10               # 100 ตัวอักษรใน fixture: ตัดที่ 79
EXPECTED = {
    25544: [
        item("Mode V/U FM Voice Repeater", 145_990_000, 0, 437_800_000, 0, False, "FM"),
        item(LONG_NAME[:79], 0, 0, 145_800_000, 145_800_000, False, "ABCDEFGHIJKLMNOPQRS", 1200.0),
        item("Beacon", 0, 0, 145_800_000, 145_800_000, False, "5"),                 # mode 5 ไม่มีชื่อ: เลขเป็นข้อความ
        item("Beacon", 0, 0, 0, 0, True, "0"),                                      # ชื่อซ้ำเก็บทั้งสอง, mode_id null: "0" เหมือน Gpredict
    ],
    43770: [item("Linear Transponder (inverting)", 435_000_000, 435_100_000, 145_900_000, 146_000_000, True, "USB")],
    40908: [item("9k6 BPSK Telemetry", 0, 0, 145_825_000, 0, False, "99", 9600.0)],
}


class FakeResponse:
    def __init__(self, body: bytes):
        self.body = body

    def read(self):
        return self.body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class FakeSatnogs:
    """opener ปลอม: ตอบตาม URL (bytes = 200, Exception = raise) จด (Request, timeout) ทุกครั้งที่ถูกเรียก"""

    def __init__(self, modes=MODES, transmitters=TRANSMITTERS):
        self.replies = {MODES_URL: modes, TRANSMITTERS_URL: transmitters}
        self.calls: list[tuple] = []
        self.on_call = None

    def __call__(self, request, timeout=None):
        self.calls.append((request, timeout))
        if self.on_call is not None:
            self.on_call(request)
        reply = self.replies[request.full_url]
        if isinstance(reply, BaseException):
            raise reply
        return FakeResponse(reply)

    @property
    def urls(self) -> list[str]:
        return [request.full_url for request, _ in self.calls]


class TrspTestCase(unittest.TestCase):
    def setUp(self):
        self.data_dir = temp_config(self).data_dir
        self.trsp_dir = self.data_dir / "trsp"
        self.cache = self.trsp_dir / "_cache"

    def update(self, opener, now=T) -> TrspUpdateResult:
        return update_from_network(self.data_dir, now, opener)

    def update_logged(self, opener, now=T) -> TrspUpdateResult:
        with self.assertLogs(LOGGER, "WARNING"):                 # ล้มเหลวมี log เตือนตาม ref-R §11.2
            return self.update(opener, now)

    def snapshot(self) -> dict[str, bytes]:
        """ทุกไฟล์ใต้ data/trsp (ชื่อสัมพัทธ์ -> ไบต์)"""
        return {str(p.relative_to(self.trsp_dir)): p.read_bytes() for p in sorted(self.trsp_dir.rglob("*")) if p.is_file()}

    def state(self) -> dict:
        return json.loads((self.cache / "state.json").read_text(encoding="utf-8"))

    def read_sat(self, norad: int):
        return json.loads((self.trsp_dir / f"{norad}.json").read_text(encoding="utf-8"))

    def write_sat(self, norad: int, content) -> None:
        self.trsp_dir.mkdir(parents=True, exist_ok=True)
        (self.trsp_dir / f"{norad}.json").write_text(json.dumps(content), encoding="utf-8")


class ConvertTest(unittest.TestCase):
    def setUp(self):
        self.result = convert(json.loads(MODES), json.loads(TRANSMITTERS))

    def test_convert(self):
        self.assertEqual(self.result, EXPECTED)
        self.assertEqual(list(self.result), [25544, 43770, 40908])                   # ลำดับดาวตามที่พบใน JSON
        for items in self.result.values():
            for t in items:
                self.assertEqual(list(t), KEYS)

    def test_skips_transmitter_without_description(self):
        names = [t["name"] for t in self.result[25544]]
        self.assertNotIn("", names)
        self.assertEqual(len(names), 4)                     # t-01 ไม่มี description ถูกข้าม (มี 5 รายการของดาวนี้ใน JSON)

    def test_name_cut_at_79_and_mode_cut_at_19(self):
        long = self.result[25544][1]
        self.assertEqual((len(long["name"]), len(long["mode"])), (trsp.TRSP_NAME_MAX, trsp.TRSP_MODE_MAX))
        self.assertEqual((trsp.TRSP_NAME_MAX, trsp.TRSP_MODE_MAX), (79, 19))

    def test_mode_not_found_is_number_as_text(self):
        self.assertEqual(self.result[40908][0]["mode"], "99")               # ไม่มี id 99 ใน modes
        self.assertEqual(self.result[25544][2]["mode"], "5")                # id 5 มีแต่ไม่มี name: ถูกข้าม จึงไม่เจอ

    def test_missing_or_null_mode_id_is_looked_up_as_zero(self):
        """Gpredict อ่าน mode_id ที่ไม่มีหรือเป็น null เป็น 0 (nx_json int_value) แล้วค้นใน modes: ไม่เจอเขียน "0" เจอใช้ชื่อ"""
        no_key = {"description": "A", "norad_cat_id": 1}
        null = {"description": "B", "norad_cat_id": 1, "mode_id": None}
        self.assertEqual([t["mode"] for t in convert([], [no_key, null])[1]], ["0", "0"])
        self.assertEqual(self.result[25544][3]["mode"], "0")                 # t-08 ใน fixture: mode_id null
        zero = convert([{"id": 0, "name": "Unknown"}], [no_key, null, {**no_key, "mode_id": 0}])
        self.assertEqual([t["mode"] for t in zero[1]], ["Unknown"] * 3)      # modes มี id 0: ใช้ชื่อนั้น
        text = convert([], [{**no_key, "mode_id": "2"}, {**no_key, "mode_id": 1.5}, {**no_key, "mode_id": True}])
        self.assertEqual([t["mode"] for t in text[1]], ["0", "0", "0"])      # ไม่ใช่จำนวนเต็ม: อ่านเป็น 0

    def test_alive_false_is_kept(self):
        self.assertEqual(self.result[43770][0]["name"], "Linear Transponder (inverting)")   # alive: false

    def test_frequencies_at_most_zero_or_null_become_zero(self):
        up = self.result[25544][1]
        self.assertEqual((up["up_low"], up["up_high"]), (0, 0))              # -1 และ 0
        beacon = self.result[25544][3]
        self.assertEqual((beacon["up_low"], beacon["down_low"], beacon["down_high"]), (0, 0, 0))   # 0 และ null
        self.assertEqual(self.result[40908][0]["up_low"], 0)                 # null

    def test_invert_and_baud(self):
        self.assertTrue(self.result[43770][0]["invert"])                     # true
        self.assertTrue(self.result[25544][3]["invert"])                     # ตัวเลขไม่ใช่ศูนย์
        self.assertFalse(self.result[25544][1]["invert"])                    # 0
        self.assertEqual(self.result[40908][0]["baud"], 9600.0)
        self.assertEqual(self.result[25544][1]["baud"], 1200.0)
        self.assertEqual(self.result[25544][0]["baud"], 0.0)                 # null

    def test_norad_cat_id_null_or_missing_is_skipped(self):
        self.assertNotIn(None, self.result)
        self.assertEqual(sorted(self.result), [25544, 40908, 43770])
        self.assertNotIn("Orphan (norad_cat_id is null)", [t["name"] for ts in self.result.values() for t in ts])

    def test_baud_is_rounded_like_gpredicts_format(self):
        out = convert([], [{"description": "B", "norad_cat_id": 1, "baud": 9600.6}])
        self.assertEqual(out[1][0]["baud"], 9601.0)                          # Gpredict เขียน BAUD=%.0f

    def test_empty_description_and_junk_are_skipped(self):
        out = convert([], [{"description": "", "norad_cat_id": 1}, None, 3, "x", {"description": "ok", "norad_cat_id": True}])
        self.assertEqual(out, {})

    def test_empty_inputs(self):
        self.assertEqual(convert([], []), {})


class NormaliseTest(unittest.TestCase):
    def test_normalise(self):
        t = normalise(item("x", -5, 0, 145_800_000, 0))
        self.assertEqual((t["down_low"], t["down_high"]), (145_800_000, 145_800_000))   # มีค่าเดียว: คัดลอกไปอีกค่า
        self.assertEqual((t["up_low"], t["up_high"]), (0, 0))                          # ติดลบเป็น 0

    def test_single_value_is_copied_either_way(self):
        t = normalise(item("x", 0, 435_000_000, 0, 145_900_000))
        self.assertEqual((t["up_low"], t["up_high"]), (435_000_000, 435_000_000))
        self.assertEqual((t["down_low"], t["down_high"]), (145_900_000, 145_900_000))

    def test_full_range_and_negative_pair(self):
        t = normalise(item("x", 435_000_000, 435_100_000, -1, -2))
        self.assertEqual((t["up_low"], t["up_high"]), (435_000_000, 435_100_000))
        self.assertEqual((t["down_low"], t["down_high"]), (0, 0))

    def test_returns_new_dict_with_all_keys(self):
        src = {"name": "x", "down_low": 5}
        t = normalise(src)
        self.assertEqual(src, {"name": "x", "down_low": 5})
        self.assertEqual(t, item("x", 0, 0, 5, 5))
        self.assertEqual(list(t), KEYS)

    def test_bad_types_become_defaults(self):
        t = normalise({"name": "x", "up_low": "a", "down_low": None, "invert": "yes", "mode": None, "baud": "z"})
        self.assertEqual(t, item("x"))


class UpdateTest(TrspTestCase):
    def test_constants(self):
        self.assertEqual(SATNOGS_API, "https://db.satnogs.org/api/")
        self.assertEqual(MODES_URL, "https://db.satnogs.org/api/modes/?format=json")
        self.assertEqual(TRANSMITTERS_URL, "https://db.satnogs.org/api/transmitters/?format=json")
        self.assertEqual((USER_AGENT, TRSP_TIMEOUT_S, TRSP_MIN_INTERVAL), ("gpredict-web", 30, timedelta(hours=2)))

    def test_update_writes_per_satellite(self):
        self.write_sat(99999, [item("old")])                    # ดาวที่ไม่อยู่ในข้อมูลใหม่คงไฟล์เดิม
        self.write_sat(25544, [item("stale")])                  # ดาวที่อยู่ในข้อมูลใหม่ถูกแทนที่ทั้งไฟล์
        result = self.update(FakeSatnogs())
        self.assertEqual(self.read_sat(25544), EXPECTED[25544])
        self.assertEqual(self.read_sat(43770), EXPECTED[43770])
        self.assertEqual(self.read_sat(40908), EXPECTED[40908])
        self.assertEqual(self.read_sat(99999), [item("old")])
        self.assertEqual((result.cached, result.fetched_at, result.satellites), (False, T, 3))
        self.assertEqual([(m.code, m.level) for m in result.messages], [("TRSP_UPDATED", "info")])
        self.assertRegex(result.messages[0].text, r"[ก-๙]")
        self.assertEqual(sorted(self.snapshot()), ["25544.json", "40908.json", "43770.json", "99999.json",
                                                   "_cache/modes.json", "_cache/state.json",
                                                   "_cache/transmitters.json"])           # ไม่มีไฟล์ชั่วคราวค้าง

    def test_cache_files_are_the_downloaded_bytes(self):
        self.update(FakeSatnogs())
        self.assertEqual((self.cache / "modes.json").read_bytes(), MODES)
        self.assertEqual((self.cache / "transmitters.json").read_bytes(), TRANSMITTERS)

    def test_user_agent_and_urls(self):
        opener = FakeSatnogs()
        self.update(opener)
        self.assertEqual(opener.urls, [MODES_URL, TRANSMITTERS_URL])                   # modes ก่อน transmitters
        for request, timeout in opener.calls:
            self.assertEqual(request.header_items(), [("User-agent", "gpredict-web")])  # ไม่มี header อื่นและไม่มีข้อมูลผู้ใช้
            self.assertIsNone(request.data)
            self.assertEqual(request.get_method(), "GET")
            self.assertEqual(timeout, 30)
        self.assertNotIn("@", "".join(opener.urls))

    def test_request_is_recorded_before_sending(self):
        seen = []
        opener = FakeSatnogs()
        opener.on_call = lambda request: seen.append((self.state(), sorted(p.name for p in self.cache.iterdir())))
        self.update(opener)
        self.assertEqual(seen[0], ({"requested_at": "2026-11-12T07:20:00Z", "succeeded_at": None}, ["state.json"]))
        self.assertEqual(self.state(), {"requested_at": "2026-11-12T07:20:00Z", "succeeded_at": "2026-11-12T07:20:00Z"})

    def test_two_hour_rule_uses_cache(self):
        opener = FakeSatnogs()
        self.update(opener)
        (self.trsp_dir / "43770.json").unlink()                 # ไฟล์หาย: แปลงจาก _cache แล้วกลับมา
        second = self.update(opener, T + timedelta(hours=1))
        self.assertEqual(len(opener.calls), 2)                  # ไม่ส่ง request
        self.assertEqual((second.cached, second.fetched_at, second.satellites), (True, T, 3))
        self.assertEqual([(m.code, m.level) for m in second.messages], [("TRSP_RATE_LIMITED_LOCAL", "info")])
        self.assertIn("2026-11-12 07:20:00 UTC", second.messages[0].text)               # เวลาที่ดึง
        self.assertIn("2026-11-12 09:20:00 UTC", second.messages[0].text)               # เวลาที่ดึงได้อีกครั้ง
        self.assertEqual(self.read_sat(43770), EXPECTED[43770])
        self.assertEqual(self.state()["requested_at"], "2026-11-12T07:20:00Z")           # cache ไม่ขยับเวลาขอ

        self.update(opener, T + timedelta(hours=2) - timedelta(seconds=1))
        self.assertEqual(len(opener.calls), 2)
        third = self.update(opener, T + timedelta(hours=2, seconds=1))
        self.assertEqual(len(opener.calls), 4)                  # ครบ 2 ชม. แล้ว: ส่ง request ใหม่
        self.assertEqual((third.cached, third.fetched_at), (False, T + timedelta(hours=2, seconds=1)))

    def test_future_request_time_does_not_block(self):
        self.cache.mkdir(parents=True)
        (self.cache / "state.json").write_text(json.dumps({"requested_at": "2030-01-01T00:00:00Z",
                                                          "succeeded_at": "2030-01-01T00:00:00Z"}), encoding="utf-8")
        opener = FakeSatnogs()
        self.assertFalse(self.update(opener).cached)            # นาฬิกาเคยถูกตั้งล้ำไปข้างหน้า: ไม่ปิดการดึงไปอีกหลายปี
        self.assertEqual(len(opener.calls), 2)

    def test_microseconds_do_not_matter(self):
        opener = FakeSatnogs()
        first = self.update(opener, T + timedelta(microseconds=900_000))
        self.assertEqual(first.fetched_at, T)                    # เก็บที่ความละเอียดวินาที
        self.assertEqual(self.update(opener, T + timedelta(hours=1)).fetched_at, T)

    def test_failure_keeps_old_files(self):
        self.update(FakeSatnogs())
        self.write_sat(25544, [item("hand edited")])
        self.write_sat(99999, [item("old")])
        before = self.snapshot()
        failing = FakeSatnogs(modes=URLError("ไม่มีเน็ตใน test"))
        later = T + timedelta(hours=3)
        with self.assertLogs(LOGGER, "WARNING") as logs:
            result = self.update(failing, later)
        self.assertEqual(len(failing.calls), 1)
        self.assertEqual((result.cached, result.fetched_at, result.satellites), (True, T, 0))
        self.assertEqual([(m.code, m.level) for m in result.messages], [("TRSP_DOWNLOAD_FAILED", "warning")])
        self.assertRegex(result.messages[0].text, r"[ก-๙]")
        self.assertIn("modes", result.messages[0].text)
        self.assertIn("2026-11-12 07:20:00 UTC", result.messages[0].text)                # ยังใช้ข้อมูลที่ดึงเมื่อ
        self.assertIn("2026-11-12 12:20:00 UTC", result.messages[0].text)                # ลองใหม่ได้เมื่อ (ขอครั้งนี้ 10:20 + 2 ชม.)
        after = self.snapshot()
        self.assertNotEqual(after.pop("_cache/state.json"), before.pop("_cache/state.json"))   # มีแต่เวลาขอที่เปลี่ยน
        self.assertEqual(after, before)                          # ไฟล์ต่อดาวและ _cache ไม่เปลี่ยนสักไบต์
        self.assertEqual(self.state(), {"requested_at": "2026-11-12T10:20:00Z", "succeeded_at": "2026-11-12T07:20:00Z"})
        self.assertEqual(logs.output[0].split(":", 2)[2],
                         f"Error fetching {MODES_URL} (connection failed: <urlopen error ไม่มีเน็ตใน test>)")
        self.assertEqual(logs.output[-1].split(":", 2)[2], "Could not fetch frequency files from network")

    def test_bad_json_keeps_old_files(self):
        self.update(FakeSatnogs())
        before = self.snapshot()
        result = self.update_logged(FakeSatnogs(transmitters=b"<html>"), T + timedelta(hours=3))
        self.assertEqual((result.cached, result.fetched_at, result.satellites), (True, T, 0))
        self.assertEqual([(m.code, m.level) for m in result.messages], [("TRSP_DOWNLOAD_FAILED", "warning")])
        self.assertRegex(result.messages[0].text, r"[ก-๙]")
        self.assertIn("transmitters", result.messages[0].text)
        after = self.snapshot()
        self.assertNotEqual(after.pop("_cache/state.json"), before.pop("_cache/state.json"))
        self.assertEqual(after, before)

    def test_unusable_replies_keep_old_files(self):
        self.update(FakeSatnogs())
        before = self.snapshot()
        before.pop("_cache/state.json")
        http_503 = HTTPError(TRANSMITTERS_URL, 503, "Service Unavailable", {}, io.BytesIO(b""))
        self.addCleanup(http_503.close)
        bad = {
            "html": b"<html><body>502</body></html>",
            "not UTF-8": b"\xff\xfe\x00",
            "JSON object": b'{"detail": "throttled"}',
            "empty list": b"[]",
            "no objects": b'[1, "a", null, [[[]]]]',
            "too deep": b"[" * 100_000 + b"]" * 100_000,
            "HTTP 503": http_503,
            "timeout": TimeoutError("timed out"),
            "reset": ConnectionResetError("reset by peer"),
            "incomplete": IncompleteRead(b"[{"),
        }
        later = T + timedelta(hours=3)
        for label, reply in bad.items():
            for which in ("modes", "transmitters"):
                with self.subTest(label=label, which=which):
                    opener = FakeSatnogs()
                    opener.replies[MODES_URL if which == "modes" else TRANSMITTERS_URL] = reply
                    result = self.update_logged(opener, later)
                    self.assertEqual([m.code for m in result.messages], ["TRSP_DOWNLOAD_FAILED"])
                    self.assertTrue(result.cached)
                    after = self.snapshot()
                    after.pop("_cache/state.json")
                    self.assertEqual(after, before)
                    later += timedelta(hours=3)

    def test_both_downloads_must_succeed_before_cache_changes(self):
        self.update(FakeSatnogs())
        before = self.snapshot()
        new_modes = json.dumps([{"id": 2, "name": "NEWFM"}]).encode()
        result = self.update_logged(FakeSatnogs(modes=new_modes, transmitters=URLError("down")), T + timedelta(hours=3))
        self.assertEqual(result.messages[0].code, "TRSP_DOWNLOAD_FAILED")
        self.assertEqual((self.cache / "modes.json").read_bytes(), MODES)                # modes ใหม่ดึงได้แต่ยังไม่ถูกใช้
        self.assertEqual(sorted(p.name for p in self.cache.iterdir()), ["modes.json", "state.json", "transmitters.json"])
        after = self.snapshot()
        self.assertNotEqual(after.pop("_cache/state.json"), before.pop("_cache/state.json"))
        self.assertEqual(after, before)

    def test_failure_without_any_old_files(self):
        result = self.update_logged(FakeSatnogs(modes=URLError("down")))
        self.assertEqual((result.cached, result.fetched_at, result.satellites), (True, None, 0))
        self.assertEqual([(m.code, m.level) for m in result.messages], [("TRSP_DOWNLOAD_FAILED", "warning")])
        self.assertEqual(sorted(self.snapshot()), ["_cache/state.json"])
        self.assertEqual(self.state(), {"requested_at": "2026-11-12T07:20:00Z", "succeeded_at": None})

    def test_failure_still_counts_for_two_hours(self):
        self.update(FakeSatnogs())
        later = T + timedelta(hours=3)
        self.update_logged(FakeSatnogs(modes=URLError("down")), later)
        opener = FakeSatnogs()
        result = self.update(opener, later + timedelta(minutes=10))
        self.assertEqual(opener.calls, [])                       # ไม่ส่ง request ใช้ cache เดิม
        self.assertEqual((result.cached, result.fetched_at, result.satellites), (True, T, 3))
        self.assertEqual([(m.code, m.level) for m in result.messages], [("TRSP_RATE_LIMITED_LOCAL", "info")])
        self.assertIn("2026-11-12 07:20:00 UTC", result.messages[0].text)                # ใช้ข้อมูลที่ดึงเมื่อ
        self.assertIn("2026-11-12 12:20:00 UTC", result.messages[0].text)                # ดึงได้อีกครั้ง = ขอครั้งก่อน + 2 ชม.
        self.update(opener, later + timedelta(hours=2, seconds=1))
        self.assertEqual(len(opener.calls), 2)

    def test_failure_still_counts_for_two_hours_without_cache(self):
        self.update_logged(FakeSatnogs(modes=URLError("down")))
        opener = FakeSatnogs()
        result = self.update(opener, T + timedelta(minutes=10))
        self.assertEqual(opener.calls, [])
        self.assertEqual((result.cached, result.fetched_at, result.satellites), (True, None, 0))
        self.assertEqual([(m.code, m.level) for m in result.messages], [("TRSP_RATE_LIMITED_LOCAL", "warning")])
        self.assertRegex(result.messages[0].text, r"[ก-๙]")

    def test_unreadable_cache_within_two_hours(self):
        self.update(FakeSatnogs())
        (self.cache / "transmitters.json").write_bytes(b"<html>")
        before = self.snapshot()
        with self.assertLogs(LOGGER, "WARNING"):
            result = self.update(FakeSatnogs(), T + timedelta(hours=1))
        self.assertEqual((result.cached, result.satellites), (True, 0))
        self.assertEqual(result.messages[0].level, "warning")
        self.assertEqual(self.snapshot(), before)                # ไม่แตะอะไร

    def test_write_failure_of_one_satellite_is_reported(self):
        (self.trsp_dir / "25544.json").mkdir(parents=True)       # เขียนทับไดเรกทอรีไม่ได้
        with self.assertLogs(LOGGER, "ERROR") as logs:
            result = self.update(FakeSatnogs())
        self.assertEqual((result.cached, result.satellites), (False, 2))
        self.assertEqual([m.code for m in result.messages], ["TRSP_UPDATED", "TRSP_WRITE_FAILED"])
        self.assertEqual(result.messages[1].level, "warning")
        self.assertEqual(self.read_sat(43770), EXPECTED[43770])
        self.assertTrue(logs.output[0].endswith("Could not open trsp file for write"))

    def test_unchanged_satellite_files_are_not_rewritten(self):
        opener = FakeSatnogs()
        self.update(opener)
        path = self.trsp_dir / "25544.json"
        before = path.stat().st_ino
        self.update(opener, T + timedelta(hours=1))
        self.assertEqual(path.stat().st_ino, before)             # แปลงจาก cache แล้วเนื้อหาเท่าเดิม: ไม่เขียนใหม่


class LoadTest(TrspTestCase):
    def test_load_missing_file(self):
        self.assertEqual(load_transponders(self.data_dir, 25544), [])
        self.assertFalse(self.trsp_dir.exists())

    def test_load_keeps_file_order_and_normalises(self):
        self.write_sat(25544, [item("B", -5, 0, 145_800_000, 0, True, "FM", 1200.0), item("A", 0, 435_000_000, 0, 0)])
        out = load_transponders(self.data_dir, 25544)
        self.assertEqual([t["name"] for t in out], ["B", "A"])
        self.assertEqual(out[0], item("B", 0, 0, 145_800_000, 145_800_000, True, "FM", 1200.0))
        self.assertEqual(out[1], item("A", 435_000_000, 435_000_000, 0, 0))

    def test_load_after_update(self):
        self.update(FakeSatnogs())
        out = load_transponders(self.data_dir, 25544)
        self.assertEqual([t["name"] for t in out], [t["name"] for t in EXPECTED[25544]])
        self.assertEqual(out[0]["up_high"], 145_990_000)         # ค่าเดียวถูกคัดลอกตอนอ่าน (ไฟล์เก็บค่าตาม SatNOGS)
        self.assertEqual(self.read_sat(25544)[0]["up_high"], 0)

    def test_load_unreadable_file(self):
        for label, content in (("not JSON", "{not json"), ("object", '{"a": 1}'), ("empty file", "")):
            with self.subTest(label):
                self.trsp_dir.mkdir(parents=True, exist_ok=True)
                (self.trsp_dir / "25544.json").write_text(content, encoding="utf-8")
                with self.assertLogs(LOGGER, "WARNING"):
                    self.assertEqual(load_transponders(self.data_dir, 25544), [])

    def test_load_skips_entries_without_a_name(self):
        self.write_sat(25544, [item("ok"), {"up_low": 1}, "x", None, {"name": ""}, item("also ok")])
        with self.assertLogs(LOGGER, "WARNING"):
            out = load_transponders(self.data_dir, 25544)
        self.assertEqual([t["name"] for t in out], ["ok", "also ok"])

    def test_load_file_with_no_transponders(self):
        self.write_sat(25544, [])
        with self.assertLogs(LOGGER, "INFO"):
            self.assertEqual(load_transponders(self.data_dir, 25544), [])


if __name__ == "__main__":
    unittest.main()
