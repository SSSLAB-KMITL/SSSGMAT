// ตัวช่วยของ jsdom ที่ทุก test ใช้ร่วมกัน (vite.config.ts: test.setupFiles)

import { afterEach } from "vitest";
import { failOnReportedErrors, recordReportedError } from "./helpers/reported-errors";

// jsdom ไม่มี ResizeObserver ซึ่ง dockview ใช้ตามขนาดของ container: ตัวปลอมนี้เรียก callback ครั้งเดียวตอน observe
// (jsdom ไม่มี layout จริง ขนาดที่ส่งเป็นค่าสมมติ) test ที่ต้องการขนาดอื่นสั่ง `api.layout(w, h, true)` เอง

class FakeResizeObserver implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: Element): void {
    const rect = { x: 0, y: 0, top: 0, left: 0, right: 1000, bottom: 700, width: 1000, height: 700, toJSON: () => ({}) };
    const size = [{ inlineSize: 1000, blockSize: 700 }];
    const entry = { target, contentRect: rect, borderBoxSize: size, contentBoxSize: size, devicePixelContentBoxSize: size };
    this.callback([entry as unknown as ResizeObserverEntry], this);
  }

  unobserve(): void {}
  disconnect(): void {}
}

if (typeof globalThis.ResizeObserver === "undefined") globalThis.ResizeObserver = FakeResizeObserver;

// jsdom ไม่มี canvas จริง: getContext ของมันพิมพ์ "Not implemented" ทุกครั้งแล้วคืน null หน้าต่างที่วาดด้วย canvas (Timeline View) ข้ามการวาดเมื่อได้ null
// ตัวนี้ทำให้เงียบ test ที่ต้องดูการวาดสั่ง vi.spyOn(HTMLCanvasElement.prototype, "getContext") เอง
if (typeof HTMLCanvasElement !== "undefined") HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;

// error boundary ของแอปส่งข้อผิดพลาดที่จับได้ให้ window.reportError (เหมือนข้อผิดพลาดที่ไม่ถูกจับ): หน้าต่างหรือแถบที่พังตอนวาด
// ต้องทำให้ test ล้มเหลว ไม่ใช่ผ่านไปเงียบ ๆ เพราะ boundary แสดงข้อความแทน test ที่ตั้งใจทำให้พังเรียก takeReportedErrors() ไปตรวจเอง
if (typeof window !== "undefined") window.reportError = recordReportedError;
afterEach(() => failOnReportedErrors());

// ไฟล์โมเดล 3 มิติ (/models/...: catalog.json และ glb) ห้ามออกเครือข่ายใน unit test: หน้าต่าง 3D ที่ mount จริงขอ catalog เองตอน restyle
// fetch ของ /models ที่ test ไม่ได้ stub เอง (vi.stubGlobal("fetch", …) แทนตัวนี้) ได้ promise ที่ไม่มีวันเสร็จ = ดาวเป็นจุดตลอด ไม่มีข้อความเตือน
// URL อื่นผ่านไปที่ fetch เดิม vi.unstubAllGlobals คืนมาที่ตัวนี้ (ตั้งตรง ๆ ก่อน test ใด stub)
const passFetch = globalThis.fetch;
const MODELS_PATH = /^\/models(\/|$)/;

function requestPath(input: RequestInfo | URL): string | null {
  const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  try {
    return new URL(href, "http://localhost").pathname;
  } catch {
    return null;
  }
}

globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const path = requestPath(input);
  if (path !== null && MODELS_PATH.test(path)) return new Promise<Response>(() => undefined);
  return passFetch(input, init);
}) as typeof fetch;
