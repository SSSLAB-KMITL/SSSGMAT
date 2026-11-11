// กราฟิกบน entity จริงของ Cesium (CzmlDataSource ที่ process CZML ในหน่วยความจำ ไม่ต่อเครือข่าย ไม่วาดภาพ):
// applyGraphics (src/cesium/graphics.ts), ensureFacilities และ loadScene (src/cesium/czml.ts)

import {
  Cartesian3, Cartographic, Color, CzmlDataSource, JulianDate, Math as CMath, NearFarScalar, TimeIntervalCollectionProperty, type Entity, type Viewer,
} from "cesium";
import { describe, expect, test } from "vitest";
import { ensureFacilities, loadScene } from "../../src/cesium/czml";
import { applyGraphics, periodFromRadius, sceneStyleFrom, type ColorTokens, type SceneObject, type SceneStyle } from "../../src/cesium/graphics";
import type { ScenarioDoc } from "../../src/stores/scenario";
import { makeDoc } from "./helpers/chrome";

const TOKENS: ColorTokens = {
  gps: "#ffd23f", glonass: "#ff6b6b", galileo: "#4fd47e", beidou: "#45c8ff", other: "#c8c8c8", facility: "#ff79e6", access: "#9dff6b",
};
const STYLE: SceneStyle = { labelFont: "13px Test Sans", labelOutline: "#102030", pointOutline: "#405060", accessWidth: 2.5, gridLine: "#ffffff66" };
const T0 = "2026-11-11T00:00:00Z";
const time = JulianDate.fromIso8601("2026-11-11T06:00:00Z");
const R = 26_560_000;

/** ดาววงกลมรัศมี R ตัวอย่างทุก 300 s หนึ่งวัน ตามรูปของ scene.czml */
function satPacket(prn: string, phase = 0): object {
  const cartesian: number[] = [];
  for (let s = 0; s <= 86_400; s += 300) {
    const a = phase + (2 * Math.PI * s) / 43_078;
    cartesian.push(s, R * Math.cos(a), R * Math.sin(a) * 0.5, R * Math.sin(a) * 0.866);
  }
  return {
    id: `sat/${prn}`,
    availability: `${T0}/2026-11-12T00:00:00Z`,
    position: { epoch: T0, cartesian, referenceFrame: "FIXED", interpolationAlgorithm: "LAGRANGE", interpolationDegree: 7 },
  };
}
const DOCUMENT = { id: "document", version: "1.0", clock: { interval: `${T0}/2026-11-12T00:00:00Z`, currentTime: T0 } };
const SCENE = [DOCUMENT, satPacket("G01"), satPacket("E05", 1), satPacket("R07", 2)];
const ACCESS = [
  { id: "document", version: "1.0" },
  { id: "fac/THBK", position: { cartographicDegrees: [100.781151, 13.729779, 6.4] } },
  ...["G01", "E05"].map((prn) => ({
    id: `access/THBK/${prn}`,
    polyline: { positions: { references: ["fac/THBK#position", `sat/${prn}#position`] }, arcType: "NONE", show: [{ interval: `${T0}/2026-11-12T00:00:00Z`, boolean: true }] },
  })),
];

const prnByNorad = new Map([[62339, "G01"], [40128, "E05"], [37868, "R07"]]);
const fac = (name: string, lat = 13.729779, lon = 100.781151, over: object = {}): SceneObject =>
  ({ class: "Facility", name, position: { type: "Geodetic", lat_deg: lat, lon_deg: lon, alt_m: 6.4 }, ...over }) as SceneObject;
const sat = (name: string, norad: number, over: object = {}): SceneObject => ({ class: "Satellite", name, norad, ...over }) as SceneObject;
const docOf = (objects: SceneObject[], over: Partial<ScenarioDoc> = {}): ScenarioDoc => makeDoc({ objects, ...over });
const baseCtx = { mode: "3d" as const, prnByNorad, isHidden: () => false, tokens: TOKENS, style: STYLE };

async function scene(withAccess = true): Promise<CzmlDataSource> {
  const ds = await CzmlDataSource.load(SCENE);
  if (withAccess) await ds.process(ACCESS);
  return ds;
}
const byId = (ds: CzmlDataSource, id: string): Entity => {
  const e = ds.entities.getById(id);
  if (e === undefined) throw new Error(`no entity ${id}`);
  return e;
};
const value = <T>(p: { getValue(t: JulianDate): T } | undefined): T | undefined => p?.getValue(time);
const hex = (c: Color | undefined): string | undefined => c?.toCssHexString();

describe("applyGraphics", () => {
  test("satellites get a point and a label named after the scenario object (renamed satellites keep their entity)", async () => {
    const ds = await scene();
    applyGraphics(ds, docOf([fac("THBK"), sat("GPS01", 62339), sat("E05", 40128), sat("R07", 37868)]), baseCtx);
    const g01 = byId(ds, "sat/G01");
    expect(g01.show).toBe(true);
    expect(value(g01.label?.text)).toBe("GPS01");
    expect(value(g01.label?.show)).toBe(true);
    expect(hex(value(g01.point?.color))).toBe(TOKENS.gps);
    expect(hex(value(byId(ds, "sat/E05").point?.color))).toBe(TOKENS.galileo);
    expect(hex(value(byId(ds, "sat/R07").point?.color))).toBe(TOKENS.glonass);
    expect(hex(value(byId(ds, "fac/THBK").point?.color))).toBe(TOKENS.facility);
    expect(value(byId(ds, "fac/THBK").label?.text)).toBe("THBK");
  });

  test("a path shows one full orbit: lead and trail are half the period estimated from the samples", async () => {
    const ds = await scene(false);
    applyGraphics(ds, docOf([sat("G01", 62339)]), baseCtx);
    const path = byId(ds, "sat/G01").path;
    const half = periodFromRadius(R) / 2;
    expect(value(path?.show)).toBe(true);
    expect(value(path?.leadTime)).toBeCloseTo(half, 0);
    expect(value(path?.trailTime)).toBeCloseTo(half, 0);
    expect(Math.abs((value(path?.leadTime) as number) - 43_078 / 2)).toBeLessThan(1);
  });

  test("Inertial by Window turns the Cesium path off (the window draws its own polyline)", async () => {
    const ds = await scene(false);
    applyGraphics(ds, docOf([sat("G01", 62339, { graphics3d: { show: true, orbit_system: "Inertial by Window" } })]), baseCtx);
    expect(value(byId(ds, "sat/G01").path?.show)).toBe(false);
    expect(byId(ds, "sat/G01").show).toBe(true);
  });

  test("a hidden satellite, one with graphics3d.show off and one that is not in the scenario are not shown, nor their access lines", async () => {
    const ds = await scene();
    const doc = docOf([fac("THBK"), sat("G01", 62339), sat("E05", 40128, { graphics3d: { show: false } })]);
    applyGraphics(ds, doc, { ...baseCtx, isHidden: (n) => n === 62339 });
    expect(byId(ds, "sat/G01").show).toBe(false);
    expect(byId(ds, "sat/E05").show).toBe(false);
    expect(byId(ds, "sat/R07").show).toBe(false); // ไม่มี object ของ R07
    expect(byId(ds, "access/THBK/G01").show).toBe(false);
    expect(byId(ds, "access/THBK/E05").show).toBe(false);
  });

  test("access lines use --color-access and keep their show intervals from CZML", async () => {
    const ds = await scene();
    applyGraphics(ds, docOf([fac("THBK"), sat("G01", 62339), sat("E05", 40128)]), baseCtx);
    const line = byId(ds, "access/THBK/G01");
    expect(line.show).toBe(true);
    expect(hex(value(line.polyline?.material)?.color as Color | undefined)).toBe(TOKENS.access);
    expect(line.polyline?.show).toBeInstanceOf(TimeIntervalCollectionProperty); // ช่วงเวลา show จาก CZML ยังอยู่
    expect(value(line.polyline?.show)).toBe(true);
  });

  test("an access with its own graphics (not inherited) may hide the line or colour it", async () => {
    const ds = await scene();
    const objects = [fac("THBK"), sat("G01", 62339), sat("E05", 40128)];
    applyGraphics(ds, docOf(objects, { accesses: [{ from: "*/Facility/THBK", to: ["*/Satellite/G01"], graphics: { inherit: false, color_mode: "custom", custom_color: "#123456" } }] }), baseCtx);
    expect(hex(value(byId(ds, "access/THBK/G01").polyline?.material)?.color as Color | undefined)).toBe("#123456");
    applyGraphics(ds, docOf(objects, { accesses: [{ from: "*/Facility/THBK", to: ["*/Satellite/G01"], graphics: { inherit: false, show: false } }] }), baseCtx);
    expect(byId(ds, "access/THBK/G01").show).toBe(false);
  });

  test("Show Labels off hides every label; a graphics edit applies again without reloading", async () => {
    const ds = await scene();
    const objects = [fac("THBK"), sat("G01", 62339)];
    applyGraphics(ds, docOf(objects, { graphics2d_global: { show_labels: false } }), baseCtx);
    expect(value(byId(ds, "sat/G01").label?.show)).toBe(false);
    expect(value(byId(ds, "fac/THBK").label?.show)).toBe(false);
    const recoloured = [fac("THBK"), sat("G01", 62339, { graphics2d: { inherit: false, color: "#00FF00" } })];
    applyGraphics(ds, docOf(recoloured), baseCtx);
    expect(value(byId(ds, "sat/G01").label?.show)).toBe(true);
    expect(hex(value(byId(ds, "sat/G01").point?.color))).toBe("#00ff00");
  });

  test("copies of one satellite share the entity: it shows if any copy is shown, with the first shown copy's look", async () => {
    const ds = await scene(false);
    const doc = docOf([sat("G01", 62339, { graphics3d: { show: false } }), sat("G01_1", 62339, { graphics2d: { inherit: false, color: "#0000ff" } })]);
    applyGraphics(ds, doc, baseCtx);
    const e = byId(ds, "sat/G01");
    expect(e.show).toBe(true);
    expect(value(e.label?.text)).toBe("G01_1");
    expect(hex(value(e.point?.color))).toBe("#0000ff");
  });

  test("Label Declutter shrinks and fades far labels; off by default", async () => {
    const ds = await scene(false);
    applyGraphics(ds, docOf([sat("G01", 62339)]), baseCtx);
    expect(byId(ds, "sat/G01").label?.scaleByDistance).toBeUndefined();
    applyGraphics(ds, docOf([sat("G01", 62339)]), { ...baseCtx, declutter: true });
    expect(value(byId(ds, "sat/G01").label?.scaleByDistance)).toBeInstanceOf(NearFarScalar);
    expect(value(byId(ds, "sat/G01").label?.translucencyByDistance)).toBeInstanceOf(NearFarScalar);
  });

  test("label font, outlines and access line width come from the theme's scene style", async () => {
    const ds = await scene();
    applyGraphics(ds, docOf([fac("THBK"), sat("G01", 62339)]), baseCtx);
    const g01 = byId(ds, "sat/G01");
    expect(value(g01.label?.font)).toBe("13px Test Sans");
    expect(hex(value(g01.label?.outlineColor))).toBe("#102030");
    expect(hex(value(byId(ds, "fac/THBK").point?.outlineColor))).toBe("#405060");
    expect(value(byId(ds, "access/THBK/G01").polyline?.width)).toBe(2.5);
  });

  test("no doc hides everything", async () => {
    const ds = await scene();
    applyGraphics(ds, null, baseCtx);
    expect(ds.entities.values.every((e) => !e.show)).toBe(true);
  });
});

describe("ensureFacilities", () => {
  const where = (e: Entity): [number, number, number] => {
    const c = Cartographic.fromCartesian(e.position!.getValue(time) as Cartesian3);
    return [CMath.toDegrees(c.latitude), CMath.toDegrees(c.longitude), c.height];
  };

  test("a scenario without results still gets its facilities, at the doc position", () => {
    const ds = new CzmlDataSource("empty");
    ensureFacilities(ds.entities, docOf([fac("THBK"), sat("G01", 62339)]));
    const thbk = byId(ds, "fac/THBK");
    const [lat, lon, h] = where(thbk);
    expect(lat).toBeCloseTo(13.729779, 6);
    expect(lon).toBeCloseTo(100.781151, 6);
    expect(h).toBeCloseTo(6.4, 3);
    expect(ds.entities.values.map((e) => e.id)).toEqual(["fac/THBK"]);
  });

  test("CZML facilities are left alone; client-made ones follow the doc and go when the facility goes", async () => {
    const ds = await scene();
    const doc = docOf([fac("THBK", 0, 0), fac("NEW", 10, 20)]);
    ensureFacilities(ds.entities, doc);
    expect(where(byId(ds, "fac/THBK"))[0]).toBeCloseTo(13.729779, 6); // ตำแหน่งจาก access.czml ไม่ถูกทับ
    expect(where(byId(ds, "fac/NEW"))[0]).toBeCloseTo(10, 6);
    ensureFacilities(ds.entities, docOf([fac("THBK"), fac("NEW", 11, 21)]));
    expect(where(byId(ds, "fac/NEW"))[0]).toBeCloseTo(11, 6);
    ensureFacilities(ds.entities, docOf([fac("THBK")]));
    expect(ds.entities.getById("fac/NEW")).toBeUndefined();
    expect(ds.entities.getById("fac/THBK")).toBeDefined(); // ของ CZML ไม่ถูกลบแม้ไม่อยู่ใน doc
    ensureFacilities(ds.entities, null);
    expect(ds.entities.getById("fac/THBK")).toBeDefined();
  });
});

describe("loadScene", () => {
  const fakeViewer = () => {
    const added: CzmlDataSource[] = [];
    let destroyed = false;
    const viewer = {
      dataSources: { add: async (ds: CzmlDataSource) => { added.push(ds); return ds; } },
      isDestroyed: () => destroyed,
    } as unknown as Viewer;
    return { viewer, added, destroy: () => { destroyed = true; } };
  };

  test("loads scene.czml then processes every access.czml into the same data source, so references resolve", async () => {
    const { viewer, added } = fakeViewer();
    const ds = await loadScene(viewer, SCENE, [ACCESS]);
    expect(added).toEqual([ds]);
    const line = byId(ds, "access/THBK/G01");
    const ends = line.polyline!.positions!.getValue(time) as Cartesian3[];
    expect(ends).toHaveLength(2);
    expect(Cartesian3.magnitude(ends[1])).toBeCloseTo(R, -1);
  });

  test("a viewer destroyed while loading gets nothing added and the load rejects", async () => {
    const { viewer, added, destroy } = fakeViewer();
    const loading = loadScene(viewer, SCENE, [ACCESS]);
    destroy();
    await expect(loading).rejects.toThrow();
    expect(added).toEqual([]);
  });

  test("an aborted load gets nothing added", async () => {
    const { viewer, added } = fakeViewer();
    const ctl = new AbortController();
    const loading = loadScene(viewer, SCENE, [], { signal: ctl.signal });
    ctl.abort();
    await expect(loading).rejects.toThrow();
    expect(added).toEqual([]);
  });
});

describe("scene style from theme.css variables", () => {
  test("reads the label font (size + UI font), outlines, access width and grid colour", () => {
    const vars: Record<string, string> = {
      "--scene-label-font-size": " 12px", "--font-ui": " system-ui, sans-serif", "--scene-label-outline": "#000000",
      "--scene-point-outline": "#111111", "--scene-access-width": "1.5px", "--scene-grid-line": "#ffffff66",
    };
    expect(sceneStyleFrom((name) => vars[name] ?? "")).toEqual({
      labelFont: "12px system-ui, sans-serif", labelOutline: "#000000", pointOutline: "#111111", accessWidth: 1.5, gridLine: "#ffffff66",
    });
  });

  test("the real theme.css defines every scene style variable", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const css = readFileSync(resolve(import.meta.dirname, "../../src/theme.css"), "utf8");
    const vars = Object.fromEntries([...css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
    const style = sceneStyleFrom((name) => vars[name] ?? "");
    expect(style.accessWidth).toBeGreaterThan(0);
    expect(style.labelFont).toMatch(/^\d+px /);
    for (const c of [style.labelOutline, style.pointOutline, style.gridLine]) expect(c).toMatch(/^#[0-9a-f]{6}([0-9a-f]{2})?$/i);
    expect(vars["--color-other"]).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe("View From/To ends (scene3d.fromToResult)", () => {
  test("a hidden or missing end is not found; copies of one satellite share an entity and count as the same", async () => {
    const { fromToResult } = await import("../../src/windows/Graphics3D/scene3d");
    const ds = await scene();
    applyGraphics(ds, docOf([fac("THBK"), sat("G01", 62339), sat("G01_1", 62339), sat("E05", 40128)]), { ...baseCtx, isHidden: (n) => n === 40128 });
    const thbk = byId(ds, "fac/THBK");
    const g01 = byId(ds, "sat/G01");
    expect(fromToResult(thbk, g01)).toBe("ok");
    expect(fromToResult(g01, g01)).toBe("same"); // G01 กับ G01_1 → entity sat/G01 ตัวเดียวกัน
    expect(fromToResult(thbk, byId(ds, "sat/E05"))).toBe("notFound"); // ถูกซ่อนตามธง
    expect(fromToResult(undefined, g01)).toBe("notFound");
    expect(fromToResult(thbk, undefined)).toBe("notFound");
  });
});
