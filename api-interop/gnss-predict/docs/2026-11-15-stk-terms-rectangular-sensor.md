# STK Reference: Rectangular Sensors & Fixed Pointing (Verified)

**วันที่ตรวจสอบ:** 2026-11-15  
**แหล่งอ้างอิง:** เอกสารทางการของ Ansys Systems Tool Kit (STK) บน `https://help.agi.com` (เวอร์ชันปัจจุบันบนเว็บ: **v2026 R1 / STK 13.1.0** และ STK Object Model / Connect Reference)  
**หลักการบันทึก:** แยกชัดเจนระหว่างข้อเท็จจริงที่ **ยืนยันตรงตัว (Verbatim / Direct)** จากหน้าเอกสาร กับส่วนที่ **อนุมาน (Inferred)** จากเรขาคณิตหรือบริบท

---

## 1. ชื่อ Sensor Type / Pattern แบบสี่เหลี่ยม และหน้าตั้งค่า

### ยืนยันตรงตัว (Direct)
- ชื่อหน้าคุณสมบัติ: **`Basic - Definition`** (`https://help.agi.com/stk/Content/stk/sn-01.htm`, `https://help.agi.com/stk/Content/training/IntroSensors.htm`)
- ชื่อใน UI dropdown (`Sensor Type`): **`Rectangular`** (`https://help.agi.com/stk/Content/stk/sn-01.htm`)
  - ค่าอื่นทั้งหมดในเมนู `Sensor Type`: `Complex Conic`, `Custom`, `EOIR`, `Half Power`, `Rectangular`, `SAR`, `Simple Conic` (`sn-01.htm`)
- ชื่อในคำสั่ง Connect (`Define (Sensor)`): **`Rectangular`** (`https://help.agi.com/stk/SubSystems/connectCmds/Content/cmd_DefineSensor.htm`)
  - รูปแบบคำสั่ง: `Define <SensorObjectPath> Rectangular <VerticalHalfAngle> <HorizontalHalfAngle> [AngularRes <Value>]`
- ชื่อใน STK Object Model Interface: **`IAgSnRectangularPattern`** (`https://help.agi.com/stkdevkit/Content/DocX/STKObjects~IAgSnRectangularPattern.html`)

---

## 2. ชื่อช่องมุมและพารามิเตอร์

### ยืนยันตรงตัว (Direct)
- ในหน้า UI (`Basic - Definition` ของ `Rectangular`):
  - **`Vertical Half Angle`** (`https://help.agi.com/stk/Content/stk/sn-01.htm`, `https://help.agi.com/stk/Content/training/IntroSensors.htm`)
  - **`Horizontal Half Angle`** (`https://help.agi.com/stk/Content/stk/sn-01.htm`, `https://help.agi.com/stk/Content/training/IntroSensors.htm`)
- ใน STK Object Model (`IAgSnRectangularPattern`):
  - **`VerticalHalfAngle`** (`https://help.agi.com/stkdevkit/Content/DocX/STKObjects~IAgSnRectangularPattern~VerticalHalfAngle.html`)
  - **`HorizontalHalfAngle`** (`https://help.agi.com/stkdevkit/Content/DocX/STKObjects~IAgSnRectangularPattern~HorizontalHalfAngle.html`)
  - **`AngularResolution`** (ค่าตัวเลือกใน Object Model และ `AngularRes` ใน Connect)
- เรขาคณิตของมุม: *"The vertical and horizontal half-angles used in the specification of rectangular sensors serve to define the sensor field of view as being constrained by four planes intersecting at the vertex of the sensor. The resulting sensor pattern provides a rectangular shape when projected to a plane perpendicular to the boresight direction."* (`https://help.agi.com/stk/Content/stk/sn-01.htm`)

---

## 3. นิยามแกน Vertical / Horizontal เทียบกับกรอบตัวดาว (Along-Track vs Cross-Track)

> [!IMPORTANT]
> **ข้อค้นพบสำคัญจากเอกสาร STK (`sn-01.htm` Figure 3):** STK มีนิยามแกน **`Vertical` กับ `Horizontal` สลับคู่กัน** ระหว่าง **`Rectangular` มาตรฐาน ("For Comm and Radar")** กับ **`EOIR`**

### 3.1 ยืนยันตรงตัว (Direct)

1. **แกนมาตรฐานของกรอบ Sensor** (`https://help.agi.com/stk/Content/stk/sn-08.htm`):
   - *"Sensors have a natural coordinate frame in which the **+Z axis** is the sensor boresight and the X and Y axes form a plane perpendicular to the boresight."*
2. **สมมติฐานแกนของตัวดาวแม่ในนิยาม Rectangular** (`https://help.agi.com/stk/Content/stk/sn-01.htm`):
   - *"The naming convention for the parameters used to specify the shape of a rectangular sensor assumes that the satellite to which the sensor is attached is geostationary with its **X axis in the direction of the ECI velocity vector** and its **Z axis pointed toward nadir**."*
   - และใน `https://help.agi.com/stk/Content/stk/referenceframesvehicle.htm`: โปรไฟล์ท่าทาง **`Nadir alignment with ECI velocity constraint`** กำหนดให้ *"aligns the vehicle's **Z axis with the geocentric nadir direction** and constrains its **X axis in the direction of the ECI velocity vector**."*
   - และใน `https://help.agi.com/stk/Content/stk/sn-orientation.htm`: เมื่อใช้ค่าเริ่มต้น (`Fixed`, `Az-El`, `Azimuth = 0 deg`, `Elevation = 90 deg`, `About Boresight = Rotate`) *"the sensor or antenna frame coincides with the subcomponent reference frame"* (สำหรับ vehicle คือตรงกับกรอบตัวดาวพอดี)
3. **คำนิยามจากตาราง Rectangular Sensor Patterns และ Figure 3 (`rectSensorcompare.png`)** (`https://help.agi.com/stk/Content/stk/sn-01.htm`, `https://help.agi.com/stkdevkit/Content/DocX/STKObjects~IAgSnRectangularPattern.html`):

| โหมดใน STK | `Vertical Half Angle` (ระนาบเทียบแกน Sensor) | `Horizontal Half Angle` (ระนาบเทียบแกน Sensor) | ป้ายแกนใน Figure 3 (`rectSensorcompare.png`, มองลงตาม boresight) |
|---|---|---|---|
| **For Comm and Radar** *(ค่ามาตรฐานของ Sensor Type `Rectangular` และ `IAgSnRectangularPattern`)* | มุมจาก boresight (`Z`) ไปยังขอบ sensor ในระนาบ **`YZ`** | มุมจาก boresight (`Z`) ไปยังขอบ sensor ในระนาบ **`XZ`** | แกนนอน (Horizontal) = **`X (parent body)`**, แกนตั้ง (Vertical) = **`Y`** |
| **For EOIR** *(โมดูล `EOIR`)* | มุมจาก boresight (`Z`) ไปยังขอบ sensor ในระนาบ **`XZ`** | มุมจาก boresight (`Z`) ไปยังขอบ sensor ในระนาบ **`YZ`** | แกนนอน (Horizontal) = **`Y (parent body)`**, แกนตั้ง (Vertical) = **`X`** |

### 3.2 อนุมาน (Inferred) เทียบ Along-Track / Cross-Track

เมื่อดาวเทียมใช้กรอบท่าทางมาตรฐาน `Nadir alignment with ECI velocity constraint` (`+Z` ลงโลก, `+X` ตามแนวความเร็ว ECI = **along-track**, `+Y = Z × X` ตั้งฉาก = **cross-track**) และเซ็นเซอร์หันค่าเริ่มต้น (`Az = 0°`, `El = 90°`, `Rotate` → แกนเซ็นเซอร์ทับแกนตัวดาว):

- **ตามนิยาม `Rectangular` มาตรฐานของ STK (`For Comm and Radar` / `IAgSnRectangularPattern`):**
  - **`Horizontal Half Angle`** (ระนาบ `XZ`, กางไปตามแนวแกน **`X`**) → **ตามแนวบิน (Along-Track)**
  - **`Vertical Half Angle`** (ระนาบ `YZ`, กางไปตามแนวแกน **`Y`**) → **ขวางแนวบิน (Cross-Track)**
- **ตามนิยาม `EOIR` ของ STK (`For EOIR`):**
  - **`Horizontal Half Angle`** (ระนาบ `YZ`, กางไปตามแนวแกน **`Y`**) → **ขวางแนวบิน (Cross-Track)**
  - **`Vertical Half Angle`** (ระนาบ `XZ`, กางไปตามแนวแกน **`X`**) → **ตามแนวบิน (Along-Track)**
- **นัยสำคัญต่อ GNSS Studio:** ใน `docs/2026-11-15-imaging-satellites-research.md` §2.3 และ §5.5 ใช้ความหมายแบบ `EOIR` (Horizontal = cross-track, Vertical = along-track) ซึ่งตรงกับมุมมองผู้สังเกตที่บินไปข้างหน้าแล้วมองลง แต่ **ต่างจาก** `Rectangular` (Comm/Radar) ของ STK ที่เอาแกน `X` ไว้เป็น `Horizontal` ดังนั้นในสคีมาของ GNSS Studio ต้องระบุให้ชัดว่าจะอ้างตามระบบแกน `Rectangular (Comm/Radar)` หรือ `EOIR` (หรือวางเซ็นเซอร์หมุน `Az = 90°` รอบ boresight) เพื่อไม่ให้สลับด้านยาว-สั้นของ swath (เช่น `±55° × ±0.41°`)

---

## 4. หน่วยและช่วงค่าที่ยอมรับ

### ยืนยันตรงตัว (Direct)
- **Connect Command (`Define ... Rectangular`):** *"All Angle values are entered in **degrees**."* และส่วน `AngularRes` ระบุช่วงชัดว่า *"Enter `<Value>` in degrees from **`0.000001` to `90.0`**."* (`https://help.agi.com/stk/SubSystems/connectCmds/Content/cmd_DefineSensor.htm`)
- **STK Object Model (`VerticalHalfAngle` / `HorizontalHalfAngle`):** *"Uses **Angle Dimension**"* (ส่งเป็นตัวเลข radian โดยปริยาย หรือ string พร้อมหน่วย เช่น `"22.5 deg"` ใน COM/API; `https://help.agi.com/stkdevkit/Content/DocX/STKObjects~IAgSnRectangularPattern~VerticalHalfAngle.html`, `cmd_DefineSensor.htm`)
- **ข้อสังเกตจากเอกสารที่ตรวจ:** หน้า `sn-01.htm`, `cmd_DefineSensor.htm` และ `IAgSnRectangularPattern*.html` **ไม่ได้พิมพ์ตัวเลขขีดจำกัดบน-ล่างของ `Vertical Half Angle` และ `Horizontal Half Angle` ไว้ตรงตัว** (ต่างจาก `AngularRes` ที่ระบุ `0.000001–90.0 deg` หรือ `UpVector Clock angle offset` ที่ระบุ `-360 to 360 deg`)

### อนุมาน (Inferred)
- จากคำนิยามใน `sn-01.htm` ว่ามุมทั้งสองกำหนด FOV *"as being constrained by four planes intersecting at the vertex of the sensor"* และเป็น **half-angle** วัดจากแกน boresight (`+Z`) ไปยังขอบแต่ละด้าน:
  - ทางเรขาคณิต **ต้องมากกว่า `0°` และน้อยกว่า `90°` (`0° < half_angle < 90°`)** จึงจะเกิดพีระมิดสี่เหลี่ยมมีปริมาตรจริงบนระนาบตั้งฉาก boresight (ถ้า `0°` จะยุบเป็นเส้น; ถ้า `≥ 90°` ระนาบด้านตรงข้ามจะซ้อนเป็นระนาบครึ่งปริภูมิเดียวหรือพลิกกลับ ไม่เกิดช่องสี่เหลี่ยมในครึ่งปริภูมิ `+Z`)
  - *(เทียบเคียง: สำหรับ `Simple Conic` เอกสาร `IntroSensors.htm` มีตัวอย่างตั้ง `Cone Half Angle = 90 deg` ได้ เพราะกรวย `90°` กลายเป็นระนาบครึ่งทรงกลม แต่ `Rectangular` ต้องตัดเป็น 4 ระนาบ)*

---

## 5. ชื่อ Pointing แบบ Fixed และตัวเลือกย่อย

### ยืนยันตรงตัว (Direct)
- ชื่อหน้าคุณสมบัติ: **`Basic - Pointing`** (`https://help.agi.com/stk/Content/stk/sn-08.htm`, `https://help.agi.com/stk/Content/stk/referenceFramesSensorPointing.htm`)
- ชื่อ Pointing Type: **`Fixed`** (เป็นค่าเริ่มต้น — *"Model sensors that are fixed in the parent object's body coordinate frame, so that they always point in the same direction relative to the parent."*; `sn-08.htm`, `referenceFramesSensorPointing.htm`)
  - Pointing Type อื่นทั้งหมด: `3D Model`, `Along Vector`, `Fixed`, `Targeted`, `Spinning`, `External`, `Grazing Altitude` (`GrazingAlt`), `Fixed in Axes` (`FixedInRef`), `Scheduled` (Connect only)
- ตัวเลือก **`Orientation Method`** ภายใต้ `Fixed` (`https://help.agi.com/stk/Content/stk/sn-orientation.htm`, `https://help.agi.com/stk/SubSystems/connectCmds/Content/cmd_PointFixed.htm`):
  1. **`Az-El`** *(ค่าเริ่มต้น)*:
     - ช่องกรอก: **`Azimuth`** (default **`0 deg`**), **`Elevation`** (default **`90 deg`**), **`About Boresight`** (ตัวเลือกภายใต้ Fixed: **`Rotate`** [default] หรือ **`Hold`**; ส่วน `Level` และ `UpVector` มีเฉพาะ Targeted tracking sensor)
     - คำสั่ง Connect: `Point <SensorObjectPath> Fixed AzEl <Azimuth> <Elevation> [{Hold | Rotate}]`
     - API: `IAgSnCommonTasks.SetPointingFixedAzEl(Azimuth, Elevation, AboutBoresight)` (`https://help.agi.com/stkdevkit/Content/DocX/STKObjects~IAgSnCommonTasks~SetPointingFixedAzEl.html`)
     - ทิศทางบน vehicle: `Azimuth` วัดจาก `+X` ไปทาง `+Y` แบบมือขวาในระนาบ `XY`; `Elevation` วัดจากระนาบ `XY` เข้าหา **`+Z`** (ค่าเริ่มต้น `Az=0°, El=90°` → ชี้ตาม `+Z` = nadir) *(ส่วน Facility/Place/Target จะพลิกกรอบอ้างอิง 180° รอบแกน `X` เป็น North-West-Up เพื่อให้ Elevation บวกชี้ขึ้นฟ้า)*
  2. **`Euler Angles`**: `Sequence` (`121, 123, 131, 132, 212, 213, 231, 232, 312, 313 [default], 321, 323`), `Euler A`, `Euler B`, `Euler C` (default `0 deg`)
  3. **`Quaternion`**: `qx = 0`, `qy = 0`, `qz = 0`, `qs = 1` (unit quaternion, Shuster convention)
  4. **`YPR Angles`**: `Sequence` (`123, 132, 213, 231, 312, 321` / default `YPR`), `Yaw = 0 deg`, `Pitch = 0 deg`, `Roll = 0 deg`

---

## 6. ดัชนี URL อ้างอิง

1. `https://help.agi.com/stk/Content/stk/sn-01.htm` — *Sensor Definition* (`Rectangular`, `Vertical Half Angle`, `Horizontal Half Angle`, Comm/Radar vs EOIR, Figure 3)
2. `https://help.agi.com/stk/Content/stk/images/rectSensorcompare.png` — *Figure 3. Rectangular Sensor Coordinate Systems*
3. `https://help.agi.com/stk/Content/stk/sn-08.htm` — *Sensors - Pointing* (Sensor frame `+Z` boresight, Pointing Types)
4. `https://help.agi.com/stk/Content/stk/sn-orientation.htm` — *Orientation Methods* (`Fixed`, `Az-El`, `Euler Angles`, `Quaternion`, `YPR Angles`, `About Boresight`, defaults)
5. `https://help.agi.com/stk/Content/stk/referenceFramesSensorPointing.htm` — *Sensor Pointing Definitions* (`Fixed` บน vehicle vs facility/place/target)
6. `https://help.agi.com/stk/Content/stk/referenceframesvehicle.htm` — *Vehicle Coordinate Frames* (`Nadir alignment with ECI velocity constraint`)
7. `https://help.agi.com/stk/Content/training/IntroSensors.htm` — *Intro to Sensors Tutorial* (ตัวอย่าง UI `Basic - Definition` / `Basic - Pointing`)
8. `https://help.agi.com/stk/SubSystems/connectCmds/Content/cmd_DefineSensor.htm` — *Connect `Define (Sensor)`* (`Rectangular`, degree units, `AngularRes` range)
9. `https://help.agi.com/stk/SubSystems/connectCmds/Content/cmd_PointFixed.htm` — *Connect `Point Fixed`* (`AzEl`, `Euler`, `YPR`, `Quaternion`)
10. `https://help.agi.com/stkdevkit/Content/DocX/STKObjects~IAgSnRectangularPattern.html` — *Object Model `IAgSnRectangularPattern`*
11. `https://help.agi.com/stkdevkit/Content/DocX/STKObjects~IAgSnRectangularPattern~VerticalHalfAngle.html` — *`VerticalHalfAngle` Property*
12. `https://help.agi.com/stkdevkit/Content/DocX/STKObjects~IAgSnRectangularPattern~HorizontalHalfAngle.html` — *`HorizontalHalfAngle` Property*
13. `https://help.agi.com/stkdevkit/Content/DocX/STKObjects~IAgSnCommonTasks~SetPointingFixedAzEl.html` — *`SetPointingFixedAzEl` Method*

