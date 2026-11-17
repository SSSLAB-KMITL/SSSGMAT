import { describe, expect, it } from "vitest";
import { pruneToOpen, withSelection, withMember, singleSatChange } from "./selection";
import type { ModuleConfig } from "./types";

describe("withSelection (the selected satellite of each module, not saved)", () => {
  it("sets the selection of one module and keeps the others", () => {
    const a = withSelection({}, "Amateur", 25544);
    const b = withSelection(a, "Weather", 7);
    expect(b).toEqual({ Amateur: 25544, Weather: 7 });
    expect(a).toEqual({ Amateur: 25544 });
  });

  it("unselects with null", () => {
    expect(withSelection({ Amateur: 1 }, "Amateur", null)).toEqual({ Amateur: null });
  });

  it("returns the same object when nothing changes", () => {
    const sel = { Amateur: 1 };
    expect(withSelection(sel, "Amateur", 1)).toBe(sel);
  });
});

describe("pruneToOpen", () => {
  it("drops the selections of modules that are not open any more", () => {
    expect(pruneToOpen({ Amateur: 1, Weather: 2 }, ["Weather"])).toEqual({ Weather: 2 });
  });

  it("returns the same object when everything stays", () => {
    const sel = { Amateur: 1 };
    expect(pruneToOpen(sel, ["Amateur", "Weather"])).toBe(sel);
  });
});

describe("withMember (modules with Autotrack on)", () => {
  it("adds and removes a name, giving the same set when nothing changes", () => {
    const on = withMember(new Set<string>(), "Amateur", true);
    expect([...on]).toEqual(["Amateur"]);
    expect(withMember(on, "Amateur", true)).toBe(on);
    expect([...withMember(on, "Amateur", false)]).toEqual([]);
    const empty = new Set<string>();
    expect(withMember(empty, "Amateur", false)).toBe(empty);
  });
});

describe("singleSatChange (Select satellite and Autotrack select in every view, Single sat included)", () => {
  const base = { name: "m", satellites: [1, 2, 3], single: { fields: ["Azimuth"], selected: 1 } } as unknown as ModuleConfig;

  it("makes the satellite the one Single sat shows, keeping its fields", () => {
    expect(singleSatChange(3)(base).single).toEqual({ fields: ["Azimuth"], selected: 3 });
  });

  it("returns the configuration as it is when Single sat shows the satellite already", () => {
    expect(singleSatChange(1)(base)).toBe(base);
  });

  it("changes nothing for a satellite that is not in the module (any more)", () => {
    expect(singleSatChange(99)(base)).toBe(base);
  });
});
