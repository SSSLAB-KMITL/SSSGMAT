// ภาพที่เปลี่ยนตามเวลาของหน้าต่าง 2D (src/cesium/overlay2d.ts) ด้วยคลาสจริงของ Cesium (ไม่วาด: ไม่มี WebGL ใน jsdom)
// วง Swath, พื้นที่ Filled Limits, เส้นแบ่งกลางวันกลางคืน, พื้นที่กลางคืน, จุดและเส้นทาง IPP และตัวจัดการ primitive ที่ตั้งค่าตามรอบ

import { Cartesian3, Cartographic, Color, Math as CMath, PointPrimitiveCollection, PolylineCollection, Primitive, PrimitiveCollection, type Geometry } from "cesium";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { capColumns } from "../../src/cesium/lonlat";
import { subsolarPoint } from "../../src/cesium/night";
import {
  ippItems, lonLatPositions, MAX_LAT, meshGeometry, nightItems, Overlays2D, swathItems, type LineItem,
} from "../../src/cesium/overlay2d";
import { EARTH_RADIUS_KM, footprintCentralAngleRad } from "../../src/cesium/swath";
import type { SceneStyle } from "../../src/cesium/graphics";

// jsdom ไม่มี ImageBitmap และ OffscreenCanvas (Material ของ Cesium ใช้ instanceof ทั้งสองตอนดูชนิดของ uniform) browser มีเสมอ
beforeAll(() => {
  vi.stubGlobal("ImageBitmap", class ImageBitmap {});
  vi.stubGlobal("OffscreenCanvas", class OffscreenCanvas {});
});
afterAll(() => vi.unstubAllGlobals());

const STYLE: SceneStyle = {
  labelFont: "12px sans-serif", labelOutline: "#000000", pointOutline: "#000000", accessWidth: 1, gridLine: "#ffffff",
  swathFillOpacity: 0.3, swathEdgeWidth: 1.5, nightFill: "#00000066", terminatorLine: "#ffeeaa", terminatorWidth: 2, ippPointSize: 7, ippTrackWidth: 3,
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
    for (const q of ring.positions) {
      const { lat, lon } = deg(q);
      expect(Math.abs(angle(dir(lat, lon), dir(20, 0)) - theta)).toBeLessThan(0.004); // ละติจูดที่วาดเป็น geodetic (ต่างจาก geocentric ไม่เกิน 0.2°)
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

describe("nightItems", () => {
  const d = new Date("2026-11-11T03:30:00Z");

  test("Show Outline draws the terminator 90° from the sun; Shading fills the night side", () => {
    const { line, fill } = nightItems(d, { outline: true, shading: true }, STYLE);
    const s = subsolarPoint(d);
    expect(line!.color.toCssHexString()).toBe("#ffeeaa");
    expect(line!.width).toBe(2);
    for (const q of line!.positions) {
      const { lat, lon } = deg(q);
      if (Math.abs(lat) > 89) continue; // จุดที่ถูกดึงจากขั้ว
      expect(Math.abs(angle(dir(lat, lon), dir(s.lat, s.lon)) - Math.PI / 2)).toBeLessThan(0.004);
    }
    expect(fill!.color.alpha).toBeCloseTo(0x66 / 255, 6);
    // จุดตรงข้ามดวงอาทิตย์อยู่ในพื้นที่ที่เติม: มีสามเหลี่ยมคลุมลองจิจูดนั้น
    const anti = ((s.lon + 360) % 360) - 180;
    const v = vertices(fill!.geometry).map(deg);
    expect(v.some((q) => Math.abs(q.lon - anti) <= 2 && q.lat < -s.lat) && v.some((q) => Math.abs(q.lon - anti) <= 2 && q.lat > -s.lat)).toBe(true);
  });

  test("each part can be off", () => {
    expect(nightItems(d, { outline: false, shading: false }, STYLE)).toEqual({ line: null, fill: null });
    expect(nightItems(d, { outline: true, shading: false }, STYLE).fill).toBeNull();
    expect(nightItems(d, { outline: false, shading: true }, STYLE).line).toBeNull();
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

  test("destroy takes everything out of the scene", () => {
    const root = new PrimitiveCollection();
    const o = new Overlays2D(root);
    o.setLines("terminator", [line("t")]);
    o.destroy();
    expect(root.length).toBe(0);
  });
});
