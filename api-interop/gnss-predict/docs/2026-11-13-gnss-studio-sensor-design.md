# GNSS Studio งานเสริม ก: Sensor และ Sensor View

- วันที่: 2026-11-13
- Branch: `feature/gnss-studio-sensor` (แตกจาก `feature/gnss-studio-workspace` 37957fe)
- สถานะ: ผู้ใช้เห็นชอบข้อเสนอในแชตและสั่งให้ลงมือ (2026-11-13) เอกสารนี้ตรวจย้อนหลังได้
- เอกสารที่เกี่ยวข้อง: [design ภาพรวม](2026-11-11-gnss-studio-design.md), [spec workspace](2026-11-11-gnss-studio-workspace-design.md) (อ้างว่า "workspace §n"),
  [การตัดสินใจของ workspace](2026-11-11-gnss-studio-workspace-decisions.md), [รายการอ้างอิง STK](2026-11-11-gnss-studio-stk-reference.md) (อ้างว่า "STK ref", ส่วน Sensor อยู่ใน §G)
- งานต่อเนื่อง: งานเสริม ข (ภาพถ่ายจริงจาก NASA GIBS) ใช้ Sensor View จากงานนี้

## 1. เป้าหมาย

ผู้ใช้กดที่ดาวแล้วเห็นโลกจากตำแหน่งของดาว มองตามทิศที่ดาวมอง ด้วยมุมกว้างที่กำหนดได้ แบบ Sensor ของ STK
ทำงานออฟไลน์ ใช้ได้กับทุกดวงใน scenario และกับเวลาพยากรณ์ในอนาคต

### เกณฑ์ว่าสำเร็จ

1. เลือกดาว (Object Browser หรือคลิกที่ดาวในหน้าต่าง 3D) → **Sensor View** → หน้าต่างใหม่ที่กล้องอยู่ที่ดาว
   ทิศกล้องคลาดจากทิศ boresight ไม่เกิน 0.01° และดาว GNSS เห็นโลกทั้งดวงด้วยมุมตั้งต้น
2. Sensor เป็น object ของ scenario: Insert, Properties, Rename, Delete ได้ บันทึกใน `scenario.json` ลบดาวแล้ว sensor ของมันหายตาม
3. หน้าต่าง 3D หลักวาดกรวยและรอยบนพื้นโลก หน้าต่าง 2D วาดรอยบนพื้นโลก ทั้งหมดเดินตามเวลา Animation
4. เพิ่ม แก้ หรือลบ sensor ไม่ทำให้ผลการคำนวณเดิมเป็นของเก่า (hash ของ ephem ไม่เปลี่ยน) และไม่มี request ออกนอกเครื่อง
5. ชุดทดสอบเดิมทั้งหมดยังผ่าน

## 2. ขอบเขต

**ทำ**
- Sensor ติดกับ Satellite (ดาวละกี่ตัวก็ได้)
- Sensor Type: Simple Conic (Cone Half Angle)
- Pointing: Fixed แบบ Az-El ในกรอบตัวดาว (ค่าตั้งต้นชี้ลงโลก)
- หน้าต่าง Sensor View, กรวยและรอยบนพื้นโลกในหน้าต่าง 3D/2D, เมนูคลิกขวาบนดาวในหน้าต่าง 3D

**ไม่ทำในงานนี้**
- Sensor บน Facility, Sensor Type อื่น (Complex Conic, Rectangular ฯลฯ), Pointing แบบอื่น (Targeted, Spinning ฯลฯ)
- Access และ constraint ของ sensor (งานย่อยที่ 4 ต่อยอดได้)
- ท่าทางจริงของดาว GNSS (yaw steering) ซึ่งจะมากับโมเดล 3 มิติ
- Copy/Paste ของ sensor: เมนูปิดใช้พร้อมคำอธิบาย คัดลอกดาวแล้ว sensor ไม่ถูกคัดลอกตาม

## 3. ท่าทางของดาวและทิศของ sensor

### 3.1 กรอบตัวดาว

ทุกดาวใช้ท่าทางแบบ **Nadir alignment with ECI velocity constraint** ของ STK (STK ref §G):
- +Z ชี้ไปที่ศูนย์กลางโลก (geocentric nadir) = −r̂
- +X = ส่วนของความเร็วเฉื่อย v_I ที่ตั้งฉากกับ Z, v_I = v_ECEF + ω⊕ × r (ω⊕ = 7.292115e−5 rad/s)
- +Y = Z × X

ใช้แบบ ECI ไม่ใช่ ECF เพราะ STK เตือนว่าแบบ ECF ใช้ไม่ได้ดีกับดาวค้างฟ้าหรือวงโคจรสัมพันธ์กับโลก (ความเร็วใน ECF เกือบศูนย์หรือกลับทิศ)
ความเร็วหาจากผลต่างของตำแหน่งที่เวลา t ± 1 วินาที (ตำแหน่งจาก CZML ที่ interpolate แล้ว)

### 3.2 Boresight จาก Az-El

azimuth (az) วัดจาก +X ไปทาง +Y ในระนาบ XY, elevation (el) วัดจากระนาบ XY ไปทาง +Z
boresight b = cos(el)·cos(az)·X + cos(el)·sin(az)·Y + sin(el)·Z
ค่าตั้งต้น az = 0°, el = 90° = ชี้ลงศูนย์กลางโลก ช่วงที่รับ: az ∈ [0, 360), el ∈ [−90, 90]

### 3.3 มุมที่เห็นโลกทั้งดวงและรอยบนพื้นโลก

โลกทรงกลมรัศมี Re = 6371.0088 km (ค่าเดียวกับ Swath ใน `cesium/swath.ts`), h = ความสูงของดาว

- มุมครึ่งหนึ่งของจานโลกที่ดาวเห็น: ρ = asin(Re / (Re + h))
  GPS ≈ 13.9°, GLONASS ≈ 14.5°, Galileo ≈ 12.4°, BeiDou MEO ≈ 13.2°, ค้างฟ้า ≈ 8.7°
- รอยบนพื้นโลกของกรวยที่ boresight ชี้ลงศูนย์กลางโลก:
  - α < ρ: มุมเงยที่ขอบรอย ε = acos(((Re + h) / Re)·sin α) แล้วใช้ `footprintRing(lat, lon, altKm, ε)` ที่มีอยู่
  - α ≥ ρ: กรวยกว้างกว่าโลก รอยคือขอบฟ้า (ε = 0)
- boresight ที่ไม่ชี้ลงศูนย์กลางโลก: ยิงเส้น 72 เส้นรอบกรวยไปตัดทรงกลม เส้นที่ไม่โดนโลกใช้จุดสัมผัสขอบฟ้าในระนาบของเส้นนั้นแทน
  boresight ที่ไม่โดนโลกเลยไม่วาดรอย (วาดกรวยอย่างเดียว)

## 4. Object Sensor ใน scenario.json (server)

```json
{
  "class": "Sensor", "name": "Sensor1", "parent": "*/Satellite/G01",
  "description": "", "long_description": "",
  "definition": {"type": "Simple Conic", "cone_half_angle": 45.0},
  "pointing": {"type": "Fixed", "orientation": "Az-El", "azimuth": 0.0, "elevation": 90.0, "about_boresight": "Rotate"},
  "graphics2d": {"show": true, "color": "#e8c547", "fill": false, "fill_translucency": 50},
  "graphics3d": {"show": true, "color": "#e8c547", "show_radial_lines": true, "show_boresight_marker": false}
}
```

- path คือ `*/Sensor/<ชื่อ>` **(เพิ่มเอง)**: STK ใช้ path ซ้อนใต้ object แม่ แต่ scenario เก็บ object เป็นรายการแบน
  และ route ใช้ `/objects/{class}/{name}` path แบนจึงใช้กลไกเดิมได้ทั้งหมด ส่วน Object Browser วาดซ้อนใต้ดาว
- ชื่อไม่ซ้ำทั้ง scenario แบบไม่สนตัวพิมพ์เล็กใหญ่ เหมือน object อื่น (กติกาของ engine)
- `parent` ต้องเป็นดาวที่มีอยู่ (422 ถ้าไม่ใช่) แก้ไม่ได้หลังสร้าง (อ่านอย่างเดียวแบบ NORAD)
- `cone_half_angle` ∈ (0, 90] องศา (ค่าตั้งต้น 45° ตาม STK), สี `#rrggbb`, `fill_translucency` ∈ [0, 100] (100 = มองไม่เห็น ตาม STK)
- `type`, `orientation`, `about_boresight` มีค่าเดียวใน v1 (Simple Conic, Fixed, Az-El, Rotate) ค่าอื่น → 422
- หน้า Properties: `basic` = description, long_description, parent, definition, pointing (หน้า Basic - Definition และ Basic - Pointing ของ STK
  อยู่ในกลุ่ม Basic) ส่วน `graphics2d` / `graphics3d` เป็นส่วนย่อยตามแบบเดิม
- Insert:
  - **Define Properties**: ต้องมี `name` และ `parent` ช่องอื่นผสมกับค่าตั้งต้น
  - **Insert Default**: ต้องมี `parent` ชื่อเป็น `Sensor<n>` ตัวแรกที่ว่าง (STK ตั้งชื่อ Sensor1, Sensor2, … เหมือนกัน)
  - From Satellite Catalog: ไม่รองรับ (422)
- Rename ดาว → `parent` ของ sensor ทุกตัวเปลี่ยนตาม; Delete ดาว → sensor ของดาวนั้นถูกลบด้วย
- `GET /objects` (ต้นไม้): โหนดดาวมี `children` เป็นโหนด sensor ตามลำดับใน `objects`
- engine ไม่ใช้ class Sensor (ข้ามอยู่แล้ว) จึงไม่กระทบ hash ของ ephem หรือ access ต้องมี test ยืนยัน
- OpenAPI และ `types.gen.ts` สร้างใหม่ด้วย `npm run gen:api`

## 5. หน้าเว็บ

### 5.1 Object Browser และเมนู

- แถว sensor ซ้อนใต้ดาว ดาวที่มี sensor มีเครื่องหมาย +/− ขยาย/ยุบได้ (STK ref §G) กล่องสีเป็นสีของ sensor
- เมนูของ object ชนิด Sensor (เมนูชื่อ "Sensor" บนแถบเมนูและคลิกขวา): Properties, Sensor View **(เพิ่มเอง)**, Access... (ปิดใช้ เหมือนของดาว),
  Zoom To (ไปที่ดาวแม่), Rename, Delete; Copy/Paste ปิดใช้พร้อมคำอธิบาย
- เมนูของ Satellite เพิ่ม **Sensor View (เพิ่มเอง)**: ดาวมี sensor แล้ว → เปิดของตัวแรก; ยังไม่มี → สร้างด้วย Define Properties
  ชื่อ `Sensor<n>` ตัวแรกที่ว่าง, Cone Half Angle = ρ + 0.5° ปัดทศนิยม 1 ตำแหน่ง จากตำแหน่งดาว ณ เวลาปัจจุบัน
  (ดาวยังไม่มีผลวงโคจร → 45°) แล้วเปิด Sensor View
- Insert: Sensor อยู่ใน Insert STK Objects (Define Properties / Insert Default) และเมนู Insert → Sensor... แบบเดียวกับ Facility... / Satellite...
  เลือก Insert Default แล้วขึ้นหน้าต่าง **Select Object** ให้เลือกดาวแม่ตาม STK (ดาวที่เลือกอยู่ใน Object Browser ถูกเลือกไว้ก่อน)
  ไม่มีดาวใน scenario → ข้อความไทยและปุ่มปิดใช้

### 5.2 Properties Browser

| Object | หน้า | ช่อง |
|---|---|---|
| Sensor | Basic - Definition | Sensor Type (Simple Conic อ่านอย่างเดียว), Cone Half Angle (deg) |
| | Basic - Pointing | Pointing Type (Fixed อ่านอย่างเดียว), Orientation Method (Az-El อ่านอย่างเดียว), Azimuth (deg), Elevation (deg), About Boresight (Rotate อ่านอย่างเดียว) |
| | Basic - Description | Short Description, Long Description, ดาวแม่ **(เพิ่มเอง, อ่านอย่างเดียว)** |
| | 2D Graphics - Attributes | Show, Color, Fill, % Translucency |
| | 3D Graphics - Attributes | Show, Color, Show Radial Lines, Show Boresight Marker |

ชื่อหน้าและชื่อช่องตรงกับ STK ref §G ช่องที่ STK มีแต่ v1 ไม่ทำ (Location, Sensor AzEl Mask, 2D Graphics - Projection / Boresight,
3D Graphics - Projection / Pulse ฯลฯ) ไม่แสดง กรวยวาดถึงจุดตัดผิวโลกเสมอ (เท่ากับ Type = Earth Intersections ของ STK)

### 5.3 กราฟิกในหน้าต่าง 3D และ 2D

- 3D: วงรอยบนพื้นโลก, Show Radial Lines = เส้นขอบกรวย 8 เส้นจากดาวถึงรอย, Show Boresight Marker = จุดที่ boresight ตัดผิวโลก
  สีตาม sensor
- 2D: วงรอยบนพื้นโลก, Fill = เติมพื้นที่แบบ Filled Limits ของ Swath ด้วยความโปร่งตาม % Translucency
- คำนวณใหม่เมื่อเวลาเปลี่ยน ไม่เกิน 4 ครั้งต่อวินาที (Throttle แบบ Inertial by Window) และใช้ค่าคงที่ ไม่ใช้ CallbackProperty
  (ข้อจำกัดของ `cesium/idleUpdates.ts`)
- ซ่อนเมื่อ `show` เป็น false, ดาวแม่ถูกซ่อน หรือดาวแม่ยังไม่มีตำแหน่ง ณ เวลานั้น

### 5.4 หน้าต่าง Sensor View **(เพิ่มเอง)**

STK ไม่มีคำสั่งดูภาพผ่าน sensor โดยตรง (STK ref §G: ใกล้ที่สุดคือ Obscuration View ที่มองตาม boresight และ EOIR Sensor Scene ที่ต้องมี license)
หน้าต่างนี้จึงเป็นของเราเอง ใช้ชื่อตรงไปตรงมาและติดป้าย (เพิ่มเอง)

- ชนิดหน้าต่างใหม่ `sensorView` หนึ่งบานต่อ sensor (instanceKey = path) แบบ Integrated เหมือนหน้าต่าง 3D
  บันทึกใน workbook, ปิดพร้อม scenario, เปิดพร้อมกันได้ไม่เกิน 4 บาน (บานที่ 5 → ข้อความไทย)
- ชื่อหน้าต่าง: `Sensor View - <sensor> (<ดาว>)` เปลี่ยนตาม Rename, sensor หรือดาวถูกลบ → หน้าต่างปิด
- ภาพ: viewer 3D ตัวใหม่ที่ใช้ scene เดียวกับหน้าต่าง 3D (ดาว, Facility, แสงกลางวัน/กลางคืนเปิด) กล้อง:
  - ตำแหน่ง = ตำแหน่งดาว (Earth-fixed) ทิศ = boresight
  - ด้านบนของภาพ: **North** (ค่าตั้งต้น: ทิศเหนือของโลกที่ฉายลงระนาบภาพ) หรือ **Velocity** (+X ของกรอบตัวดาว) เลือกได้ที่แถบของหน้าต่าง
    เมื่อ boresight ขนานกับแกนโลกจนหาทิศเหนือไม่ได้ ใช้ +X แทน
  - มุมกว้าง: กรวยพอดีด้านที่สั้นของภาพ ขยาย 5% (fov ของด้านสั้น = 2α × 1.05) แต่ไม่เกิน 120°
  - ปิดการลาก หมุน และซูมด้วยเมาส์ (กล้องล็อก) เวลาเดินตาม Animation
- ข้อความบนภาพ: ชื่อ sensor และดาว, เวลา (รูปแบบเดียวกับแถบ Animation), ละติจูด/ลองจิจูดใต้ดาว, ความสูง (km), Cone Half Angle และวงขอบกรวย
- ดาวแม่ยังไม่มีผลวงโคจรหรืออยู่นอกช่วงเวลา → ภาพว่างพร้อมข้อความไทย ไม่ใช่ error

### 5.5 คลิกที่ดาวในหน้าต่าง 3D

- คลิกซ้ายบนดาวหรือ Facility = เลือก object นั้น (เหมือนเลือกใน Object Browser) ลากเพื่อหมุนโลกยังทำงานเหมือนเดิม
- คลิกขวาบนดาว = เมนู Properties, Sensor View, Zoom To; บน Facility = Properties, Zoom To

### 5.6 Test hook (`window.__gnssStudioTest`, เปิดด้วย `?test` เท่านั้น)

- `sensorViewCamera(sensorName)` → `{position, direction, up, fovDeg}` ของกล้องใน Sensor View ของ sensor นั้น หรือ null
- `sensorFootprint(sensorName, view: "3d" | "2d")` → จำนวนจุดของวงรอยที่วาดอยู่ หรือ null ถ้าไม่ได้วาด

## 6. ข้อความและชื่อ

ชื่อเมนู ปุ่ม หน้าต่าง และช่องเป็นคำ STK ภาษาอังกฤษตาม STK ref §G ข้อความอธิบายเป็นภาษาไทยใน `labels/messages.th.ts`
คำที่ไม่มีใน STK ติดป้าย **(เพิ่มเอง)** ในตารางของ `labels.ts` แบบเดิม

## 7. ข้อผิดพลาด

| เหตุ | ผล |
|---|---|
| parent ไม่ใช่ดาวที่มีอยู่, cone_half_angle นอกช่วง, azimuth/elevation นอกช่วง | 422 พร้อมช่องที่ผิด กรอบแดงใน Properties |
| ชื่อซ้ำ | 409 แบบเดิม |
| scenario เก่าที่ไม่มี Sensor | เปิดได้เหมือนเดิม |
| scenario ที่มี Sensor แต่ parent หายไป (แก้ไฟล์เอง) | ตรวจ scenario ไม่ผ่าน 422 บอก path ที่อ้างไม่ได้ (เหมือน assigned_objects) |
| WebGL ของ Sensor View หลุด | ข้อความไทยในหน้าต่างแบบหน้าต่าง 3D เดิม หน้าต่างอื่นไม่กระทบ |

## 8. การทดสอบ

| ชั้น | ตรวจอะไร | ค่าจริง |
|---|---|---|
| pytest (server) | สร้าง/แก้/ลบ/Rename sensor, ลบดาวแล้ว sensor หาย, rename ดาวแล้ว parent เปลี่ยน, 422 ทุกช่อง, ต้นไม้มี children | หัวข้อ 4 |
| pytest (server) | plan hash ของ propagate/analyze เท่าเดิมหลังเพิ่ม sensor | — |
| Vitest | ρ ของ GPS/Galileo/ค้างฟ้า, ε ของกรวย α < ρ และ α ≥ ρ, รอยของ boresight เอียง, boresight จาก Az-El (el 90° = −r̂), กรอบตัวดาวของดาวค้างฟ้า | สูตรปิดหัวข้อ 3 |
| Vitest | ทิศบนแบบ North / Velocity, fov จาก α, ข้อความบนภาพ, เมนู Sensor View สร้าง sensor ด้วย ρ + 0.5° | — |
| Playwright | เลือก G01 → Sensor View → หน้าต่างเปิด, `sensorViewCamera` อยู่ที่ตำแหน่งดาวไม่เกิน 1 m และทิศชี้ศูนย์กลางโลกคลาดไม่เกิน 0.01° | `entityPositionEcef` |
| Playwright | Properties ของ sensor เปลี่ยน Cone Half Angle → fov และวงรอยเปลี่ยน; Delete ดาว → หน้าต่าง Sensor View ปิดและ sensor หายจากต้นไม้ | — |
| Playwright | ไม่มี request ออกนอกเครื่องและไม่มี error ในหน้า (ตัวตรวจเดิมของ e2e) | — |

## 9. ความเสี่ยง

| # | ความเสี่ยง | วิธีรับมือ |
|---|---|---|
| S1 | viewer ตัวที่ 3 ขึ้นไปใช้หน่วยความจำ GPU มาก | จำกัด 4 บาน, ใช้ภาพโลกเดิม, loseContext ตอนปิดแบบหน้าต่าง 3D เดิม |
| S2 | ตำแหน่งดาวที่ interpolate ให้ความเร็วผิดตอนต่อช่วง CZML | ใช้ผลต่าง ±1 วินาทีภายในช่วงเดียวกัน ที่ขอบช่วงใช้ข้างเดียว |
| S3 | กล้องใกล้ดาวมาก near plane ตัดภาพ | ตั้ง near ของ frustum = 1 m และมีกราฟิกของดาวแม่ซ่อนในหน้าต่างนี้ |
| S4 | คลิกซ้ายเพื่อเลือกชนกับการลากหมุนโลก | นับเป็นคลิกเมื่อเมาส์เลื่อนไม่เกิน 4 px ระหว่างกดและปล่อย |
