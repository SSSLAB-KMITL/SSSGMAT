"""Antenna Control ของ Gpredict (ref-R §5-§7, spec §5 และ §9): ส่วนนี้เป็นฟังก์ชันบริสุทธิ์ ไม่มี I/O

- คณิตของ set-point (ref-R §6.2) ตามลำดับของ decision 9 ของแผน: ค่าพื้นฐาน → flip → แปลงเป็น −180…+180 → clamp ไปที่ Min/Max
  (Gpredict clamp ก่อนแล้วจึง flip ซึ่งทำให้ rotator −180…+180 หมุนไปทางตะวันตกไม่ได้)
- flip pass (ref-R §6.3), การตรวจ Threshold ในหน่วยของอุปกรณ์ (decision 10, spec §9.1 ข้อ 13), lead-ahead แบบค้นครึ่งช่วงเวลา
  (ref-R §6.4 ข้อ 3) และกติกาหา pass ใหม่ (ref-R §6.5)
- ข้อความคำสั่ง rotctld (ref-R §7) และ parse คำตอบ: เลขทศนิยมใช้ `.` เสมอ การจัดรูปแบบตัวเลขของ Python ไม่ขึ้นกับ locale
  (Gpredict ใช้ `%.2f` ตาม locale ของ process)
"""

import math
import re
from collections.abc import Callable, Sequence
from datetime import datetime, timedelta

from .hamlib import is_error
from .hwconf import RotConf
from .pass_predict import PassData

NO_PASS_SETPOINT = (0.0, 45.0)                  # ดาวอยู่ใต้ขอบฟ้าและไม่มี pass ให้อ้าง (ref-R §6.2, §13 ข้อ 14, spec §9.2)
LEAD_DEFAULT = timedelta(days=1 / 72)           # ช่วงที่มอง lead-ahead เมื่อไม่มี pass: 20 นาที (ref-R §6.4 ข้อ 3)
QTH_MOVE_KM = 1.0                               # สถานีย้ายเกินนี้แล้วหา pass ใหม่ (ref-R §6.5; หน่วยของ Gpredict UNVERIFIED น่าจะ km)

# ---------------------------------------------------------------- ห่อมุม


def wrap_into(az: float, lo: float) -> float:
    """ห่อทีละ 360 เข้า [lo, lo + 360) ค่าที่อยู่ในช่วงแล้วคืนเดิมทุกบิต"""
    hi = lo + 360.0
    if lo <= az < hi:
        return az
    wrapped = lo + (az - lo) % 360.0
    return lo if wrapped >= hi else wrapped      # % ของค่าติดลบเล็กมากปัดได้ 360.0 พอดี


def wrap360(az: float) -> float:
    return wrap_into(az, 0.0)


def _wrap_window(az: float, lo: float, hi: float) -> float:
    """ห่อทีละ 360 เข้า [lo, hi] แบบ Gpredict: `while az > hi: az -= 360` แล้ว `while az < lo: az += 360` (สองรอบแยกกัน จบเสมอ)
    ต่างจาก wrap_into ตรงที่ az == hi อยู่ที่ hi ไม่ถูกห่อเป็น lo และถ้า hi - lo < 360 ผลอาจออกนอกช่วง (ผู้เรียก clamp ต่อ)"""
    if az > hi:
        az -= 360.0 * math.ceil((az - hi) / 360.0)
    if az < lo:
        az += 360.0 * math.ceil((lo - az) / 360.0)
    return az


# ---------------------------------------------------------------- flip pass (ref-R §6.3)


def is_flip_pass(azimuths: Sequence[float], conf: RotConf) -> bool:
    """pass ที่วิ่งตามแล้ว Az ต้องกระโดดข้ามปลาย stop ของ rotator (gtk-rot-ctrl.c:209-285)

    azimuths = Az ของ AOS, ของแต่ละแถวใน pass และของ LOS ตามลำดับเวลา แต่ละจุดห่อทีละ 360 เข้าหน้าต่าง [0, 360] (type 0) หรือ
    [−180, 180] (type 1) ที่เลื่อนด้วย az_stop − ขอบล่าง ขอบล่างหลังเลื่อนจึงเป็น az_stop เสมอ ถ้าจุดติดกันต่างกันเกิน 180° คือ flip"""
    lo = conf.az_stop
    hi = lo + 360.0
    last: float | None = None
    for raw in azimuths:
        az = _wrap_window(raw, lo, hi)
        if last is not None and abs(az - last) > 180.0:
            return True
        last = az
    return False


# ---------------------------------------------------------------- set-point (ref-R §6.2)


def adjust(az: float, el: float, conf: RotConf, flip: bool) -> tuple[float, float]:
    """ปรับ (Az, El) ของดาวให้เป็นค่าที่ส่ง rotator ได้ (ยังไม่ clamp)
    1. flip pass และ Max El ≥ 180 (แกน El เลยหัว): El → 180 − El, Az ± 180 (ลบเมื่อ > 180 ไม่งั้นบวก) แล้วห่อเข้า [MinAz, MaxAz]
    2. rotator ชนิด −180…+180 (type 1) และ Az > 180: Az − 360"""
    if flip and conf.max_el >= 180.0:
        el = 180.0 - el
        az = az - 180.0 if az > 180.0 else az + 180.0
        az = _wrap_window(az, conf.min_az, conf.max_az)
    if conf.az_type == 1 and az > 180.0:
        az -= 360.0
    return az, el


def clamp_to(az: float, el: float, conf: RotConf) -> tuple[float, float]:
    return max(conf.min_az, min(conf.max_az, az)), max(conf.min_el, min(conf.max_el, el))


def setpoint(t: datetime, target: tuple[float, float] | None, p: PassData | None, conf: RotConf, flip: bool,
             knobs: tuple[float, float], track: bool) -> tuple[float, float]:
    """set-point (Az, El) ของ timer ควบคุมแต่ละรอบ (gtk-rot-ctrl.c:798-851)

    Track ปิดหรือไม่มีดาวเป้าหมาย: ค่าของปุ่มหมุนตามที่เป็น ไม่แปลง ไม่ clamp
    ไม่งั้นค่าพื้นฐานคือ
    - El ≥ 0: (Az, El) ของดาว
    - El < 0 ก่อน AOS ของ pass ที่เก็บไว้: (Az ของ AOS, 0°); หลัง LOS: (Az ของ LOS, 0°)
    - El < 0 และไม่มี pass หรืออยู่ในช่วง pass: NO_PASS_SETPOINT (Az 0°, El 45°) ซึ่งไม่ถูก clamp (ref-R §6.2, spec §9.2)
    แล้ว adjust (flip, type 1) จึง clamp ตามลำดับของ decision 9 ค่า NO_PASS_SETPOINT ผ่าน adjust เหมือน Gpredict
    (เมื่อ flip ได้ Az 180° El 135° ซึ่งเป็นทิศเดียวกัน)"""
    if not track or target is None:
        return knobs
    az, el = target
    clamp = True
    if el < 0.0:
        if p is not None and t < p.aos:
            az, el = p.aos_az, 0.0
        elif p is not None and t > p.los:
            az, el = p.los_az, 0.0
        else:
            az, el = NO_PASS_SETPOINT
            clamp = False
    az, el = adjust(az, el, conf, flip)
    return clamp_to(az, el, conf) if clamp else (az, el)


def move_due(setp: tuple[float, float], read: tuple[float, float], threshold: float) -> bool:
    """ต้องสั่งตำแหน่งใหม่เมื่อ Az หรือ El ต่างกันเกิน Threshold (ref-R §6.4 ข้อ 2)
    read คือค่าที่ rotctld รายงานในหน่วยของอุปกรณ์ตรงๆ ไม่ห่อเป็น 0–360 (decision 10 แก้ ref-R §13 ข้อ 13:
    Gpredict ห่อค่าที่อ่านแต่ไม่ห่อ set-point ทำให้ rotator −180…+180 ถูกสั่งทุกรอบเมื่อ Az ติดลบ)"""
    return abs(setp[0] - read[0]) > threshold or abs(setp[1] - read[1]) > threshold


def lead_ahead(t: datetime, los: datetime | None, cycle_s: float, threshold: float, setp: tuple[float, float],
               predict: Callable[[datetime], tuple[float, float] | None], conf: RotConf,
               flip: bool) -> tuple[float, float]:
    """เลื่อน set-point ไปข้างหน้าดาวเพื่อไม่ต้องไล่ตามตลอด (ref-R §6.4 ข้อ 3, gtk-rot-ctrl.c:896-964)

    ค้นแบบครึ่งช่วงบนเวลา t + Δ หาเวลาไกลสุดที่ดาวยังอยู่เหนือขอบฟ้า (0° ≤ El ≤ 180°) และห่างจาก setp ไม่เกิน Threshold ทั้ง Az และ El
    ช่วงที่มองคือ LOS − t หรือ LEAD_DEFAULT เมื่อไม่มี pass step แรกคือครึ่งช่วง (อย่างน้อย 1 Cycle) หยุดเมื่อ step < Cycle/4
    ผลคือตำแหน่งที่ adjust แล้วของจุดสุดท้ายที่ผ่านเงื่อนไข (ไม่มีจุดไหนผ่านก็ setp เดิม) แล้ว clamp

    ต่างจากโค้ดของ Gpredict (ของเรา): Gpredict ลองที่ t + (LOS − t) ก่อนซึ่งอยู่ที่ขอบฟ้าพอดี และเมื่อผ่านจะข้ามไปไกลกว่า LOS
    ของเราเริ่มที่ครึ่งช่วงจึงไม่ดูเลยปลายช่วง และคืนจุดที่ผ่านจริง ไม่ใช่จุดลองสุดท้ายที่อาจเกิน tolerance
    predict ให้ (Az, El) ดิบของดาว ณ เวลานั้น หรือ None เมื่อไม่มีข้อมูล (นับว่าไม่ผ่าน)"""
    if cycle_s <= 0.0:
        raise ValueError(f"cycle_s must be positive, got {cycle_s!r}")
    delta_s = (los - t if los is not None else LEAD_DEFAULT).total_seconds()
    step = max(delta_s / 2.0, cycle_s)
    best = setp
    ahead = step                                    # วินาทีหลัง t ของเวลาที่ลอง
    while True:
        step /= 2.0
        if step < cycle_s / 4.0:
            break
        ok = False
        raw = predict(t + timedelta(seconds=ahead))
        if raw is not None:
            az, el = adjust(raw[0], raw[1], conf, flip)
            ok = 0.0 <= el <= 180.0 and abs(az - setp[0]) <= threshold and abs(el - setp[1]) <= threshold
            if ok:
                best = (az, el)
        ahead += step if ok else -step
    return clamp_to(best[0], best[1], conf)


# ---------------------------------------------------------------- pass ที่เก็บไว้ (ref-R §6.5)


def pass_needs_refresh(p: PassData | None, t: datetime, el: float | None, next_aos: datetime | None, cycle_s: float,
                       moved_km: float) -> bool:
    """ทุก tick ของ module ต้องหา pass ใหม่ไหม (gtk-rot-ctrl.c:515-615) el คือ El ของดาวเป้าหมายตอนนี้ (None = ไม่มีดาวเป้าหมาย
    ไม่มีอะไรต้องหา) next_aos คือ AOS ถัดไปของดาวนั้น moved_km คือระยะที่สถานีย้ายจากสถานีของ pass ที่เก็บไว้
    1. ไม่มี pass ที่เก็บไว้ (ตอนเปิดหรือเลือกดาว)
    2. สถานีย้ายเกิน QTH_MOVE_KM
    3. อยู่นอกช่วง pass และดาวอยู่เหนือขอบฟ้า (El ≥ 0) = pass ที่ไม่ได้คาดไว้
    4. อยู่นอกช่วง pass และ AOS ถัดไปช้ากว่า AOS ที่เก็บไว้เกิน Cycle/4 (ดาวขึ้นใน pass อื่น)
    5. อยู่ในช่วง pass แต่ดาวอยู่ใต้ขอบฟ้า (El < 0)
    ผู้เรียกหา pass ใหม่แบบ pass ปัจจุบันเมื่อ El > 0 ไม่งั้น pass ถัดไปภายใน 3 วัน"""
    if el is None:
        return False
    if p is None or moved_km > QTH_MOVE_KM:
        return True
    if t < p.aos or t > p.los:
        if el >= 0.0:
            return True
        return next_aos is not None and (next_aos - p.aos).total_seconds() > cycle_s / 4.0
    return el < 0.0


# ---------------------------------------------------------------- คำสั่งและคำตอบของ rotctld (ref-R §7)

CMD_GET_POS = "p\n"
CMD_STOP = "S\n"

_NUMBER = re.compile(r"[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?")
_RPRT_CODE = re.compile(r"RPRT\s*([+-]?[0-9]+)\s*")


def cmd_set_pos(az: float, el: float) -> str:
    """`P %.2f %.2f` เช่น `P 180.00 45.00` (ปัดแบบ printf)"""
    return f"P {az:.2f} {el:.2f}\n"


def parse_pos(reply: list[str]) -> tuple[float, float] | None:
    """(Az, El) จากคำตอบของ `p`: บรรทัด 1 คือ Az บรรทัด 2 คือ El คำตอบที่ขึ้นต้น RPRT, น้อยกว่าสองบรรทัด หรือไม่ใช่ตัวเลข คือ None
    (Gpredict อ่านด้วย g_strtod ที่อ่านขยะเป็น 0 ของเราถือว่าเป็นคำตอบเสีย)"""
    if len(reply) < 2 or is_error(reply):
        return None
    values = []
    for line in reply[:2]:
        text = line.strip()
        if not _NUMBER.fullmatch(text):
            return None
        value = float(text)
        if not math.isfinite(value):
            return None
        values.append(value)
    return values[0], values[1]


def parse_rprt(reply: list[str]) -> int | None:
    """รหัสจาก `RPRT <n>` ของคำสั่งตั้งค่า (0 = สำเร็จ) ไม่ใช่รูปนี้คือ None (Gpredict อ่านเลขหลัง 4 ตัวแรกด้วย g_strtod จึงอ่านขยะเป็น 0 = สำเร็จ ของเราถือว่าล้ม)"""
    if not reply:
        return None
    match = _RPRT_CODE.fullmatch(reply[0])
    return int(match.group(1)) if match else None
