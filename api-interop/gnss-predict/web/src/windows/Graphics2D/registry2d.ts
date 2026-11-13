// หน้าต่าง 2D ที่เปิดอยู่ (ไม่ import Cesium) ทะเบียนแบบทั่วไปของ graphics/sceneRegistry.ts
// - "หน้าต่าง 2D ที่ active" (คำสั่ง g2d.* ของแถบ 2D Window Defaults ทำกับมัน): panel ที่ dockview บอกว่า active ถ้าเป็นหน้าต่าง 2D,
//   ไม่งั้นหน้าต่าง 2D ที่ผู้ใช้แตะล่าสุด, ไม่งั้นบานแรกที่เปิด
// - "หน้าต่าง 2D ตัวแรก" ของ test hook: id `graphics2d` (บานของ layout ตั้งต้น) ถ้าเปิดอยู่ ไม่งั้นบานที่เปิดก่อนสุด

import type { MountedScene } from "../graphics/GraphicsFrame";
import { createSceneRegistry, type MouseMode, type SceneRegistry } from "../graphics/sceneRegistry";

/** พื้นที่ที่เห็นในภาพ [ตะวันตก, ใต้, ตะวันออก, เหนือ] องศา */
export type ViewRect = [number, number, number, number];

export interface Scene2DHandle extends MountedScene {
  /** Zoom In = ลากกรอบเพื่อซูม (คลิกเฉย ๆ ซูมเข้าสองเท่า) แล้วกลับเป็นลากเลื่อนแผนที่ */
  mouseMode(): MouseMode;
  setMouseMode(mode: MouseMode): void;
  /** Zoom Out: ภาพกว้างขึ้นสองเท่า */
  zoomOut(): void;
  /** พื้นที่ที่เห็นอยู่ (ใช้ตั้งภาพใหม่หลังเปลี่ยน Projection) ไม่รู้ = null */
  viewRectangle(): ViewRect | null;
  /** จำนวนสิ่งที่วาดในแต่ละชั้น (window.__gnssStudioTest) */
  overlayCounts(): Record<string, number>;
  /** จำนวนจุดของวงรอยของ sensor ชื่อ name ที่วาดอยู่ ไม่ได้วาด = null (window.__gnssStudioTest) */
  sensorFootprintPoints(name: string): number | null;
}

const registry = createSceneRegistry<Scene2DHandle>();
export const registry2d: SceneRegistry<Scene2DHandle> = registry;

export const registerScene2D = (handle: Scene2DHandle): (() => void) => registry.register(handle);
export const getScene2D = (panelId: string): Scene2DHandle | undefined => registry.get(panelId);
export const markActive2D = (panelId: string): void => registry.markActive(panelId);
export const activeScene2D = (): Scene2DHandle | undefined => registry.active();
export const firstScene2D = (): Scene2DHandle | undefined => registry.first("graphics2d");
export const notifyScenes2D = (): void => registry.notify();
export const subscribeScenes2D = (listener: () => void): (() => void) => registry.subscribe(listener);
export const scenes2DVersion = (): number => registry.version();
/** ล้างทะเบียน (test) */
export const resetScenes2D = (): void => registry.reset();
