"""Pass predictions กับ GMAT จริง (spec §11 ของงานย่อย 2) ผ่าน HTTP ของแอปจริง (create_app + EphemManager ที่มี worker thread)

- Future passes ของ ISS (TLE คงที่ ISS ของ test_integration_gmat) ที่ THBK 3 วันเริ่มที่ epoch ของ TLE: ทุก pass ที่ได้
  เทียบกับ GMAT ที่รันอีกครั้งทุก 1 วินาทีในช่วง AOS − 120 s ถึง LOS + 120 s: AOS/LOS ต่างไม่เกิน 1 วินาที, Max El ต่างไม่เกิน 0.01°
- Sky at a glance ของ module 10 ดวง (TLE จริงของกลุ่ม amateur epoch 10–11 พ.ย. 2026 คัดลอกจาก data/satdb.json ไว้ในไฟล์นี้ ไม่ใช้เน็ต):
  ตอบ computing ก่อน แล้ว ok หลังรอ GMAT ทุก pass อยู่ในช่วง 8 ชม. ยกเว้น pass สุดท้ายของดาวแต่ละดวงตามกติกาเลื่อนช่วง (ref-P §7.2)

ข้ามเฉพาะเมื่อหา GmatConsole ไม่เจอ (ตั้ง GMAT_BIN หรือ build ที่ application/bin) ไม่ข้ามเพราะเหตุอื่น
"""

import math
import sys
import time
import unittest
from datetime import datetime, timedelta, timezone
from urllib.error import URLError

from fastapi.testclient import TestClient

from gpredict_web.app import create_app
from gpredict_web.config import GMAT_TIMEOUT_S
from gpredict_web.ephem import EphemManager
from gpredict_web.observe import qth_geo
from gpredict_web.pass_service import name_sort_key
from gpredict_web.satdb import SatRecord
from gpredict_web.store import Qth, Store
from gnss_predict import config as engine_config
from gnss_predict.errors import GmatNotFoundError
from gnss_predict.geometry import ecef_to_aer
from gnss_predict.propagate import propagate
from gnss_predict.run_gmat import find_gmat_console
from tests.helpers import TEST_HOSTS, FakeNow, temp_config
from tests.test_integration_gmat import EPOCH, ISS
from tests.test_pass_service import write_satdb
from tests.test_runtime import iso, parse_iso

UTC = timezone.utc

try:
    CONSOLE = find_gmat_console()
except GmatNotFoundError:
    CONSOLE = None

# เกณฑ์ของ spec §11 (ห้ามผ่อน)
MAX_AOS_LOS_S = 1.0
MAX_EL_DEG = 0.01

PAD_S = 120                                  # GMAT รายวินาทีเริ่มก่อน AOS และจบหลัง LOS เท่านี้
DIRECT_STEP_S = 1
MIN_ELEV_DEG = 5                             # ค่าตั้งต้นของ Minimum elevation
LOOK_AHEAD_D = 3                             # ค่าตั้งต้นของ Passes should occur within
NUMBER_OF_PASSES = 10                        # ค่าตั้งต้นของ Number of passes to predict
SKY_HOURS = 8                                # ค่าตั้งต้นของ Sky at a glance
WAIT_S = GMAT_TIMEOUT_S                      # รอ GMAT ของ Sky at a glance ได้นานเท่านี้

THBK = Qth("THBK", location="Bangkok, Thailand", lat_deg=engine_config.THBK_LAT_DEG,
           lon_deg=engine_config.THBK_LON_DEG, alt_m=engine_config.THBK_HEIGHT_M)

# TLE จริงของกลุ่ม amateur (CelesTrak, epoch 10–11 พ.ย. 2026) ความเอียง 20°–102° mean motion 12.4–15.6 รอบ/วัน
SKY_TLES = (
    (25544, "ISS (ZARYA)", "1 25544U 98067A   26315.85209533  .00008096  00000+0  15318-3 0  9995",
     "2 25544  51.6324 289.3631 0007313  15.2015 344.9192 15.49321770594642"),
    (7530, "OSCAR 7 (AO-7)", "1 07530U 74089B   26315.94032506 -.00000041  00000+0  36735-4 0  9992",
     "2 07530 101.9875 330.7132 0012130 208.4955 267.2325 12.53700540379033"),
    (27607, "SAUDISAT 1C (SO-50)", "1 27607U 02058C   26315.81862307  .00001599  00000+0  20507-3 0  9999",
     "2 27607  64.5538  32.1248 0068174 235.1743 124.2938 14.83330953286358"),
    (24278, "JAS-2 (FO-29)", "1 24278U 96046B   26315.36593726  .00000001  00000+0  34090-4 0  9996",
     "2 24278  98.5107 144.0298 0350831  74.4938 289.4649 13.53280804493077"),
    (40967, "FOX-1A (AO-85)", "1 40967U 15058D   26315.81487601  .00003001  00000+0  25768-3 0  9991",
     "2 40967  64.7731 179.9222 0144855   2.7186 357.4679 14.91710764135582"),
    (37839, "JUGNU", "1 37839U 11058B   26315.89382847  .00000428  00000+0  83871-4 0  9995",
     "2 37839  19.9590 131.0189 0018499 268.0144 243.9513 14.13815004779955"),
    (62394, "CROCUBE", "1 62394U 24247T   26315.56660013  .00077656  00000+0  88052-3 0  9993",
     "2 62394  44.9652 141.7582 0011111 232.9844 127.0035 15.61425023106274"),
    (26931, "PCSAT (NO-44)", "1 26931U 01043C   26315.81010205  .00000159  00000+0  90002-4 0  9992",
     "2 26931  67.0508 222.4346 0006292 277.3088  82.7299 14.32002536311587"),
    (44909, "RS-44 & BREEZE-KM R/B", "1 44909U 19096E   26315.84343400  .00000022  00000+0  40790-4 0  9991",
     "2 44909  82.5219 241.5735 0217799 158.8535 202.1744 12.79749794321232"),
    (50466, "XW-3 (CAS-9)", "1 50466U 21131B   26315.98110778  .00000412  00000+0  14042-3 0  9997",
     "2 50466  98.4976  47.5609 0004515  30.0094 330.1353 14.41469172256402"),
)
SKY_T0 = datetime(2026, 11, 11, 12, 0, tzinfo=UTC)


def _no_network(request, timeout=None):
    raise URLError("test ห้ามใช้เน็ต")


def _record(norad: int, name: str, tle_lines: tuple[str, str], epoch: datetime) -> SatRecord:
    return SatRecord(norad, name, ["amateur"], tle_lines, epoch, epoch)


def _crossings(times: list[datetime], els: list[float], rising: bool) -> list[datetime]:
    """เวลาที่ El ข้าม 0° ระหว่างสองตัวอย่างห่างกัน 1 วินาที (เชิงเส้น)"""
    out = []
    for i in range(len(els) - 1):
        e0, e1 = els[i], els[i + 1]
        if (e0 < 0.0 <= e1) if rising else (e0 >= 0.0 > e1):
            out.append(times[i] + timedelta(seconds=-e0 / (e1 - e0)))
    return out


def _peak(els: list[float]) -> float:
    """El สูงสุดจากตัวอย่างรายวินาที: จุดยอดของพาราโบลาผ่านตัวอย่างสูงสุดและสองตัวข้างเคียง"""
    i = max(range(len(els)), key=els.__getitem__)
    if i == 0 or i == len(els) - 1:
        return els[i]
    y0, y1, y2 = els[i - 1], els[i], els[i + 1]
    curvature = y0 - 2.0 * y1 + y2
    if curvature >= 0.0:
        return y1
    offset = 0.5 * (y0 - y2) / curvature
    return y1 - 0.25 * (y0 - y2) * offset


class _AppTest(unittest.TestCase):
    """app จริงบน data dir ชั่วคราว: สถานี THBK (ตั้งต้น), EphemManager ที่รัน GMAT จริงใน worker thread และนาฬิกาเครื่องปลอม"""

    @classmethod
    def start_app(cls, records: list[SatRecord], wall: datetime) -> None:
        cls.cfg = temp_config()
        store = Store(cls.cfg.data_dir)
        store.put_qth(THBK)
        store.set_default_qth("THBK")
        write_satdb(cls.cfg.data_dir / "satdb.json", records)
        ephem = EphemManager(cls.cfg, find_console=lambda: CONSOLE, start_worker=True)
        app = create_app(cls.cfg, start_background=False, opener=_no_network, now=FakeNow(wall), ephem=ephem,
                         allowed_hosts=TEST_HOSTS)
        cls.client = TestClient(app)
        cls.client.__enter__()
        cls.addClassCleanup(cls.client.__exit__, None, None, None)      # ปิด module และ kill GMAT ที่ค้าง

    @classmethod
    def open_module(cls, name: str, norads: list[int]) -> None:
        r = cls.client.put(f"/api/modules/{name}", json={"name": name, "qth": "THBK", "satellites": norads})
        if r.status_code != 200:
            raise AssertionError(r.text)
        r = cls.client.post(f"/api/modules/{name}/open")
        if r.status_code != 200:
            raise AssertionError(r.text)


@unittest.skipUnless(CONSOLE is not None, "ไม่พบ GmatConsole (ตั้ง GMAT_BIN หรือ build GMAT ก่อน)")
class FuturePassesVsGmatTest(_AppTest):
    @classmethod
    def setUpClass(cls):
        cls.start_app([_record(ISS.norad, "ISS", ISS.tle_lines, EPOCH)], EPOCH)
        cls.open_module("ISS", [ISS.norad])
        started = time.monotonic()
        r = cls.client.post("/api/modules/ISS/passes", json={"norad": ISS.norad, "kind": "future", "t": iso(EPOCH)})
        cls.request_s = time.monotonic() - started
        if r.status_code != 200 or "passes" not in r.json():
            raise AssertionError(f"Future passes ของ ISS ไม่ได้รายการ pass: {r.status_code} {r.text[:500]}")
        cls.passes = r.json()["passes"]
        cls.q = qth_geo(THBK)
        cls.reference = [cls._gmat_per_second(k, p) for k, p in enumerate(cls.passes)]
        cls._print_summary()

    @classmethod
    def _gmat_per_second(cls, k: int, p: dict) -> dict:
        """GMAT รายวินาทีของ ISS ในช่วงวินาทีเต็ม floor(AOS) − PAD_S ถึง ceil(LOS) + PAD_S ของ pass ที่ k"""
        aos, los = parse_iso(p["aos"]), parse_iso(p["los"])
        start = aos.replace(microsecond=0) - timedelta(seconds=PAD_S)
        stop = los.replace(microsecond=0) + timedelta(seconds=PAD_S + 1)
        eph, messages = propagate([ISS], start, stop, DIRECT_STEP_S, cls.cfg.data_dir / "direct" / f"pass{k}",
                                  CONSOLE, timeout_s=GMAT_TIMEOUT_S)
        if messages or ISS.prn not in eph.positions_km:
            raise AssertionError(f"GMAT รายวินาทีของ pass {k} ไม่คืนค่า: {messages}")
        q = cls.q
        els = [ecef_to_aer(r, q.ecef_km, q.lat_deg, q.lon_deg)[1] for r in eph.positions_km[ISS.prn]]
        return {"rising": _crossings(eph.times_utc, els, True), "setting": _crossings(eph.times_utc, els, False),
                "max_el": _peak(els)}

    @classmethod
    def _print_summary(cls) -> None:
        print(f"\n[Future passes ISS @ THBK from {iso(EPOCH)} vs GMAT 1 s] {len(cls.passes)} passes, "
              f"request {cls.request_s:.1f} s", file=sys.stderr)
        for p, ref in zip(cls.passes, cls.reference):
            aos, los = parse_iso(p["aos"]), parse_iso(p["los"])
            d_aos = min((abs((t - aos).total_seconds()) for t in ref["rising"]), default=math.inf)
            d_los = min((abs((t - los).total_seconds()) for t in ref["setting"]), default=math.inf)
            print(f"  AOS {p['aos']} LOS {p['los']} Max El {p['max_el']:6.2f}: "
                  f"AOS err {d_aos:.4f} s, LOS err {d_los:.4f} s, Max El err {abs(p['max_el'] - ref['max_el']):.2e} deg",
                  file=sys.stderr)

    def test_iss_future_passes_match_gmat_per_second(self):
        passes = self.passes
        self.assertTrue(0 < len(passes) <= NUMBER_OF_PASSES, len(passes))
        end = EPOCH + timedelta(days=LOOK_AHEAD_D)
        aos_list = [parse_iso(p["aos"]) for p in passes]
        self.assertEqual(aos_list, sorted(aos_list))
        for k, (p, ref) in enumerate(zip(passes, self.reference)):
            with self.subTest(pass_=k, aos=p["aos"]):
                aos, los = parse_iso(p["aos"]), parse_iso(p["los"])
                self.assertGreaterEqual(p["max_el"], MIN_ELEV_DEG)
                if k < len(passes) - 1:                               # กติกาเลื่อนช่วง: เฉพาะ pass สุดท้ายเกินช่วงได้
                    self.assertLessEqual(aos, end)
                self.assertEqual(len(ref["rising"]), 1, ref["rising"])     # ช่วงเทียบมี pass เดียว
                self.assertEqual(len(ref["setting"]), 1, ref["setting"])
                self.assertLessEqual(abs((ref["rising"][0] - aos).total_seconds()), MAX_AOS_LOS_S)
                self.assertLessEqual(abs((ref["setting"][0] - los).total_seconds()), MAX_AOS_LOS_S)
                self.assertLessEqual(abs(p["max_el"] - ref["max_el"]), MAX_EL_DEG)
                self.assertEqual((p["rows"][0]["t"], p["rows"][-1]["t"]), (p["aos"], p["los"]))


@unittest.skipUnless(CONSOLE is not None, "ไม่พบ GmatConsole (ตั้ง GMAT_BIN หรือ build GMAT ก่อน)")
class SkyGlanceTenSatellitesTest(_AppTest):
    @classmethod
    def setUpClass(cls):
        records = [_record(n, name, (l1, l2), SKY_T0) for n, name, l1, l2 in SKY_TLES]
        cls.start_app(records, SKY_T0)
        cls.open_module("Sky10", [n for n, *_ in SKY_TLES])
        url = f"/api/modules/Sky10/skyglance?t={iso(SKY_T0)}"
        started = time.monotonic()
        cls.answers = [cls._get(url)]
        while cls.answers[-1]["status"] == "computing" and time.monotonic() - started < WAIT_S:
            time.sleep(1.0)                                           # หน้าเว็บถามซ้ำทุก 1 วินาทีแบบเดียวกัน
            cls.answers.append(cls._get(url))
        cls.wait_s = time.monotonic() - started
        cls.sky = cls.answers[-1]
        print(f"\n[Sky at a glance 10 sats @ THBK from {iso(SKY_T0)}] status {cls.sky['status']} after "
              f"{cls.wait_s:.1f} s ({len(cls.answers)} requests)", file=sys.stderr)
        for s in cls.sky.get("sats", []):
            print(f"  {s['name']:24s} {s['colour']} " + ", ".join(f"{p['aos'][11:19]}-{p['los'][11:19]} {p['max_el']:.1f}"
                                                              for p in s["passes"]), file=sys.stderr)

    @classmethod
    def _get(cls, url: str) -> dict:
        r = cls.client.get(url)
        if r.status_code != 200:
            raise AssertionError(f"GET skyglance: {r.status_code} {r.text[:500]}")
        return r.json()

    def test_sky_glance_ten_satellites(self):
        self.assertEqual(self.answers[0]["status"], "computing")                    # ยังไม่มี block ใน data dir ใหม่
        self.assertEqual(self.sky["status"], "ok", self.sky.get("messages"))
        self.assertEqual(self.sky["messages"], [])
        self.assertEqual((self.sky["t0"], self.sky["hours"]), (iso(SKY_T0), SKY_HOURS))
        sats = self.sky["sats"]
        self.assertEqual(len(sats), len(SKY_TLES))
        self.assertEqual([s["name"] for s in sats],
                         sorted((name for _, name, *_ in SKY_TLES), key=name_sort_key))
        end = SKY_T0 + timedelta(hours=SKY_HOURS)
        with_passes = 0
        for s in sats:
            with self.subTest(s["name"]):
                passes = s["passes"]
                with_passes += bool(passes)
                aos_list = [parse_iso(p["aos"]) for p in passes]
                self.assertEqual(aos_list, sorted(aos_list))
                for k, p in enumerate(passes):
                    aos, los = parse_iso(p["aos"]), parse_iso(p["los"])
                    self.assertGreater(los, SKY_T0)
                    self.assertGreaterEqual(p["max_el"], MIN_ELEV_DEG)
                    self.assertNotIn("rows", p)
                    if k < len(passes) - 1:                           # กติกาเลื่อนช่วง: เฉพาะ pass สุดท้ายเกินช่วงได้
                        self.assertLessEqual(aos, end)
                    else:
                        self.assertLessEqual(aos, end + timedelta(hours=SKY_HOURS))
        self.assertGreaterEqual(with_passes, 8)                       # ดาว LEO เกือบทุกดวงผ่าน THBK ใน 8 ชม.


if __name__ == "__main__":
    unittest.main()
