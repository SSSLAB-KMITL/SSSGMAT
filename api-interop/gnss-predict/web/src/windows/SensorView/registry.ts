// หน้าต่าง Sensor View ที่เปิดอยู่ (sensor spec §5.4) ไม่ import Cesium: คำสั่ง ข้อความบนภาพ และ window.__gnssStudioTest อยู่ใน bundle หลัก
//
// - ทะเบียนแยกจาก registry3d ของหน้าต่าง 3D (P3): คำสั่ง g3d.*, object.zoomTo และ test hook ของหน้าต่าง 3D จึงไม่ไปโดนหน้าต่างที่กล้องล็อกนี้
// - หน้าต่างลงทะเบียน handle (scene3d.mountSensorView) ของตัวเองเมื่อ viewer พร้อม และถอนเมื่อปิด
// - หนึ่งบานต่อ sensor: params ของ panel = { path, up, display, zoom } (P8: ค่าเก็บใน params จึงไปกับ workbook) เปิดพร้อมกันได้ไม่เกิน SENSOR_VIEW_LIMIT บาน
//   display/zoom (imagery spec §5.3): Camera = เห็นแต่โลก (ค่าตั้งต้น รวมถึง workbook เก่าที่ไม่มีช่องนี้), Sensor = แบบเดิม
//   zoom = จำนวนต่อเนื่องใน [1, 262144] (zoom.ts: ปุ่มและล้อก้าว ×√2 บนตาราง 2^(k/2) ช่อง Width ตั้งค่าใดก็ได้ในช่วง)
// - หา handle ของ sensor ตามชื่อ (test hook sensorViewCamera) จาก params.path ของ panel ใน dockview

import type { DockviewApi, IDockviewPanel } from "dockview-react";
import type { ImagerySourceId } from "../../stores/imagery";
import { useLayout } from "../../stores/layout";
import { createSceneRegistry, type SceneRegistry } from "../graphics/sceneRegistry";
import { isZoom } from "./zoom";

/** ชนิดหน้าต่างใน layout/panels.ts */
export const SENSOR_VIEW_KIND = "sensorView";
/** เปิดพร้อมกันได้ไม่เกินเท่านี้บาน (spec §5.4, ความเสี่ยง S1: viewer ตัวละหนึ่ง WebGL context) */
export const SENSOR_VIEW_LIMIT = 4;

/** ด้านบนของภาพ: north = ทิศเหนือของโลกที่ฉายลงระนาบภาพ (ค่าตั้งต้น), velocity = +X ของกรอบตัวดาว */
export type SensorViewUp = "north" | "velocity";

/** camera = ซ่อนทุกอย่างที่ไม่ใช่ลูกโลกในหน้าต่างนี้ (ค่าตั้งต้น), sensor = แสดง object ของ scenario แบบหน้าต่าง 3D (imagery spec §5.3) */
export type SensorViewDisplay = "camera" | "sensor";

/**
 * การซูม: มุมกว้างด้านสั้น = sensorViewShortFovDeg(α) / zoom, zoom ∈ [1, 262144] (zoom.ts ZOOM_MIN / ZOOM_MAX)
 * ดาว GPS: ×8192 ≈ 0.0037° ≈ 1.3 km บนพื้น (imagery spec §4.4), ×262144 ≈ 0.00012° ≈ 40 m
 */
export type SensorViewZoom = number;

export interface SensorViewParams {
  /** path ของ sensor ("*\/Sensor/Sensor1") */
  path: string;
  up: SensorViewUp;
  display: SensorViewDisplay;
  zoom: SensorViewZoom;
}

/** ชั้นภาพพื้นโลกบนสุดที่แสดงอยู่ (NASA GIBS, EOX, OSM หรือ Cesium ion) */
export interface SensorHudImagery {
  title: string;
  /** เวลาของภาพ (static = "") */
  label: string;
  /** ชิ้นที่ขาดเกินครึ่งของชิ้นที่ได้ผลแล้ว: GIBS/EOX = ไม่มีภาพเวลานี้ (404) ; OSM และ ion = ชิ้นที่โหลดไม่ได้ทุกแบบ */
  missing: boolean;
  /** แหล่งของชั้น: ion ไม่มีตารางระดับซูมสูงสุด (HUD ไม่เตือน "ภาพละเอียดสุด") */
  source: ImagerySourceId;
  /** ระดับซูมละเอียดสุดของชั้น (Web Mercator, ชิ้น 256 px) null = ยังไม่รู้ (ชั้น ion ที่ยังไม่ได้ provider) */
  maxLevel: number | null;
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
  /** ชนิดของ sensor (Sensor Type) */
  shape: "Simple Conic" | "Rectangular";
  /** Vertical / Horizontal Half Angle (องศา) ของ Rectangular, Simple Conic = null */
  halfAngles: { vertical: number; horizontal: number } | null;
  /** ครึ่งมุมของภาพ (องศา) = viewHalfAngleOf: Cone Half Angle ของ Simple Conic, max(Vertical, Horizontal) ของ Rectangular (ข2 Ruling e) */
  coneHalfAngle: number;
  /** มุมกว้างด้านสั้นของภาพ (องศา) = sensorViewShortFovDeg(α, zoom) */
  fovDeg: number;
  zoom: SensorViewZoom;
  /** ชั้นภาพออนไลน์บนสุดที่แสดงอยู่ ไม่มี (Natural Earth II ออฟไลน์) = null */
  imagery: SensorHudImagery | null;
  /** ด้านสั้นของภาพเป็นพิกเซล CSS (canvas) ภาพยังไม่มีขนาด = 0 ใช้หาระดับชิ้นภาพที่ต้องใช้ (neededImageryLevel) */
  shortSidePx: number;
}

/**
 * กล้องของ Sensor View ในกรอบ Earth-fixed (เมตร, เวกเตอร์หนึ่งหน่วย) fovDeg = PerspectiveFrustum.fov ของ Cesium (ด้านยาวของภาพ)
 * display, zoom = ที่ภาพใช้อยู่ visibleEntityCount = จำนวน entity ที่แสดงอยู่จริงใน viewer นี้ (โหมด Camera = 0)
 */
export interface SensorCamera {
  position: [number, number, number];
  direction: [number, number, number];
  up: [number, number, number];
  fovDeg: number;
  display: SensorViewDisplay;
  zoom: SensorViewZoom;
  visibleEntityCount: number;
}

/** ok = กล้องตาม sensor แล้ว, notFound = scenario ไม่มี sensor นี้ตอนนี้ (กล้องจะตามเมื่อ doc มี sensor นี้) */
export type SensorViewResult = "ok" | "notFound";

export interface SensorViewHandle {
  readonly panelId: string;
  /**
   * กล้องอยู่ที่ดาวแม่ มองตาม boresight ด้วย fov ของกรวย / zoom ตามเวลา Animation (ล็อกการลาก หมุน ซูม)
   * display camera = ซ่อนทุกอย่างที่ไม่ใช่ลูกโลกใน viewer นี้, sensor = แสดงตาม scenario
   */
  viewFromSensor(path: string, up: SensorViewUp, display: SensorViewDisplay, zoom: SensorViewZoom): SensorViewResult;
  /** ข้อความบนภาพ ณ เวลาปัจจุบัน ดาวแม่ไม่มีตำแหน่ง (ไม่มีผล หรือนอกช่วงเวลา) หรือไม่มี sensor = null */
  sensorHud(): SensorHud | null;
  /** กล้องที่ตั้งอยู่ ยังไม่ได้ตั้ง (ไม่มีตำแหน่ง) = null */
  sensorCamera(): SensorCamera | null;
  /** ตำแหน่ง Earth-fixed (เมตร) ของ object ชื่อ name ในภาพนี้ ณ เวลาปัจจุบัน (ภาพมีดาวทุกดวงแบบหน้าต่าง 3D) ไม่มี = null */
  entityPositionEcef(name: string): [number, number, number] | null;
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

/**
 * params จากค่าที่เก็บไว้ (workbook เก่าหรือแก้มือ): path ที่ไม่ใช่สตริง = "", up ที่ไม่รู้จัก = north,
 * display ที่ไม่ใช่ "sensor" = camera, zoom ที่ไม่ใช่ตัวเลขจำกัดใน [1, 262144] (รวมถึงสตริง "8", NaN, 0) = 1
 */
export function sensorViewParams(raw: unknown): SensorViewParams {
  const p = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    path: typeof p.path === "string" ? p.path : "",
    up: p.up === "velocity" ? "velocity" : "north",
    display: p.display === "sensor" ? "sensor" : "camera",
    zoom: isZoom(p.zoom) ? p.zoom : 1,
  };
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
