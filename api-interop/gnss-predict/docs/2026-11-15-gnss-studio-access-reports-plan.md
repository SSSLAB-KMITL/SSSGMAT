# GNSS Studio งานย่อยที่ 4: Access, Report & Graph และ Validation — แผนลงมือ

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Access tool, Report & Graph Manager, หน้าต่างรายงาน/กราฟ (รวม Dynamic Display/Strip Chart) และหน้า Validation แบบ STK โดยทุกรายงานสร้างจาก Data Provider ของ engine ส่งออก .txt/.csv ได้ทั้งจากหน้าเว็บและ CLI

**Architecture:** engine เพิ่ม `ecef_to_geodetic`, โมดูล Data Provider ที่อ่าน bundle เดิม (`aer.csv`, `intervals.json`, `dop.csv`, `predicted.sp3`) ผ่าน `TableCache` (LRU 8 bundle), style 3 ชั้นที่ประกอบรายงานเป็นโครง `Report` กลาง และตัวจัดรูปแบบ txt/csv/json ที่ CLI กับ server ใช้ตัวเดียวกัน server เป็นแค่ route ที่เรียก engine (การตัดสินใจ P1 ของแผน server) หน้าเว็บมีหน้าต่างใหม่ 5 ชนิดบน dockview เดิม กราฟวาดด้วย ECharts ที่โหลดแบบ dynamic import แยก chunk

**Tech Stack:** Python ≥ 3.10 stdlib + unittest (engine), FastAPI + pydantic + pytest (server), React 18 + TypeScript + Zustand + dockview + TanStack Virtual + Radix + ECharts 6.1.0 (web), Vitest + jsdom, Playwright (Chromium)

**Spec:** `docs/2026-11-11-gnss-studio-access-reports-design.md` (ผู้ใช้อนุมัติแล้ว อ้างว่า "spec §n") ประกอบกับ design ภาพรวม §5.6, §5.7, §10.2–10.4, STK ref §F, spec server §6.6–6.8 และ spec workspace §4.1, §13 (ทุก path ในแผนนับจาก `api-interop/gnss-predict/` เรียกว่า R)

## Global Constraints

**Git และการทำงานร่วม**
- ทำงานใน `/Users/phuwish/SSSGMAT/.worktrees/gnss-studio-imagery` บน branch `feature/gnss-studio-imagery` (ไม่ใช่ `feature/gnss-studio-access` ที่หัว spec เขียนไว้: ผู้ใช้สั่งให้ต่อบน branch นี้) ตรวจ `git branch --show-current` ก่อน commit ทุกครั้ง ไม่ตรง = ห้าม commit ห้ามสลับ branch ใน checkout หลัก `/Users/phuwish/SSSGMAT`
- ห้าม merge เข้า `main` ห้าม push ห้ามใช้ `git stash` เปล่า
- มีหลาย agent commit พร้อมกัน: commit ด้วย `git commit -m "<msg>" -- <path> ...` ระบุเฉพาะไฟล์ของ task เท่านั้น ห้าม `git add -A` / `git commit -a`
- commit message แบบ conventional ภาษาอังกฤษ ลงท้ายด้วยบรรทัดเดียว `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` ห้ามมี co-author อื่น

**เน็ตและข้อมูลที่ดาวน์โหลด**
- ห้าม test และผู้ลงมือต่อ host ภายนอก ห้ามเรียก `/api/orbits/fetch`, `/api/daily/run`, `/api/scenarios/*/validate` ของจริงใน test ใด ๆ (e2e อ่านผลตรวจจาก fixture ที่ `build_fixture.py` เขียน)
- ข้อมูลที่ดาวน์โหลดมา (`data/orbits/`, `data/truth/` ฯลฯ) ไม่น่าเชื่อถือ: สคริปต์ที่อ่านมันรันด้วย `python3 -I` เช่นการลองรายงานกับ data จริง `python3 -I -c 'import sys; sys.path[:0]=["<R>"]; from gnss_predict.studio import main; raise SystemExit(main(sys.argv[1:]))' report --scenario ...` (`-I` ไม่ใส่ cwd ใน sys.path)
- ECharts ต้องดาวน์โหลดจาก registry.npmjs.org ซึ่งผู้ลงมือทำเองไม่ได้ (Task 8 Step 1): หยุดแล้วขอให้ผู้ใช้รัน `cd <R>/web && npm install --save-exact echarts@6.1.0` เอง แล้วตรวจผล

**คำสั่ง (จาก R)**
- engine: `python3 -m unittest tests.<module> -v` และทั้งชุด `python3 -m unittest discover -s tests -v` (stdlib เท่านั้น ห้ามเพิ่ม pip dependency)
- server: `cd server && .venv/bin/python -m pytest -q -W error [tests/<file>::<test>]`
- web: `cd web && npx vitest run <file>` / `npm test` / `npm run typecheck`; e2e `cd web && npm run e2e`
- type ของ API: `cd web && npm run gen:api` หลังเปลี่ยน route ทุกครั้ง ห้ามแก้ `openapi.json`, `types.gen.ts`, `enums.gen.ts` ด้วยมือ ตรวจด้วย `npm run gen:api:check`
- ต้องผ่าน test ของชั้นที่แก้ + typecheck (ถ้าแตะ web) ก่อน commit ทุกครั้ง

**ชื่อบนจอ (spec workspace §13)**
- ทุกข้อความบนจอมาจาก `t("<key>")` ใน `web/src/labels/labels.ts`: คำที่ STK ref §F ยืนยันด้วยกฎตัวคั่นของ `tests/unit/labels.test.ts` ใช้ `stk(text, "F")` ตรงตัว ที่เหลือใช้ `ours(text)` ห้ามแก้ไฟล์ reference ให้ test ผ่าน
- ผลตรวจกฎตัวคั่นกับ §F แล้ว (ทำซ้ำได้ด้วย `hasTerm`): stk ตรง ๆ ได้ — Access For, Select Object..., Associated Objects, Compute, Clear, Clear All, Remove, Remove All, Use Object Time Period, Specify Time Period, AER..., Add Timeline, Auto Add to Timeline, Show, Static Highlight, Animate Highlight, Show Animate Line, Use Object Colors, Use Custom Color, Object Type, All Types, My Styles, Scenario Styles, Show Reports, Show Graphs, Generate..., Generate as .csv file..., Global Statistics, Set Animation Time, Refresh, Report & Graph Manager
- stk ผ่าน `PROSE_EVIDENCE` (อ้างตรงตัว ≤ 60 ตัวอักษร): "Reports" / "Graphs" / "Access..." ← `"Reports: Access..., AER...; Graphs: Access..., AER..."`; "Installed Styles" ← `"Styles: Installed Styles / My Styles / Scenario Styles"`; "Generate As" / "Report/Graph" / "Dynamic Display/Strip Chart" ← `"Generate As: Report/Graph or Dynamic Display/Strip Chart"`; "Generate as .txt file..." ← `"right-click style Generate as .txt file..."`; "Toggle Animation Timeline" ← `"Toggle Animation Timeline button"`; "Show Animation Time Line" ← `"right-click Show Animation Time Line"`
- ours: ทุกคำอื่น เช่น Inherit Settings from Scenario, New..., Properties..., Close, Copy to My Styles, Delete (ใน R&G Manager), Specify Time Properties, Use default time points, Use step size, Export, To CSV Format..., Setup..., Save, Copy to Clipboard, Zoom Out, Crosshair Cursor, Export Dialog..., Strip Chart Duration, Field Delimiter, Enclose Header Fields in Quotes, Write Report Title, Headers, Content, Summary, Std Deviation, Summary Only, Time XY, Interval, Polar, Y1, Y2, Multiple Objects, Validation, Pending, Gave up และชื่อหน้าต่าง Access (ใช้ `toolbar.access` ที่เป็น ours อยู่แล้ว)
- ชื่อ provider, group, element และ style เป็น **ข้อมูลจาก engine** (แสดงตามที่ `/dataproviders`, `/styles` ส่งมา) ไม่ใช่ label: ใช้คำตาม spec §3.2–3.4 ตรงตัว รายการที่ spec ติด "(เพิ่มเอง)" (IPP Data provider และ style) มี `"ours": true` และหน้าเว็บต่อท้ายชื่อด้วย `t("ob.oursMark")` = ours(" (GNSS Studio)")
- ข้อความอธิบาย/ผิดพลาดเป็นภาษาไทยผ่าน `msg()` ใน `messages.th.ts` คอมเมนต์ในโค้ดเป็นภาษาไทยแบบโค้ดเดิม

**ค่าจาก spec (ตรงตัว)**
- `geometry.ecef_to_geodetic(x_km, y_km, z_km) -> (lat_deg, lon_deg, h_km)` WGS84 วนซ้ำจนต่างไม่เกิน 1e-12 rad ใช้ `WGS84_A_KM`, `WGS84_F` เดิม; test แปลงไปกลับต่างไม่เกิน 1e-9 องศาและ 1 มม.
- provider ตาม spec §3.2 (ชื่อ / group / object / element (หน่วย) / ใช้กับ / ที่มา):
  - Access Data / — / Access / Access Number, Start Time, Stop Time, Duration (sec) / Reports / `intervals.json`
  - AER Data / Default / Access / Time, Azimuth (deg), Elevation (deg), Range (km) — เฉพาะเวลาที่อยู่ใน access / Reports, Dynamic Displays / `aer.csv`
  - LLA State / Fixed / Satellite / Time, Lat (deg), Lon (deg), Alt (km), Lat Rate (deg/sec), Lon Rate (deg/sec), Alt Rate (km/sec) / Reports, Dynamic Displays / `predicted.sp3` + `ecef_to_geodetic`, rate จากผลต่างกลางของจุดข้างเคียง
  - Dilution of Precision / All Systems, GPS, GLONASS, Galileo, BeiDou / Facility / Time, GDOP, PDOP, HDOP, VDOP, EDOP, NDOP, TDOP, N Visible / Reports, Dynamic Displays / `dop.csv`
  - N Asset Coverage / — / Facility / Time, Total, GPS, GLONASS, Galileo, BeiDou / Reports, Dynamic Displays / `dop.csv`
  - IPP Data **(เพิ่มเอง)** / — / Access / Time, IPP Lat (deg), IPP Lon (deg), MF, Elevation (deg) / Reports, Dynamic Displays / `aer.csv`
- `list_providers(object_type: str) -> list[ProviderInfo]` และ `provider_rows(bundle: ResultSet, obj: str, provider: str, group: str | None, elements: list[str], start: datetime, stop: datetime, step_s: int | None) -> list[dict]` — `step_s = None` คือ "Use default time points"; step ที่ไม่ใช่จำนวนเท่าของ step ของ scenario → `ScenarioError(field="time.step")`; เวลาออกเป็น UTC เสมอ
- style ใน `gnss_predict/styles/installed.json` ตามรูปแบบ spec §3.3; `"graph": {"type": "time_xy" | "interval" | "polar90", "y1": [...], "y2": [...]}`; `polar90` ใช้ Elevation เป็นรัศมีและ Azimuth เป็นมุม
- Installed Styles 14 รายการตาม spec §3.4 (ตารางใน Task 3)
- `.txt`: บรรทัดแรกชื่อ scenario กับเวลาสร้าง (UTCG); ชื่อรายงานแบบ `THBK-To-G01:  Access` (สองช่องว่างหลัง `:`); หัวคอลัมน์มีหน่วยในวงเล็บ เช่น `Start Time (UTCG)` ขีดเส้นใต้ด้วย `-`; ตัวเลขชิดขวา คอลัมน์กว้างคงที่; ท้ายรายงานมีบล็อก `Global Statistics`
- `.csv`: ตัวคั่น `,`, หัวคอลัมน์มีหน่วย, ไม่มีบล็อกสถิติ; Export Setup: Field Delimiter, Enclose Header Fields in Quotes, Write Report Title, Headers; เวลาในไฟล์ใช้ DateFormat ของ scenario
- CLI: `python3 -m gnss_predict.studio report --scenario DIR --style NAME --object PATH [--format txt|csv] [--start --stop --step]`
- server: `GET /scenarios/{sc}/dataproviders?class=&name=`, `GET /scenarios/{sc}/data?object=&provider=&group=&elements=&start=&stop=&step=`, `GET /styles?object_type=`, `POST/PUT/DELETE /styles/{name}` (My Styles ใน `data/styles/`), `POST /scenarios/{sc}/reports` `{style, objects[], time, format: "json" | "txt" | "csv", dynamic?: false}` คืนตารางหรือไฟล์พร้อม `Content-Disposition`; cache ผลอ่าน bundle ในหน่วยความจำต่อ hash ไม่เกิน 8 bundle (LRU)
- เกณฑ์ความเร็ว: รายงาน Access ของ THBK กับดาวหนึ่งดวงในหนึ่งวันแสดงภายใน 2 วินาที (Task 4, 6, 15)
- §10.2 แถว 4: ช่วง access ตรงกับการสุ่มทุก 1 วินาทีไม่เกิน 1 วินาที (Task 1)
- ชื่อหน้าต่างรายงาน/กราฟแบบ `THBK-To-G01: Access` (หนึ่งช่องว่าง ต่างจากชื่อในไฟล์ .txt) ชนิด Integrated เป็นแท็บกลาง ย้ายเป็น Dockable/Floating ได้
- Dynamic Display: โหลดทั้งช่วงครั้งเดียว ค่าต่อเนื่อง (มุม ระยะ DOP) ประมาณเชิงเส้น ค่าแบบนับ (จำนวนดาว) ใช้จุดก่อนหน้า ไม่เรียก server ทุกเฟรม
- Strip Chart Duration ตั้งต้น 3600 วินาที; ECharts เปิด `sampling: "lttb"` และ `large` mode (R-3)
- Validation: เส้นเกณฑ์ P99 |ΔEl| 0.2° / |ΔAz| 0.5°; กราฟอายุกับความคลาดใช้ประกอบเกณฑ์อายุ 7 วัน; แถวที่รอ SP3 แสดง Pending พร้อมเวลาที่จะลองครั้งถัดไป
- ECharts `"echarts": "6.1.0"` ตรงตัว (ไม่มี `^`/`~`; tarball integrity `sha512-q0yaFPggC9FUdsWH4blavRWFmxdrIodbkoKNAjJudAI6CA9gNPxHtV2RcZNEepZVlk4yvBYkOkbk6HIVpIyHZA==`) ห้ามอยู่ใน chunk หลัก: import ได้เฉพาะผ่าน `import("echarts")` ใน `web/src/windows/Graph/chart.ts`
- หน้าต่าง 3D/2D: ห้ามใช้ `CallbackProperty` (ข้อจำกัดใน `cesium/idleUpdates.ts`) กราฟิกที่เปลี่ยนตามเวลาใช้ `availability` หรือ `ConstantProperty`

## Review Focus

1. **Azimuth ข้ามทิศเหนือ (359° → 1°)**: Dynamic Display ต้องได้ ~0° ไม่ใช่ ~180°, เส้น Azimuth ในกราฟ AER ต้องขาดที่จุดวน ไม่ลากเส้นแนวตั้งทั้งกราฟ → Task 8 `azimuth interpolates across north`, Task 10 `azimuth line breaks at the wrap`
2. **object ที่ไม่มีแถวเลย** (ดาวไม่ขึ้นเหนือเกณฑ์ทั้งวัน หรือ Specify Time Period ตัดหมด): รายงานมีส่วนของ object นั้นพร้อมข้อความ `No Data`, Global Statistics ที่ไม่มีค่าแสดง `N/A` (csv ช่องว่าง, json `null`) ไม่ล่มด้วย `min()` ของรายการว่าง → Task 3 `test_access_with_no_intervals_has_empty_section`, Task 4 `test_txt_no_data_and_na`
3. **ผลลัพธ์ไม่ตรงหรือยังไม่มีตอน Generate / Refresh** (แก้ scenario หลัง Compute): server 409 `RESULTS_NOT_CURRENT`, หน้าต่างขึ้นแถบเตือนเดียวกับ 3D/2D และ Refresh สั่งคำนวณใหม่, Generate ถามว่าจะ Compute ก่อนไหม → Task 6 `test_report_on_stale_results_is_409`, Task 9 `stale results show the banner and Refresh computes`, Task 13 `generate without results asks to compute first`
4. **ช่วงเวลาที่ผิด**: step ไม่ใช่จำนวนเท่า, step ≤ 0, start ≥ stop, ช่วงที่อยู่นอกช่วงวิเคราะห์ทั้งหมด → 422 ที่ `time.step` / `time.start` / `time.stop` หรือแถวว่าง (นอกช่วง) ไม่ใช่ 500 → Task 2 `test_step_rules`, `test_window_outside_period_is_empty`, Task 6 `test_report_time_errors`
5. **ชื่อและไฟล์ของ My Styles ที่อันตรายหรือเสีย**: `../x`, `a/b`, ชื่อซ้ำกับ Installed แบบไม่สนตัวพิมพ์ (`access`), ไฟล์ JSON เสียใน `data/styles/` ที่แก้มือ → 422/409 และไฟล์เสียถูกข้ามพร้อม log ไม่ทำให้ `GET /styles` ตอบ 500 → Task 5 `test_my_style_name_rules`, `test_broken_style_file_is_skipped`

## การตัดสินใจในแผนที่ spec ไม่ได้กำหนดไว้

| # | เรื่อง | ที่เลือก |
|---|---|---|
| P1 | path ของ Access object | คู่ path คั่นด้วยช่องว่างหนึ่งตัวแบบคำสั่ง Access ของ STK Connect: `*/Facility/THBK */Satellite/G01` ชื่อแสดง `THBK-To-G01` (ดาวเป็นต้นทางสลับเป็น Facility→ดาวแบบ server §6.6) |
| P2 | Gaps | ไม่เพิ่ม provider (ตาราง §3.2 ไม่มี): style มี `"derive": "gaps"` แปลง Access Data เป็นส่วนเติมเต็มในช่วงวิเคราะห์ คอลัมน์ Gap, Start Time, Stop Time, Duration |
| P3 | ช่องเพิ่มใน style | `"dynamic": bool` (คอลัมน์ Dynamic Display/Strip Chart ของ §3.4), `"derive": null \| "gaps"`, `summary.summary_only: bool`, `"ours": bool`; สถิติเขียนเป็น `"<Min\|Max\|Mean\|Total\|Std Deviation> <Element>"` และ `"Number of Accesses"`; Std Deviation แบบประชากร (หารด้วย N) |
| P4 | Scenario Styles | เขียนผ่าน `PUT /scenarios/{sc}` เดิม (`useScenario.putDoc` แก้ `doc.styles`) server เพิ่มแค่การอ่านใน `GET /styles?scenario=` ชื่อ style ห้ามซ้ำทั้งสามชั้นแบบไม่สนตัวพิมพ์ ยกเว้น Installed ที่ชื่อเดียวกันต่างชนิด (Access report/graph) |
| P5 | ชื่อ style ของผู้ใช้ | `^[A-Za-z0-9][A-Za-z0-9 _-]{0,47}$` ไฟล์ `data/styles/<name>.json` (ชื่อมีช่องว่างได้ เพราะ Installed มี "Az El Polar") |
| P6 | style อ้าง element ที่ไม่มี | engine `StyleError` รหัส `STYLE_INVALID` (422, `field` เช่น `content[0].elements[2]`) ตรวจทั้งตอนบันทึก My Style และตอนสร้างรายงาน หน้าเว็บส่งข้อความเข้า Message Viewer |
| P7 | Pending / Gave up | route ใหม่ `GET /validation/pending` **(ของเรา)** จาก `Scheduler.pending(now)` เพราะ `/validation/history` มีแต่วันที่ตรวจแล้ว |
| P8 | Clear / Remove ของ Access tool | ส่ง `to` = ชุดที่ติ๊กอยู่ (Constellation ที่ติ๊กครบใช้ path ของ Constellation) ตรงกับรายการ access แบบชุดเท่ากันตาม server §6.6; ไม่มีรายการตรง = ข้อความ info ไม่ใช่ error |
| P9 | ค่าในไฟล์ | ทศนิยม: มุม/ระยะ/Duration/DOP 3, IPP Lat/Lon 4, MF 5, rate 6, จำนวนเต็มไม่มีทศนิยม; คอลัมน์คั่นด้วย 4 ช่องว่าง; ไม่มีค่า = `N/A` (.txt) / ช่องว่าง (.csv) / `null` (json); Export Setup ตั้งต้น `,` / ไม่ใส่คำพูด / ไม่เขียนชื่อรายงาน / มีหัวคอลัมน์ |
| P10 | IPP Data | เฉพาะเวลาที่อยู่ใน access เหมือน AER Data (object เป็น Access) |
| P11 | หน้าต่างรายงาน/กราฟ | `persist: true`, `scenarioBound: true` (คืนจาก workbook แล้ว Generate ใหม่) ชื่อหลาย object = `Multiple Objects: <style>` |
| P12 | cache | `TableCache` ของ engine เก็บตารางที่อ่านแล้วต่อโฟลเดอร์ bundle (path จริง) ไม่เกิน 8 bundle LRU server ถือตัวเดียวใน `app.state.tables` CLI สร้างใหม่ทุกครั้ง |
| P13 | ทดสอบ 2 วินาที | engine: bundle สังเคราะห์ 130 ดวง 1 วัน step 30 s (Task 4); server: TestClient แบบ cache ว่างบน scenario 1 วัน (Task 6); e2e: จากคลิก Generate ถึงเห็นแถวแรก (Task 15) |
| P14 | Access Number กับหัวคอลัมน์ | element ชื่อ `Access Number` ตาม spec §3.2 แต่หัวคอลัมน์ในรายงานเป็น `Access` ตาม STK ref §F ("Columns Access, Start Time, Stop Time, Duration") ผ่าน `ElementInfo.header` |

---

## ส่วน engine

### Task 1: `ecef_to_geodetic` และตรวจขอบช่วง access กับการสุ่มทุก 1 วินาที

**Files:**
- Modify: `gnss_predict/geometry.py`
- Create: `tests/report_fixture.py` (โมเดลวงโคจรวงกลมใน ECEF และตัวสร้าง scenario ที่คำนวณแล้ว ใช้ร่วมกับ Task 2–4)
- Test: `tests/test_geometry.py`, `tests/test_analyze.py`

**Interfaces:**
- Produces:
  - `geometry.ecef_to_geodetic(x_km: float, y_km: float, z_km: float) -> tuple[float, float, float]` คืน `(lat_deg, lon_deg ∈ (−180, 180], h_km)`
  - `tests/report_fixture.py`: `circular_ecef_km(system: str, slot: int, slots: int, t_s: float) -> tuple[float, float, float]` (สูตรเดียวกับ `_fake_ecef_km` ใน `server/conftest.py`), `fake_propagate(sats, start, stop, step_s, work_dir, console, timeout_s=900, **_)`, `build_computed_scenario(root: Path, *, start="2026-11-10T00:00:00Z", stop="2026-11-10T06:00:00Z", step_s=60, ecef: Callable[[str, float], tuple[float, float, float]] | None = None) -> tuple[Path, Path]` คืน `(scenario_dir, data_dir)` ของ scenario ชื่อ `Test_Scen` ที่ `run_propagate` + `run_analyze("THBK")` แล้ว (patch `studio.propagate`, `find_gmat_console`, `gmat_version` แบบ `tests/test_studio_cli.py`; ดาว G01, G22, E11, R05, C01 จาก snapshot fixture)

- [ ] **Step 1: เขียน test ที่ fail** ใน `test_geometry.py` class `TestEcefToGeodetic`
  - `test_round_trip`: ทุก (lat, lon, h_m) ใน lat ∈ {−89.5, −45, 0, 13.729779, 60, 89.5}, lon ∈ {−179.9, 0, 100.781151, 180}, h_m ∈ {0, 6.4, 20_000_000} → `ecef_to_geodetic(*geodetic_to_ecef(lat, lon, h_m))` ต่างจาก lat/lon ไม่เกิน `1e-9` องศา และ h_km ต่างจาก `h_m / 1000` ไม่เกิน `1e-6` กม. (1 มม.)
  - `test_poles`: ให้ `b = WGS84_A_KM * (1 - WGS84_F)`: `(0, 0, b)` → lat `90.0` (±1e-9), h `0.0` (±1e-6); `(0, 0, -b - 1.0)` → lat `-90.0`, h `1.0` (±1e-6) ไม่หารด้วยศูนย์
  - `test_equator`: `(6378.137, 0, 0)` → `(0.0, 0.0, 0.0)` ทุกค่า ±1e-9; `(0, 6378.137 + 20000, 0)` → `(0.0, 90.0, 20000.0)`
  - `test_lon_range`: `(-6378.137, 0, 0)` → lon `180.0` ไม่ใช่ `-180.0`
- [ ] **Step 2: รันให้ fail** — `python3 -m unittest tests.test_geometry -v` Expected: `ImportError`/`AttributeError: ecef_to_geodetic`
- [ ] **Step 3: เขียน `ecef_to_geodetic`** ใน `geometry.py`: วนซ้ำ latitude แบบ Bowring/คงที่ จนการเปลี่ยนแปลงของ lat ≤ `1e-12` rad (จำกัด 20 รอบ) ใกล้ขั้ว (p < 1e-9 กม.) คืน ±90 และ h = |z| − b ตรง ๆ
- [ ] **Step 4: เขียน `tests/report_fixture.py`** แล้ว characterization test ใน `test_analyze.py` class `TestAccessEdgesAgainstOneSecondSampling` (§10.2 แถว 4; โค้ดเดิมควรผ่านเลย)
  - `test_edges_within_one_second`: ทุกดาวของ `fake_propagate` ช่วง 2026-11-10 00:00–24:00Z step 30 s → `access_intervals(eph, THBK)` (min_el 10°); เทียบกับช่วงจากมุมเงยของ `circular_ecef_km` ที่สุ่มทุก 1 วินาที (El ≥ 10 = ใน access) → จำนวนช่วงต่อดาวเท่ากัน และทุก start/stop ต่างไม่เกิน `1.0` วินาที (ยกเว้นขอบที่ถูกตัดที่ต้น/ท้ายช่วงวิเคราะห์ซึ่งต้องเท่ากันพอดี) และ `assertGreater(จำนวนขอบที่ตรวจ, 20)`
- [ ] **Step 5: รัน** — `python3 -m unittest tests.test_geometry tests.test_analyze -v` Expected: PASS ทั้งหมด
- [ ] **Step 6: Commit** — `git commit -m "feat(engine): ecef_to_geodetic and 1 s access edge check" -- gnss_predict/geometry.py tests/report_fixture.py tests/test_geometry.py tests/test_analyze.py`

### Task 2: Data Provider (`gnss_predict/dataproviders.py`)

**Files:**
- Create: `gnss_predict/dataproviders.py`
- Modify: `gnss_predict/errors.py` (เพิ่ม `ResultsNotCurrentError`, `StyleError`)
- Test: `tests/test_dataproviders.py`

**Interfaces:**
- Consumes: `ecef_to_geodetic` (Task 1), `studio.plan_propagate/plan_analyze`, `studio.MANIFEST`, `propagate.ephemeris_from_sp3`, `scenario.load_scenario`, `report_fixture.build_computed_scenario`
- Produces:
  - `errors.ResultsNotCurrentError(GnssPredictError)` code `"RESULTS_NOT_CURRENT"`; `errors.StyleError(GnssPredictError)` code `"STYLE_INVALID"`, `__init__(text: str, field: str)`
  - `@dataclass(frozen=True) ElementInfo(name: str, unit: str | None, kind: Literal["time", "number", "int"], interp: Literal["linear", "angle", "previous", "none"], header: str)` — `angle` สำหรับ Azimuth/Lon, `previous` สำหรับ N Visible และทุกคอลัมน์ของ N Asset Coverage, `none` สำหรับ Access Data; `header` คือหัวคอลัมน์ในรายงาน = `name` ยกเว้น Access Number ที่เป็น `"Access"` (P14)
  - `@dataclass(frozen=True) ProviderInfo(name: str, groups: list[str] | None, object_type: str, elements: list[ElementInfo], uses: list[str], ours: bool)` (`uses` ⊂ `["Reports", "Dynamic Displays"]`)
  - `PROVIDERS: dict[str, ProviderInfo]` ตาม Global Constraints ตรงตัว, `DOP_GROUPS = {"All Systems": "ALL", "GPS": "G", "GLONASS": "R", "Galileo": "E", "BeiDou": "C"}`
  - `class TableCache(max_bundles: int = 8)`: `.access(path: Path) -> AccessTables`, `.ephem_manifest(path: Path) -> dict`, `.ephem(path: Path) -> Ephemeris`; กุญแจคือ `path.resolve()`, LRU รวมทุกชนิดไม่เกิน `max_bundles`, `.loads: int` (นับครั้งที่อ่านดิสก์ ให้ test ดู)
  - `@dataclass(frozen=True) AccessTables(facility: str, aer: dict[str, list[tuple]], intervals: dict[str, list[tuple[datetime, datetime, float]]], global_statistics: dict, dop: dict[str, list[dict]])`
  - `@dataclass(frozen=True) ResultSet(scenario: EngineScenario, ephem_dir: Path | None, access_dirs: dict[str, Path], tables: TableCache)` พร้อม `.prn_of(satellite_name: str) -> str | None` (ผ่าน NORAD ของ scenario กับ manifest)
  - `open_result_set(scenario_dir: Path, data_dir: Path, tables: TableCache | None = None) -> ResultSet` ใช้เฉพาะ bundle ที่ hash ตรงกับ `plan_propagate`/`plan_analyze` และมีอยู่จริง
  - `access_path(facility: str, satellite: str) -> str` = `f"*/Facility/{facility} */Satellite/{satellite}"` และ `parse_object(obj: str) -> tuple[str, str, str | None]` คืน `("Access", facility, satellite)` / `("Facility", name, None)` / `("Satellite", name, None)` path ผิด → `ScenarioError(field="object")`; `display_name(obj) -> str` (`THBK-To-G01`, `THBK`, `G01`)
  - `list_providers(object_type: str) -> list[ProviderInfo]` (ชนิดที่ไม่รู้จัก รวม Constellation → `[]`)
  - `provider_rows(bundle: ResultSet, obj: str, provider: str, group: str | None, elements: list[str], start: datetime, stop: datetime, step_s: int | None) -> list[dict]` กุญแจของ dict = ชื่อ element, เวลาเป็น `datetime` UTC, ไม่มีค่า = `None`
  - `object_period(bundle: ResultSet, obj: str) -> tuple[datetime, datetime]` (ช่วงวิเคราะห์ของ scenario)

- [ ] **Step 1: เขียน test ที่ fail** ใน `tests/test_dataproviders.py` (setUp: `build_computed_scenario` ใน tempdir, `rs = open_result_set(...)`; ค่าจริงอ่านจากไฟล์ใน bundle ด้วย `csv`/`json` ตรง ๆ ใน test)
  - `test_list_providers`: `[p.name for p in list_providers("Access")] == ["Access Data", "AER Data", "IPP Data"]`; Facility → `["Dilution of Precision", "N Asset Coverage"]`; Satellite → `["LLA State"]`; `"Constellation"` → `[]`; IPP Data `ours is True` ที่เหลือ `False`; element ของ Access Data `["Access Number", "Start Time", "Stop Time", "Duration"]` หน่วย Duration `"sec"`
  - `test_access_data_matches_intervals_json`: G01 → แถวลำดับ `Access Number` 1..n, `Start Time`/`Stop Time` เท่ากับ `intervals.json` (parse ms) และ `Duration` เท่ากับ `duration_s` ทุกแถว
  - `test_aer_only_inside_access`: ทุกแถวของ AER Data G01 มีเวลาอยู่ในช่วงใดช่วงหนึ่งของ intervals และจำนวนแถว = จำนวนแถวของ `aer.csv` (G01) ที่อยู่ในช่วง ค่า Azimuth/Elevation/Range เท่ากับ `az_deg`/`el_deg`/`range_km` ทุกค่า
  - `test_ipp_data_matches_aer_csv`: Time, IPP Lat, IPP Lon, MF, Elevation เท่ากับ `ipp_lat_deg`, `ipp_lon_deg`, `mf`, `el_deg` ทุกแถวในช่วง access
  - `test_dop_every_group`: ทุก group ใน `DOP_GROUPS` → แถวเท่ากับแถว `system` ที่ตรงใน `dop.csv` ทุกค่า รวม `N Visible` = `n_visible` และช่องว่างใน csv เป็น `None`
  - `test_n_asset_coverage`: `Total` = n_visible ของ ALL, `GPS`/`GLONASS`/`Galileo`/`BeiDou` = ของ G/R/E/C ที่เวลาเดียวกัน
  - `test_lla_round_trip`: LLA State G01 ที่ step 60 → `geodetic_to_ecef(Lat, Lon, Alt*1000)` ต่างจากตำแหน่งใน `predicted.sp3` (หลังลบ 18 s) ไม่เกิน `1e-6` กม.
  - `test_lla_rates_circular_orbit` (§9 แถว 2): scenario ที่มีดาววงโคจรวงกลมเส้นศูนย์สูตรรัศมี 26560 กม. (ความเอียง 0) → `Lat Rate` ทุกแถว |x| ≤ 1e-9, `Alt Rate` |x| ≤ 1e-9, `Lon Rate` = `degrees(sqrt(398600.4418 / 26560**3) - 7.2921151467e-5)` ต่างไม่เกิน `1e-9` deg/sec ทุกแถวรวมแถวแรก/สุดท้าย (ผลต่างข้างเดียว) และแถวที่ลองจิจูดข้าม ±180
  - `test_step_rules` (§9 แถว 7): scenario step 60 → `step_s=None` ได้ทุกจุด, `120` ได้ทุกจุดที่ `(t − start) % 120 == 0`, `90`, `30`, `0`, `-60` → `ScenarioError` ที่ `exc.field == "time.step"`; Access Data ไม่สนใจ step (ได้แถวเท่ากันทุกค่า step ที่ถูก)
  - `test_window_clips`: start/stop กลางช่วง → Access Data ช่วงที่คร่อมขอบถูกตัดที่ start/stop พร้อม Duration ใหม่ (ปัดมิลลิวินาที) Access Number นับใหม่จาก 1; AER มีแค่ t ∈ [start, stop]
  - `test_window_outside_period_is_empty`: start/stop ทั้งคู่หลังช่วงวิเคราะห์ → `[]` ทุก provider; `start >= stop` → `ScenarioError(field="time.start")`
  - `test_unknown_names`: provider ที่ไม่มี → `StyleError(field="provider")`; element ที่ไม่มี → `StyleError(field="elements[<i>]")`; group ที่ไม่มีของ DOP → `StyleError(field="group")`; object ผิดชนิดกับ provider (LLA State กับ Facility) → `ScenarioError(field="object")`
  - `test_missing_results_raise`: ลบโฟลเดอร์ access ของ THBK แล้ว `provider_rows(...Access Data...)` → `ResultsNotCurrentError`; satellite ที่ไม่มีใน scenario → `ScenarioError(field="object")`
  - `test_table_cache_lru`: `TableCache(2)` อ่าน 3 bundle ต่างกันแล้วอ่านตัวแรกซ้ำ → `loads == 4`; อ่านตัวเดิมติดกัน → `loads` ไม่เพิ่ม
- [ ] **Step 2: รันให้ fail** — `python3 -m unittest tests.test_dataproviders -v` Expected: `ModuleNotFoundError: gnss_predict.dataproviders`
- [ ] **Step 3: เขียน `dataproviders.py` และ error ใหม่** — อ่าน csv/json ครั้งเดียวต่อ bundle เก็บต่อ PRN/ระบบเรียงตามเวลา; ช่วงเวลา: ตัดที่ `[start, stop]` ด้วย `bisect`; decimation = เก็บ t ที่ `(t − scenario.start)` หารด้วย step_s ลงตัว; rate ของ LLA จากจุดก่อน/หลังบนกริดของ scenario (ก่อน decimation) หารด้วยผลต่างเวลา, ลองจิจูด unwrap ก่อนลบ
- [ ] **Step 4: รัน** — `python3 -m unittest tests.test_dataproviders -v` Expected: PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(engine): data providers over analyze bundles" -- gnss_predict/dataproviders.py gnss_predict/errors.py tests/test_dataproviders.py`

### Task 3: Style และการประกอบรายงาน (`styles/installed.json`, `report_style.py`)

**Files:**
- Create: `gnss_predict/styles/installed.json`, `gnss_predict/report_style.py`
- Test: `tests/test_report_style.py`

**Interfaces:**
- Consumes: Task 2 ทั้งหมด
- Produces:
  - `installed_styles() -> list[dict]` (อ่าน `Path(__file__).parent / "styles" / "installed.json"` ครั้งเดียว คืนสำเนา)
  - `check_style(style: dict) -> None` ตรวจโครง (`name` ตาม P5 เฉพาะ style ของผู้ใช้, `kind` ∈ report/graph, `object_type` ∈ Access/Facility/Satellite, content ไม่ว่าง, provider/group/element มีจริงและตรง object_type, graph ตรง kind, y1/y2 เป็น element ใน content) ผิด → `StyleError(text, field)` เช่น `field="content[0].elements[2]"`
  - `resolve_style(name: str, kind: str | None, my: list[dict], scenario: list[dict]) -> dict` หาใน Scenario → My → Installed แบบไม่สนตัวพิมพ์ `kind=None` เลือก report ก่อน graph ไม่พบ → `StyleError(field="style")`
  - `@dataclass Column(name: str, unit: str | None, kind: str)`; `@dataclass Section(object: str, title: str, columns: list[Column], rows: list[list], summary: list[tuple[str, float | int | None]])`; `@dataclass Report(scenario: str, style: str, kind: str, created: datetime, sections: list[Section], global_statistics: list[tuple[str, float | int | None]], graph: dict | None, dynamic: bool)`
  - `build_report(rs: ResultSet, style: dict, objects: list[str], start: datetime | None, stop: datetime | None, step_s: int | None, now: datetime) -> Report` (`start`/`stop` = None = Use Object Time Period) `Section.title` = `display_name(obj)` (ตัวจัดรูปแบบเติม `:  <style>` เอง)

**Installed Styles (14 รายการ; `dynamic` = คอลัมน์สุดท้ายของ §3.4)**

| name | kind | object_type | content | อื่น | dynamic |
|---|---|---|---|---|---|
| Access | report | Access | Access Data: Access Number, Start Time, Stop Time, Duration | global_statistics: Min/Max/Mean/Total Duration (เมื่อ object > 1) | false |
| AccessSummary | report | Access | Access Data: Duration | per_object: Number of Accesses, Min/Max/Mean/Total Duration; summary_only: true | false |
| AER | report | Access | AER Data/Default: Time, Azimuth, Elevation, Range | — | true |
| Gaps | report | Access | Access Data: Start Time, Stop Time, Duration | derive: gaps (คอลัมน์ Gap, Start Time, Stop Time, Duration) | false |
| IPP Data | report | Access | IPP Data: Time, IPP Lat, IPP Lon, MF, Elevation | ours: true | true |
| Access | graph | Access | Access Data: Start Time, Stop Time | graph interval | false |
| AER | graph | Access | AER Data/Default: Time, Azimuth, Elevation, Range | time_xy y1 [Azimuth, Elevation] y2 [Range] | true |
| Elevation Angle | graph | Access | AER Data/Default: Time, Elevation | time_xy y1 [Elevation] | true |
| Az El Polar | graph | Access | AER Data/Default: Time, Azimuth, Elevation | polar90 | false |
| LLA Position | report | Satellite | LLA State/Fixed: Time, Lat, Lon, Alt, Lat Rate, Lon Rate, Alt Rate | — | true |
| All DOPs | report | Facility | Dilution of Precision/All Systems: Time, GDOP, PDOP, HDOP, VDOP, TDOP | — | true |
| All DOPs | graph | Facility | เหมือนข้างบน | time_xy y1 [GDOP, PDOP, HDOP, VDOP, TDOP] | true |
| N Asset Coverage | report | Facility | N Asset Coverage: Time, Total, GPS, GLONASS, Galileo, BeiDou | — | true |
| N Asset Coverage | graph | Facility | เหมือนข้างบน | time_xy y1 [GPS, GLONASS, Galileo, BeiDou] `"stack": true` | true |

- [ ] **Step 1: เขียน test ที่ fail** ใน `tests/test_report_style.py`
  - `test_installed_styles_table`: `[(s["name"], s["kind"], s["object_type"], s["dynamic"]) for s in installed_styles()]` เท่ากับตารางข้างบนตามลำดับ และทุกตัวผ่าน `check_style`
  - `test_access_report_columns_match_stk_style` (§10.2 แถว 4 ส่วนคอลัมน์): Access → `[c.name for c in section.columns] == ["Access", "Start Time", "Stop Time", "Duration"]` (หัวคอลัมน์ "Access" ตาม STK ref §F แถว Access report); AER → `["Time", "Azimuth", "Elevation", "Range"]`; All DOPs → `["Time", "GDOP", "PDOP", "HDOP", "VDOP", "TDOP"]`
  - `test_global_statistics_match_intervals_json` (§9 แถว 5): objects = ทุกดาวของ THBK ใน `intervals.json` ที่มีช่วง → `dict(report.global_statistics)` มี `"Min Duration"`, `"Max Duration"`, `"Mean Duration"`, `"Total Duration"` เท่ากับ `min_duration_s`, `max_duration_s`, `mean_duration_s`, `total_duration_s` ของไฟล์ (±0.0005)
  - `test_single_object_has_no_global_statistics`: Access กับ G01 ตัวเดียว → `global_statistics == []`
  - `test_gaps_complement` (§9 แถว 4): ต่อดาว: ช่วงของ Gaps ∪ ช่วงของ Access = ช่วงวิเคราะห์พอดี ไม่ทับกัน เรียงตามเวลา; ดาวที่ไม่มี access เลย → Gap 1 ช่วงเท่าช่วงวิเคราะห์; ดาวที่อยู่ใน access ตลอด → ไม่มีแถว
  - `test_access_summary`: ต่อ object summary = `[("Number of Accesses", n), ("Min Duration", …), ("Max Duration", …), ("Mean Duration", …), ("Total Duration", …)]` จาก intervals และ `rows == []` (summary_only)
  - `test_access_with_no_intervals_has_empty_section`: ดาวที่ไม่มีช่วง → Section ที่ `rows == []` และ summary ค่า `None` ยกเว้น `Number of Accesses == 0`
  - `test_std_deviation_population`: style ผู้ใช้ที่ per_object `["Std Deviation Duration"]` กับช่วง 3 ช่วงที่รู้ค่า → ค่าตาม `statistics.pstdev`
  - `test_check_style_errors`: element `"Bogus"` → `StyleError.field == "content[0].elements[1]"`; provider ผิด object_type → `"content[0].provider"`; graph y1 อ้าง element ที่ไม่อยู่ใน content → `"graph.y1[0]"`
  - `test_resolve_order`: Scenario Style ชื่อ "Mine" กับ My Style "Mine" → ได้ของ scenario; `"access"` kind None → Installed Access report; `"Az El Polar"` kind None → graph; ไม่มีชื่อ → `StyleError(field="style")`
- [ ] **Step 2: รันให้ fail** — `python3 -m unittest tests.test_report_style -v` Expected: `ModuleNotFoundError`
- [ ] **Step 3: เขียน `installed.json` และ `report_style.py`** — แถวของ Section มาจาก `provider_rows`; Gaps: ต่อ object ใช้ Access Data ช่วงวิเคราะห์ (หรือ start/stop) แล้วหาส่วนเติมเต็ม; ไม่มี start/stop และ object เป็น Access ใช้ช่วงวิเคราะห์ (การตัดตาม time_period ของ access เป็นหน้าที่ server)
- [ ] **Step 4: รัน** — `python3 -m unittest tests.test_report_style -v` Expected: PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(engine): installed report styles and report assembly" -- gnss_predict/styles/installed.json gnss_predict/report_style.py tests/test_report_style.py`

### Task 4: ตัวจัดรูปแบบ, ไฟล์ต้นแบบ และ CLI `report`

**Files:**
- Create: `gnss_predict/report_format.py`, `tests/fixtures/reports/` (28 ไฟล์), `tests/test_report_format.py`
- Modify: `gnss_predict/studio.py` (subcommand `report`, docstring บนสุด)
- Test: `tests/test_report_format.py`, `tests/test_studio_cli.py`

**Interfaces:**
- Consumes: Task 2–3
- Produces:
  - `format_time(t: datetime, date_format: str, ltz_offset: str) -> str` ตรงกับ `formatTime` ของหน้าเว็บ: `1 Jan 2026 16:00:00.000 UTCG` / `12 Nov 2026 14:00:00.000 LTZG+07:00`
  - `time_unit(date_format: str, ltz_offset: str) -> str` (`"UTCG"` / `"LTZG+07:00"`)
  - `@dataclass(frozen=True) ExportSetup(delimiter: str = ",", quote_headers: bool = False, title: bool = False, headers: bool = True)`
  - `format_txt(report: Report, date_format: str, ltz_offset: str) -> str`
  - `format_csv(report: Report, date_format: str, ltz_offset: str, setup: ExportSetup = ExportSetup()) -> str`
  - `report_json(report: Report) -> dict` — `{"scenario","style","kind","created_utc","sections":[{"object","title","columns":[{"name","unit","kind"}],"rows","summary":[{"name","value"}]}],"global_statistics":[{"name","value"}],"graph","dynamic"}` เวลาเป็น ISO `…sss Z` มิลลิวินาที
  - `report_filename(report: Report, ext: str) -> str` — หนึ่ง object `THBK-To-G01_Access.txt`, หลาย object `Access.txt` (ช่องว่างเป็น `_`)
  - CLI `report` ตาม Global Constraints เพิ่ม `--data DIR`, `--kind report|graph` (ไม่บังคับ), `--object` ซ้ำได้ (หลาย object) พิมพ์ผลลง stdout ไม่พิมพ์ path

- [ ] **Step 1: เขียน test ที่ fail** ใน `tests/test_report_format.py`
  - `test_format_time`: `datetime(2026,1,1,16,tzinfo=UTC)` UTCG → `"1 Jan 2026 16:00:00.000 UTCG"`; `2026-11-12T07:00:00.5Z` LTZG `+07:00` → `"12 Nov 2026 14:00:00.500 LTZG+07:00"`
  - `test_txt_layout`: Access กับ G01, E11 created `2026-11-15T00:00:00Z`: บรรทัด 1 = `"Test_Scen    15 Nov 2026 00:00:00.000 UTCG"`; มีบรรทัด `"THBK-To-G01:  Access"`; หัวคอลัมน์มี `"Start Time (UTCG)"` และ `"Duration (sec)"`; บรรทัดใต้หัวมีแต่ `-` และช่องว่าง ความยาวเท่าบรรทัดหัว; ทุกบรรทัดข้อมูลของส่วนเดียวกันยาวเท่ากัน (คอลัมน์คงที่) ตัวเลขชิดขวา; มีบรรทัด `"Global Statistics"` ตามด้วย `"-----------------"` และ `"Total Duration"`
  - `test_txt_no_data_and_na`: ดาวที่ไม่มี access → ใต้หัวคอลัมน์มี `"No Data"` และ Global Statistics ที่ทุกช่วงว่าง → `"N/A"`; csv ของค่า None เป็นช่องว่าง
  - `test_csv_header_and_setup`: ตั้งต้น บรรทัดแรก = `"Access,Start Time (UTCG),Stop Time (UTCG),Duration (sec)"` ไม่มีคำว่า `Global Statistics`; `ExportSetup(delimiter=";", quote_headers=True, title=True)` → บรรทัดแรก `"THBK-To-G01:  Access"`, บรรทัดสอง `"\"Access\";\"Start Time (UTCG)\";…"`; `headers=False` → บรรทัดแรกเป็นข้อมูล
  - `test_date_format_ltzg`: scenario LTZG → หัว `"Start Time (LTZG+07:00)"` และเวลาเลื่อน +7 ชม.
  - `test_golden_files` (§9 แถว 6): ทุก style ใน `installed_styles()` (objects: Access → `[access_path("THBK","G01"), access_path("THBK","E11")]`, Facility → `["*/Facility/THBK"]`, Satellite → `["*/Satellite/G01"]`, now `2026-11-15T00:00:00Z`) → `format_txt` และ `format_csv` เท่ากับ `tests/fixtures/reports/<slug>_<kind>.txt|.csv` ทุกตัวอักษร (slug = ชื่อตัวพิมพ์เล็ก ช่องว่างเป็น `_` เช่น `az_el_polar_graph.csv`) ไฟล์ไม่มี = fail ยกเว้นตั้ง `GNSS_WRITE_GOLDEN=1` ซึ่งเขียนไฟล์แล้ว `skipTest`
  - `test_report_json_shape`: `report_json` ของ AER มีคีย์ตาม Interfaces เวลาแถวแรกรูปแบบ `^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$`
  - `test_access_report_one_day_under_2s` (เกณฑ์ข้อ 3, P13): เขียน bundle สังเคราะห์ใน tempdir — scenario 1 วัน step 30 s (2881 จุด), 130 PRN (G01–G32, R01–R24, E01–E36, C01–C38), `aer.csv` ทุก PRN ทุกจุด El = 45 (374,530 แถว), `intervals.json` ช่วงละ 4 ชม. ต่อดาว, `dop.csv` 5 ระบบ; `ResultSet` จาก `TableCache()` ว่าง → เวลารวมของ `build_report(Access, [access_path("THBK","G01")])` + `format_txt` วัดด้วย `time.perf_counter` `assertLess(elapsed, 2.0)` และ AER ของคู่เดียวกันวันเดียว `assertLess(elapsed, 2.0)`
- [ ] **Step 2: เขียน test ของ CLI** ใน `tests/test_studio_cli.py` class `TestReportCli` (ใช้ `build_computed_scenario`)
  - `test_report_txt_to_stdout`: `run_main(["report","--scenario",sc,"--data",data,"--style","Access","--object","*/Facility/THBK */Satellite/G01"])` → code 0, stdout เท่ากับ `format_txt` ของรายงานเดียวกัน (เทียบโดยตัดบรรทัดแรกที่มีเวลาสร้าง)
  - `test_report_csv_with_window`: `--format csv --start 2026-11-10T01:00:00Z --stop 2026-11-10T02:00:00Z --step 120 --style AER` → บรรทัดแรก `"Time (UTCG),Azimuth (deg),Elevation (deg),Range (km)"` และทุกเวลาอยู่ใน 01:00–02:00 ห่างกันเป็นจำนวนเท่าของ 120 s
  - `test_report_errors`: `--step 90` → code 1 stderr `"error: SCENARIO_INVALID:"`; style ไม่มี → code 1 `"STYLE_INVALID"`; ไม่มีผล analyze → code 1 `"RESULTS_NOT_CURRENT"`; ไม่ส่ง `--object` → code 2
- [ ] **Step 3: รันให้ fail** — `python3 -m unittest tests.test_report_format tests.test_studio_cli -v` Expected: `ModuleNotFoundError: gnss_predict.report_format` และ `invalid choice: 'report'`
- [ ] **Step 4: เขียน `report_format.py` และ subcommand `report`** (CLI ไม่รัน GMAT และไม่ analyze ให้: ไม่มีผลที่ตรง = `RESULTS_NOT_CURRENT` เพื่อให้ผู้ใช้สั่ง analyze เอง)
- [ ] **Step 5: สร้างไฟล์ต้นแบบแล้วตรวจด้วยตา** — `GNSS_WRITE_GOLDEN=1 python3 -m unittest tests.test_report_format -v` แล้วเปิด `tests/fixtures/reports/access_report.txt` เทียบ Start/Stop/Duration ของ G01 กับ `intervals.json` ของ fixture ด้วยมือ และดูว่า `az_el_polar_graph.csv` มีแต่แถวใน access (ห้ามรับไฟล์ต้นแบบโดยไม่ตรวจ)
- [ ] **Step 6: รัน** — `python3 -m unittest discover -s tests -v` Expected: PASS ทั้งชุด (test เดิมไม่เปลี่ยน)
- [ ] **Step 7: Commit** — `git commit -m "feat(engine): txt/csv report formatter, golden files and report CLI" -- gnss_predict/report_format.py gnss_predict/studio.py tests/test_report_format.py tests/test_studio_cli.py tests/fixtures/reports`

## ส่วน server

### Task 5: `/dataproviders`, `/data`, `/styles` และ cache ของตาราง

**Files:**
- Create: `server/gnss_studio_server/routes/reports.py` (route ของ §6.7 ทั้งหมด), `server/gnss_studio_server/styles.py` (My Styles บนดิสก์)
- Modify: `server/gnss_studio_server/app.py` (`app.state.tables = TableCache(8)`, include router), `server/gnss_studio_server/routes/__init__.py` (`get_tables`), `server/gnss_studio_server/errors.py` (แปลง `StyleError` → 422 `STYLE_INVALID` มี `field`, `ResultsNotCurrentError` → 409 `RESULTS_NOT_CURRENT`)
- Regenerate: `web/src/api/openapi.json`, `types.gen.ts`, `enums.gen.ts`
- Test: `server/tests/test_reports.py`

**Interfaces:**
- Consumes: Task 2–3; `routes/results.access_entries/ephem_entry`, `PlanCache`, `access.satellite_prns`
- Produces:
  - `server_result_set(store, plans, tables, sc) -> ResultSet` (ใน `routes/reports.py`: bundle ที่ status `current` เท่านั้น)
  - `GET /api/scenarios/{sc}/dataproviders?class=Facility|Satellite|Access&name=` → `[{name, groups, elements:[{name, unit, kind, interp}], uses, ours}]` (Access: `name` = path ของคู่ตาม P1) object ไม่มี → 422 `field: name`
  - `GET /api/scenarios/{sc}/data?object=&provider=&group=&elements=<ซ้ำได้>&start=&stop=&step=` → `{"columns":[...], "rows":[[...]]}` เวลาเป็น ISO ms Z
  - `GET /api/styles?object_type=&scenario=` → `{"installed":[style], "my":[style], "scenario":[style]}` (กรองตาม object_type ถ้าระบุ; `scenario` ไม่ระบุ = `[]`)
  - `POST /api/styles/{name}` (สร้าง, ซ้ำ → 409 `NAME_EXISTS`), `PUT /api/styles/{name}` (สร้างหรือแทน), `DELETE /api/styles/{name}` (204; ไม่มี → 404) body = style JSON ที่ `name` ต้องเท่ากับ path
  - `styles.MyStyles(data_dir)`: `.list() -> list[dict]`, `.save(style) -> None` (atomic), `.delete(name) -> None`; ไฟล์ `data/styles/<name>.json`

- [ ] **Step 1: เขียน test ที่ fail** ใน `server/tests/test_reports.py` (fixture `client`, `s1_computed`; ค่าจริงจากไฟล์ใน `s1_computed["access_dir"]`)
  - `test_dataproviders_by_class`: Facility THBK → ชื่อ `["Dilution of Precision", "N Asset Coverage"]`; Access `name="*/Facility/THBK */Satellite/G01"` → `["Access Data", "AER Data", "IPP Data"]` และ IPP Data `ours == True`; `class=Constellation` → `[]`; `name=NOPE` → 422 `field == "name"`
  - `test_data_matches_engine`: `/data` AER Data G01 → `rows` เท่ากับ `provider_rows` ของ engine บน `open_result_set` เดียวกัน (เวลาแปลงเป็น ISO ms Z); `step=45` → 422 `SCENARIO_INVALID` `field == "time.step"`
  - `test_data_on_stale_results_is_409`: แก้ min elevation ของ THBK ผ่าน PATCH แล้ว `/data` → 409 `RESULTS_NOT_CURRENT`
  - `test_tables_cached_per_bundle`: `/data` สองครั้ง → `app.state.tables.loads` เพิ่มครั้งเดียว
  - `test_styles_tiers`: `GET /styles?object_type=Access` → installed 9 ตัว (ตาราง Task 3 ที่เป็น Access), my `[]`; PUT My Style "Mine" แล้ว GET → my มี "Mine" และไฟล์ `data/styles/Mine.json` มีอยู่; DELETE → 204 และไฟล์หาย; `GET /styles?scenario=S1` หลังใส่ `styles: [<style "ScStyle">]` ใน scenario ด้วย PUT → scenario มี "ScStyle"
  - `test_my_style_name_rules` (Review Focus 5) parametrize: `"../x"`, `"a/b"`, `""`, `" lead"`, 49 ตัวอักษร → 422 `field == "name"`; `"access"` (ซ้ำ Installed ไม่สนตัวพิมพ์) → 409 `NAME_EXISTS`; body `name` ≠ path → 422 `field == "name"`; element ไม่มี → 422 `STYLE_INVALID` `field == "content[0].elements[0]"`
  - `test_broken_style_file_is_skipped`: เขียน `data/styles/Bad.json` = `"{"` และ `data/styles/Arr.json` = `"[]"` → `GET /styles` 200, my ไม่มีสองตัวนี้ และ `server.log` มีชื่อไฟล์
  - `test_style_write_needs_same_origin`: PUT พร้อม `Origin: http://evil.example` → 403 `FORBIDDEN_ORIGIN`
- [ ] **Step 2: รันให้ fail** — `cd server && .venv/bin/python -m pytest -q -W error tests/test_reports.py` Expected: 404 ทุก route
- [ ] **Step 3: เขียน route, `styles.py`, การแปลง error และ `app.state.tables`** (route ที่อ่านดิสก์เป็น `def` ธรรมดาแบบ route เดิม)
- [ ] **Step 4: รัน** — `cd server && .venv/bin/python -m pytest -q -W error` Expected: PASS ทั้งชุด
- [ ] **Step 5: สร้าง type ใหม่** — `cd web && npm run gen:api && npm run typecheck` Expected: ผ่าน, `types.gen.ts` มี path `/api/styles`
- [ ] **Step 6: Commit** — `git commit -m "feat(server): data providers, data and report styles API" -- server/gnss_studio_server/routes/reports.py server/gnss_studio_server/styles.py server/gnss_studio_server/app.py server/gnss_studio_server/routes/__init__.py server/gnss_studio_server/errors.py server/tests/test_reports.py web/src/api`

### Task 6: `POST /scenarios/{sc}/reports`

**Files:**
- Modify: `server/gnss_studio_server/routes/reports.py`
- Regenerate: `web/src/api/*`
- Test: `server/tests/test_reports.py`

**Interfaces:**
- Consumes: Task 4–5; `access.stored_time_period`, `access.normalize`
- Produces: `POST /api/scenarios/{sc}/reports` body `ReportBody {style: str, kind: "report" | "graph" | None = None, objects: list[str] (≥ 1), time: {mode: "object" | "specify" = "object", start?: UtcZ, stop?: UtcZ, step_s?: int | None}, format: "json" | "txt" | "csv" = "json", dynamic: bool = False, export?: {delimiter: str (1 ตัวอักษร), quote_headers: bool, title: bool, headers: bool}}`
  - json → `report_json(...)`; txt/csv → `text/plain; charset=utf-8` / `text/csv; charset=utf-8` พร้อม `Content-Disposition: attachment; filename="<report_filename>"`
  - mode `object` กับ Access: ใช้ `time_period` ที่เก็บของ access (from, [to]) ที่ตรง (`specify` = ตัดตาม start/stop นั้น, spec §4 "ตัดช่วงในรายงาน ไม่ต้องคำนวณใหม่")
  - `dynamic: true` กับ style ที่ `dynamic: false` → 422 `field == "dynamic"`
  - DateFormat/LTZ จาก `scenario.units`

- [ ] **Step 1: เขียน test ที่ fail** ต่อใน `test_reports.py`
  - `test_report_json_matches_engine` (§9 แถว server): Access G01 json → `sections[0].rows` เท่ากับ `intervals.json` ของ G01 (start/stop/duration_s) และ `title == "THBK-To-G01"`
  - `test_report_txt_csv_files`: format txt → `content-type` เริ่ม `text/plain`, `Content-Disposition == 'attachment; filename="THBK-To-G01_Access.txt"'`, body มี `"THBK-To-G01:  Access"`; csv → บรรทัดแรก `"Access,Start Time (UTCG),Stop Time (UTCG),Duration (sec)"`; export `{"delimiter": ";", "quote_headers": true, "title": false, "headers": true}` → `"\"Access\";\"Start Time (UTCG)\";…"`
  - `test_report_uses_stored_time_period`: compute access THBK→[G01] ด้วย `time_period: {mode: "specify", start: "2026-11-10T01:00:00Z", stop: "2026-11-10T02:00:00Z"}` แล้ว Access report mode object → ทุกแถวอยู่ใน 01:00–02:00
  - `test_report_time_errors` (Review Focus 4): `step_s` 45 → 422 `field == "time.step"`; mode specify ไม่มี stop → 422 `field == "time.stop"`; start ≥ stop → 422 `field == "time.start"`
  - `test_report_on_stale_results_is_409` (Review Focus 3): แก้ min elevation แล้ว POST → 409 `RESULTS_NOT_CURRENT`
  - `test_report_style_errors`: style ไม่มี → 422 `STYLE_INVALID` `field == "style"`; My Style ที่ไฟล์ถูกแก้มือให้อ้าง element `"Bogus"` → 422 `STYLE_INVALID` `field == "content[0].elements[1]"`; `dynamic: true` กับ Access → 422 `field == "dynamic"`
  - `test_report_one_day_under_2s` (เกณฑ์ข้อ 3, P13): scenario `D1` ช่วง 2026-11-10T00:00Z–11T00:00Z step 30 แบบ thbk-gnss + `fake_gmat`, run_propagate/run_analyze ใน test แล้วล้าง `app.state.tables` → วัด `client.post(".../reports", json={style: "Access", objects: ["*/Facility/THBK */Satellite/G01"]})` ด้วย `time.perf_counter` `assert elapsed < 2.0` และ status 200
- [ ] **Step 2: รันให้ fail** — `cd server && .venv/bin/python -m pytest -q -W error tests/test_reports.py` Expected: 404/405 ที่ `/reports`
- [ ] **Step 3: เขียน route** (pydantic `extra="forbid"`, ไฟล์ส่งเป็น `Response` พร้อม header)
- [ ] **Step 4: รัน** — `cd server && .venv/bin/python -m pytest -q -W error` Expected: PASS
- [ ] **Step 5: สร้าง type ใหม่** — `cd web && npm run gen:api && npm run typecheck` Expected: ผ่าน
- [ ] **Step 6: Commit** — `git commit -m "feat(server): report generation as json, txt and csv" -- server/gnss_studio_server/routes/reports.py server/tests/test_reports.py web/src/api`

### Task 7: สถานะ Pending / Gave up ของการตรวจย้อนหลัง

**Files:**
- Modify: `server/gnss_studio_server/scheduler.py` (`pending`), `server/gnss_studio_server/routes/validation.py` (route + docstring)
- Regenerate: `web/src/api/*`
- Test: `server/tests/test_scheduler.py`, `server/tests/test_validation_settings.py`

**Interfaces:**
- Consumes: `daily_scenarios`, `_validated`, `_State`, `give_up_deadline`, settings `validation_retry_hours`
- Produces:
  - `Scheduler.pending(now: datetime) -> list[dict]` ต่อ `(scenario, for_date)` ที่ `for_date ≤ วันนี้ − 1` และยังไม่มี `validation_<day>.json`: `{"scenario", "day", "state": "pending" | "gave_up", "next_attempt_utc": str | None}` — gave_up เมื่ออยู่ใน `given_up` (`next_attempt_utc: None`); pending: มี job validate ของวันนั้นที่รอ/รัน = `now`, ไม่งั้น `max(now, last_validation_attempt_utc + validation_retry_hours)`; ปิดงานประจำวัน (`enabled: false`) = pending ทุกตัวมี `next_attempt_utc: None` เรียงตาม day แล้ว scenario
  - `GET /api/validation/pending` → รายการข้างบน (อ่านเท่านั้น ไม่สั่ง job ไม่เขียน state)

- [ ] **Step 1: เขียน test ที่ fail**
  - `test_scheduler.py::test_pending_states` (นาฬิกาจำลองแบบ test เดิม): daily_20261110 (ยังไม่ตรวจ, attempt ล่าสุด 2026-11-12T03:00Z, retry 3) ที่ now 2026-11-12T04:00Z → `{"state": "pending", "next_attempt_utc": "2026-11-12T06:00:00Z"}`; daily_20261109 อยู่ใน given_up → `{"state": "gave_up", "next_attempt_utc": None}`; daily_20261108 ที่มี `validation_2026-11-08.json` → ไม่อยู่ในรายการ; daily ของวันนี้ → ไม่อยู่
  - `test_scheduler.py::test_pending_does_not_submit`: `pending()` แล้ว `jobs.list()` ว่างและ `data/daily/state.json` ไม่ถูกสร้าง
  - `test_validation_settings.py::test_pending_route`: `GET /api/validation/pending` → 200 รายการเดียวกับ `app.state.scheduler.pending(now)` ที่ patch นาฬิกา; ไม่มี scenario รายวัน → `[]`
- [ ] **Step 2: รันให้ fail** — `cd server && .venv/bin/python -m pytest -q -W error tests/test_scheduler.py tests/test_validation_settings.py` Expected: `AttributeError: pending` และ 404
- [ ] **Step 3: เขียน `pending` และ route**
- [ ] **Step 4: รัน** — `cd server && .venv/bin/python -m pytest -q -W error` Expected: PASS
- [ ] **Step 5: type** — `cd web && npm run gen:api && npm run typecheck`
- [ ] **Step 6: Commit** — `git commit -m "feat(server): pending and gave-up validation days" -- server/gnss_studio_server/scheduler.py server/gnss_studio_server/routes/validation.py server/tests/test_scheduler.py server/tests/test_validation_settings.py web/src/api`

## ส่วนหน้าเว็บ

### Task 8: ชั้นข้อมูลของรายงาน, Dynamic Display และ ECharts แบบ lazy

**Files:**
- Modify: `web/package.json`, `web/package-lock.json` (ผู้ใช้ติดตั้ง), `web/vite.config.ts` (กลุ่ม chunk `echarts`), `web/src/api/startJob.ts` (แยก `recordQueuedJob`)
- Create: `web/src/data/reports.ts`, `web/src/data/dynamic.ts`, `web/src/windows/Graph/chart.ts`
- Test: `web/tests/unit/reports-data.test.ts`, `web/tests/unit/dynamic.test.ts`, `web/tests/unit/echarts-chunk.test.ts`

**Interfaces:**
- Produces:
  - `data/reports.ts`: type `ReportJson` (ตาม `report_json` Task 4), `StyleDef`, `StyleTiers = {installed, my, scenario}`, `ReportRequest` (= body ของ Task 6 ไม่มี `format`), `fetchReport(sc: string, req: ReportRequest, signal?: AbortSignal): Promise<ReportJson>`, `downloadReport(sc: string, req: ReportRequest, format: "txt" | "csv", setup?: ExportSetup): Promise<void>` (Blob + `<a download>` ชื่อจาก `Content-Disposition`), `fetchStyles(objectType: string | null, sc: string | null): Promise<StyleTiers>`, `saveMyStyle(style)`, `deleteMyStyle(name)`, `fetchProviders(sc, cls, name)`, `accessPath(facility, satellite)`, `accessName(path)` (`THBK-To-G01`), `reportTitle(objects: string[], style: string): string` (`THBK-To-G01: Access` / `Multiple Objects: Access`)
  - `data/dynamic.ts`: `type Interp = "linear" | "angle" | "previous" | "none"`; `valueAt(rows: readonly (readonly unknown[])[], times: readonly number[], t: number, interps: readonly Interp[], maxGapMs: number): (number | null)[] | null` — นอกช่วงหรือช่องว่าง > `maxGapMs` (= step ของ scenario × 1.5) = null; `angle` ประมาณเชิงเส้นตามทางสั้นที่สุดแล้วคืนใน [0, 360)
  - `windows/Graph/chart.ts`: `loadECharts(): Promise<typeof import("echarts")>` (memo, `import("echarts")` ที่เดียวในแอป)
  - `api/startJob.ts`: `recordQueuedJob(id: string, kind: JobKind, scenario: string | null): void` (startJob เรียกใช้)

- [ ] **Step 1: ติดตั้ง ECharts (ผู้ใช้ทำ)** — หยุดแล้วขอให้ผู้ใช้รัน `cd <R>/web && npm install --save-exact echarts@6.1.0`; ตรวจ `grep '"echarts": "6.1.0"' web/package.json` และ `grep -A3 '"node_modules/echarts"' web/package-lock.json` มี integrity ตาม Global Constraints ไม่ตรง = หยุด
- [ ] **Step 2: เขียน test ที่ fail**
  - `dynamic.test.ts`: `linear between points` (t กลางระหว่าง 10 กับ 20 → 15); `previous keeps the earlier count` (5 → 7 ที่ t กลาง → 5); `azimuth interpolates across north` (Review Focus 1: 359 → 1 ที่กลาง → 0, ที่ 1/4 → 359.5); `null outside the rows and across a gap` (ก่อนแถวแรก, หลังแถวสุดท้าย, ช่องว่าง 600000 ms กับ maxGap 90000 → null); `exact sample returns it`
  - `reports-data.test.ts` (`stubFetch`): `fetchReport posts the request` (POST `/api/scenarios/S1/reports` body มี `format: "json"`); `downloadReport names the file from Content-Disposition` (`THBK-To-G01_Access.txt`); `reportTitle` (`["*/Facility/THBK */Satellite/G01"], "Access"` → `"THBK-To-G01: Access"`, สอง object → `"Multiple Objects: Access"`); `fetchStyles` query `object_type=Access&scenario=S1`
  - `echarts-chunk.test.ts`: `vi.mock("echarts", () => { throw new Error("echarts must load lazily") })` แล้ว import `src/data/reports`, `src/data/dynamic`, `src/windows/Graph/chart` ได้โดยไม่ล้ม และ `loadECharts()` reject (พิสูจน์ว่า import อยู่ในฟังก์ชัน)
- [ ] **Step 3: รันให้ fail** — `cd web && npx vitest run tests/unit/dynamic.test.ts tests/unit/reports-data.test.ts tests/unit/echarts-chunk.test.ts` Expected: ไม่พบโมดูล
- [ ] **Step 4: เขียนโมดูล** และใน `vite.config.ts` เพิ่มกลุ่ม `{ name: "echarts", test: /[\\/]node_modules[\\/](echarts|zrender)[\\/]/ }` ใน `codeSplitting.groups`
- [ ] **Step 5: รัน** — `cd web && npm test && npm run typecheck` Expected: PASS (การตรวจ chunk ของ build ทำใน Task 10 เมื่อมีหน้าต่างที่เรียก `loadECharts` จริง)
- [ ] **Step 6: Commit** — `git commit -m "feat(web): report data client, dynamic display interpolation and lazy echarts" -- web/package.json web/package-lock.json web/vite.config.ts web/src/api/startJob.ts web/src/data/reports.ts web/src/data/dynamic.ts web/src/windows/Graph/chart.ts web/tests/unit/dynamic.test.ts web/tests/unit/reports-data.test.ts web/tests/unit/echarts-chunk.test.ts`

### Task 9: หน้าต่างรายงาน

**Files:**
- Create: `web/src/windows/Report/Report.tsx`, `web/src/windows/Report/table.ts`, `web/src/windows/Report/ExportSetupDialog.tsx`
- Modify: `web/src/layout/panels.ts` (kind `report`), `web/src/App.tsx` (register), `web/src/labels/labels.ts`, `web/src/labels/messages.th.ts`, `web/tests/unit/labels.test.ts` (PROSE_EVIDENCE ที่ใช้), `web/src/cesium/testHooks.ts` (`reportRows(panelId)`)
- Test: `web/tests/unit/report-window.test.tsx`

**Interfaces:**
- Consumes: Task 8; `ResultsBanner` จาก `windows/graphics/GraphicsFrame.tsx`, `useTime`, `formatTime`, `windows/virtualList.ts`
- Produces:
  - panel kind `"report"`: `{label: "window.report", type: "integrated", multiple: true, persist: true, scenarioBound: true, title: (p) => reportTitle(p.objects, p.style), instanceKey: (p) => JSON.stringify([p.style, p.kind, p.objects, p.time, p.dynamic])}`
  - `type ReportParams = {style: string; kind: "report" | "graph"; objects: string[]; time: ReportRequest["time"]; dynamic: boolean}`; `openReport(params: ReportParams): void` (ใน `Report.tsx`)
  - `table.ts`: `flattenRows(report: ReportJson, fmt: DateFormat, ltz: string): {cells: string[]; section: number; kind: "row" | "title" | "summary" | "global" | "nodata"}[]`
  - test hook `reportRows(panelId: string): string[][]` (เซลล์ที่แสดงอยู่ทั้งหมด ไม่ขึ้นกับการเลื่อน)

- [ ] **Step 1: เขียน test ที่ fail** ใน `report-window.test.tsx` (`stubFetch` ตอบ `ReportJson` ตัวอย่าง 2 object มี Global Statistics)
  - `renders sections and global statistics`: มีแถวหัวส่วน `THBK-To-G01`, หัวคอลัมน์ `Start Time (UTCG)`, บล็อก `t("report.globalStatistics")` ท้ายตาราง
  - `scrolls 200000 rows virtually`: รายงาน 200,000 แถว → DOM มี `<tr>` ไม่เกิน 200
  - `times follow the scenario DateFormat`: doc LTZG `+07:00` → เซลล์เวลาลงท้าย `LTZG+07:00`
  - `refresh button and F5 reload`: คลิก Refresh และกด F5 ในหน้าต่าง → POST `/reports` ครั้งที่สอง; F5 นอกหน้าต่างไม่เรียก
  - `export to csv uses the setup`: Export ▸ To CSV Format... หลังตั้ง Setup... delimiter `;` → POST body `format: "csv"` และ `export.delimiter == ";"`
  - `set animation time from a time cell`: คลิกขวาเซลล์เวลา → Set Animation Time → `useTime.getState().current` = เวลานั้น
  - `report does not follow animation time`: เปลี่ยนเวลา animation → ไม่มี POST ใหม่และแถวเดิม
  - `dynamic display shows the row at the current time`: `dynamic: true` AER → แสดงหนึ่งแถว ค่าที่ t กลางสองจุด = ค่าที่ประมาณเชิงเส้น; เดินเวลา 3 ครั้ง → POST `/reports` ครั้งเดียว
  - `stale results show the banner and Refresh computes` (Review Focus 3): 409 `RESULTS_NOT_CURRENT` → แสดง `ResultsBanner`; Refresh ส่ง POST `/access/compute` (Access) ด้วย If-Match แล้วรอ job (`recordQueuedJob`) เมื่อ job `succeeded` สร้างรายงานใหม่
  - `style error goes to the Message Viewer`: 422 `STYLE_INVALID` → `useMessages` มีรายการ code `STYLE_INVALID` และตารางว่างพร้อม `msg("report.styleInvalid")`
  - `labels`: `t("report.toCsvFormat") === "To CSV Format..."` source ours, `t("report.setAnimationTime")` source stk §F
- [ ] **Step 2: รันให้ fail** — `cd web && npx vitest run tests/unit/report-window.test.tsx tests/unit/labels.test.ts` Expected: FAIL
- [ ] **Step 3: เขียนหน้าต่าง** (ตาราง TanStack Virtual; Export ▸ เป็น Radix DropdownMenu ของ Menubar เดิม)
- [ ] **Step 4: รัน** — `npm test && npm run typecheck` Expected: PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(web): report window with dynamic display and export" -- web/src/windows/Report web/src/layout/panels.ts web/src/App.tsx web/src/labels web/src/cesium/testHooks.ts web/tests/unit/report-window.test.tsx web/tests/unit/labels.test.ts`

### Task 10: หน้าต่างกราฟ (ECharts)

**Files:**
- Create: `web/src/windows/Graph/Graph.tsx`, `web/src/windows/Graph/options.ts`
- Modify: `web/src/layout/panels.ts` (kind `graph`), `web/src/App.tsx`, `web/src/labels/labels.ts`, `web/src/labels/messages.th.ts`, `web/tests/unit/labels.test.ts`, `web/src/cesium/testHooks.ts` (`graphState(panelId)`)
- Test: `web/tests/unit/graph-options.test.ts`, `web/tests/unit/graph-window.test.tsx`

**Interfaces:**
- Consumes: Task 8 (`loadECharts`, `valueAt`), `objectPath`/`effectiveColor` ของ `cesium/colors.ts` (สีตาม object)
- Produces:
  - panel kind `"graph"` แบบเดียวกับ `report` (label `window.graph`)
  - `graphOption(report: ReportJson, ctx: {dateFormat: DateFormat; ltz: string; colorOf(object: string): string; now: number | null; showTimeLine: boolean; stripMs: number | null}): object` (ไม่ import echarts)
  - `graphState(panelId) -> {type: "time_xy" | "interval" | "polar90"; series: string[]; timeLine: number | null; currentPoint: [number, number] | null}`
  - `STRIP_CHART_DURATION_S = 3600`

- [ ] **Step 1: เขียน test ที่ fail** ใน `graph-options.test.ts`
  - `time_xy puts y2 on the right axis`: AER → series Azimuth/Elevation `yAxisIndex: 0`, Range `yAxisIndex: 1`; ทุก line series `sampling: "lttb"`
  - `azimuth line breaks at the wrap` (Review Focus 1): ข้อมูล Az 358, 359.5, 0.5, 2 → ข้อมูลของ series มี `null` คั่นระหว่าง 359.5 กับ 0.5
  - `series per object use the object color`: สอง object → ชื่อ series ขึ้นต้นด้วย `THBK-To-G01`/`THBK-To-E11` สีจาก `colorOf`
  - `interval graph draws one band per access`: Access graph 2 object 3 ช่วง → custom series มีข้อมูล 3 รายการ `[objectIndex, startMs, stopMs]`
  - `polar90 maps elevation to radius`: radiusAxis `min: 0, max: 90, inverse: true`, angleAxis `startAngle: 90, clockwise: true, min: 0, max: 360`; จุด `[El, Az]`; series `large: true`
  - `time line and current point`: `now` ใน access → time_xy มี markLine ที่ `now`; polar มี series ปัจจุบันหนึ่งจุดเท่ากับ `valueAt` ของ Az/El; `now` นอก access → ไม่มีจุด; `showTimeLine: false` → ไม่มี markLine
  - `strip chart window`: `stripMs: 3_600_000` → xAxis `min == now - 3_600_000`, `max == now`
  - `stacked n asset coverage`: N Asset Coverage graph → ทุก series `stack: "total"` และ `step: "end"`
  - `axis labels use DateFormat`: formatter ของแกนเวลาให้ `"… UTCG"`
- [ ] **Step 2: เขียน test ที่ fail** ใน `graph-window.test.tsx` (`vi.mock("../../src/windows/Graph/chart")` คืน echarts ปลอมที่จด `setOption`/`getDataURL`)
  - `toolbar buttons`: Save → ดาวน์โหลด `getDataURL({type: "png"})`; Copy to Clipboard → `navigator.clipboard.write` ถูกเรียก; Zoom Out → `dispatchAction({type: "dataZoom", start: 0, end: 100})`; Toggle Animation Timeline สลับ markLine; Crosshair Cursor ตั้ง `axisPointer.type == "cross"`
  - `right click menu`: Show Animation Time Line สลับ; Set Animation Time ตั้ง `useTime` เป็นเวลาที่ตำแหน่งคลิก (`convertFromPixel`); Export Dialog... ดาวน์โหลด csv (POST format csv)
  - `strip chart follows the clock`: `dynamic: true` time_xy → setOption ใหม่เมื่อเวลาเปลี่ยน ไม่มี POST เพิ่ม
  - `chunk failure shows a Thai message`: `loadECharts` reject → `role="alert"` ข้อความ `msg("graph.chunkFailed")`
  - `stale results show the banner`: 409 `RESULTS_NOT_CURRENT` → `ResultsBanner` และ Refresh สั่ง compute แบบเดียวกับ Task 9
- [ ] **Step 3: รันให้ fail** — `cd web && npx vitest run tests/unit/graph-options.test.ts tests/unit/graph-window.test.tsx` Expected: FAIL
- [ ] **Step 4: เขียน `options.ts` และ `Graph.tsx`** (setOption ใหม่ไม่เกินทุก 250 ms ตามเวลา animation, `resize()` เมื่อ panel เปลี่ยนขนาดผ่าน `usePanelResize`)
- [ ] **Step 5: รัน** — `npm test && npm run typecheck && npm run build && ls dist/assets | grep '^echarts-' && ! grep -l 'zrender' dist/assets/index-*.js` Expected: ผ่าน, มีไฟล์ `echarts-*.js` และ chunk หลักไม่มี zrender
- [ ] **Step 6: Commit** — `git commit -m "feat(web): graph window with time line and strip chart" -- web/src/windows/Graph web/src/layout/panels.ts web/src/App.tsx web/src/labels web/src/cesium/testHooks.ts web/tests/unit/graph-options.test.ts web/tests/unit/graph-window.test.tsx web/tests/unit/labels.test.ts`

### Task 11: Access tool

**Files:**
- Create: `web/src/windows/AccessTool/AccessTool.tsx`, `web/src/windows/AccessTool/state.ts`, `web/src/windows/AccessTool/commands.ts`
- Modify: `web/src/layout/panels.ts` (kind `accessTool`), `web/src/App.tsx`, `web/src/commands.ts` (ลบ PENDING_TOOLTIPS ของ `analysis.access`, `object.access`), `web/src/windows/ObjectBrowser/objectCommands.ts` (คอมเมนต์), `web/src/labels/labels.ts`, `web/src/labels/messages.th.ts`, `web/tests/unit/labels.test.ts`, test เดิมที่ปักสถานะปิด: `web/tests/unit/commands.test.ts:118-122`, `web/tests/unit/menubar.test.tsx:192-231`, `web/tests/unit/app.test.tsx:121`, `web/tests/unit/object-browser.test.tsx:1609-1612`, `web/tests/unit/toolbars.test.tsx:70`
- Test: `web/tests/unit/access-tool.test.tsx`, `web/tests/unit/access-state.test.ts`

**Interfaces:**
- Consumes: Task 8–10 (`openReport`), `useScenario` (doc, etag), `useJobs.activeFor`, `recordQueuedJob`, route ของ server §6.6
- Produces:
  - panel kind `"accessTool"`: `{label: "toolbar.access", type: "floating", size: {width: 640, height: 560}, persist: false, scenarioBound: true}` params `{from: string | null}`
  - `state.ts` (ฟังก์ชันล้วน): `targetsOf(checked: Set<string>, doc): string[]` (Constellation ที่ติ๊กครบ = path ของ Constellation), `computedSatellites(doc, statusByFacility): Set<string>` (ตัวหนา), `associatedTree(doc, from): Node[]` (Facility → Constellation → Satellite; Satellite → รายการ Facility)
  - คำสั่ง `analysis.access` (เปิดด้วย Access For = object ที่เลือกถ้าเป็น Facility/Satellite), `object.access` (enabled เฉพาะ Facility/Satellite tooltip `msg("access.forFacilityOrSatellite")`)

- [ ] **Step 1: เขียน test ที่ fail**
  - `access-state.test.ts`: `whole constellation collapses to its path`; `partial constellation lists satellites`; `bold means computed and current` (`computed: true` + status current → ตัวหนา; stale → ไม่หนา); `satellite access-for lists facilities`
  - `access-tool.test.tsx` (`stubFetch`, `openScenario(makeDoc(...))`):
    - `compute posts the checked targets with If-Match`: ติ๊ก G01 → Compute → POST `/access/compute` body `{from: "*/Facility/THBK", to: ["*/Satellite/G01"], time_period: {mode: "object"}, graphics: {...}, timeline: true}` header If-Match = etag
    - `compute 202 greys the buttons while the job runs`: ตอบ 202 `{job: "j1"}` → ปุ่ม Compute/Clear/Remove `disabled`; job `succeeded` → ใช้ได้ และ G01 ตัวหนา
    - `buttons are disabled while any job of the scenario runs`: `useJobs` มี propagate running ของ S1 → Compute disabled
    - `clear and remove send the same targets`; `clear all and remove all send "all"`; ไม่มีรายการตรง (ตอบ `cleared: 0`) → ข้อความ info `msg("access.nothingToClear")`
    - `specify time period sends start and stop`; ไม่ติ๊ก Auto Add to Timeline → `timeline: false`; Add Timeline → compute ของรายการที่เลือกด้วย `timeline: true`
    - `graphics options map to the access graphics`: Static Highlight, Animate Highlight, Show Animate Line, Use Custom Color + สี, Inherit Settings from Scenario → `graphics` ตรงชื่อช่องของ `AccessGraphics`
    - `reports and graphs buttons open windows`: Reports Access... → `openReport({style: "Access", kind: "report", objects: ["*/Facility/THBK */Satellite/G01"], time: {mode: "object"}, dynamic: false})`; Graphs AER... → kind graph
    - `412 shows the conflict dialog` (เหมือนหน้าต่างอื่น)
    - `select all from the context menu` ติ๊กทุกดาว
  - แก้ test เดิม: `analysis.access` / `object.access` ลงทะเบียนแล้ว → `commandTooltip` เป็น `undefined` และเปิดใช้เมื่อมี scenario (ตัวที่ยังรอคือ reportGraphManager, validation ยังคาด `tooltip.subtask4`)
- [ ] **Step 2: รันให้ fail** — `cd web && npx vitest run tests/unit/access-state.test.ts tests/unit/access-tool.test.tsx` Expected: FAIL
- [ ] **Step 3: เขียนหน้าต่าง คำสั่ง และ label** (Select Object... ใช้ `SelectObjectDialog` เดิมของ InsertObjects กรองเฉพาะ Facility/Satellite)
- [ ] **Step 4: รัน** — `npm test && npm run typecheck` Expected: PASS ทั้งชุด
- [ ] **Step 5: Commit** — `git commit -m "feat(web): Access tool with compute, clear, remove and timeline" -- web/src/windows/AccessTool web/src/layout/panels.ts web/src/App.tsx web/src/commands.ts web/src/windows/ObjectBrowser/objectCommands.ts web/src/labels web/tests/unit/access-state.test.ts web/tests/unit/access-tool.test.tsx web/tests/unit/labels.test.ts web/tests/unit/commands.test.ts web/tests/unit/menubar.test.tsx web/tests/unit/app.test.tsx web/tests/unit/object-browser.test.tsx web/tests/unit/toolbars.test.tsx`

### Task 12: Static Highlight และ Animate Highlight ในหน้าต่าง 2D

**Files:**
- Create: `web/src/cesium/accessHighlight.ts`
- Modify: `web/src/windows/Graphics2D/scene2d.ts` (เรียกเมื่อ doc หรือช่วง access เปลี่ยน)
- Test: `web/tests/unit/access-highlight.test.ts`

**Interfaces:**
- Consumes: `useAccessIntervals` / `fetchAccessResult` (TimelineView), `entityIdForName`, ค่า `graphics` ของ access
- Produces:
  - `highlightTimes(intervals: {start: number; stop: number}[], stepMs: number): number[][]` (เวลาตัวอย่างต่อช่วงทุก 60 s รวมขอบ)
  - `applyAccessHighlights(entities: EntityCollection, doc: ScenarioDoc, intervalsBySat: Record<string, {start: number; stop: number}[]>, ctx: ApplyCtx): void` — Static Highlight: entity `hl/static/<sat>` polyline (ConstantProperty ของตำแหน่งที่สุ่มจาก position ของดาว) width 4 แสดงตลอด; Animate Highlight: entity `hl/box/<sat>` point outline สี่เหลี่ยม (billboard กรอบ) ที่มี `availability` = ช่วง access; ปิดตัวเลือก = ลบ entity; `inherit: true` = ไม่วาด (ค่าตั้งต้นของ scenario)

- [ ] **Step 1: เขียน test ที่ fail** (Cesium จริงใน jsdom แบบ `graphics.test.ts`)
  - `highlight times cover each interval`: ช่วง 0–150 s step 60 → `[[0, 60000, 120000, 150000]]`
  - `static highlight draws a thick track only in access`: polyline ของ `hl/static/G01` มีจุดเท่ากับ highlightTimes และ width 4; ไม่มี CallbackProperty (`positions instanceof ConstantProperty`)
  - `animate highlight is available only in access`: `availability.contains(JulianDate ของกลางช่วง) === true`, นอกช่วง `false`
  - `turning options off removes the entities`; `hidden satellite gets no highlight`
- [ ] **Step 2: รันให้ fail** — `cd web && npx vitest run tests/unit/access-highlight.test.ts` Expected: FAIL
- [ ] **Step 3: เขียน `accessHighlight.ts` และต่อเข้ากับ `scene2d.ts`** (เฉพาะหน้าต่าง 2D ตาม spec §4)
- [ ] **Step 4: รัน** — `npm test && npm run typecheck` Expected: PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(web): static and animate access highlights in 2D" -- web/src/cesium/accessHighlight.ts web/src/windows/Graphics2D/scene2d.ts web/tests/unit/access-highlight.test.ts`

### Task 13: Report & Graph Manager และหน้าต่างแก้ style

**Files:**
- Create: `web/src/windows/ReportGraphManager/ReportGraphManager.tsx`, `web/src/windows/ReportGraphManager/StyleEditor.tsx`, `web/src/windows/ReportGraphManager/styleForm.ts`, `web/src/windows/ReportGraphManager/commands.ts`
- Modify: `web/src/layout/panels.ts` (kinds `reportGraphManager`, `styleEditor`), `web/src/App.tsx`, `web/src/commands.ts` (ลบ PENDING_TOOLTIPS ของ reportGraphManager ทั้งสอง), `web/src/windows/AccessTool/AccessTool.tsx` (ปุ่ม Report & Graph Manager...), `web/src/labels/*`, `web/tests/unit/labels.test.ts`, test เดิมที่ปัก tooltip ของ reportGraphManager
- Test: `web/tests/unit/rgm.test.tsx`, `web/tests/unit/style-form.test.ts`

**Interfaces:**
- Consumes: Task 8–11 (`fetchStyles`, `fetchProviders`, `saveMyStyle`, `openReport`, `downloadReport`), `useScenario.putDoc` (Scenario Styles, P4)
- Produces:
  - panel kinds `reportGraphManager` (floating 760×540, persist false, scenarioBound true, params `{objectType?: string; objects?: string[]}`) และ `styleEditor` (floating 720×520, instanceKey = ชื่อ style หรือ `"new"`)
  - `styleForm.ts`: `type StyleForm`, `formFromStyle(style): StyleForm`, `styleFromForm(form): StyleDef` (JSON ตามรูปแบบ spec §3.3 + ช่อง P3), `moveColumn(form, i, dir: -1 | 1)`, `canDynamic(style): boolean`
  - คำสั่ง `analysis.reportGraphManager`, `object.reportGraphManager` (เปิดโดยเลือก Object Type และ object ตามการเลือก)

- [ ] **Step 1: เขียน test ที่ fail**
  - `style-form.test.ts`: `round trip of every installed style` (`styleFromForm(formFromStyle(s))` เท่ากับ s); `new report style json` (เลือก Access Data → Add Start Time, Duration → Up → JSON `content[0].elements == ["Duration", "Start Time"]`, `kind: "report"`, `graph: null`, `summary.global_statistics` ตามที่ติ๊ก); `graph style assigns y axes` (Type Time XY, Elevation → Y1, Range → Y2 → `graph: {type: "time_xy", y1: ["Elevation"], y2: ["Range"]}`); `summary options` (Min, Std Deviation, Summary Only → `per_object: ["Min Duration", "Std Deviation Duration"], summary_only: true`)
  - `rgm.test.tsx`:
    - `object type filters objects and styles`: All Types / Access / Facility / Satellite / Constellation; Access แสดง `THBK-To-G01`; Constellation → ไม่มี style
    - `styles tree has three tiers and filters`: Installed Styles (ล็อก: Delete disabled), My Styles, Scenario Styles; ปิด Show Graphs → ไม่มี style kind graph
    - `generate as dynamic display greys unsupported styles`: เลือก Dynamic Display/Strip Chart → Access (report) disabled, AER enabled
    - `generate opens a report window`: เลือก THBK-To-G01 + G01 E11 (Ctrl) + Access → Generate... → กล่องเวลา (Use Object Time Period ตั้งต้น) → OK → `openReport` objects สองตัว
    - `time options`: Specify Time Properties + Use step size 45 → POST แล้ว 422 `field: "time.step"` → ช่อง Step มีกรอบแดง (`aria-invalid="true"`) และข้อความ server
    - `generate without results asks to compute first` (Review Focus 3): POST ตอบ 409 `RESULTS_NOT_CURRENT` → Dialog `msg("rgm.computeFirst", {facility: "THBK"})` ปุ่ม Yes ส่ง POST `/access/compute` แล้วสร้างใหม่เมื่อ job เสร็จ, No ปิด
    - `right click generates files`: Generate as .txt file... / Generate as .csv file... → `downloadReport` format txt/csv
    - `copy to my styles and delete`: Copy to My Styles ของ AER → PUT `/styles/AER%20Copy` body `name: "AER Copy"` (มีอยู่แล้ว → `"AER Copy 2"`); Delete ของ My Style → DELETE และหายจากต้นไม้; Delete ของ Scenario Style → `putDoc` ตัดออกจาก `doc.styles`
    - `new and properties open the style editor; OK saves to the chosen tier`: OK แบบ My Styles → PUT `/styles/{name}`; แบบ Scenario Styles → `putDoc` ใส่ใน `doc.styles`; 422 `STYLE_INVALID` → ข้อความใน Message Viewer
- [ ] **Step 2: รันให้ fail** — `cd web && npx vitest run tests/unit/style-form.test.ts tests/unit/rgm.test.tsx` Expected: FAIL
- [ ] **Step 3: เขียนหน้าต่างและคำสั่ง** แล้วแก้ test เดิมของ reportGraphManager ให้คาดว่าลงทะเบียนแล้ว
- [ ] **Step 4: รัน** — `npm test && npm run typecheck` Expected: PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(web): Report & Graph Manager and style editor" -- web/src/windows/ReportGraphManager web/src/windows/AccessTool/AccessTool.tsx web/src/layout/panels.ts web/src/App.tsx web/src/commands.ts web/src/labels web/tests/unit/style-form.test.ts web/tests/unit/rgm.test.tsx web/tests/unit/labels.test.ts web/tests/unit/commands.test.ts web/tests/unit/menubar.test.tsx web/tests/unit/toolbars.test.tsx`

### Task 14: หน้า Validation และปลดข้อความ "อยู่ในงานย่อยที่ 4"

**Files:**
- Create: `web/src/windows/Validation/Validation.tsx`, `web/src/windows/Validation/rows.ts`
- Modify: `web/src/layout/panels.ts` (kind `validation`), `web/src/App.tsx`, `web/src/commands.ts` (ลบ `PENDING_TOOLTIPS` ทั้งก้อนและ import ที่ไม่ใช้), `web/src/labels/messages.th.ts` (ลบ `tooltip.subtask4`), `web/src/labels/labels.ts`, test เดิม: `web/tests/unit/commands.test.ts`, `menubar.test.tsx` (192–231, 467), `toolbars.test.tsx:70`, `labels.test.ts:522`
- Test: `web/tests/unit/validation-window.test.tsx`, `web/tests/unit/validation-rows.test.ts`

**Interfaces:**
- Consumes: `GET /validation/history`, `GET /validation/{sc}/{day}`, `GET /validation/pending` (Task 7), Task 10 (`graphOption`-แบบเดียวกัน ผ่าน `loadECharts`)
- Produces:
  - panel kind `"validation"`: `{label: "window.validation" (ours "Validation"), type: "integrated", persist: false, scenarioBound: false}`; คำสั่ง `analysis.validation`
  - `rows.ts`: `dailyRows(history, pending, metric: "el" | "az"): DailyRow[]` (Day, Scenario, Truth, ค่ากลาง/P99 ต่อระบบ, Result ∈ Pass/Fail/Pending/Gave up, failing, nextAttempt) เรียงวันใหม่สุดก่อน; `satelliteRows(doc, filter: {system?: string; result?: string}): SatRow[]`; `trendSeries(history, metric)` (P99 ต่อระบบตามวัน + เส้นเกณฑ์ `0.2` สำหรับ el, `0.5` สำหรับ az); `ageScatter(docs): [age_days, d3_median_km, prn][]`

- [ ] **Step 1: เขียน test ที่ fail**
  - `validation-rows.test.ts`: `daily rows merge history and pending` (history 2 วัน + pending 1 + gave_up 1 → 4 แถว Result `Pass`, `Fail`, `Pending` (มี nextAttempt), `Gave up`); `metric switch` (el → `el_median`/`el_p99`, az → `az_median`/`az_p99`); `satellite filter` (system `G`, result `fail`); `trend thresholds` (`markLine` ค่า 0.2 / 0.5); `age scatter` รวมทุกวัน ข้ามดาวที่ `age_days` หรือ `d3_median_km` เป็น null
  - `validation-window.test.tsx`: `empty history explains when data comes` (`[]` ทั้งสอง → ข้อความ `msg("validation.empty")`); `click a day loads its satellites` (GET `/validation/E2E/2026-11-10` แล้วตารางรายดวงมีคอลัมน์ PRN, Truth, Pairs, ΔEl med/P99, ΔAz med/P99, 3D med/max (km), Age, Result); `pending row shows the next attempt time` ในรูปแบบ DateFormat
  - แก้ test เดิม: ทั้ง 5 คำสั่งลงทะเบียนแล้ว `tooltip.subtask4` ไม่มีอีก (`MSG_KEYS` ไม่มี) test ที่เคยใช้ tooltip นี้เปลี่ยนไปใช้คำสั่งปลอมที่ไม่ได้ลงทะเบียนแทน
- [ ] **Step 2: รันให้ fail** — `cd web && npx vitest run tests/unit/validation-rows.test.ts tests/unit/validation-window.test.tsx` Expected: FAIL
- [ ] **Step 3: เขียนหน้าต่าง** แล้วลบ placeholder ของงานย่อยที่ 4
- [ ] **Step 4: รัน** — `npm test && npm run typecheck && grep -rn subtask4 src tests/unit; test $? -eq 1` Expected: PASS และ grep ไม่พบ
- [ ] **Step 5: Commit** — `git commit -m "feat(web): validation history window" -- web/src/windows/Validation web/src/layout/panels.ts web/src/App.tsx web/src/commands.ts web/src/labels web/tests/unit/validation-rows.test.ts web/tests/unit/validation-window.test.tsx web/tests/unit/commands.test.ts web/tests/unit/menubar.test.tsx web/tests/unit/toolbars.test.tsx web/tests/unit/labels.test.ts`

### Task 15: e2e (Playwright) และ fixture

**Files:**
- Modify: `web/tests/e2e/fixture/build_fixture.py` (เพิ่ม `scenarios/E2E_ACCESS` = E2E ที่มีผลแล้วแต่ `accesses: []`, และ `validation/history.jsonl` 2 บรรทัด (2026-11-09 pass, 2026-11-10 fail G22) + `validation/E2E/validation_2026-11-10.json` ที่สร้างจากโครงของ `validate_ephemeris` โดยไม่ต่อเน็ต)
- Create: `web/tests/e2e/access-reports.spec.ts`, `web/tests/e2e/validation.spec.ts`

**Interfaces:**
- Consumes: ทุก task ก่อนหน้า, `openScenario`, `WRITE_HEADERS`, test hook `reportRows`, `graphState`, `entityPositionEcef` ฯลฯ

- [ ] **Step 1: เขียน spec ที่ fail** (ทุก spec ใช้ `test` ของ `fixtures.ts` ที่จับ request ออกนอกเครื่อง; ห้ามเรียก `/validate`, `/daily/run`, `/orbits/fetch`)
  - `compute THBK to GPS adds one timeline row per shown GPS satellite`: เปิด `E2E_ACCESS` → Analysis → Access... → Access For THBK → ติ๊ก Constellation GPS → Compute → จำนวนแถว Timeline ที่ชื่อขึ้นต้น `THBK-To-G` เท่ากับจำนวนดาว GPS ใน `/api/scenarios/E2E_ACCESS/access/intervals?from=*/Facility/THBK&to=*/Constellation/GPS` (ดาวที่ซ่อนไม่นับ)
  - `access report of G01 matches intervals.json`: Reports Access... ของ G01 → `reportRows` ของหน้าต่าง `THBK-To-G01: Access` = แถวของ `intervals.json` (อ่านผ่าน `/api/scenarios/E2E_ACCESS/access/THBK/<hash>/intervals.json`) จัดเวลาแบบ UTCG และ Duration 3 ตำแหน่ง
  - `access report shows within 2 seconds` (เกณฑ์ข้อ 3): จากคลิก Reports Access... ถึงแถวแรกขึ้น `expect(elapsed).toBeLessThan(2000)`
  - `export csv has unit headers`: Export ▸ To CSV Format... → ไฟล์ดาวน์โหลดบรรทัดแรก `Access,Start Time (UTCG),Stop Time (UTCG),Duration (sec)`
  - `dynamic display of AER changes on Step Forward`: R&G Manager → Access → THBK-To-G01 → AER → Dynamic Display/Strip Chart → Generate... → อ่านแถว → Step Forward → ค่า Azimuth/Elevation เปลี่ยน
  - `az el polar graph has the current time point`: Graphs ของ Az El Polar → `graphState().type == "polar90"` และ `currentPoint !== null` เมื่อเวลาอยู่ใน access ของ G01
  - `validation.spec.ts` `validation page lists fixture days`: Analysis → Validation... → แถว 2026-11-10 (Fail, G22) และ 2026-11-09 (Pass); คลิก 2026-11-10 → ตารางรายดวงมี G22
- [ ] **Step 2: รันให้ fail** — `cd web && npm run e2e -- access-reports.spec.ts validation.spec.ts` Expected: FAIL (ยังไม่มี `E2E_ACCESS` / fixture validation)
- [ ] **Step 3: แก้ `build_fixture.py`** (เขียนไฟล์ validation ด้วย JSON ที่กำหนดในสคริปต์ ไม่เรียก `run_validate`)
- [ ] **Step 4: รันทั้งชุด** — `cd web && npm run e2e` Expected: ทุก spec ผ่าน รวม spec เดิม
- [ ] **Step 5: รันทุกชั้นครั้งสุดท้าย** — `python3 -m unittest discover -s tests -v`; `cd server && .venv/bin/python -m pytest -q -W error`; `cd web && npm test && npm run typecheck && npm run gen:api:check` Expected: ผ่านทั้งหมด
- [ ] **Step 6: Commit** — `git commit -m "test(e2e): access, reports, graphs and validation" -- web/tests/e2e/fixture/build_fixture.py web/tests/e2e/access-reports.spec.ts web/tests/e2e/validation.spec.ts`
