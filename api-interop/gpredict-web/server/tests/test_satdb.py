import copy
import json
import shutil
import tempfile
import unittest
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.error import URLError

from gpredict_web.config import TLE_GROUPS      # import gpredict_web ก่อน: __init__ ใส่ path ของ gnss_predict
from gpredict_web.satdb import SatDb, SatRecord, UpdateResult, gmat_name, update_from_network
from gpredict_web.tletext import UNKNOWN_STATUS, TleSet
from gnss_predict import omm
from gnss_predict.config import CELESTRAK_MIN_INTERVAL_S
from tests.helpers import temp_config
from tests.test_tletext import line1, line2

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
        self.assertEqual((first.updated, first.skipped, first.missing, first.new), (0, 0, 0, 10))     # ดวงใหม่นับใน new ไม่ใช่ updated (ref-D §5.3)
        again = self.db.apply_groups(files, T0 + timedelta(hours=3))
        self.assertEqual((again.updated, again.skipped, again.missing), (0, 10, 0))
        self.assertEqual(self.db.get(62339).updated, T0)                                 # skipped ไม่แตะเวลาอัปเดต

        # epoch ใหม่ขึ้น 1 ดวง, ไม่มี 36828 และ 100744 ในไฟล์ใดเลย
        newer = with_epoch(GROUP_A, 62339, "2026-11-11T01:00:00.000000")
        b = [r for r in GROUP_B if r["NORAD_CAT_ID"] not in (36828, 100744)]
        before, before_100744 = self.db.get(36828), self.db.get(100744)
        third = self.db.apply_groups(self.files(newer, b), T0 + timedelta(hours=6))
        self.assertEqual((third.updated, third.skipped, third.missing), (1, 7, 2))
        self.assertEqual(self.db.get(62339).updated, T0 + timedelta(hours=6))
        self.assertEqual(self.db.get(62339).epoch, datetime(2026, 11, 11, 1, 0, tzinfo=UTC))
        self.assertEqual(len(self.db), 10)
        # ดวงที่หายยังอยู่พร้อม TLE เดิม แต่ออกจาก galileo เพราะไฟล์ galileo ที่อ่านครั้งนี้ไม่มีมันแล้ว
        self.assertEqual(self.db.get(36828), replace(before, groups=[]))
        self.assertEqual(self.db.get(100744).groups, [])
        self.assertEqual(self.db.search(group="galileo", q="cosmos 2620"), [])
        self.assertEqual(self.db.get(100744).tle_lines, before_100744.tle_lines)

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

    def test_missing_satellite_keeps_only_groups_not_read_this_run(self):
        self.db.apply_groups(self.files(), T0)
        # gps-ops อ่านได้แต่ไม่มี 26407; ไฟล์ galileo อ่านไม่ได้ จึงไม่รู้ว่าสมาชิก galileo เป็นอย่างไร
        a = [r for r in GROUP_A if r["NORAD_CAT_ID"] != 26407]
        files = self.files(a, None)
        files["galileo"].write_text("GP data has not updated since your last successful download\n", encoding="utf-8")
        before = {n: self.db.get(n) for n in NORADS}
        res = self.db.apply_groups(files, T0 + timedelta(hours=3))
        self.assertEqual([m.object for m in res.messages], ["galileo"])
        self.assertEqual((res.updated, res.skipped, res.missing), (0, 5, 5))     # 26407 และดวง galileo อย่างเดียว 4 ดวง
        self.assertEqual(len(self.db), 10)
        self.assertEqual(self.db.get(26407), replace(before[26407], groups=[]))            # gps-ops อ่านแล้วและไม่มีมัน
        for norad in (44542, 41434, 36828, 100744):                                         # galileo ไม่ได้อ่าน คงสมาชิกเดิม
            self.assertEqual(self.db.get(norad), before[norad])
            self.assertEqual(self.db.get(norad).groups, ["galileo"])

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
        self.assertEqual((res.updated, res.skipped, res.missing, res.new), (0, 0, 0, 9))
        self.assertEqual([(m.code, m.level, m.object) for m in res.messages], [("TLE_CONVERT_FAILED", "warning", "gps-ops")])
        self.assertIn("26407", res.messages[0].text)

    def test_unreadable_file_skips_group_with_warning(self):
        files = self.files()
        files["galileo"].write_text("GP data has not updated since your last successful download\n", encoding="utf-8")
        res = self.db.apply_groups(files, T0)
        self.assertEqual(len(self.db), 6)
        self.assertEqual([(m.code, m.level, m.object) for m in res.messages], [("ORBIT_DOWNLOAD_FAILED", "warning", "galileo")])


# ---------------------------------------------------------------- apply_sets: กติกาการรวม TLE ของ Gpredict (ref-D §5.3)

E0 = datetime(2026, 11, 10, 12, 0, tzinfo=UTC)
DAY = timedelta(days=1)
T1 = T0 + timedelta(hours=3)


def epoch_field(t: datetime) -> str:
    """ช่อง epoch YYDDD.dddddddd ของบรรทัด 1"""
    day = 1 + (t - datetime(t.year, 1, 1, tzinfo=UTC)) / DAY
    return f"{t.year % 100:02d}{day:012.8f}"


def make_set(norad: int = 1, name: str = "ALPHA", epoch: datetime = E0, status: str = UNKNOWN_STATUS) -> TleSet:
    """ชุด TLE ที่บรรทัดของมันมี epoch ของมัน (epoch ต่างกัน บรรทัดก็ต่างกัน)"""
    return TleSet(norad, name, status, (line1(str(norad), epoch=epoch_field(epoch)), line2(str(norad))), epoch)


def counts(res: UpdateResult) -> tuple[int, int, int, int]:
    return res.updated, res.skipped, res.missing, res.new


class TestApplySets(SatDbTestCase):
    def apply(self, sources, now=T1, add_new=True, replace_groups=frozenset(), db=None) -> UpdateResult:
        return (self.db if db is None else db).apply_sets(sources, now, add_new, replace_groups)      # SatDb ว่างเป็น falsy

    def seed(self, *sets: TleSet, group: str = "g") -> None:
        self.apply({group: list(sets)}, T0)

    def test_newer_epoch_updates(self):
        self.seed(make_set(1, "ALPHA", E0, "Operational"))
        newer = make_set(1, "ALPHA", E0 + DAY, UNKNOWN_STATUS)
        res = self.apply({"g": [newer]})
        self.assertEqual(counts(res), (1, 0, 0, 0))
        rec = self.db.get(1)
        self.assertEqual((rec.tle_lines, rec.epoch, rec.updated), (newer.lines, newer.epoch, T1))
        self.assertEqual(rec.status, UNKNOWN_STATUS)              # ข้อมูลใหม่กว่าแทน STATUS ด้วย แม้เป็น Unknown (tle-update.c:1298-1313)
        self.assertEqual(res.messages, [])

    def test_equal_epoch_status_change_updates_else_skipped(self):
        self.seed(make_set(1, status=UNKNOWN_STATUS))
        before = self.db.get(1)
        # Unknown -> Operational: updated, TLE ไม่เปลี่ยนจึงไม่แตะเวลาที่ TLE เข้าดัชนี
        self.assertEqual(counts(self.apply({"g": [make_set(1, status="Operational")]})), (1, 0, 0, 0))
        self.assertEqual(self.db.get(1), replace(before, status="Operational"))
        # Operational -> Unknown: skipped, สถานะที่รู้แล้วไม่ถูกลบ
        self.assertEqual(counts(self.apply({"g": [make_set(1, status=UNKNOWN_STATUS)]})), (0, 1, 0, 0))
        self.assertEqual(self.db.get(1).status, "Operational")
        # สถานะเดิมซ้ำ: skipped
        self.assertEqual(counts(self.apply({"g": [make_set(1, status="Operational")]})), (0, 1, 0, 0))
        # สถานะที่รู้อื่น: updated
        self.assertEqual(counts(self.apply({"g": [make_set(1, status="Spare")]})), (1, 0, 0, 0))
        self.assertEqual(self.db.get(1).status, "Spare")
        self.assertEqual(self.db.get(1).updated, T0)

    def test_older_epoch_skipped(self):
        self.seed(make_set(1, "ALPHA", E0, "Operational"))
        before = self.db.get(1)
        res = self.apply({"g": [make_set(1, "BETA", E0 - DAY, "Spare")]})
        self.assertEqual(counts(res), (0, 1, 0, 0))
        self.assertEqual(self.db.get(1), before)

    def test_missing_counts_local_without_data(self):
        self.seed(make_set(1), make_set(2, "BETA"))
        before = self.db.get(2)
        res = self.apply({"g": [make_set(1)]})
        self.assertEqual(counts(res), (0, 1, 1, 0))
        self.assertEqual(self.db.get(2), before)                  # ไม่มีข้อมูลใหม่: เก็บดาวเดิมไว้ทั้งดวง
        self.assertEqual(len(self.db), 2)
        self.assertEqual(counts(self.apply({})), (0, 0, 2, 0))    # ไม่มี source ใดอ่านได้เลย

    def test_new_satellites_only_when_add_new(self):
        self.seed(make_set(1))
        fresh = make_set(2, "BETA", E0, "Operational")
        sources = {"g": [make_set(1), fresh]}
        res = self.apply(sources, add_new=False)
        self.assertEqual((counts(res), res.add_new), ((0, 1, 0, 0), False))
        self.assertIsNone(self.db.get(2))
        self.assertEqual(len(self.db), 1)
        res = self.apply(sources, add_new=True)
        self.assertEqual((counts(res), res.add_new), ((0, 1, 0, 1), True))     # ดวงใหม่ไม่นับใน updated
        self.assertEqual(self.db.get(2), SatRecord(2, "BETA", ["g"], fresh.lines, fresh.epoch, T1, "Operational"))
        self.assertEqual(counts(self.apply(sources, add_new=True)), (0, 2, 0, 0))     # รอบถัดไปไม่ใช่ดวงใหม่แล้ว

    def test_generated_name_replaced(self):
        cases = [
            # (ชื่อเดิม, ชื่อที่ได้, epoch ที่ได้เทียบเดิม, ชื่อหลังรวม, updated)
            ("2026-001A", "FOO", E0, "FOO", 1),                    # epoch เท่ากัน: ชื่ออย่างเดียวก็นับ updated
            ("OBJECT A", "BAR", E0 - DAY, "BAR", 1),               # epoch เก่ากว่า ชื่อจริงยังแทนชื่อที่สร้างได้
            ("2026-001A", "", E0, "", 1),                           # ชื่อว่างไม่ใช่ชื่อที่สร้าง Gpredict จึงแทน
            ("REAL", "OTHER", E0, "REAL", 0),                       # ชื่อจริงอยู่แล้ว: คงเดิม
            ("REAL", "OTHER", E0 + DAY, "REAL", 1),                 # TLE ใหม่กว่าแทน TLE แต่ชื่อจริงเดิมคงอยู่
            ("2026-001A", "2026-001B", E0, "2026-001A", 0),         # ชื่อใหม่ก็สร้างเอง: ไม่แทน
            ("", "2026-001B", E0, "", 0),
        ]
        for old_name, new_name, new_epoch, expected, updated in cases:
            with self.subTest(old=old_name, new=new_name, epoch=new_epoch - E0):
                db = SatDb(self.tmp / f"{old_name or 'blank'}-{new_name or 'blank'}-{(new_epoch - E0) / DAY}.json")
                db.apply_sets({"g": [make_set(1, old_name, E0)]}, T0, True, frozenset())
                incoming = make_set(1, new_name, new_epoch)
                res = db.apply_sets({"g": [incoming]}, T1, True, frozenset())
                self.assertEqual(counts(res), (updated, 1 - updated, 0, 0))
                rec = db.get(1)
                self.assertEqual(rec.name, expected)
                if new_epoch > E0:
                    self.assertEqual((rec.tle_lines, rec.epoch), (incoming.lines, incoming.epoch))
                else:
                    self.assertEqual((rec.tle_lines, rec.epoch), (make_set(1, epoch=E0).lines, E0))

    def test_best_of_two_sources(self):
        old = make_set(1, "ALPHA", E0, "Operational")
        new = make_set(1, "ALPHA", E0 + DAY)
        for order in (("a", "b"), ("b", "a")):
            with self.subTest(order=order):
                db = SatDb(self.tmp / f"{''.join(order)}.json")
                sources = {"a": [old], "b": [new]}
                res = self.apply({g: sources[g] for g in order}, add_new=True, db=db)
                self.assertEqual(counts(res), (0, 0, 0, 1))
                self.assertEqual(db.get(1), SatRecord(1, "ALPHA", ["a", "b"], new.lines, new.epoch, T1, UNKNOWN_STATUS))

    def test_duplicates_within_sources_merge_like_gpredict(self):
        def merged(*sets: TleSet, groups=("g",)) -> SatRecord:
            db = SatDb(self.tmp / "dups.json")
            db.apply_sets({g: list(sets) for g in groups}, T0, True, frozenset())
            return db.get(sets[0].norad)

        newer = make_set(1, "ALPHA", E0 + DAY, "Spare")
        self.assertEqual(merged(make_set(1), newer, make_set(1)).epoch, newer.epoch)      # ใหม่กว่าอยู่ตรงกลาง: ได้ตัวนั้น
        self.assertEqual(merged(make_set(1, epoch=E0 + 2 * DAY), newer).tle_lines, make_set(1, epoch=E0 + 2 * DAY).lines)
        # epoch เท่ากัน: สถานะที่รู้แทน Unknown, สถานะที่รู้ตัวหลังแทนตัวก่อน, Unknown ไม่ลบสถานะที่รู้
        self.assertEqual(merged(make_set(1, status=UNKNOWN_STATUS), make_set(1, status="Operational")).status, "Operational")
        self.assertEqual(merged(make_set(1, status="Operational"), make_set(1, status=UNKNOWN_STATUS)).status, "Operational")
        self.assertEqual(merged(make_set(1, status="Operational"), make_set(1, status="Spare")).status, "Spare")
        # ข้อมูลใหม่กว่าแทนสถานะด้วย แม้เป็น Unknown
        self.assertEqual(merged(make_set(1, status="Operational"), make_set(1, epoch=E0 + DAY)).status, UNKNOWN_STATUS)
        # ข้อมูลเก่ากว่าไม่แตะสถานะ
        self.assertEqual(merged(make_set(1, epoch=E0 + DAY, status="Operational"), make_set(1, status="Spare")).status, "Operational")
        # ชื่อที่สร้างเองถูกแทนด้วยชื่อจริง ไม่ว่าชุดไหนมาก่อนหรือใหม่กว่า
        for first, second in ((make_set(1, "2026-001A", E0), make_set(1, "FOO", E0)),
                              (make_set(1, "FOO", E0), make_set(1, "2026-001A", E0)),
                              (make_set(1, "2026-001A", E0), make_set(1, "FOO", E0 - DAY)),
                              (make_set(1, "FOO", E0 - DAY), make_set(1, "2026-001A", E0)),
                              (make_set(1, "2026-001A", E0 - DAY), make_set(1, "FOO", E0))):
            self.assertEqual(merged(first, second).name, "FOO")
        self.assertEqual(merged(make_set(1, "FOO", E0), make_set(1, "BAR", E0 + DAY)).name, "FOO")     # ชื่อจริงแรกคงอยู่ (Gpredict)
        self.assertEqual(merged(make_set(1, "", E0), make_set(1, "2026-001A", E0 + DAY)).name, "")
        # ดวงเดียวกันซ้ำในไฟล์เดียวไม่ถูกนับสองครั้ง
        db = SatDb(self.tmp / "once.json")
        res = db.apply_sets({"g": [make_set(1), make_set(1, epoch=E0 + DAY)]}, T0, True, frozenset())
        self.assertEqual(counts(res), (0, 0, 0, 1))

    def test_epoch_compared_as_datetimes(self):
        # (ของเรา) Gpredict เทียบเลข YYDDD.dddd จึงเห็น 99365 (ปี 1999) ใหม่กว่า 01001 (ปี 2001) เราเทียบเวลาจริง
        old, new = datetime(1999, 12, 31, 12, 0, tzinfo=UTC), datetime(2001, 1, 1, 12, 0, tzinfo=UTC)
        self.seed(make_set(1, epoch=old))
        res = self.apply({"g": [make_set(1, epoch=new)]})
        self.assertEqual(counts(res), (1, 0, 0, 0))
        self.assertEqual(self.db.get(1).epoch, new)
        self.assertEqual(counts(self.apply({"g": [make_set(1, epoch=old)]})), (0, 1, 0, 0))

    def test_replace_groups_membership(self):
        self.seed(make_set(1), make_set(2, "BETA"), make_set(3, "GAMMA"), group="amateur")
        self.seed(make_set(3, "GAMMA"), group="other")
        self.assertEqual(self.db.get(3).groups, ["amateur", "other"])
        res = self.apply({"amateur": [make_set(1)]}, replace_groups={"amateur"})      # ไฟล์ amateur.txt มีดวงเดียว
        self.assertEqual(counts(res), (0, 1, 2, 0))
        self.assertEqual([r.norad for r in self.db.search(group="amateur")], [1])
        self.assertEqual(self.db.get(2).groups, [])                                    # ยังอยู่ในดัชนี แต่ออกจากกลุ่ม
        self.assertEqual(self.db.get(3).groups, ["other"])
        self.assertEqual(len(self.db), 3)
        self.assertEqual(self.db.groups(), ["amateur", "other"])

    def test_group_not_replaced_only_gains_members(self):
        self.seed(make_set(1), make_set(2, "BETA"), group="amateur")
        res = self.apply({"amateur": [make_set(1), make_set(3, "GAMMA")]}, add_new=False)     # อยู่ใน sources แต่ไม่อยู่ใน replace_groups
        self.assertEqual(counts(res), (0, 1, 1, 0))
        self.assertEqual(self.db.get(2).groups, ["amateur"])                           # ไม่ถูกแทน
        res = self.apply({"extra": [make_set(1), make_set(2, "BETA")]})                # กลุ่มใหม่ติดป้ายให้ดวงที่อยู่ในไฟล์
        self.assertEqual(counts(res), (0, 2, 0, 0))
        self.assertEqual(self.db.get(1).groups, ["amateur", "extra"])
        self.assertEqual(self.db.get(2).groups, ["amateur", "extra"])
        # กลุ่มใน replace_groups ที่ไม่มีไฟล์ (อ่านไม่ได้รอบนี้) ไม่ถูกแตะ
        res = self.apply({"extra": [make_set(1)]}, replace_groups={"amateur", "extra"})
        self.assertEqual(counts(res), (0, 1, 1, 0))
        self.assertEqual(self.db.get(1).groups, ["amateur", "extra"])
        self.assertEqual(self.db.get(2).groups, ["amateur"])

    def test_new_satellite_joins_the_groups_it_was_found_in(self):
        res = self.apply({"a": [make_set(1)], "b": [make_set(1, epoch=E0 - DAY), make_set(2, "BETA")]},
                         replace_groups={"a", "b"})
        self.assertEqual(counts(res), (0, 0, 0, 2))
        self.assertEqual((self.db.get(1).groups, self.db.get(2).groups), (["a", "b"], ["b"]))

    def test_status_persisted(self):
        self.seed(make_set(1, status="Operational"), make_set(2, "BETA"))
        self.db.save()
        entries = json.loads(self.db.path.read_text(encoding="utf-8"))["satellites"]
        self.assertEqual((entries["1"]["status"], entries["2"]["status"]), ("Operational", "Unknown"))
        reloaded = SatDb(self.db.path)
        self.assertEqual((reloaded.get(1).status, reloaded.get(2).status), ("Operational", UNKNOWN_STATUS))
        self.assertEqual(reloaded.get(1), self.db.get(1))
        # ไฟล์ของรุ่นก่อนไม่มีช่อง status: อ่านได้เป็น Unknown
        for entry in entries.values():
            del entry["status"]
        self.db.path.write_text(json.dumps({"version": 1, "satellites": entries}), encoding="utf-8")
        old = SatDb(self.db.path)
        self.assertEqual((len(old), old.get(1).status, old.get(2).status), (2, UNKNOWN_STATUS, UNKNOWN_STATUS))
        # รายการที่ status ไม่ใช่ข้อความถูกข้ามเหมือนช่องอื่นที่เสีย
        entries["1"]["status"] = 5
        self.db.path.write_text(json.dumps({"version": 1, "satellites": entries}), encoding="utf-8")
        self.assertEqual(sorted(SatDb(self.db.path).norads()), [2])

    def test_satrecord_and_updateresult_defaults(self):
        rec = SatRecord(1, "A", [], ("x", "y"), E0, E0)
        self.assertEqual(rec.status, UNKNOWN_STATUS)
        res = UpdateResult(1, 2, 3)
        self.assertEqual((res.new, res.messages, res.add_new, res.aborted), (0, [], False, None))
        self.assertEqual(UpdateResult(1, 2, 3, []).messages, [])
        self.assertEqual(UpdateResult(1, 2, 3, new=4).new, 4)

    def test_apply_groups_add_new_and_newer_omm_resets_status(self):
        self.db.apply_groups(self.files(GROUP_A, GROUP_A), T0)
        self.assertEqual(len(self.db), 6)
        res = self.db.apply_groups(self.files(), T1, add_new=False)               # GROUP_B มีดาวใหม่ 4 ดวง
        self.assertEqual((counts(res), len(self.db)), ((0, 6, 0, 0), 6))
        res = self.db.apply_groups(self.files(), T1)                              # add_new ตั้งต้นเป็น True
        self.assertEqual((counts(res), len(self.db)), ((0, 6, 0, 4), 10))
        self.assertTrue(all(self.db.get(n).status == UNKNOWN_STATUS for n in NORADS))
        # ป้ายสถานะจากไฟล์ข้อความที่ epoch เท่ากัน แล้ว OMM ที่ใหม่กว่าแทนทั้ง TLE และสถานะ
        rec = self.db.get(62339)
        self.assertEqual(counts(self.apply({"x": [TleSet(62339, rec.name, "Operational", rec.tle_lines, rec.epoch)]})), (1, 0, 9, 0))
        self.assertEqual(self.db.get(62339).status, "Operational")
        newer = with_epoch(GROUP_A, 62339, "2026-11-11T01:00:00.000000")
        self.db.apply_groups(self.files(newer, None), T1 + timedelta(hours=3))
        rec = self.db.get(62339)
        self.assertEqual((rec.status, rec.epoch), (UNKNOWN_STATUS, datetime(2026, 11, 11, 1, 0, tzinfo=UTC)))


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

    def test_norads_is_a_copy_of_every_norad(self):
        norads = self.db.norads()
        self.assertEqual(norads, set(NORADS))
        norads.clear()
        self.assertEqual(self.db.norads(), set(NORADS))

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
        self.assertEqual((res.updated, res.skipped, res.missing, res.new), (0, 0, 0, 10))
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
        self.assertEqual((res.updated, res.skipped, res.missing, res.new), (0, 0, 0, 6))        # เฉพาะกลุ่มที่ดึงได้
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
