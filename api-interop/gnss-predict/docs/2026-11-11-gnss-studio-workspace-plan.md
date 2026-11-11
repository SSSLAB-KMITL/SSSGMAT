# GNSS Studio งานย่อยที่ 3: Workspace — แผนลงมือ

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** หน้าเว็บ GNSS Studio ที่ใช้งานเหมือน STK (เมนู, แถบเครื่องมือ, Object Browser, Properties Browser, Animation, Timeline View, หน้าต่าง 3D/2D, Message Viewer, แถบสถานะ) ทำงานกับ API ของ server ที่เสร็จแล้ว

**Architecture:** แอป React + TypeScript ใน `api-interop/gnss-predict/web/` build ด้วย Vite เป็น `web/dist/` ซึ่ง FastAPI ส่งให้ที่ origin เดียวกับ API (server Task 2) สถานะแยกเป็น store ของ Zustand ตาม spec §3 หน้าต่างจัดด้วย dockview ทุกคำสั่งของเมนู แถบเครื่องมือ เมนูคลิกขวา และคีย์ลัดผ่าน registry เดียว (`commands.ts`) ลูกโลกเป็น Cesium Viewer ต่อหน้าต่าง อ่านเวลาจาก store `time` ที่เดียว

**Tech Stack:** React 18, TypeScript 5, Vite, Zustand, dockview, CesiumJS, Radix UI (Menubar, ContextMenu, Dialog, Tooltip), TanStack Table + Virtual, Lucide, openapi-typescript, Vitest + Testing Library (jsdom), Playwright (Chromium)

**Spec:** `docs/2026-11-11-gnss-studio-workspace-design.md` (อ้างว่า "spec §n") ประกอบกับ `2026-11-11-gnss-studio-design.md` (ภาพรวม), `2026-11-11-gnss-studio-server-design.md` (server), `2026-11-11-gnss-studio-stk-reference.md` (STK ref), `2026-11-11-gnss-studio-server-decisions.md` (ข้อตกลงของ server ที่หน้าเว็บต้องรู้)

## Global Constraints

- ทำงานใน worktree `/Users/phuwish/SSSGMAT/.worktrees/gnss-studio-workspace` บน branch `feature/gnss-studio-workspace` (แตกจาก `feature/gnss-studio-server` 52d76c5) ห้ามสลับ branch ใน checkout หลัก `/Users/phuwish/SSSGMAT` (session อื่นใช้อยู่) ห้าม push ห้าม merge ตรวจ `git branch --show-current` ก่อน commit ทุกครั้ง ถ้าไม่ใช่ `feature/gnss-studio-workspace` ห้าม commit
- โค้ดใหม่อยู่ใต้ `api-interop/gnss-predict/web/` แก้ server เฉพาะที่ Task 10 ระบุ ห้ามแก้ engine และไฟล์ของ GMAT
- GmatConsole ไม่อยู่ใน git: ถ้าต้องใช้ GMAT จริงใน worktree ให้ตั้ง `GMAT_BIN=/Users/phuwish/SSSGMAT/application/bin/GmatConsole` (งานย่อยนี้ไม่ต้องใช้)
- Node v26 / npm 11 ที่มีอยู่ ตรึงรุ่นทุกแพ็กเกจแบบ `"x.y.z"` (ไม่มี `^`/`~`) commit `package-lock.json` และ `web/.gitignore` มี `node_modules/`, `dist/`, `test-results/`, `playwright-report/`
- คำสั่ง: `cd api-interop/gnss-predict/web && npm test` (vitest run), `npm run typecheck` (tsc --noEmit), `npm run build`, `npm run e2e` (จาก Task 14) ต้องผ่าน test + typecheck ก่อน commit ทุกครั้ง ถ้าแตะ server: `cd ../server && .venv/bin/python -m pytest -q -W error` ต้องผ่าน 0 warning
- ทุกข้อความที่เห็นบนจอของเมนู ปุ่ม หน้าต่าง หน้าตั้งค่า ตัวเลือก หัวคอลัมน์ มาจาก `t("<key>")` ใน `labels.ts` คำที่ `source: "stk"` ต้องมีอยู่ตรงตัวใน STK ref ส่วนที่ไม่มีเป็น `source: "ours"` ห้ามใช้ไอคอนหรือโลโก้ของ STK (Lucide + SVG ที่วาดเอง)
- ข้อความภาษาไทยของหน้าเว็บอยู่ใน `messages.th.ts` ข้อความจาก server (ช่อง `text`) แสดงตามที่ส่งมา
- เวลาทำงานต้องไม่ต่อเน็ตนอกจาก server ในเครื่อง: ภาพโลกใช้ NaturalEarthII ที่มากับ Cesium, `Ion.defaultAccessToken = ""`, ห้ามใช้ Ion/Bing/terrain/geocoder, ห้ามโหลดฟอนต์หรือ script จาก CDN
- ห้าม test ใดเรียก `/api/orbits/fetch`, `/api/daily/run`, `/api/scenarios/*/validate` ของจริง (ผู้ใช้ห้ามดาวน์โหลดจาก CelesTrak/CDDIS/MGEX โดยไม่ยินยอม) server ของ e2e มี `settings.json` ที่ `daily.enabled: false` และ `GMAT_BIN` ชี้ไปที่ไม่มีอยู่
- API: production ส่งหน้าเว็บจาก FastAPI (origin เดียวกัน) dev server ของ Vite proxy `/api` ไป `http://127.0.0.1:8000` และเขียน header `Origin` ใหม่เป็น origin ของ server (server ตอบ 403 `FORBIDDEN_ORIGIN` กับ write ที่ Origin ไม่ตรง) ทุกการแก้ส่ง `If-Match` เป็นค่า `ETag` ที่อ่านล่าสุดตามตัว ตัวเลขส่งตาม type เข้มของ server (`step_s`, `norad` เป็นจำนวนเต็ม)
- เวลาใน API เป็น ISO 8601 UTC ลงท้าย `Z` (รับทั้งมีและไม่มีมิลลิวินาที) เวลาที่แสดงใช้ DateFormat ของ scenario (UTCG/LTZG)
- หน้าตา: สีและขนาดทั้งหมดเป็นตัวแปร CSS ใน `src/theme.css` ที่เดียว โทนสว่างแบบเดสก์ท็อป ตัวอักษร system UI 12 px ตัวเลขและเวลาเป็น monospace คอนทราสต์ข้อความผ่าน WCAG AA
- commit message แบบ conventional ภาษาอังกฤษ ลงท้ายด้วย `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` บรรทัดเดียว ห้ามมี co-author อื่น

## Review Focus

1. **เปิด scenario ที่ยังไม่มีผลหรือผลไม่ตรง** (สร้างใหม่, snapshot เปลี่ยน) หน้าต่าง 3D/2D ต้องแสดง Facility พร้อมแถบแจ้ง ไม่ล่ม และ Object Browser/Properties ยังใช้ได้ → Task 14 `nores.spec.ts`
2. **server ปิดเปิดใหม่หรือ SSE หลุด** แถบสถานะเป็นสีแดง ต่อใหม่ทุก 1, 2, 4, 8, 16, 30 วินาที และดึงข้อความที่พลาดด้วย `since` โดยไม่ซ้ำ → Task 4 `events reconnect with backoff and backfills missed messages`
3. **สองแท็บแก้ scenario เดียวกัน** Apply ของแท็บที่ ETag เก่าได้ 412 แล้วขึ้นกล่อง Reload/Cancel ไม่ทับค่าของอีกแท็บเงียบๆ Reload แล้วเห็นค่าล่าสุด → Task 9 `Apply on a stale ETag shows the conflict dialog and Reload refetches` และ Task 14 `conflict.spec.ts`
4. **พิมพ์เวลาผิดรูปแบบในช่อง Current Scenario Time** ขอบแดง เวลาไม่เปลี่ยน ส่วนเวลาที่ถูกรูปแบบแต่อยู่นอกช่วงวิเคราะห์รับได้ (ดาวไม่แสดงเพราะไม่มีข้อมูล) → Task 6 `Current Scenario Time rejects bad text and keeps the time`
5. **ดาวที่ถูกเปลี่ยนชื่อหรือคัดลอก** (G01 → GPS01, G01_1 ที่ NORAD เดียวกัน) สี การซ่อน tooltip และแถว timeline ต้องจับคู่ผ่าน NORAD → PRN ไม่ใช่ชื่อ → Task 11 `entityIdFor maps renamed and copied satellites by NORAD`

## การตัดสินใจในแผนที่ spec ไม่ได้กำหนดไว้

| # | เรื่อง | ที่เลือก |
|---|---|---|
| W1 | Animation Cycle | `off` = เวลาเดินต่อเลยปลายช่วงวิเคราะห์ (ความหมายของ STK; บรรทัดใน spec §6.1 กำกวม) `stop` = หยุดที่ปลายช่วง (ถอยหลังหยุดที่ต้นช่วง) `loop` = เดินหน้าเลยปลายกลับไปต้นช่วง ถอยหลังเลยต้นไปปลายช่วง |
| W2 | Normal Animation Mode | 1 step ต่อ refresh ที่ 30 ครั้งต่อวินาทีคงที่: เวลาเพิ่ม `direction × step_s × 30 × dt_จริง` |
| W3 | คำสั่ง | `commands.ts` เป็น registry เดียว (id → label key, run, enabled) เมนู แถบเครื่องมือ เมนูคลิกขวา และคีย์ลัดเรียกผ่านมัน คำสั่งของหน้าต่างที่ยังไม่ทำลงทะเบียนในงานที่ทำหน้าต่างนั้น |
| W4 | เมนู Analysis | Access..., Report & Graph Manager..., Validation... มีในเมนูแต่ปิดใช้พร้อม tooltip ไทย "อยู่ในงานย่อยที่ 4" จนกว่างานย่อยที่ 4 จะลงทะเบียนคำสั่ง `analysis.access`, `analysis.reportGraphManager`, `analysis.validation` |
| W5 | Save | การแก้ object/scenario บันทึกทันทีตอน Apply อยู่แล้ว Save จึง PUT workbook; Save As = PUT workbook → POST copy → เปิดชื่อใหม่; รายการล่าสุดเก็บใน localStorage `gnss-studio.recent` สูงสุด 4 |
| W6 | workbook.json | `{"version": 1, "dockview": <api.toJSON()>, "panels": {<panelId>: {"kind", "params"}}, "toolbars": {"default", "animation", "graphics3d", "defaults3d", "defaults2d": bool}, "timelineHidden": [<ชื่อแถว>], "windowProps": {<panelId>: {...}}}` ไม่เกิน 1,048,576 ไบต์ |
| W7 | Cesium | `requestRenderMode: true` ขอ render เมื่อเวลา กราฟิก หรือกล้องเปลี่ยน; ภาพโลก `TileMapServiceImageryProvider.fromUrl(buildModuleUrl("Assets/Textures/NaturalEarthII"))`; คัดลอก `cesium/Build/Cesium/{Workers,ThirdParty,Assets,Widgets}` ไป `dist/cesium/` ด้วย `vite-plugin-static-copy` และ `CESIUM_BASE_URL = "/cesium"` |
| W8 | id ของ entity | ตามที่ engine เขียน: `sat/<PRN>`, `fac/<ชื่อ>`, `access/<fac>/<PRN>` ดาวใน scenario จับคู่ PRN ผ่าน NORAD ใน `satellites[]` ของ manifest ephem ปัจจุบัน |
| W9 | ธงและการซ่อนของดาว | `GET /api/catalog?snapshot&start&stop` ครั้งเดียวต่อการเปิด scenario กรองฝั่งหน้าเว็บ ซ่อน = (`too_old` และ `show_too_old` ปิด) หรือ (`no_broadcast` และ `show_no_broadcast` ปิด) ⚠ = มีธงอื่นนอกจาก `name_mismatch` |
| W10 | แถบสถานะ | ดาวที่ใช้ได้ + PDOP จาก `dop.csv` แถว `system == "ALL"` ที่เวลาล่าสุด ≤ เวลา animation ของ Facility ตัวแรกที่มีผล current; อายุข้อมูลสูงสุดจาก `age_days` ใน manifest ephem ของดาวที่ `propagated`; แถบเตือนดิสก์เมื่อ `/health` บอก `writable == false` หรือ `free_bytes < 500_000_000` |
| W11 | เวลาที่ดึง CelesTrak ได้ครั้งถัดไป | endpoint ใหม่ `GET /api/orbits/fetch-status` อ่านอย่างเดียวจาก `data/orbits/_cache/celestrak_state.json` (Task 10) |
| W12 | ข้อมูลของ e2e | สคริปต์ Python สร้างจาก snapshot fixture ของ engine ด้วยวงโคจรวงกลมปลอม (ไม่ใช้ GMAT ไม่ใช้เน็ต) scenario `E2E` (thbk-gnss มีผล), `E2E_NORES` (thbk-gnss ไม่มีผล), `E2E_EMPTY` (empty) |
| W13 | เกณฑ์ประสิทธิภาพข้อ 1–2 | `tests/e2e/perf.spec.ts` ข้ามเว้นแต่ตั้ง `GNSS_E2E_PERF_URL` ผู้ทำรันเองบนเครื่องพัฒนาตามขั้นตอนใน Task 14 |
| W14 | test ของ component | Vitest + Testing Library + jsdom; โค้ด Cesium ทดสอบเป็นฟังก์ชันล้วนด้วย Vitest และผ่าน Playwright |
| W15 | Cut/Copy/Paste ใน Object Browser | Cut + Paste บนโฟลเดอร์ = ย้ายดาวเข้ากลุ่ม (`POST /groups`); Copy + Paste = สร้างดาว `<ชื่อ>_1` (`_2` … ถ้าชื่อซ้ำ) ด้วย Define Properties ที่ NORAD เดียวกัน; ปุ่ม Graphics Color Selectors / Graphics On/Off Toggles ซ่อน/แสดงคอลัมน์กล่องสี/ช่องติ๊ก |
| W16 | Apply | หน้า Scenario ใช้ `PUT /scenarios/{sc}` ทั้งก้อน (ผล stale จาก header `X-Results-Stale`) หน้า object ใช้ `PATCH` (ผล stale จาก body) |
| W17 | แปลงข้อความเวลา | รับเฉพาะรูปแบบ DateFormat ปัจจุบัน: วัน 1–2 หลัก, เดือนอังกฤษ 3 ตัวไม่สนตัวพิมพ์, ทศนิยมวินาที 0–3 หลัก, ไม่ใส่ `UTCG`/`LTZG±hh:mm` ท้ายก็ได้; LTZG ที่มี offset ในข้อความใช้ offset นั้น ไม่มีใช้ `units.ltz_offset` |
| W18 | Time Step ที่แสดง | `"60.00 sec"`: ค่า ≥ 0.01 ทศนิยม 2 หลัก ค่าน้อยกว่าทศนิยม 4 หลัก |
| W19 | ฟังก์ชันสำหรับ test ในหน้าเว็บ | `window.__gnssStudioTest` ติดตั้งเมื่อ URL มี `?test` เท่านั้น |
| W20 | Visible Sides | เก็บและแก้ได้ใน 2D Graphics - Pass แต่ v1 วาดเส้นทางแบบ Both เสมอ หน้าแสดงหมายเหตุไทย |
| W21 | Help → STK UI Reference | หน้าต่างแสดงตาราง `labels.ts` (Text, Source, STK ref) ไม่ต่อเน็ต |

## โครงสร้างไฟล์

```
api-interop/gnss-predict/
  server/tools/dump_openapi.py            (Task 1)  server/gnss_studio_server/routes/orbits.py (Task 10 เพิ่ม endpoint)
  web/
    package.json package-lock.json tsconfig.json vite.config.ts index.html playwright.config.ts .gitignore
    tools/gen-enums.mjs
    src/
      main.tsx App.tsx Workspace.tsx theme.css commands.ts shortcuts.ts recent.ts
      api/        client.ts events.ts openapi.json types.gen.ts enums.gen.ts
      stores/     scenario.ts time.ts selection.ts results.ts jobs.ts messages.ts layout.ts settings.ts
      data/       catalog.ts files.ts
      time/       format.ts parse.ts steps.ts clock.ts
      labels/     labels.ts messages.th.ts
      layout/     panels.ts defaultLayout.ts workbook.ts
      chrome/     MenuBar.tsx Toolbars.tsx StatusBar.tsx ContextMenu.tsx Dialogs.tsx HealthBanner.tsx WindowsDialog.tsx
      windows/    ObjectBrowser/ PropertiesBrowser/ Graphics3D/ Graphics2D/ TimelineView/ MessageViewer/ InsertObjects/
                  SatelliteCatalog/ NewScenarioWizard/ Welcome/ ViewFromTo/ FetchOrbitData/ DailyForecastSettings/ About/
                  StkReference/
      cesium/     viewer.ts clockSync.ts czml.ts graphics.ts inertial.ts passes.ts swath.ts night.ts ipp.ts testHooks.ts
      icons/
    tests/unit/  tests/e2e/ (fixture/build_fixture.py, start-server.sh, *.spec.ts)
```

---

### Task 1: โครงโปรเจกต์เว็บ, ธีม และ type จาก API

**Files:**
- Create: `web/package.json`, `web/package-lock.json`, `web/tsconfig.json`, `web/vite.config.ts`, `web/index.html`, `web/.gitignore`, `web/src/main.tsx`, `web/src/App.tsx`, `web/src/theme.css`, `web/tools/gen-enums.mjs`, `web/src/api/openapi.json`, `web/src/api/types.gen.ts`, `web/src/api/enums.gen.ts`, `server/tools/dump_openapi.py`
- Test: `web/tests/unit/theme.test.ts`, `web/tests/unit/enums.test.ts`

**Interfaces:**
- Produces:
  - npm scripts `dev`, `build`, `test` (`vitest run`), `typecheck`, `gen:api`
  - `src/api/enums.gen.ts`: `export const ENUMS = { MarkerStyle, LineStyle, LeadType, TrailType, VisibleSides, SwathOptions, OrbitSystem, UpdateMode, Cycle, DateFormat } as const` (อาร์เรย์ string ตาม `Literal` ใน `server/gnss_studio_server/schema.py`)
  - `src/api/types.gen.ts`: type จาก openapi-typescript รวม `components["schemas"]["ScenarioDoc"]` และ model ย่อย
  - ตัวแปร CSS ใน `theme.css`: `--bg --panel --border --text --text-muted --menu-bg --menu-text --titlebar-bg --titlebar-active-bg --titlebar-active-text --selected-bg --selected-text --danger --warning --font-ui --font-mono --font-size --color-gps --color-glonass --color-galileo --color-beidou --color-facility --color-access`

- [ ] **Step 1: สร้าง venv ของ server ใน worktree** `python3 -m venv server/.venv && server/.venv/bin/pip install -r server/requirements-dev.txt` แล้วรัน server suite ให้ผ่าน (923 passed) ก่อนเริ่ม
- [ ] **Step 2: สร้างโปรเจกต์ Vite (React + TS) ใน `web/`** ติดตั้งรุ่นเสถียรปัจจุบันแล้วตรึงตามที่ติดตั้งจริง: `react`, `react-dom` (18.3.x), `zustand`, `dockview`, `cesium`, `@radix-ui/react-menubar`, `@radix-ui/react-context-menu`, `@radix-ui/react-dialog`, `@radix-ui/react-tooltip`, `@tanstack/react-table`, `@tanstack/react-virtual`, `lucide-react`; dev: `typescript`, `vite`, `@vitejs/plugin-react`, `vite-plugin-static-copy`, `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/user-event`, `openapi-typescript`, `@types/react`, `@types/react-dom`
- [ ] **Step 3: เขียน test ที่ fail**

```ts
// tests/unit/theme.test.ts — contrast() คำนวณตาม WCAG 2.1 relative luminance
test("text tokens meet WCAG AA on their backgrounds", () => {
  const v = readCssVars("src/theme.css");
  for (const [fg, bg] of [["--text", "--bg"], ["--text", "--panel"], ["--text-muted", "--panel"],
                          ["--menu-text", "--menu-bg"], ["--selected-text", "--selected-bg"],
                          ["--titlebar-active-text", "--titlebar-active-bg"]])
    expect(contrast(v[fg], v[bg])).toBeGreaterThanOrEqual(4.5);
});
test("system colour tokens exist with the spec §14 hues", () => {
  const v = readCssVars("src/theme.css");
  expect(v["--color-gps"]).toBe("#ffd23f"); expect(v["--color-glonass"]).toBe("#ff6b6b");
  expect(v["--color-galileo"]).toBe("#4fd47e"); expect(v["--color-beidou"]).toBe("#45c8ff");
  expect(v["--color-facility"]).toBe("#ff79e6"); expect(v["--color-access"]).toBe("#9dff6b");
  expect(v["--font-size"]).toBe("12px");
});
// tests/unit/enums.test.ts
test("enums come from the server schema", () => {
  expect(ENUMS.LeadType).toEqual(["Time", "Percent", "Quarter", "Half", "Full", "All", "None", "One Pass", "Current Interval"]);
  expect(ENUMS.TrailType).toContain("Same As Lead");
  expect(ENUMS.Cycle).toEqual(["off", "stop", "loop"]);
  expect(ENUMS.UpdateMode).toEqual(["time_step", "real_time", "x_real_time"]);
  expect(ENUMS.SwathOptions).toEqual(["No Graphics", "Edge Limits", "Filled Limits"]);
});
```

- [ ] **Step 4: รันให้ fail** — `npm test` Expected: FAIL (ไม่มีไฟล์)
- [ ] **Step 5: เขียนโค้ด**
  - `vite.config.ts`: plugin react, static-copy ตาม W7, `define: { CESIUM_BASE_URL: JSON.stringify("/cesium") }`, `build.outDir = "dist"`, `server.proxy["/api"] = { target: "http://127.0.0.1:8000", configure: proxy => proxy.on("proxyReq", r => r.setHeader("origin", "http://127.0.0.1:8000")) }`, `test: { environment: "jsdom", include: ["tests/unit/**/*.test.{ts,tsx}"] }`
  - `server/tools/dump_openapi.py <out.json>`: สร้าง app ด้วย `create_app(Config(data_dir=<tmp>), start_background=False)` เอา `app.openapi()` แล้วใส่ `ScenarioDoc.model_json_schema(ref_template="#/components/schemas/{model}")` (รวม `$defs`) ลง `components.schemas` เขียนแบบเรียงคีย์
  - `npm run gen:api` = `../server/.venv/bin/python -I ../server/tools/dump_openapi.py src/api/openapi.json && openapi-typescript src/api/openapi.json -o src/api/types.gen.ts && node tools/gen-enums.mjs` (gen-enums อ่าน enum ของ property ใน schema แล้วเขียน `enums.gen.ts`) commit ไฟล์ที่สร้าง
  - `App.tsx` ชั่วคราวแสดง `GNSS Studio` และ `theme.css` นำเข้าใน `main.tsx`
- [ ] **Step 6: รันให้ผ่าน** — `npm test && npm run typecheck && npm run build` Expected: PASS และมี `dist/index.html`, `dist/cesium/Assets/Textures/NaturalEarthII/tilemapresource.xml`
- [ ] **Step 7: ตรวจว่า server ส่งหน้าเว็บได้** เขียน `<tmp>/settings.json` ที่ `daily.enabled: false` ก่อน แล้วเปิด `GNSS_STUDIO_DATA=<tmp> GNSS_STUDIO_PORT=8765 server/.venv/bin/python -m gnss_studio_server` (จาก `server/`) `curl -s 127.0.0.1:8765/ | grep 'id="root"'` และ `curl -sI 127.0.0.1:8765/cesium/Assets/Textures/NaturalEarthII/tilemapresource.xml` ได้ 200 แล้วปิด server และตรวจว่าไม่มี process ค้าง
- [ ] **Step 8: Commit** `feat(gnss-studio): scaffold the workspace web app with theme tokens and API types`

---

### Task 2: เวลาและ Animation

**Files:**
- Create: `web/src/time/format.ts`, `parse.ts`, `steps.ts`, `clock.ts`, `web/src/stores/time.ts`
- Test: `web/tests/unit/time-format.test.ts`, `steps.test.ts`, `time-store.test.ts`

**Interfaces:**
- Produces:
  - `formatTime(d: Date, fmt: "UTCG" | "LTZG", ltzOffset: string): string`, `parseTime(text: string, fmt: "UTCG" | "LTZG", ltzOffset: string): Date | null` (W17)
  - `STEPS_S: readonly number[]` (32 ค่าใน spec §6.1), `nextStep(s: number): number`, `prevStep(s: number): number`, `formatStep(s: number): string` (W18)
  - `type TimeMode = "normal" | "realtime" | "xrealtime"`; `interface TimeState { current: Date; mode: TimeMode; direction: 1 | -1 | 0; step_s: number; multiplier: number; cycle: "off" | "stop" | "loop"; periodStart: Date; periodStop: Date; animStart: Date }`
  - ฟังก์ชันล้วน `advance(s: TimeState, dtRealS: number): TimeState` (W1, W2), `timeFromScenario(doc): TimeState` (`time_step`→`normal`, `real_time`→`realtime`, `x_real_time`→`xrealtime`; `animation.start` ว่าง = ต้นช่วงวิเคราะห์)
  - `useTime` (Zustand): state + `init(doc)`, `reset()`, `stepForward()`, `stepBackward()`, `start()`, `reverse()`, `pause()`, `increaseStep()`, `decreaseStep()`, `setMode(m)`, `setMultiplier(x)`, `setCurrent(d)`, `tick(dtRealS)`
  - `startClock(): () => void` (`clock.ts`: requestAnimationFrame ตัวเดียวทั้งแอป เรียก `tick` ด้วยเวลาจริงที่ผ่านไป คืนฟังก์ชันหยุด)

- [ ] **Step 1: เขียน test ที่ fail**

```ts
test("UTCG matches the STK manual example", () => {
  expect(formatTime(new Date("2026-01-01T16:00:00Z"), "UTCG", "+07:00")).toBe("1 Jan 2026 16:00:00.000 UTCG");
});
test("LTZG shifts by the offset, crosses midnight and keeps milliseconds", () => {
  expect(formatTime(new Date("2026-11-12T07:00:00Z"), "LTZG", "+07:00")).toBe("12 Nov 2026 14:00:00.000 LTZG+07:00");
  expect(formatTime(new Date("2026-11-12T20:30:00.500Z"), "LTZG", "+07:00")).toBe("13 Nov 2026 03:30:00.500 LTZG+07:00");
  expect(formatTime(new Date("2026-01-01T03:00:00Z"), "LTZG", "-05:00")).toBe("31 Dec 2025 22:00:00.000 LTZG-05:00");
});
test("parse inverts format to the millisecond", () => {
  for (const iso of ["2026-11-12T07:00:00.123Z", "2026-02-28T23:59:59.999Z", "2024-02-29T00:00:00.000Z"])
    for (const f of ["UTCG", "LTZG"] as const)
      expect(parseTime(formatTime(new Date(iso), f, "+07:00"), f, "+07:00")?.toISOString()).toBe(iso);
});
test("parse accepts a missing suffix, a 1-digit day and a lowercase month", () => {
  expect(parseTime("1 jan 2026 16:00:00", "UTCG", "+07:00")?.toISOString()).toBe("2026-01-01T16:00:00.000Z");
  expect(parseTime("12 Nov 2026 14:00:00.000", "LTZG", "+07:00")?.toISOString()).toBe("2026-11-12T07:00:00.000Z");
  expect(parseTime("12 Nov 2026 14:00:00 LTZG+05:00", "LTZG", "+07:00")?.toISOString()).toBe("2026-11-12T09:00:00.000Z");
});
test("parse rejects garbage, impossible dates and the other format", () => {
  for (const s of ["", "tomorrow", "31 Feb 2026 00:00:00", "12 Nov 2026 24:00:00", "12 Nov 2026 07:00:00.1234",
                   "2026-11-12T07:00:00Z", "12 Nov 2026 07:00:00.000 LTZG+07:00"])
    expect(parseTime(s, "UTCG", "+07:00")).toBeNull();
});
test("step table has the 32 STK values", () => {
  expect(STEPS_S).toHaveLength(32); expect(STEPS_S[0]).toBe(0.0001); expect(STEPS_S[31]).toBe(31536000);
});
test("Increase from 60 three times gives 600 (manual example)", () => expect(nextStep(nextStep(nextStep(60)))).toBe(600));
test("ends clamp and off-table values snap", () => {
  expect(prevStep(0.0001)).toBe(0.0001); expect(nextStep(31536000)).toBe(31536000);
  expect(nextStep(45)).toBe(60); expect(prevStep(45)).toBe(30);
});
test("step display", () => {
  expect(formatStep(60)).toBe("60.00 sec"); expect(formatStep(0.0005)).toBe("0.0005 sec"); expect(formatStep(0.01)).toBe("0.01 sec");
});
// time-store.test.ts ใช้ S0 = period 2026-11-12T00:00Z–2026-11-13T00:00Z, animStart = periodStart, current = 12:00Z, step 60
test("normal mode moves one step per refresh at 30 Hz", () => expect(+advance({ ...S0, direction: 1 }, 1).current - +S0.current).toBe(1_800_000));
test("real-time and x real-time follow the wall clock", () => {
  expect(+advance({ ...S0, mode: "realtime", direction: 1 }, 2.5).current - +S0.current).toBe(2_500);
  expect(+advance({ ...S0, mode: "xrealtime", multiplier: 60, direction: -1 }, 1).current - +S0.current).toBe(-60_000);
});
test("cycle stop pauses at the ends", () => {
  const s = advance({ ...S0, current: new Date("2026-11-12T23:59:00Z"), direction: 1, cycle: "stop" }, 1);
  expect(s.current.toISOString()).toBe("2026-11-13T00:00:00.000Z"); expect(s.direction).toBe(0);
});
test("cycle loop wraps both ways", () => {
  expect(advance({ ...S0, current: new Date("2026-11-12T23:59:00Z"), direction: 1, cycle: "loop" }, 1).current.toISOString()).toBe("2026-11-12T00:00:00.000Z");
  expect(advance({ ...S0, current: new Date("2026-11-12T00:01:00Z"), direction: -1, cycle: "loop" }, 1).current.toISOString()).toBe("2026-11-13T00:00:00.000Z");
});
test("cycle off runs past the end", () => {
  expect(+advance({ ...S0, current: new Date("2026-11-12T23:59:00Z"), direction: 1, cycle: "off" }, 1).current).toBeGreaterThan(+S0.periodStop);
});
test("buttons", () => { /* reset → animStart, direction 0, step unchanged; stepForward → +60 s, direction 0;
  stepBackward → −60 s; pause keeps current; increaseStep ×3 from 60 → 600; reverse → direction −1 */ });
test("timeFromScenario maps codes", () => { /* update_mode "x_real_time" → "xrealtime"; time_step_s 60; animation.start null → periodStart */ });
```

- [ ] **Step 2: รันให้ fail** — `npm test` Expected: FAIL
- [ ] **Step 3: เขียนโค้ด** (ปฏิทินและ offset คิดเอง ห้ามใช้ timezone ของเครื่อง)
- [ ] **Step 4: รันให้ผ่าน** — `npm test && npm run typecheck` Expected: PASS
- [ ] **Step 5: Commit** `feat(gnss-studio): animation clock, STK step table and UTCG/LTZG time formats`

---

### Task 3: ชื่อแบบ STK และข้อความไทย

**Files:**
- Create: `web/src/labels/labels.ts`, `web/src/labels/messages.th.ts`
- Test: `web/tests/unit/labels.test.ts`

**Interfaces:**
- Produces:
  - `type LabelKey`; `labels: Record<LabelKey, { text: string; source: "stk" | "ours"; ref?: string }>` (`ref` เช่น `"STK ref §A"`); `t(key: LabelKey): string`; `oursLabels(): { key: LabelKey; text: string }[]`
  - `msg(key: MsgKey, vars?: Record<string, string | number>): string` ข้อความไทย รวมคำอธิบายธงดาว (`flag.stale`, `flag.too_old`, `flag.no_broadcast`, `flag.unhealthy`, `flag.prn_changed`, `flag.name_mismatch`)
  - คีย์ครบทุกชื่อใน spec §4–§13 ตั้งแต่งานนี้ (เมนู §5.1 และรายการ, แถบ §5.2 และปุ่ม, ชื่อหน้าต่าง §4.1/§11, หน้า Properties และช่อง §8, ตัวเลือกที่แสดง เช่น `Time Step`/`Real Time`/`X Real-Time`/`Off`/`Stop at Time`/`Loop at Time`, Object Browser §7, Timeline §10, Message Viewer §11, แถบสถานะ §12) งานหลังเพิ่มคีย์ได้แต่ต้องผ่าน test นี้

- [ ] **Step 1: เขียน test ที่ fail**

```ts
const ref = readFileSync(resolve(__dirname, "../../../docs/2026-11-11-gnss-studio-stk-reference.md"), "utf8");
test("every stk label appears verbatim in the STK reference", () => {
  const missing = Object.entries(labels).filter(([, l]) => l.source === "stk" && !ref.includes(l.text)).map(([k]) => k);
  expect(missing).toEqual([]);
});
test("STK words of the main chrome are stk labels", () => {
  for (const [k, text] of [["menu.file", "File"], ["menu.analysis", "Analysis"], ["menu.utilities", "Utilities"],
      ["anim.start", "Start"], ["anim.reset", "Reset"], ["anim.increaseStep", "Increase Time Step"],
      ["window.objectBrowser", "Object Browser"], ["window.timelineView", "Timeline View"], ["window.messageViewer", "Message Viewer"],
      ["page.scenario.basicTime", "Basic - Time"], ["page.facility.constraintsActive", "Constraints - Active"],
      ["mv.tab.all", "All Messages"], ["mv.clearTab", "Clear this Tab"], ["timeline.setAnimationTimeToHere", "Set Animation Time to Here"]] as const) {
    expect(t(k)).toBe(text); expect(labels[k].source).toBe("stk");
  }
});
test("our additions are marked ours", () => {
  for (const k of ["menu.utilities.fetchOrbitData", "menu.utilities.dailyForecastSettings", "menu.analysis.validation",
                   "page.scenario.basicIonosphere", "window.welcome", "window.satelliteCatalog", "help.stkReference"] as const)
    expect(labels[k].source).toBe("ours");
  expect(t("window.welcome")).toBe("Welcome to GNSS Studio");
});
test("Thai flag explanations exist for every engine flag", () => {
  for (const f of ["stale", "too_old", "no_broadcast", "unhealthy", "prn_changed", "name_mismatch"]) expect(msg(`flag.${f}` as MsgKey)).toMatch(/[฀-๿]/);
});
```

- [ ] **Step 2: รันให้ fail**
- [ ] **Step 3: เขียน `labels.ts` และ `messages.th.ts`**
- [ ] **Step 4: รันให้ผ่าน** — `npm test && npm run typecheck`
- [ ] **Step 5: Commit** `feat(gnss-studio): STK label table with reference check and Thai messages`

---

### Task 4: API client, SSE และ store ข้อมูล

**Files:**
- Create: `web/src/api/client.ts`, `web/src/api/events.ts`, `web/src/stores/scenario.ts`, `results.ts`, `jobs.ts`, `messages.ts`, `settings.ts`, `selection.ts`, `web/src/data/catalog.ts`, `web/src/data/files.ts`
- Test: `web/tests/unit/client.test.ts`, `events.test.ts`, `scenario-store.test.ts`, `results-store.test.ts`, `messages-store.test.ts`, `catalog.test.ts`

**Interfaces:**
- Consumes: `types.gen.ts` (Task 1), `parseTime`/`formatTime` (Task 2)
- Produces:
  - `class ApiError extends Error { status; code; text; field: string | null; detail: string | null }`; `apiGet<T>(path): Promise<{ data: T; etag: string | null; headers: Headers }>`; `apiSend<T>(method, path, body?, ifMatch?: string | null): Promise<{ data: T; etag: string | null; headers: Headers }>` (body ไม่ใช่ JSON → `ApiError` code `HTTP_<status>`)
  - `connectEvents(h: { onEvent(name: "job" | "message" | "scenario" | "daily" | "ping", data: unknown): void; onStatus(connected: boolean): void }, o?: { EventSourceImpl?: typeof EventSource; backoffS?: number[]; backfill?(sinceIso: string | null): Promise<void> }): () => void` ค่าตั้งต้น backoff `[1, 2, 4, 8, 16, 30]` (ค้างที่ 30)
  - `useScenario`: `{ name, doc, etag, tree, catalog: Map<number, CatalogEntry>, conflict: boolean, load(name), reload(), close(), putDoc(mutate: (doc) => void): Promise<{ stale: boolean }>, patchObject(cls, name, pages): Promise<{ stale: boolean }>, insert(body): Promise<string[]>, rename(cls, name, newName), remove(cls, name), setGroup(name, members), onScenarioEvent(e) }` (412 → `conflict = true` แล้วโยน `ApiError` ต่อ; `reload()` ล้าง conflict)
  - `satelliteInfo(norad): (CatalogEntry & { hidden: boolean; warn: boolean }) | undefined` (W9)
  - `useResults`: `{ status, manifest, prnByNorad: Map<number, string>, dop: DopRow[], refresh(), ephemUrl(file), accessUrl(fac, file), dopAt(t: Date): DopRow | undefined, loadAer(fac): Promise<AerRow[]> }` (refresh เมื่อเปิด scenario, เมื่อได้ event `scenario` และเมื่อ job ของ scenario นี้ `succeeded`)
  - `useJobs`: `{ jobs: Record<string, Job>, onJobEvent(e), cancel(id), activeFor(scenario): Job | undefined, daily: DailyStatus | null }`
  - `useMessages`: `{ items: Message[], add(m), clearTab(tab: "all" | "error" | "info" | "warning"), clearAll(), visible(tab): Message[], lastTime: string | null }` (Clear this Tab ซ่อนเฉพาะในแท็บนั้น)
  - `useSettings`: `{ health, settings, connected: boolean, loadHealth(), loadSettings(), saveSettings(s) }`
  - `useSelection`: `{ activePath: string | null, select(path), cursorLatLon: [number, number] | null }`
  - `startEventWiring(): () => void` ต่อ `connectEvents` เข้ากับทุก store (backfill = `GET /api/messages?since=`)
  - `parseDopCsv(text): DopRow[]` (เฉพาะ `system == "ALL"`), `parseAerCsv(text): AerRow[]`

- [ ] **Step 1: เขียน test ที่ fail** (ใช้ fetch ปลอมใน test ห้ามต่อเน็ต)
  - `client`: 422 ได้ `ApiError` ที่ `field` ตาม body; 412 code `ETAG_MISMATCH`; GET คืน `etag` ตาม header; `If-Match` ส่งค่าเดิมตามตัว (รวมเครื่องหมายคำพูด)
  - `events reconnect with backoff and backfills missed messages` (Review Focus 2): EventSource ปลอม error 7 ครั้งติด → `onStatus(false)` และหน่วงเวลาตามลำดับ 1, 2, 4, 8, 16, 30, 30 วินาที (fake timers); ต่อได้แล้ว `onStatus(true)` และ `backfill` ถูกเรียกด้วย `lastTime` ของข้อความล่าสุด; ข้อความที่ซ้ำกับที่มีอยู่ (time + code + text เดียวกัน) ไม่ถูกเพิ่ม
  - `scenario-store`: `patchObject` ส่ง `If-Match` เป็น etag ปัจจุบันและเก็บ etag ใหม่จาก response; 412 → `conflict === true` และ doc ไม่เปลี่ยน; `reload()` ดึงใหม่และ `conflict === false`; `putDoc` อ่าน `X-Results-Stale: true` → `{ stale: true }`
  - `catalog`: ดาวธง `["no_broadcast"]` ซ่อนเมื่อ `show_no_broadcast` ปิด และไม่ซ่อนเมื่อเปิด; ธง `["name_mismatch"]` → `warn === false`; ธง `["name_mismatch", "stale"]` → `warn === true`
  - `results-store`: `parseDopCsv` จากหัว `time_utc,system,n_visible,gdop,pdop,hdop,vdop,edop,ndop,tdop` เก็บเฉพาะ ALL; `dopAt(2026-11-11T00:00:45Z)` ได้แถว 00:00:30; `prnByNorad` จาก manifest
  - `messages-store`: `clearTab("error")` แล้ว `visible("error")` ว่าง แต่ `visible("all")` ยังมีข้อความ error; `clearAll()` ทุกแท็บว่าง; ข้อความใหม่หลัง clear แสดงตามปกติ
- [ ] **Step 2: รันให้ fail**
- [ ] **Step 3: เขียนโค้ด**
- [ ] **Step 4: รันให้ผ่าน** — `npm test && npm run typecheck`
- [ ] **Step 5: Commit** `feat(gnss-studio): API client, SSE reconnect and workspace data stores`

---

### Task 5: ระบบหน้าต่างและ Workbook

**Files:**
- Create: `web/src/layout/panels.ts`, `defaultLayout.ts`, `workbook.ts`, `web/src/stores/layout.ts`, `web/src/chrome/WindowsDialog.tsx`, `web/src/Workspace.tsx`; Modify: `web/src/App.tsx`
- Test: `web/tests/unit/workbook.test.ts`, `layout.test.tsx`

**Interfaces:**
- Consumes: `t()` (Task 3), `useScenario` (Task 4)
- Produces:
  - `type PanelKind = "objectBrowser" | "graphics3d" | "graphics2d" | "timelineView" | "messageViewer" | "propertiesBrowser" | "insertObjects" | "satelliteCatalog" | "newScenarioWizard" | "welcome" | "viewFromTo" | "windowProperties3d" | "windowProperties2d" | "fetchOrbitData" | "dailyForecastSettings" | "about" | "stkReference"`
  - `registerPanel(kind, def: { component: React.FC<{ params: any; panelId: string }>; title(params): string; type: "dockable" | "integrated" | "floating"; singleton: boolean })` (งานแรกลงทะเบียนตัวแทนชั่วคราวให้ทุก kind งานหลังแทนด้วยหน้าต่างจริง)
  - `useLayout`: `{ api, openPanel(kind, params?): string, closePanel(id), newGraphicsWindow(kind: "graphics3d" | "graphics2d"): string, tile(dir: "horizontal" | "vertical"), cascade(), listWindows(): { id, title, type }[], setType(id, type), toolbars, setToolbar(name, visible), windowProps, toWorkbook(): Workbook, fromWorkbook(w: unknown): void, applyDefault() }`
  - `nextGraphicsTitle(existing: string[], kind): string` (`"3D Graphics 2 - Earth"`), `validateWorkbook(x: unknown): Workbook | null` (W6), `workbookBytes(w): number`
  - เปิด scenario: `GET workbook` → `fromWorkbook` ถ้าใช้ได้ ไม่งั้น `applyDefault()` (spec §4.2) kind ที่ไม่รู้จักใน workbook ข้ามพร้อมข้อความ warning ใน Message Viewer
  - เมนู Window (Windows..., Cascade, Tile Horizontally, Tile Vertically, รายชื่อหน้าต่าง) ทำงานผ่าน `useLayout`; คลิกขวาที่แถบชื่อหน้าต่าง: Dockable / Floating / Integrated; panel ที่เปลี่ยนขนาดแจ้ง `onResize` ให้หน้าต่าง Cesium (W3 risk)

- [ ] **Step 1: เขียน test ที่ fail**
  - `nextGraphicsTitle(["3D Graphics 1 - Earth"], "graphics3d") === "3D Graphics 2 - Earth"` และเว้นเลขที่ว่าง (มี 1, 3 → 2)
  - workbook round trip: `validateWorkbook(toWorkbook())` ไม่ null และ `fromWorkbook` บน api ใหม่ได้ panel id, title และกลุ่มเดิม
  - workbook ที่ `version` ไม่ใช่ 1, ไม่ใช่ object หรือขนาด > 1,048,576 ไบต์ → null และ Save ไม่ส่งพร้อมข้อความ error
  - `layout.test.tsx` (DockviewReact ใน jsdom โดยใส่ `ResizeObserver` ปลอม): `applyDefault()` ได้ 5 panel ตาม spec §4.2: Object Browser กลุ่มซ้าย; `3D Graphics 1 - Earth` และ `2D Graphics 1 - Earth` คนละกลุ่มวางข้างกัน; Timeline View และ Message Viewer อยู่กลุ่มเดียวกันด้านล่าง
  - `listWindows()` คืนชนิดตาม spec §4.1 (Object Browser = Dockable, 3D = Integrated, Properties Browser = Floating)
- [ ] **Step 2: รันให้ fail**
- [ ] **Step 3: เขียนโค้ด** (ถ้า dockview mount ใน jsdom ไม่ได้ ให้ทดสอบ `applyDefault` ผ่าน `DockviewComponent` ของ `dockview-core` แบบไม่มี DOM จริง และบอกในรายงาน)
- [ ] **Step 4: รันให้ผ่าน** — `npm test && npm run typecheck`
- [ ] **Step 5: Commit** `feat(gnss-studio): dockview workspace with STK window types and workbook persistence`

---

### Task 6: เมนู แถบเครื่องมือ แถบสถานะ และคีย์ลัด

**Files:**
- Create: `web/src/commands.ts`, `web/src/shortcuts.ts`, `web/src/chrome/MenuBar.tsx`, `Toolbars.tsx`, `StatusBar.tsx`, `ContextMenu.tsx`, `Dialogs.tsx`, `HealthBanner.tsx`; Modify: `web/src/Workspace.tsx`
- Test: `web/tests/unit/menubar.test.tsx`, `toolbars.test.tsx`, `statusbar.test.tsx`, `shortcuts.test.ts`, `dialogs.test.tsx`

**Interfaces:**
- Consumes: `useTime` (Task 2), labels (Task 3), stores (Task 4), `useLayout` (Task 5)
- Produces:
  - `type CommandId` ครบทุกรายการของ spec §5.1–§5.2, §7: `file.new file.open file.save file.saveAs file.close file.exit file.recent.1..4 edit.cut edit.copy edit.paste edit.delete edit.find view.objectBrowser view.timelineView view.messageViewer view.new3d view.new2d view.toolbar.<name> view.fullScreen insert.new insert.facility insert.satellite insert.constellation analysis.access analysis.reportGraphManager analysis.validation object.properties object.access object.reportGraphManager object.zoomTo object.rename object.delete utilities.fetchOrbitData utilities.dailyForecastSettings window.windows window.cascade window.tileHorizontally window.tileVertically help.welcome help.stkReference help.about anim.reset anim.stepBackward anim.reverse anim.pause anim.start anim.stepForward anim.decreaseStep anim.increaseStep anim.normal anim.realtime anim.xrealtime g3d.homeView g3d.viewFromTo g3d.properties g3d.grabGlobe g3d.zoomIn g2d.properties g2d.zoomIn g2d.zoomOut ob.newGroup ob.expandAll ob.collapseAll ob.colorSelectors ob.onOffToggles ob.showFlagged`
  - `registerCommand(id, { label: LabelKey; run(): void; enabled?(): boolean; tooltip?(): string })`, `runCommand(id)`, `isEnabled(id)` (ยังไม่ลงทะเบียน = ปิดใช้) งานนี้ลงทะเบียน `view.*`, `window.*`, `anim.*` (View → Full Screen ใช้ `requestFullscreen`, Toolbars ▸ ใช้ `useLayout.setToolbar`) คำสั่งอื่นลงทะเบียนในงานที่ทำหน้าต่างนั้น
  - ทุกปุ่มบนแถบเครื่องมือมี tooltip เป็นชื่อจาก `labels.ts` (spec §5.2)
  - MenuBar ตาม spec §5.1 เมนูที่ 6 ชื่อตาม class ของ object ที่เลือก (ไม่เลือก = `Scenario`) รายการ Properties, Access..., Report & Graph Manager..., Zoom To, Rename, Delete
  - Toolbars ตาม spec §5.2 ช่อง X Real Time Multiplier แสดงเฉพาะโหมด X Real-Time
  - StatusBar ทุกช่องตาม spec §12 และ W10 คลิก ⚠ = คำสั่ง `ob.showFlagged` (Task 8 ลงทะเบียน); ช่องงานประจำวันแสดงสถานะจาก `useJobs.daily` และแถบ progress ของ job ที่กำลังรัน (stage + fraction) พร้อมปุ่ม Stop → `useJobs.cancel(id)`
  - `Dialogs.tsx`: กล่อง 412 (Reload / Cancel) จาก `useScenario.conflict`; กล่อง job ล้มเหลวพร้อม Details (job ที่ `origin == "user"` ของ scenario ที่เปิด); `confirm(text): Promise<boolean>` ใช้ร่วมกัน
  - `HealthBanner` ตาม W10 และ spec §15
  - คีย์ลัด: Ctrl+S (`file.save`, ห้าม browser save), Delete (`object.delete` เมื่อโฟกัสอยู่ Object Browser), Ctrl+F (`edit.find` เมื่อโฟกัสอยู่ Object Browser); ไม่จับ Ctrl+N/Ctrl+O/Ctrl+Q

- [ ] **Step 1: เขียน test ที่ fail**
  - ลำดับเมนูบนสุดตรงตัว: `File, Edit, View, Insert, Analysis, <Class>, Utilities, Window, Help`; เลือก `*/Satellite/G01` แล้วเมนูที่ 6 เป็น `Satellite`
  - Analysis ทั้งสามรายการ `aria-disabled` และ tooltip ไทยตาม W4
  - กด Increase Time Step 3 ครั้งจาก 60 แล้วช่อง Time Step เป็น `600.00 sec`; ปุ่ม Start ทำให้ `useTime.direction === 1`; Reset กลับ Animation Start Time
  - `Current Scenario Time rejects bad text and keeps the time` (Review Focus 4): พิมพ์ `garbage` + Enter → ช่อง `aria-invalid="true"` มี class ขอบแดง เวลาไม่เปลี่ยน; พิมพ์เวลา UTCG ที่ถูกต้องนอกช่วงวิเคราะห์ + Enter → เวลาเปลี่ยนตาม
  - ช่อง X Real Time Multiplier ไม่แสดงในโหมด Normal และแสดงหลังกด X Real-Time Animation Mode
  - แถบสถานะ: Active Object `*/Satellite/G01`; Animation Time ตาม DateFormat (`LTZG` แสดง `LTZG+07:00`); `settings.connected = false` → ช่องสีแดงพร้อมข้อความไทย; PDOP จาก `dopAt` แสดง `PDOP 0.85 (41)`
  - คีย์ลัด: Ctrl+S เรียก `file.save` และ `preventDefault`; Ctrl+N ไม่ถูก `preventDefault`
  - `useScenario.conflict = true` → กล่อง 412 แสดง กด Reload เรียก `reload()`
- [ ] **Step 2: รันให้ fail**
- [ ] **Step 3: เขียนโค้ด** (Radix Menubar ให้คีย์บอร์ดเปิดเมนูได้ตาม spec §14)
- [ ] **Step 4: รันให้ผ่าน** — `npm test && npm run typecheck`
- [ ] **Step 5: Commit** `feat(gnss-studio): STK menu bar, toolbars, status bar, shortcuts and error dialogs`

---

### Task 7: Welcome, New Scenario Wizard, เปิด/บันทึก และ About

**Files:**
- Create: `web/src/windows/Welcome/Welcome.tsx`, `web/src/windows/NewScenarioWizard/NewScenarioWizard.tsx`, `web/src/windows/About/About.tsx`, `web/src/windows/StkReference/StkReference.tsx`, `web/src/recent.ts`, `web/src/chrome/SaveAsDialog.tsx`
- Test: `web/tests/unit/welcome.test.tsx`, `wizard.test.tsx`, `about.test.tsx`, `recent.test.ts`

**Interfaces:**
- Consumes: `useScenario`, `useLayout`, `registerCommand`, `registerPanel`
- Produces: คำสั่ง `file.*`, `help.welcome`, `help.about`, `help.stkReference`; `recent.push(name)`, `recent.list(): string[]` (W5)
  - เปิดหน้าเว็บโดยไม่มี scenario ที่เปิดค้าง (ไม่มี `?sc=` ใน URL) → Welcome ลอยกลางจอ: Create a Scenario, Open a Scenario (รายชื่อจาก `GET /api/scenarios` พร้อมช่วงเวลาและเครื่องหมายงานประจำวัน), รายการล่าสุด
  - เปิด scenario ใส่ `?sc=<name>` ใน URL (reload แล้วเปิดเดิม)
  - New Scenario Wizard: Name, Location (อ่านอย่างเดียว `data/scenarios/`), Start, Stop (ข้อความตาม DateFormat UTCG, Stop ตั้งต้น = Start + 1 วัน), Template **(ours)** (`THBK + ดาวทุกดวง 4 ระบบ` → `thbk-gnss`, `ว่าง` → `empty`), Orbit data (snapshot จาก `GET /api/orbits` ตั้งต้นใหม่สุด) → `POST /api/scenarios` → เปิด → เปิด Insert STK Objects
  - Save As: ชื่อใหม่ → PUT workbook → `POST /copy` → เปิดชื่อใหม่; Close/Exit → ปิด scenario กลับ Welcome
  - About: รุ่น engine (`/health`), รุ่น GMAT (`gmat_version` ใน manifest ephem ปัจจุบัน หรือ `—`), หมายเหตุว่าชื่อเมนูอ้างอิงคู่มือ STK 13.1.0 และ GNSS Studio ไม่ใช่ผลิตภัณฑ์ของผู้พัฒนา STK, รายการ `oursLabels()` ทั้งหมด
  - STK UI Reference (W21)

- [ ] **Step 1: เขียน test ที่ fail**
  - About แสดงทุกข้อความใน `oursLabels()` (spec §13 เกณฑ์ข้อ 4)
  - Wizard ส่ง `{name, start, stop, template, snapshot}` เป็น ISO Z; ตอบ 409 `NAME_EXISTS` → ช่อง Name ขอบแดงพร้อม `text` ของ server; Stop ตั้งต้น = Start + 1 วัน
  - `recent.push` ไม่ซ้ำ เก็บ 4 ชื่อล่าสุด ใหม่อยู่บนสุด; localStorage อ่านไม่ได้ → `list()` คืน `[]` ไม่โยน error
  - Welcome แสดงรายการล่าสุดก่อนรายชื่อทั้งหมด คลิกชื่อเรียก `useScenario.load`
- [ ] **Step 2: รันให้ fail**
- [ ] **Step 3: เขียนโค้ด**
- [ ] **Step 4: รันให้ผ่าน** — `npm test && npm run typecheck`
- [ ] **Step 5: Commit** `feat(gnss-studio): welcome, new scenario wizard, save as and about windows`

---

### Task 8: Object Browser

**Files:**
- Create: `web/src/windows/ObjectBrowser/ObjectBrowser.tsx`, `tree.ts`, `FindDialog.tsx`, `NewGroupDialog.tsx`, `RenameDialog.tsx`, `clipboard.ts`
- Test: `web/tests/unit/object-tree.test.ts`, `object-browser.test.tsx`

**Interfaces:**
- Consumes: `useScenario.tree` (รูปจาก `GET /objects`: root `{path:"*", class:"Scenario", name, children}` แล้ว Facility, Constellation, โฟลเดอร์ `{group, children}`, ดาวที่ไม่อยู่ในกลุ่ม), `satelliteInfo` (Task 4), `confirm` (Task 6)
- Produces: `flattenTree(tree, expanded: Set<string>): Row[]` (`Row = { key, depth, kind: "object" | "group", path?, cls?, name, color?, show?, hidden, warn, tooltip }`); คำสั่ง `edit.cut/copy/paste/delete/find`, `object.properties/rename/delete`, `ob.newGroup`, `ob.expandAll`, `ob.collapseAll`, `ob.colorSelectors`, `ob.onOffToggles`, `ob.showFlagged`

- [ ] **Step 1: เขียน test ที่ fail**
  - แถว: ราก `S1`; `THBK`; Constellation `GPS`; โฟลเดอร์ `GPS sats` มี `G01`; ดาวธง `no_broadcast` (show_no_broadcast ปิด) เป็นตัวเอียงและช่องติ๊ก `disabled`; ⚠ เมื่อมีธง `stale` และไม่มี ⚠ เมื่อมีแค่ `name_mismatch`
  - tooltip มี PRN, SVN, NORAD, Block, ชื่อ CelesTrak, อายุ 1 ตำแหน่งทศนิยม และธงทั้งหมดเป็นภาษาไทย
  - ติ๊ก Show ของ G01 → `patchObject("Satellite","G01",{graphics2d:{show:false},graphics3d:{show:false}})`
  - ดับเบิลคลิกเปิด Properties Browser ของ object นั้น; คลิกขวาได้รายการตามลำดับ Properties, Access..., Report & Graph Manager..., Zoom To, Rename, Delete (Zoom To ใช้ได้เมื่อมีหน้าต่าง 3D เปิดอยู่)
  - Delete → กล่องยืนยัน → `DELETE`; Cancel → ไม่เรียก
  - Copy + Paste ของ G01 → insert Define Properties ชื่อ `G01_1` NORAD เดิม; ถ้ามี `G01_1` แล้ว → `G01_2` (W15)
  - Cut G01 + Paste บนโฟลเดอร์ `Mine` → `POST /groups` ของ `Mine` ที่สมาชิกมี `*/Satellite/G01`
  - Find `g0` เลือกแถวแรกที่ตรง Next วนต่อ; ArrowDown/ArrowUp เลื่อน, ArrowRight ขยาย, ArrowLeft พับ, Enter เปิด Properties
  - ดับเบิลคลิกกล่องสี → เลือกสี → `patchObject` ตั้ง `graphics2d.color` และ `inherit:false`
  - `ob.showFlagged` กรองให้เห็นเฉพาะดาวที่ ⚠ (กดซ้ำยกเลิก)
- [ ] **Step 2: รันให้ fail**
- [ ] **Step 3: เขียนโค้ด** (ต้นไม้ยาว 130+ แถวใช้ TanStack Virtual)
- [ ] **Step 4: รันให้ผ่าน** — `npm test && npm run typecheck`
- [ ] **Step 5: Commit** `feat(gnss-studio): STK object browser with flags, groups and clipboard`

---

### Task 9: Properties Browser

**Files:**
- Create: `web/src/windows/PropertiesBrowser/PropertiesBrowser.tsx`, `form.ts`, `pages/ScenarioPages.tsx`, `pages/FacilityPages.tsx`, `pages/SatellitePages.tsx`, `pages/ConstellationPages.tsx`
- Test: `web/tests/unit/properties.test.tsx`, `form.test.ts`

**Interfaces:**
- Consumes: `GET /objects/{cls}/{name}` (`{basic, graphics2d, graphics3d, constraints}`), `useScenario.patchObject/putDoc`, `ENUMS` (Task 1), `satelliteInfo` (Task 4)
- Produces: คำสั่ง `object.properties`; `diffPages(original, edited): Partial<Pages>` (ส่งเฉพาะกลุ่มหน้าที่เปลี่ยน), `fieldFromServer(field: string): string` (แปลง `constraints.elevation_angle_min_deg` เป็นคีย์ช่อง)
  - หน้าตามตาราง spec §8 ชื่อหน้า "กลุ่ม - หน้า" ปุ่ม OK / Cancel / Apply / Help (Help เปิด STK UI Reference)
  - ช่องที่ engine อ่านเป็นข้อมูลของดาว (Basic - Orbit, PRN/SVN/Block/ธง) อ่านอย่างเดียว; Short Description = `description`, Long Description = `long_description`
  - Facility Constraints - Active: รายการ constraint ที่ใช้อยู่, Add... (กล่อง Select Constraints to Add มีเฉพาะ Elevation Angle ใน v1), Remove (ตั้ง `elevation_angle_min_deg` เป็น 0 และ `elevation_angle_max_deg` เป็น null), Elevation Angle: Min, Max
  - Constellation Basic - Definition: Available Objects / Assigned Objects พร้อมปุ่มย้ายทีละตัวและทั้งหมด และ Selection Filter (ค้นตามชื่อ); สีของสมาชิก **(ours)** = `color` ของ Constellation
  - Apply แล้ว `stale === true` → `useResults.refresh()`

- [ ] **Step 1: เขียน test ที่ fail**
  - รายการหน้าตรงตัว: Scenario `Basic - Time`, `Basic - Units`, `Basic - Description`, `Basic - Ionosphere`, `2D Graphics - Global Attributes`; Facility `Basic - Position`, `Basic - Description`, `Constraints - Active`, `2D Graphics - Attributes`; Satellite `Basic - Orbit`, `Basic - Description`, `2D Graphics - Attributes`, `2D Graphics - Pass`, `2D Graphics - Swath`, `3D Graphics - Orbit System`; Constellation `Basic - Definition`, `Basic - Description`
  - THBK มุมเงยต่ำสุด 15 → Apply → PATCH body `{constraints:{elevation_angle_min_deg:15}}` พร้อม `If-Match`; response `results_stale: true` → `refresh` ถูกเรียก
  - 422 `field: "constraints.elevation_angle_min_deg"` → ช่องนั้น `aria-invalid` และแสดง `text` ของ server
  - `Apply on a stale ETag shows the conflict dialog and Reload refetches` (Review Focus 3): 412 → กล่อง Reload/Cancel; Reload → ดึง scenario และหน้า object ใหม่ ช่องแสดงค่าของ server
  - Scenario Basic - Time เปลี่ยน Stop → `PUT /scenarios/S1` ทั้งก้อนที่ `analysis_period.stop` ใหม่ อ่าน `X-Results-Stale`
  - Lead Type มีตัวเลือกตาม `ENUMS.LeadType`; Trail Type มี `Same As Lead`; Time Update Mode แสดง `Time Step` / `Real Time` / `X Real-Time` แต่ส่งรหัส `time_step` / `real_time` / `x_real_time`
  - OK = Apply แล้วปิด; Cancel ปิดโดยไม่ส่ง request
  - ย้าย G01 ไป Assigned → PATCH `basic.assigned_objects` มี `*/Satellite/G01`
- [ ] **Step 2: รันให้ fail**
- [ ] **Step 3: เขียนโค้ด**
- [ ] **Step 4: รันให้ผ่าน** — `npm test && npm run typecheck`
- [ ] **Step 5: Commit** `feat(gnss-studio): STK properties browser with field errors and conflict handling`

---

### Task 10: Insert STK Objects, Search Satellite Catalog, Fetch Orbit Data และ Daily Forecast Settings

**Files:**
- Create: `web/src/windows/InsertObjects/InsertObjects.tsx`, `web/src/windows/SatelliteCatalog/SatelliteCatalog.tsx`, `web/src/windows/FetchOrbitData/FetchOrbitData.tsx`, `web/src/windows/DailyForecastSettings/DailyForecastSettings.tsx`
- Modify: `server/gnss_studio_server/routes/orbits.py`, `server/tests/test_orbits.py`, `docs/2026-11-11-gnss-studio-server-design.md` (§6.2 แถว fetch-status)
- Test: `web/tests/unit/insert.test.tsx`, `catalog-window.test.tsx`, `fetch-window.test.tsx`, `daily-window.test.tsx`

**Interfaces:**
- Produces:
  - server `GET /api/orbits/fetch-status` → `{"groups": {"gps-ops": {"last_request_utc": str | null, "next_allowed_utc": str | null}, "glo-ops": ..., "galileo": ..., "beidou": ...}}` อ่านอย่างเดียวจาก `data/orbits/_cache/celestrak_state.json` (`next_allowed = last_request + CELESTRAK_MIN_INTERVAL_S`) ไฟล์หายหรือเสีย → ทุกค่าเป็น null และตอบ 200 ห้ามดึงเน็ต
  - คำสั่ง `insert.new/facility/satellite/constellation`, `utilities.fetchOrbitData`, `utilities.dailyForecastSettings`
  - Insert STK Objects ตาม spec §11 (Facility: Define Properties, Insert Default; Satellite: From Satellite Catalog **(ours)**, Define Properties; Constellation: Define Properties) ปุ่ม Insert...
  - Search Satellite Catalog: Data Sources (`Local snapshot` / `Online CelesTrak` ที่เปิด Fetch Orbit Data โดยไม่ดึงเอง), System (All, G, R, E, C), คำค้น, ตาราง PRN / SVN / NORAD / Block / Name / Age / Status (เลือกหลายแถว), Create Constellation from Selected + ชื่อ, Insert; ดึง `/api/catalog` ครั้งเดียวต่อการเปิดหน้าต่างแล้วกรองในหน้าเว็บ
  - Fetch Orbit Data: snapshot ล่าสุด กลุ่มและจำนวนดาว เวลาที่ดึงได้ครั้งถัดไปต่อกลุ่ม ปุ่ม Fetch Now → กล่องยืนยันภาษาไทยที่บอกว่าจะดาวน์โหลดจาก CelesTrak → `POST /api/orbits/fetch`
  - Daily Forecast Settings: ช่องตาม server §9.1 (Cesium token เป็นช่องรหัสผ่าน) → `PUT /api/settings` ทั้งก้อน; สถานะงานประจำวันจาก `/health`; ที่อยู่ไฟล์ `<data_dir>/daily/latest.csv`; ปุ่ม Run Now → กล่องยืนยัน → `POST /api/daily/run`

- [ ] **Step 1: เขียน test ที่ fail**
  - server: `test_fetch_status_without_state_file` (ทุกกลุ่ม null), `test_fetch_status_adds_two_hours` (`last_request` 2026-11-11T10:00:00Z → `next_allowed_utc` 2026-11-11T12:00:00Z), `test_fetch_status_corrupt_state_is_null`
  - web: เลือก E11, E14 + Create Constellation `Mine` → `POST /objects` body `{"class":"Satellite","method":"From Satellite Catalog","norads":[<E11>,<E14>],"create_constellation":"Mine"}`
  - กรอง System `E` เห็นเฉพาะแถว E; คำค้น `beidou-3 g4` เห็น C01; เลือก Online CelesTrak เปิด Fetch Orbit Data และไม่มี request ไป `/api/orbits/fetch`
  - Fetch Now → ยกเลิกในกล่องยืนยัน → ไม่ส่ง; ยืนยัน → `POST /api/orbits/fetch` ครั้งเดียว
  - Daily Forecast Settings ส่ง PUT ที่มีทุกช่องของ §9.1; 422 `field: "daily.run_at_utc"` → ช่องนั้นขอบแดง; Run Now ต้องยืนยันก่อน
- [ ] **Step 2: รันให้ fail**
- [ ] **Step 3: เขียนโค้ด** (test ฝั่งเว็บใช้ fetch ปลอม ห้ามต่อเน็ต)
- [ ] **Step 4: รันให้ผ่าน** — `npm test && npm run typecheck` และ server suite `-W error`
- [ ] **Step 5: Commit** `feat(gnss-studio): insert objects, satellite catalog search, orbit fetch and daily settings windows`

---

### Task 11: Cesium และหน้าต่าง 3D

**Files:**
- Create: `web/src/cesium/viewer.ts`, `clockSync.ts`, `czml.ts`, `graphics.ts`, `inertial.ts`, `testHooks.ts`, `web/src/windows/Graphics3D/Graphics3D.tsx`, `WindowProperties3D.tsx`, `web/src/windows/ViewFromTo/ViewFromTo.tsx`
- Test: `web/tests/unit/graphics.test.ts`, `inertial.test.ts`

**Interfaces:**
- Consumes: `useTime`, `useResults` (`ephemUrl`, `accessUrl`, `prnByNorad`, `status`), `useScenario`, `satelliteInfo`
- Produces:
  - `createViewer(el: HTMLElement, mode: "3d" | "2d"): Viewer` (W7; ปิด widget ทุกตัว, `shouldAnimate = false`, credit อยู่มุมล่าง, ไม่มี Ion)
  - `loadScene(viewer, sceneUrl: string, accessUrls: string[]): Promise<CzmlDataSource>` (`CzmlDataSource.load` แล้ว `process` แต่ละ access เข้าแหล่งเดียวกัน)
  - `entityIdFor(obj: SceneObject, prnByNorad: Map<number, string>): string | undefined` (W8)
  - `graphicsFor(obj, doc, ctx: { hidden: boolean; mode: "3d" | "2d" }): { show: boolean; color: string; labelShow: boolean; pointPixelSize: number; markerStyle: string; lineStyle: string; lineWidth: number }` ลำดับสี: `inherit:false` + สีตัวเอง → สีตัวเอง; `inherit:true` + สี Constellation ที่เป็นสมาชิก → สีนั้น; อื่นๆ → ตัวแปร CSS ของระบบ
  - `applyGraphics(ds: CzmlDataSource, doc, ctx)` ตั้งกราฟิกของ entity โดยไม่โหลด CZML ใหม่ (3D: จุด ป้ายชื่อ และ path ครึ่งคาบทั้งสองข้าง)
  - `syncClock(viewer, d: Date)`; `toInertial(samples: { t: JulianDate; p: Cartesian3 }[], ref: JulianDate): Cartesian3[]` = `M(ref) · M(tᵢ)ᵀ · pᵢ` เมื่อ `M(t) = Transforms.computeTemeToPseudoFixedMatrix(t)`
  - `installTestHooks()` (W19): `window.__gnssStudioTest = { setTime(iso): void; entityPositionEcef(name, iso?): [number, number, number] | null; entityColor(name): string | null; labelShown(name): boolean | null; sceneLoadedAt(): number | null; frameCount(): number }` (`name` = ชื่อ object ใน scenario แปลงผ่าน `entityIdFor`)
  - ลงทะเบียนคำสั่ง `g3d.*` และ `object.zoomTo` (แถบ 3D Graphics และ 3D Window Defaults ทำงานกับหน้าต่าง 3D ที่ active)
  - หน้าต่าง 3D: Home View (ระยะกล้อง 4.5 รัศมีโลก), Zoom To (`object.zoomTo`), View From/To (Mode From Position to Position, From/To Position, Reference Frame Fixed/Inertial), 3D Graphics Window Properties (Lighting: Enable Lighting, Ambient Level, Sun Level, Night Lights Level; Details: Lat/Lon Lines, Label Declutter; Annotation: Show Time) เก็บใน `useLayout.windowProps`, Orbit System Inertial by Window ใช้ `toInertial` เพื่อการแสดงผลเท่านั้น, Shift + ล้อเมาส์ = Step Forward/Backward, แถบไทยเมื่อผล `stale` หรือ `missing` ("ผลลัพธ์ไม่ตรงกับ scenario ปัจจุบัน — กด Apply เพื่อคำนวณใหม่" ปุ่ม Apply = `POST /propagate`), ไม่มี WebGL → ข้อความไทยแทนภาพ, panel เปลี่ยนขนาด → `viewer.resize()`

- [ ] **Step 1: เขียน test ที่ fail**

```ts
const prn = new Map([[62339, "G01"]]);
test("entityIdFor maps renamed and copied satellites by NORAD", () => {   // Review Focus 5
  expect(entityIdFor(sat("G01", 62339), prn)).toBe("sat/G01");
  expect(entityIdFor(sat("GPS01", 62339), prn)).toBe("sat/G01");
  expect(entityIdFor(sat("G01_1", 62339), prn)).toBe("sat/G01");
  expect(entityIdFor(sat("X", 99999), prn)).toBeUndefined();
  expect(entityIdFor(fac("THBK"), prn)).toBe("fac/THBK");
});
test("colour precedence", () => { /* inherit true + GPS colour #ffd23f → "#ffd23f"; inherit false + #00ff00 → "#00ff00";
  no colours, system E → value of --color-galileo */ });
test("hidden and Show Labels", () => { /* hidden → show false; doc.graphics2d_global.show_labels false → labelShow false */ });
test("inertial path is the identity at the reference time and keeps lengths", () => {
  // p ที่ ref เท่าเดิมภายใน 1e-6 m; |p| คงที่ภายใน 1e-6 สัมพัทธ์สำหรับ t = ref ± 3 ชม.
});
```

- [ ] **Step 2: รันให้ fail**
- [ ] **Step 3: เขียนโค้ด** (Cesium ใน Vitest ใช้ได้เฉพาะ math: Cartesian3, JulianDate, Transforms)
- [ ] **Step 4: รันให้ผ่าน** — `npm test && npm run typecheck && npm run build`
- [ ] **Step 5: ตรวจด้วยตา** เปิด server กับ data ชั่วคราวที่มี `settings.json` ปิดงานประจำวันและสำเนา scenario ที่มีผล (เช่นคัดลอก `acc_20261111` และ snapshot `20261110T2147Z` จาก checkout หลัก) แล้วเปิดหน้าเว็บ ดาวขึ้นและเดินเมื่อกด Start ปิด server เมื่อเสร็จ
- [ ] **Step 6: Commit** `feat(gnss-studio): Cesium 3D graphics window with STK views and test hooks`

---

### Task 12: หน้าต่าง 2D, ground track, swath และ IPP

**Files:**
- Create: `web/src/cesium/passes.ts`, `swath.ts`, `night.ts`, `ipp.ts`, `web/src/windows/Graphics2D/Graphics2D.tsx`, `WindowProperties2D.tsx`
- Test: `web/tests/unit/passes.test.ts`, `swath.test.ts`, `night.test.ts`

**Interfaces:**
- Consumes: `createViewer(el, "2d")`, `loadScene`, `applyGraphics` (Task 11), `useResults.loadAer`
- Produces:
  - `MU_KM3_S2 = 398600.4418`; `orbitPeriodS(meanRadiusKm: number): number`
  - `leadTrailS(pass, ctx: { t: number; start: number; stop: number; periodS: number; ascendingNodes: number[] }): { leadS: number; trailS: number }` (วินาที; Time = ค่า, Percent = %·คาบ, Quarter/Half/Full = คาบ ¼/½/1, All และ Current Interval = ถึงปลาย/จากต้นช่วงวิเคราะห์, None = 0, One Pass = ถึงจุดขึ้นถัดไป/จากจุดขึ้นก่อนหน้า, Same As Lead = ค่าของ lead)
  - `ascendingNodeTimes(samples: { t: number; z: number }[]): number[]` (z เปลี่ยนจากลบเป็นบวก ประมาณเชิงเส้น)
  - `EARTH_RADIUS_KM = 6371.0088`; `footprintCentralAngleRad(altKm, elevDeg) = acos(Re·cos ε / (Re + h)) − ε`; `footprintRing(latDeg, lonDeg, altKm, elevDeg, n = 72): [lon: number, lat: number][]`
  - `subsolarPoint(d: Date): { lat: number; lon: number }`, `nightPolygon(d: Date, n = 180): [number, number][]` (W2 risk ของ spec)
  - ลงทะเบียนคำสั่ง `g2d.*` (แถบ 2D Window Defaults ทำงานกับหน้าต่าง 2D ที่ active)
  - หน้าต่าง 2D: Projection Equidistant Cylindrical (`GeographicProjection`) / Mercator (`WebMercatorProjection`), Display Coordinate Frame ECF, Details: Lat/Lon Lines (`GridImageryProvider`) และ IPP **(ours)**, Lighting: Show Outline (เส้นแบ่งกลางวันกลางคืน) และ Shading (polygon กลางคืนโปร่งแสงเมื่อแสงของ globe ใช้ไม่ได้ในโหมด 2D), ground track ตาม `leadTrailS` (W20), Swath Edge Limits (เส้นวง) / Filled Limits (polygon) อัปเดตตามเวลาไม่เกิน 10 ครั้งต่อวินาที, จุดและเส้นทาง IPP ของดาวที่อยู่ใน access จาก `aer.csv` (โหลดเมื่อเปิดตัวเลือกเท่านั้น), พิกัดใต้เมาส์ → `useSelection.cursorLatLon`

- [ ] **Step 1: เขียน test ที่ fail**

```ts
const T = 43077.757;
test("GPS period from the mean radius", () => expect(orbitPeriodS(26560)).toBeCloseTo(43077.757, 2));
test("lead/trail types", () => {
  const ctx = { t: 10_000, start: 0, stop: 86_400, periodS: T, ascendingNodes: [5_000, 48_077.757] };
  expect(leadTrailS({ lead_type: "Time", lead_time_s: 1800, trail_type: "Same As Lead" }, ctx)).toEqual({ leadS: 1800, trailS: 1800 });
  const q = leadTrailS({ lead_type: "Quarter", trail_type: "Half" }, ctx); expect(q.leadS).toBeCloseTo(T / 4, 6); expect(q.trailS).toBeCloseTo(T / 2, 6);
  const p = leadTrailS({ lead_type: "Percent", lead_percent: 10, trail_type: "Full" }, ctx); expect(p.leadS).toBeCloseTo(4307.7757, 4); expect(p.trailS).toBeCloseTo(T, 6);
  expect(leadTrailS({ lead_type: "All", trail_type: "Current Interval" }, ctx)).toEqual({ leadS: 76_400, trailS: 10_000 });
  expect(leadTrailS({ lead_type: "None", trail_type: "None" }, ctx)).toEqual({ leadS: 0, trailS: 0 });
  const o = leadTrailS({ lead_type: "One Pass", trail_type: "One Pass" }, ctx); expect(o.leadS).toBeCloseTo(38_077.757, 6); expect(o.trailS).toBe(5_000);
});
test("ascending node by linear interpolation", () => expect(ascendingNodeTimes([{ t: 0, z: -1 }, { t: 100, z: 1 }, { t: 200, z: -1 }])).toEqual([50]));
test("GNSS footprint at 10° ground elevation", () => {
  expect(footprintCentralAngleRad(20200, 10) * 180 / Math.PI).toBeCloseTo(66.341744, 5);
  expect(EARTH_RADIUS_KM * footprintCentralAngleRad(20200, 10)).toBeCloseTo(7376.876, 2);
  expect(footprintCentralAngleRad(35786, 10) * 180 / Math.PI).toBeCloseTo(71.440883, 5);
  expect(footprintCentralAngleRad(20200, 0) * 180 / Math.PI).toBeCloseTo(76.126861, 5);
});
test("footprint ring points lie at the central angle", () => {
  // ทุกจุดของ footprintRing(13.729779, 100.781151, 20200, 10) ห่างจากศูนย์กลางตามวงกลมใหญ่ = มุมข้างบนภายใน 1e-9 rad และมี 72 จุด
});
test("subsolar point near the June 2026 solstice", () => {
  const s = subsolarPoint(new Date("2026-06-21T12:00:00Z")); expect(s.lat).toBeCloseTo(23.44, 0); expect(Math.abs(s.lon)).toBeLessThan(1);
});
```

- [ ] **Step 2: รันให้ fail**
- [ ] **Step 3: เขียนโค้ด**
- [ ] **Step 4: รันให้ผ่าน** — `npm test && npm run typecheck && npm run build`
- [ ] **Step 5: ตรวจด้วยตา** แบบเดียวกับ Task 11 Step 5 (3D และ 2D เปิดพร้อมกัน, เปลี่ยน Projection, เปิด Swath และ IPP) บันทึกหน่วยความจำ GPU คร่าวๆ จาก Chrome Task Manager ลงรายงาน (spec W1)
- [ ] **Step 6: Commit** `feat(gnss-studio): 2D graphics window with ground tracks, swath, lighting and IPP`

---

### Task 13: Timeline View และ Message Viewer

**Files:**
- Create: `web/src/windows/TimelineView/TimelineView.tsx`, `scale.ts`, `rows.ts`, `web/src/windows/MessageViewer/MessageViewer.tsx`
- Test: `web/tests/unit/timeline-scale.test.ts`, `timeline.test.tsx`, `message-viewer.test.tsx`

**Interfaces:**
- Consumes: `useTime`, `useScenario.doc.accesses`, `GET /access/intervals?from&to` (409 `RESULTS_NOT_CURRENT` = แถวว่างพร้อมข้อความไทย), `useMessages`, `useLayout.toWorkbook` (`timelineHidden`)
- Produces:
  - `timeToX(t, v0, v1, width)`, `xToTime(x, v0, v1, width)`, `tickStepS(spanS, widthPx): number` (ขั้นเล็กสุดใน `[1, 5, 10, 30, 60, 300, 600, 1800, 3600, 7200, 21600, 43200, 86400, 172800, 604800]` ที่ห่างกันอย่างน้อย 80 px), `zoomViewPort(v0, v1, centerT, factor, bounds): [number, number]` (ไม่เกินช่วงวิเคราะห์ ไม่แคบกว่า 60 วินาที)
  - `timelineRows(doc, intervals): { name: string; color: string; intervals: { start: number; stop: number }[] }[]` จาก access ที่ `timeline: true` ชื่อแถว `<Facility>-To-<Satellite>` สีตาม `graphics.color_mode` (`object` = สีดาว, `custom` = `custom_color`)
  - TimelineView บน canvas: Global Time Bar (ตัวชี้สีขาวลากได้, กรอบ View Port ลากขอบได้), Global Time Scale (ตาม DateFormat), Time Display (ล้อเมาส์ซูมรอบตำแหน่งเมาส์), คลิกเพื่อตั้งเวลา, คลิกขวา Set Animation Time to Here, บนแถบช่วงเวลา Set Animation Time to Interval Start Time / Interval Stop Time, Center, Remove from Timeline (เก็บใน `timelineHidden`)
  - MessageViewer: แท็บ All Messages / Errors / Infos / Warnings, ตาราง TanStack Virtual คอลัมน์ Time / Level / Code / Object / Message, ปุ่ม Details (กล่องข้อความเต็มและ detail), Clear this Tab, Clear all Tabs

- [ ] **Step 1: เขียน test ที่ fail**
  - `xToTime(timeToX(t))` คืน t (±1e-6 วินาที); `tickStepS(86400, 1000) === 7200`; `tickStepS(3600, 1000) === 300`
  - `zoomViewPort` ซูมออกเกินช่วงได้ช่วงเต็ม ซูมเข้าไม่แคบกว่า 60 วินาที
  - access THBK → GPS (`timeline: true`) ที่ intervals มี G01 → แถว `THBK-To-G01` สีของ G01
  - คลิกขวาที่ x แล้ว Set Animation Time to Here → `useTime.current = xToTime(x)`; บนแถบช่วงเวลา Set Animation Time to Interval Stop Time → เวลาปลายช่วงนั้น; Remove from Timeline ซ่อนแถวและอยู่ใน `toWorkbook().timelineHidden`
  - Message Viewer: แท็บ Errors แสดงเฉพาะ error; Clear this Tab ที่ Errors แล้ว All Messages ยังมี; Clear all Tabs ว่างทุกแท็บ; Details แสดง `detail`
- [ ] **Step 2: รันให้ fail**
- [ ] **Step 3: เขียนโค้ด**
- [ ] **Step 4: รันให้ผ่าน** — `npm test && npm run typecheck`
- [ ] **Step 5: Commit** `feat(gnss-studio): timeline view and message viewer`

---

### Task 14: E2E, การวัดประสิทธิภาพ และ README

**Files:**
- Create: `web/playwright.config.ts`, `web/tests/e2e/fixture/build_fixture.py`, `web/tests/e2e/start-server.sh`, `web/tests/e2e/layout.spec.ts`, `animation.spec.ts`, `position.spec.ts`, `properties.spec.ts`, `timeline.spec.ts`, `insert.spec.ts`, `messages.spec.ts`, `conflict.spec.ts`, `nores.spec.ts`, `perf.spec.ts`
- Modify: `web/package.json` (`e2e` = `npm run build && playwright test`), `README.md` (หัวข้อใหม่ "9. GNSS Studio workspace")

**Interfaces:**
- Consumes: ทุกงานก่อนหน้า, `window.__gnssStudioTest` (Task 11)
- Produces:
  - `build_fixture.py <out_dir>` (รันด้วย `server/.venv/bin/python -I`): คัดลอก `tests/fixtures/studio/snapshot` → `<out>/orbits/20261110T0000Z`; เขียน `<out>/settings.json` ครบ §9.1 ที่ `daily.enabled: false`; สร้าง `E2E`, `E2E_NORES` (thbk-gnss ช่วง 2026-11-10T00:00Z–06:00Z) และ `E2E_EMPTY` (empty) ด้วย `templates.new_scenario` + `ScenarioStore.create`; patch `gnss_predict.studio.propagate`, `find_gmat_console`, `gmat_version` ด้วยวงโคจรวงกลม (รัศมี G 26 560 km, R 25 508 km, E 29 600 km, C ตาม PRN: GEO 42 164 km ที่ลองจิจูดคงที่, อื่น 27 906 km; ตำแหน่ง Earth-fixed = วงกลมเฉื่อยหมุนด้วย ωe = 7.2921151467e-5 rad/s) แล้ว `run_propagate` + `run_analyze("THBK")` ของ `E2E` เท่านั้น
  - `start-server.sh`: ลบแล้วสร้าง `test-results/e2e-data` ด้วย `build_fixture.py` แล้วเปิด server จาก `server/` ด้วย `GNSS_STUDIO_DATA=<dir> GNSS_STUDIO_PORT=8766 GMAT_BIN=/nonexistent`
  - `playwright.config.ts`: Chromium อย่างเดียว, `workers: 1`, `baseURL: http://127.0.0.1:8766`, `webServer: { command: "bash tests/e2e/start-server.sh", url: "http://127.0.0.1:8766/api/health", reuseExistingServer: false }`, launch args `--enable-unsafe-swiftshader --use-angle=swiftshader` (ให้ WebGL ทำงานใน headless)
  - หน้าในทุก spec เปิดด้วย `?test` และฟัง `pageerror` (ถ้ามีถือว่า fail)

- [ ] **Step 1: เขียน spec ที่ fail** (spec §16 และ Review Focus)
  - `layout.spec`: เปิด `/?sc=E2E&test` → การจัดวางตาม spec §4.2; ปิด Timeline View แล้ว Ctrl+S → reload → Timeline View ยังปิดและหน้าต่างอื่นอยู่ที่เดิม (เกณฑ์ข้อ 5)
  - `animation.spec`: Start → Current Scenario Time เปลี่ยนภายใน 2 วินาที; Pause; Step Forward → เพิ่ม 60 วินาทีพอดี; Reset → Animation Start Time
  - `position.spec` (เกณฑ์ข้อ 3): `setTime("2026-11-10T01:02:30Z")`; อ่าน `predicted.sp3` จาก `/api/scenarios/E2E/ephem/<hash>/predicted.sp3`; epoch GPST `*  2026 11 10  1  2 48.00000000` (UTC + 18 วินาที) บรรทัด `PG01` × 1000 → ระยะจาก `entityPositionEcef("G01")` ≤ 1 ม.
  - `properties.spec`: คลิกขวา G01 → Properties → 2D Graphics - Attributes → สี `#00ff00` → Apply → `entityColor("G01") === "#00ff00"`; Properties ของ Scenario → 2D Graphics - Global Attributes → ปิด Show Labels → Apply → `labelShown("G01") === false`
  - `timeline.spec`: คลิกขวาที่ Global Time Bar ตำแหน่ง x → Set Animation Time to Here → ช่อง Animation Time บนแถบสถานะตรงกับ `xToTime(x)` ภายในเวลา 1 pixel
  - `insert.spec`: เปิด `E2E_EMPTY` → Insert → New... → Satellite → From Satellite Catalog → เลือก E11, E14 → Create Constellation from Selected `Mine` → Insert → Object Browser มี `Mine`, `E11`, `E14`
  - `messages.spec`: `page.request.post("/api/scenarios/E2E/propagate")` (มีผลแล้ว engine คืนทันทีโดยไม่ใช้ GMAT และส่งข้อความใน manifest) → แถวใหม่ขึ้นใน Message Viewer ภายใน 10 วินาที; Clear this Tab ที่แท็บของระดับนั้นลบเฉพาะแท็บนั้น All Messages ยังมี
  - `conflict.spec` (Review Focus 3): ใช้สำเนาของ `E2E_NORES` (`POST /copy` ชื่อสุ่ม) เปิด Properties ของ THBK; `page.request` อ่าน ETag แล้ว PATCH คำอธิบายของ THBK; ในหน้าเว็บเปลี่ยนมุมเงยแล้ว Apply → กล่อง Reload/Cancel; Reload → ช่อง Description เป็นค่าที่ request แก้
  - `nores.spec` (Review Focus 1): `/?sc=E2E_NORES&test` → แถบ "ยังไม่มีผลลัพธ์" ในหน้าต่าง 3D และ 2D, Object Browser มี THBK, เปิด Properties ของ THBK ได้, ไม่มี `pageerror`
  - `perf.spec` (W13): `test.skip(!process.env.GNSS_E2E_PERF_URL)`; เปิด `<URL>` (scenario รายวันจริง) จับเวลาจากเปิดหน้าถึง `sceneLoadedAt()` ≤ 3000 ms (เกณฑ์ข้อ 1); กด Start แล้ว `frameCount()` ใน 5 วินาที ≥ 150 (เกณฑ์ข้อ 2) พิมพ์ตัวเลขทั้งสอง
- [ ] **Step 2: รันให้ fail แล้วแก้จนผ่าน** — `npx playwright install chromium` แล้ว `npm run e2e` Expected: ผ่านทุก spec ยกเว้น perf ที่ข้าม แก้โค้ดของงานก่อนหน้าได้ถ้า e2e พบข้อบกพร่อง (บอกในรายงานทีละข้อ)
- [ ] **Step 3: วัดประสิทธิภาพบนเครื่องพัฒนา** สร้างโฟลเดอร์ชั่วคราวใน scratchpad, เขียน `settings.json` ที่ `daily.enabled: false` ก่อน, คัดลอก scenario รายวันหรือ `acc_20261111` และ snapshot ที่มันใช้จาก `/Users/phuwish/SSSGMAT/api-interop/gnss-predict/data/` (ห้ามเปิด server บน data จริงเพราะงานประจำวันอาจดึง CelesTrak), เปิด server port 8767 แล้ว `GNSS_E2E_PERF_URL="http://127.0.0.1:8767/?sc=<ชื่อ>&test" npx playwright test perf.spec.ts --headed` บันทึกตัวเลขลง README ถ้าไม่ผ่านเกณฑ์ บันทึกตามจริงและบอกในรายงาน ปิด server เมื่อเสร็จ
- [ ] **Step 4: README หัวข้อ 9 (ภาษาไทย)** ติดตั้ง (`npm ci`), พัฒนา (`npm run dev` คู่กับ server ที่ 8000 และเหตุที่ proxy เขียน Origin ใหม่), build แล้วเปิดที่ `http://127.0.0.1:8000/`, `npm run gen:api` เมื่อ API เปลี่ยน, การทดสอบทุกชั้น, ขั้นตอนวัดประสิทธิภาพและผลที่วัด, browser ที่รองรับ (WebGL), ข้อจำกัด v1 (Visible Sides วาดแบบ Both, 2D ใช้ ECF เท่านั้น, Analysis รองานย่อยที่ 4)
- [ ] **Step 5: รันทุกชุด** — `npm test && npm run typecheck && npm run build && npm run e2e`; server suite `-W error`; engine `python3 -m unittest discover -s tests` Expected: ผ่านทั้งหมด
- [ ] **Step 6: Commit** `test(gnss-studio): end-to-end workspace checks, performance procedure and README`

เกณฑ์ข้อ 2 (30 ภาพต่อวินาที) ขึ้นกับเครื่องและ GPU ผลใน headless ไม่ใช่ตัวตัดสิน ใช้ผลจาก Step 3 บนเครื่องพัฒนา
