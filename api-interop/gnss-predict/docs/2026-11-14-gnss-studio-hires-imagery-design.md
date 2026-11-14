# GNSS Studio งานเสริม ข1.5: ภาพละเอียดระดับเมืองและถนน (Sentinel-2, OpenStreetMap, Cesium ion)

- วันที่: 2026-11-14
- Branch: `feature/gnss-studio-imagery` (ต่อจาก f944910)
- สถานะ: ผู้ใช้ถาม "มีแบบที่ซูมจนเห็นถนน เห็นเมืองข้างล่างไหม" แล้วเลือก "เอาทั้ง a b c" (2026-11-14) ให้ลงมือทันที
- ต่อยอด: [spec ภาพ GIBS](2026-11-14-gnss-studio-imagery-design.md) (อ้างว่า "imagery §n"), [การตัดสินใจ](2026-11-14-gnss-studio-imagery-decisions.md)

## 1. เป้าหมาย

Sensor View โหมด Camera ซูมลงไปเห็นเมืองและถนนใต้ดาวได้ (ภาพจำลองแบบแผนที่ ไม่ใช่สิ่งที่ดาว GNSS ถ่ายได้จริง)
เพิ่มแหล่งภาพ 3 แหล่ง แต่ละแหล่งมีสวิตช์และกล่องยืนยันของตัวเอง ปิดเป็นค่าตั้งต้น

| แหล่ง | ทาง | ภาพ | ระดับซูมสูงสุด | เงื่อนไขสำคัญ |
|---|---|---|---|---|
| **A** Sentinel-2 cloudless (EOX) | ผ่านตัวกลางใน server (เหมือน GIBS, มี cache) | ภาพถ่ายไร้เมฆรายปี 10 m | ตรวจในขั้นยืนยันจริง (คาด 14–15) | ไม่ใช้เชิงพาณิชย์ + เครดิต "Sentinel-2 cloudless - https://s2maps.eu by EOX IT Services GmbH (Contains modified Copernicus Sentinel data <ปี>)" |
| **B** OpenStreetMap | browser ดึงตรง `https://tile.openstreetmap.org/{z}/{x}/{y}.png` | แผนที่ถนนพร้อมชื่อ | 19 | เครดิต "© OpenStreetMap contributors" บนจอ, ใช้เฉพาะชิ้นที่กำลังดู ห้ามโหลดล่วงหน้า/ออฟไลน์, ห้ามส่ง no-cache, ห้ามตั้ง Referrer-Policy ที่ตัด Referer, ไม่แนะนำ proxy ที่ cache เอง (จึงให้ browser ดึงตรง) |
| **C** Cesium ion | browser ดึงตรงด้วย `IonImageryProvider` และ token ของผู้ใช้ | ภาพ Bing/Google ระดับ ~0.3–1 m (แล้วแต่ asset ที่บัญชีมี) | ตาม asset | ใช้ไม่เชิงพาณิชย์ (บัญชี Community), **ห้ามซ้อนกับภาพแหล่งอื่น**, ต้องแสดงเครดิตของ ion/ผู้ให้ภาพ |

### เกณฑ์ว่าสำเร็จ

1. ทุกแหล่งปิดเป็นค่าตั้งต้น (รวม `settings.json` เก่า) ปิดอยู่ = ไม่มี request ไปโฮสต์นั้นเลย ทั้งจาก server และ browser
2. เปิดแหล่งใดต้องผ่านกล่องยืนยันภาษาไทยที่บอกโฮสต์ สิ่งที่ส่งออก (IP, User-Agent, Referer หรือ token แล้วแต่แหล่ง) และวิธีปิด
3. ชั้นภาพ ion ที่แสดงอยู่ = ชั้นอื่นทั้งหมด (GIBS, EOX, OSM และ Natural Earth II) ถูกซ่อนในทุก viewer จนกว่าจะปิดชั้น ion
4. Sensor View ซูมได้ ×1–×8192 (×1024 ≈ 10 km, ×8192 ≈ 1.3 km ที่ความสูง GPS) ทิศกล้องยังคลาดไม่เกิน 0.01°
5. e2e ยังไม่มี request ออกนอกเครื่อง (ทุกแหล่งปิด) ไม่มีชุดทดสอบใดต่อเน็ตจริง; ชุดทดสอบเดิมผ่านทั้งหมด

## 2. ค่าตั้ง

`settings.json` → `online_imagery` เพิ่ม 3 ช่อง: `{"enabled": false, "eox": false, "osm": false, "ion": false}`
- `enabled` คงความหมายเดิม = NASA GIBS (เพื่อไม่ทำลายไฟล์เดิม); `eox`, `osm`, `ion` เป็น bool strict ค่าตั้งต้น false
- ไฟล์ที่ไม่มีช่องใหม่โหลดได้เป็น false; PUT ต้องส่งครบเอกสาร (หน้าต่าง Daily ส่ง `online_imagery` ที่โหลดมาคืนทั้งก้อนอยู่แล้ว)
- token ของ ion ใช้ช่องเดิม `cesium_ion_token` (หน้าต่าง Daily Forecast Settings มีช่องนี้อยู่แล้ว; Globe Manager มีช่องกรอกด้วย)

## 3. Server (เฉพาะ EOX)

- catalog แยกตามแหล่ง (`source: "gibs" | "eox"`) แต่ละแหล่งมีแม่แบบ URL, ตารางชั้น, สวิตช์ (`enabled` / `eox`) ของตัวเอง
  EOX: `https://tiles.maps.eox.at/wmts/1.0.0/{layer}/default/g/{z}/{y}/{x}.jpg`, ชั้น `s2cloudless-2024_3857` (ชื่อชั้น/TileMatrixSet `g`/ระดับสูงสุด ยืนยันในขั้นยืนยันจริง; คาด max_level 15), period `static`, ext jpg
- route เดิม `/api/imagery/tiles/{layer}/{time}/{z}/{y}/{x}` ใช้ต่อ (EOX ใช้ time `default`); สวิตช์ของแหล่งปิด → 403 `IMAGERY_DISABLED`
  ข้อความไทยระบุชื่อแหล่ง; การพัก (403/429, ผิดติด 20 ครั้ง) และตัวนับแยกต่อแหล่ง; เพดานพร้อมกัน: GIBS 4, EOX 4 (เดิม 2; เพิ่มในรอบเร่งความเร็ว)
- `GET /api/imagery/layers` → `{"enabled", "sources": {"gibs": bool, "eox": bool, "osm": bool, "ion": bool}, "layers": [... + "source"]}` (`enabled` คงไว้เพื่อเข้ากันได้)
- cache: EOX เป็นภาพคงที่ เก็บถาวรใต้เพดาน 2 GB เดิม
- OSM และ ion ไม่ผ่าน server

## 4. Web

### 4.1 แหล่งที่ browser ดึงตรง

- **OSM**: `UrlTemplateImageryProvider` url ตาม §1, `maximumLevel: 19`, `WebMercatorTilingScheme`, credit "© OpenStreetMap contributors" แสดงบนจอ
  ใช้ policy เดิมของ Cesium (ขอเฉพาะชิ้นที่มองเห็น ไม่มีการโหลดล่วงหน้า) ห้ามตั้ง `Referrer-Policy` เข้มกว่าค่าปกติ (ตรวจ index.html และ server header)
- **ion**: `IonImageryProvider.fromAssetId(assetId, { accessToken })` ใช้ token จาก settings, ไม่ตั้ง `Ion.defaultAccessToken` ทั่วแอป
  รายการ asset ตั้งต้น (preset) ยืนยันจากเอกสาร Cesium ระหว่างลงมือ (อ่านเอกสารได้ ห้ามเรียก API ของ ion ในชุดทดสอบ):
  ภาพดาวเทียม (Bing Aerial หรือ Google Maps 2D Satellite), ภาพดาวเทียม + ชื่อ, แผนที่ถนน — และช่อง "Asset ID" ให้กรอกเองได้
  token ว่าง = ชั้น ion ปิดใช้พร้อมคำแนะนำ; ion ตอบ 401/404 → ข้อความไทยใน Message Viewer และถอดชั้นนั้น
- browser ดึงตรงจึงยกเว้นหลัก "browser คุยกับ server ในเครื่องเท่านั้น" **เฉพาะเมื่อผู้ใช้เปิดแหล่งนั้น** และกล่องยืนยันต้องบอกเรื่องนี้

### 4.2 ลำดับและการซ้อน

- ลำดับวาด: Natural Earth II (index 0) → GIBS ตามตาราง → EOX → OSM → เส้น Lat/Lon บนสุด
- ion แสดงอยู่ (ชั้น ion ชั้นเดียวในเวลาหนึ่ง เลือกแบบ radio) → ซ่อนทุกชั้นอื่นรวม Natural Earth II (alpha 0) ในทุก viewer; ปิด ion → คืนค่าเดิม
- Globe Manager แสดงสถานะ "ถูกซ่อนเพราะเปิด Cesium ion อยู่" ที่ชั้นอื่น

### 4.3 Globe Manager

แบ่งเป็นกลุ่มตามแหล่ง: NASA GIBS (เดิม), Sentinel-2 cloudless (EOX), OpenStreetMap, Cesium ion
แต่ละกลุ่มมีสวิตช์ + กล่องยืนยันของตัวเอง (ข้อความระบุโฮสต์: `tiles.maps.eox.at` ผ่าน server; `tile.openstreetmap.org` และ `api.cesium.com` + โฮสต์ภาพของ ion ดึงจาก browser โดยตรง พร้อม IP, User-Agent ของ browser และ Referer `http://127.0.0.1:<port>/`; ion ส่ง token ด้วย)
กลุ่ม ion มีช่อง token (แบบซ่อนตัวอักษร, บันทึกด้วย PUT ทั้งเอกสาร) และตัวเลือก asset แบบ radio + ช่อง Asset ID

### 4.4 ซูม

`ZOOM_STEPS` = 1, 2, 4, …, 8192 (14 ขั้น) ค่าใน workbook ที่ไม่อยู่ในรายการ = 1 HUD แสดงความกว้างพื้นที่โดยประมาณที่จุดใต้ดาว (km หรือ m)
เมื่อชั้นบนสุดที่แสดงมีระดับซูมสูงสุดต่ำกว่าที่ต้องใช้ HUD บอก "ภาพละเอียดสุดของแหล่งนี้แล้ว" (ภาพจะขยายจนเบลอ)

## 5. ความเสี่ยง

- ชื่อชั้น EOX, ระดับสูงสุด และ asset ID ของ ion ยังไม่ยืนยันกับของจริง → ขั้นยืนยันจริงหลังผู้ใช้อนุญาต แก้ในตารางเดียว
- Bing บน ion อาจถูกถอดแล้ว (ประกาศให้ใช้ถึง ก.ย. 2026) → preset ต้องมีทางเลือก Google 2D และช่อง Asset ID
- มุมกล้องแคบมาก (≈0.004°) จากระยะ 20,000 km: ต้องตรวจบนหน้าจริงว่าภาพไม่สั่น/ไม่เลือกระดับภาพผิด
- OSM บล็อกได้โดยไม่แจ้ง (policy) → ข้อความไทยเมื่อชิ้นภาพล้มเหลวต่อเนื่อง
