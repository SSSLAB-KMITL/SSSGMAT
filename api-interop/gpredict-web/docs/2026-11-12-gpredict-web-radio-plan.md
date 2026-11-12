# Gpredict Web Radio & Rotator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** งานย่อยที่ 3 ของ Gpredict Web: Radio Control, Antenna Control, Preferences → Interfaces (Radios, Rotators และ editor)
และ Edit → Update transponder data โดย server เป็นเจ้าของ controller ที่คุย hamlib `rigctld`/`rotctld` ทาง TCP

**Architecture:** server มี `RigController`/`RotController` ต่อ module (asyncio task ใน event loop ของ uvicorn) ที่รับค่าดาวเป้าหมาย
จาก tick ของ module (คำนวณจาก GMAT) แล้วส่งคำสั่ง hamlib ตาม ref-R ทุกตัวอักษร `ControllerHub` ถือ controller ทุกตัว
และสั่งให้ tick ของ module ทำงานต่อแม้ไม่มี browser สถานะของ controller ไปกับ tick (`radio`, `rotator`) หน้าต่างควบคุมในหน้าเว็บ
มี WebSocket ของตัวเอง จึงอยู่ได้ทุกแท็บ ค่าอุปกรณ์เก็บใน `data/hwconf/*.json` transponder เก็บใน `data/trsp/<NORAD>.json`

**Tech Stack:** ชุดเดียวกับ core และงานย่อยที่ 2 (Python 3.14 + asyncio, FastAPI 0.162.4, unittest รวม `IsolatedAsyncioTestCase`;
React 19.1.10, TypeScript 5.9.3, Vitest 4.1.12) ไม่เพิ่ม dependency ตรวจรับกับ hamlib 4.7.2 (`/opt/homebrew/bin/rigctld`, `rotctld`, `rigctl`)

**Spec:** [2026-11-12-gpredict-web-radio-design.md](2026-11-12-gpredict-web-radio-design.md) อ่านคู่กับ
[ref-R](2026-11-12-gpredict-reference-radio.md) และ [แผนงานย่อยที่ 2](2026-11-12-gpredict-web-passes-plan.md) (interface ที่ใช้ต่อ)
(ในแผนนี้ "spec §n" = spec ของงานนี้, "ref-R §n" = รายการอ้างอิงส่วน Radio/Rotator, "SP2 Task n" = งานในแผนของงานย่อยที่ 2)

## Global Constraints

- ทำงานใน worktree `/Users/phuwish/SSSGMAT/.worktrees/gpredict-web` บน branch `feature/gpredict-web-radio`
  (แตกจากปลายของ `feature/gpredict-web-passes` หลังงานย่อยที่ 2 เสร็จ) ห้าม `cd` เข้า checkout หลัก `/Users/phuwish/SSSGMAT`
  ห้าม push ห้าม merge ห้ามใช้ `git stash` แบบไม่มีชื่อ
- `*.md` ถูก ignore ที่ราก repo: ไฟล์ Markdown ต้อง `git add -f`
- ห้ามแก้ `api-interop/gnss-predict/` (engine) GNSS Studio ต้องได้ผลเหมือนเดิมทุกไบต์
- คำสั่ง test
  - server: `cd api-interop/gpredict-web/server && ../.venv/bin/python -m unittest discover -s tests`
  - web: `cd api-interop/gpredict-web/web && npm test` และ `npm run build`
  - engine (ตรวจว่าไม่กระทบ): `cd api-interop/gnss-predict && python3 -m unittest discover -s tests`
- test ห้ามใช้เน็ตและห้ามใช้ hamlib จริง: rigctld/rotctld ใช้ `tests/fake_hamlib.py` (Task 2) SatNOGS ใช้ fixture JSON และ opener ปลอม
  เฉพาะ Task 15 (ตรวจรับ) ใช้ `rigctld -m 1 -t 4532`, `rotctld -m 1 -t 4533` และดึง SatNOGS จริงได้ 1 ครั้ง (ผู้ใช้อนุญาต ไม่เกิน 1 ครั้งต่อ 2 ชม.)
- การดึง SatNOGS ใช้ User-Agent `gpredict-web` เท่านั้น ห้ามใส่อีเมลหรือข้อมูลผู้ใช้ใน header, URL หรือ payload
- worktree ไม่มี GMAT build: test integration และการรันจริงใช้ `GMAT_BIN=/Users/phuwish/SSSGMAT/application/bin/GmatConsole`
  และ `GNSS_STUDIO_DATA=/Users/phuwish/SSSGMAT/api-interop/gnss-predict/data`
- เวลาใน API เป็น ISO 8601 UTC ลงท้าย `Z` ความละเอียดมิลลิวินาที (`runtime.iso_ms`)
- ป้าย ชื่อหน้าต่าง ปุ่ม tooltip และข้อความของ Gpredict ใช้ตาม ref-R ทุกตัวอักษร (รวมคำผิดของ ref-R §13 ข้อ 17 และป้ายที่ต่างกันของ ข้อ 18)
  ข้อความที่เราเพิ่มเป็นภาษาไทย ของที่ Gpredict ไม่มีมี comment `(ของเรา)` ในโค้ด
- log ของ controller ใช้ `_log = logging.getLogger(__name__)` ข้อความเป็นภาษาอังกฤษของ ref-R §3.8, §6.6, §11.2 โดยตัด `%s:`/`%s:%s:` ตัวหน้า
  (ชื่อฟังก์ชันของ Gpredict) ออก เพราะงานย่อยที่ 4 ใส่ชื่อฟังก์ชันในรูปแบบบรรทัด log เอง งานนี้ไม่สร้างไฟล์ log
- คำสั่ง hamlib ทุกตัวสร้างจากฟังก์ชันใน `rig.py`/`rot.py` ที่มี test ตรวจทุกตัวอักษร เลขทศนิยมใช้ `.` เสมอ (ไม่ขึ้นกับ locale)
- ค่าคงที่ (spec §4–§9, ref-R):
  `CONNECT_TIMEOUT_S=3.0`, `REPLY_TIMEOUT_S=2.0`, `MAX_ERROR_COUNT=5`, `READBACK_DELAY_S=0.005`, `FREQ_THRESHOLD_HZ=1.0`,
  `FT817_TX_THRESHOLD_HZ=10.0`, `FT817_TX_PERIOD_S=10.0`, `C_KMS=299792.458`, `FREQ_MAX_HZ=9_999_999_999`,
  `CYCLE_MS=(10, 30000)`, `CYCLE_DEFAULT_MS=1000`, `THRESHOLD_DEG=(0.01, 50.0)`, `THRESHOLD_DEFAULT_DEG=5.0`, `THRESHOLD_READ_MIN_DEG=0.1`,
  `ROT_SETTLE_S=0.1`, `ROT_LOOP_MIN_S=0.8`, `NO_PASS_SETPOINT=(0.0, 45.0)`, `LEAD_DEFAULT=timedelta(days=1/72)`,
  `ROT_PASS_DAYS=3`, `QTH_MOVE_KM=1.0`, `TRSP_MIN_INTERVAL=timedelta(hours=2)`, `TRSP_TIMEOUT_S=30`, `TRSP_NAME_MAX=79`, `TRSP_MODE_MAX=19`
- commit message แบบ conventional ภาษาอังกฤษ scope `gpredict-web` ลงท้ายด้วย `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## Review Focus

1. **ถอดสาย/ปิด rigctld ระหว่าง Engage** controller ต้องไม่ค้าง (timeout 2 วินาที) disengage เองภายใน 5 รอบพร้อมบรรทัดสถานะไทย
   และ event loop ของ server ยังตอบคำขออื่น → Task 2 `test_reply_timeout`, Task 4 `test_dead_rigctld_disengages_after_five_cycles`
2. **เปิด Radio Control แล้วกดเลือกดาวใน Map, เปิด Ground Track หรือเปิด Autotrack** (ทุกอย่างนี้ PUT module ของ core)
   ต้องบันทึกได้ตามปกติ 409 `CONTROLLER_ACTIVE` เกิดเฉพาะการแก้สถานีหรือรายชื่อดาว → Task 9 `test_put_module_view_change_allowed_while_active`
3. **ปิดแท็บ browser ระหว่าง Engage แล้วเปิดใหม่** controller ทำงานต่อ (ความถี่ยังถูกส่ง) และหน้าต่างกลับมาพร้อมสถานะเดิม
   → Task 8 `test_controller_runs_without_socket`, Task 14 `restores controller windows from GET /api/controllers`
4. **แก้ไฟล์ `data/hwconf/*.json` ด้วยมือจนพัง** GET `/api/hwconf` ยังตอบได้ ไฟล์ที่อ่านไม่ได้ถูกข้ามพร้อม log
   และเลือกอุปกรณ์นั้นไม่ได้ → Task 1 `test_unreadable_file_is_skipped`
5. **SatNOGS ล่ม ตอบ HTML หรือ JSON ผิดรูป** transponder เดิมต้องอยู่ครบ หน้าต่างแสดง "Finished" และบรรทัดไทยบอกสาเหตุ
   → Task 7 `test_bad_json_keeps_old_files`

## การตัดสินใจในแผนที่ spec ไม่ได้กำหนดไว้

1. เพิ่มไฟล์ `controllers.py` (`ControllerHub`) นอกเหนือจาก 5 ไฟล์ของ spec §3.1: ถือ controller ทุกตัว เป้าหมายของทุก module และเชื่อมกับ tick
2. หน้าต่าง Radio/Antenna Control ในหน้าเว็บเปิด WebSocket `/ws/modules/{name}` ของตัวเอง (core ต่อ socket เฉพาะแท็บที่เลือก)
   รายการ controller ที่เปิดอยู่มาจาก `GET /api/controllers` ตอนเปิดหน้าและหลังทุกการเปิด/ปิด หน้าต่างหายเมื่อ tick ไม่มี `radio`/`rotator`
   หรือ socket ถูกปิดด้วย 1000
3. controller รับค่าจาก tick ใน event loop (`ControllerHub.on_tick`) ไม่ใช่ใน thread: `Ticks._produce` ได้ tick เป็น dict จาก thread
   แล้วเติม `radio`/`rotator` ใน event loop แล้วจึงแปลง JSON ใน thread
4. `PUT /api/modules/{name}` ตอบ 409 `CONTROLLER_ACTIVE` **เฉพาะเมื่อ `qth` หรือ `satellites` เปลี่ยน** เพราะ core บันทึกค่าของ view
   (Ground Track, Highlight footprint, Sky track, ดาวของ Single sat) ด้วย PUT เดียวกัน ส่วน Module menu → Configure ในหน้าเว็บถูกห้ามทั้งหมดตาม spec §4.6
5. body ของ action ผิดตอบ 422 รหัสใหม่ `CONTROLLER_INVALID` action กับ controller ที่ไม่ได้เปิดตอบ 404 `NOT_FOUND`
6. คำสั่งของอุปกรณ์ "2. Device" ใช้ธง VFO option ของอุปกรณ์นั้นเอง (แก้ ref-R §13 ข้อ 6: ธงของอุปกรณ์ 1 อาจทำให้อุปกรณ์ 2 ได้คำสั่งที่มันไม่รับ)
7. FT817 split เมื่อมี VFO option: `S VFOA 1 VFOB` และ `S VFOA 0 VFOA` (spec §9.1 ข้อ 7 กำหนดเฉพาะแบบไม่มี VFO option)
8. object ใน `/api/hwconf` ใช้ key ของ Gpredict แบบเดียวกับไฟล์ (`Host`, `Port`, `Cycle`, `LO`, …) บวก `name` คำศัพท์จึงมีชุดเดียว
9. ลำดับการคำนวณ set-point ของ rotator: ค่าพื้นฐาน → flip → แปลงเป็น −180…+180 → clamp ไปที่ Min/Max (ref-R §6.2 ไม่บอกลำดับ
   และ clamp ก่อนแปลงทำให้ rotator −180…+180 หมุนไปทิศตะวันตกไม่ได้)
10. การเทียบ Threshold (แก้ ref-R §13 ข้อ 13) ใช้ Az ที่ rotctld อ่านได้ในหน่วยของอุปกรณ์ตรงๆ เทียบกับ set-point ส่วน "Read:" แสดงค่าที่ห่อเป็น 0–360
11. รอบ cycle ที่ตกหล่น (spec §9.1 ข้อ 9): รอบถัดไปเริ่มที่จังหวะ `start0 + k·Cycle` ถัดไปที่ยังไม่ถึง รอบที่ข้ามบันทึก debug `"%s missed the deadline"`
12. คำตอบของ `AOS`, `LOS`, `U IQRECORD 1/0` อ่าน 1 บรรทัดภายใน `REPLY_TIMEOUT_S` ไม่ตรวจค่า และ timeout ไม่นับเป็น error (ref-R §3.7)
13. `POST /api/trsp/update` ทำทีละครั้งด้วย lock คำขอที่ซ้อนรอคำขอแรกจบ (ภายใน 2 ชม. จึงได้ข้อมูลจาก cache)
14. pass ของ rotator ได้จาก `PassService.current_pass` (เพิ่มใน Task 8) owner `rot:<module>` ไม่รอ GMAT ระหว่างคำนวณ set-point ใต้ขอบฟ้าใช้ `NO_PASS_SETPOINT`
15. "2. Device" เรียงตามลำดับของ `os.scandir` (ลำดับในไดเรกทอรีแบบ Gpredict) "1. Device" และตาราง Radios เรียงตามชื่อ
16. Range/Rate ในหน้าต่างควบคุมเป็น km และ km/s จนงานย่อยที่ 4 เพิ่ม Imperial units
17. รายชื่อดาวใน combo ของ controller เรียงด้วย key เรียงชื่อตัวเดียวกับที่ SP2 Task 6 ใช้เรียงแถวของ Sky at a glance (แบบ `compareNames` ของ web)

---

### Task 1: Server — `hwconf.py` และ `GET/PUT /api/hwconf`

(path ในแผนนี้นับจาก `api-interop/gpredict-web/`)

**Files:**
- Create: `server/gpredict_web/hwconf.py`, `server/tests/test_hwconf.py`
- Modify: `server/gpredict_web/app.py` (`HwConf` ใน `create_app`, 2 route)
- Test: `server/tests/test_api.py` (class `HwconfApiTest`)

**Interfaces:**
- Produces:
  - `RIG_TYPES = ("RX only", "TX only", "Half-duplex", "Full-duplex", "FT817/857/897 (auto)", "FT817/857/897 (manual)")`, `PTT_TYPES = ("None", "Read PTT", "Read DCD")`
  - `VFO_NAMES = {1: "VFOA", 2: "VFOB", 3: "Main", 4: "Sub"}`
  - `@dataclass(frozen=True) RadioConf(name, host, port, cycle=1000, lo=0.0, lo_up=0.0, default_up=145_890_000.0, default_down=145_890_000.0, type=0, ptt=0, vfo_up=0, vfo_down=0, signal_aos=False, signal_los=False, signal_aoiq=False, signal_loiq=False)`
  - `@dataclass(frozen=True) RotConf(name, host, port, cycle=1000, threshold=5.0, az_type=0, min_az=0.0, max_az=360.0, min_el=0.0, max_el=90.0, az_stop=0.0)`
  - `radio_from_dict(d: dict) -> RadioConf`, `radio_to_dict(r) -> dict`, `rot_from_dict(d) -> RotConf`, `rot_to_dict(r) -> dict`
    (key ของ Gpredict ตาม spec §6.2 บวก `"name"`; `VFO_UP`/`VFO_DOWN` มีเฉพาะ Type 3; ผิดราย raise `ApiError("HWCONF_INVALID", 422, <ไทย>, <key>)`)
  - `class HwConf(data_dir: Path)`: `radios() -> list[RadioConf]` (เรียงชื่อ), `radios_dir_order() -> list[RadioConf]`, `radio(name) -> RadioConf | None`,
    `rotators() -> list[RotConf]`, `rotator(name) -> RotConf | None`, `replace(radios: list[dict], rotators: list[dict]) -> None`,
    `save_radio_cycle(name: str, cycle: int) -> None`, `save_rotator_runtime(name: str, cycle: int, threshold: float) -> None`
  - `GET /api/hwconf` → `{"radios": [...], "rotators": [...]}`; `PUT /api/hwconf` body เดียวกัน → แบบเดียวกับ GET

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน** (`test_hwconf.py`)

```python
def test_round_trip_files(self):          # replace([DUMMY], [ROT]) → data/hwconf/DUMMY.rig.json มี {"Host": "localhost", "Port": 4532, "LO": 0.0, …}
                                          # ไม่มี key "name" ในไฟล์, Cycle ไม่ถูกเขียนเมื่อ == 1000 (ref-R §9.1), radios()[0] == RadioConf ที่ส่งไป
def test_missing_keys_use_defaults(self):  # ไฟล์มีแค่ Host, Port, Type, PTT → Cycle 1000, LO 0, Default*FreqHz 145890000, signals False
def test_read_rules(self):                 # Cycle 5 → 10; rot Threshold 0.05 → 0.1; AzStopPos ไม่มี → เท่ากับ MinAz; AzType ไม่มี → 0 พร้อม log INFO
def test_vfo_only_for_full_duplex(self):   # Type 1 พร้อม VFO_UP 3 → อ่านได้ vfo_up 0 และไม่เขียน VFO_*; Type 3 → เขียน VFO_UP/VFO_DOWN
def test_validation(self):                 # ชื่อผิดรูป ("a b", ยาว 26), Port 1023/65536, Type 6, PTT 3, Cycle 9/30001, LO ±1e10+1, Default <0 หรือ >1e10,
                                           # Type 3 ที่ VFO 0, Threshold 0.009/50.01, AzType 2, MinAz −201, MaxAz 451, MinEl/MaxEl −11/181, AzStopPos −181/361
                                           # → HWCONF_INVALID พร้อม object เป็นชื่อ key
def test_duplicate_names_rejected(self):   # สองวิทยุชื่อ "IC910" และ "ic910" → HWCONF_INVALID ไม่มีไฟล์ถูกเขียน (spec §9.1 ชื่อซ้ำ)
def test_replace_deletes_others(self):     # มี A.rig.json, B.rig.json; replace([A]) → B หาย (ref-R §8.5)
def test_replace_keeps_cycle_and_threshold(self):  # ไฟล์เดิม A Cycle 500, R Cycle 200 Threshold 2.5; replace ด้วย dict ที่ไม่มี Cycle/Threshold
                                                   # หรือมี Cycle 10 → ค่าเดิมคงอยู่ (spec §9.1 ข้อ 1, PUT ไม่เปลี่ยน Cycle/Threshold); อุปกรณ์ใหม่ได้ 1000/5.0
def test_save_runtime(self):               # save_radio_cycle("A", 2000), save_rotator_runtime("R", 300, 1.5) → อ่านกลับได้ค่านั้น
def test_unreadable_file_is_skipped(self): # ไฟล์ JSON พัง และไฟล์ที่ไม่มี Port → ไม่อยู่ใน radios(), assertLogs WARNING มีชื่อไฟล์
def test_dir_order(self):                  # patch os.scandir ให้คืน C, A, B → radios_dir_order() ชื่อ C, A, B; radios() ชื่อ A, B, C
```

ใน `test_api.py`: `test_get_hwconf_empty` (`{"radios": [], "rotators": []}`), `test_put_hwconf_replaces`, `test_put_hwconf_invalid_is_422_and_unchanged`

- [ ] **Step 2: รันให้เห็นว่าล้ม** — `../.venv/bin/python -m unittest tests.test_hwconf tests.test_api` → ImportError
- [ ] **Step 3: Implement** — ไฟล์ `data/hwconf/<name>.rig.json` และ `<name>.rot.json` เขียนด้วย `store.write_json_atomic`
  `replace` ตรวจทุกตัวก่อน แล้วเขียนทุกไฟล์ใหม่ แล้วลบไฟล์ที่ไม่อยู่ในชุด `Cycle`/`Threshold` ใน dict ถูกละเสมอ ใช้ค่าในไฟล์เดิมของชื่อเดียวกัน
  (มีเฉพาะหน้าต่างควบคุมที่เปลี่ยนค่าเหล่านี้ผ่าน `save_*` ตอนปิด ร่างใน Preferences ที่ค้างอยู่จึงไม่ทับค่าที่เพิ่งบันทึก)
  ข้อความไทยบอกป้ายของ editor เช่น `Port ต้องเป็นจำนวนเต็ม 1024–65535`
- [ ] **Step 4: รัน test ทั้งชุดของ server** — ผ่าน
- [ ] **Step 5: Commit** — `feat(gpredict-web): radio and rotator configuration store`

### Task 2: Server — client hamlib แบบ asyncio และ fake rigctld/rotctld สำหรับ test

**Files:**
- Create: `server/gpredict_web/hamlib.py`, `server/tests/fake_hamlib.py`, `server/tests/test_hamlib.py`

**Interfaces:**
- Produces (`hamlib.py`):
  - `class HamlibError(Exception)`
  - `class HamlibClient(host: str, port: int, label: str)`:
    `async connect() -> None` (หาชื่อ host ไม่เจอ, ต่อไม่ได้, เกิน `CONNECT_TIMEOUT_S` → `HamlibError` ข้อความไทยมี host:port),
    `async command(cmd: str | bytes, lines: int = 1) -> list[str]` (ส่งแล้วอ่านทีละบรรทัดจนครบ `lines` หรือเจอบรรทัดที่ขึ้นต้น `RPRT`
    แต่ละบรรทัดรอไม่เกิน `REPLY_TIMEOUT_S` → `HamlibError`; การเชื่อมต่อปิดระหว่างรอ → `HamlibError`),
    `async close() -> None` (ส่ง `q\n` ถ้ายังต่ออยู่ ไม่อ่านคำตอบ แล้วปิด ไม่ raise), `connected: bool`
  - คำสั่งเรียงทีละคำสั่งด้วย `asyncio.Lock` (ref-R §4.2 Serialisation)
  - `is_ok(reply: list[str]) -> bool` (บรรทัดแรกขึ้นต้น `RPRT 0`), `is_error(reply) -> bool` (บรรทัดแรกขึ้นต้น `RPRT`)
- Produces (`tests/fake_hamlib.py`):
  - `class FakeHamlib`: `async start() -> int` (port), `async stop()`, `log: list[bytes]` (ทุกคำสั่งที่ได้ รวม `\n`),
    `reply: Callable[[bytes], bytes | None]` (ตั้งค่าได้ None = ไม่ตอบ), ค่าตั้งต้นตอบ `RPRT 0\n` กับคำสั่งตั้งค่า
    และค่าที่เก็บไว้กับ `f`, `i`, `t`, `p`, `\chk_vfo` (`freq`, `split_freq`, `ptt`, `pos`, `vfo_opt` เป็น attribute ที่ test ตั้งได้),
    `delay_s: float = 0.0`, `drop()` (ปิดทุกการเชื่อมต่อ)

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน** (`IsolatedAsyncioTestCase`)

```python
async def test_set_and_get(self):          # command("F  145890000\n") == ["RPRT 0"]; fake.freq = 435000000 → command("f\n") == ["435000000"]
async def test_two_line_reply(self):       # fake.pos = (180.0, 45.0) → command("p\n", lines=2) == ["180.000000", "45.000000"]
async def test_error_reply_stops_early(self):   # reply ให้ b"RPRT -1\n" → command("p\n", lines=2) == ["RPRT -1"] ไม่รอบรรทัดที่สอง
async def test_reply_timeout(self):        # patch REPLY_TIMEOUT_S = 0.05, reply คืน None → HamlibError ภายใน 0.5 s
async def test_connect_refused_and_bad_host(self):   # port ที่ไม่มีใครฟัง และ host "no-such-host.invalid" → HamlibError
async def test_connect_timeout(self):      # patch asyncio.open_connection ให้รอนาน, CONNECT_TIMEOUT_S = 0.05 → HamlibError
async def test_bytes_command(self):        # command(b"\x8b\n") → fake.log[-1] == b"\x8b\n"
async def test_close_sends_q(self):        # close() → fake.log[-1] == b"q\n", connected False, close() ซ้ำไม่ raise
async def test_peer_closed(self):          # fake.drop() แล้ว command("f\n") → HamlibError
async def test_commands_are_serialised(self):   # สอง command พร้อมกันด้วย gather (fake.delay_s 0.02) → log ไม่สลับ และคำตอบตรงคำสั่ง
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**
- [ ] **Step 3: Implement** — `asyncio.open_connection` + `asyncio.wait_for` คำสั่ง `str` ส่งเป็น ASCII คำตอบตัด `\n` และ `\r` ท้ายบรรทัด
- [ ] **Step 4: รัน test** — ผ่าน
- [ ] **Step 5: Commit** — `feat(gpredict-web): asyncio hamlib client with timeouts`

### Task 3: Server — สูตรความถี่และข้อความคำสั่งของวิทยุ (`rig.py` ส่วนบริสุทธิ์)

**Files:**
- Create: `server/gpredict_web/rig.py` (ส่วนบนของไฟล์), `server/tests/test_rig_math.py`

**Interfaces:**
- Produces (ฟังก์ชันบริสุทธิ์ ไม่มี I/O):
  - `doppler_down(f_sat: float, rate_kms: float) -> float` = −f·rr/c; `doppler_up(f_sat, rate_kms) -> float` = +f·rr/c
  - `radio_freq(f_sat: float, doppler: float, lo: float, track: bool) -> float`; `sat_from_radio(f_read: float, doppler: float, lo: float, track: bool) -> float`
  - `tune_centre(low: int, high: int) -> int | None` (`low + abs(high − low) // 2` เมื่อทั้งคู่ > 0)
  - `lock_up(f_down: float, t: dict) -> float | None`, `lock_down(f_up: float, t: dict) -> float | None` (ref-R §3.3)
  - `is_beacon(t: dict) -> bool` (ไม่มี uplink และ `down_low == down_high`)
  - คำสั่ง (คืน `str` ที่ลงท้าย `\n` ยกเว้น DCD คืน `bytes`):
    `cmd_set_freq(hz, vfo_opt)` (`F  145890000\n` / `F currVFO  145890000\n`), `cmd_get_freq(vfo_opt)`, `cmd_set_split_freq(hz, vfo_opt)` (`I VFOA …` เมื่อมี option),
    `cmd_get_split_freq(vfo_opt)`, `cmd_get_ptt(vfo_opt)`, `cmd_get_dcd(vfo_opt) -> bytes` (`b"\x8b\n"` / `b"\x8b currVFO\n"`),
    `cmd_set_ptt(on: bool, vfo_opt)` (`T 1\n` / `T currVFO 1\n` **ไม่มี `q`** spec §9.1 ข้อ 5),
    `cmd_duplex_split(vfo_up: int, vfo_opt)` (4 แบบ × 2 ตาม ref-R §4.1), `cmd_ft817_split(on: bool, vfo_opt)` (`S 1 VFOB\n`, `S 0 VFOA\n`, `S VFOA 1 VFOB\n`, `S VFOA 0 VFOA\n`),
    `CMD_SET_VFO_OPT = "\\set_vfo_opt 1\n"`, `CMD_CHK_VFO = "\\chk_vfo\n"`, `CMD_AOS = "AOS\n"`, `CMD_LOS = "LOS\n"`, `CMD_AOIQ = "U IQRECORD 1\n"`, `CMD_LOIQ = "U IQRECORD 0\n"`
  - `parse_freq(reply: list[str]) -> float | None` (`RPRT` หรือไม่ใช่ตัวเลข → None), `parse_flag(reply) -> bool` (ตัวเลขฐานอัตโนมัติ == 1 → True)
  - `countdown_text(seconds: float, prefix: str | None) -> str` (`HH:MM:SS` เมื่อ ≥ 1 ชม. ไม่งั้น `MM:SS`; prefix เช่น "AOS in")

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน**

```python
def test_doppler_signs(self):       # f 145.8e6, rr +7 km/s (กำลังห่าง) → doppler_down ≈ −3404.4 (±0.1), doppler_up ≈ +3404.4
def test_radio_freq_formulas(self): # 6 สูตรของ ref-R §3.2: track on/off × down/up และ dial feedback down/up รวม LO ลบ (high-side)
def test_tune_centre(self):         # (435000000, 435100000) → 435050000; (0, 435100000) → None; beacon (145800000, 145800000) → 145800000
def test_lock_normal_and_inverting(self):  # t = {down 145.9–146.0 MHz, up 435.0–435.1 MHz}: normal f_down 145.95 → up 435.05;
                                           # invert True → up 435.05 จาก Δ 0.05 → UP_HIGH − Δ = 435.05; lock_down กลับทางได้ค่าเดิม; ไม่มี up → None
def test_no_passband_limit(self):   # f_down นอก passband (146.2 MHz) → lock_up ยังคืนค่าเชิงเส้น (spec §9.2)
def test_command_strings(self):     # ทุกคำสั่งในตาราง ref-R §4.1 ทั้งมีและไม่มี VFO option ทุกตัวอักษร เช่น cmd_set_freq(145890000, False) == "F  145890000\n",
                                    # cmd_set_freq(1435000000, True) == "F currVFO 1435000000\n", cmd_duplex_split(2, False) == "S 1 VFOB\n",
                                    # cmd_duplex_split(4, True) == "S Main 1 Sub\n", cmd_set_ptt(False, True) == "T currVFO 0\n"
def test_set_freq_rounds_like_printf(self):  # 145890000.4 → "F  145890000\n", 145890000.6 → "F  145890001\n"
def test_parse_freq_and_flag(self): # ["RPRT -1"] → None; ["145890000"] → 145890000.0; parse_flag(["0x1"]) True, (["2"]) False, ([]) False
def test_countdown_text(self):      # 3725 → "01:02:05"; 125 → "02:05"; prefix "LOS in" → "LOS in 02:05"
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**
- [ ] **Step 3: Implement** — สูตรตามตารางของ ref-R §3.2 และ §3.3 (c ใช้ `C_KMS` ของ `observe.py`)
- [ ] **Step 4: รัน test** — ผ่าน
- [ ] **Step 5: Commit** — `feat(gpredict-web): Doppler, LO, transponder lock and rigctld command strings`

### Task 4: Server — `RigController` (state machine และ cycle ของทุกชนิดวิทยุ)

**Files:**
- Modify: `server/gpredict_web/rig.py` (class `RigController`)
- Create: `server/tests/test_rig.py`

**Interfaces:**
- Consumes: Task 1 `HwConf`, `RadioConf`; Task 2 `HamlibClient`, `FakeHamlib`; Task 3 ทั้งหมด
- Produces:
  - `RigController(module: str, hw: HwConf, sats: list[tuple[int, str]], target: int | None, transponders: Callable[[int], list[dict]], timer: bool = True)`
    (ตอนสร้างทำตาม ref-R §2.7: device 1 = วิทยุแรกตามชื่อ, ดาว = target หรือดาวแรก, ถ้ามี target จูน transponder แรก)
  - `async act(body: dict) -> None` — action ตาม spec §8: `engage {on}`, `track {on}`, `lock {on}`, `tune {}`, `satellite {norad}`, `transponder {index}`,
    `device1 {name}`, `device2 {name | "None"}`, `cycle {ms}`, `freq {link: "down" | "up", hz}`, `ptt_toggle {}`; ผิด → `ApiError("CONTROLLER_INVALID", 422, …)`
  - `on_tick(t: datetime, sat: dict | None) -> None` — `sat` คือแถวของดาวเป้าหมายใน tick (az, el, range_km, range_rate_kms, next_aos, next_los) หรือ None
  - `set_target(norad: int) -> None`; `snapshot() -> dict` (schema ด้านล่าง); `async run_cycle() -> None` (หนึ่งรอบ ใช้ใน test เมื่อ `timer=False`);
    `async close() -> None` (disengage ถ้า engage อยู่ แล้ว `hw.save_radio_cycle(device1, cycle)`); `engaged: bool`
  - snapshot: `{"devices": [...], "devices2": ["None", ...], "device1", "device2", "engaged", "track", "lock", "cycle_ms",
    "sats": [{"norad", "name"}], "norad", "transponders": [ชื่อ], "transponder": int | None,
    "down": {"sat_hz", "radio_hz", "doppler_hz": float | None, "lo_mhz"}, "up": {…},
    "az", "el", "range_km", "rate_kms" (float | None), "countdown": str, "space_ptt": bool, "status": str | None}`

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน** — `IsolatedAsyncioTestCase` กับ `FakeHamlib` 1–2 ตัว `timer=False` แล้วเรียก `act`/`on_tick`/`run_cycle` เอง
  เปรียบเทียบ `fake.log` ทั้งรายการทุกตัวอักษร

```python
async def test_initial_state(self):            # ref-R §2.7: knobs = default ของ device 1, Track/Lock/Engage ปิด, countdown "ΔT: 00:00:00";
                                               # devices เรียงชื่อ, devices2 == ["None", *radios_dir_order() ที่ไม่ใช่ RX only] (spec §9.2)
async def test_engage_probes_vfo_option(self): # log เริ่มด้วย [b"\\set_vfo_opt 1\n", b"\\chk_vfo\n"]; fake.vfo_opt "1" → คำสั่งถัดไปมี currVFO
async def test_rx_only_cycle(self):            # track on, rr 7 → F ส่ง f_sat + dd − LO, รอ 5 ms, f อ่านกลับ; รอบถัดไปค่าเดิม → ส่งแค่ f
async def test_threshold_one_hz(self):         # ค่าใหม่ต่างจากที่ส่งล่าสุด 0.9 Hz → ไม่ส่ง F, 1.0 Hz → ส่ง
async def test_dial_feedback(self):            # หลังส่งแล้ว fake.freq เปลี่ยน 500 Hz → sat knob = f_read + LO − dd, ไม่มี F ในรอบนั้น, lock on → uplink ตาม
async def test_tune_suppresses_feedback_one_cycle(self):  # tune แล้วรอบถัดไปไม่อ่าน f ก่อนส่ง (last sent ถูกล้าง)
async def test_tx_only_ptt_none_always_tunes(self):
async def test_half_duplex_switches_on_ptt(self):   # ptt 0 → F downlink; fake.ptt 1 → F uplink และค่าที่ส่งล่าสุดของ downlink ถูกล้าง
async def test_full_duplex(self):              # engage ส่ง "S 1 Sub\n" (VFO Up Sub ไม่มี option) ก่อนรอบแรก; รอบ: F/f แล้ว i, I, i
async def test_ft817_auto(self):               # engage ส่ง "S 1 VFOB\n"; I ส่งเฉพาะรอบแรกและทุก 10 s (patch เวลา) และเมื่อต่าง ≥ 10 Hz, ไม่มี i อ่านกลับ
async def test_ft817_manual_space(self):       # ptt_toggle เมื่อ fake.ptt 0 → I แล้ว "T 1\n"; เมื่อ 1 → "T 0\n"; ไม่มี "q" ใน log (spec §9.1 ข้อ 5)
async def test_space_ignored_for_other_types(self):  # RX only → ptt_toggle ไม่ส่งอะไร
async def test_read_dcd(self):                 # PTT Read DCD → log มี b"\x8b\n"
async def test_dual_rig(self):                 # device2 ตั้ง → F/f ไป fake1, F/f ไป fake2 ตามลำดับของ ref-R §3.4; device2 ใช้ VFO option ของตัวเอง (decision 6)
async def test_device2_same_as_device1_resets(self):  # device2 = ชื่อเดียวกับ device1 → device2 "None"
async def test_device_change_refused_while_engaged(self):   # CONTROLLER_INVALID
async def test_aos_los_signalling(self):       # SIGNAL_AOS/LOIQ เปิด, engage+track: el −1 → +1 → "AOS\n"; +1 → −1 → "U IQRECORD 0\n"; track off → ไม่ส่ง;
                                               # fake ไม่ตอบ AOS → ไม่นับ error
async def test_dead_rigctld_disengages_after_five_cycles(self):  # fake.stop() หลัง engage → 5 รอบ → engaged False, status ภาษาไทยมี "localhost:<port>",
                                                                 # assertLogs "MAX_ERROR_COUNT (5) reached. Disengaging device!"
async def test_skipped_cycles_do_not_queue(self):   # timer=True, Cycle 10 ms, fake.delay_s 0.05 ต่อคำตอบ, รัน 0.3 s → จำนวน F ≤ 4 (ไม่สะสม 30 รอบ)
async def test_disengage_ft817_split_off_then_q(self):  # log ท้าย [b"S 0 VFOA\n", b"q\n"]
async def test_close_saves_cycle(self):        # cycle 2000 แล้ว close() → hw.radio("A").cycle == 2000
async def test_satellite_change_retunes_first_transponder(self):  # transponders() ของดาวใหม่ → sat knob = กลาง passband ของตัวแรก, last sent ล้าง
async def test_on_tick_values(self):           # on_tick(rr 7, el −3, next_aos t+125 s) → doppler_hz, countdown "AOS in 02:05", az/el/range/rate
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**
- [ ] **Step 3: Implement** — ทุกพฤติกรรมตาม ref-R §3.1–§3.7 ยกเว้นข้อที่ spec §9.1 แก้ (timeout, ข้ามรอบ, PTT ไม่มี `q`, FT817 split)
  รอบ cycle เป็น task เดียว: `connect` ทั้งสองอุปกรณ์ → probe VFO option → split set-up (Full-duplex/FT817) → วน `run_cycle` ตามจังหวะของ decision 11
  ทุกรอบ: (1) AOS/LOS (เฉพาะ engage+track) (2) cycle ตามชนิดหรือ dual-rig (3) error ≥ 5 → ปิด socket, `engaged=False`, `status` ไทย
  error +1 ต่อการตั้ง/อ่านความถี่ที่ล้มเหลว (รวม `HamlibError`) reset เป็น 0 เมื่อการตั้งความถี่สำเร็จ ชนิดวิทยุที่ไม่รู้จักทำแบบ RX only พร้อม log
  action มีผลกับ state ทันที (knob, lock) ส่วนคำสั่ง hamlib ไปในรอบถัดไป (spec §8)
- [ ] **Step 4: รัน test ทั้งชุดของ server** — ผ่าน
- [ ] **Step 5: Commit** — `feat(gpredict-web): radio controller with Gpredict's cycle per radio type`

### Task 5: Server — คณิตของ rotator (`rot.py` ส่วนบริสุทธิ์)

**Files:**
- Create: `server/gpredict_web/rot.py` (ส่วนบน), `server/tests/test_rot_math.py`

**Interfaces:**
- Consumes: Task 1 `RotConf`; SP2 `pass_predict.PassData`
- Produces:
  - `wrap_into(az: float, lo: float) -> float` (ห่อทีละ 360 เข้า `[lo, lo + 360)`), `wrap360(az) -> float`
  - `is_flip_pass(azimuths: Sequence[float], conf: RotConf) -> bool` (ref-R §6.3: หน้าต่าง [0, 360] หรือ [−180, 180] เลื่อนด้วย `az_stop − ขอบล่าง`)
  - `adjust(az: float, el: float, conf: RotConf, flip: bool) -> tuple[float, float]` (flip เมื่อ `flip and conf.max_el >= 180` → El 180 − El, Az ±180 แล้วห่อเข้า [MinAz, MaxAz]; แล้ว type 1 กับ Az > 180 → Az − 360)
  - `clamp_to(az, el, conf) -> tuple[float, float]`
  - `setpoint(t: datetime, target: tuple[float, float] | None, p: PassData | None, conf: RotConf, flip: bool, knobs: tuple[float, float], track: bool) -> tuple[float, float]`
    (ref-R §6.2 ตามลำดับของ decision 9; ใต้ขอบฟ้าไม่มี pass หรืออยู่ในช่วง pass → `NO_PASS_SETPOINT` ไม่ clamp)
  - `move_due(setp: tuple[float, float], read: tuple[float, float], threshold: float) -> bool` (เทียบในหน่วยของอุปกรณ์ decision 10)
  - `lead_ahead(t: datetime, los: datetime | None, cycle_s: float, threshold: float, setp: tuple[float, float], predict: Callable[[datetime], tuple[float, float] | None], conf: RotConf, flip: bool) -> tuple[float, float]`
  - `pass_needs_refresh(p: PassData | None, t: datetime, el: float | None, next_aos: datetime | None, cycle_s: float, moved_km: float) -> bool` (ref-R §6.5)
  - `cmd_set_pos(az, el) -> str` (`P 180.00 45.00\n` ด้วย `.` เสมอ), `CMD_GET_POS = "p\n"`, `CMD_STOP = "S\n"`, `parse_pos(reply) -> tuple[float, float] | None`, `parse_rprt(reply) -> int | None`

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน**

```python
def test_setpoint_above_horizon_clamped(self):   # target (350, 95) กับ MaxEl 90 → (350, 90); target (20, 30) กับ MinAz 30 → (30, 30)
def test_setpoint_before_aos_and_after_los(self): # el < 0, t < p.aos → (aos_az, 0); t > p.los → (los_az, 0) (clamp)
def test_setpoint_no_pass_is_0_45(self):          # p None → (0.0, 45.0) แม้ MinEl 10 (ไม่ clamp, spec §9.2)
def test_setpoint_track_off_is_knobs(self):
def test_flip_detection(self):                    # type 0 stop 0: azimuths 350, 10, 30 → True; 100, 150, 200 → False;
                                                  # type 1 stop −180: 170, −170 (=190) → True
def test_flip_applied_only_with_max_el_180(self): # flip True, MaxEl 180: (10, 30) → (190, 150); MaxEl 90 → ไม่เปลี่ยน
def test_minus180_type(self):                     # type 1 MinAz −180 MaxAz 180: target az 270 → −90 (ไม่ถูก clamp เป็น 180, decision 9)
def test_move_due_same_frame(self):               # type 1: setp (−90, 30) read (−90.02, 30.01) threshold 0.1 → False (spec §9.1 ข้อ 13); read (−80, 30) → True
def test_lead_ahead(self):                        # predict เชิงเส้น Az +0.1°/s, threshold 5, cycle 1 s, los t+600 s → ผลอยู่ห่าง setp ≤ 5°
                                                  # และ predict ที่เวลาผล + 1 s อยู่ห่าง > 5° − 0.1 (ค้นละเอียดถึง cycle/4)
def test_lead_ahead_stops_at_horizon(self):       # predict ให้ el < 0 หลัง t+30 s → เวลาผล ≤ t+30 s
def test_lead_ahead_without_pass_uses_20_minutes(self):
def test_pass_needs_refresh_rules(self):          # 4 กติกาของ ref-R §6.5 และ moved_km 1.5 → True, 0.5 → False
def test_command_strings(self):                   # cmd_set_pos(180, 45) == "P 180.00 45.00\n"; cmd_set_pos(-90.0, 0.5) == "P -90.00 0.50\n" (locale de_DE ก็ได้จุด)
def test_parse(self):                             # parse_pos(["180.000000", "45.000000"]) == (180.0, 45.0); ["RPRT -1"] → None; บรรทัดเดียว → None;
                                                  # parse_rprt(["RPRT 0"]) == 0, (["RPRT -5"]) == −5
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**
- [ ] **Step 3: Implement** — lead-ahead (ref-R §6.4 ข้อ 3) เขียนตามนี้ ถ้าขัดกับ ref-R ให้ยึด ref-R

```text
delta = (los − t) ถ้ามี los ไม่งั้น LEAD_DEFAULT
step = max(delta / 2, cycle); best = setp; tt = t + step
วน: step = step / 2; ถ้า step < cycle / 4 หยุด
    p = predict(tt) แล้ว adjust(…, flip)
    ok = p is not None และ 0 ≤ p.el ≤ 180 และ |p.az − setp.az| ≤ threshold และ |p.el − setp.el| ≤ threshold
    ok → best = p; tt = tt + step   ไม่ ok → tt = tt − step
คืน clamp_to(best)
```

- [ ] **Step 4: รัน test** — ผ่าน
- [ ] **Step 5: Commit** — `feat(gpredict-web): rotator set-point, flip pass and lead-ahead`

### Task 6: Server — `RotController` (timer ควบคุมและ client loop)

**Files:**
- Modify: `server/gpredict_web/rot.py` (class `RotController`)
- Create: `server/tests/test_rot.py`

**Interfaces:**
- Consumes: Task 1, 2, 5; SP2 `PassData`, `pass_to_dict`
- Produces:
  - `RotController(module: str, hw: HwConf, sats: list[tuple[int, str]], target: int | None, predict: Callable[[int, datetime], tuple[float, float] | None], pass_for: Callable[[int, datetime], tuple[str, PassData | None]], timer: bool = True)`
    (`predict`, `pass_for` เป็นฟังก์ชัน sync ที่ controller เรียกผ่าน `asyncio.to_thread`)
  - `async act(body)` — `engage {on}`, `track {on}`, `monitor {on}`, `satellite {norad}`, `device {name}`, `cycle {ms}`, `threshold {deg}`, `az {deg}`, `el {deg}`
    (`az`/`el` ถูก clamp เข้าช่วงของอุปกรณ์; กดไม่ได้ตาม ref-R §6.1 → `CONTROLLER_INVALID`)
  - `on_tick(t: datetime, sat: dict | None, qth: tuple[float, float]) -> None`; `set_target(norad)`; `snapshot() -> dict`
  - `async control_tick() -> None`, `async client_once() -> None` (ใช้ใน test เมื่อ `timer=False`), `async close() -> None` (disengage แล้ว `hw.save_rotator_runtime`)
  - snapshot: `{"devices", "device", "engaged", "track", "monitor", "monitor_enabled", "knobs_enabled", "cycle_ms", "threshold_deg",
    "sats", "norad", "knob": {"az", "el"}, "limits": {"min_az", "max_az", "min_el", "max_el", "az_type"}, "target": {"az", "el"} | None,
    "countdown": str, "read": {"az": str, "el": str}, "setpoint": {"az", "el"}, "rotor": {"az", "el"} | None, "pass": dict | None, "status": str | None}`
    (`read` เป็นข้อความพร้อมแสดง: `" --- "` ตอนเริ่ม, `"%.2f°"` ห่อ 0–360, `"ERROR"`, `"---"` หลัง disengage ตาม ref-R §5.3)

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน**

```python
async def test_initial_knobs_and_read(self):      # knob 180/45 ก่อนโหลดอุปกรณ์, หลังโหลด limits ตามไฟล์, read " --- ", countdown "00:00:00"
async def test_preview_when_not_engaged(self):    # track on, target (120, 30) → control_tick → knob == (120, 30) ไม่มีคำสั่งใน fake.log
async def test_client_loop_sends_p_then_reads(self):   # engage, control_tick (ต่างเกิน threshold) แล้ว client_once → log [b"P 120.00 30.00\n", b"p\n"]
async def test_client_loop_min_period(self):      # timer=True รัน 2.0 s → จำนวน "p\n" ≤ 3 ไม่ขึ้นกับ Cycle 10 ms (spec §9.2)
async def test_threshold_blocks_small_moves(self):  # read ห่าง setp 0.05° threshold 0.1 → ไม่มี P ใหม่
async def test_monitor_reads_only(self):          # monitor on → client_once ส่งแค่ "p\n"
async def test_monitor_enabled_follows_track_and_engage(self):  # engage on → monitor_enabled False ทันทีแม้ไม่กด Track (spec §9.1 ข้อ 15)
async def test_unreachable_rotctld_shows_error_and_disengages(self):  # ไม่มี fake ฟังที่ port → read "ERROR" และ 5 control_tick → engaged False, status ไทย (spec §9.1 ข้อ 12)
async def test_disengage_sends_s_then_q(self):    # log ท้าย [b"S\n", b"q\n"], read "---"
async def test_one_timer(self):                   # timer=True Cycle 100 ms 1.0 s → control tick 9–11 ครั้ง (spec §9.1 ข้อ 16)
async def test_pass_refresh_and_plot(self):       # pass_for คืน ("computing", None) แล้ว ("ok", P) → snapshot["pass"] == pass_to_dict(P); ดาวใหม่ → ขอใหม่
async def test_close_saves_cycle_and_threshold(self):
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**
- [ ] **Step 3: Implement** — timer ควบคุมทำงานตั้งแต่สร้าง (ทุก Cycle) ตามลำดับของ ref-R §6.4 ข้อ 1–5 โดยเรียก `lead_ahead` ผ่าน `asyncio.to_thread`
  client loop เริ่มเมื่อ Engage: (1) มีเป้าใหม่และ Monitor ปิด → `P` (ล้มเหลวเก็บไว้รอบหน้า) (2) รอ `ROT_SETTLE_S` (3) `p` (4) เก็บตำแหน่งและธง error
  (5) พักให้ทั้งรอบไม่น้อยกว่า `ROT_LOOP_MIN_S` ต่อไม่ได้ตั้งธง error และลองต่อใหม่รอบถัดไป
  pass: เมื่อ `pass_needs_refresh` เป็นจริงเรียก `pass_for` (ผ่าน thread) จนได้ `ok` แล้วตรวจ flip ใหม่จาก `[aos_az, *แถว az, los_az]`
- [ ] **Step 4: รัน test ทั้งชุดของ server** — ผ่าน
- [ ] **Step 5: Commit** — `feat(gpredict-web): rotator controller with Gpredict's control timer and client loop`

### Task 7: Server — `trsp.py`, `POST /api/trsp/update` และ `GET /api/trsp/{norad}`

**Files:**
- Create: `server/gpredict_web/trsp.py`, `server/tests/test_trsp.py`, `server/tests/fixtures/satnogs_modes.json`, `server/tests/fixtures/satnogs_transmitters.json`
- Modify: `server/gpredict_web/app.py`
- Test: `server/tests/test_api.py` (class `TrspApiTest`)

**Interfaces:**
- Produces (ชื่อเหล่านี้งานย่อยที่ 4 ใช้):
  - `SATNOGS_API = "https://db.satnogs.org/api/"`, `MODES_URL`, `TRANSMITTERS_URL`, `USER_AGENT = "gpredict-web"`
  - `convert(modes: list, transmitters: list) -> dict[int, list[dict]]` (ref-R §11.3 ทุกข้อ ผลแต่ละตัว `{name, up_low, up_high, down_low, down_high, invert, mode, baud}`)
  - `normalise(t: dict) -> dict` (ref-R §10.1: ค่าติดลบเป็น 0, มีค่าเดียวในคู่คัดลอกไปอีกค่า)
  - `load_transponders(data_dir: Path, norad: int) -> list[dict]` (ไม่มีไฟล์ → `[]`; ผ่าน `normalise` ทุกตัว ตามลำดับในไฟล์)
  - `@dataclass TrspUpdateResult(cached: bool, fetched_at: datetime | None, satellites: int, messages: list[Message])`
  - `update_from_network(data_dir: Path, now: datetime, opener=urlopen) -> TrspUpdateResult`
  - `POST /api/trsp/update` → `{"status": "Finished", "cached", "fetched_at", "satellites", "messages"}`;
    `GET /api/trsp/{norad}` → `{"norad": n, "transponders": [...]}`

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน** — fixture JSON ตัวอย่างเล็กที่มีกรณีของ ref-R §11.3 ครบ (ไม่มี description, mode ชื่อยาว 25, alive false,
  ค่าความถี่ 0/null, invert true, baud, norad_cat_id null, ดาวสองดวง)

```python
def test_convert(self):                 # ข้าม transmitter ไม่มี description; name ตัดที่ 79; mode ตัดที่ 19; mode_id ไม่เจอ → เลขเป็นข้อความ;
                                        # alive false ยังอยู่; ค่าความถี่ ≤ 0 หรือ null → 0; ลำดับตาม JSON; norad_cat_id null ถูกข้าม
def test_normalise(self):               # down_low 145800000 down_high 0 → ทั้งคู่ 145800000; up_low −5 → 0
def test_update_writes_per_satellite(self):     # opener ปลอมคืน fixture → data/trsp/25544.json; ดาวที่ไม่อยู่ในข้อมูลใหม่คงไฟล์เดิม
def test_user_agent_and_urls(self):     # opener ได้ Request ที่ URL modes ก่อน transmitters, header User-Agent "gpredict-web", timeout 30, ไม่มี header อื่นที่มีข้อมูลผู้ใช้
def test_two_hour_rule_uses_cache(self):  # เรียกครั้งที่สองที่ now + 1 ชม. → opener ไม่ถูกเรียก, cached True, fetched_at = ครั้งแรก; now + 2 ชม. 1 วินาที → เรียก
def test_failure_keeps_old_files(self):   # opener raise URLError → ไฟล์เดิมและ _cache เดิมไม่หาย, messages มี TRSP_DOWNLOAD_FAILED level warning ข้อความไทย
def test_bad_json_keeps_old_files(self):  # opener คืน b"<html>" → แบบเดียวกับข้างบน
def test_failure_still_counts_for_two_hours(self):  # ล้มเหลวที่ T แล้วขอที่ T + 10 นาที → ไม่ส่ง request (ใช้ cache เดิมถ้ามี)
def test_load_missing_file(self):       # load_transponders(norad ไม่มีไฟล์) == []
```

ใน `test_api.py`: `test_trsp_update_route`, `test_get_trsp_route_shape`

- [ ] **Step 2: รันให้เห็นว่าล้ม**
- [ ] **Step 3: Implement** — `data/trsp/_cache/state.json` เก็บ `requested_at` (บันทึกก่อนส่ง request) และ `succeeded_at`
  ดาวน์โหลดลงไฟล์ชั่วคราวแล้ว rename เข้า `_cache/modes.json`, `_cache/transmitters.json` เมื่อสำเร็จทั้งคู่เท่านั้น
  ภายใน 2 ชม. แปลงจาก `_cache` เดิม (ถ้ามี) แล้วเขียนผล log ข้อความของ ref-R §11.2 ข้อความไทยของผลบอกเวลาที่ดึงและเวลาที่ดึงได้อีกครั้ง
  route ใช้ `threading.Lock` (decision 13) และ `asyncio.to_thread`
- [ ] **Step 4: รัน test ทั้งชุดของ server** — ผ่าน
- [ ] **Step 5: Commit** — `feat(gpredict-web): SatNOGS transponder update with a two-hour limit`

### Task 8: Server — `ControllerHub`, เป้าหมายของ module และ tick ที่ทำงานต่อเมื่อมี controller

**Files:**
- Create: `server/gpredict_web/controllers.py`, `server/tests/test_controllers.py`
- Modify: `server/gpredict_web/runtime.py` (`ModuleRuntime.sat_names`, `ModuleRuntime.azel_at`), `server/gpredict_web/app.py` (`Ticks`, `_compute_round`),
  `server/gpredict_web/pass_service.py` (`PassService.current_pass`)
- Test: `server/tests/test_ws.py`, `server/tests/test_pass_service.py`, `server/tests/test_runtime.py`

**Interfaces:**
- Consumes: Task 4 `RigController`, Task 6 `RotController`, Task 7 `load_transponders`; SP2 `PassService`, `ensure_days`, `days_status`, `get_days`, `find_passes`, `get_pass`, `describe`, `has_aos`, `day_range`
- Produces:
  - `ModuleRuntime.sat_names() -> list[tuple[int, str]]` (เรียงตามชื่อด้วย key ของ decision 17), `ModuleRuntime.azel_at(norad: int, t: datetime) -> tuple[float, float] | None` (ใช้ช่วงคำนวณปัจจุบัน; นอกช่วงที่ใช้ได้ → None)
  - `PassService.current_pass(owner: str, module: str, norad: int, t: datetime) -> tuple[str, PassData | None]`
    (ไม่รอ: `ensure_days(owner, [spec], *day_range(t, t + ROT_PASS_DAYS + 1 วัน))` → `days_status` → `get_pass(find_passes(…), t, ROT_PASS_DAYS, 0.0)` → `describe`;
    `has_aos` เท็จ → `("ok", None)`)
  - `ControllerHub(hub: Hub, hw: HwConf, data_dir: Path, passes: PassService, wake: Callable[[str], None])`:
    `active(module) -> bool`, `open_list() -> list[dict]` (`[{"module", "kind": "radio" | "rotator"}]`), `target(module) -> int | None`,
    `async set_target(module, norad)`, `async open(module, kind)`, `async close(module, kind)`, `async close_module(module)`,
    `async act(module, kind, body) -> dict` (snapshot ใหม่), `on_tick(module, tick: dict) -> dict` (`{"radio": …, "rotator": …}` เฉพาะตัวที่เปิด), `async shutdown()`
  - `Ticks(hub, keep_alive: Callable[[str], bool] = lambda n: False, decorate: Callable[[str, dict], dict] | None = None)`, `Ticks.wake(name) -> None`
    (producer ทำงานขณะมี socket **หรือ** `keep_alive(name)`; `_compute_round` คืน `(tick_dict, data_ms)`; `decorate` เรียกใน event loop; JSON ใน thread)

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน**

```python
# test_controllers.py (IsolatedAsyncioTestCase, Hub + EphemManager ปลอมแบบ test_runtime, FakeHamlib)
async def test_open_without_radio_is_409(self):      # ไม่มี .rig.json → ApiError NO_RADIO_CONFIG 409; rotator → NO_ROTATOR_CONFIG
async def test_open_twice_keeps_one(self):           # open สองครั้ง → open_list มี radio ครั้งเดียว
async def test_initial_target(self):                 # set_target(m, 25544) ก่อน open → snapshot norad 25544; ไม่มี target → ดาวแรกตามชื่อ
async def test_target_switches_both(self):           # เปิดทั้งสอง แล้ว set_target → ทั้งสอง norad ใหม่; norad ไม่อยู่ใน module → 404 NOT_FOUND
async def test_on_tick_passes_target_row(self):      # tick ที่มี sats → on_tick คืน {"radio": snapshot} ที่มี doppler_hz จาก range_rate_kms ของแถวนั้น
async def test_close_module_disengages_and_saves(self):   # engage ทั้งสอง → close_module → rotator fake log ท้าย [b"S\n", b"q\n"], radio มี b"q\n", ไฟล์ได้ Cycle ปัจจุบัน
async def test_shutdown_closes_all(self):
# test_ws.py
def test_controller_runs_without_socket(self):       # เปิด radio แล้วไม่มี WebSocket → producer ทำงาน (Ticks.producers มีชื่อ) และ on_tick ถูกเรียก
def test_tick_has_radio_and_rotator(self):           # socket ได้ tick ที่มี key "radio" เมื่อเปิด และไม่มีเมื่อปิด
# test_runtime.py
def test_sat_names_sorted(self):                     # ดาว "ISS", "beidou 10", "Beidou 2" → Beidou 2, beidou 10, ISS (แบบ satChoices ของ web)
def test_azel_at(self):                              # ภายในช่วงได้ค่าเดียวกับ observe ที่เวลานั้น; นอกช่วงที่ใช้ได้ → None; NORAD ไม่อยู่ใน module → 404
# test_pass_service.py
def test_current_pass_nonblocking(self):             # ครั้งแรก ("computing", None); หลัง drain ("ok", PassData) ที่ aos ≤ t + 3 วัน และ min_el 0
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**
- [ ] **Step 3: Implement** — `RigController` ได้ `sats=rt.sat_names()`, `transponders=lambda n: load_transponders(data_dir, n)`
  `RotController` ได้ `predict=rt.azel_at`, `pass_for=lambda n, t: passes.current_pass(f"rot:{module}", module, n, t)`
  `open` เรียก `wake(module)` ให้ producer เริ่มแม้ไม่มี socket `close`/`close_module` ของ rotator เรียก `ephem.release_days(f"rot:{module}")`
  `on_tick` ส่งแถวของดาวเป้าหมายใน `tick["sats"]` (None ถ้าไม่มี) เวลา `tick["t"]` และ QTH (lat, lon) ให้ controller
- [ ] **Step 4: รัน test ทั้งชุดของ server** — test เดิมของ `Ticks` ผ่านโดยไม่แก้
- [ ] **Step 5: Commit** — `feat(gpredict-web): controller hub with module targets and keep-alive ticks`

### Task 9: Server — REST ของ controller และอายุของ controller

**Files:**
- Modify: `server/gpredict_web/app.py`
- Test: `server/tests/test_api.py` (class `ControllerApiTest` ใช้ `FakeHamlib`)

**Interfaces:**
- Consumes: Task 8 `ControllerHub`
- Produces:
  - `GET /api/controllers` → `{"open": [{"module", "kind"}]}`
  - `POST /api/modules/{name}/target` `{norad}` → 204
  - `POST /api/modules/{name}/radio/open`, `/radio/close`, `/rotator/open`, `/rotator/close` → `{"open": [...]}`
  - `POST /api/modules/{name}/radio`, `/rotator` `{action, ...}` → `{"radio": snapshot}` / `{"rotator": snapshot}`
  - `PUT /api/modules/{name}` → 409 `CONTROLLER_ACTIVE` เมื่อ controller เปิดอยู่และ `qth` หรือ `satellites` เปลี่ยน (decision 4)
  - ปิด module, ลบ module และปิด server เรียก `controllers.close_module` / `controllers.shutdown` ก่อน `hub.close` และ `ticks.shutdown`

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน**

```python
def test_every_radio_action(self):           # ทุก action ของ spec §8 ตอบ 200 และ snapshot เปลี่ยนตาม (engage/track/lock/tune/satellite/transponder/device1/device2/cycle/freq/ptt_toggle)
def test_every_rotator_action(self):
def test_invalid_action_is_422(self):        # action ไม่รู้จัก, freq hz −1 หรือ 10_000_000_000, cycle 5, threshold 60, link "side" → CONTROLLER_INVALID
def test_action_on_closed_controller_is_404(self):
def test_open_without_config_is_409(self):   # NO_RADIO_CONFIG, NO_ROTATOR_CONFIG
def test_configure_blocked_while_active(self):   # PUT module ที่เปลี่ยน satellites หรือ qth → 409 CONTROLLER_ACTIVE, ไฟล์ module ไม่เปลี่ยน
def test_put_module_view_change_allowed_while_active(self):  # PUT ที่เปลี่ยน ground_track / single.selected / map.track_orbits → 200
def test_close_module_closes_controllers(self):   # POST close → open_list ว่าง, fake log มี q
def test_delete_module_closes_controllers(self):
def test_shutdown_disengages(self):          # ออกจาก TestClient context (lifespan จบ) → rotator log ท้าย [b"S\n", b"q\n"]
def test_target_route(self):                 # 204; norad ไม่ใช่ int → CONTROLLER_INVALID; ไม่อยู่ใน module → 404
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**
- [ ] **Step 3: Implement** — route async เรียก `ControllerHub` ใน event loop เดียวกับ controller lifespan: `await controllers.shutdown()` ก่อน `await ticks.shutdown()`
  ข้อความไทยของ 409 บอกให้ปิด Radio Control และ Antenna Control ของ module ก่อน
- [ ] **Step 4: รัน test ทั้งชุดของ server** — ผ่าน
- [ ] **Step 5: Commit** — `feat(gpredict-web): controller API and lifecycle with modules and quit`

### Task 10: Web — Preferences → Interfaces (Radios, Rotators และ editor)

**Files:**
- Create: `web/src/radio/types.ts`, `web/src/radio/radioApi.ts`, `web/src/radio/hwconfForm.ts`, `web/src/radio/hwconfForm.test.ts`,
  `web/src/radio/InterfacesPages.tsx`, `web/src/radio/RadioEditor.tsx`, `web/src/radio/RotatorEditor.tsx`
- Modify: `web/src/prefs/prefGroups.ts` (กลุ่ม `interfaces`: ใส่ `page`, ลบ `later`), `web/src/styles.css`

**Interfaces:**
- Consumes: SP2 `PrefsPageApi` (`onCommit`), `PREF_GROUPS`, `Modal`
- Produces (ชื่อเหล่านี้งานย่อยที่ 4 ใช้):
  - `types.ts`: `RadioConf` (key ของ Gpredict + `name`), `RotatorConf`, `HwConf { radios: RadioConf[]; rotators: RotatorConf[] }`,
    `Transponder { name; up_low; up_high; down_low; down_high; invert: boolean; mode: string; baud: number }`,
    `RadioState`, `RotatorState` (schema ของ Task 4 และ 6), `ControllerKind = "radio" | "rotator"`, `ControllerRef { module: string; kind: ControllerKind }`
  - `radioApi.ts`: `getHwconf()`, `putHwconf(h: HwConf)`, `getTransponders(norad: number): Promise<Transponder[]>`, `updateTransponders()`,
    `postTarget(module, norad)`, `getControllers(): Promise<ControllerRef[]>`, `openController(module, kind)`, `closeController(module, kind)`,
    `controllerAction(module, kind, body: Record<string, unknown>): Promise<RadioState | RotatorState>` (แกะ snapshot จาก key `radio`/`rotator` ของคำตอบ)
  - `hwconfForm.ts` (pure): `RADIO_COLUMNS` (15 ชื่อ ref-R §8.1), `radioCells(r: RadioConf): string[]`, `ROTATOR_COLUMNS` (8), `rotatorCells(r): string[]`,
    `ADD_NEW_RADIO`, `CLEAR_RADIO`, `ADD_NEW_ROTATOR`, `CLEAR_ROTATOR` (ค่าในหน่วยที่ editor แสดง), `onTypeChange`, `onPttChange`, `onVfoChange` (กติกาความสอดคล้อง ref-R §8.2),
    `vfoComboIndex(r)`, `vfoFromCombo(i)`, `azTypePreset(t: 0 | 1)`, `cleanName(s)`, `nameClash(list, name, editing: string | null): boolean`,
    `editorToRadio(form): RadioConf`, `radioToEditor(r): RadioForm` (MHz ↔ Hz; port ≤ 1023 แสดง 4532, rotator 4533)

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน**

```ts
it("radio table cells", ...)        // Type 5 → "FT817/857/897 (man)"; PTT 1 → "PTT", 2 → "DCD"; VFO 1 → "VFO A", 0 → "-"; LO 0 → "0.000 MHz"; signals → "YES"/"NO"
it("rotator table cells", ...)      // "0°", "360°", az type 0 → "0° → 180° → 360°", 1 → "-180° → 0° → +180°", 7 → "Unknown (7)"
it("add new radio defaults", ...)   // Default downlink 0.000, Default uplink 123.456 (spec §9.2)
it("clear radio values", ...)       // localhost, 4532, 145.890/145.890, RX only, None, Not applicable, signals off
it("type and ptt rules", ...)       // Half-duplex + None → Read PTT; None ขณะ Half-duplex → Read PTT; FT817 ทั้งสอง → Read PTT;
                                    // Full-duplex + Not applicable → "MAIN ↑ / SUB ↓"; Not applicable ขณะ Full-duplex → กลับ
it("vfo combo mapping", ...)        // index 1 → up Main(3)/down Sub(4); 3 → up A(1)/down B(2); ไม่ใช่ Full-duplex → ไม่เก็บ VFO
it("az type presets", ...)          // 0 → 0/360/0; 1 → −180/180/−180
it("name rules", ...)               // cleanName("IC 910!") == "IC910"; ยาวไม่เกิน 25; nameClash ไม่สนตัวพิมพ์ และไม่ชนกับตัวที่กำลังแก้
it("LO is whole MHz", ...)          // editorToRadio LO 145.5 → ปัดเป็นจำนวนเต็ม MHz ตาม spin 0 ทศนิยม (spec §9.2)
it("double click opens one editor", ...)  // reducer ของหน้า: dblclick ระหว่างที่ editor เปิดอยู่ไม่เปิดเพิ่ม (spec §9.1 ข้อ 2)
```

- [ ] **Step 2: รันให้เห็นว่าล้ม** — `npm test`
- [ ] **Step 3: Implement** — หน้า "Radios"/"Rotators" ตาม ref-R §8.1, §8.3 (ตารางเรียงตามชื่อ ปุ่ม "Add new"/"Add New", "Edit", "Delete" พร้อม tooltip
  ข้อความเมื่อไม่ได้เลือกแถวเป็นกล่อง `Modal` ตาม ref-R) editor เป็น `Modal` ชื่อ "Edit radio configuration"/"Edit rotator configuration"
  ปุ่ม "Clear", "Cancel", "Ok" (Ok กดไม่ได้เมื่อชื่อว่าง) ชื่อซ้ำแสดงข้อความไทยใต้ช่องและกด Ok ไม่ได้ (ของเรา)
  หน้าโหลด `getHwconf()` ครั้งแรกที่แสดง ลงทะเบียน `api.onCommit(() => putHwconf(draft))` ครั้งเดียวต่อการเปิด Preferences และส่งเฉพาะเมื่อมีการแก้
  ร่างที่แก้อยู่ใน state ของหน้า (หน้าต้องไม่ถูก unmount ระหว่างสลับกลุ่ม ดูข้อกำหนดถึง SP2 Task 7)
- [ ] **Step 4: รัน** — `npm test`, `npm run build`
- [ ] **Step 5: Commit** — `feat(gpredict-web): Interfaces preferences for radios and rotators`

### Task 11: Web — ปุ่มหมุนความถี่และปุ่มหมุนมุม

**Files:**
- Create: `web/src/radio/freqKnob.ts`, `web/src/radio/freqKnob.test.ts`, `web/src/radio/FreqKnob.tsx`, `web/src/radio/rotKnob.ts`, `web/src/radio/rotKnob.test.ts`, `web/src/radio/RotKnob.tsx`

**Interfaces:**
- Produces:
  - `freqDigits(hz: number): string[]` (10 ตัวจาก `%10.0f` ของค่าสัมบูรณ์ เลขศูนย์นำหน้าเป็นช่องว่าง), `freqStep(index: number): number` (10^(9 − index)),
    `freqApply(hz: number, index: number, dir: 1 | -1): number | null` (นอกช่วง 0–9 999 999 999 → null), `groupSeparator(locale?: string): string`,
    `freqText(hz, sep): string` (เช่น `" 145,890,000 Hz"`, `"1435,000,000 Hz"`)
  - `FreqKnob({ hz, active, onChange(hz) })` ปุ่ม ▴/▾ คลิกซ้าย/ขวา และล้อเมาส์ (ซ้าย/ขึ้น +, ขวา/ลง −, กลางไม่ทำอะไร) tooltip `Use mouse buttons and wheel to change value`
  - `rotDigits(v: number): { sign: string; digits: string }` (`"-"` หรือ `" "` แล้ว `%6.2f` ของค่าสัมบูรณ์), `ROT_STEPS = [100, 10, 1, 0.1, 0.01]`,
    `rotArrow(v, step, dir, min, max): number | null` (เกินขอบ > 0.005 → null, เกินไม่ถึง → clamp), `rotMouse(v, step, dir, min, max): number` (clamp)
  - `RotKnob({ value, min, max, enabled, onChange(v) })`

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน**

```ts
it("ten digits with blanks", ...)     // freqDigits(145890000) == [" ","1","4","5","8","9","0","0","0","0"]
it("no separator after the GHz digit", ...)  // freqText(1435000000, ",") == "1435,000,000 Hz"; freqText(145890000, ",") == " 145,890,000 Hz"
it("separator from the locale", ...)  // groupSeparator("de-DE") == "."; groupSeparator("en-US") == ","
it("steps and range", ...)            // freqApply(9_999_999_999, 9, 1) == null; freqApply(0, 0, -1) == null; freqApply(145890000, 9, 1) == 145890001
it("rot digits", ...)                 // rotDigits(-5.5) == {sign: "-", digits: "  5.50"}; rotDigits(180) == {sign: " ", digits: "180.00"}
it("rot arrow ignores overshoot, clamps small", ...)  // rotArrow(355, 10, 1, 0, 360) == null; rotArrow(359.996, 0.01, 1, 0, 360) == 360
it("rot mouse clamps", ...)           // rotMouse(355, 10, 1, 0, 360) == 360
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**
- [ ] **Step 3: Implement** — ตามตารางของ ref-R §2.3 และ §5.2 ตัวเลขใหญ่ (xx-large) ใช้ CSS class เดียวกันทั้งสองปุ่ม
- [ ] **Step 4: รัน** — `npm test`
- [ ] **Step 5: Commit** — `feat(gpredict-web): frequency and rotator knobs`

### Task 12: Web — หน้าต่าง Radio Control

**Files:**
- Create: `web/src/radio/radioView.ts`, `web/src/radio/radioView.test.ts`, `web/src/radio/RadioControl.tsx`
- Modify: `web/src/types.ts` (`Tick.radio?: RadioState`, `Tick.rotator?: RotatorState`), `web/src/styles.css`

**Interfaces:**
- Consumes: Task 10 `controllerAction`, `RadioState`; Task 11 `FreqKnob`
- Produces:
  - `radioView.ts` (pure): `fmtDoppler(hz: number | null): string` (`"---- Hz"` เมื่อ null, ไม่งั้น `%.0f Hz`), `fmtLo(mhz): string` (`%.0f MHz`),
    `fmtAngle(v: number | null): string` (`%7.2f°`), `fmtRange(km)`, `fmtRate(kms)` (`%.0f km`, `%.3f km/s`), `filterSats(sats, text): {norad, name}[]`,
    `ellipsize(name: string, max = 30): string`, `RADIO_TOOLTIPS` (ทุก tooltip ของ ref-R §2.2–§2.6 ทุกตัวอักษร)
  - `RadioControl({ module, state, onAction(body), onClose })` — `FloatingWindow` ชื่อ `Gpredict Radio Control: <module>` grid ตาม spec §4.1

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน**

```ts
it("read-out formats", ...)   // fmtAngle(0) == "   0.00°"; fmtDoppler(null) == "---- Hz"; fmtDoppler(-3404.4) == "-3404 Hz"; fmtRate(7.1234) == "7.123 km/s"
it("filter", ...)             // filterSats([ISS, "SO-50"], "iss") == [ISS]; ข้อความว่าง → ทุกดวง
it("uplink doppler tooltip keeps Gpredict's word", ...)   // RADIO_TOOLTIPS.upDoppler มีคำว่า "downlink" (ref-R §13 ข้อ 17)
it("device 1 tooltip has no space after the dot", ...)    // "Select primary radio device.This device …"
it("transponder names are cut at 30", ...)
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**
- [ ] **Step 3: Implement** — ทุกการกดส่ง `onAction` (knob → `{action: "freq", link, hz}`) แล้วแสดง snapshot ที่ได้ทันที จากนั้นตาม tick
  ช่อง "Filter..." กรองแล้วเลือกดาวแรกที่ตรง (ref-R §2.4) combo อุปกรณ์กดไม่ได้ระหว่าง Engage
  SPACE ขณะหน้าต่างมี focus และ `space_ptt` เป็นจริงส่ง `{action: "ptt_toggle"}` (`preventDefault` เพื่อไม่ให้กดปุ่มที่ focus อยู่)
  บรรทัดสถานะไทยท้ายหน้าต่างแสดง `status` (ของเรา)
- [ ] **Step 4: รัน** — `npm test`, `npm run build`
- [ ] **Step 5: Commit** — `feat(gpredict-web): radio control window`

### Task 13: Web — หน้าต่าง Antenna Control

**Files:**
- Create: `web/src/radio/rotView.ts`, `web/src/radio/rotView.test.ts`, `web/src/radio/RotatorControl.tsx`

**Interfaces:**
- Consumes: Task 10 `RotatorState`, Task 11 `RotKnob`; SP2 `passPolarScene`, `PassPolarPlot` (หรือ hook วาดของมัน); core `views/polarGeom.ts` (`polarRadius`, `azElToXY`), `colors.ts` (`POLAR_COLORS.satellite`)
- Produces:
  - `rotMarkers(state: RotatorState, size: {width, height}, orientation: Orientation): { target: {x, y} | null; setpoint: {x, y}; rotor: {x, y} | null }`
    (Az ลบของอุปกรณ์ −180…+180 บวก 360 ก่อนวาด; target ซ่อนเมื่อ El < 0; rotor แสดงเฉพาะ engage และไม่ error)
  - `ROT_TOOLTIPS` (ref-R §5.4–§5.5 ทุกตัวอักษร)
  - `RotatorControl({ module, state, orientation, qthName, onAction(body), onClose })` — `FloatingWindow` ชื่อ `Gpredict Rotator Control: <module>` Polar plot ซ้าย grid ขวา (spec §5.1)

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน**

```ts
it("markers on the plot", ...)       // setpoint (90, 0) บน canvas 200×200 N/E/S/W → จุดที่ขอบขวาของวง r = 80; target El −1 → null
it("negative azimuth shifted", ...)  // az_type 1 setpoint (−90, 0) → ตำแหน่งเดียวกับ (270, 0)
it("rotor only while engaged without error", ...)
it("monitor and knobs enabled flags come from the server", ...)  // ใช้ monitor_enabled / knobs_enabled ของ snapshot ตรงๆ
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**
- [ ] **Step 3: Implement** — plot ใช้ `passPolarScene(state.pass, …)` (pass เป็น null ได้: วาดเฉพาะวงและทิศ) แล้ววาดเครื่องหมายทับ:
  target สี่เหลี่ยมทึบ 4×4 px, set-point วงกลมรัศมี 7 px (เส้น), rotor กากบาท 4 เส้นยาว 10 px ห่างจุด 4–14 px สีทั้งหมด `POLAR_COLORS.satellite`
  ช่อง "Read:" (Az) และ "Read: " (El) แสดง `state.read` ตามตัวอักษร
- [ ] **Step 4: รัน** — `npm test`, `npm run build`
- [ ] **Step 5: Commit** — `feat(gpredict-web): antenna control window`

### Task 14: Web — เมนู หน้าต่าง controller ทุกแท็บ เป้าหมาย Configure ที่ถูกห้าม และ Update transponder data

**Files:**
- Create: `web/src/radio/controllerWindows.ts`, `web/src/radio/controllerWindows.test.ts`, `web/src/radio/ControllerWindows.tsx`, `web/src/radio/TrspUpdateDialog.tsx`
- Modify: `web/src/later.ts` (+test: ลบ "Radio Control", "Antenna Control", "Update transponder data"), `web/src/moduleMenu.ts` (+test), `web/src/menus.ts` (+test),
  `web/src/dialogs.ts`, `web/src/components/Dialogs.tsx`, `web/src/App.tsx`

**Interfaces:**
- Consumes: Task 10 `radioApi`, Task 12 `RadioControl`, Task 13 `RotatorControl`; core `useModuleSocket`; SP2 `Modal`
- Produces:
  - `ModuleAction` เพิ่ม `{ type: "radio" }`, `{ type: "rotator" }`; `BarAction` เพิ่ม `"updateTrsp"`; `Dialog` เพิ่ม `{ kind: "trsp" }`
  - `controllerWindows.ts` (pure): `mergeOpen(list: ControllerRef[], ref): ControllerRef[]`, `dropModule(list, module)`, `NO_CONFIG_TEXT: Record<ControllerKind, string>` (ข้อความ ERROR ของ ref-R §1),
    `CONFIGURE_BLOCKED_TEXT` (ข้อความของ spec §4.6 ทุกตัวอักษร)
  - `ControllerWindows({ refs, onClosed(ref) })` — แต่ละหน้าต่างเรียก `useModuleSocket(module)` ของตัวเอง

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน**

```ts
it("module menu enables Radio Control and Antenna Control", ...)  // outline ไม่มี "(later 3)"
it("Edit menu enables Update transponder data", ...)
it("restores controller windows from GET /api/controllers", ...)  // getControllers ปลอมคืน 2 รายการ → state มี 2 หน้าต่าง
it("drops a window when its tick has no controller or the socket closed with 1000", ...)
it("no-config error texts", ...)       // NO_CONFIG_TEXT.radio == "You have no radio configuration!\nPlease configure a radio first."
it("configure blocked text", ...)      // "A module can not be configured while the radio or rotator controller is active.\n\nPlease close the radio and rotator controllers and try again."
it("posts the target when the selection changes", ...)  // เปลี่ยน selection ของ module → postTarget(module, norad) ครั้งเดียว; null ไม่ส่ง
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**
- [ ] **Step 3: Implement**
  - Module menu → Radio Control / Antenna Control: `openController` สำเร็จ → เพิ่มหน้าต่าง (มีอยู่แล้ว → ยกขึ้นหน้า) 409 `NO_*_CONFIG` → `Modal` ชื่อ "ERROR" ข้อความของ ref-R §1 ปุ่ม OK
  - Configure ขณะ module มีหน้าต่าง controller → `Modal` ไม่มีชื่อ ข้อความ `CONFIGURE_BLOCKED_TEXT` ปุ่ม OK (ไม่เปิด Edit module)
  - App ส่ง `postTarget` เมื่อ selection ของ module เปลี่ยน (รวม Select satellite และ Autotrack)
  - ปิดหน้าต่าง → `closeController` แล้ว `getControllers` ใหม่
  - Edit → Update transponder data: `Modal` ชื่อ "Transponder Update" ข้อความ `<b>Updating transponder files from network</b>` (ตัวหนา)
    บรรทัดกิจกรรม "..." → "Fetching transmitters.json" ระหว่างรอ → "Finished" แถบความคืบหน้า 100% เมื่อจบ ปุ่ม "Close" กดได้เมื่อจบ
    บรรทัดไทยใต้ "Finished" จาก `messages`/`fetched_at` ของคำตอบ (ของเรา)
- [ ] **Step 4: รัน** — `npm test`, `npm run build`
- [ ] **Step 5: Commit** — `feat(gpredict-web): controller windows, module target and transponder update dialog`

### Task 15: ตรวจรับกับ hamlib จริงและ SatNOGS, README

**Files:**
- Create: `server/tests/test_integration_hamlib.py`
- Modify: `README.md` ของ `api-interop/gpredict-web/` (ส่วน Radio & Rotator, Interfaces, transponder, รหัสใหม่ `HWCONF_INVALID`, `NO_RADIO_CONFIG`,
  `NO_ROTATOR_CONFIG`, `CONTROLLER_ACTIVE`, `CONTROLLER_INVALID`, `TRSP_DOWNLOAD_FAILED`, วิธีรัน `rigctld -m 1`/`rotctld -m 1`)

- [ ] **Step 1: เขียน test integration** (ข้ามเมื่อ `shutil.which("rigctld")` เป็น None)

```python
async def test_rx_only_against_dummy_rigctld(self):   # สตาร์ต rigctld -m 1 -t <port ว่าง> ด้วย subprocess, engage + track, rr คงที่ 5 km/s
                                                       # → `f` ที่อ่านได้ == round(f_sat + dd − LO) ภายใน 1 Hz ทุก 5 รอบ
async def test_rotator_against_dummy_rotctld(self):   # rotctld -m 1 → P แล้ว p ได้ค่าภายใน Threshold หลัง dummy หมุนเสร็จ
```

- [ ] **Step 2: รัน** — test ทั้งชุดของ server, engine และ web ผ่าน
- [ ] **Step 3: ตรวจรับในหน้าเว็บจริง** — restart server (stop background shell เดิมด้วย TaskStop แล้วเริ่มใหม่) สตาร์ต
  `rigctld -m 1 -t 4532` และ `rotctld -m 1 -t 4533` ในพื้นหลัง แล้วทำตาม spec §11 ข้อ 1–7 ทีละข้อ
  (ข้อ 3 ใช้ `rigctl -m 2 -r localhost:4532 F 145900000`; ข้อ 6 กด Update transponder data ครั้งเดียวที่ต่อ SatNOGS จริง แล้วกดซ้ำเพื่อดูว่าใช้ cache)
  บันทึกผล (ค่าที่อ่านได้ เวลา ข้อความ) ลง README ส่วน "ผลตรวจรับงานย่อยที่ 3" แล้วหยุด rigctld/rotctld
- [ ] **Step 4: ตรวจ GNSS Studio** — test ของ engine ผ่านและ `git diff feature/gpredict-web-passes -- api-interop/gnss-predict` ว่าง
- [ ] **Step 5: Commit** — `docs(gpredict-web): radio and rotator usage and acceptance results`

---

## ข้อกำหนดถึงแผนงานย่อยที่ 2 (ต้องเป็นจริงก่อนเริ่มงานนี้)

1. SP2 Task 7: `PreferencesDialog` เก็บหน้าของทุกกลุ่มที่เคยเปิดไว้ (ซ่อนด้วย CSS ไม่ unmount) ระหว่างที่หน้าต่างเปิด และ `onCommit` ที่หน้าลงทะเบียนถูกเก็บครั้งเดียวต่อการเปิดหน้าต่าง
   ไม่งั้นร่างตาราง Radios/Rotators หายเมื่อสลับไปกลุ่ม Predict แล้วกลับมา
2. SP2 Task 11: `passPolarScene` รับ `PassInfo | null` (null = วงและทิศเท่านั้น) เพื่อให้ Antenna Control วาด plot ได้เมื่อยังไม่มี pass
3. SP2 Task 6: key เรียงชื่อดาวบน server (แบบ `compareNames`) เป็นฟังก์ชันที่ import ได้ งานนี้ใช้ตัวเดียวกันใน `ModuleRuntime.sat_names`
