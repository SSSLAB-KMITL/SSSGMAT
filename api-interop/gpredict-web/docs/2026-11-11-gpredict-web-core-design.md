# Gpredict Web: หน้า UI แบบ Gpredict ที่คำนวณวงโคจรด้วย GMAT (งานย่อยที่ 1: Tracking core)

- วันที่: 2026-11-11
- Branch: `feature/gpredict-web-core` แตกจาก `feature/gnss-studio-server` (ต้องใช้ `on_gmat_start` ของ engine จาก commit 0b6345b)
  ยังไม่เข้า `main` งานนี้ทำใน git worktree แยก เพราะ working tree หลักมี session ของ GNSS Studio ทำงานอยู่
- สถานะ: รอผู้ใช้ตรวจ spec
- เอกสารที่เกี่ยวข้อง
  - [2026-11-11-gpredict-reference.md](2026-11-11-gpredict-reference.md): ชื่อเมนู ปุ่ม คอลัมน์ ค่าตั้งต้น และพฤติกรรมของ Gpredict 2.7
    ที่ตรวจกับ source code พร้อมเลขบรรทัด (ต่อไปเรียกว่า "รายการอ้างอิง")
  - [GNSS Studio design ภาพรวม](../../gnss-predict/docs/2026-11-11-gnss-studio-design.md): ระบบแบบ STK ที่ใช้ engine ชุดเดียวกัน
  - [GNSS Studio engine spec](../../gnss-predict/docs/2026-11-11-gnss-studio-engine-design.md): engine ที่งานนี้นำมาใช้และเพิ่มความสามารถ

## 1. ที่มาและเป้าหมาย

### สิ่งที่ผู้ใช้กำหนด

1. ระบบใหม่ที่แยกจาก GNSS Studio และทำงานได้ครบแบบโปรแกรม Gpredict เดิมทั้งหมด
2. ใช้ติดตามดาวเทียมทุกประเภทจาก CelesTrak ควบคุมวิทยุและเสาอากาศจริง และใช้สาธิตหรือสอน
3. เป็นเว็บบน localhost: Python server บนเครื่อง เปิดดูผ่าน browser
4. ตำแหน่งดาวทุกค่าต้องมาจาก GMAT (ข้อยกเว้นที่ผู้ใช้ยอมรับอยู่ในหัวข้อ 6.2)
5. ยังไม่มีวิทยุหรือ rotator จริง งานที่ใช้ฮาร์ดแวร์ทดสอบกับ `rigctld`/`rotctld` โหมด dummy ของ hamlib
6. ใช้ FastAPI + React/TypeScript (Vite) โดย server เป็นเจ้าของนาฬิกาและการคำนวณ
7. ไม่ทำซ้ำกับ GNSS Studio: ของที่ทั้งสองระบบใช้ร่วมกันได้อยู่ใน engine `gnss_predict` (หัวข้อ 4)

### สมมติฐาน (ผู้ใช้ไม่ได้แย้ง)

1. ชื่อเมนู ปุ่ม หน้าต่าง และคอลัมน์เป็นภาษาอังกฤษตามรายการอ้างอิง ข้อความแจ้งเตือนและคำอธิบายของเราเป็นภาษาไทย
2. เขียนโค้ดเองทั้งหมด ลอกเฉพาะพฤติกรรมและ layout ไม่นำโค้ดของ Gpredict (GPL) มาใช้ ภาพแผนที่โลกใช้ภาพ public domain ของ NASA
3. ใช้คนเดียว ไม่มี login รันบน macOS เครื่องพัฒนาก่อน
4. ชื่อ "Gpredict Web" และโฟลเดอร์ `gpredict-web` เป็นชื่อชั่วคราว เปลี่ยนได้

### การแบ่งงานย่อย

แต่ละงานมี spec, แผน และ branch ของตัวเอง ทำตามลำดับ เอกสารนี้คืองานที่ 1

| ลำดับ | งานย่อย | สิ่งที่ได้ |
|---|---|---|
| 1 | Tracking core | ช่วงคำนวณ GMAT + interpolation, QTH, Module และ Module properties, Time Controller, view ทั้ง 5 แบบ (Map, Polar, List, Single sat, Event list), Update TLE data from network |
| 2 | Pass predictions | Show current pass, Show next pass, Future passes, Pass details, Sky at a glance |
| 3 | Radio & Rotator | Radio Control (Doppler ผ่าน `rigctld`), Antenna Control (`rotctld`), Update transponder data (SatNOGS) |
| 4 | Data & Preferences | Preferences, Update TLE data from local files, TLE source และอัปเดตอัตโนมัติ, Satellite info, Log browser, Detach/Full screen, สีและภาพแผนที่ |

## 2. ขอบเขตของงานที่ 1

**ทำ**: หัวข้อ 3–10 ของเอกสารนี้

**ไม่ทำ** ทุกเมนู ปุ่ม และรายการในเมนูคลิกขวาของงานถัดไปที่อยู่ในตำแหน่งเดียวกับ Gpredict จะแสดงแต่กดไม่ได้
พร้อม tooltip ภาษาไทยว่าอยู่ในงานย่อยไหน (รายการเต็มในหัวข้อ 8.2)

## 3. สถาปัตยกรรม

```
Browser (React + TypeScript + Canvas)
   │  REST /api + WebSocket /ws   (dev: Vite proxy → 8740)
   ▼
FastAPI (127.0.0.1:8740)  gpredict_web: นาฬิกา module, ช่วงคำนวณ, ค่าที่คำนวณ, QTH/module/TLE
   │  import
   ▼
gnss_predict (engine เดียวกับ GNSS Studio, standard library ล้วน)
   │  subprocess
   ▼
GmatConsole (GMAT R2026a, SPICESGP4)
```

หน้าที่ของแต่ละชั้น
- **Engine** propagate ด้วย GMAT, interpolation, เรขาคณิต, ดาราศาสตร์ ไม่รู้จัก module หรือหน้าจอ
- **Server** ถือเวลาของแต่ละ module, จัดการช่วงคำนวณและ cache, คำนวณค่าที่แสดงทุกค่า, เก็บ QTH และ module
- **Web** วาดหน้าจออย่างเดียว ไม่คำนวณวงโคจร คำนวณได้เฉพาะเรขาคณิตของการวาด (projection, วง footprint บนแผนที่,
  ตำแหน่งบน Polar, เส้นแบ่งกลางวัน-กลางคืนจากจุดใต้ดวงอาทิตย์ที่ server ส่งมา)

### 3.1 โฟลเดอร์

| โฟลเดอร์ใต้ `api-interop/gpredict-web/` | เนื้อหา | git |
|---|---|---|
| `server/gpredict_web/` | Python package ของ server | track |
| `server/tests/` | unittest + `TestClient` ของ FastAPI | track |
| `server/requirements.txt` | fastapi, uvicorn, httpx (สำหรับ test) | track |
| `web/` | React + TypeScript + Vite + Vitest | track |
| `web/public/maps/` | ภาพ Blue Marble Next Generation (NASA, public domain) ขนาด 1024×512 | track |
| `docs/` | spec, แผน, รายการอ้างอิง | track |
| `data/` | QTH, module, session, ดัชนีดาว, ephemeris cache | ignore |
| `.venv/`, `web/node_modules/`, `web/dist/` | สภาพแวดล้อมและไฟล์ build | ignore |

server import `gnss_predict` จาก `api-interop/gnss-predict` โดยตั้ง `sys.path` ใน `gpredict_web/__init__.py` จากตำแหน่งไฟล์
(ไม่ต้องติดตั้ง package)

### 3.2 การรันและการตั้งค่า

- ใช้งาน: `python -m gpredict_web [--host H] [--port P] [--data DIR]` เป็น process เดียว เสิร์ฟทั้ง API และ `web/dist`
- พัฒนา: `uvicorn gpredict_web.app:app --reload --port 8740` + `npm run dev` (Vite proxy `/api` และ `/ws`)
- `--host` ที่ไม่ใช่ `127.0.0.1` หรือ `localhost` พิมพ์คำเตือนว่าไม่มี login

| ตัวแปร | ค่าตั้งต้น | ความหมาย |
|---|---|---|
| `GPREDICT_WEB_DATA` | `api-interop/gpredict-web/data` | QTH, module, session, ดัชนีดาว, ephemeris cache |
| `GNSS_STUDIO_DATA` | ค่าตั้งต้นของ engine | ที่อยู่ OMM cache และ `celestrak_state.json` ที่ใช้ร่วมกับ GNSS Studio |
| `GMAT_BIN` | `application/bin/GmatConsole` ของ repo | ตำแหน่ง GmatConsole (ของ engine เดิม) |

## 4. การเปลี่ยนแปลงใน engine `gnss_predict`

ทุกข้อเป็นการเพิ่ม ไม่เปลี่ยนผลของฟังก์ชันเดิมเมื่อเรียกแบบเดิม test เดิมทั้งหมดต้องผ่านโดยไม่แก้ test
และ `ENGINE_VERSION` ไม่เปลี่ยน เพราะ hash ของผลลัพธ์ GNSS Studio ต้องเท่าเดิม

### 4.1 `propagate.py`: ความเร็วและดาวทั่วไป

- เพิ่ม Protocol `TleSatellite` ที่มี `prn: str` และ `tle_lines: tuple[str, str]` แล้วให้ `write_tle_file`,
  `render_ecef_script` และ `propagate` รับ `list[TleSatellite]` (`CatalogSatellite` เข้ากับ Protocol นี้อยู่แล้ว)
- เพิ่มพารามิเตอร์ `with_velocity: bool = False` ให้ `render_ecef_script`, `parse_ecef_report` และ `propagate`
  - `False`: script และผลลัพธ์เหมือนเดิมทุกไบต์
  - `True`: `RF.Add` มี `<prn>.EarthFixed.VX/VY/VZ` ต่อจาก X/Y/Z ของแต่ละดวง และ `parse_ecef_report` อ่านความเร็ว (กม./วินาที)
    ดวงที่ไม่มีคอลัมน์ความเร็วครบหรือค่าไม่ใช่ตัวเลขถูกตัดด้วย `SAT_MISSING_FROM_GMAT` เหมือนกรณีตำแหน่ง
- `Ephemeris` เพิ่ม field `velocities_kms: dict[str, list[Position]] | None = None` ต่อท้าย (ค่าตั้งต้น None จึงไม่กระทบโค้ดเดิม)

### 4.2 `geometry.py`: `ecef_to_geodetic`

ใช้ฟังก์ชันตาม [GNSS Studio access-reports spec §3.1](../../gnss-predict/docs/2026-11-11-gnss-studio-access-reports-design.md):
`ecef_to_geodetic(x_km, y_km, z_km) -> (lat_deg, lon_deg, h_km)` บน WGS84 พร้อม test ตาม spec นั้น
ถ้า branch ของ GNSS Studio ทำไว้แล้วตอนเริ่มงานนี้ ให้ใช้ของเดิม ถ้ายังไม่มี งานนี้เพิ่มตาม spec นั้นทุกข้อ
และอีกฝั่งใช้ตัวนี้

### 4.3 ไฟล์ใหม่ `astro.py`: GMST และดวงอาทิตย์

- `gmst_rad(t_utc)`: IAU 1982 ถือว่า UT1 = UTC
- `sun_ecef_km(t_utc)`: สูตรความแม่นยำต่ำของ Astronomical Almanac (ราว 0.01°) ในกรอบ mean equator of date แล้วหมุนด้วย GMST
- `subpoint(ecef_km) -> (lat_deg, lon_deg)`: จุดบนพื้นโลกใต้วัตถุ (ใช้ `ecef_to_geodetic`)

ไม่มีดวงจันทร์ เพราะ Gpredict ไม่วาดดวงอาทิตย์หรือดวงจันทร์ และใช้ดวงอาทิตย์เฉพาะเส้นแบ่งกลางวัน-กลางคืนกับ Visibility
(รายการอ้างอิง §5, §6)

### 4.4 การรัน GMAT พร้อมกับ GNSS Studio

ไม่เพิ่ม lock ข้ามโปรแกรม server ของ GNSS Studio มีคิวของตัวเอง ([server spec §7](../../gnss-predict/docs/2026-11-11-gnss-studio-server-design.md)) ถ้าเปิดทั้งสองโปรแกรมพร้อมกัน
GMAT สองตัวทำงานพร้อมกันได้อย่างปลอดภัยเพราะใช้ work dir คนละที่ แค่ช้าลง

## 5. ตัวจัดการช่วงคำนวณของ GMAT (`gpredict_web/ephem.py`)

### 5.1 ช่วงเวลา

| ค่า | ค่าตั้งต้น | ความหมาย |
|---|---|---|
| `STEP_S` | 30 | ระยะห่างของจุดที่ GMAT รายงาน |
| `WINDOW_BACK_H` | 2 | ข้อมูลย้อนหลังจากชั่วโมงของ T |
| `WINDOW_SPAN_H` | 16 | ความยาวช่วง |
| `REFRESH_MARGIN_H` | 3 | เหลือช่วงด้านที่เวลาเดินไปน้อยกว่านี้ให้คำนวณช่วงถัดไป |
| `MAX_SATS` | 200 | ดาวสูงสุดต่อ module |
| `GMAT_TIMEOUT_S` | 600 | timeout ของ GMAT ต่อครั้ง |

- เวลาเดินหน้าหรือหยุด: `start = floor_hour(T) − 2 ชม.`, `stop = start + 16 ชม.` (มีข้อมูลล่วงหน้าอย่างน้อย 13 ชม.)
- เวลาเดินถอยหลัง: `stop = ceil_hour(T) + 2 ชม.`, `start = stop − 16 ชม.`
- ย้อนหลัง 2 ชม. เพราะ ground track เริ่มที่ต้นรอบปัจจุบัน และรอบของดาว LEO ยาวได้ถึงราว 2 ชม.
- ช่วงที่ interpolate ได้คือ `[start + 5·STEP_S, stop − 5·STEP_S]` เพราะ Lagrange 10 จุดต้องมีจุดข้างละ 5 จุด
- เมื่อ T อยู่ในช่วงที่ใช้ได้ แต่ห่างปลายด้านที่เวลาเดินไปน้อยกว่า `REFRESH_MARGIN_H` ให้สั่งคำนวณช่วงใหม่จาก T ปัจจุบันเบื้องหลัง
  และใช้ช่วงเดิมจนกว่าช่วงใหม่จะเสร็จ
- เมื่อ T อยู่นอกช่วงที่ใช้ได้ (เช่นตั้งเวลาไปอีก 3 วัน) สั่งคำนวณทันที ระหว่างรอ tick มีสถานะ `computing` และไม่มีค่าของดาว
- ประมาณเวลาจากผลวัดเดิม (131 ดวง 24 ชม. 39 วินาที): 200 ดวง 16 ชม. ราว 40 วินาที

### 5.2 การรัน GMAT

- ชื่อ object ใน GMAT และบรรทัดชื่อในไฟล์ TLE คือ `S` + `omm.catalog_field(norad)` เช่น `S25544`, `SA0744`
- ใช้ `gnss_predict.propagate.propagate(..., with_velocity=True, on_gmat_start=...)` work dir อยู่ใต้ `data/ephem/_work/`
- คิวเดียว ทำทีละงาน งานที่ไม่มี module ไหนต้องการแล้ว (module ปิด หรือมีงานใหม่ของ module เดียวกันมาแทน) ถูกยกเลิก:
  ถ้ายังรออยู่ในคิวให้ตัดออก ถ้ากำลังรันให้ `os.killpg` ด้วย pgid จาก `on_gmat_start`
- GMAT ล้มเหลว: tick มีสถานะ `failed` พร้อม `GMAT_FAILED` และไม่ลองใหม่เองจนกว่าผู้ใช้จะกดปุ่ม Retry ใน overlay ของ module
  **(ของเรา)** หรือเวลาของ module ย้ายไปช่วงอื่น

### 5.3 Cache รายดวง

- key คือ `(12 ตัวแรกของ sha256 ของ TLE 2 บรรทัด, start, stop, STEP_S)` แต่ละ key เก็บตำแหน่งและความเร็วของดวงเดียว
- เมื่อ module ต้องการช่วงหนึ่ง ระบบรัน GMAT ครั้งเดียวเฉพาะดวงที่ยังไม่มีใน cache ของช่วงนั้น
  หลาย module ที่มีดาวดวงเดียวกันจึงคำนวณครั้งเดียว
- TLE ของดวงไหนเปลี่ยน key เปลี่ยน ระบบคำนวณดวงนั้นใหม่และใช้ค่าเก่าไปจนกว่าค่าใหม่จะเสร็จ
- หน่วยความจำ: เก็บทุกช่วงที่ module ที่เปิดอยู่ใช้ ช่วงที่ไม่มีใครใช้ถูกปล่อย
- ดิสก์: `data/ephem/<start>_<stop>_<step>/<key>.f64` เป็น float64 little-endian เรียง `x y z vx vy vz` ต่อ epoch
  เขียนลงไฟล์ชั่วคราวแล้ว rename ตอนเปิด server ลบโฟลเดอร์ของช่วงที่ `stop` เก่ากว่า 7 วัน

### 5.4 Interpolation

ตำแหน่งและความเร็วใช้ `sp3.lagrange_at` แบบ 10 จุดคนละชุด

## 6. ค่าที่คำนวณ, AOS/LOS และนาฬิกา

### 6.1 ค่าต่อดาว (`gpredict_web/observe.py`)

คำนวณทุก tick จาก r, v (EarthFixed) ที่ interpolate ได้ และตำแหน่ง QTH q (`geodetic_to_ecef`)
สูตรที่มีในรายการอ้างอิงใช้ค่าคงที่เดียวกับ Gpredict

| ค่า | สูตร |
|---|---|
| Az, El, Range | `ecef_to_aer` ของ engine |
| Range rate | (r − q)·v / \|r − q\| (กม./วินาที บวกคือกำลังห่างออก) |
| Lat, Lon, Alt | `ecef_to_geodetic` |
| SSP | Maidenhead locator 6 ตัวอักษรของ (Lat, Lon) |
| Footprint | 12756.33 · acos(6378.135 / (6378.135 + Alt)) กม. |
| Velocity | \|v + ω⊕ × r\| โดย ω⊕ = 7.292115e-5 rad/s |
| RA, Dec | เวกเตอร์ r − q หมุนรอบแกน z ด้วย `gmst_rad` เป็นกรอบเฉื่อยของวันนั้น |
| Doppler | −100e6 · range rate / 299792.458 (Hz) |
| Loss | 72.4 + 20·log10(Range กม.) (dB) |
| Delay | Range / 299.792458 (มิลลิวินาที) |
| Orbit Phase | mean anomaly ของวงโคจร osculating ที่ได้จาก r, v ในกรอบเฉื่อย (r หมุนด้วย GMST, v + ω⊕ × r) เป็นองศา 0–360 |
| MA | Orbit Phase × 256 / 360 (Gpredict แสดงค่าช่วง 0–256 แม้มีสัญลักษณ์ °) |
| Visibility | ดาวอยู่ในเงาโลก (ทรงกระบอก) → `E` Eclipsed; ดาวโดนแสง, El ≥ 0 และดวงอาทิตย์ที่ QTH ≤ −6° → `V` Visible; นอกนั้น `D` Daylight |
| Dir | `G` ถ้า GEO, `D` ถ้า decayed, `↓` ถ้า range rate > 0.001, `↑` ถ้า < −0.001, ถ้าอยู่ระหว่างนั้นเทียบกับ range rate ของ tick ก่อน: ลดลง `↺` ไม่ลด `↷` |

- GEO: \|mean motion ใน TLE − 1.0027\| < 0.0002 รอบต่อวัน (กติกาของ Gpredict)
- Decayed: epoch + (16.666666 − mean motion) / (10·\|ṅ/2\|) < T เป็นวัน (กติกาของ Gpredict) โดย ṅ/2 คือค่าในช่อง
  "first derivative of mean motion / 2" ของ TLE บรรทัด 1 (รอบต่อวัน²) ถ้าช่องนี้เป็น 0 ถือว่าไม่ decayed
  ดาวที่ decayed ไม่แสดงในทุก view
- Phase และ MA เป็นค่า osculating จึงต่างจากของ Gpredict (mean element ของ SGP4) เล็กน้อย

### 6.2 ข้อยกเว้นของกติกา "ค่าทุกค่ามาจาก GMAT" (ผู้ใช้ยอมรับแล้ว)

1. **Orbit number** ใช้สูตรของ Gpredict จาก TLE: floor((n·Δt + Δt²·B*·ae) + (M₀ + ω)/2π) − floor((M₀ + ω)/2π) + rev number
   (n เป็นรอบต่อวัน, Δt เป็นวัน) ต้นรอบปัจจุบันของ ground track หาจากสูตรเดียวกัน
2. **ตำแหน่งดวงอาทิตย์** ใช้ `astro.py` (หัวข้อ 4.3)
3. **GEO และ Decayed** ใช้ค่าใน TLE ตามหัวข้อ 6.1

### 6.3 AOS/LOS ภายในช่วงคำนวณ (`gpredict_web/passes.py`)

1. คำนวณ El ของทุก epoch ในช่วงแล้วหาช่วงคร่าวๆ ด้วย `analyze.intervals_from_elevations(times, els, 0.0)` ของ engine
2. หาจุด local maximum ของ El ที่ทั้งสองข้างอยู่ใต้ 0° แต่สูงกว่า −2° แล้วหาค่าสูงสุดจริงด้วย golden-section
   ถ้าสูงสุดเกิน 0° เพิ่มเป็นช่วงใหม่ (pass สั้นที่โผล่ขึ้นมาระหว่างสองจุด)
3. ปรับ AOS และ LOS ของทุกช่วงด้วยการแบ่งครึ่งบน El ที่ interpolate จนช่วงเหลือไม่เกิน 0.1 วินาที
   ช่วงที่เริ่มหรือจบที่ขอบช่วงคำนวณถือว่าไม่รู้ AOS หรือ LOS (ค่าว่าง)
4. Max El และเวลาของ Max El หาด้วย golden-section ภายในช่วง

ผลเป็น `Pass(aos, los, max_el, t_max_el)` ฟังก์ชันนี้ออกแบบให้งานที่ 2 ใช้ต่อกับช่วงหลายวันได้
ดาวที่ไม่มี AOS และ LOS เลยในช่วงคำนวณ: ถ้า El > 0 ถือว่า "Always in range" ไม่งั้น "Always out of range"
(Gpredict ตัดสินจากรูปวงโคจร ของเราตัดสินภายในช่วง 16 ชม. **(ของเรา)**)

### 6.4 นาฬิกาของ module (`gpredict_web/clock.py`)

ตามหน้าต่าง Time Controller ของ Gpredict (รายการอ้างอิง §9) ซึ่งไม่มีระดับความเร็ว มีแค่ Throttle

| สถานะ | เวลา T |
|---|---|
| `forward` | t_ref + throttle·(เวลาเครื่อง − wall_ref) |
| `backward` | t_ref − throttle·(เวลาเครื่อง − wall_ref) |
| `stop` | t_ref คงที่ (ตั้งจากปฏิทิน, Hour/Min/Sec/Msec และ slider ในหน้าต่าง) |

- throttle เป็นจำนวนเต็ม 1–100 เปลี่ยนสถานะหรือ throttle: ตั้ง t_ref = T ณ ตอนนั้น และ wall_ref = เวลาเครื่อง เวลาจึงไม่กระโดด
- Reset: `forward`, throttle 1, T = เวลาเครื่อง
- ป้าย: `stop` → "Manual Control"; `forward` ที่ throttle 1 และ \|T − เวลาเครื่อง\| < 1 วินาที → "Real-Time"; นอกนั้น → "Simulated Real-Time"
- เปิด module เริ่มที่ Reset (ไม่บันทึกสถานะนาฬิกา) ปิดหน้าต่าง Time Controller ก็ Reset เหมือน Gpredict
- tick ทุก "Refresh data every" ของ module (ตั้งต้น 300 ms) ทุก browser tab ที่เปิด module เดียวกันได้ tick เดียวกัน
  แต่ละ view วาดใหม่ทุก N tick ตาม Refresh Rates (List 1, Map 10, Polar 3, Single sat 1, Event list 1)

## 7. ข้อมูล, API และ error

### 7.1 ข้อมูลที่เก็บ

| ข้อมูล | ไฟล์ | ช่อง |
|---|---|---|
| QTH | `data/qth/<name>.json` | name, description, location, lat_deg, lon_deg, alt_m, weather_station |
| สถานีตั้งต้น | `data/settings.json` | `default_qth` |
| Module | `data/modules/<name>.json` | name, qth (ชื่อ หรือ null คือ "** DEFAULT **"), satellites (NORAD), layout_code, refresh (data_ms และจำนวนรอบของแต่ละ view), list (คอลัมน์ที่แสดง, คอลัมน์และทิศที่เรียง), map (Contents, จำนวน orbit ของ ground track, center longitude), polar (orientation, Contents, show sky tracks automatically), single (ช่องที่แสดง, ดาวที่เลือก), ดาวที่เปิด Highlight footprint / Ground Track / Sky track |
| Session | `data/session.json` | module ที่เปิดค้างและลำดับแท็บ |
| ดัชนีดาว | `data/satdb.json` | NORAD → ชื่อ, กลุ่ม, TLE 2 บรรทัด, epoch, เวลาที่อัปเดต |

- `name` ของ QTH และ module: `^[A-Za-z0-9_-]{1,25}$` (กติกาเดียวกับ Gpredict)
- QTH: lat −90..90, lon −180..180, alt 0..5000 ม. (ขอบเขตของ Gpredict), location ไม่เกิน 50 ตัวอักษร,
  description ไม่เกิน 256, weather_station ไม่เกิน 4
- ค่าตั้งต้นของช่องใน module เป็นค่าตั้งต้นของ Gpredict ในรายการอ้างอิง (layout preset 0, refresh 300 ms ฯลฯ)
- ทุกไฟล์เขียนลงไฟล์ชั่วคราวแล้ว rename
- เปิด server ครั้งแรก (ไม่มี QTH เลย): สร้าง QTH `THBK` จาก `config.THBK_*` ของ engine ตั้งเป็นสถานีตั้งต้น
  ดึงกลุ่ม `amateur` แล้วสร้างและเปิด module `Amateur` ที่ใช้ "** DEFAULT **" และมีดาวทุกดวงในกลุ่มนั้น
  ถ้าเกิน `MAX_SATS` ตัดตามลำดับชื่อพร้อมคำเตือน (Gpredict เปิด module "Amateur" ตอนเริ่มครั้งแรก)

### 7.2 ฐานข้อมูลดาวและ TLE (`gpredict_web/satdb.py`)

- `config.TLE_GROUPS` คือกลุ่ม CelesTrak ใน TLE source ตั้งต้นของ Gpredict: `amateur`, `cubesat`, `galileo`, `glo-ops`,
  `gps-ops`, `iridium-NEXT`, `science`, `last-30-days`, `visual`, `weather` ดึงเป็น OMM (JSON) ไม่ใช่ TLE
  (ไฟล์ `nasabare.txt` ของ AMSAT อยู่ในงานที่ 4 พร้อมการจัดการ TLE source)
- Edit → Update TLE data from network ดึงทุกกลุ่มด้วย `omm.fetch_group` ไปที่ OMM cache ที่ใช้ร่วมกับ GNSS Studio
  จึงนับกติกา 1 ครั้งต่อกลุ่มต่อ 2 ชม. ร่วมกัน (กลุ่มที่ยังไม่ครบ 2 ชม. ใช้ไฟล์ใน cache ไม่ส่ง request)
  แปลงเป็น TLE ด้วย `omm.to_tle_lines` แล้วสร้างดัชนีใหม่
  - Satellites updated: ดวงที่ได้ epoch ใหม่กว่าเดิม
  - Satellites skipped: ดวงที่ epoch เท่าเดิม
  - Missing Satellites: ดวงในดัชนีที่ไม่อยู่ในกลุ่มใดเลย (ยังเก็บ TLE เดิมไว้)
  - ดวงใหม่ถูกเพิ่มเข้าดัชนี (ค่าตั้งต้นของ Gpredict "Add new satellites to local database" เปิดอยู่)
- ดาวดวงเดียวกันในหลายกลุ่มใช้ OMM ที่ epoch ใหม่สุด และจำทุกกลุ่มไว้สำหรับ combo กลุ่มในหน้าเลือกดาว
- ดึงกลุ่มไม่ได้: ใช้ไฟล์ล่าสุดใน cache พร้อม `ORBIT_DOWNLOAD_FAILED` (รหัสเดิมของ engine)
- TLE อายุเกิน 7 วัน: tick มี `TLE_OLD` ระดับ warning ต่อดวง แต่ยังติดตามได้

### 7.3 API

| Method | Path | ทำอะไร |
|---|---|---|
| GET | `/api/qth` | รายชื่อ QTH และสถานีตั้งต้น |
| GET/PUT/DELETE | `/api/qth/{name}` | อ่าน สร้างหรือแก้ ลบ (ลบสถานีที่ module ใช้อยู่หรือสถานีสุดท้ายไม่ได้: 409) |
| GET | `/api/satellites?q=&group=` | ค้นดาวด้วยชื่อหรือ NORAD สูงสุด 500 แถว |
| GET | `/api/satellites/{norad}` | ข้อมูลดาวและ TLE |
| GET | `/api/tle/groups` | กลุ่มที่เลือกได้ พร้อมเวลาดึงล่าสุด |
| POST | `/api/tle/update` | ดึงทุกกลุ่ม คืนจำนวน updated / skipped / missing และคำเตือนของแต่ละกลุ่ม |
| GET | `/api/modules` | รายชื่อ module และ module ที่เปิดอยู่ตามลำดับแท็บ |
| GET/PUT/DELETE | `/api/modules/{name}` | อ่าน สร้างหรือแก้ ลบ |
| POST | `/api/modules/{name}/open`, `/close` | เปิดหรือปิด module (บันทึกลง session) |
| POST | `/api/modules/{name}/clone` | `{new_name, open}` |
| PUT | `/api/session/tabs` | ลำดับแท็บหลังลากสลับ |
| POST | `/api/modules/{name}/retry` | สั่งคำนวณช่วงปัจจุบันใหม่หลัง GMAT ล้มเหลว |
| GET/PUT | `/api/modules/{name}/clock` | `{state, throttle, time}` |
| POST | `/api/modules/{name}/clock/reset` | Reset |
| GET | `/api/modules/{name}/track/{norad}` | ground track ตั้งแต่ต้นรอบปัจจุบันไป N รอบตามค่าของ module (ตัดที่ขอบช่วงคำนวณ) แยกเป็นเส้นเมื่อข้ามเส้น 180° |
| GET | `/api/modules/{name}/skytrack/{norad}` | Az/El ทุก 10 วินาทีของ pass ปัจจุบันตั้งแต่ AOS ถึง LOS (404 ถ้าดาวอยู่ใต้ขอบฟ้า) |
| POST | `/api/quit` | หยุด server **(ของเรา: แทน File → Quit)** |
| WS | `/ws/modules/{name}` | tick ของ module |

tick ของ WebSocket (ตัวเลขเป็นตัวอย่าง):

```json
{
  "t": "2026-11-12T07:00:00.000Z",
  "clock": {"state": "forward", "throttle": 1, "label": "Real-Time"},
  "status": "ok",
  "qth": {"name": "THBK", "location": "Bangkok", "lat_deg": 13.729779, "lon_deg": 100.781151, "alt_m": 6.4},
  "sun": {"lat_deg": -17.6, "lon_deg": 75.1},
  "window": {"start": "2026-11-12T05:00:00Z", "stop": "2026-11-12T21:00:00Z"},
  "sats": [
    {"norad": 25544, "name": "ISS (ZARYA)", "az": 210.4, "el": 12.7, "dir": "↑", "ra": 101.2, "dec": -20.4,
     "range_km": 1530.2, "range_rate_kms": -5.91, "lat_deg": 4.1, "lon_deg": 95.3, "ssp": "NJ94ad",
     "footprint_km": 4540.0, "alt_km": 418.6, "vel_kms": 7.66, "doppler_hz": 1971.0, "loss_db": 136.1,
     "delay_ms": 5.10, "ma": 61.9, "phase_deg": 87.0, "orbit": 51234, "vis": "D",
     "next_aos": null, "next_los": "2026-11-12T07:06:12.300Z", "always": null}
  ],
  "messages": [{"code": "TLE_OLD", "level": "warning", "text": "...", "object": "25544"}]
}
```

- `status` เป็น `ok`, `computing` หรือ `failed` ถ้าไม่ใช่ `ok` จะไม่มี `sats`
- `always` เป็น `"in"`, `"out"` หรือ null (หัวข้อ 6.3)
- server ส่งเฉพาะดาวที่ไม่ decayed

### 7.4 Error

ใช้ `Message(code, level, text, object)` ของ engine REST ตอบ error เป็น `{code, level, text, object}`

| รหัส | HTTP / ที่แสดง | เมื่อไร |
|---|---|---|
| `QTH_INVALID` | 422 | ช่องของ QTH ผิดรูปแบบหรือเกินช่วง |
| `MODULE_INVALID` | 422 | ช่องของ module ผิดรูปแบบ, QTH ไม่มีอยู่, NORAD ไม่อยู่ในดัชนี, ไม่มีดาวเลย, layout code ผิด |
| `MODULE_TOO_MANY_SATS` | 422 | ดาวเกิน `MAX_SATS` |
| `NOT_FOUND` | 404 | QTH, module หรือดาวไม่มีอยู่ |
| `IN_USE` | 409 | ลบ QTH ที่ module ใช้อยู่ หรือสถานีสุดท้าย |
| `GMAT_NOT_FOUND` | tick `failed` | หา GmatConsole ไม่เจอ |
| `GMAT_FAILED` | tick `failed` | GMAT ล้มเหลวหรือหมดเวลา |
| `EPHEM_COMPUTING` | tick `computing` (info) | กำลังคำนวณช่วงที่ T อยู่ |
| `ORBIT_DOWNLOAD_FAILED` | คำตอบของ `/api/tle/update` (warning) | ดึงกลุ่มไม่ได้ ใช้ cache |
| `TLE_OLD` | tick (warning) | TLE อายุเกิน 7 วัน |
| `SAT_MISSING_FROM_GMAT` | tick (warning) | GMAT ไม่รายงานดาวดวงนั้น |

ข้อความของ Gpredict ที่มีในรายการอ้างอิง (เช่น "Please select at least one satellite from the list.") ใช้คำเดิมภาษาอังกฤษ
ข้อความที่ Gpredict ไม่มี (รหัสข้างบน) เป็นภาษาไทย

## 8. หน้าจอ

ทุกชื่อในหัวข้อนี้มาจากรายการอ้างอิง (ระบุ §) ส่วนที่ Gpredict ไม่มีติดป้าย **(ของเรา)**
หน้าต่างย่อยทั้งหมด (Time Controller, dialog) เป็นหน้าต่างลอยในหน้าเว็บ ลากย้ายได้ ไม่ใช่หน้าต่าง browser แยก

### 8.1 หน้าต่างหลัก (§1)

```
┌──────────────────────────────────────────────────────────┐
│ File  Edit  Help                                         │
├──────────────────────────────────────────────────────────┤
│ [Amateur] [Weather]        (แท็บซ่อนเมื่อเปิด module เดียว) │
│ 2026/11/12 07:00:00                         [Module menu]│
├──────────────────────────────────────────────────────────┤
│                    Map (ครึ่งบน)                          │
├────────────────────────────┬─────────────────────────────┤
│           Polar            │         Single sat          │
└────────────────────────────┴─────────────────────────────┘
          (layout ตั้งต้น preset 0 "World map, polar and single sat")
```

- ชื่อหน้า "Gpredict Web" และ "Gpredict Web: <ชื่อแท็บ>" **(ของเรา: ไม่ใช้ชื่อ Gpredict เพราะไม่ใช่โปรแกรมของผู้พัฒนา Gpredict)**
- มีแค่แถบเมนูกับแท็บ module ไม่มี status bar ลากแท็บสลับลำดับได้
- หัวของ module: ซ้ายคือเวลาของ module ตามรูปแบบ `%Y/%m/%d %H:%M:%S` (UTC) อัปเดตไม่เกินวินาทีละครั้ง
  ขวาคือปุ่มเมนู tooltip "Module menu" ไม่มีปุ่มปิด (ปิดจากเมนู Close)
- คีย์ลัด Ctrl+N, Ctrl+O, Ctrl+Q ทำงานเท่าที่ browser ยอม
- ขณะ status เป็น `computing` หรือ `failed` view ของ module ถูกบังด้วย overlay ข้อความภาษาไทย
  และ `failed` มีปุ่ม Retry **(ของเรา)**

### 8.2 เมนูและสิ่งที่ทำในงานที่ 1 (§1, §2, §4–§8)

| ที่อยู่ | งานที่ 1 ทำ | กดไม่ได้ (งานย่อย) |
|---|---|---|
| File | New module, Open module, Quit | Log browser (4) |
| Edit | Update TLE data from network | Update TLE data from local files (4), Update transponder data (3), Preferences (4) |
| Help | Online help (dialog ที่มีลิงก์ไป README ของเรา), License (แสดง `License.txt` ของ repo), About Gpredict Web **(ของเรา)** | ไม่มี News **(ของเรา)** |
| Module menu | Autotrack, Select satellite, Time Controller, Configure, Clone..., Delete, Close | Detach module (4), Full screen (4), Sky at a glance (2), Radio Control (3), Antenna Control (3) |
| คลิกขวาที่ดาวใน List, Map, Polar | Highlight footprint, Ground Track (Map), Sky track (Polar) | Satellite info (4), Show current pass, Show next pass, Future passes (2) |
| ปุ่มใน Single sat และคลิกขวาใน Event list | รายชื่อดาวให้เลือก (Single sat) | ชื่อดาวตัวหนา → Satellite info (4), Show current pass, Show next pass, Future passes (2) |
| ดับเบิลคลิกที่ดาว | – | Satellite info (4) |

- Autotrack: เลือกดาวที่อยู่เหนือขอบฟ้า ถ้าไม่มีเลือกดาวที่ AOS เร็วสุด (§2) แล้วเลือกใน view ทั้งหมด
- Select satellite: เมนูย่อยรายชื่อดาวเรียงตามชื่อ เลือกแล้วเลือกใน view ทั้งหมด
- Quit: หยุด server แล้วหน้าเว็บแสดงข้อความว่าปิดแล้ว **(ของเรา)**

### 8.3 Layout (§3)

- layout code: กลุ่มละ 5 ตัวเลข `type;left;right;top;bottom` บน grid โดย type 0 List, 1 Map, 2 Polar, 3 Single sat, 4 Event list
  วางด้วย CSS grid ทุกแถวและคอลัมน์กว้างเท่ากัน
- preset 0–8 ตามตารางใน §3 และ 9 "Custom" ที่พิมพ์ code เองได้

### 8.4 Map (§5)

วาดบน Canvas ตามลำดับของ Gpredict
1. ภาพพื้น Blue Marble ยืดเต็ม view ตั้งกลางที่ center longitude (ตั้งต้น 0)
2. Grid Lines ทุก 30° พร้อมป้าย `%.0f°`
3. Solar Terminator: เติมด้าน night ด้วยสี Global shadow และเส้นขอบสี terminator คำนวณใหม่ทุก 15 วินาทีของเวลา module
4. QTH เป็นสี่เหลี่ยม 6×6 px พร้อมชื่อใต้สี่เหลี่ยม
5. ต่อดาว: Ground Track (เส้น 1 px), footprint (เติมสี coverage, ขอบสีดาว), marker 6×6 px พร้อมเงา, ชื่อพร้อมเงา
   (ย้ายป้ายเมื่อชิดขอบตาม §5)
6. ข้อความ: QTH Info มุมซ้ายบน, "Next: <sat> in MM:SS" มุมขวาบน, ตำแหน่ง cursor มุมซ้ายล่าง,
   ดาวที่เลือก "<sat> AOS in MM:SS" / "LOS in" / "Always in range" / "Always out of range" มุมขวาล่าง
- Contents ตั้งต้นตาม §5: เปิด Satellite Name, Satellite Footprint, Satellite Marker, QTH Info, Next Event, Grid Lines
  ปิด Cursor Position และ Solar Terminator
- ดาวที่เลือกแสดง footprint, marker และชื่อเสมอ คลิกภายใน 10 px เลือกหรือยกเลิกการเลือก เลือกได้ทีละดวง
- สีตั้งต้นตามตารางสีของ Map ใน §5 ground track 3 รอบ
- ไม่มี tooltip เมื่อชี้ดาว (ใน Gpredict 2.7 ไม่ปรากฏ)

### 8.5 Polar (§6)

- พื้นสีตามตาราง วง El 0°/30°/60° และแกนตั้ง-นอนยื่นเกินขอบ 5 px รัศมี min(w, h)/2 − 25 px
- ป้ายทิศ N/E/S/W วางตาม Orientation 4 แบบ (ตั้งต้น N/E/S/W)
- ข้อความ: ชื่อ QTH มุมซ้ายบน, "AZ: …°   EL: …°" ของ cursor มุมซ้ายล่าง, "Next: <sat>\nin MM:SS" มุมขวาบน,
  ดาวที่เลือก "<sat>\nLOS in MM:SS" หรือ "<sat>\nAlways in range" มุมขวาล่าง
- แสดงเฉพาะดาวที่ El ≥ 0 Sky track เป็นเส้น 1 px ของ pass ปัจจุบันตั้งแต่ AOS พร้อมป้ายเวลา `%H:%M` 4 จุด
  (จุดแรกที่ AOS) ไม่มีป้าย AOS/LOS เมนู Sky track กดไม่ได้สำหรับดาว GEO
- "Show the sky tracks automatically" ตั้งต้นปิด
- ไม่วาด Extra Az Ticks เพราะ Gpredict 2.7 ไม่วาด (ช่องตั้งค่ายังมีใน Module properties ให้ตรงกับ Gpredict)

### 8.6 List (§4)

- 27 คอลัมน์ตามตารางใน §4 พร้อม tooltip ของหัวคอลัมน์ ตั้งต้นแสดง Satellite, Az, El, Dir, Range, Next Event, Alt, Orbit
- รูปแบบตัวเลขตาม §4 ระยะทางไม่มีหน่วยต่อท้าย Next Event เป็น "<เวลา> (AOS)" / "<เวลา> (LOS)" หรือ "--- N/A ---"
- คอลัมน์ Status แสดง "Unknown" เพราะยังไม่มีแหล่งข้อมูลสถานะ **(ของเรา: SatNOGS ในงานที่ 3)**
- แถวที่ El > 0 เป็นตัวหนา เรียงตั้งต้นตาม Satellite คลิกหัวคอลัมน์เพื่อเรียง module จำคอลัมน์และทิศที่เรียง

### 8.7 Single sat (§7)

- หัว: ปุ่ม tooltip "Satellite options / shortcuts" และชื่อดาวที่เลือกตัวหนา module จำดาวที่เลือก
- 23 ช่อง `<ชื่อ> : <ค่า>` ตาม §7 พร้อม tooltip ค่าเริ่มเป็น "-" ช่องที่แสดงตั้งต้นตาม §7
- Direction เป็น "Geostationary" / "Decayed" / "Receding" / "Approaching" / "N/A" ตามค่า Dir
- เมนูของปุ่ม: ชื่อดาวตัวหนา, separator, รายการ pass, separator, รายชื่อดาวแบบ radio

### 8.8 Event list "Upcoming passes" (§8)

คอลัมน์ Satellite, Az, El, AOS/LOS ("MM:SS" หรือ "HH:MM:SS", "Never" เมื่อไม่มีเหตุการณ์ในช่วงคำนวณ)
เรียงตามเวลานับถอยหลังจากน้อยไปมาก แถวที่ El > 0 เป็นตัวหนา ไม่มีหน้าตั้งค่า

### 8.9 Time Controller (§9)

- ชื่อ "Time Controller / <module>"
- ปฏิทิน, Hour: 0–23, Min: 0–59, Sec: 0–59, Msec: 0–999 (ล้นแล้วทดไปช่องถัดไปและวันในปฏิทิน), Throttle: 1–100,
  slider −0.1…+0.1 วัน ทีละ 0.0001 วัน ไม่มีป้าย
- แถวล่างจากซ้าย: ป้ายสถานะ, Reset, Play backwards, Stop, Play forward (Play forward ถูกเลือกตอนเปิด)
- เลื่อน slider ขณะเวลาเดินอยู่ → Stop เมื่อ Stop เวลาคือค่าจากปฏิทินและช่องเวลา + offset ของ slider
- ปิดหน้าต่าง → Reset และ throttle 1

### 8.10 Dialog

- **Create new module / Edit module** (§3): Module name (สูงสุด 25 ตัวอักษร แก้ไม่ได้ตอน Edit), Ground station combo
  (QTH เรียงตามชื่อ แล้ว "** DEFAULT **" ท้ายสุด) + ปุ่ม Add, "Satellites" ที่มี combo กลุ่ม ("All satellites" ตามด้วยกลุ่ม CelesTrak),
  ช่องค้นหา, รายการ "Available Satellites" / "Catnum", ปุ่ม " --> " / " <-- ", รายการ "Selected Satellites" / "Catnum",
  ข้อความ "Double click on a satellite to move it to the other box." ปุ่ม Properties, Cancel, OK
- **Module properties** (§3–§7): แท็บ Layout, Refresh Rates, List View, Map View, Polar View, Single Sat View
  ทุกแท็บมีปุ่ม Reset กลับเป็นค่าตั้งต้นของ Gpredict ส่วนสี ภาพแผนที่ และ "Window Placements" อยู่ในงานที่ 4
- **Edit ground station data** (§10): Name, Description, Location, Latitude (°) + North/South, Longitude (°) + East/West,
  Locator (แก้แล้ว lat/lon เปลี่ยนตาม และกลับกัน), Altitude + "m ASL", Weather St ปุ่ม Clear, Cancel, OK
  ปุ่ม Select ของ Location และ Weather St กดไม่ได้ **(ของเรา: ไม่มีรายชื่อเมืองและสถานีอากาศ)** ไม่มีโหมด GPSD
- **Select a module** (File → Open module), **Clone Module**, ยืนยัน Delete ตามข้อความใน §1–§2
- **TLE Update**: "Updating TLE files from network" แล้วจำนวน Satellites updated / skipped / Missing Satellites และ "Finished"
  คำเตือนของแต่ละกลุ่มแสดงต่อท้ายเป็นภาษาไทย **(ของเรา)**

### 8.11 หน้าตา

- กรอบ เมนู แท็บ และ dialog เป็นโทนสว่างแบบ GTK 3 ตัวอักษรใช้ฟอนต์ระบบ
- สีใน Map และ Polar เป็นค่าตั้งต้นของ Gpredict ทั้งหมด
- ทำงานบน Chrome, Safari และ Firefox รุ่นปัจจุบัน หน้าจอกว้างอย่างน้อย 1024 px (ไม่ทำ layout สำหรับมือถือ)

## 9. การทดสอบ

### 9.1 Engine (`gnss-predict/tests/`)

- `render_ecef_script(..., with_velocity=False)` ตรงกับไฟล์ golden ที่สร้างจากโค้ดก่อนแก้ทุกไบต์
- `with_velocity=True`: มีคอลัมน์ VX/VY/VZ, `parse_ecef_report` อ่านความเร็ว, ดวงที่ไม่มีคอลัมน์ความเร็วถูกตัดพร้อมคำเตือน
- `propagate` รับ object ที่มีแค่ `prn` และ `tle_lines`
- `ecef_to_geodetic`: ตาม test ใน GNSS Studio access-reports spec §3.1 และเพิ่ม THBK
- `astro`: GMST เทียบ Meeus ตัวอย่าง 12.a และ 12.b, ดวงอาทิตย์เทียบตัวอย่าง 25.a (ไม่เกิน 0.01°)
- test เดิมทั้งหมดผ่านโดยไม่แก้

### 9.2 Server (`gpredict-web/server/tests/`)

- ช่วงคำนวณ: start/stop ทั้งเดินหน้าและถอยหลัง, จุดสั่งคำนวณช่วงใหม่, cache รายดวง, รันเฉพาะดวงที่ขาด,
  ยกเลิกงานของ module ที่ปิด, ไฟล์ cache บนดิสก์อ่านกลับได้ค่าเดิม (ใช้ `propagate` ปลอม)
- นาฬิกา: `forward`, `backward`, `stop`, throttle, Reset, ป้ายทั้ง 3 แบบ, เปลี่ยนสถานะแล้วเวลาไม่กระโดด (ใช้นาฬิกาปลอม)
- AOS/LOS: วงโคจรวงกลมที่คำนวณ AOS/LOS ได้ด้วยสูตร, pass สั้นที่อยู่ระหว่างสองจุด, pass ที่ตัดขอบช่วง, Always in/out
- ค่าที่คำนวณ: Doppler เป็นบวกเมื่อดาวเข้าใกล้, footprint, Loss, Delay, Maidenhead ของ THBK = `OK03jr`,
  Visibility ทั้ง 3 แบบ, Dir ทุกสัญลักษณ์, GEO และ Decayed, Orbit number เทียบสูตรของ Gpredict ด้วย TLE ตัวอย่าง,
  Orbit Phase ของวงโคจร Kepler ที่รู้ค่า
- layout code: preset 0–8 แปลงเป็นตำแหน่งตามตารางใน §3, code ผิดได้ `MODULE_INVALID`
- API และ WebSocket ด้วย `TestClient` รวมทุกรหัสในหัวข้อ 7.4 และการเปิดครั้งแรก (THBK + Amateur)
- integration กับ GMAT จริง (ข้ามถ้าไม่มี GmatConsole): ISS, ดาว GEO, ดาว Molniya ช่วง 2 ชม. เทียบค่าจากจุดทุก 30 วินาที
  กับ GMAT ที่รันทุก 1 วินาที: ตำแหน่งไม่เกิน 10 ม., Az/El ไม่เกิน 0.01° (El > 0), range rate ไม่เกิน 0.1 ม./วินาที,
  AOS/LOS ของ ISS ไม่เกิน 1 วินาที

### 9.3 Web (`web/`, Vitest)

ฟังก์ชันคำนวณล้วน: แปลงพิกัดบนแผนที่ (รวม center longitude), ตำแหน่งบน Polar ทั้ง 4 orientation, วง footprint บนแผนที่
(รวมกรณีครอบขั้วโลกและข้ามเส้น 180°), เส้นแบ่งกลางวัน-กลางคืน, รูปแบบตัวเลขและเวลาตาม §4, ตำแหน่งป้ายชื่อดาวใกล้ขอบ
ตรวจหน้าจอจริงด้วยการเปิดเว็บและถ่าย screenshot

## 10. เกณฑ์ว่าสำเร็จ

1. เปิด `python -m gpredict_web` ครั้งแรกแล้วเปิด `http://127.0.0.1:8740` ได้ module `Amateur` ที่ THBK
   ใน layout preset 0 และ Map, Polar, Single sat อัปเดตตามรอบ
2. สร้าง module ใหม่ที่มี ISS และดาว 10 ดวงด้วย layout "All views (wide)" แล้ว view ทั้ง 5 แบบอัปเดตตามรอบ
3. ความแม่นยำผ่านเกณฑ์ integration ในหัวข้อ 9.2
4. Time Controller: Play forward ที่ throttle 50, Play backwards, Stop แล้วตั้งเวลาไปอีก 3 วัน เห็น overlay
   "กำลังคำนวณวงโคจรด้วย GMAT…" แล้วหน้าจอกลับมาแสดงผล Reset กลับเป็น Real-Time
5. ปิดแล้วเปิด server และ browser ใหม่ ได้ module, ลำดับแท็บ และ QTH เดิม
6. ชื่อเมนู ปุ่ม คอลัมน์ และค่าตั้งต้นตรงกับรายการอ้างอิงทุกคำ ยกเว้นส่วนที่ติดป้าย **(ของเรา)**
7. test ทั้งหมดของ `gnss-predict` ผ่านโดยไม่แก้ test เดิม
