// กติกาชื่อ object และ scenario ของ server (schema.NAME_PATTERN): A-Z a-z 0-9 _ - ยาว 1-32 ตัว
// ใช้ตรวจก่อนส่งในทุกช่องที่ตั้งชื่อ (สร้าง/เปลี่ยนชื่อ object, Save As, Wizard, Insert, Daily Forecast Settings) ให้ตรงกับที่ server ตรวจ

export const NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

export const isObjectName = (name: string): boolean => NAME_PATTERN.test(name);

/**
 * ชื่อ `<prefix><n>` ตัวแรกที่ว่าง (n เริ่มที่ 1) เทียบแบบไม่สนตัวพิมพ์เล็กใหญ่เหมือน server (ชื่อ object ไม่ซ้ำกันทั้ง scenario ทุก class)
 * Insert Default และกล่อง Define Properties ของ Sensor ใช้ตั้งชื่อตั้งต้น (Sensor1, Sensor2, ...)
 */
export function firstFreeName(prefix: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((name) => name.toLowerCase()));
  let n = 1;
  while (used.has(`${prefix}${n}`.toLowerCase())) n += 1;
  return `${prefix}${n}`;
}
