# ผลตรวจคำและเมนูทางการของ STK: Scenario Context Menu และ 3D/2D Graphics Window Properties

- **วันที่**: 2026-11-17
- **แหล่งอ้างอิงหลัก**: เอกสารทางการของ Ansys/AGI STK (`help.agi.com/stk`) และบันทึกอ้างอิงเดิมใน `docs/2026-11-11-gnss-studio-stk-reference.md`

---

## 1. เมนูคลิกขวาใน Object Browser: Scenario vs Object (Satellite / Facility)

### 1.1 รายการที่ **ยืนยันตรงตัว** จากเอกสารทางการของ STK
- **การเปิดเมนู**: คลิกขวาที่ไอคอน **Scenario** (โหนดรากบนสุดใน Object Browser) หรือที่วัตถุลูก (เช่น Satellite, Facility) เพื่อเปิด shortcut (context) menu
  - แหล่งอ้างอิง: `https://help.agi.com/stk/Content/gettingstarted/GetStart_ObjectBrowser.htm`
- **เมนูคลิกขวาของ Scenario** มีคำสั่งที่ยืนยันตรงตัวว่ามีอยู่จริง:
  - `Properties` (เปิด Scenario Properties Browser)
  - `Report & Graph Manager...` (เปิด Report & Graph Manager สำหรับข้อมูลระดับ Scenario)
  - `Insert...` (เปิด Insert STK Objects เพื่อเพิ่มวัตถุลูกเข้า Scenario)
  - `Save` / `Save As...`
  - `Close Scenario`
  - `Set as Default Scenario`
  - แหล่งอ้างอิง: `https://help.agi.com/stk/Content/training/L1_ObjectProperties.htm`, `https://help.agi.com/stk/Content/stk/report.htm`, `https://help.agi.com/stk/Content/gettingstarted/GetStart_7_ScenarioOV.htm`
- **เมนูคลิกขวาของ Object (Satellite / Facility)** มีลำดับคำสั่งที่ยืนยันจากบทเรียนทางการ (`L1_AccessReports.htm`, `WhereisISS.htm`):
  1. `Properties`
  2. `Access...`
  3. `Report & Graph Manager...`
  4. `Zoom To` (ใช้กับ 3D Graphics เท่านั้น)
  5. `Rename`
  6. `Delete`
  7. `Analysis Workbench...`
  8. `*(class submenu)*` (เช่น `Satellite`, `Facility`)
  - แหล่งอ้างอิง: `https://help.agi.com/stk/Content/training/L1_AccessReports.htm`, `https://help.agi.com/stk/Content/training/WhereisISS.htm`

### 1.2 ส่วนที่ **อนุมาน** (ไม่ได้ตีพิมพ์ลำดับครบทุกบรรทัดในหน้าเว็บเดียว)
- STK ไม่ได้ตีพิมพ์รายการ shortcut menu ของ Scenario แบบเรียงลำดับบรรทัดต่อบรรทัดครบชุดในหน้า `GetStart_ObjectBrowser.htm`
- เมื่อเทียบกับหน้า Object Browser ปัจจุบันของ GNSS Studio (พบใน QA-02: คลิกขวา `acc_20261111` แสดง `Properties`, `Access...`, `Report & Graph Manager...`, `Zoom To`, `Rename`, `Delete` เหมือน Satellite/Facility):
  - **อนุมานจากสถาปัตยกรรม STK**: `Zoom To` และ `Delete` ไม่ควรอยู่บนโหนด Scenario (เพราะ Scenario เป็น root container ไม่ใช่จุดพิกัดใน 3D และไม่ถูกลบด้วยคำสั่งลบวัตถุภายใน Scenario); ส่วน `Access...` ใน STK ใช้ระหว่างคู่ object มากกว่าที่จะเรียกจาก Scenario root โดยตรง

---

## 2. ช่องทางเปิด 3D Graphics Window Properties

### 2.1 **ยืนยันตรงตัว**
- **Toolbar**: นำหน้าต่าง **3D Graphics** ขึ้นมาด้านหน้า แล้วกดปุ่ม **`Properties`** บนแถบเครื่องมือ **`3D Window Defaults`** (หรือ `3D Graphics` toolbar) เพื่อเปิดหน้าต่าง **3D Graphics Window Properties** (เช่น หน้า *Details* สำหรับ *Label Declutter*, *Lighting*, *Annotation*)
  - แหล่งอ้างอิง: `https://help.agi.com/stk/Content/vo/VOProperties.htm`, `https://help.agi.com/stk/Content/vo/vowindow-04a.htm`, `https://help.agi.com/stk/Content/gettingstarted/Toolbars.htm`
- **เปิด/ปิด Toolbar**: หากแถบ `3D Window Defaults` ถูกซ่อนอยู่ สามารถเปิดได้จากเมนู **`View -> Toolbars`** (หรือคลิกขวาที่พื้นที่ว่างบนแถบ toolbar)
  - แหล่งอ้างอิง: `https://help.agi.com/stk/Content/gettingstarted/Toolbars.htm`

### 2.2 **อนุมาน**
- เมนู **`View`** บน menubar หลักของ STK มีคำสั่งสร้างหน้าต่างใหม่ (`New 3D Graphics Window`, `Duplicate 3D Graphics Window`) และเปิด/ปิด Toolbars (`View -> Toolbars`) แต่ **ไม่ได้** มีคำสั่ง `3D Graphics Window Properties` อยู่ใต้เมนู `View` โดยตรง — ช่องทางมาตรฐานคือปุ่ม `Properties` บน `3D Window Defaults` toolbar
- หน้าต่าง 3D ของ STK ไม่มี context menu คลิกขวาบนพื้นหลังแผนที่/โลกเพื่อเปิด Properties (การคลิกขวาใน 3D ใช้หมุน/ซูมกล้อง)

---

## 3. ช่องทางเปิด 2D Graphics Window Properties

### 3.1 **ยืนยันตรงตัว**
- **Toolbar**: นำหน้าต่าง **2D Graphics** ขึ้นมาด้านหน้า แล้วกดปุ่ม **`Properties`** บนแถบเครื่องมือ **`2D Window Defaults`** เพื่อเปิด **2D Graphics Window Properties** (หน้า *Basic / Projection*, *Imagery*, *Details*, *Lighting*, *Time Display*, *Annotation*)
  - แหล่งอ้างอิง: `https://help.agi.com/stk/Content/stk/2Dgfxproperties.htm`, `https://help.agi.com/stk/Content/stk/map-06.htm`, `https://help.agi.com/stk/Content/gettingstarted/Toolbars.htm`
- **เมนู `View`**: ใช้เปิดหน้าต่างใหม่ (`View -> New 2D Graphics Window` / `Duplicate 2D Graphics Window`) และจัดการ Toolbar (`View -> Toolbars`)
  - แหล่งอ้างอิง: `https://help.agi.com/stk/Content/gettingstarted/Toolbars.htm`

### 3.2 **อนุมาน**
- เช่นเดียวกับหน้าต่าง 3D: ช่องทางมาตรฐานในการเปิด **2D Graphics Window Properties** คือปุ่ม `Properties` บนแถบ **`2D Window Defaults`** (ไม่ใช่เมนู `View` หรือคลิกขวาบนแผนที่ 2D)
- **ข้อสังเกตเทียบกับ GNSS Studio (QA-04)**: ใน GNSS Studio แถบ `3D Window Defaults` ถูกปิดไว้โดยค่าเริ่มต้น (ต่างจาก `2D Window Defaults` หรือผู้ใช้ต้องเปิดเองจาก `View -> Toolbars`) ทำให้ผู้ใช้ที่คลิกดูเมนู `View` หรือมองหาปุ่มตั้งค่าหน้าต่าง 3D ไม่พบปุ่ม `Properties` ของหน้าต่าง 3D
