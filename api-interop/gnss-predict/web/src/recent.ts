// รายการ scenario ที่เปิดล่าสุด (W5): เก็บใน localStorage `gnss-studio.recent` สูงสุด 4 ชื่อ ใหม่สุดอยู่บนสุด ไม่ซ้ำ
//
// - อ่านและเขียนทุกครั้งผ่าน try/catch: localStorage ถูกปิด (private window, นโยบายของ browser) หรือข้อมูลในนั้นเสีย = รายการว่าง ไม่โยน
// - ชื่อต่างกันแค่ตัวพิมพ์เป็น scenario เดียวกัน (server ไม่แยกตัวพิมพ์เล็กใหญ่) เก็บตัวสะกดที่เปิดล่าสุด
// - subscribe ให้เมนู File → รายการล่าสุด ลงทะเบียนคำสั่งตามรายการ (chrome/fileCommands.ts)

export const RECENT_KEY = "gnss-studio.recent";
export const RECENT_MAX = 4;

const listeners = new Set<() => void>();

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null; // เข้าถึง localStorage เองก็โยนได้ (SecurityError)
  }
}

const sameName = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** ชื่อที่ใช้ได้ในข้อมูลดิบ: สตริงไม่ว่าง ไม่ซ้ำ ไม่เกิน RECENT_MAX */
function clean(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item === "string" && item !== "" && !out.some((x) => sameName(x, item))) out.push(item);
  }
  return out.slice(0, RECENT_MAX);
}

/** ชื่อ scenario ล่าสุด ใหม่สุดก่อน; อ่านไม่ได้ = [] */
export function list(): string[] {
  try {
    const text = storage()?.getItem(RECENT_KEY);
    return text === null || text === undefined ? [] : clean(JSON.parse(text));
  } catch {
    return [];
  }
}

/** จดว่าเพิ่งเปิดชื่อนี้ (ขึ้นบนสุด ถ้ามีอยู่แล้วย้ายขึ้น) เขียนไม่ได้ = ข้าม */
export function push(name: string): void {
  const next = clean([name, ...list()]);
  try {
    storage()?.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // เต็มหรือถูกปิด: ไม่จำรายการ แต่การเปิด scenario ไม่เสีย
  }
  for (const listener of [...listeners]) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const recent = { list, push, subscribe };
