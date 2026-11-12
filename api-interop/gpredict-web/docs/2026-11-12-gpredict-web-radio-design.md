# Gpredict Web งานย่อยที่ 3: Radio & Rotator

- วันที่: 2026-11-12
- Branch: `feature/gpredict-web-radio` แตกจากปลายของ `feature/gpredict-web-passes` (ต้องใช้ Preferences และ `get_pass` ของงานย่อยที่ 2)
- สถานะ: รอผู้ใช้ตรวจ spec
- เอกสารที่เกี่ยวข้อง
  - [core spec](2026-11-11-gpredict-web-core-design.md) ("core")
  - [spec งานย่อยที่ 2](2026-11-12-gpredict-web-passes-design.md) ("passes")
  - [รายการอ้างอิงหลัก](2026-11-11-gpredict-reference.md) ("ref")
  - [รายการอ้างอิงส่วน Radio/Rotator](2026-11-12-gpredict-reference-radio.md) ("ref-R") ป้าย ปุ่ม tooltip ค่าตั้งต้น
    คำสั่ง hamlib และพฤติกรรมของ Gpredict 2.7 พร้อมเลขบรรทัด

## 1. ขอบเขต

### 1.1 สิ่งที่ผู้ใช้กำหนด

1. ใช้ควบคุมวิทยุและเสาอากาศจริงผ่าน hamlib (core §1)
2. ยังไม่มีฮาร์ดแวร์ ทดสอบกับ `rigctld`/`rotctld` โหมด dummy ผู้ใช้อนุญาตให้ติดตั้ง hamlib 4.7.2 ด้วย Homebrew (ติดตั้งแล้ว)
3. ดึงข้อมูล transponder จาก SatNOGS DB ได้ ไม่เกิน 1 ครั้งต่อ 2 ชม. แบบเดียวกับ CelesTrak

### 1.2 ทำ

| สิ่งที่ทำ | หัวข้อ |
|---|---|
| Module menu → Radio Control (หน้าต่าง "Gpredict Radio Control: <module>") | 4 |
| Module menu → Antenna Control (หน้าต่าง "Gpredict Rotator Control: <module>") | 5 |
| Edit → Preferences → Interfaces: แท็บ Radios, Rotators และ editor ทั้งสอง | 6 |
| Edit → Update transponder data และที่เก็บ transponder | 7 |
| Configure ถูกห้ามระหว่างเปิด controller (ref §2 ข้อ 9) | 4.6 |

### 1.3 ยังกดไม่ได้หลังงานนี้

Satellite info รวมแท็บ Transponders (4), กลุ่ม General และ Modules ใน Preferences (4)

## 2. หลักการ

1. ทำตามพฤติกรรมของ Gpredict ใน ref-R: ลำดับคำสั่ง hamlib, สูตร Doppler, ชนิดวิทยุ 6 แบบ, PTT, การหมุนปุ่มที่ตัววิทยุ,
   การล็อก uplink/downlink, flip pass และ lead-ahead ของ rotator
2. **แก้ข้อบกพร่องที่ทำให้ค้างหรือเสี่ยงกับฮาร์ดแวร์** แม้ Gpredict จะเป็นแบบนั้น เพราะต่อกับวิทยุจริง
   ทุกข้ออยู่ในหัวข้อ 9.1 พร้อมเหตุผล
3. ป้าย tooltip และข้อความของ Gpredict ใช้คำเดิมภาษาอังกฤษ รวมคำผิดของ Gpredict ที่ไม่ทำให้ใช้งานผิด
   เช่น tooltip ของ "Doppler:" ฝั่ง Uplink ที่เขียนว่า "downlink" (ref-R §13 ข้อ 17)

## 3. สถาปัตยกรรม

browser เปิด TCP ไปหา `rigctld` เองไม่ได้ และ Gpredict ติดตามดาวต่อตราบที่โปรแกรมยังเปิด จึงให้ **server เป็นเจ้าของ controller**

```
Browser: หน้าต่าง Radio/Antenna Control (แสดงสถานะ + ส่งคำสั่งผู้ใช้)
   │  REST คำสั่ง + สถานะใน tick ของ /ws/modules/{name}
   ▼
Server: RigController / RotController ต่อ module (asyncio task)
   │  TCP (hamlib net protocol)
   ▼
rigctld / rotctld (dummy ตอนนี้, วิทยุจริงภายหลัง)
```

### 3.1 ไฟล์ใหม่ใน `gpredict_web/`

| ไฟล์ | หน้าที่ |
|---|---|
| `hamlib.py` | client TCP แบบ asyncio ส่งทีละคำสั่ง อ่านคำตอบตามจำนวนบรรทัดที่คำสั่งนั้นตอบ มี timeout (หัวข้อ 9.1) |
| `hwconf.py` | อ่าน/เขียน/ตรวจค่า radio และ rotator |
| `rig.py` | RigController: state machine, Doppler, ชนิดวิทยุ, PTT, dial feedback, lock, AOS/LOS signalling (ref-R §3–4) |
| `rot.py` | RotController: set-point, flip pass, lead-ahead, threshold, client loop (ref-R §6–7) |
| `trsp.py` | ที่เก็บ transponder และการดึงจาก SatNOGS (ref-R §10–11) |

### 3.2 อายุของ controller

- **เปิด**: Module menu → Radio Control หรือ Antenna Control สร้าง controller ของ module นั้น ชนิดละหนึ่งตัว
  - กดซ้ำจะยกหน้าต่างเดิมขึ้นมา
- **ปิด**: ปิดหน้าต่าง ปิด module ลบ module หรือ File → Quit จะ disengage ก่อน (rotator ส่ง `S`, ทั้งสองส่ง `q`)
  แล้วบันทึก Cycle และ Threshold ลงไฟล์ของอุปกรณ์แบบเดียวกับ Gpredict (ref-R §9.3)
- **browser ไม่ได้เปิดอยู่**: controller ทำงานต่อ (ติดตามดาวต่อแม้ปิดแท็บ browser)
  - เปิด module นั้นอีกครั้ง หน้าต่าง controller ที่ยังเปิดอยู่ใน server กลับมาแสดงพร้อมสถานะปัจจุบัน
- **การคำนวณ**: core คำนวณ module เฉพาะเมื่อมี WebSocket ต่ออยู่ ตอนนี้ให้คำนวณด้วยเมื่อมี controller เปิดอยู่
  ช่วงคำนวณ GMAT จึงไม่ขาดระหว่างติดตามดาว
- **เวลา**: controller ใช้เวลาของ module (จริงหรือจำลองจาก Time Controller) เหมือน Gpredict ที่ส่งเวลาของ module ให้ทุกรอบ

### 3.3 ดาวเป้าหมาย

- เมื่อเป้าหมายของ module เปลี่ยน (Select satellite, คลิกเลือกใน view, Autotrack) web ส่ง `POST /api/modules/{name}/target`
- controller ทั้งสองเปลี่ยน combo ดาวตาม (ref-R §1)
- ตอนเปิด controller ใช้เป้าหมายของ module ถ้ามี ไม่งั้นใช้ดาวแรกตามชื่อ

## 4. Radio Control

### 4.1 หน้าต่าง

`FloatingWindow` ชื่อ "Gpredict Radio Control: <module>" จัดวางตาม ref-R §2.1

| กรอบ | ตำแหน่ง | เนื้อหา |
|---|---|---|
| " Downlink " | แถว 0 คอลัมน์ 0 | ref-R §2.2 |
| " Uplink " | แถว 0 คอลัมน์ 1 | ref-R §2.2 |
| "Satellite" | แถว 1 คอลัมน์ 0 | ref-R §2.4 |
| "Settings" | แถว 1 คอลัมน์ 1 | ref-R §2.5 |
| นับถอยหลัง | แถว 2 กว้างสองคอลัมน์ | ref-R §2.6 |

- **ปุ่มหมุนความถี่ (`FreqKnob`)**: ตาม ref-R §2.3
  - ตัวเลข 10 หลัก ไม่มีตัวคั่นระหว่างหลัก GHz กับหลักร้อย MHz
  - ปุ่ม ▴/▾ คลิกซ้าย/ขวา และล้อเมาส์ ทีละ 1 Hz ถึง 1 GHz
  - ค่านอกช่วง 0–9 999 999 999 ไม่เปลี่ยน
  - ตัวคั่นหลักพันใช้ของ locale ของ browser
- **ค่าที่แสดง**: Doppler `%.0f Hz`, LO `%.0f MHz`, Az/El `%7.2f°`, Range `%.0f km`, Rate `%.3f km/s`
  - นับถอยหลัง "AOS in"/"LOS in" ตามด้วย `HH:MM:SS` หรือ `MM:SS`
- **ช่อง "Filter..."**: กรองชื่อดาวแบบไม่สนตัวพิมพ์ ใน combo ดาว
- **สถานะ (ของเรา)**: บรรทัดภาษาไทยท้ายหน้าต่าง แสดงข้อผิดพลาดล่าสุด เช่น "เชื่อมต่อ rigctld ที่ localhost:4532 ไม่ได้"
  และเหตุที่ disengage เอง Gpredict มีแค่ปุ่ม Engage ที่เด้งออกและบันทึกลง log

### 4.2 พฤติกรรม (ref-R §3)

- **State machine**: Engage, Track, Lock ("L"), Tune ("T"), เลือกดาว, เลือก transponder, Cycle, disengage เองเมื่อผิดพลาด 5 รอบติด
- **สูตรความถี่**: Doppler และ LO ตาม ref-R §3.2 ทุกสูตร
  - Downlink Doppler = −f·rr/c, Uplink Doppler = +f·rr/c
  - วิทยุ = ดาว + Doppler − LO
  - c = 299 792.458 km/s
- **Range rate**: มาจากค่าที่คำนวณด้วย GMAT ของ core ที่เวลาของ module
- **Transponder**: Tune ไปกลาง passband และล็อกแบบ normal/inverting ตาม ref-R §3.3
  - ไม่จำกัดค่าให้อยู่ใน passband เหมือน Gpredict
- **ชนิดวิทยุ**: 6 แบบ และ "2. Device" (dual-rig) ส่งคำสั่งตาม ref-R §3.4
  - เกณฑ์ส่งความถี่ใหม่ 1 Hz (FT817 auto ฝั่ง TX 10 Hz ทุก 10 วินาที)
  - อ่านค่ากลับหลังตั้งความถี่ทุกครั้ง
- **Dial feedback**: ตาม ref-R §3.5
- **PTT**: None, Read PTT (`t`), Read DCD (ไบต์ 0x8B) ตาม ref-R §3.6
- **ปุ่ม SPACE สำหรับ "FT817/857/897 (manual)"**: กดในหน้าต่าง Radio Control ที่มี focus แล้ว web ส่งคำสั่งสลับ PTT
- **AOS/LOS signalling**: ส่ง `AOS`, `LOS`, `U IQRECORD 1`, `U IQRECORD 0` ตามธงในไฟล์ เฉพาะเมื่อ Engage และ Track เปิดอยู่
  - ไม่ตรวจคำตอบ (ref-R §3.7)

### 4.3 คำสั่ง hamlib (ref-R §4.1)

- ส่งตามตารางของ ref-R ทุกตัวอักษร เช่น `F  145890000\n` (เลขชิดขวา 10 ตัว), `f\n`, `I …`, `S 1 VFOA\n`
- รวมการตรวจ VFO option (`\set_vfo_opt 1` แล้ว `\chk_vfo`) ทุกครั้งที่เชื่อมต่อ
- **คำตอบของคำสั่งตั้งค่า**: ต้องขึ้นต้นด้วย `RPRT 0`
- **คำตอบของคำสั่งอ่านค่า**: ถ้าขึ้นต้นด้วย `RPRT` ถือเป็น error

### 4.4 ค่าเริ่มเมื่อเปิดหน้าต่าง

ตาม ref-R §2.7

- เลือกอุปกรณ์แรกตามชื่อ
- ความถี่เริ่มเป็นค่าตั้งต้นของอุปกรณ์
- เลือกดาวแล้วจูนไป transponder แรก
- Track, Lock และ Engage ปิดอยู่

### 4.5 ไม่มีอุปกรณ์

- ไม่มีวิทยุสักตัว: แสดงกล่อง "ERROR" ข้อความ "You have no radio configuration!\nPlease configure a radio first."
- ไม่มี rotator: แสดง "You have no rotator configuration!\nPlease configure an antenna rotator first." (ref-R §1)

### 4.6 Configure ถูกห้าม

- ระหว่างที่ controller ของ module เปิดอยู่ Module menu → Configure แสดงกล่องที่ไม่มีชื่อหน้าต่าง
  ข้อความ "A module can not be configured while the radio or rotator controller is active.\n\nPlease close the radio and rotator controllers and try again."
- server ตอบ `PUT /api/modules/{name}` ด้วย 409 `CONTROLLER_ACTIVE` ด้วย กันกรณีมีอีกแท็บเปิดอยู่

## 5. Antenna Control

### 5.1 หน้าต่าง

`FloatingWindow` ชื่อ "Gpredict Rotator Control: <module>" ซ้ายเป็น Polar plot ขวาเป็น grid ของกรอบ ref-R §5.1

| กรอบ | เนื้อหา |
|---|---|
| "Azimuth", "Elevation" | ปุ่มหมุน `RotKnob` (ref-R §5.2) และบรรทัด "Read:" |
| "Satellite" | Filter, combo ดาว, "Track", Az, El และ ΔT |
| "Settings" | "Device:", "Engage", "Monitor", "Cycle:" msec และ "Threshold:" deg |

- **Polar plot**: ใช้ component Polar plot ของ passes เพิ่มเครื่องหมาย 3 แบบในสีดาวตาม ref-R §5.6
  - เป้าหมาย: สี่เหลี่ยม 4 px
  - set-point: วงกลมรัศมี 7 px
  - ตำแหน่ง rotator: กากบาท
- **เส้นทาง pass บน plot**: pass ปัจจุบัน หรือ pass ถัดไปใน 3 วัน ใช้ `get_pass(…, min_el = 0)` ของ passes (ref-R §6.5)

### 5.2 พฤติกรรม (ref-R §6)

- **timer ควบคุม**: ทำงานทุก Cycle ตั้งแต่เปิดหน้าต่าง
  - คำนวณ set-point ตาม ref-R §6.2 (ใต้ขอบฟ้า: ใช้ Az ของ AOS/LOS, flip pass เมื่อ Max El ≥ 180, ชนิด −180…+180)
  - ตรวจ Threshold
  - lead-ahead ด้วยการค้นแบบแบ่งครึ่งบนเวลาข้างหน้า (ref-R §6.4) ใช้ ephemeris ของ module ที่ interpolate ได้
- **client loop**: ส่ง `P %.2f %.2f` (จุดทศนิยมเสมอ ไม่ขึ้นกับ locale) รอ 100 ms อ่าน `p` แล้วพักให้ครบอย่างน้อย 0.8 วินาที
  เหมือน Gpredict (ref-R §6.1) เพื่อไม่สั่ง rotator ถี่เกิน
- **Monitor**: อ่านตำแหน่งอย่างเดียว ไม่ส่ง `P`
- **Disengage**: ส่ง `S` แล้ว `q`
- **ผิดพลาด 5 รอบติด**: disengage พร้อมบรรทัดสถานะภาษาไทย (ของเรา)

## 6. Preferences → Interfaces

### 6.1 หน้า (ref-R §8)

| แท็บ | เนื้อหา |
|---|---|
| "Radios" | ตาราง 15 คอลัมน์ เรียงตามชื่อ ปุ่ม "Add new", "Edit", "Delete" |
| "Rotators" | ตาราง 8 คอลัมน์ ปุ่ม "Add New" (N ตัวใหญ่ตาม Gpredict), "Edit", "Delete" |
| "Edit radio configuration" | ทุกช่อง ช่วง ค่าตั้งต้น tooltip และกติกาความสอดคล้อง (เช่น Half-duplex บังคับ Read PTT) ปุ่ม "Clear", "Cancel", "Ok" |
| "Edit rotator configuration" | ทุกช่อง การเปลี่ยน Az type ที่ตั้ง Min/Max/end stop ให้ ปุ่มเหมือนกัน |

- **ค่าของวิทยุใหม่จาก "Add new"**: Default downlink 0.000 MHz, Default uplink 123.456 MHz ตาม Gpredict
  ส่วนปุ่ม Clear ใช้ 145.890 ทั้งสองค่า
- **การบันทึก**: แก้ใน dialog แล้วมีผลเมื่อกด OK ของ Preferences เท่านั้น Cancel ทิ้งทั้งหมด

### 6.2 ที่เก็บ (`hwconf.py`)

| ไฟล์ | ช่อง (ชื่อตาม key ของ Gpredict ใน ref-R §9) |
|---|---|
| `data/hwconf/<name>.rig.json` | Host, Port, Cycle, LO, LO_UP, DefaultUplinkFreqHz, DefaultDownlinkFreqHz, Type, PTT, VFO_UP, VFO_DOWN, SIGNAL_AOS, SIGNAL_LOS, SIGNAL_AOIQ, SIGNAL_LOIQ |
| `data/hwconf/<name>.rot.json` | Host, Port, Cycle, Threshold, AzType, MinAz, MaxAz, MinEl, MaxEl, AzStopPos |

- ชื่อตามกติกาของ Gpredict `^[A-Za-z0-9_-]{1,25}$`
- เขียนผ่านไฟล์ชั่วคราวแล้ว rename เหมือน core
- ค่าที่ขาดในไฟล์ใช้ค่าตั้งต้นของ ref-R §9

## 7. Transponder

### 7.1 Edit → Update transponder data (ref-R §11)

- **หน้าต่าง**: modal ชื่อ "Transponder Update"
  - ข้อความ "<b>Updating transponder files from network</b>"
  - บรรทัดกิจกรรม "..." → "Fetching transmitters.json" → "Finished"
  - แถบความคืบหน้า และปุ่ม "Close" ที่กดได้เมื่อเสร็จ
- **ข้อมูลที่ดึง**: `https://db.satnogs.org/api/modes/?format=json` แล้ว `…/transmitters/?format=json`
  - User-Agent `gpredict-web` ไม่ใส่ข้อมูลผู้ใช้
  - timeout 30 วินาที
- **กติกา 1 ครั้งต่อ 2 ชม.**: บันทึกเวลาขอและเวลาสำเร็จที่ `data/trsp/_cache/state.json`
  - ถ้ายังไม่ครบ 2 ชม. ใช้ไฟล์ใน `_cache` ไม่ส่ง request
  - บรรทัดภาษาไทยใต้ "Finished" บอกว่าใช้ข้อมูลที่ดึงเมื่อไร **(ของเรา)**
- **ดึงไม่ได้**: แสดง "Finished" เหมือน Gpredict และบรรทัดภาษาไทยบอกสาเหตุ **(ของเรา)**
  - ไม่ลบข้อมูลเดิม (Gpredict ล้างไฟล์ cache ก่อนดึง)
- **การแปลง JSON** ตาม ref-R §11.3 ทุกข้อ
  - transmitter ที่ไม่มี `description` ถูกข้าม
  - ชื่อ mode ตัดที่ 19 ตัวอักษร
  - `alive` = false ก็เก็บเหมือน Gpredict
  - ดาวที่ไม่อยู่ในข้อมูลใหม่คงไฟล์เดิม
  - ผลเก็บที่ `data/trsp/<NORAD>.json` เป็นรายการ `{name, up_low, up_high, down_low, down_high, invert, mode, baud}` ตามลำดับใน JSON
- **controller ที่เปิดอยู่**: ใช้รายการเดิมจนกว่าจะเลือกดาวใหม่ (ref-R §10.3)

### 7.2 การอ่าน

- ปรับค่าตาม ref-R §10.1
  - ค่าติดลบเป็น 0
  - มีค่าเดียวในคู่ low/high ให้คัดลอกไปอีกค่า
- beacon คือ transponder ที่ไม่มี uplink และ DOWN_LOW = DOWN_HIGH

## 8. API, tick และ error ที่เพิ่ม

| Method | Path | ทำอะไร |
|---|---|---|
| GET/PUT | `/api/hwconf` | `{radios: [...], rotators: [...]}` PUT แทนทั้งชุดเมื่อกด OK ของ Preferences ตรวจทุกตัวก่อนเขียน |
| POST | `/api/modules/{name}/target` | `{norad}` เป้าหมายของ module |
| POST | `/api/modules/{name}/radio/open`, `/close` | เปิด/ปิด controller (409 `NO_RADIO_CONFIG` เมื่อไม่มีวิทยุ) |
| POST | `/api/modules/{name}/radio` | `{action, ...}`: `engage`, `track`, `lock`, `tune`, `satellite`, `transponder`, `device1`, `device2`, `cycle`, `freq` (`{link: "down"\|"up", hz}`), `ptt_toggle` |
| POST | `/api/modules/{name}/rotator/open`, `/close` | เปิด/ปิด (409 `NO_ROTATOR_CONFIG`) |
| POST | `/api/modules/{name}/rotator` | `{action, ...}`: `engage`, `track`, `monitor`, `satellite`, `device`, `cycle`, `threshold`, `az`, `el` |
| POST | `/api/trsp/update` | ดึง SatNOGS ตามหัวข้อ 7.1 คืนสถานะ และบอกว่าใช้ cache หรือไม่ |
| GET | `/api/trsp/{norad}` | รายการ transponder |

- **tick**: tick ของ module เพิ่ม `radio` และ `rotator` เมื่อ controller เปิดอยู่ มีทุกค่าที่หน้าต่างแสดง
  (ปุ่มหมุนทั้ง 4, Doppler, LO, สถานะปุ่ม, combo, ข้อความนับถอยหลัง, ตำแหน่งที่อ่านได้, ข้อความสถานะ)
- **คำสั่งจากผู้ใช้**: มีผลในรอบ cycle ถัดไปของ controller เหมือน Gpredict ที่ทำงานตาม timer
- **รหัสใหม่**:
  - `HWCONF_INVALID` (422)
  - `NO_RADIO_CONFIG`, `NO_ROTATOR_CONFIG` (409)
  - `CONTROLLER_ACTIVE` (409)
  - `TRSP_DOWNLOAD_FAILED` (warning ในคำตอบ)

## 9. ข้อตกลงที่ต่างจาก Gpredict

### 9.1 แก้ข้อบกพร่อง

| ข้อ ref-R §13 | Gpredict | ของเรา | เหตุผล |
|---|---|---|---|
| 8 | socket ไม่มี timeout, ชื่อ host ที่หาไม่เจอไม่ตรวจ | เชื่อมต่อ timeout 3 วินาที, รอคำตอบ 2 วินาที, host หาไม่เจอนับเป็น error | ไม่ให้ controller ค้างตลอดไป |
| 9 | คำขอ cycle ต่อคิวสะสมเมื่อ rigctld ช้า | ถ้ารอบก่อนยังไม่จบ ข้ามรอบนั้น | ไม่ให้คำสั่งค้างเป็นกอง |
| 5 | ตั้ง PTT ส่ง `T 1\nq\n` | ส่ง `T 1\n` ไม่มี `q` | `q` สั่ง rigctld ปิดการเชื่อมต่อกลาง cycle |
| 7 | FT817 split ส่งเลข VFO ที่ไม่ได้อ่านจากไฟล์ | ส่ง `S 1 VFOB` (รับ A ส่ง B) และ `S 0 VFOA` | ค่าของ Gpredict ไม่แน่นอน ต้องยืนยันกับวิทยุจริงภายหลัง |
| 12 | rotctld เชื่อมต่อไม่ได้ ไม่แสดง error ปุ่มยังกดค้าง | "Read:" แสดง "ERROR" นับ error และ disengage เมื่อครบ 5 | ผู้ใช้ต้องรู้ว่าเสาไม่ได้หมุน |
| 13 | rotator −180…+180 เทียบ Az ผิดช่วง ส่งคำสั่งทุกรอบ | เทียบในช่วงเดียวกัน | ไม่สั่ง rotator โดยไม่จำเป็น |
| 15 | สถานะกดได้ของ Monitor อัปเดตเฉพาะตอนกด Track | อัปเดตทุกครั้งที่ Track หรือ Engage เปลี่ยน | ข้อบกพร่อง |
| 16 | timer ของ rotator ลงทะเบียนสองครั้ง | ครั้งเดียว | ข้อบกพร่อง |
| 1 | OK ของ Preferences ทำให้ Cycle เป็น 10 ms และ Threshold เป็น 0.1° | คงค่า Cycle และ Threshold เดิม | ข้อบกพร่อง สั่งอุปกรณ์ถี่เกิน |
| 2 | ดับเบิลคลิกแถววิทยุเปิด editor สองครั้ง | ครั้งเดียว | ข้อบกพร่อง |
| ref-R §8.1 | ชื่ออุปกรณ์ซ้ำได้ ตัวหลังทับตัวแรก | ปฏิเสธชื่อซ้ำพร้อมข้อความไทย **(ของเรา)** | กันข้อมูลหาย |
| 19 | Update transponder ล้างไฟล์ก่อนดึง ดึงไม่ได้ก็ "Finished" เงียบ | ไม่ล้างจนกว่าจะดึงสำเร็จ บอกสาเหตุเป็นภาษาไทย | กันข้อมูลหาย |

### 9.2 ทำตามแม้ดูแปลก

- "Add new" ได้ uplink 123.456 MHz
- LO รับเฉพาะ MHz เต็ม
- "2. Device" เรียงตามลำดับไฟล์ ไม่เรียงตามชื่อ (ref-R §13 ข้อ 10)
- ไม่จำกัด passband
- client loop ของ rotator ไม่ขึ้นกับ Cycle
- เมื่อดาวอยู่ใต้ขอบฟ้าและไม่มี pass ตั้ง set-point เป็น Az 0°, El 45°
- เก็บ transmitter ที่ `alive` = false

## 10. การทดสอบ

- **Server (unittest)**
  - **fake `rigctld`/`rotctld`**: server TCP แบบ asyncio ใน test บันทึกทุกคำสั่งและตอบตามที่ test กำหนด
  - **ลำดับคำสั่ง**: ตรวจทุกตัวอักษรของทุกชนิดวิทยุ, dual-rig, VFO option, PTT ทั้ง 3 แบบ, SPACE, signalling และ disengage
  - **สูตร**: Doppler/LO ทั้ง 6 สูตร, lock normal/inverting, tune beacon
  - **error**: dial feedback, error 5 ครั้งแล้ว disengage, timeout, ข้ามรอบเมื่อช้า
  - **rotator**: set-point ทุกกรณีของ ref-R §6.2, flip pass, lead-ahead, threshold, Monitor, ±180, การนับ error
  - **hwconf**: ตรวจค่าทุกช่อง, PUT แทนทั้งชุด, ชื่อซ้ำ
  - **transponder**: แปลง SatNOGS จาก fixture JSON (ไม่ต่อเน็ตใน test), กติกา 2 ชม., ดึงไม่ได้แล้วไม่ลบของเดิม
  - **API**: ทุก action, Configure ถูกห้าม, controller ทำงานต่อเมื่อไม่มี socket, ปิด module แล้ว disengage
- **Web (Vitest)**: ข้อความของปุ่มหมุนความถี่ (เว้นช่องและตัวคั่น), การเพิ่มลดทีละหลัก, ข้อความของปุ่มหมุนมุม,
  เครื่องหมายบน Polar plot, ข้อความในตาราง Radios/Rotators (เช่น "FT817/857/897 (man)", "YES"/"NO")
- **ตรวจรับกับ hamlib จริง**: `rigctld -m 1` (dummy) port 4532 และ `rotctld -m 1` port 4533

## 11. เกณฑ์ว่าสำเร็จ

1. Preferences → Interfaces เพิ่มวิทยุ "DUMMY" (localhost:4532, Full-duplex) และ rotator "ROT" (localhost:4533)
   ปิดแล้วเปิด server ใหม่ ค่ายังอยู่
2. Radio Control ของ module `Amateur` เลือก ISS, Track, Engage กับ `rigctld -m 1`
   - `f` ที่อ่านจาก rigctld ตรงกับ (ความถี่ดาว + Doppler − LO) ไม่เกิน 1 Hz ทุกรอบ
   - Doppler เปลี่ยนตาม range rate ของ GMAT
3. ตั้งความถี่ที่ rigctld เองจากภายนอก (`rigctl -m 2 -r localhost:4532 F …`) แล้วปุ่มหมุนของดาวในหน้าต่างเปลี่ยนตาม (dial feedback)
4. Antenna Control กับ `rotctld -m 1` ขณะ ISS อยู่เหนือขอบฟ้า: ตำแหน่งที่อ่านได้ตาม set-point ภายใน Threshold
   และกากบาทบน Polar plot เดินตามดาว
5. หยุด `rigctld` ระหว่าง Engage: ภายใน 5 รอบปุ่ม Engage เด้งออก บรรทัดสถานะบอกสาเหตุ server ไม่ค้าง
6. Update transponder data ดึงจาก SatNOGS ได้ 1 ครั้ง กดซ้ำภายใน 2 ชม. ใช้ cache
   - combo transponder ของ ISS มีรายการ
   - ปุ่ม "T" จูน downlink ไปกลาง passband
7. Configure ระหว่างเปิด Radio Control ได้ข้อความของ Gpredict
8. test ทั้งหมดผ่าน และ GNSS Studio ได้ผลเหมือนเดิมทุกไบต์
