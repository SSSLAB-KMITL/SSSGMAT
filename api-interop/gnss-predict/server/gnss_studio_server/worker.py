"""ตัวทำงานของ job หนึ่งตัว (หัวข้อ 7.2 ของ spec server): เรียกฟังก์ชันของ engine แล้วส่งผลกลับทางคิว

`run_job` รันใน process ลูก (ProcessRunner, multiprocessing แบบ spawn) หรือใน thread ของคิว (InlineRunner ของ test)
ส่งเข้า `out` (อะไรก็ได้ที่มี `put`: ใน process ลูกคือ `PipeOut` ปลายเขียนของท่อ) ตามลำดับ:

- `("progress", stage, fraction)` ทุกครั้งที่ engine รายงาน
- `("gmat_pgid", pgid)` ทันทีที่ GMAT เริ่ม (process group ของ GMAT ไว้ยกเลิกงาน) และ `("gmat_pgid", None)` เมื่อ GMAT
  ไม่ได้ทำงานแล้ว: progress ออกจากขั้น gmat หรือฟังก์ชันของ engine คืนค่า/raise (หลัง GMAT จบ pid นั้นถูกใช้ซ้ำได้)
- `("message", {code, level, text, object})` ข้อความของ engine
- ปิดท้ายด้วย `("result", {"path": <path ผลลัพธ์เทียบกับ data_dir>, ...})` หรือ `("error", {code, text, detail})` อย่างใดอย่างหนึ่ง
  error ที่ไม่คาดไว้ได้รหัส `INTERNAL` และมีช่อง `traceback` เพิ่ม (คิวเอาออกแล้วเขียนลง log ของ server)

ใน process ลูก SIGTERM (ยกเลิกหรือปิด server) ฆ่า GMAT ที่ยังทำงานอยู่ก่อนแล้วจึงออก: GMAT อยู่ใน session ของตัวเอง
จะไม่ตายตาม process ลูก `kill_group` เป็นตัวกันการฆ่ากลุ่มผิดตัวเดียวที่ทั้ง process ลูกและ JobManager ใช้

โมดูลนี้ import แค่ engine (ไม่ import fastapi/pydantic) process ลูกจึงเริ่มเร็ว ยกเว้นงาน `daily` ที่นำเข้า `daily.py` ตอนรัน
(ค่าตั้งของงานประจำวันอ่านใหม่ใน process ลูกด้วย `settings.load`)
"""

import multiprocessing
import os
import signal
import threading
import traceback
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

from gnss_predict import studio
from gnss_predict.errors import GmatRunError, GnssPredictError

SCENARIOS_DIR = "scenarios"            # เท่ากับ store.SCENARIOS_DIR (ไม่ import store: จะพา fastapi มาใน process ลูก)
DEFAULT_SYSTEMS = "GREC"
GMAT_LOG_TAIL_LINES = 20
INTERNAL_TEXT_MAX = 200
TRACEBACK_MAX = 8000                   # ตัวอักษรท้าย traceback ที่ส่งกลับไปลง log ของ server


def kill_group(pgid: int | None) -> None:
    """SIGKILL ทั้ง process group ของ GMAT ไม่แตะ None, pgid <= 1 หรือกลุ่มของ process ที่เรียกเอง
    กลุ่มที่จบไปแล้วไม่ถือเป็น error (macOS ตอบ EPERM เมื่อกลุ่มเหลือแต่ zombie)"""
    if pgid is None or pgid <= 1 or pgid == os.getpgrp():
        return
    try:
        os.killpg(pgid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        pass


class PipeOut:
    """ปลายเขียนของท่อจาก process ลูกถึง JobManager: put() ส่งทันที (ไม่มี thread ป้อนข้อมูล ข้อความที่ put แล้วไม่ค้างในบัฟเฟอร์
    ตอนถูกยุติ) process แม่ไม่ถือปลายเขียนไว้ กรอบข้อความที่ขาดกลางเพราะ process ลูกตายจึงอ่านได้ EOF ไม่ค้าง"""

    def __init__(self, conn):
        self.conn = conn

    def put(self, item) -> None:
        self.conn.send(item)


class _Gmat:
    """ติดตาม pgid ของ GMAT ที่กำลังทำงานใน process นี้ และแจ้งคิวเมื่อได้หรือเลิกใช้"""

    def __init__(self, out):
        self.out = out
        self.pgid: int | None = None

    def started(self, pgid: int) -> None:
        self.pgid = pgid
        self.out.put(("gmat_pgid", pgid))

    def clear(self) -> None:
        if self.pgid is not None:
            self.pgid = None
            self.out.put(("gmat_pgid", None))

    def progress(self, stage: str, fraction: float) -> None:
        if self.pgid is not None and not _is_gmat_stage(stage):
            self.clear()
        self.out.put(("progress", stage, float(fraction)))


def _is_gmat_stage(stage: str) -> bool:
    """ขั้น gmat ของ propagate ตรง ๆ หรือที่ซ้อนอยู่ใน analyze/validate ("propagate.gmat")"""
    return stage == "gmat" or stage.endswith(".gmat")


# ---------- ตัวงานของแต่ละ kind: คืน (path ผลลัพธ์, ข้อความ, ช่องเพิ่มของ result) ----------

def _propagate(scenario_dir, data_dir, params, console, gmat):
    path, messages = studio.run_propagate(scenario_dir, data_dir, console=console, progress=gmat.progress,
                                          on_gmat_start=gmat.started)
    return path, messages, {}


def _analyze(scenario_dir, data_dir, params, console, gmat):
    facility = params["facility"]
    path, messages = studio.run_analyze(scenario_dir, facility, data_dir, console=console, progress=gmat.progress,
                                        on_gmat_start=gmat.started)
    return path, messages, {"facility": facility}


def _validate(scenario_dir, data_dir, params, console, gmat):
    sp3 = data_dir / params["sp3"] if params.get("sp3") else None
    path, messages = studio.run_validate(scenario_dir, date.fromisoformat(params["day"]), data_dir, sp3=sp3,
                                         facility=params.get("facility"), console=console, progress=gmat.progress,
                                         on_gmat_start=gmat.started)
    return path, messages, {}


def _fetch(scenario_dir, data_dir, params, console, gmat):
    path, messages = studio.fetch_snapshot(data_dir, datetime.now(timezone.utc),
                                           systems=params.get("systems", DEFAULT_SYSTEMS), progress=gmat.progress)
    return path, messages, {"snapshot": Path(path).name}


def _daily(scenario_dir, data_dir, params, console, gmat):
    # นำเข้าตอนใช้: daily ใช้แม่แบบและ store (pydantic/fastapi) ซึ่ง process ลูกของงานชนิดอื่นไม่ต้องโหลด
    from . import daily, settings
    out = daily.run_daily(data_dir, date.fromisoformat(params["for_date"]), settings.load(data_dir),
                          datetime.now(timezone.utc), gmat.progress, console=console, on_gmat_start=gmat.started)
    return out["path"], out["messages"], {"scenario": out["scenario"]}


JOB_BODIES = {"fetch": _fetch, "propagate": _propagate, "analyze": _analyze, "validate": _validate, "daily": _daily}


# ---------- แปลงผลและ error ----------

def _relative(path: Path, data_dir: Path) -> str:
    try:
        return Path(path).resolve().relative_to(data_dir.resolve()).as_posix()
    except ValueError:
        return str(path)


def error_dict(exc: GnssPredictError) -> dict:
    """{code, text, detail}: GmatRunError ที่มี log (บรรทัดแรกคือสรุป ที่เหลือคือท้าย log) แยกท้าย log ไปไว้ใน detail"""
    text, detail = str(exc), None
    if isinstance(exc, GmatRunError) and "\n" in text:
        text, log = text.split("\n", 1)
        detail = "\n".join(log.splitlines()[-GMAT_LOG_TAIL_LINES:]) or None
    return {"code": exc.code, "text": text, "detail": detail}


def _internal(exc: BaseException) -> dict:
    summary = f"{type(exc).__name__}: {exc}"[:INTERNAL_TEXT_MAX]
    return {"code": "INTERNAL", "text": f"เกิดข้อผิดพลาดภายในที่ไม่คาดไว้ ({summary}) ดูรายละเอียดใน data/logs/server.log",
            "detail": None, "traceback": traceback.format_exc()[-TRACEBACK_MAX:]}


def _install_signal_handlers(gmat: _Gmat) -> None:
    """เฉพาะ thread หลักของ process ลูก: SIGTERM ฆ่า GMAT ที่ยังทำงานอยู่ก่อน แล้วออกแบบปกติ (SystemExit)

    ไม่สนใจ SIGINT: Ctrl-C ที่ terminal ส่งถึงทั้งกลุ่ม ให้ server เป็นผู้หยุดงานตามลำดับ (JobManager.stop)"""
    if multiprocessing.parent_process() is None or threading.current_thread() is not threading.main_thread():
        return
    signal.signal(signal.SIGINT, signal.SIG_IGN)

    def on_sigterm(signum, frame):
        kill_group(gmat.pgid)
        raise SystemExit(128 + signum)

    signal.signal(signal.SIGTERM, on_sigterm)


def run_job(kind: str, scenario: str | None, params: dict, data_dir: str, gmat_bin: str | None, out: Any) -> None:
    """ทำ job หนึ่งตัวแล้วส่งผลเข้า out (ดูรูปแบบที่หัวไฟล์) ไม่ raise ยกเว้น SystemExit จาก SIGTERM"""
    gmat = _Gmat(out)
    _install_signal_handlers(gmat)
    root = Path(data_dir)
    try:
        body = JOB_BODIES[kind]
        scenario_dir = root / SCENARIOS_DIR / scenario if scenario is not None else None
        console = Path(gmat_bin) if gmat_bin else None
        path, messages, extra = body(scenario_dir, root, params, console, gmat)
    except GnssPredictError as exc:
        gmat.clear()
        out.put(("error", error_dict(exc)))
        return
    except Exception as exc:
        gmat.clear()
        out.put(("error", _internal(exc)))
        return
    gmat.clear()
    for message in messages:
        out.put(("message", message.to_dict()))
    out.put(("result", {"path": _relative(path, root), **extra}))
