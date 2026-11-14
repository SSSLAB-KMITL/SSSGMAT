"""transponder (หัวข้อ 7 ของ spec งานย่อย 3, ref-R §10 และ §11): แปลงข้อมูล SatNOGS DB เป็นไฟล์ต่อดาวและอ่านกลับ

- ที่เก็บ: data/trsp/<NORAD>.json เป็นรายการ {name, up_low, up_high, down_low, down_high, invert, mode, baud} ตามลำดับใน JSON ของ SatNOGS
  (ค่าตาม SatNOGS ทุกช่อง ค่าที่ไม่มีเป็น 0 การปรับค่าตาม ref-R §10.1 ทำตอนอ่านใน normalise)
  และ data/trsp/_cache/{modes.json, transmitters.json, state.json}
- update_from_network (Edit -> Update transponder data): ส่ง request ได้ 1 ครั้งต่อ 2 ชม. (TRSP_MIN_INTERVAL) นับจาก requested_at ใน state.json
  ซึ่งบันทึกก่อนส่ง จึงนับทั้งที่ล้มเหลว ภายใน 2 ชม. ไม่ส่ง request แต่แปลงจาก _cache เดิม (ถ้ามี)
  ดึง modes แล้ว transmitters ลงไฟล์ชั่วคราวใน _cache และ rename เข้าที่เมื่อสำเร็จทั้งคู่และแปลงได้แล้วเท่านั้น แล้วบันทึก succeeded_at
  ล้มเหลว (ต่อเน็ตไม่ได้, HTTP error, timeout, คำตอบไม่ใช่ JSON ที่ใช้ได้): ไม่แตะไฟล์ต่อดาวและ _cache เดิม (Gpredict ล้าง cache ก่อนดึง) (ของเรา)
  ดาวที่ไม่อยู่ในข้อมูลใหม่คงไฟล์เดิมเหมือน Gpredict
- request มี User-Agent "gpredict-web" อย่างเดียว ไม่มี header อื่น และ URL ไม่มีข้อมูลผู้ใช้
- log เป็นภาษาอังกฤษตาม ref-R §11.2 และ §10.1 โดยตัด "%s:" ตัวหน้า (ชื่อฟังก์ชันของ Gpredict) ออก ข้อความถึงผู้ใช้ (Message) เป็นภาษาไทย (ของเรา)
- การเรียก update_from_network ต้องทีละครั้ง (state file ไม่มี lock) route ใน app.py ถือ lock ให้ (decision 13)
"""

import json
import logging
import math
import os
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from http.client import HTTPException
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from gnss_predict import omm
from gnss_predict.errors import Message

from .store import write_json_atomic

SATNOGS_API = "https://db.satnogs.org/api/"
MODES_URL = SATNOGS_API + "modes/?format=json"
TRANSMITTERS_URL = SATNOGS_API + "transmitters/?format=json"
USER_AGENT = "gpredict-web"                     # (ของเรา) Gpredict ใช้ "gpredict/curl" เรา "gpredict-web" และไม่ใส่ข้อมูลผู้ใช้
TRSP_MIN_INTERVAL = timedelta(hours=2)
TRSP_TIMEOUT_S = 30
TRSP_NAME_MAX = 79
TRSP_MODE_MAX = 19

TRSP_DIR = "trsp"
CACHE_DIR = "_cache"
STATE_FILE = "state.json"
MODES_FILE = "modes.json"
TRANSMITTERS_FILE = "transmitters.json"

_STATE_TIME_FMT = "%Y-%m-%dT%H:%M:%SZ"          # รูปแบบเดียวกับ state file ของกติกา CelesTrak (omm.parse_state_time)
_SHOW_TIME_FMT = "%Y-%m-%d %H:%M:%S UTC"
_UTC = timezone.utc
_log = logging.getLogger(__name__)


@dataclass
class TrspUpdateResult:
    """cached: ข้อมูลที่ใช้ไม่ได้มาจากการดาวน์โหลดของครั้งนี้ (ภายใน 2 ชม. หรือดึงไม่สำเร็จ)
    fetched_at: เวลาที่ข้อมูลใน cache ถูกดึงสำเร็จ (None = ไม่เคยดึงสำเร็จ)
    satellites: จำนวนดาวที่แปลงและเก็บไฟล์ในครั้งนี้ (0 เมื่อไม่มีข้อมูลให้แปลง)"""
    cached: bool
    fetched_at: datetime | None
    satellites: int
    messages: list[Message]


# ---------------------------------------------------------------- แปลง JSON ของ SatNOGS (ref-R §11.3)

def _number(v):
    """int หรือ float ที่จำกัดค่าและเป็น float ได้ (ไม่รับ bool, nan, inf และ int ที่เกินช่วงของ float ซึ่ง JSON อ่านได้) ไม่เช่นนั้น None"""
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    try:
        finite = math.isfinite(v)                           # int ที่ใหญ่เกิน float: OverflowError
    except OverflowError:
        return None
    return v if finite else None


def _hz(v) -> int:
    """ความถี่เป็น Hz: ค่าที่ไม่ใช่ตัวเลขหรือ ≤ 0 เป็น 0"""
    n = _number(v)
    return int(n) if n is not None and n > 0 else 0


def _whole(v) -> int | None:
    n = _number(v)
    return int(n) if n is not None and n == int(n) else None


def _truthy(v) -> bool:
    """invert: ตัวเลขไม่ใช่ศูนย์ (หรือ true) คือกลับสัญญาณ ไม่รับข้อความ"""
    if isinstance(v, bool):
        return v
    n = _number(v)
    return n is not None and n != 0


def convert(modes: list, transmitters: list) -> dict[int, list[dict]]:
    """modes.json และ transmitters.json ของ SatNOGS -> {NORAD: [transponder]} ตามลำดับที่พบใน JSON

    - mode ที่ไม่มี id หรือ name ถูกข้าม transmitter ที่ไม่มี description หรือ norad_cat_id ไม่ใช่เลขจำนวนเต็มบวกถูกข้าม
    - name ตัดที่ TRSP_NAME_MAX ตัวอักษร mode เป็นชื่อ mode (ตัดที่ TRSP_MODE_MAX) หรือเลข mode_id เป็นข้อความถ้าไม่พบ
      mode_id ไม่มี เป็น null หรือไม่ใช่จำนวนเต็มอ่านเป็น 0 เหมือน Gpredict (nx_json ให้ int_value 0) จึงเป็นชื่อของ mode 0 หรือ "0"
    - alive และ uuid ไม่ใช้ (transmitter ที่ alive เป็น false ก็เก็บ) ความถี่ ≤ 0 หรือไม่ใช่ตัวเลขเป็น 0 baud เขียนเป็นจำนวนเต็มเหมือน "%.0f"
    """
    names: dict[int, str] = {}
    for m in modes:
        if isinstance(m, dict) and (mode_id := _whole(m.get("id"))) is not None:
            name = m.get("name")
            if isinstance(name, str) and name:
                names[mode_id] = name

    out: dict[int, list[dict]] = {}
    for t in transmitters:
        if not isinstance(t, dict):
            continue
        description, norad = t.get("description"), t.get("norad_cat_id")
        # description ว่างก็ข้าม (ของเรา): Gpredict ข้ามเฉพาะที่ไม่มี แต่ description คือชื่อ transponder (ชื่อ group ในไฟล์ของ Gpredict)
        # ซึ่งว่างไม่ได้ และ load_transponders ก็ไม่รับรายการที่ไม่มีชื่อ
        if not isinstance(description, str) or not description:
            continue
        if isinstance(norad, bool) or not isinstance(norad, int) or norad <= 0:
            continue
        mode_id = _whole(t.get("mode_id")) or 0                # ไม่มีหรือ null เป็น 0 เหมือน Gpredict (trsp-update.c:296)
        mode = names[mode_id][:TRSP_MODE_MAX] if mode_id in names else str(mode_id)
        baud = _number(t.get("baud"))
        out.setdefault(norad, []).append({
            "name": description[:TRSP_NAME_MAX],
            "up_low": _hz(t.get("uplink_low")), "up_high": _hz(t.get("uplink_high")),
            "down_low": _hz(t.get("downlink_low")), "down_high": _hz(t.get("downlink_high")),
            "invert": _truthy(t.get("invert")),
            "mode": mode,
            "baud": float(f"{baud:.0f}") if baud is not None and baud > 0 else 0.0,
        })
    return out


# ---------------------------------------------------------------- อ่าน (ref-R §10.1)

def _pair(low: int, high: int) -> tuple[int, int]:
    """มีค่าเดียวในคู่ (อีกค่าเป็น 0): คัดลอกไปอีกค่า"""
    if low > 0 and high == 0:
        return low, low
    if high > 0 and low == 0:
        return high, high
    return low, high


def normalise(t: dict) -> dict:
    """ปรับ transponder ตามที่ Gpredict ทำตอนอ่านไฟล์: ค่าติดลบเป็น 0 และมีค่าเดียวในคู่ low/high ให้คัดลอกไปอีกค่า
    (beacon คือไม่มี uplink และ down_low = down_high) คืน dict ใหม่ที่มีครบทุกช่อง ช่องที่ขาดหรือผิดชนิดใช้ค่าตั้งต้น"""
    up_low, up_high = _pair(_hz(t.get("up_low")), _hz(t.get("up_high")))
    down_low, down_high = _pair(_hz(t.get("down_low")), _hz(t.get("down_high")))
    name, mode, baud = t.get("name"), t.get("mode"), _number(t.get("baud"))
    return {"name": name if isinstance(name, str) else "",
            "up_low": up_low, "up_high": up_high, "down_low": down_low, "down_high": down_high,
            "invert": _truthy(t.get("invert")),
            "mode": mode if isinstance(mode, str) else "",
            "baud": float(baud) if baud is not None else 0.0}


def _sat_file(trsp_dir: Path, norad: int) -> Path:
    return trsp_dir / f"{int(norad)}.json"


def load_transponders(data_dir: Path, norad: int) -> list[dict]:
    """transponder ของดาว ตามลำดับในไฟล์ ผ่าน normalise ทุกตัว ไม่มีไฟล์หรืออ่านไม่ได้: [] (อ่านไม่ได้ log WARNING ไม่แก้ไฟล์)
    รายการที่ไม่ใช่ object หรือไม่มี name (Gpredict ใช้ชื่อเป็นชื่อ group) ถูกข้าม"""
    path = _sat_file(Path(data_dir) / TRSP_DIR, norad)
    try:
        items = json.loads(path.read_bytes().decode("utf-8"))
    except FileNotFoundError:
        _log.debug("Error reading %s: no such file", path)
        return []
    except (OSError, ValueError, RecursionError) as exc:
        _log.warning("Error reading %s: %s", path, exc)
        return []
    if not isinstance(items, list):
        _log.warning("Error reading %s: not a list", path)
        return []
    if not items:
        _log.info("%s contains 0 transponders", path)
    out = [normalise(t) for t in items if isinstance(t, dict) and isinstance(t.get("name"), str) and t["name"]]
    if len(out) != len(items):
        _log.warning("%s: skipped %d entries without a name", path, len(items) - len(out))
    return out


# ---------------------------------------------------------------- Update transponder data (ref-R §11)

class _FetchError(Exception):
    """ดึงไม่ได้: url, ข้อความไทยสำหรับผู้ใช้ และ English สำหรับ log"""

    def __init__(self, url: str, thai: str, english: str):
        super().__init__(english)
        self.url, self.thai, self.english = url, thai, english


def _describe(exc: BaseException) -> tuple[str, str]:
    """(เหตุผลภาษาไทย, เหตุผล English สำหรับ log) ของความล้มเหลวที่คาดไว้"""
    if isinstance(exc, HTTPError):                                    # ต้องมาก่อน URLError และ OSError ซึ่งเป็น class แม่
        return f"HTTP {exc.code}", f"HTTP {exc.code}"
    if isinstance(exc, HTTPException):                                # อ่านคำตอบไม่จบ (IncompleteRead) ไม่ใช่ OSError
        return "อ่านคำตอบไม่จบ", f"incomplete response ({exc})"
    if isinstance(exc, (ValueError, RecursionError)):                 # ไม่ใช่ UTF-8, ไม่ใช่ JSON (UnicodeDecodeError และ JSONDecodeError เป็น ValueError)
        return "คำตอบไม่ใช่รายการ JSON ที่ใช้ได้", f"not a usable JSON list ({exc})"
    if isinstance(exc, TimeoutError) or (isinstance(exc, URLError) and isinstance(exc.reason, TimeoutError)):
        return f"หมดเวลารอ {TRSP_TIMEOUT_S} วินาที", "timed out"
    if isinstance(exc, URLError):                                     # DNS, connect
        return f"ต่อเน็ตไม่ได้ ({exc.reason})", f"connection failed: {exc}"
    return f"การเชื่อมต่อขัดข้อง ({exc or type(exc).__name__})", f"connection error: {exc or type(exc).__name__}"


def _download(url: str, opener, cache: Path, temps: list[Path]) -> tuple[Path, list]:
    """GET url (User-Agent อย่างเดียว) ตรวจว่าเป็นรายการ JSON ที่มี object อย่างน้อยหนึ่งตัว แล้วเก็บไบต์ที่ได้ลงไฟล์ชั่วคราวใน cache
    (เพิ่มเข้า temps เพื่อให้ผู้เรียกลบถ้าไม่ได้ใช้) คืน (ไฟล์ชั่วคราว, รายการที่แยกแล้ว) ล้มเหลวแล้ว raise _FetchError"""
    _log.info("Ready to fetch transponder list from %s", url)
    request = Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with opener(request, timeout=TRSP_TIMEOUT_S) as resp:
            data = resp.read()
        items = json.loads(data.decode("utf-8"))
        if not isinstance(items, list) or not any(isinstance(item, dict) for item in items):
            raise ValueError("not a JSON list of objects")
    except (OSError, HTTPException, ValueError, RecursionError) as exc:
        thai, english = _describe(exc)
        if isinstance(exc, HTTPError):
            exc.close()                                       # HTTPError ถือ response อยู่ คืนก่อนที่จะรอให้ GC เก็บ
        raise _FetchError(url, thai, english) from exc
    temp = cache / f".{uuid.uuid4().hex}.tmp"
    temps.append(temp)
    with open(temp, "xb") as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    _log.info("Successfully fetched %s", url)
    return temp, items


def _read_state(cache: Path) -> tuple[datetime | None, datetime | None]:
    """(requested_at, succeeded_at) จาก state.json (ไม่มีหรือรูปแบบผิด: None)"""
    state = omm.read_state(cache / STATE_FILE)
    return omm.parse_state_time(state.get("requested_at")), omm.parse_state_time(state.get("succeeded_at"))


def _write_state(cache: Path, requested: datetime, succeeded: datetime | None) -> None:
    write_json_atomic(cache / STATE_FILE, {
        "requested_at": requested.strftime(_STATE_TIME_FMT),
        "succeeded_at": None if succeeded is None else succeeded.strftime(_STATE_TIME_FMT)})


def _read_cache(cache: Path) -> tuple[list, list] | None:
    """(modes, transmitters) จาก _cache หรือ None เมื่อไม่มีหรืออ่านไม่ได้ (อ่านไม่ได้ log WARNING)"""
    lists = []
    for name in (MODES_FILE, TRANSMITTERS_FILE):
        path = cache / name
        try:
            items = json.loads(path.read_bytes().decode("utf-8"))
        except FileNotFoundError:
            return None
        except (OSError, ValueError, RecursionError) as exc:
            _log.warning("Error reading %s: %s", path, exc)
            return None
        if not isinstance(items, list):
            _log.warning("Error reading %s: not a list", path)
            return None
        lists.append(items)
    return lists[0], lists[1]


def _store(path: Path, items: list) -> None:
    """เขียนไฟล์ของดาวแบบ atomic เว้นแต่เนื้อหาเท่าเดิมอยู่แล้ว (แปลงจาก cache ซ้ำในช่วง 2 ชม. จึงไม่เขียนดิสก์ทุกดวงอีก)"""
    try:
        if json.loads(path.read_bytes().decode("utf-8")) == items:
            return
    except (OSError, ValueError, RecursionError):
        pass
    write_json_atomic(path, items)


def _apply(trsp_dir: Path, converted: dict[int, list[dict]]) -> tuple[int, list[Message]]:
    """เก็บไฟล์ต่อดาว (ดาวที่ไม่อยู่ใน converted คงไฟล์เดิม) คืน (จำนวนดาวที่เก็บได้, ข้อความ) เขียนดวงไหนไม่ได้ข้ามดวงนั้นแล้วไปต่อ"""
    failed: list[tuple[int, OSError]] = []
    for norad, items in converted.items():
        path = _sat_file(trsp_dir, norad)
        try:
            _store(path, items)
        except OSError as exc:
            _log.error("Could not open trsp file for write")
            _log.debug("%s: %s", path, exc)
            failed.append((norad, exc))
    messages = []
    if failed:
        norad, exc = failed[0]
        messages.append(Message("TRSP_WRITE_FAILED", "warning",
                                f"เขียนไฟล์ transponder ไม่ได้ {len(failed)} ดวง (เช่น NORAD {norad}: {exc})", str(norad)))
    return len(converted) - len(failed), messages


def _t(t: datetime) -> str:
    return t.strftime(_SHOW_TIME_FMT)


def _hours(interval: timedelta) -> int:
    return int(interval.total_seconds() // 3600)


def _use_cache(trsp_dir: Path, cache: Path, requested: datetime, succeeded: datetime | None) -> TrspUpdateResult:
    """ส่งคำขอไปไม่ถึง 2 ชม.: ไม่ส่ง request แปลงจาก _cache เดิม (ถ้ามี) แล้วเก็บไฟล์ต่อดาว"""
    head = (f"ยังไม่ส่งคำขอใหม่ เพราะส่งคำขอครั้งก่อนเมื่อ {_t(requested)} ยังไม่ครบ {_hours(TRSP_MIN_INTERVAL)} ชั่วโมง")
    tail = f"ดึงได้อีกครั้งหลัง {_t(requested + TRSP_MIN_INTERVAL)}"
    data = _read_cache(cache)
    if data is None:
        return TrspUpdateResult(True, succeeded, 0, [Message(
            "TRSP_RATE_LIMITED_LOCAL", "warning", f"{head} และยังไม่มีข้อมูล transponder ใน cache ที่ใช้ได้ {tail}")])
    satellites, problems = _apply(trsp_dir, convert(*data))
    used = f"ใช้ข้อมูลที่ดึงเมื่อ {_t(succeeded)}" if succeeded is not None else "ใช้ข้อมูลใน cache (ไม่ทราบเวลาที่ดึง)"
    return TrspUpdateResult(True, succeeded, satellites,
                            [Message("TRSP_RATE_LIMITED_LOCAL", "info", f"{head} {used} {tail}"), *problems])


def update_from_network(data_dir: Path, now: datetime, opener=urlopen) -> TrspUpdateResult:
    """Edit -> Update transponder data (ref-R §11) ตามกติกาในหัวข้อของไฟล์นี้ now ต้องมี timezone (ใช้ที่ความละเอียดวินาที)
    requested_at ที่อยู่หลัง now (นาฬิกาเคยถูกตั้งล้ำไป) ไม่นับ ไม่เช่นนั้นการดึงจะถูกปิดไปจนถึงเวลานั้น (ของเรา)"""
    now = now.astimezone(_UTC).replace(microsecond=0)
    trsp_dir = Path(data_dir) / TRSP_DIR
    cache = trsp_dir / CACHE_DIR
    requested, succeeded = _read_state(cache)
    if requested is not None and timedelta(0) <= now - requested < TRSP_MIN_INTERVAL:
        return _use_cache(trsp_dir, cache, requested, succeeded)

    _write_state(cache, now, succeeded)                       # บันทึกเวลาขอก่อนส่ง: ล้มเหลวก็นับ
    temps: list[Path] = []
    try:
        modes_temp, modes = _download(MODES_URL, opener, cache, temps)
        transmitters_temp, transmitters = _download(TRANSMITTERS_URL, opener, cache, temps)
        _log.info("Fetched %d files from network; updating...", len(temps))
        converted = convert(modes, transmitters)               # แปลงก่อนแทน cache: ข้อมูลที่แปลงไม่ได้ไม่ทับ cache เดิม
        os.replace(modes_temp, cache / MODES_FILE)             # ถึงตรงนี้แปลว่าได้ครบทั้งคู่ จึงค่อยแทนของเดิม
        os.replace(transmitters_temp, cache / TRANSMITTERS_FILE)
    except _FetchError as exc:
        _log.warning("Error fetching %s (%s)", exc.url, exc.english)
        _log.warning("Could not fetch frequency files from network")
        what = "modes" if exc.url == MODES_URL else "transmitters"
        if (cache / MODES_FILE).is_file() and (cache / TRANSMITTERS_FILE).is_file():
            used = f"ยังใช้ข้อมูลเดิมที่ดึงเมื่อ {_t(succeeded)}" if succeeded is not None else "ยังใช้ข้อมูลเดิมใน cache"
        else:
            used = "และยังไม่มีข้อมูล transponder ที่ดึงไว้"
        return TrspUpdateResult(True, succeeded, 0, [Message(
            "TRSP_DOWNLOAD_FAILED", "warning",
            f"ดึงข้อมูล transponder จาก SatNOGS DB ไม่สำเร็จ ({what}: {exc.thai}) {used} "
            f"ลองใหม่ได้หลัง {_t(now + TRSP_MIN_INTERVAL)}")])
    finally:
        for temp in temps:
            temp.unlink(missing_ok=True)

    _write_state(cache, now, now)
    satellites, problems = _apply(trsp_dir, converted)
    return TrspUpdateResult(False, now, satellites, [Message(
        "TRSP_UPDATED", "info",
        f"ดึงข้อมูล transponder จาก SatNOGS DB เมื่อ {_t(now)} อัปเดตไฟล์ของดาว {satellites} ดวง "
        f"ดึงได้อีกครั้งหลัง {_t(now + TRSP_MIN_INTERVAL)}"), *problems])
