"""สร้างแอป FastAPI: route ทั้งหมดอยู่ใต้ /api ส่วน path อื่นส่งไฟล์เว็บที่ build แล้ว (ถ้ามี)"""

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI

from .config import Config
from .errors import install_error_handlers
from .events import EventBus
from .jobs import JobManager, ProcessRunner
from .log import make_logger
from .routes import events, health, jobs, objects, orbits, scenarios
from .store import ScenarioStore


SSE_PING_S = 15.0


@asynccontextmanager
async def _lifespan(app: FastAPI):
    """เริ่มคิว job (recover, prune, thread) ตอนเปิด และหยุดตอนปิด เฉพาะเมื่อ start_background"""
    if not app.state.start_background:
        yield
        return
    app.state.jobs.start()
    try:
        yield
    finally:
        await asyncio.to_thread(app.state.jobs.stop)       # รอ GMAT/process ลูกจบได้ถึงไม่กี่วินาที ไม่บล็อก loop


def create_app(config: Config, *, start_background: bool = True) -> FastAPI:
    """start_background=False ใน test: ไม่เริ่ม thread ของคิว job (job ที่ส่งเข้าไปค้าง queued) และตัวตั้งเวลา (Task 11)"""
    config.data_dir.mkdir(parents=True, exist_ok=True)
    app = FastAPI(title="GNSS Studio", openapi_url="/api/openapi.json", docs_url="/api/docs", redoc_url=None,
                  lifespan=_lifespan)
    app.state.config = config
    app.state.start_background = start_background
    app.state.store = ScenarioStore(config.data_dir)
    app.state.logger, app.state.log_handler = make_logger(config.data_dir)
    app.state.bus = EventBus(app.state.logger)
    app.state.jobs = JobManager(config.data_dir, app.state.bus, runner=ProcessRunner(gmat_bin=config.gmat_bin),
                                logger=app.state.logger)
    app.state.sse_ping_s = SSE_PING_S               # test ตั้งให้สั้นลงได้ (ต้องตั้งก่อนเปิด /api/events)
    web_root = config.web_dist.resolve()
    install_error_handlers(app, web_root if web_root.is_dir() else None)
    app.include_router(health.router, prefix="/api")
    app.include_router(events.router, prefix="/api")
    app.include_router(scenarios.router, prefix="/api")
    app.include_router(objects.router, prefix="/api")
    app.include_router(orbits.router, prefix="/api")
    app.include_router(jobs.router, prefix="/api")
    return app
