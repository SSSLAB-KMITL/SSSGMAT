"""คำขอ pass ของ POST /api/modules/{name}/passes (spec §3.2, §4 และ §9 ของงานย่อย 2)

แบ่งเป็นสองขั้นรอบการรอ GMAT ที่ route ทำ (route ถือ owner pass:<uuid4> ของ EphemManager และปล่อยใน finally)
- plan: ตรวจ body, หาดาวใน module, เลือกเวลาเริ่ม (Always use real time) และช่วงวันของ block รายวันที่ต้องใช้
  ดาวที่ has_aos เป็นเท็จได้คำตอบข้อความทันทีโดยไม่สั่ง GMAT (ref-P §1.4: ตรวจก่อนทำนายเสมอ)
- answer: หลัง days_status เป็น ok ต่อ block → find_passes → get_pass/get_passes ตามค่า Preferences ณ ตอนนั้น → describe
"""

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

from gnss_predict.errors import Message

from .clock import CLOCK_END, CLOCK_MIN
from .ephem import EphemManager, SatEphem, SatSpec
from .errors import ApiError
from .observe import QthGeo, TleElements, qth_geo
from .pass_predict import NEXT_PASS_OFFSET, describe, get_pass, get_passes, has_aos, pass_to_dict
from .passes import Pass, elevation_at, find_passes, pass_containing
from .prefs import Prefs
from .runtime import Hub, ModuleClosedError, iso_ms
from .store import Qth

KINDS = ("next", "current", "future", "at")
AT_TOLERANCE = timedelta(seconds=1)              # kind "at": pass ที่ |AOS − aos| ไม่เกินค่านี้ (ของเรา)
DATA_PAD = timedelta(days=1)                     # ข้อมูลเริ่มก่อนเวลาเริ่ม 1 วันให้ pass ที่กำลังผ่านมี AOS (spec §3.2)
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
    first..last คือวันของ block ที่ต้องใช้ real_t0: เปิด Always use real time ตอน plan (Show next pass จึงไม่ข้าม pass ปัจจุบัน)"""
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
    real_t0: bool = False


# ---------------------------------------------------------------- body

def _invalid(field: str, text: str) -> ApiError:
    return ApiError("PASS_INVALID", 422, text, field)


def _parse_time(value, field: str, what: str) -> datetime:
    text = (f"{what} ({field}) ต้องเป็นเวลา ISO 8601 ที่มี timezone (เช่น 2026-11-12T07:00:00.000Z) "
            f"ระหว่าง {CLOCK_MIN:%Y-%m-%d} ถึง 2100-12-31 UTC")
    if not isinstance(value, str):
        raise _invalid(field, text)
    try:
        t = datetime.fromisoformat(value)
        if t.tzinfo is None or t.utcoffset() is None:
            raise ValueError("ไม่มี timezone")
        t = t.astimezone(_UTC)
    except (ValueError, OverflowError):                   # OverflowError: offset ดันเวลาเลยปี 1 หรือ 9999
        raise _invalid(field, text) from None
    if not CLOCK_MIN <= t < CLOCK_END:
        raise _invalid(field, text)
    return t


def parse_body(body: dict) -> tuple[int, str, datetime, datetime | None]:
    """(norad, kind, t, aos) จาก body ของคำขอ ผิดตัวแรกที่เจอ -> 422 PASS_INVALID ที่ object เป็นชื่อช่อง
    aos ใช้เฉพาะ kind "at" (kind อื่นไม่อ่าน)"""
    norad = body.get("norad")
    if isinstance(norad, bool) or not isinstance(norad, int):
        raise _invalid("norad", "เลข NORAD ของดาว (norad) ต้องเป็นจำนวนเต็ม")
    kind = body.get("kind")
    if not isinstance(kind, str) or kind not in KINDS:
        raise _invalid("kind", "ชนิดคำขอ (kind) ต้องเป็น next, current, future หรือ at")
    t = _parse_time(body.get("t"), "t", "เวลาเริ่ม")
    aos = _parse_time(body.get("aos"), "aos", "AOS ของ pass ที่ต้องการ") if kind == "at" else None
    return norad, kind, t, aos


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


# ---------------------------------------------------------------- service

class PassService:
    """คำขอ pass ของทุก module (ไม่มีสถานะของตัวเอง ใช้ Hub, EphemManager และ Prefs ร่วมกับส่วนอื่น)"""

    def __init__(self, hub: Hub, ephem: EphemManager, prefs: Prefs, now: Callable[[], datetime]):
        self._hub = hub
        self._ephem = ephem
        self._prefs = prefs
        self._now = now

    def plan(self, module: str, body: dict) -> PassPlan | dict:
        """ตรวจ body (422 PASS_INVALID) → หา module (ไม่ได้เปิด: ModuleClosedError) → หาดาว (404 NOT_FOUND)
        → has_aos เป็นเท็จ: คืน dict คำตอบ PASS_NO_AOS ทันที (kind "at": 404 เพราะไม่มี pass ที่ AOS นั้นแน่นอน)
        นอกนั้นคืน PassPlan ที่มีช่วงวันตาม spec §3.2 และ plan-context ข้อ 5"""
        norad, kind, t, aos = parse_body(body)
        rt = self._hub.get(module)
        if rt is None:
            raise ModuleClosedError(f"module {module} ไม่ได้เปิดอยู่")
        found = rt.sat_orbit(norad)
        if found is None:
            raise ApiError("NOT_FOUND", 404, f"ไม่พบดาว NORAD {norad} ใน module {module}", str(norad))
        name, spec, elements = found
        qth = rt.qth
        real_t0 = bool(self._prefs.get("PREDICT/USE_REAL_T0"))
        if real_t0:
            t = self._now().astimezone(_UTC)                    # ref-P §1.3: ไม่ใช้เวลาของ module และกติกาเวลาเริ่ม
        if not has_aos(elements, qth.lat_deg, aos if kind == "at" else t):
            if kind == "at":
                raise self._at_not_found(name, norad, aos)
            text = (NO_AOS_SHORT if kind == "future" else NO_AOS_LONG) % name
            return {"sat": _sat_dict(norad, name), "qth": _qth_dict(qth),
                    "message": _message("PASS_NO_AOS", "error", text)}
        if kind == "at":
            first, last = day_range(aos, aos + DATA_PAD)
        else:
            look_ahead = int(self._prefs.get("PREDICT/LOOK_AHEAD"))
            first, last = day_range(t, t + timedelta(days=look_ahead) + DATA_PAD)
        return PassPlan(module, norad, name, spec, elements, qth, kind, t, aos, first, last, real_t0)

    def answer(self, plan: PassPlan, messages: Sequence[Message] = ()) -> dict:
        """คำตอบของ plan หลัง days_status ของ owner เป็น ok (messages คือข้อความของ days_status นั้น)
        ค่า Preferences อ่าน ณ ตอนนี้ ไม่มีตำแหน่งที่ต้องใช้ -> 503 (_data_missing) kind "at" ที่ไม่เจอ pass -> 404"""
        eph = self._ephem.get_days(plan.spec, plan.first, plan.last)
        if eph is None:
            raise _data_missing(plan, messages)
        q = qth_geo(plan.qth)
        passes = find_passes(eph, q)
        get = self._prefs.get                                     # อ่านครั้งเดียว: ทุก pass ในคำตอบใช้ค่าชุดเดียวกัน
        min_el, look_ahead = float(get("PREDICT/MINIMUM_ELEV")), int(get("PREDICT/LOOK_AHEAD"))
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
