"""prefs.py: ค่า Preferences ของ Gpredict (หัวข้อ 8.2 ของ spec งานย่อย 2) เก็บเฉพาะค่าที่ผู้ใช้ตั้งที่ data/preferences.json
ตรวจ schema ที่เดียว ค่าผิดตอบ PREFS_INVALID ข้อความไทยที่มีป้ายของ Gpredict และช่วง ใช้ data dir ชั่วคราวเสมอ"""

import json
import threading
import unittest
from unittest import mock

from gpredict_web import prefs as prefs_module
from gpredict_web.errors import ApiError
from gpredict_web.prefs import MULTI_PASS_COLUMNS, PREFS, SINGLE_PASS_COLUMNS, PrefSpec, Prefs, validate
from tests.helpers import temp_config

MIN_ELEV = "PREDICT/MINIMUM_ELEV"
LOOK_AHEAD = "PREDICT/LOOK_AHEAD"
SINGLE = "PREDICT/SINGLE_PASS_COL"
MULTI = "PREDICT/MULTI_PASS_COL"
COLOUR_KEYS = [f"SKY_AT_GLANCE/COLOUR_{i:02d}" for i in range(1, 11)]

# (key, lo, hi, default) ของแถวจำนวนเต็มใน spec §8.2 (ref-P §9, §10)
INT_ROWS = [
    (MIN_ELEV, 1, 90, 5),
    ("PREDICT/NUMBER_OF_PASSES", 5, 50, 10),
    (LOOK_AHEAD, 1, 14, 3),
    ("PREDICT/TIME_RESOLUTION", 1, 600, 10),
    ("PREDICT/NUMBER_OF_ENTRIES", 10, 200, 20),
    ("PREDICT/TWILIGHT_THRESHOLD", -18, 0, -6),
    ("PREDICT/SAVE_CONTENTS", 0, 2, 0),
    ("SKY_AT_GLANCE/TIME_SPAN_HOURS", 1, 24, 8),
]
# ref-P §7.4: สีของดาวลำดับที่ 1..10
SKY_COLOURS = ["#3c46c8", "#00500a", "#d5472b", "#d06b38", "#cf477a",
               "#bf041f", "#688522", "#0420bf", "#a304bf", "#04bdbf"]


class PrefsTestCase(unittest.TestCase):
    def setUp(self):
        self.cfg = temp_config(self)
        self.path = self.cfg.data_dir / "preferences.json"

    def prefs(self) -> Prefs:
        return Prefs(self.cfg.data_dir)

    def raw(self) -> dict:
        return json.loads(self.path.read_text(encoding="utf-8"))

    def assert_invalid(self, key, value, *texts) -> ApiError:
        with self.assertRaises(ApiError) as cm:
            validate(key, value)
        err = cm.exception
        self.assertEqual((err.code, err.status, err.object), ("PREFS_INVALID", 422, key), (key, value))
        for t in texts:
            self.assertIn(t, err.text)
        return err


class PrefsStoreTest(PrefsTestCase):
    def test_defaults_without_file(self):
        p = self.prefs()
        self.assertEqual(p.get("PREDICT/MINIMUM_ELEV"), 5)
        self.assertEqual(p.get("PREDICT/SINGLE_PASS_COL"), ["Time", "Az", "El", "Range", "Footp"])
        self.assertEqual(p.get("PREDICT/MULTI_PASS_COL"), ["AOS", "LOS", "Duration", "Max El", "AOS Az", "LOS Az"])
        self.assertEqual(p.user_keys(), [])
        self.assertFalse(self.path.exists())                      # แค่อ่านไม่สร้างไฟล์

    def test_update_stores_only_user_keys(self):
        p = self.prefs()
        p.update({"PREDICT/MINIMUM_ELEV": 30}, [])
        raw = json.loads((self.cfg.data_dir / "preferences.json").read_text())
        self.assertEqual(raw, {"version": 1, "values": {"PREDICT/MINIMUM_ELEV": 30}})
        self.assertEqual(p.get(MIN_ELEV), 30)
        self.assertEqual(p.user_keys(), [MIN_ELEV])
        self.assertEqual(self.prefs().get(MIN_ELEV), 30)          # instance ใหม่อ่านจากไฟล์

    def test_remove_returns_to_default(self):
        p = self.prefs()
        p.update({MIN_ELEV: 30, LOOK_AHEAD: 7}, [])
        p.update({}, [MIN_ELEV])
        self.assertEqual(p.get(MIN_ELEV), 5)
        self.assertEqual(p.user_keys(), [LOOK_AHEAD])
        self.assertEqual(self.raw(), {"version": 1, "values": {LOOK_AHEAD: 7}})
        p.update({}, [LOOK_AHEAD, MIN_ELEV])                      # key ที่ยังไม่ได้ตั้งลบได้โดยไม่ error
        self.assertEqual(self.raw(), {"version": 1, "values": {}})
        self.assertEqual(self.prefs().user_keys(), [])

    def test_set_to_default_value_is_still_a_user_value(self):
        """ผู้ตั้งค่าเท่าค่าตั้งต้นก็ยังเป็นค่าของผู้ใช้ (ลบต้องสั่ง remove เอง เหมือน Reset ของ Gpredict)"""
        p = self.prefs()
        p.update({MIN_ELEV: 5}, [])
        self.assertEqual(p.user_keys(), [MIN_ELEV])
        self.assertEqual(self.raw()["values"], {MIN_ELEV: 5})

    def test_one_invalid_key_writes_nothing(self):
        p = self.prefs()
        with self.assertRaises(ApiError) as cm:
            p.update({"PREDICT/MINIMUM_ELEV": 30, "PREDICT/LOOK_AHEAD": 15}, [])
        self.assertEqual((cm.exception.code, cm.exception.status, cm.exception.object),
                         ("PREFS_INVALID", 422, "PREDICT/LOOK_AHEAD"))
        self.assertFalse(self.path.exists())
        self.assertEqual(p.get(MIN_ELEV), 5)
        self.assertEqual(p.user_keys(), [])

    def test_invalid_key_keeps_existing_file_and_values(self):
        p = self.prefs()
        p.update({MIN_ELEV: 30}, [])
        before = self.path.read_text(encoding="utf-8")
        for set_, remove in (({LOOK_AHEAD: 3, "PREDICT/NOPE": 1}, []),            # key ที่ไม่รู้จักใน set
                             ({LOOK_AHEAD: 3}, [MIN_ELEV, "PREDICT/NOPE"]),       # key ที่ไม่รู้จักใน remove (ไม่ลบ MIN_ELEV ด้วย)
                             ({LOOK_AHEAD: 3}, [LOOK_AHEAD])):                    # key เดียวกันทั้งใน set และ remove
            with self.assertRaises(ApiError) as cm:
                p.update(set_, remove)
            self.assertEqual((cm.exception.code, cm.exception.status), ("PREFS_INVALID", 422))
        self.assertEqual(self.path.read_text(encoding="utf-8"), before)
        self.assertEqual((p.get(MIN_ELEV), p.get(LOOK_AHEAD)), (30, 3))

    def test_failed_write_leaves_values_unchanged(self):
        p = self.prefs()
        with mock.patch.object(prefs_module, "write_json_atomic", side_effect=OSError("disk full")):
            with self.assertRaises(OSError):
                p.update({MIN_ELEV: 30}, [])
        self.assertEqual(p.get(MIN_ELEV), 5)
        self.assertEqual(p.user_keys(), [])

    def test_writes_through_write_json_atomic(self):
        p = self.prefs()
        with mock.patch.object(prefs_module, "write_json_atomic", wraps=prefs_module.write_json_atomic) as w:
            p.update({MIN_ELEV: 30}, [])
        w.assert_called_once_with(self.path, {"version": 1, "values": {MIN_ELEV: 30}})
        self.assertEqual(sorted(x.name for x in self.cfg.data_dir.iterdir()), ["preferences.json"])   # ไม่มีไฟล์ชั่วคราวค้าง

    def test_values_defaults_and_user_cover_every_key(self):
        p = self.prefs()
        p.update({MIN_ELEV: 30, COLOUR_KEYS[0]: "#112233"}, [])
        self.assertEqual(list(p.values()), list(PREFS))
        self.assertEqual(list(p.defaults()), list(PREFS))
        self.assertEqual(p.values()[MIN_ELEV], 30)
        self.assertEqual(p.defaults()[MIN_ELEV], 5)
        self.assertEqual(p.values()[COLOUR_KEYS[0]], "#112233")
        self.assertEqual(p.defaults()[COLOUR_KEYS[0]], SKY_COLOURS[0])
        self.assertEqual(p.user_keys(), [MIN_ELEV, COLOUR_KEYS[0]])       # เรียงตามตาราง ไม่ใช่ตามลำดับที่ตั้ง

    def test_returned_lists_are_copies(self):
        p = self.prefs()
        p.get(SINGLE).append("Bogus")
        p.values()[MULTI].clear()
        p.defaults()[SINGLE].clear()
        self.assertEqual(p.get(SINGLE), ["Time", "Az", "El", "Range", "Footp"])
        self.assertEqual(p.defaults()[MULTI], ["AOS", "LOS", "Duration", "Max El", "AOS Az", "LOS Az"])
        p.update({SINGLE: ["El"]}, [])
        p.get(SINGLE).append("Bogus")
        self.assertEqual(p.get(SINGLE), ["El"])

    def test_get_unknown_key_raises_key_error(self):
        with self.assertRaises(KeyError):
            self.prefs().get("PREDICT/NOPE")

    def test_concurrent_updates_are_all_kept(self):
        p = self.prefs()
        threads = [threading.Thread(target=p.update, args=({key: f"#0000{i:02x}"}, []))
                   for i, key in enumerate(COLOUR_KEYS)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        expected = {key: f"#0000{i:02x}" for i, key in enumerate(COLOUR_KEYS)}
        self.assertEqual(self.raw()["values"], expected)
        self.assertEqual(self.prefs().user_keys(), COLOUR_KEYS)

    def test_invalid_value_in_file_falls_back_to_default(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        text = json.dumps({"version": 1, "values": {MIN_ELEV: 500, LOOK_AHEAD: 7, "PREDICT/NOPE": 1,
                                                    SINGLE: ["Time", "Time"]}})
        self.path.write_text(text, encoding="utf-8")
        with self.assertLogs("gpredict_web.prefs", "WARNING") as logs:
            p = self.prefs()
        log = "\n".join(logs.output)
        for key in (MIN_ELEV, "PREDICT/NOPE", SINGLE):
            self.assertIn(key, log)
        self.assertNotIn(LOOK_AHEAD, log)                          # ข้ามเฉพาะ key ที่ผิด
        self.assertEqual(p.get(MIN_ELEV), 5)
        self.assertEqual(p.get(SINGLE), ["Time", "Az", "El", "Range", "Footp"])
        self.assertEqual(p.get(LOOK_AHEAD), 7)
        self.assertEqual(p.user_keys(), [LOOK_AHEAD])
        self.assertEqual(self.path.read_text(encoding="utf-8"), text)         # ไม่แก้และไม่ลบไฟล์

    def test_unreadable_file_falls_back_to_defaults(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        for content in (b"{not json", b"\xff\xfe", b"[1, 2]", b'{"version": 1}', b'{"version": 1, "values": [1]}', b""):
            with self.subTest(content=content):
                self.path.write_bytes(content)
                with self.assertLogs("gpredict_web.prefs", "WARNING"):
                    p = self.prefs()
                self.assertEqual(p.get(MIN_ELEV), 5)
                self.assertEqual(p.user_keys(), [])
                self.assertEqual(self.path.read_bytes(), content)          # ไม่ลบไฟล์
        self.path.unlink()
        self.path.mkdir()                                                   # อ่านไม่ได้เพราะเป็นโฟลเดอร์ (OSError)
        with self.assertLogs("gpredict_web.prefs", "WARNING"):
            self.assertEqual(self.prefs().user_keys(), [])

    def test_valid_file_loads_without_warning(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps({"version": 1, "values": {SINGLE: ["El", "Time"], COLOUR_KEYS[0]: "#ABCDEF"}}),
                             encoding="utf-8")
        with self.assertNoLogs("gpredict_web.prefs", "WARNING"):
            p = self.prefs()
        self.assertEqual(p.get(SINGLE), ["Time", "El"])                    # normalize ตอนอ่านด้วย
        self.assertEqual(p.get(COLOUR_KEYS[0]), "#abcdef")


class PrefsSchemaTest(PrefsTestCase):
    def test_defaults_match_gpredict(self):
        for key, _, _, default in INT_ROWS:
            self.assertEqual(PREFS[key].default, default, key)
        self.assertIs(PREFS["PREDICT/USE_REAL_T0"].default, False)
        self.assertEqual([PREFS[k].default for k in COLOUR_KEYS], SKY_COLOURS)

    def test_table_has_exactly_the_spec_rows(self):
        expected = {k for k, *_ in INT_ROWS} | {"PREDICT/USE_REAL_T0", SINGLE, MULTI, *COLOUR_KEYS}
        self.assertEqual(set(PREFS), expected)
        self.assertEqual(len(PREFS), 21)

    def test_every_default_is_valid_and_normalised(self):
        for key, spec in PREFS.items():
            self.assertEqual(validate(key, spec.default), spec.default, key)

    def test_column_names(self):
        self.assertEqual(SINGLE_PASS_COLUMNS, ("Time", "Az", "El", "Ra", "Dec", "Range", "Rate", "Lat", "Lon", "SSP",
                                               "Footp", "Alt", "Vel", "Dop", "Loss", "Del", "MA", "Phase", "Vis"))
        self.assertEqual(MULTI_PASS_COLUMNS, ("AOS", "TCA", "LOS", "Duration", "Max El", "AOS Az", "Max El Az",
                                              "LOS Az", "Orbit", "Vis"))
        self.assertEqual((len(SINGLE_PASS_COLUMNS), len(MULTI_PASS_COLUMNS)), (19, 10))
        self.assertEqual(PREFS[SINGLE].choices, SINGLE_PASS_COLUMNS)
        self.assertEqual(PREFS[MULTI].choices, MULTI_PASS_COLUMNS)

    def test_schema_ranges(self):
        for key, lo, hi, _ in INT_ROWS:
            self.assertEqual(validate(key, lo), lo, key)
            self.assertEqual(validate(key, hi), hi, key)
            self.assert_invalid(key, lo - 1)
            self.assert_invalid(key, hi + 1)
            for bad in (True, False, lo + 0.5, float(lo), str(lo), None, [lo], {"v": lo}, float("nan")):
                self.assert_invalid(key, bad)                       # ไม่ใช่จำนวนเต็ม (bool และ float ไม่นับ)
        self.assertIs(validate("PREDICT/USE_REAL_T0", True), True)
        self.assertIs(validate("PREDICT/USE_REAL_T0", False), False)
        for bad in (0, 1, 2, "true", "false", None, 1.0, [True]):
            self.assert_invalid("PREDICT/USE_REAL_T0", bad)          # bool รับแค่ True/False
        self.assert_invalid(MIN_ELEV, 10 ** 400)                    # int ใหญ่เกินไม่ล้ม

    def test_error_text_names_gpredict_label_and_range(self):
        self.assertEqual(self.assert_invalid(MIN_ELEV, 0).text, "Minimum elevation ต้องเป็นจำนวนเต็ม 1–90")
        self.assert_invalid("PREDICT/NUMBER_OF_PASSES", 4, "Number of passes to predict", "5–50")
        self.assert_invalid(LOOK_AHEAD, 15, "Passes should occur within", "1–14")
        self.assert_invalid("PREDICT/TIME_RESOLUTION", 601, "Time resolution", "1–600")
        self.assert_invalid("PREDICT/NUMBER_OF_ENTRIES", 9, "Number of entries", "10–200")
        self.assert_invalid("PREDICT/TWILIGHT_THRESHOLD", 1, "Twilight threshold", "-18–0")
        self.assert_invalid("PREDICT/USE_REAL_T0", 1, "Always use real time for pass predictions", "true", "false")
        self.assert_invalid("PREDICT/SAVE_CONTENTS", 3, "File contents", "0–2")
        self.assert_invalid("SKY_AT_GLANCE/TIME_SPAN_HOURS", 25, "Find and show passes that occur within", "1–24")
        self.assert_invalid(SINGLE, "Time", "Single Pass")
        self.assert_invalid(MULTI, "AOS", "Multiple Passes")
        self.assert_invalid(COLOUR_KEYS[2], "red", "Satellite 3", "#rrggbb")
        for key in (MIN_ELEV, SINGLE, COLOUR_KEYS[0], "PREDICT/USE_REAL_T0"):
            self.assertRegex(self.assert_invalid(key, object()).text, r"[ก-๙]")        # ข้อความถึงผู้ใช้เป็นภาษาไทย

    def test_columns_normalised_to_fixed_order(self):
        self.assertEqual(validate(SINGLE, ["El", "Time"]), ["Time", "El"])
        self.assertEqual(validate(SINGLE, ["Vis", "Footp", "Ra", "Az"]), ["Az", "Ra", "Footp", "Vis"])
        self.assertEqual(validate(MULTI, ["Vis", "Orbit", "AOS"]), ["AOS", "Orbit", "Vis"])
        self.assertEqual(validate(SINGLE, list(reversed(SINGLE_PASS_COLUMNS))), list(SINGLE_PASS_COLUMNS))
        self.assertEqual(validate(MULTI, []), [])                  # Gpredict ยอมให้ไม่เลือกคอลัมน์ใดเลย (flag 0)
        p = Prefs(self.cfg.data_dir)
        p.update({SINGLE: ["El", "Time"], MULTI: ["Vis", "AOS"]}, [])
        self.assertEqual(self.raw()["values"], {SINGLE: ["Time", "El"], MULTI: ["AOS", "Vis"]})
        for key, bad in ((SINGLE, ["Time", "Bogus"]), (SINGLE, ["Time", "Time"]), (SINGLE, ["Max El Az"]),   # ของ Multi ใช้กับ Single ไม่ได้
                         (MULTI, ["TCA", "Ra"]), (SINGLE, "Time"), (SINGLE, None), (SINGLE, [1]), (SINGLE, [["Time"]]),
                         (SINGLE, ("Time",)), (SINGLE, {"Time": True}), (SINGLE, ["time"])):
            with self.subTest(key=key, bad=bad):
                self.assert_invalid(key, bad)
        self.assert_invalid(SINGLE, ["Time", "Bogus"], "Bogus")
        self.assert_invalid(SINGLE, ["Time", "Time"], "Time")

    def test_colour_lowercased(self):
        key = COLOUR_KEYS[0]
        self.assertEqual(validate(key, "#FFAA00"), "#ffaa00")
        self.assertEqual(validate(key, "#ffaa00"), "#ffaa00")
        self.assertEqual(validate(key, "#0a1B2c"), "#0a1b2c")
        for bad in ("#ffaa0", "red", "#ffaa000", "ffaa00", "#gggggg", "#ffaa0\n", " #ffaa00", "#ffaa00 ", "", None, 0xffaa00,
                    "#ffaa00ff", "#ฟฟฟฟฟฟ", ["#ffaa00"]):
            self.assert_invalid(key, bad)
        Prefs(self.cfg.data_dir).update({COLOUR_KEYS[9]: "#ABCDEF"}, [])
        self.assertEqual(self.raw()["values"], {COLOUR_KEYS[9]: "#abcdef"})

    def test_unknown_key_invalid(self):
        self.assert_invalid("PREDICT/NOPE", 1, "PREDICT/NOPE")
        self.assert_invalid("", 1)
        self.assert_invalid("predict/minimum_elev", 5)             # ชื่อ key แยกตัวพิมพ์
        self.assert_invalid("SKY_AT_GLANCE/COLOUR_11", "#000000")
        self.assert_invalid("SKY_AT_GLANCE/COLOUR_1", "#000000")      # ต้อง _01
        with self.assertRaises(ApiError) as cm:
            Prefs(self.cfg.data_dir).update({"PREDICT/NOPE": 1}, [])
        self.assertEqual((cm.exception.code, cm.exception.object), ("PREFS_INVALID", "PREDICT/NOPE"))

    def test_pref_spec_fields_after_default_are_optional(self):
        """งานย่อย 3 และ 4 เพิ่มแถวและ field โดยไม่แก้แถวเดิม"""
        self.assertEqual(PrefSpec("bool", True), PrefSpec("bool", True, None, None, None))
        self.assertEqual(PrefSpec("int", 3, 1, 9), PrefSpec("int", 3, lo=1, hi=9))

    def test_float_and_str_kinds(self):
        rows = {"X/FLOAT": PrefSpec("float", 1.5, -2.5, 10.0, label="Some float"), "X/STR": PrefSpec("str", "", label="Some text")}
        with mock.patch.dict(PREFS, rows):
            self.assertEqual(validate("X/FLOAT", -2.5), -2.5)
            self.assertEqual(validate("X/FLOAT", 10), 10.0)
            self.assertIsInstance(validate("X/FLOAT", 10), float)
            err = self.assert_invalid("X/FLOAT", 10.5, "Some float", "-2.5–10.0")
            self.assertRegex(err.text, r"[ก-๙]")
            for bad in (-2.6, True, "1", None, float("nan"), float("inf")):
                self.assert_invalid("X/FLOAT", bad)
            self.assertEqual(validate("X/STR", "สวัสดี abc"), "สวัสดี abc")
            self.assertEqual(validate("X/STR", ""), "")
            for bad in (1, None, ["a"], True):
                self.assert_invalid("X/STR", bad, "Some text")
            p = Prefs(self.cfg.data_dir)
            p.update({"X/FLOAT": 3, "X/STR": "ก"}, [])
            self.assertEqual(self.raw()["values"], {"X/FLOAT": 3.0, "X/STR": "ก"})

    def test_label_falls_back_to_key(self):
        with mock.patch.dict(PREFS, {"X/NOLABEL": PrefSpec("bool", False)}):
            self.assert_invalid("X/NOLABEL", 1, "X/NOLABEL")


if __name__ == "__main__":
    unittest.main()
