"""ข้อผิดพลาดที่คาดไว้ทั้งหมด CLI จะแปลง GnssPredictError ทุกตัวเป็น exit code 1"""


class GnssPredictError(Exception):
    pass


class TleUnavailableError(GnssPredictError):
    pass


class TleTooOldError(GnssPredictError):
    pass


class GmatNotFoundError(GnssPredictError):
    pass


class GmatRunError(GnssPredictError):
    pass


class ReportError(GnssPredictError):
    pass


class Sp3UnavailableError(GnssPredictError):
    pass


class Sp3FormatError(GnssPredictError):
    pass
