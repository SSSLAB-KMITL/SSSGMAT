# GNSS Studio งานย่อยที่ 1: Engine หลายระบบ

- วันที่: 2026-11-11
- Branch: `feature/gnss-studio-engine` (แตกจาก `feature/gnss-predict` ที่ 9d9ba7d)
- สถานะ: รอผู้ใช้ตรวจ spec
- Design ภาพรวม: [2026-11-11-gnss-studio-design.md](2026-11-11-gnss-studio-design.md) (หัวข้อที่อ้างแบบ "ภาพรวม §n" หมายถึงเอกสารนี้)

## 1. เป้าหมาย

ขยาย `gnss_predict` จาก GPS อย่างเดียวให้คำนวณ GPS, GLONASS, Galileo, BeiDou ได้ และเขียนไฟล์ผลลัพธ์ตามภาพรวม §7
เพื่อให้ server (งานย่อยที่ 2) และหน้าเว็บ (งานย่อยที่ 3–4) ใช้ได้โดยไม่ต้องคำนวณเรขาคณิตเอง

### เกณฑ์ว่าสำเร็จ

1. `python3 -m gnss_predict.studio fetch` ได้ชุดข้อมูลวงโคจรใน `data/orbits/<เวลา>/` ครบ 4 ระบบ พร้อม IGS metadata และ broadcast
2. `propagate` ได้ `predicted.sp3`, `scene.czml`, `manifest.json` ของทุกดวงใน scenario
3. `analyze` ได้ `aer.csv`, `intervals.json`, `dop.csv`, `access.czml`, `legacy_gps.csv` ของ Facility ที่ระบุ
4. `validate` ผ่านเกณฑ์ความแม่นยำในภาพรวม §10.1 ทั้ง 4 ระบบ
5. 130 ดวง 24 ชม. ทุก 30 วินาที `propagate` เสร็จภายใน 60 วินาทีบนเครื่องพัฒนา (macOS arm64)
6. CLI เดิม `python3 -m gnss_predict` ได้ CSV รูปแบบเดิม และ test เดิม 83 ข้อยังผ่าน ยกเว้น test ดาวน์โหลด 5 ข้อใน
   `test_tle_fetch.py` (`test_success_writes_timestamped_cache` ถึง `test_fetch_non_tle_body_falls_back`) ที่ต้องเปลี่ยนข้อมูลจำลองจาก TLE เป็น OMM
   โดยพฤติกรรมที่ตรวจยังเหมือนเดิม
7. ยังใช้ Python standard library ล้วน ไม่แก้ไฟล์ของ GMAT

## 2. ขอบเขต

**ทำ**
- ดึงข้อมูลตามภาพรวม §7.4 พร้อมทำตามกติกาของ CelesTrak
- จับคู่ PRN ด้วย IGS metadata, ติดธงสถานะดาวตามหัวข้อ 6
- Propagate ด้วย GMAT `SPICESGP4` ในกรอบ EarthFixed, เขียน SP3-d และ CZML
- AER, IPP/MF, ช่วง access, Global Statistics, DOP, จำนวนดาวที่มองเห็นแยกระบบ
- ตรวจความแม่นยำกับ SP3 หลายระบบและ broadcast (G/E/C) แยกรายดวง
- เปลี่ยน CLI เดิมให้ดึงข้อมูลเป็น OMM โดยผลลัพธ์รูปแบบเดิม

**ไม่ทำ** (อยู่ในงานย่อยอื่นหรือรุ่นถัดไป)
- คิว job, API, การตรวจย้อนหลังอัตโนมัติตามเวลา (งานย่อยที่ 2 เรียก `validate` ของ engine)
- ช่อง `graphics` ใน `scenario.json` (engine ข้าม)
- ตำแหน่ง GLONASS จาก broadcast, Az-El Mask, Coverage

## 3. ข้อเท็จจริงที่ design นี้อาศัย

| ข้อเท็จจริง | ที่มา |
|---|---|
| `TLEReader` หาดาวจาก `Spacecraft.Id` ได้ 2 แบบ: บรรทัดที่ขึ้นต้นด้วย Id (บรรทัดชื่อ) หรือ Id อยู่ที่ตำแหน่ง 2 ของบรรทัด 1 แล้วส่งบรรทัด 1–2 ให้ `getelm_c` ของ CSPICE | `plugins/TLEPropagatorPlugin/src/propagator/TLEReader.cpp` บรรทัด 46–151 |
| GMAT รับบรรทัด TLE ที่ช่องหมายเลขแคตตาล็อกเป็น Alpha-5 (`A0744`) หรือเลขแทนอื่น ได้ผลเท่ากันทุกจุด | ทดลองกับ COSMOS 2620 เมื่อ 2026-11-11 (โค้ดทดลอง ไม่อยู่ใน repo) |
| ตำแหน่ง EarthFixed จาก GMAT + Az/El ใน Python ผ่านเกณฑ์กับ SP3 ทั้ง 4 ระบบ | ภาพรวม §10.1 |
| แปลง OMM JSON ของ CelesTrak เป็นบรรทัด TLE ได้ตรงกับ TLE ของ CelesTrak ทุกตัวอักษร 144/144 ดวง โดยต้อง**ตัด**ความเยื้องศูนย์กลางเหลือ 7 หลัก (OMM ให้ 8 หลัก) | ทดลองเมื่อ 2026-11-11 |
| CelesTrak: เลข 5 หลักหมดเมื่อ 2026-07-11, ดาวเลข 6 หลักไม่มี TLE, `FORMAT` ตั้งต้นเป็น CSV ตั้งแต่ 2026-05-09, ดาวน์โหลดซ้ำก่อนรอบอัปเดตได้ 403, error เกิน 50 ครั้งใน 2 ชม. โดนบล็อก | https://celestrak.org/NORAD/documentation/gp-data-formats.php |
| IGS metadata มีส่วน `SATELLITE/IDENTIFIER` (SVN, COSPAR, SatCat, Block) และ `SATELLITE/PRN` (SVN, valid_from, valid_to แบบ `YYYY:DOY:SSSSS`, `0000:000:00000` = ไม่มีวันสิ้นสุด, PRN) | `igs_satellite_metadata.snx` |
| PRN ของ BeiDou ถูกจัดใหม่ในเดือนเมษายน 2026 ชื่อดาวใน CelesTrak ไม่ตรง เช่น "BEIDOU-3 G4 (C62)" (56564) คือ C01 | IGS metadata, ตรวจเมื่อ 2026-11-09 |
| BDS: BDT = GPST − 14 วินาที, GM 3.986004418e14, ωe 7.292115e-5, ดาว GEO หมุนด้วย Rz(ωe·tk)·Rx(−5°). Galileo: GM 3.986004418e14, ωe 7.2921151467e-5 | ICD ของแต่ละระบบ ตรวจกับ SP3 แล้ว: BDS ค่ากลาง 1.21 ม. สูงสุด 3.03 ม., Galileo ค่ากลาง 0.86 ม. สูงสุด 6.53 ม. |
| RTKLIB `dops()` ใช้เมทริกซ์เรขาคณิต 4 คอลัมน์ (คอลัมน์นาฬิกาเดียว) กับทุกระบบ | `src/rtkcmn.c` ของ RTKLIB |
| MF และ IPP ใช้ Re 6371 กม. shell 400 กม. เหมือน `t02_5_rebuild_tec.py` | TrainingModel บรรทัด 49–50 และ 77–78 |

## 4. โครงสร้างไฟล์

```
gnss_predict/
  config.py        แก้: ค่าคงที่ใหม่ (หัวข้อ 5.1)
  errors.py        แก้: ข้อผิดพลาดใหม่ (หัวข้อ 9)
  geometry.py      แก้: เพิ่ม geodetic_to_ecef, ecef_to_aer
  sp3.py           แก้: อ่านทุกระบบด้วย PRN แบบข้อความ, เขียน SP3-d
  tle_fetch.py     แก้: ดึง gps-ops เป็น OMM แล้วแปลงเป็น TLE (CLI เดิม)
  omm.py           ใหม่: ดึง/อ่าน OMM, แปลงเป็นบรรทัด TLE, กติกา CelesTrak
  igs_meta.py      ใหม่: ดึง/อ่าน IGS metadata, จับคู่ NORAD → PRN
  brdc.py          ใหม่: ดึง/อ่าน RINEX 3 nav, สถานะ broadcast, ตำแหน่ง G/E/C
  catalog.py       ใหม่: รวมแหล่งข้อมูลเป็นรายชื่อดาวพร้อมธง
  scenario.py      ใหม่: อ่านและตรวจช่องของ scenario.json ที่ engine ใช้
  propagate.py     ใหม่: GMAT EarthFixed หลายดวง
  czml.py          ใหม่: scene.czml, access.czml
  analyze.py       ใหม่: AER, IPP/MF, ช่วง access, Global Statistics, legacy CSV
  dop.py           ใหม่: DOP นาฬิกาเดียว
  bundle.py        ใหม่: hash ข้อมูลตั้งต้น, เขียนโฟลเดอร์แบบ atomic, manifest
  studio.py        ใหม่: CLI python3 -m gnss_predict.studio
  studio_validate.py ใหม่: ตรวจความแม่นยำหลายระบบ
tests/
  test_omm.py test_igs_meta.py test_brdc.py test_catalog.py test_scenario.py
  test_propagate.py test_czml.py test_analyze.py test_dop.py test_bundle.py
  test_studio_validate.py test_studio_cli.py test_integration_studio.py
  fixtures/        OMM + TLE คู่กัน, IGS metadata ย่อ, RINEX nav ย่อ, SP3 ย่อ, ค่า DOP จาก RTKLIB
```

ไฟล์เดิม `predict.py`, `script_gen.py`, `report.py`, `validate.py`, `run_gmat.py`, `gmat_time.py` และ template ไม่เปลี่ยนพฤติกรรม

## 5. ส่วนประกอบ

### 5.1 `config.py` (เพิ่ม)

| ชื่อ | ค่า |
|---|---|
| `CELESTRAK_GP_URL` | `"https://celestrak.org/NORAD/elements/gp.php?GROUP={group}&FORMAT=json"` |
| `GNSS_GROUPS` | `{"G": "gps-ops", "R": "glo-ops", "E": "galileo", "C": "beidou"}` |
| `CELESTRAK_MIN_INTERVAL_S` | `7200` |
| `IGS_META_URL` | `"https://files.igs.org/pub/station/general/igs_satellite_metadata.snx"` |
| `CDDIS_BRDC_URL` | `"ftp://gdc.cddis.eosdis.nasa.gov/gnss/data/daily/{year}/brdc/"` |
| `AGE_OK_DAYS` | `2.0` (วัดแล้ว) |
| `AGE_SHOWN_MAX_DAYS` | `7.0` (ค่าที่ตั้ง ยังไม่ได้วัด) |
| `BRDC_MAX_TK_S` | `14400` (ใช้ ephemeris ที่ \|tk\| ≤ 4 ชม.) |
| `CZML_STEP_S`, `CZML_LAGRANGE_DEGREE` | `300`, `7` |
| `DATA_DIR` | `Path(os.environ.get("GNSS_STUDIO_DATA", PKG_ROOT / "data"))` |
| `ENGINE_VERSION` | `"0.2.0"` เพิ่มทุกครั้งที่การคำนวณเปลี่ยน ใช้ใน hash และ manifest |

### 5.2 `omm.py`

```python
@dataclass(frozen=True)
class OmmRecord:
    norad: int; name: str; object_id: str; epoch: datetime   # epoch เป็น UTC
    raw: dict                                                # ทุกช่องจาก JSON

def fetch_group(group: str, dest_dir: Path, state_file: Path, now: datetime,
                opener=urlopen, timeout_s: float = 30) -> tuple[Path, list[Message]]
def read_omm(path: Path) -> list[OmmRecord]
def catalog_field(norad: int) -> str                         # 5 หลัก หรือ Alpha-5
def to_tle_lines(rec: OmmRecord) -> tuple[str, str]
```

- `fetch_group` บันทึกเวลาดาวน์โหลดสำเร็จล่าสุดของแต่ละกลุ่มใน `state_file` (JSON) ถ้ายังไม่ครบ `CELESTRAK_MIN_INTERVAL_S` ไม่ส่ง request และคืนไฟล์ล่าสุดพร้อม Message ระดับ info
- ได้ HTTP 403 หรือ 404, ต่อเน็ตไม่ได้ หรือข้อมูลไม่ใช่ JSON array ของ OMM: ไม่ลองซ้ำในการเรียกครั้งนั้น คืนไฟล์ล่าสุดพร้อมคำเตือน `ORBIT_DOWNLOAD_FAILED` ถ้าไม่มีไฟล์เลย raise `OrbitUnavailableError`
- `catalog_field`: ≤ 99999 เป็นเลข 5 หลักเติม 0 นำหน้า, 100000–339999 เป็น Alpha-5 (ตัวอักษร A–Z ข้าม I และ O แทน 10–33 ตามด้วยเลข 4 หลัก), มากกว่านั้น raise `ValueError`
- `to_tle_lines` จัดคอลัมน์ตามรูปแบบ TLE มาตรฐาน ความเยื้องศูนย์กลาง**ตัด**เหลือ 7 หลัก, `MEAN_MOTION_DDOT` และ `BSTAR` ในรูปแบบทศนิยมสมมติ (`" 12345-3"`), คำนวณ checksum ใหม่

### 5.3 `igs_meta.py`

```python
@dataclass(frozen=True)
class SatIdentity:
    prn: str; svn: str; norad: int; cospar: str; block: str

class IgsMetadata:
    def identity_at(self, norad: int, t: datetime) -> SatIdentity | None
    def prn_changes(self, norad: int, start: datetime, stop: datetime) -> list[tuple[datetime, str]]

def read_metadata(path: Path) -> IgsMetadata
def fetch_metadata(dest_dir: Path, now: datetime, opener=urlopen) -> tuple[Path, list[Message]]
```

- ช่วงใช้งานของ PRN คือ `valid_from ≤ t < valid_to` และ `0000:000:00000` คือไม่มีวันสิ้นสุด
- ดาวที่ SatCat ไม่ใช่ตัวเลขข้าม
- `fetch_metadata` ดาวน์โหลดใหม่เมื่อไฟล์ล่าสุดอายุเกิน 24 ชม. ถ้าไม่สำเร็จใช้ไฟล์เดิมพร้อมคำเตือน `IGS_META_STALE` ถ้าไม่มีไฟล์ raise `IgsMetadataUnavailableError`

### 5.4 `brdc.py`

```python
@dataclass(frozen=True)
class BroadcastStatus:
    prn: str; last_toc: datetime; healthy: bool

def fetch_brdc(day: date, dest_dir: Path) -> Path            # curl FTPS anonymous แบบเดียวกับ sp3.fetch_sp3
def read_nav(path: Path) -> Nav                              # RINEX 3.04 mixed: G, R, E, C
def broadcast_status(nav: Nav) -> dict[str, BroadcastStatus]
def position_km(nav: Nav, prn: str, t_gpst: datetime) -> tuple[float, float, float] | None
```

- `read_nav` เก็บทุกระบบไว้ตรวจว่ามี broadcast และค่า health แต่ `position_km` คำนวณเฉพาะ G, E, C
- health ตาม RINEX 3.04: G, E, C อ่านช่องที่ 2 ของ BROADCAST ORBIT - 6 (G: SV health, E: SV health, C: SatH1) ส่วน R อ่านช่องที่ 4 ของ BROADCAST ORBIT - 1 (health, 0 = OK) ค่า ≠ 0 ถือว่า `healthy = False`
- `position_km` เลือก ephemeris ที่ |tk| น้อยที่สุด โดย tk คิดจากเวลาสัมบูรณ์ (week × 604800 + toe) ไม่ห่อค่าเข้า ±302400 วินาที
  ถ้า |tk| > `BRDC_MAX_TK_S` คืน `None` สูตรอยู่ในหัวข้อ 7.4

### 5.5 `catalog.py`

```python
@dataclass(frozen=True)
class CatalogSatellite:
    prn: str; system: str; svn: str; norad: int; block: str
    celestrak_name: str; omm_epoch: datetime; age_days: float
    flags: frozenset[str]; tle_lines: tuple[str, str]

@dataclass
class Catalog:
    satellites: list[CatalogSatellite]
    unmapped: list[dict]            # norad, celestrak_name, object_id, เหตุผล
    messages: list[Message]

def build_catalog(snapshot_dir: Path, period: tuple[datetime, datetime],
                  systems: set[str]) -> Catalog
```

- อ่าน OMM ของทุกกลุ่มใน `systems`, IGS metadata และ broadcast (ถ้ามี) จาก `snapshot_dir`
- PRN และ SVN มาจาก `identity_at(norad, start)` เท่านั้น และระบบของดาวคือตัวอักษรแรกของ PRN
- ถ้าดาวสองดวงอ้าง PRN เดียวกัน เลือกดวงที่ epoch ใหม่กว่า อีกดวงไป `unmapped` เหตุผล `DUPLICATE_PRN`
- ธงคำนวณตามหัวข้อ 6

### 5.6 `scenario.py`

```python
@dataclass(frozen=True)
class Facility:
    name: str; lat_deg: float; lon_deg: float; alt_m: float; min_el_deg: float

@dataclass(frozen=True)
class EngineScenario:
    name: str; start: datetime; stop: datetime; step_s: int; orbit_snapshot: str
    shell_km: float; show_too_old: bool; show_no_broadcast: bool
    facilities: list[Facility]; satellites: list[tuple[str, int]]   # (name, norad)

def load_scenario(path: Path) -> EngineScenario
```

ตรวจ `format == "gnss-studio-scenario/1"`, `start < stop`, ช่วงไม่เกิน 7 วัน, start และ stop เป็นวินาทีเต็มและ (stop − start) หารด้วย `step_s` ลงตัว,
`step_s` อยู่ใน 1–3600 และหาร 86400 ลงตัว (ไม่มีช่อง `step_s` ใช้ 30), ละติจูดและลองจิจูดอยู่ในช่วง,
ชื่อ object ตรง `^[A-Za-z0-9_-]{1,32}$` และไม่ซ้ำกันแบบไม่แยกตัวพิมพ์เล็กใหญ่, `orbit_snapshot` เป็นชื่อที่ปลอดภัยแบบเดียวกัน (ใช้เป็นชื่อโฟลเดอร์)
ผิดข้อใดให้ raise `ScenarioError` ระบุ path ของช่อง เช่น `objects[0].position.lat_deg`

### 5.7 `propagate.py`

```python
@dataclass
class Ephemeris:
    times_utc: list[datetime]
    positions_km: dict[str, list[tuple[float, float, float]]]   # PRN → ตำแหน่งต่อเวลา

def render_ecef_script(sats: list[CatalogSatellite], tle_path: Path, start: datetime,
                       stop: datetime, step_s: int, report_path: Path) -> str
def parse_ecef_report(path: Path, prns: list[str]) -> Ephemeris
def propagate(sats: list[CatalogSatellite], start: datetime, stop: datetime, step_s: int,
              work_dir: Path, console: Path, timeout_s: float = 900) -> Ephemeris
```

- เขียนไฟล์ TLE ของรอบนี้ โดยบรรทัดชื่อของแต่ละดวงคือ PRN และตั้ง `Spacecraft.Id` เป็น PRN (GMAT หาดาวจากบรรทัดชื่อ ไม่ขึ้นกับหมายเลขแคตตาล็อก)
- Spacecraft ชื่อ PRN, `DateFormat = UTCGregorian`, `Epoch` = เวลาเริ่ม, `SPICESGP4`, `InitialStepSize = step_s`
- ReportFile ของ `<PRN>.UTCGregorian` ของดวงแรก และ `<PRN>.EarthFixed.X/Y/Z` ทุกดวง, `Precision = 16`, `Delimiter = ','`
- ใช้ `run_gmat.run_script` เดิม
- `parse_ecef_report` ปัดเวลาเป็นวินาที ตรวจว่าเวลาเรียงครบตาม grid ถ้าคอลัมน์ของดวงใดไม่มีหรือไม่เป็นตัวเลข ตัดดวงนั้นพร้อมคำเตือน `SAT_MISSING_FROM_GMAT`

### 5.8 `sp3.py` (เพิ่ม)

```python
def read_sp3_all(path: Path) -> dict[str, dict[datetime, tuple[float, float, float]]]   # เวลาเป็น GPST
def write_sp3(eph: Ephemeris, path: Path, agency: str = "GSTD") -> None
```

- `read_sp3_all` อ่านทุกระบบ ข้ามค่า 0 และ 999999 รองรับไฟล์ .gz
- `write_sp3` เขียน SP3-d: เวลาเป็น GPS time (UTC + 18 วินาที), orbit type `EXT`, coordinate system `ITRF`, data used `TLE`, บรรทัด `+` ละ 17 ดวง, ความละเอียด 1 มม.
- `read_sp3` และ `interpolate` เดิมของ GPS คงไว้ให้ CLI เดิมใช้

### 5.9 `czml.py`

```python
def satellites_czml(eph: Ephemeris, step_s: int = CZML_STEP_S) -> list[dict]
def access_czml(facility: Facility, intervals: dict[str, list[Interval]],
                period: tuple[datetime, datetime]) -> list[dict]
```

- packet แรกของ `scene.czml` คือ `{"id": "document", "version": "1.0", "clock": {...}}` ช่วงเวลาตาม analysis period
- `access.czml` ขึ้นต้นด้วย packet document ของตัวเอง `{"id": "document", "version": "1.0"}` (ไม่มี clock) เพราะ CZML ทุกไฟล์ต้องขึ้นต้นด้วย document
- ดาว: `id = "sat/<PRN>"`, `availability` = ช่วงวิเคราะห์, `position` แบบ `cartesian` (วินาทีจาก epoch, x, y, z เป็นเมตร), `referenceFrame: "FIXED"`, `interpolationAlgorithm: "LAGRANGE"`, `interpolationDegree: 7`
- จุดตัวอย่างทุก `step_s` และใส่จุดเวลาจบเสมอ
- Facility: `id = "fac/<name>"`, `position.cartographicDegrees`
- เส้น access: `id = "access/<facility>/<PRN>"`, polyline อ้าง `fac/<name>#position` และ `sat/<PRN>#position`, `"arcType": "NONE"` (เส้นตรงจากสถานีถึงดาว ไม่โค้งตามผิวโลก), `show` เป็นจริงเฉพาะช่วง access
- ไม่ใส่สี ขนาด หรือ label

### 5.10 `analyze.py`

```python
@dataclass(frozen=True)
class AerRow:
    time_utc: datetime; prn: str; az_deg: float; el_deg: float; range_km: float
    ipp_lat_deg: float; ipp_lon_deg: float; mf: float

@dataclass(frozen=True)
class Interval:
    start: datetime; stop: datetime; max_el_deg: float

def aer_rows(eph: Ephemeris, fac: Facility, shell_km: float) -> list[AerRow]            # ทุกแถวที่ El ≥ 0
def access_intervals(eph: Ephemeris, fac: Facility) -> dict[str, list[Interval]]
def global_statistics(intervals: dict[str, list[Interval]]) -> dict
def legacy_rows(rows: list[AerRow], min_el: float = 0.0) -> list[list[str]]             # GPS เท่านั้น
```

- ตำแหน่ง Facility ใช้ `geometry.geodetic_to_ecef` (WGS84) จาก lat/lon/alt
- `access_intervals` ใช้มุมเงยของทุกจุดเวลาและเกณฑ์ `min_el_deg` ของ Facility ขอบช่วงหาตามหัวข้อ 7.3 ช่วงที่เริ่มก่อนหรือจบหลังช่วงวิเคราะห์ถูกตัดที่ขอบช่วงวิเคราะห์
- `global_statistics` คืน `count`, `total_duration_s`, `min_duration_s`, `max_duration_s`, `mean_duration_s` ของทุกช่วงรวมกัน
- `legacy_rows` ใช้คอลัมน์ ลำดับ ทศนิยม และการเรียงแถวเหมือน `predict.rows_from_samples` เดิม

### 5.11 `dop.py`

```python
@dataclass(frozen=True)
class Dop:
    gdop: float; pdop: float; hdop: float; vdop: float; edop: float; ndop: float; tdop: float

def dop(az_el_deg: list[tuple[float, float]]) -> Dop | None
def dop_series(rows: list[AerRow], fac: Facility, flags: dict[str, frozenset[str]],
               times_utc: Iterable[datetime] | None = None) -> list[dict]
```

- `dop` คืน `None` ถ้ามีดาวน้อยกว่า 4 ดวงหรือเมทริกซ์ไม่มีตัวผกผัน
- `dop_series` คืนแถวต่อเวลาต่อ `system` ∈ {`ALL`, `G`, `R`, `E`, `C`} มี `n_visible` และค่า DOP (ว่างถ้าเป็น `None`)
- แกนเวลาคือ `times_utc` (ถ้าให้) รวมกับเวลาของแถวใน `rows` ผู้เรียกส่ง `eph.times_utc` เพราะ `aer_rows` ตัดแถว El < 0
  จุดเวลาที่ไม่มีดาวเหนือขอบฟ้าเลยจึงยังได้แถว (`n_visible` = 0, DOP ว่าง)
- ดาวที่ใช้: El ≥ `min_el_deg` และไม่มีธง `too_old`, `no_broadcast`, `unhealthy`

### 5.12 `bundle.py`

```python
def input_hash(parts: dict) -> str                    # 12 ตัวแรกของ SHA-256 ของ JSON ที่เรียง key
def write_bundle(final_dir: Path, files: dict[str, bytes]) -> Path
def build_manifest(kind: str, inputs: dict, catalog: Catalog | None, messages: list[Message],
                   extra: dict) -> dict
```

- ข้อมูลที่ใช้ทำ hash ของ `ephem`: SHA-256 ของทุกไฟล์ใน snapshot ที่ใช้, start, stop, step_s, รายชื่อดาว (PRN, NORAD), ตัวกรองแสดงผล, รุ่นของ engine
- ข้อมูลที่ใช้ทำ hash ของ `access`: hash ของ `ephem`, Facility ทั้งก้อน, shell_km
- `write_bundle` เขียนลง `final_dir.with_name(final_dir.name + ".tmp-<pid>")` แล้ว `os.replace` ถ้ามีโฟลเดอร์ปลายทางอยู่แล้ว ให้ถือว่าเป็นผลเดิมและลบโฟลเดอร์ชั่วคราว

### 5.13 `studio.py` (CLI)

```
python3 -m gnss_predict.studio fetch     [--data DIR] [--systems GREC]
python3 -m gnss_predict.studio propagate --scenario DIR
python3 -m gnss_predict.studio analyze   --scenario DIR --facility NAME
python3 -m gnss_predict.studio validate  --scenario DIR --day YYYY-MM-DD [--sp3 FILE]
```

- ทุกคำสั่งเป็นฟังก์ชันที่ server เรียกได้ตรง (`fetch_snapshot`, `run_propagate`, `run_analyze`, `run_validate`) CLI แค่แปลง argument
- ฟังก์ชันรับ `progress: Callable[[str, float], None] | None` เพื่อรายงานขั้นที่ทำอยู่และสัดส่วน 0–1
- พิมพ์ path ของโฟลเดอร์ผลลัพธ์และคำเตือนลง stdout exit code 0 / 1 / 2 แบบเดิม

### 5.14 `studio_validate.py`

```python
def validate_ephemeris(pred_sp3: Path, truth_sp3: Path, nav: Nav | None, fac: Facility,
                       flags: dict[str, frozenset[str]], ages: dict[str, float]) -> dict
```

- เวลาที่เทียบคือทุกเวลาใน `predicted.sp3` ที่อยู่ในช่วงของ SP3 จริง ค่าจริง ณ เวลานั้นได้จาก Lagrange 10 จุดของ SP3 จริง
  (วิธีเดียวกับ `sp3.interpolate` เดิม) เพราะ grid ของเรา (UTC + 18 วินาที) ไม่ตรงกับ grid ของ SP3
- ถ้าดาวไม่มีใน SP3 จริงและเป็นระบบ G/E/C ใช้ `brdc.position_km` ถ้าเป็น R ติด `unverified`
- คืนสถิติระดับระบบ (เฉพาะคู่ที่ค่าจริงมาจาก SP3 และอายุ ≤ `AGE_OK_DAYS`) และสถิติรายดวง (ทุกแหล่ง)
- รายดวงที่มีคู่ ≥ 20 คู่ ตัดสินด้วยเกณฑ์ 4 ข้อเดียวกับระดับระบบ น้อยกว่า 20 คู่ได้ผล `insufficient_data`
- เขียน `validation_<day>.json` และ `.md` ลงโฟลเดอร์ `ephem/<hash>/` และต่อท้ายหนึ่งบรรทัดใน `data/validation/history.jsonl`

### 5.15 CLI เดิม (`tle_fetch.py`)

- `fetch_gps_tle` เปลี่ยนไปดึง `gps-ops` เป็น OMM ผ่าน `omm.fetch_group` แล้วแปลงเป็นไฟล์ `gps_<เวลา>.tle` แบบเดิม (บรรทัดชื่อคงชื่อจาก CelesTrak เพื่อให้ regex `(PRN nn)` เดิมใช้ได้) และเก็บ OMM ไว้คู่กันเป็น `gps-ops_<เวลา>.json` (ชื่อที่ `omm.fetch_group` เขียน)
- `Spacecraft.Id` ของ CLI เดิมใช้ช่องหมายเลขแคตตาล็อก 5 ตัวอักษรของบรรทัด 1 (Alpha-5 เมื่อเกิน 99999)
- คำสั่ง ตัวเลือก ชื่อไฟล์ และคอลัมน์ CSV ไม่เปลี่ยน

## 6. สถานะดาว

`age_days` = |เวลากลางของช่วงวิเคราะห์ − epoch ของ OMM| หน่วยวัน

| ธง | เงื่อนไข | แสดงตั้งต้น | ใช้ใน DOP |
|---|---|---|---|
| (ไม่มีธง) | อายุ ≤ 2 วัน และไม่เข้าเงื่อนไขอื่น | แสดง | ใช้ |
| `stale` | 2 < อายุ ≤ 7 วัน | แสดง ⚠ | ใช้ |
| `too_old` | อายุ > 7 วัน | ซ่อน (`show_too_old`) | ไม่ใช้ |
| `no_broadcast` | มีไฟล์ broadcast แต่ไม่พบ PRN นี้ในไฟล์ล่าสุด | ซ่อน (`show_no_broadcast`) | ไม่ใช้ |
| `unhealthy` | ephemeris ล่าสุดของดวงนี้มี health ≠ 0 | แสดง ⚠ | ไม่ใช้ |
| `prn_changed` | PRN เปลี่ยนระหว่างช่วงวิเคราะห์ | แสดง ⚠ | ใช้ |
| `name_mismatch` | ชื่อใน CelesTrak มี PRN ที่อ่านได้แต่ไม่ตรงกับ IGS: GPS จาก `(PRN nn)` → `Gnn`, BeiDou จาก `(Cnn)` → `Cnn` (GLONASS และ Galileo ไม่มี PRN ในชื่อ จึงไม่ตรวจ) | แสดง (info) | ใช้ |

- ดาวหนึ่งดวงมีได้หลายธง ดาวจะถูกซ่อนถ้ามีธงที่ซ่อนอย่างน้อยหนึ่งธงและตัวกรองนั้นปิดอยู่
- ดาวที่ซ่อนไม่ถูก propagate แต่ยังอยู่ใน `manifest.json` พร้อมธง
- ไฟล์ broadcast ที่ใช้คือไฟล์รายวันล่าสุดที่มีครบวัน (ปกติคือของเมื่อวาน UTC) ถ้าดึงไม่ได้ จะไม่ตั้งธง `no_broadcast` และ `unhealthy` และแจ้งคำเตือน `BRDC_UNAVAILABLE`

## 7. คณิตศาสตร์

### 7.1 Facility → ECEF (WGS84)

a = 6378.137 กม., f = 1/298.257223563, e² = f(2 − f), N = a / √(1 − e² sin²φ)
X = (N + h) cos φ cos λ, Y = (N + h) cos φ sin λ, Z = (N(1 − e²) + h) sin φ
ตรวจกับ `THBK_ECEF_M` เดิม ต่างไม่เกิน 1 ม. (lat/lon/h ของ THBK ปัดจาก XYZ ใน header RINEX)

### 7.2 AER, IPP, MF

- Az/El ใช้ `ecef_to_az_el` เดิม (แกน ENU ตามเส้นตั้งฉากทรงรี) และ Range = |r_sat − r_fac|
- IPP และ MF ใช้ `ipp` และ `mapping_factor` เดิม ด้วย `shell_km` จาก scenario

### 7.3 ขอบช่วง access

เมื่อ El(tᵢ) < E_min ≤ El(tᵢ₊₁) จุดเริ่มคือ tᵢ + (E_min − El(tᵢ)) / (El(tᵢ₊₁) − El(tᵢ)) · Δt
จุดจบทำแบบเดียวกันในทิศกลับ ปัดเป็นมิลลิวินาที `max_el_deg` คือค่ามากสุดของจุดเวลาในช่วง

### 7.4 ตำแหน่งจาก broadcast (G, E, C)

- tk = t − (week × 604800 + toe) โดย t นับเป็นวินาทีจากจุดเริ่มสัปดาห์ที่ 0 ของเวลาระบบ (GPST สำหรับ G และ E, BDT = GPST − 14 วินาที สำหรับ C)
  โดย week คือเลขสัปดาห์ใน record เดียวกับ toe ไม่ห่อค่าเข้า ±302400 วินาที เวลาที่ห่างจาก ephemeris เป็นสัปดาห์เต็มจึงไม่ถูกจับคู่ผิด
- แก้สมการ Kepler ด้วยการวนซ้ำ 30 รอบ แล้วคำนวณ u, r, i ด้วยค่าแก้ Cuc, Cus, Crc, Crs, Cic, Cis และ IDOT
- ดาวทั่วไป: Ω = Ω₀ + (Ω̇ − ωe) tk − ωe toe
- BDS GEO (C01–C05, C59–C63): Ω = Ω₀ + Ω̇ tk − ωe toe คำนวณตำแหน่งในกรอบกลาง แล้วหมุนด้วย Rx(−5°) และ Rz(ωe tk)
- ค่าคงที่ GM และ ωe ตามหัวข้อ 3

### 7.5 DOP

แต่ละดาวมีแถว Hᵢ = [cos El sin Az, cos El cos Az, sin El, 1] (แกน E, N, U, นาฬิกา) และ Q = (HᵀH)⁻¹
GDOP = √(Q₁₁+Q₂₂+Q₃₃+Q₄₄), PDOP = √(Q₁₁+Q₂₂+Q₃₃), HDOP = √(Q₁₁+Q₂₂), VDOP = √Q₃₃, EDOP = √Q₁₁, NDOP = √Q₂₂, TDOP = √Q₄₄
หาตัวผกผันด้วยการกำจัดแบบเกาส์พร้อมเลือก pivot ถ้า pivot เล็กกว่า 1e-12 ถือว่าไม่มีตัวผกผัน

## 8. รูปแบบไฟล์

### 8.1 `ephem/<hash>/manifest.json`

```json
{
  "kind": "ephem", "engine_version": "...", "created_utc": "...",
  "inputs": {"orbit_snapshot": "20261111T0600Z", "files_sha256": {"gps-ops.json": "..."},
             "start": "...", "stop": "...", "step_s": 30, "show_too_old": false, "show_no_broadcast": false},
  "gmat_version": "GmatConsole-R2026a (Build Date: ...)",
  "satellites": [{"prn": "C01", "system": "C", "svn": "C231", "norad": 56564, "block": "BDS-3G",
                  "celestrak_name": "BEIDOU-3 G4 (C62)", "omm_epoch": "...", "age_days": 0.8,
                  "flags": ["name_mismatch"], "propagated": true}],
  "unmapped": [{"norad": 101318, "celestrak_name": "COSMOS 2621", "object_id": "2026-252A", "reason": "NO_PRN"}],
  "messages": [{"code": "...", "level": "warning", "text": "...", "object": "R10"}]
}
```

`access/.../manifest.json` มีโครงเดียวกัน `kind = "access"` และ `inputs` เป็น hash ของ ephem, Facility, shell_km

### 8.2 ไฟล์อื่น

- `aer.csv`, `dop.csv`, `legacy_gps.csv`, `intervals.json` ตามภาพรวม §7.5 ทศนิยม: มุม 3 ตำแหน่ง, ระยะ 3 ตำแหน่ง, IPP 4 ตำแหน่ง, MF 5 ตำแหน่ง, DOP 3 ตำแหน่ง
- `intervals.json`:
  ```json
  {"facility": "THBK", "min_el_deg": 10.0,
   "intervals": {"G01": [{"start": "...", "stop": "...", "duration_s": 21234.5, "max_el_deg": 78.123}]},
   "global_statistics": {"count": 0, "total_duration_s": 0, "min_duration_s": null,
                         "max_duration_s": null, "mean_duration_s": null}}
  ```
- ทุกไฟล์เป็น UTF-8 ไม่มี BOM ขึ้นบรรทัดด้วย `\n`

## 9. ข้อผิดพลาด

| รหัส | ระดับ | เมื่อไร | class |
|---|---|---|---|
| `ORBIT_SOURCE_UNAVAILABLE` | หยุด | ดึง OMM ไม่ได้และไม่มีไฟล์ | `OrbitUnavailableError` |
| `ORBIT_DOWNLOAD_FAILED` | เตือน | ดึงไม่ได้หรือได้ 403 แต่มีไฟล์เดิม | — |
| `ORBIT_RATE_LIMITED_LOCAL` | info | ยังไม่ครบ 2 ชม. จากครั้งก่อน ใช้ไฟล์เดิม | — |
| `IGS_META_UNAVAILABLE` | หยุด | ไม่มี IGS metadata | `IgsMetadataUnavailableError` |
| `IGS_META_STALE` | เตือน | ดึงใหม่ไม่ได้ ใช้ไฟล์เดิม | — |
| `BRDC_UNAVAILABLE` | เตือน | ไม่มีไฟล์ broadcast | — |
| `SCENARIO_INVALID` | หยุด | `scenario.json` ผิด | `ScenarioError` |
| `NO_SATELLITES` | หยุด | กรองแล้วไม่เหลือดาว | `NoSatellitesError` |
| `GMAT_NOT_FOUND`, `GMAT_FAILED` | หยุด | ของเดิม | `GmatNotFoundError`, `GmatRunError` |
| `SAT_MISSING_FROM_GMAT` | เตือน | ดวงใดหายจากรายงาน | — |
| `SAT_FLAGGED` | เตือน | ดาวมีธง (หนึ่งข้อความต่อดวง) | — |
| `DOP_GAPS` | เตือน | มีช่วงที่ ALL มีดาวน้อยกว่า 4 ดวง (ระบุจำนวนจุดเวลา) | — |
| `TRUTH_UNAVAILABLE` | หยุด (validate) | ไม่มี SP3 ของวันนั้น | `Sp3UnavailableError` (เดิม) |

`Message` คือ `{"code", "level": "info|warning|error", "text" (ภาษาไทย), "object" (ชื่อ object หรือ null)}`
class ใหม่ทั้งหมดสืบจาก `GnssPredictError` และ `TleUnavailableError` เดิมยังมีอยู่สำหรับ CLI เดิม

## 10. การทดสอบ

ใช้ `unittest` เหมือนเดิม test ที่ต้องใช้เน็ตไม่มี (ใช้ fixture) test ที่ต้องใช้ GMAT ข้ามอัตโนมัติถ้าไม่พบ

| ไฟล์ test | สิ่งที่ตรวจ | ค่าจริง | เกณฑ์ |
|---|---|---|---|
| `test_omm.py` | `to_tle_lines` | ไฟล์ OMM + TLE ที่ดาวน์โหลดคู่กันจาก CelesTrak (fixture อย่างน้อย 1 ดวงต่อระบบ และดวงที่ความเยื้องศูนย์กลางต้องตัด) | ตรงทุกตัวอักษร |
| | `catalog_field` | นิยาม Alpha-5 | 99999 → `99999`, 100000 → `A0000`, 100744 → `A0744`, 339999 → `Z9999`, 340000 → ValueError |
| | กติกาดาวน์โหลด | นาฬิกาและ opener จำลอง | ภายใน 7200 วินาทีไม่ส่ง request, ได้ 403 แล้วไม่ลองซ้ำและคืนไฟล์เดิม |
| `test_igs_meta.py` | จับคู่ PRN | ไฟล์ IGS metadata ย่อ | 56564 → C01 ณ 2026-11-09, 44542 → C40 ณ 2026-11-09, PRN ไม่มีวันสิ้นสุด, ดาวที่หมดช่วงคืน None, PRN เปลี่ยนกลางช่วงพบใน `prn_changes` |
| `test_brdc.py` | `position_km` ดาว MEO/IGSO | SP3 จริงของวันเดียวกัน (fixture ย่อ) | C และ E คลาดไม่เกิน 10 ม. |
| | `position_km` ดาว BDS GEO | คุณสมบัติทางกายภาพของวงโคจร GEO เพราะ MGEX SP3 ทุกชุดที่ตรวจไม่มี BDS GEO | ตลอด 24 ชม.: รัศมี 42,164 ± 50 กม., ค่าเฉลี่ยละติจูดอยู่ใน ±0.5°, ลองจิจูดแกว่งไม่เกิน 0.5° (ผลจริงของ C01: รัศมี 42,143–42,186 กม., ละติจูด ±0.46°, ลองจิจูด 140.00–140.12°; ถ้าไม่หมุน Rx(−5°) ละติจูดเฉลี่ยเลื่อนไปราว −3°) |
| | health และการมีอยู่ | RINEX nav จริง: R13, R27, E14, E18 มี health ≠ 0 ในไฟล์ 2026-11-09 | ได้ `healthy = False` ส่วน G และ C ที่ไม่มีตัวอย่างจริง ใช้ record ที่แก้ค่า health ตามเอกสาร RINEX 3.04 |
| `test_catalog.py` | ธงและตัวกรอง | fixture ที่ออกแบบให้ครบทุกธง | ธงและการซ่อนตามตารางหัวข้อ 6, PRN ซ้ำ |
| `test_scenario.py` | ตรวจ scenario | กรณีผิดทีละข้อ | ข้อความระบุ path ของช่อง |
| `test_propagate.py` | script และ parser | ข้อความรายงานตัวอย่าง | ชื่อ Spacecraft และ Id เป็น PRN, ดวงที่หายถูกตัดพร้อมคำเตือน |
| `test_czml.py` | โครง CZML | — | packet document, frame FIXED, หน่วยเมตร; Lagrange ลำดับ 7 จากจุดทุก 300 วินาทีเทียบตำแหน่งทุก 30 วินาทีคลาดไม่เกิน 1 ม. (ทดลองกับวงโคจรจำลอง 4 แบบ คลาดสูงสุด 0.08 มม.) |
| `test_analyze.py` | geodetic → ECEF | `THBK_ECEF_M` (จาก header RINEX) | ต่างไม่เกิน 1 ม. |
| | ขอบช่วง access | อนุกรมมุมเงยสังเคราะห์ที่รู้จุดตัด | คลาดไม่เกิน 1 วินาที, ช่วงที่ชนขอบถูกตัด |
| | MF | สูตร `mapping()` ใน TrainingModel | ต่าง 0 ที่ El 0–90° ทุก 0.001° |
| | `legacy_rows` | ผลของ `predict.rows_from_samples` เดิมจากข้อมูลชุดเดียวกัน | คอลัมน์และรูปแบบเหมือนเดิม |
| `test_dop.py` | GDOP/PDOP/HDOP/VDOP/EDOP/NDOP/TDOP | สูตรปิดของเรขาคณิตที่แก้ด้วยมือได้: ดาว 1 ดวงที่จุดยอด + n ดวงที่มุมเงย θ ทิศกระจายเท่ากัน ให้ EDOP = NDOP = √(2/(n cos²θ)), VDOP = √((1+n)/(n(1−sin θ)²)), TDOP = √((1+n sin²θ)/(n(1−sin θ)²)) (เมทริกซ์ H แบบเดียวกับ `dops()` ของ RTKLIB ซึ่งตรวจจากซอร์สโค้ดแล้ว) | n = 3, θ = 30°: HDOP 1.333333, VDOP 2.309401, TDOP 1.527525, PDOP 2.666667, GDOP 3.073181 ต่างไม่เกิน 1e-6 และ n = 5, θ = 15° ตามสูตร |
| | EDOP/NDOP/TDOP | เอกลักษณ์ | HDOP² = EDOP² + NDOP², GDOP² = PDOP² + TDOP² (ต่างไม่เกิน 1e-12) |
| | ดาวไม่พอ | — | 3 ดวงคืน None |
| `test_bundle.py` | hash และการเขียน | — | ข้อมูลเดิมได้ hash เดิม, เขียนไม่เสร็จไม่ทิ้งโฟลเดอร์ปลายทาง |
| `test_studio_validate.py` | สถิติ | คู่ค่าจำลอง | ระดับระบบใช้เฉพาะคู่จาก SP3, รายดวง < 20 คู่ได้ `insufficient_data`, GLONASS ที่ไม่มี SP3 ได้ `unverified` |
| `test_studio_cli.py` | argument และ exit code | — | 0 / 1 / 2 ตามกรณี |
| `test_integration_studio.py` | `propagate` + `analyze` ด้วย GMAT จริง (snapshot ย่อ 1 ดวงต่อระบบ รวมดาวเลข 6 หลัก) | — | ได้ไฟล์ครบ, ดาวเลข 6 หลักถูก propagate |
| test เดิม 83 ข้อ | CLI เดิม | — | ผ่านทั้งหมด |

**Acceptance** (รันด้วยมือ บันทึกผลใน README)
1. ความแม่นยำตามภาพรวม §10.1 ด้วย snapshot ที่ดึงก่อนวันตรวจ
2. `legacy_gps.csv` เทียบกับ CLI เดิมเมื่อใช้ TLE ชุดเดียวกัน Az/El ต่างไม่เกิน 0.01°
3. เวลา `propagate` 130 ดวง 24 ชม. ทุก 30 วินาที ไม่เกิน 60 วินาที

## 11. ความเสี่ยงเฉพาะงานนี้

| # | ความเสี่ยง | วิธีรับมือ |
|---|---|---|
| E1 | GMAT ใช้หน่วยความจำหรือเวลามากเมื่อรายงาน 390 คอลัมน์ × 2,881 แถว | วัดใน task แรกที่ใช้ GMAT ถ้าเกินเกณฑ์ ให้แบ่ง script เป็นชุดละไม่เกิน 40 ดวง |
| E2 | ตำแหน่ง field ของ health ใน RINEX 3.04 ต่างกันตามระบบ | fixture ที่มีดาว unhealthy จริงของแต่ละระบบเท่าที่หาได้ ระบบที่หาไม่ได้ให้ test จากเนื้อหาในเอกสาร RINEX 3.04 |
| E3 | เวลาใน `predicted.sp3` (GPST) ไม่ตรง grid ของ SP3 จริง (เริ่มที่ 00:00:18 GPST) | `validate` ใช้ Lagrange ของ SP3 จริงที่เวลาของเรา (หัวข้อ 5.14) |
| E4 | CelesTrak เปลี่ยนชื่อกลุ่มหรือรูปแบบ JSON | test ของ parser ด้วย fixture จริง และข้อความ error ระบุ URL |
