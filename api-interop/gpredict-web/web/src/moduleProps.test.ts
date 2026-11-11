import { describe, expect, it } from "vitest";
import { DEFAULTS, META } from "./moduleDefaults.fixture";
import {
  applyProps,
  layoutCodeError,
  PROPS_TABS,
  presetIndexOf,
  propsChange,
  propsOf,
  propsEqual,
  resetTab,
  RESET_TIP,
  sanitizeLayoutCode,
  withFlag,
  withVisible,
} from "./moduleProps";
import type { ModuleConfig } from "./types";

const config = (over: Partial<ModuleConfig> = {}): ModuleConfig => ({
  ...structuredClone(DEFAULTS),
  name: "Amateur",
  satellites: [25544, 7530, 40967],
  ...over,
});

describe("PROPS_TABS (ref §3: the notebook of the Module properties dialog)", () => {
  it("has the six tabs in Gpredict's order, with Gpredict's labels", () => {
    expect(PROPS_TABS.map((t) => t.label)).toEqual(["Layout", "Refresh Rates", "List View", "Map View", "Polar View", "Single Sat View"]);
  });
});

describe("RESET_TIP", () => {
  it("is Gpredict's tooltip of Reset in module mode, and the Map View page has its own wording", () => {
    expect(RESET_TIP.layout).toBe("Reset module settings to the global values.");
    expect(RESET_TIP.refresh).toBe("Reset module settings to the global values.");
    expect(RESET_TIP.list).toBe("Reset module settings to the global values.");
    expect(RESET_TIP.polar).toBe("Reset module settings to the global values.");
    expect(RESET_TIP.single).toBe("Reset module settings to the global values.");
    expect(RESET_TIP.map).toBe("Reset module to global settings");
  });
});

describe("propsOf", () => {
  it("takes the properties the dialog edits from a configuration (the refresh of the event list has no control)", () => {
    const p = propsOf(config());
    expect(p.layout_code).toBe(DEFAULTS.layout_code);
    expect(p.refresh).toEqual({ data_ms: 300, list: 1, map: 10, polar: 3, single: 1 });
    expect(p.list_columns).toEqual(DEFAULTS.list_columns);
    expect(p.map).toEqual(DEFAULTS.map);
    expect(p.polar).toEqual(DEFAULTS.polar);
    expect(p.single_fields).toEqual(DEFAULTS.single.fields);
  });

  it("copies: changing the draft never changes the configuration", () => {
    const c = config();
    const p = propsOf(c);
    p.map.contents["Grid Lines"] = false;
    p.list_columns.push("Catnum");
    expect(c.map.contents["Grid Lines"]).toBe(true);
    expect(c.list_columns).not.toContain("Catnum");
  });
});

describe("resetTab (every tab's Reset button restores Gpredict's values of that tab only)", () => {
  const changed = () => {
    const p = propsOf(config());
    p.layout_code = "0;0;2;0;1";
    p.refresh = { data_ms: 1000, list: 5, map: 20, polar: 7, single: 9 };
    p.list_columns = ["Satellite"];
    p.map = { contents: { ...p.map.contents, "Grid Lines": false, "Cursor Position": true }, track_orbits: 7, center_lon: -90 };
    p.polar = { orientation: "S/W/N/E", contents: { ...p.polar.contents, "Extra Az Ticks": true }, auto_skytrack: true };
    p.single_fields = ["Azimuth"];
    return p;
  };
  const defaults = propsOf(config());

  it("Layout: the layout code", () => {
    const p = resetTab(changed(), "layout", DEFAULTS);
    expect(p.layout_code).toBe(defaults.layout_code);
    expect(p.refresh).toEqual(changed().refresh);
  });

  it("Refresh Rates: the five rates", () => {
    const p = resetTab(changed(), "refresh", DEFAULTS);
    expect(p.refresh).toEqual({ data_ms: 300, list: 1, map: 10, polar: 3, single: 1 });
    expect(p.layout_code).toBe("0;0;2;0;1");
  });

  it("List View: the visible fields", () => {
    expect(resetTab(changed(), "list", DEFAULTS).list_columns).toEqual(DEFAULTS.list_columns);
  });

  it("Map View: contents, number of orbits, centre longitude", () => {
    const p = resetTab(changed(), "map", DEFAULTS);
    expect(p.map).toEqual(DEFAULTS.map);
    expect(p.polar).toEqual(changed().polar);
  });

  it("Polar View: orientation, contents, sky tracks", () => {
    const p = resetTab(changed(), "polar", DEFAULTS);
    expect(p.polar).toEqual(DEFAULTS.polar);
    expect(p.map).toEqual(changed().map);
  });

  it("Single Sat View: the visible fields", () => {
    expect(resetTab(changed(), "single", DEFAULTS).single_fields).toEqual(DEFAULTS.single.fields);
  });

  it("gives a copy of the defaults, which the draft can then change", () => {
    const p = resetTab(changed(), "map", DEFAULTS);
    p.map.contents["Grid Lines"] = false;
    expect(DEFAULTS.map.contents["Grid Lines"]).toBe(true);
  });
});

describe("applyProps", () => {
  it("writes the properties into a configuration and leaves the rest alone", () => {
    const base = config({
      list_sort: { column: "El", ascending: false },
      ground_track: [25544],
      single: { fields: DEFAULTS.single.fields, selected: 25544 },
    });
    base.refresh.event = 4;
    const p = propsOf(base);
    p.layout_code = "0;0;2;0;1";
    p.refresh.map = 20;
    p.list_columns = ["Satellite", "Catnum"];
    p.map.track_orbits = 5;
    p.polar.orientation = "S/E/N/W";
    p.single_fields = ["Azimuth"];
    const c = applyProps(base, p);
    expect(c.layout_code).toBe("0;0;2;0;1");
    expect(c.refresh).toEqual({ data_ms: 300, list: 1, map: 20, polar: 3, single: 1, event: 4 });
    expect(c.list_columns).toEqual(["Satellite", "Catnum"]);
    expect(c.map.track_orbits).toBe(5);
    expect(c.polar.orientation).toBe("S/E/N/W");
    expect(c.single).toEqual({ fields: ["Azimuth"], selected: 25544 });
    expect(c.list_sort).toEqual({ column: "El", ascending: false });
    expect(c.ground_track).toEqual([25544]);
    expect(c.name).toBe("Amateur");
  });
});

describe("propsEqual", () => {
  it("compares by value", () => {
    expect(propsEqual(propsOf(config()), propsOf(config()))).toBe(true);
    const p = propsOf(config());
    p.map.center_lon = 10;
    expect(propsEqual(propsOf(config()), p)).toBe(false);
  });
});

describe("propsChange (the properties the user changed, as a change of the configuration)", () => {
  it("changes only the groups that differ, on whatever configuration it is applied to", () => {
    const initial = propsOf(config());
    const draft = propsOf(config());
    draft.refresh.map = 20;
    draft.map.contents["Grid Lines"] = false;
    const newest = config({ list_sort: { column: "Az", ascending: true }, list_columns: ["Satellite", "Az"] });
    newest.refresh.event = 3;
    const c = propsChange(initial, draft)(newest);
    expect(c.refresh).toEqual({ data_ms: 300, list: 1, map: 20, polar: 3, single: 1, event: 3 });
    expect(c.map.contents["Grid Lines"]).toBe(false);
    // what the user did not touch stays as the newest configuration has it (another view may have saved it meanwhile)
    expect(c.list_columns).toEqual(["Satellite", "Az"]);
    expect(c.list_sort).toEqual({ column: "Az", ascending: true });
    expect(c.layout_code).toBe(newest.layout_code);
    expect(c.polar).toEqual(newest.polar);
  });

  it("returns the configuration itself when nothing differs", () => {
    const p = propsOf(config());
    const c = config();
    expect(propsChange(p, structuredClone(p))(c)).toBe(c);
  });

  it("changes the layout code, the visible fields and the sky tracks one by one", () => {
    const initial = propsOf(config());
    const draft = propsOf(config());
    draft.layout_code = "2;0;1;0;1;3;1;2;0;1";
    draft.single_fields = ["Azimuth", "Elevation"];
    draft.polar.auto_skytrack = true;
    const c = propsChange(initial, draft)(config());
    expect(c.layout_code).toBe("2;0;1;0;1;3;1;2;0;1");
    expect(c.single.fields).toEqual(["Azimuth", "Elevation"]);
    expect(c.polar.auto_skytrack).toBe(true);
    expect(c.single.selected).toBeNull();
  });
});

describe("layoutCodeError", () => {
  it("is null for every built-in layout and for a custom one that is valid", () => {
    for (const preset of META.layout_presets) expect(layoutCodeError(preset.code), preset.name).toBeNull();
    expect(layoutCodeError("0;0;1;0;1;1;1;2;0;1")).toBeNull();
  });

  it("says in Thai that the code is not valid, and why (the server's words)", () => {
    expect(layoutCodeError("")).toBe("layout code ไม่ถูกต้อง: ต้องเป็นจำนวนเต็มไม่ติดลบคั่นด้วย ;");
    expect(layoutCodeError("1;0;2;0;1;")).toBe("layout code ไม่ถูกต้อง: ต้องเป็นจำนวนเต็มไม่ติดลบคั่นด้วย ;");
    expect(layoutCodeError("1;0;2;0")).toBe("layout code ไม่ถูกต้อง: ต้องเป็นกลุ่มละ 5 จำนวน (type;left;right;top;bottom)");
    expect(layoutCodeError("9;0;1;0;1")).toBe("layout code ไม่ถูกต้อง: ชนิด view 9 ไม่มี (ต้องเป็น 0-4)");
    expect(layoutCodeError("1;0;2;0;1;2;1;1;0;1")).toBe("layout code ไม่ถูกต้อง: ช่องที่ 2 ต้องมี left < right และ top < bottom");
  });

  it("refuses a grid so big that it could not be drawn", () => {
    expect(layoutCodeError("1;0;100000;0;1")).toBe("layout code ไม่ถูกต้อง: ตารางใหญ่เกิน 64 คอลัมน์หรือ 64 แถว");
  });
});

describe("sanitizeLayoutCode (Gpredict's entry deletes everything but digits and ;)", () => {
  it("keeps digits and semicolons", () => {
    expect(sanitizeLayoutCode("1;0;2;0;1")).toBe("1;0;2;0;1");
  });
  it("deletes anything else", () => {
    expect(sanitizeLayoutCode("1; 0;2a;-0;1\n")).toBe("1;0;2;0;1");
  });
});

describe("presetIndexOf", () => {
  const presets = META.layout_presets;
  it("finds the built-in layout of a code", () => {
    expect(presetIndexOf("1;0;2;0;1", presets)).toBe(1);
    expect(presetIndexOf(presets[8]!.code, presets)).toBe(8);
  });
  it("gives the index of Custom (after the nine) for any other code", () => {
    expect(presetIndexOf("1;0;2;0;1;", presets)).toBe(9);
    expect(presetIndexOf("", presets)).toBe(9);
  });
});

describe("withVisible and withFlag", () => {
  it("withVisible keeps the order of Gpredict's table, whatever order the boxes are ticked in", () => {
    const canonical = ["Satellite", "Catnum", "Az", "El"];
    expect(withVisible(canonical, ["Satellite", "El"], "Catnum", true)).toEqual(["Satellite", "Catnum", "El"]);
    expect(withVisible(canonical, ["Satellite", "Catnum", "El"], "Catnum", false)).toEqual(["Satellite", "El"]);
  });

  it("withFlag sets one entry of Contents and leaves the others", () => {
    const next = withFlag({ a: true, b: false }, "b", true);
    expect(next).toEqual({ a: true, b: true });
  });
});
