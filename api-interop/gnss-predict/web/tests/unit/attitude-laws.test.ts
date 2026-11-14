// กฎท่าทางรายรุ่นของดาว GNSS (src/cesium/attitudeLaws.ts, docs/2026-11-14-gnss-attitude-laws.md §1–§4)
// วงโคจรวงกลมสมมติที่ β = ±0.5°, ±2°, 5°, 15° (และ 25° ให้ QZS-1): ตั้งดวงอาทิตย์ที่ (cos β, 0, sin β) · 1 AU ของระนาบวงโคจร XY
// แล้วหมุนทั้งชุดด้วยการหมุนคงที่ (ไม่ให้แกนตรงกับแกนของ ECEF) ถือว่ากรอบเฉื่อยทับ ECEF ณ ขณะนั้น: v_ECEF = v_I − ω⊕ × r
// μ วัดจากเที่ยงคืน (ดาวอยู่หลังโลก) ไปตามทิศเคลื่อนที่: ตำแหน่งในระนาบ u = μ + 180°

import { Cartesian3, JulianDate, Matrix3, Quaternion } from "cesium";
import { describe, expect, test } from "vitest";
import {
  ATTITUDE_LAWS, attitudeLawFor, ESTIMATED_LAWS, inEarthShadow, lawAttitude, nominalYaw, type AttitudeLaw, type LawAttitude,
} from "../../src/cesium/attitudeLaws";
import { yawSteeringFrame } from "../../src/cesium/attitude";

const D = Math.PI / 180;
const GM = 3.986004418e14;
const OMEGA = 7.292115e-5;
const AU = 1.495978707e11;
const RE = 6_378_137;
const T0 = JulianDate.fromIso8601("2026-11-14T00:00:00Z");

const RADIUS = { gps: 26_560e3, glo: 25_510e3, gal: 29_600e3, meo: 27_906e3, geo: 42_164e3 } as const;
type Orbit = keyof typeof RADIUS;

const TILT = Matrix3.fromQuaternion(Quaternion.fromAxisAngle(Cartesian3.normalize(new Cartesian3(1, 2, 3), new Cartesian3()), 0.7));
const tilt = (x: number, y: number, z: number): Cartesian3 => Matrix3.multiplyByVector(TILT, new Cartesian3(x, y, z), new Cartesian3());
const wrapDeg = (a: number): number => ((((a + 180) % 360) + 360) % 360) - 180;

interface Pose {
  r: Cartesian3;
  v: Cartesian3;
  sun: Cartesian3;
  t: JulianDate;
  /** แกนของกรอบ ON ที่สร้างขึ้นเอง (ไม่ใช้โค้ดที่ทดสอบ) */
  xOn: Cartesian3;
  yOn: Cartesian3;
  zOn: Cartesian3;
  /** h = r × v_I หนึ่งหน่วย */
  h: Cartesian3;
}

/** ดาววงโคจรวงกลมรัศมีของ orbit ที่ β (องศา) และ μ (องศา) */
function pose(orbit: Orbit, betaDeg: number, muDeg: number): Pose {
  const R = RADIUS[orbit];
  const n = Math.sqrt(GM / R ** 3);
  const u = (muDeg + 180) * D;
  const r = tilt(R * Math.cos(u), R * Math.sin(u), 0);
  const vi = tilt(-R * n * Math.sin(u), R * n * Math.cos(u), 0);
  const v = new Cartesian3(vi.x + OMEGA * r.y, vi.y - OMEGA * r.x, vi.z);
  const b = betaDeg * D;
  const sun = Cartesian3.multiplyByScalar(tilt(Math.cos(b), 0, Math.sin(b)), AU, new Cartesian3());
  const h = tilt(0, 0, 1);
  const zOn = Cartesian3.normalize(Cartesian3.negate(r, new Cartesian3()), new Cartesian3());
  const yOn = Cartesian3.negate(h, new Cartesian3());
  const xOn = Cartesian3.cross(yOn, zOn, new Cartesian3());
  return { r, v, sun, t: JulianDate.addSeconds(T0, (muDeg * D) / n, new JulianDate()), xOn, yOn, zOn, h };
}

const meanMotionDeg = (orbit: Orbit): number => Math.sqrt(GM / RADIUS[orbit] ** 3) / D;

function at(law: AttitudeLaw, orbit: Orbit, betaDeg: number, muDeg: number): LawAttitude {
  const p = pose(orbit, betaDeg, muDeg);
  const a = ATTITUDE_LAWS[law](p.r, p.v, p.sun, p.t);
  expect(a, `${law} β=${betaDeg} μ=${muDeg}`).not.toBeNull();
  return a!;
}

/** ψ (องศา) ตามเวลาด้วยก้าว dt (s) ในช่วง μ ∈ [from, to] (องศา) */
function series(law: AttitudeLaw, orbit: Orbit, betaDeg: number, from: number, to: number, dt: number): { mu: number; psi: number; a: LawAttitude }[] {
  const step = meanMotionDeg(orbit) * dt;
  const out: { mu: number; psi: number; a: LawAttitude }[] = [];
  for (let mu = from; mu <= to + 1e-9; mu += step) {
    const a = at(law, orbit, betaDeg, mu);
    out.push({ mu, psi: a.yaw / D, a });
  }
  return out;
}

/** อัตราหมุน |ψ̇| สูงสุด (องศา/วินาที) จากผลต่างของตัวอย่างที่ห่าง dt */
function maxRate(s: { psi: number }[], dt: number): number {
  let m = 0;
  for (let i = 1; i < s.length; i++) m = Math.max(m, Math.abs(wrapDeg(s[i].psi - s[i - 1].psi)) / dt);
  return m;
}

/** วงโคจรและอัตราหมุนสูงสุดที่กฎยอมให้ (องศา/วินาที, null = ไม่จำกัด: ใช้อัตราสูงสุดของ nominal n/tan|β|) */
const LAWS: Record<AttitudeLaw, { orbit: Orbit; rate: (betaDeg: number, nDeg: number) => number | null }> = {
  nominal_ys: { orbit: "gps", rate: () => null },
  orbit_normal: { orbit: "geo", rate: () => 0 },
  nadir_velocity: { orbit: "gps", rate: () => 0 },
  gps_iir: { orbit: "gps", rate: () => 0.2 },
  gps_iif: { orbit: "gps", rate: () => 0.11 },
  gps_iii: { orbit: "gps", rate: () => 0.082 },
  glonass_m: { orbit: "glo", rate: () => 0.25 },
  glonass_k: { orbit: "glo", rate: () => 0.24987 },
  galileo_iov: { orbit: "gal", rate: () => 0.2 },
  galileo_foc: { orbit: "gal", rate: () => 0.1 },
  bds2_ys_on: { orbit: "meo", rate: (b) => (Math.abs(b) <= 4 ? 0 : null) },
  bds3_cast: { orbit: "meo", rate: (b, n) => (Math.abs(b) <= 3 ? (1.1 * n) / Math.tan(3 * D) : null) },
  bds3_secm: { orbit: "meo", rate: (b, n) => (Math.abs(b) <= 3 ? n / Math.tan(3 * D) : null) },
  qzss1_ys_on: { orbit: "geo", rate: (b) => (Math.abs(b) <= 20 ? 0 : null) },
  qzss2_pseudo_ys: { orbit: "geo", rate: () => 0.055 },
  navic: { orbit: "geo", rate: (b) => (Math.abs(b) < 4 ? 0 : null) },
};
const ALL = Object.keys(LAWS) as AttitudeLaw[];
const BETAS = [0.5, 2, 5, 15, -0.5, -2];
/** β ที่อยู่นอกช่วงพิเศษของกฎ (ท่าทาง = nominal YS ทั้งรอบ) */
const OUTSIDE: Partial<Record<AttitudeLaw, number>> = { qzss1_ys_on: 25 };

const nominalDeg = (a: LawAttitude): number => nominalYaw(a.beta, a.mu) / D;

describe("attitudeLawFor (spec §3.1, §4.2)", () => {
  test.each([
    [["GPS-IIR-A", "GPS-IIR-B", "GPS-IIR-M"], "gps_iir"],
    [["GPS-IIF"], "gps_iif"],
    [["GPS-III", "GPS-IIIA", "GPS-III-1"], "gps_iii"],
    [["GLO-M", "GLO-M+"], "glonass_m"],
    [["GLO-K1", "GLO-K1+", "GLO-K1A", "GLO-K1B", "GLO-K2"], "glonass_k"],
    [["GAL-1"], "galileo_iov"],
    [["GAL-2"], "galileo_foc"],
    [["BDS-2G", "BDS-3G", "QZS-2G", "QZS-3G"], "orbit_normal"],
    [["BDS-2I", "BDS-2M"], "bds2_ys_on"],
    [["BDS-3M-CAST", "BDS-3I", "BDS-3SM-CAST", "BDS-3SI-CAST"], "bds3_cast"],
    [["BDS-3M-SECM-A", "BDS-3M-SECM-B", "BDS-3SM-SECM", "BDS-3SI-SECM"], "bds3_secm"],
    [["QZS-1"], "qzss1_ys_on"],
    [["QZS-2I", "QZS-2A"], "qzss2_pseudo_ys"],
    [["IRS-1G", "IRS-1I", "IRS-2G", "IRS-2I"], "navic"],
  ] as const)("%j → %s", (blocks, law) => {
    for (const b of blocks) expect(attitudeLawFor(b, false), b).toBe(law);
  });

  test("unknown, retired or missing blocks get nominal yaw steering; EO models keep the nadir + velocity frame whatever the block", () => {
    for (const b of ["GPS-IIA", "GPS-I", "GAL-0A", "GLO", "BDS-3S", "NOT-A-BLOCK", "", null]) expect(attitudeLawFor(b, false), String(b)).toBe("nominal_ys");
    for (const b of [null, "GPS-IIF", "BDS-2G"]) expect(attitudeLawFor(b, true)).toBe("nadir_velocity");
  });

  test("estimated laws are flagged: NavIC (no ISRO spec), GPS III (smoothing constant fitted), GLONASS-K (ramps left out)", () => {
    expect([...ESTIMATED_LAWS].sort()).toEqual(["glonass_k", "gps_iii", "navic"]);
  });
});

describe("orbit-Sun geometry and sign conventions (spec §1.2, §1.3)", () => {
  test("β is the Sun's elevation toward +h and μ is measured from midnight along the motion", () => {
    for (const beta of [0.5, -2, 15, 40])
      for (const mu of [-170, -90, -10, 0, 30, 90, 179]) {
        const a = at("nominal_ys", "gps", beta, mu);
        expect(a.beta / D).toBeCloseTo(beta, 1);
        expect(wrapDeg(a.mu / D - mu)).toBeCloseTo(0, 1);
      }
  });

  test("yaw is a right-handed rotation about +Z_ON from +x_ON toward +y_ON = −h: ex = cos ψ x_ON + sin ψ y_ON", () => {
    for (const law of ALL)
      for (const beta of BETAS)
        for (const mu of [-120, -3, 0.5, 45, 178]) {
          const p = pose(LAWS[law].orbit, beta, mu);
          const a = ATTITUDE_LAWS[law](p.r, p.v, p.sun, p.t)!;
          expect(Cartesian3.dot(a.frame.ex, p.xOn), `${law} β=${beta} μ=${mu}`).toBeCloseTo(Math.cos(a.yaw), 9);
          expect(Cartesian3.dot(a.frame.ex, p.yOn), `${law} β=${beta} μ=${mu}`).toBeCloseTo(Math.sin(a.yaw), 9);
        }
  });

  test("nominal YS: the Sun in the body X-Z plane on +X, ψ = −90° at midnight and noon for β > 0 (+90° for β < 0), same frame as yawSteeringFrame", () => {
    for (const beta of BETAS) {
      for (const mu of [-150, -60, -1, 1, 70, 150]) {
        const p = pose("gps", beta, mu);
        const a = ATTITUDE_LAWS.nominal_ys(p.r, p.v, p.sun, p.t)!;
        const es = Cartesian3.normalize(Cartesian3.subtract(p.sun, p.r, new Cartesian3()), new Cartesian3());
        expect(Cartesian3.dot(es, a.frame.ey)).toBeCloseTo(0, 12);
        expect(Cartesian3.dot(es, a.frame.ex)).toBeGreaterThan(0);
        const ys = yawSteeringFrame(p.r, p.v, p.sun)!;
        expect(Cartesian3.distance(ys.ex, a.frame.ex)).toBeLessThan(1e-9);
        expect(Cartesian3.distance(ys.ey, a.frame.ey)).toBeLessThan(1e-9);
      }
      for (const node of [0, 180]) expect(wrapDeg(at("nominal_ys", "gps", beta, node).yaw / D + 90 * Math.sign(beta))).toBeCloseTo(0, 0);
    }
  });

  test("cylindrical Earth shadow: behind the Earth within one Earth radius of the Sun line", () => {
    const sHat = new Cartesian3(1, 0, 0);
    expect(inEarthShadow(new Cartesian3(-26e6, 6e6, 0), sHat)).toBe(true);
    expect(inEarthShadow(new Cartesian3(-26e6, RE + 1, 0), sHat)).toBe(false);
    expect(inEarthShadow(new Cartesian3(26e6, 0, 0), sHat)).toBe(false);
    expect(inEarthShadow(new Cartesian3(-26e6, 0, -RE + 1), sHat)).toBe(true);
  });
});

describe.each(ALL)("law %s", (law) => {
  const { orbit, rate } = LAWS[law];
  const n = meanMotionDeg(orbit);

  test("the frame is orthonormal, right-handed, +Z at the Earth's centre, at every β and μ", () => {
    for (const beta of BETAS)
      for (let mu = -180; mu < 180; mu += 7.3) {
        const p = pose(orbit, beta, mu);
        const { frame: f } = ATTITUDE_LAWS[law](p.r, p.v, p.sun, p.t)!;
        for (const e of [f.ex, f.ey, f.ez]) expect(Cartesian3.magnitude(e)).toBeCloseTo(1, 12);
        expect(Cartesian3.dot(f.ex, f.ey)).toBeCloseTo(0, 12);
        expect(Cartesian3.dot(f.ey, f.ez)).toBeCloseTo(0, 12);
        expect(Cartesian3.dot(f.ez, f.ex)).toBeCloseTo(0, 12);
        expect(Cartesian3.distance(Cartesian3.cross(f.ex, f.ey, new Cartesian3()), f.ez)).toBeLessThan(1e-12);
        expect(Cartesian3.distance(f.ez, p.zOn)).toBeLessThan(1e-12);
      }
  });

  test.each(BETAS)("β = %s°: ψ continuous across noon and midnight, |ψ̇| within the law's limit", (beta) => {
    const nominalPeak = n / Math.tan(Math.abs(beta) * D);
    const bound = (rate(beta, n) ?? nominalPeak) * 1.02 + 1e-4;
    const dt = 2;
    for (const node of [0, 180]) {
      const s = series(law, orbit, beta, node - 25, node + 25, dt);
      expect(maxRate(s, dt), `${law} β=${beta} node ${node}`).toBeLessThanOrEqual(bound);
    }
    // ทั้งรอบด้วยก้าวหยาบ: ไม่มีการกระโดดที่ใดเลย
    const coarse = series(law, orbit, beta, -180, 180, 0.5 / n);
    expect(maxRate(coarse, 0.5 / n), `${law} β=${beta} whole orbit`).toBeLessThanOrEqual(bound);
  });

  test("outside its regime the law is nominal yaw steering", () => {
    if (law === "orbit_normal" || law === "nadir_velocity") return;
    const beta = OUTSIDE[law] ?? 15;
    for (let mu = -180; mu < 180; mu += 1.7) {
      const a = at(law, orbit, beta, mu);
      expect(Math.abs(wrapDeg(a.yaw / D - nominalDeg(a))), `${law} μ=${mu}`).toBeLessThan(1e-9);
      expect(a.mode).toBe("YS");
    }
  });

  test("determinism: the answer at t does not depend on what was evaluated before (scrubbing = 250 ms throttle = playback)", () => {
    for (const beta of [0.5, 2]) {
      const fresh = [-3, -0.2, 0, 0.4, 179.5, 180.3].map((mu) => at(law, orbit, beta, mu));
      // ลำดับอื่น: ย้อนหลัง ก้าว 250 ms และกระโดดไกลก่อนถึงแต่ละจุด
      for (const [i, mu] of [-3, -0.2, 0, 0.4, 179.5, 180.3].entries()) {
        at(law, orbit, beta, mu + 90);
        at(law, orbit, beta, mu - n * 0.25);
        const again = at(law, orbit, beta, mu);
        expect(again.yaw).toBe(fresh[i].yaw);
        expect(again.mode).toBe(fresh[i].mode);
        expect(Cartesian3.equals(again.frame.ex, fresh[i].frame.ex)).toBe(true);
      }
    }
  });
});

describe("orbit-normal laws: ex along the velocity", () => {
  test.each([
    ["orbit_normal", 0.5],
    ["orbit_normal", 40],
    ["nadir_velocity", 15],
    ["bds2_ys_on", 2],
    ["qzss1_ys_on", 15],
    ["navic", -2],
  ] as const)("%s at β = %s°", (law, beta) => {
    for (const mu of [-170, -40, 0, 90, 180]) {
      const p = pose(LAWS[law].orbit, beta, mu);
      const a = ATTITUDE_LAWS[law](p.r, p.v, p.sun, p.t)!;
      expect(a.yaw).toBe(0);
      expect(a.mode).toBe("ON");
      expect(Cartesian3.distance(a.frame.ex, p.xOn)).toBeLessThan(1e-9);
      expect(Cartesian3.distance(a.frame.ey, p.yOn)).toBeLessThan(1e-9);
    }
  });
});

describe("block-specific turns", () => {
  test("GPS IIR (§3.2): centred slew at 0.20°/s through ψ = −90° at midnight and noon (β = 0.5°), back to nominal within 15 min", () => {
    for (const node of [0, 180]) {
      expect(at("gps_iir", "gps", 0.5, node).yaw / D).toBeCloseTo(-90, 6);
      const s = series("gps_iir", "gps", 0.5, node - 10, node + 10, 1);
      const turn = s.filter((x) => x.a.mode !== "YS");
      expect(turn.every((x) => x.a.mode === (node === 0 ? "MIDNIGHT_TURN" : "NOON_TURN"))).toBe(true);
      expect(turn.length).toBeGreaterThan(60);
      expect(turn.length).toBeLessThanOrEqual(15 * 60);
      for (let i = 1; i < turn.length; i++) expect(Math.abs(wrapDeg(turn[i].psi - turn[i - 1].psi))).toBeCloseTo(0.2, 3); // μ ของดาว (ทิศไปดวงอาทิตย์จากดาว) เดินต่างจาก n ราว R/AU
    }
    // β = 2.39° ขึ้นไป อัตรา nominal ไม่เกิน R: ไม่มีการหมุนพิเศษ
    expect(series("gps_iir", "gps", 2.5, -5, 5, 5).every((x) => x.a.mode === "YS")).toBe(true);
  });

  test("GPS IIF noon (§3.3): rate 0.11°/s; β in [−0.7°, 0) turns the other way (through −90° instead of +90°)", () => {
    expect(at("gps_iif", "gps", 1, 180).yaw / D).toBeCloseTo(-90, 6);
    expect(at("gps_iif", "gps", -1, 180).yaw / D).toBeCloseTo(90, 6);
    expect(at("gps_iif", "gps", -0.5, 180).yaw / D).toBeCloseTo(-90, 6);
    expect(at("gps_iif", "gps", -0.5, 180).mode).toBe("NOON_TURN");
  });

  test("GPS IIF shadow (§3.3): constant rate across the whole shadow, ending on nominal at shadow exit", () => {
    for (const beta of [0.5, 5, -2]) {
      const s = series("gps_iif", "gps", beta, -20, 20, 5);
      const shadow = s.filter((x) => x.a.mode === "SHADOW");
      expect(shadow.length).toBeGreaterThan(10);
      const rates = shadow.slice(1).map((x, i) => wrapDeg(x.psi - shadow[i].psi) / 5);
      for (const r of rates) expect(r).toBeCloseTo(rates[0], 6);
      expect(Math.abs(rates[0])).toBeLessThan(0.11);
      const p = pose("gps", beta, 0);
      expect(inEarthShadow(p.r, Cartesian3.normalize(Cartesian3.subtract(p.sun, p.r, new Cartesian3()), new Cartesian3()))).toBe(true);
    }
  });

  test("GLONASS-M (§3.5.1): at shadow entry slews at 0.25°/s to the exit yaw, then holds it until shadow exit", () => {
    const s = series("glonass_m", "glo", 0.5, -20, 20, 2);
    const shadow = s.filter((x) => x.a.mode === "SHADOW");
    const exitYaw = nominalDeg(s.find((x, i) => i > 0 && s[i - 1].a.mode === "SHADOW" && x.a.mode === "YS")!.a);
    const held = shadow.filter((x) => Math.abs(wrapDeg(x.psi - exitYaw)) < 0.5);
    expect(held.length * 2).toBeGreaterThan(30 * 60); // ค้างนานกว่า 30 นาทีในเงา (β ต่ำ หมุน 180° ใช้แค่ ~12 นาที)
    expect(maxRate(shadow, 2)).toBeCloseTo(0.25, 3);
    // ที่ noon: หมุนแบบสมมาตรผ่าน −90° ด้วย 0.25°/s
    expect(at("glonass_m", "glo", 0.5, 180).yaw / D).toBeCloseTo(-90, 6);
    expect(at("glonass_m", "glo", 0.5, 180).mode).toBe("NOON_TURN");
  });

  test("GLONASS-K (§3.5.2): symmetric centred turns at both midnight and noon (no shadow trigger)", () => {
    for (const node of [0, 180]) {
      const a = at("glonass_k", "glo", 0.5, node);
      expect(a.yaw / D).toBeCloseTo(-90, 6);
      const before = at("glonass_k", "glo", 0.5, node - 1).yaw / D;
      const after = at("glonass_k", "glo", 0.5, node + 1).yaw / D;
      expect(before + after).toBeCloseTo(-180, 6);
    }
  });

  test("Galileo IOV (§3.6.1): auxiliary Sun vector keeps |S_Hy| = sin 2° at S_ox = 0, so ψ = atan2(±sin 2°, 0) at the nodes", () => {
    for (const beta of [0.5, -0.5]) {
      for (const node of [0, 180]) {
        const a = at("galileo_iov", "gal", beta, node);
        expect(a.yaw / D).toBeCloseTo(-90 * Math.sign(beta), 6);
        expect(a.mode).toBe("SMOOTHED_TURN");
      }
      expect(at("galileo_iov", "gal", beta, 20).mode).toBe("YS"); // |S_ox| = sin 20° > sin 15°
    }
  });

  test("Galileo FOC (§3.6.2): cosine law from ε = 10° through ±90° at the node, half a 5656 s period (≈ 2828 s) at β ≈ 0", () => {
    const s = series("galileo_foc", "gal", 0.5, -15, 15, 2);
    const turn = s.filter((x) => x.a.mode === "SMOOTHED_TURN");
    expect(Math.abs(turn.length * 2 - 2828)).toBeLessThan(60);
    expect(at("galileo_foc", "gal", 0.5, 0).yaw / D).toBeCloseTo(-90, 6);
    // ε > 10° (|μ| > 10°): nominal
    expect(at("galileo_foc", "gal", 0.5, 11).mode).toBe("YS");
    expect(at("galileo_foc", "gal", 5, 0).mode).toBe("YS"); // |β| ≥ 4.1°
  });

  test("BeiDou-2 (§3.7.2): orbit normal at |β| ≤ 4°, yaw steering above", () => {
    expect(at("bds2_ys_on", "meo", 3.9, 30).mode).toBe("ON");
    expect(at("bds2_ys_on", "meo", 4.1, 30).mode).toBe("YS");
  });

  test("BeiDou-3 CAST (§3.7.3): β-damped, |β_d| = 3° at the nodes, nominal away from them", () => {
    const a = at("bds3_cast", "meo", 0.5, 0);
    expect(a.yaw / D).toBeCloseTo(-90, 6);
    expect(a.mode).toBe("SMOOTHED_TURN");
    // β_d = β + f (sign β · β0 − β), f = 1 / (1 + d sin⁴μ), d = 80000, β0 = 3°
    for (const mu of [-4, -1, 2, 178, 183]) {
      const b = at("bds3_cast", "meo", 0.5, mu);
      const f = 1 / (1 + 80000 * Math.sin(b.mu) ** 4);
      expect(b.yaw).toBeCloseTo(nominalYaw(b.beta + f * (3 * D - b.beta), b.mu), 12);
    }
    expect(Math.abs(wrapDeg(at("bds3_cast", "meo", 0.5, 60).yaw / D - nominalDeg(at("bds3_cast", "meo", 0.5, 60))))).toBeLessThan(0.01);
  });

  test("BeiDou-3 SECM (§3.7.4): β clamped at ±3° whenever |β| ≤ 3°", () => {
    for (const mu of [-170, -2, 0, 1, 60]) {
      const a = at("bds3_secm", "meo", 0.5, mu);
      expect(a.yaw).toBeCloseTo(nominalYaw(3 * D, a.mu), 12);
      const b = at("bds3_secm", "meo", -2, mu);
      expect(b.yaw).toBeCloseTo(nominalYaw(-3 * D, b.mu), 12);
    }
  });

  test("QZSS-2 (§3.8): pseudo yaw steering at ω_c = 0.055°/s through ψ = −90° sign β at the node", () => {
    expect(at("qzss2_pseudo_ys", "geo", 0.5, 0).yaw / D).toBeCloseTo(-90, 6);
    expect(at("qzss2_pseudo_ys", "geo", -0.5, 180).yaw / D).toBeCloseTo(90, 6);
    const s = series("qzss2_pseudo_ys", "geo", 2, -10, 10, 2);
    expect(maxRate(s, 2)).toBeCloseTo(0.055, 4);
  });

  test("lawAttitude dispatches by law and writes into a given result", () => {
    const p = pose("gps", 0.5, 0.3);
    const result = { frame: { ex: new Cartesian3(), ey: new Cartesian3(), ez: new Cartesian3() }, yaw: 0, mode: "YS" as const, beta: 0, mu: 0 };
    const a = lawAttitude("gps_iir", p.r, p.v, p.sun, p.t, result)!;
    expect(a).toBe(result);
    expect(a.yaw).toBe(ATTITUDE_LAWS.gps_iir(p.r, p.v, p.sun, p.t)!.yaw);
    expect(lawAttitude("gps_iir", Cartesian3.ZERO, p.v, p.sun, p.t)).toBeNull();
  });
});
