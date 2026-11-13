"""hwconf.py: ค่าของวิทยุและ rotator (spec §6.2, §9.1 และ ref-R §8, §9) เก็บที่ data/hwconf/<name>.rig.json และ <name>.rot.json
ตรวจค่าทุกช่องตามช่วงของ editor, PUT แทนทั้งชุดแต่คง Cycle/Threshold เดิม, ไฟล์ที่อ่านไม่ได้ถูกข้ามพร้อม log ใช้ data dir ชั่วคราวเสมอ"""

import contextlib
import json
import os
import unittest
from dataclasses import replace
from unittest import mock

from gpredict_web import hwconf as hwconf_module
from gpredict_web.errors import ApiError
from gpredict_web.hwconf import (PTT_TYPES, RIG_TYPES, VFO_NAMES, HwConf, RadioConf, RotConf, radio_from_dict,
                                 radio_to_dict, rot_from_dict, rot_to_dict)
from tests.helpers import temp_config

LOGGER = "gpredict_web.hwconf"

DUMMY = {"name": "DUMMY", "Host": "localhost", "Port": 4532, "Cycle": 1000, "LO": 0.0, "LO_UP": 0.0,
         "DefaultUplinkFreqHz": 145_890_000.0, "DefaultDownlinkFreqHz": 145_890_000.0, "Type": 3, "PTT": 1,
         "VFO_UP": 3, "VFO_DOWN": 4, "SIGNAL_AOS": True, "SIGNAL_LOS": False, "SIGNAL_AOIQ": False, "SIGNAL_LOIQ": True}
ROT = {"name": "ROT", "Host": "localhost", "Port": 4533, "Cycle": 1000, "Threshold": 5.0, "AzType": 0,
       "MinAz": 0.0, "MaxAz": 360.0, "MinEl": 0.0, "MaxEl": 90.0, "AzStopPos": 0.0}


def radio(name="DUMMY", **kw) -> dict:
    return {**DUMMY, "name": name, **kw}


def rot(name="ROT", **kw) -> dict:
    return {**ROT, "name": name, **kw}


class HwconfTestCase(unittest.TestCase):
    def setUp(self):
        self.cfg = temp_config(self)
        self.dir = self.cfg.data_dir / "hwconf"
        self.hw = HwConf(self.cfg.data_dir)

    def read(self, filename: str) -> dict:
        return json.loads((self.dir / filename).read_text(encoding="utf-8"))

    def put(self, filename: str, data) -> None:
        self.dir.mkdir(parents=True, exist_ok=True)
        raw = data if isinstance(data, bytes) else (data if isinstance(data, str) else json.dumps(data)).encode("utf-8")
        (self.dir / filename).write_bytes(raw)

    def files(self) -> list[str]:
        return sorted(p.name for p in self.dir.iterdir()) if self.dir.is_dir() else []


class ConstantsTest(unittest.TestCase):
    def test_labels(self):
        self.assertEqual(RIG_TYPES, ("RX only", "TX only", "Half-duplex", "Full-duplex",
                                     "FT817/857/897 (auto)", "FT817/857/897 (manual)"))
        self.assertEqual(PTT_TYPES, ("None", "Read PTT", "Read DCD"))
        self.assertEqual(VFO_NAMES, {1: "VFOA", 2: "VFOB", 3: "Main", 4: "Sub"})


class HwconfStoreTest(HwconfTestCase):
    def test_round_trip_files(self):
        self.hw.replace([DUMMY], [ROT])
        # ไม่มี key "name" ในไฟล์ Cycle ไม่ถูกเขียนเมื่อ == 1000 (ref-R §9.1) VFO_* มีเพราะ Type 3
        self.assertEqual(self.read("DUMMY.rig.json"),
                         {"Host": "localhost", "Port": 4532, "LO": 0.0, "LO_UP": 0.0,
                          "DefaultUplinkFreqHz": 145_890_000.0, "DefaultDownlinkFreqHz": 145_890_000.0,
                          "Type": 3, "PTT": 1, "VFO_UP": 3, "VFO_DOWN": 4,
                          "SIGNAL_AOS": True, "SIGNAL_LOS": False, "SIGNAL_AOIQ": False, "SIGNAL_LOIQ": True})
        # rotator: ไม่เขียน Cycle เมื่อ 1000 และ Threshold เมื่อ 5.0 (ref-R §9.2)
        self.assertEqual(self.read("ROT.rot.json"),
                         {"Host": "localhost", "Port": 4533, "AzType": 0, "MinAz": 0.0, "MaxAz": 360.0,
                          "MinEl": 0.0, "MaxEl": 90.0, "AzStopPos": 0.0})
        self.assertEqual(self.files(), ["DUMMY.rig.json", "ROT.rot.json"])
        self.assertEqual(self.hw.radios(), [RadioConf(
            name="DUMMY", host="localhost", port=4532, cycle=1000, lo=0.0, lo_up=0.0, default_up=145_890_000.0,
            default_down=145_890_000.0, type=3, ptt=1, vfo_up=3, vfo_down=4, signal_aos=True, signal_los=False,
            signal_aoiq=False, signal_loiq=True)])
        self.assertEqual(self.hw.rotators(), [RotConf(
            name="ROT", host="localhost", port=4533, cycle=1000, threshold=5.0, az_type=0, min_az=0.0, max_az=360.0,
            min_el=0.0, max_el=90.0, az_stop=0.0)])
        self.assertEqual(self.hw.radio("DUMMY"), self.hw.radios()[0])
        self.assertEqual(self.hw.rotator("ROT"), self.hw.rotators()[0])
        self.assertIsNone(self.hw.radio("OTHER"))
        self.assertIsNone(self.hw.rotator("OTHER"))
        self.assertIsNone(self.hw.radio("../x"))

    def test_non_default_cycle_and_threshold_are_written(self):
        self.hw.replace([radio()], [rot(Threshold=2.5, MinAz=-20.0)])
        self.hw.save_radio_cycle("DUMMY", 500)
        self.hw.save_rotator_runtime("ROT", 200, 2.5)
        self.assertEqual(self.read("DUMMY.rig.json")["Cycle"], 500)
        self.assertEqual((self.read("ROT.rot.json")["Cycle"], self.read("ROT.rot.json")["Threshold"]), (200, 2.5))

    def test_dict_round_trip(self):
        for d in (DUMMY, radio(Type=1, PTT=0), radio(Type=0, PTT=2, LO=-100e6, LO_UP=1e10)):
            expect = {k: v for k, v in d.items() if d["Type"] == 3 or k not in ("VFO_UP", "VFO_DOWN")}
            self.assertEqual(radio_to_dict(radio_from_dict(d)), expect)
        self.assertEqual(rot_to_dict(rot_from_dict(ROT)), ROT)
        self.assertEqual(list(radio_to_dict(radio_from_dict(DUMMY)))[:3], ["name", "Host", "Port"])
        self.assertIsInstance(radio_from_dict(radio(LO=0)).lo, float)            # int ใน JSON เป็น float ใน RadioConf

    def test_missing_keys_use_defaults(self):
        self.put("MIN.rig.json", {"Host": "h", "Port": 4600, "Type": 1, "PTT": 2})
        self.assertEqual(self.hw.radios(), [RadioConf(
            name="MIN", host="h", port=4600, cycle=1000, lo=0.0, lo_up=0.0, default_up=145_890_000.0,
            default_down=145_890_000.0, type=1, ptt=2, vfo_up=0, vfo_down=0, signal_aos=False, signal_los=False,
            signal_aoiq=False, signal_loiq=False)])
        self.put("MIN.rot.json", {"Host": "h", "Port": 4600})
        with self.assertLogs(LOGGER, "INFO"):
            self.assertEqual(self.hw.rotators(), [RotConf(
                name="MIN", host="h", port=4600, cycle=1000, threshold=5.0, az_type=0, min_az=0.0, max_az=360.0,
                min_el=0.0, max_el=90.0, az_stop=0.0)])

    def test_read_rules(self):
        self.put("A.rig.json", {"Host": "h", "Port": 4532, "Type": 0, "PTT": 0, "Cycle": 5})
        self.assertEqual(self.hw.radio("A").cycle, 10)                   # Cycle < 10 กลายเป็น 10 (ref-R §9.1)
        self.put("R.rot.json", {"Host": "h", "Port": 4533, "Cycle": 5, "Threshold": 0.05, "AzType": 1,
                                "MinAz": -20, "MaxAz": 200, "MinEl": 5, "MaxEl": 80})
        with self.assertLogs(LOGGER, "INFO") as logs:                    # ไม่มี AzStopPos
            r = self.hw.rotator("R")
        self.assertEqual((r.cycle, r.threshold), (10, 0.1))              # Threshold < 0.1 กลายเป็น 0.1 (ref-R §9.2)
        self.assertEqual(r.az_stop, -20.0)                               # ไม่มี AzStopPos = MinAz
        self.assertEqual(len(logs.records), 1)
        self.assertEqual(logs.records[0].getMessage(), "AzStopPos not defined for R. Assuming at minaz (-20.000000°).")
        self.put("S.rot.json", {"Host": "h", "Port": 4533, "MinAz": 0, "MaxAz": 360, "MinEl": 0, "MaxEl": 90, "AzStopPos": 3})
        with self.assertLogs(LOGGER, "INFO") as logs:                    # ไม่มี AzType
            s = self.hw.rotator("S")
        self.assertEqual((s.az_type, s.az_stop), (0, 3.0))
        self.assertEqual([r.getMessage() for r in logs.records], ["Az type not defined for S. Assuming 0..360°"])
        self.assertTrue(all(r.levelname == "INFO" for r in logs.records))

    def test_vfo_only_for_full_duplex(self):
        self.put("HALF.rig.json", {"Host": "h", "Port": 4532, "Type": 1, "PTT": 0, "VFO_UP": 3, "VFO_DOWN": 4})
        half = self.hw.radio("HALF")
        self.assertEqual((half.vfo_up, half.vfo_down), (0, 0))           # Type 1: อ่านแล้วเป็น 0 ทั้งที่ไฟล์มี VFO_*
        self.hw.replace([radio("HALF", Type=1, VFO_UP=3, VFO_DOWN=4), radio("FULL", Type=3, VFO_UP=1, VFO_DOWN=2)], [])
        self.assertNotIn("VFO_UP", self.read("HALF.rig.json"))
        self.assertNotIn("VFO_DOWN", self.read("HALF.rig.json"))
        self.assertEqual((self.read("FULL.rig.json")["VFO_UP"], self.read("FULL.rig.json")["VFO_DOWN"]), (1, 2))
        self.assertEqual((self.hw.radio("FULL").vfo_up, self.hw.radio("FULL").vfo_down), (1, 2))
        self.assertNotIn("VFO_UP", radio_to_dict(self.hw.radio("HALF")))
        self.assertEqual(self.hw.radio("FULL").type, 3)

    def test_full_duplex_without_vfo_keys_reads_as_main_up_sub_down(self):
        self.put("FULL.rig.json", {"Host": "h", "Port": 4532, "Type": 3, "PTT": 0})        # "A parse error gives Sub / Main"
        full = self.hw.radio("FULL")
        self.assertEqual((full.vfo_up, full.vfo_down), (3, 4))

    def test_validation(self):
        cases = [                                                          # (dict, key ที่ผิด)
            (radio("a b"), "name"), (radio("x" * 26), "name"), (radio(""), "name"), (radio(None), "name"), (radio(5), "name"),
            (radio("ก"), "name"),
            (radio(Host=""), "Host"), (radio(Host="h" * 51), "Host"), (radio(Host=5), "Host"), (radio(Host=None), "Host"),
            (radio(Port=1023), "Port"), (radio(Port=65536), "Port"), (radio(Port="4532"), "Port"), (radio(Port=4532.0), "Port"),
            (radio(Port=True), "Port"), (radio(Port=None), "Port"),
            (radio(Type=6), "Type"), (radio(Type=-1), "Type"), (radio(Type="1"), "Type"),
            (radio(PTT=3), "PTT"), (radio(PTT=-1), "PTT"),
            (radio(Cycle=9), "Cycle"), (radio(Cycle=30001), "Cycle"), (radio(Cycle=1000.5), "Cycle"), (radio(Cycle=True), "Cycle"),
            (radio(LO=-1e10 - 1), "LO"), (radio(LO=1e10 + 1), "LO"), (radio(LO="0"), "LO"), (radio(LO=True), "LO"),
            (radio(LO=float("nan")), "LO"), (radio(LO=float("inf")), "LO"),
            (radio(LO_UP=-1e10 - 1), "LO_UP"), (radio(LO_UP=1e10 + 1), "LO_UP"),
            (radio(DefaultUplinkFreqHz=-1), "DefaultUplinkFreqHz"), (radio(DefaultUplinkFreqHz=1e10 + 1), "DefaultUplinkFreqHz"),
            (radio(DefaultDownlinkFreqHz=-1), "DefaultDownlinkFreqHz"), (radio(DefaultDownlinkFreqHz=1e10 + 1), "DefaultDownlinkFreqHz"),
            (radio(Type=3, VFO_UP=0), "VFO_UP"), (radio(Type=3, VFO_DOWN=0), "VFO_DOWN"), (radio(Type=3, VFO_UP=5), "VFO_UP"),
            (radio(Type=3, VFO_DOWN="Sub"), "VFO_DOWN"),
            (radio(SIGNAL_AOS=1), "SIGNAL_AOS"), (radio(SIGNAL_LOS="yes"), "SIGNAL_LOS"), (radio(SIGNAL_AOIQ=None), "SIGNAL_AOIQ"),
            (radio(SIGNAL_LOIQ=0), "SIGNAL_LOIQ"),
        ]
        for key in ("Host", "Port", "Type", "PTT"):                      # ช่องที่ขาดไม่ได้ (read fails ใน ref-R §9.1)
            cases.append(({k: v for k, v in DUMMY.items() if k != key}, key))
        cases.append(({k: v for k, v in DUMMY.items() if k != "name"}, "name"))
        cases.append(({k: v for k, v in DUMMY.items() if k != "VFO_UP"}, "VFO_UP"))
        rot_cases = [
            (rot("a b"), "name"), (rot("y" * 26), "name"),
            (rot(Host=""), "Host"), (rot(Host="h" * 51), "Host"), (rot(Port=1023), "Port"), (rot(Port=65536), "Port"),
            (rot(Cycle=9), "Cycle"), (rot(Cycle=30001), "Cycle"),
            (rot(Threshold=0.009), "Threshold"), (rot(Threshold=50.01), "Threshold"), (rot(Threshold="5"), "Threshold"),
            (rot(AzType=2), "AzType"), (rot(AzType=-1), "AzType"), (rot(AzType=0.0), "AzType"),
            (rot(MinAz=-201), "MinAz"), (rot(MinAz=101), "MinAz"), (rot(MaxAz=451), "MaxAz"), (rot(MaxAz=-1), "MaxAz"),
            (rot(MinEl=-11), "MinEl"), (rot(MinEl=181), "MinEl"), (rot(MaxEl=-11), "MaxEl"), (rot(MaxEl=181), "MaxEl"),
            (rot(AzStopPos=-181), "AzStopPos"), (rot(AzStopPos=361), "AzStopPos"), (rot(AzStopPos=float("nan")), "AzStopPos"),
            ({k: v for k, v in ROT.items() if k != "Host"}, "Host"), ({k: v for k, v in ROT.items() if k != "Port"}, "Port"),
        ]
        for d, key in cases:
            with self.subTest(radio=d, key=key):
                with self.assertRaises(ApiError) as cm:
                    radio_from_dict(d)
                self.assertEqual((cm.exception.code, cm.exception.status, cm.exception.object), ("HWCONF_INVALID", 422, key))
                self.assertRegex(cm.exception.text, r"[ก-๙]")
                with self.assertRaises(ApiError) as cm:                     # replace ตรวจเหมือนกัน และไม่เขียนอะไร
                    self.hw.replace([d], [])
                self.assertEqual(cm.exception.object, key)
        for d, key in rot_cases:
            with self.subTest(rotator=d, key=key):
                with self.assertRaises(ApiError) as cm:
                    rot_from_dict(d)
                self.assertEqual((cm.exception.code, cm.exception.status, cm.exception.object), ("HWCONF_INVALID", 422, key))
                self.assertRegex(cm.exception.text, r"[ก-๙]")
                with self.assertRaises(ApiError) as cm:
                    self.hw.replace([], [d])
                self.assertEqual(cm.exception.object, key)
        self.assertEqual(self.files(), [])
        for bad in (None, [], "x", 5):                                      # ไม่ใช่ object
            with self.assertRaises(ApiError) as cm:
                radio_from_dict(bad)
            self.assertEqual(cm.exception.code, "HWCONF_INVALID")
            with self.assertRaises(ApiError) as cm:
                rot_from_dict(bad)
            self.assertEqual(cm.exception.code, "HWCONF_INVALID")

    def test_error_text_names_the_editor_label_and_range(self):
        with self.assertRaises(ApiError) as cm:
            radio_from_dict(radio(Port=80))
        self.assertEqual(cm.exception.text, "Port ต้องเป็นจำนวนเต็ม 1024–65535")
        with self.assertRaises(ApiError) as cm:
            radio_from_dict(radio(LO=2e10))
        self.assertEqual(cm.exception.text, "LO Down ต้องเป็นตัวเลขระหว่าง -10000 ถึง 10000 MHz")
        with self.assertRaises(ApiError) as cm:
            radio_from_dict(radio(DefaultDownlinkFreqHz=-1))
        self.assertEqual(cm.exception.text, "Default downlink ต้องเป็นตัวเลขระหว่าง 0 ถึง 10000 MHz")
        with self.assertRaises(ApiError) as cm:
            rot_from_dict(rot(MinAz=-201))
        self.assertEqual(cm.exception.text, "Min Az ต้องเป็นตัวเลขระหว่าง -200 ถึง 100 องศา")
        with self.assertRaises(ApiError) as cm:
            rot_from_dict(rot(AzStopPos=400))
        self.assertEqual(cm.exception.text, "Azimuth end stop position ต้องเป็นตัวเลขระหว่าง -180 ถึง 360 องศา")

    def test_limits_are_accepted(self):
        self.hw.replace([radio("L1", Port=1024, Cycle=10, LO=-1e10, LO_UP=1e10, DefaultUplinkFreqHz=0, DefaultDownlinkFreqHz=1e10),
                         radio("L2", Port=65536 - 1, Cycle=30000, Type=0, PTT=2)],
                        [rot("R1", Port=1024, Cycle=10, Threshold=0.01, AzType=1, MinAz=-200, MaxAz=450, MinEl=-10, MaxEl=180,
                             AzStopPos=-180),
                         rot("R2", Port=65535, Cycle=30000, Threshold=50.0, MinAz=100, MaxAz=0, MinEl=180, MaxEl=-10,
                             AzStopPos=360)])
        self.assertEqual([r.name for r in self.hw.radios()], ["L1", "L2"])
        self.assertEqual([r.name for r in self.hw.rotators()], ["R1", "R2"])
        self.assertEqual(self.hw.rotator("R1").min_az, -200.0)

    def test_duplicate_names_rejected(self):
        for radios, rotators, expect in (
                ([radio("IC910"), radio("ic910")], [], "IC910"),
                ([radio("A"), radio("B"), radio("A")], [], "A"),
                ([], [rot("Rot"), rot("ROT")], "Rot")):
            with self.subTest(radios=[r["name"] for r in radios], rotators=[r["name"] for r in rotators]):
                with self.assertRaises(ApiError) as cm:
                    self.hw.replace(radios, rotators)
                self.assertEqual((cm.exception.code, cm.exception.status, cm.exception.object), ("HWCONF_INVALID", 422, "name"))
                self.assertIn(expect, cm.exception.text)
                self.assertRegex(cm.exception.text, r"[ก-๙]")
                self.assertEqual(self.files(), [])                          # ไม่มีไฟล์ถูกเขียน
        self.hw.replace([radio("SAME")], [rot("SAME")])                     # วิทยุกับ rotator ชื่อเดียวกันได้ (คนละนามสกุลไฟล์)
        self.assertEqual(self.files(), ["SAME.rig.json", "SAME.rot.json"])

    def test_invalid_replace_leaves_files_untouched(self):
        self.hw.replace([radio("A"), radio("B")], [rot("R")])
        before = {name: (self.dir / name).read_bytes() for name in self.files()}
        for radios, rotators in (([radio("A"), radio("C", Port=1)], [rot("R2")]), ([radio("A")], [rot("R", MinAz=-500)]),
                                 ([radio("A"), radio("a")], [])):
            with self.assertRaises(ApiError):
                self.hw.replace(radios, rotators)
            self.assertEqual({name: (self.dir / name).read_bytes() for name in self.files()}, before)

    def test_replace_deletes_others(self):
        self.hw.replace([radio("A"), radio("B")], [rot("R"), rot("Q")])
        self.put("BROKEN.rig.json", "{not json")                            # ไฟล์พังก็ถูกลบ (ref-R §8.5 ลบทุก *.rig)
        self.put("notes.txt", "mine")                                       # ไฟล์อื่นไม่แตะ
        with self.assertLogs(LOGGER, "WARNING") as logs:                    # replace อ่านไฟล์เดิมเพื่อหา Cycle จึงเห็นไฟล์พังด้วย
            self.hw.replace([radio("A")], [rot("Q")])
        self.assertIn("BROKEN.rig.json", "\n".join(logs.output))
        self.assertEqual(self.files(), ["A.rig.json", "Q.rot.json", "notes.txt"])
        self.assertEqual([r.name for r in self.hw.radios()], ["A"])
        self.assertEqual([r.name for r in self.hw.rotators()], ["Q"])
        self.hw.replace([], [])
        self.assertEqual(self.files(), ["notes.txt"])
        self.assertEqual((self.hw.radios(), self.hw.rotators()), ([], []))

    def test_replace_with_case_changed_name_keeps_one_file_per_device(self):
        """macOS: A.rig.json กับ a.rig.json เป็นไฟล์เดียวกัน การลบไฟล์ที่ไม่อยู่ในชุดต้องไม่ลบไฟล์ที่เพิ่งเขียน"""
        self.hw.replace([radio("Ic910")], [])
        self.hw.replace([radio("ic910", Port=4600)], [])
        radios = self.hw.radios()
        self.assertEqual(len(radios), 1, self.files())
        self.assertEqual((radios[0].name.lower(), radios[0].port), ("ic910", 4600))

    def test_replace_keeps_cycle_and_threshold(self):
        self.hw.replace([radio("A")], [rot("R")])
        self.hw.save_radio_cycle("A", 500)
        self.hw.save_rotator_runtime("R", 200, 2.5)
        # dict ไม่มี Cycle/Threshold, มี Cycle 10, หรือ Threshold 0.5: ค่าเดิมคงอยู่ (spec §9.1 ข้อ 1) อุปกรณ์ใหม่ได้ 1000/5.0
        for a, r in (({k: v for k, v in radio("A", Port=4600).items() if k != "Cycle"},
                      {k: v for k, v in rot("R", Port=4700).items() if k not in ("Cycle", "Threshold")}),
                     (radio("A", Port=4600, Cycle=10), rot("R", Port=4700, Cycle=10, Threshold=0.5))):
            self.hw.replace([a, radio("NEW")], [r, rot("NEWROT", Threshold=1.0, Cycle=20)])
            self.assertEqual((self.hw.radio("A").cycle, self.hw.radio("A").port), (500, 4600))
            self.assertEqual((self.hw.rotator("R").cycle, self.hw.rotator("R").threshold, self.hw.rotator("R").port), (200, 2.5, 4700))
            self.assertEqual(self.hw.radio("NEW").cycle, 1000)
            self.assertEqual((self.hw.rotator("NEWROT").cycle, self.hw.rotator("NEWROT").threshold), (1000, 5.0))
        self.assertEqual(self.read("A.rig.json")["Cycle"], 500)
        self.assertNotIn("Cycle", self.read("NEW.rig.json"))

    def test_save_runtime(self):
        self.hw.replace([radio("A", Port=4600)], [rot("R", MinAz=-20.0)])
        self.hw.save_radio_cycle("A", 2000)
        self.hw.save_rotator_runtime("R", 300, 1.5)
        self.assertEqual((self.hw.radio("A").cycle, self.hw.radio("A").port), (2000, 4600))
        self.assertEqual((self.hw.rotator("R").cycle, self.hw.rotator("R").threshold, self.hw.rotator("R").min_az), (300, 1.5, -20.0))
        fresh = HwConf(self.cfg.data_dir)                                    # อ่านจากไฟล์จริง ไม่ใช่ความจำ
        self.assertEqual(fresh.radio("A").cycle, 2000)
        self.assertEqual((fresh.rotator("R").cycle, fresh.rotator("R").threshold), (300, 1.5))
        self.hw.save_radio_cycle("A", 1000)                                  # กลับเป็น 1000: ไม่เขียน Cycle (ref-R §9.1)
        self.assertNotIn("Cycle", self.read("A.rig.json"))
        self.hw.save_rotator_runtime("R", 1000, 5.0)
        self.assertEqual(set(self.read("R.rot.json")), {"Host", "Port", "AzType", "MinAz", "MaxAz", "MinEl", "MaxEl", "AzStopPos"})

    def test_save_runtime_for_a_missing_device_does_nothing(self):
        """ผู้ใช้ลบอุปกรณ์ใน Preferences ขณะที่หน้าต่างควบคุมยังเปิด: ตอนปิดหน้าต่างต้องไม่สร้างไฟล์กลับมา"""
        self.hw.save_radio_cycle("GONE", 500)
        self.hw.save_rotator_runtime("GONE", 500, 2.0)
        self.assertEqual(self.files(), [])

    def test_save_runtime_validates(self):
        self.hw.replace([radio("A")], [rot("R")])
        for call, key in ((lambda: self.hw.save_radio_cycle("A", 9), "Cycle"), (lambda: self.hw.save_radio_cycle("A", 30001), "Cycle"),
                          (lambda: self.hw.save_radio_cycle("A", 1.5), "Cycle"),
                          (lambda: self.hw.save_rotator_runtime("R", 9, 5.0), "Cycle"),
                          (lambda: self.hw.save_rotator_runtime("R", 100, 0.009), "Threshold"),
                          (lambda: self.hw.save_rotator_runtime("R", 100, 50.01), "Threshold")):
            with self.assertRaises(ApiError) as cm:
                call()
            self.assertEqual((cm.exception.code, cm.exception.object), ("HWCONF_INVALID", key))
        self.assertEqual((self.hw.radio("A").cycle, self.hw.rotator("R").cycle, self.hw.rotator("R").threshold), (1000, 1000, 5.0))

    def test_unreadable_file_is_skipped(self):
        self.hw.replace([radio("GOOD")], [rot("RGOOD")])
        self.put("BROKEN.rig.json", "{not json")
        self.put("NOPORT.rig.json", {"Host": "h", "Type": 0, "PTT": 0})
        self.put("LIST.rig.json", "[1, 2]")
        self.put("BADPORT.rig.json", {"Host": "h", "Port": 80, "Type": 0, "PTT": 0})
        self.put("a b.rig.json", {"Host": "h", "Port": 4532, "Type": 0, "PTT": 0})
        self.put("RBROKEN.rot.json", b"\xff\xfe\x00 not utf-8")
        self.put("RNOHOST.rot.json", {"Port": 4533})
        with self.assertLogs(LOGGER, "WARNING") as logs:
            radios = self.hw.radios()
            rotators = self.hw.rotators()
        self.assertEqual([r.name for r in radios], ["GOOD"])
        self.assertEqual([r.name for r in rotators], ["RGOOD"])
        self.assertIsNone(self.hw.radio("BROKEN"))
        text = "\n".join(logs.output)
        for filename in ("BROKEN.rig.json", "NOPORT.rig.json", "LIST.rig.json", "BADPORT.rig.json", "a b.rig.json",
                         "RBROKEN.rot.json", "RNOHOST.rot.json"):
            self.assertIn(filename, text)
        self.assertEqual({r.levelname for r in logs.records}, {"WARNING"})
        self.assertNotIn("GOOD.rig.json", text)

    def test_unreadable_file_warns_once_until_it_changes(self):
        self.put("BROKEN.rig.json", "{not json")
        with self.assertLogs(LOGGER, "WARNING") as logs:
            self.hw.radios()
        self.assertEqual(len(logs.records), 1)
        with self.assertNoLogs(LOGGER, "INFO"):                              # controller เรียกถี่ทุกรอบ ห้าม log ซ้ำ
            for _ in range(3):
                self.hw.radios()
                self.hw.radio("BROKEN")
        self.put("BROKEN.rig.json", {"Host": "fixed", "Port": 4532, "Type": 0, "PTT": 0})        # แก้ด้วยมือ: เห็นทันที
        self.assertEqual(self.hw.radio("BROKEN").host, "fixed")

    def test_hand_edits_are_seen(self):
        self.hw.replace([radio("A")], [rot("R")])
        self.assertEqual(self.hw.radio("A").host, "localhost")
        self.put("A.rig.json", {"Host": "otherhost.example", "Port": 4532, "Type": 0, "PTT": 0})
        self.assertEqual(self.hw.radio("A").host, "otherhost.example")
        self.put("B.rig.json", {"Host": "b", "Port": 4532, "Type": 0, "PTT": 0})
        self.assertEqual([r.name for r in self.hw.radios()], ["A", "B"])
        (self.dir / "B.rig.json").unlink()
        self.assertEqual([r.name for r in self.hw.radios()], ["A"])

    def test_dir_order(self):
        self.hw.replace([radio("A"), radio("B"), radio("C")], [rot("Z"), rot("Y")])
        real_scandir = os.scandir
        order = {"C": 0, "A": 1, "B": 2, "Z": 0, "Y": 1}

        def scan_cab(path):
            with real_scandir(path) as it:
                entries = sorted(it, key=lambda e: order[e.name[0]])
            return contextlib.nullcontext(entries)

        with mock.patch.object(hwconf_module.os, "scandir", scan_cab):
            self.assertEqual([r.name for r in self.hw.radios_dir_order()], ["C", "A", "B"])
            self.assertEqual([r.name for r in self.hw.radios()], ["A", "B", "C"])
            self.assertEqual([r.name for r in self.hw.rotators()], ["Y", "Z"])

    def test_missing_directory_is_empty(self):
        self.assertEqual((self.hw.radios(), self.hw.radios_dir_order(), self.hw.rotators()), ([], [], []))
        self.assertFalse(self.dir.exists())                                  # อ่านอย่างเดียวไม่สร้างโฟลเดอร์

    def test_returned_confs_are_immutable(self):
        self.hw.replace([radio("A")], [])
        with self.assertRaises(Exception):
            self.hw.radio("A").cycle = 5
        self.assertEqual(replace(self.hw.radio("A"), cycle=5).cycle, 5)


if __name__ == "__main__":
    unittest.main()
