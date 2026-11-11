# Gpredict Web

หน้าเว็บที่ทำหน้าตาและการใช้งานแบบโปรแกรม Gpredict (เมนู หน้าต่าง คอลัมน์ ค่าตั้งต้นตาม Gpredict 2.7)
แต่ตำแหน่งดาวทุกค่ามาจาก GMAT (SPICESGP4) ดาวและ TLE มาจาก CelesTrak
เป็น Python server บนเครื่อง (FastAPI) ที่เปิดดูผ่าน browser

**ไม่ใช่โปรแกรม Gpredict และไม่เกี่ยวข้องกับผู้พัฒนา Gpredict** เขียนโค้ดขึ้นใหม่ทั้งหมด ลอกเฉพาะพฤติกรรมและ layout
ชื่อ "Gpredict Web" เป็นชื่อชั่วคราว

เอกสารออกแบบอยู่ใน [docs/](docs/)

- [2026-11-11-gpredict-web-core-design.md](docs/2026-11-11-gpredict-web-core-design.md): spec ของงานย่อยที่ 1 (Tracking core)
- [2026-11-11-gpredict-web-core-plan.md](docs/2026-11-11-gpredict-web-core-plan.md): แผนการทำงาน
- [2026-11-11-gpredict-reference.md](docs/2026-11-11-gpredict-reference.md): ชื่อเมนู คอลัมน์ และค่าตั้งต้นของ Gpredict ที่ตรวจกับ source code

## งานย่อยที่ 1 (Tracking core) มีอะไรบ้าง

- Module (แท็บ) หลายตัว ลากแท็บสลับลำดับได้ เปิดครั้งแรกได้ module `Amateur` ที่สถานี THBK (กรุงเทพ) ใน layout preset 0
- View ครบ 5 แบบ: Map, Polar, List (27 คอลัมน์), Single sat (23 ช่อง), Event list ("Upcoming passes")
- Layout 9 แบบตามที่ Gpredict มี และ Custom (พิมพ์ layout code เอง)
- Time Controller: ปฏิทิน, Hour/Min/Sec/Msec, Throttle 1 ถึง 100, slider, Reset, Play backwards, Stop, Play forward
- สร้าง แก้ โคลน ลบ module, Module properties ทั้ง 6 แท็บ, ตั้งค่าสถานี (QTH) ได้หลายสถานี
- ช่วงคำนวณของ GMAT พร้อม cache รายดวง และ interpolation (ดูผลวัดความแม่นในหัวข้อ "ผลตรวจรับ")
- เมนูคลิกขวาของดาวใน List, Map, Polar, Event list และปุ่มใน Single sat: Highlight footprint, Ground Track, Sky track, เลือกดาว
- Edit → Update TLE data from network (ใช้ cache ร่วมกับ GNSS Studio: ขอ CelesTrak ไม่เกิน 1 ครั้งต่อกลุ่มต่อ 2 ชั่วโมง)

### รายการที่กดไม่ได้ (อยู่ในงานย่อยถัดไป)

รายการเหล่านี้แสดงตามตำแหน่งของ Gpredict แต่กดไม่ได้ และมี tooltip ภาษาไทยบอกว่าอยู่ในงานย่อยไหน

| ที่อยู่ | รายการ | งานย่อย |
|---|---|---|
| File | Log browser | 4 (Data & Preferences) |
| Edit | Update TLE data from local files, Preferences | 4 (Data & Preferences) |
| Edit | Update transponder data | 3 (Radio & Rotator) |
| Module menu | Detach module, Full screen | 4 |
| Module menu | Sky at a glance | 2 (Pass predictions) |
| Module menu | Radio Control, Antenna Control | 3 |
| คลิกขวาที่ดาว (List, Map, Polar) และเมนูของ Single sat, Event list | Satellite info (หรือชื่อดาวตัวหนา) | 4 |
| เหมือนข้างบน | Show current pass, Show next pass, Future passes | 2 |
| Module properties | สี, Select map, Window Placements | 4 |

Help ไม่มี News (ของเรา) และ "About Gpredict Web" เป็นของเรา

## สิ่งที่ต้องมี

- Python 3 (ทดสอบกับ 3.14.6) ตัว engine `gnss_predict` ใช้ standard library ล้วน ส่วน server ใช้ `fastapi`, `uvicorn`, `websockets` (ดู `server/requirements.txt`)
- Node.js และ npm (ทดสอบกับ Node.js v26.3.0) สำหรับ build หน้าเว็บ (React, TypeScript, Vite)
- GMAT R2026a ที่ build แล้ว: ต้องมี `GmatConsole` (ค่าตั้งต้นคือ `application/bin/GmatConsole` ของ repo หรือชี้ด้วย `GMAT_BIN`)
  ถ้าไม่เจอ GMAT หน้าเว็บจะแสดงข้อความว่าไม่พบ GMAT แทนค่าของดาว
- อินเทอร์เน็ตสำหรับดึง TLE จาก CelesTrak ครั้งแรก (ไม่มีเน็ตก็ใช้ไฟล์ใน cache ได้ถ้ามี)
- Browser รุ่นปัจจุบัน หน้าจอกว้างอย่างน้อย 1024 px (ไม่มี layout สำหรับมือถือ)

## ติดตั้ง

ทุกคำสั่งรันจากโฟลเดอร์ `api-interop/gpredict-web/` ของ repo

```bash
cd api-interop/gpredict-web

# 1. Python virtual environment และ library ของ server
python3 -m venv .venv
.venv/bin/pip install -r server/requirements.txt

# 2. library ของหน้าเว็บ แล้ว build เป็น web/dist (server เสิร์ฟโฟลเดอร์นี้)
cd web
npm install
npm run build
```

`web/dist/`, `.venv/`, `web/node_modules/` และ `data/` ไม่ถูกเก็บใน git ต้องทำขั้นตอนข้างบนเองหลัง clone

## วิธีรัน

```bash
cd api-interop/gpredict-web/server
../.venv/bin/python -m gpredict_web
```

แล้วเปิด <http://127.0.0.1:8740>

process เดียวเสิร์ฟทั้ง API (`/api`), WebSocket (`/ws`) และหน้าเว็บ (`web/dist`) หยุดได้ด้วย File → Quit ในหน้าเว็บ หรือ Ctrl+C

ตัวอย่างที่ระบุ GMAT เองและใช้ OMM cache ร่วมกับ GNSS Studio

```bash
GMAT_BIN=/path/to/GmatConsole \
GNSS_STUDIO_DATA=/path/to/api-interop/gnss-predict/data \
../.venv/bin/python -m gpredict_web --data /path/to/my-gpredict-data
```

### Flag

| Flag | ค่าตั้งต้น | ความหมาย |
|---|---|---|
| `--host H` | `127.0.0.1` | ที่อยู่ที่ฟัง |
| `--port P` | `8740` | port |
| `--data DIR` | `GPREDICT_WEB_DATA` หรือ `api-interop/gpredict-web/data` | โฟลเดอร์ข้อมูล |

### ตัวแปรสภาพแวดล้อม

| ตัวแปร | ค่าตั้งต้น | ความหมาย |
|---|---|---|
| `GPREDICT_WEB_DATA` | `api-interop/gpredict-web/data` | QTH, module, session, ดัชนีดาว, ephemeris cache (flag `--data` ชนะตัวแปรนี้) |
| `GNSS_STUDIO_DATA` | `api-interop/gnss-predict/data` | ที่อยู่ OMM cache (`orbits/_cache/`) และ `celestrak_state.json` ที่ใช้ร่วมกับ GNSS Studio ทำให้กติกา "ขอ CelesTrak ได้ 1 ครั้งต่อกลุ่มต่อ 2 ชั่วโมง" นับรวมของทั้งสองโปรแกรม |
| `GMAT_BIN` | `application/bin/GmatConsole` ของ repo | ตำแหน่ง `GmatConsole` |

### เปิดให้เครื่องอื่นใน LAN ใช้

ตั้งต้นฟังเฉพาะ `127.0.0.1` ถ้าตั้ง `--host` เป็นอย่างอื่น server พิมพ์คำเตือนว่า **ไม่มีระบบ login**
เครื่องอื่นในเครือข่ายจะแก้ module และ QTH และสั่งปิด server ได้ จึงควรใช้ในเครือข่ายที่ไว้ใจเท่านั้น

server ตรวจ Host และ Origin ของทุกคำขอ รับเฉพาะ `127.0.0.1`, `localhost` และค่าของ `--host`
ถ้าตั้ง `--host 0.0.0.0` เครื่องอื่นที่เปิดด้วย IP ของเครื่องนี้จะถูกปฏิเสธ ให้ตั้ง `--host` เป็น IP ของเครื่องนั้นแทน เช่น `--host 192.168.1.20`

### ข้อมูลที่เก็บ (`--data`)

| ไฟล์ | เนื้อหา |
|---|---|
| `qth/*.json` | สถานี (QTH) |
| `modules/*.json` | module แต่ละตัว |
| `session.json` | module ที่เปิดอยู่และลำดับแท็บ |
| `settings.json` | สถานีตั้งต้น (`** DEFAULT **`) |
| `satdb.json` | ดัชนีดาวจาก CelesTrak |
| `ephem/` | ephemeris cache ของ GMAT รายดวงต่อช่วง (ช่วงที่เก่ากว่า 7 วันถูกลบเอง ช่วง 99 ดวงใช้ราว 9 MB) |

เปิดครั้งแรกที่ยังไม่มีข้อมูล: สร้างสถานี THBK, ดึงกลุ่ม `amateur` จาก CelesTrak หนึ่งครั้ง แล้วสร้างและเปิด module `Amateur`
(ถ้าดึงไม่ได้และไม่มี cache จะไม่สร้าง module และบอกให้ใช้ Edit → Update TLE data from network)

### พัฒนา

```bash
# server (reload เมื่อแก้โค้ด) และหน้าเว็บ (Vite proxy /api และ /ws ไป 8740) เปิดสอง terminal
cd api-interop/gpredict-web/server && ../.venv/bin/uvicorn gpredict_web.app:app --reload --port 8740
cd api-interop/gpredict-web/web && npm run dev
```

## วิธีทดสอบ

มีสามชุด รันแยกกัน ตั้ง `GMAT_BIN` ถ้า build GMAT ไม่ได้อยู่ที่ `application/bin/GmatConsole`

```bash
# 1. engine (gnss_predict)
cd api-interop/gnss-predict && python3 -m unittest discover -s tests

# 2. server (รวม integration กับ GMAT จริง ซึ่งข้ามเมื่อหา GmatConsole ไม่เจอ)
cd api-interop/gpredict-web/server && GMAT_BIN=/path/to/GmatConsole ../.venv/bin/python -m unittest discover -s tests

# 3. หน้าเว็บ (Vitest) และ build
cd api-interop/gpredict-web/web && npm test && npm run build
```

ความแม่นของ interpolation และ AOS/LOS เทียบกับ GMAT ที่รันทุก 1 วินาที (ISS, ดาว GEO, ดาว Molniya ช่วง 2 ชั่วโมง)
รันเฉพาะชุดนี้และดูตัวเลขที่วัดได้ด้วย

```bash
cd api-interop/gpredict-web/server
GMAT_BIN=/path/to/GmatConsole ../.venv/bin/python -m unittest tests.test_integration_gmat -v
```

## ข้อจำกัดที่ทราบ

- งานย่อยที่ 1 เท่านั้น: Satellite info, Show current/next pass, Future passes, Sky at a glance, Radio/Antenna Control, Preferences,
  Log browser, Detach/Full screen, สีและภาพแผนที่ที่เปลี่ยนได้ ยังไม่มี (ตารางข้างบน)
- ไม่มีระบบ login ใช้คนเดียวบนเครื่องตัวเอง (ดูหัวข้อ LAN)
- ปุ่ม Select ของ Location และ Weather St ใน Edit ground station data กดไม่ได้ (ไม่มีรายชื่อเมืองและสถานีอากาศ) ไม่มีโหมด GPSD
  Module properties แสดง "Window Placements" ในหน้า Layout (กดไม่ได้) ทั้งที่ Gpredict แสดงเฉพาะใน Preferences รวม
- ดาวสูงสุด 200 ดวงต่อ module
- ต้องมี GMAT: เมื่อตั้งเวลาไปนอกช่วงที่คำนวณไว้ (เช่นข้ามไปอีก 3 วัน) server ต้องสั่ง GMAT คำนวณช่วงใหม่ทั้งช่วง
  ระหว่างนั้นหน้าจอถูกบังด้วย "กำลังคำนวณวงโคจรด้วย GMAT…" ตัวอย่างที่วัดได้: 99 ดวง ช่วง 16 ชั่วโมง ใช้ราว 17 วินาที
  ช่วงที่เคยคำนวณแล้วถูกเก็บใน cache จึงกลับไปเวลาเดิมได้ทันที
- ความแม่นขึ้นกับอายุของ TLE: ตำแหน่งที่ห่างจาก epoch ของ TLE มาก (เช่น เวลาไปอีกหลายวันข้างหน้า) คลาดเคลื่อนได้มากขึ้น
  server เตือนเมื่อ TLE เก่ากว่า 7 วัน
- CelesTrak ให้ขอได้ 1 ครั้งต่อกลุ่มต่อ 2 ชั่วโมง Update TLE ที่กดซ้ำในช่วงนั้นใช้ไฟล์เดิมใน cache และบอกเป็นข้อความ
- ตรวจหน้าจอจริงด้วย Google Chrome (headless) เท่านั้น Safari และ Firefox ยังไม่ได้ทดสอบ
- View ที่อยู่ในช่องแคบมากจะมี scroll: ใน layout "All views (wide)" ช่อง Event list แคบกว่าตาราง (ต้องกว้างราว 383 px)
  เมื่อหน้าต่าง browser กว้างน้อยกว่าราว 1530 px จะเห็นคอลัมน์ AOS/LOS ต้องเลื่อนดู
- ภาพแผนที่คือ Blue Marble ของ NASA (public domain) ขนาด 1024×512 ยืดเต็ม view

## ผลตรวจรับ

ตรวจรับตามหัวข้อ 10 ของ spec ด้วย GMAT จริง (`application/bin/GmatConsole`), TLE จริงจาก CelesTrak และ Google Chrome (headless, ขับด้วย puppeteer-core)
วันที่ 2026-11-12 (เวลาไทย) ตรงกับ 2026-11-11 18:10 ถึง 18:45 UTC ข้อมูลของการตรวจอยู่ใน data dir ใหม่ที่ว่างเปล่า ไม่ใช่ `api-interop/gpredict-web/data`
ภาพหน้าจอทั้งหมดเก็บไว้ใน scratchpad ของ session ตรวจรับ (ไม่ได้ commit)

| # | เกณฑ์ | ผล |
|---|---|---|
| 1 | เปิดครั้งแรกได้ `Amateur` ที่ THBK ใน preset 0 และอัปเดตตามรอบ | ผ่าน |
| 2 | module ใหม่ ISS + 10 ดวง layout "All views (wide)" view ครบ 5 แบบอัปเดต | ผ่าน |
| 3 | ความแม่นยำตามเกณฑ์ integration ของ spec 9.2 | ผ่าน (7 test รันจริง ไม่ข้าม) |
| 4 | Time Controller: throttle 50, Play backwards, Stop + ตั้งเวลาไปอีก 3 วัน เห็น overlay แล้วกลับมา, Reset | ผ่าน |
| 5 | ปิดแล้วเปิด server และ browser ใหม่ ได้ module, ลำดับแท็บ, QTH เดิม | ผ่าน |
| 6 | ชื่อเมนู ปุ่ม คอลัมน์ และค่าตั้งต้นตรงกับรายการอ้างอิง | ผ่าน (ไม่พบจุดที่ไม่ตรง) |
| 7 | test ทั้งหมดของ `gnss-predict` ผ่านโดยไม่แก้ test เดิม | ผ่าน (498 test) |

### 1. เปิดครั้งแรก

เปิด server ด้วย `--data` ที่ว่างเปล่า (`GMAT_BIN` และ `GNSS_STUDIO_DATA` ตามข้างบน) ดึงกลุ่ม `amateur` จาก CelesTrak 1 ครั้ง (2026-11-11T18:12:06Z)
ได้สถานี THBK (ตั้งเป็นสถานีตั้งต้น) และ module `Amateur`: สถานี `** DEFAULT **` (= THBK), 99 ดวง, layout code `1;0;2;0;1;2;0;1;1;2;3;1;2;1;2` (preset 0),
หน้าเว็บมีวิว Map (ครึ่งบน), Polar และ Single sat (ครึ่งล่างซ้ายและขวา) ชื่อหน้า "Gpredict Web: Amateur" ไม่มีแถบแท็บเพราะเปิด module เดียว ไม่มี error ใน console ของ browser

วัดรอบการอัปเดตของแต่ละ view ด้วยการสุ่มภาพ canvas และข้อความทุก 250 ms นาน 16.2 วินาที (refresh data 300 ms)

| ส่วน | รอบตั้งต้นของ Gpredict | ที่วัดได้ใน 16.2 วินาที |
|---|---|---|
| เวลาของ module (หัว) | ไม่เกินวินาทีละครั้ง | เปลี่ยน 16 ครั้ง (ราว 1 วินาที) |
| Map | ทุก 10 รอบ = 3.0 วินาที | วาดใหม่ 5 ครั้ง ห่างราว 3.0 วินาที (2.32, 5.51, 8.31, 11.51, 14.44 วินาที) |
| Polar | ทุก 3 รอบ = 0.9 วินาที | เปลี่ยน 18 ครั้ง ห่างราว 0.87 วินาที |
| Single sat | ทุก 1 รอบ = 0.3 วินาที | เปลี่ยน 53 ครั้ง ห่างราว 0.29 วินาที |

ภาพ: `01-first-start-a.png` (18:12:37), `01-first-start-b.png` (18:12:43, ห่างกัน 6 วินาที Next countdown เปลี่ยนจาก 02:06 เป็น 01:59 ตำแหน่งดาวและค่าใน Single sat เปลี่ยน), `01-first-start-c.png`

### 2. module ใหม่ ISS + 10 ดวง

ใช้ File → New module ของจริง ตั้งชื่อ `Accept2` ค้น 25544 แล้วดับเบิลคลิกเพื่อย้าย ISS (ZARYA) ไปกล่อง Selected และย้ายอีก 10 ดวงแรกของรายการ
(239ALFEROV, 2026-195A, ALTAIR, ASRTU-1, BEESAT-1, CAS-2T & KS-1Q, COLIBRI-S, CROCUBE, CUBEBUG-2, CUBESAT XI-IV รวม 11 ดวง)
กด Properties เลือก "All views (wide)" (layout code `1;0;3;0;3;0;0;3;3;4;2;3;4;0;2;4;3;4;2;3;3;3;4;3;4`) OK แล้ว OK
ได้แท็บ `Accept2` มี view ครบ 5 แบบ: Map (คอลัมน์ 1 ถึง 3, แถว 1 ถึง 3), List (แถว 4), Polar, Event list, Single sat (คอลัมน์ขวา)

วัดรอบการอัปเดตนาน 16.7 วินาที: เวลา module 16 ครั้ง, Map 6 ครั้ง (ห่าง 3 วินาที), Polar 17 ครั้ง, Single sat 55 ครั้ง (0.3 วินาที),
List 55 ครั้ง (ค่า Az/El/Range ของทุกดวงเปลี่ยนทุกรอบ), Event list 55 ครั้ง (นับถอยหลัง AOS/LOS ของทุกดวงลดลงตามเวลา เช่น BEESAT-1 32:09 เป็น 31:53)
ภาพ: `02-new-module-dialog.png`, `02-properties-layout-wide.png`, `02-wide-a.png`, `02-wide-b.png`

### 3. ความแม่นยำ (integration กับ GMAT จริง)

```bash
cd api-interop/gpredict-web/server
GMAT_BIN=/Users/phuwish/SSSGMAT/application/bin/GmatConsole ../.venv/bin/python -m unittest tests.test_integration_gmat -v
```

`Ran 7 tests in 3.4s  OK` (ไม่ข้าม) ช่วง 16 ชั่วโมงทุก 30 วินาทีผ่าน EphemManager เทียบกับ GMAT ทุก 1 วินาทีในช่วง 2 ชั่วโมง (7201 จุดต่อดาว)

| ดาว | ตำแหน่งสูงสุด (เกณฑ์ 10 ม.) | Az (เกณฑ์ 0.01°) | El (เกณฑ์ 0.01°) | range rate (เกณฑ์ 0.1 ม./วินาที) |
|---|---|---|---|---|
| ISS (El −86.77 ถึง 48.05, 642 จุดที่ El > 0) | 4.4910 ม. | 3.59e-04° | 9.63e-05° | 2.89e-02 |
| GEO (El 73.87 ถึง 73.88) | 0.0009 ม. | 2.73e-09° | 1.27e-09° | 8.47e-09 |
| Molniya (El 29.08 ถึง 31.89) | 0.2561 ม. | 2.18e-07° | 1.18e-07° | 9.05e-05 |

AOS/LOS ของ pass แรกของ ISS ที่ THBK (AOS 04:36:52.646, LOS 04:47:34.541, El สูงสุด 48.05°) คลาดจาก GMAT 1 วินาที: AOS 0.0016 วินาที, LOS 0.0022 วินาที (เกณฑ์ 1 วินาที)

### 4. Time Controller

ทำใน module `Amateur` (99 ดวง) ผ่านเมนู Module menu → Time Controller (หน้าต่าง "Time Controller / Amateur", Play forward ถูกเลือกตอนเปิด ป้าย "Real-Time")

- ตั้ง Throttle 50 (พิมพ์ในช่อง) ป้ายเปลี่ยนเป็น "Simulated Real-Time": วัดจากนาฬิกาของ server ผ่าน API 5.00 วินาทีจริง เวลา module เดิน +250.30 วินาที = **50.01 เท่า**
- Play backwards ที่ throttle 50: วัดได้ −250.37 วินาที ใน 5.00 วินาที = **−50.03 เท่า** ป้าย "Simulated Real-Time" (ในหน้าเว็บหัว module เดินถอยหลังจาก 18:25:15 เหลือ 18:19:56 ใน 7 วินาที)
- Stop: ป้ายเป็น "Manual Control" เวลานิ่ง ช่องวันที่และเวลาแก้ได้ หัว module ตามเวลาที่หยุดภายใน 0.4 วินาที
- ตั้งเวลาไปอีก 3 วัน (กดวันที่ 14 พฤศจิกายนในปฏิทิน จาก 11 พฤศจิกายน 18:18:22) เห็น overlay "กำลังคำนวณวงโคจรด้วย GMAT…" ขึ้นหลังกด 339 ms
  คงอยู่ราว 16.8 วินาที (GMAT คำนวณ 99 ดวง) แล้วหน้าจอกลับมาแสดงผล หัว module เป็น 2026/11/14 18:18:22 Map, Polar, Single sat แสดงค่าของวันที่ 14
- Reset: ป้ายกลับเป็น "Real-Time" ปุ่ม Play forward ถูกเลือก เวลากลับเป็นเวลาจริงทันที (ช่วงเดิมยังอยู่ใน cache จึงไม่มี overlay) ปิดหน้าต่างแล้ว throttle กลับเป็น 1
- ไม่มี error ใน console ของ browser

ภาพ: `04-tc-opened.png`, `04-tc-forward50.png`, `04-tc-backward50.png`, `04-tc-stopped.png`, `04-overlay-computing.png`, `04-3days-ahead.png`, `04-tc-reset.png`

### 5. ปิดแล้วเปิดใหม่

ก่อนปิด: ลากแท็บ `Accept2` ไปหน้า `Amateur` ด้วย DragEvent จำลองบนแท็บจริงใน headless Chrome (ลำดับ `Accept2, Amateur`), เพิ่มสถานี `HOME` (Chiang Mai, 18.7883°N 98.9853°E, 310 ม., locator NK98ls) ผ่าน Edit ground station data
แล้วใช้ Configure ของ `Accept2` ให้ใช้สถานี HOME ปิดด้วย File → Quit (หน้าเว็บแสดง "Gpredict Web ปิดแล้ว", `POST /api/quit` ตอบ 204, port 8740 ว่าง)
เปิด server ใหม่ด้วย `--data` เดิม และเปิด browser ตัวใหม่ (ไม่มีข้อมูลค้างใน browser)
เทียบสถานะก่อนและหลัง (`/api/modules`, `/api/qth`, config ของแต่ละ module, แท็บในหน้าเว็บ): **เหมือนกันทุกค่า**
แท็บ `Accept2, Amateur`, สถานี `HOME` และ `THBK` (ตั้งต้น THBK), `Accept2` ใช้สถานี HOME (แผนที่แสดง "HOME · Chiang Mai, Thailand") ภาพ: `05-before-restart.png`, `05-quit.png`, `05-after-restart.png`
การเปิดครั้งที่สองไม่ขอ CelesTrak (ใช้ `celestrak_state.json` เดิม)

### 6. ป้ายเมนู ปุ่ม คอลัมน์ เทียบกับรายการอ้างอิง

ไล่ทุกเมนู popup dialog และคอลัมน์ในหน้าเว็บจริงเทียบกับ `docs/2026-11-11-gpredict-reference.md` **ไม่พบจุดที่ไม่ตรง** ส่วนที่ต่างและติดป้าย "ของเรา" ใน spec คือข้อความภาษาไทย ปุ่ม Retry และ overlay,
Online help ที่ชี้ไป README นี้, "About Gpredict Web", การไม่มี News, หน้าต่าง "Overwrite module"

เทียบด้วยโปรแกรม (วิเคราะห์ตารางในรายการอ้างอิงแล้วเทียบกับ DOM จริง): List View 27 คอลัมน์ (ชื่อ, hint, ค่าตั้งต้นที่แสดง) ตรง 27/27, Single Sat View 23 ช่อง ตรง 23/23,
layout preset 0 ถึง 8 (ชื่อและ code) ตรง 9/9

ที่ไล่ด้วยตา (ภาพ `06-*.png`): menu bar File/Edit/Help (ป้าย ลำดับ คีย์ลัด Ctrl+N/O/L/Q และ F1, ตัวคั่น, รายการที่กดไม่ได้พร้อม tooltip ภาษาไทยบอกงานย่อย),
Module menu 12 รายการตามลำดับ (Autotrack ติ๊กได้, Select satellite ได้รายการดาวเรียงตามชื่อ), popup ของ List, Event list, Map (Highlight footprint ติ๊กตั้งต้น, Ground Track ไม่ติ๊ก),
Polar (Sky track กดไม่ได้สำหรับดาว GEO ES'HAIL 2), Single sat (ชื่อตัวหนา, รายการ pass, radio ของดาว), "Show current pass" ปรากฏเฉพาะดาวที่ El > 0,
dialog ทั้งหมด: Create new module / Edit module (Module name, Ground station เรียงตามชื่อ แล้ว `** DEFAULT **`, Add, Satellites, ช่องค้นหา, กลุ่ม, Available/Selected Satellites + Catnum, ` --> `, ` <-- `, ข้อความ "Double click…", Properties/Cancel/OK, tooltip ทุกช่อง),
Module properties 6 แท็บ (Layout, Refresh Rates, List View, Map View, Polar View, Single Sat View พร้อม label ช่วง หน่วย ค่าตั้งต้น และ tooltip ของปุ่ม Reset ที่ Map View ใช้ถ้อยคำของตัวเอง),
Edit ground station data (ทุกช่อง ความยาวสูงสุด ช่วง tooltip), Select a module (คอลัมน์ "Module"), Clone Module, ยืนยัน Delete ("This operation will permanently delete Accept2 from the disk.\nDo you want to proceed?"),
"There is already a module called AmCopy.\nDo you want to overwrite this module?", "Please select at least one satellite from the list.", Time Controller ทุก label tooltip ช่วงและลำดับปุ่มแถวล่าง, TLE Update

ผลของ Edit → Update TLE data from network (ครั้งเดียวของการตรวจรับ ตอน 2026-11-11T18:29:22Z): dialog "TLE Update" แสดง "Updating TLE files from network" แล้ว
"Satellites updated: 755 / Satellites skipped: 87 / Missing Satellites: 0" และ "Finished" ใช้เวลา 8 วินาที ขอ CelesTrak 9 กลุ่ม (cubesat, galileo, glo-ops, gps-ops, iridium-NEXT, science, last-30-days, visual, weather)
กลุ่ม `amateur` ถูกข้ามเพราะขอไปเมื่อ 18:12:06Z ยังไม่ครบ 2 ชั่วโมง (ข้อความภาษาไทยต่อท้าย) ไม่มีกลุ่มใดถูกขอซ้ำภายใน 2 ชั่วโมง

สังเกตเพิ่ม (ไม่ใช่ข้อที่ไม่ตรงกับรายการอ้างอิง): ตาราง Event list ใน layout "All views (wide)" กว้างกว่าช่องเมื่อหน้าต่างแคบกว่าราว 1530 px (ดูข้อจำกัด)

### 7. test ของ engine

`cd api-interop/gnss-predict && python3 -m unittest discover -s tests` ได้ `Ran 498 tests in 6.7s  OK` เมื่อเทียบกับจุดแตกของ branch (`45f224f`)
ไม่มี test เดิมถูกแก้เนื้อหา: มีเฉพาะ test ใหม่ที่เพิ่ม (`test_astro.py`, fixture `ecef_2sat.script` และ test ใหม่ใน `test_geometry.py`, `test_omm.py`, `test_propagate.py`, `test_sp3.py`)
และบรรทัด import ของ `test_geometry.py` กับ `test_omm.py` ที่ต่อชื่อเพิ่ม

### test ครบสามชุดตอนจบ

| ชุด | คำสั่ง | ผล |
|---|---|---|
| engine | `python3 -m unittest discover -s tests` | 498 test OK |
| server | `GMAT_BIN=… ../.venv/bin/python -m unittest discover -s tests` | 334 test OK (รวม integration กับ GMAT จริง 7 test) |
| web | `npm test` | 42 ไฟล์ 535 test OK |
| web | `npm run build` | สำเร็จ (91 modules, `dist/assets/index-DFTLBFal.js` 296.69 kB) |
