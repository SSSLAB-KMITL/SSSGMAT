// ค่าตั้งของหน้าต่าง 2D แต่ละบาน (2D Graphics Window Properties, spec §9.3) เก็บใน useLayout.windowProps[panelId] จึงไปกับ workbook (W6)
// ค่าที่อ่านจาก workbook อาจขาดหรือผิดชนิด: props2d เติมค่าตั้งต้นทีละช่อง
// Display Coordinate Frame มีแค่ ECF ใน v1 จึงไม่เก็บ

/** Projection: Equidistant Cylindrical = GeographicProjection, Mercator = WebMercatorProjection ของ Cesium */
export const PROJECTIONS = ["equidistantCylindrical", "mercator"] as const;
export type Projection2D = (typeof PROJECTIONS)[number];

export interface Props2D {
  /** Projection */
  projection: Projection2D;
  /** Details → Lat/Lon Lines */
  latLonLines: boolean;
  /** Details → Show IPP (ของเราเอง) */
  showIpp: boolean;
  /** Lighting → Show Outline (เส้นแบ่งกลางวันกลางคืน) */
  showOutline: boolean;
  /** Lighting → Shading (พื้นที่กลางคืน) */
  shading: boolean;
  /**
   * Details → Show Ground Tracks (ของเราเอง, task 13c): ปิด = หน้าต่างนี้ไม่วาด ground track ของดาวดวงใดเลย ไม่แตะค่า Pass ของ object
   * เปิด = ตามหน้า 2D Graphics - Pass ของแต่ละ object ตามเดิม
   */
  showGroundTracks: boolean;
}

/** ค่าตั้งต้น: แผนที่ Equidistant Cylindrical มีเส้น Lat/Lon แบบแผนที่ 2D ของ STK แสงและ IPP ปิด ground track แสดง */
export const DEFAULT_PROPS_2D: Readonly<Props2D> = {
  projection: "equidistantCylindrical",
  latLonLines: true,
  showIpp: false,
  showOutline: false,
  shading: false,
  showGroundTracks: true,
};

const BOOLS = ["latLonLines", "showIpp", "showOutline", "shading", "showGroundTracks"] as const;

export const isProjection = (x: unknown): x is Projection2D => typeof x === "string" && (PROJECTIONS as readonly string[]).includes(x);

/** ค่าตั้งของหน้าต่างจากค่าที่เก็บไว้ (อะไรก็ได้) ช่องที่ขาดหรือผิดชนิดใช้ค่าตั้งต้น */
export function props2d(raw: unknown): Props2D {
  const src = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: Props2D = { ...DEFAULT_PROPS_2D };
  if (isProjection(src.projection)) out.projection = src.projection;
  for (const k of BOOLS) if (typeof src[k] === "boolean") out[k] = src[k];
  return out;
}
