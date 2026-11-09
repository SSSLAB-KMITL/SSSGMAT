"""หา GmatConsole และรัน GMAT script (หัวข้อ 5.4 ของ spec)"""

import os
import signal
import subprocess
from collections.abc import Mapping
from pathlib import Path

from .config import REPO_ROOT
from .errors import GmatNotFoundError, GmatRunError

_ERROR_MARK = "**** ERROR ****"
_TAIL_LINES = 20


def _executable(p: Path) -> bool:
    return p.is_file() and os.access(p, os.X_OK)


def find_gmat_console(environ: Mapping[str, str] = os.environ, repo_root: Path = REPO_ROOT) -> Path:
    env = environ.get("GMAT_BIN")
    if env:
        p = Path(env)
        if _executable(p):
            return p
        raise GmatNotFoundError(f"GMAT_BIN ชี้ไปที่ {p} ซึ่งไม่ใช่ไฟล์ที่รันได้")
    p = Path(repo_root) / "application" / "bin" / "GmatConsole"
    if _executable(p):
        return p
    raise GmatNotFoundError(
        f"ไม่พบ GmatConsole ที่ {p} ให้ build GMAT ก่อน (ดู README) "
        "หรือตั้งตัวแปร GMAT_BIN ให้ชี้ไปที่ไฟล์ GmatConsole")


def _tail(log: Path, fallback: str) -> str:
    text = log.read_text(errors="replace") if log.exists() else fallback
    return "\n".join(text.splitlines()[-_TAIL_LINES:])


def run_script(console: Path, script: Path, log: Path, timeout_s: float = 600) -> None:
    """รัน GmatConsole --run script ถ้า exit code ไม่เป็น 0, หมดเวลา หรือ log มี error ให้ raise GmatRunError"""
    cmd = [str(console), "--run", str(script), "--logfile", str(log)]
    try:
        # แยก process group เพื่อ kill ได้ทั้งกลุ่มตอนหมดเวลา ไม่ให้ process ลูกถือ pipe ค้างไว้
        proc = subprocess.Popen(cmd, cwd=Path(console).parent, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, text=True, start_new_session=True)
    except OSError as exc:
        raise GmatRunError(f"เรียก GMAT ไม่ได้: {exc}") from exc
    try:
        out, err = proc.communicate(timeout=timeout_s)
    except subprocess.TimeoutExpired:
        os.killpg(proc.pid, signal.SIGKILL)
        out, err = proc.communicate()
        raise GmatRunError(f"GMAT ทำงานเกิน {timeout_s:g} วินาที\n{_tail(log, out + err)}")
    if proc.returncode != 0:
        raise GmatRunError(f"GMAT จบด้วย exit code {proc.returncode}\n{_tail(log, out + err)}")
    log_text = log.read_text(errors="replace") if log.exists() else ""
    if _ERROR_MARK in log_text or _ERROR_MARK in out:
        raise GmatRunError(f"GMAT รายงานข้อผิดพลาด\n{_tail(log, out + err)}")


def gmat_version(console: Path) -> str:
    try:
        r = subprocess.run([str(console), "--version"], capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.TimeoutExpired):
        return "unknown"
    if r.returncode != 0:
        return "unknown"
    return next((l.strip() for l in r.stdout.splitlines() if l.strip()), "unknown")
