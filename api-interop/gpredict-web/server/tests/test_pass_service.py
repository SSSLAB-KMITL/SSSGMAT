"""PassService (Task 5) โดยไม่ผ่าน HTTP: Hub และ EphemManager จริงกับ propagate ปลอม (start_worker=False แล้ว drain())
ดาวสังเคราะห์ของ test_runtime (วงกลมในระนาบศูนย์สูตร ผ่านเหนือ ORIGIN ที่ peak(norad) + k·PERIOD_S)
PassPropagate และ pass_records ใช้ร่วมกับ PassesApiTest ใน test_api.py"""

import dataclasses
import json
import math
import threading
import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

from gpredict_web.ephem import EphemManager
from gpredict_web.errors import ApiError
from gpredict_web.module import module_from_dict
from gpredict_web.observe import parse_tle
from gpredict_web.pass_predict import NEXT_PASS_OFFSET, PASS_GAP
from gpredict_web.pass_service import PassPlan, PassService, day_range, name_sort_key
from gpredict_web.prefs import Prefs
from gpredict_web.runtime import Hub, ModuleClosedError, iso_ms
from gpredict_web.satdb import SatDb, SatRecord
from gpredict_web.store import Store
from gnss_predict.errors import GmatRunError
from tests.helpers import PERIOD_S, FakeNow, circular_state, half_pass_s, temp_config
from tests.test_runtime import NORADS, ORIGIN, T0, OrbitPropagate, iso, parse_iso, peak, record

UTC = timezone.utc
GEO = 40001                       # TLE เป็น GEO: has_aos เป็นเท็จ
HIDDEN = 40002                    # TLE ขึ้นได้ แต่ GMAT (ปลอม) ให้วงที่ไม่เคยขึ้นเหนือขอบฟ้าของ ORIGIN
WOBBLE = 40003                    # Max El ของแต่ละ pass ต่างกัน (ราว 5°–90°)
GEO_MEAN_MOTION = 1.0027


def wobble_beta(t: datetime) -> float:
    """β ของ WOBBLE แกว่ง 0°–20° ด้วยคาบ 3.3 รอบโคจร pass ที่ติดกันจึงสูงต่างกัน (β = 10° ได้ Max El ราว 23°)"""
    phase = 2.0 * math.pi * (t - peak(WOBBLE)).total_seconds() / (3.3 * PERIOD_S)
    return 10.0 + 10.0 * math.sin(phase)


BETA = {HIDDEN: lambda t: 60.0, WOBBLE: wobble_beta}


def is_day_job(call: dict) -> bool:
    start, stop = call["window"]
    return stop - start >= timedelta(days=1)


class PassPropagate(OrbitPropagate):
    """OrbitPropagate ที่ β ของวงกลมต่างกันต่อดวงตาม BETA (ดวงอื่น β = 0)
    gate: ถ้าไม่ใช่ None งาน block รายวัน (ช่วง ≥ 1 วัน) set started แล้วรอ gate (สูงสุด 10 วินาที) ก่อนคำนวณ"""

    def __init__(self):
        super().__init__()
        self.gate: threading.Event | None = None
        self.started = threading.Event()

    def __call__(self, sats, start, stop, step_s, work_dir, console, timeout_s=900,
                 on_gmat_start=None, with_velocity=False):
        if self.gate is not None and stop - start >= timedelta(days=1):
            self.started.set()
            self.gate.wait(10)
        eph, msgs = super().__call__(sats, start, stop, step_s, work_dir, console, timeout_s, on_gmat_start,
                                     with_velocity)
        for s in sats:
            beta = BETA.get(s.norad)
            if beta is not None and s.prn in eph.positions_km:
                states = [circular_state(peak(s.norad), beta(t), t) for t in eph.times_utc]
                eph.positions_km[s.prn] = [p for p, _ in states]
                eph.velocities_kms[s.prn] = [v for _, v in states]
        return eph, msgs


def geo_record(norad: int) -> SatRecord:
    """record ของ test_runtime ที่ mean motion เป็น GEO (คอลัมน์ 53–63 ของบรรทัด 2)"""
    r = record(norad)
    line2 = r.tle_lines[1]
    line2 = line2[:52] + f"{GEO_MEAN_MOTION:11.8f}" + line2[63:]
    return dataclasses.replace(r, tle_lines=(r.tle_lines[0], line2))


def pass_records() -> list[SatRecord]:
    return [*(record(n) for n in NORADS), geo_record(GEO), record(HIDDEN), record(WOBBLE)]


def write_satdb(path: Path, records) -> SatDb:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"version": 1, "satellites": {
        str(r.norad): {"name": r.name, "groups": r.groups, "tle": list(r.tle_lines),
                       "epoch": iso(r.epoch), "updated": iso(r.updated)} for r in records}}), encoding="utf-8")
    return SatDb(path)


def secs(a: datetime, b: datetime) -> float:
    return (a - b).total_seconds()


class PassServiceTestBase(unittest.TestCase):
    """module M (สถานีตั้งต้น ORIGIN) ที่มีดาวทุกดวงของ pass_records เปิดอยู่ใน Hub"""

    def satdb_records(self) -> list[SatRecord]:
        return pass_records()

    def setUp(self):
        self.cfg = temp_config(self)
        self.fake = PassPropagate()
        self.ephem = EphemManager(self.cfg, propagate_fn=self.fake, find_console=lambda: Path("/fake/GmatConsole"),
                                  start_worker=False)
        self.addCleanup(self.ephem.close)
        self.wall = FakeNow(T0)
        store = Store(self.cfg.data_dir)
        store.put_qth(ORIGIN)
        store.set_default_qth("ORIGIN")
        records = self.satdb_records()
        satdb = write_satdb(self.cfg.data_dir / "satdb.json", records)
        store.put_module(module_from_dict({"name": "M", "qth": None, "satellites": [r.norad for r in records]},
                                          None, None))
        self.prefs = Prefs(self.cfg.data_dir)
        self.hub = Hub(store, satdb, self.ephem, self.wall, prefs=self.prefs)
        self.hub.open("M")
        self.addCleanup(self.hub.close, "M")
        self.service = PassService(self.hub, self.ephem, self.prefs, self.wall)

    @staticmethod
    def body(kind: str, t: datetime, norad: int = NORADS[0], aos: datetime | None = None) -> dict:
        out = {"norad": norad, "kind": kind, "t": iso(t)}
        if aos is not None:
            out["aos"] = iso(aos)
        return out

    def plan(self, *args, **kw) -> PassPlan:
        plan = self.service.plan("M", self.body(*args, **kw))
        self.assertIsInstance(plan, PassPlan)
        return plan

    def answer(self, plan: PassPlan) -> dict:
        """ทำแบบ route: ensure_days → drain → days_status ok → answer แล้วปล่อย owner"""
        owner = "pass:test"
        self.ephem.ensure_days(owner, [plan.spec], plan.first, plan.last)
        try:
            self.ephem.drain()
            status, messages = self.ephem.days_status(owner)
            self.assertEqual(status, "ok")
            return self.service.answer(plan, messages)
        finally:
            self.ephem.release_days(owner)

    def sky_ok(self, t=T0) -> dict:
        self.service.sky("M", t)                                          # สั่ง GMAT (ครั้งแรก: computing)
        self.ephem.drain()
        out = self.service.sky("M", t)
        self.assertEqual(out["status"], "ok")
        return out


class DayRangeTest(unittest.TestCase):
    def test_day_range(self):
        start = datetime(2026, 11, 12, 5, 0, tzinfo=UTC)
        self.assertEqual(day_range(start, start + timedelta(days=4)), (date(2026, 11, 11), date(2026, 11, 16)))

    def test_day_range_uses_utc_days(self):
        start = datetime(2026, 11, 12, 1, 0, tzinfo=timezone(timedelta(hours=7)))        # 2026-11-11 18:00Z
        self.assertEqual(day_range(start, start), (date(2026, 11, 10), date(2026, 11, 11)))


class PlanTest(PassServiceTestBase):
    def test_runtime_qth_and_sat_orbit(self):
        rt = self.hub.get("M")
        self.assertEqual(rt.qth, ORIGIN)
        name, spec, elements = rt.sat_orbit(NORADS[0])
        r = record(NORADS[0])
        self.assertEqual((name, spec.norad, spec.tle_lines), (r.name, r.norad, r.tle_lines))
        self.assertEqual(elements, parse_tle(r.tle_lines))
        self.assertIsNone(rt.sat_orbit(11111))
        orbits = rt.sat_orbits()                                               # ตามลำดับใน module พร้อม NORAD
        self.assertEqual([o[0] for o in orbits], [r.norad for r in pass_records()])
        self.assertEqual(orbits[0], (r.norad, r.name, spec, elements))
        self.hub.close("M")
        with self.assertRaises(ModuleClosedError):
            rt.sat_orbit(NORADS[0])
        with self.assertRaises(ModuleClosedError):
            rt.sat_orbits()

    def test_plan_fields(self):
        plan = self.plan("next", T0)
        r = record(NORADS[0])
        self.assertEqual((plan.module, plan.norad, plan.name, plan.kind, plan.t, plan.aos),
                         ("M", r.norad, r.name, "next", T0, None))
        self.assertEqual((plan.spec.norad, plan.spec.tle_lines), (r.norad, r.tle_lines))
        self.assertEqual(plan.elements, parse_tle(r.tle_lines))
        self.assertEqual(plan.qth, ORIGIN)

    def test_plan_ranges_per_kind(self):
        # T0 = 2026-11-12 07:20Z, Passes should occur within 3 วัน: date(t − 1 วัน)..date(t + 3 + 1 วัน)
        for kind in ("future", "next", "current"):
            with self.subTest(kind=kind):
                plan = self.plan(kind, T0)
                self.assertEqual((plan.first, plan.last), (date(2026, 11, 11), date(2026, 11, 16)))
        self.prefs.update({"PREDICT/LOOK_AHEAD": 5}, [])
        self.assertEqual(self.plan("future", T0).last, date(2026, 11, 18))
        aos = datetime(2026, 11, 13, 23, 30, tzinfo=UTC)
        plan = self.plan("at", T0, aos=aos)
        self.assertEqual((plan.aos, plan.first, plan.last), (aos, date(2026, 11, 12), date(2026, 11, 14)))

    def test_use_real_t0_replaces_t(self):
        self.wall.t = T0 + timedelta(days=2, hours=20)                     # 2026-11-15 03:20Z
        self.assertEqual(self.plan("future", T0).t, T0)
        self.prefs.update({"PREDICT/USE_REAL_T0": True}, [])
        for kind in ("future", "next", "current"):
            with self.subTest(kind=kind):
                plan = self.plan(kind, T0)
                self.assertEqual(plan.t, self.wall.t)
                self.assertEqual((plan.first, plan.last), (date(2026, 11, 14), date(2026, 11, 19)))

    def test_no_aos_is_answered_without_gmat(self):
        long = ("Satellite SAT-40001 has no passes for\nthe current ground station!\n\n"
                "This can be because the satellite\nis geostationary, decayed or simply\nnever comes above the horizon")
        short = "Satellite SAT-40001 has no passes for\nthe current ground station!"
        for kind, text in (("next", long), ("current", long), ("future", short)):
            with self.subTest(kind=kind):
                out = self.service.plan("M", self.body(kind, T0, GEO))
                self.assertEqual(out["message"], {"code": "PASS_NO_AOS", "level": "error", "text": text})
                self.assertEqual(out["sat"], {"norad": GEO, "name": "SAT-40001"})
        with self.assertRaises(ApiError) as cm:
            self.service.plan("M", self.body("at", T0, GEO, aos=T0))
        self.assertEqual((cm.exception.status, cm.exception.code), (404, "NOT_FOUND"))
        self.ephem.drain()
        self.assertFalse([c for c in self.fake.calls if is_day_job(c)])

    def test_unknown_satellite_and_module(self):
        with self.assertRaises(ApiError) as cm:
            self.service.plan("M", self.body("next", T0, 11111))
        self.assertEqual((cm.exception.status, cm.exception.code, cm.exception.object), (404, "NOT_FOUND", "11111"))
        with self.assertRaises(ModuleClosedError):
            self.service.plan("Nope", self.body("next", T0))


class AnswerTest(PassServiceTestBase):
    def test_next_when_up_starts_after_los(self):
        n = NORADS[0]
        t = peak(n) + timedelta(seconds=60)                                    # ดาวอยู่เหนือขอบฟ้า
        p = self.answer(self.plan("next", t, n))["pass"]
        los_now = peak(n) + timedelta(seconds=half_pass_s())
        aos = parse_iso(p["aos"])
        self.assertGreater(aos, los_now + NEXT_PASS_OFFSET)
        self.assertAlmostEqual(secs(aos, peak(n) + timedelta(seconds=PERIOD_S - half_pass_s())), 0.0, delta=1.0)

    def test_next_when_down_starts_at_t(self):
        n = NORADS[0]
        p = self.answer(self.plan("next", peak(n) - timedelta(minutes=30), n))["pass"]
        self.assertAlmostEqual(secs(parse_iso(p["aos"]), peak(n) - timedelta(seconds=half_pass_s())), 0.0, delta=1.0)

    def test_next_with_real_t0_returns_pass_in_progress(self):
        # ref-P §1.3: เปิด USE_REAL_T0 แล้ว Show next pass ขณะดาวอยู่เหนือขอบฟ้าได้ pass ที่กำลังผ่าน
        n = NORADS[0]
        self.prefs.update({"PREDICT/USE_REAL_T0": True}, [])
        self.wall.t = peak(n) + timedelta(seconds=60)
        p = self.answer(self.plan("next", T0, n))["pass"]
        self.assertLess(parse_iso(p["aos"]), self.wall.t)
        self.assertGreater(parse_iso(p["los"]), self.wall.t)

    def test_current_returns_pass_in_progress(self):
        n = NORADS[0]
        t = peak(n) + timedelta(seconds=60)
        out = self.answer(self.plan("current", t, n))
        self.assertEqual(list(out), ["sat", "qth", "pass"])
        p = out["pass"]
        self.assertLess(parse_iso(p["aos"]), t)
        self.assertGreater(parse_iso(p["los"]), t)

    def test_answer_uses_single_pass_prefs(self):
        n = NORADS[0]
        plan = self.plan("next", T0, n)
        self.assertEqual(len(self.answer(plan)["pass"]["rows"]), 21)                # Number of entries 20 → 21 แถว
        self.prefs.update({"PREDICT/NUMBER_OF_ENTRIES": 10}, [])
        self.assertEqual(len(self.answer(plan)["pass"]["rows"]), 11)

    def test_lost_block_answers_gmat_failed(self):
        # days_status เป็น ok แต่ block หาย (เขียนลงดิสก์ไม่ได้และหลุดจาก LRU) → 503 GMAT_FAILED
        plan = self.plan("next", T0)
        with mock.patch.object(self.ephem, "get_days", return_value=None), self.assertRaises(ApiError) as cm:
            self.answer(plan)
        self.assertEqual((cm.exception.status, cm.exception.code, cm.exception.object),
                         (503, "GMAT_FAILED", str(NORADS[0])))
        self.assertRegex(cm.exception.text, r"[ก-๙]")


class NameSortKeyTest(unittest.TestCase):
    """name_sort_key ต้องเรียงเหมือน compareNames ของ web (Intl.Collator("en", {numeric: true, sensitivity: "base"}))
    ลำดับที่คาดคือผลของ collator ตัวนั้นจริง (ตรวจด้วย node ตอนเขียน test)"""

    @staticmethod
    def ordered(names: list[str]) -> list[str]:
        return sorted(names, key=name_sort_key)                        # sort เสถียร: ชื่อที่เท่ากันคงลำดับเดิม

    def test_ignores_case(self):
        self.assertEqual(name_sort_key("iss"), name_sort_key("ISS"))
        self.assertEqual(self.ordered(["Zeta", "alpha", "Beta", "ALPHA"]), ["alpha", "ALPHA", "Beta", "Zeta"])

    def test_numbers_compare_by_value(self):
        self.assertEqual(self.ordered(["NOAA 19", "NOAA 5", "noaa 18", "NOAA 100"]),
                         ["NOAA 5", "noaa 18", "NOAA 19", "NOAA 100"])
        self.assertEqual(self.ordered(["a10", "a2", "a1", "a01"]), ["a1", "a01", "a2", "a10"])
        self.assertEqual(name_sort_key("a007"), name_sort_key("a7"))                  # เลข 0 นำหน้าไม่มีผล

    def test_punctuation_before_digits_before_letters(self):
        self.assertEqual(self.ordered(["Z1", "Z-1", "Z 1", "Z_1", "Z.1", "Z(1)", "Z", "Z A"]),
                         ["Z", "Z 1", "Z A", "Z_1", "Z-1", "Z.1", "Z(1)", "Z1"])
        self.assertEqual(self.ordered(["B", "9", "A", "10", "A 1", "A-1"]), ["9", "10", "A", "A 1", "A-1", "B"])

    def test_prefix_comes_first_and_empty_is_first(self):
        self.assertEqual(self.ordered(["COSMOS 2251 DEB", "COSMOS 2251 [DEB]", "COSMOS 2251", ""]),
                         ["", "COSMOS 2251", "COSMOS 2251 [DEB]", "COSMOS 2251 DEB"])

    def test_accents_do_not_matter(self):
        self.assertEqual(name_sort_key("é"), name_sort_key("e"))
        self.assertEqual(self.ordered(["f", "é", "E", "e"]), ["é", "E", "e", "f"])

    def test_ties_keep_input_order(self):
        names = ["ISS", "iss", "Iss"]
        self.assertEqual(self.ordered(names), names)
        self.assertEqual(self.ordered(list(reversed(names))), list(reversed(names)))

    def test_starlink_like_names(self):
        self.assertEqual(self.ordered(["STARLINK-1007", "Starlink-1007", "STARLINK-123"]),
                         ["STARLINK-123", "STARLINK-1007", "Starlink-1007"])


SKY_NAMES = ["B", "A", "NOAA 19", "NOAA 5", "noaa 18", "ISS", "iss", "Zeta", "10", "9", "A 1", "A-1"]
SKY_ORDER = ["9", "10", "A", "A 1", "A-1", "B", "ISS", "iss", "NOAA 5", "noaa 18", "NOAA 19", "Zeta"]
SKY_KEYS = ["status", "t0", "hours", "sats", "messages"]
SKY_PASS_KEYS = ["orbit", "aos", "tca", "los", "max_el", "aos_az", "max_el_az", "los_az", "vis"]       # ไม่มี rows
T_LATE = datetime(2026, 11, 12, 20, 0, tzinfo=UTC)


def analytic_aos(norad: int, t0: datetime, hours: int, count: int = 10) -> list[datetime]:
    """AOS ของ pass ที่ get_passes(t0, hours/24, count) ต้องได้จากวงกลมสังเคราะห์ (ผ่านเหนือที่ peak + k·PERIOD_S)
    เริ่มที่ pass แรกที่ LOS อยู่หลัง t0 แล้วเอาต่อไปจนถึง pass แรกที่ LOS + PASS_GAP ไม่ก่อนสิ้นช่วง หรือครบ count"""
    half = timedelta(seconds=half_pass_s())
    k = math.floor((t0 - peak(norad)).total_seconds() / PERIOD_S)
    found = []
    while True:
        pk = peak(norad) + timedelta(seconds=k * PERIOD_S)
        k += 1
        if pk + half <= t0:
            continue
        found.append(pk - half)
        if len(found) == count or pk + half + PASS_GAP >= t0 + timedelta(hours=hours):
            return found


class SkySortTest(PassServiceTestBase):
    """module M มีดาว 12 ดวงชื่อ SKY_NAMES (NORAD 50001–50012 ตามลำดับใน module)"""

    def satdb_records(self) -> list[SatRecord]:
        return [dataclasses.replace(record(50001 + i), name=name) for i, name in enumerate(SKY_NAMES)]

    def test_sky_rows_sorted_by_name_and_colour_index(self):
        self.prefs.update({"SKY_AT_GLANCE/COLOUR_03": "#123456"}, [])
        out = self.sky_ok()
        self.assertEqual([s["name"] for s in out["sats"]], SKY_ORDER)
        self.assertEqual([s["norad"] for s in out["sats"]][6:8], [50006, 50007])                # ISS และ iss เท่ากัน: เรียงตาม NORAD
        colours = [self.prefs.get(f"SKY_AT_GLANCE/COLOUR_{(k % 10) + 1:02d}") for k in range(12)]
        self.assertEqual([s["colour"] for s in out["sats"]], colours)
        self.assertEqual((colours[0], colours[2], colours[10], colours[11]), ("#3c46c8", "#123456", "#3c46c8", "#00500a"))
        self.assertTrue(all(s["passes"] for s in out["sats"]))


class SkyTest(PassServiceTestBase):
    """PassService.sky (ไม่รอ GMAT): ครั้งแรกตอบ computing แล้ว drain() ค่อยตอบ ok"""

    def test_sky_computing_then_ok(self):
        first = self.service.sky("M", T0)
        self.assertEqual(list(first), SKY_KEYS)
        self.assertEqual((first["status"], first["t0"], first["hours"], first["sats"]), ("computing", iso_ms(T0), 8, []))
        self.assertEqual([m["code"] for m in first["messages"]], ["EPHEM_COMPUTING"])
        self.ephem.drain()
        out = self.service.sky("M", T0)
        self.assertEqual(list(out), SKY_KEYS)
        self.assertEqual((out["status"], out["t0"], out["hours"], out["messages"]), ("ok", iso_ms(T0), 8, []))
        by_norad = {s["norad"]: s for s in out["sats"]}
        self.assertEqual(set(by_norad), {r.norad for r in pass_records()})
        for s in out["sats"]:
            self.assertEqual(list(s), ["norad", "name", "colour", "passes"])
        self.assertEqual(by_norad[GEO]["passes"], [])                         # has_aos เป็นเท็จ
        self.assertEqual(by_norad[HIDDEN]["passes"], [])                      # TLE ขึ้นได้ แต่ GMAT ให้วงที่ไม่เคยขึ้น
        passes = by_norad[NORADS[0]]["passes"]
        self.assertGreater(len(passes), 3)
        for p in passes:
            self.assertEqual(list(p), SKY_PASS_KEYS)
            self.assertLess(p["aos"], p["tca"])
            self.assertLess(p["tca"], p["los"])

    def test_sky_colour_counts_satellites_without_passes(self):
        out = self.sky_ok()
        # SAT-7530, SAT-25544, SAT-40001 (GEO), SAT-40002 (ไม่เคยขึ้น), SAT-40003, SAT-43017: เลขในชื่อเรียงตามค่า
        self.assertEqual([s["name"] for s in out["sats"]],
                         ["SAT-7530", "SAT-25544", "SAT-40001", "SAT-40002", "SAT-40003", "SAT-43017"])
        self.assertEqual([bool(s["passes"]) for s in out["sats"]], [True, True, False, False, True, True])
        self.assertEqual([s["colour"] for s in out["sats"]],
                         [self.prefs.get(f"SKY_AT_GLANCE/COLOUR_{k:02d}") for k in range(1, 7)])

    def test_sky_uses_hours_pref_and_ten_passes(self):
        n = NORADS[0]
        self.prefs.update({"SKY_AT_GLANCE/TIME_SPAN_HOURS": 8}, [])
        out = self.sky_ok()
        passes = {s["norad"]: s["passes"] for s in out["sats"]}[n]
        self.assertEqual(out["hours"], 8)
        want = analytic_aos(n, T0, 8)
        self.assertEqual(len(passes), len(want))
        for p, aos in zip(passes, want):
            self.assertAlmostEqual(secs(parse_iso(p["aos"]), aos), 0.0, delta=1.0)
        limit = T0 + timedelta(hours=8)
        self.assertTrue(all(parse_iso(p["aos"]) <= limit for p in passes[:-1]))
        self.assertLessEqual(parse_iso(passes[-1]["aos"]), limit + timedelta(hours=8))         # เกินได้ 1 pass ตาม get_passes
        self.prefs.update({"SKY_AT_GLANCE/TIME_SPAN_HOURS": 24}, [])
        out = self.sky_ok()
        passes = {s["norad"]: s["passes"] for s in out["sats"]}[n]
        self.assertEqual((out["hours"], len(passes)), (24, 10))                      # วันละราว 15 pass แต่ไม่เกิน 10
        for p, aos in zip(passes, analytic_aos(n, T0, 24)):
            self.assertAlmostEqual(secs(parse_iso(p["aos"]), aos), 0.0, delta=1.0)

    def test_sky_applies_minimum_elevation(self):
        wobble = lambda out: {s["norad"]: s["passes"] for s in out["sats"]}[WOBBLE]
        low = wobble(self.sky_ok())
        self.assertTrue(any(p["max_el"] < 40.0 for p in low))
        self.prefs.update({"PREDICT/MINIMUM_ELEV": 40}, [])
        high = wobble(self.sky_ok())
        self.assertTrue(high)
        self.assertTrue(all(p["max_el"] >= 40.0 for p in high))

    def test_sky_range_is_twice_span(self):
        with mock.patch.object(self.ephem, "ensure_days", wraps=self.ephem.ensure_days) as ensure:
            self.service.sky("M", T0)
            self.service.sky("M", T_LATE)
            self.prefs.update({"SKY_AT_GLANCE/TIME_SPAN_HOURS": 21}, [])
            self.service.sky("M", T0)
        self.assertEqual(ensure.call_count, 3)
        ranges = []
        for call in ensure.call_args_list:
            owner, specs, first, last = call.args
            self.assertEqual(owner, "sky:M")
            self.assertEqual({sp.norad for sp in specs}, {r.norad for r in pass_records()} - {GEO})   # GEO ไม่ขึ้น: ไม่สั่ง GMAT
            ranges.append((first, last))
        self.assertEqual(ranges, [(date(2026, 11, 11), date(2026, 11, 12)),        # T0 + 16 ชม. = 11-12 23:20
                                  (date(2026, 11, 11), date(2026, 11, 13)),        # 20:00 + 16 ชม. = 11-13 12:00
                                  (date(2026, 11, 11), date(2026, 11, 14))])       # T0 + 42 ชม. = 11-14 01:20

    def test_sky_t0_rules(self):
        self.hub.get("M").clock.set(state="stop", time=T0 + timedelta(hours=3))
        self.wall.t = T0 + timedelta(hours=5)
        self.assertEqual(self.service.sky("M", None)["t0"], iso_ms(T0 + timedelta(hours=3)))      # ไม่ส่ง t: เวลาของ module
        self.assertEqual(self.service.sky("M", T0 + timedelta(hours=1))["t0"], iso_ms(T0 + timedelta(hours=1)))
        self.prefs.update({"PREDICT/USE_REAL_T0": True}, [])
        self.assertEqual(self.service.sky("M", T0 + timedelta(hours=1))["t0"], iso_ms(self.wall.t))   # ref-P §7.1 ครั้งแรก
        self.assertEqual(self.service.sky("M", None)["t0"], iso_ms(T0 + timedelta(hours=3)))          # ref-P §7.7 วาดใหม่

    def test_sky_no_satellites(self):
        # ดัชนีดาวไม่เคยลบดาว แต่ module ที่ดาวทั้งหมดไม่อยู่ในดัชนีมีรายการดาวว่างได้
        Store(self.cfg.data_dir).put_module(module_from_dict({"name": "E", "qth": None, "satellites": [99999]}, None, None))
        self.hub.open("E")
        self.addCleanup(self.hub.close, "E")
        out = self.service.sky("E", T0)
        self.assertEqual((out["status"], out["hours"], out["sats"], out["messages"]), ("ok", 8, [], []))
        self.ephem.drain()
        self.assertFalse([c for c in self.fake.calls if is_day_job(c)])
        self.assertNotIn("sky:E", self.ephem._day_pairs)

    def test_sky_module_not_open(self):
        with self.assertRaises(ModuleClosedError):
            self.service.sky("Nope", T0)

    def test_sky_dropped_satellite_has_no_passes_and_a_message(self):
        n = NORADS[1]
        self.fake.drop = {n}
        out = self.sky_ok()
        sat = {s["norad"]: s for s in out["sats"]}[n]
        self.assertEqual(sat["passes"], [])
        self.assertEqual([(m["code"], m["object"]) for m in out["messages"]], [("SAT_MISSING_FROM_GMAT", str(n))])
        self.assertTrue(all(s["passes"] for s in out["sats"] if s["norad"] in (NORADS[0], NORADS[2], WOBBLE)))

    def test_sky_lost_block_has_no_passes_and_a_message(self):
        self.sky_ok()
        real = self.ephem.get_days
        n = NORADS[0]
        with mock.patch.object(self.ephem, "get_days",
                               side_effect=lambda spec, *a: None if spec.norad == n else real(spec, *a)):
            out = self.service.sky("M", T0)
        self.assertEqual(out["status"], "ok")
        self.assertEqual({s["norad"]: s["passes"] for s in out["sats"]}[n], [])
        self.assertEqual([(m["code"], m["level"], m["object"]) for m in out["messages"]], [("GMAT_FAILED", "warning", str(n))])
        self.assertRegex(out["messages"][0]["text"], r"[ก-๙]")

    def test_sky_unbound_orbit_skips_only_that_satellite(self):
        n = NORADS[1]
        self.fake.unbound = {n}
        out = self.sky_ok()
        self.assertEqual({s["norad"]: s["passes"] for s in out["sats"]}[n], [])
        self.assertEqual([(m["code"], m["object"]) for m in out["messages"]], [("SAT_STATE_INVALID", str(n))])
        self.assertTrue({s["norad"]: s["passes"] for s in out["sats"]}[NORADS[0]])

    def test_sky_failed_status(self):
        self.fake.fail = GmatRunError("GMAT จบด้วย exit code 3")
        self.service.sky("M", T0)
        self.ephem.drain()
        out = self.service.sky("M", T0)
        self.assertEqual((out["status"], out["sats"]), ("failed", []))
        self.assertEqual([(m["code"], m["level"]) for m in out["messages"]], [("GMAT_FAILED", "error")])

    def test_sky_keeps_one_owner_per_module(self):
        self.service.sky("M", T0)
        self.service.sky("M", T0 + timedelta(hours=1))
        self.assertEqual([o for o in self.ephem._day_pairs if o.startswith("sky:")], ["sky:M"])

    def test_close_module_releases_sky_owner(self):
        self.service.sky("M", T0)
        self.assertIn("sky:M", self.ephem._day_pairs)
        self.hub.close("M")
        self.assertNotIn("sky:M", self.ephem._day_pairs)
        self.hub.close("M")                                                          # ปิดซ้ำไม่เป็นไร


if __name__ == "__main__":
    unittest.main()
