// ล้อเมาส์ → ขั้นซูมของ Sensor View (imagery spec §5.3) ส่วนที่ไม่แตะ DOM: นาฬิกาและความสูงหน้าต่างฉีดเข้ามา (test ฉีดได้)
//
// trackpad ของ macOS ส่งเหตุการณ์ล้อหลายสิบครั้งต่อการปัดนิ้วหนึ่งครั้ง (deltaY ไม่กี่พิกเซลต่อครั้ง ต่อด้วย momentum) ส่วนล้อเมาส์ส่งครั้งละรอย (~100 px)
// นับทีละเหตุการณ์ = ปัดนิ้วครั้งเดียวกระโดดจาก ×1 ไปสุดทาง (ปลายทางคือ ×262144: ZOOM_GRID ใน zoom.ts ขั้นละ ×√2) จึงสะสมแทน:
// - deltaY แปลงเป็นพิกเซล: deltaMode 0 = พิกเซล, 1 = บรรทัด × LINE_PX, 2 = หน้า × ความสูงหน้าต่าง
//   โหมดบรรทัดและหน้ามาจากล้อที่มีรอย (Firefox ส่ง 3 บรรทัด = 99 px ต่อรอย) จึงนับอย่างน้อย STEP_PX ต่อเหตุการณ์: หนึ่งรอยเป็นหนึ่งขั้นเสมอ
// - สะสมครบ STEP_PX = หนึ่งขั้น (deltaY < 0 = เข้า +1, > 0 = ออก −1) แล้วเริ่มนับใหม่ ไม่เกินหนึ่งขั้นต่อ STEP_INTERVAL_MS
// - เงียบเกิน IDLE_RESET_MS = ทิ้งยอดที่สะสมไว้ (การเลื่อนเล็ก ๆ ที่ห่างกันไม่รวมกันเป็นขั้น) และจบ "การปัดหนึ่งครั้ง" (gesture)
// - ไม่เกิน MAX_STEPS_PER_GESTURE ขั้นต่อการปัดหนึ่งครั้ง: momentum ของ macOS ส่งเหตุการณ์ต่อเนื่องราว 1–2 วินาทีหลังปล่อยนิ้ว
//   (ไม่มีช่วงเงียบ จึงเป็นการปัดเดียวกัน) ถ้าไม่จำกัด ปัดครั้งเดียวได้ราว 10 ขั้น ; สองขั้น ×√2 = ×2 ต่อการปัด ; ล้อเมาส์ที่หมุนทีละรอยห่างกันเกิน
//   IDLE_RESET_MS ได้ขั้นละรอยเท่าเดิม ส่วนการหมุนล้อรัวต่อเนื่องก็ถูกจำกัดเช่นกัน (ปุ่ม Zoom In / Zoom Out ยังกดทีละขั้นได้เสมอ)
// - pinch บน trackpad (ctrlKey + ล้อ) ผ่านทางเดียวกัน ผู้เรียกไม่แยก; Shift + ล้อเป็นของ Step Forward / Backward ผู้เรียกไม่ส่งมา

export const LINE_PX = 33;
export const STEP_PX = 100;
export const STEP_INTERVAL_MS = 150;
export const IDLE_RESET_MS = 200;
export const MAX_STEPS_PER_GESTURE = 2;

export interface WheelInput {
  deltaY: number;
  deltaMode: number;
}

export interface WheelZoom {
  /** เหตุการณ์ล้อหนึ่งครั้ง → ขั้นซูม: +1 เข้า, −1 ออก, 0 ยังไม่ถึงขั้น */
  step(e: WheelInput): -1 | 0 | 1;
}

export function createWheelZoom(opts: { now: () => number; pageHeight: () => number }): WheelZoom {
  let sum = 0;
  let lastEvent = Number.NEGATIVE_INFINITY;
  let lastStep = Number.NEGATIVE_INFINITY;
  /** ขั้นที่ให้ไปแล้วในการปัดครั้งนี้ */
  let gestureSteps = 0;
  return {
    step({ deltaY, deltaMode }) {
      const t = opts.now();
      if (t - lastEvent > IDLE_RESET_MS) {
        sum = 0;
        gestureSteps = 0;
      }
      lastEvent = t;
      if (gestureSteps >= MAX_STEPS_PER_GESTURE) return 0;
      if (!Number.isFinite(deltaY) || deltaY === 0) return 0;
      let px = deltaY;
      if (deltaMode === 1 || deltaMode === 2) {
        px *= deltaMode === 1 ? LINE_PX : opts.pageHeight();
        if (Math.abs(px) < STEP_PX) px = Math.sign(deltaY) * STEP_PX;
      }
      sum += px;
      if (Math.abs(sum) < STEP_PX || t - lastStep < STEP_INTERVAL_MS) return 0;
      const dir = sum < 0 ? 1 : -1;
      sum = 0;
      lastStep = t;
      gestureSteps++;
      return dir;
    },
  };
}
