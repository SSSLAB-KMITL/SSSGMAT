"""Antenna Control ของ Gpredict (ref-R §5-§7, spec §5 และ §9): ส่วนบนของไฟล์เป็นฟังก์ชันบริสุทธิ์ ไม่มี I/O ส่วนล่างคือ RotController

- คณิตของ set-point (ref-R §6.2) ตามลำดับของ decision 9 ของแผน: ค่าพื้นฐาน → flip → แปลงเป็น −180…+180 → clamp ไปที่ Min/Max
  (Gpredict clamp ก่อนแล้วจึง flip ซึ่งทำให้ rotator −180…+180 หมุนไปทางตะวันตกไม่ได้)
- flip pass (ref-R §6.3), การตรวจ Threshold ในหน่วยของอุปกรณ์ (decision 10, spec §9.1 ข้อ 13), lead-ahead แบบค้นครึ่งช่วงเวลา
  (ref-R §6.4 ข้อ 3) และกติกาหา pass ใหม่ (ref-R §6.5)
- ข้อความคำสั่ง rotctld (ref-R §7) และ parse คำตอบ: เลขทศนิยมใช้ `.` เสมอ การจัดรูปแบบตัวเลขของ Python ไม่ขึ้นกับ locale
  (Gpredict ใช้ `%.2f` ตาม locale ของ process)
- RotController: timer ควบคุมและ client loop (ref-R §5.3-§6.6, spec §5.2, §8, §9.1 ข้อ 12, 15, 16) รายละเอียดอยู่ที่ docstring ของ class
"""

import asyncio
import dataclasses
import logging
import math
import re
from collections.abc import Callable, Sequence
from datetime import datetime, timedelta

from .errors import ApiError
from .hamlib import HamlibClient, HamlibError, is_error
from .hwconf import CYCLE_DEFAULT_MS, CYCLE_MS, THRESHOLD_DEFAULT_DEG, THRESHOLD_DEG, HwConf, RotConf
from .pass_predict import PassData, pass_to_dict
from .rig import MAX_ERROR_COUNT, _as_time, _flag, _integer, _invalid, countdown_text

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


# ================================================================ RotController (ref-R §5.3-§6.6, spec §5.2, §8, §9.1)

ROT_SETTLE_S = 0.1                              # client loop: รอหลัง P ก่อนอ่าน p (g_usleep(100000))
ROT_LOOP_MIN_S = 0.8                            # client loop หนึ่งรอบไม่สั้นกว่านี้ (ref-R §6.1, spec §5.2)
KNOB_DEFAULT = (180.0, 45.0)                    # ปุ่มหมุน Az/El ตอนเปิดหน้าต่าง (ref-R §5.3)
READ_IDLE = " --- "                             # "Read:" ตอนเปิดหน้าต่าง
READ_OFF = "---"                                # "Read:" หลัง Disengage
READ_ERROR = "ERROR"
COUNTDOWN_IDLE = "00:00:00"
QRB_KM_PER_DEG = 111.2                          # ARC_IN_KM ของ locator.c: km ต่อองศาของมุมที่ศูนย์กลางโลกใน qrb
LABEL = "rotctld"
_NO_DEVICE = RotConf(name="", host="", port=0)  # ช่วงของปุ่มหมุนก่อนโหลดอุปกรณ์ได้: Az 0–360, El 0–90 (ref-R §5.3)

_log = logging.getLogger(__name__)


def qth_distance_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    """ระยะตามผิวโลกระหว่างสถานี (lat, lon) สองแห่งแบบ qrb ที่ qth_small_dist ของ Gpredict ใช้: มุมที่ศูนย์กลางโลก (องศา) × 111.2 km
    ใช้สูตร haversine แทน acos ของ qrb ได้ค่าเดียวกันแต่ไม่เสียความแม่นที่ระยะสั้น"""
    lat1, lon1, lat2, lon2 = (math.radians(v) for v in (*a, *b))
    h = math.sin((lat2 - lat1) / 2.0) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2.0) ** 2
    return QRB_KM_PER_DEG * math.degrees(2.0 * math.asin(min(1.0, math.sqrt(h))))


def _number(body: dict, key: str) -> float:
    value = body.get(key)
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise _invalid(key, f"{key} ต้องเป็นตัวเลข")
    return float(value)


def _degrees(value: float) -> str:
    """ค่าใน "Read:" แบบ `%.2f°`"""
    return f"{value:.2f}°"


@dataclasses.dataclass(eq=False)
class _Session:
    """หนึ่งช่วง Engage: การเชื่อมต่อกับ rotctld และค่าที่ client loop กับ timer ควบคุมส่งให้กัน (ctrl->client ของ Gpredict)
    pending: เป้าใหม่ที่ยังไม่ได้ส่ง (new_trg) pos: ตำแหน่งที่อ่านได้ในรอบล่าสุดในหน่วยของอุปกรณ์ (None = ยังไม่เคยอ่านหรืออ่านไม่ได้)
    error: ธง io_error ของรอบล่าสุด lock: หนึ่งรอบของ client ต่อครั้ง stop: ปลด Engage แล้ว task: client loop (timer=True)"""
    conf: RotConf
    client: HamlibClient
    pending: tuple[float, float] | None = None
    pos: tuple[float, float] | None = None
    error: bool = False
    lock: asyncio.Lock = dataclasses.field(default_factory=asyncio.Lock)
    stop: asyncio.Event = dataclasses.field(default_factory=asyncio.Event)
    task: asyncio.Task | None = None


class RotController:
    """Antenna Control ของหนึ่ง module (ref-R §5-§7, spec §5): ค่าของปุ่มและ combo, ค่าจาก tick, timer ควบคุม และ client loop

    - สร้างแล้วอยู่ในสถานะของ ref-R §5.3-§5.5: ดาวแรก (หรือเป้าหมายของ module) และอุปกรณ์แรกตามชื่อ action (spec §8)
      เปลี่ยนสถานะทันที คำสั่งไป rotctld ไปกับรอบถัดไปของ client loop ยกเว้น engage off ที่ส่ง S และ q ทันที
    - timer ควบคุม (timer=True) เริ่มตั้งแต่สร้างและมีตัวเดียว (spec §9.1 ข้อ 16) ทำงานที่จังหวะ epoch + k·Cycle (decision 11
      รอบที่เลยกำหนดถูกข้ามพร้อม log debug) แต่ละรอบคือ control_tick: ขอ pass ที่ต้องการ (ref-R §6.5) → set-point (§6.2,
      ไม่ Engage แต่ Track = ตั้งปุ่มหมุนเป็นตัวอย่าง) → ถ้า Engage ทำ §6.4 ข้อ 1-5 โดย lead-ahead ทำใน thread
    - client loop (timer=True) เริ่มเมื่อ Engage แต่ละรอบ: ต่อใหม่ถ้ายังไม่ได้ต่อ → P ถ้ามีเป้าใหม่และ Monitor ปิด (ล้มเก็บไว้รอบหน้า)
      → รอ ROT_SETTLE_S → p → เก็บตำแหน่งและธง error แล้วพักให้รอบยาวอย่างน้อย ROT_LOOP_MIN_S และพักไม่น้อยกว่าเวลาที่ทำงาน
      (rotctld ถูกใช้ไม่เกินครึ่งเวลาแบบ Gpredict) ไม่ขึ้นกับ Cycle (spec §9.2) timer=False ให้ test เรียก control_tick/client_once เอง
    - error: รอบของ client ที่ต่อไม่ได้ ส่ง P ไม่สำเร็จ หรืออ่าน p ไม่ได้ (รวมคำตอบที่แยกไม่ได้) ตั้งธงหนึ่งครั้งต่อรอบ
      ทุก control_tick ที่เห็นธงนับหนึ่ง ครบ MAX_ERROR_COUNT ปลด Engage เอง (ส่ง S ถ้ายังต่ออยู่) รอบที่ไม่มีธงตัวนับเป็น 0
      ต่อไม่ได้ก็เป็น "ERROR" และนับ (spec §9.1 ข้อ 12: Gpredict ปล่อยปุ่มกดค้างและแสดง 0.00°)
    - "Read:" (ref-R §5.3): " --- " ตอนเริ่ม, `%.2f°` ที่ Az ห่อเข้า [0, 360] แบบช่วงปิดของ Gpredict (360 คงเป็น 360), "ERROR",
      "---" หลัง Disengage หลัง Engage ข้อความคงเดิมจนอ่านได้ครั้งแรก (ของเรา: Gpredict แสดง 0.00° ของค่าที่ยังไม่เคยอ่าน)
      การเทียบ Threshold ใช้ค่าที่อ่านในหน่วยของอุปกรณ์ ไม่ห่อ (decision 10) ยังไม่รู้ตำแหน่ง = ต่างเกิน Threshold
    - pass: on_tick ตัดสินด้วย pass_needs_refresh ว่าต้องหา pass ใหม่ control_tick เรียก pass_for ใน thread ไม่เกินรอบละครั้ง
      (รอบทำทีละรอบ จึงไม่มีสองคำขอซ้อนกัน) จนได้ "ok" แล้วตรวจ flip ใหม่ ไม่มี pass = ไม่ flip
    - status (ของเรา): ข้อผิดพลาดล่าสุดเป็นภาษาไทย หายเมื่อรอบของ client ไม่มี error หรือ Engage ใหม่ และเหตุที่ปลด Engage เอง
    - act และ close ทำทีละคำขอ (ของเรา): engage off ต้องหยุดและปิดการเชื่อมต่อเดิมให้จบก่อน engage on ของอีกคำขอเริ่ม
      timer ไม่ใช้ lock ของ act หลัง close ทุก act ได้ CONTROLLER_INVALID close ซ้ำไม่ทำอะไร
    """

    def __init__(self, module: str, hw: HwConf, sats: list[tuple[int, str]], target: int | None,
                 predict: Callable[[int, datetime], tuple[float, float] | None],
                 pass_for: Callable[[int, datetime], tuple[str, PassData | None]], timer: bool = True) -> None:
        self.module = module
        self.engaged = False
        self._hw = hw
        self._sats = list(sats)
        self._predict = predict
        self._pass_for = pass_for
        self._timer = timer
        self._devices = [r.name for r in hw.rotators()]        # combo สร้างครั้งเดียวตอนเปิดหน้าต่าง เรียงชื่อ (ref-R §5.5)
        self._device: str | None = None
        self._conf: RotConf | None = None                     # None = อ่านไฟล์ของอุปกรณ์ไม่ได้ Engage ไม่ได้
        self._range = _NO_DEVICE                              # ช่วงของปุ่มหมุน: ของอุปกรณ์ล่าสุดที่โหลดได้
        self._track = False
        self._monitor = False
        self._cycle_ms = CYCLE_DEFAULT_MS
        self._threshold = THRESHOLD_DEFAULT_DEG
        self._knob = KNOB_DEFAULT
        self._norad: int | None = None
        # ค่าจาก tick ล่าสุดของ module
        self._t: datetime | None = None
        self._qth: tuple[float, float] | None = None
        self._sat: tuple[float, float] | None = None          # (Az, El) ของดาวเป้าหมาย None = ยังไม่มี tick ของดาวนี้
        self._countdown = COUNTDOWN_IDLE
        # pass ที่เก็บไว้ (ref-R §6.5)
        self._pass: PassData | None = None
        self._pass_dict: dict | None = None
        self._pass_qth: tuple[float, float] | None = None
        self._flip = False
        self._want_pass = False
        # Engage
        self._session: _Session | None = None
        self._read = (READ_IDLE, READ_IDLE)
        self._rotor: tuple[float, float] | None = None
        self._errcnt = 0
        self._status: str | None = None
        # timer และ lock
        self._ticking = asyncio.Lock()                        # หนึ่ง control_tick ต่อครั้ง
        self._acting = asyncio.Lock()                         # หนึ่ง act หรือ close ต่อครั้ง (timer ไม่ใช้)
        self._teardown = asyncio.Lock()                       # หนึ่งการปลด Engage ต่อครั้ง engage on รอให้จบก่อน
        self._closed = False
        self._wake = asyncio.Event()
        self._restart = False
        self._epoch = 0.0
        self._k = 0

        # ref-R §5.4-§5.5 และ create_rot_ctrl: ดาวแรก → อุปกรณ์แรก → เป้าหมายของ module
        if self._sats:
            self._norad = self._sats[0][0]
        if self._devices:
            self._select_device(self._devices[0])
        if target is not None and self._has_sat(target):
            self._select_sat(target)
        self._timer_task = asyncio.create_task(self._run_timer(), name=f"rot:{module}") if timer else None

    # ---------------------------------------------------------------- อ่านสถานะ

    def snapshot(self) -> dict:
        """ทุกค่าที่หน้าต่างแสดง knob/setpoint ในหน่วยของอุปกรณ์ setpoint คือวงกลม set-point บน Polar plot ซึ่ง Gpredict วาดที่ค่า
        ปุ่มหมุน (ref-R §5.6) rotor คือกากบาท: ตำแหน่งที่อ่านได้ (Az ห่อเข้า [0, 360]) เฉพาะขณะ Engage และไม่มี error
        pass เป็น dict เดียวกันทุกครั้งจนกว่า pass จะเปลี่ยน (ผู้เรียกห้ามแก้)"""
        r = self._range
        az, el = self._knob
        return {
            "devices": list(self._devices), "device": self._device, "engaged": self.engaged,
            "track": self._track, "monitor": self._monitor,
            "monitor_enabled": not (self._track or self.engaged),          # ทุกครั้งที่ Track หรือ Engage เปลี่ยน (spec §9.1 ข้อ 15)
            "knobs_enabled": not (self._track or self._monitor),
            "cycle_ms": self._cycle_ms, "threshold_deg": self._threshold,
            "sats": [{"norad": norad, "name": name} for norad, name in self._sats], "norad": self._norad,
            "knob": {"az": az, "el": el},
            "limits": {"min_az": r.min_az, "max_az": r.max_az, "min_el": r.min_el, "max_el": r.max_el, "az_type": r.az_type},
            "target": None if self._sat is None else {"az": self._sat[0], "el": self._sat[1]},
            "countdown": self._countdown,
            "read": {"az": self._read[0], "el": self._read[1]},
            "setpoint": {"az": az, "el": el},
            "rotor": None if self._rotor is None else {"az": self._rotor[0], "el": self._rotor[1]},
            "pass": self._pass_dict,
            "status": self._status,
        }

    # ---------------------------------------------------------------- จาก module

    def on_tick(self, t: datetime, sat: dict | None, qth: tuple[float, float]) -> None:
        """ค่าของดาวเป้าหมายใน tick (gtk_rot_ctrl_update): Az/El, count-down และการตัดสินว่าต้องหา pass ใหม่ไหม (ref-R §6.5)
        qth คือ (lat, lon) ของสถานี None (ไม่มีแถวของดาว) คงค่าเดิม"""
        if sat is None:
            return
        az, el = sat["az"], sat["el"]
        next_aos = _as_time(sat.get("next_aos"))
        self._t, self._qth, self._sat = t, qth, (az, el)
        when = next_aos if el < 0.0 else _as_time(sat.get("next_los"))
        # (ของเรา) ไม่รู้เวลาของเหตุการณ์: แสดงค่าเริ่มต้น (Gpredict คำนวณจากเวลา 0 ได้ค่าที่ไม่มีความหมาย)
        self._countdown = COUNTDOWN_IDLE if when is None else countdown_text((when - t).total_seconds(), None)
        moved = 0.0 if self._pass_qth is None else qth_distance_km(self._pass_qth, qth)
        if pass_needs_refresh(self._pass, t, el, next_aos, self._cycle_ms / 1000.0, moved):
            self._want_pass = True

    def set_target(self, norad: int) -> None:
        """เป้าหมายของ module เปลี่ยน: เลือกดาวนั้นถ้าอยู่ในรายชื่อและยังไม่ได้เลือกอยู่ (gtk_rot_ctrl_select_sat)"""
        if norad != self._norad and self._has_sat(norad):
            self._select_sat(norad)

    # ---------------------------------------------------------------- action (spec §8)

    async def act(self, body: dict) -> None:
        """body ผิดรูป ค่าผิด หรือปุ่มที่กดไม่ได้ตาม ref-R §6.1: ApiError CONTROLLER_INVALID 422 โดยไม่เปลี่ยนสถานะ"""
        handlers = {
            "engage": self._act_engage, "track": self._act_track, "monitor": self._act_monitor,
            "satellite": self._act_satellite, "device": self._act_device, "cycle": self._act_cycle,
            "threshold": self._act_threshold, "az": self._act_az, "el": self._act_el,
        }
        action = body.get("action") if isinstance(body, dict) else None
        if not isinstance(action, str) or action not in handlers:
            raise _invalid("action", "action ต้องเป็นหนึ่งใน " + ", ".join(handlers))
        async with self._acting:
            if self._closed:
                raise _invalid("action", f"หน้าต่าง Antenna Control ของ module {self.module} ปิดแล้ว")
            await handlers[action](body)

    async def _act_engage(self, body: dict) -> None:
        on = _flag(body, "on")
        if on and not self.engaged:
            await self._settle()                                 # การปลดเองจาก error ที่ยังทำอยู่ให้จบก่อน
            self._engage()
        elif not on and self.engaged:
            await self._disengage()

    async def _act_track(self, body: dict) -> None:
        on = _flag(body, "on")
        if self._monitor:
            raise _invalid("on", "กด Track ไม่ได้ขณะเปิด Monitor")
        self._track = on

    async def _act_monitor(self, body: dict) -> None:
        on = _flag(body, "on")
        if self._track or self.engaged:
            raise _invalid("on", "เปลี่ยน Monitor ไม่ได้ขณะ Track หรือ Engage")
        self._monitor = on

    async def _act_satellite(self, body: dict) -> None:
        norad = _integer(body, "norad")
        if not self._has_sat(norad):
            raise _invalid("norad", f"ไม่มีดาว NORAD {norad} ใน module {self.module}")
        if norad != self._norad:
            self._select_sat(norad)

    async def _act_device(self, body: dict) -> None:
        name = body.get("name")
        if self.engaged:
            raise _invalid("name", "เปลี่ยนอุปกรณ์ระหว่าง Engage ไม่ได้")
        if name not in self._devices:
            raise _invalid("name", f"ไม่มี rotator ชื่อ {name} ใน \"Device:\"")
        self._select_device(name)

    async def _act_cycle(self, body: dict) -> None:
        ms = _integer(body, "ms")
        if not CYCLE_MS[0] <= ms <= CYCLE_MS[1]:
            raise _invalid("ms", f"Cycle ต้องเป็นจำนวนเต็ม {CYCLE_MS[0]}–{CYCLE_MS[1]} มิลลิวินาที")
        self._set_cycle(ms)

    async def _act_threshold(self, body: dict) -> None:
        deg = _number(body, "deg")
        if not THRESHOLD_DEG[0] <= deg <= THRESHOLD_DEG[1]:
            raise _invalid("deg", f"Threshold ต้องเป็นตัวเลข {THRESHOLD_DEG[0]:g}–{THRESHOLD_DEG[1]:g} องศา")
        self._threshold = deg

    async def _act_az(self, body: dict) -> None:
        self._knob = clamp_to(self._knob_value(body), self._knob[1], self._range)

    async def _act_el(self, body: dict) -> None:
        self._knob = clamp_to(self._knob[0], self._knob_value(body), self._range)

    def _knob_value(self, body: dict) -> float:
        """ค่าที่ผู้ใช้หมุน (ถูกบีบเข้าช่วงของอุปกรณ์แบบ gtk_rot_knob_set_value) ปุ่มหมุนกดไม่ได้ขณะ Track หรือ Monitor"""
        deg = _number(body, "deg")
        if self._track or self._monitor:
            raise _invalid("deg", "ปรับปุ่มหมุนไม่ได้ขณะ Track หรือ Monitor")
        return deg

    # ---------------------------------------------------------------- อุปกรณ์ ดาว pass

    def _has_sat(self, norad: int) -> bool:
        return any(n == norad for n, _ in self._sats)

    def _select_device(self, name: str) -> None:
        """ref-R §5.5 "Choosing a device": Cycle และ Threshold ของไฟล์, ช่วงของปุ่มหมุน (ค่าเดิมถูกบีบเข้าช่วง) แล้วตรวจ flip ใหม่
        อ่านไฟล์ไม่ได้: Engage ไม่ได้ ค่าอื่นคงเดิม"""
        self._device = name
        conf = self._conf = self._hw.rotator(name)
        if conf is None:
            _log.error("Failed to load rotator configuration %s", name)
            self._status = f"อ่านค่าของ rotator {name} ไม่ได้"
            return
        _log.info("Loaded new rotator configuration %s", name)
        self._status = None
        self._set_cycle(conf.cycle)
        self._threshold = conf.threshold
        self._range = conf
        self._knob = clamp_to(*self._knob, conf)
        self._check_flip()

    def _set_cycle(self, ms: int) -> None:
        """Cycle ที่เปลี่ยนเริ่ม timer ควบคุมใหม่ทันที (ref-R §5.5)"""
        if ms != self._cycle_ms:
            self._cycle_ms = ms
            self._restart = True
            self._wake.set()

    def _select_sat(self, norad: int) -> None:
        """sat_selected_cb: ทิ้ง pass เดิม (tick ถัดไปของดาวใหม่ขอ pass ใหม่) Az/El ของดาวใหม่มากับ tick ถัดไป"""
        self._norad = norad
        self._sat = None
        self._store_pass(None, None)

    def _store_pass(self, p: PassData | None, qth: tuple[float, float] | None) -> None:
        self._pass, self._pass_qth = p, qth
        self._pass_dict = None if p is None else pass_to_dict(p)
        self._check_flip()

    def _check_flip(self) -> None:
        """set_flipped_pass (ref-R §6.3): Az ของ AOS ของทุกแถวและของ LOS ไม่มี pass = ไม่ flip (ไม่ค้างค่าจาก pass ก่อน)"""
        p = self._pass
        self._flip = p is not None and is_flip_pass([p.aos_az, *(r["az"] for r in p.rows), p.los_az], self._range)

    async def _refresh_pass(self) -> None:
        """ขอ pass ที่ on_tick ตัดสินว่าต้องหาใหม่จนได้ "ok" (ไม่มี pass ใน 3 วันก็ "ok" กับ None) ระหว่างนั้นใช้ pass เดิม
        ผลของดาวที่ถูกเปลี่ยนไประหว่างรอถูกทิ้ง"""
        norad, t, qth = self._norad, self._t, self._qth
        if not self._want_pass or norad is None or self._sat is None:
            return
        try:
            status, p = await asyncio.to_thread(self._pass_for, norad, t)
        except Exception:                                        # (ของเรา) ไม่ให้ set-point หยุด ลองใหม่เมื่อ tick ถัดไปของ module ขอ
            _log.exception("หา pass ของดาว %d ให้ rotator ไม่ได้", norad)
            self._want_pass = False
            return
        if status == "ok" and norad == self._norad:
            self._want_pass = False
            self._store_pass(p, qth)

    # ---------------------------------------------------------------- timer ควบคุม (ref-R §6.2, §6.4)

    async def _run_timer(self) -> None:
        """รอบแรกหนึ่ง Cycle หลังสร้าง (g_timeout_add) แล้วที่จังหวะ epoch + k·Cycle (decision 11)"""
        loop = asyncio.get_running_loop()
        self._epoch, self._k = loop.time(), 0
        while await self._wait_next(loop):
            try:
                await self.control_tick()
            except Exception:                                    # (ของเรา) รอบที่ล้มไม่หยุด timer
                _log.exception("timer ควบคุม rotator ของ module %s ล้มในรอบนี้", self.module)

    async def _wait_next(self, loop: asyncio.AbstractEventLoop) -> bool:
        """รอถึงจังหวะ k ถัดไป จังหวะที่ผ่านไปแล้วถูกข้าม (log ทีละจังหวะ) Cycle ที่เปลี่ยนเริ่มนับใหม่จากตอนนี้ คืน False เมื่อหน้าต่างปิด"""
        self._k += 1
        while not self._closed:
            if self._restart:
                self._restart = False
                self._epoch, self._k = loop.time(), 1
            period = self._cycle_ms / 1000.0
            now = loop.time()
            due = self._epoch + self._k * period
            if due <= now:
                upcoming = max(math.floor((now - self._epoch) / period) + 1, self._k + 1)
                for _ in range(upcoming - self._k):
                    _log.debug("%s missed the deadline", self.module)
                self._k = upcoming
                continue
            self._wake.clear()
            try:
                await asyncio.wait_for(self._wake.wait(), due - now)
            except TimeoutError:
                return True
        return False

    async def control_tick(self) -> None:
        """หนึ่งรอบของ timer ควบคุม (rot_ctrl_timeout_cb)"""
        async with self._ticking:
            await self._refresh_pass()
            target = self._sat
            setp = setpoint(self._t, target, self._pass, self._range, self._flip, self._knob, self._track)
            s = self._session
            if s is None:
                if self._track and target is not None:
                    self._knob = clamp_to(*setp, self._range)    # ไม่ Engage: ปุ่มหมุนแสดงตัวอย่าง
                return
            await self._engaged_tick(s, setp, target)

    async def _engaged_tick(self, s: _Session, setp: tuple[float, float], target: tuple[float, float] | None) -> None:
        """ref-R §6.4 ข้อ 1-5 (ส่วนที่ทำเฉพาะขณะ Engage)"""
        error, pos = s.error, s.pos
        # 1. ค่าจาก client: "Read:" และกากบาทบน plot
        if error:
            self._read, self._rotor = (READ_ERROR, READ_ERROR), None
        elif pos is not None:
            az = _wrap_window(pos[0], 0.0, 360.0)
            self._read, self._rotor = (_degrees(az), _degrees(pos[1])), (az, pos[1])
        # 2. ต่างเกิน Threshold (หน่วยของอุปกรณ์)
        if pos is None or move_due(setp, pos, self._threshold):
            # 3. lead-ahead
            if self._track and target is not None and target[1] > 0.0:
                setp = await self._lead(setp)
                if self._session is not s:                       # ปลด Engage ระหว่างคำนวณ
                    return
            # 4. ปุ่มหมุนเป็น set-point และส่งเป้าใหม่ให้ client loop (ค่าที่ไม่ถูกบีบ เช่น NO_PASS_SETPOINT ส่งตามนั้นแบบ Gpredict)
            self._knob = clamp_to(*setp, self._range)
            s.pending = setp
        # 5. นับ error
        if not error:
            self._errcnt = 0
            return
        self._errcnt += 1
        if self._errcnt >= MAX_ERROR_COUNT:
            await self._auto_disengage()

    async def _lead(self, setp: tuple[float, float]) -> tuple[float, float]:
        norad, predict, p = self._norad, self._predict, self._pass

        def at(when: datetime) -> tuple[float, float] | None:
            return predict(norad, when)

        return await asyncio.to_thread(lead_ahead, self._t, None if p is None else p.los, self._cycle_ms / 1000.0,
                                       self._threshold, setp, at, self._range, self._flip)

    # ---------------------------------------------------------------- Engage

    def _engage(self) -> None:
        conf = self._conf
        if conf is None:
            _log.error("Controller does not have a valid configuration")
            self._status = "ไม่มีค่าของ rotator ใน \"Device:\" ที่ใช้ได้ จึง Engage ไม่ได้"
            return
        s = self._session = _Session(conf, HamlibClient(conf.host, conf.port, LABEL))
        self.engaged = True
        self._status = None
        if self._timer:
            s.task = asyncio.create_task(self._client_loop(s), name=f"rotctld:{self.module}")

    async def _disengage(self) -> None:
        """Engage off (ref-R §6.1): "Read:" เป็น "---" แล้วหยุด client loop ส่ง S ถ้ายังต่ออยู่ และปิดด้วย q"""
        s, self._session = self._session, None
        self.engaged = False
        self._read, self._rotor = (READ_OFF, READ_OFF), None
        async with self._teardown:
            if s is not None:
                await self._end_session(s)

    async def _settle(self) -> None:
        """รอการปลด Engage ที่ยังทำอยู่ให้จบ (เช่น timer กำลังปลดเองจาก error)"""
        async with self._teardown:
            pass

    async def _auto_disengage(self) -> None:
        """error ครบ MAX_ERROR_COUNT: ปล่อยปุ่ม Engage เองแบบเดียวกับผู้ใช้ปล่อย (ref-R §6.4 ข้อ 5) ไม่ใช้ lock ของ act"""
        _log.error("MAX_ERROR_COUNT (%d) reached. Disengaging device!", MAX_ERROR_COUNT)
        reason = self._status
        self._errcnt = 0
        await self._disengage()
        self._status = f"ปลด Engage เองเพราะผิดพลาดครบ {MAX_ERROR_COUNT} ครั้ง" + (f": {reason}" if reason else "")

    async def _end_session(self, s: _Session) -> None:
        """หยุด client loop (รอรอบที่ค้างอยู่ให้จบ) แล้วส่ง S ถ้ายังต่ออยู่ และปิดด้วย q"""
        s.stop.set()
        task, s.task = s.task, None
        if task is not None:
            await task
        async with s.lock:
            if s.client.connected:
                await self._stop_rotator(s)
            await s.client.close()

    async def close(self) -> None:
        """หน้าต่างปิด: หยุด timer ควบคุม ปลด Engage (S แล้ว q) แล้วเก็บ Cycle และ Threshold ลงไฟล์ของอุปกรณ์ (ref-R §6.1, §9.3)
        เก็บไม่ได้แค่ log การปิดไม่ล้มเพราะเรื่องนี้ เรียกซ้ำได้ (ครั้งหลังไม่ทำอะไร)"""
        async with self._acting:
            if self._closed:
                return
            self._closed = True
            task, self._timer_task = self._timer_task, None
            self._wake.set()
            if task is not None:
                await task
            if self.engaged:
                await self._disengage()
            else:
                await self._settle()
            self._save_runtime()

    def _save_runtime(self) -> None:
        conf = self._conf
        if conf is None:
            return
        try:
            self._hw.save_rotator_runtime(conf.name, self._cycle_ms, self._threshold)
        except (ApiError, OSError) as exc:
            _log.error("บันทึก Cycle และ Threshold ของ rotator %s ไม่ได้ (%s)", conf.name, exc)    # (ของเรา)

    # ---------------------------------------------------------------- client loop (ref-R §6.1, §7)

    async def client_once(self) -> None:
        """หนึ่งรอบของ client loop (ข้อ 1-4 ไม่รวมการพัก) ไม่ทำอะไรเมื่อไม่ได้ Engage"""
        s = self._session
        if s is not None:
            await self._client_round(s)

    async def _client_loop(self, s: _Session) -> None:
        """rotctld_client_thread: หนึ่งรอบแล้วพัก max(ROT_LOOP_MIN_S − เวลาที่ทำงาน, เวลาที่ทำงาน) จนปลด Engage"""
        loop = asyncio.get_running_loop()
        _log.debug("Starting rotctld client thread")
        try:
            while not s.stop.is_set():
                started = loop.time()
                await self._client_round(s)
                elapsed = loop.time() - started
                await self._nap(s, max(ROT_LOOP_MIN_S - elapsed, elapsed))
        except Exception:                                        # (ของเรา) ธง error ทำให้ timer ปลด Engage เองภายใน 5 รอบ
            _log.exception("client loop ของ rotator ของ module %s หยุด", self.module)
            s.pos, s.error = None, True
            self._status = f"การควบคุม rotator ของ module {self.module} หยุดเพราะข้อผิดพลาดภายใน"
        _log.debug("Stopping rotctld client thread")

    async def _client_round(self, s: _Session) -> None:
        async with s.lock:
            if not s.stop.is_set():
                await self._client_pass(s)

    async def _client_pass(self, s: _Session) -> None:
        """(1) เป้าใหม่และ Monitor ปิด: P ล้มเก็บไว้รอบหน้า (2) รอ ROT_SETTLE_S (3) p (4) เก็บตำแหน่งและธง error
        ยังไม่ได้ต่อ: ต่อก่อน ต่อไม่ได้หรือการเชื่อมต่อถูกปิดระหว่างรอบ = error หนึ่งครั้ง คำสั่งที่เหลือของรอบไม่ส่ง ต่อใหม่รอบหน้า"""
        if not s.client.connected and not await self._connect(s):
            s.pos, s.error = None, True
            return
        error = False
        target, s.pending = s.pending, None
        if target is not None and not self._monitor:
            if await self._set_pos(s, target):
                target = None
            else:
                error = True
        if target is not None and s.pending is None:            # เป้าใหม่ที่ timer ให้มาระหว่างนี้ชนะ
            s.pending = target
        if not s.client.connected:
            s.pos, s.error = None, True
            return
        if not await self._nap(s, ROT_SETTLE_S):
            return                                               # ปลด Engage ระหว่างรอ
        pos = await self._get_pos(s)
        s.pos, s.error = pos, error or pos is None
        if not s.error:
            self._status = None

    @staticmethod
    async def _nap(s: _Session, seconds: float) -> bool:
        """พัก seconds วินาที คืน False เมื่อปลด Engage ระหว่างพัก"""
        try:
            await asyncio.wait_for(s.stop.wait(), seconds)
        except TimeoutError:
            return True
        return False

    async def _connect(self, s: _Session) -> bool:
        conf = s.conf
        try:
            await s.client.connect()
        except HamlibError as exc:
            _log.error("Connection to rotctld server at %s:%d failed: %s", conf.host, conf.port, exc)
            self._status = str(exc)
            return False
        _log.debug("Connection opened to %s:%d", conf.host, conf.port)
        return True

    async def _cmd(self, s: _Session, cmd: str, lines: int = 1) -> list[str] | None:
        """หนึ่งคำสั่ง คืนคำตอบ หรือ None เมื่อการเชื่อมต่อล้ม (hamlib.py ปิดการเชื่อมต่อแล้ว)"""
        try:
            return await s.client.command(cmd, lines)
        except HamlibError as exc:
            _log.error("%s", exc)                                # (ของเรา) ข้อความไทยของ hamlib.py
            self._status = str(exc)
            return None

    async def _set_pos(self, s: _Session, target: tuple[float, float]) -> bool:
        """P: สำเร็จเมื่อตอบ RPRT 0 (คำตอบที่แยกไม่ได้นับว่าล้ม)"""
        az, el = target
        cmd = cmd_set_pos(az, el)
        reply = await self._cmd(s, cmd)
        if reply is None:
            return False
        code = parse_rprt(reply)
        if code == 0:
            return True
        answer = reply[0]
        if code is None:
            _log.error("rotctld returned bad response (%s)", answer)
        else:
            _log.error("rotctld returned error %d with az %f el %f(%s)", code, az, el, answer)
        self._rejected(s, cmd, answer)
        return False

    async def _get_pos(self, s: _Session) -> tuple[float, float] | None:
        """p: (Az, El) ในหน่วยของอุปกรณ์ หรือ None เมื่อล้ม ตอบ RPRT หรือคำตอบที่แยกไม่ได้ไม่ถือเป็น 0 แบบ g_strtod"""
        reply = await self._cmd(s, CMD_GET_POS, lines=2)
        if reply is None:
            return None
        pos = parse_pos(reply)
        if pos is None:
            answer = " ".join(reply)
            if is_error(reply):
                _log.error("rotctld returned error (%s)", answer)
            else:
                _log.error("rotctld returned bad response (%s)", answer)
            self._rejected(s, CMD_GET_POS, answer)
        return pos

    async def _stop_rotator(self, s: _Session) -> None:
        """S ตอน Disengage: ตอบอย่างอื่นนอกจาก RPRT 0 แค่ log (ref-R §7)"""
        try:
            reply = await s.client.command(CMD_STOP)
        except HamlibError as exc:
            _log.error("%s", exc)
            return
        code = parse_rprt(reply)
        if code is None:
            _log.error("rotctld returned bad response (%s)", reply[0])
        elif code != 0:
            _log.error("rotctld returned error %d with stop-cmd (%s)", code, reply[0])

    def _rejected(self, s: _Session, cmd: str, answer: str) -> None:
        self._status = f"{LABEL} {s.conf.host}:{s.conf.port} ตอบ \"{answer}\" ต่อคำสั่ง \"{cmd.rstrip()}\""
