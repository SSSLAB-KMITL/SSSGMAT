// ภาพที่เปลี่ยนตามเวลาของหน้าต่าง 2D (src/cesium/overlay2d.ts) ด้วยคลาสจริงของ Cesium (ไม่วาด: ไม่มี WebGL ใน jsdom)
// การเลือกดาวที่มี Swath, วง Swath, พื้นที่ Filled Limits และเมื่อไรต้องสร้างใหม่, เส้นแบ่งกลางวันกลางคืน, จุดและเส้นทาง IPP, รอยของ sensor
// และตัวจัดการ primitive ที่ตั้งค่าตามรอบ (Shading ใช้แสงของ globe ไม่มีพื้นที่กลางคืนที่วาดเอง)

import { Cartesian3, Cartographic, Color, Math as CMath, PointPrimitiveCollection, PolylineCollection, Primitive, PrimitiveCollection, type Geometry } from "cesium";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { capColumns } from "../../src/cesium/lonlat";
import { subsolarPoint } from "../../src/cesium/night";
import {
  FILL_MOVE_DEG, fillMoved, fillStates, ippItems, lonLatPositions, MAX_LAT, meshGeometry, Overlays2D, sensorFillStates, sensorItems, swathInputs, swathItems,
  terminatorItem, type FillState, type LineItem, type SwathInput,
} from "../../src/cesium/overlay2d";
import { drawableSensors, sensorDrawState, type SensorDrawState, type SensorObj } from "../../src/cesium/sensorDraw";
import { nadirCentralAngleRad } from "../../src/cesium/sensorGeometry";
import { EARTH_RADIUS_KM, footprintCentralAngleRad, WGS84_E2 } from "../../src/cesium/swath";
import type { EntityLook, SceneStyle } from "../../src/cesium/graphics";
import { makeDoc } from "./helpers/chrome";
import { sensorObj } from "./helpers/objects";

// jsdom ไม่มี ImageBitmap และ OffscreenCanvas (Material ของ Cesium ใช้ instanceof ทั้งสองตอนดูชนิดของ uniform) browser มีเสมอ
beforeAll(() => {
  vi.stubGlobal("ImageBitmap", class ImageBitmap {});
  vi.stubGlobal("OffscreenCanvas", class OffscreenCanvas {});
});
afterAll(() => vi.unstubAllGlobals());

const STYLE: SceneStyle = {
  labelFont: "12px sans-serif", labelOutline: "#000000", pointOutline: "#000000", accessWidth: 1, gridLine: "#ffffff",
  swathFillOpacity: 0.3, swathEdgeWidth: 1.5, terminatorLine: "#ffeeaa", terminatorWidth: 2, ippPointSize: 7, ippTrackWidth: 3,
};
const deg = (c: Cartesian3): { lat: number; lon: number } => {
  const g = Cartographic.fromCartesian(c);
  return { lat: CMath.toDegrees(g.latitude), lon: CMath.toDegrees(g.longitude) };
};
/** มุมระหว่างทิศของสองตำแหน่งจากศูนย์กลางโลก (เรเดียน) */
const angle = (a: Cartesian3, b: Cartesian3): number => Cartesian3.angleBetween(a, b);
/** ทิศจากละติจูด/ลองจิจูดบนทรงกลม (ละติจูด geocentric ตามที่ swath.ts ใช้) */
const dir = (lat: number, lon: number): Cartesian3 =>
  new Cartesian3(Math.cos(CMath.toRadians(lat)) * Math.cos(CMath.toRadians(lon)), Math.cos(CMath.toRadians(lat)) * Math.sin(CMath.toRadians(lon)), Math.sin(CMath.toRadians(lat)));
const red = Color.fromCssColorString("#ff0000");

function vertices(g: Geometry): Cartesian3[] {
  const v = g.attributes.position!.values as Float64Array;
  return Array.from({ length: v.length / 3 }, (_, i) => new Cartesian3(v[3 * i], v[3 * i + 1], v[3 * i + 2]));
}

describe("lonLatPositions and meshGeometry", () => {
  test("positions are on the ellipsoid at the given longitude; the poles are pulled in to MAX_LAT so the longitude survives", () => {
    const [a, b] = lonLatPositions([[100, 13.7], [-179.5, 90]]);
    expect(deg(a).lon).toBeCloseTo(100, 9);
    expect(deg(a).lat).toBeCloseTo(13.7, 9);
    expect(deg(b).lat).toBeCloseTo(MAX_LAT, 9);
    expect(deg(b).lon).toBeCloseTo(-179.5, 6);
  });

  test("a cap over the pole and across 180° becomes triangles no wider than one column", () => {
    const g = meshGeometry(capColumns(55, 170, footprintCentralAngleRad(20200, 10), 2))!;
    expect(g.indices!.length % 3).toBe(0);
    const v = vertices(g).map(deg);
    for (let i = 0; i < g.indices!.length; i += 3) {
      const lons = [0, 1, 2].map((k) => v[g.indices![i + k]].lon);
      expect(Math.max(...lons) - Math.min(...lons)).toBeLessThanOrEqual(2 + 1e-6);
    }
    expect(Math.max(...v.map((p) => p.lat))).toBeCloseTo(MAX_LAT, 6);
    expect(g.boundingSphere).toBeDefined();
  });

  test("nothing to fill gives no geometry", () => {
    expect(meshGeometry(capColumns(0, 0, 1e-9, 2).map((c) => ({ ...c, lo: null, hi: null })))).toBeNull();
  });
});

describe("swathItems", () => {
  const p = Cartesian3.fromElements(26_571_008.8 * Math.cos(CMath.toRadians(20)), 0, 26_571_008.8 * Math.sin(CMath.toRadians(20))); // สูง 20,200 km เหนือ (20°N, 0°)

  test("Edge Limits is a closed ring at the footprint angle in the satellite colour", () => {
    const { edges, fills } = swathItems([{ key: "sat/G01", position: p, color: red, elevationDeg: 10, options: "Edge Limits" }], STYLE);
    expect(fills).toEqual([]);
    expect(edges).toHaveLength(1);
    const ring = edges[0];
    expect(ring.key).toBe("sat/G01");
    expect(ring.width).toBe(1.5);
    expect(ring.color.toCssHexString()).toBe("#ff0000");
    expect(Cartesian3.equals(ring.positions[0], ring.positions.at(-1)!)).toBe(true);
    const theta = footprintCentralAngleRad(26_571.0088 - EARTH_RADIUS_KM, 10);
    // ศูนย์กลางวาดที่ละติจูด geodetic ของจุดใต้ดาว (ดาวอยู่ที่ geocentric 20°): วงรอบจุดนั้นที่มุม θ พอดี
    const centreLat = CMath.toDegrees(Math.atan2(Math.sin(CMath.toRadians(20)), (1 - WGS84_E2) * Math.cos(CMath.toRadians(20))));
    expect(centreLat).toBeCloseTo(20.1240, 4);
    for (const q of ring.positions) {
      const { lat, lon } = deg(q);
      expect(Math.abs(angle(dir(lat, lon), dir(centreLat, 0)) - theta)).toBeLessThan(1e-9);
    }
  });

  test("Filled Limits is a translucent mesh in the satellite colour; No Graphics and satellites under ground draw nothing", () => {
    const { edges, fills } = swathItems(
      [
        { key: "sat/G01", position: p, color: red, elevationDeg: 10, options: "Filled Limits" },
        { key: "sat/G02", position: p, color: red, elevationDeg: 10, options: "No Graphics" },
        { key: "sat/X", position: new Cartesian3(1000, 0, 0), color: red, elevationDeg: 10, options: "Edge Limits" },
      ],
      STYLE,
    );
    expect(edges).toEqual([]);
    expect(fills.map((f) => f.key)).toEqual(["sat/G01"]);
    expect(fills[0].color.alpha).toBeCloseTo(0.3, 6);
    expect(fills[0].color.red).toBe(1);
  });
});

describe("terminatorItem (Lighting → Show Outline)", () => {
  test("the terminator 90° from the sun in the theme's colour and width", () => {
    const d = new Date("2026-11-11T03:30:00Z");
    const line = terminatorItem(d, STYLE);
    const s = subsolarPoint(d);
    expect(line.key).toBe("terminator");
    expect(line.color.toCssHexString()).toBe("#ffeeaa");
    expect(line.width).toBe(2);
    expect(line.positions).toHaveLength(181);
    for (const q of line.positions) {
      const { lat, lon } = deg(q);
      if (Math.abs(lat) > 89) continue; // จุดที่ถูกดึงจากขั้ว
      expect(Math.abs(angle(dir(lat, lon), dir(s.lat, s.lon)) - Math.PI / 2)).toBeLessThan(1e-9);
    }
  });
});

describe("swathInputs: which satellites draw a swath", () => {
  const g = (show: boolean, color = "#ff0000") => ({ show, color, labelShow: show, pointPixelSize: 6, markerStyle: "Point", lineStyle: "Solid", lineWidth: 1 });
  const sat = (name: string, swath?: object) => ({ class: "Satellite", name, norad: 1, ...(swath === undefined ? {} : { graphics2d: { swath } }) }) as never;
  const p = new Cartesian3(26_571_008.8, 0, 0);
  const looks = new Map<string, EntityLook>([
    ["sat/G01", { obj: sat("G01", { options: "Filled Limits", elevation_deg: 15 }), g: g(true, "#00ff00") }],
    ["sat/G02", { obj: sat("G02", { options: "Edge Limits" }), g: g(true) }],
    ["sat/G03", { obj: sat("G03", { options: "Edge Limits" }), g: g(false) }],
    ["sat/G04", { obj: sat("G04"), g: g(true) }],
    ["sat/G05", { obj: sat("G05", { options: "No Graphics" }), g: g(true) }],
    ["sat/G06", { obj: sat("G06", { options: "Edge Limits" }), g: g(true) }],
    ["fac/THBK", { obj: { class: "Facility", name: "THBK" } as never, g: g(true) }],
  ]);

  test("shown satellites with Edge or Filled Limits and a position now, with their colour and elevation (default 10°)", () => {
    const inputs = swathInputs(looks, (id) => (id === "sat/G06" ? undefined : p));
    expect(inputs.map((s) => [s.key, s.options, s.elevationDeg, s.color.toCssHexString()])).toEqual([
      ["sat/G01", "Filled Limits", 15, "#00ff00"],
      ["sat/G02", "Edge Limits", 10, "#ff0000"],
    ]);
    expect(inputs[0].position).toBe(p);
  });
});

describe("Filled Limits: rebuild only when a footprint moved", () => {
  const at = (key: string, lat: number, lon: number, color = Color.RED, elevationDeg = 10, altM = 26_571_008.8): SwathInput => ({
    key, color, elevationDeg, options: "Filled Limits",
    position: Cartesian3.fromElements(altM * Math.cos(CMath.toRadians(lat)) * Math.cos(CMath.toRadians(lon)), altM * Math.cos(CMath.toRadians(lat)) * Math.sin(CMath.toRadians(lon)), altM * Math.sin(CMath.toRadians(lat))),
  });

  test("states cover only Filled Limits satellites that have a footprint", () => {
    const states = fillStates([at("a", 10, 20), { ...at("b", 0, 0), options: "Edge Limits" }, { ...at("c", 0, 0), position: new Cartesian3(1000, 0, 0) }]);
    expect(states.map((x: FillState) => x.key)).toEqual(["a"]);
    expect(states[0].angleDeg).toBeCloseTo(66.341744, 5);
  });

  test("nothing before, another set of satellites, a colour or elevation change, or a move of more than 0.5° rebuilds; small moves do not", () => {
    expect(FILL_MOVE_DEG).toBe(0.5);
    const base = fillStates([at("a", 10, 20), at("b", -30, 179.8)]);
    expect(fillMoved(null, base)).toBe(true);
    expect(fillMoved(base, fillStates([at("a", 10, 20), at("b", -30, 179.8)]))).toBe(false);
    expect(fillMoved(base, fillStates([at("a", 10.3, 20), at("b", -30, -179.9)]))).toBe(false); // 0.3° และข้ามเส้น 180° ไป 0.26°
    expect(fillMoved(base, fillStates([at("a", 10.6, 20), at("b", -30, 179.8)]))).toBe(true);
    expect(fillMoved(base, fillStates([at("a", 10, 20)]))).toBe(true);
    expect(fillMoved(base, fillStates([at("a", 10, 20, Color.BLUE), at("b", -30, 179.8)]))).toBe(true);
    expect(fillMoved(base, fillStates([at("a", 10, 20, Color.RED, 20), at("b", -30, 179.8)]))).toBe(true);
    expect(fillMoved(fillStates([]), fillStates([]))).toBe(false);
  });
});

describe("ippItems", () => {
  test("points and track segments in the satellite colour; satellites without a colour (hidden or not in the scenario) are left out", () => {
    const sel = {
      points: [{ prn: "G01", lat: 10, lon: 100, el: 40 }, { prn: "G09", lat: 11, lon: 101, el: 20 }],
      tracks: [
        { prn: "G01", segments: [[[99, 9], [100, 10]], [[100.5, 10.5], [101, 11]]] as [number, number][][] },
        { prn: "G09", segments: [[[1, 1], [2, 2]]] as [number, number][][] },
      ],
    };
    const items = ippItems(sel, (prn) => (prn === "G01" ? red : null), STYLE);
    expect(items.points.map((pt) => [pt.key, pt.pixelSize, pt.color.toCssHexString()])).toEqual([["ipp/G01", 7, "#ff0000"]]);
    expect(deg(items.points[0].position).lat).toBeCloseTo(10, 9);
    expect(items.tracks.map((tr: LineItem) => [tr.key, tr.positions.length, tr.width])).toEqual([["ipp/G01/0", 2, 3], ["ipp/G01/1", 2, 3]]);
  });
});

describe("sensorItems (2D Graphics - Attributes of a sensor)", () => {
  const GPS_H = 20180;
  const R = (EARTH_RADIUS_KM + GPS_H) * 1000;
  /** ดาว GPS เหนือ (0°, 0°) เคลื่อนขึ้นเหนือ: สถานะ ณ t จากตำแหน่ง t − 1 s และ t + 1 s */
  const at = (s: SensorObj): SensorDrawState => sensorDrawState(s, { x: R, y: 0, z: 0 }, { x: R, y: -2000, z: 0 }, { x: R, y: 0, z: 2000 })!;
  const pointing = (elevation: number) => ({ pointing: { type: "Fixed", orientation: "Az-El", azimuth: 0, elevation, about_boresight: "Rotate" } });
  /** Sensor บน G01 กรวย 10° สี 2D แดง สี 3D เขียว (หน้าต่าง 2D ต้องใช้สีของหน้า 2D) */
  const sensor = (name: string, g2: object = {}, over: object = {}): SensorObj =>
    ({
      ...sensorObj(name, "G01", { color: "#ff0000", ...g2 }),
      definition: { type: "Simple Conic", cone_half_angle: 10 },
      graphics3d: { show: true, color: "#00ff00", show_radial_lines: true, show_boresight_marker: false },
      ...over,
    }) as SensorObj;
  const θ = nadirCentralAngleRad(GPS_H, 10);

  test("sensor outline is drawn in the sensor color", () => {
    const { lines, fills } = sensorItems([at(sensor("S1"))], STYLE);
    expect(fills).toEqual([]);
    expect(lines).toHaveLength(1);
    const ring = lines[0];
    expect(ring.key).toBe("sensor/S1");
    expect(ring.color.toCssHexString()).toBe("#ff0000");
    expect(ring.width).toBe(STYLE.swathEdgeWidth);
    expect(ring.positions).toHaveLength(73);
    expect(Cartesian3.equals(ring.positions[0], ring.positions.at(-1)!)).toBe(true);
    // วงอยู่ที่มุมศูนย์กลาง asin(k sin α) − α จากจุดใต้ดาว (ละติจูด geodetic ต่างจาก geocentric ไม่เกิน 0.2°)
    for (const q of ring.positions) expect(angle(q, dir(0, 0))).toBeCloseTo(θ, 2);
    // boresight ที่ไม่โดนโลก (ชี้ออกไปทางฟ้า) ไม่มีรอย (spec §3.3)
    expect(sensorItems([at(sensor("Up", {}, pointing(-90)))], STYLE)).toEqual({ lines: [], fills: [] });
  });

  test("fill only for a nadir sensor with Fill on and alpha from % Translucency", () => {
    const nadir = at(sensor("N", { fill: true, fill_translucency: 25 }));
    const { lines, fills } = sensorItems([nadir], STYLE);
    expect(lines.map((l) => l.key)).toEqual(["sensor/N"]);
    expect(fills.map((f) => f.key)).toEqual(["sensor/N"]);
    expect(fills[0].color.alpha).toBeCloseTo(0.75, 9);
    expect(fills[0].color.toCssHexString()).toBe("#ff0000c0");
    // พื้นที่แบบ Filled Limits ของ Swath (capColumns) ถึงขอบรอยพอดี
    const far = Math.max(...vertices(fills[0].geometry).map((v) => angle(v, dir(0, 0))));
    expect(far).toBeCloseTo(θ, 2);
    expect(far).toBeLessThan(θ + 0.004);

    // boresight เอียง (P2): เส้นขอบอย่างเดียว
    const tilted = at(sensor("T", { fill: true }, pointing(80)));
    expect(sensorItems([tilted], STYLE).lines).toHaveLength(1);
    expect(sensorItems([tilted], STYLE).fills).toEqual([]);
    // Fill ปิด, % Translucency 100 (มองไม่เห็น), หรือผู้เรียกไม่ต้องการพื้นที่รอบนี้: ไม่สร้างพื้นที่
    expect(sensorItems([at(sensor("F", { fill: false }))], STYLE).fills).toEqual([]);
    expect(sensorItems([at(sensor("I", { fill: true, fill_translucency: 100 }))], STYLE).fills).toEqual([]);
    expect(sensorItems([nadir], STYLE, false)).toMatchObject({ fills: [], lines: [{ key: "sensor/N" }] });
    // ค่าตั้งต้น 50%
    expect(sensorItems([at(sensor("D", { fill: true, fill_translucency: undefined }))], STYLE).fills[0].color.alpha).toBeCloseTo(0.5, 9);

    // สถานะของพื้นที่ (สร้างใหม่เมื่อเลื่อนเกิน 0.5° หรือสี/ความทึบเปลี่ยน: fillMoved) เฉพาะตัวที่มีพื้นที่
    const states = sensorFillStates([nadir, tilted]);
    expect(states.map((x) => [x.key, x.color])).toEqual([["sensor/N", "#ff0000c0"]]);
    expect(states[0].lat).toBeCloseTo(0, 9);
    expect(states[0].lon).toBeCloseTo(0, 9);
    expect(states[0].angleDeg).toBeCloseTo((θ * 180) / Math.PI, 9);
    expect(fillMoved(states, sensorFillStates([at(sensor("N", { fill: true, fill_translucency: 30 }))]))).toBe(true);
  });

  test("hidden sensor or hidden parent draws nothing", () => {
    const sat = (name: string) => ({ class: "Satellite", name, norad: 1 });
    const doc = makeDoc({
      objects: [sat("G01"), sat("G02"), sensor("Off", { show: false }), sensor("OnG02", {}, { parent: "*/Satellite/G02" })] as never,
    });
    const g01Only = (path: string): boolean => path === "*/Satellite/G01";
    expect(sensorItems(drawableSensors(doc, "2d", g01Only).map(at), STYLE)).toEqual({ lines: [], fills: [] });
    // ดาวแม่แสดงอยู่: ตัวที่ไม่ได้ปิด Show ถูกวาด
    expect(sensorItems(drawableSensors(doc, "2d", () => true).map(at), STYLE).lines.map((l) => l.key)).toEqual(["sensor/OnG02"]);
  });
});

describe("Overlays2D", () => {
  const line = (key: string, color = red): LineItem => ({ key, positions: lonLatPositions([[0, 0], [10, 10]]), color, width: 2 });

  test("lines are kept by key: a second round updates the same polyline, drops the missing and adds the new", () => {
    const root = new PrimitiveCollection();
    const o = new Overlays2D(root);
    expect(root.length).toBe(1);
    o.setLines("swathEdge", [line("a"), line("b")]);
    expect(o.counts().swathEdge).toBe(2);
    const layer = o.layer("swathEdge") as PolylineCollection;
    const first = layer.get(0);
    o.setLines("swathEdge", [line("a", Color.BLUE), line("c")]);
    expect(o.counts().swathEdge).toBe(2);
    expect(layer.contains(first)).toBe(true);
    expect((first.material.uniforms.color as Color).toCssHexString()).toBe("#0000ff");
    o.setLines("swathEdge", []);
    expect(o.counts().swathEdge).toBe(0);
  });

  test("points are kept by key too", () => {
    const o = new Overlays2D(new PrimitiveCollection());
    const pt = (key: string) => ({ key, position: lonLatPositions([[1, 2]])[0], color: red, pixelSize: 5, outlineColor: Color.BLACK });
    o.setPoints("ipp", [pt("x"), pt("y")]);
    const layer = o.layer("ipp") as PointPrimitiveCollection;
    const x = layer.get(0);
    o.setPoints("ipp", [pt("x")]);
    expect(layer.length).toBe(1);
    expect(layer.get(0)).toBe(x);
  });

  test("fills are one synchronous primitive per layer, replaced each round and removed when empty", () => {
    const o = new Overlays2D(new PrimitiveCollection());
    const fill = (key: string) => ({ key, geometry: meshGeometry(capColumns(0, 0, 0.5, 2))!, color: red });
    o.setFills("swath", [fill("a"), fill("b")]);
    const layer = o.layer("swath") as PrimitiveCollection;
    expect(layer.length).toBe(1);
    const prim = layer.get(0) as Primitive;
    expect(prim.asynchronous).toBe(false);
    expect(o.counts().swath).toBe(2);
    o.setFills("swath", [fill("a")]);
    expect(layer.length).toBe(1);
    expect(layer.get(0)).not.toBe(prim);
    expect(prim.isDestroyed()).toBe(true);
    o.setFills("swath", []);
    expect(layer.length).toBe(0);
    expect(o.counts().swath).toBe(0);
  });

  test("sensor layers sit with the swath layers and tell how many points a drawn ring has", () => {
    const o = new Overlays2D(new PrimitiveCollection());
    o.setLines("sensorEdge", [{ ...line("sensor/S1"), positions: lonLatPositions([[0, 0], [1, 1], [0, 0]]) }]);
    o.setFills("sensor", [{ key: "sensor/S1", geometry: meshGeometry(capColumns(0, 0, 0.5, 2))!, color: red }]);
    expect(o.counts()).toMatchObject({ swath: 0, sensor: 1, swathEdge: 0, sensorEdge: 1 });
    expect(o.linePoints("sensorEdge", "sensor/S1")).toBe(3);
    expect(o.linePoints("sensorEdge", "sensor/NOPE")).toBeNull();
    expect(o.linePoints("swathEdge", "sensor/S1")).toBeNull();
    o.setLines("sensorEdge", []);
    expect(o.linePoints("sensorEdge", "sensor/S1")).toBeNull();
  });

  test("destroy takes everything out of the scene", () => {
    const root = new PrimitiveCollection();
    const o = new Overlays2D(root);
    o.setLines("terminator", [line("t")]);
    o.destroy();
    expect(root.length).toBe(0);
  });
});
