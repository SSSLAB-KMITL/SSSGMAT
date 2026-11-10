"""ข้อผิดพลาดที่คาดไว้ทั้งหมด CLI จะแปลง GnssPredictError ทุกตัวเป็น exit code 1

ทุก class ประกาศ attribute `code` ของตัวเองตามรหัสในตารางหัวข้อ 9 ของ spec engine (CLI ของ studio พิมพ์รหัสนี้)
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class Message:
    """ข้อความที่ engine ส่งถึงผู้ใช้ level เป็น info, warning หรือ error และ text เป็นภาษาไทย"""
    code: str
    level: str
    text: str
    object: str | None = None

    def to_dict(self) -> dict:
        return {"code": self.code, "level": self.level, "text": self.text, "object": self.object}


class GnssPredictError(Exception):
    code = "ENGINE_ERROR"


class TleUnavailableError(GnssPredictError):
    code = "ORBIT_SOURCE_UNAVAILABLE"


class TleTooOldError(GnssPredictError):
    code = "TLE_TOO_OLD"


class GmatNotFoundError(GnssPredictError):
    code = "GMAT_NOT_FOUND"


class GmatRunError(GnssPredictError):
    code = "GMAT_FAILED"


class ReportError(GnssPredictError):
    """รายงานของ GMAT ไม่มี อ่านไม่ได้ หรือ epoch ไม่ครบ"""
    code = "GMAT_FAILED"


class Sp3UnavailableError(GnssPredictError):
    code = "TRUTH_UNAVAILABLE"


class Sp3FormatError(GnssPredictError):
    """ไฟล์ SP3 เปิดหรืออ่านไม่ได้ (gzip เสีย ถูกตัดท้าย ไม่ใช่ SP3) หรือ time system ไม่ใช่ GPS"""
    code = "TRUTH_UNREADABLE"


class OrbitUnavailableError(GnssPredictError):
    code = "ORBIT_SOURCE_UNAVAILABLE"


class IgsMetadataUnavailableError(GnssPredictError):
    code = "IGS_META_UNAVAILABLE"


class ScenarioError(GnssPredictError):
    code = "SCENARIO_INVALID"

    def __init__(self, text: str, field: str):
        super().__init__(text)
        self.field = field


class NoSatellitesError(GnssPredictError):
    code = "NO_SATELLITES"


class BrdcUnavailableError(GnssPredictError):
    code = "BRDC_UNAVAILABLE"


class ResultCorruptError(GnssPredictError):
    """manifest.json ของโฟลเดอร์ผลลัพธ์ที่มีอยู่แล้วอ่านไม่ได้"""
    code = "RESULT_CORRUPT"
