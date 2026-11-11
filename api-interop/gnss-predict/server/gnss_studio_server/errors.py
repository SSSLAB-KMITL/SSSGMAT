"""แปลง error ทุกชนิดเป็นรูปแบบเดียว {"code", "text", "field", "detail"} (หัวข้อ 10 ของ spec)"""

import json
import uuid
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, Response
from starlette.exceptions import HTTPException as StarletteHTTPException

from gnss_predict.errors import GnssPredictError, ScenarioError

NOT_FOUND_TEXT = "ไม่พบรายการที่ร้องขอ"
METHOD_NOT_ALLOWED_TEXT = "path นี้ไม่รองรับวิธีเรียกแบบนี้"
VALIDATION_TEXT = "ข้อมูลที่ส่งมาไม่ถูกต้อง"
HTTP_ERROR_TEXT = "คำขอไม่สำเร็จ"
INTERNAL_TEXT = "เกิดข้อผิดพลาดภายในของ server (เลขอ้างอิง {ref}) ดูรายละเอียดใน data/logs/server.log"


class ApiError(Exception):
    def __init__(self, status: int, code: str, text: str, field: str | None = None, detail: str | None = None):
        super().__init__(text)
        self.status, self.code, self.text, self.field, self.detail = status, code, text, field, detail


def error_response(status: int, code: str, text: str, field: str | None = None, detail: str | None = None,
                   headers: dict[str, str] | None = None) -> JSONResponse:
    return JSONResponse({"code": code, "text": text, "field": field, "detail": detail},
                        status_code=status, headers=headers)


def _api_error(request: Request, exc: ApiError) -> JSONResponse:
    return error_response(exc.status, exc.code, exc.text, exc.field, exc.detail)


def _engine_error(request: Request, exc: GnssPredictError) -> JSONResponse:
    field = exc.field if isinstance(exc, ScenarioError) else None
    return error_response(422, exc.code, str(exc), field)


def _validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
    first = exc.errors()[0] if exc.errors() else {}
    # ตัด body/query/path ออก เหลือชื่อช่อง; JSON ที่อ่านไม่ได้มี loc เป็นตำแหน่งตัวอักษร ไม่ใช่ชื่อช่อง
    loc = [] if first.get("type") == "json_invalid" else [str(p) for p in first.get("loc", ())[1:]]
    return error_response(422, "SCENARIO_INVALID", VALIDATION_TEXT, ".".join(loc) or None, first.get("msg"))


def _internal_error(request: Request, exc: Exception) -> JSONResponse:
    ref = uuid.uuid4().hex[:8]
    request.app.state.logger.error("INTERNAL ref=%s %s %s", ref, request.method, request.url.path, exc_info=exc)
    return error_response(500, "INTERNAL", INTERNAL_TEXT.format(ref=ref), detail=ref)


def _web_file(web_root: Path, url_path: str) -> Path | None:
    """ไฟล์ใต้ web_root ที่ตรงกับ url_path หรือ None (ไม่ยอมออกนอก web_root)"""
    try:
        candidate = (web_root / url_path.lstrip("/")).resolve()
        if candidate.is_file() and candidate.is_relative_to(web_root):
            return candidate
    except (OSError, ValueError):
        pass
    return None


def _spa_response(web_root: Path, url_path: str) -> Response | None:
    """ไฟล์จริงถ้ามี ไม่งั้น index.html (ให้ router ฝั่งหน้าเว็บจัดการ path เอง) ไม่มี index.html คืน None"""
    target = _web_file(web_root, url_path) or _web_file(web_root, "index.html")
    return FileResponse(target) if target else None


def _detail_text(detail) -> str | None:
    """detail ของ HTTPException เป็นอะไรก็ได้ (มักเป็นอังกฤษ) เก็บไว้ในช่อง detail เป็นสตริงเสมอ ไม่ใช้เป็น text ถึงผู้ใช้"""
    if detail is None or isinstance(detail, str):
        return detail
    return json.dumps(detail, ensure_ascii=False, default=str)


def _http_error(web_root: Path | None):
    def handler(request: Request, exc: StarletteHTTPException) -> Response:
        path = request.url.path
        is_api = path == "/api" or path.startswith("/api/")
        if exc.status_code == 404:
            if web_root is not None and not is_api and request.method in ("GET", "HEAD"):
                page = _spa_response(web_root, path)
                if page is not None:
                    return page
            return error_response(404, "NOT_FOUND", NOT_FOUND_TEXT, headers=exc.headers)
        if exc.status_code == 405:
            return error_response(405, "METHOD_NOT_ALLOWED", METHOD_NOT_ALLOWED_TEXT, headers=exc.headers)
        return error_response(exc.status_code, "HTTP_ERROR", HTTP_ERROR_TEXT, detail=_detail_text(exc.detail),
                              headers=exc.headers)
    return handler


def install_error_handlers(app: FastAPI, web_root: Path | None) -> None:
    """web_root: โฟลเดอร์เว็บที่ build แล้ว (None ถ้าไม่มี) ใช้ส่งไฟล์และ SPA fallback เมื่อ path ไม่ตรง route ใด"""
    app.add_exception_handler(ApiError, _api_error)
    app.add_exception_handler(GnssPredictError, _engine_error)
    app.add_exception_handler(RequestValidationError, _validation_error)
    app.add_exception_handler(StarletteHTTPException, _http_error(web_root))
    app.add_exception_handler(Exception, _internal_error)
