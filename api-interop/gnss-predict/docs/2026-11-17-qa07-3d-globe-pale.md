# รายงานวิเคราะห์สาเหตุ QA-07: ลูกโลกในหน้าต่าง `3D Graphics` ดูซีด/สว่างกว่า `2D Graphics`

- **วันที่ตรวจ**: 2026-11-17
- **เป้าหมายที่ทดสอบ**: `http://127.0.0.1:8020` (ฉาก `acc_20261111`)
- **โค้ดที่อ่าน**: `web/src/cesium/viewer.ts`, `web/src/cesium/imageryLayers.ts`, `web/src/windows/Graphics3D/scene3d.ts`, `web/src/windows/Graphics2D/scene2d.ts`

---

## 1. ผลการเปรียบเทียบ 3D vs 2D บน `:8020`

จากการเปิด `acc_20261111` และดูค่า Globe Manager (อ่านอย่างเดียว) พร้อมภาพเปรียบเทียบ 3D กับ 2D ณ เวลา `11 Nov 2026 00:00:00.000 UTCG`:
- **Globe Manager บน `:8020`**:
  - สวิตช์เปิดอยู่ทั้ง 4 แหล่ง (`NASA GIBS`, `Sentinel-2 cloudless`, `OpenStreetMap`, `Cesium ion`)
  - ชั้นที่ติ๊ก `Show` (`Translucency 0`): `Blue Marble`, `VIIRS NOAA-20 True Color`, `Sentinel-2 cloudless 2024`, `OpenStreetMap` (ส่วน `Cesium ion` ไม่ได้เลือก asset จึงไม่แสดง)
- **ภาพที่เห็นจริง**:
  - **หน้าต่าง `3D Graphics 1 - Earth`** (มุมล่างแสดงเครดิต `CESIUM ion © OpenStreetMap contributors`): ลูกโลกมีสีฟ้าอ่อน/ครีมอ่อนซีดจาง
  - **หน้าต่าง `2D Graphics 1 - Earth`** (มุมล่างแสดงเครดิต `CESIUM ion` เท่านั้น): แผนที่โลกเป็นสีน้ำเงินเข้ม/เขียวเข้มชัดเจน

---

## 2. สาเหตุหลักจากโค้ด (`file:line`)

1. **3D และ 2D ใช้ชุดชั้นภาพคนละตัวกัน (สาเหตุหลัก)**:
   - [scene3d.ts:346](file:///Users/phuwish/SSSGMAT/.worktrees/gnss-studio-imagery/api-interop/gnss-predict/web/src/windows/Graphics3D/scene3d.ts#L346) เรียก `attachImageryLayers(viewer, ...)` ทำให้หน้าต่าง 3D แสดงชั้นภาพออนไลน์ตาม `Globe Manager` โดยใน [imageryLayers.ts:213, 225-240](file:///Users/phuwish/SSSGMAT/.worktrees/gnss-studio-imagery/api-interop/gnss-predict/web/src/cesium/imageryLayers.ts#L213-L240) `OpenStreetMap` มี `SOURCE_ORDER["osm"] = 2` (อยู่บนสุด) และเป็นชั้นทึบ (`isOpaqueLayer = true`) จึงบัง `Blue Marble`, `VIIRS` และ `Sentinel-2` ทั้งหมด — **3D จึงแสดงแผนที่ OpenStreetMap** ซึ่งระดับซูมโลกมีโทนสีพาสเทลอ่อน (`#aad3df` / `#f2efe9`) อยู่แล้ว
   - ในทางกลับกัน **2D (`scene2d.ts`) ไม่ได้เรียก `attachImageryLayers`** จึงแสดงเฉพาะ `NaturalEarthII` ([viewer.ts:40-42](file:///Users/phuwish/SSSGMAT/.worktrees/gnss-studio-imagery/api-interop/gnss-predict/web/src/cesium/viewer.ts#L40-L42)) ซึ่งเป็นภาพถ่ายดาวเทียมโทนสีเข้มกว่ามาก
2. **Ground Atmosphere ของ Cesium ในโหมด 3D (`showGroundAtmosphere` & `dynamicAtmosphereLighting`)**:
   - ใน [viewer.ts:58-82](file:///Users/phuwish/SSSGMAT/.worktrees/gnss-studio-imagery/api-interop/gnss-predict/web/src/cesium/viewer.ts#L58-L82) และ [scene3d.ts:714-732](file:///Users/phuwish/SSSGMAT/.worktrees/gnss-studio-imagery/api-interop/gnss-predict/web/src/windows/Graphics3D/scene3d.ts#L714-L732) ไม่ได้ปิด `scene.globe.showGroundAtmosphere` (ค่าเริ่มต้นใน Cesium 3D คือ `true`) และ `scene.globe.dynamicAtmosphereLighting` (ค่าเริ่มต้น `true`) ขณะที่โหมด 2D ไม่วาด Ground Atmosphere
   - เมื่อมองโลกจากระยะวงโคจร (~20,000–100,000 km) ขณะที่ `enableLighting = false` (ค่าเริ่มต้นของ `DEFAULT_PROPS_3D`) Cesium จะวาดแสงกระเจิงบรรยากาศสีฟ้า-ขาวทับทั่วทั้งลูกโลก ทำให้ภาพบนผิวโลกยิ่งซีดจางลงเมื่อเทียบกับ 2D
3. **ค่า Brightness / Gamma ของชั้นภาพและ HDR**:
   - [imageryLayers.ts:373-376](file:///Users/phuwish/SSSGMAT/.worktrees/gnss-studio-imagery/api-interop/gnss-predict/web/src/cesium/imageryLayers.ts#L373-L376) ตั้งเฉพาะ `alpha`, `dayAlpha = 1`, `nightAlpha` ไม่ได้ปรับ `brightness` / `gamma` (ใช้ค่าเริ่มต้น `1.0`); `highDynamicRange` เป็น `false` ตามค่าเริ่มต้นของ Cesium 1.147

---

## 3. แนวทางแก้ไขที่เป็นไปได้และผลข้างเคียง

| แนวทาง | ค่าที่ต้องแก้ | ผลข้างเคียงที่ต้องระวัง |
|---|---|---|
| **1. ลด/ปิด Ground Atmosphere บนโลก 3D** | ใน `viewer.ts` (`mode === "3d"`) หรือ `scene3d.ts`: ตั้ง `scene.globe.showGroundAtmosphere = false` หรือลด `scene.globe.atmosphereLightIntensity` / `atmosphereBrightnessShift` (เช่น `-0.2`) | ขอบโลก (limb) จะไม่มีแสงบรรยากาศเรืองสีฟ้าอ่อนๆ ในมุมมองระดับต่ำ; ด้านกลางคืนของโลก (เมื่อเปิด `Enable Lighting`) จะไม่เปลี่ยนถ้าไม่แตะ `nightAlpha` |
| **2. ปรับ `brightness` / `gamma` ของชั้น OSM** | ใน `imageryLayers.ts` (`makeLayer`): สำหรับ `info.source === "osm"` ตั้ง `layer.brightness = 0.85` หรือ `layer.gamma = 1.15` | ช่วยให้แผนที่ OSM ใน 3D เข้มขึ้นใกล้เคียงแผนที่นำทาง แต่ในระดับซูมลึก (Sensor View ×1024+) ถนนและข้อความบน OSM จะมืดลงเล็กน้อย |
| **3. ปรับลำดับหรือให้ 2D แสดงชั้นเดียวกับ 3D** | จัด `Globe Manager` ให้ `OSM` เป็น optional ไม่ทับ `Blue Marble`/`Sentinel-2` หรือเชื่อม `attachImageryLayers` กับ 2D ด้วย | การเชื่อม 2D เข้ากับ `attachImageryLayers` จะเพิ่มคำขอ tile และหน่วยความจำ WebGL สำหรับหน้าต่าง 2D |
