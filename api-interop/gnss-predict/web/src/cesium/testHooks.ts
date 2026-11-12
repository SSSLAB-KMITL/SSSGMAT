// ฟังก์ชันสำหรับ test ในหน้าเว็บ (W19): window.__gnssStudioTest ติดตั้งเมื่อ URL มี `?test` เท่านั้น ใช้ใน e2e (ตำแหน่งต่างจาก predicted.sp3 ≤ 1 ม.,
// สีและป้ายชื่อหลัง Apply, เวลาโหลดและจำนวนเฟรม)
// name = ชื่อ object ใน scenario (หน้าต่าง 3D แปลงเป็น id ของ entity ผ่าน entityIdFor) ทุกฟังก์ชันอ่านจาก viewer 3D ตัวแรก (registry.firstScene)
// ยกเว้น overlays2d: จำนวนสิ่งที่หน้าต่าง 2D ตัวแรกวาดในแต่ละชั้น (ground track, Swath, กลางวันกลางคืน, IPP) ไม่มีหน้าต่าง 2D = null
// ไฟล์นี้ไม่ import Cesium: อยู่ใน bundle หลักได้ งานที่ต้องใช้ Cesium ทำใน handle ของหน้าต่าง

import { useTime } from "../stores/time";
import { parseIsoUtc } from "../time/parse";
import { firstScene2D } from "../windows/Graphics2D/registry2d";
import { firstScene, sceneLoadedAt } from "../windows/Graphics3D/registry";

export interface GnssStudioTestHooks {
  setTime(iso: string): void;
  entityPositionEcef(name: string, iso?: string): [number, number, number] | null;
  entityColor(name: string): string | null;
  labelShown(name: string): boolean | null;
  sceneLoadedAt(): number | null;
  frameCount(): number;
  overlays2d(): Record<string, number> | null;
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
    sceneLoadedAt: () => sceneLoadedAt(),
    frameCount: () => firstScene()?.frameCount() ?? 0,
    overlays2d: () => firstScene2D()?.overlayCounts() ?? null,
  };
}
