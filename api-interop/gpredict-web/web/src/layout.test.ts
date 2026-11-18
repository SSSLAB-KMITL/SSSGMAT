import { describe, expect, it } from "vitest";
import { gridFor, parseLayout, VIEW } from "./layout";

// Built-in presets, ref §3 (code column)
const PRESETS = [
  "1;0;2;0;1;2;0;1;1;2;3;1;2;1;2",
  "1;0;2;0;1",
  "0;0;2;0;1",
  "1;0;2;0;2;0;0;2;2;3",
  "2;0;1;0;1;3;1;2;0;1",
  "2;0;1;0;1;4;1;2;0;1",
  "1;0;3;0;4;0;0;3;4;6;2;0;1;6;8;3;1;2;6;8;4;2;3;6;8",
  "1;0;3;0;3;0;0;3;3;4;2;3;4;0;2;4;3;4;2;3;3;3;4;3;4",
  "1;0;3;0;3;0;0;3;3;4;2;3;4;0;2;3;3;4;2;4",
];

describe("parseLayout", () => {
  it("reads groups of five integers: type;left;right;top;bottom", () => {
    expect(parseLayout("1;0;2;0;1")).toEqual([{ type: 1, left: 0, right: 2, top: 0, bottom: 1 }]);
    expect(parseLayout(PRESETS[0]!)).toEqual([
      { type: 1, left: 0, right: 2, top: 0, bottom: 1 },
      { type: 2, left: 0, right: 1, top: 1, bottom: 2 },
      { type: 3, left: 1, right: 2, top: 1, bottom: 2 },
    ]);
  });

  it("accepts all nine built-in presets", () => {
    for (const code of PRESETS) expect(parseLayout(code).length).toBeGreaterThan(0);
  });

  it("rejects what the server rejects (MODULE_INVALID)", () => {
    expect(() => parseLayout("")).toThrow();
    expect(() => parseLayout("1;0;2;0")).toThrow(); // not a multiple of 5
    expect(() => parseLayout("1;0;2;0;1;")).toThrow(); // trailing separator
    expect(() => parseLayout("1;0;x;0;1")).toThrow(); // not an integer
    expect(() => parseLayout("1;0;-2;0;1")).toThrow(); // negative
    expect(() => parseLayout("5;0;1;0;1")).toThrow(); // no view type 5
    expect(() => parseLayout("1;2;2;0;1")).toThrow(); // left >= right
    expect(() => parseLayout("1;0;2;1;1")).toThrow(); // top >= bottom
  });
});

describe("gridFor", () => {
  it("preset 0: 2 columns x 2 rows, Map across the whole top row", () => {
    const grid = gridFor(parseLayout(PRESETS[0]!));
    expect(grid.columns).toBe(2);
    expect(grid.rows).toBe(2);
    expect(grid.areas).toEqual([
      { type: VIEW.Map, gridColumn: "1 / 3", gridRow: "1 / 2" },
      { type: VIEW.Polar, gridColumn: "1 / 2", gridRow: "2 / 3" },
      { type: VIEW.SingleSat, gridColumn: "2 / 3", gridRow: "2 / 3" },
    ]);
  });

  it("preset 7 (All views, wide): 4 x 4 as in ref §3", () => {
    const grid = gridFor(parseLayout(PRESETS[7]!));
    expect(grid.columns).toBe(4);
    expect(grid.rows).toBe(4);
    expect(grid.areas).toEqual([
      { type: VIEW.Map, gridColumn: "1 / 4", gridRow: "1 / 4" }, // columns 0-3, rows 0-3
      { type: VIEW.List, gridColumn: "1 / 4", gridRow: "4 / 5" }, // list under the map
      { type: VIEW.Polar, gridColumn: "4 / 5", gridRow: "1 / 3" }, // right column: polar rows 0-2
      { type: VIEW.EventList, gridColumn: "4 / 5", gridRow: "3 / 4" }, // events row 2-3
      { type: VIEW.SingleSat, gridColumn: "4 / 5", gridRow: "4 / 5" }, // single sat row 3-4
    ]);
  });

  it("preset 6 (All views, narrow): 3 columns x 8 rows", () => {
    const grid = gridFor(parseLayout(PRESETS[6]!));
    expect(grid.columns).toBe(3);
    expect(grid.rows).toBe(8);
    expect(grid.areas[0]).toEqual({ type: VIEW.Map, gridColumn: "1 / 4", gridRow: "1 / 5" });
    expect(grid.areas[1]).toEqual({ type: VIEW.List, gridColumn: "1 / 4", gridRow: "5 / 7" });
  });

  it("single-view presets fill the whole grid", () => {
    expect(gridFor(parseLayout(PRESETS[1]!))).toEqual({
      columns: 2,
      rows: 1,
      areas: [{ type: VIEW.Map, gridColumn: "1 / 3", gridRow: "1 / 2" }],
    });
    expect(gridFor(parseLayout(PRESETS[2]!)).areas[0]?.type).toBe(VIEW.List);
  });

  it("an empty layout has no cells", () => {
    expect(gridFor([])).toEqual({ columns: 0, rows: 0, areas: [] });
  });
});
