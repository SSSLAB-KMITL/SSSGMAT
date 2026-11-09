# GNSS Predict Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** สร้างคำสั่ง `python3 -m gnss_predict` ที่พยากรณ์ Az, El, IPP และ MF ของดาวเทียม GPS ทุกดวงที่มองเห็นได้จากสถานี THBK
ในช่วง 24 ชม. ข้างหน้า โดยใช้ GMAT คำนวณวงโคจรจาก TLE และตรวจความแม่นยำเทียบกับวงโคจร SP3 ของ IGS

**Architecture:** Python (standard library ล้วน) ดึง TLE จาก CelesTrak สร้าง GMAT script ที่ใช้ `SPICESGP4`, `GroundStation`
และระบบพิกัด `Topocentric` แล้วรัน `GmatConsole` จากนั้นแปลงตำแหน่งดาวเทียมในกรอบ SEZ เป็น Az/El/IPP/MF
และเขียน CSV ไม่แก้ C++ หรือไฟล์เดิมของ GMAT

**Tech Stack:** Python ≥ 3.10 (standard library เท่านั้น, ทดสอบด้วย `unittest`), GMAT R2026a (GmatConsole, TLEPropagator และ Station plugin),
CMake, curl

**Spec:** [`api-interop/gnss-predict/docs/2026-11-10-gnss-predict-design.md`](2026-11-10-gnss-predict-design.md) อ่านคู่กับแผนนี้เสมอ

## Global Constraints

- ไฟล์ใหม่ทั้งหมดอยู่ใต้ `api-interop/gnss-predict/` ห้ามแก้ไฟล์เดิมของ GMAT แม้แต่ไฟล์เดียว (รวมถึง `.gitignore` หลัก)
- ทำงานบน branch `feature/gnss-predict`
- Python ≥ 3.10 และใช้ standard library เท่านั้น ห้ามเพิ่ม dependency (ไม่มี numpy, pytest, requests)
- รันเทสต์จาก `api-interop/gnss-predict` ด้วย `python3 -m unittest discover -s tests -v`
- เวลาเป็น UTC แบบ timezone-aware (`datetime` ที่มี `tzinfo=timezone.utc`) ทั้งหมด ยกเว้นเวลา GPST ใน `sp3.py`
- ห้ามใช้ `%b` หรือ `strftime`/`strptime` กับชื่อเดือน ให้ใช้ `gmat_time.py` เพราะผลขึ้นกับ locale
- ค่าคงที่ทุกตัวมาจาก `config.py` เท่านั้น ค่าดูได้ในหัวข้อ 5.1 ของ spec และใน Task 1
- ไฟล์ CSV ผลลัพธ์มี header `DAY,Time,PRN,Az,El,IPP_Lat,IPP_Lon,MF` เป็น UTF-8 ไม่มี BOM และขึ้นบรรทัดด้วย `\n`
- ข้อความที่แสดงต่อผู้ใช้ (stderr และคำเตือน) เป็นภาษาไทย ชื่อในโค้ดเป็นภาษาอังกฤษ
- ห้าม commit ไฟล์ที่ build หรือดาวน์โหลดมา (binary, `cache/`, `output/`, `depends/*`) ยกเว้น fixture ใน `tests/fixtures/`
- commit message ใช้รูปแบบ conventional (`feat:`, `test:`, `docs:`, `build:`) เป็นภาษาอังกฤษ

## Review Focus

1. **CelesTrak ตอบกลับเป็นข้อความที่ไม่ใช่ TLE** (เช่นข้อความแจ้งว่าดาวน์โหลดถี่เกินไป หรือ HTML) ต้องถือว่าดาวน์โหลดไม่สำเร็จ ห้ามเขียนลง cache แล้วให้ใช้ cache เดิมแทน → Task 2 `test_fetch_non_tle_body_falls_back`
2. **TLE รูปแบบจริงของ CelesTrak** ขึ้นบรรทัดด้วย CRLF และบรรทัดชื่อมีช่องว่างต่อท้าย ต้องอ่านได้ผลเหมือนไฟล์ LF → Task 2 fixture CRLF และ `test_lf_and_crlf_parse_identically`
3. **เวลาใน GMAT คลาดเล็กน้อย** เช่น `00:00:29.999` ต้องปัดให้ตรงกับ epoch 00:00:30 ไม่ใช่ถือว่า epoch หายไป → Task 8 `test_time_rounding`
4. **ช่วงพยากรณ์ข้ามเที่ยงคืน UTC** คอลัมน์ `DAY` ต้องเปลี่ยนวันที่ 00:00:00 พอดี → Task 9 `test_rows_cross_midnight`
5. **ดาวเทียมที่มี TLE แต่ไม่ขึ้นเหนือ `--min-el` เลยตลอดช่วง** ต้องยังอยู่ใน `prns_included` ไม่ใช่ `prns_missing` → Task 9 `test_meta_counts_invisible_prns_as_included`

## ลำดับงานและหมายเหตุ

| Task | งาน | ต้องมี GMAT |
|---|---|---|
| 1 | โครงโฟลเดอร์, config, errors, geometry | ไม่ |
| 2 | tle_fetch | ไม่ |
| 3 | run_gmat (ทดสอบด้วย console ปลอม) | ไม่ |
| 4 | sp3 | ไม่ (แต่ต้องต่อเน็ตเพื่อสร้าง fixture) |
| 5 | build GMAT บน macOS | build |
| 6 | spike R1: propagate หลายดวงพร้อมกัน | ใช่ |
| 7 | gmat_time, script_gen | ไม่ (ใช้ผลจาก Task 6) |
| 8 | report | ไม่ (ใช้ fixture จาก Task 6) |
| 9 | predict, CLI, integration test | ใช่ (integration) |
| 10 | validate, acceptance, README | ใช่ |

Task 5 ขั้นที่ 2 (`depends/configure.py`) ใช้เวลานานเพราะต้อง build wxWidgets สั่งรันเบื้องหลังไว้ตั้งแต่ต้น
ระหว่างนั้นทำ Task 1–4 ไปได้

---

### Task 1: โครงโฟลเดอร์, config, errors และ geometry

**Files:**
- Create: `api-interop/gnss-predict/.gitignore`
- Create: `api-interop/gnss-predict/gnss_predict/__init__.py` (ว่าง)
- Create: `api-interop/gnss-predict/gnss_predict/config.py`
- Create: `api-interop/gnss-predict/gnss_predict/errors.py`
- Create: `api-interop/gnss-predict/gnss_predict/geometry.py`
- Test: `api-interop/gnss-predict/tests/test_geometry.py`

**Interfaces:**
- Produces:
  - `config.py`: `THBK_LAT_DEG = 13.729779`, `THBK_LON_DEG = 100.781151`, `THBK_HEIGHT_M = 6.4`,
    `THBK_ECEF_M = (-1159211.0035, 6087676.9700, 1503957.7161)`, `RE_KM = 6371.0`, `SHELL_KM = 400.0`, `STEP_S = 30`,
    `CELESTRAK_GPS_URL = "https://celestrak.org/NORAD/elements/gp.php?GROUP=gps-ops&FORMAT=tle"`,
    `TLE_WARN_DAYS = 7.0`, `TLE_MAX_DAYS = 30.0`, `GPS_UTC_OFFSET_S = 18`,
    `CDDIS_PRODUCTS_URL = "ftp://gdc.cddis.eosdis.nasa.gov/gnss/products"`,
    `VALIDATION_MAX_TLE_AGE_DAYS = 2.0`, `VALIDATION_MIN_EL = 10.0`, `EL_MEDIAN_MAX = 0.05`, `EL_P99_MAX = 0.2`,
    `AZ_MEDIAN_MAX = 0.1`, `AZ_P99_MAX = 0.5`, `AZ_EL_LIMIT = 80.0`,
    `PKG_ROOT = Path(__file__).resolve().parents[1]` (โฟลเดอร์ `gnss-predict`), `REPO_ROOT = Path(__file__).resolve().parents[3]`,
    `DEFAULT_CACHE_DIR = PKG_ROOT / "cache"`, `DEFAULT_OUT_DIR = PKG_ROOT / "output"`,
    `TEMPLATE_PATH = PKG_ROOT / "templates" / "thbk_visibility.script.tmpl"`
  - `errors.py`: `GnssPredictError(Exception)` และ subclass `TleUnavailableError`, `TleTooOldError`, `GmatNotFoundError`,
    `GmatRunError`, `ReportError`, `Sp3UnavailableError`, `Sp3FormatError`
  - `geometry.py`:
    `sez_to_az_el(s_km: float, e_km: float, z_km: float) -> tuple[float, float]`,
    `ipp(lat_deg: float, lon_deg: float, az_deg: float, el_deg: float, re_km: float = RE_KM, shell_km: float = SHELL_KM) -> tuple[float, float]`,
    `mapping_factor(el_deg: float, re_km: float = RE_KM, shell_km: float = SHELL_KM) -> float`,
    `ecef_to_az_el(sat_km: tuple[float, float, float], sta_km: tuple[float, float, float], lat_deg: float, lon_deg: float) -> tuple[float, float]`

- [ ] **Step 1: สร้าง `.gitignore` ของโฟลเดอร์**

```
!*.md
cache/
output/
```

ตรวจ: `git status --short --untracked-files=all api-interop/gnss-predict` ต้องเห็น `.gitignore` เป็นไฟล์ untracked
และ `git check-ignore -q api-interop/gnss-predict/README.md; echo $?` ต้องได้ `1` (ไม่ถูกละเว้น)

- [ ] **Step 2: เขียนเทสต์ที่ยังไม่ผ่าน** `tests/test_geometry.py`

```python
import math
import unittest
from gnss_predict.geometry import sez_to_az_el, ipp, mapping_factor, ecef_to_az_el
from gnss_predict.config import THBK_LAT_DEG, THBK_LON_DEG

class TestSezToAzEl(unittest.TestCase):
    def test_zenith(self):
        self.assertAlmostEqual(sez_to_az_el(0, 0, 20000)[1], 90.0, places=9)

    def test_cardinal_directions(self):
        for (s, e), az_exp in {(-20000, 0): 0.0, (0, 20000): 90.0, (20000, 0): 180.0, (0, -20000): 270.0}.items():
            az, el = sez_to_az_el(s, e, 0)
            self.assertAlmostEqual(az, az_exp, places=9)
            self.assertAlmostEqual(el, 0.0, places=9)

    def test_az_always_in_0_360(self):
        # e ติดลบนิดเดียว: atan2 ได้ราว −2.9e-16 องศา และค่านี้ % 360 ได้ 360.0 พอดีใน float
        for s, e in [(-20000, -1e-13), (-20000, 0.0), (-20000, -0.0), (5, -5), (-5, -5)]:
            az, _ = sez_to_az_el(s, e, 100)
            self.assertGreaterEqual(az, 0.0)
            self.assertLess(az, 360.0)

class TestMappingFactor(unittest.TestCase):
    def test_reference_values(self):
        for el, mf in [(90, 1.00000), (30, 0.57965), (10, 0.37598)]:
            self.assertAlmostEqual(mapping_factor(el), mf, places=5)

    def test_matches_t02_5_formula(self):
        for el in range(0, 91, 5):
            ref = math.sqrt(1.0 - (6371.0 * math.cos(math.radians(el)) / (6371.0 + 400.0)) ** 2)
            self.assertAlmostEqual(mapping_factor(el), ref, places=12)

class TestIpp(unittest.TestCase):
    def test_zenith_is_station(self):
        lat, lon = ipp(THBK_LAT_DEG, THBK_LON_DEG, 123.0, 90.0)
        self.assertAlmostEqual(lat, THBK_LAT_DEG, places=9)
        self.assertAlmostEqual(lon, THBK_LON_DEG, places=9)

    def test_north_el30(self):
        lat, lon = ipp(THBK_LAT_DEG, THBK_LON_DEG, 0.0, 30.0)
        self.assertAlmostEqual(lat, THBK_LAT_DEG + 5.4260, places=4)
        self.assertAlmostEqual(lon, THBK_LON_DEG, places=9)

    def test_east_west(self):
        self.assertGreater(ipp(THBK_LAT_DEG, THBK_LON_DEG, 90.0, 30.0)[1], THBK_LON_DEG)
        self.assertLess(ipp(THBK_LAT_DEG, THBK_LON_DEG, 270.0, 30.0)[1], THBK_LON_DEG)

    def test_dateline_wrap(self):
        _, lon = ipp(0.0, 179.9, 90.0, 30.0)
        self.assertGreater(lon, -180.0)
        self.assertLessEqual(lon, 180.0)
        self.assertLess(lon, 0.0)

class TestEcefToAzEl(unittest.TestCase):
    STA = (6378.137, 0.0, 0.0)   # (lat 0, lon 0) บนผิวโลก

    def test_overhead(self):
        self.assertAlmostEqual(ecef_to_az_el((26000.0, 0.0, 0.0), self.STA, 0.0, 0.0)[1], 90.0, places=9)

    def test_north(self):
        az, el = ecef_to_az_el((26000.0, 0.0, 5000.0), self.STA, 0.0, 0.0)
        self.assertAlmostEqual(az, 0.0, places=9)
        self.assertTrue(0.0 < el < 90.0)

    def test_consistent_with_sez(self):
        # ที่ (0°, 0°): N = dz, E = dy, U = dx  ดังนั้น S = −dz, Z = dx
        for d in [(15000.0, 3000.0, -4000.0), (2000.0, -9000.0, 7000.0), (100.0, 1.0, -20000.0)]:
            sat = tuple(a + b for a, b in zip(self.STA, d))
            got = ecef_to_az_el(sat, self.STA, 0.0, 0.0)
            exp = sez_to_az_el(-d[2], d[1], d[0])
            self.assertAlmostEqual(got[0], exp[0], places=9)
            self.assertAlmostEqual(got[1], exp[1], places=9)
```

- [ ] **Step 3: รันให้เห็นว่าไม่ผ่าน**

Run: `cd api-interop/gnss-predict && python3 -m unittest discover -s tests -v`
Expected: ERROR `ModuleNotFoundError: No module named 'gnss_predict.geometry'`

- [ ] **Step 4: สร้าง `config.py`, `errors.py`, `geometry.py` ตาม Interfaces**

สูตรอยู่ในหัวข้อ 6 ของ spec
- `sez_to_az_el`: Az = `degrees(atan2(e, -s)) % 360.0` แล้วถ้าได้ ≥ 360.0 ให้ลบ 360.0 ส่วน El = `degrees(atan2(z, hypot(s, e)))`
- `ipp`: ใช้สูตร ψ, φ_IPP, λ_IPP ของ spec แล้วจัด λ ให้อยู่ในช่วง (−180, 180]
- `ecef_to_az_el`: ใช้สูตร N, E, U ของ spec แล้ว Az/El แบบเดียวกับ `sez_to_az_el`

- [ ] **Step 5: รันให้ผ่าน**

Run: `cd api-interop/gnss-predict && python3 -m unittest discover -s tests -v`
Expected: `OK` (12 tests)

- [ ] **Step 6: Commit**

```bash
git add api-interop/gnss-predict/.gitignore api-interop/gnss-predict/gnss_predict api-interop/gnss-predict/tests
git commit -m "feat(gnss-predict): add config, errors and geometry (az/el, IPP, mapping factor)"
```

---

### Task 2: `tle_fetch.py`

**Files:**
- Create: `api-interop/gnss-predict/gnss_predict/tle_fetch.py`
- Create: `api-interop/gnss-predict/tests/fixtures/gps_sample.tle` (CRLF)
- Create: `api-interop/gnss-predict/tests/fixtures/gps_2sat.tle` (LF)
- Test: `api-interop/gnss-predict/tests/test_tle_fetch.py`

**Interfaces:**
- Consumes: `config.CELESTRAK_GPS_URL`, `config.TLE_WARN_DAYS`, `config.TLE_MAX_DAYS`, `errors.TleUnavailableError`, `errors.TleTooOldError`
- Produces:
  - `@dataclass(frozen=True) class TleEntry: prn: int; norad: str; name: str; epoch: datetime`
  - `tle_checksum(line: str) -> int` (ผลรวมตัวเลขของ 68 ตัวอักษรแรก โดยนับ `-` เป็น 1 แล้ว mod 10)
  - `parse_tle_text(text: str) -> tuple[list[TleEntry], list[str]]` และ `parse_tle_file(path: Path) -> tuple[list[TleEntry], list[str]]`
    คืนรายการเรียงตาม PRN และคำเตือน
  - `check_tle_age(entries: list[TleEntry], start: datetime, hours: float, warn_days: float = TLE_WARN_DAYS, max_days: float = TLE_MAX_DAYS) -> list[str]`
  - `fetch_gps_tle(cache_dir: Path, url: str = CELESTRAK_GPS_URL, timeout_s: float = 30, now: datetime | None = None) -> tuple[Path, list[str]]`

- [ ] **Step 1: สร้าง fixture**

ห้ามแก้ไฟล์เหล่านี้ด้วย editor ที่แปลงบรรทัดอัตโนมัติ ให้สร้างด้วย Python:

```python
from pathlib import Path
E = [  # 5 ชุดจริงจาก CelesTrak gps-ops วันที่ 2026-11-10
 ("GPS BIIR-5  (PRN 22)    ", "1 26407U 00040A   26313.12355163  .00000023  00000+0  00000+0 0  9997",
  "2 26407  54.8262 209.4116 0115222 305.0160 227.7848  2.00558950192856"),
 ("GPS BIIR-8  (PRN 16)    ", "1 27663U 03005A   26312.45322601  .00000019  00000+0  00000+0 0  9997",
  "2 27663  54.8555 209.2430 0153062  54.3513 129.6310  2.00552806174200"),
 ("GPS BIIR-11 (PRN 19)    ", "1 28190U 04009A   26313.04253237 -.00000055  00000+0  00000+0 0  9993",
  "2 28190  54.7189 269.8211 0118790 177.8301 228.6410  2.00571534165853"),
 # ชุดเสีย 1: checksum ของบรรทัด 1 ถูกเปลี่ยนจาก 0 เป็น 1
 ("GPS BIIR-13 (PRN 02)    ", "1 28474U 04045A   26312.65289983 -.00000081  00000+0  00000+0 0  9991",
  "2 28474  55.0434 319.0629 0174523 320.4619 226.4367  2.00562169161329"),
 # ชุดเสีย 2: ลบ "(PRN 17)" ออกจากชื่อ
 ("GPS BIIRM-1             ", "1 28874U 05038A   26313.03635946 -.00000053  00000+0  00000+0 0  9993",
  "2 28874  54.7700 267.3194 0128120 299.1709 129.6001  2.00555797154747"),
]
fx = Path("api-interop/gnss-predict/tests/fixtures"); fx.mkdir(parents=True, exist_ok=True)
(fx / "gps_sample.tle").write_bytes(("\r\n".join(l for e in E for l in e) + "\r\n").encode())
(fx / "gps_2sat.tle").write_bytes(("\n".join(l for e in E[:2] for l in e) + "\n").encode())
```

- [ ] **Step 2: เขียนเทสต์ที่ยังไม่ผ่าน** `tests/test_tle_fetch.py`

```python
import shutil
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from gnss_predict.errors import TleTooOldError, TleUnavailableError
from gnss_predict.tle_fetch import check_tle_age, fetch_gps_tle, parse_tle_file, parse_tle_text, tle_checksum

FX = Path(__file__).parent / "fixtures"
UTC = timezone.utc

class TestParse(unittest.TestCase):
    def test_sample(self):
        entries, warns = parse_tle_file(FX / "gps_sample.tle")
        self.assertEqual([e.prn for e in entries], [16, 19, 22])
        self.assertEqual([e.norad for e in entries], ["27663", "28190", "26407"])
        self.assertEqual(entries[2].name, "GPS BIIR-5  (PRN 22)")
        exp = {16: datetime(2026, 11, 8, 10, 52, 38, 727264, UTC),
               19: datetime(2026, 11, 9, 1, 1, 14, 796768, UTC),
               22: datetime(2026, 11, 9, 2, 57, 54, 860832, UTC)}
        for e in entries:
            self.assertLess(abs((e.epoch - exp[e.prn]).total_seconds()), 1e-3)
        self.assertEqual(len(warns), 2)
        self.assertTrue(any("28474" in w for w in warns))   # checksum ผิด
        self.assertTrue(any("28874" in w for w in warns))   # ไม่มี PRN

    def test_lf_and_crlf_parse_identically(self):
        crlf = (FX / "gps_sample.tle").read_bytes().decode()
        self.assertEqual(parse_tle_text(crlf), parse_tle_text(crlf.replace("\r\n", "\n")))

    def test_duplicate_prn_keeps_newer_epoch(self):
        name, l1, l2 = [l for l in (FX / "gps_2sat.tle").read_text().splitlines()][:3]   # PRN 22
        l1b = l1[:18] + "26314.00000000" + l1[32:68]
        l1b += str(tle_checksum(l1b))
        entries, _ = parse_tle_text("\n".join([name, l1, l2, name, l1b, l2]) + "\n")
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0].epoch, datetime(2026, 11, 10, tzinfo=UTC))

class TestAge(unittest.TestCase):
    def setUp(self):
        self.entries, _ = parse_tle_file(FX / "gps_sample.tle")   # epoch เก่าสุด 2026-11-08 10:52

    def test_fresh(self):
        self.assertEqual(check_tle_age(self.entries, datetime(2026, 11, 10, tzinfo=UTC), 24), [])

    def test_warn_after_7_days(self):
        self.assertEqual(len(check_tle_age(self.entries, datetime(2026, 11, 16, tzinfo=UTC), 24)), 1)

    def test_epoch_after_start_uses_absolute_age(self):
        self.assertEqual(len(check_tle_age(self.entries, datetime(2026, 11, 1, tzinfo=UTC), 24)), 1)

    def test_too_old(self):
        with self.assertRaises(TleTooOldError):
            check_tle_age(self.entries, datetime(2026, 12, 10, tzinfo=UTC), 24)

class TestFetch(unittest.TestCase):
    NOW = datetime(2026, 11, 10, 12, 0, tzinfo=UTC)

    def test_success_writes_timestamped_cache(self):
        with tempfile.TemporaryDirectory() as d:
            path, warns = fetch_gps_tle(Path(d), url=(FX / "gps_sample.tle").as_uri(), now=self.NOW)
            self.assertEqual(path.name, "gps_20261110T1200Z.tle")
            self.assertEqual(warns, [])
            self.assertEqual(len(parse_tle_file(path)[0]), 3)

    def test_failure_falls_back_to_newest_cache(self):
        with tempfile.TemporaryDirectory() as d:
            for n in ("gps_20261101T0000Z.tle", "gps_20261105T0000Z.tle"):
                shutil.copy(FX / "gps_sample.tle", Path(d) / n)
            path, warns = fetch_gps_tle(Path(d), url=(Path(d) / "missing.tle").as_uri(), now=self.NOW)
            self.assertEqual(path.name, "gps_20261105T0000Z.tle")
            self.assertEqual(len(warns), 1)

    def test_failure_without_cache_raises(self):
        with tempfile.TemporaryDirectory() as d, self.assertRaises(TleUnavailableError):
            fetch_gps_tle(Path(d), url=(Path(d) / "missing.tle").as_uri(), now=self.NOW)

    def test_fetch_non_tle_body_falls_back(self):
        with tempfile.TemporaryDirectory() as d:
            junk = Path(d) / "junk.txt"
            junk.write_text("GP data has not updated since your last successful download\n")
            cache = Path(d) / "cache"; cache.mkdir()
            shutil.copy(FX / "gps_sample.tle", cache / "gps_20261105T0000Z.tle")
            path, warns = fetch_gps_tle(cache, url=junk.as_uri(), now=self.NOW)
            self.assertEqual(path.name, "gps_20261105T0000Z.tle")
            self.assertEqual(sorted(p.name for p in cache.iterdir()), ["gps_20261105T0000Z.tle"])
```

- [ ] **Step 3: รันให้เห็นว่าไม่ผ่าน**

Run: `cd api-interop/gnss-predict && python3 -m unittest tests.test_tle_fetch -v`
Expected: ERROR `No module named 'gnss_predict.tle_fetch'`

- [ ] **Step 4: เขียน `tle_fetch.py` ตาม Interfaces**

- `parse_tle_text`: ตัด `\r` ทิ้งและ `rstrip()` บรรทัดชื่อ แล้วอ่านทีละ 3 บรรทัด (ชื่อ, `1 `, `2 `)
  ข้ามชุดที่ checksum ของบรรทัดใดผิด, ไม่เจอ regex `\(PRN\s*(\d{1,2})\)` หรือ PRN อยู่นอก 1–32 แต่ละกรณีให้เพิ่มคำเตือนที่มีเลข NORAD
  ถ้า PRN ซ้ำกันให้เก็บชุดที่ epoch ใหม่กว่า
- epoch: ปี 2 หลัก (`< 57` หมายถึง 20xx) ตามด้วยวันของปีแบบมีทศนิยม เป็น `datetime(ปี, 1, 1, UTC) + timedelta(days=doy - 1)`
- `check_tle_age`: อายุของแต่ละดวง = `max(|start − epoch|, |start + hours − epoch|)` แล้วใช้ค่ามากสุดของทุกดวง
  ถ้าเกิน `max_days` ให้ raise ถ้าเกิน `warn_days` ให้คืนคำเตือนหนึ่งข้อ
- `fetch_gps_tle`: ใช้ `urllib.request.urlopen(Request(url, headers={"User-Agent": "gnss-predict/0.1"}), timeout=timeout_s)`
  ถือว่าสำเร็จเมื่ออ่านได้และ `parse_tle_text` คืนอย่างน้อยหนึ่งรายการ จากนั้นเขียนข้อความดิบลง
  `gps_<now:%Y%m%dT%H%MZ>.tle` ด้วยไฟล์ `.tmp` แล้ว `os.replace` ถ้าไม่สำเร็จให้ใช้ไฟล์ `gps_*.tle` ที่ชื่อเรียงมาท้ายสุดใน cache
  พร้อมคำเตือนหนึ่งข้อ ถ้า cache ว่างให้ raise `TleUnavailableError` สร้าง `cache_dir` ถ้ายังไม่มี

- [ ] **Step 5: รันให้ผ่าน**

Run: `cd api-interop/gnss-predict && python3 -m unittest discover -s tests -v`
Expected: `OK`

- [ ] **Step 6: Commit**

```bash
git add api-interop/gnss-predict/gnss_predict/tle_fetch.py api-interop/gnss-predict/tests
git commit -m "feat(gnss-predict): fetch, cache and parse GPS TLEs from CelesTrak"
```

---

### Task 3: `run_gmat.py`

**Files:**
- Create: `api-interop/gnss-predict/gnss_predict/run_gmat.py`
- Test: `api-interop/gnss-predict/tests/test_run_gmat.py`

**Interfaces:**
- Consumes: `config.REPO_ROOT`, `errors.GmatNotFoundError`, `errors.GmatRunError`
- Produces:
  - `find_gmat_console(environ: Mapping[str, str] = os.environ, repo_root: Path = REPO_ROOT) -> Path`
  - `run_script(console: Path, script: Path, log: Path, timeout_s: float = 600) -> None`
  - `gmat_version(console: Path) -> str`

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน** `tests/test_run_gmat.py`

ใช้ console ปลอมที่เป็น shell script เมื่อถูกเรียกด้วย `[console, "--run", script, "--logfile", log]` จะได้ `$4` = path ของ log

```python
import tempfile
import unittest
from pathlib import Path

from gnss_predict.errors import GmatNotFoundError, GmatRunError
from gnss_predict.run_gmat import find_gmat_console, gmat_version, run_script


def fake_console(d: Path, body: str) -> Path:
    p = d / "GmatConsole"
    p.write_text("#!/bin/sh\n" + body + "\n")
    p.chmod(0o755)
    return p


class TmpCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.d = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()


class TestFind(TmpCase):
    def test_env_var(self):
        c = fake_console(self.d, "exit 0")
        self.assertEqual(find_gmat_console(environ={"GMAT_BIN": str(c)}, repo_root=self.d / "repo"), c)

    def test_env_var_missing_file(self):
        with self.assertRaises(GmatNotFoundError):
            find_gmat_console(environ={"GMAT_BIN": str(self.d / "nope")}, repo_root=self.d)

    def test_repo_default(self):
        bin_dir = self.d / "application" / "bin"
        bin_dir.mkdir(parents=True)
        c = fake_console(bin_dir, "exit 0")
        self.assertEqual(find_gmat_console(environ={}, repo_root=self.d), c)

    def test_not_found_mentions_env(self):
        with self.assertRaises(GmatNotFoundError) as cm:
            find_gmat_console(environ={}, repo_root=self.d)
        self.assertIn("GMAT_BIN", str(cm.exception))


class TestRun(TmpCase):
    def setUp(self):
        super().setUp()
        self.script = self.d / "s.script"
        self.script.write_text("% empty\n")
        self.log = self.d / "gmat.log"

    def run_with(self, body: str, timeout_s: float = 10) -> None:
        run_script(fake_console(self.d, body), self.script, self.log, timeout_s=timeout_s)

    def test_success_runs_in_console_dir(self):
        self.run_with('pwd -P > "$4"')
        self.assertEqual(Path(self.log.read_text().strip()), self.d.resolve())

    def test_nonzero_exit(self):
        with self.assertRaises(GmatRunError) as cm:
            self.run_with('echo boom > "$4"; exit 1')
        self.assertIn("boom", str(cm.exception))

    def test_error_in_log_with_zero_exit(self):
        with self.assertRaises(GmatRunError):
            self.run_with('echo "**** ERROR **** Interpreter Exception" > "$4"')

    def test_timeout(self):
        with self.assertRaises(GmatRunError):
            self.run_with("sleep 5", timeout_s=0.5)


class TestVersion(TmpCase):
    def test_version(self):
        c = fake_console(self.d, 'echo ""; echo "GMAT R2026a"; echo "Build Date: x"')
        self.assertEqual(gmat_version(c), "GMAT R2026a")

    def test_version_failure(self):
        self.assertEqual(gmat_version(fake_console(self.d, "exit 3")), "unknown")
```

- [ ] **Step 2: รันให้เห็นว่าไม่ผ่าน**

Run: `cd api-interop/gnss-predict && python3 -m unittest tests.test_run_gmat -v`
Expected: ERROR `No module named 'gnss_predict.run_gmat'`

- [ ] **Step 3: เขียน `run_gmat.py` ตาม Interfaces**

- `find_gmat_console`: ถ้ามี `GMAT_BIN` ต้องเป็นไฟล์ที่รันได้ (`os.access(p, os.X_OK)`) ไม่อย่างนั้นให้ raise โดยไม่หาที่อื่นต่อ
  ถ้าไม่มี `GMAT_BIN` ให้ใช้ `repo_root/application/bin/GmatConsole` ข้อความ error ต้องบอกให้ตั้ง `GMAT_BIN`
- `run_script`: `subprocess.run([...], cwd=console.parent, capture_output=True, text=True, timeout=timeout_s)`
  ข้อความใน `GmatRunError` ต้องมี 20 บรรทัดสุดท้ายของ log (ถ้ามีไฟล์ log) หรือของ stdout+stderr
- `gmat_version`: รัน `[console, "--version"]` timeout 30 วินาที คืนบรรทัดแรกที่ไม่ว่าง ถ้ารันไม่สำเร็จคืน `"unknown"`

- [ ] **Step 4: รันให้ผ่าน**

Run: `cd api-interop/gnss-predict && python3 -m unittest discover -s tests -v`
Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add api-interop/gnss-predict/gnss_predict/run_gmat.py api-interop/gnss-predict/tests/test_run_gmat.py
git commit -m "feat(gnss-predict): locate and run GmatConsole with error detection"
```

---

### Task 4: `sp3.py`

**Files:**
- Create: `api-interop/gnss-predict/gnss_predict/sp3.py`
- Create: `api-interop/gnss-predict/tests/fixtures/sample.sp3`
- Test: `api-interop/gnss-predict/tests/test_sp3.py`

**Interfaces:**
- Consumes: `config.CDDIS_PRODUCTS_URL`, `errors.Sp3UnavailableError`, `errors.Sp3FormatError`
- Produces:
  - `@dataclass(frozen=True) class Sp3Orbit: time_system: str; epochs: list[datetime]; positions: dict[int, list[tuple[float, float, float] | None]]`
    (`epochs` เป็นเวลา GPST เก็บเป็น `datetime` ที่ติด `tzinfo=timezone.utc` เป็นป้ายเท่านั้น ผู้เรียกต้องบวก `GPS_UTC_OFFSET_S` เอง)
  - `gps_week(day: date) -> int`
  - `choose_sp3_name(listing: list[str], day: date) -> str | None`
  - `fetch_sp3(day: date, cache_dir: Path) -> Path`
  - `read_sp3(path: Path) -> Sp3Orbit`
  - `interpolate(orbit: Sp3Orbit, prn: int, t_gpst: datetime) -> tuple[float, float, float] | None`
  - `prns_with_data(orbit: Sp3Orbit) -> set[int]`

- [ ] **Step 1: ตรวจค่า GPS − UTC กับ IERS (R6)**

Run: `curl -s https://hpiers.obspm.fr/iers/bul/bulc/bulletinc.dat | grep -i "UTC-TAI"`
Expected: มีบรรทัดที่บอก `UTC-TAI = -37 s` และใช้ได้ครอบคลุมเดือนที่จะทำ acceptance (ซึ่งหมายถึง GPS − UTC = 18 วินาที)
ถ้าไม่ใช่ ให้หยุดและแจ้งผู้ใช้ก่อนแก้ `GPS_UTC_OFFSET_S`

- [ ] **Step 2: สร้าง fixture `sample.sp3`**

ดาวน์โหลด SP3 จริงหนึ่งไฟล์ (สัปดาห์ GPS 2444 ซึ่งตรงกับ 2026-11-08 ถึง 2026-11-14) แล้วตัดให้เหลือ 2 ดวง 24 epoch:

```bash
cd "$(mktemp -d)"
curl -s --fail --ssl-reqd -u anonymous:anonymous --list-only ftp://gdc.cddis.eosdis.nasa.gov/gnss/products/2444/ | grep 'ORB.SP3.gz'
# เลือกไฟล์ IGS0OPSRAP_2026312... หรือไฟล์ IGS0OPS*_*_01D_15M_ORB.SP3.gz ตัวไหนก็ได้ที่มีอยู่ในรายการ แล้ว:
curl -s --fail --ssl-reqd -u anonymous:anonymous -O ftp://gdc.cddis.eosdis.nasa.gov/gnss/products/2444/<ชื่อไฟล์>
```

```python
import gzip, sys
src, dst = sys.argv[1], "api-interop/gnss-predict/tests/fixtures/sample.sp3"   # ส่ง path ของไฟล์ .SP3.gz เข้ามา
lines = gzip.open(src, "rt").read().splitlines()
head = [l for l in lines[:lines.index(next(l for l in lines if l.startswith("*")))]]
out, n = [], 0
for l in lines[len(head):]:
    if l.startswith("*"):
        n += 1
        if n > 24: break
        out.append(l)
    elif l.startswith(("PG16", "PG22")):
        out.append(l)
# epoch ที่ 3 ของ PG22 ทำเป็น "ไม่มีข้อมูล"
i = [k for k, l in enumerate(out) if l.startswith("PG22")][2]
out[i] = "PG22      0.000000      0.000000      0.000000 999999.999999"
open(dst, "w").write("\n".join(head + out + ["EOF"]) + "\n")
```

ถ้าดาวน์โหลดจาก CDDIS ไม่ได้ (R3) ให้หยุดและแจ้งผู้ใช้

- [ ] **Step 3: เขียนเทสต์ที่ยังไม่ผ่าน** `tests/test_sp3.py`

```python
import gzip
import math
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path

from gnss_predict.errors import Sp3FormatError
from gnss_predict.sp3 import Sp3Orbit, choose_sp3_name, gps_week, interpolate, prns_with_data, read_sp3

FX = Path(__file__).parent / "fixtures"

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
```

- [ ] **Step 4: รันให้เห็นว่าไม่ผ่าน**

Run: `cd api-interop/gnss-predict && python3 -m unittest tests.test_sp3 -v`
Expected: ERROR `No module named 'gnss_predict.sp3'`

- [ ] **Step 5: เขียน `sp3.py` ตาม Interfaces**

- `gps_week`: `(day - date(1980, 1, 6)).days // 7`
- `choose_sp3_name`: หา `IGS0OPSFIN_<YYYY><DDD>0000_01D_15M_ORB.SP3.gz` ก่อน ถ้าไม่มีจึงหา `IGS0OPSRAP_...`
- `fetch_sp3`: list `CDDIS_PRODUCTS_URL/<week>/` และดาวน์โหลดด้วย `curl -s --fail --ssl-reqd --max-time 120 -u anonymous:anonymous`
  (`--list-only` ตอน list) ลงไฟล์ `.part` ก่อนแล้วค่อย `os.replace` ถ้ามีไฟล์ใน `cache_dir` อยู่แล้วไม่ต้องดาวน์โหลดซ้ำ
  ถ้าหาไม่เจอหรือดาวน์โหลดไม่ได้ให้ raise `Sp3UnavailableError`
- `read_sp3`: เปิดด้วย `gzip.open` ถ้าชื่อลงท้ายด้วย `.gz` time system อ่านจากบรรทัด `%c` แรกที่คอลัมน์ 10–12 (`line[9:12]`)
  ถ้าไม่ใช่ `GPS` ให้ raise `Sp3FormatError` บรรทัด `*` คือ epoch บรรทัด `PGnn` คือ x, y, z (กม.) ถ้าทั้งสามค่าเป็น 0.0 ให้ถือว่าไม่มีข้อมูล
  และ PRN ที่ไม่มีบรรทัดใน epoch ใดก็ให้เป็น `None` ที่ epoch นั้น
- `interpolate`: ถ้า t ตรงกับ epoch ใดให้คืนค่าที่เก็บไว้ ถ้าไม่ตรง หา k ที่ `epochs[k] < t < epochs[k+1]` แล้วใช้ Lagrange กับจุด k−4 ถึง k+5
  (10 จุด) คิดเวลาเป็นวินาทีจาก `epochs[k]` คืน `None` ถ้า k−4 < 0, k+5 ≥ จำนวน epoch หรือมีจุดใดในหน้าต่างเป็น `None`

- [ ] **Step 6: รันให้ผ่าน**

Run: `cd api-interop/gnss-predict && python3 -m unittest discover -s tests -v`
Expected: `OK`

- [ ] **Step 7: Commit**

```bash
git add api-interop/gnss-predict/gnss_predict/sp3.py api-interop/gnss-predict/tests
git commit -m "feat(gnss-predict): read IGS SP3 orbits and Lagrange-interpolate positions"
```

---

### Task 5: build GMAT บน macOS

ไม่มีโค้ดใหม่ ผลที่ได้คือ `application/bin/GmatConsole` ที่รัน TLE ได้ **ถ้าแก้ปัญหา build รวมกันเกิน 2 ชั่วโมง ให้หยุดและถามผู้ใช้**
ทางสำรองดูในหัวข้อ 9 ของ spec

**Files:**
- Modify: `.git/info/exclude` (เฉพาะเครื่อง ไม่ถูก commit)

- [ ] **Step 1: กันไม่ให้ไฟล์ที่ build และดาวน์โหลดมาโผล่ใน git status**

ต่อท้าย `.git/info/exclude` ด้วย:

```
/application/bin/GmatConsole
/application/bin/libGmat*
/depends/cspice/
/depends/xerces/
/depends/wxWidgets/
/depends/swig/
```

- [ ] **Step 2: ดาวน์โหลดและ build dependency (ใช้เวลานาน รันเบื้องหลังได้)**

Run: `cd /Users/phuwish/SSSGMAT && python3 depends/configure.py 2>&1 | tee /tmp/gmat_configure.log`
Expected: จบโดยไม่มี error ใน log และมีโฟลเดอร์ `depends/cspice/macosx`, `depends/xerces`

- [ ] **Step 3: configure ด้วย CMake**

```bash
cmake -S . -B build/console -DCMAKE_BUILD_TYPE=Release \
      -DGMAT_INCLUDE_GUI=OFF \
      -DPLUGIN_PYTHONINTERFACE=OFF -DPLUGIN_MATLABINTERFACE=OFF -DPLUGIN_EXTERNALFORCEMODEL=OFF
```

Expected: จบด้วย `-- Generating done` และ `PLUGIN_TLEPROPAGATOR`, `PLUGIN_STATION` ยังเป็น `ON` (ตรวจใน `build/console/CMakeCache.txt`)

- [ ] **Step 4: build**

Run: `cmake --build build/console -j 8`
Expected: มีไฟล์ `application/bin/GmatConsole` และ `find application/plugins -name 'libTLEPropagator*' -o -name 'libStation*'` เจอทั้งสองตัว

- [ ] **Step 5: ทดสอบด้วยตัวอย่างที่มีอยู่แล้ว (ตรวจ R5 ด้วย)**

Run: `cd application/bin && ./GmatConsole --run ../samples/Ex_TLE_Propagation.script; echo "exit=$?"`
Expected: `exit=0` และมีไฟล์ `application/output/Ex_TLE_Propagation.txt` ที่มี header และข้อมูล 289 แถว (1 วัน ทุก 300 วินาที)
ถ้ามีคำเตือนว่าโหลด plugin ที่ไม่ได้ build ไม่ได้ (MATLAB, Python, proprietary) ถือว่าปกติ แต่ต้องรันจนจบ

- [ ] **Step 6: ตรวจว่าไม่มีไฟล์ build หลุดเข้า git**

Run: `git status --short`
Expected: ไม่มีอะไรใหม่นอกจาก `.markdown-collab/` และ `.vscode/` ที่มีอยู่ก่อนแล้ว ไฟล์ output ของตัวอย่างใน `application/output/`
ถ้าโผล่ขึ้นมา ให้ลบทิ้ง ห้าม commit

---

### Task 6: spike R1 (propagate หลายดวงในคำสั่งเดียว)

ตอบคำถามว่า template ในหัวข้อ 5.3 ของ spec ใช้ได้จริงหรือไม่ และเก็บรายงานจริงของ GMAT ไว้เป็น fixture

**Files:**
- Create: `api-interop/gnss-predict/tests/fixtures/report_2sat.txt` (หรือ `report_G16.txt` + `report_G22.txt` ถ้าต้องใช้แบบสำรอง)
- Modify: `api-interop/gnss-predict/docs/2026-11-10-gnss-predict-design.md` (แถว R1 ในหัวข้อ 12)

- [ ] **Step 1: เขียน script ด้วยมือ** ที่ `api-interop/gnss-predict/output/spike/spike.script` ตามหัวข้อ 5.3 ของ spec โดยใช้ค่าต่อไปนี้:
  - ดาวเทียม `G16` (Id `'27663'`) และ `G22` (Id `'26407'`) เรียงตาม PRN
  - `EphemerisName` เป็น absolute path ของ `tests/fixtures/gps_2sat.tle`
  - `Epoch = '10 Nov 2026 00:00:00.000'`
  - `{G16.ElapsedSecs = 3600}`
  - `RF.Filename` เป็น absolute path ของ `output/spike/report.txt`
  - ใน `RF.Add` ใส่คอลัมน์ทีละบรรทัดโดยต่อบรรทัดด้วย `...` แบบเดียวกับ `Ex_TLE_Propagation.script`

- [ ] **Step 2: รัน**

Run: `cd application/bin && ./GmatConsole --run <abs>/output/spike/spike.script --logfile <abs>/output/spike/gmat.log; echo "exit=$?"`
Expected (แบบหลายดวงใช้ได้): `exit=0`, log ไม่มี `**** ERROR ****`, `report.txt` มี header 1 บรรทัดและข้อมูล 121 หรือ 122 แถว
โดยแถวแรกเป็น `10 Nov 2026 00:00:00.000`

- [ ] **Step 3: ตรวจความสมเหตุสมผล**

ทุกแถวต้องมีระยะ √(X² + Y² + Z²) ของทั้งสองดวงอยู่ระหว่าง 19,000 ถึง 27,000 กม. และเวลาต้องเพิ่มทีละ 30 วินาที

- [ ] **Step 4: ถ้า Step 2 หรือ 3 ไม่ผ่านเพราะสั่งหลายดวงพร้อมกันไม่ได้** ให้แก้ script เป็นแบบสำรองในหัวข้อ 5.3 ของ spec
(หนึ่ง `ReportFile` ชื่อ `report_Gxx.txt` และหนึ่ง `Propagate` ต่อหนึ่งดวง) แล้วทำ Step 2–3 ใหม่
ถ้าแบบสำรองก็ไม่ผ่าน ให้หยุดและแจ้งผู้ใช้

- [ ] **Step 5: บันทึกผล**
  - copy รายงานไปเป็น fixture (`report_2sat.txt` หรือ `report_G16.txt` + `report_G22.txt`)
  - แก้แถว R1 ในหัวข้อ 12 ของ spec ให้บอกแบบที่ใช้ได้ จำนวนแถวจริง (121 หรือ 122) และรูปแบบ header จริง
  - ถ้าใช้แบบสำรอง ให้แก้ Task 7 และ Task 8 ของแผนนี้ตามแบบสำรองก่อน commit
  - copy `spike.script` เก็บไว้ใน `output/spike/` (ไม่ commit) เพราะ Task 7 ต้องใช้

- [ ] **Step 6: Commit**

```bash
git add api-interop/gnss-predict/tests/fixtures/report_*.txt api-interop/gnss-predict/docs
git commit -m "test(gnss-predict): capture GMAT topocentric report for 2 TLE satellites (R1 spike)"
```

---

### Task 7: `gmat_time.py` และ `script_gen.py`

**Files:**
- Create: `api-interop/gnss-predict/gnss_predict/gmat_time.py`
- Create: `api-interop/gnss-predict/gnss_predict/script_gen.py`
- Create: `api-interop/gnss-predict/templates/thbk_visibility.script.tmpl`
- Create: `api-interop/gnss-predict/tests/fixtures/expected_2sat.script`
- Test: `api-interop/gnss-predict/tests/test_script_gen.py`

**Interfaces:**
- Consumes: `TleEntry`, `parse_tle_file` (Task 2), `config.TEMPLATE_PATH`, `config.THBK_*`
- Produces:
  - `format_gmat_epoch(t: datetime) -> str` คืนรูปแบบ `DD Mon YYYY HH:MM:SS.mmm` ปัดเป็นมิลลิวินาที
  - `parse_gmat_epoch(text: str) -> datetime` (UTC, ไม่ปัดเศษ)
  - `render_script(entries: list[TleEntry], tle_path: Path, start: datetime, hours: float, step_s: int, work_dir: Path) -> str`
    รายงานเขียนลง `work_dir / "report.txt"`

- [ ] **Step 1: สร้าง `expected_2sat.script`** จาก `output/spike/spike.script` ที่ผ่านแล้วใน Task 6
แทน path ของ TLE ด้วย `/fixtures/gps_2sat.tle` และ path ของรายงานด้วย `/work/report.txt` นอกนั้นให้เหมือนเดิมทุกตัวอักษร

- [ ] **Step 2: เขียนเทสต์ที่ยังไม่ผ่าน** `tests/test_script_gen.py`

```python
import unittest
from datetime import datetime, timezone
from pathlib import Path

from gnss_predict.gmat_time import format_gmat_epoch, parse_gmat_epoch
from gnss_predict.script_gen import render_script
from gnss_predict.tle_fetch import parse_tle_file

UTC = timezone.utc
FX = Path(__file__).parent / "fixtures"

class TestGmatTime(unittest.TestCase):
    def test_format(self):
        self.assertEqual(format_gmat_epoch(datetime(2026, 11, 10, tzinfo=UTC)), "10 Nov 2026 00:00:00.000")
        self.assertEqual(format_gmat_epoch(datetime(2026, 1, 5, 7, 8, 9, 400, UTC)), "05 Jan 2026 07:08:09.000")

    def test_parse(self):
        self.assertEqual(parse_gmat_epoch("10 Nov 2026 00:00:29.999"),
                         datetime(2026, 11, 10, 0, 0, 29, 999000, UTC))

    def test_round_trip_all_months(self):
        for m in range(1, 13):
            t = datetime(2026, m, 28, 23, 59, 30, tzinfo=UTC)
            self.assertEqual(parse_gmat_epoch(format_gmat_epoch(t)), t)

class TestRender(unittest.TestCase):
    def setUp(self):
        self.entries, _ = parse_tle_file(FX / "gps_2sat.tle")

    def test_golden(self):
        got = render_script(self.entries, Path("/fixtures/gps_2sat.tle"),
                            datetime(2026, 11, 10, tzinfo=UTC), 1, 30, Path("/work"))
        self.assertEqual(got, (FX / "expected_2sat.script").read_text())

    def test_24h(self):
        got = render_script(self.entries, Path("/f.tle"), datetime(2026, 11, 10, tzinfo=UTC), 24, 30, Path("/w"))
        self.assertIn("ElapsedSecs = 86400", got)
        self.assertIn("InitialStepSize = 30", got)

    def test_path_with_space(self):
        got = render_script(self.entries, Path("/tmp/my dir/gps.tle"), datetime(2026, 11, 10, tzinfo=UTC), 1, 30, Path("/w"))
        self.assertIn("G16.EphemerisName = '/tmp/my dir/gps.tle';", got)

    def test_empty_entries(self):
        with self.assertRaises(ValueError):
            render_script([], Path("/f.tle"), datetime(2026, 11, 10, tzinfo=UTC), 1, 30, Path("/w"))
```

(`test_path_with_space` ต้องใช้รูปแบบการจัดช่องว่างให้ตรงกับใน `expected_2sat.script` ถ้าจัดช่องว่างต่างกัน ให้แก้ string ในเทสต์ให้ตรง)

- [ ] **Step 3: รันให้เห็นว่าไม่ผ่าน**

Run: `cd api-interop/gnss-predict && python3 -m unittest tests.test_script_gen -v`
Expected: ERROR `No module named 'gnss_predict.gmat_time'`

- [ ] **Step 4: เขียน `gmat_time.py`, template และ `script_gen.py`**

- `gmat_time.py`: ใช้ tuple ชื่อเดือนภาษาอังกฤษ `("Jan", ..., "Dec")` ห้ามใช้ `%b`
- template: ใช้ `string.Template` โดยมี placeholder `$spacecraft_blocks`, `$lat`, `$lon`, `$height_km`, `$step_s`,
  `$report_path`, `$report_columns`, `$sat_list`, `$first_sat`, `$elapsed_s` ผลที่แทนค่าแล้วต้องตรงกับ `expected_2sat.script`
- `render_script`: เรียงดาวเทียมตาม PRN ชื่อ `G%02d` lat และ lon ทศนิยม 6 ตำแหน่ง height_km = `THBK_HEIGHT_M / 1000` ทศนิยม 4 ตำแหน่ง
  `elapsed_s` เป็นจำนวนเต็ม (`round(hours * 3600)`) และถ้า `entries` ว่างให้ raise `ValueError`

- [ ] **Step 5: รันให้ผ่าน**

Run: `cd api-interop/gnss-predict && python3 -m unittest discover -s tests -v`
Expected: `OK`

- [ ] **Step 6: Commit**

```bash
git add api-interop/gnss-predict/gnss_predict/gmat_time.py api-interop/gnss-predict/gnss_predict/script_gen.py \
        api-interop/gnss-predict/templates api-interop/gnss-predict/tests
git commit -m "feat(gnss-predict): generate GMAT visibility script from TLE entries"
```

---

### Task 8: `report.py`

**Files:**
- Create: `api-interop/gnss-predict/gnss_predict/report.py`
- Test: `api-interop/gnss-predict/tests/test_report.py`

**Interfaces:**
- Consumes: `parse_gmat_epoch` (Task 7), `errors.ReportError`, fixture `report_2sat.txt` (Task 6)
- Produces:
  - `@dataclass(frozen=True) class SezSample: t: datetime; prn: int; s_km: float; e_km: float; z_km: float`
  - `read_report(work_dir: Path, prns: list[int]) -> list[SezSample]` อ่าน `work_dir/report.txt`
  - `check_epochs(samples: list[SezSample], start: datetime, hours: float, step_s: int) -> None`

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน** `tests/test_report.py`

ทุกเทสต์ copy `fixtures/report_2sat.txt` ไปเป็น `report.txt` ในโฟลเดอร์ชั่วคราว แล้วแก้ไฟล์ตามที่แต่ละเทสต์ต้องการ
เทสต์อาศัยรูปแบบเวลา `10 Nov 2026 HH:MM:SS.mmm` ที่ยืนยันแล้วใน Task 6

```python
import csv
import shutil
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from gnss_predict.errors import ReportError
from gnss_predict.report import check_epochs, read_report

FX = Path(__file__).parent / "fixtures"
START = datetime(2026, 11, 10, tzinfo=timezone.utc)


class ReportCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.work = Path(self._tmp.name)
        shutil.copy(FX / "report_2sat.txt", self.work / "report.txt")

    def tearDown(self):
        self._tmp.cleanup()

    def edit(self, fn) -> None:
        p = self.work / "report.txt"
        p.write_text("".join(fn(p.read_text().splitlines(keepends=True))))


class TestReadReport(ReportCase):
    def test_reads_all(self):
        s = read_report(self.work, [16, 22])
        self.assertEqual(len(s), 242)
        self.assertEqual(s[0].t, START)
        with open(FX / "report_2sat.txt", newline="") as f:
            rows = list(csv.reader(f))
        first = {h.strip(): v.strip() for h, v in zip(rows[0], rows[1])}
        g16 = next(x for x in s if x.prn == 16 and x.t == START)
        self.assertEqual((g16.s_km, g16.e_km, g16.z_km),
                         tuple(float(first[f"G16.THBKTopo.{c}"]) for c in "XYZ"))

    def test_duplicate_last_row_dropped(self):
        self.edit(lambda L: L + [L[-1] if L[-1].endswith("\n") else "\n" + L[-1]])
        self.assertEqual(len(read_report(self.work, [16, 22])), 242)

    def test_time_rounding(self):
        self.edit(lambda L: [l.replace("10 Nov 2026 00:00:30.000", "10 Nov 2026 00:00:29.999") for l in L])
        s = read_report(self.work, [16, 22])
        self.assertIn(START + timedelta(seconds=30), {x.t for x in s})
        self.assertTrue(all(x.t.microsecond == 0 for x in s))
        check_epochs(s, START, 1, 30)

    def test_missing_prn_column(self):
        with self.assertRaises(ReportError):
            read_report(self.work, [16, 22, 5])

    def test_missing_file(self):
        with self.assertRaises(ReportError):
            read_report(self.work / "nope", [16])


class TestCheckEpochs(ReportCase):
    def test_complete(self):
        check_epochs(read_report(self.work, [16, 22]), START, 1, 30)

    def test_gap(self):
        self.edit(lambda L: [l for l in L if "10 Nov 2026 00:10:00.000" not in l])
        with self.assertRaises(ReportError) as cm:
            check_epochs(read_report(self.work, [16, 22]), START, 1, 30)
        self.assertIn("00:10:00", str(cm.exception))

    def test_wrong_start(self):
        with self.assertRaises(ReportError):
            check_epochs(read_report(self.work, [16, 22]), START + timedelta(seconds=30), 1, 30)
```

- [ ] **Step 2: รันให้เห็นว่าไม่ผ่าน**

Run: `cd api-interop/gnss-predict && python3 -m unittest tests.test_report -v`
Expected: ERROR `No module named 'gnss_predict.report'`

- [ ] **Step 3: เขียน `report.py`**

- อ่านด้วย `csv` (delimiter `,`) และหาคอลัมน์จากชื่อใน header ตามรูปแบบที่บันทึกไว้ใน Task 6
  คอลัมน์เวลาเป็น `G%02d.UTCGregorian` ของดวงแรก คอลัมน์ตำแหน่งเป็น `G%02d.THBKTopo.X/Y/Z` ตัดช่องว่างรอบชื่อและค่าก่อนใช้
- ปัดเวลาไปวินาทีที่ใกล้ที่สุด แล้วตัดแถวที่เวลาซ้ำกันโดยเก็บแถวแรก
- `check_epochs`: เซตของเวลาที่ไม่ซ้ำต้องเท่ากับ `{start + i·step_s : i = 0 … hours·3600/step_s}` ทุกดวง
  ข้อความ error ต้องมีเวลาของ epoch แรกที่หายไปหรือเกินมา

- [ ] **Step 4: รันให้ผ่าน**

Run: `cd api-interop/gnss-predict && python3 -m unittest discover -s tests -v`
Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add api-interop/gnss-predict/gnss_predict/report.py api-interop/gnss-predict/tests/test_report.py
git commit -m "feat(gnss-predict): read GMAT report into SEZ samples and verify epoch grid"
```

---

### Task 9: `predict.py`, CLI และ integration test

**Files:**
- Create: `api-interop/gnss-predict/gnss_predict/predict.py`
- Create: `api-interop/gnss-predict/gnss_predict/__main__.py`
- Test: `api-interop/gnss-predict/tests/test_predict.py`
- Test: `api-interop/gnss-predict/tests/test_integration_gmat.py`

**Interfaces:**
- Consumes: ทุกอย่างจาก Task 1–3 และ 7–8
- Produces:
  - `parse_start(text: str | None, now: datetime) -> datetime`
  - `output_name(start: datetime, hours: float) -> str`
  - `rows_from_samples(samples: list[SezSample], min_el: float, shell_km: float) -> list[list[str]]`
  - `build_meta(start: datetime, hours: float, step_s: int, min_el: float, shell_km: float, tle_path: Path, entries: list[TleEntry], warnings: list[str], gmat_version: str, now: datetime) -> dict`
  - `write_outputs(rows: list[list[str]], meta: dict, out_dir: Path, name: str) -> Path`
  - `predict_samples(entries: list[TleEntry], tle_path: Path, start: datetime, hours: float, step_s: int, work_dir: Path, console: Path) -> list[SezSample]`
  - `__main__.main(argv: list[str] | None = None, now: datetime | None = None) -> int`

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน** `tests/test_predict.py`

```python
import json
import os
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

from gnss_predict.__main__ import main
from gnss_predict.predict import build_meta, output_name, parse_start, rows_from_samples, write_outputs
from gnss_predict.report import SezSample
from gnss_predict.tle_fetch import parse_tle_file

UTC = timezone.utc
NOW = datetime(2026, 11, 10, 15, 20, tzinfo=UTC)
FX = Path(__file__).parent / "fixtures"

class TestParseStart(unittest.TestCase):
    def test_cases(self):
        self.assertEqual(parse_start(None, NOW), datetime(2026, 11, 11, tzinfo=UTC))
        self.assertEqual(parse_start("2026-11-11", NOW), datetime(2026, 11, 11, tzinfo=UTC))
        self.assertEqual(parse_start("2026-11-11T06:30Z", NOW), datetime(2026, 11, 11, 6, 30, tzinfo=UTC))
        self.assertEqual(parse_start("2026-11-11T13:30+07:00", NOW), datetime(2026, 11, 11, 6, 30, tzinfo=UTC))
        self.assertEqual(parse_start("2026-11-11T06:30", NOW), datetime(2026, 11, 11, 6, 30, tzinfo=UTC))
        with self.assertRaises(ValueError):
            parse_start("tomorrow", NOW)

class TestNames(unittest.TestCase):
    def test_output_name(self):
        self.assertEqual(output_name(datetime(2026, 11, 11, tzinfo=UTC), 24), "thbk_gnss_pred_20261111T0000Z_24h.csv")
        self.assertEqual(output_name(datetime(2026, 11, 11, 6, 30, tzinfo=UTC), 1.5), "thbk_gnss_pred_20261111T0630Z_1.5h.csv")

class TestRows(unittest.TestCase):
    def test_rows_cross_midnight(self):
        s = [SezSample(datetime(2026, 11, 11, 0, 0, tzinfo=UTC), 5, 0.0, 0.0, 20200.0),
             SezSample(datetime(2026, 11, 10, 23, 59, 30, tzinfo=UTC), 5, 0.0, 0.0, 20200.0)]
        rows = rows_from_samples(s, 0.0, 400.0)
        self.assertEqual([r[:3] for r in rows], [["2026-11-10", "23:59:30", "G05"], ["2026-11-11", "00:00:00", "G05"]])

    def test_format_and_filter(self):
        t = datetime(2026, 11, 10, tzinfo=UTC)
        s = [SezSample(t, 22, 0.0, 0.0, 20200.0),          # El 90
             SezSample(t, 16, -20000.0, 0.0, 0.0),         # El 0 พอดี
             SezSample(t, 19, 0.0, 20000.0, -100.0)]       # El < 0
        rows = rows_from_samples(s, 0.0, 400.0)
        self.assertEqual([r[2] for r in rows], ["G16", "G22"])       # เรียงตาม PRN, El = min_el ยังอยู่
        self.assertRegex(rows[1][3], r"^\d{1,3}\.\d{3}$")             # Az ที่จุดเหนือศีรษะไม่มีนิยาม ตรวจแค่รูปแบบ
        self.assertEqual(rows[1][4:], ["90.000", "13.7298", "100.7812", "1.00000"])
        self.assertEqual(len(rows_from_samples(s, -90.0, 400.0)), 3)

class TestOutputs(unittest.TestCase):
    def test_meta_counts_invisible_prns_as_included(self):
        entries, _ = parse_tle_file(FX / "gps_sample.tle")
        m = build_meta(datetime(2026, 11, 10, tzinfo=UTC), 24, 30, 0.0, 400.0, FX / "gps_sample.tle",
                       entries, ["w"], "GMAT R2026a", NOW)
        self.assertEqual(m["prns_included"], [16, 19, 22])
        self.assertEqual(len(m["prns_missing"]), 29)
        self.assertNotIn(16, m["prns_missing"])
        self.assertEqual(m["start_utc"], "2026-11-10T00:00:00Z")
        self.assertEqual(len(m["tle_sha256"]), 64)

    def test_write_outputs(self):
        rows = [["2026-11-10", "00:00:00", "G16", "1.000", "2.000", "3.0000", "4.0000", "0.50000"],
                ["2026-11-10", "00:00:30", "G16", "1.000", "2.000", "3.0000", "4.0000", "0.50000"]]
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "out"                      # ยังไม่มี ต้องถูกสร้าง
            p = write_outputs(rows, {"k": "ค่า"}, out, "x.csv")
            self.assertEqual(p, out / "x.csv")
            raw = p.read_bytes()
            self.assertFalse(raw.startswith(b"\xef\xbb\xbf"))
            self.assertNotIn(b"\r", raw)
            lines = raw.decode("utf-8").splitlines()
            self.assertEqual(lines[0], "DAY,Time,PRN,Az,El,IPP_Lat,IPP_Lon,MF")
            self.assertEqual(len(lines), 3)
            self.assertEqual(json.loads((out / "x.meta.json").read_text(encoding="utf-8")), {"k": "ค่า"})
            write_outputs(rows[:1], {"k": 2}, out, "x.csv")   # เขียนทับ
            self.assertEqual(len(p.read_text().splitlines()), 2)
            self.assertEqual(list(out.glob("*.tmp")), [])

class TestMainWithoutGmat(unittest.TestCase):
    def test_old_tle_exits_1(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(main(["--start", "2026-12-20", "--tle-file", str(FX / "gps_2sat.tle"), "--out-dir", d], now=NOW), 1)

    def test_missing_gmat_exits_1(self):
        with tempfile.TemporaryDirectory() as d, mock.patch.dict(os.environ, {"GMAT_BIN": "/nonexistent/GmatConsole"}):
            self.assertEqual(main(["--start", "2026-11-10", "--tle-file", str(FX / "gps_2sat.tle"), "--out-dir", d], now=NOW), 1)

    def test_bad_start_exits_2(self):
        with self.assertRaises(SystemExit) as cm:
            main(["--start", "tomorrow"], now=NOW)
        self.assertEqual(cm.exception.code, 2)
```

- [ ] **Step 2: เขียน integration test** `tests/test_integration_gmat.py`

```python
import csv
import json
import math
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from gnss_predict.__main__ import main
from gnss_predict.errors import GmatNotFoundError
from gnss_predict.predict import predict_samples
from gnss_predict.run_gmat import find_gmat_console
from gnss_predict.tle_fetch import parse_tle_file

FX = Path(__file__).parent.resolve() / "fixtures"
START = datetime(2026, 11, 10, tzinfo=timezone.utc)


def gmat_available() -> bool:
    try:
        find_gmat_console()
        return True
    except GmatNotFoundError:
        return False


@unittest.skipUnless(gmat_available(), "ไม่มี GmatConsole")
class TestIntegration(unittest.TestCase):
    def test_predict_samples_ranges(self):
        entries, _ = parse_tle_file(FX / "gps_2sat.tle")
        with tempfile.TemporaryDirectory() as d:
            s = predict_samples(entries, FX / "gps_2sat.tle", START, 1, 30, Path(d), find_gmat_console())
        self.assertEqual(len(s), 242)
        for x in s:
            self.assertTrue(19000.0 < math.sqrt(x.s_km ** 2 + x.e_km ** 2 + x.z_km ** 2) < 27000.0)

    def test_cli_end_to_end(self):
        with tempfile.TemporaryDirectory() as d:
            rc = main(["--start", "2026-11-10T00:00Z", "--hours", "1", "--min-el", "-90",
                       "--tle-file", str(FX / "gps_2sat.tle"), "--out-dir", d])
            self.assertEqual(rc, 0)
            out = Path(d) / "thbk_gnss_pred_20261110T0000Z_1h.csv"
            with out.open(newline="") as f:
                rows = list(csv.reader(f))
            self.assertEqual(rows[0], ["DAY", "Time", "PRN", "Az", "El", "IPP_Lat", "IPP_Lon", "MF"])
            self.assertEqual(len(rows) - 1, 242)
            meta = json.loads((Path(d) / "thbk_gnss_pred_20261110T0000Z_1h.meta.json").read_text())
            self.assertEqual(meta["prns_included"], [16, 22])
            self.assertEqual(list(Path(d).glob("work-*")), [])
```

- [ ] **Step 3: รันให้เห็นว่าไม่ผ่าน**

Run: `cd api-interop/gnss-predict && python3 -m unittest tests.test_predict tests.test_integration_gmat -v`
Expected: ERROR `No module named 'gnss_predict.predict'`

- [ ] **Step 4: เขียน `predict.py`**

- `rows_from_samples`: แถวละ `[DAY, Time, "G%02d", Az "%.3f", El "%.3f", IPP_Lat "%.4f", IPP_Lon "%.4f", MF "%.5f"]`
  ใช้พิกัด THBK จาก config เก็บแถวที่ `El >= min_el` และเรียงตาม (DAY, Time, PRN)
- `build_meta`: ฟิลด์ตามหัวข้อ 7 ของ spec เวลาเป็น ISO แบบลงท้ายด้วย `Z` ส่วน `prns_missing` = PRN 1–32 ที่ไม่อยู่ใน `prns_included`
- `write_outputs`: ใช้ `csv.writer(lineterminator="\n")` และ `json.dump(indent=2, ensure_ascii=False)` เขียนลง `.tmp` ก่อนแล้วค่อย `os.replace`
  ถ้าไม่มี `out_dir` ให้สร้าง
- `predict_samples`: เขียน `render_script(...)` ลง `work_dir/visibility.script` จากนั้นเรียก `run_script(console, script, work_dir/"gmat.log")`,
  `read_report(work_dir, prns)` และ `check_epochs(...)` ตามลำดับ

- [ ] **Step 5: เขียน `__main__.py`** ตามตัวเลือกในหัวข้อ 5.7 ของ spec

ลำดับใน `main`:
1. parse args (`--start` ใช้ `parse_start` ถ้าเกิด `ValueError` ให้เรียก `parser.error` ซึ่งจะได้ exit 2)
2. ได้ไฟล์ TLE จาก `--tle-file` หรือ `fetch_gps_tle`
3. `parse_tle_file` ถ้าไม่มีรายการเลยให้ raise `TleUnavailableError`
4. `check_tle_age`
5. `find_gmat_console`
6. สร้าง `out_dir/work-<now:%Y%m%dT%H%M%SZ>/`
7. `predict_samples` ถ้าล้มเหลวให้เก็บ work dir ไว้และพิมพ์ path ของมัน
8. `rows_from_samples`
9. `build_meta` (ใช้ `gmat_version(console)`)
10. `write_outputs`
11. ลบ work dir ถ้าไม่ได้ใส่ `--keep-work`
12. พิมพ์ path ของ CSV และคำเตือนทั้งหมด

`GnssPredictError` ทุกตัวให้พิมพ์ข้อความลง stderr แล้วคืน 1 ส่วน path ของ `--tle-file`, `--cache-dir` และ `--out-dir`
ต้อง `.resolve()` ก่อนใช้ เพราะ GMAT รันโดยใช้ `application/bin` เป็นโฟลเดอร์ทำงาน
ท้ายไฟล์ต้องมี `if __name__ == "__main__": sys.exit(main())` เพื่อให้เทสต์ import `main` ได้โดยไม่รันทันที

- [ ] **Step 6: รันให้ผ่าน**

Run: `cd api-interop/gnss-predict && python3 -m unittest discover -s tests -v`
Expected: `OK` และ integration test ต้องรันจริง ไม่ใช่ถูกข้าม (ใน output ต้องไม่มี `skipped 'ไม่มี GmatConsole'`)

- [ ] **Step 7: Commit**

```bash
git add api-interop/gnss-predict/gnss_predict/predict.py api-interop/gnss-predict/gnss_predict/__main__.py api-interop/gnss-predict/tests
git commit -m "feat(gnss-predict): add prediction pipeline, CSV/meta output and CLI"
```

---

### Task 10: `validate.py`, acceptance และ README

**Files:**
- Create: `api-interop/gnss-predict/gnss_predict/validate.py`
- Create: `api-interop/gnss-predict/README.md`
- Test: `api-interop/gnss-predict/tests/test_validate.py`

**Interfaces:**
- Consumes: `predict_samples` (Task 9), `read_sp3`, `fetch_sp3`, `interpolate`, `prns_with_data`, `Sp3Orbit` (Task 4),
  `ecef_to_az_el`, `sez_to_az_el` (Task 1), `check_tle_age` (Task 2), ค่าเกณฑ์ใน config
- Produces:
  - `@dataclass(frozen=True) class Pair: prn: int; t: datetime; az_pred: float; el_pred: float; az_ref: float; el_ref: float`
  - `reference_az_el(orbit: Sp3Orbit, prn: int, t_utc: datetime) -> tuple[float, float] | None`
    (ใช้ `t_utc + GPS_UTC_OFFSET_S` วินาที, `THBK_ECEF_M / 1000` และพิกัด THBK)
  - `make_pairs(samples: list[SezSample], orbit: Sp3Orbit, min_el: float) -> list[Pair]`
  - `az_diff(a: float, b: float) -> float` คืน `((a − b + 180) % 360) − 180`
  - `summarize(pairs: list[Pair], prns_pred: set[int], prns_sp3: set[int]) -> dict` มีคีย์ `n`, `el_median`, `el_p99`, `az_n`,
    `az_median`, `az_p99`, `prns_not_in_sp3`, `prns_not_predicted`, `per_prn`, `failed_checks`, `passed`
  - `main(argv: list[str] | None = None) -> int`

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน** `tests/test_validate.py`

```python
import math
import unittest
from datetime import datetime, timedelta, timezone

from gnss_predict.config import THBK_ECEF_M, THBK_LAT_DEG, THBK_LON_DEG
from gnss_predict.geometry import ecef_to_az_el
from gnss_predict.report import SezSample
from gnss_predict.sp3 import Sp3Orbit
from gnss_predict.validate import Pair, az_diff, make_pairs, reference_az_el, summarize

T0 = datetime(2026, 11, 10, tzinfo=timezone.utc)
STA = tuple(c / 1000.0 for c in THBK_ECEF_M)

def pairs(n, d_el=0.0, d_az=0.0, el=45.0, prn=16):
    return [Pair(prn, T0 + timedelta(seconds=30 * i), 100.0 + d_az, el + d_el, 100.0, el) for i in range(n)]

class TestAzDiff(unittest.TestCase):
    def test_wrap(self):
        self.assertAlmostEqual(az_diff(359.9, 0.1), -0.2, places=9)
        self.assertAlmostEqual(az_diff(0.1, 359.9), 0.2, places=9)

class TestSummarize(unittest.TestCase):
    def test_perfect_passes(self):
        self.assertTrue(summarize(pairs(100), {16}, {16})["passed"])

    def test_el_median_fails(self):
        s = summarize(pairs(100, d_el=0.06), {16}, {16})
        self.assertFalse(s["passed"]); self.assertIn("el_median", s["failed_checks"])

    def test_el_p99_fails(self):
        s = summarize(pairs(98) + pairs(2, d_el=0.5), {16}, {16})
        self.assertAlmostEqual(s["el_median"], 0.0); self.assertIn("el_p99", s["failed_checks"])

    def test_az_ignored_near_zenith(self):
        self.assertTrue(summarize(pairs(50) + pairs(50, d_az=5.0, el=85.0), {16}, {16})["passed"])

    def test_predicted_prn_missing_from_sp3_fails(self):
        s = summarize(pairs(100), {16, 5}, {16})
        self.assertIn("prns_not_in_sp3", s["failed_checks"]); self.assertEqual(s["prns_not_in_sp3"], [5])

    def test_extra_sp3_prn_only_reported(self):
        s = summarize(pairs(100), {16}, {16, 7})
        self.assertTrue(s["passed"]); self.assertEqual(s["prns_not_predicted"], [7])

    def test_too_few_pairs_fails(self):
        self.assertFalse(summarize(pairs(1), {16}, {16})["passed"])

EPOCHS = [T0 + timedelta(minutes=15 * i) for i in range(30)]

def moving(t):
    # จุดเริ่มอยู่ห่างสถานี 20000 กม. ตามแกน z แล้วเคลื่อนที่ตามแกน y 3.9 กม./วินาที
    # ทิศที่มองจากสถานีจึงเปลี่ยนตามเวลา (ถ้าเคลื่อนที่ในแนวเส้นตรงผ่านสถานี มุมจะคงที่และเทสต์จะตรวจอะไรไม่ได้)
    dt = (t - T0).total_seconds()
    return (STA[0], STA[1] + 3.9 * dt, STA[2] + 20000.0)

def enu_point(el_deg, az_deg, rng=20000.0):
    la, lo = math.radians(THBK_LAT_DEG), math.radians(THBK_LON_DEG)
    up = (math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la))
    north = (-math.sin(la) * math.cos(lo), -math.sin(la) * math.sin(lo), math.cos(la))
    east = (-math.sin(lo), math.cos(lo), 0.0)
    e, a = math.radians(el_deg), math.radians(az_deg)
    return tuple(STA[j] + rng * (math.cos(e) * math.cos(a) * north[j] + math.cos(e) * math.sin(a) * east[j]
                                 + math.sin(e) * up[j]) for j in range(3))

class TestReference(unittest.TestCase):
    def test_uses_gps_time_offset(self):
        orbit = Sp3Orbit("GPS", EPOCHS, {16: [moving(e) for e in EPOCHS]})   # เส้นตรง Lagrange จึงคืนค่าได้ตรง
        t = T0 + timedelta(hours=3, minutes=7)
        got = reference_az_el(orbit, 16, t)
        exp = ecef_to_az_el(moving(t + timedelta(seconds=18)), STA, THBK_LAT_DEG, THBK_LON_DEG)
        self.assertAlmostEqual(got[0], exp[0], places=6)
        self.assertAlmostEqual(got[1], exp[1], places=6)
        wrong = ecef_to_az_el(moving(t), STA, THBK_LAT_DEG, THBK_LON_DEG)
        self.assertGreater(abs(got[0] - wrong[0]) + abs(got[1] - wrong[1]), 1e-3)

    def test_make_pairs_filters_min_el(self):
        orbit = Sp3Orbit("GPS", EPOCHS, {16: [enu_point(60.0, 30.0)] * 30, 22: [enu_point(5.0, 0.0)] * 30})
        t = T0 + timedelta(hours=3)
        samples = [SezSample(t, 16, 0.0, 0.0, 20200.0), SezSample(t, 22, -20000.0, 0.0, 0.0)]
        got = make_pairs(samples, orbit, 10.0)
        self.assertEqual([p.prn for p in got], [16])
        self.assertAlmostEqual(got[0].el_ref, 60.0, places=6)
        self.assertAlmostEqual(got[0].az_ref, 30.0, places=6)
        self.assertAlmostEqual(got[0].el_pred, 90.0, places=6)
```

- [ ] **Step 2: รันให้เห็นว่าไม่ผ่าน**

Run: `cd api-interop/gnss-predict && python3 -m unittest tests.test_validate -v`
Expected: ERROR `No module named 'gnss_predict.validate'`

- [ ] **Step 3: เขียน `validate.py`**

- `summarize`: ใช้ |ΔEl| ทุกคู่ และ |ΔAz| เฉพาะคู่ที่ `el_ref < AZ_EL_LIMIT`
  ค่ากลางใช้ `statistics.median` และ P99 ใช้ `statistics.quantiles(v, n=100, method="inclusive")[98]`
  ถ้าชุดข้อมูลใดมีไม่ถึง 2 ค่า ให้ใส่ชื่อ check นั้นใน `failed_checks`
  check ทั้งหมดคือ `el_median` (≤ `EL_MEDIAN_MAX`), `el_p99` (≤ `EL_P99_MAX`), `az_median` (≤ `AZ_MEDIAN_MAX`),
  `az_p99` (≤ `AZ_P99_MAX`) และ `prns_not_in_sp3` (ต้องว่าง)
  `per_prn[prn]` เก็บ `n`, `el_median`, `el_max`, `az_median`
- `main`: ตัวเลือกตามหัวข้อ 5.9 ของ spec มีลำดับดังนี้
  1. อ่าน TLE
  2. หาวันตรวจจาก `--day` หรือจากวันที่ของ `epochs[0]` ใน SP3 แล้วเรียก
     `check_tle_age(entries, วันตรวจ 00:00, 24, VALIDATION_MAX_TLE_AGE_DAYS, VALIDATION_MAX_TLE_AGE_DAYS)`
  3. ได้ orbit จาก `read_sp3(--sp3 หรือ fetch_sp3(day, cache_dir))`
  4. รัน `predict_samples` ทั้งวันทุก `STEP_S`
  5. `make_pairs(min_el=--min-el)` แล้ว `summarize`
  6. เขียน `validation_<YYYY-MM-DD>.json` และ `.md` (ตารางรวมและตารางรายดวง) ลง `out_dir`
  7. พิมพ์สรุปแล้วคืน 0 ถ้า `passed` ไม่อย่างนั้นคืน 1 ส่วน `GnssPredictError` ให้คืน 1

- [ ] **Step 4: รันให้ผ่าน**

Run: `cd api-interop/gnss-predict && python3 -m unittest discover -s tests -v`
Expected: `OK` (ไม่มีเทสต์ที่ถูกข้าม)

- [ ] **Step 5: Commit**

```bash
git add api-interop/gnss-predict/gnss_predict/validate.py api-interop/gnss-predict/tests/test_validate.py
git commit -m "feat(gnss-predict): validate predictions against IGS SP3 orbits"
```

- [ ] **Step 6: Acceptance ส่วนที่ 1: พยากรณ์จริงด้วย TLE ที่ดาวน์โหลดสด**

Run: `cd api-interop/gnss-predict && python3 -m gnss_predict --out-dir output/accept; echo "exit=$?"`
Expected: `exit=0` มี CSV และ meta ใน `output/accept/` และใน `cache/` มีไฟล์ `gps_<เวลา>.tle` ใหม่
ใน meta `prns_included` ควรมีราว 31–32 ดวง และคำเตือนต้องอธิบายได้

- [ ] **Step 7: Acceptance ส่วนที่ 2: ตรวจกับ SP3**

1. หาวันล่าสุดที่ CDDIS มี `IGS0OPSRAP` หรือ `FIN` (ใช้คำสั่ง list แบบใน Task 4 Step 2 กับสัปดาห์ปัจจุบันและสัปดาห์ก่อน)
   และวันนั้นต้องทำให้ TLE จาก Step 6 อายุไม่เกิน 2 วัน
2. Run: `python3 -m gnss_predict.validate --tle-file cache/<ไฟล์จาก Step 6> --day <YYYY-MM-DD> --out-dir output/accept; echo "exit=$?"`

Expected: `exit=0` และ `output/accept/validation_<วัน>.json` มี `"passed": true`
**ถ้าไม่ผ่าน:** หยุดและใช้ superpowers:systematic-debugging ห้ามปรับเกณฑ์และห้ามตัดดวงออก
ให้รายงานผู้ใช้พร้อมตารางรายดวงก่อนทำอย่างอื่น

- [ ] **Step 8: เขียน `README.md`** (ภาษาไทย) ให้มีหัวข้อต่อไปนี้
  - งานนี้ทำอะไร พร้อมลิงก์ไป spec
  - วิธี build GMAT แบบย่อ (คำสั่งจาก Task 5) และวิธีตั้ง `GMAT_BIN`
  - วิธีใช้ `python3 -m gnss_predict` พร้อมตัวเลือกทั้งหมดและตัวอย่าง CSV 3 แถวจาก Step 6
  - ความหมายของแต่ละคอลัมน์ (หัวข้อ 7 ของ spec) และนิยาม MF ว่า VTEC = STEC × MF
  - วิธีตรวจด้วย `gnss_predict.validate` พร้อมตัวเลขจริงจาก Step 7 (วันที่, จำนวนคู่, el_median, el_p99, az_median, az_p99)
  - ข้อจำกัด: เฉพาะ GPS, ความแม่นยำยืนยันแล้วเฉพาะกรณี TLE อายุไม่เกิน 2 วัน และไม่รู้สถานะ healthy ของดาวเทียม

- [ ] **Step 9: ตรวจขั้นสุดท้าย**

Run: `cd api-interop/gnss-predict && python3 -m unittest discover -s tests -v && git -C ../.. status --short`
Expected: เทสต์ผ่านทั้งหมด และไฟล์ที่เปลี่ยนมีแค่ `api-interop/gnss-predict/README.md`
(รวมทั้ง `.markdown-collab/` และ `.vscode/` ที่มีอยู่ก่อนแล้ว) ต้องไม่มีอะไรใน `cache/` หรือ `output/` โผล่ขึ้นมา

- [ ] **Step 10: Commit**

```bash
git add api-interop/gnss-predict/README.md
git commit -m "docs(gnss-predict): add README with build, usage and SP3 validation results"
```
