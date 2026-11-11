import sys
import threading
import time
import unittest
from datetime import datetime, timedelta, timezone

from gpredict_web.clock import ModuleClock
from tests.helpers import FakeNow

UTC = timezone.utc
T0 = datetime(2026, 11, 12, 5, 0, 0, tzinfo=UTC)


class ModuleClockTest(unittest.TestCase):
    def setUp(self):
        self.wall = FakeNow(T0)
        self.clock = ModuleClock(self.wall)

    def test_starts_real_time(self):
        c = self.clock
        self.assertEqual((c.state, c.throttle), ("forward", 1))
        self.assertEqual(c.time(), T0)
        self.assertEqual(c.label(), "Real-Time")
        self.assertEqual(c.direction(), 1)
        self.wall.advance(10)
        self.assertEqual(c.time(), T0 + timedelta(seconds=10))
        self.assertEqual(c.label(), "Real-Time")

    def test_throttle_50_runs_50x_without_jump(self):
        c = self.clock
        self.wall.advance(10)
        before = c.time()
        self.assertEqual(before, T0 + timedelta(seconds=10))
        c.set(throttle=50)
        self.assertEqual(c.throttle, 50)
        self.assertEqual(c.state, "forward")
        self.assertEqual(c.time(), before)                              # เปลี่ยน throttle เวลาไม่กระโดด
        self.wall.advance(2)
        self.assertEqual(c.time(), before + timedelta(seconds=100))
        after = c.time()
        c.set(throttle=10)                                              # เปลี่ยนอีกครั้งก็ไม่กระโดด
        self.assertEqual(c.time(), after)
        self.wall.advance(3)
        self.assertEqual(c.time(), after + timedelta(seconds=30))
        self.assertEqual(c.label(), "Simulated Real-Time")

    def test_backward(self):
        c = self.clock
        self.wall.advance(7)
        before = c.time()
        c.set(state="backward", throttle=5)
        self.assertEqual((c.state, c.throttle, c.direction()), ("backward", 5, -1))
        self.assertEqual(c.time(), before)                              # เปลี่ยนสถานะเวลาไม่กระโดด
        self.wall.advance(4)
        self.assertEqual(c.time(), before - timedelta(seconds=20))
        mid = c.time()
        c.set(state="forward")                                          # กลับเดินหน้าจากเวลาปัจจุบัน throttle เดิม
        self.assertEqual(c.time(), mid)
        self.wall.advance(1)
        self.assertEqual(c.time(), mid + timedelta(seconds=5))

    def test_stop_holds_time_and_set_time(self):
        c = self.clock
        self.wall.advance(5)
        held = c.time()
        c.set(state="stop")
        self.assertEqual((c.state, c.direction()), ("stop", 0))
        self.assertEqual(c.time(), held)
        self.wall.advance(1000)
        self.assertEqual(c.time(), held)                                # หยุดแล้วเวลาคงที่
        target = datetime(2027, 1, 2, 3, 4, 5, 678000, tzinfo=UTC)
        c.set(time=target)
        self.assertEqual(c.time(), target)
        self.wall.advance(1000)
        self.assertEqual(c.time(), target)
        c.set(state="forward", throttle=2)                              # เดินต่อจากเวลาที่ตั้งไว้
        self.assertEqual(c.time(), target)
        self.wall.advance(10)
        self.assertEqual(c.time(), target + timedelta(seconds=20))

    def test_set_state_and_time_together(self):
        target = datetime(2030, 6, 1, 12, 0, 0, tzinfo=UTC)
        self.clock.set(state="stop", time=target)
        self.assertEqual(self.clock.state, "stop")
        self.assertEqual(self.clock.time(), target)

    def test_set_time_while_running_restarts_from_it(self):
        c = self.clock
        c.set(throttle=10)
        target = datetime(2026, 12, 25, 0, 0, 0, tzinfo=UTC)
        c.set(time=target)
        self.assertEqual((c.state, c.throttle), ("forward", 10))
        self.assertEqual(c.time(), target)
        self.wall.advance(3)
        self.assertEqual(c.time(), target + timedelta(seconds=30))

    def test_set_time_converts_other_zones_to_utc(self):
        bangkok = timezone(timedelta(hours=7))
        c = self.clock
        c.set(state="stop", time=datetime(2026, 11, 12, 12, 0, 0, tzinfo=bangkok))
        self.assertEqual(c.time(), datetime(2026, 11, 12, 5, 0, 0, tzinfo=UTC))
        self.assertEqual(c.time().utcoffset(), timedelta(0))

    def test_reset(self):
        c = self.clock
        c.set(state="backward", throttle=80)
        self.wall.advance(100)
        c.set(state="stop", time=datetime(2020, 1, 1, tzinfo=UTC))
        self.wall.advance(50)
        c.reset()
        self.assertEqual((c.state, c.throttle), ("forward", 1))
        self.assertEqual(c.time(), self.wall())
        self.assertEqual(c.label(), "Real-Time")
        self.wall.advance(4)
        self.assertEqual(c.time(), self.wall())

    def test_labels(self):
        c = self.clock
        self.assertEqual(c.label(), "Real-Time")

        # forward throttle 1 ที่ offset 0.5 s ยังเป็น Real-Time
        c.set(state="stop", time=T0 + timedelta(seconds=0.5))
        c.set(state="forward", throttle=1)
        self.assertEqual(c.label(), "Real-Time")
        c.set(state="stop", time=T0 - timedelta(seconds=0.5))
        c.set(state="forward")
        self.assertEqual(c.label(), "Real-Time")

        # offset 2 s -> Simulated Real-Time (ทั้งเร็วกว่าและช้ากว่าเวลาเครื่อง)
        c.set(state="stop", time=T0 + timedelta(seconds=2))
        c.set(state="forward")
        self.assertEqual(c.label(), "Simulated Real-Time")
        c.set(state="stop", time=T0 - timedelta(seconds=2))
        c.set(state="forward")
        self.assertEqual(c.label(), "Simulated Real-Time")

        # offset 1 s พอดีไม่ใช่ "< 1 s"
        c.set(state="stop", time=T0 + timedelta(seconds=1))
        c.set(state="forward")
        self.assertEqual(c.label(), "Simulated Real-Time")

        c.reset()
        self.assertEqual(c.label(), "Real-Time")
        c.set(throttle=2)
        self.assertEqual(c.label(), "Simulated Real-Time")
        c.reset()
        c.set(state="backward")
        self.assertEqual(c.label(), "Simulated Real-Time")
        c.set(state="stop")
        self.assertEqual(c.label(), "Manual Control")

    def test_label_leaves_real_time_when_offset_grows(self):
        c = self.clock
        c.set(throttle=1)
        c.set(state="stop", time=T0 + timedelta(seconds=0.5))
        c.set(state="forward")
        self.assertEqual(c.label(), "Real-Time")
        c.set(throttle=3)
        self.wall.advance(1)                                            # T เดินเร็ว 3 เท่า offset โตเกิน 1 s
        self.assertEqual(c.label(), "Simulated Real-Time")

    def test_direction(self):
        c = self.clock
        self.assertEqual(c.direction(), 1)
        c.set(state="backward")
        self.assertEqual(c.direction(), -1)
        c.set(state="stop")
        self.assertEqual(c.direction(), 0)
        c.reset()
        self.assertEqual(c.direction(), 1)

    def test_invalid_values(self):
        c = self.clock
        bad_throttles = [0, 101, -1, 1000, 1.5, 50.0, "5", True, False, [5]]
        for value in bad_throttles:
            with self.subTest(throttle=value):
                with self.assertRaises(ValueError):
                    c.set(throttle=value)
        for value in ("pause", "", "Forward", "STOP", 1, ["stop"]):
            with self.subTest(state=value):
                with self.assertRaises(ValueError):
                    c.set(state=value)
        for value in (datetime(2026, 1, 1), "2026-01-01T00:00:00Z", 1700000000):
            with self.subTest(time=value):
                with self.assertRaises(ValueError):
                    c.set(time=value)
        # ขอบเขตที่ยังใช้ได้
        c.set(throttle=1)
        c.set(throttle=100)
        self.assertEqual(c.throttle, 100)

    def test_invalid_call_changes_nothing(self):
        c = self.clock
        c.set(state="backward", throttle=7)
        self.wall.advance(3)
        snapshot = (c.state, c.throttle, c.time())
        with self.assertRaises(ValueError):
            c.set(state="stop", throttle=0, time=T0)
        with self.assertRaises(ValueError):
            c.set(state="pause", throttle=9)
        with self.assertRaises(ValueError):
            c.set(throttle=9, time=datetime(2026, 1, 1))
        self.assertEqual((c.state, c.throttle, c.time()), snapshot)
        self.wall.advance(1)
        self.assertEqual(c.time(), snapshot[2] - timedelta(seconds=7))   # wall_ref ไม่ถูกขยับ

    def test_set_with_no_arguments_keeps_state(self):
        c = self.clock
        c.set(throttle=4)
        self.wall.advance(2)
        c.set()
        self.assertEqual((c.state, c.throttle), ("forward", 4))
        self.assertEqual(c.time(), T0 + timedelta(seconds=8))

    def test_snapshot_reads_everything_from_one_wall_reading(self):
        """snapshot() = (time, state, throttle, label) จากเวลาเครื่องครั้งเดียวใต้ lock เดียว (tick ต้องได้ค่าที่เข้ากัน)"""
        c = self.clock
        self.assertEqual(c.snapshot(), (T0, "forward", 1, "Real-Time"))
        c.set(throttle=5)
        self.wall.advance(2)
        self.assertEqual(c.snapshot(), (T0 + timedelta(seconds=10), "forward", 5, "Simulated Real-Time"))
        c.set(state="backward")
        self.wall.advance(1)
        self.assertEqual(c.snapshot(), (T0 + timedelta(seconds=5), "backward", 5, "Simulated Real-Time"))
        c.set(state="stop")
        self.wall.advance(100)
        self.assertEqual(c.snapshot(), (T0 + timedelta(seconds=5), "stop", 5, "Manual Control"))

        reads = []

        def counting_now():
            reads.append(self.wall())
            return self.wall()
        clock = ModuleClock(counting_now)
        reads.clear()
        clock.snapshot()
        self.assertEqual(len(reads), 1)

    def test_exact_arithmetic_with_microseconds(self):
        c = self.clock
        c.set(throttle=99)
        self.wall.advance(0.000001)
        self.assertEqual(c.time(), T0 + timedelta(microseconds=99))

    def test_new_clocks_are_independent(self):
        other = ModuleClock(self.wall)
        self.clock.set(state="stop")
        self.assertEqual(other.state, "forward")

    def test_concurrent_use_never_jumps(self):
        """หลาย thread เรียก set/time พร้อมกัน เวลาที่แต่ละ thread อ่านต้องไม่ถอยหลัง (ไม่มีการกระโดดจาก race)"""
        self.addCleanup(sys.setswitchinterval, sys.getswitchinterval())
        sys.setswitchinterval(1e-6)                                     # สลับ thread ถี่ ๆ ให้ race โผล่ถ้าไม่มี lock
        t_start = time.monotonic()
        wall = lambda: T0 + timedelta(seconds=time.monotonic() - t_start)
        clock = ModuleClock(wall)
        errors: list[str] = []

        def worker(seed: int):
            last = None
            for i in range(2000):
                clock.set(throttle=1 + (seed * 7 + i) % 100)
                now = clock.time()
                if last is not None and now < last:
                    errors.append(f"time went backward: {last} -> {now}")
                    return
                last = now

        threads = [threading.Thread(target=worker, args=(n,)) for n in range(6)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(errors, [])
        self.assertTrue(1 <= clock.throttle <= 100)


if __name__ == "__main__":
    unittest.main()
