# GNSS Studio งานย่อยที่ 3: Workspace (หน้าจอหลักแบบ STK)

- วันที่: 2026-11-11
- Branch: แผนลงมือจะใช้ `feature/gnss-studio-workspace` (แตกจาก `feature/gnss-studio-server`)
- สถานะ: รอผู้ใช้ตรวจ spec
- เอกสารที่เกี่ยวข้อง: [design ภาพรวม](2026-11-11-gnss-studio-design.md), [spec server](2026-11-11-gnss-studio-server-design.md) (อ้างว่า "server §n"),
  [spec Access + Report & Graph](2026-11-11-gnss-studio-access-reports-design.md), [รายการอ้างอิง STK](2026-11-11-gnss-studio-stk-reference.md) (อ้างว่า "STK ref")
- ภาพจำลองที่ผู้ใช้อนุมัติในส่วน C: https://claude.ai/artifact/CJa3i5scMvCTqDcHD5bHDw

## 1. เป้าหมาย

หน้าเว็บที่ใช้งานเหมือน STK ให้มากที่สุด: ชื่อ การจัดวาง และพฤติกรรมของเมนู แถบเครื่องมือ Object Browser,
Properties Browser, Animation, Timeline View, หน้าต่าง 3D/2D, Message Viewer และแถบสถานะ

### เกณฑ์ว่าสำเร็จ

1. เปิด scenario รายวันแล้วเห็นการจัดวางตามหัวข้อ 4.2 ภายใน 3 วินาที (scene.czml ราว 3 MB)
2. กด Start แล้วดาว 130 ดวงเคลื่อนพร้อมกันในหน้าต่าง 3D และ 2D ไม่ต่ำกว่า 30 ภาพต่อวินาทีบนเครื่องพัฒนา
3. ตำแหน่งดาวในหน้าต่าง 3D ณ เวลาใดๆ ต่างจาก `predicted.sp3` ไม่เกิน 1 ม.
4. ทุกชื่อเมนู ปุ่ม หน้าต่าง หน้าตั้งค่า และตัวเลือก อยู่ใน STK ref หรือติดป้ายว่าเพิ่มเอง (มี test ตรวจ)
5. การจัดวางหน้าต่างบันทึกไปกับ scenario และกลับมาเหมือนเดิมเมื่อเปิดใหม่

## 2. ขอบเขต

**ทำ**: หัวข้อ 4–12

**ไม่ทำในงานย่อยนี้**: Access tool, Report & Graph Manager, หน้าต่างรายงานและกราฟ, หน้า Validation (งานย่อยที่ 4)
งานย่อยนี้เตรียมจุดเชื่อมให้ ได้แก่ เมนู Analysis, แถบ Timeline ของ access และนาฬิการ่วม

**ไม่ทำใน v1**: ภาษาไทยในชื่อเมนู, ธีมมืด, มือถือ, หลายผู้ใช้, โมเดล 3 มิติของดาว, ภาพภูมิประเทศ

## 3. เทคโนโลยีและโครงสร้าง

| เรื่อง | ใช้ |
|---|---|
| โครงหลัก | React 18 + TypeScript + Vite |
| สถานะ | Zustand แยก store: `scenario`, `time`, `selection`, `results`, `jobs`, `messages`, `layout`, `settings` |
| หน้าต่าง | dockview |
| 3D / 2D | CesiumJS สอง Viewer (SCENE3D และ SCENE2D) ภาพโลก NaturalEarthII ที่มากับ Cesium |
| เมนู, เมนูคลิกขวา, กล่องโต้ตอบ | Radix UI (Menubar, ContextMenu, Dialog) |
| ตาราง | TanStack Table + TanStack Virtual |
| ไอคอน | Lucide และไอคอนที่วาดเอง ห้ามใช้ไอคอนหรือโลโก้ของ STK |
| type ของ API | สร้างจาก `/api/openapi.json` ด้วย openapi-typescript ตอน build |
| test | Vitest, Playwright (Chromium) |

```
api-interop/gnss-predict/web/
  src/
    main.tsx  App.tsx
    api/        client.ts (fetch + ETag + error), events.ts (SSE ต่อใหม่อัตโนมัติ), types.gen.ts
    stores/     scenario.ts time.ts selection.ts results.ts jobs.ts messages.ts layout.ts settings.ts
    time/       format.ts (UTCG/LTZG) parse.ts steps.ts
    labels/     labels.ts (ชื่อแบบ STK ทั้งหมด) messages.th.ts (ข้อความไทย)
    chrome/     MenuBar.tsx Toolbars.tsx StatusBar.tsx FloatingWindow.tsx ContextMenu.tsx
    windows/    ObjectBrowser/ PropertiesBrowser/ Graphics3D/ Graphics2D/ TimelineView/ MessageViewer/
                InsertObjects/ SatelliteCatalog/ NewScenarioWizard/ Welcome/ WindowsDialog/ ViewFromTo/
                WindowProperties/ FetchOrbitData/ DailyForecastSettings/ About/
    cesium/     viewer.ts clockSync.ts czml.ts graphics.ts swath.ts passes.ts inertial.ts testHooks.ts
    icons/
  tests/        unit/ e2e/
```

## 4. ระบบหน้าต่าง

### 4.1 ชนิดหน้าต่างตาม STK

| หน้าต่าง | ชนิดตั้งต้น | ที่อยู่ตั้งต้น |
|---|---|---|
| Object Browser | Dockable | ซ้าย |
| 3D Graphics 1 - Earth, 2D Graphics 1 - Earth | Integrated | กลาง วางข้างกัน (Tile Vertically) |
| Timeline View, Message Viewer | Dockable | ล่าง เป็นแท็บร่วมกัน |
| Properties Browser, Insert STK Objects, Search Satellite Catalog, New Scenario Wizard, Welcome, View From/To, 3D/2D Graphics Window Properties | Floating | กลางจอ |
| หน้าต่างรายงานและกราฟ (งานย่อยที่ 4) | Integrated | กลาง เป็นแท็บ |

- ลากหน้าต่างไปเกาะขอบด้วย dock marker, รวมเป็นแท็บ, ปักหมุด/ซ่อนอัตโนมัติ, ลอยในแท็บ browser ได้ (คลิกขวาที่แถบชื่อ: Dockable / Floating / Integrated)
- เมนู Window: Windows... (ตาราง Window / Type พร้อมปุ่ม Activate, Integrate, Center, Close), Cascade (รวมหน้าต่าง Integrated เป็นแท็บ), Tile Horizontally, Tile Vertically และรายชื่อหน้าต่างที่เปิดอยู่
- เปิดได้หลายหน้าต่าง 3D และ 2D (3D Graphics 2 - Earth ฯลฯ) ผ่าน View → New 3D Graphics Window / New 2D Graphics Window
- Save บันทึก `workbook.json` (server §5.2) คู่กับ `scenario.json` เปิด scenario แล้วจัดหน้าต่างตาม workbook ถ้าไม่มีใช้ตั้งต้นในหัวข้อ 4.2

### 4.2 การจัดวางตั้งต้น

ตามภาพจำลอง: เมนู → แถบ Default + Animation → (Object Browser | 3D | 2D) → (Timeline View | Message Viewer) → แถบสถานะ

## 5. เมนูและแถบเครื่องมือ

### 5.1 เมนูบนสุด (STK ref §A)

| เมนู | รายการ |
|---|---|
| File | New... (New Scenario Wizard), Open... (Welcome / รายชื่อ scenario), Save (Ctrl+S), Save As..., Close, รายการล่าสุด 1–4, Exit (ปิดแท็บไม่ได้ จึงพากลับหน้า Welcome) |
| Edit | Cut, Copy, Paste, Delete (Del), Find... (Ctrl+F เมื่อโฟกัส Object Browser) |
| View | Object Browser, Timeline View, Message Viewer, New 3D Graphics Window, New 2D Graphics Window, Toolbars ▸ (Default, Animation, 3D Graphics, 3D Window Defaults, 2D Window Defaults), Full Screen |
| Insert | New... (Insert STK Objects), Facility..., Satellite..., Constellation... |
| Analysis | Access..., Report & Graph Manager..., Validation... **(เพิ่มเอง)** |
| `<ชนิดของ object ที่เลือก>` | Scenario / Facility / Satellite / Constellation: Properties, Access..., Report & Graph Manager..., Zoom To, Rename, Delete |
| Utilities | Fetch Orbit Data... **(เพิ่มเอง)**, Daily Forecast Settings... **(เพิ่มเอง)** |
| Window | ตามหัวข้อ 4.1 |
| Help | Welcome..., STK UI Reference **(เพิ่มเอง)**, About GNSS Studio |

คีย์ลัดที่ browser ยอม: Ctrl+S, Delete, Ctrl+F, F5 (เฉพาะในหน้าต่างรายงาน), Shift + ล้อเมาส์ใน 3D
Ctrl+N, Ctrl+O, Ctrl+Q ไม่ทำ เพราะ browser จองไว้

### 5.2 แถบเครื่องมือ (STK ref §A, §D, §E)

| แถบ | ปุ่ม |
|---|---|
| Default | New, Open, Save, Insert Object, Properties, Access, Report & Graph Manager |
| Animation | Reset, Step Backward, Reverse, Pause, Start, Step Forward, Decrease Time Step, Increase Time Step, Normal Animation Mode, Real-Time Animation Mode, X Real-Time Animation Mode, ช่อง Current Scenario Time, ช่อง Time Step, ช่อง X Real Time Multiplier (แสดงเมื่อโหมด X Real-Time) |
| 3D Graphics (บนหน้าต่าง 3D) | Home View, View From/To |
| 3D Window Defaults | Properties, Grab Globe, Zoom In |
| 2D Window Defaults | Properties, Zoom In, Zoom Out |

ทุกปุ่มมี tooltip เป็นชื่อตามตาราง ซ่อน/แสดงแถบได้จาก View → Toolbars

## 6. นาฬิกาและ Animation

### 6.1 store `time`

`{current: Date (UTC), mode: "normal" | "realtime" | "xrealtime", direction: 1 | -1 | 0, step_s, multiplier, cycle}`
ค่าเริ่มต้นมาจาก `scenario.animation` ทุกหน้าต่างอ่านจาก store นี้ที่เดียว

| ปุ่ม | ผล |
|---|---|
| Reset | current = Animation Start Time, หยุด (ไม่เปลี่ยน step ตาม STK) |
| Step Backward / Step Forward | ถอย/เดินหน้า 1 step แล้วหยุด |
| Reverse / Start | เล่นถอยหลัง/เดินหน้า |
| Pause | หยุด |
| Decrease / Increase Time Step | เลื่อนตามตาราง step ของ STK (`stk/map-01a.htm`, ตรวจแล้ว): 0.0001, 0.0005, 0.001, 0.005, 0.01, 0.1, 0.5, 1, 3, 5, 10, 30, 60, 180, 300, 600, 1800, 3600, 7200, 14400, 28800, 57600, 115200, 230400, 460800, 921600, 1843200, 3686400, 7372800, 14745600, 29491200, 31536000 วินาที (จาก 60 กด Increase 3 ครั้งได้ 600 ตามตัวอย่างในคู่มือ) |
| Normal | ทุกครั้งที่ refresh (ราว 30 ครั้งต่อวินาที) เวลาเดิน 1 step |
| Real-Time | เวลาเดินเท่าเวลาจริง |
| X Real-Time | เวลาเดิน multiplier เท่าของเวลาจริง |

- Animation Cycle: Off = หยุดที่ปลายช่วง, Stop at Time, Loop at Time = กลับไปเวลาเริ่ม
- ช่อง Current Scenario Time รับการพิมพ์หรือวาง แล้วกด Enter เพื่อกระโดด รับรูปแบบตาม DateFormat ปัจจุบัน ถ้าแปลงไม่ได้ขอบช่องเป็นสีแดงและไม่เปลี่ยนเวลา

### 6.2 รูปแบบเวลา (`time/format.ts`)

- UTCG: `12 Nov 2026 07:00:00.000 UTCG` (ตามตัวอย่างของคู่มือ `1 Jan 2026 16:00:00.000 UTCG`)
- LTZG: `12 Nov 2026 14:00:00.000 LTZG+07:00` ใช้ `units.ltz_offset`
- ทุกหน้าต่างใช้ DateFormat ของ scenario (Basic - Units) เหมือน STK

## 7. Object Browser (STK ref §B)

- **ต้นไม้:** Scenario เป็นราก → Facility → Constellation (object แยก) → Group (โฟลเดอร์) → Satellite
  - scenario จากแม่แบบมีโฟลเดอร์ละระบบ ("GPS sats" ฯลฯ)
- **แต่ละแถว:** ลูกศรพับ, ช่องติ๊ก Show (Graphics On/Off Toggles), กล่องสี (Graphics Color Selectors ดับเบิลคลิกเพื่อเลือกสี), ไอคอนชนิด, ชื่อ
  - ⚠ เมื่อดาวมีธงอื่นนอกจาก `name_mismatch`
  - tooltip บอก PRN, SVN, NORAD, Block, ชื่อ CelesTrak, อายุข้อมูล และธงทั้งหมด
- **ดาวที่ถูกซ่อนตามตัวกรอง** (`too_old`, `no_broadcast` เมื่อปิดตัวกรอง) แสดงตัวเอียงสีจาง ติ๊ก Show ไม่ได้ **(เพิ่มเอง)**
- **แถบเครื่องมือ:** Properties, Graphics Color Selectors, Graphics On/Off Toggles, New Group, Cut, Copy, Paste, Delete, Find, Expand All, Collapse All
- **คลิก:** เลือก (Active Object บนแถบสถานะ และเมนูที่ 6 เปลี่ยนตาม)
  - ดับเบิลคลิกเปิด Properties Browser
  - คลิกขวา: Properties, Access..., Report & Graph Manager..., Zoom To (เฉพาะ 3D), Rename, Delete และเมนูย่อยตามชนิด object
- **Copy/Paste ของดาว:** สร้างดาวชื่อ `<ชื่อ>_1` ที่ NORAD เดียวกัน (ใช้กับการทดลองสี/กราฟิก)
- **Delete:** ถามยืนยันในกล่องโต้ตอบของหน้าเอง

## 8. Properties Browser (STK ref §C)

หน้าต่างลอย: ซ้ายเป็นรายการหน้าแบบ "กลุ่ม - หน้า" ขวาเป็นเนื้อหา ล่างมี OK / Cancel / Apply / Help
Apply ส่ง PATCH ทีละ object (server §6.4) ถ้าค่าผิดได้ 422 แล้วช่องนั้นขึ้นกรอบแดงพร้อมข้อความไทย

| Object | หน้า | ช่อง |
|---|---|---|
| Scenario | Basic - Time | Analysis Period: Start, Stop (Duration อ่านอย่างเดียว); Animation: Start Time, Time Update Mode (Time Step / Real Time / X Real-Time), Time Step, X Real Time Multiplier, Animation Cycle (Off / Stop at Time / Loop at Time) |
| | Basic - Units | DateFormat (UTCG / LTZG), LTZG offset, Distance (Kilometers), Angle (Degrees) |
| | Basic - Description | Short Description, Long Description |
| | Basic - Ionosphere **(เพิ่มเอง)** | Shell height (km) |
| | 2D Graphics - Global Attributes | Show Labels |
| Facility | Basic - Position | Position Type (Geodetic), Latitude, Longitude (deg), Altitude (m) |
| | Basic - Description | เหมือนข้างบน |
| | Constraints - Active | รายการ constraint, Add... (Select Constraints to Add: v1 มี Elevation Angle), Remove; Elevation Angle: Min, Max |
| | 2D Graphics - Attributes | Color, Marker Style, Inherit from Scenario |
| Satellite | Basic - Orbit | Propagator (SGP4 อ่านอย่างเดียว), TLE Source (snapshot), SSC Number (NORAD), Epoch, อายุข้อมูล — v1 อ่านอย่างเดียว |
| | Basic - Description | PRN, SVN, NORAD, Block, ชื่อ CelesTrak, ธงสถานะพร้อมคำอธิบายไทย (อ่านอย่างเดียว) + Short/Long Description |
| | 2D Graphics - Attributes | Color, Line Style, Line Width, Marker Style, Inherit from Scenario |
| | 2D Graphics - Pass | Lead Type / Trail Type (Time, Percent, Quarter, Half, Full, All, None, One Pass, Current Interval; Trail มี Same As Lead), ค่าเวลาหรือเปอร์เซ็นต์, Visible Sides, Show Pass Labels, Show Path Labels |
| | 2D Graphics - Swath | Swath Type (Ground Elevation), Ground Elevation (deg), Options (No Graphics / Edge Limits / Filled Limits) |
| | 3D Graphics - Orbit System | Fixed by Window / Inertial by Window |
| Constellation | Basic - Definition | Available Objects / Assigned Objects พร้อมปุ่มย้าย และ Selection Filter |
| | Basic - Description | เหมือนข้างบน + สีของสมาชิก **(เพิ่มเอง)** |

## 9. หน้าต่าง 3D และ 2D

### 9.1 ร่วมกัน

- Viewer ปิด widget สำเร็จรูปของ Cesium ทั้งหมด ใช้ `shouldAnimate = false` และตั้ง `clock.currentTime` จาก store `time` ทุกเฟรม
- โหลด `scene.czml` ด้วย `CzmlDataSource.load` แล้ว `process(access.czml)` เข้าแหล่งข้อมูลเดียวกันเพื่อให้ reference ทำงาน (ข้อตกลงจาก engine)
- สี, ป้ายชื่อ, lead/trail, swath และการแสดงผลมาจาก `scenario.json` (`cesium/graphics.ts`) แก้แล้วเห็นทันทีโดยไม่โหลด CZML ใหม่
- ป้ายชื่อตาม Show Labels ของ scenario
- **ผลไม่ตรงกับ scenario:** เมื่อ `/results` บอก `stale` ขึ้นแถบเหนือภาพ "ผลลัพธ์ไม่ตรงกับ scenario ปัจจุบัน — กด Apply เพื่อคำนวณใหม่"
- **เครื่องไม่รองรับ WebGL:** แสดงข้อความแทนภาพ

### 9.2 3D Graphics

- **Home View:** มุมมองตั้งต้นเห็นวงโคจร GNSS ทั้งหมด (ระยะกล้องราว 4.5 รัศมีโลก)
- **Zoom To:** ย้ายกล้องไปที่ object
- **View From/To:**
  - Mode: From Position to Position
  - From Position / To Position เลือก object (เช่น THBK มองขึ้นไปหา G01)
  - Reference Frame: Fixed / Inertial
- **3D Graphics Window Properties:**
  - Lighting: Enable Lighting, Ambient Level, Sun Level, Night Lights Level
  - Details: Lat/Lon Lines, Label Declutter
  - Annotation: Show Time
- **Orbit System:**
  - Fixed by Window: วาดเส้นทางจากตำแหน่ง Earth-fixed
  - Inertial by Window: หมุนตำแหน่งตัวอย่างเป็นกรอบ inertial ด้วย `Transforms.computeTemeToPseudoFixedMatrix` ของ Cesium (`cesium/inertial.ts`) ใช้เพื่อการแสดงผลเท่านั้น
- **เส้น access:** ตามกราฟิกของ Access tool (งานย่อยที่ 4)
- **Shift + ล้อเมาส์:** เลื่อนเวลาครั้งละ 1 step

### 9.3 2D Graphics

- **Projection:** Equidistant Cylindrical (`GeographicProjection`) หรือ Mercator (`WebMercatorProjection`)
- **Display Coordinate Frame:** ECF (v1) ส่วน ECI เป็นงานรุ่นหลัง
- **Details:** Lat/Lon Lines ด้วย `GridImageryProvider`
- **Lighting:** Show Outline (เส้นแบ่งกลางวันกลางคืน) และ Shading ถ้าแสงของ globe ในโหมด 2D ของ Cesium ใช้ไม่ได้ จะวาดพื้นที่กลางคืนเป็น polygon แทน
- **Ground track (`cesium/passes.ts`):**
  - ใช้ path ของ Cesium กับ leadTime/trailTime จากหน้า Pass
  - Quarter / Half / Full / Percent คิดจากคาบวงโคจรที่ประมาณจากรัศมีเฉลี่ยในข้อมูล
  - One Pass คิดถึงจุดที่ดาวข้ามเส้นศูนย์สูตรขาขึ้นครั้งถัดไป/ก่อนหน้า
  - All / Current Interval ใช้ทั้งช่วงวิเคราะห์
- **Swath (Ground Elevation):** คำนวณวงรอยเท้าจากความสูงดาวและมุมเงย (`cesium/swath.ts`) แสดงแบบ Edge Limits หรือ Filled Limits
- **IPP **(เพิ่มเอง)**:** จุดและเส้นทาง IPP ของดาวที่อยู่ใน access จาก `aer.csv` เปิดปิดได้ที่ 2D Graphics Window Properties → Details
- **พิกัดใต้เมาส์:** แสดงที่ช่อง Lat/Lon ของแถบสถานะ

## 10. Timeline View (STK ref §D)

วาดด้วย canvas มี 3 ชั้น:
- **Global Time Bar:** ทั้งช่วงวิเคราะห์ ลากตัวชี้สีขาวเพื่อเลื่อนเวลา
- **Global Time Scale:** ขีดเวลาตาม DateFormat
- **Time Display:** ช่วงที่กำลังดู ปรับด้วย View Port (ลากขอบซ้าย/ขวาของกรอบใน Global Time Bar) และล้อเมาส์

แถวช่วงเวลา:
- มาจาก Add Timeline ของ Access tool ชื่อแถว `THBK-To-G01`
- สีตาม Use Object Colors หรือสีที่กำหนด

การโต้ตอบ:
- คลิกเพื่อเลื่อนเวลา
- คลิกขวา: Set Animation Time to Here; บนแถบช่วงเวลา Set Animation Time to Interval Start Time / Interval Stop Time, Center, Remove from Timeline

## 11. หน้าต่างอื่น

| หน้าต่าง | เนื้อหา |
|---|---|
| Welcome to GNSS Studio | Create a Scenario, Open a Scenario, รายการล่าสุด (แสดงตอนเปิดหน้าเว็บถ้ายังไม่มี scenario ที่เปิดค้าง) |
| New Scenario Wizard | Name, Location (อ่านอย่างเดียว `data/scenarios/`), Start, Stop, Template **(เพิ่มเอง)**: THBK + ดาวทุกดวง 4 ระบบ / ว่าง, Orbit data (snapshot) — OK แล้วเปิด Insert STK Objects ตาม STK |
| Insert STK Objects | Select An Object To Be Inserted (Facility, Satellite, Constellation) / Select A Method (Facility: Define Properties, Insert Default; Satellite: From Satellite Catalog **(เพิ่มเอง)**, Define Properties; Constellation: Define Properties) / Insert... |
| Search Satellite Catalog | แบบ Search Standard Object Data: Data Sources (Local snapshot / Online CelesTrak ซึ่งสั่ง Fetch Orbit Data), ตัวกรอง System และคำค้น, ตาราง PRN, SVN, NORAD, Block, ชื่อ, อายุ, สถานะ, เลือกหลายดวง, Create Constellation from Selected |
| Message Viewer | แท็บ All Messages / Errors / Infos / Warnings, ตาราง Time, Level, Code, Object, Message, ปุ่ม Details, Clear this Tab, Clear all Tabs, รับข้อความจาก SSE |
| Fetch Orbit Data **(เพิ่มเอง)** | snapshot ล่าสุด, กลุ่ม, เวลาที่ดึงได้ครั้งถัดไปตามกติกา CelesTrak, Fetch Now |
| Daily Forecast Settings **(เพิ่มเอง)** | ค่าตาม server §9.1, ผลการรันล่าสุด, ไฟล์ CSV สำหรับงาน TEC |
| About GNSS Studio | รุ่น engine, รุ่น GMAT, หมายเหตุว่าชื่อเมนูอ้างอิงคู่มือ STK 13.1.0 และ GNSS Studio ไม่ใช่ผลิตภัณฑ์ของผู้พัฒนา STK |

## 12. แถบสถานะ

| ช่อง | ที่มา |
|---|---|
| ไอคอน Message Viewer + จำนวน | STK |
| Active Object (path แบบ STK) | STK |
| Lat/Lon ใต้เมาส์ (2D) | STK |
| ดาวที่ใช้ได้ + PDOP ณ เวลา animation | เพิ่มเอง |
| อายุข้อมูลวงโคจรสูงสุด | เพิ่มเอง |
| ⚠ จำนวนดาวติดธง (คลิกแล้วกรอง Object Browser) | เพิ่มเอง |
| งานประจำวัน: สถานะ + progress + Stop | progress + Stop ตาม STK, งานประจำวันเพิ่มเอง |
| Animation Time | STK |
| Time Step | STK |
| ขาดการติดต่อ server (สีแดง) | เพิ่มเอง |

## 13. ชื่อและข้อความ

- `labels/labels.ts` เก็บทุกชื่อที่แสดงบนหน้าจอ แต่ละรายการมี `{text, source: "stk" | "ours", ref?: "STK ref §A"}`
- `labels/messages.th.ts` เก็บข้อความไทยของหน้าเว็บ ข้อความจาก server ใช้ `text` ที่ server ส่งมา
- test อ่าน `docs/2026-11-11-gnss-studio-stk-reference.md` แล้วตรวจว่าทุกรายการ `source: "stk"` มีคำนั้นอยู่จริง และทุกรายการ `ours` แสดงป้ายเพิ่มเองในเอกสาร About

## 14. หน้าตา

- โทนสว่างแบบโปรแกรมเดสก์ท็อป: พื้นเทาอ่อน, เส้นขอบเทา, แถบชื่อหน้าต่างที่ active สีฟ้าอ่อน, ตัวเลือกที่เลือกสีฟ้า
- ตัวอักษร system UI ขนาด 12 px ตัวเลขและเวลาใช้ฟอนต์ monospace
- สีตามระบบ (ตั้งต้น เปลี่ยนได้): GPS เหลือง, GLONASS แดง, Galileo เขียว, BeiDou ฟ้า, Facility ชมพู, เส้น access เขียวอ่อน
- สีทั้งหมดเป็นตัวแปร CSS ที่เดียว
- คอนทราสต์ของข้อความผ่าน WCAG AA
- ใช้คีย์บอร์ดเปิดเมนูและเดินในต้นไม้ได้

## 15. ข้อผิดพลาด

| สถานการณ์ | การแสดง |
|---|---|
| 412 จาก server | กล่องโต้ตอบ "scenario ถูกแก้จากที่อื่น" ปุ่ม Reload / Cancel |
| 422 | ช่องที่ระบุใน `field` ขึ้นกรอบแดงพร้อมข้อความ |
| job ล้มเหลว | ข้อความใน Message Viewer และกล่องโต้ตอบพร้อม Details |
| SSE หลุด | แถบสถานะสีแดง ต่อใหม่ทุก 1, 2, 4 … สูงสุด 30 วินาที ต่อได้แล้วดึง `/messages?since=` ที่พลาดไป |
| `/health` บอกดิสก์เต็มหรือเขียนไม่ได้ | แถบเตือนด้านบน |

## 16. การทดสอบ

| ชั้น | ตรวจอะไร | ค่าจริง |
|---|---|---|
| Vitest | UTCG/LTZG แสดงและแปลงกลับ (ตัวอย่างคู่มือ STK, ข้ามวัน, มิลลิวินาที) | คู่มือ STK |
| Vitest | store `time`: ทุกปุ่ม Animation, รายการ step, Animation Cycle ทั้ง 3 แบบ | หัวข้อ 6 |
| Vitest | lead/trail ทุกแบบได้เวลาที่ถูก, วงรอยเท้าของดาว GNSS ที่มุมเงย 10° | สูตรปิด |
| Vitest | `labels.ts` ตรงกับ STK ref | ไฟล์ reference |
| Playwright | เปิด scenario fixture → การจัดวางตั้งต้นตรงหัวข้อ 4.2; Save แล้วเปิดใหม่ได้ layout เดิม | — |
| Playwright | Start → Current Scenario Time เดิน; Step Forward เดิน 1 step; Reset กลับต้น | — |
| Playwright | `window.__gnssStudioTest.entityPositionEcef("G01")` ณ เวลาที่ตั้ง ต่างจาก `predicted.sp3` ไม่เกิน 1 ม. | `predicted.sp3` |
| Playwright | คลิกขวา → Properties → เปลี่ยนสี → Apply → สีของ entity เปลี่ยน; Show Labels ปิดแล้ว label หาย | — |
| Playwright | Timeline: Set Animation Time to Here เปลี่ยนเวลาตรงตำแหน่ง | — |
| Playwright | Insert → Satellite → From Satellite Catalog → เลือก 2 ดวง + Create Constellation → ต้นไม้มี object ใหม่ | — |
| Playwright | ข้อความจาก SSE ขึ้นใน Message Viewer, Clear this Tab ลบเฉพาะแท็บนั้น | — |

Playwright ใช้ server จริงกับ `data/` fixture ที่มีผลคำนวณไว้แล้ว ไม่ต้องมี GMAT

## 17. ความเสี่ยง

| # | ความเสี่ยง | วิธีรับมือ |
|---|---|---|
| W1 | Cesium สอง Viewer ใช้หน่วยความจำ GPU มาก | ใช้ภาพโลกความละเอียดต่ำ ปิด terrain และวัดในงานแรกที่ทำหน้าต่าง 2D |
| W2 | แสงในโหมด 2D ของ Cesium อาจไม่แสดงเส้นแบ่งกลางวันกลางคืน | วาด polygon กลางคืนเอง (หัวข้อ 9.3) |
| W3 | dockview ย้าย canvas ของ Cesium แล้วขนาดไม่อัปเดต | เรียก `viewer.resize()` เมื่อ panel เปลี่ยนขนาด |
| W4 | browser จองคีย์ลัดบางตัว | ทำเฉพาะที่ระบุในหัวข้อ 5.1 |
