from fastapi import Request

from ..config import Config
from ..events import EventBus
from ..jobs import JobManager
from ..store import ScenarioStore


def get_config(request: Request) -> Config:
    """dependency: Config ของแอปที่รับ request นี้"""
    return request.app.state.config


def get_store(request: Request) -> ScenarioStore:
    """dependency: ScenarioStore ของแอปที่รับ request นี้ (ตัวเดียวต่อแอป เพื่อให้ล็อกต่อ scenario ใช้ร่วมกัน)"""
    return request.app.state.store


def get_bus(request: Request) -> EventBus:
    """dependency: EventBus ของแอปที่รับ request นี้ (ตัวเดียวต่อแอป: ทุก route ส่ง event เข้า bus เดียวกับที่ /api/events ฟัง)"""
    return request.app.state.bus


def get_jobs(request: Request) -> JobManager:
    """dependency: คิว job ของแอปที่รับ request นี้"""
    return request.app.state.jobs
