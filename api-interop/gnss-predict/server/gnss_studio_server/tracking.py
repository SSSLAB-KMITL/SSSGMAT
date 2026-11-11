"""การเขียน scenario ที่ route ต้องบอกว่าผลเก่าใช้ต่อได้ไหม และ event ที่ตามมา (หัวข้อ 6.4 และ 8 ของ spec server)

`write_tracked` เป็นทางเดียวที่ PUT ของ scenario และ route แก้ object ใช้เขียน: เทียบ fingerprint ของ plan (`plans.py`) ก่อนและหลังเขียน
แล้วส่ง event `scenario` ด้วยค่าชุดเดียวกับที่ตอบกลับ (เขียนไม่สำเร็จ = ไม่ส่ง) ส่วน `publish_scenario` ใช้ตรง ๆ ตอนสร้าง คัดลอก และลบ
"""

import logging

from .events import EventBus
from .plans import fingerprint, is_stale
from .store import ScenarioStore


def etag_header(tag: str) -> dict[str, str]:
    """header `ETag` รูปแบบ RFC (มีเครื่องหมายคำพูด) ของ ETag เปล่า"""
    return {"ETag": f'"{tag}"'}


def publish_scenario(bus: EventBus, name: str, tag: str | None, results_stale: bool) -> None:
    """event `scenario` `{name, etag, results_stale}` ของ scenario ที่เพิ่งเขียนสำเร็จ (tag เป็น None = ถูกลบ)"""
    bus.publish("scenario", {"name": name, "etag": tag, "results_stale": results_stale})


def write_tracked(store: ScenarioStore, bus: EventBus, logger: logging.Logger, name: str, doc: dict,
                  if_match: str | None) -> tuple[str, bool]:
    """`store.write` แล้วส่ง event `scenario` คืน (ETag ใหม่, results_stale)

    fingerprint ก่อนเขียนอ่านจากไฟล์เดิมบนดิสก์ จึงต้องคำนวณก่อน `store.write` ผู้เรียกตรวจ If-Match กับเอกสารที่ตนใช้ก่อนเรียก
    (ให้ ETag เก่าได้ 412 ก่อนคำนวณอะไร) `store.write` ตรวจซ้ำใต้ล็อก ล้มเหลวทุกแบบ (404/412/422) raise ก่อนส่ง event"""
    directory = store.path(name)
    before = fingerprint(directory, store.data_dir, logger)
    tag = store.write(name, doc, if_match)
    stale = is_stale(before, fingerprint(directory, store.data_dir, logger))
    publish_scenario(bus, name, tag, stale)
    return tag, stale
