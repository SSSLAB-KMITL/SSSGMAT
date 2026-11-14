"""คำขอ pass ของ POST /api/modules/{name}/passes และ Sky at a glance ของ GET /api/modules/{name}/skyglance
(spec §3.2, §4, §7 และ §9 ของงานย่อย 2)

คำขอ pass แบ่งเป็นสองขั้นรอบการรอ GMAT ที่ route ทำ (route ถือ owner pass:<uuid4> ของ EphemManager และปล่อยใน finally)
- plan: ตรวจ body, หาดาวใน module, เลือกเวลาเริ่ม (Always use real time) และช่วงวันของ block รายวันที่ต้องใช้
  ดาวที่ has_aos เป็นเท็จได้คำตอบข้อความทันทีโดยไม่สั่ง GMAT (ref-P §1.4: ตรวจก่อนทำนายเสมอ)
- answer: หลัง days_status เป็น ok ต่อ block → find_passes → get_pass/get_passes ตามค่า Preferences ณ ตอนนั้น → describe

Sky at a glance ไม่รอ GMAT: sky() สั่ง block รายวันของทุกดาวใน module ภายใต้ owner sky:<module> (ถือไว้จนหน้าต่างปิด
หรือ module ปิด หน้าเว็บถามซ้ำระหว่าง computing) แล้วตอบ status ทันที เมื่อ ok จึงหา pass ของทุกดวง

current_pass: pass ของ Antenna Control (owner rot:<module>) ไม่รอ GMAT แบบเดียวกับ Sky at a glance (งานย่อย 3)

find_passes ของทุกทางผ่าน PassMemo: วาดใหม่หรือขอซ้ำในช่วงวันเดิมใช้ pass ที่หาไว้แล้ว **(ของเรา)**
"""

import threading
import unicodedata
from collections import OrderedDict
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

from gnss_predict.errors import Message

from .clock import parse_clock_time
from .config import PASS_MEMO_SIZE, STEP_S
from .ephem import HALF_WINDOW, EphemManager, SatEphem, SatSpec, tle_key
from .errors import ApiError
from .observe import QthGeo, TleElements, qth_geo
from .pass_predict import NEXT_PASS_OFFSET, PassData, describe, get_pass, get_passes, has_aos, pass_to_dict
from .passes import Pass, elevation_at, find_passes, pass_containing
from .prefs import Prefs
from .runtime import COMPUTING_TEXT, Hub, ModuleClosedError, iso_ms, sky_owner
from .store import Qth

KINDS = ("next", "current", "future", "at")
AT_TOLERANCE = timedelta(seconds=1)              # kind "at": pass ที่ |AOS − aos| ไม่เกินค่านี้ (ของเรา)
DATA_PAD = timedelta(days=1)                     # ข้อมูลเริ่มก่อนเวลาเริ่ม 1 วันให้ pass ที่กำลังผ่านมี AOS (spec §3.2)
# kind "at" ที่ส่ง los: วันของ AOS ถึงวันของ LOS (spec §3.2) แต่ค่าที่ interpolate ได้เริ่มหลังต้นช่วงและจบก่อนท้ายช่วง
# HALF_WINDOW epoch (passes.usable_span) AOS/LOS ที่ห่างเที่ยงคืนไม่ถึงค่านี้จึงใช้วันข้างเคียงด้วย (ของเรา)
AT_EDGE = timedelta(seconds=(HALF_WINDOW + 1) * STEP_S) + AT_TOLERANCE
SKY_PASSES = 10                                  # pass ต่อดาวใน Sky at a glance (ref-P §7.2 ไม่ใช้ Number of passes to predict)
SKY_COLOUR_KEYS = tuple(f"SKY_AT_GLANCE/COLOUR_{i:02d}" for i in range(1, 11))
ROT_PASS_DAYS = 3                                # current_pass: pass ของ Antenna Control ภายในกี่วัน (ref-R §6.5)
_UTC = timezone.utc
_MISSING = "SAT_MISSING_FROM_GMAT"

# ข้อความของ Gpredict (ref-P §1.4) ห้ามแก้แม้แต่ตัวอักษร: %s = ชื่อดาว, %d = Passes should occur within
NO_AOS_LONG = ("Satellite %s has no passes for\nthe current ground station!\n\n"
               "This can be because the satellite\nis geostationary, decayed or simply\nnever comes above the horizon")
NO_AOS_SHORT = "Satellite %s has no passes for\nthe current ground station!"
NONE_WITHIN = "Satellite %s has no passes\nwithin the next %d days"


def day_range(start: datetime, end: datetime) -> tuple[date, date]:
    """(วัน UTC ของ start − 1 วัน, วัน UTC ของ end): block รายวันที่ครอบ pass ที่กำลังผ่านที่ start ถึง end"""
    return (start - DATA_PAD).astimezone(_UTC).date(), end.astimezone(_UTC).date()


@dataclass(frozen=True)
class PassPlan:
    """คำขอ pass ที่ตรวจแล้ว t คือเวลาเริ่มที่ใช้จริง (เวลาเครื่องเมื่อเปิด Always use real time) aos มีเฉพาะ kind "at"
    first..last คือวันของ block ที่ต้องใช้ look_ahead คือ Passes should occur within (วัน) ที่ใช้กำหนด first..last
    answer ใช้ค่านี้ ไม่อ่านใหม่ ผลจึงไม่ถูกตัดเงียบๆ เมื่อค่าเปลี่ยนระหว่างรอ GMAT
    real_t0: เปิด Always use real time ตอน plan (Show next pass จึงไม่ข้าม pass ปัจจุบัน)"""
    module: str
    norad: int
    name: str
    spec: SatSpec
    elements: TleElements
    qth: Qth
    kind: str
    t: datetime
    aos: datetime | None
    first: date
    last: date
    look_ahead: int
    real_t0: bool = False


# ---------------------------------------------------------------- ลำดับชื่อดาว

_PUNCT_ORDER = " _-,;:!?.'\"()[]{}@*/\\&#%`^+<=>|~$"       # เครื่องหมายของ ASCII ตามลำดับของ Intl.Collator("en")
_PUNCT, _OTHER, _DIGITS, _LETTER = range(4)               # กลุ่มของตัวอักษร: เครื่องหมาย < อื่นๆ ที่ไม่ใช่ตัวอักษรหรือเลข < เลข < ตัวอักษร


def name_sort_key(name: str) -> tuple:
    """key เรียงชื่อดาวให้ได้ลำดับเดียวกับ compareNames ของ web (views/cells.ts) คือ Intl.Collator("en") แบบ numeric และ
    sensitivity "base": ไม่สนตัวพิมพ์เล็กใหญ่และเครื่องหมายกำกับเสียง เลขที่ติดกันเทียบกันตามค่า (0 นำหน้าไม่มีผล)
    ช่องว่างและเครื่องหมาย < เลข < ตัวอักษร ชื่อที่เท่ากันได้ key เท่ากัน (ผู้เรียกเสริมด้วย NORAD เมื่อต้องการลำดับตายตัว)
    ตรงกับ collator ทุกคู่สำหรับ ASCII และตัวอักษรละตินที่ NFKD แยกเครื่องหมายกำกับได้ (ตรวจกับ node ด้วยคู่สุ่ม 240,000 คู่)
    ตัวอักษรนอกชุดนั้น (เช่น ø, ł, ภาษาอื่น) เรียงตามรหัส Unicode ซึ่งอาจต่างจาก ICU **(ของเรา)**"""
    key: list[tuple[int, int]] = []
    digits, in_number = 0, False                          # ค่าของเลขที่กำลังอ่านอยู่ และอยู่กลางเลขหรือไม่
    for ch in unicodedata.normalize("NFKD", name.casefold()):
        if ch.isdecimal():
            digits, in_number = digits * 10 + unicodedata.decimal(ch), True
            continue
        if in_number:
            key.append((_DIGITS, digits))
            digits, in_number = 0, False
        category = unicodedata.category(ch)
        if category in ("Mn", "Cc", "Cf"):               # เครื่องหมายกำกับเสียงและอักขระควบคุมไม่มีผลกับลำดับ
            continue
        if ch.isalpha():
            key.append((_LETTER, ord(ch)))
        elif ch in _PUNCT_ORDER:
            key.append((_PUNCT, _PUNCT_ORDER.index(ch)))
        else:
            key.append((_OTHER, ord(ch)))
    if in_number:
        key.append((_DIGITS, digits))
    return tuple(key)


# ---------------------------------------------------------------- body

def _invalid(field: str, text: str) -> ApiError:
    return ApiError("PASS_INVALID", 422, text, field)


def _parse_time(value, field: str, what: str) -> datetime:
    """เวลาในช่วงเดียวกับนาฬิกาของ module (clock.parse_clock_time) ผิด -> 422 PASS_INVALID"""
    try:
        return parse_clock_time(value)
    except ValueError as exc:
        raise _invalid(field, f"{what} ({field}) ต้องเป็น {exc}") from None


def parse_body(body: dict) -> tuple[int, str, datetime, datetime | None, datetime | None]:
    """(norad, kind, t, aos, los) จาก body ของคำขอ ผิดตัวแรกที่เจอ -> 422 PASS_INVALID ที่ object เป็นชื่อช่อง
    aos และ los ใช้เฉพาะ kind "at" (kind อื่นไม่อ่าน) aos ต้องมี los ไม่บังคับ (ไม่ส่งหรือ null = None)
    los ต้องไม่ก่อน aos และไม่หลัง aos เกิน DATA_PAD (kind "at" ที่ไม่ส่ง los ก็หาได้แค่ pass ที่ยาวราวนี้)"""
    norad = body.get("norad")
    if isinstance(norad, bool) or not isinstance(norad, int):
        raise _invalid("norad", "เลข NORAD ของดาว (norad) ต้องเป็นจำนวนเต็ม")
    kind = body.get("kind")
    if not isinstance(kind, str) or kind not in KINDS:
        raise _invalid("kind", "ชนิดคำขอ (kind) ต้องเป็น next, current, future หรือ at")
    t = _parse_time(body.get("t"), "t", "เวลาเริ่ม")
    if kind != "at":
        return norad, kind, t, None, None
    aos = _parse_time(body.get("aos"), "aos", "AOS ของ pass ที่ต้องการ")
    if body.get("los") is None:
        return norad, kind, t, aos, None
    los = _parse_time(body.get("los"), "los", "LOS ของ pass ที่ต้องการ")
    if not aos <= los <= aos + DATA_PAD:
        raise _invalid("los", "LOS ของ pass ที่ต้องการ (los) ต้องไม่ก่อน AOS (aos) และไม่หลัง AOS เกิน 1 วัน")
    return norad, kind, t, aos, los


def parse_sky_t(value: str | None) -> datetime | None:
    """t ของ GET skyglance: ไม่ส่ง -> None (ใช้เวลาของ module) ผิด -> 422 PASS_INVALID ที่ object เป็น t"""
    return None if value is None else _parse_time(value, "t", "เวลาเริ่ม")


# ---------------------------------------------------------------- คำตอบ

def _sat_dict(norad: int, name: str) -> dict:
    return {"norad": norad, "name": name}


def _qth_dict(q: Qth) -> dict:
    return {"name": q.name, "location": q.location, "lat_deg": q.lat_deg, "lon_deg": q.lon_deg, "alt_m": q.alt_m}


def _message(code: str, level: str, text: str) -> dict:
    return {"code": code, "level": level, "text": text}


def gmat_failed(plan: PassPlan, messages: Sequence[Message]) -> ApiError:
    """503 GMAT_FAILED เมื่อ days_status เป็น failed (รายละเอียดจากข้อความ error ของ EphemManager ถ้ามี)"""
    failure = next((m for m in messages if m.level == "error"), None)
    detail = f": {failure.text}" if failure is not None else ""
    return ApiError("GMAT_FAILED", 503,
                    f"หา pass ของ {plan.name} (NORAD {plan.norad}) ไม่ได้เพราะคำนวณวงโคจรด้วย GMAT ไม่สำเร็จ{detail}",
                    str(plan.norad))


def _data_missing(plan: PassPlan, messages: Sequence[Message]) -> ApiError:
    """days_status เป็น ok แต่ไม่มีตำแหน่งของดาวที่ต้องใช้: GMAT ตัดดาวทิ้ง (ข้อความ SAT_MISSING_FROM_GMAT ของดาวนี้)
    หรือ block หาย (เขียนลงดิสก์ไม่ได้และหลุดจาก LRU ของหน่วยความจำ) ทั้งสองแบบตอบ 503"""
    dropped = next((m for m in messages if m.code == _MISSING and m.object == plan.spec.prn), None)
    if dropped is not None:
        return ApiError(_MISSING, 503, f"หา pass ของ {plan.name} (NORAD {plan.norad}) ไม่ได้: {dropped.text}",
                        str(plan.norad))
    return ApiError("GMAT_FAILED", 503,
                    f"หา pass ของ {plan.name} (NORAD {plan.norad}) ไม่ได้เพราะไม่มีตำแหน่งของดาวจาก GMAT ในช่วงที่ต้องใช้ "
                    "ลองใหม่อีกครั้ง", str(plan.norad))


# ---------------------------------------------------------------- pass ที่หาไว้แล้ว

class PassMemo:
    """**(ของเรา)** ผลของ find_passes ต่อ (TLE, วันแรก, วันสุดท้าย, ตำแหน่งสถานี) จำไว้แบบ LRU ไม่เกิน size รายการ
    block รายวันของ TLE หนึ่งไม่เปลี่ยน ข้อมูลของช่วงวันเดียวกันจึงให้ pass ชุดเดิมเสมอ Sky at a glance ที่วาดใหม่ในช่วงวันเดิม
    จึงไม่หา pass ของทุกดวงใหม่ (find_passes ราว 40–65 ms ต่อดวงต่อ 3 วัน) ใช้จากหลาย thread พร้อมกันได้"""

    def __init__(self, size: int = PASS_MEMO_SIZE):
        self._size = size
        self._lock = threading.Lock()
        self._found: OrderedDict[tuple, tuple[Pass, ...]] = OrderedDict()

    def passes(self, spec: SatSpec, first: date, last: date, q: QthGeo, eph: SatEphem) -> tuple[Pass, ...]:
        """pass ของ eph ซึ่งต้องเป็น get_days(spec, first, last) ที่สถานี q: ที่จำไว้ หรือ find_passes แล้วจำไว้"""
        found = self.cached(spec, first, last, q)
        if found is not None:
            return found
        key = self._key(spec, first, last, q)
        found = tuple(find_passes(eph, q))                     # นอก lock: thread อื่นไม่ต้องรอ (หาซ้ำพร้อมกันได้ผลเท่ากัน)
        with self._lock:
            self._found[key] = found
            self._found.move_to_end(key)
            while len(self._found) > self._size:
                self._found.popitem(last=False)
        return found

    def cached(self, spec: SatSpec, first: date, last: date, q: QthGeo) -> tuple[Pass, ...] | None:
        """pass ที่จำไว้แล้วของ (TLE, วัน, สถานี) None ถ้ายังไม่เคยหา (ไม่ต้องมีตำแหน่งของดาว ผู้เรียกจึงไม่ต้องต่อ block)"""
        key = self._key(spec, first, last, q)
        with self._lock:
            found = self._found.get(key)
            if found is not None:
                self._found.move_to_end(key)
            return found

    @staticmethod
    def _key(spec: SatSpec, first: date, last: date, q: QthGeo) -> tuple:
        return tle_key(spec.tle_lines), first, last, q.lat_deg, q.lon_deg, q.alt_m


# ---------------------------------------------------------------- service

class PassService:
    """คำขอ pass ของทุก module ใช้ Hub, EphemManager และ Prefs ร่วมกับส่วนอื่น สถานะของตัวเองมีแค่ PassMemo"""

    def __init__(self, hub: Hub, ephem: EphemManager, prefs: Prefs, now: Callable[[], datetime]):
        self._hub = hub
        self._ephem = ephem
        self._prefs = prefs
        self._now = now
        self._memo = PassMemo()

    def plan(self, module: str, body: dict) -> PassPlan | dict:
        """ตรวจ body (422 PASS_INVALID) → หา module (ไม่ได้เปิด: ModuleClosedError) → หาดาว (404 NOT_FOUND)
        → has_aos เป็นเท็จ: คืน dict คำตอบ PASS_NO_AOS ทันที (kind "at": 404 เพราะไม่มี pass ที่ AOS นั้นแน่นอน)
        นอกนั้นคืน PassPlan ที่มีช่วงวันตาม spec §3.2: kind "at" ที่ส่ง los ใช้วันของ AOS ถึงวันของ LOS (ขยายด้วย AT_EDGE)
        ที่ไม่ส่ง los ใช้วันของ (aos − 1 วัน) ถึงวันของ (aos + 1 วัน) ตาม plan-context ข้อ 5"""
        norad, kind, t, aos, los = parse_body(body)
        rt = self._hub.get(module)
        if rt is None:
            raise ModuleClosedError(f"module {module} ไม่ได้เปิดอยู่")
        found = rt.sat_orbit(norad)
        if found is None:
            raise ApiError("NOT_FOUND", 404, f"ไม่พบดาว NORAD {norad} ใน module {module}", str(norad))
        name, spec, elements = found
        qth = rt.qth
        real_t0 = bool(self._prefs.get("PREDICT/USE_REAL_T0"))
        look_ahead = int(self._prefs.get("PREDICT/LOOK_AHEAD"))
        if real_t0:
            t = self._now().astimezone(_UTC)                    # ref-P §1.3: ไม่ใช้เวลาของ module และกติกาเวลาเริ่ม
        if not has_aos(elements, qth.lat_deg, aos if kind == "at" else t):
            if kind == "at":
                raise self._at_not_found(name, norad, aos)
            text = (NO_AOS_SHORT if kind == "future" else NO_AOS_LONG) % name
            return {"sat": _sat_dict(norad, name), "qth": _qth_dict(qth),
                    "message": _message("PASS_NO_AOS", "error", text)}
        if kind == "at" and los is not None:                     # Sky at a glance: วันของ AOS ถึงวันของ LOS
            first, last = (aos - AT_EDGE).astimezone(_UTC).date(), (los + AT_EDGE).astimezone(_UTC).date()
        elif kind == "at":
            first, last = day_range(aos, aos + DATA_PAD)
        else:
            first, last = day_range(t, t + timedelta(days=look_ahead) + DATA_PAD)
        return PassPlan(module, norad, name, spec, elements, qth, kind, t, aos, first, last, look_ahead, real_t0)

    def answer(self, plan: PassPlan, messages: Sequence[Message] = ()) -> dict:
        """คำตอบของ plan หลัง days_status ของ owner เป็น ok (messages คือข้อความของ days_status นั้น)
        ค่า Preferences อ่าน ณ ตอนนี้ ยกเว้น Passes should occur within ที่ใช้ของ plan (ช่วงข้อมูลกำหนดจากค่านั้น)
        ไม่มีตำแหน่งที่ต้องใช้ -> 503 (_data_missing) kind "at" ที่ไม่เจอ pass -> 404"""
        eph = self._ephem.get_days(plan.spec, plan.first, plan.last)
        if eph is None:
            raise _data_missing(plan, messages)
        q = qth_geo(plan.qth)
        passes = self._memo.passes(plan.spec, plan.first, plan.last, q, eph)
        get = self._prefs.get                                     # อ่านครั้งเดียว: ทุก pass ในคำตอบใช้ค่าชุดเดียวกัน
        min_el, look_ahead = float(get("PREDICT/MINIMUM_ELEV")), plan.look_ahead
        n_entries, resolution_s = int(get("PREDICT/NUMBER_OF_ENTRIES")), int(get("PREDICT/TIME_RESOLUTION"))
        twilight_deg, count = float(get("PREDICT/TWILIGHT_THRESHOLD")), int(get("PREDICT/NUMBER_OF_PASSES"))
        out = {"sat": _sat_dict(plan.norad, plan.name), "qth": _qth_dict(plan.qth)}
        none_within = _message("PASS_NONE_WITHIN", "info", NONE_WITHIN % (plan.name, look_ahead))

        def details(p: Pass) -> dict:
            try:
                data = describe(p, eph, q, plan.elements, n_entries, resolution_s, twilight_deg)
            except ValueError:                                    # ตำแหน่งที่ต้องใช้อยู่นอกข้อมูล
                raise _data_missing(plan, messages) from None
            return pass_to_dict(data)

        if plan.kind == "future":
            found = get_passes(passes, plan.t, look_ahead, count, min_el)
            if not found:
                return {**out, "message": none_within}
            return {**out, "passes": [details(p) for p in found]}
        if plan.kind == "at":
            p = self._pass_at(passes, plan.aos)
            if p is None:
                raise self._at_not_found(plan.name, plan.norad, plan.aos)
            return {**out, "pass": details(p)}
        p = get_pass(passes, self._start(plan, passes, eph, q), look_ahead, min_el)
        if p is None:
            return {**out, "message": none_within}
        return {**out, "pass": details(p)}

    def sky(self, module: str, t: datetime | None) -> dict:
        """Sky at a glance ของ module (spec §7, §9 และ ref-P §7) ไม่รอ GMAT: ตอบ status ของ block รายวันทันที
        {"status": "ok"|"computing"|"failed", "t0", "hours", "sats": [...], "messages": [...]} sats มีเฉพาะเมื่อ ok

        - T0 (ref-P §7.1, §7.7): ไม่ส่ง t = เวลาของ module (วาดใหม่ทุกครั้งเริ่มที่เวลาของ module) ส่ง t มา = t
          ยกเว้นเปิด Always use real time ซึ่งใช้เวลาเครื่อง (หน้าเว็บส่ง t เฉพาะการวาดครั้งแรก)
        - ทุกดาวที่ has_aos ขอใน ensure_days ครั้งเดียวภายใต้ owner sky:<module> วันของ (T0 − 1 วัน) ถึง T0 + 2 × ชั่วโมง
          (get_passes เลื่อนช่วงตาม pass จึงมี pass ที่ AOS ไม่เกิน T0 + 2 × ชั่วโมง spec §3.2) เรียก sky ซ้ำได้ ช่วงใหม่แทนช่วงเก่า
          ปล่อย owner ด้วย DELETE หรือเมื่อ module ปิด (Hub.close) ถ้า GMAT ล้ม (failed) ลองใหม่โดยปล่อยแล้วเรียกอีกครั้ง
        - sats เรียงตามชื่อ (name_sort_key แล้วตาม NORAD) สีของแถวที่ k คือ Satellite (k mod 10)+1 นับรวมดาวที่ไม่มี pass
          ดาวที่ has_aos เป็นเท็จ หรือ GMAT ไม่คืนค่า ได้ passes [] (กรณีหลังมีข้อความใน messages) หน้าเว็บเป็นผู้ตัดสินว่าแสดงแถวไหม
        ModuleClosedError เมื่อ module ไม่ได้เปิด"""
        rt = self._hub.get(module)
        if rt is None:
            raise ModuleClosedError(f"module {module} ไม่ได้เปิดอยู่")
        get = self._prefs.get
        hours = int(get("SKY_AT_GLANCE/TIME_SPAN_HOURS"))
        if t is None:
            t0 = rt.clock.time()
        elif get("PREDICT/USE_REAL_T0"):
            t0 = self._now().astimezone(_UTC)
        else:
            t0 = t
        sats = sorted(rt.sat_orbits(), key=lambda s: (name_sort_key(s[1]), s[0]))
        qth = rt.qth
        rising = [s for s in sats if has_aos(s[3], qth.lat_deg, t0)]
        owner = sky_owner(module)
        first, last = day_range(t0, t0 + timedelta(hours=2 * hours))
        if rising:
            self._ephem.ensure_days(owner, [s[2] for s in rising], first, last)
        else:
            self._ephem.release_days(owner)                       # module ว่างหรือไม่มีดาวที่ขึ้นได้: ไม่มีอะไรให้ GMAT คำนวณ
        status, found = self._ephem.days_status(owner)
        by_prn = {s[2].prn: s[0] for s in rising}
        messages = [Message(m.code, m.level, m.text, str(by_prn[m.object])) if m.code == _MISSING and m.object in by_prn
                    else m for m in found]                        # SAT_MISSING_FROM_GMAT: object เป็น NORAD เหมือน tick
        out = {"status": status, "t0": iso_ms(t0), "hours": hours, "sats": []}
        if status != "ok":
            if status == "computing":
                messages.append(Message("EPHEM_COMPUTING", "info", COMPUTING_TEXT))
            return {**out, "messages": [m.to_dict() for m in messages]}

        q = qth_geo(qth)
        min_el, n_entries = float(get("PREDICT/MINIMUM_ELEV")), int(get("PREDICT/NUMBER_OF_ENTRIES"))
        resolution_s, twilight_deg = int(get("PREDICT/TIME_RESOLUTION")), float(get("PREDICT/TWILIGHT_THRESHOLD"))
        colours = [get(key) for key in SKY_COLOUR_KEYS]
        rising_norads = {s[0] for s in rising}
        dropped = {m.object for m in messages if m.code == _MISSING}
        for k, (norad, name, spec, elements) in enumerate(sats):
            passes: list[dict] = []
            if norad in rising_norads:
                try:
                    eph = self._ephem.get_days(spec, first, last)
                    if eph is None:
                        if str(norad) not in dropped:             # GMAT ไม่ได้ตัดดาวนี้ แต่ block หาย (หลุดจากทั้งดิสก์และ LRU)
                            messages.append(Message(
                                "GMAT_FAILED", "warning", f"ไม่มีตำแหน่งของ {name} (NORAD {norad}) จาก GMAT ในช่วงที่ต้องใช้ "
                                "จึงไม่แสดง pass ใน Sky at a glance ลองปิดแล้วเปิดหน้าต่างใหม่", str(norad)))
                    else:
                        chosen = get_passes(self._memo.passes(spec, first, last, q, eph), t0, hours / 24.0, SKY_PASSES, min_el)
                        passes = [pass_to_dict(describe(p, eph, q, elements, n_entries, resolution_s, twilight_deg),
                                               rows=False) for p in chosen]
                except ValueError as exc:                         # วงโคจรไม่ปิดหรือตำแหน่งที่ต้องใช้อยู่นอกข้อมูล: ข้ามเฉพาะดวงนี้
                    messages.append(Message("SAT_STATE_INVALID", "warning",
                                            f"ข้ามดาว {name} (NORAD {norad}) ใน Sky at a glance: {exc}", str(norad)))
            out["sats"].append({"norad": norad, "name": name, "colour": colours[k % len(colours)], "passes": passes})
        return {**out, "messages": [m.to_dict() for m in messages]}

    def current_pass(self, owner: str, module: str, norad: int, t: datetime) -> tuple[str, PassData | None]:
        """pass ของ Antenna Control (ref-R §6.5, decision 14 ของงานย่อย 3): pass ที่กำลังผ่านที่ t หรือ pass ถัดไปที่ AOS
        ไม่เกิน t + ROT_PASS_DAYS วัน ที่ Max El ≥ 0 (ไม่ใช้ Minimum elevation) ไม่รอ GMAT: คืน (status, pass) ทันที
        ผู้เรียก (RotController) ถามซ้ำระหว่าง "computing" "ok" กับ None คือไม่มี pass ในช่วงนั้น "failed" คือ GMAT ล้ม
        หรือไม่มีตำแหน่งของดาวในช่วงที่ต้องใช้
        - block รายวันของ (t − 1 วัน) ถึง t + ROT_PASS_DAYS + 1 วัน ภายใต้ owner (rot:<module>) คำขอใหม่แทนคำขอเดิม
          ปล่อยด้วย release_current ดาวที่ has_aos เป็นเท็จได้ ("ok", None) ทันทีและปล่อยคำขอเดิมของ owner
        - ดาวที่ไม่มี pass ถูกถามทุก tick ของ module (pass_needs_refresh ข้อ 1): pass ที่หาไว้แล้วอยู่ใน PassMemo จึงไม่ต่อ block
          และไม่หา pass ใหม่ ต่อ block เฉพาะเมื่อต้องหา pass ครั้งแรกหรือต้องสร้างแถวของ pass ที่เจอ (describe)
        ModuleClosedError เมื่อ module ไม่ได้เปิด, ApiError NOT_FOUND เมื่อดาวไม่อยู่ใน module"""
        rt = self._hub.get(module)
        if rt is None:
            raise ModuleClosedError(f"module {module} ไม่ได้เปิดอยู่")
        found = rt.sat_orbit(norad)
        if found is None:
            raise ApiError("NOT_FOUND", 404, f"ไม่พบดาว NORAD {norad} ใน module {module}", str(norad))
        _, spec, elements = found
        qth = rt.qth
        if not has_aos(elements, qth.lat_deg, t):
            self._ephem.release_days(owner)
            return "ok", None
        first, last = day_range(t, t + timedelta(days=ROT_PASS_DAYS) + DATA_PAD)
        self._ephem.ensure_days(owner, [spec], first, last)
        status, _ = self._ephem.days_status(owner)
        if status != "ok":
            return status, None
        q = qth_geo(qth)
        eph = None
        passes = self._memo.cached(spec, first, last, q)
        if passes is None:
            eph = self._ephem.get_days(spec, first, last)
            if eph is None:                                       # GMAT ตัดดาวทิ้ง หรือ block หาย
                return "failed", None
            passes = self._memo.passes(spec, first, last, q, eph)
        p = get_pass(passes, t, ROT_PASS_DAYS, 0.0)
        if p is None:
            return "ok", None
        if eph is None:
            eph = self._ephem.get_days(spec, first, last)
            if eph is None:
                return "failed", None
        get = self._prefs.get                                     # แถวของ pass ตาม Preferences เดียวกับ Pass details
        try:
            return "ok", describe(p, eph, q, elements, int(get("PREDICT/NUMBER_OF_ENTRIES")),
                                  int(get("PREDICT/TIME_RESOLUTION")), float(get("PREDICT/TWILIGHT_THRESHOLD")))
        except ValueError:                                        # ตำแหน่งที่ต้องใช้อยู่นอกข้อมูล
            return "failed", None

    def release_current(self, owner: str) -> None:
        """ปล่อย block รายวันที่ current_pass ขอไว้ให้ owner (Antenna Control ปิด)"""
        self._ephem.release_days(owner)

    # ---------------------------------------------------------------- ตัวช่วย

    @staticmethod
    def _start(plan: PassPlan, passes: Sequence[Pass], eph: SatEphem, q: QthGeo) -> datetime:
        """เวลาเริ่มของ get_pass (spec §4.2): Show next pass ขณะดาวอยู่เหนือขอบฟ้าที่ t (El >= 0) เริ่มที่ LOS ของ pass ปัจจุบัน
        + NEXT_PASS_OFFSET ยกเว้นเปิด Always use real time ส่วน Show current pass และ Future passes เริ่มที่ t
        pass ปัจจุบันที่ LOS อยู่เลยข้อมูล: เริ่มที่ t แล้ว get_pass ตอบว่าไม่มี pass (spec §3.4 ข้อ 4)"""
        if plan.kind != "next" or plan.real_t0:
            return plan.t
        current = pass_containing(passes, plan.t)
        el = elevation_at(eph, q, plan.t)
        if current is not None and current.los is not None and el is not None and el >= 0.0:
            return current.los + NEXT_PASS_OFFSET
        return plan.t

    @staticmethod
    def _pass_at(passes: Sequence[Pass], aos: datetime) -> Pass | None:
        """pass ที่รู้ AOS และ LOS และ AOS ห่างจาก aos ไม่เกิน AT_TOLERANCE (ใกล้สุดถ้ามีหลาย pass)"""
        near = [p for p in passes
                if p.aos is not None and p.los is not None and abs(p.aos - aos) <= AT_TOLERANCE]
        return min(near, key=lambda p: abs(p.aos - aos), default=None)

    @staticmethod
    def _at_not_found(name: str, norad: int, aos: datetime) -> ApiError:
        return ApiError("NOT_FOUND", 404,
                        f"ไม่พบ pass ของ {name} (NORAD {norad}) ที่ AOS {iso_ms(aos)} (คลาดได้ไม่เกิน 1 วินาที)", str(norad))
