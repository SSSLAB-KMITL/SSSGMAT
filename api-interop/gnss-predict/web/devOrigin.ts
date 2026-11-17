// การเขียน header Origin ใหม่ของ proxy /api ตอน `npm run dev` (vite.config.ts ใช้; tests/unit/dev-origin.test.ts ตรวจ)
//
// server ตอบ 403 FORBIDDEN_ORIGIN กับคำขอ POST/PUT/PATCH/DELETE ที่ Origin ไม่ใช่ของตัวเอง (server/gnss_studio_server/guard.py)
// หน้าเว็บของ dev server อยู่คนละ port (เช่น http://localhost:5173) จึงต้องเขียน Origin ของมันใหม่เป็นของ server
// แต่เขียนใหม่เฉพาะคำขอที่ Origin คือหน้าเว็บของ dev server เองเท่านั้น (http://<Host ของคำขอ> และ Host เป็นชื่อ loopback)
// Origin อื่นทั้งหมดผ่านไปตามเดิมให้ server ตอบ 403: ไม่งั้นเว็บใดก็ได้ที่ผู้พัฒนาเปิดอยู่ส่งฟอร์ม POST (ไม่มี preflight) ไปที่
// http://localhost:5173/api/orbits/fetch, /api/daily/run หรือ /api/scenarios/{sc}/validate แล้วสั่งดาวน์โหลดโดยไม่ได้ยินยอม
// ชื่อ loopback เท่านั้น: หน้าเว็บที่เปิดผ่านชื่ออื่นที่ชี้มาที่เครื่องนี้ (DNS rebinding) ส่ง Host กับ Origin ที่ตรงกันได้ จึงไม่นับ

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Origin ใหม่ที่ proxy ต้องใส่ (= serverOrigin) หรือ undefined = ไม่แตะ header (ไม่มี Origin หรือไม่ใช่หน้าเว็บของ dev server เอง) */
export function devOriginRewrite(origin: string | undefined, host: string | undefined, serverOrigin: string): string | undefined {
  if (origin === undefined || host === undefined) return undefined;
  const own = `http://${host}`.toLowerCase();
  if (origin.trim().toLowerCase() !== own) return undefined;
  let hostname: string;
  try {
    hostname = new URL(own).hostname;
  } catch {
    return undefined;
  }
  return LOOPBACK_HOSTS.has(hostname) ? serverOrigin : undefined;
}
