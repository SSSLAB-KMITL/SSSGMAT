# ผลการตรวจสอบคำศัพท์ UI ของ STK จาก `help.agi.com`: Access, Report & Graph Manager, Style Properties, หน้าต่างรายงาน/กราฟ, Dynamic Display และ Strip Chart

- วันที่: 2026-11-15
- แหล่งอ้างอิงที่ค้นหา: `https://help.agi.com` (ผ่าน `search_web` แบบจำกัดโดเมน `site:help.agi.com`)
- เอกสารที่ใช้อ้างอิงเทียบ:
  - [2026-11-11-gnss-studio-access-reports-design.md](2026-11-11-gnss-studio-access-reports-design.md) (§4–§7)
  - [2026-11-11-gnss-studio-stk-reference.md](2026-11-11-gnss-studio-stk-reference.md) (§F)
- หมายเหตุวิธีการ:
  - ทุกคำที่ไม่สามารถยืนยันข้อความตรงตัว (verbatim) บน `help.agi.com` จากผลการค้นหาได้ ระบุว่า **`ไม่พบ`** โดยไม่เดาคำหรือสะกดเอง
  - ผลการค้นหาจาก `search_web` แสดงลิงก์แหล่งที่มาส่วนใหญ่เป็น `agi.com` ผ่าน redirect โดยบางหน้าเท่านั้นที่แสดงพาธไฟล์ `.htm` ชัดเจนในข้อความ (เช่น `graph-interact.htm`, `ReportManagerStyles.htm`, `WorkingWithGraphs.htm`, `L1_AccessReports.htm`); กรณีที่ไม่ได้ระบุพาธ `.htm` ชัดเจนในผลค้นหาจะระบุเป็น `help.agi.com` พร้อมชื่อหัวข้อที่ยืนยัน (และระบุเลขหน้าเดิมใน STK ref ไว้แยกต่างหากเมื่อมี)

---

## 1. Access tool (`access-reports-design.md` §4, `stk-reference.md` §F)

| คำ | ข้อความที่อ้างตรงตัว (quote) | URL หน้า help | ใช้กับส่วนไหนของ spec |
|---|---|---|---|
| `Access Tool` | `"Open the Access Tool"`, `"Within the Access Tool interface"` | `https://help.agi.com/stk/` (หัวข้อ Access Tool / L1 Training; STK ref §F อ้าง `stk/tools-01.htm`) | access-reports-design §4 (ชื่อหน้าต่าง) |
| `Access` (ปุ่มบนแถบ `STK Tools`) | `"Click Access on the STK Tools toolbar"`, `"clicking the Access... icon in the STK Tools toolbar"` | `https://help.agi.com/stk/` (L1 Training / Access Tool) | access-reports-design §4 (**ขัดแย้ง**: spec เขียนว่า `แถบ Default` แต่ help ระบุ `STK Tools toolbar`) |
| `Access...` (เมนูคลิกขวา object) | `"Right-clicking an object in the Object Browser and selecting Access... opens the Access Tool panel"` | `https://help.agi.com/stk/` (L1 Training / Access Tool) | access-reports-design §4 (คลิกขวาที่ object) |
| `Analysis → Access...` (เมนูบนแถบเมนูหลัก) | **ไม่พบ** (ผลค้นหาระบุว่าเมนู `Analysis` มี `Report & Graph Manager`, `Analyzer`, `Remove All Accesses` ส่วน `Access...` ระบุให้เปิดจาก `STK Tools toolbar` หรือคลิกขวาใน Object Browser) | `https://help.agi.com/stk/` | access-reports-design §4 (เปิดจากเมนู `Analysis → Access...`) |
| `Access for:` | `"click Select Object... located to the right of the Access for: field"` | `https://help.agi.com/stk/` (Access Tool / L1 Training) | access-reports-design §4 (**ต่างตัวพิมพ์/เครื่องหมาย**: spec ใช้ `Access For`) |
| `Select Object...` | `"click Select Object... located to the right of the Access for: field"`, `"in the Select Object dialog box and click OK"` | `https://help.agi.com/stk/` (Access Tool / L1 Training) | access-reports-design §4 (ปุ่มเลือก primary object) |
| `Associated Objects` | `"view the Associated Objects list"`, `"in the Associated Objects list"` | `https://help.agi.com/stk/` (Access Tool / L1 Training) | access-reports-design §4 (รายการเป้าหมาย) |
| `Select All` (คลิกขวาใน Associated Objects) | **ไม่พบ** (พบเฉพาะคำแนะนำให้ multi-select ด้วย Shift/Ctrl หรือ `"Select all the Satellite (...) objects in the Associated Objects list"`) | `https://help.agi.com/stk/` | access-reports-design §4 (คลิกขวา: `Select All`) |
| `Compute` / `Compute Access` | `"Clicking Compute evaluates the geometric intervals"`, `"clicking Compute Access"` | `https://help.agi.com/stk/` (Access Tool; STK ref §F อ้าง `stk/tools-01.htm`) | access-reports-design §4, §9 (ปุ่มคำนวณ) |
| `Clear`, `Clear All`, `Remove`, `Remove All` (ปุ่ม UI ใน Access Tool) | **ไม่พบ** ป้ายปุ่ม UI แบบอ้างตรงตัวบน `help.agi.com` จากผลค้นหา (พบเฉพาะ Connect commands `ClearAccess`, `ClearAllAccess`, `RemoveAccess`, `RemoveAllAccess` และเมนู `Analysis → Remove All Accesses`) | `https://help.agi.com/stk/` (STK ref §F อ้าง `stk/tools-01.htm`) | access-reports-design §4, §9 (ปุ่มล้าง/ลบ) |
| `Advanced...` | **ไม่พบ** ป้ายปุ่ม `Advanced...` ในหน้า Access Tool แบบอ้างตรงตัวบน `help.agi.com` จากผลค้นหา | `https://help.agi.com/stk/` (STK ref §F อ้าง `stk/tools-01.htm`) | access-reports-design §2 (ขอบเขตที่เว้นไว้) |
| `Use Object Time Period` | `"Use Object Time Period"` (`eObjectAccessTime`: `"directs STK to use the individual start and stop times defined for the specific objects"`) | `https://help.agi.com/stk/` (Object Model `AgEAccessTimeType`; STK ref §F อ้าง `stk/tools-01.htm`) | access-reports-design §4 (Time Period) |
| `Use Time Intervals` | **ไม่พบ** ข้อความป้าย UI `"Use Time Intervals"` ตรงตัวใน Access Tool บน `help.agi.com` (พบ `TimeInterval` / `TimeIntervalList` ใน API/Connect) | `https://help.agi.com/stk/` (STK ref §F อ้าง `stk/tools-01.htm`) | access-reports-design §2 (ขอบเขตที่เว้นไว้) |
| `Specify Time Period` | `"Specify Time Period"` (`Start`, `Stop`) | `https://help.agi.com/stk/` (TimePeriod / Export & Access; STK ref §F อ้าง `stk/tools-01.htm`) | access-reports-design §4 (Time Period) |
| `Reports` (`Access...`, `AER...`) / `Graphs` (`Access...`, `AER...`) ใน Access Tool | **ไม่พบ** ป้ายปุ่ม `Access...` / `AER...` ภายในหน้าต่าง Access Tool แบบอ้างตรงตัว (ยืนยันได้เฉพาะชื่อ style `Access`, `AER`, `AERSummary`) | `https://help.agi.com/stk/` (STK ref §F อ้าง `stk/tools-01.htm`) | access-reports-design §4 (Reports / Graphs) |
| `Report & Graph Manager...` | `"Report & Graph Manager..."` | `https://help.agi.com/stk/` | access-reports-design §4 (ปุ่มเปิด Manager) |
| `Add Timeline` | **ไม่พบ** ข้อความป้ายปุ่ม `"Add Timeline"` บน `help.agi.com` (บน Timeline View ใช้ `"Add Time Components"`) | `https://help.agi.com/stk/` | access-reports-design §4 (ปุ่มเพิ่มลง Timeline) |
| `Auto Add to Timeline` | **ไม่พบ** (`search_web` ระบุ: `"No exact matches for the phrase 'Auto Add to Timeline' were found within help.agi.com"`; พบเฉพาะพารามิเตอร์ Connect `AutoAddTimeline On`) | `https://help.agi.com/stk/` (Connect `Access` command) | access-reports-design §4 (ตัวเลือกเพิ่มลง Timeline อัตโนมัติ) |
| `Access Graphics` / `Animation Graphics` | `"Access Graphics"` / `"Animation Graphics"` | `https://help.agi.com/stk/` (2D Graphics / Access & Chain Graphics) | access-reports-design §4 (ส่วนตั้งค่ากราฟิก; spec ใช้ `Animation Graphics`) |
| `Show` | `"Show"` (`"Show (Show Lines)"`) | `https://help.agi.com/stk/` (2D Graphics / Access & Chain Graphics) | access-reports-design §4 (เปิด/ปิดกราฟิก) |
| `Static Highlight` | `"Static Highlight"` (`AccessStatHigh`: `"displays thick lines overlying the ground track of a vehicle during periods when access is achieved"`) | `https://help.agi.com/stk/` (`IAgScGraphics` / Access Graphics) | access-reports-design §4 (เส้นหนาบน 2D) |
| `Animate Highlight` | `"Animate Highlight"` (`AccessAnimHigh`: `"displays visual markers or bounding indicators (such as a box) drawn around the specific objects participating in an active access during the animation sequence"`) | `https://help.agi.com/stk/` (`IAgScGraphics` / Access Graphics) | access-reports-design §4 (กรอบรอบดาวใน 2D) |
| `Show Animate Line` | **ไม่พบ** (`search_web` ระบุ: `"did not return any direct matches"` บน `help.agi.com`; คำที่พบบน `help.agi.com` คือ `"Show Line"`, `"Access Lines"`, `"Show Animation Lines"`) | `https://help.agi.com/stk/` (`IAgScGraphics` / 2D Graphics) | access-reports-design §4 (**ขัดแย้ง**: spec และ STK ref §F ใช้ `Show Animate Line`) |
| `Use Object Colors` / `Use Custom Color` | `"Use Object Colors"` (`ObjectColors`) / `"Use Custom Color"` (`CustomColor`) | `https://help.agi.com/stk/` (Access Graphics `ColorMode` / `Graphics SetAccessGfx`) | access-reports-design §4 (ตัวเลือกสี Access) |
| `Inherit Settings from Scenario` | `"Inherit Settings from Scenario"` | `https://help.agi.com/stk/` (2D/3D Graphics / Access Graphics) | access-reports-design §4 (สืบทอดค่าจาก Scenario) |

---

## 2. Report & Graph Manager (`access-reports-design.md` §5, `stk-reference.md` §F)

| คำ | ข้อความที่อ้างตรงตัว (quote) | URL หน้า help | ใช้กับส่วนไหนของ spec |
|---|---|---|---|
| `Report & Graph Manager` | `"Open the Report & Graph Manager"`, `"Analysis > Report & Graph Manager"` | `https://help.agi.com/stk/Content/stk/ReportManagerStyles.htm` | access-reports-design §5 (ชื่อหน้าต่าง/เมนู) |
| `Object Type` | `"the Object Type selector dropdown at the top left of its window"` | `https://help.agi.com/stk/` (Report & Graph Manager) | access-reports-design §5 (ตัวกรองชนิด object) |
| `All Types` | **ไม่พบ** ข้อความยืนยันรายการ `"All Types"` ใน dropdown `Object Type` แบบอ้างตรงตัวจากผลค้นหา | `https://help.agi.com/stk/` (STK ref §F อ้าง `stk/report.htm`) | access-reports-design §5 (ตัวเลือกทั้งหมด) |
| รายชื่อใน `Object Type` (`Access`, `Facility`, `Satellite` vs `Constellation`) | `"Access, AdvCAT, Aircraft, Antenna, Application, AreaTarget, AttitudeCoverage, AttitudeFigureOfMerit, Chain, CommSystem, CoverageDefinition, Facility, FigureOfMerit, GroundVehicle, LaunchVehicle, LineTarget, Missile, Object Coverage, Place, Planet, Radar, Receiver, Satellite, SatelliteCollection, Scenario, Sensor, Ship, Star, Target, Transmitter, Volumetric"` | `https://help.agi.com/stk/Content/stk/ReportManagerStyles.htm` | access-reports-design §5 (**ขัดแย้ง**: ในรายการ Object Type ของ Report & Graph Manager ไม่มี `Constellation` มีแต่ `Chain`, `SatelliteCollection` ฯลฯ) |
| `Objects` (รายชื่อ object) | **ไม่พบ** ป้ายชื่อกล่องรายการ `"Objects"` แบบอ้างตรงตัว (พบเพียงคำอธิบาย `"choose your specific object"`) | `https://help.agi.com/stk/` | access-reports-design §5 (รายการเลือก object) |
| `Installed Styles` | `"Installed Styles"`, `"The Installed Styles list"` (styles มี lock แก้ตรงไม่ได้) | `https://help.agi.com/stk/` (Report & Graph Manager) | access-reports-design §5 (กลุ่ม style ที่มากับโปรแกรม) |
| `My Styles` | `"My Styles"`, `"Expand the My Styles folder in the Report & Graph Manager"` | `https://help.agi.com/stk/` (Report & Graph Manager) | access-reports-design §5 (กลุ่ม style ของผู้ใช้) |
| `Scenario Styles` | `"Scenario Styles"` | `https://help.agi.com/stk/` (Report & Graph Manager) | access-reports-design §5 (กลุ่ม style ใน scenario) |
| `Show Reports` / `Show Graphs` | `"Show Reports"`, `"Show Graphs"` | `https://help.agi.com/stk/` (Report & Graph Manager; STK ref §F อ้าง `stk/report.htm`) | access-reports-design §5 (ตัวกรอง Report/Graph) |
| `Generate As:` | `"Locate the Generate As: field"` | `https://help.agi.com/stk/` (Report & Graph Manager / Training) | access-reports-design §5 (ช่องเลือกชนิดผลลัพธ์) |
| `Report/Graph` | `"change the selection from the default Report/Graph option"` | `https://help.agi.com/stk/` (Report & Graph Manager) | access-reports-design §5 (ตัวเลือกสร้างแบบนิ่ง) |
| `Dynamic Display/Strip Chart` | `"Dynamic Display/Strip Chart"` | `https://help.agi.com/stk/` (Report & Graph Manager) | access-reports-design §5 (ตัวเลือกสร้างแบบตามเวลา animation) |
| `Generate...` / `Generate` | `"click Generate"` / `"Generate..."` | `https://help.agi.com/stk/` (Report & Graph Manager) | access-reports-design §5 (ปุ่มสร้าง) |
| `New...` | `"New..."` | `https://help.agi.com/stk/` (Report & Graph Manager) | access-reports-design §5 (ปุ่มสร้าง style ใหม่) |
| `Properties...` | `"Properties..."` | `https://help.agi.com/stk/` (Report & Graph Manager) | access-reports-design §5 (ปุ่มแก้ style) |
| `Close` | `"Close"` | `https://help.agi.com/stk/` (Report & Graph Manager) | access-reports-design §5 (ปุ่มปิดหน้าต่าง) |
| คลิกขวา: `Properties` | `"Right-click the style in the Report & Graph Manager and select Properties"` | `https://help.agi.com/stk/Content/stk/ReportManagerStyles.htm` | access-reports-design §5 (เมนูคลิกขวา style) |
| คลิกขวา: `Generate as .txt file...` | **ไม่พบ** เมนูคลิกขวาชื่อ `"Generate as .txt file..."` ในผลค้นหา `help.agi.com` | `https://help.agi.com/stk/` (STK ref §F อ้าง `stk/report.htm`, `stk/report_export.htm`) | access-reports-design §5 (เมนูคลิกขวา style) |
| คลิกขวา: `Generate as .csv file...` | **ไม่พบ** เมนูคลิกขวาชื่อ `"Generate as .csv file..."` ในผลค้นหา `help.agi.com` | `https://help.agi.com/stk/` (STK ref §F อ้าง `stk/report.htm`, `stk/report_export.htm`) | access-reports-design §5 (เมนูคลิกขวา style) |
| คลิกขวา: `Copy to My Styles` | **ไม่พบ** (`search_web` ระบุ: `"The specific phrase 'Copy to My Styles' does not natively appear in the official AGI (STK) product documentation or help site (help.agi.com)"`; เมื่อคลิกขวา `Properties` บน style ที่ล็อก STK จะคัดลอกไปไว้ที่ `My Styles` อัตโนมัติ) | `https://help.agi.com/stk/` | access-reports-design §5 (**ขัดแย้ง**: spec ใส่เป็นรายการเมนูคลิกขวา) |
| คลิกขวา: `Delete` | **ไม่พบ** คำสั่งลบในเมนูคลิกขวาของ Report & Graph Manager (`search_web` ระบุว่าต้องลบไฟล์ `.rst`/`.rsg` ในโฟลเดอร์ `Config\Styles\` เอง) | `https://help.agi.com/stk/` | access-reports-design §5 (**ขัดแย้ง**: spec ใส่เป็นรายการเมนูคลิกขวา) |
| `Use Object Time Period` (กล่องเวลาใน Manager) | `"Use Object Time Period"` | `https://help.agi.com/stk/` (Time Properties) | access-reports-design §5 (ตัวเลือกเวลา) |
| `Specify Time Properties` | `"Specify Time Properties"` | `https://help.agi.com/stk/` (Report & Graph Manager → Time Properties) | access-reports-design §5 (ตัวเลือกเวลากำหนดเอง) |
| `Use default time points` | `"Use default time points"` (`"Using object's default points"`) | `https://help.agi.com/stk/` (Report & Graph Manager → Time Properties) | access-reports-design §5 (step เวลา) |
| `Use step size` | `"Use step size"` | `https://help.agi.com/stk/` (Report & Graph Manager → Time Properties) | access-reports-design §5 (step เวลา) |

---

## 3. หน้าต่างแก้ style (`Properties` / edit style) (`access-reports-design.md` §5.1)

| คำ | ข้อความที่อ้างตรงตัว (quote) | URL หน้า help | ใช้กับส่วนไหนของ spec |
|---|---|---|---|
| `Properties` (หน้าต่างตั้งค่า style) | `"right-click the style and select Properties"` | `https://help.agi.com/stk/Content/stk/ReportManagerStyles.htm` | access-reports-design §5.1 (ชื่อหน้าต่าง) |
| แท็บ/หน้า `Content` | `"Content"`, `"the Content page"` | `https://help.agi.com/stk/` (Report & Graph Style Properties) | access-reports-design §5.1 (แท็บเลือกคอลัมน์) |
| `Data Providers` (ต้นไม้ซ้าย) | `"Data Providers"`, `"expand the desired data provider group on the left"` | `https://help.agi.com/stk/` (Style Properties → Content) | access-reports-design §5.1 (ต้นไม้ซ้าย) |
| `Report Contents` / `Graph Contents` (รายการขวา) | `"Report Contents"`, `"Graph Contents"` | `https://help.agi.com/stk/` (Style Properties → Content) | access-reports-design §5.1 (รายการคอลัมน์ขวา) |
| ปุ่ม `Add`, `Remove`, `Up`, `Down` | `"Remove"` (ยืนยันใน `"click Remove"` สำหรับ Report/Graph Contents); **ไม่พบ** ข้อความป้ายปุ่มตรงตัว `"Add"`, `"Up"`, `"Down"` บน `help.agi.com` จากผลค้นหา | `https://help.agi.com/stk/` | access-reports-design §5.1 (ปุ่มจัดการลำดับ/เพิ่มลบ) |
| แท็บ/หน้า `Time` / `Time Properties` | `"Time"` / `"Time Properties"` | `https://help.agi.com/stk/` (Report & Graph Style Properties) | access-reports-design §5.1 (แท็บตั้งค่าเวลา) |
| แท็บ/หน้า `Summary` | `"Summary"` (ใน Properties Browser ของ Style; ใน Connect/ReportCreate ใช้ `Summary {Include | Only}`) | `https://help.agi.com/stk/` (Report Style Properties / `ReportCreate`) | access-reports-design §5.1 (แท็บสถิติสรุป) |
| `Summary Options` | **ไม่พบ** ป้ายหัวข้อ UI `"Summary Options"` ตรงตัวในแท็บ Summary บน `help.agi.com` (ผลค้นหาพบเฉพาะ Connect options `Summary Include` / `Summary Only`) | `https://help.agi.com/stk/` | access-reports-design §5.1 (ตัวเลือก Summary Options) |
| `Min`, `Max`, `Mean`, `Total`, `Std Deviation`, `Summary Only` (ในแท็บ Summary ของ Style) | ยืนยันคำว่า `"Summary Only"` (ใน Connect `ReportCreate`/`Report_RM`: `"only the summary data is reported"`) และใน AccessSummary/FOM พบ `Min`, `Max`, `Mean`, `Total`, `Standard Deviation`; **ไม่พบ** ข้อความยืนยัน checkbox UI ชื่อ `Min`, `Max`, `Mean`, `Total`, `Std Deviation`, `Summary Only` ในหน้าต่าง Style Properties บน `help.agi.com` | `https://help.agi.com/stk/` | access-reports-design §5.1 (checkbox สถิติท้ายรายงาน) |
| แท็บ/หน้า `Graph` | `"Graph"` / `"Graph Properties"` | `https://help.agi.com/stk/` | access-reports-design §5.1 (แท็บกราฟ) |
| `Graph Type` (`Time XY`, `Interval`, `Polar`) | ยืนยันชนิดกราฟ `"Time XY"`, `"Interval"`, `"Polar"` บน `help.agi.com`; **ไม่พบ** ข้อความยืนยันชื่อ control UI `"Type"` ในหน้าต่าง Graph Properties ตรงตัว | `https://help.agi.com/stk/` | access-reports-design §5.1 (เลือกชนิดกราฟ) |
| `Y Axis` (`Y1`) / `Y2 Axis` (`Y2`) | `"Y Axis (Y1)"`, `"Y2 Axis (Y2)"`, `"Number of Axes: 2"` | `https://help.agi.com/stk/` (Graph Style Properties) | access-reports-design §5.1 (กำหนดแกน Y1/Y2) |

---

## 4. หน้าต่างแสดง Report & Graph (`access-reports-design.md` §6, `stk-reference.md` §F)

### 4.1 หน้าต่าง Report (`access-reports-design.md` §6.1)

| คำ | ข้อความที่อ้างตรงตัว (quote) | URL หน้า help | ใช้กับส่วนไหนของ spec |
|---|---|---|---|
| `Refresh` / `Refresh (F5)` | `"click Refresh on the report toolbar or by pressing the F5 key"`, `"click the Refresh (F5) button on the report toolbar"` | `https://help.agi.com/stk/` (Report Toolbar / L1 Training; STK ref §F อ้าง `stk/report_export.htm`) | access-reports-design §6.1 (แถบเครื่องมือ Report) |
| `Report Units` / `Report Units...` | `"click the Report Units icon on the report toolbar"`, `"select Report Units..."` | `https://help.agi.com/stk/` (Report Toolbar / L1 Training) | access-reports-design §6.1 (ขาดใน spec; อยู่บนแถบเครื่องมือ Report) |
| `Save as quick report` / `Save As Quick Report` | `"click Save as quick report directly on the report toolbar"`, `"Save As Quick Report"` | `https://help.agi.com/stk/` (Report Toolbar / Quick Report Manager) | access-reports-design §2 (ขอบเขตที่เว้นไว้) |
| `Export > To Excel or CSV Format` | `"right-click in the body of the report. Select Export > To Excel or CSV Format"` | `https://help.agi.com/stk/` (`ExportConfig` / Report Export) | access-reports-design §6.1, §2 (**ขัดแย้ง**: spec แยกเป็น `Export ▸ To CSV Format...` และระบุว่าไม่ทำ `To Excel...` แต่ใน STK เป็นเมนูเดียวกันคือ `Export > To Excel or CSV Format` และอยู่บนเมนูคลิกขวาในตัวรายงาน) |
| `Export - Complete` | `"Export - Complete"` | `https://help.agi.com/stk/` (`ExportConfig`) | access-reports-design §6.1 (ตัวเลือก export อีกรูปแบบ) |
| `To CSV Format...` (ใน Report window) | **ไม่พบ** บน `help.agi.com` (ใน STK Desktop ใช้ `To Excel or CSV Format`; คำว่า `Export to CSV...` พบเฉพาะใน STK Scheduler) | `https://help.agi.com/stk/` | access-reports-design §6.1 (**ขัดแย้ง**: ไม่มี `To CSV Format...` แยกใน Report window) |
| `Setup...` (ปุ่มบนแถบเครื่องมือ Report) | **ไม่พบ** บน `help.agi.com` | `https://help.agi.com/stk/` | access-reports-design §6.1 (**ไม่พบ** ปุ่ม `Setup...` บน Report toolbar) |
| `Export Setup` (`Field Delimiter`, `Enclose Header Fields in Quotes`, `Write Report Title`, `Headers`) | **ไม่พบ** ข้อความกล่องโต้ตอบ UI ชื่อ `"Export Setup"`, `"Field Delimiter"`, `"Enclose Header Fields in Quotes"`, `"Write Report Title"` บน `help.agi.com`; พบเฉพาะคำอธิบายและพารามิเตอร์ Connect `ExportConfig`: `Delimiter`, `HeaderInQuotes`, `Quotes`, `Headers`, `UseCommaForDecPnt`, `"writing report titles, object names, section titles, headers, and start/stop times"` | `https://help.agi.com/stk/` (`ExportConfig`) | access-reports-design §3.5, §6.1 (การตั้งค่าส่งออก) |
| `Set Animation Time` (คลิกขวาใน Report) | `"right-click a specific time value (...) and select Set Animation Time directly from the context menu"` | `https://help.agi.com/stk/` (Reports / Timeline) | access-reports-design §6.1 (คลิกขวาที่ช่องเวลา) |
| `Global Statistics` / `Total Duration` | `"Global Statistics"`, `"Total Duration"` | `https://help.agi.com/stk/` (Access Report / L1 Training) | access-reports-design §3.4, §3.5, §6.1 |

### 4.2 หน้าต่าง Graph (`access-reports-design.md` §6.2)

| คำ | ข้อความที่อ้างตรงตัว (quote) | URL หน้า help | ใช้กับส่วนไหนของ spec |
|---|---|---|---|
| `Save` | `"Save: Allows you to save the graph"` / `"Saves any changes made to the current graph style"` | `https://help.agi.com/stk/Content/stk/WorkingWithGraphs.htm` | access-reports-design §6.2 (แถบเครื่องมือ Graph) |
| `Copy to Clipboard` | `"Copy to Clipboard: Creates a copy of the graph image/data so that it can be easily pasted into other applications"` | `https://help.agi.com/stk/Content/stk/WorkingWithGraphs.htm` | access-reports-design §6.2 (แถบเครื่องมือ Graph) |
| `Zoom Out` | `"Zoom Out: Zooms out of the graph by one step"` | `https://help.agi.com/stk/Content/stk/WorkingWithGraphs.htm` | access-reports-design §6.2 (แถบเครื่องมือ Graph) |
| `Refresh` | `"Refresh: Refresh the graph to display any changes"` | `https://help.agi.com/stk/Content/stk/graph-interact.htm` | access-reports-design §6.2 (แถบเครื่องมือ Graph) |
| `Toggle Animation Timeline` / `Toggle Animation Time Line` / `Toggle Time Line` | พบบน `help.agi.com` ทั้ง 3 รูป: `"Toggle Time Line"` (`graph-interact.htm`), `"Toggle Animation Timeline"`, `"Toggle Animation Time Line"` (`"use the Toggle Animation Time Line button on the graph's toolbar"`) | `https://help.agi.com/stk/Content/stk/graph-interact.htm` (และ STK ref §F อ้าง `stk/report-03.htm`) | access-reports-design §6.2 (ปุ่มสลับเส้นเวลา animation; **ต่างตัวพิมพ์/เว้นวรรค**: `Timeline` vs `Time Line`) |
| `Crosshair Cursor` / `Toggle Crosshair` | `"Crosshair Cursor: Displays crosshairs across the width and height of the graph originating from the center of the cursor"` (และพบ `"Toggle Crosshair"`) | `https://help.agi.com/stk/Content/stk/WorkingWithGraphs.htm` | access-reports-design §6.2 (แถบเครื่องมือ Graph) |
| `Properties` (ปุ่มแถบเครื่องมือ) / `Properties...` (คลิกขวา) | `"Properties: Access properties on the Report & Graph Manager"`, `"Properties..."` | `https://help.agi.com/stk/Content/stk/graph-interact.htm` | access-reports-design §6.2 (เปิด properties จากกราฟ) |
| `Hide Toolbar` | `"Hide Toolbar: View the graph without the toolbar displayed"` | `https://help.agi.com/stk/Content/stk/graph-interact.htm` | access-reports-design §6.2 (ปุ่มซ่อนแถบเครื่องมือ) |
| `Show Animation Time Line` | `"Show Animation Time Line"` (`"toggles on or off the display of a vertical marker line that tracks and syncs the current scenario animation time directly across your graph window"`) | `https://help.agi.com/stk/` (STK ref §F อ้าง `stk/report-03.htm` สำหรับเมนูคลิกขวา) | access-reports-design §6.2 (คลิกขวา: `Show Animation Time Line` — สังเกต `Time Line` แยกคำ) |
| `Set Animation Time` | `"Set Animation Time: Sets the current scenario animation time to the specific data point or time value corresponding to where you clicked on the graph"` | `https://help.agi.com/stk/Content/stk/graph-interact.htm` / `WorkingWithGraphs.htm` | access-reports-design §6.2 (คลิกขวาตั้งเวลา) |
| `Set Graph Time` / `Start Time` | `"Set Graph Time"`, `"Start Time"` | `https://help.agi.com/stk/Content/stk/graph-interact.htm` | access-reports-design §6.2 (เมนูคลิกขวาเพิ่มเติมของกราฟ) |
| `Export` / `Export Dialog` | `"You can display the Export Dialog by choosing the Export option from a graph's pop-up menu"` | `https://help.agi.com/stk/` (Working with Graphs) | access-reports-design §6.2 (**ขัดแย้งเล็กน้อย**: ชื่อเมนูคลิกขวาคือ `Export` ซึ่งเปิดหน้าต่าง `Export Dialog` ไม่ใช่ชื่อเมนู `Export Dialog...`) |

---

## 5. `Dynamic Display` และ `Strip Chart` (`access-reports-design.md` §5, §6.1, §6.2)

| คำ | ข้อความที่อ้างตรงตัว (quote) | URL หน้า help | ใช้กับส่วนไหนของ spec |
|---|---|---|---|
| `Dynamic Display` | `"Dynamic Displays: Reports that update continuously during scenario animation, allowing you to monitor numerical changes to selected elements over a period of time"` | `https://help.agi.com/stk/` (Report & Graph Manager) | access-reports-design §5, §6.1 |
| `Strip Chart` | `"Strip Charts: Graphs that update dynamically during scenario animation to visually track changes to selected elements over a period of time"` | `https://help.agi.com/stk/` (Report & Graph Manager) | access-reports-design §5, §6.2 |
| `Dynamic Display/Strip Chart` | `"Locate the Generate As: field and change the selection from the default Report/Graph option to Dynamic Display/Strip Chart"` | `https://help.agi.com/stk/` (Report & Graph Manager) | access-reports-design §5 (`Generate As`) |
| `Strip Chart Duration` | **ไม่พบ** ข้อความ `"Strip Chart Duration"` บน `help.agi.com` | `https://help.agi.com/stk/` | access-reports-design §6.2 (**ไม่พบ** ป้ายตัวเลือกชื่อ `Strip Chart Duration` ในเอกสาร `help.agi.com`) |

---

## 6. หมายเหตุสำหรับส่วนที่ 7 ของ design doc (`Validation`)

- หัวข้อ **7. หน้า Validation** ใน `2026-11-11-gnss-studio-access-reports-design.md` ติดป้ายไว้ชัดเจนว่า `**(เพิ่มเอง)**` จึงไม่มีคำศัพท์ UI คู่เทียบใน STK (`help.agi.com`)

---

## สรุปข้อแตกต่าง/ข้อขัดแย้งระหว่างเอกสาร spec/STK ref กับ `help.agi.com`

1. **แถบเครื่องมือที่มีปุ่ม `Access`**:
   - ใน `access-reports-design.md` §4 ระบุว่า `ปุ่ม Access บนแถบ Default`
   - ใน `help.agi.com` ระบุตรงตัวว่าอยู่บนแถบ **`STK Tools`** (`"Click Access on the STK Tools toolbar"`) ส่วนแถบ `Default` มี `Insert Object`, `Save`, `New Web Browser Window` (ตามที่ `stk-reference.md` §A ระบุไว้แล้วเช่นกัน)
2. **การสะกด `Access For` vs `Access for:`**:
   - ใน `access-reports-design.md` §4 ใช้ `Access For`
   - ใน `help.agi.com` ใช้ **`Access for:`** (ตัว `f` เล็กและมี `:`)
3. **ตัวเลือก `Show Animate Line` vs `Show Line` / `Access Lines`**:
   - ใน `access-reports-design.md` §4 และ `stk-reference.md` §F ใช้ `Show Animate Line`
   - จากการค้นหา `site:help.agi.com "Show Animate Line"` **ไม่พบ** คำนี้บน `help.agi.com` (คำที่ปรากฏบน `help.agi.com` คือ **`Show Line`**, **`Access Lines`**, **`Show Animation Lines`**)
4. **`Auto Add to Timeline` และ `Add Timeline`**:
   - ใน `access-reports-design.md` §4 และ `stk-reference.md` §F ระบุปุ่ม `Add Timeline` และ checkbox `Auto Add to Timeline`
   - จากการค้นหา `site:help.agi.com` **ไม่พบ** วลี `"Auto Add to Timeline"` หรือปุ่ม `"Add Timeline"` ตรงตัว (พบเฉพาะ Connect command parameter `AutoAddTimeline On` และปุ่มบน Timeline View ชื่อ `Add Time Components`)
5. **เมนู `Object Type` ใน Report & Graph Manager (`Constellation`)**:
   - ใน `access-reports-design.md` §5 ระบุ `Constellation` อยู่ใน `Object Type` ของ Report & Graph Manager
   - รายการ `Object Types` ของ Report & Graph Manager บน `help.agi.com` (`ReportManagerStyles.htm`) **ไม่มี `Constellation`** (มี `Access`, `Chain`, `Satellite`, `SatelliteCollection`, `Facility`, `Scenario` ฯลฯ)
6. **เมนูคลิกขวาใน Report & Graph Manager (`Copy to My Styles`, `Delete`, `Generate as .txt file...`, `Generate as .csv file...`)**:
   - **ไม่พบ** `Copy to My Styles` บน `help.agi.com` (เอกสารระบุว่าถ้าเปิด `Properties` บน style ที่ล็อก STK จะสร้างสำเนาลง `My Styles` ให้อัตโนมัติ)
   - **ไม่พบ** `Delete` ในเมนูคลิกขวาของ Report & Graph Manager (เอกสารระบุว่าต้องลบไฟล์ `.rst`/`.rsg` ในโฟลเดอร์ `Config\Styles\` ด้วยตนเอง)
   - **ไม่พบ** `Generate as .txt file...` และ `Generate as .csv file...` ตรงตัวจากผลค้นหา `help.agi.com` (หมายเหตุ: `stk-reference.md` §F เคยอ้างถึงจากหน้า `stk/report.htm` และ `stk/report_export.htm` ซึ่งผล `search_web` ไม่พบข้อความเมนูนี้)
7. **การส่งออกจากหน้าต่าง Report (`To CSV Format...` / `To Excel...` / `Setup...`)**:
   - ใน `access-reports-design.md` §6.1 ระบุแถบเครื่องมือ `Export ▸ To CSV Format..., Setup...` และ §2 ระบุว่าไม่ทำ `ส่งออก To Excel...`
   - บน `help.agi.com` เมนูคลิกขวาในตัวรายงานคือ **`Export > To Excel or CSV Format`** (รวมอยู่ในรายการเดียว ไม่ใช่ `To CSV Format...` แยก) และแถบเครื่องมือของหน้าต่าง Report ที่พบบน `help.agi.com` มี **`Refresh (F5)`**, **`Report Units`**, **`Save as quick report`** (**ไม่พบ** ปุ่ม `Setup...` และ **ไม่พบ** ชื่อ dialog/ฟิลด์ UI `Export Setup`, `Field Delimiter`, `Enclose Header Fields in Quotes`, `Write Report Title` ตรงตัวบน `help.agi.com` — พบเฉพาะคำสั่ง Connect `ExportConfig` ได้แก่ `Delimiter`, `HeaderInQuotes`, `Quotes`, `Headers`, `UseCommaForDecPnt`)
8. **ความสม่ำเสมอของ `Timeline` vs `Time Line` และ `Export` vs `Export Dialog...` ในหน้าต่าง Graph**:
   - ปุ่มบนแถบเครื่องมือ Graph บน `help.agi.com` พบบันทึกต่างกันระหว่างหน้า: **`Toggle Time Line`** (`graph-interact.htm`), **`Toggle Animation Time Line`**, และ **`Toggle Animation Timeline`**; ส่วนเมนูคลิกขวาพบ **`Show Animation Time Line`** (`Time Line` แยกสองคำ)
   - เมนูคลิกขวาสำหรับส่งออกกราฟบน `help.agi.com` ชื่อ **`Export`** (ซึ่งเปิดหน้าต่าง **`Export Dialog`**) ไม่ใช่เมนูชื่อ `Export Dialog...`
9. **`Strip Chart Duration`**:
   - **ไม่พบ** คำว่า `"Strip Chart Duration"` บน `help.agi.com`
