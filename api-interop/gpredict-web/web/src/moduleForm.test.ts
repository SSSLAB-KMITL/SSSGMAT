import { describe, expect, it } from "vitest";
import { DEFAULTS } from "./moduleDefaults.fixture";
import {
  addSat,
  availableSats,
  DEFAULT_QTH,
  editModuleChange,
  GROUP_ALL,
  groupOptions,
  hasModuleChanges,
  HINT,
  newModuleConfig,
  qthChoices,
  removeSat,
  sortedSats,
  TOO_MANY_HINT,
  tleGroupNames,
} from "./moduleForm";
import type { ModuleDraft, SelectedSat } from "./moduleForm";
import { propsOf } from "./moduleProps";
import type { ModuleConfig, SatRecord } from "./types";

const sat = (norad: number, name: string): SelectedSat => ({ norad, name });
const record = (norad: number, name: string): SatRecord => ({ norad, name, groups: [], epoch: null, updated: null });

describe("texts of the satellite selector (ref §3)", () => {
  it("has Gpredict's hint", () => {
    expect(HINT).toBe("Double click on a satellite to move it to the other box.");
  });
  it("first lists All satellites in the group combo, then the CelesTrak groups", () => {
    expect(GROUP_ALL).toBe("All satellites");
    expect(groupOptions(["amateur", "weather"])).toEqual([
      { value: "", label: "All satellites" },
      { value: "amateur", label: "amateur" },
      { value: "weather", label: "weather" },
    ]);
  });
  it("lists the groups of GET /api/tle/groups by name, in the order the server gives, once each", () => {
    const g = (name: string) => ({ name, last_request: null, last_success: null });
    // the sources first (nasabare is not a CelesTrak group), then the groups of the index that have no source
    expect(tleGroupNames([g("nasabare"), g("amateur"), g("amateur"), g("my-files")])).toEqual(["nasabare", "amateur", "my-files"]);
    expect(tleGroupNames([])).toEqual([]);
  });
  it("says in Thai that only the first 500 satellites are listed", () => {
    expect(TOO_MANY_HINT).toContain("500");
  });
});

describe("qthChoices (the Ground station combo, ref §3)", () => {
  it("lists the ground stations sorted by name, then ** DEFAULT ** last", () => {
    const c = qthChoices(["THBK", "alpha", "Beta"]);
    expect(c.map((o) => o.label)).toEqual(["alpha", "Beta", "THBK", "** DEFAULT **"]);
    expect(DEFAULT_QTH).toBe("** DEFAULT **");
  });
  it("makes ** DEFAULT ** mean no station of its own: qth null", () => {
    const c = qthChoices(["THBK"]);
    expect(c[0]).toEqual({ value: "THBK", label: "THBK" });
    expect(c[1]).toEqual({ value: null, label: "** DEFAULT **" });
  });
  it("is only ** DEFAULT ** when there is no ground station", () => {
    expect(qthChoices([])).toEqual([{ value: null, label: "** DEFAULT **" }]);
  });
});

describe("the list of selected satellites (sorted by name, Catnum breaks a tie)", () => {
  it("sorts by name, ignoring case, numbers by value", () => {
    const list = sortedSats([sat(3, "STARLINK-10"), sat(1, "iss"), sat(2, "STARLINK-2"), sat(5, "AO-7")]);
    expect(list.map((s) => s.norad)).toEqual([5, 1, 2, 3]);
  });
  it("breaks a tie by catalogue number", () => {
    expect(sortedSats([sat(9, "X"), sat(4, "X")]).map((s) => s.norad)).toEqual([4, 9]);
  });
  it("addSat puts a satellite in its place and does not add one twice", () => {
    const list = [sat(1, "A"), sat(3, "C")];
    expect(addSat(list, sat(2, "B")).map((s) => s.norad)).toEqual([1, 2, 3]);
    expect(addSat(list, sat(3, "C"))).toBe(list);
  });
  it("removeSat takes a satellite out, and is the same list when it is not there", () => {
    const list = [sat(1, "A"), sat(3, "C")];
    expect(removeSat(list, 1)).toEqual([sat(3, "C")]);
    expect(removeSat(list, 99)).toBe(list);
  });
  it("does not change the list it is given", () => {
    const list = [sat(3, "C"), sat(1, "A")];
    sortedSats(list);
    expect(list.map((s) => s.norad)).toEqual([3, 1]);
  });
});

describe("availableSats (Gpredict hides a satellite that is selected from the available list)", () => {
  it("drops the satellites that are selected and keeps the server's order", () => {
    const found = [record(1, "A"), record(2, "B"), record(3, "C")];
    expect(availableSats(found, [sat(2, "B")]).map((s) => s.norad)).toEqual([1, 3]);
  });
  it("is the whole result when nothing is selected", () => {
    const found = [record(1, "A")];
    expect(availableSats(found, [])).toEqual([sat(1, "A")]);
  });
});

describe("newModuleConfig (OK of Create new module)", () => {
  it("builds the module from Gpredict's defaults, the form and the properties", () => {
    const props = propsOf(DEFAULTS);
    props.refresh.map = 20;
    const c = newModuleConfig({ name: "Amateur", qth: "THBK", satellites: [sat(2, "B"), sat(1, "A")] }, props, DEFAULTS);
    expect(c.name).toBe("Amateur");
    expect(c.qth).toBe("THBK");
    expect(c.satellites).toEqual([1, 2]);
    expect(c.refresh).toEqual({ ...DEFAULTS.refresh, map: 20 });
    expect(c.single.selected).toBeNull();
    expect(c.footprint_off).toEqual([]);
    expect(c.list_sort).toEqual(DEFAULTS.list_sort);
  });
  it("uses ** DEFAULT ** as qth null", () => {
    expect(newModuleConfig({ name: "A", qth: null, satellites: [sat(1, "A")] }, propsOf(DEFAULTS), DEFAULTS).qth).toBeNull();
  });
  it("does not share arrays or objects with the defaults", () => {
    const c = newModuleConfig({ name: "A", qth: null, satellites: [sat(1, "A")] }, propsOf(DEFAULTS), DEFAULTS);
    c.refresh.map = 99;
    c.single.fields.push("X");
    expect(DEFAULTS.refresh.map).toBe(10);
    expect(DEFAULTS.single.fields).not.toContain("X");
  });
});

describe("editModuleChange (OK of Edit module: a change of the open module's configuration)", () => {
  const base = (over: Partial<ModuleConfig> = {}): ModuleConfig => ({
    ...structuredClone(DEFAULTS),
    name: "Amateur",
    qth: "THBK",
    satellites: [1, 2, 3],
    ...over,
  });
  const draftOf = (c: ModuleConfig): ModuleDraft => ({ qth: c.qth, satellites: [...c.satellites], props: propsOf(c) });

  it("says nothing changed when the draft is what the module had", () => {
    const c = base();
    expect(hasModuleChanges(draftOf(c), draftOf(c))).toBe(false);
    expect(editModuleChange(draftOf(c), draftOf(c))(c)).toBe(c);
  });

  it("changes the ground station only", () => {
    const c = base();
    const draft = { ...draftOf(c), qth: null };
    expect(hasModuleChanges(draftOf(c), draft)).toBe(true);
    const next = editModuleChange(draftOf(c), draft)(c);
    expect(next.qth).toBeNull();
    expect(next.satellites).toBe(c.satellites);
    expect(next.map).toBe(c.map);
  });

  it("replaces the satellites and takes out of the other lists the ones that are gone", () => {
    const c = base({
      footprint_off: [1, 2],
      ground_track: [2, 3],
      sky_track: [3],
      single: { fields: DEFAULTS.single.fields, selected: 2 },
    });
    const draft = { ...draftOf(c), satellites: [1, 3, 4] };
    const next = editModuleChange(draftOf(c), draft)(c);
    expect(next.satellites).toEqual([1, 3, 4]);
    expect(next.footprint_off).toEqual([1]);
    expect(next.ground_track).toEqual([3]);
    expect(next.sky_track).toEqual([3]);
    expect(next.single.selected).toBeNull();
  });

  it("keeps the satellite Single sat shows when it stays in the module", () => {
    const c = base({ single: { fields: DEFAULTS.single.fields, selected: 3 } });
    const next = editModuleChange(draftOf(c), { ...draftOf(c), satellites: [3, 9] })(c);
    expect(next.single.selected).toBe(3);
  });

  it("applies the same instruction to a configuration that changed meanwhile", () => {
    const c = base();
    const draft = { ...draftOf(c), satellites: [1, 2], props: { ...propsOf(c), layout_code: "0;0;2;0;1" } };
    const newest = base({ list_sort: { column: "El", ascending: false }, ground_track: [1, 3] });
    const next = editModuleChange(draftOf(c), draft)(newest);
    expect(next.satellites).toEqual([1, 2]);
    expect(next.layout_code).toBe("0;0;2;0;1");
    expect(next.ground_track).toEqual([1]);
    expect(next.list_sort).toEqual({ column: "El", ascending: false });
  });

  it("treats the same satellites in another order as no change", () => {
    const c = base();
    expect(hasModuleChanges(draftOf(c), { ...draftOf(c), satellites: [3, 2, 1] })).toBe(false);
  });

  it("applies the change of the properties it is given (propsSave's) with the ground station", () => {
    const c = base();
    const centre = (config: ModuleConfig): ModuleConfig => ({ ...config, map: { ...config.map, center_lon: 45 } });
    const next = editModuleChange(draftOf(c), { ...draftOf(c), qth: null }, centre)(c);
    expect(next.map.center_lon).toBe(45);
    expect(next.qth).toBeNull();
  });
});
