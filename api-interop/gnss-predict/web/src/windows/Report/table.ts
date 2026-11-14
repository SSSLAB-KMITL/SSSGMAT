// แถวที่หน้าต่างรายงานแสดง (spec §6.1) จาก JSON ของ POST /reports: ฟังก์ชันล้วน ไม่ใช้ React
//
// - แต่ละ object เป็นหนึ่งส่วน: แถวหัวส่วน (ชื่อ object เช่น THBK-To-G01) แล้วตามแบบไฟล์ .txt ของ engine (report_format.format_txt)
//     ส่วนที่ summary_only (style แบบ Summary Only) ไม่มีตาราง มีแต่สถิติของ object (ไม่มีสถิติ = No Data)
//     ส่วนอื่นมีหัวคอลัมน์เสมอ ไม่มีแถวเลย = แถว No Data แล้วตามด้วยสถิติของ object (ถ้ามี)
// - ท้ายตารางเป็นบล็อก Global Statistics (มีเมื่อ engine ส่งมา คือเมื่อมีหลาย object) section ของแถวในบล็อกนี้เป็น -1
// - ค่า: ทศนิยมตาม DECIMALS (P9) ของชื่อ element, จำนวนเต็มไม่มีทศนิยม, ไม่มีค่า = N/A, -0.000 แสดงเป็น 0.000
//   เวลาตาม DateFormat ของ scenario (formatTime ตัวเดียวกับทั้งแอป) หัวคอลัมน์เวลามีหน่วยเป็น UTCG หรือ LTZG±hh:mm
//   ค่าสถิติ "<Min|Max|Mean|Total|Std Deviation> <element>" ใช้ทศนิยมของ element นั้น (Min/Max/Total ของคอลัมน์จำนวนเต็มไม่มีทศนิยม เหมือน engine)
// - Dynamic Display (dynamicRows): แถวเดียวต่อส่วน ณ เวลาที่ส่งมา ค่าจาก valueAt ของ data/dynamic.ts ช่องเวลาแสดงเวลานั้นเอง
//   (valueAt ให้ null ที่คอลัมน์เวลา) เวลานอกข้อมูลหรือในช่องว่าง = No Data ไม่มีสถิติ (สถิติเป็นของทั้งช่วง ไม่ใช่ของเวลาปัจจุบัน)
// - reportRowsOf(panelId): เซลล์ที่หน้าต่างแสดงอยู่ทั้งหมด (ไม่ขึ้นกับการเลื่อน) ให้ test hook reportRows ของ e2e

import { valueAt, type Interp } from "../../data/dynamic";
import { decimalsOf, type ElementInfo, type ReportColumn, type ReportJson, type ReportSection, type ReportStatistic } from "../../data/reports";
import { t } from "../../labels/labels";
import { formatTime, parseOffset, type DateFormat } from "../../time/format";

export type FlatKind = "row" | "title" | "header" | "summary" | "global" | "nodata";

export interface FlatRow {
  cells: string[];
  /** ดัชนีส่วน (object) ใน report.sections; บล็อก Global Statistics = -1 */
  section: number;
  kind: FlatKind;
  /** แถวข้อมูล: ดัชนีใน section.rows (ไว้อ่านค่าเวลาจริงของช่องตอน Set Animation Time) Dynamic Display = ไม่มี */
  row?: number;
  /** Dynamic Display: เวลา (ms) ของแถวที่แสดง */
  at?: number;
}

/** ป้ายหน่วยเวลาในหัวคอลัมน์: UTCG หรือ LTZG±hh:mm (offset ที่อ่านไม่ได้แสดงเป็น UTCG แบบเดียวกับ formatTime) */
export function timeUnit(fmt: DateFormat, ltz: string): string {
  return fmt === "LTZG" && parseOffset(ltz) !== null ? `LTZG${ltz}` : "UTCG";
}

export function headerText(column: ReportColumn, unit: string): string {
  if (column.kind === "time") return `${column.name} (${unit})`;
  return column.unit ? `${column.name} (${column.unit})` : column.name;
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** ทศนิยม d ตำแหน่ง ค่าที่ปัดแล้วเป็นศูนย์ติดลบแสดงเป็นศูนย์ (engine: round(v, d) + 0.0) */
export function fixed(v: number, d: number): string {
  const s = v.toFixed(d);
  return /^-0(\.0*)?$/.test(s) ? s.slice(1) : s;
}

const integer = (v: number): string => String(Math.round(v) || 0);

/** ตัวแปลงค่าเป็นข้อความของคอลัมน์ (ค่าที่ไม่มีได้ N/A) */
export function cellText(column: ReportColumn, fmt: DateFormat, ltz: string): (v: unknown) => string {
  const na = t("report.notAvailable");
  if (column.kind === "time") {
    return (v) => {
      const ms = typeof v === "string" ? Date.parse(v) : Number.NaN;
      return Number.isFinite(ms) ? formatTime(new Date(ms), fmt, ltz) : na;
    };
  }
  if (column.kind === "int") return (v) => (finite(v) ? integer(v) : na);
  const d = decimalsOf(column.name);
  return (v) => (finite(v) ? fixed(v, d) : na);
}

const STAT_FUNCTIONS = ["Std Deviation", "Min", "Max", "Mean", "Total"] as const;
/** สถิติของคอลัมน์จำนวนเต็มที่ engine คืนเป็นจำนวนเต็ม (min/max/sum ของ int) ส่วน Mean และ Std Deviation เป็นทศนิยมเสมอ */
const KEEPS_INT = new Set(["Min", "Max", "Total"]);

/** ข้อความของค่าสถิติ (ชื่อ, ค่า) ตามกติกาเดียวกับ engine _statistic_text */
export function statisticText(stat: ReportStatistic, columns: readonly ReportColumn[]): string {
  const v = stat.value;
  if (!finite(v)) return t("report.notAvailable");
  const fn = STAT_FUNCTIONS.find((f) => stat.name.startsWith(`${f} `));
  if (fn === undefined) return Number.isInteger(v) ? String(v) : fixed(v, decimalsOf(stat.name)); // Number of Accesses
  const element = stat.name.slice(fn.length + 1);
  const column = columns.find((c) => c.name === element);
  if (column?.kind === "int" && KEEPS_INT.has(fn)) return integer(v);
  return fixed(v, decimalsOf(element));
}

function sectionHead(section: ReportSection, index: number, unit: string, out: FlatRow[]): boolean {
  out.push({ cells: [section.title], section: index, kind: "title" });
  if (section.summary_only) {
    if (section.summary.length === 0) out.push({ cells: [t("report.noData")], section: index, kind: "nodata" });
    for (const s of section.summary) out.push({ cells: [s.name, statisticText(s, section.columns)], section: index, kind: "summary" });
    return false;
  }
  out.push({ cells: section.columns.map((c) => headerText(c, unit)), section: index, kind: "header" });
  return true;
}

/** ทุกแถวของรายงาน (Report/Graph) ตามลำดับที่แสดง */
export function flattenRows(report: ReportJson, fmt: DateFormat, ltz: string): FlatRow[] {
  const unit = timeUnit(fmt, ltz);
  const out: FlatRow[] = [];
  report.sections.forEach((section, index) => {
    if (!sectionHead(section, index, unit, out)) return;
    const texts = section.columns.map((c) => cellText(c, fmt, ltz));
    if (section.rows.length === 0) out.push({ cells: [t("report.noData")], section: index, kind: "nodata" });
    section.rows.forEach((row, r) => {
      out.push({ cells: texts.map((text, c) => text(row[c])), section: index, kind: "row", row: r });
    });
    for (const s of section.summary) out.push({ cells: [s.name, statisticText(s, section.columns)], section: index, kind: "summary" });
  });
  if (report.global_statistics.length > 0) {
    const columns = report.sections[0]?.columns ?? [];
    out.push({ cells: [t("report.globalStatistics")], section: -1, kind: "title" });
    for (const s of report.global_statistics) out.push({ cells: [s.name, statisticText(s, columns)], section: -1, kind: "global" });
  }
  return out;
}

// ---------- Dynamic Display ----------

/** ส่วนหนึ่งที่เตรียมไว้ถามค่าทุกเฟรม: เวลา (ms) ของแต่ละแถวและวิธีประมาณค่าของแต่ละคอลัมน์ */
export interface DynamicSection {
  times: number[];
  interps: Interp[];
  /** คอลัมน์เวลาแรก (คอลัมน์ Time) ไม่มี = -1 */
  timeColumn: number;
}

/**
 * วิธีประมาณค่าของแต่ละคอลัมน์จาก element ของ /dataproviders (ชื่อตรงกับชื่อคอลัมน์) ไม่พบ = ตามชนิดคอลัมน์
 * (จำนวนเต็ม = จุดก่อนหน้า, ตัวเลข = เชิงเส้น, เวลา = ไม่ประมาณ)
 */
export function interpsFor(columns: readonly ReportColumn[], elements: readonly ElementInfo[]): Interp[] {
  const byName = new Map(elements.map((e) => [e.name, e.interp] as const));
  return columns.map((c) => byName.get(c.name) ?? (c.kind === "int" ? "previous" : c.kind === "number" ? "linear" : "none"));
}

export function prepareDynamic(report: ReportJson, elements: readonly ElementInfo[]): DynamicSection[] {
  return report.sections.map((section) => {
    const timeColumn = section.columns.findIndex((c) => c.kind === "time");
    const times = section.rows.map((row) => {
      const v = timeColumn < 0 ? null : row[timeColumn];
      return typeof v === "string" ? Date.parse(v) : Number.NaN;
    });
    return { times, interps: interpsFor(section.columns, elements), timeColumn };
  });
}

/** แถวของ Dynamic Display ที่เวลา at (ms) maxGapMs = max(step ของคำขอ, step ของ scenario) × 1.5 */
export function dynamicRows(report: ReportJson, prepared: readonly DynamicSection[], at: number, maxGapMs: number, fmt: DateFormat, ltz: string): FlatRow[] {
  const unit = timeUnit(fmt, ltz);
  const out: FlatRow[] = [];
  report.sections.forEach((section, index) => {
    const prep = prepared[index];
    if (prep === undefined || !sectionHead(section, index, unit, out)) return;
    const values = valueAt(section.rows, prep.times, at, prep.interps, maxGapMs);
    if (values === null) {
      out.push({ cells: [t("report.noData")], section: index, kind: "nodata" });
      return;
    }
    const cells = section.columns.map((c, i) => (i === prep.timeColumn ? formatTime(new Date(at), fmt, ltz) : cellText(c, fmt, ltz)(values[i])));
    out.push({ cells, section: index, kind: "row", at });
  });
  return out;
}

// ---------- ทะเบียนให้ test hook ----------

const shown = new Map<string, () => FlatRow[]>();

/** หน้าต่างรายงานลงทะเบียนตัวอ่านแถวที่แสดงอยู่ คืนฟังก์ชันถอน (ถอนเฉพาะเมื่อยังเป็นตัวเดิม) */
export function registerShownRows(panelId: string, read: () => FlatRow[]): () => void {
  shown.set(panelId, read);
  return () => {
    if (shown.get(panelId) === read) shown.delete(panelId);
  };
}

/** เซลล์ที่หน้าต่างรายงาน panelId แสดงอยู่ทั้งหมด ไม่มีหน้าต่างนั้น = [] */
export function reportRowsOf(panelId: string): string[][] {
  return shown.get(panelId)?.().map((r) => [...r.cells]) ?? [];
}
