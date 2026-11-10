import gzip
import math
import subprocess
import tempfile
import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

from gnss_predict.brdc import BroadcastStatus, Nav, broadcast_status, fetch_brdc, position_km, read_nav
from gnss_predict.config import BDS_GEO_PRNS
from gnss_predict.errors import BrdcUnavailableError
from gnss_predict.sp3 import read_sp3_all

FXS = Path(__file__).parent / "fixtures" / "studio"
NAV = FXS / "snapshot" / "brdc" / "BRDC00IGS_R_20263130000_01D_MN.rnx"
T0 = datetime(2026, 11, 9, tzinfo=timezone.utc)      # GPST


def load_blocks() -> tuple[list[str], list[list[str]]]:
    """แยกไฟล์ fixture เป็น header และ record (บรรทัดแรกของ record ขึ้นต้นด้วยรหัสดาว)"""
    lines = NAV.read_text().splitlines()
    end = next(i for i, line in enumerate(lines) if "END OF HEADER" in line) + 1
    blocks: list[list[str]] = []
    for line in lines[end:]:
        if line[0] != " ":
            blocks.append([])
        blocks[-1].append(line)
    return lines[:end], blocks


def blocks_of(blocks: list[list[str]], prn: str) -> list[list[str]]:
    return [b for b in blocks if b[0].startswith(prn)]


def set_field(line: str, k: int, value: float) -> str:
    """แทนค่าช่องที่ k (เริ่มที่ 0) ของบรรทัดต่อ: คอลัมน์ [4+19k : 23+19k]"""
    line = line.ljust(80)
    return line[:4 + 19 * k] + f"{value:19.12E}" + line[23 + 19 * k:]


def write_nav(tmp: str, header: list[str], blocks: list[list[str]], name: str = "mini.rnx") -> Path:
    path = Path(tmp) / name
    path.write_text("\n".join(header + [line for b in blocks for line in b]) + "\n")
    return path


class TestPositions(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.nav = read_nav(NAV)
        cls.truth = read_sp3_all(FXS / "mgx_sample.sp3")

    def test_meo_igso_match_sp3(self):                 # ค่าจริง: GFZ0MGXRAP 2026-11-09
        for prn in ("C19", "C38", "E11"):
            self.assertGreater(len(self.truth[prn]), 30, prn)
            for t, ref in self.truth[prn].items():
                p = position_km(self.nav, prn, t)
                self.assertLessEqual(math.dist(p, ref), 0.010, (prn, t))

    def test_gps_matches_sp3(self):
        for t, ref in self.truth["G01"].items():
            p = position_km(self.nav, "G01", t)
            self.assertLessEqual(math.dist(p, ref), 0.010, t)

    def test_geo_physical_properties(self):            # MGEX SP3 ไม่มี BDS GEO
        pts = [position_km(self.nav, "C01", T0 + timedelta(minutes=5 * k)) for k in range(288)]
        r = [math.dist(p, (0, 0, 0)) for p in pts]
        lat = [math.degrees(math.asin(p[2] / math.dist(p, (0, 0, 0)))) for p in pts]
        lon = [math.degrees(math.atan2(p[1], p[0])) for p in pts]
        self.assertTrue(all(abs(x - 42164) <= 50 for x in r))
        self.assertLessEqual(abs(sum(lat) / len(lat)), 0.5)
        self.assertLessEqual(max(lon) - min(lon), 0.5)

    def test_bds_geo_prns(self):
        self.assertEqual(sorted(BDS_GEO_PRNS), ["C01", "C02", "C03", "C04", "C05", "C59", "C60", "C61", "C62", "C63"])

    def test_none_far_from_toe_and_for_glonass(self):
        self.assertIsNone(position_km(self.nav, "C19", T0 + timedelta(days=3)))
        self.assertIsNone(position_km(self.nav, "R05", T0))

    def test_none_for_unknown_prn(self):
        self.assertIsNone(position_km(self.nav, "G22", T0))
        self.assertIsNone(position_km(self.nav, "C99", T0))

    def test_none_when_file_ends_before_t(self):       # E11 และ E14 มี record ถึง toe 04:00 เท่านั้น
        self.assertIsNotNone(position_km(self.nav, "E11", T0 + timedelta(hours=4)))
        self.assertIsNone(position_km(self.nav, "E11", T0 + timedelta(hours=12)))

    def test_tk_limit_is_four_hours_inclusive(self):
        # record สุดท้ายของ C19 มี toe = 23:00:00 BDT = 23:00:14 GPST และไม่มี record ที่ใกล้กว่านี้
        toe_gpst = datetime(2026, 11, 9, 23, 0, 14, tzinfo=timezone.utc)
        self.assertIsNotNone(position_km(self.nav, "C19", toe_gpst + timedelta(seconds=14400)))
        self.assertIsNone(position_km(self.nav, "C19", toe_gpst + timedelta(seconds=14401)))


class TestStatus(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.nav = read_nav(NAV)
        cls.header, cls.blocks = load_blocks()

    def test_health_from_real_records(self):
        st = broadcast_status(self.nav)
        self.assertFalse(st["E14"].healthy); self.assertFalse(st["R13"].healthy)
        self.assertTrue(st["E11"].healthy); self.assertTrue(st["R05"].healthy); self.assertTrue(st["G01"].healthy)
        self.assertNotIn("G22", st)

    def test_systems_and_last_toc(self):
        st = broadcast_status(self.nav)
        self.assertEqual(set(st), {"G01", "R05", "R13", "C01", "C09", "C19", "C38", "C40", "E11", "E14"})
        self.assertEqual(st["E14"], BroadcastStatus("E14", datetime(2026, 11, 9, 4, 0, tzinfo=timezone.utc), False))
        self.assertEqual(st["R13"].last_toc, datetime(2026, 11, 9, 23, 45, tzinfo=timezone.utc))
        self.assertEqual(st["G01"].last_toc, datetime(2026, 11, 10, 0, 0, tzinfo=timezone.utc))
        self.assertEqual(st["C19"].last_toc, datetime(2026, 11, 9, 23, 0, tzinfo=timezone.utc))

    def test_health_g_and_c_from_field_positions(self):
        # ช่องที่ 2 (คอลัมน์ 24–42) ของ BROADCAST ORBIT - 6 = บรรทัดที่ 7 ของ record
        blocks = [list(blocks_of(self.blocks, p)[-1]) for p in ("G01", "C19", "C01")]
        for b in blocks[:2]:
            b[6] = set_field(b[6], 1, 1.0)
        with tempfile.TemporaryDirectory() as d:
            st = broadcast_status(read_nav(write_nav(d, self.header, blocks)))
        self.assertFalse(st["G01"].healthy)
        self.assertFalse(st["C19"].healthy)
        self.assertTrue(st["C01"].healthy)

    def test_health_r_from_fourth_field_of_orbit_1(self):
        b = list(blocks_of(self.blocks, "R05")[-1])
        b[1] = set_field(b[1], 3, 1.0)
        with tempfile.TemporaryDirectory() as d:
            st = broadcast_status(read_nav(write_nav(d, self.header, [b])))
        self.assertFalse(st["R05"].healthy)

    def test_only_record_at_latest_toc_counts(self):
        recs = [list(b) for b in blocks_of(self.blocks, "G01")[-2:]]       # toc 22:00 แล้ว 00:00 ของวันถัดไป
        self.assertNotEqual(recs[0][0], recs[1][0])
        old_bad = [list(recs[0]), list(recs[1])]
        old_bad[0][6] = set_field(old_bad[0][6], 1, 63.0)
        new_bad = [list(recs[0]), list(recs[1])]
        new_bad[1][6] = set_field(new_bad[1][6], 1, 63.0)
        with tempfile.TemporaryDirectory() as d:
            self.assertTrue(broadcast_status(read_nav(write_nav(d, self.header, old_bad, "a.rnx")))["G01"].healthy)
            self.assertFalse(broadcast_status(read_nav(write_nav(d, self.header, new_bad, "b.rnx")))["G01"].healthy)

    def test_any_record_at_latest_toc_unhealthy_means_unhealthy(self):
        # D14: Galileo มี record I/NAV และ F/NAV ที่ toc เดียวกัน
        last = [list(b) for b in blocks_of(self.blocks, "E11") if b[0][4:23] == "2026 11 09 04 00 00"]
        self.assertGreaterEqual(len(last), 2)
        with tempfile.TemporaryDirectory() as d:
            self.assertTrue(broadcast_status(read_nav(write_nav(d, self.header, last, "ok.rnx")))["E11"].healthy)
            last[0][6] = set_field(last[0][6], 1, 130.0)
            st = broadcast_status(read_nav(write_nav(d, self.header, last, "bad.rnx")))
        self.assertFalse(st["E11"].healthy)


class TestReadNav(unittest.TestCase):
    def setUp(self):
        self.header, self.blocks = load_blocks()

    def test_record_counts_and_epochs(self):
        nav = read_nav(NAV)
        self.assertIsInstance(nav, Nav)
        self.assertEqual({p: len(r) for p, r in nav.records.items()},
                         {"C01": 24, "C09": 24, "C19": 24, "C38": 24, "C40": 24, "E11": 72, "E14": 52,
                          "G01": 14, "R05": 49, "R13": 49})
        first = nav.records["R05"][0].toc
        self.assertEqual(first, datetime(2026, 11, 8, 23, 45, tzinfo=timezone.utc))
        self.assertIs(first.tzinfo, timezone.utc)

    def test_gzip_gives_same_result(self):
        with tempfile.TemporaryDirectory() as d:
            gz = Path(d) / "BRDC00IGS_R_20263130000_01D_MN.rnx.gz"
            gz.write_bytes(gzip.compress(NAV.read_bytes()))
            self.assertEqual(read_nav(gz).records, read_nav(NAV).records)

    def test_blank_fields_are_zero_and_d_exponent(self):
        nav = read_nav(NAV)
        c19_first = nav.records["C19"][0]
        self.assertEqual(len(c19_first.fields), 3 + 4 * 7)
        self.assertEqual(c19_first.fields[-1], 0.0)                 # ช่องท้ายของ ORBIT-7 ว่างหรือ 0
        self.assertEqual(c19_first.fields[22], 0.0)                 # ช่อง flag ของ ORBIT-5 ที่บรรทัดสั้น
        d_exp = list(self.blocks[0])
        d_exp[1] = d_exp[1].replace("E+02", "D+02", 1)
        with tempfile.TemporaryDirectory() as d:
            got = read_nav(write_nav(d, self.header, [d_exp]))
        self.assertEqual(got.records["G01"][0].fields[3], nav.records["G01"][0].fields[3])

    def test_glonass_record_has_four_lines(self):
        r = read_nav(NAV).records["R05"][0]
        self.assertEqual(len(r.fields), 3 + 4 * 3)
        self.assertEqual(r.fields[3], 1.050516894531E+04)

    def test_truncated_last_record_is_dropped(self):
        blocks = [list(blocks_of(self.blocks, "G01")[0]), list(blocks_of(self.blocks, "C19")[0])[:5]]
        with tempfile.TemporaryDirectory() as d:
            nav = read_nav(write_nav(d, self.header, blocks))
        self.assertEqual(set(nav.records), {"G01"})

    def test_unknown_system_record_is_skipped(self):
        blocks = [["X07 2026 11 09 00 00 00 1.0E+00 2.0E+00 3.0E+00", "     1.0E+00 2.0E+00 3.0E+00 4.0E+00"],
                  list(blocks_of(self.blocks, "G01")[0])]
        with tempfile.TemporaryDirectory() as d:
            nav = read_nav(write_nav(d, self.header, blocks))
        self.assertEqual(set(nav.records), {"G01"})

    def test_bad_inputs_raise_brdc_unavailable(self):
        with tempfile.TemporaryDirectory() as d:
            d = Path(d)
            with self.assertRaises(BrdcUnavailableError):
                read_nav(d / "missing.rnx")
            v2 = [self.header[0].replace("3.04", "2.11")] + self.header[1:]
            with self.assertRaises(BrdcUnavailableError):
                read_nav(write_nav(str(d), v2, self.blocks[:1], "v2.rnx"))
            with self.assertRaises(BrdcUnavailableError):
                read_nav(write_nav(str(d), self.header[:-1], self.blocks[:1], "noend.rnx"))
            with self.assertRaises(BrdcUnavailableError):                      # header อย่างเดียว ไม่มี record
                read_nav(write_nav(str(d), self.header, [], "empty.rnx"))
            bad = list(self.blocks[0])
            bad[2] = bad[2][:4] + "not-a-number" + bad[2][16:]
            with self.assertRaises(BrdcUnavailableError):
                read_nav(write_nav(str(d), self.header, [bad], "bad.rnx"))
            (d / "trunc.rnx.gz").write_bytes(gzip.compress(NAV.read_bytes())[:200])
            with self.assertRaises(BrdcUnavailableError):
                read_nav(d / "trunc.rnx.gz")
            flipped = bytearray(gzip.compress(NAV.read_bytes()))               # ไฟล์ gzip เสียกลางทาง: zlib.error
            for k in range(40, 60):
                flipped[k] ^= 0xFF
            (d / "flipped.rnx.gz").write_bytes(bytes(flipped))
            with self.assertRaises(BrdcUnavailableError):
                read_nav(d / "flipped.rnx.gz")


class TestFetch(unittest.TestCase):
    """ไม่ใช้เน็ต: แทน subprocess.run ด้วยของปลอม"""

    def test_downloads_expected_file_name_from_year_directory(self):
        calls = []

        def fake_run(cmd, **kw):
            calls.append(cmd)
            Path(cmd[cmd.index("-o") + 1]).write_bytes(b"gz")
            return subprocess.CompletedProcess(cmd, 0)

        with tempfile.TemporaryDirectory() as d, mock.patch("gnss_predict.brdc.subprocess.run", fake_run):
            got = fetch_brdc(date(2026, 11, 9), Path(d) / "sub")
            self.assertEqual(got, Path(d) / "sub" / "BRDC00IGS_R_20263130000_01D_MN.rnx.gz")
            self.assertEqual(got.read_bytes(), b"gz")
            self.assertFalse(list(got.parent.glob("*.part")))
            fetch_brdc(date(2026, 11, 9), Path(d) / "sub")                    # มีแล้วไม่โหลดซ้ำ
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][-1],
                         "ftp://gdc.cddis.eosdis.nasa.gov/gnss/data/daily/2026/brdc/BRDC00IGS_R_20263130000_01D_MN.rnx.gz")

    def test_failure_raises_and_leaves_no_partial_file(self):
        def fake_run(cmd, **kw):
            Path(cmd[cmd.index("-o") + 1]).write_bytes(b"")
            return subprocess.CompletedProcess(cmd, 78)

        with tempfile.TemporaryDirectory() as d, mock.patch("gnss_predict.brdc.subprocess.run", fake_run):
            with self.assertRaises(BrdcUnavailableError):
                fetch_brdc(date(2026, 11, 9), Path(d))
            self.assertEqual(list(Path(d).iterdir()), [])


if __name__ == "__main__":
    unittest.main()
