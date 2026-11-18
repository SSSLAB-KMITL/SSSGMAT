import json
import re
import unittest
from pathlib import Path

from gpredict_web.config import MAX_SATS
from gpredict_web.errors import ApiError
from gpredict_web.module import (DEFAULT_MAP, GLOBAL_LAYOUT_EXTRA, LAYOUT_PRESETS, LIST_COLUMNS, LIST_DEFAULT,
                                 LIST_HINTS, MAP_COLOURS_DEFAULT, MAP_CONTENTS, MAP_DEFAULT_OFF, MAP_SHADOW_DEFAULT,
                                 MODULE_KEYS, PAGE_PATHS, POLAR_COLOURS_DEFAULT, POLAR_CONTENTS, POLAR_DEFAULT_OFF,
                                 POLAR_ORIENTATIONS, SINGLE_DEFAULT, SINGLE_FIELDS, SINGLE_HINTS, ModuleConfig,
                                 ViewCell, del_path, effective_dict, get_path, module_from_dict, module_to_dict,
                                 own_dict, parse_layout, set_path, strip_defaults)
from gpredict_web.prefs import PREFS, Prefs
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
                    "track_orbits": 7, "center_lon": -120, "file": "earth_800.png", "shadow_alpha": 100,
                    "colours": {n: 0x10203040 + i for i, n in enumerate(MAP_COLOURS_DEFAULT)}},
            "polar": {"orientation": "S/W/N/E", "contents": {n: i % 2 == 1 for i, n in enumerate(POLAR_CONTENTS)},
                      "auto_skytrack": True,
                      "colours": {n: 0x50607080 + i for i, n in enumerate(POLAR_COLOURS_DEFAULT)}},
            "single": {"fields": ["Azimuth", "Visibility"], "selected": 43013},
            "footprint_off": [40069], "ground_track": [25544, 43013], "sky_track": [43013],
            "window": {"state": 1, "x": 10, "y": 20, "width": 800, "height": 600},
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


# ---------------------------------------------------------------- ช่อง map / polar / window ใหม่ (งานย่อย 4)

class NewFieldTests(unittest.TestCase):
    def test_new_defaults(self):
        m = build()
        self.assertEqual(m.map["file"], DEFAULT_MAP)
        self.assertEqual(m.map["shadow_alpha"], MAP_SHADOW_DEFAULT)
        self.assertEqual(m.map["colours"], MAP_COLOURS_DEFAULT)
        self.assertEqual(len(m.map["colours"]), 11)
        self.assertEqual(m.polar["colours"], POLAR_COLOURS_DEFAULT)
        self.assertEqual(len(m.polar["colours"]), 7)
        self.assertEqual(m.window, {"state": 0, "x": None, "y": None, "width": None, "height": None})

    def test_new_defaults_are_not_shared(self):
        a = build()
        a.map["colours"]["grid"] = 1
        a.polar["colours"]["axes"] = 1
        a.window["state"] = 1
        b = build()
        self.assertEqual(b.map["colours"], MAP_COLOURS_DEFAULT)
        self.assertEqual(b.polar["colours"], POLAR_COLOURS_DEFAULT)
        self.assertEqual(b.window["state"], 0)
        self.assertEqual(MAP_COLOURS_DEFAULT["grid"], 0x7F7F7FC8)
        self.assertEqual(POLAR_COLOURS_DEFAULT["axes"], 0x0F0F0F7F)

    def test_new_fields_round_trip(self):
        colours = {n: i + 1 for i, n in enumerate(MAP_COLOURS_DEFAULT)}
        polar_colours = {n: 0xFFFFFFFF - i for i, n in enumerate(POLAR_COLOURS_DEFAULT)}
        window = {"state": 1, "x": 0, "y": 20, "width": 100, "height": 10000}
        m = build(map={"file": "my_map-1.png", "colours": colours, "shadow_alpha": 255},
                  polar={"colours": polar_colours}, window=window)
        self.assertEqual((m.map["file"], m.map["shadow_alpha"]), ("my_map-1.png", 255))
        self.assertEqual(m.map["colours"], colours)
        self.assertEqual(m.polar["colours"], polar_colours)
        self.assertEqual(m.window, window)
        self.assertEqual(module_to_dict(module_from_dict(module_to_dict(m), QTHS, NORADS)), module_to_dict(m))
        json.dumps(module_to_dict(m))

    def test_partial_colours_and_window_fill_in_defaults(self):
        m = build(map={"colours": {"grid": 0}}, polar={"colours": {"info": 5}}, window={"x": 7})
        self.assertEqual(m.map["colours"], {**MAP_COLOURS_DEFAULT, "grid": 0})
        self.assertEqual(m.polar["colours"], {**POLAR_COLOURS_DEFAULT, "info": 5})
        self.assertEqual(m.window, {"state": 0, "x": 7, "y": None, "width": None, "height": None})
        m = build(window={"x": None, "width": None})
        self.assertEqual(m.window["x"], None)

    def test_window_validation(self):
        cases = [
            ("state 2", {"state": 2}, "window.state"),
            ("state -1", {"state": -1}, "window.state"),
            ("state bool", {"state": True}, "window.state"),
            ("state None", {"state": None}, "window.state"),
            ("state str", {"state": "1"}, "window.state"),
            ("x -1", {"x": -1}, "window.x"),
            ("y -1", {"y": -1}, "window.y"),
            ("x float", {"x": 1.5}, "window.x"),
            ("x bool", {"x": False}, "window.x"),
            ("width 50", {"width": 50}, "window.width"),
            ("width 99", {"width": 99}, "window.width"),
            ("width 10001", {"width": 10001}, "window.width"),
            ("height 50", {"height": 50}, "window.height"),
            ("height 10001", {"height": 10001}, "window.height"),
            ("height str", {"height": "300"}, "window.height"),
        ]
        for label, window, field in cases:
            with self.subTest(label), self.assertRaises(ApiError) as cm:
                build(window=window)
            self.assertEqual((cm.exception.code, cm.exception.status), ("MODULE_INVALID", 422))
            self.assertEqual(cm.exception.object, field)
        for bad in (None, [], 5):
            with self.subTest(bad), self.assertRaises(ApiError) as cm:
                build(window=bad)
            self.assertEqual((cm.exception.code, cm.exception.object), ("MODULE_INVALID", "window"))
        self.assertEqual(build(window={"state": 1, "x": 0, "y": 0, "width": 100, "height": 100}).window["state"], 1)

    def test_map_colours_validation(self):
        cases = [
            ("negative", {"colours": {"grid": -1}}, "map.colours.grid"),
            ("too big", {"colours": {"grid": 0x100000000}}, "map.colours.grid"),
            ("float", {"colours": {"grid": 1.0}}, "map.colours.grid"),
            ("bool", {"colours": {"grid": True}}, "map.colours.grid"),
            ("str", {"colours": {"grid": "#ffffff"}}, "map.colours.grid"),
            ("None", {"colours": {"infoBg": None}}, "map.colours.infoBg"),
            ("unknown name", {"colours": {"nope": 1}}, "map.colours"),
            ("polar name on map", {"colours": {"background": 1}}, "map.colours"),
            ("not dict", {"colours": [1]}, "map.colours"),
            ("shadow 256", {"shadow_alpha": 256}, "map.shadow_alpha"),
            ("shadow -1", {"shadow_alpha": -1}, "map.shadow_alpha"),
            ("shadow float", {"shadow_alpha": 1.5}, "map.shadow_alpha"),
            ("file empty", {"file": ""}, "map.file"),
            ("file too long", {"file": "a" * 101}, "map.file"),
            ("file slash", {"file": "a/b.jpg"}, "map.file"),
            ("file parent", {"file": "../x.jpg"}, "map.file"),
            ("file dotdot", {"file": ".."}, "map.file"),
            ("file dot", {"file": "."}, "map.file"),
            ("file space", {"file": "a b.jpg"}, "map.file"),
            ("file newline", {"file": "a.jpg\n"}, "map.file"),
            ("file thai", {"file": "แผนที่.jpg"}, "map.file"),
            ("file not str", {"file": 5}, "map.file"),
        ]
        for label, over, field in cases:
            with self.subTest(label), self.assertRaises(ApiError) as cm:
                build(map=over)
            self.assertEqual((cm.exception.code, cm.exception.status), ("MODULE_INVALID", 422))
            self.assertEqual(cm.exception.object, field)
        for colour in (0, 0xFFFFFFFF):
            self.assertEqual(build(map={"colours": {"tick": colour}}).map["colours"]["tick"], colour)
        for name in ("a", "a" * 100, "earth_800.png", "Nasa-BMNG.07_1024.jpg", ".hidden"):
            self.assertEqual(build(map={"file": name}).map["file"], name)

    def test_polar_colours_validation(self):
        cases = [
            ("negative", {"colours": {"axes": -1}}, "polar.colours.axes"),
            ("too big", {"colours": {"axes": 2 ** 32}}, "polar.colours.axes"),
            ("bool", {"colours": {"axes": False}}, "polar.colours.axes"),
            ("str", {"colours": {"axes": "red"}}, "polar.colours.axes"),
            ("unknown name", {"colours": {"grid": 1}}, "polar.colours"),
            ("not dict", {"colours": 5}, "polar.colours"),
        ]
        for label, over, field in cases:
            with self.subTest(label), self.assertRaises(ApiError) as cm:
                build(polar=over)
            self.assertEqual((cm.exception.code, cm.exception.status), ("MODULE_INVALID", 422))
            self.assertEqual(cm.exception.object, field)

    def test_version_pin_unpin_are_accepted_and_skipped(self):
        m = build(version=2, pin=["map.file"], unpin=["layout_code"])
        self.assertEqual(module_to_dict(m), module_to_dict(build()))
        self.assertFalse(hasattr(m, "version"))


# ---------------------------------------------------------------- การสืบทอดค่า: ค่าของ module → ค่ารวม → ค่าตั้งต้น

# ช่องที่เป็นของ module อย่างเดียว (เก็บในไฟล์เสมอ ไม่สืบทอด) เขียนซ้ำตรงนี้ตั้งใจ ไม่อ้างจาก module.py
MODULE_ONLY = ("name", "qth", "satellites", "list_sort", "single.selected", "footprint_off", "ground_track",
               "sky_track", "window")


def leaves(d: dict, prefix: str = "") -> list[str]:
    """path ของทุก leaf (list นับเป็น leaf)"""
    out = []
    for k, v in d.items():
        path = f"{prefix}{k}"
        out.extend(leaves(v, path + ".") if isinstance(v, dict) else [path])
    return out


def is_module_only(path: str) -> bool:
    return any(path == m or path.startswith(m + ".") for m in MODULE_ONLY)


def full_body(**over) -> dict:
    """ค่าเต็มของ module แบบที่ web ส่งมา (module_to_dict)"""
    return module_to_dict(build(**over))


class PathTests(unittest.TestCase):
    def test_get_set_del(self):
        d = {}
        set_path(d, "map.contents.Satellite Name", False)
        set_path(d, "map.track_orbits", 5)
        set_path(d, "layout_code", "1;0;2;0;1")
        self.assertEqual(d, {"map": {"contents": {"Satellite Name": False}, "track_orbits": 5},
                             "layout_code": "1;0;2;0;1"})
        self.assertIs(get_path(d, "map.contents.Satellite Name"), False)
        self.assertEqual(get_path(d, "map.track_orbits"), 5)
        self.assertEqual(get_path(d, "map.contents"), {"Satellite Name": False})
        del_path(d, "map.track_orbits")
        self.assertNotIn("track_orbits", d["map"])

    def test_get_missing(self):
        d = {"map": {"track_orbits": 5}, "name": "A", "qth": None}
        for path in ("zzz", "map.zzz", "map.track_orbits.x", "name.x", "map.contents.Grid Lines", ""):
            with self.subTest(path), self.assertRaises(KeyError):
                get_path(d, path)
            self.assertEqual(get_path(d, path, "dflt"), "dflt")
        self.assertIsNone(get_path(d, "qth"))                      # None เป็นค่าจริง ไม่ใช่ "ไม่มี"
        self.assertIsNone(get_path(d, "qth", "dflt"))

    def test_set_replaces_non_dict_parent(self):
        d = {"map": 5}
        set_path(d, "map.track_orbits", 2)
        self.assertEqual(d, {"map": {"track_orbits": 2}})

    def test_del_prunes_emptied_parents_and_ignores_missing(self):
        d = {"map": {"contents": {"Grid Lines": False}}, "name": "A"}
        del_path(d, "map.contents.Grid Lines")
        self.assertEqual(d, {"name": "A"})
        del_path(d, "map.contents.Grid Lines")
        del_path(d, "zzz.yyy")
        del_path(d, "name.x")
        self.assertEqual(d, {"name": "A"})
        d = {"map": {"contents": {"Grid Lines": False, "QTH Info": True}}}
        del_path(d, "map.contents.Grid Lines")
        self.assertEqual(d, {"map": {"contents": {"QTH Info": True}}})


class InheritanceTests(unittest.TestCase):
    def setUp(self):
        self.cfg = temp_config(self)
        self.prefs = Prefs(self.cfg.data_dir)

    def globals_(self, **over) -> dict:
        g = dict(self.prefs.values())
        g.update(over)
        return g

    # ---- ตารางชื่อ

    def test_module_keys_cover_every_inheritable_leaf(self):
        inheritable = {p for p in leaves(module_to_dict(ModuleConfig("x"))) if not is_module_only(p)}
        self.assertEqual(set(MODULE_KEYS), inheritable)
        self.assertEqual(len(MODULE_KEYS), 1 + 6 + 1 + 8 + 4 + 11 + 1 + 6 + 1 + 7 + 1)
        for path, key in MODULE_KEYS.items():
            with self.subTest(path):
                self.assertIn(key, PREFS)
                self.assertTrue(key.startswith("MODULES/"))
        self.assertEqual(len(set(MODULE_KEYS.values())), len(MODULE_KEYS))          # key ไม่ซ้ำ
        self.assertEqual(set(MODULE_KEYS.values()), {k for k in PREFS if k.startswith("MODULES/")})

    def test_module_keys_match_the_defaults_of_prefs(self):
        base = module_to_dict(ModuleConfig("x"))
        for path, key in MODULE_KEYS.items():
            with self.subTest(path):
                self.assertEqual(get_path(base, path), PREFS[key].default)

    def test_module_keys_examples(self):
        for path, key in {
            "layout_code": "MODULES/GRID", "refresh.data_ms": "MODULES/DATA_TIMEOUT",
            "refresh.list": "MODULES/LIST_REFRESH", "refresh.map": "MODULES/MAP_REFRESH",
            "refresh.polar": "MODULES/POLAR_REFRESH", "refresh.single": "MODULES/SINGLE_SAT_REFRESH",
            "refresh.event": "MODULES/EVENT_LIST_REFRESH", "list_columns": "MODULES/LIST_COLUMNS",
            "map.contents.Satellite Name": "MODULES/MAP_SAT_NAME", "map.contents.Satellite Footprint": "MODULES/MAP_SAT_FOTPRINT",
            "map.contents.Solar Terminator": "MODULES/MAP_SHOW_TERMINATOR", "map.track_orbits": "MODULES/MAP_TRACK_NUM",
            "map.center_lon": "MODULES/MAP_CENTER", "map.file": "MODULES/MAP_FILE",
            "map.shadow_alpha": "MODULES/MAP_SHADOW_ALPHA", "map.colours.infoBg": "MODULES/MAP_INFO_BGD_COLOUR",
            "map.colours.groundStation": "MODULES/MAP_QTH_COLOUR", "map.colours.earthShadow": "MODULES/MAP_EARTH_SHADOW_COLOUR",
            "polar.orientation": "MODULES/POLAR_CHART_ORIENT", "polar.auto_skytrack": "MODULES/POLAR_SHOW_TRACK_AUTO",
            "polar.contents.Extra Az Ticks": "MODULES/POLAR_EXTRA_AZ_TICKS", "polar.colours.background": "MODULES/POLAR_BGD_COLOUR",
            "polar.colours.info": "MODULES/POLAR_INFO_COLOUR", "single.fields": "MODULES/SINGLE_SAT_FIELDS",
        }.items():
            with self.subTest(path):
                self.assertEqual(MODULE_KEYS[path], key)

    def test_page_paths(self):
        self.assertEqual(list(PAGE_PATHS), ["layout", "refresh", "list", "map", "polar", "single"])
        self.assertEqual(PAGE_PATHS["layout"], ("layout_code",))
        self.assertEqual(PAGE_PATHS["list"], ("list_columns",))
        self.assertEqual(PAGE_PATHS["single"], ("single.fields",))
        self.assertEqual(set(PAGE_PATHS["refresh"]), {f"refresh.{k}" for k in ("data_ms", "list", "map", "polar", "single", "event")})
        self.assertEqual(len(PAGE_PATHS["map"]), 8 + 4 + 11)
        self.assertIn("map.colours.terminator", PAGE_PATHS["map"])
        self.assertIn("map.colours.earthShadow", PAGE_PATHS["map"])
        self.assertIn("map.file", PAGE_PATHS["map"])
        self.assertIn("map.shadow_alpha", PAGE_PATHS["map"])
        self.assertEqual(len(PAGE_PATHS["polar"]), 1 + 6 + 1 + 7)
        self.assertTrue(all(isinstance(v, tuple) for v in PAGE_PATHS.values()))
        every = [p for paths in PAGE_PATHS.values() for p in paths]
        self.assertEqual(len(every), len(set(every)))                  # หน้าละ path ไม่ซ้ำกัน
        self.assertEqual(set(every), set(MODULE_KEYS))                 # ทุก path อยู่ในหน้าใดหน้าหนึ่งพอดี

    def test_global_layout_extra(self):
        self.assertEqual(GLOBAL_LAYOUT_EXTRA, ("GLOBAL/MAIN_WIN_POS", "GLOBAL/MOD_WIN_POS", "GLOBAL/MOD_STATE"))
        for key in GLOBAL_LAYOUT_EXTRA:
            self.assertIn(key, PREFS)

    # ---- effective_dict

    def test_effective_prefers_module_then_global(self):
        own = {"name": "A", "satellites": [1], "layout_code": "1;0;2;0;1"}
        g = dict(Prefs(self.cfg.data_dir).values())
        g["MODULES/MAP_TRACK_NUM"] = 5
        e = effective_dict(own, g)
        self.assertEqual(e["layout_code"], "1;0;2;0;1")
        self.assertEqual(e["map"]["track_orbits"], 5)

    def test_effective_module_value_beats_a_different_global(self):
        own = {"name": "A", "satellites": [1], "layout_code": "1;0;2;0;1", "map": {"contents": {"Grid Lines": False}}}
        e = effective_dict(own, self.globals_(**{"MODULES/GRID": "2;0;1;0;1", "MODULES/MAP_SHOW_GRID": True}))
        self.assertEqual(e["layout_code"], "1;0;2;0;1")
        self.assertIs(e["map"]["contents"]["Grid Lines"], False)
        self.assertIs(e["map"]["contents"]["QTH Info"], True)

    def test_effective_falls_back_to_defaults_without_globals(self):
        own = {"name": "A", "satellites": [25544]}
        for g in ({}, self.prefs.values()):
            with self.subTest(len(g)):
                e = effective_dict(own, g)
                self.assertEqual(module_to_dict(module_from_dict(e, QTHS, NORADS)),
                                 module_to_dict(build(name="A", satellites=[25544])))
        e = effective_dict(own, {"MODULES/GRID": "2;0;1;0;1"})        # ขาดบาง key: key ที่ขาดใช้ค่าตั้งต้น
        self.assertEqual(e["layout_code"], "2;0;1;0;1")
        self.assertEqual(e["refresh"]["data_ms"], 300)

    def test_effective_is_a_full_valid_module(self):
        own = {"version": 2, "name": "A", "qth": "CNX", "satellites": [25544, 43013], "footprint_off": [43013],
               "ground_track": [25544], "sky_track": [], "list_sort": {"column": "Az", "ascending": False},
               "single": {"selected": 43013}, "window": {"state": 1, "x": 3, "y": 4, "width": 500, "height": 400}}
        e = effective_dict(own, self.globals_())
        m = module_from_dict(e, QTHS, NORADS)
        self.assertEqual((m.name, m.qth, m.satellites), ("A", "CNX", [25544, 43013]))
        self.assertEqual((m.footprint_off, m.ground_track), ([43013], [25544]))
        self.assertEqual(m.list_sort, {"column": "Az", "ascending": False})
        self.assertEqual(m.single["selected"], 43013)
        self.assertEqual(m.single["fields"], SINGLE_DEFAULT)
        self.assertEqual(m.window, own["window"])
        self.assertNotIn("version", e)

    def test_effective_passes_every_global_to_its_leaf(self):
        g = self.globals_(**{
            "MODULES/GRID": "0;0;2;0;1", "MODULES/DATA_TIMEOUT": 1500, "MODULES/EVENT_LIST_REFRESH": 9,
            "MODULES/LIST_COLUMNS": ["Az", "El"], "MODULES/SINGLE_SAT_FIELDS": ["Azimuth"],
            "MODULES/MAP_FILE": "earth_800.png", "MODULES/MAP_SHADOW_ALPHA": 7, "MODULES/MAP_CENTER": -90,
            "MODULES/MAP_INFO_BGD_COLOUR": 0x11223344, "MODULES/POLAR_CHART_ORIENT": "S/W/N/E",
            "MODULES/POLAR_SHOW_TRACK_AUTO": True, "MODULES/POLAR_INFO_COLOUR": 0x01020304,
            "MODULES/POLAR_EXTRA_AZ_TICKS": True, "MODULES/MAP_SHOW_TERMINATOR": True,
        })
        e = effective_dict({"name": "A", "satellites": [25544]}, g)
        self.assertEqual(e["layout_code"], "0;0;2;0;1")
        self.assertEqual((e["refresh"]["data_ms"], e["refresh"]["event"]), (1500, 9))
        self.assertEqual(e["list_columns"], ["Az", "El"])
        self.assertEqual(e["single"]["fields"], ["Azimuth"])
        self.assertEqual((e["map"]["file"], e["map"]["shadow_alpha"], e["map"]["center_lon"]), ("earth_800.png", 7, -90))
        self.assertEqual(e["map"]["colours"]["infoBg"], 0x11223344)
        self.assertIs(e["map"]["contents"]["Solar Terminator"], True)
        self.assertEqual(e["polar"]["orientation"], "S/W/N/E")
        self.assertIs(e["polar"]["auto_skytrack"], True)
        self.assertEqual(e["polar"]["colours"]["info"], 0x01020304)
        self.assertIs(e["polar"]["contents"]["Extra Az Ticks"], True)
        module_from_dict(e, QTHS, NORADS)

    def test_effective_does_not_alias_inputs(self):
        g = self.globals_()
        own = {"name": "A", "satellites": [25544], "map": {"contents": {"Grid Lines": False}}}
        e = effective_dict(own, g)
        e["list_columns"].append("Lat")
        e["satellites"].append(1)
        e["map"]["contents"]["QTH Info"] = False
        e["map"]["colours"]["grid"] = 0
        self.assertEqual(g["MODULES/LIST_COLUMNS"], LIST_DEFAULT)
        self.assertEqual(own, {"name": "A", "satellites": [25544], "map": {"contents": {"Grid Lines": False}}})
        self.assertEqual(g["MODULES/MAP_GRID_COLOUR"], MAP_COLOURS_DEFAULT["grid"])

    def test_effective_ignores_unknown_keys_and_corrupt_sections(self):
        own = {"name": "A", "satellites": [25544], "bogus": 1, "map": 5, "refresh": [1], "pin": ["layout_code"]}
        e = effective_dict(own, self.globals_(**{"MODULES/MAP_CENTER": 10}))
        self.assertNotIn("bogus", e)
        self.assertNotIn("pin", e)
        self.assertEqual(e["map"]["center_lon"], 10)
        self.assertEqual(e["refresh"]["data_ms"], 300)

    # ---- own_dict

    def test_own_dict_ignores_unpinned_inherited_values(self):
        body = full_body(layout_code="1;0;2;0;1", refresh={"data_ms": 777}, map={"center_lon": 33, "file": "earth_800.png"})
        own = own_dict(body, None, (), ())
        self.assertEqual(own["version"], 2)
        for path in MODULE_KEYS:
            with self.subTest(path), self.assertRaises(KeyError):
                get_path(own, path)
        self.assertNotIn("layout_code", own)
        self.assertEqual(own["name"], "A")
        self.assertEqual(own["satellites"], [25544, 43013])

    def test_own_dict_stores_the_module_only_fields_always(self):
        body = full_body(qth="CNX", footprint_off=[43013], ground_track=[25544], sky_track=[25544],
                         list_sort={"column": "Az", "ascending": False}, single={"selected": 25544})
        own = own_dict(body, None, (), ())
        self.assertEqual(own, {
            "version": 2, "name": "A", "qth": "CNX", "satellites": [25544, 43013],
            "list_sort": {"column": "Az", "ascending": False}, "single": {"selected": 25544},
            "footprint_off": [43013], "ground_track": [25544], "sky_track": [25544],
            "window": {"state": 0, "x": None, "y": None, "width": None, "height": None}})
        # ค่าตั้งต้นของช่องของ module ก็เก็บ (qth None = ** DEFAULT **)
        own = own_dict(full_body(), None, (), ())
        self.assertIsNone(own["qth"])
        self.assertEqual(own["list_sort"], {"column": "Satellite", "ascending": True})
        self.assertEqual(own["single"], {"selected": None})
        self.assertEqual((own["footprint_off"], own["ground_track"], own["sky_track"]), ([], [], []))

    def test_own_dict_pin_and_unpin(self):
        body = full_body()                                           # ค่าเท่าค่ารวมทั้งหมด
        own = own_dict(body, None, PAGE_PATHS["map"], ())
        for path in PAGE_PATHS["map"]:
            with self.subTest(path):
                self.assertEqual(get_path(own, path), get_path(body, path))
        for path in PAGE_PATHS["polar"] + PAGE_PATHS["layout"]:
            with self.assertRaises(KeyError):
                get_path(own, path)
        self.assertEqual(own["map"]["colours"], MAP_COLOURS_DEFAULT)
        again = own_dict(body, own, (), PAGE_PATHS["map"])
        self.assertNotIn("map", again)
        for path in PAGE_PATHS["map"]:
            with self.assertRaises(KeyError):
                get_path(again, path)
        one = own_dict(body, own, (), ["map.center_lon"])
        self.assertNotIn("center_lon", one["map"])
        self.assertIn("track_orbits", one["map"])
        self.assertEqual(len(leaves(one["map"])), len(PAGE_PATHS["map"]) - 1)

    def test_own_dict_pin_takes_the_new_value_from_body(self):
        own = own_dict(full_body(map={"center_lon": 100}), None, ["map.center_lon", "layout_code"], ())
        self.assertEqual(own["map"], {"center_lon": 100})
        self.assertEqual(own["layout_code"], full_body()["layout_code"])

    def test_own_dict_keeps_pinned_with_new_value(self):
        old = own_dict(full_body(layout_code="1;0;2;0;1", map={"center_lon": 10}), None, ["layout_code", "map.center_lon"], ())
        new = own_dict(full_body(layout_code="2;0;1;0;1", map={"center_lon": 20, "track_orbits": 9}), old, (), ())
        self.assertEqual(new["layout_code"], "2;0;1;0;1")
        self.assertEqual(new["map"], {"center_lon": 20})              # track_orbits ยังสืบทอด จึงถูกข้าม

    def test_own_dict_keeps_pinned_value_when_body_omits_it(self):
        old = own_dict(full_body(layout_code="1;0;2;0;1"), None, ["layout_code"], ())
        body = full_body()
        del body["layout_code"]
        self.assertEqual(own_dict(body, old, (), ())["layout_code"], "1;0;2;0;1")

    def test_own_dict_unpin_beats_old_own_and_body(self):
        old = own_dict(full_body(layout_code="1;0;2;0;1"), None, ["layout_code"], ())
        self.assertNotIn("layout_code", own_dict(full_body(layout_code="2;0;1;0;1"), old, (), ["layout_code"]))

    def test_own_dict_does_not_touch_the_old_own(self):
        old = own_dict(full_body(), None, ["list_columns"], ())
        snapshot = json.loads(json.dumps(old))
        body = full_body(list_columns=["Az"])
        new = own_dict(body, old, ["map.center_lon"], ())
        new["list_columns"].append("Lat")
        new["satellites"].append(1)
        new["window"]["state"] = 1
        self.assertEqual(old, snapshot)
        self.assertEqual(body["list_columns"], ["Az"])
        self.assertEqual(body["satellites"], [25544, 43013])

    def test_own_dict_keeps_window_from_old(self):
        old = own_dict(full_body(), None, (), ())
        old["window"] = {"state": 1, "x": 10, "y": 20, "width": 800, "height": 600}
        new = own_dict(full_body(window={"state": 0, "x": 1, "y": 2, "width": 300, "height": 200}), old, (), ())
        self.assertEqual(new["window"], {"state": 1, "x": 10, "y": 20, "width": 800, "height": 600})
        new["window"]["x"] = 99
        self.assertEqual(old["window"]["x"], 10)

    def test_own_dict_new_module_has_a_default_window(self):
        own = own_dict(full_body(window={"state": 1, "x": 1, "y": 2, "width": 300, "height": 200}), None, (), ())
        self.assertEqual(own["window"], {"state": 0, "x": None, "y": None, "width": None, "height": None})

    def test_own_dict_rejects_bad_pin_and_unpin(self):
        body = full_body()
        for label, pin, unpin, field in [
            ("pin unknown", ["nope"], (), "pin"),
            ("pin module-only", ["name"], (), "pin"),
            ("pin window", ["window"], (), "pin"),
            ("pin partial path", ["map"], (), "pin"),
            ("pin not str", [5], (), "pin"),
            ("pin a bare string", "layout_code", (), "pin"),
            ("unpin unknown", (), ["map.nope"], "unpin"),
            ("unpin module-only", (), ["satellites"], "unpin"),
            ("both", ["layout_code"], ["layout_code"], "unpin"),
        ]:
            with self.subTest(label), self.assertRaises(ApiError) as cm:
                own_dict(body, None, pin, unpin)
            self.assertEqual((cm.exception.code, cm.exception.status), ("MODULE_INVALID", 422))
            self.assertEqual(cm.exception.object, field)

    def test_own_dict_pin_without_a_value_is_invalid(self):
        body = full_body()
        del body["layout_code"]
        with self.assertRaises(ApiError) as cm:
            own_dict(body, None, ["layout_code"], ())
        self.assertEqual((cm.exception.code, cm.exception.object), ("MODULE_INVALID", "layout_code"))

    def test_own_dict_accepts_any_iterable(self):
        own = own_dict(full_body(), None, (p for p in ["map.file"]), iter(["layout_code"]))
        self.assertEqual(own["map"], {"file": DEFAULT_MAP})

    def test_own_dict_round_trips_through_effective(self):
        g = self.globals_(**{"MODULES/MAP_TRACK_NUM": 5})
        body = full_body(layout_code="1;0;2;0;1", map={"center_lon": 40, "track_orbits": 6})
        own = own_dict(body, None, ["layout_code", "map.center_lon"], ())
        m = module_from_dict(effective_dict(own, g), QTHS, NORADS)
        self.assertEqual((m.layout_code, m.map["center_lon"], m.map["track_orbits"]), ("1;0;2;0;1", 40, 5))
        json.dumps(own)

    # ---- strip_defaults

    def test_strip_defaults(self):
        v1 = module_to_dict(build(qth="CNX", footprint_off=[43013], ground_track=[25544], sky_track=[43013],
                                  list_sort={"column": "Az", "ascending": False}, single={"selected": 25544},
                                  map={"center_lon": 100}))
        out = strip_defaults(v1, self.prefs.defaults())
        self.assertEqual(out, {
            "version": 2, "name": "A", "qth": "CNX", "satellites": [25544, 43013],
            "list_sort": {"column": "Az", "ascending": False}, "single": {"selected": 25544},
            "footprint_off": [43013], "ground_track": [25544], "sky_track": [43013],
            "window": {"state": 0, "x": None, "y": None, "width": None, "height": None},
            "map": {"center_lon": 100}})
        self.assertEqual(get_path(out, "map.center_lon"), 100)

    def test_strip_defaults_core_file_without_the_new_fields(self):
        v1 = module_to_dict(build(refresh={"data_ms": 500}, list_columns=["Az", "El"]))
        for path in ("map.file", "map.colours", "map.shadow_alpha", "polar.colours", "window"):
            del_path(v1, path)
        out = strip_defaults(v1, self.prefs.defaults())
        self.assertEqual(out["refresh"], {"data_ms": 500})
        self.assertEqual(out["list_columns"], ["Az", "El"])
        for path in ("layout_code", "map", "polar"):
            self.assertNotIn(path, out)
        self.assertEqual(out["window"], {"state": 0, "x": None, "y": None, "width": None, "height": None})
        self.assertEqual(out["single"], {"selected": None})            # single.fields เท่าค่าตั้งต้นจึงถูกลบ

    def test_strip_defaults_keeps_a_window_that_is_there(self):
        v1 = module_to_dict(build(window={"state": 1, "x": 1, "y": 2, "width": 300, "height": 200}))
        self.assertEqual(strip_defaults(v1, self.prefs.defaults())["window"],
                         {"state": 1, "x": 1, "y": 2, "width": 300, "height": 200})

    def test_strip_defaults_keeps_values_that_differ_even_in_type(self):
        v1 = module_to_dict(build())
        v1["refresh"]["list"] = True                                    # True == 1 แต่ไม่ใช่ค่าเดียวกัน
        out = strip_defaults(v1, self.prefs.defaults())
        self.assertEqual(out["refresh"], {"list": True})

    def test_strip_defaults_compares_with_the_mapping_it_is_given(self):
        v1 = module_to_dict(build(map={"center_lon": 100}))
        out = strip_defaults(v1, {**self.prefs.defaults(), "MODULES/MAP_CENTER": 100})
        self.assertNotIn("map", out)

    def test_strip_defaults_does_not_modify_or_alias_the_input(self):
        v1 = module_to_dict(build(list_columns=["Az"]))
        snapshot = json.loads(json.dumps(v1))
        out = strip_defaults(v1, self.prefs.defaults())
        out["list_columns"].append("El")
        out["satellites"].append(1)
        self.assertEqual(v1, snapshot)

    def test_strip_defaults_then_effective_keeps_effective_values(self):
        v1 = module_to_dict(build(layout_code="1;0;2;0;1", map={"center_lon": 100, "track_orbits": 3},
                                  refresh={"map": 20}))
        own = strip_defaults(v1, self.prefs.defaults())
        self.assertEqual(module_to_dict(module_from_dict(effective_dict(own, self.prefs.values()), QTHS, NORADS)), v1)


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
        self.assertEqual(json.loads(path.read_text(encoding="utf-8")), {       # version 2: เฉพาะช่องของ module (ค่าอื่นสืบทอด)
            "version": 2, "name": "Amateur", "qth": "CNX", "satellites": [25544, 43013],
            "list_sort": {"column": "Satellite", "ascending": True}, "single": {"selected": None},
            "footprint_off": [], "ground_track": [], "sky_track": [],
            "window": {"state": 0, "x": None, "y": None, "width": None, "height": None}})
        self.assertEqual([p.name for p in path.parent.iterdir()], ["Amateur.json"])

    def test_put_replaces_existing(self):
        self.add("A")
        m = build(name="A", refresh={"data_ms": 700})
        self.store.put_module(m, pin=["refresh.data_ms"])
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
