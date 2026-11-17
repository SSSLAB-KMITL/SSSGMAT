import inspect
import unittest

from gnss_predict import errors
from gnss_predict.errors import (
    BrdcUnavailableError, GmatNotFoundError, GmatRunError, GnssPredictError,
    IgsMetadataUnavailableError, Message, NoSatellitesError, OrbitUnavailableError,
    ScenarioError, Sp3UnavailableError,
)


class TestMessage(unittest.TestCase):
    def test_message_to_dict(self):
        m = Message("SAT_FLAGGED", "warning", "ข้อความ", "C40")
        self.assertEqual(m.to_dict(), {"code": "SAT_FLAGGED", "level": "warning", "text": "ข้อความ", "object": "C40"})

    def test_object_defaults_to_none(self):
        self.assertEqual(Message("DOP_GAPS", "warning", "ข้อความ").to_dict()["object"], None)

    def test_message_is_frozen(self):
        with self.assertRaises(Exception):
            Message("A", "info", "t").code = "B"


class TestErrors(unittest.TestCase):
    def test_codes(self):
        self.assertEqual(OrbitUnavailableError.code, "ORBIT_SOURCE_UNAVAILABLE")
        self.assertEqual(GmatRunError.code, "GMAT_FAILED")
        e = ScenarioError("ผิด", field="objects[0].name")
        self.assertEqual(e.field, "objects[0].name")
        self.assertTrue(issubclass(NoSatellitesError, GnssPredictError))

    def test_every_code(self):
        expected = {
            OrbitUnavailableError: "ORBIT_SOURCE_UNAVAILABLE",
            IgsMetadataUnavailableError: "IGS_META_UNAVAILABLE",
            ScenarioError: "SCENARIO_INVALID",
            NoSatellitesError: "NO_SATELLITES",
            BrdcUnavailableError: "BRDC_UNAVAILABLE",
            GmatNotFoundError: "GMAT_NOT_FOUND",
            GmatRunError: "GMAT_FAILED",
            Sp3UnavailableError: "TRUTH_UNAVAILABLE",
        }
        for cls, code in expected.items():
            self.assertEqual(cls.code, code)
            self.assertTrue(issubclass(cls, GnssPredictError))

    def test_every_error_class_declares_its_own_code(self):
        # ทุก class ใน errors.py ต้องมีรหัสของตัวเอง CLI ของ studio พิมพ์ exc.code เสมอ
        classes = [c for _, c in inspect.getmembers(errors, inspect.isclass) if issubclass(c, GnssPredictError)]
        for cls in classes:
            with self.subTest(cls=cls.__name__):
                code = cls.__dict__.get("code")
                self.assertIsInstance(code, str)
                self.assertRegex(code, r"^[A-Z][A-Z_]+$")
        self.assertGreaterEqual(len(classes), 14)

    def test_codes_of_legacy_and_generic_errors(self):
        expected = {
            "GnssPredictError": "ENGINE_ERROR",
            "ReportError": "GMAT_FAILED",
            "Sp3FormatError": "TRUTH_UNREADABLE",
            "TleUnavailableError": "ORBIT_SOURCE_UNAVAILABLE",
            "TleTooOldError": "TLE_TOO_OLD",
            "ResultCorruptError": "RESULT_CORRUPT",
        }
        for name, code in expected.items():
            with self.subTest(name=name):
                cls = getattr(errors, name, None)
                self.assertIsNotNone(cls, name)
                self.assertTrue(issubclass(cls, GnssPredictError))
                self.assertEqual(cls.__dict__.get("code"), code)

    def test_scenario_error_keeps_text(self):
        e = ScenarioError("ชื่อไม่ถูกต้อง", field="objects[1].name")
        self.assertEqual(str(e), "ชื่อไม่ถูกต้อง")


if __name__ == "__main__":
    unittest.main()
