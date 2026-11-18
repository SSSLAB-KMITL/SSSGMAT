import { describe, expect, it } from "vitest";
import { DEFAULTS, META } from "./moduleDefaults.fixture";
import {
  applyProps,
  layoutCodeError,
  markEdited,
  markReset,
  newModulePins,
  NO_MARKS,
  pagePaths,
  PROPS_TABS,
  presetIndexOf,
  propsChange,
  propsOf,
  propsSave,
  propsValue,
  resetTab,
  RESET_TIP,
  sanitizeLayoutCode,
  withFlag,
  withPropsValue,
  withVisible,
} from "./moduleProps";
import type { ModuleProps, PropsMarks } from "./moduleProps";
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

  it("has the background map, the colours and the shadow of the Map View page and the colours of the Polar View page", () => {
    const p = propsOf(config());
    expect(p.map.file).toBe("nasa-bmng-07_1024.jpg");
    expect(p.map.shadow_alpha).toBe(0xdd);
    expect(p.map.colours.terminator).toBe(0xffff0080);
    expect(p.map.colours.earthShadow).toBe(0x00000060);
    expect(p.polar.colours.info).toBe(0x00007fff);
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

describe("resetTab (every tab's Reset button puts back the given values (the global ones) of that tab only)", () => {
  const changed = () => {
    const p = propsOf(config());
    p.layout_code = "0;0;2;0;1";
    p.refresh = { data_ms: 1000, list: 5, map: 20, polar: 7, single: 9 };
    p.list_columns = ["Satellite"];
    p.map = {
      ...p.map,
      contents: { ...p.map.contents, "Grid Lines": false, "Cursor Position": true },
      track_orbits: 7,
      center_lon: -90,
      colours: { ...p.map.colours, terminator: 0x11223344 },
    };
    p.polar = { ...p.polar, orientation: "S/W/N/E", contents: { ...p.polar.contents, "Extra Az Ticks": true }, auto_skytrack: true };
    p.single_fields = ["Azimuth"];
    return p;
  };
  const defaults = propsOf(config());

  it("Layout: the layout code", () => {
    const p = resetTab(changed(), "layout", defaults);
    expect(p.layout_code).toBe(defaults.layout_code);
    expect(p.refresh).toEqual(changed().refresh);
  });

  it("Refresh Rates: the five rates", () => {
    const p = resetTab(changed(), "refresh", defaults);
    expect(p.refresh).toEqual({ data_ms: 300, list: 1, map: 10, polar: 3, single: 1 });
    expect(p.layout_code).toBe("0;0;2;0;1");
  });

  it("List View: the visible fields", () => {
    expect(resetTab(changed(), "list", defaults).list_columns).toEqual(DEFAULTS.list_columns);
  });

  it("Map View: contents, number of orbits, centre longitude", () => {
    const p = resetTab(changed(), "map", defaults);
    expect(p.map).toEqual(DEFAULTS.map);
    expect(p.polar).toEqual(changed().polar);
  });

  it("Polar View: orientation, contents, sky tracks", () => {
    const p = resetTab(changed(), "polar", defaults);
    expect(p.polar).toEqual(DEFAULTS.polar);
    expect(p.map).toEqual(changed().map);
  });

  it("Single Sat View: the visible fields", () => {
    expect(resetTab(changed(), "single", defaults).single_fields).toEqual(DEFAULTS.single.fields);
  });

  it("Map View: the solar terminator and global shadow colours too (Gpredict leaves them, ref-D §11; spec §11 fixes it)", () => {
    expect(resetTab(changed(), "map", defaults).map.colours.terminator).toBe(0xffff0080);
  });

  it("gives a copy of the values, which the draft can then change", () => {
    const p = resetTab(changed(), "map", defaults);
    p.map.contents["Grid Lines"] = false;
    p.map.colours.grid = 0;
    expect(defaults.map.contents["Grid Lines"]).toBe(true);
    expect(defaults.map.colours.grid).toBe(0x7f7f7fc8);
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

  it("changes one colour, the background map and the shadow without the colours the user did not touch", () => {
    const initial = propsOf(config());
    const draft = propsOf(config());
    draft.map.colours.grid = 0x01020304;
    draft.map.file = "earth_800.png";
    draft.map.shadow_alpha = 0;
    draft.polar.colours.info = 0x05060708;
    const newest = config();
    newest.map.colours.track = 0x0a0b0c0d;
    const c = propsChange(initial, draft)(newest);
    expect(c.map.colours).toEqual({ ...DEFAULTS.map.colours, grid: 0x01020304, track: 0x0a0b0c0d });
    expect(c.map.file).toBe("earth_800.png");
    expect(c.map.shadow_alpha).toBe(0);
    expect(c.polar.colours).toEqual({ ...DEFAULTS.polar.colours, info: 0x05060708 });
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

describe("paths of the server (meta.module_keys) in the properties", () => {
  it("reads and writes a value by its path; Single Sat's fields are single_fields here", () => {
    const p = propsOf(config());
    expect(propsValue(p, "map.colours.earthShadow")).toBe(0x00000060);
    expect(propsValue(p, "map.contents.Solar Terminator")).toBe(false);
    expect(propsValue(p, "single.fields")).toEqual(DEFAULTS.single.fields);
    expect(propsValue(p, "layout_code")).toBe(DEFAULTS.layout_code);
    const q = withPropsValue(p, "map.contents.Grid Lines", false);
    expect(q.map.contents["Grid Lines"]).toBe(false);
    expect(p.map.contents["Grid Lines"]).toBe(true); // a copy
    expect(q.polar).toBe(p.polar); // what is not on the path is shared
    expect(withPropsValue(p, "single.fields", ["Azimuth"]).single_fields).toEqual(["Azimuth"]);
  });

  it("the refresh of the event list is not held: Gpredict's Refresh Rates page has no control for it", () => {
    expect(propsValue(propsOf(config()), "refresh.event")).toBeUndefined();
    expect(pagePaths("refresh", META)).toEqual(["refresh.data_ms", "refresh.list", "refresh.map", "refresh.polar", "refresh.single"]);
  });

  it("every other path of every page is held, in the server's order", () => {
    expect(pagePaths("map", META)).toEqual(Object.keys(META.module_keys.map));
    expect(pagePaths("polar", META)).toEqual(Object.keys(META.module_keys.polar));
    expect(pagePaths("layout", META)).toEqual(["layout_code"]);
    expect(pagePaths("list", META)).toEqual(["list_columns"]);
    expect(pagePaths("single", META)).toEqual(["single.fields"]);
  });
});

describe("propsSave (OK of Module properties: the change, and which pages are pinned to the module or inherit again)", () => {
  const opened = () => propsOf(config());
  /** the global values (Preferences → Modules), which Reset loads in module mode */
  const global = (): ModuleProps => {
    const g = propsOf(config());
    g.map.track_orbits = 5;
    g.polar.orientation = "S/E/N/W";
    g.list_columns = ["Satellite", "El"];
    return g;
  };
  const save = (draft: ModuleProps, marks: PropsMarks) => propsSave(opened(), draft, marks.dirty, marks.reset, META);

  it("dirty page pins all its paths", () => {
    const draft = opened();
    draft.map.center_lon = 30;
    const s = save(draft, markEdited(NO_MARKS, "map"));
    expect(s.pin).toEqual(Object.keys(META.module_keys.map)); // all of the page, even the values left as they were
    expect(s.pin).toContain("map.colours.terminator");
    expect(s.pin).toContain("map.colours.earthShadow");
    expect(s.unpin).toEqual([]);
    expect(s.change(config()).map.center_lon).toBe(30);
  });

  it("reset then OK unpins", () => {
    const draft = resetTab(opened(), "polar", global());
    const s = save(draft, markReset(NO_MARKS, "polar"));
    expect(s.unpin).toEqual(Object.keys(META.module_keys.polar));
    expect(s.pin).toEqual([]);
    // the page shows the global values until the module is read again
    expect(s.change(config()).polar.orientation).toBe("S/E/N/W");
  });

  it("reset then edit pins", () => {
    const draft = resetTab(opened(), "map", global());
    draft.map.center_lon = -45;
    const marks = markEdited(markReset(NO_MARKS, "map"), "map");
    const s = save(draft, marks);
    expect(s.pin).toEqual(Object.keys(META.module_keys.map));
    expect(s.unpin).toEqual([]);
    const c = s.change(config());
    expect([c.map.track_orbits, c.map.center_lon]).toEqual([5, -45]);
  });

  it("an edit then Reset unpins: the Reset clears the edit (sat-pref-*.c reset_cb: dirty = FALSE)", () => {
    const marks = markReset(markEdited(NO_MARKS, "refresh"), "refresh");
    const s = save(resetTab(opened(), "refresh", global()), marks);
    expect(s.unpin).toEqual(pagePaths("refresh", META));
    expect(s.pin).toEqual([]);
  });

  it("list toggled back is not dirty", () => {
    // ticked and cleared again: the same fields as when the dialog opened
    const s = save(opened(), markEdited(NO_MARKS, "list"));
    expect([s.pin, s.unpin]).toEqual([[], []]);
    // Single Sat View the same
    expect(save(opened(), markEdited(NO_MARKS, "single")).pin).toEqual([]);
    // a set that differs is dirty
    const draft = opened();
    draft.list_columns = ["Satellite"];
    expect(save(draft, markEdited(NO_MARKS, "list")).pin).toEqual(["list_columns"]);
    // after a Reset, back to the fields of the opening: the Reset is what is left (sat-pref-list-view.c:115-124)
    expect(save(opened(), markEdited(markReset(NO_MARKS, "list"), "list")).unpin).toEqual(["list_columns"]);
  });

  it("other pages count as dirty after any edit, even one that ends at the starting value (sat-pref-map-view.c:381-501)", () => {
    expect(save(opened(), markEdited(NO_MARKS, "layout")).pin).toEqual(["layout_code"]);
  });

  it("nothing done: nothing pinned or unpinned, and the change gives back the configuration itself", () => {
    const s = save(opened(), NO_MARKS);
    expect([s.pin, s.unpin]).toEqual([[], []]);
    const c = config();
    expect(s.change(c)).toBe(c);
  });

  it("a dirty page writes all its values from the draft, not the out-of-date ones of the configuration it is applied to", () => {
    // the dialog opened with the module as the server resolves it now (orbits 5, the new global value); the page still holds 3
    const now = config();
    now.map.track_orbits = 5;
    now.map.colours.grid = 0x01020304;
    const draft = propsOf(now);
    draft.map.contents["Cursor Position"] = true;
    const s = propsSave(propsOf(now), draft, new Set(["map"]), new Set(), META);
    const stale = config(); // track_orbits 3, the default grid colour
    stale.list_sort = { column: "El", ascending: false };
    const c = s.change(stale);
    expect(c.map.track_orbits).toBe(5); // untouched in the dialog, but pinned: the value the user saw
    expect(c.map.colours.grid).toBe(0x01020304);
    expect(c.map.contents["Cursor Position"]).toBe(true);
    expect(c.list_sort).toEqual({ column: "El", ascending: false }); // what is not a pinned page stays as the configuration has it
    expect(c.polar).toBe(stale.polar);
  });

  it("a page that was Reset shows the global values it goes back to, whatever the configuration held", () => {
    const own = config();
    own.polar.orientation = "S/W/N/E";
    const draft = resetTab(propsOf(own), "polar", global());
    const stale = config();
    stale.polar.orientation = "N/W/S/E";
    const c = propsSave(propsOf(own), draft, new Set(), new Set(["polar"]), META).change(stale);
    expect(c.polar.orientation).toBe("S/E/N/W");
  });

  it("pins and unpins several pages at once, page by page in the order of the notebook", () => {
    const marks = markReset(markEdited(markEdited(NO_MARKS, "single"), "layout"), "list");
    const draft = opened();
    draft.single_fields = ["Azimuth"];
    const s = save(draft, marks);
    expect(s.pin).toEqual(["layout_code", "single.fields"]);
    expect(s.unpin).toEqual(["list_columns"]);
  });
});

describe("marks (what the user did to each page of Module properties)", () => {
  it("an edit marks the page dirty; a Reset clears that and marks it reset; an edit after the Reset keeps both", () => {
    const edited = markEdited(NO_MARKS, "map");
    expect([...edited.dirty]).toEqual(["map"]);
    const reset = markReset(edited, "map");
    expect([[...reset.dirty], [...reset.reset]]).toEqual([[], ["map"]]);
    const again = markEdited(reset, "map");
    expect([[...again.dirty], [...again.reset]]).toEqual([["map"], ["map"]]);
    expect(NO_MARKS.dirty.size + NO_MARKS.reset.size).toBe(0); // never changed
  });

  it("gives the same marks back when nothing changes", () => {
    const edited = markEdited(NO_MARKS, "map");
    expect(markEdited(edited, "map")).toBe(edited);
  });
});

describe("newModulePins (Create new module: a fresh module, also over a closed one of that name)", () => {
  it("pins the pages the user changed and unpins every other path, so nothing of an overwritten module's file is left", () => {
    const { pin, unpin } = newModulePins(["layout_code"], META);
    expect(pin).toEqual(["layout_code"]);
    expect(unpin).not.toContain("layout_code");
    // every path of the server's, the event list's refresh too (no page has it, but an old file can)
    expect(unpin).toContain("refresh.event");
    const all = Object.values(META.module_keys).flatMap((page) => Object.keys(page));
    expect([...pin, ...unpin].sort()).toEqual([...all].sort());
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
