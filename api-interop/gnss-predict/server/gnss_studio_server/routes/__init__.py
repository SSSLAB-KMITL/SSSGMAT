from fastapi import Request

from ..config import Config
from ..store import ScenarioStore


def get_config(request: Request) -> Config:
    """dependency: Config ของแอปที่รับ request นี้"""
    return request.app.state.config


def get_store(request: Request) -> ScenarioStore:
    """dependency: ScenarioStore ของแอปที่รับ request นี้ (ตัวเดียวต่อแอป เพื่อให้ล็อกต่อ scenario ใช้ร่วมกัน)"""
    return request.app.state.store
