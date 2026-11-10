# GNSS Studio Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ขยาย `gnss_predict` ให้พยากรณ์ GPS, GLONASS, Galileo, BeiDou จากข้อมูล OMM และเขียนไฟล์ผลลัพธ์ (SP3-d, CZML, AER, access, DOP) ที่ server และหน้าเว็บของ GNSS Studio ใช้ได้

**Architecture:** Python standard library ล้วน ดึง OMM จาก CelesTrak, IGS metadata และ broadcast จาก CDDIS เก็บเป็น snapshot
แล้ว `propagate` รัน GMAT `SPICESGP4` ครั้งเดียวได้ตำแหน่ง EarthFixed ของทุกดวง ส่วน `analyze` คำนวณ AER/IPP/MF, ช่วง access
และ DOP ใน Python ทุกผลลัพธ์เขียนเป็นโฟลเดอร์แบบ atomic ที่ตั้งชื่อด้วย hash ของข้อมูลตั้งต้น

**Tech Stack:** Python ≥ 3.10 (standard library เท่านั้น, ทดสอบด้วย `unittest`), GMAT R2026a GmatConsole, curl (FTPS ไป CDDIS)

**Spec:** [2026-11-11-gnss-studio-engine-design.md](2026-11-11-gnss-studio-engine-design.md) และภาพรวม [2026-11-11-gnss-studio-design.md](2026-11-11-gnss-studio-design.md) อ่านคู่กับแผนนี้เสมอ
(ในแผนนี้ "spec §n" หมายถึง spec engine, "ภาพรวม §n" หมายถึง design ภาพรวม)

## Global Constraints

- ทำงานบน branch `feature/gnss-studio-engine` ห้าม push และห้าม merge เข้า `main`
- ไฟล์ใหม่ทั้งหมดอยู่ใต้ `api-interop/gnss-predict/` ห้ามแก้ไฟล์ของ GMAT
- Python ≥ 3.10, standard library เท่านั้น ห้ามเพิ่ม dependency
- รัน test จาก `api-interop/gnss-predict` ด้วย `python3 -m unittest discover -s tests -v`
- unit test ห้ามใช้เน็ต test ที่ต้องใช้ GMAT ใช้ `@unittest.skipUnless(gmat_available(), "ไม่มี GmatConsole")` แบบ `tests/test_integration_gmat.py`
- เวลาเป็น `datetime` ที่มี `tzinfo=timezone.utc` เวลา GPST ใน SP3 ใช้ `datetime` ที่มี `tzinfo=timezone.utc` แบบเดียวกับ `sp3._parse_epoch` เดิม แต่ตั้งชื่อตัวแปรลงท้าย `_gpst`
- GPS − UTC = `GPS_UTC_OFFSET_S` (18) จาก `config.py` เท่านั้น
- ห้ามใช้ `%b` หรือ `strptime` กับชื่อเดือน ใช้ `gmat_time.py`
- ค่าคงที่ทุกตัวอยู่ใน `config.py` (spec §5.1)
- ข้อความถึงผู้ใช้เป็นภาษาไทย ชื่อในโค้ดและรหัส Message เป็นภาษาอังกฤษตาม spec §9
- กติกา CelesTrak: ส่ง request ได้ไม่เกิน 1 ครั้งต่อกลุ่มต่อ 7200 วินาที และห้ามลองซ้ำหลังได้คำตอบที่ใช้ไม่ได้
- ไฟล์ CSV และ JSON เป็น UTF-8 ไม่มี BOM ขึ้นบรรทัดด้วย `\n`
- ห้าม commit ข้อมูลที่ดาวน์โหลดมา (`data/`, `cache/`, `output/`) ยกเว้น fixture ที่ตัดย่อแล้วใน `tests/fixtures/studio/`
- commit message แบบ conventional ภาษาอังกฤษ และลงท้ายด้วย `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## Review Focus

1. **CelesTrak ตอบ 200 แต่เนื้อหาไม่ใช่ JSON ของ OMM** (เช่น "GP data has not updated since your last successful download") ต้องไม่เขียน cache, ใช้ไฟล์เดิม, เตือน และบันทึกเวลา request เพื่อไม่ส่งซ้ำใน 2 ชม. → Task 2 `test_fetch_non_json_body_falls_back`
2. **PRN เปลี่ยนหรือว่างกลางช่วงวิเคราะห์** (R809: R28 ถึง 2026-10-20 05:30:00, ไม่มี PRN 1 นาที, แล้วเป็น R10) → Task 3 `test_prn_changes_with_gap`, Task 7 `test_prn_changed_flag`
3. **ชื่อ object ที่ใช้เป็นชื่อโฟลเดอร์และ id ของ CZML ไม่ได้** (เช่น `TH/BK`) ต้องได้ `ScenarioError` → Task 6 `test_unsafe_name_rejected`
4. **มุมเงยแตะเกณฑ์พอดีหรืออยู่เหนือเกณฑ์ตลอดช่วง** ต้องไม่เกิดช่วง access ยาว 0 และช่วงที่ชนขอบถูกตัดที่ขอบ → Task 10 `test_threshold_touch_dropped`, `test_always_visible_clipped_to_period`
5. **snapshot ไม่มีไฟล์ของระบบที่ขอ** ต้องได้ `OrbitUnavailableError` ที่บอกชื่อกลุ่ม → Task 7 `test_missing_group_file_raises`

## การตัดสินใจในแผนที่ spec ไม่ได้กำหนดไว้

| # | เรื่อง | ที่เลือก |
|---|---|---|
| D1 | state ของกติกา CelesTrak | บันทึก `last_request` ทุกครั้งที่ได้คำตอบจาก server (ทุก status รวม 200 ที่ใช้ไม่ได้) และ `last_success` ข้ามการส่งเมื่อ `now − last_request < 7200` ส่วน error ที่ต่อ server ไม่ได้เลยไม่บันทึก |
| D2 | `fetch_group` | เพิ่มพารามิเตอร์ `url: str \| None = None` เพื่อให้ CLI เดิมและ test ใช้ `file://` ได้ |
| D3 | `parse_ecef_report`, `propagate` | คืน `tuple[Ephemeris, list[Message]]` และตรวจ grid เวลา (spec เขียนคืน `Ephemeris` อย่างเดียว) |
| D4 | `build_manifest` | เพิ่ม `propagated: frozenset[str]` และ `now: datetime \| None` เพื่อเติมช่อง `propagated` และ `created_utc` |
| D5 | Facility ที่ไม่มี constraint | `min_el_deg = 0.0` (STK ไม่มี constraint ตั้งต้น) |
| D6 | ชื่อ object | ต้องตรง `^[A-Za-z0-9_-]{1,32}$` เพราะใช้เป็นชื่อโฟลเดอร์และ id ของ CZML |
| D7 | ช่วง access ยาว 0 วินาที (แตะเกณฑ์จุดเดียว) | ตัดทิ้ง |
| D8 | ดาวใน scenario ที่ไม่มีใน snapshot | คำเตือนรหัสใหม่ `SAT_NOT_IN_SNAPSHOT` |
| D9 | SP3 จริงสำหรับตรวจ | เลือกตามลำดับ `COD0MGXFIN`, `GFZ0MGXRAP`, `WUM0MGXRAP` |
| D10 | `run_analyze` เมื่อยังไม่มีผล propagate | เรียก `run_propagate` ก่อน (ถ้ามีผลเดิมจะใช้ผลเดิมทันที) |
| D11 | ค่าจริงของ DOP | สูตรปิดที่แก้ด้วยมือ แทนการรัน RTKLIB (การ compile โค้ดภายนอกถูกปฏิเสธสิทธิ์) spec §10 แก้ตามแล้ว |
| D12 | `write_sp3` | รับ `times_utc` และ `positions_km` แทน `Ephemeris` เพื่อไม่ให้ `sp3.py` import `propagate.py` |
| D13 | `validate_ephemeris` | เพิ่มพารามิเตอร์ `day: date` เพื่อเลือกเวลาที่เทียบ |
| D14 | health เมื่อ toc ล่าสุดมีหลาย record (Galileo I/NAV และ F/NAV) | `healthy = False` ถ้ามี record ใดที่ toc ล่าสุดมี health ≠ 0 |

## ลำดับงาน

| Task | งาน | ต้องมี GMAT |
|---|---|---|
| 1 | config, errors, geometry, fixture | ไม่ |
| 2 | omm | ไม่ |
| 3 | igs_meta | ไม่ |
| 4 | sp3 หลายระบบ | ไม่ |
| 5 | brdc | ไม่ |
| 6 | scenario | ไม่ |
| 7 | catalog | ไม่ |
| 8 | propagate (script และ parser) | ไม่ |
| 9 | czml | ไม่ |
| 10 | analyze | ไม่ |
| 11 | dop | ไม่ |
| 12 | bundle | ไม่ |
| 13 | studio: fetch / propagate / analyze + CLI | integration test |
| 14 | validate หลายระบบ | ไม่ (acceptance ใช้ GMAT) |
| 15 | CLI เดิมเปลี่ยนเป็น OMM | ไม่ |
| 16 | acceptance และ README | ใช่ |

ที่อยู่ไฟล์ต้นทางของ fixture (ดาวน์โหลดไว้ระหว่างออกแบบ อยู่ใน scratchpad ของ session นี้) เรียกว่า `$SRC`:
`/private/tmp/claude-501/-Users-phuwish-SSSGMAT/4101fd12-eb9f-4cfc-a992-f9723bb8b725/scratchpad`

---

### Task 1: config, errors, geometry และ fixture

**Files:**
- Modify: `gnss_predict/config.py`, `gnss_predict/errors.py`, `gnss_predict/geometry.py`, `.gitignore` (เพิ่มบรรทัด `data/`)
- Create: `tests/fixtures/studio/extract_fixtures.py`, `tests/fixtures/studio/SOURCES.md` และไฟล์ fixture ตามขั้นที่ 1
- Test: `tests/test_geometry.py` (เพิ่ม), `tests/test_errors.py`, `tests/test_fixtures_studio.py`

**Interfaces:**
- Produces:
  - `config.py`: ค่าตาม spec §5.1 ทุกตัว (`CELESTRAK_GP_URL`, `GNSS_GROUPS`, `CELESTRAK_MIN_INTERVAL_S = 7200`, `IGS_META_URL`, `CDDIS_BRDC_URL`, `AGE_OK_DAYS = 2.0`, `AGE_SHOWN_MAX_DAYS = 7.0`, `BRDC_MAX_TK_S = 14400`, `CZML_STEP_S = 300`, `CZML_LAGRANGE_DEGREE = 7`, `DATA_DIR`, `ENGINE_VERSION = "0.2.0"`) และ `MGX_SP3_PREFERENCE = ("COD0MGXFIN", "GFZ0MGXRAP", "WUM0MGXRAP")`, `WGS84_A_KM = 6378.137`, `WGS84_F = 1 / 298.257223563`
  - `errors.py`:
    - `@dataclass(frozen=True) class Message: code: str; level: str; text: str; object: str | None = None` และ `to_dict() -> dict` (key `code, level, text, object`)
    - class ใหม่สืบจาก `GnssPredictError` มี attribute ระดับ class `code`: `OrbitUnavailableError` (`ORBIT_SOURCE_UNAVAILABLE`), `IgsMetadataUnavailableError` (`IGS_META_UNAVAILABLE`), `ScenarioError` (`SCENARIO_INVALID`, constructor `ScenarioError(text: str, field: str)` เก็บ `.field`), `NoSatellitesError` (`NO_SATELLITES`), `BrdcUnavailableError` (`BRDC_UNAVAILABLE`)
    - เพิ่ม `code` ให้ class เดิม: `GmatNotFoundError` = `GMAT_NOT_FOUND`, `GmatRunError` = `GMAT_FAILED`, `Sp3UnavailableError` = `TRUTH_UNAVAILABLE`
  - `geometry.py`: `geodetic_to_ecef(lat_deg: float, lon_deg: float, h_m: float) -> tuple[float, float, float]` (กม., WGS84 ตาม spec §7.1), `ecef_to_aer(sat_km, sta_km, lat_deg, lon_deg) -> tuple[float, float, float]` (Az, El จาก `ecef_to_az_el` เดิม และ range กม.)
  - fixture ใน `tests/fixtures/studio/`:
    - `omm_sample.json`: OMM 10 ดวง NORAD 62339, 26407, 37846, 40129, 43508, 56564, 44542, 41434, 36828, 100744
    - `tle_sample.tle`: TLE 3 บรรทัดของ 9 ดวงแรก (ไม่มี 100744) คงบรรทัดเดิมจากไฟล์ที่ดาวน์โหลด
    - `snapshot/gps-ops.json` [62339, 26407], `snapshot/glo-ops.json` [43508, 100744], `snapshot/galileo.json` [37846, 40129], `snapshot/beidou.json` [56564, 44542, 41434, 36828]
    - `snapshot/igs_satellite_metadata.snx`: header บรรทัดแรก, ส่วน `SATELLITE/IDENTIFIER` และ `SATELLITE/PRN` ที่มีเฉพาะ SVN G080, G044, E101, E202, R856, R809, C231, C222, C017, C005 (คงบรรทัด `+`/`-`/`*` ของสองส่วนนี้)
    - `snapshot/brdc/BRDC00IGS_R_20263130000_01D_MN.rnx`: header เดิม + record ทั้งหมดของ G01, R05, R13, C01, C09, C19, C38, C40 + record ของ E11 และ E14 ที่ epoch ≤ 2026-11-09 04:00:00 (ไม่มี G22 และ R10 โดยตั้งใจ)
    - `mgx_sample.sp3`: header เดิมของ GFZ + epoch 2026-11-09 00:00–03:00 (37 epoch) เฉพาะบรรทัด P ของ C19, C38, E11, G01, R05

- [ ] **Step 1: เขียน `extract_fixtures.py` (รับ path ต้นทางเป็น argument) แล้วสร้าง fixture**

```bash
python3 -I tests/fixtures/studio/extract_fixtures.py \
  --omm $SRC/omm-dl/gnss.json --tle-dir $SRC/spike-acc/data/tle \
  --meta $SRC/spike-acc/data/meta/igs_satellite_metadata.snx \
  --nav $SRC/spike-acc/data/nav/BRDC00IGS_R_20263130000_01D_MN.rnx.gz \
  --sp3 $SRC/spike-acc/data/sp3/GFZ0MGXRAP_20263130000_01D_05M_ORB.SP3.gz \
  --out tests/fixtures/studio
```

ถ้าไฟล์ใน `$SRC` ไม่มีแล้ว ให้หยุดและแจ้งผู้ใช้ ห้ามดาวน์โหลดจาก CelesTrak ซ้ำโดยไม่ถาม
`SOURCES.md` บันทึกชื่อไฟล์ต้นทาง, URL ต้นทาง (ภาพรวม §7.4 และ `https://celestrak.org/NORAD/elements/gp.php?GROUP=gnss&FORMAT=json`) และกฎการตัด

- [ ] **Step 2: เขียน test ที่ fail**

```python
# tests/test_geometry.py (เพิ่ม)
def test_geodetic_to_ecef_matches_thbk_header(self):
    x, y, z = geodetic_to_ecef(THBK_LAT_DEG, THBK_LON_DEG, THBK_HEIGHT_M)
    for got, ref in zip((x, y, z), THBK_ECEF_M):
        self.assertAlmostEqual(got, ref / 1000, delta=0.001)       # ≤ 1 ม. (ผลจริงราว 6 ซม.)

def test_ecef_to_aer_zenith(self):
    sta = geodetic_to_ecef(0.0, 0.0, 0.0)
    az, el, rng = ecef_to_aer((sta[0] + 20000.0, sta[1], sta[2]), sta, 0.0, 0.0)
    self.assertAlmostEqual(el, 90.0, places=6); self.assertAlmostEqual(rng, 20000.0, places=6)

# tests/test_errors.py
def test_message_to_dict(self):
    m = Message("SAT_FLAGGED", "warning", "ข้อความ", "C40")
    self.assertEqual(m.to_dict(), {"code": "SAT_FLAGGED", "level": "warning", "text": "ข้อความ", "object": "C40"})

def test_codes(self):
    self.assertEqual(OrbitUnavailableError.code, "ORBIT_SOURCE_UNAVAILABLE")
    self.assertEqual(GmatRunError.code, "GMAT_FAILED")
    e = ScenarioError("ผิด", field="objects[0].name"); self.assertEqual(e.field, "objects[0].name")
    self.assertTrue(issubclass(NoSatellitesError, GnssPredictError))

# tests/test_fixtures_studio.py
def test_fixture_contents(self):
    omm = json.loads((FXS / "omm_sample.json").read_text())
    self.assertEqual({int(o["NORAD_CAT_ID"]) for o in omm},
                     {62339, 26407, 37846, 40129, 43508, 56564, 44542, 41434, 36828, 100744})
    self.assertEqual(sum(1 for l in (FXS / "tle_sample.tle").read_text().splitlines() if l.startswith("1 ")), 9)
    for g in ("gps-ops", "glo-ops", "galileo", "beidou"):
        self.assertTrue((FXS / "snapshot" / f"{g}.json").is_file())
```

- [ ] **Step 3: รัน test ให้เห็นว่า fail**

Run: `python3 -m unittest tests.test_geometry tests.test_errors tests.test_fixtures_studio -v`
Expected: FAIL / ImportError ที่ `geodetic_to_ecef`, `Message`

- [ ] **Step 4: เขียนโค้ดใน `config.py`, `errors.py`, `geometry.py`**

- [ ] **Step 5: รัน test ทั้งชุด**

Run: `python3 -m unittest discover -s tests -v`
Expected: PASS ทั้งหมด (test เดิม 83 ข้อ + test ใหม่)

- [ ] **Step 6: Commit**

```bash
git add .gitignore gnss_predict/config.py gnss_predict/errors.py gnss_predict/geometry.py tests/
git commit -m "feat(gnss-studio): add engine config, messages, WGS84 helpers and trimmed fixtures"
```

---

### Task 2: `omm.py`

**Files:**
- Create: `gnss_predict/omm.py`
- Test: `tests/test_omm.py`

**Interfaces:**
- Consumes: `Message`, `OrbitUnavailableError` (Task 1), `tle_fetch.tle_checksum` (เดิม)
- Produces:
  - `@dataclass(frozen=True) class OmmRecord: norad: int; name: str; object_id: str; epoch: datetime; raw: dict`
  - `read_omm(path: Path) -> list[OmmRecord]` (ข้อมูลที่ไม่ใช่ JSON array ของ object ที่มี `NORAD_CAT_ID` และ `EPOCH` → `ValueError`)
  - `catalog_field(norad: int) -> str`
  - `to_tle_lines(rec: OmmRecord) -> tuple[str, str]`
  - `fetch_group(group: str, dest_dir: Path, state_file: Path, now: datetime, opener=urlopen, timeout_s: float = 30, url: str | None = None) -> tuple[Path, list[Message]]` ไฟล์ที่เขียนชื่อ `<group>_<YYYYMMDDTHHMMZ>.json` ใน `dest_dir` "ไฟล์ล่าสุด" คือชื่อที่เรียงแล้วมากที่สุดของ `<group>_*.json`
  - state file: `{"<group>": {"last_request": "<ISO Z>", "last_success": "<ISO Z>"}}` (D1)

- [ ] **Step 1: เขียน test ที่ fail**

```python
def test_to_tle_lines_matches_celestrak(self):            # ค่าจริง: TLE ที่ดาวน์โหลดคู่กัน
    tle = {int(l1[2:7]): (l1, l2) for l1, l2 in pairs(FXS / "tle_sample.tle")}   # rstrip แล้ว
    recs = [r for r in read_omm(FXS / "omm_sample.json") if r.norad in tle]
    self.assertEqual(len(recs), 9)                       # รวม 26407 ที่ต้องตัดความเยื้องศูนย์กลาง
    for r in recs:
        self.assertEqual(to_tle_lines(r), tle[r.norad], r.norad)

def test_catalog_field(self):
    self.assertEqual(catalog_field(5), "00005"); self.assertEqual(catalog_field(99999), "99999")
    self.assertEqual(catalog_field(100000), "A0000"); self.assertEqual(catalog_field(100744), "A0744")
    self.assertEqual(catalog_field(339999), "Z9999")
    with self.assertRaises(ValueError): catalog_field(340000)

def test_six_digit_record_uses_alpha5(self):
    r = next(r for r in read_omm(FXS / "omm_sample.json") if r.norad == 100744)
    l1, l2 = to_tle_lines(r)
    self.assertEqual((l1[2:7], l2[2:7]), ("A0744", "A0744"))
    self.assertEqual(int(l1[68]), tle_checksum(l1)); self.assertEqual(int(l2[68]), tle_checksum(l2))

def test_read_omm_epoch_is_utc(self):
    r = next(r for r in read_omm(FXS / "omm_sample.json") if r.norad == 62339)
    self.assertEqual(r.epoch, datetime(2026, 11, 10, 4, 12, 45, 624384, tzinfo=timezone.utc))

# fetch: opener ปลอมนับจำนวนครั้ง คืน body จาก snapshot/gps-ops.json หรือ raise HTTPError
def test_fetch_writes_cache_and_state(self): ...          # ไฟล์ gps-ops_20261111T0600Z.json, state มี last_request/last_success, messages []
def test_fetch_within_interval_skips_request(self): ...   # เรียกซ้ำที่ now + 7199 s: opener ถูกเรียก 1 ครั้งรวม, คืนไฟล์เดิม, Message ORBIT_RATE_LIMITED_LOCAL level info
def test_fetch_after_interval_requests_again(self): ...   # now + 7200 s: opener ถูกเรียกครั้งที่ 2
def test_fetch_403_falls_back_without_retry(self): ...    # HTTPError 403: opener ถูกเรียก 1 ครั้ง, คืนไฟล์ล่าสุดเดิม, ORBIT_DOWNLOAD_FAILED warning, last_request อัปเดต, last_success เดิม
def test_fetch_non_json_body_falls_back(self): ...        # Review Focus 1: body b"GP data has not updated since your last successful download\n" → ไม่มีไฟล์ใหม่, คืนไฟล์เดิม, warning, last_request อัปเดต
def test_fetch_no_cache_raises(self): ...                 # URLError และไม่มีไฟล์ → OrbitUnavailableError, state ไม่ถูกเขียน
```

- [ ] **Step 2: รันให้ fail**

Run: `python3 -m unittest tests.test_omm -v`
Expected: ImportError `gnss_predict.omm`

- [ ] **Step 3: เขียน `omm.py`**

รูปแบบ TLE (คอลัมน์นับจาก 1) ที่ test ข้างบนบังคับ:
- บรรทัด 1: `1 ` + catalog_field + `CLASSIFICATION_TYPE` + ` ` + international designator 8 ช่อง (ปี 2 หลัก + เลขปล่อย 3 หลัก + ชิ้นส่วนชิดซ้าย) + ` ` + epoch `YYDDD.DDDDDDDD` (`{doy:012.8f}`) + ` ` + `MEAN_MOTION_DOT` 10 ช่อง (เครื่องหมายหรือช่องว่าง + `.dddddddd`) + ` ` + `MEAN_MOTION_DDOT` + ` ` + `BSTAR` (ทั้งสองแบบทศนิยมสมมติ 8 ช่อง เช่น ` 00000+0`, ` 12345-3`: mantissa 5 หลักจาก `f"{abs(x):.4e}"`, exponent + 1) + ` ` + `EPHEMERIS_TYPE` + ` ` + `ELEMENT_SET_NO` ชิดขวา 4 ช่อง + checksum
- บรรทัด 2: `2 ` + catalog_field + ` ` + INCLINATION `8.4f` + ` ` + RA_OF_ASC_NODE `8.4f` + ` ` + ความเยื้องศูนย์กลาง 7 หลัก **ตัด** (`int(e * 1e7 + 1e-6)` เติม 0 นำหน้า) + ` ` + ARG_OF_PERICENTER `8.4f` + ` ` + MEAN_ANOMALY `8.4f` + ` ` + MEAN_MOTION `11.8f` + REV_AT_EPOCH ชิดขวา 5 ช่อง + checksum

- [ ] **Step 4: รันให้ผ่าน**

Run: `python3 -m unittest tests.test_omm -v`
Expected: PASS

- [ ] **Step 5: Commit** `feat(gnss-studio): fetch CelesTrak OMM with rate limiting and convert to TLE lines`

---

### Task 3: `igs_meta.py`

**Files:**
- Create: `gnss_predict/igs_meta.py`
- Test: `tests/test_igs_meta.py`

**Interfaces:**
- Consumes: `Message`, `IgsMetadataUnavailableError` (Task 1)
- Produces:
  - `@dataclass(frozen=True) class SatIdentity: prn: str; svn: str; norad: int; cospar: str; block: str`
  - `class IgsMetadata` มี `identity_at(norad: int, t: datetime) -> SatIdentity | None` และ `prn_changes(norad: int, start: datetime, stop: datetime) -> list[tuple[datetime, str | None]]` (ทุกจุดใน (start, stop] ที่ PRN เปลี่ยน รวมจุดที่กลายเป็นไม่มี PRN)
  - `read_metadata(path: Path) -> IgsMetadata`
  - `fetch_metadata(dest_dir: Path, now: datetime, opener=urlopen, timeout_s: float = 60) -> tuple[Path, list[Message]]` ไฟล์ชื่อ `igs_satellite_metadata_<YYYYMMDDTHHMMZ>.snx`

- [ ] **Step 1: เขียน test ที่ fail** (ค่าจริง: `snapshot/igs_satellite_metadata.snx`)

```python
T = lambda *a: datetime(*a, tzinfo=timezone.utc)
def test_identity_g01(self):
    self.assertEqual(self.m.identity_at(62339, T(2026, 11, 9, 12)),
                     SatIdentity("G01", "G080", 62339, "2024-242A", "GPS-IIIA"))
def test_beidou_reassigned(self):
    self.assertEqual(self.m.identity_at(56564, T(2026, 11, 9)).prn, "C01")
    self.assertEqual(self.m.identity_at(56564, T(2026, 4, 1)).prn, "C59")
    self.assertIsNone(self.m.identity_at(56564, T(2026, 4, 20, 13)))      # ช่องว่าง 2026:110:43200–57600
    self.assertEqual(self.m.identity_at(44542, T(2026, 11, 9)).prn, "C40")
    self.assertEqual(self.m.identity_at(44542, T(2026, 4, 20)).prn, "C46")
def test_ended_prn_returns_none(self):
    self.assertIsNone(self.m.identity_at(36828, T(2026, 11, 9)))          # C005 สิ้นสุด 2026:100
def test_six_digit_satcat(self):
    self.assertEqual(self.m.identity_at(100744, T(2026, 11, 9)).prn, "R10")
def test_valid_to_is_exclusive(self):
    self.assertEqual(self.m.identity_at(100744, T(2026, 10, 20, 5, 29, 59)).prn, "R28")
    self.assertIsNone(self.m.identity_at(100744, T(2026, 10, 20, 5, 30, 0)))
def test_prn_changes_with_gap(self):                                     # Review Focus 2
    self.assertEqual(self.m.prn_changes(100744, T(2026, 10, 20), T(2026, 10, 21)),
                     [(T(2026, 10, 20, 5, 30), None), (T(2026, 10, 20, 5, 31), "R10")])
def test_fetch_refresh_and_fallback(self): ...   # ไฟล์อายุ < 24 ชม. ไม่ส่ง request; > 24 ชม. ส่ง; ส่งไม่สำเร็จ → ไฟล์เดิม + IGS_META_STALE; ไม่มีไฟล์ → IgsMetadataUnavailableError
```

- [ ] **Step 2: รันให้ fail** — Run: `python3 -m unittest tests.test_igs_meta -v` Expected: ImportError
- [ ] **Step 3: เขียน `igs_meta.py`** อ่านเฉพาะส่วน `SATELLITE/IDENTIFIER` (คอลัมน์: SVN, COSPAR, SatCat, Block) และ `SATELLITE/PRN` (SVN, valid_from, valid_to, PRN) แยกด้วยช่องว่าง เวลา `YYYY:DOY:SSSSS`, `0000:000:00000` = ไม่มีวันสิ้นสุด, SatCat ที่ไม่ใช่ตัวเลขข้าม
- [ ] **Step 4: รันให้ผ่าน** — Expected: PASS
- [ ] **Step 5: Commit** `feat(gnss-studio): map NORAD to PRN from IGS satellite metadata`

---

### Task 4: `sp3.py` หลายระบบ

**Files:**
- Modify: `gnss_predict/sp3.py` (เพิ่มฟังก์ชัน ห้ามเปลี่ยนพฤติกรรมของ `read_sp3`, `interpolate`, `fetch_sp3`, `choose_sp3_name`)
- Test: `tests/test_sp3.py` (เพิ่ม class ใหม่)

**Interfaces:**
- Produces:
  - `read_sp3_all(path: Path) -> dict[str, dict[datetime, tuple[float, float, float]]]` เวลา GPST, กม., ข้ามค่า 0 ทั้งสามแกนและค่าที่ |v| ≥ 999999, อ่าน .gz ได้, time system ต้องเป็น `GPS` ไม่งั้น `Sp3FormatError`
  - `write_sp3(times_utc: list[datetime], positions_km: dict[str, list[tuple[float, float, float]]], path: Path, agency: str = "GSTD") -> None`
  - `lagrange_at(series: dict[datetime, tuple[float, float, float]], t: datetime, half_window: int = 5) -> tuple[float, float, float] | None` (ต้องมีจุดก่อนและหลัง t ข้างละ `half_window` จุด ไม่งั้น `None`)
  - `choose_mgx_sp3_name(listing: list[str], day: date) -> str | None` ตาม `MGX_SP3_PREFERENCE` รูปชื่อ `<PREFIX>_<YYYY><DOY>0000_01D_05M_ORB.SP3.gz`
  - `fetch_mgx_sp3(day: date, cache_dir: Path) -> Path` (curl FTPS แบบ `fetch_sp3` เดิม, `Sp3UnavailableError` เมื่อไม่มี)

- [ ] **Step 1: เขียน test ที่ fail**

```python
def test_read_all_systems(self):
    d = read_sp3_all(FXS / "mgx_sample.sp3")
    self.assertEqual(set(d), {"C19", "C38", "E11", "G01", "R05"})
    self.assertEqual(len(d["E11"]), 37)
    self.assertEqual(min(d["G01"]), datetime(2026, 11, 9, tzinfo=timezone.utc))

def test_write_then_read_round_trip(self):
    t0 = datetime(2026, 11, 10, tzinfo=timezone.utc)
    times = [t0 + timedelta(seconds=30 * k) for k in range(3)]
    pos = {"G01": [(15000.1234567, -20000.5, 5000.25)] * 3, "R10": [(1.0, 2.0, 25000.0)] * 3}
    write_sp3(times, pos, p)
    d = read_sp3_all(p)
    self.assertEqual(sorted(d["G01"]), [t + timedelta(seconds=18) for t in times])
    self.assertAlmostEqual(d["G01"][times[0] + timedelta(seconds=18)][0], 15000.1234567, delta=0.0005)
    l0 = p.read_text().splitlines()[0]
    self.assertEqual((l0[:3], l0[46:51].strip(), l0[52:55], l0[56:60]), ("#dP", "ITRF", "EXT", "GSTD"))
    self.assertEqual(int(l0[32:39]), 3)

def test_write_sat_list_17_per_line(self): ...   # 20 ดวง → บรรทัด "+" 2 บรรทัดแรกมี 17 และ 3 PRN

def test_lagrange_at_reproduces_polynomial(self): # อนุกรมพหุนามดีกรี 5 ที่จุดทุก 300 s → ค่าที่เวลากึ่งกลางตรงภายใน 1e-9
def test_lagrange_at_edges_none(self): ...       # t ก่อนจุดแรกหรือมีจุดก่อนหน้าไม่ครบ 5 จุด → None

def test_choose_mgx_prefers_cod(self):
    d = date(2026, 10, 18)                       # DOY 291
    names = ["WUM0MGXRAP_20262910000_01D_05M_ORB.SP3.gz", "COD0MGXFIN_20262910000_01D_05M_ORB.SP3.gz",
             "GFZ0MGXRAP_20262910000_01D_05M_ORB.SP3.gz"]
    self.assertEqual(choose_mgx_sp3_name(names, d), names[1])
    self.assertEqual(choose_mgx_sp3_name(names[::2], d), names[2])
    self.assertIsNone(choose_mgx_sp3_name(names, date(2026, 10, 19)))
```

- [ ] **Step 2: รันให้ fail** — Run: `python3 -m unittest tests.test_sp3 -v` Expected: ImportError ของฟังก์ชันใหม่
- [ ] **Step 3: เขียนฟังก์ชัน** `write_sp3` เขียน SP3-d: บรรทัด 1 `#dP` + epoch แรก (GPST) + จำนวน epoch + data used `TLE  ` + coordinate `ITRF ` + orbit type `EXT` + agency, บรรทัด `##` (GPS week, วินาทีของสัปดาห์, interval, MJD), บรรทัด `+` ละ 17 PRN, บรรทัด `++` accuracy 0, `%c M  cc GPS ccc cccc ...`, `%f`, `%i`, บรรทัด `/*` หนึ่งบรรทัดว่า "GNSS Studio predicted orbit from TLE/SGP4 (GMAT)", แต่ละ epoch `*  YYYY MM DD HH MM SS.SSSSSSSS` และบรรทัด `P<PRN>` ค่า `%14.6f` กม. นาฬิกา `999999.999999`, ปิดด้วย `EOF` ให้ `interpolate` เดิมเรียกผ่าน `lagrange_at` ได้ถ้าทำแล้ว test เดิมยังผ่าน
- [ ] **Step 4: รันทั้งไฟล์ให้ผ่าน** — Run: `python3 -m unittest tests.test_sp3 -v` Expected: PASS (รวม test เดิม)
- [ ] **Step 5: Commit** `feat(gnss-studio): read multi-GNSS SP3 and write SP3-d predictions`

---

### Task 5: `brdc.py`

**Files:**
- Create: `gnss_predict/brdc.py`
- Test: `tests/test_brdc.py`

**Interfaces:**
- Consumes: `read_sp3_all` (Task 4), `BrdcUnavailableError` (Task 1)
- Produces:
  - `@dataclass(frozen=True) class BroadcastStatus: prn: str; last_toc: datetime; healthy: bool` (`healthy` มาจาก record ที่ toc ล่าสุด ตาม D14; ใน fixture record ล่าสุดของ E14 มี health 130 และของ R13 มี 1)
  - `class Nav` (เก็บ record ต่อ PRN เวลา toc เป็น `datetime` UTC-tz ตามที่เขียนในไฟล์)
  - `read_nav(path: Path) -> Nav` (RINEX 3.04 mixed, .gz หรือไม่ก็ได้; record G/E/C/J/I ยาว 8 บรรทัด, R/S ยาว 4 บรรทัด)
  - `broadcast_status(nav: Nav) -> dict[str, BroadcastStatus]` เฉพาะ G, R, E, C
  - `position_km(nav: Nav, prn: str, t_gpst: datetime) -> tuple[float, float, float] | None` เฉพาะ G, E, C
  - `fetch_brdc(day: date, dest_dir: Path) -> Path` ไฟล์ `BRDC00IGS_R_<YYYY><DOY>0000_01D_MN.rnx.gz` จาก `CDDIS_BRDC_URL` ไม่สำเร็จ → `BrdcUnavailableError`

- [ ] **Step 1: เขียน test ที่ fail**

```python
NAV = FXS / "snapshot" / "brdc" / "BRDC00IGS_R_20263130000_01D_MN.rnx"
def test_meo_igso_match_sp3(self):                 # ค่าจริง: GFZ0MGXRAP 2026-11-09
    truth = read_sp3_all(FXS / "mgx_sample.sp3")
    for prn in ("C19", "C38", "E11"):
        for t, ref in truth[prn].items():
            p = position_km(self.nav, prn, t)
            self.assertLessEqual(math.dist(p, ref), 0.010, (prn, t))

def test_geo_physical_properties(self):            # MGEX SP3 ไม่มี BDS GEO
    pts = [position_km(self.nav, "C01", T0 + timedelta(minutes=5 * k)) for k in range(288)]
    r = [math.dist(p, (0, 0, 0)) for p in pts]
    lat = [math.degrees(math.asin(p[2] / math.dist(p, (0, 0, 0)))) for p in pts]
    lon = [math.degrees(math.atan2(p[1], p[0])) for p in pts]
    self.assertTrue(all(abs(x - 42164) <= 50 for x in r))
    self.assertLessEqual(abs(sum(lat) / len(lat)), 0.5)
    self.assertLessEqual(max(lon) - min(lon), 0.5)

def test_health_from_real_records(self):
    st = broadcast_status(self.nav)
    self.assertFalse(st["E14"].healthy); self.assertFalse(st["R13"].healthy)
    self.assertTrue(st["E11"].healthy); self.assertTrue(st["R05"].healthy); self.assertTrue(st["G01"].healthy)
    self.assertNotIn("G22", st)

def test_health_g_and_c_from_field_positions(self): # แก้ข้อความ record ใน test: G01 และ C19 ช่องที่ 2 ของ ORBIT-6 (คอลัมน์ 24–42 ของบรรทัดที่ 7 ใน record) = 1.0 → healthy False

def test_none_far_from_toe_and_for_glonass(self):
    self.assertIsNone(position_km(self.nav, "C19", T0 + timedelta(days=3)))
    self.assertIsNone(position_km(self.nav, "R05", T0))
```

`T0 = datetime(2026, 11, 9, tzinfo=timezone.utc)` (GPST)

- [ ] **Step 2: รันให้ fail** — Run: `python3 -m unittest tests.test_brdc -v` Expected: ImportError
- [ ] **Step 3: เขียน `brdc.py`** ตามสูตร spec §7.4 ค่าคงที่ GM และ ωe ของแต่ละระบบตาม spec §3 (GPS ใช้ GM 3.986005e14, ωe 7.2921151467e-5 ตาม IS-GPS-200) ตำแหน่ง health ตาม spec §5.4 ส่วน BDS GEO คือ C01–C05 และ C59–C63
- [ ] **Step 4: รันให้ผ่าน** — Expected: PASS
- [ ] **Step 5: Commit** `feat(gnss-studio): parse RINEX 3 broadcast ephemeris for status and G/E/C positions`

---

### Task 6: `scenario.py`

**Files:**
- Create: `gnss_predict/scenario.py`
- Test: `tests/test_scenario.py`

**Interfaces:**
- Consumes: `ScenarioError` (Task 1), `SHELL_KM` (เดิม)
- Produces: `Facility`, `EngineScenario` ตาม spec §5.6 และ `load_scenario(path: Path) -> EngineScenario`
  - `satellites` เรียงตามลำดับใน `objects`, `facilities` เช่นกัน
  - ค่าตั้งต้น: `ionosphere.shell_km` → `SHELL_KM`, `satellite_filter.*` → `False`, `constraints.elevation_angle_min_deg` → `0.0` (D5)

- [ ] **Step 1: เขียน test ที่ fail** (สร้าง dict ตามภาพรวม §7.2 ใน test แล้วเขียนลงไฟล์ชั่วคราว)

```python
def test_load_minimal(self):
    s = load_scenario(write(VALID))
    self.assertEqual(s.facilities, [Facility("THBK", 13.729779, 100.781151, 6.4, 10.0)])
    self.assertEqual(s.satellites, [("G01", 62339)])
    self.assertEqual((s.step_s, s.shell_km, s.show_too_old), (30, 400.0, False))

def test_errors_name_the_field(self):
    cases = [({"format": "x"}, "format"),
             ({"analysis_period": {"start": STOP, "stop": START}}, "analysis_period"),
             ({"analysis_period": {"start": START, "stop": "2026-11-20T00:00:00Z"}}, "analysis_period"),
             ({"step_s": 7}, "step_s"),
             (lat(91.0), "objects[0].position.lat_deg"),
             (dup_name(), "objects[1].name")]
    for patch, field in cases:
        with self.assertRaises(ScenarioError) as cm: load_scenario(write(merge(VALID, patch)))
        self.assertEqual(cm.exception.field, field)

def test_unsafe_name_rejected(self):                # Review Focus 3, D6
    with self.assertRaises(ScenarioError) as cm: load_scenario(write(rename_facility("TH/BK")))
    self.assertEqual(cm.exception.field, "objects[0].name")

def test_unknown_fields_ignored(self): ...          # มี "graphics", "workbook_hint" ฯลฯ ไม่ error
def test_missing_constraint_defaults_zero(self): ... # D5
```

- [ ] **Step 2: รันให้ fail** — Expected: ImportError
- [ ] **Step 3: เขียน `scenario.py`** เวลาแปลงจาก ISO ที่ลงท้าย `Z` ด้วย `datetime.fromisoformat(s.replace("Z", "+00:00"))` ข้อความ error ภาษาไทยระบุช่อง
- [ ] **Step 4: รันให้ผ่าน** — Expected: PASS
- [ ] **Step 5: Commit** `feat(gnss-studio): load and validate engine fields of scenario.json`

---

### Task 7: `catalog.py`

**Files:**
- Create: `gnss_predict/catalog.py`
- Test: `tests/test_catalog.py`

**Interfaces:**
- Consumes: `read_omm`, `to_tle_lines` (Task 2), `read_metadata` (Task 3), `read_nav`, `broadcast_status` (Task 5), `Message`, `OrbitUnavailableError`
- Produces:
  - `CatalogSatellite`, `Catalog` ตาม spec §5.5
  - `build_catalog(snapshot_dir: Path, period: tuple[datetime, datetime], systems: set[str]) -> Catalog`
  - `is_shown(sat: CatalogSatellite, show_too_old: bool, show_no_broadcast: bool) -> bool`
  - `DOP_EXCLUDED_FLAGS = frozenset({"too_old", "no_broadcast", "unhealthy"})`
  - broadcast อ่านจากไฟล์เดียวใน `snapshot_dir/brdc/` (ไม่มีโฟลเดอร์หรือไฟล์ → ไม่ตั้ง `no_broadcast`/`unhealthy` และ Message `BRDC_UNAVAILABLE`)
  - Message `SAT_FLAGGED` หนึ่งข้อความต่อดวงที่มีธง level `warning` ถ้ามีธงใดใน {stale, too_old, no_broadcast, unhealthy, prn_changed} ไม่งั้น `info`

- [ ] **Step 1: เขียน test ที่ fail** (snapshot fixture, ช่วง 2026-11-10T00:00Z–2026-11-11T00:00Z, systems = {G, R, E, C})

```python
def test_flags_match_design(self):
    c = build_catalog(SNAP, PERIOD, set("GREC"))
    self.assertEqual({s.prn: set(s.flags) for s in c.satellites}, {
        "G01": set(), "G22": {"no_broadcast"}, "E11": set(), "E14": {"unhealthy"}, "R05": set(),
        "R10": {"too_old", "no_broadcast"}, "C01": {"name_mismatch"},
        "C40": {"stale", "name_mismatch"}, "C09": {"name_mismatch"}})
    self.assertEqual([u["norad"] for u in c.unmapped], [36828])
    self.assertEqual(c.unmapped[0]["reason"], "NO_PRN")

def test_identity_from_igs(self):
    c01 = sat(c, "C01")
    self.assertEqual((c01.svn, c01.norad, c01.celestrak_name), ("C231", 56564, "BEIDOU-3 G4 (C62)"))
    self.assertEqual(c01.tle_lines, to_tle_lines(omm_record(56564)))

def test_age_uses_absolute_difference(self):    # ช่วง 2026-11-05..06 (ก่อน epoch) อายุเป็นบวก
def test_is_shown_defaults(self):
    self.assertFalse(is_shown(sat(c, "G22"), False, False)); self.assertTrue(is_shown(sat(c, "G22"), False, True))
    self.assertFalse(is_shown(sat(c, "R10"), True, False)); self.assertTrue(is_shown(sat(c, "R10"), True, True))
def test_prn_changed_flag(self):                # Review Focus 2: ช่วง 2026-10-20..21 → ดวง NORAD 100744 ชื่อ "R28" มีธง prn_changed
def test_duplicate_prn_keeps_newer(self):       # snapshot ชั่วคราว: เพิ่ม OMM ปลอม NORAD 99001 (copy จาก 62339 epoch เก่ากว่า 1 วัน) + บรรทัด IGS SVN G999 → G01
    # คาดหวัง: G01 คือ 62339, unmapped มี {"norad": 99001, "reason": "DUPLICATE_PRN"}
def test_missing_group_file_raises(self):       # Review Focus 5: ลบ beidou.json → OrbitUnavailableError ที่ข้อความมี "beidou"
def test_without_brdc(self):                    # ไม่มีโฟลเดอร์ brdc → ไม่มีธง no_broadcast/unhealthy และมี Message BRDC_UNAVAILABLE
```

- [ ] **Step 2: รันให้ fail** — Expected: ImportError
- [ ] **Step 3: เขียน `catalog.py`** ตาม spec §5.5 และ §6 (`age_days` = |กลางช่วง − epoch|/86400, regex ของ `name_mismatch`: `\(PRN\s*(\d{1,2})\)` → `G%02d` และ `\((C\d{2})\)`)
- [ ] **Step 4: รันให้ผ่าน** — Expected: PASS
- [ ] **Step 5: Commit** `feat(gnss-studio): build satellite catalog with IGS PRNs and status flags`

---

### Task 8: `propagate.py`

**Files:**
- Create: `gnss_predict/propagate.py`
- Test: `tests/test_propagate.py`

**Interfaces:**
- Consumes: `CatalogSatellite` (Task 7), `format_gmat_epoch`, `parse_gmat_epoch`, `run_script` (เดิม), `read_sp3_all` (Task 4), `Message`, `ReportError` (เดิม)
- Produces:
  - `@dataclass class Ephemeris: times_utc: list[datetime]; positions_km: dict[str, list[tuple[float, float, float]]]`
  - `write_tle_file(sats: list[CatalogSatellite], path: Path) -> None` (บรรทัดชื่อ = PRN)
  - `render_ecef_script(sats, tle_path: Path, start: datetime, stop: datetime, step_s: int, report_path: Path) -> str`
  - `parse_ecef_report(path: Path, prns: list[str], start: datetime, stop: datetime, step_s: int) -> tuple[Ephemeris, list[Message]]` (D3)
  - `propagate(sats, start, stop, step_s, work_dir: Path, console: Path, timeout_s: float = 900) -> tuple[Ephemeris, list[Message]]` (D3)
  - `ephemeris_from_sp3(path: Path) -> Ephemeris` (อ่าน `predicted.sp3` แล้วลบ 18 วินาทีกลับเป็น UTC)

script ที่ต้องได้ (GMAT ต้องการหนึ่งคำสั่งต่อบรรทัด) ต่อดวง:

```
Create Spacecraft G01;
G01.DateFormat = UTCGregorian;
G01.Epoch = '10 Nov 2026 00:00:00.000';
G01.Id = 'G01';
G01.EphemerisName = '<tle_path>';
```

ตามด้วย

```
Create Propagator TLEProp;
TLEProp.Type = SPICESGP4;
TLEProp.InitialStepSize = <step_s>;
Create ReportFile RF;
RF.Filename = '<report_path>';
RF.Precision = 16;
RF.WriteHeaders = true;
RF.FixedWidth = false;
RF.Delimiter = ',';
RF.Add = {<PRN แรก>.UTCGregorian, <PRN>.EarthFixed.X, <PRN>.EarthFixed.Y, <PRN>.EarthFixed.Z, ...};
BeginMissionSequence;
Propagate TLEProp(<PRN ทุกดวงคั่นด้วย ", ">) {<PRN แรก>.ElapsedSecs = <stop − start เป็นวินาที>};
```

- [ ] **Step 1: เขียน test ที่ fail**

```python
def test_script_names_ids_and_one_statement_per_line(self):
    s = render_ecef_script([G01, C01], Path("/x/all.tle"), START, START + timedelta(days=1), 30, Path("/x/r.txt"))
    for frag in ("Create Spacecraft G01;", "G01.Id = 'G01';", "C01.EphemerisName = '/x/all.tle';",
                 "TLEProp.Type = SPICESGP4;", "TLEProp.InitialStepSize = 30;", "C01.EarthFixed.Z",
                 "{G01.ElapsedSecs = 86400}"):
        self.assertIn(frag, s)
    self.assertTrue(all(l.count(";") <= 1 for l in s.splitlines()))

def test_tle_file_name_lines_are_prns(self):
    write_tle_file([G01, C01], p)
    self.assertEqual(p.read_text().splitlines(), ["G01", *G01.tle_lines, "C01", *C01.tle_lines])

def test_parse_report_rounds_time_and_drops_bad_columns(self):
    # header มี G01 ครบ 3 แกน, C01 ไม่มีคอลัมน์ Z; แถวที่สองเวลา "10 Nov 2026 00:00:29.999"
    eph, msgs = parse_ecef_report(p, ["G01", "C01"], START, START + timedelta(seconds=30), 30)
    self.assertEqual(eph.times_utc, [START, START + timedelta(seconds=30)])
    self.assertEqual(list(eph.positions_km), ["G01"])
    self.assertEqual([m.code for m in msgs], ["SAT_MISSING_FROM_GMAT"])

def test_parse_report_grid_mismatch_raises(self): ...  # ขาดแถวหนึ่ง → ReportError
def test_ephemeris_from_sp3_shifts_back_to_utc(self): ...  # write_sp3 → ephemeris_from_sp3 ได้ times_utc เดิม
```

- [ ] **Step 2: รันให้ fail** — Expected: ImportError
- [ ] **Step 3: เขียน `propagate.py`** (`propagate` เขียน `all.tle`, `ecef.script`, เรียก `run_script(console, script, work_dir / "gmat.log", timeout_s)` แล้ว `parse_ecef_report`)
- [ ] **Step 4: รันให้ผ่าน** — Expected: PASS
- [ ] **Step 5: Commit** `feat(gnss-studio): generate EarthFixed GMAT script and parse multi-satellite report`

---

### Task 9: `czml.py`

**Files:**
- Create: `gnss_predict/czml.py`
- Test: `tests/test_czml.py`

**Interfaces:**
- Consumes: `Ephemeris` (Task 8), `Facility` (Task 6), `Interval` (Task 10 — ใช้ duck typing: object ที่มี `.start`, `.stop`)
- Produces: `satellites_czml(eph: Ephemeris, step_s: int = CZML_STEP_S) -> list[dict]`, `access_czml(fac: Facility, intervals: dict[str, list], period: tuple[datetime, datetime]) -> list[dict]` รูปแบบตาม spec §5.9 เวลาใน CZML เป็น ISO `YYYY-MM-DDTHH:MM:SSZ`

- [ ] **Step 1: เขียน test ที่ fail**

```python
def test_document_and_satellite_packet(self):
    pk = satellites_czml(eph_1h_30s)                     # 2 ดวง, 121 จุด
    self.assertEqual(pk[0]["id"], "document")
    self.assertEqual(pk[0]["clock"]["interval"], "2026-11-10T00:00:00Z/2026-11-10T01:00:00Z")
    s = next(p for p in pk if p["id"] == "sat/G01")
    pos = s["position"]
    self.assertEqual((pos["referenceFrame"], pos["interpolationAlgorithm"], pos["interpolationDegree"]),
                     ("FIXED", "LAGRANGE", 7))
    self.assertEqual(len(pos["cartesian"]), 4 * 13)
    self.assertAlmostEqual(pos["cartesian"][1], eph_1h_30s.positions_km["G01"][0][0] * 1000)
    self.assertNotIn("label", s); self.assertNotIn("path", s)

def test_last_sample_is_stop(self): ...               # ช่วง 1 ชม. 2 นาที → sample สุดท้ายที่ 3720 s
def test_lagrange_degree7_error_below_1m(self):       # วงโคจรจำลอง (วงกลม MEO หมุนกับโลก) 24 ชม. ทุก 30 s → sample 300 s → Lagrange 8 จุดรอบเวลา → คลาด ≤ 1 ม.
def test_access_show_intervals_cover_period(self):
    pk = access_czml(THBK, {"G01": [Iv(t(600), t(1200))]}, (t(0), t(3600)))
    a = next(p for p in pk if p["id"] == "access/THBK/G01")
    self.assertEqual(a["polyline"]["positions"]["references"], ["fac/THBK#position", "sat/G01#position"])
    self.assertEqual([(x["interval"], x["boolean"]) for x in a["polyline"]["show"]],
                     [(f"{iso(0)}/{iso(600)}", False), (f"{iso(600)}/{iso(1200)}", True), (f"{iso(1200)}/{iso(3600)}", False)])
    self.assertNotIn("material", a["polyline"])
    f = next(p for p in pk if p["id"] == "fac/THBK")
    self.assertEqual(f["position"]["cartographicDegrees"], [100.781151, 13.729779, 6.4])
```

- [ ] **Step 2: รันให้ fail** — Expected: ImportError
- [ ] **Step 3: เขียน `czml.py`** (ต้องระบุ `show` ครบทั้งช่วงทั้ง false และ true เพราะ Cesium ถือว่า `show` เป็น true เมื่อไม่มีค่า)
- [ ] **Step 4: รันให้ผ่าน** — Expected: PASS
- [ ] **Step 5: Commit** `feat(gnss-studio): write data-only CZML for satellites and access lines`

---

### Task 10: `analyze.py`

**Files:**
- Create: `gnss_predict/analyze.py`
- Test: `tests/test_analyze.py`

**Interfaces:**
- Consumes: `Ephemeris` (Task 8), `Facility` (Task 6), `geodetic_to_ecef`, `ecef_to_aer`, `ipp`, `mapping_factor` (Task 1 และเดิม)
- Produces: `AerRow`, `Interval` ตาม spec §5.10 และ
  - `aer_rows(eph, fac, shell_km) -> list[AerRow]` (El ≥ 0, เรียงตาม time แล้ว prn)
  - `intervals_from_elevations(times: list[datetime], els: list[float], min_el: float) -> list[Interval]`
  - `access_intervals(eph, fac) -> dict[str, list[Interval]]` (ทุก PRN ใน eph เป็น key แม้ไม่มีช่วง)
  - `global_statistics(intervals) -> dict` key `count, total_duration_s, min_duration_s, max_duration_s, mean_duration_s`
  - `legacy_rows(rows: list[AerRow], min_el: float = 0.0) -> list[list[str]]`

- [ ] **Step 1: เขียน test ที่ fail**

```python
def test_rising_crossing_interpolated(self):
    iv = intervals_from_elevations([t(0), t(30), t(60)], [5, 15, 25], 10)
    self.assertEqual([(i.start, i.stop, i.max_el_deg) for i in iv], [(t(15), t(60), 25)])
def test_setting_crossing(self):
    self.assertEqual(spans(intervals_from_elevations([t(0), t(30), t(60)], [25, 15, 5], 10)), [(t(0), t(45))])
def test_always_visible_clipped_to_period(self):        # Review Focus 4
    self.assertEqual(spans(intervals_from_elevations([t(0), t(30), t(60)], [20, 30, 20], 10)), [(t(0), t(60))])
def test_threshold_touch_dropped(self):                 # Review Focus 4, D7
    self.assertEqual(intervals_from_elevations([t(0), t(30), t(60)], [5, 10, 5], 10), [])
def test_millisecond_rounding(self): ...               # จุดตัดที่ 10.0004 s → 10.000 s
def test_global_statistics(self):
    g = global_statistics({"G01": [Iv(t(0), t(100))], "E11": [Iv(t(0), t(300))], "R05": []})
    self.assertEqual(g, {"count": 2, "total_duration_s": 400.0, "min_duration_s": 100.0,
                         "max_duration_s": 300.0, "mean_duration_s": 200.0})
    self.assertEqual(global_statistics({})["min_duration_s"], None)
def test_aer_zenith_and_below_horizon(self): ...       # ดาวเหนือหัว THBK 20,000 กม. → El 90, Range 20000; ดาวฝั่งตรงข้ามโลกไม่มีแถว
def test_ipp_mf_columns(self): ...                     # ipp_lat/lon และ mf เท่ากับ geometry.ipp / mapping_factor ของ Az/El เดียวกัน
def test_mf_identical_to_trainingmodel(self):
    for k in range(90001):
        el = k / 1000
        ref = math.sqrt(1.0 - (6371.0 * math.cos(math.radians(el)) / (6371.0 + 400.0)) ** 2)
        self.assertEqual(mapping_factor(el), ref)
def test_legacy_rows_match_old_formatter(self):
    # SezSample ชุดหนึ่ง → rows_from_samples(samples, 0.0, 400.0); สร้าง AerRow จาก sez_to_az_el + ipp(THBK) + mapping_factor ของ sample เดียวกัน
    self.assertEqual(legacy_rows(aer, 0.0), rows_from_samples(samples, 0.0, 400.0))
def test_legacy_rows_gps_only(self): ...               # แถว E11, C01 ไม่อยู่ในผล
```

- [ ] **Step 2: รันให้ fail** — Expected: ImportError
- [ ] **Step 3: เขียน `analyze.py`** ตาม spec §7.2–7.3 (`legacy_rows` จัดรูปแบบเหมือน `predict.rows_from_samples` ทุกตัวอักษร รวม `round(az, 3) % 360.0`)
- [ ] **Step 4: รันให้ผ่าน** — Expected: PASS
- [ ] **Step 5: Commit** `feat(gnss-studio): compute AER, IPP/MF, access intervals and legacy CSV rows`

---

### Task 11: `dop.py`

**Files:**
- Create: `gnss_predict/dop.py`
- Test: `tests/test_dop.py`

**Interfaces:**
- Consumes: `AerRow` (Task 10), `Facility` (Task 6), `DOP_EXCLUDED_FLAGS` (Task 7)
- Produces: `Dop`, `dop(az_el_deg: list[tuple[float, float]]) -> Dop | None`, `dop_series(rows, fac, flags: dict[str, frozenset[str]]) -> list[dict]` (key `time_utc, system, n_visible, gdop, pdop, hdop, vdop, edop, ndop, tdop`; ต่อเวลาเรียง system `ALL, G, R, E, C`)

- [ ] **Step 1: เขียน test ที่ fail** (ค่าจริง: สูตรปิดใน spec §10, D11)

```python
def geom(n, th):  # ดาวที่จุดยอด + n ดวงมุมเงย th ทิศกระจายเท่ากัน
    return [(0.0, 90.0)] + [(360.0 * k / n, th) for k in range(n)]
def test_closed_form_n3_30deg(self):
    d = dop(geom(3, 30.0))
    for got, ref in ((d.hdop, 1.333333), (d.vdop, 2.309401), (d.tdop, 1.527525), (d.pdop, 2.666667),
                     (d.gdop, 3.073181), (d.edop, 0.942809), (d.ndop, 0.942809)):
        self.assertAlmostEqual(got, ref, delta=1e-6)
def test_closed_form_n5_15deg(self):
    d = dop(geom(5, 15.0))
    for got, ref in ((d.gdop, 1.878256), (d.pdop, 1.744087), (d.hdop, 0.925979), (d.vdop, 1.477973),
                     (d.edop, 0.654766), (d.tdop, 0.697142)):
        self.assertAlmostEqual(got, ref, delta=1e-6)
def test_identities(self): ...                         # เรขาคณิตสุ่ม 7 ดวง (seed คงที่): HDOP² = EDOP² + NDOP², GDOP² = PDOP² + TDOP² ต่าง ≤ 1e-12
def test_too_few_or_singular(self):
    self.assertIsNone(dop(geom(2, 30.0)))              # 3 ดวง
    self.assertIsNone(dop([(10.0, 45.0)] * 5))         # ทิศเดียวกันหมด
def test_series_systems_and_exclusions(self): ...      # เวลาเดียว: G 4 ดวง, E14 ธง unhealthy, R ไม่มี → G มีค่า, R n_visible 0 และค่า None, ALL ไม่นับ E14
```

- [ ] **Step 2: รันให้ fail** — Expected: ImportError
- [ ] **Step 3: เขียน `dop.py`** ตาม spec §7.5 (Gauss-Jordan เลือก pivot, pivot < 1e-12 → None)
- [ ] **Step 4: รันให้ผ่าน** — Expected: PASS
- [ ] **Step 5: Commit** `feat(gnss-studio): single-clock DOP for all and per-system satellite sets`

---

### Task 12: `bundle.py`

**Files:**
- Create: `gnss_predict/bundle.py`
- Test: `tests/test_bundle.py`

**Interfaces:**
- Consumes: `Catalog` (Task 7), `Message`, `ENGINE_VERSION`
- Produces:
  - `input_hash(parts: dict) -> str` (`hashlib.sha256(json.dumps(parts, sort_keys=True, separators=(",", ":"), default=str).encode()).hexdigest()[:12]`)
  - `file_sha256(path: Path) -> str`
  - `write_bundle(final_dir: Path, files: Mapping[str, bytes]) -> Path` (key เป็น path สัมพัทธ์ อาจมีโฟลเดอร์ย่อย)
  - `build_manifest(kind, inputs, catalog, messages, extra, propagated: frozenset[str] = frozenset(), now: datetime | None = None) -> dict` (D4) โครงตาม spec §8.1; `satellites` มาจาก `catalog.satellites` ทุกดวง เติม `propagated = prn in propagated`; `extra` merge เข้าระดับบนสุด

- [ ] **Step 1: เขียน test ที่ fail**

```python
def test_hash_stable_and_sensitive(self):
    a = input_hash({"b": 1, "a": [1, 2]}); self.assertEqual(a, input_hash({"a": [1, 2], "b": 1}))
    self.assertEqual(len(a), 12); self.assertNotEqual(a, input_hash({"a": [1, 2], "b": 2}))
def test_write_bundle_atomic(self):
    out = write_bundle(root / "x", {"m.json": b"{}", "sub/a.csv": b"1\n"})
    self.assertEqual((out / "sub" / "a.csv").read_bytes(), b"1\n")
    self.assertEqual([p.name for p in root.iterdir()], ["x"])
def test_existing_bundle_kept(self): ...                # เรียกซ้ำด้วยเนื้อหาต่าง → ไฟล์เดิมไม่เปลี่ยน, ไม่มีโฟลเดอร์ .tmp-* เหลือ
def test_failure_leaves_nothing(self):
    class Boom(dict):
        def items(self): yield "a", b"1"; raise OSError("disk")
    with self.assertRaises(OSError): write_bundle(root / "y", Boom())
    self.assertEqual(list(root.iterdir()), [])
def test_manifest_fields(self): ...                     # kind, engine_version "0.2.0", created_utc จาก now, satellites[*].propagated, unmapped, messages เป็น dict
```

- [ ] **Step 2: รันให้ fail** — Expected: ImportError
- [ ] **Step 3: เขียน `bundle.py`** (โฟลเดอร์ชั่วคราว `final_dir.with_name(final_dir.name + f".tmp-{os.getpid()}")`, ลบด้วย `shutil.rmtree` ใน `finally` ถ้ายังอยู่)
- [ ] **Step 4: รันให้ผ่าน** — Expected: PASS
- [ ] **Step 5: Commit** `feat(gnss-studio): hash inputs and write result bundles atomically`

---

### Task 13: `studio.py` (fetch, propagate, analyze และ CLI)

**Files:**
- Create: `gnss_predict/studio.py`
- Test: `tests/test_studio_cli.py`, `tests/test_integration_studio.py`

**Interfaces:**
- Consumes: ทุก Task ก่อนหน้า
- Produces:
  - `fetch_snapshot(data_dir: Path, now: datetime, systems: str = "GREC", opener=urlopen, brdc_fetcher=brdc.fetch_brdc) -> tuple[Path, list[Message]]`
    - cache ที่ `data_dir/orbits/_cache/` (OMM, state `celestrak_state.json`, IGS metadata, broadcast)
    - snapshot `data_dir/orbits/<now:%Y%m%dT%H%MZ>/`: `<group>.json`, `igs_satellite_metadata.snx`, `brdc/<ชื่อไฟล์>`, `SHA256SUMS` (บรรทัด `<sha256>  <path สัมพัทธ์>` เรียงตาม path) เขียนด้วย `write_bundle`
    - broadcast: ลองวัน `now.date() − 1` ถ้า `BrdcUnavailableError` ลอง `− 2` ถ้ายังไม่ได้ → Message `BRDC_UNAVAILABLE`
  - `run_propagate(scenario_dir: Path, data_dir: Path = DATA_DIR, console: Path | None = None, progress=None) -> tuple[Path, list[Message]]`
    - catalog ของทุกระบบที่มีไฟล์ใน snapshot; เลือกดาวตาม NORAD ใน scenario ที่ `is_shown`; ไม่เหลือ → `NoSatellitesError`; NORAD ที่ไม่มีใน catalog → `SAT_NOT_IN_SNAPSHOT` (D8)
    - hash ตาม spec §5.12; มี `scenario_dir/ephem/<hash>/` แล้ว → คืนทันที
    - ไม่งั้น `propagate` ใน `tempfile.TemporaryDirectory()` แล้ว `write_bundle` ไฟล์ `manifest.json`, `predicted.sp3`, `scene.czml`
  - `run_analyze(scenario_dir, facility: str, data_dir: Path = DATA_DIR, console=None, progress=None) -> tuple[Path, list[Message]]` (D10)
    - ephemeris จาก `ephemeris_from_sp3(predicted.sp3)`, ธงจาก ephem `manifest.json`
    - เขียน `scenario_dir/access/<facility>/<hash>/`: `manifest.json`, `aer.csv`, `intervals.json`, `dop.csv`, `access.czml`, `legacy_gps.csv` (header `DAY,Time,PRN,Az,El,IPP_Lat,IPP_Lon,MF`)
    - header ของ `aer.csv` คือ `time_utc,prn,az_deg,el_deg,range_km,ipp_lat_deg,ipp_lon_deg,mf` และ `dop.csv` คือ `time_utc,system,n_visible,gdop,pdop,hdop,vdop,edop,ndop,tdop` (ภาพรวม §7.5) `time_utc` รูปแบบ `YYYY-MM-DDTHH:MM:SSZ` ทศนิยมตาม spec §8.2 ค่า None เขียนเป็นช่องว่าง เวลาใน `intervals.json` ใช้ ISO มิลลิวินาที `YYYY-MM-DDTHH:MM:SS.sssZ`
    - `DOP_GAPS` เมื่อมีจุดเวลาที่ ALL มี DOP เป็น None
  - `progress(stage: str, fraction: float)` เรียกด้วย 0.0 ตอนเริ่ม และ 1.0 ตอนจบของแต่ละฟังก์ชัน
  - `main(argv: list[str] | None = None, now: datetime | None = None) -> int` subcommand `fetch`, `propagate`, `analyze`, `validate` (validate ใน Task 14) ตาม spec §5.13 พิมพ์ path ผลลัพธ์บรรทัดแรก ตามด้วย `<level>: <text>` ของแต่ละ Message; `GnssPredictError` → stderr และ exit 1; argparse → exit 2
  - `gnss_predict/studio.py` มี `if __name__ == "__main__": sys.exit(main())`

- [ ] **Step 1: เขียน test ที่ fail**

```python
# tests/test_studio_cli.py (ไม่ใช้ GMAT ไม่ใช้เน็ต)
def test_no_subcommand_exit_2(self): self.assertEqual(main([]), 2)
def test_bad_scenario_exit_1(self): ...      # propagate --scenario <โฟลเดอร์ที่ scenario.json มี format ผิด> → 1, stderr มี "format"
def test_all_hidden_raises_no_satellites(self): ...  # snapshot fixture, scenario มีแค่ R10 (too_old) และตัวกรองปิด → run_propagate raise NoSatellitesError ก่อนเรียก GMAT (console=None ไม่ถูกใช้)
def test_fetch_uses_injected_fetcher(self): ...   # patch studio.fetch_snapshot ให้คืน (path, [Message("BRDC_UNAVAILABLE","warning","...")]) → stdout บรรทัดแรกเป็น path, มี "warning:"
def test_fetch_snapshot_layout(self): ...    # opener ปลอมคืน OMM จาก fixture ตามกลุ่ม, IGS จาก fixture, brdc_fetcher ปลอม raise BrdcUnavailableError → snapshot มี 4 กลุ่ม + snx + SHA256SUMS ที่ตรงกับไฟล์, Message BRDC_UNAVAILABLE

# tests/test_integration_studio.py (skip ถ้าไม่มี GMAT)
# data_dir ชั่วคราว: copy fixture snapshot ไปเป็น orbits/20261110T0000Z
# scenario: ช่วง 2026-11-10T00:00Z–06:00Z, step 30, THBK min el 10, ดาว G01 E11 R05 C01 C40 R10, show_too_old/show_no_broadcast = true
def test_propagate_then_analyze(self):
    ephem, _ = run_propagate(sc, data_dir=dd, progress=calls.append_pair)
    sp3 = read_sp3_all(ephem / "predicted.sp3")
    self.assertEqual(set(sp3), {"G01", "E11", "R05", "C01", "C40", "R10"})        # รวมดาวเลข 6 หลัก
    for prn, s in sp3.items():
        self.assertTrue(all(19000 < math.dist(p, (0, 0, 0)) < 43000 for p in s.values()), prn)
    man = json.loads((ephem / "manifest.json").read_text())
    r10 = next(x for x in man["satellites"] if x["prn"] == "R10")
    self.assertTrue(r10["propagated"]); self.assertIn("too_old", r10["flags"])
    self.assertEqual(run_propagate(sc, data_dir=dd)[0], ephem)                      # ใช้ผลเดิม
    acc, _ = run_analyze(sc, "THBK", data_dir=dd)
    for f in ("manifest.json", "aer.csv", "intervals.json", "dop.csv", "access.czml", "legacy_gps.csv"):
        self.assertTrue((acc / f).is_file(), f)
    self.assertEqual((acc / "aer.csv").read_text().splitlines()[0],
                     "time_utc,prn,az_deg,el_deg,range_km,ipp_lat_deg,ipp_lon_deg,mf")
    legacy = (acc / "legacy_gps.csv").read_text().splitlines()
    self.assertEqual(legacy[0], "DAY,Time,PRN,Az,El,IPP_Lat,IPP_Lon,MF")
    self.assertTrue(all(r.split(",")[2].startswith("G") for r in legacy[1:]))
    self.assertEqual((calls[0][1], calls[-1][1]), (0.0, 1.0))
```

- [ ] **Step 2: รันให้ fail** — Run: `python3 -m unittest tests.test_studio_cli tests.test_integration_studio -v` Expected: ImportError
- [ ] **Step 3: เขียน `studio.py`**
- [ ] **Step 4: รันให้ผ่าน แล้วรันทั้งชุด** — Run: `python3 -m unittest discover -s tests -v` Expected: PASS (integration ผ่านเมื่อมี GMAT)
- [ ] **Step 5: Commit** `feat(gnss-studio): add studio fetch/propagate/analyze commands`

---

### Task 14: ตรวจความแม่นยำหลายระบบ

**Files:**
- Create: `gnss_predict/studio_validate.py`
- Modify: `gnss_predict/studio.py` (เพิ่ม `run_validate` และ subcommand `validate`)
- Test: `tests/test_studio_validate.py`

**Interfaces:**
- Consumes: `read_sp3_all`, `lagrange_at`, `write_sp3`, `fetch_mgx_sp3` (Task 4), `Nav`, `position_km`, `read_nav`, `fetch_brdc` (Task 5), `Facility`, `geodetic_to_ecef`, `ecef_to_aer`, ค่าเกณฑ์เดิมใน `config.py` (`VALIDATION_MIN_EL`, `EL_MEDIAN_MAX`, `EL_P99_MAX`, `AZ_MEDIAN_MAX`, `AZ_P99_MAX`, `AZ_EL_LIMIT`), `validate.az_diff` (เดิม)
- Produces:
  - `validate_ephemeris(pred_sp3: Path, truth_sp3: Path, nav: Nav | None, fac: Facility, flags: dict[str, frozenset[str]], ages: dict[str, float], day: date) -> dict`
    - โครง: `{"day", "truth_file", "systems": {sys: {"sats", "pairs", "el_median", "el_p99", "az_median", "az_p99", "pass"}}, "satellites": {prn: {"truth": "sp3"|"brdc"|"unverified", "pairs", "el_median", "el_p99", "az_median", "az_p99", "d3_median_km", "d3_max_km", "age_days", "result": "pass"|"fail"|"insufficient_data"|"unverified"}}, "failing": [prn...], "pass": bool}`
    - เทียบเฉพาะเวลาใน `predicted.sp3` ที่วันที่ UTC ตรงกับ `day`, คู่ที่ El อ้างอิง ≥ `VALIDATION_MIN_EL`, Az เฉพาะ El < `AZ_EL_LIMIT`
    - ระดับระบบใช้เฉพาะดาวที่ `truth == "sp3"` และ `age_days ≤ AGE_OK_DAYS`; `pass` ของทั้งก้อนคือทุกระบบที่มีคู่ผ่าน
  - `run_validate(scenario_dir, day: date, data_dir: Path = DATA_DIR, sp3: Path | None = None, facility: str | None = None) -> tuple[Path, list[Message]]` เขียน `validation_<day>.json` และ `.md` ลงโฟลเดอร์ ephem และต่อท้าย `data_dir/validation/history.jsonl` หนึ่งบรรทัด `{"day", "scenario", "ephem_hash", "truth_file", "pass", "systems", "failing", "created_utc"}`

- [ ] **Step 1: เขียน test ที่ fail** (สร้าง `predicted.sp3` และ truth ด้วย `write_sp3` ในไฟล์ชั่วคราว ตำแหน่งดาวจริงเอาจาก `mgx_sample.sp3`)

```python
def test_offset_gives_expected_stats(self): ...        # truth = pred + 0.5 กม. ตามแกนเดียว → ทุกดวง truth "sp3", d3_median_km ≈ 0.5, el/az median > 0, ระบบผ่าน
def test_system_stats_only_sp3_and_fresh(self): ...    # ดวงอายุ 3 วันไม่นับในระดับระบบ แต่อยู่ใน satellites
def test_brdc_fallback_and_unverified(self): ...       # ดวง C40 ไม่มีใน truth แต่มีใน nav fixture → truth "brdc"; R10 ไม่มีทั้งสอง → "unverified"
def test_insufficient_data(self): ...                  # ดวงที่มีคู่ 19 คู่ → "insufficient_data"
def test_failing_satellite_listed(self): ...           # ดวงที่คลาด 200 กม. → result "fail" และอยู่ใน "failing"
def test_history_appended(self): ...                   # run_validate สองครั้ง (sp3 ระบุเอง, ไม่ต่อเน็ต: patch fetch_brdc ให้ raise) → history.jsonl มี 2 บรรทัด
```

- [ ] **Step 2: รันให้ fail** — Expected: ImportError
- [ ] **Step 3: เขียน `studio_validate.py` และ `run_validate`** (ค่าจริงของ SP3 ที่เวลาเรา = `lagrange_at`; broadcast ใช้เวลา GPST เดียวกัน; markdown มีตารางต่อระบบและรายชื่อดวงที่ไม่ผ่านพร้อมค่าคลาด)
- [ ] **Step 4: รันให้ผ่าน** — Expected: PASS
- [ ] **Step 5: Commit** `feat(gnss-studio): validate predictions per system and per satellite against MGEX SP3`

---

### Task 15: CLI เดิมดึงข้อมูลเป็น OMM

**Files:**
- Modify: `gnss_predict/config.py` (`CELESTRAK_GPS_URL` เป็น `...GROUP=gps-ops&FORMAT=json`), `gnss_predict/tle_fetch.py` (`fetch_gps_tle`)
- Test: `tests/test_tle_fetch.py` (5 test ใน `TestFetch`)

**Interfaces:**
- Consumes: `omm.fetch_group(..., url=...)`, `read_omm`, `to_tle_lines` (Task 2)
- Produces: `fetch_gps_tle(cache_dir, url=CELESTRAK_GPS_URL, timeout_s=30, now=None) -> tuple[Path, list[str]]` signature เดิม
  - เรียก `fetch_group("gps-ops", cache_dir, cache_dir / "celestrak_state.json", now, timeout_s=timeout_s, url=url)`
  - จาก `gps-ops_<stamp>.json` เขียน `gps_<stamp>.tle` (บรรทัดชื่อ = `OBJECT_NAME`) ถ้ายังไม่มี
  - `OrbitUnavailableError` → ใช้ `gps_*.tle` ล่าสุดพร้อมคำเตือน ถ้าไม่มี → `TleUnavailableError` (เดิม)
  - คำเตือนจาก Message คืนเป็น `list[str]` ของ `text`
  - `script_gen` ไม่ต้องแก้: `TleEntry.norad` คือช่อง 5 ตัวอักษรของบรรทัด 1 อยู่แล้ว ดาวเลข 6 หลักจึงได้ Id แบบ Alpha-5

- [ ] **Step 1: แก้ test 5 ข้อให้ใช้ OMM (พฤติกรรมเดิม) ให้ fail กับโค้ดเดิม**

```python
def test_success_writes_timestamped_cache(self):
    path, warns = fetch_gps_tle(Path(d), url=(FXS / "snapshot" / "gps-ops.json").as_uri(), now=self.NOW)
    self.assertEqual(path.name, "gps_20261110T1200Z.tle"); self.assertEqual(warns, [])
    self.assertEqual(len(parse_tle_file(path)[0]), 2)
# test_failure_falls_back_to_newest_cache, test_failure_without_cache_raises: เหมือนเดิม
# test_fetch_truncated_body_falls_back: server ส่ง b'[{"OBJECT_NAME": "GPS' แล้วตัด
# test_fetch_non_tle_body_falls_back: เปลี่ยนการตรวจ listing เป็น sorted(p.name for p in cache.glob("gps*")) == ["gps_20261105T0000Z.tle"]
```

- [ ] **Step 2: รันให้ fail** — Run: `python3 -m unittest tests.test_tle_fetch -v` Expected: `test_success_writes_timestamped_cache` FAIL (โค้ดเดิมอ่าน JSON เป็น TLE ไม่ได้)
- [ ] **Step 3: แก้ `fetch_gps_tle` และ `CELESTRAK_GPS_URL`**
- [ ] **Step 4: รันทั้งชุด** — Run: `python3 -m unittest discover -s tests -v` Expected: PASS ทั้งหมด
- [ ] **Step 5: Commit** `fix(gnss-predict): fetch GPS elements as OMM so 6-digit catalog numbers are not lost`

---

### Task 16: Acceptance และ README

**Files:**
- Modify: `README.md` (เพิ่มหัวข้อ "GNSS Studio engine": คำสั่ง, โครงสร้าง `data/`, ธงสถานะดาว, ผล acceptance)
- ไม่มีโค้ดใหม่ ถ้า acceptance ข้อใดไม่ผ่าน ให้หยุดและรายงาน ห้ามแก้เกณฑ์

- [ ] **Step 0: ดึงข้อมูลจริงหนึ่งครั้ง (เกณฑ์สำเร็จข้อ 1 ของ spec)**

Run: `python3 -m gnss_predict.studio fetch --data <scratchpad>/studio-data`
Expected: exit 0, snapshot มี `gps-ops.json`, `glo-ops.json`, `galileo.json`, `beidou.json`, `igs_satellite_metadata.snx`, `SHA256SUMS` และไฟล์ใน `brdc/` (หรือคำเตือน `BRDC_UNAVAILABLE`) รันครั้งเดียว ห้ามรันซ้ำภายใน 2 ชม.

- [ ] **Step 1: ประกอบ snapshot จากข้อมูลเต็มที่ดาวน์โหลดไว้**

สร้าง `data/orbits/20261110T1700Z/` ด้วย snippet Python (ไม่ commit): แยก `$SRC/omm-dl/gnss.json` เป็น 4 กลุ่มตามระบบของ PRN จาก IGS metadata
(ใช้ `igs_meta.read_metadata`, ดวงที่ไม่มี PRN ใส่ตามกลุ่มในไฟล์ TLE ต้นทาง `$SRC/spike-acc/data/tle/*.tle`, ดวงที่ไม่อยู่ในไฟล์ TLE ทั้ง 4 ไม่ใส่)
copy `igs_satellite_metadata.snx` และ `brdc/BRDC00IGS_R_20263130000_01D_MN.rnx.gz` แล้วเขียน `SHA256SUMS`

- [ ] **Step 2: สร้าง scenario และตรวจความแม่นยำ**

scenario `data/scenarios/acc_20261109/scenario.json`: ช่วง 2026-11-09T00:00Z–2026-11-10T00:00Z, step 30, snapshot `20261110T1700Z`, THBK (min el 10), ดาวทุกดวงใน catalog ของ snapshot
Run: `python3 -m gnss_predict.studio validate --scenario data/scenarios/acc_20261109 --day 2026-11-09 --sp3 $SRC/spike-acc/data/sp3/GFZ0MGXRAP_20263130000_01D_05M_ORB.SP3.gz`
Expected: exit 0, ทั้ง 4 ระบบ `pass: true` ค่าใกล้ตารางในภาพรวม §10.1 และดวงที่ไม่ผ่านถูกระบุใน `failing`

- [ ] **Step 3: วัดเวลา propagate**

Run: `time python3 -m gnss_predict.studio propagate --scenario data/scenarios/acc_20261109` (ลบโฟลเดอร์ `ephem/` ก่อน)
Expected: real ≤ 60 s ถ้าเกิน ให้หยุดและรายงาน (ทางแก้ใน spec E1 ต้องให้ผู้ใช้ตัดสินก่อน)

- [ ] **Step 4: เทียบ `legacy_gps.csv` กับ CLI เดิม**

Run: `python3 -m gnss_predict --start 2026-11-09 --hours 24 --tle-file $SRC/spike-acc/data/tle/gps-ops.tle --out-dir /tmp/...` (ใช้โฟลเดอร์ใน scratchpad) และ `python3 -m gnss_predict.studio analyze --scenario data/scenarios/acc_20261109 --facility THBK`
เทียบแถวที่ `DAY,Time,PRN` ตรงกัน Expected: |ΔAz| และ |ΔEl| ≤ 0.01° ทุกแถวที่จับคู่ได้ และจับคู่ได้ ≥ 99% ของแถว CLI เดิม

- [ ] **Step 5: เขียนผลลง README และ commit**

```bash
git add README.md
git commit -m "docs(gnss-studio): document engine commands and acceptance results"
```
