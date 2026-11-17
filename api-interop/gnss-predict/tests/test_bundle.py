import hashlib
import json
import shutil
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from gnss_predict.bundle import build_manifest, file_sha256, input_hash, write_bundle
from gnss_predict.catalog import build_catalog
from gnss_predict.errors import Message

SNAP = Path(__file__).parent / "fixtures" / "studio" / "snapshot"


def T(*a):
    return datetime(*a, tzinfo=timezone.utc)


class TempRoot(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)


class InputHashTest(unittest.TestCase):
    def test_hash_stable_and_sensitive(self):
        a = input_hash({"b": 1, "a": [1, 2]})
        self.assertEqual(a, input_hash({"a": [1, 2], "b": 1}))
        self.assertEqual(len(a), 12)
        self.assertNotEqual(a, input_hash({"a": [1, 2], "b": 2}))

    def test_hash_formula(self):
        parts = {"start": "2026-11-10T00:00:00Z", "step_s": 30}
        expected = hashlib.sha256(
            b'{"start":"2026-11-10T00:00:00Z","step_s":30}').hexdigest()[:12]
        self.assertEqual(input_hash(parts), expected)

    def test_hash_accepts_datetime_via_str(self):
        parts = {"t": T(2026, 11, 10)}
        self.assertEqual(input_hash(parts), input_hash({"t": str(T(2026, 11, 10))}))

    def test_file_sha256(self):
        d = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, d, ignore_errors=True)
        p = d / "f.bin"
        data = b"abc" * 100000
        p.write_bytes(data)
        self.assertEqual(file_sha256(p), hashlib.sha256(data).hexdigest())


class WriteBundleTest(TempRoot):
    def test_write_bundle_atomic(self):
        out = write_bundle(self.root / "x", {"m.json": b"{}", "sub/a.csv": b"1\n"})
        self.assertEqual(out, self.root / "x")
        self.assertEqual((out / "sub" / "a.csv").read_bytes(), b"1\n")
        self.assertEqual((out / "m.json").read_bytes(), b"{}")
        self.assertEqual([p.name for p in self.root.iterdir()], ["x"])

    def test_nested_subfolders(self):
        out = write_bundle(self.root / "x", {"a/b/c.txt": b"deep"})
        self.assertEqual((out / "a" / "b" / "c.txt").read_bytes(), b"deep")

    def test_existing_bundle_kept(self):
        write_bundle(self.root / "x", {"m.json": b"old"})
        out = write_bundle(self.root / "x", {"m.json": b"new", "extra.txt": b"e"})
        self.assertEqual(out, self.root / "x")
        self.assertEqual((out / "m.json").read_bytes(), b"old")
        self.assertFalse((out / "extra.txt").exists())
        self.assertEqual([p.name for p in self.root.iterdir()], ["x"])

    def test_failure_leaves_nothing(self):
        class Boom(dict):
            def items(self):
                yield "a", b"1"
                raise OSError("disk")

        with self.assertRaises(OSError):
            write_bundle(self.root / "y", Boom())
        self.assertEqual(list(self.root.iterdir()), [])

    def test_unsafe_paths_rejected(self):
        for bad in ("/etc/passwd", "../evil.txt", "a/../../evil.txt", "a/..", ".."):
            with self.subTest(bad=bad):
                with self.assertRaises(ValueError):
                    write_bundle(self.root / "z", {"ok.txt": b"1", bad: b"x"})
                self.assertEqual(list(self.root.iterdir()), [])

    def test_unsafe_path_writes_nothing_outside(self):
        d = self.root / "parent"
        d.mkdir()
        with self.assertRaises(ValueError):
            write_bundle(d / "z", {"../evil.txt": b"x"})
        self.assertEqual(list(d.iterdir()), [])

    def test_creates_missing_parent(self):
        out = write_bundle(self.root / "ephem" / "abc123", {"m.json": b"{}"})
        self.assertTrue((out / "m.json").is_file())

    def test_stale_temp_from_same_pid_is_replaced(self):
        import os
        stale = self.root / f"x.tmp-{os.getpid()}"
        stale.mkdir()
        (stale / "junk").write_bytes(b"junk")
        out = write_bundle(self.root / "x", {"m.json": b"{}"})
        self.assertEqual(sorted(p.name for p in out.iterdir()), ["m.json"])
        self.assertEqual([p.name for p in self.root.iterdir()], ["x"])


class ManifestTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog = build_catalog(SNAP, (T(2026, 11, 10), T(2026, 11, 11)), set("GREC"))

    def test_manifest_fields(self):
        cat = self.catalog
        self.assertTrue(cat.satellites)
        propagated = frozenset(s.prn for s in cat.satellites[:2])
        msgs = [Message("SAT_FLAGGED", "warning", "ข้อความ", "G01"),
                Message("NO_SATELLITES", "info", "x")]
        m = build_manifest("ephem", {"start": "2026-11-10T00:00:00Z", "step_s": 30},
                           cat, msgs, {"gmat_version": "GmatConsole-R2026a"},
                           propagated=propagated, now=T(2026, 11, 11, 6, 0, 5))
        self.assertEqual(m["kind"], "ephem")
        self.assertEqual(m["engine_version"], "0.2.0")
        self.assertEqual(m["created_utc"], "2026-11-11T06:00:05Z")
        self.assertEqual(m["inputs"], {"start": "2026-11-10T00:00:00Z", "step_s": 30})
        self.assertEqual(m["gmat_version"], "GmatConsole-R2026a")
        self.assertEqual(len(m["satellites"]), len(cat.satellites))
        for entry, s in zip(m["satellites"], cat.satellites):
            self.assertEqual(sorted(entry), sorted(
                ["prn", "system", "svn", "norad", "block", "celestrak_name", "omm_epoch",
                 "age_days", "flags", "propagated"]))
            self.assertEqual(entry["prn"], s.prn)
            self.assertEqual(entry["norad"], s.norad)
            self.assertEqual(entry["flags"], sorted(s.flags))
            self.assertIsInstance(entry["flags"], list)
            self.assertEqual(entry["propagated"], s.prn in propagated)
            self.assertEqual(entry["omm_epoch"], s.omm_epoch.strftime("%Y-%m-%dT%H:%M:%SZ"))
            self.assertEqual(entry["age_days"], s.age_days)
            self.assertNotIn("tle_lines", entry)
        self.assertEqual(sum(e["propagated"] for e in m["satellites"]), len(propagated))
        self.assertEqual(m["unmapped"], cat.unmapped)
        self.assertEqual(m["messages"][0], {"code": "SAT_FLAGGED", "level": "warning",
                                            "text": "ข้อความ", "object": "G01"})
        self.assertEqual(m["messages"][1]["object"], None)
        json.dumps(m)  # ต้อง serialise ได้ ไม่มี datetime หรือ frozenset เหลือ

    def test_propagated_defaults_to_false(self):
        m = build_manifest("ephem", {}, self.catalog, [], {})
        self.assertTrue(all(e["propagated"] is False for e in m["satellites"]))

    def test_flags_sorted(self):
        m = build_manifest("ephem", {}, self.catalog, [], {})
        for e in m["satellites"]:
            self.assertEqual(e["flags"], sorted(e["flags"]))

    def test_catalog_none(self):
        m = build_manifest("access", {"ephem": "abc"}, None, [], {"shell_km": 350.0},
                           now=T(2026, 11, 11, 0, 0, 0))
        self.assertEqual(m["kind"], "access")
        self.assertEqual(m["satellites"], [])
        self.assertEqual(m["unmapped"], [])
        self.assertEqual(m["messages"], [])
        self.assertEqual(m["shell_km"], 350.0)
        self.assertEqual(json.loads(json.dumps(m)), m)

    def test_default_now_is_current_utc(self):
        before = datetime.now(timezone.utc).replace(microsecond=0)
        m = build_manifest("ephem", {}, None, [], {})
        after = datetime.now(timezone.utc)
        created = datetime.strptime(m["created_utc"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        self.assertTrue(before <= created <= after)

    def test_now_non_utc_converted(self):
        from datetime import timedelta
        tz = timezone(timedelta(hours=7))
        m = build_manifest("ephem", {}, None, [], {}, now=datetime(2026, 11, 11, 13, 0, 0, tzinfo=tz))
        self.assertEqual(m["created_utc"], "2026-11-11T06:00:00Z")

    def test_extra_merged_at_top_level(self):
        m = build_manifest("ephem", {}, None, [], {"gmat_version": "v", "custom": {"a": 1}})
        self.assertEqual(m["gmat_version"], "v")
        self.assertEqual(m["custom"], {"a": 1})

    def test_unmapped_is_copied(self):
        cat = self.catalog
        m = build_manifest("ephem", {}, cat, [], {})
        if m["unmapped"]:
            m["unmapped"][0]["reason"] = "CHANGED"
            self.assertNotEqual(cat.unmapped[0]["reason"], "CHANGED")


if __name__ == "__main__":
    unittest.main()
