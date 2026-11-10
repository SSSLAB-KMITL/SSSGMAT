"""ข้อผิดพลาดที่คาดไว้ทั้งหมด CLI จะแปลง GnssPredictError ทุกตัวเป็น exit code 1

class ที่มี attribute `code` ตรงกับรหัสในตารางหัวข้อ 9 ของ spec engine
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
    pass


class TleUnavailableError(GnssPredictError):
    pass


class TleTooOldError(GnssPredictError):
    pass


class GmatNotFoundError(GnssPredictError):
    code = "GMAT_NOT_FOUND"


class GmatRunError(GnssPredictError):
    code = "GMAT_FAILED"


class ReportError(GnssPredictError):
    pass


class Sp3UnavailableError(GnssPredictError):
    code = "TRUTH_UNAVAILABLE"


class Sp3FormatError(GnssPredictError):
    pass


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
