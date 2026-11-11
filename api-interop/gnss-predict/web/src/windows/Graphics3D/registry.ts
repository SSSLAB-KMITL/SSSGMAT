// หน้าต่าง 3D ที่เปิดอยู่ (ไม่ import Cesium: คำสั่ง แถบเครื่องมือ และ window.__gnssStudioTest อยู่ใน bundle หลัก ส่วน Cesium โหลดทีหลังกับหน้าต่าง)
//
// - Graphics3D ลงทะเบียน Scene3DHandle ของตัวเองเมื่อ viewer พร้อม และถอนเมื่อปิด
// - "หน้าต่าง 3D ที่ active" (คำสั่ง g3d.* และ object.zoomTo ทำกับมัน): panel ที่ dockview บอกว่า active ถ้าเป็นหน้าต่าง 3D,
//   ไม่งั้นหน้าต่าง 3D ที่ผู้ใช้แตะล่าสุด (markActive), ไม่งั้นบานแรกที่เปิด
// - "viewer 3D ตัวแรก" ของ test hook: หน้าต่าง id `graphics3d` (บานแรกของ layout ตั้งต้น) ถ้าเปิดอยู่ ไม่งั้นบานที่เปิดก่อนสุด
// - ทะเบียนเป็น observable (subscribeScenes) ให้คำสั่งและปุ่มวาดสถานะใหม่เมื่อหน้าต่างเปิด/ปิดหรือโหมดเมาส์เปลี่ยน

import { useLayout } from "../../stores/layout";

export type MouseMode = "grab" | "zoomIn";
export type ReferenceFrame = "fixed" | "inertial";

export interface ViewFromToRequest {
  /** path ของ object ต้นทาง (Facility หรือ Satellite) */
  from: string;
  /** path ของ object ที่มองไปหา */
  to: string;
  frame: ReferenceFrame;
}

export interface Scene3DHandle {
  readonly panelId: string;
  /** Home View: มองโลกจากระยะ 4.5 รัศมีโลก */
  homeView(): void;
  /** Zoom To: กล้องตามไปที่ object (path) คืน false ถ้าไม่มี entity ของ object นั้นในภาพ */
  zoomTo(path: string): boolean;
  /** View From/To: กล้องอยู่ที่ from มองไปที่ to (ตามไปเมื่อเวลาเดิน) คืน false ถ้าหา entity ไม่เจอ */
  viewFromTo(req: ViewFromToRequest): boolean;
  /** Grab Globe = ลากหมุนโลก, Zoom In = ลากกรอบเพื่อซูม (คลิกเฉย ๆ ซูมเข้าครึ่งหนึ่ง) */
  mouseMode(): MouseMode;
  setMouseMode(mode: MouseMode): void;
  /** panel เปลี่ยนขนาดหรือกลับมาแสดง */
  resize(): void;
  /** ทำลาย viewer และ data source ทั้งหมด */
  destroy(): void;
  // window.__gnssStudioTest (W19): name = ชื่อ object ใน scenario
  entityPositionEcef(name: string, iso?: string): [number, number, number] | null;
  entityColor(name: string): string | null;
  labelShown(name: string): boolean | null;
  frameCount(): number;
}

const scenes = new Map<string, Scene3DHandle>();
const listeners = new Set<() => void>();
let lastActive: string | null = null;
let loadedAt: number | null = null;
let version = 0;

/** แจ้งผู้ฟังว่าชุดหน้าต่างหรือสถานะของหน้าต่าง (โหมดเมาส์) เปลี่ยน */
export function notifyScenes(): void {
  version++;
  for (const l of [...listeners]) l();
}

/** ลงทะเบียนหน้าต่าง 3D คืนตัวถอนที่ถอนเฉพาะเมื่อยังเป็น handle ตัวนี้ */
export function registerScene(handle: Scene3DHandle): () => void {
  scenes.set(handle.panelId, handle);
  notifyScenes();
  return () => {
    if (scenes.get(handle.panelId) !== handle) return;
    scenes.delete(handle.panelId);
    if (lastActive === handle.panelId) lastActive = null;
    notifyScenes();
  };
}

export const getScene = (panelId: string): Scene3DHandle | undefined => scenes.get(panelId);

/** ผู้ใช้แตะหน้าต่าง 3D นี้ (คลิก โฟกัส): เป็นบานที่คำสั่งทำงานด้วยเมื่อ dockview ไม่ได้ชี้หน้าต่าง 3D */
export function markActive(panelId: string): void {
  if (lastActive === panelId) return;
  lastActive = panelId;
  notifyScenes();
}

export function activeScene(): Scene3DHandle | undefined {
  const active = useLayout.getState().api?.activePanel?.id;
  if (active !== undefined && scenes.has(active)) return scenes.get(active);
  if (lastActive !== null && scenes.has(lastActive)) return scenes.get(lastActive);
  return scenes.values().next().value;
}

export function firstScene(): Scene3DHandle | undefined {
  return scenes.get("graphics3d") ?? scenes.values().next().value;
}

/** เวลา (performance.now) ที่ scene.czml โหลดเสร็จครั้งแรกในหน้านี้ */
export function noteSceneLoaded(at: number = performance.now()): void {
  if (loadedAt === null) loadedAt = at;
}
export const sceneLoadedAt = (): number | null => loadedAt;

export function subscribeScenes(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export const scenesVersion = (): number => version;

/** ล้างทะเบียน (test) */
export function resetScenes(): void {
  scenes.clear();
  lastActive = null;
  loadedAt = null;
  notifyScenes();
}
