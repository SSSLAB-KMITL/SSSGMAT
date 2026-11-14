"""ตัวจัดรูปแบบรายงาน (หัวข้อ 3.5 ของ spec งานย่อยที่ 4): .txt แบบรายงาน STK, .csv และ JSON ที่ server ส่งหน้าเว็บ

- เวลา: `format_time` ตรงกับ `formatTime` ของหน้าเว็บ (`1 Jan 2026 16:00:00.000 UTCG`, `12 Nov 2026 14:00:00.000
  LTZG+07:00`) ตัดเศษต่ำกว่ามิลลิวินาทีทิ้ง (Date ของ JS เก็บได้แค่มิลลิวินาที) LTZG ที่ offset เพี้ยนแสดงเป็น UTCG
  เหมือนหน้าเว็บ หัวคอลัมน์เวลามีหน่วยเป็น `time_unit` เช่น `Start Time (UTCG)`
- ค่า (P9): ทศนิยมตามชื่อ element (`DECIMALS`, ตั้งต้น 3) จำนวนเต็มไม่มีทศนิยม ไม่มีค่า (None หรือไม่ใช่จำนวนจำกัด)
  = `N/A` ใน .txt, ช่องว่างใน .csv, `null` ใน JSON ค่า -0.000 แสดงเป็น 0.000
- .txt: บรรทัดแรก `<scenario>    <เวลาสร้าง UTCG เสมอ>` แล้วแต่ละ object เป็นส่วน
  `<ชื่อ>:  <style>` / บรรทัดว่าง / หัวคอลัมน์ / ขีด `-` / แถว คอลัมน์คั่น 4 ช่องว่างและกว้างคงที่ต่อส่วน (ทุกบรรทัด
  ของส่วนยาวเท่ากัน) ตัวเลขชิดขวา เวลาชิดซ้าย ไม่มีแถวเลย = `No Data` ท้ายรายงานมี `Global Statistics`
- ส่วนที่ไม่มีแถวแต่มีสถิติของ object (style แบบ Summary Only เช่น AccessSummary) พิมพ์เฉพาะสถิติ ไม่มีตาราง
  (Report ไม่มีธง summary_only: ส่วนที่ไม่มีทั้งแถวและสถิติคือ `No Data`)
- .csv: ไม่มีบล็อก Global Statistics หลาย object คั่นด้วยบรรทัดว่าง ส่วนที่เป็นสถิติล้วนเขียนเป็นแถว `ชื่อ,ค่า`
  Export Setup: Field Delimiter, Enclose Header Fields in Quotes, Write Report Title, Headers
- JSON: ค่าจริงไม่ปัดเศษ เวลาเป็น ISO มิลลิวินาที ลงท้าย Z (หน้าเว็บจัดรูปแบบเองตาม `DECIMALS`)
"""

import csv
import io
import math
import re
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from .errors import ScenarioError
from .report_style import STAT_FUNCTIONS, Column, Report, Section

UTC = timezone.utc
DATE_FORMATS = ("UTCG", "LTZG")
DEFAULT_LTZ_OFFSET = "+07:00"                          # ตรงกับ units.ltz_offset ตั้งต้นของ scenario
MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
COLUMN_GAP = " " * 4                                   # P9
NO_DATA = "No Data"
NOT_AVAILABLE = "N/A"
GLOBAL_STATISTICS = "Global Statistics"
SCENARIO_GAP = " " * 4
DEFAULT_DECIMALS = 3
# P9: ที่เหลือ (มุม ระยะ Duration DOP Lat Lon Alt ค่าสถิติของมัน) 3 ตำแหน่ง
DECIMALS = {"IPP Lat": 4, "IPP Lon": 4, "MF": 5, "Lat Rate": 6, "Lon Rate": 6, "Alt Rate": 6}

_OFFSET = re.compile(r"([+-])(\d{2}):(\d{2})")
_UNSAFE_NAME = re.compile(r"[^A-Za-z0-9._-]")
Text = Callable[[object], str]


# ---------- เวลา ----------

def _offset_minutes(text) -> int | None:
    """`±hh:mm` → นาทีทางตะวันออกของ UTC (hh 00–23, mm 00–59) ไม่ถูกรูปแบบ → None (กฎเดียวกับ parseOffset ในเว็บ)"""
    m = _OFFSET.fullmatch(text) if isinstance(text, str) else None
    if m is None or int(m[2]) > 23 or int(m[3]) > 59:
        return None
    return (-1 if m[1] == "-" else 1) * (int(m[2]) * 60 + int(m[3]))


def _utc(t: datetime) -> datetime:
    if t.tzinfo is None:
        raise ValueError(f"เวลา {t!r} ไม่ระบุเขตเวลา (ต้องเป็นเวลา UTC)")
    return t if t.tzinfo is UTC else t.astimezone(UTC)


def _time_text(date_format: str, ltz_offset: str) -> tuple[Callable[[datetime], str], str]:
    """(ฟังก์ชันจัดรูปแบบเวลา, ป้ายหน่วย) สร้างครั้งเดียวต่อรายงาน เพราะเรียกต่อเซลล์"""
    if date_format not in DATE_FORMATS:
        raise ValueError(f"date_format ต้องเป็น {' หรือ '.join(DATE_FORMATS)} ได้ {date_format!r}")
    minutes = _offset_minutes(ltz_offset) if date_format == "LTZG" else None
    shift = timedelta(minutes=minutes or 0)
    label = "UTCG" if minutes is None else f"LTZG{ltz_offset}"

    def text(t: datetime) -> str:
        t = _utc(t) + shift
        return (f"{t.day} {MONTHS[t.month - 1]} {t.year:04d} {t.hour:02d}:{t.minute:02d}:{t.second:02d}."
                f"{t.microsecond // 1000:03d} {label}")
    return text, label


def format_time(t: datetime, date_format: str, ltz_offset: str) -> str:
    """`1 Jan 2026 16:00:00.000 UTCG` หรือ `12 Nov 2026 14:00:00.000 LTZG+07:00` (ตรงกับ formatTime ของหน้าเว็บ)
    t ต้องระบุเขตเวลา date_format ที่ไม่ใช่ UTCG/LTZG: ValueError"""
    return _time_text(date_format, ltz_offset)[0](t)


def time_unit(date_format: str, ltz_offset: str) -> str:
    """ป้ายหน่วยเวลาในหัวคอลัมน์: `UTCG` หรือ `LTZG+07:00`"""
    return _time_text(date_format, ltz_offset)[1]


def _iso_ms(t: datetime) -> str:
    t = _utc(t)
    return (f"{t.year:04d}-{t.month:02d}-{t.day:02d}T{t.hour:02d}:{t.minute:02d}:{t.second:02d}."
            f"{t.microsecond // 1000:03d}Z")


def time_format_of(doc: dict) -> tuple[str, str]:
    """(date_format, ltz_offset) จาก `units` ของ scenario.json (ไม่มี = UTCG, +07:00) ผิดรูป: ScenarioError"""
    units = doc.get("units") if isinstance(doc, dict) else None
    if units is None:
        return "UTCG", DEFAULT_LTZ_OFFSET
    if not isinstance(units, dict):
        raise ScenarioError("scenario.json ช่อง units: ต้องเป็น object", "units")
    date_format = units.get("date_format", "UTCG")
    if date_format not in DATE_FORMATS:
        raise ScenarioError(f"scenario.json ช่อง units.date_format: ต้องเป็น {' หรือ '.join(DATE_FORMATS)}",
                            "units.date_format")
    offset = units.get("ltz_offset", DEFAULT_LTZ_OFFSET)
    if _offset_minutes(offset) is None:
        raise ScenarioError("scenario.json ช่อง units.ltz_offset: ต้องเป็น ±hh:mm เช่น +07:00", "units.ltz_offset")
    return date_format, offset


# ---------- ค่าในเซลล์ ----------

def _finite(value) -> bool:
    return value is not None and not (isinstance(value, float) and not math.isfinite(value))


def _decimals(element: str) -> int:
    return DECIMALS.get(element, DEFAULT_DECIMALS)


def _fixed(value, decimals: int) -> str:
    return f"{round(value, decimals) + 0.0:.{decimals}f}"           # + 0.0: -0.0 ที่ปัดแล้วต้องไม่แสดงเป็น -0.000


def _int(value) -> str:
    return str(value) if isinstance(value, int) else str(round(value))


def _cell_texts(columns: list[Column], time_text: Callable[[datetime], str]) -> list[Text]:
    """ตัวแปลงค่าเป็นข้อความของแต่ละคอลัมน์ (ค่าที่ไม่มีจัดการก่อนเรียก)"""
    out: list[Text] = []
    for column in columns:
        if column.kind == "time":
            out.append(time_text)
        elif column.kind == "int":
            out.append(_int)
        else:
            decimals = _decimals(column.name)
            out.append(lambda v, d=decimals: _fixed(v, d))
    return out


def _header(column: Column, unit_label: str) -> str:
    if column.kind == "time":
        return f"{column.name} ({unit_label})"
    return f"{column.name} ({column.unit})" if column.unit else column.name


def _statistic_text(name: str, value) -> str | None:
    """ข้อความของค่าสถิติ ไม่มีค่า = None ค่าตามทศนิยมของ element ที่ชื่อสถิติอ้าง จำนวนเต็มไม่มีทศนิยม"""
    if not _finite(value):
        return None
    if isinstance(value, int):
        return str(value)
    element = next((name[len(f) + 1:] for f in STAT_FUNCTIONS if name.startswith(f + " ")), name)
    return _fixed(value, _decimals(element))


def _statistics(stats: list[tuple[str, object]], missing: str) -> list[tuple[str, str]]:
    return [(name, missing if (text := _statistic_text(name, value)) is None else text) for name, value in stats]


def _is_statistics_only(section: Section) -> bool:
    """ส่วนแบบ Summary Only: ไม่มีแถวแต่มีสถิติของ object"""
    return not section.rows and bool(section.summary)


# ---------- .txt ----------

def _statistic_lines(stats: list[tuple[str, object]]) -> list[str]:
    pairs = _statistics(stats, NOT_AVAILABLE)
    name_width = max(len(name) for name, _ in pairs)
    value_width = max(len(value) for _, value in pairs)
    return [f"{name.ljust(name_width)}{COLUMN_GAP}{value.rjust(value_width)}" for name, value in pairs]


def _table_lines(section: Section, time_text: Callable[[datetime], str], unit_label: str) -> list[str]:
    columns = section.columns
    texts = _cell_texts(columns, time_text)
    rows = [[NOT_AVAILABLE if not _finite(v) else text(v) for text, v in zip(texts, row, strict=True)]
            for row in section.rows]
    headers = [_header(c, unit_label) for c in columns]
    widths = [max([len(h)] + [len(row[i]) for row in rows]) for i, h in enumerate(headers)]
    left = [c.kind == "time" for c in columns]

    def line(cells: list[str]) -> str:
        return COLUMN_GAP.join(c.ljust(w) if l else c.rjust(w) for c, w, l in zip(cells, widths, left, strict=True))

    lines = [line(headers), COLUMN_GAP.join("-" * w for w in widths)]
    lines += [line(row) for row in rows] if rows else [NO_DATA]
    return lines


def format_txt(report: Report, date_format: str, ltz_offset: str) -> str:
    """รายงานแบบ STK (ไฟล์ .txt) บรรทัดแรกใช้เวลาสร้างเป็น UTCG เสมอ ส่วนในตารางใช้ DateFormat ของ scenario"""
    time_text, unit_label = _time_text(date_format, ltz_offset)
    created = _time_text("UTCG", DEFAULT_LTZ_OFFSET)[0](report.created)
    blocks = [[f"{report.scenario}{SCENARIO_GAP}{created}"]]
    for section in report.sections:
        block = [f"{section.title}:  {report.style}", ""]
        if _is_statistics_only(section):
            block += _statistic_lines(section.summary)
        else:
            block += _table_lines(section, time_text, unit_label)
            if section.summary:
                block += ["", *_statistic_lines(section.summary)]
        blocks.append(block)
    if report.global_statistics:
        blocks.append([GLOBAL_STATISTICS, "-" * len(GLOBAL_STATISTICS), *_statistic_lines(report.global_statistics)])
    lines: list[str] = []
    for i, block in enumerate(blocks):
        lines += ([""] if i else []) + block
    return "\n".join(lines) + "\n"


# ---------- .csv ----------

@dataclass(frozen=True)
class ExportSetup:
    """Export Setup ของ STK: Field Delimiter, Enclose Header Fields in Quotes, Write Report Title, Headers"""
    delimiter: str = ","
    quote_headers: bool = False
    title: bool = False
    headers: bool = True

    def __post_init__(self):
        if not isinstance(self.delimiter, str) or len(self.delimiter) != 1 or self.delimiter in '"\r\n':
            raise ScenarioError("Field Delimiter ต้องเป็นอักขระเดียวที่ไม่ใช่ \" หรือการขึ้นบรรทัดใหม่",
                                "export.delimiter")


def format_csv(report: Report, date_format: str, ltz_offset: str, setup: ExportSetup = ExportSetup()) -> str:
    """รายงานเป็น .csv ไม่มีบล็อก Global Statistics หลาย object คั่นด้วยบรรทัดว่าง
    ค่าที่ไม่มี = ช่องว่าง ฟิลด์ข้อมูลที่มีตัวคั่นอยู่ในตัวถูกใส่เครื่องหมายคำพูดเอง"""
    time_text, unit_label = _time_text(date_format, ltz_offset)
    out = io.StringIO()
    plain = csv.writer(out, delimiter=setup.delimiter, lineterminator="\n")
    quoted = csv.writer(out, delimiter=setup.delimiter, lineterminator="\n", quoting=csv.QUOTE_ALL)
    for i, section in enumerate(report.sections):
        if i:
            out.write("\n")
        if setup.title:
            plain.writerow([f"{section.title}:  {report.style}"])
        if _is_statistics_only(section):
            plain.writerows(_statistics(section.summary, ""))
            continue
        if setup.headers:
            (quoted if setup.quote_headers else plain).writerow([_header(c, unit_label) for c in section.columns])
        texts = _cell_texts(section.columns, time_text)
        plain.writerows([text(v) if _finite(v) else "" for text, v in zip(texts, row, strict=True)]
                        for row in section.rows)
    return out.getvalue()


# ---------- JSON และชื่อไฟล์ ----------

def _json_value(value):
    if isinstance(value, datetime):
        return _iso_ms(value)
    return value if _finite(value) else None


def report_json(report: Report) -> dict:
    """รายงานเป็น dict สำหรับ JSON (server/เว็บ) ค่าจริงไม่ปัดเศษ เวลาเป็น ISO มิลลิวินาทีลงท้าย Z ไม่มีค่า = None"""
    def stats(pairs):
        return [{"name": name, "value": _json_value(value)} for name, value in pairs]

    sections = []
    for section in report.sections:
        sections.append({
            "object": section.object,
            "title": section.title,
            "columns": [{"name": c.name, "unit": c.unit, "kind": c.kind} for c in section.columns],
            "rows": [[_json_value(v) for v in row] for row in section.rows],
            "summary": stats(section.summary),
        })
    return {"scenario": report.scenario, "style": report.style, "kind": report.kind,
            "created_utc": _iso_ms(report.created), "sections": sections,
            "global_statistics": stats(report.global_statistics), "graph": report.graph, "dynamic": report.dynamic}


def report_filename(report: Report, ext: str) -> str:
    """`THBK-To-G01_Access.txt` (หนึ่ง object) หรือ `Access.txt` (หลาย object) ช่องว่างและอักขระแปลกเป็น `_`"""
    style = _UNSAFE_NAME.sub("_", report.style)
    stem = f"{_UNSAFE_NAME.sub('_', report.sections[0].title)}_{style}" if len(report.sections) == 1 else style
    return f"{stem}.{ext.lstrip('.')}"
