// แปลงข้อความเวลา (ช่อง Current Scenario Time) และเวลา ISO ของ API เป็น Date โดยไม่ขึ้นกับ timezone ของเครื่อง

import { MONTHS, MS_PER_DAY, daysFromCivil, daysInMonth, parseOffset, type DateFormat } from "./format";

// W17: วัน 1–2 หลัก, เดือนอังกฤษ 3 ตัว (ไม่สนตัวพิมพ์), เวลา hh:mm:ss, ทศนิยมวินาที 0–3 หลัก,
// ท้ายใส่ UTCG หรือ LTZG[±hh:mm] หรือไม่ใส่ก็ได้
const TEXT_RE = /^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s+(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(?:\s+(UTCG|LTZG)([+-]\d{2}:\d{2})?)?$/i;

const MONTH_INDEX = new Map<string, number>(MONTHS.map((name, i) => [name.toLowerCase(), i + 1]));

function toDate(y: number, mo: number, d: number, hh: number, mi: number, ss: number, ms: number, offsetMin: number): Date | null {
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo) || hh > 23 || mi > 59 || ss > 59) return null;
  const local = daysFromCivil(y, mo, d) * MS_PER_DAY + ((hh * 60 + mi) * 60 + ss) * 1000 + ms;
  return new Date(local - offsetMin * 60_000);
}

/**
 * ข้อความ → Date (UTC) ตาม DateFormat ปัจจุบัน แปลงไม่ได้ → null
 * ท้ายข้อความต้องไม่ใช่รูปแบบอีกแบบ; LTZG ที่มี offset ในข้อความใช้ offset นั้น ไม่มีใช้ `ltzOffset` (units.ltz_offset)
 */
export function parseTime(text: string, fmt: DateFormat, ltzOffset: string): Date | null {
  const m = TEXT_RE.exec(text.trim());
  if (!m) return null;
  const month = MONTH_INDEX.get(m[2].toLowerCase());
  if (month === undefined) return null;
  const suffix = m[8]?.toUpperCase();
  const textOffset = m[9];
  if (suffix !== undefined && suffix !== fmt) return null;
  if (fmt === "UTCG" && textOffset !== undefined) return null;
  let offsetMin = 0;
  if (fmt === "LTZG") {
    const parsed = parseOffset(textOffset ?? ltzOffset);
    if (parsed === null) return null;
    offsetMin = parsed;
  }
  const ms = m[7] === undefined ? 0 : Number(m[7].padEnd(3, "0"));
  return toDate(Number(m[3]), month, Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6]), ms, offsetMin);
}

// ISO 8601 date-time ลงท้าย Z หรือ ±hh:mm (engine รับทั้งสองแบบ: scenario.py _parse_time) มีหรือไม่มีเศษวินาทีก็ได้
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:Z|([+-]\d{2}:\d{2}))$/;

/**
 * เวลา ISO 8601 ของ API → Date (UTC): ลงท้าย `Z` หรือ `±hh:mm` (แปลง offset เป็น UTC) มีหรือไม่มีมิลลิวินาที
 * ไม่ระบุเขตเวลา, offset ผิดรูป (hh 00–23, mm 00–59) หรือส่วนที่ไม่มีจริง (เดือน 13, วัน 32, ชั่วโมง 24 ฯลฯ) → null
 */
export function parseIsoUtc(text: string): Date | null {
  const m = ISO_RE.exec(text);
  if (!m) return null;
  const offsetMin = m[8] === undefined ? 0 : parseOffset(m[8]);
  if (offsetMin === null) return null;
  const ms = m[7] === undefined ? 0 : Number(m[7].slice(0, 3).padEnd(3, "0"));
  return toDate(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]), ms, offsetMin);
}
