// ฟังก์ชันสำหรับ test ในหน้าเว็บ (W19): window.__gnssStudioTest ติดตั้งเมื่อ URL มี `?test` เท่านั้น ใช้ใน e2e (ตำแหน่งต่างจาก predicted.sp3 ≤ 1 ม.,
// สีและป้ายชื่อหลัง Apply, เวลาโหลดและจำนวนเฟรม)
// name = ชื่อ object ใน scenario (หน้าต่าง 3D แปลงเป็น id ของ entity ผ่าน entityIdFor) ทุกฟังก์ชันอ่านจาก viewer 3D ตัวแรก (registry.firstScene)
// ยกเว้น overlays2d: จำนวนสิ่งที่หน้าต่าง 2D ตัวแรกวาดในแต่ละชั้น (ground track, Swath, กลางวันกลางคืน, IPP, sensor) ไม่มีหน้าต่าง 2D = null
// และ sensorFootprint(ชื่อ sensor, "3d" | "2d"): จำนวนจุดของวงรอยที่หน้าต่าง 3D หรือ 2D ตัวแรกวาดอยู่ ไม่ได้วาดหรือไม่มีหน้าต่าง = null
// และ entityScreenPosition(ชื่อ object): ตำแหน่ง [x, y] ในพิกเซลของ canvas (มุมซ้ายบน = 0, 0) ของ object ในหน้าต่าง 3D ตัวแรก ไว้ให้ e2e คลิกที่ดาว
// ไม่แสดง อยู่หลังโลก หรืออยู่นอกภาพ = null
// และ sensorViewCamera(ชื่อ sensor): กล้องของ Sensor View ของ sensor นั้น (ทะเบียนของ Sensor View แยกจากหน้าต่าง 3D: P3) ไม่มีหน้าต่างหรือไม่มีตำแหน่ง = null
//   พร้อม display ("camera" | "sensor"), zoom และ visibleEntityCount (entity ที่แสดงอยู่จริงใน viewer ของหน้าต่างนั้น: โหมด Camera = 0) (imagery spec §5.3)
// และ modelCount(): จำนวน entity ดาวที่แสดงเป็นโมเดล 3 มิติอยู่ในหน้าต่าง 3D ตัวแรก (ไม่มีหน้าต่าง = 0) (models integration spec §5)
// และ satelliteOrientation(ชื่อดาว): แกน +X, +Y, +Z ของตัวดาวในพิกัด ECEF (หน่วยหนึ่ง) จากท่าทางที่วาดอยู่ ไม่มีโมเดลที่แสดงหรือยังไม่เคยคำนวณท่าทาง = null
//   และ pointShown(ชื่อดาว): จุดของดาวแสดงอยู่ไหม (แสดงเป็นโมเดล = false, ปิด Satellite Models = true) ไม่มีดาวนั้น = null
//   และ satelliteModel(ชื่อดาว): primitive ที่ Cesium วาดโมเดลของดาวนั้น { model (id ใน catalog), ready, shown, offsetM (ระยะจากตำแหน่งที่วาดถึงดาว),
//   minimumPixelSize } ไม่มีดาว ไม่มีโมเดล หรือยังไม่มี primitive = null (โมเดลที่ ready และ shown แต่ offsetM เท่ารัศมีวงโคจร = ค้างที่ศูนย์กลางโลก มองไม่เห็น)
// และ flyToSatellite(ชื่อดาว, rangeM): กล้องของหน้าต่าง 3D ตัวแรกมองดาวนั้นจากระยะ rangeM ทางด้านดวงอาทิตย์ (เห็นด้านสว่าง) ไว้ดูโมเดลด้วยตา
//   ไม่มีหน้าต่าง ไม่มีดาว หรือไม่มีตำแหน่ง ณ เวลานี้ = false
// และ workbookRestoredAt(): เวลา (performance.now) ที่ File → Open จัดหน้าต่างตาม workbook ครั้งล่าสุดเสร็จ (useLayout.restoredAt) รออยู่ = null
//   หน้าต่าง 3D ที่ workbook สร้างใหม่โหลดเสร็จหลังเวลานี้ e2e (waitForScene) จึงรอ sceneLoadedAt() ≥ ค่านี้ ไม่อ่านหน้าต่างที่กำลังถูกแทน
// และ reportRows(panelId): เซลล์ทุกแถวที่หน้าต่างรายงานนั้นแสดงอยู่ (หัวส่วน หัวคอลัมน์ แถว สถิติ ไม่ขึ้นกับการเลื่อนของตาราง virtual)
//   Dynamic Display = แถวของเวลาปัจจุบัน ไม่มีหน้าต่างนั้นหรือยังไม่มีตาราง = []
// และ graphState(panelId): สิ่งที่หน้าต่างกราฟนั้นวาดอยู่ { type, series (ชื่อเส้น/object), timeLine (เวลาของเส้นเวลา animation ไม่มี = null),
//   currentPoint ([El, Az] ของจุดปัจจุบันในกราฟ polar) } ไม่มีหน้าต่างหรือยังไม่ได้วาด = null
// และ entityScreenPosition2d(ชื่อ object): แบบ entityScreenPosition ในหน้าต่าง 2D ตัวแรก (follow-up 13b-2: คลิกเลือกดาวใน 2D)
// และ pathCount(): จำนวนเส้นวงโคจรที่หน้าต่าง 3D ตัวแรกวาดอยู่ (path ของ Cesium ที่แสดง + เส้น Inertial by Window) ไม่มีหน้าต่าง = 0 (task 13c: Show Orbits)
// และ accessLines("3d" | "2d"): จำนวนเส้น access ที่หน้าต่าง 3D หรือ 2D ตัวแรกเปิดไว้ (access ที่ไม่ได้ Compute = 0) ไม่มีหน้าต่าง = null
// และ graphState(panelId).drawn: สิ่งที่ ECharts วาดจริง (จุดก่อน/หลัง LTTB, จุดเส้นขาด, จำนวนเส้นเวลาของ markLine) จาก windows/Graph/drawnState.ts
// และ breakRenderLoop("3d" | "2d"): เฟรมถัดไปของหน้าต่างนั้นโยนข้อผิดพลาดนอก Scene.render ให้ render loop ของ Cesium หยุดเงียบ ๆ หนึ่งครั้ง
//   (ตรวจการเริ่มวาดใหม่ของ cesium/viewer.ts watchRenderFailure) ไม่มีหน้าต่าง = false
// ไฟล์นี้ไม่ import Cesium: อยู่ใน bundle หลักได้ งานที่ต้องใช้ Cesium ทำใน handle ของหน้าต่าง

import { useLayout } from "../stores/layout";
import { useTime } from "../stores/time";
import { parseIsoUtc } from "../time/parse";
import { firstScene2D } from "../windows/Graphics2D/registry2d";
import { graphStateOf, type GraphState } from "../windows/Graph/options";
import { reportRowsOf } from "../windows/Report/table";
import { firstScene, sceneLoadedAt, type SatelliteAxes, type SatelliteModelState } from "../windows/Graphics3D/registry";
import { sensorViewFor, type SensorCamera } from "../windows/SensorView/registry";

export interface GnssStudioTestHooks {
  setTime(iso: string): void;
  entityPositionEcef(name: string, iso?: string): [number, number, number] | null;
  entityColor(name: string): string | null;
  labelShown(name: string): boolean | null;
  entityScreenPosition(name: string): [number, number] | null;
  sceneLoadedAt(): number | null;
  frameCount(): number;
  overlays2d(): Record<string, number> | null;
  sensorFootprint(name: string, view: "3d" | "2d"): number | null;
  sensorViewCamera(sensorName: string): SensorCamera | null;
  modelCount(): number;
  satelliteOrientation(name: string): SatelliteAxes | null;
  pointShown(name: string): boolean | null;
  satelliteModel(name: string): SatelliteModelState | null;
  flyToSatellite(name: string, rangeM: number): boolean;
  workbookRestoredAt(): number | null;
  reportRows(panelId: string): string[][];
  graphState(panelId: string): GraphState | null;
  entityScreenPosition2d(name: string): [number, number] | null;
  breakRenderLoop(view: "3d" | "2d"): boolean;
  pathCount(): number;
  accessLines(view: "3d" | "2d"): number | null;
}

declare global {
  interface Window {
    __gnssStudioTest?: GnssStudioTestHooks;
  }
}

/** URL ขอโหมด test ไหม (`?test` หรือ `?test=...` ที่ใดก็ได้ใน query) */
export function testModeRequested(search: string = window.location.search): boolean {
  return new URLSearchParams(search).has("test");
}

/** ติดตั้ง window.__gnssStudioTest ครั้งเดียว (เรียกซ้ำไม่ทำอะไร) */
export function installTestHooks(): void {
  if (window.__gnssStudioTest !== undefined) return;
  window.__gnssStudioTest = {
    setTime: (iso) => {
      const d = parseIsoUtc(iso);
      if (d === null) throw new RangeError(`setTime: not an ISO 8601 time: ${JSON.stringify(iso)}`);
      useTime.getState().setCurrent(d);
    },
    entityPositionEcef: (name, iso) => firstScene()?.entityPositionEcef(name, iso) ?? null,
    entityColor: (name) => firstScene()?.entityColor(name) ?? null,
    labelShown: (name) => firstScene()?.labelShown(name) ?? null,
    entityScreenPosition: (name) => firstScene()?.entityScreenPosition(name) ?? null,
    sceneLoadedAt: () => sceneLoadedAt(),
    frameCount: () => firstScene()?.frameCount() ?? 0,
    overlays2d: () => firstScene2D()?.overlayCounts() ?? null,
    sensorFootprint: (name, view) => (view === "3d" ? firstScene()?.sensorFootprintPoints(name) : firstScene2D()?.sensorFootprintPoints(name)) ?? null,
    sensorViewCamera: (sensorName) => sensorViewFor(sensorName)?.sensorCamera() ?? null,
    modelCount: () => firstScene()?.modelCount() ?? 0,
    satelliteOrientation: (name) => firstScene()?.satelliteOrientation(name) ?? null,
    pointShown: (name) => firstScene()?.pointShown(name) ?? null,
    satelliteModel: (name) => firstScene()?.satelliteModel(name) ?? null,
    flyToSatellite: (name, rangeM) => firstScene()?.flyToSatellite(name, rangeM) ?? false,
    workbookRestoredAt: () => useLayout.getState().restoredAt,
    reportRows: (panelId) => reportRowsOf(panelId),
    graphState: (panelId) => graphStateOf(panelId),
    entityScreenPosition2d: (name) => firstScene2D()?.entityScreenPosition?.(name) ?? null,
    pathCount: () => firstScene()?.pathCount?.() ?? 0,
    accessLines: (view) => (view === "3d" ? firstScene()?.accessLineCount?.() : firstScene2D()?.overlayCounts().accessLines) ?? null,
    breakRenderLoop: (view) => {
      const scene = view === "3d" ? firstScene() : firstScene2D();
      if (scene?.breakRenderLoopOnce === undefined) return false;
      scene.breakRenderLoopOnce();
      return true;
    },
  };
}
