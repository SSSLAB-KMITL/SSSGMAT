import unittest
from dataclasses import FrozenInstanceError
from datetime import datetime, timezone
from pathlib import Path

from gpredict_web.tletext import (
    STATUS_TAGS, UNKNOWN_STATUS, TleSet, _epoch_well_formed, checksum_ok, is_generated_name, parse_tle_text,
)

FIXTURES = Path(__file__).resolve().parent / "fixtures"
UTC = timezone.utc


def with_checksum(body: str) -> str:
    """ต่อเลข checksum mod-10 ท้ายบรรทัด 68 ตัว (เลข = ค่าเอง, '-' = 1, อื่นๆ = 0)"""
    assert len(body) == 68, (len(body), body)
    return body + str(sum(int(c) if c.isdigit() else (1 if c == "-" else 0) for c in body) % 10)


def line1(norad="25544", desig="98067A  ", epoch="24001.50000000", ephem="0") -> str:
    """บรรทัด 1 ที่ถูกต้องครบทุกช่อง ช่องที่ทดสอบแต่ละกติกาของ Gpredict ส่งทับได้"""
    return with_checksum(f"1 {norad:>5}U {desig:<8} {epoch:<14}  .00016717  00000-0  10270-3 {ephem}  999")


def line2(norad="25544") -> str:
    return with_checksum(f"2 {norad:>5}  51.6416 247.4627 0006703 130.5360 325.0288 15.7212539156353")


def tle_text(*lines: str) -> str:
    return "\n".join(lines) + "\n"


class TleTextTest(unittest.TestCase):
    def test_three_and_two_line_sets_mixed(self):
        sets = parse_tle_text((FIXTURES / "tle_mixed.txt").read_text(encoding="utf-8"))
        # SO-50 มี checksum เสียจึงถูกข้าม; ส่วนหัวไฟล์และบรรทัดท้ายเป็นขยะ
        self.assertEqual([s.norad for s in sets], [25544, 25575, 7530, 24278])
        iss, bare, ao7, fo29 = sets
        self.assertEqual(iss.name, "ISS (ZARYA)")
        self.assertEqual(iss.status, UNKNOWN_STATUS)
        self.assertEqual(bare.name, "1998-067A")                      # ชุด 2 บรรทัดได้ชื่อจาก international designator
        self.assertEqual((ao7.name, ao7.status), ("AO-7", "Partially operational"))
        self.assertEqual((fo29.name, fo29.status), ("FO-29", "Operational"))
        self.assertEqual(iss.lines, (
            "1 25544U 98067A   24001.50000000  .00016717  00000-0  10270-3 0  9997",
            "2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.72125391563537"))
        self.assertEqual(iss.epoch, datetime(2024, 1, 1, 12, 0, tzinfo=UTC))
        self.assertEqual(bare.epoch, datetime(2024, 1, 2, 6, 0, tzinfo=UTC))
        self.assertFalse(iss.generated_name)
        self.assertTrue(bare.generated_name)

    def test_status_tag_stripped(self):
        text = tle_text("AO-7 [P]", line1(), line2())
        (s,) = parse_tle_text(text)
        self.assertEqual((s.name, s.status), ("AO-7", "Partially operational"))
        self.assertEqual(STATUS_TAGS, {
            "[+]": "Operational", "[-]": "Non-operational", "[P]": "Partially operational",
            "[B]": "Backup/Standby", "[S]": "Spare", "[X]": "Extended Mission"})
        for tag, status in STATUS_TAGS.items():
            with self.subTest(tag=tag):
                (s,) = parse_tle_text(tle_text(f"SAT {tag}", line1(), line2()))
                self.assertEqual((s.name, s.status), ("SAT", status))
        # ป้ายที่ไม่รู้จักไม่ถูกตัด; ป้ายที่เริ่มหลังตัวอักษรที่ 23 ไม่นับ (ชื่อถูกตัดที่ 25 ตัวก่อน)
        (s,) = parse_tle_text(tle_text("SAT [Q]", line1(), line2()))
        self.assertEqual((s.name, s.status), ("SAT [Q]", UNKNOWN_STATUS))
        (s,) = parse_tle_text(tle_text("A" * 22 + " [+]", line1(), line2()))
        self.assertEqual((s.name, s.status), ("A" * 22 + " [+", UNKNOWN_STATUS))
        (s,) = parse_tle_text(tle_text("A" * 21 + " [+]", line1(), line2()))
        self.assertEqual((s.name, s.status), ("A" * 21, "Operational"))

    def test_name_rules(self):
        (s,) = parse_tle_text(tle_text("N" * 30, line1(), line2()))
        self.assertEqual(s.name, "N" * 25)
        (s,) = parse_tle_text(tle_text("A&B  ", line1(), line2()))
        self.assertEqual(s.name, "A/B")
        (s,) = parse_tle_text(tle_text("  PADDED NAME  ", line1(), line2()))   # ตัดช่องว่างหัวท้ายบรรทัดก่อน
        self.assertEqual(s.name, "PADDED NAME")
        (s,) = parse_tle_text(tle_text("A" * 24 + " " + "B" * 5, line1(), line2()))   # ตัดที่ 25 แล้วตัดช่องว่างท้าย
        self.assertEqual(s.name, "A" * 24)

    def test_bad_checksum_skipped(self):
        good1, good2 = line1(), line2()
        bad1 = good1[:68] + str((int(good1[68]) + 1) % 10)
        bad2 = good2[:68] + str((int(good2[68]) + 1) % 10)
        self.assertEqual(parse_tle_text(tle_text("SAT", bad1, good2)), [])
        self.assertEqual(parse_tle_text(tle_text("SAT", good1, bad2)), [])
        self.assertEqual(parse_tle_text(tle_text(bad1, good2)), [])             # ชุด 2 บรรทัด
        # ชุดเสียไม่ทำให้ชุดถัดไปหาย
        text = tle_text("BAD", bad1, good2, "GOOD", line1("25545"), line2("25545"))
        self.assertEqual([(s.norad, s.name) for s in parse_tle_text(text)], [(25545, "GOOD")])
        self.assertFalse(checksum_ok(bad1))
        self.assertFalse(checksum_ok(good1[:68]))                              # สั้นไป ไม่มีช่อง checksum
        self.assertTrue(checksum_ok(good1))
        self.assertTrue(checksum_ok(good2))

    def test_catalogue_numbers_must_match(self):
        self.assertEqual(parse_tle_text(tle_text("SAT", line1("25544"), line2("25545"))), [])
        self.assertEqual(parse_tle_text(tle_text(line1("25544"), line2("25545"))), [])
        (s,) = parse_tle_text(tle_text("SAT", line1("25544"), line2("25544")))
        self.assertEqual(s.norad, 25544)

    def test_two_digit_year(self):
        (s,) = parse_tle_text(tle_text(line1(desig="57001A  ", epoch="57001.00000000"), line2()))
        self.assertEqual(s.name, "1957-001A")
        self.assertEqual(s.epoch, datetime(1957, 1, 1, tzinfo=UTC))
        (s,) = parse_tle_text(tle_text(line1(desig="26001A  ", epoch="26001.00000000"), line2()))
        self.assertEqual(s.name, "2026-001A")
        self.assertEqual(s.epoch, datetime(2026, 1, 1, tzinfo=UTC))
        (s,) = parse_tle_text(tle_text(line1(desig="56001A  ", epoch="56001.00000000"), line2()))
        self.assertEqual((s.name, s.epoch.year), ("2056-001A", 2056))

    def test_lines_trimmed_to_69(self):
        l1, l2 = line1(), line2()
        (s,) = parse_tle_text(tle_text("SAT", l1 + " TRAILING", l2 + "   more text"))
        self.assertEqual(s.lines, (l1, l2))
        self.assertEqual((len(s.lines[0]), len(s.lines[1])), (69, 69))
        (s,) = parse_tle_text(tle_text("  SAT  ", "  " + l1 + "\t", " " + l2 + " "))   # ช่องว่างหัวท้ายถูกตัดก่อน
        self.assertEqual(s.lines, (l1, l2))

    def test_generated_names(self):
        self.assertTrue(is_generated_name("2026-123A"))                        # \d{4,}-\d{3,}
        self.assertTrue(is_generated_name("1998-067A"))
        self.assertTrue(is_generated_name("OBJECT A"))
        self.assertTrue(is_generated_name("SOMETHING OBJECT"))
        self.assertFalse(is_generated_name("ISS (ZARYA)"))
        self.assertFalse(is_generated_name("AO-7"))
        self.assertFalse(is_generated_name("98-067"))                          # ปี 2 หลักไม่ตรง \d{4,}
        self.assertFalse(is_generated_name("object a"))                        # ตัวพิมพ์ใหญ่เท่านั้น
        (bare,) = parse_tle_text(tle_text(line1(), line2()))
        self.assertEqual(bare.name, "1998-067A")
        self.assertTrue(bare.generated_name)
        (named,) = parse_tle_text(tle_text("ISS (ZARYA)", line1(), line2()))
        self.assertFalse(named.generated_name)

    # ---- กติกาของ Gpredict ที่ brief ไม่ได้ตั้งชื่อ test ไว้

    def test_validity_fields(self):
        base1, base2 = line1(), line2()
        self.assertEqual(len(parse_tle_text(tle_text(base1, base2))), 1)

        def moved(line: str, start: int, end: int, field: str) -> str:
            """เปลี่ยนช่อง [start:end] เป็น field (ยาวเท่าเดิม) แล้วคำนวณ checksum ใหม่"""
            self.assertEqual(len(field), end - start)
            return with_checksum(line[:start] + field + line[end:68])

        # จุดทศนิยมเลื่อนไปหนึ่งตัว: ยังเป็นเลขที่ float() อ่านได้แต่ผิดคอลัมน์ตายตัวของ Gpredict
        cases = {
            "ephemeris type not 0": (line1(ephem="2"), base2),
            "decimal point of line 1 col 35 moved": (moved(base1, 33, 43, " 0.0016717"), base2),
            "decimal point of line 2 col 12 moved": (base1, moved(base2, 8, 16, " 516.416")),
            "decimal point of line 2 col 21 moved": (base1, moved(base2, 17, 25, "2474.627")),
            "decimal point of line 2 col 38 moved": (base1, moved(base2, 34, 42, "1305.360")),
            "decimal point of line 2 col 47 moved": (base1, moved(base2, 43, 51, "3250.288")),
            "decimal point of line 2 col 55 moved": (base1, moved(base2, 52, 63, "157.2125391")),
            "epoch has a letter": (line1(epoch="24A01.50000000"), base2),
            "epoch fraction has an exponent": (line1(epoch="24001.5e000000"), base2),
            "epoch fraction empty": (line1(epoch="24001.        "), base2),
            "line 1 too short": (base1[:60], base2),
        }
        for label, (a, b) in cases.items():
            with self.subTest(label):
                self.assertEqual(parse_tle_text(tle_text("SAT", a, b)), [])
        # วันที่ในปีเว้นวรรคแทนศูนย์นำหน้า และเศษวันสั้นกว่าเต็ม 8 หลัก ใช้ได้
        for epoch in ("24  1.50000000", "24 11.50000000", "24001.5       "):
            with self.subTest(epoch=epoch):
                self.assertEqual(len(parse_tle_text(tle_text("SAT", line1(epoch=epoch), base2))), 1)

    def test_epoch_well_formed_rules(self):
        # Epoch_Good ของ Gpredict ตรวจ ช่อง epoch ละเอียดกว่าที่ observe.parse_tle ปฏิเสธ จึงทดสอบตรงๆ
        for epoch, expected in {
            "24001.50000000": True, "24  1.50000000": True, "24 11.50000000": True, "24001.5       ": True,
            "240 1.50000000": False,        # เว้นวรรคกลางเลขวันที่
            "24001.5 000000": False,        # เว้นวรรคกลางเศษวัน
            "24001.        ": False, "24A01.50000000": False, "2 001.50000000": False, "24001.5e000000": False,
        }.items():
            with self.subTest(epoch=epoch):
                self.assertEqual(_epoch_well_formed(line1(epoch=epoch)), expected)

    def test_epoch_from_day_of_year(self):
        (s,) = parse_tle_text(tle_text("SAT", line1(epoch="24060.25000000"), line2()))
        self.assertEqual(s.epoch, datetime(2024, 2, 29, 6, 0, tzinfo=UTC))   # วันที่ 60 ของปีอธิกสุรทิน

    def test_sliding_window_skips_junk(self):
        l1, l2 = line1("25544"), line2("25544")
        m1, m2 = line1("25545"), line2("25545")
        text = tle_text("HEADER", "", "1 not a tle line", "NAME A", l1, l2, "junk between", m1, m2, "tail")
        # ชุดสองบรรทัดที่นำหน้าด้วยขยะถูกอ่านเป็นชุด 3 บรรทัด (ขยะบรรทัดก่อนหน้าเป็นชื่อ) เหมือน Gpredict
        self.assertEqual([(s.norad, s.name) for s in parse_tle_text(text)], [(25544, "NAME A"), (25545, "junk between")])
        # บรรทัดว่างก่อนชุด 2 บรรทัดก็เป็น "ชื่อ" ว่างแบบเดียวกัน
        self.assertEqual([(s.norad, s.name) for s in parse_tle_text(tle_text(l1, l2, "", m1, m2))],
                         [(25544, "1998-067A"), (25545, "")])
        two_line = tle_text(l1, l2, m1, m2)
        self.assertEqual([(s.norad, s.name) for s in parse_tle_text(two_line)], [(25544, "1998-067A"), (25545, "1998-067A")])
        self.assertEqual(len(parse_tle_text(tle_text(l1, l2))), 1)             # ชุด 2 บรรทัดท้ายไฟล์พอดี
        self.assertEqual(len(parse_tle_text(l1 + "\n" + l2)), 1)               # ไม่มีขึ้นบรรทัดใหม่ท้ายไฟล์
        self.assertEqual(parse_tle_text(""), [])
        self.assertEqual(parse_tle_text("just\nsome\ntext\n"), [])
        self.assertEqual(parse_tle_text(l1 + "\n"), [])

    def test_invalid_set_is_consumed_whole(self):
        # ชุดที่ checksum ผ่านแต่ข้อมูลเสีย (เลขดาวไม่ตรง) ถูกใช้ไปทั้งชุดแล้วทิ้ง ไม่เลื่อนทีละบรรทัดไปตีความใหม่:
        # ถ้าเลื่อน บรรทัด 2 ของชุดเสียจะกลายเป็น "ชื่อ" ของชุด 2 บรรทัดถัดไป
        text = tle_text("A", line1("25544"), line2("25545"), line1("25546"), line2("25546"))
        self.assertEqual([(s.norad, s.name) for s in parse_tle_text(text)], [(25546, "1998-067A")])

    def test_crlf_and_long_lines(self):
        l1, l2 = line1(), line2()
        (s,) = parse_tle_text(f"ISS (ZARYA)\r\n{l1}\r\n{l2}\r\n")
        self.assertEqual((s.name, s.lines), ("ISS (ZARYA)", (l1, l2)))
        # Gpredict อ่านทีละ 79 ตัวอักษร (รวมขึ้นบรรทัดใหม่): บรรทัดที่เกินถูกหั่นเป็นสองบรรทัด
        # บรรทัด 1 ที่ยาวถึง 79 ตัวอักษรเนื้อหา (69 + 10) จึงมีบรรทัดว่างแทรกก่อนบรรทัด 2 และชุดเสีย
        (s,) = parse_tle_text(tle_text("SAT", l1 + " " * 9, l2))
        self.assertEqual(s.lines, (l1, l2))                                    # 78 ตัวอักษรยังเป็นบรรทัดเดียว
        self.assertEqual(parse_tle_text(tle_text("SAT", l1 + " " * 10, l2)), [])
        (s,) = parse_tle_text(tle_text("SAT", l1, l2 + "x" * 40))              # ส่วนที่ถูกหั่นหลังบรรทัด 2 เป็นขยะเฉยๆ
        self.assertEqual(s.lines, (l1, l2))

    def test_tleset_is_frozen(self):
        s = TleSet(1, "X", UNKNOWN_STATUS, (line1(), line2()), datetime(2024, 1, 1, tzinfo=UTC))
        with self.assertRaises(FrozenInstanceError):
            s.name = "Y"


if __name__ == "__main__":
    unittest.main()
