// ตัวช่วยของ jsdom ที่ทุก test ใช้ร่วมกัน (vite.config.ts: test.setupFiles)
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
