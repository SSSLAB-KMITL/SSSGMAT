import unittest
from array import array
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from gpredict_web.dayblocks import day_dir, day_of_dir, day_window, split_days, stitch

UTC = timezone.utc
BLOCK = 2881                                         # epoch ต่อวัน 00:00Z..24:00Z ทุก 30 วินาที


class DayBlocksTest(unittest.TestCase):
    def test_split_then_stitch_round_trip(self):
        first, last = date(2026, 11, 12), date(2026, 11, 14)
        n = 3 * 2880 + 1                             # 8641 epoch ของ 3 วัน
        a = array("d", (float(i) for i in range(n * 6)))
        blocks = split_days(first, last, a)
        self.assertEqual(list(blocks), [date(2026, 11, 12), date(2026, 11, 13), date(2026, 11, 14)])
        for b in blocks.values():
            self.assertEqual(len(b), BLOCK * 6)
        # epoch เที่ยงคืนอยู่ทั้งสอง block
        self.assertEqual(blocks[date(2026, 11, 12)][-6:], blocks[date(2026, 11, 13)][:6])
        self.assertEqual(blocks[date(2026, 11, 13)][:6], a[2880 * 6:2881 * 6])

        e = stitch(first, list(blocks.values()))
        self.assertEqual(len(e.times), n)
        start = datetime(2026, 11, 12, tzinfo=UTC)
        self.assertEqual(e.times, [start + timedelta(seconds=30 * k) for k in range(n)])
        self.assertEqual(e.times[-1], datetime(2026, 11, 15, tzinfo=UTC))
        for i in range(n):
            self.assertEqual(e.pos[i], tuple(a[6 * i:6 * i + 3]))
            self.assertEqual(e.vel[i], tuple(a[6 * i + 3:6 * i + 6]))

    def test_day_window(self):
        self.assertEqual(day_window(date(2026, 11, 12), date(2026, 11, 13)),
                         (datetime(2026, 11, 12, tzinfo=UTC), datetime(2026, 11, 14, tzinfo=UTC)))
        self.assertEqual(day_window(date(2026, 12, 31), date(2026, 12, 31)),
                         (datetime(2026, 12, 31, tzinfo=UTC), datetime(2027, 1, 1, tzinfo=UTC)))

    def test_day_dir_name(self):
        self.assertEqual(day_dir(Path("/x/ephem"), date(2026, 11, 2)), Path("/x/ephem/day/20261102"))
        self.assertEqual(day_of_dir("20261102"), date(2026, 11, 2))
        for name in ("2026112", "20261302", "notes", "_work"):
            self.assertIsNone(day_of_dir(name), name)

    def test_rejects_bad_days_and_lengths(self):
        d = date(2026, 11, 12)
        with self.assertRaises(ValueError):
            day_window(d, d - timedelta(days=1))
        with self.assertRaises(ValueError):
            day_window(datetime(2026, 11, 12, tzinfo=UTC), d)
        with self.assertRaises(ValueError):
            split_days(d, d, array("d", [0.0] * (BLOCK * 6 - 6)))
        with self.assertRaises(ValueError):
            stitch(d, [])
        with self.assertRaises(ValueError):
            stitch(d, [array("d", [0.0] * 6)])


if __name__ == "__main__":
    unittest.main()
