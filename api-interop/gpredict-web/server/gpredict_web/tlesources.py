"""TLE sources ของ Edit -> Update TLE data from network และ Update TLE data from local files (spec §5.2, §5.4; ref-D §4, §5.3, §6)

- URL แต่ละตัวใน "TLE sources:" (TLE/URLS) แยกเป็นสองแบบด้วย classify
  - CelesTrak `https://celestrak.org/NORAD/elements/gp.php?GROUP=<g>&…`: ดึง OMM ของกลุ่ม <g> ด้วย omm.fetch_group ลง OMM cache
    และ state file ที่ใช้ร่วมกับ GNSS Studio (1 ครั้งต่อกลุ่มต่อ 2 ชม. นับร่วมกัน) ช่อง FORMAT ไม่มีผล (spec §5.1)
  - URL อื่น (เช่น AMSAT nasabare.txt): ดึงข้อความ TLE 2/3 บรรทัดด้วย fetch_text ไม่เกิน 1 ครั้งต่อ URL ต่อ SOURCE_MIN_INTERVAL_S
    ไฟล์อยู่ที่ data/tle/_cache/<sha256(url)[:12]>.txt state ที่ data/tle/_cache/state.json {url: {last_request, last_success}}
    (รูปเวลาเดียวกับ state ของ engine) กลุ่มคือชื่อไฟล์ใน URL ไม่รวมนามสกุล
- กติกาการขอ (เหมือน engine): last_request บันทึกทุกครั้งที่ server ได้รับคำขอ รวม HTTP error และคำตอบที่ไม่มี TLE ใช้ได้
  ส่วนต่อ server ไม่ได้เลย (URLError: DNS, connect, proxy ที่ต่อไม่ได้) ไม่บันทึก คำตอบที่ใช้ไม่ได้ไม่ทับไฟล์เดิม และใช้ไฟล์เดิมต่อ
  TLE เดิมจึงไม่หาย
- Proxy (TLE/PROXY) ใช้กับทุก source: opener เดียวจาก make_opener ส่งให้ทั้ง fetch_group และ fetch_text
- คำขอที่ส่งเองมีแค่ User-Agent "gpredict-web" (คำขอ CelesTrak ส่งโดย engine ด้วย User-Agent ของ engine)
- TLE ทุก source ของรอบหนึ่งรวมกันใน SatDb.apply_sets ครั้งเดียว (ref-D §5.3) TLE/LAST_UPDATE ตั้งเมื่อ updated + new > 0
  ทั้งจาก network และไฟล์ (tle_update_from_files ของ Gpredict ใช้ร่วมกันทั้งสองทาง)
"""

import hashlib
from collections.abc import Callable
from datetime import datetime, timezone
from http.client import HTTPException
from pathlib import Path, PurePosixPath
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, unquote, urlsplit
from urllib.request import ProxyHandler, Request, build_opener, urlopen

from gnss_predict import omm
from gnss_predict.errors import Message, OrbitUnavailableError

from .config import Config
from .prefs import Prefs
from .satdb import SatDb, UpdateResult, read_omm_sets
from .store import _write_bytes_atomic, write_json_atomic
from .tletext import TleSet, parse_tle_text

SOURCE_MIN_INTERVAL_S = 7200            # source ข้อความ: ส่งคำขอได้ 1 ครั้งต่อ URL ต่อ 2 ชม. (spec §1.2)
USER_AGENT = "gpredict-web"
TIMEOUT_S = 30
STATE_FILE = "state.json"
CELESTRAK_HOSTS = ("celestrak.org", "www.celestrak.org")
CELESTRAK_GP_PATH = "/NORAD/elements/gp.php"
LOCAL_SUFFIXES = (".tle", ".txt")       # ไฟล์ที่ Update from local files อ่าน (ไม่สนตัวพิมพ์, ref-D §5.3 แถว Files read)
_STATE_TIME_FMT = "%Y-%m-%dT%H:%M:%SZ"  # รูปเดียวกับ state ของ engine (omm.parse_state_time อ่านได้ทั้งสองไฟล์)
_UTC = timezone.utc


def classify(url: str) -> tuple[str, str]:
    """("celestrak", กลุ่ม) เมื่อเป็น gp.php ของ celestrak.org (หรือ www.) ที่มี GROUP ไม่งั้น ("text", ชื่อไฟล์ใน path ไม่รวมนามสกุล)
    (ของเรา) path ที่ไม่มีชื่อไฟล์ใช้ชื่อเครื่อง URL ที่อ่านไม่ได้ใช้ทั้ง URL"""
    try:
        parts = urlsplit(url)
        host = parts.hostname or ""
    except ValueError:
        return "text", url
    if host in CELESTRAK_HOSTS and parts.path == CELESTRAK_GP_PATH:
        group = parse_qs(parts.query).get("GROUP")
        if group:
            return "celestrak", group[0]
    return "text", PurePosixPath(unquote(parts.path)).stem or host or url


def source_groups(urls: list[str]) -> list[str]:
    """กลุ่มของ TLE sources ตามลำดับ URL ไม่ซ้ำ"""
    return list(dict.fromkeys(classify(url)[1] for url in urls))


def make_opener(proxy: str) -> Callable:
    """opener ของ TLE source ทุกตัว: "" = urlopen ไม่งั้นส่งทั้ง http และ https ผ่าน proxy นี้ ("Proxy server:" ของ ref-D §4)"""
    if not proxy:
        return urlopen
    return build_opener(ProxyHandler({"http": proxy, "https": proxy})).open


def cache_dir(cfg: Config) -> Path:
    """ไฟล์และ state ของ source ข้อความ (data/tle/_cache)"""
    return cfg.data_dir / "tle" / "_cache"


def _decode(data: bytes) -> str:
    return data.decode("utf-8", errors="replace")     # TLE เป็น ASCII ตัวอักษรอื่นในชื่อดาวไม่ทำให้ทั้งไฟล์ใช้ไม่ได้


def _fmt_time(t: datetime) -> str:
    return t.astimezone(_UTC).strftime(_STATE_TIME_FMT)


def _record_request(state_file: Path, url: str, now: datetime, success: bool) -> None:
    state = omm.read_state(state_file)
    entry = dict(state[url]) if isinstance(state.get(url), dict) else {}
    entry["last_request"] = _fmt_time(now)
    if success:
        entry["last_success"] = _fmt_time(now)
    state[url] = entry
    write_json_atomic(state_file, state)


def fetch_text(url: str, cache_dir: Path, now: datetime, opener=urlopen) -> tuple[Path | None, list[Message]]:
    """ดึงข้อความ TLE ของ URL ลง <cache_dir>/<sha256(url)[:12]>.txt คืน (ไฟล์ที่ใช้ได้หรือ None, ข้อความ) object ของข้อความคือ url
    - ส่งคำขอไปไม่ถึง SOURCE_MIN_INTERVAL_S: ไม่ส่ง ใช้ไฟล์เดิม + ORBIT_RATE_LIMITED_LOCAL (info) ไม่มีไฟล์ = None + warning
    - สำเร็จเมื่อคำตอบมี TLE ใช้ได้อย่างน้อย 1 ชุด: เขียนทับไฟล์ บันทึก last_request และ last_success
    - HTTP error, timeout, คำตอบที่ไม่มี TLE ใช้ได้: ไม่ทับไฟล์ บันทึก last_request ใช้ไฟล์เดิม (หรือ None) + ORBIT_DOWNLOAD_FAILED
    - ต่อ server ไม่ได้ (URLError) หรือ urllib ไม่รับ URL/proxy: เหมือนข้อบนแต่ไม่บันทึก last_request (server ไม่ได้รับคำขอ)"""
    cache_dir = Path(cache_dir)
    path = cache_dir / f"{hashlib.sha256(url.encode('utf-8')).hexdigest()[:12]}.txt"
    cached = path if path.is_file() else None
    state_file = cache_dir / STATE_FILE

    entry = omm.read_state(state_file).get(url)
    last_request = omm.parse_state_time(entry.get("last_request")) if isinstance(entry, dict) else None
    if last_request is not None and (now - last_request).total_seconds() < SOURCE_MIN_INTERVAL_S:
        text = (f"ข้ามการดาวน์โหลด TLE จาก {url}: ส่งคำขอครั้งก่อนเมื่อ {_fmt_time(last_request)} "
                f"ยังไม่ครบ {SOURCE_MIN_INTERVAL_S // 3600} ชั่วโมง")
        if cached is None:
            return None, [Message("ORBIT_DOWNLOAD_FAILED", "warning", f"{text} และยังไม่มีไฟล์ใน cache จึงข้าม source นี้", url)]
        return cached, [Message("ORBIT_RATE_LIMITED_LOCAL", "info", f"{text} ใช้ไฟล์เดิม", url)]

    sent = True
    try:
        with opener(Request(url, headers={"User-Agent": USER_AGENT}), timeout=TIMEOUT_S) as resp:
            data = resp.read()
    except HTTPError as exc:
        reason = f"HTTP {exc.code}"
        exc.close()                         # HTTPError ถือ response อยู่ คืนก่อนที่จะรอให้ GC เก็บ (แบบ trsp.py)
    except HTTPException as exc:            # อ่านคำตอบไม่จบ (IncompleteRead) ไม่ใช่ OSError
        reason = f"อ่านคำตอบไม่จบ: {exc}"
    except URLError as exc:                 # DNS, connect, proxy ที่ต่อไม่ได้: server ไม่ได้รับคำขอ
        reason, sent = str(exc), False
    except OSError as exc:                  # timeout หรือ connection reset หลังส่งคำขอแล้ว
        reason = str(exc) or type(exc).__name__
    except ValueError as exc:               # URL หรือ proxy ที่ urllib ไม่รับ: ยังไม่ได้ส่ง
        reason, sent = f"URL หรือ proxy ไม่ถูกต้อง: {exc}", False
    else:
        if parse_tle_text(_decode(data)):
            _write_bytes_atomic(path, data)
            _record_request(state_file, url, now, success=True)
            return path, []
        reason = "คำตอบไม่มีข้อมูล TLE ที่ใช้ได้"

    if sent:
        _record_request(state_file, url, now, success=False)
    text = f"ดาวน์โหลด TLE จาก {url} ไม่สำเร็จ ({reason})"
    if cached is None:
        return None, [Message("ORBIT_DOWNLOAD_FAILED", "warning", f"{text} และไม่มีไฟล์ใน cache จึงข้าม source นี้", url)]
    return cached, [Message("ORBIT_DOWNLOAD_FAILED", "warning", f"{text} ใช้ไฟล์เดิม", url)]


def _celestrak_sets(group: str, cfg: Config, now: datetime, opener) -> tuple[list[TleSet] | None, list[Message]]:
    try:
        path, messages = omm.fetch_group(group, cfg.omm_cache_dir, cfg.state_file, now, opener=opener)
    except OrbitUnavailableError as exc:
        return None, [Message("ORBIT_DOWNLOAD_FAILED", "warning", f"ข้ามกลุ่ม {group}: ดึงไม่ได้และไม่มีไฟล์ใน cache ({exc})", group)]
    except ValueError as exc:               # ชื่อกลุ่มที่ engine ไม่รับ (ตรวจก่อนส่งคำขอ จึงไม่มีคำขอ)
        return None, [Message("ORBIT_DOWNLOAD_FAILED", "warning", f"ข้ามกลุ่ม {group}: {exc}", group)]
    sets, more = read_omm_sets(group, path)
    return sets, messages + more


def _text_sets(url: str, cache: Path, now: datetime, opener) -> tuple[list[TleSet] | None, list[Message]]:
    path, messages = fetch_text(url, cache, now, opener)
    if path is None:
        return None, messages
    try:
        sets = parse_tle_text(_decode(path.read_bytes()))
    except OSError as exc:
        sets, reason = None, f"อ่านไม่ได้ ({exc})"
    else:
        reason = "ไม่มีข้อมูล TLE ที่ใช้ได้"
    if sets:
        return sets, messages
    return None, messages + [Message("ORBIT_DOWNLOAD_FAILED", "warning",
                                     f"ไฟล์ cache ของ {url} ({path.name}) {reason} จึงข้าม source นี้", url)]


def _store_last_update(prefs: Prefs, result: UpdateResult, now: datetime) -> None:
    """TLE/LAST_UPDATE (วินาที unix) เฉพาะเมื่อรอบนี้มีดวงที่ updated หรือดวงใหม่ (ref-D §5.1, tle-update.c:396-403)"""
    if result.updated + result.new > 0:
        prefs.update({"TLE/LAST_UPDATE": int(now.timestamp())}, [])


def update_from_sources(db: SatDb, cfg: Config, prefs: Prefs, now: datetime,
                        opener_factory: Callable[[str], Callable] = make_opener) -> UpdateResult:
    """Edit -> Update TLE data from network: ดึงทุก URL ใน TLE/URLS ตามลำดับผ่าน opener_factory(TLE/PROXY) แล้วรวมเข้า db
    และบันทึก data/satdb.json add_new = TLE/ADD_NEW_SATS
    - กลุ่ม CelesTrak เดียวกันหรือ URL เดียวกันซ้ำในรายการดึงครั้งเดียว URL หลายตัวที่ได้กลุ่มเดียวกันรวมเป็น source เดียว
    - source ที่ไม่มีข้อมูลใช้เลย (ต่อไม่ได้และไม่มี cache) ถูกข้าม ดาวและสมาชิกกลุ่มเดิมของมันไม่ถูกแตะ
    - กลุ่มที่ทุก source ของมันมีข้อมูล: สมาชิกถูกแทนด้วยดาวที่ได้รอบนี้ (ดวงที่หายไปหลุดจากกลุ่มแต่ยังอยู่ในดัชนี)
    messages: ของ engine และ fetch_text ตามลำดับ URL + ข้อความของการแปลง OMM"""
    opener = opener_factory(prefs.get("TLE/PROXY"))
    text_cache = cache_dir(cfg)
    sources: dict[str, list[TleSet]] = {}
    incomplete: set[str] = set()
    messages: list[Message] = []
    fetched: set[tuple[str, str]] = set()
    for url in prefs.get("TLE/URLS"):
        kind, group = classify(url)
        key = (kind, group if kind == "celestrak" else url)
        if key in fetched:
            continue
        fetched.add(key)
        if kind == "celestrak":
            sets, msgs = _celestrak_sets(group, cfg, now, opener)
        else:
            sets, msgs = _text_sets(url, text_cache, now, opener)
        messages.extend(msgs)
        if sets:
            sources.setdefault(group, []).extend(sets)
        else:
            incomplete.add(group)
    result = db.apply_sets(sources, now, prefs.get("TLE/ADD_NEW_SATS"), frozenset(sources.keys() - incomplete))
    db.save()
    _store_last_update(prefs, result, now)
    result.messages = messages
    return result


def is_local_tle_file(name: str) -> bool:
    """ไฟล์ระดับบนของโฟลเดอร์ (ชื่อไม่มี / หรือ \\) ที่ชื่อลงท้าย .tle หรือ .txt ไม่สนตัวพิมพ์"""
    return "/" not in name and "\\" not in name and name.lower().endswith(LOCAL_SUFFIXES)


def update_from_files(db: SatDb, prefs: Prefs, files: list[tuple[str, str]], now: datetime) -> UpdateResult:
    """Edit -> Update TLE data from local files: files = [(ชื่อไฟล์เทียบกับโฟลเดอร์ที่เลือก, ข้อความ)] อ่านเฉพาะ is_local_tle_file
    กลุ่ม = ชื่อก่อนจุดแรก (เหมือนไฟล์ .cat ของ Gpredict, ชื่อที่ขึ้นต้นด้วยจุดใช้ทั้งชื่อ) หลายไฟล์ที่ได้กลุ่มเดียวกันรวมกัน
    กลุ่มที่มีอยู่แล้วในดัชนี: สมาชิกถูกแทนด้วยดาวในไฟล์ กลุ่มใหม่ถูกสร้าง add_new = TLE/ADD_NEW_SATS แล้วบันทึก data/satdb.json
    ไฟล์ที่ไม่มี TLE ใช้ได้ถูกข้าม (กลุ่มของมันไม่ว่างลง) + TLE_FILE_INVALID (warning, object = ชื่อไฟล์)"""
    sources: dict[str, list[TleSet]] = {}
    messages: list[Message] = []
    for name, text in files:
        if not is_local_tle_file(name):
            continue
        sets = parse_tle_text(text)
        if not sets:
            messages.append(Message("TLE_FILE_INVALID", "warning", f"ไม่พบข้อมูล TLE ที่ใช้ได้ในไฟล์ {name} จึงข้ามไฟล์นี้", name))
            continue
        sources.setdefault(name.split(".", 1)[0] or name, []).extend(sets)
    existing = set(db.groups())
    result = db.apply_sets(sources, now, prefs.get("TLE/ADD_NEW_SATS"), frozenset(existing & sources.keys()))
    db.save()
    _store_last_update(prefs, result, now)
    result.messages = messages
    return result


def source_times(cfg: Config, urls: list[str]) -> list[tuple[str, datetime | None, datetime | None]]:
    """(กลุ่ม, last_request, last_success) ของ TLE sources ตามลำดับ source_groups เวลาเป็นค่าล่าสุดของทุก source ในกลุ่ม
    CelesTrak อ่านจาก state ของ engine (ใช้ร่วมกับ GNSS Studio) URL อื่นอ่านจาก state ของเรา ยังไม่เคยขอ = None"""
    engine = omm.read_state(cfg.state_file)
    ours = omm.read_state(cache_dir(cfg) / STATE_FILE)
    times: dict[str, list[datetime | None]] = {}
    for url in urls:
        kind, group = classify(url)
        entry = engine.get(group) if kind == "celestrak" else ours.get(url)
        entry = entry if isinstance(entry, dict) else {}
        latest = times.setdefault(group, [None, None])
        for i, key in enumerate(("last_request", "last_success")):
            t = omm.parse_state_time(entry.get(key))
            if t is not None and (latest[i] is None or t > latest[i]):
                latest[i] = t
    return [(group, req, ok) for group, (req, ok) in times.items()]
