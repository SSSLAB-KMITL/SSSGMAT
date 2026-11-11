"""ความแม่นของ interpolation และ AOS/LOS เทียบกับ GMAT จริง (หัวข้อ 9.2 ของ spec)

ช่วง 16 ชม. ทุก 30 วินาทีผ่าน EphemManager (เหมือนที่แอปใช้) แล้ว interpolate เทียบกับ GMAT ที่รันตรงทุก 1 วินาที
ในช่วง 2 ชม. ที่ครอบ pass แรกของ ISS ที่ THBK ของ ISS, GEO และ Molniya (เทียบทุกวินาที):
ตำแหน่ง <= 10 ม., Az/El <= 0.01° (เฉพาะที่ El > 0), range rate <= 0.1 ม./วินาที, AOS/LOS ของ ISS <= 1 วินาที

ข้ามเฉพาะเมื่อหา GmatConsole ไม่เจอ (ตั้ง GMAT_BIN หรือ build ที่ application/bin) ไม่ข้ามเพราะเหตุอื่น
"""

import math
import sys
import unittest
from datetime import datetime, timedelta, timezone

from gpredict_web.config import GMAT_TIMEOUT_S, STEP_S
from gpredict_web.ephem import EphemManager, SatSpec, window_for
from gpredict_web.observe import observe, parse_tle, qth_geo
from gpredict_web.passes import find_passes, usable_span
from gpredict_web.satdb import gmat_name
from gpredict_web.store import Qth
from gnss_predict import config as engine_config
from gnss_predict.errors import GmatNotFoundError
from gnss_predict.geometry import ecef_to_aer
from gnss_predict.propagate import propagate
from gnss_predict.run_gmat import find_gmat_console
from gnss_predict.tle_fetch import tle_checksum
from tests.helpers import temp_config

UTC = timezone.utc

try:
    CONSOLE = find_gmat_console()
except GmatNotFoundError:
    CONSOLE = None

# เกณฑ์ตามหัวข้อ 9.2 (ห้ามผ่อน)
MAX_POSITION_M = 10.0
MAX_ANGLE_DEG = 0.01
MAX_RANGE_RATE_MS = 0.1
MAX_AOS_LOS_S = 1.0

SPAN_S = 2 * 3600
DIRECT_STEP_S = 1
OWNER = "integration"


# ---------------------------------------------------------------- TLE

def _line1(norad: int, designator: str, ndot: str, bstar: str) -> str:
    body = f"1 {norad:05d}U {designator:<8} 26313.50000000 {ndot}  00000+0 {bstar} 0  999"
    return _checked(body)


def _line2(norad: int, inc: float, raan: float, ecc: str, argp: float, mean_anomaly: float, n: float) -> str:
    body = (f"2 {norad:05d} {inc:8.4f} {raan:8.4f} {ecc} {argp:8.4f} {mean_anomaly:8.4f} {n:11.8f}"
            f"{1:05d}")
    return _checked(body)


def _checked(body: str) -> str:
    """body 68 ตัวอักษร + checksum ของ tle_fetch.tle_checksum"""
    assert len(body) == 68, (len(body), body)
    return body + str(tle_checksum(body))


def _spec(norad: int, designator: str, ndot: str, bstar: str, inc: float, raan: float, ecc: str,
          argp: float, mean_anomaly: float, n: float) -> SatSpec:
    return SatSpec(norad, gmat_name(norad), (_line1(norad, designator, ndot, bstar),
                                              _line2(norad, inc, raan, ecc, argp, mean_anomaly, n)))


# epoch ของทั้งสามดวงคือ 26313.50000000 (9 พ.ย. 2026 12:00 UTC)
ISS = _spec(25544, "98067A", " .00016717", " 30164-3", 51.64, 208.9163, "0006317", 69.9862, 25.2906, 15.49438945)
GEO = _spec(90001, "26001A", " .00000000", " 00000+0", 0.05, 90.0, "0001000", 270.0, 180.0, 1.00271)
MOLNIYA = _spec(90002, "26002A", " .00000000", " 00000+0", 63.4, 120.0, "7000000", 270.0, 0.0, 2.006)
SPECS = [ISS, GEO, MOLNIYA]
NAMES = {ISS.prn: "ISS", GEO.prn: "GEO", MOLNIYA.prn: "Molniya"}


def _angle_diff_deg(a: float, b: float) -> float:
    d = abs(a - b) % 360.0
    return min(d, 360.0 - d)


def _crossing(t0: datetime, e0: float, e1: float) -> datetime:
    """เวลาที่ El ข้าม 0° ระหว่างสองตัวอย่างห่างกัน 1 วินาที (เชิงเส้น)"""
    return t0 + timedelta(seconds=-e0 / (e1 - e0))


def _nearest(times: list[datetime], t: datetime) -> datetime:
    return min(times, key=lambda x: abs((x - t).total_seconds()))


@unittest.skipUnless(CONSOLE is not None, "ไม่พบ GmatConsole (ตั้ง GMAT_BIN หรือ build GMAT ก่อน)")
class InterpolationVsGmatTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cfg = temp_config()
        qth = Qth("THBK", lat_deg=engine_config.THBK_LAT_DEG, lon_deg=engine_config.THBK_LON_DEG,
                  alt_m=engine_config.THBK_HEIGHT_M)
        cls.qth = qth_geo(qth)

        # 1. ช่วง 16 ชม. ทุก 30 วินาทีผ่าน EphemManager แล้วหา pass แรกของ ISS
        #    T เลือกให้ pass แรกสูง (Max El ราว 48°) และ Molniya อยู่เหนือขอบฟ้าตลอดช่วงเทียบ เพื่อให้เกณฑ์ Az/El มีค่าให้เทียบจริง
        #    (GEO ตามที่กำหนดอยู่ใต้ขอบฟ้าของ THBK ที่ราว -61° ตลอดเวลา จึงเทียบ Az/El ไม่ได้ ตรวจแค่ตำแหน่งกับ range rate)
        cls.window = window_for(datetime(2026, 11, 10, 5, 0, tzinfo=UTC), 1)
        manager = EphemManager(cfg, find_console=lambda: CONSOLE, start_worker=False)
        cls.addClassCleanup(manager.close)
        manager.ensure(OWNER, SPECS, cls.window)
        manager.drain()
        cls.status = manager.status(OWNER, cls.window)
        cls.ephems = {s.prn: manager.get(s, cls.window) for s in SPECS}
        if cls.status != ("ok", []) or any(e is None for e in cls.ephems.values()):
            raise AssertionError(f"ช่วง 16 ชม. ไม่พร้อม: status={cls.status}")

        iss_ephem = cls.ephems[ISS.prn]
        cls.passes = find_passes(iss_ephem, cls.qth)
        cls.iss_pass = next((p for p in cls.passes if p.aos is not None and p.los is not None), None)
        if cls.iss_pass is None:
            raise AssertionError(f"ไม่พบ pass ของ ISS ที่รู้ทั้ง AOS และ LOS ในช่วง {cls.window}: {cls.passes}")

        # 2. GMAT ตรงทุก 1 วินาที 2 ชม. ที่ครอบ pass นั้น (วินาทีเต็ม ปลายทั้งสองอยู่ในช่วงที่ interpolate ได้)
        lo, hi = usable_span(iss_ephem)
        mid = cls.iss_pass.aos + (cls.iss_pass.los - cls.iss_pass.aos) / 2
        start = mid.replace(microsecond=0) - timedelta(seconds=SPAN_S // 2)
        start = min(max(start, lo), hi - timedelta(seconds=SPAN_S))
        cls.span = (start, start + timedelta(seconds=SPAN_S))
        eph, messages = propagate(SPECS, cls.span[0], cls.span[1], DIRECT_STEP_S, cfg.data_dir / "direct",
                                  CONSOLE, timeout_s=GMAT_TIMEOUT_S, with_velocity=True)
        if messages or eph.velocities_kms is None:
            raise AssertionError(f"GMAT รายวินาทีไม่คืนครบทุกดวง: {messages}")
        cls.direct = eph

        # 3. เทียบทุกวินาทีทั้ง 3 ดวงด้วย observe() ตัวเดียวกับที่แอปใช้
        cls.metrics = {s.prn: cls._compare(s) for s in SPECS}
        cls.aos_los = cls._aos_los_error()
        cls._print_summary()

    @classmethod
    def _compare(cls, spec: SatSpec) -> dict:
        elements = parse_tle(spec.tle_lines)
        ephem = cls.ephems[spec.prn]
        positions = cls.direct.positions_km[spec.prn]
        velocities = cls.direct.velocities_kms[spec.prn]
        m = {"samples": 0, "visible": 0, "pos_m": 0.0, "az_deg": 0.0, "el_deg": 0.0, "rate_ms": 0.0,
             "max_el_deg": -90.0}
        for t, r_gmat, v_gmat in zip(cls.direct.times_utc, positions, velocities):
            state = ephem.state_at(t)
            if state is None:
                raise AssertionError(f"{NAMES[spec.prn]}: state_at({t}) คืน None ภายในช่วงที่ใช้ได้")
            ours = observe(state[0], state[1], t, cls.qth, elements, None)
            ref = observe(r_gmat, v_gmat, t, cls.qth, elements, None)
            m["samples"] += 1
            m["pos_m"] = max(m["pos_m"], math.dist(state[0], r_gmat) * 1000.0)
            m["rate_ms"] = max(m["rate_ms"], abs(ours["range_rate_kms"] - ref["range_rate_kms"]) * 1000.0)
            m["max_el_deg"] = max(m["max_el_deg"], ref["el"])
            if ref["el"] > 0.0:                                       # Az/El เทียบเฉพาะตอนดาวอยู่เหนือขอบฟ้า
                m["visible"] += 1
                m["az_deg"] = max(m["az_deg"], _angle_diff_deg(ours["az"], ref["az"]))
                m["el_deg"] = max(m["el_deg"], abs(ours["el"] - ref["el"]))
        return m

    @classmethod
    def _aos_los_error(cls) -> dict:
        """AOS/LOS ของ ISS (find_passes) เทียบกับจุดตัด 0° ของ El รายวินาทีจาก GMAT โดยเชิงเส้นระหว่างวินาที"""
        times = cls.direct.times_utc
        q = cls.qth
        els = [ecef_to_aer(r, q.ecef_km, q.lat_deg, q.lon_deg)[1] for r in cls.direct.positions_km[ISS.prn]]
        rising = [_crossing(times[i], els[i], els[i + 1]) for i in range(len(els) - 1) if els[i] < 0.0 <= els[i + 1]]
        setting = [_crossing(times[i], els[i], els[i + 1]) for i in range(len(els) - 1) if els[i] >= 0.0 > els[i + 1]]
        p = cls.iss_pass
        if not rising or not setting:
            return {"aos_s": math.inf, "los_s": math.inf, "rising": rising, "setting": setting}
        return {"aos_s": abs((_nearest(rising, p.aos) - p.aos).total_seconds()),
                "los_s": abs((_nearest(setting, p.los) - p.los).total_seconds()),
                "rising": rising, "setting": setting}

    @classmethod
    def _print_summary(cls) -> None:
        a, b = cls.span
        print(f"\n[GMAT 1 s vs interpolation 30 s] window {cls.window[0]:%FT%TZ}..{cls.window[1]:%FT%TZ}, "
              f"span {a:%FT%TZ}..{b:%FT%TZ}, ISS pass AOS {cls.iss_pass.aos:%T.%f} LOS {cls.iss_pass.los:%T.%f} "
              f"max El {cls.iss_pass.max_el:.2f}", file=sys.stderr)
        for s in SPECS:
            m = cls.metrics[s.prn]
            print(f"  {NAMES[s.prn]:8s} n={m['samples']} visible={m['visible']} max El {m['max_el_deg']:.2f}: "
                  f"pos {m['pos_m']:.4f} m, Az {m['az_deg']:.6f} deg, El {m['el_deg']:.6f} deg, "
                  f"range rate {m['rate_ms']:.6f} m/s", file=sys.stderr)
        print(f"  ISS AOS error {cls.aos_los['aos_s']:.4f} s, LOS error {cls.aos_los['los_s']:.4f} s",
              file=sys.stderr)

    # ---- ข้อกำหนดตั้งต้น

    def test_window_uses_the_production_grid(self):
        start, stop = self.window
        self.assertEqual((stop - start).total_seconds(), 16 * 3600)
        self.assertEqual(STEP_S, 30)
        self.assertEqual(len(self.ephems[ISS.prn].times), 16 * 3600 // STEP_S + 1)

    def test_span_covers_the_first_iss_pass_and_lies_in_the_usable_range(self):
        start, stop = self.span
        lo, hi = usable_span(self.ephems[ISS.prn])
        self.assertEqual((stop - start).total_seconds(), SPAN_S)
        self.assertTrue(lo <= start and stop <= hi, f"{self.span} ไม่อยู่ใน {(lo, hi)}")
        self.assertEqual(start.microsecond, 0)
        self.assertTrue(start <= self.iss_pass.aos < self.iss_pass.los <= stop)
        self.assertEqual(len(self.direct.times_utc), SPAN_S // DIRECT_STEP_S + 1)

    def test_iss_and_molniya_are_visible_so_the_az_el_comparison_is_not_vacuous(self):
        self.assertGreater(self.metrics[ISS.prn]["visible"], 60)
        self.assertGreater(self.metrics[MOLNIYA.prn]["visible"], 60)
        self.assertGreater(self.iss_pass.max_el, 10.0)

    # ---- เกณฑ์ความแม่น (ทุกวินาทีของช่วง 2 ชม. ทั้ง 3 ดวง)

    def test_position_within_10_m(self):
        for s in SPECS:
            with self.subTest(NAMES[s.prn]):
                self.assertLessEqual(self.metrics[s.prn]["pos_m"], MAX_POSITION_M)

    def test_az_el_within_0_01_deg_where_above_the_horizon(self):
        for s in SPECS:
            with self.subTest(NAMES[s.prn]):
                m = self.metrics[s.prn]
                self.assertLessEqual(m["az_deg"], MAX_ANGLE_DEG)
                self.assertLessEqual(m["el_deg"], MAX_ANGLE_DEG)

    def test_range_rate_within_0_1_m_per_s(self):
        for s in SPECS:
            with self.subTest(NAMES[s.prn]):
                self.assertLessEqual(self.metrics[s.prn]["rate_ms"], MAX_RANGE_RATE_MS)

    def test_iss_aos_and_los_within_1_s_of_the_1_s_gmat_crossings(self):
        self.assertTrue(self.aos_los["rising"] and self.aos_los["setting"], "GMAT รายวินาทีไม่มี pass ในช่วง")
        self.assertLessEqual(self.aos_los["aos_s"], MAX_AOS_LOS_S)
        self.assertLessEqual(self.aos_los["los_s"], MAX_AOS_LOS_S)


if __name__ == "__main__":
    unittest.main()
