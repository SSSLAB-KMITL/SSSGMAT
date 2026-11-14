// เรขาคณิตของ sensor (src/cesium/sensorGeometry.ts, spec §3): กรอบตัวดาว, boresight จาก Az-El, รอยของกรวยบนพื้นโลก, ทิศกล้องและ fov ของ Sensor View
// ค่าที่คาดเป็นสูตรปิดของสามเหลี่ยม ศูนย์กลางโลก–ดาว–จุดบนพื้น: มุมศูนย์กลางของกรวยที่ชี้ลงศูนย์กลางโลก θ = asin(k·sin α) − α (k = (Re + h) / Re)

import { expect, test } from "vitest";
import {
  bodyFrame,
  boresightOf,
  cameraOrientation,
  coneRays,
  defaultConeHalfAngleDeg,
  earthDiscHalfAngleDeg,
  EARTH_ROTATION_RAD_S,
  isNadir,
  nadirCentralAngleRad,
  neededImageryLevel,
  sensorFootprint,
  sensorViewGroundWidthM,
  sensorViewFovDeg,
  sensorViewShortFovDeg,
  sensorViewZoomForGroundWidth,
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

test("zoom divides the short-side fov (imagery spec §5.3): GPS cone at ×8, the 120° cap applies before the zoom", () => {
  expect(sensorViewShortFovDeg(13.88 + 0.5)).toBeCloseTo(2 * 14.38 * 1.05, 12);
  expect(sensorViewShortFovDeg(13.88 + 0.5, 8)).toBeCloseTo(Math.min(2 * 14.38 * 1.05, 120) / 8, 12);
  expect(sensorViewShortFovDeg(80, 4)).toBeCloseTo(30, 12);
  expect(sensorViewShortFovDeg(13.88 + 0.5, 128)).toBeCloseTo(0.2359, 4); // แคบสุดของดาว GPS ≈ 0.24° (spec §1)
  // ด้านยาวตาม aspect จากด้านสั้นที่หารแล้ว
  expect(sensorViewFovDeg(10, 2, 4)).toBeCloseTo((2 * Math.atan(Math.tan((10.5 / 4) * D) * 2)) / D, 9);
  expect(sensorViewFovDeg(10, 1, 2)).toBeCloseTo(10.5, 9);
});

test("cone rays are equally spaced at the half angle; every ninth of 72 is one of 8 (radial lines)", () => {
  const b = { x: -1, y: 0, z: 0 };
  const rays = coneRays(b, 10);
  expect(rays).toHaveLength(72);
  for (const r of rays) {
    expect(Math.hypot(r.x, r.y, r.z)).toBeCloseTo(1, 12);
    expect(Math.acos(-r.x) / D).toBeCloseTo(10, 9);
  }
  // เส้นแรกเอียงไปทาง +X ที่ฉายลงระนาบตั้งฉาก b (ขนานกับ b ที่นี่ จึงใช้ทิศเหนือ +Z)
  expect(rays[0].z).toBeGreaterThan(0);
  const eight = coneRays(b, 10, 8);
  eight.forEach((r, k) => {
    expect(r.x).toBeCloseTo(rays[9 * k].x, 12);
    expect(r.y).toBeCloseTo(rays[9 * k].y, 12);
    expect(r.z).toBeCloseTo(rays[9 * k].z, 12);
  });
});

// ---------- ความกว้างพื้นที่ที่จุดใต้ดาวและระดับภาพที่ต้องใช้ (imagery spec §4.4) ----------

/** ความกว้างพื้นที่ (เมตร) ที่มองจากดาวสูง altKm ตรงลงด้านสั้นกว้าง fovDeg คำนวณแยกด้วยเวกเตอร์: ยิงเส้นสองด้านของภาพไปตัดทรงกลมแล้ววัดส่วนโค้ง */
function groundWidthByRays(altKm: number, fovDeg: number): number {
  const r = (RE + altKm) * 1000;
  const re = RE * 1000;
  const beta = (fovDeg / 2) * D;
  // ดาวที่ (r, 0), เส้นเอียงจากทิศลง (−1, 0) เป็นมุม β: p = (r − t·cos β, t·sin β), |p| = Re  ⇒  t² − 2·r·cos β·t + r² − Re² = 0
  const b = r * Math.cos(beta);
  const disc = b * b - (r * r - re * re);
  // เส้นไม่โดนโลก (disc < 0, β เกินครึ่งมุมจานโลก) = ขอบภาพอยู่เหนือขอบฟ้า จบที่ขอบฟ้า มุมศูนย์กลาง acos(Re / r)
  const theta = disc < 0 ? Math.acos(re / r) : Math.atan2((b - Math.sqrt(disc)) * Math.sin(beta), r - (b - Math.sqrt(disc)) * Math.cos(beta));
  return 2 * re * theta;
}

test("ground width at the sub-satellite point: GPS cone at x1024 is about 10 km and at x8192 about 1.3 km (spec 4.4)", () => {
  const alt = 20200;
  const shortFov = (zoom: number) => sensorViewShortFovDeg(14.4, zoom);
  const w1024 = sensorViewGroundWidthM(alt, shortFov(1024)) / 1000;
  const w8192 = sensorViewGroundWidthM(alt, shortFov(8192)) / 1000;
  expect(Math.abs(w1024 - 10) / 10).toBeLessThan(0.05);
  expect(Math.abs(w8192 - 1.3) / 1.3).toBeLessThan(0.05);
  // ซูมขึ้น 8 เท่า ความกว้างลด 8 เท่า (มุมแคบ = เชิงเส้น)
  expect(w1024 / w8192).toBeCloseTo(8, 4);
});

test("ground width agrees with the flat 2·h·tan(fov/2) for fov up to 2° and with the ray-traced sphere at every fov", () => {
  for (const alt of [800, 20200, 35786]) {
    for (const fov of [0.004, 0.0295, 0.24, 1, 2]) {
      const flat = 2 * alt * 1000 * Math.tan((fov / 2) * D);
      const exact = sensorViewGroundWidthM(alt, fov);
      expect(Math.abs(exact - flat) / flat, `alt ${alt} fov ${fov}`).toBeLessThan(0.01);
      expect(exact, `alt ${alt} fov ${fov}`).toBeCloseTo(groundWidthByRays(alt, fov), 3);
    }
    for (const fov of [5, 20, 40, 90, 120]) {
      expect(sensorViewGroundWidthM(alt, fov), `alt ${alt} fov ${fov}`).toBeCloseTo(groundWidthByRays(alt, fov), 3);
    }
  }
});

test("ground width beyond the flat regime: the sphere is wider than the flat estimate, and a fov wider than the Earth disc stops at the horizon", () => {
  // LEO 800 km, fov 40°: ดาวมองลงตรงขอบภาพยังตัดโลก; ผิวโลกโค้งหนีดาว จึงกว้างกว่า 2·h·tan(fov/2) (≈ 582 km)
  const leo = sensorViewGroundWidthM(800, 40) / 1000;
  expect(leo).toBeGreaterThan(2 * 800 * Math.tan(20 * D));
  expect(leo).toBeCloseTo(587.5, 1);
  // GPS fov ×1 (30.2°) กว้างกว่าจานโลก (27.8°): ความกว้าง = 2·Re·acos(Re/(Re+h)) ≈ 16,930 km (ขอบฟ้า) ไม่ใช่ 2·h·tan(15.1°) ≈ 10,900 km
  const horizon = 2 * RE * 1000 * Math.acos(RE / (RE + 20200));
  const full = sensorViewGroundWidthM(20200, sensorViewShortFovDeg(14.4, 1));
  expect(full).toBeCloseTo(horizon, 3);
  expect(full / 1000).toBeGreaterThan(16000);
  expect(sensorViewGroundWidthM(20200, 120)).toBeCloseTo(horizon, 3); // fov กว้างขึ้นอีกก็ไม่เกินขอบฟ้า
});

test("ground width of a degenerate view is 0", () => {
  expect(sensorViewGroundWidthM(20200, 0)).toBe(0);
  expect(sensorViewGroundWidthM(0, 10)).toBe(0); // ที่ผิวโลก ไม่เห็นพื้นที่ใต้ดาวเป็นความกว้าง
  expect(sensorViewGroundWidthM(-5, 10)).toBe(0);
  expect(sensorViewGroundWidthM(Number.NaN, 10)).toBe(0);
  expect(sensorViewGroundWidthM(20200, Number.NaN)).toBe(0);
});

test("needed imagery level: the level whose ground pixel (2πRe / (256·2^z) m/px at the equator) is no coarser than width / pixels", () => {
  const RE_M = RE * 1000;
  const metresPerPx = (z: number) => (2 * Math.PI * RE_M) / (256 * 2 ** z);
  // ตัวอย่างในมือ: 10 km บน 600 px = 16.7 m/px: ระดับ 14 ได้ 9.5 m/px, ระดับ 13 ได้ 19.1 m/px (หยาบเกิน)
  expect(neededImageryLevel(10_000, 600)).toBe(14);
  expect(metresPerPx(14)).toBeLessThanOrEqual(10_000 / 600);
  expect(metresPerPx(13)).toBeGreaterThan(10_000 / 600);
  // ทุกขนาดภาพ: ระดับที่ได้พอดี และระดับที่ต่ำลงหนึ่งขั้นหยาบเกิน
  for (const width of [1_300, 10_400, 250_000, 1_000_000]) {
    for (const px of [240, 600, 1080]) {
      const z = neededImageryLevel(width, px)!;
      expect(metresPerPx(z), `${width} m / ${px}px`).toBeLessThanOrEqual(width / px);
      if (z > 0) expect(metresPerPx(z - 1), `${width} m / ${px}px`).toBeGreaterThan(width / px);
    }
  }
  // ขอบของขั้น: กว้างขึ้น 0.1% จากจุดที่ระดับ 10 พอดี = 10, แคบลง 0.1% = 11
  const exact10 = (2 * Math.PI * RE_M * 256) / (256 * 2 ** 10);
  expect(neededImageryLevel(exact10 * 1.001, 256)).toBe(10);
  expect(neededImageryLevel(exact10 * 0.999, 256)).toBe(11);
  // สูตรเดียวกับ brief: ceil(log2(2πR / (width / px · 256)))
  expect(neededImageryLevel(1_300, 600)).toBe(Math.ceil(Math.log2((2 * Math.PI * RE_M) / ((1_300 / 600) * 256))));
});

test("needed imagery level never goes below 0, and bad input has no level", () => {
  expect(neededImageryLevel(40_000_000, 1)).toBe(0); // ทั้งโลกในหนึ่งพิกเซล
  expect(neededImageryLevel(0, 600)).toBeNull();
  expect(neededImageryLevel(-1, 600)).toBeNull();
  expect(neededImageryLevel(10_000, 0)).toBeNull();
  expect(neededImageryLevel(Number.NaN, 600)).toBeNull();
  expect(neededImageryLevel(10_000, Number.POSITIVE_INFINITY)).toBeNull();
});

test("sensorViewZoomForGroundWidth inverts the ground width within 1 % and clamps to the zoom range", () => {
  const widthAt = (alt: number, alpha: number, zoom: number) => sensorViewGroundWidthM(alt, sensorViewShortFovDeg(alpha, zoom));
  for (const [alt, alpha] of [[GPS_H, 14.4], [800, 30], [35786, 8.7]] as const) {
    for (const target of [50, 500, 1500, 10_000, 250_000]) {
      const zoom = sensorViewZoomForGroundWidth(alt, alpha, target);
      expect(zoom, `${alt} km, ${alpha}°, ${target} m`).not.toBeNull();
      const got = widthAt(alt, alpha, zoom!);
      if (zoom! > 1 && zoom! < 262144) expect(Math.abs(got - target) / target, `${alt} km, ${alpha}°, ${target} m`).toBeLessThan(0.01);
    }
  }
  // แคบกว่าที่ ×262144 เห็น = ×262144 ; กว้างกว่าภาพที่ ×1 (ถึงขอบฟ้า) = ×1
  expect(widthAt(GPS_H, 14.4, 262144)).toBeGreaterThan(1);
  expect(sensorViewZoomForGroundWidth(GPS_H, 14.4, 1)).toBe(262144);
  expect(sensorViewZoomForGroundWidth(GPS_H, 14.4, 1e9)).toBe(1);
  expect(sensorViewZoomForGroundWidth(GPS_H, 14.4, widthAt(GPS_H, 14.4, 1))).toBe(1);
  // ช่วงที่ส่งเอง
  expect(sensorViewZoomForGroundWidth(GPS_H, 14.4, 1, 1, 8192)).toBe(8192);
  // ไม่มีคำตอบ: ดาวไม่อยู่เหนือพื้น หรือความกว้างไม่ใช่จำนวนบวก
  expect(sensorViewZoomForGroundWidth(0, 14.4, 500)).toBeNull();
  expect(sensorViewZoomForGroundWidth(GPS_H, 14.4, 0)).toBeNull();
  expect(sensorViewZoomForGroundWidth(GPS_H, 14.4, Number.NaN)).toBeNull();
});
