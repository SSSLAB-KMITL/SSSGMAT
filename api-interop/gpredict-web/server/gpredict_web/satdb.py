"""ฐานข้อมูลดาวและ Edit -> Update TLE data from network (หัวข้อ 7.2 ของ spec)

ดึงแต่ละกลุ่ม CelesTrak เป็น OMM (JSON) ด้วย omm.fetch_group ลง OMM cache ที่ใช้ร่วมกับ GNSS Studio (กติกา 1 ครั้งต่อกลุ่มต่อ 2 ชม.
จึงนับร่วมกัน) แปลงเป็น TLE ด้วย omm.to_tle_lines แล้วรวมเป็นดัชนีดาวที่ data/satdb.json:
  {"version": 1, "satellites": {"<NORAD>": {"name", "groups", "tle": [บรรทัด1, บรรทัด2], "epoch", "updated", "status"}}}
เวลาทุกค่าเป็น ISO 8601 UTC ลงท้าย Z; status คือสถานะแบบ Gpredict (Unknown, Operational, ...) ไฟล์ของรุ่นก่อนไม่มีช่องนี้ อ่านได้เป็น Unknown

การรวม TLE จากทุก source (ไฟล์ OMM ของ CelesTrak, ไฟล์ข้อความ TLE ของ AMSAT, ไฟล์ในเครื่อง) ตามกติกาของ Gpredict
(ref-D §5.3, tle-update.c) อยู่ใน SatDb.apply_sets
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
from .tletext import UNKNOWN_STATUS, TleSet, is_generated_name

_UTC = timezone.utc
FORMAT_VERSION = 1


@dataclass(frozen=True)
class SatRecord:
    norad: int
    name: str
    groups: list[str]                  # กลุ่มที่ดาวดวงนี้อยู่ (กลุ่ม CelesTrak, ชื่อไฟล์ของ source ข้อความ; เรียงตามชื่อ) ใช้กับ combo กลุ่มในหน้าเลือกดาว
    tle_lines: tuple[str, str]
    epoch: datetime                    # epoch ของ TLE (UTC)
    updated: datetime                  # เวลาที่ TLE นี้เข้าดัชนี (UTC) การเปลี่ยนแค่ชื่อหรือสถานะไม่เปลี่ยนค่านี้
    status: str = UNKNOWN_STATUS       # สถานะการใช้งานแบบ Gpredict (ป้าย [+] [-] [P] [B] [S] [X] ท้ายชื่อใน TLE ข้อความ)


@dataclass
class UpdateResult:
    """จำนวนแบบหน้าต่าง "TLE Update" ของ Gpredict: Satellites updated / skipped / Missing Satellites / New Satellites
    updated + skipped + missing = จำนวนดาวที่มีอยู่ก่อนอัปเดต ส่วนดวงที่เพิ่มเข้ามาใหม่นับเฉพาะใน new"""
    updated: int
    skipped: int
    missing: int
    messages: list[Message] = field(default_factory=list)
    new: int = field(default=0, kw_only=True)


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
            "epoch": _fmt_time(r.epoch), "updated": _fmt_time(r.updated), "status": r.status}


def _record_from_dict(norad: int, d) -> SatRecord:
    """ValueError ถ้ารายการเสียรูป"""
    if not isinstance(d, dict):
        raise ValueError("รายการดาวไม่ใช่ object")
    name, groups, tle = d.get("name"), d.get("groups"), d.get("tle")
    status = d.get("status", UNKNOWN_STATUS)             # ไฟล์ของรุ่นก่อนไม่มีช่องนี้
    if not isinstance(name, str):
        raise ValueError("name ไม่ใช่ข้อความ")
    if not isinstance(status, str):
        raise ValueError("status ไม่ใช่ข้อความ")
    if not isinstance(groups, list) or not all(isinstance(g, str) for g in groups):
        raise ValueError("groups ไม่ใช่รายการข้อความ")
    if not isinstance(tle, list) or len(tle) != 2 or not all(isinstance(l, str) for l in tle):
        raise ValueError("tle ไม่ใช่ข้อความสองบรรทัด")
    return SatRecord(norad, name, sorted(groups), (tle[0], tle[1]), _parse_time(d.get("epoch")), _parse_time(d.get("updated")), status)


def _merge_source_set(best: dict[int, TleSet], s: TleSet) -> None:
    """รวมชุด TLE หนึ่งชุดเข้าตารางดีที่สุดของแต่ละ NORAD (hash table `data` ของ tle-update.c:1021-1090)
    - epoch ใหญ่กว่าแทนทั้งชุด (บรรทัด epoch และสถานะ แม้สถานะใหม่เป็น Unknown)
    - epoch เท่ากัน: สถานะที่รู้และต่างจากเดิมแทนสถานะเดิม (Unknown ไม่ลบสถานะที่รู้)
    - epoch เล็กกว่า: ไม่แตะ
    - ชื่อที่คอมพิวเตอร์สร้างถูกแทนด้วยชื่อจริงในทุกกรณีข้างต้น
    เทียบ epoch เป็นเวลาจริง (ของเรา: Gpredict เทียบเลข YYDDD.dddd ซึ่งทำให้ปี 19xx ใหญ่กว่า 20xx)"""
    cur = best.get(s.norad)
    if cur is None:
        best[s.norad] = s
        return
    if s.epoch > cur.epoch:
        merged = s
    elif s.epoch == cur.epoch and s.status != cur.status and s.status != UNKNOWN_STATUS:
        merged = replace(cur, status=s.status)
    else:
        merged = cur
    name = s.name if cur.generated_name and not s.generated_name else cur.name
    best[s.norad] = merged if merged.name == name else replace(merged, name=name)


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

    def norads(self) -> set[int]:
        """NORAD ทุกดวงในดัชนี (สำเนา) ใช้ตรวจว่าดาวของ module อยู่ในดัชนี"""
        with self._lock:
            return set(self._sats)

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

    def apply_sets(self, sources: dict[str, list[TleSet]], now: datetime, add_new: bool,
                   replace_groups: set[str] | frozenset[str] = frozenset()) -> UpdateResult:
        """รวมชุด TLE ของแต่ละ source (กลุ่ม -> ชุดที่อ่านได้) เข้าดัชนีตามกติกาของ Gpredict (ref-D §5.3) ยังไม่บันทึกลงดิสก์ (เรียก save())
        กลุ่มที่อยู่ใน sources คือกลุ่มที่อ่านได้รอบนี้ กลุ่มที่อ่านไม่ได้ไม่ต้องใส่ (สมาชิกเดิมของมันไม่ถูกแตะ)

        ขั้นที่ 1 รวมทุก source เป็นชุดดีที่สุดต่อ NORAD (_merge_source_set) ดวงเดียวกันซ้ำในไฟล์เดียวหรือข้ามไฟล์ก็รวมแบบเดียวกัน
        ขั้นที่ 2 เทียบกับดาวในดัชนี (ดาวเดิมแต่ละดวงนับครั้งเดียว: updated + skipped + missing = จำนวนดาวเดิม)
        - epoch ใหม่กว่าเดิม: แทนบรรทัด TLE, epoch, สถานะ (แม้ใหม่เป็น Unknown) และเวลา updated -> updated
        - epoch เท่ากัน: สถานะที่ต่างและไม่ใช่ Unknown แทนสถานะเดิม -> updated ไม่งั้น skipped
        - epoch เก่ากว่า: skipped ไม่เคยถอยกลับ
        - ชื่อเดิมที่คอมพิวเตอร์สร้าง ("2026-001A", มี OBJECT) ถูกแทนด้วยชื่อจริงที่ได้มา ไม่ว่า epoch เป็นอย่างไร -> updated
          (ชื่อว่างไม่ถือว่าสร้างเอง จึงแทนได้เหมือน Gpredict และชื่อจริงเดิมไม่ถูกแทนด้วยชื่อจริงอื่น)
        - ไม่มีข้อมูลใน source ใดเลย: missing เก็บดาวเดิมไว้ทั้งดวง
        - ดวงที่ไม่มีในดัชนี: เพิ่มเมื่อ add_new (นับใน new ไม่นับใน updated) ไม่งั้นข้าม
        กลุ่มของดาวในดัชนี = กลุ่มที่พบดาวนั้นครั้งนี้ รวมกลุ่มเดิมของมัน ยกเว้นกลุ่มใน replace_groups ที่อยู่ใน sources ด้วย
        กลุ่มพวกนั้น "สมาชิกถูกแทนด้วยดาวในไฟล์" ดวงที่ไม่อยู่ในไฟล์หลุดจากกลุ่มแต่ยังอยู่ในดัชนี (เหมือนไฟล์ .cat ของ Gpredict)
        กลุ่มอื่นใน sources เพิ่มสมาชิกได้อย่างเดียว"""
        now = now.astimezone(_UTC)
        best: dict[int, TleSet] = {}
        seen: dict[int, set[str]] = {}
        for group, sets in sources.items():
            for s in sets:
                seen.setdefault(s.norad, set()).add(group)
                _merge_source_set(best, s)
        replaced = set(replace_groups) & sources.keys()

        with self._lock:
            updated = skipped = missing = new = 0
            for norad, old in list(self._sats.items()):
                cur = old
                src = best.get(norad)
                if src is None:
                    missing += 1
                else:
                    if src.epoch > old.epoch:
                        cur = replace(cur, tle_lines=src.lines, epoch=src.epoch, updated=now, status=src.status)
                    elif src.epoch == old.epoch and src.status != old.status and src.status != UNKNOWN_STATUS:
                        cur = replace(cur, status=src.status)
                    if is_generated_name(old.name) and not src.generated_name:
                        cur = replace(cur, name=src.name)
                    if cur == old:
                        skipped += 1
                    else:
                        updated += 1
                groups = sorted((set(old.groups) - replaced) | seen.get(norad, set()))
                if groups != cur.groups:                      # กลุ่มเปลี่ยนอย่างเดียวไม่นับเป็น updated
                    cur = replace(cur, groups=groups)
                if cur != old:
                    self._sats[norad] = cur
            if add_new:
                for norad, src in best.items():
                    if norad not in self._sats:
                        self._sats[norad] = SatRecord(norad, src.name, sorted(seen[norad]), src.lines, src.epoch, now, src.status)
                        new += 1
        return UpdateResult(updated, skipped, missing, new=new)

    def apply_groups(self, files: dict[str, Path], now: datetime, add_new: bool = True) -> UpdateResult:
        """รวมไฟล์ OMM ของแต่ละกลุ่ม CelesTrak (กลุ่ม -> path) เข้าดัชนีด้วย apply_sets ยังไม่บันทึกลงดิสก์ (เรียก save())

        OMM แต่ละรายการแปลงเป็น TleSet (สถานะ Unknown) ทุกกลุ่มที่อ่านไฟล์ได้อยู่ใน replace_groups: ดาวที่หายไปจากกลุ่มที่อ่านครั้งนี้
        หลุดจากกลุ่มนั้น ส่วนกลุ่มที่อ่านไม่ได้คงสมาชิกเดิม (ดึงกลุ่มนั้นไม่ได้ ไม่ถือว่าออกจากกลุ่ม)
        ไฟล์ที่อ่านไม่ได้ข้ามทั้งกลุ่ม, ดาวที่แปลงเป็น TLE ไม่ได้ข้ามเฉพาะดวง ทั้งสองกรณีมี Message เตือน
        """
        messages: list[Message] = []
        sources: dict[str, list[TleSet]] = {}
        for group, path in files.items():
            try:
                records = omm.read_omm(Path(path))
            except (OSError, ValueError) as exc:
                messages.append(Message("ORBIT_DOWNLOAD_FAILED", "warning",
                                        f"อ่านไฟล์ OMM กลุ่ม {group} ({Path(path).name}) ไม่ได้ ({exc}) ข้ามกลุ่มนี้", group))
                continue
            sets: list[TleSet] = []
            bad = []
            for rec in records:
                try:
                    lines = omm.to_tle_lines(rec)
                except ValueError:
                    bad.append(rec.norad)
                    continue
                sets.append(TleSet(rec.norad, rec.name, UNKNOWN_STATUS, lines, rec.epoch))
            sources[group] = sets
            if bad:
                shown = ", ".join(str(n) for n in bad[:5]) + (f" และอีก {len(bad) - 5} ดวง" if len(bad) > 5 else "")
                messages.append(Message("TLE_CONVERT_FAILED", "warning",
                                        f"แปลง OMM กลุ่ม {group} เป็น TLE ไม่ได้ {len(bad)} ดวง (NORAD {shown}) ข้ามดวงเหล่านี้", group))
        result = self.apply_sets(sources, now, add_new, frozenset(sources))
        result.messages = messages
        return result

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
