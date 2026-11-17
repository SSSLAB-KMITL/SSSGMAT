// พื้นที่ที่หน้าต่าง 2D เห็นอยู่ (src/windows/Graphics2D/view2d.ts) จากตำแหน่งกล้องและ frustum แบบ orthographic ของโหมด 2D
// ใช้ส่งต่อให้ viewer ตัวใหม่หลังเปลี่ยน Projection: computeViewRectangle ของ Cesium คืนแถบแคบข้ามเส้น 180° เมื่อภาพกว้างกว่าโลก (พบตอนตรวจด้วยตา)

import { GeographicProjection, WebMercatorProjection } from "cesium";
import { describe, expect, test } from "vitest";
import { viewRectOf } from "../../src/windows/Graphics2D/view2d";

const geo = new GeographicProjection();
const merc = new WebMercatorProjection();
/** เมตรบนแผนที่ geographic ต่อหนึ่งองศา */
const M = (6378137 * Math.PI) / 180;

describe("viewRectOf", () => {
  test("a view wider and taller than the world is the whole world", () => {
    expect(viewRectOf({ x: 0, y: 0 }, { left: -20_456_203, right: 20_456_203, bottom: -20_883_646, top: 20_883_646 }, geo)).toEqual([-180, -90, 180, 90]);
  });

  test("Mercator wider than the world keeps every longitude (Cesium's own answer was an 8° sliver across 180°)", () => {
    const r = viewRectOf({ x: 0, y: 0 }, { left: -20_496_383, right: 20_496_383, bottom: -20_037_508, top: 20_037_508 }, merc);
    expect(r[0]).toBe(-180);
    expect(r[2]).toBe(180);
    expect(r[1]).toBeCloseTo(-85.0511, 3);
    expect(r[3]).toBeCloseTo(85.0511, 3);
  });

  test("a zoomed-in view is the area around the camera", () => {
    const r = viewRectOf({ x: 100 * M, y: 14 * M }, { left: -10 * M, right: 10 * M, bottom: -10 * M, top: 10 * M }, geo);
    expect(r.map((v) => +v.toFixed(9))).toEqual([90, 4, 110, 24]);
  });

  test("a view across 180° comes back with west > east, the way Cesium rectangles cross the antimeridian", () => {
    const r = viewRectOf({ x: 175 * M, y: 0 }, { left: -10 * M, right: 10 * M, bottom: -5 * M, top: 5 * M }, geo);
    expect(r.map((v) => +v.toFixed(9))).toEqual([165, -5, -175, 5]);
  });
});
