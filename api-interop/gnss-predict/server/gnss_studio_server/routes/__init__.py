from fastapi import Request

from ..config import Config


def get_config(request: Request) -> Config:
    """dependency: Config ของแอปที่รับ request นี้"""
    return request.app.state.config
