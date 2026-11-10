# GNSS Predict: พยากรณ์การมองเห็นดาวเทียม GPS จากสถานี THBK

เครื่องมือนี้พยากรณ์ว่าดาวเทียม GPS ดวงไหนจะมองเห็นได้จากสถานี GNSS **THBK** (กรุงเทพฯ) ในช่วงเวลาข้างหน้า
พร้อมมุมทิศ (Az), มุมเงย (El), จุดตัดชั้นไอโอโนสเฟียร์ (IPP) และ mapping factor (MF) ทุก 30 วินาที
เพื่อใช้กับงานพยากรณ์ TEC

GMAT ทำหน้าที่คำนวณวงโคจรจาก TLE ด้วย SGP4 (`SPICESGP4`) และแปลงตำแหน่งดาวเทียมเข้ากรอบ `Topocentric`
ของสถานี ส่วน Python (standard library ล้วน) ทำหน้าที่ดาวน์โหลด TLE, สร้าง script, รัน GMAT และคำนวณมุม
ไม่มีการแก้ไฟล์ใดของ GMAT

- Design: [docs/2026-11-10-gnss-predict-design.md](docs/2026-11-10-gnss-predict-design.md)
- แผนการพัฒนา: [docs/2026-11-10-gnss-predict-plan.md](docs/2026-11-10-gnss-predict-plan.md)

## 1. Build GMAT (ครั้งเดียว)

ทดสอบบน macOS arm64, CMake 4.4, Xcode และ Python 3.14 คำสั่งทั้งหมดรันจากรากของ repo

```bash
python3 depends/configure.py          # ดาวน์โหลดและ build CSPICE, Xerces, wxWidgets ใช้เวลานาน
cmake -S . -B build/console -DCMAKE_BUILD_TYPE=Release \
      -DGMAT_INCLUDE_GUI=OFF \
      -DPLUGIN_PYTHONINTERFACE=OFF -DPLUGIN_MATLABINTERFACE=OFF -DPLUGIN_EXTERNALFORCEMODEL=OFF
cmake --build build/console -j 8      # ได้ application/bin/GmatConsole
```

ตรวจว่า build ใช้ได้: `cd application/bin && ./GmatConsole --run ../samples/Ex_TLE_Propagation.script`
ข้อความ `dlopen(...) (no such file)` ของ plugin ที่ไม่ได้ build (Python, MATLAB, proprietary) เป็นเรื่องปกติ

ถ้าใช้ GMAT ที่ติดตั้งไว้ที่อื่น ให้ตั้ง `GMAT_BIN` ไปที่ไฟล์ `GmatConsole` ของชุดนั้น:

```bash
export GMAT_BIN=/path/to/GMAT/bin/GmatConsole
```

## 2. พยากรณ์

รันจากโฟลเดอร์ `api-interop/gnss-predict`

```bash
python3 -m gnss_predict                                   # 24 ชม. เริ่ม 00:00 UTC ของวันถัดไป
python3 -m gnss_predict --start 2026-11-11T06:30Z --hours 6
python3 -m gnss_predict --tle-file cache/gps_20261109T2018Z.tle --keep-work
```

| ตัวเลือก | ค่าเริ่มต้น | ความหมาย |
|---|---|---|
| `--start` | 00:00 UTC ของวันถัดไป | เวลาเริ่ม ใส่แค่วันที่ได้ (ถือเป็น 00:00 UTC) ถ้าไม่ระบุ timezone ถือเป็น UTC |
| `--hours` | 24 | ความยาวช่วงพยากรณ์ |
| `--step` | 30 | ระยะห่างของ epoch (วินาที) |
| `--min-el` | 0 | ส่งออกเฉพาะแถวที่ El ≥ ค่านี้ |
| `--shell-km` | 400 | ความสูง shell ไอโอโนสเฟียร์ (เท่ากับใน `t02_5_rebuild_tec.py`) |
| `--tle-file` | ไม่ระบุ | ใช้ไฟล์ TLE นี้แทนการดาวน์โหลด (ใช้เมื่อต้องการรันซ้ำให้ได้ผลเดิม) |
| `--cache-dir` | `cache/` | ที่เก็บ TLE ที่ดาวน์โหลด |
| `--out-dir` | `output/` | ที่เก็บผลลัพธ์ |
| `--keep-work` | ปิด | เก็บ GMAT script, รายงาน และ log ไว้ใน `out-dir/work-<เวลา>/` |

exit code: `0` สำเร็จ, `1` ข้อผิดพลาดที่คาดไว้ (TLE, GMAT, รายงาน), `2` ใส่ตัวเลือกผิด

ข้อมูลวงโคจรดาวน์โหลดจาก CelesTrak กลุ่ม `gps-ops` เป็น OMM (JSON) เก็บไว้ใน `cache/gps-ops_<เวลา UTC>.json`
แล้วแปลงเป็น `cache/gps_<เวลา UTC>.tle` (ดาวที่หมายเลขแคตตาล็อกเกิน 99999 ใช้ Alpha-5 ในช่อง 5 ตัวอักษร)
ส่ง request ได้ไม่เกิน 1 ครั้งต่อ 2 ชั่วโมง (เวลาที่ส่งล่าสุดอยู่ใน `cache/celestrak_state.json`) ถ้าดาวน์โหลดไม่ได้
หรือ CelesTrak ตอบกลับเป็นข้อความที่ไม่ใช่ OMM (เช่นเมื่อดาวน์โหลดถี่เกินกำหนด) จะใช้ไฟล์ล่าสุดใน cache พร้อมคำเตือน
TLE อายุเกิน 7 วันจะมีคำเตือน และถ้าเกิน 30 วันจะหยุด

พยากรณ์ 24 ชม. ครบ 32 ดวงใช้เวลาราว 6 วินาที

## 3. ผลลัพธ์

`output/thbk_gnss_pred_<YYYYMMDDTHHMMZ>_<H>h.csv` ตัวอย่างจากการพยากรณ์จริงวันที่ 2026-11-10:

```
DAY,Time,PRN,Az,El,IPP_Lat,IPP_Lon,MF
2026-11-10,00:00:00,G10,344.448,33.369,18.3841,99.4164,0.61847
2026-11-10,00:00:00,G12,91.355,14.989,13.3046,110.7032,0.41699
2026-11-10,00:00:00,G13,96.757,22.856,12.8017,107.9376,0.49823
```

| คอลัมน์ | ความหมาย |
|---|---|
| `DAY`, `Time` | วันที่และเวลา **UTC** รูปแบบเดียวกับไฟล์ `THBKddd_yy_GPS.csv` จึง join กันได้ทันที |
| `PRN` | `Gnn` |
| `Az` | มุมทิศ (องศา) วัดจากทิศเหนือตามเข็มนาฬิกา ช่วง [0, 360) |
| `El` | มุมเงย (องศา) เทียบกับระนาบสัมผัสทรงรี WGS84 |
| `IPP_Lat`, `IPP_Lon` | ตำแหน่ง IPP บน shell ทรงกลมรัศมี 6371 + 400 กม. (องศา, ลองจิจูดช่วง (−180, 180]) |
| `MF` | mapping factor แบบ thin-shell สูตรเดียวกับ `mapping()` ใน `t02_5_rebuild_tec.py` คือ **VTEC = STEC × MF** |

แถวเรียงตาม `DAY`, `Time`, `PRN` ไฟล์เป็น UTF-8 ไม่มี BOM และขึ้นบรรทัดด้วย `\n`
ไฟล์ CSV เขียนผ่านไฟล์ชั่วคราวแล้วค่อย rename ไปป์ไลน์ที่อ่านจึงไม่มีทางเห็นไฟล์ที่เขียนไม่เสร็จ

ไฟล์ `<ชื่อเดียวกัน>.meta.json` เก็บสิ่งที่ต้องใช้เมื่อจะรันซ้ำ ได้แก่ ไฟล์ TLE และ SHA-256, ช่วง epoch ของ TLE,
`prns_included` (ทุกดวงที่มี TLE ใช้ได้ แม้จะไม่ขึ้นเหนือ `--min-el`), `prns_missing` (PRN 1–32 ที่ไม่มี TLE),
คำเตือน และเวอร์ชันของ GMAT

## 4. ตรวจความแม่นยำกับวงโคจร SP3 ของ IGS

```bash
python3 -m gnss_predict.validate --tle-file cache/gps_<เวลา>.tle --day YYYY-MM-DD
python3 -m gnss_predict.validate --tle-file cache/gps_<เวลา>.tle --sp3 path/to/IGS0OPSRAP_..._ORB.SP3.gz
```

คำสั่งนี้พยากรณ์ทั้งวันด้วย GMAT แล้วเทียบกับ Az/El ที่คำนวณจาก SP3 ด้วย Python ล้วน (ไม่ผ่าน GMAT)
SP3 ดาวน์โหลดจาก CDDIS ผ่าน FTPS แบบ anonymous โดยเลือกแบบ final ก่อน ถ้าไม่มีจึงใช้แบบ rapid
epoch ของ TLE ต้องห่างจากวันตรวจไม่เกิน 2 วัน ผลจะถูกเขียนลง `validation_<วัน>.json` และ `.md`

**ผลจริง** (TLE ดาวน์โหลดเมื่อ 2026-11-09 20:18 UTC มี epoch 2026-11-07 15:28 ถึง 2026-11-09 15:27, SP3
`IGS0OPSRAP_20263120000_01D_15M_ORB.SP3.gz` ของวันที่ 2026-11-08, El อ้างอิง ≥ 10°):

| ค่า | ได้ | เกณฑ์ |
|---|---|---|
| จำนวนคู่ที่เทียบ | 24,929 (32 ดวง) | |
| ค่ากลาง \|ΔEl\| | 0.0015° | ≤ 0.05° |
| P99 \|ΔEl\| | 0.0087° | ≤ 0.2° |
| ค่ากลาง \|ΔAz\| (El < 80°) | 0.0021° | ≤ 0.1° |
| P99 \|ΔAz\| (El < 80°) | 0.0180° | ≤ 0.5° |

ดวงที่คลาดมากที่สุดคือ G09 ที่ |ΔEl| สูงสุด 0.0107°

## 5. ข้อจำกัด

- เฉพาะ GPS (PRN G01–G32) ไม่รวม GLONASS, Galileo, BeiDou
- ความแม่นยำข้างบนยืนยันแล้วเฉพาะกรณี TLE อายุไม่เกิน 2 วัน เกณฑ์เตือน 7 วันและหยุด 30 วันเป็นค่าที่ตั้งไว้โดยยังไม่ได้วัด
- TLE ไม่มีสถานะ healthy ของดาวเทียม ดวงที่ถูกตั้งเป็น unhealthy ยังปรากฏในผลพยากรณ์
- ใช้พิกัด THBK จาก `APPROX POSITION XYZ` ใน header RINEX (13.729779°N, 100.781151°E, สูง 6.4 ม.)
- ไปป์ไลน์ TEC ใน TrainingModel ยังไม่มีโค้ดที่อ่านไฟล์นี้ ต้องเขียนเพิ่มแยกต่างหาก

## 6. ทดสอบ

```bash
cd api-interop/gnss-predict && python3 -m unittest discover -s tests -v
```

integration test (`tests/test_integration_gmat.py`) จะถูกข้ามอัตโนมัติถ้าหา GmatConsole ไม่เจอ
