# Earth Observation Demo — แผนแยกสำหรับ 3 พื้นที่

วันที่จัดทำ: 15 พฤศจิกายน 2569 (2026-11-15, เวลาไทย)

เอกสารนี้ต่อยอดจากแผน “เดโมภาพดาวเทียมสุวรรณภูมิ 2 ระดับ” ของผู้ใช้ โดยใช้โครงสร้างหน้าจอจาก GNSS Studio ที่เลียนแบบ STK และเพิ่มรอตเตอร์ดัมกับสิงคโปร์ รวมเป็น 3 พื้นที่ มีแอปเดโมและ pipeline อ่านภาพจริงแล้ว ดูวิธีเปิดและขอบเขตที่ใช้งานได้ใน [USAGE.md](USAGE.md) ส่วนด้านล่างเก็บแผนพัฒนาและเกณฑ์วิจัยไว้สำหรับต่อยอด

แอปมีภาพขนาดใหญ่และหน้าเลื่อนแนวตั้ง พร้อมเมนู **Image style** สำหรับ SAR ขาวดำ, Viridis, Inferno, Umbra CSI RGB และ Sentinel-2 สีธรรมชาติ ทั้ง Full Scene และ ROI โดยแสดงแหล่งข้อมูล วันถ่าย และความละเอียดต้นทางของภาพสีแยกจาก SAR ดูรายละเอียดและการเก็บแคช BigTIFF ใน [USAGE.md](USAGE.md)

## 1. ข้อเสนอหลัก

ทำส่วนใหม่ชื่อ **Earth Observation Demo** แยกจากงานพยากรณ์ GNSS แต่ใช้โครง workspace, หน้าต่าง 2D/3D, Timeline, Properties และระบบ job ร่วมกันผ่านส่วนเชื่อมต่อที่ชัดเจน ให้แต่ละพื้นที่มีข้อมูลและผลวิเคราะห์ของตัวเอง และมีหน้ารวมสำหรับเปรียบเทียบทั้งสาม

แบ่งงานเป็น 3 ส่วน:

1. **หลายวันและหลายมุม:** เปิดภาพจริง เปรียบเทียบมุมถ่าย ตรวจจับวัตถุและการเปลี่ยนแปลง
2. **ภายในช่วงรับสัญญาณเดียว:** ทดลองสร้าง sub-aperture sequence จาก SICD/CPHD ตรวจหลักฐานการเคลื่อนไหวและความละเอียดที่เหลือ
3. **ส่วนใหม่สำหรับ 3 พื้นที่:** ใช้ workspace แบบ STK เชื่อมภาพจริงกับตำแหน่งดาวเทียมและแสดงผลเปรียบเทียบข้ามพื้นที่

ผลส่งมอบหลักเริ่มจากส่วน 1 และ 3 ส่วน 2 เป็นงานทดลองที่ต้องผ่านการตรวจข้อมูลและเรขาคณิตก่อนกำหนดจำนวนคลิปหรือรับรองความเร็ว

## 2. พื้นที่ที่เลือกและหลักฐานข้อมูล

เลือก **ท่าเรือสิงคโปร์** เป็นพื้นที่ที่สาม เพราะมี time series ในแหล่ง Umbra เดียวกัน ใช้เปรียบเทียบงานท่าเรือกับรอตเตอร์ดัม และทดสอบว่าแบบจำลองที่ฝึกจากพื้นที่หนึ่งใช้กับอีกพื้นที่ได้เพียงใด

อ่าน S3 listing แบบไม่ใช้บัญชีของทั้งสาม prefix และอ่าน STAC sidecar ทั้งหมดที่พบ ได้ 146 รายการ ไม่ได้ดาวน์โหลด GEC/SICD/CPHD ทั้งไฟล์ ตัวเลขในตารางหมายถึง **ชุดที่มี STAC sidecar ภายใต้ prefix ที่ระบุ** และตรวจชื่อไฟล์ผลิตภัณฑ์จาก listing ในโฟลเดอร์เดียวกัน ไม่ใช่จำนวนภาพทั้งหมดทั่วแคตตาล็อก

| พื้นที่ | ฉาก/วัน UTC ที่ไม่ซ้ำ | ช่วงเวลาถ่ายที่พบ | GEC / SICD | CPHD / CSI ที่พบเป็นไฟล์สาธารณะ | Resolution ที่ระบุใน STAC: azimuth / range |
|---|---:|---|---:|---:|---|
| สุวรรณภูมิ | 49 / 49 | 15 พ.ย. 2024–16 พ.ย. 2025 | 49 / 49 | 6 / 6 | 0.125 / 0.25 ม. |
| รอตเตอร์ดัม | 55 / 49 | 21 ธ.ค. 2024–19 พ.ย. 2025 | 55 / 55 | 2 / 2 | 0.175 / 0.35 ม. |
| สิงคโปร์ | 42 / 42 | 28 พ.ย. 2024–18 พ.ย. 2025 | 42 / 42 | 3 / 3 | ส่วนใหญ่ 0.175 / 0.35 ม.; หนึ่งภาพ azimuth 0.1167 ม. |

ความละเอียดข้างต้นเป็นค่าของผลิตภัณฑ์ตาม metadata ไม่ใช่ระยะพิกเซลบนแผนที่หรือคำรับรองว่าเห็นรถทุกคัน ต้องอ่าน GeoTIFF transform และ SICD impulse response เพิ่มก่อนกำหนดขนาดวัตถุเป็นพิกเซล

**ความต่างจากแผนเดิม:** เอกสารผู้ใช้ระบุ CPHD และ CSI ของสุวรรณภูมิ 43 ภาพ แต่การตรวจโฟลเดอร์สาธารณะของชุด 49 STAC ครั้งนี้พบอย่างละ 6 ภาพ ต้องเก็บข้อแตกต่างนี้ไว้เป็นรายการตรวจสอบ ไม่รับรอง 43 ภาพจากลิงก์ใน STAC อย่างเดียว เพราะหลาย asset href ชี้ไป `prod-prod-*` ซึ่งไม่ใช่ public bucket ที่กำลังสำรวจ

สุวรรณภูมิทั้ง prefix มีโฟลเดอร์ฉาก 192 ชุดจากหลายปี แต่มีเพียง 49 STAC sidecar ที่พบครั้งนี้ ภาพเก่าที่ไม่มี STAC เป็นโอกาสขยายชุดข้อมูลภายหลัง ต้องตรวจ metadata และ deduplicate ก่อนนำมารวม ผลสำรวจนี้ไม่ได้ยืนยันว่าไม่มี CPHD ของฉากเดียวกันใน prefix อื่น

หลักฐานประกอบอยู่ใน `research/catalog-scenes.csv`, `research/footprints.geojson`, `research/catalog-summary.json` และ `research/public-asset-head-checks.json` โดยทุกแถวมี URL metadata สาธารณะและตำแหน่งไฟล์ที่พบ

### 2.1 สุวรรณภูมิ — สนามบินและการจราจร

- ศูนย์กลางกรอบข้อมูลโดยประมาณ: 13.6907°N, 100.7500°E; วิเคราะห์ใน UTM 47N (EPSG:32647)
- เลือก ROI 500×500 ม. รอบถนนเข้าอาคาร ลานจอดกลางแจ้ง และบริเวณบริการที่ภาพครอบคลุมจริง
- งานหลัก: candidate รถ, จำนวนที่ตรวจเห็นต่อพื้นที่ที่มองเห็นได้, ผิวถนน และการเปลี่ยนแปลงรายโซน
- แยกเครื่องบินและอุปกรณ์ภาคพื้นออกจากรถ ไม่อ้างจำนวนรถในอาคารหรือชั้นที่เรดาร์มองไม่เห็น
- เริ่ม 4 ภาพตัวแทนตามแผนเดิม แต่ยืนยันมุมและคุณภาพจากไฟล์จริงก่อนเลือก

### 2.2 รอตเตอร์ดัม — ท่าเรือและพื้นที่อุตสาหกรรม

- ศูนย์กลางกรอบข้อมูลโดยประมาณ: 51.8849°N, 4.2867°E; UTM 31N (EPSG:32631)
- footprint ที่อ่านได้อยู่แถบ **Botlek–Pernis/Vondelingenplaat** โดยประมาณ จึงให้เริ่มตรวจท่าเทียบเรือ ถนน และลานในบริเวณนี้ ต้อง overlay แผนที่ทางการก่อนล็อกชื่อ terminal และ ROI
- ไม่เลือก Maasvlakte อัตโนมัติจากชื่อ “Port of Rotterdam” เพราะอยู่คนละตำแหน่งกับชุด footprint ที่พบ
- งานหลัก: ตรวจเรือในน้ำ/ริมท่า, การมีวัตถุในแต่ละ berth ณ เวลาถ่าย, candidate รถบรรทุกในลานเปิด และการเปลี่ยนแปลงของพื้นที่ลาน
- ระยะแรกไม่ประเมินปริมาตรน้ำมันในถังหรือปริมาณสินค้าจริงจากความสว่างเรดาร์
- ใช้ข้อมูลลมและระดับน้ำเป็นตัวแปรบริบท หากเข้าถึงข้อมูลย้อนหลังได้ตรงเวลา ไม่ถือว่าบริการ real-time ให้ประวัติฟรีเสมอ

พื้นที่ Botlek/Vondelingenplaat เป็นเขตท่าเรือและอุตสาหกรรมปิโตรเคมีตาม [Port of Rotterdam](https://www.portofrotterdam.com/en/building-port/safe-port/flood-risk-management/botlek-and-vondelingenplaat) ส่วนแผนที่ terminal ใช้ตรวจขอบเขตเพิ่มเติมจาก [แผนที่ทางการ](https://www.portofrotterdam.com/sites/default/files/2021-06/container-terminals-and-depots-in-the-rotterdam-port-area.pdf)

### 2.3 สิงคโปร์ — ท่าเรือเมืองและพื้นที่ริมน้ำ

- ศูนย์กลางกรอบข้อมูลโดยประมาณ: 1.2640°N, 103.8381°E; UTM 48N (EPSG:32648)
- footprint ที่พบอยู่บริเวณ **Keppel–Brani และพื้นที่ริมน้ำใกล้เคียง** โดยประมาณ ต้องตรวจ polygon กับแผนที่ก่อนล็อก ROI ไม่ถือว่าครอบคลุม Tuas หรือ Pasir Panjang ทั้งหมด
- งานหลัก: เรือและพื้นที่ริมน้ำ, การมีเรือริมท่าตามภาพ, ถนนและลานเปิดที่อยู่ใน footprint และการเปลี่ยนแปลงภายในเขตที่ตีกรอบ
- ใช้เป็นพื้นที่ทดสอบแบบจำลองที่พัฒนาจากรอตเตอร์ดัม โดยแยกผลเรือ/รถและคุณภาพตามขนาดวัตถุ
- ไม่ตีความการเปลี่ยนแปลงในปี 2024–2025 ว่าเป็นสถานการณ์ปัจจุบัน และไม่ใช้ชื่อ terminal อย่างเดียวตัดสินการใช้งานในแต่ละช่วงปี

รายชื่อเขตท่าเรืออ้างอิงจาก [Maritime and Port Authority of Singapore](https://www.mpa.gov.sg/port-marine-ops/operations/port-infrastructure/terminals) การเลือกตำแหน่งย่อยเป็นข้อเสนอที่อนุมานจาก footprint ของ Umbra ไม่ใช่ขอบเขต terminal ที่ผู้ให้ข้อมูลรับรอง

## 3. โครงสร้าง GNSS Studio ที่นำกลับมาใช้

ต้นทางที่ตรวจคือ `.worktrees/gnss-studio-imagery/api-interop/gnss-predict/` โค้ดส่วนนี้เป็น GNSS Studio ที่ทำหน้าจออิง STK ต้องเพิ่มความสามารถอ่านข้อมูล EO จริง ไม่ได้มี pipeline SAR อยู่แล้ว

| ส่วนเดิม | ไฟล์/โฟลเดอร์ต้นทาง | ใช้กับงานใหม่ | งานที่ต้องเพิ่ม |
|---|---|---|---|
| Workspace และหน้าต่าง | `web/src/Workspace.tsx`, `layout/panels.ts`, `stores/layout.ts` | แผงเลือกพื้นที่ หน้าต่างภาพ/กราฟ จัด layout | โหมด EO และทะเบียน panel ของ EO |
| การบันทึก layout | `web/src/layout/workbook.ts` | จำพื้นที่ ภาพ และการจัดหน้าต่าง | บันทึก selection/layers ของ EO |
| Object Browser / Properties | `web/src/windows/ObjectBrowser/`, `PropertiesBrowser/` | Site, AOI, Satellite, Acquisition, Analysis Run | โครง object และ properties ของ EO |
| 2D / 3D | `windows/Graphics2D/`, `Graphics3D/`, `cesium/viewer.ts` | footprint ภาพจริง ตำแหน่งดาวและเส้นส่อง | image/tile layer จาก GEC และ ephemeris adapter |
| Sensor View | `web/src/windows/SensorView/` | มุมกล้องและบริบททิศมอง | Image View แยกสำหรับ SAR จริง; camera เดิมแสดงฉากจำลอง |
| เวลาและ Timeline | `stores/time.ts`, `windows/TimelineView/` | จุดเวลา acquisition และช่วงรับสัญญาณ | เวลาแบบไม่ต่อเนื่องและโหมด sub-aperture |
| Globe Manager | `windows/GlobeManager/` | เปิดปิด layer / opacity / แหล่งที่มา | SAR layers และผลตรวจจับแบบเลือก scene |
| FastAPI, job, SSE | `server/gnss_studio_server/jobs.py`, `events.py`, `routes/` | งาน ingest, crop, registration, detect, sequence | ชนิด job, resource limits และผลลัพธ์ของ EO |
| Message Viewer | `web/src/windows/MessageViewer/` | แสดงคุณภาพข้อมูลและข้อผิดพลาด | คำแจ้งของ EO พร้อมลิงก์ไป run ที่ผิด |

**ส่วนที่ต้องสร้างใหม่:** catalog adapter, public asset resolver, GEC/COG reader, SAR calibration, image registration, detector, sub-aperture processor, image comparison และรายงานประเมินความแม่น GNSS engine เดิมไม่ใช่ engine สำหรับดาวเทียมสำรวจโลกทั่วไป

schema เดิมจำกัด class เป็น Facility/Satellite/Constellation/Sensor และข้อมูลวงโคจรมุ่ง GNSS จึงใช้เอกสารโครงการ EO รุ่นของตัวเอง ห้ามใส่ Umbra เป็นดาว GNSS แล้วหวังให้ engine เดิมคำนวณได้ ต้องมี adapter สำหรับ ephemeris จาก metadata

การแยกงานที่เสนอ:

```text
api-interop/earth-observation-demo/
  README.md                 # แผนฉบับนี้ — มีแล้ว
  research/                 # ผลตรวจ metadata — มีแล้ว
  config/sites.json         # ขั้นพัฒนา: Site, timezone, CRS, AOI
  eo_engine/                # ขั้นพัฒนา: Python pipeline
  server/                   # ขั้นพัฒนา: EO routes / job adapters
  web/                      # ขั้นพัฒนา: entry point EO ใช้ workspace components
  notebooks/                # ขั้นพัฒนา: ทดลองและตรวจผลซ้ำบน Colab
  tests/                    # ขั้นพัฒนา: correctness ที่เป็นสาระสำคัญ
  data/                     # ขั้นพัฒนา: cache/ผลลัพธ์ในเครื่อง ไม่เก็บภาพใหญ่ใน Git
```

ขั้นแรกทำ thin vertical slice แยก entry point จาก source snapshot ที่ระบุ commit แล้วค่อยดึงส่วน UI ที่ใช้ร่วมกันออกเป็น shared components เมื่อเส้นทางเปิดภาพจริงใช้ได้ การย้ายโค้ด shared เป็นงาน dependency ต้องวางแผนชัดเจน ไม่เพียงคัดลอกโฟลเดอร์แล้วอ้างว่าเชื่อมกันแล้ว

## 4. หน้าจอของส่วนใหม่

ชื่อเมนูและปุ่มใช้ภาษาอังกฤษให้สอดคล้องกับโปรแกรมเดิม ข้อความอธิบายใช้ภาษาไทย ชื่อหน้าต่างต่อไปนี้เป็นชื่อที่เสนอเพิ่มเอง ไม่ใช่คำที่ตรวจรับรองว่ามีใน STK

```text
Earth Observation Demo       [Site: Suvarnabhumi / Rotterdam / Singapore]
┌────────────────┬───────────────────────┬────────────────────────┐
│ Object Browser │ 2D Image View         │ 3D Geometry View       │
│ Site / AOIs    │ SAR + ROI + detections│ ดาว + footprint + LOS  │
│ Acquisitions   ├───────────────────────┼────────────────────────┤
│ Satellites     │ Before / After        │ Sky Plot / Metrics     │
│ Analysis Runs  │ swipe / four-view     │ counts + quality       │
├────────────────┴───────────────────────┴────────────────────────┤
│ Acquisition Timeline / Collect Timeline                        │
├────────────────────────────────────────────────────────────────┤
│ UTC / Local Time | source | resolution | quality | job progress │
└────────────────────────────────────────────────────────────────┘
```

- **Site Selector:** เลือกพื้นที่แล้วเปลี่ยน AOI, timezone, layers และ acquisition list พร้อมกัน
- **Acquisition Catalog:** กรองวัน ดาว polarization มุม ความละเอียด และไฟล์ที่เปิดได้จริง
- **Image View:** ภาพจริง SAR พร้อม dB stretch, scale bar, pixel size, coordinate readout, nodata และ attribution
- **Compare View:** 2 ภาพแบบ swipe หรือ 4 ภาพบน ROI เดียวกัน พร้อมระบุว่าคู่ไหนผ่าน quality check แล้ว
- **3D Geometry View:** trajectory ที่มีข้อมูลรองรับ, จุดดาว ณ เวลาถ่าย, เส้นจาก ARP ไป ROI, footprint และข้อมูล uncertainty/source
- **Sky Plot:** คำนวณ azimuth/elevation จากเวกเตอร์ ECEF ที่ตำแหน่ง ROI ไม่ใช้ค่ามุมที่อาจนิยามคนละทิศโดยตรง
- **Analysis:** เลือก pipeline, ROI และค่าพารามิเตอร์ เริ่ม/ยกเลิก job และเปิดผลเดิมได้
- **Sequence View:** แสดง frame time window, aperture fraction, ความละเอียดและจำนวนเฟรมที่เกิดจากช่วงทับซ้อน
- **Cross-site Comparison:** เปรียบเทียบ precision/recall, false alarms, count error, visibility และมุมถ่าย ภายใต้นิยามตัวชี้วัดเดียวกัน

ไม่จำเป็นต้องเปิด Cesium แยก 3 ตัวพร้อมกันในหน้าเปรียบเทียบ เริ่มจาก viewer กลางหนึ่งชุดกับภาพ ROI/กราฟสามคอลัมน์ เพื่อลดการใช้ GPU

เวลาเก็บเป็น UTC เสมอ แสดง timezone ของพื้นที่ได้: `Asia/Bangkok`, `Europe/Amsterdam` และ `Asia/Singapore` รอตเตอร์ดัมต้องคำนวณ DST ตามวันที่ ไม่บวกค่าคงที่

## 5. แบบข้อมูลและ API ที่เสนอ

| Entity | ข้อมูลที่ต้องเก็บ |
|---|---|
| Site | id, name, timezone, processing CRS, approved AOIs |
| Acquisition | STAC id, collect id, task id, platform, UTC start/mid/end, footprint, polarization, orbit state, original geometry fields |
| Asset | product type, original href, resolved public URL, bytes, ETag/checksum ถ้ามี, access status, calibration state |
| Ephemeris | frame, units, epoch, valid interval, position/velocity model, source, uncertainty/quality flag |
| AnalysisRun | scene ids, AOI version, parameters, code/model version, input checksums, status, outputs, quality metrics |
| Detection | scene, class, geometry, confidence, visible zone, manual review status |
| SequenceFrame | collect, start/center/end time, aperture support, frame CRS/geolocation, resolution, output URL |

ห้ามใช้ชื่อโฟลเดอร์แทนเวลา metadata: ตัวอย่างที่อ่านพบชื่อไฟล์และชื่อโฟลเดอร์ต่างกันหลายวินาที ใช้ collect id + product processing version และเวลาจาก metadata แล้วบันทึกการจับคู่ไว้

API namespace ที่เสนอ: `/api/eo/sites`, `/api/eo/acquisitions`, `/api/eo/assets/{id}/tiles/{z}/{x}/{y}`, `/api/eo/runs`, `/api/eo/ephemerides`, `/api/eo/exports` ใช้ job queue และ SSE adapter จากเดิมได้เมื่อแยกชนิดงานและ data root แล้ว ชื่อเหล่านี้ยังไม่ได้ implement

งาน crop จาก remote ใช้ windowed read ได้เมื่อไฟล์รองรับ layout/Range ที่มีประสิทธิภาพ ต้องตรวจ header และ block/overview ก่อน ไม่ถือว่า GeoTIFF ทุกไฟล์เป็น COG ใช้ tiled derivatives/cache สำหรับหน้าเว็บ ไม่ส่ง SICD หลาย GB เข้า browser

## 6. งานประมวลผลและการทดลองที่เพิ่ม

### A. Inventory และคัดภาพ

1. อ่านทั้งสาม prefix พร้อม pagination เก็บ snapshot และเวลาตรวจ
2. ตรวจ footprint กับ AOI จริงและสัดส่วนพื้นที่ที่ใช้วิเคราะห์ได้
3. resolve asset จาก public listing แล้วตรวจ HEAD/Range โดยเก็บลิงก์ต้นฉบับไว้ คู่มือ/metadata อาจอ้างผลิตภัณฑ์ที่ไม่ได้เผยแพร่
4. แยกกลุ่มด้วย polarization, orbit/look geometry, incidence, azimuth แบบวงกลม, resolution, looks และ processor version
5. เลือก 4 ภาพต่อพื้นที่เริ่มต้น รวม 12 ภาพ หากบางกลุ่มไม่มีภาพใช้กลุ่มที่มีจริง ไม่บังคับให้ครบสี่ทิศ
6. เลือกคู่ใกล้มุมอย่างน้อย 1 คู่ต่อพื้นที่เมื่อมีข้อมูล แล้วบันทึกคู่ที่ไม่ผ่านเกณฑ์แยกไว้

### B. เปิดภาพจริงและเรขาคณิต

1. ทดลองอ่าน ROI หนึ่งภาพต่อพื้นที่ รวม 3 ภาพ พร้อมตรวจ pixel spacing, CRS, nodata และ radiometric meaning
2. ทำเส้นทาง click acquisition → เวลาเดียวกันในภาพ/3D/sky plot
3. อ่าน ARP position model จาก SICD หรือ PVP/trajectory จาก CPHD ประเมินในช่วงเวลาที่มีข้อมูลและแปลงเป็น ECEF/WGS84 อย่างถูกต้อง
4. ตำแหน่งนี้เป็นค่าที่ผู้ผลิตให้ใน metadata ไม่ใช่ ground truth อิสระ การเทียบกับ geometry ที่คำนวณย้อนเป็น consistency check
5. หากมีเพียง center geometry ให้แสดงจุดพร้อมป้าย “estimated” ไม่สร้าง trajectory เต็มวงโดยไม่มีข้อมูล

### C. ข้ามวัน: รถ เรือ ถนน และการเปลี่ยนแปลง

1. เก็บภาพเชิงปริมาณแยกจากภาพสำหรับแสดงผล ตรวจ amplitude/power และการ calibration ตามผลิตภัณฑ์ ไม่คูณค่าของ SICD ลง GEC ที่อาจถูก calibration แล้วโดยตรง
2. เก็บข้อมูล native resolution; สร้างกริด 0.25 ม. ของสุวรรณภูมิ และเลือกกริดเหมาะกับข้อมูลท่าเรือหลังอ่านจริง การ upsample ไม่เพิ่มรายละเอียด
3. co-register บนพื้นที่นิ่งภายใน geometry group ใช้จุดตรวจที่ไม่ได้ใช้ fit วัด residual ไม่ใช้จุดเรือ/รถเป็น tie point
4. ทำ road/parking/water/berth masks จาก OSM + การตรวจภาพด้วยมือ แยก shadow, layover, nodata และพื้นที่ไม่แน่ใจ
5. รักษา unfiltered branch สำหรับรถขนาดเล็ก ทดลอง speckle filter กับข้อมูลจริงก่อนเลือก Lee 5×5 เพราะอาจลบเป้าหมายเล็ก
6. ใช้ CFAR เป็น baseline ของ candidate ไม่ถือว่าทุกจุดสว่างเป็นรถ ฝึก YOLO-OBB เมื่อมี label ตรวจแล้วและข้อมูลพอ
7. ท่าเรือใช้ water mask กับ detector สำหรับเรือ แยกโมเดล/เกณฑ์ขนาดจากรถ และระวัง crane/คลื่น/เรือชิดกัน
8. ใช้ log-ratio/change map เฉพาะคู่ที่เทียบได้ ควบคู่ mask และ QA ไม่แปลง brightness change เป็นจำนวนวัตถุโดยตรง
9. รายงานจำนวนที่ตรวจเห็นและ density ต่อพื้นที่ที่มองเห็นได้ ไม่เท่ากับจำนวนรถหรือความหนาแน่นจริงทั้งหมด
10. ท่าเรือรายงานสถานะ berth เฉพาะเวลาถ่าย ไม่คำนวณเวลาจอดต่อเนื่อง/throughput รายวันจากภาพห่างหลายวัน

### D. ภายใน collect เดียว: sub-aperture sequence

1. เริ่ม CSI เป็นตัวช่วยดูความแตกต่างเชิงมุม CSI มีสีต่างกันได้จากทั้งการเคลื่อนไหวและการสะท้อนที่ขึ้นกับมุม
2. ทดลอง SICD ตามชนิด image formation โดยใช้เครื่องมือ [sarpy ของ NGA](https://github.com/ngageoint/sarpy/blob/master/sarpy/processing/sicd/subaperture.py) ที่มี deskew/normalization และ sub-aperture support ไม่ทำ FFT ตามแกนที่เดาเอง
3. เริ่ม 4/8/16 เฟรม วัด resolution กับการคงตำแหน่งวัตถุนิ่งทุกกรณี เก็บ aperture support ของแต่ละเฟรมและระบุว่าเฟรมทับซ้อนกันจึงไม่เป็นอิสระ
4. การแปลง spectral sub-aperture เป็นเวลาต้องตรวจ mapping ของผลิตภัณฑ์ หากยังทำไม่ได้ให้แสดงเป็น aspect sequence ไม่มี timestamp ต่อเฟรมที่อ้างความแม่นเกินข้อมูล
5. CPHD ใช้เวลา/PVP และ trajectory ที่มีจริงสร้างภาพด้วย back-projection เฉพาะ ROI เล็กก่อน ประเมิน RAM/GPU จากขนาดไฟล์ที่ตรวจได้ ไม่ใช้สมมติฐาน 600 MB ต่อภาพ
6. ลบพื้นหลังและติดตามเป็น candidate motion ต้องแยก apparent motion จาก parallax, sidelobes, defocus และการเปลี่ยนมุม
7. สูตร displacement เชิงประมาณในแผนเดิมใช้เป็น intuition เท่านั้น การเลือกถนนใกล้ที่สุดไม่ได้ทำให้ได้ความเร็วที่เป็นคำตอบเดียว ต้องมี moving-target model, geometry และ uncertainty พร้อมข้อมูลตรวจสอบอิสระ
8. ผลขั้นแรกเป็น MP4/GIF ที่แสดง geometry และ candidate motion การระบุ km/h เป็นเป้าหมายทดลองเพิ่มเติมเมื่อมีหลักฐานพอ หากไม่มี ground truth ห้ามรายงานว่าเป็นความเร็วจริงที่ผ่านการรับรอง

### E. การตรวจความแม่นข้ามพื้นที่

- เริ่ม manual labels 4 ภาพต่อพื้นที่และหลาย ROI รวม 12 ภาพ แยกรถ/เรือ/สิ่งไม่แน่ใจ และสุ่มตรวจ label ซ้ำ
- แบ่ง train/validation/test ตาม acquisition/date ไม่แบ่ง chips จากภาพเดียวกันกระจายไปทุกชุด ป้องกันภาพใกล้กันรั่วระหว่างชุด
- ทดสอบ transfer รถสุวรรณภูมิ → รถในท่าเรือ และเรือรอตเตอร์ดัม → สิงคโปร์เฉพาะ class ที่ตรงกัน
- รายงาน precision, recall, F1, count MAE/bias, false alarms ต่อพื้นที่, annotation uncertainty แยกพื้นที่ geometry และ polarization
- ค่าปรับแก้ตามมุมต้องเรียนจาก training set และทดสอบกับ held-out set หากข้อมูลน้อยให้แสดง stratified counts แทนการบังคับใช้ correction factor
- ข้อมูล AIS/จราจรย้อนหลังเป็น optional ground truth ต้องตรงเวลาถ่ายและมีสิทธิใช้ ตรวจ API/ประวัติ/ใบอนุญาตก่อนสัญญาว่าจะมีข้อมูลฟรี

### F. ขนาดข้อมูลและแผนใช้เครื่อง

จากขนาด object ที่ listing รายงาน (หน่วย GB แบบฐานสิบ ไม่ใช่ขนาด RAM):

| ผลิตภัณฑ์ | สุวรรณภูมิ / ไฟล์ | รอตเตอร์ดัม / ไฟล์ | สิงคโปร์ / ไฟล์ |
|---|---:|---:|---:|
| GEC | 1.03–1.18 GB | 0.43–0.53 GB | 0.43–0.51 GB |
| SICD | 11.45–17.66 GB | 5.96–9.34 GB | 5.78–10.54 GB |
| CPHD ที่พบ | 49.23–63.65 GB | 24.64–29.07 GB | 27.18–28.35 GB |

GEC ทั้ง 146 ไฟล์รวมประมาณ 100.79 GB และ SICD รวมประมาณ 1.40 TB โดยยังไม่รวม derivatives จึงเริ่มจาก metadata และ ROI reads แล้วค่อย cache ชุดที่คัดไว้ CPHD ที่พบใหญ่กว่า 600 MB ในแผนเดิมมาก ต้องทดสอบอ่าน metadata/ช่วงข้อมูลและตั้ง disk budget ก่อนดาวน์โหลด สถานะ HEAD ของตัวอย่าง GEC/SICD/CPHD อย่างละ 1 ไฟล์ต่อพื้นที่รวม 9 ไฟล์เป็น HTTP 200 และขนาดตรง listing

เครื่องในเครื่องใช้ UI, metadata และดูผล ส่วนงานหนักเลือก Colab หรือเครื่อง GPU หลังวัดความจำกับหนึ่ง ROI แล้ว ให้คุม concurrency และ workspace ต่อ job รองรับ checkpoint/ยกเลิกได้ และเตรียมผลลัพธ์ไว้สำหรับเดโม โดยยังไม่ตั้งค่าใช้จ่าย GPU จนทราบเวลารันจริง

## 7. จุดตรวจและเกณฑ์รับงาน

| จุดตรวจ | หลักฐานที่ต้องได้ | ถ้าไม่ผ่าน |
|---|---|---|
| G0 ข้อมูล | manifest ระบุ public assets, footprint, เวลา, resolution, size และรายการไฟล์ที่ขาด | ลดชุดทดลองหรือค้นแหล่งอื่น ไม่ตั้ง job จาก href ที่ใช้ไม่ได้ |
| G1 เปิดภาพ | ภาพ ROI จริง 1 ภาพต่อพื้นที่ พร้อมอ่านค่า/หน่วยและตำแหน่งได้ | แก้ ingestion ก่อนทำ detector |
| G2 เรขาคณิต | ทิศ/ระยะจาก ARP เทียบ metadata และจุดแผนที่ ตรวจกรอบพิกัด/เวลา; รายงาน residual | ติดป้าย estimated หรือปิดการแสดงส่วนที่ยังไม่ถูกต้อง |
| G3 การซ้อนภาพ | เป้าเริ่มต้น residual ภาคพื้นบนจุดนิ่ง p95 ≤ 1 ม. ภายในกลุ่มมุม พร้อมจำนวนจุดและข้อจำกัด; ไม่อ้างรวมอาคารสูง | ใช้เฉพาะคู่/ROI ที่ผ่าน หรือแสดงข้างกันโดยปิด change detection |
| G4 ตรวจจับ | baseline เทียบ manual labels และ error analysis ครบ 3 พื้นที่ ก่อนขยายทั้งชุด | ปรับ mask/threshold/class หรือจำกัดผลเป็น candidate |
| G5 sequence | วัตถุนิ่งคงตำแหน่งตาม tolerance ที่กำหนดจากความละเอียดเฟรมจริง, time/aspect mapping มีหลักฐาน | ส่ง aspect sequence พร้อมข้อจำกัด ไม่แสดงค่าความเร็ว |
| G6 เดโมรวม | เปลี่ยน 3 พื้นที่ เปิดภาพ/ผลเดิมได้ ยกเลิกงานได้ และ export พร้อม provenance | ปิดงานส่วนเชื่อมต่อก่อนเพิ่มโมเดลใหม่ |

ไม่ตั้งตัวเลข precision/recall เป็นผลงานสำเร็จล่วงหน้า กำหนดเกณฑ์เป้าหมายหลัง baseline 12 ภาพเพื่อให้สอดคล้องกับ class/ขนาดวัตถุและความยากจริง เกณฑ์ 1 ม. เป็นการจัดภาพสัมพัทธ์บนจุดพื้นนิ่ง ไม่ใช่การรับรอง absolute geolocation 1 ม.

## 8. ลำดับพัฒนาและเวลาเพิ่ม

ประมาณการสำหรับ 1 คนที่คุ้นกับโค้ดเดิม: **8 สัปดาห์สำหรับเดโมหลัก** แทนการนำแผนสุวรรณภูมิ 5 สัปดาห์มาคูณสาม งาน CPHD ขั้นสูงและความเร็วที่ตรวจรับรองอาจต้องเพิ่ม 2–4 สัปดาห์หลังผ่านจุดทดลอง และขึ้นกับข้อมูลอ้างอิง

| สัปดาห์ | งาน | สิ่งที่ดูและตรวจได้ |
|---|---|---|
| 1 | ล็อก manifest, public URLs, AOI และเปิด ROI จริงทั้งสามพื้นที่; ตรวจ CPHD และงบเก็บข้อมูล | 3 ภาพจริง + data availability report; G0–G1 |
| 2 | แยก entry point EO จาก source snapshot เชื่อม catalog, 2D/3D, Properties และ Timeline | เดโมเลือก 3 พื้นที่แล้วเปิด acquisition ได้ |
| 3 | ARP/LOS/sky plot, time adapter, compare view และ registration; ลอง sequence หนึ่ง ROI ขนาดเล็ก | geometry report + คู่ภาพที่ผ่าน; G2–G3 และผลทดลอง D ระยะแรก |
| 4 | masks และ CFAR baseline สุวรรณภูมิ; สร้าง label ชุดเริ่มต้น | ตาราง candidate/รถที่ตรวจเห็นและ QA |
| 5 | detector เรือ/ลานท่าเรือทั้งสองแห่ง; วิเคราะห์ความต่างของมุม | ผล baseline ครบ 3 พื้นที่; G4 |
| 6 | ขยายภาพที่ผ่าน QA, matched-pair change และ cross-site evaluation; ทดลองโมเดลเรียนรู้เมื่อ label พอ | timeline + before/after + ผล held-out |
| 7 | sequence pilot ที่ผ่านการตรวจ, frame metadata และหน้าเปรียบเทียบรวม | aspect/time sequence ที่ระบุข้อจำกัด; G5 |
| 8 | job cancel/cache/export, offline prepared demo, รายงานและบันทึกเดโม | G6 + notebook/CSV/GeoJSON/วิดีโอและรายงาน |

ลำดับ dependency: inventory → เปิดภาพ → geometry/registration → masks/labels → baseline → ขยายข้อมูล → ประเมินและทำรายงาน งานทดลอง sequence ใช้ข้อมูลอีก branch ของ pipeline โดยไม่ขวางเดโมหลัก

## 9. สิ่งที่ส่งมอบ

1. โมดูล EO แยก entry point เปิดโครงการสามพื้นที่ได้ พร้อม layout แบบ STK
2. ตารางภาพและ geometry ที่ย้อนถึง source metadata ได้ พร้อม public asset status และ quality flags
3. 2D Image View, 3D Geometry View, Sky Plot, Compare View และ timeline ของแต่ละพื้นที่
4. notebook ขั้นหลัก 2 ชุด: ข้ามวัน และ sequence; ใช้ site config แทนการคัดลอก notebook สามชุด
5. COG/tiles, detection GeoJSON/GeoParquet, zone counts CSV และ change maps ของชุดที่ผ่าน QA
6. sequence ตัวอย่างตามข้อมูลที่ทำได้จริง พร้อมตารางเวลา/aspect และความละเอียดต่อเฟรม
7. รายงาน precision/recall/count error และ cross-site evaluation แยกรถกับเรือ
8. demo bundle ที่เตรียมข้อมูลไว้ เปิดซ้ำได้โดยไม่ต้องรัน CPHD หน้างาน พร้อม provenance และ attribution

GeoLibre ใช้เป็น optional viewer สำหรับเปิด COG/GeoJSON ที่ export ไม่เป็น dependency หลักของเดโมนี้ เพราะใช้หน้าจอ GNSS Studio เป็นฐานอยู่แล้ว ข้อมูล JAXA/DEM/ฝนและ Sentinel เป็นชั้นบริบทที่จะประเมินเพิ่มเติม ไม่รับรองว่าความละเอียดระดับหลายสิบเมตรใช้แก้ตำแหน่งอาคารหรือยืนยันรถแต่ละคันได้

## 10. งานแรกที่ควรลงมือ

ทำ vertical slice เดียวให้ครบ: **เลือก Site → เลือกภาพจริง → เปิด ROI → ตั้งเวลา → เห็นดาวและเส้นส่องที่มีแหล่งข้อมูลรองรับ → export ภาพพร้อม metadata** จากนั้นทำให้เส้นทางนี้ใช้ได้ทั้ง 3 พื้นที่ ก่อนเริ่มฝึกโมเดลหรือประมวลผลข้อมูลทั้งชุด

## 11. แหล่งข้อมูลและขอบเขตการตรวจครั้งนี้

- [แผนเดิมของผู้ใช้](</Users/phuwish/.codex/attachments/a6f89c5a-c3d0-44db-b78b-780f17688b60/Pasted text.txt>) — ใช้เป็นโจทย์เริ่มต้น ตัวเลขจากแผนแยกจากผลตรวจครั้งนี้
- [Umbra Open Data Program](https://umbra.space/open-data/) — โครงการข้อมูลเปิดและชนิดงาน time series
- [AWS Open Data Registry: Umbra](https://registry.opendata.aws/umbra-open-data/) — public bucket, ภูมิภาค และ CC BY 4.0; ต้องคง attribution ใน exports
- [สุวรรณภูมิ: S3 listing](https://umbra-open-data-catalog.s3.us-west-2.amazonaws.com/?list-type=2&prefix=sar-data%2Ftasks%2FSuvarnabhumi%20International%20Airport%2C%20Thailand%2F)
- [รอตเตอร์ดัม: S3 listing](https://umbra-open-data-catalog.s3.us-west-2.amazonaws.com/?list-type=2&prefix=sar-data%2Ftasks%2FPort%20of%20Rotterdam%2C%20Netherlands%2F)
- [สิงคโปร์: S3 listing](https://umbra-open-data-catalog.s3.us-west-2.amazonaws.com/?list-type=2&prefix=sar-data%2Ftasks%2FPort%20of%20Singapore%2C%20Singapore%2F)
- [Umbra Canopy: Spotlight Tasking](https://docs.canopy.umbra.space/docs/spotlight-tasking) — รายการผลิตภัณฑ์และข้อกำหนดการถ่าย
- [NGA sarpy: subaperture implementation](https://github.com/ngageoint/sarpy/blob/master/sarpy/processing/sicd/subaperture.py) และ [เอกสาร](https://sarpy.readthedocs.io/en/latest/processing/sicd/subaperture.html) — ฐานสำหรับทดลอง SICD
- [STAC View Geometry Extension](https://stac-extensions.github.io/view/) — ต้องตรวจนิยามมุมร่วมกับผู้ให้ข้อมูลและเวกเตอร์จาก metadata
- [Port of Rotterdam: Weather, tides and water depth](https://www.portofrotterdam.com/en/operational-information/hydrometeo-data) — ชั้นบริบทและช่องทางขอ API; ยังไม่ได้ยืนยันสิทธิหรือประวัติข้อมูล
- [MPA Singapore: Terminals](https://www.mpa.gov.sg/port-marine-ops/operations/port-infrastructure/terminals) — บริบทเขตท่าเรือ

ขอบเขตตอนวางแผนเดิม: public object listings, STAC metadata 146 รายการ และ HEAD ของผลิตภัณฑ์ตัวอย่าง ต่อมาได้ลงมืออ่านภาพจริง/ROI และ SICD ARP ครบ 146 ภาพแล้ว พร้อม baseline, ภาพคู่และ aspect sequence ดูสถานะที่ทำได้จริงและข้อจำกัดใน [USAGE.md](USAGE.md) และ [ผลการประมวลผล](research/processing-results.json) โดย CPHD back-projection และความเร็วที่ตรวจรับรองยังไม่เสร็จ
