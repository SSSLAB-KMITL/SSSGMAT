// ตัวอ่านท่าทางของโมเดลดาวสำหรับ test hook (satelliteOrientation / pointShown ของ e2e models.spec.ts): modelBodyAxes คืนแกน +X, +Y, +Z ของตัวดาว
// ในพิกัด ECEF จากค่าที่เขียนลง entity.orientation จริง (ถอด MODEL_AXIS_FIX ออก) ไม่มี WebGL ไม่ต่อเครือข่าย
// การแปลงแกนของ glb เป็นแกนตัวดาวพิสูจน์กับ ModelUtility จริงของ Cesium แล้วใน sat-model-render.test.ts; ที่นี่ตรวจว่าค่าที่ hook อ่านได้ตรงกับท่าทางที่คำนวณ

import { Cartesian3, Color, Entity, EntityCollection, JulianDate, Math as CMath, ReferenceFrame, SampledPositionProperty } from "cesium";
import { describe, expect, test } from "vitest";
import { sunPositionEcef } from "../../src/cesium/attitude";
import { applySatelliteModel, modelBodyAxes, updateModelAttitudes, type SatModelSpec } from "../../src/cesium/satModelGraphics";

const TIME = JulianDate.fromIso8601("2026-11-11T06:00:00Z");
const GPS_R = 26_560_000;

function orbit(phase: number, incl = 0.96, radius = GPS_R): SampledPositionProperty {
  const p = new SampledPositionProperty(ReferenceFrame.FIXED);
  const omega = Math.sqrt(3.986004418e14 / radius ** 3);
  for (let s = -1200; s <= 1200; s += 60) {
    const a = phase + omega * s;
    p.addSample(JulianDate.addSeconds(TIME, s, new JulianDate()), new Cartesian3(radius * Math.cos(a), radius * Math.sin(a) * Math.cos(incl), radius * Math.sin(a) * Math.sin(incl)));
  }
  return p;
}

const GNSS: SatModelSpec = { id: "gps-iif", uri: "blob:test/gps-iif", wingNodes: ["wing+Y", "wing-Y"], law: "nominal_ys", zeroNormal: new Cartesian3(-1, 0, 0) };
const EO: SatModelSpec = { id: "terra", uri: "blob:test/terra", wingNodes: ["wing-Y"], law: "nadir_velocity", zeroNormal: new Cartesian3(0, 0, 1) };
const LOOK = { pixelSize: 48, color: Color.fromCssColorString("#ffd23f"), selected: false };

function sat(spec: SatModelSpec, phase = 0.7) {
  const entities = new EntityCollection();
  const entity = entities.add(new Entity({ id: "sat/G01", position: orbit(phase) }));
  applySatelliteModel(entity, { ...LOOK, spec });
  return { entities, entity };
}

const angleDeg = (a: Cartesian3, b: Cartesian3): number => CMath.toDegrees(Cartesian3.angleBetween(a, b));

describe("modelBodyAxes (test hook reader of the posed model)", () => {
  test("no axes until the first attitude update, for an entity without a model, and for a satellite that is hidden", () => {
    const { entities, entity } = sat(GNSS);
    expect(modelBodyAxes(entity, TIME)).toBeNull(); // มีโมเดลแต่ยังไม่เคยคำนวณท่าทาง (orientation ยังเป็นค่าตั้งต้น)
    expect(updateModelAttitudes(entities, TIME)).toBe(1);
    expect(modelBodyAxes(entity, TIME)).not.toBeNull();
    entity.show = false;
    expect(modelBodyAxes(entity, TIME)).toBeNull();
    entity.show = true;
    applySatelliteModel(entity, null);
    expect(modelBodyAxes(entity, TIME)).toBeNull(); // ปิดโมเดลแล้ว
    expect(modelBodyAxes(new Entity({ id: "sat/G02", position: orbit(1) }), TIME)).toBeNull();
  });

  test("GNSS yaw steering: orthonormal right-handed axes, +Z toward Earth, the Sun in the X-Z plane on the +X side", () => {
    const { entities, entity } = sat(GNSS);
    updateModelAttitudes(entities, TIME);
    const a = modelBodyAxes(entity, TIME)!;
    const r = entity.position!.getValueInReferenceFrame(TIME, ReferenceFrame.FIXED, new Cartesian3())!;
    const towardEarth = Cartesian3.negate(r, new Cartesian3());
    expect(angleDeg(a.ez, towardEarth)).toBeLessThan(1e-6);
    for (const v of [a.ex, a.ey, a.ez]) expect(Cartesian3.magnitude(v)).toBeCloseTo(1, 12);
    expect(Cartesian3.dot(a.ex, a.ey)).toBeCloseTo(0, 12);
    expect(Cartesian3.dot(a.ey, a.ez)).toBeCloseTo(0, 12);
    expect(Cartesian3.dot(a.ez, a.ex)).toBeCloseTo(0, 12);
    expect(angleDeg(Cartesian3.cross(a.ex, a.ey, new Cartesian3()), a.ez)).toBeLessThan(1e-6);
    const es = Cartesian3.normalize(Cartesian3.subtract(sunPositionEcef(TIME), r, new Cartesian3()), new Cartesian3());
    expect(Cartesian3.dot(es, a.ey)).toBeCloseTo(0, 9);
    expect(Cartesian3.dot(es, a.ex)).toBeGreaterThan(0);
  });

  test("earth-observation models use the sensor frame: +Z toward Earth as well", () => {
    const { entities, entity } = sat(EO, 2.2);
    updateModelAttitudes(entities, TIME);
    const a = modelBodyAxes(entity, TIME)!;
    const r = entity.position!.getValueInReferenceFrame(TIME, ReferenceFrame.FIXED, new Cartesian3())!;
    expect(angleDeg(a.ez, Cartesian3.negate(r, new Cartesian3()))).toBeLessThan(1e-6);
    expect(angleDeg(Cartesian3.cross(a.ex, a.ey, new Cartesian3()), a.ez)).toBeLessThan(1e-6);
  });
});
