"""ค่าคงที่ทั้งหมดของ gnss_predict (ที่มาของแต่ละค่าอยู่ในหัวข้อ 5.1 ของ spec)"""

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

CELESTRAK_GPS_URL = "https://celestrak.org/NORAD/elements/gp.php?GROUP=gps-ops&FORMAT=tle"
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
