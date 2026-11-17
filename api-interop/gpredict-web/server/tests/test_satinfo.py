"""Satellite Info -> "Orbit Info" (ref-D §8.1, sat-info.c): ค่าจาก TLE ที่ server ส่งให้หน้าเว็บจัดรูปแบบ
orbit_info อ่านคอลัมน์ตาม sgp_in.c (Convert_Satellite_Data) และ GET /api/satellites/{norad} ส่งต่อ"""

import json
import unittest
from datetime import datetime, timezone

from gpredict_web.satdb import SatRecord
from gpredict_web.satinfo import orbit_info
from gnss_predict.tle_fetch import tle_checksum
from tests.test_api import ApiTestBase
from tests.test_integration_gmat import ISS
from tests.test_runtime import iso

UTC = timezone.utc
ISS_EPOCH = datetime(2026, 11, 9, 12, 0, tzinfo=UTC)        # 26313.50000000 ของ TLE ISS ใน test_integration_gmat
INFO_KEYS = ["name", "status", "catnum", "intl_designator", "element_set", "epoch", "revnum", "incl_deg", "raan_deg",
             "ecc", "argp_deg", "ma_deg", "mean_motion", "ndot2", "nddot6", "bstar"]


def tle_lines(norad: int = 25544, desig: str = "98067A", epoch: str = "26313.50000000", ndot: str = " .00016717",
              nddot: str = " 00000+0", bstar: str = " 30164-3", elset: int = 999, ecc: str = "0006317",
              revnum: int = 1) -> tuple[str, str]:
    """TLE ที่ checksum ถูกต้อง ช่องที่แต่ละ test สนใจส่งทับได้ (คอลัมน์ตามมาตรฐาน)"""
    l1 = f"1 {norad:05d}U {desig:<8} {epoch:<14} {ndot:>10} {nddot:>8} {bstar:>8} 0 {elset:>4}"
    l2 = f"2 {norad:05d}  51.6400 208.9163 {ecc} 069.9862 025.2906 15.49438945{revnum:05d}"
    assert len(l1) == len(l2) == 68, (len(l1), len(l2))
    return l1 + str(tle_checksum(l1)), l2 + str(tle_checksum(l2))


def sat(lines, norad: int = 25544, status: str = "Unknown", name: str = "ISS (ZARYA)") -> SatRecord:
    return SatRecord(norad, name, ["amateur"], lines, ISS_EPOCH, ISS_EPOCH, status)


class OrbitInfoTest(unittest.TestCase):
    def test_orbit_info_iss(self):
        info = orbit_info(sat(ISS.tle_lines, status="Operational"))
        self.assertEqual(list(info), INFO_KEYS)
        self.assertEqual((info["name"], info["status"]), ("ISS (ZARYA)", "Operational"))
        self.assertEqual(info["catnum"], 25544)
        self.assertEqual(info["intl_designator"], "98067A  ")            # 8 ตัวดิบ คอลัมน์ 10-17 รวมช่องว่างท้าย
        self.assertEqual(info["element_set"], 999)
        self.assertEqual(info["epoch"], "2026-11-09T12:00:00.000Z")
        self.assertEqual(info["revnum"], 1)
        self.assertEqual((info["incl_deg"], info["raan_deg"], info["argp_deg"], info["ma_deg"]),
                         (51.64, 208.9163, 69.9862, 25.2906))
        self.assertEqual(info["ecc"], 0.0006317)
        self.assertEqual(info["mean_motion"], 15.49438945)
        self.assertEqual(info["ndot2"], 0.00016717)
        self.assertEqual(info["nddot6"], 0.0)
        self.assertAlmostEqual(info["bstar"], 0.30164e-3, places=15)       # ae = 1.0 จึง B* ตรงกับ TLE

    def test_ecc_clamped(self):
        self.assertEqual(orbit_info(sat(tle_lines(ecc="0000000")))["ecc"], 1e-06)
        self.assertEqual(orbit_info(sat(tle_lines(ecc="0000010")))["ecc"], 1e-06)       # เท่า 1e-6 พอดี
        self.assertEqual(orbit_info(sat(tle_lines(ecc="0000011")))["ecc"], 1.1e-06)     # สูงกว่าไม่ถูกแตะ

    def test_nddot6_and_element_set(self):
        info = orbit_info(sat(tle_lines(nddot="-11606-4", elset=7)))
        self.assertAlmostEqual(info["nddot6"], -0.11606e-4, places=15)               # คอลัมน์ 45-52 ทศนิยมสมมติ
        self.assertEqual(info["element_set"], 7)                                     # คอลัมน์ 65-68
        self.assertAlmostEqual(orbit_info(sat(tle_lines(nddot=" 67890+1")))["nddot6"], 6.789, places=12)
        self.assertEqual(orbit_info(sat(tle_lines(elset=0)))["element_set"], 0)

    def test_epoch_year_rule_is_parse_tle(self):
        """decision 12: ปีสองหลัก >= 57 เป็น 19xx (Gpredict อ่านเป็น 2000 + ปีเสมอ)"""
        self.assertEqual(orbit_info(sat(tle_lines(epoch="99365.25000000")))["epoch"], "1999-12-31T06:00:00.000Z")
        self.assertEqual(orbit_info(sat(tle_lines(epoch="57001.00000000")))["epoch"], "1957-01-01T00:00:00.000Z")
        self.assertEqual(orbit_info(sat(tle_lines(epoch="56001.00000000")))["epoch"], "2056-01-01T00:00:00.000Z")

    def test_catnum_is_the_record_norad(self):
        """(ของเรา) ดาว Alpha-5 มีคอลัมน์ 3-7 เป็นตัวอักษร (atoi ของ Gpredict ได้ 0) จึงใช้เลข NORAD ของดวงนั้น"""
        l1, l2 = tle_lines(norad=744)
        alpha5 = SatRecord(100744, "X", [], (l1[:2] + "A0744" + l1[7:], l2[:2] + "A0744" + l2[7:]), ISS_EPOCH, ISS_EPOCH)
        self.assertEqual(orbit_info(alpha5)["catnum"], 100744)

    def test_unreadable_tle_raises_value_error(self):
        with self.assertRaises(ValueError):
            orbit_info(sat(("1 25544U", "2 25544")))


class SatelliteInfoApiTest(ApiTestBase):
    def write_with_status(self, status: str, tle: tuple[str, str] | None = None) -> None:
        """ดัชนีดาวที่ NORAD 25544 มี TLE ของ ISS และสถานะที่กำหนด แล้วเปิด app ใหม่ (ApiTestBase.write_satdb ไม่เขียนสถานะ)"""
        lines = tle or ISS.tle_lines
        (self.cfg.data_dir / "satdb.json").write_text(json.dumps({"version": 1, "satellites": {"25544": {
            "name": "ISS (ZARYA)", "groups": ["amateur"], "tle": list(lines), "epoch": iso(ISS_EPOCH),
            "updated": iso(ISS_EPOCH), "status": status}}}), encoding="utf-8")
        self.client = self.enter(self.make_app())

    def test_satellite_api_has_status_and_info(self):
        self.write_with_status("Operational")
        body = self.client.get("/api/satellites/25544").json()
        self.assertEqual(list(body), ["norad", "name", "groups", "epoch", "updated", "tle", "status", "orbit_info"])
        self.assertEqual(body["status"], "Operational")
        self.assertEqual(body["tle"], list(ISS.tle_lines))
        info = body["orbit_info"]
        self.assertEqual(list(info), INFO_KEYS)
        self.assertEqual((info["name"], info["status"], info["catnum"]), ("ISS (ZARYA)", "Operational", 25544))
        self.assertEqual(info["intl_designator"], "98067A  ")
        self.assertEqual((info["incl_deg"], info["mean_motion"]), (51.64, 15.49438945))
        self.assertEqual(info["epoch"], "2026-11-09T12:00:00.000Z")

    def test_status_defaults_to_unknown(self):
        body = self.client.get("/api/satellites/25544").json()                 # ดัชนีของ ApiTestBase ไม่มีสถานะ
        self.assertEqual((body["status"], body["orbit_info"]["status"]), ("Unknown", "Unknown"))

    def test_search_rows_are_unchanged(self):
        row = self.client.get("/api/satellites", params={"q": "25544"}).json()["satellites"][0]
        self.assertEqual(list(row), ["norad", "name", "groups", "epoch", "updated"])

    def test_unreadable_tle_gives_null_orbit_info(self):
        """ไฟล์ดัชนีที่แก้มือจนบรรทัด TLE อ่านไม่ได้ต้องไม่ทำให้ GET ล้ม (Satellite Info แสดงว่าไม่มีข้อมูล)"""
        self.write_with_status("Spare", ("1 25544U", "2 25544"))
        r = self.client.get("/api/satellites/25544")
        self.assertEqual(r.status_code, 200)
        self.assertEqual((r.json()["status"], r.json()["orbit_info"]), ("Spare", None))


if __name__ == "__main__":
    unittest.main()
