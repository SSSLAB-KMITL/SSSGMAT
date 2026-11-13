# GNSS Studio งานเสริม ก: Sensor และ Sensor View — แผนลงมือ

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** object Sensor แบบ STK (Simple Conic, Fixed Az-El) ติดกับดาว พร้อมหน้าต่าง Sensor View ที่มองโลกจากดาวตามทิศ boresight กรวยและรอยบนพื้นโลกในหน้าต่าง 3D/2D และการคลิกเลือกดาวในหน้าต่าง 3D

**Architecture:** server เก็บ Sensor เป็น object แบนใน `scenario.json` (`*/Sensor/<ชื่อ>` + `parent`) ผ่าน schema/objects เดิม engine ไม่รู้จัก class นี้จึงไม่กระทบผลคำนวณ หน้าเว็บคำนวณทิศและรอยด้วยฟังก์ชันล้วนใน `cesium/sensorGeometry.ts` จากตำแหน่งดาวใน CZML ที่โหลดอยู่แล้ว หน้าต่าง Sensor View ใช้ scene ของหน้าต่าง 3D เดิมในโหมดกล้องล็อก

**Tech Stack:** FastAPI + pydantic (server), React 18 + TypeScript + Zustand + dockview + CesiumJS 1.147 + Radix (web), pytest, Vitest + jsdom, Playwright (Chromium)

**Spec:** `docs/2026-11-13-gnss-studio-sensor-design.md` (อ้างว่า "spec §n") ประกอบกับ STK ref §G (`docs/2026-11-11-gnss-studio-stk-reference.md`), spec workspace และ `docs/2026-11-11-gnss-studio-workspace-decisions.md`

## Global Constraints

- ทำงานใน worktree `/Users/phuwish/SSSGMAT/.worktrees/gnss-studio-sensor` บน branch `feature/gnss-studio-sensor` ห้ามสลับ branch ใน checkout หลัก `/Users/phuwish/SSSGMAT` ห้าม push ห้าม merge ตรวจ `git branch --show-current` ก่อน commit ทุกครั้ง ถ้าไม่ใช่ `feature/gnss-studio-sensor` ห้าม commit ห้ามใช้ `git stash` เปล่า
- ห้ามแก้ engine (`gnss_predict/`) และไฟล์ GMAT ห้ามเพิ่ม dependency ใหม่ทั้ง npm และ pip
- คำสั่ง (จาก `api-interop/gnss-predict/`): web `cd web && npx vitest run <ไฟล์>` / `npm test` / `npm run typecheck`, server `cd server && .venv/bin/python -m pytest -q -W error`, e2e `cd web && npm run e2e` ต้องผ่าน test + typecheck ก่อน commit ทุกครั้ง
- ไฟล์ที่สร้างจาก API (`web/src/api/openapi.json`, `types.gen.ts`, `enums.gen.ts`) สร้างใหม่ด้วย `cd web && npm run gen:api` เท่านั้น ห้ามแก้มือ
- ข้อความบนจอของเมนู ปุ่ม หน้าต่าง หน้าตั้งค่า ช่อง และตัวเลือกมาจาก `t("<key>")` ใน `labels.ts`: คำที่มีใน STK ref §G ใช้ `stk(text, "G")` ตรงตัว ที่ไม่มีใช้ `ours(text)` ข้อความอธิบาย/ผิดพลาดเป็นภาษาไทยใน `messages.th.ts` คอมเมนต์ในโค้ดเป็นภาษาไทยแบบโค้ดเดิม
- หน้าต่าง 3D/2D: ห้ามใช้ `CallbackProperty` (ข้อจำกัดใน `cesium/idleUpdates.ts`) กราฟิกที่เปลี่ยนตามเวลาใช้ `ConstantProperty` ที่คำนวณใหม่ผ่าน `Throttle` ไม่เกินทุก 250 ms แบบ `drawInertial` ใน `scene3d.ts`
- ห้ามต่อเน็ตนอกเครื่อง ห้าม test ใดเรียก `/api/orbits/fetch`, `/api/daily/run`, `/api/scenarios/*/validate` ของจริง
- ค่าคงที่: Re = `EARTH_RADIUS_KM` (6371.0088) ของ `cesium/swath.ts`, ω⊕ = 7.292115e−5 rad/s, Cone Half Angle ∈ (0, 90] ค่าตั้งต้น 45, Azimuth ∈ [0, 360), Elevation ∈ [−90, 90] ค่าตั้งต้น az 0 / el 90, % Translucency ∈ [0, 100] ค่าตั้งต้น 50, สีตั้งต้น `#e8c547`, Sensor View เปิดได้ไม่เกิน 4 บาน, fov ด้านสั้น = min(2α × 1.05, 120°)
- commit message แบบ conventional ภาษาอังกฤษ ลงท้ายด้วย `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` บรรทัดเดียว ห้ามมี co-author อื่น

## Review Focus

1. **ลบหรือ Rename ดาวที่มี sensor ขณะเปิด Sensor View อยู่**: ลบ → sensor หายจากไฟล์และต้นไม้ หน้าต่างปิดพร้อมข้อความไทย; Rename → ชื่อหน้าต่างเปลี่ยนตาม ไม่ค้างชื่อเก่า → Task 1 `test_delete_satellite_deletes_its_sensors`, Task 7 `sensor view closes when its sensor disappears` และ `sensor view title follows a satellite rename`
2. **ดาวที่ยังไม่มีตำแหน่ง** (scenario ไม่มีผล, เวลานอกช่วง): Sensor View ขึ้นข้อความไทย กราฟิกของ sensor ไม่วาด ไม่มี error ในหน้า → Task 6 `sensorDrawState returns null without a position`, Task 7 `shows the no-position message`, Task 9 e2e บน `E2E_NORES`
3. **boresight ไม่โดนโลก หรือกรวยกว้างกว่าจานโลก**: รอยเป็นขอบฟ้าหรือไม่วาดรอย ไม่ได้ NaN → Task 2 `cone wider than the Earth disc ends on the horizon` และ `boresight that misses the Earth has no hit and a horizon ring`
4. **ไฟล์ที่แก้มือให้ sensor อ้างดาวที่ไม่มี หรือ workbook เก่าที่มี Sensor View ของ sensor ที่ถูกลบไปแล้ว**: PUT ได้ 422 ที่ `objects[i].parent`; เปิด scenario แล้วหน้าต่างที่อ้างไม่ได้ถูกปิดพร้อมข้อความ ไม่ล่ม → Task 1 `test_put_doc_with_orphan_sensor_rejected`, Task 7 `workbook sensor view for a missing sensor is closed with a message`
5. **คลิกเพื่อเลือกกับลากหมุนโลกในหน้าต่าง 3D**: ลากเกิน 4 px ไม่เปลี่ยนการเลือก คลิกที่ว่างไม่ล้างการเลือก → Task 8 `a drag is not a click` และ `click on empty space keeps the selection`

## การตัดสินใจในแผนที่ spec ไม่ได้กำหนดไว้

| # | เรื่อง | ที่เลือก |
|---|---|---|
| P1 | `children` ในต้นไม้ | มีเฉพาะโหนดดาวที่มี sensor อย่างน้อยหนึ่งตัว (โหนดอื่นหน้าตาเดิม test เดิมไม่ต้องแก้) |
| P2 | Fill ของรอยใน 2D | วาดเมื่อ boresight ชี้ลงศูนย์กลางโลก (คลาดไม่เกิน 0.01°) ด้วย `capColumns` แบบ Swath; boresight เอียงวาดเฉพาะเส้นขอบ |
| P3 | ทะเบียนของ Sensor View | ทะเบียนแยก (`createSceneRegistry` ตัวใหม่) ไม่ใช่ `registry3d` คำสั่ง g3d.* และ test hook เดิมจึงไม่ไปโดนหน้าต่างกล้องล็อก |
| P4 | ข้อความบนภาพของ Sensor View | handle มี `sensorHud()` React อ่านใหม่ทุกครั้งที่ `useThrottledTime` เปลี่ยน |
| P5 | ตัวตรวจ request ออกนอกเครื่องใน e2e | spec §8 อ้างว่ามีอยู่แล้วแต่ไม่มี เพิ่มใน `tests/e2e/fixtures.ts` (Task 9) ให้ทุก spec ใช้ |
| P6 | Radial Lines | 8 เส้น ห่างเท่ากันรอบกรวย (จุดที่ 0, 9, 18, … ของวง 72 จุด) |
| P7 | กราฟิกของ sensor ใน Sensor View ของตัวเอง | ไม่วาด Radial Lines และซ่อนจุด/ป้ายของดาวแม่ (อยู่ที่ตำแหน่งกล้อง) ยังวาดวงรอย |
| P8 | หน้าต่าง Sensor View | เปิดแสงกลางวัน/กลางคืนเสมอ ไม่มี 3D Graphics Window Properties ของตัวเอง ค่า Up เก็บใน params ของ panel (`up: "north" \| "velocity"`) |
| P9 | ความเร็วของดาว | ผลต่างตำแหน่ง t ± 1 s; ด้านใดไม่มีค่า (ขอบช่วง) ใช้ผลต่างข้างเดียว 1 s |

---

### Task 1: Sensor ใน server (schema, objects, ต้นไม้) และ type ของ API

**Files:**
- Modify: `server/gnss_studio_server/schema.py` (OBJECT_CLASSES L23, union L197, `_reason` L310, OBJECT_MODELS L339, `validate_scenario` L353), `server/gnss_studio_server/objects.py`, `server/gnss_studio_server/templates.py`, `server/gnss_studio_server/routes/objects.py` (docstring), `web/tools/enum-sources.mjs`
- Regenerate: `web/src/api/openapi.json`, `web/src/api/types.gen.ts`, `web/src/api/enums.gen.ts`
- Test: `server/tests/test_objects.py`, `server/tests/test_scenarios.py`

**Interfaces:**
- Produces (pydantic ใน `schema.py`, ชื่อ model เหล่านี้กลายเป็นชื่อใน `types.gen.ts`):
  - `SatellitePath` = string pattern `^\*/Satellite/[A-Za-z0-9_-]{1,32}$`
  - `SensorDefinition {type: Literal["Simple Conic"] = "Simple Conic", cone_half_angle: float (0 < x ≤ 90) = 45.0}`
  - `SensorPointing {type: Literal["Fixed"], orientation: Literal["Az-El"], azimuth: float [0, 360) = 0.0, elevation: float [−90, 90] = 90.0, about_boresight: Literal["Rotate"]}`
  - `Graphics2DSensor {show: bool = True, color: Color = "#e8c547", fill: bool = False, fill_translucency: int [0, 100] = 50}`
  - `Graphics3DSensor {show: bool = True, color: Color = "#e8c547", show_radial_lines: bool = True, show_boresight_marker: bool = False}`
  - `SensorObj {class: "Sensor", name: Name, parent: SatellitePath, description, long_description, definition, pointing, graphics2d, graphics3d}`
  - `templates.sensor(name: str, parent: str, cone_half_angle: float = 45.0) -> dict`
  - `GET /objects`: โหนดดาวที่มี sensor มี `children: [{path: "*/Sensor/<n>", class: "Sensor", name, color: graphics2d.color, show: graphics2d.show}]` (P1)
  - Insert: `{class: "Sensor", method: "Define Properties", name, parent, ...}` และ `{class: "Sensor", method: "Insert Default", parent}`
  - หน้า: `basic` = description, long_description, parent (อ่านอย่างเดียว), definition, pointing; `graphics2d`, `graphics3d`

- [ ] **Step 1: เขียน test ที่ fail** ใน `test_objects.py` (ใช้ helper เดิม `insert`, `patch`, `pages`, `rename`, `delete`, `tree_of`, `obj_in`, `assert_error` และ fixture `s1`, `s1_computed`)
  - `test_insert_sensor_define_properties_defaults`: insert `{class:"Sensor", method:"Define Properties", name:"S1", parent:"*/Satellite/G01"}` → `["*/Sensor/S1"]`, object ในไฟล์ = `templates.sensor("S1","*/Satellite/G01")`
  - `test_insert_sensor_insert_default_names_sensor1_then_sensor2`: Insert Default สองครั้ง → `Sensor1`, `Sensor2`
  - `test_insert_sensor_requires_existing_satellite_parent` (parametrize): ไม่มี parent, `"*/Facility/THBK"`, `"*/Satellite/NOPE"` → 422 field `parent`
  - `test_insert_sensor_from_catalog_rejected` → 422 field `class`
  - `test_sensor_invalid_values` (parametrize ทั้ง Define Properties และ PATCH): cone 0 / 90.5 / −1 (`definition.cone_half_angle`), azimuth 360 / −1, elevation 91, definition.type `"Rectangular"`, pointing.type `"Targeted"`, color `"red"`, fill_translucency 101 → 422 ที่ช่องนั้น (PATCH ได้ชื่อช่องแบบหน้า เช่น `basic.definition.cone_half_angle`)
  - `test_patch_sensor_pages`: `pages` คืน basic มี `parent`, `definition`, `pointing`; PATCH `{basic:{definition:{cone_half_angle:13.9}}}` สำเร็จ; PATCH `{basic:{parent:"*/Satellite/G02"}}` → 422 `basic.parent`; ส่ง parent เดิมกลับได้
  - `test_tree_nests_sensors_under_satellite`: เพิ่ม sensor ให้ G01 สองตัว → โหนด G01 มี `children` สองโหนดตามลำดับ โหนดดาวอื่นไม่มีคีย์ `children`
  - `test_sensor_name_collides_with_satellite` → 409 `NAME_EXISTS`
  - `test_rename_satellite_updates_sensor_parent`: rename G01 → GPS01 แล้ว sensor มี `parent == "*/Satellite/GPS01"`
  - `test_delete_satellite_deletes_its_sensors`: sensor ของ G01 หาย sensor ของ G02 ยังอยู่; ลบ sensor ตรง ๆ ได้
  - `test_sensor_edits_do_not_make_results_stale` (`s1_computed`, แบบ `test_patch_color_not_stale`): insert, patch, rename, delete sensor แล้ว `results_stale` ยัง false
  - ใน `test_scenarios.py`: `test_put_doc_with_orphan_sensor_rejected`: PUT doc ที่ sensor มี parent `*/Satellite/NOPE` → 422 field `objects[<i>].parent`; เพิ่มกรณี class `"Sensor"` ที่ขาด parent ใน `_invalid_cases`

- [ ] **Step 2: รันให้เห็นว่า fail** — `cd server && .venv/bin/python -m pytest -q -W error tests/test_objects.py tests/test_scenarios.py -k sensor` Expected: FAIL (class Sensor ไม่รู้จัก)

- [ ] **Step 3: ทำ schema** ตาม Interfaces: เพิ่ม `"Sensor"` ใน `OBJECT_CLASSES`, union และ `OBJECT_MODELS`; ข้อความ `_reason` ระบุ 4 class; ใน `validate_scenario` หลังลูปชื่อกลุ่ม ตรวจทุก Sensor ว่า `parent` เป็น path ของ Satellite ที่มีอยู่ ไม่ใช่ → error ที่ `objects[i].parent` ข้อความ `parent ต้องเป็นดาวที่มีอยู่ใน scenario (ไม่พบ <path>)` `ObjectPath` (ใช้กับ groups, assigned_objects, accesses) **ไม่** เพิ่ม Sensor

- [ ] **Step 4: ทำ objects.py + templates.py**: `BASIC_KEYS["Sensor"]`, `PAGE_SECTIONS["Sensor"] = ("graphics2d","graphics3d")`, `_OBJECT_KEYS["Sensor"]`; `parent` อ่านอย่างเดียวใน `apply_pages` แบบ NORAD (L199-202); `_define` ต้องมี `name` + `parent`; `_default` รับ `parent` เฉพาะ Sensor (คีย์ที่อนุญาตของ Insert Default สำหรับ Sensor = `{"parent"}`); ตรวจ parent ด้วย `_require_existing(..., satellites_only=True)` แบบรายการเดียว field `parent`; `tree()` ใส่ `children` ตาม P1; `rename` ของดาวแก้ `parent` ของ sensor; `delete` ของดาวลบ sensor ที่ parent ตรงก่อนลบดาว

- [ ] **Step 5: รัน test ให้ผ่าน แล้วรันชุด server ทั้งหมด** — `.venv/bin/python -m pytest -q -W error` Expected: ผ่านทั้งหมด 0 warning

- [ ] **Step 6: สร้าง type ของ API ใหม่**: เพิ่ม enum ของ Sensor (`SensorDefinition.type`, `SensorPointing.type`, `orientation`, `about_boresight`) ใน `web/tools/enum-sources.mjs` แล้ว `cd web && npm run gen:api` ถ้า `npm run typecheck` พังเพราะ union ใหม่ ให้แก้ให้น้อยที่สุด (Sensor ยังไม่วาดและไม่แสดง) `npm test` ต้องผ่าน

- [ ] **Step 7: Commit** — `feat(gnss-studio): sensor objects in the scenario API`

---

### Task 2: เรขาคณิตของ sensor (ฟังก์ชันล้วน)

**Files:**
- Create: `web/src/cesium/sensorGeometry.ts` (ไม่ import Cesium)
- Test: `web/tests/unit/sensor-geometry.test.ts`

**Interfaces:**
- Consumes: `EARTH_RADIUS_KM`, `WGS84_E2`, `subSatellite` จาก `cesium/swath.ts`
- Produces:
  - `type Vec3 = { x: number; y: number; z: number }` (เมตร, Earth-fixed); `interface BodyFrame { x: Vec3; y: Vec3; z: Vec3 }` (เวกเตอร์หนึ่งหน่วย)
  - `EARTH_ROTATION_RAD_S = 7.292115e-5`
  - `earthDiscHalfAngleDeg(altKm: number): number` = asin(Re / (Re + h))
  - `nadirCentralAngleRad(altKm: number, halfAngleDeg: number): number` = asin(k·sin α) − α เมื่อ α < ρ, ไม่งั้น acos(Re/(Re+h)) (k = (Re+h)/Re)
  - `defaultConeHalfAngleDeg(pos: Vec3 | null): number` = null → 45, ไม่งั้น ρ + 0.5 ปัดทศนิยม 1 ตำแหน่ง
  - `bodyFrame(pos: Vec3, velEcef: Vec3): BodyFrame | null` — Nadir alignment with ECI velocity constraint (spec §3.1): z = −p̂, v_I = v + ω⊕ × r, x = ส่วนของ v_I ที่ตั้งฉากกับ z, y = z × x; null เมื่อ |p| = 0 หรือ v_I ขนานกับ z
  - `boresightOf(f: BodyFrame, azDeg: number, elDeg: number): Vec3` (spec §3.2)
  - `isNadir(pos: Vec3, b: Vec3): boolean` (มุมระหว่าง b กับ −p̂ ≤ 0.01°)
  - `interface SensorFootprint { ring: [number, number][]; horizon: boolean[]; boresightHit: [number, number] | null }` — ring = [lon, lat] geodetic องศา n+1 จุด (ปิดวง), horizon ยาว n
  - `sensorFootprint(pos: Vec3, b: Vec3, halfAngleDeg: number, n = 72): SensorFootprint` — ยิงเส้นรอบกรวยไปตัดทรงกลมรัศมี Re เส้นที่ไม่โดนใช้จุดสัมผัสขอบฟ้าในระนาบของ p กับเส้นนั้น (spec §3.3) แปลงจุดเป็นละติจูด geodetic แบบ `subSatellite`; เส้นแรกของวงอยู่ทางทิศของ +X ที่ฉายลงระนาบตั้งฉาก b (ถ้าขนานใช้ทิศเหนือ) แล้ววนตามเข็มนาฬิกาเมื่อมองตาม b
  - `cameraOrientation(pos: Vec3, b: Vec3, f: BodyFrame, up: "north" | "velocity"): { direction: Vec3; up: Vec3 }` — north = แกนโลก (0,0,1) ฉายลงระนาบตั้งฉาก b, ฉายแล้วยาว < 1e−6 → ใช้ f.x ฉายแทน
  - `sensorViewFovDeg(halfAngleDeg: number, aspect: number): number` — fov ของด้านยาวตามความหมายของ `PerspectiveFrustum.fov` (aspect = กว้าง/สูง): fs = min(2α·1.05, 120°), คืน 2·atan(tan(fs/2)·max(aspect, 1/aspect))

- [ ] **Step 1: เขียน test ที่ fail**

```ts
const RE = 6371.0088, GPS_H = 20180, D = Math.PI / 180;
const k = (RE + GPS_H) / RE;
test("Earth disc half angle", () => {
  expect(earthDiscHalfAngleDeg(GPS_H)).toBeCloseTo(13.884, 2);
  expect(earthDiscHalfAngleDeg(42164.17 - RE)).toBeCloseTo(8.69, 2);
});
test("default cone half angle is the disc plus half a degree, 45 without a position", () => {
  expect(defaultConeHalfAngleDeg(null)).toBe(45);
  expect(defaultConeHalfAngleDeg({ x: (RE + GPS_H) * 1000, y: 0, z: 0 })).toBe(14.4);
});
test("nadir cone footprint sits at asin(k sin a) - a from the sub-point", () => {
  const p = { x: (RE + GPS_H) * 1000, y: 0, z: 0 };
  const fp = sensorFootprint(p, { x: -1, y: 0, z: 0 }, 10);
  const want = (Math.asin(k * Math.sin(10 * D)) - 10 * D) / D;          // ≈ 36.36°
  for (const [lon, lat] of fp.ring) expect(centralAngleDeg(0, 0, lon, lat)).toBeCloseTo(want, 1);
  expect(fp.horizon.every((h) => !h)).toBe(true);
  expect(fp.boresightHit).toEqual([0, 0]);
});
test("cone wider than the Earth disc ends on the horizon", () => {
  const fp = sensorFootprint({ x: (RE + GPS_H) * 1000, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }, 45);
  expect(fp.horizon.every(Boolean)).toBe(true);
  for (const [lon, lat] of fp.ring) expect(centralAngleDeg(0, 0, lon, lat)).toBeCloseTo(90 - earthDiscHalfAngleDeg(GPS_H), 1);
});
test("boresight that misses the Earth has no hit and a horizon ring", () => {
  const f = bodyFrame({ x: (RE + GPS_H) * 1000, y: 0, z: 0 }, { x: 0, y: -1936.1, z: 3874 })!;
  const fp = sensorFootprint({ x: (RE + GPS_H) * 1000, y: 0, z: 0 }, boresightOf(f, 0, 60), 5);
  expect(fp.boresightHit).toBeNull();
  expect(fp.ring.flat().every(Number.isFinite)).toBe(true);
});
test("ECI velocity constraint: tilt toward +X moves the hit north for a northbound satellite", () => {
  const p = { x: (RE + GPS_H) * 1000, y: 0, z: 0 };
  const f = bodyFrame(p, { x: 0, y: -EARTH_ROTATION_RAD_S * p.x, z: 3874 })!;        // v_I = (0, 0, 3874)
  expect(f.x.z).toBeCloseTo(1, 9);
  const hit = sensorFootprint(p, boresightOf(f, 0, 80), 1).boresightHit!;
  expect(hit[1]).toBeGreaterThan(0);
  expect(centralAngleDeg(0, 0, hit[0], hit[1])).toBeCloseTo((Math.asin(k * Math.sin(10 * D)) - 10 * D) / D, 1);
});
test("geostationary body frame uses the inertial velocity", () => {
  const f = bodyFrame({ x: 42164170, y: 0, z: 0 }, { x: 0, y: 0, z: 0 })!;
  expect([f.x.x, f.x.y, f.x.z]).toEqual([expect.closeTo(0, 9), expect.closeTo(1, 9), expect.closeTo(0, 9)]);
  expect([f.y.x, f.y.y, f.y.z]).toEqual([expect.closeTo(0, 9), expect.closeTo(0, 9), expect.closeTo(-1, 9)]);
});
test("az 0 el 90 is nadir", () => {
  const p = { x: (RE + GPS_H) * 1000, y: 0, z: 0 };
  const f = bodyFrame(p, { x: 0, y: -EARTH_ROTATION_RAD_S * p.x, z: 3874 })!;
  const b = boresightOf(f, 0, 90);
  expect([b.x, b.y, b.z]).toEqual([expect.closeTo(-1, 9), expect.closeTo(0, 9), expect.closeTo(0, 9)]);
  expect(isNadir(p, b)).toBe(true);
  expect(isNadir(p, boresightOf(f, 0, 89.98))).toBe(false);
});
test("camera up: north on the equator, +X in velocity mode, +X when looking along the Earth axis", () => {
  const geo = { x: 42164170, y: 0, z: 0 }, fg = bodyFrame(geo, { x: 0, y: 0, z: 0 })!;
  const down = { x: -1, y: 0, z: 0 };
  const n = cameraOrientation(geo, down, fg, "north").up, v = cameraOrientation(geo, down, fg, "velocity").up;
  expect([n.x, n.y, n.z]).toEqual([expect.closeTo(0, 9), expect.closeTo(0, 9), expect.closeTo(1, 9)]);
  expect([v.x, v.y, v.z]).toEqual([expect.closeTo(0, 9), expect.closeTo(1, 9), expect.closeTo(0, 9)]);
  const pole = { x: 0, y: 0, z: 26551008.8 }, fp = bodyFrame(pole, { x: 3874, y: 0, z: 0 })!;
  const u = cameraOrientation(pole, { x: 0, y: 0, z: -1 }, fp, "north").up;
  expect([u.x, u.y, u.z]).toEqual([expect.closeTo(1, 9), expect.closeTo(0, 9), expect.closeTo(0, 9)]);
});
test("fov: square view equals the cone, wide view widens, capped at 120 on the short side", () => {
  expect(sensorViewFovDeg(10, 1)).toBeCloseTo(21, 6);
  expect(sensorViewFovDeg(80, 1)).toBeCloseTo(120, 6);
  expect(sensorViewFovDeg(10, 2)).toBeCloseTo(2 * Math.atan(Math.tan(10.5 * D) * 2) / D, 6);
});
```
(`centralAngleDeg` เป็น helper ใน test: มุมศูนย์กลางระหว่างสองจุดบนทรงกลมจาก lat/lon geodetic ที่แปลงกลับเป็น geocentric)

- [ ] **Step 2: รันให้เห็นว่า fail** — `cd web && npx vitest run tests/unit/sensor-geometry.test.ts` Expected: FAIL (ไม่มีโมดูล)
- [ ] **Step 3: เขียน `sensorGeometry.ts`** ตาม Interfaces
- [ ] **Step 4: รันให้ผ่าน + `npm test` + `npm run typecheck`**
- [ ] **Step 5: Commit** — `feat(gnss-studio): sensor pointing and footprint geometry`

---

### Task 3: ชื่อแบบ STK §G และข้อความไทยของ sensor

**Files:**
- Modify: `web/src/labels/labels.ts` (`Section` L26), `web/src/labels/messages.th.ts`, `web/tests/unit/labels.test.ts` (regex ส่วน L51, รายการส่วน L116-117, L182, `PROSE_EVIDENCE` L130)
- Test: `web/tests/unit/labels.test.ts`

**Interfaces:**
- Produces (คีย์ที่ Task 4–9 ใช้ ชื่อคีย์ตามนี้ตรงตัว ข้อความตามวงเล็บ):
  - `stk(..., "G")`: `ob.class.sensor` (Sensor), `menu.insert.sensor` (Sensor... — ติดป้ายแบบเดียวกับ `menu.insert.satellite`), `window.selectObject` (Select Object), `page.sensor.definition` (Basic - Definition), `page.sensor.pointing` (Basic - Pointing), `page.sensor.attributes2d` (2D Graphics - Attributes), `page.sensor.attributes3d` (3D Graphics - Attributes), `field.sensorType` (Sensor Type), `field.coneHalfAngle` (Cone Half Angle), `field.pointingType` (Pointing Type), `field.orientationMethod` (Orientation Method), `field.azimuth` (Azimuth), `field.elevation` (Elevation), `field.aboutBoresight` (About Boresight), `field.fill` (Fill), `field.translucency` (% Translucency), `field.showRadialLines` (Show Radial Lines), `field.showBoresightMarker` (Show Boresight Marker), ตัวเลือก `Simple Conic`, `Fixed`, `Az-El`, `Rotate`
  - `ours(...)`: `menu.object.sensorView` (Sensor View), `window.sensorView` (Sensor View - {sensor} ({satellite}) แบบเดียวกับ `window.propertiesBrowserFor`), `field.parentObject` (Parent), `sensorView.up` (Up), `sensorView.up.north` (North), `sensorView.up.velocity` (Velocity)
  - ใช้คีย์เดิมถ้าข้อความเหมือนกัน (Basic - Description, Show, Color ฯลฯ) ห้ามสร้างซ้ำ
  - `messages.th.ts`: `sensorView.noPosition` ("ดาว {satellite} ยังไม่มีตำแหน่ง ณ เวลานี้ (ยังไม่มีผลการคำนวณวงโคจร หรือเวลาอยู่นอกช่วงวิเคราะห์)"), `sensorView.limit` ("เปิด Sensor View พร้อมกันได้ไม่เกิน 4 หน้าต่าง ปิดบานใดบานหนึ่งก่อน"), `sensorView.closedMissing` ("ปิด Sensor View ของ {sensor} เพราะไม่มี sensor นี้ใน scenario แล้ว"), `sensorView.created` ("สร้าง {sensor} บน {satellite} (Cone Half Angle {angle}°)"), `insert.noSatellite` ("ต้องมีดาวใน scenario ก่อนจึงเพิ่ม Sensor ได้"), `ob.sensorCopyUnsupported` ("ยังคัดลอก Sensor ไม่ได้ในรุ่นนี้"), `sensorView.hudSubPoint` ("จุดใต้ดาว {lat}, {lon}"), `sensorView.hudAltitude` ("ความสูง {alt} km"), `sensorView.hudCone` ("Cone Half Angle {angle}°")

- [ ] **Step 1: แก้ test ให้ fail ก่อน**: labels.test รู้จักส่วน A–G (ตอนนี้แถวของ §G ถูกนับรวมใน §F เงียบ ๆ) และ test ใหม่ `sensor labels exist verbatim in STK ref §G` วนทุกคีย์ `stk(..., "G")` ข้างบน
- [ ] **Step 2: รัน** — `npx vitest run tests/unit/labels.test.ts tests/unit/stkreference.test.tsx` Expected: FAIL
- [ ] **Step 3: เพิ่ม `"G"` ใน `Section` คีย์และข้อความตาม Interfaces**
- [ ] **Step 4: รันให้ผ่าน + `npm test` + typecheck**
- [ ] **Step 5: Commit** — `feat(gnss-studio): STK sensor terms and Thai sensor messages`

---

### Task 4: Object Browser, เมนูตามชนิด object และ Zoom To

**Files:**
- Modify: `web/src/stores/scenario.ts` (`TreeObject` L30-36), `web/src/windows/ObjectBrowser/tree.ts`, `ObjectBrowser.tsx` (`CLASS_ICONS` L43, context menu L350-358), `objectCommands.ts` (L76-77), `web/src/chrome/menus.ts` (`OBJECT_MENU` L57-63, `CLASS_LABELS` L82-87), `web/src/chrome/MenuBar.tsx` (L25), `web/src/cesium/colors.ts` (`objectBoxColor` L116), `web/src/windows/Graphics3D/commands3d.ts` (`isZoomable` L13, `object.zoomTo` L31-37)
- Test: `web/tests/unit/object-tree.test.ts`, `object-browser.test.tsx`, `menubar.test.tsx`, `g3d.test.ts`

**Interfaces:**
- Consumes: ต้นไม้ของ Task 1 (`children` ของโหนดดาว), คีย์ของ Task 3
- Produces:
  - `TreeObject.class` รวม `"Sensor"` และ `children?: TreeObject[]`
  - `isSensor(row: Row): boolean` ใน `tree.ts`; แถว sensor มี `depth` = ของดาว + 1, `parentKey` = path ของดาว; ดาวที่มี sensor `expandable: true`
  - `objectMenuFor(cls: RowClass | undefined): MenuEntry[]` ใน `menus.ts` (Sensor: Properties, Access... (ปิดใช้แบบของดาว), Zoom To, Rename, Delete) ใช้ทั้งแถบเมนูและคลิกขวาใน Object Browser — Task 7 เพิ่ม Sensor View ใน Satellite และ Sensor
  - `parentOf(path: string): string | null` (ใน `stores/scenario.ts` อ่านจาก doc): path ของดาวแม่ของ sensor

- [ ] **Step 1: เขียน test ที่ fail**
  - object-tree: `sensor rows nest under their satellite` (depth, parentKey, ลำดับ), `collapsing a satellite hides its sensors`, `satellite without sensors is not expandable`, กล่องสีของ sensor = `graphics2d.color`
  - object-browser: แถว Sensor มีไอคอนของตัวเอง; คลิกขวาที่ sensor มี Properties, Access..., Zoom To, Rename, Delete; Copy/Cut ของ sensor ปิดใช้พร้อม tooltip `ob.sensorCopyUnsupported`; Delete sensor เรียก `remove("Sensor", name)`
  - menubar: เลือก sensor แล้วเมนูชื่อ "Sensor" มีรายการตามข้างบน; เลือกดาว/Facility รายการเหมือนเดิม
  - g3d: `object.zoomTo` กับ `*/Sensor/S1` เรียก `zoomTo("*/Satellite/G01")` (parent) และ enabled
- [ ] **Step 2: รันให้เห็นว่า fail** — `npx vitest run tests/unit/object-tree.test.ts tests/unit/object-browser.test.tsx tests/unit/menubar.test.tsx tests/unit/g3d.test.ts`
- [ ] **Step 3: ทำตาม Interfaces** (ไอคอน Lucide ที่มีอยู่แล้วในแพ็กเกจ เช่น `Radar`)
- [ ] **Step 4: รันให้ผ่าน + `npm test` + typecheck**
- [ ] **Step 5: Commit** — `feat(gnss-studio): sensors in the Object Browser and object menus`

---

### Task 5: Properties Browser และ Insert ของ Sensor

**Files:**
- Create: `web/src/windows/PropertiesBrowser/pages/SensorPages.tsx`, `web/src/windows/InsertObjects/SelectObjectDialog.tsx`
- Modify: `web/src/windows/PropertiesBrowser/form.ts` (`ObjectClass` L20, `OBJECT_SPECS` L140-168), `PropertiesBrowser.tsx` (`OBJECT_PAGES` L29, `isObjectClass` L30), `web/src/windows/InsertObjects/insert.ts` (`InsertClass` L7), `InsertObjects.tsx` (`CLASSES` L22, `insert()` L65-87), `DefinePropertiesDialog.tsx` (`FORMS` L49-67), `web/src/chrome/menus.ts` (`INSERT_MENU`), `web/src/windows/dataCommands.ts` (L27-39), `web/src/commands.ts` (`COMMAND_LABELS`: `insert.sensor`)
- Test: `web/tests/unit/properties.test.tsx`, `form.test.ts`, `insert.test.tsx`

**Interfaces:**
- Consumes: SensorObj (Task 1), คีย์ Task 3, `parentOf` (Task 4)
- Produces:
  - `SENSOR_PAGES: PageDef[]` 5 หน้าตามตาราง spec §5.2 (ค่าที่มีค่าเดียวแสดงด้วย `ReadOnlyRow`; Parent อ่านอย่างเดียวในหน้า Basic - Description)
  - `OBJECT_SPECS.Sensor`: ขอบเขตตัวเลขเท่ากับ schema (Cone Half Angle (0, 90], Azimuth [0, 360), Elevation [−90, 90], % Translucency จำนวนเต็ม [0, 100])
  - `SelectObjectDialog` (ชื่อหน้าต่าง `window.selectObject`): รายการดาวใน scenario เลือกได้หนึ่งตัว ค่าเริ่มต้น = ดาวที่เลือกอยู่ หรือดาวแม่ของ sensor ที่เลือกอยู่ หรือดาวตัวแรก; OK คืน path, Cancel คืน null
  - คำสั่ง `insert.sensor` → `openPanel("insertObjects", {cls: "Sensor", seq})`

- [ ] **Step 1: เขียน test ที่ fail**
  - properties: `sensor pages render the STK fields` (5 หน้า ชื่อตาม Task 3), `apply sends the edited cone half angle` (patch `{basic: {definition: {cone_half_angle: 13.9}}}`), `cone half angle 91 is rejected in red with a Thai message`, `parent is read only`
  - insert: `Insert Default for a sensor asks for the parent in Select Object` (เลือก G01 อยู่ → preselect G01 → OK → `insert({class:"Sensor", method:"Insert Default", parent:"*/Satellite/G01"})` แล้วเลือก object ใหม่), `Cancel in Select Object inserts nothing`, `Define Properties for a sensor sends name, parent and cone half angle` (ชื่อตั้งต้น = `Sensor<n>` ตัวแรกที่ว่าง, cone 45), `no satellites disables the sensor methods with the Thai reason`
  - เมนู Insert มี Sensor... ต่อจาก Satellite...
- [ ] **Step 2: รันให้เห็นว่า fail** — `npx vitest run tests/unit/properties.test.tsx tests/unit/form.test.ts tests/unit/insert.test.tsx`
- [ ] **Step 3: ทำตาม Interfaces** (ใช้แบบของ `SatellitePages.tsx` และ `FORMS` เดิม)
- [ ] **Step 4: รันให้ผ่าน + `npm test` + typecheck**
- [ ] **Step 5: Commit** — `feat(gnss-studio): sensor properties pages and insert flow`

---

### Task 6: กรวยและรอยของ sensor ในหน้าต่าง 3D และ 2D

**Files:**
- Create: `web/src/cesium/sensorDraw.ts` (ไม่ import Cesium)
- Modify: `web/src/windows/Graphics3D/scene3d.ts` (แบบ `drawInertial` L265-305, `restyle` L182-195, `onTime` L210), `web/src/windows/Graphics3D/registry.ts` (`Scene3DHandle`), `web/src/windows/Graphics2D/scene2d.ts` (`drawOverlays` L309-350, `overlayCounts` L422), `web/src/windows/Graphics2D/registry2d.ts`, `web/src/cesium/overlay2d.ts`, `web/src/cesium/testHooks.ts`
- Test: `web/tests/unit/sensor-draw.test.ts`, `overlay2d.test.ts`, `g3d.test.ts`

**Interfaces:**
- Consumes: `bodyFrame`, `boresightOf`, `sensorFootprint`, `isNadir`, `nadirCentralAngleRad` (Task 2), `SensorObj` (Task 1)
- Produces:
  - `interface SensorDrawState { sensor: SensorObj; pos: Vec3; frame: BodyFrame; boresight: Vec3; footprint: SensorFootprint; nadir: boolean; centralAngleRad: number | null }`
  - `sensorDrawState(sensor: SensorObj, p: Vec3 | null, pPrev: Vec3 | null, pNext: Vec3 | null): SensorDrawState | null` — ความเร็วตาม P9 (ผลต่างตำแหน่ง ±1 s) ไม่มี p หรือคำนวณกรอบไม่ได้ → null
  - `sensorItems(states: SensorDrawState[], style): { lines: LineItem[]; fills: FillItem[] }` ใน `overlay2d.ts` (fill เฉพาะ `graphics2d.fill && nadir` ตาม P2, alpha = 1 − fill_translucency/100)
  - `Scene3DHandle.sensorFootprintPoints(name: string): number | null`, `Scene2DHandle.sensorFootprintPoints(name: string): number | null`
  - test hook `sensorFootprint(name: string, view: "3d" | "2d"): number | null`

- [ ] **Step 1: เขียน test ที่ fail**
  - sensor-draw: `sensorDrawState returns null without a position`, `velocity uses the two-sided difference`, `one-sided at the edge of the data`, `boresight follows the pointing page`
  - overlay2d: `sensor outline is drawn in the sensor color`, `fill only for a nadir sensor with Fill on and alpha from % Translucency`, `hidden sensor or hidden parent draws nothing`
  - g3d: hook `sensorFootprint` ส่งต่อไปที่ handle ของหน้าต่าง 3D/2D ตัวแรก
- [ ] **Step 2: รันให้เห็นว่า fail** — `npx vitest run tests/unit/sensor-draw.test.ts tests/unit/overlay2d.test.ts tests/unit/g3d.test.ts`
- [ ] **Step 3: ทำ `sensorDraw.ts` และ `sensorItems`**
- [ ] **Step 4: วาดใน scene3d**: entity ใน `viewer.entities` id `sensor/<name>/ring`, `sensor/<name>/radial/<i>` (P6), `sensor/<name>/marker` (Show Boresight Marker = จุดที่ boresightHit) ตั้งค่าด้วย `ConstantProperty` ระหว่าง suspend/resumeEvents คำนวณใหม่ผ่าน Throttle 250 ms เมื่อเวลาเปลี่ยนและใน `restyle`; ซ่อนตาม spec §5.3; ตำแหน่ง p, p(t−1 s), p(t+1 s) จาก `entity.position.getValueInReferenceFrame(..., ReferenceFrame.FIXED)` ของ entity ดาวแม่ (`entityForPath(parent)`)
- [ ] **Step 5: วาดใน scene2d** ผ่าน `overlays.setLines("sensorEdge", …)` / `setFills("sensor", …)` ในรอบเดียวกับ Swath
- [ ] **Step 6: รันให้ผ่าน + `npm test` + typecheck** แล้วเปิด `npm run dev` ดูด้วยตาว่ากรวยของ G01 ชี้ลงโลกและรอยเดินตามเวลา (บันทึกสิ่งที่เห็นใน report)
- [ ] **Step 7: Commit** — `feat(gnss-studio): draw sensor cones and footprints in 3D and 2D`

---

### Task 7: หน้าต่าง Sensor View และคำสั่ง Sensor View

**Files:**
- Create: `web/src/windows/SensorView/SensorView.tsx`, `commands.ts`, `track.ts`, `registry.ts`
- Modify: `web/src/layout/panels.ts` (`PANEL_KINDS`, `BASE`), `web/src/windows/Graphics3D/scene3d.ts` (View kind ใหม่ `sensor`, `release()`), `web/src/commands.ts` (`object.sensorView`), `web/src/chrome/menus.ts` (`objectMenuFor`), `web/src/cesium/testHooks.ts`, `web/src/App.tsx` (register), `web/src/theme.css`
- Test: `web/tests/unit/sensor-view.test.tsx`, `layout.test.tsx` (รายการ persisted/scenarioBound L98-111), `commands.test.ts`, `menubar.test.tsx`

**Interfaces:**
- Consumes: Task 2 (`cameraOrientation`, `sensorViewFovDeg`, `defaultConeHalfAngleDeg`), Task 6 (`sensorDrawState`), `parentOf` (Task 4), `useThrottledTime`, `useSceneMount`
- Produces:
  - panel kind `"sensorView"`: params `{path: string; up: "north" | "velocity"}`, `singleton: true`, `instanceKey = params.path`, `type: "integrated"`, `persist: true`, `scenarioBound: true`, title จาก `window.sensorView` ด้วยชื่อ sensor และชื่อดาวแม่ปัจจุบัน
  - scene3d: `viewFromSensor(path: string, up: "north" | "velocity"): "ok" | "notFound"` — กล้องตาม spec §5.4 อัปเดตทุกครั้งที่เวลาเปลี่ยน, `screenSpaceCameraController.enableInputs = false`, `frustum.near = 1`, ซ่อนจุด/ป้ายของดาวแม่และ Radial Lines ของ sensor นี้ (P7), เปิดแสงกลางวัน/กลางคืน (P8)
  - `interface SensorHud { sensor: string; satellite: string; lat: number; lon: number; altKm: number; coneHalfAngle: number }`, handle `sensorHud(): SensorHud | null` (null = ไม่มีตำแหน่ง), `sensorCamera(): {position: [number, number, number]; direction: [number, number, number]; up: [number, number, number]; fovDeg: number} | null`
  - ทะเบียน `sensorViewScenes` แยกจาก `registry3d` (P3); test hook `sensorViewCamera(sensorName: string)` อ่านจากทะเบียนนี้
  - คำสั่ง `object.sensorView`: เปิดได้เมื่อ object ที่เลือกเป็น Satellite หรือ Sensor; Sensor → เปิดหน้าต่างของมัน; Satellite → sensor ตัวแรกของดาวในต้นไม้ ไม่มี → `insert({class:"Sensor", method:"Define Properties", name: <Sensor<n> ตัวแรกที่ว่าง>, parent, definition:{type:"Simple Conic", cone_half_angle: defaultConeHalfAngleDeg(<ตำแหน่ง ECEF ของดาวจาก firstScene()?.entityPositionEcef(ชื่อดาว) หรือ null>)}})` แล้วเลือก sensor ใหม่ รายงาน `sensorView.created` ใน Message Viewer และเปิดหน้าต่าง; บานที่ 5 (path ที่ยังไม่เปิด) → `sensorView.limit` ไม่เปิด
  - `track.ts`: ฟังต้นไม้ของ scenario: หน้าต่างที่ sensor ไม่มีแล้ว (ลบ, ดาวแม่ถูกลบ, workbook เก่า) ปิดพร้อม `sensorView.closedMissing`; ชื่อหน้าต่างคำนวณใหม่เมื่อดาวแม่เปลี่ยนชื่อ; rename ของ sensor (RenameDialog `onRenamed`) ย้าย params.path ไปชื่อใหม่
  - เมนู Satellite และ Sensor มี Sensor View (`objectMenuFor`)

- [ ] **Step 1: เขียน test ที่ fail** (handle ปลอมแบบ `g3d.test.ts`)
  - sensor-view: `opens one window per sensor`, `Up toggle stores north or velocity in the panel params`, `HUD shows the sub-point, altitude and cone half angle` (รูปแบบตัวเลข: lat/lon ทศนิยม 2 ตำแหน่ง, ความสูง km ทศนิยม 0, มุมทศนิยม 1), `shows the no-position message` (sensorHud() = null → ข้อความ `sensorView.noPosition`), `fifth window is refused with a message`, `sensor view closes when its sensor disappears`, `sensor view title follows a satellite rename`, `renaming the sensor keeps the window`, `workbook sensor view for a missing sensor is closed with a message`
  - commands: `Sensor View on a satellite without sensors creates Sensor1 with the default cone half angle` (ตำแหน่ง GPS → 14.4), `without a 3D position the new sensor gets 45`, `Sensor View on a satellite with sensors opens the first one`, `disabled for Facility and Constellation`
  - layout: `sensorView` อยู่ในรายการ persisted และ scenarioBound
- [ ] **Step 2: รันให้เห็นว่า fail** — `npx vitest run tests/unit/sensor-view.test.tsx tests/unit/commands.test.ts tests/unit/layout.test.tsx tests/unit/menubar.test.tsx`
- [ ] **Step 3: ทำ scene3d โหมด sensor + handle** แล้ว **Step 4: ทำหน้าต่าง คำสั่ง track และ test hook**
- [ ] **Step 5: รันให้ผ่าน + `npm test` + typecheck** แล้วเปิด `npm run dev` ดูว่า Sensor View ของ G01 เห็นโลกทั้งดวงตรงกลางภาพและหมุนตามเวลา (บันทึกใน report)
- [ ] **Step 6: Commit** — `feat(gnss-studio): Sensor View window`

---

### Task 8: คลิกเลือกและเมนูคลิกขวาบนดาวในหน้าต่าง 3D

**Files:**
- Modify: `web/src/windows/Graphics3D/scene3d.ts` (handler L124-127, `dragStart/End` L454-467), `registry.ts`, `Graphics3D.tsx` (ห่อ host ด้วย `CommandContextMenu` แบบ Object Browser L350-358), `web/src/cesium/graphics.ts` (ส่งออกการแปลง entity id → path จาก `objectsByEntity` L266-277), `web/src/cesium/testHooks.ts`
- Test: `web/tests/unit/graphics3d-window.test.tsx`, `g3d.test.ts`, `scene-graphics.test.ts`

**Interfaces:**
- Produces:
  - `isClick(down: {x:number;y:number}, up: {x:number;y:number}, tolPx = 4): boolean`
  - `pathForEntityId(id: string, doc, prnByNorad): string | null` ใน `graphics.ts` (sensor entity → path ของ sensor ไม่ต้องเลือกได้: คืน null)
  - handle `pathAt(x: number, y: number): string | null` (scene.pick) — คลิกซ้ายที่ได้ path → `useSelection.select(path)` และ reveal ใน Object Browser; ไม่ได้ path → ไม่เปลี่ยนการเลือก
  - เมนูคลิกขวา: ดาว → Properties, Sensor View, Zoom To; Facility → Properties, Zoom To; ไม่โดน object → ไม่มีเมนู
  - test hook `entityScreenPosition(name: string): [number, number] | null` (พิกัดใน canvas ของหน้าต่าง 3D ตัวแรก)

- [ ] **Step 1: เขียน test ที่ fail**: `a drag is not a click` (เลื่อน 5 px), `click selects the picked satellite`, `click on empty space keeps the selection`, `right-click on a satellite shows Properties, Sensor View, Zoom To`, `right-click on a facility shows Properties, Zoom To`, `right-click on empty space shows no menu`, `pathForEntityId maps a renamed satellite by NORAD`
- [ ] **Step 2: รันให้เห็นว่า fail** — `npx vitest run tests/unit/graphics3d-window.test.tsx tests/unit/g3d.test.ts tests/unit/scene-graphics.test.ts`
- [ ] **Step 3: ทำตาม Interfaces** (โหมด Zoom In ยังทำงานเหมือนเดิม: คลิกในโหมด Zoom In ไม่เลือก object)
- [ ] **Step 4: รันให้ผ่าน + `npm test` + typecheck**
- [ ] **Step 5: Commit** — `feat(gnss-studio): pick satellites in the 3D window`

---

### Task 9: e2e, ตัวตรวจ request ออกนอกเครื่อง และ README

**Files:**
- Create: `web/tests/e2e/sensor.spec.ts`
- Modify: `web/tests/e2e/fixtures.ts`, `api-interop/gnss-predict/README.md` (หัวข้อของหน้าเว็บ)

**Interfaces:**
- Consumes: test hook `sensorViewCamera`, `sensorFootprint`, `entityPositionEcef`, `entityScreenPosition`; helper เดิม `openScenario`, `treeRow`, `openObjectProperties`, `propertiesWindow`, `saveScenario`

- [ ] **Step 1: ตัวตรวจ request (P5)**: ใน fixture อัตโนมัติของ `fixtures.ts` เก็บทุก request ของ page ถ้ามี URL ที่ไม่ใช่ `http://127.0.0.1:8766`, `data:` หรือ `blob:` ให้ test fail พร้อมรายการ URL รัน `npm run e2e` ทั้งชุดเดิมต้องผ่าน (ถ้าชุดเดิมพังเพราะตัวตรวจนี้ แปลว่าพบปัญหาจริง ให้รายงาน)
- [ ] **Step 2: เขียน `sensor.spec.ts`** (scenario `E2E` คืนค่าเดิมด้วย `saveScenario` หลังแต่ละ test)
  - `Sensor View from the satellite menu looks at the Earth centre`: เลือก G01 → เมนู Satellite → Sensor View → หน้าต่าง "Sensor View - Sensor1 (G01)"; `sensorViewCamera("Sensor1").position` ห่างจาก `entityPositionEcef("G01")` ≤ 1 m; มุมระหว่าง direction กับ −position ≤ 0.01°
  - `changing Cone Half Angle changes the view and the footprint`: Properties ของ Sensor1 → Cone Half Angle 5 → Apply → fovDeg ด้านสั้น 10.5 (คำนวณจากขนาดหน้าต่าง), `sensorFootprint("Sensor1","3d")` และ `"2d"` > 0
  - `right-click on a satellite in 3D opens Sensor View`: คลิกขวาที่ `entityScreenPosition("G02")` → Sensor View → หน้าต่างที่สองเปิด
  - `deleting the satellite closes its Sensor View`: Delete G01 → หน้าต่าง Sensor View ของ Sensor1 ปิด ต้นไม้ไม่มี Sensor1
  - `Sensor View without results shows the Thai message` (`E2E_NORES`): ข้อความ `sensorView.noPosition` ขึ้น ไม่มี page error
- [ ] **Step 3: รัน** — `cd web && npm run e2e` Expected: ผ่านทั้งหมด (perf ข้ามตามเดิม)
- [ ] **Step 4: README**: หัวข้อภาษาไทยเรื่อง Sensor (Insert, Properties, Sensor View, ค่า Cone Half Angle ตั้งต้น, ข้อจำกัดใน spec §2)
- [ ] **Step 5: รันชุดทั้งหมด**: web `npm test` + typecheck + e2e, server pytest `-W error`, engine `cd .. && python3 -m unittest discover -s tests` Expected: ผ่านทั้งหมด
- [ ] **Step 6: Commit** — `test(gnss-studio): sensor e2e, offline request guard and README`
