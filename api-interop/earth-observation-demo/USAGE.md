# Earth Observation Studio — วิธีเปิดและใช้งาน

แอปอยู่แยกใน `api-interop/earth-observation-demo/` ใช้รูปแบบ workspace ของ GNSS Studio: dockview, หน้าต่างภาพ/ลูกโลก/Properties, Timeline และคิวงาน ยกเลิกงานประมวลผลได้ โค้ด GNSS Studio เดิมไม่ได้ถูกแก้หรือ merge

เตรียมภาพจริงและ SICD geometry ครบ 146 ภาพแล้ว: สุวรรณภูมิ 49, รอตเตอร์ดัม 55 และสิงคโปร์ 42 ภาพ ผลรอบนี้อยู่ใน [research/processing-results.json](research/processing-results.json) พร้อม sequence ทดลองครบสามพื้นที่ และภาพคู่ใกล้มุมพื้นที่ละหนึ่งคู่

## เปิดแอป

```bash
cd /Users/phuwish/SSSGMAT/api-interop/earth-observation-demo
./run.sh
```

เปิด `http://127.0.0.1:8018` สคริปต์ติดตั้ง dependencies และ build หากยังไม่มี แอปใช้เครื่องในเครื่องและฟังเฉพาะ loopback พอร์ต 8018 แยกจาก server GNSS เดิม

## ใช้งาน

หน้าหลักเป็นหน้าเลื่อนขึ้นลงตามปกติ: ภาพขนาดใหญ่อยู่ด้านบน ส่วน Timeline, ลูกโลก, รายละเอียด และผลวิเคราะห์อยู่ด้านล่าง เลือก acquisition จากช่องเหนือภาพได้โดยตรง ปุ่ม Docked layout ใช้สลับกลับไปจัดหน้าต่างแบบโปรแกรมเดิมได้ และ Fullscreen image ยังใช้ดูภาพเต็มจอได้

1. เลือก Suvarnabhumi, Rotterdam หรือ Singapore แล้วเลือก acquisition ทางซ้าย ภาพที่เตรียมแล้วมีเครื่องหมายสีเขียว
2. Full Scene แสดงภาพ SAR จริงที่สร้างจาก overview ใน GEC; Native ROI แสดงบริเวณเล็กในกริด UTM
3. ดับเบิลคลิก Full Scene เพื่อตั้งพิกัด ROI แล้วกด Apply ROI เลือกความกว้าง 100/250/500/1,000 เมตรได้
4. 3D Geometry View แสดง trajectory ช่วง collect จาก SICD ARPPoly เท่านั้น เลื่อน Collect position ใน Properties เพื่อดูมุมเปลี่ยนไป
5. Find candidates เรียก baseline จุดสว่างแบบ local contrast ดูวงบน Native ROI เลือกจุด กำหนด car/truck/vessel/other และ Accept/Reject แล้ว Export candidates
6. Compare เลือกภาพอ้างอิงของพื้นที่เดียวกันแล้ว Prepare & compare ระบบใช้ ROI เดียวกันและรายงานว่ามุมใกล้กันหรือไม่ มี swipe และภาพผลต่าง
7. Sequence สร้าง 8 เฟรมจาก SICD พร้อม GIF/MP4 เป็น **experimental aspect sequence** ไม่มีเวลาแต่ละเฟรมหรือความเร็วรถที่ผ่านการตรวจรับรอง
8. 3-site overview แสดงภาพทั้งสามพื้นที่ จำนวนภาพที่เตรียม ข้อมูลเรขาคณิต และ log ของผลทดลอง
9. Timeline เลื่อนไปตามวันถ่าย มี Play/Previous/Next การเล่นคือการเปลี่ยน acquisition ไม่ใช่วิดีโอต่อเนื่องระหว่างวัน

บน macOS ระบบเริ่ม worker ด้วย `posix_spawn` ใน session ใหม่ เพื่อไม่เรียก at-fork handlers ของ PROJ/SQLite จากเซิร์ฟเวอร์ที่มีหลาย thread การยกเลิกงานยังส่งสัญญาณถึง process group ของ worker รวมโปรแกรมลูก เช่น ffmpeg

Message Viewer / Jobs แสดงความคืบหน้าและยกเลิก worker ที่รันอยู่ได้ หน้าต่างที่ปิดเปิดใหม่ได้จากเมนู Window ผลเดิมอยู่ใน `data/scenes/<scene-id>/` ภาพใหญ่ต้นฉบับยังอยู่บน Umbra S3 จึงต้องต่ออินเทอร์เน็ตเมื่อเตรียม acquisition/ROI ใหม่

## ดึงข้อมูลย้อนหลังทันที

### รูปแบบภาพสี

ช่อง **Image style** เหนือภาพเลือกได้ 5 แบบ: Grayscale, Viridis, Inferno, CSI Radar RGB และ Sentinel-2 Natural color ทั้ง Full Scene และ Native ROI ใช้ตัวเลือกเดียวกัน ลูกโลก 3D เปลี่ยนชั้นภาพตามตัวเลือกด้วย

- Viridis/Inferno เป็นสีตามค่าความสว่างที่ปรับแสดงผล มีแถบสี 0–255 และดาวน์โหลด PNG ได้ ไม่เปลี่ยนข้อมูลที่ใช้ตรวจจับ
- CSI อ่าน RGB ของ Umbra โดยตรง มีเฉพาะ 11 acquisition ที่ตรวจพบไฟล์สาธารณะ เมื่อเลือกภาพที่ไม่มี CSI จะมีช่องให้เลือก acquisition ที่มีในพื้นที่เดียวกัน การโหลดครั้งแรกประมาณ 1–2.5 GB เพราะต้นทางไม่มี overviews; ระบบดาวน์โหลดแบบต่อจากไฟล์บางส่วนได้และสร้าง BigTIFF พร้อม overviews เก็บไว้ใน `data/raw-csi/` จึงเปิดครั้งต่อไปได้เร็ว สี CSI มาจากช่วงรับสัญญาณย่อยและไม่ใช่สีธรรมชาติหรือหลักฐานยืนยันการเคลื่อนไหว
- Sentinel-2 อ่านภาพ RGB จริงจาก public COG ผ่าน Earth Search ค้นในช่วง ±45 วันของ SAR ตรวจเมฆ/เงาเฉพาะบริเวณ และแสดงวันถ่ายจริง ระยะห่างจาก SAR ความละเอียดต้นทาง 10 เมตร และ attribution เสมอ เมื่อไม่มีภาพใสในช่วงที่ค้นจะแสดงภาพที่บดบังน้อยที่สุดในกลุ่มที่ตรวจพร้อมค่าเมฆ/เงา
- การขยาย Sentinel-2 ลงกริด ROI เดียวกับ SAR ช่วยจัดตำแหน่ง ไม่เพิ่มรายละเอียดจาก 10 เมตรเป็น 25 ซม. วงตรวจจับ SAR ไม่ซ้อนบน CSI/Sentinel-2 โดยอัตโนมัติ และวงโคจรใน 3D ยังคงเป็นช่วง collect ของ Umbra ที่เลือก
- เปลี่ยน ROI แล้วผลิตภัณฑ์สีจะหมดอายุด้วย ROI signature และเตรียมใหม่ ปุ่ม Download displayed PNG ดาวน์โหลดภาพในสีที่เลือกจริง

ตัวเลือกสีใช้กับ Full Scene/Native ROI ส่วน Compare ยังเทียบ GEC intensity และ Sequence ยังคงแสดงผลทดลอง SICD ของมันเอง

เตรียมตัวอย่าง CSI และ Sentinel-2 พร้อมใช้แล้วอย่างละหนึ่ง acquisition ต่อพื้นที่ รวม 3 พื้นที่ ตรวจผ่าน job worker จริง 6 งานและ PNG 12 ไฟล์ ผลตรวจ แหล่งข้อมูล วันที่ถ่าย และ SHA-256 อยู่ใน [research/color-validation.json](research/color-validation.json) acquisition อื่นจะเตรียมเมื่อเลือกใช้ในหน้าแอป

```bash
# ตัวอย่าง 4 ภาพต่อพื้นที่ เลือกภาพต้น/ปลายช่วงและคู่ใกล้มุม
.venv/bin/python bootstrap.py --per-site 4 --workers 2

# ทั้ง 146 ภาพในแคตตาล็อก ไม่ต้องรอวันถ่ายใหม่
.venv/bin/python bootstrap.py --all --workers 3
```

งานนี้ดึง overview, ROI 250 เมตร และ SICD metadata พร้อม baseline แล้วเก็บในเครื่อง ไม่ดาวน์โหลด GEC/SICD ทั้งฉากหรือ CPHD หลายสิบ GB ชุดเดิมที่เตรียมแล้วใช้ cache ผลรอบล่าสุดอยู่ใน `data/bootstrap-results.json` ถ้าขัดจังหวะเรียกคำสั่งเดิมต่อได้

ตรวจจับซ้ำด้วย input hash/พารามิเตอร์เดิมจะใช้ผลเดิม รวมผลที่ตรวจด้วยมือ การเปลี่ยน ROI หรือประมวลผลใหม่จะเก็บผลิตภัณฑ์ก่อนหน้าไว้ใน `data/scenes/<id>/history/`

## กรอกพิกัดและดูแนวเล็งจากดาวเทียม

เปิด `http://127.0.0.1:8018/?view=geometry` หรือกด **Satellite → Ground** เพื่อดูกราฟิกเต็มความกว้าง กรอก Latitude / Longitude แล้วกด **แสดงพิกัด** หรือกด **เลือกจุดบนโลก** แล้วคลิกบนแผนที่ ระบบวางหมุด แสดง Azimuth / Elevation / Slant range ถึงพิกัดที่เลือก และแผนภาพแนวเล็งทันที การกำหนดจุดนี้ไม่ดาวน์โหลดหรือตัดภาพใหม่

ในหน้า 2D ดับเบิลคลิกบน Full Scene เพื่อเลือกพิกัด แล้วกด **ดูแนวเล็ง 3D** ได้ จุดสีทองในภาพคือจุดเดียวกับหมุดที่เลือก การกด **Apply ROI** เป็นอีกการทำงานหนึ่งสำหรับเตรียมภาพ ROI ใหม่

ปุ่ม **ดาวเทียม → พื้น**, **ดูจุดบนพื้น**, **ดูดาวเทียม** เปลี่ยนมุมกล้อง เลื่อน **Viewing collect time** หรือกด **เล่นช่วงถ่าย** เพื่อเคลื่อนตำแหน่งตามตัวอย่าง SICD ในช่วง collect ภาพพื้นหลังไม่ถูกโหลดใหม่ทุกครั้งที่เลื่อนเวลา

กราฟิกสีฟ้าเชื่อมตำแหน่งดาวเทียม ณ เวลาที่เลือกกับมุม footprint ของ **ภาพรวมทั้ง acquisition** เป็นภาพประกอบเรขาคณิต ไม่ใช่ขอบเขตลำแสงเสาอากาศหรือ instantaneous SAR field of view ที่ได้รับการสอบเทียบ เส้นประลงพื้นคือแนวดิ่งไปจุดใต้ดาวเทียม จุดที่เลือกใช้ผิวทรงรี WGS84 สูง 0 เมตร โดยไม่มี DEM แสดงสีส้มเมื่อจุดอยู่นอก footprint และไม่วาดเส้นถึงจุดที่มี elevation ไม่เกิน 0° เพื่อไม่แสดงเส้นผ่านโลก

กราฟิกดาวเทียมนี้อาศัย ephemeris ของ Umbra SAR ภาพสี Sentinel-2 อาจคนละวัน ส่วนหน้า Free high-res samples ยังระบุว่าไม่มีพิกัดดาวเทียมครบตามผลตรวจ metadata

## ตำแหน่งดาวเทียมขณะถ่าย

ใน workspace Umbra SAR เปิด **Acquisition Properties** จะเห็น Satellite time (UTC), Satellite latitude/longitude, Height above WGS84 และ Satellite ECEF (m) เลื่อน **Collect time** เพื่อเลือกหนึ่งใน 65 จุดระหว่างช่วงรับสัญญาณ ดูตำแหน่งเดียวกันบน 3D Geometry View และดาวน์โหลด Geometry JSON ได้ ค่านี้มาจากแบบจำลอง trajectory ของผู้ผลิตใน SICD `Position.ARPPoly` ไม่ใช่ตำแหน่งปัจจุบันหรือ ground truth อิสระ ความสูงเป็นความสูงเหนือทรงรี WGS84

หน้า Free high-res samples แสดงสถานะของแต่ละภาพแยกกัน ข้อมูลสาธารณะที่ตรวจครั้งนี้มีเพียงมุมถ่ายของ WorldView-3 ลาสเวกัส / กรุงเทพฯ และ GeoEye-1 มัณฑะเลย์ ส่วน optical รอตเตอร์ดัมไม่พบ ephemeris จึงไม่สร้างละติจูด/ลองจิจูด/ความสูงของดาวเทียมจากความสูงวงโคจรทั่วไปหรือจาก TLE ปัจจุบัน พิกัดที่แสดงเป็น **พิกัดจุดบนพื้นดินในภาพ** พร้อมระบุชัดเจน หลักฐานมุมอยู่ใน `research/highres-viewing-geometry.json` และ XML/STAC ต้นทาง

## ภาพสีละเอียดสูงจากดาวเทียมอื่น

เปิด `http://127.0.0.1:8018/?view=samples` หรือกด **Free high-res samples** จะเห็นตัวอย่างพร้อมเปิด 4 แห่ง: WorldView-3 ลาสเวกัส 30 ซม., WorldView-2 รอตเตอร์ดัม 50 ซม., WorldView-3 กรุงเทพฯ 38 ซม. และ GeoEye-1 สนามบินมัณฑะเลย์ 46 ซม. เลือกพื้นที่กว้าง 500/250/100 เมตร ซูม/เลื่อนภาพ เปิดเต็มจอ และดาวน์โหลด PNG พร้อม Source / licence JSON ได้

ความละเอียด GSD ของภาพสีเหล่านี้มีขนาดพิกเซลเล็กกว่า Sentinel-2 10 เมตรประมาณ 20–33 เท่าต่อด้าน แต่เป็นชุดตัวอย่างเฉพาะพื้นที่และวันถ่าย ข้อมูลรอตเตอร์ดัมอยู่คนละบริเวณกับ Botlek ROI หลัก และกรุงเทพฯ เป็นย่านบางซื่อ ไม่ใช่ภาพสีของสุวรรณภูมิในวันเดียวกับ SAR

ภาพ SpaceNet ใช้ CC BY-SA 4.0 ส่วน Maxar Open Data ใช้ CC BY-NC 4.0 สำหรับการใช้งานไม่ใช่เชิงพาณิชย์ แหล่งที่มา วันที่ GSD และเงื่อนไขแสดงพร้อมภาพทุกตัวอย่าง ดูหลักฐานและรายละเอียดกริดของต้นทางใน [research/HIGH_RES_SOURCES.md](research/HIGH_RES_SOURCES.md)

```bash
.venv/bin/python bootstrap_highres.py
# เตรียมเฉพาะตัวอย่างเดียว
.venv/bin/python bootstrap_highres.py --sample rotterdam-wv2
```

## ข้อจำกัดที่ต้องใช้ตีความผล

- GEC ที่ทดลองเป็น display intensity 8 บิต ไม่ใช้ชื่อ sigma0 หรือ physical dB กับค่านี้
- Candidate เป็นจุดสว่างที่ต้องตรวจ ไม่ใช่จำนวนรถ/เรือทั้งหมด ยังไม่มี semantic road/water masks หรือโมเดล YOLO ที่ฝึกและวัด precision/recall แล้ว
- ความละเอียดกริด ROI ไม่ใช่หลักฐานว่าทุกวัตถุขนาดเท่ากันจะถูกตรวจได้
- Compare ประเมิน translation ด้วย phase correlation ยังไม่ได้ตรวจ residual กับจุดอิสระและยังไม่รับรองความแม่น 1 เมตร
- Sequence ใช้ narrow range strip รอบจุดศูนย์กลาง SICD พร้อม full cross-range support และ deskew ไม่ใช่ ROI ที่เลือกใน GEC ระบุ spectral support ต่อเฟรมใน JSON ไม่มีการแต่ง timestamp หรือความเร็วขึ้นมา
- ตำแหน่งดาวมาจากแบบจำลอง trajectory ของผู้ผลิต ไม่ใช่ ground truth อิสระ ไม่มีการต่อเส้นวงโคจรนอกช่วง collect
- CPHD back-projection, calibration เชิงปริมาณ, training/held-out evaluation และความเร็วที่ยืนยันด้วยข้อมูลอ้างอิงยังเป็นงานวิจัยต่อเนื่องตามแผน

## ทดสอบและพัฒนา

```bash
.venv/bin/python -m pytest -q
cd web
npm test
npm run typecheck
npm run build
# สำหรับ dev: เปิด backend พอร์ต 8018 อีกหน้าต่าง แล้วใช้ npm run dev
```

API documentation: `http://127.0.0.1:8018/docs` ผลลัพธ์ทั้งหมดใช้ UTC ภายใน และแสดงเวลาท้องถิ่นด้วย timezone ของพื้นที่ รวม DST ของเนเธอร์แลนด์

โน้ตบุ๊กสำหรับรันซ้ำอยู่ใน `notebooks/` สองไฟล์ ใช้ source directory เดียวกันและตั้ง `EO_DEMO_ROOT` ให้ชี้มาที่โปรเจกต์ เมื่อต้องการรันใน Colab ให้วาง source บน Drive และติดตั้ง requirements ใน runtime ก่อน ส่วน IPython มีมากับ Colab แล้ว

## แหล่งที่มา

ข้อมูลภาพ/metadata: [Umbra Open Data](https://umbra.space/open-data/), CC BY 4.0; URLs และผลตรวจอยู่ใน `research/` ส่วน workspace อิงโครงของ `.worktrees/gnss-studio-imagery/api-interop/gnss-predict/web/` และใช้ไลบรารี React/dockview/Cesium รุ่นเดียวกัน โมดูล EO ใช้ entry point และ data root ของตัวเอง
