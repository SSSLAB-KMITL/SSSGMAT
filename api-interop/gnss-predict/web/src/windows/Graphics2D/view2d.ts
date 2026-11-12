// พื้นที่ที่หน้าต่าง 2D เห็นอยู่ เพื่อส่งต่อให้ viewer ตัวใหม่หลังเปลี่ยน Projection (spec §9.3)
//
// ในโหมด 2D ตำแหน่งกล้อง (x, y) เป็นพิกัดบนแผนที่ที่ฉายแล้ว (เมตร) และ frustum เป็นแบบ orthographic (left/right/bottom/top รอบกล้อง)
// มุมของภาพจึงหาได้ตรง ๆ ด้วย projection.unproject ไม่ใช้ camera.computeViewRectangle: เมื่อภาพกว้างกว่าโลก (ค่าตั้งต้นที่เห็นทั้งโลก)
// ใน Mercator มันคืนแถบแคบ 8° ข้ามเส้น 180° (west > east) ซึ่งทำให้ viewer ตัวใหม่ซูมไปที่เส้น 180°
// ผล: [ตะวันตก, ใต้, ตะวันออก, เหนือ] องศา เห็นครบ 360° = −180 ถึง 180, ภาพที่ข้ามเส้น 180° ได้ west > east (แบบ Rectangle ของ Cesium)

import { Cartesian3, Math as CesiumMath, type MapProjection } from "cesium";
import { wrapLon } from "../../cesium/lonlat";
import type { ViewRect } from "./registry2d";

export function viewRectOf(
  center: { x: number; y: number },
  frustum: { left: number; right: number; bottom: number; top: number },
  projection: MapProjection,
): ViewRect {
  const sw = projection.unproject(new Cartesian3(center.x + frustum.left, center.y + frustum.bottom, 0));
  const ne = projection.unproject(new Cartesian3(center.x + frustum.right, center.y + frustum.top, 0));
  const d = CesiumMath.toDegrees;
  const south = Math.max(-90, d(sw.latitude));
  const north = Math.min(90, d(ne.latitude));
  const west = d(sw.longitude);
  const east = d(ne.longitude);
  if (east - west >= 360) return [-180, south, 180, north];
  const w = wrapLon(west);
  const e = wrapLon(east);
  // wrapLon ให้ [−180, 180): ขอบตะวันออกที่ 180 พอดีกลายเป็น −180 จึงคงไว้ที่ 180
  return [w, south, e === -180 && east > west ? 180 : e, north];
}
