// Dynamic Display (spec §6.1): หน้าต่างโหลดตารางทั้งช่วงครั้งเดียว แล้วถามค่าที่เวลาปัจจุบันจากที่นี่ทุกเฟรม (ไม่เรียก server)
// - interp ต่อคอลัมน์มาจาก element ของ /dataproviders (engine ElementInfo.interp):
//     linear   ประมาณเชิงเส้น (มุมเงย ระยะ DOP IPP Lon ฯลฯ)
//     angle    ประมาณเชิงเส้นตามทางสั้นที่สุดรอบวง 360° (Azimuth 359 → 1 ผ่าน 0 ไม่ใช่ 180)
//     previous ใช้จุดก่อนหน้า (จำนวนดวง)
//     none     ไม่ประมาณ มีค่าเฉพาะที่เวลาตรงจุด
// - angle คืนค่าในช่วงเดียวกับข้อมูล: Azimuth ของ engine อยู่ใน [0, 360) ส่วน LLA Lon อยู่ใน (-180, 180] ถ้าปลายข้างใดติดลบ
//   ผลอยู่ใน (-180, 180] ไม่งั้นอยู่ใน [0, 360) (ปลายทั้งสองอยู่ใน [0, 180] ทางสั้นที่สุดไม่ข้าม ±180 ผลจึงเหมือนกันทั้งสองแบบ)
// - เวลานอกแถวแรก–แถวสุดท้าย หรืออยู่ในช่องว่างระหว่างสองแถวที่ห่างกันเกิน maxGapMs (นอก access, ข้อมูลขาด) = null ทั้งแถว
//   ผู้เรียกส่ง maxGapMs = step ของ scenario × 1.5
// - ช่องที่ไม่ใช่ตัวเลขจำกัด (เวลา ISO, null) นับเป็นไม่มีค่า: คอลัมน์ Time ได้ null เสมอ ผู้เรียกแสดงเวลาปัจจุบันเอง

export type Interp = "linear" | "angle" | "previous" | "none";

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** มุมเข้าช่วง [0, 360) */
const wrap360 = (deg: number): number => {
  const w = ((deg % 360) + 360) % 360;
  return w === 360 ? 0 : w; // (-1e-15 % 360) + 360 ปัดเป็น 360 ได้
};

// ปลายห่างกันครึ่งวงพอดี (0 → 180) ทางสั้นที่สุดมีสองทาง: d อยู่ใน [-180, 180) จึงได้ -180 ไปทางลบ กลางทางเป็น 270 (ไม่ใช่ 90)
// ข้อมูลจริงห่างกันหนึ่ง step จึงไม่ถึงครึ่งวง ยกเว้นดาวผ่านจุดยอดฟ้าพอดี ซึ่ง Azimuth ไม่นิยามอยู่แล้ว (dynamic.test.ts ปักผลไว้)
function angleBetween(a: number, b: number, f: number): number {
  const d = wrap360(b - a + 180) - 180; // [-180, 180): ทางสั้นที่สุดจาก a ไป b
  const v = wrap360(a + f * d);
  return a < 0 || b < 0 ? (v > 180 ? v - 360 : v) : v;
}

/** ดัชนีแถวสุดท้ายใน [0, n) ที่ times[i] <= t (ไม่มี = -1) times เรียงจากน้อยไปมาก */
function floorIndex(times: readonly number[], n: number, t: number): number {
  let lo = 0;
  let hi = n - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/**
 * ค่าทุกคอลัมน์ที่เวลา t (ms ตั้งแต่ epoch) จาก rows ที่ times[i] คือเวลาของ rows[i] (เรียงจากน้อยไปมาก)
 * interps[c] คือวิธีของคอลัมน์ c (ขาด = none) คืน null เมื่อ t อยู่นอกตารางหรือในช่องว่างที่ยาวเกิน maxGapMs
 */
export function valueAt(
  rows: readonly (readonly unknown[])[],
  times: readonly number[],
  t: number,
  interps: readonly Interp[],
  maxGapMs: number,
): (number | null)[] | null {
  const n = Math.min(rows.length, times.length);
  if (n === 0 || !Number.isFinite(t)) return null;
  const i = floorIndex(times, n, t);
  if (i < 0) return null;
  const a = rows[i];
  if (times[i] === t) return a.map(num);
  if (i === n - 1) return null;
  const t0 = times[i];
  const t1 = times[i + 1];
  if (!(t1 - t0 <= maxGapMs)) return null; // เขียนแบบ !(<=): maxGapMs ที่เป็น NaN นับเป็นช่องว่าง (ไม่ลากข้าม)
  const b = rows[i + 1];
  const f = (t - t0) / (t1 - t0);
  const width = Math.max(a.length, b.length);
  const out: (number | null)[] = [];
  for (let c = 0; c < width; c++) {
    const interp = interps[c] ?? "none";
    const va = num(a[c]);
    if (interp === "previous") {
      out.push(va);
      continue;
    }
    const vb = num(b[c]);
    if (interp === "none" || va === null || vb === null) out.push(null);
    else if (interp === "angle") out.push(angleBetween(va, vb, f));
    else out.push(va + f * (vb - va));
  }
  return out;
}
