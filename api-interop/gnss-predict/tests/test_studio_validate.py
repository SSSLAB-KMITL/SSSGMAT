"""studio_validate.validate_ephemeris และ studio.run_validate (ไม่ใช้เน็ต ไม่ใช้ GMAT)

ตำแหน่งดาวจริงมาจาก tests/fixtures/studio/mgx_sample.sp3: E11 อยู่เหนือ THBK ตลอด 00:00–03:00 GPST (El 18–89°)
ดาวอื่นในไฟล์ test ใช้วงโคจรของ E11 หมุนรอบแกน Z ไม่กี่องศา เพื่อให้ทุกดวงมองเห็นจาก THBK ในช่วงที่เทียบ
ส่วน test ของ run_validate ใช้วงโคจรสังเคราะห์ที่รู้ Az/El แน่นอน (ฟังก์ชันของเวลา GPST) เพราะต้องครอบคลุมวันที่ 2026-11-10
"""

import contextlib
import gzip
import io
import json
import math
import shutil
import tempfile
import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

from gnss_predict import studio
from gnss_predict.brdc import position_km, read_nav
from gnss_predict.config import GPS_UTC_OFFSET_S, THBK_HEIGHT_M, THBK_LAT_DEG, THBK_LON_DEG
from gnss_predict.errors import BrdcUnavailableError, ScenarioError, Sp3UnavailableError
from gnss_predict.geometry import ecef_to_aer, geodetic_to_ecef
from gnss_predict.propagate import Ephemeris
from gnss_predict.scenario import Facility
from gnss_predict.sp3 import lagrange_at, read_sp3_all, write_sp3
from gnss_predict.studio import main, run_validate
from gnss_predict.studio_validate import _TruthTrack, validate_ephemeris

UTC = timezone.utc
OFFSET = timedelta(seconds=GPS_UTC_OFFSET_S)
FXS = Path(__file__).parent / "fixtures" / "studio"
NAV_FILE = FXS / "snapshot" / "brdc" / "BRDC00IGS_R_20263130000_01D_MN.rnx"
REAL = read_sp3_all(FXS / "mgx_sample.sp3")          # GPST 2026-11-09 00:00–03:00 ทุก 5 นาที: C19 C38 E11 G01 R05
THBK = Facility("THBK", THBK_LAT_DEG, THBK_LON_DEG, THBK_HEIGHT_M, 10.0)
STA = geodetic_to_ecef(THBK_LAT_DEG, THBK_LON_DEG, THBK_HEIGHT_M)
DAY = date(2026, 11, 9)
# grid ของ predicted.sp3: UTC 00:30–02:30 ทุก 1 นาที (GPST + 18 วินาที ไม่ตรง grid 5 นาทีของ truth) ทั้งหมดอยู่ในช่วงที่ Lagrange ใช้ได้
GRID = [datetime(2026, 11, 9, 0, 30, tzinfo=UTC) + timedelta(minutes=k) for k in range(121)]
# grid ที่ตรง truth พอดี (UTC 23:59:42 ของวันก่อน = 00:00:00 GPST): epoch แรกเป็นของวันที่ 2026-11-08 ตามเวลา UTC
EXACT_GRID = [datetime(2026, 11, 8, 23, 59, 42, tzinfo=UTC) + timedelta(minutes=5 * k) for k in range(37)]
ZERO = (0.0, 0.0, 0.0)


def rotz(p, deg):
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    return (c * p[0] - s * p[1], s * p[0] + c * p[1], p[2])


def shifted(deg):
    """วงโคจรจริงของ E11 หมุนรอบแกน Z เพื่อให้ได้ดวงอื่นที่ยังมองเห็นจาก THBK"""
    return {t: rotz(p, deg) for t, p in REAL["E11"].items()}


def plus(p, off):
    return (p[0] + off[0], p[1] + off[1], p[2] + off[2])


def write_truth(path: Path, tracks: dict) -> None:
    times_gpst = sorted(next(iter(tracks.values())))
    write_sp3([t - OFFSET for t in times_gpst], {prn: [tr[t] for t in times_gpst] for prn, tr in tracks.items()}, path)


def pred_from_truth(truth_path: Path, offsets: dict, grid=GRID) -> dict:
    """ตำแหน่งที่ทำนายของแต่ละ PRN = ตำแหน่งจริง (Lagrange จาก truth ที่อ่านกลับ) + offset (กม.)"""
    truth = read_sp3_all(truth_path)
    return {prn: [plus(lagrange_at(truth[prn], t + OFFSET), off) for t in grid] for prn, off in offsets.items()}


def el_of(p) -> float:
    return ecef_to_aer(p, STA, THBK_LAT_DEG, THBK_LON_DEG)[1]


class ValidateCase(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.dir, ignore_errors=True)
        self.truth_path = self.dir / "truth.sp3"
        self.pred_path = self.dir / "predicted.sp3"

    def validate(self, tracks: dict, offsets: dict, *, nav=None, fac=THBK, flags=None, ages=None, day=DAY,
                 grid=GRID, pred=None) -> dict:
        write_truth(self.truth_path, tracks)
        positions = pred if pred is not None else pred_from_truth(self.truth_path, offsets, grid)
        write_sp3([t for t in grid], positions, self.pred_path)
        ages = ages if ages is not None else {prn: 0.5 for prn in positions}
        return validate_ephemeris(self.pred_path, self.truth_path, nav, fac, flags or {}, ages, day)


class TestTruthTrack(unittest.TestCase):
    def test_same_as_lagrange_at_on_whole_series(self):
        # ส่งเฉพาะจุดใกล้ t ต้องได้ผลเท่ากับ lagrange_at บนอนุกรมทั้งหมดทุกกรณี: ขอบ ช่องว่าง และจุดที่ตรงพอดี
        series = dict(REAL["E11"])
        del series[datetime(2026, 11, 9, 1, 30, tzinfo=UTC)]                     # ช่องว่าง 10 นาที
        track = _TruthTrack(series)
        t0 = datetime(2026, 11, 9, tzinfo=UTC)
        times = [t0 + timedelta(seconds=s) for s in range(-600, 3 * 3600 + 601, 97)]
        times += sorted(series)[:3] + sorted(series)[-3:]
        got = [track.at(t) for t in times]
        self.assertEqual(got, [lagrange_at(series, t) for t in times])
        self.assertIn(None, got)                                                  # มีทั้งขอบและช่องว่างจริง
        self.assertTrue(sum(p is not None for p in got) > 50)


class TestValidateEphemeris(ValidateCase):
    def test_offset_gives_expected_stats(self):
        tracks = {"G01": shifted(1), "G02": shifted(-1), "E11": shifted(0), "C19": shifted(2), "R05": shifted(-2)}
        res = self.validate(tracks, {prn: (0.5, 0.0, 0.0) for prn in tracks})
        self.assertEqual((res["day"], res["truth_file"]), ("2026-11-09", "truth.sp3"))
        self.assertEqual(sorted(res["systems"]), ["C", "E", "G", "R"])
        self.assertEqual(sorted(res["satellites"]), sorted(tracks))
        for prn, sat in res["satellites"].items():
            self.assertEqual(sat["truth"], "sp3", prn)
            self.assertEqual(sat["result"], "pass", prn)
            self.assertEqual(sat["pairs"], len(GRID), prn)
            self.assertAlmostEqual(sat["d3_median_km"], 0.5, places=3)
            self.assertAlmostEqual(sat["d3_max_km"], 0.5, places=3)
            self.assertGreater(sat["el_median"], 0.0)
            self.assertGreater(sat["az_median"], 0.0)
            self.assertLess(sat["el_p99"], 0.2)
            self.assertLess(sat["az_p99"], 0.5)
            self.assertEqual(sat["age_days"], 0.5)
        for letter, system in res["systems"].items():
            self.assertTrue(system["pass"], letter)
            self.assertEqual(system["sats"], 2 if letter == "G" else 1)
            self.assertEqual(system["pairs"], len(GRID) * system["sats"])
            self.assertLessEqual(system["az_pairs"], system["pairs"])
        self.assertEqual(res["failing"], [])
        self.assertIs(res["pass"], True)
        json.dumps(res)                                       # ใส่ลง JSON ได้ตรง ๆ

    def test_pooled_stats_match_legacy_percentile(self):
        # สถิติระดับระบบคือสถิติของคู่ทั้งหมดรวมกัน (ไม่ใช่ค่าเฉลี่ยของรายดวง) และ P99 คิดแบบ validate._p99 เดิม
        from gnss_predict.validate import _p99, az_diff
        tracks = {"G01": shifted(1), "G02": shifted(-1)}
        offs = {"G01": (0.5, 0.0, 0.0), "G02": (0.0, 1.5, 0.0)}
        res = self.validate(tracks, offs)
        truth = read_sp3_all(self.truth_path)
        pred = read_sp3_all(self.pred_path)
        d_el, d_az = [], []
        for prn in tracks:
            for t, p in pred[prn].items():
                az_r, el_r = ecef_to_aer(lagrange_at(truth[prn], t), STA, THBK_LAT_DEG, THBK_LON_DEG)[:2]
                az_p, el_p = ecef_to_aer(p, STA, THBK_LAT_DEG, THBK_LON_DEG)[:2]
                if el_r < 10.0:
                    continue
                d_el.append(abs(el_p - el_r))
                if el_r < 80.0:
                    d_az.append(abs(az_diff(az_p, az_r)))
        g = res["systems"]["G"]
        self.assertAlmostEqual(g["el_p99"], _p99(d_el), places=5)
        self.assertAlmostEqual(g["az_p99"], _p99(d_az), places=5)
        self.assertEqual((g["pairs"], g["az_pairs"]), (len(d_el), len(d_az)))

    def test_system_stats_only_sp3_and_fresh(self):
        tracks = {"G01": shifted(1), "G02": shifted(-1), "G03": shifted(2)}
        offs = {"G01": (0.5, 0.0, 0.0), "G02": (0.5, 0.0, 0.0), "G03": (200.0, 0.0, 0.0)}
        res = self.validate(tracks, offs, ages={"G01": 0.5, "G02": 2.0, "G03": 3.0})
        self.assertEqual((res["systems"]["G"]["sats"], res["systems"]["G"]["pairs"]), (2, 2 * len(GRID)))
        self.assertTrue(res["systems"]["G"]["pass"])          # G03 คลาด 200 กม. แต่อายุ 3 วัน ไม่นับในระดับระบบ
        g03 = res["satellites"]["G03"]
        self.assertEqual((g03["truth"], g03["age_days"], g03["result"]), ("sp3", 3.0, "fail"))
        self.assertAlmostEqual(g03["d3_median_km"], 200.0, places=2)
        self.assertEqual(res["failing"], ["G03"])
        self.assertIs(res["pass"], True)                      # ดวงที่ไม่ผ่านถูกระบุชื่อ แต่ผ่านทั้งก้อนตามระดับระบบ

    def test_unknown_age_not_counted_in_system(self):
        tracks = {"G01": shifted(1), "G02": shifted(-1)}
        res = self.validate(tracks, {prn: (0.5, 0.0, 0.0) for prn in tracks}, ages={"G01": 0.5})
        self.assertEqual(res["systems"]["G"]["sats"], 1)
        self.assertIsNone(res["satellites"]["G02"]["age_days"])
        self.assertEqual(res["satellites"]["G02"]["result"], "pass")

    def test_brdc_fallback_and_unverified(self):
        nav = read_nav(NAV_FILE)
        # Facility ใต้ C40 ที่กลางช่วง เพื่อให้ C40 อยู่สูงตลอด 00:30–02:30 (ใน SP3 ตัวอย่างไม่มี C40)
        x, y, z = position_km(nav, "C40", datetime(2026, 11, 9, 1, 30, tzinfo=UTC))
        fac = Facility("UNDER_C40", math.degrees(math.atan2(z, math.hypot(x, y))), math.degrees(math.atan2(y, x)),
                       0.0, 10.0)
        tracks = {"E11": shifted(0)}
        write_truth(self.truth_path, tracks)
        pred = {"E11": pred_from_truth(self.truth_path, {"E11": (0.0, 0.0, 0.0)})["E11"],
                "C40": [plus(position_km(nav, "C40", t + OFFSET), (0.3, 0.0, 0.0)) for t in GRID],
                "R10": [rotz(position_km(nav, "C40", t + OFFSET), 1.0) for t in GRID],
                "C99": [position_km(nav, "C40", t + OFFSET) for t in GRID]}     # C99 ไม่มีใน SP3 และไม่มีใน nav
        res = self.validate(tracks, {}, nav=nav, fac=fac, pred=pred)
        sats = res["satellites"]
        self.assertEqual((sats["C40"]["truth"], sats["C40"]["result"]), ("brdc", "pass"))
        self.assertEqual(sats["C40"]["pairs"], len(GRID))
        self.assertAlmostEqual(sats["C40"]["d3_median_km"], 0.3, places=3)
        self.assertEqual((sats["R10"]["truth"], sats["R10"]["result"], sats["R10"]["pairs"]),
                         ("unverified", "unverified", 0))
        self.assertEqual([sats["R10"][k] for k in ("el_median", "az_p99", "d3_median_km", "d3_max_km")], [None] * 4)
        self.assertEqual((sats["C99"]["truth"], sats["C99"]["result"]), ("unverified", "unverified"))
        self.assertEqual(sats["E11"]["truth"], "sp3")
        self.assertNotIn("C", res["systems"])                 # ระดับระบบนับเฉพาะคู่ที่ค่าจริงมาจาก SP3
        self.assertNotIn("R", res["systems"])
        self.assertEqual(res["failing"], [])

    def test_no_broadcast_file_leaves_missing_satellites_unverified(self):
        tracks = {"E11": shifted(0)}
        write_truth(self.truth_path, tracks)
        pred = pred_from_truth(self.truth_path, {"E11": (0.0, 0.0, 0.0)})
        pred["C40"] = pred["E11"]
        res = self.validate(tracks, {}, nav=None, pred=pred)
        self.assertEqual(res["satellites"]["C40"]["truth"], "unverified")

    def test_glonass_with_sp3_is_verified(self):
        res = self.validate({"R05": shifted(0)}, {"R05": (0.5, 0.0, 0.0)})
        self.assertEqual((res["satellites"]["R05"]["truth"], res["satellites"]["R05"]["result"]), ("sp3", "pass"))
        self.assertIn("R", res["systems"])

    def test_insufficient_data(self):
        tracks = {"G01": shifted(1), "G02": shifted(-1)}
        write_truth(self.truth_path, tracks)
        pred = pred_from_truth(self.truth_path, {"G01": (0.5, 0.0, 0.0), "G02": (0.5, 0.0, 0.0)})
        pred["G01"] = [p if k < 19 else ZERO for k, p in enumerate(pred["G01"])]       # ศูนย์ = ไม่มีตำแหน่ง
        pred["G02"] = [p if k < 20 else ZERO for k, p in enumerate(pred["G02"])]
        res = self.validate(tracks, {}, pred=pred)
        self.assertEqual((res["satellites"]["G01"]["pairs"], res["satellites"]["G01"]["result"]),
                         (19, "insufficient_data"))
        self.assertEqual((res["satellites"]["G02"]["pairs"], res["satellites"]["G02"]["result"]), (20, "pass"))
        self.assertIsNotNone(res["satellites"]["G01"]["el_median"])      # ยังรายงานค่าที่คำนวณได้
        self.assertEqual((res["systems"]["G"]["sats"], res["systems"]["G"]["pairs"]), (2, 39))
        self.assertEqual(res["failing"], [])

    def test_failing_satellite_listed(self):
        tracks = {"G01": shifted(1), "E11": shifted(0)}
        res = self.validate(tracks, {"G01": (200.0, 0.0, 0.0), "E11": (0.5, 0.0, 0.0)})
        g01 = res["satellites"]["G01"]
        self.assertEqual(g01["result"], "fail")
        self.assertAlmostEqual(g01["d3_median_km"], 200.0, places=2)
        self.assertGreater(max(g01["el_median"], g01["az_median"]), 0.1)
        self.assertEqual(res["satellites"]["E11"]["result"], "pass")
        self.assertEqual(res["failing"], ["G01"])
        self.assertFalse(res["systems"]["G"]["pass"])
        self.assertTrue(res["systems"]["E"]["pass"])
        self.assertIs(res["pass"], False)

    def test_each_threshold_decides(self):
        # ค่ากลาง ΔEl เกินเกณฑ์อย่างเดียว: ไม่ผ่านแม้ P99 และ Az ผ่านก็ตามที่เกณฑ์ใช้ "ทั้ง 4 ข้อ"
        from gnss_predict import studio_validate
        stats = {"el_median": 0.05, "el_p99": 0.2, "az_median": 0.1, "az_p99": 0.5}
        self.assertTrue(studio_validate.within_limits(stats))
        for key in stats:
            self.assertFalse(studio_validate.within_limits({**stats, key: stats[key] + 1e-9}), key)
            self.assertFalse(studio_validate.within_limits({**stats, key: None}), key)

    def test_pairs_use_utc_day_of_each_epoch(self):
        tracks = {"E11": REAL["E11"]}
        offs = {"E11": (0.5, 0.0, 0.0)}
        res = self.validate(tracks, offs, grid=EXACT_GRID, day=DAY)
        self.assertEqual(res["satellites"]["E11"]["pairs"], 36)          # epoch แรกเป็นวันที่ 2026-11-08 (UTC)
        res = self.validate(tracks, offs, grid=EXACT_GRID, day=date(2026, 11, 8))
        self.assertEqual(res["satellites"]["E11"]["pairs"], 1)
        self.assertEqual(res["satellites"]["E11"]["result"], "insufficient_data")
        res = self.validate(tracks, offs, grid=EXACT_GRID, day=date(2026, 11, 10))
        self.assertEqual(res["satellites"]["E11"]["pairs"], 0)
        self.assertIs(res["pass"], False)

    def test_pairs_only_above_min_elevation(self):
        tracks = {"C38": REAL["C38"], "E11": REAL["E11"]}
        res = self.validate(tracks, {"C38": (0.5, 0.0, 0.0), "E11": (0.5, 0.0, 0.0)}, grid=EXACT_GRID)
        expected = sum(1 for t in sorted(REAL["C38"])[1:] if el_of(REAL["C38"][t]) >= 10.0)
        self.assertEqual(res["satellites"]["C38"]["pairs"], expected)
        self.assertTrue(0 < expected < 36)                                # C38 ตกใต้ 10° กลางช่วง
        self.assertEqual(res["satellites"]["E11"]["pairs"], 36)

    def test_azimuth_only_below_limit(self):
        res = self.validate({"E11": REAL["E11"]}, {"E11": (0.5, 0.0, 0.0)}, grid=EXACT_GRID)
        expected = sum(1 for t in sorted(REAL["E11"])[1:] if el_of(REAL["E11"][t]) < 80.0)
        self.assertTrue(0 < expected < 36)                                # E11 ผ่านเกือบเหนือศีรษะตอนต้น
        self.assertEqual(res["satellites"]["E11"]["az_pairs"], expected)
        self.assertEqual(res["systems"]["E"]["az_pairs"], expected)

    def test_reference_outside_truth_range_gives_no_pair(self):
        # epoch ที่ truth ไม่ครอบคลุม (ก่อนจุดที่ 5 ของ SP3 คือ 00:20 GPST) ไม่ถูกเทียบ
        # และดาวที่มีใน SP3 อยู่แล้วไม่ถอยไปใช้ broadcast ทีละ epoch (nav มี E11)
        grid = [datetime(2026, 11, 9, 0, 3, tzinfo=UTC) + timedelta(minutes=k) for k in range(16)]
        tracks = {"E11": shifted(0)}
        pred = {"E11": [plus(REAL["E11"][datetime(2026, 11, 9, 0, 0, tzinfo=UTC)], (0.5, 0.0, 0.0))] * len(grid)}
        res = self.validate(tracks, {}, grid=grid, pred=pred, nav=read_nav(NAV_FILE))
        self.assertEqual(res["satellites"]["E11"]["pairs"], 0)

    def test_nothing_verified_is_not_a_pass(self):
        nav = read_nav(NAV_FILE)
        write_truth(self.truth_path, {"E11": shifted(0)})
        pred = {"R10": pred_from_truth(self.truth_path, {"E11": (0.0, 0.0, 0.0)})["E11"]}
        res = self.validate({"E11": shifted(0)}, {}, nav=nav, pred=pred)
        self.assertEqual(res["systems"], {})
        self.assertIs(res["pass"], False)

    def test_flags_are_reported(self):
        res = self.validate({"G01": shifted(1)}, {"G01": (0.5, 0.0, 0.0)},
                            flags={"G01": frozenset({"stale", "prn_changed"}), "G02": frozenset({"x"})})
        self.assertEqual(res["satellites"]["G01"]["flags"], ["prn_changed", "stale"])


# ---------- run_validate ----------

SNAP = FXS / "snapshot"
SNAPSHOT_NAME = "20261110T0000Z"
SATELLITES = [("G01", 62339), ("G22", 26407), ("E11", 37846), ("R05", 43508), ("C01", 56564)]
PLAN = {"G01": (0.0, 60.0), "G22": (60.0, 70.0), "E11": (120.0, 45.0), "R05": (240.0, 30.0), "C01": (300.0, 50.0)}
SYNTH_EPOCH = datetime(2026, 11, 10, tzinfo=UTC)
SYNTH_OFFSETS: dict[str, tuple[float, float, float]] = {}      # ความคลาดที่ fake propagate ใส่ให้ดาวแต่ละ PRN (กม.)


def ecef_from_az_el(az_deg: float, el_deg: float, range_km: float = 22000.0) -> tuple[float, float, float]:
    """ตำแหน่ง ECEF (กม.) ของจุดที่ Az/El/ระยะ ที่กำหนดจาก THBK (แกน ENU ตามเส้นตั้งฉากทรงรี)"""
    az, el = math.radians(az_deg), math.radians(el_deg)
    lat, lon = math.radians(THBK_LAT_DEG), math.radians(THBK_LON_DEG)
    e, n, u = (range_km * math.cos(el) * math.sin(az), range_km * math.cos(el) * math.cos(az),
               range_km * math.sin(el))
    dx = -math.sin(lon) * e - math.sin(lat) * math.cos(lon) * n + math.cos(lat) * math.cos(lon) * u
    dy = math.cos(lon) * e - math.sin(lat) * math.sin(lon) * n + math.cos(lat) * math.sin(lon) * u
    dz = math.cos(lat) * n + math.sin(lat) * u
    return STA[0] + dx, STA[1] + dy, STA[2] + dz


def synth_position(prn: str, t_gpst: datetime):
    """วงโคจรสังเคราะห์: Az เลื่อน 0.1°/นาที ที่ El คงที่ มองจาก THBK (ฟังก์ชันของ GPST ทั้ง truth และค่าทำนาย)"""
    az0, el0 = PLAN[prn]
    minutes = (t_gpst - SYNTH_EPOCH).total_seconds() / 60.0
    return ecef_from_az_el(az0 + 0.1 * minutes, el0 + 0.01 * minutes)


def scenario_data() -> dict:
    return {
        "format": "gnss-studio-scenario/1",
        "name": "Test_Scen",
        "analysis_period": {"start": "2026-11-10T00:00:00Z", "stop": "2026-11-10T06:00:00Z"},
        "step_s": 300,
        "orbit_snapshot": SNAPSHOT_NAME,
        "ionosphere": {"shell_km": 400.0},
        "satellite_filter": {"show_too_old": False, "show_no_broadcast": True},
        "objects": [{"class": "Facility", "name": "THBK",
                     "position": {"type": "Geodetic", "lat_deg": THBK_LAT_DEG, "lon_deg": THBK_LON_DEG,
                                  "alt_m": THBK_HEIGHT_M},
                     "constraints": {"elevation_angle_min_deg": 10.0}}]
                   + [{"class": "Satellite", "name": n, "norad": norad} for n, norad in SATELLITES],
    }


def fake_propagate(sats, start, stop, step_s, work_dir, console, timeout_s=900):
    n = int((stop - start).total_seconds()) // step_s
    times = [start + timedelta(seconds=k * step_s) for k in range(n + 1)]
    return Ephemeris(times, {s.prn: [plus(synth_position(s.prn, t + OFFSET), SYNTH_OFFSETS.get(s.prn, ZERO))
                                      for t in times] for s in sats}), []


def run_main(argv) -> tuple[int, str, str]:
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = main(argv)
    return code, out.getvalue(), err.getvalue()


class RunValidateCase(unittest.TestCase):
    TRUTH_PRNS = ("G01", "G22", "E11")                  # R05 และ C01 ไม่มีใน SP3 จริง

    def setUp(self):
        root = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, root, ignore_errors=True)
        self.data = root / "data"
        shutil.copytree(SNAP, self.data / "orbits" / SNAPSHOT_NAME)
        self.sc = root / "scen"
        self.sc.mkdir()
        (self.sc / "scenario.json").write_text(json.dumps(scenario_data()), encoding="utf-8")
        SYNTH_OFFSETS.clear()
        self.addCleanup(SYNTH_OFFSETS.clear)

        # SP3 จริง (สังเคราะห์) ครอบคลุม 2026-11-09 23:00 – 2026-11-10 07:00 GPST ทุก 5 นาที
        start = datetime(2026, 11, 9, 23, tzinfo=UTC)
        times_gpst = [start + timedelta(minutes=5 * k) for k in range(97)]
        self.truth = root / "truth.sp3"
        write_sp3([t - OFFSET for t in times_gpst],
                  {prn: [synth_position(prn, t) for t in times_gpst] for prn in self.TRUTH_PRNS}, self.truth)

        patches = {name: mock.patch.object(studio, name, **kw) for name, kw in {
            "propagate": {"side_effect": fake_propagate},
            "find_gmat_console": {"return_value": Path("/fake/GmatConsole")},
            "gmat_version": {"return_value": "FakeGmat"},
            "fetch_brdc": {"side_effect": BrdcUnavailableError("offline")},
            "fetch_mgx_sp3": {"side_effect": AssertionError("ไม่คาดว่าจะดึง SP3 จากเน็ต")}}.items()}
        self.mocks = {name: p.start() for name, p in patches.items()}
        for p in patches.values():
            self.addCleanup(p.stop)

    def run_it(self, day=date(2026, 11, 10), **kw):
        return run_validate(self.sc, day, data_dir=self.data, sp3=kw.pop("sp3", self.truth), **kw)


class TestRunValidate(RunValidateCase):
    def test_outputs(self):
        SYNTH_OFFSETS["G22"] = (200.0, 0.0, 0.0)
        ephem, msgs = self.run_it()
        self.assertEqual(ephem.parent, self.sc / "ephem")
        self.assertEqual(sorted(p.name for p in ephem.iterdir()),
                         ["manifest.json", "predicted.sp3", "scene.czml", "validation_2026-11-10.json",
                          "validation_2026-11-10.md"])
        self.assertEqual([m.code for m in msgs if m.code == "BRDC_UNAVAILABLE"], ["BRDC_UNAVAILABLE"])
        self.assertEqual(next(m for m in msgs if m.code == "BRDC_UNAVAILABLE").level, "warning")
        self.mocks["fetch_brdc"].assert_called_once_with(date(2026, 11, 10), self.data / "orbits" / "_cache" / "brdc")

        doc = json.loads((ephem / "validation_2026-11-10.json").read_bytes().decode("utf-8"))
        self.assertEqual((doc["day"], doc["scenario"], doc["ephem_hash"], doc["facility"], doc["truth_file"]),
                         ("2026-11-10", "Test_Scen", ephem.name, "THBK", "truth.sp3"))
        self.assertEqual(sorted(doc["satellites"]), ["C01", "E11", "G01", "G22", "R05"])
        sats = doc["satellites"]
        self.assertEqual({p: sats[p]["truth"] for p in sats},
                         {"C01": "unverified", "E11": "sp3", "G01": "sp3", "G22": "sp3", "R05": "unverified"})
        self.assertEqual((sats["G01"]["result"], sats["G22"]["result"], sats["R05"]["result"]),
                         ("pass", "fail", "unverified"))
        self.assertEqual(sats["G01"]["pairs"], 73)
        self.assertEqual(doc["failing"], ["G22"])
        self.assertIsInstance(sats["G01"]["age_days"], float)               # อายุข้อมูลมาจาก manifest ของ ephem
        manifest = json.loads((ephem / "manifest.json").read_bytes().decode("utf-8"))
        for entry in manifest["satellites"]:
            if entry["prn"] in sats:
                self.assertEqual((sats[entry["prn"]]["age_days"], sats[entry["prn"]]["flags"]),
                                 (entry["age_days"], entry["flags"]))
        self.assertEqual([m["code"] for m in doc["messages"]], ["BRDC_UNAVAILABLE"])
        self.assertRegex(doc["created_utc"], r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$")

        md = (ephem / "validation_2026-11-10.md").read_text(encoding="utf-8")
        self.assertIn("ผลตรวจความแม่นยำ 2026-11-10", md)
        self.assertIn("ไม่ผ่าน", md)
        self.assertIn("G22", md)
        self.assertIn("truth.sp3", md)
        self.assertNotIn("\r", md)
        self.assertEqual(list(ephem.glob("*.tmp*")), [])

    def test_progress_runs_from_zero_to_one(self):
        calls = []
        self.run_it(progress=lambda stage, fraction: calls.append(fraction))
        self.assertEqual((calls[0], calls[-1]), (0.0, 1.0))
        self.assertEqual(calls, sorted(calls))

    def test_fresh_satellites_decide_systems(self):
        ephem, _ = self.run_it()
        doc = json.loads((ephem / "validation_2026-11-10.json").read_bytes())
        ages = {s["prn"]: s["age_days"] for s in json.loads((ephem / "manifest.json").read_bytes())["satellites"]}
        for letter in "GE":
            fresh = [p for p, s in doc["satellites"].items() if p[0] == letter and s["truth"] == "sp3"
                     and ages[p] <= 2.0]
            self.assertEqual(doc["systems"][letter]["sats"], len(fresh), letter)
        self.assertNotIn("R", doc["systems"])
        self.assertNotIn("C", doc["systems"])

    def test_history_appended(self):
        ephem, _ = self.run_it()
        again, _ = self.run_it()
        self.assertEqual(again, ephem)
        history = self.data / "validation" / "history.jsonl"
        lines = history.read_bytes().decode("utf-8").splitlines()
        self.assertEqual(len(lines), 2)
        rec = json.loads(lines[0])
        self.assertEqual(sorted(rec), sorted(["day", "scenario", "ephem_hash", "truth_file", "pass", "systems",
                                              "failing", "created_utc"]))
        self.assertEqual((rec["day"], rec["scenario"], rec["ephem_hash"], rec["truth_file"]),
                         ("2026-11-10", "Test_Scen", ephem.name, "truth.sp3"))
        doc = json.loads((ephem / "validation_2026-11-10.json").read_bytes())
        self.assertEqual((rec["pass"], rec["systems"], rec["failing"]), (doc["pass"], doc["systems"], doc["failing"]))
        self.assertIs(rec["pass"], True)
        self.assertEqual(json.loads(lines[1])["ephem_hash"], ephem.name)
        self.assertEqual(self.mocks["propagate"].call_count, 1)

    def test_truth_fetched_when_sp3_not_given(self):
        self.mocks["fetch_mgx_sp3"].side_effect = None
        self.mocks["fetch_mgx_sp3"].return_value = self.truth
        self.run_it(sp3=None)
        self.mocks["fetch_mgx_sp3"].assert_called_once_with(date(2026, 11, 10), self.data / "truth")
        rec = json.loads((self.data / "validation" / "history.jsonl").read_text(encoding="utf-8"))
        self.assertEqual(rec["truth_file"], "truth.sp3")

    def test_broadcast_used_for_satellites_missing_from_sp3(self):
        self.mocks["fetch_brdc"].side_effect = None
        self.mocks["fetch_brdc"].return_value = NAV_FILE
        ephem, msgs = self.run_it()
        self.assertNotIn("BRDC_UNAVAILABLE", [m.code for m in msgs])
        sats = json.loads((ephem / "validation_2026-11-10.json").read_bytes())["satellites"]
        self.assertEqual(sats["C01"]["truth"], "brdc")                      # C01 อยู่ใน nav fixture แต่ไม่อยู่ใน SP3
        self.assertGreater(sats["C01"]["pairs"], 0)
        self.assertEqual(sats["R05"]["truth"], "unverified")                # GLONASS ไม่ใช้ broadcast

    def test_unreadable_broadcast_is_a_warning(self):
        bad = self.data / "bad.rnx"
        bad.write_text("not a rinex file\n", encoding="utf-8")
        self.mocks["fetch_brdc"].side_effect = None
        self.mocks["fetch_brdc"].return_value = bad
        _, msgs = self.run_it()
        self.assertIn("BRDC_UNAVAILABLE", [m.code for m in msgs])

    def test_default_facility_is_first_and_named_one_is_found(self):
        ephem, _ = self.run_it(facility="thbk")
        self.assertEqual(json.loads((ephem / "validation_2026-11-10.json").read_bytes())["facility"], "THBK")
        with self.assertRaises(ScenarioError) as ctx:
            self.run_it(facility="NOPE")
        self.assertIn("NOPE", str(ctx.exception))

    def test_scenario_without_facility_rejected(self):
        data = scenario_data()
        data["objects"] = [o for o in data["objects"] if o["class"] != "Facility"]
        (self.sc / "scenario.json").write_text(json.dumps(data), encoding="utf-8")
        with self.assertRaises(ScenarioError):
            self.run_it()
        self.mocks["propagate"].assert_not_called()

    def test_day_outside_analysis_period_rejected_before_downloads(self):
        for day in (date(2026, 11, 9), date(2026, 11, 11)):       # ช่วงวิเคราะห์เริ่มพอดีเมื่อวันที่ 11-09 จบ
            with self.assertRaises(ScenarioError) as ctx:
                self.run_it(day=day, sp3=None)
            self.assertIn(day.isoformat(), str(ctx.exception))
        self.mocks["fetch_mgx_sp3"].assert_not_called()
        self.mocks["fetch_brdc"].assert_not_called()
        self.assertFalse((self.data / "validation").exists())

    def test_missing_sp3_file(self):
        self.mocks["propagate"].side_effect = AssertionError("ต้องตรวจ --sp3 ก่อน propagate")
        for missing in (self.data / "nope.sp3", self.data):                 # ไม่มีไฟล์ หรือเป็นโฟลเดอร์
            with self.subTest(sp3=missing):
                with self.assertRaises(Sp3UnavailableError) as ctx:
                    self.run_it(sp3=missing)
                self.assertIn(str(missing), str(ctx.exception))
        self.mocks["propagate"].assert_not_called()
        self.assertFalse((self.sc / "ephem").exists())
        self.assertFalse((self.data / "validation").exists())

    def test_truth_unavailable_propagates(self):
        self.mocks["fetch_mgx_sp3"].side_effect = Sp3UnavailableError("ยังไม่มี SP3")
        with self.assertRaises(Sp3UnavailableError):
            self.run_it(sp3=None)
        self.assertFalse((self.data / "validation").exists())


class TestValidateCli(RunValidateCase):
    def base_args(self):
        return ["validate", "--scenario", str(self.sc), "--day", "2026-11-10", "--data", str(self.data)]

    def test_cli_validate(self):
        code, out, err = run_main(self.base_args() + ["--sp3", str(self.truth), "--facility", "THBK"])
        self.assertEqual(code, 0, err)
        lines = out.splitlines()
        ephem = Path(lines[0])
        self.assertEqual(ephem.parent, (self.sc / "ephem").resolve())
        self.assertTrue((ephem / "validation_2026-11-10.json").is_file())
        self.assertTrue(any(line.startswith("warning: ") for line in lines[1:]))

    def test_cli_truth_unavailable_exit_1(self):
        self.mocks["fetch_mgx_sp3"].side_effect = Sp3UnavailableError("ยังไม่มี SP3 ของวันนั้น")
        code, out, err = run_main(self.base_args())
        self.assertEqual(code, 1)
        self.assertEqual(out, "")
        self.assertIn("TRUTH_UNAVAILABLE", err)

    def test_cli_corrupt_truth_exit_1(self):
        whole = gzip.compress(self.truth.read_bytes())
        bad = {"truncated.SP3.gz": whole[:len(whole) // 2],                                   # EOFError
               "html.SP3.gz": b"<!DOCTYPE html>\n<html><body>Earthdata Login</body></html>\n"}   # BadGzipFile
        for name, data in bad.items():
            with self.subTest(name=name):
                path = self.data / name
                path.write_bytes(data)
                code, out, err = run_main(self.base_args() + ["--sp3", str(path)])
                self.assertEqual((code, out), (1, ""))
                self.assertTrue(err.startswith("error: TRUTH_UNREADABLE: "), err)
                self.assertIn(name, err)
                self.assertNotIn("Traceback", err)
        self.assertFalse((self.data / "validation").exists())

    def test_cli_argument_errors_exit_2(self):
        scen = ["--scenario", str(self.sc)]
        self.assertEqual(run_main(["validate"] + scen)[0], 2)                                  # ไม่มี --day
        for bad in ("2026-13-01", "20261110", "yesterday"):
            code, _, err = run_main(["validate"] + scen + ["--day", bad])
            self.assertEqual(code, 2, bad)
            self.assertIn("YYYY-MM-DD", err)


if __name__ == "__main__":
    unittest.main()
