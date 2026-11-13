// สถานะสำหรับวาด sensor (src/cesium/sensorDraw.ts, spec §3, §5.3): ความเร็วจากผลต่างตำแหน่ง ±1 s (P9), กรอบตัวดาว, boresight ตามหน้า Basic - Pointing,
// มุมศูนย์กลางของรอยที่ชี้ลงศูนย์กลางโลก, Radial Lines (P6) และการเลือก sensor ที่วาด (drawableSensors)
// รายการเส้นและพื้นที่ของหน้าต่าง 2D อยู่ใน overlay2d.test.ts ส่วนการอ่านตำแหน่งจาก entity ของ Cesium อยู่ใน scene-graphics.test.ts

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Cartesian3 } from "cesium";
import { describe, expect, test } from "vitest";
import {
  coneHalfAngleOf, drawableSensors, groundPointEcef, radialLineEnds, radialLinePoints, sensor3dParts, sensorColor, sensorDrawState, sensorFillAlpha,
  sensorViewPose, VELOCITY_STEP_S, type SensorObj,
} from "../../src/cesium/sensorDraw";
import {
  bodyFrame, cameraOrientation, earthDiscHalfAngleDeg, nadirCentralAngleRad, sensorViewFovDeg, type BodyFrame, type Vec3,
} from "../../src/cesium/sensorGeometry";
import { EARTH_RADIUS_KM } from "../../src/cesium/swath";
import { makeDoc } from "./helpers/chrome";
import { sensorObj } from "./helpers/objects";

const GPS_H = 20180;
const R = (EARTH_RADIUS_KM + GPS_H) * 1000;
/** ดาว GPS เหนือ (0°, 0°) */
const P: Vec3 = { x: R, y: 0, z: 0 };
/** p(t − 1 s) และ p(t + 1 s): ผลต่างสองข้าง = (0, 1000, 1000) m/s, ข้างหน้าอย่างเดียว = (0, 0, 2000), ข้างหลังอย่างเดียว = (0, 2000, 0) */
const PREV: Vec3 = { x: R, y: -2000, z: 0 };
const NEXT: Vec3 = { x: R, y: 0, z: 2000 };

/** Sensor ตามสคีมา (helpers/objects.ts) บนดาว G01 กรวย 10° ช่องอื่นแทนด้วย over */
const sensor = (name = "Sensor1", over: Record<string, unknown> = {}): SensorObj =>
  ({ ...sensorObj(name, "G01"), definition: { type: "Simple Conic", cone_half_angle: 10 }, ...over }) as SensorObj;
const pointing = (azimuth: number, elevation: number) => ({ type: "Fixed", orientation: "Az-El", azimuth, elevation, about_boresight: "Rotate" });

function expectVec(a: Vec3, b: Vec3, digits = 9): void {
  expect(a.x).toBeCloseTo(b.x, digits);
  expect(a.y).toBeCloseTo(b.y, digits);
  expect(a.z).toBeCloseTo(b.z, digits);
}
function expectFrame(a: BodyFrame, b: BodyFrame): void {
  expectVec(a.x, b.x);
  expectVec(a.y, b.y);
  expectVec(a.z, b.z);
}
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const D = Math.PI / 180;

describe("sensorDrawState", () => {
  test("sensorDrawState returns null without a position", () => {
    const s = sensor();
    expect(sensorDrawState(s, null, PREV, NEXT)).toBeNull();
    expect(sensorDrawState(s, P, null, null)).toBeNull(); // ไม่มีตำแหน่งข้างเคียง: หาความเร็วและกรอบไม่ได้
    // ดาวบนพื้นหรือใต้พื้น (เหมือน swathShape): ไม่มีรอย
    const ground: Vec3 = { x: EARTH_RADIUS_KM * 1000, y: 0, z: 0 };
    expect(sensorDrawState(s, ground, { ...ground, y: -1000 }, { ...ground, y: 1000 })).toBeNull();
    expect(sensorDrawState(s, { x: 1, y: 0, z: 0 }, { x: 1, y: -1, z: 0 }, { x: 1, y: 1, z: 0 })).toBeNull();
    // เหนือขั้วพอดีและเคลื่อนตามแนวรัศมี: ความเร็วเฉื่อยขนานกับ +Z หากรอบไม่ได้
    const pole: Vec3 = { x: 0, y: 0, z: R };
    expect(sensorDrawState(s, pole, { x: 0, y: 0, z: R - 10 }, { x: 0, y: 0, z: R + 10 })).toBeNull();
  });

  test("velocity uses the two-sided difference", () => {
    expect(VELOCITY_STEP_S).toBe(1);
    const st = sensorDrawState(sensor(), P, PREV, NEXT)!;
    expect(st.pos).toEqual(P);
    expectFrame(st.frame, bodyFrame(P, { x: 0, y: 1000, z: 1000 })!);
    // ไม่ใช่ผลต่างข้างเดียว
    expect(Math.abs(st.frame.x.z - bodyFrame(P, { x: 0, y: 0, z: 2000 })!.x.z)).toBeGreaterThan(1e-3);
  });

  test("one-sided at the edge of the data", () => {
    // ข้างหลังไม่มีค่า (ต้นช่วง): (p(t + 1) − p(t)) / 1 s
    expectFrame(sensorDrawState(sensor(), P, null, NEXT)!.frame, bodyFrame(P, { x: 0, y: 0, z: 2000 })!);
    // ข้างหน้าไม่มีค่า (ท้ายช่วง): (p(t) − p(t − 1)) / 1 s
    expectFrame(sensorDrawState(sensor(), P, PREV, null)!.frame, bodyFrame(P, { x: 0, y: 2000, z: 0 })!);
  });

  test("boresight follows the pointing page", () => {
    // Elevation 90° (ค่าตั้งต้น) = ชี้ลงศูนย์กลางโลก มีมุมศูนย์กลางของรอยให้เติมพื้นที่
    const down = sensorDrawState(sensor(), P, PREV, NEXT)!;
    expectVec(down.boresight, { x: -1, y: 0, z: 0 });
    expect(down.nadir).toBe(true);
    expect(down.centralAngleRad).toBeCloseTo(nadirCentralAngleRad(GPS_H, 10), 9);
    expect(down.footprint.ring).toHaveLength(73);
    expect(down.footprint.boresightHit![0]).toBeCloseTo(0, 6);
    expect(down.footprint.boresightHit![1]).toBeCloseTo(0, 6);

    // Az 0 El 0 = +X, Az 90 El 0 = +Y, El 60 = cos 60°·X + sin 60°·Z
    const f = down.frame;
    const along = sensorDrawState(sensor("S", { pointing: pointing(0, 0) }), P, PREV, NEXT)!;
    expectVec(along.boresight, f.x);
    expect(along.nadir).toBe(false);
    expect(along.centralAngleRad).toBeNull();
    expectVec(sensorDrawState(sensor("S", { pointing: pointing(90, 0) }), P, PREV, NEXT)!.boresight, f.y);
    const tilted = sensorDrawState(sensor("S", { pointing: pointing(0, 60) }), P, PREV, NEXT)!;
    expect(dot(tilted.boresight, f.x)).toBeCloseTo(0.5, 9);
    expect(dot(tilted.boresight, f.z)).toBeCloseTo(Math.sqrt(3) / 2, 9);
    expect(tilted.nadir).toBe(false);

    // ช่องที่ไม่มี (ไฟล์เก่าหรือส่งมาไม่ครบ) = ค่าตั้งต้นของ server: Cone Half Angle 45, Az 0, El 90
    const bare = sensor("S", { definition: { type: "Simple Conic" }, pointing: { type: "Fixed", orientation: "Az-El", about_boresight: "Rotate" } });
    expect(coneHalfAngleOf(bare)).toBe(45);
    const st = sensorDrawState(bare, P, PREV, NEXT)!;
    expect(st.nadir).toBe(true);
    expect(st.centralAngleRad).toBeCloseTo(nadirCentralAngleRad(GPS_H, 45), 9);
  });
});

test("radial lines end at points 0, 9, 18, … of the 72-point ring", () => {
  const fp = sensorDrawState(sensor("S", { pointing: pointing(0, 70) }), P, PREV, NEXT)!.footprint;
  const ends = radialLinePoints(fp);
  expect(ends).toHaveLength(8);
  ends.forEach((pt, i) => expect(pt).toEqual(fp.ring[9 * i]));
});

test("3D parts follow the 3D Graphics page: ring, radial lines, boresight marker", () => {
  const g3 = (over: object) => ({ graphics3d: { show: true, color: "#00ff00", show_radial_lines: true, show_boresight_marker: false, ...over } });
  const st = sensorDrawState(sensor("S", g3({})), P, PREV, NEXT)!;
  const parts = sensor3dParts(st);
  expect(parts.ring).toBe(st.footprint.ring);
  expect(parts.radials).toEqual(radialLinePoints(st.footprint).map(groundPointEcef));
  expect(parts.marker).toBeNull(); // Show Boresight Marker ปิดเป็นค่าตั้งต้น
  expect(parts.color).toBe("#00ff00");

  const marked = sensorDrawState(sensor("S", g3({ show_radial_lines: false, show_boresight_marker: true })), P, PREV, NEXT)!;
  expect(sensor3dParts(marked).radials).toEqual([]);
  expect(sensor3dParts(marked).marker).toEqual(marked.footprint.boresightHit);
  // ช่องที่ไม่มี: Radial Lines เปิด Marker ปิด
  expect(sensor3dParts(sensorDrawState(sensor("S", { graphics3d: {} }), P, PREV, NEXT)!)).toMatchObject({ marker: null, color: "#e8c547" });
  expect(sensor3dParts(sensorDrawState(sensor("S", { graphics3d: {} }), P, PREV, NEXT)!).radials).toHaveLength(8);

  // boresight ชี้ออกไปทางฟ้า: ไม่มีรอยและ marker วาดกรวยอย่างเดียว (spec §3.3)
  const up = sensor3dParts(sensorDrawState(sensor("S", { ...g3({ show_boresight_marker: true }), pointing: pointing(0, -90) }), P, PREV, NEXT)!);
  expect(up.ring).toBeNull();
  expect(up.marker).toBeNull();
  expect(up.radials).toHaveLength(8);
});

test("radial line ends: on the drawn ring when the boresight hits the Earth, along the cone edges when it misses", () => {
  const len = (v: Vec3): number => Math.hypot(v.x, v.y, v.z);
  const from = (end: Vec3): Vec3 => ({ x: end.x - P.x, y: end.y - P.y, z: end.z - P.z });
  // กรวยกว้างกว่าจานโลก (45° > ρ ≈ 13.9°): ทุกเส้นจบที่จุดสัมผัสขอบฟ้าของวง ห่างจากทิศลงโลกเท่า ρ
  const wide = sensorDrawState(sensor("S", { definition: { type: "Simple Conic", cone_half_angle: 45 } }), P, PREV, NEXT)!;
  for (const end of radialLineEnds(wide)) {
    const d = from(end);
    expect(Math.acos(-d.x / len(d)) / D).toBeCloseTo(earthDiscHalfAngleDeg(GPS_H), 1);
  }
  // ชี้ตามแนวการเคลื่อนที่ (El 0): ไม่โดนโลก เส้นตามทิศขอบกรวย (ห่างจาก boresight เท่า Cone Half Angle) ยาวเท่าระยะถึงขอบฟ้า
  const along = sensorDrawState(sensor("S", { pointing: pointing(0, 0) }), P, PREV, NEXT)!;
  expect(along.footprint.boresightHit).toBeNull();
  const horizon = Math.sqrt(R * R - (EARTH_RADIUS_KM * 1000) ** 2);
  const ends = radialLineEnds(along);
  expect(ends).toHaveLength(8);
  for (const end of ends) {
    const d = from(end);
    expect(len(d)).toBeCloseTo(horizon, 3);
    expect(Math.acos(dot(d, along.boresight) / len(d)) / D).toBeCloseTo(10, 9);
  }
});

test("ground points sit on the WGS 84 ellipsoid where Cesium puts the ring", () => {
  for (const [lon, lat] of [[0, 0], [100.5, 13.7], [-170, -60], [45, 89.9]] as [number, number][]) {
    const want = Cartesian3.fromDegrees(lon, lat, 0);
    const got = groundPointEcef([lon, lat]);
    expect(Math.hypot(got.x - want.x, got.y - want.y, got.z - want.z)).toBeLessThan(1e-6);
  }
});

test("colours and fill opacity come from each window's page with the server defaults", () => {
  const s = sensor("S", { graphics2d: { color: "#ff0000", fill_translucency: 25 }, graphics3d: { color: "#00ff00" } });
  expect(sensorColor(s, "2d")).toBe("#ff0000");
  expect(sensorColor(s, "3d")).toBe("#00ff00");
  expect(sensorFillAlpha(s)).toBeCloseTo(0.75, 12);
  const bare = sensor("S", { graphics2d: {}, graphics3d: {} });
  expect(sensorColor(bare, "2d")).toBe("#e8c547");
  expect(sensorColor(bare, "3d")).toBe("#e8c547");
  expect(sensorFillAlpha(bare)).toBeCloseTo(0.5, 12);
  expect(sensorFillAlpha(sensor("S", { graphics2d: { fill_translucency: 100 } }))).toBe(0);
});

test("drawableSensors keeps sensors shown in that window whose parent is shown", () => {
  const sat = (name: string) => ({ class: "Satellite", name, norad: 1 });
  const doc = makeDoc({
    objects: [
      sat("G01"),
      sat("G02"),
      sensor("Both"),
      sensor("No2D", { graphics2d: { show: false } }),
      sensor("No3D", { graphics3d: { show: false } }),
      sensor("Defaults", { graphics2d: {}, graphics3d: {} }),
      sensor("OnG02", { parent: "*/Satellite/G02" }),
    ] as never,
  });
  const asked: string[] = [];
  const shown = (path: string): boolean => {
    asked.push(path);
    return path === "*/Satellite/G01";
  };
  expect(drawableSensors(doc, "2d", shown).map((s) => s.name)).toEqual(["Both", "No3D", "Defaults"]);
  expect(drawableSensors(doc, "3d", shown).map((s) => s.name)).toEqual(["Both", "No2D", "Defaults"]);
  expect(asked).toContain("*/Satellite/G02");
  expect(drawableSensors(doc, "3d", () => false)).toEqual([]);
  expect(drawableSensors(makeDoc(), "3d", () => true)).toEqual([]);
});

describe("sensorViewPose (Sensor View camera, spec §5.4)", () => {
  test("sits on the satellite, looks along the boresight, up per the Up choice, fov from the cone and the picture's aspect", () => {
    const st = sensorDrawState(sensor(), P, PREV, NEXT)!; // nadir 10°
    for (const up of ["north", "velocity"] as const) {
      const pose = sensorViewPose(st, up, 16 / 9);
      expect(pose.position).toEqual(P);
      expectVec(pose.direction, { x: -1, y: 0, z: 0 });
      const o = cameraOrientation(P, st.boresight, st.frame, up);
      expectVec(pose.up, o.up);
      expect(dot(pose.up, pose.direction)).toBeCloseTo(0, 12);
      expect(pose.fovDeg).toBeCloseTo(sensorViewFovDeg(10, 16 / 9), 12);
    }
    expectVec(sensorViewPose(st, "north", 1).up, { x: 0, y: 0, z: 1 }); // เหนือ (0°, 0°): ทิศเหนือของโลกตั้งฉากกับทิศลงพอดี
    expectVec(sensorViewPose(st, "velocity", 1).up, st.frame.x);
    // ด้านสั้นพอดีกรวยขยาย 5%: ภาพจัตุรัสได้ 21° ภาพตั้งก็คิดจากด้านสั้นเหมือนกัน
    expect(sensorViewPose(st, "north", 1).fovDeg).toBeCloseTo(21, 12);
    expect(sensorViewPose(st, "north", 9 / 16).fovDeg).toBeCloseTo(sensorViewFovDeg(10, 16 / 9), 12);
  });

  test("a picture without a size (collapsed panel: aspect 0, ∞ or NaN) gives no fov, so the last good one is kept", () => {
    const st = sensorDrawState(sensor(), P, PREV, NEXT)!;
    for (const aspect of [0, Number.POSITIVE_INFINITY, Number.NaN, -1]) {
      const pose = sensorViewPose(st, "north", aspect);
      expect(pose.fovDeg, String(aspect)).toBeNull();
      expect(pose.position).toEqual(P); // ตำแหน่งและทิศยังตามดาว
    }
  });
});

test("sensorDraw.ts and everything it imports stay free of Cesium", () => {
  const seen = new Set<string>();
  const visit = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    expect(source, file).not.toMatch(/from\s+["']cesium["']/);
    for (const m of source.matchAll(/^import\s+(?!type\b)[^;]*?from\s+["'](\.{1,2}\/[^"']+)["']/gms)) visit(resolve(dirname(file), `${m[1]}.ts`));
  };
  visit(resolve(import.meta.dirname, "../../src/cesium/sensorDraw.ts"));
  expect([...seen].map((f) => f.split("/src/")[1]).sort()).toEqual(["cesium/colors.ts", "cesium/lonlat.ts", "cesium/sensorDraw.ts", "cesium/sensorGeometry.ts", "cesium/swath.ts"]);
});
