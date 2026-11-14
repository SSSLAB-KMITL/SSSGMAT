"""rig.py ส่วนบริสุทธิ์: สูตร Doppler/LO (ref-R §3.2), transponder tune/lock (§3.3), ข้อความคำสั่ง rigctld (§4.1) ทุกตัวอักษร
ทั้งมีและไม่มี VFO option, parse คำตอบ (§3.6, §4.2) และข้อความ count-down (§2.6) ไม่มี I/O"""

import unittest

from gpredict_web.rig import (
    CMD_AOIQ, CMD_AOS, CMD_CHK_VFO, CMD_GET_DCD, CMD_LOIQ, CMD_LOS, CMD_SET_VFO_OPT, cmd_duplex_split, cmd_ft817_split,
    cmd_get_freq, cmd_get_ptt, cmd_get_split_freq, cmd_set_freq, cmd_set_ptt, cmd_set_split_freq,
    countdown_text, doppler_down, doppler_up, is_beacon, lock_down, lock_up, parse_flag, parse_freq, radio_freq,
    sat_from_radio, tune_centre,
)

# transponder ตัวอย่าง: downlink 145.9-146.0 MHz, uplink 435.0-435.1 MHz (ช่วงกว้าง 100 kHz เท่ากันทั้งสองฝั่ง)
TRSP = {"name": "Mode U/V", "up_low": 435_000_000, "up_high": 435_100_000,
        "down_low": 145_900_000, "down_high": 146_000_000, "invert": False, "mode": "SSB", "baud": 0.0}
INVERTING = dict(TRSP, invert=True)
BEACON = {"name": "Beacon", "up_low": 0, "up_high": 0, "down_low": 145_800_000, "down_high": 145_800_000,
          "invert": False, "mode": "CW", "baud": 0.0}


class DopplerTest(unittest.TestCase):
    def test_doppler_signs(self):
        # กำลังห่าง (rr +7 km/s): downlink ต่ำลง uplink สูงขึ้น (ref-R §3.2: dd = -f·rr/c, du = +f·rr/c)
        self.assertAlmostEqual(doppler_down(145.8e6, 7.0), -3404.4, delta=0.1)
        self.assertAlmostEqual(doppler_up(145.8e6, 7.0), 3404.4, delta=0.1)
        # กำลังเข้าหา: เครื่องหมายกลับกัน
        self.assertAlmostEqual(doppler_down(145.8e6, -7.0), 3404.4, delta=0.1)
        self.assertAlmostEqual(doppler_up(145.8e6, -7.0), -3404.4, delta=0.1)
        self.assertEqual(doppler_down(145.8e6, 0.0), 0.0)
        self.assertEqual(doppler_up(145.8e6, 0.0), 0.0)
        # สูตรตรงตัว c = 299792.458 km/s
        self.assertAlmostEqual(doppler_down(435_050_000, 7.0), -435_050_000 * 7.0 / 299792.458, places=6)
        self.assertAlmostEqual(doppler_up(435_050_000, 7.0), 435_050_000 * 7.0 / 299792.458, places=6)

    def test_radio_freq_formulas(self):
        dd, du = -3404.4, 10158.4
        # downlink: track on = f + dd - LO, track off = f - LO
        self.assertAlmostEqual(radio_freq(145_890_000, dd, 0, True), 145_886_595.6, places=3)
        self.assertAlmostEqual(radio_freq(145_890_000, dd, 116_000_000, True), 29_886_595.6, places=3)
        self.assertEqual(radio_freq(145_890_000, dd, 116_000_000, False), 29_890_000)
        # uplink ใช้สูตรเดียวกันกับ du และ LO_UP
        self.assertAlmostEqual(radio_freq(435_050_000, du, 0, True), 435_060_158.4, places=3)
        self.assertAlmostEqual(radio_freq(435_050_000, du, 400_000_000, True), 35_060_158.4, places=3)
        self.assertEqual(radio_freq(435_050_000, du, 400_000_000, False), 35_050_000)
        # LO ลบ (high-side injection): ค่าบนวิทยุสูงกว่าบนฟ้า
        self.assertAlmostEqual(radio_freq(145_890_000, dd, -1_000_000, True), 146_886_595.6, places=3)
        self.assertEqual(radio_freq(145_890_000, dd, -1_000_000, False), 146_890_000)
        # dial feedback: f_sat = f_read + LO - doppler (track on), f_read + LO (track off)
        self.assertAlmostEqual(sat_from_radio(29_886_595.6, dd, 116_000_000, True), 145_890_000, places=3)
        self.assertEqual(sat_from_radio(29_890_000, dd, 116_000_000, False), 145_890_000)
        self.assertAlmostEqual(sat_from_radio(35_060_158.4, du, 400_000_000, True), 435_050_000, places=3)
        self.assertEqual(sat_from_radio(35_050_000, du, 400_000_000, False), 435_050_000)
        self.assertAlmostEqual(sat_from_radio(146_886_595.6, dd, -1_000_000, True), 145_890_000, places=3)
        self.assertEqual(sat_from_radio(146_890_000, dd, -1_000_000, False), 145_890_000)
        # เป็นฟังก์ชันผกผันกันทุกกรณี
        for lo in (0, 116_000_000, -1_000_000):
            for track in (True, False):
                back = sat_from_radio(radio_freq(145_890_000, dd, lo, track), dd, lo, track)
                self.assertAlmostEqual(back, 145_890_000, places=3)


class TransponderTest(unittest.TestCase):
    def test_tune_centre(self):
        self.assertEqual(tune_centre(435_000_000, 435_100_000), 435_050_000)
        self.assertEqual(tune_centre(435_100_000, 435_000_000), 435_150_000)          # สูตร low + |high - low| / 2 ตรงตัว (ขอบกลับด้านเกินขึ้นไป)
        self.assertEqual(tune_centre(145_800_000, 145_800_000), 145_800_000)          # beacon
        self.assertEqual(tune_centre(145_900_001, 146_000_000), 145_950_000)          # หารจำนวนเต็ม: 99_999 // 2 = 49_999
        self.assertIsNone(tune_centre(0, 435_100_000))
        self.assertIsNone(tune_centre(435_000_000, 0))
        self.assertIsNone(tune_centre(0, 0))

    def test_lock_normal_and_inverting(self):
        self.assertEqual(lock_up(145_950_000, TRSP), 435_050_000)                      # Δ = 50 kHz → UP_LOW + Δ
        self.assertEqual(lock_up(145_900_000, TRSP), 435_000_000)
        self.assertEqual(lock_down(435_050_000, TRSP), 145_950_000)
        self.assertEqual(lock_up(145_950_000, INVERTING), 435_050_000)                 # UP_HIGH - Δ = 435.1 - 0.05
        self.assertEqual(lock_up(145_910_000, INVERTING), 435_090_000)                 # Δ = 10 kHz → 435.1 - 0.01
        self.assertEqual(lock_down(435_090_000, INVERTING), 145_910_000)               # ย้อนกลับได้ค่าเดิม
        self.assertEqual(lock_down(435_010_000, INVERTING), 145_990_000)               # DOWN_HIGH - (f_up - UP_LOW)
        for f_down in (145_900_000, 145_923_457, 145_950_000, 146_000_000):
            for t in (TRSP, INVERTING):
                self.assertEqual(lock_down(lock_up(f_down, t), t), f_down)
        # คืน float เสมอ (ค่า Hz แบบ double ของ Gpredict)
        self.assertIsInstance(lock_up(145_950_000, TRSP), float)
        self.assertIsInstance(lock_down(435_050_000, TRSP), float)

    def test_lock_needs_both_lower_limits(self):
        # ไม่มี uplink (beacon) หรือไม่มี downlink → None ทั้งสองทิศ (ref-R §3.3: DOWN_LOW > 0 และ UP_LOW > 0)
        self.assertIsNone(lock_up(145_800_000, BEACON))
        self.assertIsNone(lock_down(435_050_000, BEACON))
        self.assertIsNone(lock_up(145_950_000, dict(TRSP, up_low=0, up_high=0)))
        self.assertIsNone(lock_down(435_050_000, dict(TRSP, down_low=0, down_high=0)))

    def test_no_passband_limit(self):
        # f_down นอก passband (146.2 MHz) → ยังแมปเชิงเส้นต่อ (spec §9.2) ทั้งนอกขอบบนและขอบล่าง
        self.assertEqual(lock_up(146_200_000, TRSP), 435_300_000)
        self.assertEqual(lock_up(145_700_000, TRSP), 434_800_000)
        self.assertEqual(lock_up(146_200_000, INVERTING), 434_800_000)
        self.assertEqual(lock_down(435_300_000, TRSP), 146_200_000)
        self.assertEqual(lock_down(434_800_000, INVERTING), 146_200_000)

    def test_is_beacon(self):
        self.assertTrue(is_beacon(BEACON))
        self.assertFalse(is_beacon(TRSP))
        self.assertFalse(is_beacon(dict(BEACON, down_high=145_900_000)))                      # downlink เป็นช่วง
        self.assertFalse(is_beacon(dict(BEACON, up_low=435_000_000, up_high=435_000_000)))    # มี uplink
        self.assertFalse(is_beacon(dict(BEACON, up_high=435_000_000)))


class CommandStringTest(unittest.TestCase):
    def test_command_strings(self):
        # ref-R §4.1 ทุกแถว: ไม่มี VFO option / มี VFO option เทียบทีละตัวอักษร ตัวเลขความถี่ชิดขวากว้าง 10 (%10.0f)
        self.assertEqual(cmd_set_freq(145890000, False), "F  145890000\n")
        self.assertEqual(cmd_set_freq(145890000, True), "F currVFO  145890000\n")
        self.assertEqual(cmd_set_freq(1435000000, False), "F 1435000000\n")
        self.assertEqual(cmd_set_freq(1435000000, True), "F currVFO 1435000000\n")
        self.assertEqual(cmd_set_freq(9_999_999_999, False), "F 9999999999\n")             # FREQ_MAX_HZ: 10 หลักพอดี
        self.assertEqual(cmd_set_freq(1_000_000, False), "F    1000000\n")

        self.assertEqual(cmd_get_freq(False), "f\n")
        self.assertEqual(cmd_get_freq(True), "f currVFO\n")

        self.assertEqual(cmd_set_split_freq(435050000, False), "I  435050000\n")
        self.assertEqual(cmd_set_split_freq(435050000, True), "I VFOA  435050000\n")        # always VFOA
        self.assertEqual(cmd_set_split_freq(1435000000, True), "I VFOA 1435000000\n")

        self.assertEqual(cmd_get_split_freq(False), "i\n")
        self.assertEqual(cmd_get_split_freq(True), "i currVFO\n")

        self.assertEqual(cmd_get_ptt(False), "t\n")
        self.assertEqual(cmd_get_ptt(True), "t currVFO\n")

        # Set PTT: ไม่มี q ต่อท้าย (spec §9.1 ข้อ 5)
        self.assertEqual(cmd_set_ptt(True, False), "T 1\n")
        self.assertEqual(cmd_set_ptt(False, False), "T 0\n")
        self.assertEqual(cmd_set_ptt(True, True), "T currVFO 1\n")
        self.assertEqual(cmd_set_ptt(False, True), "T currVFO 0\n")

        # Full-duplex split ตั้งครั้งเดียวตอน Engage: VFO Up 1=A 2=B 3=Main 4=Sub
        self.assertEqual(cmd_duplex_split(1, False), "S 1 VFOA\n")
        self.assertEqual(cmd_duplex_split(2, False), "S 1 VFOB\n")
        self.assertEqual(cmd_duplex_split(3, False), "S 1 Main\n")
        self.assertEqual(cmd_duplex_split(4, False), "S 1 Sub\n")
        self.assertEqual(cmd_duplex_split(1, True), "S VFOB 1 VFOA\n")
        self.assertEqual(cmd_duplex_split(2, True), "S VFOA 1 VFOB\n")
        self.assertEqual(cmd_duplex_split(3, True), "S Sub 1 Main\n")
        self.assertEqual(cmd_duplex_split(4, True), "S Main 1 Sub\n")
        for bad in (0, 5, -1):
            with self.assertRaises(ValueError):
                cmd_duplex_split(bad, False)

        # FT817 split: เปิดตอน Engage (รับ A ส่ง B) ปิดตอน Disengage (spec §9.1 ข้อ 7; แบบมี VFO option เป็นข้อตัดสินใจ 7 ของแผน)
        self.assertEqual(cmd_ft817_split(True, False), "S 1 VFOB\n")
        self.assertEqual(cmd_ft817_split(False, False), "S 0 VFOA\n")
        self.assertEqual(cmd_ft817_split(True, True), "S VFOA 1 VFOB\n")
        self.assertEqual(cmd_ft817_split(False, True), "S VFOA 0 VFOA\n")

    def test_command_types(self):
        for cmd in (cmd_set_freq(1, False), cmd_get_freq(True), cmd_set_split_freq(1, True), cmd_get_split_freq(False),
                    cmd_get_ptt(True), cmd_set_ptt(True, False), cmd_duplex_split(1, True), cmd_ft817_split(True, False)):
            self.assertIsInstance(cmd, str)
            self.assertTrue(cmd.endswith("\n"))
        self.assertIsInstance(CMD_GET_DCD, bytes)

    def test_fixed_commands(self):
        self.assertEqual(CMD_SET_VFO_OPT, "\\set_vfo_opt 1\n")          # backslash หนึ่งตัวนำหน้า (ไม่ใช่ \s)
        self.assertEqual(len(CMD_SET_VFO_OPT), 15)
        self.assertEqual(CMD_CHK_VFO, "\\chk_vfo\n")
        # DCD ไม่มีชื่อ VFO แม้มี VFO option (spec §9.1: rigctld 4.7.2 ตอบ `\x8b currVFO` สองบรรทัด)
        self.assertEqual(CMD_GET_DCD, b"\x8b\n")
        self.assertEqual(CMD_AOS, "AOS\n")
        self.assertEqual(CMD_LOS, "LOS\n")
        self.assertEqual(CMD_AOIQ, "U IQRECORD 1\n")
        self.assertEqual(CMD_LOIQ, "U IQRECORD 0\n")

    def test_set_freq_rounds_like_printf(self):
        self.assertEqual(cmd_set_freq(145890000.4, False), "F  145890000\n")
        self.assertEqual(cmd_set_freq(145890000.6, False), "F  145890001\n")
        self.assertEqual(cmd_set_freq(145890000.4, True), "F currVFO  145890000\n")
        self.assertEqual(cmd_set_freq(145890000.6, True), "F currVFO  145890001\n")
        # ตรงกึ่งกลางพอดี: printf (glibc/macOS) ปัดเข้าหาเลขคู่ Python ทำเหมือนกัน
        self.assertEqual(cmd_set_freq(145890000.5, False), "F  145890000\n")
        self.assertEqual(cmd_set_freq(145890001.5, False), "F  145890002\n")
        # ค่าที่ไม่ใช่ int เช่นผลของ radio_freq ก็ใช้ได้
        self.assertEqual(cmd_set_freq(radio_freq(145_890_000, -3404.4, 0, True), False), "F  145886596\n")


class ParseTest(unittest.TestCase):
    def test_parse_freq_and_flag(self):
        self.assertIsNone(parse_freq(["RPRT -1"]))
        self.assertIsNone(parse_freq(["RPRT 0"]))
        self.assertEqual(parse_freq(["145890000"]), 145890000.0)
        self.assertEqual(parse_freq(["145890000", "RPRT 0"]), 145890000.0)             # ใช้บรรทัดแรก
        self.assertEqual(parse_freq(["145890000.5"]), 145890000.5)
        self.assertEqual(parse_freq(["  145890000 "]), 145890000.0)
        self.assertIsInstance(parse_freq(["145890000"]), float)
        for bad in ([], [""], ["abc"], ["nan"], ["inf"], ["1_000"]):
            self.assertIsNone(parse_freq(bad), bad)

        # parse_flag: จำนวนเต็มไม่ลบฐานอัตโนมัติ (g_ascii_strtoull(..., 0)) เท่ากับ 1 เท่านั้นที่เป็นจริง
        self.assertTrue(parse_flag(["1"]))
        self.assertTrue(parse_flag(["0x1"]))
        self.assertTrue(parse_flag(["0X01"]))
        self.assertTrue(parse_flag(["01"]))                                           # ฐาน 8
        self.assertTrue(parse_flag(["+1"]))
        self.assertTrue(parse_flag([" 1"]))
        self.assertTrue(parse_flag(["1", "RPRT 0"]))                                  # ใช้บรรทัดแรก
        self.assertFalse(parse_flag(["0"]))
        self.assertFalse(parse_flag(["2"]))
        self.assertFalse(parse_flag(["010"]))                                         # ฐาน 8 = 8
        self.assertFalse(parse_flag(["0x10"]))
        self.assertFalse(parse_flag(["-1"]))                                          # strtoull ได้ ULLONG_MAX
        self.assertFalse(parse_flag(["RPRT -1"]))
        self.assertFalse(parse_flag([""]))
        self.assertFalse(parse_flag(["abc"]))
        self.assertFalse(parse_flag(["0x"]))                                          # อ่านได้ "0"
        self.assertFalse(parse_flag([]))


class CountdownTest(unittest.TestCase):
    def test_countdown_text(self):
        self.assertEqual(countdown_text(3725, None), "01:02:05")
        self.assertEqual(countdown_text(125, None), "02:05")
        self.assertEqual(countdown_text(125, "LOS in"), "LOS in 02:05")
        self.assertEqual(countdown_text(3725, "AOS in"), "AOS in 01:02:05")
        # ตัดเศษวินาที (guint)(delta * 86400) ไม่ปัด และชั่วโมงเริ่มแสดงเมื่อครบ 1 ชั่วโมงเต็ม
        self.assertEqual(countdown_text(3599.9, None), "59:59")
        self.assertEqual(countdown_text(3600, None), "01:00:00")
        self.assertEqual(countdown_text(0, None), "00:00")
        self.assertEqual(countdown_text(59.99, None), "00:59")
        self.assertEqual(countdown_text(360_000, None), "100:00:00")                  # %02d ไม่ตัดหลักที่เกิน
        # เวลาย้อนหลัง (ผ่านเหตุการณ์แล้วก่อน tick ถัดไป) แสดง 00:00
        self.assertEqual(countdown_text(-5.0, "AOS in"), "AOS in 00:00")


if __name__ == "__main__":
    unittest.main()
