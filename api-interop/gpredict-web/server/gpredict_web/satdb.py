"""ฐานข้อมูลดาวและ Edit -> Update TLE data from network (หัวข้อ 7.2 ของ spec)

ดึงแต่ละกลุ่ม CelesTrak เป็น OMM (JSON) ด้วย omm.fetch_group ลง OMM cache ที่ใช้ร่วมกับ GNSS Studio (กติกา 1 ครั้งต่อกลุ่มต่อ 2 ชม.
จึงนับร่วมกัน) แปลงเป็น TLE ด้วย omm.to_tle_lines แล้วรวมเป็นดัชนีดาวที่ data/satdb.json:
  {"version": 1, "satellites": {"<NORAD>": {"name", "groups", "tle": [บรรทัด1, บรรทัด2], "epoch", "updated"}}}
เวลาทุกค่าเป็น ISO 8601 UTC ลงท้าย Z
"""

import json
import threading
from dataclasses import dataclass, field, replace
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import urlopen

from gnss_predict import omm
from gnss_predict.errors import Message, OrbitUnavailableError

from .config import TLE_GROUPS, Config
from .store import write_json_atomic

_UTC = timezone.utc
FORMAT_VERSION = 1


@dataclass(frozen=True)
class SatRecord:
    norad: int
    name: str
    groups: list[str]                  # กลุ่ม CelesTrak ที่ดาวดวงนี้อยู่ (เรียงตามชื่อ) ใช้กับ combo กลุ่มในหน้าเลือกดาว
    tle_lines: tuple[str, str]
    epoch: datetime                    # epoch ของ TLE (UTC)
    updated: datetime                  # เวลาที่ TLE นี้เข้าดัชนี (UTC)


@dataclass
class UpdateResult:
    """จำนวนแบบหน้าต่าง "TLE Update" ของ Gpredict: Satellites updated / skipped และ Missing Satellites"""
    updated: int
    skipped: int
    missing: int
    messages: list[Message] = field(default_factory=list)


def gmat_name(norad: int) -> str:
    """ชื่อ object ใน GMAT และบรรทัดชื่อในไฟล์ TLE เช่น S25544, ดาว Alpha-5 100744 เป็น SA0744"""
    return "S" + omm.catalog_field(norad)


def _fmt_time(t: datetime) -> str:
    return t.astimezone(_UTC).isoformat().replace("+00:00", "Z")


def _parse_time(text) -> datetime:
    if not isinstance(text, str):
        raise ValueError(f"เวลาไม่ใช่ข้อความ: {text!r}")
    t = datetime.fromisoformat(text[:-1] + "+00:00" if text.endswith("Z") else text)
    if t.tzinfo is None:
        raise ValueError(f"เวลาไม่มี timezone: {text!r}")
    return t.astimezone(_UTC)


def _record_to_dict(r: SatRecord) -> dict:
    return {"name": r.name, "groups": list(r.groups), "tle": list(r.tle_lines),
            "epoch": _fmt_time(r.epoch), "updated": _fmt_time(r.updated)}


def _record_from_dict(norad: int, d) -> SatRecord:
    """ValueError ถ้ารายการเสียรูป"""
    if not isinstance(d, dict):
        raise ValueError("รายการดาวไม่ใช่ object")
    name, groups, tle = d.get("name"), d.get("groups"), d.get("tle")
    if not isinstance(name, str):
        raise ValueError("name ไม่ใช่ข้อความ")
    if not isinstance(groups, list) or not all(isinstance(g, str) for g in groups):
        raise ValueError("groups ไม่ใช่รายการข้อความ")
    if not isinstance(tle, list) or len(tle) != 2 or not all(isinstance(l, str) for l in tle):
        raise ValueError("tle ไม่ใช่ข้อความสองบรรทัด")
    return SatRecord(norad, name, sorted(groups), (tle[0], tle[1]), _parse_time(d.get("epoch")), _parse_time(d.get("updated")))


class SatDb:
    """ดัชนีดาว NORAD -> SatRecord ที่อยู่ในหน่วยความจำและบันทึกลง path ด้วย save()
    ไฟล์ที่ไม่มี อ่านไม่ได้ หรือรูปแบบผิดถือเป็นดัชนีว่าง (สร้างใหม่ได้จากการอัปเดต) รายการที่เสียรายการเดียวถูกข้าม"""

    def __init__(self, path: Path):
        self.path = Path(path)
        self._lock = threading.RLock()
        self._sats: dict[int, SatRecord] = self._load()

    def _load(self) -> dict[int, SatRecord]:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}
        entries = data.get("satellites") if isinstance(data, dict) else None
        if not isinstance(entries, dict):
            return {}
        sats = {}
        for key, entry in entries.items():
            try:
                norad = int(key)
                sats[norad] = _record_from_dict(norad, entry)
            except ValueError:
                continue
        return sats

    def __len__(self) -> int:
        with self._lock:
            return len(self._sats)

    def get(self, norad: int) -> SatRecord | None:
        with self._lock:
            return self._sats.get(norad)

    def groups(self) -> list[str]:
        """ทุกกลุ่มที่มีดาวอยู่ เรียงตามชื่อ"""
        with self._lock:
            return sorted({g for r in self._sats.values() for g in r.groups})

    def search(self, q: str = "", group: str | None = None, limit: int = 500) -> list[SatRecord]:
        """q ว่าง = ทุกดวง ไม่ว่างคือชื่อมี q (ไม่สนตัวพิมพ์) หรือ NORAD ตรงกับ q เมื่อ q เป็นตัวเลข
        group ว่างหรือ None = ทุกกลุ่ม เรียงตามชื่อแล้ว NORAD ตัดที่ limit ดวง"""
        needle = q.strip().casefold()
        norad = int(needle) if needle.isascii() and needle.isdigit() else None
        with self._lock:
            found = [r for r in self._sats.values()
                     if (not group or group in r.groups) and (not needle or needle in r.name.casefold() or r.norad == norad)]
        found.sort(key=lambda r: (r.name.casefold(), r.norad))
        return found[:max(0, limit)]

    def apply_groups(self, files: dict[str, Path], now: datetime) -> UpdateResult:
        """รวมไฟล์ OMM ของแต่ละกลุ่ม (กลุ่ม -> path) เข้าดัชนี ยังไม่บันทึกลงดิสก์ (เรียก save())

        - ดาวดวงเดียวกันในหลายกลุ่มใช้ OMM ที่ epoch ใหม่สุด
        - updated = ได้ epoch ใหม่กว่าเดิม (ดวงใหม่ถูกเพิ่มและนับรวม) skipped = epoch เท่าเดิมหรือเก่ากว่า (ไม่เคยถอยกลับ)
        - missing = ดวงในดัชนีที่ไม่อยู่ในไฟล์ใดเลย เก็บ TLE และกลุ่มเดิมไว้
        - กลุ่มของดวงที่พบ = กลุ่มที่พบดวงนั้นครั้งนี้ รวมกลุ่มเดิมที่ครั้งนี้ไม่ได้ส่งไฟล์มา (ดึงกลุ่มนั้นไม่ได้ ไม่ถือว่าออกจากกลุ่ม)
        - ไฟล์ที่อ่านไม่ได้ข้ามทั้งกลุ่ม, ดาวที่แปลงเป็น TLE ไม่ได้ข้ามเฉพาะดวง ทั้งสองกรณีมี Message เตือน
        """
        now = now.astimezone(_UTC)
        messages: list[Message] = []
        best: dict[int, tuple[omm.OmmRecord, tuple[str, str]]] = {}      # NORAD -> (OMM ที่ epoch ใหม่สุด, TLE ของมัน)
        seen: dict[int, set[str]] = {}
        read_ok: set[str] = set()
        for group, path in files.items():
            try:
                records = omm.read_omm(Path(path))
            except (OSError, ValueError) as exc:
                messages.append(Message("ORBIT_DOWNLOAD_FAILED", "warning",
                                        f"อ่านไฟล์ OMM กลุ่ม {group} ({Path(path).name}) ไม่ได้ ({exc}) ข้ามกลุ่มนี้", group))
                continue
            read_ok.add(group)
            bad = []
            for rec in records:
                try:
                    lines = omm.to_tle_lines(rec)
                except ValueError:
                    bad.append(rec.norad)
                    continue
                seen.setdefault(rec.norad, set()).add(group)
                if rec.norad not in best or rec.epoch > best[rec.norad][0].epoch:
                    best[rec.norad] = (rec, lines)
            if bad:
                shown = ", ".join(str(n) for n in bad[:5]) + (f" และอีก {len(bad) - 5} ดวง" if len(bad) > 5 else "")
                messages.append(Message("TLE_CONVERT_FAILED", "warning",
                                        f"แปลง OMM กลุ่ม {group} เป็น TLE ไม่ได้ {len(bad)} ดวง (NORAD {shown}) ข้ามดวงเหล่านี้", group))

        with self._lock:
            missing = sum(1 for norad in self._sats if norad not in best)
            updated = skipped = 0
            for norad, (rec, lines) in best.items():
                old = self._sats.get(norad)
                groups = sorted(seen[norad] | (set(old.groups) - read_ok if old else set()))
                if old is None or rec.epoch > old.epoch:
                    self._sats[norad] = SatRecord(norad, rec.name, groups, lines, rec.epoch, now)
                    updated += 1
                else:
                    skipped += 1
                    if groups != old.groups:
                        self._sats[norad] = replace(old, groups=groups)
        return UpdateResult(updated, skipped, missing, messages)

    def save(self) -> None:
        with self._lock:
            write_json_atomic(self.path, {"version": FORMAT_VERSION,
                                          "satellites": {str(n): _record_to_dict(r) for n, r in sorted(self._sats.items())}})


def update_from_network(db: SatDb, cfg: Config, now: datetime, groups=TLE_GROUPS, opener=urlopen) -> UpdateResult:
    """Edit -> Update TLE data from network: ดึงแต่ละกลุ่มลง OMM cache ที่ใช้ร่วมกับ GNSS Studio (cfg.omm_cache_dir, cfg.state_file)
    กลุ่มที่ส่ง request ไปไม่ถึง 2 ชม. ใช้ไฟล์ใน cache โดยไม่ส่ง request แล้วรวมเข้า db และบันทึก data/satdb.json
    messages: ข้อความของ fetch_group ตามเดิม + ORBIT_DOWNLOAD_FAILED (warning) ต่อกลุ่มที่ไม่มีไฟล์ใช้เลย (ข้ามกลุ่มนั้น)"""
    files: dict[str, Path] = {}
    messages: list[Message] = []
    for group in groups:
        try:
            path, msgs = omm.fetch_group(group, cfg.omm_cache_dir, cfg.state_file, now, opener=opener)
        except OrbitUnavailableError as exc:
            messages.append(Message("ORBIT_DOWNLOAD_FAILED", "warning",
                                    f"ข้ามกลุ่ม {group}: ดึงไม่ได้และไม่มีไฟล์ใน cache ({exc})", group))
            continue
        files[group] = path
        messages.extend(msgs)
    result = db.apply_groups(files, now)
    db.save()
    result.messages = messages + result.messages
    return result
