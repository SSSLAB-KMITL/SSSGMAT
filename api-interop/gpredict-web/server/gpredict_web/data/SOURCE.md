# รายชื่อเมืองและสถานีอากาศ (`locations.json`)

`locations.json` คือรายการที่ปุ่ม Select ของ Location และ Weather St ในหน้า Edit ground station data อ่านผ่าน `GET /api/locations`
สร้างจากไฟล์สถานีของ NOAA ไม่ใช่จาก `locations.dat` ของ Gpredict (ส่วนหนึ่งของ repo GPL จึงไม่ใช้ ดู spec งานย่อย 4 §1.2 และ §4.3)
รายการจึงต่างจากของ Gpredict (คนละแหล่ง)

## ที่มา

- URL: <https://tgftp.nws.noaa.gov/data/nsd_cccc.txt> (ข้อมูลรัฐบาลสหรัฐ public domain ตามที่ spec งานย่อย 4 §1.2 ระบุ)
- ดาวน์โหลดครั้งเดียวตอนพัฒนาด้วย `curl -fsS -A gpredict-web` (User-Agent `gpredict-web` ไม่มีข้อมูลระบุตัวตนอื่น) ผู้ใช้อนุมัติแล้วเมื่อ 2026-11-12
- วันที่ดาวน์โหลด: 2026-11-14T12:05:40Z (UTC) คือเวลาแก้ไขของไฟล์ที่ curl เขียนเสร็จ และเป็นค่า `"downloaded"` ใน `locations.json`
- ไฟล์ที่ดาวน์โหลด: 522692 ไบต์, 6702 บรรทัด (CRLF ปนกับ LF), sha256 `7ecaec58ab59ec6943a50aec1096783e6a7908da3803d96ead39cb0a0a29a8c5`
- ไฟล์ดิบไม่ได้อยู่ใน repo (อยู่ในโฟลเดอร์ชั่วคราวของ session เท่านั้น) repo เก็บเฉพาะ `locations.json` ที่สร้างแล้ว
  และ fixture 10 บรรทัดจริงสำหรับ test ที่ `server/tests/fixtures/nsd_cccc_sample.txt` (test ไม่ใช้เน็ต)

## ผลที่ได้

- `locations.json` = `{"source", "downloaded", "locations"}` 578041 ไบต์
- `locations`: 6682 แถวแบบ `[continent, country, city, lat, lon, alt_m, icao]` เรียงตาม continent, country, city (ไม่แยกตัวพิมพ์ใหญ่เล็ก)
  - lat/lon เป็นองศาทศนิยม (ใต้และตะวันตกเป็นลบ) ปัดเป็นทศนิยม 6 ตำแหน่ง, alt_m เป็นจำนวนเต็มเมตร (ช่องว่าง = 0)
  - ทวีปจากช่อง WMO Region: 1 Africa, 2 Asia, 3 South America, 4 North and Central America, 5 South-West Pacific, 6 Europe, 7 Antarctica
  - จำนวนต่อทวีป: North and Central America 3490, Europe 1137, Africa 670, Asia 657, South America 394, South-West Pacific 331, Antarctica 3
  - ข้อความ Location ที่หน้าเว็บใส่ให้ผู้ใช้คือ `<Place Name>, <Country Name>` และ Weather St คือ ICAO
- ช่องที่ใช้ของ NOAA (เริ่มนับจาก 0): 0 ICAO, 3 Place Name, 5 Country Name, 6 WMO Region, 7 Station Latitude, 8 Station Longitude,
  11 Station Elevation (ไม่ใช่ช่อง 12 Upper Air Elevation) เช่น VTCC Chiang Mai = ความสูง 312 ม.

## บรรทัดที่ข้าม (20 จาก 6702)

ข้อมูลของ NOAA มีบรรทัดที่ผิดรูปแบบ สคริปต์ข้ามแทนการเดาความหมาย:

- พิกัดอ่านไม่ได้ (17 บรรทัด): ลิปดาหรือพิลิปดาเกิน 59 (เช่น `44-60N`, `29-95N`, `40-26-94N`), ไม่มีตัวอักษรทิศ, หรือตัวอักษรทิศผิดแกน
  K21D, K3MW, KBJN, KBKB, KBPT, KCSM, KELZ, KFHU, KNGW, KNOG, KNQI, KOBE, KPDT, KQHA, KWTR, PAOR, PGNT
- ไม่มีชื่อประเทศหรือทวีป (2 บรรทัด): KBAN (ไม่มีทั้งประเทศและ WMO Region), KGSN (ไม่มี WMO Region และไม่มีสถานีอื่นของประเทศเดียวกันให้อ้างอิง)
- KSTZ: ขาดช่อง State ทำให้ช่องหลังจากนั้นเลื่อน ช่อง Station Longitude ว่าง
- บรรทัดที่ช่อง WMO Region ว่างแต่มีประเทศ (เช่น EDHK Kiel, CWKH ของแคนาดา) ใช้ทวีปที่พบมากที่สุดของประเทศเดียวกัน
- K96D ตัวเลขความสูงเลื่อนไปอยู่ช่อง Upper Air จึงได้ความสูง 0

## สร้างใหม่

`$SCRATCH` = โฟลเดอร์ชั่วคราวของ session (ไฟล์ดิบเป็นข้อมูลภายนอกที่ไม่เชื่อถือ: ใส่ในโฟลเดอร์ใหม่ที่ว่าง ไม่รันอะไรจากโฟลเดอร์นั้น
และรันสคริปต์ด้วย `-I` โดยส่ง path เป็นอาร์กิวเมนต์) การดาวน์โหลดใหม่ต้องได้รับความยินยอมจากผู้ใช้ก่อน

```bash
mkdir -p "$SCRATCH/nsd" && curl -fsS -A gpredict-web -o "$SCRATCH/nsd/nsd_cccc.txt" https://tgftp.nws.noaa.gov/data/nsd_cccc.txt
cd api-interop/gpredict-web && .venv/bin/python -I tools/build_locations.py "$SCRATCH/nsd/nsd_cccc.txt" server/gpredict_web/data/locations.json
```

สคริปต์พิมพ์จำนวนแถว ขนาดและ sha256 ของไฟล์ดิบ และวันที่ดาวน์โหลด (ตั้งต้นจากเวลาแก้ไขของไฟล์ ส่งค่าเองด้วย `--downloaded 2026-11-14T12:05:40Z`)
ไฟล์ที่ใช้สร้างข้อมูลชุดนี้อยู่ที่ `$SCRATCH/noaa/nsd_cccc.txt`
