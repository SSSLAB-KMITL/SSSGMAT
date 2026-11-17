"""Style ของรายงาน/กราฟและการประกอบรายงาน (หัวข้อ 3.3–3.4 ของ spec งานย่อยที่ 4)

- style เป็น JSON ตามหัวข้อ 3.3 บวกช่อง P3: `dynamic`, `derive` (null | "gaps"), `summary.summary_only`, `ours`
  ช่องที่ละได้: group (null), time, summary, graph (null), dynamic (false), derive (null), ours (false)
- Installed Styles 14 ตัวอยู่ใน `styles/installed.json` (อ่านครั้งเดียว คืนสำเนาทุกครั้ง)
- สถิติเขียนเป็น `"<Min|Max|Mean|Total|Std Deviation> <Element>"` หรือ `"Number of Accesses"`
  Std Deviation แบบประชากร (หารด้วย N) ค่าที่เป็น None ไม่นับ ไม่มีค่าเลยได้ None
- Global Statistics คิดเมื่อมี object มากกว่าหนึ่งตัวเท่านั้น (ตาม STK) จากแถวของทุก object รวมกัน
- Gaps (P2): ส่วนเติมเต็มของช่วง Access Data ในช่วงเวลาของรายงานที่ตัดด้วยช่วงวิเคราะห์ คอลัมน์ Gap นำหน้า
- หลาย provider ใน content: ทุกตัวต้องมี Time แล้วรวมแถวตามเวลา (คอลัมน์ Time ของตัวแรกเท่านั้น)
"""

import copy
import json
import math
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path

from .dataproviders import (PROVIDERS, ElementInfo, ResultSet, _to_millisecond, display_name, object_period,
                            parse_object, provider_rows)
from .errors import ScenarioError, StyleError

INSTALLED_FILE = Path(__file__).parent / "styles" / "installed.json"
NAME_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9 _-]{0,47}")          # P5
KINDS = ("report", "graph")
OBJECT_TYPES = ("Access", "Facility", "Satellite")
GRAPH_TYPES = ("time_xy", "interval", "polar90")
TIME_MODES = ("object_period", "specify")
STAT_FUNCTIONS = ("Std Deviation", "Min", "Max", "Mean", "Total")
NUMBER_OF_ACCESSES = "Number of Accesses"
ACCESS_DATA = "Access Data"
GAPS = "gaps"
GAP_ELEMENTS = ("Start Time", "Stop Time", "Duration")
TIME = "Time"
MAX_CONTENT = 16                  # Data Provider ต่อ style (style ที่แก้มือจนใหญ่เกินจริงกินเวลาและหน่วยความจำตอนสร้างรายงาน)
MAX_STEP_S = 999_999_999          # step ของรายงานไม่เกินนี้ (9 หลักเท่ากับ /data) เกินนี้ timedelta ล้น: style ที่มี step เกินสร้างรายงานไม่ได้

_KEYS = {"name", "kind", "object_type", "content", "time", "summary", "graph", "dynamic", "derive", "ours"}
_REQUIRED = ("name", "kind", "object_type", "content")
_CONTENT_KEYS = {"provider", "group", "elements"}
_TIME_KEYS = {"mode", "step_s", "start", "stop"}
_SUMMARY_KEYS = {"per_object", "global_statistics", "summary_only"}
_GRAPH_KEYS = {"type", "y1", "y2", "stack"}


@dataclass
class Column:
    name: str                 # หัวคอลัมน์ (ElementInfo.header เช่น Access Number แสดงเป็น Access)
    unit: str | None
    kind: str                 # time, number, int


@dataclass
class Section:
    object: str
    title: str                # display_name(object) ตัวจัดรูปแบบเติม ":  <style>" เอง
    columns: list[Column]
    rows: list[list]
    summary: list[tuple[str, float | int | None]]
    summary_only: bool = False   # style.summary.summary_only: ไม่แสดงแถว (rows ว่าง) แสดงเฉพาะสถิติของ object


@dataclass
class Report:
    scenario: str
    style: str
    kind: str
    created: datetime
    sections: list[Section]
    global_statistics: list[tuple[str, float | int | None]]
    graph: dict | None
    dynamic: bool


# ---------- Installed Styles ----------

@lru_cache(maxsize=1)
def _installed() -> tuple[dict, ...]:
    return tuple(json.loads(INSTALLED_FILE.read_text(encoding="utf-8")))


def installed_styles() -> list[dict]:
    """Installed Styles ตามลำดับในไฟล์ (สำเนา แก้ได้โดยไม่กระทบตัวที่จำไว้)"""
    return copy.deepcopy(list(_installed()))


# ---------- ตรวจ style ----------

def _bad(field: str, text: str) -> StyleError:
    return StyleError(f"style ช่อง {field}: {text}", field)


def _check_keys(doc: dict, allowed: set[str], prefix: str) -> None:
    for key in doc:
        if key not in allowed:
            raise _bad(f"{prefix}{key}", f"ไม่รู้จักช่อง '{key}'")


def _check_bool(value, field: str) -> None:
    if not isinstance(value, bool):
        raise _bad(field, "ต้องเป็น true หรือ false")


def _check_content(content, object_type: str) -> dict[str, ElementInfo]:
    """ตรวจ content แล้วคืน element ที่ใช้ได้ทั้งหมด ชื่อ -> ElementInfo (ชื่อซ้ำข้าม provider ใช้ตัวแรก)"""
    if not isinstance(content, list) or not content:
        raise _bad("content", "ต้องมีอย่างน้อยหนึ่ง Data Provider")
    if len(content) > MAX_CONTENT:
        raise _bad("content", f"มี Data Provider ได้ไม่เกิน {MAX_CONTENT} รายการต่อ style (ได้ {len(content)})")
    available: dict[str, ElementInfo] = {}
    for i, entry in enumerate(content):
        at = f"content[{i}]"
        if not isinstance(entry, dict):
            raise _bad(at, "ต้องเป็น object {provider, group, elements}")
        _check_keys(entry, _CONTENT_KEYS, f"{at}.")
        info = PROVIDERS.get(entry.get("provider")) if isinstance(entry.get("provider"), str) else None
        if info is None:
            raise _bad(f"{at}.provider", f"ไม่มี Data Provider ชื่อ '{entry.get('provider')}' "
                                         f"(ที่มี: {', '.join(PROVIDERS)})")
        if info.object_type != object_type:
            raise _bad(f"{at}.provider", f"{info.name} ใช้กับ {info.object_type} ไม่ใช่ {object_type}")
        group = entry.get("group")
        if (info.groups is None and group is not None) or (info.groups is not None and group is not None
                                                            and group not in info.groups):
            choices = "ไม่มี group" if info.groups is None else f"group ที่มี: {', '.join(info.groups)}"
            raise _bad(f"{at}.group", f"{info.name} {choices} (ได้ '{group}')")
        elements = entry.get("elements")
        if not isinstance(elements, list) or not elements:
            raise _bad(f"{at}.elements", "ต้องมีอย่างน้อยหนึ่ง element")
        known = {e.name: e for e in info.elements}
        for j, name in enumerate(elements):
            if not isinstance(name, str) or name not in known:
                raise _bad(f"{at}.elements[{j}]", f"{info.name} ไม่มี element ชื่อ '{name}' "
                                                  f"(ที่มี: {', '.join(known)})")
            if name in elements[:j]:
                raise _bad(f"{at}.elements[{j}]", f"element '{name}' ซ้ำ")
            available.setdefault(name, known[name])
        if len(content) > 1 and TIME not in elements:
            raise _bad(f"{at}.elements", "content ที่มีหลาย Data Provider ต้องมี Time ทุกตัว (ใช้รวมแถวตามเวลา)")
    return available


def _numeric(available: dict[str, ElementInfo], name) -> bool:
    return isinstance(name, str) and name in available and available[name].kind != "time"


def _check_statistic(name, available: dict[str, ElementInfo], has_access: bool, field: str) -> None:
    if name == NUMBER_OF_ACCESSES:
        if not has_access:
            raise _bad(field, f"{NUMBER_OF_ACCESSES} ใช้ได้เมื่อ content มี {ACCESS_DATA}")
        return
    if isinstance(name, str):
        for function in STAT_FUNCTIONS:
            if name.startswith(function + " ") and _numeric(available, name[len(function) + 1:]):
                return
    raise _bad(field, f"สถิติ '{name}' ต้องเป็น '<Min|Max|Mean|Total|Std Deviation> <element ตัวเลขใน content>' "
                      f"หรือ '{NUMBER_OF_ACCESSES}'")


def _check_time(time) -> None:
    if not isinstance(time, dict):
        raise _bad("time", "ต้องเป็น object {mode, step_s}")
    _check_keys(time, _TIME_KEYS, "time.")
    mode = time.get("mode", "object_period")
    if mode not in TIME_MODES:
        raise _bad("time.mode", f"ต้องเป็น {' หรือ '.join(TIME_MODES)}")
    step = time.get("step_s")
    if step is not None and (isinstance(step, bool) or not isinstance(step, int) or step <= 0):
        raise _bad("time.step_s", "ต้องเป็น null (Use default time points) หรือจำนวนเต็มบวก")
    if step is not None and step > MAX_STEP_S:
        raise _bad("time.step_s", f"ต้องไม่เกิน {MAX_STEP_S} วินาที (ได้ {step}) เกินนี้สร้างรายงานไม่ได้")
    if mode != "specify":
        for key in ("start", "stop"):
            if key in time:
                raise _bad(f"time.{key}", "ใช้ได้เฉพาะ mode specify")
        return
    bounds = []
    for key in ("start", "stop"):
        try:
            t = datetime.fromisoformat(time.get(key))
        except (TypeError, ValueError):
            t = None
        if t is None or t.tzinfo is None:
            raise _bad(f"time.{key}", "ต้องเป็นเวลา ISO ที่ระบุเขตเวลา เช่น 2026-11-10T00:00:00Z")
        bounds.append(t.astimezone(timezone.utc))
    if bounds[0] >= bounds[1]:
        raise _bad("time.start", "เวลาเริ่มต้องอยู่ก่อนเวลาจบ")


def _check_graph(graph, available: dict[str, ElementInfo]) -> dict:
    if not isinstance(graph, dict):
        raise _bad("graph", "style กราฟต้องมี graph {type, y1, y2}")
    _check_keys(graph, _GRAPH_KEYS, "graph.")
    kind = graph.get("type")
    if kind not in GRAPH_TYPES:
        raise _bad("graph.type", f"ต้องเป็น {', '.join(GRAPH_TYPES)}")
    for axis in ("y1", "y2"):
        names = graph.get(axis, [])
        if not isinstance(names, list):
            raise _bad(f"graph.{axis}", "ต้องเป็นรายการชื่อ element")
        for j, name in enumerate(names):
            if not _numeric(available, name):
                raise _bad(f"graph.{axis}[{j}]", f"'{name}' ไม่ใช่ element ตัวเลขใน content")
    if "stack" in graph:
        _check_bool(graph["stack"], "graph.stack")
    needs = {"time_xy": (TIME,), "interval": ("Start Time", "Stop Time"), "polar90": ("Azimuth", "Elevation")}[kind]
    missing = [name for name in needs if name not in available]
    if missing:
        raise _bad("graph.type", f"กราฟ {kind} ต้องมี {', '.join(missing)} ใน content")
    if kind == "time_xy" and not graph.get("y1") and not graph.get("y2"):
        raise _bad("graph.y1", "กราฟ time_xy ต้องมี element บนแกน Y1 หรือ Y2 อย่างน้อยหนึ่งตัว")
    return graph


def check_style(style: dict) -> None:
    """ตรวจโครงของ style (Installed, My หรือ Scenario) ผิด: StyleError ที่ field ชี้ช่อง เช่น content[0].elements[2]"""
    if not isinstance(style, dict):
        raise _bad("style", "ต้องเป็น object JSON")
    _check_keys(style, _KEYS, "")
    for key in _REQUIRED:
        if key not in style:
            raise _bad(key, "ต้องมีช่องนี้")
    name = style["name"]
    if not isinstance(name, str) or not NAME_RE.fullmatch(name):
        raise _bad("name", "ชื่อต้องขึ้นต้นด้วยตัวอักษรหรือตัวเลข ตามด้วยตัวอักษร ตัวเลข ช่องว่าง _ หรือ - "
                           "ยาวไม่เกิน 48 ตัว")
    kind = style["kind"]
    if kind not in KINDS:
        raise _bad("kind", "ต้องเป็น report หรือ graph")
    if style["object_type"] not in OBJECT_TYPES:
        raise _bad("object_type", f"ต้องเป็น {', '.join(OBJECT_TYPES)}")
    content = style["content"]
    available = _check_content(content, style["object_type"])
    providers = [PROVIDERS[entry["provider"]] for entry in content]
    has_access = any(p.name == ACCESS_DATA for p in providers)

    if "time" in style:
        _check_time(style["time"])
    summary = style.get("summary", {})
    if not isinstance(summary, dict):
        raise _bad("summary", "ต้องเป็น object {per_object, global_statistics, summary_only}")
    _check_keys(summary, _SUMMARY_KEYS, "summary.")
    for key in ("per_object", "global_statistics"):
        names = summary.get(key, [])
        if not isinstance(names, list):
            raise _bad(f"summary.{key}", "ต้องเป็นรายการชื่อสถิติ")
        for j, stat in enumerate(names):
            _check_statistic(stat, available, has_access, f"summary.{key}[{j}]")
    summary_only = summary.get("summary_only", False)
    _check_bool(summary_only, "summary.summary_only")

    graph = style.get("graph")
    if kind == "report" and graph is not None:
        raise _bad("graph", "style รายงานต้องมี graph เป็น null")
    if kind == "graph":
        graph = _check_graph(graph, available)

    derive = style.get("derive")
    if derive not in (None, GAPS):
        raise _bad("derive", f"ต้องเป็น null หรือ {GAPS}")
    if derive == GAPS and (kind != "report" or [p.name for p in providers] != [ACCESS_DATA]
                           or not set(content[0]["elements"]) <= set(GAP_ELEMENTS)):
        raise _bad("derive", f"{GAPS} ใช้กับ style รายงานที่มีแต่ {ACCESS_DATA}: {', '.join(GAP_ELEMENTS)}")

    dynamic = style.get("dynamic", False)
    _check_bool(dynamic, "dynamic")
    if dynamic:
        static = [p.name for p in providers if "Dynamic Displays" not in p.uses]
        if static:
            raise _bad("dynamic", f"{', '.join(static)} ใช้กับ Dynamic Display ไม่ได้")
        if derive is not None or summary_only or (graph is not None and graph["type"] != "time_xy"):
            raise _bad("dynamic", "Dynamic Display/Strip Chart ใช้ได้กับรายงานตามเวลาและกราฟ time_xy เท่านั้น")
    _check_bool(style.get("ours", False), "ours")


# ---------- หา style ----------

def resolve_style(name: str, kind: str | None, my: list[dict], scenario: list[dict]) -> dict:
    """หา style ตามชื่อแบบไม่สนตัวพิมพ์ใน Scenario Styles → My Styles → Installed Styles (คืนสำเนา)
    kind None: ถ้าชั้นเดียวกันมีทั้งสองชนิด (Installed Access) เลือก report ก่อน graph
    ไม่พบ: StyleError(field="style")"""
    if kind not in (None, *KINDS):
        raise _bad("kind", "ต้องเป็น report หรือ graph")
    wanted = name.casefold() if isinstance(name, str) else None
    for tier in (scenario, my, list(_installed())):
        matches = [s for s in tier if isinstance(s, dict) and isinstance(s.get("name"), str)
                   and s["name"].casefold() == wanted and (kind is None or s.get("kind") == kind)]
        if matches:
            matches.sort(key=lambda s: s.get("kind") != "report")
            return copy.deepcopy(matches[0])
    what = f"style ชื่อ '{name}'" + (f" ชนิด {kind}" if kind else "")
    raise StyleError(f"ไม่พบ {what} ใน Scenario Styles, My Styles หรือ Installed Styles", "style")


# ---------- ประกอบรายงาน ----------

def _columns(style: dict) -> tuple[list[Column], list[str]]:
    """คอลัมน์ของรายงานและชื่อ element ของแต่ละคอลัมน์ (ใช้หาสถิติ) ตามลำดับเดียวกับค่าในแถว"""
    columns, names = [], []
    if style.get("derive") == GAPS:
        columns.append(Column("Gap", None, "int"))
        names.append("Gap")
    for i, entry in enumerate(style["content"]):
        infos = {e.name: e for e in PROVIDERS[entry["provider"]].elements}
        for name in entry["elements"]:
            if i > 0 and name == TIME:
                continue
            info = infos[name]
            columns.append(Column(info.header, info.unit, info.kind))
            names.append(name)
    return columns, names


def _gaps(rs: ResultSet, obj: str, access: list[dict], start: datetime, stop: datetime) -> list[dict]:
    """ช่วงว่างระหว่าง access ใน [start, stop] ∩ ช่วงวิเคราะห์ (ขอบปัดมิลลิวินาทีแบบเดียวกับ Access Data)
    ดาวที่ไม่ได้ propagate ไม่มีข้อมูล จึงไม่มีช่วงว่าง"""
    sc = rs.scenario
    lo = _to_millisecond(max(start.astimezone(timezone.utc), sc.start))
    hi = _to_millisecond(min(stop.astimezone(timezone.utc), sc.stop))
    if lo >= hi or rs.prn_of(parse_object(obj)[2]) is None:
        return []
    pieces, cursor = [], lo
    for row in access:
        if row["Start Time"] > cursor:
            pieces.append((cursor, row["Start Time"]))
        cursor = max(cursor, row["Stop Time"])
    if cursor < hi:
        pieces.append((cursor, hi))
    return [{"Start Time": a, "Stop Time": b, "Duration": round((b - a).total_seconds(), 3) + 0.0}
            for a, b in pieces]


def _object_rows(rs: ResultSet, style: dict, obj: str, start: datetime, stop: datetime,
                 step_s: int | None) -> tuple[list[list], int | None]:
    """แถวของ object หนึ่งตัวตามคอลัมน์ของ _columns และจำนวนช่วง access (None ถ้า content ไม่มี Access Data)"""
    content = style["content"]
    if style.get("derive") == GAPS:
        access = provider_rows(rs, obj, ACCESS_DATA, None, ["Start Time", "Stop Time"], start, stop, step_s)
        gaps = _gaps(rs, obj, access, start, stop)
        elements = content[0]["elements"]
        return [[k, *(gap[e] for e in elements)] for k, gap in enumerate(gaps, start=1)], len(access)
    if len(content) == 1:
        entry = content[0]
        rows = provider_rows(rs, obj, entry["provider"], entry.get("group"), entry["elements"], start, stop, step_s)
        return [list(row.values()) for row in rows], len(rows) if entry["provider"] == ACCESS_DATA else None
    # หลาย provider: รวมตามเวลา ช่องที่ provider ไม่มีค่าที่เวลานั้นเป็น None
    tables = [{row[TIME]: row for row in provider_rows(rs, obj, entry["provider"], entry.get("group"),
                                                       entry["elements"], start, stop, step_s)}
              for entry in content]
    layout = [(i, name) for i, entry in enumerate(content) for name in entry["elements"]
              if not (i > 0 and name == TIME)]
    times = sorted(set().union(*tables))
    return [[t if name == TIME else tables[i].get(t, {}).get(name) for i, name in layout] for t in times], None


def _statistic(name: str, rows: list[list], names: list[str], accesses: int | None) -> float | int | None:
    if name == NUMBER_OF_ACCESSES:
        return accesses or 0
    function = next(f for f in STAT_FUNCTIONS if name.startswith(f + " "))
    index = names.index(name[len(function) + 1:])
    values = [row[index] for row in rows if row[index] is not None]
    if not values:
        return None
    if function == "Min":
        return min(values)
    if function == "Max":
        return max(values)
    total = sum(values) if all(isinstance(v, int) for v in values) else math.fsum(values)
    if function == "Total":
        return total
    mean = total / len(values)
    if function == "Mean":
        return mean
    return math.sqrt(math.fsum((v - mean) ** 2 for v in values) / len(values))       # Std Deviation แบบประชากร


def _window(rs: ResultSet, obj: str, start: datetime | None, stop: datetime | None) -> tuple[datetime, datetime]:
    if start is None and stop is None:
        return object_period(rs, obj)
    if stop is None:
        raise ScenarioError("Specify Time Period ต้องมีทั้งเวลาเริ่มและเวลาจบ (ไม่มีเวลาจบ)", "time.stop")
    if start is None:
        raise ScenarioError("Specify Time Period ต้องมีทั้งเวลาเริ่มและเวลาจบ (ไม่มีเวลาเริ่ม)", "time.start")
    return start, stop


def build_report(rs: ResultSet, style: dict, objects: list[str], start: datetime | None, stop: datetime | None,
                 step_s: int | None, now: datetime) -> Report:
    """ประกอบรายงานของ style สำหรับ objects ตามลำดับที่ส่งมา (หนึ่ง Section ต่อ object)

    start/stop เป็น None ทั้งคู่ = Use Object Time Period (ช่วงวิเคราะห์) step_s None = Use default time points
    การตัดตาม time_period ที่เก็บไว้ของ access เป็นหน้าที่ของ server (ส่ง start/stop มาเอง)
    style ผิด: StyleError; objects ว่าง / ชนิดไม่ตรง style / เวลาผิด: ScenarioError; ไม่มีผล: ResultsNotCurrentError
    """
    check_style(style)
    if not isinstance(objects, list) or not objects:
        raise ScenarioError("ต้องเลือก object อย่างน้อยหนึ่งตัว", "objects")
    for obj in objects:
        kind = parse_object(obj)[0]
        if kind != style["object_type"]:
            raise ScenarioError(f"style {style['name']} ใช้กับ {style['object_type']} แต่ object {obj} เป็น {kind}",
                                "object")
    summary = style.get("summary", {})
    per_object, global_names = summary.get("per_object", []), summary.get("global_statistics", [])
    columns, names = _columns(style)

    sections, all_rows, all_accesses = [], [], 0
    for obj in objects:
        lo, hi = _window(rs, obj, start, stop)
        rows, accesses = _object_rows(rs, style, obj, lo, hi, step_s)
        all_rows.extend(rows)
        all_accesses += accesses or 0
        sections.append(Section(
            object=obj, title=display_name(obj), columns=list(columns),
            rows=[] if summary.get("summary_only", False) else rows,
            summary=[(stat, _statistic(stat, rows, names, accesses)) for stat in per_object],
            summary_only=summary.get("summary_only", False)))
    global_statistics = ([(stat, _statistic(stat, all_rows, names, all_accesses)) for stat in global_names]
                         if len(objects) > 1 else [])
    return Report(scenario=rs.scenario.name, style=style["name"], kind=style["kind"], created=now,
                  sections=sections, global_statistics=global_statistics,
                  graph=copy.deepcopy(style.get("graph")), dynamic=style.get("dynamic", False))
