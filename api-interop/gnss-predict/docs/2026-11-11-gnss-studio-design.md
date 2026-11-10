# GNSS Studio: หน้าจอแบบ STK สำหรับพยากรณ์ดาวเทียม GNSS (design ภาพรวม)

- วันที่: 2026-11-11
- Branch: `feature/gnss-studio-engine` (แตกจาก `feature/gnss-predict` ที่ 9d9ba7d ยังไม่เข้า `main`)
- สถานะ: รอผู้ใช้ตรวจ spec
- เอกสารที่เกี่ยวข้อง
  - [2026-11-10-gnss-predict-design.md](2026-11-10-gnss-predict-design.md): CLI พยากรณ์ GPS เดิม
  - [2026-11-11-gnss-studio-engine-design.md](2026-11-11-gnss-studio-engine-design.md): spec งานย่อยที่ 1
  - [2026-11-11-gnss-studio-stk-reference.md](2026-11-11-gnss-studio-stk-reference.md): ชื่อเมนู ปุ่ม และหน้าต่างของ STK ที่ตรวจกับคู่มือแล้ว

เอกสารนี้กำหนดเป้าหมาย การแบ่งงาน และข้อตกลงกลางที่ทุกงานย่อยต้องใช้ร่วมกัน รายละเอียดของแต่ละงานย่อยอยู่ใน spec ของงานนั้น

## 1. ที่มาและเป้าหมาย

`gnss_predict` ตอนนี้เป็น CLI ที่พยากรณ์ Az/El/IPP/MF ของดาว GPS ที่สถานี THBK ออกเป็นไฟล์ CSV สำหรับงาน TEC
ผู้ใช้ต้องการหน้าจอสำหรับวางแผนและดูผลพยากรณ์ที่ **เหมือน Ansys STK ให้มากที่สุดทั้งระบบ** และรองรับ GNSS หลายระบบ

### สิ่งที่ผู้ใช้กำหนด

1. หน้าตาและการใช้งานเหมือน STK ให้มากที่สุด
2. v1 ต้องมีครบ 4 ส่วน: Scenario กับเวลา animation, ลูกโลก 3D, แผนที่ 2D, Access กับรายงานและกราฟ
3. รองรับ GPS, GLONASS, Galileo, BeiDou
4. ทำงานบนเครื่องก่อน แล้วค่อยขึ้น Docker
5. ใช้ FastAPI + React/TypeScript (Vite) + CesiumJS
6. ชื่อเมนู ปุ่ม และหน้าต่างเป็นภาษาอังกฤษตาม STK ข้อความแจ้งเตือนและคำอธิบายเป็นภาษาไทย
7. DOP เมื่อรวมหลายระบบใช้นาฬิกาเดียวแบบ STK และ RTKLIB พร้อม DOP แยกรายระบบ
8. ข้อตกลงจากการตรวจความแม่นยำ 5 ข้อ (หัวข้อ 8.2)
9. ยังไม่ merge เข้า `main` จนกว่าผู้ใช้สั่ง

### สมมติฐาน (ผู้ใช้ยังไม่ได้ยืนยันโดยตรง แต่ไม่ได้แย้ง)

1. สถานีตั้งต้นคือ THBK และเพิ่ม Facility อื่นได้
2. ไม่รวม QZSS และ NavIC ใน v1
3. v1 ใช้คนเดียวบน localhost ไม่มี login
4. CLI เดิมและไฟล์ CSV ของ GPS สำหรับงาน TEC ต้องใช้งานได้เหมือนเดิม
5. ตรวจความแม่นยำกับ MGEX SP3 ด้วยเกณฑ์เดียวกับ GPS เดิม
6. ชื่อชั่วคราวของระบบคือ "GNSS Studio" เปลี่ยนได้

### เกณฑ์ว่าสำเร็จ (v1 ทั้งระบบ)

1. เปิดเว็บแล้วสร้าง scenario ที่มี THBK และดาว 4 ระบบ เล่น animation และเห็นดาวเคลื่อนบนหน้าต่าง 3D และ 2D พร้อมกันที่เวลาเดียวกัน
2. คำนวณ Access จาก THBK ไปยังกลุ่มดาว ได้รายงาน Access และ AER กราฟ Az El Polar และ DOP ส่งออกเป็น .txt/.csv ได้
3. ชื่อเมนู ปุ่ม หน้าต่าง และหน้าตั้งค่าตรงกับ [รายการอ้างอิง STK](2026-11-11-gnss-studio-stk-reference.md) ทุกคำ ยกเว้นส่วนที่ติดป้ายว่าเราเพิ่มเอง
4. ความแม่นยำผ่านเกณฑ์ในหัวข้อ 10 ทั้ง 4 ระบบ
5. ระบบทั้งชุดรันได้ด้วย `docker compose up` ด้วย

## 2. ขอบเขต

**v1 ทำ**: ฟีเจอร์ที่อยู่ในหัวข้อ 6

**ทำในรุ่นถัดไป (ไม่อยู่ใน v1)**
- Coverage และแผนที่ DOP ทั่วประเทศไทย (Coverage Definition + Figure of Merit แบบ STK)
- Sensor, Chain, Az-El Mask จากภูมิประเทศหรือไฟล์ mask
- โมเดล 3 มิติของดาวเทียม, การติดตามแบบเวลาจริงจากเครื่องรับ
- ดาวเทียมทั่วไปที่ไม่ใช่ GNSS, QZSS, NavIC
- หลายผู้ใช้และระบบ login
- คำนวณ GLONASS จาก broadcast (ต้องใช้การอินทิเกรตเชิงตัวเลข)
- Use Time Intervals ของ Access (ต้องมี Analysis Workbench)

## 3. การแบ่งงานย่อย

แต่ละงานย่อยมี spec, แผนลงมือ และ test ของตัวเอง ทำตามลำดับ และแต่ละ branch แตกจาก branch ของงานก่อนหน้า

| ลำดับ | งานย่อย | Branch | ผลที่ได้ |
|---|---|---|---|
| 1 | Engine หลายระบบ | `feature/gnss-studio-engine` | คำสั่ง `fetch`, `propagate`, `analyze`, `validate` และไฟล์ผลลัพธ์ตามหัวข้อ 7 |
| 2 | FastAPI server + API | `feature/gnss-studio-server` | API ตามหัวข้อ 7.6, คิว job, ตั้งค่าด้วย environment variable |
| 3 | พื้นที่ทำงานหลัก | `feature/gnss-studio-workspace` | Object Browser, Properties Browser, Animation toolbar, Timeline View, หน้าต่าง 3D/2D |
| 4 | Access + Report & Graph Manager | `feature/gnss-studio-access` | Access tool, รายงาน, กราฟ, DOP, หน้า Validation |
| 5 | Docker | `feature/gnss-studio-docker` | build GMAT บน Linux ใน image, compose |

## 4. สถาปัตยกรรม

```
Browser (React + TypeScript + CesiumJS + dockview)
   │  HTTP/JSON  (dev: Vite 5173 proxy /api → 8000)
   ▼
FastAPI (127.0.0.1:8000)  ── คิว job เดียว (ทำทีละ job)
   │  เรียกฟังก์ชัน Python ของ engine โดยตรง
   ▼
gnss_predict (Python standard library ล้วน + CLI)
   │  subprocess
   ▼
GmatConsole (GMAT R2026a, SPICESGP4)
   │
   ▼
data/  (scenario, ข้อมูลวงโคจร, ผลลัพธ์ บนดิสก์)
```

หน้าที่ของแต่ละชั้น
- **Engine** คำนวณทุกอย่างและเขียนผลลงดิสก์ ทดสอบได้โดยไม่ต้องมี server
- **Server** จัดคิว job อ่านและส่งไฟล์ผลลัพธ์ ตรวจรูปแบบ scenario ไม่คำนวณเรขาคณิตเอง
- **Web** แสดงผลและแก้ scenario ไม่คำนวณวงโคจร Cesium เติมตำแหน่งระหว่างจุดจาก CZML

โฟลเดอร์ใต้ `api-interop/gnss-predict/`

| โฟลเดอร์ | เนื้อหา | git |
|---|---|---|
| `gnss_predict/` | engine | track |
| `server/` | FastAPI, tests, `requirements.txt` | track |
| `web/` | React + TypeScript + Vite + Cesium | track |
| `docker/` | Dockerfile, compose | track |
| `data/` | scenario, ข้อมูลวงโคจร, ผลลัพธ์ | ignore |

การตั้งค่าทั้งหมดผ่าน environment variable

| ตัวแปร | ค่าตั้งต้น | ความหมาย |
|---|---|---|
| `GNSS_STUDIO_DATA` | `api-interop/gnss-predict/data` | โฟลเดอร์ข้อมูล |
| `GMAT_BIN` | `application/bin/GmatConsole` ของ repo | ตำแหน่ง GmatConsole (ของเดิม) |
| `GNSS_STUDIO_HOST`, `GNSS_STUDIO_PORT` | `127.0.0.1`, `8000` | ที่อยู่ server |
| `CESIUM_ION_TOKEN` | ว่าง | ถ้าว่างใช้ภาพโลก NaturalEarthII ที่มากับ Cesium ซึ่งใช้ได้แบบไม่ต่อเน็ต |

ในการใช้งานจริง FastAPI ส่งไฟล์เว็บที่ build แล้วจาก port เดียวกัน

## 5. หน้าจอ

ทุกชื่อในหัวข้อนี้มาจาก [รายการอ้างอิง STK](2026-11-11-gnss-studio-stk-reference.md) ส่วนที่ STK ไม่มีจะติดป้าย **(ของเรา)**

### 5.1 การจัดวางเมื่อเปิด scenario ใหม่

```
┌──────────────────────────────────────────────────────────────────────────┐
│ File Edit View Insert Analysis <object> Utilities Window Help            │
├──────────────────────────────────────────────────────────────────────────┤
│ Default:   [Insert Object] [Properties] ...                              │
│ Animation: Reset StepBack Reverse Pause Start StepFwd [-][+] N RT xRT    │
│            Current Scenario Time: 12 Nov 2026 07:00:00.000 LTZG+07:00    │
├───────────────────┬────────────────────────────┬─────────────────────────┤
│ Object Browser    │ 3D Graphics 1 - Earth      │ 2D Graphics 1 - Earth   │
│ ▾ THBK_Scen       │                            │                         │
│   ■☑ THBK         │                            │                         │
│   ☑ GPS      (C)  │                            │                         │
│   ▾ GPS sats (G)  │                            │                         │
│     ■☑ G01        │                            │                         │
├───────────────────┴────────────────────────────┴─────────────────────────┤
│ Timeline View  Global Time Bar ──────▌──────────  [Access bars]          │
├──────────────────────────────────────────────────────────────────────────┤
│ ⓘ | Active Object | Animation Time | Time Step | TLE age | ⚠ flagged     │
└──────────────────────────────────────────────────────────────────────────┘
(C) = Constellation object, (G) = Group folder
```

- หน้าต่างมี 3 แบบตาม STK: Dockable (Object Browser, Timeline View, Message Viewer), Integrated (3D, 2D, รายงาน, กราฟ), Floating (Properties Browser, Access tool, Report & Graph Manager ลอยอยู่ในแท็บ browser)
- ลากหน้าต่างไปเกาะขอบได้โดยมี dock marker, ปักหมุดหรือซ่อนอัตโนมัติได้, รวมเป็นแท็บได้ ใช้ไลบรารี dockview
- เมนู Window มี Windows..., Cascade, Tile Horizontally, Tile Vertically และรายชื่อหน้าต่าง
- การจัดวางบันทึกลง `workbook.json` คู่กับ scenario ตามแบบไฟล์ Workbook ของ STK
- เมื่อเปิดโปรแกรมแสดง Welcome: Create a Scenario / Open a Scenario และเมื่อสร้าง scenario ใหม่จะเปิด Insert STK Objects ให้
- กรอบและเมนูเป็นโทนสว่างแบบโปรแกรม Windows ส่วนลูกโลกตรงกลางเป็นโทนมืด
- แถบสถานะมีช่องของ STK (Active Object, Lat/Lon, Animation Time, Time Step, progress bar + Stop) และเพิ่มอายุ TLE กับจำนวนดาวที่ติดธง **(ของเรา)**
- คีย์ลัด: Ctrl+S, Ctrl+Q, Delete, F5 และ Shift + ล้อเมาส์ในหน้าต่าง 3D เลื่อนเวลา animation ถ้าคีย์ลัดชนกับ browser ให้ทำงานเท่าที่ browser ยอม

### 5.2 Object Browser และการเพิ่ม object

- Scenario เป็นราก ดาวเทียมและ Facility อยู่ระดับเดียวกันใต้ Scenario
- Constellation เป็น object แยก (GPS, GLONASS, Galileo, BeiDou) เลือกสมาชิกใน Basic - Definition
- จัดดาวเป็นโฟลเดอร์ด้วย New Group (ตั้งต้นมีโฟลเดอร์ละระบบ)
- แถบเครื่องมือ: Properties, Graphics Color Selectors, Graphics On/Off Toggles, New Group, Cut, Copy, Paste, Delete, Find, Expand/Collapse
- คลิกขวา: Properties, Access..., Report & Graph Manager..., Zoom To (เฉพาะ 3D), Rename, Delete
- ไม่มีตัวกรอง (STK ไม่มี) ใช้ Find และ Group แทน
- Insert STK Objects: Facility ใช้ Define Properties / Insert Default ส่วน Satellite ใช้หน้าต่างค้นหาแบบ Search Standard Object Data ที่มี Data Sources และ Create Constellation from Selected โดยแหล่งข้อมูลคือ CelesTrak + IGS metadata **(ของเรา เพราะ STK ไม่มีวิธีดึงจาก CelesTrak)**

### 5.3 Properties Browser

รายการหน้าทางซ้าย ปุ่ม Apply / OK / Cancel / Help ชื่อหน้าแบบ "กลุ่ม - หน้า"

| Object | หน้าใน v1 |
|---|---|
| Scenario | Basic - Time (Analysis Period, Animation: Start Time, Time Update Mode = Time Step / Real Time / X Real-Time, Animation Cycle = Stop at Time / Loop at Time), Basic - Units (DateFormat UTCG / LTZG ใส่ +07:00 ได้), Basic - Description, 2D Graphics - Global Attributes (Show Labels), Basic - Ionosphere: ความสูง shell **(ของเรา)** |
| Facility | Basic - Position (Geodetic: Latitude, Longitude, Altitude), Basic - Description, Constraints - Active (Elevation Angle Min), 2D Graphics - Attributes |
| Satellite | Basic - Orbit (SGP4, TLE Source, อายุ TLE อ่านอย่างเดียว), Basic - Description (PRN, SVN, Block, NORAD, สถานะธง), 2D Graphics - Attributes, 2D Graphics - Pass (Lead Type / Trail Type), 2D Graphics - Swath (Ground Elevation), 3D Graphics - Orbit System (Fixed by Window / Inertial by Window) |
| Constellation | Basic - Definition (Available Objects / Assigned Objects), Basic - Description, ปุ่มตั้งสีให้สมาชิกทุกดวง **(ของเรา เพราะ Constellation ของ STK ไม่มีหน้ากราฟิก)** |

### 5.4 Animation และ Timeline View

- ปุ่ม: Reset, Step Backward, Reverse, Pause, Start, Step Forward, Decrease Time Step, Increase Time Step, Normal Animation Mode, Real-Time Animation Mode, X Real-Time Animation Mode
- ช่อง Current Scenario Time (วางเวลาแล้วกด Enter เพื่อกระโดด), Time Step, X Real Time Multiplier
- ระยะก้าวตั้งต้น 60 วินาทีตามตารางค่าระยะก้าวของ STK (หน้าบทเรียนของ STK บอก 10 วินาที) ปุ่มเพิ่ม/ลดเลื่อนตามรายการค่าคงที่ของ STK
- Timeline View: Global Time Bar, Global Time Scale, Time Display, View Port, คลิกขวา Set Animation Time to Here, คลิกขวาที่ช่วงเวลา Set Animation Time to Interval Start/Stop Time
- หน้าต่าง 2D/3D, Dynamic Display, Strip Chart และเส้นเวลาในกราฟเดินตามนาฬิกาเดียวกัน รายงานแบบ Report/Graph ไม่เดินตามเวลา

### 5.5 หน้าต่าง 3D และ 2D

- 3D: ลูกโลกพร้อมกลางวัน/กลางคืน (3D Graphics Window Properties - Lighting), วงโคจรสีตามดาว, ป้ายชื่อ, Home View, View From/To (เลือก From Position เป็น THBK ได้), Orbit System Fixed/Inertial
- 2D: Projection (ตั้งต้น Equidistant Cylindrical, Display Coordinate Frame ECF/ECI), Details - Lat/Lon Lines, Lighting - Show Outline (เส้นแบ่งกลางวันกลางคืน), ground track ตาม Lead/Trail, Swath, จุด IPP และเส้นทาง IPP **(ของเรา)**
- เส้น access แสดงตาม Show Animate Line / Static Highlight / Animate Highlight ของ Access tool

### 5.6 Access tool และ Report & Graph Manager

- Access tool: Access For + Select Object..., Associated Objects, Compute / Clear / Clear All / Remove / Remove All, Use Object Time Period / Specify Time Period, Reports: Access... / AER..., Graphs: Access... / AER..., Report & Graph Manager..., Add Timeline + Auto Add to Timeline, กราฟิก Show / Static Highlight / Animate Highlight / Show Animate Line
- Report & Graph Manager: Object Type, Styles (Installed Styles / My Styles / Scenario Styles), Show Reports / Show Graphs, Generate As: Report/Graph หรือ Dynamic Display/Strip Chart, Generate..., คลิกขวา Generate as .txt file... / Generate as .csv file...
- Style ใน v1: Access, AccessSummary, AER, Gaps, LLA Position, กราฟ Access, AER, Elevation Angle, Az El Polar, All DOPs, จำนวนดาวที่มองเห็นแยกระบบ (ชื่อตาม N Asset Coverage ของ STK), IPP/MF **(ของเรา)**
- กราฟมีปุ่ม Toggle Animation Timeline และคลิกขวา Show Animation Time Line / Set Animation Time
- DOP ใน STK ต้องสร้าง Coverage object ก่อน v1 คำนวณให้ Facility โดยตรง **(ทำให้ง่ายลง ติดป้ายไว้ในหน้าจอ)**

### 5.7 Message Viewer และหน้า Validation

- Message Viewer: แท็บ All Messages / Errors / Infos / Warnings, Details, Clear this Tab, Clear all Tabs
- หน้า Validation **(ของเรา)**: ประวัติความแม่นยำจากการตรวจย้อนหลังรายวันและรายดวง

## 6. ฟีเจอร์ v1 แยกตามงานย่อย

| ฟีเจอร์ | งานย่อย |
|---|---|
| ดึง OMM, IGS metadata, broadcast; สถานะดาว; propagate; SP3/CZML; AER/IPP/MF; access; DOP; validate | 1 |
| API, คิว job, Stop, ตรวจ scenario, บันทึกและเปิด scenario/workbook, ตรวจย้อนหลังอัตโนมัติ | 2 |
| หัวข้อ 5.1–5.5 และ Message Viewer | 3 |
| หัวข้อ 5.6 และหน้า Validation | 4 |
| image ที่ build GMAT บน Linux, compose, ตรวจผลใน container | 5 |

## 7. ข้อตกลงด้านข้อมูล

### 7.1 โครงสร้างบนดิสก์

```
data/
  orbits/<YYYYMMDDTHHMMZ>/          ข้อมูลวงโคจรที่ดาวน์โหลด ใช้ร่วมกันทุก scenario
    gps-ops.json glo-ops.json galileo.json beidou.json   (OMM JSON จาก CelesTrak)
    igs_satellite_metadata.snx
    brdc/BRDC00IGS_R_<YYYYDDD>0000_01D_MN.rnx.gz
    SHA256SUMS
  scenarios/<name>/
    scenario.json                   ≈ STK .sc
    workbook.json                   ≈ STK Workbook
    ephem/<hash>/                   ผลของ propagate
      manifest.json  predicted.sp3  scene.czml
    access/<facility>/<hash>/       ผลของ analyze
      manifest.json  aer.csv  intervals.json  dop.csv  access.czml  legacy_gps.csv
  validation/history.jsonl          ประวัติการตรวจย้อนหลัง
```

- ดาวน์โหลดเก็บไว้ที่ `data/orbits/` ที่เดียว เพราะกติกาของ CelesTrak นับต่อ IP ไม่ใช่ต่อ scenario
- `<hash>` คือ 12 ตัวแรกของ SHA-256 ของข้อมูลตั้งต้น (ดู spec engine) ถ้าข้อมูลเหมือนเดิมใช้ผลเดิม
- ทุกโฟลเดอร์ผลลัพธ์เขียนลงโฟลเดอร์ชั่วคราวก่อนแล้ว rename ทั้งชุด

### 7.2 `scenario.json`

engine อ่านเฉพาะช่องที่ใช้คำนวณ ช่องอื่นเป็นของหน้าเว็บ ช่องที่ไม่รู้จักให้ข้ามโดยไม่ error

```json
{
  "format": "gnss-studio-scenario/1",
  "name": "THBK_Scen",
  "analysis_period": {"start": "2026-11-12T00:00:00Z", "stop": "2026-11-13T00:00:00Z"},
  "step_s": 30,
  "orbit_snapshot": "20261111T0600Z",
  "ionosphere": {"shell_km": 400.0},
  "satellite_filter": {"show_too_old": false, "show_no_broadcast": false},
  "animation": {"start": "2026-11-12T00:00:00Z", "time_step_s": 60, "update_mode": "time_step", "cycle": "loop"},
  "units": {"date_format": "UTCG", "ltz_offset": "+07:00"},
  "objects": [
    {"class": "Facility", "name": "THBK",
     "position": {"type": "Geodetic", "lat_deg": 13.729779, "lon_deg": 100.781151, "alt_m": 6.4},
     "constraints": {"elevation_angle_min_deg": 10.0}, "graphics": {}},
    {"class": "Constellation", "name": "GPS", "system": "G", "assigned_objects": ["G01"], "graphics": {}},
    {"class": "Satellite", "name": "G01", "norad": 62339, "svn": "G080", "graphics": {}}
  ],
  "groups": [{"name": "GPS sats", "members": ["G01"]}],
  "accesses": [{"from": "THBK", "to": ["GPS"], "time_period": "object", "graphics": {}}]
}
```

พิกัด THBK มาจาก config เดิม G01 = NORAD 62339 / SVN G080 มาจาก IGS metadata ณ 2026-11-09 ส่วนเวลาและชื่อ snapshot เป็นค่าตัวอย่าง
รายละเอียดช่อง `graphics` อยู่ใน spec งานย่อยที่ 3

### 7.3 กติกาที่ทุกส่วนใช้ร่วมกัน

| เรื่อง | ข้อตกลง |
|---|---|
| เวลา | เก็บเป็น UTC แบบ ISO 8601 ลงท้าย `Z` ทุกไฟล์ ยกเว้น SP3 ที่ใช้ GPS time ตามรูปแบบ การแสดง UTCG/LTZG ทำที่หน้าเว็บ |
| GPS − UTC | 18 วินาที (`GPS_UTC_OFFSET_S` เดิม) |
| ระยะห่างจุดเวลา | ตั้งต้น 30 วินาที ช่วงวิเคราะห์รวมทั้งเวลาเริ่มและเวลาจบ |
| หน่วย | ระยะในไฟล์ CSV และ SP3 เป็นกิโลเมตร, ใน CZML เป็นเมตร, มุมเป็นองศา |
| ชื่อดาว | PRN ณ เวลาเริ่มช่วงวิเคราะห์ เช่น `C01` ตัวระบุจริงคือ NORAD และ SVN |
| CZML | จุดทุก 300 วินาที, `referenceFrame: FIXED`, Lagrange ลำดับ 7, เก็บเฉพาะข้อมูล สี/lead/trail/ป้ายชื่อมาจาก `scenario.json` |
| ขอบช่วง access | ประมาณค่ามุมเงยเชิงเส้นระหว่างจุดเวลา คลาดไม่เกิน 1 วินาที |

### 7.4 แหล่งข้อมูลขาเข้า

| ข้อมูล | แหล่ง | รูปแบบ | กติกา |
|---|---|---|---|
| วงโคจรสำหรับพยากรณ์ | CelesTrak `gp.php?GROUP=<group>&FORMAT=json` กลุ่ม gps-ops, glo-ops, galileo, beidou | OMM (CCSDS) แบบ JSON | ดาวน์โหลดได้ครั้งเดียวต่อรอบอัปเดต 2 ชม., 403 แล้วห้ามลองซ้ำ, error เกิน 50 ครั้งใน 2 ชม. โดนบล็อก IP |
| PRN / SVN / Block | `https://files.igs.org/pub/station/general/igs_satellite_metadata.snx` | SINEX | ดาวน์โหลดวันละครั้ง |
| Broadcast ephemeris | `ftp://gdc.cddis.eosdis.nasa.gov/gnss/data/daily/<ปี>/brdc/` | RINEX 3.04 navigation | FTPS แบบ anonymous วันละครั้ง |
| วงโคจรอ้างอิง | `ftp://gdc.cddis.eosdis.nasa.gov/gnss/products/<GPS week>/` (COD0MGXFIN ฯลฯ หรือ GFZ0MGXRAP / WUM0MGXRAP) | SP3-d | ใช้ final ก่อน ถ้าไม่มีใช้ rapid |

เหตุผลที่ใช้ OMM แทน TLE: CelesTrak ใช้หมายเลขแคตตาล็อก 5 หลักหมดเมื่อ 2026-07-11 และไม่ออก TLE ให้ดาวเลข 6 หลัก
กลุ่ม GNSS ของ CelesTrak ณ 2026-11-11 มี 3 ดวงที่ได้เลข 6 หลัก หนึ่งในนั้นคือ COSMOS 2620 (100744) ซึ่ง IGS บันทึกว่าเป็น GLONASS R10 ตั้งแต่ 2026-10-20

### 7.5 ไฟล์ผลลัพธ์

| ไฟล์ | เนื้อหา |
|---|---|
| `ephem/<hash>/manifest.json` | ข้อมูลตั้งต้นและ SHA-256, รุ่น GMAT, รายชื่อดาวพร้อม PRN/SVN/NORAD/Block/epoch/อายุ/ธง, ดาวที่ไม่มี PRN, คำเตือน |
| `predicted.sp3` | ตำแหน่งพยากรณ์ทุกดวงแบบ SP3-d, orbit type `EXT` เปิดใน STK ได้ด้วย "From SP3 File" |
| `scene.czml` | ตำแหน่งดาวสำหรับ Cesium |
| `access/<facility>/<hash>/aer.csv` | `time_utc,prn,az_deg,el_deg,range_km,ipp_lat_deg,ipp_lon_deg,mf` เฉพาะแถวที่ El ≥ 0 |
| `intervals.json` | ช่วง access ต่อดวง (start, stop, duration_s, max_el_deg) และ Global Statistics |
| `dop.csv` | `time_utc,system,n_visible,gdop,pdop,hdop,vdop,edop,ndop,tdop` โดย `system` เป็น `ALL`, `G`, `R`, `E`, `C` |
| `access.czml` | ตำแหน่ง Facility และเส้น access ที่แสดงเฉพาะช่วง access |
| `legacy_gps.csv` | `DAY,Time,PRN,Az,El,IPP_Lat,IPP_Lon,MF` รูปแบบเดียวกับ CLI เดิม เฉพาะ GPS |

### 7.6 API (ระดับหลัก รายละเอียดอยู่ใน spec งานย่อยที่ 2)

| กลุ่ม | ทำอะไร |
|---|---|
| `scenarios` | สร้าง, รายชื่อ, เปิด, บันทึก `scenario.json` และ `workbook.json` |
| `orbits` | สั่งดึงข้อมูลวงโคจรชุดใหม่, รายชื่อชุดที่มี |
| `catalog` | ค้นหาดาวจากชุดข้อมูลวงโคจร ใช้กับหน้าต่างเพิ่มดาวเทียม |
| `jobs` | สั่ง propagate / analyze / validate, ดูสถานะ (v1 ใช้ polling), ยกเลิก |
| `results` | manifest, czml, intervals, aer (กรองตามดาวและช่วงเวลา), dop, รายงาน .txt/.csv |
| `messages` | ข้อความสำหรับ Message Viewer |
| `validation` | ประวัติความแม่นยำ |

## 8. ข้อตกลงด้านการคำนวณ

### 8.1 สองขั้นแบบ STK

- `propagate` เมื่อเพิ่มดาวหรือแก้ช่วงเวลาแล้วกด Apply: รัน GMAT ครั้งเดียวให้ทุกดวง ได้ `predicted.sp3` และ `scene.czml`
- `analyze` เมื่อกด Compute ใน Access tool: Python คำนวณ AER, IPP/MF, ช่วง access, DOP ของแต่ละ Facility จากตำแหน่งที่ได้ ไม่รัน GMAT ซ้ำ
- Az/El คำนวณจาก ECEF ใน Python ซึ่งผ่านการตรวจกับ SP3 ทั้ง 4 ระบบแล้ว

### 8.2 ข้อตกลงจากการตรวจความแม่นยำ (ผู้ใช้อนุมัติแล้ว)

1. PRN มาจาก IGS metadata เท่านั้น ชื่อดาวใน CelesTrak ใช้แค่เตือนเมื่อไม่ตรง
2. ค่าจริงใช้ MGEX SP3 เป็นหลัก ดาวที่ไม่มีใน SP3 ใช้ broadcast แทน ดาว GLONASS ที่ไม่มีใน SP3 ติดป้าย "unverified"
3. ตัดสินผ่านหรือไม่ผ่านแยกรายดวง และติดธงดวงที่คลาดผิดปกติในหน้าจอ
4. ดาวที่ไม่มี broadcast ใน 24 ชม. ล่าสุด ซ่อนไว้ตั้งต้น เลือกให้แสดงได้
5. ดาวที่ข้อมูลวงโคจรเก่า ติดธงหรือซ่อนเป็นรายดวง ไม่หยุดการพยากรณ์ทั้งหมด

### 8.3 DOP

นาฬิกาเครื่องรับตัวเดียวสำหรับทุกระบบ (ตัวแปร 4 ตัว) แบบเดียวกับ STK Dilution of Precision และฟังก์ชัน `dops()` ของ RTKLIB
คำนวณทั้งแบบรวมทุกระบบและแบบแยกระบบ ใช้ดาวที่มุมเงยผ่านเกณฑ์ของ Facility และไม่มีธง `too_old`, `no_broadcast`, `unhealthy`

## 9. การจัดการข้อผิดพลาด (ทุกงานย่อย)

- แบ่ง 2 ระดับ: **หยุดงาน** (job ล้มเหลว ไม่มีผลลัพธ์) และ **คำเตือน** (มีผลลัพธ์ แนบคำเตือนใน manifest)
- ทุกข้อความมีรหัสภาษาอังกฤษคงที่ (เช่น `ORBIT_SOURCE_UNAVAILABLE`) และคำอธิบายภาษาไทย
- job มีสถานะ queued → running → succeeded / failed / cancelled กด Stop แล้ว kill GMAT ทั้ง process group
- ถ้า server ปิดกลางคัน job ที่ค้างเป็น failed ด้วยเหตุผล "ถูกขัดจังหวะ"
- ถ้าแก้ scenario หลังคำนวณแล้ว ผลเก่ายังแสดงแต่ติดป้าย "ผลลัพธ์ไม่ตรงกับ scenario ปัจจุบัน"
- รายการกรณีของ engine อยู่ใน spec งานย่อยที่ 1

## 10. การทดสอบและเกณฑ์ผ่าน

ทุกเกณฑ์ต้องบอกว่าค่าจริงมาจากไหน ถ้าเป็นการตรวจความสอดคล้องภายในให้เขียนกำกับไว้

### 10.1 ความแม่นยำ (ใช้กับทั้งระบบ)

- ค่าจริง: MGEX SP3 ของวันที่ผ่านไปแล้ว ดาวที่ไม่มีใน SP3 ใช้ broadcast (G/E/C) ดาว GLONASS ที่ไม่มีใน SP3 เป็น "unverified"
- เงื่อนไข: El ≥ 10°, อายุ OMM ณ กลางช่วงวิเคราะห์ ≤ 2 วัน
- เกณฑ์ระดับระบบ (คิดจากคู่ที่มีค่าจริงจาก SP3): ค่ากลาง |ΔEl| ≤ 0.05°, P99 |ΔEl| ≤ 0.2°, ค่ากลาง |ΔAz| ≤ 0.1°, P99 |ΔAz| ≤ 0.5° (Az คิดเฉพาะ El < 80°)
- ผ่านเมื่อทั้ง 4 ระบบผ่าน และทุกดวงที่ไม่ผ่านถูกระบุชื่อพร้อมค่าคลาดในรายงานการตรวจ
- ผลทดลองก่อนออกแบบ (2026-11-09, GFZ0MGXRAP): ทุกระบบผ่านด้วยระยะห่างจากเกณฑ์ราว 20 เท่า

| ระบบ | ดาว | คู่ | ค่ากลาง / P99 \|ΔEl\| | ค่ากลาง / P99 \|ΔAz\| |
|---|---|---|---|---|
| GPS | 32 | 2,752 | 0.0016° / 0.0084° | 0.0022° / 0.0179° |
| GLONASS | 19 | 1,510 | 0.0011° / 0.0052° | 0.0016° / 0.0119° |
| Galileo | 30 | 2,546 | 0.0011° / 0.0075° | 0.0019° / 0.0118° |
| BeiDou | 27 | 2,556 | 0.0009° / 0.0050° | 0.0012° / 0.0092° |

### 10.2 ต่องานย่อย

| งานย่อย | เกณฑ์หลัก | ค่าจริง |
|---|---|---|
| 1 | ดู spec engine | SP3, broadcast, CelesTrak TLE, TrainingModel, RTKLIB |
| 2 | ไฟล์ที่ API ส่งออกมี SHA-256 ตรงกับไฟล์ที่ engine เขียน, ยกเลิก job ได้, เปิด server ใหม่หลังปิดกลางคันแล้วสถานะถูก | ไฟล์ของ engine |
| 3 | รูปแบบเวลาตรงกับตัวอย่าง `1 Jan 2026 16:00:00.000 UTCG`; ตำแหน่งดาวบนลูกโลก ณ เวลาที่ตั้งตรงกับ `predicted.sp3` ไม่เกิน 1 ม.; ทุกชื่อเมนู ปุ่ม หน้าต่าง ตรงกับรายการอ้างอิง STK (test อัตโนมัติไล่เทียบ) | คู่มือ STK, `predicted.sp3` |
| 4 | ช่วง access ตรงกับการสุ่มทุก 1 วินาทีไม่เกิน 1 วินาที; คอลัมน์รายงานตรงกับ style ของ STK | การคำนวณละเอียดแยกต่างหาก, คู่มือ STK |
| 5 | ชุด test และเกณฑ์ความแม่นยำผ่านใน container; Az/El ต่างจากผลบน macOS ไม่เกิน 0.0001° | ผลบน macOS |

### 10.3 ตรวจย้อนหลังต่อเนื่อง

เมื่อวันที่พยากรณ์ผ่านไปแล้วและมี SP3 แบบ rapid (ราว 1–2 วัน) server รัน `validate` เทียบ `predicted.sp3` ที่สร้างไว้ล่วงหน้ากับค่าจริง
ต่อท้ายผลใน `data/validation/history.jsonl` และแสดงในหน้า Validation ประวัตินี้ใช้ปรับเกณฑ์อายุข้อมูล 7 วันในภายหลัง

### 10.4 ตรวจกับ STK จริง (ทำเมื่อมีเครื่องที่ติดตั้ง STK)

เปิด `predicted.sp3` ด้วย From SP3 File และสร้าง Facility THBK ใน STK แล้วเทียบช่วง access (ไม่เกิน 1 วินาที) และ AER (ไม่เกิน 0.001°)
ผู้ใช้ยังไม่ได้ยืนยันว่ามีเครื่องที่ติดตั้ง STK ข้อนี้จึงไม่เป็นเงื่อนไขผ่านของ v1

## 11. ความเสี่ยง

| # | ความเสี่ยง | ผลกระทบ | วิธีรับมือ |
|---|---|---|---|
| R1 | ข้อมูลวงโคจรบน CelesTrak ของบางดวงไม่อัปเดต (R10 อายุ 18 วัน คลาดจาก SP3 ราว 5,900 กม.) | ดวงนั้นพยากรณ์ผิดมาก | ธง `too_old` และซ่อนตั้งต้น |
| R2 | IGS metadata ยังไม่มี PRN ของดาวใหม่ (เช่น COSMOS 2621) | ดาวใหม่ไม่ปรากฏ | บันทึกใน manifest เป็น "ไม่มี PRN" |
| R3 | CDDIS เปลี่ยนวิธีเข้าถึง (เช่นบังคับ login) | ไม่มี broadcast และ SP3 | broadcast ข้ามได้พร้อมคำเตือน การตรวจย้อนหลังรอได้ |
| R4 | GPS − UTC เปลี่ยน (leap second) | เวลาใน SP3 เลื่อน 1 วินาที | ค่าอยู่ใน config ที่เดียว มี test |
| R5 | GMAT ช้าเมื่อ 130 ดวงทุก 30 วินาที | รอนาน | วัดในแผน เกณฑ์ 60 วินาที แสดงความคืบหน้า |
| R6 | คู่มือ STK ไม่มีชื่อ tooltip ของหลายปุ่ม | ชื่อปุ่มอาจไม่ตรง STK | ใช้ชื่อที่คู่มือเขียนในเนื้อหา ติดป้ายส่วนที่ไม่มีในคู่มือ |
| R7 | DOP แบบนาฬิกาเดียวให้ค่าดีกว่าเครื่องรับหลายระบบจริงเล็กน้อย | ตีความผิด | แสดง DOP แยกระบบคู่กัน |
| R8 | Cesium ion ต้องใช้ token | ไม่มีภาพโลกตอนไม่ต่อเน็ต | ใช้ NaturalEarthII ที่มากับ Cesium เป็นค่าตั้งต้น |
| R9 | กรอบ EarthFixed ของ GMAT ไม่ใช่ ITRF รุ่นที่ระบุชัด | header SP3 ระบุกรอบได้ไม่ตรงตัว | ความคลาดของ TLE ระดับกิโลเมตรมากกว่าความต่างของกรอบหลายเท่า ระบุกรอบเป็น `ITRF` |

## 12. Git

- ทุกงานย่อยทำบน branch ของตัวเองตามหัวข้อ 3 ไม่ push และไม่ merge เข้า `main` จนกว่าผู้ใช้สั่ง
- ไม่แก้ไฟล์เดิมของ GMAT
