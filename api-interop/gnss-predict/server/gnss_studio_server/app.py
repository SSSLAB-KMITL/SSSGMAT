"""สร้างแอป FastAPI: route ทั้งหมดอยู่ใต้ /api ส่วน path อื่นส่งไฟล์เว็บที่ build แล้ว (ถ้ามี)"""

from fastapi import FastAPI

from .config import Config
from .errors import install_error_handlers
from .log import make_logger
from .routes import health, objects, scenarios
from .store import ScenarioStore


def create_app(config: Config, *, start_background: bool = True) -> FastAPI:
    """start_background=False ใน test: ไม่เริ่ม job thread และตัวตั้งเวลา (ทั้งสองเริ่มมีใน Task 6 และ 11)"""
    config.data_dir.mkdir(parents=True, exist_ok=True)
    app = FastAPI(title="GNSS Studio", openapi_url="/api/openapi.json", docs_url="/api/docs", redoc_url=None)
    app.state.config = config
    app.state.start_background = start_background
    app.state.store = ScenarioStore(config.data_dir)
    app.state.logger, app.state.log_handler = make_logger(config.data_dir)
    web_root = config.web_dist.resolve()
    install_error_handlers(app, web_root if web_root.is_dir() else None)
    app.include_router(health.router, prefix="/api")
    app.include_router(scenarios.router, prefix="/api")
    app.include_router(objects.router, prefix="/api")
    return app
