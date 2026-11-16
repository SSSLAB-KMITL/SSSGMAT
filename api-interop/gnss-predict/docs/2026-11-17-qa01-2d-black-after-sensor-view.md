# รายงานวิเคราะห์สาเหตุ QA-01: หน้าต่าง `2D Graphics` กลายเป็นจอดำหลังเปิด `Sensor View`

- **วันที่ตรวจ**: 2026-11-17
- **เป้าหมายที่ทดสอบ**: `http://127.0.0.1:8020` (ฉาก `acc_20261111`, โค้ดรุ่นก่อน `a7d6f19`)
- **โค้ดที่อ่าน**: `/Users/phuwish/SSSGMAT/.worktrees/gnss-studio-imagery/api-interop/gnss-predict/web/src`

---

## 1. ผลการทำซ้ำบน `http://127.0.0.1:8020` (Playwright headed)

| รอบทดสอบ | ลำดับขั้นตอน | ผลลัพธ์บน `2D Graphics 1 - Earth` | Console / WebGL Events |
|---|---|---|---|
| **รอบ QA หลัก (`qa_explore.mjs`)** | เปิด `acc_20261111` → โฟกัส `3D` + คลิกกลางจอ → โฟกัส `2D` (`08_2d_graphics.png` ปกติ) → โฟกัส `Timeline` + กด `Step Forward` 2 ครั้ง (`09b_timeline_stepped.png` ปกติ) → คลิกขวา `Sensor2 (C13)` เปิด `Sensor View` | **จอดำสนิท** (เหลือเฉพาะโลโก้ `CESIUM ion`) ใน `11_sensor_view_s2.png` และค้างดำต่อเนื่องผ่าน `12_globe_manager.png`, `13_g3d_properties.png`, `15_message_viewer.png` (> 5 วินาที) | `console.error = 0`, `pageerror = 0`, ไม่มี `SCENE_RENDER` |
| **รอบทำซ้ำเฉพาะทาง (`qa_repro_qa01.mjs`)** | เปิด `acc_20261111` → โฟกัส `2D` → โฟกัส `Timeline` + `Step Forward` 2 ครั้ง → เปิด `Sensor2` → เปิด `Sensor3` → คลิกแท็บ `2D` | **แสดงผลปกติ** (ไม่ดำ) | `console.error = 0`, `webglcontextlost = 0` ระหว่างใช้งาน (`webglcontextlost` เกิดเฉพาะ 2 ครั้งตอน `context.close()` จาก `destroyViewer`) |

- **สรุปลักษณะการเกิด**: เป็นอาการ **Timing-dependent / Intermittent** เมื่อเปิด `Sensor View` ครั้งแรกแล้ว Dockview แบ่งคอลัมน์ทำให้หน้าต่าง `2D Graphics` ถูกบีบขนาด (`590px` → `393px`) พร้อมกับการสร้าง Cesium 3D Viewer ตัวใหม่ใน `Sensor View`
- **ค่า `window.__gnssStudioTest`**: บน build ที่รันอยู่ `:8020` คืน `null` (ไม่ได้เปิด test hooks ใน production build)

---

## 2. การวิเคราะห์โค้ดและสาเหตุที่น่าจะเป็น (`file:line`)

### จุดที่ 1: WebGL `preserveDrawingBuffer: false` + `requestRenderMode: true` + `viewer.resize()` แบบ Synchronous ใน Dockview
1. **[cesium/viewer.ts:58-82](file:///Users/phuwish/SSSGMAT/.worktrees/gnss-studio-imagery/api-interop/gnss-predict/web/src/cesium/viewer.ts#L58-L82)**:
   - `createViewer()` สร้าง Cesium `Viewer` โดยตั้ง `requestRenderMode: true` และ `maximumRenderTimeChange: Number.POSITIVE_INFINITY` (บรรทัด `77-78`) และไม่ได้ตั้ง `preserveDrawingBuffer: true` (ค่าเริ่มต้นของ WebGL คือ `false`)
   - เมื่อ `requestRenderMode: true` ทำงาน หากไม่มีใครเรียก `scene.requestRender()` (หรือ `scene.render()` ไม่ได้วาดหลัง buffer ถูกเคลียร์) หน้าจอจะค้างสภาพที่เคลียร์ไว้เป็นสีดำ `#000000` จนกว่าจะมีเหตุการณ์ใหม่ (เช่น กดเวลา หรือลากเมาส์)
2. **[stores/layout.ts:292-304](file:///Users/phuwish/SSSGMAT/.worktrees/gnss-studio-imagery/api-interop/gnss-predict/web/src/stores/layout.ts#L292-L304)** และ **[windows/graphics/GraphicsFrame.tsx:184](file:///Users/phuwish/SSSGMAT/.worktrees/gnss-studio-imagery/api-interop/gnss-predict/web/src/windows/graphics/GraphicsFrame.tsx#L184)**:
   - `usePanelResize` ผูกกับ `panel.api.onDidDimensionsChange` ของ Dockview เท่านั้น ไม่ได้ใช้ `ResizeObserver` บน DOM element จริง (`host.current`)
3. **[windows/Graphics2D/scene2d.ts:466-470](file:///Users/phuwish/SSSGMAT/.worktrees/gnss-studio-imagery/api-interop/gnss-predict/web/src/windows/Graphics2D/scene2d.ts#L466-L470)**:
   - `resize()` เรียก `this.viewer.resize()` ตามด้วย `this.viewer.scene.requestRender()`
   - **กลไกที่ทำให้จอดำ**: เมื่อ `Sensor View` เปิดและ Dockview แบ่งคอลัมน์:
     - `this.viewer.resize()` เปลี่ยน `canvas.width` / `canvas.height` ซึ่ง **ล้าง WebGL drawing buffer เป็นดำทันที**
     - หาก `onDidDimensionsChange` ยิงก่อน CSS layout/DOM ของ `Sensor View` เสร็จสมบูรณ์ (เช่น `<SensorViewBar />` หรือ tab header ทำให้ขนาด container เปลี่ยนซ้ำใน frame ถัดไปโดยไม่มี `onDidDimensionsChange` รอบใหม่) หรือ browser/Cesium วาด frame ระหว่างที่ `clientWidth`/`clientHeight` กำลังเปลี่ยน: `CesiumWidget.resize()` ใน frame ถัดไปจะปรับ `canvas.width`/`height` (ล้าง buffer เป็นดำอีกครั้ง) โดยที่ `scene._renderRequested` ถูกใช้ไปแล้วใน frame ก่อนหน้า จึง **ไม่วาดใหม่** และค้างจอดำถาวรจนกว่าจะมี `requestRender()` ใหม่
4. **[cesium/idleUpdates.ts:92-98](file:///Users/phuwish/SSSGMAT/.worktrees/gnss-studio-imagery/api-interop/gnss-predict/web/src/cesium/idleUpdates.ts#L92-L98)**:
   - `skipIdleDisplayUpdates` ข้าม `dataSourceDisplay.update(time)` เมื่อเวลาและ entity ไม่เปลี่ยน ซึ่งช่วยลด CPU แต่ไม่ได้เป็นตัวทำให้ globe/imagery ดำ (ปัญหาอยู่ที่ `scene.render()` ไม่ถูกเรียกซ้ำหลัง buffer ของ canvas ถูกล้าง)

---

## 3. ความแตกต่างระหว่าง `:8020` (ก่อน `a7d6f19`) กับ `HEAD` ปัจจุบัน

จากการตรวจ `git diff a7d6f19^..HEAD` ใน worktree `gnss-studio-imagery`:
- `cesium/viewer.ts`, `cesium/idleUpdates.ts`, `windows/graphics/GraphicsFrame.tsx`, `stores/layout.ts` และ `windows/SensorView/*` **เหมือนกันทุกประการ** (ไม่มีการแก้เรื่อง resize หรือ `requestRenderMode`)
- ความแตกต่างเดียวใน `windows/Graphics2D/scene2d.ts` คือ commit `a7d6f19` และ `f332470` เพิ่ม `HighlightIntervals` (`syncHighlights`, `applyHighlights`, `highlightsArrived`) จำนวน 40 บรรทัด ดังนั้น **ปัญหา QA-01 ยังสามารถเกิดได้ใน `HEAD` เช่นเดียวกัน**

---

## 4. วิธีพิสูจน์และ Test ที่ควรเขียน

1. **เพิ่ม `ResizeObserver` บน `host` (`GraphicsFrame.tsx`) หรือ `requestAnimationFrame` หลัง `resize()`**:
   - ใน `scene2d.ts:resize()` (และ `scene3d.ts:resize()`), นอกจากการเรียก `this.viewer.resize(); this.viewer.scene.requestRender();` ทันทีแล้ว ควรผูก `ResizeObserver` กับ `el` (`host.current`) เพื่อเรียก `resize()` + `requestRender()` เมื่อขนาด DOM จริงของ canvas เปลี่ยน (ครอบคลุมกรณีที่ Dockview `onDidDimensionsChange` ยิงก่อน CSS layout นิ่ง)
2. **Test ที่ควรเขียน**:
   - **Unit test (`tests/unit/graphics-frame.test.tsx` / `scene2d`)**: จำลอง `ResizeObserver` บน `host` container ให้เปลี่ยนขนาดโดยไม่ผ่าน `onDidDimensionsChange` แล้วตรวจว่า `handle.resize()` ถูกเรียกและตามด้วย `scene.requestRender()`
   - **E2E Playwright test**: เปิดฉากที่มี `2D Graphics`, สลับแท็บ `Timeline` → กด `Step Forward` → เปิด `Sensor View` สองบานติดกัน แล้วตรวจอ่านพิกเซลบน canvas ของ `2D Graphics` (เช่น ใช้ `canvas.toDataURL()` หรือ `readPixels` ผ่าน test hook) เพื่อยืนยันว่าค่า RGB เฉลี่ยไม่ใช่ `(0, 0, 0)` หลัง layout นิ่ง 500 ms
