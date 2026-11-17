import gzip
import math
import subprocess
import tempfile
import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

from gnss_predict.errors import Sp3FormatError, Sp3UnavailableError
from gnss_predict.sp3 import (
    Sp3Orbit, choose_mgx_sp3_name, choose_sp3_name, fetch_mgx_sp3, gps_week, interpolate, lagrange_at,
    prns_with_data, read_sp3, read_sp3_all, write_sp3,
)

FX = Path(__file__).parent / "fixtures"
FXS = FX / "studio"

class TestNames(unittest.TestCase):
    def test_gps_week(self):
        self.assertEqual(gps_week(date(2026, 11, 8)), 2444)
        self.assertEqual(gps_week(date(2026, 11, 7)), 2443)
        self.assertEqual(gps_week(date(2026, 1, 4)), 2400)

    def test_choose_prefers_final(self):
        d = date(2026, 11, 8)
        fin = "IGS0OPSFIN_20263120000_01D_15M_ORB.SP3.gz"
        rap = "IGS0OPSRAP_20263120000_01D_15M_ORB.SP3.gz"
        self.assertEqual(choose_sp3_name([rap, fin, "x"], d), fin)
        self.assertEqual(choose_sp3_name([rap], d), rap)
        self.assertIsNone(choose_sp3_name(["IGS0OPSRAP_20263130000_01D_15M_ORB.SP3.gz"], d))

class TestRead(unittest.TestCase):
    def setUp(self):
        self.orbit = read_sp3(FX / "sample.sp3")

    def test_structure(self):
        o = self.orbit
        self.assertEqual(o.time_system, "GPS")
        self.assertEqual(len(o.epochs), 24)
        self.assertEqual(o.epochs[1] - o.epochs[0], timedelta(minutes=15))
        self.assertEqual(set(o.positions), {16, 22})
        self.assertIsNone(o.positions[22][2])
        for prn, pos in o.positions.items():
            for k, p in enumerate(pos):
                if (prn, k) != (22, 2):
                    self.assertTrue(25000 < math.hypot(*p) < 27500)

    def test_gz_same_as_plain(self):
        with tempfile.TemporaryDirectory() as d:
            gz = Path(d) / "sample.sp3.gz"
            gz.write_bytes(gzip.compress((FX / "sample.sp3").read_bytes()))
            self.assertEqual(read_sp3(gz), self.orbit)

    def test_non_gps_time_system_rejected(self):
        lines = (FX / "sample.sp3").read_text().splitlines(keepends=True)
        i = next(k for k, l in enumerate(lines) if l.startswith("%c"))
        lines[i] = lines[i].replace(" GPS ", " UTC ", 1)
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "utc.sp3"
            p.write_text("".join(lines))
            with self.assertRaises(Sp3FormatError):
                read_sp3(p)

    def test_prns_with_data(self):
        self.assertEqual(prns_with_data(self.orbit), {16, 22})

class TestInterpolate(unittest.TestCase):
    def setUp(self):
        self.orbit = read_sp3(FX / "sample.sp3")

    def test_exact_epoch_returns_stored(self):
        for k in (0, 10, 23):
            self.assertEqual(interpolate(self.orbit, 16, self.orbit.epochs[k]), self.orbit.positions[16][k])

    def test_30min_data_predicts_15min_point(self):
        o = self.orbit
        half = Sp3Orbit(o.time_system, o.epochs[::2], {16: o.positions[16][::2]})
        for j in (9, 11, 13):
            got = interpolate(half, 16, o.epochs[j])
            self.assertLess(math.dist(got, o.positions[16][j]), 0.001)   # < 1 m

    def test_none_near_edges(self):
        o = self.orbit
        self.assertIsNone(interpolate(o, 16, o.epochs[1] + timedelta(minutes=7.5)))
        self.assertIsNone(interpolate(o, 16, o.epochs[-1] - timedelta(minutes=7.5)))

    def test_none_when_window_has_gap(self):
        o = self.orbit   # PG22 ไม่มีข้อมูลที่ epoch 2
        self.assertIsNone(interpolate(o, 22, o.epochs[5] + timedelta(minutes=7.5)))
        self.assertIsNotNone(interpolate(o, 22, o.epochs[12] + timedelta(minutes=7.5)))


def _sat_ids(lines: list[str]) -> list[list[str]]:
    """รหัสดาวที่อยู่ในแต่ละบรรทัด '+' (ตัดช่องว่างที่เติมด้วย '  0' ออก)"""
    plus = [l for l in lines if l.startswith("+") and not l.startswith("++")]
    return [[i for i in (l[9 + 3 * k:12 + 3 * k] for k in range(17)) if i.strip() != "0"] for l in plus]


class TestReadAll(unittest.TestCase):
    def test_read_all_systems(self):
        d = read_sp3_all(FXS / "mgx_sample.sp3")
        self.assertEqual(set(d), {"C19", "C38", "E11", "G01", "R05"})
        self.assertEqual(len(d["E11"]), 37)
        self.assertEqual(min(d["G01"]), datetime(2026, 11, 9, tzinfo=timezone.utc))

    def test_header_counts_not_trusted(self):
        d = read_sp3_all(FXS / "mgx_sample.sp3")      # header บอก 289 epoch 119 ดวง แต่เนื้อไฟล์ 37 × 5
        self.assertEqual({len(v) for v in d.values()}, {37})
        self.assertEqual(max(d["G01"]), datetime(2026, 11, 9, 3, tzinfo=timezone.utc))

    def test_values_in_km(self):
        d = read_sp3_all(FXS / "mgx_sample.sp3")
        self.assertEqual(d["G01"][datetime(2026, 11, 9, tzinfo=timezone.utc)], (14825.366872, -13665.223306, 17225.758431))

    def test_gz_same_as_plain(self):
        with tempfile.TemporaryDirectory() as d:
            gz = Path(d) / "mgx.sp3.gz"
            gz.write_bytes(gzip.compress((FXS / "mgx_sample.sp3").read_bytes()))
            self.assertEqual(read_sp3_all(gz), read_sp3_all(FXS / "mgx_sample.sp3"))

    def test_skips_zero_and_sentinel_positions(self):
        lines = (FXS / "mgx_sample.sp3").read_text().splitlines(keepends=True)
        first = next(k for k, l in enumerate(lines) if l.startswith("*"))
        second = next(k for k, l in enumerate(lines) if l.startswith("*") and k > first)
        third = next(k for k, l in enumerate(lines) if l.startswith("*") and k > second)
        for k in range(first, second):
            if lines[k].startswith("PG01"):
                lines[k] = "PG01" + "%14.6f" * 4 % (0.0, 0.0, 0.0, 999999.999999) + "\n"
        for k in range(second, third):
            if lines[k].startswith("PR05"):
                lines[k] = "PR05" + "%14.6f" * 4 % (999999.999999, 1.0, 2.0, 5.0) + "\n"
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "bad.sp3"
            p.write_text("".join(lines))
            got = read_sp3_all(p)
        t0 = datetime(2026, 11, 9, tzinfo=timezone.utc)
        self.assertNotIn(t0, got["G01"])
        self.assertEqual(len(got["G01"]), 36)
        self.assertNotIn(t0 + timedelta(minutes=5), got["R05"])
        self.assertEqual(len(got["R05"]), 36)
        self.assertEqual(len(got["E11"]), 37)

    def test_non_gps_time_system_rejected(self):
        lines = (FXS / "mgx_sample.sp3").read_text().splitlines(keepends=True)
        i = next(k for k, l in enumerate(lines) if l.startswith("%c"))
        lines[i] = lines[i].replace(" GPS ", " UTC ", 1)
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "utc.sp3"
            p.write_text("".join(lines))
            with self.assertRaises(Sp3FormatError):
                read_sp3_all(p)

    def test_truncated_gz_is_format_error(self):
        data = gzip.compress((FXS / "mgx_sample.sp3").read_bytes())
        with tempfile.TemporaryDirectory() as d:
            gz = Path(d) / "COD0MGXFIN_20263130000_01D_05M_ORB.SP3.gz"
            gz.write_bytes(data[:len(data) // 2])                    # ดาวน์โหลดไม่ครบ: EOFError จาก gzip
            for reader in (read_sp3_all, read_sp3):
                with self.subTest(reader=reader.__name__):
                    with self.assertRaises(Sp3FormatError) as ctx:
                        reader(gz)
                    self.assertIn(str(gz), str(ctx.exception))

    def test_html_saved_as_gz_is_format_error(self):
        with tempfile.TemporaryDirectory() as d:
            gz = Path(d) / "COD0MGXFIN_20263130000_01D_05M_ORB.SP3.gz"
            gz.write_bytes(b"<!DOCTYPE html>\n<html><body>Earthdata Login</body></html>\n")   # gzip.BadGzipFile
            for reader in (read_sp3_all, read_sp3):
                with self.subTest(reader=reader.__name__):
                    with self.assertRaises(Sp3FormatError) as ctx:
                        reader(gz)
                    self.assertIn(str(gz), str(ctx.exception))

    def test_malformed_position_line_rejected(self):
        lines = (FXS / "mgx_sample.sp3").read_text().splitlines(keepends=True)
        i = next(k for k, l in enumerate(lines) if l.startswith("PG01"))
        lines[i] = "PG01   not-a-number\n"
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "bad.sp3"
            p.write_text("".join(lines))
            with self.assertRaises(Sp3FormatError):
                read_sp3_all(p)


class TestWrite(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.p = Path(self._tmp.name) / "predicted.sp3"
        self.t0 = datetime(2026, 11, 10, tzinfo=timezone.utc)
        self.times = [self.t0 + timedelta(seconds=30 * k) for k in range(3)]

    def test_write_then_read_round_trip(self):
        p, times = self.p, self.times
        pos = {"G01": [(15000.1234567, -20000.5, 5000.25)] * 3, "R10": [(1.0, 2.0, 25000.0)] * 3}
        write_sp3(times, pos, p)
        d = read_sp3_all(p)
        self.assertEqual(sorted(d["G01"]), [t + timedelta(seconds=18) for t in times])
        self.assertAlmostEqual(d["G01"][times[0] + timedelta(seconds=18)][0], 15000.1234567, delta=0.0005)
        self.assertEqual(d["R10"][times[2] + timedelta(seconds=18)], (1.0, 2.0, 25000.0))
        l0 = p.read_text().splitlines()[0]
        self.assertEqual((l0[:3], l0[46:51].strip(), l0[52:55], l0[56:60]), ("#dP", "ITRF", "EXT", "GSTD"))
        self.assertEqual(int(l0[32:39]), 3)

    def test_header_lines(self):
        write_sp3(self.times, {"G01": [(1.0, 2.0, 3.0)] * 3}, self.p, agency="ABCDEFG")
        lines = self.p.read_text().splitlines()
        self.assertEqual(lines[0][:31], "#dP2026 11 10  0  0 18.00000000")
        self.assertEqual(lines[0][40:45], "TLE  ")
        self.assertEqual(lines[0][56:60], "ABCD")                         # agency ยาวเกินถูกตัดที่ 4 ตัว
        # 2026-11-10 เป็นวันอังคารของ GPS week 2444 → 2 วัน + 18 วินาที, MJD 61354
        self.assertEqual(lines[1], "## 2444 172818.00000000    30.00000000 61354 0.0002083333333".ljust(80))
        self.assertEqual(lines[-1].strip(), "EOF")
        c = [l for l in lines if l.startswith("%c")]
        self.assertEqual(len(c), 2)
        self.assertEqual(c[0][:12], "%c M  cc GPS")
        self.assertEqual(len([l for l in lines if l.startswith("%f")]), 2)
        self.assertEqual(len([l for l in lines if l.startswith("%i")]), 2)
        comments = [l for l in lines if l.startswith("/*")]
        self.assertIn("GNSS Studio predicted orbit from TLE/SGP4 (GMAT)", comments[0])

    def test_epoch_and_position_lines(self):
        write_sp3(self.times, {"G01": [(15000.1234567, -20000.5, 5000.25)] * 3}, self.p)
        lines = self.p.read_text().splitlines()
        epochs = [l for l in lines if l.startswith("*")]
        self.assertEqual(epochs[1].rstrip(), "*  2026 11 10  0  0 48.00000000")
        self.assertEqual(lines[lines.index(epochs[0]) + 1],
                         "PG01  15000.123457 -20000.500000   5000.250000 999999.999999".ljust(80))

    def test_write_sat_list_17_per_line(self):
        prns = [f"G{n:02d}" for n in range(1, 21)]
        write_sp3(self.times, {prn: [(1.0, 2.0, 3.0)] * 3 for prn in reversed(prns)}, self.p)
        lines = self.p.read_text().splitlines()
        ids = _sat_ids(lines)
        self.assertEqual([len(x) for x in ids], [17, 3, 0, 0, 0])      # SP3-d มีบรรทัด '+' อย่างน้อย 5 บรรทัด
        self.assertEqual(ids[0] + ids[1], prns)
        plus = [l for l in lines if l.startswith("+") and not l.startswith("++")]
        self.assertEqual(int(plus[0][3:6]), 20)
        accuracy = [l for l in lines if l.startswith("++")]
        self.assertEqual(len(accuracy), len(plus))
        self.assertTrue(all(l[9:60] == "  0" * 17 for l in accuracy))

    def test_more_than_five_sat_lines(self):
        prns = [f"G{n:02d}" for n in range(1, 32)] + [f"E{n:02d}" for n in range(1, 31)]   # 61 ดวง → 4 บรรทัด ต้องเติมเป็น 5
        write_sp3(self.times, {prn: [(1.0, 2.0, 3.0)] * 3 for prn in prns}, self.p)
        ids = _sat_ids(self.p.read_text().splitlines())
        self.assertEqual([len(x) for x in ids], [17, 17, 17, 10, 0])
        self.assertEqual(sorted(sum(ids, [])), sorted(prns))

    def test_reject_length_mismatch(self):
        with self.assertRaises(ValueError):
            write_sp3(self.times, {"G01": [(1.0, 2.0, 3.0)] * 2}, self.p)

    def test_reject_empty_times(self):
        with self.assertRaises(ValueError):
            write_sp3([], {}, self.p)


class TestLagrangeAt(unittest.TestCase):
    T0 = datetime(2026, 11, 9, tzinfo=timezone.utc)

    @staticmethod
    def _poly(u: float) -> tuple[float, float, float]:
        return (1 + 2 * u - 3 * u**2 + 0.5 * u**3 + u**4 - 0.1 * u**5,
                -4 + u + 2 * u**2 - u**5,
                7 - 0.5 * u**3 + 0.25 * u**4)

    def _series(self, n: int = 20, step_s: int = 300):
        return {self.T0 + timedelta(seconds=step_s * k): self._poly(step_s * k / 3000) for k in range(n)}

    def test_lagrange_at_reproduces_polynomial(self):
        series = self._series()
        for secs in (2850, 2851.5, 1500 + 7, 3000 + 150):
            got = lagrange_at(series, self.T0 + timedelta(seconds=secs))
            want = self._poly(secs / 3000)
            for g, w in zip(got, want):
                self.assertAlmostEqual(g, w, delta=1e-9)

    def test_lagrange_at_exact_epoch_returns_stored(self):
        series = self._series()
        t = self.T0 + timedelta(seconds=300 * 10)
        self.assertEqual(lagrange_at(series, t), series[t])

    def test_lagrange_at_edges_none(self):
        series = self._series()                     # 20 จุด ดัชนี 0..19
        at = lambda k: self.T0 + timedelta(seconds=300 * k)
        self.assertIsNone(lagrange_at(series, self.T0 - timedelta(seconds=10)))
        self.assertIsNone(lagrange_at(series, at(0.5)))
        self.assertIsNone(lagrange_at(series, at(3.5)))         # ก่อนหน้ามี 4 จุด
        self.assertIsNotNone(lagrange_at(series, at(4.5)))      # ก่อนหน้ามี 5 จุดพอดี
        self.assertIsNotNone(lagrange_at(series, at(14.5)))     # หลังมี 5 จุดพอดี
        self.assertIsNone(lagrange_at(series, at(15.5)))        # หลังมี 4 จุด
        self.assertIsNone(lagrange_at(series, at(19) + timedelta(seconds=10)))
        self.assertIsNone(lagrange_at({}, self.T0))

    def test_lagrange_at_with_presorted_times_matches_default(self):
        series = self._series()
        times = sorted(series)
        at = lambda k: self.T0 + timedelta(seconds=300 * k)
        # ตรงกับ epoch, ระหว่าง epoch, และนอกขอบที่ต้องได้ None เหมือนกัน
        for t in (at(10), at(4.5), at(9.37), at(14.5), at(0), at(0.5), at(3.5), at(15.5), at(19)):
            with self.subTest(t=t):
                self.assertEqual(lagrange_at(series, t, times=times), lagrange_at(series, t))
        self.assertIsNotNone(lagrange_at(series, at(9.37), times=times))
        self.assertIsNone(lagrange_at(series, at(0.5), times=times))
        self.assertEqual(lagrange_at(series, at(10), times=times), series[at(10)])
        self.assertEqual(lagrange_at(series, at(7.5), 3, times=times), lagrange_at(series, at(7.5), 3))

    def test_lagrange_at_with_presorted_times_does_not_sort_again(self):
        series = self._series()
        times = sorted(series)
        t = self.T0 + timedelta(seconds=300 * 9.37)
        with mock.patch("gnss_predict.sp3.sorted", create=True, side_effect=AssertionError("sorted ถูกเรียก")):
            self.assertIsNotNone(lagrange_at(series, t, times=times))
        with mock.patch("gnss_predict.sp3.sorted", create=True, side_effect=sorted) as spy:
            lagrange_at(series, t)                  # ไม่ส่ง times ต้องเรียงเองหนึ่งครั้ง
        spy.assert_called_once_with(series)

    def test_lagrange_at_with_presorted_times_still_respects_holes(self):
        at = lambda k: self.T0 + timedelta(seconds=300 * k)
        full = self._series(50)
        series = {t: p for k, (t, p) in enumerate(full.items()) if not 15 <= k <= 30}
        times = sorted(series)
        for t in (at(31.5), at(20.5), at(14.5), at(8.5), at(40.5)):
            with self.subTest(t=t):
                self.assertEqual(lagrange_at(series, t, times=times), lagrange_at(series, t))

    def test_lagrange_at_pins_first_key(self):
        series = self._series()
        first = min(series)
        self.assertEqual(lagrange_at(series, first), series[first])        # t ตรงกับจุดแรกพอดี คืนค่าที่เก็บไว้
        self.assertIsNone(lagrange_at(series, first + timedelta(seconds=1)))

    def test_lagrange_at_none_across_hole(self):
        at = lambda k: self.T0 + timedelta(seconds=300 * k)
        full = self._series(50)
        series = {t: p for k, (t, p) in enumerate(full.items()) if not 15 <= k <= 30}   # ลบ epoch ตรงกลาง 16 จุด
        self.assertIsNone(lagrange_at(series, at(31.5)))      # จุดก่อนหน้า 4 จุดมาจาก 4.5 ชม. ก่อน
        self.assertIsNone(lagrange_at(series, at(20.5)))      # t อยู่ในช่องว่างเอง
        self.assertIsNone(lagrange_at(series, at(14.5)))      # หน้าต่างคร่อมช่องว่าง
        self.assertIsNotNone(lagrange_at(series, at(8.5)))    # ช่องว่างอยู่นอกหน้าต่าง ยังใช้ได้
        self.assertIsNotNone(lagrange_at(series, at(40.5)))   # หลังช่องว่าง กลับมาใช้ได้เมื่อมีจุดครบ
        want = self._poly(300 * 8.5 / 3000)
        for g, w in zip(lagrange_at(series, at(8.5)), want):
            self.assertAlmostEqual(g, w, delta=1e-9)

    def test_lagrange_at_none_when_one_epoch_missing(self):
        at = lambda k: self.T0 + timedelta(seconds=300 * k)
        series = self._series()
        del series[at(8)]                                      # ระยะห่าง 600 s เทียบ 300 s เกิน 1.5 เท่า
        self.assertIsNone(lagrange_at(series, at(9.5)))
        self.assertIsNotNone(lagrange_at(series, at(14.5)))    # หน้าต่าง 10..19 ไม่มีช่องว่าง

    def test_lagrange_at_half_window(self):
        at = lambda k: self.T0 + timedelta(seconds=300 * k)
        cubic = lambda u: (1 + 2 * u - u**2 + 0.5 * u**3, u**3, -u)
        series = {at(k): cubic(k / 10) for k in range(10)}
        self.assertIsNone(lagrange_at(series, at(1.5), half_window=3))
        got = lagrange_at(series, at(1.5), half_window=2)               # 4 จุดพอดีกับพหุนามดีกรี 3
        for g, w in zip(got, cubic(0.15)):
            self.assertAlmostEqual(g, w, delta=1e-9)
        with self.assertRaises(ValueError):
            lagrange_at(series, at(1.5), half_window=0)


class TestMgxName(unittest.TestCase):
    def test_choose_mgx_prefers_cod(self):
        d = date(2026, 10, 18)                       # DOY 291
        names = ["WUM0MGXRAP_20262910000_01D_05M_ORB.SP3.gz", "COD0MGXFIN_20262910000_01D_05M_ORB.SP3.gz",
                 "GFZ0MGXRAP_20262910000_01D_05M_ORB.SP3.gz"]
        self.assertEqual(choose_mgx_sp3_name(names, d), names[1])
        self.assertEqual(choose_mgx_sp3_name(names[::2], d), names[2])
        self.assertIsNone(choose_mgx_sp3_name(names, date(2026, 10, 19)))

    def test_choose_mgx_ignores_other_products(self):
        d = date(2026, 10, 18)
        names = ["COD0MGXFIN_20262910000_01D_05M_ORB.SP3.gz.md5", "COD0MGXFIN_20262910000_01D_30S_CLK.CLK.gz",
                 "IGS0OPSFIN_20262910000_01D_15M_ORB.SP3.gz", "WUM0MGXRAP_20262910000_01D_05M_ORB.SP3.gz"]
        self.assertEqual(choose_mgx_sp3_name(names, d), names[3])
        self.assertIsNone(choose_mgx_sp3_name([], d))


class TestFetchMgx(unittest.TestCase):
    DAY = date(2026, 11, 9)                          # DOY 313

    @staticmethod
    def name(prefix: str, doy: int = 313) -> str:
        return f"{prefix}_2026{doy:03d}0000_01D_05M_ORB.SP3.gz"

    def test_cached_file_used_without_listing(self):
        # ตรวจซ้ำแบบไม่มีเน็ตได้ถ้ามี SP3 ของวันนั้นใน cache แล้ว: ไม่เรียก curl เลย เลือกตามลำดับ MGX_SP3_PREFERENCE
        with tempfile.TemporaryDirectory() as d, \
                mock.patch("gnss_predict.sp3.subprocess.run", side_effect=AssertionError("ไม่ควรเรียก curl")) as run:
            cache = Path(d)
            for name in (self.name("WUM0MGXRAP"), self.name("GFZ0MGXRAP"), self.name("COD0MGXFIN", 314),
                         self.name("COD0MGXFIN") + ".part"):
                (cache / name).write_bytes(b"sp3")
            self.assertEqual(fetch_mgx_sp3(self.DAY, cache), cache / self.name("GFZ0MGXRAP"))
            (cache / self.name("COD0MGXFIN")).write_bytes(b"sp3")
            self.assertEqual(fetch_mgx_sp3(self.DAY, cache), cache / self.name("COD0MGXFIN"))
            run.assert_not_called()

    def test_lists_cddis_when_nothing_cached(self):
        failed = subprocess.CompletedProcess([], 7, "", "")
        with tempfile.TemporaryDirectory() as d, \
                mock.patch("gnss_predict.sp3.subprocess.run", return_value=failed) as run:
            (Path(d) / self.name("COD0MGXFIN", 314)).write_bytes(b"sp3")          # ของวันอื่นไม่นับ
            with self.assertRaises(Sp3UnavailableError):
                fetch_mgx_sp3(self.DAY, Path(d))
        self.assertIn("--list-only", run.call_args.args[0])


if __name__ == "__main__":
    unittest.main()
