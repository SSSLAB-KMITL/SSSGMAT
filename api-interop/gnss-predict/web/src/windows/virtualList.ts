// ตัววัดพื้นที่เห็นของ virtual list (TanStack Virtual) ที่ Object Browser และ Message Viewer ใช้ร่วมกัน
//
// เหมือนตัววัดมาตรฐานของ TanStack Virtual (clientWidth/clientHeight และตามเมื่อขนาดเปลี่ยน) ต่างตรงที่ขนาด 0 ใช้ขนาดสำรอง
// (วัดได้ 0: ยังไม่มี layout เช่นหน้าต่างเพิ่งสร้าง หรือ jsdom) ไม่งั้นรายการว่างทั้งที่มีแถว: แถวที่เกินพื้นที่จริงถูกตัดโดย overflow อยู่แล้ว
// และเมื่อวัดได้จริงค่านั้นแทนที่ทันที

import type { Rect, Virtualizer } from "@tanstack/react-virtual";

export function observeViewportWithFallback(fallback: Rect) {
  return function observeViewport(instance: Virtualizer<HTMLDivElement, Element>, cb: (rect: Rect) => void): (() => void) | void {
    const element = instance.scrollElement;
    const view = instance.targetWindow;
    if (element === null || view === null) return;
    const measure = (): void => cb(element.clientHeight > 0 ? { width: element.clientWidth, height: element.clientHeight } : fallback);
    measure();
    if (!view.ResizeObserver) return;
    const observer = new view.ResizeObserver(measure);
    observer.observe(element, { box: "content-box" });
    return () => observer.unobserve(element);
  };
}
