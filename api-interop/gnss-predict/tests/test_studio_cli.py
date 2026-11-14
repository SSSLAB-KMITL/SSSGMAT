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
from gnss_predict.studio import (PropagatePlan, fetch_snapshot, main, plan_analyze, plan_propagate,
                                 run_analyze, run_propagate, run_validate)
from tests.report_fixture import build_computed_scenario, circular_ecef_km

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

    def test_corrupt_manifest_is_result_corrupt(self):
        ephem, _ = run_propagate(self.sc, data_dir=self.data)
        (ephem / "manifest.json").write_text("{ไม่ใช่ JSON", encoding="utf-8")
        code, out, err = run_main(["propagate", "--scenario", str(self.sc), "--data", str(self.data)])
        self.assertEqual((code, out), (1, ""))
        self.assertTrue(err.startswith("error: RESULT_CORRUPT: "), err)
        self.assertIn(str(ephem.resolve()), err)
        self.assertNotIn("Traceback", err)

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


class TestHashInputs(FakeGmat):
    """ข้อมูลตั้งต้นทุกตัวตามหัวข้อ 5.12 ของ spec engine ต้องเปลี่ยนชื่อโฟลเดอร์ผล (ไม่งั้นจะได้ผลเก่าที่ไม่ตรง)"""

    def ephem_name(self) -> str:
        return run_propagate(self.sc, data_dir=self.data)[0].name

    def test_ephem_hash_changes_with_every_input(self):
        base = self.ephem_name()
        names = {}
        snapshot = self.data / "orbits" / SNAPSHOT_NAME
        used = json.loads((self.sc / "ephem" / base / "manifest.json").read_bytes())["inputs"]["files_sha256"]
        self.assertEqual(len(used), 6)
        for rel in used:                                    # ไบต์ของทุกไฟล์ใน snapshot ที่ build_catalog อ่าน
            path = snapshot / rel
            original = path.read_bytes()
            path.write_bytes(original + b"\n")             # ความหมายเดิม ไบต์ต่าง
            try:
                names[f"file {rel}"] = self.ephem_name()
            finally:
                path.write_bytes(original)
        self.assertEqual(self.ephem_name(), base)          # คืนไฟล์แล้วได้โฟลเดอร์เดิม

        def scenario_variant(key, change):
            data = scenario_data()
            change(data)
            write_scenario(self.sc, data)
            names[key] = self.ephem_name()

        scenario_variant("start", lambda d: d["analysis_period"].update(start="2026-11-10T01:00:00Z"))
        scenario_variant("stop", lambda d: d["analysis_period"].update(stop="2026-11-10T05:00:00Z"))
        scenario_variant("step_s", lambda d: d.update(step_s=600))
        scenario_variant("satellites", lambda d: d.update(objects=[o for o in d["objects"] if o["name"] != "E11"]))
        write_scenario(self.sc, scenario_data())
        with mock.patch.object(studio, "ENGINE_VERSION", "9.9.9"):
            names["engine_version"] = self.ephem_name()

        for key, name in names.items():
            self.assertNotEqual(name, base, key)
        self.assertEqual(len(set(names.values())), len(names), names)

    def test_access_hash_changes_with_facility_and_shell(self):
        base = run_analyze(self.sc, "THBK", data_dir=self.data)[0]

        def facility(d):
            return next(o for o in d["objects"] if o["class"] == "Facility")

        variants = {
            "min_el": lambda d: facility(d)["constraints"].update(elevation_angle_min_deg=15.0),
            "latitude": lambda d: facility(d)["position"].update(lat_deg=THBK_LAT_DEG + 0.5),
            "shell_km": lambda d: d["ionosphere"].update(shell_km=350.0),
        }
        names = {}
        for key, change in variants.items():
            data = scenario_data()
            change(data)
            write_scenario(self.sc, data)
            acc, _ = run_analyze(self.sc, "THBK", data_dir=self.data)
            self.assertEqual(acc.parent, base.parent, key)
            names[key] = acc.name
        for key, name in names.items():
            self.assertNotEqual(name, base.name, key)
        self.assertEqual(len(set(names.values())), len(names), names)
        self.assertEqual(self.propagate.call_count, 1)     # Facility และ shell_km ไม่อยู่ใน hash ของ ephem


class TestDopWithEmptySky(FakeGmat):
    # ทุกดวงเริ่มใต้ขอบฟ้า: 20 จุดเวลาแรก (00:00–01:35) ไม่มีดาวเหนือขอบฟ้าเลย จึงไม่มีแถวใน aer.csv
    EMPTY_SKY = {"G01": (0.0, -25.5, 46.5), "E11": (120.0, -25.5, 58.5), "R05": (240.0, -25.5, 70.5),
                 "C01": (300.0, -25.5, 34.5), "G22": (60.0, -25.5, 52.5)}

    def test_epochs_without_any_satellite_still_have_dop_rows(self):
        with mock.patch.dict(PLAN, self.EMPTY_SKY):
            acc, msgs = run_analyze(self.sc, "THBK", data_dir=self.data)
        aer_times = {line.split(",")[0] for line in (acc / "aer.csv").read_text(encoding="utf-8").splitlines()[1:]}
        dop = [line.split(",") for line in (acc / "dop.csv").read_text(encoding="utf-8").splitlines()[1:]]
        self.assertEqual(len(dop), 73 * 5)
        empty = sorted({r[0] for r in dop} - aer_times)
        self.assertEqual(len(empty), 20)
        self.assertEqual((empty[0], empty[-1]), ("2026-11-10T00:00:00Z", "2026-11-10T01:35:00Z"))
        for t in empty:
            rows = [r for r in dop if r[0] == t]
            self.assertEqual([r[1:] for r in rows], [[system, "0"] + [""] * 7 for system in ("ALL", "G", "R", "E", "C")])
        gaps = sum(1 for r in dop if r[1] == "ALL" and r[3] == "")
        self.assertGreaterEqual(gaps, len(empty))
        dop_gaps = [m for m in msgs if m.code == "DOP_GAPS"]
        self.assertEqual(len(dop_gaps), 1)
        self.assertIn(f"{gaps} จาก 73 จุดเวลา", dop_gaps[0].text)


class TestServerHooks(FakeGmat):
    """ส่วนเพิ่มสำหรับ server: plan hash โดยไม่รัน GMAT, ส่ง on_gmat_start ต่อถึง GMAT, ยกเลิกกลางทางไม่ทิ้งผล"""

    def test_plan_propagate_matches_run_propagate(self):
        plan = plan_propagate(self.sc, self.data)
        self.assertIsInstance(plan, PropagatePlan)
        self.assertRegex(plan.hash, HASH_RE)
        ephem, msgs = run_propagate(self.sc, self.data)
        self.assertEqual(plan.hash, ephem.name)
        self.assertEqual(sorted(plan.satellites), sorted(read_sp3_all(ephem / "predicted.sp3")))
        self.assertEqual(sorted(plan.satellites), ["C01", "E11", "G01", "G22", "R05"])
        self.assertEqual(plan.messages, msgs)                       # GMAT ปลอมไม่มีข้อความ จึงเหลือข้อความของ catalog/selection
        self.assertEqual([m.object for m in plan.messages if m.code == "SAT_NOT_IN_SNAPSHOT"], ["X99", "C06"])
        self.assertEqual(plan_propagate(self.sc, self.data), plan)                      # ผลเดิมแล้ว hash ยังเท่าเดิม

    def test_plan_propagate_never_runs_gmat_or_writes(self):
        with mock.patch.object(studio, "find_gmat_console", side_effect=AssertionError("ไม่ควรหา GMAT")):
            plan_propagate(self.sc, self.data)
        self.propagate.assert_not_called()
        self.assertFalse((self.sc / "ephem").exists())

    def test_plan_propagate_hash_follows_filters(self):
        base = plan_propagate(self.sc, self.data)
        write_scenario(self.sc, scenario_data(show_too_old=True))
        other = plan_propagate(self.sc, self.data)
        self.assertNotEqual(other.hash, base.hash)
        self.assertIn("R10", other.satellites)

    def test_plan_propagate_without_satellites_raises(self):
        sc = write_scenario(self.root / "hidden", scenario_data([("R10", 100744)], show_no_broadcast=False))
        with self.assertRaises(NoSatellitesError):
            plan_propagate(sc, self.data)

    def test_plan_analyze_matches_run_analyze(self):
        plan = plan_analyze(self.sc, "THBK", self.data)
        self.assertRegex(plan, HASH_RE)
        self.propagate.assert_not_called()
        self.assertEqual(plan, run_analyze(self.sc, "THBK", self.data)[0].name)
        self.assertEqual(plan_analyze(self.sc, "thbk", self.data), plan)                # ชื่อ Facility ไม่แยกตัวพิมพ์

    def test_plan_analyze_changes_with_shell_km(self):
        base = plan_analyze(self.sc, "THBK", self.data)
        data = scenario_data()
        data["ionosphere"]["shell_km"] = 350.0
        write_scenario(self.sc, data)
        self.assertNotEqual(plan_analyze(self.sc, "THBK", self.data), base)

    def test_plan_analyze_unknown_facility(self):
        with self.assertRaises(ScenarioError):
            plan_analyze(self.sc, "NOPE", self.data)

    def test_progress_exception_leaves_no_bundle(self):
        def boom(stage, f):
            if stage == "gmat":
                raise KeyboardInterrupt

        with self.assertRaises(KeyboardInterrupt):
            run_propagate(self.sc, self.data, progress=boom)
        self.assertFalse((self.sc / "ephem").exists() and any((self.sc / "ephem").iterdir()))

    def use_hooked_gmat(self) -> list[int]:
        """propagate ปลอมที่รับ on_gmat_start และเรียกมันเหมือน run_script จริง; คืนรายการ pgid ที่ hook ได้รับ"""
        def hooked(sats, start, stop, step_s, work_dir, console, timeout_s=900, on_gmat_start=None):
            if on_gmat_start is not None:
                on_gmat_start(4242)
            return fake_propagate(sats, start, stop, step_s, work_dir, console)

        self.propagate.side_effect = hooked
        return []

    def test_on_gmat_start_passed_through(self):
        got = self.use_hooked_gmat()
        run_propagate(self.sc, self.data, on_gmat_start=got.append)
        self.assertEqual(got, [4242])

    def test_on_gmat_start_not_called_for_existing_result(self):
        got = self.use_hooked_gmat()
        run_propagate(self.sc, self.data)
        run_propagate(self.sc, self.data, on_gmat_start=got.append)
        self.assertEqual(got, [])

    def test_on_gmat_start_passed_through_analyze(self):
        got = self.use_hooked_gmat()
        run_analyze(self.sc, "THBK", self.data, on_gmat_start=got.append)
        self.assertEqual(got, [4242])

    def test_on_gmat_start_passed_through_validate(self):
        class Stop(Exception):
            pass

        hook = lambda pgid: None
        with mock.patch.object(studio, "run_propagate", side_effect=Stop) as rp:
            with self.assertRaises(Stop):
                run_validate(self.sc, date(2026, 11, 10), self.data, on_gmat_start=hook)
        self.assertIs(rp.call_args.kwargs["on_gmat_start"], hook)


class TestReportCli(unittest.TestCase):
    """CLI report (ไม่รัน GMAT ไม่ analyze ให้): G01 อยู่เหนือ THBK ตลอด ส่วนดาวอื่นวงโคจรวงกลม"""

    NOW = datetime(2026, 11, 15, 0, 0, tzinfo=UTC)
    G01 = "*/Facility/THBK */Satellite/G01"

    @classmethod
    def setUpClass(cls):
        cls._tmp = tempfile.TemporaryDirectory()
        up = geodetic_to_ecef(THBK_LAT_DEG, THBK_LON_DEG, THBK_HEIGHT_M)
        norm = math.sqrt(sum(c * c for c in up))
        overhead = tuple(c / norm * 26560.0 for c in up)

        def ecef(prn, t_s):
            return overhead if prn == "G01" else circular_ecef_km(prn[0], 0, 1, t_s)

        sc, cls.data = build_computed_scenario(Path(cls._tmp.name), ecef=ecef)
        cls.sc = str(sc)

    @classmethod
    def tearDownClass(cls):
        cls._tmp.cleanup()

    def run_report(self, *args, now=None):
        return run_main(["report", "--scenario", self.sc, "--data", str(self.data), *args], now=now)

    def expected(self, style, objects, fmt="txt", kind="report"):
        from gnss_predict.dataproviders import open_result_set
        from gnss_predict.report_format import format_csv, format_txt
        from gnss_predict.report_style import build_report, resolve_style
        rs = open_result_set(Path(self.sc), Path(self.data))
        report = build_report(rs, resolve_style(style, kind, [], []), objects, None, None, None, self.NOW)
        return (format_txt if fmt == "txt" else format_csv)(report, "UTCG", "+07:00")

    def test_report_txt_to_stdout(self):
        both = "*/Facility/THBK */Satellite/G01"
        code, out, err = self.run_report("--style", "Access", "--object", both, now=self.NOW)
        self.assertEqual((code, err), (0, ""))
        self.assertEqual(out, self.expected("Access", [both]))
        self.assertIn("THBK-To-G01:  Access", out)
        # เวลาสร้างมาจากนาฬิกาจริงเมื่อไม่ส่ง now: เทียบโดยตัดบรรทัดแรก
        code, out2, _ = self.run_report("--style", "Access", "--object", both)
        self.assertEqual(code, 0)
        self.assertRegex(out2.split("\n")[0], r"^Test_Scen    \d{1,2} \w{3} \d{4} \d\d:\d\d:\d\d\.\d{3} UTCG$")
        self.assertEqual(out2.split("\n", 1)[1], out.split("\n", 1)[1])
        # path ของผลลัพธ์ไม่ถูกพิมพ์ นอกจากตัวรายงาน
        self.assertNotIn(self.sc, out)

    def test_report_several_objects_and_kinds(self):
        e11 = "*/Facility/THBK */Satellite/E11"
        code, out, _ = self.run_report("--style", "Access", "--object", self.G01, "--object", e11, now=self.NOW)
        self.assertEqual(code, 0)
        self.assertEqual(out, self.expected("Access", [self.G01, e11]))
        self.assertIn("Global Statistics", out)
        code, out, _ = self.run_report("--style", "Access", "--kind", "graph", "--object", self.G01, now=self.NOW)
        self.assertEqual((code, out), (0, self.expected("Access", [self.G01], kind="graph")))
        code, out, _ = self.run_report("--style", "LLA Position", "--object", "*/Satellite/G01", now=self.NOW)
        self.assertEqual((code, out), (0, self.expected("LLA Position", ["*/Satellite/G01"])))
        code, out, _ = self.run_report("--style", "All DOPs", "--object", "*/Facility/THBK", "--format", "csv",
                                       now=self.NOW)
        self.assertEqual((code, out), (0, self.expected("All DOPs", ["*/Facility/THBK"], fmt="csv")))

    def test_report_csv_with_window(self):
        code, out, err = self.run_report("--style", "AER", "--format", "csv", "--object", self.G01,
                                         "--start", "2026-11-10T01:00:00Z", "--stop", "2026-11-10T02:00:00Z",
                                         "--step", "120")
        self.assertEqual((code, err), (0, ""))
        lines = out.split("\n")
        self.assertEqual(lines[0], "Time (UTCG),Azimuth (deg),Elevation (deg),Range (km)")
        rows = [line for line in lines[1:] if line]
        self.assertEqual(len(rows), 31)                                # 01:00:00 ถึง 02:00:00 ทุก 2 นาที ปิดทั้งสองข้าง
        stamps = [datetime.strptime(r.split(",")[0], "%d %b %Y %H:%M:%S.000 UTCG").replace(tzinfo=UTC) for r in rows]
        start, stop = datetime(2026, 11, 10, 1, tzinfo=UTC), datetime(2026, 11, 10, 2, tzinfo=UTC)
        self.assertTrue(all(start <= t <= stop for t in stamps))
        self.assertEqual({(b - a).total_seconds() for a, b in zip(stamps, stamps[1:])}, {120.0})
        self.assertEqual(stamps[0], start)

    def test_report_uses_scenario_units_and_styles(self):
        path = Path(self.sc) / "scenario.json"
        original = path.read_bytes()
        self.addCleanup(path.write_bytes, original)
        doc = json.loads(original)
        doc["units"] = {"date_format": "LTZG", "ltz_offset": "-05:30"}
        doc["styles"] = [{"name": "Mine", "kind": "report", "object_type": "Access",
                          "content": [{"provider": "Access Data", "group": None,
                                       "elements": ["Start Time", "Duration"]}]}]
        path.write_text(json.dumps(doc), encoding="utf-8")
        code, out, err = self.run_report("--style", "mine", "--format", "csv", "--object", self.G01, now=self.NOW)
        self.assertEqual((code, err), (0, ""))
        self.assertEqual(out.split("\n")[0], "Start Time (LTZG-05:30),Duration (sec)")
        self.assertTrue(out.split("\n")[1].startswith("9 Nov 2026 18:30:00.000 LTZG-05:30,"))   # 00:00Z − 5:30
        doc["units"] = {"date_format": "GPS"}
        path.write_text(json.dumps(doc), encoding="utf-8")
        code, _, err = self.run_report("--style", "Access", "--object", self.G01)
        self.assertEqual(code, 1)
        self.assertTrue(err.startswith("error: SCENARIO_INVALID:"), err)

    def test_report_errors(self):
        code, out, err = self.run_report("--style", "AER", "--object", self.G01, "--step", "90")
        self.assertEqual((code, out), (1, ""))
        self.assertTrue(err.startswith("error: SCENARIO_INVALID:"), err)
        code, out, err = self.run_report("--style", "NoSuchStyle", "--object", self.G01)
        self.assertEqual((code, out), (1, ""))
        self.assertTrue(err.startswith("error: STYLE_INVALID:"), err)
        code, _, err = self.run_report("--style", "Access", "--object", "*/Facility/THBK")    # ชนิด object ไม่ตรง style
        self.assertEqual(code, 1)
        self.assertTrue(err.startswith("error: SCENARIO_INVALID:"), err)
        code, _, err = self.run_report("--style", "Access", "--object", self.G01, "--start", "2026-11-10T01:00:00Z")
        self.assertEqual(code, 1)
        self.assertTrue(err.startswith("error: SCENARIO_INVALID:"), err)
        code, _, err = self.run_report("--style", "Access", "--object", "*/Facility/NOPE */Satellite/G01")
        self.assertEqual(code, 1)
        self.assertTrue(err.startswith("error: SCENARIO_INVALID:"), err)

    def test_report_argument_errors_exit_2(self):
        for args in (["--style", "Access"],                                          # ไม่ส่ง --object
                     ["--object", self.G01],                                         # ไม่ส่ง --style
                     ["--style", "Access", "--object", self.G01, "--format", "pdf"],
                     ["--style", "Access", "--object", self.G01, "--kind", "chart"],
                     ["--style", "Access", "--object", self.G01, "--step", "abc"],
                     ["--style", "Access", "--object", self.G01, "--start", "yesterday"],
                     ["--style", "Access", "--object", self.G01, "--start", "2026-11-10T01:00:00"]):   # ไม่มีเขตเวลา
            with self.subTest(args=args):
                code, out, _ = self.run_report(*args)
                self.assertEqual((code, out), (2, ""))
        code, _, _ = run_main(["report", "--style", "Access", "--object", self.G01])           # ไม่ส่ง --scenario
        self.assertEqual(code, 2)


class TestReportCliWithoutResults(TempDirs):
    def test_no_analyze_results_is_results_not_current(self):
        for style, obj in (("Access", "*/Facility/THBK */Satellite/G01"), ("LLA Position", "*/Satellite/G01"),
                           ("All DOPs", "*/Facility/THBK")):
            with self.subTest(style=style):
                code, out, err = run_main(["report", "--scenario", str(self.sc), "--data", str(self.data),
                                           "--style", style, "--object", obj])
                self.assertEqual((code, out), (1, ""))
                self.assertTrue(err.startswith("error: RESULTS_NOT_CURRENT:"), err)
        self.assertFalse((self.sc / "ephem").exists())               # CLI ไม่รัน GMAT ไม่เขียนผลให้
        self.assertFalse((self.sc / "access").exists())

    def test_broken_scenario_is_scenario_invalid(self):
        (self.sc / "scenario.json").write_text("{", encoding="utf-8")
        code, _, err = run_main(["report", "--scenario", str(self.sc), "--data", str(self.data),
                                 "--style", "Access", "--object", "*/Facility/THBK */Satellite/G01"])
        self.assertEqual(code, 1)
        self.assertTrue(err.startswith("error: SCENARIO_INVALID:"), err)


if __name__ == "__main__":
    unittest.main()
