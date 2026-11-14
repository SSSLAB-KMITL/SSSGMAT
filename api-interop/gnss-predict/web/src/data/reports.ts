// ชั้นข้อมูลของรายงานและกราฟ (spec §5, §6): POST /scenarios/{sc}/reports, GET /styles, PUT/DELETE /styles/{name},
// GET /scenarios/{sc}/dataproviders และชื่อของ object/หน้าต่าง
// - ค่าใน JSON ของรายงานไม่ปัดเศษ (engine report_json) หน้าเว็บจัดทศนิยมเองตาม DECIMALS (P9) ซึ่งต้องตรงกับ report_format.DECIMALS
//   (reports-data.test.ts เทียบกับไฟล์ของ engine)
// - provider ที่ไม่มี group (Access Data, N Asset Coverage, IPP Data) ใช้ group null ใน style
// - ไม่ import echarts (กราฟโหลดผ่าน windows/Graph/chart.ts เท่านั้น)

import { apiGet, apiSend, apiSendText, type ApiOptions } from "../api/client";
import type { components } from "../api/types.gen";
import { t } from "../labels/labels";
import { msg } from "../labels/messages.th";
import { report } from "../stores/messages";

type Schemas = components["schemas"];

// ---------- รายงาน ----------

export type ReportColumn = Schemas["ColumnOut"];
export type ReportStatistic = Schemas["StatisticOut"];
/** ส่วนของหนึ่ง object: summary_only = แสดงเฉพาะสถิติของ object (ไม่มีตาราง) แบบเดียวกับ .txt */
export type ReportSection = Schemas["SectionOut"];

export type GraphType = "time_xy" | "interval" | "polar90";

/** กราฟของ style (spec §3.3) polar90: Elevation เป็นรัศมี Azimuth เป็นมุม; stack = ซ้อนตามระบบ (N Asset Coverage) */
export interface GraphDef {
  type: GraphType;
  y1: string[];
  y2: string[];
  stack?: boolean;
}

/** คำตอบ JSON ของ POST /reports (engine report_format.report_json) */
export type ReportJson = Omit<Schemas["ReportOut"], "graph"> & { graph: GraphDef | null };

/** body ของ POST /reports ไม่รวม format (fetchReport ส่ง json, downloadReport ส่ง txt/csv) */
export type ReportRequest = Omit<Schemas["ReportBody"], "format">;

/** Export Setup ของ .csv (ตรงกับ ExportSetup ของ engine) */
export interface ExportSetup {
  delimiter: string;
  quote_headers: boolean;
  title: boolean;
  headers: boolean;
}

/** ค่าตั้งต้น P9: `,` / ไม่ใส่คำพูด / ไม่เขียนชื่อรายงาน / มีหัวคอลัมน์ */
export const DEFAULT_EXPORT_SETUP: Readonly<ExportSetup> = Object.freeze({ delimiter: ",", quote_headers: false, title: false, headers: true });

const reportsPath = (sc: string): string => `/scenarios/${encodeURIComponent(sc)}/reports`;

export async function fetchReport(sc: string, req: ReportRequest, signal?: AbortSignal): Promise<ReportJson> {
  const { data } = await apiSend<ReportJson>("POST", reportsPath(sc), { ...req, format: "json" }, null, { signal });
  return data;
}

/** เวลาที่ถือ object URL ของไฟล์ที่ดาวน์โหลดไว้ก่อนคืน */
export const REVOKE_DELAY_MS = 30_000;

const MIME = { txt: "text/plain;charset=utf-8", csv: "text/csv;charset=utf-8" } as const;

/** ชื่อไฟล์จาก Content-Disposition (filename* แบบ RFC 5987 ก่อน แล้ว filename) ตัดส่วน path ทิ้ง ไม่มี = null */
function fileNameOf(disposition: string | null): string | null {
  if (disposition === null) return null;
  let name: string | null = null;
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(disposition);
  if (star !== null) {
    try {
      name = decodeURIComponent(star[1].trim());
    } catch {
      name = null;
    }
  }
  if (name === null) {
    const plain = /filename\s*=\s*(?:"([^"]*)"|([^;]+))/.exec(disposition);
    name = plain === null ? null : (plain[1] ?? plain[2]).trim();
  }
  const safe = name?.replace(/[/\\]/g, "_").trim() ?? "";
  return safe === "" ? null : safe;
}

/** ชื่อไฟล์เมื่อ server ไม่ส่ง Content-Disposition: ชื่อ style แบบเดียวกับ report_filename ของหลาย object */
const fallbackName = (style: string, format: string): string => `${style.replace(/[^A-Za-z0-9._-]/g, "_")}.${format}`;

/**
 * สร้างรายงานเป็นไฟล์ .txt/.csv แล้วให้เบราว์เซอร์ดาวน์โหลด (Blob + <a download>) ชื่อไฟล์ตาม Content-Disposition ของ server
 * setup = Export Setup (ส่งเป็น `export`) ไม่ส่ง = ค่าตั้งต้นของ server
 */
export async function downloadReport(sc: string, req: ReportRequest, format: "txt" | "csv", setup?: ExportSetup): Promise<void> {
  const body = setup === undefined ? { ...req, format } : { ...req, format, export: setup };
  const { text, headers } = await apiSendText("POST", reportsPath(sc), body);
  const name = fileNameOf(headers.get("Content-Disposition")) ?? fallbackName(req.style, format);
  let url: string | null = null;
  const a = document.createElement("a");
  try {
    url = URL.createObjectURL(new Blob([text], { type: MIME[format] }));
    a.href = url;
    a.download = name;
    a.style.display = "none";
    document.body.append(a);
    a.click();
  } finally {
    a.remove();
    // เบราว์เซอร์อ่าน Blob หลัง click คืนค่าแล้ว (Safari/Firefox อาจช้า): คืน URL หลัง REVOKE_DELAY_MS ไม่ใช่ทันที
    const made = url;
    if (made !== null) setTimeout(() => URL.revokeObjectURL(made), REVOKE_DELAY_MS);
  }
}

// ---------- ทศนิยม (P9) ----------

export const DEFAULT_DECIMALS = 3;
/** ต้องตรงกับ report_format.DECIMALS ของ engine: ที่เหลือ (มุม ระยะ Duration DOP Lat Lon Alt) 3 ตำแหน่ง */
export const DECIMALS: Readonly<Record<string, number>> = Object.freeze({ "IPP Lat": 4, "IPP Lon": 4, MF: 5, "Lat Rate": 6, "Lon Rate": 6, "Alt Rate": 6 });

/** ทศนิยมของ element (ชื่อ element หรือหัวคอลัมน์) ค่าจำนวนเต็ม (kind int) ผู้เรียกแสดงไม่มีทศนิยมเอง */
export const decimalsOf = (element: string): number => DECIMALS[element] ?? DEFAULT_DECIMALS;

// ---------- style ----------

export type StyleKind = "report" | "graph";
export type StyleObjectType = "Access" | "Facility" | "Satellite";

export interface StyleContent {
  provider: string;
  /** provider ที่ไม่มี group = null */
  group: string | null;
  elements: string[];
}

export interface StyleTime {
  mode: "object_period" | "specify";
  step_s: number | null;
  start?: string;
  stop?: string;
}

export interface StyleSummary {
  per_object: string[];
  global_statistics: string[];
  summary_only: boolean;
}

/** style ตาม spec §3.3 + ช่อง P3 (dynamic, derive, ours) */
export interface StyleDef {
  name: string;
  kind: StyleKind;
  object_type: StyleObjectType;
  content: StyleContent[];
  time: StyleTime;
  summary: StyleSummary;
  graph: GraphDef | null;
  dynamic: boolean;
  derive: "gaps" | null;
  ours: boolean;
}

/** สามชั้นของ style: Installed (ล็อก) / My Styles (data/styles) / Scenario Styles (scenario.json) */
export interface StyleTiers {
  installed: StyleDef[];
  my: StyleDef[];
  scenario: StyleDef[];
}

// ---------- ตรวจโครงของ style ที่ได้จาก server ----------
// server ตรวจ My Styles (ไฟล์ที่แก้มือ) และ Scenario Styles (scenario.json) แค่ว่าเป็น object: ที่นี่ตรวจโครงตามกฎของ engine
// check_style (ไม่ตรวจชื่อ provider/element กับตาราง provider ซึ่ง server ตรวจตอนสร้างรายงาน, P6) ช่องที่ engine ไม่บังคับ
// (time, summary, graph ของรายงาน, dynamic, derive, ours) ได้ค่าตั้งต้นของ engine ผลจึงเป็น StyleDef ครบทุกช่อง
// style ที่โครงผิดไม่อยู่ในรายการ และส่งคำเตือนหนึ่งข้อความต่อ style เข้า Message Viewer

const KINDS: readonly string[] = ["report", "graph"];
const OBJECT_TYPES: readonly string[] = ["Access", "Facility", "Satellite"];
const GRAPH_TYPES: readonly string[] = ["time_xy", "interval", "polar90"];
const TIME_MODES: readonly string[] = ["object_period", "specify"];

type Doc = Record<string, unknown>;
type Parsed<T> = { ok: true; value: T } | { ok: false; field: string };

const isDoc = (v: unknown): v is Doc => typeof v === "object" && v !== null && !Array.isArray(v);
const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");
const bad = (field: string): { ok: false; field: string } => ({ ok: false, field });

/** ช่อง bool ที่ไม่ส่งมา = fallback ส่งมาแต่ไม่ใช่ bool = undefined (ผิด) */
const boolOr = (v: unknown, fallback: boolean): boolean | undefined => (v === undefined ? fallback : typeof v === "boolean" ? v : undefined);

function parseContent(v: unknown): Parsed<StyleContent[]> {
  if (!Array.isArray(v) || v.length === 0) return bad("content");
  const out: StyleContent[] = [];
  for (const [i, entry] of v.entries()) {
    const at = `content[${i}]`;
    if (!isDoc(entry)) return bad(at);
    if (typeof entry.provider !== "string") return bad(`${at}.provider`);
    const group = entry.group ?? null;
    if (group !== null && typeof group !== "string") return bad(`${at}.group`);
    if (!isStrings(entry.elements) || entry.elements.length === 0) return bad(`${at}.elements`);
    out.push({ provider: entry.provider, group, elements: [...entry.elements] });
  }
  return { ok: true, value: out };
}

function parseTime(v: unknown): Parsed<StyleTime> {
  if (v === undefined) return { ok: true, value: { mode: "object_period", step_s: null } };
  if (!isDoc(v)) return bad("time");
  const mode = v.mode ?? "object_period";
  if (typeof mode !== "string" || !TIME_MODES.includes(mode)) return bad("time.mode");
  const step = v.step_s ?? null;
  if (step !== null && !(typeof step === "number" && Number.isInteger(step) && step > 0)) return bad("time.step_s");
  const time: StyleTime = { mode: mode as StyleTime["mode"], step_s: step };
  for (const key of ["start", "stop"] as const) {
    if (v[key] === undefined) continue;
    if (typeof v[key] !== "string") return bad(`time.${key}`);
    time[key] = v[key];
  }
  return { ok: true, value: time };
}

function parseSummary(v: unknown): Parsed<StyleSummary> {
  if (v === undefined) return { ok: true, value: { per_object: [], global_statistics: [], summary_only: false } };
  if (!isDoc(v)) return bad("summary");
  const lists: Partial<Record<"per_object" | "global_statistics", string[]>> = {};
  for (const key of ["per_object", "global_statistics"] as const) {
    const list = v[key] ?? [];
    if (!isStrings(list)) return bad(`summary.${key}`);
    lists[key] = [...list];
  }
  const summaryOnly = boolOr(v.summary_only, false);
  if (summaryOnly === undefined) return bad("summary.summary_only");
  return { ok: true, value: { per_object: lists.per_object ?? [], global_statistics: lists.global_statistics ?? [], summary_only: summaryOnly } };
}

function parseGraph(v: unknown, kind: StyleKind): Parsed<GraphDef | null> {
  if (kind === "report") return v === undefined || v === null ? { ok: true, value: null } : bad("graph");
  if (!isDoc(v)) return bad("graph");
  if (typeof v.type !== "string" || !GRAPH_TYPES.includes(v.type)) return bad("graph.type");
  const graph: GraphDef = { type: v.type as GraphType, y1: [], y2: [] };
  for (const axis of ["y1", "y2"] as const) {
    const names = v[axis] ?? [];
    if (!isStrings(names)) return bad(`graph.${axis}`);
    graph[axis] = [...names];
  }
  if (v.stack !== undefined) {
    if (typeof v.stack !== "boolean") return bad("graph.stack");
    graph.stack = v.stack;
  }
  return { ok: true, value: graph };
}

/** style จาก server เป็น StyleDef ครบทุกช่อง หรือช่องแรกที่ผิด */
export function parseStyle(v: unknown): Parsed<StyleDef> {
  if (!isDoc(v)) return bad("style");
  if (typeof v.name !== "string" || v.name === "") return bad("name");
  if (typeof v.kind !== "string" || !KINDS.includes(v.kind)) return bad("kind");
  if (typeof v.object_type !== "string" || !OBJECT_TYPES.includes(v.object_type)) return bad("object_type");
  const kind = v.kind as StyleKind;
  const content = parseContent(v.content);
  if (!content.ok) return content;
  const time = parseTime(v.time);
  if (!time.ok) return time;
  const summary = parseSummary(v.summary);
  if (!summary.ok) return summary;
  const graph = parseGraph(v.graph, kind);
  if (!graph.ok) return graph;
  const dynamic = boolOr(v.dynamic, false);
  if (dynamic === undefined) return bad("dynamic");
  const derive = v.derive ?? null;
  if (derive !== null && derive !== "gaps") return bad("derive");
  const ours = boolOr(v.ours, false);
  if (ours === undefined) return bad("ours");
  return {
    ok: true,
    value: {
      name: v.name, kind, object_type: v.object_type as StyleObjectType, content: content.value, time: time.value,
      summary: summary.value, graph: graph.value, dynamic, derive, ours,
    },
  };
}

const TIER_NAMES: Record<keyof StyleTiers, string> = { installed: "Installed Styles", my: "My Styles", scenario: "Scenario Styles" };

/** style ที่โครงถูกต้องของชั้นหนึ่ง ที่เหลือทิ้งพร้อมคำเตือนหนึ่งข้อความต่อ style */
function stylesOf(list: unknown, tier: keyof StyleTiers): StyleDef[] {
  const out: StyleDef[] = [];
  for (const [i, entry] of (Array.isArray(list) ? list : []).entries()) {
    const parsed = parseStyle(entry);
    if (parsed.ok) {
      out.push(parsed.value);
      continue;
    }
    const name = isDoc(entry) && typeof entry.name === "string" && entry.name !== "" ? entry.name : null;
    const text = name === null
      ? msg("styles.malformedUnnamed", { n: i + 1, tier: TIER_NAMES[tier] })
      : msg("styles.malformed", { name, tier: TIER_NAMES[tier], field: parsed.field });
    report("warning", "STYLE_MALFORMED", text);
  }
  return out;
}

/** objectType / sc เป็น null = ไม่กรองชนิด / ไม่เอา Scenario Styles */
export async function fetchStyles(objectType: string | null, sc: string | null, opts: ApiOptions = {}): Promise<StyleTiers> {
  const q = new URLSearchParams();
  if (objectType !== null) q.set("object_type", objectType);
  if (sc !== null) q.set("scenario", sc);
  const query = q.toString();
  const { data } = await apiGet<Partial<Record<keyof StyleTiers, unknown>>>(`/styles${query === "" ? "" : `?${query}`}`, opts);
  return { installed: stylesOf(data?.installed, "installed"), my: stylesOf(data?.my, "my"), scenario: stylesOf(data?.scenario, "scenario") };
}

const stylePath = (name: string): string => `/styles/${encodeURIComponent(name)}`;

/** บันทึก My Style (สร้างใหม่หรือแทนที่ชื่อเดิมตัวพิมพ์ตรงกัน) ชื่อชนกับ Installed/My Style ตัวพิมพ์อื่น = ApiError 409 */
export async function saveMyStyle(style: StyleDef): Promise<void> {
  await apiSend("PUT", stylePath(style.name), style);
}

export async function deleteMyStyle(name: string): Promise<void> {
  await apiSend("DELETE", stylePath(name));
}

// ---------- Data Provider ----------

export type ProviderInfo = Schemas["ProviderOut"];
export type ElementInfo = Schemas["ElementOut"];

/** provider ของ object ชนิด cls (name = ชื่อหรือ path ของ object ไว้ตรวจว่ามีจริง null = ไม่ระบุ) ชนิดที่ไม่มี provider ได้ [] */
export async function fetchProviders(sc: string, cls: string, name: string | null, opts: ApiOptions = {}): Promise<ProviderInfo[]> {
  const q = new URLSearchParams({ class: cls });
  if (name !== null) q.set("name", name);
  const { data } = await apiGet<ProviderInfo[]>(`/scenarios/${encodeURIComponent(sc)}/dataproviders?${q.toString()}`, opts);
  return data;
}

// ---------- ชื่อ (P1, P11) ----------

/** path ของ Access object (P1): คู่ path คั่นด้วยช่องว่างหนึ่งตัว */
export const accessPath = (facility: string, satellite: string): string => `*/Facility/${facility} */Satellite/${satellite}`;

const PATH = /^\*\/(Facility|Satellite)\/([A-Za-z0-9_-]{1,32})$/;

/** ชื่อที่แสดง (engine display_name): THBK-To-G01 / THBK / G01; path ที่อ่านไม่ได้คืนตามตัว */
export function accessName(path: string): string {
  const parts = path.split(" ").map((p) => PATH.exec(p));
  if (parts.length === 1 && parts[0] !== null) return parts[0][2];
  if (parts.length !== 2 || parts[0] === null || parts[1] === null) return path;
  const byKind = new Map(parts.map((m) => [(m as RegExpExecArray)[1], (m as RegExpExecArray)[2]]));
  const facility = byKind.get("Facility");
  const satellite = byKind.get("Satellite");
  return facility === undefined || satellite === undefined ? path : `${facility}-To-${satellite}`;
}

/** ชื่อหน้าต่างรายงาน/กราฟ: `THBK-To-G01: Access` หนึ่ง object, `Multiple Objects: Access` หลาย object */
export function reportTitle(objects: readonly string[], style: string): string {
  if (objects.length === 0) return style;
  const who = objects.length === 1 ? accessName(objects[0]) : t("window.multipleObjects");
  return `${who}: ${style}`;
}
