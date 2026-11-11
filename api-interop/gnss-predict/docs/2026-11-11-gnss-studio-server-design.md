# GNSS Studio งานย่อยที่ 2: Server

- วันที่: 2026-11-11
- Branch: `feature/gnss-studio-server` (แตกจาก `feature/gnss-studio-engine` ที่ 3c777e1)
- สถานะ: รอผู้ใช้ตรวจ spec
- เอกสารที่เกี่ยวข้อง
  - [design ภาพรวม](2026-11-11-gnss-studio-design.md) (อ้างว่า "ภาพรวม §n")
  - [spec engine](2026-11-11-gnss-studio-engine-design.md) (อ้างว่า "engine §n")
  - [spec workspace](2026-11-11-gnss-studio-workspace-design.md), [spec Access + Report & Graph](2026-11-11-gnss-studio-access-reports-design.md)
  - [รายการอ้างอิง STK](2026-11-11-gnss-studio-stk-reference.md)

## 1. เป้าหมาย

FastAPI server ที่ให้หน้าเว็บ (งานย่อยที่ 3–4) สร้าง เปิด แก้ และคำนวณ scenario ได้ผ่าน API ที่ใช้แนวคิดของ STK
และรันงานพยากรณ์ประจำวันเองทุกวัน

### สิ่งที่ผู้ใช้กำหนดในรอบออกแบบนี้

1. งานอัตโนมัติแบบ B: ดึงข้อมูล คำนวณพยากรณ์ 24 ชม. ข้างหน้าของ THBK และตรวจความแม่นยำย้อนหลังเองทุกวัน
2. รัน job แบบแยก process ต่อ job (ส่วน A1)
3. API ใช้ path ของ object แบบ STK, Data Provider และ Report style 3 ชั้น (ส่วน A2)
4. ทุกส่วนเหมือน STK ให้มากที่สุด

### เกณฑ์ว่าสำเร็จ

1. `python3 -m gnss_studio_server` เปิด server ที่ `127.0.0.1:8000` ส่งหน้าเว็บที่ build แล้วและ API ใต้ `/api` จาก port เดียวกัน
2. ทุก endpoint ในหัวข้อ 6 ทำงานตามที่ระบุ มี OpenAPI ที่ `/api/openapi.json`
3. ยกเลิก job ระหว่าง GMAT รันแล้ว process ของ GMAT หายภายใน 2 วินาที
4. ปิด server กลางคันแล้วเปิดใหม่ job ที่ค้างมีสถานะ failed รหัส `INTERRUPTED`
5. งานประจำวันรันครบ 3 วันติดโดยไม่มีคนสั่ง และมีผลตรวจแบบพยากรณ์จริงอย่างน้อย 1 วัน (ภาพรวม §10.2)
6. ไฟล์ที่ API ส่งออกมี SHA-256 ตรงกับไฟล์ที่ engine เขียน

## 2. ขอบเขต

**ทำ**: ทุกอย่างในหัวข้อ 4–10 และส่วนที่ต้องเพิ่มใน engine ตามหัวข้อ 3

**ไม่ทำ** (งานย่อยอื่นหรือรุ่นหลัง)
- หน้าเว็บ (งานย่อยที่ 3–4) และการคำนวณรายงาน (data provider อยู่ใน engine ตามงานย่อยที่ 4 server แค่เรียกใช้)
- login, หลายผู้ใช้, HTTPS (v1 ฟังเฉพาะ `127.0.0.1`)
- หน้าต่าง Connect แบบ STK
- Docker (งานย่อยที่ 5)

## 3. ส่วนที่ต้องเพิ่มใน engine

| ไฟล์ | เพิ่ม | เหตุผล |
|---|---|---|
| `run_gmat.py` | `run_script(..., on_start: Callable[[int], None] \| None = None)` เรียกด้วย process group id ของ GMAT ทันทีที่ `Popen` สำเร็จ | server ใช้ kill GMAT ตอนกด Stop |
| `propagate.py`, `studio.py` | ส่ง `on_gmat_start` ผ่าน `propagate` และ `run_propagate`, `run_analyze`, `run_validate` | เหมือนข้างบน |
| `studio.py` | `plan_propagate(scenario_dir, data_dir) -> PropagatePlan(hash: str, satellites: list[str], messages: list[Message])` และ `plan_analyze(scenario_dir, facility, data_dir) -> str` คำนวณ hash โดยไม่รัน GMAT | ให้ API บอกได้ว่าผลลัพธ์ที่มีตรงกับ scenario ปัจจุบันหรือไม่ |
| `studio.py` | ถ้า `progress` callback ยก exception ให้ปล่อยผ่านออกไปโดยไม่เขียน bundle | ให้ server ยกเลิกแบบร่วมมือระหว่างขั้นที่ไม่ใช่ GMAT |

ส่วนเพิ่มนี้ไม่เปลี่ยนผลการคำนวณ จึงไม่ต้องเปลี่ยน `ENGINE_VERSION` และ test เดิมทั้งหมดต้องผ่าน

## 4. โครงสร้าง

```
api-interop/gnss-predict/server/
  gnss_studio_server/
    __main__.py        เปิด uvicorn ตาม config
    app.py             สร้าง FastAPI, ผูก route, ส่งไฟล์เว็บ
    config.py          อ่าน environment variable (ภาพรวม §4)
    settings.py        อ่าน/เขียน data/settings.json
    errors.py          แปลง GnssPredictError และ error ของ server เป็น HTTP (หัวข้อ 10)
    store.py           อ่าน/เขียน scenario.json และ workbook.json แบบ atomic พร้อม ETag
    objects.py         แปลงระหว่าง scenario.json กับ object path แบบ STK และกลุ่มหน้า Properties
    templates.py       สร้าง scenario จากแม่แบบ (THBK + ดาวทุกดวง 4 ระบบ)
    jobs.py            คิว, บันทึก job, ตัวรัน process ลูก, การยกเลิก
    events.py          ช่องกระจายข่าว SSE (job, message, scenario, daily)
    scheduler.py       งานประจำวันและการตรวจย้อนหลัง
    routes/            health, scenarios, objects, catalog, results, access, dataproviders, styles, reports, jobs, events, orbits, validation, settings
  tests/
  requirements.txt     fastapi, uvicorn (รุ่นตรึงในแผน)
  requirements-dev.txt pytest, httpx
```

- Python ≥ 3.10 เหมือน engine
- server import `gnss_predict` จากโฟลเดอร์ข้างกัน (`api-interop/gnss-predict`) ผ่าน `sys.path` ใน `__main__.py` และ `conftest.py`
- route ไม่คำนวณเรขาคณิตเอง ทุกการคำนวณเรียก engine

## 5. ข้อมูลของ scenario

### 5.1 `scenario.json` ฉบับเต็ม

รูปแบบยังเป็น `gnss-studio-scenario/1` ช่องที่ engine อ่านไม่เปลี่ยน (engine §5.6) ช่องอื่นเป็นของหน้าจอ
`objects[]` เก็บค่าตามกลุ่มหน้าของ Properties Browser ของ STK

```json
{
  "format": "gnss-studio-scenario/1",
  "name": "daily_20261112", "description": "",
  "analysis_period": {"start": "2026-11-12T00:00:00Z", "stop": "2026-11-13T00:00:00Z"},
  "step_s": 30, "orbit_snapshot": "20261111T2100Z",
  "ionosphere": {"shell_km": 400.0},
  "satellite_filter": {"show_too_old": false, "show_no_broadcast": false},
  "animation": {"start": "2026-11-12T00:00:00Z", "time_step_s": 60, "update_mode": "time_step",
                "x_real_time_multiplier": 60, "cycle": "loop"},
  "units": {"date_format": "UTCG", "ltz_offset": "+07:00", "distance": "km", "angle": "deg"},
  "graphics2d_global": {"show_labels": true},
  "objects": [
    {"class": "Facility", "name": "THBK", "description": "",
     "position": {"type": "Geodetic", "lat_deg": 13.729779, "lon_deg": 100.781151, "alt_m": 6.4},
     "constraints": {"elevation_angle_min_deg": 10.0},
     "graphics2d": {"show": true, "color": "#ff79e6", "marker_style": "Triangle", "inherit": true},
     "graphics3d": {"show": true}},
    {"class": "Satellite", "name": "G01", "norad": 62339, "description": "",
     "graphics2d": {"show": true, "color": "#ffd23f", "line_style": "Solid", "line_width": 1, "marker_style": "Square", "inherit": true,
                    "pass": {"lead_type": "Time", "lead_time_s": 1800, "trail_type": "Time", "trail_time_s": 1800,
                             "visible_sides": "Both", "show_pass_labels": false, "show_path_labels": false},
                    "swath": {"type": "Ground Elevation", "elevation_deg": 10.0, "options": "No Graphics"}},
     "graphics3d": {"show": true, "orbit_system": "Fixed by Window"}},
    {"class": "Constellation", "name": "GPS", "system": "G", "description": "", "color": "#ffd23f",
     "assigned_objects": ["*/Satellite/G01"]}
  ],
  "groups": [{"name": "GPS sats", "members": ["*/Satellite/G01"]}],
  "accesses": [
    {"from": "*/Facility/THBK", "to": ["*/Satellite/G01"],
     "time_period": {"mode": "object"},
     "graphics": {"show": true, "static_highlight": false, "animate_highlight": false, "animate_line": true,
                  "color_mode": "object", "custom_color": "#9dff6b", "inherit": true},
     "timeline": true, "computed": true}
  ],
  "styles": [],
  "daily": {"for_date": "2026-11-12", "created_utc": "2026-11-11T21:00:41Z"}
}
```

กติกา
- path ของ object คือ `*/<class>/<name>` ชื่อเป็นไปตาม engine §5.6 (ตัวอักษร ตัวเลข `_` `-` ยาว 1–32 ไม่ซ้ำแบบไม่สนตัวพิมพ์เล็กใหญ่)
- ค่าที่เลือกได้ใช้คำของ STK ตรงตัว (`"Time"`, `"One Pass"`, `"Same As Lead"`, `"Ground Elevation"`, `"Edge Limits"`, `"Fixed by Window"` ฯลฯ) ตามรายการอ้างอิง STK
- ช่อง `color` ของ Constellation เป็นของเรา (ภาพรวม §5.3) ใช้เป็นสีตั้งต้นของดาวที่ `inherit` เป็นจริง
- ช่อง `daily` มีเฉพาะ scenario ที่งานประจำวันสร้าง
- server ตรวจทุกช่องที่หน้าจอใช้ด้วย schema ของ pydantic ช่องของ engine ตรวจด้วย `gnss_predict.scenario.load_scenario` อีกชั้น

### 5.2 `workbook.json`

ผล `toJSON()` ของ dockview กับรายการหน้าต่างที่เปิด (ภาพรวม §5.1) server เก็บเป็นก้อนทึบ ไม่ตีความ จำกัดขนาด 1 MB

### 5.3 การเขียนและ ETag

- ETag ของ scenario คือ 16 ตัวแรกของ SHA-256 ของเนื้อไฟล์
- ทุกการแก้ต้องส่ง `If-Match` ถ้าไม่ตรงตอบ 412 ไม่เขียน
- เขียนแบบไฟล์ชั่วคราวแล้ว `os.replace` เหมือน engine
- หลังเขียนสำเร็จส่งเหตุการณ์ `scenario` ทาง SSE พร้อม ETag ใหม่

## 6. API

ทุก endpoint อยู่ใต้ `/api` ตอบ JSON ยกเว้นที่ระบุ ชื่อ scenario อยู่ใน path ส่วน object path ส่งเป็นช่อง `class` + `name`

### 6.1 ทั่วไป

| Method | Path | ทำอะไร |
|---|---|---|
| GET | `/health` | รุ่น engine, พบ GMAT ไหม, ที่อยู่ `data/`, พื้นที่ว่าง, เขียนได้ไหม, สถานะงานประจำวัน |
| GET/PUT | `/settings` | ค่าตั้งในหัวข้อ 9 |
| GET | `/events` | SSE (หัวข้อ 8) |
| GET | `/messages?since=<iso>` | ข้อความล่าสุดไม่เกิน 1,000 รายการ (สำหรับ Message Viewer ตอนเปิดหน้า) |

### 6.2 ข้อมูลวงโคจรและรายชื่อดาว

| Method | Path | ทำอะไร |
|---|---|---|
| GET | `/orbits` | รายการ snapshot: ชื่อ, เวลา, กลุ่มที่มี, จำนวนดาวต่อกลุ่ม, มี broadcast ไหม |
| POST | `/orbits/fetch` | สั่ง job `fetch` (Utilities → Fetch Orbit Data) |
| GET | `/catalog?snapshot=&start=&stop=&system=&q=` | ดาวใน snapshot พร้อม PRN, SVN, NORAD, Block, ชื่อ CelesTrak, epoch, อายุ ณ กลางช่วงที่ส่งมา, ธง (ใช้ `build_catalog`) |

### 6.3 Scenario (File menu และ New Scenario Wizard)

| Method | Path | ทำอะไร |
|---|---|---|
| GET | `/scenarios` | รายชื่อ, ช่วงเวลา, เวลาแก้ล่าสุด, เป็นงานประจำวันไหม |
| POST | `/scenarios` | New: `{name, start, stop, template: "thbk-gnss" \| "empty", snapshot?}` ตาม New Scenario Wizard |
| GET | `/scenarios/{sc}` | `scenario.json` + ETag |
| PUT | `/scenarios/{sc}` | Save ทั้งก้อน (ใช้ตอน Save และ Save As ภายใน) |
| POST | `/scenarios/{sc}/copy` | Save As: `{new_name}` คัดลอก scenario.json และ workbook.json (ไม่คัดลอกผลลัพธ์) |
| DELETE | `/scenarios/{sc}` | ลบโฟลเดอร์ scenario |
| GET/PUT | `/scenarios/{sc}/workbook` | layout หน้าต่าง |

### 6.4 Object (Object Browser, Insert STK Objects, Properties Browser)

| Method | Path | ทำอะไร |
|---|---|---|
| GET | `/scenarios/{sc}/objects` | ต้นไม้ object พร้อม groups (ข้อมูลของ Object Browser) |
| POST | `/scenarios/{sc}/objects` | Insert: `{class, method: "Define Properties" \| "Insert Default" \| "From Satellite Catalog", ...}` จากรายชื่อดาวรับ `{norads[], create_constellation?: name}` |
| GET | `/scenarios/{sc}/objects/{class}/{name}` | ค่าตั้งแยกตามกลุ่มหน้า `{basic, graphics2d, graphics3d, constraints}` |
| PATCH | `/scenarios/{sc}/objects/{class}/{name}` | Apply ของ Properties Browser: ส่งเฉพาะกลุ่มหน้าที่แก้ |
| POST | `/scenarios/{sc}/objects/{class}/{name}/rename` | `{new_name}` แก้การอ้างถึงใน accesses, groups และ assigned_objects ด้วย |
| DELETE | `/scenarios/{sc}/objects/{class}/{name}` | ลบ และลบการอ้างถึงทั้งหมด |
| POST | `/scenarios/{sc}/groups` | New Group / ย้ายสมาชิก |

ทุกการแก้ที่ทำให้ hash ของ propagate หรือ analyze เปลี่ยน ตอบช่อง `results_stale: true` ยกเว้น `PUT /scenarios/{sc}` (6.3) ซึ่ง body คือเอกสาร scenario ทั้งก้อน จึงตอบค่านี้ใน header `X-Results-Stale: true|false`

### 6.5 ผลลัพธ์และการคำนวณ

| Method | Path | ทำอะไร |
|---|---|---|
| GET | `/scenarios/{sc}/results` | hash ที่ scenario ปัจจุบันต้องใช้ (`plan_propagate`, `plan_analyze` ต่อ Facility) เทียบกับ bundle ที่มี และสถานะแต่ละอัน: `current`, `stale`, `missing` |
| POST | `/scenarios/{sc}/propagate` | สั่ง job propagate (กด Apply แล้วผลไม่ตรง) |
| GET | `/scenarios/{sc}/ephem/{hash}/{file}` | `manifest.json`, `scene.czml`, `predicted.sp3` |
| GET | `/scenarios/{sc}/access/{facility}/{hash}/{file}` | `manifest.json`, `access.czml`, `intervals.json`, `aer.csv`, `dop.csv`, `legacy_gps.csv` |

ไฟล์ส่งแบบไฟล์ตรง (`FileResponse`) ตั้ง `ETag` เป็น SHA-256 ของไฟล์และ `Cache-Control: immutable` เพราะ bundle ไม่เปลี่ยนหลังเขียน

### 6.6 Access (Access tool)

| Method | Path | ทำอะไร |
|---|---|---|
| GET | `/scenarios/{sc}/access` | รายการ access ใน scenario พร้อมสถานะ computed |
| POST | `/scenarios/{sc}/access/compute` | Compute: `{from, to[], time_period, graphics, timeline}` บันทึกลง `accesses` ถ้าผล analyze ของ Facility นั้นยังไม่มีหรือไม่ตรง สั่ง job analyze ตอบ job id มิฉะนั้นตอบผลทันที |
| POST | `/scenarios/{sc}/access/clear` | Clear / Clear All: `{from, to[] \| "all"}` ตั้ง `computed: false` |
| POST | `/scenarios/{sc}/access/remove` | Remove / Remove All: ลบรายการ |
| GET | `/scenarios/{sc}/access/intervals?from=&to=` | ช่วง access ของคู่ที่เลือก (ตัดตาม `time_period`) |

- ถ้า Access For เป็นดาว server สลับเป็นคู่ Facility→ดาว เพราะช่วง access เท่ากัน
- path ของ Constellation ใน `to` หมายถึงสมาชิกทุกดวงใน `assigned_objects` ณ ตอนที่อ่าน (เพิ่มหรือลบสมาชิกแล้วผลเปลี่ยนตาม) ดาวที่ถูกซ่อนตามตัวกรองไม่ถูกนับ

### 6.7 Data provider, style และรายงาน

| Method | Path | ทำอะไร |
|---|---|---|
| GET | `/scenarios/{sc}/dataproviders?class=&name=` | provider, group, element ที่ object นั้นมี (ตาม spec Access + Report & Graph §3) |
| GET | `/scenarios/{sc}/data` | `?object=&provider=&group=&elements=&start=&stop=&step=` คืนแถวจาก engine |
| GET | `/styles?object_type=` | Installed Styles + My Styles |
| POST/PUT/DELETE | `/styles/{name}` | My Styles (เก็บใน `data/styles/`) |
| POST | `/scenarios/{sc}/reports` | `{style, objects[], time, format: "json" \| "txt" \| "csv", dynamic?: false}` คืนตาราง หรือไฟล์พร้อม `Content-Disposition` |

ผลการอ่าน bundle ถูก cache ในหน่วยความจำต่อ hash (ไม่เกิน 8 bundle, LRU) เป้าหมาย: รายงานของดาวหนึ่งดวงหนึ่งวันตอบภายใน 2 วินาที

### 6.8 Job, validation

| Method | Path | ทำอะไร |
|---|---|---|
| GET | `/jobs?state=` | รายการ job |
| GET | `/jobs/{id}` | รายละเอียด (หัวข้อ 7) |
| POST | `/jobs/{id}/cancel` | Stop บนแถบสถานะ |
| POST | `/scenarios/{sc}/validate` | `{day, sp3?}` สั่ง job validate |
| GET | `/validation/history` | อ่าน `data/validation/history.jsonl` |
| GET | `/validation/{sc}/{day}` | `validation_<day>.json` ของ scenario นั้น |

## 7. Job

### 7.1 บันทึก job (`data/jobs/<id>.json`)

```json
{"id": "j-20261111T210041-3f2a", "kind": "propagate", "scenario": "daily_20261112", "params": {},
 "state": "running", "progress": {"stage": "gmat", "fraction": 0.42},
 "messages": [], "result": null, "error": null,
 "created_utc": "...", "started_utc": "...", "finished_utc": null, "origin": "user"}
```

- `kind`: `fetch`, `propagate`, `analyze`, `validate`, `daily`
- `origin`: `user` หรือ `scheduler`
- `error`: `{code, text, detail}` โดย `detail` คือ log 20 บรรทัดท้ายของ GMAT ถ้ามี

### 7.2 การรัน

- คิวเดียว ทำทีละ job ตามลำดับ job ที่ `kind`, `scenario`, `params` เหมือน job ที่ยังรอหรือกำลังรัน คืน id เดิม
- แต่ละ job รันใน process ลูก (`multiprocessing` แบบ `spawn`) process ลูกเรียกฟังก์ชันของ engine ส่งความคืบหน้า ข้อความ และ pgid ของ GMAT กลับทางคิว
- thread หนึ่งตัวใน server อ่านคิวนั้น อัปเดตบันทึก job และส่ง SSE
- ยกเลิก: ตั้ง `cancel_requested` แล้ว `os.killpg(pgid, SIGKILL)` ถ้ามี GMAT ตามด้วยยุติ process ลูก job เป็น `cancelled`
- เปิด server: job ที่บันทึกว่า `queued` หรือ `running` เปลี่ยนเป็น `failed` รหัส `INTERRUPTED`
- เก็บบันทึก job 30 วัน

## 8. Server-Sent Events (`/api/events`)

| event | data |
|---|---|
| `job` | `{id, kind, scenario, state, progress, error?}` |
| `message` | `{time, level, code, text, object}` (เข้า Message Viewer) |
| `scenario` | `{name, etag, results_stale}` |
| `daily` | `{state: "idle" \| "running" \| "ok" \| "failed", last_run_utc, next_run_utc, for_date}` |
| `ping` | ทุก 15 วินาที |

ใช้ `StreamingResponse` ของ FastAPI ไม่เพิ่ม dependency ผู้ฟังหลายคนได้ (หลายแท็บ)

## 9. งานประจำวัน

### 9.1 ค่าตั้ง (`data/settings.json`)

```json
{"daily": {"enabled": true, "run_at_utc": "21:00", "facility": "THBK", "retention_days": 30,
           "validation_retry_hours": 3, "validation_give_up_days": 14},
 "cesium_ion_token": ""}
```

### 9.2 งานพยากรณ์ (ทุกวันตาม `run_at_utc`)

ให้ D = วันถัดไปตาม UTC

1. `fetch_snapshot` (ทำตามกติกา CelesTrak ของ engine อยู่แล้ว)
2. สร้างหรือเขียนทับ scenario `daily_<YYYYMMDD ของ D>` จากแม่แบบ `thbk-gnss`: THBK มุมเงย 10°, ดาวทุกดวงในรายชื่อที่มี PRN, ช่วง 00:00–24:00 UTC ของ D, ทุก 30 วินาที, snapshot ที่เพิ่งดึง, access จาก THBK ไปทุก Constellation
3. propagate แล้ว analyze THBK
4. คัดลอก `legacy_gps.csv` ไปที่ `data/daily/thbk_gnss_pred_<YYYYMMDD>_24h.csv` และ `data/daily/latest.csv` (เขียนแบบ atomic)
5. ส่ง SSE `daily` และข้อความผลลัพธ์

ถ้าขั้นใดล้มเหลว job `daily` เป็น failed ข้อความระดับ error และรอรอบวันถัดไป

### 9.3 งานที่พลาด

ตอนเปิด server ถ้าเวลาปัจจุบันเลย `run_at_utc` ของวันนี้แล้ว และยังไม่มี scenario ของ D ที่สำเร็จ ให้รันทันที

### 9.4 ตรวจย้อนหลัง (ทุก `validation_retry_hours`)

- ไล่ scenario ที่มี `daily.for_date` ผ่านไปแล้วอย่างน้อย 1 วัน และยังไม่มี `validation_<day>.json`
- สั่ง job `validate` (engine ดึง MGEX SP3 เอง) ถ้าได้ `TRUTH_UNAVAILABLE` จะลองใหม่รอบหน้า
- ถ้าเกิน `validation_give_up_days` หลังวันนั้นแล้วยังไม่ได้ ส่งข้อความระดับ warning และไม่ลองอีก

### 9.5 การเก็บรักษา

ลบโฟลเดอร์ `ephem/` และ `access/` ของ scenario รายวันที่ `for_date` เก่ากว่า `retention_days` เก็บ `scenario.json`, ไฟล์ validation และไฟล์ใน `data/daily/` ไว้

## 10. ข้อผิดพลาด

รูปแบบคำตอบ: `{"code": "...", "text": "<ไทย>", "field": null, "detail": null}`

| รหัส | HTTP | เมื่อไร |
|---|---|---|
| `NOT_FOUND` | 404 | ไม่พบ scenario, object, bundle, job |
| `NAME_EXISTS` | 409 | ชื่อ scenario หรือ object ซ้ำ |
| `ETAG_MISMATCH` | 412 | scenario ถูกแก้จากที่อื่น |
| `SCENARIO_INVALID` | 422 | ค่าผิด (มี `field`) |
| `NO_SATELLITES` | 422 | คำนวณแล้วไม่เหลือดาว |
| `JOB_RUNNING` | 409 | ลบ scenario ที่มี job กำลังรัน |
| `RESULTS_NOT_CURRENT` | 409 | ขอช่วง access (`GET /access/intervals`) ของ Facility ที่ผล analyze ไม่ตรงกับ scenario ปัจจุบันหรือยังไม่มี |
| รหัสอื่นของ engine (`ORBIT_SOURCE_UNAVAILABLE`, `GMAT_FAILED`, `TRUTH_UNAVAILABLE` ฯลฯ) | — | อยู่ใน `error` ของ job |
| `INTERRUPTED` | — | job ค้างตอน server ปิด |
| `INTERNAL` | 500 | error ที่ไม่คาดไว้ พร้อมเลขอ้างอิงที่อยู่ใน `data/logs/server.log` |

log ของ server เขียนลง `data/logs/server.log` หมุนไฟล์ที่ 10 MB เก็บ 5 ไฟล์

## 11. การทดสอบ

ใช้ pytest + TestClient ของ FastAPI ทุก test ใช้ `data/` ชั่วคราว ไม่ใช้เน็ต

| กลุ่ม | ตรวจอะไร | ค่าจริง |
|---|---|---|
| engine ส่วนเพิ่ม | `on_start` ได้ pgid จริง (GMAT ปลอมที่หลับรอ), `plan_propagate`/`plan_analyze` ได้ hash เดียวกับ `run_propagate`/`run_analyze`, progress ยก exception แล้วไม่มี bundle | ผลของฟังก์ชันเดิม |
| scenarios/objects | New จากแม่แบบ, Save As, Rename แก้การอ้างถึงทุกที่, Delete, PATCH ทีละกลุ่มหน้า, 412 เมื่อ ETag ไม่ตรง, 422 ระบุ field | schema หัวข้อ 5 |
| results | สถานะ `current`/`stale`/`missing` ถูกต้องหลังแก้ค่าที่กระทบและไม่กระทบ hash, SHA-256 ของไฟล์ที่ส่งตรงกับไฟล์บนดิสก์ | ไฟล์ของ engine |
| jobs | คิวทีละงาน, งานซ้ำได้ id เดิม, ยกเลิกแล้ว GMAT ปลอมหายใน 2 วินาที, เปิดใหม่แล้วได้ `INTERRUPTED` | process จริง |
| events | ลำดับเหตุการณ์ของ job, `ping`, ผู้ฟัง 2 คนได้เหมือนกัน | — |
| scheduler | นาฬิกาจำลอง: รัน 21:00, รันงานที่พลาด, ไม่รันซ้ำ, ตรวจย้อนหลังลองซ้ำทุก 3 ชม. และเลิกหลัง 14 วัน, ลบผลเก่ากว่า 30 วันโดยเก็บไฟล์ validation | — |
| access/reports | Compute สร้างรายการและสั่ง analyze เมื่อจำเป็น, Clear/Remove, รายงานตรงกับ engine | ไฟล์ของ engine |
| static | ส่ง `index.html` สำหรับ path ที่ไม่ใช่ `/api` | — |
| integration (ข้ามถ้าไม่มี GMAT) | New → propagate → compute access → รายงาน Access ผ่าน API | ผล engine |

## 12. ความเสี่ยง

| # | ความเสี่ยง | วิธีรับมือ |
|---|---|---|
| S1 | `spawn` ช้า (เริ่ม Python ใหม่ราว 0.3–1 วินาทีต่อ job) | ยอมรับ เทียบกับเวลาคำนวณหลายวินาที |
| S2 | เครื่องปิดหรือหลับตอน 21:00 UTC | งานที่พลาดรันตอนเปิด server (หัวข้อ 9.3) |
| S3 | CelesTrak ไม่อัปเดตหรือได้ 403 ตอนงานประจำวัน | engine ใช้ snapshot เดิมพร้อมคำเตือน ผลยังมีแต่ข้อมูลเก่าลง ธงอายุแสดงในหน้าจอ |
| S4 | CDDIS ช้าออก SP3 | ลองใหม่ได้ถึง 14 วัน |
| S5 | ดิสก์เต็ม | `/health` แจ้ง และงานประจำวันข้ามพร้อม error |
