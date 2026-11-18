"""รายชื่อเมืองและสถานีอากาศสำหรับปุ่ม Select ของ Location และ Weather St (spec งานย่อย 4 §4.3, ref-D §3)

(ของเรา) Gpredict ใช้ locations.dat ของมันเอง (GPL, ไม่ใช้ที่นี่) ส่วนของเราสร้าง data/locations.json จาก nsd_cccc.txt ของ NOAA
(ข้อมูลรัฐบาลสหรัฐ public domain) ด้วย tools/build_locations.py ที่มาและวันที่ดาวน์โหลดอยู่ใน data/SOURCE.md

ไฟล์ของ NOAA: latin-1, หนึ่งสถานีต่อบรรทัด คั่นด้วย ";" ช่องที่ใช้ (ตัวเลข = ตำแหน่งเริ่มจาก 0)
  0 ICAO, 3 Place Name, 5 Country Name, 6 WMO Region, 7 Station Latitude, 8 Station Longitude, 11 Station Elevation (ม.)
มีแค่ stdlib: สคริปต์สร้างข้อมูลรันด้วย `python -I` และ import โมดูลนี้
"""

import functools
import re
from collections import Counter
from pathlib import Path

NSD_URL = "https://tgftp.nws.noaa.gov/data/nsd_cccc.txt"
DATA_FILE = Path(__file__).resolve().parent / "data" / "locations.json"

# decision 11 ของแผน: ทวีปจากช่อง WMO Region
WMO_REGIONS = {"1": "Africa", "2": "Asia", "3": "South America", "4": "North and Central America",
               "5": "South-West Pacific", "6": "Europe", "7": "Antarctica"}

_ANGLE = re.compile(r"(\d{1,3})-(\d{1,2})(?:-(\d{1,2}))?([NSEW])")      # "13-55N", "098-58-12E"
_ICAO = re.compile(r"[A-Z0-9]{4}")
_INT = re.compile(r"[+-]?\d+")
_LINE_END = re.compile(r"\r\n|\r|\n")        # ไฟล์จริงใช้ CRLF ปนกับ LF
_PRECISION = 6                               # ทศนิยมของ lat/lon (0.000001° ≈ 0.1 ม. ละเอียดกว่าข้อมูลซึ่งละเอียดสุด 1 พิลิปดา)
_ELEVATION_AT = 11                              # ตำแหน่งของ Station Elevation (ช่องท้ายสุดที่ใช้)


def nsd_angle(text: str) -> float:
    """มุมแบบ NOAA ("13-55N" องศา-ลิปดา, "098-58-12E" องศา-ลิปดา-พิลิปดา) เป็นองศาทศนิยม ใต้และตะวันตกเป็นลบ
    รูปแบบผิดหรือลิปดา/พิลิปดาเกิน 59: ValueError (ไม่ตรวจว่าตัวอักษรทิศตรงกับแกนไหน ให้ผู้เรียกตรวจเอง)"""
    m = _ANGLE.fullmatch(text)
    if m is None:
        raise ValueError(f"พิกัดของ NOAA ไม่ถูกรูปแบบ: {text!r}")
    degrees, minutes, seconds, hemisphere = int(m[1]), int(m[2]), int(m[3] or 0), m[4]
    if minutes >= 60 or seconds >= 60:
        raise ValueError(f"พิกัดของ NOAA มีลิปดาหรือพิลิปดาเกิน 59: {text!r}")
    value = degrees + minutes / 60 + seconds / 3600
    return -value if value and hemisphere in "SW" else value


def _axis(text: str, hemispheres: str, limit: int) -> float | None:
    """มุมของแกนหนึ่ง (ตัวอักษรทิศต้องเป็นของแกนนั้นและไม่เกิน limit องศา) None ถ้าใช้ไม่ได้"""
    text = text.strip()
    if not text or text[-1] not in hemispheres:
        return None
    try:
        value = nsd_angle(text)
    except ValueError:
        return None
    return round(value, _PRECISION) if abs(value) <= limit else None


def _elevation(text: str) -> int:
    text = text.strip()
    return int(text) if _INT.fullmatch(text) else 0          # ว่างหรืออ่านไม่ได้ = 0 ม.


def parse_nsd(text: str) -> list[list]:
    """แถว [continent, country, city, lat, lon, alt_m, icao] เรียงตาม continent, country, city (ไม่แยกตัวพิมพ์ใหญ่เล็ก)
    ข้ามบรรทัดที่ใช้ไม่ได้: ช่องไม่ครบ, ICAO ไม่ใช่ 4 ตัวอักษร, ไม่มีชื่อเมืองหรือประเทศ, WMO Region ที่ไม่รู้จัก,
    พิกัดว่างหรือผิดรูปแบบหรือผิดแกน (ไฟล์จริงมีไม่กี่บรรทัด เช่น KSTZ ที่ขาดช่อง State จนช่องพิกัดเลื่อน)
    บรรทัดที่ช่อง WMO Region ว่างใช้ทวีปที่พบมากที่สุดของประเทศเดียวกัน ไม่มีให้อ้างอิงก็ข้าม"""
    rows: list[list] = []                      # continent เป็น None ถ้ารอเติมจากประเทศ
    continents_of: dict[str, Counter] = {}
    for raw in _LINE_END.split(text):
        fields = raw.split(";")
        if len(fields) <= 8:
            continue
        icao = fields[0].strip().upper()
        city, country = " ".join(fields[3].split()), " ".join(fields[5].split())
        region = fields[6].strip()
        lat, lon = _axis(fields[7], "NS", 90), _axis(fields[8], "EW", 180)
        if not (_ICAO.fullmatch(icao) and city and country and lat is not None and lon is not None):
            continue
        if region and region not in WMO_REGIONS:
            continue
        continent = WMO_REGIONS.get(region)
        if continent is not None:
            continents_of.setdefault(country, Counter())[continent] += 1
        alt = _elevation(fields[_ELEVATION_AT]) if len(fields) > _ELEVATION_AT else 0
        rows.append([continent, country, city, lat, lon, alt, icao])
    for row in rows:
        if row[0] is None:
            counts = continents_of.get(row[1])
            row[0] = counts.most_common(1)[0][0] if counts else None
    rows = [row for row in rows if row[0] is not None]
    rows.sort(key=lambda r: (r[0].casefold(), r[1].casefold(), r[2].casefold(), r[6]))
    return rows


@functools.cache
def locations_json() -> bytes:
    """เนื้อของ locations.json อ่านจากดิสก์ครั้งเดียวแล้วเก็บในหน่วยความจำ (GET /api/locations ส่งไบต์นี้ตรงๆ)
    อ่านไม่ได้: OSError ไม่ถูกเก็บ (ครั้งต่อไปลองอ่านใหม่)"""
    return DATA_FILE.read_bytes()
