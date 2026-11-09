# GNSS Predict: พยากรณ์การมองเห็นดาวเทียม GPS จากสถานี THBK ด้วย GMAT

- วันที่: 2026-11-10
- Branch: `feature/gnss-predict` (แตกจาก `main` ที่ c9b78bd, GMAT R2026a)
- สถานะ: รอผู้ใช้ตรวจ spec

## 1. ที่มาและเป้าหมาย

งานพยากรณ์ TEC ที่สถานี THBK (โปรเจกต์ TrainingModel) ต้องรู้เรขาคณิตของดาวเทียมแต่ละดวง
คือมุมเงย มุมทิศ และตำแหน่งจุดตัดชั้นไอโอโนสเฟียร์ (IPP) จึงจะแปลงระหว่าง VTEC กับ STEC ได้
ข้อมูลในอดีตมีคอลัมน์ `Az` และ `El` จากเครื่องรับอยู่แล้ว แต่ช่วงเวลาในอนาคตยังไม่มี

งานนี้สร้างเครื่องมือที่สั่งครั้งเดียวแล้วได้ไฟล์ CSV บอกว่าดาวเทียม GPS ดวงไหนจะมองเห็นได้จาก THBK
ในช่วง 24 ชม. ข้างหน้า พร้อม Az, El, IPP และ mapping factor โดยใช้ GMAT คำนวณวงโคจรและแปลงพิกัด

### เกณฑ์ว่าสำเร็จ

1. คำสั่งเดียว `python3 -m gnss_predict` ได้ CSV ของ 24 ชม. ข้างหน้า ทุก 30 วินาที
2. คอลัมน์ `DAY, Time, PRN, Az, El` ใช้รูปแบบเดียวกับไฟล์ `THBKddd_yy_GPS.csv` จึง join กับข้อมูลเดิมได้ทันที
3. ผ่านการตรวจความแม่นยำกับข้อมูลจริงตามหัวข้อ 11.4
4. ไม่แก้ไฟล์เดิมของ GMAT แม้แต่ไฟล์เดียว ไฟล์ใหม่ทั้งหมดอยู่ใต้ `api-interop/gnss-predict/`

## 2. ขอบเขต

**ทำ**
- เฉพาะ GPS (PRN G01–G32) เพราะไปป์ไลน์ TEC อ่านเฉพาะ PRN ที่ขึ้นต้นด้วย `G`
- พยากรณ์ไปข้างหน้าด้วย TLE ล่าสุดจาก CelesTrak (กลุ่ม `gps-ops`)
- ใช้ shell ไอโอโนสเฟียร์ 400 กม. และ mapping factor สูตรเดียวกับ `t02_5_rebuild_tec.py`

**ไม่ทำ**
- โค้ดฝั่ง TrainingModel ที่นำ CSV ไปใช้ (ต้องทำเป็นงานแยก เพราะ `level_day()` ต้องใช้คอลัมน์ข้อมูลวัด
  `P1, P2, L1, L2` ซึ่งข้อมูลพยากรณ์ไม่มี)
- GNSS ระบบอื่น (GLONASS, Galileo, BeiDou)
- การแสดงผลบน GUI แบบ real-time
- การใช้ SP3 เป็นข้อมูลขาเข้าของการพยากรณ์ (GMAT R2026a ไม่มีตัวอ่าน SP3) SP3 ใช้เฉพาะตอนตรวจความแม่นยำ
  ในหัวข้อ 11.4 และอ่านด้วย Python ไม่ผ่าน GMAT
- การเทียบกับคอลัมน์ `Az`/`El` ของเครื่องรับในไฟล์ THBK (ผู้ใช้เลือกตรวจกับ SP3 อย่างเดียว)
- การตรวจสถานะ healthy ของดาวเทียม (TLE ไม่มีข้อมูลนี้)
- การแก้ C++ ของ GMAT

## 3. ข้อเท็จจริงใน GMAT R2026a ที่ design นี้อาศัย

ตรวจจากโค้ดใน branch นี้แล้ว

| ข้อเท็จจริง | ที่มา |
|---|---|
| propagator `SPICESGP4` อ่าน TLE จาก `Spacecraft.EphemerisName` | `application/samples/Ex_TLE_Propagation.script` |
| ถ้ากำหนด `Spacecraft.Epoch` ไว้ propagator จะเริ่มที่ epoch นั้น ถ้าไม่กำหนดจะใช้ epoch ของ TLE ส่วนค่า `StartEpoch` ของ propagator ถูกละเลย | `plugins/TLEPropagatorPlugin/src/propagator/SPICEPropagator.cpp` บรรทัด 290–297 และ 705–725 |
| `Spacecraft.Id` ใช้เลข NORAD ได้ (จับคู่กับบรรทัด 1 ของ TLE ที่ตำแหน่งที่ 2) | `TLEReader.cpp` |
| แกน `Topocentric` ต้องมี origin เป็น BodyFixedPoint (เช่น GroundStation) และ `HorizonReference` ต้องเป็น `Sphere` หรือ `Ellipsoid` | `src/base/coordsystem/TopocentricAxes.cpp` บรรทัด 170–253 |
| แกน `Topocentric` เป็นแบบ **SEZ**: z คือเส้นตั้งฉากกับทรงรี (geodetic), y = k × z คือทิศตะวันออก, x = y × z คือทิศใต้ | `TopocentricAxes.cpp` บรรทัด 419–437 |
| `GmatConsole --run <script>` รัน script ครั้งเดียวแล้วจบ และมี `--logfile <file>` สำหรับกำหนดไฟล์ log | `src/console/driver.cpp` บรรทัด 69–90 |
| ตัวเลือก CMake: `GMAT_INCLUDE_GUI`, `PLUGIN_TLEPROPAGATOR`, `PLUGIN_STATION`, `PLUGIN_PYTHONINTERFACE`, `PLUGIN_MATLABINTERFACE`, `PLUGIN_EXTERNALFORCEMODEL` | `CMakeLists.txt` บรรทัด 119, `plugins/CMakeLists.txt` บรรทัด 111–136 |
| startup file โหลด TLE plugin จาก `../plugins/thinksys/libTLEPropagator` | `application/bin/gmat_startup_file_mac_linux.txt` บรรทัด 65 |

ยังไม่ได้ยืนยัน: `SPICESGP4` propagate ดาวเทียมหลายดวงในคำสั่ง `Propagate` เดียวได้หรือไม่ (ดูหัวข้อ 12 R1)

## 4. สถาปัตยกรรม

```
CelesTrak gps-ops TLE ──► tle_fetch ──► cache/gps_YYYYMMDDTHHMMZ.tle
                                          │
                     script_gen ◄─────────┘   (ราว 31 ดวง, Epoch = เวลาเริ่ม, step 30 วินาที)
                          │
                          ▼
      run_gmat: GmatConsole --run visibility.script --logfile gmat.log
        GroundStation THBK + CoordinateSystem THBKTopo (Origin=THBK, Axes=Topocentric)
        ReportFile: เวลา UTC และ Gxx.THBKTopo.X/Y/Z ของทุกดวง
                          │
                          ▼
      report: อ่านรายงาน ──► geometry: Az, El, IPP, MF
                          │
                          ▼
      output/thbk_gnss_pred_<YYYYMMDDTHHMMZ>_<H>h.csv  และ  .meta.json
```

GMAT ทำหน้าที่ propagate วงโคจรด้วย SGP4 และแปลงตำแหน่งดาวเทียมเข้าสู่กรอบอ้างอิงของสถานีเท่านั้น
การคำนวณมุมและ IPP อยู่ใน `geometry.py` ซึ่งเป็นฟังก์ชันล้วน ทดสอบได้โดยไม่ต้องรัน GMAT

### โครงสร้างไฟล์

```
api-interop/gnss-predict/
├── .gitignore                ยกเว้น *.md จาก .gitignore หลัก และละเว้น cache/ output/
├── README.md                 วิธี build, วิธีใช้, ตัวอย่างผลลัพธ์
├── docs/
│   └── 2026-11-10-gnss-predict-design.md   (ไฟล์นี้)
├── gnss_predict/
│   ├── __init__.py
│   ├── __main__.py           CLI สำหรับพยากรณ์
│   ├── config.py             ค่าคงที่: พิกัด THBK, Re, shell, step, URL
│   ├── tle_fetch.py          ดาวน์โหลด, cache, อ่าน TLE, จับคู่ PRN ↔ NORAD
│   ├── script_gen.py         สร้าง GMAT script จาก template
│   ├── run_gmat.py           หา GmatConsole และรัน script
│   ├── report.py             อ่านไฟล์รายงานของ GMAT
│   ├── geometry.py           SEZ → Az/El, ECEF → Az/El, IPP, MF
│   ├── sp3.py                ดาวน์โหลดและอ่าน SP3, interpolate ตำแหน่ง (ใช้เฉพาะตอนตรวจ)
│   └── validate.py           เทียบผลพยากรณ์กับตำแหน่งจาก SP3
├── templates/
│   └── thbk_visibility.script.tmpl
└── tests/
    ├── fixtures/             TLE ตัวอย่าง, รายงาน GMAT ตัวอย่าง, script ต้นแบบ
    ├── test_geometry.py
    ├── test_tle_fetch.py
    ├── test_script_gen.py
    ├── test_report.py
    ├── test_sp3.py
    └── test_integration_gmat.py   ข้ามอัตโนมัติถ้าไม่มี GmatConsole
```

ใช้ Python 3.10 ขึ้นไป และใช้แค่ standard library ทั้งตอนรันและตอนทดสอบ (`unittest`)
ทดสอบจริงบน Python 3.14.6 ของเครื่องนี้

## 5. ส่วนประกอบ

### 5.1 `config.py`

| ค่าคงที่ | ค่า | ที่มา |
|---|---|---|
| `THBK_LAT_DEG` | 13.729779 | แปลงจาก `APPROX POSITION XYZ` ใน header RINEX ของ THBK (WGS84) |
| `THBK_LON_DEG` | 100.781151 | เช่นเดียวกัน |
| `THBK_HEIGHT_M` | 6.4 | ความสูงเหนือทรงรี เช่นเดียวกัน |
| `THBK_ECEF_M` | (−1159211.0035, 6087676.9700, 1503957.7161) | `APPROX POSITION XYZ` ใน header RINEX ของ THBK ใช้ตอนตรวจกับ SP3 |
| `GPS_UTC_OFFSET_S` | 18 | GPST − UTC ไม่มี leap second ใหม่ตั้งแต่ 1 ม.ค. 2017 (ตรวจกับ IERS Bulletin C ตอนลงมือ) |
| `CDDIS_PRODUCTS_URL` | `ftp://gdc.cddis.eosdis.nasa.gov/gnss/products` | วิธีเดียวกับ `TrainingModel/src/fetch_cddis_2026.py` |
| `RE_KM` | 6371.0 | เท่ากับ `RE_KM` ใน `t02_5_rebuild_tec.py` |
| `SHELL_KM` | 400.0 | เท่ากับ `SHELL_KM` ใน `t02_5_rebuild_tec.py` |
| `STEP_S` | 30 | เท่ากับ `EPOCH_SEC` ใน `t02_5_rebuild_tec.py` |
| `CELESTRAK_GPS_URL` | `https://celestrak.org/NORAD/elements/gp.php?GROUP=gps-ops&FORMAT=tle` | |
| `TLE_WARN_DAYS` / `TLE_MAX_DAYS` | 7 / 30 | |

### 5.2 `tle_fetch.py`

```python
@dataclass(frozen=True)
class TleEntry:
    prn: int            # 1–32
    norad: str          # เลข NORAD 5 หลัก จากคอลัมน์ 3–7 ของบรรทัด 1
    name: str           # บรรทัดชื่อ เช่น "GPS BIIF-1  (PRN 25)"
    epoch: datetime     # epoch ของ TLE เป็น UTC (timezone-aware)

def fetch_gps_tle(cache_dir: Path, url: str = CELESTRAK_GPS_URL, timeout_s: float = 30) -> Path
def parse_tle_file(path: Path) -> tuple[list[TleEntry], list[str]]   # (รายการที่ใช้ได้, คำเตือน)
def check_tle_age(entries: list[TleEntry], start: datetime,
                  warn_days: float = TLE_WARN_DAYS, max_days: float = TLE_MAX_DAYS) -> list[str]
```

- `fetch_gps_tle` ดาวน์โหลดแล้วบันทึกเป็น `cache/gps_<เวลาดาวน์โหลด UTC>.tle` ถ้าดาวน์โหลดไม่ได้จะคืนไฟล์ล่าสุดใน cache
  พร้อมเตือน ถ้าไม่มี cache เลยจะ raise `TleUnavailableError`
- `parse_tle_file` อ่าน PRN จากชื่อด้วย regex `\(PRN\s*(\d{1,2})\)` ชุดที่อ่าน PRN ไม่ได้, PRN อยู่นอกช่วง 1–32
  หรือ checksum ของบรรทัดผิด จะถูกข้ามพร้อมคำเตือน ถ้า PRN ซ้ำกันให้ใช้ชุดที่ epoch ใหม่กว่า
- `check_tle_age` คิดอายุของ TLE แต่ละดวงเป็นค่ามากกว่าระหว่าง |เวลาเริ่ม − epoch| กับ |เวลาสิ้นสุด − epoch|
  (ใช้ค่าสัมบูรณ์เพราะตอนตรวจความแม่นยำ epoch อาจอยู่หลังเวลาเริ่ม) แล้วใช้ค่ามากที่สุดของทุกดวง
  เกิน 7 วันเตือน เกิน 30 วัน raise `TleTooOldError`

### 5.3 `script_gen.py`

```python
def render_script(entries: list[TleEntry], tle_path: Path, start: datetime, hours: float,
                  step_s: int, report_path: Path) -> str
```

แทนค่าลง `templates/thbk_visibility.script.tmpl` path ทุกตัวใน script เป็น absolute path
เพราะ `GmatConsole` รันโดยใช้ `application/bin` เป็นโฟลเดอร์ทำงาน

```
Create Spacecraft G05;
G05.DateFormat    = UTCGregorian;
G05.Epoch         = '11 Nov 2026 00:00:00.000';
G05.Id            = '48859';
G05.EphemerisName = '/abs/path/cache/gps_20261110T1200Z.tle';
% ... หนึ่งชุดต่อหนึ่งดวง

Create GroundStation THBK;
THBK.CentralBody      = Earth;
THBK.StateType        = Spherical;
THBK.HorizonReference = Ellipsoid;
THBK.Location1        = 13.729779;     % latitude, deg
THBK.Location2        = 100.781151;    % longitude, deg
THBK.Location3        = 0.0064;        % height, km

Create CoordinateSystem THBKTopo;
THBKTopo.Origin = THBK;
THBKTopo.Axes   = Topocentric;

Create Propagator TLEProp;
TLEProp.Type            = SPICESGP4;
TLEProp.InitialStepSize = 30;

Create ReportFile RF;
RF.Filename     = '/abs/path/work/report.txt';
RF.Precision    = 16;
RF.WriteHeaders = true;
RF.FixedWidth   = false;
RF.Delimiter    = ',';
RF.Add          = {G05.UTCGregorian, G05.THBKTopo.X, G05.THBKTopo.Y, G05.THBKTopo.Z, ...};

BeginMissionSequence;
Propagate TLEProp(G05, G07, ...) {G05.ElapsedSecs = 86400};
```

(เลข NORAD `48859` ข้างบนเป็นตัวอย่างรูปแบบ ค่าจริงมาจากไฟล์ TLE)

ถ้า R1 พบว่าสั่ง propagate หลายดวงพร้อมกันไม่ได้ จะใช้รูปแบบสำรอง คือหนึ่ง `ReportFile` และหนึ่ง
`Propagate` ต่อหนึ่งดวง โดยไฟล์รายงานชื่อ `report_Gxx.txt` ส่วนที่เปลี่ยนมีแค่ template กับ `report.py`

### 5.4 `run_gmat.py`

```python
def find_gmat_console(environ: Mapping[str, str] = os.environ) -> Path
def run_script(console: Path, script: Path, log: Path, timeout_s: float = 600) -> None
def gmat_version(console: Path) -> str
```

- `find_gmat_console` ใช้ `GMAT_BIN` ถ้ามี (path ไปยังไฟล์ GmatConsole) ไม่มีจะหา `<repo>/application/bin/GmatConsole`
  ถ้าไม่เจอจะ raise `GmatNotFoundError` พร้อมข้อความบอกวิธีตั้ง `GMAT_BIN`
- `run_script` เรียก `[console, "--run", script, "--logfile", log]` โดยให้ `cwd` เป็นโฟลเดอร์ของ console
  ถือว่าล้มเหลว (raise `GmatRunError` พร้อม 20 บรรทัดสุดท้ายของ log) เมื่อเกิดข้อใดข้อหนึ่งต่อไปนี้:
  exit code ไม่เป็น 0, หมดเวลา หรือ log มีข้อความ `**** ERROR ****`
- `gmat_version` เรียก `--version` เพื่อบันทึกลง meta

### 5.5 `report.py`

```python
@dataclass(frozen=True)
class SezSample:
    t: datetime   # UTC
    prn: int
    s_km: float
    e_km: float
    z_km: float

def read_report(path: Path, prns: list[int]) -> list[SezSample]
def check_epochs(samples: list[SezSample], start: datetime, hours: float, step_s: int) -> None
```

- คอลัมน์เวลาเป็น UTCGregorian เช่น `11 Nov 2026 00:00:00.000` แปลงด้วย `%d %b %Y %H:%M:%S.%f`
- แถวที่เวลาซ้ำกันให้เก็บแถวแรกไว้ (GMAT อาจเขียนจุดสุดท้ายซ้ำตอนถึงเงื่อนไขหยุด)
- `check_epochs` ตรวจว่ามีครบทุก epoch ตั้งแต่ `start` ถึง `start + hours` ทุก `step_s` วินาที
  จำนวนต้องเท่ากับ `hours × 3600 / step_s + 1` ถ้าไม่ตรงจะ raise `ReportError`

### 5.6 `geometry.py`

```python
def sez_to_az_el(s_km: float, e_km: float, z_km: float) -> tuple[float, float]
def ipp(lat_deg: float, lon_deg: float, az_deg: float, el_deg: float,
        re_km: float = RE_KM, shell_km: float = SHELL_KM) -> tuple[float, float]
def mapping_factor(el_deg: float, re_km: float = RE_KM, shell_km: float = SHELL_KM) -> float
def ecef_to_az_el(sat_km: tuple[float, float, float], sta_km: tuple[float, float, float],
                  lat_deg: float, lon_deg: float) -> tuple[float, float]
```

สูตรอยู่ในหัวข้อ 6 `ecef_to_az_el` ใช้เฉพาะตอนตรวจกับ SP3 และไม่ผ่าน GMAT เพื่อให้เป็นการตรวจที่เป็นอิสระ

### 5.7 `__main__.py` (CLI)

```
python3 -m gnss_predict [--start 2026-11-11T00:00Z] [--hours 24] [--step 30]
                        [--min-el 0] [--shell-km 400]
                        [--tle-file PATH] [--cache-dir DIR] [--out-dir DIR] [--keep-work]
```

| ตัวเลือก | ค่าเริ่มต้น | ความหมาย |
|---|---|---|
| `--start` | 00:00 UTC ของวันถัดไป | เวลาเริ่ม ถ้าไม่ระบุ timezone ถือเป็น UTC ถ้าใส่แค่วันที่ถือเป็น 00:00 UTC |
| `--hours` | 24 | ความยาวช่วงพยากรณ์ |
| `--step` | 30 | ระยะห่างของ epoch (วินาที) |
| `--min-el` | 0 | ส่งออกเฉพาะแถวที่ El ≥ ค่านี้ |
| `--tle-file` | ไม่ระบุ | ใช้ไฟล์ TLE นี้แทนการดาวน์โหลด (ใช้ตอนตรวจความแม่นยำและเพื่อรันซ้ำได้ผลเดิม) |
| `--cache-dir` | `api-interop/gnss-predict/cache` | ที่เก็บ TLE |
| `--out-dir` | `api-interop/gnss-predict/output` | ที่เก็บผลลัพธ์ |
| `--keep-work` | ปิด | เก็บ script, รายงาน และ log ของ GMAT ไว้ใน `out-dir/work-<เวลา>/` |

exit code: 0 สำเร็จ, 1 ข้อผิดพลาดที่คาดไว้ (TLE, GMAT, รายงาน), 2 ใส่ตัวเลือกผิด

### 5.8 `sp3.py`

```python
@dataclass(frozen=True)
class Sp3Orbit:
    time_system: str                                  # จาก header ต้องเป็น "GPS"
    epochs: list[datetime]                            # GPST, ห่างกัน 15 นาที
    positions: dict[int, list[tuple[float, float, float] | None]]   # PRN → ตำแหน่ง ECEF (กม.) ต่อ epoch

def fetch_sp3(day: date, cache_dir: Path) -> Path
def read_sp3(path: Path) -> Sp3Orbit                  # อ่านได้ทั้ง .SP3 และ .SP3.gz
def interpolate(orbit: Sp3Orbit, prn: int, t_gpst: datetime) -> tuple[float, float, float] | None
```

- `fetch_sp3` ดึงจาก `CDDIS_PRODUCTS_URL/<GPS week>/` ด้วย `curl --ssl-reqd -u anonymous:anonymous`
  แบบเดียวกับ `fetch_cddis_2026.py` ลองชื่อ `IGS0OPSFIN_<YYYYDDD>0000_01D_15M_ORB.SP3.gz` ก่อน ถ้าไม่มีจึงใช้
  `IGS0OPSRAP_<YYYYDDD>0000_01D_15M_ORB.SP3.gz` ถ้าไม่มีทั้งสองแบบ raise `Sp3UnavailableError` ทุกครั้งต้อง
  list ไดเรกทอรีก่อนดาวน์โหลด ไม่เดาว่าไฟล์มีอยู่
- `read_sp3` อ่านเฉพาะบรรทัดตำแหน่งของ GPS (`PG01` ถึง `PG32`) ตำแหน่งที่เป็น 0.000000 หรือ 999999.999999
  ถือว่าไม่มีข้อมูล ถ้า time system ใน header ไม่ใช่ `GPS` ให้ raise
- `interpolate` ใช้ Lagrange 10 จุด (5 จุดก่อนและ 5 จุดหลัง t) คืน `None` ถ้ามีจุดไม่ครบ 5 จุดในฝั่งใดฝั่งหนึ่ง
  หรือมีจุดใดในหน้าต่างไม่มีข้อมูล ผลคือประเมินได้ประมาณ 01:00–22:45 GPST ของไฟล์รายวัน

### 5.9 `validate.py`

```
python3 -m gnss_predict.validate --tle-file PATH (--day YYYY-MM-DD | --sp3 PATH)
                                 [--min-el 10] [--cache-dir DIR] [--out-dir DIR]
```

1. อ่าน TLE แล้วตรวจว่า epoch ของทุกดวงที่ใช้ห่างจากวันตรวจไม่เกิน 2 วัน ถ้าเกินให้หยุด (exit 1)
2. ใช้ไฟล์ `--sp3` หรือดาวน์โหลดของวัน `--day` ด้วย `fetch_sp3`
3. พยากรณ์ 00:00–24:00 UTC ของวันนั้นด้วย GMAT โดยไม่กรอง El (เทียบเท่า `--min-el -90`)
4. ที่แต่ละ epoch t (UTC) และแต่ละ PRN คำนวณค่าจริงจาก `interpolate(orbit, prn, t + 18 วินาที)` แล้วใช้
   `ecef_to_az_el` กับ `THBK_ECEF_M` แถวที่ interpolate ไม่ได้จะถูกข้าม
5. คำนวณสถิติตามหัวข้อ 11.4 เขียน `validation_<วันที่>.json` และ `.md` ลง `out-dir`
   คืน exit code 0 ถ้าผ่านเกณฑ์ และ 1 ถ้าไม่ผ่าน

## 6. คณิตศาสตร์

ให้ (S, E, Z) คือตำแหน่งดาวเทียมในกรอบ `THBKTopo` (กม.) φ, λ คือละติจูดและลองจิจูดของสถานี

**มุมทิศและมุมเงย**

- Az = atan2(E, −S) แปลงเป็นองศาแล้วจัดให้อยู่ในช่วง [0, 360) วัดจากทิศเหนือตามเข็มนาฬิกา
- El = atan2(Z, √(S² + E²)) เป็นองศา (มุมเงยเทียบกับระนาบสัมผัสทรงรี เพราะแกน z เป็นแนว geodetic)
- ไม่คิด light-time: ดาวเทียมเคลื่อนที่ราว 0.27 กม. ระหว่างที่สัญญาณเดินทาง 0.07 วินาที คิดเป็นมุมไม่ถึง 0.001°

**IPP (thin-shell)** ใช้ Re = 6371 กม., H = 400 กม. ตาม `t02_5_rebuild_tec.py`

- k = Re·cos(El) / (Re + H)
- ψ = π/2 − El − asin(k)  (มุมที่ศูนย์กลางโลกระหว่างสถานีกับ IPP)
- φ_IPP = asin(sin φ · cos ψ + cos φ · sin ψ · cos Az)
- λ_IPP = λ + atan2(sin ψ · sin Az · cos φ, cos ψ − sin φ · sin φ_IPP) แล้วจัดให้อยู่ในช่วง (−180, 180]

**ECEF เป็น Az/El (ใช้ตอนตรวจกับ SP3)** ให้ d = ตำแหน่งดาวเทียม − ตำแหน่งสถานี (ECEF, กม.)

- N = −sin φ cos λ · dx − sin φ sin λ · dy + cos φ · dz
- E = −sin λ · dx + cos λ · dy
- U = cos φ cos λ · dx + cos φ sin λ · dy + sin φ · dz
- Az = atan2(E, N) จัดให้อยู่ใน [0, 360) และ El = atan2(U, √(N² + E²))
- เป็นสูตรเดียวกับ SEZ เมื่อ S = −N และ Z = U

**Mapping factor** สูตรเดียวกับ `mapping()` ใน `t02_5_rebuild_tec.py` คือ VTEC = STEC × MF

- MF = √(1 − k²)

ค่าอ้างอิงสำหรับทดสอบ (Re = 6371, H = 400):

| El | MF | ψ |
|---|---|---|
| 90° | 1.00000 | 0° |
| 30° | 0.57965 | 5.4260° |
| 10° | 0.37598 | 12.0846° |

## 7. รูปแบบผลลัพธ์

**ไฟล์ CSV** `thbk_gnss_pred_<YYYYMMDDTHHMMZ>_<H>h.csv` (เวลาเริ่มเป็น UTC, H คือจำนวนชั่วโมง)

| คอลัมน์ | รูปแบบ | ตัวอย่าง |
|---|---|---|
| `DAY` | `YYYY-MM-DD` (UTC) | `2026-11-11` |
| `Time` | `HH:MM:SS` (UTC) | `00:00:30` |
| `PRN` | `Gnn` | `G05` |
| `Az` | องศา ทศนิยม 3 ตำแหน่ง | `216.752` |
| `El` | องศา ทศนิยม 3 ตำแหน่ง | `78.713` |
| `IPP_Lat` | องศา ทศนิยม 4 ตำแหน่ง | `13.5021` |
| `IPP_Lon` | องศา ทศนิยม 4 ตำแหน่ง | `100.6987` |
| `MF` | ทศนิยม 5 ตำแหน่ง | `0.98512` |

- มีเฉพาะแถวที่ El ≥ `--min-el`
- เรียงตาม `DAY`, `Time`, `PRN`
- encoding UTF-8 ไม่มี BOM ขึ้นบรรทัดด้วย `\n`

**ไฟล์ meta** ชื่อเดียวกันแต่นามสกุล `.meta.json` เก็บข้อมูลที่ต้องใช้ตอนรันซ้ำ:
`start_utc`, `hours`, `step_s`, `min_el`, `shell_km`, `station` (lat, lon, height_m), `tle_file`, `tle_sha256`,
`tle_epoch_min`, `tle_epoch_max`, `prns_included`, `prns_missing`, `warnings`, `gmat_version`, `generated_at_utc`

**การเขียนไฟล์** เขียนลง `<ชื่อ>.tmp` ก่อนแล้วค่อย `os.replace` เพื่อไม่ให้ไปป์ไลน์อ่านไฟล์ที่เขียนไม่เสร็จ

## 8. การจัดการข้อผิดพลาด

| กรณี | วิธีจัดการ |
|---|---|
| ดาวน์โหลด TLE ไม่ได้ | ใช้ไฟล์ล่าสุดใน cache พร้อมเตือน ไม่มี cache ให้หยุด (exit 1) |
| TLE อายุเกิน 7 วันนับจากเวลาเริ่ม | เตือน และบันทึกลง meta |
| TLE อายุเกิน 30 วัน | หยุด (exit 1) |
| ชุด TLE ที่อ่าน PRN ไม่ได้หรือ checksum ผิด | ข้ามดวงนั้น และบันทึกลง `prns_missing` กับ `warnings` |
| ไม่มี TLE ที่ใช้ได้เลย | หยุด (exit 1) |
| หา GmatConsole ไม่เจอ | หยุด และบอกวิธีตั้ง `GMAT_BIN` |
| GMAT exit code ไม่เป็น 0, หมดเวลา หรือ log มี `**** ERROR ****` | หยุด แสดง log 20 บรรทัดสุดท้าย และเก็บโฟลเดอร์ work ไว้แม้ไม่ได้ใส่ `--keep-work` |
| ไม่มีไฟล์รายงานหรือจำนวน epoch ไม่ครบ | หยุด และเก็บโฟลเดอร์ work ไว้ |

## 9. การ build GMAT บน macOS (arm64)

เครื่องที่ใช้: macOS arm64, CMake 4.4.0, Xcode, Python 3.14.6 (`CMAKE_MINIMUM_REQUIRED` ของ GMAT คือ 3.19)

1. `python3 depends/configure.py` ดาวน์โหลดและ build CSPICE รุ่น `MacM1_OSX_clang`, Xerces และ wxWidgets
   สคริปต์นี้ build wxWidgets ทุกครั้งแม้จะไม่ใช้ GUI ใช้เวลานานแต่ทำครั้งเดียว และไม่แก้สคริปต์นี้
2. ```
   cmake -S . -B build/console -DCMAKE_BUILD_TYPE=Release \
         -DGMAT_INCLUDE_GUI=OFF \
         -DPLUGIN_PYTHONINTERFACE=OFF -DPLUGIN_MATLABINTERFACE=OFF -DPLUGIN_EXTERNALFORCEMODEL=OFF
   cmake --build build/console -j
   ```
   ไฟล์ที่ได้จะอยู่ใน `application/bin` และ `application/plugins` (`GMAT_BUILDOUTPUT_DIRECTORY`)
3. ทดสอบด้วยตัวอย่างที่มีอยู่แล้ว: `cd application/bin && ./GmatConsole --run ../samples/Ex_TLE_Propagation.script`
   ต้องได้ไฟล์ `Ex_TLE_Propagation.txt` ใน `application/output`
4. ห้าม commit ไฟล์ที่ build หรือดาวน์โหลดมา `/build` กับ `*.dylib` ถูกละเว้นอยู่แล้ว
   ส่วน `application/bin/GmatConsole`, `depends/cspice/`, `depends/xerces/`, `depends/wxWidgets/` ให้เพิ่มใน
   `.git/info/exclude` (ไฟล์นี้อยู่เฉพาะเครื่อง ไม่ถูก commit จึงไม่แก้ `.gitignore` หลักของ GMAT)

**ถ้า build ไม่ผ่านภายใน 2 ชั่วโมงของการแก้ปัญหา:** หยุดและปรึกษาผู้ใช้ ทางสำรองคือดาวน์โหลด GMAT R2026a
สำหรับ macOS ที่ build แล้วจาก SourceForge แล้วตั้ง `GMAT_BIN` ไปที่ `GmatConsole` ในชุดนั้น
(ต้องตรวจตอนดาวน์โหลดว่าชุดนั้นมี `GmatConsole` และ TLE plugin)

## 10. Git

- งานทั้งหมดอยู่บน `feature/gnss-predict` และแตะเฉพาะ `api-interop/gnss-predict/`
- `.gitignore` หลักของ GMAT ละเว้น `*.md` ทั้ง repo จึงเพิ่ม `api-interop/gnss-predict/.gitignore` ที่มี
  `!*.md` รวมทั้ง `cache/` และ `output/` ส่วนไฟล์ spec นี้ commit ไปก่อนด้วย `git add -f`
- ไม่ commit ข้อมูลของ TrainingModel และไม่ commit ไฟล์ TLE หรือ SP3 ที่ดาวน์โหลดมา ยกเว้น fixture ขนาดเล็กใน `tests/fixtures/`

## 11. การทดสอบ

รันด้วย `cd api-interop/gnss-predict && python3 -m unittest discover -s tests -v`

### 11.1 `test_geometry.py` (ไม่ต้องใช้ GMAT)

- (S, E, Z) = (0, 0, 20000) → El = 90°
- (−20000, 0, 0) (ทิศเหนือบนขอบฟ้า) → Az = 0°, El = 0°
- (0, 20000, 0) → Az = 90°; (20000, 0, 0) → Az = 180°; (0, −20000, 0) → Az = 270°
- Az อยู่ในช่วง [0, 360) เสมอ
- `mapping_factor` ตรงกับตารางในหัวข้อ 6 ที่ทศนิยม 5 ตำแหน่ง และตรงกับสูตร `mapping()` ใน `t02_5_rebuild_tec.py`
- `ipp` ที่ El = 90° ได้ตำแหน่งสถานี
- `ipp` ที่ Az = 0°, El = 30° ได้ละติจูด = φ + 5.4260° และลองจิจูดเท่าเดิม
- `ipp` ที่ Az = 90° ได้ลองจิจูดมากกว่าสถานี ส่วนที่ Az = 270° ได้ลองจิจูดน้อยกว่าสถานี
- `ipp` ที่ลองจิจูดใกล้ 180° ได้ผลอยู่ในช่วง (−180, 180]
- `ecef_to_az_el`: สถานีที่ (0°, 0°) บนผิวโลก ดาวเทียมอยู่บนแกน x ไกลออกไป → El = 90°
  และดาวเทียมที่เลื่อนไปทาง +z (ทิศเหนือ) → Az = 0°
- `ecef_to_az_el` กับ `sez_to_az_el` ได้ค่าเท่ากันเมื่อแปลงเวกเตอร์เดียวกันด้วย S = −N, Z = U

### 11.2 `test_tle_fetch.py`, `test_script_gen.py`, `test_report.py`, `test_sp3.py` (ไม่ต้องใช้เน็ตหรือ GMAT)

- อ่าน `fixtures/gps_sample.tle` (TLE จริงจาก CelesTrak 3 ชุด และชุดเสียที่ตั้งใจใส่ 2 ชุด) ได้ PRN, เลข NORAD และ epoch
  ถูกต้อง ส่วนชุดเสียถูกข้ามพร้อมคำเตือน
- PRN ซ้ำ: เลือกชุดที่ epoch ใหม่กว่า
- `check_tle_age` เตือนที่ 7 วัน และ raise ที่ 30 วัน
- `fetch_gps_tle` ที่ดาวน์โหลดไม่ได้ (จำลองด้วย URL ที่ใช้ไม่ได้) จะคืนไฟล์ใน cache และ raise ถ้า cache ว่าง
- `render_script` กับ fixture 2 ดวงได้ผลตรงกับ `fixtures/expected_2sat.script` ทุกตัวอักษร
- `read_report` กับ `fixtures/report_2sat.txt` อ่านค่าได้ถูก ตัดเวลาซ้ำออก และ `check_epochs` raise เมื่อขาด epoch
- `read_sp3` กับ `fixtures/sample.sp3` (SP3 จริงที่ตัดเหลือ 2 ดวง 24 epoch) อ่าน epoch, PRN และตำแหน่งได้ถูก
  ค่า 0.000000 กลายเป็น `None` และไฟล์ที่ time system ไม่ใช่ `GPS` ถูก raise
- `interpolate` ที่ epoch ตรงกับข้อมูลได้ค่าเดิมทุกตำแหน่ง ส่วนระหว่าง epoch ใช้ข้อมูลทุก 30 นาทีของ fixture
  ทำนายจุดที่ตัดออกไป (จุด 15 นาที) ได้คลาดไม่เกิน 1 ม. และคืน `None` เมื่ออยู่ใกล้ขอบไฟล์

### 11.3 `test_integration_gmat.py` (ข้ามอัตโนมัติถ้าหา GmatConsole ไม่เจอ)

- พยากรณ์ 1 ชม. ด้วย fixture 2 ดวงและ `--min-el -90` ต้องได้ 121 แถวต่อดวง ครบทุกคอลัมน์ และค่าอยู่ในช่วงที่เป็นไปได้
- ระยะ √(S² + E² + Z²) ของดาวเทียม GPS ต้องอยู่ระหว่าง 19,000 ถึง 27,000 กม.

### 11.4 การตรวจความแม่นยำกับข้อมูลจริง (acceptance)

ค่าอ้างอิงคือ Az/El ที่คำนวณจากวงโคจรละเอียด SP3 ของ IGS (ความแม่นยำระดับเซนติเมตร) ผ่าน `sp3.py`
และ `ecef_to_az_el` โดยไม่ผ่าน GMAT ใช้ `validate.py` (หัวข้อ 5.9)

**เงื่อนไขของ TLE:** epoch ของ TLE ต้องห่างจากวันตรวจไม่เกิน 2 วัน ให้ตรงกับการใช้งานจริงที่พยากรณ์ด้วย TLE
อายุไม่เกินราว 1–2 วัน วิธีทำ: ดึง TLE ด้วย `fetch_gps_tle` (เก็บไว้ใน cache) แล้วตรวจกับวันล่าสุดที่ CDDIS
มี SP3 แบบ rapid ซึ่งช้ากว่าเวลาจริงราว 1–2 วัน ไม่ต้องใช้บัญชีใด ๆ

**เกณฑ์ผ่าน** คิดจากทุกแถวที่มีทั้งค่าพยากรณ์และค่าจาก SP3 และ El จาก SP3 ≥ 10°

| ค่า | เกณฑ์ |
|---|---|
| ค่ากลางของ \|ΔEl\| | ≤ 0.05° |
| percentile ที่ 99 ของ \|ΔEl\| | ≤ 0.2° |
| ค่ากลางของ \|ΔAz\| (เฉพาะ El < 80°) | ≤ 0.1° |
| percentile ที่ 99 ของ \|ΔAz\| (เฉพาะ El < 80°) | ≤ 0.5° |
| PRN ในผลพยากรณ์ที่ไม่มีใน SP3 | ต้องไม่มี (ถ้ามีแปลว่าจับคู่ PRN ผิด) |
| PRN ใน SP3 ที่ไม่มีในผลพยากรณ์ | รายงานอย่างเดียว (SP3 รวมดาวเทียมที่ไม่อยู่ในกลุ่ม gps-ops ด้วย) |

ΔAz คิดแบบวนรอบ: ((Az_pred − Az_ref + 180) mod 360) − 180

รายงานแยกรายดวงทุกครั้ง ถ้าไม่ผ่าน ห้ามตัดดวงที่คลาดออกเพื่อให้ผ่าน ต้องหาสาเหตุก่อน
(เช่น ดาวเทียมจุดเครื่องยนต์ปรับวงโคจร หรือ PRN ถูกสลับไปใช้กับดาวเทียมดวงอื่น)

ค่า `TLE_WARN_DAYS` = 7 และ `TLE_MAX_DAYS` = 30 เป็นค่าเริ่มต้นที่ยังไม่ได้วัด การตรวจนี้ยืนยันความแม่นยำเฉพาะ
TLE ที่อายุไม่เกิน 2 วัน

## 12. ความเสี่ยง

| รหัส | ความเสี่ยง | วิธีรับมือ |
|---|---|---|
| R1 | `SPICESGP4` อาจ propagate หลายดวงในคำสั่งเดียวไม่ได้ | ทดสอบเป็นงานแรกหลัง build ผ่าน ถ้าไม่ได้ใช้รูปแบบสำรองในหัวข้อ 5.3 |
| R2 | build GMAT บน arm64 กับ Xcode และ CMake รุ่นใหม่อาจไม่ผ่าน | จำกัดเวลา 2 ชั่วโมง แล้วใช้ชุดที่ build แล้วตามหัวข้อ 9 |
| R3 | CDDIS ปิด FTPS แบบ anonymous หรือเปลี่ยนชื่อไฟล์/โฟลเดอร์ของ SP3 | `fetch_sp3` list ไดเรกทอรีก่อนเสมอ ถ้าดึงไม่ได้ให้ดาวน์โหลด SP3 เองแล้วส่งผ่าน `--sp3` |
| R4 | ข้อความ error ใน log ของ GMAT อาจไม่ใช่ `**** ERROR ****` ทุกกรณี | การตรวจจำนวน epoch ในรายงานจะจับความล้มเหลวที่หลุดไปได้ |
| R5 | startup file เรียก plugin ที่ไม่ได้ build (MATLAB, Python, proprietary) | ตรวจตอนรัน `Ex_TLE_Propagation.script` ว่าเป็นแค่คำเตือนและรันต่อได้ |
| R6 | เวลา GPST กับ UTC ต่างกันไม่ใช่ 18 วินาที (มี leap second ใหม่) | ตรวจกับ IERS Bulletin C ตอนลงมือ ถ้าใช้ค่าผิด 1 วินาที ดาวเทียมจะคลาดราว 3.9 กม. คิดเป็นมุมราว 0.01° ซึ่งการตรวจจับได้ยาก จึงต้องตรวจจากแหล่งข้อมูล |
