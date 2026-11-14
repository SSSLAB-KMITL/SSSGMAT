import logging

from fastapi import Request

from ..config import Config
from ..digests import FileDigests
from ..events import EventBus
from ..imagery import TileFetcher
from ..jobs import JobManager
from ..plans import PlanCache
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


def get_plans(request: Request) -> PlanCache:
    """dependency: แคช plan (hash ที่ scenario ต้องใช้) ของแอปที่รับ request นี้ ใช้ร่วมกับ write_tracked"""
    return request.app.state.plans


def get_digests(request: Request) -> FileDigests:
    """dependency: แคช SHA-256 ของไฟล์ผลลัพธ์ของแอปที่รับ request นี้"""
    return request.app.state.digests


def get_logger(request: Request) -> logging.Logger:
    """dependency: logger ของแอปที่รับ request นี้ (เขียนลง data/logs/server.log)"""
    return request.app.state.logger


def get_imagery(request: Request) -> TileFetcher:
    """dependency: ตัวดึงชิ้นภาพ GIBS ของแอปที่รับ request นี้ (ตัวเดียวต่อแอป: สถานะการพักและ "ไม่มีภาพ" ที่จำไว้ใช้ร่วมกันทุก request)"""
    return request.app.state.imagery
