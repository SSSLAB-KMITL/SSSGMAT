// ฟังก์ชันล้วนของกราฟิกในหน้าต่าง 3D/2D (src/cesium/graphics.ts): id ของ entity (W8), สีและการแสดงผลจาก scenario.json
// และการแปลงชื่อ object เป็น id ของ entity ที่ window.__gnssStudioTest ใช้ (W19) ไม่วาด Cesium ใน jsdom

import { describe, expect, test } from "vitest";
import {
  dashFor, entityIdFor, entityIdForName, graphicsFor, markerPoint, systemTokenOf, type ColorTokens, type SceneObject,
} from "../../src/cesium/graphics";
import type { ScenarioDoc } from "../../src/stores/scenario";
import { makeDoc } from "./helpers/chrome";

const TOKENS: ColorTokens = {
  gps: "#ffd23f", glonass: "#ff6b6b", galileo: "#4fd47e", beidou: "#45c8ff", other: "#c8c8c8", facility: "#ff79e6", access: "#9dff6b",
};

const sat = (name: string, norad: number, over: Record<string, unknown> = {}): SceneObject =>
  ({ class: "Satellite", name, norad, ...over }) as SceneObject;
const fac = (name: string, over: Record<string, unknown> = {}): SceneObject =>
  ({ class: "Facility", name, position: { type: "Geodetic", lat_deg: 13.73, lon_deg: 100.78, alt_m: 6.4 }, ...over }) as SceneObject;
const con = (name: string, members: string[], color: string | null, system: string | null = null): SceneObject =>
  ({ class: "Constellation", name, assigned_objects: members, color, system }) as SceneObject;
const docWith = (objects: SceneObject[], over: Partial<ScenarioDoc> = {}): ScenarioDoc => makeDoc({ objects, ...over });

const prn = new Map([[62339, "G01"]]);

test("entityIdFor maps renamed and copied satellites by NORAD", () => { // Review Focus 5
  expect(entityIdFor(sat("G01", 62339), prn)).toBe("sat/G01");
  expect(entityIdFor(sat("GPS01", 62339), prn)).toBe("sat/G01");
  expect(entityIdFor(sat("G01_1", 62339), prn)).toBe("sat/G01");
  expect(entityIdFor(sat("X", 99999), prn)).toBeUndefined();
  expect(entityIdFor(fac("THBK"), prn)).toBe("fac/THBK");
});

test("a Constellation has no entity of its own", () => {
  expect(entityIdFor(con("GPS", [], "#ffd23f"), prn)).toBeUndefined();
});

describe("colour precedence", () => {
  const ctx = (system: string | null = "G") => ({ hidden: false, mode: "3d" as const, system, tokens: TOKENS });

  test("inherit true + a GPS constellation coloured #ffd23f → #ffd23f", () => {
    const g01 = sat("G01", 62339, { graphics2d: { inherit: true, color: "#123456" } });
    const doc = docWith([con("GPS", ["*/Satellite/G01"], "#ffd23f", "G"), g01]);
    expect(graphicsFor(g01, doc, ctx("R")).color).toBe("#ffd23f");
  });

  test("inherit false + own colour #00ff00 → #00ff00, even inside a coloured constellation", () => {
    const g01 = sat("G01", 62339, { graphics2d: { inherit: false, color: "#00ff00" } });
    const doc = docWith([con("GPS", ["*/Satellite/G01"], "#ffd23f"), g01]);
    expect(graphicsFor(g01, doc, ctx()).color).toBe("#00ff00");
  });

  test("no colours, system E → the value of --color-galileo", () => {
    const e05 = sat("E05", 40128);
    expect(graphicsFor(e05, docWith([e05]), ctx("E")).color).toBe(TOKENS.galileo);
  });

  test("every system letter and name picks its token", () => {
    const s = sat("S", 1);
    const doc = docWith([s]);
    for (const [system, token] of [["G", "gps"], ["R", "glonass"], ["E", "galileo"], ["C", "beidou"], ["GPS", "gps"], ["GLONASS", "glonass"],
      ["Galileo", "galileo"], ["BeiDou", "beidou"]] as const) {
      expect(graphicsFor(s, doc, ctx(system)).color, system).toBe(TOKENS[token]);
    }
  });

  test("inherit true with no constellation colouring it falls to the system colour (its own colour is not used)", () => {
    const g01 = sat("G01", 62339, { graphics2d: { inherit: true, color: "#00ff00" } });
    expect(graphicsFor(g01, docWith([g01]), ctx("G")).color).toBe(TOKENS.gps);
  });

  test("a missing inherit counts as true (the server's default)", () => {
    const g01 = sat("G01", 62339, { graphics2d: { color: "#00ff00" } });
    const doc = docWith([con("GPS", ["*/Satellite/G01"], "#abcdef"), g01]);
    expect(graphicsFor(g01, doc, ctx("G")).color).toBe("#abcdef");
  });

  test("inherit false without a colour of its own falls to the system colour", () => {
    const g01 = sat("G01", 62339, { graphics2d: { inherit: false, color: null } });
    const doc = docWith([con("GPS", ["*/Satellite/G01"], "#abcdef"), g01]);
    expect(graphicsFor(g01, doc, ctx("G")).color).toBe(TOKENS.gps);
  });

  test("the first constellation in doc order that has a colour wins; a member constellation without a colour is skipped", () => {
    const g01 = sat("G01", 62339);
    const doc = docWith([
      con("Other", ["*/Satellite/G02"], "#111111"),
      con("Plain", ["*/Satellite/G01"], null),
      con("First", ["*/Satellite/G01"], "#222222"),
      con("Second", ["*/Satellite/G01"], "#333333"),
      g01,
    ]);
    expect(graphicsFor(g01, doc, ctx()).color).toBe("#222222");
  });

  test("without ctx.system the system comes from the satellite's PRN (NORAD → PRN), not GPS yellow", () => {
    const e05 = sat("E05", 40128);
    const c20 = sat("MyBeidou", 43002);
    const doc = docWith([e05, c20]);
    const prnByNorad = new Map([[40128, "E05"], [43002, "C20"]]);
    const noSystem = { hidden: false, mode: "2d" as const, tokens: TOKENS, prnByNorad };
    expect(graphicsFor(e05, doc, noSystem).color).toBe(TOKENS.galileo);
    expect(graphicsFor(c20, doc, noSystem).color).toBe(TOKENS.beidou);
  });

  test("without a PRN the containing Constellation's system decides", () => {
    const r07 = sat("R07", 37868);
    const doc = docWith([con("Plain", ["*/Satellite/X"], null, "C"), con("Glonass", ["*/Satellite/R07"], null, "R"), r07]);
    expect(graphicsFor(r07, doc, { hidden: false, mode: "2d", tokens: TOKENS }).color).toBe(TOKENS.glonass);
  });

  test("a system that cannot be known uses --color-other, not GPS yellow", () => {
    const s = sat("X", 1);
    expect(graphicsFor(s, docWith([s]), ctx(null)).color).toBe(TOKENS.other);
    expect(graphicsFor(s, docWith([s]), { hidden: false, mode: "3d", tokens: TOKENS, prnByNorad: new Map() }).color).toBe(TOKENS.other);
    expect(graphicsFor(s, docWith([s]), ctx("J")).color).toBe(TOKENS.other); // QZSS ไม่ใช่สี่ระบบของ v1
  });

  test("an explicit ctx.system wins over the PRN", () => {
    const e05 = sat("E05", 40128);
    expect(graphicsFor(e05, docWith([e05]), { hidden: false, mode: "3d", tokens: TOKENS, system: "G", prnByNorad: new Map([[40128, "E05"]]) }).color).toBe(TOKENS.gps);
  });

  test("a Facility uses its own colour with inherit false, otherwise --color-facility", () => {
    const own = fac("THBK", { graphics2d: { inherit: false, color: "#0000ff" } });
    const plain = fac("THBK", { graphics2d: { inherit: true, color: "#0000ff" } });
    expect(graphicsFor(own, docWith([own]), ctx()).color).toBe("#0000ff");
    expect(graphicsFor(plain, docWith([plain]), ctx()).color).toBe(TOKENS.facility);
  });
});

test("hidden and Show Labels", () => {
  const g01 = sat("G01", 62339);
  const base = { mode: "3d" as const, system: "G", tokens: TOKENS };
  expect(graphicsFor(g01, docWith([g01]), { ...base, hidden: true }).show).toBe(false);
  expect(graphicsFor(g01, docWith([g01]), { ...base, hidden: false }).show).toBe(true);
  expect(graphicsFor(g01, docWith([g01], { graphics2d_global: { show_labels: false } }), { ...base, hidden: false }).labelShow).toBe(false);
  expect(graphicsFor(g01, docWith([g01], { graphics2d_global: { show_labels: true } }), { ...base, hidden: false }).labelShow).toBe(true);
  expect(graphicsFor(g01, docWith([g01]), { ...base, hidden: false }).labelShow).toBe(true); // ไม่มี graphics2d_global = ค่าเริ่มต้นของ server (true)
  expect(graphicsFor(g01, docWith([g01]), { ...base, hidden: true }).labelShow).toBe(false); // ดาวที่ซ่อนไม่มีป้ายชื่อค้าง
});

test("graphics3d.show hides in the 3D window only, graphics2d.show in the 2D window only", () => {
  const off3d = sat("G01", 62339, { graphics3d: { show: false }, graphics2d: { show: true } });
  const off2d = sat("G01", 62339, { graphics3d: { show: true }, graphics2d: { show: false } });
  const ctx = (mode: "3d" | "2d") => ({ hidden: false, mode, system: "G", tokens: TOKENS });
  expect(graphicsFor(off3d, docWith([off3d]), ctx("3d")).show).toBe(false);
  expect(graphicsFor(off3d, docWith([off3d]), ctx("2d")).show).toBe(true);
  expect(graphicsFor(off2d, docWith([off2d]), ctx("3d")).show).toBe(true);
  expect(graphicsFor(off2d, docWith([off2d]), ctx("2d")).show).toBe(false);
});

test("marker style, line style and line width come from the 2D attributes with defaults", () => {
  const ctx = { hidden: false, mode: "3d" as const, system: "G", tokens: TOKENS };
  const plain = sat("G01", 62339);
  const styled = sat("G01", 62339, { graphics2d: { marker_style: "Square", line_style: "Dashed", line_width: 3 } });
  expect(graphicsFor(plain, docWith([plain]), ctx)).toMatchObject({ markerStyle: "Point", lineStyle: "Solid", lineWidth: 1, pointPixelSize: markerPoint("Point").pixelSize });
  expect(graphicsFor(styled, docWith([styled]), ctx)).toMatchObject({ markerStyle: "Square", lineStyle: "Dashed", lineWidth: 3, pointPixelSize: markerPoint("Square").pixelSize });
});

test("each marker style has a pixel size and an outline, bigger shapes are bigger than Point", () => {
  for (const style of ["Point", "Plus", "Star", "Square", "Circle", "Diamond", "Triangle", "Cross"]) {
    const m = markerPoint(style);
    expect(m.pixelSize, style).toBeGreaterThan(0);
    expect(m.outlineWidth, style).toBeGreaterThanOrEqual(0);
    if (style !== "Point") expect(m.pixelSize, style).toBeGreaterThan(markerPoint("Point").pixelSize);
  }
  expect(markerPoint("Point").outlineWidth).toBe(0);
  expect(markerPoint("Nonsense")).toEqual(markerPoint("Point"));
});

test("line styles map to a dash pattern; Solid has none", () => {
  expect(dashFor("Solid")).toBeNull();
  for (const style of ["Dashed", "Dotted", "Dot Dashed", "Long Dashed", "Dash Dot Dot", "Medium Dashed", "Short Dashed"]) {
    const d = dashFor(style);
    expect(d, style).not.toBeNull();
    expect(d!.pattern, style).toBeGreaterThan(0);
    expect(d!.pattern, style).toBeLessThan(0x10000);
    expect(d!.length, style).toBeGreaterThan(0);
  }
  expect(dashFor("Dashed")).not.toEqual(dashFor("Dotted"));
});

test("system tokens: letters and names, case-insensitive, unknown is null", () => {
  expect(systemTokenOf("G")).toBe("gps");
  expect(systemTokenOf("glonass")).toBe("glonass");
  expect(systemTokenOf("BDS")).toBe("beidou");
  expect(systemTokenOf("J")).toBeNull();
  expect(systemTokenOf(null)).toBeNull();
});

// คาบวงโคจร (orbitPeriodS / estimatePeriod) ย้ายไป src/cesium/passes.ts: tests/unit/passes.test.ts

describe("the test hooks' names", () => {
  const doc = docWith([fac("THBK"), sat("GPS01", 62339), sat("G01_1", 62339), sat("X", 99999), con("GPS", ["*/Satellite/GPS01"], null)]);

  test("map scenario object names to entity ids through entityIdFor", () => {
    expect(entityIdForName("THBK", doc, prn)).toBe("fac/THBK");
    expect(entityIdForName("GPS01", doc, prn)).toBe("sat/G01");
    expect(entityIdForName("G01_1", doc, prn)).toBe("sat/G01");
  });

  test("a name that is not an object, a satellite without results and a Constellation have no entity", () => {
    expect(entityIdForName("G01", doc, prn)).toBeUndefined(); // ไม่มี object ชื่อ G01 (ถูกเปลี่ยนชื่อเป็น GPS01)
    expect(entityIdForName("X", doc, prn)).toBeUndefined();
    expect(entityIdForName("GPS", doc, prn)).toBeUndefined();
    expect(entityIdForName("THBK", null, prn)).toBeUndefined();
  });
});
