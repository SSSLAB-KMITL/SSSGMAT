"""Runtime ของ module ที่เปิดอยู่: นาฬิกา ช่วงคำนวณ GMAT และ tick ของ WebSocket (หัวข้อ 5.1, 5.3, 6.4, 7.2 และ 7.3 ของ spec)

ช่วงคำนวณ (หัวข้อ 5.1)
- ใช้ช่วงปัจจุบันตราบที่ T ยัง interpolate ได้ (window_for(T) เปลี่ยนทุกชั่วโมง จึงไม่สลับเพียงเพราะมันต่าง)
- เหลือช่วงด้านที่เวลาเดินไปน้อยกว่า REFRESH_MARGIN_H: สั่งช่วงถัดไป window_for(T) ล่วงหน้า แล้วสลับเมื่อค่าของทุกดวงพร้อม
  และหา pass ของทุกดวงเสร็จ (ทยอยหาไม่เกิน PASS_WARM_BUDGET_S ต่อ tick) หรือเมื่อช่วงปัจจุบันใช้ไม่ได้แล้ว สลับแล้วปล่อยช่วงเก่า
- T อยู่นอกช่วงปัจจุบันและช่วงถัดไป (ตั้งเวลาไปไกล, เครื่อง sleep): ปล่อยทุกช่วงทันที (คิว GMAT เป็น FIFO งานละราว 40 วินาที
  งานเก่าที่ไม่มีใครใช้ต้องไม่ขวางงานที่รีบ) แล้วสั่งช่วง window_for(T) ระหว่างรอ tick เป็น computing และไม่มี sats

TLE เปลี่ยน (หัวข้อ 5.3): เก็บ SatSpec เดิมไว้แสดงค่าเก่าจนกว่า TLE ใหม่จะมีค่าในช่วงปัจจุบัน
pass หาครั้งเดียวต่อ (tle_key, ช่วง, ตำแหน่ง QTH) เพราะ find_passes ใช้ราว 13 ms ต่อดวงต่อช่วง
"""

import logging
import threading
import time
from collections.abc import Callable, Iterator, Mapping
from contextlib import contextmanager
from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone
from types import MappingProxyType

from gnss_predict.astro import subpoint, sun_ecef_km
from gnss_predict.errors import Message
from gnss_predict.geometry import ecef_to_aer

from .clock import BACKWARD, FORWARD, ModuleClock
from .config import TLE_OLD_DAYS
from .ephem import EphemManager, SatEphem, SatSpec, Window, needs_next, tle_key, usable, window_for
from .errors import ApiError
from .module import ModuleConfig
from .observe import TWILIGHT_SUN_EL_DEG, TleElements, is_decayed, observe, parse_tle, qth_geo
from .passes import Pass, find_passes, next_events
from .prefs import Prefs
from .satdb import SatDb, SatRecord, gmat_name
from .store import Qth, Store
from .tracks import ground_track, sky_track

PASS_WARM_BUDGET_S = 0.05             # เวลาต่อ tick ที่ใช้หา pass ของช่วงถัดไปก่อนสลับ (อย่างน้อยหนึ่งดวงต่อ tick)
COMPUTING_TEXT = "กำลังคำนวณวงโคจรด้วย GMAT…"
_MISSING = "SAT_MISSING_FROM_GMAT"
_UTC = timezone.utc
_log = logging.getLogger(__name__)

PassKey = tuple[str, Window, tuple[float, float, float]]      # (tle_key, ช่วง, (lat, lon, alt ของ QTH))


class ModuleClosedError(RuntimeError):
    """เรียก tick/update/retry ของ runtime ที่ปิดแล้ว (Hub.close) runtime ที่ปิดแล้วไม่สั่ง GMAT อีก"""


def sky_owner(module: str) -> str:
    """owner ของ EphemManager.ensure_days/release_days สำหรับ Sky at a glance ของ module (Hub.close ปล่อยให้เมื่อปิด module)"""
    return f"sky:{module}"


def iso_ms(t: datetime | None) -> str | None:
    """เวลาใน API: ISO 8601 UTC ความละเอียดมิลลิวินาที ลงท้าย Z"""
    if t is None:
        return None
    return t.astimezone(_UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _direction(state: str) -> int:
    return 1 if state == FORWARD else -1 if state == BACKWARD else 0


@dataclass(frozen=True)
class _Orbit:
    """TLE หนึ่งชุดของดาว: SatSpec ที่ส่ง GMAT, element ที่ observe ใช้ และ key ของ cache"""
    spec: SatSpec
    elements: TleElements
    key: str


def _orbit(r: SatRecord) -> _Orbit:
    lines = (r.tle_lines[0], r.tle_lines[1])
    return _Orbit(SatSpec(r.norad, gmat_name(r.norad), lines), parse_tle(lines), tle_key(lines))


@dataclass(eq=False)
class _Sat:
    record: SatRecord
    cur: _Orbit
    prev: _Orbit | None = None         # TLE ก่อนหน้า ใช้แสดงจนกว่า cur จะมีค่าในช่วงปัจจุบัน (หัวข้อ 5.3)
    rate: float | None = None          # range rate ของ tick ก่อน (ลูกศร Dir)


class ModuleRuntime:
    """module ที่เปิดอยู่หนึ่งตัว: ถือนาฬิกา ช่วงคำนวณ (ปัจจุบัน + ถัดไป) และ cache ของ pass ทุกเมธอดใช้ lock เดียว
    owner ของ EphemManager คือชื่อ module
    twilight: คืน Twilight threshold (องศา) ที่ใช้ตอนนี้ เรียกครั้งเดียวต่อ tick เพื่อให้ Preferences มีผลที่ tick ถัดไปโดยไม่ต้องเปิด module ใหม่
    globals_: ค่ารวมที่ module สืบทอดได้ ณ ตอนที่ถูกสร้าง (Store.inheritable_globals) Hub.reload ประกอบ module กับค่านี้
    ค่ารวมใหม่จึงถึง module ที่เปิดอยู่เมื่อถูกสร้างใหม่เท่านั้น (Hub.recreate) เหมือน Gpredict (spec งานย่อย 4 §9.1)"""

    def __init__(self, module: ModuleConfig, qth: Qth, sats: list[SatRecord], ephem: EphemManager, clock: ModuleClock,
                 twilight: Callable[[], float] = lambda: TWILIGHT_SUN_EL_DEG, globals_: Mapping[str, object] | None = None):
        self._lock = threading.Lock()
        self._globals: Mapping[str, object] = MappingProxyType(dict(globals_ or {}))
        self._twilight = twilight
        self._ephem = ephem
        self._clock = clock
        self._owner = module.name
        self._module = module
        self._qth = qth
        self._q = qth_geo(qth)
        self._sats: dict[int, _Sat] = self._build(sats, {})
        self._window: Window | None = None
        self._next: Window | None = None
        self._passes: dict[PassKey, list[Pass]] = {}
        self._closed = False
        with self._lock:
            t, state, _, _ = clock.snapshot()
            self._sync_windows(t, _direction(state))           # เริ่มคำนวณทันทีที่เปิด ไม่ต้องรอ tick แรก

    # ---------------------------------------------------------------- API

    @property
    def name(self) -> str:
        return self._owner

    @property
    def module(self) -> ModuleConfig:
        with self._lock:
            return self._module

    @property
    def globals(self) -> Mapping[str, object]:
        """ค่ารวมที่ module สืบทอดได้ ณ ตอนที่ runtime ถูกสร้างหรือสร้างใหม่ (อ่านอย่างเดียว)"""
        with self._lock:
            return self._globals

    @property
    def clock(self) -> ModuleClock:
        return self._clock

    @property
    def closed(self) -> bool:
        with self._lock:
            return self._closed

    @property
    def qth(self) -> Qth:
        """สถานีที่ module ใช้อยู่ (หลัง update เป็นสถานีใหม่)"""
        with self._lock:
            return self._qth

    def sat_orbit(self, norad: int) -> tuple[str, SatSpec, TleElements] | None:
        """(ชื่อ, SatSpec, element) ของ TLE ปัจจุบันของดาว None ถ้าดาวไม่อยู่ใน module
        pass ใช้ TLE ปัจจุบันเสมอ (ไม่ใช้ TLE ก่อนหน้าที่ tick แสดงระหว่างรอค่าใหม่) module ที่ปิดแล้ว -> ModuleClosedError"""
        with self._lock:
            self._check_open()
            s = self._sats.get(norad)
            if s is None:
                return None
            return s.record.name, s.cur.spec, s.cur.elements

    def sat_orbits(self) -> list[tuple[int, str, SatSpec, TleElements]]:
        """(NORAD, ชื่อ, SatSpec, element) ของ TLE ปัจจุบันของทุกดาวตามลำดับใน module (กติกาเดียวกับ sat_orbit)"""
        with self._lock:
            self._check_open()
            return [(norad, s.record.name, s.cur.spec, s.cur.elements) for norad, s in self._sats.items()]

    def sat_names(self) -> list[tuple[int, str]]:
        """(NORAD, ชื่อ) ของทุกดาวใน module สำหรับ combo ดาวของ Radio/Antenna Control เรียงด้วย key เรียงชื่อเดียวกับ
        Sky at a glance (decision 17 ของงานย่อย 3) ชื่อที่เท่ากันเรียงตาม NORAD module ที่ปิดแล้ว -> ModuleClosedError"""
        from .pass_service import name_sort_key           # pass_service นำเข้าโมดูลนี้ จึงนำเข้าตอนเรียก (ไม่ให้ import วน)
        with self._lock:
            self._check_open()
            names = [(norad, s.record.name) for norad, s in self._sats.items()]
        return sorted(names, key=lambda item: (name_sort_key(item[1]), item[0]))

    def azel_at(self, norad: int, t: datetime) -> tuple[float, float] | None:
        """(Az, El) ของดาวที่เวลา t ใดก็ได้จากช่วงคำนวณปัจจุบัน (lead-ahead ของ Antenna Control มองล่วงหน้า) ค่าเดียวกับ az/el
        ของ tick ที่เวลานั้น None ถ้า t อยู่นอกช่วงที่ interpolate ได้ ยังไม่มีค่าจาก GMAT ดาว decayed หรือ module ปิดแล้ว
        NORAD ที่ไม่อยู่ใน module -> ApiError NOT_FOUND"""
        with self._lock:
            s = self._sats.get(norad)
            if s is None:
                raise ApiError("NOT_FOUND", 404, f"ไม่พบดาว NORAD {norad} ใน module {self._owner}", str(norad))
            w = self._window
            if w is None or not usable(w, t) or is_decayed(s.cur.elements, t):
                return None
            e, _ = self._resolve(s, w)
            q = self._q
        state = None if e is None else e.state_at(t)
        if state is None:
            return None
        az, el, _ = ecef_to_aer(state[0], q.ecef_km, q.lat_deg, q.lon_deg)
        return az, el

    def tick(self) -> dict:
        """tick ของ WebSocket ตามหัวข้อ 7.3 ของ spec (ไม่มี sats เมื่อ status ไม่ใช่ ok, ไม่ส่งดาวที่ decayed)"""
        with self._lock:
            self._check_open()
            t, state, throttle, label = self._clock.snapshot()
            self._sync_windows(t, _direction(state))
            w = self._window
            ephem_state, ephem_msgs = self._ephem.status(self._owner, w)
            missing = {}                                         # NORAD -> SAT_MISSING_FROM_GMAT (object เป็น NORAD)
            messages: list[Message] = []
            for m in ephem_msgs:
                norad = self._by_prn.get(m.object) if m.code == _MISSING else None
                if norad is None:
                    messages.append(m)
                else:
                    missing[norad] = Message(m.code, m.level, m.text, str(norad))

            rows: list[tuple[_Sat, SatEphem, _Orbit]] = []
            sat_msgs: list[Message] = []
            lacking = False
            old_before = t - timedelta(days=TLE_OLD_DAYS)
            for norad, s in self._sats.items():
                if is_decayed(s.cur.elements, t):
                    s.rate = None
                    continue                                     # ไม่แสดงในทุก view จึงไม่มีข้อความของมันด้วย
                if norad in missing:
                    sat_msgs.append(missing[norad])
                if s.record.epoch < old_before:
                    sat_msgs.append(_tle_old(s.record, t))
                e, orbit = self._resolve(s, w, current_missing=norad in missing)
                if e is not None:
                    rows.append((s, e, orbit))
                elif norad not in missing:
                    lacking = True

            if not lacking:
                status = "ok"
            elif ephem_state == "failed":
                status = "failed"
            else:
                status = "computing"
                messages.append(Message("EPHEM_COMPUTING", "info", COMPUTING_TEXT))

            sats = self._observe_all(rows, t, w, sat_msgs) if status == "ok" else None
            if sats is None:
                for s in self._sats.values():
                    s.rate = None
            q = self._qth

        lat, lon = subpoint(sun_ecef_km(t))
        out = {
            "t": iso_ms(t),
            "clock": {"state": state, "throttle": throttle, "label": label},
            "status": status,
            "qth": {"name": q.name, "location": q.location, "lat_deg": q.lat_deg, "lon_deg": q.lon_deg, "alt_m": q.alt_m},
            "sun": {"lat_deg": lat, "lon_deg": lon},
            "window": {"start": iso_ms(w[0]), "stop": iso_ms(w[1])},
        }
        if sats is not None:
            out["sats"] = sats
        out["messages"] = [m.to_dict() for m in messages + sat_msgs]
        return out

    def track(self, norad: int) -> list[list[list[float]]]:
        """ground track [[ [lat, lon], ... ], ...] ตั้งแต่ต้นรอบปัจจุบันไป map.track_orbits รอบ (แยกเส้นที่ ±180°)
        [] ถ้ายังไม่มีค่าหรือดาว decayed; NORAD ที่ไม่อยู่ใน module -> ApiError NOT_FOUND"""
        with self._lock:
            t, e, orbit = self._lookup(norad)
            if e is None:
                return []
            lines = ground_track(e, orbit.elements, t, self._module.map["track_orbits"])
        return [[[lat, lon] for lat, lon in line] for line in lines]

    def skytrack(self, norad: int) -> list[dict] | None:
        """Az/El [{"t", "az", "el"}] ทุก 10 วินาทีของ pass ปัจจุบัน None ถ้าดาวอยู่ใต้ขอบฟ้า ยังไม่มีค่า หรือ decayed
        NORAD ที่ไม่อยู่ใน module -> ApiError NOT_FOUND"""
        with self._lock:
            t, e, orbit = self._lookup(norad)
            if e is None:
                return None
            points = sky_track(e, self._q, self._passes_for(orbit, e, self._window), t)
        if points is None:
            return None
        return [{"t": iso_ms(p["t"]), "az": p["az"], "el": p["el"]} for p in points]

    def update(self, module: ModuleConfig, qth: Qth, sats: list[SatRecord],
               globals_: Mapping[str, object] | None = None) -> bool:
        """ใช้ module, QTH และ TLE ใหม่ (หลังแก้ module หรืออัปเดต TLE) นาฬิกาเดิม ดาวที่ TLE เปลี่ยนเก็บ SatSpec เดิมไว้
        globals_: ค่ารวมใหม่ที่จำไว้ (เฉพาะตอนสร้างใหม่) None = คงของเดิม คืน True เมื่อ config ของ module ต่างจากเดิม"""
        with self._lock:
            self._check_open()
            changed = module != self._module
            self._module = module
            if globals_ is not None:
                self._globals = MappingProxyType(dict(globals_))
            self._sats = self._build(sats, self._sats)
            if qth != self._qth:
                self._qth, self._q = qth, qth_geo(qth)
                for s in self._sats.values():
                    s.rate = None                                # range rate เทียบกับสถานีเดิม
            for w in (self._window, self._next):
                if w is not None:
                    self._ephem.ensure(self._owner, self._specs(), w)
            self._prune_passes()
            return changed

    def drop_qth_reference(self) -> None:
        """ไฟล์ module เปลี่ยนเป็น ** DEFAULT ** ขณะที่ module เปิดอยู่ (batch ลบสถานีของมัน): อ้างอิง qth ของ runtime เป็น None ตามไฟล์
        แต่สถานีที่ถืออยู่ (_qth, _q) ไม่เปลี่ยน เหมือน Gpredict ที่ module ที่เปิดอยู่ถือสถานีเดิมจนถูกสร้างใหม่
        การบันทึก view ที่ส่ง qth: None กลับมาจึงไม่ใช่การเปลี่ยนสถานี (check_configurable ไม่ตอบ 409) และ Hub.reload ไม่ย้ายสถานีให้"""
        with self._lock:
            self._check_open()
            self._module = replace(self._module, qth=None)

    def retry(self) -> None:
        """ปุ่ม Retry หลัง GMAT ล้มเหลว **(ของเรา)**"""
        with self._lock:
            self._check_open()
            self._ephem.retry(self._owner)

    def close(self) -> None:
        """ปล่อยทุกช่วงของ module (งานที่ไม่มีใครใช้แล้วถูกตัดออกจากคิวหรือถูก kill) เรียกซ้ำได้"""
        with self._lock:
            if self._closed:
                return
            self._closed = True
            self._ephem.release(self._owner)
            self._window = self._next = None
            self._passes.clear()

    # ---------------------------------------------------------------- ดาว

    def _build(self, records: list[SatRecord], old: dict[int, _Sat]) -> dict[int, _Sat]:
        """ดาวตามลำดับ records เก็บ prev/rate ของดวงเดิม TLE ที่เปลี่ยนเก็บ TLE ที่มีค่าอยู่ (prev ถ้ามี ไม่งั้น cur เดิม) ไว้เป็น prev"""
        sats: dict[int, _Sat] = {}
        for r in records:
            try:
                orbit = _orbit(r)
            except ValueError as exc:                            # ดัชนีดาวสร้าง TLE จาก omm.to_tle_lines จึงไม่น่าเกิด
                _log.warning("ข้ามดาว %s ของ module %s: อ่าน TLE ไม่ได้ (%s)", r.norad, self._owner, exc)
                continue
            before = old.get(r.norad)
            if before is None:
                sats[r.norad] = _Sat(r, orbit)
            elif before.cur.key == orbit.key:
                sats[r.norad] = _Sat(r, before.cur, before.prev, before.rate)
            else:
                sats[r.norad] = _Sat(r, orbit, before.prev or before.cur, before.rate)
        self._by_prn = {s.cur.spec.prn: n for n, s in sats.items()}
        return sats

    def _specs(self) -> list[SatSpec]:
        return [s.cur.spec for s in self._sats.values()]

    def _resolve(self, s: _Sat, w: Window, current_missing: bool = False) -> tuple[SatEphem | None, _Orbit | None]:
        """ค่าของดาวในช่วง w จาก TLE ปัจจุบัน ถ้ายังไม่มีใช้ TLE ก่อนหน้า (หัวข้อ 5.3) TLE ปัจจุบันมีค่าแล้วก็ทิ้ง TLE ก่อนหน้า"""
        if not current_missing:
            e = self._ephem.get(s.cur.spec, w)
            if e is not None:
                s.prev = None
                return e, s.cur
        if s.prev is not None:
            e = self._ephem.get(s.prev.spec, w)
            if e is not None:
                return e, s.prev
        return None, None

    def _lookup(self, norad: int) -> tuple[datetime, SatEphem | None, _Orbit | None]:
        s = self._sats.get(norad)
        if s is None:
            raise ApiError("NOT_FOUND", 404, f"ไม่พบดาว NORAD {norad} ใน module {self._owner}", str(norad))
        t = self._clock.time()
        w = self._window
        if w is None or not usable(w, t) or is_decayed(s.cur.elements, t):
            return t, None, None
        e, orbit = self._resolve(s, w)
        return t, e, orbit

    def _observe_all(self, rows: list[tuple[_Sat, SatEphem, _Orbit]], t: datetime, w: Window,
                     sat_msgs: list[Message]) -> list[dict]:
        """ค่าของทุกดวงที่มีค่า (observe + next_events จาก pass ใน cache) ดวงที่วงโคจรไม่ปิดถูกข้ามพร้อมคำเตือน"""
        sats = []
        twilight = self._twilight()                              # ครั้งเดียวต่อ tick: ทุกดวงใน tick เดียวกันใช้ค่าเดียวกัน
        for s, e, orbit in rows:
            norad = s.record.norad
            state = e.state_at(t)
            if state is None:                                    # T อยู่ในช่วงที่ใช้ได้ของ w เสมอ จึงไม่น่าเกิด
                s.rate = None
                continue
            try:
                obs = observe(state[0], state[1], t, self._q, orbit.elements, s.rate, twilight)
            except ValueError as exc:                            # วงโคจรไม่ปิด: ข้ามเฉพาะดวงนี้ (tick ยังทำงาน)
                s.rate = None
                sat_msgs.append(Message("SAT_STATE_INVALID", "warning",
                                        f"ข้ามดาว {s.record.name} (NORAD {norad}): ตำแหน่งและความเร็วจาก GMAT "
                                        f"ไม่ใช่วงโคจรรอบโลก ({exc})", str(norad)))
                continue
            s.rate = obs["range_rate_kms"]
            next_aos, next_los, always = next_events(self._passes_for(orbit, e, w), e, self._q, t)
            sats.append({"norad": norad, "name": s.record.name, **obs,
                         "next_aos": iso_ms(next_aos), "next_los": iso_ms(next_los), "always": always})
        return sats

    # ---------------------------------------------------------------- ช่วงคำนวณ

    def _sync_windows(self, t: datetime, direction: int) -> None:
        """เลือกช่วงปัจจุบันและช่วงถัดไปที่เวลา t (กติกาอยู่ที่ docstring ของไฟล์)"""
        w, nxt = self._window, self._next
        if nxt is not None and not usable(nxt, t):              # ช่วงที่สั่งล่วงหน้าไม่ครอบ T แล้ว (เวลากระโดดหรือกลับทิศ)
            self._ephem.release(self._owner, nxt)
            self._next = nxt = None
            self._prune_passes()
        if w is not None and usable(w, t):
            if nxt is None:
                if needs_next(w, t, direction):
                    candidate = window_for(t, direction)
                    if candidate != w:
                        self._next = candidate
                        self._ephem.ensure(self._owner, self._specs(), candidate)
            elif self._next_ready(nxt):
                self._switch(nxt)
            return
        if nxt is not None and self._ephem.status(self._owner, nxt)[0] != "failed":
            self._switch(nxt)                                    # ช่วงเดิมหมด: ใช้ช่วงถัดไป (งานของมันยังอยู่ในคิว)
            return
        if w is not None or nxt is not None:                     # เวลากระโดด หรือช่วงถัดไปล้มเหลว: เริ่มช่วงใหม่จาก T
            self._ephem.release(self._owner)
        self._window, self._next = window_for(t, direction), None
        self._ephem.ensure(self._owner, self._specs(), self._window)
        self._prune_passes()

    def _next_ready(self, nxt: Window) -> bool:
        """ค่าของทุกดวงในช่วงถัดไปพร้อม และหา pass ครบแล้ว (ทยอยหาไม่เกิน PASS_WARM_BUDGET_S ต่อ tick)"""
        if self._ephem.status(self._owner, nxt)[0] != "ok":
            return False
        deadline = time.perf_counter() + PASS_WARM_BUDGET_S
        for s in self._sats.values():
            key = (s.cur.key, nxt, self._qth_key())
            if key in self._passes:
                continue
            if time.perf_counter() > deadline:
                return False
            e = self._ephem.get(s.cur.spec, nxt)
            if e is not None:
                self._passes[key] = find_passes(e, self._q)
        return True

    def _switch(self, nxt: Window) -> None:
        old = self._window
        self._window, self._next = nxt, None
        if old is not None:
            self._ephem.release(self._owner, old)
        self._prune_passes()

    # ---------------------------------------------------------------- pass

    def _qth_key(self) -> tuple[float, float, float]:
        return self._qth.lat_deg, self._qth.lon_deg, self._qth.alt_m

    def _passes_for(self, orbit: _Orbit, e: SatEphem, w: Window) -> list[Pass]:
        key = (orbit.key, w, self._qth_key())
        passes = self._passes.get(key)
        if passes is None:
            passes = self._passes[key] = find_passes(e, self._q)
        return passes

    def _prune_passes(self) -> None:
        keep, q = {self._window, self._next}, self._qth_key()
        self._passes = {k: v for k, v in self._passes.items() if k[1] in keep and k[2] == q}

    def _check_open(self) -> None:
        if self._closed:
            raise ModuleClosedError(f"module {self._owner} ปิดแล้ว")


def _tle_old(r: SatRecord, t: datetime) -> Message:
    days = (t - r.epoch).total_seconds() / 86400.0
    return Message("TLE_OLD", "warning",
                   f"TLE ของ {r.name} (NORAD {r.norad}) อายุ {days:.1f} วัน เกิน {TLE_OLD_DAYS} วัน ค่าที่แสดงอาจคลาดเคลื่อน "
                   f"ควรอัปเดต TLE (Edit → Update TLE data from network)", str(r.norad))


class Hub:
    """module ที่เปิดอยู่ทั้งหมด (ชื่อ -> ModuleRuntime) ทุก browser tab ของ module เดียวกันใช้ runtime เดียวกัน

    lock สองชั้น งานช้าของ module หนึ่งจึงไม่ขวาง module อื่น
    - _lock ถือสั้นๆ เฉพาะตอนอ่านหรือแก้ dict ไม่เคยถือขณะอ่านไฟล์ สร้าง runtime หรือรอ lock ของ runtime
      (tick แรกของ module 200 ดวงถือ lock ของ runtime ราว 3 วินาทีระหว่างหา pass)
    - lock ประจำชื่อ (_serial) เรียงงานช้าของชื่อเดียวกัน: สร้าง runtime ตอน open, _load + update ตอน reload และ close
      reload ที่ตามหลัง PUT จึงไม่หลุด (รอ open ที่กำลังสร้างอยู่) และไม่ทับกันผิดลำดับ
      และ runtime สองตัวของชื่อเดียวกันไม่มีชีวิตซ้อนกัน: owner ใน EphemManager คือชื่อ module
      ถ้าตัวใหม่เริ่มก่อนตัวเก่าปิดเสร็จ release ของตัวเก่าจะลบช่วงและงาน GMAT ของตัวใหม่ทิ้ง
    lock ประจำชื่อมีอยู่เฉพาะระหว่างที่มีคนใช้ (นับจำนวน) dict จึงไม่โตตามชื่อที่เคยถูกเรียก
    ลำดับการถือ lock: ประจำชื่อ -> _lock (สั้นๆ) และ ประจำชื่อ -> lock ของ runtime -> lock ของ EphemManager
    """

    def __init__(self, store: Store, satdb: SatDb, ephem: EphemManager, now: Callable[[], datetime],
                 prefs: Prefs | None = None):
        self._store = store
        self._satdb = satdb
        self._ephem = ephem
        self._now = now
        self._prefs = prefs
        self._lock = threading.Lock()
        self._open: dict[str, ModuleRuntime] = {}
        self._name_locks: dict[str, list] = {}                  # ชื่อ -> [Lock, จำนวนผู้ถือหรือรอ]

    def open(self, name: str) -> ModuleRuntime:
        """เปิด module (นาฬิกาเริ่มที่ Reset) หรือคืนตัวที่เปิดอยู่แล้ว ApiError จาก store (NOT_FOUND, MODULE_INVALID)
        หรือ QTH_INVALID เมื่อ module ใช้สถานีตั้งต้นแต่ไม่มีสถานีตั้งต้น"""
        rt = self.get(name)
        if rt is not None:
            return rt
        with self._serial(name):
            rt = self.get(name)                                  # อีก thread อาจเปิดเสร็จระหว่างรอ
            if rt is None:
                module, qth, sats, globals_ = self._load(name)
                rt = ModuleRuntime(module, qth, sats, self._ephem, ModuleClock(self._now), self._twilight, globals_)
                with self._lock:
                    page = len(self._open)                       # หน้าที่ต่อท้าย (ลำดับที่เปิด)
                    self._open[name] = rt
                _log.info("Added %s to module manager (page %d).", name, page, extra={"gp_function": "mod_mgr_add_module"})
            return rt

    def close(self, name: str) -> None:
        """ปิด module และปล่อยทุกช่วงคำนวณของมัน รวมถึง block รายวันของ Sky at a glance (owner sky:<name>)
        เอาออกจาก dict ทันที แล้วรอ tick ที่กำลังทำของ module นี้ก่อนปล่อยช่วง (โดยไม่ถือ _lock)
        ไม่ได้เปิดอยู่: ปล่อยเฉพาะ owner ของ Sky at a glance ที่อาจค้าง (ไม่มี owner นั้นก็ไม่ทำอะไร)
        เปิดและปิด module มีบรรทัด INFO ตามข้อความของ Gpredict (mod-mgr.c, gtk-sat-module.c) หน้า = ลำดับที่เปิดอยู่ใน Hub"""
        with self._serial(name):
            with self._lock:
                page = list(self._open).index(name) if name in self._open else -1
                rt = self._open.pop(name, None)
            if rt is not None:
                rt.close()
                _log.info("Removed child from notebook page %d.", page, extra={"gp_function": "mod_mgr_remove_module"})
                _log.info("Module %s closed.", name, extra={"gp_function": "gtk_sat_module_close_cb"})
            self._ephem.release_days(sky_owner(name))

    def get(self, name: str) -> ModuleRuntime | None:
        with self._lock:
            return self._open.get(name)

    def reload(self, name: str) -> bool:
        """อ่าน module, QTH และ TLE ใหม่หลัง PUT module, PUT QTH หรือ Update TLE (นาฬิกาและ TLE เดิมระหว่างรอค่าใหม่คงอยู่)
        ประกอบ module กับค่ารวมที่ runtime จำไว้ตอนสร้าง ไม่ใช่ค่ารวมตอนนี้ (spec งานย่อย 4 §9.1)
        สถานีเปลี่ยนเมื่อ qth ของ module เปลี่ยนเท่านั้น (ดู _station) ไม่ย้ายตามสถานีตั้งต้นใหม่หรือเพราะไฟล์สถานีหาย
        คืน True เมื่อ config ของ runtime เปลี่ยน ไม่ได้เปิดอยู่: ไม่ทำอะไร (False)
        ApiError จาก store ไม่เปลี่ยน runtime (close ถือ lock ประจำชื่อเดียวกัน จึงไม่ปิดแทรกระหว่างนี้)"""
        with self._serial(name):
            rt = self.get(name)
            if rt is None:
                return False
            module, sats = self._read(name, rt.globals)
            return rt.update(module, self._station(module, rt), sats)

    def recreate(self, name: str) -> bool:
        """สร้าง module ที่เปิดอยู่ใหม่ (Configure → OK, ref-D §9): ค่ารวมตอนนี้ (จำแทนของเดิม) และสถานีที่หาใหม่ทั้งหมด
        (** DEFAULT ** = สถานีตั้งต้นตอนนี้) แบบ open (ของเรา) ใช้ runtime ตัวเดิม: นาฬิกา ช่วงคำนวณและ pass ที่หาไว้คงอยู่
        ไม่ต้องรอ GMAT ใหม่ คืน True เมื่อเปิดอยู่ ไม่ได้เปิดอยู่: ไม่ทำอะไร (False) ApiError จาก store ไม่เปลี่ยน runtime"""
        with self._serial(name):
            rt = self.get(name)
            if rt is None:
                return False
            module, qth, sats, globals_ = self._load(name)
            rt.update(module, qth, sats, globals_)
            return True

    def station_for(self, module: ModuleConfig) -> Qth:
        """สถานีที่ module นี้จะได้ถ้าถูกสร้างตอนนี้ (ชื่อใน qth หรือสถานีตั้งต้นตอนนี้) ApiError แบบ open
        (ให้ PUT ?recreate=true ตรวจก่อนเขียนไฟล์)"""
        return self._station(module, None)

    def drop_qth_reference(self, name: str) -> bool:
        """ไฟล์ module เปลี่ยนเป็น ** DEFAULT ** (batch ลบสถานีของมัน): runtime ที่เปิดอยู่เก็บสถานีเดิมไว้ คืน True
        ไม่เปิดอยู่: ไม่ทำอะไร (False)"""
        with self._serial(name):
            rt = self.get(name)
            if rt is None:
                return False
            rt.drop_qth_reference()
            return True

    def open_names(self) -> list[str]:
        """ชื่อ module ที่เปิดอยู่ตามลำดับที่เปิด"""
        with self._lock:
            return list(self._open)

    @contextmanager
    def _serial(self, name: str) -> Iterator[None]:
        """ถือ lock ประจำชื่อ module สร้างเมื่อมีคนแรกขอ และลบเมื่อคนสุดท้ายเลิกใช้ (ทั้งสองอย่างใต้ _lock
        ผู้ที่ขอชื่อเดียวกันพร้อมกันจึงได้ lock ตัวเดียวกันเสมอ)"""
        with self._lock:
            entry = self._name_locks.setdefault(name, [threading.Lock(), 0])
            entry[1] += 1
        try:
            with entry[0]:
                yield
        finally:
            with self._lock:
                entry[1] -= 1
                if entry[1] == 0:
                    del self._name_locks[name]

    def _twilight(self) -> float:
        """Twilight threshold ปัจจุบัน: จาก Preferences ถ้า Hub มี prefs นอกนั้นค่าตั้งต้น −6°"""
        if self._prefs is None:
            return TWILIGHT_SUN_EL_DEG
        return float(self._prefs.get("PREDICT/TWILIGHT_THRESHOLD"))

    def _read(self, name: str, globals_: Mapping[str, object]) -> tuple[ModuleConfig, list[SatRecord]]:
        """module (ประกอบกับค่ารวม globals_) และ SatRecord ของดาวตามลำดับใน module (ดาวที่ไม่อยู่ในดัชนีถูกข้าม ดัชนีไม่เคยลบดาว)"""
        module = self._store.get_module(name, globals_)
        return module, [r for r in (self._satdb.get(n) for n in module.satellites) if r is not None]

    def _load(self, name: str) -> tuple[ModuleConfig, Qth, list[SatRecord], dict[str, object]]:
        """ตอนสร้าง runtime (open, recreate): module, QTH ของมัน (หาใหม่ทั้งหมด), SatRecord และค่ารวมตอนนี้ที่ runtime จำไว้"""
        globals_ = self._store.inheritable_globals()
        module, sats = self._read(name, globals_)
        return module, self._station(module, None), sats, globals_

    def _station(self, module: ModuleConfig, current: ModuleRuntime | None) -> Qth:
        """สถานีของ module ที่สร้างใหม่ (current เป็น None) หรือที่อ้างอิง qth เปลี่ยนจากของ runtime ที่เปิดอยู่ (current):
        ชื่อใน qth หรือสถานีตั้งต้น (** DEFAULT **) อ้างอิงไม่เปลี่ยน: สถานีที่ runtime ถืออยู่ต่อ อ่านใหม่ตามชื่อ (แก้ผ่าน PUT /api/qth/{name} ยังถึง) ถ้าไฟล์ของมันหายแล้วใช้ตัวที่ถืออยู่
        ไม่ย้ายตามสถานีตั้งต้นใหม่ (เหมือน Gpredict: module ที่เปิดอยู่ถือสถานีเดิมจนถูกสร้างใหม่ spec งานย่อย 4 §4.2)"""
        if current is not None and module.qth == current.module.qth:
            held = current.qth
            try:
                return self._store.get_qth(held.name)
            except ApiError as exc:
                if exc.status != 404:
                    raise
                return held
        qth_name = module.qth if module.qth is not None else self._store.default_qth()
        if qth_name is None:
            raise ApiError("QTH_INVALID", 422,
                           f"module {module.name} ใช้สถานีตั้งต้น (** DEFAULT **) แต่ยังไม่มีสถานีตั้งต้น "
                           "ให้สร้าง QTH แล้วตั้งเป็นสถานีตั้งต้น หรือเลือก QTH ให้ module นี้", "qth")
        return self._store.get_qth(qth_name)
