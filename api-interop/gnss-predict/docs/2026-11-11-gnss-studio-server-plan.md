# GNSS Studio Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** สร้าง FastAPI server ของ GNSS Studio ที่จัดการ scenario แบบ object ของ STK, รัน job ของ engine แบบแยก process พร้อมยกเลิกได้, ส่งเหตุการณ์ผ่าน SSE และรันงานพยากรณ์ประจำวันเอง

**Architecture:** แพ็กเกจ `gnss_studio_server` ใต้ `api-interop/gnss-predict/server/` เรียก `gnss_predict` (engine, stdlib ล้วน) เป็นไลบรารี
route ทำแค่อ่าน/เขียน `scenario.json` และไฟล์ผลลัพธ์ งานคำนวณทั้งหมดเข้าคิว job เดียว รันใน process ลูก (`spawn`)
thread ฝั่ง server รับความคืบหน้าจากคิวแล้วส่งต่อทาง SSE ตัวตั้งเวลาเป็น thread ที่เรียก `tick(now)` ทุก 60 วินาที

**Tech Stack:** Python 3.14 (ขั้นต่ำ 3.10), FastAPI, uvicorn, pydantic v2 (มากับ FastAPI); test ใช้ pytest + httpx (TestClient)

**Spec:** [2026-11-11-gnss-studio-server-design.md](2026-11-11-gnss-studio-server-design.md) อ่านคู่กับ [design ภาพรวม](2026-11-11-gnss-studio-design.md) และ [spec engine](2026-11-11-gnss-studio-engine-design.md)
(ในแผนนี้ "server §n" = spec server, "engine §n" = spec engine)

## Global Constraints

- ทำงานบน branch `feature/gnss-studio-server` ห้าม push ห้าม merge เข้า `main`
- โค้ดใหม่อยู่ใต้ `api-interop/gnss-predict/server/` ยกเว้นส่วนเพิ่มของ engine ใน Task 1 (`gnss_predict/`) ห้ามแก้ไฟล์ของ GMAT
- engine ยังใช้ standard library เท่านั้น dependency ภายนอกอยู่ใน server เท่านั้น
- virtualenv อยู่ที่ `server/.venv` (gitignore) ติดตั้งด้วย `python3 -m venv server/.venv && server/.venv/bin/pip install -r server/requirements-dev.txt`
- รัน test ของ server: `cd api-interop/gnss-predict/server && .venv/bin/python -m pytest -q`; test ของ engine: `cd api-interop/gnss-predict && python3 -m unittest discover -s tests` ต้องผ่านทั้งคู่ก่อน commit ทุกครั้งที่แตะ engine
- test ห้ามใช้เน็ต ใช้ `data/` ชั่วคราวเสมอ (fixture `data_dir` ใน `conftest.py`) test ที่ต้องใช้ GMAT จริงข้ามเมื่อหา GmatConsole ไม่เจอ
- server ฟังเฉพาะ `127.0.0.1` ค่าตั้งจาก environment variable: `GNSS_STUDIO_DATA`, `GMAT_BIN`, `GNSS_STUDIO_HOST`, `GNSS_STUDIO_PORT`, `CESIUM_ION_TOKEN`
- เวลาใน API เป็น ISO 8601 UTC ลงท้าย `Z` ทั้งหมด
- รูปแบบ error: `{"code", "text", "field", "detail"}` ใช้รหัสตาม server §10 ข้อความถึงผู้ใช้เป็นภาษาไทย ชื่อในโค้ดและรหัสเป็นภาษาอังกฤษ
- ชื่อ scenario และ object ต้องตรง `^[A-Za-z0-9_-]{1,32}$` ทุก path บนดิสก์ต้องอยู่ใต้ `data/`
- ค่าที่เลือกได้ใน `scenario.json` ใช้คำของ STK ตรงตัวตาม server §5.1
- commit message แบบ conventional ภาษาอังกฤษ ลงท้ายด้วย `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## Review Focus

1. **ชื่อใน URL ที่พยายามออกนอก `data/`** (`..`, `%2F`, ชื่อยาวเกิน, ตัวอักษรไทย) ต้องได้ 422 หรือ 404 และไม่แตะไฟล์นอก `data/` → Task 3 `test_unsafe_scenario_names_rejected`
2. **สองแท็บแก้ scenario เดียวกัน** แท็บที่ส่ง ETag เก่าต้องได้ 412 และไฟล์ไม่เปลี่ยน → Task 4 `test_stale_etag_patch_rejected`
3. **ยกเลิก job ที่ยังรออยู่ในคิว** ต้องเป็น `cancelled` ทันทีโดยไม่สร้าง process → Task 6 `test_cancel_queued_job_never_starts`
4. **server ปิดระหว่างงานประจำวันแล้วเปิดใหม่** ต้องไม่รันงานของวันเดียวกันซ้ำถ้ารอบก่อนสำเร็จ และต้องรันถ้ารอบก่อนถูกขัดจังหวะ → Task 11 `test_missed_run_after_interrupted_daily`
5. **snapshot ของ scenario ถูกลบ** `/results` ต้องตอบสถานะ `missing` พร้อมรหัส `ORBIT_SOURCE_UNAVAILABLE` ไม่ใช่ 500 → Task 8 `test_results_when_snapshot_missing`

## การตัดสินใจในแผนที่ spec ไม่ได้กำหนดไว้

| # | เรื่อง | ที่เลือก |
|---|---|---|
| P1 | endpoint ของ server §6.7 (dataproviders, data, styles, reports) | ทำในแผนของงานย่อยที่ 4 พร้อมโมดูล data provider ของ engine เพราะ route เหล่านั้นแค่เรียกโมดูลนั้น |
| P2 | id ของ job | `j-<YYYYMMDDTHHMMSS>-<hex 4 ตัว>` |
| P3 | ตัวรัน job | `JobManager(runner=...)`: ค่าตั้งต้น `ProcessRunner` (spawn) test ส่วนใหญ่ใช้ `InlineRunner` ที่เรียกฟังก์ชันในตัว เพื่อไม่ต้องสร้าง process |
| P4 | SSE | `EventBus` เก็บ `asyncio.Queue` ต่อผู้ฟัง thread อื่นส่งผ่าน `loop.call_soon_threadsafe` |
| P5 | แม่แบบ `thbk-gnss` | snapshot ล่าสุดถ้าไม่ระบุ, ดาวทุกดวงใน catalog ที่มี PRN, สีตั้งต้น G `#ffd23f`, R `#ff6b6b`, E `#4fd47e`, C `#45c8ff`, Facility `#ff79e6` (ตรงกับภาพจำลอง) |
| P6 | Insert Default ของ Facility | ชื่อ `Facility<n>` ตัวแรกที่ว่าง, lat 0, lon 0, alt 0, มุมเงยขั้นต่ำ 0 |
| P7 | ตัวตั้งเวลา | `Scheduler.tick(now)` เป็นตรรกะล้วน thread เรียกทุก 60 วินาที test เรียก `tick` ตรงด้วยเวลาที่กำหนด |
| P8 | การล็อกไฟล์ scenario | `threading.Lock` ต่อชื่อ scenario ใน process เดียว (v1 ผู้ใช้คนเดียว server process เดียว) |

---

### Task 1: ส่วนเพิ่มของ engine (hook GMAT, plan hash, progress)

**Files:**
- Modify: `gnss_predict/run_gmat.py`, `gnss_predict/propagate.py`, `gnss_predict/studio.py`
- Test: `tests/test_run_gmat.py`, `tests/test_studio_cli.py` (เพิ่ม class ใหม่)

**Interfaces:**
- Produces:
  - `run_gmat.run_script(console, script, log, timeout_s=600, on_start: Callable[[int], None] | None = None) -> None` เรียก `on_start(os.getpgid(proc.pid))` ทันทีหลัง `Popen`
  - `propagate.propagate(..., timeout_s=900, on_gmat_start=None)` ส่งต่อให้ `run_script`
  - `studio.run_propagate(..., on_gmat_start=None)`, `run_analyze(..., on_gmat_start=None)`, `run_validate(..., on_gmat_start=None)` ส่งต่อ
  - `@dataclass(frozen=True) class PropagatePlan: hash: str; satellites: list[str]; messages: list[Message]`
  - `studio.plan_propagate(scenario_dir: Path, data_dir: Path = DATA_DIR) -> PropagatePlan` (ไม่รัน GMAT; `satellites` คือ PRN ที่จะ propagate)
  - `studio.plan_analyze(scenario_dir: Path, facility: str, data_dir: Path = DATA_DIR) -> str` hash ของ access
  - `run_propagate` ใช้ `plan_propagate` คำนวณ hash (ไม่มีโค้ด hash ซ้ำสองที่)

- [ ] **Step 1: เขียน test ที่ fail**

```python
# tests/test_run_gmat.py
def test_on_start_receives_process_group(self):
    got = []
    run_script(fake_console(self.d, "sleep 0.2"), self.script, self.log, on_start=got.append)
    self.assertEqual(len(got), 1); self.assertGreater(got[0], 1)

# tests/test_studio_cli.py (ใช้ fake GMAT แบบเดียวกับ test_outputs ที่มีอยู่)
def test_plan_propagate_matches_run_propagate(self):
    plan = plan_propagate(sc, dd)
    ephem, _ = run_propagate(sc, dd, console=FAKE)
    self.assertEqual(plan.hash, ephem.name)
    self.assertEqual(sorted(plan.satellites), sorted(read_sp3_all(ephem / "predicted.sp3")))
def test_plan_analyze_matches_run_analyze(self):
    self.assertEqual(plan_analyze(sc, "THBK", dd), run_analyze(sc, "THBK", dd, console=FAKE)[0].name)
def test_progress_exception_leaves_no_bundle(self):
    def boom(stage, f):
        if stage == "gmat": raise KeyboardInterrupt
    with self.assertRaises(KeyboardInterrupt): run_propagate(sc, dd, console=FAKE, progress=boom)
    self.assertFalse((sc / "ephem").exists() and any((sc / "ephem").iterdir()))
def test_on_gmat_start_passed_through(self): ...   # patch studio.propagate ให้บันทึก kwargs → on_gmat_start ถูกส่งถึง
```

- [ ] **Step 2: รันให้ fail** — Run: `python3 -m unittest tests.test_run_gmat tests.test_studio_cli -v` Expected: TypeError (unexpected keyword `on_start`) / ImportError `plan_propagate`
- [ ] **Step 3: เขียนโค้ด** ย้ายบรรทัดหา catalog/selection/hash ของ `run_propagate` (`studio.py` บรรทัด 318–340 ปัจจุบัน) ไปไว้ในฟังก์ชันภายใน `_plan(...)` ที่ทั้ง `plan_propagate` และ `run_propagate` ใช้ `plan_analyze` ใช้ `inputs = {"ephem_hash", "facility": asdict(fac), "shell_km"}` แบบเดียวกับ `run_analyze`
- [ ] **Step 4: รันทั้งชุดของ engine** — Run: `python3 -m unittest discover -s tests` Expected: OK (443 + test ใหม่)
- [ ] **Step 5: Commit** `feat(gnss-studio): expose GMAT process group and result hashes for the server`

---

### Task 2: โครง server, config, health, error, ไฟล์เว็บ

**Files:**
- Create: `server/requirements.txt`, `server/requirements-dev.txt`, `server/.gitignore` (`.venv/`), `server/pytest.ini`, `server/conftest.py`
- Create: `server/gnss_studio_server/__init__.py`, `__main__.py`, `app.py`, `config.py`, `errors.py`, `routes/__init__.py`, `routes/health.py`
- Test: `server/tests/test_app.py`

**Interfaces:**
- Produces:
  - `config.Config` (frozen dataclass): `data_dir: Path`, `host: str = "127.0.0.1"`, `port: int = 8000`, `gmat_bin: str | None`, `cesium_ion_token: str`, `web_dist: Path` (`server/../web/dist`); `Config.from_env(environ=os.environ) -> Config`
  - `app.create_app(config: Config, *, start_background: bool = True) -> FastAPI` ผูก route ทั้งหมดใต้ `/api` (`openapi_url="/api/openapi.json"`, `docs_url="/api/docs"`), error handler, ส่งไฟล์เว็บ; `start_background=False` ใน test (ไม่เริ่ม job thread และ scheduler)
  - `errors.ApiError(status: int, code: str, text: str, field: str | None = None, detail: str | None = None)` และ handler ที่แปลง `ApiError`, `GnssPredictError` (`ScenarioError` → 422 พร้อม field, อื่น → 422 ใช้ `exc.code`), `RequestValidationError` (→ 422 `SCENARIO_INVALID`), exception อื่น (→ 500 `INTERNAL` พร้อมเลขอ้างอิง 8 หลักที่เขียนลง log)
  - log: `RotatingFileHandler(data/logs/server.log, maxBytes=10_000_000, backupCount=5)`
  - `conftest.py`: เพิ่ม `api-interop/gnss-predict` ใน `sys.path`, fixture `data_dir` (tmp), `client` (`TestClient(create_app(Config(data_dir=...), start_background=False))`), `snapshot` (copy `tests/fixtures/studio/snapshot` ไปเป็น `data/orbits/20261110T0000Z`)
  - `__main__.py`: `uvicorn.run(create_app(Config.from_env()), host, port)` พิมพ์ URL

- [ ] **Step 1: สร้าง venv ติดตั้ง `fastapi uvicorn` (requirements.txt) และ `pytest httpx` (requirements-dev.txt มี `-r requirements.txt`) แล้วตรึงรุ่นที่ติดตั้งได้จริงด้วย `==` ตามผล `pip freeze` ของแพ็กเกจระดับบนสุด 4 ตัว**
- [ ] **Step 2: เขียน test ที่ fail**

```python
def test_health(client, data_dir):
    r = client.get("/api/health"); assert r.status_code == 200
    j = r.json()
    assert j["engine_version"] == "0.2.0" and j["data_dir"] == str(data_dir) and j["writable"] is True
    assert set(j) >= {"gmat_found", "free_bytes", "daily"}
def test_openapi_served(client): assert client.get("/api/openapi.json").status_code == 200
def test_unknown_api_path_is_json_404(client):
    r = client.get("/api/nope"); assert r.status_code == 404 and r.json()["code"] == "NOT_FOUND"
def test_internal_error_has_reference(client_with_boom_route, data_dir):
    r = client_with_boom_route.get("/api/_boom"); assert r.status_code == 500
    ref = r.json()["detail"]; assert ref in (data_dir / "logs" / "server.log").read_text()
def test_spa_fallback(client_with_web_dist):
    assert "<div id=\"root\">" in client_with_web_dist.get("/scenarios/x").text
def test_config_from_env(): ...   # GNSS_STUDIO_DATA, GNSS_STUDIO_PORT อ่านถูก; host ตั้งต้น 127.0.0.1
```

- [ ] **Step 3: รันให้ fail** — Run: `.venv/bin/python -m pytest -q tests/test_app.py` Expected: ImportError
- [ ] **Step 4: เขียนโค้ด**
- [ ] **Step 5: รันให้ผ่าน** — Expected: PASS
- [ ] **Step 6: Commit** `feat(gnss-studio): scaffold FastAPI server with health, errors and static web`

---

### Task 3: scenario store, schema, แม่แบบ และ route ของ scenario

**Files:**
- Create: `server/gnss_studio_server/schema.py`, `store.py`, `templates.py`, `routes/scenarios.py`
- Test: `server/tests/test_scenarios.py`

**Interfaces:**
- Consumes: `Config`, `ApiError` (Task 2); `gnss_predict.scenario.load_scenario`, `gnss_predict.catalog.build_catalog`
- Produces:
  - `schema.py`: pydantic models ของ server §5.1 — `ScenarioDoc`, `FacilityObj`, `SatelliteObj`, `ConstellationObj`, `Group`, `AccessDef`, `Graphics2DSat`, `PassSettings`, `SwathSettings` ฯลฯ ค่าที่เลือกได้เป็น `Literal[...]` ด้วยคำของ STK; `model_config = ConfigDict(extra="allow")` ที่ระดับบนสุดเพื่อไม่ทิ้งช่องที่ไม่รู้จัก
  - `store.ScenarioStore(data_dir)`: `list() -> list[dict]`, `path(name) -> Path` (ตรวจชื่อ → `ApiError(422, "SCENARIO_INVALID", field="name")`), `read(name) -> tuple[dict, str]` (doc, etag), `write(name, doc, if_match: str | None) -> str` (ตรวจ schema + `load_scenario`, ETag ไม่ตรง → `ApiError(412, "ETAG_MISMATCH")`, เขียน atomic, คืน etag ใหม่), `create(name, doc) -> str` (มีแล้ว → 409 `NAME_EXISTS`), `copy(name, new_name)`, `delete(name)`, `read_workbook(name) -> dict | None`, `write_workbook(name, doc)` (เกิน 1 MB → 422)
  - `etag(data: bytes) -> str` = 16 ตัวแรกของ SHA-256
  - `templates.new_scenario(name, start, stop, template: Literal["thbk-gnss", "empty"], snapshot: str | None, data_dir) -> dict` (P5)
  - route: `GET/POST /api/scenarios`, `GET/PUT/DELETE /api/scenarios/{sc}`, `POST /api/scenarios/{sc}/copy`, `GET/PUT /api/scenarios/{sc}/workbook` ส่ง/รับ ETag ทาง header `ETag` / `If-Match`

- [ ] **Step 1: เขียน test ที่ fail**

```python
NEW = {"name": "S1", "start": "2026-11-10T00:00:00Z", "stop": "2026-11-10T06:00:00Z", "template": "thbk-gnss", "snapshot": "20261110T0000Z"}
def test_new_from_template(client, snapshot):
    r = client.post("/api/scenarios", json=NEW); assert r.status_code == 201 and r.headers["ETag"]
    doc = client.get("/api/scenarios/S1").json()
    fac = [o for o in doc["objects"] if o["class"] == "Facility"]; sats = [o for o in doc["objects"] if o["class"] == "Satellite"]
    assert fac[0]["name"] == "THBK" and fac[0]["constraints"]["elevation_angle_min_deg"] == 10.0
    assert {s["name"] for s in sats} >= {"G01", "G22", "E11", "E14", "R05", "C01", "C40", "C09", "R10"}
    assert {o["name"] for o in doc["objects"] if o["class"] == "Constellation"} == {"GPS", "GLONASS", "Galileo", "BeiDou"}
    assert [a["to"] for a in doc["accesses"]] == [["*/Constellation/GPS", "*/Constellation/GLONASS", "*/Constellation/Galileo", "*/Constellation/BeiDou"]]
    assert doc["step_s"] == 30 and doc["animation"]["time_step_s"] == 60
def test_new_duplicate_409(client, snapshot): ...
def test_put_requires_matching_etag(client, snapshot): ...      # If-Match เก่า → 412 ไฟล์ไม่เปลี่ยน; ถูก → 200 ETag ใหม่
def test_put_invalid_value_names_field(client, snapshot):
    doc = client.get("/api/scenarios/S1").json(); doc["objects"][0]["position"]["lat_deg"] = 91
    r = client.put("/api/scenarios/S1", json=doc, headers={"If-Match": etag}); assert r.status_code == 422
    assert r.json()["field"] == "objects[0].position.lat_deg"
def test_unknown_fields_kept(client, snapshot): ...              # ช่อง "x_custom" อยู่หลัง PUT/GET
def test_copy_and_delete(client, snapshot): ...                  # copy ไม่คัดลอก ephem/ access/
def test_workbook_roundtrip_and_limit(client, snapshot): ...     # > 1 MB → 422
def test_unsafe_scenario_names_rejected(client, data_dir):       # Review Focus 1
    for bad in ["..", "a..b%2F..", "x" * 33, "ทดสอบ", "a b"]:
        r = client.get(f"/api/scenarios/{bad}"); assert r.status_code in (404, 422)
    assert not (data_dir.parent / "a").exists()
```

- [ ] **Step 2: รันให้ fail** — Expected: ImportError / 404
- [ ] **Step 3: เขียนโค้ด**
- [ ] **Step 4: รันให้ผ่าน** — Expected: PASS
- [ ] **Step 5: Commit** `feat(gnss-studio): scenario store with ETag, STK-style schema and templates`

---

### Task 4: object แบบ STK (Object Browser, Insert, Properties)

**Files:**
- Create: `server/gnss_studio_server/objects.py`, `routes/objects.py`
- Test: `server/tests/test_objects.py`

**Interfaces:**
- Consumes: `ScenarioStore`, schema (Task 3), `build_catalog`
- Produces:
  - `objects.path_of(obj: dict) -> str` (`*/<class>/<name>`), `find(doc, cls, name) -> tuple[int, dict]` (ไม่พบ → 404)
  - `objects.tree(doc) -> dict` โครงของ Object Browser: `{"path": "*", "name", "children": [...]}` ตาม workspace §7 (Facility, Constellation, Group พร้อมสมาชิก)
  - `objects.pages(obj) -> {"basic", "graphics2d", "graphics3d", "constraints"}` และ `apply_pages(doc, cls, name, patch: dict) -> dict`
  - `objects.insert(doc, body, catalog) -> list[str]` (path ที่สร้าง) สำหรับ `Define Properties`, `Insert Default`, `From Satellite Catalog`
  - `objects.rename(doc, cls, name, new_name)`, `delete(doc, cls, name)` แก้/ลบการอ้างถึงใน `accesses`, `groups`, `assigned_objects`
  - route ตาม server §6.4 ทุกการแก้ต้องมี `If-Match` และตอบ `{"etag", "results_stale"}` โดย `results_stale` เทียบ `plan_propagate(...).hash` และ `plan_analyze` ของทุก Facility ก่อนและหลังแก้ (ถ้าคำนวณ plan ไม่ได้เพราะ snapshot หาย ถือว่า `true`)

- [ ] **Step 1: เขียน test ที่ fail**

```python
def test_tree_shape(client, s1): ...                    # ราก "*", ลูกมี */Facility/THBK, */Constellation/GPS, กลุ่ม "GPS sats" มี */Satellite/G01
def test_get_pages(client, s1):
    p = client.get("/api/scenarios/S1/objects/Satellite/G01").json()
    assert p["graphics2d"]["pass"]["lead_type"] == "Time" and p["basic"]["norad"] == 62339
def test_patch_color_not_stale(client, s1):
    r = patch(client, "Satellite/G01", {"graphics2d": {"color": "#00ff00"}}); assert r.json()["results_stale"] is False
def test_patch_min_el_makes_access_stale(client, s1):
    r = patch(client, "Facility/THBK", {"constraints": {"elevation_angle_min_deg": 15}}); assert r.json()["results_stale"] is True
def test_stale_etag_patch_rejected(client, s1):           # Review Focus 2
    e = etag_of(client); patch(client, "Satellite/G01", {"graphics2d": {"color": "#00ff00"}}, etag=e)
    r = patch(client, "Satellite/G01", {"graphics2d": {"color": "#ff0000"}}, etag=e); assert r.status_code == 412
    assert pages(client, "Satellite/G01")["graphics2d"]["color"] == "#00ff00"
def test_insert_from_catalog_with_constellation(client, s_empty):
    r = client.post(..., json={"class": "Satellite", "method": "From Satellite Catalog", "norads": [62339, 37846], "create_constellation": "Mine"})
    assert set(r.json()["created"]) == {"*/Satellite/G01", "*/Satellite/E11", "*/Constellation/Mine"}
def test_insert_default_facility_name(client, s1): ...  # ได้ Facility1 ที่ lat 0 lon 0 (P6)
def test_rename_updates_references(client, s1): ...     # rename G01→GPS01: accesses/groups/assigned_objects อ้างชื่อใหม่
def test_delete_removes_references(client, s1): ...
def test_name_collision_409(client, s1): ...
```

- [ ] **Step 2: รันให้ fail**
- [ ] **Step 3: เขียนโค้ด**
- [ ] **Step 4: รันให้ผ่าน**
- [ ] **Step 5: Commit** `feat(gnss-studio): STK-style object API for browser, insert and properties`

---

### Task 5: Event bus, SSE และข้อความ

**Files:**
- Create: `server/gnss_studio_server/events.py`, `routes/events.py`
- Test: `server/tests/test_events.py`

**Interfaces:**
- Produces:
  - `events.EventBus`: `publish(event: str, data: dict) -> None` (เรียกได้จากทุก thread), `async subscribe() -> AsyncIterator[tuple[str, dict]]`, `messages_since(t: datetime | None) -> list[dict]` (เก็บล่าสุด 1,000 ข้อความ)
  - `events.message(bus, level, code, text, object=None)` สร้างข้อความพร้อม `time` แล้ว `publish("message", ...)`
  - route `GET /api/events` (text/event-stream, `event: <name>\ndata: <json>\n\n`, `ping` ทุก 15 วินาที), `GET /api/messages?since=`
  - store และ object route (Task 3–4) เรียก `bus.publish("scenario", {"name", "etag", "results_stale"})` หลังเขียน

- [ ] **Step 1: เขียน test ที่ fail**

```python
def test_publish_reaches_two_subscribers(): ...          # asyncio: ผู้ฟัง 2 คนได้ event เดียวกันตามลำดับ
def test_publish_from_thread(): ...                      # publish จาก threading.Thread ถึงผู้ฟังใน loop
def test_messages_ring_keeps_1000(): ...
def test_sse_stream_format(client): ...                  # อ่าน chunk แรกของ /api/events หลัง publish → "event: message\ndata: {...}\n\n"
def test_scenario_event_after_patch(client, s1): ...
```

- [ ] **Step 2: รันให้ fail**
- [ ] **Step 3: เขียนโค้ด**
- [ ] **Step 4: รันให้ผ่าน**
- [ ] **Step 5: Commit** `feat(gnss-studio): server-sent events and message log`

---

### Task 6: คิว job และการรันแบบแยก process

**Files:**
- Create: `server/gnss_studio_server/jobs.py`, `worker.py`, `routes/jobs.py`
- Test: `server/tests/test_jobs.py`, `server/tests/test_jobs_process.py`

**Interfaces:**
- Consumes: `EventBus` (Task 5), `Config`; engine `fetch_snapshot`, `run_propagate`, `run_analyze`, `run_validate` (Task 1 hook `on_gmat_start`)
- Produces:
  - `jobs.JobRecord` (dataclass ตาม server §7.1 เพิ่มช่อง `gmat_pgid: int | None`) `to_dict()`
  - `DELETE /api/scenarios/{sc}` (Task 3) ตอบ 409 `JOB_RUNNING` ถ้ามี job ของ scenario นั้นที่ queued/running (ผูกผ่าน `JobManager.active_for(scenario) -> bool`)
  - `jobs.JobManager(data_dir, bus, runner=ProcessRunner(), clock=utcnow)`: `submit(kind, scenario, params, origin="user") -> JobRecord` (งานซ้ำที่ยัง queued/running คืนตัวเดิม), `get(id)`, `list(state=None)`, `cancel(id) -> JobRecord`, `start()` (thread ทำงาน), `stop()`, `recover()` (queued/running ใน `data/jobs/` → failed `INTERRUPTED`), `prune(now)` (ลบบันทึกเก่ากว่า 30 วัน)
  - `worker.run_job(kind: str, scenario: str | None, params: dict, data_dir: str, gmat_bin: str | None, out: Queue) -> None` ทำงานใน process ลูก ส่ง `("progress", stage, fraction)`, `("message", dict)`, `("gmat_pgid", int)`, `("result", dict)`, `("error", {code, text, detail})` ทางคิว
  - `ProcessRunner` (spawn) และ `InlineRunner` (เรียก `run_job` ใน thread เดียวกัน) ใช้ interface `start(job) -> Handle` กับ `Handle.messages()`, `Handle.terminate()`
  - การยกเลิกขณะรัน: `os.killpg(pgid, SIGKILL)` ถ้าได้ pgid แล้ว `Handle.terminate()`
  - route `GET /api/jobs?state=`, `GET /api/jobs/{id}`, `POST /api/jobs/{id}/cancel`
  - ทุกการเปลี่ยนสถานะเขียน `data/jobs/<id>.json` แบบ atomic และ `bus.publish("job", ...)`
  - `kind = "daily"` ลงทะเบียนในตารางของ worker แต่ตัวงานอยู่ใน Task 11

- [ ] **Step 1: เขียน test ที่ fail**

```python
def test_jobs_run_one_at_a_time(mgr_inline): ...          # สอง job: ตัวที่สองเริ่มหลังตัวแรกจบ (ลำดับ started_utc)
def test_duplicate_submit_returns_same_job(mgr_inline): ...
def test_cancel_queued_job_never_starts(mgr_inline):      # Review Focus 3
    a = mgr.submit("propagate", "S1", {}); b = mgr.submit("analyze", "S1", {"facility": "THBK"})
    mgr.cancel(b.id); wait_done(a); assert mgr.get(b.id).state == "cancelled" and mgr.get(b.id).started_utc is None
def test_error_recorded_with_code(mgr_inline, s1): ...    # scenario ผิด → failed, error.code == "SCENARIO_INVALID"
def test_recover_marks_interrupted(data_dir): ...          # เขียน running.json ไว้ก่อน → recover() → failed INTERRUPTED
def test_prune_30_days(data_dir): ...
def test_job_events_order(mgr_inline, bus): ...           # queued → running → progress… → succeeded
def test_delete_scenario_with_running_job_409(client_inline, s1): ...

# tests/test_jobs_process.py (process จริง, GMAT ปลอม)
def test_cancel_kills_gmat_within_2s(data_dir, s1, fake_gmat_sleep):
    j = mgr.submit("propagate", "S1", {}); wait_state(j, "running"); wait_progress_stage(j, "gmat")
    pgid = mgr.get(j.id).gmat_pgid; mgr.cancel(j.id); t0 = time.monotonic()
    while process_group_alive(pgid): assert time.monotonic() - t0 < 2; time.sleep(0.05)
    assert mgr.get(j.id).state == "cancelled"
```

`fake_gmat_sleep`: สคริปต์ shell ที่ `sleep 30` ตั้งเป็น `GMAT_BIN` (ใช้ `fake_console` แบบ `tests/test_run_gmat.py`)

- [ ] **Step 2: รันให้ fail**
- [ ] **Step 3: เขียนโค้ด**
- [ ] **Step 4: รันให้ผ่าน**
- [ ] **Step 5: Commit** `feat(gnss-studio): single-queue job runner with process isolation and cancel`

---

### Task 7: ข้อมูลวงโคจรและรายชื่อดาว

**Files:**
- Create: `server/gnss_studio_server/routes/orbits.py`
- Test: `server/tests/test_orbits.py`

**Interfaces:**
- Consumes: `JobManager.submit("fetch", None, {"systems": "GREC"})` (Task 6), `build_catalog`
- Produces: `GET /api/orbits` → `[{"name", "time_utc", "groups": {"G": 2, ...}, "has_brdc"}]` เรียงใหม่สุดก่อน (ข้าม `_cache`); `POST /api/orbits/fetch` → `202 {"job": id}`; `GET /api/catalog?snapshot=&start=&stop=&system=&q=` → `[{"prn","system","svn","norad","block","celestrak_name","omm_epoch","age_days","flags"}]` (`q` ค้น PRN, NORAD, ชื่อ ไม่แยกตัวพิมพ์)

- [ ] **Step 1: เขียน test ที่ fail**

```python
def test_orbits_list(client, snapshot): ...                 # มี 20261110T0000Z, groups ครบ 4, has_brdc True
def test_catalog_flags(client, snapshot):
    r = client.get("/api/catalog", params={"snapshot": "20261110T0000Z", "start": "2026-11-10T00:00:00Z", "stop": "2026-11-11T00:00:00Z"})
    by = {s["prn"]: s for s in r.json()}; assert by["C40"]["flags"] == ["name_mismatch", "stale"] and by["G22"]["flags"] == ["no_broadcast"]
def test_catalog_search(client, snapshot): ...              # q="beidou-3 g4" ได้ C01; system="E" ได้ E11, E14
def test_fetch_creates_job(client, snapshot): ...           # 202 และ GET /api/jobs/{id} มี kind "fetch"
```

- [ ] **Step 2–5:** รันให้ fail → เขียนโค้ด → ผ่าน → Commit `feat(gnss-studio): orbit snapshot and satellite catalog endpoints`

---

### Task 8: ผลลัพธ์และการ propagate

**Files:**
- Create: `server/gnss_studio_server/routes/results.py`
- Test: `server/tests/test_results.py`

**Interfaces:**
- Consumes: `plan_propagate`, `plan_analyze` (Task 1), `JobManager`
- Produces:
  - `GET /api/scenarios/{sc}/results` → `{"ephem": {"hash", "status": "current" | "stale" | "missing", "available": [hash...]}, "access": {"THBK": {...}}, "error": null | {code, text}}`
  - `POST /api/scenarios/{sc}/propagate` → 202 job
  - `GET /api/scenarios/{sc}/ephem/{hash}/{file}` และ `.../access/{facility}/{hash}/{file}` เฉพาะชื่อไฟล์ใน server §6.5 (อื่น → 404) ส่ง `FileResponse` พร้อม `ETag` = SHA-256 เต็มของไฟล์ และ `Cache-Control: public, max-age=31536000, immutable`

- [ ] **Step 1: เขียน test ที่ fail** (สร้าง bundle ด้วย engine ใน fixture `s1_computed` โดย patch `gnss_predict.studio.propagate` แบบ engine tests)

```python
def test_status_current_then_stale(client, s1_computed): ...   # current → PATCH min_el → access THBK stale, ephem ยัง current
def test_file_sha_matches_disk(client, s1_computed):
    r = client.get(f"/api/scenarios/S1/ephem/{h}/predicted.sp3")
    assert hashlib.sha256(r.content).hexdigest() == r.headers["ETag"].strip('"') == sha256_of_disk_file
def test_unknown_file_404(client, s1_computed): ...
def test_results_when_snapshot_missing(client, s1_computed, data_dir):   # Review Focus 5
    shutil.rmtree(data_dir / "orbits" / "20261110T0000Z")
    j = client.get("/api/scenarios/S1/results").json(); assert j["ephem"]["status"] == "missing" and j["error"]["code"] == "ORBIT_SOURCE_UNAVAILABLE"
def test_propagate_job(client, s1): ...
```

- [ ] **Step 2–5:** รันให้ fail → เขียนโค้ด → ผ่าน → Commit `feat(gnss-studio): result status, propagate jobs and immutable result files`

---

### Task 9: Access

**Files:**
- Create: `server/gnss_studio_server/access.py`, `routes/access.py`
- Test: `server/tests/test_access.py`

**Interfaces:**
- Consumes: store, objects (Task 3–4), `plan_analyze`, `JobManager`
- Produces:
  - `access.expand_targets(doc, to: list[str], hidden: set[str]) -> list[str]` (path ของ Constellation → สมาชิกใน `assigned_objects` ที่ไม่อยู่ใน `hidden`)
  - `access.normalize(doc, from_path, to) -> tuple[str, list[str]]` (ถ้า from เป็นดาวและ to เป็น Facility สลับเป็น Facility→ดาว)
  - route ตาม server §6.6: `GET /access`, `POST /access/compute` (บันทึกรายการ, ถ้า analyze ของ Facility ไม่ current → 202 `{"job"}` ไม่งั้น 200 `{"computed": [...]}`), `POST /access/clear` (`to` เป็นรายการหรือ `"all"`; ตั้ง `computed: false`), `POST /access/remove`, `GET /access/intervals?from=&to=` (ตัดตาม `time_period` mode `specify`)
  - `hidden` = ดาวที่ manifest ของ ephem บอก `propagated: false`

- [ ] **Step 1: เขียน test ที่ fail**

```python
def test_constellation_expands_without_hidden(client, s1_computed):
    r = client.get("/api/scenarios/S1/access/intervals", params={"from": "*/Facility/THBK", "to": "*/Constellation/GPS"})
    assert set(r.json()) == {"G01"}                # G22 ซ่อน (no_broadcast)
def test_compute_when_current_returns_200(client, s1_computed): ...
def test_compute_when_stale_returns_job(client, s1_computed): ...
def test_from_satellite_swapped(client, s1_computed): ... # from */Satellite/G01 to */Facility/THBK → ช่วงเท่ากับ THBK→G01
def test_specify_time_period_clips(client, s1_computed): ...
def test_clear_and_remove_all(client, s1_computed): ...
```

- [ ] **Step 2–5:** รันให้ fail → เขียนโค้ด → ผ่าน → Commit `feat(gnss-studio): access endpoints with constellation expansion`

---

### Task 10: Validation และค่าตั้ง

**Files:**
- Create: `server/gnss_studio_server/settings.py`, `routes/validation.py`, `routes/settings.py`
- Test: `server/tests/test_validation_settings.py`

**Interfaces:**
- Produces:
  - `settings.Settings` (pydantic) ค่าตั้งต้นตาม server §9.1; `load(data_dir) -> Settings`, `save(data_dir, Settings)` (atomic); `run_at_utc` ต้องเป็น `HH:MM`, `retention_days` 1–3650
  - `GET/PUT /api/settings` (PUT แจ้ง scheduler ผ่าน callback)
  - `POST /api/scenarios/{sc}/validate` `{day, sp3?}` → 202 job (`sp3` ต้องอยู่ใต้ `data/` ไม่งั้น 422)
  - `GET /api/validation/history` (อ่าน history.jsonl ข้ามบรรทัดที่อ่านไม่ได้พร้อม log), `GET /api/validation/{sc}/{day}` (ไฟล์ `validation_<day>.json` ใน ephem ที่ current หรือใน `data/validation/<sc>/` ถ้าถูกย้ายโดยการเก็บรักษาของ Task 11 ถ้าไม่มี 404)

- [ ] **Step 1: เขียน test ที่ fail**

```python
def test_settings_defaults(client): assert client.get("/api/settings").json()["daily"] == {"enabled": True, "run_at_utc": "21:00", "facility": "THBK", "retention_days": 30, "validation_retry_hours": 3, "validation_give_up_days": 14}
def test_settings_rejects_bad_time(client): ...           # "25:00" → 422 field daily.run_at_utc
def test_history_skips_bad_lines(client, data_dir): ...
def test_validate_job_and_day_file(client, s1_computed): ... # patch engine run_validate ใน InlineRunner → GET day file ได้ JSON
def test_validate_sp3_outside_data_rejected(client, s1): ...
```

- [ ] **Step 2–5:** รันให้ fail → เขียนโค้ด → ผ่าน → Commit `feat(gnss-studio): validation history and daily settings endpoints`

---

### Task 11: งานพยากรณ์ประจำวัน

**Files:**
- Create: `server/gnss_studio_server/scheduler.py`, `daily.py`
- Modify: `server/gnss_studio_server/worker.py` (งาน `daily`), `app.py` (เริ่ม thread)
- Test: `server/tests/test_scheduler.py`

**Interfaces:**
- Consumes: `JobManager`, `Settings`, `templates.new_scenario`, engine `fetch_snapshot`, `run_propagate`, `run_analyze`
- Produces:
  - `daily.run_daily(data_dir, for_date: date, settings, now, progress) -> dict` (ทำใน process ลูกผ่าน worker): fetch → `new_scenario("daily_<YYYYMMDD>", D 00:00Z, D+1 00:00Z, "thbk-gnss", snapshot ใหม่)` เขียนทับ (ช่อง `daily = {"for_date", "created_utc"}`) → propagate → analyze facility → คัดลอก `legacy_gps.csv` ไป `data/daily/thbk_gnss_pred_<YYYYMMDD>_24h.csv` และ `data/daily/latest.csv` (atomic)
  - `scheduler.Scheduler(data_dir, jobs, settings_provider, bus)`: `tick(now: datetime) -> list[str]` (คืน id ของ job ที่สั่งในรอบนี้), `start()` (thread เรียก `tick(utcnow())` ทุก 60 วินาที), `stop()`
  - กติกาของ `tick` ตาม server §9:
    - พยากรณ์: ถ้า `enabled` และ `now ≥ วันนี้ run_at_utc` และยังไม่มี job `daily` ของ D ที่ `succeeded` และไม่มี job `daily` ของ D ที่ queued/running → submit (`origin = "scheduler"`) ครอบคลุมทั้งรอบปกติและงานที่พลาด
    - ตรวจย้อนหลัง: ทุก `validation_retry_hours` นับจากการลองครั้งก่อน (เก็บใน `data/daily/state.json`) ไล่ scenario ที่ `daily.for_date ≤ วันนี้ − 1` และยังไม่มีไฟล์ validation ของวันนั้น → submit `validate`; ถ้า job ก่อนหน้าของวันนั้นล้มเหลวด้วย `TRUTH_UNAVAILABLE` และเกิน `validation_give_up_days` หลัง `for_date` → ข้อความ warning `VALIDATION_GAVE_UP` แล้วบันทึกว่าเลิก
    - เก็บรักษา: ลบ `ephem/` และ `access/` ของ scenario รายวันที่ `for_date < วันนี้ − retention_days` (เก็บ `scenario.json`, `validation_*` ย้ายออกไปเก็บที่ `data/validation/<scenario>/` ก่อนลบ)
    - publish `daily` ทุกครั้งที่สถานะเปลี่ยน

- [ ] **Step 1: เขียน test ที่ fail** (นาฬิกาจำลอง, `InlineRunner`, engine ถูก patch ให้ไม่ใช้เน็ตและ GMAT)

```python
def test_runs_at_2100(sched): assert sched.tick(T("2026-11-11T20:59Z")) == []; assert len(sched.tick(T("2026-11-11T21:00Z"))) == 1
def test_no_second_run_same_day(sched): ...                 # ทำเสร็จแล้ว tick 21:05 ไม่สั่งซ้ำ
def test_missed_run_after_interrupted_daily(sched, data_dir):   # Review Focus 4
    write_job(data_dir, kind="daily", params={"for_date": "2026-11-12"}, state="running"); jobs.recover()
    assert len(sched.tick(T("2026-11-11T23:30Z"))) == 1
def test_daily_outputs(sched, data_dir): ...                # หลังรัน: scenario daily_20261112 มี daily.for_date, มี data/daily/latest.csv เท่ากับ legacy_gps.csv
def test_validation_retry_then_give_up(sched): ...          # TRUTH_UNAVAILABLE → ลองใหม่หลัง 3 ชม. → หลัง 14 วันได้ VALIDATION_GAVE_UP และไม่สั่งอีก
def test_retention_keeps_validation(sched, data_dir): ...   # เก่ากว่า 30 วัน: ephem/ access/ หาย, validation_*.json อยู่ใน data/validation/<scenario>/
def test_disabled_does_nothing(sched): ...
```

- [ ] **Step 2–5:** รันให้ fail → เขียนโค้ด → ผ่าน → Commit `feat(gnss-studio): daily forecast scheduler with post-hoc validation and retention`

---

### Task 12: Integration, README และการตรวจยอมรับ

**Files:**
- Create: `server/tests/test_integration_gmat.py`
- Modify: `README.md` (หัวข้อ "GNSS Studio server")

- [ ] **Step 1: integration test (ข้ามถ้าไม่มี GMAT)** — ผ่าน API ด้วย `ProcessRunner` จริง: New จากแม่แบบ (ช่วง 6 ชม.) → `POST /propagate` → รอ succeeded → `POST /access/compute` THBK→GPS → `GET /access/intervals` มี G01 → `GET .../ephem/{hash}/scene.czml` เปิดเป็น JSON ได้
- [ ] **Step 2: รันทั้งชุดของ server และ engine** — Expected: ผ่านทั้งหมด
- [ ] **Step 3: ทดลองจริง** เปิด `.venv/bin/python -m gnss_studio_server` ด้วย `GNSS_STUDIO_DATA` ชี้ไปโฟลเดอร์ใน scratchpad, `curl /api/health`, สร้าง scenario, propagate, ดู SSE ด้วย `curl -N /api/events` บันทึกผลลง README
- [ ] **Step 4: README** อธิบายการติดตั้ง venv, คำสั่งเปิด server, environment variable, งานประจำวันและไฟล์ `data/daily/latest.csv`, ตารางสรุป endpoint (ชี้ไป spec), วิธีตรวจเกณฑ์ข้อ 5 ของ spec (รัน server ต่อเนื่อง 3 วันแล้วดู `/api/validation/history`)
- [ ] **Step 5: Commit** `docs(gnss-studio): document the server and record a local run`

เกณฑ์ข้อ 5 ของ server §1 (3 วันติด + ผลพยากรณ์จริง) ต้องปล่อย server รันจริงหลายวัน ทำในแผนนี้ไม่ได้ ผู้ใช้ตรวจตาม README หลัง merge งานย่อย
