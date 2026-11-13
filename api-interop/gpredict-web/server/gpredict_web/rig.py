"""Radio Control ของ Gpredict (ref-R §2-§4, spec §4 และ §9): ส่วนบนของไฟล์เป็นฟังก์ชันบริสุทธิ์ ไม่มี I/O

- สูตร Doppler/LO (ref-R §3.2) และ transponder tune/lock (§3.3) หน่วย Hz ตรงตัว ไม่จำกัด passband (spec §9.2)
- ข้อความคำสั่ง rigctld ทุกตัวสร้างที่นี่ที่เดียว (ref-R §4.1) ตรงตามตัวอักษรของ Gpredict ยกเว้นสองข้อที่ spec §9.1 แก้
  (Set PTT ไม่ส่ง q ต่อท้าย, FT817 split ใช้ชื่อ VFO แทนเลขที่ไม่ได้อ่านจากไฟล์) ความถี่ใช้ `%10.0f` ไม่มีจุดทศนิยม
  และการจัดรูปแบบตัวเลขของ Python ไม่ขึ้นกับ locale
- parse คำตอบของ rigctld (§3.6, §4.2) และข้อความ count-down (§2.6)
"""

import math
import re

from .hamlib import is_error
from .observe import C_KMS

# ---------------------------------------------------------------- Doppler และ LO (ref-R §3.2)
# rr = range rate เป็น km/s บวกคือกำลังห่าง ผลเป็น Hz คำนวณเรียงลำดับเดียวกับ gtk-rig-ctrl.c:306-318 (f · (rr / c))


def doppler_down(f_sat: float, rate_kms: float) -> float:
    """Doppler ของ downlink: dd = -f · rr / c (ห่างออกแล้วรับได้ต่ำลง)"""
    return -f_sat * (rate_kms / C_KMS)


def doppler_up(f_sat: float, rate_kms: float) -> float:
    """Doppler ของ uplink: du = +f · rr / c (ห่างออกแล้วต้องส่งสูงขึ้น)"""
    return f_sat * (rate_kms / C_KMS)


def radio_freq(f_sat: float, doppler: float, lo: float, track: bool) -> float:
    """ความถี่ที่ตั้งบนวิทยุ: Track เปิด f + doppler - LO, ปิด f - LO (ใช้ dd/LO กับ downlink และ du/LO_UP กับ uplink)"""
    return f_sat + doppler - lo if track else f_sat - lo


def sat_from_radio(f_read: float, doppler: float, lo: float, track: bool) -> float:
    """dial feedback: ความถี่ดาวที่คำนวณย้อนจากค่าที่อ่านจากวิทยุ: Track เปิด f_read + LO - doppler, ปิด f_read + LO"""
    return f_read - doppler + lo if track else f_read + lo


# ---------------------------------------------------------------- transponder (ref-R §3.3)
# t เป็น dict ของ transponder {up_low, up_high, down_low, down_high, invert, ...} หน่วย Hz


def tune_centre(low: int, high: int) -> int | None:
    """กึ่งกลางของช่วงสำหรับปุ่ม T: low + |high - low| / 2 (หารจำนวนเต็ม) เมื่อทั้งสองขอบ > 0 ไม่งั้น None"""
    if low > 0 and high > 0:
        return low + abs(high - low) // 2
    return None


def lock_up(f_down: float, t: dict) -> float | None:
    """Lock downlink → uplink: Δ = f_down - DOWN_LOW แล้ว UP_LOW + Δ (inverting: UP_HIGH - Δ) None เมื่อ DOWN_LOW หรือ UP_LOW = 0
    ไม่ตรวจว่า f_down อยู่ในช่วง passband (ref-R §3.3, spec §9.2)"""
    if not (t["down_low"] > 0 and t["up_low"] > 0):
        return None
    delta = f_down - t["down_low"]
    return float(t["up_high"] - delta if t["invert"] else t["up_low"] + delta)


def lock_down(f_up: float, t: dict) -> float | None:
    """Lock uplink → downlink: Δ = f_up - UP_LOW แล้ว DOWN_LOW + Δ (inverting: DOWN_HIGH - Δ) None เมื่อ DOWN_LOW หรือ UP_LOW = 0"""
    if not (t["down_low"] > 0 and t["up_low"] > 0):
        return None
    delta = f_up - t["up_low"]
    return float(t["down_high"] - delta if t["invert"] else t["down_low"] + delta)


def is_beacon(t: dict) -> bool:
    """beacon คือ transponder ที่ไม่มี uplink (UP_LOW = UP_HIGH = 0) และ DOWN_LOW = DOWN_HIGH (trsp-conf.h)"""
    return t["up_low"] == 0 and t["up_high"] == 0 and t["down_low"] == t["down_high"]


# ---------------------------------------------------------------- คำสั่ง rigctld (ref-R §4.1)
# ผลเป็น str ที่ลงท้าย \n (cmd_get_dcd เป็น bytes เพราะมีไบต์ 0x8B) vfo_opt = ธง VFO option ของอุปกรณ์นั้น (ref-R §4.2)

CMD_SET_VFO_OPT = "\\set_vfo_opt 1\n"
CMD_CHK_VFO = "\\chk_vfo\n"
CMD_AOS = "AOS\n"
CMD_LOS = "LOS\n"
CMD_AOIQ = "U IQRECORD 1\n"
CMD_LOIQ = "U IQRECORD 0\n"

# VFO Up (เลข 1=A 2=B 3=Main 4=Sub ของ radio-conf.h) → (ชื่อ VFO นั้น, ชื่อ VFO อีกฝั่งของคู่เดียวกัน) (gtk-rig-ctrl.c:1620-1668)
_DUPLEX_VFOS = {1: ("VFOA", "VFOB"), 2: ("VFOB", "VFOA"), 3: ("Main", "Sub"), 4: ("Sub", "Main")}


def _current(vfo_opt: bool) -> str:
    return " currVFO" if vfo_opt else ""


def cmd_set_freq(hz: float, vfo_opt: bool) -> str:
    """`F %10.0f` / `F currVFO %10.0f` (ปัดแบบ printf: เข้าหาจำนวนเต็มที่ใกล้สุด ตรงกึ่งกลางเข้าหาเลขคู่)"""
    return f"F{_current(vfo_opt)} {hz:10.0f}\n"


def cmd_get_freq(vfo_opt: bool) -> str:
    return f"f{_current(vfo_opt)}\n"


def cmd_set_split_freq(hz: float, vfo_opt: bool) -> str:
    """`I %10.0f` / `I VFOA %10.0f` (มี VFO option เป็น VFOA เสมอ)"""
    return f"I{' VFOA' if vfo_opt else ''} {hz:10.0f}\n"


def cmd_get_split_freq(vfo_opt: bool) -> str:
    return f"i{_current(vfo_opt)}\n"


def cmd_get_ptt(vfo_opt: bool) -> str:
    return f"t{_current(vfo_opt)}\n"


def cmd_get_dcd(vfo_opt: bool) -> bytes:
    """ไบต์ 0x8B (รหัสสั้นของ get_dcd ใน hamlib) ตามด้วย `\\n` หรือ ` currVFO\\n`"""
    return b"\x8b" + _current(vfo_opt).encode("ascii") + b"\n"


def cmd_set_ptt(on: bool, vfo_opt: bool) -> str:
    """`T 1` / `T currVFO 1` ไม่มี `q` ต่อท้ายต่างจาก Gpredict (spec §9.1 ข้อ 5: q สั่ง rigctld ปิดการเชื่อมต่อกลาง cycle)"""
    return f"T{_current(vfo_opt)} {1 if on else 0}\n"


def cmd_duplex_split(vfo_up: int, vfo_opt: bool) -> str:
    """ตั้ง split ของวิทยุ Full-duplex ตอน Engage จาก VFO Up (ไม่ใช้ VFO Down): `S 1 <up>` หรือ `S <อีกฝั่ง> 1 <up>`"""
    if vfo_up not in _DUPLEX_VFOS:
        raise ValueError(f"unknown VFO Up code {vfo_up!r} (expected 1..4)")
    up, other = _DUPLEX_VFOS[vfo_up]
    return f"S {other} 1 {up}\n" if vfo_opt else f"S 1 {up}\n"


def cmd_ft817_split(on: bool, vfo_opt: bool) -> str:
    """split ของ FT817/857/897: เปิดตอน Engage (รับ A ส่ง B), ปิดตอน Disengage (spec §9.1 ข้อ 7)
    แบบมี VFO option คือ `S VFOA 1 VFOB` / `S VFOA 0 VFOA` (ข้อตัดสินใจ 7 ของแผน เพราะ spec กำหนดเฉพาะแบบไม่มี VFO option)"""
    if on:
        return "S VFOA 1 VFOB\n" if vfo_opt else "S 1 VFOB\n"
    return "S VFOA 0 VFOA\n" if vfo_opt else "S 0 VFOA\n"


# ---------------------------------------------------------------- คำตอบของ rigctld (ref-R §3.6, §4.2)

_DECIMAL = re.compile(r"[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?")
# g_ascii_strtoull(s, NULL, 0): ข้ามช่องว่างนำหน้า เครื่องหมาย แล้วอ่านเลขฐาน 16 (0x) ฐาน 8 (0 นำ) หรือฐาน 10 เท่าที่อ่านได้
_C_UNSIGNED = re.compile(r"[ \t\n\v\f\r]*([+-]?)(?:0[xX]([0-9a-fA-F]+)|(0[0-7]*)|([1-9][0-9]*))")
_ULL_MAX = 2 ** 64 - 1


def parse_freq(reply: list[str]) -> float | None:
    """ความถี่ (Hz) จากบรรทัดแรกของคำตอบ `f`/`i`; คำตอบ RPRT, ว่าง หรือไม่ใช่ตัวเลขคือ None"""
    if not reply or is_error(reply):
        return None
    text = reply[0].strip()
    if not _DECIMAL.fullmatch(text):
        return None
    value = float(text)
    return value if math.isfinite(value) else None


def _strtoull(text: str) -> int:
    """จำลอง strtoull(text, NULL, 0) ของ C: ไม่มีตัวเลขนำหน้าได้ 0, ลบวนเป็นค่าบวกมหาศาล, ล้นได้ ULLONG_MAX"""
    match = _C_UNSIGNED.match(text)
    if match is None:
        return 0
    sign, hex_digits, octal_digits, decimal_digits = match.groups()
    if hex_digits is not None:
        value = int(hex_digits, 16)
    elif octal_digits is not None:
        value = int(octal_digits, 8)
    else:
        value = int(decimal_digits)
    if value > _ULL_MAX:
        return _ULL_MAX
    return -value & _ULL_MAX if sign == "-" else value


def parse_flag(reply: list[str]) -> bool:
    """สถานะ PTT/DCD: บรรทัดแรกอ่านเป็นจำนวนเต็มไม่ลบฐานอัตโนมัติ เท่ากับ 1 พอดีคือเปิด อย่างอื่น (รวม error และไม่มีคำตอบ) คือปิด"""
    return bool(reply) and _strtoull(reply[0]) == 1


# ---------------------------------------------------------------- count-down (ref-R §2.6)


def countdown_text(seconds: float, prefix: str | None) -> str:
    """`HH:MM:SS` เมื่อเหลือครบ 1 ชั่วโมงขึ้นไป ไม่งั้น `MM:SS` ตัดเศษวินาที (Gpredict ตัดด้วย guint) เวลาติดลบแสดง 00:00
    prefix เช่น "AOS in" หรือ "LOS in" นำหน้าด้วยช่องว่างหนึ่งตัว"""
    s = max(int(seconds), 0)
    h, s = divmod(s, 3600)
    m, s = divmod(s, 60)
    text = f"{h:02d}:{m:02d}:{s:02d}" if h > 0 else f"{m:02d}:{s:02d}"
    return f"{prefix} {text}" if prefix else text
