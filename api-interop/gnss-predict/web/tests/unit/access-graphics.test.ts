// หน้าตาของ access ที่ใช้จริง (src/cesium/accessGraphics.ts): resolveAccessGraphics และ accessFor ต่อคู่ (Facility, ดาว)
// และกุญแจการดึงช่วงเวลา accessResultsKey (src/windows/TimelineView/rows.ts)

import { describe, expect, test } from "vitest";
import { accessFor, resolveAccessGraphics, SCENARIO_ACCESS_DEFAULTS } from "../../src/cesium/accessGraphics";
import type { ResultsInfo } from "../../src/stores/results";
import type { ScenarioDoc } from "../../src/stores/scenario";
import { accessResultsKey, type AccessDef } from "../../src/windows/TimelineView/rows";
import { makeDoc } from "./helpers/chrome";

const access = (over: object = {}, graphics: object | null | undefined = {}): AccessDef =>
  ({
    from: "*/Facility/THBK", to: ["*/Constellation/GPS"], timeline: true, computed: true, time_period: { mode: "object" },
    ...(graphics === undefined ? {} : {
      graphics: graphics === null ? null : {
        show: true, static_highlight: false, animate_highlight: false, animate_line: true, color_mode: "object", custom_color: null, inherit: false, ...graphics,
      },
    }),
    ...over,
  }) as AccessDef;

const docOf = (accesses: AccessDef[]): ScenarioDoc =>
  makeDoc({
    name: "S1",
    objects: [
      { class: "Facility", name: "THBK", position: { type: "Geodetic", lat_deg: 13.7, lon_deg: 100.5, alt_m: 0 } },
      { class: "Facility", name: "HOME", position: { type: "Geodetic", lat_deg: 13.8, lon_deg: 100.6, alt_m: 0 } },
      { class: "Constellation", name: "GPS", system: "G", assigned_objects: ["*/Satellite/G01", "*/Satellite/G02"] },
      { class: "Satellite", name: "G01", norad: 40101 },
      { class: "Satellite", name: "G02", norad: 40102 },
      { class: "Satellite", name: "G03", norad: 40103 },
    ] as never,
    accesses,
  });

describe("resolveAccessGraphics", () => {
  test("an access that is not computed (or no access at all) has no look: it is not drawn", () => {
    expect(resolveAccessGraphics(undefined)).toBeNull();
    expect(resolveAccessGraphics(access({ computed: false }))).toBeNull();
    expect(resolveAccessGraphics(access({ computed: undefined }))).toBeNull();
  });

  test("inherit true, a missing inherit, null graphics or no graphics key all give the scenario defaults", () => {
    expect(SCENARIO_ACCESS_DEFAULTS).toEqual({ show: true, line: true, staticHighlight: false, animateHighlight: false, custom: null });
    for (const a of [
      access({}, { inherit: true, show: false, static_highlight: true, color_mode: "custom", custom_color: "#123456" }),
      access({}, { inherit: undefined, show: false }),
      access({}, null),
      access({}, undefined),
    ]) {
      expect(resolveAccessGraphics(a)).toEqual(SCENARIO_ACCESS_DEFAULTS);
    }
  });

  test("own graphics (inherit false) give the explicit fields, with show and animate_line defaulting to on", () => {
    expect(resolveAccessGraphics(access({}, { show: false, animate_line: false, static_highlight: true, animate_highlight: true, color_mode: "custom", custom_color: "#12AB34" })))
      .toEqual({ show: false, line: false, staticHighlight: true, animateHighlight: true, custom: "#12ab34" });
    expect(resolveAccessGraphics(access({}, { show: undefined, animate_line: undefined, static_highlight: undefined, animate_highlight: undefined })))
      .toEqual({ show: true, line: true, staticHighlight: false, animateHighlight: false, custom: null });
  });

  test("a custom colour that is not #rrggbb, or Use Object Colors, gives no custom colour", () => {
    for (const custom_color of ["red", "#12ab3", "#12ab345", "12ab34", "", null]) {
      expect(resolveAccessGraphics(access({}, { color_mode: "custom", custom_color }))?.custom, String(custom_color)).toBeNull();
    }
    expect(resolveAccessGraphics(access({}, { color_mode: "object", custom_color: "#12ab34" }))?.custom).toBeNull();
  });
});

describe("accessFor: the computed access of a facility that covers a satellite", () => {
  test("an explicit Satellite path beats a Constellation path, wherever it is in the doc", () => {
    const viaSat = access({ to: ["*/Satellite/G01"] }, { custom_color: "#000001" });
    const viaCon = access({}, { custom_color: "#000002" });
    expect(accessFor(docOf([viaSat, viaCon]), "THBK", "G01")).toBe(viaSat);
    expect(accessFor(docOf([viaCon, viaSat]), "THBK", "G01")).toBe(viaSat);
    expect(accessFor(docOf([viaCon, viaSat]), "THBK", "G02")).toBe(viaCon); // G02 มีแต่ใน Constellation
  });

  test("of the same kind, the later one in the doc wins", () => {
    const first = access({ to: ["*/Satellite/G01"] }, { custom_color: "#000001" });
    const second = access({ to: ["*/Satellite/G01", "*/Satellite/G02"] }, { custom_color: "#000002" });
    expect(accessFor(docOf([first, second]), "THBK", "G01")).toBe(second);
    const conA = access({ to: ["*/Constellation/GPS"] });
    const conB = access({ to: ["*/Constellation/GPS", "*/Satellite/G03"] });
    expect(accessFor(docOf([conA, conB]), "THBK", "G02")).toBe(conB);
  });

  test("an access of another facility is ignored; the facility may be given by name or by path", () => {
    const home = access({ from: "*/Facility/HOME", to: ["*/Satellite/G01"] });
    const thbk = access();
    const doc = docOf([thbk, home]);
    expect(accessFor(doc, "THBK", "G01")).toBe(thbk);
    expect(accessFor(doc, "HOME", "G01")).toBe(home);
    expect(accessFor(doc, "*/Facility/HOME", "G01")).toBe(home);
    expect(accessFor(doc, "NOPE", "G01")).toBeUndefined();
  });

  test("a satellite that is not in to, and an access that is not computed, give undefined", () => {
    expect(accessFor(docOf([access()]), "THBK", "G03")).toBeUndefined();
    expect(accessFor(docOf([access({ computed: false })]), "THBK", "G01")).toBeUndefined();
    const computedCon = access();
    expect(accessFor(docOf([computedCon, access({ to: ["*/Satellite/G01"], computed: false })]), "THBK", "G01")).toBe(computedCon);
  });
});

describe("accessResultsKey", () => {
  test("pins the key for one Satellite and one Constellation access: what is asked for, then ephem status, then status/hash per source facility", () => {
    const sat = access({ from: "*/Facility/HOME", to: ["*/Satellite/G01"], time_period: { mode: "specify", start: "2026-11-11T00:00:00Z", stop: "2026-11-11T06:00:00Z" } });
    const con = access({ time_period: undefined });
    const info = {
      ephem: { status: "current", hash: "e1", available: [] },
      access: { THBK: { status: "current", hash: "t1", available: [] } },
      error: null,
    } as ResultsInfo;
    expect(accessResultsKey([sat, con], info)).toBe(JSON.stringify([
      [["*/Facility/HOME", ["*/Satellite/G01"], { mode: "specify", start: "2026-11-11T00:00:00Z", stop: "2026-11-11T06:00:00Z" }], ["*/Facility/THBK", ["*/Constellation/GPS"], null]],
      "current",
      [[null, null], ["current", "t1"]],
    ]));
    expect(accessResultsKey([sat, con], null)).toBe(JSON.stringify([
      [["*/Facility/HOME", ["*/Satellite/G01"], { mode: "specify", start: "2026-11-11T00:00:00Z", stop: "2026-11-11T06:00:00Z" }], ["*/Facility/THBK", ["*/Constellation/GPS"], null]],
      null,
      [[null, null], [null, null]],
    ]));
  });
});
