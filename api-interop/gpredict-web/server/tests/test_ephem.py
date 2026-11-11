import os
import signal
import sys
import threading
import time
import unittest
from array import array
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

from gpredict_web.ephem import EphemManager, SatEphem, SatSpec, needs_next, tle_key, usable, window_for
from gpredict_web.satdb import gmat_name
from gnss_predict.errors import GmatNotFoundError, GmatRunError, Message
from gnss_predict.propagate import Ephemeris
from tests.helpers import temp_config

UTC = timezone.utc
STEP = 30
N_EPOCHS = 16 * 3600 // STEP + 1                     # 1921 epoch ต่อช่วง 16 ชม.


def T(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def spec(norad: int, rev: int = 0) -> SatSpec:
    """ดาวปลอม TLE ไม่ต้องถูกต้อง (ใช้แค่ทำ key) rev ต่างกัน = TLE ใหม่ของดวงเดิม"""
    l1 = f"1 {norad:05d}U 98067A   26315.{rev:08d}  .00000000  00000-0  00000-0 0  9990"
    l2 = f"2 {norad:05d}  51.6400 100.0000 0001000  90.0000 270.0000 15.50000000 1000"
    return SatSpec(norad, gmat_name(norad), (l1, l2))


def fake_orbit(prn: str, rev: int, dt: float) -> tuple[tuple, tuple]:
    """วงโคจรสังเคราะห์กำลังสอง (Lagrange 10 จุดได้ค่าตรง) ความเร็วเป็นอนุพันธ์ของตำแหน่งพอดี"""
    n = int(prn[1:]) if prn[1:].isdigit() else 7
    a = (7000.0 + n + rev, 100.0 - n, -50.0 + 2 * n)
    b = (1.5, -2.0, 0.5)
    c = (1e-6, -2e-6, 3e-6)
    pos = tuple(a[i] + b[i] * dt + c[i] * dt * dt for i in range(3))
    vel = tuple(b[i] + 2 * c[i] * dt for i in range(3))
    return pos, vel


class FakePropagate:
    """propagate ปลอม: จดการเรียก, เรียก on_gmat_start(pgid), คืน Ephemeris สังเคราะห์พร้อมความเร็ว"""

    def __init__(self):
        self.calls: list[dict] = []
        self.fail: Exception | None = None
        self.drop: set[str] = set()                 # prn ที่ GMAT "ไม่คืนค่า"
        self.before_start = None                    # เรียกก่อน on_gmat_start (ก่อน GMAT ได้ pgid)
        self.during = None                          # เรียกหลัง on_gmat_start (ระหว่าง GMAT "รัน")
        self.pgid = 4242
        self.revs: dict[str, int] = {}

    def __call__(self, sats, start, stop, step_s, work_dir, console, timeout_s=900,
                 on_gmat_start=None, with_velocity=False):
        self.calls.append({"prns": [s.prn for s in sats], "start": start, "stop": stop, "step": step_s,
                           "work_dir": Path(work_dir), "console": console, "timeout": timeout_s,
                           "with_velocity": with_velocity, "tle": [s.tle_lines for s in sats]})
        Path(work_dir).mkdir(parents=True, exist_ok=True)
        (Path(work_dir) / "gmat.log").write_text("log", encoding="utf-8")
        if self.before_start is not None:
            self.before_start()
        if on_gmat_start is not None:
            on_gmat_start(self.pgid)
        if self.during is not None:
            self.during()
        if self.fail is not None:
            raise self.fail
        n = int((stop - start).total_seconds()) // step_s + 1
        times = [start + timedelta(seconds=k * step_s) for k in range(n)]
        pos, vel, msgs = {}, {}, []
        for s in sats:
            if s.prn in self.drop:
                msgs.append(Message("SAT_MISSING_FROM_GMAT", "warning", f"ตัดดาว {s.prn} ออก", s.prn))
                continue
            rev = int(s.tle_lines[0].split()[3].split(".")[1])
            series = [fake_orbit(s.prn, rev, (t - start).total_seconds()) for t in times]
            pos[s.prn] = [p for p, _ in series]
            vel[s.prn] = [v for _, v in series]
        return Ephemeris(times, pos, vel if with_velocity else None), msgs


def codes(status) -> tuple[str, list[str]]:
    return status[0], [m.code for m in status[1]]


class WindowTest(unittest.TestCase):
    def test_window_forward(self):
        self.assertEqual(window_for(T("2026-11-12T07:20Z"), +1), (T("2026-11-12T05:00Z"), T("2026-11-12T21:00Z")))

    def test_window_stopped_same_as_forward(self):
        self.assertEqual(window_for(T("2026-11-12T07:20Z"), 0), (T("2026-11-12T05:00Z"), T("2026-11-12T21:00Z")))

    def test_window_backward(self):
        self.assertEqual(window_for(T("2026-11-12T07:20Z"), -1), (T("2026-11-11T18:00Z"), T("2026-11-12T10:00Z")))

    def test_window_backward_on_the_hour(self):
        # ceil_hour(T) = T เมื่อ T ตรงชั่วโมงพอดี
        self.assertEqual(window_for(T("2026-11-12T07:00Z"), -1), (T("2026-11-11T17:00Z"), T("2026-11-12T09:00Z")))

    def test_window_from_other_timezone_is_utc(self):
        t = T("2026-11-12T14:20+07:00")                 # = 07:20Z
        w = window_for(t, +1)
        self.assertEqual(w, (T("2026-11-12T05:00Z"), T("2026-11-12T21:00Z")))
        self.assertEqual(w[0].utcoffset(), timedelta(0))

    def test_usable_edges(self):
        w = window_for(T("2026-11-12T07:20Z"), +1)
        start, stop = w
        self.assertTrue(usable(w, start + timedelta(seconds=150)))
        self.assertFalse(usable(w, start + timedelta(seconds=149)))
        self.assertTrue(usable(w, stop - timedelta(seconds=150)))
        self.assertFalse(usable(w, stop - timedelta(seconds=149)))

    def test_needs_next(self):
        w = window_for(T("2026-11-12T07:20Z"), +1)          # 05:00–21:00
        start, stop = w
        self.assertTrue(needs_next(w, stop - timedelta(hours=2, minutes=59), +1))
        self.assertFalse(needs_next(w, stop - timedelta(hours=3), +1))
        self.assertTrue(needs_next(w, stop - timedelta(hours=2, minutes=59), 0))
        self.assertFalse(needs_next(w, stop - timedelta(hours=3), 0))
        # ถอยหลังดูฝั่ง start
        self.assertTrue(needs_next(w, start + timedelta(hours=2, minutes=59), -1))
        self.assertFalse(needs_next(w, start + timedelta(hours=3), -1))
        self.assertFalse(needs_next(w, start + timedelta(hours=2, minutes=59), +1))

    def test_tle_key_is_sha256_prefix_of_two_lines(self):
        import hashlib
        s = spec(25544)
        expected = hashlib.sha256((s.tle_lines[0] + "\n" + s.tle_lines[1]).encode()).hexdigest()[:12]
        self.assertEqual(tle_key(s.tle_lines), expected)
        self.assertNotEqual(tle_key(spec(25544, 1).tle_lines), expected)


class SatEphemTest(unittest.TestCase):
    def test_state_at_interpolates_position_and_velocity(self):
        start = T("2026-11-12T05:00Z")
        times = [start + timedelta(seconds=k * STEP) for k in range(N_EPOCHS)]
        series = [fake_orbit("S25544", 0, (t - start).total_seconds()) for t in times]
        e = SatEphem(times, [p for p, _ in series], [v for _, v in series])
        t = start + timedelta(hours=3, seconds=17.25)
        pos, vel = e.state_at(t)
        want_pos, want_vel = fake_orbit("S25544", 0, (t - start).total_seconds())
        for got, want in zip(pos + vel, want_pos + want_vel):
            self.assertAlmostEqual(got, want, delta=1e-6)
        # ตรงจุดที่มี คืนค่านั้น
        self.assertEqual(e.state_at(times[100]), series[100])
        # ช่วงที่ใช้ได้ [start + 150 s, stop - 150 s]
        self.assertIsNotNone(e.state_at(start + timedelta(seconds=150)))
        self.assertIsNone(e.state_at(start + timedelta(seconds=149)))
        self.assertIsNotNone(e.state_at(times[-1] - timedelta(seconds=150)))
        self.assertIsNone(e.state_at(times[-1] - timedelta(seconds=149)))
        self.assertIsNone(e.state_at(start - timedelta(hours=1)))


class ManagerTestBase(unittest.TestCase):
    def setUp(self):
        self.cfg = temp_config(self)
        self.fake = FakePropagate()
        self.console = Path("/fake/GmatConsole")
        self.find_calls = 0
        self.find_error: Exception | None = None
        self.on_find = None
        self.m = self.manager()
        self.w = window_for(T("2026-11-12T07:20Z"), +1)
        self.t = T("2026-11-12T07:20:10Z")

    def find_console(self):
        self.find_calls += 1
        if self.on_find is not None:
            self.on_find()
        if self.find_error is not None:
            raise self.find_error
        return self.console

    def manager(self, **kw) -> EphemManager:
        kw.setdefault("start_worker", False)
        m = EphemManager(self.cfg, propagate_fn=self.fake, find_console=self.find_console, **kw)
        self.addCleanup(m.close)
        return m

    def ephem_dir(self) -> Path:
        return self.cfg.data_dir / "ephem"


class ManagerTest(ManagerTestBase):
    def test_computing_then_ok_with_values_from_gmat(self):
        s1 = spec(25544)
        self.m.ensure("A", [s1], self.w)
        self.assertEqual(codes(self.m.status("A")), ("computing", []))
        self.assertIsNone(self.m.get(s1, self.w))
        self.m.drain()
        self.assertEqual(codes(self.m.status("A")), ("ok", []))
        call = self.fake.calls[0]
        self.assertEqual((call["start"], call["stop"], call["step"]), (self.w[0], self.w[1], 30))
        self.assertTrue(call["with_velocity"])
        self.assertEqual(call["timeout"], 600)
        self.assertEqual(call["console"], self.console)
        self.assertEqual(call["prns"], ["S25544"])
        self.assertEqual(call["work_dir"].parent, self.ephem_dir() / "_work")
        self.assertFalse(call["work_dir"].exists())         # สำเร็จแล้วลบ work dir
        pos, vel = self.m.get(s1, self.w).state_at(self.t)
        want_pos, want_vel = fake_orbit("S25544", 0, (self.t - self.w[0]).total_seconds())
        for got, want in zip(pos + vel, want_pos + want_vel):
            self.assertAlmostEqual(got, want, delta=1e-6)

    def test_runs_only_missing_sats(self):
        s1, s2, s3 = spec(25544), spec(43013), spec(100744)
        self.m.ensure("A", [s1, s2], self.w)
        self.m.ensure("B", [s2, s3], self.w)
        self.m.drain()
        self.assertEqual([c["prns"] for c in self.fake.calls], [["S25544", "S43013"], ["SA0744"]])
        self.assertEqual(codes(self.m.status("B")), ("ok", []))

    def test_cached_sats_are_not_rerun(self):
        s1, s2 = spec(25544), spec(43013)
        self.m.ensure("A", [s1, s2], self.w)
        self.m.drain()
        self.m.ensure("A", [s1, s2], self.w)                # tick ถัดไปเรียกซ้ำ
        self.m.ensure("B", [s2], self.w)
        self.assertEqual(codes(self.m.status("B")), ("ok", []))
        self.m.drain()
        self.assertEqual(len(self.fake.calls), 1)

    def test_tle_change_recomputes(self):
        old, new = spec(25544, 0), spec(25544, 1)
        self.m.ensure("A", [old], self.w)
        self.m.drain()
        self.m.ensure("A", [new], self.w)
        self.assertEqual(codes(self.m.status("A")), ("computing", []))
        self.assertIsNotNone(self.m.get(old, self.w))           # ค่าเก่ายังใช้ได้ระหว่างรอ
        self.assertIsNone(self.m.get(new, self.w))
        self.m.drain()
        self.assertEqual(len(self.fake.calls), 2)
        self.assertEqual(self.fake.calls[1]["tle"], [new.tle_lines])
        self.assertEqual(codes(self.m.status("A")), ("ok", []))
        p_old, _ = self.m.get(old, self.w).state_at(self.t)
        p_new, _ = self.m.get(new, self.w).state_at(self.t)
        self.assertAlmostEqual(p_new[0] - p_old[0], 1.0, delta=1e-6)

    def test_disk_cache_survives_restart(self):
        s1 = spec(25544)
        self.m.ensure("A", [s1], self.w)
        self.m.drain()
        path = self.ephem_dir() / "20261112T0500Z_20261112T2100Z_30" / f"{tle_key(s1.tle_lines)}.f64"
        self.assertEqual(path.stat().st_size, N_EPOCHS * 6 * 8)
        data = array("d")
        data.frombytes(path.read_bytes())
        if sys.byteorder == "big":
            data.byteswap()
        want_pos, want_vel = fake_orbit("S25544", 0, 30.0)  # epoch ที่ 2: x y z vx vy vz
        self.assertEqual(tuple(data[6:12]), want_pos + want_vel)
        self.assertEqual([p.name for p in path.parent.iterdir()], [path.name])   # ไม่มีไฟล์ชั่วคราวค้าง

        m2 = self.manager()
        e = m2.get(s1, self.w)
        self.assertIsNotNone(e)
        self.assertEqual(e.state_at(self.t), self.m.get(s1, self.w).state_at(self.t))
        m2.ensure("B", [s1], self.w)
        self.assertEqual(codes(m2.status("B")), ("ok", []))
        m2.drain()
        self.assertEqual(len(self.fake.calls), 1)

    def test_wrong_length_file_is_treated_as_missing(self):
        s1 = spec(25544)
        path = self.ephem_dir() / "20261112T0500Z_20261112T2100Z_30" / f"{tle_key(s1.tle_lines)}.f64"
        path.parent.mkdir(parents=True)
        path.write_bytes(b"\0" * 480)
        self.assertIsNone(self.m.get(s1, self.w))
        self.m.ensure("A", [s1], self.w)
        self.assertEqual(codes(self.m.status("A")), ("computing", []))
        self.m.drain()
        self.assertEqual(len(self.fake.calls), 1)
        self.assertEqual(path.stat().st_size, N_EPOCHS * 6 * 8)

    def test_prune_removes_windows_older_than_7_days(self):
        now = T("2026-11-20T12:00Z")
        root = self.ephem_dir()
        old = root / "20261112T0500Z_20261112T2100Z_30"          # stop 8 วัน 15 ชม. ก่อน now
        edge = root / "20261112T2000Z_20261113T1200Z_30"         # stop = now - 7 วันพอดี: ยังไม่เก่ากว่า
        recent = root / "20261114T0500Z_20261114T2100Z_30"
        other = root / "notes"
        old_work, new_work = root / "_work" / "job-old", root / "_work" / "job-new"
        for d in (old, edge, recent, other, old_work, new_work):
            d.mkdir(parents=True)
            (d / "x.f64").write_bytes(b"1")
        ancient = (now - timedelta(days=7, minutes=1)).timestamp()
        os.utime(old_work, (ancient, ancient))
        fresh = (now - timedelta(days=6)).timestamp()
        os.utime(new_work, (fresh, fresh))
        self.m.prune(now)
        self.assertFalse(old.exists())
        self.assertFalse(old_work.exists())
        for d in (edge, recent, other, new_work):
            self.assertTrue(d.exists(), d)

    def test_prune_keeps_window_in_use(self):
        now = T("2026-11-30T12:00Z")
        s1 = spec(25544)
        self.m.ensure("A", [s1], self.w)
        self.m.drain()
        self.m.prune(now)
        self.assertTrue((self.ephem_dir() / "20261112T0500Z_20261112T2100Z_30").exists())
        self.m.release("A")
        self.m.prune(now)
        self.assertFalse((self.ephem_dir() / "20261112T0500Z_20261112T2100Z_30").exists())

    def test_release_cancels_queued_and_kills_running(self):
        s1, s2 = spec(25544), spec(43013)
        w2 = window_for(self.w[1] + timedelta(hours=1), +1)
        self.m.ensure("A", [s1], self.w)
        self.m.ensure("B", [s2], w2)
        self.fake.during = lambda: self.m.release("A")         # ปิด module A ระหว่าง GMAT ของ A รัน
        with mock.patch("gpredict_web.ephem.os.killpg") as killpg:
            self.m.release("B")                                # งานของ B ยังอยู่ในคิว -> ตัดออก
            self.m.drain()
            killpg.assert_called_once_with(4242, signal.SIGKILL)
        self.assertEqual([c["prns"] for c in self.fake.calls], [["S25544"]])
        self.assertEqual(codes(self.m.status("A")), ("ok", []))
        self.assertEqual(codes(self.m.status("A", self.w)), ("ok", []))

    def test_killed_job_is_discarded_and_not_failed(self):
        s1 = spec(25544)
        self.m.ensure("A", [s1], self.w)

        def killed():
            self.m.release("A")
            raise GmatRunError("GMAT จบด้วย exit code -9")       # GMAT ที่โดน SIGKILL
        self.fake.during = killed
        with mock.patch("gpredict_web.ephem.os.killpg"):
            self.m.drain()
        self.m.ensure("A", [s1], self.w)                       # เปิดใหม่: ไม่ค้างสถานะ failed
        self.assertEqual(codes(self.m.status("A")), ("computing", []))
        self.fake.during = None
        self.m.drain()
        self.assertEqual(codes(self.m.status("A")), ("ok", []))

    def test_release_before_gmat_starts_kills_on_start(self):
        s1 = spec(25544)
        self.m.ensure("A", [s1], self.w)
        self.fake.before_start = lambda: self.m.release("A")   # ยกเลิกหลังเรียก GMAT แต่ก่อนได้ pgid
        with mock.patch("gpredict_web.ephem.os.killpg") as killpg:
            self.m.drain()                                     # on_gmat_start ต้อง raise ให้ run_script ฆ่ากลุ่มเอง
            killpg.assert_not_called()
        self.assertEqual(len(self.fake.calls), 1)
        self.assertIsNone(self.m.get(s1, self.w))
        self.assertEqual(codes(self.m.status("A", self.w)), ("ok", []))

    def test_release_before_propagate_skips_gmat(self):
        s1 = spec(25544)
        self.m.ensure("A", [s1], self.w)
        self.on_find = lambda: self.m.release("A")             # ยกเลิกระหว่างหา GmatConsole
        self.m.drain()
        self.assertEqual(self.fake.calls, [])

    def test_release_keeps_job_still_needed_by_other_owner(self):
        s1 = spec(25544)
        self.m.ensure("A", [s1], self.w)
        self.m.ensure("B", [s1], self.w)
        self.fake.during = lambda: self.m.release("A")
        with mock.patch("gpredict_web.ephem.os.killpg") as killpg:
            self.m.drain()
            killpg.assert_not_called()
        self.assertEqual(codes(self.m.status("B")), ("ok", []))
        self.assertIsNotNone(self.m.get(s1, self.w))

    def test_replacing_sat_list_trims_queued_job(self):
        s1, s2 = spec(25544), spec(43013)
        self.m.ensure("A", [s1, s2], self.w)
        self.m.ensure("A", [s2], self.w)
        self.m.drain()
        self.assertEqual([c["prns"] for c in self.fake.calls], [["S43013"]])

    def test_owner_holds_two_windows(self):
        s1 = spec(25544)
        w2 = window_for(self.w[1] - timedelta(hours=2), +1)     # ช่วงถัดไป (prefetch)
        self.m.ensure("A", [s1], self.w)
        self.m.drain()
        self.m.ensure("A", [s1], w2)
        self.assertEqual(codes(self.m.status("A", self.w)), ("ok", []))
        self.assertEqual(codes(self.m.status("A", w2)), ("computing", []))
        self.assertEqual(codes(self.m.status("A")), ("computing", []))   # ช่วงของ ensure ล่าสุด
        self.m.drain()
        self.m.release("A", self.w)
        self.assertEqual(codes(self.m.status("A", w2)), ("ok", []))
        # หน่วยความจำของช่วงที่ไม่มีใครใช้ถูกปล่อย: ลบไฟล์แล้ว get ต้องได้ None
        (self.ephem_dir() / "20261112T0500Z_20261112T2100Z_30" / f"{tle_key(s1.tle_lines)}.f64").unlink()
        self.assertIsNone(self.m.get(s1, self.w))
        self.assertIsNotNone(self.m.get(s1, w2))

    def test_release_one_window_cancels_only_its_job(self):
        s1 = spec(25544)
        w2 = window_for(self.w[1] - timedelta(hours=2), +1)
        self.m.ensure("A", [s1], self.w)
        self.m.ensure("A", [s1], w2)
        self.m.release("A", self.w)
        self.m.drain()
        self.assertEqual([(c["start"], c["stop"]) for c in self.fake.calls], [w2])

    def test_gmat_failure_then_retry(self):
        s1 = spec(25544)
        self.fake.fail = GmatRunError("GMAT จบด้วย exit code 3")
        self.m.ensure("A", [s1], self.w)
        self.m.drain()
        st = self.m.status("A")
        self.assertEqual(codes(st), ("failed", ["GMAT_FAILED"]))
        self.assertEqual(st[1][0].level, "error")
        self.assertIn("exit code 3", st[1][0].text)
        self.assertTrue(self.fake.calls[0]["work_dir"].exists())   # เก็บ work dir ไว้ดูสาเหตุ
        self.m.ensure("A", [s1], self.w)                           # ไม่ลองใหม่เอง
        self.m.drain()
        self.assertEqual(len(self.fake.calls), 1)
        self.assertEqual(codes(self.m.status("A")), ("failed", ["GMAT_FAILED"]))
        self.fake.fail = None
        self.m.retry("A")
        self.assertEqual(codes(self.m.status("A")), ("computing", []))
        self.m.drain()
        self.assertEqual(codes(self.m.status("A")), ("ok", []))
        self.assertEqual(len(self.fake.calls), 2)

    def fail_once(self, sats, owner="A") -> None:
        self.fake.fail = GmatRunError("boom")
        self.m.ensure(owner, sats, self.w)
        self.m.drain()
        self.fake.fail = None
        self.assertEqual(codes(self.m.status(owner)), ("failed", ["GMAT_FAILED"]))

    def test_adding_satellites_clears_the_failure_and_queues_the_missing_ones(self):
        """Configure ที่เพิ่มดาวเข้า module ที่ GMAT ล้มอยู่ไม่ค้างที่ failed (ไม่ต้องกด Retry)"""
        s1, s2 = spec(25544), spec(43013)
        self.fail_once([s1])
        self.m.ensure("A", [s1, s2], self.w)
        self.assertEqual(codes(self.m.status("A")), ("computing", []))
        self.m.drain()
        self.assertEqual(codes(self.m.status("A")), ("ok", []))
        self.assertEqual(len(self.fake.calls), 2)
        self.assertEqual(sorted(self.fake.calls[1]["prns"]), sorted([s1.prn, s2.prn]))      # ดวงที่ยังไม่มีค่าทุกดวง
        self.assertIsNotNone(self.m.get(s1, self.w))
        self.assertIsNotNone(self.m.get(s2, self.w))

    def test_removing_a_satellite_also_clears_the_failure(self):
        s1, s2 = spec(25544), spec(43013)
        self.fail_once([s1, s2])
        self.m.ensure("A", [s1], self.w)
        self.assertEqual(codes(self.m.status("A")), ("computing", []))
        self.m.drain()
        self.assertEqual(codes(self.m.status("A")), ("ok", []))

    def test_a_new_tle_of_the_same_satellite_also_clears_the_failure(self):
        self.fail_once([spec(25544)])
        self.m.ensure("A", [spec(25544, rev=1)], self.w)                      # TLE ใหม่ของดวงเดิม = ชุดดาวต่างจากเดิม
        self.assertEqual(codes(self.m.status("A")), ("computing", []))
        self.m.drain()
        self.assertEqual(codes(self.m.status("A")), ("ok", []))

    def test_same_satellites_keep_the_failure_until_retry(self):
        s1, s2 = spec(25544), spec(43013)
        self.fail_once([s1, s2])
        calls = len(self.fake.calls)
        self.m.ensure("A", [s2, s1], self.w)                                   # ชุดเดิม ลำดับต่าง: ยัง failed
        self.m.drain()
        self.assertEqual(len(self.fake.calls), calls)
        self.assertEqual(codes(self.m.status("A")), ("failed", ["GMAT_FAILED"]))
        self.m.retry("A")
        self.m.drain()
        self.assertEqual(codes(self.m.status("A")), ("ok", []))

    def test_changed_set_of_one_owner_leaves_another_owners_failure(self):
        s1, s2 = spec(25544), spec(43013)
        self.fake.fail = GmatRunError("boom")
        self.m.ensure("A", [s1], self.w)
        self.m.ensure("B", [s1], self.w)
        self.m.drain()
        self.fake.fail = None
        self.assertEqual(codes(self.m.status("B")), ("failed", ["GMAT_FAILED"]))
        self.m.ensure("A", [s1, s2], self.w)
        self.assertEqual(codes(self.m.status("A")), ("computing", []))
        self.assertEqual(codes(self.m.status("B")), ("failed", ["GMAT_FAILED"]))

    def test_changed_set_that_fails_again_is_failed_again(self):
        s1, s2 = spec(25544), spec(43013)
        self.fail_once([s1])
        self.fake.fail = GmatRunError("boom again")
        self.m.ensure("A", [s1, s2], self.w)
        self.m.drain()
        st = self.m.status("A")
        self.assertEqual(codes(st), ("failed", ["GMAT_FAILED"]))
        self.assertIn("boom again", st[1][0].text)

    def test_failure_moves_on_with_new_window(self):
        s1 = spec(25544)
        self.fake.fail = GmatRunError("boom")
        self.m.ensure("A", [s1], self.w)
        self.m.drain()
        self.fake.fail = None
        w2 = window_for(self.w[1] + timedelta(days=3), +1)       # เวลาของ module ย้ายไปช่วงอื่น
        self.m.release("A", self.w)
        self.m.ensure("A", [s1], w2)
        self.assertEqual(codes(self.m.status("A")), ("computing", []))
        self.m.drain()
        self.assertEqual(codes(self.m.status("A")), ("ok", []))

    def test_gmat_not_found(self):
        self.find_error = GmatNotFoundError("ไม่พบ GmatConsole")
        self.m.ensure("A", [spec(25544)], self.w)
        self.m.drain()
        st = self.m.status("A")
        self.assertEqual(codes(st), ("failed", ["GMAT_NOT_FOUND"]))
        self.assertEqual(st[1][0].level, "error")
        self.assertEqual(self.fake.calls, [])
        self.find_error = None
        self.m.retry("A")
        self.m.drain()
        self.assertEqual(codes(self.m.status("A")), ("ok", []))

    def test_sat_missing_from_gmat_is_reported_not_rerun(self):
        s1, s2 = spec(25544), spec(43013)
        self.fake.drop = {"S43013"}
        self.m.ensure("A", [s1, s2], self.w)
        self.m.drain()
        st = self.m.status("A")
        self.assertEqual(codes(st), ("ok", ["SAT_MISSING_FROM_GMAT"]))
        self.assertEqual((st[1][0].level, st[1][0].object), ("warning", "S43013"))
        self.assertIsNone(self.m.get(s2, self.w))
        self.assertIsNotNone(self.m.get(s1, self.w))
        self.m.ensure("A", [s1, s2], self.w)
        self.m.drain()
        self.assertEqual(len(self.fake.calls), 1)

    def test_unexpected_error_marks_failed_and_worker_continues(self):
        s1, s2 = spec(25544), spec(43013)
        w2 = window_for(self.w[1] + timedelta(hours=1), +1)
        def bad_then_good(*args, **kw):
            eph, msgs = self.fake(*args, **kw)
            if len(self.fake.calls) == 1:                          # งานแรก: ผลมีค่าที่ไม่ใช่ตัวเลข (บั๊กที่ไม่คาดไว้)
                eph.positions_km = {p: [("x", "y", "z")] * len(v) for p, v in eph.positions_km.items()}
            return eph, msgs
        m = EphemManager(self.cfg, propagate_fn=bad_then_good, find_console=self.find_console, start_worker=False)
        self.addCleanup(m.close)
        m.ensure("A", [s1], self.w)
        m.ensure("B", [s2], w2)
        with self.assertLogs("gpredict_web.ephem", "ERROR"):
            m.drain()
        self.assertEqual(codes(m.status("A")), ("failed", ["GMAT_FAILED"]))
        self.assertEqual(codes(m.status("B")), ("ok", []))         # งานถัดไปยังทำต่อได้

    def test_status_of_unknown_owner_is_ok(self):
        self.assertEqual(self.m.status("nobody"), ("ok", []))

    def test_ensure_rejects_misaligned_window(self):
        start = T("2026-11-12T05:00:10Z")
        with self.assertRaises(ValueError):
            self.m.ensure("A", [spec(25544)], (start, start + timedelta(hours=16)))
        with self.assertRaises(ValueError):
            self.m.ensure("A", [spec(25544)], (self.w[0], self.w[0] + timedelta(seconds=45)))

    def test_lock_not_held_while_gmat_runs(self):
        s1, s2 = spec(25544), spec(43013)
        self.m.ensure("A", [s1], self.w)
        seen, stuck = [], []

        def from_other_thread():                                   # ระหว่าง GMAT "รัน" thread อื่นต้องเรียกได้ทันที
            t = threading.Thread(target=lambda: seen.append((codes(self.m.status("A")),
                                                             self.m.ensure("B", [s2], self.w))))
            t.start()
            t.join(5)
            stuck.append(t.is_alive())
        self.fake.during = from_other_thread
        self.m.drain()
        self.assertEqual(stuck, [False, False])
        self.assertEqual(seen[0][0], ("computing", []))
        self.assertEqual([c["prns"] for c in self.fake.calls], [["S25544"], ["S43013"]])

    def test_release_after_gmat_exits_does_not_kill_stale_pgid(self):
        s1 = spec(25544)
        self.m.ensure("A", [s1], self.w)
        write = self.m._write

        def release_then_write(*args):
            self.m.release("A")                                    # GMAT จบแล้ว (pgid อาจถูกใช้ซ้ำ) กำลังเขียน cache
            write(*args)
        with mock.patch.object(self.m, "_write", side_effect=release_then_write), \
                mock.patch("gpredict_web.ephem.os.killpg") as killpg:
            self.m.drain()
            killpg.assert_not_called()
        self.assertIsNotNone(self.m.get(s1, self.w))               # ค่าที่เสร็จแล้วยังอยู่บนดิสก์


class WorkerThreadTest(ManagerTestBase):
    def test_worker_thread_processes_queue(self):
        m = self.manager(start_worker=True)
        s1 = spec(25544)
        m.ensure("A", [s1], self.w)
        deadline = time.monotonic() + 10
        while m.status("A")[0] != "ok" and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertEqual(codes(m.status("A")), ("ok", []))
        self.assertIsNotNone(m.get(s1, self.w))

    def test_drain_refused_while_worker_thread_runs(self):
        m = self.manager(start_worker=True)                    # manager() ปิดให้ใน cleanup
        with self.assertRaises(RuntimeError):
            m.drain()

    def test_close_kills_running_job(self):
        started, release_fake = threading.Event(), threading.Event()

        def during():
            started.set()
            release_fake.wait(5)
            raise GmatRunError("killed")
        self.fake.during = during
        m = self.manager(start_worker=True)
        m.ensure("A", [spec(25544)], self.w)
        self.assertTrue(started.wait(5))
        with mock.patch("gpredict_web.ephem.os.killpg") as killpg:
            m.close()
            killpg.assert_called_once_with(4242, signal.SIGKILL)
        release_fake.set()


if __name__ == "__main__":
    unittest.main()
