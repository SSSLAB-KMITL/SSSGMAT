"""Job (หัวข้อ 6.8 และ 7 ของ spec server): รายการ รายละเอียด และ Stop บนแถบสถานะ

การส่ง job เข้าคิวอยู่ที่ route ของงานนั้น ๆ (เช่น validate ของ scenario) ซึ่งเรียก `JobManager.submit`
"""

from typing import Literal

from fastapi import APIRouter, Depends

from ..jobs import JobManager
from . import get_jobs

router = APIRouter()

JobState = Literal["queued", "running", "succeeded", "failed", "cancelled"]


@router.get("/jobs")
def list_jobs(state: JobState | None = None, jobs: JobManager = Depends(get_jobs)) -> list[dict]:
    """ใหม่ก่อน state ผิด -> 422 ที่ field state"""
    return [rec.to_dict() for rec in jobs.list(state)]


@router.get("/jobs/{job_id}")
def get_job(job_id: str, jobs: JobManager = Depends(get_jobs)) -> dict:
    return jobs.get(job_id).to_dict()


@router.post("/jobs/{job_id}/cancel")
def cancel_job(job_id: str, jobs: JobManager = Depends(get_jobs)) -> dict:
    """ที่ยังรอ: cancelled ทันที ที่กำลังรัน: ฆ่า GMAT และ process ลูกแล้วตอบเมื่อบันทึกเป็น cancelled ที่จบแล้ว: คืนตามเดิม"""
    return jobs.cancel(job_id).to_dict()
