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
    _cache/                       ไฟล์ที่ดาวน์โหลด (ชื่อมีเวลา), celestrak_state.json, brdc/ (broadcast ที่ validate ใช้)
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
  ตรงกับที่พบในผลทดลอง (ข้อมูลวงโคจรชุดนี้ของ C40 ผิดหรือดาวปรับวงโคจร) ไม่อยู่ในสถิติระดับระบบเพราะค่าจริงไม่ได้มาจาก SP3
- ตรวจไม่ได้ (`unverified`): R01, R13, R27 (GLONASS ที่ไม่มีใน SP3)
- ดวง `stale` ที่ผ่านเกณฑ์รายดวงแต่ไม่อยู่ในสถิติระดับระบบ: C06 (5.70 วัน, SP3), R06 (2.24 วัน, SP3), C10 (2.02 วัน, broadcast)
- snapshot นี้ดึง**หลัง**วันที่ตรวจ OMM ของดาวที่ propagate 47 จาก 121 ดวงมี epoch หลัง 2026-11-10 00:00 UTC
  ผลนี้จึงวัดความแม่นยำของ SGP4 และการแปลงพิกัดในช่วงไม่เกิน 2 วันจาก epoch ยังไม่ใช่การพยากรณ์ล่วงหน้าจริง
  ถ้าจะวัดแบบพยากรณ์ ให้ `fetch` ก่อนวันที่ตรวจแล้วรัน `validate` เมื่อมี SP3 ของวันนั้น (ราว 1–2 วันหลังจากนั้น)

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
| 4 | `validate` ผ่านเกณฑ์ภาพรวม §10.1 ทั้ง 4 ระบบ | ผ่าน (ข้อ 1) |
| 5 | 130 ดวง 24 ชม. ทุก 30 วินาที ไม่เกิน 60 วินาที | ผ่าน: 131 ดวง 39.0 วินาที (ข้อ 2) |
| 6 | CLI เดิมได้ CSV รูปแบบเดิม และ test เดิมยังผ่าน | ผ่าน: ข้อ 3 และ test ทั้งชุด 428 ข้อผ่าน |
| 7 | Python standard library ล้วน ไม่แก้ไฟล์ของ GMAT | ผ่าน |
