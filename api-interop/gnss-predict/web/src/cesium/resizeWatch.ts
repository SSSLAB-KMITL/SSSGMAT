// ฟังขนาดจริงของ element ที่ viewer ของ Cesium อยู่ (QA-01, docs/2026-11-17-qa01-2d-black-after-sensor-view.md) ใช้กับ viewer ทุกตัว: 3D, 2D และ Sensor View
//
// - ResizeObserver บน element ของ viewer: ขนาดเปลี่ยน = viewer.resize() (afterResize ถ้ามี) แล้ว scene.requestRender()
//   รวมการเปลี่ยนหลายครั้งในเฟรมเดียวเป็นครั้งเดียวในเฟรมถัดไป (requestAnimationFrame)
// - เหตุ: canvas ที่เปลี่ยนขนาดถูกล้าง buffer (preserveDrawingBuffer = false) และ requestRenderMode วาดเฉพาะเมื่อมีคนขอ
//   onDidDimensionsChange ของ Dockview (usePanelResize) ยิงตามขนาดของ panel ซึ่งอาจมาก่อน CSS layout ของหน้าต่างนิ่ง ตัวนี้จึงไม่พึ่งมัน
//   (render loop ของ Cesium เองก็ตรวจ clientWidth/clientHeight ทุกเฟรม ตัวนี้เป็นตัวกันอีกชั้นที่ไม่ขึ้นกับรายละเอียดภายในของ Cesium)
// - ตัวที่คืนให้ = เลิกฟังและยกเลิกเฟรมที่ค้าง (เรียกก่อน destroyViewer) browser ที่ไม่มี ResizeObserver = ไม่ฟัง
// ไฟล์นี้ไม่ import Cesium

/** ส่วนของ Viewer ที่ใช้ (test ส่งตัวปลอมได้) */
export interface ResizeTarget {
  resize(): void;
  readonly scene: { requestRender(): void };
}

/** สิ่งที่ใช้จาก browser (test ส่งตัวปลอมได้) */
export interface ResizeEnv {
  ResizeObserver: typeof ResizeObserver | undefined;
  requestFrame(cb: FrameRequestCallback): number;
  cancelFrame(id: number): void;
}

function browserEnv(el: Element): ResizeEnv {
  const view = el.ownerDocument.defaultView ?? globalThis;
  return {
    ResizeObserver: view.ResizeObserver,
    requestFrame: (cb) => view.requestAnimationFrame(cb),
    cancelFrame: (id) => view.cancelAnimationFrame(id),
  };
}

export function watchResize(el: Element, viewer: ResizeTarget, afterResize?: () => void, env: ResizeEnv = browserEnv(el)): () => void {
  const Observer = env.ResizeObserver;
  if (Observer === undefined) return () => undefined;
  let frame: number | null = null;
  let stopped = false;
  const redraw = (): void => {
    frame = null;
    if (stopped) return;
    viewer.resize();
    afterResize?.();
    viewer.scene.requestRender();
  };
  const observer = new Observer(() => {
    if (stopped || frame !== null) return;
    frame = env.requestFrame(redraw);
  });
  observer.observe(el);
  return () => {
    if (stopped) return;
    stopped = true;
    observer.disconnect();
    if (frame !== null) env.cancelFrame(frame);
    frame = null;
  };
}
