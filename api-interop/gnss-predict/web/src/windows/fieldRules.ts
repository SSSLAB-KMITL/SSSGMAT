// อ่านตัวเลขจากข้อความในช่องกรอก (Insert STK Objects, Daily Forecast Settings) ตามกติกาเดียวกับ schema ของ server
// ผลเป็นค่า หรือข้อความไทยของช่อง; ช่วงเป็นแบบปิด (min และ max รวมอยู่ด้วย) เว้นแต่ขอบที่ระบุด้วย gt / lt ซึ่งไม่รวมค่านั้น

import { msg } from "../labels/messages.th";

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export const pass = <T,>(value: T): Parsed<T> => ({ ok: true, value });
export const fail = (error: string): Parsed<never> => ({ ok: false, error });

const DECIMAL_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const INTEGER_RE = /^[+-]?\d+$/;

/**
 * ขอบเขตของเลขทศนิยม: gt = มากกว่า (ไม่รวมค่านั้น), min/max = ช่วงปิด (min อย่างเดียว = ไม่ต่ำกว่า; max อย่างเดียวไม่มีผล)
 * gt คู่กับ max = (gt, max] (Cone Half Angle) และ min คู่กับ lt = [min, lt) (Azimuth) lt อย่างเดียวไม่มีผล
 */
export interface DecimalRange {
  gt?: number;
  lt?: number;
  min?: number;
  max?: number;
}

/**
 * เลขทศนิยมจากข้อความ: ไวยากรณ์ตัวเลขชุดเดียวของทั้งแอป (Insert STK Objects ใช้ตรงนี้ และ Properties Browser: form.ts parseNumber เรียกตัวนี้)
 * ข้อความว่างไม่ใช่ตัวเลข (ผู้เรียกที่ยอมให้ว่าเป็น null ตรวจเองก่อน)
 */
export function parseDecimal(text: string, range: DecimalRange = {}): Parsed<number> {
  const trimmed = text.trim();
  if (!DECIMAL_RE.test(trimmed)) return fail(msg("props.notNumber"));
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return fail(msg("props.notFinite"));
  const { gt, lt, min, max } = range;
  if (gt !== undefined && max !== undefined) return n > gt && n <= max ? pass(n) : fail(msg("props.rangeOverUpTo", { min: gt, max }));
  if (min !== undefined && lt !== undefined) return n >= min && n < lt ? pass(n) : fail(msg("props.rangeUnder", { min, max: lt }));
  if (gt !== undefined && !(n > gt)) return fail(msg("props.rangeGreater", { min: gt }));
  if (min !== undefined && max !== undefined && (n < min || n > max)) return fail(msg("props.rangeBetween", { min, max }));
  if (min !== undefined && max === undefined && n < min) return fail(msg("props.rangeAtLeast", { min }));
  return pass(n);
}

/**
 * จำนวนเต็มที่จำกัดช่วง ("1.5", "1e3", "abc", ข้อความว่าง = ไม่ใช่จำนวนเต็ม)
 * invalid = ข้อความของค่าที่ไม่ใช่จำนวนเต็มหรือต่ำกว่า min เมื่อไม่มี max (NORAD: "ต้องเป็นจำนวนเต็มบวก")
 */
export function parseInteger(text: string, range: { min: number; max?: number }, invalid: string = msg("form.notInteger")): Parsed<number> {
  const trimmed = text.trim();
  if (!INTEGER_RE.test(trimmed)) return fail(invalid);
  const n = Number(trimmed);
  if (!Number.isSafeInteger(n)) return fail(invalid);
  if (n < range.min || (range.max !== undefined && n > range.max)) {
    return fail(range.max === undefined ? invalid : msg("props.rangeBetween", { min: range.min, max: range.max }));
  }
  return pass(n);
}
