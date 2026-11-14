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
| `--cache-dir` | `cache/` | ที่เก็บ TLE ที่แปลงจาก OMM (ตัว OMM และ `celestrak_state.json` อยู่ใน `data/orbits/_cache/`) |
| `--out-dir` | `output/` | ที่เก็บผลลัพธ์ |
| `--keep-work` | ปิด | เก็บ GMAT script, รายงาน และ log ไว้ใน `out-dir/work-<เวลา>/` |

exit code: `0` สำเร็จ, `1` ข้อผิดพลาดที่คาดไว้ (TLE, GMAT, รายงาน), `2` ใส่ตัวเลือกผิด

ข้อมูลวงโคจรดาวน์โหลดจาก CelesTrak กลุ่ม `gps-ops` เป็น OMM (JSON) เก็บไว้ใน `data/orbits/_cache/gps-ops_<เวลา UTC>.json`
แล้วแปลงเป็น `cache/gps_<เวลา UTC>.tle` (ดาวที่หมายเลขแคตตาล็อกเกิน 99999 ใช้ Alpha-5 ในช่อง 5 ตัวอักษร)
ส่ง request ได้ไม่เกิน 1 ครั้งต่อ 2 ชั่วโมง (เวลาที่ส่งล่าสุดอยู่ใน `data/orbits/_cache/celestrak_state.json`)
CLI นี้กับ GNSS Studio (หัวข้อ 7) ใช้ `data/orbits/_cache/` เดียวกันเป็นค่าตั้งต้น (หรือ `$GNSS_STUDIO_DATA/orbits/_cache/`
ถ้าตั้งตัวแปรนี้) จึงนับกติกา 2 ชั่วโมงร่วมกัน ถ้าอีกเครื่องมือเพิ่งดึง `gps-ops` ไปจะใช้ OMM ไฟล์นั้นโดยไม่ส่ง request ซ้ำและไม่เตือน
ถ้าดาวน์โหลดไม่ได้หรือ CelesTrak ตอบกลับเป็นข้อความที่ไม่ใช่ OMM (เช่นเมื่อดาวน์โหลดถี่เกินกำหนด)
จะใช้ไฟล์ล่าสุดใน cache พร้อมคำเตือน
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

- CLI เดิมทำเฉพาะ GPS (PRN G01–G32) ถ้าต้องการ GLONASS, Galileo, BeiDou ใช้ GNSS Studio engine (หัวข้อ 7)
- ความแม่นยำข้างบนยืนยันแล้วเฉพาะกรณี TLE อายุไม่เกิน 2 วัน เกณฑ์เตือน 7 วันและหยุด 30 วันเป็นค่าที่ตั้งไว้โดยยังไม่ได้วัด
- TLE ไม่มีสถานะ healthy ของดาวเทียม ดวงที่ถูกตั้งเป็น unhealthy ยังปรากฏในผลพยากรณ์
- ใช้พิกัด THBK จาก `APPROX POSITION XYZ` ใน header RINEX (13.729779°N, 100.781151°E, สูง 6.4 ม.)
- ไปป์ไลน์ TEC ใน TrainingModel ยังไม่มีโค้ดที่อ่านไฟล์นี้ ต้องเขียนเพิ่มแยกต่างหาก

## 6. ทดสอบ

```bash
cd api-interop/gnss-predict && python3 -m unittest discover -s tests -v
```

integration test (`tests/test_integration_gmat.py`, `tests/test_integration_studio.py`) จะถูกข้ามอัตโนมัติถ้าหา GmatConsole ไม่เจอ

## 7. GNSS Studio engine (GPS, GLONASS, Galileo, BeiDou)

engine ของ GNSS Studio ขยายเครื่องมือนี้ให้คำนวณได้ 4 ระบบ และเขียนไฟล์ผลลัพธ์ให้ server และหน้าเว็บของ GNSS Studio ใช้
GMAT (`SPICESGP4`) คำนวณตำแหน่งดาวทุกดวงในกรอบ EarthFixed ด้วยการรันครั้งเดียว ส่วน Az/El, ช่วง access, DOP
และการตรวจความแม่นยำทำใน Python (standard library ล้วนเหมือนเดิม) CLI เดิมในหัวข้อ 2–4 ยังทำงานแบบเดิม

- Design ภาพรวม: [docs/2026-11-11-gnss-studio-design.md](docs/2026-11-11-gnss-studio-design.md)
- Spec ของ engine: [docs/2026-11-11-gnss-studio-engine-design.md](docs/2026-11-11-gnss-studio-engine-design.md)

### 7.1 คำสั่ง

รันจากโฟลเดอร์ `api-interop/gnss-predict`

```bash
python3 -m gnss_predict.studio fetch     [--data DIR] [--systems GREC]
python3 -m gnss_predict.studio propagate --scenario DIR [--data DIR]
python3 -m gnss_predict.studio analyze   --scenario DIR --facility NAME [--data DIR]
python3 -m gnss_predict.studio validate  --scenario DIR --day YYYY-MM-DD [--sp3 FILE] [--facility NAME] [--data DIR]
```

| คำสั่ง | ทำอะไร | ผลลัพธ์ |
|---|---|---|
| `fetch` | ดึง OMM (JSON) ของ CelesTrak กลุ่ม `gps-ops`, `glo-ops`, `galileo`, `beidou`, IGS satellite metadata และไฟล์ broadcast รายวันของเมื่อวาน (UTC) จาก CDDIS | snapshot ใหม่ `<data>/orbits/<YYYYMMDDTHHMMZ>/` |
| `propagate` | สร้างรายชื่อดาวจาก snapshot ที่ระบุใน `orbit_snapshot` ของ scenario แล้ว propagate ดาวที่แสดงด้วย GMAT | `<scenario>/ephem/<hash>/` |
| `analyze` | AER, IPP/MF, ช่วง access, Global Statistics และ DOP ของ Facility ที่ระบุ (ถ้ายังไม่มีผล propagate จะ propagate ก่อน) | `<scenario>/access/<facility>/<hash>/` |
| `validate` | เทียบ `predicted.sp3` ของวันที่ระบุกับ MGEX SP3 จริง ดาวที่ไม่มีใน SP3 ใช้ broadcast ของวันนั้น (G, E, C) | `validation_<วัน>.json` และ `.md` ใน `ephem/<hash>/` และหนึ่งบรรทัดใน `<data>/validation/history.jsonl` |

- `--data` ตั้งต้นเป็นค่าของตัวแปร `GNSS_STUDIO_DATA` ถ้ามี ไม่งั้นเป็น `data/` ในโฟลเดอร์นี้
- `<hash>` คือ 12 ตัวแรกของ SHA-256 ของข้อมูลตั้งต้น (ไฟล์ใน snapshot, ช่วงเวลา, `step_s`, รายชื่อดาว, ตัวกรอง, รุ่น engine)
  รันซ้ำด้วยข้อมูลเดิมได้โฟลเดอร์เดิมทันทีโดยไม่รัน GMAT ทุกโฟลเดอร์ผลลัพธ์เขียนลงโฟลเดอร์ชั่วคราวก่อนแล้ว rename ทั้งชุด
- กติกา CelesTrak: ส่ง request ได้ไม่เกิน 1 ครั้งต่อกลุ่มต่อ 2 ชม. (เวลาที่ส่งล่าสุดอยู่ใน `<data>/orbits/_cache/celestrak_state.json`)
  ถ้าดึงไม่ได้หรือได้คำตอบที่ไม่ใช่ OMM จะไม่ลองซ้ำ ใช้ไฟล์ล่าสุดใน cache พร้อมคำเตือน `ORBIT_DOWNLOAD_FAILED`
  CLI เดิม (หัวข้อ 2) เก็บ OMM `gps-ops` และ `celestrak_state.json` ใน `data/orbits/_cache/` เดียวกัน
  เมื่อ `--data` เป็นค่าตั้งต้น ทั้งสองเครื่องมือจึงนับกติกา 2 ชม. ร่วมกันและใช้ OMM ที่อีกฝั่งเพิ่งดึงได้
  IGS metadata ดึงใหม่เมื่อไฟล์ใน cache อายุเกิน 24 ชม. ถ้าดึง broadcast ไม่ได้ทั้งของเมื่อวานและสองวันก่อน
  snapshot จะไม่มี `brdc/` และมีคำเตือน `BRDC_UNAVAILABLE`
- `validate` ที่ไม่ระบุ `--sp3` จะดาวน์โหลด SP3 ของวันนั้นจาก CDDIS ตามลำดับ `COD0MGXFIN`, `GFZ0MGXRAP`, `WUM0MGXRAP`
  ลงใน `<data>/truth/` ถ้ามีไฟล์ของวันนั้นใน `<data>/truth/` อยู่แล้วจะใช้ไฟล์นั้นโดยไม่ต่อเน็ต (ตัวแรกตามลำดับเดียวกัน)
  ไฟล์ SP3 ที่เสียหรือดาวน์โหลดไม่ครบได้ `TRUTH_UNREADABLE` ให้ลบไฟล์นั้นแล้วรันใหม่
  broadcast ของวันที่ตรวจใช้ไฟล์ที่มีอยู่แล้วใน `brdc/` ของ snapshot หรือใน `<data>/orbits/_cache/` ก่อน
  ถ้าไม่มีจึงดาวน์โหลดลง `<data>/orbits/_cache/`
  ผลที่ไม่ผ่านเกณฑ์ไม่ใช่ error ให้ดูช่อง `pass` ใน JSON
- พิมพ์ path ของผลลัพธ์บรรทัดแรก ตามด้วย `<level>: <ข้อความ>` ของแต่ละคำเตือน
  exit code: `0` สำเร็จ, `1` ข้อผิดพลาดที่คาดไว้ (พิมพ์รหัสและข้อความลง stderr), `2` ใส่ตัวเลือกผิด

ตัวอย่าง `scenario.json` (เฉพาะช่องที่ engine ใช้ ช่องอื่นถูกข้าม รูปแบบเต็มอยู่ใน design ภาพรวม §7.2):

```json
{
  "format": "gnss-studio-scenario/1",
  "name": "acc_20261109",
  "analysis_period": {"start": "2026-11-09T00:00:00Z", "stop": "2026-11-10T00:00:00Z"},
  "step_s": 30,
  "orbit_snapshot": "20261110T1700Z",
  "ionosphere": {"shell_km": 400.0},
  "satellite_filter": {"show_too_old": false, "show_no_broadcast": false},
  "objects": [
    {"class": "Facility", "name": "THBK",
     "position": {"type": "Geodetic", "lat_deg": 13.729779, "lon_deg": 100.781151, "alt_m": 6.4},
     "constraints": {"elevation_angle_min_deg": 10.0}},
    {"class": "Satellite", "name": "C01", "norad": 56564}
  ]
}
```

- ช่วงวิเคราะห์ไม่เกิน 7 วัน เวลาเริ่มและจบเป็นวินาทีเต็ม และ (stop − start) หารด้วย `step_s` ลงตัว
  `step_s` อยู่ใน 1–3600 และหาร 86400 ลงตัว (ไม่ใส่ช่องนี้ได้ 30)
- ชื่อ object และ `orbit_snapshot` ต้องตรง `^[A-Za-z0-9_-]{1,32}$` เพราะใช้เป็นชื่อโฟลเดอร์และ id ของ CZML
  ชื่อ object ห้ามซ้ำกันแม้ต่างกันแค่ตัวพิมพ์เล็กใหญ่
- ดาวระบุด้วย NORAD PRN ในผลลัพธ์มาจาก IGS metadata ณ เวลาเริ่มช่วงวิเคราะห์เท่านั้น (ชื่อดาวใน CelesTrak ใช้แค่เตือน)

### 7.2 โครงสร้าง `data/`

`data/` ไม่อยู่ใน git (อยู่ใน `.gitignore`)

```
data/
  orbits/
    _cache/                       ไฟล์ที่ดาวน์โหลด: OMM และ IGS metadata (ชื่อมีเวลา), broadcast BRDC00IGS_R_*.rnx.gz
                                  ที่ fetch และ validate ใช้, celestrak_state.json (ใช้ร่วมกับ CLI เดิม)
    <YYYYMMDDTHHMMZ>/             snapshot หนึ่งชุด ใช้ร่วมกันทุก scenario
      gps-ops.json glo-ops.json galileo.json beidou.json      OMM JSON จาก CelesTrak
      igs_satellite_metadata.snx
      brdc/BRDC00IGS_R_<YYYYDDD>0000_01D_MN.rnx.gz
      SHA256SUMS                  ตรวจได้ด้วย shasum -a 256 -c SHA256SUMS
  scenarios/<name>/
    scenario.json
    ephem/<hash>/                 manifest.json  predicted.sp3  scene.czml  validation_<วัน>.json/.md
    access/<facility>/<hash>/     manifest.json  aer.csv  intervals.json  dop.csv  access.czml  legacy_gps.csv
  truth/                          SP3 MGEX ที่ validate ดาวน์โหลด
  validation/history.jsonl        ผลการตรวจ บรรทัดละหนึ่งครั้ง
```

| ไฟล์ | เนื้อหา |
|---|---|
| `manifest.json` | ข้อมูลตั้งต้นและ SHA-256, รุ่น GMAT, ทุกดาวใน scenario พร้อม PRN/SVN/NORAD/Block/epoch/อายุ/ธง/`propagated`, ดาวที่ไม่มี PRN (`unmapped`), คำเตือน |
| `predicted.sp3` | SP3-d เวลา GPS (UTC + 18 วินาที), orbit type `EXT`, กรอบ ITRF, หน่วยกิโลเมตร เปิดใน STK ด้วย "From SP3 File" ได้ |
| `scene.czml` | ตำแหน่งดาวสำหรับ Cesium ทุก 300 วินาที, `referenceFrame: FIXED`, Lagrange ลำดับ 7, หน่วยเมตร |
| `aer.csv` | `time_utc,prn,az_deg,el_deg,range_km,ipp_lat_deg,ipp_lon_deg,mf` ทุกดาวทุกจุดเวลาที่ El ≥ 0 |
| `intervals.json` | ช่วง access ต่อดวง (เริ่ม, จบ, ความยาว, มุมเงยสูงสุด) ตามมุมเงยต่ำสุดของ Facility และ Global Statistics |
| `dop.csv` | `time_utc,system,n_visible,gdop,pdop,hdop,vdop,edop,ndop,tdop` ทุกจุดเวลา `system` เป็น `ALL`, `G`, `R`, `E`, `C` นาฬิกาเครื่องรับตัวเดียวแบบ `dops()` ของ RTKLIB ค่าว่างเมื่อดาวที่ใช้ได้น้อยกว่า 4 ดวง |
| `access.czml` | ตำแหน่ง Facility และเส้น access ที่แสดงเฉพาะช่วง access |
| `legacy_gps.csv` | ดาว GPS ในรูปแบบเดียวกับ CSV ของ CLI เดิม (หัวข้อ 3) |

### 7.3 ธงสถานะดาว

อายุ (`age_days`) = |เวลากลางของช่วงวิเคราะห์ − epoch ของ OMM| หน่วยวัน

| ธง | เงื่อนไข | แสดงตั้งต้น | ใช้ใน DOP |
|---|---|---|---|
| (ไม่มีธง) | อายุ ≤ 2 วัน และไม่เข้าเงื่อนไขอื่น | แสดง | ใช้ |
| `stale` | 2 < อายุ ≤ 7 วัน | แสดง (เตือน) | ใช้ |
| `too_old` | อายุ > 7 วัน | ซ่อน (`show_too_old`) | ไม่ใช้ |
| `no_broadcast` | มีไฟล์ broadcast แต่ไม่พบ PRN นี้ในไฟล์ | ซ่อน (`show_no_broadcast`) | ไม่ใช้ |
| `unhealthy` | ephemeris ล่าสุดของดวงนี้ใน broadcast มี health ≠ 0 | แสดง (เตือน) | ไม่ใช้ |
| `prn_changed` | PRN ใน IGS metadata เปลี่ยนระหว่างช่วงวิเคราะห์ | แสดง (เตือน) | ใช้ |
| `name_mismatch` | ชื่อใน CelesTrak มี PRN ที่ไม่ตรงกับ IGS (GPS `(PRN nn)`, BeiDou `(Cnn)`) | แสดง (info) | ใช้ |

- ดาวหนึ่งดวงมีได้หลายธง ดาวที่ซ่อนไม่ถูก propagate แต่ยังอยู่ใน `manifest.json` พร้อมธง (`propagated: false`)
  เปิดให้แสดงได้ด้วย `satellite_filter.show_too_old` และ `show_no_broadcast`
- ดาวที่มีธงได้คำเตือน `SAT_FLAGGED` ดวงละหนึ่งข้อความ (ถ้ามีแค่ `name_mismatch` เป็นระดับ info)
- ดาวที่ IGS metadata ไม่มี PRN ณ เวลาเริ่ม (`NO_PRN`), แปลง OMM เป็น TLE ไม่ได้ (`TLE_UNAVAILABLE`)
  หรืออ้าง PRN ซ้ำกับดวงที่ epoch ใหม่กว่า (`DUPLICATE_PRN`) ไม่ถูกคำนวณ และอยู่ในรายการ `unmapped`
  ถ้าดาวนั้นอยู่ใน scenario จะได้คำเตือน `SAT_NOT_IN_SNAPSHOT`
- snapshot ที่ไม่มีไฟล์ broadcast: ไม่ตั้งธง `no_broadcast` และ `unhealthy` และมีคำเตือน `BRDC_UNAVAILABLE`

### 7.4 ผล acceptance

รันเมื่อ 2026-11-10 เวลา 21:47–22:00 UTC บน Apple M5 Pro, macOS 26.4.1, GmatConsole R2026a

**ข้อมูลที่ใช้**

- snapshot `data/orbits/20261110T1700Z/` ประกอบจาก OMM กลุ่ม `gnss` ของ CelesTrak 172 ดวงที่ดาวน์โหลดเมื่อ 2026-11-10
  แยกเป็น 4 กลุ่มตามระบบของ PRN ใน IGS metadata ได้ gps-ops 32, glo-ops 27, galileo 32, beidou 54 ดวง
  (ตรงกับกลุ่มจริงที่ได้จาก `fetch` ทุกดวง ยกเว้น COSMOS 2621 (101318) ที่ไม่มี PRN จึงไม่ได้ใส่)
  พร้อม `igs_satellite_metadata.snx` และ broadcast `BRDC00IGS_R_20263130000_01D_MN.rnx.gz` ของวันที่ 2026-11-09
- scenario `data/scenarios/acc_20261109/`: 2026-11-09 00:00 ถึง 2026-11-10 00:00 UTC ทุก 30 วินาที (2,881 จุดเวลา),
  THBK มุมเงยต่ำสุด 10°, ดาวทุกดวงใน catalog 131 ดวง (G 32, R 27, E 32, C 40) ตัวกรองตั้งต้น จึง propagate 121 ดวง
  ดวงที่ซ่อน: `too_old` C08, R10, R26 และ `no_broadcast` C56, C57, C58, E01, E22, R25, R26, R28
  (R26 มีทั้งสองธง จึงซ่อน 10 ดวง)
- ค่าจริง: `GFZ0MGXRAP_20263130000_01D_05M_ORB.SP3.gz` (2026-11-09) และ broadcast ของวันเดียวกันสำหรับดาว G/E/C ที่ไม่มีใน SP3

**1. ความแม่นยำ** (`validate --day 2026-11-09 --sp3 GFZ0MGXRAP_20263130000_01D_05M_ORB.SP3.gz` exit 0, `pass: true`,
รายงานอยู่ที่ `ephem/aef1c6d68e33/validation_2026-11-09.md`)

| ระบบ | ดาว | คู่ (El) | ค่ากลาง / P99 \|ΔEl\| | ค่ากลาง / P99 \|ΔAz\| | ผล |
|---|---|---|---|---|---|
| เกณฑ์ | | | ≤ 0.05° / ≤ 0.2° | ≤ 0.1° / ≤ 0.5° | |
| GPS | 32 | 26,798 | 0.0016° / 0.0084° | 0.0023° / 0.0179° | ผ่าน |
| GLONASS | 19 | 14,674 | 0.0011° / 0.0052° | 0.0016° / 0.0119° | ผ่าน |
| Galileo | 30 | 24,724 | 0.0011° / 0.0076° | 0.0019° / 0.0118° | ผ่าน |
| BeiDou | 27 | 24,683 | 0.0009° / 0.0052° | 0.0012° / 0.0089° | ผ่าน |

- สถิติระดับระบบนับเฉพาะคู่ที่ค่าจริงมาจาก SP3, El ≥ 10° และอายุ OMM ≤ 2 วัน (Az เฉพาะ El < 80°) เทียบทุก 30 วินาที
  ค่าต่างจากผลทดลองในภาพรวม §10.1 ไม่เกิน 0.0003° (ผลทดลองเทียบทุก 5 นาที จำนวนคู่จึงน้อยกว่าราว 10 เท่า)
- ดวงที่ไม่ผ่าน 1 ดวง: **C40** (NORAD 44542) ค่าจริงจาก broadcast เพราะไม่มีใน SP3 ของ GFZ, อายุ 1.35 วัน, 1,155 คู่,
  ค่ากลาง / P99 |ΔEl| 0.9163° / 1.6157°, |ΔAz| 1.5832° / 2.7111°, ระยะคลาด 3 มิติ 696–712 กม.
  ไม่อยู่ในสถิติระดับระบบเพราะค่าจริงไม่ได้มาจาก SP3 **ยังไม่ยืนยันสาเหตุ** (อาจเป็น OMM ชุดนี้ของดาวดวงนี้ผิดหรือดาวปรับวงโคจร)
  ชื่อใน CelesTrak ของ NORAD 44542 คือ `BEIDOU-3 M24 (C46)` แต่ IGS metadata จับคู่ NORAD 44542 กับ C40 ณ วันที่ตรวจ
  และตอนทำ design ได้ตรวจแล้วว่า TLE ที่ตรงกับ broadcast ของ C40 มากที่สุดยังเป็น NORAD 44542 การจับคู่ PRN นี้จึงถูกต้อง
- ตรวจไม่ได้ (`unverified`): R01, R13, R27 (GLONASS ที่ไม่มีใน SP3)
- ดวง `stale` ที่ผ่านเกณฑ์รายดวงแต่ไม่อยู่ในสถิติระดับระบบ: C06 (5.70 วัน, SP3), R06 (2.24 วัน, SP3), C10 (2.02 วัน, broadcast)
- snapshot นี้ดึง**หลัง**วันที่ตรวจ OMM ของดาวที่ propagate 47 จาก 121 ดวงมี epoch หลัง 2026-11-10 00:00 UTC
  ผลนี้จึงวัดความแม่นยำของ SGP4 และการแปลงพิกัดในช่วงไม่เกิน 2 วันจาก epoch ยังไม่ใช่การพยากรณ์ล่วงหน้าจริง
  ถ้าจะวัดแบบพยากรณ์ ให้ `fetch` ก่อนวันที่ตรวจแล้วรัน `validate` เมื่อมี SP3 ของวันนั้น (ราว 1–2 วันหลังจากนั้น)
- ตรวจแบบพยากรณ์จริงได้เมื่อ SP3 MGEX ของ 2026-11-11 ออก (ราว 2026-11-12/13) ด้วย snapshot ที่ดึงเมื่อ 2026-11-10 21:47 UTC
  (`20261110T2147Z` จากข้อ 4 คัดลอกไว้ที่ `data/orbits/20261110T2147Z/` แล้ว) และ scenario `data/scenarios/acc_20261111/`
  (เหมือน `acc_20261109` แต่ช่วงวิเคราะห์ 2026-11-11 00:00 ถึง 2026-11-12 00:00 UTC และ propagate ไว้แล้ว) ด้วยคำสั่ง
  `python3 -m gnss_predict.studio validate --scenario data/scenarios/acc_20261111 --day 2026-11-11`

**2. เวลา `propagate`** (ลบโฟลเดอร์ `ephem/` ก่อน, `time` ของ shell)

| scenario | ดาว | จุดเวลา | เวลา (real) | เกณฑ์ |
|---|---|---|---|---|
| `acc_20261109` | 121 | 2,881 | 34.3 วินาที | ≤ 60 วินาที |
| `acc_20261109_all` (ดาวชุดเดียวกัน เปิด `show_too_old` และ `show_no_broadcast`) | 131 | 2,881 | 39.0 วินาที | ≤ 60 วินาที |

`predicted.sp3` และ `scene.czml` ที่ propagate ใหม่มี SHA-256 เท่ากับครั้งแรกทุกไบต์ `analyze --facility THBK` ใช้เวลา 3.2 วินาที
ได้ `aer.csv` 149,294 แถว (121 ดวง), ช่วง access 181 ช่วง, DOP แบบ `ALL` มีดาวที่ใช้ได้ 34–46 ดวง PDOP 0.711–1.019 และไม่มีคำเตือน `DOP_GAPS`

**3. `legacy_gps.csv` เทียบกับ CLI เดิม**

CLI เดิม: `python3 -m gnss_predict --start 2026-11-09 --hours 24 --tle-file gps-ops.tle` โดย `gps-ops.tle` เป็น TLE ชุดเดียวกับ OMM ใน snapshot
(แปลง OMM ด้วย `omm.to_tle_lines` แล้วตรงทุกตัวอักษร 32/32 ดวง) เทียบกับ `access/THBK/e5e80b332cdd/legacy_gps.csv` โดยจับคู่ด้วย `DAY`, `Time`, `PRN`

| ค่า | ได้ | เกณฑ์ |
|---|---|---|
| แถว CLI เดิม / engine | 35,965 / 35,965 (หัวคอลัมน์เหมือนกัน) | |
| จับคู่ได้ | 35,965 (100%) | ≥ 99% ของแถว CLI เดิม |
| \|ΔAz\| สูงสุด | 0.001° | ≤ 0.01° |
| \|ΔEl\| สูงสุด | 0.001° | ≤ 0.01° |
| \|ΔIPP\| สูงสุด / \|ΔMF\| สูงสุด | 0.0001° / 0.00001 | |

ส่วนต่างทั้งหมดอยู่ที่หลักสุดท้ายจากการปัดเศษ (Az ตรงทุกตัวอักษร 35,936 แถว, El 35,919 แถว)

**4. `fetch` กับเน็ตจริง** (ครั้งเดียว 2026-11-10 21:47:59 UTC, `--data` เป็นโฟลเดอร์ชั่วคราว)

exit 0 ใน 14.3 วินาที ไม่มีคำเตือน ได้ snapshot `20261110T2147Z` ที่มี `gps-ops.json` (32 ดวง), `glo-ops.json` (28),
`galileo.json` (32), `beidou.json` (54), `igs_satellite_metadata.snx`, `brdc/BRDC00IGS_R_20263130000_01D_MN.rnx.gz`
(broadcast ของ 2026-11-09) และ `SHA256SUMS` ที่ `shasum -a 256 -c` ผ่านทุกไฟล์

**สรุปตามเกณฑ์ว่าสำเร็จของ spec engine §1**

| # | เกณฑ์ | ผล |
|---|---|---|
| 1 | `fetch` ได้ข้อมูลครบ 4 ระบบ พร้อม IGS metadata และ broadcast | ผ่าน (ข้อ 4) |
| 2 | `propagate` ได้ `predicted.sp3`, `scene.czml`, `manifest.json` | ผ่าน |
| 3 | `analyze` ได้ `aer.csv`, `intervals.json`, `dop.csv`, `access.czml`, `legacy_gps.csv` | ผ่าน |
| 4 | `validate` ผ่านเกณฑ์ภาพรวม §10.1 ทั้ง 4 ระบบ | ผ่านแบบย้อนหลัง (hindcast) — รอตรวจแบบพยากรณ์จริง ดูข้อ 1 |
| 5 | 130 ดวง 24 ชม. ทุก 30 วินาที ไม่เกิน 60 วินาที | ผ่าน: 131 ดวง 39.0 วินาที (ข้อ 2) |
| 6 | CLI เดิมได้ CSV รูปแบบเดิม และ test เดิมยังผ่าน | ผ่าน: ข้อ 3 และ test ทั้งชุด 443 ข้อผ่าน (test ดาวน์โหลดของ CLI เดิม 5 ข้อใน `tests/test_tle_fetch.py` เขียนใหม่ให้ใช้ OMM: แก้ 3 เพิ่ม 2) |
| 7 | Python standard library ล้วน ไม่แก้ไฟล์ของ GMAT | ผ่าน |

## 8. GNSS Studio server

server ของ GNSS Studio เป็น FastAPI ที่ให้หน้าเว็บ (งานย่อยที่ 3–4) สร้าง เปิด แก้ และคำนวณ scenario ผ่าน API ที่ใช้แนวคิดของ STK
และรันงานพยากรณ์ของ THBK เองทุกวัน โค้ดอยู่ใต้ `server/` เรียก engine ในหัวข้อ 7 ผ่าน process ลูกต่อ job (ส่วน engine ยังใช้ standard library เท่านั้น)

- Spec: [docs/2026-11-11-gnss-studio-server-design.md](docs/2026-11-11-gnss-studio-server-design.md) (อ้างว่า "server §n")

### 8.1 ติดตั้ง

สร้าง virtualenv ใน `server/` ครั้งเดียว ต้องใช้ Python ≥ 3.11 (ทดสอบกับ Python 3.14) `server/.venv/` อยู่ใน `.gitignore`

```bash
cd api-interop/gnss-predict/server
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt      # ใช้รันอย่างเดียวพอแค่ requirements.txt (fastapi, uvicorn)
```

ต้องมี GMAT ตามหัวข้อ 1 ด้วย (server หา `GmatConsole` แบบเดียวกับ engine)

### 8.2 เปิด server

```bash
cd api-interop/gnss-predict/server
.venv/bin/python -m gnss_studio_server
# GNSS Studio: http://127.0.0.1:8000/
```

หยุดด้วย Ctrl-C หรือ `kill <pid>` (ถ้ามี job รันอยู่ server ฆ่า GMAT และ process ลูก แล้วบันทึก job นั้นและ job ที่รออยู่เป็น `failed` รหัส `INTERRUPTED`)
server ฟังที่ `127.0.0.1` เท่านั้นโดยตั้งต้น ไม่มี login และไม่มี HTTPS (v1 สำหรับผู้ใช้คนเดียวบนเครื่องเดียว) จึงไม่ควรเปลี่ยน `GNSS_STUDIO_HOST`
(ถ้าตั้งเป็นที่อยู่ที่ไม่ใช่ loopback server เตือนใน terminal และ `server.log` ตอนเปิด)

server กันหน้าเว็บอื่นที่เปิดในเบราว์เซอร์เครื่องเดียวกันไม่ให้สั่งงาน (server §6):
- header `Host` ต้องเป็น `127.0.0.1`, `localhost`, `[::1]` หรือค่า `GNSS_STUDIO_HOST` ไม่ใช่ได้ 400 `Invalid host header`
  (กัน DNS rebinding: เปิดผ่านชื่ออื่นหรือ IP อื่นของเครื่องไม่ได้)
- คำขอ POST, PUT, PATCH, DELETE ที่มี header `Origin` ต้องมาจาก `http://<ชื่อข้างบน>:<port>` ไม่ใช่ได้ 403 `FORBIDDEN_ORIGIN`
  คำขอที่ไม่มี `Origin` (curl, script) ผ่านตามเดิม และ server ไม่ส่ง header CORS หน้าเว็บอื่นจึงอ่านผลของ GET ไม่ได้
API ทั้งหมดอยู่ใต้ `/api` มี OpenAPI ที่ `/api/openapi.json` และหน้าลองเรียกที่ `/api/docs` ถ้ามีหน้าเว็บที่ build แล้วที่ `web/dist/`
server ส่งหน้าเว็บจาก port เดียวกัน (build หน้าเว็บตามหัวข้อ 9)

| ตัวแปร | ค่าเริ่มต้น | ความหมาย |
|---|---|---|
| `GNSS_STUDIO_DATA` | `data/` ในโฟลเดอร์ `gnss-predict` | โฟลเดอร์ `data/` ตามหัวข้อ 7.2 server เพิ่ม `jobs/`, `logs/server.log`, `daily/`, `validation/<scenario>/` และ `settings.json` |
| `GMAT_BIN` | `application/bin/GmatConsole` ของ repo | path ของไฟล์ `GmatConsole` |
| `GNSS_STUDIO_HOST` | `127.0.0.1` | ที่อยู่ที่ฟัง |
| `GNSS_STUDIO_PORT` | `8000` | port ที่ฟัง (1–65535) |
| `CESIUM_ION_TOKEN` | ว่าง | server อ่านเก็บไว้ในค่าตั้งของ process แต่ยังไม่มี endpoint ใดใช้ **ชั้นภาพ Cesium ion ใช้ token ใน `settings.json` (`cesium_ion_token`) ไม่ใช่ตัวแปรนี้** (หัวข้อ 8.3 และ 9.10) |

ทุกอย่างที่ server เขียนอยู่ใต้ `GNSS_STUDIO_DATA` และ log หมุนไฟล์ที่ 10 MB เก็บ 5 ไฟล์ ข้อผิดพลาดตอบเป็น JSON `{"code", "text", "field", "detail"}`
(รหัสตาม server §10, `text` เป็นภาษาไทย)

### 8.3 งานประจำวัน (ดาวน์โหลดจากเน็ต)

ตั้งต้น server รันงานพยากรณ์ของ THBK เองทุกวัน โดยตัวตั้งเวลาเริ่มพร้อม server และตรวจทุก 60 วินาที ให้ D = วันถัดไปตาม UTC

1. ในเวลา `run_at_utc` (ตั้งต้น 21:00 UTC) job `daily` ดึงข้อมูลใหม่ด้วย `fetch_snapshot` (CelesTrak, IGS metadata และ broadcast จาก CDDIS)
2. สร้างหรือเขียนทับ scenario `daily_<YYYYMMDD ของ D>` จากแม่แบบ `thbk-gnss`: THBK มุมเงยขั้นต่ำ 10°, ดาวทุกดวงที่มี PRN,
   00:00–24:00 UTC ของ D, ทุก 30 วินาที, access จาก THBK ไปทุก Constellation
3. propagate แล้ว analyze THBK
4. คัดลอก `legacy_gps.csv` (รูปแบบเดียวกับ CLI เดิมในหัวข้อ 3) ไปที่ `data/daily/thbk_gnss_pred_<YYYYMMDD>_24h.csv`
   และ `data/daily/latest.csv` (เขียนแบบ atomic: ผู้อ่านเห็นไฟล์เก่าทั้งไฟล์หรือไฟล์ใหม่ทั้งไฟล์เสมอ)

หลังจากนั้นทุก `validation_retry_hours` server ตรวจย้อนหลังด้วย job `validate` ของ scenario รายวันที่ผ่านไปอย่างน้อย 1 วัน
(ดึง SP3 ของ MGEX จาก CDDIS ถ้ายังไม่ออกจะลองใหม่รอบหน้า เลิกลองหลัง `validation_give_up_days` พร้อมข้อความ `VALIDATION_GAVE_UP`)
ผลอยู่ใน `data/validation/history.jsonl` ลบเฉพาะ `ephem/` และ `access/` ของ scenario รายวันที่เก่ากว่า `retention_days`
ส่วน `scenario.json`, ไฟล์ validation และ `data/daily/` เก็บไว้ ถ้าขั้นใดล้มเหลว job เป็น `failed` พร้อมรหัสของ engine แล้วรอรอบวันถัดไป

> **คำเตือน: เปิดงานประจำวันอยู่ = server ดาวน์โหลดจากเน็ตเองได้ทันทีที่เปิด**
> กติกางานที่พลาด (server §9.3): ถ้าเปิด server หลังเวลา `run_at_utc` ของวันนั้น (เช่น เปิดตอน 22:00 UTC) และยังไม่มีผลพยากรณ์ของ D
> ตัวตั้งเวลาจะสั่ง job `daily` **ทันที** ในรอบตรวจแรก ซึ่งดึงข้อมูลจาก CelesTrak (และ CDDIS) โดยไม่มีใครกดสั่ง
> ถ้าไม่มีไฟล์ค่าตั้งใช้ค่าตั้งต้นซึ่ง **เปิด** งานประจำวัน (ไฟล์ที่เสีย อ่านไม่ได้ เป็น symlink ที่ชี้ไปไฟล์ที่ไม่มี
> หรือไม่ระบุ `daily.enabled` เป็น true/false ถือว่า **ปิด**)
>
> ถ้าไม่ต้องการให้ดาวน์โหลด ให้ปิดก่อนเปิด server ครั้งแรก โดยเขียนไฟล์ค่าตั้งก่อน: `api-interop/gnss-predict/data/settings.json`
> โดยตั้งต้น หรือ `$GNSS_STUDIO_DATA/settings.json` ถ้าตั้ง `GNSS_STUDIO_DATA` ไว้ (โฟลเดอร์ data ต้องมีอยู่ก่อน: `mkdir -p` ให้เรียบร้อย)
>
> ```json
> {"daily": {"enabled": false, "run_at_utc": "21:00", "facility": "THBK", "retention_days": 30,
>            "validation_retry_hours": 3, "validation_give_up_days": 14}, "cesium_ion_token": "",
>  "online_imagery": {"enabled": false, "eox": false, "osm": false, "ion": false}}
> ```
>
> หรือปิดตอน server รันอยู่ด้วย `PUT /api/settings` (ต้องส่งทั้งเอกสาร ช่องที่หายได้ 422) ตัวตั้งเวลาอ่านค่าใหม่ทันที และทุกรอบ
> (การปิดหลังเปิดอาจช้ากว่ารอบตรวจแรกซึ่งเกิดตอนเปิด server จึงควรเขียนไฟล์ก่อน):
>
> ```bash
> curl -s -X PUT http://127.0.0.1:8000/api/settings -H 'Content-Type: application/json' \
>   -d '{"daily": {"enabled": false, "run_at_utc": "21:00", "facility": "THBK", "retention_days": 30, "validation_retry_hours": 3, "validation_give_up_days": 14}, "cesium_ion_token": "", "online_imagery": {"enabled": false, "eox": false, "osm": false, "ion": false}}'
> ```
>
> การปิดไม่หยุด job `daily` หรือ `validate` ที่สั่งไปแล้ว ถ้ามี job ที่รออยู่หรือกำลังรัน ให้หา id แล้วยกเลิก (Stop ฆ่า GMAT และ process ลูก):
>
> ```bash
> curl -s 'http://127.0.0.1:8000/api/jobs?state=running'; curl -s 'http://127.0.0.1:8000/api/jobs?state=queued'
> curl -s -X POST http://127.0.0.1:8000/api/jobs/<id>/cancel              # ตอบบันทึก job ที่ state เป็น cancelled
> ```
>
> นอกจากตัวตั้งเวลา มีสามทางที่ดึงข้อมูลจากเน็ต: `POST /api/orbits/fetch`, `POST /api/scenarios/{sc}/validate` และ `POST /api/daily/run`
> ทั้งสามรับเฉพาะคำขอที่ `Host` เป็นของ server เอง และไม่มี `Origin` หรือ `Origin` เป็นของ server เอง (หัวข้อ 8.2)
> หน้าเว็บอื่นในเบราว์เซอร์จึงสั่งไม่ได้ (ได้ 400 หรือ 403) แต่โปรแกรมใดก็ได้บนเครื่องนี้ที่เรียก `127.0.0.1` ได้ (curl, script) สั่งได้
> เพราะ server ไม่มี login

**ช่วงไล่ทันอัตโนมัติและการสั่งเอง** (server §9.3): D คือวันถัดไปตาม UTC ของเวลาปัจจุบันเสมอ ตัวตั้งเวลาไล่ทันงานของ D เองได้
เฉพาะเมื่อ server เปิด (หรือเครื่องตื่น) ระหว่าง `run_at_utc` ถึง 24:00 UTC ของวันเดียวกัน ค่าตั้งต้น 21:00 UTC คือ 04:00 เวลาไทย
ช่วงไล่ทันจึงคือ 04:00–07:00 เวลาไทย หลังจากนั้น D เลื่อนไปวันถัดไป วันที่พลาด (เครื่องหลับหรือปิด) ล้มเหลว ถูกยกเลิก หรือถูกขัดจังหวะ
จะไม่ถูกสั่งเอง ให้สั่งเองด้วย `POST /api/daily/run` (ดึงข้อมูลจากเน็ตเหมือนงานอัตโนมัติ ทำงานแม้ `daily.enabled` เป็น false):

```bash
curl -s -X POST http://127.0.0.1:8000/api/daily/run                                   # D = วันถัดไปตาม UTC
curl -s -X POST http://127.0.0.1:8000/api/daily/run -H 'Content-Type: application/json' \
  -d '{"for_date": "2026-11-12"}'                                                       # วันที่ระบุ
# ตอบ HTTP 202 {"job": "<id ของ job>"} ติดตามด้วย GET /api/jobs/<id> หรือ SSE ที่ /api/events
```

`for_date` ต้องเป็นเมื่อวาน วันนี้ หรือพรุ่งนี้ตาม UTC (ไม่งั้น 422 ที่ `for_date`) มี job daily ของวันนั้นที่รอหรือรันอยู่ได้ 409 `JOB_RUNNING`
สั่งซ้ำวันที่ล้มเหลว ถูกยกเลิก ถูกขัดจังหวะ หรือเสร็จแล้วได้ สำเร็จแล้วเขียนทับ CSV ของวันนั้นและ `latest.csv`
job ที่สั่งเองนับเป็นรอบของวันนั้น: ถ้าสั่ง D เองแล้วล้มเหลว ตัวตั้งเวลาไม่สั่ง D ซ้ำตอน `run_at_utc` (สั่งเองอีกครั้งได้)
งานประจำวันไม่เขียนทับ scenario ชื่อ `daily_<YYYYMMDD>` ที่ผู้ใช้สร้างเอง (ไม่มีช่อง `daily`): job ล้มเหลวด้วย `SCENARIO_INVALID` ก่อนดึงข้อมูล

ค่าตั้งใน `settings.json` (ตัวอย่างข้างบนคือค่าตั้งต้นของ server §9.1 ยกเว้น `enabled`):

| ช่อง | ตั้งต้น | ช่วงที่รับ | ความหมาย |
|---|---|---|---|
| `daily.enabled` | `true` | true/false | เปิดงานพยากรณ์ ตรวจย้อนหลัง และเก็บรักษา |
| `daily.run_at_utc` | `"21:00"` | `HH:MM` | เวลา UTC ที่เริ่มพยากรณ์ของวันถัดไป |
| `daily.facility` | `"THBK"` | ต้องเป็น `THBK` | Facility ที่ analyze และคัดลอก CSV แม่แบบ `thbk-gnss` สร้างแค่ THBK ชื่ออื่นทำให้ job ล้มเหลว (`SCENARIO_INVALID`) |
| `daily.retention_days` | `30` | 1–3650 | อายุของ `ephem/` และ `access/` ของ scenario รายวัน |
| `daily.validation_retry_hours` | `3` | 1–168 | ระยะห่างของการลองตรวจย้อนหลังซ้ำ |
| `daily.validation_give_up_days` | `14` | 1–365 | เลิกตรวจหลังจากวัน D ผ่านไปกี่วัน |
| `cesium_ion_token` | `""` | ข้อความ | token ของบัญชี ion.cesium.com ที่หน้าเว็บอ่านไปใช้กับชั้นภาพ Cesium ion (หัวข้อ 9.10) เก็บเป็นข้อความธรรมดาใน `settings.json` ไม่เข้ารหัส (`data/` ถูก git ละเว้น ห้ามนำเข้า repo) ตั้งได้ที่ Globe Manager หรือ Daily Forecast Settings |
| `online_imagery.enabled` | `false` | true/false | สวิตช์ภาพออนไลน์ของ **NASA GIBS** (server ดึงให้) **ปิดเสมอจนกว่าผู้ใช้เปิดเอง** (ไม่มีไฟล์ ไฟล์เสีย หรือไฟล์ที่รุ่นเก่าเขียนซึ่งไม่มีช่องนี้ = ปิด และ server ไม่เขียนไฟล์ตอนโหลด) |
| `online_imagery.eox` | `false` | true/false | สวิตช์ **Sentinel-2 cloudless (EOX)** (server ดึงให้) ปิดเสมอจนกว่าผู้ใช้เปิดเอง ช่องที่หายในไฟล์เก่า = ปิด |
| `online_imagery.osm` | `false` | true/false | สวิตช์ **OpenStreetMap** browser ดึงตรง server เก็บค่านี้ให้หน้าเว็บอ่านเท่านั้น ไม่ต่อเน็ตให้ ปิดเสมอจนกว่าผู้ใช้เปิดเอง |
| `online_imagery.ion` | `false` | true/false | สวิตช์ **Cesium ion** browser ดึงตรงด้วย `cesium_ion_token` เช่นเดียวกัน ปิดเสมอจนกว่าผู้ใช้เปิดเอง |

`PUT /api/settings` ต้องส่งทั้งเอกสารรวมทั้งสี่ช่องของ `online_imagery` (ขาดช่องใด = 422 ที่ field `online_imagery` หรือ `online_imagery.<ช่อง>`
ค่าต้องเป็น true/false จริง ไม่รับ `"true"`) หน้าต่าง Daily Forecast Settings ส่ง `online_imagery` ที่โหลดมาคืนไปทั้งก้อน ไม่เปลี่ยนค่าเหล่านี้
(`cesium_ion_token` ก็ต้องส่งทั้งก้อนเช่นกัน: ขาด = 422 ส่ง `""` = ลบ token ที่เก็บไว้)

### 8.4 สรุป endpoint

ทุก endpoint อยู่ใต้ `/api` เวลาเป็น ISO 8601 UTC ลงท้าย `Z` รายละเอียดของ request/response อยู่ใน spec ตามหัวข้อในตาราง
(หรือดูที่ `/api/docs`) หลายการแก้ scenario ใช้ ETag: อ่านจาก header `ETag` แล้วส่งกลับใน `If-Match` ไม่ตรงได้ 412 `ETAG_MISMATCH`

| กลุ่ม | Endpoint | Spec |
|---|---|---|
| ทั่วไป | `GET /health`, `GET/PUT /settings`, `GET /events` (SSE), `GET /messages` | §6.1, §8 |
| วงโคจร | `GET /orbits`, `POST /orbits/fetch` (ดึงจากเน็ต), `GET /catalog` | §6.2 |
| Scenario | `GET/POST /scenarios`, `GET/PUT/DELETE /scenarios/{sc}`, `POST /scenarios/{sc}/copy`, `GET/PUT /scenarios/{sc}/workbook` | §6.3 |
| Object | `GET/POST /scenarios/{sc}/objects`, `GET/PATCH/DELETE /scenarios/{sc}/objects/{class}/{name}`, `POST .../rename`, `POST /scenarios/{sc}/groups` (`{name, members[]}` ต้องส่ง `members`) | §6.4 |
| ผลลัพธ์ | `GET /scenarios/{sc}/results`, `POST /scenarios/{sc}/propagate`, `GET /scenarios/{sc}/ephem/{hash}/{file}`, `GET /scenarios/{sc}/access/{facility}/{hash}/{file}` | §6.5 |
| Access | `GET /scenarios/{sc}/access`, `POST .../access/compute`, `.../clear`, `.../remove`, `GET .../access/intervals?from=&to=` | §6.6 |
| Job | `GET /jobs`, `GET /jobs/{id}`, `POST /jobs/{id}/cancel` | §6.8, §7 |
| งานประจำวัน | `POST /daily/run` (ดึงจากเน็ต) `{for_date?}` สั่งพยากรณ์ของวันนั้นเอง | §6.8, §9.3 |
| ตรวจความแม่นยำ | `POST /scenarios/{sc}/validate` (ดึงจากเน็ต), `GET /validation/history`, `GET /validation/{sc}/{day}` | §6.8 |
| ภาพออนไลน์ | `GET /imagery/layers`, `GET /imagery/tiles/{layer}/{time}/{z}/{y}/{x}` (ดึงจาก NASA GIBS หรือ EOX เมื่อเปิดสวิตช์ของแหล่งนั้นเท่านั้น ดู 8.8; OpenStreetMap และ Cesium ion browser ดึงเอง ไม่ผ่าน server) | ภาพออนไลน์ §4, ภาพละเอียด §3 |

ยังไม่มีในรุ่นนี้: data provider, style และรายงาน (server §6.7) ซึ่งอยู่ในแผนของงานย่อยที่ 4 พร้อมโมดูล data provider ของ engine

### 8.5 ตรวจเกณฑ์ข้อ 5 ของ spec (งานประจำวัน 3 วันติด)

เกณฑ์ข้อ 5 ของ server §1 ("งานประจำวันรันครบ 3 วันติดโดยไม่มีคนสั่ง และมีผลตรวจแบบพยากรณ์จริงอย่างน้อย 1 วัน") ต้องปล่อย server รันจริงหลายวัน
จึงไม่ได้ตรวจในแผนพัฒนา ให้ตรวจตามนี้หลัง merge:

1. เปิด server ด้วยค่าตั้งต้น (งานประจำวันเปิด ไม่ต้องมี `settings.json`) ใน `data/` ที่จะเก็บผลจริง และเช็กว่า GMAT พบ:
   `curl -s http://127.0.0.1:8000/api/health` ต้องได้ `"gmat_found": true`
2. ปล่อยให้ server รันต่อเนื่องอย่างน้อย 3 วัน UTC ติดกัน เครื่องต้องไม่หลับ (เช่น `caffeinate -i .venv/bin/python -m gnss_studio_server`)
   ถ้าเปิดระหว่าง 21:00–24:00 UTC รอบของวันนั้นรันทันที (คำเตือนในหัวข้อ 8.3) รอบถัดไปรันเองเวลา `run_at_utc` ของแต่ละวัน
   (รอบที่สั่งด้วย `POST /api/daily/run` มี `origin` เป็น `user` จึงไม่นับในเกณฑ์นี้)
3. หลังรอบที่ 3 จบ ตรวจว่ามีผลพยากรณ์ 3 วันติดกันที่ตัวตั้งเวลาสั่งเอง:

   ```bash
   ls ../data/daily/                   # จากโฟลเดอร์ server/: thbk_gnss_pred_<D1>_24h.csv, <D2>, <D3> ที่เป็นวันติดกัน และ latest.csv
                                       # (ถ้าตั้ง GNSS_STUDIO_DATA ใช้ ls "$GNSS_STUDIO_DATA/daily/")
   curl -s 'http://127.0.0.1:8000/api/jobs?state=succeeded' | python3 -c '
   import json, sys
   for j in json.load(sys.stdin):
       if j["kind"] == "daily":
           print(j["params"]["for_date"], j["origin"], j["finished_utc"])'
   ```

   ต้องได้ 3 บรรทัดที่ `for_date` ติดกันและ `origin` เป็น `scheduler` ทุกบรรทัด
4. ดูผลตรวจย้อนหลังแบบพยากรณ์จริง:

   ```bash
   curl -s http://127.0.0.1:8000/api/validation/history | python3 -m json.tool
   ```

   ต้องมีอย่างน้อย 1 รายการที่ `scenario` ขึ้นต้นด้วย `daily_` (scenario ที่สร้างไว้ล่วงหน้าก่อนวันนั้นถึง จึงเป็นการตรวจแบบพยากรณ์จริง ไม่ใช่ hindcast
   ภาพรวม §10.3) พร้อมช่อง `pass` เกณฑ์ผ่านของแต่ละระบบ (G, R, E, C) อยู่ในภาพรวม §10.1 ผลตรวจรอ SP3 แบบ rapid ของวันนั้นซึ่งออกหลังวัน D ราว 1–2 วัน
   ถ้ายังไม่มีรายการ ให้รอต่อ (server ลองใหม่ทุก 3 ชม. จนถึง 14 วัน) และดู `GET /api/jobs?state=failed` ว่าเป็น `TRUTH_UNAVAILABLE` หรือรหัสอื่น

### 8.6 ทดสอบ

```bash
cd api-interop/gnss-predict/server && .venv/bin/python -m pytest -q       # test ของ server
cd api-interop/gnss-predict && python3 -m unittest discover -s tests       # test ของ engine
```

test ใช้ `data/` ชั่วคราวและไม่ใช้เน็ตทั้งหมด `server/tests/test_integration_gmat.py` รันทั้งสายผ่าน HTTP API ด้วย GMAT จริงและ process ลูกจริง
(New จากแม่แบบ → propagate → Access THBK→GPS → intervals มี G01 → `scene.czml` เปิดเป็น JSON) และข้ามอัตโนมัติถ้าหา GmatConsole ไม่เจอ
ผลเมื่อ 2026-11-11: server 923 ข้อผ่านใน 40–45 วินาที (รวม integration test ที่ใช้ GMAT จริงราว 2 วินาที), engine 461 ข้อผ่านใน 6 วินาที

### 8.7 บันทึกการทดลองจริงบนเครื่อง

รันเมื่อ 2026-11-11 เวลา 14:46–14:47 UTC บน Apple M5 Pro, macOS 26.4.1, GmatConsole R2026a ด้วย `data/` ชั่วคราว (ในคำสั่งแทนด้วย `$DEMO`)
**ไม่ได้ดึงข้อมูลจากเน็ต**: คัดลอก snapshot จริงที่ fetch ไว้แล้ว (หัวข้อ 7.4) และปิดงานประจำวันก่อนเปิด server

**1. เตรียม `data/` และเปิด server**

```bash
DEMO=$(mktemp -d); mkdir -p $DEMO/orbits
cp -R data/orbits/20261110T2147Z $DEMO/orbits/
cat > $DEMO/settings.json <<'JSON'
{"daily": {"enabled": false, "run_at_utc": "21:00", "facility": "THBK", "retention_days": 30, "validation_retry_hours": 3, "validation_give_up_days": 14}, "cesium_ion_token": "", "online_imagery": {"enabled": false}}
JSON

cd server
GNSS_STUDIO_DATA=$DEMO GNSS_STUDIO_PORT=8765 .venv/bin/python -m gnss_studio_server
# GNSS Studio: http://127.0.0.1:8765/
# INFO:     Uvicorn running on http://127.0.0.1:8765 (Press CTRL+C to quit)
```

**2. ตรวจ health และว่างานประจำวันปิดอยู่** (`curl -s http://127.0.0.1:8765/api/settings` และ `/api/health`)

```
{"daily":{"enabled":false,"run_at_utc":"21:00","facility":"THBK","retention_days":30,"validation_retry_hours":3,"validation_give_up_days":14},"cesium_ion_token":"","online_imagery":{"enabled":false}}
{"engine_version": "0.2.0", "gmat_found": true, "data_dir": "$DEMO", "writable": true,
 "daily": {"state": "idle", "last_run_utc": null, "next_run_utc": null, "for_date": null}}
```

`GET /api/jobs` ตอบ `[]` (ไม่มีงานที่ตัวตั้งเวลาสั่งเอง)

**3. สร้าง scenario 6 ชม. ของ 2026-11-11 จากแม่แบบ `thbk-gnss`**

```bash
curl -s -i -X POST http://127.0.0.1:8765/api/scenarios -H 'Content-Type: application/json' \
  -d '{"name":"run6h","start":"2026-11-11T00:00:00Z","stop":"2026-11-11T06:00:00Z","template":"thbk-gnss","snapshot":"20261110T2147Z"}'
```

```
HTTP/1.1 201 Created
etag: "9a91a4a0ad971b76"
location: /api/scenarios/run6h
...   (scenario.json ทั้งก้อน: Satellite 131, Constellation 4, Facility 1,
       accesses = [{"from": "*/Facility/THBK", "to": ["*/Constellation/GPS", "*/Constellation/GLONASS",
                    "*/Constellation/Galileo", "*/Constellation/BeiDou"], "computed": false}])
```

**4. Propagate และรอ** (เปิด `curl -N` ของข้อ 6 ไว้ก่อนสั่ง)

```bash
curl -s -X POST http://127.0.0.1:8765/api/scenarios/run6h/propagate
curl -s http://127.0.0.1:8765/api/jobs/j-20261111T144639-9dcd        # วนทุก 1 วินาที
```

```
{"job":"j-20261111T144639-9dcd"}            (HTTP 202)
14:46:39 running None
14:46:40 running {'stage': 'gmat', 'fraction': 0.1}
   ... (ขั้น gmat 9 วินาที)
14:46:49 succeeded {'stage': 'done', 'fraction': 1.0}
```

บันทึก job: `kind: propagate`, `state: succeeded`, `error: null`, `origin: user`, `started_utc 14:46:39.694Z`, `finished_utc 14:46:48.801Z`
(9.1 วินาที สำหรับ 6 ชม. ทุก 30 วินาที: propagate 120 จาก 131 ดวง ที่เหลือถูกซ่อนตามตัวกรองตั้งต้นในหัวข้อ 7.3) มี 53 ข้อความ `SAT_FLAGGED`

**5. ดูผลลัพธ์ แล้ว Compute Access THBK → GPS**

```bash
curl -s http://127.0.0.1:8765/api/scenarios/run6h/results
curl -s -i -X POST http://127.0.0.1:8765/api/scenarios/run6h/access/compute \
  -H 'Content-Type: application/json' -H 'If-Match: "9a91a4a0ad971b76"' \
  -d '{"from":"*/Facility/THBK","to":["*/Constellation/GPS"]}'
```

```
{"ephem": {"hash": "481b504e5a74", "status": "current", "available": ["481b504e5a74"]},
 "access": {"THBK": {"hash": "39d9e066542c", "status": "missing", "available": []}}, "error": null}

HTTP/1.1 202 Accepted
etag: "033a12d95ddf6070"
{"job":"j-20261111T144657-e958","etag":"033a12d95ddf6070"}
```

ผล propagate ใช้ได้ (`current`) แต่ยังไม่มีผล access ของ THBK (`missing`) จึงได้ job `analyze` (202) ที่จบใน 1.0 วินาที เพราะใช้ผล propagate เดิมไม่รัน GMAT ซ้ำ
(`/results` หลังจบ: `"access": {"THBK": {"hash": "39d9e066542c", "status": "current", ...}}`)

**6. ช่วง access ของ GPS**

```bash
curl -s -G http://127.0.0.1:8765/api/scenarios/run6h/access/intervals \
  --data-urlencode 'from=*/Facility/THBK' --data-urlencode 'to=*/Constellation/GPS'
```

```
{"G01": [{"start": "2026-11-11T02:43:10.753Z", "stop": "2026-11-11T04:21:19.428Z", "duration_s": 5888.675, "max_el_deg": 12.813}],
 "G02": [{"start": "2026-11-11T01:33:34.912Z", "stop": "2026-11-11T03:57:42.541Z", "duration_s": 8647.629, "max_el_deg": 15.942}],
 "G03": [{"start": "2026-11-11T03:33:23.561Z", "stop": "2026-11-11T06:00:00.000Z", "duration_s": 8796.439, "max_el_deg": 42.033}],
 ...}                                    (คีย์เป็นชื่อดาว 32 ดวง, 18 ดวงมีช่วง access ใน 6 ชม.)
```

**7. SSE: `curl -N http://127.0.0.1:8765/api/events`** (เปิดค้างไว้ 40 วินาทีตั้งแต่ก่อนสั่ง propagate ตัดมาเฉพาะเฟรมที่เกี่ยวกับ job)

```
event: ping
data: {}

event: job
data: {"id":"j-20261111T144639-9dcd","kind":"propagate","scenario":"run6h","state":"queued","progress":null}

event: job
data: {"id":"j-20261111T144639-9dcd","kind":"propagate","scenario":"run6h","state":"running","progress":{"stage":"gmat","fraction":0.1}}

event: job
data: {"id":"j-20261111T144639-9dcd","kind":"propagate","scenario":"run6h","state":"succeeded","progress":{"stage":"done","fraction":1.0}}

event: message
data: {"time":"2026-11-11T14:46:48.787Z","level":"info","code":"SAT_FLAGGED","text":"ดาว C01 (NORAD 56564): ชื่อใน CelesTrak (BEIDOU-3 G4 (C62)) มี PRN ไม่ตรงกับ IGS","object":"C01"}

event: scenario
data: {"name":"run6h","etag":"033a12d95ddf6070","results_stale":false}

event: job
data: {"id":"j-20261111T144657-e958","kind":"analyze","scenario":"run6h","state":"running","progress":{"stage":"aer","fraction":0.5}}
```

ทั้ง 40 วินาทีได้ `ping` 2 เฟรม (ทันทีที่เชื่อมต่อ และอีกเฟรมหลังเงียบไป 15 วินาที), `job` 19 เฟรม (ทั้ง propagate และ analyze ตั้งแต่ `queued` ถึง `succeeded`),
`message` 106 เฟรม และ `scenario` 1 เฟรม (ETag ใหม่หลัง Compute)

**8. ดาวน์โหลด `scene.czml` และเทียบ SHA-256 กับไฟล์บนดิสก์** (server §1 เกณฑ์ข้อ 6)

```bash
curl -s -D- -o scene.czml http://127.0.0.1:8765/api/scenarios/run6h/ephem/481b504e5a74/scene.czml
shasum -a 256 scene.czml $DEMO/scenarios/run6h/ephem/481b504e5a74/scene.czml
```

```
HTTP/1.1 200 OK
etag: "5505652f86448e183ed2891db934e6212fb944c756693d25250bd32f7881424c"
cache-control: public, max-age=31536000, immutable
content-type: application/json
5505652f86448e183ed2891db934e6212fb944c756693d25250bd32f7881424c  scene.czml
5505652f86448e183ed2891db934e6212fb944c756693d25250bd32f7881424c  .../ephem/481b504e5a74/scene.czml
```

ไฟล์เป็น JSON list 121 packet โดย packet แรกมี `id` เป็น `"document"` (ตรงกับ ETag และ SHA-256 ของไฟล์ที่ engine เขียน)

**9. หยุด server**: `kill <pid>` (SIGTERM) ได้ `Shutting down` / `Application shutdown complete` / `Finished server process` ภายในไม่ถึง 5 วินาที
ตรวจแล้วไม่มี process ของ server หรือ `GmatConsole` ค้าง และ port 8765 ปิด

### 8.8 ภาพถ่ายออนไลน์ (NASA GIBS และ Sentinel-2 cloudless)

server ดึงภาพถ่ายจริงมาให้หน้าเว็บได้จาก **สองแหล่ง**: NASA GIBS (`gibs.earthdata.nasa.gov` สวิตช์ `online_imagery.enabled`) และ Sentinel-2 cloudless ของ EOX
(`tiles.maps.eox.at` สวิตช์ `online_imagery.eox`) **เฉพาะเมื่อผู้ใช้เปิดสวิตช์ของแหล่งนั้น** (ตั้งต้นปิดเสมอ ดูตารางค่าตั้งใน 8.3: ไม่มีไฟล์ ไฟล์เสีย
หรือไฟล์รุ่นเก่าที่ไม่มีช่องนั้น = ปิด และเปิดแหล่งหนึ่งไม่เปิดแหล่งอื่น) สวิตช์ของแหล่งใดปิด = server ไม่ส่ง request ใดไปโฮสต์นั้นเลย
และ `GET /api/imagery/tiles/...` ของชั้นภาพในแหล่งนั้นตอบ 403 `IMAGERY_DISABLED` (ข้อความไทยบอกชื่อแหล่ง) **แม้ชิ้นนั้นอยู่ใน cache แล้ว** server อ่านสวิตช์จาก `settings.json` ทุกคำขอ
`PUT /api/settings` จึงมีผลทันทีโดยไม่ต้องเปิด server ใหม่ ส่วน `GET /api/imagery/layers` ใช้ได้เสมอ (ไม่ต่อเน็ต)

| แหล่งที่ server ต่อ | สวิตช์ | แม่แบบ URL (ประกอบใน `imagery.py` เท่านั้น) | ดึงพร้อมกัน |
|---|---|---|---|
| GIBS | `online_imagery.enabled` | `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/{layer}/default/{time}/{tms}/{z}/{y}/{x}.{ext}` | ไม่เกิน 4 ชิ้น |
| EOX (Sentinel-2 cloudless) | `online_imagery.eox` | `https://tiles.maps.eox.at/wmts/1.0.0/{layer}/default/g/{z}/{y}/{x}.jpg` | ไม่เกิน 4 ชิ้น |

**OpenStreetMap และ Cesium ion ไม่ผ่าน server**: browser ดึงเองโดยตรงเมื่อผู้ใช้เปิดสวิตช์ (`online_imagery.osm`, `online_imagery.ion`)
server แค่เก็บค่าสวิตช์และ Cesium ion token (`cesium_ion_token`) ใน `settings.json` ให้หน้าเว็บอ่าน ไม่มี endpoint ไม่ต่อเน็ตให้ และไม่เก็บชิ้นภาพของสองแหล่งนี้ ดูหัวข้อ 9.10

**สิ่งที่ส่งออกจากเครื่อง (ส่วนที่ server เป็นผู้ต่อ)**: คำขอ HTTPS ไป `gibs.earthdata.nasa.gov` หรือ `tiles.maps.eox.at` เท่านั้น เนื้อคำขอมีชื่อชั้นภาพ พิกัดชิ้นภาพ (`z/y/x`)
(GIBS เพิ่มเวลาของภาพ) และ `User-Agent: gnss-studio/0.1` ไม่ส่ง scenario ตำแหน่งผู้ใช้ หรือข้อมูลอื่นของโปรแกรม แต่โฮสต์นั้น (และเครือข่ายระหว่างทาง) เห็น**หมายเลข IP ของเครื่องนี้**
(หรือของเครือข่ายที่ใช้ออกอินเทอร์เน็ต) และ User-Agent นั้นเหมือนการเปิดเว็บทั่วไป กล่องยืนยันของ Globe Manager บอกเรื่องนี้ก่อนเปิดสวิตช์ของแต่ละแหล่ง URL ประกอบจากตารางชั้นภาพใน `imagery.py` กับค่าที่ตรวจแล้วเท่านั้น
server ไม่รับ URL, host หรือ path จากผู้ใช้ และไม่ตาม redirect เลย (3xx นับเป็นดึงไม่สำเร็จ) browser ไม่ติดต่อ GIBS หรือ EOX ตรง: ทุกคำขอไปที่ server ในเครื่อง

**ชั้นภาพ** (ตารางเดียวใน `server/gnss_studio_server/imagery.py` ลำดับในตาราง = ลำดับวาด ชั้นหลังทับชั้นก่อน แต่ละแถวบอกแหล่ง `source`):
GIBS 8 ชั้น `BlueMarble_NextGeneration` (คงที่), `VIIRS_NOAA20_CorrectedReflectance_TrueColor`, `VIIRS_SNPP_CorrectedReflectance_TrueColor`,
`MODIS_Terra_CorrectedReflectance_TrueColor` (รายวัน), `Himawari_AHI_Band3_Red_Visible_1km`, `Himawari_AHI_Band13_Clean_Infrared`,
`GOES-East_ABI_GeoColor`, `GOES-West_ABI_GeoColor` (ทุก 10 นาที) และ EOX 1 ชั้น `s2cloudless-2024_3857` (ภาพคงที่รายปี ชื่อบนจอ Sentinel-2 cloudless 2024,
TileMatrixSet `g`, ระดับสูงสุด 15, jpg, เวลาใน route ใช้ `default`) ค่า TileMatrixSet, นามสกุลไฟล์และรูปแบบเวลาของแต่ละชั้นเป็นค่าที่คาดไว้ตาม spec
**ส่วนใหญ่ยังไม่ได้ยืนยันกับของจริง** (ที่ตรวจแล้วและที่ยังไม่ตรวจ: หัวข้อ 9.10 ไม่มี test หรือโค้ดใดต่อเน็ตจริง) ถ้าโฮสต์ตอบต่างไปแก้ที่ตารางนั้นที่เดียว

**Endpoint**

- `GET /api/imagery/layers` -> `{"enabled", "sources": {"gibs", "eox", "osm", "ion"}, "layers": [{"id", "title", "period", "max_level", "format", "credit", "source"}]}`
  (`sources` = สวิตช์ครบสี่แหล่ง, `enabled` = สวิตช์ GIBS คงไว้เพื่อเข้ากันได้, `layers` มีเฉพาะชั้นของ GIBS และ EOX: OSM และ ion ไม่อยู่ใน catalog ของ server)
- `GET /api/imagery/tiles/{layer}/{time}/{z}/{y}/{x}` -> ไบต์ JPEG/PNG พร้อม `Content-Type` ที่ server กำหนดจากชนิดภาพที่ตรวจได้, `X-Content-Type-Options: nosniff`,
  `Cache-Control: private, max-age=86400` (ชิ้นที่ยังไม่นิ่ง = `no-store` ดูหัวข้อ cache ด้านล่าง) ตรวจตามลำดับและไม่ต่อเน็ตเมื่อไม่ผ่าน: สวิตช์ของแหล่งที่ชั้นนั้นสังกัดปิด 403 `IMAGERY_DISABLED` -> ไม่รู้จักชั้นภาพ 404 `IMAGERY_UNKNOWN_LAYER`
  (id ต้องตรงทุกตัวอักษร รวมตัวพิมพ์ ชั้นที่ไม่รู้จักไม่มีแหล่งให้ดูสวิตช์: ตอบ 403 ถ้า GIBS และ EOX ปิดทั้งคู่ ไม่งั้นตอบ 404; สวิตช์ osm และ ion ไม่เกี่ยวกับ route นี้)
  -> เวลาผิดรูปแบบของรอบภาพ 422 field `time` (คงที่ `default`, รายวัน `YYYY-MM-DD`, 10 นาที `YYYY-MM-DDTHH:MM:00Z` นาที 00-50 ทีละ 10
  และต้องเป็นวันเวลาที่มีจริง) -> `z`, `y`, `x` ไม่ใช่เลขทศนิยม 1-5 หลัก หรือ `z` ไม่อยู่ใน 0..ระดับสูงสุดของชั้น หรือ `y`/`x` ไม่อยู่ใน 0..2^z-1 (ระดับ 15 ของ EOX ถึง 32767) 422 field `z`/`y`/`x`
  หลังจากนั้น: ไม่มีภาพ (โฮสต์ตอบ 400/404) 404 `IMAGERY_NOT_AVAILABLE`, ดึงไม่สำเร็จ 502 `IMAGERY_FETCH_FAILED`, คำขอค้างมาก 503 `IMAGERY_BUSY`,
  กำลังพักการดึง 503 `IMAGERY_PAUSED` (`detail` = เวลา UTC ที่ลองได้อีก)

**ขีดจำกัดการดึง** (ปกป้องโฮสต์ภาพและเครื่องของผู้ใช้ ไม่ลองซ้ำเองใน server; การพัก ตัวนับความผิดพลาด และคิวแยกต่อแหล่ง: แหล่งหนึ่งโดนบล็อกหรือล่ม อีกแหล่งยังใช้ได้):

| เรื่อง | ค่า |
|---|---|
| timeout ต่อชิ้น | 20 วินาที |
| ดึงพร้อมกัน | GIBS ไม่เกิน 4 ชิ้น, EOX ไม่เกิน 4 ชิ้น รอคิวเกิน 15 วินาที ตอบ 503 `IMAGERY_BUSY` |
| ขนาดชิ้น | อ่านไม่เกิน 2 MB (เกินตอบ 502 ไม่เก็บ) ไบต์แรกต้องเป็น JPEG (`FF D8 FF`) หรือ PNG (`89 50 4E 47 0D 0A 1A 0A`) ตรงกับชนิดของชั้น ไม่ถอดรหัสภาพ ไม่เชื่อ Content-Type ของโฮสต์ |
| โฮสต์ตอบ 400/404 | จำไว้ในหน่วยความจำ 1 ชั่วโมง (ชิ้นที่ยังไม่นิ่ง 10 นาที; สูงสุด 10,000 ชิ้น) ไม่ถามซ้ำ |
| โฮสต์ตอบ 403 หรือ 429 | พักการดึงทุกชั้นภาพของแหล่งนั้น 15 นาที (log ครั้งเดียว) |
| ผิดพลาดติดกัน 20 ครั้ง (เครือข่าย, timeout, 5xx, ตอบผิดรูป) | พักแหล่งนั้น 5 นาที ได้ภาพที่ใช้ได้หนึ่งชิ้นจากแหล่งนั้นตัวนับกลับเป็น 0 |

ระหว่างพัก ชิ้นที่อยู่ใน cache ยังส่งได้ ชิ้นที่ไม่มีตอบ 503 `IMAGERY_PAUSED` โดยไม่ต่อเน็ต

การเชื่อมต่อ: ใช้ connection HTTPS ซ้ำ (keep-alive, เชื่อมตรง) และส่ง GET ซ้ำได้อย่างมากหนึ่งครั้งเมื่อ connection ว่างถูกตัด ; ถ้าตั้ง `HTTPS_PROXY` / `https_proxy` (และ host ไม่อยู่ใน `NO_PROXY`) คำขอนั้นผ่าน proxy ด้วย opener ของ urllib เดิม (ไม่ใช้ connection ซ้ำ ไม่ตาม redirect)

**Cache**: `data/imagery/tiles/<ชั้น>/<เวลา>/<z>/<y>/<x>.<jpg|png>` (`:` ในเวลาเป็น `-`) เขียนแบบ atomic ทุกชิ้นที่ผ่านการตรวจ
ขนาดรวมของ**ทุกแหล่ง**ไม่เกิน **2 GB** (2 × 1024³ ไบต์): เกินแล้วลบไฟล์ที่ mtime เก่าสุดจนเหลือ 90% (ส่งจาก cache = แตะ mtime) server นับขนาดครั้งแรกด้วยการสแกนแล้วจำยอดไว้
ชั้นคงที่ (Blue Marble และ Sentinel-2 cloudless 2024 ของ EOX) เก็บถาวรภายใต้เพดานเดียวกัน **ชิ้นที่ GIBS อาจยังเติมไม่ครบไม่เก็บลงดิสก์**: ชั้นรายวันของวันนี้และเมื่อวาน (วันที่ UTC รวมอนาคต)
และชั้น 10 นาทีของ 3 ชั่วโมงล่าสุด (รวมอนาคต) ดึงใหม่ทุกครั้งที่ขอ ไม่อ่านจาก cache ตอบพร้อม `Cache-Control: no-store` และ "ไม่มีภาพ" ของชิ้นเหล่านี้จำแค่ 10 นาที
ภาพจึงสดขึ้นเองเมื่อ GIBS ประมวลผลเสร็จ โฟลเดอร์ `data/imagery/` อยู่นอก `orbits/` และไม่ขึ้นต้นด้วย `_` จึงไม่ปนกับ snapshot ลบทิ้งทั้งโฟลเดอร์ได้เสมอ
(ชิ้นที่ต้องใช้จะถูกดึงใหม่ถ้าสวิตช์ของแหล่งนั้นเปิดอยู่) ถ้าเก็บลงดิสก์ไม่ได้ server ยังส่งภาพให้และเตือนใน `data/logs/server.log` หนึ่งครั้ง

test: `server/tests/test_imagery.py` ใช้ opener ปลอมและกัน `urlopen`/`OpenerDirector.open`/`socket.create_connection` ทั้งโมดูล จึงไม่มีการต่อเน็ตจริง

## 9. GNSS Studio workspace

หน้าเว็บของ GNSS Studio (งานย่อยที่ 3) ใช้งานเหมือน STK: เมนู แถบเครื่องมือ Object Browser, Properties Browser, Animation, Timeline View,
หน้าต่าง 3D (Cesium) และ 2D, Message Viewer และแถบสถานะ ทำงานบน server ในหัวข้อ 8 โดยไม่ต่อเน็ตเอง (ภาพโลกคือ NaturalEarthII ที่มากับ Cesium
ไม่ใช้ Cesium ion, Bing, terrain หรือ CDN) ยกเว้นเมื่อผู้ใช้เปิดภาพจริงใน Globe Manager เอง (สี่แหล่ง แต่ละแหล่งปิดไว้ก่อนและมีกล่องยืนยันของตัวเอง): ชั้นภาพวางทับ NaturalEarthII
บนหน้าต่าง 3D และ Sensor View ภาพของ NASA GIBS และ Sentinel-2 cloudless (EOX) server เป็นผู้ดึง ส่วน OpenStreetMap และ Cesium ion browser ดึงเองโดยตรง (หัวข้อ 8.8 และ 9.10)
โค้ดอยู่ใต้ `web/` (React 18 + TypeScript + Vite, dockview, CesiumJS)

- Spec: [docs/2026-11-11-gnss-studio-workspace-design.md](docs/2026-11-11-gnss-studio-workspace-design.md) (อ้างว่า "workspace §n")
- Spec งานเสริม ก (Sensor และ Sensor View): [docs/2026-11-13-gnss-studio-sensor-design.md](docs/2026-11-13-gnss-studio-sensor-design.md) (อ้างว่า "sensor spec §n", หัวข้อ 9.9)
- Spec งานเสริม ข (โหมด Camera ของ Sensor View, ภาพ NASA GIBS, Globe Manager): [docs/2026-11-14-gnss-studio-imagery-design.md](docs/2026-11-14-gnss-studio-imagery-design.md)
  (อ้างว่า "imagery spec §n", หัวข้อ 8.8, 9.9 และ 9.10)
- Spec งานเสริม ข1.5 (ภาพละเอียด: Sentinel-2 cloudless, OpenStreetMap, Cesium ion และซูม Sensor View ถึง ×8192): [docs/2026-11-14-gnss-studio-hires-imagery-design.md](docs/2026-11-14-gnss-studio-hires-imagery-design.md)
  (อ้างว่า "ภาพละเอียด spec §n", หัวข้อ 8.8, 9.9 และ 9.10) การตัดสินใจระหว่างลงมือของ ข และ ข1.5: [docs/2026-11-14-gnss-studio-imagery-decisions.md](docs/2026-11-14-gnss-studio-imagery-decisions.md)

### 9.1 ติดตั้ง

ต้องมี Node.js รุ่นใหม่พอสำหรับ Vite 8 (ทดสอบกับ Node 26 / npm 11) ทุกแพ็กเกจตรึงรุ่นแบบ `x.y.z` และ `package-lock.json` อยู่ใน git จึงติดตั้งด้วย `npm ci`

```bash
cd api-interop/gnss-predict/web
npm ci
```

### 9.2 พัฒนา

**ก่อนเปิด server ครั้งแรก ให้ปิดงานประจำวันก่อน** checkout ใหม่ยังไม่มี `data/settings.json` server จึงใช้ค่าตั้งต้นที่ **เปิด** งานประจำวัน
ถ้าเปิด server หลัง 21:00 UTC (04:00 เวลาไทย) server จะดาวน์โหลดจาก CelesTrak, IGS และ CDDIS เองภายในประมาณ 60 วินาทีโดยไม่มีใครกด
([คำเตือนในหัวข้อ 8.3](#83-งานประจำวัน-ดาวน์โหลดจากเน็ต)) ขั้นนี้ทำครั้งเดียว และไม่เขียนทับไฟล์ค่าตั้งที่มีอยู่แล้ว:

```bash
cd api-interop/gnss-predict
mkdir -p data
[ -e data/settings.json ] || printf '%s\n' '{"daily":{"enabled":false,"run_at_utc":"21:00","facility":"THBK","retention_days":30,"validation_retry_hours":3,"validation_give_up_days":14},"cesium_ion_token":"","online_imagery":{"enabled":false}}' > data/settings.json
python3 -I -c 'import json; print(json.load(open("data/settings.json"))["daily"]["enabled"])'   # ต้องพิมพ์ False
```

ถ้าพิมพ์ `True` แปลว่ามีไฟล์ค่าตั้งเดิมที่เปิดงานประจำวันไว้ ให้แก้ `"enabled"` เป็น `false` ในไฟล์นั้นก่อนเปิด server (หรือตั้งใจเปิดไว้ก็ได้)
อีกทางคือไม่แตะ `data/` จริงเลย: เปิด server บนโฟลเดอร์ data ชั่วคราวด้วย `GNSS_STUDIO_DATA` ที่เขียน `settings.json` ที่ปิดงานประจำวันไว้ก่อน แบบขั้นที่ 2 ในหัวข้อ 9.6

จากนั้นเปิด server (หัวข้อ 8.2) ที่ port 8000 แล้วเปิด Vite คู่กัน:

```bash
cd api-interop/gnss-predict/server && .venv/bin/python -m gnss_studio_server     # terminal 1: http://127.0.0.1:8000/
cd api-interop/gnss-predict/web && npm run dev                                      # terminal 2: Vite (ตั้งต้น http://localhost:5173/)
```

Vite ส่งต่อ `/api` (รวม SSE ที่ `/api/events`) ไป `http://127.0.0.1:8000` และ **เขียน header `Origin` ใหม่เป็น `http://127.0.0.1:8000`
เฉพาะคำขอจากหน้าเว็บของ Vite เอง** เพราะ server ตอบ 403 `FORBIDDEN_ORIGIN` กับคำขอ POST, PUT, PATCH, DELETE ที่ `Origin` ไม่ตรง origin ของ server เอง
(หัวข้อ 8.2) หน้าเว็บที่ Vite ส่งอยู่ที่ port 5173 จึงส่ง `Origin: http://localhost:5173` ซึ่ง server ปฏิเสธถ้าไม่เขียนใหม่
proxy เขียนใหม่เมื่อ `Origin` ตรงกับ `http://<Host ของคำขอ>` และ Host เป็น `localhost`, `127.0.0.1` หรือ `[::1]` เท่านั้น (`web/devOrigin.ts`)
`Origin` ของเว็บอื่นผ่านไปตามเดิมแล้ว server ตอบ 403 เว็บอื่นที่เปิดในเบราว์เซอร์ระหว่าง `npm run dev` จึงส่งฟอร์มมาสั่ง
`/api/orbits/fetch`, `/api/daily/run` หรือ `/validate` ผ่าน Vite ไม่ได้ ถ้า server ไม่ได้ฟังที่ port 8000 ให้แก้ `SERVER_ORIGIN` ใน `web/vite.config.ts`

### 9.3 build แล้วเปิดจาก server

ปิดงานประจำวันใน `data/settings.json` ตามหัวข้อ 9.2 ก่อน (หรือใช้ `GNSS_STUDIO_DATA` ชั่วคราว) ไม่งั้น server ที่เปิดหลัง 21:00 UTC
ดาวน์โหลดจากเน็ตเองได้ ([คำเตือนในหัวข้อ 8.3](#83-งานประจำวัน-ดาวน์โหลดจากเน็ต))

```bash
cd api-interop/gnss-predict/web && npm run build        # ได้ web/dist/ (Cesium Workers, Assets, Widgets, ThirdParty คัดลอกไป dist/cesium/)
cd ../server && .venv/bin/python -m gnss_studio_server  # server ส่ง web/dist ที่ http://127.0.0.1:8000/
```

เปิด `http://127.0.0.1:8000/` ได้หน้า Welcome ถ้าไม่มี scenario ที่เปิดค้าง หรือเปิด scenario ตรงด้วย `http://127.0.0.1:8000/?sc=<ชื่อ scenario>`
(ต่อท้าย `&test` จะเปิดฟังก์ชันสำหรับ test `window.__gnssStudioTest` ซึ่งใช้ใน e2e และการวัดประสิทธิภาพเท่านั้น)

### 9.4 type ของ API

type ฝั่งหน้าเว็บ (`web/src/api/types.gen.ts`, `enums.gen.ts`, `openapi.json`) สร้างจาก OpenAPI ของ server ไม่แก้มือ รันซ้ำทุกครั้งที่ API ของ server เปลี่ยน แล้ว commit ผล:

```bash
cd api-interop/gnss-predict/web
npm run gen:api          # dump OpenAPI -> openapi-typescript -> enums
npm run gen:api:check    # ตรวจว่า type ที่ commit ตรงกับ server ปัจจุบัน
```

### 9.5 การทดสอบทุกชั้น

| ชั้น | คำสั่ง (จากโฟลเดอร์ที่ระบุ) | ตรวจอะไร |
|---|---|---|
| Vitest (jsdom, timezone America/New_York) | `cd web && npm test` | เวลา UTCG/LTZG, store, คำสั่ง, เมนู, Object Browser, Properties, Timeline, ฟังก์ชันล้วนของ Cesium (สี กราฟิก swath IPP) และ `labels.ts` เทียบ STK ref |
| TypeScript | `cd web && npm run typecheck` | ทั้ง `src/`, `tests/` (รวม e2e) และ config |
| Playwright (Chromium) | `cd web && npm run e2e` | build หน้าเว็บแล้วรัน `tests/e2e/*.spec.ts` กับ server จริงที่ port 8766 (ด้านล่าง) |
| server | `cd server && .venv/bin/python -W error -m pytest -q` | API, job, ตัวตั้งเวลา (0 warning) |
| engine | `python3 -m unittest discover -s tests` (จาก `gnss-predict`) | หัวข้อ 6 และ 7 |

**e2e** ต้องมี Chromium ของ Playwright ครั้งเดียว: `cd web && npx playwright install chromium` (ดาวน์โหลดราว 260 MB จาก CDN ของ Playwright)
`npm run e2e` ทำ `npm run build && playwright test` ใช้ `workers: 1` เพราะทุก spec ใช้ server และข้อมูลชุดเดียวกัน
`playwright.config.ts` เปิด server เองด้วย `tests/e2e/start-server.sh` (ไม่ใช้ server ที่เปิดค้างไว้: `reuseExistingServer: false` จึงต้องไม่มีอะไรฟัง port 8766)

- ข้อมูลของ e2e สร้างใหม่ทุกครั้งที่ `web/test-results/e2e-data` โดย `tests/e2e/fixture/build_fixture.py` (รันด้วย `server/.venv/bin/python -I`):
  คัดลอก snapshot fixture ของ engine (`tests/fixtures/studio/snapshot`), เขียน `settings.json` ที่ปิดงานประจำวัน **ก่อน** server เริ่ม,
  สร้าง scenario `E2E` (thbk-gnss ช่วง 2026-11-10 00:00–06:00 UTC **มีผลลัพธ์**), `E2E_NORES` (ชุดเดียวกัน ไม่มีผล) และ `E2E_EMPTY` (ว่าง)
  ผลลัพธ์ของ `E2E` มาจาก `run_propagate` และ `run_analyze("THBK")` ของ engine จริง โดยแทน `propagate`, `find_gmat_console` และ `gmat_version`
  ด้วยวงโคจรวงกลมปลอม (รัศมี G 26 560 km, R 25 508 km, E 29 600 km, BeiDou MEO/IGSO 27 906 km, GEO 42 164 km ที่ลองจิจูดคงที่; ตำแหน่ง Earth-fixed
  คือวงกลมเฉื่อยหมุนด้วย ωe = 7.2921151467e-5 rad/s) จึงไม่ต้องใช้ GMAT และไฟล์มีรูปแบบเหมือนของจริงทุกประการ สคริปต์ปิดการเชื่อมต่อเครือข่ายขณะสร้าง
- **ไม่มี test ใดดาวน์โหลดจากเน็ต**: server ของ e2e มี `GMAT_BIN=/nonexistent` และ `daily.enabled: false` และ spec ไม่เรียก
  `/api/orbits/fetch`, `/api/daily/run` หรือ `/api/scenarios/*/validate` (CelesTrak จำกัดความถี่ และห้ามดึงโดยไม่ได้ยินยอม)
- spec: `layout` (การจัดวางตั้งต้นตามหัวข้อ 4.2; ปิด Timeline View แล้ว Ctrl+S แล้ว reload ได้ layout เดิม), `animation` (Start, Pause, Step Forward ได้ 60 วินาทีพอดี, Reset),
  `position` (ตำแหน่ง G01 ใน 3D ต่างจาก `predicted.sp3` ไม่เกิน 1 ม. หลายเวลา; ที่วัดได้ราว 0.5 มม.), `properties` (สีของดาว, Show Labels), `timeline`
  (Set Animation Time to Here ตรงตำแหน่งที่คลิก), `insert` (Satellite จาก Catalog สองดวง + Constellation), `messages` (ข้อความของ job ขึ้น Message Viewer, Clear this Tab ลบเฉพาะแท็บ),
  `conflict` (Apply ที่ ETag เก่าขึ้นกล่อง Reload/Cancel), `nores` (scenario ไม่มีผลลัพธ์ไม่ล่ม), `sensor` (Sensor View จากเมนู Satellite, ดับเบิลคลิกใน Sensor View, เปลี่ยน Cone Half Angle,
  คลิกซ้ายและขวาที่ดาวในหน้าต่าง 3D, ลบดาวแล้วหน้าต่างปิด, scenario ที่ไม่มีผลลัพธ์; หัวข้อ 9.9), `imagery` (Sensor View เปิดเป็นโหมด Camera ไม่มี entity แสดง,
  Zoom In สี่ครั้ง (ทีละ ×√2) ได้มุมกว้างด้านสั้น 1/4 ของ ×1 คลาดไม่เกิน 1% และกล้องยังอยู่ที่ดาว, Zoom In 26 ครั้งถึง ×8192 (มุมกว้างด้านสั้น 1/8192 ของ ×1, ทิศกล้องคลาดไม่เกิน 0.01°, HUD แสดงความกว้างพื้นที่),
  ช่อง Width "1.5 km" ได้พื้นที่กว้าง 1.5 km คลาดไม่เกิน 3%,
  สลับ Camera/Sensor, ล้อเมาส์ซูมทีละ ×√2, Globe Manager แสดง 4 กลุ่มแหล่ง (11 แถว) และติ๊กสวิตช์ของแต่ละแหล่งแล้วกด Cancel/Esc ไม่เปลี่ยนค่าตั้ง; หัวข้อ 9.10), `models` (ดาวที่แสดงในหน้าต่าง 3D เป็นโมเดลทุกดวง `catalog.json` ถูกขอครั้งเดียว glb ไม่เกินครั้งเดียวต่อไฟล์, ปิด Satellite Models แล้วจุดกลับมาและเปิดใหม่ไม่ fetch ซ้ำ, +Z ของดาวชี้ลงโลกคลาดไม่เกิน 0.5° และตามเวลา; หัวข้อ 9.11), `perf` (ข้ามเว้นแต่ตั้ง `GNSS_E2E_PERF_URL`, ดูหัวข้อ 9.6)
- ทุก spec ฟัง `pageerror` ของหน้า ถ้ามี exception ที่ไม่ถูกจับ test ล้มเหลว และบันทึกทุก request ของ browser (`tests/e2e/fixtures.ts`):
  ถ้ามี URL ที่ไม่ใช่ `http://127.0.0.1:8766/...`, `data:` หรือ `blob:` test ล้มเหลวพร้อมรายการ URL นั้น (ยืนยันว่าหน้าเว็บไม่ต่อเน็ตนอกเครื่อง)
  เมื่อตั้ง `GNSS_E2E_PERF_URL` (หัวข้อ 9.6) ตัวตรวจอนุญาต origin ของ URL นั้นเพิ่มอีกหนึ่ง origin ตรงตัว (เช่น `http://127.0.0.1:8767/`) ไม่กว้างกว่านั้น (ตรรกะอยู่ใน `tests/e2e/localRequest.ts`)
- **e2e ไม่ต่อภาพออนไลน์แหล่งใดเลย**: `settings.json` ของข้อมูล e2e มี `"online_imagery":{"enabled":false,"eox":false,"osm":false,"ion":false}` (ปิดทุกแหล่ง) และ `cesium_ion_token` ว่าง (ไม่มี test ใดใส่ token)
  `imagery.spec.ts` บันทึกทุก request ของ browser และล้มเหลวถ้ามี request ไป `/api/imagery/tiles` หรือไป host ใดนอก server ของ e2e แม้สักครั้ง (และไม่เรียกชิ้นภาพจาก test เอง)
  ตัวกัน request นอกเครื่องข้างบนยังใช้ต่อ ตรวจกล่องยืนยันของทั้งสี่แหล่งโดยกด Cancel เท่านั้น

### 9.6 วัดประสิทธิภาพ (เกณฑ์ข้อ 1 และ 2 ของ spec)

เกณฑ์ข้อ 1: เปิด scenario รายวันแล้วภาพขึ้นภายใน 3 วินาที (`scene.czml` ราว 2–3 MB) วัดที่ `window.__gnssStudioTest.sceneLoadedAt()` (เวลาตั้งแต่เปิดหน้า)
เกณฑ์ข้อ 2: กด Start แล้วดาว 130 ดวงเคลื่อนพร้อมกันไม่ต่ำกว่า 30 ภาพต่อวินาที วัดจำนวนเฟรมของหน้าต่าง 3D ใน 5 วินาที (ต้อง ≥ 150) ขณะหน้าต่าง 2D เปิดอยู่ด้วย
ผลขึ้นกับเครื่องและ GPU จึงวัดบนเครื่องพัฒนาด้วย `--headed` (การเรนเดอร์ด้วย CPU/SwiftShader ใน headless ไม่ใช่ตัวตัดสิน
`playwright.config.ts` ไม่ใส่ `--use-angle=swiftshader` เมื่อตั้ง `GNSS_E2E_PERF_URL`)

ขั้นตอน (ห้ามเปิด server บน `data/` จริง เพราะงานประจำวันอาจดึงข้อมูลจาก CelesTrak) ใช้สอง terminal คำสั่งทุกบล็อกขึ้นต้นด้วย `cd` ของมันเอง
`$REPO` คือ root ของ repo (โฟลเดอร์ที่มี `api-interop/`) และใช้ `data/` ของ `api-interop/gnss-predict` เป็นแหล่งคัดลอกเท่านั้น

ก่อนเริ่ม: **ต้อง build หน้าเว็บก่อน** (`npm run build` ได้ `web/dist/` ซึ่งทั้ง server ที่วัดและ server ของ e2e ส่งให้ browser; `npx playwright test` ไม่ build ให้เอง
ต่างจาก `npm run e2e`) และ **port 8766 ต้องว่าง** เพราะ `webServer` ใน `playwright.config.ts` เปิด server ของ fixture e2e ที่ port 8766 ทุกครั้งที่รัน `playwright test`
รวมถึงตอนวัด (server นั้นใช้ข้อมูลของ fixture ไม่เกี่ยวกับ scenario ที่วัด และ Playwright ปิดให้เมื่อจบ) ถ้ามีอะไรฟังที่ 8766 อยู่ Playwright จะไม่เริ่ม

```bash
# terminal 1 (ทิ้งไว้ตลอดการวัด)
# 1) build หน้าเว็บ
cd $REPO/api-interop/gnss-predict/web && npm run build
# 2) โฟลเดอร์ data ชั่วคราว: เขียน settings.json ที่ปิดงานประจำวัน "ก่อน" เปิด server
P=/tmp/gnss-perf; mkdir -p $P/scenarios $P/orbits
printf '%s' '{"daily":{"enabled":false,"run_at_utc":"21:00","facility":"THBK","retention_days":30,"validation_retry_hours":3,"validation_give_up_days":14},"cesium_ion_token":"","online_imagery":{"enabled":false}}' > $P/settings.json
# 3) คัดลอกเท่านั้น (ไม่เปิด ไม่รันไฟล์ในนั้น): scenario รายวันที่มีผลแล้วกับ snapshot ที่มันใช้ (ชื่อใน orbit_snapshot ของ scenario.json)
cd $REPO/api-interop/gnss-predict
cp -R data/scenarios/acc_20261111 $P/scenarios/ && cp -R data/orbits/20261110T2147Z $P/orbits/
# 4) เปิด server ที่ 127.0.0.1 port 8767 (ตั้ง GNSS_STUDIO_HOST เองกันค่าที่ export ค้างไว้ใน shell; ไม่มี GMAT ก็ได้เพราะผลมีอยู่แล้ว)
cd $REPO/api-interop/gnss-predict/server
GNSS_STUDIO_DATA=$P GNSS_STUDIO_HOST=127.0.0.1 GNSS_STUDIO_PORT=8767 GMAT_BIN=/nonexistent .venv/bin/python -m gnss_studio_server
```

```bash
# terminal 2: วัด พิมพ์ "PERF load: ..." และ "PERF frames in 5 s: ..." (browser เปิดขึ้นบนหน้าจอเพราะ --headed)
cd $REPO/api-interop/gnss-predict/web
GNSS_E2E_PERF_URL="http://127.0.0.1:8767/?sc=acc_20261111&test" npx playwright test perf.spec.ts --headed
```

เสร็จแล้วกด Ctrl-C ที่ terminal 1 เพื่อปิด server ที่ 8767

(ถ้า scenario ที่ใช้ไม่ตรง `GET /api/scenarios/<ชื่อ>/results` ต้องตอบ `ephem.status` เป็น `current` ไม่งั้นหน้าต่าง 3D แสดงแถบ "ผลลัพธ์ไม่ตรงกับ scenario ปัจจุบัน" และไม่โหลดภาพ)

**ผลที่วัด** (2026-11-12, Apple M5 Pro 16 core, macOS 26.4.1, Chromium 158 ของ Playwright 1.65.0, หน้าต่าง 1440×900,
scenario `acc_20261111`: วัตถุ 132 ชิ้น, `scene.czml` 2.1 MB, server ในเครื่อง):

| วัดแบบ | โหลดภาพ (`sceneLoadedAt`, เกณฑ์ ≤ 3000 ms) | เฟรมใน 5 วินาที (เกณฑ์ ≥ 150) |
|---|---|---|
| `--headed` รันแรก (cache เย็น) | 2944 ms | 384 (76.8 ภาพ/วินาที) |
| `--headed` รันซ้ำ 3 ครั้ง | 1496, 1329, 1212 ms | 387, 366, 401 (73–80 ภาพ/วินาที) |
| headless บน GPU (ไม่ใช้ SwiftShader) 2 ครั้ง | 748, 620 ms | 302, 305 (ราว 60 ภาพ/วินาที ตาม vsync) |

ทั้งสองเกณฑ์ผ่านบนเครื่องนี้ แต่รันแรกที่ cache เย็นใกล้เส้น 3 วินาที (2944 ms) เครื่องที่ช้ากว่านี้หรือไม่มี GPU อาจไม่ผ่าน
ตัวเลขเฟรมนับเฉพาะ viewer 3D ตัวแรก (หน้าต่าง 2D วาดพร้อมกันแต่ไม่ถูกนับ)

### 9.7 browser ที่รองรับ

ต้องมี WebGL (Cesium วาด 3D และ 2D ด้วย WebGL) ทดสอบเฉพาะ Chromium รุ่นล่าสุด (Chrome, Edge ที่ใช้แกน Chromium) ส่วน Firefox และ Safari ยังไม่ได้ทดสอบ
browser ที่ไม่มี WebGL (หรือปิดการเร่งด้วยฮาร์ดแวร์) แสดงข้อความไทยแทนภาพ 3D และ 2D ส่วน Object Browser, Properties และเมนูยังใช้ได้
โปรแกรมทำงานกับ server ในเครื่องเท่านั้น ไม่โหลดฟอนต์หรือ script จากเน็ต (ภาพออนไลน์เป็นข้อยกเว้นเดียว ปิดไว้ก่อนและต้องผ่านกล่องยืนยัน: NASA GIBS กับ Sentinel-2 cloudless server เป็นผู้ต่อให้ ส่วน OpenStreetMap กับ Cesium ion browser ต่อเอง ดูหัวข้อ 9.10) เมนู ปุ่ม และหน้าตั้งค่าเป็นภาษาอังกฤษตามชื่อใน STK ส่วนข้อความอธิบายและข้อผิดพลาดเป็นภาษาไทย
คีย์ลัดที่ใช้ได้คือ Ctrl+S, Delete, Ctrl+F เท่านั้น (Ctrl+N, Ctrl+O, Ctrl+Q เป็นของ browser)

### 9.8 ข้อจำกัดของ v1

- **Visible Sides** ของ 2D Graphics - Pass เก็บและแก้ได้ แต่ v1 วาดเส้นทางแบบ `Both` เสมอ (หน้าแสดงหมายเหตุไทย)
- หน้าต่าง 2D แสดงแผนที่ในกรอบ **ECF** เท่านั้น (Display Coordinate Frame เลือก ECI ไม่ได้)
- เมนู **Analysis** (Access..., Report & Graph Manager..., Validation...) และปุ่มบนแถบเครื่องมือที่เกี่ยวข้องปิดใช้ รอ **งานย่อยที่ 4**
  (Access tool, Report & Graph Manager และหน้า Validation) แถว Timeline แสดงช่วงเวลาของ access ที่ scenario เปิด Timeline ไว้ (แม่แบบ thbk-gnss มีให้แล้ว)
- ภาพแสงไฟเมืองตอนกลางคืน (Night Lights Level) ต้องใช้ภาพจาก Cesium ion จึงไม่มีในรุ่นออฟไลน์นี้ (เก็บค่าไว้แต่ไม่มีผลต่อภาพ)
- Cut, Copy และ Paste ใน Object Browser ใช้ได้เฉพาะดาว ไม่รองรับการเปลี่ยนชื่อหรือลบกลุ่ม ไม่ใช่โปรแกรมหลายผู้ใช้ ไม่มีธีมมืด และไม่รองรับมือถือ

### 9.9 Sensor และ Sensor View

**Sensor** เป็น object ของ scenario ที่ติดกับ Satellite (ดาวละกี่ตัวก็ได้) บันทึกใน `scenario.json` ทำงานออฟไลน์ ไม่กระทบผลการคำนวณ
(hash ของ ephem เท่าเดิมหลังเพิ่ม แก้ หรือลบ sensor) ลบดาวแล้ว sensor ของดาวนั้นถูกลบตาม (กล่องยืนยันการลบบอกจำนวน sensor ที่จะถูกลบไปด้วย) เปลี่ยนชื่อดาวแล้ว sensor ตามไปอยู่กับชื่อใหม่
Object Browser วาด sensor ซ้อนใต้ดาวของมัน (ขยายหรือยุบด้วยลูกศรหน้าแถว หรือปุ่ม → และ ←) กรวยและรอยบนพื้นโลกเดินตามเวลา Animation

- **Insert**: เมนู Insert → Sensor... หรือ Insert → New... → Sensor แล้วเลือก
  - ทั้งสองวิธีขึ้นหน้าต่าง Select Object ก่อนเพื่อเลือกดาวแม่ (ดาวที่เลือกอยู่ใน Object Browser ถูกเลือกไว้ก่อน ถ้าเลือก sensor อยู่ก็ใช้ดาวแม่ของมัน)
    กด Cancel = ไม่ทำอะไร; ไม่มีดาวใน scenario เลยจะขึ้นข้อความภาษาไทยและปุ่มปิดใช้
  - *Define Properties*: หลังเลือกดาวแม่แล้วขึ้นกล่องที่มีช่อง Name (ตั้งต้น `Sensor<n>` ตัวแรกที่ว่าง), Parent (ดาวแม่ที่เลือกมา แก้ไม่ได้) และ **Cone Half Angle** (ตั้งต้น 45°)
    ช่องอื่น (Azimuth, Elevation, สี ฯลฯ) ใช้ค่าตั้งต้น แก้ทีหลังที่ Properties
  - *Insert Default*: สร้างทันทีบนดาวแม่ที่เลือก ตั้งชื่อ `Sensor<n>` ตัวแรกที่ว่าง ค่าอื่นเป็นค่าตั้งต้น
- **Properties** (คลิกขวาที่ sensor → Properties) หน้าต่าง ๆ ตามชื่อใน STK:
  Basic - Definition (Sensor Type = Simple Conic อ่านอย่างเดียว, **Cone Half Angle** ช่วง (0, 90] ค่าตั้งต้น 45°),
  Basic - Pointing (Pointing Type = Fixed และ Orientation Method = Az-El อ่านอย่างเดียว, Azimuth [0, 360), Elevation [−90, 90] ค่าตั้งต้น 0° / 90° = ชี้ลงศูนย์กลางโลก, About Boresight = Rotate อ่านอย่างเดียว),
  Basic - Description (มีดาวแม่แบบอ่านอย่างเดียว), 2D Graphics - Attributes (Show, Color, Fill, % Translucency) และ 3D Graphics - Attributes (Show, Color, Show Radial Lines, Show Boresight Marker)
  ค่านอกช่วงถูก server ปฏิเสธ (422) และหน้าแสดงกรอบแดงที่ช่องนั้น
- **หน้าต่าง 3D และ 2D**: 3D วาดกรวย (Show Radial Lines = เส้นขอบ 8 เส้น) รอยของกรวยบนพื้นโลก และจุด boresight ถ้าเปิด Show Boresight Marker
  2D วาดรอยบนพื้นโลก (Fill เติมพื้นที่ตาม % Translucency เฉพาะเมื่อ boresight ชี้ลงศูนย์กลางโลก; boresight เอียงวาดเฉพาะเส้นขอบ)
  คำนวณใหม่ตามเวลา Animation: หน้าต่าง 3D ไม่เกิน 4 ครั้งต่อวินาที (ทุก 250 ms) หน้าต่าง 2D ไม่เกิน 10 ครั้งต่อวินาที (ทุก 100 ms ตามรอบวาด Swath)
  ซ่อนเมื่อ Show ปิด ดาวแม่ถูกซ่อน หรือดาวแม่ยังไม่มีตำแหน่ง ณ เวลานั้น
- **คลิกที่ดาวในหน้าต่าง 3D**: คลิกซ้ายที่ดาวหรือ Facility = เลือก object นั้น (เหมือนเลือกใน Object Browser; ลากเพื่อหมุนโลกยังทำงานเหมือนเดิม)
  คลิกขวาที่ดาว = เมนู Properties, Sensor View, Zoom To (Facility: Properties, Zoom To)

**Sensor View** คือหน้าต่างที่กล้องอยู่ที่ดาวแม่และมองตามทิศ boresight ของ sensor ด้วยมุมกว้างของกรวย เห็นโลกจากดาวและเดินตามเวลา Animation
เปิดได้จาก: เลือกดาวใน Object Browser → เมนู Satellite (เมนูบนที่ชื่อตาม object ที่เลือก) → Sensor View, เมนู Sensor → Sensor View ของ sensor, คลิกขวาที่ดาวหรือ sensor ใน Object Browser, หรือคลิกขวาที่ดาวในหน้าต่าง 3D

- **ดาวที่ยังไม่มี sensor**: Sensor View สร้าง `Sensor<n>` (ตัวแรกที่ว่าง) ให้เอง ด้วย **Cone Half Angle ตั้งต้น = ρ + 0.5°** ปัดทศนิยม 1 ตำแหน่ง
  เมื่อ ρ = asin(Re / (Re + h)) คือมุมครึ่งหนึ่งของจานโลกที่ดาวเห็น (Re = 6371.0088 km, h = ความสูงของดาว ณ เวลาปัจจุบัน; GPS ราว 13.9°
  จึงได้ค่าตั้งต้นราว 14.4°) ทำให้เห็นโลกทั้งดวงพอดี ตำแหน่งของดาวอ่านจากหน้าต่างที่เปิดอยู่ (หน้าต่าง 3D ตัวแรก แล้ว Sensor View ตามลำดับที่เปิด)
  ดาวที่ไม่มีตำแหน่งในหน้าต่างใดเลยใช้ **45°**: ไม่มีผลวงโคจร (หรือเวลาอยู่นอกช่วง) หรือไม่มีทั้งหน้าต่าง 3D และ Sensor View ที่เปิดอยู่ให้ตำแหน่งของดาวนั้น
  สร้างแล้วเลือก sensor ใหม่ แจ้งใน Message Viewer และเปิดหน้าต่าง ดาวที่มี sensor แล้วเปิดของตัวแรก
- ชื่อหน้าต่าง `Sensor View - <sensor> (<ดาว>)` หนึ่งบานต่อ sensor อยู่ใน workbook (File → Save) ปิดพร้อม scenario และตามชื่อเมื่อ Rename
  ลบ sensor หรือลบดาวแล้วหน้าต่างปิดเอง
- ด้านบนของภาพเลือกที่แถบ **Up** ได้: **North** (ตั้งต้น) หรือ **Velocity** (+X ของกรอบตัวดาว) กล้องล็อกอยู่ที่ดาว (ลาก หมุน และดับเบิลคลิกไม่ขยับกล้อง)
- **Display: Camera | Sensor** (แถบเครื่องมือ ป้ายของเรา ไม่ใช่ชื่อใน STK) เลือกว่าในภาพมีอะไรบ้าง มีผลเฉพาะหน้าต่างนี้ หน้าต่าง 3D หลักและ Sensor View บานอื่นไม่เปลี่ยน
  - **Camera** (ตั้งต้น รวมถึง workbook เก่าที่ไม่มีช่องนี้): ภาพแบบกล้องของดาวที่ส่องลงมาเห็นพื้นโลก ซ่อนทุกอย่างที่ไม่ใช่ลูกโลก
    (เส้นวงโคจร จุดและชื่อดาว กรวยและรอยของ sensor ทุกตัว Facility เส้น access เส้นวงโคจรแบบ Inertial) และไม่วาดวงขอบกรวย
    ชั้นบรรยากาศ ดาวพื้นหลัง และแสงกลางวัน/กลางคืนยังอยู่ ทำงานออฟไลน์
  - **Sensor**: แบบเดิมก่อนมีโหมด Camera บนภาพมีวงขอบกรวย (วงนี้เป็นของภาพซ้อน ตรงกับขอบกรวยพอดี จึงไม่วาดวงรอย Radial Lines และ Boresight Marker ของ sensor ตัวนี้ในภาพของมันเอง
    และซ่อนจุดกับป้ายของดาวแม่ที่อยู่ตรงกล้อง sensor ตัวอื่นของดาวเดียวกันยังวาดครบ)
  - สลับ Camera แล้วกลับเป็น Sensor ได้ทุกอย่างตามที่เคยแสดงอยู่เดิม รวมถึง object ที่ผู้ใช้ซ่อนไว้ก็ยังซ่อนอยู่
- **Zoom**: ปุ่ม **Zoom In / Zoom Out** พร้อมค่า "×n" ใช้ได้ทั้งสองโหมด n เป็นจำนวนต่อเนื่องใน **[1, 262144]** (ตั้งต้น ×1)
  ปุ่มและล้อเมาส์ก้าว**ทีละ ×√2** บนตาราง 2^(k/2), k = 0..36 (37 จุด: ×1, ×1.4, ×2, ×2.8, …, ×8192 ที่ k = 26, …, ×262144) ค่าที่ไม่อยู่บนตาราง (จากช่อง Width)
  ไปจุดบนตารางที่ใกล้ที่สุดก่อนแล้วจึงก้าว ป้าย "×n": จำนวนเต็มต่ำกว่า 10000 แสดงตรงตัว (×8, ×1024, ×8192) ไม่ใช่จำนวนเต็มต่ำกว่า 10 ทศนิยมหนึ่งตำแหน่ง (×1.4, ×5.7)
  นอกนั้นปัดเป็นจำนวนเต็ม (×11, ×1448) ตั้งแต่ 10000 เป็นพันตัดเศษ (×11k, ×65k, ×262k)
  มุมกว้างของด้านสั้นของภาพ = min(2α × 1.05, 120°) / n เมื่อ α = Cone Half Angle (ดาว GPS: ×128 ราว 0.236° ≈ 83 km, ×1024 ราว 0.030° ≈ 10 km, ×8192 ราว 0.0037° ≈ 1.3 km
  และ **×262144 แคบสุดราว 0.00012° ≈ 40 m** บนพื้น) วงขอบกรวยของโหมด Sensor ใช้ค่าเดียวกัน
  ซูมเปลี่ยนแต่มุมกว้าง ตำแหน่งและทิศของกล้องไม่เปลี่ยน (ยังอยู่ที่ดาวและมองตาม boresight ทิศกล้องที่ ×8192 คลาดจากที่ ×1 ไม่เกิน 0.01°) ล้อเมาส์ (ไม่กด Shift) บนภาพ = Zoom In/Out ทีละ ×√2 (เลื่อนขึ้น = เข้า)
  trackpad และ pinch นับตามระยะที่เลื่อนรวมกัน (100 px ต่อขั้น ไม่เกินหนึ่งขั้นต่อ 150 ms) และ**ไม่เกิน 2 ขั้นต่อการปัดหนึ่งครั้ง** (= ×2 ต่อการปัด; เหตุการณ์ล้อที่ห่างกันไม่เกิน 200 ms
  รวมทั้ง momentum ที่ macOS ส่งต่อหลังปล่อยนิ้วนับเป็นการปัดเดียวกัน) ปัดนิ้วครั้งเดียวจึงไม่กระโดดไปสุดทาง ล้อเมาส์ที่หมุนทีละรอยห่างกันเกิน 200 ms ได้รอยละขั้นตามเดิม
  ส่วน Shift + ล้อ ยังเป็น Step Forward / Backward เหมือนเดิม โหมด Display และ zoom เก็บกับหน้าต่างใน workbook
  (workbook เดิมที่เก็บ ×1–×8192 ยังเปิดได้ตามเดิม ค่าที่ไม่รู้จัก ค่าเสีย หรือ zoom ที่ไม่ใช่ตัวเลขใน [1, 262144] = Camera ×1)
  ซูมหรือเปลี่ยน Up ขยับแค่กล้อง (ตำแหน่ง ทิศ มุมกว้าง) ไม่วาด object ในภาพใหม่ทั้งหมด จึงตอบทันทีแม้ในโหมด Sensor ส่วนการสลับ Display ยังวาดใหม่ตามเดิม
- **ช่อง Width** (ป้ายของเรา ข้าง "×n"): แสดงความกว้างพื้นที่ที่จุดใต้ดาวตอนนี้ (รูปแบบเดียวกับ HUD เช่น `1.30 km`)
  พิมพ์ `500 m`, `1.5 km` หรือ `500` (ไม่มีหน่วย = m) แล้ว Enter = ตั้ง zoom ให้ภาพกว้างเท่านั้นที่จุดใต้ดาว ณ ความสูงตอนนี้
  (ค้นแบบแบ่งครึ่งบน zoom ด้วยสูตรความกว้างเดียวกับ HUD คลาดไม่ถึง 1%) แคบกว่าที่ ×262144 เห็น = ×262144 ; กว้างกว่าภาพที่ ×1 = ×1
  พร้อมคำแนะนำภาษาไทยที่บอกความกว้างแคบสุดและกว้างสุดที่ตั้งได้ ณ ความสูงตอนนี้ คำแนะนำของช่องนี้หายเมื่อซูมเปลี่ยนด้วยปุ่มหรือล้อ
  พิมพ์ผิด = ช่องกลับเป็นค่าเดิมพร้อมคำแนะนำภาษาไทยข้างช่อง ดาวยังไม่มีตำแหน่ง = ตั้งไม่ได้พร้อมข้อความไทย Escape หรือออกจากช่อง = ทิ้งที่พิมพ์
- **ข้อความบนภาพ (HUD)**: ชื่อ sensor และดาว เวลา จุดใต้ดาว ความสูง Cone Half Angle (เดิม) กับบรรทัดที่เพิ่ม
  - มุมกว้างพร้อม zoom เช่น `มุมกว้าง FOV 3.6° ×8` (ตั้งแต่ 1° ทศนิยมหนึ่งตำแหน่ง ต่ำกว่า 1° เป็นเลขนัยสำคัญ 2 ตัว เช่น `FOV 0.0037° ×8192`, `FOV 0.00012° ×262k`)
  - ความกว้างพื้นที่ที่จุดใต้ดาวโดยประมาณตามด้านสั้นของภาพ เช่น `ความกว้างพื้นที่ที่จุดใต้ดาวโดยประมาณ 1.30 km` (หน่วย km เมื่อตั้งแต่ 1 km ขึ้นไป ไม่งั้นเป็น m)
    คิดเป็นความยาวส่วนโค้งบนผิวโลกทรงกลมจากความสูงของดาวและมุมกว้าง (ภาพกว้างกว่าจานโลก = กว้างถึงขอบฟ้า) ไม่มีบรรทัดนี้เมื่อภาพไม่เห็นพื้นที่
  - แหล่งภาพพื้นโลก: `ภาพพื้นโลก: VIIRS NOAA-20 True Color 2026-11-11` (ชั้นภาพออนไลน์บนสุดที่แสดงอยู่ พร้อมเวลาของภาพ) หรือ `ภาพพื้นโลก: Natural Earth II (ออฟไลน์)`
    ถ้าชั้นบนสุดไม่มีภาพเกินครึ่งของชิ้นที่ได้ผลแล้ว (โหลดสำเร็จ ไม่มีภาพ หรือผิดพลาด ไม่นับชิ้นที่ยังโหลดอยู่) ต่อท้ายว่า `— ไม่มีภาพเวลานี้`
    (GIBS/EOX: นับชิ้นที่ server ตอบ 404) ส่วน OpenStreetMap และ Cesium ion นับทุกชิ้นที่โหลดไม่ได้ ไม่ว่ามีรหัส HTTP หรือไม่ และต่อท้ายว่า `— ชิ้นภาพส่วนใหญ่โหลดไม่ได้`
    ระหว่างที่ภาพของเวลาใหม่ยังไม่ได้ชิ้นแรก HUD บอกชั้นและเวลาของภาพเดิมที่ยังอยู่บนจอ
  - `ภาพละเอียดสุดของแหล่งนี้แล้ว (ระดับ n) ภาพจะขยายจนเบลอ`: ขึ้นเมื่อชั้นบนสุดที่แสดงอยู่เป็น GIBS, EOX หรือ OpenStreetMap ที่ระดับซูมสูงสุดของชั้น (ตารางในหัวข้อ 9.10)
    ต่ำกว่าระดับที่ภาพกว้างขนาดนั้นต้องการลบหนึ่ง (ชิ้น 256 px แบบ Web Mercator คิดที่เส้นศูนย์สูตร จึงเตือนเร็วไว้ก่อนเล็กน้อย; ลบหนึ่งเพราะ Cesium เองเลือกระดับภาพที่ราว 2 พิกเซลต่อจุดภาพ
    จึงใช้ระดับที่ต่ำกว่าที่คิดแบบ 1 พิกเซลอยู่แล้วหนึ่งระดับ) ชั้น Cesium ion ไม่เตือน เพราะระดับสูงสุดของ asset ไม่รู้ล่วงหน้า
  - ไม่มีชั้นภาพออนไลน์แสดงอยู่จริง (สวิตช์ปิดทุกแหล่ง หรือเปิดแต่ไม่มีชั้นที่แสดง เช่น เปิด ion แต่ยังไม่เลือก asset หรือ ion ล้มเหลว) โหมด Camera และซูม ×8 ขึ้นไป:
    เพิ่มบรรทัดแนะนำ `เปิดภาพจริงได้ที่ View → Globe Manager` (หัวข้อ 9.10)
- **ความเร็วในการโหลดภาพ** (ทั้งหน้าต่าง 3D และ Sensor View):
  - **ชั้นที่ถูกบังไม่โหลด**: วาดเฉพาะชั้นทึบบนสุดที่แสดงอยู่กับชั้นที่อยู่เหนือมัน ชั้นข้างใต้ไม่ถูกสร้าง จึงไม่มีคำขอชิ้นภาพของมันเลย
    ชั้นทึบ = % Translucency 0 และเป็นภาพทึบที่มีทุกชิ้นทุกเวลา: ภาพคงที่แบบ jpg (Blue Marble, Sentinel-2 cloudless) หรือ OpenStreetMap (png แต่ทึบ)
    ชั้นที่ผูกเวลาไม่นับว่าทึบแม้เป็น jpg: VIIRS/MODIS รายวันไม่มีภาพของเวลาในอนาคต (ชิ้น 404 โปร่งใส Blue Marble ข้างใต้ต้องยังเห็น)
    และ Himawari (png) กับ GOES เห็นแค่จานโลกของดาวค้างฟ้า
    เช่น ค่าตั้งต้น Blue Marble + VIIRS + Sentinel-2 + OpenStreetMap ที่ 0% ทั้งหมด = โหลดแค่ OpenStreetMap ; ตั้ง OpenStreetMap 30% = โหลด Sentinel-2 ด้วย
    ; ปิดสวิตช์ OpenStreetMap และ Sentinel-2 = โหลด Blue Marble กับ VIIRS ตามเดิม
    ปิดสวิตช์หรือ Show ของชั้นบน หรือเพิ่ม % Translucency แล้วชั้นข้างใต้กลับมาเอง Natural Earth II (ออฟไลน์) ยังเป็นภาพฐานเสมอ
    ชั้นทึบที่ชิ้นภาพพลาดเกินเกณฑ์ (ได้ผลอย่างน้อย 8 ชิ้น พลาดอย่างน้อย 75% เกณฑ์เดียวกับ HUD และ ion) เลิกนับเป็นชั้นทึบใน viewer นั้น: ชั้นข้างใต้ถูกสร้างให้เห็น
    (OpenStreetMap ถูกบล็อกหรือเน็ตหลุด, Sentinel-2 หยุดหรือไม่ว่าง) ล้มซ้อนกันได้ทีละชั้น จนเอาชั้นนั้นออกแล้วใส่กลับ (ปิดแล้วเปิดสวิตช์หรือ Show) จึงนับเป็นชั้นทึบได้อีก
  - Cesium เก็บชิ้นภาพของลูกโลกไว้ **1000 ชิ้น** (globe.tileCacheSize; ค่าตั้งต้นของ Cesium 100) ซูมเข้าออกหรือกลับมาที่เดิมจึงไม่ต้องโหลดชิ้นเดิมใหม่
- ดาวแม่ยังไม่มีตำแหน่ง (ไม่มีผลวงโคจร หรืออยู่นอกช่วงเวลา) = ภาพว่างพร้อมข้อความภาษาไทย ไม่ใช่ error
- เปิดพร้อมกันได้ **ไม่เกิน 4 บาน** (viewer ละหนึ่ง WebGL context) บานที่ 5 ไม่เปิดและขึ้นข้อความไทยใน Message Viewer
- **Sensor View เป็นของเรา ไม่ใช่คำสั่งของ STK**: STK ไม่มีคำสั่งดูภาพผ่าน sensor โดยตรง (ใกล้ที่สุดคือ Obscuration View และ EOIR Sensor Scene ที่ต้องมี license) จึงติดป้าย "เพิ่มเอง" ใน `labels.ts`

ท่าทางของดาวใช้แบบ Nadir alignment with ECI velocity constraint ของ STK ทุกดวง (+Z ชี้ศูนย์กลางโลก, +X = ส่วนของความเร็วเฉื่อยที่ตั้งฉากกับ Z) ไม่ใช่ท่าทางจริงของดาว GNSS

**ข้อจำกัดของ v1** (sensor spec §2):

- Sensor ติดได้กับ Satellite เท่านั้น (ไม่ติดกับ Facility)
- Sensor Type มีแต่ **Simple Conic** และ Pointing มีแต่ **Fixed** แบบ **Az-El** ในกรอบตัวดาว (ไม่มี Complex Conic, Rectangular, Targeted, Spinning ฯลฯ และไม่มีช่อง Location, Sensor AzEl Mask, Projection, Pulse)
- ไม่มี Access และ constraint ของ sensor (งานย่อยที่ 4 ต่อยอดได้)
- ไม่มีท่าทางจริงของดาว GNSS (yaw steering) ซึ่งจะมากับโมเดล 3 มิติ
- Copy / Paste ของ sensor ปิดใช้พร้อมคำอธิบาย คัดลอกดาวแล้ว sensor ไม่ถูกคัดลอกตาม
- Insert From Satellite Catalog ใช้กับ Sensor ไม่ได้

### 9.10 ภาพถ่ายจริงและแผนที่ (NASA GIBS, Sentinel-2 cloudless, OpenStreetMap, Cesium ion)

ภาพพื้นโลกที่มากับโปรแกรม (Natural Earth II ราว 0.176°/พิกเซล ≈ 20 km) หยาบเกินกว่าจะซูมดูพื้นดิน งานเสริมนี้ให้วางภาพถ่ายจริงและแผนที่จาก **สี่แหล่ง** บนลูกโลกของ **หน้าต่าง 3D และ Sensor View**
(Sensor View โหมด Camera ซูมได้ถึง ×262144 จึงเห็นเมืองและถนนใต้ดาวได้ ภาพนี้เป็นภาพจำลองแบบแผนที่ ไม่ใช่สิ่งที่ดาว GNSS ถ่ายได้จริง) ส่วนหน้าต่าง 2D ใช้ภาพเดิม
**ทุกแหล่งปิดอยู่เสมอจนกว่าจะเปิดเอง** แต่ละแหล่งมีสวิตช์และกล่องยืนยันภาษาไทยของตัวเอง ภาพ GIBS เปลี่ยนตามเวลา Animation (EOX, OpenStreetMap และ Cesium ion ไม่ผูกกับเวลา)
สองแหล่งแรกผ่าน server ในเครื่อง (การดึง การเก็บ cache และขีดจำกัดอยู่ในหัวข้อ [8.8](#88-ภาพถ่ายออนไลน์-nasa-gibs-และ-sentinel-2-cloudless)) สองแหล่งหลัง **browser ดึงเองโดยตรง**
จึงเป็นข้อยกเว้นของหลัก "browser คุยกับ server ในเครื่องเท่านั้น" และเป็นข้อยกเว้นเฉพาะเมื่อผู้ใช้เปิดสวิตช์ของแหล่งนั้น (กล่องยืนยันบอกเรื่องนี้ก่อนเปิด) หัวข้อนี้เล่าเฉพาะฝั่งผู้ใช้

**สี่แหล่ง**

| แหล่ง (ป้ายสวิตช์ใน Globe Manager, ช่องใน `online_imagery`) | โฮสต์ | ทาง | สิ่งที่ส่งออก | cache | เครดิตบนจอ | เงื่อนไขการใช้ |
|---|---|---|---|---|---|---|
| **NASA GIBS** (`Online imagery (NASA GIBS)`, `enabled`) | `gibs.earthdata.nasa.gov` | server ในเครื่องดึงให้ (proxy) browser ไม่ติดต่อตรง | ชื่อชั้น เวลา พิกัดชิ้นภาพ กับ IP ของเครื่องและ User-Agent `gnss-studio/0.1` | `data/imagery/tiles/` ในเครื่อง (รวมทุกแหล่งไม่เกิน 2 GB) | NASA GIBS / EOSDIS (เพิ่ม JMA หรือ NOAA ตามชั้น) | ข้อมูล NASA EOSDIS ควรคงเครดิตไว้ เงื่อนไขอื่นเป็นของ NASA |
| **Sentinel-2 cloudless** (`Online imagery (Sentinel-2 cloudless)`, `eox`) | `tiles.maps.eox.at` | server ในเครื่องดึงให้ (proxy) ดึงพร้อมกันไม่เกิน 4 ชิ้น | ชื่อชั้น พิกัดชิ้นภาพ กับ IP ของเครื่องและ User-Agent `gnss-studio/0.1` | เหมือน GIBS (ภาพคงที่ เก็บถาวรใต้เพดานเดียวกัน) | Sentinel-2 cloudless - https://s2maps.eu by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2024) | **ใช้ได้เฉพาะงานไม่เชิงพาณิชย์** และต้องแสดงเครดิตตามเงื่อนไขของ EOX |
| **OpenStreetMap** (`Online imagery (OpenStreetMap)`, `osm`) | `tile.openstreetmap.org` | browser ดึงตรง ไม่ผ่าน server | พิกัดชิ้นภาพ กับ IP ของเครื่อง User-Agent ของ browser และ Referer `http://127.0.0.1:<port>/` | ไม่มีที่เก็บของโปรแกรม (มีแต่แคช HTTP ของ browser เอง) | © OpenStreetMap contributors | Tile Usage Policy ของ OpenStreetMap (ข้อผูกพันด้านล่าง) |
| **Cesium ion** (`Online imagery (Cesium ion)`, `ion`) | `api.cesium.com` แล้วโฮสต์ภาพที่ ion ส่งต่อไป (Bing Maps หรือ Google Maps ตาม asset) | browser ดึงตรง ไม่ผ่าน server | **token ของผู้ใช้** รหัส asset พิกัดชิ้นภาพ กับ IP ของเครื่อง User-Agent ของ browser และ Referer `http://127.0.0.1:<port>/` (ผู้ให้บริการภาพเห็นสามอย่างหลังด้วย) | ไม่มีที่เก็บของโปรแกรม | เครดิตของ ion และผู้ให้ภาพ ที่ Cesium แสดงเองที่มุมล่างของภาพ | บัญชี Community (ฟรี) ใช้ได้เฉพาะงานไม่เชิงพาณิชย์ตามเงื่อนไขของ Cesium; **ห้ามซ้อนกับภาพแหล่งอื่น** (หัวข้อ ion ด้านล่าง) |

**เปิดใช้ (ปิดอยู่เสมอจนกว่าจะเปิดเอง)**

1. เมนู **View → Globe Manager** (หน้าต่างลอย ไม่ผูกกับ scenario) มี 4 กลุ่มตามตารางข้างบน กลุ่มละหนึ่งสวิตช์
2. ติ๊กสวิตช์ของแหล่งที่ต้องการ แล้วกล่องยืนยันภาษาไทยของแหล่งนั้นขึ้นบอกว่าจะเชื่อมต่อโฮสต์ไหน **ใครเป็นผู้เชื่อมต่อ** (server ในเครื่อง หรือ browser ของคุณโดยตรง) สิ่งที่ส่งออก
   (IP, User-Agent, Referer หรือ token แล้วแต่แหล่ง) ที่เก็บภาพ (เฉพาะสองแหล่งที่ผ่าน server: `data/imagery`, เพดาน 2 GB) และเงื่อนไขการใช้ของแหล่งนั้น
3. กด **OK** เพื่อเปิด (**Cancel** หรือ Esc = ไม่เปลี่ยนอะไร ค่าตั้งใน `settings.json` ไม่ถูกแตะ) ปิดเมื่อไรก็ได้โดยเอาติ๊กออก: ปิดทันทีไม่ต้องยืนยัน และหน้าต่าง 3D กับ Sensor View เอาชั้นภาพของแหล่งนั้นออก
   การเปิดแหล่งหนึ่งไม่เปิดแหล่งอื่น และสวิตช์ปิดเท่ากับไม่มี request ไปโฮสต์นั้นเลย ทั้งจาก server และจาก browser

- สวิตช์เก็บใน `settings.json` ของ server (`online_imagery.enabled`, `eox`, `osm`, `ion`) ไม่ใช่ใน workbook: มีผลทุก scenario และทุกหน้าเว็บของ server นั้น
  `settings.json` เก่าที่ไม่มีช่องใหม่ (มีแต่ `enabled`) โหลดแล้วช่องที่หายเป็นปิด ส่วน `PUT /api/settings` ต้องส่งครบทุกช่อง (ขาดช่องใด = 422)
  หน้าต่าง Daily Forecast Settings ตอน Apply อ่าน `GET /api/settings` ใหม่ก่อน แล้วส่ง `online_imagery` ที่ server มีตอนนั้นคืนไปทั้งก้อน จึงไม่เปิดหรือปิดสวิตช์ให้โดยไม่ตั้งใจ
  (สวิตช์ที่ปิดจากแท็บอื่น, curl หรือแก้ไฟล์ระหว่างที่หน้าต่างเปิดอยู่ ไม่ถูกเขียนกลับเป็นเปิด)
- **GIBS และ EOX (ผ่าน server)**: ส่วนที่เก็บภาพ ขีดจำกัด (ดึงพร้อมกัน GIBS 4 ชิ้น EOX 4 ชิ้น, timeout 20 วินาที, ชิ้นละไม่เกิน 2 MB, โฮสต์ตอบ 403/429 พักแหล่งนั้น 15 นาที, ผิดพลาดติดกัน 20 ครั้งพัก 5 นาที) และ cache เพดาน 2 GB ตามตารางในหัวข้อ 8.8
  ลบทั้งโฟลเดอร์ `data/imagery` ทิ้งได้เสมอ ระหว่างพัก ชิ้นที่อยู่ใน cache ยังแสดงได้ ชิ้นรายวันของวันนี้/เมื่อวานและชิ้น 10 นาทีของ 3 ชั่วโมงล่าสุดของ GIBS ไม่เก็บลงดิสก์ ดึงใหม่ให้ภาพสดขึ้นเอง
- หน้าเว็บให้ Cesium ขอชิ้นภาพจาก server ในเครื่องพร้อมกันไม่เกิน 4 คำขอ (`RequestScheduler.requestsByServer` ตั้งใน `web/src/cesium/viewer.ts`; ค่าตั้งต้นของ Cesium 18)
  browser ใช้ HTTP/1.1 ได้ 6 connection ต่อ server และหนึ่งถูก SSE ถือไว้ ชิ้นภาพที่รอโฮสต์ปลายทางนานจึงไม่กันคำขอ API ของหน้าเว็บ

**OpenStreetMap: ข้อผูกพันการใช้งาน** (Tile Usage Policy ของ OpenStreetMap Foundation; ที่มาของข้อบังคับเหล่านี้อยู่ใน spec ภาพละเอียด §1)

- แสดงเครดิต **© OpenStreetMap contributors** บนจอ (โปรแกรมแสดงให้ที่มุมล่างของภาพทั้งหน้าต่าง 3D และ Sensor View เป็นลิงก์ไปหน้า https://www.openstreetmap.org/copyright
  เปิดในแท็บใหม่) ห้ามซ่อน เครดิตของแหล่งอื่นเป็นข้อความธรรมดา
- ขอเฉพาะชิ้นที่กำลังแสดงอยู่: ใช้นโยบายเดิมของ Cesium (ขอเฉพาะชิ้นที่มองเห็น) **ไม่โหลดล่วงหน้า ไม่ดึงจำนวนมาก และไม่เก็บไว้ใช้ออฟไลน์** โปรแกรมไม่เขียนชิ้นภาพ OSM ลงดิสก์
  (ห้ามนำไปทำ prefetch หรือ cache ถาวรเอง)
- **ไม่ส่งหัว no-cache** (โปรแกรมไม่เพิ่ม header ใดให้คำขอ OSM และไม่ปิดแคชของ browser)
- **ไม่ตั้ง `Referrer-Policy` ที่ตัด Referer**: ทั้ง `index.html` และ header ของ server ไม่ตั้งค่านี้ browser จึงส่ง Referer ตามค่าปกติ (origin ของหน้านี้ `http://127.0.0.1:<port>/`) ซึ่ง OSM ใช้ระบุผู้ใช้งาน
- ไม่ผ่าน proxy ที่ cache เอง: OSM ไม่แนะนำ จึงให้ browser ดึงตรงจาก `tile.openstreetmap.org` (ใช้ระดับซูมสูงสุด 19)
- OpenStreetMap ให้บริการแบบไม่มีข้อตกลงระดับบริการ และบล็อกผู้ใช้ได้โดยไม่แจ้ง ถ้าถูกบล็อก ชิ้นภาพจะโหลดไม่ขึ้นและแสดงโปร่งใส (เห็นชั้นข้างล่างแทน)
  เมื่อชิ้นภาพของ OSM ได้ผลแล้วอย่างน้อย 8 ชิ้นและโหลดไม่ได้ตั้งแต่ 75% ขึ้นไป (นับทุกข้อผิดพลาด รวมกรณีที่ browser ไม่บอกรหัส HTTP เช่น Safari) Message Viewer ขึ้นข้อความไทย
  ครั้งเดียวต่อการเปิดหน้า (OSM อาจบล็อก หรืออินเทอร์เน็ตหลุด) และ HUD ของ Sensor View บอกว่าชิ้นภาพส่วนใหญ่โหลดไม่ได้ โปรแกรมไม่เปลี่ยนวิธีขอชิ้นภาพและไม่ปิดสวิตช์ให้

**Cesium ion: token, asset และการซ้อนภาพ**

- **ที่เก็บ token**: ช่อง `cesium_ion_token` ใน `settings.json` ของ server (เก็บเป็นข้อความธรรมดา ไม่เข้ารหัส; โฟลเดอร์ `data/` ถูก git ละเว้น **ห้ามนำไฟล์นี้หรือ token เข้า repo หรือ test**)
  ตั้งได้สองที่ที่ใช้ค่าเดียวกัน: กลุ่ม Cesium ion ใน **Globe Manager** (ช่อง "Cesium Ion Token" แบบซ่อนตัวอักษร แล้วกด Apply) หรือช่อง token ในหน้าต่าง **Daily Forecast Settings** (บันทึกด้วย `PUT /api/settings` ทั้งเอกสาร)
  ที่ใดที่หนึ่งเปลี่ยนแล้วอีกที่ตามค่าที่บันทึกล่าสุด **Globe Manager ไม่แสดงค่าที่บันทึกไว้** บอกแค่ว่ามีหรือยัง (ช่อง token ของ Daily Forecast Settings ใส่ค่าที่บันทึกไว้ในช่องแบบซ่อนตัวอักษร)
  ตัวแปรสภาพแวดล้อม `CESIUM_ION_TOKEN` (หัวข้อ 8.2) **ไม่ใช้กับชั้นภาพนี้**
- **token ไปที่ไหน**: browser ส่งให้ `api.cesium.com` ตอนขอข้อมูลของ asset โดย**ตัว Cesium เองใส่ token ใน query `?access_token=...` ของ URL ที่ขอไป `api.cesium.com`**
  token จึงมองเห็นได้ในแท็บ Network ของเครื่องมือนักพัฒนาใน browser และใน log ของ proxy ใดที่อยู่ระหว่างทาง (ถ้ามี) ห้ามแชร์ภาพหน้าจอหรือไฟล์ HAR ที่มีคำขอนี้
  โปรแกรมไม่ตั้ง `Ion.defaultAccessToken` ทั่วแอป (ตั้งเป็นค่าว่าง) แต่ส่ง token เข้า `IonImageryProvider.fromAssetId(id, { accessToken })` ของแต่ละชั้น
  โค้ดของโปรแกรมเองไม่ใส่ token ลงใน URL ใด ไม่เขียนลง log หรือ Message Viewer และไม่ส่งให้ server ของเรา ยกเว้นการบันทึกค่าตั้งด้วย `PUT /api/settings`
- **asset**: ตัวเลือกแบบ radio ของ asset ตั้งต้น 6 ตัว (Google Maps Satellite 3830182, Google Maps Satellite with Labels 3830183, Google Maps Roadmap 3830184,
  Bing Maps Aerial 2, Bing Maps Aerial with Labels 3, Bing Maps Roads 4) หรือเลือก "ไม่เลือก" หรือกรอก **Asset ID** (จำนวนเต็มบวก) เองได้ ค่านี้เก็บใน workbook ของ scenario (File → Save)
  เปิดสวิตช์ ion ครั้งแรกโปรแกรมเลือก Google Maps Satellite ให้ ID ตั้งต้นตรวจจากต้นฉบับ CesiumJS ไม่ใช่จากบัญชีของผู้ใช้ (หัวข้อสถานะการตรวจด้านล่าง) Bing บน ion มีประกาศว่าให้ใช้ถึง ก.ย. 2026 อาจถูกถอดแล้ว จึงวาง Google ไว้ก่อน
- **ion แสดงภาพ = ชั้นอื่นทั้งหมดถูกซ่อน** (ไม่มีทางซ้อน): ภาพ Bing และ Google ห้ามนำมาซ้อนกับภาพแหล่งอื่น จึงขณะที่ชั้น ion แสดงอยู่ (สวิตช์ ion เปิด + เลือก asset + มี token) ชั้นอื่นทั้งหมด (GIBS, EOX, OpenStreetMap
  และ Natural Earth II) ถูกซ่อนในทุก viewer (หน้าต่าง 3D และ Sensor View ทุกบาน) และไม่มี request ไปแหล่งอื่น จนกว่าจะปิด ion (ปิดสวิตช์ หรือเลือก "ไม่เลือก") แล้วโปรแกรมคืนชั้นเดิมและความโปร่งใสเดิมของ Natural Earth II
  Globe Manager แสดง "ถูกซ่อนเพราะเปิด Cesium ion อยู่" ที่แถวของชั้นอื่น
- **ion ไม่ทำงาน**: token ว่าง = ไม่แสดงชั้น ion พร้อมคำแนะนำภาษาไทย (ชั้นอื่นแสดงตามเดิม) ion ตอบ 401 (token ไม่ถูกต้องหรือหมดอายุ) หรือ 404 (บัญชีไม่มี asset นั้น) หรือเครือข่ายล้ม
  หรือ**ชิ้นภาพของ ion โหลดไม่ได้เกินเกณฑ์** (ได้ผลแล้วอย่างน้อย 8 ชิ้นและโหลดไม่ได้ตั้งแต่ 75% ขึ้นไป นับทุกข้อผิดพลาดไม่ว่ารหัสใด เกณฑ์เดียวกันทุก viewer) =
  ถอดชั้น ion ออกพร้อมข้อความไทยใน Message Viewer (ไม่มี token) แล้วชั้นอื่นและ Natural Earth II กลับมา (ไม่ค้างเป็นลูกโลกสีดำ) HUD ของ Sensor View บอกสัดส่วนชิ้นที่โหลดไม่ได้จริงระหว่างนั้น
  แล้วไม่ลองซ้ำกับ asset และ token เดิม จนกว่าจะเปลี่ยน asset หรือ token เลือก "ไม่เลือก" แล้วเลือกใหม่ หรือปิดแล้วเปิดสวิตช์ ion ใหม่ (ลืมการล้มเหลวทันทีแม้ไม่มีหน้าต่าง 3D เปิดอยู่)
  การลองใหม่เป็นการขอใหม่จริง: Cesium จำผลการขอข้อมูล asset ต่อ asset + token ไว้และไม่ลบผลที่ล้มเหลวเอง โปรแกรมจึงลบรายการนั้นทิ้งทุกครั้งที่ ion ล้มเหลว
- **เงื่อนไขของบัญชี**: บัญชี Community (ฟรี) ของ Cesium ion ใช้ได้เฉพาะงานไม่เชิงพาณิชย์ตามเงื่อนไขของ Cesium (กล่องยืนยันบอกข้อนี้) ภาพ Bing และ Google มีเงื่อนไขของผู้ให้ภาพเองด้วย

**เลือกชั้นภาพใน Globe Manager**: ตารางมี 11 แถวใน 4 กลุ่ม: Natural Earth II (ออฟไลน์ เป็นฐานเสมอ ปิดไม่ได้ อยู่นอกกลุ่ม) + GIBS 8 ชั้น + Sentinel-2 cloudless 2024 + OpenStreetMap
แต่ละชั้นมีช่อง **Show** และ **% Translucency** (จำนวนเต็ม 0-100) กลุ่ม Cesium ion ไม่มีตาราง (มีช่อง token และตัวเลือก asset)
ลำดับวาด (ชั้นที่อยู่ล่างทับชั้นบน): Natural Earth II → GIBS ตามตาราง → Sentinel-2 cloudless → OpenStreetMap → เส้น Lat/Lon อยู่บนสุดเสมอ (ยกเว้นเมื่อ ion แสดง: ion ชั้นเดียว)
เมื่อสวิตช์ของแหล่งใดปิด แถวของแหล่งนั้นปิดใช้ (เทา) พร้อมคำอธิบาย ค่าตั้งต้นเมื่อเปิดสวิตช์ครั้งแรก: **Blue Marble** กับ **VIIRS NOAA-20 True Color** แสดง ชั้นอื่นของ GIBS ซ่อน
ส่วนแถว Sentinel-2 cloudless และ OpenStreetMap ของ workbook ใหม่ตั้งเป็นแสดงไว้แล้ว (สวิตช์ของแหล่งยังปิดอยู่จึงยังไม่มีภาพ) workbook เก่าที่ไม่มีค่านี้ซ่อนไว้
ค่า Show และ Translucency เก็บใน workbook ของ scenario (File → Save) และใช้ร่วมกันทุกหน้าต่าง 3D และ Sensor View
เมื่อเปิดแสง (Enable Lighting) ด้านกลางคืนของชั้นภาพออนไลน์ทุกชั้นจางตาม Ambient Level ของหน้าต่างเท่ากับภาพฐาน (Sensor View เปิดแสงเสมอและใช้ค่าตั้งต้น)

| ชั้น (ชื่อบนจอ) | แหล่ง | รอบภาพ | ระดับซูมสูงสุด | เครดิต |
|---|---|---|---|---|
| Blue Marble | GIBS | คงที่ | 8 | NASA GIBS / EOSDIS |
| VIIRS NOAA-20 True Color | GIBS | รายวัน | 9 | NASA GIBS / EOSDIS |
| VIIRS Suomi NPP True Color | GIBS | รายวัน | 9 | NASA GIBS / EOSDIS |
| MODIS Terra True Color | GIBS | รายวัน | 9 | NASA GIBS / EOSDIS |
| Himawari-9 Red Visible | GIBS | 10 นาที | 7 | NASA GIBS / EOSDIS, JMA |
| Himawari-9 Clean Infrared | GIBS | 10 นาที | 6 | NASA GIBS / EOSDIS, JMA |
| GOES-East GeoColor | GIBS | 10 นาที | 7 | NASA GIBS / EOSDIS, NOAA |
| GOES-West GeoColor | GIBS | 10 นาที | 7 | NASA GIBS / EOSDIS, NOAA |
| Sentinel-2 cloudless 2024 | EOX | คงที่ | 15 | Sentinel-2 cloudless - https://s2maps.eu by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2024) |
| OpenStreetMap | OSM | คงที่ | 19 | © OpenStreetMap contributors |

เครดิตของชั้นที่แสดงอยู่แสดงบนภาพที่มุมล่างของหน้าต่าง 3D และ Sensor View (ไม่ได้ซ่อนในกล่อง Data attribution ของ Cesium) ควรคงเครดิตนี้ไว้เมื่อนำภาพไปใช้ต่อ
ซูมลึกกว่าระดับสูงสุดของชั้น Cesium ขยายภาพจากระดับสูงสุด (ภาพจึงไม่คมขึ้นอีก HUD ของ Sensor View บอกเมื่อถึงจุดนี้ หัวข้อ 9.9) ชั้น ion ไม่มีในตารางนี้เพราะระดับสูงสุดขึ้นกับ asset

**เวลาของภาพ** (เฉพาะ GIBS): ตามเวลา Animation ปัดตามรอบของแต่ละชั้น (UTC เสมอ ไม่ขึ้นกับเขตเวลาของเครื่อง): ชั้นรายวันใช้วันที่ UTC, ชั้น 10 นาทีปัดลงเป็นช่วง 10 นาที
(เช่น 02:37 UTC ใช้ภาพ 02:30) ชั้นคงที่ (Blue Marble, Sentinel-2 cloudless, OpenStreetMap, ion) ไม่ผูกเวลา เวลาเดินไปแต่ภาพยังเป็นรอบเดิม = ไม่ทำอะไร พอข้ามรอบจึงเปลี่ยนชั้นนั้น (ไม่เกินวินาทีละครั้งต่อหน้าต่าง
แม้เร่งเวลา 3600×) ภาพเดิมอยู่จนภาพใหม่เริ่มโหลด จอจึงไม่กะพริบเป็นสีดำ Sensor View บอกเวลาของภาพที่ใช้ใน HUD (หัวข้อ 9.9)

**เวลาที่ไม่มีภาพ**: ชิ้นที่ GIBS ไม่มีภาพของเวลานั้น (อนาคต เก่าเกินที่ GIBS เก็บไว้ หรือกลางคืนของภาพช่วงตามองเห็น) แสดงโปร่งใส เห็นชั้นข้างล่างแทน ไม่มีกรอบ error สีแดง
(server ตอบ 404 `IMAGERY_NOT_AVAILABLE` และจำไว้ 1 ชั่วโมง หรือ 10 นาทีสำหรับวันนี้/เมื่อวานและ 3 ชั่วโมงล่าสุด) HUD ของ Sensor View ต่อท้าย "— ไม่มีภาพเวลานี้" เมื่อชั้นบนสุดไม่มีภาพเกินครึ่งของชิ้นที่ได้ผลแล้ว
**scenario ที่พยากรณ์ล่วงหน้าจึงไม่มีภาพ GIBS จริงของเวลาในอนาคต ยกเว้น Blue Marble** (คงที่ ไม่ผูกเวลา) และ Natural Earth II ที่เป็นฐาน ส่วน Sentinel-2 cloudless, OpenStreetMap และ Cesium ion เป็นภาพคงที่
ใช้ได้กับทุกเวลา ภาพรายวันของ VIIRS/MODIS เป็นภาพประกอบหลายรอบโคจร อาจมีช่องว่างแถบดำใกล้ศูนย์สูตร Blue Marble ที่อยู่ล่างสุดของ GIBS ช่วยรองรับ

**ทดสอบโดยไม่ต่อเน็ต**: test ฝั่ง server ใช้ opener ปลอม (หัวข้อ 8.8) test ของหน้าเว็บ (Vitest) ไม่เรียกเครือข่าย และ e2e ใช้ข้อมูลที่ตั้ง `online_imagery` ครบสี่ช่องเป็น false และ `cesium_ion_token` ว่าง
(ไม่มี test ใดใส่ token) `imagery.spec.ts` ตรวจว่า browser ไม่ขอ `/api/imagery/tiles` เลยสักครั้งและไม่มี request ไป host อื่นนอก server ของ e2e (ไม่มี OSM, Cesium ion, GIBS, EOX), Globe Manager มี 4 กลุ่ม
และกล่องยืนยันของทุกสวิตช์ที่กด Cancel หรือ Esc ไม่ส่ง `PUT /api/settings` เลยและไม่เปลี่ยนเอกสารที่ `GET /api/settings` ตอบ (สี่ช่องยังเป็น false และ token ไม่เปลี่ยน) และ Zoom In 26 ครั้ง (ทีละ ×√2) ถึง ×8192
(มุมกว้างด้านสั้น = 1/8192 ของ ×1, ทิศกล้องคลาดไม่เกิน 0.01°, HUD แสดงความกว้างพื้นที่ที่จุดใต้ดาว) (หัวข้อ 9.5)

**สถานะการตรวจกับของจริง**: งานทั้งหมดพัฒนาและทดสอบกับโฮสต์ปลอม ไม่มี test หรือโค้ดใดต่อเน็ตจริง ค่าในตารางชั้นภาพ (`imagery.py`) ที่ตรวจกับของจริงแล้วและที่ยังไม่ได้ตรวจ:

- **ตรวจแล้ว (GIBS)**: ผู้ใช้เปิดสวิตช์ GIBS ใช้งานเองเมื่อ 2026-11-14 และ log ของ server แสดงว่า **Blue Marble** (เวลา `default`) กับ **VIIRS NOAA-20 รายวัน** (วันที่ 2026-11-11) ได้ชิ้นภาพตอบ HTTP 200
  จึงยืนยันแม่แบบ URL ของ GIBS, เวลา `default` ของชั้นคงที่ และชุดชิ้นภาพ Level8 (Blue Marble) / Level9 (VIIRS NOAA-20) แบบ jpg แล้ว
- **ยังไม่ได้ตรวจ** (รอผู้ใช้อนุญาตให้ต่อเน็ต แก้ที่ตารางเดียวถ้าผิด):
  - **EOX**: ชื่อชั้น `s2cloudless-2024_3857`, TileMatrixSet `g`, ระดับสูงสุด 15 และ URL (`.../default/g/{z}/{y}/{x}.jpg`)
  - **Cesium ion**: Asset ID ของ preset (ตรวจจากต้นฉบับ CesiumJS 1.147 ในโปรแกรม ไม่ใช่จากบัญชีของผู้ใช้) และว่าบัญชีของผู้ใช้เข้าถึง asset เหล่านั้นได้จริงหรือไม่ (รวมสถานะของ Bing บน ion)
  - **Himawari-9 และ GOES** ของ GIBS: ตรวจกับของจริงแล้ว (2026-11-15) Himawari Red Visible และ Clean Infrared ได้ PNG; GOES-East/West GeoColor ได้ PNG (เดิมตั้งเป็น jpg ผิด แก้แล้ว) — ยังไม่ได้ตรวจผลตอบเมื่อไม่มีภาพและระยะเวลาที่ GIBS เก็บภาพ 10 นาที
    (MODIS Terra ตรวจแล้วได้ JPEG; VIIRS Suomi NPP ชิ้นที่ลองตอบ 404 ไม่มีภาพ ณ ชิ้นนั้น)
  - **OpenStreetMap**: URL และระดับ 19 มาจากเอกสารของ OSM ยังไม่มีบันทึกว่าเปิดทดสอบกับของจริง

**ยังไม่ทำ**: งานเสริม ข2: ดาวถ่ายภาพ
(Himawari-9, GOES, Terra, Suomi NPP, NOAA-20/21) เป็น object ใน scenario และแถบ swath ของมัน, อ่านรายการช่วงเวลาที่มีภาพล่วงหน้าจาก GetCapabilities (ตอนนี้ใช้ผลตอบ 4xx ของแต่ละชิ้นแทน), ภาพบนหน้าต่าง 2D
และการดาวน์โหลดภาพเก็บล่วงหน้าทั้งพื้นที่ (OpenStreetMap ห้ามโดยนโยบายของเขา)


### 9.11 โมเดล 3 มิติของดาว (หน้าต่าง 3D)

ดาวในหน้าต่าง 3D แสดงเป็น**โมเดล 3 มิติตามรุ่นของมัน**แทนจุด (แบบ STK): เสาอากาศลงโลก แผงโซลาร์หันหาดวงอาทิตย์ ซูมออกไกลโมเดลไม่เล็กกว่า **Model Pixel Size** (ค่าตั้งต้น 48 พิกเซล) ที่ทุกระยะ ซูมเข้าใกล้เห็นขนาดจริงเป็นเมตร
ดาวที่ห่างกล้องเกิน **Model Detail Threshold** (ค่าตั้งต้น 30,000 km) แสดงเป็นจุดสีของระบบแบบเดิม (ไม่วาดโมเดลเลย: ลดงานของ GPU และดาวไกลยังเห็นชัด) แบบ detail threshold ของ STK
ชื่อ เส้นทาง สีของระบบ การคลิกเลือก Sensor และเส้น Access ทำงานเหมือนเดิม โมเดลทุกตัวมีขอบ (silhouette) สีของระบบ 1.5 พิกเซล ดาวที่เลือกขอบหนา 3 พิกเซล และสีของระบบผสมกับสีของโมเดล 50%
แสงของโมเดล: แสงอาทิตย์ 2 เท่าของแสงใน scene (ค่าตั้งต้นของ Cesium) และแสงรอบตัวคงที่เท่ากันทุกทิศ ด้านกลางคืนของดาวจึงยังเห็นบนพื้นอวกาศดำ
โมเดลมากับแอปเอง **ไม่ดึงอะไรจากเน็ต** หน้าต่าง 2D ยังแสดงเป็นจุด ใน Sensor View โมเดลใช้ค่าตั้งต้น (เปิด, 48 พิกเซล, 30,000 km) และโมเดลของดาวแม่ที่กล้องติดอยู่ถูกซ่อน
View From/To ที่ From เป็นดาว: กล้องอยู่ในตัวดาวนั้น โมเดล จุด และป้ายของดาว From จึงถูกซ่อน (เส้นวงโคจรยังอยู่) ออกจาก View From/To แล้วกลับมา
Design: [docs/2026-11-14-gnss-studio-models-integration-design.md](docs/2026-11-14-gnss-studio-models-integration-design.md), brief ของโมเดล: [docs/2026-11-14-gnss-studio-models-brief.md](docs/2026-11-14-gnss-studio-models-brief.md),
การตัดสินใจและเรื่องที่เลื่อน: [docs/2026-11-14-gnss-studio-imagery-decisions.md](docs/2026-11-14-gnss-studio-imagery-decisions.md) หัวข้อ "โมเดล 3 มิติในหน้าต่าง 3D"

**โมเดลที่มี (26 ตัว ใน `models/catalog.json`)**

| โมเดล | block (`satelliteInfo(norad).block` จากข้อมูล IGS) หรือ NORAD | กฎท่าทาง (ตาม block ของดาว ไม่ใช่ตามโมเดล) |
|---|---|---|
| `gps-iif` | GPS-IIF | `gps_iif` |
| `gps-iii` | GPS-III, GPS-IIIA, GPS-III-1 | `gps_iii` (ประมาณการ) |
| `gps-iir` | GPS-IIR-A, GPS-IIR-B, GPS-IIR-M | `gps_iir` |
| `glonass-m` | GLO-M, GLO-M+ | `glonass_m` |
| `glonass-k1` | GLO-K1, GLO-K1+, GLO-K1A, GLO-K1B | `glonass_k` (ประมาณการ) |
| `glonass-k2` | GLO-K2 | `glonass_k` (ประมาณการ) |
| `galileo-iov` | GAL-1 | `galileo_iov` |
| `galileo-foc` | GAL-2 | `galileo_foc` |
| `bds2-igso` | BDS-2I, BDS-2M | `bds2_ys_on` |
| `bds2-geo` | BDS-2G | `orbit_normal` |
| `bds3-geo` | BDS-3G | `orbit_normal` |
| `bds3-igso` | BDS-3I | `bds3_cast` |
| `bds3-meo-cast` | BDS-3M-CAST, BDS-3SM-CAST | `bds3_cast` |
| `bds3-meo-secm` | BDS-3M-SECM-A, BDS-3M-SECM-B, BDS-3SM-SECM | `bds3_secm` |
| `qzss-igso` | QZS-2A, QZS-2I | `qzss2_pseudo_ys` |
| `qzss-qzs1` | QZS-1 | `qzss1_ys_on` |
| `qzss-geo` | QZS-2G, QZS-3G | `orbit_normal` |
| `navic-irnss1` | IRS-1G, IRS-1I | `navic` (ประมาณการ) |
| `navic-nvs` | IRS-2G, IRS-2I | `navic` (ประมาณการ) |
| `generic` | block อื่นใน `fallback_blocks` (BDS-3S, BDS-3SI-CAST, BDS-3SI-SECM, GAL-0A, GAL-0B, GLO, GPS-I, GPS-II, GPS-IIA) และดาวที่ไม่มี block หรือไม่มีใน catalog | BDS-3SI-CAST `bds3_cast`, BDS-3SI-SECM `bds3_secm`, block อื่นและไม่มี block `nominal_ys` |
| `terra` | NORAD 25994 | `nadir_velocity` |
| `aqua` | NORAD 27424 | `nadir_velocity` |
| `suomi-npp` | NORAD 37849 (Suomi NPP), 43013 (NOAA-20) | `nadir_velocity` |
| `noaa-21` | NORAD 54234 (NOAA-21) | `nadir_velocity` |
| `goes` | NORAD 41866, 43226, 51850, 60133 (GOES-16/17/18/19) | `nadir_velocity` |
| `himawari-9` | NORAD 41836, 40267 (Himawari-9/8) | `nadir_velocity` |

ลำดับเลือกโมเดลของดาวหนึ่งดวง: **block ตรงตัวกับ `blocks` ของโมเดล → `fallback_blocks` → `norad_ids` → `generic`** (block ที่ไม่รู้จักหรือไม่มี ข้ามไปที่ `norad_ids` แล้วถึง `generic`)
โมเดลของดาวสำรวจโลก (Terra, Aqua, Suomi NPP/NOAA-20, GOES, Himawari) เลือกจาก NORAD ที่ตรงกับ `norad_ids` ข้อมูล GNSS ที่ engine ดึงมาไม่มีดาวเหล่านี้ จึงไม่ได้ใช้กับ scenario ปกติ
ข้อมูลจริง 146 ดวง (`data/orbits/20261110T2147Z`) ทุกดวงได้โมเดลของ block ตัวเอง ยกเว้น BDS-3SI-CAST และ BDS-3SI-SECM (อย่างละดวง) ที่ใช้ `generic` และดวงที่ไม่มีข้อมูล IGS หนึ่งดวงที่ใช้ `generic`

**ท่าทางของตัวดาว (คำนวณใน ECEF ณ เวลา Animation)** r, v = ตำแหน่งและความเร็วของดาว (ความเร็วจากผลต่างตำแหน่ง t ± 1 s เหมือน sensor), s = ตำแหน่งดวงอาทิตย์ (ฟังก์ชันของ Cesium ที่ใช้กับแสงในหน้าต่าง 3D)

- **ดาว GNSS: กฎท่าทางตาม block ของดาวแต่ละดวง** (`web/src/cesium/attitudeLaws.ts`, สูตรจาก [docs/2026-11-14-gnss-attitude-laws.md](docs/2026-11-14-gnss-attitude-laws.md) §1–§4)
  ทุกกฎ (ยกเว้น NavIC ที่ +Z ชี้เป้าเหนืออินเดีย): +Z ชี้ศูนย์กลางโลก แล้วหมุนรอบ +Z ด้วยมุม yaw ψ จากกรอบ orbit normal (+X ตามความเร็วเฉื่อย, +Y = −h); β = มุมดวงอาทิตย์เหนือระนาบวงโคจร μ = มุมในวงโคจรนับจากเที่ยงคืน
  nominal yaw steering ψ = atan2(−tan β, sin μ) (ดวงอาทิตย์อยู่ในระนาบ X-Z ฝั่ง +X) กฎรายรุ่นต่างจาก nominal เฉพาะตอน β ต่ำใกล้เที่ยงวัน/เที่ยงคืนหรือในเงาโลก
  **ไม่มีสถานะ**: ท่าทาง ณ เวลาหนึ่งคำนวณจากตำแหน่ง ความเร็ว และดวงอาทิตย์ ณ เวลานั้นเท่านั้น (จุดเริ่ม/จบของการหมุนหาเชิงวิเคราะห์จาก β, μ) เลื่อนเวลา กระโดดเวลา หรือเล่นต่อเนื่องจึงได้ท่าทางเดียวกัน

  | กฎ | block | ช่วงพิเศษและพฤติกรรม |
  |---|---|---|
  | `nominal_ys` | block ที่ไม่รู้จัก, เลิกใช้ (GPS-IIA, GAL-0A, GLO, BDS-3S, …) หรือไม่มี | nominal ทุกช่วง |
  | `orbit_normal` | BDS-2G, BDS-3G, QZS-2G, QZS-3G | ψ = 0 ตลอด (+X ตามความเร็ว) |
  | `gps_iir` | GPS-IIR-A/B/M | \|β\| < 2.4°: หมุน 0.20°/s แบบกึ่งกลางที่ทั้งเที่ยงวันและเที่ยงคืน |
  | `gps_iif` | GPS-IIF | เที่ยงวัน \|β\| < 4.35°: 0.11°/s (β ∈ [−0.7°, 0) หมุนกลับทาง); ในเงาโลก (\|β\| < 13.9°): อัตราคงที่ตลอดเงา ออกเงาตรง nominal |
  | `gps_iii` (ประมาณการ) | GPS-III, GPS-IIIA, GPS-III-1 | \|β\| < 5.8°: หมุนเรียบ ≤ 0.082°/s ราว 1 ชั่วโมง (β หน่วงแบบ CAST, d = 2000 เลือกเอง) |
  | `glonass_m` | GLO-M, GLO-M+ | เที่ยงวัน \|β\| < 2°: 0.25°/s กึ่งกลาง; ในเงาโลก: เริ่มหมุน 0.25°/s ตอนเข้าเงาไปถึงมุมตอนออกเงาแล้วค้างไว้ |
  | `glonass_k` (ประมาณการ) | GLO-K1, GLO-K1+, GLO-K1A, GLO-K1B, GLO-K2 | \|β\| < 2°: 0.24987°/s กึ่งกลางทั้งสอง node (ไม่มีช่วงเร่ง/ผ่อนอัตรา) |
  | `galileo_iov` | GAL-1 | เวกเตอร์ดวงอาทิตย์เสริม (กล่อง 15° × 2°) |
  | `galileo_foc` | GAL-2 | \|β\| < 4.1° และ ε < 10°: สูตร cosine ผ่าน ±90° ที่ node (ครึ่งคาบ = ช่วงสมมาตร 2x_i/μ̇: 2816 s ที่ β = 0 ถึง 2583 s ที่ 4°) |
  | `bds2_ys_on` | BDS-2I, BDS-2M | \|β\| ≤ 4°: orbit normal ทั้งรอบ |
  | `bds3_cast` | BDS-3M-CAST, BDS-3I, BDS-3SM-CAST, BDS-3SI-CAST | \|β\| ≤ 3°: β หน่วง (d = 80,000) |
  | `bds3_secm` | BDS-3M-SECM-A/B, BDS-3SM-SECM, BDS-3SI-SECM | \|β\| ≤ 3°: ใช้ β = ±3° |
  | `qzss1_ys_on` | QZS-1 | \|β\| ≤ 20°: orbit normal |
  | `qzss2_pseudo_ys` | QZS-2I, QZS-2A | \|β\| < ≈ 4.4°: หมุนอัตราคงที่ 0.055°/s ผ่าน ±90° ที่ node |
  | `navic` (ประมาณการ) | IRS-1G, IRS-1I, IRS-2G, IRS-2I | +Z ชี้เป้า (5°N, 83°E) บนผิว WGS84 แทนศูนย์กลางโลก แล้ว yaw steering รอบแกนนั้น; \|β\| < 4°: orbit normal รอบแกนนั้น (เกณฑ์เลือกเอง ISRO ไม่เผย) |

- **ดาวสำรวจโลก (`nadir_velocity`): Nadir alignment with ECI velocity constraint** (เฟรมเดียวกับ sensor, [9.9](#99-sensor-และ-sensor-view)): +Z ชี้ลงโลก +X ตามส่วนของความเร็วเฉื่อยที่ตั้งฉากกับ +Z
- **แผงโซลาร์**: หมุนรอบแกน +Y ของตัวดาวให้ normal ด้านเซลล์ชี้ไปทางดวงอาทิตย์ที่ฉายลงระนาบ X-Z ของตัวดาว ช่วง nominal คลาดไม่เกิน 1° ช่วงหมุนพิเศษ orbit normal และดาวสำรวจโลกคลาดเท่ามุมระหว่างดวงอาทิตย์กับระนาบ X-Z
  ด้านเซลล์ตอนมุมศูนย์อ่านจาก `cell_normal` ของ `models/catalog.json` (terra −Z, suomi-npp −X, aqua +X, goes +Z, ตัวอื่น −X) catalog ที่ไม่มีฟิลด์นี้ใช้ตารางสำรองในโค้ดที่มีค่าเดียวกัน ค่าที่อ่านไม่ได้ (±Y, ตัวพิมพ์เล็ก, …) ใช้ตารางสำรองและแจ้งเตือนภาษาไทยใน Message Viewer ครั้งเดียวต่อโมเดล
  แผงเดี่ยว (`wing-Y`) ของดาวสำรวจโลกหมุนด้วยวิธีเดียวกัน ถ้าดวงอาทิตย์อยู่แนว ±Y ของตัวดาวพอดี มุมแผงคงค่าเดิม
- +Z ของตัวดาวชี้ศูนย์กลางโลก (ตรวจใน unit test กับ `ModelUtility.getAxisCorrectionMatrix` จริงของ Cesium คลาด < 1e-6° และใน e2e ผ่าน test hook `satelliteOrientation` คลาด < 0.5°)

**ข้อจำกัดของแบบจำลองท่าทาง**

- **กฎท่าทางเป็นแบบจำลองเชิงวิเคราะห์ของวงโคจรเกือบวงกลม** ไม่ใช่ท่าทางที่วัดได้: การหมุนพิเศษหาจุดเริ่ม/จบจาก β, μ ณ ขณะนั้น (β ถือว่าคงที่ระหว่างการหมุน) เงาโลกเป็นทรงกระบอก (ไม่แยก umbra/penumbra)
  กฎที่สลับตามเกณฑ์ β (BDS-2, QZS-1, NavIC, Galileo FOC, GPS IIF ช่วง −0.7°) และตอน β เปลี่ยนเครื่องหมาย ท่าทางกระโดดได้ ณ ขณะที่ β ข้ามเกณฑ์ (ดาวจริงหมุนช่วงนั้นช้า ๆ)
- **ประมาณการ**: `gps_iii` (ค่าหน่วง d = 2000 เลือกให้ ≤ 0.082°/s และราว 1 ชั่วโมง), `glonass_k` (อัตราคงที่ ไม่มีช่วงเร่ง/ผ่อน และไม่อ่านพารามิเตอร์ใน CDMA nav), `navic` (เกณฑ์ ON 4°)
- ไม่จำลอง: CYS ของ BDS-2 บางดวงหลังอัปเกรดปี 2017–2018, การพลิกที่เลื่อนออกไปของ BDS-3 SECM, แบบ WHU ของ CAST, ค่า β0 = 2.8° ของ CAST MEO (ใช้ 3° ทุกดวง), การหมุนช่วง manoeuvre
- **ด้านเซลล์ของ `aqua` และ `suomi-npp` ตาม `cell_normal` ของ catalog**: แผงสองหน้าใช้พื้นผิวเดียวกัน แกนแผง (±X) แน่นอน ด้านที่เห็นเป็นไปตามที่ catalog เลือก
  ด้านเซลล์ของ `goes` เชื่อได้ระดับปานกลาง ส่วน `terra` หน้าเซลล์ชี้ −Z (หน้าหลังเป็นพื้นผิวหลังแผง)
- โมเดลนี้เป็นภาพประกอบ ไม่ใช่ท่าทางที่วัดได้ของดาว และโมเดลของดาวรุ่นที่ไม่มีใน catalog ใช้ `generic` (ท่าทางยังตาม block ของดาว)
- ภาพที่ออกมาตรวจด้วยคณิตศาสตร์ของ Cesium และ e2e (จำนวนโมเดล จุดซ่อนหรือแสดง ทิศ +Z) ไม่ได้ตรวจด้วยตาบน GPU จริง (e2e ใช้ SwiftShader และไม่ใช้ภาพจับหน้าจอ)
  ความเร็ว 30 fps ที่ 146 ดวงยังไม่ได้วัดบน GPU จริง (Model Detail Threshold ลดจำนวนโมเดลที่วาดลงตามระยะจากกล้อง)

**ตัวเลือก** (View → Toolbars → 3D Window Defaults → Properties เปิด 3D Graphics Window Properties หน้า **Details**; ค่าเก็บต่อหน้าต่างไปกับ workbook)

| ตัวเลือก | ค่าตั้งต้น | หมายเหตุ |
|---|---|---|
| **Satellite Models** | เปิด | ปิด = ดาวกลับเป็นจุดทันที (ไม่ fetch ไฟล์ใหม่เมื่อเปิดอีกครั้ง) |
| **Model Pixel Size** | 48 | จำนวนเต็ม 16–256 พิกเซล (ขนาดต่ำสุดบนจอ ไม่จำกัดการขยาย จึงได้ขนาดนี้ที่ทุกระยะ: test คำนวณด้วยสูตรของ Cesium ที่ 50,000 และ 80,000 km) |
| **Model Detail Threshold** | 30000 | จำนวนเต็ม 1,000–200,000 km: ดาวที่ห่างกล้องน้อยกว่านี้เป็นโมเดล ไกลกว่าเป็นจุด ตัดสินใหม่ทุกรอบ 250 ms ขณะเวลาเดิน และเมื่อกล้องขยับเกิน 5% |

ป้ายสามตัวนี้ไม่มีใน STK reference (ไม่มีคำว่า detail threshold) จึงเป็นป้ายของเราเอง โหลดโมเดลล้มเหลว (ไม่มีไฟล์ ไฟล์เสีย หรือ catalog อ่านไม่ได้) = ดาวนั้นกลับเป็นจุด มีข้อความไทยใน Message Viewer ครั้งเดียวต่อโมเดล (ต่อหน้าเว็บสำหรับ catalog) การคลิก ป้ายชื่อ สี Sensor และ Access ไม่เสีย
ไฟล์ glb แต่ละตัวถูกดึงครั้งเดียวต่อหน้าเว็บ ตรวจทั้งไฟล์ก่อนใช้ (`glbProblem`: ความยาวในหัว, JSON chunk อ่านได้, `asset.version` = "2.0", `extensionsRequired` มีแต่ที่ Cesium รองรับ, chunk พอดีไฟล์)
แล้วให้ Cesium โหลดจาก `blob:` ของ origin เดียวกัน ถ้า Cesium ยังโหลดไม่สำเร็จภายหลัง (`errorEvent` ของ primitive โมเดล) ดาวของโมเดลนั้นกลับเป็นจุดทุกหน้าต่าง พร้อมข้อความไทยครั้งเดียวต่อโมเดล
ใช้หน่วยความจำราว 1 MB ต่อโมเดลที่ใช้จริงตลอดอายุหน้า

**การแพ็กเกจ** `catalog.json` และ `<id>/<ไฟล์>.glb` ทุกตัวที่ catalog ระบุถูกคัดลอกไป `web/dist/models/` ตอน `npm run build` (dev server ส่ง path เดียวกัน) แล้ว server ส่งที่ `/models/catalog.json` และ `/models/<id>/<ไฟล์>.glb`
**ส่งเฉพาะไฟล์ที่ catalog ระบุ**: `_refs/` (ภาพอ้างอิงราว 55 MB), `_tools/`, `scripts/`, `renders/`, `vendor/`, `textures/` ไม่ถูกส่งไปกับแอป (path ใน catalog ที่ชี้เข้าโฟลเดอร์เหล่านี้ทำให้ build ล้ม)
**ขนาด**: `dist/models` = 19.4 MB (23 glb + catalog) `dist` ทั้งหมดจึงจาก ราว 14 MB เป็นราว 33 MB (เพิ่ม ราว 19 MB; ตัวเลขที่วัดจาก build นี้ ไม่ใช่ค่าประมาณ)

**เครดิตและสัญญาอนุญาต**

- `terra`, `aqua`, `suomi-npp` (ใช้กับ NOAA-20 ด้วย) และ `goes`: ดัดแปลง (ปรับมาตราส่วน ทิศแกน และลดจำนวนสามเหลี่ยม แยกแผงโซลาร์เป็น node) จากโมเดลของ **NASA 3D Resources** (`nasa/NASA-3D-Resources`)
  ภายใต้ NASA Images and Media Usage Guidelines: ใช้ได้โดยไม่ต้องขออนุญาต ห้ามสื่อว่า NASA รับรอง และต้องคงเครดิต **"NASA"** ต้นฉบับและรายละเอียดอยู่ใน `models/vendor/SOURCES.md` และ `NOTES.md` ของแต่ละโมเดล
- โมเดลที่เหลือ (GNSS ทั้ง 17 ตัว, `generic` และ `himawari-9`) สร้างเองด้วยเรขาคณิตและพื้นผิวแบบ procedural ใน Blender (`models/<id>/scripts/build.py`) ไม่ใช้ไฟล์ของผู้อื่น ขนาดอ้างอิงจากเอกสารสาธารณะของผู้ผลิตและหน่วยงาน (ระบุใน `NOTES.md` ของแต่ละโมเดล)
- โมเดลจาก Sketchfab ที่ `SOURCES.md` ระบุเป็นตัวเลือกไว้ **ไม่ได้ดาวน์โหลดและไม่ได้ใช้**

**ทดสอบ**: unit test (`tests/unit/sat-model-*.test.ts`, `attitude.test.ts`, `attitude-laws.test.ts` (ทุกกฎที่ β = ±0.5°, ±2°, 5°, 15°: ความต่อเนื่อง อัตราหมุน nominal นอกช่วง กรอบตั้งฉาก ไม่ขึ้นกับประวัติ), `models-packaging.test.ts`) และ e2e `web/tests/e2e/models.spec.ts` (`npm run e2e`): ที่ Model Detail Threshold 200,000 km ดาวที่แสดงทุกดวงเป็นโมเดล ที่ 1,000 km ทุกดวงเป็นจุด
และดาวที่กล้องเข้าไปใกล้ (test hook `flyToSatellite`) เป็นโมเดล ปิด Satellite Models แล้วเหลือ 0 และจุดกลับมา `catalog.json` ถูกขอครั้งเดียว glb ไม่เกินครั้งเดียวต่อไฟล์ ไม่มี request ออกนอกเครื่อง +Z ชี้ลงโลกคลาด < 0.5°
