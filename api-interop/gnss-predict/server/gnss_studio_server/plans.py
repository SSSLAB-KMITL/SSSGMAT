"""hash ของผลที่ scenario ปัจจุบันต้องใช้ (หัวข้อ 6.4 และ 6.5 ของ spec server): ใช้บอก `results_stale` และสถานะของ `GET /results`

- `compute_plans` เรียก `plan_propagate` และ `plan_analyze` ของทุก Facility ของ engine (ไม่รัน GMAT ไม่เขียนไฟล์) อ่านจาก
  `<scenario>/scenario.json` บนดิสก์ จึงเรียกก่อนเขียน (ได้ของเดิม) และหลังเขียน (ได้ของใหม่) ได้ แต่ละครั้งสร้าง catalog จาก snapshot
  1 + จำนวน Facility รอบ (ราว 1 วินาทีกับข้อมูลจริง) จึงมี `PlanCache` กันไม่ให้คำนวณซ้ำ
- ไม่มีดาวให้ propagate (`NoSatellitesError`) เป็นสถานะหนึ่งที่เทียบได้ ไม่ใช่ความล้มเหลว: scenario ว่างแก้เป็น scenario ว่างไม่ stale
  และเมื่อไม่มีดาวจะไม่มีผล access ของ Facility ใดให้ติดตาม (`analyze` ว่าง)
- คำนวณ plan ไม่ได้ด้วยเหตุอื่น (เช่น snapshot หาย) -> `fingerprint` เป็น None และ `is_stale` ตอบ True เสมอ ไม่ว่าอีกฝั่งเป็นอะไร

แคช (`PlanCache`): หนึ่งตัวต่อแอป ใช้ร่วมกันระหว่าง `GET /results` และ `tracking.write_tracked`
- key คือ (ชื่อ scenario, ETag ของ scenario.json, ตัวตนของโฟลเดอร์ snapshot) ตัวตนของ snapshot คือเวลาแก้ไขและขนาดของโฟลเดอร์กับทุกรายการข้างใน
  (รวม `brdc/`) หรือ None เมื่อไม่มีโฟลเดอร์ จึงลบหรือแทนที่ snapshot แล้วแคชเดิมใช้ไม่ได้ (ผลของ plan ขึ้นกับเนื้อไฟล์ใน snapshot ด้วย)
- เก็บล่าสุด 64 รายการ ปลอดภัยเมื่อใช้หลาย thread คำนวณนอกล็อก (สอง request พร้อมกันอาจคำนวณซ้ำได้ ผลเท่ากัน)
- ไม่เก็บถ้า scenario หรือ snapshot เปลี่ยนระหว่างคำนวณ และไม่เก็บความล้มเหลวที่ engine ไม่ได้คาดไว้ (เป็น bug ไม่ใช่สถานะ)
"""

import logging
import os
import threading
from collections import OrderedDict
from dataclasses import dataclass, field
from pathlib import Path

from gnss_predict.errors import GnssPredictError, NoSatellitesError
from gnss_predict.scenario import EngineScenario, load_scenario
from gnss_predict.studio import plan_analyze, plan_propagate

from .store import SCENARIO_FILE, ScenarioStore
from .templates import ORBITS_DIR

NO_SATELLITES = "no-satellites"          # ค่าแทน hash ของ propagate เมื่อ scenario ไม่มีดาวที่จะ propagate
CACHE_SIZE = 64


@dataclass(frozen=True)
class Plans:
    """ผล plan ของ scenario หนึ่งเวอร์ชัน

    propagate/analyze: hash ของ ephem และของ access ต่อ Facility (None / ว่าง เมื่อคำนวณไม่ได้)
    facilities: ชื่อ Facility ในลำดับของ scenario (ว่างถ้าอ่าน scenario ไม่ได้)
    error: {"code", "text"} ของ engine เมื่อคำนวณไม่ได้ ไม่งั้น None"""
    propagate: str | None
    analyze: dict[str, str] = field(default_factory=dict)
    facilities: tuple[str, ...] = ()
    error: dict | None = None

    @property
    def fingerprint(self) -> dict | None:
        """{"propagate": hash หรือ NO_SATELLITES, "analyze": {ชื่อ Facility: hash}} หรือ None ถ้าคำนวณไม่ได้ (ไม่ใช่เพราะไม่มีดาว)"""
        if self.error is None:
            return {"propagate": self.propagate, "analyze": dict(self.analyze)}
        if self.error["code"] == NoSatellitesError.code:
            return {"propagate": NO_SATELLITES, "analyze": {}}
        return None


def is_stale(before: dict | None, after: dict | None) -> bool:
    """hash ที่ต้องใช้ต่างกัน (ชุด Facility ที่ต้องมีผล access เปลี่ยนก็นับ) หรือคำนวณฝั่งใดฝั่งหนึ่งไม่ได้"""
    return before is None or after is None or before != after


def _error(exc: GnssPredictError) -> dict:
    return {"code": exc.code, "text": str(exc)}


def compute_plans(scenario_dir: Path, data_dir: Path) -> Plans:
    """plan ของ `<scenario_dir>/scenario.json` ปัจจุบัน ความผิดพลาดที่ engine คาดไว้ (GnssPredictError) อยู่ใน `error`
    ส่วนที่ไม่คาดไว้ raise ต่อให้ผู้เรียกตัดสินใจ"""
    try:
        facilities = tuple(fac.name for fac in load_scenario(Path(scenario_dir) / SCENARIO_FILE).facilities)
    except GnssPredictError as exc:
        return Plans(None, error=_error(exc))
    try:
        propagate = plan_propagate(scenario_dir, data_dir).hash
        return Plans(propagate, {name: plan_analyze(scenario_dir, name, data_dir) for name in facilities}, facilities)
    except GnssPredictError as exc:
        return Plans(None, facilities=facilities, error=_error(exc))


def engine_view(scenario_dir: Path) -> EngineScenario | None:
    """ส่วนของ `scenario.json` บนดิสก์ที่ engine ใช้คำนวณ (ผล `load_scenario`) หรือ None ถ้า engine อ่านไม่ได้"""
    try:
        return load_scenario(Path(scenario_dir) / SCENARIO_FILE)
    except GnssPredictError:
        return None


def snapshot_identity(data_dir: Path, snapshot: str) -> tuple | None:
    """ตัวตนของโฟลเดอร์ snapshot บนดิสก์: เวลาแก้ไขของโฟลเดอร์ และ (ชื่อ, เวลาแก้ไข ns, ขนาด) ของทุกรายการข้างใน
    (`brdc/` เป็นรายการหนึ่ง เวลาแก้ไขของมันเปลี่ยนเมื่อเพิ่มหรือลบไฟล์ broadcast) None = ไม่มีโฟลเดอร์ (หรืออ่านไม่ได้)"""
    folder = Path(data_dir) / ORBITS_DIR / snapshot
    try:
        with os.scandir(folder) as entries:
            items = sorted((e.name, st.st_mtime_ns, st.st_size) for e in entries for st in (e.stat(),))
        return folder.stat().st_mtime_ns, tuple(items)
    except OSError:
        return None


class PlanCache:
    def __init__(self, store: ScenarioStore, logger: logging.Logger, size: int = CACHE_SIZE):
        self.size = size
        self._store = store
        self._logger = logger
        self._entries: OrderedDict[tuple, Plans] = OrderedDict()
        self._lock = threading.Lock()

    def __len__(self) -> int:
        with self._lock:
            return len(self._entries)

    def key(self, name: str) -> tuple:
        """(ชื่อ, ETag, ตัวตน snapshot) ของ scenario ตอนนี้ ไม่มี scenario -> ApiError 404"""
        directory = self._store.path(name)
        tag = self._store.current_etag(name)
        view = engine_view(directory)
        identity = snapshot_identity(self._store.data_dir, view.orbit_snapshot) if view is not None else None
        return name, tag, identity

    def get(self, name: str) -> Plans:
        """plan ของ scenario ตอนนี้ (จากแคชถ้า scenario.json และ snapshot ไม่เปลี่ยน) ไม่มี scenario -> ApiError 404
        ความล้มเหลวที่ engine ไม่ได้คาดไว้ raise ออกไป"""
        key = self.key(name)
        with self._lock:
            hit = self._entries.get(key)
            if hit is not None:
                self._entries.move_to_end(key)
                return hit
        plans = compute_plans(self._store.path(name), self._store.data_dir)
        if self.key(name) == key:                          # scenario และ snapshot ไม่เปลี่ยนระหว่างคำนวณ
            self._put(key, plans)
        return plans

    def _put(self, key: tuple, plans: Plans) -> None:
        with self._lock:
            self._entries[key] = plans
            self._entries.move_to_end(key)
            while len(self._entries) > self.size:
                self._entries.popitem(last=False)

    def carry_over(self, old_key: tuple, new_etag: str) -> None:
        """scenario.json เปลี่ยนแต่ engine เห็นเหมือนเดิม: ย้าย plan ที่แคชไว้ใต้ `old_key` (จาก `key` ก่อนเขียน) ไปไว้ใต้ ETag ใหม่
        เพื่อให้ `/results` หลังแก้สีหรือ Show ไม่ต้องคำนวณใหม่ ไม่มีของเดิมในแคช = ไม่ทำอะไร ย้ายเฉพาะเมื่อตอนนี้ scenario มี ETag นี้
        และ snapshot ยังเป็นตัวเดิม (ไม่งั้น plan เดิมใช้ไม่ได้)"""
        name, _, identity = old_key
        with self._lock:
            plans = self._entries.get(old_key)
        new_key = (name, new_etag, identity)
        try:
            if plans is not None and self.key(name) == new_key:
                self._put(new_key, plans)
        except Exception:                                   # เป็นแค่การเร่งความเร็ว เรียกหลังเขียนสำเร็จแล้ว ห้ามทำให้การแก้ตอบ error
            pass

    def fingerprint(self, name: str) -> dict | None:
        """`Plans.fingerprint` ของ scenario ตอนนี้ ล้มเหลวทุกชนิดให้ None (รวมที่ engine ไม่ได้คาดไว้)

        เรียกหลังเขียนสำเร็จแล้ว: การเช็ก stale เป็นข้อมูลประกอบ ต้องไม่ทำให้การแก้ที่บันทึกไปแล้วตอบ 500
        ความผิดปกติที่ไม่ใช่ข้อผิดพลาดของ engine ลง log พร้อม traceback"""
        try:
            return self.get(name).fingerprint
        except Exception as exc:
            self._logger.warning("คำนวณ plan ของ %s ไม่ได้ ถือว่าผลไม่ตรง: %s: %s", name, type(exc).__name__, exc,
                                 exc_info=not isinstance(exc, GnssPredictError))
            return None
