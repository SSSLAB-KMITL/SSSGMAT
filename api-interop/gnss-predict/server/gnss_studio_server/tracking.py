"""การเขียน scenario ที่ route ต้องบอกว่าผลเก่าใช้ต่อได้ไหม และ event ที่ตามมา (หัวข้อ 6.4 และ 8 ของ spec server)

`write_tracked` เป็นทางเดียวที่ PUT ของ scenario และ route แก้ object ใช้เขียน: เทียบ fingerprint ของ plan (`plans.py`) ก่อนและหลังเขียน
แล้วส่ง event `scenario` ด้วยค่าชุดเดียวกับที่ตอบกลับ (เขียนไม่สำเร็จ = ไม่ส่ง) ส่วน `publish_scenario` ใช้ตรง ๆ ตอนสร้าง คัดลอก และลบ

การแก้ส่วนใหญ่ (สี, Show, คำอธิบาย, ช่องของหน้าเว็บ) ไม่กระทบสิ่งที่ engine อ่าน: เทียบผล `load_scenario` ของไฟล์เดิมกับเอกสารใหม่ ถ้าเท่ากัน
fingerprint ย่อมเท่ากัน จึงตอบ `results_stale = False` โดยไม่คำนวณ plan หรือ catalog ใดเลย (ยกเว้นไม่มีโฟลเดอร์ snapshot: คำนวณ plan ไม่ได้
ตามเดิมจึงนับว่า stale) และย้าย plan ที่แคชไว้ไปไว้ใต้ ETag ใหม่ (`carry_over`) เพื่อให้ `/results` ครั้งถัดไป ซึ่งหน้าเว็บเรียกทุก event `scenario`
ไม่ต้องคำนวณใหม่ ที่เหลือเทียบ fingerprint จาก `PlanCache` ซึ่งผลหลังเขียนครั้งหนึ่งเป็นผลก่อนเขียนของครั้งถัดไป
"""

from gnss_predict.errors import GnssPredictError

from .errors import ApiError
from .events import EventBus
from .plans import PlanCache, engine_view, is_stale, snapshot_identity
from .store import ScenarioStore


def etag_header(tag: str) -> dict[str, str]:
    """header `ETag` รูปแบบ RFC (มีเครื่องหมายคำพูด) ของ ETag เปล่า"""
    return {"ETag": f'"{tag}"'}


def publish_scenario(bus: EventBus, name: str, tag: str | None, results_stale: bool) -> None:
    """event `scenario` `{name, etag, results_stale}` ของ scenario ที่เพิ่งเขียนสำเร็จ (tag เป็น None = ถูกลบ)"""
    bus.publish("scenario", {"name": name, "etag": tag, "results_stale": results_stale})


def _engine_unchanged(store: ScenarioStore, name: str, doc: dict) -> bool:
    """เอกสารใหม่ให้ engine เห็นเหมือนไฟล์เดิมทุกอย่าง และ plan คำนวณได้ (มีโฟลเดอร์ snapshot) ตรวจไม่ได้ = False"""
    old = engine_view(store.path(name))
    if old is None:
        return False
    try:
        new = store.engine_view(name, doc)
    except (ApiError, GnssPredictError):                    # เอกสารไม่ผ่าน: `store.write` จะ raise ตัวเดียวกันตามลำดับของมัน
        return False
    return new == old and snapshot_identity(store.data_dir, old.orbit_snapshot) is not None


def write_tracked(store: ScenarioStore, bus: EventBus, plans: PlanCache, name: str, doc: dict,
                  if_match: str | None) -> tuple[str, bool]:
    """`store.write` แล้วส่ง event `scenario` คืน (ETag ใหม่, results_stale)

    fingerprint ก่อนเขียนอ่านจากไฟล์เดิมบนดิสก์ จึงต้องคำนวณก่อน `store.write` ผู้เรียกตรวจ If-Match กับเอกสารที่ตนใช้ก่อนเรียก
    (ให้ ETag เก่าได้ 412 ก่อนคำนวณอะไร) `store.write` ตรวจซ้ำใต้ล็อก ล้มเหลวทุกแบบ (404/412/422) raise ก่อนส่ง event"""
    if _engine_unchanged(store, name, doc):
        old_key = plans.key(name)
        tag = store.write(name, doc, if_match)
        plans.carry_over(old_key, tag)
        stale = False
    else:
        before = plans.fingerprint(name)
        tag = store.write(name, doc, if_match)
        stale = is_stale(before, plans.fingerprint(name))
    publish_scenario(bus, name, tag, stale)
    return tag, stale
