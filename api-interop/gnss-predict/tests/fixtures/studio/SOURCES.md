# ที่มาของ fixture ใน `tests/fixtures/studio/`

fixture ทั้งหมดสร้างโดย `extract_fixtures.py` จากไฟล์ที่ดาวน์โหลดไว้เมื่อ 2026-11-10 ถึง 2026-11-11 (ไฟล์ต้นทางไม่ถูก commit)
แต่ละไฟล์ตัดให้เหลือเฉพาะดาวตัวอย่าง 10 ดวง เพื่อให้ test ทำงานได้โดยไม่ใช้เน็ตและไม่ต้องใช้ข้อมูลทั้งชุด

รันซ้ำจาก `api-interop/gnss-predict` (ใช้ `-I` เพราะไฟล์ต้นทางเป็นข้อมูลที่ดาวน์โหลดมา):

```bash
python3 -I tests/fixtures/studio/extract_fixtures.py \
  --omm <SRC>/omm-dl/gnss.json --tle-dir <SRC>/spike-acc/data/tle \
  --meta <SRC>/spike-acc/data/meta/igs_satellite_metadata.snx \
  --nav <SRC>/spike-acc/data/nav/BRDC00IGS_R_20263130000_01D_MN.rnx.gz \
  --sp3 <SRC>/spike-acc/data/sp3/GFZ0MGXRAP_20263130000_01D_05M_ORB.SP3.gz \
  --out tests/fixtures/studio
```

สคริปต์ไม่ดาวน์โหลดอะไรเอง ถ้าไฟล์ต้นทางหายให้หยุดแล้วถามผู้ใช้ก่อน ห้ามดึงจาก CelesTrak ซ้ำเอง
(CelesTrak ให้ส่ง request ได้ไม่เกิน 1 ครั้งต่อกลุ่มต่อ 2 ชม.)

## ดาวตัวอย่าง

| NORAD | SVN | PRN ปัจจุบัน | หมายเหตุ |
|---|---|---|---|
| 62339 | G080 | G01 | GPS-IIIA |
| 26407 | G044 | G22 | GPS-IIR-A (G044 เคยเป็น G28 จนถึง 2022:299) |
| 37846 | E101 | E11 | Galileo |
| 40129 | E202 | E14 | Galileo ในวงรี (e ≈ 0.17) |
| 43508 | R856 | R05 | GLONASS-M+ |
| 56564 | C231 | C01 | BDS-3G (CelesTrak ตั้งชื่อ "C62" ซึ่งเป็น PRN เก่า) |
| 44542 | C222 | C40 | BDS-3M (CelesTrak ตั้งชื่อ "C46") |
| 41434 | C017 | C09 | BDS-2I (CelesTrak ตั้งชื่อ "C13") |
| 36828 | C005 | — | BDS-2I ที่ PRN สิ้นสุดเมื่อ 2026:100 (เดิม C06) ใช้ทดสอบดาวที่ไม่มี PRN ปัจจุบัน |
| 100744 | R809 | R10 | เลข 6 หลัก ไม่มี TLE; เป็น R28 ถึง 2026:293:19800 แล้วเป็น R10 ใช้ทดสอบ PRN เปลี่ยนกลางช่วง |

## ไฟล์ต้นทางและกฎการตัด

| fixture | ไฟล์ต้นทาง | URL ต้นทาง | กฎการตัด |
|---|---|---|---|
| `omm_sample.json` | `omm-dl/gnss.json` (OMM ของ CelesTrak กลุ่ม gnss 172 ดวง) | `https://celestrak.org/NORAD/elements/gp.php?GROUP=gnss&FORMAT=json` | เก็บ object ของ NORAD ทั้ง 10 ดวงตามลำดับในตาราง ไม่แก้ค่า (เขียนใหม่เป็น JSON ย่อหน้า 2 ช่อง) |
| `snapshot/gps-ops.json` | `omm-dl/gnss.json` | เหมือนข้างบน (จริง ๆ ของกลุ่ม `GROUP=gps-ops`) | object ของ 62339, 26407 |
| `snapshot/glo-ops.json` | `omm-dl/gnss.json` | เหมือนข้างบน (`GROUP=glo-ops`) | object ของ 43508, 100744 |
| `snapshot/galileo.json` | `omm-dl/gnss.json` | เหมือนข้างบน (`GROUP=galileo`) | object ของ 37846, 40129 |
| `snapshot/beidou.json` | `omm-dl/gnss.json` | เหมือนข้างบน (`GROUP=beidou`) | object ของ 56564, 44542, 41434, 36828 |
| `tle_sample.tle` | `spike-acc/data/tle/{gps-ops,glo-ops,galileo,beidou}.tle` | `https://celestrak.org/NORAD/elements/gp.php?GROUP=<group>&FORMAT=tle` | TLE 3 บรรทัด (ชื่อ, บรรทัด 1, บรรทัด 2) ของ 9 ดวงแรก ไม่มี 100744 คงบรรทัดเดิมทุกตัวอักษรรวมตัวจบบรรทัด CRLF |
| `snapshot/igs_satellite_metadata.snx` | `spike-acc/data/meta/igs_satellite_metadata.snx` (release 2441) | `https://files.igs.org/pub/station/general/igs_satellite_metadata.snx` | บรรทัดแรก (`%=SNX ...`) กับส่วน `SATELLITE/IDENTIFIER` และ `SATELLITE/PRN` เท่านั้น ในสองส่วนนี้เก็บบรรทัด `+`, `-`, `*` ครบ และบรรทัดข้อมูลของ SVN G080, G044, E101, E202, R856, R809, C231, C222, C017, C005 ไม่มี `%ENDSNX` คงตัวจบบรรทัด CRLF ของต้นฉบับ |
| `snapshot/brdc/BRDC00IGS_R_20263130000_01D_MN.rnx` | `spike-acc/data/nav/BRDC00IGS_R_20263130000_01D_MN.rnx.gz` (RINEX 3.04 รวมทุกระบบ ของวันที่ 2026-11-09) | `ftp://gdc.cddis.eosdis.nasa.gov/gnss/data/daily/2026/brdc/BRDC00IGS_R_20263130000_01D_MN.rnx.gz` | header เดิมทั้งหมด (ถึง `END OF HEADER`) + ทุก record ของ G01, R05, R13, C01, C09, C19, C38, C40 + record ของ E11 และ E14 ที่ epoch ≤ 2026-11-09 04:00:00 ไม่มี G22 และ R10 โดยตั้งใจ (ใช้ทดสอบดาวที่ไม่มี broadcast) record G/E/C/J/I มี 8 บรรทัด, R/S มี 4 บรรทัด คงลำดับเดิมในไฟล์ |
| `mgx_sample.sp3` | `spike-acc/data/sp3/GFZ0MGXRAP_20263130000_01D_05M_ORB.SP3.gz` (SP3-d ทุก 5 นาที) | `ftp://gdc.cddis.eosdis.nasa.gov/gnss/products/2444/GFZ0MGXRAP_20263130000_01D_05M_ORB.SP3.gz` | header เดิมของ GFZ ทั้งหมด (ไม่ปรับจำนวน epoch หรือรายชื่อดาวใน header) + epoch 2026-11-09 00:00 ถึง 03:00 GPST (37 epoch) เฉพาะบรรทัด `P` ของ C19, C38, E11, G01, R05 + บรรทัด `EOF` |

- `imaging/{weather,science,visual}.json` เป็น OMM สังเคราะห์ที่เขียนเองด้วยมือ (ไม่ได้ตัดจากไฟล์ที่ดาวน์โหลด): ชื่อช่องตามรูปแบบ OMM JSON สาธารณะของ CelesTrak, NORAD/OBJECT_ID ตามดาวจริง 8 ดวง แต่ EPOCH และค่าวงโคจรตั้งขึ้นสำหรับ test (epoch นับถอยหลังจาก 2026-11-10T03:00Z) มีดาวหลอก ROBUSTA-3A (60243) และ TERRA FAKE (99001)

ภาพรวมของแหล่งข้อมูลอยู่ในหัวข้อ 7.4 ของ `docs/2026-11-11-gnss-studio-design.md`

## ข้อควรระวัง

- header ของ `mgx_sample.sp3` ยังบอกจำนวน epoch 289 และดาว 119 ดวงตามไฟล์เต็ม ตัวอ่านต้องอาศัยบรรทัด `*` และ `P` จริง ไม่ใช่ตัวเลขใน header
- `snapshot/*.json` ตัดมาจากไฟล์กลุ่ม `gnss` รวม ไม่ใช่ดาวน์โหลดแยกกลุ่ม เนื้อหา object ต่อดวงเหมือนกัน
- ไฟล์ `.snx` ต้นฉบับใช้ CRLF ทุกบรรทัด และ `tle_sample.tle` ก็ใช้ CRLF ตัวอ่านต้องตัด `\r` เอง ส่วน `.json`, `.rnx`, `.sp3` ใช้ `\n`
- ค่าเวลาใน SP3 เป็น GPST ส่วนใน RINEX nav เป็นเวลาของแต่ละระบบ (GPST, GST, BDT, GLONASS เป็น UTC) ตามมาตรฐาน RINEX 3.04
