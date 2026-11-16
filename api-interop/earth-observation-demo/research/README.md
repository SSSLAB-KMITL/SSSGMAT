# วิธีอ่านผลสำรวจแคตตาล็อก

วันที่ตรวจ: 15 พฤศจิกายน 2569 ตามเวลาไทย

- `catalog-scenes.csv`: 146 แถว หนึ่งแถวต่อ STAC/collect ที่พบใน site prefix มีเวลา geometry เดิม และ URL ผลิตภัณฑ์ที่จับคู่จาก public listing
- `footprints.geojson`: 146 polygons จาก STAC แปลงพิกัดเป็น lon/lat สองมิติสำหรับเปิดใน GIS เป็นขอบภาพ ยังไม่ใช่ ROI ที่เลือกวิเคราะห์
- `catalog-summary.json`: จำนวนภาพ ช่วงเวลา ขนาดไฟล์ และข้อจำกัดของการสำรวจ
- `public-asset-head-checks.json`: ผล HTTP HEAD จำนวน 9 ไฟล์ รวม 3 ชนิดผลิตภัณฑ์ต่อพื้นที่ ไม่ได้อ่าน raster/signal

ขั้นตอนที่ใช้:

1. เรียก anonymous S3 ListObjectsV2 ที่ `https://umbra-open-data-catalog.s3.us-west-2.amazonaws.com/` ด้วย `list-type=2`, `prefix` ตามแต่ละพื้นที่ และ `max-keys=1000`; อ่าน continuation token จนหมด
2. เก็บ key/size ทุก object ของ prefix เลือก `.stac.v2.json` และอ่าน JSON สาธารณะทั้งหมด 49/55/42 รายการ
3. อ่าน id, collect id, platform, datetime, start/end, geometry, polarization และ resolution จาก JSON โดยไม่เดาค่าจากชื่อไฟล์
4. จับคู่ผลิตภัณฑ์ใน directory เดียวกันจาก suffix `_GEC.tif`, `_SICD.nitf`, `_CPHD.cphd`, `_CSI.tif` แล้วสร้าง public URL จาก key ที่พบจริง ไม่แปลง `prod-prod-*` href แบบแทนชื่อ bucket
5. ตรวจจำนวน unique collects และจำนวน polygon ให้ตรง CSV รวม 146 รายการ แล้วตรวจ HEAD ตัวอย่างผลิตภัณฑ์ชนิดละหนึ่งไฟล์ต่อพื้นที่

ช่อง asset ที่ว่างแปลว่า “ไม่พบชื่อไฟล์ที่ตรงชนิดใน directory นี้ ณ วันที่ตรวจ” ไม่ได้ยืนยันว่าไม่มีผลิตภัณฑ์นี้ในทุก prefix หรือทุกผู้ให้ข้อมูล จำนวนภาพเก่าที่ไม่มี STAC ไม่รวมใน CSV

`view_azimuth_deg_raw` ยังไม่ได้แปลงนิยามเป็นทิศจาก ROI ไปหาดาว ส่วน `azimuth_resolution_m`/`range_resolution_m` เป็นค่าของ STAC ไม่ใช่ pixel size จาก raster การใช้วิเคราะห์ต้องอ่าน metadata เชิงลึกเพิ่ม

เปิด CSV แบบ UTF-8 และ GeoJSON แบบ EPSG:4326 ได้โดยตรง ไม่จำเป็นต้องดาวน์โหลดไฟล์ภาพใหญ่ตามทุก URL เพื่อดูผลสำรวจ
