// รูปแบบเวลา UTCG / LTZG ของ STK (spec §6.2)
// ปฏิทินและ offset คิดจากมิลลิวินาที UTC เองทั้งหมด ไม่เรียก getHours/toLocale* จึงไม่ขึ้นกับ timezone ของเครื่อง

export type DateFormat = "UTCG" | "LTZG";

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export const MS_PER_DAY = 86_400_000;

export interface Civil {
  y: number;
  /** 1–12 */
  m: number;
  /** 1–31 */
  d: number;
}

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, m: number): number {
  return m === 2 ? (isLeapYear(y) ? 29 : 28) : [4, 6, 9, 11].includes(m) ? 30 : 31;
}

/** จำนวนวันนับจาก 1970-01-01 ของวันที่ปฏิทินเกรกอเรียนแบบ proleptic (อัลกอริทึม days_from_civil ของ Howard Hinnant) */
export function daysFromCivil(y: number, m: number, d: number): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146_097 + doe - 719_468;
}

/** ตรงข้ามของ daysFromCivil (civil_from_days) */
export function civilFromDays(days: number): Civil {
  const z = days + 719_468;
  const era = Math.floor(z / 146_097);
  const doe = z - era * 146_097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36_524) - Math.floor(doe / 146_096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const m = mp < 10 ? mp + 3 : mp - 9;
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
  return { y, m, d: doy - Math.floor((153 * mp + 2) / 5) + 1 };
}

const OFFSET_RE = /^([+-])(\d{2}):(\d{2})$/;

/** `±hh:mm` → นาทีทางตะวันออกของ UTC (hh 00–23, mm 00–59) ไม่ถูกรูปแบบ → null */
export function parseOffset(text: string): number | null {
  const m = OFFSET_RE.exec(text);
  if (!m) return null;
  const hh = Number(m[2]);
  const mm = Number(m[3]);
  if (hh > 23 || mm > 59) return null;
  return (m[1] === "-" ? -1 : 1) * (hh * 60 + mm) || 0; // `|| 0` กัน -0
}

const pad = (n: number, width: number) => String(n).padStart(width, "0");

/**
 * `1 Jan 2026 16:00:00.000 UTCG` หรือ `12 Nov 2026 14:00:00.000 LTZG+07:00`
 * Date ที่ใช้ไม่ได้ให้ "Invalid Date"; LTZG ที่ offset เพี้ยน (server รับสตริงอะไรก็ได้) แสดงเป็น UTCG แทนการล่ม
 * ซึ่งป้ายท้ายบอกชัดว่าเป็น UTC
 */
export function formatTime(d: Date, fmt: DateFormat, ltzOffset: string): string {
  const t = d.getTime();
  if (!Number.isFinite(t)) return "Invalid Date";
  const offsetMin = fmt === "LTZG" ? parseOffset(ltzOffset) : null;
  const local = t + (offsetMin ?? 0) * 60_000;
  const days = Math.floor(local / MS_PER_DAY);
  const msOfDay = local - days * MS_PER_DAY;
  const { y, m, d: day } = civilFromDays(days);
  const hh = Math.floor(msOfDay / 3_600_000);
  const mi = Math.floor(msOfDay / 60_000) % 60;
  const ss = Math.floor(msOfDay / 1000) % 60;
  const ms = msOfDay % 1000;
  const suffix = offsetMin === null ? "UTCG" : `LTZG${ltzOffset}`;
  return `${day} ${MONTHS[m - 1]} ${pad(y, 4)} ${pad(hh, 2)}:${pad(mi, 2)}:${pad(ss, 2)}.${pad(ms, 3)} ${suffix}`;
}
