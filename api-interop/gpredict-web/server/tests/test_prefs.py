"""prefs.py: ค่า Preferences ของ Gpredict (หัวข้อ 8.2 ของ spec งานย่อย 2) เก็บเฉพาะค่าที่ผู้ใช้ตั้งที่ data/preferences.json
ตรวจ schema ที่เดียว ค่าผิดตอบ PREFS_INVALID ข้อความไทยที่มีป้ายของ Gpredict และช่วง ใช้ data dir ชั่วคราวเสมอ"""

import json
import re
import threading
import unittest
from pathlib import Path
from unittest import mock

from gpredict_web import module as mod
from gpredict_web import prefs as prefs_module
from gpredict_web.errors import ApiError
from gpredict_web.prefs import (LOG_CLEAN_AGES, MULTI_PASS_COLUMNS, PREFS, SINGLE_PASS_COLUMNS, TIME_FORMAT_MAX, PrefSpec,
                                Prefs, validate)
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


# ---- งานย่อย 4: key ของ General และ Modules (ค่าตั้งต้นจาก sat-cfg.c และ ref-D §14 พิมพ์ซ้ำที่นี่โดยตั้งใจ ไม่อ่านจาก module.py)
DATA_BOOLS = {
    "GLOBAL/USE_LOCAL_TIME": False, "GLOBAL/USE_NSEW": False, "GLOBAL/USE_IMPERIAL": False,
    "GLOBAL/MAIN_WIN_POS": False, "GLOBAL/MOD_WIN_POS": False, "GLOBAL/MOD_STATE": False,
    "TLE/ADD_NEW_SATS": True,
    "MODULES/MAP_SAT_NAME": True, "MODULES/MAP_SAT_FOTPRINT": True, "MODULES/MAP_SAT_MARKER": True,
    "MODULES/MAP_QTH_INFO": True, "MODULES/MAP_NEXT_EVENT": True, "MODULES/MAP_CURSOR_TRACK": False,
    "MODULES/MAP_SHOW_GRID": True, "MODULES/MAP_SHOW_TERMINATOR": False,
    "MODULES/POLAR_SAT_NAME": True, "MODULES/POLAR_SAT_MARKER": True, "MODULES/POLAR_QTH_INFO": True,
    "MODULES/POLAR_NEXT_EVENT": True, "MODULES/POLAR_CURSOR_TRACK": True, "MODULES/POLAR_EXTRA_AZ_TICKS": False,
    "MODULES/POLAR_SHOW_TRACK_AUTO": False,
}
# (key, lo, hi, default) ของแถวจำนวนเต็มแบบช่วง
DATA_INT_ROWS = [
    ("GLOBAL/CURRENT_PAGE", -1, 999, -1),
    ("LOG/LEVEL", 0, 4, 2),
    ("MODULES/DATA_TIMEOUT", 100, 10000, 300),
    ("MODULES/LIST_REFRESH", 1, 50, 1),
    ("MODULES/MAP_REFRESH", 1, 50, 10),
    ("MODULES/POLAR_REFRESH", 1, 50, 3),
    ("MODULES/SINGLE_SAT_REFRESH", 1, 50, 1),
    ("MODULES/EVENT_LIST_REFRESH", 1, 50, 1),
    ("MODULES/MAP_TRACK_NUM", 1, 10, 3),
    ("MODULES/MAP_CENTER", -180, 180, 0),
    ("MODULES/MAP_SHADOW_ALPHA", 0, 255, 0xDD),
]
# สีเป็น int 0xRRGGBBAA (sat-cfg.c:166-180)
MAP_COLOUR_DEFAULTS = {
    "MODULES/MAP_QTH_COLOUR": 0x00FFFFFF, "MODULES/MAP_GRID_COLOUR": 0x7F7F7FC8, "MODULES/MAP_TICK_COLOUR": 0x7F7F7FC8,
    "MODULES/MAP_SAT_COLOUR": 0xF0F000FF, "MODULES/MAP_SELECTED_SAT_COLOUR": 0xFFFFFFFF,
    "MODULES/MAP_TRACK_COLOUR": 0xFF1200BB, "MODULES/MAP_COV_AREA_COLOUR": 0xFFFFFF1F,
    "MODULES/MAP_INFO_COLOUR": 0x00FF00FF, "MODULES/MAP_INFO_BGD_COLOUR": 0x000000FF,
    "MODULES/MAP_TERMINATOR_COLOUR": 0xFFFF0080, "MODULES/MAP_EARTH_SHADOW_COLOUR": 0x00000060,
}
POLAR_COLOUR_DEFAULTS = {
    "MODULES/POLAR_BGD_COLOUR": 0xFFFFFFFF, "MODULES/POLAR_AXIS_COLOUR": 0x0F0F0F7F, "MODULES/POLAR_TICK_COLOUR": 0x007F00FF,
    "MODULES/POLAR_SAT_COLOUR": 0x8F0000FF, "MODULES/POLAR_SELECTED_SAT_COL": 0xFF0D0BFF,
    "MODULES/POLAR_TRACK_COLOUR": 0x0000FFFF, "MODULES/POLAR_INFO_COLOUR": 0x00007FFF,
}
RGBA_KEYS = [*MAP_COLOUR_DEFAULTS, *POLAR_COLOUR_DEFAULTS]
# ref-D §4 / sat-cfg.c:235-246: 1 AMSAT + 10 CelesTrak (ตัวที่ 6 สะกด tlet ตามต้นฉบับ)
TLE_URLS = [
    "https://www.amsat.org/amsat/ftp/keps/current/nasabare.txt",
    "https://celestrak.org/NORAD/elements/gp.php?GROUP=amateur&FORMAT=tle",
    "https://celestrak.org/NORAD/elements/gp.php?GROUP=cubesat&FORMAT=tle",
    "https://celestrak.org/NORAD/elements/gp.php?GROUP=galileo&FORMAT=tle",
    "https://celestrak.org/NORAD/elements/gp.php?GROUP=glo-ops&FORMAT=tle",
    "https://celestrak.org/NORAD/elements/gp.php?GROUP=gps-ops&FORMAT=tlet",
    "https://celestrak.org/NORAD/elements/gp.php?GROUP=iridium-NEXT&FORMAT=tle",
    "https://celestrak.org/NORAD/elements/gp.php?GROUP=science&FORMAT=tle",
    "https://celestrak.org/NORAD/elements/gp.php?GROUP=last-30-days&FORMAT=tle",
    "https://celestrak.org/NORAD/elements/gp.php?GROUP=visual&FORMAT=tle",
    "https://celestrak.org/NORAD/elements/gp.php?GROUP=weather&FORMAT=tle",
]
# key ใหม่ทั้งหมดของงานย่อย 4 (ไม่รวมแถวที่งานย่อย 2 มีอยู่แล้ว) 63 ตัว
DATA_KEYS = [
    *DATA_BOOLS, *(k for k, *_ in DATA_INT_ROWS), "GLOBAL/TIME_FORMAT", "TLE/AUTO_UPDATE_FREQ", "TLE/AUTO_UPDATE_ACTION",
    "TLE/PROXY", "TLE/URLS", "TLE/LAST_UPDATE", "LOG/CLEAN_AGE", "MODULES/GRID", "MODULES/LIST_COLUMNS",
    "MODULES/SINGLE_SAT_FIELDS", "MODULES/MAP_FILE", "MODULES/POLAR_CHART_ORIENT", *RGBA_KEYS,
]
WEB_COLORS = Path(__file__).resolve().parents[2] / "web" / "src" / "colors.ts"


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
        self.assertEqual(set(PREFS), expected | set(DATA_KEYS))               # งานย่อย 4 เพิ่ม 63 key
        self.assertEqual(len(PREFS), 21 + len(DATA_KEYS))
        self.assertEqual(set(list(PREFS)[:21]), expected)                     # แถวของงานย่อย 2 อยู่ก่อน

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


def ts_colours(block: str) -> dict[str, int]:
    """ค่า 0xRRGGBBAA ของ `export const <block> = {...}` ใน web/src/colors.ts"""
    text = WEB_COLORS.read_text(encoding="utf-8")
    body = re.search(rf"export const {block} = \{{(.*?)\}} as const;", text, re.S).group(1)
    return {name: int(value, 16) for name, value in re.findall(r"(\w+):\s*0x([0-9a-fA-F]{8})", body)}


class PrefsDataKeysTest(PrefsTestCase):
    """งานย่อย 4 task 1: key ของ General, TLE, LOG และ Modules (ref-D §14, sat-cfg.c)"""

    def test_tle_urls_default_is_gpredict_list(self):
        urls = Prefs(self.cfg.data_dir).get("TLE/URLS")
        self.assertEqual(len(urls), 11)
        self.assertEqual(urls[0], "https://www.amsat.org/amsat/ftp/keps/current/nasabare.txt")
        self.assertEqual(urls[5], "https://celestrak.org/NORAD/elements/gp.php?GROUP=gps-ops&FORMAT=tlet")
        self.assertEqual(urls, TLE_URLS)                                      # ครบทั้ง 11 ตัว ตามลำดับ ทุกตัวอักษร
        self.assertEqual(validate("TLE/URLS", urls), urls)

    def test_defaults_match_gpredict(self):
        for key, default in DATA_BOOLS.items():
            self.assertIs(PREFS[key].default, default, key)
        for key, _, _, default in DATA_INT_ROWS:
            self.assertEqual(PREFS[key].default, default, key)
        for key, default in {**MAP_COLOUR_DEFAULTS, **POLAR_COLOUR_DEFAULTS}.items():
            self.assertEqual(PREFS[key].default, default, key)
        for key, default in (("GLOBAL/TIME_FORMAT", "%Y/%m/%d %H:%M:%S"), ("TLE/AUTO_UPDATE_FREQ", 2),
                             ("TLE/AUTO_UPDATE_ACTION", 1), ("TLE/PROXY", ""), ("TLE/LAST_UPDATE", 0), ("LOG/CLEAN_AGE", 0),
                             ("MODULES/GRID", "1;0;2;0;1;2;0;1;1;2;3;1;2;1;2"), ("MODULES/MAP_FILE", "nasa-bmng-07_1024.jpg"),
                             ("MODULES/POLAR_CHART_ORIENT", "N/E/S/W")):
            self.assertEqual(PREFS[key].default, default, key)
        self.assertEqual(Prefs(self.cfg.data_dir).get("MODULES/LIST_COLUMNS"), mod.LIST_DEFAULT)
        self.assertEqual(len(DATA_KEYS), 63)
        self.assertEqual(len(set(DATA_KEYS)), 63)

    def test_module_defaults_match_module_py(self):
        p = self.prefs()
        self.assertEqual(p.get("MODULES/GRID"), mod.DEFAULT_LAYOUT_CODE)
        self.assertEqual(p.get("MODULES/LIST_COLUMNS"), mod.LIST_DEFAULT)
        self.assertEqual(p.get("MODULES/SINGLE_SAT_FIELDS"), mod.SINGLE_DEFAULT)
        self.assertEqual(PREFS["MODULES/LIST_COLUMNS"].choices, mod.LIST_COLUMNS)
        self.assertEqual(PREFS["MODULES/SINGLE_SAT_FIELDS"].choices, mod.SINGLE_FIELDS)
        self.assertEqual(PREFS["MODULES/POLAR_CHART_ORIENT"].choices, mod.POLAR_ORIENTATIONS)
        self.assertEqual(p.get("MODULES/DATA_TIMEOUT"), mod.REFRESH_DEFAULT["data_ms"])
        for key, name in (("LIST_REFRESH", "list"), ("MAP_REFRESH", "map"), ("POLAR_REFRESH", "polar"),
                          ("SINGLE_SAT_REFRESH", "single"), ("EVENT_LIST_REFRESH", "event")):
            self.assertEqual(p.get(f"MODULES/{key}"), mod.REFRESH_DEFAULT[name], key)
            self.assertEqual((PREFS[f"MODULES/{key}"].lo, PREFS[f"MODULES/{key}"].hi), mod.CYCLE_RANGE, key)
        self.assertEqual((PREFS["MODULES/DATA_TIMEOUT"].lo, PREFS["MODULES/DATA_TIMEOUT"].hi), mod.DATA_MS_RANGE)
        self.assertEqual((PREFS["MODULES/MAP_TRACK_NUM"].lo, PREFS["MODULES/MAP_TRACK_NUM"].hi), mod.TRACK_ORBITS_RANGE)
        self.assertEqual((PREFS["MODULES/MAP_CENTER"].lo, PREFS["MODULES/MAP_CENTER"].hi), mod.CENTER_LON_RANGE)
        self.assertIs(p.get("MODULES/MAP_SAT_FOTPRINT"), True)                 # สะกดตาม Gpredict
        self.assertIs(p.get("MODULES/MAP_CURSOR_TRACK"), False)
        self.assertIs(p.get("MODULES/POLAR_CURSOR_TRACK"), True)
        map_keys = ("MAP_SAT_NAME", "MAP_SAT_FOTPRINT", "MAP_SAT_MARKER", "MAP_QTH_INFO", "MAP_NEXT_EVENT", "MAP_CURSOR_TRACK",
                    "MAP_SHOW_GRID", "MAP_SHOW_TERMINATOR")
        self.assertEqual({k: p.get(f"MODULES/{k}") for k in map_keys},
                         {k: n not in mod.MAP_DEFAULT_OFF for k, n in zip(map_keys, mod.MAP_CONTENTS)})
        polar_keys = ("POLAR_SAT_NAME", "POLAR_SAT_MARKER", "POLAR_QTH_INFO", "POLAR_NEXT_EVENT", "POLAR_CURSOR_TRACK",
                      "POLAR_EXTRA_AZ_TICKS")
        self.assertEqual({k: p.get(f"MODULES/{k}") for k in polar_keys},
                         {k: n not in mod.POLAR_DEFAULT_OFF for k, n in zip(polar_keys, mod.POLAR_CONTENTS)})
        self.assertEqual(p.get("MODULES/POLAR_SHOW_TRACK_AUTO"), mod.ModuleConfig("M").polar["auto_skytrack"])
        self.assertEqual(p.get("MODULES/POLAR_CHART_ORIENT"), mod.POLAR_ORIENTATIONS[0])
        self.assertEqual(p.get("MODULES/MAP_FILE"), mod.DEFAULT_MAP)
        self.assertEqual(p.get("MODULES/MAP_SHADOW_ALPHA"), mod.MAP_SHADOW_DEFAULT)
        self.assertEqual(p.get("MODULES/MAP_TRACK_NUM"), mod.TRACK_ORBITS_DEFAULT)
        self.assertEqual(p.get("MODULES/MAP_CENTER"), mod.CENTER_LON_DEFAULT)

    def test_colour_defaults_match_module_py_and_web_colors_ts(self):
        self.assertEqual(mod.MAP_SHADOW_DEFAULT, 0xDD)
        self.assertEqual(mod.DEFAULT_MAP, "nasa-bmng-07_1024.jpg")
        self.assertEqual(mod.MAP_COLOURS_DEFAULT, ts_colours("MAP_COLORS"))
        self.assertEqual(mod.POLAR_COLOURS_DEFAULT, ts_colours("POLAR_COLORS"))
        self.assertEqual((len(mod.MAP_COLOURS_DEFAULT), len(mod.POLAR_COLOURS_DEFAULT)), (11, 7))
        self.assertEqual(int(re.search(r"MAP_SHADOW_ALPHA = (0x[0-9a-fA-F]+)", WEB_COLORS.read_text()).group(1), 16),
                         mod.MAP_SHADOW_DEFAULT)
        # ชื่อสีของ decision 5 และ key ของ Gpredict (sat-cfg.c) ชี้ไปที่ค่าเดียวกัน
        by_name = {"MAP_QTH_COLOUR": "groundStation", "MAP_GRID_COLOUR": "grid", "MAP_TICK_COLOUR": "tick",
                   "MAP_SAT_COLOUR": "satellite", "MAP_SELECTED_SAT_COLOUR": "selected", "MAP_TRACK_COLOUR": "track",
                   "MAP_COV_AREA_COLOUR": "footprint", "MAP_INFO_COLOUR": "infoFg", "MAP_INFO_BGD_COLOUR": "infoBg",
                   "MAP_TERMINATOR_COLOUR": "terminator", "MAP_EARTH_SHADOW_COLOUR": "earthShadow"}
        self.assertEqual({f"MODULES/{k}": mod.MAP_COLOURS_DEFAULT[n] for k, n in by_name.items()}, MAP_COLOUR_DEFAULTS)
        by_name = {"POLAR_BGD_COLOUR": "background", "POLAR_AXIS_COLOUR": "axes", "POLAR_TICK_COLOUR": "tick",
                   "POLAR_SAT_COLOUR": "satellite", "POLAR_SELECTED_SAT_COL": "selected", "POLAR_TRACK_COLOUR": "track",
                   "POLAR_INFO_COLOUR": "info"}
        self.assertEqual({f"MODULES/{k}": mod.POLAR_COLOURS_DEFAULT[n] for k, n in by_name.items()}, POLAR_COLOUR_DEFAULTS)

    def test_every_new_default_is_valid_and_normalised(self):
        for key in DATA_KEYS:
            self.assertEqual(validate(key, PREFS[key].default), PREFS[key].default, key)

    def test_defaults_are_not_shared_with_module_py(self):
        p = self.prefs()
        p.get("MODULES/LIST_COLUMNS").append("Bogus")
        p.defaults()["MODULES/SINGLE_SAT_FIELDS"].clear()
        p.values()["TLE/URLS"].clear()
        self.assertEqual(mod.LIST_DEFAULT[-1], "Orbit")
        self.assertEqual(len(mod.SINGLE_DEFAULT), 16)
        self.assertEqual(len(p.get("TLE/URLS")), 11)

    def test_rgba_kind(self):
        key = "MODULES/MAP_QTH_COLOUR"
        for ok in (0, 0xFFFFFFFF, 0x00FFFFFF, 1, 0xFF1200BB):
            self.assertEqual(validate(key, ok), ok)
        for bad in (-1, 2 ** 32, True, False, "0xff", "255", 1.0, 0.5, None, [1], {"v": 1}, float("nan"), 10 ** 400):
            self.assert_invalid(key, bad)
        err = self.assert_invalid(key, -1, "Ground Station", "0xRRGGBBAA")
        self.assertRegex(err.text, r"[ก-๙]")
        for polar in ("MODULES/POLAR_BGD_COLOUR", "MODULES/POLAR_INFO_COLOUR"):
            self.assert_invalid(polar, 2 ** 32)
        self.prefs().update({key: 0x11223344}, [])
        self.assertEqual(self.raw()["values"], {key: 0x11223344})              # เก็บเป็น int ธรรมดา
        self.assertEqual(self.prefs().get(key), 0x11223344)

    def test_allowed_values(self):
        for age in LOG_CLEAN_AGES:
            self.assertEqual(validate("LOG/CLEAN_AGE", age), age)
        self.assertEqual(LOG_CLEAN_AGES, (0, 86400, 604800, 2592000))
        self.assertEqual(validate("LOG/CLEAN_AGE", 2592000), 2592000)
        err = self.assert_invalid("LOG/CLEAN_AGE", 18144000, "Delete log files older than", "0, 86400, 604800, 2592000")
        self.assertRegex(err.text, r"[ก-๙]")                                  # "1 month" ของ Gpredict (210 วัน) ไม่รับ
        for bad in (1, -1, 3600, True, False, 86400.0, "0", None):
            self.assert_invalid("LOG/CLEAN_AGE", bad)
        for freq in (0, 1, 2, 3):
            self.assertEqual(validate("TLE/AUTO_UPDATE_FREQ", freq), freq)
        for bad in (-1, 4, True, 2.0, "2"):
            self.assert_invalid("TLE/AUTO_UPDATE_FREQ", bad, "Check the age of TLE data")
        for action in (1, 2):
            self.assertEqual(validate("TLE/AUTO_UPDATE_ACTION", action), action)
        for bad in (0, 3, -1, True, 1.0, None):
            self.assert_invalid("TLE/AUTO_UPDATE_ACTION", bad, "If TLEs are too old")

    def test_urls_kind(self):
        key = "TLE/URLS"
        one = ["http://server.com/file.txt"]
        self.assertEqual(validate(key, one), one)
        self.assertEqual(validate(key, ["https://a/b?x=1&y=2", "http://c"]), ["https://a/b?x=1&y=2", "http://c"])
        self.assertEqual(validate(key, ["http://" + "a" * 493]), ["http://" + "a" * 493])        # 500 ตัวพอดี
        fifty = [f"https://h{i}.example/t" for i in range(50)]
        self.assertEqual(validate(key, fifty), fifty)
        for bad in ([], ["ftp://x"], ["https://a/b;c"], [fifty[0]] * 51, ["http://" + "a" * 494], ["https://a b"], ["https://a\n"],
                    ["https://a\tb"], ["http://"], ["https://"], ["HTTP://x"], ["x.com/y"], [""], [None], [5], [["http://a"]],
                    ["http://a", "ftp://b"], "http://a", None, 5, {"u": "http://a"}, ("http://a",), ["http://a\u00a0b"]):
            with self.subTest(bad=bad):
                self.assert_invalid(key, bad)
        err = self.assert_invalid(key, [], "TLE sources")
        self.assertRegex(err.text, r"[ก-๙]")
        self.assert_invalid(key, ["https://a/b;c"], "https://a/b;c")           # บอกว่า URL ไหนผิด
        self.prefs().update({key: one}, [])
        self.assertEqual(self.raw()["values"], {key: one})

    def test_time_format_max_len(self):
        key = "GLOBAL/TIME_FORMAT"
        self.assertEqual(TIME_FORMAT_MAX, 50)
        self.assertEqual(validate(key, "%" * 50), "%" * 50)
        self.assertEqual(validate(key, "ก" * 50), "ก" * 50)                    # นับตัวอักษร ไม่ใช่ไบต์
        self.assertEqual(validate(key, ""), "")
        self.assertEqual(validate(key, "%Y/%m/%d %H:%M:%S%"), "%Y/%m/%d %H:%M:%S%")
        err = self.assert_invalid(key, "%" * 51, "Time format", "50")
        self.assertRegex(err.text, r"[ก-๙]")
        for bad in (None, 5, ["%Y"], True):
            self.assert_invalid(key, bad, "Time format")

    def test_layout_kind(self):
        key = "MODULES/GRID"
        self.assertEqual(validate(key, "1;0;2;0;1"), "1;0;2;0;1")
        for _, code in mod.LAYOUT_PRESETS:
            self.assertEqual(validate(key, code), code)
        for bad in ("1;0;2", "", "1;0;2;0;1;", "5;0;2;0;1", "1;2;2;0;1", "1;0;2;1;1", "1;0;a;0;1", "1;0;2;0;-1", " 1;0;2;0;1",
                    "1;0;2;0;1\n", None, 5, ["1;0;2;0;1"], True, "1;0;2;0;" + "9" * 5000):
            with self.subTest(bad=bad):
                err = self.assert_invalid(key, bad, "Module layout")
                self.assertRegex(err.text, r"[ก-๙]")
        self.prefs().update({key: "1;0;2;0;1"}, [])
        self.assertEqual(self.prefs().get(key), "1;0;2;0;1")

    def test_new_int_ranges(self):
        for key, lo, hi, _ in DATA_INT_ROWS:
            with self.subTest(key=key):
                self.assertEqual(validate(key, lo), lo)
                self.assertEqual(validate(key, hi), hi)
                self.assert_invalid(key, lo - 1)
                self.assert_invalid(key, hi + 1)
                for bad in (True, False, float(lo), lo + 0.5, str(lo), None, [lo], float("nan")):
                    self.assert_invalid(key, bad)
        self.assertEqual(self.assert_invalid("LOG/LEVEL", 5, "Debug level").text, "Debug level ต้องเป็นจำนวนเต็ม 0–4")
        self.assert_invalid("MODULES/DATA_TIMEOUT", 99, "Refresh data every", "100–10000")
        self.assert_invalid("MODULES/MAP_TRACK_NUM", 11, "Display ground track for", "1–10")
        self.assert_invalid("MODULES/MAP_CENTER", 181, "Center map at longitude", "-180–180")
        self.assert_invalid("MODULES/MAP_SHADOW_ALPHA", 256, "Shadow", "0–255")

    def test_last_update_is_a_non_negative_int(self):
        key = "TLE/LAST_UPDATE"
        for ok in (0, 1, 1_763_000_000, 2 ** 40):
            self.assertEqual(validate(key, ok), ok)
        for bad in (-1, True, 1.5, 0.0, "0", None):
            self.assert_invalid(key, bad)
        self.assertRegex(self.assert_invalid(key, -1).text, r"0 ขึ้นไป")

    def test_bool_rows_are_strict(self):
        for key in DATA_BOOLS:
            self.assertIs(validate(key, True), True)
            self.assertIs(validate(key, False), False)
            for bad in (0, 1, "true", None, 1.0):
                self.assert_invalid(key, bad)
        self.assert_invalid("GLOBAL/USE_LOCAL_TIME", 1, "Show local time instead of UTC.", "true", "false")
        self.assert_invalid("MODULES/MAP_SAT_FOTPRINT", 1, "Satellite Footprint")

    def test_str_rows(self):
        orient = "MODULES/POLAR_CHART_ORIENT"
        for o in mod.POLAR_ORIENTATIONS:
            self.assertEqual(validate(orient, o), o)
        for bad in ("n/e/s/w", "N/E/S/W ", "N/S/E/W", "", 0, None, ["N/E/S/W"]):
            self.assert_invalid(orient, bad, "Orientation")
        self.assert_invalid(orient, "x", "N/E/S/W, N/W/S/E, S/E/N/W, S/W/N/E")
        file = "MODULES/MAP_FILE"
        self.assertEqual(validate(file, "x" * 100), "x" * 100)
        self.assertEqual(validate(file, "แผนที่.jpg"), "แผนที่.jpg")
        self.assert_invalid(file, "x" * 101, "100")
        for bad in (None, 5, ["a.jpg"]):
            self.assert_invalid(file, bad)
        proxy = "TLE/PROXY"
        for ok in ("", "http://my.proxy.com", "http://user:pw@my.proxy.com:3128", "x" * 200):
            self.assertEqual(validate(proxy, ok), ok)
        for bad in ("x" * 201, "http://my proxy", " http://p", "http://p ", "http://a;http://b", "http://p\n", "http://p\tq",
                    ";", "http://p\u3000q", None, 5, ["http://p"]):
            with self.subTest(bad=bad):
                err = self.assert_invalid(proxy, bad, "Proxy server")
                self.assertRegex(err.text, r"[ก-๙]")

    def test_list_and_single_columns(self):
        key = "MODULES/LIST_COLUMNS"
        self.assertEqual(validate(key, ["Orbit", "Satellite"]), ["Satellite", "Orbit"])      # เรียงตามลำดับคอลัมน์
        self.assertEqual(validate(key, []), [])
        self.assert_invalid(key, ["Satellite", "Bogus"], "List View", "Bogus")
        self.assert_invalid(key, ["Azimuth"])                                              # ชื่อช่องของ Single sat ใช้ไม่ได้
        key = "MODULES/SINGLE_SAT_FIELDS"
        self.assertEqual(validate(key, ["Visibility", "Azimuth"]), ["Azimuth", "Visibility"])
        self.assert_invalid(key, ["Az"], "Single Sat View")

    def test_values_defaults_and_user_cover_the_new_keys(self):
        p = self.prefs()
        p.update({"GLOBAL/USE_IMPERIAL": True, "MODULES/MAP_QTH_COLOUR": 5, "TLE/PROXY": "http://p"}, [])
        self.assertEqual(list(p.values()), list(PREFS))
        self.assertEqual(p.values()["GLOBAL/USE_IMPERIAL"], True)
        self.assertEqual(p.defaults()["GLOBAL/USE_IMPERIAL"], False)
        self.assertEqual(p.user_keys(), ["GLOBAL/USE_IMPERIAL", "TLE/PROXY", "MODULES/MAP_QTH_COLOUR"])
        self.assertEqual(self.prefs().get("TLE/PROXY"), "http://p")

    def test_a_bad_new_value_in_the_file_falls_back_to_its_default(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps({"version": 1, "values": {"MODULES/MAP_QTH_COLOUR": 2 ** 32, "LOG/LEVEL": 4,
                                                                  "TLE/URLS": ["ftp://x"]}}), encoding="utf-8")
        with self.assertLogs("gpredict_web.prefs", "WARNING") as logs:
            p = self.prefs()
        self.assertEqual((p.get("MODULES/MAP_QTH_COLOUR"), p.get("LOG/LEVEL")), (0x00FFFFFF, 4))
        self.assertEqual(p.get("TLE/URLS"), TLE_URLS)
        self.assertEqual(len(logs.output), 2)

    def test_pref_spec_has_optional_max_len_and_allowed(self):
        self.assertEqual(PrefSpec("str", "", max_len=5), PrefSpec("str", "", None, None, None, 5))
        self.assertEqual(PrefSpec("int", 1, allowed=(1, 2)), PrefSpec("int", 1, None, None, None, None, (1, 2)))
        self.assertEqual(PrefSpec("str", "").max_len, None)
        self.assertEqual(PrefSpec("int", 1).allowed, None)
        with self.assertRaises(TypeError):                                   # label ยังต้องระบุด้วยชื่อ
            PrefSpec("bool", True, None, None, None, None, None, "Label")
        self.assertEqual(PrefSpec("bool", True, label="L").label, "L")


class PrefsPreviewTest(PrefsTestCase):
    """dry run ของ PUT /api/prefs: ค่าหลังเปลี่ยนโดยไม่เขียนและไม่แตะค่าที่ใช้อยู่"""

    def test_preview_shows_the_values_after_update_without_writing(self):
        p = self.prefs()
        p.update({MIN_ELEV: 30, LOOK_AHEAD: 7}, [])
        before = self.path.read_bytes()
        view = p.preview({MIN_ELEV: 31, "GLOBAL/USE_NSEW": True}, [LOOK_AHEAD])
        self.assertEqual(view.get(MIN_ELEV), 31)
        self.assertEqual(view.get(LOOK_AHEAD), 3)
        self.assertEqual(view.user_keys(), [MIN_ELEV, "GLOBAL/USE_NSEW"])
        self.assertEqual(view.values()[MIN_ELEV], 31)
        self.assertEqual(view.defaults(), p.defaults())
        self.assertEqual((p.get(MIN_ELEV), p.get(LOOK_AHEAD), p.get("GLOBAL/USE_NSEW")), (30, 7, False))
        self.assertEqual(p.user_keys(), [MIN_ELEV, LOOK_AHEAD])
        self.assertEqual(self.path.read_bytes(), before)

    def test_preview_equals_what_update_then_gives(self):
        set_, remove = {MIN_ELEV: 31, COLOUR_KEYS[0]: "#ABCDEF", SINGLE: ["El", "Time"]}, ["PREDICT/NUMBER_OF_PASSES"]
        p = self.prefs()
        p.update({"PREDICT/NUMBER_OF_PASSES": 20}, [])
        view = p.preview(set_, remove)
        p.update(set_, remove)
        self.assertEqual(view.values(), p.values())
        self.assertEqual(view.user_keys(), p.user_keys())

    def test_preview_validates_like_update(self):
        p = self.prefs()
        for set_, remove in (({"PREDICT/NOPE": 1}, []), ({MIN_ELEV: 0}, []), ({}, ["PREDICT/NOPE"]), ({MIN_ELEV: 3}, [MIN_ELEV]),
                             ({MIN_ELEV: 30, LOOK_AHEAD: 99}, [])):
            with self.subTest(set_=set_, remove=remove):
                with self.assertRaises(ApiError) as cm:
                    p.preview(set_, remove)
                self.assertEqual((cm.exception.code, cm.exception.status), ("PREFS_INVALID", 422))
        self.assertFalse(self.path.exists())

    def test_preview_does_not_create_the_file_and_cannot_be_updated(self):
        p = self.prefs()
        view = p.preview({MIN_ELEV: 30}, [])
        self.assertFalse(self.path.exists())
        with self.assertRaises(TypeError):
            view.update({MIN_ELEV: 31}, [])
        self.assertFalse(self.path.exists())
        self.assertEqual(p.get(MIN_ELEV), 5)


if __name__ == "__main__":
    unittest.main()
