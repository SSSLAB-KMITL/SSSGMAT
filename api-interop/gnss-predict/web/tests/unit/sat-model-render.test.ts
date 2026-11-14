// โมเดล 3 มิติของดาวในหน้าต่าง 3D (models integration spec §3–§4) บน entity จริงของ Cesium (ไม่มี WebGL ไม่ต่อเครือข่าย)
// - แกนของโมเดล: ใช้ ModelUtility.getAxisCorrectionMatrix จริงของ Cesium (ค่าตั้งต้น upAxis Y / forwardAxis Z ที่ ModelVisualizer ได้) ไม่ใช่สูตรที่เขียนเอง
// - node ของแผงโซลาร์และ normal ด้านเซลล์อ่านจาก glb จริงใน models/ (helpers/glb.ts)
// - การวาด (applyGraphics + applySatelliteModel), การอัปเดตท่าทาง (updateModelAttitudes), การโหลด glb/catalog (SatModelSource)
//   และหน้าต่าง 3D ที่ mount จริงบน viewer ปลอม (รอบ throttle, modelCount)

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as Cesium from "cesium";
import {
  Axis, Camera, Cartesian2, Cartesian3, Color, ColorBlendMode, ConstantPositionProperty, ConstantProperty, CzmlDataSource, Ellipsoid, Entity, EntityCollection, GeographicProjection, JulianDate,
  Math as CMath, Matrix3, Matrix4, PerspectiveFrustum, Quaternion, ReferenceFrame, SampledPositionProperty, SceneMode, ScreenSpaceEventHandler, type TranslationRotationScale,
} from "cesium";
import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { bodyToEcefQuaternion, sunPositionEcef, yawSteeringFrame, type AttitudeFrame } from "../../src/cesium/attitude";
import { applyGraphics, type ColorTokens, type SceneObject, type SceneStyle } from "../../src/cesium/graphics";
import {
  applyModelDetail, applySatelliteModel, MODEL_AXIS_FIX, MODEL_COLOR_BLEND, MODEL_LIGHT_SCALE, MODEL_SILHOUETTE_PX, modelCountOf, modelOrientation, modelPrimitiveState,
  SELECTED_SILHOUETTE_PX, setModelSelection, updateModelAttitudes, watchModelErrors, WING_AXIS_GLTF, type SatModelSpec,
} from "../../src/cesium/satModelGraphics";
import {
  CESIUM_GLTF_EXTENSIONS, DEFAULT_WING_ZERO_NORMAL, glbProblem, loadModelGlb, resetModelLoads, resolveModel, WING_ZERO_NORMAL, wingNodesOf, wingZeroNormal, type ModelCatalog,
} from "../../src/cesium/satModels";
import { createViewer, destroyViewer } from "../../src/cesium/viewer";
import { msg } from "../../src/labels/messages.th";
import { useLayout } from "../../src/stores/layout";
import { useMessages } from "../../src/stores/messages";
import { useResults } from "../../src/stores/results";
import { useScenario } from "../../src/stores/scenario";
import { useSelection } from "../../src/stores/selection";
import { useTime } from "../../src/stores/time";
import { mountScene3D, sunSideOffset } from "../../src/windows/Graphics3D/scene3d";
import type { SensorViewHandle } from "../../src/windows/SensorView/registry";
import { MODEL_BATCH_MS, resetModelReports, SatModelSource } from "../../src/windows/Graphics3D/satModelSource";
import { makeDoc } from "./helpers/chrome";
import { areaByAxis, bodyOfGltf, faceNormal, gltfOfBody, makeGlb, MODELS_DIR, parents, readGlb, type V3 } from "./helpers/glb";
import { CATALOG, makeScenarioDoc } from "./helpers/objects";

vi.mock("../../src/cesium/viewer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/cesium/viewer")>()),
  createViewer: vi.fn(),
  destroyViewer: vi.fn(),
}));

const catalog = JSON.parse(readFileSync(resolve(MODELS_DIR, "catalog.json"), "utf8")) as ModelCatalog;
const entryOf = (id: string) => catalog.models.find((m) => m.id === id)!;

/** ModelUtility ของ Cesium จริง (อยู่ใน build แต่ไม่อยู่ใน type ที่ประกาศ) */
const { ModelUtility } = Cesium as unknown as { ModelUtility: { getAxisCorrectionMatrix(up: Axis, forward: Axis, result: Matrix4): Matrix4 } };
/** แกนที่ ModelVisualizer ใช้กับ glTF 2.0 (ค่าตั้งต้นของ Model.fromGltfAsync / GltfLoader: ตรวจกับซอร์สของ Cesium ด้านล่าง) */
const AXIS_CORRECTION = ModelUtility.getAxisCorrectionMatrix(Axis.Y, Axis.Z, new Matrix4());

const v3 = (c: Cartesian3): V3 => [c.x, c.y, c.z];
const cart = ([x, y, z]: readonly number[]): Cartesian3 => new Cartesian3(x, y, z);
const angleDeg = (a: Cartesian3, b: Cartesian3): number => CMath.toDegrees(Cartesian3.angleBetween(a, b));

/**
 * ทิศ d (พิกัด glTF ของ node แผง) เมื่อวาดจริง: entity modelMatrix (orientation) · axis correction · (originalMatrix · TRS ของ nodeTransformation)
 * เหมือน ModelSceneGraph (computedModelMatrix = modelMatrix · transform · axisCorrection) กับ ModelVisualizer (node.matrix = originalMatrix · TRS)
 */
function rendered(orientation: Quaternion, nodeRotation: Quaternion | null, d: V3, translation: V3 = [0, 0, 0]): Cartesian3 {
  const node = Matrix4.multiply(
    Matrix4.fromTranslation(cart(translation)),
    Matrix4.fromTranslationRotationScale({ translation: Cartesian3.ZERO, rotation: nodeRotation ?? Quaternion.IDENTITY, scale: new Cartesian3(1, 1, 1) } as TranslationRotationScale),
    new Matrix4(),
  );
  const model = Matrix4.multiply(Matrix4.fromRotationTranslation(Matrix3.fromQuaternion(orientation)), AXIS_CORRECTION, new Matrix4());
  const full = Matrix4.multiply(model, node, new Matrix4());
  return Cartesian3.normalize(Matrix4.multiplyByPointAsVector(full, cart(d), new Cartesian3()), new Cartesian3());
}

const TIME = JulianDate.fromIso8601("2026-11-11T06:00:00Z");
const GPS_R = 26_560_000;

/** ตำแหน่ง FIXED ของดาววงกลมรอบโลก (ตัวอย่างทุก 60 s ±20 นาทีรอบ TIME) */
function orbit(phase: number, incl = 0.96, radius = GPS_R): SampledPositionProperty {
  const p = new SampledPositionProperty(ReferenceFrame.FIXED);
  const omega = Math.sqrt(3.986004418e14 / radius ** 3);
  for (let s = -1200; s <= 1200; s += 60) {
    const a = phase + omega * s;
    p.addSample(JulianDate.addSeconds(TIME, s, new JulianDate()), new Cartesian3(radius * Math.cos(a), radius * Math.sin(a) * Math.cos(incl), radius * Math.sin(a) * Math.sin(incl)));
  }
  return p;
}

function specOf(id: string, uri = `blob:test/${id}`): SatModelSpec {
  const r = resolveModel(catalog, entryOf(id).norad_ids !== undefined ? { block: null, norad: entryOf(id).norad_ids![0] } : { block: entryOf(id).blocks![0], norad: null });
  expect(r.id).toBe(id);
  return { id, uri, wingNodes: wingNodesOf(catalog, id), eo: r.eo, zeroNormal: cart(wingZeroNormal(id)) };
}

const LOOK = { pixelSize: 48, color: Color.fromCssColorString("#ffd23f"), selected: false };

/** entity หนึ่งดวงในคอลเลกชันของตัวเองที่มีโมเดล id แล้วอัปเดตท่าทางหนึ่งรอบ ณ TIME */
function posedEntity(id: string, phase = 0.7, incl = 0.96) {
  const entities = new EntityCollection();
  const entity = entities.add(new Entity({ id: `sat/${id}`, position: orbit(phase, incl) }));
  const spec = specOf(id);
  applySatelliteModel(entity, { ...LOOK, spec });
  expect(updateModelAttitudes(entities, TIME)).toBe(1);
  const orientation = entity.orientation!.getValue(TIME) as Quaternion;
  const nodes = entity.model!.nodeTransformations!.getValue(TIME) as Record<string, TranslationRotationScale>;
  const r = entity.position!.getValueInReferenceFrame(TIME, ReferenceFrame.FIXED, new Cartesian3())!;
  const sun = sunPositionEcef(TIME);
  const es = Cartesian3.normalize(Cartesian3.subtract(sun, r, new Cartesian3()), new Cartesian3());
  return { entities, entity, spec, orientation, nodes, r, es };
}

// ---------- แกนของโมเดล (Review Focus 1) ----------

describe("model axes against Cesium's own axis correction", () => {
  const src = (rel: string) => readFileSync(resolve(import.meta.dirname, "../../node_modules/@cesium/engine/Source", rel), "utf8");

  test("entity models get Cesium's glTF 2.0 defaults (up Y, forward Z): ModelVisualizer passes no axes, GltfLoader defaults to Y and Z", () => {
    const visualizer = src("DataSources/ModelVisualizer.js");
    const call = visualizer.slice(visualizer.indexOf("Model.fromGltfAsync({"), visualizer.indexOf("});", visualizer.indexOf("Model.fromGltfAsync({")));
    expect(call).toContain("url: resource");
    expect(call).not.toMatch(/upAxis|forwardAxis/);
    const loader = src("Scene/GltfLoader.js");
    expect(loader).toMatch(/upAxis = Axis\.Y,/);
    expect(loader).toMatch(/forwardAxis = Axis\.Z,/);
  });

  test("with that correction the body frame maps onto the attitude frame: body +Z (nadir) renders toward Earth, +X to ex, +Y to ey", () => {
    const r = new Cartesian3(15e6, -9e6, 19e6);
    const v = new Cartesian3(1500, 2900, 200);
    const frame = yawSteeringFrame(r, v, sunPositionEcef(TIME))!;
    const q = modelOrientation(frame);
    const towardEarth = Cartesian3.normalize(Cartesian3.negate(r, new Cartesian3()), new Cartesian3());
    expect(angleDeg(rendered(q, null, gltfOfBody([0, 0, 1])), towardEarth)).toBeLessThan(1e-6);
    expect(angleDeg(rendered(q, null, gltfOfBody([1, 0, 0])), frame.ex)).toBeLessThan(1e-6);
    expect(angleDeg(rendered(q, null, gltfOfBody([0, 1, 0])), frame.ey)).toBeLessThan(1e-6);
    // glTF ที่ส่งออกแบบ Y-up: body +Z คือ +Y ของ glTF ตามกรอบใน catalog
    expect(catalog.frame).toContain("glTF Y-up");
  });

  test("the fixed correction is needed: Cesium's Y-up/Z-forward correction alone turns the body 90° about Z (body +X would render along ey)", () => {
    const frame: AttitudeFrame = { ex: new Cartesian3(1, 0, 0), ey: new Cartesian3(0, 1, 0), ez: new Cartesian3(0, 0, 1) };
    const plain = bodyToEcefQuaternion(frame);
    expect(angleDeg(rendered(plain, null, gltfOfBody([1, 0, 0])), frame.ey)).toBeLessThan(1e-6);
    expect(angleDeg(rendered(plain, null, gltfOfBody([0, 0, 1])), frame.ez)).toBeLessThan(1e-6); // nadir ถูกอยู่แล้ว แต่ yaw ผิด 90°
    expect(Quaternion.equalsEpsilon(MODEL_AXIS_FIX, Quaternion.fromAxisAngle(Cartesian3.UNIT_Z, -Math.PI / 2), 1e-15)).toBe(true);
  });
});

// ---------- node ของแผงโซลาร์และ normal ด้านเซลล์จาก glb จริง (Review Focus 2) ----------

describe("wing nodes in the real glbs", () => {
  test("every catalog wing node exists, has only a translation, and hangs off an untransformed root: its local axes are raw glTF axes", () => {
    for (const m of catalog.models) {
      const glb = readGlb(m.glb);
      const up = parents(glb);
      const roots = glb.json.scenes[glb.json.scene ?? 0].nodes;
      for (const name of wingNodesOf(catalog, m.id)) {
        const i = glb.json.nodes.findIndex((n) => n.name === name);
        expect(i, `${m.id} ${name}`).toBeGreaterThanOrEqual(0);
        const node = glb.json.nodes[i];
        expect([node.rotation, node.scale, node.matrix], `${m.id} ${name}`).toEqual([undefined, undefined, undefined]);
        const parent = up.get(i)!;
        expect(roots, `${m.id} ${name}`).toContain(parent);
        const root = glb.json.nodes[parent];
        expect([root.translation, root.rotation, root.scale, root.matrix], m.id).toEqual([undefined, undefined, undefined, undefined]);
        expect(up.get(parent), m.id).toBeUndefined();
      }
    }
  });

  test("wing rotation axis: body +Y is glTF −Z, and a node rotation about it turns a body vector exactly as R_y(θ) (galileo-foc, gps-iif, terra)", () => {
    expect(v3(WING_AXIS_GLTF)).toEqual(gltfOfBody([0, 1, 0]));
    for (const id of ["galileo-foc", "gps-iif", "terra"]) {
      const glb = readGlb(entryOf(id).glb);
      for (const name of wingNodesOf(catalog, id)) {
        const node = glb.json.nodes.find((n) => n.name === name)!;
        const original = Matrix4.fromTranslation(cart(node.translation ?? [0, 0, 0]));
        for (const θ of [0.3, -1.2, 2.9]) {
          const q = Quaternion.fromAxisAngle(WING_AXIS_GLTF, θ);
          const nodeMatrix = Matrix4.multiply(original, Matrix4.fromRotation(Matrix3.fromQuaternion(q)), new Matrix4());
          const body = cart(wingZeroNormal(id));
          const expected = Matrix3.multiplyByVector(Matrix3.fromRotationY(θ), body, new Cartesian3()); // Cesium R_y(θ): +Z → +X
          const got = Matrix4.multiplyByPointAsVector(nodeMatrix, cart(gltfOfBody(v3(body))), new Cartesian3());
          expect(angleDeg(cart(bodyOfGltf(v3(got))), expected), `${id} ${name} θ=${θ}`).toBeLessThan(1e-9);
        }
      }
    }
  });

  test("the zero-angle cell normal of each model is the one in the glb: solar_cells faces of every wing node", () => {
    const withCells = catalog.models.filter((m) => faceNormal(readGlb(m.glb), wingNodesOf(catalog, m.id)[0], "solar_cells") !== null);
    expect(withCells.map((m) => m.id)).toEqual(expect.arrayContaining(["galileo-foc", "gps-iif", "gps-iii", "glonass-m", "generic", "himawari-9"]));
    for (const m of withCells) {
      const glb = readGlb(m.glb);
      for (const name of wingNodesOf(catalog, m.id)) {
        const n = bodyOfGltf(faceNormal(glb, name, "solar_cells")!);
        expect(angleDeg(cart(n), cart(wingZeroNormal(m.id))), `${m.id} ${name}`).toBeLessThan(0.5);
      }
    }
  });

  test("EO models without a solar_cells material: the map follows the panel's own faces (terra both faces cells, GOES 'solarpanel-faces'); aqua and suomi-npp default to +X along their panel normal", () => {
    // terra: แผงสองหน้า วัสดุเซลล์เดียวกันทั้ง ±Z ของตัวดาว (glTF ∓Y)
    const terra = areaByAxis(readGlb(entryOf("terra").glb), "wing-Y", "Main Solar Panels.001");
    expect(terra["+Y"]).toBeCloseTo(terra["-Y"], 3);
    expect(Math.abs(wingZeroNormal("terra")[2])).toBe(1);
    // GOES: หน้าเซลล์ (Goes2-solarpanel-faces) ชี้ +Z ของตัวดาว
    const goes = bodyOfGltf(faceNormal(readGlb(entryOf("goes").glb), "wing-Y", "Goes2-solarpanel-faces")!);
    expect(angleDeg(cart(goes), cart(wingZeroNormal("goes")))).toBeLessThan(0.5);
    // aqua, suomi-npp: บอกไม่ได้ว่าด้านไหนเป็นเซลล์ (texture เดียวกันทั้งสองด้าน) ใช้ +X ตั้งต้น ซึ่งอยู่ในแนว normal ของแผงจริง
    for (const [id, material] of [["aqua", "tex_01"], ["suomi-npp", "tex_01"]] as const) {
      expect(WING_ZERO_NORMAL[id], id).toBeUndefined();
      expect(wingZeroNormal(id)).toEqual(DEFAULT_WING_ZERO_NORMAL);
      const areas = areaByAxis(readGlb(entryOf(id).glb), "wing-Y", material);
      const biggest = Object.entries(areas).sort((a, b) => b[1] - a[1])[0][0];
      expect(biggest.slice(1), id).toBe("X");
    }
  });
});

// ---------- แผงหันหาดวงอาทิตย์เมื่อวาดจริง (spec §3) ----------

describe("posed models: nadir down and cells toward the sun after Cesium's transforms", () => {
  test.each(["galileo-foc", "gps-iif", "bds3-meo-cast", "glonass-k2"])("%s (yaw steering): +Z to Earth, cell normal of both wings within 1° of the sun", (id) => {
    for (const phase of [0.2, 1.4, 2.9, 4.4]) {
      const { orientation, nodes, r, es, spec } = posedEntity(id, phase);
      const toEarth = Cartesian3.normalize(Cartesian3.negate(r, new Cartesian3()), new Cartesian3());
      expect(angleDeg(rendered(orientation, null, gltfOfBody([0, 0, 1])), toEarth)).toBeLessThan(1e-6);
      const glb = readGlb(entryOf(id).glb);
      expect(Object.keys(nodes).sort()).toEqual([...spec.wingNodes].sort());
      for (const name of spec.wingNodes) {
        const node = glb.json.nodes.find((n) => n.name === name)!;
        const cells = faceNormal(glb, name, "solar_cells")!;
        const n = rendered(orientation, nodes[name].rotation, cells, node.translation as V3);
        expect(angleDeg(n, es), `${id} ${name} phase ${phase}`).toBeLessThan(1);
      }
    }
  });

  test.each(["terra", "himawari-9", "goes"])("%s (nadir + velocity): single wing faces the sun's projection on body X-Z (off by β only)", (id) => {
    for (const phase of [0.2, 1.4, 2.9]) {
      const { orientation, nodes, es, spec, entity } = posedEntity(id, phase, 1.7);
      expect(spec.wingNodes).toHaveLength(1);
      const name = spec.wingNodes[0];
      const q = entity.orientation!.getValue(TIME) as Quaternion;
      const ey = rendered(q, null, gltfOfBody([0, 1, 0]));
      const beta = Math.asin(Math.abs(Cartesian3.dot(es, ey)));
      const zero = cart(gltfOfBody(v3(cart(wingZeroNormal(id)))));
      const n = rendered(orientation, nodes[name].rotation, v3(zero));
      expect(Math.abs(Cartesian3.dot(n, ey)), `${id} ${phase}`).toBeLessThan(1e-9); // ยังอยู่ในระนาบ X-Z ของตัวดาว
      expect(Cartesian3.dot(n, es)).toBeGreaterThan(0); // ด้านเซลล์ ไม่ใช่ด้านหลัง
      expect(Math.abs(Cartesian3.angleBetween(n, es) - beta), `${id} ${phase}`).toBeLessThan(1e-6);
    }
  });

  test.each([
    ["first sample (animation start)", -1200, 1],
    ["last sample (animation stop)", 1200, -1],
  ])("attitude at the %s: one-sided 1 s difference (no t ∓ 1 s sample), +Z to Earth, yaw from that velocity", (_label, offset, side) => {
    const entities = new EntityCollection();
    const position = orbit(0.7);
    const entity = entities.add(new Entity({ id: "sat/B", position }));
    applySatelliteModel(entity, { ...LOOK, spec: specOf("gps-iif") });
    const at = JulianDate.addSeconds(TIME, offset, new JulianDate());
    const fixed = (t: JulianDate) => position.getValueInReferenceFrame(t, ReferenceFrame.FIXED, new Cartesian3());
    expect(fixed(JulianDate.addSeconds(at, -side, new JulianDate()))).toBeUndefined(); // ตัวอย่างฝั่งนั้นไม่มีจริง
    expect(updateModelAttitudes(entities, at)).toBe(1);
    const r = fixed(at)!;
    const other = fixed(JulianDate.addSeconds(at, side, new JulianDate()))!;
    const v = Cartesian3.multiplyByScalar(Cartesian3.subtract(other, r, new Cartesian3()), side, new Cartesian3());
    const want = modelOrientation(yawSteeringFrame(r, v, sunPositionEcef(at))!);
    const q = entity.orientation!.getValue(at) as Quaternion;
    expect(Quaternion.equalsEpsilon(q, want, 1e-9) || Quaternion.equalsEpsilon(q, Quaternion.negate(want, new Quaternion()), 1e-9)).toBe(true);
    const toEarth = Cartesian3.normalize(Cartesian3.negate(r, new Cartesian3()), new Cartesian3());
    expect(angleDeg(rendered(q, null, gltfOfBody([0, 0, 1])), toEarth)).toBeLessThan(1e-6);
  });

  test("a satellite with no position on either side of t (single sample) is left alone", () => {
    const entities = new EntityCollection();
    const position = new SampledPositionProperty(ReferenceFrame.FIXED);
    position.addSample(TIME, new Cartesian3(GPS_R, 0, 0));
    const entity = entities.add(new Entity({ id: "sat/S", position }));
    applySatelliteModel(entity, { ...LOOK, spec: specOf("gps-iif") });
    expect(updateModelAttitudes(entities, TIME)).toBe(0);
    expect(Quaternion.equals(entity.orientation!.getValue(TIME) as Quaternion, Quaternion.IDENTITY)).toBe(true);
  });

  test("the wing holds its previous angle while the sun lies along ±Y of the body (wingAngle has no answer there)", () => {
    const entities = new EntityCollection();
    // ดาว EO วงโคจรเส้นศูนย์สูตร เวลาเดียวกันแต่ตำแหน่งต่างกัน: รอบแรกได้มุมจริง รอบสองบังคับให้ดวงอาทิตย์อยู่แนว ey
    const entity = entities.add(new Entity({ id: "sat/T", position: orbit(0.4, 1.7) }));
    applySatelliteModel(entity, { ...LOOK, spec: specOf("terra") });
    updateModelAttitudes(entities, TIME);
    const wing = () => (entity.model!.nodeTransformations!.getValue(TIME) as Record<string, TranslationRotationScale>)["wing-Y"].rotation.clone();
    const first = wing();
    expect(Quaternion.equalsEpsilon(first, Quaternion.IDENTITY, 1e-6)).toBe(false);
    // ตำแหน่งที่ es ขนานกับ ey พอดี (ทุกค่าแม่นตรงในทศนิยม): r = (sun.x, sun.y, 0) บนระนาบศูนย์สูตร ไม่เคลื่อนที่ (v = 0)
    // เฟรม §3.1: ez = −r̂ และ ex = ทิศของ ω⊕ × r อยู่ในระนาบศูนย์สูตรทั้งคู่ จึง ey ∥ Z และ es = sun − r = (0, 0, sun.z) ∥ ey
    const sun = sunPositionEcef(TIME);
    entity.position = new ConstantPositionProperty(new Cartesian3(sun.x, sun.y, 0), ReferenceFrame.FIXED);
    updateModelAttitudes(entities, TIME);
    expect(Quaternion.equalsEpsilon(wing(), first, 1e-12)).toBe(true);
  });
});

// ---------- การวาดบน entity ของ data source (applyGraphics) ----------

const TOKENS: ColorTokens = {
  gps: "#ffd23f", glonass: "#ff6b6b", galileo: "#4fd47e", beidou: "#45c8ff", other: "#c8c8c8", facility: "#ff79e6", access: "#9dff6b",
};
const STYLE: SceneStyle = {
  labelFont: "13px Test Sans", labelOutline: "#102030", pointOutline: "#405060", accessWidth: 2.5, gridLine: "#ffffff66",
  swathFillOpacity: 0.3, swathEdgeWidth: 1.5, terminatorLine: "#ffffffb3", terminatorWidth: 1.5, ippPointSize: 6, ippTrackWidth: 2,
};
const T0 = "2026-11-11T00:00:00Z";

function satPacket(prn: string, phase = 0): object {
  const cartesian: number[] = [];
  for (let s = 0; s <= 86_400; s += 300) {
    const a = phase + (2 * Math.PI * s) / 43_078;
    cartesian.push(s, GPS_R * Math.cos(a), GPS_R * Math.sin(a) * 0.5, GPS_R * Math.sin(a) * 0.866);
  }
  return { id: `sat/${prn}`, availability: `${T0}/2026-11-12T00:00:00Z`, position: { epoch: T0, cartesian, referenceFrame: "FIXED", interpolationAlgorithm: "LAGRANGE", interpolationDegree: 7 } };
}

const prnByNorad = new Map([[62339, "G01"], [40128, "E05"], [41836, "J09"]]);
const sat = (name: string, norad: number, over: object = {}): SceneObject => ({ class: "Satellite", name, norad, ...over }) as SceneObject;
const fac = (name: string): SceneObject => ({ class: "Facility", name, position: { type: "Geodetic", lat_deg: 13.7, lon_deg: 100.8, alt_m: 6 } }) as SceneObject;
const docOf = (objects: SceneObject[]) => makeDoc({ objects });
const SPECS: Record<number, SatModelSpec> = { 62339: specOf("gps-iif"), 40128: specOf("galileo-foc"), 41836: specOf("himawari-9") };

async function dataSource() {
  const ds = await CzmlDataSource.load([
    { id: "document", version: "1.0", clock: { interval: `${T0}/2026-11-12T00:00:00Z`, currentTime: T0 } },
    satPacket("G01"), satPacket("E05", 1), satPacket("J09", 2),
    { id: "fac/THBK", position: { cartographicDegrees: [100.8, 13.7, 6] } },
  ]);
  return ds;
}

const ctx = (models: boolean, hidden: number[] = [], selectedId: string | null = null) => ({
  mode: "3d" as const, prnByNorad, isHidden: (n: number) => hidden.includes(n), tokens: TOKENS, style: STYLE,
  models: models ? { pixelSize: 48, specFor: (norad: number) => SPECS[norad] ?? null, selectedId } : undefined,
});
const DOC = docOf([fac("THBK"), sat("G01", 62339), sat("E05", 40128), sat("J09", 41836)]);
const at = JulianDate.fromIso8601("2026-11-11T06:00:00Z");
const value = <T>(p: { getValue(t: JulianDate): unknown } | undefined): T => p?.getValue(at) as T;

describe("satellite entities with models on and off", () => {
  test("models on: the entity gets the model (uri, Model Pixel Size, no maximumScale, system colour mixed 0.5); point hidden, label and path kept", async () => {
    const ds = await dataSource();
    applyGraphics(ds, DOC, ctx(true));
    const g01 = ds.entities.getById("sat/G01")!;
    const model = g01.model!;
    expect(value<string>(model.uri)).toBe("blob:test/gps-iif");
    expect(value<number>(model.minimumPixelSize)).toBe(48);
    expect(model.maximumScale).toBeUndefined(); // ไม่จำกัดการขยาย: Model Pixel Size ใช้ได้ทุกระยะ (ดู "minimum pixel size at GNSS distances")
    expect(value<ColorBlendMode>(model.colorBlendMode)).toBe(ColorBlendMode.MIX);
    expect(value<number>(model.colorBlendAmount)).toBe(MODEL_COLOR_BLEND);
    expect(MODEL_COLOR_BLEND).toBe(0.5);
    expect(value<Color>(model.color).toCssHexString()).toBe("#ffd23f");
    // ขอบสีของระบบรอบโมเดลทุกดวง (ไม่ใช่เฉพาะดวงที่เลือก) อ่านง่ายบนพื้นอวกาศดำ
    expect(value<number>(model.silhouetteSize)).toBe(MODEL_SILHOUETTE_PX);
    expect(MODEL_SILHOUETTE_PX).toBe(1.5);
    expect(value<Color>(model.silhouetteColor).toCssHexString()).toBe("#ffd23f");
    // แสง: แสงอาทิตย์ของโมเดล 2 เท่า (ค่าตั้งต้นของ SunLight ใน Cesium; หน้าต่างตั้ง scene.light.intensity = Sun Level/100) และแสงรอบตัวคงที่
    // (ไม่ใช้ environment map แบบ dynamic ที่ในอวกาศเกือบดำ และคำนวณใหม่ทุกครั้งที่ดาวเคลื่อนเกิน 1 km) ด้านกลางคืนจึงยังเห็น
    const light = value<Color>(model.lightColor);
    expect([light.red, light.green, light.blue]).toEqual([MODEL_LIGHT_SCALE, MODEL_LIGHT_SCALE, MODEL_LIGHT_SCALE]);
    expect(MODEL_LIGHT_SCALE).toBeLessThanOrEqual(2);
    expect(value<Cartesian2>(model.imageBasedLightingFactor)).toEqual(new Cartesian2(1, 1));
    expect(value<{ enabled?: boolean }>(model.environmentMapOptions)).toMatchObject({ enabled: false });
    expect(value<boolean>(g01.point!.show)).toBe(false);
    expect(value<Color>(g01.point!.color).toCssHexString()).toBe("#ffd23f"); // สีของดาว (entityColor) ยังอ่านจากจุดได้
    expect(g01.label).toBeDefined();
    expect(value<boolean>(g01.label!.show)).toBe(true);
    expect(value<boolean>(g01.path!.show)).toBe(true);
    expect(g01.orientation).toBeInstanceOf(ConstantProperty);
    expect(ds.entities.getById("sat/E05")!.model!.uri!.getValue(at)).toBe("blob:test/galileo-foc");
    expect(ds.entities.getById("fac/THBK")!.model).toBeUndefined();
    expect(modelCountOf(ds.entities)).toBe(3);
  });

  test("two-wing and single-wing models get nodeTransformations for exactly their catalog wing nodes", async () => {
    const ds = await dataSource();
    applyGraphics(ds, DOC, ctx(true));
    const nodes = (id: string) => Object.keys(value<Record<string, unknown>>(ds.entities.getById(id)!.model!.nodeTransformations)).sort();
    expect(nodes("sat/G01")).toEqual(["wing+Y", "wing-Y"]);
    expect(nodes("sat/E05")).toEqual(["solar_wing_+Y", "solar_wing_-Y"]);
    expect(nodes("sat/J09")).toEqual(["wing-Y"]);
  });

  test("models off (or no spec for a satellite yet): point shown, no model, no orientation; turning off after on restores the point", async () => {
    const ds = await dataSource();
    applyGraphics(ds, DOC, ctx(true));
    applyGraphics(ds, DOC, ctx(false));
    for (const id of ["sat/G01", "sat/E05", "sat/J09"]) {
      const e = ds.entities.getById(id)!;
      expect(e.model, id).toBeUndefined();
      expect(e.orientation, id).toBeUndefined();
      expect(value<boolean | undefined>(e.point!.show) ?? true, id).toBe(true);
    }
    expect(modelCountOf(ds.entities)).toBe(0);
    const partial = { ...ctx(true), models: { pixelSize: 48, specFor: (n: number) => (n === 62339 ? SPECS[n] : null), selectedId: null } };
    applyGraphics(ds, DOC, partial);
    expect(ds.entities.getById("sat/G01")!.model).toBeDefined();
    expect(ds.entities.getById("sat/E05")!.model).toBeUndefined();
    expect(value<boolean | undefined>(ds.entities.getById("sat/E05")!.point!.show) ?? true).toBe(true);
  });

  test("restyle keeps the same model graphics (no reload, attitude kept); a new pixel size and the selection silhouette apply", async () => {
    const ds = await dataSource();
    applyGraphics(ds, DOC, ctx(true));
    const g01 = ds.entities.getById("sat/G01")!;
    const model = g01.model;
    updateModelAttitudes(ds.entities, at);
    const q = (g01.orientation!.getValue(at) as Quaternion).clone();
    applyGraphics(ds, DOC, { ...ctx(true, [], "sat/G01"), models: { pixelSize: 96, specFor: (n: number) => SPECS[n] ?? null, selectedId: "sat/G01" } });
    expect(g01.model).toBe(model);
    expect(Quaternion.equals(g01.orientation!.getValue(at) as Quaternion, q)).toBe(true);
    expect(value<number>(g01.model!.minimumPixelSize)).toBe(96);
    expect(value<number>(g01.model!.silhouetteSize)).toBe(SELECTED_SILHOUETTE_PX);
    expect(SELECTED_SILHOUETTE_PX).toBe(3);
    expect(value<Color>(g01.model!.silhouetteColor).toCssHexString()).toBe("#ffd23f");
    expect(value<number>(ds.entities.getById("sat/E05")!.model!.silhouetteSize)).toBe(MODEL_SILHOUETTE_PX);
    expect(value<Color>(ds.entities.getById("sat/E05")!.model!.silhouetteColor).toCssHexString()).toBe(TOKENS.galileo);
    setModelSelection(ds.entities, "sat/E05");
    expect(value<number>(g01.model!.silhouetteSize)).toBe(MODEL_SILHOUETTE_PX);
    expect(value<number>(ds.entities.getById("sat/E05")!.model!.silhouetteSize)).toBe(SELECTED_SILHOUETTE_PX);
  });

  test("orientation and wings are ConstantProperty values written in place; only shown satellites are updated, one change event per batch", async () => {
    const ds = await dataSource();
    applyGraphics(ds, DOC, ctx(true, [40128])); // E05 ซ่อนตามธง
    const g01 = ds.entities.getById("sat/G01")!;
    const e05 = ds.entities.getById("sat/E05")!;
    expect(e05.show).toBe(false);
    const orientation = g01.orientation;
    const changed = vi.fn();
    ds.entities.collectionChanged.addEventListener(changed);
    expect(updateModelAttitudes(ds.entities, at)).toBe(2); // G01, J09
    expect(changed).toHaveBeenCalledTimes(1);
    expect(g01.orientation).toBe(orientation); // property เดิม ค่าใหม่
    expect(Quaternion.equals(g01.orientation!.getValue(at) as Quaternion, Quaternion.IDENTITY)).toBe(false);
    expect(Quaternion.equals(e05.orientation!.getValue(at) as Quaternion, Quaternion.IDENTITY)).toBe(true); // ดาวที่ซ่อนไม่ถูกแตะ
    expect(modelCountOf(ds.entities)).toBe(2);
    // เวลาเดิม: ไม่มีอะไรเปลี่ยน ไม่มี event (หน้าต่างที่อยู่เฉย ๆ ยังข้าม update ได้: idleUpdates.ts)
    changed.mockClear();
    updateModelAttitudes(ds.entities, at);
    expect(changed).not.toHaveBeenCalled();
    // Sensor View ซ่อนโมเดลของดาวแม่ (กล้องอยู่ในตัวดาว): ไม่นับ ไม่อัปเดต
    g01.model!.show = new ConstantProperty(false);
    expect(updateModelAttitudes(ds.entities, JulianDate.addSeconds(at, 60, new JulianDate()))).toBe(1);
    expect(modelCountOf(ds.entities)).toBe(1);
  });
});

// ---------- ขนาดขั้นต่ำบนจอที่ระยะของดาว GNSS ----------

describe("minimum pixel size at GNSS distances", () => {
  const modelSrc = readFileSync(resolve(import.meta.dirname, "../../node_modules/@cesium/engine/Source/Scene/Model/Model.js"), "utf8");

  test("Cesium's updateComputedScale: scale = Model Pixel Size × metres per pixel / model diameter, then min(maximumScale, scale) when maximumScale is set", () => {
    expect(modelSrc).toMatch(/scale\s*=\s*\(model\.minimumPixelSize \* metersPerPixel\)\s*\/\s*\(2\.0 \* model\._initialRadius\)/);
    expect(modelSrc).toMatch(/_computedScale = defined\(model\.maximumScale\)\s*\?\s*Math\.min\(model\.maximumScale, scale\)\s*:\s*scale/);
    expect(modelSrc).toMatch(/return frameState\.camera\.getPixelSize\(/);
  });

  test("a satellite model is at least Model Pixel Size across at 50,000 and 80,000 km (60° fov, 1000 px high), any model size", async () => {
    const ds = await dataSource();
    applyGraphics(ds, DOC, ctx(true));
    const maximumScale = value<number | undefined>(ds.entities.getById("sat/G01")!.model!.maximumScale);
    const frustum = new PerspectiveFrustum({ fov: CMath.toRadians(60), aspectRatio: 1, near: 1, far: 1e12 });
    for (const distance of [50_000_000, 80_000_000]) {
      for (const radius of [0.5, 8.5, 30]) {
        for (const px of [16, 48, 256]) {
          // Camera.getPixelSize: ระยะถึงผิวทรงกลมขอบเขต (รัศมีของโมเดลก่อนขยาย) แล้ว frustum.getPixelDimensions (pixelRatio 1)
          const dims = frustum.getPixelDimensions(1000, 1000, distance - radius, 1, new Cartesian2());
          const metersPerPixel = Math.max(dims.x, dims.y);
          const scale = Math.min(2 * radius / metersPerPixel, 1000) < px ? (px * metersPerPixel) / (2 * radius) : 1;
          const computed = maximumScale === undefined ? scale : Math.min(maximumScale, scale);
          const rendered = (2 * radius * computed) / metersPerPixel;
          expect(rendered, `${distance / 1000} km, radius ${radius} m, ${px} px`).toBeGreaterThanOrEqual(px * (1 - 1e-12));
        }
      }
    }
  });
});

// ---------- Model Detail Threshold (applyModelDetail) ----------

describe("Model Detail Threshold: a model near the camera, the point farther away", () => {
  const fixed = (e: Entity) => e.position!.getValueInReferenceFrame(at, ReferenceFrame.FIXED, new Cartesian3())!;
  const shows = (e: Entity) => ({ model: value<boolean | undefined>(e.model!.show) ?? true, point: value<boolean | undefined>(e.point!.show) ?? true });

  test("near = model (point hidden), far = point (model.show false: not drawn, not posed); threshold and camera changes switch them; hidden satellites are not touched", async () => {
    const ds = await dataSource();
    applyGraphics(ds, DOC, ctx(true, [40128])); // E05 ซ่อนตามธง
    const g01 = ds.entities.getById("sat/G01")!;
    const j09 = ds.entities.getById("sat/J09")!;
    const e05 = ds.entities.getById("sat/E05")!;
    const e05Before = shows(e05);
    // กล้องเหนือ G01 1,000 km: G01 ใกล้, J09 ห่างราว 45,000 km (มุม 2 rad บนวงโคจรเดียวกัน)
    const camera = Cartesian3.multiplyByScalar(Cartesian3.normalize(fixed(g01), new Cartesian3()), GPS_R + 1_000_000, new Cartesian3());
    expect(Cartesian3.distance(camera, fixed(j09))).toBeGreaterThan(40_000_000);
    expect(applyModelDetail(ds.entities, camera, 30_000_000, at)).toBe(1); // J09 เปลี่ยน
    expect(shows(g01)).toEqual({ model: true, point: false });
    expect(shows(j09)).toEqual({ model: false, point: true });
    expect(modelCountOf(ds.entities, at)).toBe(1);
    expect(updateModelAttitudes(ds.entities, at)).toBe(1); // ดาวไกลไม่คำนวณท่าทาง
    expect(shows(e05)).toEqual(e05Before);
    expect(e05.isShowing).toBe(false);
    // ไม่มีอะไรเปลี่ยน: ไม่แตะ ไม่มี event
    const changed = vi.fn();
    ds.entities.collectionChanged.addEventListener(changed);
    expect(applyModelDetail(ds.entities, camera, 30_000_000, at)).toBe(0);
    expect(changed).not.toHaveBeenCalled();
    // threshold ใหญ่ขึ้น: J09 กลับเป็นโมเดล
    expect(applyModelDetail(ds.entities, camera, 200_000_000, at)).toBe(1);
    expect(shows(j09)).toEqual({ model: true, point: false });
    expect(changed).toHaveBeenCalledTimes(1); // หนึ่ง event ต่อรอบ
    // กล้องไกลมาก: ทุกดวงเป็นจุด ดาวที่ซ่อนยังไม่ถูกแตะ
    expect(applyModelDetail(ds.entities, new Cartesian3(0, 0, -1e9), 30_000_000, at)).toBe(2);
    expect(shows(g01)).toEqual({ model: false, point: true });
    expect(shows(j09)).toEqual({ model: false, point: true });
    expect(shows(e05)).toEqual(e05Before);
    expect(modelCountOf(ds.entities, at)).toBe(0);
    // ดาวที่กล้องอยู่ในตัว (exclude) ไม่ถูกแตะ
    expect(applyModelDetail(ds.entities, camera, 200_000_000, at, g01)).toBe(1); // J09 เท่านั้น
    expect(shows(g01)).toEqual({ model: false, point: true });
  });

  test("restyle (applyGraphics) brings the model back until the next detail pass", async () => {
    const ds = await dataSource();
    applyGraphics(ds, DOC, ctx(true));
    const g01 = ds.entities.getById("sat/G01")!;
    applyModelDetail(ds.entities, new Cartesian3(0, 0, -1e9), 30_000_000, at);
    expect(shows(g01)).toEqual({ model: false, point: true });
    applyGraphics(ds, DOC, ctx(true));
    expect(shows(g01)).toEqual({ model: true, point: false });
  });
});

// ---------- โมเดลที่ Cesium โหลดไม่สำเร็จ (watchModelErrors) ----------

/** primitive โมเดลของ Cesium แบบที่ ModelVisualizer สร้าง (Model จริงต้องมี WebGL): instanceof Model, id = entity, errorEvent จริง */
function fakeModelPrimitive(id: unknown): Cesium.Model {
  const m = Object.create(Cesium.Model.prototype) as Cesium.Model & { _errorEvent: Cesium.Event };
  m._errorEvent = new Cesium.Event();
  m.id = id;
  return m;
}

function fakeModelScene() {
  const list: unknown[] = [];
  return { list, scene: { preRender: new Cesium.Event(), primitives: { get length() { return list.length; }, get: (i: number) => list[i] } } };
}

describe("watchModelErrors: Cesium load errors of satellite model primitives", () => {
  test("hooks errorEvent of each satellite model primitive (found before the frame updates it) and reports entity + uri once per primitive", () => {
    const entities = new EntityCollection();
    const sat = entities.add(new Entity({ id: "sat/G01", position: orbit(0.1) }));
    applySatelliteModel(sat, { ...LOOK, spec: specOf("gps-iif", "blob:test/a") });
    const other = new Entity({ id: "fac/X" });
    const { list, scene } = fakeModelScene();
    const onError = vi.fn();
    const stop = watchModelErrors(scene as never, onError);
    const p = fakeModelPrimitive(sat);
    list.push(fakeModelPrimitive(other), { id: sat }, p); // โมเดลของ entity อื่น และ primitive ที่ไม่ใช่ Model ไม่ถูกแตะ
    scene.preRender.raiseEvent(scene, TIME);
    scene.preRender.raiseEvent(scene, TIME); // ไม่ hook ซ้ำ
    expect(p.errorEvent.numberOfListeners).toBe(1);
    expect((list[0] as Cesium.Model).errorEvent.numberOfListeners).toBe(0);
    const error = new Error("Failed to load model: blob:test/a");
    p.errorEvent.raiseEvent(error);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(sat, "blob:test/a", error);
    // TextureError (Cesium ยังวาดโมเดลได้ ไม่มีพื้นผิว) ไม่นับ
    const tex = Object.assign(new Error("texture"), { name: "TextureError" });
    p.errorEvent.raiseEvent(tex);
    expect(onError).toHaveBeenCalledTimes(1);
    stop();
    expect(p.errorEvent.numberOfListeners).toBe(0);
    expect(scene.preRender.numberOfListeners).toBe(0);
  });
});

// ---------- สถานะของ primitive โมเดล (test hook satelliteModel) ----------

describe("modelPrimitiveState: the Cesium primitive drawing a satellite's model", () => {
  /** primitive แบบ fakeModelPrimitive พร้อมค่าที่ ModelVisualizer ตั้ง (ready, show, modelMatrix, minimumPixelSize) */
  function primitiveOf(entity: Entity, opts: { ready: boolean; show: boolean; at?: Cesium.Cartesian3; minimumPixelSize?: number }): Cesium.Model {
    const m = fakeModelPrimitive(entity) as Cesium.Model & { _ready: boolean; _show: boolean; _minimumPixelSize: number };
    m._ready = opts.ready;
    m._show = opts.show;
    m._minimumPixelSize = opts.minimumPixelSize ?? 0;
    m.modelMatrix = opts.at === undefined ? Cesium.Matrix4.clone(Cesium.Matrix4.IDENTITY) : Cesium.Matrix4.fromTranslation(opts.at);
    return m;
  }
  const listOf = (list: unknown[]) => ({ get length() { return list.length; }, get: (i: number) => list[i] });

  test("a primitive that is ready and shown but still at its default modelMatrix (the Earth's centre) is reported far from its satellite", () => {
    // ข้อผิดพลาดที่พบ: glb ที่ Cesium โหลดเสร็จหลัง entity เปลี่ยนครั้งสุดท้าย ModelVisualizer ไม่ได้ update อีก (skipIdleDisplayUpdates)
    // primitive ready และ show แต่ modelMatrix ตั้งต้น ขนาดขั้นต่ำ 0: มองไม่เห็น
    const entities = new EntityCollection();
    const sat = entities.add(new Entity({ id: "sat/E14", position: orbit(0.1) }));
    applySatelliteModel(sat, { ...LOOK, spec: specOf("galileo-foc") });
    const r = sat.position!.getValueInReferenceFrame(TIME, Cesium.ReferenceFrame.FIXED, new Cesium.Cartesian3())!;
    const stale = modelPrimitiveState(listOf([{ id: sat }, primitiveOf(sat, { ready: true, show: true })]), sat, TIME);
    expect(stale).toEqual({ model: "galileo-foc", ready: true, shown: true, offsetM: expect.closeTo(Cesium.Cartesian3.magnitude(r), 3), minimumPixelSize: 0 });
    const placed = modelPrimitiveState(listOf([primitiveOf(sat, { ready: true, show: true, at: r, minimumPixelSize: 48 })]), sat, TIME);
    expect(placed).toEqual({ model: "galileo-foc", ready: true, shown: true, offsetM: 0, minimumPixelSize: 48 });
  });

  test("no primitive for the satellite yet, or no model on the entity = null", () => {
    const entities = new EntityCollection();
    const sat = entities.add(new Entity({ id: "sat/G01", position: orbit(0.1) }));
    const plain = entities.add(new Entity({ id: "sat/G02", position: orbit(0.2) }));
    applySatelliteModel(sat, { ...LOOK, spec: specOf("gps-iif") });
    expect(modelPrimitiveState(listOf([primitiveOf(plain, { ready: true, show: true })]), sat, TIME)).toBeNull();
    expect(modelPrimitiveState(listOf([primitiveOf(plain, { ready: true, show: true })]), plain, TIME)).toBeNull();
  });
});

// ---------- โหลด catalog และ glb (SatModelSource) ----------

const glbBytes = (rel: string): ArrayBuffer => {
  const b = readFileSync(resolve(MODELS_DIR, rel));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

/** fetch ปลอม: /models/catalog.json และ glb จากโฟลเดอร์ models (path ใน fail ตอบ 404, ใน html ตอบหน้าแอปแบบ SPA fallback) */
function stubModelFetch(opts: { fail?: string[]; html?: string[]; catalogFails?: boolean; glbs?: Record<string, ArrayBuffer> } = {}) {
  const calls: string[] = [];
  const fetch = vi.fn(async (input: unknown) => {
    const path = new URL(String(input), "http://localhost").pathname;
    calls.push(path);
    if (path === "/models/catalog.json") {
      if (opts.catalogFails) return new Response("nope", { status: 503 });
      return new Response(JSON.stringify(catalog), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    const rel = path.slice("/models/".length);
    if (opts.fail?.includes(rel)) return new Response("missing", { status: 404 });
    if (opts.html?.includes(rel)) return new Response("<!doctype html><html></html>", { status: 200, headers: { "Content-Type": "text/html" } });
    const own = opts.glbs?.[rel];
    if (own !== undefined) return new Response(own, { status: 200, headers: { "Content-Type": "model/gltf-binary" } });
    return new Response(glbBytes(rel), { status: 200, headers: { "Content-Type": "model/gltf-binary" } });
  });
  vi.stubGlobal("fetch", fetch);
  let n = 0;
  const createObjectURL = vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:http://localhost/${++n}`);
  return { calls, createObjectURL };
}

/** fetch ปลอมที่ catalog ตอบทันที ส่วน glb ตอบเมื่อ test สั่ง release(path) (ก่อนหรือหลังคำขอก็ได้) */
function stubDeferredGlbs() {
  const waiting = new Map<string, () => void>();
  const released = new Set<string>();
  const release = (path: string): void => {
    released.add(path);
    waiting.get(path)?.();
  };
  vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
    const path = new URL(String(input), "http://localhost").pathname;
    if (path === "/models/catalog.json") return new Response(JSON.stringify(catalog), { status: 200, headers: { "Content-Type": "application/json" } });
    if (!released.has(path)) await new Promise<void>((r) => waiting.set(path, r));
    return new Response(glbBytes(path.slice("/models/".length)), { status: 200, headers: { "Content-Type": "model/gltf-binary" } });
  }));
  let n = 0;
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:http://localhost/${++n}`);
  return { release };
}

/** ให้คำขอที่ค้างเสร็จและชุดของ SatModelSource (MODEL_BATCH_MS) ปิด */
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, MODEL_BATCH_MS + 20));
};

describe("SatModelSource: catalog and glb loading", () => {
  beforeEach(() => {
    resetModelLoads();
    resetModelReports();
    useMessages.setState(useMessages.getInitialState(), true);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetModelLoads();
  });

  test("points until the catalog and the glb are in; then a blob uri of the catalog glb (one fetch per model for any number of satellites and windows)", async () => {
    const { calls } = stubModelFetch();
    const changedA = vi.fn();
    const changedB = vi.fn();
    const a = new SatModelSource(changedA);
    const b = new SatModelSource(changedB);
    expect(a.specFor({ block: "GAL-2", norad: 40128 })).toBeNull(); // catalog ยังไม่มา
    await flush();
    expect(changedA).toHaveBeenCalledTimes(1);
    // restyle หลัง changed: ดาวสามดวงของโมเดลเดียวกันในหน้าต่าง a ยังเป็นจุดระหว่างโหลด glb
    for (const norad of [1, 2, 3]) expect(a.specFor({ block: "GAL-2", norad })).toBeNull();
    await flush();
    expect(changedA).toHaveBeenCalledTimes(2);
    const spec = a.specFor({ block: "GAL-2", norad: 40128 })!;
    expect(spec).toMatchObject({ id: "galileo-foc", eo: false, wingNodes: ["solar_wing_+Y", "solar_wing_-Y"] });
    expect(spec.uri).toMatch(/^blob:/);
    expect(v3(spec.zeroNormal)).toEqual([-1, 0, 0]);
    expect(b.specFor({ block: "GAL-2", norad: 1 })!.uri).toBe(spec.uri); // หน้าต่างที่มาทีหลังได้ทันที
    expect(changedB).not.toHaveBeenCalled();
    expect(calls.filter((p) => p.endsWith(".glb"))).toEqual(["/models/galileo-foc/galileo_foc.glb"]); // path จาก catalog ไม่ใช่ <id>/<id>.glb
    expect(calls.filter((p) => p === "/models/catalog.json")).toHaveLength(1);
    // block ที่ไม่รู้จัก / ไม่มี block → NORAD → generic; ดาว EO ตาม NORAD
    expect(b.specFor({ block: null, norad: 41836 })).toBeNull();
    expect(b.specFor({ block: "NOT-A-BLOCK", norad: 99 })).toBeNull();
    await flush();
    expect(changedB).toHaveBeenCalledTimes(1); // สองไฟล์เสร็จในชุดเดียวกัน (MODEL_BATCH_MS) = changed() ครั้งเดียว
    expect(b.specFor({ block: null, norad: 41836 })).toMatchObject({ id: "himawari-9", eo: true, wingNodes: ["wing-Y"] });
    expect(b.specFor({ block: "NOT-A-BLOCK", norad: 99 })).toMatchObject({ id: "generic", eo: false });
    expect(useMessages.getState().items).toEqual([]);
  });

  test("glbs that arrive within one batch window make one changed() (one restyle); a glb arriving later makes another", async () => {
    const { release } = stubDeferredGlbs();
    const changed = vi.fn();
    const src = new SatModelSource(changed);
    src.specFor({ block: "GPS-IIF", norad: 1 }); // catalog
    await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
    const sats = [{ block: "GPS-IIF", norad: 1 }, { block: "GPS-IIR-M", norad: 2 }, { block: "GAL-2", norad: 3 }, { block: "GLO-M+", norad: 4 }, { block: "BDS-3M-CAST", norad: 5 }];
    for (const s of sats) expect(src.specFor(s)).toBeNull();
    // ห้าไฟล์มาถึงห่างกัน 15 ms (อยู่ในหน้าต่างเดียว MODEL_BATCH_MS)
    for (const path of ["gps-iif", "gps-iir", "galileo-foc", "glonass-m", "bds3-meo-cast"].map((id) => `/models/${entryOf(id).glb}`)) {
      release(path);
      await new Promise((r) => setTimeout(r, 15));
    }
    await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, MODEL_BATCH_MS * 2));
    expect(changed).toHaveBeenCalledTimes(2);
    for (const s of sats) expect(src.specFor(s)).not.toBeNull();
    // ไฟล์ที่ขอทีหลัง: อีกชุดหนึ่ง
    expect(src.specFor({ block: null, norad: 41836 })).toBeNull();
    release(`/models/${entryOf("himawari-9").glb}`);
    await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(3));
    expect(src.specFor({ block: null, norad: 41836 })?.id).toBe("himawari-9");
    src.dispose();
  });

  test("a glb that fails (404 or the app's HTML page) leaves that model as points with one Thai message per model id", async () => {
    stubModelFetch({ fail: ["gps-iif/gps-iif.glb"], html: ["generic/generic.glb"] });
    const a = new SatModelSource(() => undefined);
    const b = new SatModelSource(() => undefined);
    // สองหน้าต่าง restyle สามรอบ (catalog → glb → วาด)
    for (let round = 0; round < 3; round++) {
      for (const src of [a, b]) {
        for (const norad of [1, 2]) src.specFor({ block: "GPS-IIF", norad });
        src.specFor({ block: null, norad: 7 });
        src.specFor({ block: "GPS-IIR-M", norad: 8 });
      }
      await flush();
    }
    for (const src of [a, b]) {
      expect(src.specFor({ block: "GPS-IIF", norad: 1 })).toBeNull();
      expect(src.specFor({ block: null, norad: 7 })).toBeNull();
      expect(src.specFor({ block: "GPS-IIR-M", norad: 8 })?.id).toBe("gps-iir");
    }
    await flush();
    const items = useMessages.getState().items;
    expect(items.map((m) => [m.level, m.code])).toEqual([["warning", "MODEL_LOAD"], ["warning", "MODEL_LOAD"]]);
    expect(items[0].text).toContain("gps-iif");
    expect(items[1].text).toContain("generic");
    expect(items[0].text.startsWith(msg("model.loadFailed", { model: "gps-iif", message: "" }).split("(")[0])).toBe(true);
  });

  test("a catalog that cannot be loaded leaves every satellite as points, with one Thai message", async () => {
    stubModelFetch({ catalogFails: true });
    const a = new SatModelSource(() => undefined);
    a.specFor({ block: "GPS-IIF", norad: 1 });
    await flush();
    expect(a.specFor({ block: "GPS-IIF", norad: 1 })).toBeNull();
    const b = new SatModelSource(() => undefined);
    b.specFor({ block: "GPS-IIF", norad: 1 });
    await flush();
    expect(useMessages.getState().items.map((m) => m.code)).toEqual(["MODEL_CATALOG"]);
  });

  test("glbProblem: the JSON chunk must say glTF 2.0 and require only extensions Cesium supports; the chunks must fit the file", () => {
    const asset = { asset: { version: "2.0" } };
    expect(glbProblem(glbBytes(entryOf("gps-iif").glb))).toBeNull();
    expect(glbProblem(makeGlb(asset))).toBeNull();
    expect(glbProblem(makeGlb({ ...asset, extensionsRequired: [] }))).toBeNull();
    expect(glbProblem(makeGlb({ ...asset, extensionsRequired: ["KHR_materials_unlit"], extensionsUsed: ["KHR_materials_unlit"] }))).toBeNull();
    expect(glbProblem(makeGlb(asset, new Uint8Array([1, 2, 3, 4])))).toBeNull();
    expect(glbProblem(makeGlb({ asset: { version: "1.0" } }))).toMatch(/1\.0/);
    expect(glbProblem(makeGlb({}))).not.toBeNull();
    expect(glbProblem(makeGlb({ ...asset, extensionsRequired: ["EXT_not_in_cesium"] }))).toMatch(/EXT_not_in_cesium/);
    expect(glbProblem(makeGlb({ ...asset, extensionsRequired: "KHR_materials_unlit" }))).not.toBeNull();
    expect(glbProblem(makeGlb(null, undefined, { jsonText: "{not json" }))).not.toBeNull();
    expect(glbProblem(makeGlb(asset, undefined, { jsonType: 0x004e4942 }))).not.toBeNull(); // chunk แรกไม่ใช่ JSON
    expect(glbProblem(makeGlb(asset, undefined, { lengthDelta: 8 }))).not.toBeNull(); // ความยาวในหัวไม่ตรงไฟล์
    expect(glbProblem(new TextEncoder().encode("<!doctype html><html></html>").buffer as ArrayBuffer)).not.toBeNull();
  });

  test("the extensions allowed in extensionsRequired are exactly Cesium's ModelUtility.supportedExtensions (a Cesium upgrade that changes it fails here)", () => {
    const { ModelUtility: mu } = Cesium as unknown as { ModelUtility: { supportedExtensions: Record<string, boolean> } };
    expect([...CESIUM_GLTF_EXTENSIONS].sort()).toEqual(Object.keys(mu.supportedExtensions).filter((k) => mu.supportedExtensions[k]).sort());
  });

  test("a glb whose JSON chunk Cesium would reject (glTF 1.0, unknown required extension) leaves that model as points with one Thai message", async () => {
    stubModelFetch({ glbs: { "gps-iif/gps-iif.glb": makeGlb({ asset: { version: "1.0" } }), "generic/generic.glb": makeGlb({ asset: { version: "2.0" }, extensionsRequired: ["EXT_not_in_cesium"] }) } });
    const a = new SatModelSource(() => undefined);
    for (let round = 0; round < 3; round++) {
      a.specFor({ block: "GPS-IIF", norad: 1 });
      a.specFor({ block: null, norad: 7 });
      await flush();
    }
    expect(a.specFor({ block: "GPS-IIF", norad: 1 })).toBeNull();
    expect(a.specFor({ block: null, norad: 7 })).toBeNull();
    const items = useMessages.getState().items;
    expect(items.map((m) => m.code)).toEqual(["MODEL_LOAD", "MODEL_LOAD"]);
    expect(items[0].text).toContain("gps-iif");
    expect(items[1].text).toContain("EXT_not_in_cesium");
    a.dispose();
  });

  test("a model that Cesium fails to load (errorEvent of its primitive) goes back to points in every window, with one Thai message per model id", async () => {
    stubModelFetch();
    const changedA = vi.fn();
    const changedB = vi.fn();
    const a = new SatModelSource(changedA);
    const b = new SatModelSource(changedB);
    for (let round = 0; round < 2; round++) {
      a.specFor({ block: "GPS-IIF", norad: 1 });
      b.specFor({ block: "GPS-IIF", norad: 2 });
      await flush();
    }
    const spec = a.specFor({ block: "GPS-IIF", norad: 1 })!;
    expect(spec.id).toBe("gps-iif");
    changedA.mockClear();
    changedB.mockClear();
    a.modelFailed(spec.uri, new Error("Failed to load model: boom"));
    a.modelFailed(spec.uri, new Error("again (second satellite of the same model)"));
    b.modelFailed(spec.uri, new Error("again (other window)"));
    expect(a.specFor({ block: "GPS-IIF", norad: 1 })).toBeNull();
    expect(b.specFor({ block: "GPS-IIF", norad: 2 })).toBeNull();
    await flush();
    expect(changedA).toHaveBeenCalledTimes(1); // restyle: ดาวของโมเดลนี้กลับเป็นจุด
    expect(changedB).toHaveBeenCalledTimes(1);
    const items = useMessages.getState().items;
    expect(items.map((m) => [m.level, m.code])).toEqual([["warning", "MODEL_LOAD"]]);
    expect(items[0].text).toBe(msg("model.loadFailed", { model: "gps-iif", message: "Failed to load model: boom" }));
    // ไม่ลองโหลดซ้ำ
    a.specFor({ block: "GPS-IIF", norad: 1 });
    await flush();
    expect(a.specFor({ block: "GPS-IIF", norad: 1 })).toBeNull();
    // uri ที่ไม่ใช่ของโมเดลใด: ไม่ทำอะไร
    a.modelFailed("blob:http://localhost/unknown", new Error("x"));
    expect(useMessages.getState().items).toHaveLength(1);
    a.dispose();
    b.dispose();
  });

  test("loadModelGlb checks the glb header before making a blob url", async () => {
    stubModelFetch({ html: ["aqua/aqua.glb"] });
    await expect(loadModelGlb("/models/aqua/aqua.glb")).rejects.toThrow();
    await expect(loadModelGlb("/models/terra/terra.glb")).resolves.toMatch(/^blob:/);
  });
});

// ---------- หน้าต่าง 3D ที่ mount จริง (รอบ throttle, modelCount) ----------

describe("3D window with models", () => {
  const OMEGA = (2 * Math.PI) / 43_082;
  const TweenCollection = (Cesium as unknown as { TweenCollection: new () => unknown }).TweenCollection;

  function fakeViewer() {
    const scene0: Record<string, unknown> = {
      drawingBufferWidth: 400, drawingBufferHeight: 300, mapProjection: new GeographicProjection(), tweens: new TweenCollection(), mode: SceneMode.SCENE3D,
      ellipsoid: Ellipsoid.WGS84, globe: undefined, screenSpaceCameraController: { minimumZoomDistance: 1, maximumZoomDistance: Infinity }, requestRender: () => undefined,
    };
    const camera = new Camera(scene0 as never);
    const canvas = document.createElement("canvas");
    const requestRender = vi.fn();
    const scene = {
      canvas, globe: { baseColor: Color.BLUE, enableLighting: false, ellipsoid: Ellipsoid.WGS84 }, light: { intensity: 1 },
      postRender: new Cesium.Event(), preRender: new Cesium.Event(), renderError: new Cesium.Event(), requestRender, primitives: new Cesium.PrimitiveCollection(),
      screenSpaceCameraController: { enableInputs: true, enableRotate: true, enableTranslate: true, enableTilt: true, enableLook: true },
    };
    return {
      scene, camera, canvas, clock: new Cesium.Clock(), entities: new EntityCollection(), dataSources: new Cesium.DataSourceCollection(),
      dataSourceDisplay: { update: () => true }, imageryLayers: new Cesium.ImageryLayerCollection(), trackedEntity: undefined as Entity | undefined,
      screenSpaceEventHandler: new ScreenSpaceEventHandler(canvas), isDestroyed: () => false, resize: () => undefined,
    };
  }

  function satOrbit(phase: number) {
    const p = new SampledPositionProperty(ReferenceFrame.FIXED);
    const now = JulianDate.fromDate(useTime.getState().current);
    for (let s = -1200; s <= 1200; s += 60) {
      const a = OMEGA * s + phase;
      p.addSample(JulianDate.addSeconds(now, s, new JulianDate()), new Cartesian3(GPS_R * Math.cos(a), GPS_R * Math.sin(a) * 0.5, GPS_R * Math.sin(a) * 0.866));
    }
    return p;
  }

  beforeEach(() => {
    resetModelLoads();
    resetModelReports();
    useMessages.setState(useMessages.getInitialState(), true);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetModelLoads();
    useResults.setState({ prnByNorad: new Map() });
    useScenario.setState({ name: null, doc: null, tree: null });
    useLayout.setState({ windowProps: {} });
    useSelection.setState({ activePath: null });
    vi.mocked(createViewer).mockReset();
    vi.mocked(destroyViewer).mockReset();
  });

  async function mount(windowProps: Record<string, unknown> = {}, sensors: Record<string, string[]> = {}) {
    stubModelFetch();
    const doc = makeScenarioDoc({}, sensors);
    for (const o of doc.objects as { name: string; graphics3d?: unknown }[]) if (o.name === "G05") o.graphics3d = { show: false };
    useScenario.setState({ name: "S1", doc, tree: null, catalog: new Map(CATALOG.map((e) => [e.norad, e])) });
    useTime.getState().init(doc);
    useResults.setState({ prnByNorad: new Map([[40101, "G01"], [40102, "G02"], [40105, "G05"]]) });
    useLayout.setState({ windowProps: { graphics3d: windowProps } });
    const viewer = fakeViewer();
    vi.mocked(createViewer).mockReturnValueOnce(viewer as never);
    const scene = mountScene3D("graphics3d", document.createElement("div"));
    await vi.waitFor(() => expect(viewer.dataSources.length).toBe(1));
    const ds = viewer.dataSources.get(0);
    ds.entities.add(new Entity({ id: "sat/G01", position: satOrbit(1.75) }));
    ds.entities.add(new Entity({ id: "sat/G02", position: satOrbit(1.9) }));
    ds.entities.add(new Entity({ id: "sat/G05", position: satOrbit(2.2) }));
    act(() => useScenario.setState({ doc: { ...doc } }));
    return { viewer, scene, ds };
  }

  test("models appear once the glb is in (shown satellites only); Satellite Models off brings the points back", async () => {
    const { scene, ds } = await mount();
    await vi.waitFor(() => expect(scene.modelCount()).toBe(2)); // G01, G02 (G05 ปิด Show)
    const g01 = ds.entities.getById("sat/G01")!;
    expect(value<string>(g01.model!.uri)).toMatch(/^blob:/);
    expect(value<number>(g01.model!.minimumPixelSize)).toBe(48);
    expect(value<boolean>(g01.point!.show)).toBe(false);
    expect(Quaternion.equals(g01.orientation!.getValue(JulianDate.fromDate(useTime.getState().current)) as Quaternion, Quaternion.IDENTITY)).toBe(false);
    expect(scene.entityColor("G01")).not.toBeNull();
    act(() => useLayout.getState().setWindowProps("graphics3d", { satelliteModels: false }));
    expect(scene.modelCount()).toBe(0);
    expect(g01.model).toBeUndefined();
    expect(value<boolean | undefined>(g01.point!.show) ?? true).toBe(true);
    act(() => useLayout.getState().setWindowProps("graphics3d", { satelliteModels: true, modelPixelSize: 64 }));
    expect(scene.modelCount()).toBe(2);
    expect(value<number>(g01.model!.minimumPixelSize)).toBe(64);
    scene.destroy();
  });

  test("attitude follows time on the 250 ms throttle: the first change at once, changes inside the window once at its end", async () => {
    const { scene, ds } = await mount();
    await vi.waitFor(() => expect(scene.modelCount()).toBe(2));
    const g01 = ds.entities.getById("sat/G01")!;
    const now = () => JulianDate.fromDate(useTime.getState().current);
    const q = () => (g01.orientation!.getValue(now()) as Quaternion).clone();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    act(() => useScenario.setState({ doc: { ...useScenario.getState().doc! } })); // restyle = รอบทันที (นาฬิกาของ throttle เริ่มที่เวลาปลอม)
    vi.advanceTimersByTime(1000);
    const base = useTime.getState().current.getTime();
    const q0 = q();
    act(() => useTime.getState().setCurrent(new Date(base + 60_000)));
    const q1 = q();
    expect(Quaternion.equalsEpsilon(q1, q0, 1e-9)).toBe(false); // ครั้งแรกหลังเงียบ: ทันที
    act(() => useTime.getState().setCurrent(new Date(base + 120_000)));
    act(() => useTime.getState().setCurrent(new Date(base + 180_000)));
    expect(Quaternion.equals(q(), q1)).toBe(true); // ภายในช่วง: ยังไม่อัปเดต
    vi.advanceTimersByTime(250);
    const q3 = q();
    expect(Quaternion.equalsEpsilon(q3, q1, 1e-9)).toBe(false);
    const frame = yawSteeringFrame(
      g01.position!.getValueInReferenceFrame(now(), ReferenceFrame.FIXED, new Cartesian3())!,
      Cartesian3.subtract(
        g01.position!.getValueInReferenceFrame(JulianDate.addSeconds(now(), 1, new JulianDate()), ReferenceFrame.FIXED, new Cartesian3())!,
        g01.position!.getValueInReferenceFrame(JulianDate.addSeconds(now(), -1, new JulianDate()), ReferenceFrame.FIXED, new Cartesian3())!,
        new Cartesian3(),
      ),
      sunPositionEcef(now()),
    )!;
    expect(Quaternion.equalsEpsilon(q3, modelOrientation(frame), 1e-9) || Quaternion.equalsEpsilon(q3, Quaternion.negate(modelOrientation(frame), new Quaternion()), 1e-9)).toBe(true);
    scene.destroy();
  });

  test("a model whose primitive reports a Cesium load error goes back to points (all satellites of that model), with one Thai message", async () => {
    const { scene, ds, viewer } = await mount();
    await vi.waitFor(() => expect(scene.modelCount()).toBe(2));
    const g01 = ds.entities.getById("sat/G01")!;
    const id = value<string>(g01.model!.uri);
    expect(value<string>(ds.entities.getById("sat/G02")!.model!.uri)).toBe(id); // ดาวสองดวงใช้โมเดลเดียวกัน
    // แบบที่ ModelVisualizer ทำ: primitive ของ entity อยู่ใน scene.primitives แล้วเฟรมถัดไป update ของมันแจ้ง errorEvent
    const p1 = fakeModelPrimitive(g01);
    const p2 = fakeModelPrimitive(ds.entities.getById("sat/G02")!);
    viewer.scene.primitives.add(p1);
    viewer.scene.primitives.add(p2);
    viewer.scene.preRender.raiseEvent(viewer.scene, JulianDate.now());
    p1.errorEvent.raiseEvent(new Error("Failed to load model: broken buffer"));
    p2.errorEvent.raiseEvent(new Error("Failed to load model: broken buffer"));
    await vi.waitFor(() => expect(scene.modelCount()).toBe(0));
    expect(g01.model).toBeUndefined();
    expect(scene.pointShown("G01")).toBe(true);
    expect(scene.pointShown("G02")).toBe(true);
    const items = useMessages.getState().items;
    expect(items.map((m) => m.code)).toEqual(["MODEL_LOAD"]);
    expect(items[0].text).toContain("broken buffer");
    scene.destroy();
    expect(viewer.scene.preRender.numberOfListeners).toBe(0);
  });

  const now = () => JulianDate.fromDate(useTime.getState().current);
  const modelShows = (e: Entity) => (e.model?.show?.getValue(now()) ?? true) === true;

  test("Model Detail Threshold (default 30,000 km): camera moves (camera.changed, 5%) and threshold edits switch models and points; hidden satellites stay hidden", async () => {
    const { scene, viewer } = await mount();
    expect(viewer.camera.percentageChanged).toBe(0.05);
    // Home View: กล้องห่างศูนย์กลางโลก 5.5 รัศมี G01 และ G02 ห่างกล้องราว 25,000 km
    await vi.waitFor(() => expect(scene.modelCount()).toBe(2));
    expect(scene.pointShown("G01")).toBe(false);
    // กล้องไกล (150,000 km จากศูนย์กลางโลก): ทุกดวงเป็นจุด หลังรอบ throttle ที่ camera.changed ขอ
    viewer.camera.setView({ destination: new Cartesian3(0, 0, -1.5e8) });
    viewer.camera.changed.raiseEvent(1);
    await vi.waitFor(() => expect(scene.modelCount()).toBe(0));
    expect(scene.pointShown("G01")).toBe(true);
    expect(scene.pointShown("G02")).toBe(true);
    expect(scene.pointShown("G05")).toBe(false); // ปิด Show: ซ่อนต่อไป
    expect(scene.labelShown("G05")).toBe(false);
    // Window Properties: threshold 200,000 km = โมเดลทันที (restyle)
    act(() => useLayout.getState().setWindowProps("graphics3d", { modelDetailThreshold: 200_000 }));
    expect(scene.modelCount()).toBe(2);
    expect(scene.pointShown("G01")).toBe(false);
    expect(scene.pointShown("G05")).toBe(false);
    act(() => useLayout.getState().setWindowProps("graphics3d", { modelDetailThreshold: 1_000 }));
    expect(scene.modelCount()).toBe(0);
    expect(scene.pointShown("G02")).toBe(true);
    scene.destroy();
  });

  test("Sensor View camera mode still hides everything after detail passes", async () => {
    const { scene, viewer } = await mount({}, { G01: ["Sensor1"] });
    await vi.waitFor(() => expect(scene.modelCount()).toBe(2));
    const sensorScene = scene as unknown as SensorViewHandle;
    expect(sensorScene.viewFromSensor("*/Sensor/Sensor1", "north", "camera", 1)).toBe("ok");
    expect(sensorScene.sensorCamera()?.visibleEntityCount).toBe(0);
    viewer.camera.changed.raiseEvent(1);
    act(() => useTime.getState().setCurrent(new Date(useTime.getState().current.getTime() + 60_000)));
    await new Promise((r) => setTimeout(r, 300)); // รอบ throttle ถัดไปผ่านไปแล้ว
    expect(sensorScene.sensorCamera()?.visibleEntityCount).toBe(0);
    expect(scene.modelCount()).toBe(0);
    scene.destroy();
  });

  test("View From/To from a satellite hides its model, point and label (the camera is inside it); detail passes keep it hidden; leaving brings it back", async () => {
    const { scene, ds, viewer } = await mount();
    await vi.waitFor(() => expect(scene.modelCount()).toBe(2));
    const g01 = ds.entities.getById("sat/G01")!;
    expect(scene.viewFromTo({ from: "*/Satellite/G01", to: "*/Facility/THBK", frame: "fixed" })).toBe("ok");
    expect(modelShows(g01)).toBe(false);
    expect(scene.pointShown("G01")).toBe(false);
    expect(scene.labelShown("G01")).toBe(false);
    expect(scene.modelCount()).toBe(1); // G02
    expect(scene.labelShown("G02")).toBe(true);
    // กล้องอยู่ที่ G01: รอบ detail (G01 ใกล้กล้องที่สุด) ไม่ทำให้โมเดลหรือจุดของมันกลับมา
    viewer.camera.changed.raiseEvent(1);
    act(() => useTime.getState().setCurrent(new Date(useTime.getState().current.getTime() + 60_000)));
    await new Promise((r) => setTimeout(r, 300));
    expect(modelShows(g01)).toBe(false);
    expect(scene.pointShown("G01")).toBe(false);
    // From เป็น Facility: ดาวไม่ถูกซ่อน
    expect(scene.viewFromTo({ from: "*/Facility/THBK", to: "*/Satellite/G02", frame: "fixed" })).toBe("ok");
    expect(scene.labelShown("G01")).toBe(true);
    expect(scene.pointShown("G01") === true || modelShows(g01)).toBe(true);
    // กลับไปมองจาก G01 แล้วออก (Home View)
    expect(scene.viewFromTo({ from: "*/Satellite/G01", to: "*/Satellite/G02", frame: "fixed" })).toBe("ok");
    expect(scene.labelShown("G01")).toBe(false);
    scene.homeView();
    expect(scene.labelShown("G01")).toBe(true);
    expect(scene.modelCount()).toBe(2);
    scene.destroy();
  });

  test("flyToSatellite (test hook): camera looks at the satellite from rangeM on its sun side, with the lookAt transform released", async () => {
    const { scene, ds, viewer } = await mount();
    await vi.waitFor(() => expect(scene.modelCount()).toBe(2));
    expect(scene.flyToSatellite("NOPE", 50_000)).toBe(false);
    expect(scene.flyToSatellite("G01", 50_000)).toBe(true);
    const r = ds.entities.getById("sat/G01")!.position!.getValueInReferenceFrame(now(), ReferenceFrame.FIXED, new Cartesian3())!;
    const toSun = Cartesian3.normalize(Cartesian3.subtract(sunPositionEcef(now()), r, new Cartesian3()), new Cartesian3());
    const expected = Cartesian3.add(r, Cartesian3.multiplyByScalar(toSun, 50_000, new Cartesian3()), new Cartesian3());
    expect(Matrix4.equals(viewer.camera.transform, Matrix4.IDENTITY)).toBe(true);
    expect(Cartesian3.distance(viewer.camera.positionWC, expected)).toBeLessThan(1);
    const look = Cartesian3.normalize(Cartesian3.subtract(r, viewer.camera.positionWC, new Cartesian3()), new Cartesian3());
    expect(angleDeg(viewer.camera.directionWC, look)).toBeLessThan(1e-6);
    expect(viewer.trackedEntity).toBeUndefined();
    expect(scene.modelCount()).toBe(2); // 50 km: ใกล้ (โมเดล) ทันที ไม่รอ camera.changed
    scene.destroy();
  });

  test("picking and labels are unchanged with models on; selecting a satellite outlines its model", async () => {
    const { scene, ds } = await mount();
    await vi.waitFor(() => expect(scene.modelCount()).toBe(2));
    expect(scene.labelShown("G01")).toBe(true);
    expect(scene.labelShown("G05")).toBe(false);
    act(() => useSelection.getState().select("*/Satellite/G02"));
    expect(value<number>(ds.entities.getById("sat/G02")!.model!.silhouetteSize)).toBe(SELECTED_SILHOUETTE_PX);
    expect(value<number>(ds.entities.getById("sat/G01")!.model!.silhouetteSize)).toBe(MODEL_SILHOUETTE_PX);
    scene.destroy();
  });
});

describe("sunSideOffset (flyToSatellite)", () => {
  test("the east-north-up offset of the camera is rangeM toward the sun from the target", () => {
    const target = new Cartesian3(15e6, -9e6, 19e6);
    const sun = sunPositionEcef(TIME);
    const enu = sunSideOffset(target, sun, 50_000);
    expect(Cartesian3.magnitude(enu)).toBeCloseTo(50_000, 6);
    const rotation = Matrix4.getMatrix3(Cesium.Transforms.eastNorthUpToFixedFrame(target), new Matrix3());
    const ecef = Matrix3.multiplyByVector(rotation, enu, new Cartesian3());
    expect(angleDeg(ecef, Cartesian3.subtract(sun, target, new Cartesian3()))).toBeLessThan(1e-9);
  });
});
