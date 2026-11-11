"""งานพยากรณ์ประจำวัน (หัวข้อ 9.2 ของ spec server): ตัวงานของ job `daily` ที่รันใน process ลูกผ่าน worker

`run_daily(data_dir, for_date, settings, now, progress)` ทำตามลำดับ ขั้นใดล้มเหลว raise `GnssPredictError` ของขั้นนั้น
(รหัสของ engine ตรงตัว ApiError ของแม่แบบหรือ store แปลงเป็น `DailyStepError` ที่คงรหัสเดิม) ขั้นหลังจากนั้นไม่ทำ:

1. `studio.fetch_snapshot` (กติกาการดาวน์โหลดของ CelesTrak อยู่ใน engine)
2. สร้างหรือเขียนทับ scenario `daily_<YYYYMMDD>` จากแม่แบบ `thbk-gnss` ช่วง D 00:00Z ถึง D+1 00:00Z ด้วย snapshot ที่เพิ่งดึง
   และช่อง `daily = {"for_date", "created_utc"}` (เขียนจากฝั่ง server: ไม่ตรวจ ETag)
3. `studio.run_propagate` แล้ว 4. `studio.run_analyze` ของ Facility ตามค่าตั้ง `daily.facility`
5. คัดลอก `legacy_gps.csv` ของผล analyze ไปที่ `data/daily/thbk_gnss_pred_<YYYYMMDD>_24h.csv` และ `data/daily/latest.csv`
   (เขียนแบบ atomic ทีละไฟล์ ไฟล์ตามวันก่อน)

progress: ขั้นของ engine ถูกเติมชื่อขั้นนำหน้า (`fetch.omm`, `propagate.gmat`, `analyze.propagate.gmat`, ...) fraction ของทั้งงาน
ขั้นที่ GMAT ทำงานจึงลงท้าย `.gmat` เสมอ (worker ใช้รู้ว่า pgid ของ GMAT ยังใช้ได้) จบด้วย `("done", 1.0)`

ข้อความ: ของ fetch ต่อด้วยของ analyze (ซึ่งรวมของ propagate แล้ว) และปิดท้ายด้วย `DAILY_PUBLISHED`
"""

from collections.abc import Callable
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

from gnss_predict import studio
from gnss_predict.errors import GnssPredictError, Message

from .errors import ApiError
from .settings import Settings
from .store import SCENARIOS_DIR, ScenarioStore, write_atomic
from .templates import iso_utc, new_scenario

DAILY_DIR = "daily"
LATEST_CSV = "latest.csv"
LEGACY_CSV = "legacy_gps.csv"
TEMPLATE = "thbk-gnss"
SYSTEMS = "GREC"
# ขั้น -> (fraction เริ่ม, fraction จบ) ของทั้งงาน
STAGES = {"fetch": (0.0, 0.2), "scenario": (0.2, 0.25), "propagate": (0.25, 0.75), "analyze": (0.75, 0.95),
          "publish": (0.95, 1.0)}

Progress = Callable[[str, float], None]


class DailyStepError(GnssPredictError):
    """ขั้นของงานประจำวันที่ล้มเหลวด้วย ApiError ของ server (เช่น แม่แบบหา snapshot ไม่เจอ) คงรหัสเดิมไว้ให้ job"""

    def __init__(self, code: str, text: str):
        super().__init__(text)
        self.code = code


def scenario_name(for_date: date) -> str:
    return f"daily_{for_date:%Y%m%d}"


def csv_name(for_date: date) -> str:
    return f"thbk_gnss_pred_{for_date:%Y%m%d}_24h.csv"


def csv_path(data_dir: Path, for_date: date) -> Path:
    """ไฟล์ CSV 24 ชม. ของวันนั้น (มีไฟล์นี้ = พยากรณ์ของวันนั้นทำเสร็จแล้ว)"""
    return Path(data_dir) / DAILY_DIR / csv_name(for_date)


def _stage(report: Progress, stage: str) -> Progress:
    """progress ของฟังก์ชัน engine ในขั้นนั้น: เติมชื่อขั้นนำหน้าและย่อ fraction เข้าช่วงของขั้น"""
    lo, hi = STAGES[stage]
    return lambda inner, fraction: report(f"{stage}.{inner}", lo + (hi - lo) * fraction)


def _write_scenario(data_dir: Path, name: str, for_date: date, snapshot: str, now: datetime) -> None:
    """สร้าง scenario ของวันนั้น หรือเขียนทับทั้งก้อนถ้ามีอยู่แล้ว ApiError -> DailyStepError รหัสเดิม"""
    start = datetime.combine(for_date, time(0), tzinfo=timezone.utc)
    try:
        doc = new_scenario(name, start, start + timedelta(days=1), TEMPLATE, snapshot, data_dir)
        doc["daily"] = {"for_date": for_date.isoformat(), "created_utc": iso_utc(now)}
        store = ScenarioStore(data_dir)
        try:
            store.create(name, doc)
        except ApiError as exists:
            if exists.code != "NAME_EXISTS":
                raise
            try:
                store.write(name, doc, if_match=None)
            except ApiError as missing:
                if missing.code == "NOT_FOUND":       # ชื่อซ้ำแค่ต่างตัวพิมพ์ (scenario ของผู้ใช้): ไม่แตะ บอกว่าชื่อชน
                    raise exists from None
                raise
    except ApiError as exc:
        raise DailyStepError(exc.code, exc.text) from exc


def run_daily(data_dir: Path, for_date: date, settings: Settings, now: datetime, progress: Progress | None = None, *,
              console: Path | None = None, on_gmat_start: Callable[[int], None] | None = None) -> dict:
    """พยากรณ์ของวัน for_date (กติกาที่หัวไฟล์) now คือเวลาที่ดึงข้อมูล (ชื่อ snapshot และ `daily.created_utc`)

    console/on_gmat_start ส่งต่อให้ propagate และ analyze เหมือน job ชนิดอื่น
    คืน {"path": path ของ CSV ตามวัน, "scenario": ชื่อ scenario, "messages": [Message]}"""
    report = progress if progress is not None else (lambda stage, fraction: None)
    data_dir = Path(data_dir)
    now = now.astimezone(timezone.utc)
    name = scenario_name(for_date)
    scenario_dir = data_dir / SCENARIOS_DIR / name

    snapshot_dir, messages = studio.fetch_snapshot(data_dir, now, systems=SYSTEMS, progress=_stage(report, "fetch"))
    messages = list(messages)
    report("scenario", STAGES["scenario"][0])
    _write_scenario(data_dir, name, for_date, Path(snapshot_dir).name, now)
    studio.run_propagate(scenario_dir, data_dir, console=console, progress=_stage(report, "propagate"),
                         on_gmat_start=on_gmat_start)
    # run_analyze คืนข้อความของ propagate (จาก manifest ของ ephem) ต่อด้วยของ analyze: เก็บจากตรงนี้ที่เดียว ไม่ซ้ำ
    access_dir, analyze_messages = studio.run_analyze(scenario_dir, settings.daily.facility, data_dir, console=console,
                                                      progress=_stage(report, "analyze"), on_gmat_start=on_gmat_start)
    messages += analyze_messages

    report("publish", STAGES["publish"][0])
    data = (Path(access_dir) / LEGACY_CSV).read_bytes()
    out = csv_path(data_dir, for_date)
    out.parent.mkdir(parents=True, exist_ok=True)
    write_atomic(out, data)
    write_atomic(out.parent / LATEST_CSV, data)
    messages.append(Message("DAILY_PUBLISHED", "info",
                            f"พยากรณ์ GNSS ของ {settings.daily.facility} วันที่ {for_date.isoformat()} (UTC) เสร็จแล้ว: "
                            f"{DAILY_DIR}/{out.name} และ {DAILY_DIR}/{LATEST_CSV}"))
    report("done", 1.0)
    return {"path": out, "scenario": name, "messages": messages}
