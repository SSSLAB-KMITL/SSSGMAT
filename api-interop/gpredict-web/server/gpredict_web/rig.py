"""Radio Control ของ Gpredict (ref-R §2-§4, spec §4 และ §9): ส่วนบนของไฟล์เป็นฟังก์ชันบริสุทธิ์ ไม่มี I/O ส่วนล่างคือ RigController

- สูตร Doppler/LO (ref-R §3.2) และ transponder tune/lock (§3.3) หน่วย Hz ตรงตัว ไม่จำกัด passband (spec §9.2)
- ข้อความคำสั่ง rigctld ทุกตัวสร้างที่นี่ที่เดียว (ref-R §4.1) ตรงตามตัวอักษรของ Gpredict ยกเว้นสามข้อที่ spec §9.1 แก้
  (Set PTT ไม่ส่ง q ต่อท้าย, FT817 split ใช้ชื่อ VFO แทนเลขที่ไม่ได้อ่านจากไฟล์, DCD ไม่มีชื่อ VFO) ความถี่ใช้ `%10.0f` ไม่มีจุดทศนิยม
  และการจัดรูปแบบตัวเลขของ Python ไม่ขึ้นกับ locale
- parse คำตอบของ rigctld (§3.6, §4.2) และข้อความ count-down (§2.6)
- RigController: state machine และ cycle ของทุกชนิดวิทยุ (ref-R §2.7, §3.1-§3.8) รายละเอียดอยู่ที่ docstring ของ class
"""

import asyncio
import dataclasses
import logging
import math
import re
import time
from collections.abc import Callable
from datetime import datetime

from .errors import ApiError
from .hamlib import HamlibClient, HamlibError, is_error, is_ok
from .hwconf import CYCLE_DEFAULT_MS, CYCLE_MS, DEFAULT_FREQ_HZ, HwConf, RadioConf
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
# ผลเป็น str ที่ลงท้าย \n (CMD_GET_DCD เป็น bytes เพราะมีไบต์ 0x8B) vfo_opt = ธง VFO option ของอุปกรณ์นั้น (ref-R §4.2)

CMD_SET_VFO_OPT = "\\set_vfo_opt 1\n"
CMD_CHK_VFO = "\\chk_vfo\n"
CMD_AOS = "AOS\n"
CMD_LOS = "LOS\n"
CMD_AOIQ = "U IQRECORD 1\n"
CMD_LOIQ = "U IQRECORD 0\n"
# DCD: ไบต์ 0x8B (รหัสสั้นของ get_dcd ใน hamlib) ไม่มีชื่อ VFO แม้มี VFO option ต่างจาก Gpredict (spec §9.1): rigctld 4.7.2
# ไม่อ่านชื่อ VFO ของ get_dcd แต่อ่าน ` currVFO` เป็นคำสั่งอีกตัว คำตอบจึงเกินมาหนึ่งบรรทัด (RPRT -1) และเหลื่อมกับทุกคำสั่งหลังจากนั้น
CMD_GET_DCD = b"\x8b\n"

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


# ================================================================ RigController (ref-R §2.7, §3, spec §4.2, §8, §9.1)

MAX_ERROR_COUNT = 5
READBACK_DELAY_S = 0.005                     # WR_DEL: รอให้วิทยุตั้งความถี่ก่อนอ่านกลับ
FREQ_THRESHOLD_HZ = 1.0
FT817_TX_THRESHOLD_HZ = 10.0
FT817_TX_PERIOD_S = 10.0
FREQ_MAX_HZ = 9_999_999_999                  # ช่วงของปุ่มหมุนความถี่ (gtk-freq-knob.c)
PTT_LOCK_TRIES = 4                           # SPACE รอ controller ว่าง 4 ครั้ง ครั้งละ 100 ms (manage_ptt_event)
PTT_LOCK_POLL_S = 0.1
COUNTDOWN_IDLE = "ΔT: 00:00:00"
NO_DEVICE = "None"
LABEL = "rigctld"

# ชนิดวิทยุ (radio-conf.h, ลำดับเดียวกับ hwconf.RIG_TYPES) และ PTT "Read PTT"
RX_ONLY, TX_ONLY, HALF_DUPLEX, FULL_DUPLEX, FT817_AUTO, FT817_MANUAL = range(6)
_FT817 = (FT817_AUTO, FT817_MANUAL)
PTT_CAT = 1

# นาฬิกาของจังหวะ TX ของ FT817 (auto) test patch ได้ (ของเรา: monotonic แทนเวลาเครื่อง ไม่สะดุดเมื่อปรับนาฬิกา)
_clock = time.monotonic

_log = logging.getLogger(__name__)


@dataclasses.dataclass(eq=False)
class _Device:
    """อุปกรณ์ที่ Engage อยู่ vfo_opt เป็นของอุปกรณ์นั้นเอง (decision 6 แก้ ref-R §13 ข้อ 6)
    down: การเชื่อมต่อล้มในรอบนี้และนับ error แล้ว คำสั่งที่เหลือของรอบไม่ถูกส่งและไม่นับซ้ำ"""
    conf: RadioConf
    client: HamlibClient
    primary: bool
    vfo_opt: bool = False
    down: bool = False


def _knob(old: float, new: float) -> float:
    """ปุ่มหมุนความถี่ไม่รับค่านอก 0 … FREQ_MAX_HZ ค่าเดิมจึงคงอยู่ (gtk_freq_knob_set_value)"""
    return float(new) if 0.0 <= new <= FREQ_MAX_HZ else old


def _invalid(field: str, text: str) -> ApiError:
    return ApiError("CONTROLLER_INVALID", 422, text, field)


def _flag(body: dict, key: str) -> bool:
    value = body.get(key)
    if not isinstance(value, bool):
        raise _invalid(key, f"{key} ต้องเป็น true หรือ false")
    return value


def _integer(body: dict, key: str) -> int:
    value = body.get(key)
    if isinstance(value, bool) or not isinstance(value, int):
        raise _invalid(key, f"{key} ต้องเป็นจำนวนเต็ม")
    return value


def _as_time(value) -> datetime | None:
    """next_aos/next_los ของแถวใน tick (ISO 8601 ลงท้าย Z) หรือ datetime"""
    if value is None or isinstance(value, datetime):
        return value
    return datetime.fromisoformat(value)


def _shown(cmd: str | bytes) -> str:
    data = cmd.encode("ascii") if isinstance(cmd, str) else cmd
    return data.rstrip(b"\n").decode("ascii", "backslashreplace")


class RigController:
    """Radio Control ของหนึ่ง module (ref-R §2-§4, spec §4): ค่าของปุ่มและ combo, ค่าจาก tick และ cycle ที่คุยกับ rigctld

    - สร้างแล้วอยู่ในสถานะของ ref-R §2.7 action (spec §8) เปลี่ยนสถานะทันที คำสั่ง hamlib ไปกับรอบถัดไป ยกเว้น engage off
      (ปิดอุปกรณ์) และ ptt_toggle (ปุ่ม SPACE ส่งทันทีแบบ Gpredict)
    - Engage สร้าง client ต่ออุปกรณ์ timer=True เริ่ม task ที่เรียก run_cycle ทันทีแล้วทุก Cycle (decision 11: รอบที่เลยกำหนด
      ระหว่างรอบก่อนยังไม่จบถูกข้ามพร้อม log debug ไม่ต่อคิวแบบ Gpredict, spec §9.1 ข้อ 9) timer=False ให้ test เรียก run_cycle เอง
    - ทุกรอบ: อุปกรณ์ที่ยังไม่ได้ต่อถูกต่อ (ตรวจ VFO option และตั้ง split ของ Full-duplex/FT817 ทุกครั้งที่ต่อ เหมือน rigctrl_open)
      → AOS/LOS (เฉพาะ Engage และ Track) → cycle ตามชนิดวิทยุหรือ dual-rig ตาม ref-R §3.4 → error ครบ MAX_ERROR_COUNT แล้ว
      disengage เอง Gpredict รอบแรกหลัง Engage ทำ cycle สองครั้ง (ใน rigctrl_open และต่อจากนั้น) ของเราทำครั้งเดียว
    - นับ error เหมือน Gpredict (การตั้ง/อ่านความถี่ที่ล้ม, ตั้งสำเร็จ = 0) ยกเว้นการเชื่อมต่อที่ล้ม (HamlibError รวม timeout ของ
      spec §9.1 ข้อ 8) นับครั้งเดียวต่ออุปกรณ์ต่อรอบ คำสั่งที่เหลือของรอบไม่ถูกส่ง (rigctld ที่ตายจึง disengage ใน 5 รอบ)
      AOS/LOS ที่ไม่ได้คำตอบไม่นับ (decision 12) แต่การเชื่อมต่อถูกปิด จึงต่อใหม่ก่อนทำ cycle ในรอบเดียวกัน
    - status (ของเรา): ข้อผิดพลาดล่าสุดเป็นภาษาไทย หายเมื่อตั้งความถี่สำเร็จหรือ Engage ใหม่ และเหตุที่ disengage เอง
    - act และ close ทำทีละคำขอ (ของเรา): engage off ที่รอรอบช้าๆ ต้องปิดการเชื่อมต่อเดิมให้จบก่อน engage on ของอีกคำขอเริ่ม
      หลัง close ทุก act ได้ CONTROLLER_INVALID (หน้าต่างปิดแล้ว) close ซ้ำไม่ทำอะไร
    """

    def __init__(self, module: str, hw: HwConf, sats: list[tuple[int, str]], target: int | None,
                 transponders: Callable[[int], list[dict]], timer: bool = True) -> None:
        self.module = module
        self.engaged = False
        self._hw = hw
        self._sats = list(sats)
        self._transponders = transponders
        self._timer = timer
        # combo อุปกรณ์สร้างครั้งเดียวตอนเปิดหน้าต่าง: "1. Device" เรียงชื่อ, "2. Device" ตามลำดับไฟล์ไม่รวม RX only (ref-R §2.5)
        self._devices = [r.name for r in hw.radios()]
        self._devices2 = [NO_DEVICE, *(r.name for r in hw.radios_dir_order() if r.type != RX_ONLY)]
        self._device1: str | None = None
        self._conf1: RadioConf | None = None
        self._device2 = NO_DEVICE
        self._conf2: RadioConf | None = None
        self._track = False
        self._lock = False
        self._cycle_ms = CYCLE_DEFAULT_MS
        # ปุ่มหมุนทั้งสี่เริ่มที่ 145 890 000 Hz (ref-R §2.2) ปุ่มของวิทยุเปลี่ยนเฉพาะใน cycle
        self._down_sat = self._up_sat = self._down_radio = self._up_radio = DEFAULT_FREQ_HZ
        self._norad: int | None = None
        self._trsp_list: list[dict] = []
        self._trsp_index: int | None = None
        # ค่าจาก tick ล่าสุด
        self._az = self._el = self._range = self._rate = None
        self._dd = self._du = 0.0
        # Doppler ที่ใช้ตลอดหนึ่งรอบ: จำตอนเริ่มรอบ (ของเรา) tick ที่มาถึงขณะรอบรอ rigctld จึงไม่เปลี่ยนค่าที่ส่งกลางรอบ
        # Gpredict ทำทั้งรอบรวดเดียวใน timer Doppler จึงเปลี่ยนกลางรอบไม่ได้
        self._cycle_dd = self._cycle_du = 0.0
        self._have_doppler = False
        self._countdown = COUNTDOWN_IDLE
        # AOS/LOS: el ของเป้าหมายปัจจุบัน (None หลังเปลี่ยนดาวจนกว่า tick ของดาวใหม่มาถึง) และ el ของรอบก่อน
        # Gpredict เริ่ม prev_ele = 0.0 และตั้งเป็น el ของดาวที่เลือกตอนเลือก (ของเราใช้ el แรกที่ได้จาก tick)
        self._target_el: float | None = None
        self._prev_el: float | None = 0.0
        self._prev_from_tick = False
        # cycle
        self._dev1: _Device | None = None
        self._dev2: _Device | None = None
        self._errcnt = 0
        self._last_rx = self._last_tx = 0.0                      # ค่าที่ส่ง (อ่านกลับ) ล่าสุด 0 = ไม่ sync (ไม่มี dial feedback)
        self._last_rx_ptt, self._last_tx_ptt = False, True
        self._last_toggle: float | None = None                   # เวลาที่ FT817 (auto) อัปเดต TX ล่าสุด None = ยังไม่เคย
        self._status: str | None = None
        self._busy = asyncio.Lock()                              # หนึ่งรอบหรือหนึ่ง SPACE ต่อครั้ง
        self._acting = asyncio.Lock()                            # หนึ่ง act หรือ close ต่อครั้ง
        self._closed = False
        self._wake = asyncio.Event()
        self._restart = False
        self._task: asyncio.Task | None = None
        self._epoch = 0.0
        self._k = 0

        # ref-R §2.7: ดาวแรก (transponder แรกโดยไม่จูน) → อุปกรณ์ 1 → เป้าหมายของ module (จูน transponder แรก)
        if self._sats:
            self._norad = self._sats[0][0]
        self._load_transponders(tune=False)
        if self._devices:
            self._select_device1(self._devices[0])
        if target is not None and self._has_sat(target):
            self._select_sat(target)

    # ---------------------------------------------------------------- อ่านสถานะ

    @property
    def norad(self) -> int | None:
        """ดาวที่เลือกอยู่ใน combo (ControllerHub ใช้หาแถวของดาวนี้ใน tick)"""
        return self._norad

    def snapshot(self) -> dict:
        conf1, conf2 = self._conf1, self._conf2
        lo = conf1.lo if conf1 else 0.0
        lo_up = conf2.lo_up if conf2 else (conf1.lo_up if conf1 else 0.0)
        doppler = self._have_doppler
        return {
            "devices": list(self._devices), "devices2": list(self._devices2),
            "device1": self._device1, "device2": self._device2,
            "engaged": self.engaged, "track": self._track, "lock": self._lock, "cycle_ms": self._cycle_ms,
            "sats": [{"norad": norad, "name": name} for norad, name in self._sats], "norad": self._norad,
            "transponders": [t["name"] for t in self._trsp_list], "transponder": self._trsp_index,
            "down": {"sat_hz": self._down_sat, "radio_hz": self._down_radio,
                     "doppler_hz": self._dd if doppler else None, "lo_mhz": lo / 1e6},
            "up": {"sat_hz": self._up_sat, "radio_hz": self._up_radio,
                   "doppler_hz": self._du if doppler else None, "lo_mhz": lo_up / 1e6},
            "az": self._az, "el": self._el, "range_km": self._range, "rate_kms": self._rate,
            "countdown": self._countdown,
            "space_ptt": conf1 is not None and conf1.type == FT817_MANUAL,
            "status": self._status,
        }

    # ---------------------------------------------------------------- จาก module

    def on_tick(self, t: datetime, sat: dict | None) -> None:
        """ค่าของดาวเป้าหมายใน tick (gtk_rig_ctrl_update): Az/El/Range/Rate, Doppler จากปุ่มหมุนดาวขณะนั้น และ count-down
        None (ไม่มีแถวของดาว) คงค่าเดิม"""
        if sat is None:
            return
        el, rate = sat["el"], sat["range_rate_kms"]
        self._az, self._el, self._range, self._rate = sat["az"], el, sat["range_km"], rate
        self._target_el = el
        if self._prev_from_tick:
            self._prev_el, self._prev_from_tick = el, False
        self._dd = doppler_down(self._down_sat, rate)
        self._du = doppler_up(self._up_sat, rate)
        self._have_doppler = True
        below = el < 0.0
        when = _as_time(sat.get("next_aos") if below else sat.get("next_los"))
        # (ของเรา) ไม่รู้เวลาของเหตุการณ์: คงข้อความเริ่มต้น (Gpredict คำนวณจากเวลา 0 ได้ค่าที่ไม่มีความหมาย)
        self._countdown = (COUNTDOWN_IDLE if when is None
                           else countdown_text((when - t).total_seconds(), "AOS in" if below else "LOS in"))

    def set_target(self, norad: int) -> None:
        """เป้าหมายของ module เปลี่ยน: เลือกดาวนั้นถ้าอยู่ในรายชื่อและยังไม่ได้เลือกอยู่ (gtk_rig_ctrl_select_sat)"""
        if norad != self._norad and self._has_sat(norad):
            self._select_sat(norad)

    # ---------------------------------------------------------------- action (spec §8)

    async def act(self, body: dict) -> None:
        """body ผิดรูปหรือค่าผิด: ApiError CONTROLLER_INVALID 422 โดยไม่เปลี่ยนสถานะ"""
        handlers = {
            "engage": self._act_engage, "track": self._act_track, "lock": self._act_lock, "tune": self._act_tune,
            "satellite": self._act_satellite, "transponder": self._act_transponder, "device1": self._act_device1,
            "device2": self._act_device2, "cycle": self._act_cycle, "freq": self._act_freq,
            "ptt_toggle": self._act_ptt_toggle,
        }
        action = body.get("action") if isinstance(body, dict) else None
        if not isinstance(action, str) or action not in handlers:
            raise _invalid("action", "action ต้องเป็นหนึ่งใน " + ", ".join(handlers))
        async with self._acting:
            if self._closed:
                raise _invalid("action", f"หน้าต่าง Radio Control ของ module {self.module} ปิดแล้ว")
            await handlers[action](body)

    async def _act_engage(self, body: dict) -> None:
        on = _flag(body, "on")
        if on and not self.engaged:
            await self._settle()                                 # รอบที่กำลัง disengage เองจาก error ให้จบก่อน
            self._engage()
        elif not on and self.engaged:
            await self._disengage()

    async def _act_track(self, body: dict) -> None:
        on = _flag(body, "on")
        if on != self._track:
            self._track = on
            self._last_rx = self._last_tx = 0.0                  # ส่งทั้งสองทางใหม่ในรอบถัดไป (ref-R §3.1)

    async def _act_lock(self, body: dict) -> None:
        on = _flag(body, "on")
        if on != self._lock:
            self._lock = on
            if on:
                self._track_downlink()

    async def _act_tune(self, body: dict) -> None:
        self._tune()

    async def _act_satellite(self, body: dict) -> None:
        norad = _integer(body, "norad")
        if not self._has_sat(norad):
            raise _invalid("norad", f"ไม่มีดาว NORAD {norad} ใน module {self.module}")
        self._select_sat(norad)

    async def _act_transponder(self, body: dict) -> None:
        index = _integer(body, "index")
        if not 0 <= index < len(self._trsp_list):
            raise _invalid("index", f"ดาวนี้ไม่มี transponder ลำดับที่ {index}")
        self._trsp_index = index
        self._tune()

    async def _act_device1(self, body: dict) -> None:
        name = body.get("name")
        self._refuse_while_engaged()
        if name not in self._devices:
            raise _invalid("name", f"ไม่มีวิทยุชื่อ {name} ใน \"1. Device\"")
        self._select_device1(name)

    async def _act_device2(self, body: dict) -> None:
        name = body.get("name")
        self._refuse_while_engaged()
        if name not in self._devices2:
            raise _invalid("name", f"ไม่มีวิทยุชื่อ {name} ใน \"2. Device\"")
        self._select_device2(name)

    async def _act_cycle(self, body: dict) -> None:
        ms = _integer(body, "ms")
        if not CYCLE_MS[0] <= ms <= CYCLE_MS[1]:
            raise _invalid("ms", f"Cycle ต้องเป็นจำนวนเต็ม {CYCLE_MS[0]}–{CYCLE_MS[1]} มิลลิวินาที")
        self._cycle_ms = ms
        if self.engaged:                                         # เริ่ม timer ใหม่ทันที (ref-R §3.1 "Changing Cycle")
            self._restart = True
            self._wake.set()

    async def _act_freq(self, body: dict) -> None:
        """ผู้ใช้หมุนปุ่มความถี่ของดาว: Lock เปิดอยู่ อีกทางตาม (ref-R §3.3)"""
        link, hz = body.get("link"), body.get("hz")
        if link not in ("down", "up"):
            raise _invalid("link", 'link ต้องเป็น "down" หรือ "up"')
        if isinstance(hz, bool) or not isinstance(hz, (int, float)) or not 0 <= hz <= FREQ_MAX_HZ:
            raise _invalid("hz", f"hz ต้องเป็นตัวเลข 0–{FREQ_MAX_HZ}")
        if link == "down":
            self._down_sat = float(hz)
            if self._lock:
                self._track_downlink()
        else:
            self._up_sat = float(hz)
            if self._lock:
                self._track_uplink()

    async def _act_ptt_toggle(self, body: dict) -> None:
        await self._ptt_toggle()

    def _refuse_while_engaged(self) -> None:
        if self.engaged:
            raise _invalid("name", "เปลี่ยนอุปกรณ์ระหว่าง Engage ไม่ได้")

    # ---------------------------------------------------------------- อุปกรณ์ ดาว transponder

    def _has_sat(self, norad: int) -> bool:
        return any(n == norad for n, _ in self._sats)

    def _select_device1(self, name: str) -> None:
        """ref-R §2.5 "Choosing 1. Device": Cycle ของไฟล์, downlink ตั้งต้น และ uplink ตั้งต้นเมื่อไม่มีอุปกรณ์ 2"""
        self._device1 = name
        conf = self._conf1 = self._hw.radio(name)
        if conf is None:
            _log.error("Failed to load radio configuration %s", name)
            self._status = f"อ่านค่าของวิทยุ {name} ไม่ได้"
            return
        _log.info("Loaded new radio configuration %s", name)
        self._status = None
        self._cycle_ms = conf.cycle
        self._down_sat = _knob(self._down_sat, conf.default_down)
        if self._device2 == NO_DEVICE:
            self._up_sat = _knob(self._up_sat, conf.default_up)

    def _select_device2(self, name: str) -> None:
        """ref-R §2.5 "Choosing 2. Device": "None" และชื่อเดียวกับอุปกรณ์ 1 (กลับเป็น "None" เงียบๆ) คืน uplink ตั้งต้นของอุปกรณ์ 1"""
        self._conf2 = None
        if name in (NO_DEVICE, self._device1):
            self._device2 = NO_DEVICE
            if self._conf1 is not None:
                self._up_sat = _knob(self._up_sat, self._conf1.default_up)
            return
        self._device2 = name
        conf = self._conf2 = self._hw.radio(name)
        if conf is None:
            _log.error("Failed to load radio configuration %s", name)
            self._status = f"อ่านค่าของวิทยุ {name} ไม่ได้"
            return
        _log.info("Loaded new radio configuration %s", name)
        self._status = None

    def _select_sat(self, norad: int) -> None:
        """ref-R §3.1 "Choosing a satellite": จำ el ของดาวใหม่สำหรับ AOS/LOS แล้วโหลด transponder (จูนไปตัวแรก)"""
        self._norad = norad
        self._target_el, self._prev_el, self._prev_from_tick = None, None, True
        self._load_transponders(tune=True)

    def _load_transponders(self, tune: bool) -> None:
        self._trsp_list, self._trsp_index = [], None
        if self._norad is None:
            _log.info("GtkSatModule has no target satellite.")
            return
        self._trsp_list = list(self._transponders(self._norad))
        _log.debug("Satellite %d has %d transponder modes.", self._norad, len(self._trsp_list))
        if self._trsp_list:
            self._trsp_index = 0
            if tune:
                self._tune()

    def _transponder(self) -> dict | None:
        return None if self._trsp_index is None else self._trsp_list[self._trsp_index]

    def _tune(self) -> None:
        """ปุ่ม T (ref-R §3.3): กลาง passband ของแต่ละทางที่มีขอบทั้งสอง แล้วล้างค่าที่ส่งล่าสุดของทางนั้น"""
        t = self._transponder()
        if t is None:
            return
        down = tune_centre(t["down_low"], t["down_high"])
        if down is not None:
            self._down_sat = _knob(self._down_sat, down)
            self._last_rx = 0.0
        up = tune_centre(t["up_low"], t["up_high"])
        if up is not None:
            self._up_sat = _knob(self._up_sat, up)
            self._last_tx = 0.0

    def _track_downlink(self) -> None:
        t = self._transponder()
        up = None if t is None else lock_up(self._down_sat, t)
        if up is not None:
            self._up_sat = _knob(self._up_sat, up)

    def _track_uplink(self) -> None:
        t = self._transponder()
        down = None if t is None else lock_down(self._up_sat, t)
        if down is not None:
            self._down_sat = _knob(self._down_sat, down)

    # ---------------------------------------------------------------- Engage และ timer

    def _engage(self) -> None:
        conf1, conf2 = self._conf1, self._conf2
        if conf1 is None:
            _log.error("Controller does not have a valid configuration")
            self._status = "ไม่มีค่าของวิทยุใน \"1. Device\" ที่ใช้ได้ จึง Engage ไม่ได้"
            return
        self.engaged = True
        self._status = None
        self._dev1 = _Device(conf1, HamlibClient(conf1.host, conf1.port, LABEL), primary=True)
        self._dev2 = None if conf2 is None else _Device(conf2, HamlibClient(conf2.host, conf2.port, LABEL), primary=False)
        if self._timer:
            self._wake.clear()
            self._restart = False
            self._task = asyncio.create_task(self._run(), name=f"rig:{self.module}")

    async def _disengage(self) -> None:
        """Engage off (ref-R §3.1): รอรอบที่ค้างอยู่ให้จบ แล้วปิดอุปกรณ์"""
        self.engaged = False
        self._wake.set()
        await self._settle()
        async with self._busy:
            await self._close_devices()

    async def _settle(self) -> None:
        """รอ timer task และรอบที่ยังทำอยู่ของ session ก่อน (เช่นกำลัง disengage เองจาก error)"""
        task, self._task = self._task, None
        if task is not None:
            await task
        async with self._busy:
            pass

    async def close(self) -> None:
        """หน้าต่างปิด (ref-R §3.1 "Window closed"): disengage ถ้า Engage อยู่ แล้วเก็บ Cycle ลงไฟล์ของอุปกรณ์ 1
        เก็บไม่ได้แค่ log การปิดไม่ล้มเพราะเรื่องนี้ เรียกซ้ำได้ (ครั้งหลังไม่ทำอะไร)"""
        async with self._acting:
            if self._closed:
                return
            self._closed = True
            if self.engaged:
                await self._disengage()
            else:
                await self._settle()
            self._save_cycle()

    def _save_cycle(self) -> None:
        conf = self._conf1
        if conf is None:
            return
        try:
            self._hw.save_radio_cycle(conf.name, self._cycle_ms)
        except (ApiError, OSError) as exc:
            _log.error("บันทึก Cycle ของวิทยุ %s ไม่ได้ (%s)", conf.name, exc)        # (ของเรา)

    async def _run(self) -> None:
        """timer ของ Cycle: รอบแรกทันทีที่ Engage แล้วที่จังหวะ epoch + k·Cycle (decision 11)"""
        loop = asyncio.get_running_loop()
        self._epoch, self._k = loop.time(), 0
        try:
            while self.engaged:
                await self.run_cycle()
                self._k += 1
                await self._wait_next(loop)
        except Exception:                                        # (ของเรา) ข้อผิดพลาดที่ไม่คาด: ปิดอุปกรณ์ ไม่ทิ้ง socket ค้าง
            _log.exception("Radio controller of %s stopped", self.module)
            self.engaged = False
            async with self._busy:
                await self._close_devices()

    async def _wait_next(self, loop: asyncio.AbstractEventLoop) -> None:
        """รอถึงจังหวะ k ถัดไป จังหวะที่ผ่านไปแล้วถูกข้าม (log ทีละจังหวะ) Cycle ที่เปลี่ยนเริ่มนับใหม่จากตอนนี้ disengage ปลุกทันที"""
        while self.engaged:
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
                return

    # ---------------------------------------------------------------- หนึ่งรอบ (ref-R §3.1 "Each cycle")

    async def run_cycle(self) -> None:
        """หนึ่งรอบของ cycle ไม่ทำอะไรเมื่อไม่ได้ Engage"""
        async with self._busy:
            if not self.engaged:
                return
            self._cycle_dd, self._cycle_du = self._dd, self._du
            devices = [d for d in (self._dev1, self._dev2) if d is not None]
            for dev in devices:
                dev.down = False
            for dev in devices:
                await self._open(dev)
            await self._check_aos_los(devices)
            for dev in devices:                                  # signalling ที่ไม่ได้คำตอบปิดการเชื่อมต่อ: ต่อใหม่
                await self._open(dev)
            if self._dev2 is not None:
                await self._dual_cycle(self._dev1, self._dev2)
            else:
                await self._type_cycle(self._dev1)
            if self._errcnt >= MAX_ERROR_COUNT:
                await self._auto_disengage()

    async def _open(self, dev: _Device) -> None:
        """ต่ออุปกรณ์ที่ยังไม่ได้ต่อ ตรวจ VFO option (ref-R §4.2) และตั้ง split ของอุปกรณ์ 1 เมื่อไม่มีอุปกรณ์ 2 (ref-R §3.4)"""
        if dev.down or dev.client.connected:
            return
        conf = dev.conf
        try:
            await dev.client.connect()
        except HamlibError as exc:
            _log.error("Failed to connect to %s:%d", conf.host, conf.port)
            self._fail(dev, exc)
            return
        _log.debug("Connection opened to %s:%d", conf.host, conf.port)
        await self._cmd(dev, CMD_SET_VFO_OPT)                    # คำตอบไม่ใช้
        reply = await self._cmd(dev, CMD_CHK_VFO)
        dev.vfo_opt = bool(reply) and not is_error(reply) and reply[0].startswith("1")
        _log.debug("VFO opt=%d" if dev.primary else "VFO opt2=%d", dev.vfo_opt)
        if dev.primary and self._dev2 is None:
            if conf.type == FULL_DUPLEX:
                await self._set(dev, cmd_duplex_split(conf.vfo_up, dev.vfo_opt))
            elif conf.type in _FT817:
                await self._set(dev, cmd_ft817_split(True, dev.vfo_opt))
                self._last_toggle = None

    async def _check_aos_los(self, devices: list[_Device]) -> None:
        """ref-R §3.7: เฉพาะ Engage และ Track ส่งตามธงของแต่ละอุปกรณ์ el ของรอบก่อนจำทุกรอบ"""
        el, prev = self._target_el, self._prev_el
        if el is None:
            return
        signals: tuple = ()
        if self.engaged and self._track and prev is not None:
            if prev < 0.0 <= el:
                signals = ((CMD_AOS, "signal_aos"), (CMD_AOIQ, "signal_aoiq"))
            elif prev >= 0.0 > el:
                signals = ((CMD_LOS, "signal_los"), (CMD_LOIQ, "signal_loiq"))
        for cmd, flag in signals:
            for dev in devices:
                if getattr(dev.conf, flag):
                    await self._signal(dev, cmd)
        self._prev_el = el

    async def _type_cycle(self, dev: _Device) -> None:
        kind = dev.conf.type
        if kind == RX_ONLY:
            await self._rx_cycle(dev)
        elif kind == TX_ONLY:
            await self._tx_cycle(dev)
        elif kind == HALF_DUPLEX:
            await self._rx_cycle(dev)
            await self._tx_cycle(dev)
        elif kind == FULL_DUPLEX:
            await self._rx_cycle(dev)
            await self._duplex_tx_cycle(dev)
        elif kind in _FT817:
            await self._toggle_cycle(dev)
        else:
            _log.error("Invalid radio type %d. Setting type to RIG_TYPE_RX", kind)
            dev.conf = dataclasses.replace(dev.conf, type=RX_ONLY)
            await self._rx_cycle(dev)

    async def _rx_cycle(self, dev: _Device) -> None:
        """RX cycle: PTT ปิดเท่านั้นที่อ่าน dial และส่ง downlink ส่งสำเร็จหลัง PTT เปลี่ยน ล้างค่าส่งล่าสุดของ uplink"""
        conf = dev.conf
        ptt = False
        if self.engaged and conf.ptt:
            ptt = await self._get_ptt(dev)
        if not ptt and await self._dial(dev, True, conf.lo):
            return
        self._forward_down(conf.lo)
        self._forward_up(conf.lo_up)
        if not ptt and await self._send(dev, True) and self._last_rx_ptt != ptt:
            self._last_tx = 0.0
        self._last_rx_ptt = ptt

    async def _tx_cycle(self, dev: _Device) -> None:
        """TX cycle: ภาพกลับของ RX ทำงานเมื่อ PTT เปิด (PTT "None" ถือว่าเปิดเสมอ)"""
        conf = dev.conf
        ptt = True
        if self.engaged and conf.ptt:
            ptt = await self._get_ptt(dev)
        if ptt and await self._dial(dev, False, conf.lo_up):
            return
        self._forward_down(conf.lo)
        self._forward_up(conf.lo_up)
        if ptt and await self._send(dev, False) and self._last_tx_ptt != ptt:
            self._last_rx = 0.0
        self._last_tx_ptt = ptt

    async def _duplex_tx_cycle(self, dev: _Device) -> None:
        """TX ของ Full-duplex: split (i/I) ไม่สน PTT"""
        conf = dev.conf
        if await self._dial(dev, False, conf.lo_up, split=True):
            return
        self._forward_down(conf.lo)
        self._forward_up(conf.lo_up)
        await self._send(dev, False, split=True)

    async def _toggle_cycle(self, dev: _Device) -> None:
        """FT817: RX cycle แล้ว (auto) อัปเดต TX รอบแรกและทุก FT817_TX_PERIOD_S"""
        await self._rx_cycle(dev)
        if dev.conf.type == FT817_AUTO:
            now = _clock()
            if self._last_toggle is None or now - self._last_toggle >= FT817_TX_PERIOD_S:
                await self._toggle_tx_cycle(dev)
                self._last_toggle = now

    async def _toggle_tx_cycle(self, dev: _Device) -> None:
        """ตั้ง TX ของ FT817 ด้วย I เมื่อ PTT ปิดและต่างจากที่ส่งล่าสุด ≥ 10 Hz จำค่าแม้ส่งไม่สำเร็จ ไม่อ่านกลับ"""
        ptt = True
        if self.engaged and dev.conf.ptt:
            ptt = await self._get_ptt(dev)
        if ptt:
            return
        value = self._up_radio
        if self.engaged and abs(self._last_tx - value) >= FT817_TX_THRESHOLD_HZ:
            if await self._set(dev, cmd_set_split_freq(value, dev.vfo_opt)):
                self._ok()
            else:
                self._count_error(dev)
            self._last_tx = value

    async def _dual_cycle(self, d1: _Device, d2: _Device) -> None:
        """dual-rig (ref-R §3.4): อุปกรณ์ 1 downlink อุปกรณ์ 2 uplink (LO_UP ของอุปกรณ์ 2) ไม่สนชนิดและ PTT ของทั้งสอง"""
        lo, lo_up = d1.conf.lo, d2.conf.lo_up
        if await self._dial(d1, True, lo):
            self._forward_up(lo_up)
            await self._send(d2, False)
            return
        self._forward_down(lo)
        await self._send(d1, True)
        if await self._dial(d2, False, lo_up):
            self._forward_down(lo)
            await self._send(d1, True)
        else:
            self._forward_up(lo_up)
            await self._send(d2, False)

    # ---------------------------------------------------------------- ส่วนย่อยของ cycle

    def _forward_down(self, lo: float) -> None:
        self._down_radio = _knob(self._down_radio, radio_freq(self._down_sat, self._cycle_dd, lo, self._track))

    def _forward_up(self, lo_up: float) -> None:
        self._up_radio = _knob(self._up_radio, radio_freq(self._up_sat, self._cycle_du, lo_up, self._track))

    async def _dial(self, dev: _Device, down: bool, lo: float, split: bool = False) -> bool:
        """dial feedback (ref-R §3.5): อ่านความถี่ ต่างจากที่ส่งล่าสุด ≥ 1 Hz คือผู้ใช้หมุนวิทยุ ปุ่มหมุนวิทยุแสดงค่าที่อ่าน
        ปุ่มหมุนดาวคำนวณย้อน Lock เปิดอยู่อีกทางตาม คืน True (รอบนั้นไม่ส่งทางนี้) อ่านไม่ได้นับ error"""
        last = self._last_rx if down else self._last_tx
        if not (self.engaged and last > 0.0):
            return False
        read = await self._read(dev, split)
        if read is None:
            self._count_error(dev)
            return False
        if abs(read - last) < FREQ_THRESHOLD_HZ:
            return False
        if down:
            self._down_radio, self._last_rx = _knob(self._down_radio, read), read
            self._down_sat = _knob(self._down_sat, sat_from_radio(read, self._cycle_dd, lo, self._track))
            if self._lock:
                self._track_downlink()
        else:
            self._up_radio, self._last_tx = _knob(self._up_radio, read), read
            self._up_sat = _knob(self._up_sat, sat_from_radio(read, self._cycle_du, lo, self._track))
            if self._lock:
                self._track_uplink()
        return True

    async def _send(self, dev: _Device, down: bool, split: bool = False) -> bool:
        """ส่งความถี่ของปุ่มหมุนวิทยุเมื่อต่างจากที่ส่งล่าสุด ≥ 1 Hz รอ READBACK_DELAY_S แล้วอ่านกลับเป็นค่าเทียบ
        (อ่านไม่ได้ใช้ค่าที่ส่ง) คืน True เมื่อตั้งสำเร็จ"""
        value = self._down_radio if down else self._up_radio
        last = self._last_rx if down else self._last_tx
        if not (self.engaged and abs(last - value) >= FREQ_THRESHOLD_HZ):
            return False
        if not await self._set(dev, (cmd_set_split_freq if split else cmd_set_freq)(value, dev.vfo_opt)):
            self._count_error(dev)
            return False
        self._ok()
        await asyncio.sleep(READBACK_DELAY_S)
        read = await self._read(dev, split)
        if down:
            self._last_rx = value if read is None else read
        else:
            self._last_tx = value if read is None else read
        return True

    async def _ptt_toggle(self) -> None:
        """ปุ่ม SPACE (ref-R §3.6) เฉพาะ "FT817/857/897 (manual)": PTT ปิด → ตั้ง TX แล้ว T 1, เปิด → T 0 (ไม่มี q, spec §9.1 ข้อ 5)"""
        _log.info("Detected SPACEBAR pressed event")
        if self._conf1 is None or self._conf1.type != FT817_MANUAL:
            return
        for _ in range(PTT_LOCK_TRIES):
            if not self._busy.locked():
                break
            await asyncio.sleep(PTT_LOCK_POLL_S)
        else:
            _log.error("Failed to acquire controller lock; PTT event not handled")
            return
        async with self._busy:
            if not self.engaged:
                _log.info("Controller not engaged; PTT event ignored (Hint: Enable the Engage button)")
                return
            dev = self._dev1
            dev.down = False
            if not await self._get_ptt(dev):
                _log.debug("PTT is OFF => Set TX freq and PTT=ON")
                await self._toggle_tx_cycle(dev)
                await self._set(dev, cmd_set_ptt(True, dev.vfo_opt))
            else:
                _log.debug("PTT is ON = Set PTT=OFF")
                await self._set(dev, cmd_set_ptt(False, dev.vfo_opt))

    # ---------------------------------------------------------------- คำสั่งและ error

    async def _cmd(self, dev: _Device, cmd: str | bytes) -> list[str] | None:
        """หนึ่งคำสั่ง คืนคำตอบ หรือ None เมื่อการเชื่อมต่อล้ม (หรือล้มไปแล้วในรอบนี้)"""
        if dev.down:
            return None
        _log.debug('sending %d bytes to rigctld as "%s"', len(cmd), _shown(cmd))
        try:
            reply = await dev.client.command(cmd)
        except HamlibError as exc:
            _log.error("%s", exc)                                # (ของเรา) ข้อความไทยของ hamlib.py
            self._fail(dev, exc)
            return None
        _log.debug("Read %d bytes from rigctld", sum(len(line) + 1 for line in reply))
        return reply

    async def _set(self, dev: _Device, cmd: str) -> bool:
        """คำสั่งตั้งค่า: สำเร็จเมื่อตอบ RPRT 0"""
        reply = await self._cmd(dev, cmd)
        if reply is None:
            return False
        if is_ok(reply):
            return True
        self._rejected(dev, cmd, reply)
        return False

    async def _read(self, dev: _Device, split: bool) -> float | None:
        """f หรือ i: ความถี่ หรือ None เมื่อล้ม (ตอบ RPRT หรือไม่ใช่ตัวเลข)"""
        cmd = (cmd_get_split_freq if split else cmd_get_freq)(dev.vfo_opt)
        reply = await self._cmd(dev, cmd)
        if reply is None:
            return None
        value = parse_freq(reply)
        if value is None:
            self._rejected(dev, cmd, reply)
        return value

    async def _get_ptt(self, dev: _Device) -> bool:
        """PTT (ref-R §3.6): "Read PTT" อ่านด้วย t ค่าอื่นอ่าน DCD (get_ptt ของ Gpredict) อ่านไม่ได้ถือว่าปิด"""
        cmd = cmd_get_ptt(dev.vfo_opt) if dev.conf.ptt == PTT_CAT else CMD_GET_DCD
        return parse_flag(await self._cmd(dev, cmd) or [])

    async def _signal(self, dev: _Device, cmd: str) -> None:
        """AOS/LOS/IQRECORD: อ่านคำตอบหนึ่งบรรทัดไม่ตรวจ ล้มไม่นับ error (ref-R §3.7, decision 12)"""
        if dev.down or not dev.client.connected:
            return
        _log.debug('sending %d bytes to rigctld as "%s"', len(cmd), _shown(cmd))
        try:
            await dev.client.command(cmd)
        except HamlibError as exc:
            _log.debug("%s", exc)

    def _rejected(self, dev: _Device, cmd: str, reply: list[str]) -> None:
        answer = reply[0] if reply else ""
        _log.error("%s rigctld returned error (%s)", _shown(cmd), answer)
        self._status = f"{LABEL} {dev.conf.host}:{dev.conf.port} ตอบ \"{answer}\" ต่อคำสั่ง \"{_shown(cmd)}\""

    def _fail(self, dev: _Device, exc: HamlibError) -> None:
        """การเชื่อมต่อล้ม: นับ error หนึ่งครั้ง คำสั่งที่เหลือของอุปกรณ์นี้ในรอบนี้ไม่ถูกส่ง"""
        dev.down = True
        self._errcnt += 1
        self._status = str(exc)

    def _count_error(self, dev: _Device) -> None:
        """การตั้ง/อ่านความถี่ล้ม (อุปกรณ์ที่การเชื่อมต่อล้มในรอบนี้นับไปแล้ว)"""
        if not dev.down:
            self._errcnt += 1

    def _ok(self) -> None:
        self._errcnt = 0
        self._status = None

    async def _auto_disengage(self) -> None:
        """error ครบ MAX_ERROR_COUNT: ปิดอุปกรณ์เองแล้วปล่อยปุ่ม Engage ไม่ผ่านทาง disengage ของผู้ใช้ (ref-R §3.1)"""
        _log.error("MAX_ERROR_COUNT (%d) reached. Disengaging device!", MAX_ERROR_COUNT)
        reason = self._status
        self.engaged = False
        self._errcnt = 0
        self._wake.set()
        await self._close_devices()
        self._status = f"ปลด Engage เองเพราะผิดพลาดครบ {MAX_ERROR_COUNT} ครั้ง" + (f": {reason}" if reason else "")

    async def _close_devices(self) -> None:
        """rigctrl_close: ล้างค่าที่จำ ปิด split ของ FT817 แล้วปิดอุปกรณ์ 2 ก่อนอุปกรณ์ 1 (ส่ง q ถ้ายังต่ออยู่)"""
        self._last_rx_ptt, self._last_tx_ptt = False, True
        self._last_rx = self._last_tx = 0.0
        dev1, dev2, self._dev1, self._dev2 = self._dev1, self._dev2, None, None
        # Gpredict ปิด split ทุกครั้งที่อุปกรณ์ 1 เป็น FT817 แม้มีอุปกรณ์ 2 (ตอนนั้นไม่ได้เปิด split ตอน Engage)
        if dev1 is not None and dev1.conf.type in _FT817 and dev1.client.connected:
            cmd = cmd_ft817_split(False, dev1.vfo_opt)
            try:
                reply = await dev1.client.command(cmd)
            except HamlibError as exc:
                _log.error("%s", exc)
            else:
                if not is_ok(reply):
                    _log.error("%s rigctld returned error (%s)", _shown(cmd), reply[0] if reply else "")
        for dev in (dev2, dev1):
            if dev is not None:
                await dev.client.close()
