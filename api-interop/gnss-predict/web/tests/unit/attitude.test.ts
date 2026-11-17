// ท่าทางของโมเดลดาว (src/cesium/attitude.ts, models integration spec §3): yaw steering ของ GNSS, เฟรม sensor §3.1 ของดาวสำรวจโลก,
// quaternion ตัวดาว→ECEF, มุมแผงโซลาร์รอบ +Y และตำแหน่งดวงอาทิตย์ ECEF ที่ตรงกับแสงของหน้าต่าง 3D
// ตรวจทิศดวงอาทิตย์กับสูตรอิสระ (Astronomical Almanac แบบความแม่นยำต่ำ + การหมุน GMST) ที่ไม่ใช้ Cesium

import { Cartesian3, JulianDate, Matrix3, Quaternion, Simon1994PlanetaryPositions, Transforms } from "cesium";
import { describe, expect, test } from "vitest";
import {
  bodyToEcefQuaternion,
  nadirVelocityFrame,
  sunPositionEcef,
  wingAngle,
  yawSteeringFrame,
  type AttitudeFrame,
} from "../../src/cesium/attitude";
import { bodyFrame } from "../../src/cesium/sensorGeometry";

const D = Math.PI / 180;
const AU = 1.495978707e11;
const angleDeg = (a: Cartesian3, b: Cartesian3): number => Cartesian3.angleBetween(a, b) / D;
const unit = (a: Cartesian3): Cartesian3 => Cartesian3.normalize(a, new Cartesian3());
const sub = (a: Cartesian3, b: Cartesian3): Cartesian3 => Cartesian3.subtract(a, b, new Cartesian3());
/** ทิศจากดาวไปดวงอาทิตย์ es = (s − r)/|s − r| */
const sunDir = (sun: Cartesian3, r: Cartesian3): Cartesian3 => unit(sub(sun, r));
/** เวกเตอร์ในพิกัดตัวดาว (b.x, b.y, b.z) เป็น ECEF: b.x·ex + b.y·ey + b.z·ez */
function bodyToEcef(f: AttitudeFrame, b: Cartesian3): Cartesian3 {
  const out = Cartesian3.multiplyByScalar(f.ex, b.x, new Cartesian3());
  Cartesian3.add(out, Cartesian3.multiplyByScalar(f.ey, b.y, new Cartesian3()), out);
  return Cartesian3.add(out, Cartesian3.multiplyByScalar(f.ez, b.z, new Cartesian3()), out);
}

function expectOrthonormalRightHanded(f: AttitudeFrame): void {
  for (const a of [f.ex, f.ey, f.ez]) expect(Cartesian3.magnitude(a)).toBeCloseTo(1, 12);
  expect(Cartesian3.dot(f.ex, f.ey)).toBeCloseTo(0, 12);
  expect(Cartesian3.dot(f.ey, f.ez)).toBeCloseTo(0, 12);
  expect(Cartesian3.dot(f.ez, f.ex)).toBeCloseTo(0, 12);
  const xy = Cartesian3.cross(f.ex, f.ey, new Cartesian3());
  expect(Cartesian3.distance(xy, f.ez)).toBeLessThan(1e-12);
}

/** ดาวสมมติวงโคจรวงกลมเอียง 55° รัศมี GPS ที่มุมในวงโคจร u (ตำแหน่งกับความเร็วในกรอบ ECEF ณ t = 0 ถือว่ากรอบเฉื่อยทับกรอบโลก) */
function gpsState(uDeg: number): { r: Cartesian3; v: Cartesian3 } {
  const R = 26_560_000;
  const inc = 55 * D;
  const u = uDeg * D;
  const n = Math.sqrt(3.986004418e14 / R ** 3);
  const r = new Cartesian3(R * Math.cos(u), R * Math.sin(u) * Math.cos(inc), R * Math.sin(u) * Math.sin(inc));
  const vi = new Cartesian3(-R * n * Math.sin(u), R * n * Math.cos(u) * Math.cos(inc), R * n * Math.cos(u) * Math.sin(inc));
  // v_ECEF = v_I − ω⊕ × r
  const w = 7.292115e-5;
  const v = new Cartesian3(vi.x + w * r.y, vi.y - w * r.x, vi.z);
  return { r, v };
}

/** ดวงอาทิตย์ที่ระยะ 1 AU ในทิศ (lonDeg, latDeg) ของกรอบ ECEF */
const sunAt = (lonDeg: number, latDeg: number): Cartesian3 =>
  new Cartesian3(AU * Math.cos(latDeg * D) * Math.cos(lonDeg * D), AU * Math.cos(latDeg * D) * Math.sin(lonDeg * D), AU * Math.sin(latDeg * D));

const SUNS = [sunAt(0, 0), sunAt(73, 20), sunAt(200, -23.4), sunAt(310, 10), sunAt(140, 5)];
const POSES = [0, 37, 95, 180, 251, 333].map(gpsState);

describe("yaw steering (GNSS)", () => {
  test("the frame is orthonormal, right-handed and +Z points at the Earth's centre", () => {
    for (const { r, v } of POSES)
      for (const sun of SUNS) {
        const f = yawSteeringFrame(r, v, sun);
        expect(f).not.toBeNull();
        expectOrthonormalRightHanded(f!);
        const down = unit(Cartesian3.negate(r, new Cartesian3()));
        expect(Cartesian3.dot(f!.ez, down)).toBeGreaterThan(Math.cos(0.1 * D));
      }
  });

  test("the sun lies in the body X-Z plane on the +X side", () => {
    for (const { r, v } of POSES)
      for (const sun of SUNS) {
        const f = yawSteeringFrame(r, v, sun)!;
        const es = sunDir(sun, r);
        expect(Math.abs(Cartesian3.dot(es, f.ey))).toBeLessThan(1e-12);
        // POSES[0] กับ SUNS[0] ดวงอาทิตย์อยู่เหนือหัวพอดี (กรณีเอกฐาน ถอยไปเฟรม sensor) es·ex = 0 ถึงระดับปัดเศษ
        expect(Cartesian3.dot(es, f.ex)).toBeGreaterThanOrEqual(-1e-12);
      }
  });

  test("ey is ez × es normalised", () => {
    const { r, v } = POSES[1];
    const sun = SUNS[1];
    const f = yawSteeringFrame(r, v, sun)!;
    const want = unit(Cartesian3.cross(f.ez, sunDir(sun, r), new Cartesian3()));
    expect(Cartesian3.distance(f.ey, want)).toBeLessThan(1e-12);
  });

  test("singular case (sun on the nadir line) reuses the previous ey", () => {
    const { r, v } = POSES[2];
    // ดวงอาทิตย์อยู่หลังโลกพอดี: s − r ขนานกับ −r̂ = ez
    const sun = Cartesian3.multiplyByScalar(unit(r), -AU, new Cartesian3());
    const ez = unit(Cartesian3.negate(r, new Cartesian3()));
    // ey ก่อนหน้าที่ตั้งฉากกับ ez (หมุนจาก ex ของเฟรม sensor ไปพอสมควร) บวกส่วนเล็ก ๆ ตามแนว ez เพื่อดูว่าถูกฉายออก
    const sensor = nadirVelocityFrame(r, v)!;
    const prevEy = unit(
      Cartesian3.add(
        Cartesian3.add(Cartesian3.multiplyByScalar(sensor.ex, 0.6, new Cartesian3()), Cartesian3.multiplyByScalar(sensor.ey, 0.8, new Cartesian3()), new Cartesian3()),
        Cartesian3.multiplyByScalar(ez, 1e-3, new Cartesian3()),
        new Cartesian3(),
      ),
    );
    const f = yawSteeringFrame(r, v, sun, prevEy)!;
    expectOrthonormalRightHanded(f);
    expect(Cartesian3.distance(f.ez, ez)).toBeLessThan(1e-12);
    expect(angleDeg(f.ey, prevEy)).toBeLessThan(0.1);
    expect(Math.abs(Cartesian3.dot(f.ey, ez))).toBeLessThan(1e-12);
  });

  test("nearly singular (|ez × es| < 1e-6) also reuses the previous ey", () => {
    const { r, v } = POSES[3];
    const ez = unit(Cartesian3.negate(r, new Cartesian3()));
    const sensor = nadirVelocityFrame(r, v)!;
    // es เอียงจาก ez 1e-7 rad ไปทาง ex ของ sensor: yaw steering ปกติจะให้ ey = sensor.ey แต่กรณีนี้ต้องใช้ prevEy
    const tilt = Cartesian3.add(ez, Cartesian3.multiplyByScalar(sensor.ex, 1e-7, new Cartesian3()), new Cartesian3());
    const sun = Cartesian3.add(r, Cartesian3.multiplyByScalar(unit(tilt), AU, new Cartesian3()), new Cartesian3());
    const prevEy = Cartesian3.negate(sensor.ex, new Cartesian3());
    const f = yawSteeringFrame(r, v, sun, prevEy)!;
    expectOrthonormalRightHanded(f);
    expect(angleDeg(f.ey, prevEy)).toBeLessThan(1e-6);
  });

  test("singular case without a previous ey falls back to the sensor §3.1 frame", () => {
    const { r, v } = POSES[4];
    const sun = Cartesian3.multiplyByScalar(unit(r), -AU, new Cartesian3());
    const f = yawSteeringFrame(r, v, sun)!;
    const s = nadirVelocityFrame(r, v)!;
    expect(Cartesian3.distance(f.ex, s.ex)).toBeLessThan(1e-12);
    expect(Cartesian3.distance(f.ey, s.ey)).toBeLessThan(1e-12);
    expect(Cartesian3.distance(f.ez, s.ez)).toBeLessThan(1e-12);
  });

  test("a zero position gives no frame", () => {
    expect(yawSteeringFrame(Cartesian3.ZERO, new Cartesian3(1, 0, 0), SUNS[0])).toBeNull();
  });

  test("writes into a result frame when one is given", () => {
    const { r, v } = POSES[0];
    const result: AttitudeFrame = { ex: new Cartesian3(), ey: new Cartesian3(), ez: new Cartesian3() };
    const f = yawSteeringFrame(r, v, SUNS[2], undefined, result);
    expect(f).toBe(result);
    expect(f!.ex).toBe(result.ex);
    expectOrthonormalRightHanded(result);
  });
});

describe("nadir with ECI velocity constraint (Earth-observation satellites)", () => {
  test("matches the sensor §3.1 frame in sensorGeometry", () => {
    const leo = { r: new Cartesian3(7_000_000, 0, 0), v: new Cartesian3(0, 1_000, 7_400) };
    for (const { r, v } of [...POSES, leo]) {
      const f = nadirVelocityFrame(r, v)!;
      const s = bodyFrame(r, v)!;
      expect(Cartesian3.distance(f.ex, new Cartesian3(s.x.x, s.x.y, s.x.z))).toBeLessThan(1e-15);
      expect(Cartesian3.distance(f.ey, new Cartesian3(s.y.x, s.y.y, s.y.z))).toBeLessThan(1e-15);
      expect(Cartesian3.distance(f.ez, new Cartesian3(s.z.x, s.z.y, s.z.z))).toBeLessThan(1e-15);
      expectOrthonormalRightHanded(f);
    }
  });

  test("no frame where the sensor frame has none", () => {
    expect(nadirVelocityFrame(Cartesian3.ZERO, new Cartesian3(1, 0, 0))).toBeNull();
    // ความเร็วเฉื่อยขนานกับ r: ดาวที่ขั้วโลกเคลื่อนขึ้นตรง ๆ
    expect(nadirVelocityFrame(new Cartesian3(0, 0, 7e6), new Cartesian3(0, 0, 100))).toBeNull();
  });
});

describe("body → ECEF quaternion", () => {
  test("rotates body +X, +Y, +Z onto ex, ey, ez", () => {
    for (const { r, v } of POSES)
      for (const sun of SUNS) {
        const f = yawSteeringFrame(r, v, sun)!;
        const m = Matrix3.fromQuaternion(bodyToEcefQuaternion(f), new Matrix3());
        const axes: [Cartesian3, Cartesian3][] = [
          [Cartesian3.UNIT_X, f.ex],
          [Cartesian3.UNIT_Y, f.ey],
          [Cartesian3.UNIT_Z, f.ez],
        ];
        for (const [body, want] of axes) {
          const got = Matrix3.multiplyByVector(m, body, new Cartesian3());
          expect(Cartesian3.distance(got, want)).toBeLessThan(1e-9);
        }
      }
  });

  test("identity frame gives the identity quaternion", () => {
    const q = bodyToEcefQuaternion({ ex: Cartesian3.UNIT_X, ey: Cartesian3.UNIT_Y, ez: Cartesian3.UNIT_Z });
    expect(Quaternion.equalsEpsilon(q, Quaternion.IDENTITY, 1e-15) || Quaternion.equalsEpsilon(q, new Quaternion(0, 0, 0, -1), 1e-15)).toBe(true);
  });
});

describe("solar wing angle about body +Y", () => {
  /** หมุน normal ตอนมุมศูนย์ด้วย node rotation แบบที่ Task 3 ใช้ แล้วแปลงเป็น ECEF */
  function rotatedNormalEcef(f: AttitudeFrame, zeroNormal: Cartesian3, θ: number): Cartesian3 {
    const m = Matrix3.fromQuaternion(Quaternion.fromAxisAngle(Cartesian3.UNIT_Y, θ), new Matrix3());
    return bodyToEcef(f, Matrix3.multiplyByVector(m, zeroNormal, new Cartesian3()));
  }

  const zeroNormals: [string, Cartesian3][] = [
    ["+X", Cartesian3.UNIT_X],
    ["+Z", Cartesian3.UNIT_Z],
    ["-Z", new Cartesian3(0, 0, -1)],
  ];

  for (const [name, n0] of zeroNormals)
    test(`GNSS: cells face the sun within 1° for zero normal ${name}`, () => {
      for (const { r, v } of POSES)
        for (const sun of SUNS) {
          const f = yawSteeringFrame(r, v, sun)!;
          const θ = wingAngle(f, sun, r, n0);
          expect(θ).toBeGreaterThan(-Math.PI - 1e-12);
          expect(θ).toBeLessThanOrEqual(Math.PI + 1e-12);
          expect(angleDeg(rotatedNormalEcef(f, n0, θ), sunDir(sun, r))).toBeLessThan(1);
        }
    });

  test("sign: sun at body +X turns a +Z (nadir) normal by +90°, a −Z normal by −90°, a +X normal by 0", () => {
    const f: AttitudeFrame = { ex: Cartesian3.UNIT_X, ey: Cartesian3.UNIT_Y, ez: Cartesian3.UNIT_Z };
    const r = new Cartesian3(0, 0, -26_560_000); // ez = −r̂ = +Z
    const sun = Cartesian3.add(r, new Cartesian3(AU, 0, 0), new Cartesian3()); // es = +X
    expect(wingAngle(f, sun, r, Cartesian3.UNIT_Z)).toBeCloseTo(Math.PI / 2, 12);
    expect(wingAngle(f, sun, r, new Cartesian3(0, 0, -1))).toBeCloseTo(-Math.PI / 2, 12);
    expect(wingAngle(f, sun, r, Cartesian3.UNIT_X)).toBeCloseTo(0, 12);
  });

  test("Earth-observation: the rotated normal is es projected onto X-Z, off the sun only by β", () => {
    const leo = { r: new Cartesian3(7_000_000, 0, 0), v: new Cartesian3(0, 1_000, 7_400) };
    for (const { r, v } of [...POSES, leo])
      for (const sun of SUNS) {
        const f = nadirVelocityFrame(r, v)!;
        const es = sunDir(sun, r);
        const proj = unit(
          Cartesian3.add(Cartesian3.multiplyByScalar(f.ex, Cartesian3.dot(es, f.ex), new Cartesian3()), Cartesian3.multiplyByScalar(f.ez, Cartesian3.dot(es, f.ez), new Cartesian3()), new Cartesian3()),
        );
        const β = Math.asin(Math.abs(Cartesian3.dot(es, f.ey))) / D;
        for (const [, n0] of zeroNormals) {
          const n = rotatedNormalEcef(f, n0, wingAngle(f, sun, r, n0));
          expect(angleDeg(n, proj)).toBeLessThan(1e-6);
          expect(angleDeg(n, es)).toBeCloseTo(β, 6);
        }
      }
  });

  test("sun along ±Y (no X-Z component) gives 0", () => {
    const f: AttitudeFrame = { ex: Cartesian3.UNIT_X, ey: Cartesian3.UNIT_Y, ez: Cartesian3.UNIT_Z };
    const r = new Cartesian3(0, 0, -26_560_000);
    const sun = Cartesian3.add(r, new Cartesian3(0, AU, 0), new Cartesian3());
    expect(wingAngle(f, sun, r, Cartesian3.UNIT_Z)).toBe(0);
  });
});

describe("sun position in ECEF", () => {
  /** สูตรอิสระ: Astronomical Almanac (low precision, ±0.01° ปี 1950–2050) ในกรอบ mean equator/equinox of date แล้วหมุนด้วย GMST (UT1 ≈ UTC) */
  function almanacSunEcef(iso: string): Cartesian3 {
    const jd = Date.parse(iso) / 86_400_000 + 2_440_587.5;
    const n = jd - 2_451_545.0;
    const L = 280.46 + 0.9856474 * n;
    const g = (357.528 + 0.9856003 * n) * D;
    const λ = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * D;
    const ε = (23.439 - 0.0000004 * n) * D;
    const R = (1.00014 - 0.01671 * Math.cos(g) - 0.00014 * Math.cos(2 * g)) * AU;
    const x = R * Math.cos(λ);
    const y = R * Math.cos(ε) * Math.sin(λ);
    const z = R * Math.sin(ε) * Math.sin(λ);
    const gmst = ((280.46061837 + 360.98564736629 * n) % 360) * D;
    return new Cartesian3(Math.cos(gmst) * x + Math.sin(gmst) * y, -Math.sin(gmst) * x + Math.cos(gmst) * y, z);
  }

  for (const iso of ["2026-11-14T06:00:00Z", "2026-03-20T14:46:00Z", "2026-06-21T00:00:00Z", "2027-01-03T18:30:00Z"])
    test(`within 0.5° of the Astronomical Almanac sun at ${iso}`, () => {
      const got = sunPositionEcef(JulianDate.fromIso8601(iso));
      const want = almanacSunEcef(iso);
      expect(angleDeg(got, want)).toBeLessThan(0.5);
      expect(Cartesian3.magnitude(got) / Cartesian3.magnitude(want)).toBeCloseTo(1, 3);
    });

  test("is what the 3D window lights the globe with (ICRF→fixed, TEME fallback)", () => {
    const t = JulianDate.fromIso8601("2026-11-14T06:00:00Z");
    // UniformState.setSunAndMoonDirections: computeIcrfToCentralBodyFixedMatrix × Simon1994 sun (Earth inertial)
    const m = Transforms.computeIcrfToCentralBodyFixedMatrix(t, new Matrix3())!;
    const want = Matrix3.multiplyByVector(m, Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(t, new Cartesian3()), new Cartesian3());
    expect(Cartesian3.distance(sunPositionEcef(t), want) / Cartesian3.magnitude(want)).toBeLessThan(1e-12);
  });

  test("writes into a result when one is given", () => {
    const result = new Cartesian3();
    expect(sunPositionEcef(JulianDate.fromIso8601("2026-11-14T06:00:00Z"), result)).toBe(result);
  });
});
