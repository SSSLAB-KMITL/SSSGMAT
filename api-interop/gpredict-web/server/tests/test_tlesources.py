import json
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock
from urllib.error import HTTPError, URLError
from urllib.request import ProxyHandler, urlopen

from gpredict_web.prefs import PREFS, Prefs      # import gpredict_web ก่อน: __init__ ใส่ path ของ gnss_predict
from gpredict_web.satdb import SatDb
from gpredict_web import tlesources
from gpredict_web.tletext import parse_tle_text
from gpredict_web.tlesources import (
    SOURCE_MIN_INTERVAL_S, USER_AGENT, cache_dir, classify, fetch_text, make_opener, source_groups, update_from_files,
    update_from_sources,
)
from gnss_predict import omm
from gnss_predict.config import CELESTRAK_GP_URL
from tests.helpers import temp_config
from tests.test_satdb import GROUP_A, _Resp, dump
from tests.test_tletext import line1, line2, tle_text

FIXTURES = Path(__file__).resolve().parent / "fixtures"
UTC = timezone.utc
T0 = datetime(2026, 11, 12, 6, 0, tzinfo=UTC)
HOUR = timedelta(hours=1)

NASABARE_URL = "https://www.amsat.org/amsat/ftp/keps/current/nasabare.txt"
AMATEUR_URL = "https://celestrak.org/NORAD/elements/gp.php?GROUP=amateur&FORMAT=tle"
AMATEUR_OMM_URL = CELESTRAK_GP_URL.format(group="amateur")      # URL ที่ engine ส่งจริง (FORMAT=json)
# ไฟล์สังเคราะห์ในรูปแบบของ AMSAT nasabare.txt (ชุด 3 บรรทัด ชื่อไม่มีป้ายสถานะ) ไม่ได้ดาวน์โหลดมา
NASABARE = (FIXTURES / "nasabare_sample.txt").read_bytes()
NASABARE_NORADS = [22825, 24278, 27607, 39444]
AMATEUR_NORADS = sorted(r["NORAD_CAT_ID"] for r in GROUP_A)


class UrlOpener:
    """opener ปลอมตาม URL เต็ม: bytes = ตอบ 200, Exception = raise, URL ที่ไม่มีในตาราง = AssertionError (ห้ามส่งคำขอที่ไม่คาดไว้)
    จด Request และ timeout ทุกครั้ง"""

    def __init__(self, bodies: dict | None = None):
        self.bodies = dict(bodies or {})
        self.requests = []
        self.timeouts = []

    def __call__(self, request, timeout=None):
        self.requests.append(request)
        self.timeouts.append(timeout)
        if request.full_url not in self.bodies:
            raise AssertionError(f"ส่งคำขอที่ไม่คาดไว้: {request.full_url}")
        out = self.bodies[request.full_url]
        if isinstance(out, Exception):
            raise out
        return _Resp(out)

    @property
    def urls(self) -> list[str]:
        return [r.full_url for r in self.requests]


def http_error(code: int) -> HTTPError:
    return HTTPError(NASABARE_URL, code, "error", {}, None)


def newer_ao27() -> str:
    """AO-27 ชุดเดียวที่ epoch ใหม่กว่าใน fixture (26314.21543210)"""
    return tle_text("AO-27", line1("22825", "93061C  ", "26315.50000000"), line2("22825"))


class ClassifyTest(unittest.TestCase):
    def test_classify(self):
        self.assertEqual(classify("https://celestrak.org/NORAD/elements/gp.php?GROUP=gps-ops&FORMAT=tlet"), ("celestrak", "gps-ops"))
        self.assertEqual(classify("https://www.amsat.org/amsat/ftp/keps/current/nasabare.txt"), ("text", "nasabare"))
        self.assertEqual(classify("http://www.CelesTrak.org/NORAD/elements/gp.php?FORMAT=tle&GROUP=iridium-NEXT"),
                         ("celestrak", "iridium-NEXT"))
        # ไม่ใช่กลุ่มของ CelesTrak: ดึงเป็นข้อความ (1 ครั้งต่อ URL ต่อ 2 ชม.) กลุ่มคือชื่อไฟล์ใน path ไม่รวมนามสกุล
        self.assertEqual(classify("https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=tle"), ("text", "gp"))
        self.assertEqual(classify("https://celestrak.org/NORAD/elements/supplemental/starlink.txt"), ("text", "starlink"))
        self.assertEqual(classify("https://celestrak.org/NORAD/elements/bad%20name.txt"), ("text", "bad name"))
        self.assertEqual(classify("https://example.org/NORAD/elements/gp.php?GROUP=amateur"), ("text", "gp"))
        self.assertEqual(classify("https://example.org/NORAD/elements/amateur.txt"), ("text", "amateur"))
        self.assertEqual(classify("http://server.com/file.txt"), ("text", "file"))
        self.assertEqual(classify("http://server.com/keps/my%20sats.tle?x=1"), ("text", "my sats"))
        self.assertEqual(classify("http://server.com/"), ("text", "server.com"))      # ไม่มีชื่อไฟล์: ใช้ชื่อเครื่อง

    def test_celestrak_com_and_legacy_shapes_share_the_group_limit(self):
        """celestrak.com (ที่ Gpredict รุ่นเก่าตั้งไว้และ redirect ไป .org), ไฟล์ /NORAD/elements/<group>.txt แบบเดิม และ group= ตัวเล็ก
        เป็นกลุ่มของ CelesTrak: ใช้กติกา 1 ครั้งต่อกลุ่มต่อ 2 ชม. ที่นับร่วมกับ GNSS Studio ไม่ใช่กติกาต่อ URL (final review server minor 3)"""
        for url, group in (("https://celestrak.com/NORAD/elements/gp.php?GROUP=amateur&FORMAT=tle", "amateur"),
                           ("http://www.celestrak.com/NORAD/elements/gp.php?GROUP=weather", "weather"),
                           ("https://celestrak.org/NORAD/elements/gp.php?group=gps-ops&FORMAT=tle", "gps-ops"),
                           ("http://www.celestrak.com/NORAD/elements/amateur.txt", "amateur"),
                           ("https://celestrak.org/NORAD/elements/iridium-NEXT.txt", "iridium-NEXT"),
                           ("https://CELESTRAK.COM/norad/elements/noaa.txt", "noaa")):
            with self.subTest(url=url):
                self.assertEqual(classify(url), ("celestrak", group))

    def test_source_groups_in_url_order_without_repeats(self):
        urls = [NASABARE_URL, AMATEUR_URL, AMATEUR_OMM_URL, "https://mirror.example/nasabare.txt",
                "https://celestrak.org/NORAD/elements/gp.php?GROUP=weather&FORMAT=tle"]
        self.assertEqual(source_groups(urls), ["nasabare", "amateur", "weather"])
        self.assertEqual(source_groups([]), [])


class MakeOpenerTest(unittest.TestCase):
    def test_make_opener(self):
        self.assertIs(make_opener(""), urlopen)
        opener = make_opener("http://my.proxy.com:3128")
        proxies = [h.proxies for h in opener.__self__.handlers if isinstance(h, ProxyHandler)]
        self.assertEqual(proxies, [{"http": "http://my.proxy.com:3128", "https": "http://my.proxy.com:3128"}])


class FetchTextTest(unittest.TestCase):
    def setUp(self):
        self.cfg = temp_config(self)
        self.cache = cache_dir(self.cfg)

    def state(self) -> dict:
        return omm.read_state(self.cache / "state.json")

    def test_cache_dir(self):
        self.assertEqual(cache_dir(self.cfg), self.cfg.data_dir / "tle" / "_cache")
        self.assertEqual(SOURCE_MIN_INTERVAL_S, 7200)

    def test_text_source_rate_limited_per_url(self):
        other = "https://mirror.example/keps/nasabare.txt"
        opener = UrlOpener({NASABARE_URL: NASABARE, other: NASABARE})
        path, messages = fetch_text(NASABARE_URL, self.cache, T0, opener)
        self.assertEqual((opener.urls, messages), ([NASABARE_URL], []))
        self.assertEqual(path.parent, self.cache)
        self.assertRegex(path.name, r"^[0-9a-f]{12}\.txt$")
        self.assertEqual(path.read_bytes(), NASABARE)
        self.assertEqual(self.state(), {NASABARE_URL: {"last_request": "2026-11-12T06:00:00Z",
                                                       "last_success": "2026-11-12T06:00:00Z"}})

        # อีก 1 ชม.: ไม่ส่งคำขอ ได้ไฟล์เดิมพร้อมข้อความ info
        again, messages = fetch_text(NASABARE_URL, self.cache, T0 + HOUR, opener)
        self.assertEqual((again, opener.urls), (path, [NASABARE_URL]))
        self.assertEqual([(m.code, m.level, m.object) for m in messages], [("ORBIT_RATE_LIMITED_LOCAL", "info", NASABARE_URL)])
        self.assertIn(NASABARE_URL, messages[0].text)
        self.assertRegex(messages[0].text, r"[ก-๙]")

        # กติกานับต่อ URL: URL อื่นส่งได้ และได้ไฟล์ cache ของตัวเอง
        other_path, messages = fetch_text(other, self.cache, T0 + HOUR, opener)
        self.assertEqual((opener.urls[-1], messages), (other, []))
        self.assertNotEqual(other_path, path)

        # ครบ 2 ชม. จากคำขอครั้งก่อน: ส่งได้อีก
        fetch_text(NASABARE_URL, self.cache, T0 + timedelta(seconds=SOURCE_MIN_INTERVAL_S), opener)
        self.assertEqual(opener.urls, [NASABARE_URL, other, NASABARE_URL])

    def test_text_source_user_agent(self):
        opener = UrlOpener({NASABARE_URL: NASABARE})
        fetch_text(NASABARE_URL, self.cache, T0, opener)
        (request,) = opener.requests
        self.assertEqual(USER_AGENT, "gpredict-web")
        self.assertEqual(request.header_items(), [("User-agent", "gpredict-web")])        # ไม่ส่งข้อมูลอื่นของผู้ใช้
        self.assertEqual((request.get_method(), request.data, opener.timeouts), ("GET", None, [30]))

    def test_garbage_or_http_error_records_request_and_keeps_cache(self):
        # ไม่มี cache: คำตอบที่ไม่มี TLE ใช้ได้ -> ไม่มีไฟล์, เตือน, บันทึกเวลาขอ (server ได้รับคำขอแล้ว)
        opener = UrlOpener({NASABARE_URL: b"<html>Not Found</html>"})
        path, messages = fetch_text(NASABARE_URL, self.cache, T0, opener)
        self.assertIsNone(path)
        self.assertEqual([(m.code, m.level) for m in messages], [("ORBIT_DOWNLOAD_FAILED", "warning")])
        self.assertEqual(self.state(), {NASABARE_URL: {"last_request": "2026-11-12T06:00:00Z"}})
        self.assertEqual(list(self.cache.glob("*.txt")), [])

        # สำเร็จ แล้วได้ขยะ: ไฟล์เดิมไม่ถูกทับ ใช้ไฟล์เดิมพร้อมคำเตือน และนับเป็นคำขอ (กติกา 2 ชม. นับคำขอที่ล้มด้วย)
        opener.bodies[NASABARE_URL] = NASABARE
        t1 = T0 + 2 * HOUR
        good, _ = fetch_text(NASABARE_URL, self.cache, t1, opener)
        opener.bodies[NASABARE_URL] = "ไม่ใช่ TLE".encode("utf-8")
        t2 = t1 + 2 * HOUR
        path, messages = fetch_text(NASABARE_URL, self.cache, t2, opener)
        self.assertEqual((path, path.read_bytes()), (good, NASABARE))
        self.assertEqual([(m.code, m.level) for m in messages], [("ORBIT_DOWNLOAD_FAILED", "warning")])
        self.assertEqual(self.state()[NASABARE_URL], {"last_request": "2026-11-12T10:00:00Z",
                                                      "last_success": "2026-11-12T08:00:00Z"})
        n = len(opener.requests)
        fetch_text(NASABARE_URL, self.cache, t2 + HOUR, opener)
        self.assertEqual(len(opener.requests), n)                                        # ยังไม่ครบ 2 ชม.

        # HTTP error ก็นับเป็นคำขอ
        opener.bodies[NASABARE_URL] = http_error(503)
        t3 = t2 + 2 * HOUR
        path, messages = fetch_text(NASABARE_URL, self.cache, t3, opener)
        self.assertEqual(path, good)
        self.assertIn("HTTP 503", messages[0].text)
        self.assertEqual(self.state()[NASABARE_URL]["last_request"], "2026-11-12T12:00:00Z")

    def test_request_is_recorded_before_the_cache_write(self):
        """คำขอที่ถึง server นับ 2 ชม. ทันทีที่ได้คำตอบ ก่อนเขียนไฟล์ cache: ดิสก์เต็มตอนเขียนไม่ทำให้ขอซ้ำก่อนครบ (final review minor 2)"""
        opener = UrlOpener({NASABARE_URL: NASABARE})
        real = tlesources._write_bytes_atomic

        def full_disk(path, data):
            if path.suffix == ".txt":
                raise OSError(28, "No space left on device")
            real(path, data)

        with mock.patch.object(tlesources, "_write_bytes_atomic", full_disk):
            path, messages = fetch_text(NASABARE_URL, self.cache, T0, opener)
        self.assertIsNone(path)
        self.assertEqual([(m.code, m.level) for m in messages], [("ORBIT_DOWNLOAD_FAILED", "warning")])
        self.assertIn("No space left on device", messages[0].text)
        self.assertEqual(self.state(), {NASABARE_URL: {"last_request": "2026-11-12T06:00:00Z"}})
        fetch_text(NASABARE_URL, self.cache, T0 + HOUR, opener)                          # ยังไม่ครบ 2 ชม.: ไม่ขอซ้ำ
        self.assertEqual(len(opener.requests), 1)

    def test_unreachable_server_is_not_recorded(self):
        opener = UrlOpener({NASABARE_URL: URLError("ต่อไม่ได้")})
        path, messages = fetch_text(NASABARE_URL, self.cache, T0, opener)
        self.assertIsNone(path)
        self.assertEqual([(m.code, m.level, m.object) for m in messages], [("ORBIT_DOWNLOAD_FAILED", "warning", NASABARE_URL)])
        self.assertEqual(self.state(), {})
        fetch_text(NASABARE_URL, self.cache, T0 + timedelta(minutes=1), opener)             # ไม่ติดกติกา 2 ชม.
        self.assertEqual(len(opener.requests), 2)


class UpdateFromSourcesTest(unittest.TestCase):
    def setUp(self):
        self.cfg = temp_config(self)
        self.db = SatDb(self.cfg.data_dir / "satdb.json")
        self.prefs = Prefs(self.cfg.data_dir)

    def run_update(self, opener, now=T0, urls=(NASABARE_URL,), **prefs):
        self.prefs.update({"TLE/URLS": list(urls), **prefs}, [])
        return update_from_sources(self.db, self.cfg, self.prefs, now, opener_factory=lambda proxy: opener)

    def test_nasabare_group(self):
        res = self.run_update(UrlOpener({NASABARE_URL: NASABARE}))
        self.assertEqual((res.updated, res.skipped, res.missing, res.new, res.messages), (0, 0, 0, 4, []))
        self.assertEqual((res.add_new, res.aborted), (True, None))
        self.assertEqual(sorted(self.db.norads()), NASABARE_NORADS)
        self.assertEqual(self.db.groups(), ["nasabare"])
        self.assertEqual(self.db.get(24278).name, "FO-29")
        self.assertEqual(sorted(SatDb(self.db.path).norads()), NASABARE_NORADS)          # บันทึกลงดิสก์แล้ว

    def test_add_new_follows_prefs(self):
        res = self.run_update(UrlOpener({NASABARE_URL: NASABARE}), **{"TLE/ADD_NEW_SATS": False})
        self.assertEqual((res.new, res.add_new, len(self.db)), (0, False, 0))

    def test_proxy_used_for_all_sources(self):
        opener = UrlOpener({NASABARE_URL: NASABARE, AMATEUR_OMM_URL: dump(GROUP_A)})
        proxies = []

        def factory(proxy):
            proxies.append(proxy)
            return opener

        self.prefs.update({"TLE/URLS": [NASABARE_URL, AMATEUR_URL], "TLE/PROXY": "http://my.proxy.com:3128"}, [])
        res = update_from_sources(self.db, self.cfg, self.prefs, T0, opener_factory=factory)
        self.assertEqual(proxies, ["http://my.proxy.com:3128"])
        self.assertEqual(opener.urls, [NASABARE_URL, AMATEUR_OMM_URL])                 # opener เดียวกันกับทั้งสองแบบ
        self.assertEqual(res.new, len(NASABARE_NORADS) + len(AMATEUR_NORADS))
        self.assertEqual(self.db.groups(), ["amateur", "nasabare"])
        self.assertEqual(sorted(n for n in self.db.norads() if "amateur" in self.db.get(n).groups), AMATEUR_NORADS)
        self.assertIn("amateur", omm.read_state(self.cfg.state_file))                   # state ของ engine ที่ใช้ร่วมกับ GNSS Studio

    def test_celestrak_com_url_follows_the_group_limit_shared_with_gnss_studio(self):
        """GNSS Studio ขอกลุ่ม amateur ไปเมื่อ 30 นาทีก่อน: URL แบบ celestrak.com ของกลุ่มเดียวกันไม่ส่งคำขอ (ใช้ไฟล์ของ engine)"""
        self.cfg.state_file.parent.mkdir(parents=True, exist_ok=True)
        self.cfg.state_file.write_text(json.dumps({"amateur": {"last_request": "2026-11-12T05:30:00Z"}}), encoding="utf-8")
        opener = UrlOpener({})                                                          # คำขอใดๆ = AssertionError
        res = self.run_update(opener, urls=["http://www.celestrak.com/NORAD/elements/amateur.txt"])
        self.assertEqual(opener.urls, [])
        self.assertEqual([(m.code, m.object) for m in res.messages], [("ORBIT_DOWNLOAD_FAILED", "amateur")])

    def test_same_celestrak_group_or_url_fetched_once(self):
        opener = UrlOpener({NASABARE_URL: NASABARE, AMATEUR_OMM_URL: dump(GROUP_A)})
        res = self.run_update(opener, urls=[AMATEUR_URL, NASABARE_URL, AMATEUR_OMM_URL, NASABARE_URL])
        self.assertEqual(opener.urls, [AMATEUR_OMM_URL, NASABARE_URL])
        self.assertEqual(res.messages, [])

    def test_source_failure_keeps_old_tles(self):
        self.db.apply_sets({"nasabare": parse_tle_text(NASABARE.decode())}, T0 - 3 * HOUR, True)
        self.db.save()
        saved_bytes = self.db.path.read_bytes()
        before = {n: self.db.get(n) for n in self.db.norads()}
        opener = UrlOpener({NASABARE_URL: URLError("proxy ผิด"), AMATEUR_OMM_URL: URLError("proxy ผิด")})
        res = self.run_update(opener, urls=[NASABARE_URL, AMATEUR_URL])
        self.assertEqual(opener.urls, [NASABARE_URL, AMATEUR_OMM_URL])
        self.assertEqual({n: self.db.get(n) for n in self.db.norads()}, before)          # ดาวเดิมอยู่ครบ ไม่เปลี่ยน
        self.assertEqual(self.db.path.read_bytes(), saved_bytes)                       # ไม่รวมและไม่บันทึกเลย
        # ไม่มี source ใดให้ข้อมูล: หยุดก่อนรวม TLE แบบ Gpredict (tle-update.c:647-665) ตัวนับเป็นศูนย์ทั้งหมด
        self.assertEqual((res.updated, res.skipped, res.missing, res.new, res.add_new), (0, 0, 0, 0, False))
        self.assertEqual(res.aborted, "Could not fetch TLE files from network. Aborting.")
        self.assertEqual([(m.code, m.level) for m in res.messages], [("ORBIT_DOWNLOAD_FAILED", "warning")] * 2)
        self.assertEqual([m.object for m in res.messages], [NASABARE_URL, "amateur"])
        # ต่อไม่ถึง server: ไม่บันทึกเวลาขอ (ทั้งของเราและของ engine) ครั้งหน้าลองใหม่ได้
        self.assertEqual(omm.read_state(cache_dir(self.cfg) / "state.json"), {})
        self.assertEqual(omm.read_state(self.cfg.state_file), {})
        self.assertEqual(self.prefs.get("TLE/LAST_UPDATE"), 0)

    def test_no_urls_aborts_like_gpredict(self):
        """TLE/URLS ว่าง (Preferences รับ 1–50 URL จึงเกิดได้เฉพาะค่าที่ไม่ผ่านการตรวจ): ไม่ส่งคำขอ ไม่แตะดัชนี (tle-update.c:523-533)"""
        class NoUrls:
            def get(self, key):
                return [] if key == "TLE/URLS" else PREFS[key].default

        self.db.apply_sets({"nasabare": parse_tle_text(NASABARE.decode())}, T0, True)
        res = update_from_sources(self.db, self.cfg, NoUrls(), T0, opener_factory=self.no_opener)
        self.assertEqual((res.updated, res.skipped, res.missing, res.new, res.messages), (0, 0, 0, 0, []))
        self.assertEqual(res.aborted, "No files to fetch from network.")
        self.assertEqual(len(self.db), len(NASABARE_NORADS))
        self.assertFalse(self.db.path.exists())

    def no_opener(self, proxy):
        raise AssertionError("ไม่ควรสร้าง opener")

    def test_last_update_only_when_changed(self):
        opener = UrlOpener({NASABARE_URL: NASABARE})
        res = self.run_update(opener)
        self.assertEqual(res.new, 4)
        self.assertEqual(self.prefs.get("TLE/LAST_UPDATE"), int(T0.timestamp()))

        # ไม่มีอะไรใหม่ (ข้อมูลชุดเดิม): ไม่เปลี่ยน
        res = self.run_update(opener, now=T0 + 3 * HOUR)
        self.assertEqual((res.updated, res.skipped, res.missing, res.new), (0, 4, 0, 0))
        self.assertEqual(self.prefs.get("TLE/LAST_UPDATE"), int(T0.timestamp()))

        # มีดวงที่ updated: บันทึกเวลานี้ สมาชิกกลุ่มตามไฟล์ล่าสุด ดวงที่หายไปจาก source ยังอยู่ในดัชนี
        opener.bodies[NASABARE_URL] = newer_ao27().encode()
        t = T0 + 6 * HOUR
        res = self.run_update(opener, now=t)
        self.assertEqual((res.updated, res.skipped, res.missing, res.new), (1, 0, 3, 0))
        self.assertEqual(self.prefs.get("TLE/LAST_UPDATE"), int(t.timestamp()))
        self.assertEqual(sorted(self.db.norads()), NASABARE_NORADS)
        self.assertEqual([n for n in NASABARE_NORADS if self.db.get(n).groups], [22825])


class UpdateFromFilesTest(unittest.TestCase):
    def setUp(self):
        self.cfg = temp_config(self)
        self.db = SatDb(self.cfg.data_dir / "satdb.json")
        self.prefs = Prefs(self.cfg.data_dir)

    def sat(self, norad: int, name: str) -> str:
        return tle_text(name, line1(str(norad)), line2(str(norad)))

    def test_update_from_files_filters_and_groups(self):
        # กลุ่ม "a" มีอยู่แล้ว (สมาชิก 11) และกลุ่ม "z" ที่ไม่มีไฟล์
        self.db.apply_sets({"a": parse_tle_text(self.sat(11, "OLD-A")), "z": parse_tle_text(self.sat(12, "Z"))}, T0 - HOUR, True)
        files = [("a.TLE", self.sat(1, "ONE")), ("b.txt", self.sat(2, "TWO") + self.sat(3, "THREE")),
                 ("c.json", self.sat(4, "FOUR")), ("sub/d.tle", self.sat(5, "FIVE")), ("e.tle.bak", self.sat(6, "SIX"))]
        res = update_from_files(self.db, self.prefs, files, T0)
        self.assertEqual((res.updated, res.skipped, res.missing, res.new, res.messages), (0, 0, 2, 3, []))
        self.assertEqual(sorted(self.db.norads()), [1, 2, 3, 11, 12])                    # อ่านเฉพาะ a และ b
        self.assertEqual({n: self.db.get(n).groups for n in (1, 2, 3, 11, 12)},
                         {1: ["a"], 2: ["b"], 3: ["b"], 11: [], 12: ["z"]})              # กลุ่ม a ถูกแทนด้วยดาวในไฟล์
        self.assertEqual(sorted(SatDb(self.db.path).norads()), [1, 2, 3, 11, 12])        # บันทึกลงดิสก์แล้ว
        self.assertEqual(self.prefs.get("TLE/LAST_UPDATE"), int(T0.timestamp()))

    def test_group_name_before_first_dot_and_files_of_one_group_merge(self):
        files = [("amateur.2026.txt", self.sat(1, "ONE")), ("amateur.tle", self.sat(2, "TWO"))]
        update_from_files(self.db, self.prefs, files, T0)
        self.assertEqual(self.db.groups(), ["amateur"])
        self.assertEqual(sorted(self.db.norads()), [1, 2])

    def test_file_without_tle_warns(self):
        self.db.apply_sets({"empty": parse_tle_text(self.sat(11, "KEEP"))}, T0 - HOUR, True)
        files = [("empty.txt", "ไม่มี TLE\n1 2 3\n"), ("ok.tle", self.sat(1, "ONE"))]
        res = update_from_files(self.db, self.prefs, files, T0)
        self.assertEqual([(m.code, m.level, m.object) for m in res.messages], [("TLE_FILE_INVALID", "warning", "empty.txt")])
        self.assertIn("empty.txt", res.messages[0].text)
        self.assertRegex(res.messages[0].text, r"[ก-๙]")
        self.assertEqual(self.db.get(11).groups, ["empty"])              # ไฟล์ที่ไม่มี TLE ใช้ได้ไม่ทำให้กลุ่มว่าง
        self.assertEqual((res.missing, res.new), (1, 1))

    def test_add_new_follows_prefs_and_nothing_new_keeps_last_update(self):
        self.prefs.update({"TLE/ADD_NEW_SATS": False}, [])
        res = update_from_files(self.db, self.prefs, [("a.tle", self.sat(1, "ONE"))], T0)
        self.assertEqual((res.new, len(self.db)), (0, 0))
        self.assertEqual(self.prefs.get("TLE/LAST_UPDATE"), 0)


if __name__ == "__main__":
    unittest.main()
