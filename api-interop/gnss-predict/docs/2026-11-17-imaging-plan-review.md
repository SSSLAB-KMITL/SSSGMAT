# ตรวจแผนงาน ข2 (Imaging Satellites) แบบอิสระ

- **Spec**: `docs/2026-11-15-gnss-studio-imaging-satellites-design.md`
- **แผน**: `docs/2026-11-15-gnss-studio-imaging-satellites-plan.md` (Tasks 1–8 และ Plan rulings a–u)
- **โค้ดที่เทียบ**: `/Users/phuwish/SSSGMAT/.worktrees/gnss-studio-imagery/api-interop/gnss-predict` (`gnss_predict/`, `server/gnss_studio_server/`, `web/src/`)

---

## 1. ตารางข้อค้นพบ (เรียงตามความรุนแรง)

| รหัส | ระดับ | จุดที่พบ (`file:line`) | ข้อค้นพบ | ข้อเสนอแก้ |
|---|---|---|---|---|
| **R-01** | **สำคัญ** | `server/gnss_studio_server/schema.py:201`, Task 5, Task 6 (`form.ts:172`) | `SensorDefinition` กำหนด `cone_half_angle: float = Field(45.0, gt=0, le=90)` มีค่า default `45.0` ติดมาเสมอแม้เป็น `type="Rectangular"` แต่ Task 6 test (`properties`) ระบุว่า Simple Conic ห้ามส่ง `vertical_half_angle`/`horizontal_half_angle` ขณะที่ฝั่ง Rectangular จะยังมี `cone_half_angle: 45.0` ปนใน JSON ของ scenario และอาจทำให้ `form.ts` diff ค่าเกินถ้าไม่ได้ตัดตาม `type` | ใน `SensorDefinition` model validator หรือ serializer ให้ตรวจว่าเมื่อ `type == "Rectangular"` ค่า `cone_half_angle` เป็น `None` (หรือ ignore ตอนบันทึก/diff ใน `form.ts`) และเพิ่ม test ตรวจ payload ขาไปจาก `PropertiesBrowser` ของ Rectangular ด้วย |
| **R-02** | **สำคัญ** | `gnss_predict/imaging.py`, `templates.py:152`, Task 1 (`test_missing_is_tle_unavailable`), Ruling (b) | Ruling (b) ให้ `templates.load_catalog` (`templates.py:152`) เรียก `imaging.scenario_catalog(..., with_imaging=True)` เสมอ เมื่อรันบน snapshot ที่มีเฉพาะ GNSS (ไม่มี `weather.json`, `science.json`, `visual.json`) `build_imaging_catalog` จะหา 8 ดวงไม่เจอและใส่ `TLE_UNAVAILABLE` ลง `catalog.unmapped` 8 รายการ | ให้ `build_imaging_catalog` คืน `Catalog([], [], [])` ทันทีเมื่อ `imaging_group_files(snapshot_dir)` ว่าง (ไม่มีไฟล์กลุ่ม imaging ใน snapshot เลย) เพื่อไม่ให้ `unmapped` ของฉาก GNSS ล้วนปนรายการ imaging 8 ดวง |
| **R-03** | **สำคัญ** | `web/src/cesium/imageryLayers.ts:213, 225-242`, Task 7 (`showImagery.ts`) | `SOURCE_ORDER` วาง `gibs: 0`, `eox: 1`, `osm: 2` และ `shownLayers()` ตัดชั้นใต้ชั้นทึบบนสุด (`isOpaqueLayer`) ทิ้งทั้งหมด หากผู้ใช้เปิด `OpenStreetMap` หรือ `Sentinel-2 cloudless (EOX)` ค้างไว้แล้วกด `Show Imagery` บนดาว X (ซึ่งเปิดเฉพาะชั้น GIBS) ชั้น `OSM`/`EOX` จะบังภาพ GIBS มิดโดยไม่มีการแจ้งเตือนหรือซ่อนชั้นทับ | ใน `Show Imagery` หรือ `showImagery.ts` ควรตรวจสอบว่ามีชั้นทึบ (`eox` / `osm`) หรือ `ion` บังชั้น GIBS อยู่หรือไม่ และแจ้ง Message Viewer (ระดับ `info`) หรือปิด/สลับให้เห็นชั้น GIBS ของดาวนั้น |
| **R-04** | **สำคัญ** | `gnss_predict/studio.py:209` (`fetch_snapshot`), Ruling (q) | Ruling (q) ให้ `fetch_snapshot` คัดลอกไฟล์ `<group>_*.json` ล่าสุดใน `_cache` เข้า snapshot เสมอแม้สั่ง `systems="GREC"` หากผู้ใช้เคย fetch `weather`/`visual` ไว้นานแล้ว (>14 วัน) และไม่ได้ fetch ใหม่ snapshot ใหม่จะติดไฟล์เก่าไปด้วย ทำให้ `X01–X08` ติดธง `too_old` และออก `SAT_FLAGGED` | เพิ่มคำอธิบายใน `Fetch Orbit Data` / `Message Viewer` หรือแยกข้อความเตือนว่า snapshot ใช้ไฟล์ imaging เดิมจาก `_cache` ที่อายุเกินเกณฑ์ |
| **R-05** | **สำคัญ** | Spec §5.4 vs Ruling (n), `web/src/windows/SensorView/commands.ts:53` | Spec §5.4 ระบุว่า "ถ้าลบกล้องหลักไปแล้ว ใช้มุมมองจากดาวแบบเดิม" แต่ Ruling (n) เปลี่ยนเป็นให้เรียก `Sensor View` สาขาดาว (ซึ่งจะ **สร้าง `Sensor<n>` ใหม่** ลงใน scenario ด้วย `POST /objects` ไม่ใช่มุมมอง read-only) | อัปเดต Spec §5.4 ให้ตรงกับ Ruling (n) หรือปรับ `openSensorViewForSatellite` ให้ชัดเจนว่ามีการสร้าง `Sensor<n>` เมื่อไม่มีเซนเซอร์ลูก |
| **R-06** | **เล็ก** | `gnss_predict/dataproviders.py:204` (แผนอ้าง `:203`), `scene3d.ts:934` (แผนอ้าง `:939`) | เลขบรรทัดคลาดเคลื่อนเล็กน้อย 1–5 บรรทัด (`_load_access` อยู่ที่ `:204`, `sensorHud` เริ่มที่ `:934` บรรทัด `:939` อยู่ภายในฟังก์ชัน) ส่วน `SatelliteCatalog.tsx:305` (Name cell), `:206` (`insertObjects`), `SensorView.tsx:276,295` ตรงกับโค้ดจริง | ไม่กระทบการทำงาน อัปเดตเลขบรรทัดให้ตรงถ้าแก้ไขแผน |
| **R-07** | **เล็ก** | Task 2 / `gnss_predict/dop.py:77` | `dop_series` ใช้ `r.prn[0] in GNSS_GROUPS`; หากมี row ที่ `prn == ""` จะเกิด `IndexError` ควรใช้ `r.prn[:1] in GNSS_GROUPS` | ใช้ `r.prn[:1]` แทน `r.prn[0]` ใน `dop.py` และ `studio_validate.py` |

---

## 2. สรุปการตรวจประเด็นบังคับ (ก)–(จ)

| หัวข้อ | ผลการตรวจ |
|---|---|
| **(ก) ฉาก GNSS ล้วนต้องได้ hash/DOP/SP3 เดิมทุกไบต์** | **เพียงพอ (ยกเว้นจุด R-02)**: `_files_sha256` และ `_plan` แยก `with_imaging` ด้วย `IMAGING_NORADS` และมี `test_gnss_only_hash_is_pinned` ตรึงค่า literal ก่อนแก้โค้ด |
| **(ข) ดาวระบบ X ไม่หลุดเข้า DOP/Validation ทุกเส้นทาง** | **ครบทุกเส้นทางหลัก**: `dop_series` กรอง `GNSS_GROUPS`, `validate_ephemeris` ข้าม `X` ก่อนเทียบและไม่เพิ่มคีย์ใหม่, `dataproviders._load_access` เปลี่ยน `ipp_lat/ipp_lon/mf` เป็น `_optional` เพื่อไม่ให้ `float("")` พังเป็น `RESULT_CORRUPT` |
| **(ค) แกน Rectangular ตาม STK** | **ตรงกันทุก Task**: ตรวจ `sensorGeometry.ts:79-90` (`bodyFrame`) ยืนยัน `+Z` = nadir, `+X` = along-track, `+Y` = cross-track ตรงกับ Ruling (g) (`Horizontal` = XZ = along-track, `Vertical` = YZ = cross-track) และเลขตรวจ ±13.723826° (3,052 km) ถูกต้อง |
| **(ง) ไม่มี test ใดเรียกเน็ตจริง** | **ปลอดภัย**: ใช้ fixture ใน `tests/fixtures/studio/imaging/*.json` (`SOURCES.md`), FakeGmat + `--sp3` ใน engine, `localRequest.ts` ใน e2e; **ข้อควรระวัง**: E2E/unit test ต้องไม่แตะ `data/` จริง |
| **(จ) ช่องโหว่ที่ไม่มี task ไหนครอบ** | (1) `Show Imagery` ขณะเปิด `OSM`/`EOX` ทึบทับอยู่ข้างบน (R-03) (2) ยังไม่มี UI ให้ผู้ใช้เลือก `systems="GRECX"` ใน `FetchOrbitData.tsx` (ตาม spec §2/§3.3 ที่คงปุ่มเดิมไว้) (3) การแสดงสถานะ `cell_normal` ของโมเดลทั้ง 8 ดวงใน `models/catalog.json` (ต้องตรวจให้ครบหลังรวม branch) |
