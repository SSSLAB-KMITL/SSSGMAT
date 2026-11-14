"""ตัวช่วย test: data dir, web dist และ OMM cache ชั่วคราวเสมอ (test ห้ามแตะ data จริงหรือใช้เน็ต)
และดาวสังเคราะห์วงกลมที่มีคำตอบแบบปิดสำหรับ test pass และ track"""

import atexit
import math
import shutil
import tempfile
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import TestCase

from gpredict_web.config import Config
from gpredict_web.ephem import SatEphem
from gpredict_web.observe import QthGeo


# Host ที่ TestClient ใช้ (testserver) ไม่อยู่ใน allow list ตั้งต้นของ server จริง test ส่งเข้า create_app(allowed_hosts=...) เอง
TEST_HOSTS = ("testserver", "127.0.0.1", "localhost", "::1")


def temp_config(testcase: TestCase | None = None) -> Config:
    """Config ที่ทุก path ชี้ไปใต้ temp dir เดียว ลบทิ้งเมื่อ test จบ (ส่ง testcase มา) หรือเมื่อโปรแกรมจบ"""
    root = Path(tempfile.mkdtemp(prefix="gpredict_web_test_"))
    if testcase is not None:
        testcase.addCleanup(shutil.rmtree, root, ignore_errors=True)
    else:
        atexit.register(shutil.rmtree, root, ignore_errors=True)
    return Config(data_dir=root / "data", web_dist=root / "web_dist", omm_cache_dir=root / "omm_cache")


def ws_receive_json(ws, timeout: float = 3.0):
    """WebSocketTestSession.receive_json ที่ไม่ค้างตลอดไป: ไม่ได้ข้อความภายใน timeout วินาที = test ล้ม (AssertionError)
    (thread ที่ยังรออยู่เป็น daemon และจบเองเมื่อ session ปิด)"""
    box: list = []

    def receive() -> None:
        try:
            box.append((True, ws.receive_json()))
        except BaseException as exc:                 # WebSocketDisconnect ฯลฯ: ส่งต่อให้ test
            box.append((False, exc))

    worker = threading.Thread(target=receive, daemon=True)
    worker.start()
    worker.join(timeout)
    if not box:
        raise AssertionError(f"ไม่ได้รับข้อความทาง WebSocket ภายใน {timeout} วินาที")
    ok, value = box[0]
    if not ok:
        raise value
    return value


# ---------------------------------------------------------------- ดาวสังเคราะห์สำหรับ test pass และ track
# วงกลมรัศมี 7000 กม. รอบโลกกลม ไม่คิดการหมุนของโลก (ตำแหน่งเป็น EarthFixed ตรงๆ) จึงมีคำตอบแบบปิดให้เทียบ

R_ORBIT_KM = 7000.0
MU_KM3S2 = 398600.4418
W_RAD_S = math.sqrt(MU_KM3S2 / R_ORBIT_KM ** 3)
PERIOD_S = 2.0 * math.pi / W_RAD_S
WGS84_A = 6378.137
WINDOW_START = datetime(2026, 11, 12, 5, 0, 0, tzinfo=timezone.utc)
WINDOW_HOURS = 16
STEP_S = 30


class FakeNow:
    """นาฬิกาเครื่องปลอมที่เลื่อนได้ (ส่งเป็น now ของ ModuleClock หรือ Hub)"""

    def __init__(self, start: datetime | None = None):
        self.t = WINDOW_START if start is None else start

    def __call__(self) -> datetime:
        return self.t

    def advance(self, seconds: float) -> None:
        self.t += timedelta(seconds=seconds)


def window_times(start: datetime = WINDOW_START, hours: int = WINDOW_HOURS, step: int = STEP_S) -> list[datetime]:
    return [start + timedelta(seconds=k * step) for k in range(hours * 3600 // step + 1)]


def circular_state(t_peak: datetime, beta_deg: float, t: datetime) -> tuple[tuple[float, float, float], tuple[float, float, float]]:
    """วงกลมที่จุดใกล้ทิศของ QTH (0°, 0°) ที่สุดเมื่อ t_peak ห่างจากทิศนั้น beta องศา
    r = R (cos(w τ) u + sin(w τ) w), u = (cos β, 0, sin β), w = (0, 1, 0), τ = t − t_peak
    β = 0 คือวงในระนาบศูนย์สูตร (ลองจิจูด = w τ) ผ่านเหนือ QTH พอดี"""
    b = math.radians(beta_deg)
    a = W_RAD_S * (t - t_peak).total_seconds()
    c, s = math.cos(a), math.sin(a)
    k = R_ORBIT_KM * W_RAD_S
    return ((R_ORBIT_KM * c * math.cos(b), R_ORBIT_KM * s, R_ORBIT_KM * c * math.sin(b)),
            (-k * s * math.cos(b), k * c, -k * s * math.sin(b)))


def circular_ephem(t_peak: datetime, beta_deg: float = 0.0, times: list[datetime] | None = None) -> SatEphem:
    times = window_times() if times is None else times
    states = [circular_state(t_peak, beta_deg, t) for t in times]
    return SatEphem(times, [p for p, _ in states], [v for _, v in states])


def fixed_ephem(position: tuple[float, float, float], times: list[datetime] | None = None) -> SatEphem:
    times = window_times() if times is None else times
    return SatEphem(times, [position] * len(times), [(0.0, 0.0, 0.0)] * len(times))


def origin_qth() -> QthGeo:
    """QTH ที่ (0°, 0°, 0 ม.) ทิศตั้งฉากพื้นที่นั่นคือแกน +x จึง El = 0 เมื่อ x ของดาว = 6378.137 พอดี"""
    return QthGeo("ORIGIN", "", 0.0, 0.0, 0.0, (WGS84_A, 0.0, 0.0))


def half_pass_s(beta_deg: float = 0.0) -> float:
    """ครึ่งหนึ่งของเวลาที่ดาวอยู่เหนือขอบฟ้า: acos((6378.137 / R) / cos β) / w"""
    return math.acos((WGS84_A / R_ORBIT_KM) / math.cos(math.radians(beta_deg))) / W_RAD_S
