"""ค่าคงที่ทั้งหมดของ gnss_predict (ที่มาของแต่ละค่าอยู่ในหัวข้อ 5.1 ของ spec)"""

import os
from pathlib import Path

# สถานี THBK: แปลงจาก APPROX POSITION XYZ ใน header RINEX (WGS84)
THBK_LAT_DEG = 13.729779
THBK_LON_DEG = 100.781151
THBK_HEIGHT_M = 6.4
THBK_ECEF_M = (-1159211.0035, 6087676.9700, 1503957.7161)

# ให้ตรงกับ TrainingModel/src/t02_5_rebuild_tec.py
RE_KM = 6371.0
SHELL_KM = 400.0
STEP_S = 30

CELESTRAK_GPS_URL = "https://celestrak.org/NORAD/elements/gp.php?GROUP=gps-ops&FORMAT=json"
TLE_WARN_DAYS = 7.0
TLE_MAX_DAYS = 30.0

# GPST − UTC (ไม่มี leap second ใหม่ตั้งแต่ 1 ม.ค. 2017)
GPS_UTC_OFFSET_S = 18
CDDIS_PRODUCTS_URL = "ftp://gdc.cddis.eosdis.nasa.gov/gnss/products"

# เกณฑ์การตรวจความแม่นยำกับ SP3 (หัวข้อ 11.4 ของ spec)
VALIDATION_MAX_TLE_AGE_DAYS = 2.0
VALIDATION_MIN_EL = 10.0
EL_MEDIAN_MAX = 0.05
EL_P99_MAX = 0.2
AZ_MEDIAN_MAX = 0.1
AZ_P99_MAX = 0.5
AZ_EL_LIMIT = 80.0

PKG_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_CACHE_DIR = PKG_ROOT / "cache"
DEFAULT_OUT_DIR = PKG_ROOT / "output"
TEMPLATE_PATH = PKG_ROOT / "templates" / "thbk_visibility.script.tmpl"

# ---- GNSS Studio engine (หัวข้อ 5.1 ของ spec engine) ----
CELESTRAK_GP_URL = "https://celestrak.org/NORAD/elements/gp.php?GROUP={group}&FORMAT=json"
GNSS_GROUPS = {"G": "gps-ops", "R": "glo-ops", "E": "galileo", "C": "beidou"}
CELESTRAK_MIN_INTERVAL_S = 7200       # ส่ง request ได้ไม่เกิน 1 ครั้งต่อกลุ่มต่อรอบอัปเดต 2 ชม.

IGS_META_URL = "https://files.igs.org/pub/station/general/igs_satellite_metadata.snx"
IGS_META_MAX_AGE_S = 86400             # ไฟล์ IGS metadata อายุเกินนี้ถึงดึงใหม่ (24 ชม.)
CDDIS_BRDC_URL = "ftp://gdc.cddis.eosdis.nasa.gov/gnss/data/daily/{year}/brdc/"
# ลำดับความสำคัญของ SP3 MGEX ที่ใช้เป็นค่าจริงตอนตรวจ (ตัวแรกที่มีไฟล์)
MGX_SP3_PREFERENCE = ("COD0MGXFIN", "GFZ0MGXRAP", "WUM0MGXRAP")

AGE_OK_DAYS = 2.0                     # วัดแล้ว: ภายในเกณฑ์นี้ความแม่นยำผ่านเกณฑ์
VALIDATION_MIN_SAT_PAIRS = 20         # validate: รายดวงที่มีคู่น้อยกว่านี้ไม่ตัดสิน (insufficient_data)
AGE_SHOWN_MAX_DAYS = 7.0              # ค่าที่ตั้ง ยังไม่ได้วัด
BRDC_MAX_TK_S = 14400                 # ใช้ ephemeris ที่ |tk| ≤ 4 ชม.
BRDC_DAYS_BACK = (1, 2)               # fetch: ไฟล์ broadcast รายวันที่ครบวันล่าสุด ลองของเมื่อวาน (UTC) แล้วของสองวันก่อน

CZML_STEP_S = 300
CZML_LAGRANGE_DEGREE = 7

# WGS84 (หัวข้อ 7.1)
WGS84_A_KM = 6378.137
WGS84_F = 1 / 298.257223563

DATA_DIR = Path(os.environ.get("GNSS_STUDIO_DATA", PKG_ROOT / "data"))
# OMM ที่ดาวน์โหลดและ celestrak_state.json ของ CLI เดิมกับ studio อยู่ที่เดียวกัน
# เพราะกติกา CelesTrak (1 ครั้งต่อกลุ่มต่อ 2 ชม.) นับต่อ IP ไม่ใช่ต่อเครื่องมือ
OMM_CACHE_DIR = DATA_DIR / "orbits" / "_cache"
CELESTRAK_STATE_FILE = "celestrak_state.json"

# เพิ่มทุกครั้งที่การคำนวณเปลี่ยน ใช้ใน hash และ manifest
ENGINE_VERSION = "0.2.0"

# ---- broadcast ephemeris (หัวข้อ 3 และ 7.4 ของ spec engine) ----
# GM (ม.³/วินาที²) และ ωe (เรเดียน/วินาที) ของแต่ละระบบตาม ICD ของระบบนั้น
BRDC_GM = {"G": 3.986005e14, "E": 3.986004418e14, "C": 3.986004418e14}     # GPS ตาม IS-GPS-200
BRDC_OMEGA_E = {"G": 7.2921151467e-5, "E": 7.2921151467e-5, "C": 7.292115e-5}
BDT_GPST_OFFSET_S = 14                # BDT = GPST − 14 วินาที (Galileo GST = GPST)
BDS_GEO_PRNS = frozenset(f"C{n:02d}" for n in (*range(1, 6), *range(59, 64)))   # C01–C05 และ C59–C63
BDS_GEO_TILT_DEG = 5.0                # ดาว GEO ของ BDS หมุนด้วย Rx(−5°) ก่อน Rz(ωe·tk)
KEPLER_ITERATIONS = 30
