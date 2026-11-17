# Gpredict Web Tracking Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** สร้างงานย่อยที่ 1 ของ Gpredict Web: หน้าเว็บแบบ Gpredict ที่ติดตามดาวแบบ real-time จาก ephemeris ของ GMAT
มี QTH, Module, Time Controller และ view ทั้ง 5 แบบ

**Architecture:** engine `gnss_predict` (stdlib) ได้ความสามารถเพิ่มแบบไม่กระทบ GNSS Studio (ความเร็วจาก GMAT, `ecef_to_geodetic`, `astro.py`)
server `gpredict_web` (FastAPI) ถือนาฬิกาของแต่ละ module, จัดช่วงคำนวณ GMAT 16 ชม. พร้อม cache รายดวง, คำนวณทุกค่าที่แสดง
แล้วส่ง tick ทาง WebSocket ส่วนหน้าเว็บ (React + Canvas) วาดอย่างเดียว

**Tech Stack:** Python 3.14, FastAPI 0.162.4, uvicorn 0.54.0, websockets 17.3, httpx2 2.16.0 (TestClient), unittest;
React 19.1.10, Vite 8.3.5, @vitejs/plugin-react 6.1.2, TypeScript 5.9.3, Vitest 4.1.12

**Spec:** [2026-11-11-gpredict-web-core-design.md](2026-11-11-gpredict-web-core-design.md) อ่านคู่กับ
[รายการอ้างอิง Gpredict](2026-11-11-gpredict-reference.md) (ในแผนนี้ "spec §n" = spec, "ref §n" = รายการอ้างอิง)

## Global Constraints

- ทำงานใน worktree `/Users/phuwish/SSSGMAT/.worktrees/gpredict-web` บน branch `feature/gpredict-web-core` เท่านั้น
  ห้าม `cd` เข้า checkout หลัก `/Users/phuwish/SSSGMAT` (มี session ของ GNSS Studio ทำงานอยู่) ห้าม push ห้าม merge ห้ามใช้ `git stash` แบบไม่มีชื่อ
- `*.md` ถูก ignore ที่ราก repo: ไฟล์ Markdown ต้อง `git add -f`
- การแก้ engine (Task 1–2) เป็นการเพิ่มเท่านั้น: test เดิมผ่านโดยไม่แก้ test, script ตอน `with_velocity=False` ตรงเดิมทุกไบต์, `ENGINE_VERSION` ไม่เปลี่ยน, engine ยังใช้ stdlib ล้วน
- โค้ดใหม่ของ server อยู่ใต้ `api-interop/gpredict-web/server/gpredict_web/` หน้าเว็บอยู่ใต้ `api-interop/gpredict-web/web/`
- venv: `python3 -m venv api-interop/gpredict-web/.venv && api-interop/gpredict-web/.venv/bin/pip install -r api-interop/gpredict-web/server/requirements.txt`
- คำสั่ง test
  - engine: `cd api-interop/gnss-predict && python3 -m unittest discover -s tests`
  - server: `cd api-interop/gpredict-web/server && ../.venv/bin/python -m unittest discover -s tests`
  - web: `cd api-interop/gpredict-web/web && npm test` (= `vitest run`) และ `npm run build`
- test ห้ามใช้เน็ต ใช้ data dir ชั่วคราวเสมอ test ที่ต้องใช้ GMAT จริงข้ามเมื่อ `find_gmat_console()` raise
- server ฟัง `127.0.0.1:8740` เป็นค่าตั้งต้น ตัวแปรสภาพแวดล้อม: `GPREDICT_WEB_DATA`, `GNSS_STUDIO_DATA` (ของ engine), `GMAT_BIN` (ของ engine)
- เวลาใน API เป็น ISO 8601 UTC ลงท้าย `Z` ความละเอียดมิลลิวินาที
- ชื่อ QTH และ module: `^[A-Za-z0-9_-]{1,25}$`
- ป้ายในหน้าจอเป็นภาษาอังกฤษตาม ref ทุกตัวอักษร (รวมตัวพิมพ์เล็ก-ใหญ่) ข้อความที่ Gpredict ไม่มีเป็นภาษาไทย ของที่ไม่มีใน Gpredict มี comment `(ของเรา)` ในโค้ด
- ค่าคงที่ของ spec §5.1: `STEP_S=30`, `WINDOW_BACK_H=2`, `WINDOW_SPAN_H=16`, `REFRESH_MARGIN_H=3`, `MAX_SATS=200`, `GMAT_TIMEOUT_S=600`
- commit message แบบ conventional ภาษาอังกฤษ scope `gpredict-web` (หรือ `gnss-predict` สำหรับ Task 1–2) ลงท้ายด้วย `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## Review Focus

1. **เปิดครั้งแรกโดยไม่มีเน็ตและไม่มี OMM cache** ผู้ใช้ควรได้หน้าเว็บที่มี QTH THBK, ไม่มี module, และข้อความไทยบอกให้กด Edit → Update TLE data from network ไม่ใช่ server ล้ม → Task 11 `test_bootstrap_offline_creates_qth_only`
2. **เปิดแท็บค้างไว้แล้ว server ถูกปิดเปิดใหม่** หน้าเว็บควรต่อ WebSocket ใหม่เองและแสดงผลต่อ ไม่ค้างที่ tick สุดท้าย → Task 13 `reconnects after the socket closes`
3. **ดาวที่เลือกอยู่ใน Single sat หายจาก tick** (GMAT ไม่รายงาน, decayed) view ควรแสดง "-" และ module ยังทำงาน → Task 10 `test_tick_omits_missing_sat_without_error`
4. **เครื่อง sleep หลายชั่วโมงแล้วตื่น** เวลา real-time กระโดดออกนอกช่วงคำนวณ ควรเห็น `computing` แล้วกลับมาแสดงผล ไม่ใช่ค่าเก่าหรือ exception → Task 10 `test_clock_jump_triggers_recompute`
5. **แก้ module (เปลี่ยน QTH หรือดาว) ขณะเปิดอยู่ในอีกแท็บ** tick ถัดไปของทุกแท็บควรใช้ค่าใหม่ → Task 11 `test_put_module_while_open_updates_tick`

## การตัดสินใจในแผนที่ spec ไม่ได้กำหนดไว้

1. `sp3.lagrange_at` รับพารามิเตอร์ใหม่ `times` (รายการเวลาที่เรียงแล้ว) ไม่งั้นทุกการเรียกต้อง `sorted()` ทั้งช่วง 1921 จุด
   ประมาณ 400 ครั้งต่อ tick จะกินเวลาราว 150 ms จาก 300 ms ค่าตั้งต้น `None` ให้ผลเดิม
2. `GET /api/meta` ส่งรายชื่อคอลัมน์ ช่อง preset และค่าตั้งต้นจาก `module.py` ให้หน้าเว็บ ชื่อเหล่านี้จึงมีชุดเดียว
3. `GET /api/license` ส่ง `License.txt` ของ repo ให้ Help → License
4. นาฬิกาที่ได้ค่าผิดช่วงตอบ 422 รหัส `CLOCK_INVALID`
5. ภาพแผนที่ใช้ `application/data/graphics/texture/ModifiedBlueMarble.jpg` ของ GMAT (Blue Marble ของ NASA, equirectangular, ขอบซ้าย −180°)
   ย่อเป็น 1024×512 ด้วย `sips` เพราะเซิร์ฟเวอร์ภาพของ NASA ต่อจากเครื่องพัฒนาไม่ได้
6. คอลัมน์ "Decayed" ของ List แสดงค่าว่างเสมอ เพราะ server ไม่ส่งดาวที่ decayed (spec §7.3)

---

### Task 1: Engine — ความเร็วจาก GMAT, ดาวทั่วไป, `lagrange_at` ที่รับเวลาเรียงแล้ว

**Files:**
- Modify: `api-interop/gnss-predict/gnss_predict/propagate.py`, `api-interop/gnss-predict/gnss_predict/sp3.py`
- Create: `api-interop/gnss-predict/tests/fixtures/ecef_2sat.script` (golden)
- Test: `api-interop/gnss-predict/tests/test_propagate.py`, `api-interop/gnss-predict/tests/test_sp3.py`

**Interfaces:**
- Produces:
  - `class TleSatellite(Protocol): prn: str; tle_lines: tuple[str, str]`
  - `render_ecef_script(sats: list[TleSatellite], tle_path, start, stop, step_s, report_path, with_velocity: bool = False) -> str`
  - `parse_ecef_report(path, prns, start, stop, step_s, with_velocity: bool = False) -> tuple[Ephemeris, list[Message]]`
  - `propagate(sats, start, stop, step_s, work_dir, console, timeout_s=900, on_gmat_start=None, with_velocity: bool = False)`
  - `Ephemeris.velocities_kms: dict[str, list[Position]] | None = None` (field สุดท้าย)
  - `lagrange_at(series, t, half_window=5, times: list[datetime] | None = None) -> Position | None`

- [ ] **Step 1: สร้างไฟล์ golden จากโค้ดก่อนแก้**

```bash
cd api-interop/gnss-predict && python3 -c "
import sys; sys.path.insert(0, 'tests')
from pathlib import Path; from datetime import timedelta
from test_propagate import G01, C01, START
from gnss_predict.propagate import render_ecef_script
Path('tests/fixtures/ecef_2sat.script').write_text(render_ecef_script([G01, C01], Path('/x/all.tle'), START, START + timedelta(days=1), 30, Path('/x/r.txt')), encoding='utf-8')"
```

- [ ] **Step 2: เขียน test ที่ยังไม่ผ่าน** ใน `tests/test_propagate.py` (เพิ่ม `FIXTURES = Path(__file__).parent / "fixtures"` ที่หัวไฟล์)

```python
def test_default_script_matches_golden(self):
    s = render_ecef_script([G01, C01], Path("/x/all.tle"), START, START + timedelta(days=1), 30, Path("/x/r.txt"))
    self.assertEqual(s, (FIXTURES / "ecef_2sat.script").read_text(encoding="utf-8"))

def test_velocity_columns_follow_each_position(self):
    s = render_ecef_script([G01], Path("/x/all.tle"), START, START + timedelta(hours=1), 30, Path("/x/r.txt"),
                           with_velocity=True)
    self.assertIn("RF.Add = {G01.UTCGregorian, G01.EarthFixed.X, G01.EarthFixed.Y, G01.EarthFixed.Z, "
                  "G01.EarthFixed.VX, G01.EarthFixed.VY, G01.EarthFixed.VZ};", s)

def test_parse_reads_velocity(self):        # report 3 epoch ทุก 30 s มี X..VZ ของ G01 → velocities_kms["G01"][1] == ค่าแถว 2
def test_parse_without_velocity_flag_has_none(self):   # report เดิม → eph.velocities_kms is None
def test_missing_velocity_column_drops_satellite(self):  # ไม่มี G01.EarthFixed.VZ → "G01" ไม่อยู่ใน positions_km และมี SAT_MISSING_FROM_GMAT
def test_propagate_accepts_plain_tle_satellite(self):   # dataclass ที่มีแค่ prn, tle_lines + mock run_script ที่เขียน report → ได้ Ephemeris
```

ใน `tests/test_sp3.py`: `test_lagrange_at_with_presorted_times_matches_default` ต้องได้ค่าเดียวกับเรียกแบบไม่ส่ง `times` ทั้งที่จุดตรงกับ epoch และระหว่าง epoch

- [ ] **Step 3: รัน test ให้เห็นว่าล้ม** — `cd api-interop/gnss-predict && python3 -m unittest tests.test_propagate tests.test_sp3` ต้อง FAIL ที่ `with_velocity`/`times` (golden ผ่าน)

- [ ] **Step 4: Implement** — `with_velocity=True` เพิ่ม `VX VY VZ` ต่อจาก `X Y Z` ของแต่ละดวง
  `parse_ecef_report` อ่าน 6 คอลัมน์ต่อดวงเมื่อเปิด ดวงที่ขาดคอลัมน์ใดหรือค่าไม่ใช่ตัวเลขถูกตัดด้วย `_missing` เดิม
  `write_tle_file` และ `render_ecef_script` ใช้แค่ `prn`/`tle_lines` ของ `TleSatellite`
  `lagrange_at` ใช้ `times` แทน `sorted(series)` เมื่อส่งมา

- [ ] **Step 5: รัน test ทั้งชุดของ engine** — `python3 -m unittest discover -s tests` ต้องผ่านทั้งหมด (integration ข้ามได้)

- [ ] **Step 6: Commit** — `feat(gnss-predict): optional EarthFixed velocity and generic TLE satellites in propagate`

### Task 2: Engine — `ecef_to_geodetic` และ `astro.py`

**Files:**
- Modify: `api-interop/gnss-predict/gnss_predict/geometry.py`
- Create: `api-interop/gnss-predict/gnss_predict/astro.py`, `api-interop/gnss-predict/tests/test_astro.py`
- Test: `api-interop/gnss-predict/tests/test_geometry.py`

**Interfaces:**
- Produces:
  - `geometry.ecef_to_geodetic(x_km: float, y_km: float, z_km: float) -> tuple[float, float, float]` → (lat_deg, lon_deg, h_km)
  - `astro.julian_date(t: datetime) -> float`, `astro.gmst_rad(t: datetime) -> float`
  - `astro.sun_eci_km(t) -> Position` (mean equator of date), `astro.sun_ecef_km(t) -> Position`
  - `astro.ecef_to_eci(vec, t) -> Position`, `astro.eci_to_ecef(vec, t) -> Position` (หมุนรอบ z ด้วย ∓GMST)
  - `astro.subpoint(ecef_km: Position) -> tuple[float, float]` → (lat_deg, lon_deg)

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน**

```python
# test_geometry.py
def test_ecef_to_geodetic_round_trip(self):
    for lat, lon, h_m in [(0, 0, 0), (90, 0, 1000), (-90, 45, 0), (13.729779, 100.781151, 6.4), (45, -120, 20_000_000)]:
        la, lo, h_km = ecef_to_geodetic(*geodetic_to_ecef(lat, lon, h_m))
        self.assertAlmostEqual(la, lat, delta=1e-9)
        if abs(lat) < 90: self.assertAlmostEqual(lo, lon, delta=1e-9)
        self.assertAlmostEqual(h_km * 1000, h_m, delta=1e-3)

# test_astro.py  (ค่าจาก Meeus, Astronomical Algorithms ตัวอย่าง 12.a, 12.b, 25.a)
def test_gmst_meeus_12a(self):
    self.assertAlmostEqual(math.degrees(gmst_rad(datetime(1987, 4, 10, tzinfo=UTC))), 197.693195, delta=1e-5)
def test_gmst_meeus_12b(self):
    self.assertAlmostEqual(math.degrees(gmst_rad(datetime(1987, 4, 10, 19, 21, tzinfo=UTC))), 128.7378734, delta=1e-5)
def test_sun_meeus_25a(self):
    x, y, z = sun_eci_km(datetime(1992, 10, 13, tzinfo=UTC))
    self.assertAlmostEqual(math.degrees(math.atan2(y, x)) % 360, 198.38083, delta=0.01)
    self.assertAlmostEqual(math.degrees(math.asin(z / math.dist((0, 0, 0), (x, y, z)))), -7.78507, delta=0.01)
    self.assertAlmostEqual(math.dist((0, 0, 0), (x, y, z)) / 149597870.7, 0.99766, delta=1e-4)
def test_sun_subpoint_matches_ra_minus_gmst(self):
    # subpoint(sun_ecef_km(t)) ≈ (Dec, wrap180(RA − GMST)) ไม่เกิน 0.01°
```

- [ ] **Step 2: รันให้เห็นว่าล้ม** — `python3 -m unittest tests.test_geometry tests.test_astro` → ImportError/AttributeError

- [ ] **Step 3: Implement** — `ecef_to_geodetic` วนซ้ำด้วย `WGS84_A_KM`, `WGS84_F` จนมุมต่างไม่เกิน 1e-12 rad (สูงสุด 10 รอบ)
  `hypot(x, y) < 1e-9` คืน lat ±90, lon 0 `gmst_rad` ใช้ Meeus สมการ 12.4 (UT1 = UTC)
  `sun_eci_km` ใช้สูตรของ Astronomical Almanac ที่ spec §4.3 กำหนด:

```text
n = JD − 2451545.0
L = 280.460 + 0.9856474 n ;  g = 357.528 + 0.9856003 n          (องศา)
λ = L + 1.915 sin g + 0.020 sin 2g ;  ε = 23.439 − 0.0000004 n
R = 1.00014 − 0.01671 cos g − 0.00014 cos 2g  (AU, 1 AU = 149597870.7 km)
eci = R·(cos λ, cos ε sin λ, sin ε sin λ)
```

- [ ] **Step 4: รัน test ทั้งชุดของ engine ให้ผ่าน**
- [ ] **Step 5: Commit** — `feat(gnss-predict): add ecef_to_geodetic and low-precision GMST/Sun (astro)`

### Task 3: Server scaffold, config, error และ QTH store

**Files:**
- Create: `api-interop/gpredict-web/.gitignore` (`data/`, `.venv/`, `web/node_modules/`, `web/dist/`), `server/requirements.txt`
  (`fastapi==0.162.4`, `uvicorn==0.54.0`, `websockets==17.3`, `httpx2==2.16.0`)
- Create: `server/gpredict_web/__init__.py` (ใส่ `api-interop/gnss-predict` ใน `sys.path` จากตำแหน่งไฟล์), `config.py`, `errors.py`, `store.py`
- Test: `server/tests/__init__.py`, `server/tests/helpers.py` (`temp_config()` คืน `Config` ที่ชี้ temp dir ทั้งหมด), `server/tests/test_store.py`

(ทุก path ใน Task 3–12 อยู่ใต้ `api-interop/gpredict-web/`)

**Interfaces:**
- Produces:
  - `config`: ค่าคงที่ใน Global Constraints, `PORT = 8740`, `TLE_OLD_DAYS = 7`, `NAME_RE`,
    `TLE_GROUPS = ("amateur", "cubesat", "galileo", "glo-ops", "gps-ops", "iridium-NEXT", "science", "last-30-days", "visual", "weather")`
  - `@dataclass(frozen=True) Config(data_dir: Path, web_dist: Path, omm_cache_dir: Path)` + property `state_file`
    (= `omm_cache_dir / CELESTRAK_STATE_FILE`) + `Config.from_env(data_dir: Path | None = None)`
    (data_dir: ค่าที่ส่ง → `GPREDICT_WEB_DATA` → `api-interop/gpredict-web/data`; omm_cache_dir: `gnss_predict.config.OMM_CACHE_DIR`)
  - `errors.ApiError(code: str, status: int, text: str, object: str | None = None)` + `.to_dict()` → `{code, level: "error", text, object}`
  - `store.write_json_atomic(path: Path, obj) -> None`
  - `@dataclass Qth(name, description="", location="", lat_deg=0.0, lon_deg=0.0, alt_m=0.0, weather_station="")`, `qth_from_dict(d) -> Qth`
  - `Store(data_dir)`: `list_qth() -> list[Qth]`, `get_qth(name) -> Qth`, `put_qth(q) -> None`, `delete_qth(name) -> None`,
    `default_qth() -> str | None`, `set_default_qth(name) -> None`

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน** — `test_qth_round_trip`, `test_qth_rejects` (เป็น subTest: ชื่อ 26 ตัว, ชื่อมีช่องว่าง, lat 90.1,
  lon −180.1, alt −1, alt 5000.1, location 51 ตัว, description 257 ตัว, weather_station 5 ตัว → `ApiError` code `QTH_INVALID` status 422),
  `test_get_missing_qth_is_not_found` (404 `NOT_FOUND`), `test_delete_last_qth_is_in_use` (409 `IN_USE`),
  `test_atomic_write_leaves_no_temp_files`, `test_default_qth_round_trip`
- [ ] **Step 2: รันให้เห็นว่าล้ม** — `cd server && ../.venv/bin/python -m unittest tests.test_store`
- [ ] **Step 3: Implement** — ไฟล์ `data/qth/<name>.json`, `data/settings.json` (`default_qth`) ข้อความ error เป็นภาษาไทยที่บอกชื่อช่อง
- [ ] **Step 4: รันให้ผ่าน**
- [ ] **Step 5: Commit** — `feat(gpredict-web): scaffold server package with config, errors and QTH store`

### Task 4: Module model, layout code และ module store

**Files:**
- Create: `server/gpredict_web/module.py`
- Modify: `server/gpredict_web/store.py`
- Test: `server/tests/test_module.py`

**Interfaces:**
- Consumes: `Store`, `ApiError`, `MAX_SATS`, `NAME_RE`
- Produces:
  - ชื่อจาก ref §3–§7 ตรงตัว: `LIST_COLUMNS` (27 ชื่อตาม ref §4 พร้อม `LIST_HINTS`), `LIST_DEFAULT = ["Satellite","Az","El","Dir","Range","Next Event","Alt","Orbit"]`,
    `SINGLE_FIELDS` (23 ชื่อ ref §7 พร้อม `SINGLE_HINTS`), `SINGLE_DEFAULT` (ช่องที่มี ✔ ใน ref §7),
    `MAP_CONTENTS` (8 ชื่อ ref §5 ตามลำดับ), `MAP_DEFAULT_OFF = {"Cursor Position", "Solar Terminator"}`,
    `POLAR_CONTENTS` (6 ชื่อ ref §6), `POLAR_DEFAULT_OFF = {"Extra Az Ticks"}`, `POLAR_ORIENTATIONS = ("N/E/S/W","N/W/S/E","S/E/N/W","S/W/N/E")`,
    `LAYOUT_PRESETS: list[tuple[str, str]]` 9 รายการ (ป้าย, code) ตามตาราง ref §3 เรียง 0–8 (Custom ไม่อยู่ในรายการ)
  - `@dataclass(frozen=True) ViewCell(type: int, left: int, right: int, top: int, bottom: int)`, `parse_layout(code: str) -> list[ViewCell]` (ValueError)
  - `@dataclass ModuleConfig`: `name`, `qth: str | None`, `satellites: list[int]`, `layout_code`,
    `refresh: dict` (`data_ms`=300, `list`=1, `map`=10, `polar`=3, `single`=1, `event`=1),
    `list_columns: list[str]`, `list_sort: dict` (`column`="Satellite", `ascending`=True),
    `map: dict` (`contents: dict[str,bool]`, `track_orbits`=3, `center_lon`=0),
    `polar: dict` (`orientation`="N/E/S/W", `contents`, `auto_skytrack`=False),
    `single: dict` (`fields`, `selected: int | None`), `footprint_off: list[int]`, `ground_track: list[int]`, `sky_track: list[int]`
  - `module_from_dict(d: dict, qth_names: set[str], norads: set[int]) -> ModuleConfig` (ใส่ค่าตั้งต้นให้ช่องที่ไม่มี), `module_to_dict(m) -> dict`
  - `Store`: `list_modules() -> list[str]`, `get_module(name) -> ModuleConfig`, `put_module(m)`, `delete_module(name)`,
    `modules_using_qth(name) -> list[str]` (module ที่ `qth is None` ใช้สถานีตั้งต้น), `session() -> list[str]`, `set_session(names)`

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน**

```python
def test_preset0_layout(self):
    self.assertEqual(parse_layout(LAYOUT_PRESETS[0][1]),
                     [ViewCell(1, 0, 2, 0, 1), ViewCell(2, 0, 1, 1, 2), ViewCell(3, 1, 2, 1, 2)])
def test_all_presets_parse(self):          # ทุก preset parse ได้ และ preset 7 มี type ครบ {0,1,2,3,4}
def test_bad_layout_codes(self):           # "1;0;2;0", "5;0;1;0;1", "1;2;1;0;1", "a;0;1;0;1", "" → ValueError
def test_defaults_match_gpredict(self):    # module_from_dict({"name":"A","satellites":[25544]}, ...) ได้ refresh/columns/contents/orientation ตาม ref
def test_module_validation(self):          # subTest: data_ms 99 และ 10001, cycle 0 และ 51, track_orbits 11, center_lon 181,
                                           # orientation "N/S", คอลัมน์ "Foo", satellites [], NORAD ที่ไม่รู้จัก, qth ที่ไม่มี → MODULE_INVALID 422
def test_too_many_sats(self):              # 201 ดวง → MODULE_TOO_MANY_SATS 422
def test_delete_qth_used_by_module_is_in_use(self):
def test_session_round_trip(self):
```

- [ ] **Step 2: รันให้เห็นว่าล้ม** → **Step 3: Implement** (`data/modules/<name>.json`, `data/session.json`) → **Step 4: รันให้ผ่าน**
- [ ] **Step 5: Commit** — `feat(gpredict-web): module config with Gpredict defaults and layout codes`

### Task 5: ฐานข้อมูลดาวและ Update TLE

**Files:**
- Create: `server/gpredict_web/satdb.py`
- Test: `server/tests/test_satdb.py` (ใช้ `api-interop/gnss-predict/tests/fixtures/studio/omm_sample.json` 10 ดวงแบ่งเป็นสองกลุ่มใน temp dir)

**Interfaces:**
- Consumes: `omm.read_omm`, `omm.to_tle_lines`, `omm.catalog_field`, `omm.fetch_group(group, dest_dir, state_file, now, opener=...)`,
  `OrbitUnavailableError`, `Config`, `TLE_GROUPS`
- Produces:
  - `@dataclass SatRecord(norad: int, name: str, groups: list[str], tle_lines: tuple[str, str], epoch: datetime, updated: datetime)`
  - `gmat_name(norad: int) -> str` (= `"S" + catalog_field(norad)`)
  - `@dataclass UpdateResult(updated: int, skipped: int, missing: int, messages: list[Message])`
  - `SatDb(path: Path)`: `get(norad) -> SatRecord | None`, `search(q="", group=None, limit=500) -> list[SatRecord]`, `groups() -> list[str]`,
    `apply_groups(files: dict[str, Path], now) -> UpdateResult`, `save()`, `__len__`
  - `update_from_network(db, cfg, now, groups=TLE_GROUPS, opener=urlopen) -> UpdateResult`

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน** — `test_newest_epoch_wins_and_groups_merge`, `test_counts_updated_skipped_missing`
  (apply ชุดเดิมซ้ำ → updated 0, skipped 10; ดวงที่ไม่อยู่ในไฟล์ใดเลยนับ missing และยังอยู่ใน db),
  `test_search_by_name_norad_group` (ไม่สนตัวพิมพ์, NORAD ตรงตัว, เรียงตามชื่อ, limit),
  `test_update_from_network_uses_shared_cache_and_rate_rule` (opener ปลอมแบบเดียวกับ `tests/test_omm.py`; เรียกซ้ำทันทีต้องไม่เรียก opener อีก),
  `test_group_unavailable_becomes_warning` (OrbitUnavailableError → ข้ามกลุ่มนั้น, message `ORBIT_DOWNLOAD_FAILED` warning)
- [ ] **Step 2: รันให้เห็นว่าล้ม** → **Step 3: Implement** (`data/satdb.json`) → **Step 4: รันให้ผ่าน**
- [ ] **Step 5: Commit** — `feat(gpredict-web): satellite index from CelesTrak OMM groups with Gpredict update counts`

### Task 6: นาฬิกาของ module

**Files:** Create `server/gpredict_web/clock.py`; Test `server/tests/test_clock.py`

**Interfaces:**
- Produces: `ModuleClock(now: Callable[[], datetime])` มี `state: str` (`forward`/`backward`/`stop`), `throttle: int`, `time() -> datetime`,
  `set(state: str | None = None, throttle: int | None = None, time: datetime | None = None) -> None` (ValueError เมื่อค่าผิด),
  `reset() -> None`, `label() -> str` ("Real-Time" / "Simulated Real-Time" / "Manual Control"), `direction() -> int` (+1/−1/0)

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน** (นาฬิกาปลอมที่เลื่อนได้) — `test_starts_real_time`, `test_throttle_50_runs_50x_without_jump`,
  `test_backward`, `test_stop_holds_time_and_set_time`, `test_reset`, `test_labels` (forward throttle 1 ที่ offset 0.5 s → Real-Time,
  offset 2 s → Simulated Real-Time, stop → Manual Control), `test_invalid_values` (throttle 0, 101, state "pause" → ValueError)
- [ ] **Step 2–4:** รันให้ล้ม → implement ตาม spec §6.4 → รันให้ผ่าน
- [ ] **Step 5: Commit** — `feat(gpredict-web): module clock with Gpredict throttle states`

### Task 7: ช่วงคำนวณ, cache และคิว GMAT

**Files:** Create `server/gpredict_web/ephem.py`; Test `server/tests/test_ephem.py`

**Interfaces:**
- Consumes: `propagate(..., with_velocity=True, on_gmat_start=...)`, `find_gmat_console`, `lagrange_at(..., times=)`, `GmatRunError`, `GmatNotFoundError`, `Config`
- Produces:
  - `Window = tuple[datetime, datetime]`; `window_for(t, direction: int) -> Window`; `usable(w, t) -> bool`; `needs_next(w, t, direction) -> bool`
  - `@dataclass(frozen=True) SatSpec(norad: int, prn: str, tle_lines: tuple[str, str])` (เข้ากับ `TleSatellite`); `tle_key(tle_lines) -> str`
  - `SatEphem(times: list[datetime], pos: list[Position], vel: list[Position])` + `state_at(t) -> tuple[Position, Position] | None`
  - `EphemManager(cfg, propagate_fn=propagate, find_console=find_gmat_console, start_worker=True)`:
    `ensure(owner: str, sats: list[SatSpec], window: Window) -> None`, `get(spec: SatSpec, window) -> SatEphem | None`,
    `status(owner) -> tuple[str, list[Message]]` (`ok`/`computing`/`failed` + ข้อความ), `release(owner)`, `retry(owner)`,
    `prune(now)`, `drain()` (ทำคิวให้หมดใน thread ปัจจุบัน ใช้ตอน `start_worker=False`)

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน** (`propagate` ปลอมที่จดการเรียกและคืน Ephemeris เชิงเส้นพร้อมความเร็ว)

```python
def test_window_forward(self):  self.assertEqual(window_for(T("2026-11-12T07:20Z"), +1), (T("2026-11-12T05:00Z"), T("2026-11-12T21:00Z")))
def test_window_backward(self): self.assertEqual(window_for(T("2026-11-12T07:20Z"), -1), (T("2026-11-11T18:00Z"), T("2026-11-12T10:00Z")))
def test_usable_edges(self):    # start+150 s ใช้ได้, start+149 s ไม่ได้, stop−150 s ใช้ได้
def test_needs_next(self):      # forward: stop − t = 2:59 → True, 3:00 → False; backward ดูฝั่ง start
def test_runs_only_missing_sats(self):      # ensure(A,[s1,s2]) แล้ว ensure(B,[s2,s3]) → propagate ครั้งที่สองได้แค่ s3
def test_tle_change_recomputes(self):
def test_disk_cache_survives_restart(self): # manager ใหม่ที่ data_dir เดิม get() ได้โดยไม่เรียก propagate
def test_prune_removes_windows_older_than_7_days(self):
def test_release_cancels_queued_and_kills_running(self):  # งานในคิวไม่ถูกเรียก; งานที่รันอยู่ → os.killpg(pgid, SIGKILL) (mock)
def test_gmat_failure_then_retry(self):     # GmatRunError → ("failed", [GMAT_FAILED]); retry → computing → ok
def test_gmat_not_found(self):              # GmatNotFoundError → GMAT_NOT_FOUND
def test_state_at_interpolates_position_and_velocity(self):
```

- [ ] **Step 2–4:** รันให้ล้ม → implement ตาม spec §5 (ไฟล์ `data/ephem/<start>_<stop>_<step>/<key>.f64` ใช้ `array('d')` little-endian,
  work dir `data/ephem/_work/<job id>/`, worker thread เดียว, ทุก method ใช้ lock เดียว) → รันให้ผ่าน
- [ ] **Step 5: Commit** — `feat(gpredict-web): GMAT ephemeris windows with per-satellite cache and cancellable queue`

### Task 8: ค่าที่คำนวณต่อดาว

**Files:** Create `server/gpredict_web/observe.py`; Test `server/tests/test_observe.py`

**Interfaces:**
- Consumes: `ecef_to_aer`, `ecef_to_geodetic`, `geodetic_to_ecef`, `astro.*`
- Produces:
  - `@dataclass TleElements(epoch, mean_motion, ndot2, bstar, incl_deg, raan_deg, ecc, argp_deg, m0_deg, revnum)`; `parse_tle(lines) -> TleElements`
  - `is_geo(el) -> bool`, `is_decayed(el, t) -> bool`, `orbit_number(el, t) -> int`, `orbit_start(el, t) -> datetime`
  - `maidenhead(lat, lon) -> str`, `footprint_km(alt_km)`, `doppler_hz(rate_kms)`, `loss_db(range_km)`, `delay_ms(range_km)`
  - `inertial_speed_kms(r, v)`, `radec_deg(r, q, t) -> tuple[float, float]`, `osculating_phase_deg(r, v, t) -> float`
  - `visibility(r, t, q_lat, q_lon, el_deg) -> str` (`V`/`D`/`E`), `direction(rate, prev_rate, geo, decayed) -> str`
  - `@dataclass QthGeo(name, location, lat_deg, lon_deg, alt_m, ecef_km)` + `qth_geo(q: Qth) -> QthGeo`
  - `observe(r, v, t, q: QthGeo, el: TleElements, prev_rate: float | None) -> dict` คืนช่องของดาวใน tick (spec §7.3) ยกเว้น `norad`, `name`, `next_aos`, `next_los`, `always`

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน**

```python
def test_maidenhead(self):   # (13.729779, 100.781151) → "OK03jr"; (0,0) → "JJ00aa"; (-90,-180) → "AA00aa"; (89.999,179.999) → "RR99xx"
def test_radio_values(self): # doppler_hz(-1.0) ≈ 333.564095; loss_db(1000) == 132.4; delay_ms(299.792458) == 1.0
def test_footprint(self):    self.assertAlmostEqual(footprint_km(400.0), 12756.33 * math.acos(6378.135 / 6778.135))
def test_inertial_speed(self):  self.assertAlmostEqual(inertial_speed_kms((7000, 0, 0), (0, 7.0, 0)), 7.0 + 7.292115e-5 * 7000)
def test_direction(self):    # G, D, "↓" (0.002), "↑" (−0.002), "↺" (0.0005 < prev 0.0008), "↷" (0.0005 ≥ prev 0.0001)
def test_geo_and_decay(self):  # mm 1.0027 → geo; 1.0030 → ไม่ใช่; ndot2 0.001, mm 15.9 → decayed หลัง epoch + 76.667 วัน; ndot2 0 → ไม่เคย
def test_orbit_number(self):   # M0+ω = 180°, n = 15.5, B* = 0, rev 1000: epoch → 1000; +0.5 d → 1008; +1 d → 1016
def test_orbit_start(self):    # กรณีเดียวกันที่ +0.5 d → epoch + (8 − 0.5)/15.5 วัน คลาดไม่เกิน 1 s
def test_osculating_phase(self):  # สร้าง r,v จาก a=7000, e=0.01, i=51.6, Ω=30, ω=40, M=123.4 ในกรอบเฉื่อย แปลงเป็น EarthFixed ที่ t → 123.4 ± 1e-6
def test_visibility(self):     # ดาวอยู่ฝั่งตรงข้ามดวงอาทิตย์ที่ 7000 กม. → E; โดนแสง + ดวงอาทิตย์ที่ QTH ≤ −6° + El ≥ 0 → V; ดวงอาทิตย์สูง → D
def test_radec_overhead(self): # ดาวตรงหัว QTH (0°,0°) → RA ≈ degrees(GMST), Dec ≈ 0 (±1e-6)
```

- [ ] **Step 2–4:** รันให้ล้ม → implement ตามสูตร spec §6.1–6.2 (orbit number ตามสูตร Gpredict ใน spec §6.2; `orbit_start` หาเวลาที่ค่าในวงเล็บข้าม
  จำนวนเต็มล่าสุดด้วยการแบ่งครึ่ง; MA = phase × 256 / 360) → รันให้ผ่าน
- [ ] **Step 5: Commit** — `feat(gpredict-web): Gpredict observables from GMAT state`

### Task 9: Pass, ground track และ sky track

**Files:** Create `server/gpredict_web/passes.py`, `server/gpredict_web/tracks.py`; Test `server/tests/test_passes.py`, `server/tests/test_tracks.py`

**Interfaces:**
- Consumes: `SatEphem`, `QthGeo`, `TleElements`, `orbit_start`, `analyze.intervals_from_elevations`, `ecef_to_aer`, `ecef_to_geodetic`
- Produces:
  - `@dataclass(frozen=True) Pass(aos: datetime | None, los: datetime | None, max_el: float, t_max_el: datetime)`
  - `find_passes(eph: SatEphem, q: QthGeo) -> list[Pass]`
  - `next_events(passes, eph, q, t) -> tuple[datetime | None, datetime | None, str | None]` → (next_aos, next_los, always: "in"/"out"/None)
  - `ground_track(eph, el, t, orbits: int) -> list[list[tuple[float, float]]]` (lat, lon แยกเส้นเมื่อข้าม ±180°)
  - `sky_track(eph, q, passes, t) -> list[dict] | None` (`{"t", "az", "el"}` ทุก 10 วินาทีจาก AOS ถึง LOS ของ pass ปัจจุบัน)

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน** ด้วยวงโคจรสังเคราะห์: วงกลมรัศมี r = 7000 กม. ในระนาบที่เอียงจาก QTH (0°, 0°, 0 ม.) เป็นมุม β
  มุมเฉลี่ย ω = sqrt(398600.4418 / r³) ตัวอย่างทุก 30 วินาที (สร้าง `SatEphem` จากสูตรตรงพร้อมความเร็ว)

```python
def test_aos_los_match_closed_form(self):  # β = 0: AOS/LOS ห่างจากจุดใกล้สุด ± acos(6378.137/7000)/ω ภายใน 0.1 s
def test_short_pass_between_samples(self): # β = 24.32° และจุดใกล้สุดอยู่กลางระหว่างสองตัวอย่าง: ต้องเจอ pass
                                           # ยาว 2·acos((6378.137/7000)/cos β)/ω ± 0.5 s
def test_pass_cut_by_window_has_none(self):  # pass ที่เริ่มก่อนต้นช่วง → aos is None
def test_always_in_and_out(self):          # ตำแหน่งคงที่เหนือ QTH → "in"; ใต้ขอบฟ้า → "out"
def test_ground_track_splits_at_antimeridian(self):
def test_ground_track_starts_at_orbit_start_and_stops_at_window_end(self):
def test_sky_track_every_10s_only_when_up(self):
```

- [ ] **Step 2–4:** รันให้ล้ม → implement ตาม spec §6.3 → รันให้ผ่าน
- [ ] **Step 5: Commit** — `feat(gpredict-web): refined AOS/LOS, ground track and sky track`

### Task 10: Runtime ของ module และ tick

**Files:** Create `server/gpredict_web/runtime.py`; Test `server/tests/test_runtime.py`

**Interfaces:**
- Consumes: ทุกอย่างจาก Task 3–9
- Produces:
  - `ModuleRuntime(module: ModuleConfig, qth: Qth, sats: list[SatRecord], ephem: EphemManager, clock: ModuleClock)`:
    `tick() -> dict` (รูปแบบ spec §7.3 ทุกช่อง), `track(norad) -> list`, `skytrack(norad) -> list | None`
    (cache pass ต่อ `(tle_key, window, qth)`; สั่ง `ephem.ensure` ทั้งช่วงปัจจุบันและช่วงถัดไปเมื่อ `needs_next`)
  - `Hub(store: Store, satdb: SatDb, ephem: EphemManager, now: Callable[[], datetime])`:
    `open(name) -> ModuleRuntime`, `close(name)`, `get(name) -> ModuleRuntime | None`, `reload(name)`, `open_names() -> list[str]`

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน** (EphemManager จริงกับ `propagate` ปลอมที่ให้วงโคจรสังเคราะห์, `start_worker=False` แล้ว `drain()`)
  — `test_tick_shape_matches_spec` (ทุก key ใน spec §7.3), `test_status_computing_then_ok`,
  `test_clock_jump_triggers_recompute` (เลื่อนนาฬิกาปลอม 10 ชม. → `computing` → drain → `ok`),
  `test_tick_omits_missing_sat_without_error` (propagate ไม่คืนดวงที่ `single.selected` → ไม่มีใน `sats`, มี `SAT_MISSING_FROM_GMAT`),
  `test_tle_old_warning` (epoch เก่ากว่า T 7 วัน 1 นาที), `test_decayed_sat_not_sent`, `test_next_window_requested_near_end`
- [ ] **Step 2–4:** รันให้ล้ม → implement → รันให้ผ่าน
- [ ] **Step 5: Commit** — `feat(gpredict-web): module runtime building WebSocket ticks`

### Task 11: FastAPI app, WebSocket, การเปิดครั้งแรก และ `__main__`

**Files:**
- Create: `server/gpredict_web/app.py`, `server/gpredict_web/bootstrap.py`, `server/gpredict_web/__main__.py`
- Test: `server/tests/test_api.py`, `server/tests/test_ws.py`, `server/tests/test_bootstrap.py`

**Interfaces:**
- Produces:
  - `create_app(cfg: Config, start_background: bool = True, opener=urlopen, now=utcnow, on_quit: Callable[[], None] | None = None) -> FastAPI`
  - route ตามตาราง spec §7.3 ทุกบรรทัด + `GET /api/meta` (ค่าคงที่ใน `module.py` + `TLE_GROUPS`) + `GET /api/license`
  - `bootstrap(store, satdb, cfg, now, opener) -> list[Message]`
  - `python -m gpredict_web [--host H] [--port P] [--data DIR]` (uvicorn.Server; `on_quit` ตั้ง `server.should_exit = True`;
    `--host` ที่ไม่ใช่ `127.0.0.1`/`localhost` พิมพ์คำเตือนไทยว่าไม่มี login ลง stderr; ตอนเริ่มเรียก `EphemManager.prune(now)` และ `bootstrap`)

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน**
  - `test_api.py`: ทุก route ใน spec §7.3 อย่างน้อยกรณีสำเร็จหนึ่งกรณี และทุกรหัสใน spec §7.4 ที่เป็น HTTP (`QTH_INVALID`, `MODULE_INVALID`,
    `MODULE_TOO_MANY_SATS`, `NOT_FOUND`, `IN_USE`) + `CLOCK_INVALID`; `test_put_module_while_open_updates_tick`;
    `test_quit_calls_hook`; `test_static_served_when_dist_exists`
  - `test_ws.py`: ข้อความแรกมีทุก key ของ spec §7.3; ช่วงห่างระหว่างข้อความ ≈ `refresh.data_ms`; ปิด module → socket ปิดด้วย 1000
  - `test_bootstrap.py`: `test_bootstrap_offline_creates_qth_only` (opener ที่ raise URLError, ไม่มี cache → มี THBK เป็นสถานีตั้งต้น, ไม่มี module,
    message ไทยบอกให้ Update TLE); `test_bootstrap_creates_amateur` (opener ปลอมคืน OMM fixture → module `Amateur`, `qth=None`, เปิดอยู่ใน session);
    `test_bootstrap_caps_at_max_sats` (OMM 205 ดวง → 200 ดวงแรกตามชื่อ + คำเตือน); `test_bootstrap_runs_once` (เรียกซ้ำไม่เปลี่ยนอะไร)
- [ ] **Step 2–4:** รันให้ล้ม → implement (WebSocket ส่ง tick ด้วย `asyncio` ตาม `refresh.data_ms`; งานคำนวณ tick เรียกผ่าน `asyncio.to_thread`;
  `POST /api/tle/update` เรียก `update_from_network` ทุกกลุ่มแล้ว `hub.reload` ทุก module ที่เปิด) → รันให้ผ่าน
- [ ] **Step 5: Commit** — `feat(gpredict-web): REST and WebSocket API with first-start bootstrap`

### Task 12: Integration กับ GMAT จริง

**Files:** Create `server/tests/test_integration_gmat.py` (`@unittest.skipUnless` เมื่อหา GmatConsole ไม่เจอ)

**Interfaces:** Consumes `EphemManager`, `find_passes`, `observe`, `propagate`

- [ ] **Step 1: เขียน test** ด้วย TLE 3 ดวงที่คำนวณ checksum ด้วย `tle_fetch.tle_checksum`:
  ISS (บรรทัด 2: `51.6400 208.9163 0006317 69.9862 25.2906 15.49438945`), GEO (`0.0500 90.0000 0001000 270.0000 180.0000 1.00271000`),
  Molniya (`63.4000 120.0000 7000000 270.0000 0.0000 2.00600000`) epoch ทั้งหมด `26313.50000000`, QTH = THBK
  1. รันช่วง 16 ชม. ทุก 30 วินาทีผ่าน `EphemManager` หา pass แรกของ ISS
  2. รัน GMAT ตรงทุก 1 วินาที 2 ชม. ครอบ pass นั้น
  3. ทุกวินาทีเทียบ: ตำแหน่ง ≤ 10 ม., Az/El ≤ 0.01° (เมื่อ El > 0), range rate ≤ 0.1 ม./วินาที (ทั้ง 3 ดวง)
  4. AOS/LOS ของ ISS เทียบจุดตัด 0° ของ El รายวินาที (เชิงเส้น) ≤ 1 วินาที
- [ ] **Step 2: รัน** — `../.venv/bin/python -m unittest tests.test_integration_gmat -v` ต้องผ่าน (ไม่ใช่ skipped) บนเครื่องพัฒนา
- [ ] **Step 3: Commit** — `test(gpredict-web): interpolation and AOS/LOS accuracy against 1-s GMAT`

### Task 13: Web scaffold, API client, socket และโครงหน้าต่าง

**Files:**
- Create: `web/package.json` (เวอร์ชันตาม Tech Stack, scripts `dev`, `build` = `tsc -b && vite build`, `test` = `vitest run`),
  `web/vite.config.ts` (proxy `/api` และ `/ws` ไป `http://127.0.0.1:8740`, `ws: true`), `web/tsconfig.json`, `web/index.html` (title "Gpredict Web")
- Create: `web/src/main.tsx`, `App.tsx`, `api.ts`, `types.ts`, `useModuleSocket.ts`, `format.ts`, `layout.ts`, `styles.css`, `components/ModuleView.tsx`, `components/Overlay.tsx`
- Test: `web/src/format.test.ts`, `web/src/layout.test.ts`, `web/src/useModuleSocket.test.ts`

**Interfaces:**
- Produces:
  - `types.ts`: `Tick`, `SatState`, `ModuleConfig`, `Qth`, `Meta`, `SatRecord` ตรงกับ JSON ของ spec §7.1–7.3
  - `api.ts`: หนึ่งฟังก์ชันต่อ route (`getModules()`, `putModule(m)`, `getClock(name)`, `putClock(name, c)`, ...) โยน `ApiError {code, text}` เมื่อ status ≥ 400
  - `useModuleSocket(name: string): { tick: Tick | null; connected: boolean }` ต่อใหม่หลัง 1, 2, 4, 5, 5, ... วินาที
  - `format.ts`: `formatTime(d: Date, fmt = "%Y/%m/%d %H:%M:%S")` (รหัส `%Y %m %d %j %H %M %S` แบบ UTC), `fmtCountdown(sec) -> "MM:SS" | "HH:MM:SS"`, `fmtFixed(x, n)`
  - `layout.ts`: `gridFor(cells: ViewCell[]) -> { columns: number; rows: number; areas: {type, gridColumn, gridRow}[] }`
  - `App` แสดงแถบเมนู (ว่างไว้ให้ Task 18), แท็บ (ซ่อนเมื่อมี module เดียว, ลากสลับแล้ว `PUT /api/session/tabs`), หัว module (เวลา + ปุ่ม "Module menu"),
    grid ของ view (Task 14–16 ใส่ component), overlay `computing`/`failed` พร้อมปุ่ม Retry; ชื่อหน้า "Gpredict Web" / "Gpredict Web: <แท็บ>"
  - `styles.css`: โทนสว่างแบบ GTK 3 (แถบเมนูเทาอ่อน, ปุ่มแบน, แท็บแบบ notebook), ฟอนต์ระบบ, `min-width: 1024px`

- [ ] **Step 1:** `npm install` ด้วยเวอร์ชันที่ pin ไว้ แล้วเขียน test: `formatTime` ครบทุกรหัส, `fmtCountdown(59*60+59) === "59:59"`, `fmtCountdown(3600) === "01:00:00"`,
  `gridFor(parse(preset0))` = 2 คอลัมน์ 2 แถว Map เต็มแถวบน, preset 7 = 4×4 ตาม ref §3,
  `reconnects after the socket closes` (WebSocket ปลอม: ปิดแล้วเปิดใหม่ภายในเวลาที่กำหนด และ `connected` เปลี่ยนตาม)
- [ ] **Step 2–4:** `npm test` ให้ล้ม → implement → `npm test` และ `npm run build` ผ่าน
- [ ] **Step 5: Commit** — `feat(gpredict-web): web shell with tabs, module header, layout grid and live socket`

### Task 14: Map view

**Files:** Create `web/src/views/mapGeom.ts`, `web/src/views/MapView.tsx`, `web/src/colors.ts` (สี RGBA ตาม ref §5–§6), `web/public/maps/earth_1024.jpg`, `web/public/maps/SOURCE.md`;
Test `web/src/views/mapGeom.test.ts`

**Interfaces:**
- Produces: `toXY(lat, lon, w, h, centerLon) -> [x, y]`, `footprintRings(lat, lon, footprintKm) -> [number, number][][]`,
  `nightPolygon(sunLat, sunLon) -> [number, number][]`, `labelPos(x, y, tw, th, w, h) -> { x: number; y: number }`, `hitTest(sats, x, y, px = 10)`

- [ ] **Step 1: ภาพ** — `sips -z 512 1024 application/data/graphics/texture/ModifiedBlueMarble.jpg --out api-interop/gpredict-web/web/public/maps/earth_1024.jpg`
  และเขียน `SOURCE.md` ว่ามาจากไฟล์นี้ของ GMAT (Blue Marble ของ NASA) ย่อด้วย sips
- [ ] **Step 2: เขียน test ที่ยังไม่ผ่าน** — `toXY(0, centerLon, ...)` อยู่กลางแนวนอน, lon = center+180 อยู่ขอบ;
  footprint ที่ (0°, 0°) 4000 กม. เป็นวงปิดวงเดียว; ที่ (85°, 0°) 4000 กม. ครอบขั้วเหนือ (polygon มีขอบบนของแผนที่);
  ที่ (0°, 179°) แยกเป็นสองวงสองฝั่ง; `nightPolygon(0, 0)` มีจุด (0°, 180°) อยู่ข้างใน ไม่มี (0°, 0°);
  `labelPos` ปกติอยู่ใต้ marker, ชิดขอบซ้าย/ขวาย้ายไปด้านข้าง, ชิดขอบล่างย้ายขึ้นบน; `hitTest` ห่าง 10 px เลือกได้ 11 px ไม่ได้
- [ ] **Step 3–4:** implement ฟังก์ชัน + `MapView` วาดตามลำดับ spec §8.4 ทุก `refresh.map` tick, ดึง `/track/{norad}` เมื่อเปิด Ground Track
  หรือ `window` เปลี่ยน, คำนวณ terminator ใหม่ทุก 15 วินาทีของเวลา module → `npm test` ผ่าน
- [ ] **Step 5: Commit** — `feat(gpredict-web): Gpredict map view`

### Task 15: Polar view

**Files:** Create `web/src/views/polarGeom.ts`, `web/src/views/PolarView.tsx`; Test `web/src/views/polarGeom.test.ts`

**Interfaces:**
- Produces: `polarRadius(w, h) = Math.min(w, h) / 2 - 25`, `azElToXY(az, el, cx, cy, r, orientation) -> [x, y]` (ระยะจากศูนย์ = r·(90 − el)/90),
  `trackTicks(points) -> points[4]` (จุดแรกที่ AOS ที่เหลือห่างเท่ากันตาม index)

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน** — El 90 อยู่ศูนย์กลาง; Az 0 El 0: บนสุดใน N/E/S/W และ N/W/S/E, ล่างสุดใน S/E/N/W และ S/W/N/E;
  Az 90 El 0: ขวาใน N/E/S/W และ S/E/N/W, ซ้ายใน N/W/S/E และ S/W/N/E; `trackTicks` ได้ 4 จุดและจุดแรกคือ AOS
- [ ] **Step 2–4:** implement + `PolarView` ตาม spec §8.5 (ดึง `/skytrack/{norad}` เมื่อเปิด Sky track หรือ "Show the sky tracks automatically") → ผ่าน
- [ ] **Step 5: Commit** — `feat(gpredict-web): Gpredict polar view`

### Task 16: List, Event list และ Single sat

**Files:** Create `web/src/views/cells.ts`, `ListView.tsx`, `EventListView.tsx`, `SingleSatView.tsx`; Test `web/src/views/cells.test.ts`

**Interfaces:**
- Consumes: `Meta` (ชื่อและ hint ของคอลัมน์/ช่อง), `format.ts`
- Produces: `listCell(column: string, s: SatState, t: Date) -> string`, `singleCell(field: string, s: SatState | undefined) -> string`, `eventRows(tick) -> Row[]`

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน** — Az `"210.40°"`; Range `"1530"` (ไม่มีหน่วย); Rate `"-5.910"`; Next Event `"2026/11/12 07:06:12 (LOS)"` และ `"--- N/A ---"`;
  Vis `"D"`; Status `"Unknown"`; Decayed `""`; Single: Slant Range `"1530 km"`, Range Rate `"-5.910 km/sec"`, Doppler@100M `"1971 Hz"`,
  Sig. Loss `"136.10 dB"`, Sig. Delay `"5.10 msec"`, Direction จาก `dir` (`"↑"` → `"Approaching"`), Next Event `"LOS: 2026/11/12 07:06:12"`,
  ดาวไม่มีใน tick → `"-"`; Event list เรียงตามเวลานับถอยหลัง และ `"Never"` อยู่ท้าย
- [ ] **Step 2–4:** implement + 3 component ตาม spec §8.6–8.8 (List คลิกหัวคอลัมน์เรียงแล้ว `PUT` module, แถว El > 0 ตัวหนา, AOS/LOS เรียงแบบตัวเลข) → ผ่าน
- [ ] **Step 5: Commit** — `feat(gpredict-web): list, event list and single-sat views`

### Task 17: Time Controller

**Files:** Create `web/src/timeCtl.ts`, `web/src/components/TimeController.tsx`, `web/src/components/FloatingWindow.tsx` (หน้าต่างลอยลากได้ ใช้ซ้ำใน Task 18); Test `web/src/timeCtl.test.ts`

**Interfaces:**
- Produces: `wrapSpin(value, min, max) -> { value: number; carry: number }`, `composeTime(day: Date, h, m, s, ms, sliderDays) -> Date`

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน** — Sec 60 → 0 ทด Min +1; Hour −1 → 23 ทดวัน −1; Msec 1000 → 0 ทด Sec +1; slider 0.1 วัน = +8640 วินาที
- [ ] **Step 2–4:** implement + หน้าต่าง "Time Controller / <module>" ตาม spec §8.9 (เปิดแล้ว `GET clock`; ปุ่ม → `PUT clock`; Reset → `POST clock/reset`;
  เลื่อน slider ขณะเดิน → `stop`; ปิดหน้าต่าง → `POST clock/reset`) → ผ่าน
- [ ] **Step 5: Commit** — `feat(gpredict-web): time controller window`

### Task 18: เมนู, popup และ dialog

**Files:** Create `web/src/locator.ts`, `web/src/components/MenuBar.tsx`, `ModuleMenu.tsx`, `SatPopup.tsx`, `ModuleDialog.tsx`, `ModuleProperties.tsx`,
`QthEditor.tsx`, `OpenModuleDialog.tsx`, `CloneDialog.tsx`, `TleUpdateDialog.tsx`, `HelpDialogs.tsx`, `later.ts`;
Test `web/src/locator.test.ts`, `web/src/components/ModuleDialog.test.ts`, `web/src/later.test.ts`

**Interfaces:**
- Produces: `toLocator(lat, lon) -> string`, `fromLocator(loc) -> { lat: number; lon: number }` (กลาง subsquare),
  `LATER: Record<string, 2 | 3 | 4>` (ชื่อรายการ → งานย่อย ตาม spec §8.2) และ `laterTooltip(n) -> string`
  (`"อยู่ในงานย่อยที่ 2: Pass predictions"` / `"...ที่ 3: Radio & Rotator"` / `"...ที่ 4: Data & Preferences"`),
  `validateModuleForm(form, existing) -> { error?: string; confirmOverwrite?: string }`

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน** — `toLocator(13.729779, 100.781151) === "OK03jr"`; `fromLocator("OK03jr")` ห่างจาก THBK ไม่เกิน 1/48° (lat) และ 1/24° (lon);
  ทุกรายการในตาราง spec §8.2 คอลัมน์ "กดไม่ได้" อยู่ใน `LATER` ด้วยงานย่อยที่ถูกต้อง;
  ฟอร์มที่ไม่มีดาว → `"Please select at least one satellite from the list."`; ชื่อซ้ำ → `"There is already a module called X.\nDo you want to overwrite this module?"`; ชื่อ 26 ตัวหรือมีช่องว่าง → error
- [ ] **Step 2–4:** implement ทุก component ตาม spec §8.2, §8.10 และป้ายใน ref §1–§3, §10 (ทุกรายการใน `LATER` แสดงแต่ disabled พร้อม tooltip;
  Autotrack และ Select satellite ตาม spec §8.2; Quit เรียก `POST /api/quit` แล้วแสดงข้อความไทยว่า server ปิดแล้ว;
  คีย์ลัด Ctrl+N New module, Ctrl+O Open module, Ctrl+Q Quit ผ่าน `keydown` + `preventDefault` เท่าที่ browser ยอม) → `npm test`, `npm run build` ผ่าน
- [ ] **Step 5: Commit** — `feat(gpredict-web): menus, popups and module/QTH/TLE dialogs`

### Task 19: Build, README และตรวจรับ

**Files:** Create `api-interop/gpredict-web/README.md` (ภาษาไทย: ติดตั้ง, รัน, test, ข้อจำกัด, ผลตรวจรับ)

- [ ] **Step 1:** `npm run build` แล้ว `../.venv/bin/python -m gpredict_web --data <temp>` เปิด `http://127.0.0.1:8740`
- [ ] **Step 2: ตรวจรับตาม spec §10 ทีละข้อ** ถ่าย screenshot เก็บใน scratchpad ของ session และจดผลจริง (ผ่าน/ไม่ผ่าน พร้อมตัวเลข) ลง README
  1. เปิดครั้งแรกได้ `Amateur` ที่ THBK ใน preset 0 และอัปเดตตามรอบ
  2. module ใหม่ ISS + 10 ดวงด้วย "All views (wide)" view ครบ 5 แบบ
  3. ผล Task 12
  4. Time Controller: throttle 50, Play backwards, Stop + ตั้งเวลาอีก 3 วัน เห็น overlay แล้วกลับมาแสดงผล, Reset เป็น Real-Time
  5. ปิดเปิด server และ browser ได้ module, ลำดับแท็บ, QTH เดิม
  6. ไล่ป้ายทุกเมนู/คอลัมน์เทียบ ref
  7. `cd api-interop/gnss-predict && python3 -m unittest discover -s tests` ผ่าน
- [ ] **Step 3:** รัน test ครบสามชุด (engine, server, web) ให้ผ่าน
- [ ] **Step 4: Commit** — `docs(gpredict-web): README with run instructions and acceptance results` (`git add -f` README)
