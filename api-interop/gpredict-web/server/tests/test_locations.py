"""รายชื่อเมืองและสถานีอากาศที่สร้างจาก nsd_cccc.txt ของ NOAA (ref-D §3, spec งานย่อย 4 §4.3)
test ใช้ fixture 10 บรรทัดจริงของไฟล์นั้น (fixtures/nsd_cccc_sample.txt) ไม่ใช้เน็ต และไม่แตะ locations.dat ของ Gpredict"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from gpredict_web import locations
from gpredict_web.locations import DATA_FILE, NSD_URL, WMO_REGIONS, nsd_angle, parse_nsd
from tests.test_api import ApiTestBase

SAMPLE = Path(__file__).resolve().parent / "fixtures" / "nsd_cccc_sample.txt"
BUILD_SCRIPT = Path(__file__).resolve().parents[2] / "tools" / "build_locations.py"


def sample_text() -> str:
    # อ่านเป็นไบต์แล้ว decode เอง: ไฟล์จริงของ NOAA ใช้ CRLF ปนกับ LF (read_text จะแปลงให้และบังไม่ให้ test เห็น)
    return SAMPLE.read_bytes().decode("latin-1")


def line(icao="TEST", place="Somewhere", state="", country="Testland", region="2", lat="10-30N", lon="020-15E", elev="25"):
    """บรรทัดรูปแบบเดียวกับไฟล์จริง (14 ช่อง) สำหรับกรณีที่ fixture ไม่มี"""
    return ";".join([icao, "--", "---", place, state, country, region, lat, lon, "", "", elev, "", ""])


class AngleTest(unittest.TestCase):
    def test_angles(self):
        self.assertEqual(nsd_angle("18-47N"), 18 + 47 / 60)
        self.assertAlmostEqual(nsd_angle("098-59E"), 98.9833, places=4)
        self.assertAlmostEqual(nsd_angle("098-58-12E"), 98 + 58 / 60 + 12 / 3600, places=12)
        self.assertEqual(nsd_angle("13-55N"), 13 + 55 / 60)
        self.assertEqual(nsd_angle("00-00E"), 0.0)
        self.assertEqual(nsd_angle("90-00N"), 90.0)

    def test_south_and_west_are_negative(self):
        self.assertEqual(nsd_angle("18-47S"), -(18 + 47 / 60))
        self.assertAlmostEqual(nsd_angle("098-58-12W"), -(98 + 58 / 60 + 12 / 3600), places=12)
        self.assertEqual(str(nsd_angle("00-00S")), "0.0")                  # ศูนย์ไม่กลายเป็น -0.0

    def test_malformed_angles_raise(self):
        for text in ("", "18-47", "18N", "1847N", "18-47X", "18-60N", "18-47-60N", "ab-47N", "18-47-12-3N", "-18-47N", "18-47n"):
            with self.subTest(text=text), self.assertRaises(ValueError):
                nsd_angle(text)


class ParseNsdTest(unittest.TestCase):
    def setUp(self):
        self.rows = parse_nsd(sample_text())
        self.by_icao = {r[6]: r for r in self.rows}

    def test_wmo_regions(self):
        self.assertEqual(WMO_REGIONS, {"1": "Africa", "2": "Asia", "3": "South America", "4": "North and Central America",
                                       "5": "South-West Pacific", "6": "Europe", "7": "Antarctica"})

    def test_parse_sample(self):
        chiang_mai = self.by_icao["VTCC"]
        self.assertEqual(chiang_mai[:3], ["Asia", "Thailand", "Chiang Mai"])
        self.assertAlmostEqual(chiang_mai[3], 18.7833, places=4)
        self.assertAlmostEqual(chiang_mai[4], 98.9833, places=4)
        self.assertEqual(chiang_mai[5:], [312, "VTCC"])                    # ช่อง Station Elevation ของไฟล์จริงคือ 312 (ไม่ใช่ช่อง Upper Air 314)
        self.assertIsInstance(chiang_mai[5], int)
        self.assertEqual(len(self.rows), 9)                                # 10 บรรทัด ข้าม KSTZ ที่ไม่มีพิกัด
        self.assertEqual(sorted(self.by_icao), ["AGGH", "EDDF", "EDHK", "FACT", "KATP", "NZSP", "SAEZ", "VTBS", "VTCC"])

    def test_line_without_coordinates_is_skipped(self):
        # KSTZ ในไฟล์จริงขาดช่อง State: ช่อง Station Latitude/Longitude ตามตำแหน่งจึงว่างหรือผิดแกน
        self.assertNotIn("KSTZ", self.by_icao)
        self.assertIn("KSTZ", sample_text())
        text = "\r\n".join([
            line("NOLL", lat="", lon=""),
            line("NOLA", lat="", lon="020-15E"),
            line("NOLO", lat="10-30N", lon=""),
            line("BADH", lat="35-21E", lon="099-12W"),                     # ตัวอักษรทิศผิดแกน (KCSM ในไฟล์จริง)
            line("NOHM", lat="37-37-02", lon="116-15-51W"),                # ไม่มีตัวอักษรทิศ (KBJN ในไฟล์จริง)
            line("NORG", lat="91-00N", lon="020-15E"),
            line("NORM", lat="10-30N", lon="181-00E"),
            line("GOOD"),
        ])
        self.assertEqual([r[6] for r in parse_nsd(text)], ["GOOD"])

    def test_signs_and_precision(self):
        saez = self.by_icao["SAEZ"]
        self.assertAlmostEqual(saez[3], -(34 + 49 / 60), places=6)
        self.assertAlmostEqual(saez[4], -(58 + 32 / 60), places=6)
        katp = self.by_icao["KATP"]                                        # แบบองศา-ลิปดา-พิลิปดา
        self.assertAlmostEqual(katp[3], 27 + 11 / 60 + 44 / 3600, places=6)
        self.assertAlmostEqual(katp[4], -(90 + 1 / 60 + 37 / 3600), places=6)
        for row in self.rows:
            for value in row[3:5]:
                self.assertEqual(value, round(value, 6))

    def test_missing_elevation_is_zero(self):
        self.assertEqual(self.by_icao["KATP"][5], 0)                       # ช่อง Station Elevation ว่างในไฟล์จริง
        self.assertEqual(self.by_icao["KATP"][:3], ["North and Central America", "United States", "Atlantis"])
        self.assertEqual(parse_nsd(line(elev=""))[0][5], 0)
        self.assertEqual(parse_nsd(line(elev="not a number"))[0][5], 0)
        self.assertEqual(parse_nsd(line(elev="-38"))[0][5], -38)           # ต่ำกว่าระดับน้ำทะเลเป็นลบได้

    def test_continents_from_wmo_region(self):
        self.assertEqual({r[6]: r[0] for r in self.rows},
                         {"FACT": "Africa", "NZSP": "Antarctica", "VTBS": "Asia", "VTCC": "Asia", "EDDF": "Europe",
                          "EDHK": "Europe", "KATP": "North and Central America", "SAEZ": "South America",
                          "AGGH": "South-West Pacific"})
        self.assertEqual(parse_nsd(line(region="9")), [])                  # เลข region ที่ไม่รู้จักถูกข้าม

    def test_missing_region_is_taken_from_the_same_country(self):
        # EDHK (Kiel) ไม่มีช่อง WMO Region ในไฟล์จริง แต่ EDDF ประเทศเดียวกันอยู่ Europe
        self.assertEqual(self.by_icao["EDHK"][:3], ["Europe", "Germany", "Kiel / Holtenau Civilian"])
        text = "\n".join([line("AAAA", country="Mali", region="1"), line("BBBB", country="Mali", region="1"),
                          line("CCCC", country="Mali", region="6"), line("DDDD", country="Mali", region=""),
                          line("EEEE", country="Nowhere", region="")])
        rows = {r[6]: r[0] for r in parse_nsd(text)}
        self.assertEqual(rows["DDDD"], "Africa")                           # region ที่พบมากที่สุดของประเทศ
        self.assertNotIn("EEEE", rows)                                     # ไม่มีประเทศเดียวกันให้อ้างอิง = ข้าม

    def test_sorted_by_continent_country_city(self):
        self.assertEqual([(r[0], r[1], r[2]) for r in self.rows], [
            ("Africa", "South Africa", "Cape Town, Cape Town International Airport"),
            ("Antarctica", "Antarctica", "Amundsen-Scott South Pole Station"),
            ("Asia", "Thailand", "Chiang Mai"),
            ("Asia", "Thailand", "Chon Buri"),
            ("Europe", "Germany", "Frankfurt / M-Flughafen"),
            ("Europe", "Germany", "Kiel / Holtenau Civilian"),
            ("North and Central America", "United States", "Atlantis"),
            ("South America", "Argentina", "Ezeiza Aerodrome"),
            ("South-West Pacific", "Solomon Islands", "Honiara / Henderson")])
        shuffled = "\n".join([line("CCCC", place="banana", country="b"), line("AAAA", place="Cherry", country="B"),
                              line("BBBB", place="apple", country="a")])
        self.assertEqual([r[6] for r in parse_nsd(shuffled)], ["BBBB", "CCCC", "AAAA"])     # ไม่แยกตัวพิมพ์ใหญ่เล็ก, เสมอกันดู ICAO

    def test_text_is_stripped_and_blank_or_short_lines_ignored(self):
        text = "\r\n".join(["", "   ", "too;short", line("TRIM", place="  Padded   Name  ", country=" Testland  "), ""])
        self.assertEqual(parse_nsd(text), [["Asia", "Testland", "Padded Name", 10.5, 20.25, 25, "TRIM"]])
        self.assertEqual(parse_nsd(""), [])
        self.assertEqual(parse_nsd(line("TOOLONG")), [])                   # ICAO ต้องเป็น 4 ตัวอักษร
        self.assertEqual(parse_nsd(line(place="  ")), [])
        self.assertEqual(parse_nsd(line(country="")), [])

    def test_mixed_line_endings(self):
        self.assertEqual(sample_text().count("\r\n"), 8)                   # fixture คือไฟล์จริงที่ CRLF ปนกับ LF
        self.assertEqual(len(parse_nsd(line("AAAA") + "\r\n" + line("BBBB") + "\n" + line("CCCC") + "\r")), 3)


class ApiLocationsTest(ApiTestBase):
    def test_api_locations(self):
        r = self.client.get("/api/locations")
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.headers["content-type"], "application/json")
        body = r.json()
        self.assertEqual(list(body), ["source", "downloaded", "locations"])
        self.assertEqual(body["source"], NSD_URL)
        self.assertRegex(body["downloaded"], r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
        self.assertEqual(body, json.loads(DATA_FILE.read_text(encoding="utf-8")))
        rows = body["locations"]
        self.assertGreater(len(rows), 5000)
        chiang_mai = next(row for row in rows if row[6] == "VTCC")
        self.assertEqual(chiang_mai[:3], ["Asia", "Thailand", "Chiang Mai"])
        self.assertEqual(chiang_mai[5:], [312, "VTCC"])

    def test_every_row_is_well_formed_and_sorted(self):
        rows = self.client.get("/api/locations").json()["locations"]
        continents = set(WMO_REGIONS.values())
        for row in rows:
            continent, country, city, lat, lon, alt, icao = row
            self.assertIn(continent, continents)
            self.assertTrue(country and city and country == " ".join(country.split()) and city == " ".join(city.split()), row)
            self.assertTrue(-90 <= lat <= 90 and -180 <= lon <= 180, row)
            self.assertIsInstance(alt, int)
            self.assertRegex(icao, r"^[A-Z0-9]{4}$")
        keys = [(r[0].casefold(), r[1].casefold(), r[2].casefold(), r[6]) for r in rows]
        self.assertEqual(keys, sorted(keys))
        self.assertEqual(len({r[6] for r in rows}), len(rows))             # ICAO ไม่ซ้ำ

    def test_file_is_read_once(self):
        locations.locations_json.cache_clear()
        self.addCleanup(locations.locations_json.cache_clear)
        first = self.client.get("/api/locations")
        second = self.client.get("/api/locations")
        self.assertEqual(first.content, second.content)
        info = locations.locations_json.cache_info()
        self.assertEqual((info.misses, info.hits), (1, 1))
        self.assertEqual(first.content, DATA_FILE.read_bytes())

    def test_missing_data_file_is_a_clean_404(self):
        locations.locations_json.cache_clear()
        self.addCleanup(locations.locations_json.cache_clear)
        original = locations.DATA_FILE
        locations.DATA_FILE = original.with_name("does_not_exist.json")
        self.addCleanup(setattr, locations, "DATA_FILE", original)
        self.assert_error(self.client.get("/api/locations"), 404, "NOT_FOUND")


class BuildScriptTest(unittest.TestCase):
    """tools/build_locations.py ทำงานด้วย `python -I` (ไม่มี cwd หรือโฟลเดอร์ของสคริปต์ใน sys.path) และไม่ใช้เน็ต"""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="gpredict_web_locations_"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)

    def run_script(self, *args):
        return subprocess.run([sys.executable, "-I", str(BUILD_SCRIPT), *map(str, args)], capture_output=True, text=True,
                              timeout=60, cwd=self.tmp)

    def test_builds_the_json_the_api_serves(self):
        source = self.tmp / "nsd.txt"
        source.write_bytes(SAMPLE.read_bytes())
        stamp = datetime(2026, 11, 14, 12, 5, 35, tzinfo=timezone.utc).timestamp()
        os.utime(source, (stamp, stamp))
        out = self.tmp / "locations.json"
        done = self.run_script(source, out)
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertIn("9 locations", done.stdout)
        built = json.loads(out.read_text(encoding="utf-8"))
        self.assertEqual(list(built), ["source", "downloaded", "locations"])
        self.assertEqual(built["source"], NSD_URL)
        self.assertEqual(built["downloaded"], "2026-11-14T12:05:35Z")      # ตั้งต้นจากเวลาแก้ไขของไฟล์ที่ดาวน์โหลด
        self.assertEqual(built["locations"], parse_nsd(sample_text()))

    def test_downloaded_can_be_given_and_bad_input_fails_cleanly(self):
        out = self.tmp / "locations.json"
        done = self.run_script(SAMPLE, out, "--downloaded", "2026-01-02T03:04:05Z")
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(json.loads(out.read_text(encoding="utf-8"))["downloaded"], "2026-01-02T03:04:05Z")
        self.assertNotEqual(self.run_script(SAMPLE, out, "--downloaded", "yesterday").returncode, 0)
        self.assertNotEqual(self.run_script(self.tmp / "missing.txt", out).returncode, 0)
        empty = self.tmp / "empty.txt"
        empty.write_text("")
        before = out.read_bytes()
        self.assertNotEqual(self.run_script(empty, out).returncode, 0)     # ไฟล์ที่อ่านแล้วไม่ได้สักแถวไม่ทับของเดิม
        self.assertEqual(out.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
