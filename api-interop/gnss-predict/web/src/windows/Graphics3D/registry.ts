// หน้าต่าง 3D ที่เปิดอยู่ (ไม่ import Cesium: คำสั่ง แถบเครื่องมือ และ window.__gnssStudioTest อยู่ใน bundle หลัก ส่วน Cesium โหลดทีหลังกับหน้าต่าง)
//
// - ทะเบียนแบบทั่วไปของ graphics/sceneRegistry.ts (หน้าต่าง 2D มีทะเบียนของตัวเองแบบเดียวกัน)
// - Graphics3D ลงทะเบียน Scene3DHandle ของตัวเองเมื่อ viewer พร้อม และถอนเมื่อปิด
// - "หน้าต่าง 3D ที่ active" (คำสั่ง g3d.* และ object.zoomTo ทำกับมัน): panel ที่ dockview บอกว่า active ถ้าเป็นหน้าต่าง 3D,
//   ไม่งั้นหน้าต่าง 3D ที่ผู้ใช้แตะล่าสุด (markActive), ไม่งั้นบานแรกที่เปิด
// - "viewer 3D ตัวแรก" ของ test hook: หน้าต่าง id `graphics3d` (บานแรกของ layout ตั้งต้น) ถ้าเปิดอยู่ ไม่งั้นบานที่เปิดก่อนสุด
// - ทะเบียนเป็น observable (subscribeScenes) ให้คำสั่งและปุ่มวาดสถานะใหม่เมื่อหน้าต่างเปิด/ปิดหรือโหมดเมาส์เปลี่ยน

import { createSceneRegistry, type MouseMode, type SceneRegistry } from "../graphics/sceneRegistry";

export type { MouseMode };
export type ReferenceFrame = "fixed" | "inertial";

export interface ViewFromToRequest {
  /** path ของ object ต้นทาง (Facility หรือ Satellite) */
  from: string;
  /** path ของ object ที่มองไปหา */
  to: string;
  frame: ReferenceFrame;
}

/** ok = กล้องตั้งแล้ว, same = From กับ To เป็น entity เดียวกัน (เช่นดาวกับสำเนาของมัน), notFound = ไม่มีในภาพหรือถูกซ่อน */
export type ViewFromToResult = "ok" | "same" | "notFound";

type Vec3 = [number, number, number];
/** แกนของตัวดาว (หน่วยหนึ่ง) ในพิกัด ECEF */
export interface SatelliteAxes {
  x: Vec3;
  y: Vec3;
  z: Vec3;
}

export interface Scene3DHandle {
  readonly panelId: string;
  /** Home View: มองโลกจากระยะ 4.5 รัศมีโลก */
  homeView(): void;
  /** Zoom To: กล้องตามไปที่ object (path) คืน false ถ้าไม่มี entity ของ object นั้นในภาพ */
  zoomTo(path: string): boolean;
  /** View From/To: กล้องอยู่ที่ from มองไปที่ to (ตามไปเมื่อเวลาเดิน) */
  viewFromTo(req: ViewFromToRequest): ViewFromToResult;
  /** โหลดผลลัพธ์เข้าภาพไม่สำเร็จ แสดงเฉพาะ Facility อยู่ (จะลองใหม่เมื่อดึงสถานะผลลัพธ์ครั้งถัดไป) */
  sceneFailed(): boolean;
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
  /** จำนวนจุดของวงรอยของ sensor ชื่อ name ที่วาดอยู่ ไม่ได้วาด = null */
  sensorFootprintPoints(name: string): number | null;
  /** จำนวนดาวที่แสดงเป็นโมเดล 3 มิติอยู่ (entity ดาวที่แสดงและมีโมเดลที่ไม่ได้ซ่อน) */
  modelCount(): number;
  /** เวลา (performance.now) ที่ดาวใน scene ของหน้าต่างนี้หาได้ตามชื่อครั้งแรก (scene.czml ถูกใช้และ manifest มาแล้ว) ยังไม่ = null (test hook sceneLoadedAt) */
  loadedAt(): number | null;
  /** แกน +X, +Y, +Z ของตัวดาวชื่อ name ในพิกัด ECEF (หน่วยหนึ่ง) จากท่าทางที่วาดอยู่ ไม่มีโมเดลที่แสดงหรือยังไม่เคยคำนวณท่าทาง = null */
  satelliteOrientation(name: string): SatelliteAxes | null;
  /** จุดของดาวชื่อ name แสดงอยู่ไหม (ดาวแสดงเป็นโมเดล = จุดซ่อน) ไม่มีดาวนั้น = null */
  pointShown(name: string): boolean | null;
  /**
   * Facility หรือดาว (path ของ object) ที่จุดอยู่ใกล้จุด (x, y) ของภาพที่สุด และห่างไม่เกิน 8 px (พิกเซลใน canvas ของหน้าต่างนี้ มุมซ้ายบน = 0, 0)
   * ไม่มี = null; ที่ซ่อนอยู่ อยู่หลังโลก หรืออยู่นอกภาพไม่นับ sensor เส้น access และพื้นโลกไม่ใช่ object ที่เลือกได้ (คลิกซ้ายเลือก คลิกขวาเปิดเมนู)
   */
  pathAt(x: number, y: number): string | null;
  /** ตำแหน่ง (พิกเซลใน canvas) ของ object ชื่อ name ในภาพตอนนี้ ไม่แสดง อยู่หลังโลก หรืออยู่นอกภาพ = null */
  entityScreenPosition(name: string): [number, number] | null;
}

const registry = createSceneRegistry<Scene3DHandle>();
/** ทะเบียนของหน้าต่าง 3D (ส่วนร่วมของหน้าต่าง เช่นแถบ "โหลดผลไม่สำเร็จ" อ่านจากที่นี่) */
export const registry3d: SceneRegistry<Scene3DHandle> = registry;

/** แจ้งผู้ฟังว่าชุดหน้าต่างหรือสถานะของหน้าต่าง (โหมดเมาส์) เปลี่ยน */
export const notifyScenes = (): void => registry.notify();

/** ลงทะเบียนหน้าต่าง 3D คืนตัวถอนที่ถอนเฉพาะเมื่อยังเป็น handle ตัวนี้ */
export const registerScene = (handle: Scene3DHandle): (() => void) => registry.register(handle);

export const getScene = (panelId: string): Scene3DHandle | undefined => registry.get(panelId);

/** ผู้ใช้แตะหน้าต่าง 3D นี้ (คลิก โฟกัส): เป็นบานที่คำสั่งทำงานด้วยเมื่อ dockview ไม่ได้ชี้หน้าต่าง 3D */
export const markActive = (panelId: string): void => registry.markActive(panelId);

export const activeScene = (): Scene3DHandle | undefined => registry.active();

export const firstScene = (): Scene3DHandle | undefined => registry.first("graphics3d");

/**
 * เวลา (performance.now) ที่หน้าต่าง 3D ตัวแรก (ที่ลงทะเบียนอยู่ตอนนี้) โหลดเสร็จ = ดาวใน scene หาได้ตามชื่อ (Scene3DHandle.loadedAt) ไม่มีหน้าต่าง หรือยังไม่เสร็จ = null
 * เป็นของหน้าต่าง ไม่ใช่ของทั้งหน้า: File → Open จัดหน้าต่างตาม workbook หลังผลลัพธ์มาแล้ว หน้าต่าง 3D ที่มาแทนตัวเดิมเริ่มจากยังไม่โหลด
 */
export const sceneLoadedAt = (): number | null => firstScene()?.loadedAt() ?? null;

export const subscribeScenes = (listener: () => void): (() => void) => registry.subscribe(listener);
export const scenesVersion = (): number => registry.version();

/** ล้างทะเบียน (test) */
export function resetScenes(): void {
  registry.reset();
}
