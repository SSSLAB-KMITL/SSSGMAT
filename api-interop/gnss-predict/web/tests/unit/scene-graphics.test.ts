// กราฟิกบน entity จริงของ Cesium (CzmlDataSource ที่ process CZML ในหน่วยความจำ ไม่ต่อเครือข่าย ไม่วาดภาพ):
// applyGraphics และสถานะของ sensor จากตำแหน่งของ entity ดาวแม่ (src/cesium/graphics.ts), ensureFacilities และ loadScene (src/cesium/czml.ts)

import {
  Cartesian3, Cartographic, Color, CzmlDataSource, JulianDate, Math as CMath, NearFarScalar, TimeIntervalCollectionProperty, type Entity, type Viewer,
} from "cesium";
import { describe, expect, test } from "vitest";
import { ensureFacilities, loadScene } from "../../src/cesium/czml";
import { applyGraphics, pathForEntityId, sceneStyleFrom, sensorStatesAt, shownAccessLines, type ColorTokens, type SceneObject, type SceneStyle } from "../../src/cesium/graphics";
import { orbitPeriodS } from "../../src/cesium/passes";
import { bodyFrame, type Vec3 } from "../../src/cesium/sensorGeometry";
import type { ScenarioDoc } from "../../src/stores/scenario";
import { makeDoc } from "./helpers/chrome";
import { sensorObj } from "./helpers/objects";

const TOKENS: ColorTokens = {
  gps: "#ffd23f", glonass: "#ff6b6b", galileo: "#4fd47e", beidou: "#45c8ff", other: "#c8c8c8", facility: "#ff79e6", access: "#9dff6b",
};
const STYLE: SceneStyle = {
  labelFont: "13px Test Sans", labelOutline: "#102030", pointOutline: "#405060", accessWidth: 2.5, gridLine: "#ffffff66",
  swathFillOpacity: 0.3, swathEdgeWidth: 1.5, terminatorLine: "#ffffffb3", terminatorWidth: 1.5, ippPointSize: 6, ippTrackWidth: 2,
};
const T0 = "2026-11-11T00:00:00Z";
const time = JulianDate.fromIso8601("2026-11-11T06:00:00Z");
const R = 26_560_000;

/** ดาววงกลมรัศมี R ตัวอย่างทุก 300 s หนึ่งวัน ตามรูปของ scene.czml */
function satPacket(prn: string, phase = 0, radius = R): object {
  const cartesian: number[] = [];
  for (let s = 0; s <= 86_400; s += 300) {
    const a = phase + (2 * Math.PI * s) / 43_078;
    cartesian.push(s, radius * Math.cos(a), radius * Math.sin(a) * 0.5, radius * Math.sin(a) * 0.866);
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
/** access ที่ Compute แล้วจาก THBK ถึง G01 และ E05 (กราฟิกตั้งต้นของ scenario) */
const computedAccess = (over: object = {}): NonNullable<ScenarioDoc["accesses"]>[number] =>
  ({ from: "*/Facility/THBK", to: ["*/Satellite/G01", "*/Satellite/E05"], computed: true, ...over }) as never;
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
    const half = orbitPeriodS(R / 1000) / 2;
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
    const doc = docOf([fac("THBK"), sat("G01", 62339), sat("E05", 40128, { graphics3d: { show: false } })], { accesses: [computedAccess()] });
    applyGraphics(ds, doc, { ...baseCtx, isHidden: (n) => n === 62339 });
    expect(byId(ds, "sat/G01").show).toBe(false);
    expect(byId(ds, "sat/E05").show).toBe(false);
    expect(byId(ds, "sat/R07").show).toBe(false); // ไม่มี object ของ R07
    expect(byId(ds, "access/THBK/G01").show).toBe(false);
    expect(byId(ds, "access/THBK/E05").show).toBe(false);
  });

  test("access lines use --color-access and keep their show intervals from CZML", async () => {
    const ds = await scene();
    applyGraphics(ds, docOf([fac("THBK"), sat("G01", 62339), sat("E05", 40128)], { accesses: [computedAccess()] }), baseCtx);
    const line = byId(ds, "access/THBK/G01");
    expect(line.show).toBe(true);
    expect(hex(value(line.polyline?.material)?.color as Color | undefined)).toBe(TOKENS.access);
    expect(line.polyline?.show).toBeInstanceOf(TimeIntervalCollectionProperty); // ช่วงเวลา show จาก CZML ยังอยู่
    expect(value(line.polyline?.show)).toBe(true);
  });

  test("an access with its own graphics (not inherited) may hide the line or colour it", async () => {
    const ds = await scene();
    const objects = [fac("THBK"), sat("G01", 62339), sat("E05", 40128)];
    applyGraphics(ds, docOf(objects, { accesses: [computedAccess({ graphics: { inherit: false, color_mode: "custom", custom_color: "#123456" } })] }), baseCtx);
    expect(byId(ds, "access/THBK/G01").show).toBe(true);
    expect(hex(value(byId(ds, "access/THBK/G01").polyline?.material)?.color as Color | undefined)).toBe("#123456");
    applyGraphics(ds, docOf(objects, { accesses: [computedAccess({ graphics: { inherit: false, show: false } })] }), baseCtx);
    expect(byId(ds, "access/THBK/G01").show).toBe(false);
    applyGraphics(ds, docOf(objects, { accesses: [computedAccess({ graphics: { inherit: false, animate_line: false } })] }), baseCtx);
    expect(byId(ds, "access/THBK/G01").show).toBe(false);
  });

  test("an access that is not computed draws no line; once computed it draws one (only for the satellites it covers)", async () => {
    const ds = await scene();
    const objects = [fac("THBK"), sat("G01", 62339), sat("E05", 40128)];
    applyGraphics(ds, docOf(objects, { accesses: [computedAccess({ to: ["*/Satellite/G01"], computed: false })] }), baseCtx);
    expect(byId(ds, "access/THBK/G01").show).toBe(false);
    expect(shownAccessLines(ds.entities)).toBe(0); // test hook accessLines
    applyGraphics(ds, docOf(objects), baseCtx); // ไม่มี access เลย
    expect(byId(ds, "access/THBK/G01").show).toBe(false);
    applyGraphics(ds, docOf(objects, { accesses: [computedAccess({ to: ["*/Satellite/G01"] })] }), baseCtx);
    expect(byId(ds, "access/THBK/G01").show).toBe(true);
    expect(byId(ds, "access/THBK/E05").show).toBe(false); // ไม่อยู่ใน to
    expect(shownAccessLines(ds.entities)).toBe(1);
  });

  test("lines are looked up per (facility, satellite): facility B's line takes B's colour when A and B both cover the satellite", async () => {
    const ds = await scene();
    await ds.process([
      { id: "document", version: "1.0" },
      { id: "fac/HOME", position: { cartographicDegrees: [100.5, 13.9, 5] } },
      {
        id: "access/HOME/G01",
        polyline: { positions: { references: ["fac/HOME#position", "sat/G01#position"] }, arcType: "NONE", show: [{ interval: `${T0}/2026-11-12T00:00:00Z`, boolean: true }] },
      },
    ]);
    const objects = [fac("THBK"), fac("HOME", 13.9, 100.5), sat("G01", 62339), sat("E05", 40128)];
    const custom = (color: string) => ({ inherit: false, color_mode: "custom", custom_color: color });
    applyGraphics(ds, docOf(objects, {
      accesses: [
        computedAccess({ to: ["*/Satellite/G01", "*/Satellite/E05"], graphics: custom("#aa0000") }),
        computedAccess({ from: "*/Facility/HOME", to: ["*/Satellite/G01"], graphics: custom("#0000bb") }),
      ],
    }), baseCtx);
    const color = (id: string) => hex(value(byId(ds, id).polyline?.material)?.color as Color | undefined);
    expect(byId(ds, "access/HOME/G01").show).toBe(true);
    expect(color("access/HOME/G01")).toBe("#0000bb");
    expect(color("access/THBK/G01")).toBe("#aa0000");
    expect(color("access/THBK/E05")).toBe("#aa0000");

    // Facility เดียวกันสอง access: เส้นของดาวแต่ละดวงใช้ access ที่ครอบคลุมดาวนั้น ไม่ใช่ access แรกของ Facility
    applyGraphics(ds, docOf(objects, {
      accesses: [
        computedAccess({ to: ["*/Satellite/E05"], graphics: custom("#aa0000") }),
        computedAccess({ to: ["*/Satellite/G01"], graphics: custom("#00cc00") }),
      ],
    }), baseCtx);
    expect(color("access/THBK/E05")).toBe("#aa0000");
    expect(color("access/THBK/G01")).toBe("#00cc00");
    expect(byId(ds, "access/HOME/G01").show).toBe(false); // HOME ไม่มี access ที่ Compute แล้ว
  });

  describe("the window's orbit-line toggle (task 13c: Show Orbits in 3D, Show Ground Tracks in 2D)", () => {
    const analysis = { start: JulianDate.fromIso8601(T0), stop: JulianDate.fromIso8601("2026-11-12T00:00:00Z") };
    const objects = () => [
      fac("THBK"), sat("G01", 62339), sat("E05", 40128, { graphics3d: { show: true, orbit_system: "Inertial by Window" } }),
      sat("R07", 37868, { graphics3d: { show: false }, graphics2d: { show: false } }),
    ];
    const pathShown = (ds: CzmlDataSource, id: string) => value(byId(ds, id).path?.show) === true;

    test.each(["3d", "2d"] as const)("off in the %s window: no satellite path at all; points, labels and access lines stay; on again = the per-object settings", async (mode) => {
      const ds = await scene();
      const doc = docOf(objects(), { accesses: [computedAccess()] });
      const before = JSON.stringify(doc);
      const ctx = { ...baseCtx, mode, analysis };
      applyGraphics(ds, doc, { ...ctx, showOrbits: false });
      for (const id of ["sat/G01", "sat/E05", "sat/R07"]) expect(pathShown(ds, id), id).toBe(false);
      const g01 = byId(ds, "sat/G01");
      expect(g01.show).toBe(true);
      expect(value(g01.point?.pixelSize)).toBeGreaterThan(0);
      expect(value(g01.label?.show)).toBe(true);
      expect(byId(ds, "access/THBK/G01").show).toBe(true);
      expect(JSON.stringify(doc)).toBe(before); // ไม่แตะค่า Pass/กราฟิกของ object

      applyGraphics(ds, doc, { ...ctx, showOrbits: true });
      expect(pathShown(ds, "sat/G01")).toBe(true);
      expect(pathShown(ds, "sat/E05")).toBe(mode === "2d"); // 3D: Inertial by Window วาดเส้นเอง (ไม่ใช่ path ของ Cesium)
      expect(byId(ds, "sat/R07").show).toBe(false); // ซ่อนตามธงของ object เหมือนเดิม
      applyGraphics(ds, doc, ctx); // ไม่ระบุ = เปิด
      expect(pathShown(ds, "sat/G01")).toBe(true);
    });
  });

  describe("2D ground track (Pass page)", () => {
    const at = (iso: string) => JulianDate.fromIso8601(iso);
    const analysis = { start: at(T0), stop: at("2026-11-12T00:00:00Z") };
    const ctx2d = { ...baseCtx, mode: "2d" as const, analysis };
    const pathAt = (e: Entity, iso: string) => ({
      lead: e.path?.leadTime?.getValue(at(iso)) as number,
      trail: e.path?.trailTime?.getValue(at(iso)) as number,
    });
    const passOf = (pass: object) => sat("G01", 62339, { graphics2d: { pass } });

    test("a satellite without a Pass page gets the server template: 1800 s each side", async () => {
      const ds = await scene(false);
      applyGraphics(ds, docOf([sat("G01", 62339)]), ctx2d);
      const path = byId(ds, "sat/G01").path;
      expect(value(path?.show)).toBe(true);
      expect(pathAt(byId(ds, "sat/G01"), "2026-11-11T06:00:00Z")).toEqual({ lead: 1800, trail: 1800 });
    });

    test("Quarter / Percent use the period estimated from the samples", async () => {
      const ds = await scene(false);
      applyGraphics(ds, docOf([passOf({ lead_type: "Quarter", trail_type: "Percent", trail_percent: 10 })]), ctx2d);
      const p = pathAt(byId(ds, "sat/G01"), "2026-11-11T06:00:00Z");
      // รัศมีของตัวอย่างใน CZML ทดสอบเป็น 0.99998·R: คาบที่ประมาณได้ห่างจาก T(R) ไม่ถึงหนึ่งวินาที
      expect(p.lead).toBeCloseTo(orbitPeriodS(R / 1000) / 4, 0);
      expect(p.trail).toBeCloseTo(orbitPeriodS(R / 1000) / 10, 0);
    });

    test("One Pass runs to the next ascending node and back to the previous one at every time, without recomputing", async () => {
      // G01 ขึ้นผ่านศูนย์สูตรที่ 43,078 s และ 86,156 s หลัง T0 (z = R·0.866·sin(2πs/43078))
      const ds = await scene(false);
      applyGraphics(ds, docOf([passOf({ lead_type: "One Pass", trail_type: "Same As Lead" })]), ctx2d);
      const g01 = byId(ds, "sat/G01");
      expect(pathAt(g01, "2026-11-11T06:00:00Z").lead).toBeCloseTo(43_078 - 21_600, 0);
      expect(pathAt(g01, "2026-11-11T11:57:50Z").lead).toBeCloseTo(8, 0);
      expect(pathAt(g01, "2026-11-11T12:00:00Z").lead).toBeCloseTo(86_156 - 43_200, 0);
      applyGraphics(ds, docOf([passOf({ lead_type: "None", trail_type: "One Pass" })]), ctx2d);
      expect(pathAt(g01, "2026-11-11T12:00:00Z")).toEqual({ lead: 0, trail: expect.closeTo(122, 0) });
      // ก่อนจุดขึ้นแรกในข้อมูล: ต่อถอยหลังหนึ่งคาบ (คาบที่ประมาณสั้นกว่า 43,078 s ราวหนึ่งวินาที จุดที่ต่อจึงอยู่หลัง T0 เล็กน้อย)
      expect(pathAt(g01, "2026-11-11T06:00:00Z").trail).toBeCloseTo(21_600, -1);
    });

    test("All and Current Interval reach the ends of the analysis period", async () => {
      const ds = await scene(false);
      applyGraphics(ds, docOf([passOf({ lead_type: "All", trail_type: "Current Interval" })]), ctx2d);
      expect(pathAt(byId(ds, "sat/G01"), "2026-11-11T06:00:00Z")).toEqual({ lead: expect.closeTo(64_800, 6), trail: expect.closeTo(21_600, 6) });
      expect(pathAt(byId(ds, "sat/G01"), "2026-11-11T18:00:00Z")).toEqual({ lead: expect.closeTo(21_600, 6), trail: expect.closeTo(64_800, 6) });
    });

    test("the track has the satellite's 2D colour, line width and line style", async () => {
      const ds = await scene(false);
      applyGraphics(ds, docOf([sat("G01", 62339, { graphics2d: { inherit: false, color: "#00ff00", line_width: 3, line_style: "Dashed" } })]), ctx2d);
      const path = byId(ds, "sat/G01").path!;
      expect(value(path.width)).toBe(3);
      expect(hex(value(path.material)?.color as Color | undefined)).toBe("#00ff00");
      expect(value(path.material)?.dashPattern).toBe(0xff00);
    });

    test("corrupt samples inside the Earth are not an orbit: no ground track in 2D and no path in 3D", async () => {
      const ds = await CzmlDataSource.load([DOCUMENT, satPacket("G01", 0, 1_000_000)]);
      applyGraphics(ds, docOf([sat("G01", 62339)]), ctx2d);
      expect(value(byId(ds, "sat/G01").path?.show)).toBe(false);
      applyGraphics(ds, docOf([sat("G01", 62339)]), baseCtx);
      expect(value(byId(ds, "sat/G01").path?.show)).toBe(false);
    });

    test("applyGraphics returns the look of every entity it styled (the 2D overlays reuse it)", async () => {
      const ds = await scene(false);
      const looks = applyGraphics(ds, docOf([sat("GPS01", 62339), sat("E05", 40128, { graphics2d: { show: false } })]), ctx2d);
      expect(looks.get("sat/G01")?.obj.name).toBe("GPS01");
      expect(looks.get("sat/G01")?.g.color).toBe(TOKENS.gps);
      expect(looks.get("sat/E05")?.g.show).toBe(false);
      expect(applyGraphics(ds, null, ctx2d).size).toBe(0);
    });

    test("without the analysis period there is no track", async () => {
      const ds = await scene(false);
      applyGraphics(ds, docOf([sat("G01", 62339)]), { ...baseCtx, mode: "2d" });
      expect(value(byId(ds, "sat/G01").path?.show)).toBe(false);
    });
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
      "--scene-swath-fill-opacity": "0.2", "--scene-swath-edge-width": "2px",
      "--scene-terminator-line": "#ffeeaa", "--scene-terminator-width": "1px", "--scene-ipp-point-size": "5px", "--scene-ipp-track-width": "3px",
    };
    expect(sceneStyleFrom((name) => vars[name] ?? "")).toEqual({
      labelFont: "12px system-ui, sans-serif", labelOutline: "#000000", pointOutline: "#111111", accessWidth: 1.5, gridLine: "#ffffff66",
      swathFillOpacity: 0.2, swathEdgeWidth: 2, terminatorLine: "#ffeeaa", terminatorWidth: 1, ippPointSize: 5, ippTrackWidth: 3,
    });
  });

  test("missing or broken scene variables fall back to drawable values", () => {
    const style = sceneStyleFrom((name) => (name === "--scene-swath-fill-opacity" ? "lots" : name === "--scene-ipp-point-size" ? "-2px" : ""));
    expect(style.swathFillOpacity).toBeGreaterThan(0);
    expect(style.swathFillOpacity).toBeLessThan(1);
    expect(style.ippPointSize).toBeGreaterThan(0);
  });

  test("the real theme.css defines every scene style variable", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const css = readFileSync(resolve(import.meta.dirname, "../../src/theme.css"), "utf8");
    const vars = Object.fromEntries([...css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
    const style = sceneStyleFrom((name) => vars[name] ?? "");
    expect(style.accessWidth).toBeGreaterThan(0);
    expect(style.labelFont).toMatch(/^\d+px /);
    for (const c of [style.labelOutline, style.pointOutline, style.gridLine, style.terminatorLine]) expect(c).toMatch(/^#[0-9a-f]{6}([0-9a-f]{2})?$/i);
    for (const name of ["--scene-swath-fill-opacity", "--scene-swath-edge-width", "--scene-terminator-width", "--scene-ipp-point-size", "--scene-ipp-track-width"])
      expect(vars[name], name).toBeDefined();
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

describe("pathForEntityId (the object an entity stands for)", () => {
  test("a facility entity is the facility of that name; a satellite entity is the satellite with its NORAD", () => {
    const doc = docOf([fac("THBK"), sat("G01", 62339), sat("E05", 40128)]);
    expect(pathForEntityId("fac/THBK", doc, prnByNorad)).toBe("*/Facility/THBK");
    expect(pathForEntityId("sat/G01", doc, prnByNorad)).toBe("*/Satellite/G01");
    expect(pathForEntityId("sat/E05", doc, prnByNorad)).toBe("*/Satellite/E05");
  });

  test("pathForEntityId maps a renamed satellite by NORAD", () => {
    // ชื่อใน scenario ไม่ตรง PRN ของ entity: จับคู่ด้วย NORAD ผ่าน manifest (Review Focus 5)
    const doc = docOf([sat("MySat", 62339), sat("Other", 40128)]);
    expect(pathForEntityId("sat/G01", doc, prnByNorad)).toBe("*/Satellite/MySat");
    expect(pathForEntityId("sat/E05", doc, prnByNorad)).toBe("*/Satellite/Other");
  });

  test("copies of one satellite share the entity: the first one shown in 3D, else the first", () => {
    const shown = docOf([sat("G01", 62339, { graphics3d: { show: false } }), sat("G01_1", 62339), sat("G01_2", 62339)]);
    expect(pathForEntityId("sat/G01", shown, prnByNorad)).toBe("*/Satellite/G01_1");
    const none = docOf([sat("G01", 62339, { graphics3d: { show: false } }), sat("G01_1", 62339, { graphics3d: { show: false } })]);
    expect(pathForEntityId("sat/G01", none, prnByNorad)).toBe("*/Satellite/G01");
  });

  test("sensors, access lines, satellites outside the manifest and objects the scenario does not have cannot be picked", () => {
    const doc = docOf([fac("THBK"), sat("G01", 62339), sat("X99", 99999), sensorObj("S1", "G01") as unknown as SceneObject]);
    expect(pathForEntityId("sensor/S1/ring", doc, prnByNorad)).toBeNull();
    expect(pathForEntityId("sensor/S1/radial/0", doc, prnByNorad)).toBeNull();
    expect(pathForEntityId("sensor/S1/marker", doc, prnByNorad)).toBeNull();
    expect(pathForEntityId("access/THBK/G01", doc, prnByNorad)).toBeNull();
    expect(pathForEntityId("sat/R07", doc, prnByNorad)).toBeNull(); // ไม่มีดาวนี้ใน scenario
    expect(pathForEntityId("fac/NOPE", doc, prnByNorad)).toBeNull();
    expect(pathForEntityId("document", doc, prnByNorad)).toBeNull();
    expect(pathForEntityId("sat/G01", null, prnByNorad)).toBeNull(); // ไม่มี doc
  });
});

describe("sensor states from the parent satellite's entity (sensorStatesAt)", () => {
  const fixed = (e: Entity, t: JulianDate): Vec3 => {
    const p = e.position!.getValue(t)!; // ตัวอย่างใน CZML เป็น FIXED
    return { x: p.x, y: p.y, z: p.z };
  };
  const sub = (a: Vec3, b: Vec3, s: number): Vec3 => ({ x: (a.x - b.x) / s, y: (a.y - b.y) / s, z: (a.z - b.z) / s });
  const plus = (t: JulianDate, s: number): JulianDate => JulianDate.addSeconds(t, s, new JulianDate());
  const sensor = (name: string, parent: string, over: object = {}) => ({ ...sensorObj(name, parent), ...over }) as unknown as SceneObject;
  const doc = docOf([
    sat("G01", 62339),
    sat("E05", 40128, { graphics3d: { show: false } }),
    sat("X99", 99999), // ไม่มีใน manifest: ไม่มี entity
    sensor("S1", "G01"),
    sensor("S2", "E05"),
    sensor("S3", "G01", { graphics3d: { show: false, color: "#e8c547", show_radial_lines: true, show_boresight_marker: false } }),
    sensor("S4", "X99"),
  ]);

  test("shown sensors of shown satellites, with the frame from the position one second either side", async () => {
    const ds = await scene(false);
    applyGraphics(ds, doc, baseCtx);
    const states = sensorStatesAt(doc, ds.entities, baseCtx, time);
    expect(states.map((s) => s.sensor.name)).toEqual(["S1"]);
    const g01 = byId(ds, "sat/G01");
    const p = fixed(g01, time);
    expect(states[0].pos.x).toBeCloseTo(p.x, 3);
    expect(states[0].pos.z).toBeCloseTo(p.z, 3);
    const want = bodyFrame(p, sub(fixed(g01, plus(time, 1)), fixed(g01, plus(time, -1)), 2))!;
    expect(states[0].frame.x.x).toBeCloseTo(want.x.x, 9);
    expect(states[0].frame.x.y).toBeCloseTo(want.x.y, 9);
    expect(states[0].frame.x.z).toBeCloseTo(want.x.z, 9);

    // หน้าต่าง 2D ใช้ธงของหน้า 2D: E05 และ S3 แสดงอยู่
    const ds2 = await scene(false);
    applyGraphics(ds2, doc, { ...baseCtx, mode: "2d" });
    expect(sensorStatesAt(doc, ds2.entities, { ...baseCtx, mode: "2d" }, time).map((s) => s.sensor.name)).toEqual(["S1", "S2", "S3"]);
  });

  test("a hidden parent, no doc, or no position at that time draws nothing; the start of the data uses the one-sided difference", async () => {
    const ds = await scene(false);
    const hidden = { ...baseCtx, isHidden: (n: number) => n === 62339 };
    applyGraphics(ds, doc, hidden);
    expect(sensorStatesAt(doc, ds.entities, hidden, time)).toEqual([]);
    applyGraphics(ds, doc, baseCtx);
    expect(sensorStatesAt(null, ds.entities, baseCtx, time)).toEqual([]);
    expect(sensorStatesAt(doc, ds.entities, baseCtx, JulianDate.fromIso8601("2026-11-12T00:00:01Z"))).toEqual([]); // หลังช่วงของข้อมูล
    const start = JulianDate.fromIso8601(T0);
    const g01 = byId(ds, "sat/G01");
    const [first] = sensorStatesAt(doc, ds.entities, baseCtx, start);
    const want = bodyFrame(fixed(g01, start), sub(fixed(g01, plus(start, 1)), fixed(g01, start), 1))!;
    expect(first.frame.x.x).toBeCloseTo(want.x.x, 9);
    expect(first.frame.x.y).toBeCloseTo(want.x.y, 9);
    expect(first.frame.x.z).toBeCloseTo(want.x.z, 9);
  });
});
