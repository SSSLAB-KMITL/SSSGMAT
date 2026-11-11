import json
import re
import unittest
from pathlib import Path

from gpredict_web.config import MAX_SATS
from gpredict_web.errors import ApiError
from gpredict_web.module import (LAYOUT_PRESETS, LIST_COLUMNS, LIST_DEFAULT, LIST_HINTS, MAP_CONTENTS,
                                 MAP_DEFAULT_OFF, POLAR_CONTENTS, POLAR_DEFAULT_OFF, POLAR_ORIENTATIONS,
                                 SINGLE_DEFAULT, SINGLE_FIELDS, SINGLE_HINTS, ModuleConfig, ViewCell,
                                 module_from_dict, module_to_dict, parse_layout)
from gpredict_web.store import Qth, Store
from tests.helpers import temp_config

REFERENCE = Path(__file__).resolve().parents[2] / "docs" / "2026-11-11-gpredict-reference.md"

QTHS = {"THBK", "CNX"}
NORADS = {25544, 43013, 40069, 7530}


def station(name: str) -> Qth:
    return Qth(name=name, lat_deg=13.7, lon_deg=100.7, alt_m=6.0)


def build(**over) -> ModuleConfig:
    d = {"name": "A", "satellites": [25544, 43013]}
    d.update(over)
    return module_from_dict(d, QTHS, NORADS)


def reference_section(number: int) -> list[str]:
    lines = REFERENCE.read_text(encoding="utf-8").splitlines()
    start = next(i for i, ln in enumerate(lines) if ln.startswith(f"## {number}."))
    end = next(i for i in range(start + 1, len(lines)) if lines[i].startswith("## "))
    return lines[start:end]


def reference_rows(number: int) -> list[tuple[str, str, bool]]:
    """(title, hint, default ✔) ของตาราง §4 / §7 ใน reference"""
    row = re.compile(r'^\| (\d+) \| "(.*?)" \| "(.*?)" \|(.*)\|\s*$')
    return [(m.group(2), m.group(3), "✔" in m.group(4))
            for m in map(row.match, reference_section(number)) if m]


class ConstantsTests(unittest.TestCase):
    def test_sizes_and_defaults(self):
        self.assertEqual((len(LIST_COLUMNS), len(SINGLE_FIELDS), len(MAP_CONTENTS), len(POLAR_CONTENTS)),
                         (27, 23, 8, 6))
        self.assertEqual(LIST_DEFAULT, ["Satellite", "Az", "El", "Dir", "Range", "Next Event", "Alt", "Orbit"])
        self.assertEqual(MAP_DEFAULT_OFF, {"Cursor Position", "Solar Terminator"})
        self.assertEqual(POLAR_DEFAULT_OFF, {"Extra Az Ticks"})
        self.assertEqual(POLAR_ORIENTATIONS, ("N/E/S/W", "N/W/S/E", "S/E/N/W", "S/W/N/E"))
        self.assertEqual(MAP_CONTENTS[0], "Satellite Name")
        self.assertEqual(MAP_CONTENTS[-1], "Solar Terminator")
        self.assertEqual(POLAR_CONTENTS[-1], "Extra Az Ticks")
        self.assertLessEqual(MAP_DEFAULT_OFF, set(MAP_CONTENTS))
        self.assertLessEqual(POLAR_DEFAULT_OFF, set(POLAR_CONTENTS))
        self.assertEqual(len(SINGLE_DEFAULT), 16)
        self.assertEqual(len(set(LIST_COLUMNS)), 27)
        self.assertEqual(len(set(SINGLE_FIELDS)), 23)

    def test_every_field_has_a_hint(self):
        self.assertEqual(set(LIST_HINTS), set(LIST_COLUMNS))
        self.assertEqual(set(SINGLE_HINTS), set(SINGLE_FIELDS))
        self.assertEqual(LIST_HINTS["Dop"], "Doppler Shift @ 100MHz")
        self.assertEqual(SINGLE_HINTS["Slant Range"], "The range between satellite and observer")

    @unittest.skipUnless(REFERENCE.is_file(), "reference doc not found")
    def test_strings_match_reference_doc_verbatim(self):
        rows = reference_rows(4)
        self.assertEqual(list(LIST_COLUMNS), [t for t, _, _ in rows])
        self.assertEqual([LIST_HINTS[t] for t in LIST_COLUMNS], [h for _, h, _ in rows])
        self.assertEqual(LIST_DEFAULT, [t for t, _, d in rows if d])
        rows = reference_rows(7)
        self.assertEqual(list(SINGLE_FIELDS), [t for t, _, _ in rows])
        self.assertEqual([SINGLE_HINTS[t] for t in SINGLE_FIELDS], [h for _, h, _ in rows])
        self.assertEqual(SINGLE_DEFAULT, [t for t, _, d in rows if d])
        preset = re.compile(r'^\| (\d) \| "(.*?)"(?: \(default\))? \| `(.*?)` \|')
        presets = [(m.group(2), m.group(3)) for m in map(preset.match, reference_section(3)) if m]
        self.assertEqual(LAYOUT_PRESETS, presets)


class LayoutTests(unittest.TestCase):
    def test_preset0_layout(self):
        self.assertEqual(parse_layout(LAYOUT_PRESETS[0][1]),
                         [ViewCell(1, 0, 2, 0, 1), ViewCell(2, 0, 1, 1, 2), ViewCell(3, 1, 2, 1, 2)])

    def test_preset_labels_and_codes(self):
        self.assertEqual(len(LAYOUT_PRESETS), 9)
        self.assertEqual(LAYOUT_PRESETS[0], ("World map, polar and single sat", "1;0;2;0;1;2;0;1;1;2;3;1;2;1;2"))
        self.assertEqual(LAYOUT_PRESETS[2], ("Table", "0;0;2;0;1"))
        self.assertEqual(LAYOUT_PRESETS[8][0], "Map, table, polar and single sat (wide)")
        self.assertNotIn("Custom", [label for label, _ in LAYOUT_PRESETS])

    def test_all_presets_parse(self):
        for label, code in LAYOUT_PRESETS:
            with self.subTest(label):
                cells = parse_layout(code)
                self.assertTrue(cells)
                for c in cells:
                    self.assertIn(c.type, range(5))
                    self.assertTrue(0 <= c.left < c.right and 0 <= c.top < c.bottom)
        self.assertEqual({c.type for c in parse_layout(LAYOUT_PRESETS[7][1])}, {0, 1, 2, 3, 4})
        self.assertEqual(len(parse_layout(LAYOUT_PRESETS[6][1])), 5)

    def test_viewcell_is_frozen(self):
        with self.assertRaises(Exception):
            ViewCell(1, 0, 1, 0, 1).type = 2

    def test_bad_layout_codes(self):
        for bad in ("1;0;2;0", "5;0;1;0;1", "1;2;1;0;1", "a;0;1;0;1", "",
                    "1;0;1;0;1;", ";1;0;1;0;1", "1;0;1;0;1;2;0;1", "1;1;1;0;1", "1;0;1;1;1", "1;0;1;1;0",
                    "-1;0;1;0;1", "1;-1;1;0;1", "1; 0;1;0;1", "1;0;1;0;1\n", "1;0;1_0;0;1", "1;0;+1;0;1",
                    "1;0;١;0;1", "1,0,1,0,1", "1;0;1;0;1;;"):
            with self.subTest(bad), self.assertRaises(ValueError):
                parse_layout(bad)
        with self.assertRaises(ValueError):
            parse_layout(None)


class ModuleFromDictTests(unittest.TestCase):
    def test_defaults_match_gpredict(self):
        m = module_from_dict({"name": "A", "satellites": [25544]}, QTHS, NORADS)
        self.assertEqual(m.name, "A")
        self.assertIsNone(m.qth)
        self.assertEqual(m.satellites, [25544])
        self.assertEqual(m.layout_code, LAYOUT_PRESETS[0][1])
        self.assertEqual(m.refresh, {"data_ms": 300, "list": 1, "map": 10, "polar": 3, "single": 1, "event": 1})
        self.assertEqual(m.list_columns, ["Satellite", "Az", "El", "Dir", "Range", "Next Event", "Alt", "Orbit"])
        self.assertEqual(m.list_sort, {"column": "Satellite", "ascending": True})
        self.assertEqual(m.map["track_orbits"], 3)
        self.assertEqual(m.map["center_lon"], 0)
        self.assertEqual(list(m.map["contents"]), list(MAP_CONTENTS))
        self.assertEqual({k for k, v in m.map["contents"].items() if not v}, {"Cursor Position", "Solar Terminator"})
        self.assertEqual(m.polar["orientation"], "N/E/S/W")
        self.assertEqual(list(m.polar["contents"]), list(POLAR_CONTENTS))
        self.assertEqual({k for k, v in m.polar["contents"].items() if not v}, {"Extra Az Ticks"})
        self.assertIs(m.polar["auto_skytrack"], False)
        self.assertEqual(m.single["fields"], SINGLE_DEFAULT)
        self.assertIsNone(m.single["selected"])
        self.assertEqual((m.footprint_off, m.ground_track, m.sky_track), ([], [], []))

    def test_defaults_are_not_shared_between_modules_or_constants(self):
        a = build()
        a.list_columns.append("Lat")
        a.map["contents"]["Grid Lines"] = False
        a.polar["contents"]["Extra Az Ticks"] = True
        a.single["fields"].append("Direction")
        a.refresh["data_ms"] = 999
        b = build()
        self.assertEqual(b.list_columns, LIST_DEFAULT)
        self.assertEqual(LIST_DEFAULT, ["Satellite", "Az", "El", "Dir", "Range", "Next Event", "Alt", "Orbit"])
        self.assertTrue(b.map["contents"]["Grid Lines"])
        self.assertFalse(b.polar["contents"]["Extra Az Ticks"])
        self.assertNotIn("Direction", b.single["fields"])
        self.assertEqual(b.refresh["data_ms"], 300)

    def test_input_is_copied_not_aliased(self):
        sats = [25544]
        cols = ["Satellite", "Az"]
        m = module_from_dict({"name": "A", "satellites": sats, "list_columns": cols}, QTHS, NORADS)
        sats.append(1)
        cols.append("El")
        self.assertEqual(m.satellites, [25544])
        self.assertEqual(m.list_columns, ["Satellite", "Az"])

    def test_full_round_trip(self):
        d = {
            "name": "Weather_1", "qth": "CNX", "satellites": [25544, 43013, 40069],
            "layout_code": LAYOUT_PRESETS[7][1],
            "refresh": {"data_ms": 1000, "list": 2, "map": 20, "polar": 5, "single": 3, "event": 4},
            "list_columns": ["Az", "Satellite", "Lat"],
            "list_sort": {"column": "Az", "ascending": False},
            "map": {"contents": {n: i % 2 == 0 for i, n in enumerate(MAP_CONTENTS)},
                    "track_orbits": 7, "center_lon": -120},
            "polar": {"orientation": "S/W/N/E", "contents": {n: i % 2 == 1 for i, n in enumerate(POLAR_CONTENTS)},
                      "auto_skytrack": True},
            "single": {"fields": ["Azimuth", "Visibility"], "selected": 43013},
            "footprint_off": [40069], "ground_track": [25544, 43013], "sky_track": [43013],
        }
        m = module_from_dict(d, QTHS, NORADS)
        self.assertEqual(module_to_dict(m), d)
        self.assertEqual(module_to_dict(module_from_dict(module_to_dict(m), QTHS, NORADS)), d)
        json.dumps(module_to_dict(m))

    def test_to_dict_is_a_deep_copy(self):
        m = build()
        d = module_to_dict(m)
        d["map"]["contents"]["Grid Lines"] = False
        d["satellites"].append(1)
        self.assertTrue(m.map["contents"]["Grid Lines"])
        self.assertEqual(m.satellites, [25544, 43013])

    def test_partial_nested_dicts_fill_in_defaults(self):
        m = build(refresh={"data_ms": 500}, map={"contents": {"Grid Lines": False}},
                  polar={"orientation": "N/W/S/E"}, list_sort={"ascending": False}, single={"selected": 25544})
        self.assertEqual(m.refresh, {"data_ms": 500, "list": 1, "map": 10, "polar": 3, "single": 1, "event": 1})
        self.assertFalse(m.map["contents"]["Grid Lines"])
        self.assertTrue(m.map["contents"]["Satellite Name"])
        self.assertEqual(m.map["track_orbits"], 3)
        self.assertEqual(m.polar["orientation"], "N/W/S/E")
        self.assertIs(m.polar["auto_skytrack"], False)
        self.assertEqual(m.list_sort, {"column": "Satellite", "ascending": False})
        self.assertEqual(m.single, {"fields": SINGLE_DEFAULT, "selected": 25544})

    def test_unknown_keys_are_skipped(self):
        m = build(bogus=1, refresh={"data_ms": 400, "zzz": "x"}, map={"nope": 1})
        self.assertEqual(m.refresh["data_ms"], 400)
        self.assertNotIn("zzz", m.refresh)
        self.assertNotIn("nope", m.map)
        self.assertFalse(hasattr(m, "bogus"))

    def test_boundaries_accepted(self):
        m = build(refresh={"data_ms": 100, "list": 1, "map": 50, "polar": 50, "single": 1, "event": 50},
                  map={"track_orbits": 10, "center_lon": 180})
        self.assertEqual((m.refresh["data_ms"], m.map["track_orbits"], m.map["center_lon"]), (100, 10, 180))
        m = build(refresh={"data_ms": 10000}, map={"track_orbits": 1, "center_lon": -180})
        self.assertEqual((m.refresh["data_ms"], m.map["track_orbits"], m.map["center_lon"]), (10000, 1, -180))
        self.assertEqual(len(module_from_dict({"name": "x" * 25, "satellites": list(range(1, MAX_SATS + 1))},
                                              QTHS, set(range(1, MAX_SATS + 1))).satellites), MAX_SATS)

    def test_none_skips_membership_checks_only(self):
        m = module_from_dict({"name": "A", "qth": "ANY", "satellites": [1, 2]}, None, None)
        self.assertEqual((m.qth, m.satellites), ("ANY", [1, 2]))
        with self.assertRaises(ApiError) as cm:
            module_from_dict({"name": "A", "satellites": []}, None, None)
        self.assertEqual(cm.exception.code, "MODULE_INVALID")

    def test_module_validation(self):
        cases = [
            ("data_ms 99", {"refresh": {"data_ms": 99}}, "refresh.data_ms"),
            ("data_ms 10001", {"refresh": {"data_ms": 10001}}, "refresh.data_ms"),
            ("data_ms float", {"refresh": {"data_ms": 300.5}}, "refresh.data_ms"),
            ("data_ms bool", {"refresh": {"data_ms": True}}, "refresh.data_ms"),
            ("data_ms str", {"refresh": {"data_ms": "300"}}, "refresh.data_ms"),
            ("list cycle 0", {"refresh": {"list": 0}}, "refresh.list"),
            ("map cycle 51", {"refresh": {"map": 51}}, "refresh.map"),
            ("polar cycle 0", {"refresh": {"polar": 0}}, "refresh.polar"),
            ("single cycle 51", {"refresh": {"single": 51}}, "refresh.single"),
            ("event cycle 0", {"refresh": {"event": 0}}, "refresh.event"),
            ("track_orbits 11", {"map": {"track_orbits": 11}}, "map.track_orbits"),
            ("track_orbits 0", {"map": {"track_orbits": 0}}, "map.track_orbits"),
            ("center_lon 181", {"map": {"center_lon": 181}}, "map.center_lon"),
            ("center_lon -181", {"map": {"center_lon": -181}}, "map.center_lon"),
            ("center_lon nan", {"map": {"center_lon": float("nan")}}, "map.center_lon"),
            ("orientation N/S", {"polar": {"orientation": "N/S"}}, "polar.orientation"),
            ("auto_skytrack not bool", {"polar": {"auto_skytrack": 1}}, "polar.auto_skytrack"),
            ("column Foo", {"list_columns": ["Satellite", "Foo"]}, "list_columns"),
            ("column dup", {"list_columns": ["Az", "Az"]}, "list_columns"),
            ("columns not list", {"list_columns": "Az"}, "list_columns"),
            ("sort column Foo", {"list_sort": {"column": "Foo"}}, "list_sort.column"),
            ("sort ascending not bool", {"list_sort": {"ascending": "yes"}}, "list_sort.ascending"),
            ("map content unknown", {"map": {"contents": {"Foo": True}}}, "map.contents"),
            ("map content not bool", {"map": {"contents": {"Grid Lines": 1}}}, "map.contents"),
            ("map contents not dict", {"map": {"contents": ["Grid Lines"]}}, "map.contents"),
            ("polar content unknown", {"polar": {"contents": {"Grid Lines": True}}}, "polar.contents"),
            ("single field unknown", {"single": {"fields": ["Foo"]}}, "single.fields"),
            ("single field dup", {"single": {"fields": ["Azimuth", "Azimuth"]}}, "single.fields"),
            ("selected not in sats", {"single": {"selected": 7530}}, "single.selected"),
            ("selected str", {"single": {"selected": "25544"}}, "single.selected"),
            ("satellites empty", {"satellites": []}, "satellites"),
            ("satellites missing", {"satellites": None}, "satellites"),
            ("satellites not list", {"satellites": 25544}, "satellites"),
            ("satellites unknown norad", {"satellites": [25544, 99999]}, "satellites"),
            ("satellites non-int", {"satellites": ["25544"]}, "satellites"),
            ("satellites bool", {"satellites": [True]}, "satellites"),
            ("satellites dup", {"satellites": [25544, 25544]}, "satellites"),
            ("qth unknown", {"qth": "NOPE"}, "qth"),
            ("qth not str", {"qth": 5}, "qth"),
            ("name empty", {"name": ""}, "name"),
            ("name too long", {"name": "x" * 26}, "name"),
            ("name slash", {"name": "a/b"}, "name"),
            ("name trailing newline", {"name": "A\n"}, "name"),
            ("name missing", {"name": None}, "name"),
            ("layout bad", {"layout_code": "1;0;2;0"}, "layout_code"),
            ("layout not str", {"layout_code": 5}, "layout_code"),
            ("footprint_off not in sats", {"footprint_off": [7530]}, "footprint_off"),
            ("ground_track dup", {"ground_track": [25544, 25544]}, "ground_track"),
            ("sky_track non-int", {"sky_track": ["25544"]}, "sky_track"),
            ("sky_track not list", {"sky_track": 25544}, "sky_track"),
            ("refresh not dict", {"refresh": 300}, "refresh"),
            ("map not dict", {"map": []}, "map"),
            ("polar null", {"polar": None}, "polar"),
        ]
        for label, over, field in cases:
            with self.subTest(label):
                d = {"name": "A", "satellites": [25544, 43013]}
                d.update(over)
                with self.assertRaises(ApiError) as cm:
                    module_from_dict(d, QTHS, NORADS)
                self.assertEqual((cm.exception.code, cm.exception.status), ("MODULE_INVALID", 422))
                self.assertEqual(cm.exception.object, field)
                self.assertTrue(cm.exception.text)

    def test_non_object_is_invalid(self):
        for bad in (None, [], "A", 5):
            with self.subTest(bad), self.assertRaises(ApiError) as cm:
                module_from_dict(bad, QTHS, NORADS)
            self.assertEqual((cm.exception.code, cm.exception.status), ("MODULE_INVALID", 422))

    def test_too_many_sats(self):
        sats = list(range(1, MAX_SATS + 2))
        for norads in (set(sats), NORADS, None):
            with self.subTest(known=norads is not None), self.assertRaises(ApiError) as cm:
                module_from_dict({"name": "A", "satellites": sats}, QTHS, norads)
            self.assertEqual((cm.exception.code, cm.exception.status), ("MODULE_TOO_MANY_SATS", 422))
            self.assertEqual(cm.exception.object, "satellites")


class ModuleStoreTests(unittest.TestCase):
    def setUp(self):
        self.cfg = temp_config(self)
        self.store = Store(self.cfg.data_dir)
        self.store.put_qth(station("THBK"))
        self.store.put_qth(station("CNX"))
        self.store.set_default_qth("THBK")

    def add(self, name: str, qth=None, sats=(25544,)) -> ModuleConfig:
        m = module_from_dict({"name": name, "qth": qth, "satellites": list(sats)}, QTHS, NORADS)
        self.store.put_module(m)
        return m

    def test_put_get_round_trip_and_file_location(self):
        m = self.add("Amateur", qth="CNX", sats=(25544, 43013))
        self.assertEqual(self.store.get_module("Amateur"), m)
        path = self.cfg.data_dir / "modules" / "Amateur.json"
        self.assertTrue(path.is_file())
        self.assertEqual(json.loads(path.read_text(encoding="utf-8")), module_to_dict(m))
        self.assertEqual([p.name for p in path.parent.iterdir()], ["Amateur.json"])

    def test_put_replaces_existing(self):
        self.add("A")
        m = build(name="A", refresh={"data_ms": 700})
        self.store.put_module(m)
        self.assertEqual(self.store.get_module("A").refresh["data_ms"], 700)
        self.assertEqual(self.store.list_modules(), ["A"])

    def test_list_modules_sorted_and_empty(self):
        self.assertEqual(self.store.list_modules(), [])
        for n in ("beta", "Alpha", "gamma_2"):
            self.add(n)
        (self.cfg.data_dir / "modules" / "has space.json").write_text("{}", encoding="utf-8")
        (self.cfg.data_dir / "modules" / "notes.txt").write_text("x", encoding="utf-8")
        self.assertEqual(self.store.list_modules(), ["Alpha", "beta", "gamma_2"])

    def test_get_missing_and_bad_names_are_not_found(self):
        for name in ("Nope", "../settings", "a/b", "", "x" * 26, "A\n", None):
            with self.subTest(name), self.assertRaises(ApiError) as cm:
                self.store.get_module(name)
            self.assertEqual((cm.exception.code, cm.exception.status), ("NOT_FOUND", 404))

    def test_put_rejects_invalid_module_without_writing(self):
        m = build(name="A")
        m.refresh["data_ms"] = 5
        with self.assertRaises(ApiError) as cm:
            self.store.put_module(m)
        self.assertEqual((cm.exception.code, cm.exception.status), ("MODULE_INVALID", 422))
        m = build(name="A")
        m.satellites = list(range(1, MAX_SATS + 2))
        with self.assertRaises(ApiError) as cm:
            self.store.put_module(m)
        self.assertEqual(cm.exception.code, "MODULE_TOO_MANY_SATS")
        self.assertEqual(self.store.list_modules(), [])

    def test_put_rejects_unknown_qth(self):
        m = build(name="A")
        m.qth = "GONE"
        with self.assertRaises(ApiError) as cm:
            self.store.put_module(m)
        self.assertEqual((cm.exception.code, cm.exception.status, cm.exception.object),
                         ("MODULE_INVALID", 422, "qth"))
        self.assertEqual(self.store.list_modules(), [])

    def test_get_corrupt_or_mismatched_file_is_module_invalid(self):
        self.add("A")
        path = self.cfg.data_dir / "modules" / "A.json"
        path.write_text("{not json", encoding="utf-8")
        with self.assertRaises(ApiError) as cm:
            self.store.get_module("A")
        self.assertEqual((cm.exception.code, cm.exception.status, cm.exception.object), ("MODULE_INVALID", 422, "A"))
        path.write_bytes(b"\xff\xfe\x00")
        with self.assertRaises(ApiError) as cm:
            self.store.get_module("A")
        self.assertEqual(cm.exception.code, "MODULE_INVALID")
        path.write_text(json.dumps({"name": "Other", "satellites": [1]}), encoding="utf-8")
        with self.assertRaises(ApiError) as cm:
            self.store.get_module("A")
        self.assertEqual(cm.exception.code, "MODULE_INVALID")

    def test_get_does_not_check_qth_or_norad_membership(self):
        path = self.cfg.data_dir / "modules" / "Old.json"
        path.parent.mkdir(parents=True)
        path.write_text(json.dumps({"name": "Old", "qth": "REMOVED", "satellites": [99999]}), encoding="utf-8")
        m = self.store.get_module("Old")
        self.assertEqual((m.qth, m.satellites), ("REMOVED", [99999]))

    def test_delete_module(self):
        self.add("A")
        self.add("B")
        self.store.delete_module("A")
        self.assertEqual(self.store.list_modules(), ["B"])
        for name in ("A", "../x", "A\n"):
            with self.subTest(name), self.assertRaises(ApiError) as cm:
                self.store.delete_module(name)
            self.assertEqual((cm.exception.code, cm.exception.status), ("NOT_FOUND", 404))

    def test_modules_using_qth(self):
        self.add("Zed", qth="CNX")
        self.add("Alpha", qth="CNX")
        self.add("OnDefault", qth=None)
        self.add("Bkk", qth="THBK")
        self.assertEqual(self.store.modules_using_qth("CNX"), ["Alpha", "Zed"])
        self.assertEqual(self.store.modules_using_qth("THBK"), ["Bkk", "OnDefault"])
        self.assertEqual(self.store.modules_using_qth("Nobody"), [])
        self.store.set_default_qth("CNX")
        self.assertEqual(self.store.modules_using_qth("CNX"), ["Alpha", "OnDefault", "Zed"])
        self.assertEqual(self.store.modules_using_qth("THBK"), ["Bkk"])

    def test_modules_using_qth_counts_semi_corrupt_and_skips_unreadable(self):
        self.add("Good", qth="CNX")
        mdir = self.cfg.data_dir / "modules"
        (mdir / "Broken.json").write_text("{nope", encoding="utf-8")
        (mdir / "Bad.json").write_text(json.dumps({"name": "Bad", "qth": "CNX", "refresh": 5}), encoding="utf-8")
        (mdir / "List.json").write_text("[]", encoding="utf-8")
        self.assertEqual(self.store.modules_using_qth("CNX"), ["Bad", "Good"])

    def test_delete_qth_used_by_module_is_in_use(self):
        self.add("A", qth="CNX")
        with self.assertRaises(ApiError) as cm:
            self.store.delete_qth("CNX")
        self.assertEqual((cm.exception.code, cm.exception.status, cm.exception.object), ("IN_USE", 409, "CNX"))
        self.assertIn("A", cm.exception.text)
        self.assertEqual([q.name for q in self.store.list_qth()], ["CNX", "THBK"])
        self.store.delete_module("A")
        self.store.delete_qth("CNX")
        self.assertEqual([q.name for q in self.store.list_qth()], ["THBK"])

    def test_delete_qth_default_used_by_default_module_is_in_use(self):
        self.add("OnDefault", qth=None)
        with self.assertRaises(ApiError) as cm:
            self.store.delete_qth("THBK")
        self.assertEqual((cm.exception.code, cm.exception.status), ("IN_USE", 409))
        self.assertIn("OnDefault", cm.exception.text)
        self.assertEqual(self.store.default_qth(), "THBK")
        self.assertEqual([q.name for q in self.store.list_qth()], ["CNX", "THBK"])

    def test_delete_qth_non_default_ignores_default_modules(self):
        self.add("OnDefault", qth=None)
        self.store.delete_qth("CNX")
        self.assertEqual([q.name for q in self.store.list_qth()], ["THBK"])

    def test_delete_qth_unused_default_still_repoints_default(self):
        self.add("Other", qth="CNX")
        with self.assertRaises(ApiError):
            self.store.delete_qth("CNX")
        self.store.delete_module("Other")
        self.store.delete_qth("THBK")
        self.assertEqual(self.store.default_qth(), "CNX")

    def test_session_round_trip(self):
        self.assertEqual(self.store.session(), [])
        for n in ("A", "B", "C"):
            self.add(n)
        self.store.set_session(["C", "A"])
        self.assertEqual(self.store.session(), ["C", "A"])
        self.assertEqual(Store(self.cfg.data_dir).session(), ["C", "A"])
        self.assertEqual(json.loads((self.cfg.data_dir / "session.json").read_text(encoding="utf-8")),
                         {"modules": ["C", "A"]})
        self.store.set_session([])
        self.assertEqual(self.store.session(), [])
        self.store.set_session(["B", "C", "A"])
        self.assertEqual(self.store.session(), ["B", "C", "A"])

    def test_set_session_rejects_unknown_and_malformed(self):
        self.add("A")
        self.add("B")
        self.store.set_session(["B", "A"])
        for bad, code in ((["A", "Nope"], "NOT_FOUND"), (["../x"], "NOT_FOUND"), (["A", "A"], "MODULE_INVALID"),
                          ("A", "MODULE_INVALID"), ([1], "MODULE_INVALID"), (None, "MODULE_INVALID")):
            with self.subTest(bad), self.assertRaises(ApiError) as cm:
                self.store.set_session(bad)
            self.assertEqual(cm.exception.code, code)
        self.assertEqual(self.store.session(), ["B", "A"])

    def test_session_drops_deleted_and_vanished_modules(self):
        for n in ("A", "B", "C"):
            self.add(n)
        self.store.set_session(["A", "B", "C"])
        self.store.delete_module("B")
        self.assertEqual(self.store.session(), ["A", "C"])
        self.assertEqual(json.loads((self.cfg.data_dir / "session.json").read_text(encoding="utf-8")),
                         {"modules": ["A", "C"]})
        (self.cfg.data_dir / "modules" / "C.json").unlink()
        self.assertEqual(self.store.session(), ["A"])

    def test_session_unreadable_file_is_empty(self):
        self.add("A")
        path = self.cfg.data_dir / "session.json"
        for content, expected in ((b"{nope", []), (b"\xff\xfe", []), (b"[]", []), (b'{"modules": "A"}', []),
                                  (b'{"modules": [1, "A", "A", "../x", "Gone"]}', ["A"])):
            with self.subTest(content):
                path.write_bytes(content)
                self.assertEqual(self.store.session(), expected)


if __name__ == "__main__":
    unittest.main()
