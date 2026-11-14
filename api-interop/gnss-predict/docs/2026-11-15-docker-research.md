# การวิจัยสถาปัตยกรรม Docker สำหรับ GNSS Studio / `gnss_predict`

- วันที่: 2026-11-15
- Branch ที่ตรวจสอบ: `feature/gnss-studio-models`
- ขอบเขต: วิเคราะห์การเรียกใช้ GMAT ในโค้ดปัจจุบัน, วิจัยตัวเลือกการรันใน Linux container (Official GMAT Release vs Python SGP4 vs Server + Web UI only), ร่าง `Dockerfile` / `docker-compose.yml`, และสรุปข้อเสนอแนะเชิงสถาปัตยกรรม

---

## 1. สถาปัตยกรรมการเรียกใช้ GMAT และค่าตั้งต้นในโค้ดปัจจุบัน

จากการตรวจสอบโค้ดใน `api-interop/gnss-predict/` และซอร์สโค้ดของ GMAT R2026a ใน repo พบรายละเอียดสำคัญดังนี้

### 1.1 วิธีค้นหาและเรียก `GmatConsole` (`gnss_predict/run_gmat.py`)
- **`find_gmat_console()`** (`gnss_predict/run_gmat.py:20-32`):
  1. อ่านตัวแปรสภาพแวดล้อม `GMAT_BIN` ก่อน ถ้าตั้งไว้ต้องเป็นไฟล์ที่รันได้ (`is_file()` และ `os.X_OK`) มิฉะนั้นโยน `GmatNotFoundError`
  2. ถ้าไม่ตั้ง `GMAT_BIN` จะหาที่ `REPO_ROOT / "application" / "bin" / "GmatConsole"`
- **`run_script()`** (`gnss_predict/run_gmat.py:48-80`):
  - รันคำสั่ง:
    ```text
    <GmatConsole> --run <script_path> --logfile <log_path>
    ```
  - **Working directory (`cwd`)**: ตั้งเป็น `Path(console).resolve().parent` (โฟลเดอร์ `bin/` ของไฟล์จริงหลัง resolve symlink) เพราะ `gmat_startup_file.txt` อ้าง path แบบสัมพัทธ์ เช่น `ROOT_PATH = ../`, `PLUGIN = ../plugins/...`, `DATA_PATH = ROOT_PATH/data/`
  - **Process group isolation**: เปิดด้วย `start_new_session=True` และส่ง `pgid` ผ่าน `on_start(pgid)` ให้ `worker.py` / `JobManager` เพื่อใช้ `os.killpg(pgid, signal.SIGKILL)` เวลายกเลิก job หรือครบ timeout (`600` วินาทีใน `run_gmat.py`, `900` วินาทีใน `propagate.py`)
  - **การตรวจความผิดพลาด**: ตรวจ `returncode != 0`, `TimeoutExpired`, และค้นหา `"**** ERROR ****"` ทั้งใน `stdout` และไฟล์ `--logfile`
- **`gmat_version()`** (`gnss_predict/run_gmat.py:82-96`):
  - รัน `GmatConsole --version` แล้วอ่านชื่อไฟล์จริง (หลัง resolve symlink) คู่กับบรรทัด `Build Date:`

### 1.2 การสร้าง GMAT script และ propagator ที่ใช้งานจริง
`gnss_predict` ใช้ GMAT ใน **2 เส้นทาง** โดยทั้งคู่ใช้ propagator ชนิดเดียวกันคือ **`SPICESGP4`** (`plugins/TLEPropagatorPlugin`):

1. **GNSS Studio engine (`gnss_predict/propagate.py` + `gnss_predict/studio.py`)** — ใช้งานหลักของระบบใหม่ (GREC 4 ระบบ):
   - เขียนไฟล์ `all.tle` แบบ 3 บรรทัดต่อดวง โดยใช้ **PRN** (`G01`, `R10`, `E11`, `C01`, ...) เป็นบรรทัดชื่อ และตั้ง `Spacecraft.Id = '<PRN>'` เพื่อให้ `TLEReader` (`plugins/TLEPropagatorPlugin/src/propagator/TLEReader.cpp:46-151`) จับคู่ด้วยบรรทัดชื่อได้แม้เลข NORAD เป็น Alpha-5 (6 หลัก เช่น `100744`)
   - Script (`ecef.script`) ตั้งค่า:
     - `Spacecraft.DateFormat = UTCGregorian`, `Epoch = '<start>'`, `EphemerisName = '<tle_path>'`
     - `Create Propagator TLEProp;` / `TLEProp.Type = SPICESGP4;` / `TLEProp.InitialStepSize = <step_s>;` (ค่าเริ่มต้น `30` วินาที)
     - `Create ReportFile RF;` (`Precision = 16`, `Delimiter = ','`) ขอคอลัมน์ `<PRN>.EarthFixed.X/Y/Z` (กม.)
     - `Propagate TLEProp(<prns...>) {<prn0>.ElapsedSecs = <elapsed_s>};` (รันครั้งเดียวทุกดวงพร้อมกัน)
   - การคำนวณ Az/El, Range, IPP, MF, ช่วง Access, DOP, CZML และ SP3-d ทั้งหมดหลังจากได้ `EarthFixed` ทำใน Python ล้วน (`analyze.py`, `geometry.py`, `dop.py`, `czml.py`, `sp3.py`)

2. **CLI เดิม (`gnss_predict/script_gen.py` + `templates/thbk_visibility.script.tmpl` + `gnss_predict/predict.py`)** — พยากรณ์ GPS สำหรับงาน TEC:
   - ใช้ `SPICESGP4` เช่นเดียวกัน แต่สร้าง `GroundStation THBK` (`StateType = Spherical`, `HorizonReference = Ellipsoid`) และ `CoordinateSystem THBKTopo` (`Origin = THBK`, `Axes = Topocentric`) ให้ GMAT แปลงเป็น `<sat>.THBKTopo.X/Y/Z` (SEZ) ก่อนส่งต่อ `geometry.py`

### 1.3 ค่าคงที่และพฤติกรรมที่สำคัญต่อ Containerization
| รายการ | ค่า / พฤติกรรมในโค้ดปัจจุบัน | แหล่งอ้างอิง | ผลต่อการออกแบบ Docker |
|---|---|---|---|
| **Data directory** | `GNSS_STUDIO_DATA` (default: `PKG_ROOT / "data"`) | `gnss_predict/config.py:64`, `server/gnss_studio_server/config.py:37-39` | Mount เป็น Docker volume เช่น `/data` และตั้ง `GNSS_STUDIO_DATA=/data` |
| **Host & Port** | `GNSS_STUDIO_HOST=127.0.0.1`, `GNSS_STUDIO_PORT=8000` | `server/gnss_studio_server/config.py:12-13,40-41` | มีประเด็น Docker bridge vs loopback guard (ดูข้อ 1.4) |
| **Security Guards** | `TrustedHostMiddleware` รับ `127.0.0.1`, `localhost`, `[::1]`, `Config.host`; `OriginGuard` บล็อก mutating request ที่มี `Origin` แปลกปลอม (403); ไม่มี CORS/login | `server/gnss_studio_server/guard.py:23-83` | ห้าม expose ออกนอก `127.0.0.1` ของ host โดยไม่มี auth |
| **Daily job default** | `Daily.enabled: bool = True` (`run_at_utc = "21:00"`) **เมื่อไม่มีไฟล์ `data/settings.json`** | `server/gnss_studio_server/settings.py:45-51,123-125` | **ต้อง seed `/data/settings.json` เป็น `{"daily": {"enabled": false}}` ตอนเริ่ม container** (ถ้ายังไม่มีไฟล์) เพื่อไม่ให้ scheduler ดึงเน็ตเองตั้งแต่เปิด container |
| **External CLI (`curl`)** | `brdc.py` และ `sp3.py` เรียก `curl -s --fail --ssl-reqd --max-time 120 -u anonymous:anonymous` เพื่อดึง FTPS จาก CDDIS | `gnss_predict/brdc.py:23,77`, `gnss_predict/sp3.py:25,55,67` | **ทุก container ที่รัน `fetch` หรือ `validate` ต้องติดตั้ง `curl` + `ca-certificates`** |
| **Python dependencies** | `gnss_predict` ใช้ Python standard library ล้วน; `server` ใช้ `fastapi==0.162.4`, `uvicorn==0.54.0` | `server/requirements.txt`, `docs/2026-11-11-gnss-studio-engine-design.md:23` | Image ไม่ต้องลงไลบรารีหนัก เว้นแต่เลือกแนวทาง Python SGP4 |
| **Web UI (`web/dist`)** | `DEFAULT_WEB_DIST = PKG_ROOT / "web" / "dist"` รวม Cesium static assets (`Workers`, `ThirdParty`, `Assets`, `Widgets`) ไม่เรียก CDN | `server/gnss_studio_server/config.py:11`, `web/vite.config.ts:12-26` | Build ด้วย Node (`node:22-slim`) ใน multi-stage build แล้วคัดลอกเฉพาะ `web/dist` เข้า runtime image |
| **Health check** | `GET /api/health` คืน `gmat_found: bool` โดยตรวจ `find_gmat_console` | `server/gnss_studio_server/routes/health.py:32-61` | Server เปิดทำงานได้แม้ไม่มี GMAT (`gmat_found: false`) |

### 1.4 ข้อควรระวังเรื่อง Binding `127.0.0.1` ใน Docker
โค้ด `server/gnss_studio_server/config.py` ตั้ง `DEFAULT_HOST = "127.0.0.1"` ซึ่งเกิดความแตกต่างระหว่างรันบน host กับรันใน container ดังนี้:
- **Docker Bridge Mode (แนะนำ — ใช้ได้ทั้ง Linux, macOS, Windows Docker Desktop)**:
  - ใน `docker-compose.yml` ให้ map พอร์ตเป็น `ports: ["127.0.0.1:8000:8000"]` เพื่อให้พอร์ตบน **host** ผูกกับ `127.0.0.1` เท่านั้น (เครื่องอื่นในเครือข่ายเข้าไม่ถึง)
  - แต่ภายใน network namespace ของ container, Docker port-forwarder ส่งทราฟฟิกเข้า `eth0` ของ container ไม่ใช่ `lo` (`127.0.0.1`) ดังนั้น **process `uvicorn` ใน container ต้อง bind `GNSS_STUDIO_HOST=0.0.0.0`** เพื่อให้รับทราฟฟิกจาก bridge ได้
  - ตรวจสอบกับ `guard.py:47-57` แล้ว: `allowed_hosts` และ `allowed_origins` ยังรวม `127.0.0.1`, `localhost`, `[::1]` ไว้เสมอ ดังนั้นเบราว์เซอร์บน host ที่เปิด `http://127.0.0.1:8000` หรือ `http://localhost:8000` ผ่าน `TrustedHostMiddleware` และ `OriginGuard` ได้ตามปกติ (จะมีเพียง log คำเตือน `NOT_LOOPBACK_TEXT` หนึ่งบรรทัดตอน start server)
- **Linux Host Network Mode (`network_mode: host`, ใช้ได้เฉพาะ Linux)**:
  - ใช้ `GNSS_STUDIO_HOST=127.0.0.1` ตรง ๆ ได้โดยไม่ต้องเปิด `0.0.0.0` และไม่มี warning ใน log แต่ไม่รองรับบน macOS/Windows Docker Desktop

---

## 2. ผลการวิจัย: Official NASA GMAT Linux Release (SourceForge)

ข้อมูลจากการตรวจสอบไฟล์เผยแพร่บน SourceForge (`sourceforge.net/projects/gmat/files/GMAT/`) ร่วมกับไฟล์ใน repo (`application/README.txt`, `License.txt`, `CMakeLists.txt`, `src/console/`, `src/base/`):

### 2.1 รุ่นล่าสุด, ขนาดไฟล์ และ Distro ที่รองรับ
- **รุ่นล่าสุดบน SourceForge**:
  - **GMAT R2026a** (เผยแพร่ 2–3 เมษายน 2026):
    - `gmat-ubuntu-x64-R2026a.tar.gz` — ขนาดบีบอัด **~401.7 MB**
    - `gmat-rhel7-x64-R2026a.tar.gz` — ขนาดบีบอัด **~438.0 MB**
  - **GMAT R2025a** (เผยแพร่ เมษายน 2025):
    - `gmat-ubuntu-x64-R2025a.tar.gz` — ขนาดบีบอัด **~421.7 MB**
- **ขนาดหลังแตกไฟล์**: ประมาณ **1.0–1.3 GB** (~2.5–3 เท่าของ tarball; เฉพาะโฟลเดอร์ `application/data/` ใน repo วัดได้ ~232 MB โดยหลักคือ `planetary_ephem` 150 MB และ `planetary_coeff` 40 MB ส่วนที่เหลือเป็น binary, GUI `GMAT_Beta`, wxWidgets `.so`, plugins, และเอกสาร PDF/HTML)
- **Distro ที่รองรับอย่างเป็นทางการ** (`application/README.txt:87-101`):
  - Build บน **Ubuntu 22.04 LTS** และ **CentOS 7 / RHEL 7**
  - ผ่านการทดสอบบน **Ubuntu 24.04 LTS** และ **RHEL 8** และทดสอบรันบน **Ubuntu 22.04 LTS** และ **RHEL 7 / 9**
- **ข้อจำกัดด้าน CPU Architecture**:
  - Tarball ทางการบน SourceForge มีเฉพาะ **`x86_64` (`x64`) เท่านั้น** ไม่มี binary `linux/arm64` อย่างเป็นทางการ
  - บนเครื่องพัฒนา Apple Silicon (`arm64`) จึงต้องรัน container ด้วย `--platform linux/amd64` (ผ่าน Rosetta 2 / QEMU ซึ่งช้ากว่า native) หรือ compile GMAT จาก source สำหรับ `arm64` เอง (ใช้ `GMAT_INCLUDE_GUI=OFF` ตาม `README.md`)

### 2.2 License และ Checksum
- **License**: **Apache License, Version 2.0** (ระบุชัดเจนใน `License.txt` และ `application/README.txt:23-38`, NASA Docket No. GSC-19468-1 — GMAT เปลี่ยนจาก NOSA 1.3 มาใช้ Apache 2.0 ตั้งแต่รุ่น R2013a) พร้อม notice ของ third-party libraries (CSPICE, SOFA, Xerces, wxWidgets, Boost, f2c, OpenFramesInterface)
- **Checksum**: บนหน้า Files ของ SourceForge (`/projects/gmat/files/GMAT/GMAT-R2026a/`) มีไอคอน `(i)` ข้างชื่อแต่ละไฟล์ที่แสดงค่า **MD5** และ **SHA-1** สำหรับตรวจความถูกต้องหลังดาวน์โหลด (ควร pin ค่า checksum จากหน้า SourceForge ของ release ที่เลือกลงใน `Dockerfile` ก่อนแตกไฟล์)

### 2.3 การรัน `GmatConsole` แบบ Headless ใน Linux Container (`DISPLAY` / GUI / Libraries)
ผลการตรวจซอร์สโค้ดจริงของ GMAT ให้ข้อสรุปที่แม่นยำกว่าบทความทั่วไปบนเว็บดังนี้:
1. **GMAT ไม่ได้ใช้ Qt**: ระบบ GUI ของ GMAT ใช้ **wxWidgets 3.2.x (GTK3 บน Linux)** (`CMakeLists.txt:46,166-196`) ไม่ใช่ Qt ดังนั้นข้อผิดพลาด `qt.qpa.plugin` ในบทความทั่วไปไม่เกี่ยวกับ GMAT
2. **`GmatConsole` ไม่ได้ link กับ wxWidgets หรือ X11**: ใน `src/console/CMakeLists.txt:46-47` ตัว executable `GmatConsole` link เฉพาะ `GmatUtil` และ `GmatBase` เท่านั้น และ `src/console/driver.cpp` ใช้เพียง standard C++ I/O (`std::cout`, `std::ifstream`)
3. **การข้าม GUI plugins บน Linux**: ใน `src/base/executive/Moderator.cpp:925-943` (`#ifdef __linux__ if (!isFromGui)`), `GmatConsole` จะสแกนไฟล์ `.so` เพื่อหาข้อความ `"PluginWidget"` และพิมพ์ `Skipping "...": GUI plugins are skipped in console mode` โดยไม่โหลด GUI plugin
4. **ข้อควรระวังกับ `gmat_startup_file.txt` ใน Tarball ทางการ**:
   - ใน `application/bin/gmat_startup_file_mac_linux.public.txt:48-84` มีการประกาศ `PLUGIN = ../plugins/libOpenFramesInterface`, `libOVtoOFI`, `libPythonInterface_py312`, `libMatlabInterface`
   - ผล grep ใน `plugins/` พบ `"PluginWidget"` เฉพาะใน `src/base/factory/guicomponents/PluginWidget.cpp` เท่านั้น ดังนั้นถ้า `libOpenFramesInterface.so` ใน tarball ไม่ผ่านเกณฑ์ `PluginWidget` ตัว `GmatConsole` จะพยายาม `dlopen` มัน ซึ่งอาจขาด `libGL.so.1` / `libX11.so.6` ใน image Ubuntu เปล่า — แม้ `Moderator::LoadAPlugin()` + `DynamicLibrary::LoadDynamicLibrary()` (`src/base/plugin/DynamicLibrary.cpp:209-228`) จะ **ไม่ทำให้ `GmatConsole` ล้ม** (แค่พิมพ์ `dlerror()` ลง stdout/log และข้าม plugin นั้น)
   - **ทางแก้ที่สะอาดที่สุดใน Container**: สร้าง/แก้ `gmat_startup_file.txt` ให้ **comment out** plugin ที่ `gnss_predict` ไม่ใช้ (`libOpenFramesInterface`, `libOVtoOFI`, `libMatlabInterface`, `libPythonInterface_*`) เหลือเฉพาะ plugin คำนวณ (โดยเฉพาะ `../plugins/thinksys/libTLEPropagator` และ `../plugins/libStation`) แล้ว `GmatConsole` จะรันแบบ **headless แท้ ๆ โดยไม่ต้องมี `DISPLAY`, X11 หรือ `Xvfb` เลย** (ไม่ต้องเปิด `Xvfb` ค้างใน entrypoint)
   - **Runtime OS dependencies ที่อาจยังต้องมี** สำหรับ prebuilt binary บน `ubuntu:22.04`: `libstdc++6`, `libgcc-s1`, `libgomp1` (และถ้าไม่ปิด `libOpenFramesInterface` ใน `gmat_startup_file.txt` หรือใช้คำสั่ง GUI ก็อาจต้องลง `libgl1`, `libglu1-mesa`, `libx11-6`, `xvfb` เพิ่ม) รวมถึงตั้ง `LC_ALL=C.UTF-8` และ `TZ=UTC`

---

## 3. ผลการวิจัย: Python SGP4 (`sgp4` / `skyfield`) เทียบกับ GMAT `SPICESGP4`

### 3.1 การทำงานภายในของ GMAT `SPICESGP4` (อ้างอิงจากโค้ดจริงใน repo)
จากการตรวจ `plugins/TLEPropagatorPlugin/src/propagator/SPICEPropagator.cpp` และ `TLEReader.cpp`:
1. **อัลกอริทึม SGP4**: ใช้ NAIF CSPICE (`getelm_c` + `spke10_`, อัปเดตตั้งแต่ SPICE v66/N0066 โดยอาศัย **Vallado et al. 2006** *"Revisiting Spacetrack Report #3"* แบบ **improved mode**)
2. **ค่าคงที่แรงโน้มถ่วง (Gravity Constants)**: ฮาร์ดโค้ดเป็น **WGS-72** (`SPICEPropagator.cpp:370-377`):
   - `J2 = 1.082616e-3`, `J3 = -2.53881e-6`, `J4 = -1.65597e-6`, `KE = 7.43669161e-2`, `QO = 120.0`, `SO = 78.0`, `ER = 6378.135`, `AE = 1.0`
3. **กรอบอ้างอิง (Coordinate Frame Transformations)**:
   - `spke10_` คำนวณสถานะในกรอบ TEME แล้วแปลงเป็น **J2000** (`EarthMJ2000Eq`) ภายใน CSPICE (`zzteme`)
   - จากนั้น `CoordinateConverter` ของ GMAT แปลง `EarthMJ2000Eq` → **`EarthFixed`** (ITRF) โดยใช้โมเดลลดรูป **FK5 / IAU-1980** (Precession + Nutation + Sidereal Time) ร่วมกับไฟล์ **EOP** (`eopc04_08.62-now`: ค่า `UT1-UTC` และ Polar Motion $x_p, y_p$) และ Leap Seconds (`SPICELeapSecondKernel.tls` / `tai-utc.dat`)
4. **Time & Step handling**:
   - แปลง `Spacecraft.Epoch` (`UTCGregorian`) → `A1MJD` → `TT` → `et` (TDB/TT วินาทีจาก J2000) แล้วเรียก `spke10_` ตรงจุดเวลาแต่ละ step (`step_s = 30`) โดยไม่มีการ integrate ODE (`UsesODEModel() == false`)

### 3.2 ตารางเปรียบเทียบกับ Python SGP4 (`sgp4` ของ Brandon Rhodes)

| มิติการเปรียบเทียบ | GMAT `SPICESGP4` (`gnss_predict` ปัจจุบัน) | Python `sgp4` อย่างเดียว (`Satrec`) | Python `sgp4` + `skyfield` (หรือ TEME→ITRF + EOP) |
|---|---|---|---|
| **อัลกอริทึม SGP4** | CSPICE `spke10_` / `evsgp4` (Vallado 2006 improved) | Vallado 2006 (`opsmode='i'` default; `'a'` AFSPC เลือกได้) — C++ extension พร้อม pure-Python fallback | ใช้ `sgp4` เป็นแกนกลางเหมือนกัน |
| **Gravity constants** | **WGS-72** (`ER=6378.135`) | **WGS-72** default (`WGS84` / `WGS72OLD` เลือกได้) | **WGS-72** default |
| **Output frame** | **`EarthFixed` (ITRF)** โดยตรง (TEME → J2000 → FK5/ITRF) | **TEME เท่านั้น** (เป็น ECI ไม่หมุนตามโลก ไม่มีแปลงเป็น ECEF/ITRF) | **`ITRS` / ECEF** (ผ่าน `skyfield.framelib.itrs` หรือเขียน TEME→ITRF เอง) |
| **EOP (`UT1-UTC`, Polar Motion)** | ใช้ `eopc04_08.62-now` ที่มากับ GMAT | ไม่มี (ถ้าเขียนแปลงเองด้วย UTC ล้วน จะคลาด $\lvert UT1-UTC\rvert \le 0.9\text{ s}$) | รองรับผ่าน `finals2000A.all` (`iers.install_polar_motion_table`) หรืออ่านไฟล์ EOP |
| **Epoch / Step handling** | เรียก `spke10_` ทีละ step, GMAT เขียนเวลาบางครั้งคลาด ms (`29.999` → `_round_to_second` แก้แล้ว) | Vectorized `sgp4_array(jd, fr)` ตรง grid เป๊ะ ไม่มี jitter/duplicate row | ตรง grid เป๊ะ |
| **การแปลงเวลา `tsince`** | TT/TDB seconds จาก J2000 (TLE epoch แปลงผ่าน `LSK_FILE`) | UTC Julian Date (`jd, fr`) | `Timescale` จัดการ UTC/TAI/TT/UT1 ครบ |
| **External data ที่ต้องมี** | `application/data/` ของ GMAT (~232 MB; หลัก ๆ ใช้ `LSK_FILE`, `tai-utc.dat`, `NUTATION.DAT`, `eopc04`) | ไม่มี (แต่ยังไม่พอสร้าง `EarthFixed`) | ต้องมี `finals2000A.all` (~3.5 MB) / leap seconds (และ `de421.bsp` ~17 MB เฉพาะถ้าใช้ API ดาวเคราะห์ของ Skyfield) |
| **ความเร็ว (130 ดวง × 24 ชม. @ 30 วิ)** | ~6–60 วินาที (spawn process + startup + file I/O) | < 0.1 วินาที (C++ vectorized) | < 0.5 วินาที |

### 3.3 ผลกระทบต่อความแม่นยำและการทดสอบที่มีอยู่
1. **เกณฑ์ความแม่นยำกับ SP3 (`gnss_predict/config.py:26-32`, `docs/2026-11-11-gnss-studio-design.md §10.1`)**:
   - เกณฑ์ผ่านระดับระบบ: ค่ากลาง $|\Delta\text{El}| \le 0.05^\circ$, P99 $|\Delta\text{El}| \le 0.2^\circ$, ค่ากลาง $|\Delta\text{Az}| \le 0.1^\circ$, P99 $|\Delta\text{Az}| \le 0.5^\circ$ (Az คิดที่ $\text{El} < 80^\circ$)
   - ผลวัดจริงของ GMAT เทียบ MGEX SP3 (`GFZ0MGXRAP`, 2026-11-09) ผ่านห่างเกณฑ์ ~20 เท่า (ค่ากลาง $|\Delta\text{El}| \approx 0.0009^\circ\text{–}0.0016^\circ$, P99 $\le 0.0084^\circ$)
   - **กรณีใช้ `sgp4` + GMST แบบ UTC (ไม่ใช้ `UT1-UTC` / Polar Motion)**: ความคลาด $0.9\text{ s}$ ในการหมุนโลกที่วงโคจร MEO/GEO ($r \approx 26{,}560\text{–}42{,}164\text{ km}$) ทำให้ตำแหน่ง ECEF คลาดได้ถึง **~1.7–2.8 กม.** ($\sim 0.004^\circ\text{–}0.007^\circ$ ของมุม Az/El) — แม้จะยังอยู่ภายใต้เกณฑ์ $0.05^\circ$ ของ `validate` แต่ **ไม่ผ่านเกณฑ์ parity ใน `§10.2` ข้อ 5** (`Az/El ต่างจากผลบน macOS ไม่เกิน 0.0001°`)
   - **กรณีใช้ `sgp4` + TEME→ITRF ที่ใส่ EOP (`UT1-UTC` + polar motion)**: ความต่างจาก GMAT `SPICESGP4` จะลดลงเหลือระดับเซนติเมตร–เมตร ($< 0.0001^\circ$) ซึ่งสอดคล้องกับเกณฑ์ parity
2. **ผลกระทบต่อโค้ดและชุดทดสอบปัจจุบัน**:
   - ปัจจุบัน `gnss_predict` **ไม่มีโหมด Python SGP4** ในโค้ด (`propagate.py` และ `predict.py` เรียก `find_gmat_console` + `run_script` โดยตรง) ดังนั้นแนวทาง (ข) **ต้องเพิ่ม backend propagator ใหม่ใน `gnss_predict`** (เช่น `SGP4_BACKEND=python`), ปรับ `ENGINE_VERSION` ใน `config.py` (ทำให้ hash `ephem/<hash>` เปลี่ยน), ปรับ `manifest.json` (`gmat_version` / engine metadata), และปรับพฤติกรรม `GET /api/health` (`gmat_found`) หรือเพิ่ม field แสดง engine backend
   - Integration tests (`tests/test_integration_gmat.py`, `tests/test_integration_studio.py`, `server/tests/test_integration_gmat.py`) ทดสอบ `GmatConsole` จริงและจะ skip อัตโนมัติเมื่อไม่มี GMAT

---

## 4. ร่าง `Dockerfile` และ `docker-compose.yml` ทั้ง 3 ทางเลือก

> **หมายเหตุสำคัญเรื่องการรักษาค่าตั้งต้นทั้ง 3 ทางเลือก**:
> 1. **`daily` disabled by default**: ใช้ entrypoint script สร้าง `/data/settings.json` ด้วย `{"daily": {"enabled": false}}` **เฉพาะเมื่อยังไม่มีไฟล์** (ตาม `settings.py:16-17` โครงสร้างนี้โหลดแล้วปิดงานประจำวันและเติมค่าอื่นเป็นค่าตั้งต้นโดยไม่ทับไฟล์ที่ผู้ใช้แก้ไว้)
> 2. **`data` volume**: ตั้ง `GNSS_STUDIO_DATA=/data`, ประกาศ `VOLUME ["/data"]`, และ mount volume ใน `docker-compose.yml`
> 3. **Bind `127.0.0.1`**: ใน `docker-compose.yml` ใช้ `ports: ["127.0.0.1:8000:8000"]` คู่กับ `GNSS_STUDIO_HOST=0.0.0.0` ภายใน container (สำหรับ bridge mode; บน Linux หากใช้ `network_mode: host` ตั้ง `GNSS_STUDIO_HOST=127.0.0.1` ได้โดยตรง)

### Shared Entrypoint (`docker/entrypoint.sh` — ใช้ร่วมกันทั้ง 3 ทางเลือก)
```sh
#!/bin/sh
set -eu

DATA_DIR="${GNSS_STUDIO_DATA:-/data}"
mkdir -p "$DATA_DIR"

# settings.py ตั้ง Daily.enabled=True ถ้าไม่มี settings.json
# จึงสร้างไฟล์เริ่มต้นที่ปิด daily ไว้เมื่อเปิด container ครั้งแรกเท่านั้น
if [ ! -e "$DATA_DIR/settings.json" ]; then
  printf '{\n  "daily": {\n    "enabled": false\n  }\n}\n' > "$DATA_DIR/settings.json"
fi

exec python3 -m gnss_studio_server
```

---

### ทางเลือก (ก): Official GMAT Linux Container (`GmatConsole` เต็มรูปแบบ)

ใช้ `ubuntu:22.04` (`linux/amd64`) ให้ตรงกับสภาพแวดล้อมที่ GMAT R2026a/R2025a build และทดสอบอย่างเป็นทางการ พร้อมปิด GUI/MATLAB/Python/OpenFrames plugins ใน `gmat_startup_file.txt` เพื่อให้ `GmatConsole` รัน headless ได้โดยไม่ต้องพึ่ง `Xvfb`

**ประมาณการขนาด Image** *(ตัวเลขประมาณการจากขนาด base image + tarball + packages)*:
- `ubuntu:22.04` base: ~80 MB
- `gmat-ubuntu-x64-R2026a.tar.gz` แตกไฟล์: **~1.0–1.3 GB** *(หรือลดเหลือ ~400–500 MB หากตัด `doc/`, `samples/`, `GMAT_Beta`, `libwx_*` และ textures GUI ออกหลังแตกไฟล์)*
- Python 3 + `fastapi` + `uvicorn` + `curl` + `ca-certificates`: ~80–100 MB
- `web/dist` (รวม Cesium assets): ~20–30 MB
- **รวมประมาณ ~1.25–1.55 GB** *(หรือ ~600–700 MB แบบ trimmed)*

```dockerfile
# syntax=docker/dockerfile:1
FROM --platform=$BUILDPLATFORM node:22-slim AS web-build
WORKDIR /src/web
COPY api-interop/gnss-predict/web/package*.json ./
RUN npm ci
COPY api-interop/gnss-predict/web/ ./
RUN npm run build

FROM --platform=linux/amd64 ubuntu:22.04 AS runtime
ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    LC_ALL=C.UTF-8 \
    TZ=UTC \
    GNSS_STUDIO_DATA=/data \
    GNSS_STUDIO_HOST=0.0.0.0 \
    GNSS_STUDIO_PORT=8000 \
    GMAT_BIN=/opt/gmat/bin/GmatConsole

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip curl ca-certificates libstdc++6 libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# ดาวน์โหลดและตรวจ checksum ของ GMAT R2026a (เปลี่ยน SHA1/MD5 เป็นค่าจากหน้า SourceForge (i) ก่อนใช้งานจริง)
ARG GMAT_VERSION=R2026a
ARG GMAT_URL="https://sourceforge.net/projects/gmat/files/GMAT/GMAT-${GMAT_VERSION}/gmat-ubuntu-x64-${GMAT_VERSION}.tar.gz/download"
ARG GMAT_SHA1="<SHA1_FROM_SOURCEFORGE_INFO_PANEL>"
RUN curl -fsSL -L "${GMAT_URL}" -o /tmp/gmat.tar.gz \
    && echo "${GMAT_SHA1}  /tmp/gmat.tar.gz" | sha1sum -c - \
    && mkdir -p /opt/gmat \
    && tar -xzf /tmp/gmat.tar.gz -C /opt/gmat --strip-components=1 \
    && rm -f /tmp/gmat.tar.gz

# ปิด GUI/external plugins ที่ GmatConsole ไม่ได้ใช้ เพื่อให้รัน headless ได้สะอาดโดยไม่ต้องใช้ X11/Xvfb
RUN sed -i -E 's/^(PLUGIN[[:space:]]*=.*(OpenFramesInterface|OVtoOFI|PythonInterface|MatlabInterface))/# \1/' \
      /opt/gmat/bin/gmat_startup_file.txt

WORKDIR /app
COPY api-interop/gnss-predict/server/requirements.txt ./server/requirements.txt
RUN pip3 install --no-cache-dir -r ./server/requirements.txt

COPY api-interop/gnss-predict/gnss_predict ./gnss_predict
COPY api-interop/gnss-predict/templates ./templates
COPY api-interop/gnss-predict/server ./server
COPY --from=web-build /src/web/dist ./web/dist
COPY api-interop/gnss-predict/docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV PYTHONPATH=/app:/app/server
VOLUME ["/data"]
EXPOSE 8000
ENTRYPOINT ["/entrypoint.sh"]
```

```yaml
# docker-compose.gmat.yml
services:
  gnss-studio:
    build:
      context: ../../..
      dockerfile: api-interop/gnss-predict/docker/Dockerfile.gmat
    platform: linux/amd64
    ports:
      - "127.0.0.1:8000:8000"
    volumes:
      - gnss_data:/data
    environment:
      GNSS_STUDIO_DATA: /data
      GNSS_STUDIO_HOST: "0.0.0.0"
      GNSS_STUDIO_PORT: "8000"
      GMAT_BIN: /opt/gmat/bin/GmatConsole
      # CESIUM_ION_TOKEN: ""
    restart: unless-stopped

volumes:
  gnss_data:
```

---

### ทางเลือก (ข): Python SGP4 Container (`sgp4` / `skyfield` แทน GMAT)

รันได้ native ทั้ง `linux/amd64` และ `linux/arm64` บน `python:3.12-slim` โดย **ต้องพัฒนา Python SGP4 + TEME→ITRF adapter ใน `gnss_predict` เพิ่มเติม** (และควรใช้ `skyfield` + EOP `finals2000A.all` หรือโมดูล TEME→ITRF ที่รองรับ `UT1-UTC` + polar motion เพื่อรักษา parity $< 0.0001^\circ$ กับ GMAT)

**ประมาณการขนาด Image** *(ตัวเลขประมาณการจากขนาด base image + PyPI wheels + EOP/BSP)*:
- `python:3.12-slim` base: ~155 MB
- `curl` + `ca-certificates` + `fastapi` + `uvicorn`: ~25–35 MB
- `sgp4` อย่างเดียว (~1 MB) หรือ `skyfield` + `numpy` + `jplephem` + `finals2000A.all` (+ `de421.bsp` ~17 MB): ~45–65 MB
- `web/dist` (รวม Cesium assets): ~20–30 MB
- **รวมประมาณ ~240–300 MB**

```dockerfile
# syntax=docker/dockerfile:1
FROM --platform=$BUILDPLATFORM node:22-slim AS web-build
WORKDIR /src/web
COPY api-interop/gnss-predict/web/package*.json ./
RUN npm ci
COPY api-interop/gnss-predict/web/ ./
RUN npm run build

FROM python:3.12-slim AS runtime
ENV PYTHONUNBUFFERED=1 \
    TZ=UTC \
    GNSS_STUDIO_DATA=/data \
    GNSS_STUDIO_HOST=0.0.0.0 \
    GNSS_STUDIO_PORT=8000 \
    GNSS_PROPAGATOR_BACKEND=python-sgp4

RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY api-interop/gnss-predict/server/requirements.txt ./server/requirements.txt
# หมายเหตุ: ต้องเพิ่ม sgp4 (และ skyfield + numpy + ไฟล์ EOP) เมื่อ implement Python SGP4 backend
RUN pip install --no-cache-dir -r ./server/requirements.txt sgp4 skyfield numpy

COPY api-interop/gnss-predict/gnss_predict ./gnss_predict
COPY api-interop/gnss-predict/templates ./templates
COPY api-interop/gnss-predict/server ./server
COPY --from=web-build /src/web/dist ./web/dist
COPY api-interop/gnss-predict/docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV PYTHONPATH=/app:/app/server
VOLUME ["/data"]
EXPOSE 8000
ENTRYPOINT ["/entrypoint.sh"]
```

```yaml
# docker-compose.sgp4.yml
services:
  gnss-studio:
    build:
      context: ../../..
      dockerfile: api-interop/gnss-predict/docker/Dockerfile.sgp4
    ports:
      - "127.0.0.1:8000:8000"
    volumes:
      - gnss_data:/data
    environment:
      GNSS_STUDIO_DATA: /data
      GNSS_STUDIO_HOST: "0.0.0.0"
      GNSS_STUDIO_PORT: "8000"
      GNSS_PROPAGATOR_BACKEND: python-sgp4
    restart: unless-stopped

volumes:
  gnss_data:
```

---

### ทางเลือก (ค): Server + Web UI Only (ไม่มี Orbit Engine ใน Image / ต่อ External Engine)

Image มีเพียง FastAPI + Uvicorn + `gnss_predict` + `web/dist` + `curl` โดย **ไม่มี GMAT และไม่มี SGP4 library** ใช้ได้ทันทีกับโค้ดปัจจุบันโดยไม่ต้องแก้ application code:
- เปิดดู/ส่งออกผล `ephem/` และ `access/` ที่มีอยู่แล้วใน volume `/data`
- รัน `fetch`, แก้ไข scenario/workbook, รัน `analyze` และ `validate` บน `ephem/<hash>` ที่มีอยู่แล้วได้
- `GET /api/health` คืน `"gmat_found": false` และหากสั่ง job ที่ต้อง propagate ใหม่จะล้มเหลวด้วย `GMAT_NOT_FOUND` — ยกเว้นผู้ใช้ mount GMAT Linux binary จากภายนอกเข้ามาแล้วตั้ง `GMAT_BIN`

**ประมาณการขนาด Image** *(ตัวเลขประมาณการจากขนาด base image + dependencies)*:
- `python:3.12-slim`: ~155 MB
- `curl` + `ca-certificates` + `fastapi` + `uvicorn`: ~25–35 MB
- `web/dist`: ~20–30 MB
- **รวมประมาณ ~200–240 MB**

```dockerfile
# syntax=docker/dockerfile:1
FROM --platform=$BUILDPLATFORM node:22-slim AS web-build
WORKDIR /src/web
COPY api-interop/gnss-predict/web/package*.json ./
RUN npm ci
COPY api-interop/gnss-predict/web/ ./
RUN npm run build

FROM python:3.12-slim AS runtime
ENV PYTHONUNBUFFERED=1 \
    TZ=UTC \
    GNSS_STUDIO_DATA=/data \
    GNSS_STUDIO_HOST=0.0.0.0 \
    GNSS_STUDIO_PORT=8000

RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY api-interop/gnss-predict/server/requirements.txt ./server/requirements.txt
RUN pip install --no-cache-dir -r ./server/requirements.txt

COPY api-interop/gnss-predict/gnss_predict ./gnss_predict
COPY api-interop/gnss-predict/templates ./templates
COPY api-interop/gnss-predict/server ./server
COPY --from=web-build /src/web/dist ./web/dist
COPY api-interop/gnss-predict/docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV PYTHONPATH=/app:/app/server
VOLUME ["/data"]
EXPOSE 8000
ENTRYPOINT ["/entrypoint.sh"]
```

```yaml
# docker-compose.server-only.yml
services:
  gnss-studio:
    build:
      context: ../../..
      dockerfile: api-interop/gnss-predict/docker/Dockerfile.server-only
    ports:
      - "127.0.0.1:8000:8000"
    volumes:
      - gnss_data:/data
      # ตัวเลือกเสริม: mount GMAT Linux ที่ติดตั้งบน host หรือ volume แยกเข้ามาเมื่อใช้ external engine
      # - /opt/gmat:/opt/gmat:ro
    environment:
      GNSS_STUDIO_DATA: /data
      GNSS_STUDIO_HOST: "0.0.0.0"
      GNSS_STUDIO_PORT: "8000"
      # GMAT_BIN: /opt/gmat/bin/GmatConsole
    restart: unless-stopped

volumes:
  gnss_data:
```

---

## 5. ตารางเปรียบเทียบข้อดี / ข้อเสียของทั้ง 3 ทางเลือก

| เกณฑ์ | (ก) Official GMAT Linux | (ข) Python SGP4 | (ค) Server + Web UI only |
|---|---|---|---|
| **ขนาด Image (ประมาณ)** | ~1.25–1.55 GB (~600–700 MB ถ้า trim) | ~240–300 MB | ~200–240 MB |
| **แก้โค้ดแอปเพิ่ม** | **ไม่ต้อง** (ใช้ได้กับโค้ดปัจจุบันทันที) | **ต้องแก้** (`propagate.py`, `predict.py`, `health.py`, `ENGINE_VERSION`) | **ไม่ต้อง** (ใช้ได้ทันที; propagate ใหม่ไม่ได้ถ้าไม่ mount engine) |
| **รองรับ Apple Silicon (`arm64`)** | ต้องรัน `linux/amd64` (emulation) หรือ compile GMAT เอง | **Native multi-arch** (`amd64` + `arm64`) | **Native multi-arch** (`amd64` + `arm64`) |
| **ความตรงกับผล GMAT (`≤ 0.0001°`)** | **100%** (เป็น engine ตัวเดียวกัน) | ต้องใช้ EOP (`UT1-UTC` + polar motion) มิฉะนั้นคลาด ~0.004°–0.007° | N/A (ขึ้นกับ external engine หรือใช้ผลเดิมใน volume) |
| **ความเร็ว Propagate (130 ดวง/24 ชม.)** | ช้ากว่า (~6–60 วินาที, spawn GMAT) | เร็วมาก (< 0.5 วินาที, in-process/C++) | N/A |
| **License / Supply-chain** | Apache 2.0 + third-party notices; tarball SourceForge 401.7 MB | MIT (`sgp4`/`skyfield`) + PyPI wheels | Apache 2.0 (แอป) + MIT (`fastapi`/`uvicorn`) |
| **ความเสี่ยงหลัก** | Image ใหญ่, ไม่มี `arm64` binary, ต้องตรวจ checksum & ปิด GUI plugin | ต้องเขียน+ทวนสอบ TEME→ITRF และทดสอบ parity 4 ระบบใหม่ทั้งหมด | ผู้ใช้สั่ง propagate/daily ไม่ได้หากไม่ mount GMAT |

---

## 6. ข้อเสนอแนะที่อ้างอิงหลักฐาน (Recommendations)

1. **ระยะสั้น / Phase แรก (ตามแผน Subtask 5 ใน `docs/2026-11-11-gnss-studio-design.md`) — แนะนำทางเลือก (ก) Official GMAT Linux Container (`gmat-ubuntu-x64-R2026a.tar.gz`)**:
   - **เหตุผลเชิงหลักฐาน**:
     - เป็นทางเดียวที่ใช้งานได้ **100% ทันทีโดยไม่แก้โค้ด `gnss_predict` หรือ `server`** และผ่านเกณฑ์ parity `Az/El ต่างจาก macOS ≤ 0.0001°` (`§10.2` ข้อ 5) โดยตรง เพราะใช้ `SPICESGP4` (`spke10_`) + `EarthFixed` (FK5/EOP) ชุดเดียวกับ macOS
     - จากการตรวจ `src/console/CMakeLists.txt` และ `Moderator.cpp` ยืนยันแล้วว่า `GmatConsole` ไม่ใช้ Qt และไม่ link wxWidgets/GTK; เพียงปิด `OpenFramesInterface`, `OVtoOFI`, `PythonInterface`, `MatlabInterface` ใน `gmat_startup_file.txt` ก็รันแบบ headless ได้โดยไม่ต้องติดตั้ง `Xvfb`/X11
   - **ข้อปฏิบัติบังคับ**: pin checksum (`SHA1`/`MD5`) ของ tarball จาก SourceForge ใน `Dockerfile`, ใช้ `ubuntu:22.04` (`linux/amd64`), ติดตั้ง `curl` + `ca-certificates` (จำเป็นสำหรับ CDDIS FTPS ใน `brdc.py`/`sp3.py`), และ seed `/data/settings.json` (`{"daily":{"enabled":false}}`) ใน entrypoint

2. **ระยะกลาง (หากต้องการ Image เล็ก ~250 MB และรองรับ `linux/arm64` native บน Apple Silicon / Cloud ARM) — พิจารณาทางเลือก (ข) แบบมีเงื่อนไข**:
   - ทำเป็น **optional propagator backend** (คง GMAT เป็น default เพื่อความเข้ากันได้ของ `gnss_predict/predict.py` และ `validate.py`)
   - **เงื่อนไขทางเทคนิคที่ห้ามข้าม**: ต้องแปลง `TEME → ITRF/ECEF` ด้วย **`UT1-UTC` และ polar motion** (เช่น `skyfield` + `finals2000A.all` หรือ parser อ่านไฟล์ `eopc04` ของ GMAT) ไม่ใช่แค่ `sgp4` + GMST(UTC) มิฉะนั้นจะเกิด error จาก Earth rotation สูงถึง ~1.7–2.8 กม. (~0.004°–0.007°) และต้องรันชุดทดสอบความแม่นยำเทียบ GMAT และ MGEX SP3 ทั้ง 4 ระบบ (`G`, `R`, `E`, `C`) ก่อนเปิดใช้งานจริง

3. **กรณีใช้งานเป็น Viewer / API Server น้ำหนักเบา — ใช้ทางเลือก (ค)**:
   - เหมาะสำหรับเครื่องหรือ deployment ที่ต้องการเปิดดู/วิเคราะห์ซ้ำจาก `ephem/` ที่มีอยู่แล้วใน `/data` volume หรือแยก GMAT binary ไว้ใน volume/sidecar ภายนอกที่ตั้ง `GMAT_BIN` เข้ามาแทนการฝัง tarball 1+ GB ใน image ทุกครั้งที่ build แอป

4. **การปรับปรุงโค้ดในอนาคตที่ควรพิจารณา (นอกขอบเขตงานวิจัยนี้)**:
   - พิจารณาแก้ default ของ `Daily.enabled` ใน `server/gnss_studio_server/settings.py` หรือเพิ่ม env var เช่น `GNSS_STUDIO_DAILY_ENABLED=false` เพื่อให้ปิดงานประจำวันได้โดยไม่ต้องพึ่ง entrypoint script สร้าง `settings.json`
   - พิจารณาเพิ่ม support ให้ `gnss-predict/server` serve static files ของ `models/` (ขนาด ~113 MB ปัจจุบัน) ด้วยหากรวมโมเดล 3 มิติเข้าหน้าเว็บ Cesium ในงานถัดไป
