// เรขาคณิตของ sensor (src/cesium/sensorGeometry.ts, spec §3): กรอบตัวดาว, boresight จาก Az-El, รอยของกรวยบนพื้นโลก, ทิศกล้องและ fov ของ Sensor View
// ค่าที่คาดเป็นสูตรปิดของสามเหลี่ยม ศูนย์กลางโลก–ดาว–จุดบนพื้น: มุมศูนย์กลางของกรวยที่ชี้ลงศูนย์กลางโลก θ = asin(k·sin α) − α (k = (Re + h) / Re)

import { expect, test } from "vitest";
import {
  bodyFrame,
  boresightOf,
  cameraOrientation,
  defaultConeHalfAngleDeg,
  earthDiscHalfAngleDeg,
  EARTH_ROTATION_RAD_S,
  isNadir,
  nadirCentralAngleRad,
  sensorFootprint,
  sensorViewFovDeg,
} from "../../src/cesium/sensorGeometry";
import { EARTH_RADIUS_KM, WGS84_E2 } from "../../src/cesium/swath";

const RE = EARTH_RADIUS_KM;
const GPS_H = 20180;
const D = Math.PI / 180;
const k = (RE + GPS_H) / RE;

/** มุมศูนย์กลาง (องศา) ระหว่างสองจุดจาก lon/lat geodetic: แปลงละติจูดกลับเป็น geocentric (tan φc = (1 − e²) tan φd) แล้ววัดบนทรงกลม ตรงกับที่โมดูลแปลงจุด */
function centralAngleDeg(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const v = (lon: number, lat: number) => {
    const φc = Math.atan((1 - WGS84_E2) * Math.tan(lat * D));
    return [Math.cos(φc) * Math.cos(lon * D), Math.cos(φc) * Math.sin(lon * D), Math.sin(φc)];
  };
  const [a, b] = [v(lon1, lat1), v(lon2, lat2)];
  const cross = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  return (Math.atan2(Math.hypot(cross[0], cross[1], cross[2]), a[0] * b[0] + a[1] * b[1] + a[2] * b[2])) / D;
}

test("Earth disc half angle", () => {
  expect(earthDiscHalfAngleDeg(GPS_H)).toBeCloseTo(13.884, 2);
  expect(earthDiscHalfAngleDeg(42164.17 - RE)).toBeCloseTo(8.69, 2);
});

test("default cone half angle is the disc plus half a degree, 45 without a position", () => {
  expect(defaultConeHalfAngleDeg(null)).toBe(45);
  expect(defaultConeHalfAngleDeg({ x: (RE + GPS_H) * 1000, y: 0, z: 0 })).toBe(14.4);
});

test("nadir central angle: asin(k sin a) - a inside the disc, the horizon angle at or beyond it", () => {
  expect(nadirCentralAngleRad(GPS_H, 10) / D).toBeCloseTo((Math.asin(k * Math.sin(10 * D)) - 10 * D) / D, 9);
  expect(nadirCentralAngleRad(GPS_H, 10) / D).toBeCloseTo(36.36, 2);
  // กรวยกว้างกว่าจานโลก (และพอดีขอบจาน) จบที่ขอบฟ้า: acos(Re / (Re + h)) = 90° − ρ
  expect(nadirCentralAngleRad(GPS_H, 45) / D).toBeCloseTo(90 - earthDiscHalfAngleDeg(GPS_H), 9);
  expect(nadirCentralAngleRad(GPS_H, earthDiscHalfAngleDeg(GPS_H)) / D).toBeCloseTo(90 - earthDiscHalfAngleDeg(GPS_H), 6);
});

test("nadir cone footprint sits at asin(k sin a) - a from the sub-point", () => {
  const p = { x: (RE + GPS_H) * 1000, y: 0, z: 0 };
  const fp = sensorFootprint(p, { x: -1, y: 0, z: 0 }, 10);
  const want = (Math.asin(k * Math.sin(10 * D)) - 10 * D) / D; // ≈ 36.36°
  expect(fp.ring).toHaveLength(73);
  expect(fp.horizon).toHaveLength(72);
  expect(fp.ring[72]).toEqual(fp.ring[0]); // ปิดวง
  for (const [lon, lat] of fp.ring) expect(centralAngleDeg(0, 0, lon, lat)).toBeCloseTo(want, 1);
  expect(fp.horizon.every((h) => !h)).toBe(true);
  expect(fp.boresightHit).toEqual([expect.closeTo(0, 9), expect.closeTo(0, 9)]);
});

test("ring starts toward the north of the sub-point and goes clockwise seen from the satellite", () => {
  const fp = sensorFootprint({ x: (RE + GPS_H) * 1000, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }, 10);
  // +X ขนานกับ b จึงเริ่มทางทิศเหนือ มองลงจากดาว (เหนือขึ้นบน) วนไปทางตะวันออกก่อน
  expect(fp.ring[0][0]).toBeCloseTo(0, 9);
  expect(fp.ring[0][1]).toBeGreaterThan(0);
  expect(fp.ring[18][0]).toBeGreaterThan(30); // หนึ่งในสี่ของวง: ตะวันออก
  expect(fp.ring[18][1]).toBeCloseTo(0, 6);
  expect(fp.ring[36][1]).toBeLessThan(0); // ครึ่งวง: ใต้
});

test("a cone straddling the Earth limb mixes surface points and horizon points", () => {
  const p = { x: (RE + GPS_H) * 1000, y: 0, z: 0 };
  const f = bodyFrame(p, { x: 0, y: -EARTH_ROTATION_RAD_S * p.x, z: 3874 })!;
  const fp = sensorFootprint(p, boresightOf(f, 0, 78), 5); // boresight เอียง 12° จากทิศลง ขอบกรวยอยู่ที่ 7°–17° (ขอบจานโลก 13.88°)
  expect(fp.boresightHit).not.toBeNull();
  expect(fp.horizon.some(Boolean)).toBe(true);
  expect(fp.horizon.some((h) => !h)).toBe(true);
  const horizonAngle = 90 - earthDiscHalfAngleDeg(GPS_H);
  fp.ring.slice(0, 72).forEach(([lon, lat], i) => {
    const angle = centralAngleDeg(0, 0, lon, lat);
    if (fp.horizon[i]) expect(angle).toBeCloseTo(horizonAngle, 1);
    else expect(angle).toBeLessThan(horizonAngle);
  });
});

test("cone wider than the Earth disc ends on the horizon", () => {
  const fp = sensorFootprint({ x: (RE + GPS_H) * 1000, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }, 45);
  expect(fp.horizon.every(Boolean)).toBe(true);
  for (const [lon, lat] of fp.ring) expect(centralAngleDeg(0, 0, lon, lat)).toBeCloseTo(90 - earthDiscHalfAngleDeg(GPS_H), 1);
});

test("boresight that misses the Earth has no hit and a horizon ring", () => {
  const f = bodyFrame({ x: (RE + GPS_H) * 1000, y: 0, z: 0 }, { x: 0, y: -1936.1, z: 3874 })!;
  const fp = sensorFootprint({ x: (RE + GPS_H) * 1000, y: 0, z: 0 }, boresightOf(f, 0, 60), 5);
  expect(fp.boresightHit).toBeNull();
  expect(fp.ring.flat().every(Number.isFinite)).toBe(true);
});

test("ECI velocity constraint: tilt toward +X moves the hit north for a northbound satellite", () => {
  const p = { x: (RE + GPS_H) * 1000, y: 0, z: 0 };
  const f = bodyFrame(p, { x: 0, y: -EARTH_ROTATION_RAD_S * p.x, z: 3874 })!; // v_I = (0, 0, 3874)
  expect(f.x.z).toBeCloseTo(1, 9);
  const hit = sensorFootprint(p, boresightOf(f, 0, 80), 1).boresightHit!;
  expect(hit[1]).toBeGreaterThan(0);
  expect(centralAngleDeg(0, 0, hit[0], hit[1])).toBeCloseTo((Math.asin(k * Math.sin(10 * D)) - 10 * D) / D, 1);
});

test("geostationary body frame uses the inertial velocity", () => {
  const f = bodyFrame({ x: 42164170, y: 0, z: 0 }, { x: 0, y: 0, z: 0 })!;
  expect([f.x.x, f.x.y, f.x.z]).toEqual([expect.closeTo(0, 9), expect.closeTo(1, 9), expect.closeTo(0, 9)]);
  expect([f.y.x, f.y.y, f.y.z]).toEqual([expect.closeTo(0, 9), expect.closeTo(0, 9), expect.closeTo(-1, 9)]);
});

test("body frame is undefined at the Earth centre or when the inertial velocity is along nadir", () => {
  expect(bodyFrame({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })).toBeNull();
  // ความเร็วเฉื่อยชี้เข้าศูนย์กลางโลกพอดี (ที่ขั้วไม่มี ω × r): ไม่มีส่วนตั้งฉากกับ Z
  expect(bodyFrame({ x: 0, y: 0, z: 26551008.8 }, { x: 0, y: 0, z: -3874 })).toBeNull();
});

test("az 0 el 90 is nadir", () => {
  const p = { x: (RE + GPS_H) * 1000, y: 0, z: 0 };
  const f = bodyFrame(p, { x: 0, y: -EARTH_ROTATION_RAD_S * p.x, z: 3874 })!;
  const b = boresightOf(f, 0, 90);
  expect([b.x, b.y, b.z]).toEqual([expect.closeTo(-1, 9), expect.closeTo(0, 9), expect.closeTo(0, 9)]);
  expect(isNadir(p, b)).toBe(true);
  expect(isNadir(p, boresightOf(f, 0, 89.98))).toBe(false);
});

test("camera up: north on the equator, +X in velocity mode, +X when looking along the Earth axis", () => {
  const geo = { x: 42164170, y: 0, z: 0 },
    fg = bodyFrame(geo, { x: 0, y: 0, z: 0 })!;
  const down = { x: -1, y: 0, z: 0 };
  const n = cameraOrientation(geo, down, fg, "north").up,
    v = cameraOrientation(geo, down, fg, "velocity").up;
  expect([n.x, n.y, n.z]).toEqual([expect.closeTo(0, 9), expect.closeTo(0, 9), expect.closeTo(1, 9)]);
  expect([v.x, v.y, v.z]).toEqual([expect.closeTo(0, 9), expect.closeTo(1, 9), expect.closeTo(0, 9)]);
  const pole = { x: 0, y: 0, z: 26551008.8 },
    fp = bodyFrame(pole, { x: 3874, y: 0, z: 0 })!;
  const u = cameraOrientation(pole, { x: 0, y: 0, z: -1 }, fp, "north").up;
  expect([u.x, u.y, u.z]).toEqual([expect.closeTo(1, 9), expect.closeTo(0, 9), expect.closeTo(0, 9)]);
});

test("fov: square view equals the cone, wide view widens, capped at 120 on the short side", () => {
  expect(sensorViewFovDeg(10, 1)).toBeCloseTo(21, 6);
  expect(sensorViewFovDeg(80, 1)).toBeCloseTo(120, 6);
  expect(sensorViewFovDeg(10, 2)).toBeCloseTo((2 * Math.atan(Math.tan(10.5 * D) * 2)) / D, 6);
});
