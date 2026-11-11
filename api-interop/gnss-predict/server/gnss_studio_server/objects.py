"""object แบบ STK ในเอกสาร scenario.json: Object Browser, Insert STK Objects, Properties Browser, rename/delete และ groups
(หัวข้อ 5.1 และ 6.4 ของ spec server, หัวข้อ 7 และ 8 ของ spec หน้าจอ)

- ทุกฟังก์ชันแก้ `doc` (dict ของ scenario.json ที่ client ส่งมาเอง) ในที่เดิมและไม่แตะดิสก์ route เป็นคนอ่านและเขียนผ่าน `ScenarioStore`
  ฟังก์ชันที่แก้ตรวจทุกอย่างก่อนแก้ ผิดแล้ว raise `ApiError` โดย `doc` ยังเหมือนเดิม
- path ของ object คือ `*/<class>/<name>` ชื่อไม่ซ้ำกันข้าม class แบบไม่สนตัวพิมพ์เล็กใหญ่ (กติกาของ engine)
- หน้าของ Properties Browser: `basic` คือช่องระดับบนของ object ตามตาราง `BASIC_KEYS` ส่วน `graphics2d`, `graphics3d`, `constraints`
  คือส่วนย่อยชื่อเดียวกันใน object ที่ class นั้นมี (ตาราง `PAGE_SECTIONS`) ที่ไม่มีคืน {}
- `field` ของ 422 เรียกตามหน้า เช่น `basic.norad`, `graphics2d.pass.lead_type`
"""

import copy
import re
from collections.abc import Callable
from pathlib import Path
from typing import Any

from gnss_predict.catalog import Catalog

from . import templates
from .errors import ApiError
from .schema import NAME_RE, OBJECT_CLASSES, validate_object
from .templates import DEFAULT_COLOR, FACILITY_COLOR, SYSTEM_COLORS

PAGE_GROUPS = ("basic", "graphics2d", "graphics3d", "constraints")
# ช่องระดับบนของ object ที่หน้า Basic ของแต่ละ class เห็น (ชื่อ, class และ graphics อยู่นอกหน้านี้)
BASIC_KEYS = {
    "Facility": ("description", "position"),
    "Satellite": ("description", "norad"),                     # NORAD อ่านอย่างเดียวใน v1
    "Constellation": ("description", "system", "color", "assigned_objects"),
}
BASIC_DEFAULTS = {"description": "", "system": None, "color": None, "assigned_objects": []}
PAGE_SECTIONS = {
    "Facility": ("graphics2d", "graphics3d", "constraints"),
    "Satellite": ("graphics2d", "graphics3d"),
    "Constellation": (),
}

METHOD_DEFINE = "Define Properties"
METHOD_DEFAULT = "Insert Default"
METHOD_CATALOG = "From Satellite Catalog"
INSERT_METHODS = (METHOD_DEFINE, METHOD_DEFAULT, METHOD_CATALOG)
_CONTROL_KEYS = frozenset({"class", "method"})
_OBJECT_KEYS = {
    "Facility": frozenset({"name", "description", "position", "constraints", "graphics2d", "graphics3d"}),
    "Satellite": frozenset({"name", "norad", "description", "graphics2d", "graphics3d"}),
    "Constellation": frozenset({"name", "system", "description", "color", "assigned_objects"}),
}
_CATALOG_KEYS = frozenset({"norads", "create_constellation"})
_SATELLITE_PATH_RE = re.compile(r"^\*/Satellite/[A-Za-z0-9_-]{1,32}$")
_INVALID = "SCENARIO_INVALID"


def _invalid(text: str, field: str | None = None, detail: str | None = None) -> ApiError:
    return ApiError(422, _INVALID, text, field, detail)


# ---------- path และการค้นหา ----------

def path_of(obj: dict) -> str:
    return f"*/{obj['class']}/{obj['name']}"


def find(doc: dict, cls: str, name: str) -> tuple[int, dict]:
    """(ตำแหน่งใน doc["objects"], object) ชื่อต้องตรงทุกตัวอักษร ไม่พบ (รวม class ที่ไม่รู้จัก) -> ApiError 404"""
    for i, obj in enumerate(doc["objects"]):
        if obj.get("class") == cls and obj.get("name") == name:
            return i, obj
    raise ApiError(404, "NOT_FOUND", f"ไม่พบ object */{cls}/{name}")


def _existing_paths(doc: dict) -> set[str]:
    return {path_of(o) for o in doc["objects"]}


def _deep_merge(base: dict, patch: dict) -> dict:
    """ผสม patch ลงใน base ในที่เดิม: dict ซ้อนผสมกันทีละชั้น ค่าอื่น (รวม list) แทนที่ทั้งก้อน"""
    for key, value in patch.items():
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            _deep_merge(base[key], value)
        else:
            base[key] = copy.deepcopy(value)
    return base


class _Names:
    """ชื่อที่ถูกใช้แล้วใน scenario (ไม่แยกตัวพิมพ์เล็กใหญ่ ทุก class) พร้อมจองชื่อใหม่ระหว่างสร้างทีละหลายตัว"""

    def __init__(self, doc: dict):
        self.taken = {o["name"].casefold(): o["name"] for o in doc["objects"]}

    def claim(self, name: str, field: str) -> None:
        existing = self.taken.get(name.casefold())
        if existing is not None:
            raise ApiError(409, "NAME_EXISTS", f"มี object ชื่อ {existing} อยู่แล้ว (ชื่อไม่แยกตัวพิมพ์เล็กใหญ่)", field, existing)
        self.taken[name.casefold()] = name

    def first_free(self, prefix: str) -> str:
        n = 1
        while f"{prefix}{n}".casefold() in self.taken:
            n += 1
        return f"{prefix}{n}"


def _require_existing(doc: dict, paths: Any, field: str, *, satellites_only: bool = False) -> list[str]:
    """รายการ path ที่ทุกตัวมีอยู่จริง (ดาวเท่านั้นถ้า satellites_only) ไม่ใช่ -> 422 ที่ field"""
    if not isinstance(paths, list):
        raise _invalid("ต้องเป็นรายการ path ของ object เช่น */Satellite/G01", field)
    existing = _existing_paths(doc)
    for p in paths:
        if not isinstance(p, str) or p not in existing:
            raise _invalid(f"ไม่พบ object {p} ใน scenario", field)
        if satellites_only and not _SATELLITE_PATH_RE.fullmatch(p):
            raise _invalid(f"{p} ไม่ใช่ดาว กลุ่มใน Object Browser ใส่ได้เฉพาะดาว", field)
    return paths


# ---------- Object Browser ----------

def tree(doc: dict) -> dict:
    """โครง Object Browser: Facility, Constellation, โฟลเดอร์ของแต่ละกลุ่ม (ตามลำดับใน groups) แล้วดาวที่ไม่อยู่ในกลุ่มใด
    ไม่ใช้ catalog: ธงและสถานะซ่อนของดาวมาจาก /catalog ภายหลัง"""
    objs = doc.get("objects", [])
    constellation_color: dict[str, str] = {}                  # path ของสมาชิก -> สีของ Constellation แรกที่มีสมาชิกนั้น
    for obj in objs:
        if obj.get("class") == "Constellation" and obj.get("color"):
            for member in obj.get("assigned_objects", []):
                constellation_color.setdefault(member, obj["color"])

    def node(obj: dict) -> dict:
        cls, path, g2 = obj["class"], path_of(obj), obj.get("graphics2d") or {}
        if cls == "Constellation":
            color, show = obj.get("color") or DEFAULT_COLOR, True
        elif cls == "Facility":
            color, show = g2.get("color") or FACILITY_COLOR, g2.get("show", True)
        else:
            inherited = constellation_color.get(path) if g2.get("inherit", True) else None
            color, show = inherited or g2.get("color") or DEFAULT_COLOR, g2.get("show", True)
        return {"path": path, "class": cls, "name": obj["name"], "color": color, "show": show}

    children = [node(o) for o in objs if o.get("class") == "Facility"]
    children += [node(o) for o in objs if o.get("class") == "Constellation"]
    satellites = {path_of(o): node(o) for o in objs if o.get("class") == "Satellite"}
    placed: set[str] = set()
    for grp in doc.get("groups", []):
        members = []
        for path in grp.get("members", []):
            if path in satellites and path not in placed:     # ดาวอยู่ได้กลุ่มเดียว ชื่อที่ไม่มีอยู่จริงข้าม
                placed.add(path)
                members.append(satellites[path])
        children.append({"group": grp["name"], "children": members})
    children += [n for path, n in satellites.items() if path not in placed]
    return {"path": "*", "class": "Scenario", "name": doc["name"], "children": children}


# ---------- Properties Browser ----------

def pages(obj: dict) -> dict:
    """ค่าตั้งแยกตามหน้า {basic, graphics2d, graphics3d, constraints} (สำเนา แก้แล้วไม่กระทบ doc) หน้าที่ class ไม่มีคือ {}"""
    cls = obj["class"]
    out: dict[str, dict] = {group: {} for group in PAGE_GROUPS}
    for key in BASIC_KEYS[cls]:
        if key in obj:
            out["basic"][key] = copy.deepcopy(obj[key])
        elif key in BASIC_DEFAULTS:
            out["basic"][key] = copy.deepcopy(BASIC_DEFAULTS[key])
    for section in PAGE_SECTIONS[cls]:
        out[section] = copy.deepcopy(obj.get(section) or {})
    return out


def _page_field(cls: str) -> Callable[[str], str]:
    """path ภายใน object -> ชื่อช่องของหน้า: ช่องของหน้า basic ขึ้นต้นด้วย `basic.` ส่วนอื่นชื่อเหมือนเดิม"""
    basic = set(BASIC_KEYS[cls])

    def field_of(path: str) -> str:
        return f"basic.{path}" if re.split(r"[.\[]", path, maxsplit=1)[0] in basic else path
    return field_of


def apply_pages(doc: dict, cls: str, name: str, patch: dict) -> dict:
    """Apply ของ Properties Browser: ผสมเฉพาะหน้าที่ส่งมา (deep merge) แล้วตรวจ object ทั้งก้อนด้วย schema คืน object ใหม่
    หน้าที่ไม่รู้จัก, หน้าที่ class นั้นไม่มีแต่ส่งค่ามา, ช่อง basic นอกรายการ และการเปลี่ยน NORAD -> 422"""
    index, obj = find(doc, cls, name)
    if not isinstance(patch, dict):
        raise _invalid("ต้องส่งเป็น object ของหน้าที่แก้")
    for group in patch:
        if group not in PAGE_GROUPS:
            raise _invalid(f"ไม่รู้จักหน้า {group} (หน้าที่มี: {', '.join(PAGE_GROUPS)})", group)
    merged = copy.deepcopy(obj)
    for group, values in patch.items():
        if not isinstance(values, dict):
            raise _invalid(f"หน้า {group} ต้องเป็น object", group)
        if group == "basic":
            for key in values:
                if key not in BASIC_KEYS[cls]:
                    raise _invalid(f"หน้า basic ของ {cls} ไม่มีช่อง {key}", f"basic.{key}")
            if "norad" in values:                             # อ่านอย่างเดียว: ส่งค่าเดิมกลับมาได้ ค่าอื่นไม่ได้
                if values["norad"] != obj["norad"] or isinstance(values["norad"], bool):
                    raise _invalid("NORAD แก้ไม่ได้ (อ่านอย่างเดียว)", "basic.norad")
                values = {k: v for k, v in values.items() if k != "norad"}
            _deep_merge(merged, values)
        elif group in PAGE_SECTIONS[cls]:
            merged[group] = _deep_merge(merged.get(group) or {}, values)
        elif values:
            raise _invalid(f"{cls} ไม่มีหน้า {group}", group)
    validate_object(cls, merged, _page_field(cls))
    if cls == "Constellation":
        _require_existing(doc, merged.get("assigned_objects", []), "basic.assigned_objects")
    doc["objects"][index] = merged
    return merged


# ---------- Insert STK Objects ----------

def scenario_catalog(doc: dict, data_dir: Path) -> Catalog:
    """catalog ของ snapshot และช่วงเวลาของ scenario (สร้างจริง ใช้เฉพาะ From Satellite Catalog)"""
    period = doc["analysis_period"]
    return templates.load_catalog(data_dir, doc["orbit_snapshot"], templates.parse_utc(period["start"], "analysis_period"),
                                  templates.parse_utc(period["stop"], "analysis_period"), "orbit_snapshot")


def insert(doc: dict, body: dict, catalog: Callable[[], Catalog]) -> list[str]:
    """สร้าง object ตาม `body` = {class, method, ...} ใส่ท้าย doc["objects"] คืน path ที่สร้าง (ดาวก่อน แล้ว Constellation)
    `catalog` คือฟังก์ชันสร้าง catalog ที่เรียกเฉพาะ From Satellite Catalog (สร้างแพง)
    ชื่อซ้ำกับ object ใดก็ตาม (ไม่สนตัวพิมพ์เล็กใหญ่) -> 409 และไม่สร้างอะไรเลย"""
    cls, method = body.get("class"), body.get("method")
    if not isinstance(cls, str) or cls not in OBJECT_CLASSES:
        raise _invalid(f"class ต้องเป็นหนึ่งใน {', '.join(OBJECT_CLASSES)}", "class")
    if not isinstance(method, str) or method not in INSERT_METHODS:
        raise _invalid(f"method ต้องเป็นหนึ่งใน {', '.join(INSERT_METHODS)}", "method")
    allowed = _CONTROL_KEYS | {METHOD_DEFINE: _OBJECT_KEYS[cls], METHOD_DEFAULT: frozenset(), METHOD_CATALOG: _CATALOG_KEYS}[method]
    for key in body:
        if key not in allowed:
            raise _invalid(f"วิธี {method} ไม่รับช่อง {key}", key)
    names = _Names(doc)
    if method == METHOD_DEFINE:
        created = _define(doc, names, cls, body)
    elif method == METHOD_DEFAULT:
        created = _default(names, cls)
    else:
        created = _from_catalog(names, cls, body, catalog)
    doc["objects"].extend(created)
    return [path_of(o) for o in created]


def _define(doc: dict, names: _Names, cls: str, body: dict) -> list[dict]:
    props = {k: v for k, v in body.items() if k not in _CONTROL_KEYS}
    name = props.get("name")
    if not isinstance(name, str) or not NAME_RE.fullmatch(name):
        raise _invalid("ชื่อต้องเป็นตัวอักษร A-Z a-z ตัวเลข _ หรือ - ยาว 1 ถึง 32 ตัว", "name")
    required = {"Facility": "position", "Satellite": "norad"}.get(cls)
    if required is not None and required not in props:
        raise _invalid(f"ช่อง {required}: ต้องมีค่า", required)
    if cls == "Facility":
        obj = _deep_merge(templates.facility(name, 0.0, 0.0, 0.0, 0.0), props)
        position = props["position"]                           # ตำแหน่งต้องระบุครบ ไม่ผสมกับค่าตั้งต้น
        obj["position"] = {"type": "Geodetic", **copy.deepcopy(position)} if isinstance(position, dict) else position
    elif cls == "Satellite":
        obj = _deep_merge(templates.satellite(name, 1, DEFAULT_COLOR), props)
    else:
        system = props.get("system")
        color = SYSTEM_COLORS.get(system, DEFAULT_COLOR) if isinstance(system, str) else DEFAULT_COLOR
        obj = _deep_merge(templates.constellation(name, None, color, []), props)
    validate_object(cls, obj)
    if cls == "Constellation":
        _require_existing(doc, obj["assigned_objects"], "assigned_objects")
    names.claim(name, "name")
    return [obj]


def _default(names: _Names, cls: str) -> list[dict]:
    if cls == "Satellite":
        raise _invalid("ดาวไม่มี Insert Default ให้เลือก From Satellite Catalog หรือ Define Properties", "method")
    name = names.first_free(cls)
    names.claim(name, "name")
    if cls == "Facility":
        return [templates.facility(name, 0.0, 0.0, 0.0, 0.0)]
    return [templates.constellation(name, None, DEFAULT_COLOR, [])]


def _from_catalog(names: _Names, cls: str, body: dict, catalog: Callable[[], Catalog]) -> list[dict]:
    if cls != "Satellite":
        raise _invalid("From Satellite Catalog ใช้ได้กับ class Satellite เท่านั้น", "class")
    norads = body.get("norads")
    if not isinstance(norads, list) or not norads or not all(type(n) is int and n > 0 for n in norads):
        raise _invalid("norads ต้องเป็นรายการ NORAD (จำนวนเต็มบวก) อย่างน้อยหนึ่งตัว", "norads")
    group_name = body.get("create_constellation")
    if group_name is not None and (not isinstance(group_name, str) or not NAME_RE.fullmatch(group_name)):
        raise _invalid("ชื่อ Constellation ต้องเป็นตัวอักษร A-Z a-z ตัวเลข _ หรือ - ยาว 1 ถึง 32 ตัว", "create_constellation")
    by_norad = {sat.norad: sat for sat in catalog().satellites}
    missing = [n for n in dict.fromkeys(norads) if n not in by_norad]
    if missing:
        raise _invalid(f"NORAD {', '.join(map(str, missing))} ไม่มีใน catalog ของ snapshot นี้ (หรือไม่มี PRN ณ ต้นช่วง)", "norads")
    picked = [by_norad[n] for n in dict.fromkeys(norads)]       # NORAD ซ้ำในคำขอนับครั้งเดียว
    created = []
    for sat in picked:
        names.claim(sat.prn, "norads")
        created.append(templates.satellite(sat.prn, sat.norad, SYSTEM_COLORS.get(sat.system, DEFAULT_COLOR)))
    if group_name is not None:
        names.claim(group_name, "create_constellation")
        systems = {sat.system for sat in picked}
        system = systems.pop() if len(systems) == 1 and picked[0].system in SYSTEM_COLORS else None
        created.append(templates.constellation(group_name, system, SYSTEM_COLORS.get(system, DEFAULT_COLOR),
                                               [path_of(o) for o in created]))
    return created


# ---------- Rename และ Delete ----------

def _rewrite_refs(doc: dict, fn: Callable[[str], str | None]) -> None:
    """แก้การอ้างถึง path ใน assigned_objects, groups.members และ accesses ด้วย fn(path) -> path ใหม่ หรือ None = ลบการอ้างถึง
    access ที่ `from` ถูกลบ หรือที่ `to` เคยมีและเหลือว่างเพราะการลบ ถูกลบทั้ง access"""
    def mapped(paths: list[str]) -> list[str]:
        return [new for p in paths if (new := fn(p)) is not None]

    for obj in doc["objects"]:
        if obj.get("class") == "Constellation" and "assigned_objects" in obj:
            obj["assigned_objects"] = mapped(obj["assigned_objects"])
    for grp in doc.get("groups", []):
        grp["members"] = mapped(grp.get("members", []))
    if "accesses" in doc:
        kept = []
        for access in doc["accesses"]:
            source, targets = fn(access["from"]), mapped(access["to"])
            if source is None or (access["to"] and not targets):
                continue
            access["from"], access["to"] = source, targets
            kept.append(access)
        doc["accesses"] = kept


def rename(doc: dict, cls: str, name: str, new_name: Any) -> str:
    """เปลี่ยนชื่อ object และแก้ `*/<class>/<ชื่อเก่า>` เป็นชื่อใหม่ในทุกที่ที่อ้างถึง คืน path ใหม่
    ชื่อชนกับ object อื่น (ไม่สนตัวพิมพ์เล็กใหญ่ ทุก class) -> 409 เปลี่ยนเฉพาะตัวพิมพ์ของชื่อตัวเองได้"""
    index, obj = find(doc, cls, name)
    if not isinstance(new_name, str) or not NAME_RE.fullmatch(new_name):
        raise _invalid("ชื่อต้องเป็นตัวอักษร A-Z a-z ตัวเลข _ หรือ - ยาว 1 ถึง 32 ตัว", "new_name")
    for i, other in enumerate(doc["objects"]):
        if i != index and other["name"].casefold() == new_name.casefold():
            raise ApiError(409, "NAME_EXISTS", f"มี object ชื่อ {other['name']} อยู่แล้ว (ชื่อไม่แยกตัวพิมพ์เล็กใหญ่)", "new_name", other["name"])
    old_path = path_of(obj)
    obj["name"] = new_name
    new_path = path_of(obj)
    _rewrite_refs(doc, lambda p: new_path if p == old_path else p)
    return new_path


def delete(doc: dict, cls: str, name: str) -> None:
    """ลบ object และลบ path ของมันออกจาก groups, assigned_objects และ `to` ของ access ลบ Facility ลบ access ที่ออกจากมันด้วย
    access ที่ `to` ว่างเพราะการลบถูกลบ ลบ Constellation แล้วดาวสมาชิกยังอยู่"""
    index, obj = find(doc, cls, name)
    path = path_of(obj)
    del doc["objects"][index]
    _rewrite_refs(doc, lambda p: None if p == path else p)


# ---------- Groups ----------

def set_group(doc: dict, name: Any, members: Any) -> str:
    """สร้างกลุ่ม `name` หรือตั้งสมาชิกของกลุ่มที่มีอยู่ (ชื่อไม่สนตัวพิมพ์เล็กใหญ่) ให้เป็น `members` ตรงตัว คืนชื่อกลุ่มที่เก็บ
    สมาชิกต้องเป็นดาวที่มีอยู่ ดาวที่ย้ายเข้ากลุ่มนี้ออกจากกลุ่มอื่น (ดาวอยู่ได้กลุ่มเดียว)"""
    if not isinstance(name, str) or not name.strip():
        raise _invalid("ชื่อกลุ่มต้องไม่ว่าง", "name")
    members = list(dict.fromkeys(_require_existing(doc, members, "members", satellites_only=True)))
    groups = doc.setdefault("groups", [])
    target = next((g for g in groups if g["name"].casefold() == name.casefold()), None)
    taken = set(members)
    for grp in groups:
        if grp is not target:
            grp["members"] = [m for m in grp.get("members", []) if m not in taken]
    if target is None:
        target = {"name": name, "members": members}
        groups.append(target)
    else:
        target["members"] = members
    return target["name"]
