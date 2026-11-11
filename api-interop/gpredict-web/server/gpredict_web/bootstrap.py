"""การเปิด server ครั้งแรก (หัวข้อ 7.1 ของ spec)

- ไม่มี QTH เลย: สร้าง THBK จาก config.THBK_* ของ engine แล้วตั้งเป็นสถานีตั้งต้น
- ไม่มี module เลย: ดึงเฉพาะกลุ่ม amateur แล้วสร้างและเปิด module Amateur ที่ใช้ "** DEFAULT **" และมีดาวทุกดวงในกลุ่มนั้น
  (Gpredict เปิด module "Amateur" ตอนเริ่มครั้งแรก) ถ้าเกิน MAX_SATS ใช้ MAX_SATS ดวงแรกตามลำดับชื่อพร้อมคำเตือน
  ไม่มีดาวเลย (ไม่มีเน็ตและไม่มี OMM cache): ไม่สร้าง module และบอกผู้ใช้ให้ Update TLE เอง ไม่ใช่ server ล้ม
- เรียกซ้ำเมื่อมีทั้ง QTH และ module แล้วไม่เปลี่ยนอะไรและไม่ส่ง request
"""

from datetime import datetime
from urllib.request import urlopen

from gnss_predict import config as engine_config
from gnss_predict.errors import Message

from .config import MAX_SATS, Config
from .module import module_from_dict
from .satdb import SatDb, update_from_network
from .store import Qth, Store

THBK_NAME = "THBK"
AMATEUR_GROUP = "amateur"
AMATEUR_MODULE = "Amateur"
_ALL = 1_000_000                       # ไม่จำกัดจำนวนตอนค้นดาวทั้งกลุ่ม (ตัดเองตาม MAX_SATS)


def bootstrap(store: Store, satdb: SatDb, cfg: Config, now: datetime, opener=urlopen) -> list[Message]:
    """เตรียม QTH และ module ตั้งต้น คืนข้อความถึงผู้ใช้ (ภาษาไทย) ที่หน้าเว็บแสดงตอนเปิด"""
    _ensure_station(store)
    if store.list_modules():
        return []

    result = update_from_network(satdb, cfg, now, groups=(AMATEUR_GROUP,), opener=opener)
    messages = list(result.messages)
    sats = satdb.search(group=AMATEUR_GROUP, limit=_ALL)          # เรียงตามชื่อแล้ว NORAD
    if not sats:
        messages.append(Message(
            "TLE_UPDATE_NEEDED", "warning",
            f"ยังไม่มีข้อมูลดาวกลุ่ม {AMATEUR_GROUP} (ดึงจากเน็ตไม่ได้และไม่มีไฟล์ใน cache) จึงยังไม่ได้สร้าง module "
            f"{AMATEUR_MODULE} เมื่อต่อเน็ตได้แล้วให้เลือก Edit → Update TLE data from network "
            "แล้วสร้าง module ด้วย File → New module"))
        return messages
    if len(sats) > MAX_SATS:
        messages.append(Message(
            "MODULE_TOO_MANY_SATS", "warning",
            f"กลุ่ม {AMATEUR_GROUP} มีดาว {len(sats)} ดวง แต่ module มีได้ไม่เกิน {MAX_SATS} ดวง "
            f"module {AMATEUR_MODULE} จึงมีเฉพาะ {MAX_SATS} ดวงแรกตามลำดับชื่อ", AMATEUR_MODULE))
        sats = sats[:MAX_SATS]

    module = module_from_dict({"name": AMATEUR_MODULE, "qth": None, "satellites": [r.norad for r in sats]},
                              set(store.qth_names()), satdb.norads())
    store.put_module(module)
    store.set_session([*store.session(), AMATEUR_MODULE])
    return messages


def _ensure_station(store: Store) -> None:
    """ไม่มี QTH: สร้าง THBK เป็นสถานีตั้งต้น มี QTH แต่ไม่มีสถานีตั้งต้น: ใช้ชื่อแรก (module "** DEFAULT **" จึงเปิดได้)"""
    names = store.qth_names()
    if not names:
        store.put_qth(Qth(name=THBK_NAME, location="Bangkok", lat_deg=engine_config.THBK_LAT_DEG,
                          lon_deg=engine_config.THBK_LON_DEG, alt_m=engine_config.THBK_HEIGHT_M))
        store.set_default_qth(THBK_NAME)
    elif store.default_qth() is None:
        store.set_default_qth(names[0])
