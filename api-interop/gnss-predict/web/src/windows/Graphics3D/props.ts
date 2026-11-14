// ค่าตั้งของหน้าต่าง 3D แต่ละบาน (3D Graphics Window Properties, spec §9.2) เก็บใน useLayout.windowProps[panelId] จึงไปกับ workbook (W6)
// ค่าที่อ่านจาก workbook อาจขาดหรือผิดชนิด (workbook รุ่นเก่า/แก้มือ): props3d เติมค่าตั้งต้นทีละช่อง ระดับแสงเป็นเปอร์เซ็นต์ 0–100

export interface Props3D {
  /** Lighting → Enable Lighting */
  enableLighting: boolean;
  /** Lighting → Ambient Level (%) */
  ambientLevel: number;
  /** Lighting → Sun Level (%) */
  sunLevel: number;
  /** Lighting → Night Lights Level (%) */
  nightLightsLevel: number;
  /** Details → Lat/Lon Lines */
  latLonLines: boolean;
  /** Details → Label Declutter */
  labelDeclutter: boolean;
  /** Annotation → Show Time */
  showTime: boolean;
  /** Details → Satellite Models: ดาวเป็นโมเดล 3 มิติ (ปิด = จุด) */
  satelliteModels: boolean;
  /** Details → Model Pixel Size: ขนาดขั้นต่ำของโมเดลบนจอ (พิกเซล, จำนวนเต็ม 16–256) */
  modelPixelSize: number;
  /**
   * Details → Model Detail Threshold (km, จำนวนเต็ม 1,000–200,000): ดาวที่ห่างกล้องน้อยกว่านี้เป็นโมเดล ไกลกว่าเป็นจุด (ไม่วาดโมเดล:
   * ลด draw call และดาวไกลยังเห็นเป็นจุดสี) แบบ detail threshold ของ STK
   */
  modelDetailThreshold: number;
}

/** ค่าตั้งต้น: แสงปิด (ภาพสว่างทั้งโลกอ่านง่าย) เปิดแสงแล้วด้านกลางคืนสว่างครึ่งหนึ่ง แสงอาทิตย์เต็ม เวลาแสดงที่มุมภาพ */
export const DEFAULT_PROPS_3D: Readonly<Props3D> = {
  enableLighting: false,
  ambientLevel: 50,
  sunLevel: 100,
  nightLightsLevel: 50,
  latLonLines: false,
  labelDeclutter: false,
  showTime: true,
  satelliteModels: true,
  modelPixelSize: 48,
  modelDetailThreshold: 30_000,
};

export const MODEL_PIXEL_SIZE_MIN = 16;
export const MODEL_PIXEL_SIZE_MAX = 256;
export const MODEL_DETAIL_THRESHOLD_MIN_KM = 1_000;
export const MODEL_DETAIL_THRESHOLD_MAX_KM = 200_000;

const BOOLS = ["enableLighting", "latLonLines", "labelDeclutter", "showTime", "satelliteModels"] as const;
const LEVELS = ["ambientLevel", "sunLevel", "nightLightsLevel"] as const;
export type LevelKey = (typeof LEVELS)[number];

export const clampLevel = (n: number): number => Math.min(100, Math.max(0, n));

/** Model Pixel Size ที่ใช้ได้: ปัดเป็นจำนวนเต็มแล้วบีบเข้า 16–256 */
export const clampModelPixelSize = (n: number): number => Math.min(MODEL_PIXEL_SIZE_MAX, Math.max(MODEL_PIXEL_SIZE_MIN, Math.round(n)));

/** Model Detail Threshold ที่ใช้ได้ (km): ปัดเป็นจำนวนเต็มแล้วบีบเข้า 1,000–200,000 */
export const clampModelDetailThreshold = (n: number): number =>
  Math.min(MODEL_DETAIL_THRESHOLD_MAX_KM, Math.max(MODEL_DETAIL_THRESHOLD_MIN_KM, Math.round(n)));

/**
 * ค่าตั้งของหน้าต่างจากค่าที่เก็บไว้ (อะไรก็ได้) ช่องที่ขาดหรือผิดชนิดใช้ค่าตั้งต้น ระดับนอกช่วงถูกบีบเข้า 0–100 Model Pixel Size เข้า 16–256
 * Model Detail Threshold เข้า 1,000–200,000 km
 */
export function props3d(raw: unknown): Props3D {
  const src = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: Props3D = { ...DEFAULT_PROPS_3D };
  for (const k of BOOLS) if (typeof src[k] === "boolean") out[k] = src[k];
  for (const k of LEVELS) {
    const v = src[k];
    if (typeof v === "number" && Number.isFinite(v)) out[k] = clampLevel(v);
  }
  const px = src.modelPixelSize;
  if (typeof px === "number" && Number.isFinite(px)) out.modelPixelSize = clampModelPixelSize(px);
  const km = src.modelDetailThreshold;
  if (typeof km === "number" && Number.isFinite(km)) out.modelDetailThreshold = clampModelDetailThreshold(km);
  return out;
}
