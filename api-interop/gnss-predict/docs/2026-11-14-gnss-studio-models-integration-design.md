# GNSS Studio: แสดงโมเดล 3 มิติของดาวในหน้าต่าง 3D

- วันที่: 2026-11-14
- Branch: `feature/gnss-studio-imagery` (รวม `feature/gnss-studio-models` แล้วที่ 36b62c8)
- สถานะ: ผู้ใช้สั่ง "เอา model 3d ดาวเทียมเข้ามาหน่อย" ให้ลงมือทันที
- ที่มา: โมเดลและ `models/catalog.json` จาก [brief โมเดล](2026-11-14-gnss-studio-models-brief.md); กรอบตัวดาวจาก sensor §3.1

## 1. เป้าหมายและเกณฑ์ว่าสำเร็จ

ดาวในหน้าต่าง 3D แสดงเป็นโมเดล 3 มิติตามรุ่นของมันแทนจุด แบบ STK หันตัวดาวตามจริงโดยประมาณ (เสาอากาศลงโลก แผงโซลาร์หันหาดวงอาทิตย์)

1. ดาวทุกดวงที่แสดงในหน้าต่าง 3D ได้โมเดลตาม catalog: block จากข้อมูลดาว (`satelliteInfo(norad).block`) → `norad_ids` → `generic`
2. ซูมออกไกลยังเห็นดาวเป็นโมเดลขนาดไม่ต่ำกว่า N พิกเซล (ค่าตั้งต้น 48) ซูมเข้าเห็นขนาดจริงเป็นเมตร
3. ท่าทาง: +Z ตัวดาวชี้ศูนย์กลางโลกคลาดไม่เกิน 0.1°; ดาว GNSS ใช้ yaw steering ตามแบบจำลอง IGS (ดวงอาทิตย์อยู่ในระนาบ X-Z ฝั่ง +X); แผงโซลาร์หมุนรอบแกน Y ให้หน้าแผงหันหาดวงอาทิตย์คลาดไม่เกิน 1°
4. ปิดโมเดลได้ (กลับเป็นจุด) ที่หน้าต่าง 3D Graphics Window Properties; คลิกเลือกดาว, สี, ชื่อ, การซ่อน, Sensor และ Access ยังทำงานเหมือนเดิม
5. ไม่มี request ออกนอกเครื่อง (ไฟล์โมเดลมากับแอป) ชุดทดสอบเดิมผ่าน

## 2. ขอบเขต

**ทำ**
- ส่งไฟล์ `catalog.json` และ `<id>/<id>.glb` ไปกับหน้าเว็บ (build และ dev) ที่ `/models/...` ไม่ส่ง `_refs/`, `scripts/`, `renders/`, `vendor/`, `textures/`
- ตัวเลือกโมเดลจาก catalog, คณิตท่าทาง (yaw steering, nadir + velocity สำหรับดาวสำรวจโลก), วาดด้วย `ModelGraphics`
- ตัวเลือกใน 3D Graphics Window Properties: **Satellite Models** (เปิด/ปิด) และ **Model Pixel Size** (ป้าย `ours` เว้นแต่พบคำ STK ตรงตัว)

**ไม่ทำ**
- การหมุนพิเศษช่วงเที่ยง/เที่ยงคืนของ yaw steering (noon/midnight turn), โหมด orbit-normal ของ BeiDou GEO/IGSO: ใช้ yaw steering แบบ nominal ทุกช่วง (บันทึกเป็นข้อจำกัด)
- override ตาม COSPAR (catalog ของหน้าเว็บไม่มีรหัส COSPAR; `overrides` ว่างอยู่)
- โมเดลในหน้าต่าง 2D และ Sensor View (Sensor View โหมด Camera ซ่อน entity อยู่แล้ว; โหมด Sensor แสดงตามหน้าต่าง 3D)
- หน้า Properties ของดาวแต่ละดวง (3D Graphics - Model) — ใช้ตัวเลือกระดับหน้าต่างก่อน

## 3. ท่าทาง (คำนวณใน ECEF ณ เวลา Animation)

ให้ r, v = ตำแหน่ง/ความเร็ว ECEF ของดาว (ความเร็วจากผลต่างตำแหน่ง t ± 1 s แบบเดียวกับ sensor), s = ตำแหน่งดวงอาทิตย์ ECEF (ใช้ฟังก์ชันของ Cesium ที่หน้าต่าง 3D ใช้กับแสงอยู่แล้ว)

- **GNSS (ทุกระบบ, รวม QZSS/NavIC) — yaw steering:** ez = −r̂; es = (s − r)/|s − r|; ey = (ez × es)/|ez × es|; ex = ey × ez
  เมื่อ |ez × es| < 1e-6 (ดวงอาทิตย์อยู่แนวเดียวกับ nadir) ใช้ ey ของเฟรมก่อนหน้า ถ้าไม่มีใช้เฟรม sensor §3.1
- **ดาวสำรวจโลก (โมเดลจาก `norad_ids`) — Nadir alignment with ECI velocity constraint:** เฟรมเดียวกับ sensor §3.1
- **แผงโซลาร์:** หมุน node `wing±Y` รอบแกน +Y ของตัวดาว ด้วยมุม θ ที่ทำให้ normal ด้านเซลล์ของแผงชี้ไปทาง es ที่ฉายลงระนาบ X-Z
  (θ = มุมจาก normal ตอนมุมศูนย์ไปหา (es·ex, 0, es·ez)); normal ตอนมุมศูนย์อ่านจากโมเดลจริง (NOTES ของแต่ละโมเดลหรือ verify) แล้วกำหนดเป็นค่าคงที่ต่อโมเดลใน catalog ถ้าต่างกัน
  ผู้ลงมือต้องพิสูจน์ด้วย test ว่าหลังหมุน normal ห่างจาก es ไม่เกิน 1° สำหรับ GNSS (yaw steering ทำให้ es อยู่ในระนาบ X-Z เสมอ);
  ดาวสำรวจโลกใช้วิธีเดียวกัน (แผงเดี่ยว `wing-Y`) โดยยอมให้คลาดตามมุม β
- แกนของโมเดล: glb ส่งออกแบบ glTF Y-up (glTF (x,y,z) = body (x, z, −y)); ต้องพิสูจน์ด้วย test กับ `ModelUtility.getAxisCorrectionMatrix` ของ Cesium 1.147 ว่าตั้งค่า `upAxis`/`forwardAxis` แบบไหนทำให้ model space = body frame แล้วใช้ค่านั้น

## 4. การวาด

- satellite entity ที่ระบบเปิดโมเดล: `entity.model = ModelGraphics({ uri, minimumPixelSize, maximumScale: 20000, nodeTransformations: { "wing+Y", "wing-Y" } })`, `entity.orientation` = quaternion body→ECEF, ซ่อน `entity.point` (ชื่อและเส้นทางคงเดิม)
- อัปเดต orientation และมุมแผงด้วย `ConstantProperty` ตามรอบ throttle 250 ms เดียวกับ sensor (ห้าม `CallbackProperty`)
- สีของดาว: ใช้ `color` แบบ `ColorBlendMode.MIX` 0.3 ให้ยังเห็นสีระบบ, `silhouetteColor` = สีดาวเมื่อถูกเลือก
- โหลดโมเดลล้มเหลว → กลับเป็นจุดสำหรับ id นั้น + ข้อความไทยใน Message Viewer ครั้งเดียวต่อ id
- คลิกเลือกดาวยังใช้ตำแหน่งจุดศูนย์กลางในระยะ 8 พิกเซล (pick.ts เดิม) — ไม่เปลี่ยน

## 5. ทดสอบ

- unit: catalog resolve (block, norad_ids, fallback, block ซ้ำ), ท่าทาง (ตั้งฉากกัน, ez nadir, ดวงอาทิตย์ฝั่ง +X, แผงหันหาดวงอาทิตย์ ≤ 1°, กรณีเอกฐาน), แกนโมเดลกับ Cesium จริง, ตัวเลือกหน้าต่าง, fallback เมื่อโหลดไม่สำเร็จ
- build: `dist/models/catalog.json` และ glb ทุกตัวใน catalog มีอยู่, ไม่มี `_refs`/`scripts`/`vendor`
- e2e: หน้าต่าง 3D มีดาวแสดงเป็นโมเดล (hook นับ entity ที่มี model), ปิดตัวเลือก → กลับเป็นจุด; ไม่มี request นอกเครื่อง
