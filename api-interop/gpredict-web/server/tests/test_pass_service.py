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
from gpredict_web.pass_predict import NEXT_PASS_OFFSET
from gpredict_web.pass_service import PassPlan, PassService, day_range
from gpredict_web.prefs import Prefs
from gpredict_web.runtime import Hub, ModuleClosedError
from gpredict_web.satdb import SatDb, SatRecord
from gpredict_web.store import Store
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
        records = pass_records()
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
        self.hub.close("M")
        with self.assertRaises(ModuleClosedError):
            rt.sat_orbit(NORADS[0])

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


if __name__ == "__main__":
    unittest.main()
