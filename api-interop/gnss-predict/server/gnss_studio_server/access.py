"""Access tool: ตรรกะของรายการ access ใน scenario.json (หัวข้อ 5.1 `accesses` และ 6.6 ของ spec server)

- ทุกฟังก์ชันที่แก้ `doc` (dict ของ scenario.json ที่ client ส่งมาเอง) แก้ในที่เดิมและไม่แตะดิสก์ route เป็นคนอ่านและเขียนผ่าน `write_tracked`
  ฟังก์ชันตรวจทุกอย่างก่อนแก้ ผิดแล้ว raise `ApiError` 422 (`field` คือ `from` หรือ `to`) โดย `doc` ยังเหมือนเดิม
- `normalize`: Access For เป็นดาวและปลายทางเป็น Facility เดียว สลับเป็น Facility -> ดาว (ช่วง access เท่ากัน) หลังนั้น `from` ต้องเป็น
  Facility และ `to` ต้องเป็นดาวหรือ Constellation ทั้งหมด
- `expand_targets`: Constellation หมายถึงสมาชิกใน `assigned_objects` ณ ตอนที่อ่าน ที่ไม่ถูกซ่อน ดาวที่ระบุตรง ๆ คงอยู่แม้ถูกซ่อน คืน**ชื่อ**ดาว
  (ไม่ใช่ path) ไม่ซ้ำ เรียงตามที่พบก่อน
- ดาวที่ซ่อน (`hidden_satellites`) คือดาวที่ manifest ของ ephem ที่ current บอก `propagated: false` หรือไม่มีใน manifest ไม่มี manifest = ไม่ซ่อนอะไร
  ชื่อดาว -> PRN ผ่าน NORAD ของ scenario แล้วหาใน manifest (`satellite_prns`) ซึ่งเป็นกุญแจของ `intervals.json`
- access ในรายการจับคู่กันด้วย (`from`, ชุดของ `to` ไม่สนลำดับ) ตามที่เก็บไว้ ไม่ขยาย Constellation
"""

from datetime import datetime, timedelta, timezone
from typing import Any

from .errors import ApiError
from .jobs import iso_ms
from .objects import path_of
from .schema import parse_utc_z
from .templates import access_graphics

FACILITY, SATELLITE, CONSTELLATION = "Facility", "Satellite", "Constellation"
ALL = "all"                                         # `to` ของ Clear / Remove: ทุก access ของ Facility นั้น
MODE_SPECIFY = "specify"
_INVALID = "SCENARIO_INVALID"


def _invalid(text: str, field: str) -> ApiError:
    return ApiError(422, _INVALID, text, field)


def _index(doc: dict) -> dict[str, dict]:
    return {path_of(o): o for o in doc.get("objects", [])}


def _require(objs: dict[str, dict], path: Any, field: str) -> dict:
    if not isinstance(path, str) or path not in objs:
        raise _invalid(f"ไม่พบ object {path} ใน scenario", field)
    return objs[path]


# ---------- normalize และ expand ----------

def normalize(doc: dict, from_path: Any, to: Any) -> tuple[str, list[str]]:
    """(from, to) ที่จะเก็บ: `to` ไม่ซ้ำ เรียงตามที่พบก่อน ดาว + Facility เดียวสลับเป็น Facility + [ดาว]
    path ที่ไม่พบ, `to` ว่างหรือไม่ใช่รายการ, `from` ที่ไม่ใช่ Facility (หลังสลับ) หรือ `to` ที่เป็น Facility -> 422 ที่ `from` หรือ `to`"""
    objs = _index(doc)
    source = _require(objs, from_path, "from")
    if not isinstance(to, list) or not to:
        raise _invalid("ต้องระบุปลายทาง (to) อย่างน้อยหนึ่งรายการ", "to")
    for path in to:
        _require(objs, path, "to")
    targets = list(dict.fromkeys(to))
    if source["class"] == SATELLITE and [objs[p]["class"] for p in targets] == [FACILITY]:
        return targets[0], [from_path]
    if source["class"] != FACILITY:
        raise _invalid(f"Access For {from_path} ต้องเป็น Facility (หรือดาวที่เลือก Facility เพียงตัวเดียวเป็นปลายทาง)", "from")
    for path in targets:
        if objs[path]["class"] == FACILITY:
            raise _invalid(f"ปลายทาง {path} เป็น Facility ปลายทางต้องเป็นดาวหรือ Constellation", "to")
    return from_path, targets


def expand_targets(doc: dict, to: Any, hidden: set[str]) -> list[str]:
    """ชื่อดาวที่ `to` หมายถึง: Constellation -> สมาชิกใน `assigned_objects` ที่ไม่อยู่ใน `hidden` ดาว -> ตัวมันเอง (แม้ซ่อน)
    ไม่ซ้ำ เรียงตามที่พบก่อน path ที่ไม่พบหรือเป็น Facility -> 422 ที่ `to` สมาชิกที่ไม่มีอยู่จริงหรือไม่ใช่ดาวข้าม"""
    if not isinstance(to, list):
        raise _invalid("ปลายทาง (to) ต้องเป็นรายการ path ของ object", "to")
    objs = _index(doc)
    names: dict[str, None] = {}
    for path in to:
        obj = _require(objs, path, "to")
        if obj["class"] == SATELLITE:
            names.setdefault(obj["name"])
        elif obj["class"] == CONSTELLATION:
            for member in obj.get("assigned_objects", []):
                sat = objs.get(member) if isinstance(member, str) else None
                if sat is not None and sat["class"] == SATELLITE and sat["name"] not in hidden:
                    names.setdefault(sat["name"])
        else:
            raise _invalid(f"ปลายทาง {path} เป็น Facility ปลายทางต้องเป็นดาวหรือ Constellation", "to")
    return list(names)


# ---------- manifest ของ ephem ----------

def _rows_by_norad(manifest: dict) -> dict[Any, dict]:
    rows = manifest.get("satellites")
    return {row.get("norad"): row for row in rows if isinstance(row, dict)} if isinstance(rows, list) else {}


def _satellites(doc: dict) -> list[dict]:
    return [o for o in doc.get("objects", []) if o.get("class") == SATELLITE]


def hidden_satellites(doc: dict, manifest: dict | None) -> set[str]:
    """ชื่อดาวของ scenario ที่ไม่ถูก propagate ตาม manifest ของ ephem (NORAD ไม่อยู่ใน manifest ก็นับ) manifest เป็น None = ไม่ซ่อนอะไร"""
    if manifest is None:
        return set()
    rows = _rows_by_norad(manifest)
    return {sat["name"] for sat in _satellites(doc) if not (rows.get(sat.get("norad")) or {}).get("propagated")}


def satellite_prns(doc: dict, manifest: dict) -> dict[str, str]:
    """ชื่อดาวของ scenario -> PRN ใน manifest ผ่าน NORAD (เฉพาะดาวที่ NORAD อยู่ใน manifest)"""
    rows = _rows_by_norad(manifest)
    return {sat["name"]: rows[sat["norad"]]["prn"] for sat in _satellites(doc)
            if isinstance(rows.get(sat.get("norad")), dict) and isinstance(rows[sat["norad"]].get("prn"), str)}


# ---------- รายการ access ----------

def _same_targets(entry: dict, to: list[str]) -> bool:
    return set(entry.get("to", [])) == set(to)


def stored_time_period(doc: dict, from_path: str, to: list[str]) -> dict:
    """time_period ของ access ที่ตรงกับ (from, to) ที่ normalize แล้ว ไม่มี = `{"mode": "object"}`"""
    for entry in doc.get("accesses", []):
        if entry.get("from") == from_path and _same_targets(entry, to):
            return entry.get("time_period") or {"mode": "object"}
    return {"mode": "object"}


def upsert(doc: dict, from_path: str, to: list[str], time_period: dict | None, graphics: dict | None, timeline: bool | None) -> dict:
    """ตั้ง access (from, to) ให้ computed: true สร้างใหม่ถ้ายังไม่มี (ค่าตั้งต้น: object, กราฟิกตั้งต้น, timeline) ถ้ามีแล้วแก้เฉพาะที่ส่งมา
    - `graphics` คือเฉพาะช่องที่ client ส่ง (`exclude_unset`) ผสมลงในกราฟิกที่เก็บไว้ทีละช่อง ช่องที่ไม่ได้ส่งและช่องที่ไม่รู้จักคงเดิม
      access ที่ไม่มี graphics ใช้กราฟิกตั้งต้นเป็นฐาน
    - `time_period` เป็นหน่วยเดียว (mode กับ start/stop ไปด้วยกัน) จึงแทนที่ทั้งก้อน ส่วน `timeline` แทนที่ค่าเดียว
    - ช่องอื่นของ access (รวมช่องที่ไม่รู้จัก) คงเดิม คืน access นั้น (`from_path` และ `to` ต้องผ่าน `normalize` แล้ว)"""
    accesses = doc.setdefault("accesses", [])
    entry = next((e for e in accesses if e.get("from") == from_path and _same_targets(e, to)), None)
    if entry is None:
        entry = {"from": from_path, "to": list(to), "time_period": {"mode": "object"}, "graphics": access_graphics(),
                 "timeline": True, "computed": False}
        accesses.append(entry)
    if time_period is not None:
        entry["time_period"] = time_period
    if graphics is not None:
        base = entry.get("graphics")
        entry["graphics"] = {**(base if isinstance(base, dict) else access_graphics()), **graphics}
    if timeline is not None:
        entry["timeline"] = timeline
    entry["computed"] = True
    return entry


def matching(doc: dict, from_path: Any, to: Any) -> list[int]:
    """ตำแหน่งใน `doc["accesses"]` ของ access ที่ Clear / Remove หมายถึง: `to` เป็นรายการ -> (from, to) ตรงกันหลัง normalize
    `to` เป็น "all" -> ทุก access ที่ออกจาก Facility นั้น (from ต้องเป็น Facility) ผิดรูปแบบ -> 422 ที่ `from` หรือ `to`"""
    if to == ALL:
        source = _require(_index(doc), from_path, "from")
        if source["class"] != FACILITY:
            raise _invalid(f'to เป็น "all" ต้องระบุ Facility ใน from ไม่ใช่ {from_path}', "from")
        return [i for i, e in enumerate(doc.get("accesses", [])) if e.get("from") == from_path]
    from_path, to = normalize(doc, from_path, to)
    return [i for i, e in enumerate(doc.get("accesses", [])) if e.get("from") == from_path and _same_targets(e, to)]


def clear(doc: dict, from_path: Any, to: Any) -> int:
    """ตั้ง `computed: false` ให้ access ที่ตรง คืนจำนวนที่ตรง"""
    indexes = matching(doc, from_path, to)
    for i in indexes:
        doc["accesses"][i]["computed"] = False
    return len(indexes)


def remove(doc: dict, from_path: Any, to: Any) -> int:
    """ลบ access ที่ตรง คืนจำนวนที่ลบ"""
    indexes = set(matching(doc, from_path, to))
    if indexes:
        doc["accesses"] = [e for i, e in enumerate(doc["accesses"]) if i not in indexes]
    return len(indexes)


# ---------- ช่วง access ----------

def clip_intervals(rows: list[dict], start: datetime, stop: datetime) -> list[dict]:
    """ตัดช่วง `{start, stop, duration_s, max_el_deg}` ให้อยู่ใน [start, stop] (เศษวินาทีละเอียดกว่ามิลลิวินาทีถูกตัดทิ้ง)
    ช่วงที่ถูกตัดคำนวณ `duration_s` ใหม่ (ปัดเป็นมิลลิวินาที) และคง `max_el_deg` ช่วงที่ว่างหลังตัดถูกทิ้ง ช่วงที่ไม่ถูกตัดคงเดิมทุกค่า
    คืนรายการใหม่ ไม่แก้ `rows`"""
    lo, hi = _floor_ms(start), _floor_ms(stop)
    out = []
    for row in rows:
        begin, end = parse_utc_z(row["start"]), parse_utc_z(row["stop"])
        new_begin, new_end = max(begin, lo), min(end, hi)
        if (new_begin, new_end) == (begin, end):
            out.append(row)
        elif new_begin < new_end:
            out.append({**row, "start": iso_ms(new_begin), "stop": iso_ms(new_end),
                        "duration_s": round((new_end - new_begin) / timedelta(seconds=1), 3)})
    return out


def _floor_ms(t: datetime) -> datetime:
    t = t.astimezone(timezone.utc)
    return t.replace(microsecond=t.microsecond // 1000 * 1000)
