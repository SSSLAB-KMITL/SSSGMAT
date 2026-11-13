// หน้าต่าง Sensor View ที่เปิดอยู่ (sensor spec §5.4) ไม่ import Cesium: คำสั่ง ข้อความบนภาพ และ window.__gnssStudioTest อยู่ใน bundle หลัก
//
// - ทะเบียนแยกจาก registry3d ของหน้าต่าง 3D (P3): คำสั่ง g3d.*, object.zoomTo และ test hook ของหน้าต่าง 3D จึงไม่ไปโดนหน้าต่างที่กล้องล็อกนี้
// - หน้าต่างลงทะเบียน handle (scene3d.mountSensorView) ของตัวเองเมื่อ viewer พร้อม และถอนเมื่อปิด
// - หนึ่งบานต่อ sensor: params ของ panel = { path, up } (P8: ค่า Up เก็บใน params จึงไปกับ workbook) เปิดพร้อมกันได้ไม่เกิน SENSOR_VIEW_LIMIT บาน
// - หา handle ของ sensor ตามชื่อ (test hook sensorViewCamera) จาก params.path ของ panel ใน dockview

import type { DockviewApi, IDockviewPanel } from "dockview-react";
import { useLayout } from "../../stores/layout";
import { createSceneRegistry, type SceneRegistry } from "../graphics/sceneRegistry";

/** ชนิดหน้าต่างใน layout/panels.ts */
export const SENSOR_VIEW_KIND = "sensorView";
/** เปิดพร้อมกันได้ไม่เกินเท่านี้บาน (spec §5.4, ความเสี่ยง S1: viewer ตัวละหนึ่ง WebGL context) */
export const SENSOR_VIEW_LIMIT = 4;

/** ด้านบนของภาพ: north = ทิศเหนือของโลกที่ฉายลงระนาบภาพ (ค่าตั้งต้น), velocity = +X ของกรอบตัวดาว */
export type SensorViewUp = "north" | "velocity";

export interface SensorViewParams {
  /** path ของ sensor ("*\/Sensor/Sensor1") */
  path: string;
  up: SensorViewUp;
}

/** ข้อความบนภาพ ณ เวลาปัจจุบัน (P4) */
export interface SensorHud {
  sensor: string;
  satellite: string;
  /** จุดใต้ดาว (ละติจูด geodetic, ลองจิจูด) องศา */
  lat: number;
  lon: number;
  /** ความสูงเหนือโลกทรงกลมรัศมี Re (km) แบบเดียวกับรอยของกรวย */
  altKm: number;
  /** Cone Half Angle (องศา) */
  coneHalfAngle: number;
}

/** กล้องของ Sensor View ในกรอบ Earth-fixed (เมตร, เวกเตอร์หนึ่งหน่วย) fovDeg = PerspectiveFrustum.fov ของ Cesium (ด้านยาวของภาพ) */
export interface SensorCamera {
  position: [number, number, number];
  direction: [number, number, number];
  up: [number, number, number];
  fovDeg: number;
}

/** ok = กล้องตาม sensor แล้ว, notFound = scenario ไม่มี sensor นี้ตอนนี้ (กล้องจะตามเมื่อ doc มี sensor นี้) */
export type SensorViewResult = "ok" | "notFound";

export interface SensorViewHandle {
  readonly panelId: string;
  /** กล้องอยู่ที่ดาวแม่ มองตาม boresight ด้วย fov ของกรวย ตามเวลา Animation (ล็อกการลาก หมุน ซูม) */
  viewFromSensor(path: string, up: SensorViewUp): SensorViewResult;
  /** ข้อความบนภาพ ณ เวลาปัจจุบัน ดาวแม่ไม่มีตำแหน่ง (ไม่มีผล หรือนอกช่วงเวลา) หรือไม่มี sensor = null */
  sensorHud(): SensorHud | null;
  /** กล้องที่ตั้งอยู่ ยังไม่ได้ตั้ง (ไม่มีตำแหน่ง) = null */
  sensorCamera(): SensorCamera | null;
  sceneFailed(): boolean;
  resize(): void;
  destroy(): void;
}

/** ทะเบียนของ Sensor View (แยกจาก registry3d: P3) */
export const sensorViewScenes: SceneRegistry<SensorViewHandle> = createSceneRegistry<SensorViewHandle>();

/** ลงทะเบียนหน้าต่าง คืนตัวถอนที่ถอนเฉพาะเมื่อยังเป็น handle ตัวนี้ */
export const registerSensorViewScene = (handle: SensorViewHandle): (() => void) => sensorViewScenes.register(handle);

/** แจ้งผู้ฟัง (ข้อความบนภาพ) ว่าสถานะของหน้าต่างเปลี่ยน เช่น โหลดผลเข้าภาพเสร็จ */
export const notifySensorViews = (): void => sensorViewScenes.notify();

/** params จากค่าที่เก็บไว้ (workbook เก่าหรือแก้มือ): path ที่ไม่ใช่สตริง = "", up ที่ไม่รู้จัก = north */
export function sensorViewParams(raw: unknown): SensorViewParams {
  const p = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  return { path: typeof p.path === "string" ? p.path : "", up: p.up === "velocity" ? "velocity" : "north" };
}

/** Sensor View ที่เปิดอยู่ใน dockview (ตามลำดับของ dockview) พื้นที่ทำงานยังไม่ mount = [] */
export function sensorViewPanels(api: DockviewApi | null = useLayout.getState().api): IDockviewPanel[] {
  return api === null ? [] : api.panels.filter((p) => p.api.component === SENSOR_VIEW_KIND);
}

/** handle ของ Sensor View ที่ดู sensor ชื่อนี้อยู่ ไม่มีหน้าต่างหรือภาพยังไม่พร้อม = undefined */
export function sensorViewFor(sensorName: string): SensorViewHandle | undefined {
  const panel = sensorViewPanels().find((p) => sensorViewParams(p.params).path === `*/Sensor/${sensorName}`);
  return panel === undefined ? undefined : sensorViewScenes.get(panel.id);
}
