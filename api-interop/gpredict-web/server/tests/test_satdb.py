import copy
import json
import shutil
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.error import URLError

from gpredict_web.config import TLE_GROUPS      # import gpredict_web ก่อน: __init__ ใส่ path ของ gnss_predict
from gpredict_web.satdb import SatDb, gmat_name, update_from_network
from gnss_predict import omm
from gnss_predict.config import CELESTRAK_MIN_INTERVAL_S
from tests.helpers import temp_config

OMM_SAMPLE = Path(__file__).resolve().parents[3] / "gnss-predict" / "tests" / "fixtures" / "studio" / "omm_sample.json"
UTC = timezone.utc
T0 = datetime(2026, 11, 11, 6, 0, tzinfo=UTC)

SAMPLE = json.loads(OMM_SAMPLE.read_text(encoding="utf-8"))
NORADS = [r["NORAD_CAT_ID"] for r in SAMPLE]
# ลำดับในไฟล์ตัวอย่าง: GPS 62339, GPS 26407, GSAT 37846, GSAT 40129, COSMOS 43508, BEIDOU 56564, 44542, 41434, 36828, COSMOS 100744
GROUP_A = SAMPLE[:6]                    # 62339 26407 37846 40129 43508 56564
GROUP_B = SAMPLE[4:]                    # 43508 56564 44542 41434 36828 100744  (ซ้อนกับ A สองดวง)


def with_epoch(records: list[dict], norad: int, epoch: str) -> list[dict]:
    out = copy.deepcopy(records)
    for r in out:
        if r["NORAD_CAT_ID"] == norad:
            r["EPOCH"] = epoch
    return out


def dump(records: list[dict]) -> bytes:
    return json.dumps(records).encode("utf-8")


class _Resp:
    def __init__(self, body):
        self._body = body

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class FakeOpener:
    """opener ปลอมแบบเดียวกับ gnss-predict/tests/test_omm.py: bytes = ตอบ 200, Exception = raise, นับจำนวนครั้งที่ถูกเรียก"""

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


class SatDbTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="gpredict_web_satdb_"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.db = SatDb(self.tmp / "data" / "satdb.json")

    def write(self, name: str, records: list[dict]) -> Path:
        path = self.tmp / "files" / f"{name}.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(dump(records))
        return path

    def files(self, a=None, b=None) -> dict[str, Path]:
        return {"gps-ops": self.write("gps-ops", GROUP_A if a is None else a),
                "galileo": self.write("galileo", GROUP_B if b is None else b)}


class TestGmatName(unittest.TestCase):
    def test_gmat_name(self):
        self.assertEqual(gmat_name(25544), "S25544")
        self.assertEqual(gmat_name(5), "S00005")
        self.assertEqual(gmat_name(100744), "SA0744")


class TestApplyGroups(SatDbTestCase):
    def test_newest_epoch_wins_and_groups_merge(self):
        newer = "2026-11-10T23:00:00.000000"
        older = "2026-11-01T00:00:00.000000"
        # 43508: A มี epoch ใหม่กว่า, 56564: B มี epoch ใหม่กว่า
        a = with_epoch(GROUP_A, 43508, newer)
        a = with_epoch(a, 56564, older)
        b = with_epoch(GROUP_B, 56564, newer)
        self.db.apply_groups(self.files(a, b), T0)
        self.assertEqual(len(self.db), 10)
        for norad, epoch in ((43508, newer), (56564, newer)):
            rec = self.db.get(norad)
            self.assertEqual(rec.epoch, datetime.fromisoformat(epoch).replace(tzinfo=UTC))
            self.assertEqual(rec.groups, ["galileo", "gps-ops"])
            expected = omm.to_tle_lines(next(r for r in omm.read_omm(self.tmp / "files" / "gps-ops.json") + omm.read_omm(self.tmp / "files" / "galileo.json")
                                             if r.norad == norad and r.epoch == rec.epoch))
            self.assertEqual(rec.tle_lines, expected)
        self.assertEqual(self.db.get(62339).groups, ["gps-ops"])
        self.assertEqual(self.db.get(100744).groups, ["galileo"])
        self.assertEqual(self.db.groups(), ["galileo", "gps-ops"])

    def test_record_fields(self):
        self.db.apply_groups(self.files(), T0)
        rec = self.db.get(62339)
        src = next(r for r in omm.read_omm(OMM_SAMPLE) if r.norad == 62339)
        self.assertEqual((rec.norad, rec.name, rec.epoch, rec.updated), (62339, src.name, src.epoch, T0))
        self.assertEqual(rec.tle_lines, omm.to_tle_lines(src))
        self.assertIsNone(self.db.get(1))

    def test_counts_updated_skipped_missing(self):
        files = self.files()
        first = self.db.apply_groups(files, T0)
        self.assertEqual((first.updated, first.skipped, first.missing), (10, 0, 0))     # ดวงใหม่นับเป็น updated
        again = self.db.apply_groups(files, T0 + timedelta(hours=3))
        self.assertEqual((again.updated, again.skipped, again.missing), (0, 10, 0))
        self.assertEqual(self.db.get(62339).updated, T0)                                 # skipped ไม่แตะเวลาอัปเดต

        # epoch ใหม่ขึ้น 1 ดวง, ไม่มี 36828 และ 100744 ในไฟล์ใดเลย
        newer = with_epoch(GROUP_A, 62339, "2026-11-11T01:00:00.000000")
        b = [r for r in GROUP_B if r["NORAD_CAT_ID"] not in (36828, 100744)]
        before = self.db.get(36828)
        third = self.db.apply_groups(self.files(newer, b), T0 + timedelta(hours=6))
        self.assertEqual((third.updated, third.skipped, third.missing), (1, 7, 2))
        self.assertEqual(self.db.get(62339).updated, T0 + timedelta(hours=6))
        self.assertEqual(self.db.get(62339).epoch, datetime(2026, 11, 11, 1, 0, tzinfo=UTC))
        self.assertEqual(len(self.db), 10)
        self.assertEqual(self.db.get(36828), before)                                      # ดวงที่หายยังอยู่ ทั้ง TLE และกลุ่ม
        self.assertEqual(self.db.get(100744).groups, ["galileo"])

    def test_older_epoch_never_replaces(self):
        self.db.apply_groups(self.files(), T0)
        kept = self.db.get(62339)
        old = with_epoch(GROUP_A, 62339, "2026-10-01T00:00:00.000000")
        res = self.db.apply_groups(self.files(old, None), T0 + timedelta(hours=3))
        self.assertEqual((res.updated, res.skipped, res.missing), (0, 10, 0))
        self.assertEqual(self.db.get(62339), kept)

    def test_membership_follows_fetched_groups_and_keeps_unfetched(self):
        self.db.apply_groups(self.files(), T0)
        self.assertEqual(self.db.get(43508).groups, ["galileo", "gps-ops"])
        # ครั้งหน้าดึงเฉพาะ galileo (gps-ops ดึงไม่ได้): 43508 ยังอยู่ใน gps-ops ตามเดิม
        self.db.apply_groups({"galileo": self.write("galileo", GROUP_B)}, T0 + timedelta(hours=3))
        self.assertEqual(self.db.get(43508).groups, ["galileo", "gps-ops"])
        # ครั้งต่อไปดึงทั้งสองกลุ่ม แต่ galileo ไม่มี 43508 แล้ว: ออกจาก galileo เหลือ gps-ops
        b = [r for r in GROUP_B if r["NORAD_CAT_ID"] != 43508]
        self.db.apply_groups(self.files(None, b), T0 + timedelta(hours=6))
        self.assertEqual(self.db.get(43508).groups, ["gps-ops"])

    def test_save_and_reload_roundtrip(self):
        self.db.apply_groups(self.files(), T0)
        self.db.save()
        data = json.loads(self.db.path.read_text(encoding="utf-8"))
        entry = data["satellites"]["62339"]
        self.assertEqual(entry["groups"], ["gps-ops"])
        self.assertEqual(entry["epoch"], "2026-11-10T04:12:45.624384Z")
        self.assertEqual(entry["updated"], "2026-11-11T06:00:00Z")
        self.assertEqual(len(entry["tle"]), 2)
        reloaded = SatDb(self.db.path)
        self.assertEqual(len(reloaded), 10)
        for norad in NORADS:
            self.assertEqual(reloaded.get(norad), self.db.get(norad))
        again = reloaded.apply_groups(self.files(), T0 + timedelta(hours=3))
        self.assertEqual((again.updated, again.skipped, again.missing), (0, 10, 0))      # epoch ที่อ่านกลับเทียบกันได้

    def test_missing_or_corrupt_file_starts_empty(self):
        self.assertEqual(len(self.db), 0)
        self.assertEqual(self.db.groups(), [])
        for text in ("not json", "[]", '{"satellites": []}'):
            path = self.tmp / "bad.json"
            path.write_text(text, encoding="utf-8")
            self.assertEqual(len(SatDb(path)), 0, text)

    def test_unconvertible_record_is_skipped_with_warning(self):
        bad = copy.deepcopy(GROUP_A)
        del next(r for r in bad if r["NORAD_CAT_ID"] == 26407)["INCLINATION"]
        res = self.db.apply_groups(self.files(bad, None), T0)
        self.assertIsNone(self.db.get(26407))
        self.assertEqual(len(self.db), 9)
        self.assertEqual((res.updated, res.skipped, res.missing), (9, 0, 0))
        self.assertEqual([(m.code, m.level, m.object) for m in res.messages], [("TLE_CONVERT_FAILED", "warning", "gps-ops")])
        self.assertIn("26407", res.messages[0].text)

    def test_unreadable_file_skips_group_with_warning(self):
        files = self.files()
        files["galileo"].write_text("GP data has not updated since your last successful download\n", encoding="utf-8")
        res = self.db.apply_groups(files, T0)
        self.assertEqual(len(self.db), 6)
        self.assertEqual([(m.code, m.level, m.object) for m in res.messages], [("ORBIT_DOWNLOAD_FAILED", "warning", "galileo")])


class TestSearch(SatDbTestCase):
    def setUp(self):
        super().setUp()
        self.db.apply_groups(self.files(), T0)

    def names(self, **kw):
        return [r.name for r in self.db.search(**kw)]

    def test_search_by_name_norad_group(self):
        self.assertEqual(self.names(q="gps"), ["GPS BIII-7  (PRN 01)", "GPS BIIR-5  (PRN 22)"])     # ไม่สนตัวพิมพ์
        self.assertEqual(self.names(q="GpS"), self.names(q="gps"))
        self.assertEqual([r.norad for r in self.db.search(q="62339")], [62339])                    # NORAD ตรงตัว
        self.assertEqual([r.norad for r in self.db.search(q="6233")], [])                          # ไม่ใช่ส่วนหนึ่งของ NORAD
        self.assertEqual([r.norad for r in self.db.search(q="  100744 ")], [100744])
        self.assertEqual([r.norad for r in self.db.search(q="2620")], [100744])                    # ชื่อ COSMOS 2620 (709K)
        self.assertEqual({r.norad for r in self.db.search(group="gps-ops")}, {r["NORAD_CAT_ID"] for r in GROUP_A})
        self.assertEqual({r.norad for r in self.db.search(q="cosmos", group="gps-ops")}, {43508})
        self.assertEqual(self.db.search(q="zzz"), [])
        self.assertEqual(self.db.search(group="nonexistent"), [])

    def test_search_sorted_by_name_and_limit(self):
        all_names = self.names()
        self.assertEqual(len(all_names), 10)
        self.assertEqual(all_names, sorted(all_names, key=str.lower))
        self.assertEqual(self.names(limit=3), all_names[:3])
        self.assertEqual(self.names(limit=0), [])


class TestUpdateFromNetwork(unittest.TestCase):
    GROUPS = ("gps-ops", "galileo")

    def setUp(self):
        self.cfg = temp_config(self)
        self.db = SatDb(self.cfg.data_dir / "satdb.json")

    def test_update_from_network_uses_shared_cache_and_rate_rule(self):
        opener = FakeOpener(dump(GROUP_A), dump(GROUP_B))
        res = update_from_network(self.db, self.cfg, T0, groups=self.GROUPS, opener=opener)
        self.assertEqual((res.updated, res.skipped, res.missing), (10, 0, 0))
        self.assertEqual(res.messages, [])
        self.assertEqual(len(opener.calls), 2)
        self.assertTrue(all("gps-ops" in u or "galileo" in u for u, _ in opener.calls))
        self.assertEqual(len(list(self.cfg.omm_cache_dir.glob("gps-ops_*.json"))), 1)            # ลง OMM cache ที่ใช้ร่วมกัน
        self.assertTrue(self.cfg.state_file.is_file())
        self.assertEqual(len(SatDb(self.cfg.data_dir / "satdb.json")), 10)                       # บันทึกลงดิสก์แล้ว

        # เรียกซ้ำทันที: ไม่ถึง 2 ชม. จึงใช้ cache ไม่เรียก opener (FakeOpener จะ raise ถ้าถูกเรียก)
        again = update_from_network(self.db, self.cfg, T0 + timedelta(minutes=5), groups=self.GROUPS, opener=opener)
        self.assertEqual(len(opener.calls), 2)
        self.assertEqual((again.updated, again.skipped, again.missing), (0, 10, 0))
        self.assertEqual([(m.code, m.level) for m in again.messages], [("ORBIT_RATE_LIMITED_LOCAL", "info")] * 2)
        self.assertTrue(all(m.object is None for m in again.messages) and "gps-ops" in again.messages[0].text)

    def test_second_update_after_interval_requests_again(self):
        opener = FakeOpener(dump(GROUP_A), dump(GROUP_B),
                            dump(with_epoch(GROUP_A, 62339, "2026-11-11T01:00:00.000000")), dump(GROUP_B))
        update_from_network(self.db, self.cfg, T0, groups=self.GROUPS, opener=opener)
        res = update_from_network(self.db, self.cfg, T0 + timedelta(seconds=CELESTRAK_MIN_INTERVAL_S), groups=self.GROUPS, opener=opener)
        self.assertEqual(len(opener.calls), 4)
        self.assertEqual((res.updated, res.skipped, res.missing), (1, 9, 0))
        self.assertEqual(res.messages, [])

    def test_group_unavailable_becomes_warning(self):
        opener = FakeOpener(URLError("no network"), dump(GROUP_B))
        res = update_from_network(self.db, self.cfg, T0, groups=self.GROUPS, opener=opener)
        self.assertEqual(len(res.messages), 1)
        msg = res.messages[0]
        self.assertEqual((msg.code, msg.level, msg.object), ("ORBIT_DOWNLOAD_FAILED", "warning", "gps-ops"))
        self.assertIn("gps-ops", msg.text)
        self.assertEqual((res.updated, res.skipped, res.missing), (6, 0, 0))                    # เฉพาะกลุ่มที่ดึงได้
        self.assertEqual(self.db.groups(), ["galileo"])

    def test_failed_group_with_cached_file_passes_engine_warning(self):
        update_from_network(self.db, self.cfg, T0, groups=self.GROUPS, opener=FakeOpener(dump(GROUP_A), dump(GROUP_B)))
        # สองชั่วโมงถัดมา gps-ops ดึงไม่สำเร็จแต่มีไฟล์เดิม: ใช้ไฟล์เดิมพร้อม warning ของ engine
        opener = FakeOpener(URLError("down"), dump(GROUP_B))
        res = update_from_network(self.db, self.cfg, T0 + timedelta(hours=3), groups=self.GROUPS, opener=opener)
        self.assertEqual([(m.code, m.level) for m in res.messages], [("ORBIT_DOWNLOAD_FAILED", "warning")])
        self.assertEqual((res.updated, res.skipped, res.missing), (0, 10, 0))

    def test_all_groups_unavailable_changes_nothing(self):
        opener = FakeOpener(*[URLError("down")] * len(TLE_GROUPS))
        res = update_from_network(self.db, self.cfg, T0, opener=opener)                        # groups ตั้งต้น = TLE_GROUPS
        self.assertEqual(len(opener.calls), len(TLE_GROUPS))
        self.assertEqual([m.object for m in res.messages], list(TLE_GROUPS))
        self.assertEqual((res.updated, res.skipped, res.missing, len(self.db)), (0, 0, 0, 0))


if __name__ == "__main__":
    unittest.main()
