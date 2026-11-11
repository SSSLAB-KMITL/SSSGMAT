# GNSS Studio งานย่อยที่ 4: Access, Report & Graph Manager และ Validation

- วันที่: 2026-11-11
- Branch: แผนลงมือจะใช้ `feature/gnss-studio-access` (แตกจาก `feature/gnss-studio-workspace`)
- สถานะ: รอผู้ใช้ตรวจ spec
- เอกสารที่เกี่ยวข้อง: [design ภาพรวม](2026-11-11-gnss-studio-design.md), [spec engine](2026-11-11-gnss-studio-engine-design.md) (อ้างว่า "engine §n"),
  [spec server](2026-11-11-gnss-studio-server-design.md) (อ้างว่า "server §n"), [spec workspace](2026-11-11-gnss-studio-workspace-design.md) (อ้างว่า "workspace §n"),
  [รายการอ้างอิง STK](2026-11-11-gnss-studio-stk-reference.md) (อ้างว่า "STK ref")

## 1. เป้าหมาย

ทำ Access tool, Report & Graph Manager, หน้าต่างรายงานและกราฟ และหน้า Validation ให้ใช้งานเหมือน STK
โดยรายงานทุกชนิดสร้างจาก Data Provider ของ engine

### เกณฑ์ว่าสำเร็จ

1. Access tool ทำงานครบตามหัวข้อ 4 และผลของ Compute ตรงกับ `intervals.json`
2. Installed Styles ทุกตัวในหัวข้อ 3.4 สร้างได้ทั้งแบบ Report/Graph และ (ถ้าระบุ) Dynamic Display/Strip Chart
3. รายงาน Access ของ THBK กับดาวหนึ่งดวงในหนึ่งวันแสดงภายใน 2 วินาที
4. ส่งออก .txt และ .csv ได้จากหน้าเว็บและจาก CLI `python3 -m gnss_predict.studio report`
5. หน้า Validation แสดงประวัติรายวันและรายดวงจาก `history.jsonl` และ `validation_<day>.json`

## 2. ขอบเขต

**ทำ**: หัวข้อ 3–8

**ไม่ทำใน v1**: Use Time Intervals ของ Access (ต้องมี Analysis Workbench), Advanced... ของ Access, Coverage Definition แบบ STK,
Save As Quick Report / Quick Report Manager, ส่งออก To Excel..., หน้าต่าง Connect

## 3. ส่วนที่ต้องเพิ่มใน engine

### 3.1 `geometry.ecef_to_geodetic(x_km, y_km, z_km) -> (lat_deg, lon_deg, h_km)`

WGS84 แบบวนซ้ำจนต่างไม่เกิน 1e-12 rad ใช้ค่าคงที่ `WGS84_A_KM`, `WGS84_F` เดิม

### 3.2 Data Provider (`gnss_predict/dataproviders.py`)

ชื่อ provider, group และ element ใช้คำของ STK (STK ref §F และคู่มือ data provider ที่ตรวจในส่วน A2) ยกเว้นที่ติดป้าย

| Provider | Group | Object | Element (หน่วย) | ใช้กับ | ที่มา |
|---|---|---|---|---|---|
| Access Data | — | Access | Access Number, Start Time, Stop Time, Duration (sec) | Reports | `intervals.json` |
| AER Data | Default | Access | Time, Azimuth (deg), Elevation (deg), Range (km) — เฉพาะเวลาที่อยู่ใน access | Reports, Dynamic Displays | `aer.csv` |
| LLA State | Fixed | Satellite | Time, Lat (deg), Lon (deg), Alt (km), Lat Rate (deg/sec), Lon Rate (deg/sec), Alt Rate (km/sec) | Reports, Dynamic Displays | `predicted.sp3` + `ecef_to_geodetic`, rate จากผลต่างกลางของจุดข้างเคียง |
| Dilution of Precision | All Systems, GPS, GLONASS, Galileo, BeiDou | Facility | Time, GDOP, PDOP, HDOP, VDOP, EDOP, NDOP, TDOP, N Visible | Reports, Dynamic Displays | `dop.csv` |
| N Asset Coverage | — | Facility | Time, Total, GPS, GLONASS, Galileo, BeiDou (จำนวนดวงที่ใช้ได้) | Reports, Dynamic Displays | `dop.csv` |
| IPP Data **(เพิ่มเอง)** | — | Access | Time, IPP Lat (deg), IPP Lon (deg), MF, Elevation (deg) | Reports, Dynamic Displays | `aer.csv` |

```python
def list_providers(object_type: str) -> list[ProviderInfo]
def provider_rows(bundle: ResultSet, obj: str, provider: str, group: str | None, elements: list[str],
                  start: datetime, stop: datetime, step_s: int | None) -> list[dict]
```

- `ResultSet` รวม path ของ bundle ephem และ access ที่ตรงกับ scenario ปัจจุบัน
- `step_s = None` คือ "Use default time points" (ตาม step ของ scenario)
- `step_s` ที่ไม่ใช่จำนวนเท่าของ step ของ scenario ตอบ `ScenarioError(field="time.step")`
- เวลาออกเป็น UTC เสมอ การแสดง UTCG/LTZG ทำที่หน้าเว็บหรือตัวจัดรูปแบบ

### 3.3 Style (`gnss_predict/styles/installed.json`)

```json
{"name": "Access", "kind": "report", "object_type": "Access",
 "content": [{"provider": "Access Data", "group": null, "elements": ["Access Number", "Start Time", "Stop Time", "Duration"]}],
 "time": {"mode": "object_period", "step_s": null},
 "summary": {"per_object": [], "global_statistics": ["Min Duration", "Max Duration", "Mean Duration", "Total Duration"]},
 "graph": null}
```

กราฟใช้ `"graph": {"type": "time_xy" | "interval" | "polar90", "y1": [...], "y2": [...]}`
`polar90` ใช้ Elevation เป็นรัศมีและ Azimuth เป็นมุม ตาม Az El Polar ของ STK

### 3.4 Installed Styles

| Object Type | ชื่อ | ชนิด | เนื้อหา | Dynamic Display/Strip Chart |
|---|---|---|---|---|
| Access | Access | Report | Access Data + Global Statistics (เมื่อเลือกมากกว่า 1 object) | — |
| Access | AccessSummary | Report | ต่อ object: จำนวน access, Min/Max/Mean/Total Duration | — |
| Access | AER | Report | AER Data/Default | ได้ |
| Access | Gaps | Report | ช่วงว่างระหว่าง access ในช่วงวิเคราะห์: Gap, Start Time, Stop Time, Duration | — |
| Access | IPP Data **(เพิ่มเอง)** | Report | IPP Data | ได้ |
| Access | Access | Graph (interval) | แถบช่วง access ต่อ object | — |
| Access | AER | Graph (time_xy) | Azimuth, Elevation แกนซ้าย; Range แกนขวา | Strip Chart |
| Access | Elevation Angle | Graph (time_xy) | Elevation | Strip Chart |
| Access | Az El Polar | Graph (polar90) | Azimuth, Elevation ช่วงที่อยู่ใน access | — |
| Satellite | LLA Position | Report | LLA State/Fixed | ได้ |
| Facility | All DOPs | Report และ Graph (time_xy) | Dilution of Precision/All Systems: Time, GDOP, PDOP, HDOP, VDOP, TDOP | ได้ |
| Facility | N Asset Coverage | Report และ Graph (time_xy แบบซ้อนตามระบบ) | N Asset Coverage | ได้ |

### 3.5 ตัวจัดรูปแบบ (`gnss_predict/report_format.py`)

- `.txt` แบบรายงาน STK:
  - บรรทัดแรกชื่อ scenario กับเวลาสร้าง (UTCG)
  - ชื่อรายงานแบบ `THBK-To-G01:  Access`
  - หัวคอลัมน์มีหน่วยในวงเล็บ เช่น `Start Time (UTCG)` และขีดเส้นใต้ด้วย `-`
  - ตัวเลขชิดขวา คอลัมน์ความกว้างคงที่
  - ท้ายรายงานมีบล็อก `Global Statistics`
  - ผมไม่มีไฟล์จริงของ STK ให้เทียบ จึงเหมือนในแนวทาง ไม่ใช่ทุกตัวอักษร
- `.csv`: ตัวคั่น `,`, หัวคอลัมน์มีหน่วย, ไม่มีบล็อกสถิติ เลือกได้ตาม Export Setup: Field Delimiter, Enclose Header Fields in Quotes, Write Report Title, Headers
- เวลาในไฟล์ใช้ DateFormat ของ scenario
- CLI: `python3 -m gnss_predict.studio report --scenario DIR --style NAME --object PATH [--format txt|csv] [--start --stop --step]`

## 4. Access tool (STK ref §F)

หน้าต่างลอย เปิดจาก Analysis → Access..., ปุ่ม Access บนแถบ Default หรือคลิกขวาที่ object

| ส่วน | รายละเอียด |
|---|---|
| Access For | ช่องอ่านอย่างเดียว + Select Object... (เลือก Facility หรือ Satellite) |
| Associated Objects | ต้นไม้ Constellation → Satellite (เมื่อ Access For เป็น Facility) หรือรายการ Facility (เมื่อเป็น Satellite) ติ๊กเลือกได้ทั้งกลุ่มและรายดวง ดวงที่คำนวณแล้วเป็นตัวหนา คลิกขวา: Select All |
| ปุ่ม | Compute, Clear, Clear All, Remove, Remove All (server §6.6) |
| Time Period | Use Object Time Period (ช่วงวิเคราะห์) / Specify Time Period (Start, Stop) |
| Reports | Access..., AER... (สร้างรายงานของ access ที่เลือก) |
| Graphs | Access..., AER... |
| อื่น | Report & Graph Manager..., Add Timeline, Auto Add to Timeline (ติ๊กไว้ตั้งต้น) |
| Animation Graphics | Show, Static Highlight, Animate Highlight, Show Animate Line; Color: Use Object Colors / Use Custom Color; Inherit Settings from Scenario |

พฤติกรรม
- Compute ระหว่างที่มี job ของ scenario นั้นอยู่ ปุ่มเป็นสีเทาและแถบสถานะแสดงความคืบหน้า เสร็จแล้วรายการเป็นตัวหนา และเพิ่มแถวใน Timeline View ถ้าติ๊ก Auto Add to Timeline
- ค่ากราฟิกบันทึกลง `accesses[].graphics` และมีผลกับหน้าต่าง 3D/2D เมื่อกด Compute ตาม STK
  - **Show Animate Line:** เส้นจาก Facility ถึงดาวเฉพาะช่วง access (`access.czml`)
  - **Static Highlight:** เส้น ground track ช่วงที่อยู่ใน access เป็นเส้นหนาใน 2D แสดงตลอด ไม่ขึ้นกับเวลา
  - **Animate Highlight:** กรอบรอบดาวใน 2D ขณะอยู่ใน access
- Specify Time Period ตัดช่วง access ที่แสดงและในรายงาน ไม่ต้องคำนวณใหม่

## 5. Report & Graph Manager (STK ref §F)

หน้าต่างลอย

| ส่วน | รายละเอียด |
|---|---|
| Object Type | All Types, Access, Facility, Satellite, Constellation |
| Objects | รายชื่อตามชนิด เลือกหลายตัวได้ (Ctrl/Shift) ชนิด Access แสดงเป็น `THBK-To-G01` |
| Styles | ต้นไม้ Installed Styles (ล็อก) / My Styles / Scenario Styles, ติ๊ก Show Reports / Show Graphs เพื่อกรอง |
| Generate As | Report/Graph หรือ Dynamic Display/Strip Chart (style ที่ไม่รองรับแบบหลังจะเป็นสีเทาเมื่อเลือก) |
| ปุ่ม | Generate..., New..., Properties..., Close |
| คลิกขวาที่ style | Generate as .txt file..., Generate as .csv file..., Properties, Copy to My Styles, Delete (เฉพาะ My Styles / Scenario Styles) |
| ตัวเลือกเวลา (กล่องก่อน Generate) | Use Object Time Period / Specify Time Properties (Start, Stop, Step: Use default time points / Use step size) |

### 5.1 หน้าต่างแก้ style (New... / Properties...)

- **Content:**
  - ซ้ายเป็นต้นไม้ Data Provider → Group → Element ของ Object Type ที่เลือก
  - ขวาเป็นรายการคอลัมน์ที่เลือก ใช้ปุ่ม Add, Remove, Up, Down
- **Time:** ตามตัวเลือกเวลาข้างบน
- **Summary:** Min, Max, Mean, Total, Std Deviation, Summary Only (ตามตัวเลือก Summary Options ของ STK)
- **Graph (เมื่อเป็น style กราฟ):** Type (Time XY / Interval / Polar), กำหนดแต่ละ element ไปแกน Y1 หรือ Y2
- **การบันทึก:** OK บันทึกลง My Styles (server `PUT /styles/{name}`) หรือ Scenario Styles ตามที่เลือก

## 6. หน้าต่างรายงานและกราฟ

ทั้งสองชนิดเปิดเป็น Integrated เป็นแท็บกลางจอ ย้ายเป็น Dockable/Floating ได้ (workspace §4.1) ชื่อหน้าต่างแบบ `THBK-To-G01: Access`

### 6.1 รายงาน

- **ตาราง:** เลื่อนดูได้หลายแสนแถว ถ้าเลือกหลาย object แบ่งเป็นช่วงตาม object และมี Global Statistics ท้ายตาราง (ตาม STK)
- **แถบเครื่องมือ:** Refresh (F5), Export ▸ To CSV Format..., Setup...
- **คลิกขวาที่ช่องเวลา:** Set Animation Time
- **Report/Graph:** ไม่เดินตามเวลา animation
- **Dynamic Display:** โหลดค่าทั้งช่วงครั้งเดียว แล้วแสดงแถวของเวลาปัจจุบัน
  - ค่าต่อเนื่อง (มุม ระยะ DOP) ประมาณค่าเชิงเส้นระหว่างจุด
  - ค่าแบบนับ (จำนวนดวง) ใช้จุดก่อนหน้า
  - ไม่เรียก server ทุกเฟรม

### 6.2 กราฟ (ECharts)

- **แถบเครื่องมือ:** Save (PNG), Copy to Clipboard, Zoom Out, Refresh, Toggle Animation Timeline, Crosshair Cursor
- **คลิกขวา:** Show Animation Time Line, Set Animation Time (ตั้งเวลาตามตำแหน่งที่คลิก), Export Dialog... (ข้อมูลกราฟเป็น CSV)
- **เส้นเวลา animation:** เป็นเส้นแนวตั้งในกราฟ time_xy และ interval ส่วนในกราฟ polar เป็นจุดตำแหน่งปัจจุบัน
- **Strip Chart:** แสดงช่วงย้อนหลัง Strip Chart Duration (ตั้งต้น 3600 วินาที) ที่จบที่เวลาปัจจุบันและเลื่อนตามนาฬิกา
- **แกนเวลา:** ใช้ DateFormat ของ scenario
- **สีของเส้น:** ตามสีของ object

## 7. หน้า Validation **(เพิ่มเอง)**

เปิดจาก Analysis → Validation... เป็นหน้าต่าง Integrated

| ส่วน | รายละเอียด |
|---|---|
| ตารางรายวัน | Day, Scenario, Truth (ชื่อไฟล์ SP3), ΔEl ค่ากลาง/P99 ต่อระบบ (สลับเป็น ΔAz ได้), ผล (Pass / Fail / Pending / Gave up), ดาวที่ไม่ผ่าน จาก `/validation/history` |
| รายละเอียดวัน | คลิกแถวแล้วแสดงตารางรายดวง: PRN, Truth (sp3 / brdc / unverified), Pairs, ΔEl med/P99, ΔAz med/P99, 3D med/max (km), อายุข้อมูล, Result กรองตามระบบและผลได้ |
| แนวโน้ม | กราฟ P99 \|ΔEl\| ต่อระบบตามวัน พร้อมเส้นเกณฑ์ 0.2°; สลับเป็น \|ΔAz\| (เกณฑ์ 0.5°) |
| อายุกับความคลาด | กราฟจุด: ค่ากลางระยะ 3D ต่อดวงเทียบอายุข้อมูลวงโคจร ทุกวันรวมกัน ใช้ประกอบการปรับเกณฑ์อายุ 7 วัน (ภาพรวม §10.3) |

แถวที่ยังรอ SP3 แสดง Pending พร้อมเวลาที่จะลองครั้งถัดไป (server §9.4)

## 8. ข้อผิดพลาด

| สถานการณ์ | การแสดง |
|---|---|
| ไม่มีผลลัพธ์ของ Facility ตอน Generate | ถามว่าจะ Compute ก่อนไหม (กล่องโต้ตอบของหน้าเว็บ) |
| ผลลัพธ์ไม่ตรงกับ scenario | หน้าต่างรายงาน/กราฟขึ้นแถบเตือนเหมือนหน้าต่าง 3D/2D และปุ่ม Refresh สั่งคำนวณใหม่ |
| step ไม่ใช่จำนวนเท่าของ step ของ scenario | ช่อง Step ขึ้นกรอบแดง (422, `field: time.step`) |
| style ที่ผู้ใช้สร้างอ้าง element ที่ไม่มี | ข้อความใน Message Viewer และไม่สร้างรายงาน |
| ยังไม่มีประวัติ validation | หน้า Validation แสดงคำอธิบายว่าจะมีข้อมูลหลังงานประจำวันรันและ SP3 ออก |

## 9. การทดสอบ

| ชั้น | ตรวจอะไร | ค่าจริง |
|---|---|---|
| engine (unittest) | `ecef_to_geodetic`: แปลงไปกลับกับ `geodetic_to_ecef` ต่างไม่เกิน 1e-9 องศาและ 1 มม., ขั้วโลก, เส้นศูนย์สูตร, ความสูง 20,000 กม. | สูตรปิด |
| engine | LLA Rate ของวงโคจรวงกลมสมมติ (Lon Rate คงที่ตามคาบ) | สูตรปิด |
| engine | Access Data, AER Data, IPP Data, Dilution of Precision, N Asset Coverage ตรงกับแถวใน bundle fixture ทุกค่า | ไฟล์ engine |
| engine | Gaps เป็นส่วนเติมเต็มของ access ในช่วงวิเคราะห์ | `intervals.json` |
| engine | Global Statistics ของรายงาน Access ตรงกับ `global_statistics` ใน `intervals.json` | ไฟล์ engine |
| engine | ไฟล์ .txt และ .csv ของ style ทุกตัว เทียบไฟล์ต้นแบบใน `tests/fixtures/reports/` | ไฟล์ต้นแบบ |
| engine | step ที่ไม่ใช่จำนวนเท่าได้ `ScenarioError` | — |
| server (pytest) | `/dataproviders`, `/data`, `/styles`, `/reports` ตามหัวข้อ 3; My Styles บันทึกและลบได้ | engine |
| เว็บ (Vitest) | สถานะของ Access tool (Compute/Clear/Remove), ตัวเลือกเวลา, หน้าต่างแก้ style สร้าง JSON ถูกต้อง, Dynamic Display ประมาณค่าระหว่างจุด | หัวข้อ 4–6 |
| Playwright | Compute THBK→GPS → แถวใน Timeline เท่าจำนวนดาว GPS ที่ไม่ถูกซ่อน; รายงาน Access ของ G01 ตรงกับ `intervals.json`; Export CSV ได้ไฟล์ที่มีหัวคอลัมน์ตามหัวข้อ 3.5; Dynamic Display ของ AER เปลี่ยนเมื่อกด Step Forward; กราฟ Az El Polar มีจุดเวลาปัจจุบัน; หน้า Validation แสดงแถวจาก fixture | ไฟล์ engine |

## 10. ความเสี่ยง

| # | ความเสี่ยง | วิธีรับมือ |
|---|---|---|
| R-1 | รูปแบบไฟล์ .txt ไม่ตรง STK ทุกตัวอักษร | ระบุไว้ในหัวข้อ 3.5 ถ้าได้ตัวอย่างไฟล์จริงจาก STK จะปรับให้ตรง |
| R-2 | รายงาน AER ของหลายดวงหลายวันมีหลายแสนแถว | ตารางแบบ virtual + cache ฝั่ง server (server §6.7) |
| R-3 | ECharts กับข้อมูลหลายหมื่นจุดต่อเส้นช้า | เปิด `sampling: "lttb"` และ `large` mode ของ ECharts |
