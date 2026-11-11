"""Runtime ของ module และ tick (Task 10): EphemManager จริงกับ propagate ปลอมที่ให้วงโคจรวงกลมสังเคราะห์ของ helpers
(ระนาบศูนย์สูตร ผ่านเหนือ QTH ที่ (0°, 0°) ทุกรอบ จึงมีคำตอบ AOS/LOS แบบปิด) ใช้ start_worker=False แล้ว drain()"""

import json
import threading
import time
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

from gpredict_web import runtime
from gpredict_web.clock import ModuleClock
from gpredict_web.ephem import EphemManager, window_for
from gpredict_web.errors import ApiError
from gpredict_web.module import module_from_dict
from gpredict_web.observe import is_decayed, parse_tle
from gpredict_web.runtime import Hub, ModuleClosedError, ModuleRuntime
from gpredict_web.satdb import SatDb, SatRecord
from gpredict_web.store import Qth, Store
from gnss_predict.astro import subpoint, sun_ecef_km
from gnss_predict.errors import GmatRunError, Message
from gnss_predict.geometry import ecef_to_aer
from gnss_predict.propagate import Ephemeris
from tests.helpers import FakeNow, PERIOD_S, circular_state, half_pass_s, origin_qth, temp_config

UTC = timezone.utc
T0 = datetime(2026, 11, 12, 7, 20, tzinfo=UTC)                  # ช่วงเดินหน้าคือ 05:00–21:00
W0 = (datetime(2026, 11, 12, 5, tzinfo=UTC), datetime(2026, 11, 12, 21, tzinfo=UTC))
PEAK_REF = T0 + timedelta(seconds=37)
NORADS = (25544, 43017, 7530)
MEAN_MOTION = 86400.0 / PERIOD_S                                 # รอบต่อวันของวงกลมสังเคราะห์
ISO_MS = r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$"
TICK_KEYS = ["t", "clock", "status", "qth", "sun", "window", "sats", "messages"]
SAT_KEYS = ["norad", "name", "az", "el", "dir", "ra", "dec", "range_km", "range_rate_kms", "lat_deg", "lon_deg",
            "ssp", "footprint_km", "alt_km", "vel_kms", "doppler_hz", "loss_db", "delay_ms", "ma", "phase_deg",
            "orbit", "vis", "next_aos", "next_los", "always"]
COMPUTING = {"code": "EPHEM_COMPUTING", "level": "info", "text": "กำลังคำนวณวงโคจรด้วย GMAT…", "object": None}
ORIGIN = Qth(name="ORIGIN", location="Gulf of Guinea", lat_deg=0.0, lon_deg=0.0, alt_m=0.0)
OTHER = Qth(name="OTHER", location="Somewhere", lat_deg=10.0, lon_deg=20.0, alt_m=100.0)


def iso(t: datetime) -> str:
    return t.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def parse_iso(text: str) -> datetime:
    return datetime.fromisoformat(text.replace("Z", "+00:00"))


def tle(norad: int, epoch: datetime, ndot2: float = 0.0) -> tuple[str, str]:
    """TLE ตามคอลัมน์มาตรฐานของวงกลมสังเคราะห์ (mean motion ตรงกับ PERIOD_S) checksum ไม่ถูกต้อง (parse_tle ไม่ตรวจ)"""
    doy = 1.0 + (epoch - datetime(epoch.year, 1, 1, tzinfo=UTC)).total_seconds() / 86400.0
    ndot = (" " if ndot2 >= 0 else "-") + f"{abs(ndot2):.8f}"[1:]
    l1 = f"1 {norad:05d}U 26001A   {epoch.year % 100:02d}{doy:012.8f} {ndot}  00000-0  00000-0 0  9990"
    l2 = f"2 {norad:05d}   0.0000   0.0000 0000000   0.0000   0.0000 {MEAN_MOTION:11.8f} 10000"
    assert len(l1) == len(l2) == 69
    return l1, l2


def record(norad: int, epoch: datetime = T0 - timedelta(days=1), ndot2: float = 0.0) -> SatRecord:
    return SatRecord(norad, f"SAT-{norad}", ["amateur"], tle(norad, epoch, ndot2), epoch, epoch)


def started(fn, *args) -> threading.Thread:
    th = threading.Thread(target=fn, args=args, daemon=True)
    th.start()
    return th


def peak(norad: int) -> datetime:
    """เวลาที่ดาวดวงนี้อยู่เหนือ QTH พอดี (El 90°) ที่ใกล้ T0"""
    return PEAK_REF + timedelta(seconds=60 * (norad % 97))


class OrbitPropagate:
    """propagate ปลอม: ทุกดวงเป็นวงกลมสังเคราะห์ในระนาบศูนย์สูตร (helpers.circular_state) ที่ผ่านเหนือ QTH เมื่อ peak(norad) + k·PERIOD_S
    drop = NORAD ที่ GMAT "ไม่คืนค่า", unbound = NORAD ที่ได้ความเร็ว ×3 (วงโคจรไม่ปิด), fail = exception ที่ GMAT โยน"""

    def __init__(self):
        self.calls: list[dict] = []
        self.drop: set[int] = set()
        self.unbound: set[int] = set()
        self.fail: Exception | None = None

    def __call__(self, sats, start, stop, step_s, work_dir, console, timeout_s=900,
                 on_gmat_start=None, with_velocity=False):
        self.calls.append({"window": (start, stop), "norads": [s.norad for s in sats],
                           "tle": {s.norad: s.tle_lines for s in sats}})
        if self.fail is not None:
            raise self.fail
        n = int((stop - start).total_seconds()) // step_s + 1
        times = [start + timedelta(seconds=k * step_s) for k in range(n)]
        pos, vel, msgs = {}, {}, []
        for s in sats:
            if s.norad in self.drop:
                msgs.append(Message("SAT_MISSING_FROM_GMAT", "warning", f"GMAT ตัดดาว {s.prn} ออก", s.prn))
                continue
            k = 3.0 if s.norad in self.unbound else 1.0
            states = [circular_state(peak(s.norad), 0.0, t) for t in times]
            pos[s.prn] = [p for p, _ in states]
            vel[s.prn] = [(k * v[0], k * v[1], k * v[2]) for _, v in states]
        return Ephemeris(times, pos, vel), msgs


class RuntimeTestBase(unittest.TestCase):
    def setUp(self):
        self.cfg = temp_config(self)
        self.fake = OrbitPropagate()
        self.ephem = EphemManager(self.cfg, propagate_fn=self.fake, find_console=lambda: Path("/fake/GmatConsole"),
                                  start_worker=False)
        self.addCleanup(self.ephem.close)
        self.wall = FakeNow(T0)

    def module(self, records, selected=None, qth="ORIGIN"):
        return module_from_dict({"name": "M", "qth": qth, "satellites": [r.norad for r in records],
                                 "single": {"selected": selected}}, None, None)

    def runtime(self, records=None, selected=None, qth=ORIGIN) -> ModuleRuntime:
        records = [record(n) for n in NORADS] if records is None else records
        return ModuleRuntime(self.module(records, selected), qth, records, self.ephem, ModuleClock(self.wall))

    def tick_until_window(self, rt, window, limit=20) -> dict:
        """tick จนช่วงใน tick เป็น window (ช่วงถัดไปสลับเมื่อ pass ของทุกดวงพร้อม ซึ่งอาจใช้หลาย tick)"""
        want = {"start": iso(window[0]), "stop": iso(window[1])}
        for _ in range(limit):
            tick = rt.tick()
            if tick["window"] == want:
                return tick
        self.fail(f"ช่วงไม่สลับเป็น {want} ภายใน {limit} tick (ล่าสุด {tick['window']})")

    def codes(self, tick) -> list[tuple[str, str | None]]:
        return [(m["code"], m["object"]) for m in tick["messages"]]


class TickTest(RuntimeTestBase):
    def test_tick_shape_matches_spec(self):
        old = record(NORADS[2], epoch=T0 - timedelta(days=8))           # ให้มี message อย่างน้อยหนึ่งข้อ
        rt = self.runtime([record(NORADS[0]), record(NORADS[1]), old], selected=NORADS[0])
        self.ephem.drain()
        tick = rt.tick()
        json.dumps(tick, allow_nan=False, ensure_ascii=False)          # ส่งเป็น JSON ได้ทั้งก้อน

        self.assertEqual(list(tick), TICK_KEYS)
        self.assertRegex(tick["t"], ISO_MS)
        self.assertEqual(tick["t"], "2026-11-12T07:20:00.000Z")
        self.assertEqual(tick["clock"], {"state": "forward", "throttle": 1, "label": "Real-Time"})
        self.assertEqual(tick["status"], "ok")
        self.assertEqual(tick["qth"], {"name": "ORIGIN", "location": "Gulf of Guinea",
                                       "lat_deg": 0.0, "lon_deg": 0.0, "alt_m": 0.0})
        lat, lon = subpoint(sun_ecef_km(T0))
        self.assertEqual(tick["sun"], {"lat_deg": lat, "lon_deg": lon})
        self.assertEqual(tick["window"], {"start": "2026-11-12T05:00:00.000Z", "stop": "2026-11-12T21:00:00.000Z"})

        self.assertEqual([s["norad"] for s in tick["sats"]], list(NORADS))
        q = origin_qth()
        half = timedelta(seconds=half_pass_s(0.0))
        for s in tick["sats"]:
            self.assertEqual(list(s), SAT_KEYS)
            self.assertEqual(s["name"], f"SAT-{s['norad']}")
            for key in ("az", "el", "ra", "dec", "range_km", "range_rate_kms", "lat_deg", "lon_deg", "footprint_km",
                        "alt_km", "vel_kms", "doppler_hz", "loss_db", "delay_ms", "ma", "phase_deg"):
                self.assertIsInstance(s[key], float, key)
            self.assertIsInstance(s["orbit"], int)
            self.assertIn(s["dir"], ("↑", "↓", "↺", "↷", "G", "D"))
            self.assertRegex(s["ssp"], r"^[A-R]{2}[0-9]{2}[a-x]{2}$")
            self.assertIn(s["vis"], ("V", "D", "E"))
            self.assertIn(s["always"], ("in", "out", None))
            # ค่าจากวงกลมสังเคราะห์ตรงกับคำตอบแบบปิด
            az, el, rng = ecef_to_aer(circular_state(peak(s["norad"]), 0.0, T0)[0], q.ecef_km, 0.0, 0.0)
            self.assertAlmostEqual(s["el"], el, places=6)
            self.assertAlmostEqual(s["range_km"], rng, places=5)
            peaks = [peak(s["norad"]) + timedelta(seconds=k * PERIOD_S) for k in range(-3, 4)]
            next_aos = min(p - half for p in peaks if p - half > T0)
            inside = [p for p in peaks if p - half <= T0 <= p + half]
            next_los = (inside[0] if inside else next_aos + half) + half
            self.assertRegex(s["next_aos"], ISO_MS)
            self.assertRegex(s["next_los"], ISO_MS)
            self.assertLessEqual(abs((parse_iso(s["next_aos"]) - next_aos).total_seconds()), 0.2)
            self.assertLessEqual(abs((parse_iso(s["next_los"]) - next_los).total_seconds()), 0.2)
            self.assertIsNone(s["always"])

        self.assertTrue(tick["messages"])
        for m in tick["messages"]:
            self.assertEqual(list(m), ["code", "level", "text", "object"])

    def test_status_computing_then_ok(self):
        rt = self.runtime()
        tick = rt.tick()
        self.assertEqual(tick["status"], "computing")
        self.assertNotIn("sats", tick)
        self.assertEqual(list(tick), [k for k in TICK_KEYS if k != "sats"])
        self.assertIn(COMPUTING, tick["messages"])
        self.assertEqual(tick["window"], {"start": iso(W0[0]), "stop": iso(W0[1])})

        self.ephem.drain()
        self.assertEqual([c["window"] for c in self.fake.calls], [W0])
        self.wall.advance(0.3)
        tick = rt.tick()
        self.assertEqual(tick["status"], "ok")
        self.assertEqual([s["norad"] for s in tick["sats"]], list(NORADS))
        self.assertNotIn("EPHEM_COMPUTING", [m["code"] for m in tick["messages"]])

    def test_clock_jump_triggers_recompute(self):
        """เครื่อง sleep แล้วตื่น: เวลา real-time กระโดดออกนอกช่วง -> computing (ไม่ใช่ค่าเก่าหรือ exception) -> drain -> ok"""
        rt = self.runtime()
        self.ephem.drain()
        self.assertEqual(rt.tick()["status"], "ok")
        self.wall.advance(4 * 3600)                                     # ใช้งานปกติไป 4 ชม. (11:20 ยังไม่ต้องสั่งช่วงถัดไป)
        self.assertEqual(rt.tick()["status"], "ok")
        self.ephem.drain()
        self.assertEqual(len(self.fake.calls), 1)

        self.wall.advance(10 * 3600)                                    # sleep 10 ชม. -> 21:20 พ้นช่วง 05:00–21:00
        w1 = window_for(self.wall(), +1)
        self.assertEqual(w1, (datetime(2026, 11, 12, 19, tzinfo=UTC), datetime(2026, 11, 13, 11, tzinfo=UTC)))
        with mock.patch.object(self.ephem, "release", wraps=self.ephem.release) as release:
            tick = rt.tick()
        self.assertEqual(tick["status"], "computing")
        self.assertNotIn("sats", tick)
        self.assertIn(COMPUTING, tick["messages"])
        self.assertEqual(tick["t"], "2026-11-12T21:20:00.000Z")
        self.assertEqual(tick["window"], {"start": iso(w1[0]), "stop": iso(w1[1])})
        release.assert_called_with("M")                                # ปล่อยทั้งช่วงเก่าและช่วงที่สั่งล่วงหน้า

        self.ephem.drain()
        self.assertEqual(self.fake.calls[-1]["window"], w1)
        self.wall.advance(0.3)
        tick = rt.tick()
        self.assertEqual(tick["status"], "ok")
        self.assertEqual([s["norad"] for s in tick["sats"]], list(NORADS))

    def test_clock_jump_drops_stale_prefetch(self):
        """ช่วงที่สั่งล่วงหน้าแล้วยังไม่ได้รัน ถูกตัดออกจากคิวเมื่อเวลากระโดด งานของช่วงใหม่จึงไม่ต้องรอ GMAT ราว 40 วินาทีที่ไม่มีใครใช้"""
        rt = self.runtime()
        self.ephem.drain()
        rt.tick()
        self.wall.t = datetime(2026, 11, 12, 18, 30, tzinfo=UTC)        # เหลือไม่ถึง 3 ชม.: สั่งช่วง 16:00–08:00
        self.assertEqual(rt.tick()["status"], "ok")
        self.wall.advance(3 * 86400)                                    # ตั้งเวลาไปอีก 3 วัน
        self.assertEqual(rt.tick()["status"], "computing")
        self.ephem.drain()
        self.assertEqual([c["window"] for c in self.fake.calls], [W0, window_for(self.wall(), +1)])
        self.assertEqual(rt.tick()["status"], "ok")

    def test_tick_omits_missing_sat_without_error(self):
        """ดาวที่เลือกใน Single sat แต่ GMAT ไม่คืนค่า: ไม่อยู่ใน sats, มี SAT_MISSING_FROM_GMAT, module ยังทำงาน"""
        selected = NORADS[1]
        self.fake.drop = {selected}
        rt = self.runtime(selected=selected)
        self.ephem.drain()
        for _ in range(3):
            tick = rt.tick()
            self.assertEqual(tick["status"], "ok")
            self.assertEqual([s["norad"] for s in tick["sats"]], [NORADS[0], NORADS[2]])
            missing = [m for m in tick["messages"] if m["code"] == "SAT_MISSING_FROM_GMAT"]
            self.assertEqual(len(missing), 1)
            self.assertEqual((missing[0]["level"], missing[0]["object"]), ("warning", str(selected)))
            self.wall.advance(0.3)
        self.assertEqual(rt.module.single["selected"], selected)

    def test_tle_old_warning(self):
        old = record(NORADS[0], epoch=T0 - timedelta(days=7, minutes=1))
        fresh = record(NORADS[1], epoch=T0 - timedelta(days=7) + timedelta(minutes=1))
        rt = self.runtime([old, fresh, record(NORADS[2])])
        tick = rt.tick()                                                # เตือนตั้งแต่ระหว่างคำนวณ (มาจาก TLE ไม่ใช่ GMAT)
        self.assertIn(("TLE_OLD", str(NORADS[0])), self.codes(tick))
        self.ephem.drain()
        tick = rt.tick()
        old_msgs = [m for m in tick["messages"] if m["code"] == "TLE_OLD"]
        self.assertEqual([(m["level"], m["object"]) for m in old_msgs], [("warning", str(NORADS[0]))])
        self.assertTrue(old_msgs[0]["text"])
        self.assertIn(NORADS[0], [s["norad"] for s in tick["sats"]])    # ยังติดตามได้

    def test_decayed_sat_not_sent(self):
        decayed = record(NORADS[1], epoch=T0 - timedelta(days=200), ndot2=0.001)
        self.assertTrue(is_decayed(parse_tle(decayed.tle_lines), T0))
        rt = self.runtime([record(NORADS[0]), decayed, record(NORADS[2])])
        self.ephem.drain()
        tick = rt.tick()
        self.assertEqual(tick["status"], "ok")
        self.assertEqual([s["norad"] for s in tick["sats"]], [NORADS[0], NORADS[2]])
        self.assertNotIn(str(NORADS[1]), [m["object"] for m in tick["messages"]])
        self.assertEqual(rt.track(NORADS[1]), [])
        self.assertIsNone(rt.skytrack(NORADS[1]))

    def test_unbound_orbit_drops_only_that_sat(self):
        self.fake.unbound = {NORADS[2]}
        rt = self.runtime()
        self.ephem.drain()
        tick = rt.tick()
        self.assertEqual(tick["status"], "ok")
        self.assertEqual([s["norad"] for s in tick["sats"]], [NORADS[0], NORADS[1]])
        bad = [m for m in tick["messages"] if m["object"] == str(NORADS[2])]
        self.assertEqual([(m["code"], m["level"]) for m in bad], [("SAT_STATE_INVALID", "warning")])

    def test_gmat_failure_then_retry(self):
        self.fake.fail = GmatRunError("GMAT ล้ม")
        rt = self.runtime()
        self.ephem.drain()
        tick = rt.tick()
        self.assertEqual(tick["status"], "failed")
        self.assertNotIn("sats", tick)
        self.assertIn("GMAT_FAILED", [m["code"] for m in tick["messages"]])
        self.assertNotIn("EPHEM_COMPUTING", [m["code"] for m in tick["messages"]])
        self.ephem.drain()
        self.assertEqual(len(self.fake.calls), 1)                       # ไม่ลองใหม่เอง
        self.fake.fail = None
        rt.retry()
        self.assertEqual(rt.tick()["status"], "computing")
        self.ephem.drain()
        self.assertEqual(rt.tick()["status"], "ok")

    def test_passes_computed_once_per_window(self):
        with mock.patch.object(runtime, "find_passes", wraps=runtime.find_passes) as find_passes:
            rt = self.runtime()
            self.ephem.drain()
            for _ in range(5):
                self.assertEqual(rt.tick()["status"], "ok")
                self.wall.advance(0.3)
            rt.track(NORADS[0])
            rt.skytrack(NORADS[0])
        self.assertEqual(find_passes.call_count, len(NORADS))

    def test_dir_uses_previous_tick_range_rate(self):
        """Dir ระหว่าง ±0.001 กม./วินาที (ที่ El สูงสุด) เทียบ range rate ของ tick ก่อน: tick แรกไม่มีค่าก่อน -> '↷'"""
        n = NORADS[0]
        self.wall.t = peak(n) - timedelta(seconds=0.001)
        rt = self.runtime()
        self.ephem.drain()
        first = {s["norad"]: s for s in rt.tick()["sats"]}[n]
        self.assertLess(abs(first["range_rate_kms"]), 0.001)
        self.assertEqual(first["dir"], "↷")
        self.wall.advance(0.002)                                        # range rate เพิ่มขึ้น (ผ่านจุดใกล้สุดแล้ว) -> ↷
        second = {s["norad"]: s for s in rt.tick()["sats"]}[n]
        self.assertGreater(second["range_rate_kms"], first["range_rate_kms"])
        self.assertEqual(second["dir"], "↷")
        rt.clock.set(state="backward")                                  # ถอยกลับ: range rate ลดลง -> ↺
        self.wall.advance(0.003)
        third = {s["norad"]: s for s in rt.tick()["sats"]}[n]
        self.assertLess(third["range_rate_kms"], second["range_rate_kms"])
        self.assertEqual(third["dir"], "↺")

    def test_tick_after_close_raises(self):
        rt = self.runtime()
        rt.close()
        self.assertTrue(rt.closed)
        with self.assertRaises(ModuleClosedError):
            rt.tick()
        self.ephem.drain()
        self.assertEqual(self.fake.calls, [])                           # ปิดก่อนรัน: งานถูกตัดออกจากคิว และ tick ไม่สั่งใหม่


class WindowTest(RuntimeTestBase):
    def test_next_window_requested_near_end(self):
        rt = self.runtime()
        self.ephem.drain()
        self.assertEqual(rt.tick()["status"], "ok")
        self.wall.t = datetime(2026, 11, 12, 18, 0, tzinfo=UTC)         # เหลือ 3 ชม. พอดี: ยังไม่ต้องสั่ง
        self.assertEqual(rt.tick()["status"], "ok")
        self.ephem.drain()
        self.assertEqual(len(self.fake.calls), 1)

        self.wall.t = datetime(2026, 11, 12, 18, 30, tzinfo=UTC)        # เหลือ 2.5 ชม.: สั่งช่วงถัดไปจาก T
        w1 = (datetime(2026, 11, 12, 16, tzinfo=UTC), datetime(2026, 11, 13, 8, tzinfo=UTC))
        tick = rt.tick()
        self.assertEqual(tick["status"], "ok")                          # ใช้ช่วงเดิมจนกว่าช่วงใหม่จะเสร็จ
        self.assertEqual(tick["window"], {"start": iso(W0[0]), "stop": iso(W0[1])})
        self.assertEqual([s["norad"] for s in tick["sats"]], list(NORADS))
        self.wall.advance(0.3)
        self.assertEqual(rt.tick()["window"]["start"], iso(W0[0]))      # สั่งครั้งเดียว ช่วงยังไม่สลับ

        self.ephem.drain()
        self.assertEqual([c["window"] for c in self.fake.calls], [W0, w1])
        with mock.patch.object(self.ephem, "release", wraps=self.ephem.release) as release:
            tick = self.tick_until_window(rt, w1)
        self.assertEqual(tick["status"], "ok")
        self.assertEqual([s["norad"] for s in tick["sats"]], list(NORADS))
        release.assert_called_once_with("M", W0)
        self.wall.advance(3600)                                         # ช่วงใหม่ยังเหลือเกิน 3 ชม.: ไม่สั่งอีก
        rt.tick()
        self.ephem.drain()
        self.assertEqual(len(self.fake.calls), 2)

    def test_window_runs_out_while_prefetch_pending_keeps_its_job(self):
        rt = self.runtime()
        self.ephem.drain()
        rt.tick()
        self.wall.t = datetime(2026, 11, 12, 18, 30, tzinfo=UTC)
        rt.tick()                                                       # สั่งช่วง 16:00–08:00 แต่ยังไม่รัน
        self.wall.t = datetime(2026, 11, 12, 21, 0, tzinfo=UTC)         # ช่วงเดิมใช้ไม่ได้แล้ว
        w1 = (datetime(2026, 11, 12, 16, tzinfo=UTC), datetime(2026, 11, 13, 8, tzinfo=UTC))
        tick = rt.tick()
        self.assertEqual(tick["status"], "computing")
        self.assertEqual(tick["window"], {"start": iso(w1[0]), "stop": iso(w1[1])})
        self.ephem.drain()
        self.assertEqual([c["window"] for c in self.fake.calls], [W0, w1])   # งานเดิมของช่วงถัดไป ไม่สั่งใหม่
        self.assertEqual(rt.tick()["status"], "ok")

    def test_failed_prefetch_gets_a_fresh_window_when_current_runs_out(self):
        rt = self.runtime()
        self.ephem.drain()
        rt.tick()
        self.fake.fail = GmatRunError("GMAT ล้ม")
        self.wall.t = datetime(2026, 11, 12, 18, 30, tzinfo=UTC)
        rt.tick()
        self.ephem.drain()                                              # ช่วงถัดไปล้มเหลว: ยังใช้ช่วงเดิมได้
        tick = rt.tick()
        self.assertEqual((tick["status"], tick["window"]["start"]), ("ok", iso(W0[0])))
        self.fake.fail = None
        self.wall.t = datetime(2026, 11, 12, 21, 0, tzinfo=UTC)         # เวลาย้ายไปช่วงอื่น: คำนวณใหม่ (ไม่ค้างที่ failed)
        tick = rt.tick()
        self.assertEqual(tick["status"], "computing")
        self.ephem.drain()
        self.assertEqual(rt.tick()["status"], "ok")

    def test_backward_clock_prefetches_backward_window(self):
        rt = self.runtime()
        self.ephem.drain()
        rt.clock.set(state="backward")
        tick = rt.tick()                                                # 07:20 ห่างต้นช่วง 05:00 ไม่ถึง 3 ชม.
        self.assertEqual((tick["status"], tick["window"]["start"]), ("ok", iso(W0[0])))
        self.ephem.drain()
        self.assertEqual(self.fake.calls[-1]["window"], window_for(T0, -1))
        tick = self.tick_until_window(rt, window_for(T0, -1))
        self.assertEqual(tick["status"], "ok")


class TleChangeTest(RuntimeTestBase):
    def test_tle_change_keeps_old_values_until_new_is_ready(self):
        records = [record(n) for n in NORADS]
        rt = self.runtime(records)
        self.ephem.drain()
        self.assertEqual(rt.tick()["status"], "ok")

        newer = record(NORADS[0], epoch=T0 - timedelta(hours=2))
        rt.update(self.module(records), ORIGIN, [newer, *records[1:]])
        tick = rt.tick()
        self.assertEqual(tick["status"], "ok")                          # ค่าเก่าระหว่างรอค่าใหม่ (spec หัวข้อ 5.3)
        self.assertEqual([s["norad"] for s in tick["sats"]], list(NORADS))
        self.ephem.drain()
        self.assertEqual(self.fake.calls[-1]["norads"], [NORADS[0]])
        self.assertEqual(self.fake.calls[-1]["tle"][NORADS[0]], newer.tle_lines)
        tick = rt.tick()
        self.assertEqual(tick["status"], "ok")
        self.assertEqual([s["norad"] for s in tick["sats"]], list(NORADS))

    def test_added_satellite_is_computing_until_ready(self):
        records = [record(n) for n in NORADS[:2]]
        rt = self.runtime(records)
        self.ephem.drain()
        self.assertEqual(rt.tick()["status"], "ok")
        records.append(record(NORADS[2]))
        rt.update(self.module(records), ORIGIN, records)
        self.assertEqual(rt.tick()["status"], "computing")
        self.ephem.drain()
        self.assertEqual(self.fake.calls[-1]["norads"], [NORADS[2]])
        tick = rt.tick()
        self.assertEqual([s["norad"] for s in tick["sats"]], list(NORADS))


class TrackTest(RuntimeTestBase):
    def test_track_and_skytrack(self):
        n = NORADS[0]
        rt = self.runtime()
        self.assertEqual(rt.track(n), [])                               # ยังคำนวณอยู่
        self.assertIsNone(rt.skytrack(n))
        self.ephem.drain()

        lines = rt.track(n)
        self.assertGreaterEqual(len(lines), 2)                          # 3 รอบในระนาบศูนย์สูตรข้ามเส้น 180°
        for line in lines:
            for point in line:
                self.assertEqual(len(point), 2)
                self.assertAlmostEqual(point[0], 0.0, places=6)
        json.dumps(lines, allow_nan=False)

        self.wall.t = peak(n) + timedelta(seconds=PERIOD_S / 2)         # อีกฝั่งของโลก
        self.assertIsNone(rt.skytrack(n))
        self.wall.t = peak(n)
        sky = rt.skytrack(n)
        self.assertIsNotNone(sky)
        self.assertEqual(list(sky[0]), ["t", "az", "el"])
        self.assertRegex(sky[0]["t"], ISO_MS)
        half = half_pass_s(0.0)
        self.assertLessEqual(abs((parse_iso(sky[0]["t"]) - peak(n)).total_seconds() + half), 0.2)
        self.assertLessEqual(abs((parse_iso(sky[-1]["t"]) - peak(n)).total_seconds() - half), 0.2)
        q = origin_qth()
        for p in sky:                                                   # ทุกจุดตรงกับวงกลมสังเคราะห์ที่เวลาของจุด
            az, el, _ = ecef_to_aer(circular_state(peak(n), 0.0, parse_iso(p["t"]))[0], q.ecef_km, 0.0, 0.0)
            self.assertAlmostEqual(p["el"], el, delta=0.01)             # t ในคำตอบปัดเป็นมิลลิวินาที
            if el < 80.0:                                               # Az ใกล้จุดยอดเปลี่ยนเร็ว
                self.assertAlmostEqual(p["az"], az, delta=0.01)
        self.assertGreater(len(sky), 2 * half / 10.0)
        json.dumps(sky, allow_nan=False)

    def test_unknown_norad_is_not_found(self):
        rt = self.runtime()
        self.ephem.drain()
        for call in (rt.track, rt.skytrack):
            with self.assertRaises(ApiError) as ctx:
                call(99999)
            self.assertEqual((ctx.exception.code, ctx.exception.status), ("NOT_FOUND", 404))


class HubTest(unittest.TestCase):
    def setUp(self):
        self.cfg = temp_config(self)
        self.fake = OrbitPropagate()
        self.ephem = EphemManager(self.cfg, propagate_fn=self.fake, find_console=lambda: Path("/fake/GmatConsole"),
                                  start_worker=False)
        self.addCleanup(self.ephem.close)
        self.wall = FakeNow(T0)
        self.store = Store(self.cfg.data_dir)
        self.store.put_qth(ORIGIN)
        self.store.put_qth(OTHER)
        self.store.set_default_qth("ORIGIN")
        self.satdb = self.write_satdb([record(n) for n in NORADS])

    def write_satdb(self, records) -> SatDb:
        path = self.cfg.data_dir / "satdb.json"
        path.write_text(json.dumps({"version": 1, "satellites": {
            str(r.norad): {"name": r.name, "groups": r.groups, "tle": list(r.tle_lines),
                           "epoch": iso(r.epoch), "updated": iso(r.updated)} for r in records}}), encoding="utf-8")
        return SatDb(path)

    def put_module(self, name="M", qth=None, sats=NORADS, **extra):
        self.store.put_module(module_from_dict({"name": name, "qth": qth, "satellites": list(sats), **extra}, None, None))

    def hub(self, satdb=None) -> Hub:
        return Hub(self.store, self.satdb if satdb is None else satdb, self.ephem, self.wall)

    def test_open_get_close(self):
        self.put_module()
        hub = self.hub()
        self.assertIsNone(hub.get("M"))
        rt = hub.open("M")
        self.assertIs(hub.open("M"), rt)                                # หลายแท็บใช้ runtime เดียวกัน
        self.assertIs(hub.get("M"), rt)
        self.assertEqual(hub.open_names(), ["M"])
        self.assertEqual(rt.tick()["qth"]["name"], "ORIGIN")            # qth None = สถานีตั้งต้น
        hub.close("M")
        self.assertIsNone(hub.get("M"))
        self.assertEqual(hub.open_names(), [])
        self.assertTrue(rt.closed)
        self.ephem.drain()
        self.assertEqual(self.fake.calls, [])                           # ปิดแล้วงานที่รออยู่ถูกตัด
        hub.close("M")                                                  # ปิดซ้ำไม่เป็นไร

    def test_open_names_in_open_order(self):
        self.put_module("B")
        self.put_module("A")
        hub = self.hub()
        hub.open("B")
        hub.open("A")
        self.assertEqual(hub.open_names(), ["B", "A"])

    def test_open_unknown_module_is_not_found(self):
        with self.assertRaises(ApiError) as ctx:
            self.hub().open("Nope")
        self.assertEqual(ctx.exception.code, "NOT_FOUND")

    def test_default_qth_missing_is_qth_invalid(self):
        self.put_module()
        (self.cfg.data_dir / "settings.json").unlink()
        self.assertIsNone(self.store.default_qth())
        hub = self.hub()
        with self.assertRaises(ApiError) as ctx:
            hub.open("M")
        self.assertEqual((ctx.exception.code, ctx.exception.status), ("QTH_INVALID", 422))
        self.assertTrue(ctx.exception.text)
        self.assertIsNone(hub.get("M"))

    def test_satellite_missing_from_satdb_is_skipped(self):
        self.put_module(sats=[*NORADS, 11111])
        rt = self.hub().open("M")
        self.ephem.drain()
        tick = rt.tick()
        self.assertEqual(tick["status"], "ok")
        self.assertEqual([s["norad"] for s in tick["sats"]], list(NORADS))

    def test_reload_applies_module_and_keeps_clock(self):
        self.put_module()
        hub = self.hub()
        rt = hub.open("M")
        self.ephem.drain()
        rt.clock.set(state="stop")
        clock = rt.clock
        self.put_module(qth="OTHER", sats=NORADS[:2])
        hub.reload("M")
        self.assertIs(hub.get("M"), rt)
        self.assertIs(rt.clock, clock)
        self.assertEqual(rt.clock.state, "stop")
        self.assertEqual(rt.module.qth, "OTHER")
        tick = rt.tick()
        self.assertEqual(tick["clock"]["label"], "Manual Control")
        self.assertEqual(tick["qth"]["name"], "OTHER")
        self.assertEqual([s["norad"] for s in tick["sats"]], list(NORADS[:2]))
        hub.reload("NotOpen")                                           # ไม่ได้เปิดอยู่: ไม่ทำอะไร

    def test_reload_after_tle_update_keeps_old_values_until_new_ready(self):
        self.put_module()
        records = {n: record(n) for n in NORADS}
        hub = self.hub(satdb=records)                                   # Hub ใช้แค่ satdb.get(norad)
        rt = hub.open("M")
        self.ephem.drain()
        self.assertEqual(rt.tick()["status"], "ok")
        records[NORADS[1]] = record(NORADS[1], epoch=T0 - timedelta(hours=1))
        hub.reload("M")
        tick = rt.tick()
        self.assertEqual(tick["status"], "ok")
        self.assertEqual([s["norad"] for s in tick["sats"]], list(NORADS))
        self.ephem.drain()
        self.assertEqual(self.fake.calls[-1]["tle"], {NORADS[1]: records[NORADS[1]].tle_lines})

    def test_concurrent_open_close_and_tick(self):
        self.put_module()
        hub = self.hub()
        errors: list[BaseException] = []

        def worker():
            try:
                for _ in range(30):
                    rt = hub.open("M")
                    try:
                        rt.tick()
                    except ModuleClosedError:
                        pass
                    hub.reload("M")
                    hub.open_names()
                    hub.close("M")
            except BaseException as exc:                               # noqa: BLE001 รายงานใน thread หลัก
                errors.append(exc)

        threads = [threading.Thread(target=worker) for _ in range(4)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(errors, [])
        self.assertEqual(hub.open_names(), [])
        self.assertEqual(hub._name_locks, {})                           # lock ประจำชื่อไม่ค้าง (ไม่โตไม่จำกัด)
        self.ephem.drain()
        self.assertEqual(self.fake.calls, [])                           # ทุก runtime ปิดแล้ว ไม่เหลืองานในคิว
        rt = hub.open("M")                                              # เปิดใหม่หลังวุ่นวาย: ช่วงคำนวณไม่ถูกตัวเก่าลบ
        self.ephem.drain()
        self.assertEqual(rt.tick()["status"], "ok")

    def test_slow_module_does_not_block_other_modules(self):
        """tick แรกของ A หา pass นาน (ถือ lock ของ A ราว 3 วินาทีที่ 200 ดวง) close/reload ของ A รอได้
        แต่ get/open/open_names/reload/close ของ module อื่นต้องไม่รอ"""
        for name in ("A", "B", "C"):
            self.put_module(name)
        hub = self.hub()
        a = hub.open("A")
        hub.open("B")
        self.ephem.drain()
        entered, gate = threading.Event(), threading.Event()
        real = runtime.find_passes

        def slow_find_passes(eph, q):
            entered.set()
            gate.wait(10)
            return real(eph, q)

        blocked: list[threading.Thread] = []
        with mock.patch.object(runtime, "find_passes", slow_find_passes):
            ticker = started(a.tick)
            try:
                self.assertTrue(entered.wait(5))
                blocked += [started(hub.close, "A"), started(hub.reload, "A")]
                time.sleep(0.2)                                         # ให้ close/reload ของ A ไปรอ tick ของ A ก่อน
                for label, fn, args in (("get", hub.get, ("B",)), ("open_names", hub.open_names, ()),
                                        ("open", hub.open, ("C",)), ("reload", hub.reload, ("B",)),
                                        ("close", hub.close, ("B",))):
                    th = started(fn, *args)
                    th.join(2.0)
                    self.assertFalse(th.is_alive(), f"hub.{label} ของ module อื่นรอ tick ของ A")
                self.assertTrue(blocked[0].is_alive())                  # close ของ A ยังรอ tick ของ A อยู่จริง
            finally:
                gate.set()
                ticker.join(10)
        for th in blocked:
            th.join(10)
        self.assertTrue(a.closed)
        self.assertEqual(hub.open_names(), ["C"])

    def test_reopen_while_closing_gets_a_working_runtime(self):
        """open ระหว่างที่ close ของชื่อเดียวกันยังรอ tick: owner ใน EphemManager คือชื่อ module
        runtime ใหม่ต้องเริ่มหลังตัวเก่าปล่อยช่วงแล้ว ไม่งั้น release ของตัวเก่าลบช่วง (และงาน GMAT) ของตัวใหม่ทิ้ง"""
        self.put_module()
        hub = self.hub()
        old = hub.open("M")                                             # ยังไม่ drain: งาน GMAT ของช่วงรออยู่ในคิว
        opened: list[ModuleRuntime] = []
        old._lock.acquire()                                             # จำลอง tick ที่ยาว (ถือ lock ของ runtime)
        try:
            closer = started(hub.close, "M")
            time.sleep(0.1)
            opener = started(lambda: opened.append(hub.open("M")))
            time.sleep(0.1)
        finally:
            old._lock.release()
        closer.join(10)
        opener.join(10)
        self.assertEqual(len(opened), 1)
        new = opened[0]
        self.assertIsNot(new, old)
        self.assertTrue(old.closed)
        self.assertIs(hub.get("M"), new)
        self.ephem.drain()
        self.assertEqual(new.tick()["status"], "ok")

    def test_reload_during_open_is_not_lost(self):
        """PUT module + reload ระหว่างที่อีก thread กำลังเปิด module เดียวกัน: reload ต้องรอแล้วใช้ค่าใหม่ ไม่ใช่หลุดไปเพราะยังไม่เปิด"""
        self.put_module()
        hub = self.hub()
        real_load = hub._load
        entered, gate = threading.Event(), threading.Event()

        def slow_load(name):
            result = real_load(name)
            if not entered.is_set():                                    # ครั้งแรก (ของ open) อ่านค่าเก่าแล้วรอ
                entered.set()
                gate.wait(10)
            return result

        with mock.patch.object(hub, "_load", slow_load):
            opener = started(hub.open, "M")
            try:
                self.assertTrue(entered.wait(5))
                self.put_module(qth="OTHER")
                reloader = started(hub.reload, "M")
                time.sleep(0.1)
            finally:
                gate.set()
            opener.join(10)
            reloader.join(10)
        self.assertEqual(hub.get("M").module.qth, "OTHER")


if __name__ == "__main__":
    unittest.main()
