// แถวของ Timeline View (spec §10): จาก access ที่เปิด Timeline ใน scenario + ช่วงเวลาที่ server ตอบ (GET /access/intervals)
//
// - หนึ่งคำขอต่อหนึ่ง access ที่ Compute แล้ว (`computed: true` แบบ STK: Clear แล้วหายจาก Timeline) และ `timeline` ไม่เป็น false
//   (ค่าตั้งต้นของ server = true): from + to ทุกตัวของมัน
//   server ตอบ `{ชื่อดาว: [{start, stop, duration_s, max_el_deg}]}` ต่อดาวที่ขยายแล้ว (Constellation ขยายเป็นสมาชิกที่ไม่ถูกซ่อน)
// - ชื่อแถว `<ชื่อ object ต้นทาง>-To-<ชื่อดาว>` (THBK-To-G01) เรียงตาม access แล้วตามลำดับดาวในคำตอบ
// - 409 RESULTS_NOT_CURRENT (ผลของ Facility ต้นทางไม่ตรงหรือยังไม่มี) = แถวว่างหนึ่งแถวต่อ access พร้อมหมายเหตุไทย (เส้นทแยงบนจอ)
// - สีตาม graphics.color_mode: "object" = สีที่ใช้จริงของดาว (colors.ts ตัวเดียวกับภาพ 3D/2D), "custom" = custom_color,
//   ไม่มี graphics หรืออ่านสีไม่ได้ = สี --color-access
// - เวลาในแถวเป็นวินาทีนับจาก epoch (หน่วยเดียวกับ scale.ts) ไฟล์นี้ไม่ import Cesium

import { ApiError, apiGet, errorText, isAbortError } from "../../api/client";
import type { components } from "../../api/types.gen";
import { effectiveColor, themeTokens, type ColorCtx } from "../../cesium/colors";
import { msg } from "../../labels/messages.th";
import type { ResultsInfo } from "../../stores/results";
import type { ScenarioDoc } from "../../stores/scenario";
import { parseIsoUtc } from "../../time/parse";

export type AccessDef = components["schemas"]["AccessDef"];

export interface TimelineInterval {
  /** วินาทีนับจาก epoch */
  start: number;
  stop: number;
  maxElDeg?: number;
}

export interface TimelineRow {
  /** `THBK-To-G01` */
  name: string;
  /** #rrggbb */
  color: string;
  intervals: TimelineInterval[];
  /** แถวว่างเพราะไม่มีช่วงเวลาให้ (วาดเป็นเส้นทแยง): ผลไม่ตรง/ยังไม่มี หรือดึงไม่สำเร็จ */
  unavailable?: "notCurrent" | "error";
  /** หมายเหตุไทยของแถวที่ unavailable (แสดงเมื่อชี้) */
  note?: string;
}

type SatIntervals = Record<string, unknown[]>;

/** คำตอบของ access หนึ่งตัว */
export type AccessResult =
  | { status: "ok"; bySat: SatIntervals }
  /** 409 RESULTS_NOT_CURRENT */
  | { status: "notCurrent" }
  | { status: "error"; message: string; code?: string };

/** กุญแจ = accessKey(access) */
export type IntervalsByAccess = Record<string, AccessResult>;

/** access ที่เป็นแถวใน Timeline: Compute แล้ว (`computed: true`) และ `timeline` ไม่เป็น false (server ตั้งต้น true) */
export const isTimelineAccess = (a: AccessDef): boolean => a.computed === true && a.timeline !== false;

/** กุญแจของ access หนึ่งตัว: from + to (server ถือเป็นตัวตนของ access) */
export const accessKey = (a: Pick<AccessDef, "from" | "to">): string => JSON.stringify([a.from, a.to]);

// ชื่อ object ของ path ("*/Facility/THBK" -> THBK)
const nameOf = (path: string): string => path.split("/").at(-1) ?? path;

/**
 * กุญแจของการดึงช่วงเวลาของชุด access (Timeline View และ highlight ของหน้าต่าง 2D ใช้ตัวเดียวกัน): access ที่ขอ (from, to, ช่วงที่ตัดผล)
 * สถานะของผล ephem และสถานะ/hash ของ bundle ของ Facility ต้นทาง (bundle ของ access ผูกกับ ephem ที่ใช้คำนวณจึงเปลี่ยนตามเมื่อ ephem เปลี่ยน)
 * ตัวอักษรเท่าเดิม = ไม่ต้องดึงใหม่ ค่าที่ไม่กระทบช่วงเวลา (สี, Show) ไม่อยู่ในกุญแจ
 */
export function accessResultsKey(wanted: readonly AccessDef[], info: ResultsInfo | null): string {
  return JSON.stringify([
    wanted.map((a) => [a.from, a.to, a.time_period ?? null]),
    info?.ephem.status ?? null,
    wanted.map((a) => {
      const entry = info?.access[nameOf(a.from)];
      return [entry?.status ?? null, entry?.hash ?? null];
    }),
  ]);
}

/** ชื่อของ access ทั้งตัว `THBK-To-GPS` (ปลายทางหลายตัวคั่นด้วย ,) ใช้เป็นชื่อแถวที่ไม่มีช่วงเวลาและในข้อความถึงผู้ใช้ */
export const accessLabel = (a: Pick<AccessDef, "from" | "to">): string => `${nameOf(a.from)}-To-${a.to.map(nameOf).join(",")}`;

const HEX = /^#[0-9a-fA-F]{6}$/;
const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

function intervalsOf(list: readonly unknown[]): TimelineInterval[] {
  const out: TimelineInterval[] = [];
  for (const raw of list) {
    if (!isRecord(raw) || typeof raw.start !== "string" || typeof raw.stop !== "string") continue;
    const start = parseIsoUtc(raw.start);
    const stop = parseIsoUtc(raw.stop);
    if (start === null || stop === null) continue;
    out.push({
      start: start.getTime() / 1000,
      stop: stop.getTime() / 1000,
      ...(typeof raw.max_el_deg === "number" ? { maxElDeg: raw.max_el_deg } : {}),
    });
  }
  return out.sort((a, b) => a.start - b.start);
}

function rowColor(access: AccessDef, satellite: string, doc: ScenarioDoc, ctx: ColorCtx & { tokens: NonNullable<ColorCtx["tokens"]> }): string {
  const g = access.graphics;
  if (g?.color_mode === "custom" && typeof g.custom_color === "string" && HEX.test(g.custom_color)) return g.custom_color.toLowerCase();
  if (g?.color_mode === "object") {
    const sat = doc.objects.find((o) => o.class === "Satellite" && o.name === satellite);
    if (sat !== undefined) return effectiveColor(sat, doc, ctx);
  }
  return ctx.tokens.access;
}

/**
 * แถวของ Timeline จาก access ของ doc และคำตอบที่ได้มา (access ที่ยังไม่มีคำตอบไม่มีแถว)
 * ctx = สีของระบบ (tokens) และ NORAD -> PRN ของผล ephem ปัจจุบัน (หาระบบของดาวเมื่อดาวไม่มีสีของตัวเอง)
 */
export function timelineRows(doc: ScenarioDoc | null, replies: IntervalsByAccess, ctx: ColorCtx = {}): TimelineRow[] {
  if (doc === null) return [];
  const tokens = ctx.tokens ?? themeTokens();
  const colorCtx = { ...ctx, tokens };
  const rows: TimelineRow[] = [];
  for (const access of doc.accesses ?? []) {
    if (!isTimelineAccess(access)) continue;
    const reply = replies[accessKey(access)];
    if (reply === undefined) continue;
    const from = nameOf(access.from);
    if (reply.status !== "ok") {
      const name = accessLabel(access);
      rows.push({
        name,
        color: tokens.access,
        intervals: [],
        unavailable: reply.status,
        note: reply.status === "notCurrent" ? msg("timeline.notCurrent") : msg("timeline.failed", { name, message: reply.message }),
      });
      continue;
    }
    for (const [satellite, list] of Object.entries(reply.bySat)) {
      rows.push({ name: `${from}-To-${satellite}`, color: rowColor(access, satellite, doc, colorCtx), intervals: intervalsOf(list) });
    }
  }
  return rows;
}

const isSatIntervals = (x: unknown): x is SatIntervals => isRecord(x) && Object.values(x).every(Array.isArray);

/**
 * ดึงช่วงเวลาของ access หนึ่งตัว: 409 RESULTS_NOT_CURRENT = notCurrent, ผิดพลาดอื่น = error (พร้อมข้อความของ server)
 * การยกเลิกด้วย signal โยนต่อ (ผู้เรียกทิ้งคำตอบ ไม่ใช่แถวผิดพลาด)
 */
export async function fetchAccessResult(scenario: string, access: Pick<AccessDef, "from" | "to">, signal?: AbortSignal): Promise<AccessResult> {
  const query = new URLSearchParams();
  query.append("from", access.from);
  for (const to of access.to) query.append("to", to);
  try {
    const { data } = await apiGet<unknown>(`/scenarios/${encodeURIComponent(scenario)}/access/intervals?${query}`, { signal });
    return isSatIntervals(data) ? { status: "ok", bySat: data } : { status: "error", message: msg("timeline.badReply") };
  } catch (e) {
    if (isAbortError(e)) throw e;
    if (e instanceof ApiError) {
      return e.status === 409 && e.code === "RESULTS_NOT_CURRENT" ? { status: "notCurrent" } : { status: "error", code: e.code, message: e.text };
    }
    return { status: "error", message: errorText(e) };
  }
}
