"""สั่งงานพยากรณ์ประจำวันเอง (หัวข้อ 6.8 และ 9.3 ของ spec server)

- `POST /daily/run` body ไม่บังคับ `{"for_date"?: "YYYY-MM-DD"}` ไม่ระบุ = วันถัดไปตาม UTC (D เดียวกับที่ตัวตั้งเวลาใช้)
  ส่ง job `daily` `{"for_date"}` origin `user` ตอบ 202 `{"job": id}` (ดึงข้อมูลจากเน็ตเหมือนงานที่ตัวตั้งเวลาสั่ง)
- `for_date` ต้องเป็นวันที่ที่มีจริง (`schema.check_day`) และอยู่ในช่วงเมื่อวาน ถึง พรุ่งนี้ ตาม UTC ไม่งั้น 422 ที่ field `for_date`
- มี job daily ของวันนั้นที่รออยู่หรือกำลังรัน (ใครสั่งก็ตาม) -> 409 `JOB_RUNNING` (detail = id ของ job นั้น)
- สั่งซ้ำได้สำหรับวันที่ล้มเหลว ถูกยกเลิก ถูกขัดจังหวะ หรือทำเสร็จแล้ว: สำเร็จแล้วเขียนทับ CSV ของวันนั้นและ latest.csv
- ไม่เปลี่ยนช่วงไล่ทันอัตโนมัติของตัวตั้งเวลา (สั่งเองเท่านั้น) job ที่สั่งเองนับเป็นรอบของวันนั้นในกติกาของตัวตั้งเวลา
"""

from datetime import date, timedelta

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict

from ..errors import ApiError
from ..jobs import JobManager
from ..schema import check_day
from . import get_jobs

router = APIRouter()

WINDOW_TEXT = "for_date ต้องอยู่ระหว่าง {first} ถึง {last} (เมื่อวาน ถึง พรุ่งนี้ ตาม UTC) ไม่ใช่ {day}"


class DailyRunBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    for_date: str | None = None                            # ตรวจรูปแบบด้วย check_day (ข้อความเดียวกับ day ของ validate)


@router.post("/daily/run", status_code=202)
def run_daily(body: DailyRunBody | None = None, jobs: JobManager = Depends(get_jobs)) -> dict:
    today = jobs.clock().date()
    first, last = today - timedelta(days=1), today + timedelta(days=1)
    requested = body.for_date if body is not None and "for_date" in body.model_fields_set else last.isoformat()
    day = date.fromisoformat(check_day(requested, "for_date"))
    if not first <= day <= last:
        raise ApiError(422, "SCENARIO_INVALID", WINDOW_TEXT.format(first=first, last=last, day=day), "for_date")
    return {"job": jobs.submit("daily", None, {"for_date": day.isoformat()}, reuse_active=False).id}
