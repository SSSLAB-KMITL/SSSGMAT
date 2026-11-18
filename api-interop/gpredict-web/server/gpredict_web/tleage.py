"""ตรวจอายุ TLE ทุก 10 นาที แบบ Gpredict (ref-D §5.1, main.c:441-540; spec งานย่อย 4 §5.3)

- ไม่ตรวจตอนเริ่ม: รอบแรกอยู่หลังเปิด server ครบ TLE_CHECK_INTERVAL_S แล้วตรวจทุกช่วงนั้น (task อยู่ใน lifespan ของ app.py)
- อายุ = เวลาตอนนี้ − TLE/LAST_UPDATE เกินเกณฑ์ของ "Check the age of TLE data:" (Never ไม่เคยเกิน, Monthly 30 วัน, Weekly 7 วัน,
  Daily 1 วัน) ติดตั้งใหม่ (LAST_UPDATE 0) จึงเก่าเกินเสมอยกเว้น Never
- "If TLEs are too old:" "Notify me" ส่งเหตุการณ์ tle_old ครั้งเดียวต่อ checker (ต่อการเปิด server) ส่วน "Perform automatic update in
  the background" เรียก run_update ทุกครั้งที่ due: LAST_UPDATE ใหม่ถูกเก็บเฉพาะเมื่อ update มีดวงที่ updated หรือดวงใหม่ จึง due ต่อได้
  และกติกา 2 ชม. ต่อ source อยู่ที่ตัวดึง (tlesources) ไม่ใช่ที่นี่
- Preferences อ่านใหม่ทุกรอบ: เปลี่ยนความถี่หรือการกระทำมีผลรอบถัดไป
"""

from collections.abc import Callable, Mapping
from datetime import datetime

TLE_CHECK_INTERVAL_S = 600                         # main.c:163 timer 600000 ms
TLE_AGE_S = {1: 2592000, 2: 604800, 3: 86400}      # Monthly, Weekly, Daily (ของ Never ไม่มี: ไม่ตรวจ)
ACTION_BACKGROUND = 2                              # TLE/AUTO_UPDATE_ACTION: Perform automatic update in the background (อื่นๆ = Notify me)

# ข้อความของกล่องแจ้งเตือนของ Gpredict (Pango markup) ตัวอักษรตามต้นฉบับ รวมที่ว่า "Update TLE" ไม่ตรงกับชื่อเมนู (ref-D §5.1)
TLE_OLD_TEXT = "Your TLE files are getting out of date.\nYou can update them by selecting\n<b>Edit -> Update TLE</b>\nin the menubar."


def tle_due(values: Mapping, now: datetime) -> bool:
    """TLE เก่าเกินเกณฑ์แล้วหรือยัง: อายุต้องมากกว่าเกณฑ์ (เท่าเกณฑ์ยังไม่ due) Never ไม่เคย"""
    limit = TLE_AGE_S.get(values["TLE/AUTO_UPDATE_FREQ"])
    if limit is None:
        return False
    return now.timestamp() - values["TLE/LAST_UPDATE"] > limit


class TleAgeChecker:
    """หนึ่งรอบตรวจ (check) ต่อหนึ่งครั้งที่ task เรียก: ทำงานใน thread (run_update ดึงจากเน็ตได้) ครั้งละหนึ่งรอบ
    values: Preferences ปัจจุบัน, run_update: Update TLE data from network, publish: ส่งเหตุการณ์ไปยัง /ws/app
    (app ส่ง AppEvents.publish_or_hold: คำเตือนไม่หายเมื่อยังไม่มี browser) run_update ที่ล้ม raise ออกจาก check (task บันทึกแล้วตรวจรอบต่อไป)"""

    def __init__(self, values: Callable[[], Mapping], run_update: Callable[[], object], publish: Callable[[dict], None],
                 now: Callable[[], datetime]):
        self._values = values
        self._run_update = run_update
        self._publish = publish
        self._now = now
        self._notified = False

    def check(self) -> str:
        """ผลของรอบนี้: "none" (ไม่ due หรือแจ้งไปแล้ว), "notified" (ส่ง tle_old ครั้งแรก) หรือ "updated" (เรียก run_update แล้ว)"""
        values = self._values()
        if not tle_due(values, self._now()):
            return "none"
        if values["TLE/AUTO_UPDATE_ACTION"] == ACTION_BACKGROUND:
            self._run_update()
            return "updated"
        if self._notified:
            return "none"
        self._notified = True
        self._publish({"type": "tle_old", "text": TLE_OLD_TEXT})
        return "notified"
