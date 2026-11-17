"""สร้างแอป FastAPI: route ทั้งหมดอยู่ใต้ /api ส่วน path อื่นส่งไฟล์เว็บที่ build แล้ว (ถ้ามี)"""

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI

from gnss_predict.dataproviders import TableCache

from .config import Config
from .digests import FileDigests
from .errors import install_error_handlers
from .events import EventBus
from .guard import install_guards
from .imagery import TileFetcher
from .jobs import JobManager, ProcessRunner
from .log import make_logger
from .plans import PlanCache
from .routes import (access, daily, events, health, imagery, jobs, objects, orbits, reports, results, scenarios,
                     settings, validation)
from .scheduler import Scheduler
from .store import ScenarioStore
from .styles import MyStyles


SSE_PING_S = 15.0
TABLE_CACHE_SIZE = 4        # bundle ที่ตารางอยู่ในหน่วยความจำพร้อมกัน (LRU): ราว 135 MB ต่อ bundle (130 ดาว 1 วัน) 8 bundle ถึง 0.4-1.1 GB


@asynccontextmanager
async def _lifespan(app: FastAPI):
    """เริ่มคิว job (recover, prune, thread) แล้วตัวตั้งเวลา ตอนเปิด และหยุดกลับลำดับตอนปิด เฉพาะเมื่อ start_background

    คิวต้องเริ่มก่อน: recover เปลี่ยนงานประจำวันที่ค้างเป็น INTERRUPTED ก่อน tick แรก ซึ่งจึงสั่งรอบที่ถูกขัดจังหวะใหม่ได้ทันที"""
    if not app.state.start_background:
        yield
        return
    app.state.jobs.start()
    try:
        app.state.scheduler.start()
        try:
            yield
        finally:
            await asyncio.to_thread(app.state.scheduler.stop)
    finally:
        await asyncio.to_thread(app.state.jobs.stop)       # รอ GMAT/process ลูกจบได้ถึงไม่กี่วินาที ไม่บล็อก loop


def create_app(config: Config, *, start_background: bool = True) -> FastAPI:
    """start_background=False ใน test: ไม่เริ่ม thread ของคิว job (job ที่ส่งเข้าไปค้าง queued) และของตัวตั้งเวลา"""
    config.data_dir.mkdir(parents=True, exist_ok=True)
    app = FastAPI(title="GNSS Studio", openapi_url="/api/openapi.json", docs_url="/api/docs", redoc_url=None,
                  lifespan=_lifespan)
    app.state.config = config
    app.state.start_background = start_background
    app.state.store = ScenarioStore(config.data_dir)
    app.state.logger, app.state.log_handler = make_logger(config.data_dir)
    install_guards(app, config, app.state.logger)  # Host ของ server เอง และ Origin ของ server เองสำหรับคำขอที่แก้ข้อมูล
    app.state.plans = PlanCache(app.state.store, app.state.logger)
    app.state.digests = FileDigests()
    app.state.tables = TableCache(TABLE_CACHE_SIZE)     # ตารางของ bundle ที่อ่านแล้ว ตัวเดียวต่อแอป (route /data และ /reports)
    app.state.my_styles = MyStyles(config.data_dir, app.state.logger)
    app.state.imagery = TileFetcher(config.data_dir, logger=app.state.logger,   # ตัวเดียวต่อแอป; test แทน opener/นาฬิกาได้
                                    enabled=lambda source: imagery.source_enabled(config, app.state.logger, source))   # ตรวจสวิตช์ของแหล่งซ้ำก่อนต่อเน็ต
    app.state.bus = EventBus(app.state.logger)
    app.state.jobs = JobManager(config.data_dir, app.state.bus, runner=ProcessRunner(gmat_bin=config.gmat_bin),
                                logger=app.state.logger)
    app.state.scheduler = Scheduler(config.data_dir, app.state.jobs, bus=app.state.bus, logger=app.state.logger)
    app.state.settings_on_change = app.state.scheduler.wake   # PUT /api/settings เรียกหลังบันทึก: tick ใหม่ทันที (อ่านค่าตั้งใหม่เอง)
    app.state.sse_ping_s = SSE_PING_S               # test ตั้งให้สั้นลงได้ (ต้องตั้งก่อนเปิด /api/events)
    web_root = config.web_dist.resolve()
    install_error_handlers(app, web_root if web_root.is_dir() else None)
    app.include_router(health.router, prefix="/api")
    app.include_router(events.router, prefix="/api")
    app.include_router(scenarios.router, prefix="/api")
    app.include_router(objects.router, prefix="/api")
    app.include_router(orbits.router, prefix="/api")
    app.include_router(results.router, prefix="/api")
    app.include_router(access.router, prefix="/api")
    app.include_router(reports.router, prefix="/api")
    app.include_router(jobs.router, prefix="/api")
    app.include_router(daily.router, prefix="/api")
    app.include_router(validation.router, prefix="/api")
    app.include_router(settings.router, prefix="/api")
    app.include_router(imagery.router, prefix="/api")
    return app
