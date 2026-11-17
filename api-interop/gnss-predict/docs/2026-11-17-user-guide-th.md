# คู่มือผู้ใช้ GNSS Studio (ฉบับย่อ)

คู่มือนี้สรุปการใช้งาน **GNSS Studio** ในส่วนที่พัฒนาแล้วเสร็จ โดยอ้างอิงชื่อเมนูและปุ่มตามที่แสดงบนหน้าจอจริง

---

## 1. เริ่มต้นใช้งานและเปิดฉาก (Scenario)

1. เมื่อเปิดแอป จะพบหน้าต่าง **Welcome to GNSS Studio**:
   - **Open a Scenario**: คลิกชื่อฉากที่มีอยู่ (เช่น `acc_20261111`) เพื่อเปิดทันที
   - **Create a Scenario**: กดปุ่มนี้เพื่อเปิด **New Scenario Wizard** สำหรับสร้างฉากใหม่ (กำหนดชื่อ, ช่วงเวลา **Start** / **Stop**, และเลือก Orbit Snapshot)
2. เมนูหลักด้านบนภายใต้ **File**:
   - **New...** / **Open...** / **Save** (`Ctrl+S`) / **Save As...** / **Close** / **Recent Scenarios**

---

## 2. การเพิ่มดาวเทียมและสถานีภาคพื้น (Insert)

เข้าผ่านเมนู **Insert** (หรือปุ่ม **Insert Object** บนแถบเครื่องมือ **Default**):
- **Insert → Facility...**: เพิ่มสถานีรับสัญญาณภาคพื้น (ตั้งชื่อ, พิกัด Lat/Lon/Alt, และ **Min Elevation** สำหรับคำนวณ Access)
- **Insert → Satellite... → From Satellite Catalog**:
  - ค้นหาและเลือกดาวเทียมจาก snapshot ในเครื่อง (**Local snapshot**) กรองตามระบบ (`GPS`, `GLONASS`, `Galileo`, `BeiDou`)
  - ติ๊ก **Create Constellation from Selected** เพื่อจัดกลุ่มดาวที่เลือกเป็น Constellation อัตโนมัติ แล้วกด **Insert**
- **Insert → Sensor...**: เพิ่มเซนเซอร์ให้ดาวเทียมที่เลือก (แบบ **Define Properties** หรือ **Insert Default**)

---

## 3. หน้าต่างแสดงผลหลัก (3D / 2D / Timeline / Object Browser)

- **Object Browser** (ด้านซ้าย): แสดงโครงสร้าง Scenario, Facility, Satellite, Sensor และ Constellation
  - ช่องติ๊กซ้ายสุดใช้ **ซ่อน/แสดง** วัตถุบนหน้าต่าง 3D และ 2D
  - คลิกขวาที่วัตถุเพื่อเปิดคำสั่งลัด (**Properties**, **Access...**, **Report & Graph Manager...**, **Zoom To**, **Rename**, **Delete**)
  - สัญลักษณ์เตือน `⚠` ข้างชื่อดาวแสดงว่าข้อมูลวงโคจรเก่า (stale), ไม่มีใน broadcast (`no_broadcast`) หรือไม่สมบูรณ์ (`unhealthy`)
- **3D Graphics 1 - Earth** และ **2D Graphics 1 - Earth**:
  - **หน้าต่าง 3D**: ลากเมาส์ซ้ายเพื่อหมุนโลก, ลากขวาหรือเลื่อนลูกกลิ้งเพื่อซูม, กด `Shift` + ล้อเมาส์เพื่อเลื่อนเวลาทีละก้าว
  - **โมเดล 3 มิติ**: เมื่อซูมเข้าใกล้ดาวเทียม (หรือคลิกขวา **Zoom To** บนดาว) จุดดาวจะเปลี่ยนเป็นโมเดล 3 มิติพร้อมแผงโซลาร์เซลล์ที่หันตามทิศทางดวงอาทิตย์และสายอากาศชี้ลงโลก ตั้งค่าได้ที่ **3D Graphics Window Properties** (แถบเครื่องมือ **3D Window Defaults** → **Properties**, เปิดแถบได้จาก **View → Toolbars**)
  - **หน้าต่าง 2D**: แสดงแผนที่โลก, เส้นรอยเคลื่อนที่ของดาว (Ground Track), เส้นแบ่งกลางวัน-กลางคืน, และขอบเขต Swath / Sensor Footprint
- **Timeline View** (ด้านล่าง): แสดงแถบเวลา **Global Time Bar** และช่วง Access ของแต่ละคู่ Facility–Satellite; คลิกขวาบนช่วงเวลาเพื่อสั่ง **Set Animation Time to Here**
- แถบควบคุมเวลา (**Animation** toolbar): **Reset**, **Step Backward**, **Reverse**, **Pause**, **Start**, **Step Forward** รวมถึงปรับ **Time Step** และ **Normal / Real-Time / X Real-Time Animation Mode**

---

## 4. การใช้งาน Sensor และ Sensor View

1. คลิกขวาที่ดาวเทียมหรือเซนเซอร์ใน **Object Browser** (หรือคลิกขวาบนดาวในหน้าต่าง 3D) แล้วเลือก **Sensor View**
   - ถ้าดาวยังไม่มีเซนเซอร์ ระบบจะสร้าง `Sensor1` ให้โดยอัตโนมัติ (มุมกรวยครึ่งหนึ่งตั้งต้นครอบคลุมจานโลก + 0.5°)
2. แถบควบคุมภายในหน้าต่าง **Sensor View**:
   - **Up**: สลับทิศบนของภาพระหว่าง **North** (ทิศเหนือ) กับ **Velocity** (ตามทิศการเคลื่อนที่ของดาว)
   - **Display**:
     - **Camera**: มุมมองกล้องจากดาว (ไม่แสดงวงขอบกรวย)
     - **Sensor**: แสดงวงขอบกรวยของเซนเซอร์บนภาพ
   - **Zoom** (`Zoom In`, `Zoom Out`): ซูมได้ตั้งแต่ `×1` จนถึง `×262k`
   - **Width**: พิมพ์ความกว้างพื้นที่ที่ต้องการดูที่จุดใต้ดาวโดยตรง เช่น `500 m` หรือ `1.5 km` (ถ้าไม่ใส่หน่วยจะถือเป็นเมตร) แล้วกด `Enter`

---

## 5. Globe Manager และแหล่งภาพพื้นโลกออนไลน์

เปิดจากเมนู **View → Globe Manager** (ค่าเริ่มต้น **ปิดทุกแหล่ง** เพื่อทำงานแบบออฟไลน์เต็มรูปแบบด้วย **Natural Earth II**):

| แหล่งภาพออนไลน์ | ข้อมูลที่ส่งออกนอกเครื่องเมื่อเปิดใช้งาน | แสดงบนหน้าต่างใด | วิธีปิด |
|---|---|---|---|
| **Online imagery (NASA GIBS)** | server ในเครื่องส่งคำขอไปยัง `gibs.earthdata.nasa.gov` (NASA เห็น IP และ User-Agent ของเครื่อง) | 3D และ Sensor View | เอาเครื่องหมายถูกหน้า `Online imagery (NASA GIBS)` ออก |
| **Online imagery (Sentinel-2 cloudless)** | server ในเครื่องส่งคำขอไปยัง `tiles.maps.eox.at` (ใช้เฉพาะงานไม่เชิงพาณิชย์) | 3D และ Sensor View | เอาเครื่องหมายถูกหน้า `Online imagery (Sentinel-2 cloudless)` ออก |
| **Online imagery (OpenStreetMap)** | **เบราว์เซอร์ดึงตรง** จาก `tile.openstreetmap.org` (OSM เห็น IP, User-Agent และ Referer) | 3D และ Sensor View | เอาเครื่องหมายถูกหน้า `Online imagery (OpenStreetMap)` ออก |
| **Online imagery (Cesium ion)** | **เบราว์เซอร์ดึงตรง** จาก `api.cesium.com` พร้อม **Cesium Ion Token** ของคุณ (เมื่อเปิดและเลือก Asset แล้ว ภาพอื่นทั้งหมดรวมถึง Natural Earth II จะถูกซ่อน) | 3D และ Sensor View | เอาเครื่องหมายถูกหน้า `Online imagery (Cesium ion)` ออก หรือเลือก **None** |

- การเปิดใช้งานแต่ละแหล่งจะต้องกดยืนยันในกล่องข้อความก่อนทุกครั้ง และตั้งค่าความโปร่งแสง (`% Translucency`) แยกตามชั้นได้ในตาราง

---

## 6. การรันด้วย Docker (แบบย่อ)

ระบบมี `Dockerfile` และ `docker-compose.yml` ที่รวม Server, หน้าเว็บที่ build แล้ว และ **NASA GMAT R2026a** ไว้ใน container เดียว (สำหรับ `linux/amd64`):

```bash
cd api-interop/gnss-predict
docker compose up -d --build
```

- เปิดใช้งานที่ `http://127.0.0.1:8000/` (เปลี่ยนพอร์ตได้ด้วย `GNSS_STUDIO_PORT=8010 docker compose up -d`)
- ข้อมูลฉากและค่าตั้งทั้งหมดจะถูกเก็บใน Docker volume `gnss_data` (`/data` ใน container) โดยค่าตั้งเริ่มต้นจะปิดงานดึงข้อมูลอัตโนมัติและภาพออนไลน์ทั้งหมดไว้
- ดู log: `docker compose logs -f` | หยุดการทำงาน: `docker compose down`
