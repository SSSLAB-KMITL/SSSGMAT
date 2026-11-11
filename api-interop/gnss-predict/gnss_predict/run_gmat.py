"""หา GmatConsole และรัน GMAT script (หัวข้อ 5.4 ของ spec)"""

import os
import signal
import subprocess
from collections.abc import Callable, Mapping
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


def _kill_group(proc: subprocess.Popen) -> None:
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):      # จบไปแล้ว: macOS ตอบ EPERM เมื่อกลุ่มเหลือแต่ zombie
        pass
    proc.communicate()


def run_script(console: Path, script: Path, log: Path, timeout_s: float = 600,
               on_start: Callable[[int], None] | None = None) -> None:
    """รัน GmatConsole --run script ถ้า exit code ไม่เป็น 0, หมดเวลา หรือ log มี error ให้ raise GmatRunError

    on_start(pgid) ถูกเรียกทันทีหลังสร้าง process ด้วย process group id ของ GMAT (ตรงกับ pid เพราะรันใน session ใหม่)
    ผู้เรียกใช้ os.killpg(pgid, ...) ยกเลิกงานได้จาก thread อื่น ถ้า on_start raise จะฆ่ากลุ่มนั้นก่อนแล้วโยน exception ต่อ
    """
    cmd = [str(console), "--run", str(script), "--logfile", str(log)]
    try:
        # แยก process group เพื่อ kill ได้ทั้งกลุ่มตอนหมดเวลา ไม่ให้ process ลูกถือ pipe ค้างไว้
        # cwd ต้องเป็นโฟลเดอร์ของไฟล์จริง GMAT_BIN อาจเป็น symlink ที่อยู่นอก bin/ ของ GMAT
        proc = subprocess.Popen(cmd, cwd=Path(console).resolve().parent, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, text=True, start_new_session=True)
    except OSError as exc:
        raise GmatRunError(f"เรียก GMAT ไม่ได้: {exc}") from exc
    if on_start is not None:
        try:
            on_start(os.getpgid(proc.pid))
        except BaseException:
            _kill_group(proc)                       # ไม่ปล่อย GMAT ที่ไม่มีใครถือ pgid ทำงานค้าง
            raise
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
    """ชื่อไฟล์จริงของ GmatConsole (มีเลขรุ่น เช่น GmatConsole-R2026a) ต่อด้วยบรรทัด Build Date

    GmatConsole --version ไม่พิมพ์เลขรุ่น จึงใช้ชื่อไฟล์ที่ symlink ชี้ไปแทน
    """
    try:
        r = subprocess.run([str(console), "--version"], capture_output=True, text=True, timeout=30,
                           cwd=Path(console).resolve().parent)
    except (OSError, subprocess.TimeoutExpired):
        return "unknown"
    if r.returncode != 0:
        return "unknown"
    name = Path(console).resolve().name
    build = next((" ".join(l.split()) for l in r.stdout.splitlines() if l.strip().startswith("Build Date:")), None)
    return f"{name} ({build})" if build else name
