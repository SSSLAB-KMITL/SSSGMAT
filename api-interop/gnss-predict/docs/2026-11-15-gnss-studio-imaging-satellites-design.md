# GNSS Studio งานเสริม ข2: ดาวถ่ายภาพเป็น object ในฉาก

- วันที่: 2026-11-15
- Branch: `feature/gnss-studio-imagery` (ทำต่อหลังงานย่อย 4 เสร็จ)
- สถานะ: ผู้ใช้สั่ง "ทำอันนี้ทั้งหมด" ซึ่งรวม ข2
- ที่มา: [งานวิจัยดาวถ่ายภาพ](2026-11-15-imaging-satellites-research.md) (อ้างว่า "วิจัย §n"), [spec ภาพ GIBS](2026-11-14-gnss-studio-imagery-design.md), [spec Sensor](2026-11-13-gnss-studio-sensor-design.md), [โมเดล 3 มิติ](2026-11-14-gnss-studio-models-integration-design.md)

## 1. เป้าหมายและเกณฑ์ว่าสำเร็จ

ผู้ใช้ Insert ดาวถ่ายภาพ 8 ดวงลงในฉากได้เหมือนดาว GNSS
ดาวเหล่านี้แสดงในหน้าต่าง 3D/2D พร้อมโมเดล กล้องหลัก และภาพจริงจาก GIBS ของดาวดวงนั้น

| รหัส | ดาว | NORAD | กล้องหลัก | กลุ่ม CelesTrak ที่อ่าน |
|---|---|---|---|---|
| X01 | Himawari-9 | 41836 | AHI | weather |
| X02 | GOES-18 | 51850 | ABI | weather |
| X03 | GOES-19 | 60133 | ABI | weather |
| X04 | Terra | 25994 | MODIS | science, visual |
| X05 | Aqua | 27424 | MODIS | visual |
| X06 | Suomi NPP | 37849 | VIIRS | weather |
| X07 | NOAA-20 | 43013 | VIIRS | weather |
| X08 | NOAA-21 | 54234 | VIIRS | weather |

### เกณฑ์ว่าสำเร็จ

1. Insert → From Satellite Catalog มีกลุ่ม **Imaging** แสดงดาว 8 ดวงที่มี TLE ใน snapshot และกด Insert ได้
2. Propagate และ Analyze ทำงานกับฉากที่มีดาวถ่ายภาพปนดาว GNSS:
   - ดาวถ่ายภาพมีเส้นทางใน CZML;
   - มี Access/AER ถึง Facility;
   - **ไม่ถูกนับใน DOP** และ **ไม่อยู่ในรายงาน Validation**
3. ค่า DOP, SP3 ของดาว GNSS และผล Validation ของฉากเดิม (ที่ไม่มีดาวถ่ายภาพ) ตรงกับก่อนแก้ทุกไบต์
4. Insert ดาวถ่ายภาพแล้วได้ Sensor กล้องหลักติดมาด้วย (ปิดได้ในกล่อง Insert):
   - GEO ใช้ Simple Conic 8.7°;
   - MODIS ใช้ Rectangular 55.0° × 0.41°;
   - VIIRS ใช้ Rectangular 56.28° × 0.42°
5. คลิกขวาที่ดาวถ่ายภาพแล้วเลือก **Show Imagery**:
   - ฉากเปิดชั้น GIBS ของดาวดวงนั้น (ถ้า GIBS ปิดอยู่ ต้องผ่านกล่องยืนยันเดิมก่อน);
   - Sensor View ของกล้องหลักเปิดขึ้น
6. ไม่มีการดึงข้อมูลจาก CelesTrak ใหม่ในการพัฒนาและทดสอบ (ใช้ไฟล์ใน cache ที่มีอยู่แล้ว) ชุดทดสอบเดิมผ่านทั้งหมด

## 2. ขอบเขต

**ทำ**
- engine: ชุดดาวถ่ายภาพ (preset ตามตาราง §1), catalog ดาวถ่ายภาพจากกลุ่ม CelesTrak ที่มีใน snapshot, รหัสภายใน `X01`–`X08`, กรองออกจาก DOP และ Validation
- server: catalog/insert/schema รองรับระบบ `X`, Sensor `Rectangular`
- web: กลุ่ม Imaging ในกล่อง Insert, Sensor กล้องหลักอัตโนมัติ, วาด Rectangular sensor ใน 3D/2D และ Sensor View, คำสั่ง Show Imagery

**ไม่ทำ (บันทึกเป็นข้อจำกัด)**
- ดาวถ่ายภาพอื่นนอก 8 ดวงนี้ (ตาราง preset แก้ที่เดียว ภายหลังเพิ่มได้)
- แถบสแกนสะสม (swath corridor) บนแผนที่ 2D: ใช้ footprint ของ Sensor ณ เวลาปัจจุบันไปก่อน
- ชั้นภาพกลางคืน/IR ให้เลือกสลับอัตโนมัติ: ใช้ชั้นหลักต่อดวงตาม §5 ผู้ใช้เปลี่ยนเองได้ใน Globe Manager
- ปุ่ม Fetch กลุ่มใหม่ (`resource`, `goes`, `noaa`) อัตโนมัติ: ใช้ปุ่ม fetch เดิมที่ผู้ใช้กดเองเท่านั้น (§3.3)

## 3. Engine

### 3.1 รหัสและระบบ

- ระบบใหม่ `X` (ไม่ใช่ GNSS) ใช้รหัส 3 ตัวอักษรคงที่ตามตาราง §1
  - ใช้เป็นชื่อ GMAT Spacecraft, รหัสใน SP3, CZML `sat/X01` และคีย์ของ AER/Access ได้เลยโดยไม่ต้องแก้ส่วนที่ใช้ PRN 3 ตัวอักษร
  - ชื่อแสดงผลมาจาก preset (เช่น "Himawari-9") ไม่ใช่ชื่อใน CelesTrak
- ตาราง preset อยู่ไฟล์เดียว: `gnss_predict/imaging.py` มี `IMAGING_SATELLITES` (รหัส, NORAD, ชื่อแสดง, กลุ่มที่อ่าน, กล้อง, ค่า sensor, ชั้น GIBS)
- `SYSTEM_LETTERS` ของ GNSS (`GREC`) คงเดิม ระบบ `X` แยกไว้เป็น `IMAGING_LETTER = "X"` ทุกจุดที่ต้องการ "ดาว GNSS เท่านั้น" ใช้ `GREC` ต่อไป

### 3.2 Catalog

- `CatalogSatellite` ใช้ต่อได้: `prn` = `X0n`, `system` = `"X"`, `svn` = `""`, `block` = ชื่อรุ่นจาก preset (ใช้เลือกโมเดลผ่าน `norad_ids` อยู่แล้ว)
- `build_imaging_catalog(snapshot_dir, ref)` อ่าน OMM จากไฟล์กลุ่มใน snapshot:
  - จับคู่ด้วย `NORAD_CAT_ID` เท่านั้น ห้ามใช้ชื่อ (วิจัย §1.2: `ROBUSTA-3A` มีคำว่า TERRA);
  - ถ้าดวงเดียวกันอยู่หลายกลุ่ม ใช้ record ที่ EPOCH ใหม่สุด;
  - ไม่พบ → อยู่ใน `unmapped` เหตุผล `TLE_UNAVAILABLE`
- ธงอายุ TLE:
  - LEO ใช้เกณฑ์เดิม (`AGE_OK_DAYS` 2.0, `AGE_SHOWN_MAX_DAYS` 7.0);
  - GEO (mean motion < 1.1 rev/day) ใช้เกณฑ์ stale 7 วัน และซ่อนเมื่อเกิน 14 วัน (วิจัย §5.6 ข้อ 3)
- ไม่มีธง `no_broadcast`/`unhealthy`/`prn_changed`/`name_mismatch` สำหรับระบบ `X`
- catalog รวม (`scenario_catalog` หรือที่ server ใช้) = GNSS + imaging โดยดาว GNSS ได้ผลเหมือนเดิมทุกตัว

### 3.3 Snapshot และการ fetch

- snapshot ของฉากรวมไฟล์กลุ่ม imaging (`weather`, `science`, `visual`) ที่มีใน `_cache` ล่าสุด:
  - คัดลอกแบบเดียวกับกลุ่ม GNSS และรวมเข้า `SHA256SUMS`/hash เดิม;
  - ฉากที่ไม่มีดาวระบบ `X` ต้องได้ hash เดิม (ไม่ทำให้ ephemeris เดิมหมดอายุ)
- `fetch_snapshot(..., systems)`:
  - รับตัวอักษร `X` เพิ่ม หมายถึงดึงกลุ่ม imaging ตามกฎ rate limit เดิม (1 ครั้ง/กลุ่ม/2 ชม., ไม่ retry หลัง 403);
  - ค่าตั้งต้นของ systems ยังเป็น `GREC` (ไม่ดึงกลุ่มใหม่ถ้าผู้ใช้ไม่เลือก)
- **ชุดทดสอบห้ามเรียก fetch จริง** ใช้ fixture OMM ในไฟล์ทดสอบ

### 3.4 Propagate, Analyze, Validate

- propagate: ดาวระบบ `X` ผ่าน GMAT SGP4 เหมือน GNSS; `write_sp3` รับรหัส `X0n` ได้ (3 ตัวอักษรอยู่แล้ว)
- **DOP:** `dop_series` นับเฉพาะระบบ `G/R/E/C`; ระบบ `X` ไม่อยู่ใน `ALL` และไม่มีคอลัมน์ของตัวเอง
- AER/Access: คำนวณให้ระบบ `X` ด้วย (Access ถึง Facility ใช้ได้);
  - IPP/MF ของระบบ `X` เป็นค่าว่าง (`None`) เพราะไม่ใช่สัญญาณ L-band
- **Validate:** ข้ามระบบ `X` ทั้งหมด ไม่สร้างแถว `unverified`; ข้อความไทยหนึ่งบรรทัดว่า "ข้ามดาวถ่ายภาพ n ดวง (ไม่มีข้อมูลอ้างอิง)"
- manifest: บันทึก `system` ของแต่ละดวง (ค่าเดิมของ GNSS ไม่เปลี่ยน)

## 4. Server

- schema `SatelliteObj` ไม่เปลี่ยนโครงสร้าง (มี `name`, `norad` อยู่แล้ว)
- `/orbits/catalog` ส่งดาวระบบ `X` พร้อม `system: "X"` และ `category: "imaging"` ส่วนดาว GNSS ส่ง `category: "gnss"`
- `SensorObj.shape` รับ `"Simple Conic" | "Rectangular"`:
  - Rectangular ใช้ `vertical_half_angle_deg` (ตามแนวบิน) และ `horizontal_half_angle_deg` (ขวางแนวบิน);
  - ช่วงค่า 0 < มุม ≤ 89°;
  - ไฟล์เดิมที่ไม่มี field ใหม่โหลดได้เป็น Simple Conic
- คำ STK: "Rectangular", "Vertical Half Angle", "Horizontal Half Angle" ตรวจกับเอกสารอ้างอิง STK (§G) ถ้าไม่ตรงตัวใช้ `ours()`

## 5. Web

### 5.1 Insert
- กล่อง From Satellite Catalog เพิ่มตัวกรองระบบ "Imaging" (คู่กับ GPS/GLONASS/Galileo/BeiDou)
  - คอลัมน์ PRN แสดง `X0n`; ชื่อแสดงตาม preset
- ตัวเลือก "เพิ่มกล้องหลัก" (ติ๊กไว้เป็นค่าตั้งต้น):
  - Insert แล้วสร้าง Sensor ลูกของดาวด้วยค่าจาก preset;
  - ชื่อ Sensor = ชื่อกล้อง (AHI/ABI/MODIS/VIIRS)

### 5.2 Rectangular sensor
- `sensorGeometry.ts`: มุมสี่มุมของพีระมิดในกรอบตัวดาว (+Z ลงโลก, +X ตามแนวบิน)
  - ขวางแนวบินคือแกน ±Y ใช้ horizontal half angle;
  - ตามแนวบินคือแกน ±X ใช้ vertical half angle;
  - ตัดกับทรงรี WGS84 ได้ footprint 4 มุมพร้อมจุดบนขอบ
- 3D: วาดพีระมิดแบบเดียวกับกรวยเดิม (เส้นขอบ + ผิวโปร่ง); 2D: วาด footprint
- Sensor View:
  - FOV ของกล้องคำนวณจาก horizontal half angle ตามสูตรเดิม `min(2α × 1.05, 120°)`;
  - อัตราส่วนภาพไม่เปลี่ยน

### 5.3 โมเดลและท่าทาง
- ใช้กลไกเดิม: โมเดลเลือกจาก `norad_ids`; ท่าทางเป็น nadir + velocity สำหรับ EO; ปีกหมุนตาม `cell_normal`
- ไม่ต้องเพิ่มโมเดล (ครบทั้ง 8 ดวงแล้ว ตามวิจัย §4.2)

### 5.4 Show Imagery
- เมนูคลิกขวาของดาวระบบ `X` มีคำสั่ง **Show Imagery** (ป้าย `ours`)
- ชั้น GIBS ต่อดวงมาจาก preset และต้องตรงกับ `CATALOG` ใน `server/gnss_studio_server/imagery.py` (ทดสอบว่าทุกชื่ออยู่ใน CATALOG):
  - Himawari-9: `Himawari_AHI_Band3_Red_Visible_1km`
  - GOES-18: GOES-West GeoColor
  - GOES-19: GOES-East GeoColor
  - Terra: MODIS Terra TrueColor
  - Aqua: MODIS Aqua TrueColor
  - SNPP, NOAA-20, NOAA-21: VIIRS TrueColor ของแต่ละดวง
- GIBS ปิดอยู่ → เปิดกล่องยืนยันเดิมของ Globe Manager ก่อน; ผู้ใช้ไม่ยืนยัน → ไม่ทำอะไร
- ยืนยันแล้ว → เปิดชั้นนั้นใน Globe Manager และเปิด Sensor View ของกล้องหลัก (ถ้าลบกล้องหลักไปแล้ว ใช้มุมมองจากดาวแบบเดิม)

## 6. ทดสอบ

- engine:
  - imaging catalog: จับคู่ NORAD, เลือก EPOCH ใหม่สุด, ไม่ใช่ชื่อ, ธงอายุ GEO/LEO;
  - DOP ไม่เปลี่ยนเมื่อเพิ่มดาว X;
  - validate ข้ามดาว X;
  - hash ของฉาก GNSS ล้วนไม่เปลี่ยน;
  - GMAT propagate ดาว X01 และ X04 จาก fixture (ไม่ต่อเน็ต)
- server: catalog ส่ง category; Sensor Rectangular โหลด/บันทึก/ตรวจช่วงค่า; ไฟล์เก่าโหลดได้
- web:
  - Rectangular footprint (มุม, ตั้งฉากกับ nadir, ทิศ cross-track);
  - Insert พร้อมกล้องหลัก;
  - Show Imagery (GIBS ปิด → มีกล่องยืนยัน, ไม่มี request ออกนอก);
  - ชั้น GIBS ใน preset มีอยู่ใน CATALOG
- e2e:
  - Insert Terra → Propagate → เห็นดาว X04 พร้อมกล้อง MODIS ใน 3D;
  - ไม่มี request ออกนอกเครื่อง

## 7. ความเสี่ยง

- ดาว GEO TLE อายุ 4–5 วันใน cache ปัจจุบัน: เกณฑ์ GEO 7 วันรองรับ แต่ถ้าผู้ใช้ไม่ fetch นานเกิน 14 วัน ดาว GEO จะถูกซ่อน (มีข้อความบอก)
- Aqua อยู่ในกลุ่ม `visual` (100 ดวงสว่างสุด) เท่านั้น ซึ่งอาจหลุดจากกลุ่มได้ ภายหลังควรเพิ่ม `resource`
  - การดึงกลุ่มใหม่ต้องให้ผู้ใช้กดเอง
- รหัส `X0n` ไม่ใช่มาตรฐาน IGS: ถ้าส่งออก SP3 ไปโปรแกรมอื่นจะเห็นระบบ `X` ที่ไม่รู้จัก บันทึกไว้ใน README
