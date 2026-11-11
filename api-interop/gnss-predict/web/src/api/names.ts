// กติกาชื่อ object และ scenario ของ server (schema.NAME_PATTERN): A-Z a-z 0-9 _ - ยาว 1-32 ตัว
// ใช้ตรวจก่อนส่งในทุกช่องที่ตั้งชื่อ (สร้าง/เปลี่ยนชื่อ object, Save As, Wizard, Insert, Daily Forecast Settings) ให้ตรงกับที่ server ตรวจ

export const NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

export const isObjectName = (name: string): boolean => NAME_PATTERN.test(name);
