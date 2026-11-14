"""ตัวอ่านไฟล์ TLE ข้อความแบบเดียวกับ Gpredict (ref-D §5.3 แถว Formats ถึง Name for 2-line set; `tle-update.c` read_fresh_tle
และ `sgpsdp/sgp_in.c` Good_Elements / Get_Next_Tle_Set) ไม่มี I/O

รับข้อความทั้งไฟล์ คืนทุกชุดที่ผ่านการตรวจตามลำดับในไฟล์ ไม่รวมดวงซ้ำ (การเลือก epoch ใหม่กว่าและการรวมสถานะเป็นงานของ
`satdb.apply_sets`) ชุดที่เสียถูกข้ามเงียบๆ (Gpredict เขียน ERROR "Invalid data for %d" แต่ฟังก์ชันนี้ไม่มี logger)

ลำดับการอ่านตามที่ Gpredict ทำ: อ่านทีละไม่เกิน 79 ตัวอักษรต่อครั้ง ตัดช่องว่างหัวท้าย แล้วเลื่อนหน้าต่าง 3 บรรทัด
  - บรรทัดที่ 2 ขึ้นต้น 1 และบรรทัดที่ 3 ขึ้นต้น 2 และ checksum ผ่านทั้งคู่ -> ชุด 3 บรรทัด (บรรทัดที่ 1 คือชื่อ ขยะอะไรก็ได้) ใช้ไป 3 บรรทัด
  - ไม่งั้น บรรทัดที่ 1 ขึ้นต้น 1 และบรรทัดที่ 2 ขึ้นต้น 2 และ checksum ผ่านทั้งคู่ -> ชุด 2 บรรทัด ชื่อสร้างจาก international designator ใช้ไป 2 บรรทัด
  - ไม่งั้นเลื่อนไป 1 บรรทัด
ชุดที่เข้าเงื่อนไขแล้วใช้ไปทั้งชุดแม้ข้อมูลข้างในเสีย (เลขดาวไม่ตรง ฯลฯ) ไม่ถอยมาตีความใหม่
"""

import re
from dataclasses import dataclass
from datetime import datetime

from .observe import parse_tle

STATUS_TAGS = {"[+]": "Operational", "[-]": "Non-operational", "[P]": "Partially operational",
               "[B]": "Backup/Standby", "[S]": "Spare", "[X]": "Extended Mission"}
UNKNOWN_STATUS = "Unknown"

READ_MAX = 79                          # fgets(linetmp, 80, fp) อ่านได้ไม่เกิน 79 ตัวอักษรรวมขึ้นบรรทัดใหม่
TLE_LINE_LEN = 69                      # บรรทัด TLE ถูกตัดเหลือ 69 ตัวอักษร
NAME_MAX = 25                          # ชื่อดาวเอาแค่ 25 ตัวอักษรแรก

_SPACE = " \t\n\v\f\r"                 # g_strstrip ตัดช่องว่างแบบ isspace ของ C
_DIGITS = frozenset("0123456789")      # g_ascii_isdigit ไม่นับเลขของ Unicode
_DECIMAL_POINTS = ((23, 34), (11, 20, 37, 46, 54))     # คอลัมน์ (ตัวเลข 0) ที่ต้องเป็น '.' ในบรรทัด 1 และ 2
_GENERATED_NAME_RE = re.compile(r"[0-9]{4,}-[0-9]{3,}")       # ชื่อแบบ CelesTrak
_LEADING_INT_RE = re.compile(r"[ \t\n\v\f\r]*([0-9]+)")


@dataclass(frozen=True)
class TleSet:
    norad: int
    name: str
    status: str
    lines: tuple[str, str]             # สองบรรทัด TLE ยาว 69 ตัวอักษร
    epoch: datetime                    # UTC (ปีสองหลัก >= 57 เป็น 19xx เหมือน observe.parse_tle)

    @property
    def generated_name(self) -> bool:
        return is_generated_name(self.name)


def is_generated_name(name: str) -> bool:
    """ชื่อที่ "คอมพิวเตอร์สร้าง": ตรง \\d{4,}-\\d{3,} (แบบ CelesTrak) หรือมีคำว่า OBJECT (แบบ Space-Track) (is_computer_generated_name)"""
    return _GENERATED_NAME_RE.search(name) is not None or "OBJECT" in name


def checksum_ok(line: str) -> bool:
    """Checksum_Good: ผลรวมของ 68 ตัวแรก (เลข = ค่าเอง, '-' = 1, อื่นๆ = 0) mod 10 ต้องเท่าตัวที่ 69 ไม่ตรวจอย่างอื่น"""
    if len(line) < TLE_LINE_LEN:
        return False
    total = sum(int(c) if c in _DIGITS else (1 if c == "-" else 0) for c in line[:68])
    return ord(line[68]) - ord("0") == total % 10


def _fgets_chunks(text: str):
    """แบ่งข้อความเป็นก้อนเท่าที่ fgets(buf, 80) จะอ่านได้ทีละครั้ง: ถึงขึ้นบรรทัดใหม่ (รวมไว้) หรือครบ 79 ตัวอักษร"""
    pos = 0
    while pos < len(text):
        end = min(pos + READ_MAX, len(text))
        newline = text.find("\n", pos, end)
        if newline != -1:
            end = newline + 1
        yield text[pos:end]
        pos = end


def _epoch_well_formed(line1: str) -> bool:
    """Epoch_Good: ช่อง YYDDD.FFFFFFFF (ตัวที่ 19-32) เป็นเลขที่อ่านได้ครบ เว้นวรรคได้เฉพาะแทนศูนย์นำหน้าของวันที่
    และหลังหลักสุดท้ายของเศษวัน"""
    if not (line1[18] in _DIGITS and line1[19] in _DIGITS):
        return False
    if any(line1[i] not in _DIGITS and line1[i] != " " for i in (20, 21)):
        return False
    if line1[20] != " " and line1[21] == " ":
        return False
    if line1[22] not in _DIGITS or line1[24] not in _DIGITS:
        return False
    i = 25
    while i < 32 and line1[i] != " ":
        if line1[i] not in _DIGITS:
            return False
        i += 1
    return all(c == " " for c in line1[i:32])


def _good_elements(line1: str, line2: str) -> bool:
    """Good_Elements: checksum ทั้งสองบรรทัด, เลขบรรทัด, เลขดาวตรงกัน, จุดทศนิยมอยู่ที่คอลัมน์ตายตัว,
    ช่อง ephemeris type " 0 " (ตัวที่ 62-64 ของบรรทัด 1), epoch อ่านได้"""
    if not (checksum_ok(line1) and checksum_ok(line2)):
        return False
    if line1[0] != "1" or line2[0] != "2" or line1[2:7] != line2[2:7]:
        return False
    if any(line1[i] != "." for i in _DECIMAL_POINTS[0]) or any(line2[i] != "." for i in _DECIMAL_POINTS[1]):
        return False
    return line1[61:64] == " 0 " and _epoch_well_formed(line1)


def _parse_name(line: str) -> tuple[str, str]:
    """ชื่อจากบรรทัดชื่อของชุด 3 บรรทัด (Get_Next_Tle_Set): เอา 25 ตัวแรก, '&' เป็น '/', ป้ายสถานะ [+] [-] [P] [B] [S] [X]
    ที่อยู่ภายใน 25 ตัวแรก (เริ่มก่อนตัวที่ 24) ตัดทิ้งพร้อมสิ่งที่ตามมา และตัวอักษรหน้าป้าย 1 ตัว (ปกติคือช่องว่างหน้าป้าย)"""
    chars: list[str] = []
    status = UNKNOWN_STATUS
    for idx, ch in enumerate(line[:NAME_MAX]):
        if ch in "\r\n\0":
            break
        if ch == "&":
            chars.append("/")
        elif idx < NAME_MAX - 2 and line[idx:idx + 3] in STATUS_TAGS:
            status = STATUS_TAGS[line[idx:idx + 3]]
            del chars[max(idx - 1, 0):]
            break
        else:
            chars.append(ch)
    # ตัดช่องว่างท้ายทุกกรณี (ของเรา: Gpredict ตัดเฉพาะเมื่อชื่อสั้นกว่า 25 ตัว ส่วนหลังป้ายสถานะหรือหลังตัดที่ 25 ตัวอาจเหลือช่องว่าง)
    return "".join(chars).rstrip(" "), status


def _generated_two_line_name(line1: str) -> str:
    """ชื่อชุด 2 บรรทัด "<ปี>-<รหัสปล่อย>" จาก international designator เช่น "98067A" -> "1998-067A" (ปีสองหลัก >= 57 เป็น 19xx)"""
    m = _LEADING_INT_RE.match(line1[9:11])
    yy = int(m[1]) if m else 0
    return f"{1900 + yy if yy >= 57 else 2000 + yy}-{line1[11:17].strip(_SPACE)}"


def _make_set(name_line: str | None, line1: str, line2: str) -> TleSet | None:
    line1, line2 = line1[:TLE_LINE_LEN], line2[:TLE_LINE_LEN]
    if not _good_elements(line1, line2):
        return None
    try:
        epoch = parse_tle((line1, line2)).epoch
    except ValueError:
        # (ของเรา) Gpredict รับชุดที่ช่องตัวเลขอื่นอ่านไม่ได้ (เช่น วันที่ของปีเกิน 366) แต่ observe ใช้ TLE แบบนั้นไม่ได้
        return None
    if name_line is None:
        name, status = _generated_two_line_name(line1), UNKNOWN_STATUS
    else:
        name, status = _parse_name(name_line)
    m = _LEADING_INT_RE.match(line1[2:7])             # g_ascii_strtod: อ่านเลขนำหน้า ไม่มีเลข = 0
    return TleSet(int(m[1]) if m else 0, name, status, (line1, line2), epoch)


def parse_tle_text(text: str) -> list[TleSet]:
    lines = [chunk.strip(_SPACE) for chunk in _fgets_chunks(text)]
    count = len(lines)
    sets: list[TleSet] = []
    i = 0
    while i < count:
        w0 = lines[i]
        w1 = lines[i + 1] if i + 1 < count else ""
        w2 = lines[i + 2] if i + 2 < count else ""
        if w1[:1] == "1" and w2[:1] == "2" and checksum_ok(w1) and checksum_ok(w2):
            found, step = _make_set(w0, w1, w2), 3
        elif w0[:1] == "1" and w1[:1] == "2" and checksum_ok(w0) and checksum_ok(w1):
            found, step = _make_set(None, w0, w1), 2
        else:
            i += 1
            continue
        if found is not None:
            sets.append(found)
        i += step
    return sets
