"""error ที่ API ตอบกลับ: {code, level, text, object} (หัวข้อ 7.4 ของ spec) ข้อความ text เป็นภาษาไทย"""


class ApiError(Exception):
    def __init__(self, code: str, status: int, text: str, object: str | None = None):
        super().__init__(text)
        self.code, self.status, self.text, self.object = code, status, text, object

    def to_dict(self) -> dict:
        return {"code": self.code, "level": "error", "text": self.text, "object": self.object}
