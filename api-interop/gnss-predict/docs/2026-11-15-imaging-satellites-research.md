# งานวิจัยและข้อเสนอการออกแบบ: การรองรับดาวเทียมถ่ายภาพโลก 8 ดวง (Earth Observation / Weather Satellites) ใน GNSS Studio

**วันที่:** 2026-11-15  
**Worktree / Branch เป้าหมาย:** `/Users/phuwish/SSSGMAT/.worktrees/gnss-studio-models` (`feature/gnss-studio-models`)  
**ขอบเขตเอกสาร:** เอกสารศึกษาและออกแบบเชิงเทคนิค (Research & Technical Design Document) ครอบคลุมข้อมูลวงโคจรและแคช TLE/OMM, พารามิเตอร์กล้องสำหรับ Sensor View, การสำรวจ Engine ปัจจุบันระดับ `file:line`, การจับคู่โมเดล 3 มิติกับชั้นภาพ NASA GIBS, และข้อเสนอสถาปัตยกรรมสำหรับการพัฒนาต่อ

---

## 1. ข้อมูลดาวเทียมกล้อง 8 ดวง

### 1.1 ตารางข้อมูลเฉพาะของดาวเทียมทั้ง 8 ดวง (Verified Identifiers & Orbital Parameters)

ค่าความสูงวงโคจรจริง (Actual Mean Altitude) และองค์ประกอบวงโคจรด้านล่างคำนวณโดยตรงจากเรคคอร์ด OMM ล่าสุดในแคช `/Users/phuwish/SSSGMAT/api-interop/gnss-predict/data/orbits/_cache/*20261112T0719Z.json` เทียบกับค่า $R_E = 6371.0088\text{ km}$ (`web/src/cesium/swath.ts:12`) และ $\mu = 398600.4418\text{ km}^3/\text{s}^2$

| # | ชื่อดาวเทียม | NORAD ID | COSPAR ID (`OBJECT_ID`) | ประเภทวงโคจร & ตำแหน่งสำคัญ | ความสูงตามสเปก (Nominal) | ความสูงเฉลี่ยในแคช OMM (min–max) | ความเอียงวงโคจร (`INCLINATION`) | CelesTrak Groups (ตามเอกสาร CelesTrak) |
|---|---|---|---|---|---|---|---|---|
| 1 | **Himawari-9** | `41836` | `2016-064A` | GEO (~140.7°E, JMA) | ~35,786 km | 35,785.53 km (35,781.81–35,789.24) | 0.0379° | `weather`, `geo` |
| 2 | **GOES-18** (`GOES 18`) | `51850` | `2022-021A` | GEO (~137.0°W / GOES-West, NOAA) | ~35,786 km | 35,787.59 km (35,787.20–35,787.98) | 0.0047° | `weather`, `goes`, `geo` |
| 3 | **GOES-19** (`GOES 19`) | `60133` | `2024-119A` | GEO (~75.2°W / GOES-East, NOAA) | ~35,786 km | 35,786.45 km (35,783.72–35,789.18) | 0.0097° | `weather`, `goes`, `geo` |
| 4 | **Terra** | `25994` | `1999-068A` | LEO Sun-Synchronous (Descending ~10:30 LT) | 705 km (เดิม) | **689.32 km** (686.84–691.79)* | 97.9268° | `science`, `resource`, `visual` |
| 5 | **Aqua** | `27424` | `2002-022A` | LEO Sun-Synchronous (Ascending ~13:30 LT) | 705 km (เดิม) | **685.84 km** (685.07–686.61)* | 98.4488° | `science` (ปกติ), `resource`, `visual` |
| 6 | **Suomi NPP** | `37849` | `2011-061A` | LEO Sun-Synchronous (Ascending ~13:30 LT) | ~824 km | 826.90 km (826.41–827.39) | 98.8113° | `weather`, `noaa`, `resource` |
| 7 | **NOAA-20** (`NOAA 20 (JPSS-1)`) | `43013` | `2017-073A` | LEO Sun-Synchronous (Ascending ~13:30 LT, 180° จาก SNPP) | ~824–833 km | 826.92 km (826.13–827.71) | 98.7922° | `weather`, `noaa`, `resource` |
| 8 | **NOAA-21** (`NOAA 21 (JPSS-2)`) | `54234` | `2022-150A` | LEO Sun-Synchronous (Ascending ~13:30 LT, 90° เฟส JPSS) | ~824–833 km | 826.85 km (824.97–828.72) | 98.7202° | `weather`, `noaa`, `resource` |

> **หมายเหตุสำคัญด้านวงโคจร (`Terra` & `Aqua`):** จากข้อมูล OMM จริงในแคช ปัจจุบันทั้ง **Terra** (689.3 km) และ **Aqua** (685.8 km) อยู่ในช่วงลดระดับ/ปล่อยวงโคจรลอย (orbit-lowering / drifting phase) ต่ำกว่าความสูงดั้งเดิม 705 km แล้ว ส่งผลให้คาบโคจรเร็วขึ้น (`MEAN_MOTION` ~14.61–14.62 rev/day) และความกว้างแถบภาพ (swath width) ที่มุมสแกนเท่าเดิมแคบลงเล็กน้อยเมื่อเทียบกับสเปก 705 km (ดูรายละเอียดในหัวข้อ 2)

---

### 1.2 กลุ่ม CelesTrak ที่แอปโหลดในปัจจุบัน vs สิ่งที่มีจริงใน `_cache`

#### กลไกการดาวน์โหลดในโค้ดปัจจุบัน
1. **`gnss_predict/config.py:42-46`** กำหนดเฉพาะกลุ่ม GNSS 4 กลุ่ม:
   ```python
   GNSS_GROUPS: dict[str, str] = {"G": "gps-ops", "R": "glo-ops", "E": "galileo", "C": "beidou"}
   CELESTRAK_GP_URL = "https://celestrak.org/NORAD/elements/gp.php?GROUP={group}&FORMAT=json"
   CELESTRAK_MIN_INTERVAL_S = 7200  # 2 hours between fetches per group
   ```
   และกำหนดโฟลเดอร์แคชที่ `config.py:67` เป็น `OMM_CACHE_DIR = DATA_DIR / "orbits" / "_cache"`.
2. **`gnss_predict/omm.py:165-227`** (`fetch_group`) ดาวน์โหลดจาก CelesTrak GP endpoint ในรูปแบบ **JSON array (OMM)** (ไม่ใช่ `.txt` 3LE) แล้วบันทึกเป็น `<group>_YYYYMMDDTHHMMZ.json` พร้อมอัปเดตตัวจับเวลา rate-limit ใน `celestrak_state.json`.
3. **`gnss_predict/studio.py:174-264`** (`_system_letters`, `fetch_snapshot`, `_snapshot`, `_files_sha256`) อ่านและดาวน์โหลด **เฉพาะกลุ่มใน `GNSS_GROUPS` (`G/R/E/C`)** เท่านั้น ไม่มีโค้ดชุดใดใน `gnss_predict/` หรือ `server/gnss_studio_server/` ที่สั่งดาวน์โหลด `weather`, `goes`, `resource`, `noaa`, `science` หรือ `visual` ใน workflow ปัจจุบัน

#### ผลตรวจแคช `/Users/phuwish/SSSGMAT/api-interop/gnss-predict/data/orbits/_cache` (Read-Only Inspection)
ตรวจสอบด้วย `python3 -I` ณ เวลาอ้างอิงระบบ **`2026-11-14T20:38:11.248782+00:00` (UTC)**:

- **ไฟล์ทั้งหมดที่มีอยู่ใน `_cache`:** ไม่มีไฟล์ `.txt` เลย ทุกไฟล์เป็น JSON OMM ของ CelesTrak ได้แก่:
  - `amateur`: `20261111T1812Z`, `20261112T0719Z`, `20261113T1353Z`, `20261114T0359Z`, `20261114T1319Z` (41,486–41,863 B)
  - `cubesat`: `20261111T1829Z`, `20261112T0719Z`
  - `galileo`: `20261111T1829Z`, `20261112T0719Z`
  - `glo-ops`: `20261111T1829Z`, `20261112T0719Z`
  - `gps-ops`: `20261111T1829Z`, `20261112T0719Z`
  - `iridium-NEXT`: `20261111T1829Z`, `20261112T0719Z`
  - `last-30-days`: `20261111T1829Z`, `20261112T0719Z`
  - `science`: `20261111T1829Z`, `20261112T0719Z` (45 records; mtime `2026-11-12T07:19:49Z`)
  - `visual`: `20261111T1829Z`, `20261112T0719Z` (156 records; mtime `2026-11-12T07:19:55Z`)
  - `weather`: `20261111T1829Z`, `20261112T0719Z` (74 records; mtime `2026-11-12T07:19:57Z`)
  - `celestrak_state.json` (1,082 B — บันทึกล่าสุด `amateur` ที่ `2026-11-14T13:19:00Z` ส่วนอีก 9 กลุ่มรวม `weather`, `science`, `visual` บันทึกล่าสุดที่ `2026-11-12T07:19:34Z`)
  - `brdc/` (ไดเรกทอรีเก็บไฟล์ BRDC)
- **ไฟล์ที่ไม่มีใน `_cache`:** **ไม่มี** `goes_*.json`, `resource_*.json`, `noaa_*.json`
- **ความครอบคลุมจริงในแคชปัจจุบัน:** แม้จะไม่มี `goes`, `resource`, `noaa` **แต่ดาวเทียมทั้ง 8 ดวงมีอยู่ในแคชปัจจุบันครบ 100% แล้ว** ผ่านกลุ่ม `weather` (6 ดวง) + `science` (Terra) + `visual` (Terra และ Aqua):

| ดาวเทียม | ไฟล์แคชล่าสุดที่พบ & ตำแหน่ง (`index`) | `OBJECT_NAME` ในไฟล์ | `NORAD_CAT_ID` | `OBJECT_ID` | `EPOCH` (UTC) | อายุ TLE ณ `2026-11-14T20:38:11Z` | หมายเหตุ |
|---|---|---|---|---|---|---|---|
| Himawari-9 | `weather_20261112T0719Z.json` `[20]` | `HIMAWARI-9` | `41836` | `2016-064A` | `2026-11-09T21:50:26.738016` | **118.80 ชม. (4.95 วัน)** | เกิน `AGE_OK_DAYS=2.0` แต่ยังอยู่ใน 7 วัน |
| GOES-18 | `weather_20261112T0719Z.json` `[40]` | `GOES 18` | `51850` | `2022-021A` | `2026-11-10T12:10:42.058272` | **104.46 ชม. (4.35 วัน)** | เกิน `AGE_OK_DAYS=2.0` แต่ยังอยู่ใน 7 วัน |
| GOES-19 | `weather_20261112T0719Z.json` `[69]` | `GOES 19` | `60133` | `2024-119A` | `2026-11-11T20:42:18.141408` | **71.93 ชม. (3.00 วัน)** | |
| Terra | `science_20261112T0719Z.json` `[5]`, `visual_20261112T0719Z.json` `[102]` | `TERRA` | `25994` | `1999-068A` | `2026-11-11T21:18:07.605792` | **71.33 ชม. (2.97 วัน)** | ระวัง: `cubesat[77]` คือ `ROBUSTA-3A (MEDITERRANEE)` (NORAD `60243`) ไม่ใช่ Terra |
| Aqua | **`visual_20261112T0719Z.json` `[107]`** (ไม่อยู่ใน `science` หรือ `weather`) | `AQUA` | `27424` | `2002-022A` | `2026-11-11T22:13:04.678176` | **70.42 ชม. (2.93 วัน)** | ในแคชปัจจุบันมีใน `visual` เท่านั้น; ในอนาคตควรดึง `resource` เพิ่มเพราะ `visual` เป็นกลุ่ม 100 Brightest |
| Suomi NPP | `weather_20261112T0719Z.json` `[8]` | `SUOMI NPP` | `37849` | `2011-061A` | `2026-11-11T22:29:17.211264` | **70.15 ชม. (2.92 วัน)** | |
| NOAA-20 | `weather_20261112T0719Z.json` `[31]` | `NOAA 20 (JPSS-1)` | `43013` | `2017-073A` | `2026-11-11T21:07:55.549920` | **71.50 ชม. (2.98 วัน)** | |
| NOAA-21 | `weather_20261112T0719Z.json` `[41]` | `NOAA 21 (JPSS-2)` | `54234` | `2022-150A` | `2026-11-11T20:10:18.639264` | **72.46 ชม. (3.02 วัน)** | |

> **ข้อสังเกตจากการตรวจแคช:** หากเพิ่มกลุ่ม **`weather` + `resource` + `science`** (และ option `goes` / `noaa` / `visual`) จะครอบคลุมทั้ง 8 ดวงอย่างเสถียรกว่าการพึ่ง `visual` เพียงอย่างเดียวสำหรับ Aqua เพราะกลุ่ม `resource` เป็นกลุ่ม Earth Resources ทางการของ CelesTrak สำหรับ EOS (`Terra`, `Aqua`, `Landsat`, ฯลฯ) และ `weather` ครอบคลุม JPSS + GEO หลักทั้งหมด

---

## 2. กล้องหลักและพารามิเตอร์ Sensor สำหรับ Sensor View

### 2.1 ข้อมูลกล้องหลักและกล้องรอง

| ดาวเทียม | กล้องหลัก (Primary Imager) | กลไกการสแกน & ช่องสัญญาณ | ความกว้างภาพ (Swath / Frame) | กล้อง/อุปกรณ์รองที่สำคัญ |
|---|---|---|---|---|
| **Himawari-9** | **AHI** (Advanced Himawari Imager) | 2-axis scan mirror, 16 bands (0.47–13.3 µm), 0.5 km (Red B3), 1–2 km (VNIR/IR), Full Disk ทุก 10 นาที | **Full Disk** ($17.76^\circ \times 17.76^\circ$ scan frame ครอบคลุมจานโลกทั้งหมด) | **SEDA** (Space Environment Data Acquisition Monitor) |
| **GOES-18, GOES-19** | **ABI** (Advanced Baseline Imager) | 2-axis scan mirror, 16 bands (0.47–13.3 µm), 0.5 km (Red B2), 1–2 km (VNIR/IR), Mode 6 Full Disk ทุก 10 นาที | **Full Disk** ($17.76^\circ \times 17.76^\circ$ / East-West & North-South $\pm 8.88^\circ$) | **GLM** (Geostationary Lightning Mapper), **SUVI**, **EXIS**, **SEISS**, **MAG** |
| **Terra** | **MODIS** (Moderate Resolution Imaging Spectroradiometer) | Cross-track whiskbroom paddle mirror ($\pm 55.0^\circ$), 36 bands (0.4–14.4 µm), 250 m / 500 m / 1 km | **2,330 km** (ณ $h=705\text{ km}$); แถบสแกนตามแนวบิน (along-track) 10 km ที่ nadir | **ASTER** (90–15 m, swath 60 km), **CERES**, **MISR** (360 km), **MOPITT** |
| **Aqua** | **MODIS** | สเปกเดียวกับ MODIS บน Terra | **2,330 km** (ณ $h=705\text{ km}$); along-track 10 km ที่ nadir | **AIRS** ($\pm 49.5^\circ$, ~1,650 km), **AMSU-A**, **CERES** |
| **Suomi NPP, NOAA-20, NOAA-21** | **VIIRS** (Visible Infrared Imaging Radiometer Suite) | Cross-track whiskbroom rotating telescope assembly ($\pm 56.28^\circ$), 22 bands (375 m I-bands, 750 m M-bands + Day/Night Band) | **3,040–3,060 km** (ที่ 824–830 km; คำนวณได้ 3,038 km ที่ $h=824$, 3,052 km ที่ $h=826.9$, 3,082 km ที่ $h=833$) | **CrIS**, **ATMS**, **OMPS** (และ **CERES** บน Suomi NPP & NOAA-20) |

---

### 2.2 การพิสูจน์เรขาคณิต (Exact Orbital & Sensor Geometry)

ใช้รัศมีโลกเฉลี่ยของโค้ดเบส **`R_E = 6371.0088 km`** (`web/src/cesium/swath.ts:12` และ `web/src/cesium/sensorGeometry.ts`) สำหรับคำนวณมุม 2 ประเภทที่มักสับสนกัน:

1. **มุมครึ่งจานโลก / ขอบฟ้าจากจุดใต้ดาว (Nadir-to-Limb Earth Horizon Half-Angle, $\rho$):**
   $$\rho = \arcsin\!\left(\frac{R_E}{R_E + h}\right)$$
   - สำหรับดาวเทียม GEO ($h \approx 35,786\text{ km}$): $\rho = 8.692^\circ$ → **ขนาดเชิงมุมเต็มจานโลก (Earth Angular Diameter) $= 2\rho \approx 17.384^\circ$** ($\approx 17.4^\circ$).
   - สำหรับดาวเทียม LEO ($h = 686\text{–}833\text{ km}$): $\rho \approx 62.17^\circ\text{–}64.48^\circ$ **กว้างกว่ามุมสแกนของ MODIS/VIIRS** เพราะเซ็นเซอร์ LEO ไม่ได้ถ่ายภาพจนถึงขอบฟ้า เนื่องจากความบิดเบี้ยวเชิงรังสีและบรรยากาศ (air mass) ที่มุมเฉียงสูงเกินไป

2. **ความสัมพันธ์ระหว่างมุมครึ่ง FOV ของกล้อง ($\alpha$) กับความกว้าง Swath ($W$) บนผิวโลกทรงกลม:**
   จากกฎของไซน์ในสามเหลี่ยม ศูนย์กลางโลก–ดาวเทียม–ขอบ Swath (สำหรับ $\alpha \le \rho$):
   $$\sin\eta = \frac{R_E + h}{R_E}\sin\alpha, \qquad \phi = \eta - \alpha, \qquad W = 2 R_E \phi$$
   โดย $\eta$ คือมุมตกกระทบวัดจากเส้นแนวดิ่งท้องถิ่นที่ขอบ swath (complement ของ elevation angle $\varepsilon = 90^\circ - \eta$) และ $\phi$ คือ Earth central half-angle:

| กล้อง / ดาวเทียม | ความสูงคำนวณ $h$ (km) | มุมขอบฟ้า $\rho$ | มุมสแกน $\alpha$ (Half Cross-Track) | มุมศูนย์กลางโลก $\phi$ | Swath Width $W$ | มุมเงยขั้นต่ำที่ขอบ Swath ($\varepsilon = 90^\circ - \eta$) |
|---|---|---|---|---|---|---|
| **AHI / ABI (GEO Full Disk)** | 35,786.0 (Nominal / Cache) | 8.692° | **8.692°** (Limb) / **8.88°** (Scan Frame) | 81.31° (Limb) | 18,084 km (เต็มซีกโลก) | 0.0° (ขอบฟ้า) |
| **MODIS (Terra/Aqua)** — Nominal | 705.0 | 64.21° | **55.00°** | 10.48° | **2,330.1 km** | 24.52° |
| **MODIS (Terra)** — Cache OMM | 689.3 | 64.43° | **55.00°** *(หรือ 55.52° เพื่อ W=2330)* | 10.20° | **2,268.4 km** | 24.80° |
| **MODIS (Aqua)** — Cache OMM | 685.8 | 64.48° | **55.00°** *(หรือ 55.64° เพื่อ W=2330)* | 10.14° | **2,254.8 km** | 24.86° |
| **VIIRS (Suomi NPP)** — Nominal | 824.0 | 62.31° | **56.28°** | 13.66° | **3,038.0 km** (~3,040 km) | 20.06° |
| **VIIRS (SNPP/N20/N21)** — Cache OMM | 826.9 | 62.26° | **56.28°** | 13.72° | **3,052.0 km** | 20.00° |
| **VIIRS (JPSS Nominal)** | 833.0 | 62.17° | **56.28°** | 13.86° | **3,081.8 km** | 19.86° |

> **สแกนตามแนวบิน (Along-Track Instantaneous Scan Strip):**  
> - **MODIS:** 10 แถวตัวตรวจจับ × 1 km = **10 km** ที่ nadir $\Rightarrow$ $\alpha_{\text{along}} = \arctan(5 / 705) = \mathbf{0.406^\circ}$ (มุมเต็ม $0.813^\circ$)  
> - **VIIRS:** 16 แถว M-band × 750 m = **12 km** (I-band 32×375 m) ที่ nadir $\Rightarrow$ $\alpha_{\text{along}} = \arctan(6 / 827) \approx \mathbf{0.416^\circ}$ (มุมเต็ม $\sim 0.83^\circ$)

---

### 2.3 พารามิเตอร์ที่แนะนำสำหรับ Sensor View (STK & Cesium)

อ้างอิงแนวทาง STK (`docs/2026-11-11-gnss-studio-stk-reference.md:100-113`) และเอกสาร Sensor v1 (`docs/2026-11-13-gnss-studio-sensor-design.md`):

| กลุ่มดาวเทียม | แนะนำใน Sensor Engine สมบูรณ์ (STK Pattern) | ค่าพารามิเตอร์แนะนำ (`Half Angles`) | ค่าแนะนำใน Engine v1 ปัจจุบัน (รองรับเฉพาะ `Simple Conic`) | สูตร Camera FOV ของ Sensor View (`min(2α × 1.05, 120°)`) |
|---|---|---|---|---|
| **Himawari-9 (`AHI`), GOES-18/19 (`ABI`)** | **`Simple Conic`** (หรือ `Rectangular` $8.88^\circ \times 8.88^\circ$ หากต้องการกรอบสแกน) | `Cone Half Angle` = **`8.7°`** (พอดีขอบโลก $8.692^\circ$) หรือ **`8.9°`** (กรอบสแกนเต็ม $8.88^\circ$) | **`Simple Conic`** **`8.7°`** *(ข้อสังเกต: `defaultConeHalfAngleDeg` ที่ `sensorGeometry.ts:71` ใช้ $\rho + 0.5^\circ = 9.2^\circ$ ซึ่งจะรวมอวกาศรอบโลกเพิ่มขึ้นเล็กน้อย)* | $2 \times 8.7^\circ \times 1.05 \approx \mathbf{18.3^\circ}$ |
| **Terra & Aqua (`MODIS`)** | **`Rectangular`** (Cross-track × Along-track) | `Horizontal Half Angle` = **`55.0°`** (Cross-track)<br>`Vertical Half Angle` = **`0.41°`** (10 km strip; หรือตั้งเป็น `2°–5°` สำหรับแถบที่มองเห็นชัดในฉาก 3 มิติ) | **`Simple Conic`** **`55.0°`** (เพื่อแสดงขอบเขตมุมสแกนสูงสุดบนพื้นโลกชั่วคราวก่อนมี `Rectangular`) | $2 \times 55.0^\circ \times 1.05 = \mathbf{115.5^\circ}$ (ไม่ชนเพดาน `120°`) |
| **Suomi NPP, NOAA-20, NOAA-21 (`VIIRS`)** | **`Rectangular`** (Cross-track × Along-track) | `Horizontal Half Angle` = **`56.28°`** (Cross-track)<br>`Vertical Half Angle` = **`0.42°`** (12 km strip; หรือ `2°–5°` เพื่อแสดงผลในฉาก 3 มิติ) | **`Simple Conic`** **`56.28°`** (แสดงขอบเขตสแกนสูงสุดชั่วคราวก่อนมี `Rectangular`) | $2 \times 56.28^\circ \times 1.05 = \mathbf{118.2^\circ}$ (ไม่ชนเพดาน `120°`) |

> **หมายเหตุสำคัญเรื่องแกน Sensor:** โมดูล `web/src/cesium/sensorGeometry.ts:79-90` (`bodyFrame`) นิยามกรอบตัวดาวด้วย **Nadir alignment with ECI velocity constraint** (`+Z = -r̂`, `+X = perp(v_ECI, Z)`, `+Y = Z × X`) อยู่แล้ว ซึ่งตรงกับท่าทางมาตรฐานของดาวเทียม LEO กล้องถ่ายภาพ (cross-track scan อยู่ในระนาบ Y–Z ของ body frame ตามแนวตั้งฉากกับทิศความเร็ว `+X`) จึงสามารถวาง Sensor `Horizontal` (cross-track รอบแกน X / กว้างไปทาง $\pm Y$) และ `Vertical` (along-track ไปทาง $\pm X$) ได้โดยตรง

---

## 3. สำรวจ Engine ปัจจุบัน (`api-interop/gnss-predict/gnss_predict/`)

การตรวจสอบโค้ดทั้งหมดใน `/Users/phuwish/SSSGMAT/.worktrees/gnss-studio-models/api-interop/gnss-predict/` พบการผูกติด (coupling) กับระบบ GNSS (`G/R/E/C`, PRN 3 ตัวอักษร `[GREC]NN`, IGS SINEX, BRDC, SP3 และ DOP) ตามจุดสำคัญต่อไปนี้:

### 3.1 การผูกติดระดับโมดูล (Exact `file:line` Audit)

1. **`gnss_predict/config.py:42, 67`**
   - บรรทัด `42`: `GNSS_GROUPS = {"G": "gps-ops", "R": "glo-ops", "E": "galileo", "C": "beidou"}` กำหนดกลุ่มแคชและดาวน์โหลดไว้เพียง 4 กลุ่ม GNSS ไม่มี `weather`, `science`, `resource`, `visual`, `goes`, `noaa`
2. **`gnss_predict/tle_fetch.py:13, 58-65`** *(Legacy GPS CLI)*
   - บรรทัด `13`: `_PRN_RE = re.compile(r"\(PRN\s*(\d{1,2})\)", re.IGNORECASE)` และบรรทัด `58-65`: บังคับคัดเฉพาะ `1 <= prn <= 32` เท่านั้น ใช้กับดาวเทียมทั่วไปไม่ได้
3. **`gnss_predict/igs_meta.py:24, 60-67, 117`**
   - บรรทัด `24`: `_PRN_RE = re.compile(r"^[A-Z]\d{2}$")` และ `identity_at` (`L117`) แมป `NORAD -> PRN` จาก `igs_satellite_metadata.snx` เท่านั้น ซึ่งไม่มี NORAD ของดาวเทียมถ่ายภาพ
4. **`gnss_predict/catalog.py:48-59, 139-204`**
   - `CatalogSatellite` (`L48-59`) บังคับมี `prn: str` (ใช้เป็น key/ID หลัก) และไม่มีฟิลด์ `category` หรือ `groups`
   - `build_catalog` (`L139-204`): สแกนไฟล์เฉพาะกลุ่มใน `GNSS_GROUPS` (`L151-153`), ถ้า `igs.identity_at(rec.norad_cat_id, ref_dt)` คืน `None` จะถูกโยนไปอยู่ใน `unmapped` ด้วยเหตุผล `"NO_PRN"` ทันที (`L160-163`), คำนวณอายุ TLE เทียบ `AGE_OK_DAYS = 2.0` และตัดทิ้งหลัง `AGE_SHOWN_MAX_DAYS = 7.0` (`L183-188`), และตรวจสุขภาพจาก BRDC (`L189-193`)
5. **`gnss_predict/propagate.py:59-64, 66-96, 190-206`**
   - `write_tle_file` (`L59-64`) เขียนบรรทัดชื่อเป็น `s.prn` (line 0 ของ TLE 3 บรรทัด)
   - `render_ecef_script` (`L66-96`) สร้างสคริปต์ GMAT ด้วย `Create Spacecraft {prn};` (`L72`), `GMAT {prn}.Id = '{prn}';` (`L76`), และรายงาน `{prn}.EarthFixed.X/Y/Z` (`L92-94`) — **ข้อจำกัด GMAT:** ชื่อ `Spacecraft` ต้องขึ้นต้นด้วยตัวอักษรและมีเฉพาะ `[A-Za-z0-9_]` (ชื่ออย่าง `"GOES 18"`, `"HIMAWARI-9"`, `"25994"` จะทำให้ GMAT error!)
   - `ephemeris_from_sp3` (`L190-206`) ใช้ `predicted.sp3` เป็นแหล่งส่งต่อ ephemeris ไปยัง `run_analyze`
6. **`gnss_predict/sp3.py:190, 296-298`**
   - `write_sp3` (`L296-298`) **บังคับ `if len(sat) != 3: raise ValueError(...)`** อย่างเคร่งครัด และ `read_sp3_all` (`L190`) ตัด slice `sat = line[1:4]` เป็นคีย์ 3 ตัวอักษร
7. **`gnss_predict/dop.py:19, 77-99`** *(จุดเสี่ยง Critical)*
   - บรรทัด `19`: `_SYSTEMS = ("ALL", "G", "R", "E", "C")`
   - `dop_series` (`L77-99`) นำดาวทุกดวงใน `rows` (ซึ่งมาจาก `aer_rows(eph, ...)`) ที่มุมเงย $\ge$ `min_el_deg` และไม่ได้ติด flag ใน `DOP_EXCLUDED_FLAGS` เข้าไปคำนวณ **`system == "ALL"`** ทั้งหมด! หากปล่อยให้ดาวเทียมถ่ายภาพเข้ามาอยู่ใน `eph` โดยไม่กรองใน `dop_series` ค่า `ALL` DOP (`n_visible`, `gdop`, `pdop`, ฯลฯ) จะถูกปนเปื้อนผิดพลาดทันที
8. **`gnss_predict/analyze.py:37-49, 115`**
   - `aer_rows` (`L37-49`) คำนวณ `ipp` และ `mf` (ionospheric pierce point) ให้ทุกดวงใน `eph` (ไม่ได้พัง แต่ไม่จำเป็นสำหรับดาวเทียมถ่ายภาพที่ไม่อิงสัญญาณ L-band GNSS); ส่วน `legacy_rows` (`L115`) กรองเฉพาะ `r.prn.startswith("G")`
9. **`gnss_predict/czml.py:71-99`**
   - สร้าง CZML entity ที่ `id: f"sat/{prn}"` พร้อม `position` (`FIXED`, `LAGRANGE` degree 7) โดย**ยังไม่มี `orientation` packet** ใน CZML (การหมุนตัวดาว 3 มิติและการหมุนแผงโซลาร์ยังไม่ถูกคำนวณใน Python หรือส่งออกจาก `czml.py`)
10. **`gnss_predict/studio.py:174-236, 245-265, 327-351, 473-490, 548-603` & `studio_validate.py:28-29, 84-90, 129-155, 210`**
    - `fetch_snapshot` (`studio.py:202-236`), `_snapshot` (`L245-255`), `_files_sha256` (`L258-264`) รับเฉพาะตัวอักษร `"GREC"`
    - `_plan` (`L347`) จับคู่ `norad` กับ `prn_of` (ถ้าไม่มี `prn` ค่าจะเป็น `None` ซึ่งทำให้ `run_propagate` / `write_sp3` ไม่สามารถใช้ `prn` 3 ตัวอักษรได้)
    - `run_validate` (`studio.py:548-603`) และ `validate_ephemeris` (`studio_validate.py:129-155, 210`): ดาวที่ไม่พบใน MGEX SP3 และ `prn[:1] not in "GEC"` จะถูกตีความเป็น `"unverified"` และ `studio_validate.py:151, 210` ดึง `prn[0]` ไปแสดงในรายงานตรวจสอบผล
11. **`server/gnss_studio_server/` (`routes/orbits.py`, `jobs.py`, `worker.py`, `objects.py`, `schema.py`, `templates.py`)**
    - `routes/orbits.py:19, 34, 52-59, 93-98, 101-131` และ `jobs.py:47, 385-389` / `worker.py:33, 111-114` จำกัด `SYSTEM_LETTERS = "GREC"` และ `/orbits/catalog` คืนเฉพาะ `scenario_catalog` (GNSS)
    - `objects.py:31, 56, 282-339`, `schema.py:23, 70, 183-214, 386`, `templates.py:117-128, 152-160`: `SatelliteObj` มีเพียง `name` และ `norad > 0` อยู่แล้ว แต่หน้า `Insert` เปิดใช้งานเฉพาะ `From Satellite Catalog` (ดึงจาก `GNSS_GROUPS`) ส่วน `SensorObj` (`schema.py:201-214`) รองรับเฉพาะ `shape: "Simple Conic"` และ `pointing_type: "Fixed"`
12. **`web/src/cesium/graphics.ts:100-107` และ `sensorDraw.ts:54, 95-104`**
    - `graphics.ts:100-107` หา CZML entity ของดาวจาก `prnByNorad.get(obj.norad)` แล้วแมปเป็น `sat/${prn}` (ดังนั้นหากใช้รหัส slot เช่น `sat/N25994` หรือ `sat/E01` ตาม manifest ที่ส่งมา ฝั่ง Web จะชี้ entity ได้ถูกต้องโดยไม่ต้องแก้ logic ลึก)
    - `sensorDraw.ts:54, 95-104` วาดเฉพาะกรวยทรงกลม (`Simple Conic`) ยังไม่มีเรขาคณิต `Rectangular` pyramid

---

### 3.2 สรุปรายการจุดที่ต้องแก้ (`file:line` Change Plan)

| ไฟล์ & บรรทัด | พฤติกรรมปัจจุบัน | การแก้ไขที่ต้องการ (โดยไม่กระทบ GNSS DOP / SP3) |
|---|---|---|
| `gnss_predict/config.py:42` | มีแค่ `GNSS_GROUPS` (`G/R/E/C`) | เพิ่ม `EO_GROUPS` / `IMAGING_GROUPS` เช่น `{"W": "weather", "S": "science", "R_EO": "resource", "V": "visual"}` (หรือ dict กลุ่มทั่วไปแยกจาก `GNSS_GROUPS`) |
| `gnss_predict/catalog.py:48-59, 139-204` | ปฏิเสธทุกดวงที่ไม่มี IGS PRN (`NO_PRN`); แสกนเฉพาะ `GNSS_GROUPS` | เพิ่มฟิลด์ `category: Literal["gnss", "eo", "other"]` (และ `group`, `cospar_id`), เพิ่ม `build_imaging_catalog` / option `include_groups`, ใช้รหัสภายในที่เป็น GMAT-safe + SP3-safe (หรือ `sat_id`) แทนการบังคับ PRN |
| `gnss_predict/studio.py:174-264, 327-351, 548-603` | `_snapshot`/`_files_sha256`/fetch รับเฉพาะ `GREC`; `_plan` ผูก `prn_of` | รวมไฟล์กลุ่ม EO ใน snapshot hash & fetch, map `norad -> internal_id` + `category`, และกรองส่งเฉพาะ `category == "gnss"` เข้า `run_validate` (SP3/BRDC) |
| `gnss_predict/propagate.py:59-96` & `gnss_predict/sp3.py:296-298` | ใช้ `s.prn` เป็นชื่อ GMAT `Spacecraft` และเขียนผ่าน `write_sp3` (บังคับ 3 chars) | **ทางเลือก A (สะอาดสุด):** เก็บ ephemeris เฉพาะที่ไม่ใช่ GNSS ใน JSON/binary หรือใช้ slot 3 ตัวอักษรเฉพาะทาง เช่น `E01..E99` สำหรับ SP3 ภายในพร้อมตารางแปลงใน `manifest.json`; ตรวจสอบ GMAT identifier sanitization (`[A-Za-z][A-Za-z0-9_]*`) |
| `gnss_predict/dop.py:77-99` | รวมทุกแถวที่อยู่ใน `eph` เข้าคำนวณ `"ALL"` DOP | **สำคัญที่สุด:** เพิ่ม parameter กรอง `gnss_only` หรือตรวจ `sat_id[0] in ("G","R","E","C")` / `category == "gnss"` ก่อนรวมเข้า `"ALL"` ใน `dop_series` |
| `gnss_predict/studio_validate.py:129-155, 210` | ตรวจสอบทุกตัวที่อยู่ใน `predicted.sp3` และถือว่าเป็น `"unverified"` | ข้ามดาวที่ไม่ใช่ GNSS ตั้งแต่ต้นฟังก์ชัน `validate_ephemeris` (หรือก่อนส่งจาก `studio.py:570`) |
| `server/gnss_studio_server/routes/orbits.py`, `jobs.py:47`, `worker.py:33` | `/orbits/catalog` และ `/orbits/fetch` รับเฉพาะ `G/R/E/C` | เปิดพารามิเตอร์กลุ่ม EO (เช่น `weather`, `resource`, `science`) ให้ fetch/catalog ได้ และส่ง metadata กลุ่ม + `category` กลับ UI |
| `server/gnss_studio_server/schema.py:201-214`, `web/src/cesium/sensorGeometry.ts`, `sensorDraw.ts` | Sensor รองรับเฉพาะ `Simple Conic` | เพิ่ม `Rectangular` (`Vertical Half Angle` × `Horizontal Half Angle`) เพื่อรองรับ swath strip ของ MODIS / VIIRS |

---

## 4. การจับคู่กับชั้นภาพ GIBS (`imagery.py`) และโมเดล 3 มิติ (`models/catalog.json`)

### 4.1 สถานะจริงของ `server/gnss_studio_server/imagery.py` ใน Worktree นี้

> [!IMPORTANT]
> **ไม่พบไฟล์ `server/gnss_studio_server/imagery.py` ใน `/Users/phuwish/SSSGMAT/.worktrees/gnss-studio-models` (`feature/gnss-studio-models`)!**  
> จากการตรวจสอบโครงสร้างไดเรกทอรี `server/gnss_studio_server/` และเอกสาร `docs/2026-11-13-gnss-studio-sensor-design.md:8` ยืนยันว่าฟีเจอร์ภาพถ่ายจริงจาก NASA GIBS ถูกวางแผนเป็นงานเสริมแยก ("งานเสริม ข (ภาพถ่ายจริงจาก NASA GIBS)") และยังไม่ได้ถูกสร้างใน worktree นี้ ดังนั้น **ณ สถานะโค้ดปัจจุบัน ดาวเทียมทั้ง 8 ดวงยังไม่มีการจับคู่กับชั้นภาพใน `imagery.py`** — ตารางในหัวข้อ 4.3 ด้านล่างจึงเป็น **สเปกการจับคู่ NASA GIBS WMTS Layer ที่ตรวจสอบแล้ว** สำหรับใช้สร้าง `server/gnss_studio_server/imagery.py` ในขั้นตอนถัดไป

---

### 4.2 การจับคู่โมเดล 3 มิติใน `models/catalog.json` (Verified in Worktree)

โมเดล `.glb` ทั้ง 6 ชุดใน `api-interop/gnss-predict/models/catalog.json` มีครบแล้วสำหรับดาวเทียมทั้ง 8 ดวง พร้อมข้อมูล `norad_ids`, `wing_nodes` และ `cell_normal` ดังนี้:

| ดาวเทียม | Model `id` (`catalog.json`) | ไฟล์ `.glb` | `norad_ids` ที่รองรับ | ขนาด Bounding Box (m) `[X, Y, Z]` | Triangles | `wing_nodes` | `cell_normal` | อ้างอิง `NOTES.md` & รายละเอียด |
|---|---|---|---|---|---|---|---|---|
| **Terra** | `terra` | `terra/terra.glb` | `[25994]` | `[6.811, 13.027, 5.142]` | 13,397 | `["wing-Y"]` | **`"-Z"`** | `models/terra/NOTES.md` — บัส EOS AM-1 16-sided prism, MODIS/ASTER/CERES/MISR/MOPITT บน nadir deck (`+Z`) |
| **Aqua** | `aqua` | `aqua/aqua.glb` | `[27424]` | `[8.828, 16.701, 4.772]` | 12,977 | `["wing-Y"]` | **`"+X"`** | `models/aqua/NOTES.md` — บัส TRW AB1200, แผงโซลาร์เดี่ยวด้าน `-Y` 11.4 m, MODIS/AIRS/AMSU/CERES |
| **Suomi NPP** | `suomi-npp` | `suomi-npp/suomi-npp.glb` | `[37849, 43013]` | `[4.183, 8.959, 2.569]` | 4,024 | `["wing-Y"]` | **`"-X"`** | `models/suomi-npp/NOTES.md` — บัส Ball BCP-2000 ใช้ร่วมกับ NOAA-20 (NORAD `43013`) |
| **NOAA-20** | `suomi-npp` | `suomi-npp/suomi-npp.glb` | `[37849, 43013]` | `[4.183, 8.959, 2.569]` | 4,024 | `["wing-Y"]` | **`"-X"`** | แชร์โมเดล BCP-2000 กับ Suomi NPP ตาม `norad_ids` |
| **NOAA-21** | `noaa-21` | `noaa-21/noaa-21.glb` | `[54234]` | `[4.3, 10.71, 3.118]` | 1,982 | `["wing-Y"]` | **`"-X"`** | `models/noaa-21/NOTES.md` — บัส Northrop Grumman LEOStar-3, ปีกเดี่ยว 5-panel, VIIRS/CrIS/ATMS/OMPS-N/L |
| **GOES-18** | `goes` | `goes/goes.glb` | `[41866, 43226, 51850, 60133]` | `[11.14, 13.444, 12.197]` | 14,799 | `["wing-Y"]` | **`"+Z"`** | `models/goes/NOTES.md` — บัส Lockheed Martin A2100A (GOES-R series 16–19), เสา X-band + Solar Sail |
| **GOES-19** | `goes` | `goes/goes.glb` | `[41866, 43226, 51850, 60133]` | `[11.14, 13.444, 12.197]` | 14,799 | `["wing-Y"]` | **`"+Z"`** | แชร์โมเดล GOES-R กับ GOES-16/17/18 |
| **Himawari-9** | `himawari-9` | `himawari-9/himawari-9.glb` | `[41836, 40267]` | `[5.218, 8.037, 5.3]` | 2,496 | `["wing-Y"]` | **`"-X"`** | `models/himawari-9/NOTES.md` — บัส Mitsubishi Electric DS2000 (แชร์กับ Himawari-8 NORAD `40267`) |

> [!WARNING]
> **ข้อค้นพบสำคัญจาก `models/catalog.json`:**  
> 1. โมเดล GNSS ส่วนใหญ่มี 2 ปีก (`wing+Y`, `wing-Y`) และ `cell_normal = "-X"` (ดู `docs/2026-11-14-gnss-attitude-laws.md`) **แต่โมเดลดาวเทียมกล้องทั้ง 6 ชุดมีเพียงปีกเดียวคือ `["wing-Y"]`**  
> 2. **`cell_normal` ของทั้ง 6 โมเดลมีถึง 4 ทิศทางต่างกัน (`-Z`, `+X`, `-X`, `+Z`)** ห้าม hardcode การหมุนแผงโซลาร์ด้วยมุมคงที่ที่อิง `-X` อย่างเดียว

---

### 4.3 ตารางจับคู่ NASA GIBS WMTS Layers (สำหรับสร้าง `server/gnss_studio_server/imagery.py`)

NASA GIBS ให้บริการผ่าน WMTS REST (`https://gibs.earthdata.nasa.gov/wmts/{epsg4326|epsg3857}/best/{Layer}/default/{Time}/{TileMatrixSet}/{z}/{y}/{x}.{png|jpg}`):

| ดาวเทียม (`NORAD`) | โมเดล 3 มิติ | ชั้นภาพหลักที่แนะนำ (Primary GIBS WMTS Layer) | ชั้นภาพทางเลือก / กลางคืน / IR (Secondary Layers) | ความถี่เวลา (`TIME=`) & หมายเหตุ |
|---|---|---|---|---|
| **Terra** (`25994`) | `terra` | `MODIS_Terra_CorrectedReflectance_TrueColor` | `MODIS_Terra_CorrectedReflectance_Bands721`<br>`MODIS_Terra_CorrectedReflectance_Bands367` | **Daily** (`YYYY-MM-DD`), ~10:30 LT descending swath, ช่อง `.jpg` |
| **Aqua** (`27424`) | `aqua` | `MODIS_Aqua_CorrectedReflectance_TrueColor` | `MODIS_Aqua_CorrectedReflectance_Bands721`<br>`MODIS_Aqua_CorrectedReflectance_Bands367` | **Daily** (`YYYY-MM-DD`), ~13:30 LT ascending swath, ช่อง `.jpg` |
| **Suomi NPP** (`37849`) | `suomi-npp` | `VIIRS_SNPP_CorrectedReflectance_TrueColor` | `VIIRS_SNPP_DayNightBand_At_Sensor_Radiance` (แสงกลางคืน)<br>`VIIRS_SNPP_Fires_375m_Day` | **Daily** (`YYYY-MM-DD`), Swath 3,040 km เต็มรอยต่อขั้วโลกไม่มีช่องว่างแถบศูนย์สูตร |
| **NOAA-20** (`43013`) | `suomi-npp` | `VIIRS_NOAA20_CorrectedReflectance_TrueColor` | `VIIRS_NOAA20_DayNightBand_At_Sensor_Radiance`<br>`VIIRS_NOAA20_Thermal_Anomalies_375m_Day` | **Daily** (`YYYY-MM-DD`), เฟสห่างจาก SNPP 50 นาที (180°) เติมช่องว่างเวลา |
| **NOAA-21** (`54234`) | `noaa-21` | `VIIRS_NOAA21_CorrectedReflectance_TrueColor` | `VIIRS_NOAA21_DayNightBand_At_Sensor_Radiance` | **Daily** (`YYYY-MM-DD`), เฟสคั่นกลาง SNPP & NOAA-20 (90°) |
| **GOES-19** (`60133`) | `goes` | `GOES-East_ABI_GeoColor` | `GOES-East_ABI_Band2_Red_Visible_1km`<br>`GOES-East_ABI_Band13_Clean_Infrared` (24 ชม.) | **Sub-daily 10-min** (`YYYY-MM-DDTHH:MM:00Z`), ประจำตำแหน่ง GOES-East (~75.2°W) |
| **GOES-18** (`51850`) | `goes` | `GOES-West_ABI_GeoColor` | `GOES-West_ABI_Band2_Red_Visible_1km`<br>`GOES-West_ABI_Band13_Clean_Infrared` (24 ชม.) | **Sub-daily 10-min** (`YYYY-MM-DDTHH:MM:00Z`), ประจำตำแหน่ง GOES-West (~137.0°W) |
| **Himawari-9** (`41836`) | `himawari-9` | `Himawari_AHI_Band3_Red_Visible_1km` | *(ไม่มี GeoColor ทางการบน GIBS; Band 13 Thermal IR ส่วนใหญ่บริการผ่าน JMA/NOAA แต่ไม่ใช่ชั้นหลักของ GIBS โดยตรง)* | **Sub-daily 10-min** (`YYYY-MM-DDTHH:MM:00Z`), ครอบคลุมเอเชีย–แปซิฟิก (~140.7°E) — กลางคืนภาพ Band 3 จะมืด |

> **ข้อสังเกตสำคัญ:**  
> - สำหรับ **Himawari-9** บน NASA GIBS WMTS ชั้นหลักที่มีให้บริการอย่างแพร่หลายคือ **`Himawari_AHI_Band3_Red_Visible_1km`** (0.64 µm Grayscale Visible) ต่างจาก GOES ที่มี `GeoColor` RGB (กลางวันสีจริง + กลางคืน IR + ไฟเมือง) ดังนั้นใน UI ควรแสดงป้ายบอกชัดว่าเป็น Visible Band 3 (เห็นเฉพาะด้านกลางวัน)  
> - ขณะนี้ `server/gnss_studio_server/imagery.py` ยังไม่มีอยู่ใน repo → หากผู้ใช้ยังไม่ได้เพิ่มไฟล์นี้ ทุกดวงยังไม่มีชั้นภาพในแอปจนกว่าจะ implement `imagery.py`

---

## 5. ข้อเสนอการออกแบบ (Design Proposal)

### 5.1 Object Type & Schema (`objects.py`, `schema.py`, `catalog.py`)
1. **คง Object Type หลักเป็น `"Satellite"`** (ไม่แตก top-level type ใหม่) เพื่อให้ใช้งาน Pipeline เดียวกันได้ทั้งหมด: GMAT SGP4 propagation, CZML trajectory, Access intervals, Facility tracking, Sensor attachment, 2D Swath, และ 3D View
2. **เพิ่ม `category` (หรือ `orbit_class` / `mission_type`) ใน `CatalogSatellite` และ Optional Metadata บน `SatelliteObj`:**
   - `category: "gnss" | "imaging" | "other"` (ค่า default อนุมานจากกลุ่ม TLE หรือตาราง `norad_ids` ที่มี preset)
   - การแยกระดับ `category` นี้ทำให้:
     - **DOP (`gnss_predict/dop.py`)** และ **Validation (`studio_validate.py`, `sp3.py`)** กรองใช้เฉพาะ `category == "gnss"` เท่านั้น (ป้องกันความผิดพลาดเชิงฟิสิกส์และป้องกัน `"NO_PRN"` / `"unverified"`)
     - **`imager_profile`** (เช่น ชื่อกล้อง, default sensor shape/half-angles, และ `gibs_layers`) ผูกติดกับ `norad` ได้โดยอัตโนมัติ

### 5.2 ขั้นตอนการ `Insert` และการใช้ Cache / CelesTrak Groups
1. **ขยาย Config & Routes (`config.py`, `routes/orbits.py`, `jobs.py`, `worker.py`):**
   - เพิ่มกลุ่ม EO ที่ใช้จริง: `EO_GROUPS = {"weather": "weather", "resource": "resource", "science": "science", "goes": "goes", "noaa": "noaa", "visual": "visual"}` โดยเริ่มจากการอ่านกลุ่มที่มีอยู่แล้วใน `_cache` (`weather`, `science`, `visual`) ก่อน เพื่อให้ทำงานแบบ offline ได้ทันทีบนแคชปัจจุบัน แล้วจึงรองรับปุ่ม Fetch อัปเดตเพิ่ม `resource` (เพื่อดึง Terra/Aqua อย่างเป็นทางการแทนการพึ่ง `visual`) และ `goes`/`noaa`
2. **การสร้างรหัส ID ภายใน (Internal ID) ที่ปลอดภัยต่อ GMAT และ SP3:**
   - ดาวเทียม GNSS ยังคงใช้ `PRN` (`G01`, `C19`, ...)
   - ดาวเทียมที่ไม่ใช่ GNSS ให้กำหนดรหัสภายใน:
     - สำหรับ **GMAT `Spacecraft` name** (`propagate.py:72`): ใช้ `N{norad}` เช่น `N25994`, `N41836` (ขึ้นต้นด้วยตัวอักษร, ไม่มีช่องว่างหรือเครื่องหมายขีดกลาง)
     - สำหรับ **SP3 compatibility (`sp3.py:296`)**: หากยังใช้ `predicted.sp3` เป็นสื่อกลางระหว่าง `run_propagate` กับ `run_analyze`/`czml` ให้จัดสรร slot 3 ตัวอักษรชั่วคราวที่ไม่ชน `GRECJI` เช่น `X01`..`X99` (หรือ `O01`..`O99`) โดยเก็บตาราง `internal_id <-> norad` ไว้ใน `manifest.json` (`bundle.py`), **หรือ** แยกไฟล์ ephemeris สำหรับ non-GNSS เป็น JSON/CSV ตรงจาก GMAT โดยไม่ผ่าน `write_sp3` (วิธีหลังสะอาดกว่าในระยะยาวเพราะไม่จำกัดจำนวนดาวแค่ 99 ดวง)
3. **ปรับ UX ของ Dialog `Insert -> From Satellite Catalog`:**
   - เพิ่มแท็บกรอง: `ทั้งหมด` / `GNSS (G/R/E/C)` / **`Imaging / Weather (8 ดวงแนะนำ + ทั้งกลุ่ม)`**
   - แสดงคอลัมน์แทน `PRN`: แสดง `NORAD`, `COSPAR`, `กลุ่ม (weather/science/visual)`, `อายุ TLE`, และ badge แจ้งเตือนเมื่อ GEO TLE อายุ > 2 วัน (เช่นปรับ threshold ของ GEO จาก 2 วัน เป็น 5–7 วัน เพื่อไม่ให้ขึ้นสีแดง/ส้มบ่อยเกินจำเป็นโดยไม่จำเป็น)
   - เมื่อผู้ใช้กด Insert ดาวเทียมกลุ่ม Imaging ให้ระบบ **auto-attach Primary Sensor (optional toggle: "เพิ่มกล้องหลักอัตโนมัติ")** ด้วยค่าพารามิเตอร์จากตารางในข้อ 2.3 ทันที

### 5.3 การแสดงผล 3D / 2D และ CZML (Attitude, Sun-Tracking `cell_normal`, Model Lookup)
1. **Model Lookup by `norad_id`:**
   - ฝั่ง Web โหลด `models/catalog.json` แล้วสร้าง map `norad_ids -> model_entry` (โมเดลทั้ง 6 ชุดในปัจจุบันจับคู่ NORAD ของทั้ง 8 ดวงครบหมดแล้ว ยกเว้นตรวจสอบให้แน่ใจว่า `graphics.ts` ยอมรับ ID รูปแบบ `sat/N{norad}` หรือใช้ `prnByNorad` map ใน manifest ตามเดิม)
2. **Attitude Law สำหรับ Imaging Satellites (ต่างจาก GNSS Yaw-Steering):**
   - ดาวเทียมกล้องใช้ **Nadir Alignment + Velocity Constraint** (เหมือน `sensorGeometry.ts:79-90`):
     $$\hat{z}_{\text{body}} = -\hat{r}_{\text{ECEF/ECI}}, \qquad \hat{x}_{\text{body}} = \frac{\mathbf{v}_{\text{ECI}} - (\mathbf{v}_{\text{ECI}}\cdot\hat{z})\hat{z}}{\|\cdots\|}, \qquad \hat{y}_{\text{body}} = \hat{z}_{\text{body}} \times \hat{x}_{\text{body}}$$
   - ใช้กฎนี้แทน GNSS `ψ_nom` (ไม่ต้องหมุน yaw ตามเบต้าเหมือนดาวเทียมนำทาง) โดยคำนวณ quaternion `orientation` ใน `czml.py` หรือบน client ด้วย ECI velocity จากตำแหน่งติดกัน
3. **General Solar-Wing Rotation ตาม `cell_normal` (`wing-Y` SADM):**
   - แทนที่จะ hardcode `cell_normal = -X`, ให้อ่าน `cell_normal` $\hat{n}_0 \in \{+X, -X, +Z, -Z\}$ ของโมเดลแต่ละลำ (ทั้ง 6 โมเดลเป็นเวกเตอร์ตั้งฉากกับแกนหมุน `Y` ทั้งหมด)
   - แปลงเวกเตอร์ดวงอาทิตย์ $\hat{s}$ เข้าสู่ body frame ($\mathbf{s}_b = (s_x, s_y, s_z)$) แล้วฉายลงระนาบ $X\text{–}Z$: $\mathbf{s}_{\perp} = (s_x, 0, s_z)$
   - คำนวณมุมหมุน $\theta_{\text{wing}}$ รอบแกน $+Y$ ให้ $\mathbf{R}_y(\theta_{\text{wing}})\,\hat{n}_0$ หันเข้าหา $\mathbf{s}_{\perp}$ มากที่สุด:
     $$\theta_{\text{wing}} = \operatorname{atan2}(s_x, s_z) - \operatorname{atan2}(n_{0x}, n_{0z})$$
     (สังเกต: เมื่อ $\hat{n}_0 = (-1, 0, 0)$ สูตรนี้ลดรูปกลับไปเป็นสูตรของ GNSS `-X` ทันที และใช้ได้กับ `-Z` ของ Terra, `+X` ของ Aqua, และ `+Z` ของ GOES โดยอัตโนมัติ!)
4. **2D Ground Track & Swath (`web/src/cesium/swath.ts`):**
   - รองรับ `Swath Mode` สำหรับ Sensor/Imaging ที่คำนวณขอบรอยเท้าด้วย **Off-Nadir Scan Angle ($\alpha$)** แทน `elevDeg` ($\varepsilon = 0^\circ$):
     $$\theta(\alpha) = \arcsin\!\left(\frac{R_E + h}{R_E}\sin\alpha\right) - \alpha$$
   - เพื่อแสดงแถบสแกน LEO (`MODIS`/`VIIRS`) บนแผนที่ 2D เป็นเส้นคู่ขนานสองฝั่ง (Left/Right swath corridor width 2,330 km / 3,050 km) ตลอดช่วงเวลาโคจร แทนที่จะวาดเป็นวงกลมใหญ่เกินจริง

### 5.4 การเรียก `Show Imagery` จาก Object ดาวเทียมโดยตรง
1. **Backend Endpoint (`server/gnss_studio_server/imagery.py` & `routes/imagery.py`):**
   - สร้าง Registry จับคู่ `NORAD -> GIBS Layer Specs` (ตามตาราง 4.3)
   - เปิด proxy / cache endpoint เช่น `GET /api/imagery/gibs/{layer}/{time}/{z}/{y}/{x}` (หรือ URL template ให้ Cesium `WebMapTileServiceImageryProvider` เรียกผ่าน backend เพื่อหลีกเลี่ยง CORS และทำ disk cache ช่วยให้โหลดซ้ำแบบ offline ได้เร็วขึ้น)
   - หมายเหตุสำคัญต่อ `web/src/cesium/viewer.ts:1-2`: ปัจจุบัน viewer ทำงานโหมด offline ด้วย `NaturalEarthII` — การเปิด GIBS overlay จึงควรเป็น **Optional / Explicit Layer Toggle ต่อเมื่อผู้ใช้กด `Show Imagery`** (พร้อมแจ้งสถานะชัดเจนเมื่อไม่มีอินเทอร์เน็ตและไม่มี tile ในแคช)
2. **UX จาก Satellite Object:**
   - คลิกขวา / ปุ่มใน Inspector ของดาวเทียมกล้อง:
     - **`Show Imagery` (แสดงชั้นภาพถ่ายบนโลก):** เพิ่ม `ImageryLayer` ของ GIBS บนพื้นหลัง `NaturalEarthII` (ซ้อนทับแบบปรับความทึบได้), ซิงก์พารามิเตอร์ `TIME=` กับเวลาบน Timeline ของ Cesium อัตโนมัติ (Daily `YYYY-MM-DD` สำหรับ MODIS/VIIRS; ปัดลงทุก 10 นาที `HH:MM` สำหรับ ABI/AHI) และแสดงตัวเลือกสลับชั้นภาพ (เช่น `TrueColor` ↔ `DayNightBand` / `Clean IR` เมื่อดาวเทียมอยู่ฝั่งกลางคืน)
     - **`Show Imagery + Fly to Footprint`:** เลื่อนกล้องไปยังจุดใต้ดาว ณ เวลาปัจจุบัน (สำหรับ GEO: หมุนกล้องไปที่ 140.7°E / 137°W / 75.2°W; สำหรับ LEO: ไปยังตำแหน่ง nadir ปัจจุบัน) เพื่อให้เห็นภาพ GIBS ตรงกับตำแหน่งจริงของดาวเทียมและแถบ Sensor ทันที

### 5.5 การวาด Sensor Swath Cone และ Footprint (3D & 2D)
1. **เพิ่ม `Rectangular` Sensor (`schema.py:201`, `sensorGeometry.ts`, `sensorDraw.ts`):**
   - เพิ่ม field `shape: "Simple Conic" | "Rectangular"` พร้อม `vertical_half_angle_deg` (along-track) และ `horizontal_half_angle_deg` (cross-track)
   - ใน `sensorDraw.ts`: สร้างพีระมิดสี่เหลี่ยม 4 เหลี่ยม (frustum/pyramid wireframe + translucent faces) ตัดกับทรงรี WGS84 (ray-ellipsoid intersection ที่มุมทั้ง 4 และเส้นขอบตามแนวสแกน) เพื่อให้เห็น **แถบสแกนจริง (narrow along-track × wide cross-track)** ของ MODIS (`±55.0° × ±0.41°`) และ VIIRS (`±56.28° × ±0.42°`)
2. **Persistent Swath Corridor (ประวัติการสแกนบนพื้นโลก):**
   - สำหรับ LEO ที่มีแถบสแกนบางมากในแต่ละวินาที ควรเพิ่ม option วาด **Past/Future Ground Swath Polygon** (เส้นขอบซ้าย-ขวาที่ระยะมุม $\pm\theta(\alpha)$ ตามแนว ground track $\pm 1$ รอบโคจร) เพื่อให้เทียบตำแหน่งแถบสแกนจากวงโคจรกับแถบภาพของ NASA GIBS TrueColor บนลูกโลกได้ตรงกัน

### 5.6 ความเสี่ยงและข้อควรระวัง (Risks & Caveats)
1. **การปนเปื้อนค่า DOP และ Verification Report (`dop.py:88`, `studio_validate.py:151`):** หากไม่แยก `category != "gnss"` ออกก่อนเรียก `dop_series` และ `validate_ephemeris` จะทำให้ `ALL` DOP เพี้ยนทันที และเกิดแถว `"unverified"` ขยะในรายงาน Validation
2. **ข้อจำกัดชื่อ GMAT Spacecraft & SP3 3-Char ID:** ชื่อดาวเทียมในแคชมีทั้งช่องว่างและขีดกลาง (`"GOES 18"`, `"HIMAWARI-9"`, `"NOAA 20 (JPSS-1)"`) ซึ่งผิดไวยากรณ์ของ GMAT Script (`propagate.py:72`) และยาวเกิน 3 ตัวอักษรของ SP3 (`sp3.py:296`) — จำเป็นต้องแยก `display_name` ออกจาก `gmat_id` / `sp3_slot`
3. **ความต่างระหว่างสถานะแคชจริงกับความสดของ GEO TLE:** ใน `_cache` ปัจจุบัน `Himawari-9` มีอายุ TLE `4.95 วัน` และ `GOES-18` มีอายุ `4.35 วัน` ซึ่งเกินเกณฑ์ `AGE_OK_DAYS = 2.0` ของ GNSS (`catalog.py:187`) หากไม่แยก threshold สำหรับ GEO/Weather อาจทำให้ UI เตือน stale ตลอดเวลาแม้ใช้งานจริงได้
4. **ข้อจำกัดเวลาแสงกลางวันของภาพ GIBS Visible & Himawari-9:**
   - ภาพ `TrueColor` (Terra/Aqua/SNPP/NOAA-20/NOAA-21) และ `Himawari_AHI_Band3_Red_Visible_1km` เป็นช่วงคลื่นแสงอาทิตย์ ซีกโลกกลางคืนจะมืดสนิท ต้องมีชั้น IR/DNB (`Band13_Clean_Infrared`, `DayNightBand`) หรือข้อความแจ้งผู้ใช้เมื่อเวลาบน Timeline ตรงกับกลางคืน
   - สำหรับ **Himawari-9** บน GIBS ไม่มีชั้น `GeoColor` RGB เหมือน GOES-East/West ทำให้ประสบการณ์ภาพสีจะต่างจากฝั่งอเมริกา
5. **ความแตกต่างระหว่าง `Terra`/`Aqua` ดั้งเดิมกับวงโคจรจริงปัจจุบัน:** ในแคช OMM ปัจจุบัน Terra (~689.3 km) และ Aqua (~685.8 km) ลดระดับต่ำกว่า 705 km แล้ว ทำให้หากคำนวณ swath ที่มุมคงที่ $\pm 55.0^\circ$ จากความสูงจริงของ TLE จะได้ swath ~2,255–2,268 km แคบกว่าสเปกอ้างอิง 2,330 km เล็กน้อย (~3%) ซึ่งถือว่าถูกต้องตามฟิสิกส์จริง
6. **โมเดล 3 มิติที่มี `cell_normal` ต่างกัน 4 แบบ:** ต้องใช้สูตรเวกเตอร์ทั่วไป (`atan2` เทียบ `cell_normal`) และทดสอบภาพ 3D ของทั้ง 6 โมเดล (`terra`, `aqua`, `suomi-npp`, `noaa-21`, `goes`, `himawari-9`) เทียบเวกเตอร์ดวงอาทิตย์จริง เพื่อป้องกันแผงโซลาร์หันด้านหลังเข้าหาดวงอาทิตย์ (`+Z` vs `-Z`, `+X` vs `-X`)
