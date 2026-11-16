// option ของ ECharts สำหรับหน้าต่างกราฟ (spec §6.2): ฟังก์ชันล้วนจาก JSON ของ POST /reports ไม่ import echarts (โหลดผ่าน chart.ts เท่านั้น)
//
// - ชนิดกราฟตาม style.graph.type (spec §3.3):
//     time_xy  เส้นตามเวลา y1 แกนซ้าย y2 แกนขวา หนึ่งเส้นต่อ (object, element) ชื่อ "THBK-To-G01 Azimuth" สีตาม object element ต่างกันแยกด้วยรูปเส้น
//              graph.stack (N Asset Coverage) = พื้นที่ซ้อนกัน (stack "total") แบบขั้นบันได สีตามระบบ (theme token ของ GPS/GLONASS/Galileo/BeiDou)
//              คอลัมน์จำนวนเต็ม (จำนวนดวง) วาดแบบขั้นบันได (ค่าคงที่จนถึงจุดถัดไป แบบเดียวกับ Dynamic Display)
//     interval แถบช่วง access หนึ่งแถวต่อ object (custom series ข้อมูล [ดัชนี object, start ms, stop ms])
//     polar90  Az El Polar: มุม = Azimuth (0° ด้านบน ตามเข็มนาฬิกา) รัศมี = Elevation (90° อยู่กลาง ขอบนอก = 0°) ข้อมูล [El, Az]
// - เส้นขาด (ค่า null คั่น): ช่องว่างระหว่างแถวยาวเกิน maxGapMs (ระหว่าง access, ข้อมูลขาด), ค่าที่ไม่มี และมุมที่วน (Azimuth 359.5 → 0.5,
//   Lon 179 → -179) ซึ่งถ้าลากต่อจะเป็นเส้นแนวตั้งทั้งกราฟ (Review Focus 1) maxGapMs ที่ผู้เรียกไม่ส่ง = 1.5 × ระยะสั้นที่สุดระหว่างแถวของข้อมูล
//   จุดคั่นของช่องว่างคิดจากเวลาของ section ครั้งเดียว (ทุก element ได้ตำแหน่งเดียวกัน) series ที่ซ้อนกันจึงเรียงดัชนีตรงกัน
// - sampling: "lttb" เฉพาะเส้นต่อเนื่อง series ที่ซ้อนหรือเป็นขั้นบันได (จำนวนนับ) ไม่สุ่ม (LTTB เลือกจุดแยกต่อ series ทำให้ขอบแถบไม่ตรงกัน)
// - เส้นเวลา animation: time_xy และ interval เป็นเส้นแนวตั้ง (markLine ของ series "timeLine") เฉพาะเมื่อเวลาอยู่ในช่วงของแกน
//   polar90 เป็นจุดตำแหน่งปัจจุบัน (series "current" ค่าจาก valueAt: Azimuth ประมาณตามวง) นอก access = ไม่มีจุด; showTimeLine false = ไม่มีทั้งสองแบบ
// - Strip Chart (stripMs): แกนเวลาแสดง [now - stripMs, now] เลื่อนตามนาฬิกา ไม่งั้นแกนครอบข้อมูลทั้งหมด
// - graphTimeOption / graphCrosshairOption = เฉพาะส่วนที่เปลี่ยนตามเวลาหรือปุ่มสลับ (id เดียวกับใน graphOption) ให้หน้าต่าง setOption แบบ merge
//   ไม่ส่งข้อมูลทั้งชุดซ้ำ และไม่ล้างการซูมของผู้ใช้
// - แกนเวลาและ tooltip ใช้ DateFormat ของ scenario (formatTime) สีพื้น ตัวอักษร เส้นตาราง จาก theme.css (--graph-*) ผ่าน readGraphTheme
// - ข้อความใน tooltip เป็น HTML: ชื่อ object/element มาจากข้อมูล จึง escape ก่อนเสมอ

import { effectiveColor, objectPath, readCssVar, systemTokenOf, themeTokens, type ColorTokens } from "../../cesium/colors";
import { valueAt, type Interp } from "../../data/dynamic";
import { decimalsOf, type GraphType, type ReportJson, type ReportSection } from "../../data/reports";
import type { ScenarioDoc } from "../../stores/scenario";
import { formatTime, type DateFormat } from "../../time/format";
import type { DrawnState } from "./drawnState";

/** Strip Chart Duration ตั้งต้น (spec §6.2) */
export const STRIP_CHART_DURATION_S = 3600;

// ---------- ธีม ----------

export interface GraphTheme {
  bg: string;
  text: string;
  muted: string;
  grid: string;
  axis: string;
  /** เส้นเวลา animation */
  now: string;
  systems: Pick<ColorTokens, "gps" | "glonass" | "galileo" | "beidou">;
}

/** ค่าเดียวกับ theme.css (--graph-*, --color-*) ใช้เมื่ออ่านตัวแปร CSS ไม่ได้ (jsdom, ก่อนโหลด CSS) */
export const DEFAULT_GRAPH_THEME: Readonly<GraphTheme> = Object.freeze({
  bg: "#1c222c", text: "#e6eaf0", muted: "#aeb8c6", grid: "#ffffff26", axis: "#8a94a3", now: "#ff8a5c",
  systems: Object.freeze({ gps: "#ffd23f", glonass: "#ff6b6b", galileo: "#4fd47e", beidou: "#45c8ff" }),
});

const THEME_VARS = { bg: "--graph-bg", text: "--graph-text", muted: "--graph-text-muted", grid: "--graph-grid", axis: "--graph-axis", now: "--graph-now" } as const;

/** สีของกราฟจากตัวแปร CSS (อ่านตอนเรียก) ตัวที่ไม่มีใช้ค่าตั้งต้น */
export function readGraphTheme(): GraphTheme {
  const out = { ...DEFAULT_GRAPH_THEME, systems: { ...DEFAULT_GRAPH_THEME.systems } };
  for (const [k, name] of Object.entries(THEME_VARS) as [keyof typeof THEME_VARS, string][]) out[k] = readCssVar(name) || DEFAULT_GRAPH_THEME[k];
  const tokens = themeTokens();
  for (const k of ["gps", "glonass", "galileo", "beidou"] as const) if (tokens[k] !== "#ffffff") out.systems[k] = tokens[k];
  return out;
}

// ---------- สีของ object ----------

/**
 * สีของเส้นตาม object ของรายงาน (spec §6.2) ด้วย effectiveColor ตัวเดียวกับหน้าต่าง 3D/2D/Timeline:
 * คู่ access (P1) = สีของดาวปลายทาง, Facility/Satellite = สีของตัวเอง, หาไม่พบ = สีของดาวที่ไม่รู้ระบบ
 */
export function objectColorOf(doc: ScenarioDoc | null, prnByNorad: ReadonlyMap<number, string>, tokens: ColorTokens = themeTokens()): (object: string) => string {
  return (object) => {
    const parts = object.split(" ");
    const target = parts.find((p) => p.startsWith("*/Satellite/")) ?? parts[0];
    const obj = doc?.objects.find((o) => objectPath(o) === target);
    return obj === undefined || doc === null ? tokens.other : effectiveColor(obj, doc, { prnByNorad, tokens });
  };
}

/**
 * กุญแจของทุกอย่างที่ objectColorOf ใช้ (ชนิด ชื่อ NORAD สีและ inherit ของ graphics2d สี/ระบบ/สมาชิกของ Constellation และ NORAD → PRN)
 * หน้าต่างสร้างตัวหาสีใหม่ (และวาดกราฟใหม่) เมื่อกุญแจเปลี่ยนเท่านั้น การแก้ส่วนอื่นของ scenario จึงไม่ล้างการซูม
 */
export function colorKeyOf(doc: ScenarioDoc | null, prnByNorad: ReadonlyMap<number, string>): string {
  if (doc === null) return "null";
  const objects = doc.objects.map((o) => {
    const x = o as { norad?: unknown; graphics2d?: { inherit?: unknown; color?: unknown } | null; color?: unknown; system?: unknown; assigned_objects?: unknown };
    return [o.class, o.name, x.norad ?? null, x.graphics2d?.inherit ?? null, x.graphics2d?.color ?? null, x.color ?? null, x.system ?? null, x.assigned_objects ?? null];
  });
  return JSON.stringify([objects, [...prnByNorad].sort((a, b) => a[0] - b[0])]);
}

// ---------- ข้อมูล ----------

export interface GraphCtx {
  dateFormat: DateFormat;
  ltz: string;
  colorOf(object: string): string;
  /** เวลา animation (ms) null = ไม่มีเส้นเวลา */
  now: number | null;
  showTimeLine: boolean;
  /** Strip Chart: ความยาวช่วงย้อนหลัง (ms) null = แสดงทั้งช่วง */
  stripMs: number | null;
  /** ช่องว่างระหว่างแถวที่ยาวกว่านี้ = เส้นขาด (ผู้เรียกส่ง max(step ของคำขอ, step ของ scenario) × 1.5) ไม่ส่ง = 1.5 × step ของข้อมูล */
  maxGapMs?: number;
  /** Crosshair Cursor */
  crosshair?: boolean;
  theme?: GraphTheme;
}

export interface GraphState {
  type: GraphType;
  series: string[];
  timeLine: number | null;
  /** polar90: [El, Az] ของจุดปัจจุบันตัวแรก */
  currentPoint: [number, number] | null;
  /** สิ่งที่ ECharts วาดอยู่จริง (drawnState.ts) ใส่โดยหน้าต่างกราฟ ไม่มี instance = null */
  drawn?: DrawnState | null;
}

type Option = Record<string, unknown>;
type Point = [number, number | null];

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const num = (v: unknown): number | null => (finite(v) ? v : null);

/** มุมที่วนรอบ: กระโดดเกิน 180° ระหว่างสองแถวติดกัน = ข้ามจุดวน (ไม่ใช่การเปลี่ยนจริง) */
const WRAPPING = new Set(["Azimuth", "Lon", "IPP Lon"]);
/** รูปเส้นของ element ลำดับต่าง ๆ ของ object เดียวกัน (สีเดียวกันตาม object) */
const LINE_TYPES: (string | number[])[] = ["solid", "dashed", "dotted", [8, 3, 2, 3], [12, 4], [2, 6]];

const timesCache = new WeakMap<ReportSection, number[]>();

/** เวลา (ms) ของทุกแถวจากคอลัมน์เวลาแรก (จำไว้ต่อ section: หน้าต่างถามซ้ำทุกครั้งที่เวลาเดิน) อ่านไม่ได้ = NaN */
function timesOf(section: ReportSection): number[] {
  let times = timesCache.get(section);
  if (times === undefined) {
    const col = section.columns.findIndex((c) => c.kind === "time");
    times = section.rows.map((row) => {
      const v = col < 0 ? null : row[col];
      return typeof v === "string" ? Date.parse(v) : Number.NaN;
    });
    timesCache.set(section, times);
  }
  return times;
}

function maxGapOf(times: readonly number[], ctx: GraphCtx): number {
  if (ctx.maxGapMs !== undefined) return ctx.maxGapMs;
  let step = Number.POSITIVE_INFINITY;
  for (let i = 1; i < times.length; i++) {
    const d = times[i] - times[i - 1];
    if (d > 0 && d < step) step = d;
  }
  return step * 1.5;
}

/**
 * จุดคั่นของช่องว่างระหว่างแถว (ขึ้นกับเวลาอย่างเดียว ไม่ขึ้นกับค่าของ element): breaks[i] = เวลากลางระหว่างแถวก่อนหน้ากับแถว i
 * เมื่อห่างกันเกิน maxGapMs ไม่งั้น NaN ทุก series ของ section ได้จุดคั่นตำแหน่งเดียวกัน ข้อมูลจึงเรียงดัชนีตรงกัน (การซ้อนของ ECharts ซ้อนตามดัชนี)
 */
function gapBreaks(times: readonly number[], maxGapMs: number): number[] {
  const out = new Array<number>(times.length).fill(Number.NaN);
  let pt = Number.NaN;
  times.forEach((t, i) => {
    if (!Number.isFinite(t)) return;
    if (Number.isFinite(pt) && !(t - pt <= maxGapMs)) out[i] = (pt + t) / 2; // maxGapMs ที่เป็น NaN = ขาด (ไม่ลากข้าม)
    pt = t;
  });
  return out;
}

/** [ms, ค่า] ของคอลัมน์ col พร้อมจุด null คั่นตรงช่องว่าง (breaks ของ section) และจุดวนของมุม (เฉพาะ element ที่วน ซึ่งไม่ถูกซ้อน) */
function lineData(section: ReportSection, col: number, breaks: readonly number[], wraps: boolean): Point[] {
  const times = timesOf(section);
  const out: Point[] = [];
  let pt = Number.NaN;
  let pv: number | null = null;
  section.rows.forEach((row, i) => {
    const t = times[i];
    if (!Number.isFinite(t)) return;
    const v = num(row[col]);
    if (out.length > 0) {
      if (Number.isFinite(breaks[i])) out.push([breaks[i], null]);
      else if (wraps && v !== null && pv !== null && Math.abs(v - pv) > 180) out.push([(pt + t) / 2, null]);
    }
    out.push([t, v]);
    pt = t;
    pv = v;
  });
  return out;
}

export const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** ป้ายแกนเวลา: วันที่บรรทัดแรก เวลา (ไม่มีมิลลิวินาที) กับ UTCG/LTZG บรรทัดที่สอง ตาม DateFormat ของ scenario */
export function timeAxisLabel(ms: number, fmt: DateFormat, ltz: string): string {
  const s = formatTime(new Date(ms), fmt, ltz);
  const m = /^(\S+ \S+ \S+) (\d\d:\d\d:\d\d)\.\d{3} (.+)$/.exec(s);
  return m === null ? s : `${m[1]}\n${m[2]} ${m[3]}`;
}

function valueText(v: unknown, element: string, int: boolean): string {
  if (!finite(v)) return "N/A";
  return int ? String(Math.round(v)) : v.toFixed(decimalsOf(element));
}

// ---------- ส่วนร่วมของแกนเวลา ----------

const extentCache = new WeakMap<ReportJson, [number, number] | null>();

/** ช่วงของแกนเวลา: Strip Chart = [now - stripMs, now] ไม่งั้นครอบข้อมูล (จำไว้ต่อรายงาน: ถามทุกครั้งที่เวลาเดิน) ไม่มีข้อมูล = null (ECharts กำหนดเอง) */
function timeExtent(report: ReportJson, ctx: GraphCtx): [number, number] | null {
  if (ctx.stripMs !== null && ctx.now !== null) return [ctx.now - ctx.stripMs, ctx.now];
  if (!extentCache.has(report)) extentCache.set(report, dataExtent(report));
  return extentCache.get(report) ?? null;
}

function dataExtent(report: ReportJson): [number, number] | null {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  const see = (t: number): void => {
    if (!Number.isFinite(t)) return;
    if (t < lo) lo = t;
    if (t > hi) hi = t;
  };
  if (report.graph?.type === "interval") {
    for (const s of report.sections) for (const [, a, b] of intervalRows(s)) (see(a), see(b));
  } else {
    for (const s of report.sections) for (const t of timesOf(s)) see(t);
  }
  return lo <= hi ? [lo, hi] : null;
}

function timeLineAt(report: ReportJson, ctx: GraphCtx): number | null {
  if (!ctx.showTimeLine || ctx.now === null) return null;
  const extent = timeExtent(report, ctx);
  return extent !== null && ctx.now >= extent[0] && ctx.now <= extent[1] ? ctx.now : null;
}

function timeLineSeries(report: ReportJson, ctx: GraphCtx, theme: GraphTheme): Option {
  const at = timeLineAt(report, ctx);
  return {
    id: "timeLine", type: "line", data: [], silent: true,
    markLine: {
      silent: true, symbol: ["none", "none"], animation: false, label: { show: false },
      lineStyle: { color: theme.now, width: 1.5, type: "solid" },
      data: at === null ? [] : [{ xAxis: at }],
    },
  };
}

function timeAxisPart(report: ReportJson, ctx: GraphCtx): Option {
  const extent = timeExtent(report, ctx);
  return { id: "time", min: extent?.[0], max: extent?.[1] };
}

function timeAxis(report: ReportJson, ctx: GraphCtx, theme: GraphTheme): Option {
  return {
    ...timeAxisPart(report, ctx),
    type: "time",
    axisLabel: { color: theme.text, hideOverlap: true, formatter: (v: number) => timeAxisLabel(v, ctx.dateFormat, ctx.ltz) },
    axisLine: { lineStyle: { color: theme.axis } },
    axisTick: { lineStyle: { color: theme.axis } },
    splitLine: { show: true, lineStyle: { color: theme.grid } },
    axisPointer: { label: { formatter: (p: { value: number }) => formatTime(new Date(p.value), ctx.dateFormat, ctx.ltz) } },
  };
}

function base(theme: GraphTheme, ctx: GraphCtx, legend: string[]): Option {
  return {
    animation: false,
    backgroundColor: theme.bg,
    textStyle: { color: theme.text },
    legend: { type: "scroll", top: 4, data: legend, textStyle: { color: theme.text }, pageTextStyle: { color: theme.text }, inactiveColor: theme.muted },
    tooltip: {
      confine: true,
      axisPointer: { type: ctx.crosshair === true ? "cross" : "line", lineStyle: { color: theme.muted }, crossStyle: { color: theme.muted } },
    },
  };
}

// ---------- time_xy ----------

interface XySeries {
  option: Option;
  element: string;
  int: boolean;
}

function xySeries(report: ReportJson, ctx: GraphCtx, theme: GraphTheme): XySeries[] {
  const graph = report.graph!;
  const stack = graph.stack === true;
  const elements: [string, number][] = [...graph.y1.map((n) => [n, 0] as [string, number]), ...graph.y2.map((n) => [n, 1] as [string, number])];
  const out: XySeries[] = [];
  report.sections.forEach((section, si) => {
    const times = timesOf(section);
    const breaks = gapBreaks(times, maxGapOf(times, ctx));
    const color = ctx.colorOf(section.object);
    const stackName = report.sections.length === 1 ? "total" : `total ${section.title}`;
    elements.forEach(([element, axis], ei) => {
      const col = section.columns.findIndex((c) => c.name === element && c.kind !== "time");
      if (col < 0) return;
      const int = section.columns[col].kind === "int";
      const system = stack ? systemTokenOf(element) : null;
      const lineColor = system === null ? color : theme.systems[system];
      out.push({
        element, int,
        option: {
          id: `s${si}:${element}`, name: `${section.title} ${element}`, type: "line", yAxisIndex: axis,
          data: lineData(section, col, breaks, WRAPPING.has(element)),
          color: lineColor, showSymbol: false, connectNulls: false,
          // LTTB เลือกจุดของแต่ละ series แยกกัน: series ที่ซ้อนกันหรือเป็นขั้นบันได (จำนวนนับ) จะได้ขอบไม่ตรงกันและขั้นเลื่อนไปทั้งช่วง bucket
          sampling: stack || int ? "none" : "lttb",
          lineStyle: { width: 1.5, color: lineColor, type: stack ? "solid" : LINE_TYPES[ei % LINE_TYPES.length] },
          emphasis: { focus: "series" },
          ...(stack ? { stack: stackName, step: "end", areaStyle: { opacity: 0.55 } } : int ? { step: "end" } : {}),
        },
      });
    });
  });
  return out;
}

function unitsOf(report: ReportJson, names: readonly string[]): string {
  const units = new Set<string>();
  for (const s of report.sections) for (const c of s.columns) if (names.includes(c.name) && c.unit) units.add(c.unit);
  return [...units].join(", ");
}

function timeXyOption(report: ReportJson, ctx: GraphCtx, theme: GraphTheme): Option {
  const graph = report.graph!;
  const series = xySeries(report, ctx, theme);
  const byName = new Map(series.map((s) => [s.option.name as string, s]));
  const intOnly = (names: readonly string[]): boolean =>
    names.length > 0 && report.sections.every((s) => s.columns.filter((c) => names.includes(c.name)).every((c) => c.kind === "int"));
  const valueAxis = (names: readonly string[], position: "left" | "right"): Option => ({
    type: "value", name: unitsOf(report, names), position, scale: graph.stack !== true,
    ...(graph.stack === true || intOnly(names) ? { minInterval: 1 } : {}),
    nameTextStyle: { color: theme.text }, axisLabel: { color: theme.text },
    axisLine: { show: true, lineStyle: { color: theme.axis } },
    splitLine: { show: position === "left", lineStyle: { color: theme.grid } },
  });
  const yAxis = [valueAxis(graph.y1, "left")];
  if (graph.y2.length > 0) yAxis.push(valueAxis(graph.y2, "right"));
  const opt = base(theme, ctx, series.map((s) => s.option.name as string));
  return {
    ...opt,
    grid: { left: 64, right: graph.y2.length > 0 ? 72 : 32, top: 48, bottom: 60 },
    tooltip: {
      ...(opt.tooltip as Option), trigger: "axis",
      formatter: (params: { seriesName?: string; value?: unknown; color?: string }[]) => {
        const list = (Array.isArray(params) ? params : [params]).filter((p) => byName.has(p.seriesName ?? ""));
        const t = Array.isArray(list[0]?.value) ? (list[0].value as unknown[])[0] : null;
        const lines = finite(t) ? [escapeHtml(formatTime(new Date(t), ctx.dateFormat, ctx.ltz))] : [];
        for (const p of list) {
          const s = byName.get(p.seriesName ?? "")!;
          const v = Array.isArray(p.value) ? p.value[1] : null;
          lines.push(`<span style="color:${escapeHtml(p.color ?? "")}">●</span> ${escapeHtml(p.seriesName ?? "")}: ${valueText(v, s.element, s.int)}`);
        }
        return lines.join("<br/>");
      },
    },
    xAxis: timeAxis(report, ctx, theme),
    yAxis,
    dataZoom: [{ type: "inside", xAxisIndex: 0, filterMode: "none" }],
    series: [...series.map((s) => s.option), timeLineSeries(report, ctx, theme)],
  };
}

// ---------- interval ----------

/** [ดัชนี (ใส่ทีหลัง), start ms, stop ms] ของทุกช่วงใน section: คอลัมน์ Start Time/Stop Time ไม่พบ = คอลัมน์เวลาที่หนึ่งและสอง */
function intervalRows(section: ReportSection): [number, number, number][] {
  const times = section.columns.map((c, i) => [c, i] as const).filter(([c]) => c.kind === "time");
  const startCol = times.find(([c]) => c.name === "Start Time")?.[1] ?? times[0]?.[1];
  const stopCol = times.find(([c]) => c.name === "Stop Time")?.[1] ?? times[1]?.[1];
  if (startCol === undefined || stopCol === undefined) return [];
  const out: [number, number, number][] = [];
  for (const row of section.rows) {
    const a = typeof row[startCol] === "string" ? Date.parse(row[startCol] as string) : Number.NaN;
    const b = typeof row[stopCol] === "string" ? Date.parse(row[stopCol] as string) : Number.NaN;
    if (Number.isFinite(a) && Number.isFinite(b)) out.push([0, a, b]);
  }
  return out;
}

interface RenderApi {
  value(dim: number): number;
  coord(value: [number, number]): number[];
  size(value: [number, number]): number[];
}

function intervalOption(report: ReportJson, ctx: GraphCtx, theme: GraphTheme): Option {
  const titles = report.sections.map((s) => s.title);
  const colors = report.sections.map((s) => ctx.colorOf(s.object));
  const data: [number, number, number][] = [];
  report.sections.forEach((s, si) => {
    for (const [, a, b] of intervalRows(s)) data.push([si, a, b]);
  });
  const fmt = (ms: number): string => escapeHtml(formatTime(new Date(ms), ctx.dateFormat, ctx.ltz));
  const opt = base(theme, ctx, []);
  return {
    ...opt,
    legend: { show: false },
    grid: { left: 120, right: 32, top: 24, bottom: 60 },
    tooltip: {
      ...(opt.tooltip as Option), trigger: "item",
      formatter: (p: { value?: unknown }) => {
        const v = p.value as number[] | undefined;
        if (!Array.isArray(v)) return "";
        return `${escapeHtml(titles[v[0]] ?? "")}<br/>${fmt(v[1])} – ${fmt(v[2])}`;
      },
    },
    xAxis: { ...timeAxis(report, ctx, theme), axisPointer: { show: ctx.crosshair === true, label: { formatter: (p: { value: number }) => fmt(p.value) } } },
    yAxis: {
      id: "objects", type: "category", data: titles, inverse: true,
      axisLabel: { color: theme.text }, axisLine: { lineStyle: { color: theme.axis } },
      splitLine: { show: true, lineStyle: { color: theme.grid } },
      axisPointer: { show: ctx.crosshair === true },
    },
    dataZoom: [{ type: "inside", xAxisIndex: 0, filterMode: "none" }],
    series: [
      {
        id: "intervals", type: "custom", name: "intervals", data, encode: { x: [1, 2], y: 0 },
        renderItem: (params: { coordSys: { x: number; y: number; width: number; height: number } }, api: RenderApi) => {
          const cat = api.value(0);
          const start = api.coord([api.value(1), cat]);
          const stop = api.coord([api.value(2), cat]);
          const height = api.size([0, 1])[1] * 0.6;
          const cs = params.coordSys;
          const x0 = Math.max(start[0], cs.x);
          const x1 = Math.min(stop[0], cs.x + cs.width);
          if (!(x1 > x0)) return null;
          return {
            type: "rect",
            shape: { x: x0, y: start[1] - height / 2, width: Math.max(1, x1 - x0), height },
            style: { fill: colors[cat] ?? theme.muted },
          };
        },
      },
      timeLineSeries(report, ctx, theme),
    ],
  };
}

// ---------- polar90 ----------

/** [El, Az] ของทุกแถวใน section (มุมเงยนอก 0–90° วาดบน Az El Polar ไม่ได้ ข้าม) */
function polarPoints(section: ReportSection): [number, number][] {
  const az = section.columns.findIndex((c) => c.name === "Azimuth");
  const el = section.columns.findIndex((c) => c.name === "Elevation");
  if (az < 0 || el < 0) return [];
  const out: [number, number][] = [];
  for (const row of section.rows) {
    const a = num(row[az]);
    const e = num(row[el]);
    if (a !== null && e !== null && e >= 0 && e <= 90) out.push([e, a]);
  }
  return out;
}

/** วิธีประมาณค่าของจุดปัจจุบัน: Azimuth ตามวง 360° (359 → 1 ผ่าน 0) ตัวเลขอื่นเชิงเส้น */
const polarInterps = (section: ReportSection): Interp[] =>
  section.columns.map((c) => (c.name === "Azimuth" ? "angle" : c.kind === "number" ? "linear" : c.kind === "int" ? "previous" : "none"));

interface CurrentPoint {
  value: [number, number];
  color: string;
}

function currentPoints(report: ReportJson, ctx: GraphCtx): CurrentPoint[] {
  if (!ctx.showTimeLine || ctx.now === null) return [];
  const out: CurrentPoint[] = [];
  for (const section of report.sections) {
    const az = section.columns.findIndex((c) => c.name === "Azimuth");
    const el = section.columns.findIndex((c) => c.name === "Elevation");
    if (az < 0 || el < 0) continue;
    const times = timesOf(section);
    const v = valueAt(section.rows, times, ctx.now, polarInterps(section), maxGapOf(times, ctx));
    const a = v?.[az] ?? null;
    const e = v?.[el] ?? null;
    if (a !== null && e !== null) out.push({ value: [e, a], color: ctx.colorOf(section.object) });
  }
  return out;
}

function currentSeries(report: ReportJson, ctx: GraphCtx, theme: GraphTheme): Option {
  return {
    id: "current", type: "scatter", coordinateSystem: "polar", symbolSize: 11, z: 10, silent: true,
    itemStyle: { borderColor: theme.text, borderWidth: 1.5 },
    data: currentPoints(report, ctx).map((p) => ({ value: p.value, itemStyle: { color: p.color } })),
  };
}

function polarOption(report: ReportJson, ctx: GraphCtx, theme: GraphTheme): Option {
  const series = report.sections.map((section, si) => {
    const color = ctx.colorOf(section.object);
    return {
      id: `s${si}`, name: section.title, type: "scatter", coordinateSystem: "polar", data: polarPoints(section),
      large: true, symbolSize: 3, color, itemStyle: { color },
    };
  });
  const deg = (v: number): string => `${v}°`;
  const opt = base(theme, ctx, series.map((s) => s.name));
  return {
    ...opt,
    tooltip: {
      ...(opt.tooltip as Option), trigger: "item",
      formatter: (p: { seriesName?: string; value?: unknown }) => {
        const v = p.value as number[] | undefined;
        if (!Array.isArray(v)) return "";
        return `${escapeHtml(p.seriesName ?? "")}<br/>Azimuth: ${v[1].toFixed(decimalsOf("Azimuth"))} deg<br/>Elevation: ${v[0].toFixed(decimalsOf("Elevation"))} deg`;
      },
    },
    polar: { center: ["50%", "54%"], radius: "74%" },
    angleAxis: {
      type: "value", min: 0, max: 360, interval: 30, startAngle: 90, clockwise: true,
      axisLabel: { color: theme.text, formatter: deg }, axisLine: { lineStyle: { color: theme.axis } },
      splitLine: { show: true, lineStyle: { color: theme.grid } }, axisTick: { lineStyle: { color: theme.axis } },
    },
    radiusAxis: {
      type: "value", min: 0, max: 90, interval: 30, inverse: true,
      axisLabel: { color: theme.muted, formatter: deg }, axisLine: { lineStyle: { color: theme.axis } },
      splitLine: { show: true, lineStyle: { color: theme.grid } },
    },
    series: [...series, currentSeries(report, ctx, theme)],
  };
}

// ---------- ทางเข้า ----------

/** option เต็มของกราฟ (setOption แบบ notMerge) style ที่ไม่มี graph = null */
export function graphOption(report: ReportJson, ctx: GraphCtx): Option | null {
  const theme = ctx.theme ?? DEFAULT_GRAPH_THEME;
  switch (report.graph?.type) {
    case "time_xy": return timeXyOption(report, ctx, theme);
    case "interval": return intervalOption(report, ctx, theme);
    case "polar90": return polarOption(report, ctx, theme);
    default: return null;
  }
}

/** เฉพาะส่วนที่เปลี่ยนตามเวลา animation (setOption แบบ merge ด้วย id เดียวกับ graphOption) */
export function graphTimeOption(report: ReportJson, ctx: GraphCtx): Option | null {
  const theme = ctx.theme ?? DEFAULT_GRAPH_THEME;
  switch (report.graph?.type) {
    case "time_xy":
    case "interval":
      return { ...(ctx.stripMs !== null ? { xAxis: timeAxisPart(report, ctx) } : {}), series: [timeLineSeries(report, ctx, theme)] };
    case "polar90":
      return { series: [currentSeries(report, ctx, theme)] };
    default:
      return null;
  }
}

/** เฉพาะ Crosshair Cursor (setOption แบบ merge: ไม่ล้างการซูมของผู้ใช้) */
export function graphCrosshairOption(report: ReportJson, ctx: GraphCtx): Option | null {
  const type = report.graph?.type;
  if (type === undefined) return null;
  const on = ctx.crosshair === true;
  const tooltip = { axisPointer: { type: on ? "cross" : "line" } };
  if (type !== "interval") return { tooltip };
  return { tooltip, xAxis: { id: "time", axisPointer: { show: on } }, yAxis: { id: "objects", axisPointer: { show: on } } };
}

/** สิ่งที่กราฟแสดงอยู่ (test hook graphState) */
export function graphState(report: ReportJson, ctx: GraphCtx): GraphState | null {
  const type = report.graph?.type;
  if (type === undefined) return null;
  if (type === "interval") return { type, series: report.sections.map((s) => s.title), timeLine: timeLineAt(report, ctx), currentPoint: null };
  if (type === "polar90") {
    return { type, series: report.sections.map((s) => s.title), timeLine: null, currentPoint: currentPoints(report, ctx)[0]?.value ?? null };
  }
  const theme = ctx.theme ?? DEFAULT_GRAPH_THEME;
  return { type, series: xySeries(report, ctx, theme).map((s) => s.option.name as string), timeLine: timeLineAt(report, ctx), currentPoint: null };
}

// ---------- ทะเบียนให้ test hook ----------

const shown = new Map<string, () => GraphState | null>();

/** หน้าต่างกราฟลงทะเบียนตัวอ่านสถานะ คืนฟังก์ชันถอน (ถอนเฉพาะเมื่อยังเป็นตัวเดิม) */
export function registerGraphState(panelId: string, read: () => GraphState | null): () => void {
  shown.set(panelId, read);
  return () => {
    if (shown.get(panelId) === read) shown.delete(panelId);
  };
}

/** สถานะของหน้าต่างกราฟ panelId ไม่มีหน้าต่างหรือยังไม่มีกราฟ = null */
export function graphStateOf(panelId: string): GraphState | null {
  return shown.get(panelId)?.() ?? null;
}
