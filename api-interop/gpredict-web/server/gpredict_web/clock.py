"""นาฬิกาของ module (หัวข้อ 6.4 ของ spec)

ตามหน้าต่าง Time Controller ของ Gpredict ซึ่งไม่มีระดับความเร็ว มีแค่ Throttle 1-100 คูณกับสถานะ
Play forward / Play backwards / Stop

  forward   T = t_ref + throttle * (เวลาเครื่อง - wall_ref)
  backward  T = t_ref - throttle * (เวลาเครื่อง - wall_ref)
  stop      T = t_ref (คงที่)

เปลี่ยนสถานะหรือ throttle แล้วตั้ง t_ref = T ณ ตอนนั้นและ wall_ref = เวลาเครื่อง เวลาจึงไม่กระโดด
ใช้ lock เพราะ WebSocket loop กับ API handler เรียกจากคนละ thread
"""

import threading
from collections.abc import Callable
from datetime import datetime, timedelta, timezone

FORWARD, BACKWARD, STOP = "forward", "backward", "stop"
STATES = (FORWARD, BACKWARD, STOP)
THROTTLE_MIN, THROTTLE_MAX = 1, 100
CLOCK_MIN = datetime(1957, 10, 4, tzinfo=timezone.utc)      # นาฬิการับเวลาตั้งแต่ Sputnik 1
CLOCK_END = datetime(2101, 1, 1, tzinfo=timezone.utc)       # ถึงสิ้นปี 2100 (ไม่รวมค่านี้)

LABEL_REAL_TIME = "Real-Time"                          # ข้อความของ Gpredict ห้ามแก้
LABEL_SIMULATED = "Simulated Real-Time"
LABEL_MANUAL = "Manual Control"
REAL_TIME_TOLERANCE = timedelta(seconds=1)             # forward ที่ throttle 1 และ |T - เวลาเครื่อง| < 1 วินาที

_UTC = timezone.utc
_DIRECTION = {FORWARD: 1, BACKWARD: -1, STOP: 0}

# รูปแบบและช่วงของเวลาที่ API รับ (PUT clock และคำขอ pass) ผู้เรียกเติมชื่อช่องข้างหน้า เช่น "เวลา (time) ต้องเป็น " + ค่านี้
CLOCK_TIME_TEXT = (f"ISO 8601 ที่มี timezone (เช่น 2026-11-12T07:00:00.000Z) "
                   f"ระหว่าง {CLOCK_MIN:%Y-%m-%d} ถึง {CLOCK_END - timedelta(days=1):%Y-%m-%d} UTC")


def parse_clock_time(value: object) -> datetime:
    """เวลา ISO 8601 ที่มี timezone ในช่วง [CLOCK_MIN, CLOCK_END) แปลงเป็น UTC
    ไม่ใช่ข้อความ อ่านไม่ได้ ไม่มี timezone หรืออยู่นอกช่วง -> ValueError ที่ข้อความเป็น CLOCK_TIME_TEXT"""
    if not isinstance(value, str):
        raise ValueError(CLOCK_TIME_TEXT)
    try:
        t = datetime.fromisoformat(value)
        if t.tzinfo is None or t.utcoffset() is None:
            raise ValueError("ไม่มี timezone")
        t = t.astimezone(_UTC)
    except (ValueError, OverflowError):                   # OverflowError: offset ดันเวลาเลยปี 1 หรือ 9999
        raise ValueError(CLOCK_TIME_TEXT) from None
    if not CLOCK_MIN <= t < CLOCK_END:
        raise ValueError(CLOCK_TIME_TEXT)
    return t


def _check_state(state: object) -> str:
    if not isinstance(state, str) or state not in STATES:
        raise ValueError(f"สถานะนาฬิกาต้องเป็น forward, backward หรือ stop (ได้ {state!r})")
    return state


def _check_throttle(throttle: object) -> int:
    if isinstance(throttle, bool) or not isinstance(throttle, int):
        raise ValueError(f"throttle ต้องเป็นจำนวนเต็ม {THROTTLE_MIN}-{THROTTLE_MAX} (ได้ {throttle!r})")
    if not THROTTLE_MIN <= throttle <= THROTTLE_MAX:
        raise ValueError(f"throttle ต้องอยู่ระหว่าง {THROTTLE_MIN} ถึง {THROTTLE_MAX} (ได้ {throttle})")
    return throttle


def _check_time(time: object) -> datetime:
    if not isinstance(time, datetime) or time.tzinfo is None or time.utcoffset() is None:
        raise ValueError(f"เวลาต้องเป็น datetime ที่มี timezone (UTC) (ได้ {time!r})")
    return time.astimezone(_UTC)


class ModuleClock:
    """เวลาจำลองของ module หนึ่งตัว ทุก browser tab และ rotator ตามนาฬิกาเดียวกันนี้

    `now` คืนเวลาเครื่องเป็น datetime UTC ที่มี timezone (test ส่งนาฬิกาปลอม) เริ่มที่ Reset
    """

    def __init__(self, now: Callable[[], datetime]):
        self._now = now
        self._lock = threading.RLock()
        self._reset_to(now())

    @property
    def state(self) -> str:
        with self._lock:
            return self._state

    @property
    def throttle(self) -> int:
        with self._lock:
            return self._throttle

    def time(self) -> datetime:
        """เวลาจำลอง T ตอนนี้ (UTC)"""
        with self._lock:
            return self._time_at(self._now())

    def set(self, state: str | None = None, throttle: int | None = None, time: datetime | None = None) -> None:
        """เปลี่ยนสถานะ throttle หรือเวลา (None คือไม่เปลี่ยน) ค่าผิด -> ValueError และไม่เปลี่ยนอะไรเลย

        เวลาไม่กระโดดตอนเปลี่ยนสถานะหรือ throttle ส่วน time ตั้งเวลาจำลองใหม่ (ใช้ตอน stop จากปฏิทิน, Hour/Min/Sec/Msec
        และ slider) ถ้าส่งมาตอนกำลังเดินก็เดินต่อจากเวลานั้นด้วย throttle เดิม
        """
        new_state = None if state is None else _check_state(state)
        new_throttle = None if throttle is None else _check_throttle(throttle)
        new_time = None if time is None else _check_time(time)
        with self._lock:
            wall = self._now()
            current = self._time_at(wall)
            if new_state is not None:
                self._state = new_state
            if new_throttle is not None:
                self._throttle = new_throttle
            self._t_ref = current if new_time is None else new_time
            self._wall_ref = wall

    def reset(self) -> None:
        """forward, throttle 1, T = เวลาเครื่อง"""
        with self._lock:
            self._reset_to(self._now())

    def label(self) -> str:
        """ป้ายสถานะล่างซ้ายของหน้าต่าง Time Controller"""
        with self._lock:
            wall = self._now()
            return self._label_at(wall, self._time_at(wall))

    def snapshot(self) -> tuple[datetime, str, int, str]:
        """(T, state, throttle, label) จากเวลาเครื่องครั้งเดียวใต้ lock เดียว ค่าทั้งสี่จึงเข้ากันเสมอ (ใช้สร้าง tick)"""
        with self._lock:
            wall = self._now()
            t = self._time_at(wall)
            return t, self._state, self._throttle, self._label_at(wall, t)

    def direction(self) -> int:
        """+1 forward, -1 backward, 0 stop (ใช้เลือกทิศของหน้าต่าง ephemeris)"""
        with self._lock:
            return _DIRECTION[self._state]

    def _reset_to(self, wall: datetime) -> None:
        self._state, self._throttle = FORWARD, THROTTLE_MIN
        self._t_ref = self._wall_ref = wall

    def _label_at(self, wall: datetime, t: datetime) -> str:
        if self._state == STOP:
            return LABEL_MANUAL
        if self._state == FORWARD and self._throttle == THROTTLE_MIN and abs(t - wall) < REAL_TIME_TOLERANCE:
            return LABEL_REAL_TIME
        return LABEL_SIMULATED

    def _time_at(self, wall: datetime) -> datetime:
        if self._state == STOP:
            return self._t_ref
        elapsed = (wall - self._wall_ref) * self._throttle         # timedelta * int คำนวณแม่นเป็นไมโครวินาที
        return self._t_ref + elapsed if self._state == FORWARD else self._t_ref - elapsed
