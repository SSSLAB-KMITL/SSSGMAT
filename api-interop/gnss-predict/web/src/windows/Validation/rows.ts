// แถวและชุดข้อมูลของหน้า Validation (spec §7): ฟังก์ชันล้วนจากสามแหล่งของ server — `GET /validation/history` (บรรทัดของ history.jsonl),
// `GET /validation/pending` (วันที่ยังไม่มีผลตรวจ) และ `GET /validation/{sc}/{day}` (validation_<day>.json) ไม่รู้จัก React และ echarts
//
// - server ส่งต่อ JSON ของไฟล์ตามที่เขียน (บรรทัดที่เป็น object ใด ๆ ผ่านได้) จึงอ่านแบบทนความเพี้ยน: parseHistory ทิ้งบรรทัดที่ไม่มี day/scenario ที่ใช้ได้,
//   ตัวเลขที่ไม่ใช่จำนวนจำกัด = null, ช่องที่ไม่รู้จักไม่ถูกแตะ
// - วัน + scenario เดียวกันที่ตรวจซ้ำ (หลายบรรทัดในไฟล์) แสดงบรรทัดที่ใหม่สุด (created_utc แล้วลำดับในไฟล์); วันที่มีผลแล้วไม่แสดงซ้ำเป็น Pending
// - Result ของวัน: pass | fail (จากช่อง pass ของ history) | pending | gave_up (จาก /validation/pending) เรียงวันใหม่สุดก่อน
//   ข2: systems ของ history มีเฉพาะระบบที่มีดาวค่าจริง SP3 อายุ ≤ 2 วันอย่างน้อยหนึ่งดวง จึงว่างได้ทั้งวันที่มีแต่ดาวถ่ายภาพ (engine ข้าม X)
//   และวัน GNSS ที่ทุกดวงเก่าหรือมีแต่ broadcast: ไม่มีระบบ GNSS ใน systems + มีดวงไม่ผ่าน = fail ; ไม่มี systems (หรือไม่ใช่ object) = fail ตามเดิม ;
//   นอกนั้น = undecided (ตัดสินไม่ได้ กลาง ๆ) แล้ว shownResult เปลี่ยนเป็น no_gnss เมื่อผลรายวันของวันนั้นโหลดมาแล้วมี satellites ว่าง
//   (validate ใส่ทุก PRN ที่ไม่ใช่ X ไว้ที่นั่น ว่าง = ไม่มีดาว GNSS ในวันนั้นเลย)
// - Trend: ค่า P99 ต่อระบบต่อวัน (หนึ่งจุดต่อวัน: บรรทัดที่ใหม่สุดของวันนั้นถ้ามีหลาย scenario) เส้นเกณฑ์เท่ากับ EL_P99_MAX / AZ_P99_MAX ของ engine (0.2° / 0.5°)

import type { components } from "../../api/types.gen";

export type PendingDay = components["schemas"]["PendingDay"];

/** ΔEl หรือ ΔAz */
export type Metric = "el" | "az";

/** เส้นเกณฑ์ P99 (องศา) ตาม spec §7: เท่ากับ EL_P99_MAX และ AZ_P99_MAX ใน gnss_predict/config.py */
export const TREND_LIMITS: Readonly<Record<Metric, number>> = Object.freeze({ el: 0.2, az: 0.5 });

/** กราฟอายุอ่านผลรายวันของวันที่ตรวจแล้วใหม่สุดไม่เกินจำนวนนี้ (วันเก่ากว่านั้นยังเปิดดูรายดวงได้เมื่อคลิก) */
export const AGE_DAYS_LIMIT = 180;

/** ลำดับระบบในตารางและกราฟ: GPS, GLONASS, Galileo, BeiDou แล้วตัวอื่นตามตัวอักษร (ตรงกับ GNSS_GROUPS ของ engine) */
const SYSTEM_ORDER = "GREC";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DASH = "—";

// ---------- ชนิดข้อมูลของ server ----------

/** สถิติของหนึ่งระบบในหนึ่งวัน (ช่อง `systems` ของ history และของ validation_<day>.json) */
export interface SystemStats {
  sats?: number | null;
  pairs?: number | null;
  az_pairs?: number | null;
  el_median?: number | null;
  el_p99?: number | null;
  az_median?: number | null;
  az_p99?: number | null;
  pass?: boolean | null;
}

/** หนึ่งบรรทัดของ history.jsonl */
export interface HistoryRecord {
  day: string;
  scenario: string;
  ephem_hash?: string;
  truth_file?: string | null;
  pass?: boolean;
  systems?: Record<string, SystemStats>;
  failing?: string[];
  created_utc?: string | null;
}

/** ผลรายดวงใน validation_<day>.json */
export interface SatStats {
  truth?: string | null;
  pairs?: number | null;
  az_pairs?: number | null;
  el_median?: number | null;
  el_p99?: number | null;
  az_median?: number | null;
  az_p99?: number | null;
  d3_median_km?: number | null;
  d3_max_km?: number | null;
  age_days?: number | null;
  flags?: string[];
  result?: string | null;
}

/** validation_<day>.json เฉพาะส่วนที่หน้านี้ใช้ */
export interface ValidationDoc {
  day: string;
  scenario?: string;
  satellites: Record<string, SatStats>;
}

// ---------- อ่านแบบทนความเพี้ยน ----------

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const str = (x: unknown): string | null => (typeof x === "string" ? x : null);
const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
const strings = (x: unknown): string[] => (Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : []);
/** ช่องที่เป็น object ของ object (ระบบ → สถิติ, PRN → ผลรายดวง): เก็บเฉพาะค่าที่เป็น object */
const objectsOf = <T>(x: unknown): Record<string, T> =>
  isObject(x) ? Object.fromEntries(Object.entries(x).filter(([, v]) => isObject(v))) as Record<string, T> : {};

/** บรรทัดของ history ที่ใช้ได้ (มี day แบบ YYYY-MM-DD และ scenario) ตามลำดับเดิม; ไม่ใช่รายการ = [] */
export function parseHistory(raw: unknown): HistoryRecord[] {
  if (!Array.isArray(raw)) return [];
  const out: HistoryRecord[] = [];
  for (const item of raw) {
    if (!isObject(item)) continue;
    const day = str(item.day);
    const scenario = str(item.scenario);
    if (day === null || !DAY_RE.test(day) || scenario === null || scenario === "") continue;
    out.push({
      day, scenario,
      ephem_hash: str(item.ephem_hash) ?? undefined,
      truth_file: str(item.truth_file),
      pass: item.pass === true,
      // ไม่มีหรือไม่ใช่ object = ไม่มีช่อง (ผลของวันเป็น Fail ตามเดิม) ต่างจาก {} ที่ engine เขียนเมื่อไม่มีระบบใดตัดสินได้
      systems: isObject(item.systems) ? objectsOf<SystemStats>(item.systems) : undefined,
      failing: strings(item.failing),
      created_utc: str(item.created_utc),
    });
  }
  return out;
}

/** รายการจาก /validation/pending ที่ใช้ได้ (scenario, day แบบ YYYY-MM-DD, state เป็น pending หรือ gave_up); ไม่ใช่รายการ = [] */
export function parsePending(raw: unknown): PendingDay[] {
  if (!Array.isArray(raw)) return [];
  const out: PendingDay[] = [];
  for (const item of raw) {
    if (!isObject(item)) continue;
    const day = str(item.day);
    const scenario = str(item.scenario);
    if (day === null || !DAY_RE.test(day) || scenario === null || scenario === "") continue;
    if (item.state !== "pending" && item.state !== "gave_up") continue;
    out.push({ scenario, day, state: item.state, next_attempt_utc: str(item.next_attempt_utc) });
  }
  return out;
}

/** validation_<day>.json: ต้องเป็น object ไม่งั้น null; `satellites` เก็บเฉพาะ PRN ที่ค่าเป็น object */
export function parseDay(raw: unknown): ValidationDoc | null {
  if (!isObject(raw)) return null;
  const doc: ValidationDoc = { day: str(raw.day) ?? "", satellites: objectsOf<SatStats>(raw.satellites) };
  const scenario = str(raw.scenario);
  if (scenario !== null) doc.scenario = scenario;
  return doc;
}

// ---------- ตัวช่วย ----------

const systemRank = (letter: string): number => {
  const i = SYSTEM_ORDER.indexOf(letter);
  return i < 0 ? SYSTEM_ORDER.length : i;
};
/** เทียบอักษรระบบตามลำดับ G R E C แล้วตัวอื่น */
export const compareSystems = (a: string, b: string): number => systemRank(a) - systemRank(b) || (a < b ? -1 : a > b ? 1 : 0);

/** วัน + scenario เดียวกัน: บรรทัดที่ใหม่สุดชนะ (created_utc ที่เท่ากันหรือไม่มี = บรรทัดที่อยู่หลังในไฟล์) */
function latestPerDay(history: readonly HistoryRecord[]): Map<string, HistoryRecord> {
  const latest = new Map<string, HistoryRecord>();
  for (const rec of history) {
    const key = `${rec.scenario}\u0000${rec.day}`;
    const cur = latest.get(key);
    if (cur === undefined || (rec.created_utc ?? "") >= (cur.created_utc ?? "")) latest.set(key, rec);
  }
  return latest;
}

// ---------- ตารางรายวัน ----------

export type DayResult = "pass" | "fail" | "pending" | "gave_up" | "undecided" | "no_gnss";

/** อักษรของระบบ GNSS (GNSS_GROUPS ของ engine) */
const GNSS_LETTERS = new Set(SYSTEM_ORDER);

/** ผลของวันที่ตรวจแล้วจากบรรทัดของ history (กติกาที่หัวไฟล์) */
function resultOf(rec: HistoryRecord): DayResult {
  if (Object.keys(rec.systems ?? {}).some((letter) => GNSS_LETTERS.has(letter))) return rec.pass === true ? "pass" : "fail";
  if (strings(rec.failing).length > 0 || rec.systems === undefined) return "fail";
  return "undecided";
}

/** ผลที่แสดงของแถว: undecided ที่ผลรายวัน (doc ที่โหลดแล้ว) มี satellites ว่าง = no_gnss ; doc ยังไม่มา (null) หรือแถวอื่น = ผลของแถวเอง */
export function shownResult(row: Pick<DailyRow, "result">, doc: ValidationDoc | null): DayResult {
  return row.result === "undecided" && doc !== null && Object.keys(doc.satellites).length === 0 ? "no_gnss" : row.result;
}

/** ค่ากลางกับ P99 ของหนึ่งระบบในวันหนึ่ง (ตาม Metric ที่เลือก) */
export interface SystemCell {
  system: string;
  median: number | null;
  p99: number | null;
  pass: boolean | null;
}

export interface DailyRow {
  /** `<scenario>/<day>` */
  key: string;
  day: string;
  scenario: string;
  /** ชื่อไฟล์ SP3 ที่ใช้เป็นค่าจริง (วันที่ยังไม่มีผล = null) */
  truth: string | null;
  systems: SystemCell[];
  result: DayResult;
  /** PRN ที่ไม่ผ่าน */
  failing: string[];
  /** เวลาที่ตัวตั้งเวลาจะลองครั้งถัดไป (ISO UTC) เฉพาะ pending ที่ server รู้เวลา */
  nextAttempt: string | null;
  /** created_utc ของบรรทัดที่แสดง (ใช้เป็นกุญแจแคชผลรายวัน: ตรวจซ้ำแล้วดึงใหม่) */
  created: string | null;
}

const MEDIAN = { el: "el_median", az: "az_median" } as const;
const P99 = { el: "el_p99", az: "az_p99" } as const;

function systemCells(rec: HistoryRecord, metric: Metric): SystemCell[] {
  return Object.keys(rec.systems ?? {}).sort(compareSystems).map((system) => {
    const s = (rec.systems ?? {})[system];
    return {
      system,
      median: num(s[MEDIAN[metric]]),
      p99: num(s[P99[metric]]),
      pass: typeof s.pass === "boolean" ? s.pass : null,
    };
  });
}

/** ตารางรายวัน: ประวัติ (Pass / Fail) รวมกับวันที่ยังไม่มีผล (Pending / Gave up) เรียงวันใหม่สุดก่อน แล้ว scenario ตามตัวอักษร */
export function dailyRows(history: readonly HistoryRecord[], pending: readonly PendingDay[], metric: Metric): DailyRow[] {
  const latest = latestPerDay(history);
  const rows: DailyRow[] = [...latest.values()].map((rec) => ({
    key: `${rec.scenario}/${rec.day}`,
    day: rec.day,
    scenario: rec.scenario,
    truth: rec.truth_file ?? null,
    systems: systemCells(rec, metric),
    result: resultOf(rec),
    failing: strings(rec.failing),
    nextAttempt: null,
    created: rec.created_utc ?? null,
  }));
  for (const p of pending) {
    if (latest.has(`${p.scenario}\u0000${p.day}`)) continue; // มีผลแล้ว (ไฟล์ผลย้ายที่ หรือสถานะของ server ช้ากว่า)
    rows.push({
      key: `${p.scenario}/${p.day}`,
      day: p.day,
      scenario: p.scenario,
      truth: null,
      systems: [],
      result: p.state === "gave_up" ? "gave_up" : "pending",
      failing: [],
      nextAttempt: p.state === "gave_up" ? null : p.next_attempt_utc,
      created: null,
    });
  }
  return rows.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : a.scenario < b.scenario ? -1 : a.scenario > b.scenario ? 1 : 0));
}

/** ระบบที่มีในแถวใด ๆ (หนึ่งระบบ = หนึ่งคอลัมน์ในตารางรายวัน) ตามลำดับ G R E C แล้วตัวอื่น */
export function systemLetters(rows: readonly Pick<DailyRow, "systems">[]): string[] {
  const letters = new Set<string>();
  for (const row of rows) for (const cell of row.systems) letters.add(cell.system);
  return [...letters].sort(compareSystems);
}

// ---------- ตารางรายดวง ----------

/** เทียบ PRN: ระบบตามลำดับ G R E C แล้วตัวอื่น จากนั้นตามเลขของ PRN (ไม่ใช่ตามตัวอักษร) */
export const comparePrn = (a: string, b: string): number => compareSystems(a.charAt(0), b.charAt(0)) || (a < b ? -1 : a > b ? 1 : 0);

export interface SatRow {
  prn: string;
  /** อักษรนำของ PRN (G R E C) */
  system: string;
  /** sp3 | brdc | unverified */
  truth: string | null;
  pairs: number | null;
  azPairs: number | null;
  elMedian: number | null;
  elP99: number | null;
  azMedian: number | null;
  azP99: number | null;
  /** ระยะคลาด 3 มิติ (km) */
  d3Median: number | null;
  d3Max: number | null;
  /** อายุข้อมูลวงโคจร (วัน) */
  ageDays: number | null;
  flags: string[];
  /** pass | fail | insufficient_data | unverified */
  result: string | null;
}

export interface SatFilter {
  /** อักษรนำของ PRN; ว่างหรือไม่ระบุ = ทุกระบบ */
  system?: string;
  /** ผลรายดวง; ว่างหรือไม่ระบุ = ทุกผล */
  result?: string;
}

/** ผลรายดวงของวันหนึ่ง เรียงตาม PRN กรองตามระบบและผล */
export function satelliteRows(doc: ValidationDoc, filter: SatFilter = {}): SatRow[] {
  const out: SatRow[] = [];
  for (const prn of Object.keys(doc.satellites).sort(comparePrn)) {
    const s = doc.satellites[prn];
    const result = str(s.result);
    if (filter.system && prn.charAt(0) !== filter.system) continue;
    if (filter.result && result !== filter.result) continue;
    out.push({
      prn, system: prn.charAt(0), truth: str(s.truth), pairs: num(s.pairs), azPairs: num(s.az_pairs),
      elMedian: num(s.el_median), elP99: num(s.el_p99), azMedian: num(s.az_median), azP99: num(s.az_p99),
      d3Median: num(s.d3_median_km), d3Max: num(s.d3_max_km), ageDays: num(s.age_days), flags: strings(s.flags), result,
    });
  }
  return out;
}

/** ระบบที่มีดาวในผลของวันนี้ (ตัวเลือกของตัวกรองระบบ) */
export function docSystems(doc: ValidationDoc): string[] {
  return [...new Set(Object.keys(doc.satellites).map((prn) => prn.charAt(0)))].sort(compareSystems);
}

// ---------- แนวโน้ม ----------

export interface TrendSeries {
  system: string;
  /** P99 ของแต่ละวันใน `days` (ไม่มีค่า = null) */
  values: (number | null)[];
}

export interface Trend {
  metric: Metric;
  /** เส้นเกณฑ์ P99 (องศา) */
  limit: number;
  /** วันที่เรียงจากเก่าไปใหม่ */
  days: string[];
  series: TrendSeries[];
}

/** P99 ต่อระบบตามวัน (หนึ่งจุดต่อวัน: บรรทัดที่ใหม่สุดของวันนั้น) พร้อมเส้นเกณฑ์ของ Metric */
export function trendSeries(history: readonly HistoryRecord[], metric: Metric): Trend {
  const byDay = new Map<string, HistoryRecord>();
  for (const rec of latestPerDay(history).values()) {
    const cur = byDay.get(rec.day);
    if (cur === undefined || (rec.created_utc ?? "") >= (cur.created_utc ?? "")) byDay.set(rec.day, rec);
  }
  const days = [...byDay.keys()].sort();
  const letters = new Set<string>();
  for (const rec of byDay.values()) for (const system of Object.keys(rec.systems ?? {})) letters.add(system);
  const series = [...letters].sort(compareSystems).map((system) => ({
    system,
    values: days.map((day) => num(byDay.get(day)?.systems?.[system]?.[P99[metric]])),
  })).filter((s) => s.values.some((v) => v !== null));
  return { metric, limit: TREND_LIMITS[metric], days, series };
}

// ---------- อายุกับความคลาด ----------

/** `[อายุข้อมูล (วัน), ค่ากลางระยะ 3 มิติ (km), PRN]` ของทุกดาวทุกวัน ข้ามดาวที่ไม่มีอายุหรือไม่มีค่ากลางระยะ */
export function ageScatter(docs: readonly ValidationDoc[]): [number, number, string][] {
  const points: [number, number, string][] = [];
  for (const doc of docs) {
    for (const prn of Object.keys(doc.satellites).sort(comparePrn)) {
      const age = num(doc.satellites[prn].age_days);
      const d3 = num(doc.satellites[prn].d3_median_km);
      if (age !== null && d3 !== null) points.push([age, d3, prn]);
    }
  }
  return points;
}

/** สรุปกราฟอายุเป็นตัวเลข: จำนวนดวงที่มีจุด จำนวนวันที่มีจุดอย่างน้อยหนึ่งจุด และค่ากลางของอายุ (ไม่มีจุดเลย = null) */
export function ageSummary(docs: readonly ValidationDoc[]): { points: number; days: number; medianAge: number | null } {
  const ages: number[] = [];
  let days = 0;
  for (const doc of docs) {
    const points = ageScatter([doc]);
    if (points.length > 0) days++;
    for (const p of points) ages.push(p[0]);
  }
  if (ages.length === 0) return { points: 0, days: 0, medianAge: null };
  ages.sort((a, b) => a - b);
  const mid = ages.length >> 1;
  return { points: ages.length, days, medianAge: ages.length % 2 === 1 ? ages[mid] : (ages[mid - 1] + ages[mid]) / 2 };
}

// ---------- ข้อความตัวเลข ----------

/** ตัวเลขทศนิยมคงที่ ไม่มีค่า = "—" */
export const fixed = (n: number | null, digits: number): string => (n === null ? DASH : n.toFixed(digits));

/** "ค่ากลาง / ค่าสูง" ในช่องเดียว ไม่มีทั้งสองค่า = "—" */
export const pairText = (a: number | null, b: number | null, digits: number): string =>
  a === null && b === null ? DASH : `${fixed(a, digits)} / ${fixed(b, digits)}`;
