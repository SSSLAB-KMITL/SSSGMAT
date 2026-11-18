# Gpredict Web งานย่อยที่ 2: Pass predictions

- วันที่: 2026-11-12
- Branch: `feature/gpredict-web-passes` แตกจาก `feature/gpredict-web-core` (f09a5c0) ทำใน worktree `.worktrees/gpredict-web`
- สถานะ: รอผู้ใช้ตรวจ spec
- เอกสารที่เกี่ยวข้อง
  - [core spec](2026-11-11-gpredict-web-core-design.md) (งานย่อยที่ 1 ต่อไปเรียกว่า "core") กติกาทั้งหมดของ core ใช้ต่อ เว้นแต่เอกสารนี้เขียนแทน
  - [รายการอ้างอิงหลัก](2026-11-11-gpredict-reference.md) ("ref")
  - [รายการอ้างอิงส่วน Pass predictions](2026-11-12-gpredict-reference-passes.md) ("ref-P") ป้าย คอลัมน์ รูปแบบตัวเลข ข้อความ
    และพฤติกรรมของ Gpredict 2.7 ที่ตรวจจาก source พร้อมเลขบรรทัด เอกสารนี้อ้างหัวข้อของ ref-P แทนการคัดลอกป้ายซ้ำ
  - [รายการอ้างอิงส่วน Data & Preferences](2026-11-12-gpredict-reference-data.md) ("ref-D") ใช้เฉพาะโครงหน้าต่าง Preferences

## 1. ขอบเขต

### 1.1 สิ่งที่ผู้ใช้กำหนด (ต่อจาก core)

1. ทำให้ครบทุกอย่างที่ Gpredict เดิมมี (งานย่อย 2, 3, 4)
2. ตรวจ spec ทั้ง 3 ชุดก่อน แล้วทำต่อรวดเดียวจนจบ
3. ตำแหน่งดาวทุกค่ายังต้องมาจาก GMAT

### 1.2 ทำ

| สิ่งที่ทำ | รายละเอียดใน |
|---|---|
| คลิกขวาที่ดาว → Show current pass, Show next pass, Future passes (ทุก view ที่ Gpredict มี) | หัวข้อ 4 |
| หน้าต่าง Pass details (แท็บ Data, Polar, Az/El และปุ่ม Print, Save, Close) | หัวข้อ 5 |
| หน้าต่าง Upcoming passes (Future passes) และ Save Passes | หัวข้อ 6 |
| Module menu → Sky at a glance | หัวข้อ 7 |
| Edit → Preferences: โครงหน้าต่าง Preferences และกลุ่ม Predict ครบ 4 แท็บ | หัวข้อ 8 |
| ค่า Twilight threshold มีผลกับรหัส V/D/E ในทุก view ของ core | หัวข้อ 8.3 |

### 1.3 ปรับการแบ่งงานจาก core §1

core ใส่ Preferences ทั้งหมดไว้ในงานย่อยที่ 4 แต่หน้าต่าง pass ต้องใช้ค่าในกลุ่ม Predict และ Radio/Antenna Control
ต้องใช้กลุ่ม Interfaces จึงแบ่งใหม่เป็น

| งานย่อย | กลุ่มใน Preferences |
|---|---|
| 2 (เอกสารนี้) | โครงหน้าต่าง + Predict |
| 3 | Interfaces |
| 4 | General, Modules |

ไอคอนของกลุ่มที่ยังไม่ทำแสดงแต่กดไม่ได้ พร้อม tooltip ของ `later.ts` เหมือนเมนูอื่นใน core

### 1.4 ยังกดไม่ได้หลังงานนี้

Satellite info และชื่อดาวตัวหนาในเมนูคลิกขวา (4), Radio Control, Antenna Control, Update transponder data (3),
Log browser, Update TLE data from local files, Detach module, Full screen (4)

## 2. หลักการเทียบกับ Gpredict

1. **ทำตามพฤติกรรมของ Gpredict** ตาม ref-P รวมถึงพฤติกรรมแปลกที่ผู้ใช้มองเห็น เช่น "Show current pass" ใช้การค้นแบบเดียวกับ
   "Show next pass" (ref-P §1.2) และ Upcoming passes อาจมี pass เกินช่วงวันได้ 1 pass (ref-P §3.5)
2. **ไม่ทำตามข้อบกพร่องที่เป็นความผิดพลาดของโค้ด** และบันทึกทุกข้อในหัวข้อ 10.1 เช่น Reset ของหน้า Single Pass
   ที่อัปเดตกล่องบนจอแค่ 10 จาก 19 กล่อง
3. **เวลาและมุมใช้ค่าที่ละเอียดกว่า Gpredict** เพราะตำแหน่งมาจาก GMAT และ core หา AOS/LOS ละเอียดถึง 0.1 วินาทีอยู่แล้ว
   (หัวข้อ 3.3) จึงต่างจาก Gpredict ในระดับวินาทีถึงสิบวินาที ข้อนี้อยู่ในหัวข้อ 10.1
4. ป้าย ชื่อหน้าต่าง คอลัมน์ ปุ่ม และข้อความของ Gpredict ใช้คำเดิมภาษาอังกฤษ ข้อความที่เราเพิ่มเป็นภาษาไทย
   ส่วนที่ Gpredict ไม่มีเขียนกำกับ **(ของเรา)**

## 3. การคำนวณ pass ด้วย GMAT

### 3.1 Ephemeris รายวัน (`gpredict_web/ephem.py` เพิ่ม)

ช่วงคำนวณ 16 ชม. ของ core ไม่พอสำหรับ Future passes (ถึง 15 วัน) จึงเพิ่ม cache แบบรายวันแยกจากช่วงของ module

| ค่า | ค่า |
|---|---|
| หน่วย cache | 1 ดาว × 1 วัน UTC (block) เวลา `[d 00:00, d+1 00:00]` ทุก `STEP_S` = 30 วินาที รวม 2881 epoch |
| ไฟล์ | `data/ephem/day/<YYYYMMDD>/<tle key>.f64` รูปแบบเดียวกับ core §5.3 |
| การรัน GMAT | งานหนึ่งคำนวณทุก (ดาว, วัน) ที่ขาดในคำขอ รันครั้งเดียวตั้งแต่วันแรกถึงวันสุดท้ายที่ขาด แล้วตัดเป็น block |
| การต่อ block | ต่อ block ของวันติดกันเป็น `SatEphem` เส้นเดียว (epoch ตรงกันพอดีที่เที่ยงคืน ใช้จุดเดียว) แล้วใช้ `find_passes` ของ core ได้ทันที |
| คิว | ใช้คิว GMAT เดียวกับ core งานของช่วง module มาก่อนงาน block (ลำดับความสำคัญ 2 ระดับ) เพื่อไม่ให้การติดตามดาวค้าง |
| ยกเลิก | งาน block ที่ไม่มีคำขอรออยู่แล้ว (ผู้ใช้ปิดหน้าต่างหรือกด Cancel) ถูกตัดออกจากคิวหรือ `killpg` แบบเดียวกับ core §5.2 |
| หน่วยความจำ | เก็บ block ที่โหลดแล้วแบบ LRU ไม่เกิน 400 block (ราว 55 MB) ที่เหลืออ่านจากดิสก์เมื่อใช้ |
| ลบไฟล์เก่า | ตอนเปิด server ลบโฟลเดอร์วันที่เก่ากว่าวันนี้ 7 วัน |

ประมาณเวลา: ดาว 1 ดวง 4 วันราว 5 วินาที, 99 ดวง 1 วันราว 30 วินาที (จากผลวัดของ core 99 ดวง 16 ชม. 17 วินาที)

### 3.2 ช่วงข้อมูลที่ขอ

| ผู้ใช้ | เริ่ม | สิ้นสุด |
|---|---|---|
| Show next/current pass, Future passes | วันของ (เวลาเริ่ม − 1 วัน) เพื่อให้ pass ที่กำลังผ่านมี AOS | เวลาเริ่ม + "Passes should occur within" + 1 วัน |
| Sky at a glance | วันของ (T0 − 1 วัน) | T0 + 2 × "Find and show passes that occur within" |
| Pass details ของ pass ที่รู้ AOS แล้ว | วันของ AOS | วันของ LOS |

pass ที่ตามกติกาของ Gpredict จะเริ่มหลังเวลาสิ้นสุดนี้ไม่ถูกนับ (หัวข้อ 10.1)

### 3.3 ค่าของ pass (`gpredict_web/pass_predict.py` ใหม่ ไม่มี I/O)

- **AOS, LOS**: จาก `passes.find_passes` ของ core (El = 0°, แบ่งครึ่งถึง 0.1 วินาที)
- **TCA, Max El**: จุดสูงสุดจริงด้วย golden-section ของ core
  - Gpredict เอาค่าจากแถวที่สุ่มตัวอย่าง จึงอาจต่ำกว่าค่าจริงเล็กน้อย
- **Max El Az**: Az ที่ TCA
- **AOS Az, LOS Az**: Az ที่ AOS และ LOS
- **Orbit**: เลข orbit ที่ AOS ตามสูตร TLE ของ core §6.2
- **Vis**: สตริง 3 ตัวจากแถวที่สุ่มตัวอย่าง (`V`, `D`, `E` แบบ ref-P §4.6) และเพิ่มจุด TCA
  - Twilight threshold มาจาก Preferences
- **แถวของ Data**: ทำตาม ref-P §2.3
  - `step = max((LOS − AOS) / Number of entries, Time resolution)`
  - เวลาแถวคือ `AOS + k·step` สำหรับ k = 0, 1, … ตราบที่ไม่เกิน LOS (คูณ ไม่บวกสะสม)
  - แต่ละแถวมีครบ 19 ค่าใน ref-P §2.2 คำนวณจาก ephemeris ด้วยฟังก์ชันของ `observe.py`
  - คอลัมน์ MA เป็น phase × 256/360 เหมือน Gpredict
- **ดาวขึ้นได้ไหม (`has_aos`)**: ตามกติกาของ ref-P §4.1 ได้แก่ GEO, decayed, mean motion 0 และรูปวงโคจรที่ไปไม่ถึงละติจูดของสถานี
  - เป็นข้อยกเว้นเพิ่มในกลุ่มเดียวกับข้อ 3 ของ core §6.2 คือตัดสินจากค่าใน TLE (ความเอียง, apogee) ไม่ได้ใช้เป็นตำแหน่งดาว

### 3.4 เลือก pass ตามกติกาของ Gpredict

`get_pass(start, limit, min_el)` และ `get_passes(start, days, count, min_el)` ทำงานบนรายการ pass ที่หาได้ในหัวข้อ 3.3
ให้ผลแบบเดียวกับ ref-P §4.5 และ §4.8

1. **pass ผ่าน**: pass ผ่านเมื่อ Max El ≥ min_el ถ้าไม่ผ่านให้ค้นต่อจาก LOS + 0.014 วัน ส่วน limit ยังนับจาก start ของการเรียกครั้งนั้น
2. **pass ที่กำลังผ่านอยู่ ณ start**: นับเป็น pass แรก (AOS อยู่ในอดีต) แต่ตาม ref-P §3.5 ข้อ 7 จะคืนให้เฉพาะเมื่อ AOS
   ถัดไปอยู่ภายใน limit
3. **`get_passes`**: ค้นต่อจาก LOS + 0.014 วันของ pass ก่อนหน้า ช่วงวันจึงเลื่อนตาม (ref-P §3.5 ข้อ 4–6)
   หยุดเมื่อครบ count เมื่อหาไม่เจอ หรือเมื่อจุดเริ่มค้น ≥ start + days
4. **ข้อมูลไม่พอ**: ถ้าต้องใช้ข้อมูลเกินช่วงในหัวข้อ 3.2 ถือว่าไม่มี pass ต่อจากนั้น

## 4. Show current pass, Show next pass, Future passes

### 4.1 ที่อยู่ของเมนู

- เปิดใช้รายการเหล่านี้ในเมนูคลิกขวาของ List, Map, Polar, Single sat และ Event list ซึ่ง core แสดงไว้แต่กดไม่ได้
- "Show current pass" แสดงเฉพาะเมื่อ El > 0 ณ tick ที่สร้างเมนู
- ตอนคลิก ถ้า El ไม่ > 0 แล้วไม่ทำอะไร (ref-P §1.1)

### 4.2 เวลาเริ่ม (ref-P §1.2–1.3)

| รายการ | เวลาเริ่ม |
|---|---|
| Show next pass | ดาวอยู่ใต้ขอบฟ้า: เวลาของ module ใน tick ที่ view ใช้อยู่ ดาวอยู่เหนือขอบฟ้า: LOS ของ pass ปัจจุบัน + 0.007 วัน |
| Show current pass | เวลาของ module (ค้นแบบเดียวกับ Show next pass จึงได้ pass ปัจจุบันเมื่อผ่าน Minimum elevation ไม่งั้นได้ pass ถัดไป) |
| Future passes | เวลาของ module |

- ถ้าเปิด "Always use real time for pass predictions" ทั้งสามรายการเริ่มจากเวลาเครื่องของ server
- web ส่งเวลาของ tick ไปพร้อมคำขอ server เลือกใช้ตามค่านี้

### 4.3 ไม่มี pass

กล่องข้อความแบบ modal ปุ่ม OK ข้อความภาษาอังกฤษตาม ref-P §1.4 ทุกตัวอักษร (รวม "within the next 1 days")
ไม่มีชื่อหน้าต่างเหมือน Gpredict

| กรณี | ไอคอน | ข้อความ |
|---|---|---|
| `has_aos` เป็นเท็จ: Show next/current pass | error | ข้อความยาว "Satellite %s has no passes for\nthe current ground station!\n\nThis can be because…" |
| `has_aos` เป็นเท็จ: Future passes | error | ข้อความสั้น |
| ไม่มี pass ผ่านเกณฑ์ใน "Passes should occur within" วัน | info | "Satellite %s has no passes\nwithin the next %d days" |

### 4.4 ระหว่างรอ GMAT **(ของเรา)**

Gpredict ตอบทันที ของเราอาจต้องรอ GMAT

- ถ้าคำนวณ block ไม่เสร็จใน 0.5 วินาที แสดงกล่องเล็ก "กำลังคำนวณวงโคจรด้วย GMAT…" พร้อมปุ่ม Cancel
- Cancel ยกเลิกคำขอ server จะตัดงานถ้าไม่มีคำขออื่นรออยู่
- GMAT ล้มเหลว: กล่องเดียวกันแสดงข้อความ error พร้อมปุ่ม Retry

## 5. หน้าต่าง Pass details

- **หน้าต่าง**: `FloatingWindow` ที่ไม่ใช่ modal ชื่อ "Pass details for %s (orbit %d)" ความสูงเริ่ม 300 px เปิดได้หลายหน้าต่างพร้อมกัน (ref-P §2.1)
- **ความสัมพันธ์กับหน้าต่างแม่**: หน้าต่างที่เปิดจาก Upcoming passes ปิดตามเมื่อปิดหน้าต่างแม่
  หน้าต่างที่เปิดจาก Sky at a glance ไม่มีหน้าต่างแม่
- **แท็บ "Data"**
  - 19 คอลัมน์ ชื่อ จัดวาง และรูปแบบตาม ref-P §2.2 แสดงเฉพาะคอลัมน์ที่เปิดในหน้า Single Pass (ตั้งต้น Time, Az, El, Range, Footp)
  - ไม่มีการเรียงหรือเมนูคลิกขวา
  - หน่วยและรูปแบบเวลาใช้ค่าตั้งต้นของ Gpredict (UTC, `%Y/%m/%d %H:%M:%S`, เครื่องหมายบวกลบ, เมตริก) จนกว่างานย่อยที่ 4 จะเพิ่ม Number Formats
- **แท็บ "Polar"**: วาดบน canvas ตาม ref-P §5
  - พื้นขาวเสมอ วง 0°/30°/60° และกากบาท N/E/S/W
  - ชื่อสถานี (ตาม "QTH Info") และข้อความเมาส์ `AZ: %.0f°  EL: %.0f°`
  - เส้นทางดาวเริ่มและจบที่ขอบตาม Az ของ AOS/LOS พร้อมเวลา `%H:%M` 5 จุด
  - สีและทิศใช้ค่าตั้งต้นของ Polar View จนกว่างานย่อยที่ 4 จะมีค่ารวมของ Polar View
- **แท็บ "Az/El"**: วาดตาม ref-P §6
  - กรอบเว้นขอบ 40 px
  - แกน Az สีน้ำเงิน 0–180 หรือ 0–360 และแกน El สีแดง 0–90
  - ขีด 5 ขีดต่อด้าน, "UTC" ใต้กรอบ
  - ข้อความเมาส์ `T: %s, AZ: %.0f°, EL: %.0f°` ซึ่งคำนวณจากตำแหน่ง Y ของเมาส์เหมือน Gpredict
- **ปุ่ม Print**: เปิดหน้าพิมพ์ของ browser มีแถบหัวสีเทาสูง 10 มม.
  - ในแถบมี "Pass details for %s (orbit %d)" (sans 14) และเลขหน้า `n/N`
  - ใต้แถบเป็นตาราง monospace 12pt ตาม ref-P §8.5 ไม่มีหัว 5 บรรทัดและไม่มีกราฟ เหมือน Gpredict
- **ปุ่ม Save**: เปิดกล่อง "Save Pass Details" (หัวข้อ 6.3)
- **ปุ่ม Close**: ปิดหน้าต่าง

## 6. Upcoming passes และการบันทึก

### 6.1 หน้าต่าง "Upcoming passes for %s"

- **คอลัมน์**: 10 คอลัมน์ตาม ref-P §3.2 ตั้งต้น AOS, LOS, Duration, Max El, AOS Az, LOS Az ตามหน้า Multiple Passes
  เรียงตามเวลา คลิกหัวคอลัมน์ไม่เรียงใหม่
- **ดับเบิลคลิกหรือ Enter บนแถว**: เปิด Pass details ของแถวนั้น โดยหน้าต่างนี้เป็นหน้าต่างแม่
- **คลิกขวา หรือ Shift+F10**: เมนู "Show details" ตามด้วยเส้นคั่น แล้ว "Polar plot" และ "Az/El plot" ที่กดไม่ได้เหมือน Gpredict (ref-P §3.4)
- **ปุ่ม**: Print, Save, Close
  - Print ไม่ทำอะไรเหมือน Gpredict ไม่แจ้งอะไร งานย่อยที่ 4 จะเพิ่มบรรทัด "%s: PRINT not implemented" ใน log
  - Save เปิด "Save Passes"

### 6.2 จำนวนและช่วง

ใช้ `get_passes(เวลาเริ่ม, Passes should occur within, Number of passes to predict, Minimum elevation)` (หัวข้อ 3.4)

server ส่งทุก pass พร้อมแถวของ Data มาในคำตอบเดียว เพราะต้องใช้ทั้งตอนเปิด Pass details และตอนบันทึก "Complete report"

### 6.3 การบันทึก (ref-P §8.1–8.4)

- **กล่องบันทึก**: กล่อง "Save Pass Details" และ "Save Passes" มีช่อง "Save using file name:" และ "File contents:" ตาม ref-P
  - ชื่อไฟล์ตั้งต้น `<ดาว>-<orbit>` และ `<ดาว>-passes` แทนอักขระตามกติกาของ Gpredict รับเฉพาะ A–Z a–z 0–9 - _ ยาวไม่เกิน 100
  - ปุ่ม Save กดไม่ได้เมื่อชื่อว่าง
- **"Save in folder:"**: browser เลือกโฟลเดอร์เองไม่ได้ ไฟล์จึงลงโฟลเดอร์ดาวน์โหลดของ browser
  - แถวนี้แสดงเป็นข้อความ "บันทึกลงโฟลเดอร์ดาวน์โหลดของ browser" **(ของเรา)**
- **เนื้อไฟล์**: สร้างที่ web ด้วยฟังก์ชันบริสุทธิ์ (`passText.ts`) รูปแบบตรงกับ ref-P §8.3 และ §8.4 ทุกช่องว่าง ต่อท้ายชื่อไฟล์ด้วย `.txt`
- **ค่าที่จำ**:
  - Save Pass Details จำตัวเลือก "File contents:" ไว้ใน Preferences (`PREDICT/SAVE_CONTENTS`)
  - Save Passes เริ่มที่ "Complete report" ทุกครั้ง

## 7. Sky at a glance

- **การเปิด**: Module menu → "Sky at a glance" เปิดหน้าต่าง "The sky at a glance (<module>)"
  - เปิดได้หน้าต่างเดียวต่อ module กดซ้ำจะยกหน้าต่างเดิมขึ้นมา
  - module ไม่มีดาว: แสดง "This module has no satellites!"
- **เวลาเริ่ม T0**: เวลาของ module ถ้าเปิด "Always use real time for pass predictions" ใช้เวลาเครื่องเฉพาะการวาดครั้งแรก (ref-P §7.1, §7.7)
- **ข้อมูล**: ทุกดาวใน module ใช้ `get_passes(T0, ชั่วโมง/24, 10, Minimum elevation)` (ref-P §7.2)
  - เรียงแถวตามชื่อดาว เพราะลำดับของ Gpredict ขึ้นกับ hash table (หัวข้อ 10.1)
  - สีที่ k ใช้ "Satellite (k mod 10)+1" นับรวมดาวที่ไม่มี pass
- **การวาด**: canvas ตาม ref-P §7.3–7.5
  - ขนาดเริ่ม 600 × (N·10 + (N+1)·20 + 50)
  - แท่งโปร่ง alpha 0xA0 ขอบทึบ ชื่อดาววางซ้ายหรือขวาของแท่งแรก
  - เส้นและเวลาใต้เมาส์ และแถบล่างสีกรมท่าพร้อมขีดชั่วโมง ป้าย "UTC" หรือ "TIME"
- **เมาส์**: คลิกซ้ายบนแท่งเปิด Pass details ของ pass นั้น ไม่มีเมนูคลิกขวาและไม่มี tooltip
- **การวาดใหม่**: เมื่อเวลาของ module ต่างจากครั้งก่อนเกิน 7.0e-4 วัน (ราว 60.5 วินาที) หรือสถานีย้ายเกิน 1 กม. (ref-P §7.7)
  - ระหว่างคำนวณครั้งแรกแสดง "กำลังคำนวณวงโคจรด้วย GMAT…" **(ของเรา)**
  - ระหว่างคำนวณครั้งต่อไปยังแสดงภาพเดิม

## 8. Preferences: โครงหน้าต่างและกลุ่ม Predict

### 8.1 โครงหน้าต่าง (ref-D §1)

- Edit → Preferences เปิดกล่อง modal ปุ่ม Cancel และ OK
- **ด้านซ้าย**: ไอคอน 4 ปุ่ม General, Modules, Interfaces, Predict
- **ชื่อหน้าต่าง**: "GPREDICT Preferences :: <กลุ่ม>"
- **ในงานนี้**:
  - เปิดที่ Predict เพราะกลุ่มอื่นยังกดไม่ได้ (Gpredict เปิดที่ General)
  - General, Modules และ Interfaces กดไม่ได้ พร้อม tooltip ของ `later.ts`
- **OK**: บันทึกทุกหน้าที่เปลี่ยน
- **Cancel**: ไม่บันทึกอะไร

### 8.2 ที่เก็บค่า (`gpredict_web/prefs.py` ใหม่)

- **ไฟล์**: `data/preferences.json` เป็น `{"version": 1, "values": {"PREDICT/MINIMUM_ELEV": 5, …}}`
- **ชื่อ key**: ใช้ชื่อ GROUP/KEY ของ Gpredict
- **ค่าที่เก็บ**: เก็บเฉพาะค่าที่ผู้ใช้ตั้ง ค่าที่ไม่มีใช้ค่าตั้งต้นของ Gpredict เหมือน `gpredict.cfg`
  - Reset แล้ว OK โดยไม่แก้อะไรต่อ = ลบ key ของหน้านั้น (ref-P §9.1)
- **schema ของแต่ละ key**: ชนิด ช่วง และค่าตั้งต้น อยู่ในโค้ดที่เดียว ค่าผิดตอบ 422 `PREFS_INVALID`
  - งานย่อย 3 และ 4 เพิ่ม key ในไฟล์เดียวกันนี้

| Key | ช่วง | ตั้งต้น |
|---|---|---|
| `PREDICT/MINIMUM_ELEV` | 1–90 | 5 |
| `PREDICT/NUMBER_OF_PASSES` | 5–50 | 10 |
| `PREDICT/LOOK_AHEAD` | 1–14 | 3 |
| `PREDICT/TIME_RESOLUTION` | 1–600 | 10 |
| `PREDICT/NUMBER_OF_ENTRIES` | 10–200 | 20 |
| `PREDICT/TWILIGHT_THRESHOLD` | −18–0 | −6 |
| `PREDICT/USE_REAL_T0` | bool | false |
| `PREDICT/SINGLE_PASS_COL` | รายชื่อคอลัมน์ | Time, Az, El, Range, Footp |
| `PREDICT/MULTI_PASS_COL` | รายชื่อคอลัมน์ | AOS, LOS, Duration, Max El, AOS Az, LOS Az |
| `PREDICT/SAVE_CONTENTS` | 0–2 | 0 |
| `SKY_AT_GLANCE/TIME_SPAN_HOURS` | 1–24 | 8 |
| `SKY_AT_GLANCE/COLOUR_01` … `_10` | `#rrggbb` | ref-P §7.4 |

### 8.3 หน้าในกลุ่ม Predict (ref-P §9)

- **แท็บ "Pass Conditions"**: 6 ค่าพร้อม tooltip ตาม ref-P §9.1
- **แท็บ "Multiple Passes"**: กล่องเลือก 10 กล่อง 2 คอลัมน์
- **แท็บ "Single Pass"**: กล่องเลือก 19 กล่อง 3 คอลัมน์
- **แท็บ "Sky at a Glance"**: ช่องชั่วโมงและปุ่มสี 10 ปุ่ม ปุ่มสีใช้ `<input type="color">` ไม่มี alpha เหมือน Gpredict
- **ปุ่ม Reset ทุกแท็บ**: tooltip "Reset settings to the default values."
- **Twilight threshold**: มีผลกับรหัส V/D/E ใน tick ของทุก module ตั้งแต่ tick ถัดไป (core ใช้ −6° คงที่)

## 9. API และ error ที่เพิ่ม

| Method | Path | ทำอะไร |
|---|---|---|
| GET | `/api/prefs` | ค่าที่ใช้อยู่ทุก key พร้อมรายชื่อ key ที่ผู้ใช้ตั้งเอง |
| PUT | `/api/prefs` | `{"set": {...}, "remove": [...]}` ตรวจทุก key ก่อนเขียน ผิดตัวเดียวไม่เขียนเลย |
| POST | `/api/modules/{name}/passes` | `{"norad", "kind": "next"\|"current"\|"future"\|"at", "t", "aos"}` คืน pass พร้อมแถว หรือ `message` ของหัวข้อ 4.3 |
| GET | `/api/modules/{name}/skyglance?t=` | `{status, t0, hours, sats: [{norad, name, colour, passes: [สรุป pass ไม่มีแถว]}]}` |

- **`kind: "at"`**: ใช้เปิด Pass details จาก Sky at a glance เป็นคำขอ pass ที่มี AOS ตามที่ให้ (หาภายใน ±1 วินาที)
- **Pass**:
  - ค่า: `{orbit, aos, tca, los, max_el, aos_az, max_el_az, los_az, vis, rows}`
  - แต่ละแถวมี `t, az, el, ra, dec, range_km, rate_kms, lat_deg, lon_deg, ssp, footprint_km, alt_km, vel_kms, doppler_hz, loss_db, delay_ms, ma, phase_deg, vis`
- **คำขอ pass**: รอ GMAT จนเสร็จ (สูงสุด `GMAT_TIMEOUT_S`)
  - ถ้า browser ตัดการเชื่อมต่อ server ปล่อยงานนั้น
  - GMAT ล้มเหลวตอบ 503 `GMAT_FAILED`
- **รหัสใหม่**
  - `PREFS_INVALID` (422)
  - `PASS_NO_AOS` และ `PASS_NONE_WITHIN`: อยู่ใน `message` ของคำตอบ 200 ข้อความเป็นภาษาอังกฤษของ Gpredict

## 10. ข้อตกลงที่ต่างจาก Gpredict

### 10.1 ตั้งใจให้ต่าง

| เรื่อง | Gpredict | ของเรา | เหตุผล |
|---|---|---|---|
| AOS ของ pass ที่กำลังผ่าน | ถอยทีละ 43.2 วินาที (ref-P §4.4) | ละเอียด 0.1 วินาที | ใช้วิธีเดียวกับ core |
| Max El, TCA | ค่าสูงสุดในแถวที่สุ่ม | ค่าสูงสุดจริง | แม่นกว่า และตรงกับ Event list ของ core |
| pass ที่เริ่มหลังช่วงข้อมูลในหัวข้อ 3.2 | อาจได้ 1 pass | ไม่นับ | ไม่ต้องคำนวณ GMAT ยาวเกินจำเป็น |
| ลำดับแถวใน Sky at a glance | ลำดับ hash table | ตามชื่อดาว | แน่นอนและทดสอบได้ |
| Reset ของ Single Pass | กล่อง 11–19 ไม่อัปเดตบนจอ | อัปเดตครบ | ข้อบกพร่อง |
| ชื่อหน้าต่างเลือกสีปุ่มที่ 1 และ 2 | สลับกัน | ถูกต้อง | ข้อบกพร่อง |
| Save in folder | เลือกโฟลเดอร์ได้ | ลงโฟลเดอร์ดาวน์โหลด | ข้อจำกัดของ browser |
| ระหว่างรอ GMAT | ไม่มี | กล่องรอพร้อม Cancel | ตำแหน่งมาจาก GMAT |
| เปิด Preferences | ที่ General | ที่ Predict จนถึงงานย่อยที่ 4 | General ยังไม่มี |

### 10.2 ทำตามแม้ดูแปลก

- "Show current pass" ค้นแบบ Show next pass
- Upcoming passes เลื่อนช่วงวันตาม pass
- Print ของ Upcoming passes ไม่ทำอะไร
- "Polar plot" และ "Az/El plot" กดไม่ได้
- คอลัมน์ MA แสดง phase × 256/360 พร้อมเครื่องหมายองศา
- ข้อความ "within the next 1 days"

## 11. การทดสอบ

- **Server (unittest)**
  - **`pass_predict`**: ephemeris สังเคราะห์ที่รู้ AOS/LOS ครอบคลุมกรณีต่อไปนี้
    - pass ไม่ผ่าน Minimum elevation
    - pass ที่กำลังผ่านพร้อมข้อยกเว้นของ ref-P §3.5 ข้อ 7
    - pass ที่เกินช่วงวัน
    - จำนวนแถวเมื่อ step มาจาก Number of entries และจาก Time resolution
    - Vis
    - `has_aos` ทั้ง 4 กรณี
  - **block ephemeris**: การตัด การต่อ การโหลดจาก cache การยกเลิก ลำดับความสำคัญในคิว และการลบไฟล์เก่า
  - **prefs**: schema ทุก key, set/remove, Reset แล้ว OK, ค่าผิดตัวเดียวไม่เขียน
  - **API**: ทุก kind, ข้อความไม่มี pass ทั้ง 3 แบบ, client ตัดการเชื่อมต่อ, 503
  - **integration กับ GMAT จริง**:
    - Future passes ของ ISS ที่ THBK 3 วัน เทียบ GMAT รายวินาที: AOS/LOS ต่างไม่เกิน 1 วินาที, Max El ต่างไม่เกิน 0.01°
    - Sky at a glance ของ module 10 ดวง
- **Web (Vitest)**
  - ข้อความไฟล์ของ ref-P §8.3 และ §8.4 ตรงกับตัวอย่างทุกช่องว่าง (รวมเส้นคั่น)
  - ชื่อไฟล์ตั้งต้นและการแทนอักขระ
  - เรขาคณิตของ Polar plot, Az/El plot และ Sky at a glance เป็นฟังก์ชันบริสุทธิ์ (ตำแหน่งขีด ป้าย การวางชื่อดาว)
  - ข้อความใน Data tab ทุกคอลัมน์
  - การเลือกเวลาเริ่มในหัวข้อ 4.2

## 12. เกณฑ์ว่าสำเร็จ

1. คลิกขวาที่ ISS ใน Map → Show next pass ได้หน้าต่าง Pass details ที่ชื่อ แท็บ คอลัมน์ และค่าตรงตาม ref-P
   AOS/LOS ต่างจาก GMAT รายวินาทีไม่เกิน 1 วินาที
2. Future passes ของ ISS ได้ไม่เกิน 10 pass ภายใน 3 วัน (ตามกติกาเลื่อนช่วง) ทุก pass มี Max El ≥ 5°
   ดับเบิลคลิกแถวได้ Pass details และปิดหน้าต่างแม่แล้วหน้าต่างลูกปิดตาม
3. ดาว GEO ได้ข้อความ error ของ ref-P §1.4
   ดาวที่ไม่มี pass ใน 3 วันได้ข้อความ "…has no passes\nwithin the next 3 days"
4. Save ของทั้งสองหน้าต่างได้ไฟล์ `.txt` ที่รูปแบบตรงตาม ref-P §8.3/§8.4 และ Print ได้หน้าพิมพ์ตาม ref-P §8.5
5. Sky at a glance ของ module `Amateur` แสดงแท่งของทุกดาวที่มี pass ใน 8 ชม. คลิกแท่งได้ Pass details
   เลื่อนเวลาด้วย Time Controller เกิน 1 นาทีแล้ววาดใหม่
6. Preferences → Predict เปลี่ยน Minimum elevation เป็น 30 แล้ว Future passes เหลือเฉพาะ pass ที่ Max El ≥ 30°
   Reset แล้ว OK ได้ค่าตั้งต้นและ key ถูกลบจาก `preferences.json`
7. test ของ engine, server และ web ผ่านทั้งหมด และ GNSS Studio ได้ผลเหมือนเดิมทุกไบต์
