# Gpredict Web งานย่อยที่ 4: Data & Preferences

- วันที่: 2026-11-12
- Branch: `feature/gpredict-web-data` แตกจากปลายของ `feature/gpredict-web-radio`
- สถานะ: รอผู้ใช้ตรวจ spec
- เอกสารที่เกี่ยวข้อง
  - [core spec](2026-11-11-gpredict-web-core-design.md) ("core")
  - [spec งานย่อยที่ 2](2026-11-12-gpredict-web-passes-design.md) ("passes")
  - [spec งานย่อยที่ 3](2026-11-12-gpredict-web-radio-design.md) ("radio")
  - [รายการอ้างอิงหลัก](2026-11-11-gpredict-reference.md) ("ref")
  - [รายการอ้างอิงส่วน Data & Preferences](2026-11-12-gpredict-reference-data.md) ("ref-D")

## 1. ขอบเขต

### 1.1 ทำ

| สิ่งที่ทำ | หัวข้อ |
|---|---|
| Preferences → General: Number Formats, Ground Stations, TLE Update, Message Logs | 3, 4, 5, 6 |
| รูปแบบเวลา, N/S/E/W และหน่วย Imperial มีผลกับทุกที่ที่ Gpredict ใช้ (ref-D §2.1) | 3 |
| TLE sources ที่แก้ได้ (AMSAT + CelesTrak), proxy, ตรวจอายุ TLE อัตโนมัติ | 5 |
| Edit → Update TLE data from local files | 5.4 |
| File → Log browser และ log ของ server ในรูปแบบของ Gpredict | 6 |
| Satellite Info (แท็บ Orbit Info และ Transponders) | 7 |
| Detach module / Attach module, Full screen / Exit full screen, จำตำแหน่งหน้าต่างและสถานะ | 8 |
| Preferences → Modules: ค่ารวมของทุก module และการสืบทอดค่าแบบ Gpredict | 9 |
| สีของ Map และ Polar, เลือกภาพแผนที่, Window Placements (core แสดงไว้แต่กดไม่ได้) | 9.4, 10 |
| ปุ่ม Select ของ Location และ Weather St ใน Edit ground station data | 4.3 |

หลังงานนี้ไม่มีรายการไหนของ Gpredict ที่กดไม่ได้ เหลือเฉพาะข้อจำกัดของ browser ในหัวข้อ 11

### 1.2 ข้อมูลภายนอกที่ต้องให้ผู้ใช้อนุมัติ

| ข้อมูล | ที่มา | เหตุผล |
|---|---|---|
| TLE source ของ AMSAT `https://www.amsat.org/amsat/ftp/keps/current/nasabare.txt` | รายการตั้งต้นของ Gpredict (core §7.2 ระบุว่าอยู่ในงานนี้) | ดึงเมื่อกด Update TLE หรือเมื่อตรวจอายุอัตโนมัติ ไม่เกิน 1 ครั้งต่อ 2 ชม. ต่อ URL |
| ภาพแผนที่ 15 ภาพของ Gpredict (`pixmaps/maps`, ภาพ NASA Blue Marble NG และ NASA topo ซึ่งเป็น public domain) | คัดลอกจาก clone ของ Gpredict ในเครื่อง | ให้ "Select Map" มีรายการเดียวกับ Gpredict ภาพตั้งต้นกลายเป็น `nasa-bmng-07_1024.jpg` ตาม Gpredict |
| รายชื่อเมืองและสถานีอากาศ | สร้างจาก `nsd_cccc.txt` ของ NOAA (ข้อมูลรัฐบาลสหรัฐ public domain) ดาวน์โหลดครั้งเดียวตอนพัฒนา | ไม่ใช้ `locations.dat` ของ Gpredict เพราะเป็นส่วนหนึ่งของ repo GPL |

## 2. หลักการ

เหมือน passes §2 คือทำตามพฤติกรรมของ Gpredict ใน ref-D แก้ข้อบกพร่องที่ทำให้ข้อมูลหายหรือแสดงผิด บันทึกทุกข้อในหัวข้อ 11
ส่วนที่ browser ทำไม่ได้ เขียนทางแทนไว้ในหัวข้อนั้น

## 3. Number Formats

### 3.1 หน้า (ref-D §2)

- **ตัวควบคุม**
  - "Show local time instead of UTC."
  - "Time format:" ช่องกรอก (ไม่เกิน 50 ตัวอักษร) + ตัวอย่างที่อัปเดตทุก 1 วินาที + ปุ่ม "Reset"
  - "Use N/S/E/W for geographical coordinates."
  - "Use Imperial units instead of Metric."
- **tooltip**: ตาม ref-D ทุกตัวอักษร
- **Key**: `GLOBAL/USE_LOCAL_TIME`, `GLOBAL/TIME_FORMAT` (ตั้งต้น `%Y/%m/%d %H:%M:%S`), `GLOBAL/USE_NSEW`, `GLOBAL/USE_IMPERIAL`

### 3.2 การนำไปใช้

- **ที่จัดรูปแบบ**: web จัดรูปแบบทุกค่าเอง server ส่งเวลาเป็น UTC และระยะเป็น km เหมือนเดิม
- **ค่าที่ web ใช้**: อ่านค่าจาก `/api/prefs` ตอนเปิดหน้า และอัปเดตทันทีเมื่อ Preferences ถูกบันทึก (ผ่าน `/ws/app` หัวข้อ 12)
- **รายการที่ได้รับผล**: ตามตาราง ref-D §2.1 ครบทุกแถว
  - นาฬิกาหัว module
  - List (Next Event, Next AOS, Next LOS, Lat, Lon, Range, Rate, Footp, Alt, Vel)
  - Single sat (มีหน่วย `mi` และ `mi/sec`)
  - Pass details และ Upcoming passes
  - ข้อความที่บันทึกและพิมพ์ (คำว่า "Local"/"UTC")
  - ป้ายเวลาของ Az/El plot, Polar plot และ Sky at a glance
  - ช่องและปฏิทินของ Time Controller
  - Map grid
  - Satellite Info "Epoch time:"
  - ตาราง Ground Stations
  - Radio Control (`mi`, `mi/s`)
- **ที่ไม่ได้รับผล**: ตาม ref-D เช่น ข้อความเมาส์บน Map, เลขในไฟล์ที่บันทึก (เป็น km เสมอ) และ log
- **รูปแบบเวลา**: `formatTime` ของ web รองรับรหัสของ C `strftime`
  - วันที่และเวลา: `%a %A %b %B %c %C %d %D %e %F %H %I %j %k %l %m %M %n %p %r %R %S %t %T`
  - สัปดาห์และปี: `%u %U %V %w %W %g %G %y %Y`
  - อื่นๆ: `%x %X %z %Z %%` ใช้ชื่อวันและเดือนภาษาอังกฤษแบบ locale C
  - ผลตัดที่ 49 ตัวอักษรเหมือน Gpredict
- **"Local time"**: เวลาตาม time zone ของเครื่องที่เปิด browser เหมือน Gpredict ที่ใช้เวลาของระบบปฏิบัติการ
- **Imperial**: ติ๊กแล้วตาราง Ground Stations ในกล่องที่เปิดอยู่เปลี่ยนหน่วยทันที
  ส่วน view อื่นเปลี่ยนหลังกด OK (Gpredict เขียนค่าทันที ซึ่ง ref-D บอกว่ายังไม่ยืนยันผลที่ view)

## 4. Ground Stations

### 4.1 หน้า (ref-D §3, ref §10)

- **ตาราง**: Name, Location, Lat, Lon (`%.4f°` + ตัวอักษรทิศหรือช่องว่าง), "Alt\n(m)" หรือ "Alt\n(ft)", QRA, Default เรียงตามชื่อ
- **ปุ่ม**: "Add new", "Edit", "Delete" และดับเบิลคลิกเพื่อแก้
- **Default**
  - ติ๊กแถวอื่นแล้วแถวเดิมหลุด
  - เอาติ๊กออกจาก Default ไม่มีผล
- **Delete**
  - ลบจนเหลือแถวเดียวไม่ได้ ใช้ข้อความ "Can not delete ground station!…" ของ Gpredict
  - ลบสถานีตั้งต้นแล้วแถวแรกตามชื่อกลายเป็นสถานีตั้งต้น
- **การบันทึก**: ทุกการแก้อยู่ในกล่องจนกด OK ของ Preferences แล้วส่ง `PUT /api/qth/batch` ที่แทนทั้งชุดในครั้งเดียว

### 4.2 สถานีที่ module ใช้อยู่ (ref-D §3)

- **ลบสถานีที่ module ใช้อยู่**: ทำได้เหมือน Gpredict
  - module นั้นเปลี่ยนเป็น "** DEFAULT **" และบันทึกทันที
  - log ระดับ ERROR บอกชื่อ module และสถานี
- **เปลี่ยนจาก core**: core ตอบ 409 `IN_USE` สำหรับ `DELETE /api/qth/{name}`
  - endpoint เดิมยังตอบแบบเดิม (ไม่มีหน้าจอใช้)
  - หน้านี้ใช้ batch ที่ทำตาม Gpredict
- **module ที่เปิดอยู่**: ใช้ค่าสถานีเดิมจนกว่าจะถูกสร้างใหม่ (เปิดใหม่, Configure → OK หรือเปิด server ใหม่) เหมือน Gpredict
- **module ที่ใช้ "** DEFAULT **"**: ตามสถานีตั้งต้นใหม่เมื่อถูกสร้างใหม่

### 4.3 ปุ่ม Select ของ Location และ Weather St

- **ปุ่ม Select ของ Location**: เปิดรายการเมืองแบบต้นไม้ ทวีป → ประเทศ → เมือง
  - เลือกแล้วใส่ Location, Latitude, Longitude, Altitude และ Weather St
  - คอลัมน์ lat/lon ใช้ `%.4f°` + ตัวอักษรทิศ (ref-D §2.1)
- **ปุ่ม Select ของ Weather St**: เลือกจากรายการเดียวกัน
- **ข้อมูล**: ไฟล์ `server/gpredict_web/data/locations.json` สร้างด้วยสคริปต์ `tools/build_locations.py` จาก `nsd_cccc.txt` ของ NOAA
  - รายการต่างจากของ Gpredict (คนละแหล่ง)
  - สคริปต์และวันที่ดาวน์โหลดบันทึกใน `SOURCE.md`

## 5. TLE

### 5.1 หน้า TLE Update (ref-D §4)

- **ตัวควบคุม**
  - "Check the age of TLE data:" (Never, Monthly, Weekly, Daily; ตั้งต้น Weekly)
  - "If TLEs are too old:" ("Notify me" ตั้งต้น, "Perform automatic update in the background")
  - "Proxy server:"
  - "TLE sources:" รายการที่แก้ได้ด้วยดับเบิลคลิก พร้อมปุ่ม "Add TLE source" และ "Delete TLE source"
  - "Add new satellites to local database"
  - ปุ่ม "Reset"
- **ค่าตั้งต้นของ "TLE sources:"**: 11 URL ตาม ref-D §4 ทุกตัวอักษร รวม `FORMAT=tlet` ของ gps-ops
  ซึ่งไม่มีผลเพราะของเราไม่ใช้ช่อง FORMAT ของ CelesTrak (หัวข้อ 5.2)
- **"Add new satellites to local database"**: บันทึกค่าจริง (Gpredict ไม่บันทึก หัวข้อ 11)

### 5.2 การดึงตาม source

| แบบของ URL | การดึง | กลุ่มในหน้าเลือกดาว |
|---|---|---|
| `https://celestrak.org/NORAD/elements/gp.php?GROUP=<g>&…` | ดึง OMM ของกลุ่ม `<g>` ผ่าน OMM cache ที่ใช้ร่วมกับ GNSS Studio ด้วยกติกา 1 ครั้งต่อกลุ่มต่อ 2 ชม. เหมือน core | `<g>` |
| URL อื่น (เช่น AMSAT) | ดึงข้อความ TLE 2 หรือ 3 บรรทัด ไม่เกิน 1 ครั้งต่อ URL ต่อ 2 ชม. เก็บที่ `data/tle/_cache/` | ชื่อไฟล์ใน URL ไม่รวมนามสกุล เช่น `nasabare` |

- **Proxy**: ใช้กับทุก source ของ TLE
- **การดึง TLE**: เพิ่ม engine แบบ additive โดยให้ `omm.fetch_group` รับ opener ที่มี proxy
- **TLE ทุก source**: รวมกันตามกติกาของ ref-D §5.3
  - epoch ใหม่กว่า: updated
  - epoch เท่ากัน: updated เมื่อสถานะเปลี่ยน ไม่งั้น skipped
  - epoch เก่ากว่า: skipped
  - ไม่มีข้อมูลจากทุก source: missing
  - ดวงใหม่: เพิ่มเมื่อเปิด "Add new satellites"
  - ชื่อแบบที่คอมพิวเตอร์สร้างถูกแทนด้วยชื่อจริง
  - สถานะจากป้าย `[+]`, `[-]`, `[P]`, `[B]`, `[S]`, `[X]` ท้ายชื่อเก็บใน satdb ช่องใหม่ `status`
- **ข้อความผลลัพธ์**: ตาม ref-D §5.4 รวมบรรทัด "New Satellites:\t\t %d"

### 5.3 ตรวจอายุอัตโนมัติ (ref-D §5.1)

- **รอบตรวจ**: server ตรวจทุก 10 นาที ครั้งแรก 10 นาทีหลังเปิด
  - เกณฑ์อายุ 30 วัน, 7 วัน หรือ 1 วันตาม "Check the age of TLE data:" (Never ไม่ตรวจ)
  - อายุนับจาก `TLE/LAST_UPDATE`
- **"Notify me"**: ส่งเหตุการณ์ทาง `/ws/app` ทุก browser แสดงกล่องที่ไม่ใช่ modal ข้อความของ Gpredict
  "Your TLE files are getting out of date.\nYou can update them by selecting\n<b>Edit -> Update TLE</b>\nin the menubar."
  - แจ้งครั้งเดียวต่อการเปิด server หนึ่งครั้ง
- **"Perform automatic update in the background"**: ดึงตามหัวข้อ 5.2 เงียบๆ แล้วให้ทุก module โหลดดาวใหม่
- **การบันทึก `TLE/LAST_UPDATE`**: เฉพาะเมื่อมีดวงที่ updated หรือดวงใหม่
  - Gpredict จึงอาจลองทุก 10 นาที ของเราติดกติกา 2 ชม. ต่อ source จึงไม่ส่ง request ถี่

### 5.4 Update TLE data from local files (ref-D §6)

- **กล่อง "Update TLE from files"**: ข้อความ "Select TLE directory:" และปุ่มเลือกโฟลเดอร์
  - ใช้ `<input type="file" webkitdirectory>` ของ browser แสดงชื่อโฟลเดอร์ที่เลือก
  - ปุ่ม "Cancel", "OK"
- **OK**: ส่งเฉพาะไฟล์ระดับบนของโฟลเดอร์ที่ชื่อลงท้าย `.tle` หรือ `.txt` (ไม่สนตัวพิมพ์) ไป `POST /api/tle/local`
  แล้วแสดงกล่อง "TLE Update" หัวข้อ "<b>Updating TLE files from files</b>" พร้อมตัวนับแบบหัวข้อ 5.2
- **การอ่านไฟล์**: ตาม ref-D §5.3
  - TLE 3 และ 2 บรรทัดปนกันได้
  - ตรวจ checksum และหมายเลขแคตตาล็อกตรงกันทั้งสองบรรทัด
  - ชื่อจาก 2 บรรทัดเป็น "<ปี>-<launch id>"
- **กลุ่ม**: ถ้าชื่อไฟล์ (ก่อนจุดแรก) ตรงกับกลุ่มที่มีอยู่ สมาชิกของกลุ่มนั้นถูกแทนด้วยดาวในไฟล์ เหมือนไฟล์ `.cat` ของ Gpredict
- **โฟลเดอร์ล่าสุด**: browser ไม่บอก path ของโฟลเดอร์ จึงจำโฟลเดอร์ล่าสุด (`TLE/FILE_DIR`) ไม่ได้

## 6. Log

### 6.1 Logger ของ server (ref-D §7.2)

- **ไฟล์**: `data/logs/gpredict.log`
- **รูปแบบบรรทัด**: `YYYY/MM/DD HH:MM:SS|<ระดับ 1–4>|<function>: <ข้อความ>` เวลาท้องถิ่นของเครื่อง
- **เปิด server**: ลบไฟล์ของรอบก่อน บรรทัดแรกคือ "Session started"
- **ปิด server**: เขียน "Session ended" แล้วหมุนไฟล์และลบตาม "Delete log files older than:"
- **ระดับ**: `LOG/LEVEL` (ตั้งต้น 2: Warning) มีผลเมื่อเปิด server ครั้งถัดไปเหมือน Gpredict
- **สิ่งที่บันทึก**
  - ทุกเหตุการณ์ของงานย่อย 1–3: เปิด/ปิด module, ดึง TLE และ SatNOGS, รัน GMAT, ข้อความของ controller ใน ref-R §3.8 และ §6.6
  - ข้อความจาก web ผ่าน `POST /api/log` เช่น "%s: PRINT not implemented" เมื่อกด Print ใน Upcoming passes

### 6.2 หน้า Message Logs และ Log browser (ref-D §7.1, §7.3)

- **หน้า Message Logs**: "Debug level:" 5 ระดับ, "Delete log files older than:" 4 ตัวเลือก, ข้อความอธิบาย และ "Reset"
- **File → Log browser (Ctrl+L)**: `FloatingWindow` "Log Browser" ขนาด 600 × 300 เปิดได้หน้าต่างเดียว
  - **ตาราง**: Time, Level ("NONE" … "DEBUG") และ Message
  - **กรอบ " Summary "**: นับ Errors, Warnings, Info, Debug และ Total
  - **ปุ่ม Open**: เลือกไฟล์ log จากเครื่องด้วยตัวเลือกไฟล์ของ browser แล้วอ่านที่ web
    ชื่อหน้าต่างเป็น "Log Browser: <ชื่อไฟล์>" เพราะ browser ไม่บอก path
  - **ปุ่ม Clear** และ **ปุ่ม Close**
  - **ข้อมูล**: อ่าน log ปัจจุบันครั้งเดียวตอนเปิดหน้าต่าง ไม่อัปเดตตามเหมือน Gpredict

## 7. Satellite Info (ref-D §8)

- **ทางเข้า**: "Satellite info" ในเมนูคลิกขวาของ List/Map/Polar, ชื่อดาวตัวหนาในเมนูของ Single sat และ Event list,
  และดับเบิลคลิกที่ดาวตามที่ ref ระบุ
- **หน้าต่าง**: "Satellite Info" ปุ่ม "OK" ไม่ใช่ modal เปิดได้หลายหน้าต่าง
- **แท็บ "Orbit Info"**: 16 แถวตาม ref-D §8.1 (ชื่อ, สถานะ, แคตตาล็อก, International designator, element set, Epoch time,
  Orbit number @ epoch, Inclination … B* drag term) รูปแบบตัวเลขตามนั้น ค่ามาจาก TLE
  - ข้อมูลในหน้าต่างนี้เป็นค่าของ TLE เอง ไม่ใช่ตำแหน่งดาว จึงไม่ขัดกติกา GMAT
- **แท็บ "Transponders"**: ตาม ref-D §8.2 ใช้ข้อมูลของ radio §7
  - ไม่มีข้อมูลแสดง "No transponders"
  - ชื่อ transponder ถูก escape ก่อนแสดง (หัวข้อ 11)

## 8. Detach, Attach, Full screen และการจำหน้าต่าง (ref-D §9)

### 8.1 Detach module

- **หน้าต่างใหม่**: เปิดหน้าต่าง browser ใหม่ (`window.open`) ที่แสดงเฉพาะ module นั้นพร้อม Module menu
  ชื่อหน้าต่าง "GPREDICT: <module> (<สถานี>)"
- **ขนาด**: `WIN_WIDTH` × `WIN_HEIGHT` ที่จำไว้ ไม่งั้นใช้ขนาดตอนอยู่ในแท็บ
- **ตำแหน่ง**: ใช้ค่าที่จำไว้เฉพาะเมื่อเปิด "Restore position of module windows"
- **หลัง Detach**
  - module ออกจากแถบแท็บของหน้าหลัก และบันทึก `STATE` = 1 ใน module
  - หน้าหลักทุกแท็บของ browser รู้ผ่าน `/ws/app`
- **การจำขนาดและตำแหน่ง**: หน้าต่างแยกส่งค่าเมื่อเปลี่ยน โดยตรวจทุก 1 วินาทีเพราะ browser ไม่มีเหตุการณ์ "ย้ายหน้าต่าง"
  - บันทึกลง module แบบ debounce
  - ข้ามค่าที่อยู่นอกจอ
- **ปิดหน้าต่างแยกด้วยปุ่มปิดของ browser**: เท่ากับ Close module
- **browser บล็อกหน้าต่างใหม่**: แสดงข้อความภาษาไทยบอกให้อนุญาต popup ของ `127.0.0.1:8740` **(ของเรา)**

### 8.2 Attach module

- เลือก Attach module ในหน้าต่างแยกแล้ว server บันทึก `STATE` = 0
- module กลับเป็นแท็บสุดท้ายของหน้าหลัก (ไม่เลือกให้) และหน้าต่างแยกปิดตัวเอง

### 8.3 Full screen

- **Full screen**: ใช้ Fullscreen API กับพื้นที่ของ module ในหน้าต่างที่อยู่
  - Gpredict สร้างหน้าต่างใหม่แล้วขยายเต็มจอ แต่ browser ขยายหน้าต่างที่เปิดใหม่โดยไม่มีการคลิกในหน้าต่างนั้นไม่ได้
- **Exit full screen**: ทำตาม Gpredict คือออกจากเต็มจอแล้วเป็น "หน้าต่าง"
  - module ที่อยู่ในแท็บจะถูก Detach ทันที (การคลิกเมนูนับเป็นการกระทำของผู้ใช้ จึงเปิดหน้าต่างได้)
  - ถ้าผู้ใช้กด Esc ให้ browser ออกเอง module อยู่ที่เดิม
- **การบันทึก**: ไม่บันทึกสถานะเต็มจอ เหมือน Gpredict

### 8.4 เปิด server หรือหน้าเว็บใหม่

- **ลำดับแท็บ**: ตาม session ของ core ปิด browser แล้วเปิดใหม่ได้แท็บเดิมที่เลือกไว้ (`GLOBAL/CURRENT_PAGE`)
- **module ที่จำไว้ว่าเป็นหน้าต่าง**: เมื่อเปิด "Restore the state of modules when reopened (docked or window)"
  - browser ห้ามเปิดหน้าต่างโดยไม่มีการคลิก หน้าหลักจึงแสดงแถบ
    "module <ชื่อ> ตั้งให้เปิดเป็นหน้าต่างแยก" พร้อมปุ่ม "เปิด" **(ของเรา)**
- **"Restore position of main window"**: บันทึกค่าได้แต่ไม่มีผล เพราะหน้าเว็บย้ายหน้าต่างหลักของ browser ไม่ได้

## 9. Preferences → Modules

### 9.1 ค่ารวมและการสืบทอด (ref-D §10)

- **ที่เก็บ**: ค่ารวมอยู่ใน `preferences.json` ด้วย key ของ Gpredict เช่น `MODULES/GRID`, `MODULES/DATA_TIMEOUT`,
  `MODULES/LIST_COLUMNS`, `MODULES/MAP_FILE`, สีของ Map และ Polar
- **ไฟล์ module**: เก็บเฉพาะค่าที่ตั้งเฉพาะ module นั้น ค่าที่ใช้จริงหาตามลำดับนี้
  1. ค่าของ module
  2. ค่ารวม
  3. ค่าตั้งต้นของ Gpredict
- **module ใหม่**: เก็บแค่ดาว สถานี และชื่อ จึงใช้ค่ารวมทั้งหมด
- **ย้ายไฟล์ module ของ core**: ทำครั้งเดียวตอนเปิด server
  - ค่าที่เท่ากับค่าตั้งต้นถูกลบออกเพื่อให้สืบทอด ค่าที่ต่างคงไว้
  - เก็บสำเนาเดิมที่ `data/modules/_backup_v1/`
- **เมื่อไรค่ารวมมีผล**: เมื่อ module ถูกสร้างใหม่ (เปิด, Configure → OK, เปิด server ใหม่) เหมือน Gpredict
  - Number Formats มีผลทันที (หัวข้อ 3)

### 9.2 หน้า

- **แท็บในกลุ่ม Modules**: 6 แท็บเดียวกับ Module properties ของ core คือ Layout, Refresh Rates, List View, Map View, Polar View, Single Sat View
- **Window Placements**: มีเฉพาะในแท็บ Layout ของกลุ่มนี้ 3 กล่องตาม ref-D §10
  - core แสดงใน Module properties แบบกดไม่ได้ งานนี้ย้ายออกตาม Gpredict
- **Reset**
  - ในกลุ่มนี้ tooltip "Reset settings to the default values." ใช้ค่าตั้งต้น
  - ใน Module properties tooltip "Reset module settings to the global values." ใช้ค่ารวม (หน้า Map ใช้ข้อความเฉพาะของ ref-D)
  - กด OK หลัง Reset โดยไม่แก้ต่อ = ลบ key ของหน้านั้น
- **OK หลังแก้หน้าใด**: เขียนทุก key ของหน้านั้น ตาม ref-D §10

### 9.3 หน้า Map View: ภาพและสี (ref-D §11)

- **ภาพแผนที่**: รูปย่อ 100 × 50 และปุ่ม "Select map" เปิดกล่อง "Select Map"
  - รายการภาพ 15 ภาพของ Gpredict + ภาพที่ผู้ใช้อัปโหลด
  - ตัวอย่าง 160 × 80 พร้อม "<w>x<h> pixels\n<ขนาด>"
  - ปุ่ม "Cancel", "Open"
  - ภาพที่ผู้ใช้อัปโหลดเก็บที่ `data/maps/` **(ของเรา: browser เลือกไฟล์บนดิสก์ของ server ไม่ได้)**
- **ไฟล์ที่ตั้งไว้หายไป**: ใช้ภาพตั้งต้นพร้อม log (หัวข้อ 11)
- **Colours**: 11 ปุ่มสีตาม ref-D §11 และ slider "Shadow:"
  - ปุ่มสีมี alpha (`<input type="color">` + slider ความทึบ 0–255) เก็บเป็น `0xRRGGBBAA` แบบ Gpredict
- **การวาด**: Map ของ core วาดด้วยสีและภาพตามค่าที่ใช้จริง (core ใช้ค่าตั้งต้นคงที่)

### 9.4 หน้า Polar View: สี (ref-D §12)

- 7 ปุ่มสีและ "Show the sky tracks automatically"
- Polar ของ core และ Polar plot ของ passes และ radio ใช้สี/ทิศตามค่าที่ใช้จริง

## 10. หน้าต่าง Preferences หลังงานนี้

- **กลุ่มที่ใช้ได้**: General, Modules, Interfaces, Predict
- **หน้าแรก**: เปิดที่ General
- **ชื่อหน้าต่าง**: "GPREDICT Preferences :: <กลุ่ม>"
- **OK**: บันทึกตามลำดับของ Gpredict คือ General, Modules, Interfaces, Predict
- **บันทึกไม่ผ่าน**: ถ้าส่วนใดผิด ไม่มีส่วนไหนถูกบันทึก แสดงข้อความภาษาไทยบอกช่องที่ผิด **(ของเรา)**

## 11. ข้อตกลงที่ต่างจาก Gpredict

| เรื่อง | Gpredict | ของเรา | เหตุผล |
|---|---|---|---|
| "Add new satellites to local database" | ไม่บันทึก | บันทึก | ข้อบกพร่อง |
| เทียบ epoch ของ TLE ตอนรวม (updated/skipped) | เทียบเลข YYDDD.dddd ของ TLE ตรงๆ epoch ปี 19xx (เช่น 99…) จึงนับว่าใหม่กว่า 20xx (เช่น 26…) | เทียบเป็นวันเวลาจริง (ปีสองหลัก ≥ 57 เป็น 19xx) | ข้อบกพร่อง |
| ตาราง Ground Stations เมื่อติ๊ก Imperial | หัวคอลัมน์ "Lon" เปลี่ยนเป็น "Alt" | หัว "Alt" เปลี่ยนถูกคอลัมน์ | ข้อบกพร่อง |
| ความสูงสถานีเมื่อใช้ Imperial | หายได้ 1 ม. ต่อการกด OK, editor ของ module บันทึกฟุตเป็นเมตร | แปลงถูกต้อง ไม่ปัดทิ้ง | ข้อมูลหาย |
| สถานีตั้งต้น | เทียบท้ายชื่อไฟล์ ("xsample" ตรงกับ "sample") | เทียบชื่อเต็ม | ข้อบกพร่อง |
| "1 month" ของ log | 210 วัน | 30 วัน | ค่าคงที่ผิด |
| Log browser: Clear | ไม่ล้างตัวนับ Info | ล้างครบ | ข้อบกพร่อง |
| Log browser: ข้อความที่มี "\|" | แยกผิด | แยกเฉพาะสองช่องแรก | ข้อบกพร่อง |
| Reset ของ Map | ไม่รีเซ็ตสี terminator และ global shadow | รีเซ็ตครบ | ข้อบกพร่อง |
| สีพื้นของข้อความบน Map | hex ไม่เติม 0 | เติม 0 | ข้อบกพร่อง |
| ไฟล์แผนที่หาย | ภาพสีเทา | ภาพตั้งต้น | ข้อบกพร่อง |
| ชื่อ transponder ใน Satellite Info | ไม่ escape | escape | ข้อบกพร่อง |
| Select directory, Select Log File, Select Map | ตัวเลือกไฟล์ของระบบ | ตัวเลือกของ browser และอัปโหลด | ข้อจำกัดของ browser |
| Full screen จากแท็บ | สร้างหน้าต่างใหม่แล้วเต็มจอ | เต็มจอในหน้าต่างเดิม | ข้อจำกัดของ browser |
| คืนสถานะหน้าต่างตอนเปิดใหม่ | เปิดหน้าต่างเอง | แถบให้กดเปิด | browser บล็อก popup |
| ตำแหน่งหน้าต่างหลัก | คืนได้ | บันทึกได้แต่ไม่มีผล | ข้อจำกัดของ browser |
| รายชื่อเมือง | `locations.dat` ของ Gpredict | สร้างจาก NOAA | สัญญาอนุญาต |

ทำตามแม้ดูแปลก:
- ระดับ log มีผลหลังเปิด server ใหม่
- แจ้ง TLE เก่าครั้งเดียวต่อการเปิด server
- ค่ารวมของ Modules มีผลเมื่อ module ถูกสร้างใหม่
- tooltip ของปุ่ม "Info Text:" ใน Polar View ใช้ข้อความของปุ่มพื้นหลัง
- URL `FORMAT=tlet`

## 12. API และ error ที่เพิ่ม

| Method | Path | ทำอะไร |
|---|---|---|
| PUT | `/api/qth/batch` | `{stations: [...], default}` แทนทั้งชุด (หัวข้อ 4) |
| POST | `/api/tle/local` | JSON `{"files": [{"name", "text"}]}` (หน้าเว็บอ่านไฟล์เป็นข้อความ ไม่ใช้ multipart: การตัดสินข้อ 2 ของแผน) ไม่เกิน 200 ไฟล์ ข้อความรวมไม่เกิน 20 MB body เกิน 40 MB ปฏิเสธก่อนอ่าน คืนตัวนับแบบ `/api/tle/update` |
| GET | `/api/logs/current` | ข้อความของ `gpredict.log` (ไม่มีไฟล์ = ข้อความว่าง) |
| POST | `/api/log` | `{level, function, text}` จาก web (ระดับไม่เกิน 4 ยาวไม่เกิน 500) |
| GET/POST | `/api/maps` | รายการภาพ (ของ Gpredict + อัปโหลด) / อัปโหลดภาพ (jpg, png ไม่เกิน 10 MB) |
| GET | `/api/maps/{file}` | ไฟล์ภาพ |
| GET | `/api/locations` | รายชื่อเมืองและสถานีอากาศ |
| PUT | `/api/modules/{name}/window` | `{state, x, y, width, height}` ของหน้าต่างแยก |
| PUT | `/api/modules/{name}?recreate=true` | Configure → OK: บันทึกแล้วสร้าง module ที่เปิดอยู่ใหม่ด้วยค่ารวมและสถานีของตอนนั้น (หัวข้อ 9.1) module ที่ปิดอยู่ = บันทึกธรรมดา (รอบแก้ไขสุดท้าย) |
| GET | `/api/modules/{name}` | module ที่เปิดอยู่: ค่าที่ module ทำงานอยู่ (ช่อง `window` จากไฟล์) `?fresh=1` = ไฟล์ + ค่ารวมปัจจุบัน สำหรับ Edit module (รอบแก้ไขสุดท้าย) |
| GET | `/api/satellites/{norad}` | เพิ่ม `status` และค่าของ Orbit Info |
| WS | `/ws/app` | เหตุการณ์ระดับโปรแกรม: `prefs_changed`, `modules_changed`, `tle_old` และ `module_config_changed` `{modules: [...]}` (ค่าที่ module ที่เปิดอยู่ทำงานอยู่เปลี่ยนจากนอกหน้าที่แสดงมัน: รอบแก้ไขสุดท้าย) |

- **Preferences**: `PUT /api/prefs` ของ passes รับ key ใหม่ทั้งหมดของ General และ Modules
- **รหัสใหม่**:
  - `QTH_LAST` (422 ลบจนไม่เหลือ)
  - `TLE_FILE_INVALID` (warning ต่อไฟล์ และ 422 ของ body ที่ผิดรูปหรือเกินขนาด)
  - `MAP_INVALID` (422)
  - `LOG_INVALID` (422 `POST /api/log` ผิดรูปแบบ: การตัดสินข้อ 13 ของแผน)
  - `LOG_UNREADABLE` (500 `GET /api/logs/current` เมื่อมีไฟล์แต่อ่านไม่ได้: รอบแก้ไขสุดท้าย)
- **รหัสเดิมที่ใช้เพิ่ม**: `CONTROLLER_ACTIVE` (409) ของ `?recreate=true` เมื่อ Radio Control หรือ Antenna Control เปิดอยู่และสถานี (เทียบชื่อ) หรือรายชื่อดาวจะเปลี่ยน
  (การตัดสินข้อ 4 ของงานย่อยที่ 3)
- **ความปลอดภัย**: การตรวจ Host/Origin ของ core ครอบทุก endpoint ใหม่รวม `/ws/app`

## 13. การทดสอบ

- **Server**
  - **prefs**: schema ของทุก key ใหม่
  - **การสืบทอดค่า**: module → ค่ารวม → ค่าตั้งต้น และการย้ายไฟล์ module ของ core (ค่าเท่าค่าตั้งต้นถูกลบ, มี backup)
  - **QTH batch**: ลบสถานีที่ใช้อยู่, ลบสถานีตั้งต้น, ห้ามเหลือศูนย์
  - **ตัวอ่าน TLE**: 2/3 บรรทัด, checksum, ป้ายสถานะ, ชื่อจาก 2 บรรทัด, ชื่อแบบที่คอมพิวเตอร์สร้าง, กติการวมทุกข้อของ ref-D §5.3
  - **source**: การแยก URL ของ CelesTrak กับ URL อื่น, กติกา 2 ชม. ต่อ URL, proxy
  - **ตรวจอายุอัตโนมัติ**: ทั้ง notify และ background (นาฬิกาจำลอง)
  - **logger**: รูปแบบบรรทัด, ระดับ, หมุนไฟล์และลบตามอายุ
  - **locations**: ตัวอ่านของ NOAA กับ fixture
  - **API**: ทุก endpoint ใหม่
- **Web (Vitest)**
  - **`formatTime`**: ทุกรหัสใน 3.2 เทียบกับผลของ `strftime` ใน Python ที่ locale C
  - **ตัวเลข**: lat/lon แบบ N/S/E/W และแบบมีเครื่องหมาย (ช่องว่างท้าย) และการแปลง km→mi, m→ft ทุก view
  - **Log browser**: ตัวแยกบรรทัดทั้ง 3 และ 4 ช่อง
  - **สี**: แปลง `0xRRGGBBAA` ไปกลับ
  - **การสืบทอดค่า**: ค่าที่ใช้จริงในหน้า Module properties
  - **Detach**: ขนาดและตำแหน่งของหน้าต่างแยก

## 14. เกณฑ์ว่าสำเร็จ

1. **Number Formats**: เปิด "Use Imperial units", "Use N/S/E/W" และ "Show local time" แล้ว List, Single sat, Pass details,
   Radio Control และนาฬิกาหัว module แสดงหน่วย ทิศ และเวลาท้องถิ่นตาม ref-D §2.1 ปิดแล้วกลับเป็นแบบเดิม
2. **Ground Stations**: เพิ่มสถานีด้วย Select เมือง Chiang Mai แล้วตั้งเป็น Default
   - module ที่ใช้ "** DEFAULT **" เปิดใหม่แล้วใช้สถานีนั้น
   - ลบสถานีที่ module ใช้อยู่แล้ว module นั้นกลายเป็น "** DEFAULT **"
3. **TLE**: Update TLE data from network ดึง AMSAT `nasabare.txt` ได้ และดาวที่ได้จาก AMSAT อยู่ในกลุ่ม `nasabare`
   - Update TLE data from local files ด้วยโฟลเดอร์ที่มีไฟล์ TLE 2 และ 3 บรรทัดได้ตัวนับถูกต้อง
4. **ตรวจอายุ TLE**: ตั้ง "Daily" และ `LAST_UPDATE` เก่า 2 วัน
   - "Notify me": ภายใน 10 นาทีขึ้นกล่องแจ้งเตือน
   - แบบ background: ดึงเองโดยไม่ส่ง request เกินกติกา 2 ชม.
5. **Log browser**: แสดง log ที่มีบรรทัดจากงานย่อย 1–3 และ Summary นับถูก
6. **Satellite Info** ของ ISS แสดงค่าตรงกับ TLE และแท็บ Transponders แสดงรายการจาก SatNOGS
7. **Detach module**: เปิดหน้าต่างแยก ย้ายและขยายหน้าต่าง แล้ว Attach module กลับเป็นแท็บสุดท้าย
   - Detach อีกครั้งได้ขนาดเดิม
   - Full screen และ Exit full screen ทำงานตามหัวข้อ 8.3
8. **ค่ารวมของ Modules**: เปลี่ยน layout ของกลุ่ม Modules แล้วสร้าง module ใหม่ได้ layout นั้น
   - module เดิมที่ไม่ได้ตั้ง layout เองได้ layout ใหม่เมื่อเปิดใหม่
   - module ที่ตั้งเองไม่เปลี่ยน
9. **ภาพและสีของ Map**: เลือก `nasa-topo_1024.jpg` และเปลี่ยนสีดาวแล้ว Map วาดตาม
10. **ครบทุกรายการ**: ไม่มีรายการไหนในเมนูของ Gpredict ที่กดไม่ได้ (`later.ts` ว่าง)
    - test ทั้งหมดผ่าน และ GNSS Studio ได้ผลเหมือนเดิมทุกไบต์
