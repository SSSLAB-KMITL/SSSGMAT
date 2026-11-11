import json
import os
import unittest
from dataclasses import replace
from pathlib import Path

from gpredict_web import config
from gpredict_web.errors import ApiError
from gpredict_web.store import Qth, Store, qth_from_dict, write_json_atomic
from tests.helpers import temp_config


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
                         ("lon string", {"name": "A", "lon_deg": "x"}), ("long description", {"name": "A", "description": "d" * 257})):
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


if __name__ == "__main__":
    unittest.main()
