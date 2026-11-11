// Orbit System = Inertial by Window (spec §9.2): หมุนตำแหน่งตัวอย่าง Earth-fixed เป็นกรอบ inertial ณ เวลาอ้างอิง (src/cesium/inertial.ts)
// toInertial(samples, ref) = M(ref) · M(tᵢ)ᵀ · pᵢ เมื่อ M(t) = Transforms.computeTemeToPseudoFixedMatrix(t) ใช้ math ของ Cesium ใน Node เท่านั้น

import { Cartesian3, JulianDate, Matrix3, Transforms } from "cesium";
import { describe, expect, test } from "vitest";
import { toInertial } from "../../src/cesium/inertial";

const ref = JulianDate.fromIso8601("2026-11-11T06:00:00Z");
const at = (seconds: number): JulianDate => JulianDate.addSeconds(ref, seconds, new JulianDate());
const angleDeg = (a: Cartesian3, b: Cartesian3): number => (Cartesian3.angleBetween(a, b) * 180) / Math.PI;

/** ดาวสมมติในวงโคจรเอียง 55° รัศมี GPS ตำแหน่ง Earth-fixed ทุก 10 นาทีในช่วง ref ± 3 ชม. */
function gpsLikeSamples(): { t: JulianDate; p: Cartesian3 }[] {
  const r = 26_560_000;
  const inc = (55 * Math.PI) / 180;
  const out: { t: JulianDate; p: Cartesian3 }[] = [];
  for (let s = -3 * 3600; s <= 3 * 3600; s += 600) {
    const t = at(s);
    const u = (2 * Math.PI * s) / 43_078;
    const inertial = new Cartesian3(r * Math.cos(u), r * Math.sin(u) * Math.cos(inc), r * Math.sin(u) * Math.sin(inc));
    const fixed = Matrix3.multiplyByVector(Transforms.computeTemeToPseudoFixedMatrix(t), inertial, new Cartesian3());
    out.push({ t, p: fixed });
  }
  return out;
}

test("inertial path is the identity at the reference time and keeps lengths", () => {
  const samples = gpsLikeSamples();
  const out = toInertial(samples, ref);
  expect(out).toHaveLength(samples.length);
  const i0 = samples.findIndex((s) => JulianDate.equals(s.t, ref));
  expect(i0).toBeGreaterThanOrEqual(0);
  expect(Cartesian3.distance(out[i0], samples[i0].p)).toBeLessThan(1e-6);
  samples.forEach((s, i) => {
    const before = Cartesian3.magnitude(s.p);
    expect(Math.abs(Cartesian3.magnitude(out[i]) - before) / before, `sample ${i}`).toBeLessThan(1e-6);
  });
});

describe("the frame it draws in", () => {
  test("a point that is still in the inertial frame lands on one spot (the satellite's spot at ref)", () => {
    const q = new Cartesian3(7_000_000, -2_000_000, 1_000_000);
    const samples = [-7200, -3600, 0, 1800, 5400].map((s) => {
      const t = at(s);
      return { t, p: Matrix3.multiplyByVector(Transforms.computeTemeToPseudoFixedMatrix(t), q, new Cartesian3()) };
    });
    const out = toInertial(samples, ref);
    const expected = Matrix3.multiplyByVector(Transforms.computeTemeToPseudoFixedMatrix(ref), q, new Cartesian3());
    for (const p of out) expect(Cartesian3.distance(p, expected)).toBeLessThan(1e-3);
  });

  test("a point fixed on the Earth turns by the Earth's rotation, about 15.04° an hour", () => {
    const ground = new Cartesian3(6_378_137, 0, 0);
    const out = toInertial([{ t: at(3600), p: ground }, { t: at(-3600), p: ground }], ref);
    expect(angleDeg(out[0], ground)).toBeCloseTo(15.041, 2);
    expect(angleDeg(out[1], ground)).toBeCloseTo(15.041, 2);
    // ไปคนละทิศ: หนึ่งชั่วโมงก่อนกับหลังห่างกันราว 30°
    expect(angleDeg(out[0], out[1])).toBeCloseTo(30.082, 1);
    // หมุนรอบแกน z: ความสูงตามแกน z ไม่เปลี่ยน
    expect(Math.abs(out[0].z)).toBeLessThan(1e-6);
  });

  test("an empty list stays empty and the inputs are not changed", () => {
    expect(toInertial([], ref)).toEqual([]);
    const p = new Cartesian3(1, 2, 3);
    toInertial([{ t: at(600), p }], ref);
    expect(p).toEqual(new Cartesian3(1, 2, 3));
  });
});
