"""hash ของผลที่ scenario ปัจจุบันต้องใช้ (หัวข้อ 6.4 และ 6.5 ของ spec server) เทียบก่อน/หลังแก้เพื่อบอก `results_stale`

- `fingerprint` เรียก `plan_propagate` และ `plan_analyze` ของทุก Facility ของ engine (ไม่รัน GMAT ไม่เขียนไฟล์) อ่านจาก
  `<scenario>/scenario.json` บนดิสก์ จึงเรียกก่อนเขียน (ได้ของเดิม) และหลังเขียน (ได้ของใหม่) ได้
- ไม่มีดาวให้ propagate (`NoSatellitesError`) เป็นสถานะหนึ่งที่เทียบได้ ไม่ใช่ความล้มเหลว: scenario ว่างแก้เป็น scenario ว่างไม่ stale
  และเมื่อไม่มีดาวจะไม่มีผล access ของ Facility ใดให้ติดตาม (`analyze` ว่าง)
- คำนวณ plan ไม่ได้ด้วยเหตุอื่น (เช่น snapshot หาย) -> None และ `is_stale` ตอบ True เสมอ ไม่ว่าอีกฝั่งเป็นอะไร
"""

import logging
from pathlib import Path

from gnss_predict.errors import GnssPredictError, NoSatellitesError
from gnss_predict.scenario import load_scenario
from gnss_predict.studio import plan_analyze, plan_propagate

from .store import SCENARIO_FILE

NO_SATELLITES = "no-satellites"          # ค่าแทน hash ของ propagate เมื่อ scenario ไม่มีดาวที่จะ propagate


def fingerprint(scenario_dir: Path, data_dir: Path, logger: logging.Logger | None = None) -> dict | None:
    """{"propagate": hash หรือ NO_SATELLITES, "analyze": {ชื่อ Facility: hash}} ของ scenario บนดิสก์ หรือ None ถ้าคำนวณไม่ได้

    ความล้มเหลวทุกชนิดให้ None (รวมที่ engine ไม่ได้คาดไว้) เพราะเรียกหลังเขียนสำเร็จแล้ว: การเช็ก stale เป็นข้อมูลประกอบ
    ต้องไม่ทำให้การแก้ที่บันทึกไปแล้วตอบ 500 ความผิดปกติที่ไม่ใช่ข้อผิดพลาดของ engine ลง log พร้อม traceback"""
    try:
        facilities = [fac.name for fac in load_scenario(Path(scenario_dir) / SCENARIO_FILE).facilities]
        try:
            propagate = plan_propagate(scenario_dir, data_dir).hash
        except NoSatellitesError:
            return {"propagate": NO_SATELLITES, "analyze": {}}
        return {"propagate": propagate, "analyze": {name: plan_analyze(scenario_dir, name, data_dir) for name in facilities}}
    except Exception as exc:                                                    # ดูเหตุผลใน docstring
        if logger is not None:
            logger.warning("คำนวณ plan ของ %s ไม่ได้ ถือว่าผลไม่ตรง: %s: %s", scenario_dir, type(exc).__name__, exc,
                           exc_info=not isinstance(exc, GnssPredictError))
        return None


def is_stale(before: dict | None, after: dict | None) -> bool:
    """hash ที่ต้องใช้ต่างกัน (ชุด Facility ที่ต้องมีผล access เปลี่ยนก็นับ) หรือคำนวณฝั่งใดฝั่งหนึ่งไม่ได้"""
    return before is None or after is None or before != after
