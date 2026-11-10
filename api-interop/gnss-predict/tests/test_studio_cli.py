"""studio.py: fetch_snapshot, run_propagate, run_analyze และ CLI (ไม่ใช้ GMAT ไม่ใช้เน็ต)

GMAT ถูกแทนด้วย propagate ปลอมที่วางดาวไว้ที่ Az/El ที่กำหนดจาก THBK เพื่อตรวจไฟล์ผลลัพธ์ได้แน่นอน
"""

import contextlib
import hashlib
import io
import json
import math
import re
import shutil
import tempfile
import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

from gnss_predict import studio
from gnss_predict.config import THBK_HEIGHT_M, THBK_LAT_DEG, THBK_LON_DEG
from gnss_predict.errors import BrdcUnavailableError, Message, NoSatellitesError, ScenarioError
from gnss_predict.geometry import geodetic_to_ecef
from gnss_predict.propagate import Ephemeris
from gnss_predict.sp3 import read_sp3_all
from gnss_predict.studio import fetch_snapshot, main, run_analyze, run_propagate

UTC = timezone.utc
SNAP = Path(__file__).parent / "fixtures" / "studio" / "snapshot"
SNAPSHOT_NAME = "20261110T0000Z"
NOW = datetime(2026, 11, 10, 6, 5, 42, tzinfo=UTC)
GROUP_FILES = ["beidou.json", "galileo.json", "glo-ops.json", "gps-ops.json"]
HASH_RE = re.compile(r"^[0-9a-f]{12}$")

# ดาวใน scenario: (ชื่อ, NORAD) R10 ถูกซ่อน (too_old), X99 ไม่มีใน snapshot, C06 ไม่มี PRN (unmapped)
SATELLITES = [("G01", 62339), ("G22", 26407), ("E11", 37846), ("R05", 43508), ("C01", 56564),
              ("R10", 100744), ("X99", 99999), ("C06", 36828)]
# Az, El ต้นช่วง, El ปลายช่วง (องศา) ของดาวปลอมแต่ละดวงเมื่อมองจาก THBK
PLAN = {"G01": (0.0, 60.0, 60.0), "E11": (120.0, 45.0, 45.0), "R05": (240.0, 30.0, 30.0),
        "C01": (300.0, -10.0, 50.0), "G22": (60.0, 70.0, 70.0)}
DEFAULT_PLAN = (180.0, 20.0, 20.0)


def scenario_data(satellites=SATELLITES, *, fmt="gnss-studio-scenario/1", step_s=300,
                  show_too_old=False, show_no_broadcast=True) -> dict:
    return {
        "format": fmt,
        "name": "Test_Scen",
        "analysis_period": {"start": "2026-11-10T00:00:00Z", "stop": "2026-11-10T06:00:00Z"},
        "step_s": step_s,
        "orbit_snapshot": SNAPSHOT_NAME,
        "ionosphere": {"shell_km": 400.0},
        "satellite_filter": {"show_too_old": show_too_old, "show_no_broadcast": show_no_broadcast},
        "objects": [{"class": "Facility", "name": "THBK",
                     "position": {"type": "Geodetic", "lat_deg": THBK_LAT_DEG, "lon_deg": THBK_LON_DEG,
                                  "alt_m": THBK_HEIGHT_M},
                     "constraints": {"elevation_angle_min_deg": 10.0}}]
                   + [{"class": "Satellite", "name": n, "norad": norad} for n, norad in satellites],
    }


def write_scenario(folder: Path, data: dict) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "scenario.json").write_text(json.dumps(data), encoding="utf-8")
    return folder


def ecef_from_az_el(az_deg: float, el_deg: float, range_km: float = 22000.0) -> tuple[float, float, float]:
    """ตำแหน่ง ECEF (กม.) ของจุดที่ Az/El/ระยะ ที่กำหนดจาก THBK (แกน ENU ตามเส้นตั้งฉากทรงรี)"""
    sta = geodetic_to_ecef(THBK_LAT_DEG, THBK_LON_DEG, THBK_HEIGHT_M)
    az, el = math.radians(az_deg), math.radians(el_deg)
    lat, lon = math.radians(THBK_LAT_DEG), math.radians(THBK_LON_DEG)
    e, n, u = (range_km * math.cos(el) * math.sin(az), range_km * math.cos(el) * math.cos(az),
               range_km * math.sin(el))
    dx = -math.sin(lon) * e - math.sin(lat) * math.cos(lon) * n + math.cos(lat) * math.cos(lon) * u
    dy = math.cos(lon) * e - math.sin(lat) * math.sin(lon) * n + math.cos(lat) * math.sin(lon) * u
    dz = math.cos(lat) * n + math.sin(lat) * u
    return sta[0] + dx, sta[1] + dy, sta[2] + dz


def fake_propagate(sats, start, stop, step_s, work_dir, console, timeout_s=900):
    n = int((stop - start).total_seconds()) // step_s
    times = [start + timedelta(seconds=k * step_s) for k in range(n + 1)]
    positions = {}
    for s in sats:
        az, el0, el1 = PLAN.get(s.prn, DEFAULT_PLAN)
        positions[s.prn] = [ecef_from_az_el(az, el0 + (el1 - el0) * k / n) for k in range(n + 1)]
    return Ephemeris(times, positions), []


def files_in(folder: Path) -> list[str]:
    return sorted(p.relative_to(folder).as_posix() for p in folder.rglob("*") if p.is_file())


def run_main(argv, now=None) -> tuple[int, str, str]:
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = main(argv, now=now)
    return code, out.getvalue(), err.getvalue()


class TempDirs(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)
        self.data = self.root / "data"
        shutil.copytree(SNAP, self.data / "orbits" / SNAPSHOT_NAME)
        self.sc = write_scenario(self.root / "scen", scenario_data())


class RoutingOpener:
    """opener ปลอม: เลือกเนื้อหาตามข้อความใน URL และเก็บ URL ที่ถูกขอ"""

    def __init__(self, bodies: dict[str, bytes]):
        self.bodies = bodies
        self.urls: list[str] = []

    def __call__(self, request, timeout=None):
        url = request.full_url
        self.urls.append(url)
        for key, body in self.bodies.items():
            if key in url:
                return io.BytesIO(body)
        raise AssertionError(f"ไม่คาดว่าจะขอ {url}")


def fixture_opener() -> RoutingOpener:
    bodies = {f"GROUP={name[:-5]}&": (SNAP / name).read_bytes() for name in GROUP_FILES}
    bodies["igs_satellite_metadata.snx"] = (SNAP / "igs_satellite_metadata.snx").read_bytes()
    return RoutingOpener(bodies)


class TestCli(unittest.TestCase):
    def test_no_subcommand_exit_2(self):
        code, _, err = run_main([])
        self.assertEqual(code, 2)
        self.assertIn("usage", err)

    def test_unknown_system_exit_2(self):
        self.assertEqual(run_main(["fetch", "--systems", "GX"])[0], 2)

    def test_bad_scenario_exit_1(self):
        with tempfile.TemporaryDirectory() as d:
            sc = write_scenario(Path(d), scenario_data(fmt="gnss-studio-scenario/0"))
            code, out, err = run_main(["propagate", "--scenario", str(sc)])
        self.assertEqual(code, 1)
        self.assertEqual(out, "")
        self.assertIn("format", err)
        self.assertIn("SCENARIO_INVALID", err)

    def test_fetch_uses_injected_fetcher(self):
        snap = Path("/tmp/data/orbits/20261110T0605Z")
        msg = Message("BRDC_UNAVAILABLE", "warning", "ไม่มีไฟล์ broadcast")
        with mock.patch.object(studio, "fetch_snapshot", return_value=(snap, [msg])) as fetch:
            code, out, _ = run_main(["fetch", "--data", "/tmp/data", "--systems", "GE"], now=NOW)
        self.assertEqual(code, 0)
        lines = out.splitlines()
        self.assertEqual(lines[0], str(snap))
        self.assertEqual(lines[1:], ["warning: ไม่มีไฟล์ broadcast"])
        fetch.assert_called_once_with(Path("/tmp/data").resolve(), NOW, systems="GE")


class TestFetchSnapshot(unittest.TestCase):
    def setUp(self):
        self.data = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.data, ignore_errors=True)
        self.days: list[date] = []

    def failing_brdc(self, day, dest_dir):
        self.days.append(day)
        raise BrdcUnavailableError(f"ยังไม่มีไฟล์ของ {day}")

    def test_fetch_snapshot_layout(self):
        opener = fixture_opener()
        calls = []
        snap, msgs = fetch_snapshot(self.data, NOW, opener=opener, brdc_fetcher=self.failing_brdc,
                                    progress=lambda s, f: calls.append((s, f)))
        self.assertEqual(snap, self.data / "orbits" / "20261110T0605Z")
        names = GROUP_FILES + ["igs_satellite_metadata.snx"]
        self.assertEqual(files_in(snap), sorted(names + ["SHA256SUMS"]))
        for name in names:
            self.assertEqual((snap / name).read_bytes(), (SNAP / name).read_bytes(), name)
        sums = (snap / "SHA256SUMS").read_bytes().decode("utf-8")
        self.assertTrue(sums.endswith("\n"))
        self.assertEqual(sums.splitlines(), [f"{hashlib.sha256((snap / n).read_bytes()).hexdigest()}  {n}"
                                             for n in sorted(names)])
        self.assertEqual(self.days, [date(2026, 11, 9), date(2026, 11, 8)])
        self.assertEqual([m.code for m in msgs], ["BRDC_UNAVAILABLE"])
        self.assertEqual(msgs[0].level, "warning")
        self.assertEqual(len(opener.urls), 5)
        cache = self.data / "orbits" / "_cache"
        self.assertTrue((cache / "celestrak_state.json").is_file())
        self.assertEqual(len(list(cache.glob("gps-ops_*.json"))), 1)
        self.assertEqual(len(list(cache.glob("igs_satellite_metadata_*.snx"))), 1)
        self.assertEqual((calls[0][1], calls[-1][1]), (0.0, 1.0))

    def test_brdc_falls_back_to_two_days_ago(self):
        def fetcher(day, dest_dir):
            self.days.append(day)
            if day == date(2026, 11, 9):
                raise BrdcUnavailableError("ยังไม่มี")
            path = Path(dest_dir) / f"BRDC00IGS_R_{day.year}{day.timetuple().tm_yday:03d}0000_01D_MN.rnx.gz"
            path.write_bytes(b"nav")
            return path

        snap, msgs = fetch_snapshot(self.data, NOW, systems="GE", opener=fixture_opener(), brdc_fetcher=fetcher)
        brdc_name = "brdc/BRDC00IGS_R_20263120000_01D_MN.rnx.gz"
        self.assertEqual(self.days, [date(2026, 11, 9), date(2026, 11, 8)])
        self.assertEqual(files_in(snap), sorted(["SHA256SUMS", brdc_name, "galileo.json", "gps-ops.json",
                                                 "igs_satellite_metadata.snx"]))
        self.assertEqual((snap / brdc_name).read_bytes(), b"nav")
        self.assertIn(f"{hashlib.sha256(b'nav').hexdigest()}  {brdc_name}",
                      (snap / "SHA256SUMS").read_text().splitlines())
        self.assertEqual(msgs, [])

    def test_unknown_system_rejected(self):
        with self.assertRaises(ValueError):
            fetch_snapshot(self.data, NOW, systems="GX", opener=fixture_opener(), brdc_fetcher=self.failing_brdc)


class TestNoGmatNeeded(TempDirs):
    def test_all_hidden_raises_no_satellites(self):
        sc = write_scenario(self.root / "hidden", scenario_data([("R10", 100744)], show_no_broadcast=False))
        with mock.patch.object(studio, "propagate", side_effect=AssertionError("ไม่ควรรัน GMAT")), \
                mock.patch.object(studio, "find_gmat_console", side_effect=AssertionError("ไม่ควรหา GMAT")):
            with self.assertRaises(NoSatellitesError) as ctx:
                run_propagate(sc, data_dir=self.data, console=None)
        self.assertIn("R10", str(ctx.exception))
        self.assertFalse((sc / "ephem").exists())

    def test_missing_snapshot_is_orbit_unavailable(self):
        data = scenario_data()
        data["orbit_snapshot"] = "20260101T0000Z"
        sc = write_scenario(self.root / "nosnap", data)
        code, out, err = run_main(["propagate", "--scenario", str(sc), "--data", str(self.data)])
        self.assertEqual(code, 1)
        self.assertIn("ORBIT_SOURCE_UNAVAILABLE", err)
        self.assertIn("20260101T0000Z", err)


class FakeGmat(TempDirs):
    def setUp(self):
        super().setUp()
        patches = [mock.patch.object(studio, "propagate", side_effect=fake_propagate),
                   mock.patch.object(studio, "find_gmat_console", return_value=Path("/fake/GmatConsole")),
                   mock.patch.object(studio, "gmat_version", return_value="FakeGmat")]
        self.propagate, _, _ = [p.start() for p in patches]
        for p in patches:
            self.addCleanup(p.stop)


class TestRunPropagate(FakeGmat):
    def test_bundle_manifest_and_cache(self):
        calls = []
        ephem, msgs = run_propagate(self.sc, data_dir=self.data, progress=lambda s, f: calls.append((s, f)))
        self.assertEqual(ephem.parent, self.sc / "ephem")
        self.assertRegex(ephem.name, HASH_RE)
        self.assertEqual(files_in(ephem), ["manifest.json", "predicted.sp3", "scene.czml"])
        self.assertEqual((calls[0][1], calls[-1][1]), (0.0, 1.0))

        sats = self.propagate.call_args.args[0]
        self.assertEqual([s.prn for s in sats], ["C01", "E11", "G01", "G22", "R05"])
        self.assertEqual(set(read_sp3_all(ephem / "predicted.sp3")), {"C01", "E11", "G01", "G22", "R05"})

        man = json.loads((ephem / "manifest.json").read_bytes().decode("utf-8"))
        self.assertEqual(man["kind"], "ephem")
        self.assertEqual(man["gmat_version"], "FakeGmat")
        self.assertEqual(man["inputs"]["orbit_snapshot"], SNAPSHOT_NAME)
        self.assertEqual(sorted(man["inputs"]["files_sha256"]),
                         ["beidou.json", "brdc/BRDC00IGS_R_20263130000_01D_MN.rnx", "galileo.json",
                          "glo-ops.json", "gps-ops.json", "igs_satellite_metadata.snx"])
        self.assertEqual(man["inputs"]["files_sha256"]["gps-ops.json"],
                         hashlib.sha256((SNAP / "gps-ops.json").read_bytes()).hexdigest())
        self.assertEqual((man["inputs"]["start"], man["inputs"]["stop"], man["inputs"]["step_s"]),
                         ("2026-11-10T00:00:00Z", "2026-11-10T06:00:00Z", 300))
        by_prn = {s["prn"]: s for s in man["satellites"]}
        self.assertEqual(sorted(by_prn), ["C01", "E11", "G01", "G22", "R05", "R10"])   # เฉพาะดาวใน scenario
        self.assertFalse(by_prn["R10"]["propagated"])
        self.assertIn("too_old", by_prn["R10"]["flags"])
        self.assertTrue(all(by_prn[p]["propagated"] for p in ("C01", "E11", "G01", "G22", "R05")))
        self.assertEqual([(u["norad"], u["reason"]) for u in man["unmapped"]], [(36828, "NO_PRN")])

        missing = [m for m in msgs if m.code == "SAT_NOT_IN_SNAPSHOT"]
        self.assertEqual([(m.object, m.level) for m in missing], [("X99", "warning"), ("C06", "warning")])
        self.assertEqual(sorted(m.object for m in msgs if m.code == "SAT_FLAGGED"), ["C01", "G22", "R10"])
        self.assertEqual(man["messages"], [m.to_dict() for m in msgs])

        czml = json.loads((ephem / "scene.czml").read_text(encoding="utf-8"))
        self.assertEqual(czml[0]["id"], "document")
        self.assertEqual(sorted(p["id"] for p in czml[1:]), ["sat/C01", "sat/E11", "sat/G01", "sat/G22", "sat/R05"])

        again, msgs2 = run_propagate(self.sc, data_dir=self.data)
        self.assertEqual(again, ephem)
        self.assertEqual(msgs2, msgs)
        self.assertEqual(self.propagate.call_count, 1)

    def test_hash_ignores_order_but_not_filters(self):
        first, _ = run_propagate(self.sc, data_dir=self.data)
        write_scenario(self.sc, scenario_data(list(reversed(SATELLITES))))
        self.assertEqual(run_propagate(self.sc, data_dir=self.data)[0], first)
        self.assertEqual(self.propagate.call_count, 1)
        write_scenario(self.sc, scenario_data(show_too_old=True))
        other, _ = run_propagate(self.sc, data_dir=self.data)
        self.assertNotEqual(other, first)
        self.assertIn("R10", read_sp3_all(other / "predicted.sp3"))

    def test_gmat_drops_every_satellite(self):
        def drop_all(sats, start, stop, step_s, work_dir, console, timeout_s=900):
            eph, _ = fake_propagate(sats, start, stop, step_s, work_dir, console)
            return Ephemeris(eph.times_utc, {}), [Message("SAT_MISSING_FROM_GMAT", "warning", "x", s.prn)
                                                  for s in sats]

        self.propagate.side_effect = drop_all
        with self.assertRaises(NoSatellitesError):
            run_propagate(self.sc, data_dir=self.data)
        self.assertFalse((self.sc / "ephem").exists())


class TestRunAnalyze(FakeGmat):
    def test_outputs(self):
        calls = []
        acc, msgs = run_analyze(self.sc, "THBK", data_dir=self.data, progress=lambda s, f: calls.append((s, f)))
        self.assertEqual(acc.parent, self.sc / "access" / "THBK")
        self.assertRegex(acc.name, HASH_RE)
        self.assertEqual(files_in(acc), ["access.czml", "aer.csv", "dop.csv", "intervals.json",
                                         "legacy_gps.csv", "manifest.json"])
        self.assertEqual((calls[0][1], calls[-1][1]), (0.0, 1.0))
        ephem = next((self.sc / "ephem").iterdir())

        for name in ("aer.csv", "dop.csv", "legacy_gps.csv", "intervals.json", "manifest.json"):
            raw = (acc / name).read_bytes()
            self.assertFalse(raw.startswith(b"\xef\xbb\xbf"), name)
            self.assertNotIn(b"\r", raw, name)
            self.assertTrue(raw.endswith(b"\n"), name)

        aer = (acc / "aer.csv").read_text(encoding="utf-8").splitlines()
        self.assertEqual(aer[0], "time_utc,prn,az_deg,el_deg,range_km,ipp_lat_deg,ipp_lon_deg,mf")
        row_re = re.compile(r"^2026-11-10T\d\d:\d\d:\d\dZ,[GREC]\d\d,\d+\.\d{3},\d+\.\d{3},\d+\.\d{3},"
                            r"-?\d+\.\d{4},-?\d+\.\d{4},\d+\.\d{5}$")
        for line in aer[1:]:
            self.assertRegex(line, row_re)
        self.assertEqual(aer[1].split(",")[:2], ["2026-11-10T00:00:00Z", "E11"])
        c01_times = [line.split(",")[0] for line in aer[1:] if line.split(",")[1] == "C01"]
        self.assertGreater(c01_times[0], "2026-11-10T00:55:00Z")         # El < 0 ก่อนราว 01:00 ไม่อยู่ใน aer.csv

        dop = [line.split(",") for line in (acc / "dop.csv").read_text(encoding="utf-8").splitlines()]
        self.assertEqual(dop[0], ["time_utc", "system", "n_visible", "gdop", "pdop", "hdop", "vdop", "edop",
                                  "ndop", "tdop"])
        self.assertEqual(len(dop) - 1, 73 * 5)
        self.assertEqual([r[1] for r in dop[1:6]], ["ALL", "G", "R", "E", "C"])
        self.assertEqual(dop[1], ["2026-11-10T00:00:00Z", "ALL", "3"] + [""] * 7)
        self.assertEqual(dop[-5][1:3], ["ALL", "4"])                     # G22 ไม่ใช้ (no_broadcast)
        for value in dop[-5][3:]:
            self.assertRegex(value, r"^\d+\.\d{3}$")
        gaps = sum(1 for r in dop[1:] if r[1] == "ALL" and r[3] == "")
        dop_gaps = [m for m in msgs if m.code == "DOP_GAPS"]
        self.assertEqual(len(dop_gaps), 1)
        self.assertEqual((dop_gaps[0].level, dop_gaps[0].object), ("warning", "THBK"))
        self.assertIn(str(gaps), dop_gaps[0].text)

        iv = json.loads((acc / "intervals.json").read_text(encoding="utf-8"))
        self.assertEqual((iv["facility"], iv["min_el_deg"]), ("THBK", 10.0))
        self.assertEqual(sorted(iv["intervals"]), ["C01", "E11", "G01", "G22", "R05"])
        self.assertEqual(iv["intervals"]["G01"], [{"start": "2026-11-10T00:00:00.000Z",
                                                   "stop": "2026-11-10T06:00:00.000Z",
                                                   "duration_s": 21600.0, "max_el_deg": 60.0}])
        c01 = iv["intervals"]["C01"]
        self.assertEqual(len(c01), 1)
        self.assertRegex(c01[0]["start"], r"^2026-11-10T0[12]:\d\d:\d\d\.\d{3}Z$")
        self.assertEqual(c01[0]["stop"], "2026-11-10T06:00:00.000Z")
        stats = iv["global_statistics"]
        self.assertEqual(stats["count"], 5)
        self.assertEqual(stats["max_duration_s"], 21600.0)

        legacy = (acc / "legacy_gps.csv").read_text(encoding="utf-8").splitlines()
        self.assertEqual(legacy[0], "DAY,Time,PRN,Az,El,IPP_Lat,IPP_Lon,MF")
        self.assertEqual({r.split(",")[2] for r in legacy[1:]}, {"G01", "G22"})
        self.assertEqual(len(legacy) - 1, 73 * 2)

        czml = json.loads((acc / "access.czml").read_text(encoding="utf-8"))
        self.assertEqual(czml[0]["id"], "document")
        self.assertEqual([p["id"] for p in czml].count("document"), 1)
        self.assertIn("fac/THBK", [p["id"] for p in czml])
        self.assertIn("access/THBK/C01", [p["id"] for p in czml])

        man = json.loads((acc / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(man["kind"], "access")
        self.assertEqual(man["inputs"]["ephem_hash"], ephem.name)
        self.assertEqual(man["inputs"]["facility"], {"name": "THBK", "lat_deg": THBK_LAT_DEG,
                                                     "lon_deg": THBK_LON_DEG, "alt_m": THBK_HEIGHT_M,
                                                     "min_el_deg": 10.0})
        self.assertEqual(man["inputs"]["shell_km"], 400.0)
        self.assertEqual([m["code"] for m in man["messages"]], ["DOP_GAPS"])

        again, msgs2 = run_analyze(self.sc, "THBK", data_dir=self.data)
        self.assertEqual((again, msgs2), (acc, msgs))
        self.assertEqual(self.propagate.call_count, 1)

    def test_unknown_facility_raises_before_propagate(self):
        with self.assertRaises(ScenarioError) as ctx:
            run_analyze(self.sc, "NOPE", data_dir=self.data)
        self.assertIn("NOPE", str(ctx.exception))
        self.propagate.assert_not_called()

    def test_cli_analyze(self):
        code, out, err = run_main(["analyze", "--scenario", str(self.sc), "--facility", "THBK",
                                   "--data", str(self.data)])
        self.assertEqual(code, 0, err)
        lines = out.splitlines()
        acc = Path(lines[0])
        self.assertEqual(acc.parent, (self.sc / "access" / "THBK").resolve())
        self.assertTrue((acc / "aer.csv").is_file())
        self.assertTrue(any(line.startswith("warning: ") for line in lines[1:]))


if __name__ == "__main__":
    unittest.main()
