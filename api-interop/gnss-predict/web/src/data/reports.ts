// ชั้นข้อมูลของรายงานและกราฟ (spec §5, §6): POST /scenarios/{sc}/reports, GET /styles, PUT/DELETE /styles/{name},
// GET /scenarios/{sc}/dataproviders และชื่อของ object/หน้าต่าง
// - ค่าใน JSON ของรายงานไม่ปัดเศษ (engine report_json) หน้าเว็บจัดทศนิยมเองตาม DECIMALS (P9) ซึ่งต้องตรงกับ report_format.DECIMALS
//   (reports-data.test.ts เทียบกับไฟล์ของ engine)
// - provider ที่ไม่มี group (Access Data, N Asset Coverage, IPP Data) ใช้ group null ใน style
// - ไม่ import echarts (กราฟโหลดผ่าน windows/Graph/chart.ts เท่านั้น)

import { apiGet, apiSend, apiSendText, type ApiOptions } from "../api/client";
import type { components } from "../api/types.gen";
import { t } from "../labels/labels";

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
  const url = URL.createObjectURL(new Blob([text], { type: MIME[format] }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.style.display = "none";
  document.body.append(a);
  try {
    a.click();
  } finally {
    a.remove();
    // Safari เริ่มดาวน์โหลดหลัง click คืนค่า: คืน URL ในรอบถัดไป
    setTimeout(() => URL.revokeObjectURL(url), 0);
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

/** My Style ที่แก้มือในไฟล์อาจขาดบางช่อง (server ส่งต่อตามที่อ่านได้): กรองแค่ที่ไม่ใช่ object หรือไม่มีชื่อ */
const named = (list: unknown): StyleDef[] =>
  (Array.isArray(list) ? list : []).filter(
    (s): s is StyleDef => typeof s === "object" && s !== null && typeof (s as { name?: unknown }).name === "string",
  );

/** objectType / sc เป็น null = ไม่กรองชนิด / ไม่เอา Scenario Styles */
export async function fetchStyles(objectType: string | null, sc: string | null, opts: ApiOptions = {}): Promise<StyleTiers> {
  const q = new URLSearchParams();
  if (objectType !== null) q.set("object_type", objectType);
  if (sc !== null) q.set("scenario", sc);
  const query = q.toString();
  const { data } = await apiGet<Partial<Record<keyof StyleTiers, unknown>>>(`/styles${query === "" ? "" : `?${query}`}`, opts);
  return { installed: named(data?.installed), my: named(data?.my), scenario: named(data?.scenario) };
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
