# Gpredict Web Data & Preferences Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** งานย่อยที่ 4 ของ Gpredict Web: Preferences กลุ่ม General และ Modules, รูปแบบตัวเลขและเวลา, TLE sources และการตรวจอายุ,
Update TLE จากไฟล์, log แบบ Gpredict และ Log browser, Satellite Info, Detach/Attach/Full screen, การสืบทอดค่าของ module,
สีและภาพแผนที่ จนไม่มีรายการไหนของ Gpredict ที่กดไม่ได้

**Architecture:** ค่ารวมทุกตัวอยู่ใน `preferences.json` ของงานย่อยที่ 2 (`prefs.py`) ด้วย key ของ Gpredict ไฟล์ module เก็บเฉพาะค่าที่ตั้งเอง
(`version: 2`) แล้ว `store.py` ประกอบค่าที่ใช้จริงตามลำดับ module → ค่ารวม → ค่าตั้งต้น server เพิ่มตัวอ่าน TLE ข้อความ, การรวม TLE
ตามกติกาของ Gpredict, ตัวดึงตาม source พร้อม proxy, ตัวตรวจอายุทุก 10 นาที, logger รูปแบบ Gpredict และช่อง `/ws/app`
ส่วนหน้าเว็บจัดรูปแบบเวลา/หน่วย/ทิศเองทั้งหมดจาก `NumberFormat` ที่อ่านจาก Preferences

**Tech Stack:** ชุดเดียวกับ core (Python 3.14, FastAPI 0.162.4, unittest; React 19.1.10, Vite 8.3.5, TypeScript 5.9.3, Vitest 4.1.12)
ไม่เพิ่ม dependency (ไม่มี `python-multipart`)

**Spec:** [2026-11-12-gpredict-web-data-design.md](2026-11-12-gpredict-web-data-design.md) อ่านคู่กับ
[ref-D](2026-11-12-gpredict-reference-data.md) ("spec §n" = spec ของงานนี้, "ref-D §n" = รายการอ้างอิงส่วน Data & Preferences,
"ref §n" = รายการอ้างอิงหลัก, "P-plan" = [แผนงานย่อยที่ 2](2026-11-12-gpredict-web-passes-plan.md), "radio" = spec งานย่อยที่ 3)

## Global Constraints

- ทำงานใน worktree `/Users/phuwish/SSSGMAT/.worktrees/gpredict-web` บน branch `feature/gpredict-web-data` (แตกจากปลายของ
  `feature/gpredict-web-radio`) เท่านั้น ห้าม `cd` เข้า checkout หลัก `/Users/phuwish/SSSGMAT` ห้าม push ห้าม merge
  ห้ามใช้ `git stash` แบบไม่มีชื่อ
- `*.md` ถูก ignore ที่ราก repo: ไฟล์ Markdown (รวม `SOURCE.md`) ต้อง `git add -f`
- ห้ามแก้ `api-interop/gnss-predict/` (engine): `omm.fetch_group(..., opener=)` รับ opener อยู่แล้วจึงใส่ proxy ได้โดยไม่แก้ engine
  GNSS Studio ต้องได้ผลเหมือนเดิมทุกไบต์
- คำสั่ง test
  - server: `cd api-interop/gpredict-web/server && ../.venv/bin/python -m unittest discover -s tests`
  - web: `cd api-interop/gpredict-web/web && npm test` และ `npm run build`
  - engine (ตรวจว่าไม่กระทบ): `cd api-interop/gnss-predict && python3 -m unittest discover -s tests`
- test ห้ามใช้เน็ต ใช้ data dir ชั่วคราวเสมอ (`helpers.temp_config`) และ opener ปลอม ข้อมูลภายนอกใน test เป็น fixture ใน `server/tests/fixtures/`
- ข้อมูลภายนอกที่ผู้ใช้อนุมัติแล้ว (2026-11-12, spec §1.2): ดึง AMSAT `nasabare.txt` ไม่เกิน 1 ครั้งต่อ URL ต่อ 2 ชม.,
  คัดลอกภาพแผนที่ 15 ภาพจาก `/private/tmp/claude-501/-Users-phuwish-SSSGMAT/114b42d7-6d4e-43e1-9eca-01e73a947a66/scratchpad/gpredict-src/repo/pixmaps/maps`,
  ดาวน์โหลด `https://tgftp.nws.noaa.gov/data/nsd_cccc.txt` ครั้งเดียวตอนพัฒนา ห้ามใช้ `locations.dat` ของ Gpredict (GPL)
- CelesTrak: 1 ครั้งต่อกลุ่มต่อ 2 ชม. ผ่าน `GNSS_STUDIO_DATA` `orbits/_cache/celestrak_state.json` ร่วมกับ GNSS Studio
  การดึงจริงในการตรวจรับต้องได้รับความยินยอมจากผู้ใช้ก่อน ถ้าไม่ได้ให้ใช้ cache ที่มี
- HTTP ที่ server ส่งเองใช้ User-Agent `gpredict-web` ห้ามใส่อีเมลของผู้ใช้
- worktree ไม่มี GMAT build: การรันจริงใช้ `GMAT_BIN=/Users/phuwish/SSSGMAT/application/bin/GmatConsole`
  และ `GNSS_STUDIO_DATA=/Users/phuwish/SSSGMAT/api-interop/gnss-predict/data`
- ป้าย tooltip และข้อความของ Gpredict ใช้ตาม ref-D และ ref ทุกตัวอักษร ข้อความที่เราเพิ่มเป็นภาษาไทย ของที่ Gpredict ไม่มีมี comment `(ของเรา)`
- เวลาใน API เป็น ISO 8601 UTC ลงท้าย `Z` (`runtime.iso_ms`) ระยะเป็น km เสมอ หน้าเว็บแปลงหน่วยเอง
- ค่า Preferences ทุกตัวเขียนผ่าน `PUT /api/prefs` ค่าของ module ทุกตัวเขียนผ่าน `ConfigStore.save` (core §8)
- ค่าคงที่: `TLE_CHECK_INTERVAL_S=600`, `TLE_AGE_S={1: 2592000, 2: 604800, 3: 86400}`, `SOURCE_MIN_INTERVAL_S=7200`,
  `LOG_CLEAN_AGES=(0, 86400, 604800, 2592000)`, `LOG_TEXT_MAX=500`, `TIME_FORMAT_MAX=50`, `TIME_TEXT_MAX=49`,
  `KM_PER_MI=1.609344`, `FT_PER_M=3.2808399`, `MAP_UPLOAD_MAX=10*1024*1024`, `DEFAULT_MAP="nasa-bmng-07_1024.jpg"`,
  `NEW_SOURCE_URL="http://server.com/file.txt"`, `DETACH_POLL_MS=1000`, `GEOMETRY_DEBOUNCE_MS=1000`, `APP_WS_RETRY_MS=2000`
- commit message แบบ conventional ภาษาอังกฤษ scope `gpredict-web` ลงท้ายด้วย `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## Review Focus

1. **เปิด server ครั้งแรกหลังอัปเกรดจากงานย่อย 1–3** ไฟล์ module แบบเดิมต้องถูกย้ายเป็นแบบสืบทอดโดยค่าที่ใช้จริงไม่เปลี่ยน มีสำเนาเดิม
   และเปิดซ้ำไม่ย้ายซ้ำ → Task 3 `test_migration_keeps_effective_values_and_backup`, `test_migration_runs_once`
2. **AMSAT หรือ CelesTrak ต่อไม่ได้ หรือ proxy ผิด** Update ต้องจบพร้อมคำเตือน TLE เดิมไม่หาย และบันทึกเวลาขอไว้กันขอถี่
   → Task 7 `test_source_failure_keeps_old_tles`, `test_text_source_rate_limited_per_url`
3. **Time format แปลกๆ** (รหัสที่ไม่รู้จัก, `%` ท้ายข้อความ, ยาวเกิน 49 ตัวหลังแปลง) ต้องแสดงได้ไม่ล้ม
   → Task 13 `formatTime leaves unknown codes, a trailing % and truncates to 49`
4. **ลบสถานีตั้งต้นพร้อมสถานีที่ module ที่เปิดอยู่ใช้ ในการกด OK ครั้งเดียว** ต้องไม่ 500 module เปลี่ยนเป็น `** DEFAULT **`
   module ที่เปิดอยู่ยังทำงานด้วยสถานีเดิม → Task 4 `test_batch_delete_in_use_and_default`
5. **กด F5 ในหน้าต่างแยก หรือ browser บล็อก popup** module ต้องยังเปิดอยู่หลังโหลดใหม่ และหน้าหลักแสดงข้อความไทยโดยแท็บไม่หาย
   → Task 23 `detached page re-opens its module on load`, `blocked popup keeps the tab and shows the notice`

## การตัดสินใจในแผนที่ spec ไม่ได้กำหนดไว้

1. ไม่แก้ engine: `omm.fetch_group` รับ `opener` อยู่แล้ว proxy ใช้ `urllib.request.build_opener(ProxyHandler(...)).open`
2. ไม่เพิ่ม `python-multipart`: `POST /api/tle/local` รับ JSON `{"files": [{"name", "text"}]}` (หน้าเว็บอ่านไฟล์เป็นข้อความ)
   และ `POST /api/maps?name=<file>` รับ body ดิบที่ `Content-Type` เป็น `image/jpeg` หรือ `image/png`
3. ค่าที่สืบทอดได้ของ module เปลี่ยนได้เฉพาะเมื่อ `PUT /api/modules/{name}` ส่ง `pin`/`unpin` (Module properties) หรือ key นั้นถูกตั้งไว้แล้ว
   ค่าที่ส่งมาเฉยๆ ของ key ที่ยังสืบทอดอยู่ถูกข้าม ทำให้การบันทึกอื่นของ `ConfigStore` (เช่น Ground Track) ไม่ "ตรึง" ค่ารวมเก่าที่หน้าเว็บถืออยู่
4. ช่อง `window` ของ module เปลี่ยนได้ผ่าน `PUT /api/modules/{name}/window` เท่านั้น `PUT /api/modules/{name}` ไม่แตะช่องนี้
5. ชื่อสีใน module และ key ของ Gpredict: map `groundStation, grid, tick, satellite, selected, track, footprint, infoFg, infoBg, terminator, earthShadow`
   และ polar `background, axes, tick, satellite, selected, track, info` (ชื่อเดียวกับ `web/src/colors.ts`) เก็บเป็น int `0xRRGGBBAA`
   `MODULES/POLAR_CHART_ORIENT` เก็บเป็นชื่อทิศ `"N/E/S/W"` … แทนเลข 0–3 ของ Gpredict
6. OK ของ Preferences ตรวจทุกส่วนก่อนด้วย `?dry_run=true` (`PUT /api/prefs`, `PUT /api/qth/batch`, `PUT /api/hwconf`) ผ่านทั้งหมดจึงเขียนจริง
   ตามลำดับ prefs → สถานี → อุปกรณ์ (ทำให้ "ส่วนใดผิด ไม่มีส่วนไหนถูกบันทึก" ของ spec §10 เป็นจริงโดยไม่ต้องมี endpoint รวม)
7. `PrefSpec` ของงานย่อยที่ 2 เพิ่มช่องแบบไม่บังคับ `max_len` และ `allowed` และชนิดใหม่ `"rgba"`, `"urls"`, `"layout"`
8. `GLOBAL/CURRENT_PAGE` เป็น key ใน `preferences.json` (ลำดับในแท็บที่ไม่ใช่หน้าต่างแยก) หน้าเว็บเขียนเมื่อเปลี่ยนแท็บ อ่านตอนโหลดหน้าเท่านั้น
9. module ที่ "เป็นหน้าต่าง" ใน server รอบนี้เก็บใน set `windowed` ของ app เริ่มจาก session ที่ `window.state == 1` เมื่อ `GLOBAL/MOD_STATE` เปิด
   หน้าต่างแยกที่ปิดด้วยปุ่มของ browser ส่ง `POST …/close` แบบ `keepalive` และหน้าแยกที่โหลดใหม่เรียก `POST …/open` เสมอ
10. แถบคืนหน้าต่างแสดงทุก module ใน `windows` ที่หน้านี้ไม่ได้เปิดหน้าต่างเอง (`window.open` ชื่อเป้าหมาย `gpredict-<module>` จึงใช้หน้าต่างเดิมถ้ายังอยู่)
    หน้าต่างที่เปิดจากแถบใช้ชื่อ `Gpredict: <module> (<สถานี>)` แบบการคืนตอนเปิดโปรแกรมของ Gpredict ส่วน Detach ใช้ `GPREDICT: …`
11. รายชื่อเมืองจัดทวีปจากช่อง WMO Region ของ NOAA: 1 Africa, 2 Asia, 3 South America, 4 North and Central America,
    5 South-West Pacific, 6 Europe, 7 Antarctica ข้อความ Location เป็น `<Place Name>, <Country Name>`
12. "Epoch time:" ของ Satellite Info ใช้ epoch ที่ `parse_tle` อ่าน (ปีสองหลัก ≥ 57 เป็น 19xx) ไม่ใช่ 2000 + ปีของ Gpredict
    TLE ปัจจุบันทุกชุดได้ผลเท่ากัน
13. ข้อความ log ของ Gpredict ใช้ภาษาอังกฤษตามต้นฉบับ (ดูใน clone ตามไฟล์ที่ระบุในแต่ละ task) เหตุการณ์ที่ Gpredict ไม่มีเขียนเป็นไทย
    `POST /api/log` ผิดรูปแบบตอบ 422 รหัสใหม่ `LOG_INVALID`
14. ไฟล์แผนที่ที่ตั้งไว้หายไป: หน้าเว็บใช้ `DEFAULT_MAP` แล้วส่ง log ERROR ผ่าน `POST /api/log` (server ตอบ 404 ตามปกติ)
15. Polar plot ของ Pass details และของ Antenna Control ใช้สีและทิศของค่ารวม `MODULES/POLAR_*` (ไม่ผูกกับ module ใด)
16. คอลัมน์เวลา Updated/Epoch ของหน้าเลือกดาวซ่อนอยู่ทั้งใน Gpredict และของเรา จึงไม่ต้องจัดรูปแบบ
17. ข้อความ "<conf dir>/logs/" ในหน้า Message Logs แทนด้วย path จริงของโฟลเดอร์ log จาก `GET /api/meta` ช่องใหม่ `log_dir`

---

### Task 1: Server — key ใหม่ใน Preferences และ dry run

**Files:**
- Modify: `server/gpredict_web/prefs.py`, `server/gpredict_web/module.py` (ค่าคงที่สีตั้งต้น), `server/gpredict_web/app.py` (`?dry_run=true` ของ `PUT /api/prefs` และ `PUT /api/hwconf`)
- Test: `server/tests/test_prefs.py`, `server/tests/test_api.py`

(path ในแผนนี้นับจาก `api-interop/gpredict-web/`)

**Interfaces:**
- Consumes: P-plan Task 1 `PrefSpec`, `PREFS`, `validate`, `Prefs`; radio `PUT /api/hwconf`
- Produces:
  - `PrefSpec(kind, default, lo=None, hi=None, choices=None, max_len: int | None = None, allowed: tuple | None = None)`
    ชนิดใหม่ `"rgba"` (int 0–0xFFFFFFFF ไม่รับ bool), `"urls"` (list 1–50 ตัว แต่ละตัวตรง `^https?://[^\s;]+$` ยาวไม่เกิน 500),
    `"layout"` (ข้อความที่ผ่าน `module.parse_layout`) `"str"` ที่มี `choices` คือค่าที่เลือกได้ `allowed` คือชุดค่าที่ยอมรับของ `"int"`
  - `module.MAP_COLOURS_DEFAULT: dict[str, int]` (11 สีของ decision 5 ค่าเท่า `web/src/colors.ts`), `module.POLAR_COLOURS_DEFAULT` (7 สี), `module.MAP_SHADOW_DEFAULT = 0xDD`, `module.DEFAULT_MAP`
  - key ใหม่ใน `PREFS` (ค่าตั้งต้นตาม ref-D §14 และ `sat-cfg.c`):
    - `GLOBAL/USE_LOCAL_TIME`, `GLOBAL/USE_NSEW`, `GLOBAL/USE_IMPERIAL`, `GLOBAL/MAIN_WIN_POS`, `GLOBAL/MOD_WIN_POS`, `GLOBAL/MOD_STATE` (bool, false)
    - `GLOBAL/TIME_FORMAT` (str, max_len 50, `%Y/%m/%d %H:%M:%S`), `GLOBAL/CURRENT_PAGE` (int −1–999, −1)
    - `TLE/AUTO_UPDATE_FREQ` (int allowed 0–3, 2), `TLE/AUTO_UPDATE_ACTION` (int allowed 1–2, 1), `TLE/PROXY` (str max_len 200 ไม่มีช่องว่างหรือ `;`, ""),
      `TLE/URLS` (urls, 11 URL ของ ref-D §4 ตามลำดับรวม `FORMAT=tlet`), `TLE/ADD_NEW_SATS` (bool, true), `TLE/LAST_UPDATE` (int ≥ 0, 0)
    - `LOG/LEVEL` (int 0–4, 2), `LOG/CLEAN_AGE` (int allowed `LOG_CLEAN_AGES`, 0)
    - `MODULES/GRID` (layout, `DEFAULT_LAYOUT_CODE`), `MODULES/DATA_TIMEOUT` (100–10000, 300),
      `MODULES/LIST_REFRESH`, `MAP_REFRESH`, `POLAR_REFRESH`, `SINGLE_SAT_REFRESH`, `EVENT_LIST_REFRESH` (1–50, ค่าของ `REFRESH_DEFAULT`),
      `MODULES/LIST_COLUMNS` (columns ของ `LIST_COLUMNS`, `LIST_DEFAULT`), `MODULES/SINGLE_SAT_FIELDS` (columns ของ `SINGLE_FIELDS`, `SINGLE_DEFAULT`),
      `MODULES/MAP_SAT_NAME`, `MAP_SAT_FOTPRINT` (สะกดตาม Gpredict), `MAP_SAT_MARKER`, `MAP_QTH_INFO`, `MAP_NEXT_EVENT`, `MAP_CURSOR_TRACK`,
      `MAP_SHOW_GRID`, `MAP_SHOW_TERMINATOR` (bool ตาม `MAP_DEFAULT_OFF`), `MODULES/MAP_TRACK_NUM` (1–10, 3), `MODULES/MAP_CENTER` (−180–180, 0),
      `MODULES/MAP_FILE` (str max_len 100, `DEFAULT_MAP`), `MODULES/MAP_SHADOW_ALPHA` (int 0–255, 0xDD),
      `MODULES/MAP_QTH_COLOUR`, `MAP_GRID_COLOUR`, `MAP_TICK_COLOUR`, `MAP_SAT_COLOUR`, `MAP_SELECTED_SAT_COLOUR`, `MAP_TRACK_COLOUR`,
      `MAP_COV_AREA_COLOUR`, `MAP_INFO_COLOUR`, `MAP_INFO_BGD_COLOUR`, `MAP_TERMINATOR_COLOUR`, `MAP_EARTH_SHADOW_COLOUR` (rgba),
      `MODULES/POLAR_CHART_ORIENT` (str choices `POLAR_ORIENTATIONS`, `"N/E/S/W"`),
      `MODULES/POLAR_SAT_NAME`, `POLAR_SAT_MARKER`, `POLAR_QTH_INFO`, `POLAR_NEXT_EVENT`, `POLAR_CURSOR_TRACK`, `POLAR_EXTRA_AZ_TICKS`, `POLAR_SHOW_TRACK_AUTO` (bool),
      `MODULES/POLAR_BGD_COLOUR`, `POLAR_AXIS_COLOUR`, `POLAR_TICK_COLOUR`, `POLAR_SAT_COLOUR`, `POLAR_SELECTED_SAT_COL`, `POLAR_TRACK_COLOUR`, `POLAR_INFO_COLOUR` (rgba)
  - `PUT /api/prefs?dry_run=true` และ `PUT /api/hwconf?dry_run=true`: ตรวจเหมือนจริง ตอบแบบเดียวกัน ไม่เขียนไฟล์ ไม่ส่งเหตุการณ์

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน**

```python
def test_tle_urls_default_is_gpredict_list(self):
    urls = Prefs(self.cfg.data_dir).get("TLE/URLS")
    self.assertEqual(len(urls), 11)
    self.assertEqual(urls[0], "https://www.amsat.org/amsat/ftp/keps/current/nasabare.txt")
    self.assertEqual(urls[5], "https://celestrak.org/NORAD/elements/gp.php?GROUP=gps-ops&FORMAT=tlet")
def test_module_defaults_match_module_py(self):     # MODULES/GRID == DEFAULT_LAYOUT_CODE, LIST_COLUMNS == LIST_DEFAULT, MAP_SAT_FOTPRINT True, MAP_CURSOR_TRACK False, POLAR_CURSOR_TRACK True
def test_rgba_kind(self):                           # 0, 0xFFFFFFFF ผ่าน; -1, 2**32, True, "0xff" → PREFS_INVALID
def test_allowed_values(self):                      # LOG/CLEAN_AGE 2592000 ผ่าน, 18144000 ไม่ผ่าน; TLE/AUTO_UPDATE_ACTION 0 ไม่ผ่าน
def test_urls_kind(self):                           # [] ไม่ผ่าน; ["ftp://x"] ไม่ผ่าน; ["https://a/b;c"] ไม่ผ่าน; 51 ตัวไม่ผ่าน
def test_time_format_max_len(self):                 # 50 ตัวผ่าน, 51 ไม่ผ่าน
def test_layout_kind(self):                         # "1;0;2;0;1" ผ่าน, "1;0;2" ไม่ผ่าน
# test_api.py
def test_put_prefs_dry_run_writes_nothing(self):    # dry_run=true ค่าใหม่ → 200, values ในคำตอบเป็นค่าใหม่, GET ต่อมายังเป็นค่าเดิม, ไม่มี preferences.json
def test_put_hwconf_dry_run_writes_nothing(self):   # แบบเดียวกันกับ /api/hwconf ของงานย่อยที่ 3; ค่าผิดได้ 422 รหัสเดิมของ hwconf
```

- [ ] **Step 2: รันให้เห็นว่าล้ม** — `../.venv/bin/python -m unittest tests.test_prefs tests.test_api`
- [ ] **Step 3: Implement** — ค่าตั้งต้นของ key `MODULES/*` อ่านจากค่าคงที่ใน `module.py` ที่เดียว (ไม่พิมพ์ค่าซ้ำ)
- [ ] **Step 4: รัน test ทั้งชุดของ server** — ผ่าน
- [ ] **Step 5: Commit** — `feat(gpredict-web): general and module preference keys with dry run`

### Task 2: Server — การสืบทอดค่าของ module (`module.py`, ไม่มี I/O)

**Files:**
- Modify: `server/gpredict_web/module.py`
- Test: `server/tests/test_module.py`

**Interfaces:**
- Consumes: Task 1 ค่าคงที่สีและ `DEFAULT_MAP`
- Produces:
  - `ModuleConfig.map` เพิ่ม `"file"`, `"colours"` (11), `"shadow_alpha"`; `ModuleConfig.polar` เพิ่ม `"colours"` (7);
    field ใหม่ `window: dict = {"state": 0, "x": None, "y": None, "width": None, "height": None}` (state 0/1, x/y ≥ 0, width/height 100–10000 หรือ None)
  - `MODULE_KEYS: dict[str, str]` path ของค่าที่สืบทอดได้ → key ของ Gpredict เช่น `"layout_code": "MODULES/GRID"`,
    `"refresh.data_ms": "MODULES/DATA_TIMEOUT"`, `"refresh.event": "MODULES/EVENT_LIST_REFRESH"`, `"list_columns": "MODULES/LIST_COLUMNS"`,
    `"map.contents.Satellite Name": "MODULES/MAP_SAT_NAME"`, `"map.colours.infoBg": "MODULES/MAP_INFO_BGD_COLOUR"`, `"map.file": "MODULES/MAP_FILE"`,
    `"polar.orientation": "MODULES/POLAR_CHART_ORIENT"`, `"polar.auto_skytrack": "MODULES/POLAR_SHOW_TRACK_AUTO"`, `"single.fields": "MODULES/SINGLE_SAT_FIELDS"` …
  - `PAGE_PATHS: dict[str, tuple[str, ...]]` สำหรับ `layout`, `refresh`, `list`, `map`, `polar`, `single` (หน้า map รวมทุกสีรวม terminator และ earthShadow, refresh รวม event)
  - `GLOBAL_LAYOUT_EXTRA = ("GLOBAL/MAIN_WIN_POS", "GLOBAL/MOD_WIN_POS", "GLOBAL/MOD_STATE")` (key ที่หน้า Layout ของกลุ่ม Modules เขียนเพิ่ม)
  - `get_path(d: dict, path: str)`, `set_path(d, path, v)`, `del_path(d, path)` (path แยกด้วย `.` ส่วนสุดท้ายมีช่องว่างได้)
  - `effective_dict(own: dict, globals_: Mapping[str, object]) -> dict` ค่าของ module ถ้ามี ไม่งั้นค่ารวมของ key นั้น
  - `own_dict(body: dict, old_own: dict | None, pin: Iterable[str], unpin: Iterable[str]) -> dict` กติกาของ decision 3 ผลมี `"version": 2`
  - `strip_defaults(v1: dict, defaults: Mapping[str, object]) -> dict` ลบ path ที่ค่าเท่าค่าตั้งต้น ใส่ `"version": 2`
  - ช่องของ module เท่านั้น (เก็บเสมอ): `name, qth, satellites, list_sort, single.selected, footprint_off, ground_track, sky_track, window`

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน**

```python
def test_module_keys_cover_every_inheritable_leaf(self):   # ทุก leaf ของ ModuleConfig("x") ที่ไม่ใช่ช่องของ module เท่านั้นมีใน MODULE_KEYS และทุก key อยู่ใน prefs.PREFS
def test_effective_prefers_module_then_global(self):
    own = {"name": "A", "satellites": [1], "layout_code": "1;0;2;0;1"}
    g = dict(Prefs(self.cfg.data_dir).values()); g["MODULES/MAP_TRACK_NUM"] = 5
    e = effective_dict(own, g)
    self.assertEqual(e["layout_code"], "1;0;2;0;1"); self.assertEqual(e["map"]["track_orbits"], 5)
def test_own_dict_ignores_unpinned_inherited_values(self): # body layout ต่างจากค่ารวมแต่ไม่ pin และไม่อยู่ใน old_own → ไม่มี layout_code ในผล
def test_own_dict_pin_and_unpin(self):                     # pin PAGE_PATHS["map"] → ทุก path ของหน้า map อยู่ในผลแม้ค่าเท่าค่ารวม; unpin → หาย
def test_own_dict_keeps_pinned_with_new_value(self):       # path อยู่ใน old_own → ใช้ค่าจาก body
def test_own_dict_keeps_window_from_old(self):             # body window ต่างจาก old_own → ผลใช้ของ old_own
def test_strip_defaults(self):                             # ไฟล์แบบ core ที่ค่าเท่าค่าตั้งต้นทั้งหมดยกเว้น map.center_lon 100 → เหลือช่องของ module + map.center_lon
def test_window_validation(self):                          # state 2, width 50, x -1 → MODULE_INVALID
def test_map_colours_validation(self):                     # สีไม่ใช่ int 0–0xFFFFFFFF หรือชื่อสีไม่รู้จัก → MODULE_INVALID; map.file ต้องเป็นชื่อไฟล์ [A-Za-z0-9_.-]{1,100}
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**
- [ ] **Step 3: Implement** — `module_from_dict` ยังเติมค่าตั้งต้นของ Gpredict ให้ช่องที่ขาด (test เดิมผ่านโดยไม่แก้) และรับ/ข้าม `version`, `pin`, `unpin`
- [ ] **Step 4: รัน test ทั้งชุดของ server** — ผ่าน
- [ ] **Step 5: Commit** — `feat(gpredict-web): module inheritance helpers and new map/polar/window fields`

### Task 3: Server — store, API และการย้ายไฟล์ module

**Files:**
- Modify: `server/gpredict_web/store.py`, `server/gpredict_web/app.py` (`create_app`, `put_module`, `clone_module`, `startup`, `_meta`)
- Test: `server/tests/test_store.py`, `server/tests/test_api.py`, `server/tests/fixtures/module_v1_amateur.json` (ไฟล์ module แบบ core จริง)

**Interfaces:**
- Consumes: Task 2 ทั้งหมด, `Prefs.values()`
- Produces:
  - `Store(data_dir, globals_: Callable[[], Mapping[str, object]] | None = None)` (None = ค่าตั้งต้นของ Gpredict แบบ core)
  - `Store.get_module(name) -> ModuleConfig` (ค่าที่ใช้จริง), `Store.get_module_own(name) -> dict`
  - `Store.put_module(m: ModuleConfig, pin: Iterable[str] = (), unpin: Iterable[str] = ()) -> None`
  - `Store.put_module_own(name: str, own: dict) -> None` เขียนค่า own ตรงๆ หลังตรวจค่าที่ใช้จริง (ใช้ใน Task 4 และ Task 12)
  - `Store.migrate_modules() -> list[str]` ย้ายไฟล์ที่ไม่มี `version: 2` สำเนาไปที่ `data/modules/_backup_v1/<name>.json` ก่อน (ไม่ทับสำเนาที่มี)
  - `PUT /api/modules/{name}` รับ `pin`, `unpin` (รายการ path ใน `MODULE_KEYS` ไม่งั้น 422 `MODULE_INVALID`); clone คัดลอกค่าของ module เดิม (ที่ตรึงไว้ยังตรึง)
  - `GET /api/meta` เพิ่ม `"module_keys": {page: {path: key}}`, `"global_layout_extra": [...]`, `"log_dir": str`

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน**

```python
def test_migration_keeps_effective_values_and_backup(self):
    # copy fixture module_v1_amateur.json (แก้ map.center_lon เป็น 100) ไปที่ data/modules/Amateur.json
    before = module_to_dict(self.store.get_module("Amateur"))
    names = self.store.migrate_modules()
    self.assertEqual(names, ["Amateur"])
    self.assertTrue((self.data / "modules" / "_backup_v1" / "Amateur.json").is_file())
    own = self.store.get_module_own("Amateur")
    self.assertEqual(own["version"], 2); self.assertNotIn("layout_code", own); self.assertEqual(own["map"]["center_lon"], 100)
    self.assertEqual(module_to_dict(self.store.get_module("Amateur")), before)
def test_migration_runs_once(self):              # เรียกครั้งที่สอง → [] และสำเนาไม่ถูกทับ
def test_global_change_reaches_unpinned_module(self):   # prefs MODULES/GRID ใหม่ → get_module ของ module ที่ไม่ได้ตั้ง layout ได้ค่าใหม่, module ที่ตั้งเองไม่เปลี่ยน
def test_open_runtime_keeps_old_globals_until_reload(self):  # Hub.open แล้วเปลี่ยน MODULES/MAP_TRACK_NUM → runtime.module เดิม; hub.reload → ค่าใหม่
# test_api.py
def test_put_module_without_pin_keeps_inheritance(self):  # PUT ค่าเต็มที่ layout ต่างค่ารวม ไม่มี pin → ไฟล์ไม่มี layout_code
def test_put_module_pin_unpin(self):
def test_put_module_bad_pin_path_is_422(self):
def test_new_module_stores_only_module_fields(self):       # POST/PUT module ใหม่ → ไฟล์มีแค่ช่องของ module + version
def test_clone_keeps_pinned_values(self):
def test_meta_module_keys(self):                           # meta.module_keys.layout == {"layout_code": "MODULES/GRID"}
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**
- [ ] **Step 3: Implement** — `create_app` สร้าง `Prefs` ก่อน แล้ว `Store(cfg.data_dir, globals_=prefs.values)` `startup()` เรียก
  `store.migrate_modules()` ก่อนเปิด session และ log INFO ชื่อ module ที่ย้าย `module_from_dict` ตรวจค่าที่ใช้จริง (`effective_dict`) เสมอ
- [ ] **Step 4: รัน test ทั้งชุดของ server** — test เดิมของ store/api ผ่าน (ค่ารวมตั้งต้นเท่าค่าตั้งต้นของ core)
- [ ] **Step 5: Commit** — `feat(gpredict-web): sparse module files inheriting the global module settings`

### Task 4: Server — `PUT /api/qth/batch`

**Files:**
- Modify: `server/gpredict_web/store.py` (`replace_qth`), `server/gpredict_web/app.py`
- Test: `server/tests/test_store.py`, `server/tests/test_api.py`

**Interfaces:**
- Produces:
  - `Store.replace_qth(stations: list[Qth], default: str, dry_run: bool = False) -> list[str]` คืนชื่อ module ที่ถูกเปลี่ยนเป็น `** DEFAULT **`
  - `PUT /api/qth/batch?dry_run=` body `{"stations": [qth...], "default": "<name>"}` → `{"qth", "default", "changed_modules"}`
  - `stations` ว่าง → รหัสใหม่ `QTH_LAST` (422); ชื่อซ้ำ (ไม่สนตัวพิมพ์) หรือ `default` ไม่อยู่ในรายการ → `QTH_INVALID` (422)

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน**

```python
def test_batch_replaces_whole_set(self):            # มี A, B; batch [B', C] default C → ไฟล์ A หาย, B แก้, C ใหม่, default C
def test_batch_delete_in_use_and_default(self):     # module M ใช้ A (เปิดอยู่), N ใช้ DEFAULT (= A); batch [B] default B
    # → changed_modules == ["M"], M.qth is None ในไฟล์, log ERROR มีชื่อ M และ A (assertLogs), runtime ของ M ยังใช้ QthGeo ของ A
def test_batch_empty_is_qth_last(self):
def test_batch_duplicate_names_invalid(self):       # "abc", "ABC" → QTH_INVALID
def test_batch_dry_run_changes_nothing(self):
def test_default_matches_full_name(self):           # สถานี "xsample" กับ default "sample" → default_qth() == "sample" เท่านั้น
def test_delete_endpoint_still_refuses_in_use(self): # DELETE /api/qth/{name} ยังตอบ 409 IN_USE แบบ core
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**
- [ ] **Step 3: Implement** — ตรวจทุกสถานีด้วย `validate_qth` ก่อนแตะดิสก์ ทำใต้ lock ของ store: เขียนทุกสถานี ลบไฟล์ที่ไม่อยู่ในรายการ
  ตั้ง default แล้วแก้ module ที่ใช้สถานีที่หายด้วย `put_module_own` (ค่า own เดิม + `qth: None`) ไม่ `hub.reload` (spec §4.2)
- [ ] **Step 4: รัน test ทั้งชุดของ server** — ผ่าน
- [ ] **Step 5: Commit** — `feat(gpredict-web): replace ground stations in one batch like Gpredict's OK`

### Task 5: Server — ตัวอ่าน TLE ข้อความ (`tletext.py`, ไม่มี I/O)

**Files:**
- Create: `server/gpredict_web/tletext.py`, `server/tests/test_tletext.py`, `server/tests/fixtures/tle_mixed.txt` (3 บรรทัด, 2 บรรทัด, ขยะหัวไฟล์, checksum เสีย, ป้ายสถานะ)

**Interfaces:**
- Produces:
  - `STATUS_TAGS = {"[+]": "Operational", "[-]": "Non-operational", "[P]": "Partially operational", "[B]": "Backup/Standby", "[S]": "Spare", "[X]": "Extended Mission"}`, `UNKNOWN_STATUS = "Unknown"`
  - `@dataclass(frozen=True) TleSet(norad: int, name: str, status: str, lines: tuple[str, str], epoch: datetime)` และ `property generated_name: bool`
  - `checksum_ok(line: str) -> bool`, `is_generated_name(name: str) -> bool` (`\d{4,}-\d{3,}` หรือมี `OBJECT`)
  - `parse_tle_text(text: str) -> list[TleSet]` ตาม ref-D §5.3 แถว Formats ถึง Name for 2-line set

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน**

```python
def test_three_and_two_line_sets_mixed(self):   # fixture → ISS 3 บรรทัดชื่อ "ISS (ZARYA)", ชุด 2 บรรทัดได้ชื่อ "1998-067A"
def test_status_tag_stripped(self):             # "AO-7 [P]" → name "AO-7", status "Partially operational"
def test_name_rules(self):                      # ชื่อยาว 30 ตัว → 25 ตัว; "A&B  " → "A/B"
def test_bad_checksum_skipped(self):
def test_catalogue_numbers_must_match(self):
def test_two_digit_year(self):                  # international designator "57001A" → "1957-001A"; "26001A" → "2026-001A"
def test_lines_trimmed_to_69(self):             # บรรทัดยาวมีข้อความต่อท้าย → lines ยาว 69
def test_generated_names(self):                 # "2026-123A" ตรง (\d{4,}-\d{3,}); "1998-067A" ของชุด 2 บรรทัดตรง; "OBJECT A" ตรง; "ISS (ZARYA)" ไม่ตรง
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**
- [ ] **Step 3: Implement** — หน้าต่างเลื่อนทีละบรรทัด: บรรทัดที่ขึ้นต้น `1 ` ตามด้วย `2 ` ที่ผ่านการตรวจเป็นชุด (บรรทัดก่อนหน้าที่ไม่ใช่ TLE คือชื่อ)
  ตรวจ: checksum mod-10 ทั้งสองบรรทัด, หมายเลขเดียวกัน, ช่อง ephemeris type (คอลัมน์ 63) เป็น `0`, epoch แปลงได้
  epoch ใช้ `observe.parse_tle` (กติกาปี 57 เดียวกัน)
- [ ] **Step 4: รัน test** — ผ่าน
- [ ] **Step 5: Commit** — `feat(gpredict-web): Gpredict-style TLE text reader`

### Task 6: Server — กติการวม TLE ของ Gpredict ใน `satdb.py`

**Files:**
- Modify: `server/gpredict_web/satdb.py`
- Test: `server/tests/test_satdb.py`

**Interfaces:**
- Consumes: Task 5 `TleSet`
- Produces:
  - `SatRecord.status: str = "Unknown"` (ไฟล์ `satdb.json` ที่ไม่มีช่องนี้อ่านได้), `UpdateResult.new: int = 0`
  - `SatDb.apply_sets(sources: dict[str, list[TleSet]], now: datetime, add_new: bool, replace_groups: set[str] = frozenset()) -> UpdateResult`
    (`sources`: กลุ่ม → ชุด TLE ที่อ่านได้ กลุ่มที่อยู่ใน dict ถือว่า "อ่านได้รอบนี้"; `replace_groups`: สมาชิกของกลุ่มนี้ถูกแทนด้วยดาวในไฟล์)
  - `SatDb.apply_groups(files, now, add_new: bool = True)` แปลง OMM เป็น `TleSet` แล้วใช้ `apply_sets`

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน** (ทุกแถวของ ref-D §5.3)

```python
def test_newer_epoch_updates(self):
def test_equal_epoch_status_change_updates_else_skipped(self):   # Unknown → Operational: updated; Operational → Unknown: skipped
def test_older_epoch_skipped(self):
def test_missing_counts_local_without_data(self):
def test_new_satellites_only_when_add_new(self):   # add_new False → ไม่เพิ่ม new 0; True → เพิ่ม, new 1, updated ไม่นับดวงใหม่
def test_generated_name_replaced(self):            # เดิม "2026-001A" ได้ "FOO" epoch เท่ากัน → name "FOO" นับ updated
def test_best_of_two_sources(self):                # กลุ่ม a มี epoch เก่า กลุ่ม b ใหม่กว่า → ใช้ b, groups ทั้ง a และ b
def test_replace_groups_membership(self):          # กลุ่ม "amateur" มี 3 ดวง ไฟล์ amateur.txt มี 1 ดวง → กลุ่ม amateur เหลือ 1 ดวง (อีก 2 ดวงยังอยู่ในดัชนี)
def test_status_persisted(self):                   # save แล้วโหลดใหม่ status คงอยู่; ไฟล์เก่าไม่มี status → "Unknown"
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**
- [ ] **Step 3: Implement** — test เดิมของ `apply_groups` ที่นับดวงใหม่เป็น `updated` แก้ให้นับใน `new` ตาม ref-D §5.3 (บันทึกใน commit message)
- [ ] **Step 4: รัน test ทั้งชุดของ server** — ผ่าน
- [ ] **Step 5: Commit** — `feat(gpredict-web): merge TLE data with Gpredict's update rules and status`

### Task 7: Server — TLE sources, proxy, `/api/tle/*`

**Files:**
- Create: `server/gpredict_web/tlesources.py`, `server/tests/test_tlesources.py`, `server/tests/fixtures/nasabare_sample.txt`
- Modify: `server/gpredict_web/app.py` (`update_tle`, `/api/tle/groups`, `POST /api/tle/local`)
- Test: `server/tests/test_api.py`

**Interfaces:**
- Consumes: Task 1 key `TLE/*`, Task 5, Task 6, `omm.fetch_group(..., opener=)`
- Produces:
  - `classify(url: str) -> tuple[str, str]` → `("celestrak", group)` เมื่อ host `celestrak.org` (หรือ `www.`) path `/NORAD/elements/gp.php` มี `GROUP`
    ไม่งั้น `("text", <ชื่อไฟล์ใน path ไม่รวมนามสกุล>)`
  - `make_opener(proxy: str) -> Callable` (`""` = `urlopen`)
  - `fetch_text(url, cache_dir: Path, now, opener) -> tuple[Path | None, list[Message]]` กติกา 1 ครั้งต่อ URL ต่อ `SOURCE_MIN_INTERVAL_S`
    state `data/tle/_cache/state.json` (`{url: {last_request, last_success}}`) ไฟล์ `data/tle/_cache/<sha256(url)[:12]>.txt` User-Agent `gpredict-web` timeout 30 s
  - `update_from_sources(db, cfg, prefs, now, opener_factory=make_opener) -> UpdateResult` ตั้ง `TLE/LAST_UPDATE` = `int(now.timestamp())` เมื่อ `updated + new > 0`
  - `update_from_files(db, prefs, files: list[tuple[str, str]], now) -> UpdateResult` (ไฟล์ระดับบนชื่อลงท้าย `.tle`/`.txt` ไม่สนตัวพิมพ์,
    กลุ่ม = ชื่อก่อนจุดแรก, แทนสมาชิกเมื่อกลุ่มมีอยู่แล้ว, ไฟล์ที่ไม่มี TLE ใช้ได้ → `Message("TLE_FILE_INVALID", "warning", ...)`)
  - `source_groups(urls: list[str]) -> list[str]` ตามลำดับ URL ไม่ซ้ำ
  - `POST /api/tle/update` และ `POST /api/tle/local` ตอบ `{updated, skipped, missing, new, add_new, messages}`
    `/api/tle/local` body `{"files": [{"name", "text"}]}` สูงสุด 200 ไฟล์ รวมไม่เกิน 20 MB (เกิน → 422 `TLE_FILE_INVALID`)
  - `/api/tle/groups` → กลุ่มของ `source_groups(TLE/URLS)` พร้อม `last_request`/`last_success` (CelesTrak จาก state ของ engine, URL อื่นจาก state ของเรา)
    ต่อด้วยกลุ่มในดัชนีที่ไม่มี source (`null` ทั้งสองช่อง)

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน**

```python
def test_classify(self):
    self.assertEqual(classify("https://celestrak.org/NORAD/elements/gp.php?GROUP=gps-ops&FORMAT=tlet"), ("celestrak", "gps-ops"))
    self.assertEqual(classify("https://www.amsat.org/amsat/ftp/keps/current/nasabare.txt"), ("text", "nasabare"))
def test_text_source_rate_limited_per_url(self):   # ขอครั้งแรก opener ถูกเรียก; อีก 1 ชม. ไม่ถูกเรียกและได้ไฟล์เดิม + ข้อความ info
def test_text_source_user_agent(self):             # Request ที่ opener ได้มี User-Agent "gpredict-web"
def test_proxy_used_for_all_sources(self):         # opener_factory ถูกเรียกด้วย prefs TLE/PROXY และ opener นั้นใช้กับทั้ง fetch_group และ fetch_text
def test_source_failure_keeps_old_tles(self):      # opener raise URLError ทุก URL → ดาวเดิมอยู่ครบ, messages มีคำเตือน, last_request ไม่ถูกบันทึกเมื่อต่อไม่ถึง server
def test_last_update_only_when_changed(self):      # รอบที่ไม่มีอะไรใหม่ → TLE/LAST_UPDATE ไม่เปลี่ยน
def test_nasabare_group(self):                     # fixture AMSAT → ดาวอยู่ในกลุ่ม "nasabare"
def test_update_from_files_filters_and_groups(self): # a.TLE, b.txt, c.json, sub/d.tle → อ่าน a, b; กลุ่ม "a", "b"
def test_file_without_tle_warns(self):
# test_api.py
def test_tle_update_uses_prefs_urls(self):        # TLE/URLS = [url ของ fixture ผ่าน opener ปลอม] → คำตอบมี new และ add_new
def test_tle_local_endpoint(self):
def test_tle_local_too_big_is_422(self):
def test_tle_groups_follow_sources(self):
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**
- [ ] **Step 3: Implement** — `update_tle` ใน `app.py` เรียก `update_from_sources` แทน `update_from_network` (bootstrap ของ core คงเดิม)
  หลังอัปเดตทุก module ที่เปิดอยู่ `hub.reload` แบบเดิม log INFO `"TLE elements updated."` และ `"Added %d new satellites to local database"` (tle-update.c)
- [ ] **Step 4: รัน test ทั้งชุดของ server** — ผ่าน
- [ ] **Step 5: Commit** — `feat(gpredict-web): editable TLE sources with proxy, AMSAT text files and local files`

### Task 8: Server — logger แบบ Gpredict และ log API

**Files:**
- Create: `server/gpredict_web/gplog.py`, `server/tests/test_gplog.py`
- Modify: `server/gpredict_web/app.py` (เริ่ม/จบ session ใน lifespan, 2 route), `server/gpredict_web/runtime.py` (INFO เปิด/ปิด module), `server/gpredict_web/ephem.py` (INFO เริ่ม/จบงาน GMAT)
- Test: `server/tests/test_api.py`

**Interfaces:**
- Produces:
  - `LOG_FILE = "gpredict.log"`, `LEVEL_OF = {logging.CRITICAL: 1, logging.ERROR: 1, logging.WARNING: 2, logging.INFO: 3, logging.DEBUG: 4}`
  - `class GpredictLogHandler(logging.Handler)` บรรทัด `YYYY/MM/DD HH:MM:SS|<n>|<function>: <ข้อความ>` เวลาท้องถิ่น ข้อความหลายบรรทัดแยกเป็นหลายบรรทัด
    `<function>` = `record.gp_function` ถ้ามี ไม่งั้น `record.funcName`
  - `start_session(log_dir: Path, level: int) -> GpredictLogHandler` ลบ `gpredict.log` เดิม เขียน `Session started` (INFO เสมอ) แล้วกรองตาม `level`
    ติดกับ logger `"gpredict_web"` เปิดไฟล์ไม่ได้ → เขียนลง stderr
  - `end_session(handler, clean_age: int, now: float) -> None` เขียน `Session ended` (INFO), ปิด, `clean_age > 0` → เปลี่ยนชื่อเป็น `gpredict-<int(now)>.log`,
    ลบ `gpredict-*.log` ที่ timestamp ≤ `now − clean_age`
  - `GET /api/logs/current` (text/plain, ไม่มีไฟล์ → `""`), `POST /api/log` `{level: 1–4, function: ^[A-Za-z_][A-Za-z0-9_]{0,63}$, text: 1–500 ตัว}` → 204, ผิด → 422 `LOG_INVALID`

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน**

```python
def test_line_format(self):          # logger "gpredict_web.x" warning("abc") ใน function f → บรรทัดตรง r"^\d{4}/\d\d/\d\d \d\d:\d\d:\d\d\|2\|f: abc$"
def test_first_line_session_started_even_at_level_0(self):   # level 0 → มีแค่ "Session started" (ระดับ 3)
def test_level_filter(self):         # level 2 → info ไม่ถูกเขียน, error เขียน
def test_level_applies_next_start(self):  # เปลี่ยน prefs LOG/LEVEL ระหว่าง session → handler ยังกรองที่ระดับเดิม
def test_multiline_split(self):
def test_end_session_rotates_and_cleans(self):  # clean_age 86400: gpredict.log → gpredict-<now>.log, ไฟล์ gpredict-<now-90000>.log ถูกลบ, gpredict-<now-100>.log อยู่
def test_always_delete_keeps_current(self):     # clean_age 0 → ลบทุก gpredict-*.log, gpredict.log อยู่
def test_unwritable_log_dir_falls_back_to_stderr(self):
# test_api.py
def test_post_log_from_web(self):     # {"level": 1, "function": "multi_pass_response", "text": "multi_pass_response: PRINT not implemented"} → บรรทัด "|1|multi_pass_response: …"
def test_post_log_invalid(self):      # level 5, text 501 ตัว, function "a b" → 422 LOG_INVALID
def test_module_open_close_logged(self):
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**
- [ ] **Step 3: Implement** — lifespan (เฉพาะ `start_background`): `start_session(data/logs, prefs LOG/LEVEL)` ก่อน startup, `end_session(..., LOG/CLEAN_AGE)` หลัง shutdown
  เหตุการณ์ของงานย่อย 1–3 ที่ต้องมีบรรทัด: เปิด/ปิด module (ข้อความตาม `mod-mgr.c`), อัปเดต TLE (Task 7), งาน GMAT เริ่ม/จบ/ล้ม (ไทย),
  SatNOGS และ controller (งานย่อยที่ 3 log อยู่แล้วผ่าน `logging.getLogger(__name__)`)
  `POST /api/log` ส่ง `extra={"gp_function": function}` และเขียนข้อความตามที่ได้
- [ ] **Step 4: รัน test ทั้งชุดของ server** — ผ่าน
- [ ] **Step 5: Commit** — `feat(gpredict-web): Gpredict log file, levels, rotation and log API`

### Task 9: Server — `/ws/app` และการตรวจอายุ TLE

**Files:**
- Create: `server/gpredict_web/appevents.py`, `server/gpredict_web/tleage.py`, `server/tests/test_tleage.py`, `server/tests/test_appevents.py`
- Modify: `server/gpredict_web/app.py` (WS route, ส่งเหตุการณ์, task ใน lifespan, `create_app(..., tle_check_interval_s=600)`)

**Interfaces:**
- Consumes: Task 1, Task 7 `update_tle` (ฟังก์ชันใน `create_app`)
- Produces:
  - `AppEvents`: `bind(loop)`, `async add(ws)`, `remove(ws)`, `publish(event: dict) -> None` (เรียกจาก thread ไหนก็ได้),
    `publish_or_hold(event)` (ไม่มี socket → เก็บไว้ส่งให้ socket แรกที่ต่อเข้ามา)
  - เหตุการณ์ `{"type": "prefs_changed"}` (หลัง `PUT /api/prefs` และ `PUT /api/qth/batch` ที่ไม่ใช่ dry run), `{"type": "modules_changed"}`
    (หลัง PUT/DELETE/open/close/clone module และ `PUT …/window`), `{"type": "tle_old", "text": TLE_OLD_TEXT}`
  - `TLE_OLD_TEXT = "Your TLE files are getting out of date.\nYou can update them by selecting\n<b>Edit -> Update TLE</b>\nin the menubar."`
  - `tle_due(values: Mapping, now: datetime) -> bool` (freq 0 ไม่เคย; อายุ = now − `TLE/LAST_UPDATE` > `TLE_AGE_S[freq]`)
  - `TleAgeChecker(values: Callable[[], Mapping], run_update: Callable[[], None], publish: Callable[[dict], None], now)`;
    `check() -> str` คืน `"none"`, `"notified"`, `"updated"` แจ้งครั้งเดียวต่อ checker (ต่อการเปิด server)
  - `WS /ws/app` (ผ่าน `_HostOriginGuard` ของ core)

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน**

```python
def test_due_thresholds(self):          # weekly: LAST_UPDATE = now − 604801 → True, now − 604799 → False; never → False; LAST_UPDATE 0 → True
def test_notify_once_per_run(self):     # action 1: check() "notified" แล้ว "none" ทุกครั้งต่อมา publish ถูกเรียกครั้งเดียว
def test_background_runs_update(self):  # action 2: run_update ถูกเรียกทุกครั้งที่ due (กติกา 2 ชม. อยู่ในตัวดึง)
def test_first_check_after_interval(self):   # create_app(tle_check_interval_s=0.05) + TestClient: ไม่มีการตรวจก่อนครบช่วงแรก
# test_appevents.py (TestClient websocket)
def test_prefs_changed_event(self):
def test_modules_changed_event(self):
def test_held_tle_old_goes_to_first_socket(self):
def test_app_ws_rejects_foreign_origin(self):   # Origin http://evil.example → ปิด 1008 ก่อน accept
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**
- [ ] **Step 3: Implement** — lifespan (เฉพาะ `start_background`) สร้าง asyncio task: `sleep(interval)` แล้ว `await asyncio.to_thread(checker.check)` วนทุก interval
  ยกเลิก task ตอนปิด background update ใช้ `update_tle` เดิม (ถือ `tle_lock`) ผลแล้ว reload module ทุกตัว
- [ ] **Step 4: รัน test ทั้งชุดของ server** — ผ่าน
- [ ] **Step 5: Commit** — `feat(gpredict-web): app event socket and TLE age check every 10 minutes`

### Task 10: Server — Satellite Info และภาพแผนที่

**Files:**
- Create: `server/gpredict_web/satinfo.py`, `server/gpredict_web/maps.py`, `server/gpredict_web/maps/` (15 ภาพ + `SOURCE.md`),
  `server/tests/test_satinfo.py`, `server/tests/test_maps.py`
- Modify: `server/gpredict_web/app.py`

**Interfaces:**
- Produces:
  - `orbit_info(r: SatRecord) -> dict` ช่อง `name, status, catnum, intl_designator` (8 ตัวดิบ คอลัมน์ 10–17 รวมช่องว่าง), `element_set` (คอลัมน์ 65–68),
    `epoch` (ISO), `revnum, incl_deg, raan_deg, ecc` (ต่ำกว่า 1e-6 เป็น 1e-6), `argp_deg, ma_deg, mean_motion, ndot2, nddot6` (คอลัมน์ 45–52 implied decimal), `bstar`
  - `GET /api/satellites/{norad}` เพิ่ม `"status"` และ `"orbit_info"`
  - `STOCK_MAPS` (15 ชื่อของ ref-D §11), `image_size(path) -> tuple[int, int]` (อ่านหัว PNG IHDR / JPEG SOFn เอง), `list_maps(data_dir) -> list[dict]`
    (`{file, stock, width, height, bytes}` ภาพของ Gpredict ก่อนแล้วภาพที่อัปโหลดเรียงตามชื่อ), `save_upload(data_dir, name, content_type, body) -> str`, `resolve(data_dir, file) -> Path | None`
  - `GET /api/maps` → `{"maps": [...], "default": DEFAULT_MAP}`, `POST /api/maps?name=` (body ดิบ ≤ 10 MB, `.jpg/.jpeg/.png` ตรงกับ magic bytes, ชื่อ `[A-Za-z0-9_.-]{1,100}` ไม่ซ้ำภาพของ Gpredict → ผิด 422 `MAP_INVALID`), `GET /api/maps/{file}` (ไม่มี → 404 `NOT_FOUND`)

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน**

```python
def test_orbit_info_iss(self):        # TLE ISS ของ test_integration_gmat → catnum 25544, intl_designator "98067A  ", incl 51.64, mean_motion 15.49438945
def test_ecc_clamped(self):           # ecc 0000000 → 1e-06
def test_nddot6_and_element_set(self):
def test_satellite_api_has_status_and_info(self):
def test_stock_maps_listed_with_sizes(self):   # 15 ภาพ; nasa-bmng-07_1024.jpg มี width/height จากไฟล์จริง
def test_upload_and_serve(self):      # PNG เล็ก (สร้างใน test) → อยู่ใน list stock False และ GET ได้ไบต์เดิม
def test_upload_rejects(self):        # 10 MB+1, ชื่อ "../x.png", นามสกุล .gif, ชื่อซ้ำ stock, content-type ไม่ตรง → MAP_INVALID
def test_missing_map_404(self):
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**
- [ ] **Step 3: Implement** — คัดลอกภาพจาก clone ของ Gpredict (path ใน Global Constraints) `SOURCE.md` บอกที่มา (NASA public domain, commit `2259378`, วันที่คัดลอก)
  ภาพที่อัปโหลดเก็บที่ `data/maps/`
- [ ] **Step 4: รัน test ทั้งชุดของ server** — ผ่าน
- [ ] **Step 5: Commit** — `feat(gpredict-web): satellite orbit info and Gpredict's map images`

### Task 11: Server — รายชื่อเมืองและสถานีอากาศจาก NOAA

**Files:**
- Create: `server/gpredict_web/locations.py`, `tools/build_locations.py`, `server/gpredict_web/data/locations.json`, `server/gpredict_web/data/SOURCE.md`,
  `server/tests/test_locations.py`, `server/tests/fixtures/nsd_cccc_sample.txt` (10 บรรทัดจริงรวม VTCC Chiang Mai, บรรทัดที่ไม่มีพิกัด)
- Modify: `server/gpredict_web/app.py` (`GET /api/locations`)

**Interfaces:**
- Produces:
  - `WMO_REGIONS = {"1": "Africa", "2": "Asia", "3": "South America", "4": "North and Central America", "5": "South-West Pacific", "6": "Europe", "7": "Antarctica"}`
  - `nsd_angle(text: str) -> float` (`"13-55N"`, `"098-58-12E"` → องศาทศนิยม ใต้/ตะวันตกเป็นลบ)
  - `parse_nsd(text: str) -> list[list]` แถว `[continent, country, city, lat, lon, alt_m, icao]` เรียงตาม continent, country, city
  - `GET /api/locations` → เนื้อของ `locations.json` (`{"source", "downloaded", "locations": [...]}`) อ่านครั้งเดียวแล้วเก็บในหน่วยความจำ

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน**

```python
def test_angles(self):             # nsd_angle("18-47N") == 18 + 47/60; nsd_angle("098-59E") ≈ 98.9833; "S"/"W" เป็นลบ
def test_parse_sample(self):       # Chiang Mai: ["Asia", "Thailand", "Chiang Mai", 18.78…, 98.98…, 315, "VTCC"]; บรรทัดไม่มีพิกัดถูกข้าม
def test_missing_elevation_is_zero(self):
def test_api_locations(self):
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**
- [ ] **Step 3: Implement และสร้างไฟล์ข้อมูล** — ดาวน์โหลดครั้งเดียว (อนุมัติแล้ว) ลงโฟลเดอร์ใหม่ใน scratchpad แล้วรันสคริปต์โดยส่ง path:

```bash
mkdir -p "$SCRATCH/nsd" && curl -fsS -A gpredict-web -o "$SCRATCH/nsd/nsd_cccc.txt" https://tgftp.nws.noaa.gov/data/nsd_cccc.txt
cd api-interop/gpredict-web && .venv/bin/python -I tools/build_locations.py "$SCRATCH/nsd/nsd_cccc.txt" server/gpredict_web/data/locations.json
```

  ไฟล์ NOAA อ่านแบบ `latin-1` คั่นด้วย `;` ใช้ช่อง ICAO, Place Name, Country Name, WMO Region, Station Latitude/Longitude, Station Elevation
  `SOURCE.md` บอก URL วันที่ดาวน์โหลด จำนวนแถว และคำสั่งสร้างใหม่ (`$SCRATCH` = scratchpad ของ session)
- [ ] **Step 4: รัน test ทั้งชุดของ server** — ผ่าน
- [ ] **Step 5: Commit** — `feat(gpredict-web): city and weather station list built from NOAA data`

### Task 12: Server — สถานะหน้าต่างของ module

**Files:**
- Modify: `server/gpredict_web/app.py` (`PUT /api/modules/{name}/window`, `GET /api/modules` ช่อง `windows`, startup)
- Test: `server/tests/test_api.py`

**Interfaces:**
- Consumes: Task 2 ช่อง `window`, Task 9 `modules_changed`
- Produces:
  - `PUT /api/modules/{name}/window` body `{state?: 0|1, x?, y?, width?, height?}` (ช่องที่ไม่ส่งคงเดิม) → ช่อง `window` หลังบันทึก
    `state` 1 → เพิ่มใน `windowed`; `state` 0 → เอาออกและย้ายชื่อไปท้าย session (Attach กลับเป็นแท็บสุดท้าย)
  - `GET /api/modules` เพิ่ม `"windows": [...]` = module ที่เปิดอยู่และอยู่ใน `windowed` ตามลำดับ session
  - startup: `windowed` = module ใน session ที่ `window.state == 1` เมื่อ `GLOBAL/MOD_STATE` เปิด

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน**

```python
def test_detach_then_attach(self):    # open A, B; PUT A window state 1 → windows ["A"]; state 0 → windows [], open == ["B", "A"]
def test_geometry_saved_in_module(self):   # x 10 y 20 width 800 height 600 → get_module_own("A")["window"] ตรง; state เดิม
def test_window_invalid(self):        # width 10 → MODULE_INVALID
def test_restore_state_needs_mod_state(self):  # ไฟล์ A state 1 ใน session: MOD_STATE false → windows [], true → ["A"] หลัง startup
def test_put_module_does_not_touch_window(self):
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**
- [ ] **Step 3: Implement** — บันทึกด้วย `store.put_module_own` (window เป็นช่องของ module เท่านั้น) ส่ง `modules_changed`
- [ ] **Step 4: รัน test ทั้งชุดของ server** — ผ่าน
- [ ] **Step 5: Commit** — `feat(gpredict-web): module window state and geometry`

### Task 13: Web — Number Formats ใน view ของ core

**Files:**
- Create: `web/src/numfmt.ts`, `web/src/numfmt.test.ts`, `tools/strftime_fixture.py`, `web/src/strftime.fixture.json`
- Modify: `web/src/format.ts` (+test), `web/src/views/cells.ts` (+test), `web/src/views/mapDraw.ts`, `web/src/views/polarDraw.ts` (ป้ายเวลา `%H:%M` ของ sky track), `web/src/components/ModuleHeader.tsx`,
  `web/src/timeCtl.ts` (+test), `web/src/components/TimeController.tsx`, `web/src/components/Calendar.tsx`, view ที่เรียก `listCell`/`singleCell`

**Interfaces:**
- Consumes: P-plan Task 7 `usePrefs`
- Produces:
  - `formatTime(d: Date, fmt = DEFAULT_TIME_FORMAT, local = false): string` รหัสครบตาม spec §3.2 แบบ locale C ผลยาวไม่เกิน `TIME_TEXT_MAX` = 49
  - `interface NumberFormat { local: boolean; timeFormat: string; nsew: boolean; imperial: boolean }`, `DEFAULT_NF`, `numberFormatOf(values) -> NumberFormat`, `useNumberFormat(): NumberFormat`
  - `fmtTimeNf(iso: string | Date, nf): string`, `fmtLatLon(v: number | null, axis: "lat" | "lon", digits: number, nf): string` (`%.Nf°` + N/S/E/W หรือช่องว่าง),
    `distance(km: number | null, nf): number | null`, `KM_PER_MI`, `FT_PER_M`, `mToFt`, `ftToM`
  - `listCell(column, s, t, nf = DEFAULT_NF)`, `singleCell(field, s, nf = DEFAULT_NF)` (Single sat หน่วย `mi`, `mi/sec`)
  - `fieldsFromTime(t, local = false)`, `composeTime(day, h, m, s, ms, sliderDays, local = false)`, `dayOf(t, local = false)`

- [ ] **Step 1: สร้าง fixture** — `tools/strftime_fixture.py` พิมพ์ JSON `{"cases": [{"iso", "fmt", "out"}]}` ของเวลา `2026-01-01T00:00:00Z`,
  `2026-11-12T05:06:07Z`, `2024-02-29T23:59:59Z`, `2027-01-03T12:00:00Z` คูณทุกรหัสของ spec §3.2 (UTC) แล้วรัน
  `LC_ALL=C python3 tools/strftime_fixture.py > web/src/strftime.fixture.json`

- [ ] **Step 2: เขียน test ที่ยังไม่ผ่าน**

```ts
it("formatTime matches Python strftime in locale C", ...)    // ทุกแถวของ fixture: formatTime(new Date(iso), fmt) === out
it("formatTime leaves unknown codes, a trailing % and truncates to 49", ...)  // "%Q" → "%Q"; "abc%" → "abc%"; "%Y".repeat(20) → ยาว 49
it("local time", ...)            // process.env.TZ = "Asia/Bangkok": formatTime(2026-11-12T05:06:07Z, "%H %z", true) == "12 +0700" (คืนค่า TZ หลัง test)
it("lat/lon", ...)               // fmtLatLon(-13.75, "lat", 2, nf ปิด) == "-13.75° "; nsew → "13.75°S"; lon 100.5 nsew → "100.50°E"
it("list cells follow ref-D §2.1", ...)  // imperial: Range 1609.344 → "1000", Rate → "%.3f" ของ mi/s, Alt, Footp, Vel; Lat ต่อท้ายช่องว่างเมื่อ nsew ปิด
it("single sat units", ...)      // imperial: "Slant Range" 1609.344 → "1000 mi", "Velocity" → "x.xxx mi/sec"; "SSP Lat." ตาม nsew
it("next event uses the time format and local time", ...)
it("time controller fields in local time", ...)  // TZ Bangkok: fieldsFromTime(05:06Z, true).h == 12; composeTime(..., true) กลับเป็นเวลาเดิม
```

- [ ] **Step 3: รันให้เห็นว่าล้ม**
- [ ] **Step 4: Implement** — `%c` = `%a %b %e %H:%M:%S %Y`, `%x` = `%m/%d/%y`, `%X` = `%H:%M:%S`, `%r` = `%I:%M:%S %p`, `%Z` เป็น `UTC` ใน UTC
  และชื่อย่อของ `Intl.DateTimeFormat` ในเวลาท้องถิ่น สัปดาห์ `%U %W %V %G %g` ตามนิยามของ C ข้อความที่ test เดิมคาดไว้ (เช่น Lat ไม่มีช่องว่างท้าย)
  แก้ตาม ref-D §2.1 view ทุกตัวรับ `nf` จาก `useNumberFormat()` ที่ระดับ `ModuleView` ป้ายเส้นกริดของ Map เป็น `%.0f°` + ทิศหรือช่องว่าง
- [ ] **Step 5: รัน** — `npm test`, `npm run build`
- [ ] **Step 6: Commit** — `feat(gpredict-web): number formats, local time and strftime codes in the module views`

### Task 14: Web — Number Formats ใน Pass predictions และ Radio Control

**Files:**
- Modify: `web/src/passes/passCells.ts`, `web/src/passes/passText.ts`, `web/src/passes/passPolar.ts`, `web/src/passes/passAzEl.ts`, `web/src/passes/skyGlance.ts`
  และ component ที่เรียก (พร้อม test ของแต่ละไฟล์), `web/src/radio/radioView.ts` (`fmtRange(km, nf)`, `fmtRate(kms, nf)` ของงานย่อยที่ 3) และ `web/src/radio/radioView.test.ts`

**Interfaces:**
- Consumes: Task 13 `NumberFormat`, P-plan Task 9–11 และ 14
- Produces: `rowCell(row, title, nf = DEFAULT_NF)`, `passCell(p, title, nf = DEFAULT_NF)`, `onePassText(a, columns, contents, now, nf = DEFAULT_NF)`,
  `passListText(a, columns, contents, now, nf = DEFAULT_NF)`, `passPolarScene(p, size, orientation, qthName, local = false)`, `azElScene(p, size, local = false)`

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน**

```ts
it("pass data imperial and nsew", ...)       // "Range" 1609.344 → "1000" (ไม่มีหน่วย), "Lat" nsew → "13.75°N"
it("saved text keeps km and signed lat/lon", ...)   // nf imperial+nsew: ตัวเลขในไฟล์เหมือน DEFAULT_NF ทุกตัว (ref-D §2.1 "Not affected")
it("saved text says Local or UTC", ...)      // nf.local → หัว "AOS: <เวลา> Local" ตาม ref-P §8.3; ไม่ local → "UTC"
it("az/el legend", ...)                      // azElScene(..., true) มีป้าย "Local Time"; false → "UTC"
it("sky at a glance label", ...)             // skyScene(a, size, !nf.local): local → "TIME"
it("radio range and rate in miles", ...)     // ข้อความ Range "%.0f mi", Rate "%.3f mi/s" เมื่อ imperial
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**
- [ ] **Step 3: Implement** — ป้ายเวลาของกราฟใช้ `%H:%M` คงที่ตาม ref-D §2.1 แต่เป็นเวลาท้องถิ่นเมื่อ `nf.local`
- [ ] **Step 4: รัน** — `npm test`, `npm run build`
- [ ] **Step 5: Commit** — `feat(gpredict-web): number formats in pass windows, saved text and radio control`

### Task 15: Web — หน้าต่าง Preferences ฉบับสุดท้ายและเหตุการณ์ของโปรแกรม

**Files:**
- Create: `web/src/appEvents.ts`, `web/src/appEvents.test.ts`
- Modify: `web/src/prefs/PreferencesDialog.tsx`, `web/src/prefs/prefsDraft.ts` (+test), `web/src/prefs/prefGroups.ts`, `web/src/api.ts` (`putPrefs` รับ `{ dryRun?: boolean }`),
  ฟังก์ชัน PUT `/api/hwconf` ของงานย่อยที่ 3 (รับ `{ dryRun?: boolean }`) และการลงทะเบียน `onCheck` ของหน้า Interfaces, `web/src/App.tsx`

**Interfaces:**
- Consumes: P-plan Task 7 `PrefsPageApi`, `savePrefs`, `reloadPrefs`, Task 9 `/ws/app`
- Produces:
  - `PrefsPageApi` เพิ่ม `onCheck(fn: () => Promise<void>): void` (ตรวจแบบ dry run ของส่วนที่ไม่ใช่ key)
  - `commitPreferences(steps: { checkPrefs(): Promise<void>; checks: (() => Promise<void>)[]; savePrefs(): Promise<void>; commits: (() => Promise<void>)[] }): Promise<void>`
    (pure ลำดับ: checkPrefs → checks ทั้งหมด → savePrefs → commits ตามลำดับลงทะเบียน; ตัวใดล้มหยุดทันที)
  - `FIRST_GROUP = "general"`; ลำดับการลงทะเบียน `onCommit` = General, Modules, Interfaces, Predict
  - `connectAppEvents(h: { prefsChanged(): void; modulesChanged(): void; tleOld(text: string): void }): () => void` ต่อใหม่ทุก `APP_WS_RETRY_MS`
  - App: `prefsChanged` → `reloadPrefs()`, `modulesChanged` → `reloadModules()`, `tleOld` → callback ที่ Task 18 แสดงกล่อง

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน**

```ts
it("nothing is saved when a check fails", ...)        // checks[1] reject → savePrefs และ commits ไม่ถูกเรียก, error มีข้อความไทยของส่วนนั้น
it("commits run after prefs in registration order", ...)
it("dispatches app events", ...)                     // WebSocket ปลอมส่ง {"type":"prefs_changed"} → prefsChanged ถูกเรียก
it("reconnects after close", ...)                    // fake timers 2000 ms
it("opens at General", ...)
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**
- [ ] **Step 3: Implement** — ข้อความผิดแสดงในหน้าต่างเป็น `<กลุ่ม> → <แท็บ>: <ข้อความไทยจาก server>` ไม่ปิดหน้าต่าง (spec §10)
- [ ] **Step 4: รัน** — `npm test`, `npm run build`
- [ ] **Step 5: Commit** — `feat(gpredict-web): all-or-nothing preferences OK and the app event socket`

### Task 16: Web — General → Number Formats และ Message Logs

**Files:**
- Create: `web/src/prefs/GeneralPages.tsx`, `web/src/prefs/generalPrefs.ts`, `web/src/prefs/generalPrefs.test.ts`
- Modify: `web/src/prefs/prefGroups.ts` (กลุ่ม `general` ใช้ `GeneralPages`)

**Interfaces:**
- Consumes: `PrefsPageApi`, Task 13 `formatTime`
- Produces:
  - `GENERAL_TABS = ["Number Formats", "Ground Stations", "TLE Update", "Message Logs"]` (`GeneralPages` แสดงแท็บที่มี component แล้ว Task 17–18 เติมอีกสองแท็บ)
  - `NUMBER_FORMAT_CONTROLS` (ป้ายและ tooltip ของ ref-D §2 ทุกตัวอักษร), `previewText(fmt, local, now) -> string`
  - `LOG_LEVEL_ITEMS` (`"Level 0: None"` … `"Level 4: Debug"`), `CLEAN_AGE_ITEMS = [["Always delete", 0], ["1 day", 86400], ["1 week", 604800], ["1 month", 2592000]]`,
    `cleanAgeIndex(seconds) -> number` (ค่าอื่น → 0 "Always delete"), `logInfoText(logDir: string) -> string`, `MESSAGE_LOG_KEYS = ["LOG/LEVEL", "LOG/CLEAN_AGE"]`

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน**

```ts
it("number format labels and tooltips", ...)    // "Show local time instead of UTC." … tooltip ของ Time format ตรง ref-D §2 รวม \t และ \n
it("preview uses the typed format and box", ...) // previewText("%H", true, d) ใช้ local; ค่าเริ่ม TIME_PLACEHOLDER
it("time format reset sets the default only", ...)
it("one month is 30 days", ...)                 // CLEAN_AGE_ITEMS[3][1] == 2592000; cleanAgeIndex(18144000) == 0
it("message logs info text", ...)               // logInfoText("/x/logs") มี "/x/logs/" แทน "<conf dir>/logs/"
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**
- [ ] **Step 3: Implement** — ตัวอย่างอัปเดตทุก 1 วินาทีตามค่าในกล่องที่ยังไม่บันทึก ช่อง Time format `maxLength=50` ปุ่ม "Reset" tooltip "Reset to default value"
  หน้า Number Formats ไม่มี Reset ระดับหน้า Message Logs มี "Reset" tooltip "Reset settings to the default values." (`api.reset(MESSAGE_LOG_KEYS)`)
- [ ] **Step 4: รัน** — `npm test`, `npm run build`
- [ ] **Step 5: Commit** — `feat(gpredict-web): number formats and message logs preference pages`

### Task 17: Web — General → Ground Stations, editor และรายชื่อเมือง

**Files:**
- Create: `web/src/prefs/groundStations.ts`, `web/src/prefs/groundStations.test.ts`, `web/src/prefs/GroundStationsPage.tsx`,
  `web/src/locations.ts`, `web/src/locations.test.ts`, `web/src/components/LocationSelector.tsx`
- Modify: `web/src/components/QthEditor.tsx`, `web/src/qthForm.ts` (+test), `web/src/api.ts` (`getLocations`, `putQthBatch`), `web/src/components/ModuleDialog.tsx` (ส่ง `imperial`), `web/src/prefs/GeneralPages.tsx`

**Interfaces:**
- Consumes: Task 4 batch API, Task 11 `/api/locations`, Task 13 `fmtLatLon`, `mToFt`, `ftToM`, `PrefsPageApi.onCheck/onCommit`
- Produces:
  - `interface StationsDraft { stations: Qth[]; default: string }`; `stationRows(d, nf) -> { name, location, lat, lon, alt, qra, isDefault }[]` (เรียงตามชื่อ, lat/lon `%.4f°`, alt `%.0f` m หรือ ft)
  - `altHeader(imperial) -> "Alt\n(m)" | "Alt\n(ft)"`, `setDefault(d, name)`, `deleteStation(d, name): StationsDraft | "last"` (ลบ default → แถวแรกตามชื่อ),
    `putStation(d, oldName: string | null, q: Qth): StationsDraft`, `stationsChanged(a, b): boolean`
  - `QthEditor` props เพิ่ม `mode: "save" | "draft"` (draft คืน Qth ผ่าน `onSaved` ไม่ PUT), `imperial: boolean` (ป้าย "ft ASL", ช่วง 0–`mToFt(5000)`, เก็บเป็นเมตรด้วย `ftToM` ไม่ปัด),
    `taken: string[]` (ชื่อที่ใช้แล้วในร่าง)
  - `locationTree(rows) -> { continent, countries: { country, cities: LocationRow[] }[] }[]`; `LocationSelector({ onPick(row), onClose })` คอลัมน์ lat/lon `%.4f°` + ทิศ
  - ปุ่ม Select ของ Location ใส่ Location (`<city>, <country>`), Latitude, Longitude, Altitude, Weather St; Select ของ Weather St ใส่เฉพาะ Weather St

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน**

```ts
it("rows sorted with formats", ...)          // nsew ปิด: lat "-13.7298° "; imperial alt 100 m → "328"; qra จาก toLocator
it("imperial renames the Alt column", ...)   // altHeader(true) == "Alt\n(ft)" (หัว Lon ไม่เปลี่ยน)
it("untick default is ignored", ...)         // setDefault ซ้ำที่ default เดิมไม่เปลี่ยน; ตั้งแถวอื่นแล้วแถวเดิมหลุด
it("cannot delete the last station", ...)    // deleteStation(1 แถว) == "last"
it("deleting the default moves it to the first by name", ...)
it("feet round trip keeps metres", ...)      // ftToM(mToFt(100)) ≈ 100 (±1e-9) ไม่ใช่ 99
it("location tree", ...)                     // fixture 3 แถว → Asia/Thailand/Chiang Mai
it("select location fills the form", ...)    // qthForm: applyLocation(form, row) ตั้ง location "Chiang Mai, Thailand", lat, lon, alt, weather "VTCC"
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**
- [ ] **Step 3: Implement** — หน้าโหลด `GET /api/qth` ตอนเปิด ปุ่ม "Add new", "Edit", "Delete" และ tooltip ตาม ref §10 ดับเบิลคลิกแถว = Edit
  ลบแถวสุดท้ายเปิด `Modal` ข้อความ "Can not delete ground station!\n\nYou need to have at least one ground\nstation set up, otherwise gpredict may\nnot work properly."
  ลงทะเบียน `onCheck` (`putQthBatch(d, {dryRun: true})`) และ `onCommit` (`putQthBatch(d)`) เมื่อ `stationsChanged` หน่วยของตารางตาม Imperial ในร่างของกล่องเดียวกันทันที
  Select ทั้งสองของ editor ใช้ได้ทั้งใน Preferences และใน "Add" ของ module (ลบ `NO_CITY_LIST_TIP`, `NO_WEATHER_LIST_TIP`)
- [ ] **Step 4: รัน** — `npm test`, `npm run build`
- [ ] **Step 5: Commit** — `feat(gpredict-web): ground stations preference page with city selector`

### Task 18: Web — General → TLE Update, Update from local files และกล่องแจ้ง TLE เก่า

**Files:**
- Create: `web/src/prefs/tlePrefs.ts`, `web/src/prefs/tlePrefs.test.ts`, `web/src/prefs/TleUpdatePage.tsx`, `web/src/components/TleFilesDialog.tsx`,
  `web/src/tleFiles.ts`, `web/src/tleFiles.test.ts`, `web/src/components/TleOldNotice.tsx`
- Modify: `web/src/tleUpdate.ts` (+test), `web/src/components/TleUpdateDialog.tsx`, `web/src/menus.ts` (+test), `web/src/later.ts`, `web/src/api.ts` (`updateTleLocal`), `web/src/types.ts`, `web/src/App.tsx`, `web/src/prefs/GeneralPages.tsx`

**Interfaces:**
- Consumes: Task 7 API, Task 15 `tleOld`
- Produces:
  - `TLE_PAGE_KEYS = ["TLE/AUTO_UPDATE_FREQ", "TLE/AUTO_UPDATE_ACTION", "TLE/PROXY", "TLE/URLS", "TLE/ADD_NEW_SATS"]`
  - `addSource(urls) -> urls` (ต่อท้าย `NEW_SOURCE_URL`), `deleteSource(urls, i): string[] | "last"`, `editSource(urls, i, text): string[]`
  - `TleResult` เพิ่ม `new`, `add_new`; `tleDialogView(phase, heading: "network" | "files")` บรรทัดที่ 4 `"New Satellites:\t\t %d"` เมื่อ `add_new`
  - `pickTleFiles(files: readonly { name: string; webkitRelativePath: string }[]) -> same[]` (ระดับบนเท่านั้น ลงท้าย .tle/.txt ไม่สนตัวพิมพ์)
  - `BarAction` เพิ่ม `"updateTleFiles"`; LATER ไม่มี "Update TLE data from local files"

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน**

```ts
it("add source appends the placeholder", ...)   // addSource(["a"]) == ["a", "http://server.com/file.txt"]
it("cannot delete the last source", ...)
it("result text with new satellites", ...)      // add_new true: stats == "Satellites updated:\t 1\nSatellites skipped:\t 2\nMissing Satellites:\t 3\nNew Satellites:\t\t 4"
it("files heading", ...)                         // heading "Updating TLE files from files"
it("picks top-level tle and txt files", ...)     // "d/a.TLE", "d/b.txt", "d/c.json", "d/sub/e.tle" → a.TLE, b.txt
it("edit menu enables local files", ...)
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**
- [ ] **Step 3: Implement** — หน้า TLE Update ตาม ref-D §4 (หัวตัวหนา, combo, radio, Proxy พร้อม tooltip, รายการ URL ไม่มีหัวแถว ดับเบิลคลิกเพื่อแก้
  Enter ยืนยัน Escape ยกเลิก, ปุ่มพร้อม tooltip, ลบแถวสุดท้ายเปิด `Modal` ข้อความ "Can not delete TLE source!…" ของ ref-D §4,
  check box, Reset → `api.reset(TLE_PAGE_KEYS)`) กล่อง "Update TLE from files": ป้าย "Select TLE directory:", `<input type="file" webkitdirectory>`
  แสดงชื่อโฟลเดอร์, ปุ่ม "Cancel", "OK" → อ่านไฟล์ที่ `pickTleFiles` เลือกเป็นข้อความ → `POST /api/tle/local` → กล่อง "TLE Update" หัวข้อแบบ files
  กล่องแจ้ง TLE เก่า: `FloatingWindow` ไม่มีชื่อ ปุ่ม "OK" แสดง `<b>…</b>` เป็นตัวหนา (แปลงเฉพาะแท็กนี้ ข้อความอื่นเป็น text)
- [ ] **Step 4: รัน** — `npm test`, `npm run build`
- [ ] **Step 5: Commit** — `feat(gpredict-web): TLE update preferences, local files update and out-of-date notice`

### Task 19: Web — Satellite Info

**Files:**
- Create: `web/src/satInfo.ts`, `web/src/satInfo.test.ts`, `web/src/components/SatInfoWindow.tsx`
- Modify: `web/src/satPopup.ts` (+test), `web/src/components/SatPopup.tsx`, `web/src/views/ListView.tsx`, `web/src/views/MapView.tsx`, `web/src/views/PolarView.tsx`,
  `web/src/components/ModuleView.tsx`, `web/src/App.tsx`, `web/src/later.ts`, `web/src/types.ts`

**Interfaces:**
- Consumes: Task 10 `orbit_info`, radio `getTransponders(norad)` และ `Transponder`, Task 13 `formatTime`, `NumberFormat`
- Produces:
  - `orbitInfoRows(info, nf) -> { label: string; value: string; bold?: boolean }[]` 16 แถวของ ref-D §8.1 (แถวที่ 0 ตัวหนา, เส้นคั่นหลังแถว 6)
  - `transponderLines(t: Transponder) -> string[]` ตาม ref-D §8.2 (MHz `%.4f`, ขีด U+2012, "Inverting: YES/NO" เฉพาะเมื่อทั้งสองเป็นช่วง, "Mode: %s", "Baudrate: %9.2f")
  - `PopupAction` เพิ่ม `{ type: "satInfo" }`; view รับ `onSatDoubleClick?(norad: number)`
  - `SatInfoWindow({ norad, onClose })` เปิดได้หลายหน้าต่าง

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน**

```ts
it("orbit info rows", ...)          // ISS: "Catalogue number:" "25544", "International designator:" "98067A  ", "Inclination:" "51.6400°", "Mean motion:" "15.49438945 [rev/day]", "Eccentricity:" "%.7f"
it("epoch uses the time format", ...) // nf.timeFormat "%Y" → "Epoch time:" "2026"
it("transponder lines", ...)        // up 145.8–145.9 MHz down 435.8–435.9 invert → ["Uplink: 145.8000 ‒ 145.9000 MHz", "Downlink: …", "Inverting: YES"]; beacon down เดียว → "Downlink: 435.8000 MHz" ไม่มี Uplink
it("baud rate", ...)                // baud 9600 → "Baudrate:   9600.00"
it("popup items enabled", ...)      // "Satellite info" และชื่อตัวหนามี action satInfo
it("transponder name is shown as text", ...)  // ชื่อ "<b>A & B</b>" แสดงตามตัวอักษร (render ด้วย React text node)
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**
- [ ] **Step 3: Implement** — หน้าต่าง "Satellite Info" แท็บ "Orbit Info" และ "Transponders" ปุ่ม "OK" ไม่มีข้อมูล → "No transponders"
  ดับเบิลคลิกแถวใน List และดาวใน Map, Polar (รัศมีเดียวกับการคลิก) เปิดหน้าต่างนี้
- [ ] **Step 4: รัน** — `npm test`, `npm run build`
- [ ] **Step 5: Commit** — `feat(gpredict-web): satellite info window`

### Task 20: Web — Log browser

**Files:**
- Create: `web/src/logParse.ts`, `web/src/logParse.test.ts`, `web/src/components/LogBrowser.tsx`
- Modify: `web/src/menus.ts` (+test: "Log browser" และ Ctrl+L ใช้ได้), `web/src/later.ts`, `web/src/api.ts` (`getCurrentLog`, `postLog`), `web/src/App.tsx`, `web/src/dialogs.ts`, `web/src/passes/UpcomingPasses.tsx`

**Interfaces:**
- Consumes: Task 8 API
- Produces:
  - `LEVEL_NAMES = ["NONE", "ERROR", "WARNING", "INFO", "DEBUG"]`
  - `parseLogLine(line: string) -> { time: string; level: number; message: string }`, `parseLog(text) -> rows`, `logSummary(rows) -> { errors, warnings, info, debug, total }`
  - `postLog(level: 1 | 2 | 3 | 4, fn: string, text: string): Promise<void>`
  - Print ของ Upcoming passes เรียก `postLog(1, "multi_pass_response", "multi_pass_response: PRINT not implemented")`

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน**

```ts
it("three fields", ...)              // "2026/11/12 05:06:07|2|f: a" → {time "2026/11/12 05:06:07", level 2, message "f: a"}
it("message with a bar", ...)        // "t|3|f: a|b" → message "f: a|b" (แก้ข้อบกพร่อง)
it("old four-field format", ...)     // "t|src|1|msg" → level 1 message "msg"
it("one field", ...)                 // "garbage" → time "", level 1, message "garbage"
it("corrupt", ...)                   // "t|x|y" ที่ level ไม่ใช่ตัวเลข → message "Log file is corrupt" level 1
it("summary and clear", ...)         // Clear → ทุกตัวนับเป็น 0 รวม Info แล้วโหลดใหม่นับจาก 0
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**
- [ ] **Step 3: Implement** — หน้าต่าง "Log Browser" 600 × 300 เปิดได้หน้าต่างเดียว ตาราง Time/Level/Message กรอบ " Summary " (Errors, Warnings, Info, Debug, เส้นคั่น, **Total**)
  ปุ่ม "Open" (ตัวเลือกไฟล์ของ browser → ชื่อหน้าต่าง "Log Browser: <ชื่อไฟล์>"), "Clear", "Close" อ่าน log ปัจจุบันครั้งเดียวตอนเปิด
- [ ] **Step 4: รัน** — `npm test`, `npm run build`
- [ ] **Step 5: Commit** — `feat(gpredict-web): log browser`

### Task 21: Web — กลุ่ม Modules และการสืบทอดค่าใน Module properties

**Files:**
- Create: `web/src/prefs/ModulesPrefsPage.tsx`, `web/src/prefs/modulesPrefs.ts`, `web/src/prefs/modulesPrefs.test.ts`
- Modify: `web/src/moduleProps.ts` (+test), `web/src/configStore.ts` (+test), `web/src/useModuleConfig.ts`, `web/src/api.ts` (`putModule` รับ `pin`/`unpin`),
  `web/src/components/ModuleProperties.tsx`, `web/src/components/ModulePropertiesPages.tsx`, `web/src/components/ModuleDialog.tsx`, `web/src/types.ts`, `web/src/prefs/prefGroups.ts`

**Interfaces:**
- Consumes: Task 3 `meta.module_keys`, `meta.global_layout_extra`, `PrefsPageApi`
- Produces:
  - `ModuleProps.map` เพิ่ม `file`, `colours`, `shadow_alpha`; `ModuleProps.polar` เพิ่ม `colours`
  - `globalProps(values, meta) -> ModuleProps`, `propsToPrefs(props, page, meta) -> Record<string, PrefValue>`
  - `propsSave(initial, draft, dirty: ReadonlySet<PropsTab>, reset: ReadonlySet<PropsTab>, meta) -> { change; pin: string[]; unpin: string[] }`
    (หน้าที่แก้: pin ทุก path ของหน้า; Reset แล้วไม่แก้ต่อ: unpin; List และ Single Sat นับว่าแก้เมื่อชุดช่องต่างจากตอนเปิด)
  - `ConfigStore.save(change, opts?: { pin?: string[]; unpin?: string[] })`, `PutConfig = (config, opts?) => Promise<unknown>`
  - `ModulesPrefsPage` (โหมดรวม): 6 แท็บเดียวกับ Module properties, Reset tooltip "Reset settings to the default values." (หน้า Map: "Reset settings to default values")
    หน้า Layout มี "<b>Window Placements:</b>" 3 check box พร้อม tooltip ของ ref-D §10 Reset ของหน้า Layout รีเซ็ตทั้งสามด้วย
  - Module properties (โหมด module): Reset โหลดค่ารวมปัจจุบัน ไม่มี Window Placements

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน**

```ts
it("global props come from prefs", ...)          // values MODULES/MAP_TRACK_NUM 5 → globalProps(...).map.track_orbits == 5
it("dirty page pins all its paths", ...)         // แก้ center_lon → pin มีทุก path ของ PAGE map รวม map.colours.terminator และ map.colours.earthShadow
it("reset then OK unpins", ...)
it("reset then edit pins", ...)
it("list toggled back is not dirty", ...)
it("global OK writes page keys or removes them", ...)  // โหมดรวม: แก้หน้า polar → set ทุก key ของหน้า; Reset → remove ทุก key รวม terminator/shadow
it("config store sends pin and unpin once", ...)  // save(change, {pin}) → PutConfig ได้ opts เฉพาะคำขอนั้น
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**
- [ ] **Step 3: Implement** — หน้า Map/Polar ใน Module properties ใช้ส่วนประกอบเดียวกับ Task 22 (Task นี้ใส่เฉพาะโครงช่องใหม่ใน `ModuleProps`)
- [ ] **Step 4: รัน** — `npm test`, `npm run build`
- [ ] **Step 5: Commit** — `feat(gpredict-web): modules preferences and inheritance in module properties`

### Task 22: Web — ภาพแผนที่และสีของ Map/Polar

**Files:**
- Create: `web/src/rgba.ts`, `web/src/rgba.test.ts`, `web/src/components/MapSelector.tsx`, `web/src/components/ColourButton.tsx`, `web/src/mapFiles.ts`, `web/src/mapFiles.test.ts`
- Modify: `web/src/components/ModulePropertiesPages.tsx`, `web/src/views/MapView.tsx`, `web/src/views/mapDraw.ts`, `web/src/views/PolarView.tsx`, `web/src/views/polarDraw.ts`,
  `web/src/colors.ts`, `web/src/passes/PassPolarPlot.tsx`, `web/src/radio/RotatorControl.tsx` (polar plot ของ Antenna Control ที่ใช้ `POLAR_COLORS`), `web/src/api.ts` (`getMaps`, `uploadMap`)
- Delete: `web/public/maps/earth_1024.jpg`, `web/public/maps/SOURCE.md` (ไม่มีที่ใช้แล้ว)

**Interfaces:**
- Consumes: Task 10 maps API, Task 21 `ModuleProps`, Task 8 `postLog`
- Produces:
  - `splitRgba(c: number) -> { hex: "#rrggbb"; alpha: number }`, `joinRgba(hex: string, alpha: number) -> number`, `infoBgHex(c: number) -> string` (เติม 0 ครบ 6 หลัก)
  - `fmtFileSize(bytes) -> string` (`%0.1f GB/MB/kB` เกณฑ์ ">" หรือ `%lu B`), `previewCaption(m) -> "<w>x<h> pixels\n<size>"`, `mapUrl(file) -> string`
  - `ColourButton({ label, tooltip, value, onChange })` (`<input type="color">` + slider ความทึบ 0–255)
  - `MapSelector({ current, onOpen(file), onCancel })` ชื่อ "Select Map" รายการภาพ ตัวอย่าง 160 × 80 พร้อมคำบรรยาย ปุ่ม "Cancel", "Open" และปุ่มอัปโหลด (ของเรา)
  - Map และ Polar view วาดด้วย `config.map.colours`, `config.map.shadow_alpha`, `config.map.file`, `config.polar.colours` (`MAP_COLORS`/`POLAR_COLORS` เหลือเป็นค่าตั้งต้น)

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน**

```ts
it("rgba round trip", ...)              // joinRgba(...splitRgba(0xffffff1f)) == 0xffffff1f
it("info background hex is zero padded", ...)  // infoBgHex(0x0a0b0cff) == "#0a0b0c"
it("file size", ...)                    // 1024 → "1024 B"; 1025 → "1.0 kB"; 94680 → "92.5 kB"
it("map colour tooltips", ...)          // 11 ป้ายและ tooltip ของ ref-D §11 เรียงตามตาราง; "Footprint:" มี "\nHint: Make it transparent"
it("polar info text tooltip copies background", ...)  // "Info Text:" tooltip == "Click to select background colour"
it("missing map falls back to the default", ...)       // onerror ของภาพ → ใช้ nasa-bmng-07_1024.jpg และ postLog(1, …) ครั้งเดียว
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**
- [ ] **Step 3: Implement** — หน้า Map View: บล็อก "<b>Background Map:</b>" รูปย่อ 100 × 50 + ปุ่ม "Select map" (tooltip "Click to select a map"),
  บล็อก "<b>Colours:</b>" 11 ปุ่มตามตาราง ref-D §11 และแถว "Shadow:" `<i>Transp.</i>` slider `<i>Opaque</i>` พร้อม tooltip;
  หน้า Polar View: 7 ปุ่มสีและ "<b>Miscellaneous:</b>" "Show the sky tracks automatically" พร้อม tooltip ของ ref-D §12
  Polar plot ของ Pass details และ Antenna Control ใช้ค่ารวม `MODULES/POLAR_*` จาก `usePrefs()` (decision 15)
- [ ] **Step 4: รัน** — `npm test`, `npm run build`
- [ ] **Step 5: Commit** — `feat(gpredict-web): map images and colours for map and polar views`

### Task 23: Web — Detach, Attach, Full screen และการคืนสถานะ

**Files:**
- Create: `web/src/detach.ts`, `web/src/detach.test.ts`, `web/src/DetachedApp.tsx`, `web/src/components/RestoreBar.tsx`
- Modify: `web/src/main.tsx` (เลือก `App` หรือ `DetachedApp` จาก `?module=`), `web/src/moduleMenu.ts` (+test), `web/src/App.tsx`, `web/src/api.ts` (`putWindow`), `web/src/types.ts`, `web/src/later.ts`, `web/src/tabs.ts` (+test)

**Interfaces:**
- Consumes: Task 12 API, Task 15 `modulesChanged`, Task 1 `GLOBAL/MOD_WIN_POS`, `GLOBAL/CURRENT_PAGE`
- Produces:
  - `detachedUrl(module) -> "/?module=<encodeURIComponent>"`, `detachTarget(module) -> "gpredict-<module>"`
  - `detachFeatures(win: ModuleWindow, fallback: { width; height }, restorePos: boolean) -> string` (`popup,width=…,height=…[,left=…,top=…]`)
  - `geometryOk(g, screen: { availWidth; availHeight }) -> boolean` (ไม่ติดลบและอยู่ในจอทั้งหมด), `sameGeometry(a, b)`
  - `detachedTitle(module, qth, restored: boolean) -> "GPREDICT: m (q)" | "Gpredict: m (q)"`
  - `moduleMenu({ ..., place: "docked" | "window", fullscreen: boolean })` → "Detach module"/"Attach module", "Full screen"/"Exit full screen";
    `ModuleAction` เพิ่ม `detach`, `attach`, `fullscreen`, `exitFullscreen`
  - `tabsOf(open, windows) -> string[]`, `initialTab(tabs, currentPage: number) -> string | null`

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน**

```ts
it("features use the stored size, and position only when restoring positions", ...)
it("geometry outside the screen is not saved", ...)
it("menu items per state", ...)               // docked: "Detach module", "Full screen"; window+fullscreen: "Attach module", "Exit full screen"
it("tabs leave out detached modules", ...)
it("initial tab from CURRENT_PAGE", ...)      // initialTab(["A","B"], 1) == "B"; -1 หรือเกิน → แท็บแรก
it("detached page re-opens its module on load", ...)    // DetachedApp เรียก openModule(name) ทุกครั้งที่โหลด
it("blocked popup keeps the tab and shows the notice", ...)  // window.open คืน null → ไม่เรียก putWindow, notice ไทยมี "127.0.0.1:8740"
it("attach puts state 0 and closes the window", ...)
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**
- [ ] **Step 3: Implement** — Detach (ในตัวจัดการคลิก): `window.open(detachedUrl, detachTarget, detachFeatures(...))` ได้หน้าต่างแล้วจึง `putWindow({state: 1})`
  หน้าแยกแสดง header + view + Module menu, ชื่อหน้าต่างตาม `detachedTitle`, ตรวจตำแหน่ง/ขนาดทุก `DETACH_POLL_MS` และบันทึกหลังนิ่ง `GEOMETRY_DEBOUNCE_MS`
  `pagehide` → `fetch(close, {method: "POST", keepalive: true})`; Attach → `putWindow({state: 0})` แล้ว `window.close()`
  Full screen: `requestFullscreen()` ของพื้นที่ module ในหน้าต่างที่อยู่ Exit full screen ออกจากเต็มจอ ถ้าอยู่ในแท็บ Detach ต่อทันที (spec §8.3)
  หน้าหลัก: แท็บ = `tabsOf(open, windows)`, `RestoreBar` "module <ชื่อ> ตั้งให้เปิดเป็นหน้าต่างแยก" + ปุ่ม "เปิด" (ของเรา, decision 10),
  เปลี่ยนแท็บบันทึก `GLOBAL/CURRENT_PAGE`, โหลดหน้าใช้ `initialTab`
- [ ] **Step 4: รัน** — `npm test`, `npm run build`
- [ ] **Step 5: Commit** — `feat(gpredict-web): detach, attach and full screen modules`

### Task 24: ครบทุกรายการ, README และการตรวจรับ

**Files:**
- Modify: `web/src/later.ts` (+test), `web/src/menuSpec.ts`, `README.md` ของ `api-interop/gpredict-web/` (Preferences ทุกกลุ่ม, TLE sources, log, รหัสใหม่ `QTH_LAST`, `TLE_FILE_INVALID`, `MAP_INVALID`, `LOG_INVALID`, ผลตรวจรับงานย่อยที่ 4)

- [ ] **Step 1: เขียน test** — `later.test.ts`: `LATER` ว่าง และ `outline()` ของทุกเมนู (`barMenu` ทุกหัว, `moduleMenu` ทุกสถานะ, `satPopup` ทุก view) ไม่มีรายการที่ `later` หรือ `disabled` เพราะงานย่อยถัดไป
- [ ] **Step 2: ลบที่เหลือ** — `laterItem`/`laterTooltip` ที่ไม่มีผู้ใช้แล้วลบทิ้ง `npm test`, `npm run build` และ test ทั้งชุดของ server, engine ผ่าน
- [ ] **Step 3: ตรวจรับในหน้าเว็บจริง** (restart server แล้วเปิด `http://127.0.0.1:8740`) ทำ spec §14 ข้อ 1–9 ทีละข้อ
  - ข้อ 3: Update TLE ดึง AMSAT ได้ตามกติกา 2 ชม. ส่วน CelesTrak ใช้ cache ถ้ายังไม่ครบ 2 ชม. (ถ้าต้องดึง CelesTrak จริงให้ถามผู้ใช้ก่อน)
  - ข้อ 4: ตั้ง Daily และ `TLE/LAST_UPDATE` เป็น 2 วันก่อนผ่าน `PUT /api/prefs` แล้วรอไม่เกิน 10 นาที
  บันทึกผลลง README ส่วน "ผลตรวจรับงานย่อยที่ 4"
- [ ] **Step 4: ตรวจ GNSS Studio** — test ของ engine ผ่าน และ `git diff feature/gpredict-web-core -- api-interop/gnss-predict` ว่าง
- [ ] **Step 5: Commit** — `docs(gpredict-web): data and preferences usage and acceptance results`
