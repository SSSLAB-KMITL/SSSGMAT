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
| `CESIUM_ION_TOKEN` | ว่าง | token ของ Cesium ion สำหรับหน้าเว็บ server อ่านเก็บไว้ในค่าตั้ง ยังไม่มี endpoint ใดใช้ในรุ่นนี้ |

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
>            "validation_retry_hours": 3, "validation_give_up_days": 14}, "cesium_ion_token": ""}
> ```
>
> หรือปิดตอน server รันอยู่ด้วย `PUT /api/settings` (ต้องส่งทั้งเอกสาร ช่องที่หายได้ 422) ตัวตั้งเวลาอ่านค่าใหม่ทันที และทุกรอบ
> (การปิดหลังเปิดอาจช้ากว่ารอบตรวจแรกซึ่งเกิดตอนเปิด server จึงควรเขียนไฟล์ก่อน):
>
> ```bash
> curl -s -X PUT http://127.0.0.1:8000/api/settings -H 'Content-Type: application/json' \
>   -d '{"daily": {"enabled": false, "run_at_utc": "21:00", "facility": "THBK", "retention_days": 30, "validation_retry_hours": 3, "validation_give_up_days": 14}, "cesium_ion_token": ""}'
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
| `cesium_ion_token` | `""` | ข้อความ | token ของ Cesium ion ที่หน้าเว็บอ่าน |

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
{"daily": {"enabled": false, "run_at_utc": "21:00", "facility": "THBK", "retention_days": 30, "validation_retry_hours": 3, "validation_give_up_days": 14}, "cesium_ion_token": ""}
JSON

cd server
GNSS_STUDIO_DATA=$DEMO GNSS_STUDIO_PORT=8765 .venv/bin/python -m gnss_studio_server
# GNSS Studio: http://127.0.0.1:8765/
# INFO:     Uvicorn running on http://127.0.0.1:8765 (Press CTRL+C to quit)
```

**2. ตรวจ health และว่างานประจำวันปิดอยู่** (`curl -s http://127.0.0.1:8765/api/settings` และ `/api/health`)

```
{"daily":{"enabled":false,"run_at_utc":"21:00","facility":"THBK","retention_days":30,"validation_retry_hours":3,"validation_give_up_days":14},"cesium_ion_token":""}
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

## 9. GNSS Studio workspace

หน้าเว็บของ GNSS Studio (งานย่อยที่ 3) ใช้งานเหมือน STK: เมนู แถบเครื่องมือ Object Browser, Properties Browser, Animation, Timeline View,
หน้าต่าง 3D (Cesium) และ 2D, Message Viewer และแถบสถานะ ทำงานบน server ในหัวข้อ 8 โดยไม่ต่อเน็ตเอง (ภาพโลกคือ NaturalEarthII ที่มากับ Cesium
ไม่ใช้ Cesium ion, Bing, terrain หรือ CDN) โค้ดอยู่ใต้ `web/` (React 18 + TypeScript + Vite, dockview, CesiumJS)

- Spec: [docs/2026-11-11-gnss-studio-workspace-design.md](docs/2026-11-11-gnss-studio-workspace-design.md) (อ้างว่า "workspace §n")

### 9.1 ติดตั้ง

ต้องมี Node.js รุ่นใหม่พอสำหรับ Vite 8 (ทดสอบกับ Node 26 / npm 11) ทุกแพ็กเกจตรึงรุ่นแบบ `x.y.z` และ `package-lock.json` อยู่ใน git จึงติดตั้งด้วย `npm ci`

```bash
cd api-interop/gnss-predict/web
npm ci
```

### 9.2 พัฒนา

เปิด server (หัวข้อ 8.2) ที่ port 8000 แล้วเปิด Vite คู่กัน:

```bash
cd api-interop/gnss-predict/server && .venv/bin/python -m gnss_studio_server     # terminal 1: http://127.0.0.1:8000/
cd api-interop/gnss-predict/web && npm run dev                                      # terminal 2: Vite (ตั้งต้น http://localhost:5173/)
```

Vite ส่งต่อ `/api` (รวม SSE ที่ `/api/events`) ไป `http://127.0.0.1:8000` และ **เขียน header `Origin` ใหม่เป็น `http://127.0.0.1:8000`**
เพราะ server ตอบ 403 `FORBIDDEN_ORIGIN` กับคำขอ POST, PUT, PATCH, DELETE ที่ `Origin` ไม่ตรง origin ของ server เอง (หัวข้อ 8.2)
หน้าเว็บที่ Vite ส่งอยู่ที่ port 5173 จึงจะส่ง `Origin: http://localhost:5173` ซึ่ง server ปฏิเสธถ้าไม่เขียนใหม่ (ค่าตั้งอยู่ใน `web/vite.config.ts`)
ถ้า server ไม่ได้ฟังที่ port 8000 ให้แก้ `SERVER_ORIGIN` ในไฟล์นั้น

### 9.3 build แล้วเปิดจาก server

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
  `conflict` (Apply ที่ ETag เก่าขึ้นกล่อง Reload/Cancel), `nores` (scenario ไม่มีผลลัพธ์ไม่ล่ม), `perf` (ข้ามเว้นแต่ตั้ง `GNSS_E2E_PERF_URL`, ดูหัวข้อ 9.6)
- ทุก spec ฟัง `pageerror` ของหน้า ถ้ามี exception ที่ไม่ถูกจับ test ล้มเหลว

### 9.6 วัดประสิทธิภาพ (เกณฑ์ข้อ 1 และ 2 ของ spec)

เกณฑ์ข้อ 1: เปิด scenario รายวันแล้วภาพขึ้นภายใน 3 วินาที (`scene.czml` ราว 2–3 MB) วัดที่ `window.__gnssStudioTest.sceneLoadedAt()` (เวลาตั้งแต่เปิดหน้า)
เกณฑ์ข้อ 2: กด Start แล้วดาว 130 ดวงเคลื่อนพร้อมกันไม่ต่ำกว่า 30 ภาพต่อวินาที วัดจำนวนเฟรมของหน้าต่าง 3D ใน 5 วินาที (ต้อง ≥ 150) ขณะหน้าต่าง 2D เปิดอยู่ด้วย
ผลขึ้นกับเครื่องและ GPU จึงวัดบนเครื่องพัฒนาด้วย `--headed` (การเรนเดอร์ด้วย CPU/SwiftShader ใน headless ไม่ใช่ตัวตัดสิน
`playwright.config.ts` ไม่ใส่ `--use-angle=swiftshader` เมื่อตั้ง `GNSS_E2E_PERF_URL`)

ขั้นตอน (ห้ามเปิด server บน `data/` จริง เพราะงานประจำวันอาจดึงข้อมูลจาก CelesTrak):

```bash
# 1) โฟลเดอร์ data ชั่วคราว: เขียน settings.json ที่ปิดงานประจำวัน "ก่อน" เปิด server
P=/tmp/gnss-perf; mkdir -p $P/scenarios $P/orbits
printf '%s' '{"daily":{"enabled":false,"run_at_utc":"21:00","facility":"THBK","retention_days":30,"validation_retry_hours":3,"validation_give_up_days":14},"cesium_ion_token":""}' > $P/settings.json
# 2) คัดลอกเท่านั้น (ไม่เปิด ไม่รันไฟล์ในนั้น): scenario รายวันที่มีผลแล้วกับ snapshot ที่มันใช้ (ชื่อใน orbit_snapshot ของ scenario.json)
cp -R data/scenarios/acc_20261111 $P/scenarios/ && cp -R data/orbits/20261110T2147Z $P/orbits/
# 3) เปิด server ที่ port 8767 (ไม่มี GMAT ก็ได้เพราะผลมีอยู่แล้ว)
cd server && GNSS_STUDIO_DATA=$P GNSS_STUDIO_PORT=8767 GMAT_BIN=/nonexistent .venv/bin/python -m gnss_studio_server
# 4) วัด (terminal อื่น) แล้วปิด server ด้วย Ctrl-C; พิมพ์ "PERF load: ..." และ "PERF frames in 5 s: ..."
cd web && GNSS_E2E_PERF_URL="http://127.0.0.1:8767/?sc=acc_20261111&test" npx playwright test perf.spec.ts --headed
```

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
โปรแกรมทำงานกับ server ในเครื่องเท่านั้น ไม่โหลดฟอนต์หรือ script จากเน็ต เมนู ปุ่ม และหน้าตั้งค่าเป็นภาษาอังกฤษตามชื่อใน STK ส่วนข้อความอธิบายและข้อผิดพลาดเป็นภาษาไทย
คีย์ลัดที่ใช้ได้คือ Ctrl+S, Delete, Ctrl+F เท่านั้น (Ctrl+N, Ctrl+O, Ctrl+Q เป็นของ browser)

### 9.8 ข้อจำกัดของ v1

- **Visible Sides** ของ 2D Graphics - Pass เก็บและแก้ได้ แต่ v1 วาดเส้นทางแบบ `Both` เสมอ (หน้าแสดงหมายเหตุไทย)
- หน้าต่าง 2D แสดงแผนที่ในกรอบ **ECF** เท่านั้น (Display Coordinate Frame เลือก ECI ไม่ได้)
- เมนู **Analysis** (Access..., Report & Graph Manager..., Validation...) และปุ่มบนแถบเครื่องมือที่เกี่ยวข้องปิดใช้ รอ **งานย่อยที่ 4**
  (Access tool, Report & Graph Manager และหน้า Validation) แถว Timeline แสดงช่วงเวลาของ access ที่ scenario เปิด Timeline ไว้ (แม่แบบ thbk-gnss มีให้แล้ว)
- ภาพแสงไฟเมืองตอนกลางคืน (Night Lights Level) ต้องใช้ภาพจาก Cesium ion จึงไม่มีในรุ่นออฟไลน์นี้ (เก็บค่าไว้แต่ไม่มีผลต่อภาพ)
- Cut, Copy และ Paste ใน Object Browser ใช้ได้เฉพาะดาว ไม่รองรับการเปลี่ยนชื่อหรือลบกลุ่ม ไม่ใช่โปรแกรมหลายผู้ใช้ ไม่มีธีมมืด และไม่รองรับมือถือ
