import json
import unittest
from pathlib import Path

FXS = Path(__file__).resolve().parent / "fixtures" / "studio"
SVNS = {"G080", "G044", "E101", "E202", "R856", "R809", "C231", "C222", "C017", "C005"}


def _sections(text: str) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    name = None
    for line in text.split("\n"):
        if line.startswith("+"):
            name = line[1:].strip()
            out[name] = []
        elif line.startswith("-"):
            name = None
        elif name is not None and line[:1] == " ":
            out[name].append(line)
    return out


class TestStudioFixtures(unittest.TestCase):
    def test_fixture_contents(self):
        omm = json.loads((FXS / "omm_sample.json").read_text())
        self.assertEqual({int(o["NORAD_CAT_ID"]) for o in omm},
                         {62339, 26407, 37846, 40129, 43508, 56564, 44542, 41434, 36828, 100744})
        self.assertEqual(sum(1 for l in (FXS / "tle_sample.tle").read_text().splitlines() if l.startswith("1 ")), 9)
        for g in ("gps-ops", "glo-ops", "galileo", "beidou"):
            self.assertTrue((FXS / "snapshot" / f"{g}.json").is_file())

    def test_snapshot_groups(self):
        want = {"gps-ops": [62339, 26407], "glo-ops": [43508, 100744], "galileo": [37846, 40129],
                "beidou": [56564, 44542, 41434, 36828]}
        for group, ids in want.items():
            got = [int(o["NORAD_CAT_ID"]) for o in json.loads((FXS / "snapshot" / f"{group}.json").read_text())]
            self.assertEqual(got, ids)

    def test_tle_lines_are_the_original_triplets(self):
        raw = (FXS / "tle_sample.tle").read_bytes()
        self.assertNotIn(b"\n", raw.replace(b"\r\n", b""))         # ต้นฉบับเป็น CRLF ทุกบรรทัด
        lines = raw.decode("ascii").splitlines()
        self.assertEqual(len(lines), 27)
        self.assertEqual([int(lines[i][2:7]) for i in range(1, 27, 3)],
                         [62339, 26407, 37846, 40129, 43508, 56564, 44542, 41434, 36828])
        self.assertTrue(all(lines[i + 2].startswith("2 ") for i in range(0, 27, 3)))

    def test_igs_metadata_has_only_the_sample_svns(self):
        text = (FXS / "snapshot" / "igs_satellite_metadata.snx").read_text()
        self.assertTrue(text.startswith("%=SNX"))
        sections = _sections(text)
        self.assertEqual(set(sections), {"SATELLITE/IDENTIFIER", "SATELLITE/PRN"})
        for name, rows in sections.items():
            self.assertEqual({r[1:5] for r in rows}, SVNS, name)
        prn_r809 = [r for r in sections["SATELLITE/PRN"] if r[1:5] == "R809"]
        self.assertEqual([r.split()[3] for r in prn_r809], ["R28", "R10"])

    def test_broadcast_fixture(self):
        lines = (FXS / "snapshot" / "brdc" / "BRDC00IGS_R_20263130000_01D_MN.rnx").read_text().split("\n")
        header_end = next(i for i, l in enumerate(lines) if "END OF HEADER" in l)
        starts = [l for l in lines[header_end + 1:] if l[:1].isalpha()]
        sats = {l[:3] for l in starts}
        self.assertEqual(sats, {"G01", "R05", "R13", "C01", "C09", "C19", "C38", "C40", "E11", "E14"})
        for sat in ("E11", "E14"):
            epochs = [tuple(int(x) for x in l[4:23].split()) for l in starts if l.startswith(sat)]
            self.assertTrue(epochs)
            self.assertLessEqual(max(epochs), (2026, 11, 9, 4, 0, 0))
        n_lines = sum(1 for l in lines[header_end + 1:] if l.strip())
        self.assertEqual(n_lines, sum(4 if l[0] == "R" else 8 for l in starts))

    def test_mgx_sp3_fixture(self):
        lines = (FXS / "mgx_sample.sp3").read_text().split("\n")
        epochs = [l for l in lines if l.startswith("*")]
        self.assertEqual(len(epochs), 37)
        self.assertEqual(epochs[0].split()[1:7], ["2026", "11", "9", "0", "0", "0.00000000"])
        self.assertEqual(epochs[-1].split()[1:7], ["2026", "11", "9", "3", "0", "0.00000000"])
        pos = [l for l in lines if l.startswith("P")]
        self.assertEqual(len(pos), 37 * 5)
        self.assertEqual({l[1:4] for l in pos}, {"C19", "C38", "E11", "G01", "R05"})
        self.assertEqual(lines[-2][:3], "EOF")


if __name__ == "__main__":
    unittest.main()
