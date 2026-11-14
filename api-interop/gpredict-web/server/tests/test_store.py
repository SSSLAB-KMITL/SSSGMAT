import json
import os
import threading
import unittest
from dataclasses import replace
from pathlib import Path
from unittest import mock

from gpredict_web import config
from gpredict_web.ephem import EphemManager
from gpredict_web.errors import ApiError
from gpredict_web.module import (DEFAULT_LAYOUT_CODE, DEFAULT_MAP, MODULE_KEYS, PAGE_PATHS, get_path, module_from_dict,
                                 module_to_dict)
from gpredict_web.prefs import Prefs
from gpredict_web.runtime import Hub
from gpredict_web.satdb import SatDb
from gpredict_web.store import Qth, Store, qth_from_dict, write_json_atomic
from tests.helpers import FakeNow, temp_config

FIXTURES = Path(__file__).resolve().parent / "fixtures"
V1_AMATEUR = FIXTURES / "module_v1_amateur.json"           # ไฟล์ module แบบ core (version 1) ที่ core เขียนจริง
# ช่องของไฟล์ module ใหม่ที่ไม่ได้ตรึงค่าใด (ช่องของ module อย่างเดียว + version)
MODULE_ONLY_KEYS = {"version", "name", "qth", "satellites", "list_sort", "single", "footprint_off", "ground_track",
                    "sky_track", "window"}
WINDOW_DEFAULT = {"state": 0, "x": None, "y": None, "width": None, "height": None}


def thbk() -> Qth:
    return Qth(name="THBK", description="Bangkok station", location="Bangkok",
               lat_deg=13.729779, lon_deg=100.781151, alt_m=6.4, weather_station="VTBS")


class StoreTestCase(unittest.TestCase):
    def setUp(self):
        self.cfg = temp_config(self)
        self.store = Store(self.cfg.data_dir)


class ConfigTests(unittest.TestCase):
    def test_constants(self):
        self.assertEqual(config.PORT, 8740)
        self.assertEqual((config.STEP_S, config.WINDOW_BACK_H, config.WINDOW_SPAN_H, config.REFRESH_MARGIN_H),
                         (30, 2, 16, 3))
        self.assertEqual((config.MAX_SATS, config.GMAT_TIMEOUT_S, config.TLE_OLD_DAYS), (200, 600, 7))
        self.assertEqual(len(config.TLE_GROUPS), 10)
        self.assertEqual(config.TLE_GROUPS[0], "amateur")

    def test_name_re(self):
        for ok in ("THBK", "a", "a_b-C9", "x" * 25):
            self.assertTrue(config.NAME_RE.fullmatch(ok), ok)
        for bad in ("", "x" * 26, "has space", "a/b", "..", "ก", "line\n"):
            self.assertIsNone(config.NAME_RE.fullmatch(bad), repr(bad))

    def test_from_env_prefers_argument_then_env_then_default(self):
        explicit = Path("/explicit/data")
        self.assertEqual(config.Config.from_env(explicit).data_dir, explicit)
        old = os.environ.get("GPREDICT_WEB_DATA")
        self.addCleanup(lambda: os.environ.pop("GPREDICT_WEB_DATA", None) if old is None
                        else os.environ.__setitem__("GPREDICT_WEB_DATA", old))
        os.environ["GPREDICT_WEB_DATA"] = "/env/data"
        self.assertEqual(config.Config.from_env().data_dir, Path("/env/data"))
        self.assertEqual(config.Config.from_env(explicit).data_dir, explicit)
        del os.environ["GPREDICT_WEB_DATA"]
        default = config.Config.from_env().data_dir
        self.assertEqual(default, Path(config.__file__).resolve().parents[2] / "data")

    def test_omm_cache_comes_from_engine_and_state_file(self):
        import gnss_predict.config as engine
        cfg = config.Config.from_env(Path("/x"))
        self.assertEqual(cfg.omm_cache_dir, engine.OMM_CACHE_DIR)
        self.assertEqual(cfg.state_file, engine.OMM_CACHE_DIR / engine.CELESTRAK_STATE_FILE)


class ErrorTests(unittest.TestCase):
    def test_to_dict(self):
        e = ApiError("NOT_FOUND", 404, "ไม่พบ", "THBK")
        self.assertEqual((e.code, e.status, e.text, e.object), ("NOT_FOUND", 404, "ไม่พบ", "THBK"))
        self.assertEqual(e.to_dict(), {"code": "NOT_FOUND", "level": "error", "text": "ไม่พบ", "object": "THBK"})
        self.assertEqual(str(e), "ไม่พบ")
        self.assertIsNone(ApiError("X", 400, "t").to_dict()["object"])


class QthTests(StoreTestCase):
    def test_qth_round_trip(self):
        self.assertEqual(self.store.list_qth(), [])
        self.store.put_qth(thbk())
        self.assertEqual(self.store.get_qth("THBK"), thbk())
        self.assertEqual(self.store.list_qth(), [thbk()])
        path = self.cfg.data_dir / "qth" / "THBK.json"
        self.assertEqual(json.loads(path.read_text(encoding="utf-8")),
                         {"name": "THBK", "description": "Bangkok station", "location": "Bangkok",
                          "lat_deg": 13.729779, "lon_deg": 100.781151, "alt_m": 6.4, "weather_station": "VTBS"})

    def test_put_overwrites_and_list_is_sorted_by_name(self):
        self.store.put_qth(Qth(name="Zeta"))
        self.store.put_qth(Qth(name="Alpha"))
        self.store.put_qth(replace(thbk(), location="Old"))
        self.store.put_qth(thbk())
        self.assertEqual([q.name for q in self.store.list_qth()], ["Alpha", "THBK", "Zeta"])
        self.assertEqual(self.store.get_qth("THBK").location, "Bangkok")

    def test_limits_are_inclusive(self):
        edge = Qth(name="x" * 25, description="d" * 256, location="l" * 50,
                   lat_deg=-90, lon_deg=180, alt_m=5000, weather_station="W" * 4)
        self.store.put_qth(edge)
        self.store.put_qth(Qth(name="lo", lat_deg=90, lon_deg=-180, alt_m=0))
        self.assertEqual(self.store.get_qth("x" * 25), edge)

    def test_thai_text_is_stored_readable(self):
        self.store.put_qth(replace(thbk(), location="กรุงเทพ", description="สถานีทดสอบ"))
        raw = (self.cfg.data_dir / "qth" / "THBK.json").read_text(encoding="utf-8")
        self.assertIn("กรุงเทพ", raw)
        self.assertEqual(self.store.get_qth("THBK").location, "กรุงเทพ")

    def test_qth_rejects(self):
        cases = [
            ("name 26 chars", replace(thbk(), name="x" * 26), "name"),
            ("name with space", replace(thbk(), name="has space"), "name"),
            ("name empty", replace(thbk(), name=""), "name"),
            ("name with slash", replace(thbk(), name="../evil"), "name"),
            ("name with trailing newline", replace(thbk(), name="THBK\n"), "name"),
            ("lat 90.1", replace(thbk(), lat_deg=90.1), "lat_deg"),
            ("lat -90.1", replace(thbk(), lat_deg=-90.1), "lat_deg"),
            ("lon -180.1", replace(thbk(), lon_deg=-180.1), "lon_deg"),
            ("lon 180.1", replace(thbk(), lon_deg=180.1), "lon_deg"),
            ("alt -1", replace(thbk(), alt_m=-1), "alt_m"),
            ("alt 5000.1", replace(thbk(), alt_m=5000.1), "alt_m"),
            ("location 51 chars", replace(thbk(), location="l" * 51), "location"),
            ("description 257 chars", replace(thbk(), description="d" * 257), "description"),
            ("weather_station 5 chars", replace(thbk(), weather_station="W" * 5), "weather_station"),
            ("lat nan", replace(thbk(), lat_deg=float("nan")), "lat_deg"),
            ("lat inf", replace(thbk(), lat_deg=float("inf")), "lat_deg"),
            ("lat string", replace(thbk(), lat_deg="13.7"), "lat_deg"),
            ("lat bool", replace(thbk(), lat_deg=True), "lat_deg"),
            ("lat huge int", replace(thbk(), lat_deg=10**400), "lat_deg"),
            ("lon huge int", replace(thbk(), lon_deg=10**400), "lon_deg"),
            ("alt huge int", replace(thbk(), alt_m=10**400), "alt_m"),
            ("lat huge negative int", replace(thbk(), lat_deg=-(10**400)), "lat_deg"),
            ("location not a string", replace(thbk(), location=5), "location"),
        ]
        for label, qth, field in cases:
            with self.subTest(label):
                with self.assertRaises(ApiError) as cm:
                    self.store.put_qth(qth)
                self.assertEqual((cm.exception.code, cm.exception.status), ("QTH_INVALID", 422))
                self.assertEqual(cm.exception.object, field)
                self.assertIn(field, cm.exception.text)
        self.assertEqual(self.store.list_qth(), [])

    def test_qth_from_dict(self):
        q = qth_from_dict({"name": "THBK", "lat_deg": 13, "lon_deg": 100, "alt_m": 6, "extra": "ignored"})
        self.assertEqual(q, Qth(name="THBK", lat_deg=13.0, lon_deg=100.0, alt_m=6.0))
        self.assertIsInstance(q.lat_deg, float)
        self.assertEqual(qth_from_dict(dict(thbk().__dict__)), thbk())
        self.assertEqual(qth_from_dict({"name": "Mini"}), Qth(name="Mini"))

    def test_qth_from_dict_rejects(self):
        for label, d in (("not a dict", ["THBK"]), ("no name", {"lat_deg": 1}),
                         ("name not a string", {"name": 7}), ("lat out of range", {"name": "A", "lat_deg": 91}),
                         ("lon string", {"name": "A", "lon_deg": "x"}),
                         ("huge int from JSON", json.loads('{"name": "A", "lat_deg": 1' + "0" * 400 + '}')), ("long description", {"name": "A", "description": "d" * 257})):
            with self.subTest(label):
                with self.assertRaises(ApiError) as cm:
                    qth_from_dict(d)
                self.assertEqual((cm.exception.code, cm.exception.status), ("QTH_INVALID", 422))

    def test_get_missing_qth_is_not_found(self):
        for name in ("Nope", "../settings", "bad name", ""):
            with self.subTest(name):
                with self.assertRaises(ApiError) as cm:
                    self.store.get_qth(name)
                self.assertEqual((cm.exception.code, cm.exception.status), ("NOT_FOUND", 404))
        with self.assertRaises(ApiError) as cm:
            self.store.delete_qth("Nope")
        self.assertEqual((cm.exception.code, cm.exception.status), ("NOT_FOUND", 404))

    def test_delete_qth(self):
        self.store.put_qth(thbk())
        self.store.put_qth(Qth(name="Other"))
        self.store.delete_qth("Other")
        self.assertEqual([q.name for q in self.store.list_qth()], ["THBK"])
        self.assertFalse((self.cfg.data_dir / "qth" / "Other.json").exists())

    def test_qth_names_lists_files_without_reading_them(self):
        self.assertEqual(self.store.qth_names(), [])
        self.store.put_qth(thbk())
        self.store.put_qth(Qth(name="Alpha"))
        (self.cfg.data_dir / "qth" / "Broken.json").write_text("{", encoding="utf-8")   # ไฟล์เสียก็ยังนับชื่อ
        self.assertEqual(self.store.qth_names(), ["Alpha", "Broken", "THBK"])

    def write_qth_file(self, name: str, content: bytes) -> None:
        d = self.cfg.data_dir / "qth"
        d.mkdir(parents=True, exist_ok=True)
        (d / f"{name}.json").write_bytes(content)

    def test_get_qth_maps_every_bad_file_to_qth_invalid(self):
        """ไฟล์เสียทุกแบบเป็น 422 QTH_INVALID เหมือน get_module ไม่ใช่ 500 (UnicodeDecodeError, int เกิน 4300 หลัก)"""
        cases = {"NotJson": b"{", "NotUtf8": b"\xff\xfe\x00", "BigInt": b'{"name": "BigInt", "lat_deg": ' + b"9" * 5000 + b"}",
                 "NotObject": b"[1, 2]", "BadRange": b'{"name": "BadRange", "lat_deg": 99}'}
        for name, content in cases.items():
            self.write_qth_file(name, content)
        for name in cases:
            with self.subTest(name):
                with self.assertRaises(ApiError) as cm:
                    self.store.get_qth(name)
                self.assertEqual((cm.exception.code, cm.exception.status), ("QTH_INVALID", 422))
        for name in ("NotJson", "NotUtf8", "BigInt"):                          # อ่านไม่ได้: object = ชื่อ QTH
            with self.assertRaises(ApiError) as cm:
                self.store.get_qth(name)
            self.assertEqual(cm.exception.object, name)

    def test_list_qth_skips_bad_files(self):
        self.store.put_qth(thbk())
        self.write_qth_file("Broken", b"{")
        self.write_qth_file("NotUtf8", b"\xff\xfe")
        self.store.put_qth(Qth(name="Alpha"))
        self.assertEqual([q.name for q in self.store.list_qth()], ["Alpha", "THBK"])      # ไม่ล้มทั้งรายการ

    def test_list_qth_checked_reports_the_skipped_files(self):
        self.store.put_qth(thbk())
        self.write_qth_file("Broken", b"{")
        self.write_qth_file("Range", b'{"name": "Range", "lon_deg": 181}')
        good, skipped = self.store.list_qth_checked()
        self.assertEqual([q.name for q in good], ["THBK"])
        self.assertEqual([(file, e.code, e.status) for file, e in skipped],
                         [("Broken.json", "QTH_INVALID", 422), ("Range.json", "QTH_INVALID", 422)])
        self.assertEqual(self.store.list_qth_checked()[1][0][0], "Broken.json")
        self.assertEqual(Store(self.cfg.data_dir / "nowhere").list_qth_checked(), ([], []))

    def test_delete_last_qth_is_in_use(self):
        self.store.put_qth(thbk())
        with self.assertRaises(ApiError) as cm:
            self.store.delete_qth("THBK")
        self.assertEqual((cm.exception.code, cm.exception.status, cm.exception.object), ("IN_USE", 409, "THBK"))
        self.assertEqual(self.store.get_qth("THBK"), thbk())


class DefaultQthTests(StoreTestCase):
    def test_default_qth_round_trip(self):
        self.assertIsNone(self.store.default_qth())
        self.store.put_qth(thbk())
        self.store.put_qth(Qth(name="Other"))
        self.store.set_default_qth("Other")
        self.assertEqual(self.store.default_qth(), "Other")
        self.assertEqual(json.loads((self.cfg.data_dir / "settings.json").read_text(encoding="utf-8")),
                         {"default_qth": "Other"})
        self.assertEqual(Store(self.cfg.data_dir).default_qth(), "Other")

    def test_set_default_to_missing_qth_is_not_found(self):
        with self.assertRaises(ApiError) as cm:
            self.store.set_default_qth("Nope")
        self.assertEqual((cm.exception.code, cm.exception.status), ("NOT_FOUND", 404))
        self.assertIsNone(self.store.default_qth())

    def test_set_default_keeps_other_settings_keys(self):
        write_json_atomic(self.cfg.data_dir / "settings.json", {"future_key": 1})
        self.store.put_qth(thbk())
        self.store.set_default_qth("THBK")
        settings = json.loads((self.cfg.data_dir / "settings.json").read_text(encoding="utf-8"))
        self.assertEqual(settings, {"future_key": 1, "default_qth": "THBK"})

    def test_deleting_the_default_moves_it_to_first_remaining(self):
        for name in ("Zeta", "Alpha", "Mid"):
            self.store.put_qth(Qth(name=name))
        self.store.set_default_qth("Mid")
        self.store.delete_qth("Zeta")
        self.assertEqual(self.store.default_qth(), "Mid")
        self.store.delete_qth("Mid")
        self.assertEqual(self.store.default_qth(), "Alpha")

    def test_default_pointing_at_missing_file_reads_as_none(self):
        self.store.put_qth(thbk())
        self.store.set_default_qth("THBK")
        (self.cfg.data_dir / "qth" / "THBK.json").unlink()
        self.assertIsNone(self.store.default_qth())


class ReplaceQthTests(StoreTestCase):
    """Store.replace_qth: แทนทั้งชุดสถานีและสถานีตั้งต้นในครั้งเดียวแบบ OK ของ Preferences → Ground Stations (spec งานย่อย 4 §4)
    ตรวจทุกอย่างก่อนแตะดิสก์ module ที่ใช้สถานีที่หายเปลี่ยนเป็น ** DEFAULT ** ก่อนไฟล์สถานีถูกลบ"""

    def setUp(self):
        super().setUp()
        self.alpha = Qth(name="Alpha", location="Alpha town", lat_deg=10.0, lon_deg=20.0, alt_m=5.0)
        self.beta = Qth(name="Beta", location="Beta town", lat_deg=30.0, lon_deg=40.0, alt_m=6.0)
        self.store.put_qth(self.alpha)
        self.store.put_qth(self.beta)
        self.store.set_default_qth("Alpha")

    def put_module(self, name: str, qth: str | None) -> None:
        self.store.put_module(module_from_dict({"name": name, "qth": qth, "satellites": [25544]}, None, None))

    def module_file(self, name: str) -> Path:
        return self.cfg.data_dir / "modules" / f"{name}.json"

    def snapshot(self) -> dict[str, bytes]:
        return {str(p.relative_to(self.cfg.data_dir)): p.read_bytes()
                for p in sorted(self.cfg.data_dir.rglob("*")) if p.is_file()}

    def test_batch_replaces_whole_set(self):
        edited = replace(self.beta, location="Beta moved", lat_deg=31.5)
        gamma = Qth(name="Gamma", description="new", location="Gamma town", lat_deg=-5.0, lon_deg=100.0, alt_m=12.0)
        self.assertEqual(self.store.replace_qth([edited, gamma], "Gamma"), [])
        self.assertEqual(self.store.qth_names(), ["Beta", "Gamma"])
        self.assertFalse((self.cfg.data_dir / "qth" / "Alpha.json").exists())          # ไฟล์ที่ไม่อยู่ในรายการหายไป
        self.assertEqual(self.store.get_qth("Beta"), edited)
        self.assertEqual(self.store.get_qth("Gamma"), gamma)
        self.assertEqual(self.store.default_qth(), "Gamma")
        self.assertEqual(Store(self.cfg.data_dir).default_qth(), "Gamma")             # อยู่บนดิสก์ ไม่ใช่แค่ในหน่วยความจำ

    def test_batch_delete_in_use_and_default(self):
        """Review Focus 4: ลบสถานีตั้งต้นพร้อมสถานีที่ module ใช้ใน OK ครั้งเดียว ไม่ล้ม module เป็น ** DEFAULT ** และบันทึกทันที"""
        self.put_module("Mir", "Alpha")                  # ใช้สถานีที่ถูกลบ
        self.put_module("Nova", None)                    # ใช้ ** DEFAULT ** (= Alpha ที่ถูกลบ) ไฟล์ไม่ต้องเปลี่ยน
        self.put_module("Kept", "Beta")                  # ใช้สถานีที่ยังอยู่
        before = {n: self.module_file(n).read_bytes() for n in ("Nova", "Kept")}
        with self.assertLogs("gpredict_web.store", "ERROR") as logs:
            changed = self.store.replace_qth([self.beta], "Beta")
        self.assertEqual(changed, ["Mir"])
        self.assertEqual(len(logs.records), 1)
        text = logs.records[0].getMessage()
        self.assertIn("Mir", text)
        self.assertIn("Alpha", text)
        self.assertIsNone(self.store.get_module_own("Mir")["qth"])
        self.assertIsNone(json.loads(self.module_file("Mir").read_text(encoding="utf-8"))["qth"])
        self.assertEqual({n: self.module_file(n).read_bytes() for n in ("Nova", "Kept")}, before)
        self.assertEqual(self.store.get_module("Kept").qth, "Beta")
        self.assertEqual(self.store.get_module("Mir").satellites, [25544])             # ค่าอื่นของ module ไม่เปลี่ยน
        self.assertEqual((self.store.qth_names(), self.store.default_qth()), (["Beta"], "Beta"))
        self.assertEqual(self.store.modules_using_qth("Beta"), ["Kept", "Mir", "Nova"])

    def test_batch_changed_modules_are_sorted_by_name(self):
        for name in ("Zed", "Amy", "Bob"):
            self.put_module(name, "Alpha")
        with self.assertLogs("gpredict_web.store", "ERROR"):
            self.assertEqual(self.store.replace_qth([self.beta], "Beta"), ["Amy", "Bob", "Zed"])

    def test_batch_empty_is_qth_last(self):
        self.put_module("Mir", "Alpha")
        before = self.snapshot()
        with self.assertRaises(ApiError) as cm:
            self.store.replace_qth([], "Alpha")
        self.assertEqual((cm.exception.code, cm.exception.status), ("QTH_LAST", 422))
        self.assertRegex(cm.exception.text, r"[ก-๙]")
        self.assertEqual(self.snapshot(), before)

    def test_batch_duplicate_names_invalid(self):
        before = self.snapshot()
        for names in (("abc", "ABC"), ("Beta", "Beta"), ("x", "y", "Y")):
            with self.subTest(names=names), self.assertRaises(ApiError) as cm:
                self.store.replace_qth([Qth(name=n) for n in names], names[0])
            self.assertEqual((cm.exception.code, cm.exception.status, cm.exception.object), ("QTH_INVALID", 422, "name"))
            self.assertEqual(self.snapshot(), before)               # ผิดแล้วไม่มีไฟล์ไหนถูกเขียน

    def test_batch_default_must_be_in_the_list(self):
        before = self.snapshot()
        for default in ("Alpha", "beta", "", None, 5, ["Beta"]):     # "beta" ต่างตัวพิมพ์จาก Beta (เทียบชื่อเต็มตรงตัว)
            with self.subTest(default=default), self.assertRaises(ApiError) as cm:
                self.store.replace_qth([self.beta], default)
            self.assertEqual((cm.exception.code, cm.exception.status, cm.exception.object), ("QTH_INVALID", 422, "default"))
            self.assertEqual(self.snapshot(), before)

    def test_batch_invalid_station_writes_nothing(self):
        before = self.snapshot()
        for bad, field in ((replace(self.beta, lat_deg=91), "lat_deg"), (replace(self.beta, alt_m="high"), "alt_m"),
                           (Qth(name="bad name"), "name"), (replace(self.beta, location="x" * 51), "location")):
            with self.subTest(field=field), self.assertRaises(ApiError) as cm:
                self.store.replace_qth([Qth(name="Good"), bad], "Good")        # สถานีแรกถูก: ต้องไม่ถูกเขียนก่อนเจอตัวที่ผิด
            self.assertEqual((cm.exception.code, cm.exception.status, cm.exception.object), ("QTH_INVALID", 422, field))
            self.assertEqual(self.snapshot(), before)

    def test_batch_dry_run_changes_nothing(self):
        self.put_module("Mir", "Alpha")
        before = self.snapshot()
        with self.assertNoLogs("gpredict_web.store", "ERROR"):               # ยังไม่เกิดอะไรขึ้นจริง จึงไม่ log
            self.assertEqual(self.store.replace_qth([replace(self.beta, lat_deg=1.0), Qth(name="Gamma")], "Gamma", True),
                             ["Mir"])
        self.assertEqual(self.snapshot(), before)
        self.assertEqual((self.store.qth_names(), self.store.default_qth()), (["Alpha", "Beta"], "Alpha"))
        for stations, default, code in (([], "Alpha", "QTH_LAST"), ([Qth(name="a"), Qth(name="A")], "a", "QTH_INVALID"),
                                        ([self.beta], "Alpha", "QTH_INVALID")):
            with self.subTest(code=code), self.assertRaises(ApiError) as cm:
                self.store.replace_qth(stations, default, True)               # dry run ตรวจเหมือนจริง
            self.assertEqual(cm.exception.code, code)
        self.assertEqual(self.snapshot(), before)

    def test_default_matches_full_name(self):
        """Gpredict เทียบท้ายชื่อไฟล์ ("xsample" ตรงกับ "sample") ของเราเทียบชื่อเต็ม (spec §11)"""
        xsample, sample = Qth(name="xsample", location="X"), Qth(name="sample", location="S")
        self.store.replace_qth([xsample, sample], "sample")
        self.assertEqual(self.store.default_qth(), "sample")
        self.store.replace_qth([xsample, sample], "xsample")
        self.assertEqual(self.store.default_qth(), "xsample")
        with self.assertRaises(ApiError) as cm:                              # "sample" ไม่ใช่ชื่อในรายการ แม้เป็นท้ายของ "xsample"
            self.store.replace_qth([xsample], "sample")
        self.assertEqual((cm.exception.code, cm.exception.object), ("QTH_INVALID", "default"))
        self.assertEqual(self.store.default_qth(), "xsample")

    def test_batch_rename_that_only_changes_case(self):
        """ดิสก์ของ macOS ไม่แยกตัวพิมพ์: "abc" → "ABC" ต้องไม่ลบไฟล์ที่เพิ่งเขียน และไม่ทิ้งไฟล์ซ้ำบนดิสก์ที่แยกตัวพิมพ์"""
        self.store.put_qth(Qth(name="abc", location="old"))
        self.put_module("Mir", "abc")
        with self.assertLogs("gpredict_web.store", "ERROR"):
            self.assertEqual(self.store.replace_qth([Qth(name="ABC", location="new")], "ABC"), ["Mir"])
        self.assertEqual(self.store.qth_names(), ["ABC"])
        self.assertEqual(self.store.get_qth("ABC").location, "new")
        self.assertEqual(self.store.default_qth(), "ABC")

    def test_batch_rewrites_a_module_whose_other_fields_are_broken(self):
        """module ที่ช่องอื่นผิดก็ต้องไม่ค้างชี้สถานีที่หาย (Gpredict ลบ key QTHFILE โดยไม่ตรวจช่องอื่น) ไฟล์ที่ไม่ใช่ JSON ไม่ถูกแตะ"""
        modules = self.cfg.data_dir / "modules"
        modules.mkdir(parents=True, exist_ok=True)
        write_json_atomic(modules / "Odd.json", {"version": 2, "name": "Odd", "qth": "Alpha", "satellites": "oops"})
        (modules / "Junk.json").write_bytes(b"{")
        with self.assertLogs("gpredict_web.store", "ERROR") as logs:
            self.assertEqual(self.store.replace_qth([self.beta], "Beta"), ["Odd"])
        self.assertEqual(json.loads((modules / "Odd.json").read_text(encoding="utf-8")),
                         {"version": 2, "name": "Odd", "qth": None, "satellites": "oops"})
        self.assertEqual((modules / "Junk.json").read_bytes(), b"{")
        self.assertIn("Odd", logs.records[0].getMessage())

    def test_batch_failure_never_leaves_a_module_on_a_missing_station(self):
        """ลำดับเขียน: สถานีใหม่ → สถานีตั้งต้น → module → ลบไฟล์เก่า: ดิสก์ล้มกลางทางแล้วไม่มี module หรือสถานีตั้งต้นชี้ไฟล์ที่หาย"""
        self.put_module("Mir", "Alpha")
        with mock.patch.object(Store, "put_module_own", side_effect=OSError("disk full")):
            with self.assertRaises(OSError):
                self.store.replace_qth([self.beta], "Beta")
        self.assertIn(self.store.get_module("Mir").qth, self.store.qth_names())
        self.assertIn(self.store.default_qth(), self.store.qth_names())
        self.assertEqual(self.store.default_qth(), "Beta")


class BootstrapFlagTests(StoreTestCase):
    """bootstrap_done ใน settings.json: module Amateur ถูกสร้างแล้ว (ผู้ใช้ลบ module หมดก็ไม่สร้างใหม่)"""

    def settings(self) -> dict:
        return json.loads((self.cfg.data_dir / "settings.json").read_text(encoding="utf-8"))

    def test_flag_is_unset_until_set(self):
        self.assertFalse(self.store.bootstrap_done())
        self.store.set_bootstrap_done()
        self.assertTrue(self.store.bootstrap_done())
        self.assertTrue(Store(self.cfg.data_dir).bootstrap_done())
        self.assertIs(self.settings()["bootstrap_done"], True)

    def test_flag_keeps_the_default_station_and_vice_versa(self):
        self.store.put_qth(thbk())
        self.store.set_default_qth("THBK")
        self.store.set_bootstrap_done()
        self.assertEqual(self.settings(), {"default_qth": "THBK", "bootstrap_done": True})
        self.store.put_qth(Qth(name="Other"))
        self.store.set_default_qth("Other")
        self.assertTrue(self.store.bootstrap_done())
        self.assertEqual(self.store.default_qth(), "Other")

    def test_only_true_counts_and_unreadable_settings_read_as_unset(self):
        for content in (b"{}", b'{"bootstrap_done": false}', b'{"bootstrap_done": "yes"}', b'{"bootstrap_done": 1}',
                        b"[]", b"{", b"\xff\xfe"):
            with self.subTest(content=content):
                (self.cfg.data_dir).mkdir(parents=True, exist_ok=True)
                (self.cfg.data_dir / "settings.json").write_bytes(content)
                self.assertFalse(self.store.bootstrap_done())
                self.assertIsNone(self.store.default_qth())


class AtomicWriteTests(StoreTestCase):
    def test_atomic_write_leaves_no_temp_files(self):
        target = self.cfg.data_dir / "sub" / "x.json"
        write_json_atomic(target, {"a": 1})
        write_json_atomic(target, {"a": 2, "b": "ก"})
        self.assertEqual(json.loads(target.read_text(encoding="utf-8")), {"a": 2, "b": "ก"})
        self.assertEqual([p.name for p in target.parent.iterdir()], ["x.json"])
        self.store.put_qth(thbk())
        self.store.set_default_qth("THBK")
        for d in (self.cfg.data_dir, self.cfg.data_dir / "qth"):
            self.assertFalse([p for p in d.iterdir() if p.name.endswith(".tmp")], d)

    def test_failed_write_keeps_old_file_and_cleans_up(self):
        target = self.cfg.data_dir / "x.json"
        write_json_atomic(target, {"a": 1})
        with self.assertRaises(TypeError):
            write_json_atomic(target, {"a": object()})
        self.assertEqual(json.loads(target.read_text(encoding="utf-8")), {"a": 1})
        self.assertEqual([p.name for p in target.parent.iterdir()], ["x.json"])


class ModuleInheritanceStoreTests(unittest.TestCase):
    """ไฟล์ module version 2 เก็บเฉพาะค่าที่ตั้งเอง ค่าที่ใช้จริง = ของ module → ค่ารวม (Prefs) → ค่าตั้งต้นของ Gpredict
    และการย้ายไฟล์เต็มแบบ core ตอนเปิด server (spec งานย่อย 4 §9.1, Review Focus 1)"""

    def setUp(self):
        self.cfg = temp_config(self)
        self.data = self.cfg.data_dir
        self.prefs = Prefs(self.data)
        self.store = Store(self.data, globals_=self.prefs.values)
        self.store.put_qth(thbk())
        self.store.set_default_qth("THBK")

    def module_file(self, name: str) -> Path:
        return self.data / "modules" / f"{name}.json"

    def backup_file(self, name: str) -> Path:
        return self.data / "modules" / "_backup_v1" / f"{name}.json"

    def file_json(self, name: str) -> dict:
        return json.loads(self.module_file(name).read_text(encoding="utf-8"))

    def write_v1(self, name: str = "Amateur", edit=None) -> bytes:
        """ไฟล์ module แบบ core จาก fixture (ชื่อ name, edit แก้ dict ก่อนเขียน) คืนไบต์ที่เขียน"""
        d = json.loads(V1_AMATEUR.read_text(encoding="utf-8"))
        d["name"] = name
        if edit is not None:
            edit(d)
        raw = (json.dumps(d, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
        self.module_file(name).parent.mkdir(parents=True, exist_ok=True)
        self.module_file(name).write_bytes(raw)
        return raw

    def write_raw(self, name: str, raw: bytes) -> None:
        self.module_file(name).parent.mkdir(parents=True, exist_ok=True)
        self.module_file(name).write_bytes(raw)

    def put(self, name: str = "M", pin=(), unpin=(), **over) -> None:
        m = module_from_dict({"name": name, "qth": None, "satellites": [25544, 43013], **over}, None, None)
        self.store.put_module(m, pin=pin, unpin=unpin)

    # ---- การย้ายไฟล์ของ core

    def test_migration_keeps_effective_values_and_backup(self):
        original = self.write_v1(edit=lambda d: d["map"].__setitem__("center_lon", 100))
        before = module_to_dict(self.store.get_module("Amateur"))
        names = self.store.migrate_modules()
        self.assertEqual(names, ["Amateur"])
        self.assertTrue(self.backup_file("Amateur").is_file())
        self.assertEqual(self.backup_file("Amateur").read_bytes(), original)          # สำเนาเดิมทุกไบต์
        own = self.store.get_module_own("Amateur")
        self.assertEqual(own["version"], 2)
        self.assertNotIn("layout_code", own)
        self.assertEqual(own["map"]["center_lon"], 100)
        self.assertEqual(module_to_dict(self.store.get_module("Amateur")), before)
        fixture = json.loads(V1_AMATEUR.read_text(encoding="utf-8"))
        self.assertEqual(self.file_json("Amateur"), {
            "version": 2, "name": "Amateur", "qth": "THBK", "satellites": fixture["satellites"],
            "list_sort": {"column": "Satellite", "ascending": True}, "single": {"selected": fixture["single"]["selected"]},
            "footprint_off": [], "ground_track": [], "sky_track": [], "window": WINDOW_DEFAULT,
            "map": {"center_lon": 100}})
        self.assertEqual(self.store.list_modules(), ["Amateur"])                       # โฟลเดอร์สำเนาไม่ใช่ module

    def test_migration_runs_once(self):
        original = self.write_v1()
        self.assertEqual(self.store.migrate_modules(), ["Amateur"])
        migrated = self.module_file("Amateur").read_bytes()
        self.assertEqual(self.store.migrate_modules(), [])
        self.assertEqual(Store(self.data, globals_=self.prefs.values).migrate_modules(), [])     # เปิด server อีกครั้ง
        self.assertEqual(self.module_file("Amateur").read_bytes(), migrated)
        self.assertEqual(self.backup_file("Amateur").read_bytes(), original)          # สำเนาไม่ถูกทับ
        self.assertEqual(sorted(p.name for p in self.backup_file("Amateur").parent.iterdir()), ["Amateur.json"])

    def test_migrated_core_file_inherits_every_global(self):
        """ไฟล์ของ core ที่ไม่เคยแก้ค่า: ทุกค่าที่สืบทอดได้ถูกลบ (ค่าเท่าค่าตั้งต้น หรือไม่มีในไฟล์ เช่น map.file และสี)"""
        self.write_v1()
        self.store.migrate_modules()
        own = self.store.get_module_own("Amateur")
        self.assertEqual(set(own), MODULE_ONLY_KEYS)
        for path in MODULE_KEYS:
            with self.subTest(path), self.assertRaises(KeyError):
                get_path(own, path)
        self.prefs.update({"MODULES/MAP_FILE": "earth_800.png", "MODULES/POLAR_CHART_ORIENT": "S/W/N/E",
                           "MODULES/MAP_TRACK_NUM": 9}, [])
        m = self.store.get_module("Amateur")
        self.assertEqual((m.map["file"], m.polar["orientation"], m.map["track_orbits"]), ("earth_800.png", "S/W/N/E", 9))

    def test_migration_strips_against_the_current_globals(self):
        """เทียบกับค่ารวมที่ใช้อยู่ (Prefs.values) ไม่ใช่ค่าตั้งต้น: ค่าที่ใช้จริงของทุก module จึงไม่เปลี่ยน"""
        self.prefs.update({"MODULES/MAP_CENTER": 100, "MODULES/MAP_TRACK_NUM": 5}, [])
        self.write_v1("Same", edit=lambda d: d["map"].__setitem__("center_lon", 100))
        self.write_v1("Core")                                         # center_lon 0 = ค่าตั้งต้นแต่ไม่เท่าค่ารวม 100
        before = {n: self.store.get_module(n) for n in ("Core", "Same")}
        self.assertEqual(before["Core"].map["center_lon"], 0)                     # ค่าในไฟล์ของ core ชนะค่ารวม
        self.assertEqual(self.store.migrate_modules(), ["Core", "Same"])
        self.assertEqual(self.store.get_module_own("Core")["map"], {"center_lon": 0, "track_orbits": 3})
        self.assertEqual(self.store.get_module_own("Same")["map"], {"track_orbits": 3})
        for n, m in before.items():
            self.assertEqual(self.store.get_module(n), m, n)

    def test_migration_keeps_paths_missing_from_the_file_inheriting(self):
        def drop(d):
            del d["polar"]
            del d["map"]["track_orbits"]
            del d["refresh"]["map"]
        self.prefs.update({"MODULES/POLAR_CHART_ORIENT": "S/E/N/W", "MODULES/MAP_TRACK_NUM": 7}, [])
        self.write_v1(edit=drop)
        before = self.store.get_module("Amateur")
        self.assertEqual((before.polar["orientation"], before.map["track_orbits"]), ("S/E/N/W", 7))
        self.assertEqual(self.store.migrate_modules(), ["Amateur"])
        own = self.store.get_module_own("Amateur")
        for path in (*PAGE_PATHS["polar"], "map.track_orbits", "refresh.map"):
            with self.subTest(path), self.assertRaises(KeyError):
                get_path(own, path)
        self.assertEqual(self.store.get_module("Amateur"), before)
        self.prefs.update({"MODULES/POLAR_CHART_ORIENT": "N/W/S/E", "MODULES/MAP_REFRESH": 20}, [])
        m = self.store.get_module("Amateur")
        self.assertEqual((m.polar["orientation"], m.refresh["map"]), ("N/W/S/E", 20))

    def test_migration_without_prefs_uses_gpredict_defaults(self):
        store = Store(self.data)                                       # globals_=None: ค่าตั้งต้นของ Gpredict แบบ core
        self.write_v1(edit=lambda d: d["map"].__setitem__("center_lon", 100))
        before = store.get_module("Amateur")
        self.assertEqual(store.migrate_modules(), ["Amateur"])
        self.assertEqual(store.get_module_own("Amateur")["map"], {"center_lon": 100})
        self.assertEqual(set(store.get_module_own("Amateur")), MODULE_ONLY_KEYS | {"map"})
        self.assertEqual(store.get_module("Amateur"), before)

    def test_migration_leaves_broken_files_untouched_and_logs(self):
        """ไฟล์ที่แก้ด้วยมือจนเสียไม่ถูกย้ายหรือสำเนา (log WARNING ทีละไฟล์) ไฟล์อื่นย้ายตามปกติ และเปิด server ได้"""
        self.write_v1("Good")
        broken = {
            "NotJson": b"{", "NotUtf8": b"\xff\xfe", "NotObject": b"[1]",
            "BadValue": json.dumps({"name": "BadValue", "satellites": [1], "refresh": {"data_ms": 5}}).encode(),
            "BadSection": json.dumps({"name": "BadSection", "satellites": [1], "map": 5}).encode(),
            "OtherName": json.dumps({"name": "Else", "satellites": [1]}).encode(),
        }
        for name, raw in broken.items():
            self.write_raw(name, raw)
        with self.assertLogs("gpredict_web.store", "WARNING") as logs:
            names = self.store.migrate_modules()
        self.assertEqual(names, ["Good"])
        self.assertEqual(len(logs.output), len(broken))
        for name, raw in broken.items():
            with self.subTest(name):
                self.assertEqual(self.module_file(name).read_bytes(), raw)
                self.assertFalse(self.backup_file(name).exists())
                self.assertIn(name, "\n".join(logs.output))
        self.assertEqual(self.file_json("Good")["version"], 2)

    def test_migration_never_overwrites_a_backup(self):
        original = self.write_v1()
        self.backup_file("Amateur").parent.mkdir(parents=True)
        self.backup_file("Amateur").write_bytes(b"older copy")
        with self.assertLogs("gpredict_web.store", "WARNING") as logs:
            self.assertEqual(self.store.migrate_modules(), [])               # เก็บสำเนาไม่ได้ จึงไม่ย้าย
        self.assertIn("_backup_v1", "\n".join(logs.output))
        self.assertEqual(self.backup_file("Amateur").read_bytes(), b"older copy")
        self.assertEqual(self.module_file("Amateur").read_bytes(), original)
        self.backup_file("Amateur").write_bytes(original)                   # สำเนาเดียวกัน (ผู้ใช้คืนไฟล์จากสำเนา): ย้ายได้
        self.assertEqual(self.store.migrate_modules(), ["Amateur"])
        self.assertEqual(self.backup_file("Amateur").read_bytes(), original)
        self.assertEqual(self.file_json("Amateur")["version"], 2)

    def test_core_file_before_migration_reads_with_inheritance(self):
        raw = self.write_v1(edit=lambda d: d["map"].__setitem__("center_lon", 100))
        own = self.store.get_module_own("Amateur")
        self.assertEqual((own["version"], own["map"]), (2, {"center_lon": 100}))
        self.assertEqual(self.module_file("Amateur").read_bytes(), raw)           # อ่านอย่างเดียว ไม่ย้าย
        self.prefs.update({"MODULES/MAP_FILE": "earth_800.png"}, [])              # ไฟล์ของ core ไม่มี map.file: สืบทอด
        m = self.store.get_module("Amateur")
        self.assertEqual((m.map["center_lon"], m.map["file"]), (100, "earth_800.png"))

    # ---- ค่าที่ใช้จริงและการบันทึก

    def test_global_change_reaches_unpinned_module(self):
        self.put("Free")
        self.put("Pinned", pin=["layout_code"], layout_code="1;0;2;0;1")
        self.prefs.update({"MODULES/GRID": "0;0;2;0;1"}, [])
        self.assertEqual(self.store.get_module("Free").layout_code, "0;0;2;0;1")
        self.assertEqual(self.store.get_module("Pinned").layout_code, "1;0;2;0;1")
        self.prefs.update({}, ["MODULES/GRID"])
        self.assertEqual(self.store.get_module("Free").layout_code, DEFAULT_LAYOUT_CODE)

    def test_open_runtime_keeps_old_globals_until_reload(self):
        self.put("M")
        ephem = EphemManager(self.cfg, find_console=lambda: Path("/fake/GmatConsole"), start_worker=False)
        self.addCleanup(ephem.close)
        hub = Hub(self.store, SatDb(self.data / "satdb.json"), ephem, FakeNow(), prefs=self.prefs)
        rt = hub.open("M")
        self.addCleanup(hub.close, "M")
        self.assertEqual(rt.module.map["track_orbits"], 3)
        self.prefs.update({"MODULES/MAP_TRACK_NUM": 7}, [])
        self.assertIs(hub.open("M"), rt)
        self.assertEqual(rt.module.map["track_orbits"], 3)                    # ค่ารวมมีผลเมื่อ module ถูกสร้างใหม่
        self.assertEqual(self.store.get_module("M").map["track_orbits"], 7)
        hub.reload("M")
        self.assertEqual(rt.module.map["track_orbits"], 7)

    def test_put_module_without_pin_stores_only_module_fields(self):
        self.put("M", layout_code="1;0;2;0;1", refresh={"data_ms": 700}, map={"center_lon": 10},
                 single={"fields": ["Azimuth"], "selected": 43013})
        self.assertEqual(set(self.file_json("M")), MODULE_ONLY_KEYS)
        self.assertEqual(self.file_json("M")["single"], {"selected": 43013})
        m = self.store.get_module("M")
        self.assertEqual((m.layout_code, m.refresh["data_ms"], m.map["center_lon"]), (DEFAULT_LAYOUT_CODE, 300, 0))
        self.assertEqual(m.single["selected"], 43013)
        self.assertEqual(m.single["fields"], self.prefs.get("MODULES/SINGLE_SAT_FIELDS"))

    def test_put_module_pin_and_unpin(self):
        self.put("M", pin=["layout_code", "map.center_lon"], layout_code="1;0;2;0;1", map={"center_lon": 10})
        self.assertEqual((self.file_json("M")["layout_code"], self.file_json("M")["map"]), ("1;0;2;0;1", {"center_lon": 10}))
        # ค่าที่ตั้งไว้แล้วรับค่าใหม่จาก body ค่าที่ยังสืบทอดถูกข้าม
        self.put("M", layout_code="2;0;1;0;1", map={"center_lon": 20, "track_orbits": 9})
        m = self.store.get_module("M")
        self.assertEqual((m.layout_code, m.map["center_lon"], m.map["track_orbits"]), ("2;0;1;0;1", 20, 3))
        self.put("M", unpin=["layout_code"], layout_code="2;0;1;0;1", map={"center_lon": 20})
        self.assertNotIn("layout_code", self.file_json("M"))
        self.assertEqual(self.file_json("M")["map"], {"center_lon": 20})
        self.assertEqual(self.store.get_module("M").layout_code, DEFAULT_LAYOUT_CODE)

    def test_put_module_bad_pin_writes_nothing(self):
        for pin, unpin, field in ((["nope"], (), "pin"), (["window"], (), "pin"), (["map"], (), "pin"),
                                  ((), ["name"], "unpin"), (["layout_code"], ["layout_code"], "unpin")):
            with self.subTest(pin=pin, unpin=unpin), self.assertRaises(ApiError) as cm:
                self.put("M", pin=pin, unpin=unpin)
            self.assertEqual((cm.exception.code, cm.exception.status, cm.exception.object), ("MODULE_INVALID", 422, field))
        self.assertEqual(self.store.list_modules(), [])

    def test_put_module_keeps_the_window_of_the_file(self):
        self.put("M")
        own = self.store.get_module_own("M")
        own["window"] = {"state": 1, "x": 10, "y": 20, "width": 800, "height": 600}
        self.store.put_module_own("M", own)
        self.put("M", window={"state": 0, "x": 1, "y": 2, "width": 300, "height": 200})
        self.assertEqual(self.store.get_module("M").window, {"state": 1, "x": 10, "y": 20, "width": 800, "height": 600})

    def test_put_module_replaces_a_broken_file(self):
        self.write_raw("M", b"{")
        self.put("M", pin=["layout_code"], layout_code="1;0;2;0;1")
        self.assertEqual(self.store.get_module("M").layout_code, "1;0;2;0;1")
        self.write_raw("M", json.dumps({"version": 2, "name": "M", "satellites": [1], "refresh": {"data_ms": 5}}).encode())
        self.put("M")                                                         # ไฟล์เดิมค่าผิด: เขียนแทนเหมือน module ใหม่
        self.assertEqual(set(self.file_json("M")), MODULE_ONLY_KEYS)

    def test_put_module_own(self):
        self.put("M")
        own = self.store.get_module_own("M")
        del own["version"]
        own.update(qth="THBK", layout_code="0;0;2;0;1")
        self.store.put_module_own("M", own)
        self.assertEqual(self.file_json("M"), {"version": 2, **own})
        m = self.store.get_module("M")
        self.assertEqual((m.qth, m.layout_code), ("THBK", "0;0;2;0;1"))
        before = self.module_file("M").read_bytes()
        for label, bad, field in (("bad value", {**own, "layout_code": "1;0"}, "layout_code"),
                                  ("other name", {**own, "name": "Other"}, "name"),
                                  ("unknown qth", {**own, "qth": "GONE"}, "qth"),
                                  ("not an object", ["M"], None)):
            with self.subTest(label), self.assertRaises(ApiError) as cm:
                self.store.put_module_own("M", bad)
            self.assertEqual((cm.exception.code, cm.exception.status, cm.exception.object), ("MODULE_INVALID", 422, field))
        self.assertEqual(self.module_file("M").read_bytes(), before)

    def test_put_module_window(self):
        self.put("M", pin=["layout_code"], layout_code="1;0;2;0;1")
        before = self.file_json("M")
        got = self.store.put_module_window("M", {"state": 1, "width": 800})
        self.assertEqual(got, {**WINDOW_DEFAULT, "state": 1, "width": 800})
        self.assertEqual(self.store.put_module_window("M", {"x": 10, "y": 20, "height": 600}),
                         {"state": 1, "x": 10, "y": 20, "width": 800, "height": 600})     # ช่องที่ไม่ส่งคงเดิม
        self.assertEqual(self.store.put_module_window("M", {"x": None})["x"], None)         # null = ไม่มีค่า
        self.assertEqual(self.store.get_module("M").window, {"state": 1, "x": None, "y": 20, "width": 800, "height": 600})
        self.assertEqual({**self.file_json("M"), "window": before["window"]}, before)       # ไฟล์เปลี่ยนเฉพาะ window (ไม่ตรึงค่ารวม)
        self.assertEqual(self.store.put_module_window("M", {}), self.store.get_module("M").window)

    def test_put_module_window_invalid_writes_nothing(self):
        self.put("M")
        file = self.module_file("M")
        before = file.read_bytes()
        for label, bad, field in (("too small", {"width": 99}, "window.width"), ("too big", {"height": 10001}, "window.height"),
                                  ("negative", {"x": -1}, "window.x"), ("bad state", {"state": 2}, "window.state"),
                                  ("bool state", {"state": True}, "window.state"), ("unknown", {"w": 1}, "w"),
                                  ("one bad field spoils the rest", {"state": 1, "width": 1}, "window.width"),
                                  ("not an object", [1], "window")):
            with self.subTest(label), self.assertRaises(ApiError) as cm:
                self.store.put_module_window("M", bad)
            self.assertEqual((cm.exception.code, cm.exception.status, cm.exception.object), ("MODULE_INVALID", 422, field))
        self.assertEqual(file.read_bytes(), before)

    def test_put_module_window_missing_or_broken_module(self):
        with self.assertRaises(ApiError) as cm:
            self.store.put_module_window("Nope", {"state": 1})
        self.assertEqual((cm.exception.code, cm.exception.status, cm.exception.object), ("NOT_FOUND", 404, "Nope"))
        self.write_raw("M", b"{")
        with self.assertRaises(ApiError) as cm:
            self.store.put_module_window("M", {"state": 1})
        self.assertEqual((cm.exception.code, cm.exception.status), ("MODULE_INVALID", 422))
        self.assertEqual(self.module_file("M").read_bytes(), b"{")                           # ไม่เขียนทับไฟล์เสีย

    def test_put_module_window_does_not_undo_a_put_module_made_meanwhile(self):
        """อ่าน-แก้-เขียนอยู่ในล็อกเดียว: put_module ที่เริ่มตอน put_module_window อ่านไฟล์แล้วต้องรอ แล้วเขียนทับหลังจากนั้น
        (ไม่ใช่ถูกทับด้วยไฟล์ที่อ่านไว้ก่อน)"""
        self.put("M")
        meanwhile = []
        real_get_module = self.store.get_module

        def get_module_then_put_elsewhere(name):
            result = real_get_module(name)
            if not meanwhile:                                      # ครั้งแรกหลังอ่านไฟล์ ก่อนเขียน
                worker = threading.Thread(target=self.put, args=("M",), kwargs={"ground_track": [25544]})
                worker.start()
                worker.join(0.3)                                   # ล็อกไม่ได้ถือไว้ = จบทันที (ทับด้วยไฟล์ที่อ่านไว้) ถือไว้ = รอ
                meanwhile.append(worker)
            return result

        with mock.patch.object(self.store, "get_module", get_module_then_put_elsewhere):
            self.store.put_module_window("M", {"state": 1})
        meanwhile[0].join(5)
        own = self.store.get_module_own("M")
        self.assertEqual((own["ground_track"], own["window"]["state"]), ([25544], 1))

    def test_hand_broken_own_section_is_invalid_not_ignored(self):
        self.put("M")
        self.write_raw("M", json.dumps({**self.file_json("M"), "map": 5}).encode())
        with self.assertRaises(ApiError) as cm:
            self.store.get_module("M")
        self.assertEqual((cm.exception.code, cm.exception.status), ("MODULE_INVALID", 422))

    def test_hand_broken_global_map_file_does_not_break_modules(self):
        """MODULES/MAP_FILE ที่ไม่ใช่ชื่อไฟล์แผนที่ (แก้ preferences.json ด้วยมือ) ถูกข้ามตอนอ่าน ทุก module ที่สืบทอดยังใช้ได้"""
        self.put("M")
        (self.data / "preferences.json").write_text(json.dumps(
            {"version": 1, "values": {"MODULES/MAP_FILE": "../../secret.jpg", "MODULES/MAP_CENTER": 45}}), encoding="utf-8")
        with self.assertLogs("gpredict_web.prefs", "WARNING"):
            prefs = Prefs(self.data)
        m = Store(self.data, globals_=prefs.values).get_module("M")
        self.assertEqual((m.map["file"], m.map["center_lon"]), (DEFAULT_MAP, 45))


if __name__ == "__main__":
    unittest.main()
