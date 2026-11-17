// proxy /api ของ `npm run dev` (vite.config.ts): server ตอบ 403 FORBIDDEN_ORIGIN กับคำขอที่แก้ข้อมูลซึ่ง Origin ไม่ใช่ของตัวเอง
// proxy เขียน Origin ใหม่ได้เฉพาะคำขอจากหน้าเว็บของ dev server เอง ไม่งั้นเว็บใดก็ได้ที่ผู้พัฒนาเปิดอยู่ส่งฟอร์ม POST
// (ไม่มี preflight) ไปที่ http://localhost:5173/api/orbits/fetch, /api/daily/run หรือ /validate แล้วสั่งดาวน์โหลดโดยไม่ได้ยินยอม

import { describe, expect, test } from "vitest";
import { devOriginRewrite } from "../../devOrigin";

const SERVER = "http://127.0.0.1:8000";

describe("devOriginRewrite", () => {
  test("the dev page's own origin becomes the server's, on localhost and on 127.0.0.1", () => {
    expect(devOriginRewrite("http://localhost:5173", "localhost:5173", SERVER)).toBe(SERVER);
    expect(devOriginRewrite("http://127.0.0.1:5173", "127.0.0.1:5173", SERVER)).toBe(SERVER);
    expect(devOriginRewrite("http://[::1]:5173", "[::1]:5173", SERVER)).toBe(SERVER);
    expect(devOriginRewrite("http://LOCALHOST:5173", "localhost:5173", SERVER)).toBe(SERVER); // host names are not case-sensitive
  });

  test("any other site is left as it is, so the server answers 403", () => {
    for (const origin of ["https://evil.example", "http://evil.example", "http://localhost:3000", "http://127.0.0.1:8080", "null", "https://localhost:5173"])
      expect(devOriginRewrite(origin, "localhost:5173", SERVER), origin).toBeUndefined();
  });

  test("a page served under another name that only resolves to this machine (DNS rebinding) is not trusted even if Host matches", () => {
    expect(devOriginRewrite("http://evil.example:5173", "evil.example:5173", SERVER)).toBeUndefined();
    expect(devOriginRewrite("http://192.168.1.5:5173", "192.168.1.5:5173", SERVER)).toBeUndefined();
  });

  test("a request with no Origin (a plain GET, EventSource, curl) or no Host is left alone", () => {
    expect(devOriginRewrite(undefined, "localhost:5173", SERVER)).toBeUndefined();
    expect(devOriginRewrite("http://localhost:5173", undefined, SERVER)).toBeUndefined();
  });

  test("an Origin with a path or extra parts is not the page's origin", () => {
    expect(devOriginRewrite("http://localhost:5173/", "localhost:5173", SERVER)).toBeUndefined();
    expect(devOriginRewrite("http://user@localhost:5173", "localhost:5173", SERVER)).toBeUndefined();
  });
});
