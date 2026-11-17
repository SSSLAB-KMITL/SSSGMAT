# Gpredict Web Pass Predictions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** งานย่อยที่ 2 ของ Gpredict Web: Show current/next pass, Future passes, Pass details (Data/Polar/Az-El, Print, Save),
Sky at a glance และหน้าต่าง Preferences ที่มีกลุ่ม Predict โดยตำแหน่งดาวทุกค่ายังมาจาก GMAT

**Architecture:** server เพิ่ม cache ephemeris รายวัน (block 1 ดาว × 1 วัน) ในคิว GMAT เดิมแบบ 2 ระดับความสำคัญ
ต่อ block เป็น `SatEphem` เส้นเดียวแล้วใช้ `passes.find_passes` ของ core หา pass จากนั้น `pass_predict.py` (ไม่มี I/O)
เลือก pass ตามกติกา get_pass/get_passes ของ Gpredict และสร้างแถวของ Data ส่วนหน้าเว็บแสดงผล วาดกราฟ และสร้างข้อความไฟล์
ค่า Preferences เก็บใน `data/preferences.json` แบบเก็บเฉพาะค่าที่ผู้ใช้ตั้ง

**Tech Stack:** ชุดเดียวกับ core (Python 3.14, FastAPI 0.162.4, unittest; React 19.1.10, Vite 8.3.5, TypeScript 5.9.3, Vitest 4.1.12)
ไม่เพิ่ม dependency

**Spec:** [2026-11-12-gpredict-web-passes-design.md](2026-11-12-gpredict-web-passes-design.md) อ่านคู่กับ
[ref-P](2026-11-12-gpredict-reference-passes.md) และ [ref-D §1](2026-11-12-gpredict-reference-data.md)
(ในแผนนี้ "spec §n" = spec ของงานนี้, "ref-P §n" = รายการอ้างอิงส่วน Pass predictions, "core §n" = spec ของงานย่อยที่ 1)

## Global Constraints

- ทำงานใน worktree `/Users/phuwish/SSSGMAT/.worktrees/gpredict-web` บน branch `feature/gpredict-web-passes` เท่านั้น
  ห้าม `cd` เข้า checkout หลัก `/Users/phuwish/SSSGMAT` ห้าม push ห้าม merge ห้ามใช้ `git stash` แบบไม่มีชื่อ
- `*.md` ถูก ignore ที่ราก repo: ไฟล์ Markdown ต้อง `git add -f`
- ห้ามแก้ `api-interop/gnss-predict/` (engine) ในงานนี้ GNSS Studio ต้องได้ผลเหมือนเดิมทุกไบต์
- คำสั่ง test
  - server: `cd api-interop/gpredict-web/server && ../.venv/bin/python -m unittest discover -s tests`
  - web: `cd api-interop/gpredict-web/web && npm test` และ `npm run build`
  - engine (ตรวจว่าไม่กระทบ): `cd api-interop/gnss-predict && python3 -m unittest discover -s tests`
- test ห้ามใช้เน็ต ใช้ data dir ชั่วคราวเสมอ (`helpers.temp_config`) test ที่ต้องใช้ GMAT จริงข้ามเมื่อ `find_gmat_console()` raise
- worktree ไม่มี GMAT build: test และการรันจริงใช้ `GMAT_BIN=/Users/phuwish/SSSGMAT/application/bin/GmatConsole`
  และ `GNSS_STUDIO_DATA=/Users/phuwish/SSSGMAT/api-interop/gnss-predict/data`
- เวลาใน API เป็น ISO 8601 UTC ลงท้าย `Z` ความละเอียดมิลลิวินาที (`runtime.iso_ms`)
- ป้าย ชื่อหน้าต่าง คอลัมน์ ปุ่ม tooltip และข้อความของ Gpredict ใช้ตาม ref-P ทุกตัวอักษร ข้อความที่เราเพิ่มเป็นภาษาไทย
  ของที่ Gpredict ไม่มีมี comment `(ของเรา)` ในโค้ด
- ค่าคงที่: `STEP_S=30`, `DAY_LRU_BLOCKS=400`, `DAY_KEEP_DAYS=7`, `NEXT_PASS_OFFSET_D=0.007`, `PASS_GAP_D=0.014`,
  `DATA_PAD_D=1`, `AT_TOLERANCE_S=1`, `WAIT_BOX_DELAY_MS=500`, `SKY_REDRAW_D=7.0e-4`, `SKY_MOVE_KM=1`
- ค่า Preferences ทุกตัวเขียนผ่าน `PUT /api/prefs` เท่านั้น (server ตรวจ schema ที่ `prefs.py` ที่เดียว)
- commit message แบบ conventional ภาษาอังกฤษ scope `gpredict-web` ลงท้ายด้วย `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## Review Focus

1. **กด Cancel ในกล่องรอแล้วกด Future passes ใหม่ทันที หรือเปิด Future passes ของดาวหลายดวงติดกัน** งาน GMAT ของคำขอที่ยกเลิก
   ต้องถูกตัดหรือ kill และ block ที่ขอซ้ำกันต้องรัน GMAT ครั้งเดียว → Task 2 `test_overlapping_day_requests_share_one_job`,
   Task 5 `test_client_disconnect_releases_owner`
2. **ตั้ง Time Controller ไปปี 2030 หรือ 2020 แล้วขอ pass** GMAT อาจล้มเหลว ผู้ใช้ควรเห็นข้อความ error ในกล่องรอพร้อม Retry
   ไม่ใช่หน้าค้าง → Task 5 `test_gmat_failure_answers_503`, Task 13 `waiting box shows the error and Retry`
3. **ปิด module หรือเอาดาวออกจาก module ขณะหน้าต่าง Upcoming passes ยังเปิด** หน้าต่างเดิมยังแสดงข้อมูลเดิม คำขอใหม่ได้ 404
   ไม่ใช่ 500 → Task 5 `test_satellite_not_in_module_is_404`
4. **แก้ `preferences.json` ด้วยมือจนค่าผิด** server ต้องเปิดได้ ใช้ค่าตั้งต้นแทน key ที่ผิดและบันทึก log → Task 1
   `test_invalid_value_in_file_falls_back_to_default`
5. **ดาวที่ขึ้นสูงสุดไม่ถึง Minimum elevation ทุก pass ใน 3 วัน** ต้องได้ข้อความ "has no passes\nwithin the next 3 days"
   ไม่ใช่รายการว่าง → Task 4 `test_all_passes_below_min_el_gives_none`, Task 5 `test_no_pass_within_message`

## การตัดสินใจในแผนที่ spec ไม่ได้กำหนดไว้

1. งาน block รายวันอยู่ใน `EphemManager` (คิวเดียวกับ core) ส่วนชื่อโฟลเดอร์ การตัด และการต่อ block อยู่ใน `dayblocks.py` ใหม่
2. owner ของคำขอ pass คือ `pass:<uuid4>` ต่อคำขอ route รอแบบ async ตรวจ `request.is_disconnected()` ทุก 0.2 วินาที
   และ `release_days` ใน `finally` เสมอ
3. Sky at a glance: `GET` ไม่รอ GMAT ตอบ `status` ทันที owner คือ `sky:<module>` หน้าเว็บถามซ้ำทุก 1 วินาทีระหว่าง `computing`
   และเรียก `DELETE /api/modules/{name}/skyglance` ตอนปิดหน้าต่าง `Hub.close` ก็ปล่อย owner นี้ด้วย
4. "Show next pass" ให้ server ตัดสินเองว่าดาวอยู่เหนือขอบฟ้าที่ `t` หรือไม่ และหา LOS ของ pass นั้นจากข้อมูลรายวัน
   หน้าเว็บส่งแค่ `kind` และเวลาของ tick
5. `kind: "at"` หา pass จากข้อมูล `วันของ (aos − 1 วัน)` ถึง `วันของ (aos + 1 วัน)` เลือก pass ที่ |AOS − aos| ≤ 1 วินาที
   ไม่เจอตอบ 404 `NOT_FOUND`
6. body ของ `POST …/passes` ผิดตอบ 422 รหัสใหม่ `PASS_INVALID` ดาวที่ไม่อยู่ใน module ตอบ 404 `NOT_FOUND`
7. `GET /api/prefs` ตอบ `{values, defaults, user}` เพื่อให้ปุ่ม Reset ของหน้าเว็บรู้ค่าตั้งต้นโดยไม่ต้องมีสำเนาที่ web
8. Twilight threshold ส่งเป็นพารามิเตอร์ `twilight_deg` ของ `observe()`/`visibility()` (ค่าตั้งต้นเดิม −6) `Hub` รับ `prefs` แบบไม่บังคับ
9. Print ของ Pass details แบ่งหน้าเองที่ 50 บรรทัดต่อหน้า (A4, ขอบ 10 มม., แถบหัว 10 มม., monospace 12pt) เพื่อให้แถบหัวมี `n/N`
10. กล่อง modal ใช้ component ใหม่ `Modal.tsx` (พื้นหลังบังหน้า z-index 40 สูงกว่า popup) เพราะ core มีแต่ `FloatingWindow` ที่ไม่ใช่ modal
11. สัญญาของหน้าใน Preferences (`PrefsPageApi`) กำหนดในงานนี้ให้งานย่อย 3 และ 4 ใช้ต่อ (Task 8)

---

### Task 1: Server — `prefs.py` และ `GET/PUT /api/prefs`

**Files:**
- Create: `server/gpredict_web/prefs.py`, `server/tests/test_prefs.py`
- Modify: `server/gpredict_web/app.py` (สร้าง `Prefs` ใน `create_app`, `app.state.prefs`, 2 route)
- Test: `server/tests/test_api.py` (เพิ่ม class `PrefsApiTest`)

(path ในแผนนี้นับจาก `api-interop/gpredict-web/`)

**Interfaces:**
- Produces:
  - `PrefSpec(kind: str, default, lo=None, hi=None, choices: tuple[str, ...] | None = None)` frozen dataclass
    `kind` ∈ `"int"`, `"float"`, `"bool"`, `"colour"` (`#rrggbb` ตัวเล็ก), `"columns"` (list ของชื่อใน `choices` ไม่ซ้ำ เรียงตาม `choices`), `"str"`
  - `PREFS: dict[str, PrefSpec]` ตาราง spec §8.2 (งานย่อย 3 และ 4 เพิ่มแถวในตารางนี้)
  - `SINGLE_PASS_COLUMNS` (19 ชื่อตาม ref-P §2.2), `MULTI_PASS_COLUMNS` (10 ชื่อตาม ref-P §3.2)
  - `validate(key: str, value) -> object` คืนค่าที่ normalize แล้ว หรือ raise `ApiError("PREFS_INVALID", 422, <ไทย>, key)`
  - `class Prefs(data_dir: Path)`: `get(key)`, `values() -> dict`, `defaults() -> dict`, `user_keys() -> list[str]`,
    `update(set_: dict, remove: list[str]) -> None` (ตรวจทุก key ก่อน ผิดตัวเดียวไม่เขียน), thread-safe, เขียนด้วย `store.write_json_atomic`
  - `GET /api/prefs` → `{"values": {...ทุก key...}, "defaults": {...}, "user": [...]}`; `PUT /api/prefs` body `{"set": {}, "remove": []}` → แบบเดียวกับ GET

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน** (`test_prefs.py`)

```python
def test_defaults_without_file(self):
    p = Prefs(self.cfg.data_dir)
    self.assertEqual(p.get("PREDICT/MINIMUM_ELEV"), 5)
    self.assertEqual(p.get("PREDICT/SINGLE_PASS_COL"), ["Time", "Az", "El", "Range", "Footp"])
    self.assertEqual(p.get("PREDICT/MULTI_PASS_COL"), ["AOS", "LOS", "Duration", "Max El", "AOS Az", "LOS Az"])
    self.assertEqual(p.user_keys(), [])
def test_update_stores_only_user_keys(self):
    p.update({"PREDICT/MINIMUM_ELEV": 30}, [])
    raw = json.loads((self.cfg.data_dir / "preferences.json").read_text())
    self.assertEqual(raw, {"version": 1, "values": {"PREDICT/MINIMUM_ELEV": 30}})
def test_remove_returns_to_default(self):            # update({}, ["PREDICT/MINIMUM_ELEV"]) → get == 5, key หายจากไฟล์
def test_one_invalid_key_writes_nothing(self):       # {"PREDICT/MINIMUM_ELEV": 30, "PREDICT/LOOK_AHEAD": 15} → ApiError PREFS_INVALID object "PREDICT/LOOK_AHEAD", ไฟล์ไม่ถูกสร้าง
def test_schema_ranges(self):                        # ทุกแถวของ spec §8.2: ขอบล่าง/บนผ่าน, เกินขอบ 1 หน่วยไม่ผ่าน, bool รับแค่ True/False (ไม่รับ 0/1)
def test_columns_normalised_to_fixed_order(self):    # ["El", "Time"] → ["Time", "El"]; ชื่อไม่รู้จักหรือซ้ำ → PREFS_INVALID
def test_colour_lowercased(self):                    # "#FFAA00" → "#ffaa00"; "#ffaa0", "red" → PREFS_INVALID
def test_unknown_key_invalid(self):                  # "PREDICT/NOPE" → PREFS_INVALID
def test_invalid_value_in_file_falls_back_to_default(self):   # ไฟล์มี MINIMUM_ELEV: 500 และ JSON ที่อ่านไม่ได้อีกกรณี → ค่าตั้งต้น, assertLogs WARNING
```

ใน `test_api.py`: `test_get_prefs_shape` (มี `values`, `defaults`, `user`), `test_put_prefs_set_and_remove`,
`test_put_prefs_invalid_is_422_and_unchanged`, `test_put_prefs_body_not_object_is_422` (`set` ไม่ใช่ object หรือ `remove` ไม่ใช่ list ของ string)

- [ ] **Step 2: รันให้เห็นว่าล้ม** — `../.venv/bin/python -m unittest tests.test_prefs tests.test_api` → ImportError

- [ ] **Step 3: Implement** — ค่าตั้งต้นของ `SKY_AT_GLANCE/COLOUR_01…10` และ `PREDICT/SAVE_CONTENTS` ตาม ref-P §7.4 และ §8.1
  ข้อความ error ภาษาไทยบอกชื่อป้ายของ Gpredict และช่วง เช่น `Minimum elevation ต้องเป็นจำนวนเต็ม 1–90`
  ไฟล์อ่านไม่ได้หรือ key/ค่าผิด: ข้ามเฉพาะ key นั้นและ `_log.warning` (ไม่ลบไฟล์)
  `prefs.py` import จาก `store.py` ได้แค่ `write_json_atomic` (งานย่อยที่ 4 ให้ `Store` รับค่ารวมผ่าน callable จึงห้าม import วนกัน)
  `PrefSpec` ต้องเพิ่ม field ที่ไม่บังคับได้ภายหลังโดยไม่แก้แถวเดิม (งานย่อยที่ 4 เพิ่ม `max_len`, `allowed` และชนิด `rgba`, `urls`, `layout`)

- [ ] **Step 4: รัน test ทั้งชุดของ server** — ผ่านทั้งหมด

- [ ] **Step 5: Commit** — `feat(gpredict-web): preferences store with Gpredict keys and /api/prefs`

### Task 2: Server — Twilight threshold จาก Preferences ใน tick

**Files:**
- Modify: `server/gpredict_web/observe.py` (`visibility`, `observe`), `server/gpredict_web/runtime.py` (`ModuleRuntime`, `Hub`), `server/gpredict_web/app.py` (ส่ง `prefs` ให้ `Hub`)
- Test: `server/tests/test_observe.py`, `server/tests/test_runtime.py`

**Interfaces:**
- Consumes: `Prefs.get("PREDICT/TWILIGHT_THRESHOLD")` (Task 1)
- Produces:
  - `visibility(r, t, q_lat, q_lon, el_deg, twilight_deg: float = TWILIGHT_SUN_EL_DEG) -> str`
  - `observe(r, v, t, q, el, prev_rate, twilight_deg: float = TWILIGHT_SUN_EL_DEG) -> dict`
  - `Hub(store, satdb, ephem, now, prefs: Prefs | None = None)`; `ModuleRuntime(..., twilight: Callable[[], float] = lambda: TWILIGHT_SUN_EL_DEG)`

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน**

```python
# test_observe.py — ดวงอาทิตย์ที่ QTH อยู่ที่ −8° (เลือก t และ QTH จาก astro.sun_ecef_km ให้ได้มุมนี้ ±0.5°) ดาวโดนแสง El > 0
def test_visibility_uses_twilight_parameter(self):
    self.assertEqual(visibility(r, t, lat, lon, 30.0), "V")                     # −8 <= −6
    self.assertEqual(visibility(r, t, lat, lon, 30.0, twilight_deg=-12.0), "D") # −8 > −12
# test_runtime.py
def test_tick_vis_follows_twilight_pref(self):   # Hub ที่มี Prefs; tick แรกได้ "V"; prefs.update({"PREDICT/TWILIGHT_THRESHOLD": -18}) → tick ถัดไป "D"
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**
- [ ] **Step 3: Implement** — `ModuleRuntime._observe_all` เรียก `twilight()` ครั้งเดียวต่อ tick แล้วส่งให้ `observe`
  `Hub` ส่ง `lambda: prefs.get("PREDICT/TWILIGHT_THRESHOLD")` เมื่อมี `prefs` test เดิมที่สร้าง `Hub` แบบไม่มี `prefs` ต้องผ่านโดยไม่แก้
- [ ] **Step 4: รัน test ทั้งชุดของ server** — ผ่านทั้งหมด
- [ ] **Step 5: Commit** — `feat(gpredict-web): twilight threshold preference drives the V/D/E codes`

### Task 3: Server — block ephemeris รายวันในคิว GMAT

**Files:**
- Create: `server/gpredict_web/dayblocks.py`, `server/tests/test_dayblocks.py`
- Modify: `server/gpredict_web/ephem.py` (`_Job.priority`/`kind`, `_take_locked`, `prune`), `server/gpredict_web/config.py` (`DAY_LRU_BLOCKS = 400`, `DAY_KEEP_DAYS = 7`)
- Test: `server/tests/test_ephem.py` (class ใหม่ `DayBlockTest(ManagerTestBase)`)

**Interfaces:**
- Produces (`dayblocks.py`, ไม่มี I/O ยกเว้นชื่อ path):
  - `DAY_DIR = "day"`; `day_dir(root: Path, d: date) -> Path` → `<root>/day/<YYYYMMDD>`
  - `day_window(first: date, last: date) -> Window` → `(first 00:00Z, (last + 1 วัน) 00:00Z)`
  - `split_days(first: date, last: date, a: array) -> dict[date, array]` แต่ละ block 2881 epoch × 6 ค่า (epoch เที่ยงคืนอยู่ทั้งสอง block)
  - `stitch(first: date, blocks: list[array]) -> SatEphem` ต่อ block ติดกัน ใช้ epoch เที่ยงคืนจุดเดียว
- Produces (`EphemManager`):
  - `ensure_days(owner: str, sats: list[SatSpec], first: date, last: date) -> None`
  - `days_status(owner: str) -> tuple[str, list[Message]]` (`ok` / `computing` / `failed` แบบเดียวกับ `status`)
  - `get_days(spec: SatSpec, first: date, last: date) -> SatEphem | None` (None ถ้าขาด block ใด)
  - `release_days(owner: str) -> None`; `retry_days(owner: str) -> None`
  - งานของช่วง module มี priority 0 งาน block มี priority 1 `_take_locked` หยิบ priority ต่ำสุดก่อน (ในระดับเดียวกันตามลำดับเข้า)

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน**

```python
# test_dayblocks.py
def test_split_then_stitch_round_trip(self):         # array 3 วัน (8641 epoch) → 3 block ยาว 2881·6, stitch แล้ว times/pos/vel เท่าต้นฉบับทุก epoch
def test_day_window(self):                           # day_window(date(2026,11,12), date(2026,11,13)) == (12 00:00Z, 14 00:00Z)
# test_ephem.py DayBlockTest
def test_one_gmat_run_covers_missing_days(self):     # ensure_days 3 วัน → FakePropagate ถูกเรียก 1 ครั้งด้วย start=วันแรก 00:00, stop=วันสุดท้าย+1 00:00; ไฟล์ day/<YYYYMMDD>/<key>.f64 ครบ 3 ไฟล์
def test_cached_days_are_not_recomputed(self):       # รอบสองขอ 4 วันที่ซ้อน 3 วันเดิม → GMAT รันเฉพาะวันที่ 4
def test_overlapping_day_requests_share_one_job(self): # owner A และ B ขอวันเดียวกันก่อน drain → คิวมีงานเดียว
def test_window_jobs_run_before_day_jobs(self):      # ensure_days แล้ว ensure (ช่วง module) → drain รันงานช่วง module ก่อน
def test_release_cancels_queued_and_kills_running(self):  # แบบเดียวกับ test ของ release เดิม แต่ใช้ release_days
def test_failure_reports_failed_and_retry_days(self): # propagate raise GmatRunError → days_status "failed" GMAT_FAILED; retry_days แล้วสำเร็จ
def test_get_days_stitches_and_lru_limit(self):      # get_days 2 วันได้ times ยาว 5761; DAY_LRU_BLOCKS ถูก patch เป็น 2 แล้วอ่าน 3 block → หน่วยความจำเหลือ 2
def test_prune_removes_old_day_dirs(self):           # โฟลเดอร์ day/ ที่เก่ากว่า now − 7 วันถูกลบ วันที่ใหม่กว่าอยู่
def test_missing_satellite_in_day_job(self):         # GMAT ไม่คืนดาว → days_status มี SAT_MISSING_FROM_GMAT และ get_days คืน None
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**
- [ ] **Step 3: Implement** — งาน block ใช้ `_Job(window=day_window(first_missing, last_missing), kind="days")`
  หลัง GMAT สำเร็จตัดด้วย `split_days` แล้วเขียนทีละ block (เขียน atomic แบบ `_write`) คู่ (owner, วัน) ที่ต้องการแต่ละ block
  เก็บใน `_day_pairs: dict[str, tuple[dict[str, SatSpec], date, date]]` หน่วยความจำ block เป็น `OrderedDict[(date, key), array]`
  ตัดตัวเก่าสุดเมื่อเกิน `DAY_LRU_BLOCKS` วันที่ "ขาด" ของดาวคือวันที่ไม่มีทั้งในหน่วยความจำและบนดิสก์และไม่มีงานรอ
  งาน block ของวันที่ไม่ติดกัน (มีวันที่มีแล้วคั่น) รันครั้งเดียวตั้งแต่วันแรกถึงวันสุดท้ายที่ขาดตาม spec §3.1
  `prune` ลบ `day/<YYYYMMDD>` ที่วันนั้นเก่ากว่า `now − DAY_KEEP_DAYS` วัน และไม่อยู่ในคู่ที่ใช้อยู่
- [ ] **Step 4: รัน test ทั้งชุดของ server** — test เดิมของ `EphemManager` ต้องผ่านโดยไม่แก้
- [ ] **Step 5: Commit** — `feat(gpredict-web): daily ephemeris blocks in the GMAT queue with lower priority`

### Task 4: Server — `pass_predict.py` (has_aos, ค่าของ pass, แถว, get_pass/get_passes)

**Files:**
- Create: `server/gpredict_web/pass_predict.py`, `server/tests/test_pass_predict.py`

**Interfaces:**
- Consumes: `passes.Pass`, `passes.find_passes`, `observe.observe`, `observe.orbit_number`, `observe.is_geo`, `observe.is_decayed`, `helpers.circular_ephem`, `helpers.origin_qth`
- Produces:
  - `NEXT_PASS_OFFSET = timedelta(days=0.007)`, `PASS_GAP = timedelta(days=0.014)`
  - `has_aos(el: TleElements, qth_lat_deg: float, t: datetime) -> bool` (ref-P §4.1 ครบ 4 ข้อ)
  - `sample_times(aos: datetime, los: datetime, n_entries: int, resolution_s: int) -> list[datetime]`
  - `@dataclass(frozen=True) PassData(orbit: int, aos, tca, los: datetime, max_el, aos_az, max_el_az, los_az: float, vis: str, rows: list[dict])`
  - `describe(p: Pass, eph: SatEphem, q: QthGeo, el: TleElements, n_entries: int, resolution_s: int, twilight_deg: float) -> PassData`
  - `get_pass(passes: Sequence[Pass], start: datetime, limit_days: float, min_el: float) -> Pass | None`
  - `get_passes(passes: Sequence[Pass], start: datetime, days: float, count: int, min_el: float) -> list[Pass]`
  - `pass_to_dict(d: PassData, rows: bool = True) -> dict` (เวลาใช้ `iso_ms`, แถวมีช่องตาม spec §9 ลำดับนั้น)

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน** — pass สังเคราะห์สร้างด้วย `Pass(aos, los, max_el, t_max_el)` ตรงๆ สำหรับ get_pass/get_passes
  และ `circular_ephem` + `origin_qth` สำหรับ `describe`

```python
def test_sample_times_by_entries(self):          # pass 600 s, entries 20, res 10 → step 30 s, 21 เวลา, เวลาสุดท้าย == LOS
def test_sample_times_by_resolution(self):       # pass 150 s, entries 20, res 10 → step 10 s, 16 เวลา (floor(150/10)+1)
def test_sample_times_multiplied_not_accumulated(self):  # pass 1000 s, entries 7 → เวลาที่ k เท่ากับ aos + k·(1000/7) s ทุกตัว
def test_has_aos_cases(self):                    # GEO (mean motion 1.0027) False; decayed False; mean motion 0 False;
                                                 # incl 10°, apogee 500 กม. ที่ lat 60° False; ISS (incl 51.6°) ที่ lat 13.7° True
def test_describe_values(self):                  # circular β=0 ที่ origin: tca ห่าง t_peak ไม่เกิน 0.1 s, max_el ≈ 90 (±0.01),
                                                 # aos_az/los_az ตาม ecef_to_aer ที่ AOS/LOS, orbit == orbit_number(el, aos), len(rows) == len(sample_times(...))
def test_describe_vis_letters(self):             # ใช้ twilight_deg ที่ทำให้ทุกแถว D → "-D-"; แถวในเงา → ตำแหน่ง 3 เป็น E
def test_rows_ma_is_phase_scaled(self):          # rows[i]["ma"] == rows[i]["phase_deg"] * 256 / 360
def test_get_pass_skips_low_pass(self):          # passes max_el 3, 40; min_el 5 → ได้ pass ที่ 2
def test_get_pass_limit_from_call_start(self):   # pass แรกต่ำ, pass ที่ 2 AOS = start + 3.1 วัน, limit 3 → None
def test_in_progress_pass_counts(self):          # start อยู่ใน pass A (max 40) และ pass ถัดไป AOS ภายใน limit → A
def test_in_progress_exception(self):            # start อยู่ใน pass A แต่ AOS ถัดไปเกิน start + limit → None (ref-P §3.5 ข้อ 7)
def test_unknown_los_is_end_of_data(self):       # pass ที่ los None → None
def test_get_passes_slides_window(self):         # passes ทุก 1 วันพอดี, days 3, count 10 → 4 pass (pass ที่ 4 เริ่มหลัง start+3 วันแต่ start ของการค้นยัง < start+3)
def test_get_passes_count_limit(self):           # passes ทุก 90 นาที, count 5 → 5 pass
def test_all_passes_below_min_el_gives_none(self):   # ทุก pass max_el 3 → get_pass None, get_passes []
def test_pass_to_dict_keys(self):                # ลำดับ key ของแถว == ("t","az","el","ra","dec","range_km","rate_kms","lat_deg","lon_deg","ssp","footprint_km","alt_km","vel_kms","doppler_hz","loss_db","delay_ms","ma","phase_deg","vis")
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**
- [ ] **Step 3: Implement** — กติกา get_pass (สรุปจาก spec §3.4 ให้เขียนตามนี้)

```text
t0 = start
loop:
  cand = pass แรกที่ aos is not None และ los > t0 (pass ที่ aos is None ถูกข้าม)
  ไม่มี cand หรือ cand.los is None → None
  ถ้า cand.aos <= t0 (กำลังผ่าน): nxt = pass แรกที่ aos > cand.los; ไม่มี nxt หรือ nxt.aos > t0 + limit → None
  ไม่งั้น: cand.aos > start + limit → None
  cand.max_el >= min_el → คืน cand
  t0 = cand.los + PASS_GAP
get_passes: t = start; วนจนครบ count: p = get_pass(passes, t, days, min_el); None → หยุด; เก็บ p;
  t = p.los + PASS_GAP; t >= start + days → หยุด
```

  `has_aos` ข้อรูปวงโคจร: apogee จาก mean motion และ ecc (a = (μ/n²)^(1/3), apogee = a(1+e) − R ใช้ `GP_RE_KM`)
  แล้วตามสูตรของ ref-P §4.1 แถวของ Data ใช้ `observe(...)` ที่เวลาแถว (`prev_rate=None`) แปลงชื่อ `range_rate_kms` เป็น `rate_kms`
  Vis คิดจากทุกแถวและจุด TCA (spec §3.3)
- [ ] **Step 4: รัน test** — ผ่าน
- [ ] **Step 5: Commit** — `feat(gpredict-web): Gpredict pass selection and sampled pass rows`

### Task 5: Server — `POST /api/modules/{name}/passes`

**Files:**
- Create: `server/gpredict_web/pass_service.py`, `server/tests/test_pass_service.py`
- Modify: `server/gpredict_web/runtime.py` (`ModuleRuntime.qth`, `ModuleRuntime.sat_orbit(norad)`), `server/gpredict_web/app.py`
- Test: `server/tests/test_api.py` (class `PassesApiTest` ใช้ `EphemManager(start_worker=True)` กับ `FakePropagate` ที่สร้างวงกลมสังเคราะห์)

**Interfaces:**
- Consumes: Task 1 `Prefs`, Task 3 `ensure_days/days_status/get_days/release_days`, Task 4 ทั้งหมด
- Produces:
  - `ModuleRuntime.qth -> Qth` (property), `ModuleRuntime.sat_orbit(norad: int) -> tuple[str, SatSpec, TleElements] | None` (ชื่อ, spec, element ของ TLE ปัจจุบัน)
  - `day_range(start: datetime, end: datetime) -> tuple[date, date]` → `(date(start − 1 วัน), date(end))`
  - `@dataclass PassPlan(module, norad, name, spec, elements, qth: Qth, kind: str, t: datetime, aos: datetime | None, first: date, last: date)`
  - `PassService(hub: Hub, ephem: EphemManager, prefs: Prefs, now: Callable[[], datetime])`
    - `plan(module: str, body: dict) -> PassPlan | dict` — dict คือคำตอบทันที `{"message": {...}}` (`PASS_NO_AOS`) ไม่รัน GMAT
    - `answer(plan: PassPlan) -> dict` — เรียกหลัง `days_status` เป็น `ok`
  - คำตอบ: `next`/`current`/`at` → `{"sat": {norad, name}, "qth": {name, location, lat_deg, lon_deg, alt_m}, "pass": {...}}`
    `future` → `{"sat", "qth", "passes": [...]}` ไม่มี pass → `{"sat", "qth", "message": {"code", "level", "text"}}`

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน**

```python
# test_pass_service.py (ไม่ผ่าน HTTP)
def test_day_range(self):        # start 2026-11-12T05:00Z, end start+4 วัน → (2026-11-11, 2026-11-16)
def test_plan_ranges_per_kind(self):   # future/next/current: first = date(t − 1 วัน), last = date(t + LOOK_AHEAD + 1 วัน); at: date(aos − 1 วัน)..date(aos + 1 วัน)
def test_use_real_t0_replaces_t(self): # prefs USE_REAL_T0 True → plan.t == now() ไม่ใช่ body t
def test_next_when_up_starts_after_los(self):   # ดาวอยู่เหนือขอบฟ้าที่ t → pass ที่ได้มี aos > LOS ของ pass ปัจจุบัน + 0.007 วัน
def test_current_returns_pass_in_progress(self):  # kind current ที่ t กลาง pass → pass.aos < t < pass.los
# test_api.py PassesApiTest
def test_next_pass_shape(self):                  # 200, keys sat/qth/pass, pass มี orbit aos tca los max_el aos_az max_el_az los_az vis rows
def test_future_passes_respect_count_and_min_el(self):   # prefs NUMBER_OF_PASSES 5 → len ≤ 5 ทุก max_el ≥ MINIMUM_ELEV
def test_no_aos_message_texts(self):             # ดาว GEO: next → message.code PASS_NO_AOS level error ข้อความยาวของ ref-P §1.4; future → ข้อความสั้น
def test_no_pass_within_message(self):           # ดาวที่ไม่ผ่านขอบฟ้าในช่วง → PASS_NONE_WITHIN level info "Satellite X has no passes\nwithin the next 3 days"
def test_at_finds_pass_by_aos(self):             # aos ของ pass จาก future ±0.5 s → pass เดียวกัน; aos ที่ไม่มี pass → 404 NOT_FOUND
def test_invalid_body_is_422(self):              # kind อื่น, t ไม่ใช่เวลา, norad ไม่ใช่ int, at ไม่มี aos → PASS_INVALID
def test_satellite_not_in_module_is_404(self):
def test_module_not_open_is_404(self):
def test_gmat_failure_answers_503(self):         # FakePropagate raise GmatRunError → 503 GMAT_FAILED
def test_client_disconnect_releases_owner(self): # เรียก handler ตรงด้วย request ที่ is_disconnected() คืน True หลังรอบแรก (FakePropagate ที่รอ Event) → ไม่มีคู่ owner pass:* เหลือใน EphemManager
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**
- [ ] **Step 3: Implement** — route (async) ตามลำดับ: ตรวจ body → `runtime_of(name)` → `service.plan` (dict คืนทันที)
  → `ensure_days(owner, [spec], first, last)` → วน `days_status`: `ok` ออก, `failed` → `ApiError("GMAT_FAILED", 503, ...)`,
  `computing` → `await request.is_disconnected()` จริงให้คืน `Response(status_code=499)` ไม่งั้น `await asyncio.sleep(0.2)`
  → `await asyncio.to_thread(service.answer, plan)` → `finally: ephem.release_days(owner)`
  `answer` ใช้ `get_days` → `find_passes` → `get_pass`/`get_passes` ตามค่าของ Preferences ในขณะนั้น → `describe` → `pass_to_dict`
  "next": หา pass ที่มี t อยู่ข้างใน (`passes.pass_containing`) ถ้ามีและ El(t) ≥ 0 เริ่มที่ `los + NEXT_PASS_OFFSET` ไม่งั้นเริ่มที่ t
  ข้อความ `PASS_NONE_WITHIN` ใส่ค่า `LOOK_AHEAD` ปัจจุบันลงใน `%d`
- [ ] **Step 4: รัน test ทั้งชุดของ server** — ผ่าน
- [ ] **Step 5: Commit** — `feat(gpredict-web): pass prediction API on daily GMAT ephemeris`

### Task 6: Server — Sky at a glance API

**Files:**
- Modify: `server/gpredict_web/pass_service.py`, `server/gpredict_web/app.py`, `server/gpredict_web/runtime.py` (`Hub.close` เรียก `ephem.release_days(f"sky:{name}")`)
- Test: `server/tests/test_pass_service.py`, `server/tests/test_api.py`

**Interfaces:**
- Produces:
  - `name_sort_key(name: str) -> tuple` ใน `pass_service.py` (ลำดับเดียวกับ `compareNames` ของ web ใน `views/cells.ts`) งานย่อยที่ 3 ใช้ซ้ำ
  - `PassService.sky(module: str, t: datetime | None) -> dict` ไม่รอ GMAT
  - `GET /api/modules/{name}/skyglance?t=<iso>` → `{"status", "t0", "hours", "sats": [{"norad", "name", "colour", "passes": [pass_to_dict(..., rows=False)]}], "messages"}`
    `t` ไม่ส่ง = เวลาของ module; `USE_REAL_T0` เปิด → `now()` ทุกครั้งที่ส่ง `t` มา ไม่ได้ส่ง (หน้าเว็บส่ง `t` เฉพาะการวาดครั้งแรก ตาม ref-P §7.7)
  - `DELETE /api/modules/{name}/skyglance` → 204 (ปล่อย owner `sky:<name>`)

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน**

```python
def test_sky_computing_then_ok(self):        # ครั้งแรก status "computing" sats [] (worker ยังไม่ drain), หลัง drain status "ok"
def test_sky_rows_sorted_by_name_and_colour_index(self):   # ดาว 12 ดวงชื่อ B, A, …: sats เรียงตามชื่อ (compareNames แบบ core) colour ของแถวที่ k == prefs COLOUR_((k % 10)+1) นับรวมดาวที่ไม่มี pass
def test_sky_uses_hours_pref_and_ten_passes(self):          # TIME_SPAN_HOURS 8 → hours 8, ทุก pass aos ≤ t0 + 8 ชม. ยกเว้นได้ 1 pass ตาม get_passes; ไม่เกิน 10 pass ต่อดาว
def test_sky_range_is_twice_span(self):      # ensure_days ถูกเรียกด้วย last == date(t0 + 2 × hours)
def test_sky_no_satellites(self):            # module ไม่มีดาว → status "ok", sats []
def test_sky_delete_releases_owner(self):
def test_close_module_releases_sky_owner(self):
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**
- [ ] **Step 3: Implement** — ทุกดาวของ module ขอใน `ensure_days` ครั้งเดียว ดาวที่ `has_aos` เป็นเท็จได้ `passes: []`
  ดาวที่ GMAT ไม่คืนค่าได้ `passes: []` และข้อความ `SAT_MISSING_FROM_GMAT` ใน `messages`
- [ ] **Step 4: รัน test ทั้งชุดของ server** — ผ่าน
- [ ] **Step 5: Commit** — `feat(gpredict-web): sky at a glance API`

### Task 7: Web — Preferences: ที่เก็บค่า โครงหน้าต่าง และ `Modal`

**Files:**
- Create: `web/src/prefs/prefsStore.ts`, `web/src/prefs/prefsDraft.ts`, `web/src/prefs/prefGroups.ts`, `web/src/prefs/PreferencesDialog.tsx`,
  `web/src/components/Modal.tsx`, `web/src/prefs/prefsDraft.test.ts`, `web/src/prefs/prefsStore.test.ts`
- Modify: `web/src/api.ts` (`getPrefs`, `putPrefs`), `web/src/types.ts` (`PrefsAnswer`), `web/src/menus.ts` (`BarAction` + `"preferences"`),
  `web/src/later.ts` (ลบ `Preferences`, `"Sky at a glance"`, `"Show current pass"`, `"Show next pass"`, `"Future passes"`), `web/src/dialogs.ts`, `web/src/components/Dialogs.tsx`, `web/src/styles.css`
- Test: `web/src/menus.test.ts`, `web/src/later.test.ts`

**Interfaces:**
- Produces:
  - `type PrefValue = number | boolean | string | string[]`; `interface PrefsAnswer { values: Record<string, PrefValue>; defaults: Record<string, PrefValue>; user: string[] }`
  - `prefsStore.ts`: `usePrefs(): PrefsAnswer | null` (useSyncExternalStore, โหลดครั้งแรกเมื่อมีผู้ใช้), `reloadPrefs(): Promise<void>`, `savePrefs(set, remove): Promise<void>` (อัปเดต store ด้วยคำตอบ)
  - `prefsDraft.ts` (pure): `type Draft = ReadonlyMap<string, PrefValue | typeof RESET>`;
    `draftValue(answer, draft, key)`, `setInDraft(draft, key, v)`, `resetInDraft(draft, keys)`, `draftToRequest(answer, draft) -> {set, remove}`
    กติกา: ค่าที่เท่ากับค่าที่ใช้อยู่ไม่ส่ง, RESET ของ key ที่ผู้ใช้ตั้ง → `remove`, RESET แล้วตั้งค่าใหม่ → `set`
  - `interface PrefsPageApi { value<T extends PrefValue>(key: string): T; set(key: string, v: PrefValue): void; reset(keys: readonly string[]): void; onCommit(fn: () => Promise<void>): void }`
    (`onCommit` ใช้ในงานย่อย 3 และ 4 สำหรับข้อมูลที่ไม่ใช่ key ของ preferences เช่นรายชื่อวิทยุ ทำหลัง `PUT /api/prefs` สำเร็จ)
  - `prefGroups.ts`: `type PrefGroupId = "general" | "modules" | "interfaces" | "predict"`;
    `PREF_GROUPS: readonly { id: PrefGroupId; label: string; icon: string; page: ((api: PrefsPageApi) => ReactNode) | null; later?: 2 | 3 | 4 }[]`
    ลำดับ General, Modules, Interfaces, Predict; `FIRST_GROUP: PrefGroupId = "predict"` (งานย่อย 4 เปลี่ยนเป็น `"general"`)
  - `Modal({ title?: string, children, onEscape })`: บังทั้งหน้า (z-index 40) โฟกัสอยู่ในกล่อง Escape เรียก `onEscape`
  - `Dialog` เพิ่ม `{ kind: "preferences" }`

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน**

```ts
// prefsDraft.test.ts
it("sends only changed keys", ...)            // answer MINIMUM_ELEV 5; set 5 → {set:{}, remove:[]}; set 30 → {set:{"PREDICT/MINIMUM_ELEV":30}, remove:[]}
it("reset of a user key removes it", ...)     // user ["PREDICT/MINIMUM_ELEV"] value 30; reset → remove ["PREDICT/MINIMUM_ELEV"]
it("reset then change sets it", ...)          // reset แล้ว set 40 → set 40
it("reset of a default key sends nothing", ...)
it("draftValue shows the default after reset", ...)
// PreferencesDialog: สลับ Predict → (กลุ่มอื่นที่มีหน้า) → Predict แล้วค่าที่แก้ไว้ยังอยู่; onCommit ที่ลงซ้ำถูกเรียกครั้งเดียวตอน OK
// menus.test.ts: Edit → Preferences เป็น item ที่กดได้ action "preferences"
// later.test.ts: LATER ไม่มี Preferences, "Sky at a glance", "Show current pass", "Show next pass", "Future passes"
```

- [ ] **Step 2: รันให้เห็นว่าล้ม** — `npm test`
- [ ] **Step 3: Implement** — หน้าต่างตาม spec §8.1 และ ref-D §1: ชื่อ `GPREDICT Preferences :: <label>` ปุ่ม Cancel และ OK
  OK: `savePrefs(draftToRequest(...))` แล้วเรียก `onCommit` ตามลำดับ แล้วปิด error แสดงข้อความไทยในหน้าต่างและไม่ปิด
  หน้าของกลุ่มที่เคยเปิดแล้วยังอยู่ใน DOM (ซ่อนด้วย `hidden`) จนปิดหน้าต่าง draft ของหน้าจึงไม่หายเมื่อสลับกลุ่ม
  `onCommit` ลงทะเบียนครั้งเดียวต่อการเปิดหน้าต่างต่อหน้า (ลงซ้ำด้วยฟังก์ชันเดิมไม่เพิ่ม) งานย่อยที่ 3 ใช้เก็บรายชื่อวิทยุ/rotator
  กลุ่มที่ `page === null` กดไม่ได้และมี `title={laterTooltip(later)}`
- [ ] **Step 4: รัน** — `npm test` และ `npm run build` ผ่าน
- [ ] **Step 5: Commit** — `feat(gpredict-web): preferences dialog shell and client store`

### Task 8: Web — หน้า Predict ใน Preferences (4 แท็บ)

**Files:**
- Create: `web/src/prefs/PredictPages.tsx`, `web/src/prefs/predictPrefs.ts`, `web/src/prefs/predictPrefs.test.ts`
- Modify: `web/src/prefs/prefGroups.ts` (กลุ่ม `predict` ใช้ `PredictPages`)

**Interfaces:**
- Consumes: `PrefsPageApi` (Task 7)
- Produces: `predictPrefs.ts` (pure): `CONDITION_FIELDS` (ป้าย ช่วง หน่วย tooltip ตาม ref-P §9.1), `MULTI_PASS_CHECKS` (ป้าย = Hint ของ ref-P §3.2 จัด 2 คอลัมน์),
  `SINGLE_PASS_CHECKS` (Hint ของ ref-P §2.2 จัด 3 คอลัมน์), `PAGE_KEYS: Record<"conditions" | "multi" | "single" | "sky", readonly string[]>`,
  `toggleColumn(cols: readonly string[], name: string, order: readonly string[]) -> string[]`

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน**

```ts
it("tab labels are Gpredict's", ...)       // ["Pass Conditions", "Multiple Passes", "Single Pass", "Sky at a Glance"]
it("condition fields match ref-P §9.1", ...) // ป้าย ช่วง ขั้น และ tooltip ทุกช่อง รวม "Always use real time for pass predictions"
it("toggleColumn keeps fixed order", ...)  // toggleColumn(["Time","El"], "Az", SINGLE) → ["Time","Az","El"]; toggle "El" ออก → ["Time","Az"]
it("reset keys per page", ...)             // PAGE_KEYS.sky == ["SKY_AT_GLANCE/TIME_SPAN_HOURS", "SKY_AT_GLANCE/COLOUR_01", …, "_10"]
it("single pass layout is 3 columns of 19", ...) // แถวที่ 1 = Time, Azimuth, Elevation ตามลำดับเติมของ ref-P §9.3
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**
- [ ] **Step 3: Implement** — ปุ่ม Reset ทุกแท็บ tooltip `Reset settings to the default values.` เรียก `api.reset(PAGE_KEYS[page])`
  ปุ่มสีใช้ `<input type="color">` ชื่อของตัวเลือกสีตาม ref-P §9.4 (แก้การสลับชื่อปุ่ม 1 และ 2 ตาม spec §10.1)
- [ ] **Step 4: รัน** — `npm test`, `npm run build`
- [ ] **Step 5: Commit** — `feat(gpredict-web): Predict preference pages`

### Task 9: Web — ข้อความในตารางและเวลาเริ่มของคำขอ pass

**Files:**
- Create: `web/src/passes/types.ts`, `web/src/passes/passApi.ts`, `web/src/passes/passCells.ts`, `web/src/passes/passCells.test.ts`
- Modify: `web/src/api.ts` (export `request` ภายในให้ `passApi.ts` ใช้ หรือย้าย helper ที่ใช้ร่วมกัน)

**Interfaces:**
- Produces:
  - `types.ts`: `PassRow`, `PassInfo` (ช่องตาม spec §9), `PassSummary = Omit<PassInfo, "rows">`, `PassSat`, `PassQth`,
    `PassBody = { norad: number; kind: "next" | "current" | "future" | "at"; t: string; aos?: string }`,
    `PassAnswer = { sat; qth; pass: PassInfo } | { sat; qth; passes: PassInfo[] } | { sat; qth; message: ApiMessage }`,
    `SkyGlanceAnswer { status: TickStatus; t0: string; hours: number; sats: { norad; name; colour; passes: PassSummary[] }[]; messages: ApiMessage[] }`
  - `passApi.ts`: `requestPass(module, body: PassBody, signal: AbortSignal): Promise<PassAnswer>`,
    `getSkyGlance(module, t?: string): Promise<SkyGlanceAnswer>`, `releaseSkyGlance(module): Promise<void>`
  - `passCells.ts`: `SINGLE_COLUMNS` (19 `{title, hint, align}` ตาม ref-P §2.2), `MULTI_COLUMNS` (10 ตาม ref-P §3.2),
    `rowCell(row: PassRow, title: string): string`, `passCell(p: PassSummary, title: string): string`, `fmtDuration(seconds: number): string`

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน**

```ts
it("degree columns", ...)        // rowCell(row az 12.345, "Az") == "12.35°"
it("range and footprint have no unit", ...)  // "Range" 1234.56 → "1235"; "Footp" → "%.0f"
it("lat/lon signed with trailing space", ...) // lat −13.75 → "-13.75° " (spec: N/S/E/W ปิดจนงานย่อย 4)
it("doppler, loss, delay", ...)  // "Dop" −2345.6 → "-2346"; "Loss" → "%.2f"; "Del" → "%.2f"
it("MA uses the 256 scale with a degree sign", ...) // ma 128 → "128.00°"
it("time column uses the default format in UTC", ...) // "2026-11-12T05:06:07.000Z" → "2026/11/12 05:06:07"
it("duration", ...)              // fmtDuration(3725.9) == "01:02:05"; fmtDuration(0) == "- N/A -"
it("pass vis and orbit", ...)    // passCell(p, "Vis") == "V-E"; "Orbit" == "12345"
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**
- [ ] **Step 3: Implement** — ฟังก์ชันรูปแบบใช้ `formatTime` และ `fmtFixed` ของ core ทุกช่องรับ `null` แล้วแสดง `-` แบบ core
- [ ] **Step 4: รัน** — `npm test`
- [ ] **Step 5: Commit** — `feat(gpredict-web): pass table cells and pass API client`

### Task 10: Web — ข้อความไฟล์ Save และกล่อง Save

**Files:**
- Create: `web/src/passes/passText.ts`, `web/src/passes/passText.test.ts`, `web/src/passes/SavePassDialog.tsx`

**Interfaces:**
- Consumes: Task 9 types, `passCells.rowCell/passCell`
- Produces:
  - `SAVE_CONTENTS_LABELS` (ตัวเลือก "File contents:" ตาม ref-P §8.1 ลำดับ = ค่า 0–2 ของ `PREDICT/SAVE_CONTENTS`)
  - `onePassText(a: { sat; qth; pass: PassInfo }, columns: readonly string[], contents: 0 | 1 | 2, now: Date): string` (ref-P §8.3)
  - `passListText(a: { sat; qth; passes: PassInfo[] }, columns: readonly string[], contents: 0 | 1 | 2, now: Date): string` (ref-P §8.4)
  - `defaultFileName(kind: "one" | "list", satName: string, orbit?: number): string`, `cleanFileName(s: string): string`, `validFileName(s: string): boolean` (A–Z a–z 0–9 - _ ยาว 1–100)
  - `downloadText(name: string, text: string): void` (Blob + `<a download="<name>.txt">`)
  - `SavePassDialog({ kind, answer, columns, onClose })`

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน** — คัดลอกตัวอย่างใน ref-P §8.3 และ §8.4 ลงใน test เป็นค่าที่คาดหวังทั้งก้อน
  (สร้าง `PassInfo` ที่ให้ค่าตรงกับตัวอย่าง ถ้าตัวอย่างไม่มีค่าครบให้เขียนค่าที่คาดหวังตามรูปแบบของ ref-P ทุกช่องว่างและเส้นคั่น)

```ts
it("one pass, complete report", ...)     // onePassText(..., 0, now) === EXPECTED_ONE_COMPLETE
it("one pass, info only and data only", ...)   // contents 1 และ 2 ตาม ref-P §8.1/§8.3
it("pass list, complete report", ...)    // passListText(..., 0, now) === EXPECTED_LIST_COMPLETE
it("default file names", ...)            // defaultFileName("one", "ISS (ZARYA)", 12345) == ชื่อตามกติกาแทนอักขระของ ref-P §8.1; "list" → "<ชื่อ>-passes"
it("file name validation", ...)          // "" ไม่ผ่าน; "a".repeat(101) ไม่ผ่าน; "a b" ไม่ผ่าน; "ISS-25544_x" ผ่าน
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**
- [ ] **Step 3: Implement** — กล่อง Save ตาม spec §6.3: ชื่อ "Save Pass Details" หรือ "Save Passes" แถว "Save in folder:" แสดง
  `บันทึกลงโฟลเดอร์ดาวน์โหลดของ browser` (ของเรา) ปุ่ม Save กดไม่ได้เมื่อชื่อไม่ผ่าน Save Pass Details จำค่า contents ด้วย
  `savePrefs({"PREDICT/SAVE_CONTENTS": n}, [])` เมื่อค่าเปลี่ยน Save Passes เริ่มที่ 0 ทุกครั้ง
- [ ] **Step 4: รัน** — `npm test`
- [ ] **Step 5: Commit** — `feat(gpredict-web): save pass text in Gpredict's file layout`

### Task 11: Web — Polar plot และ Az/El plot ของ pass

**Files:**
- Create: `web/src/passes/passPolar.ts`, `web/src/passes/passAzEl.ts`, `web/src/passes/PassPolarPlot.tsx`, `web/src/passes/PassAzElPlot.tsx`,
  `web/src/passes/passPolar.test.ts`, `web/src/passes/passAzEl.test.ts`

**Interfaces:**
- Consumes: `views/polarGeom.ts` ของ core (แปลง Az/El เป็นจุดบนวงกลมตามทิศ), `PassInfo`
- Produces:
  - `passPolarScene(p: PassInfo | null, size: { width: number; height: number }, orientation: string, qthName: string | null): PolarScene`
    (`null` = วาดแกนและป้ายอย่างเดียว งานย่อยที่ 3 ใช้ใน Antenna Control) `PassPolarPlot` รับ `pass: PassInfo | null` เช่นกัน (วงและป้าย, เส้นทาง, ป้ายเวลา 5 จุด `%H:%M` ตาม ref-P §5.3)
  - `polarMouseText(x, y, size, orientation): string | null` → `AZ: %.0f°  EL: %.0f°` (ช่องว่าง 2 ช่อง)
  - `azElScene(p: PassInfo, size): AzElScene` (กรอบเว้น 40 px, แกน Az 0–180 หรือ 0–360 ตาม ref-P §6.1, ขีด 5 ขีด, "UTC")
  - `azElMouseText(x, y, p, size): string | null` → `T: %s, AZ: %.0f°, EL: %.0f°` (คำนวณจาก Y ตาม ref-P §6.3)

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน**

```ts
it("track starts and ends on the horizon at AOS/LOS azimuth", ...)   // จุดแรกและจุดสุดท้ายห่างจากศูนย์กลาง = รัศมีวง 0°
it("five time labels", ...)                   // ป้าย 5 อันรูปแบบ HH:MM ตามตำแหน่งของ ref-P §5.3
it("null pass draws axes only", ...)       // passPolarScene(null, …) มีวงและป้ายทิศ ไม่มีเส้นทางและป้ายเวลา
it("polar mouse text", ...)                   // จุดกลาง → "AZ: 0°  EL: 90°" (หรือตาม orientation); นอกวง → null
it("az axis 0-180 when the pass stays in one half", ...)  // เงื่อนไขของ ref-P §6.1
it("az/el ticks and margins", ...)            // กรอบที่ x 40..width−40, ขีดด้านละ 5
it("az/el mouse text uses Y", ...)            // ref-P §6.3
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**
- [ ] **Step 3: Implement** — scene เป็นข้อมูลล้วน component วาดบน canvas ด้วย hook `views/canvasHooks.ts` ของ core
  Polar พื้นขาวเสมอ สีและทิศใช้ค่าตั้งต้นของ Polar View ของ core (spec §5)
- [ ] **Step 4: รัน** — `npm test`
- [ ] **Step 5: Commit** — `feat(gpredict-web): pass polar and az/el plots`

### Task 12: Web — หน้าต่าง Pass details และ Upcoming passes

**Files:**
- Create: `web/src/passes/passWindows.ts`, `web/src/passes/passWindows.test.ts`, `web/src/passes/PassDetails.tsx`, `web/src/passes/UpcomingPasses.tsx`,
  `web/src/passes/printPass.ts`, `web/src/passes/printPass.test.ts`, `web/src/passes/PassWindows.tsx`
- Modify: `web/src/App.tsx` (state ของหน้าต่าง pass), `web/src/styles.css`

**Interfaces:**
- Consumes: Task 9–11
- Produces:
  - `passWindows.ts` (pure): `type PassWindow = { id: string; kind: "details"; answer: { sat; qth; pass }; parent: string | null } | { id: string; kind: "upcoming"; answer: { sat; qth; passes } }`;
    `openWindow(list, w)`, `closeWindow(list, id)` (ปิดลูกที่ `parent === id` ด้วย), `newId(): string`
  - `printPages(lines: readonly string[], perPage = 50): string[][]`; `printPass(title: string, lines: readonly string[]): void` (iframe ซ่อน + `print()`)
  - `PassWindows({ windows, onOpen, onClose })` วาดทุกหน้าต่าง; App ส่ง `openPassWindow(w)` ให้ Task 13 ใช้

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน**

```ts
it("closing the upcoming window closes its details windows", ...)   // upcoming U, details D1 parent U, D2 parent null → close(U) เหลือ D2
it("several details windows can be open", ...)
it("print pages", ...)       // 120 บรรทัด → 3 หน้า [50, 50, 20]; 0 บรรทัด → 1 หน้าว่าง
it("print lines are the data table", ...)  // บรรทัดที่พิมพ์ = ตารางของ ref-P §8.5 ไม่มีหัว 5 บรรทัด
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**
- [ ] **Step 3: Implement** — Pass details ตาม spec §5 (ชื่อ `Pass details for %s (orbit %d)` ความสูงเริ่ม 300 px แท็บ Data/Polar/Az/El
  คอลัมน์จาก `PREDICT/SINGLE_PASS_COL` ปุ่ม Print, Save, Close) Upcoming passes ตาม spec §6.1 (คอลัมน์จาก `PREDICT/MULTI_PASS_COL`
  ดับเบิลคลิกหรือ Enter เปิด Pass details ที่มีหน้าต่างนี้เป็นแม่ คลิกขวาหรือ Shift+F10 เปิดเมนู "Show details" / เส้นคั่น /
  "Polar plot" และ "Az/El plot" ที่กดไม่ได้ ปุ่ม Print ไม่ทำอะไร ปุ่ม Save เปิด Save Passes)
  แถบหัวพิมพ์สีเทาสูง 10 มม. มีชื่อ (sans 14) และ `n/N`
- [ ] **Step 4: รัน** — `npm test`, `npm run build`
- [ ] **Step 5: Commit** — `feat(gpredict-web): pass details and upcoming passes windows`

### Task 13: Web — เมนูคลิกขวาของดาว กล่องรอ และข้อความไม่มี pass

**Files:**
- Create: `web/src/passes/passRequest.ts`, `web/src/passes/passRequest.test.ts`, `web/src/passes/PassWait.tsx`, `web/src/passes/NoPassMessage.tsx`
- Modify: `web/src/satPopup.ts` (+test), `web/src/components/SatPopup.tsx`, `web/src/components/ModuleView.tsx`, `web/src/views/SingleSatView.tsx`

**Interfaces:**
- Consumes: Task 9 `requestPass`, Task 12 `openPassWindow`
- Produces:
  - `PopupAction` เพิ่ม `{ type: "pass"; kind: "current" | "next" | "future" }`
  - `passRequest.ts`: `runPassRequest(module: string, body: PassBody, hooks: { onWaiting(): void; onDone(a: PassAnswer): void; onError(text: string): void }): { cancel(): void }`
    เรียก `onWaiting` เมื่อคำตอบยังไม่มาใน `WAIT_BOX_DELAY_MS` = 500
  - `PassWait({ state: "waiting" | { error: string }, onCancel, onRetry })` ข้อความ `กำลังคำนวณวงโคจรด้วย GMAT…` (ของเรา)
  - `NoPassMessage({ message: ApiMessage, onOk })` กล่อง `Modal` ไม่มีชื่อ ไอคอน error/info ปุ่ม OK ข้อความหลายบรรทัดตามตัวอักษร

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน**

```ts
// satPopup.test.ts
it("pass items are enabled in every view", ...)  // ทุก view: "Show next pass", "Future passes" เป็น item ที่มี action; "Show current pass" มีเมื่อ el > 0 เท่านั้น
// passRequest.test.ts (fake timers + fetch ปลอม)
it("no waiting box when the answer comes within 500 ms", ...)
it("waiting box after 500 ms", ...)
it("cancel aborts the request and reports nothing", ...)
it("waiting box shows the error and Retry", ...)   // fetch ตอบ 503 GMAT_FAILED → onError(ข้อความไทยของ server)
it("current pass click does nothing when El is no longer > 0", ...)  // ใช้ el ของ tick ล่าสุดตอนคลิก
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**
- [ ] **Step 3: Implement** — คำตอบ `pass` เปิด Pass details (`parent: null`) คำตอบ `passes` เปิด Upcoming passes คำตอบ `message` เปิด `NoPassMessage`
  Single sat (ปุ่มที่หัว view) และ Event list ใช้เมนูเดียวกัน Satellite info และชื่อตัวหนายังกดไม่ได้ (งานย่อย 4)
- [ ] **Step 4: รัน** — `npm test`, `npm run build`
- [ ] **Step 5: Commit** — `feat(gpredict-web): pass items in the satellite popups with GMAT waiting box`

### Task 14: Web — Sky at a glance

**Files:**
- Create: `web/src/passes/skyGlance.ts`, `web/src/passes/skyGlance.test.ts`, `web/src/passes/SkyGlanceWindow.tsx`
- Modify: `web/src/moduleMenu.ts` (+test: `ModuleAction` เพิ่ม `{ type: "skyGlance" }`), `web/src/components/ModuleView.tsx` หรือที่จัดการ Module menu, `web/src/App.tsx`

**Interfaces:**
- Consumes: Task 9 `getSkyGlance/releaseSkyGlance`, Task 13 การเปิด Pass details ด้วย `kind: "at"`
- Produces:
  - `skyLayout(n: number): { width: 600; height: number }` = `600 × (n·10 + (n+1)·20 + 50)`
  - `skyScene(a: SkyGlanceAnswer, size, utc: boolean): SkyScene` (แท่ง alpha 0xA0 ขอบทึบ ชื่อซ้ายหรือขวาของแท่งแรก แถบล่างพร้อมขีดชั่วโมง ป้าย "UTC")
  - `hitPass(scene, x, y): { norad: number; aos: string } | null`
  - `needsRedraw(prev: { t: Date; lat: number; lon: number }, next: same): boolean` (เวลาเกิน `SKY_REDRAW_D` วัน หรือย้ายเกิน 1 กม.)

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน**

```ts
it("window size", ...)              // skyLayout(3).height == 3*10 + 4*20 + 50
it("bars follow time", ...)         // pass aos = t0 + hours/2 → x ของขอบซ้ายอยู่กลางพื้นที่วาดตาม ref-P §7.3
it("name placement", ...)           // แท่งแรกอยู่ครึ่งขวา → ชื่ออยู่ซ้ายของแท่ง (ref-P §7.5)
it("hit test", ...)
it("redraw threshold", ...)         // 60 s → false, 61 s → true; ย้าย 0.5 กม. → false, 1.5 กม. → true
it("module menu enables Sky at a glance", ...)
it("no satellites text", ...)       // sats [] → ข้อความ "This module has no satellites!"
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**
- [ ] **Step 3: Implement** — หน้าต่าง `The sky at a glance (<module>)` หนึ่งหน้าต่างต่อ module (กดซ้ำยกหน้าต่างเดิม)
  ส่ง `t` เฉพาะการขอครั้งแรก ถามซ้ำทุก 1 วินาทีระหว่าง `computing` ครั้งแรกแสดงข้อความรอ ครั้งต่อไปคงภาพเดิม
  ตรวจ `needsRedraw` กับ tick ของ module แล้วขอใหม่ ปิดหน้าต่างเรียก `releaseSkyGlance` คลิกซ้ายบนแท่งเปิด Pass details (`parent: null`)
- [ ] **Step 4: รัน** — `npm test`, `npm run build`
- [ ] **Step 5: Commit** — `feat(gpredict-web): sky at a glance window`

### Task 15: Integration กับ GMAT จริง, README และการตรวจรับ

**Files:**
- Create: `server/tests/test_integration_passes.py`
- Modify: `README.md` ของ `api-interop/gpredict-web/` (ส่วน Pass predictions, Preferences, รหัสใหม่ `PREFS_INVALID`, `PASS_INVALID`, `PASS_NO_AOS`, `PASS_NONE_WITHIN`)

- [ ] **Step 1: เขียน test integration** (ข้ามเมื่อไม่มี GMAT)

```python
def test_iss_future_passes_match_gmat_per_second(self):
    # ISS = TLE คงที่ `ISS` ของ test_integration_gmat.py (ไม่ใช้เน็ต) ที่ THBK 3 วันเริ่มใกล้ epoch ของ TLE: ทุก pass ของ future
    # GMAT รันอีกครั้งทุก 1 วินาทีรอบ AOS/LOS ±120 s → AOS/LOS ต่างไม่เกิน 1 s, Max El ต่างไม่เกิน 0.01°
def test_sky_glance_ten_satellites(self):    # module 10 ดวง → status ok หลังรอ, ทุก pass อยู่ในช่วง 8 ชม. (ยกเว้น 1 pass ต่อดาวตามกติกาเลื่อนช่วง)
```

- [ ] **Step 2: รัน** — test ทั้งชุดของ server, engine และ web ผ่าน
- [ ] **Step 3: ตรวจรับในหน้าเว็บจริง** (restart server แล้วเปิด `http://127.0.0.1:8740`) ทำตาม spec §12 ข้อ 1–6 ทีละข้อ บันทึกผลลง README
  ส่วน "ผลตรวจรับงานย่อยที่ 2" (เวลา ค่า AOS/LOS ที่เทียบ ไฟล์ที่ Save)
- [ ] **Step 4: ตรวจ GNSS Studio** — test ของ engine ผ่านและ `git diff feature/gpredict-web-core -- api-interop/gnss-predict` ว่าง
- [ ] **Step 5: Commit** — `docs(gpredict-web): pass predictions usage and acceptance results`
