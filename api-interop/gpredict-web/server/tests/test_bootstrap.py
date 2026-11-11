"""การเปิด server ครั้งแรก (หัวข้อ 7.1 ของ spec): THBK เป็นสถานีตั้งต้น แล้ว module Amateur จากกลุ่ม amateur
opener ปลอมเสมอ (ห้ามใช้เน็ต) และทุก path อยู่ใน temp dir"""

import copy
import json
import random
import unittest
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import URLError

from gpredict_web.bootstrap import AMATEUR_GROUP, AMATEUR_MODULE, THBK_NAME, bootstrap
from gpredict_web.config import MAX_SATS
from gpredict_web.module import module_from_dict
from gpredict_web.satdb import SatDb, update_from_network
from gpredict_web.store import Qth, Store
from gnss_predict import config as engine_config
from gnss_predict.errors import Message
from tests.helpers import temp_config

UTC = timezone.utc
T0 = datetime(2026, 11, 11, 6, 0, tzinfo=UTC)
OMM_SAMPLE = Path(__file__).resolve().parents[3] / "gnss-predict" / "tests" / "fixtures" / "studio" / "omm_sample.json"
SAMPLE = json.loads(OMM_SAMPLE.read_text(encoding="utf-8"))


def many_omm(n: int, seed: int = 7) -> list[dict]:
    """OMM n ดวงจากดวงแรกของไฟล์ตัวอย่าง ชื่อ AMSAT-000 ... เรียงแบบสุ่ม (ทดสอบว่าตัดตามลำดับชื่อ ไม่ใช่ลำดับในไฟล์)"""
    out = []
    for i in range(n):
        r = copy.deepcopy(SAMPLE[0])
        r["NORAD_CAT_ID"] = 90000 + (i * 37) % n          # NORAD ไม่ได้เรียงตามชื่อ
        r["OBJECT_NAME"] = f"AMSAT-{i:03d}"
        r["OBJECT_ID"] = f"2026-{i + 1:03d}A"
        out.append(r)
    random.Random(seed).shuffle(out)
    return out


class _Resp:
    def __init__(self, body: bytes):
        self._body = body

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class FakeOpener:
    """opener ปลอม: ส่ง bytes (ตอบ 200) หรือ Exception (raise) ตามลำดับ เรียกเกินที่เตรียมไว้คือ test พัง"""

    def __init__(self, *outcomes):
        self.outcomes = list(outcomes)
        self.urls: list[str] = []

    def __call__(self, request, timeout=None):
        self.urls.append(request.full_url)
        if not self.outcomes:
            raise AssertionError(f"opener ถูกเรียกเกินที่คาดไว้: {request.full_url}")
        out = self.outcomes.pop(0)
        if isinstance(out, Exception):
            raise out
        return _Resp(out)


def tree(root: Path) -> dict[str, bytes]:
    return {str(p.relative_to(root)): p.read_bytes() for p in sorted(root.rglob("*")) if p.is_file()}


class BootstrapTest(unittest.TestCase):
    def setUp(self):
        self.cfg = temp_config(self)
        self.store = Store(self.cfg.data_dir)
        self.satdb = SatDb(self.cfg.data_dir / "satdb.json")

    def run_bootstrap(self, opener) -> list[Message]:
        return bootstrap(self.store, self.satdb, self.cfg, T0, opener)

    def assert_thbk_default(self):
        self.assertEqual(self.store.qth_names(), [THBK_NAME])
        self.assertEqual(self.store.default_qth(), THBK_NAME)
        q = self.store.get_qth(THBK_NAME)
        self.assertEqual((q.lat_deg, q.lon_deg, q.alt_m),
                         (engine_config.THBK_LAT_DEG, engine_config.THBK_LON_DEG, engine_config.THBK_HEIGHT_M))

    def test_bootstrap_offline_creates_qth_only(self):
        opener = FakeOpener(URLError("ไม่มีเน็ต"))
        msgs = self.run_bootstrap(opener)
        self.assert_thbk_default()
        self.assertEqual(self.store.list_modules(), [])
        self.assertEqual(self.store.session(), [])
        self.assertEqual(len(opener.urls), 1)
        self.assertIn(f"GROUP={AMATEUR_GROUP}", opener.urls[0])               # ดึงเฉพาะกลุ่ม amateur
        self.assertTrue(all(isinstance(m, Message) for m in msgs))
        codes = [m.code for m in msgs]
        self.assertIn("ORBIT_DOWNLOAD_FAILED", codes)
        need = [m for m in msgs if m.code == "TLE_UPDATE_NEEDED"]
        self.assertEqual(len(need), 1)
        self.assertEqual(need[0].level, "warning")
        self.assertIn("Edit → Update TLE data from network", need[0].text)
        self.assertRegex(need[0].text, r"[ก-๙]")                                 # ข้อความภาษาไทย

    def test_bootstrap_creates_amateur(self):
        opener = FakeOpener(json.dumps(SAMPLE).encode("utf-8"))
        msgs = self.run_bootstrap(opener)
        self.assert_thbk_default()
        self.assertEqual(self.store.list_modules(), [AMATEUR_MODULE])
        m = self.store.get_module(AMATEUR_MODULE)
        self.assertIsNone(m.qth)                                                 # "** DEFAULT **"
        by_name = sorted(SAMPLE, key=lambda r: (r["OBJECT_NAME"].casefold(), r["NORAD_CAT_ID"]))
        self.assertEqual(m.satellites, [r["NORAD_CAT_ID"] for r in by_name])
        self.assertEqual(self.store.session(), [AMATEUR_MODULE])                 # เปิดอยู่
        self.assertEqual([m.code for m in msgs if m.level != "info"], [])
        self.assertEqual(len(self.satdb), len(SAMPLE))
        self.assertTrue((self.cfg.data_dir / "satdb.json").is_file())

    def test_bootstrap_caps_at_max_sats(self):
        records = many_omm(MAX_SATS + 5)
        msgs = self.run_bootstrap(FakeOpener(json.dumps(records).encode("utf-8")))
        m = self.store.get_module(AMATEUR_MODULE)
        by_name = sorted(records, key=lambda r: r["OBJECT_NAME"])
        self.assertEqual(m.satellites, [r["NORAD_CAT_ID"] for r in by_name[:MAX_SATS]])
        warn = [x for x in msgs if x.code == "MODULE_TOO_MANY_SATS"]
        self.assertEqual(len(warn), 1)
        self.assertEqual((warn[0].level, warn[0].object), ("warning", AMATEUR_MODULE))
        self.assertIn(str(MAX_SATS + 5), warn[0].text)
        self.assertIn(str(MAX_SATS), warn[0].text)
        self.assertRegex(warn[0].text, r"[ก-๙]")

    def test_bootstrap_runs_once(self):
        self.run_bootstrap(FakeOpener(json.dumps(SAMPLE).encode("utf-8")))
        before = tree(self.cfg.data_dir)
        msgs = self.run_bootstrap(FakeOpener())                                  # เรียก opener = test พัง
        self.assertEqual(msgs, [])
        self.assertEqual(tree(self.cfg.data_dir), before)

    def test_flag_is_set_once_amateur_is_created(self):
        self.assertFalse(self.store.bootstrap_done())
        self.run_bootstrap(FakeOpener(json.dumps(SAMPLE).encode("utf-8")))
        self.assertTrue(self.store.bootstrap_done())
        settings = json.loads((self.cfg.data_dir / "settings.json").read_text(encoding="utf-8"))
        self.assertIs(settings["bootstrap_done"], True)
        self.assertEqual(settings["default_qth"], THBK_NAME)                     # ไม่ทับตัวชี้สถานีตั้งต้น

    def test_deleting_every_module_keeps_the_empty_state(self):
        """ผู้ใช้ลบ module หมด: เริ่มใหม่ไม่สร้าง Amateur กลับมาและไม่ส่ง request (opener ที่ถูกเรียกคือ test พัง)"""
        self.run_bootstrap(FakeOpener(json.dumps(SAMPLE).encode("utf-8")))
        self.store.delete_module(AMATEUR_MODULE)
        before = tree(self.cfg.data_dir)
        opener = FakeOpener()
        self.assertEqual(self.run_bootstrap(opener), [])
        self.assertEqual(opener.urls, [])
        self.assertEqual(self.store.list_modules(), [])
        self.assertEqual(self.store.session(), [])
        self.assertEqual(tree(self.cfg.data_dir), before)

    def test_offline_first_start_leaves_flag_unset_so_a_later_online_start_creates_amateur(self):
        self.run_bootstrap(FakeOpener(URLError("ไม่มีเน็ต")))
        self.assertFalse(self.store.bootstrap_done())
        self.assertEqual(self.store.list_modules(), [])
        msgs = self.run_bootstrap(FakeOpener(json.dumps(SAMPLE).encode("utf-8")))
        self.assertEqual(self.store.list_modules(), [AMATEUR_MODULE])
        self.assertTrue(self.store.bootstrap_done())
        self.assertEqual([m.code for m in msgs if m.level != "info"], [])

    def test_existing_modules_do_not_set_the_flag(self):
        """มี module อยู่แล้ว (ผู้ใช้สร้างเองตอนออฟไลน์): ไม่ส่ง request และไม่ตั้งธง ลบหมดแล้วเริ่มใหม่ออนไลน์ยังได้ Amateur"""
        self.run_bootstrap(FakeOpener(URLError("ไม่มีเน็ต")))
        self.store.put_module(module_from_dict({"name": "Mine", "qth": None, "satellites": [25544]}, None, None))
        self.assertEqual(self.run_bootstrap(FakeOpener()), [])
        self.assertFalse(self.store.bootstrap_done())

    def test_existing_qth_is_kept_and_amateur_still_created(self):
        self.store.put_qth(Qth(name="HOME", lat_deg=1.0, lon_deg=2.0))
        self.store.set_default_qth("HOME")
        self.run_bootstrap(FakeOpener(json.dumps(SAMPLE).encode("utf-8")))
        self.assertEqual(self.store.qth_names(), ["HOME"])
        self.assertEqual(self.store.default_qth(), "HOME")
        self.assertEqual(self.store.list_modules(), [AMATEUR_MODULE])

    def test_missing_default_points_at_first_station(self):
        self.store.put_qth(Qth(name="Zulu"))
        self.store.put_qth(Qth(name="HOME"))
        self.assertIsNone(self.store.default_qth())
        self.run_bootstrap(FakeOpener(URLError("ไม่มีเน็ต")))
        self.assertEqual(self.store.default_qth(), "HOME")                     # module "** DEFAULT **" จึงเปิดได้
        self.assertEqual(self.store.qth_names(), ["HOME", "Zulu"])

    def test_offline_uses_satellites_already_in_the_index(self):
        update_from_network(self.satdb, self.cfg, T0, groups=(AMATEUR_GROUP,),     # Update TLE ไว้แล้วแต่ยังไม่เคยมี module
                            opener=FakeOpener(json.dumps(SAMPLE).encode("utf-8")))
        self.assertEqual(self.store.list_modules(), [])
        self.assertFalse(self.store.bootstrap_done())
        for p in self.cfg.omm_cache_dir.glob("*.json"):
            if p.name != self.cfg.state_file.name:
                p.unlink()
        self.cfg.state_file.unlink()                                             # ไม่ติดกติกา 2 ชม. จึงส่ง request (ล้ม)
        msgs = self.run_bootstrap(FakeOpener(URLError("ไม่มีเน็ต")))
        self.assertEqual(self.store.list_modules(), [AMATEUR_MODULE])
        self.assertEqual(len(self.store.get_module(AMATEUR_MODULE).satellites), len(SAMPLE))
        self.assertNotIn("TLE_UPDATE_NEEDED", [m.code for m in msgs])


if __name__ == "__main__":
    unittest.main()
