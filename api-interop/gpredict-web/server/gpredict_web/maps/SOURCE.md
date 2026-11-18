# ภาพแผนที่ของ Gpredict (15 ภาพ)

ภาพทั้ง 15 ในโฟลเดอร์นี้คือภาพพื้นหลัง Map View ที่มากับ Gpredict 2.7 คัดลอกแบบไบต์ต่อไบต์ (ตรวจด้วย `cmp`) ไม่ได้แปลงหรือย่อ
รายชื่อและลำดับตรงกับ `STOCK_MAPS` ใน `server/gpredict_web/maps.py` (ref-D §11)

## ที่มา

- repo: <https://github.com/csete/gpredict> (clone ในเครื่อง, tag "Version 2.7")
- commit: `2259378` (`22593781b5fc922aa7064c8665d40ef8b3f98ddb`, "Version 2.7")
- โฟลเดอร์ต้นทาง: `pixmaps/maps/`
- วันที่คัดลอก: 2026-11-14 (ผู้ใช้อนุมัติการคัดลอกแล้วเมื่อ 2026-11-12, spec งานย่อย 4 §1.2)

ไฟล์: `earth_800.png`, `nasa-bmng-01_1024.jpg`, `nasa-bmng-01_2048.jpg`, `nasa-bmng-03_1024.jpg`, `nasa-bmng-03_2048.jpg`,
`nasa-bmng-05_1024.jpg`, `nasa-bmng-05_2048.jpg`, `nasa-bmng-07_1024.jpg`, `nasa-bmng-07_2048.jpg`, `nasa-bmng-08_1024.jpg`,
`nasa-bmng-08_2048.jpg`, `nasa-topo_800.png`, `nasa-topo_1024.jpg`, `nasa-topo_1600.jpg`, `nasa-topo_2048.jpg`

## สถานะลิขสิทธิ์ตามที่ clone ระบุ

ตรวจแล้วใน clone ที่ commit ข้างต้น:

- `pixmaps/maps/` มีแค่ภาพ, `Makefile.am` และ `.gitignore` ไม่มี README, COPYING หรือไฟล์ license ของภาพ
  และ `pixmaps/` ก็ไม่มีไฟล์ license แยกต่างหาก
- `COPYING` ที่ราก repo คือ GPL v2 ของโปรแกรม (ซอร์สโค้ด) ไม่ได้ระบุว่าครอบคลุมภาพพวกนี้
- `AUTHORS` (หัวข้อ "Imagery:") และหน้า About ของโปรแกรม (`src/about.c`) เขียนว่า
  "Most of the maps originate from NASA Visible Earth, see website http://visibleearth.nasa.gov/"
- `NEWS` (หัวข้อ "Changes in version 1.1 (5 Oct 2009)") เขียนว่า "Include more maps from NASA Visible Earth: Blue Marble Next Generation."
  ซึ่งตรงกับชุด `nasa-bmng-*`

สรุปเท่าที่ clone พิสูจน์ได้: Gpredict บอกแค่ว่า **ภาพส่วนใหญ่** มาจาก NASA Visible Earth และไม่ได้ระบุว่าภาพไหนไม่ใช่
ไม่มีข้อความ license รายภาพ `earth_800.png` มี PNG comment "Created with The GIMP" และ `nasa-topo_800.png` ไม่มี metadata
ที่มาของสองภาพนี้จึงไม่มีหลักฐานใน clone

ข้อมูลทั่วไปของ NASA (ไม่ได้มาจาก clone, ยังไม่ได้ตรวจกับหน้าเงื่อนไขของ NASA ฉบับปัจจุบัน): เนื้อหาของ NASA โดยทั่วไป
ไม่มีลิขสิทธิ์ใช้ซ้ำได้โดยให้เครดิต จึงใช้ภาพชุด `nasa-bmng-*` และ `nasa-topo_*` ที่มาจาก NASA ได้ตามนั้น
แต่ข้อความของ Gpredict เองไม่ได้รับรองว่าครบทุกภาพ

## ข้อควรระวัง

- ไม่ใช่ `locations.dat` (GPL) ของ Gpredict และไม่ได้คัดลอกไฟล์ข้อมูลอื่นนอกจาก 15 ภาพนี้
- ภาพที่ผู้ใช้อัปโหลดไม่อยู่ที่นี่ เก็บที่ `data/maps/` และไม่ผ่าน git
