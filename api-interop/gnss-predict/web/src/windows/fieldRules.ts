// อ่านตัวเลขจากข้อความในช่องกรอก (Insert STK Objects, Daily Forecast Settings) ตามกติกาเดียวกับ schema ของ server
// ผลเป็นค่า หรือข้อความไทยของช่อง; ช่วงเป็นแบบปิด (min และ max รวมอยู่ด้วย)

import { msg } from "../labels/messages.th";

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const pass = <T,>(value: T): Parsed<T> => ({ ok: true, value });
const fail = (error: string): Parsed<never> => ({ ok: false, error });

const DECIMAL_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const INTEGER_RE = /^[+-]?\d+$/;

/** เลขทศนิยม (ไม่ใส่ range = ไม่จำกัดช่วง); ข้อความว่างไม่ใช่ตัวเลข */
export function parseDecimal(text: string, range?: { min: number; max: number }): Parsed<number> {
  const trimmed = text.trim();
  if (!DECIMAL_RE.test(trimmed)) return fail(msg("props.notNumber"));
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return fail(msg("props.notFinite"));
  if (range !== undefined && (n < range.min || n > range.max)) return fail(msg("props.rangeBetween", range));
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
