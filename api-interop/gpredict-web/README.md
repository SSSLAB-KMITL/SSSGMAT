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
- [2026-11-12-gpredict-web-passes-design.md](docs/2026-11-12-gpredict-web-passes-design.md): spec ของงานย่อยที่ 2 (Pass predictions)
- [2026-11-12-gpredict-web-passes-plan.md](docs/2026-11-12-gpredict-web-passes-plan.md): แผนการทำงานของงานย่อยที่ 2
- [2026-11-12-gpredict-reference-passes.md](docs/2026-11-12-gpredict-reference-passes.md): ชื่อหน้าต่าง คอลัมน์ ข้อความ และค่าตั้งต้นของส่วน Pass predictions และ Preferences → Predict ที่ตรวจกับ source code

## งานย่อยที่ 1 (Tracking core) มีอะไรบ้าง

- Module (แท็บ) หลายตัว ลากแท็บสลับลำดับได้ เปิดครั้งแรกได้ module `Amateur` ที่สถานี THBK (กรุงเทพ) ใน layout preset 0
- View ครบ 5 แบบ: Map, Polar, List (27 คอลัมน์), Single sat (23 ช่อง), Event list ("Upcoming passes")
- Layout 9 แบบตามที่ Gpredict มี และ Custom (พิมพ์ layout code เอง)
- Time Controller: ปฏิทิน, Hour/Min/Sec/Msec, Throttle 1 ถึง 100, slider, Reset, Play backwards, Stop, Play forward
- สร้าง แก้ โคลน ลบ module, Module properties ทั้ง 6 แท็บ, ตั้งค่าสถานี (QTH) ได้หลายสถานี
- ช่วงคำนวณของ GMAT พร้อม cache รายดวง และ interpolation (ดูผลวัดความแม่นในหัวข้อ "ผลตรวจรับงานย่อยที่ 1")
- เมนูคลิกขวาของดาวใน List, Map, Polar, Event list และปุ่มใน Single sat: Highlight footprint, Ground Track, Sky track, เลือกดาว
- Edit → Update TLE data from network (ใช้ cache ร่วมกับ GNSS Studio: ขอ CelesTrak ไม่เกิน 1 ครั้งต่อกลุ่มต่อ 2 ชั่วโมง)

## งานย่อยที่ 2 (Pass predictions) มีอะไรบ้าง

pass ทุกรอบหาจากตำแหน่งที่ GMAT คำนวณ (ephemeris รายวันของแต่ละดาว ทุก 30 วินาที) ไม่ใช้ SGP4 ของ Gpredict
ป้าย ชื่อหน้าต่าง คอลัมน์ และข้อความตรงกับ [รายการอ้างอิงส่วน Pass predictions](docs/2026-11-12-gpredict-reference-passes.md)

### วิธีใช้

- **Show next pass, Show current pass, Future passes**: คลิกขวาที่ดาวใน List, Map, Polar, Event list หรือเมนูของ Single sat
  - "Show current pass" มีในเมนูเฉพาะเมื่อดาวอยู่เหนือขอบฟ้า (El > 0) และค้นแบบเดียวกับ Show next pass (เหมือน Gpredict)
  - Show next pass ขณะดาวอยู่เหนือขอบฟ้าได้ pass ถัดจาก pass ที่กำลังผ่าน (เริ่มค้นที่ LOS + 0.007 วัน)
  - เวลาเริ่มคือเวลาของ module (ตาม Time Controller) หรือเวลาของเครื่องเมื่อเปิด "Always use real time for pass predictions"
  - ระหว่างรอ GMAT (เกิน 0.5 วินาที) มีกล่อง "กำลังคำนวณวงโคจรด้วย GMAT…" พร้อม Cancel **(ของเรา)** ถ้า GMAT ล้มเหลวกล่องนี้แสดง error พร้อม Retry
  - ดาวที่ขึ้นเหนือขอบฟ้าของสถานีไม่ได้ (GEO, decayed, วงโคจรไปไม่ถึงละติจูดของสถานี) และดาวที่ไม่มี pass ในช่วง ได้กล่องข้อความของ Gpredict
- **Pass details** ("Pass details for <ดาว> (orbit <n>)"): แท็บ Data (19 คอลัมน์ เลือกที่แสดงได้ที่ Preferences → Predict → Single Pass), Polar, Az/El
  และปุ่ม Print, Save, Close
- **Upcoming passes** ("Upcoming passes for <ดาว>"): สูงสุด "Number of passes to predict" (ตั้งต้น 10) pass ที่ Max El ไม่ต่ำกว่า "Minimum elevation" (5°)
  ภายใน "Passes should occur within" (3 วัน) ช่วงวันเลื่อนตาม pass แบบ Gpredict pass สุดท้ายจึงเริ่มหลังช่วงได้
  ดับเบิลคลิกแถว, Enter หรือคลิกขวา → Show details เปิด Pass details ของแถวนั้น ปิด Upcoming passes แล้วหน้าต่าง Pass details ที่เปิดจากมันปิดตาม
  Print ของหน้าต่างนี้ไม่ทำอะไร (Gpredict ก็ไม่ทำ)
- **Save**: ได้ไฟล์ `.txt` รูปแบบเดียวกับ Gpredict ทุกช่องว่าง ลงโฟลเดอร์ดาวน์โหลดของ browser (หน้าเว็บเลือกโฟลเดอร์ไม่ได้)
  ชื่อตั้งต้น `<ดาว>-<orbit>` และ `<ดาว>-passes` (ช่องว่างเป็น `-` เครื่องหมายเป็น `_`)
  เนื้อหา: "Info+header+data", "Header + data", "Data only" (pass เดียว) หรือ "Complete report", "Summary" (รายการ pass)
- **Print** ของ Pass details: หน้าต่างพิมพ์ของ browser หน้า A4 มีแถบหัวสีเทา (ชื่อหน้าต่างและเลขหน้า n/N) แล้วตารางของ pass หน้าละ 50 บรรทัด
- **Sky at a glance** (Module menu): แท่ง pass ของทุกดาวใน module ภายใน 8 ชั่วโมง (ตั้งได้ 1–24) เรียงตามชื่อดาว สีตาม Preferences
  คลิกแท่งเปิด Pass details ของ pass นั้น เวลาของ module เปลี่ยนเกินราว 1 นาที (เช่นเลื่อนด้วย Time Controller) แล้วกราฟวาดใหม่
  หน้าต่างนี้ไม่รอ GMAT: ระหว่างคำนวณแสดง "กำลังคำนวณวงโคจรด้วย GMAT…" (module `Amateur` 99 ดวง ครั้งแรกใช้ราว 78 วินาที ครั้งต่อไปใช้ข้อมูลใน cache)
- **Preferences** (Edit → Preferences): หน้าต่าง "GPREDICT Preferences :: Predict" เปิดที่กลุ่ม Predict มี 4 หน้า Pass Conditions, Multiple Passes,
  Single Pass, Sky at a Glance แต่ละหน้ามีปุ่ม Reset OK บันทึก Cancel ทิ้ง Reset แล้ว OK ลบ key ของหน้านั้นออกจาก `preferences.json`
  (กลับไปใช้ค่าตั้งต้นของ Gpredict) ค่าใหม่ใช้กับคำขอ pass ครั้งถัดไปทันที

คำขอ pass หนึ่งครั้งให้ GMAT คำนวณดาวดวงนั้นตั้งแต่ 1 วันก่อนเวลาเริ่มถึง 1 วันหลังช่วงที่ค้น (ตั้งต้นรวม 6 วัน ISS ใช้ราว 1.5 วินาที)
แล้วเก็บเป็น block รายวันใน `ephem/day/` คำขอต่อไปที่ใช้วันเดียวกันไม่ต้องรอ GMAT

### API ที่เพิ่ม

| Method | Path | ทำอะไร |
|---|---|---|
| GET | `/api/prefs` | `{values, defaults, user}`: ค่าที่ใช้อยู่ ค่าตั้งต้น และรายชื่อ key ที่ผู้ใช้ตั้งเอง |
| PUT | `/api/prefs` | `{"set": {...}, "remove": [...]}` ตรวจทุก key ก่อนเขียน ผิดตัวเดียวไม่เขียนเลย |
| POST | `/api/modules/{name}/passes` | `{"norad", "kind": "next" \| "current" \| "future" \| "at", "t", "aos", "los"}` รอ GMAT แล้วตอบ `pass`, `passes` หรือ `message` (`aos` และ `los` ใช้กับ `at` เท่านั้น `los` ไม่บังคับ: ส่งมาแล้วใช้ข้อมูลวันของ AOS ถึงวันของ LOS ไม่ส่งใช้ 1 วันก่อนถึง 1 วันหลัง AOS) |
| GET | `/api/modules/{name}/skyglance?t=` | Sky at a glance ตอบทันที `status` เป็น `computing`, `ok` หรือ `failed` (หน้าเว็บถามซ้ำทุก 1 วินาที) |
| DELETE | `/api/modules/{name}/skyglance` | ปิดหน้าต่าง Sky at a glance: ปล่อยงาน GMAT ที่ค้างของหน้าต่างนั้น |

## รายการที่กดไม่ได้ (อยู่ในงานย่อยถัดไป)

รายการเหล่านี้แสดงตามตำแหน่งของ Gpredict แต่กดไม่ได้ และมี tooltip ภาษาไทยบอกว่าอยู่ในงานย่อยไหน

| ที่อยู่ | รายการ | งานย่อย |
|---|---|---|
| File | Log browser | 4 (Data & Preferences) |
| Edit | Update TLE data from local files | 4 (Data & Preferences) |
| Edit | Update transponder data | 3 (Radio & Rotator) |
| Edit → Preferences | กลุ่ม General และ Modules | 4 |
| Edit → Preferences | กลุ่ม Interfaces | 3 |
| Module menu | Detach module, Full screen | 4 |
| Module menu | Radio Control, Antenna Control | 3 |
| คลิกขวาที่ดาว (List, Map, Polar) และเมนูของ Single sat, Event list | Satellite info (หรือชื่อดาวตัวหนา) | 4 |
| ดับเบิลคลิกที่ดาว (List, Map, Polar, Event list) | Satellite info | 4 |
| Module properties | สี, Select map, Window Placements | 4 |

Help ไม่มี News (ของเรา) และ "About Gpredict Web" เป็นของเรา
Preferences เปิดที่กลุ่ม Predict จนกว่างานย่อยที่ 4 จะมีกลุ่ม General (Gpredict เปิดที่ General)

## สิ่งที่ต้องมี

ทดสอบบน macOS เท่านั้น (Apple silicon) ยังไม่ได้ลอง Linux หรือ Windows

- Python 3 ทดสอบกับ 3.14.6 (รุ่นต่ำสุดที่ใช้ได้ยังไม่ได้ตรวจ) ตัว engine `gnss_predict` ใช้ standard library ล้วน ส่วน server ใช้ `fastapi`, `uvicorn`, `websockets`
  และ `httpx2` (ใช้เฉพาะตอนรัน test: `TestClient` ของ FastAPI) ดู `server/requirements.txt`
- Node.js และ npm ทดสอบกับ Node.js v26.3.0 (รุ่นต่ำสุดที่ใช้ได้ยังไม่ได้ตรวจ) สำหรับ build หน้าเว็บ (React, TypeScript, Vite)
- GMAT R2026a ที่ build แล้ว: ต้องมี `GmatConsole` (ค่าตั้งต้นคือ `application/bin/GmatConsole` ของ repo หรือชี้ด้วย `GMAT_BIN`)
  ขั้นตอน build GMAT อยู่ใน [`api-interop/gnss-predict/README.md`](../gnss-predict/README.md) หัวข้อ "Build GMAT"
  ถ้าไม่เจอ GMAT หน้าเว็บจะแสดงข้อความว่าไม่พบ GMAT แทนค่าของดาว
- อินเทอร์เน็ตสำหรับดึง TLE จาก CelesTrak ครั้งแรก (ไม่มีเน็ตก็ใช้ไฟล์ใน cache ได้ถ้ามี)
- Browser รุ่นปัจจุบัน หน้าจอกว้างอย่างน้อย 1024 px (ไม่มี layout สำหรับมือถือ)

## ติดตั้ง

**ทุกคำสั่งในไฟล์นี้เริ่มจาก root ของ repo** (โฟลเดอร์ที่มี `License.txt`) แต่ละบล็อกเขียน `cd` นับจาก root เอง
บล็อกที่มีหลายโฟลเดอร์ใช้ `( cd … && … )` เพื่อไม่ให้ `cd` ของบรรทัดหนึ่งพาบรรทัดถัดไปไปผิดโฟลเดอร์
ถ้าจะรันหลายบล็อกต่อกัน ให้กลับมาที่ root ก่อนทุกบล็อก

```bash
# 1. Python virtual environment และ library ของ server
python3 -m venv api-interop/gpredict-web/.venv
api-interop/gpredict-web/.venv/bin/pip install -r api-interop/gpredict-web/server/requirements.txt

# 2. library ของหน้าเว็บ แล้ว build เป็น web/dist (server เสิร์ฟโฟลเดอร์นี้)
( cd api-interop/gpredict-web/web && npm install && npm run build )
```

`web/dist/`, `.venv/`, `web/node_modules/` และ `data/` ไม่ถูกเก็บใน git ต้องทำขั้นตอนข้างบนเองหลัง clone

## วิธีรัน

```bash
( cd api-interop/gpredict-web/server && ../.venv/bin/python -m gpredict_web )
```

แล้วเปิด <http://127.0.0.1:8740> (ใช้ `localhost` หรือ `[::1]` แทนได้)

process เดียวเสิร์ฟทั้ง API (`/api`), WebSocket (`/ws`) และหน้าเว็บ (`web/dist`) หยุดได้ด้วย File → Quit ในหน้าเว็บ หรือ Ctrl+C

ตัวอย่างที่ระบุ GMAT เองและใช้ OMM cache ร่วมกับ GNSS Studio

```bash
( cd api-interop/gpredict-web/server && \
  GMAT_BIN=/path/to/GmatConsole \
  GNSS_STUDIO_DATA=/path/to/api-interop/gnss-predict/data \
  ../.venv/bin/python -m gpredict_web --data /path/to/my-gpredict-data )
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

server กันหน้าเว็บอื่นที่เปิดอยู่ใน browser ของคุณ (เช่นเว็บที่ไม่ไว้ใจ) ไม่ให้สั่ง server นี้ โดยตรวจดังนี้

- **Host** ตรวจทุกคำขอและทุก WebSocket: ต้องเป็นชื่อเครื่องตัวเอง (`localhost`, `127.0.0.1`, `::1`) หรือค่าของ `--host` ไม่งั้นตอบ 403 `FORBIDDEN_HOST`
- **Origin** ตรวจเฉพาะคำขอที่ไม่ใช่ GET, HEAD, OPTIONS (เช่น PUT, POST, DELETE) และ WebSocket: ต้องเป็นชื่อกลุ่มเดียวกัน ไม่งั้นตอบ 403 `FORBIDDEN_ORIGIN`
  (WebSocket ถูกปิดด้วย code 1008) คำขอที่ไม่มี Origin เช่น `curl` ผ่าน

ให้เครื่องอื่นในเครือข่ายใช้: เริ่ม server ด้วย `--host <IP ของเครื่องที่รัน server>` เช่น `--host 192.168.1.20`
แล้วเปิด `http://<IP นั้น>:8740` จากอีกเครื่อง `--host 0.0.0.0` ไม่พอ เพราะเครื่องอื่นจะเปิดด้วย IP จริง ซึ่งไม่ตรงกับ `0.0.0.0` จึงถูกปฏิเสธ

### ข้อมูลที่เก็บ (`--data`)

| ไฟล์ | เนื้อหา |
|---|---|
| `qth/*.json` | สถานี (QTH) |
| `modules/*.json` | module แต่ละตัว |
| `session.json` | module ที่เปิดอยู่และลำดับแท็บ |
| `settings.json` | สถานีตั้งต้น (`** DEFAULT **`) และธง `bootstrap_done` (สร้าง `Amateur` แล้ว) |
| `satdb.json` | ดัชนีดาวจาก CelesTrak |
| `ephem/` | ephemeris cache ของ GMAT รายดวงต่อช่วง (ช่วงที่เก่ากว่า 7 วันถูกลบเอง ช่วง 99 ดวงใช้ราว 9 MB) |
| `ephem/day/<YYYYMMDD>/` | ephemeris รายวันของ GMAT สำหรับ pass: 1 ไฟล์ต่อดาวต่อวัน (138,288 ไบต์) โฟลเดอร์ของวันที่เก่ากว่า 7 วันถูกลบเอง ตอนตรวจรับ 98 ดวง × 3 วันใช้ราว 40 MB |
| `preferences.json` | ค่า Preferences ที่ผู้ใช้ตั้ง เก็บเฉพาะ key ที่ตั้งเอง (`{"version": 1, "values": {...}}`) ไม่มีไฟล์หรือ `values` ว่าง = ค่าตั้งต้นของ Gpredict ทั้งหมด ไฟล์ที่แก้ด้วยมือจนบาง key ผิด: server ใช้ค่าตั้งต้นแทน key นั้นและบันทึก log (ไม่แก้ไฟล์) |

เปิดครั้งแรกที่ยังไม่มีข้อมูล: สร้างสถานี THBK, ดึงกลุ่ม `amateur` จาก CelesTrak หนึ่งครั้ง แล้วสร้างและเปิด module `Amateur`
สร้าง `Amateur` ในการเปิดครั้งแรกที่มีข้อมูล TLE เท่านั้น และไม่สร้างอีกเมื่อสร้างแล้ว (ธง `bootstrap_done` ใน `settings.json`)
ถ้าลบ module หมด ครั้งหน้าก็ไม่มี module ตามที่ลบไว้
ถ้าดึงไม่ได้และไม่มี cache (เช่นเปิดครั้งแรกตอนไม่มีเน็ต) จะไม่สร้าง module, ไม่ตั้งธง และบอกให้ใช้ Edit → Update TLE data from network
การเปิดครั้งถัดไปที่มี TLE ก็จะสร้าง `Amateur` ให้

### พัฒนา

```bash
# เปิดสอง terminal (ทั้งสองบล็อกเริ่มจาก root ของ repo)

# terminal 1: server (reload เมื่อแก้โค้ด)
( cd api-interop/gpredict-web/server && ../.venv/bin/uvicorn gpredict_web.app:app --reload --port 8740 )

# terminal 2: หน้าเว็บ (Vite proxy /api และ /ws ไป 8740)
( cd api-interop/gpredict-web/web && npm run dev )
```

เปิด <http://localhost:5173> (หน้าของ Vite) ไม่ใช่ 8740
File → Quit ใช้ไม่ได้ในโหมดนี้: server ที่รันด้วย `uvicorn` โดยตรงไม่มีตัวหยุดตัวเอง `POST /api/quit` ตอบ 409 `QUIT_UNAVAILABLE`
และหน้าเว็บแสดงข้อความนั้นแทนหน้า "ปิดแล้ว" (หยุดด้วย Ctrl+C)

## วิธีทดสอบ

มีสามชุด รันแยกกัน ตั้ง `GMAT_BIN` ถ้า build GMAT ไม่ได้อยู่ที่ `application/bin/GmatConsole`
(ทุกบรรทัดเริ่มจาก root ของ repo และอยู่ใน `( … )` จึงรันต่อกันได้โดยไม่ต้องกลับ root)

```bash
# 1. engine (gnss_predict)
( cd api-interop/gnss-predict && python3 -m unittest discover -s tests )

# 2. server (รวม integration กับ GMAT จริง ซึ่งข้ามเมื่อหา GmatConsole ไม่เจอ)
( cd api-interop/gpredict-web/server && GMAT_BIN=/path/to/GmatConsole ../.venv/bin/python -m unittest discover -s tests )

# 3. หน้าเว็บ (Vitest) และ build
( cd api-interop/gpredict-web/web && npm test && npm run build )
```

ความแม่นของ interpolation และ AOS/LOS เทียบกับ GMAT ที่รันทุก 1 วินาที (ISS, ดาว GEO, ดาว Molniya ช่วง 2 ชั่วโมง)
รันเฉพาะชุดนี้และดูตัวเลขที่วัดได้ด้วย

```bash
( cd api-interop/gpredict-web/server && \
  GMAT_BIN=/path/to/GmatConsole ../.venv/bin/python -m unittest tests.test_integration_gmat -v )
```

Pass predictions กับ GMAT จริงผ่าน API ของแอป (งานย่อยที่ 2): Future passes ของ ISS ที่ THBK 3 วันเทียบกับ GMAT ที่รันอีกครั้งทุก 1 วินาที
(AOS/LOS ไม่เกิน 1 วินาที, Max El ไม่เกิน 0.01°) และ Sky at a glance ของ module 10 ดวง (TLE จริงของกลุ่ม amateur ที่คัดลอกไว้ใน test ไม่ใช้เน็ต)

```bash
( cd api-interop/gpredict-web/server && \
  GMAT_BIN=/path/to/GmatConsole ../.venv/bin/python -m unittest tests.test_integration_passes -v )
```

## รหัส error ที่เพิ่มจาก spec หัวข้อ 7.4

spec หัวข้อ 7.4 กำหนดรหัสไว้ชุดหนึ่ง (`QTH_INVALID`, `MODULE_INVALID`, `NOT_FOUND`, `IN_USE`, `GMAT_FAILED`, `TLE_OLD` ฯลฯ)
ตอนทำจริงมีรหัสเพิ่มอีกเก้าตัวนี้ ทุกตัวตอบเป็น `{code, level, text, object}` เหมือนกัน `text` เป็นภาษาไทย

| รหัส | HTTP / ที่แสดง | ความหมาย |
|---|---|---|
| `REQUEST_INVALID` | 422 (405 เมื่อ route ไม่รองรับ method นั้น) | ข้อมูลที่ส่งมาอ่านไม่ได้หรือผิดชนิดตาม route: ไม่ใช่ JSON, body ไม่ใช่ JSON object, ค่าใน path หรือ query ผิดชนิด `object` คือชื่อช่อง (ถ้ารู้) |
| `CLOCK_INVALID` | 422 | ตั้งนาฬิกาของ module ไม่ได้: state หรือ throttle ผิดรูปแบบ, throttle นอก 1 ถึง 100, เวลาไม่ใช่ ISO 8601 ที่มี timezone หรืออยู่นอก 1957-10-04 ถึง 2100-12-31 UTC |
| `FORBIDDEN_HOST` | 403 (WebSocket ปิดด้วย 1008) | Host ของคำขอไม่ใช่ `localhost`, `127.0.0.1`, `::1` หรือค่าของ `--host` (กัน DNS rebinding) |
| `FORBIDDEN_ORIGIN` | 403 (WebSocket ปิดด้วย 1008) | Origin ของคำขอที่ไม่ใช่ GET, HEAD, OPTIONS หรือของ WebSocket ไม่ใช่ชื่อเดียวกับข้างบน (กันหน้าเว็บอื่นสั่ง server) |
| `TLE_UPDATE_NEEDED` | warning ใน `messages` ของ `GET /api/modules` (ไม่ใช่ HTTP error) | เปิดครั้งแรกแล้วยังไม่มีข้อมูลดาวกลุ่ม amateur (ไม่มีเน็ตและไม่มี cache) จึงไม่ได้สร้าง `Amateur` ให้กด Edit → Update TLE data from network |
| `INTERNAL` | 500 | server เกิดข้อผิดพลาดที่ไม่คาดไว้ รายละเอียดอยู่ใน log ของ server |
| `SAT_STATE_INVALID` | warning ใน `messages` ของ tick, `object` = NORAD | ตำแหน่งและความเร็วที่ได้จาก GMAT ไม่ใช่วงโคจรรอบโลก ดาวดวงนั้นถูกข้ามใน tick นั้น |
| `TLE_CONVERT_FAILED` | warning ใน `messages` ของ `POST /api/tle/update`, `object` = ชื่อกลุ่ม | แปลง OMM ของบางดวงเป็น TLE ไม่ได้ ข้ามดวงเหล่านั้น |
| `QUIT_UNAVAILABLE` | 409 | `POST /api/quit` แต่ server ไม่ได้เริ่มด้วย `python -m gpredict_web` (เช่นรันด้วย `uvicorn` ตอนพัฒนา) จึงไม่มีตัวหยุดตัวเอง |

นอกจากนี้ `QTH_INVALID` ยังใช้เป็น warning ใน `messages` ของ `GET /api/qth` (`object` = ชื่อไฟล์ เช่น `Broken.json`)
เมื่อไฟล์ใน `qth/` ใช้ไม่ได้: server ข้ามไฟล์นั้นและรายการสถานีที่เหลือยังใช้ได้

### รหัสที่เพิ่มในงานย่อยที่ 2 (spec หัวข้อ 9 ของงานย่อยที่ 2)

| รหัส | HTTP / ที่แสดง | ความหมาย |
|---|---|---|
| `PREFS_INVALID` | 422, `object` = key | `PUT /api/prefs` ที่มี key ที่ไม่รู้จัก ค่าผิดชนิดหรือนอกช่วง (เช่น "Minimum elevation ต้องเป็นจำนวนเต็ม 1–90") key ที่อยู่ทั้งใน `set` และ `remove` หรือ `set`/`remove` ผิดรูปแบบ ผิดตัวเดียวไม่เขียนอะไรเลย หน้าต่าง Preferences แสดงข้อความนี้และไม่ปิด |
| `PASS_INVALID` | 422, `object` = ชื่อช่อง | body ของ `POST /api/modules/{name}/passes` หรือ `t` ของ `GET …/skyglance` ผิด: `norad` ไม่ใช่จำนวนเต็ม, `kind` ไม่ใช่ `next`, `current`, `future`, `at`, เวลาไม่ใช่ ISO 8601 ที่มี timezone หรืออยู่นอกช่วงของนาฬิกา module, `los` ก่อน `aos` หรือหลัง `aos` เกิน 1 วัน |
| `PASS_NO_AOS` | `message` ระดับ error ในคำตอบ 200 ของ passes | ดาวขึ้นเหนือขอบฟ้าของสถานีไม่ได้ (GEO, decayed, mean motion 0, วงโคจรไปไม่ถึงละติจูดของสถานี) ตัดสินจาก TLE โดยไม่สั่ง GMAT |
| `PASS_NONE_WITHIN` | `message` ระดับ info ในคำตอบ 200 ของ passes | ดาวขึ้นได้แต่ไม่มี pass ที่ Max El ถึง Minimum elevation ภายใน "Passes should occur within" |

`text` ของ `PASS_NO_AOS` และ `PASS_NONE_WITHIN` เป็นข้อความภาษาอังกฤษของ Gpredict ทุกตัวอักษร (หน้าเว็บแสดงในกล่องที่มีไอคอน Error หรือ Info และปุ่ม OK)
- `Satellite %s has no passes for\nthe current ground station!\n\nThis can be because the satellite\nis geostationary, decayed or simply\nnever comes above the horizon` (Show next pass, Show current pass)
- `Satellite %s has no passes for\nthe current ground station!` (Future passes)
- `Satellite %s has no passes\nwithin the next %d days` (ทั้งสามรายการ `%d` คือ Passes should occur within)

คำขอ pass ใช้รหัสเดิมของ spec หัวข้อ 7.4 ด้วย: `NOT_FOUND` 404 (module ไม่ได้เปิด, ดาวไม่อยู่ใน module, `kind: "at"` ที่ไม่มี pass ที่ AOS นั้นภายใน 1 วินาที),
`GMAT_FAILED` 503 (GMAT ล้มเหลวหรือไม่มีตำแหน่งที่ต้องใช้) และ `SAT_MISSING_FROM_GMAT` 503 (GMAT ไม่คืนค่าของดาวนั้น)
Sky at a glance ใส่ `EPHEM_COMPUTING` (info) ใน `messages` ระหว่างรอ GMAT

## ข้อตกลงที่เปลี่ยนพฤติกรรม

ข้อตกลงที่ตัดสินระหว่างทำ ซึ่ง spec ไม่ได้ระบุหรือต่างจาก Gpredict

- **เฉพาะแท็บ (module) ที่แสดงอยู่ถือ WebSocket** module ที่เปิดอยู่แต่ไม่ได้แสดงไม่รับ tick สลับแท็บแล้ว socket เดิมถูกปิดและเปิดใหม่ให้แท็บที่แสดง
  server คำนวณ tick ของ module ก็ต่อเมื่อมี socket อย่างน้อยหนึ่งตัว
- **Online help แสดง README ในหน้าเว็บ** (Help → Online help เปิดหน้าต่างเลื่อนอ่านได้ ดึงจาก `GET /api/readme`) พร้อม path ของไฟล์เป็นข้อความธรรมดา ไม่มีลิงก์ออกนอกโปรแกรม
  Gpredict แสดงกล่องข้อความที่ลิงก์ไปเว็บของ Gpredict
- **Create new module ปฏิเสธชื่อของ module ที่เปิดอยู่** ไม่ถามเขียนทับเหมือน module ที่ปิดอยู่ ให้แก้ด้วย Module → Configure หรือปิด module ก่อน
  (ชื่อที่ต่างจาก module ที่มีอยู่แค่ตัวพิมพ์เล็ก-ใหญ่ก็ถูกปฏิเสธ เพราะดิสก์ของ macOS ไม่แยกตัวพิมพ์)
- **ตรวจ Host และ Origin** ดูหัวข้อ "เปิดให้เครื่องอื่นใน LAN ใช้" ข้างบน
- **File → Quit** หยุด server ได้เฉพาะเมื่อเริ่มด้วย `python -m gpredict_web` ไม่งั้นตอบ `QUIT_UNAVAILABLE` และหน้าเว็บแสดงข้อความนั้น

## ข้อจำกัดที่ทราบ

- งานย่อยที่ 1 และ 2 เท่านั้น: Satellite info, Radio/Antenna Control, Preferences กลุ่ม General, Modules และ Interfaces,
  Log browser, Detach/Full screen, สีและภาพแผนที่ที่เปลี่ยนได้ ยังไม่มี (ตารางข้างบน)
- เวลาใน Pass details, Upcoming passes, ไฟล์ที่ Save, หน้าพิมพ์ และ Sky at a glance เป็น UTC ในรูปแบบตั้งต้นของ Gpredict (`%Y/%m/%d %H:%M:%S`) เสมอ
  ระยะเป็นกิโลเมตร Lat/Lon มีเครื่องหมาย (Time format, local time, Imperial units และ N/S/E/W อยู่ใน Preferences → General ของงานย่อยที่ 4)
- Save ลงโฟลเดอร์ดาวน์โหลดของ browser เท่านั้น ถ้ามีไฟล์ชื่อเดิมอยู่แล้ว browser มักตั้งชื่อใหม่ให้ (เช่น Chrome ต่อท้าย ` (1)`) ส่วน Gpredict เขียนทับ
- pass ที่เริ่มหลังช่วงข้อมูลที่ขอจาก GMAT (1 วันหลังช่วงที่ค้น) ไม่ถูกนับ และ AOS/LOS/Max El เป็นค่าจริงจาก GMAT ไม่ใช่ค่าจากแถวที่สุ่มแบบ Gpredict
  ข้อที่ตั้งใจให้ต่างจาก Gpredict ทั้งหมดอยู่ใน spec ของงานย่อยที่ 2 หัวข้อ 10.1
- ไม่มีระบบ login ใช้คนเดียวบนเครื่องตัวเอง (ดูหัวข้อ LAN)
- ปุ่ม Select ของ Location และ Weather St ใน Edit ground station data กดไม่ได้ (ไม่มีรายชื่อเมืองและสถานีอากาศ) ไม่มีโหมด GPSD
  Module properties แสดง "Window Placements" ในหน้า Layout (กดไม่ได้) ทั้งที่ Gpredict แสดงเฉพาะใน Preferences รวม
- ดาวสูงสุด 200 ดวงต่อ module
- ต้องมี GMAT: เมื่อตั้งเวลาไปนอกช่วงที่คำนวณไว้ (เช่นข้ามไปอีก 3 วัน) server ต้องสั่ง GMAT คำนวณช่วงใหม่ทั้งช่วง
  ระหว่างนั้นหน้าจอถูกบังด้วย "กำลังคำนวณวงโคจรด้วย GMAT…" ตัวอย่างที่วัดได้: 99 ดวง ช่วง 16 ชั่วโมง ใช้ราว 17 วินาที
  ช่วงที่เคยคำนวณแล้วถูกเก็บใน cache จึงกลับไปเวลาเดิมได้ทันที
- การเพิ่มดาวเข้า module ที่เปิดอยู่ (Module → Configure) ก็ต้องให้ GMAT คำนวณดาวใหม่ทั้งช่วง หน้าจอของ module นั้นถูกบังด้วย
  "กำลังคำนวณวงโคจรด้วย GMAT…" จนกว่า GMAT จะคำนวณเสร็จ (ดาวที่มีค่าใน cache แล้วไม่ต้องคำนวณใหม่)
- ความแม่นขึ้นกับอายุของ TLE: ตำแหน่งที่ห่างจาก epoch ของ TLE มาก (เช่น เวลาไปอีกหลายวันข้างหน้า) คลาดเคลื่อนได้มากขึ้น
  เมื่อมีดาวที่ TLE เก่ากว่า 7 วัน หน้าเว็บแสดงข้อความเดียวในแถบข้อความใต้แท็บ เช่น "TLE ของ 12 ดวงเก่ากว่า 7 วัน: ชื่อ, ชื่อ, … (ควรอัปเดตที่ Edit → Update TLE data from network)"
  (บอกชื่อสูงสุด 5 ดวง ที่เหลือนับเป็น "และอีก N ดวง" และเห็นครบเมื่อชี้เมาส์) ปิดข้อความได้ และจะไม่ขึ้นอีกตราบที่กลุ่มดาวที่เก่ายังเหมือนเดิม
  ข้อความแบบเดียวกันมีสำหรับ "GMAT ไม่คืนค่าของ N ดวง" และ "N ดวงมีค่าวงโคจรที่ใช้ไม่ได้" (ดาวเหล่านั้นถูกข้าม)
- CelesTrak ให้ขอได้ 1 ครั้งต่อกลุ่มต่อ 2 ชั่วโมง Update TLE ที่กดซ้ำในช่วงนั้นใช้ไฟล์เดิมใน cache และบอกเป็นข้อความ
- ตรวจหน้าจอจริงด้วย Google Chrome แบบ headless เท่านั้น ยังไม่ได้ทดสอบกับ Safari และ Firefox
- View ที่อยู่ในช่องแคบมากจะมี scroll: ใน layout "All views (wide)" ช่อง Event list แคบกว่าตาราง (ต้องกว้างราว 383 px)
  เมื่อหน้าต่าง browser กว้างน้อยกว่าราว 1530 px จะเห็นคอลัมน์ AOS/LOS ต้องเลื่อนดู
- ภาพแผนที่คือ Blue Marble ของ NASA (public domain) ขนาด 1024×512 ยืดเต็ม view

## ผลตรวจรับงานย่อยที่ 1

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
( cd api-interop/gpredict-web/server && \
  GMAT_BIN=/path/to/GmatConsole ../.venv/bin/python -m unittest tests.test_integration_gmat -v )
```

(ตอนตรวจรับ `GMAT_BIN` คือ `/Users/phuwish/SSSGMAT/application/bin/GmatConsole` ซึ่งเป็น path ที่ใช้จริงบนเครื่องที่ตรวจ)

`Ran 7 tests in 3.4s  OK` (ไม่ข้าม) ช่วง 16 ชั่วโมงทุก 30 วินาทีผ่าน EphemManager เทียบกับ GMAT ทุก 1 วินาทีในช่วง 2 ชั่วโมง (7201 จุดต่อดาว)

| ดาว | ตำแหน่งสูงสุด (เกณฑ์ 10 ม.) | Az (เกณฑ์ 0.01°) | El (เกณฑ์ 0.01°) | range rate (เกณฑ์ 0.1 ม./วินาที) |
|---|---|---|---|---|
| ISS (El −86.77 ถึง 48.05, 642 จุดที่ El > 0) | 4.4910 ม. | 3.59e-04° | 9.63e-05° | 2.89e-02 |
| GEO (El 73.87 ถึง 73.88) | 0.0009 ม. | 2.73e-09° | 1.27e-09° | 8.47e-09 |
| Molniya (El 29.08 ถึง 31.89) | 0.2561 ม. | 2.18e-07° | 1.18e-07° | 9.05e-05 |

AOS/LOS ของ pass แรกของ ISS ที่ THBK (AOS 04:36:52.646, LOS 04:47:34.541, El สูงสุด 48.05°) เทียบกับ GMAT รายวินาที: AOS ต่างกัน 0.0016 วินาที, LOS ต่างกัน 0.0022 วินาที (เกณฑ์ 1 วินาที)

### 4. Time Controller

ทำใน module `Amateur` (99 ดวง) ผ่านเมนู Module menu → Time Controller (หน้าต่าง "Time Controller / Amateur", Play forward ถูกเลือกตอนเปิด ป้าย "Real-Time")

- ตั้ง Throttle 50 (พิมพ์ในช่อง) ป้ายเปลี่ยนเป็น "Simulated Real-Time": วัดจากนาฬิกาของ server ผ่าน API ในช่วงราว 5 วินาทีจริง เวลา module เดินเร็วกว่าเวลาจริง **50.01 เท่า**
  (เวลา module เดิน +250.30 วินาทีในช่วงที่วัด อัตราคำนวณจากความยาวจริงของช่วงที่จับเวลาไว้ละเอียดกว่านี้ ไม่ได้หารด้วย 5 วินาทีตัวกลม)
- Play backwards ที่ throttle 50: เวลา module ถอยหลัง **50.03 เท่า** ของเวลาจริง (วัดแบบเดียวกัน ได้ −250.37 วินาทีในช่วงราว 5 วินาที) ป้าย "Simulated Real-Time"
  (ในหน้าเว็บหัว module เดินถอยหลังจาก 18:25:15 เหลือ 18:19:56 ใน 7 วินาที)
- Stop: ป้ายเป็น "Manual Control" เวลานิ่ง ช่องวันที่และเวลาแก้ได้ หัว module ตามเวลาที่หยุดภายใน 0.4 วินาที
- ตั้งเวลาไปอีก 3 วัน (กดวันที่ 14 พฤศจิกายนในปฏิทิน จาก 11 พฤศจิกายน 18:18:22) เห็น overlay "กำลังคำนวณวงโคจรด้วย GMAT…" ขึ้นหลังกด 339 ms
  คงอยู่ราว 16.8 วินาที (GMAT คำนวณ 99 ดวง) แล้วหน้าจอกลับมาแสดงผล หัว module เป็น 2026/11/14 18:18:22 Map, Polar, Single sat แสดงค่าของวันที่ 14
- Reset: ป้ายกลับเป็น "Real-Time" ปุ่ม Play forward ถูกเลือก เวลากลับเป็นเวลาจริงทันที (ช่วงเดิมยังอยู่ใน cache จึงไม่มี overlay)
  **Reset เป็นตัวตั้ง throttle กลับเป็น 1** การปิดหน้าต่างหลังจากนั้นคงค่า throttle 1 ไว้ (ไม่ได้เป็นตัวที่ทำให้ throttle กลับเป็น 1)
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
Online help (ตอนตรวจรับบอกแค่ path ของ README นี้ ภายหลังรอบแก้จากการรีวิวทั้ง branch เปลี่ยนเป็นแสดงเนื้อหา README ในหน้าต่าง), "About Gpredict Web", การไม่มี News, หน้าต่าง "Overwrite module"

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

ตัวเลขหลังรอบแก้จากการรีวิวทั้ง branch (ผลตรวจรับข้างบนทำก่อนรอบนี้ และไม่ได้ตรวจซ้ำด้วย browser: รอบนี้แก้ server, แถบข้อความ, Online help และ Quit)

| ชุด | คำสั่ง | ผล |
|---|---|---|
| engine | `( cd api-interop/gnss-predict && python3 -m unittest discover -s tests )` | 498 test OK (ข้าม 3) |
| server | `( cd api-interop/gpredict-web/server && GMAT_BIN=… ../.venv/bin/python -m unittest discover -s tests )` | 361 test OK (รวม integration กับ GMAT จริง) |
| web | `( cd api-interop/gpredict-web/web && npm test )` | 43 ไฟล์ 553 test OK |
| web | `( cd api-interop/gpredict-web/web && npm run build )` | สำเร็จ (92 modules, JS 298.60 kB) |

## ผลตรวจรับงานย่อยที่ 2

ตรวจรับตามหัวข้อ 12 ของ [spec งานย่อยที่ 2](docs/2026-11-12-gpredict-web-passes-design.md) ด้วย GMAT จริง (`application/bin/GmatConsole`)
data dir จริงของแอป (`api-interop/gpredict-web/data`: module `Amateur` 99 ดวงที่สถานี THBK, TLE ใน `satdb.json` ที่ดึงไว้เมื่อ 2026-11-12 **ไม่ได้ขอ CelesTrak ใหม่**)
และ Google Chrome แบบ headless (ขับด้วย Chrome DevTools Protocol) build หน้าเว็บใหม่ เปิด server ด้วย `python -m gpredict_web` แล้วปิดด้วย `POST /api/quit` เมื่อจบ
วันที่ 2026-11-14 เวลาไทย 01:54 ถึง 02:06 ตรงกับ 2026-11-13 18:54 ถึง 19:06 UTC เวลาทุกค่าข้างล่างเป็น UTC
ภาพหน้าจอ สคริปต์ที่ขับ browser และไฟล์ที่ Save เก็บไว้ใน scratchpad ของ session ตรวจรับ (ไม่ได้ commit)
ค่า "GMAT รายวินาที" ได้จากการรัน GMAT อีกครั้งด้วย TLE และสถานีเดียวกับ server ทุก 1 วินาทีช่วง AOS − 120 ถึง LOS + 120 วินาที
แล้วหาเวลาที่ El ข้าม 0° แบบเชิงเส้นระหว่างวินาที และ Max El จากพาราโบลาผ่าน 3 จุดรอบค่าสูงสุด

| # | เกณฑ์ | ผล |
|---|---|---|
| 1 | คลิกขวาที่ ISS ใน Map → Show next pass ได้ Pass details ที่ชื่อ แท็บ คอลัมน์ และค่าตรงตาม ref-P, AOS/LOS ต่างจาก GMAT รายวินาทีไม่เกิน 1 วินาที | ผ่าน (AOS ต่าง 0.0070 วินาที, LOS ต่าง 0.0104 วินาที) |
| 2 | Future passes ของ ISS ไม่เกิน 10 pass ใน 3 วัน ทุก pass Max El ≥ 5°, ดับเบิลคลิกได้ Pass details, ปิดหน้าต่างแม่แล้วลูกปิดตาม | ผ่าน (10 pass, Max El 8.83° ถึง 86.85°) |
| 3 | ดาว GEO ได้ข้อความ error ของ ref-P §1.4, ดาวที่ไม่มี pass ได้ "…has no passes\nwithin the next 3 days" | ผ่าน (ข้อหลังใช้ Minimum elevation 90° ดูหัวข้อ 3) |
| 4 | Save ของทั้งสองหน้าต่างได้ `.txt` ตาม ref-P §8.3/§8.4, Print ได้หน้าพิมพ์ตาม ref-P §8.5 | ผ่าน |
| 5 | Sky at a glance ของ `Amateur` มีแท่งของทุกดาวที่มี pass ใน 8 ชม., คลิกแท่งได้ Pass details, เลื่อนเวลาเกิน 1 นาทีแล้ววาดใหม่ | ผ่านหลังแก้ข้อบกพร่อง 1 จุด (หน้าต่างถูกสร้างซ้ำเมื่อเปิด Time Controller ดูหัวข้อ 5) |
| 6 | Minimum elevation 30 แล้ว Future passes เหลือเฉพาะ Max El ≥ 30°, Reset แล้ว OK ได้ค่าตั้งต้นและ key ถูกลบจาก `preferences.json` | ผ่าน |
| 7 | test ของ engine, server และ web ผ่านทั้งหมด และ GNSS Studio ได้ผลเหมือนเดิมทุกไบต์ | ผ่าน |

ไม่มี error หรือ warning ใน console ของ browser ทุกขั้น และ log ของ server ไม่มี WARNING หรือ ERROR

### 1. Show next pass ของ ISS

18:55:06: ISS อยู่ที่ 5.00°N 52.95°W (El −73.4° จาก THBK) คลิกขวาที่จุดของ ISS ใน Map ได้เมนู "Satellite info" (กดไม่ได้), "Show next pass", "Future passes",
"Highlight footprint" (ติ๊ก), "Ground Track" (ไม่มี "Show current pass" เพราะ El < 0) กด Show next pass: กล่อง "กำลังคำนวณวงโคจรด้วย GMAT…" ขึ้นหลัง 0.5 วินาที
(GMAT คำนวณ ISS 6 วัน) และหน้าต่าง **"Pass details for ISS (ZARYA) (orbit 59494)"** ขึ้นหลัง 1.9 วินาที
แท็บ Data, Polar, Az/El คอลัมน์ตั้งต้น Time, Az, El, Range, Footp ปุ่ม Print, Save, Close มี 21 แถว (Number of entries 20 ทุก (LOS − AOS)/20 = 32.7 วินาที)
แถวแรก `2026/11/13 19:29:42 | 324.60° | 0.00° | 2356 | 4520` แถวกลาง (TCA) `19:35:09 | 54.43° | 77.58° | 432 | 4520`
แถวสุดท้าย `19:40:36 | 141.04° | -0.00° | 2361 | 4530` (El ที่ LOS ห่างจาก 0 ไม่ถึง 0.005° รูปแบบ `%.2f°` ของ Gpredict จึงพิมพ์เป็น −0.00 ได้)

| ค่า | Pass details (API) | GMAT รายวินาที | ต่าง |
|---|---|---|---|
| AOS | 19:29:42.626 | 19:29:42.619 | 0.0070 วินาที |
| LOS | 19:40:36.767 | 19:40:36.756 | 0.0104 วินาที |
| Max El | 77.5883° | 77.5883° | 2.1e-05° |

ภาพ: `01-map.png`, `02-popup.png`, `03-waiting.png`, `04-pass-details-data.png`, `05-pass-details-polar.png`, `05-pass-details-azel.png`

### 2. Future passes ของ ISS

18:56:54: คลิกขวาที่ ISS ใน Map → Future passes ได้หน้าต่าง **"Upcoming passes for ISS (ZARYA)"** ใน 0.1 วินาที (ใช้ block รายวันที่ข้อ 1 คำนวณไว้)
คอลัมน์ตั้งต้น AOS, LOS, Duration, Max El, AOS Az, LOS Az ปุ่ม Print, Save, Close มี 10 pass (Number of passes to predict) ทุก pass เริ่มก่อน 2026-11-16 18:56 (3 วัน)
ทุก pass เทียบกับ GMAT รายวินาที:

| # | AOS | LOS | Max El | AOS ต่าง (วินาที) | LOS ต่าง (วินาที) | Max El ต่าง |
|---|---|---|---|---|---|---|
| 1 | 2026-11-13 19:29:42.626 | 19:40:36.767 | 77.59° | 0.0070 | 0.0104 | 2.1e-05° |
| 2 | 2026-11-14 08:48:28.330 | 08:59:15.029 | 86.85° | 0.0061 | 0.0239 | 1.4e-03° |
| 3 | 2026-11-14 18:42:07.470 | 18:52:40.576 | 31.76° | 0.0257 | 0.0172 | 4.0e-10° |
| 4 | 2026-11-14 20:19:44.677 | 20:28:04.716 | 8.83° | 0.0277 | 0.0240 | 1.3e-08° |
| 5 | 2026-11-15 08:00:54.462 | 08:11:22.001 | 34.00° | 0.0056 | 0.0065 | 5.8e-07° |
| 6 | 2026-11-15 09:38:44.150 | 09:47:03.720 | 8.85° | 0.0092 | 0.0024 | 1.7e-08° |
| 7 | 2026-11-15 17:54:45.673 | 18:04:23.173 | 15.57° | 0.0037 | 0.0126 | 2.4e-09° |
| 8 | 2026-11-15 19:31:14.501 | 19:41:10.751 | 19.25° | 0.0091 | 0.0077 | 1.3e-08° |
| 9 | 2026-11-16 07:13:40.458 | 07:23:10.048 | 15.64° | 0.0206 | 0.0173 | 1.1e-08° |
| 10 | 2026-11-16 08:50:07.353 | 08:59:54.697 | 18.08° | 0.0189 | 0.0115 | 2.0e-07° |

(pass ที่ 2 ผ่านเกือบตรงหัว Max El จากพาราโบลาของจุดรายวินาทีจึงคลาดจากค่าจริงมากกว่า pass อื่น ยังต่ำกว่าเกณฑ์ 0.01° ของ spec หัวข้อ 11)
ดับเบิลคลิกแถวที่ 3 ได้ **"Pass details for ISS (ZARYA) (orbit 59509)"** แถวแรก `2026/11/14 18:42:07` (pass เดียวกับแถว ไม่ได้ส่งคำขอใหม่ถึง server)
ปิด "Upcoming passes for ISS (ZARYA)" แล้วหน้าต่าง Pass details ปิดตาม (ไม่เหลือหน้าต่างใด) ภาพ: `02-upcoming.png`, `04-double-click.png`, `05-parent-closed.png`

### 3. ข้อความเมื่อไม่มี pass

- ES'HAIL 2 (NORAD 43700, GEO, El 6.0° เมนูจึงมี "Show current pass" ด้วย) คลิกขวาใน Map:
  Show next pass ได้กล่องไอคอน Error ปุ่ม OK ข้อความ `Satellite ES'HAIL 2 has no passes for\nthe current ground station!\n\nThis can be because the satellite\nis geostationary, decayed or simply\nnever comes above the horizon`
  Future passes ได้ `Satellite ES'HAIL 2 has no passes for\nthe current ground station!` (server ตอบ `PASS_NO_AOS` ทันทีโดยไม่สั่ง GMAT)
- ดาวที่ไม่มี pass ใน 3 วัน: ดาวใน `satdb.json` ทุกดวงที่ขึ้นได้มี pass ใน 3 วันที่ Minimum elevation 5° (ลองดาวที่น่าจะไม่มีผ่าน API คือ PHASE 3B (AO-10) วงรีสูงและ GREENCUBE (IO-117) วงโคจร MEO
  ทั้งสองดวงมี pass) จึงตั้ง Edit → Preferences → Pass Conditions → Minimum elevation **90** แล้ว OK (`preferences.json` เป็น `{"PREDICT/MINIMUM_ELEV": 90}`)
  แล้ว ISS → Future passes และ Show next pass ได้กล่องไอคอน Info ข้อความ `Satellite ISS (ZARYA) has no passes\nwithin the next 3 days` (`PASS_NONE_WITHIN`)
  จากนั้นกด Reset แล้ว OK (key ถูกลบ ค่ากลับเป็น 5)

ภาพ: `01-geo-next.png`, `02-geo-future.png`, `03-prefs-90.png`, `04-none-future.png`, `05-none-next.png`

### 4. Save และ Print

ไฟล์ที่ได้ในโฟลเดอร์ดาวน์โหลดของ Chrome:

| ไฟล์ | จาก | กล่อง Save | เนื้อหา |
|---|---|---|---|
| `ISS-_ZARYA_-59494.txt` (1,274 ไบต์) | Pass details ข้อ 1 | "Save Pass Details" ชื่อตั้งต้น `ISS-_ZARYA_-59494`, Info+header+data | หัว 5 บรรทัด (`Pass details for ISS (ZARYA) (orbit 59494)`, `Observer: THBK, Bangkok`, `LAT:13.73 LON:100.78`, `AOS: 2026/11/13 19:29:42 UTC`, `LOS: 2026/11/13 19:40:36 UTC`) เส้นคั่น 46 ตัว หัวตาราง ` Time                  Az      El  Range Footp` และ 21 แถว |
| `ISS-_ZARYA_-passes.txt` (12,760 ไบต์) | Upcoming passes ข้อ 2 | "Save Passes" ชื่อตั้งต้น `ISS-_ZARYA_-passes`, Complete report | หัว 3 บรรทัด เส้นคั่น 97 ตัว (ยาวกว่าบรรทัดหัวตาราง 96 ตัว 1 ตัวตาม ref-P §8.4) 10 แถว (AOS, TCA, LOS เสมอ) แล้ว 10 ส่วน ` Orbit <n>` พร้อมตารางของแต่ละ pass |
| `ISS-passes-summary.txt` (1,340 ไบต์) | Upcoming passes ข้อ 2 | พิมพ์ชื่อเอง, Summary (กล่องเปิดที่ Complete report อีกครั้ง ไม่จำตัวเลือก ตาม Gpredict) | หัว 3 บรรทัดและ 10 แถว |

ตัวเลือก "File contents:" ของ Pass details คือ Info+header+data, Header + data, Data only และของ Upcoming passes คือ Complete report, Summary
แถว "Save in folder:" บอกว่าบันทึกลงโฟลเดอร์ดาวน์โหลดของ browser (ของเรา)

Print ของ Pass details: หน้าต่างพิมพ์ของ browser ไม่แสดงใน Chrome headless จึงดักการเรียก `print()` ของ frame ที่หน้าเว็บสร้าง แล้วเก็บหน้าที่จะพิมพ์ไว้ (`printed.html`)
และให้ Chrome พิมพ์เป็น PDF (`print.pdf` 1 หน้า A4): แถบหัวสีเทาขอบดำมี `Pass details for ISS (ZARYA) (orbit 59494)` ตรงกลางและ `1/1` ชิดขวา
ใต้แถบเป็นหัวตารางกับ 21 แถวของ pass แบบ monospace ไม่มีหัว 5 บรรทัดของไฟล์ (ตาม ref-P §8.5)
Print ของ Upcoming passes ไม่ทำอะไร: ไม่มี frame สำหรับพิมพ์ ไม่มีกล่องหรือหน้าต่างใหม่

### 5. Sky at a glance

- **เปิดครั้งแรก** 18:59:57: Module menu → Sky at a glance ได้หน้าต่าง **"The sky at a glance (Amateur)"** ที่แสดง "กำลังคำนวณวงโคจรด้วย GMAT…"
  GMAT คำนวณ block รายวันของ 98 ดวง (ES'HAIL 2 ขึ้นไม่ได้จึงไม่ต้องคำนวณ) 3 วัน ใช้ราว 78 วินาที หน้าเว็บถามซ้ำทุก 1 วินาที (75 ครั้ง) แล้วได้กราฟ
- **พบข้อบกพร่อง:** เปิด Time Controller ขณะหน้าต่าง Sky at a glance เปิดอยู่ แล้วหน้าต่าง Sky at a glance ถูกสร้างเพิ่มทุก tick (16 หน้าต่างในราว 4 วินาที)
  และการกดปุ่มใน Time Controller ไปโดนหน้าต่างที่ซ้อนอยู่ สาเหตุ: หน้าต่าง Sky at a glance (Task 14) และ Time Controller เป็นลูกของ element เดียวกันที่ใช้ key ของ React
  เป็นชื่อ module เหมือนกัน แก้ใน commit `fix(gpredict-web): give the sky at a glance window its own React key` (key เป็น `sky:<module>`)
  พร้อม test `web/src/appKeys.test.ts` ที่ตรวจ `App.tsx` ด้วย parser ของ TypeScript ว่าลูกของ element เดียวกันไม่มี key ซ้ำ แล้ว build หน้าเว็บใหม่และตรวจข้อนี้ใหม่ทั้งข้อ
- **หลังแก้** 19:04:33: กราฟขึ้นใน 3.3 วินาที (block อยู่ใน cache แล้ว) ขนาด 600 × 3040 (99 ดวง: 99 × 10 + 100 × 20 + 50 ตาม ref-P §7.3) T0 = เวลาของ module
  ดาวที่มี pass ใน 8 ชม. 72 ดวงได้ 72 แถวเรียงตามชื่อ (ดาวที่ไม่มี pass 27 ดวงรวม ES'HAIL 2 ไม่มีแถว) จาก 114 pass มี 99 แท่งอยู่ในกราฟ
  ตรวจสีของพิกเซลกลางทุกแท่งเทียบกับสีของดาวในคำตอบของ server: **ตรงครบ 99 แท่ง** อีก 15 pass เป็น pass สุดท้ายของดาวที่เริ่มหลังขอบขวา (กติกาเลื่อนช่วง) จึงถูกตัดเหมือน Gpredict
- คลิกแท่งของ ISS (19:29:42 ถึง 19:40:36) ได้ **"Pass details for ISS (ZARYA) (orbit 59494)"** (คำขอ `kind: "at"` AOS 2026-11-13T19:29:42.626Z: pass เดียวกับข้อ 1)
- เปิด Module menu → Time Controller ("Time Controller / Amateur") กด Stop แล้วกดลูกศรขึ้นที่ช่อง Min 2 ครั้ง: เวลาของ module จาก 19:04:38.676 เป็น 19:06:38.676
  หน้าเว็บถาม Sky at a glance ใหม่ที่เวลาของ module (T0 = 2026-11-13T19:06:38.676Z) และวาดใหม่: 74 แถว 101 แท่งในกราฟ สีตรงครบ
  กด Reset ใน Time Controller เวลากลับเป็นเวลาจริง ปิดทุกหน้าต่างแล้วไม่เหลือหน้าต่างค้าง

ภาพ: `01-waiting.png`, `02-chart.png`, `03-bar-details.png`, `04-after-time-move.png`

### 6. Preferences → Predict

19:05:25: ตอนเริ่ม `preferences.json` เป็น `{"version": 1, "values": {}}` (จาก Reset ของข้อ 3) Edit → Preferences ได้ **"GPREDICT Preferences :: Predict"**
แท็บ Pass Conditions, Multiple Passes, Single Pass, Sky at a Glance ตั้ง Minimum elevation 30 แล้ว OK: ไฟล์เป็น `{"PREDICT/MINIMUM_ELEV": 30}` และ `GET /api/prefs` บอก key นี้ใน `user`
ISS → Future passes ได้ **5 pass** (Max El 77.59°, 86.85°, 31.76°, 34.00°, 42.90° ต่ำสุด 31.76°) แทน 10 pass ของค่าตั้งต้น
เปิด Preferences อีกครั้งช่องแสดง 30 กด Reset ช่องเป็น 5 แล้ว OK: ไฟล์เป็น `{"version": 1, "values": {}}` (**key ถูกลบ**) `user` ว่าง และ Future passes กลับเป็น 10 pass ชุดเดิมของข้อ 2 (ต่ำสุด 8.83°)
ภาพ: `01-prefs-30.png`, `02-future-min30.png`, `03-prefs-reset.png`, `04-future-default.png`

หลังตรวจรับ `preferences.json` ไม่มี key ใดเหลือ (ไฟล์ที่ `values` ว่างมีผลเท่ากับไม่มีไฟล์ ก่อนตรวจรับไม่มีไฟล์นี้)
`modules/Amateur.json`, `session.json`, `settings.json`, `qth/THBK.json` และ `satdb.json` เหมือนก่อนตรวจรับทุกไบต์ (SHA-1 เดิม) ที่เพิ่มคือ cache `ephem/day/` (6 วัน ราว 40 MB)

### 7. test ครบทุกชุด

| ชุด | คำสั่ง | ผล |
|---|---|---|
| engine | `( cd api-interop/gnss-predict && python3 -m unittest discover -s tests )` | 498 test OK (ข้าม 3 ที่ต้องใช้ GMAT เมื่อตั้ง `GMAT_BIN` ไม่ข้ามเลย) |
| server | `( cd api-interop/gpredict-web/server && GMAT_BIN=… ../.venv/bin/python -m unittest discover -s tests )` | 497 test OK ไม่ข้ามเลย (รวม integration กับ GMAT จริงทั้ง `test_integration_gmat` และ `test_integration_passes`) ใช้ 35.5 วินาที |
| web | `( cd api-interop/gpredict-web/web && npm test )` | 58 ไฟล์ 838 test OK |
| web | `( cd api-interop/gpredict-web/web && npm run build )` | สำเร็จ (120 modules, JS 346.66 kB) |

`git diff feature/gpredict-web-core -- api-interop/gnss-predict` ว่าง: งานย่อยที่ 2 ไม่แก้ engine จึงให้ผลกับ GNSS Studio เหมือนเดิมทุกไบต์

integration กับ GMAT จริงของงานย่อยที่ 2 (`tests.test_integration_passes`):

- Future passes ของ ISS (TLE คงที่ `ISS` ของ `test_integration_gmat.py`, epoch 2026-11-09 12:00) ที่ THBK เริ่มที่ epoch: 10 pass (2026-11-09 13:43 ถึง 2026-11-12 04:38)
  คำขอใช้ 1.5 วินาที เทียบ GMAT รายวินาทีทุก pass: AOS ต่างมากสุด 0.0293 วินาที, LOS ต่างมากสุด 0.0265 วินาที, Max El ต่างมากสุด 3.3e-06°
- Sky at a glance ของ module 10 ดวง (TLE จริงของ ISS, AO-7, SO-50, FO-29, AO-85, JUGNU, CROCUBE, NO-44, RS-44, CAS-9 epoch 10–11 พ.ย. 2026) เริ่ม 2026-11-11 12:00:
  คำตอบแรก `computing` แล้ว `ok` หลัง 6.4 วินาที (ถาม 7 ครั้ง) 8 ใน 10 ดวงมี pass ใน 8 ชม. (CROCUBE และ JUGNU ไม่มี pass ที่สูงถึง 5°)
  มี pass เดียวที่เริ่มหลัง 8 ชม. คือ pass สุดท้ายของ ISS (21:05) ตามกติกาเลื่อนช่วง

### สิ่งที่ไม่ได้ทำหรือทำต่างจากเกณฑ์

- **ดาวที่ไม่มี pass ใน 3 วันที่ค่าตั้งต้น**: ไม่มีดาวแบบนี้ในข้อมูลบนเครื่อง และไม่ได้ดึงข้อมูลใหม่จาก CelesTrak (ต้องได้รับอนุญาตก่อน) จึงใช้ Minimum elevation 90°
  ซึ่งผ่านโค้ดส่วนเดียวกัน (กรณีดาวจริงที่ขึ้นไม่ถึง Minimum elevation ตลอด 3 วันมี test ของ server ด้วยดาวสังเคราะห์)
- **หน้าต่างพิมพ์ของ browser** ไม่ได้เปิดจริง (Chrome headless) ตรวจหน้าที่จะพิมพ์และ PDF ที่ Chrome สร้างจากหน้านั้นแทน
- **"Show current pass"** ไม่ได้กดใน browser (ISS อยู่ใต้ขอบฟ้าตลอดการตรวจรับ) มี test ของ server (`kind: "current"`) และของ web (เมนูมีรายการนี้เฉพาะเมื่อ El > 0)
- **Enter และคลิกขวา → Show details** ใน Upcoming passes ไม่ได้ลองใน browser (ลองแค่ดับเบิลคลิก) เมนู Show details มี test ของ web ส่วนปุ่ม Enter ยังไม่มี test
- ตรวจเฉพาะ Google Chrome แบบ headless ไม่ได้ลอง Safari และ Firefox
