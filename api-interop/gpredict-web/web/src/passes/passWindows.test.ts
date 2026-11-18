import { describe, expect, it } from "vitest";
import { MULTI_COLUMNS, SINGLE_COLUMNS } from "./passCells";
import { makePass } from "./passPlots.fixture";
import {
  cascadePosition,
  closeWindow,
  columnTitles,
  detailsTitle,
  moveRow,
  newId,
  openWindow,
  upcomingMenu,
  upcomingTitle,
  visibleColumns,
} from "./passWindows";
import type { PassWindow } from "./passWindows";
import type { PassQth, PassSat } from "./types";

const SAT: PassSat = { norad: 25544, name: "ISS (ZARYA)" };
const QTH: PassQth = { name: "Bangkok", location: "Bangkok, Thailand", lat_deg: 13.7563, lon_deg: 100.5018, alt_m: 2 };
const PASS = makePass(10, 200);

const upcoming = (id: string): PassWindow => ({ id, kind: "upcoming", answer: { sat: SAT, qth: QTH, passes: [PASS] } });
const details = (id: string, parent: string | null): PassWindow => ({ id, kind: "details", answer: { sat: SAT, qth: QTH, pass: PASS }, parent });
const ids = (list: readonly PassWindow[]): string[] => list.map((w) => w.id);

describe("the list of open pass windows", () => {
  it("closing the upcoming window closes its details windows", () => {
    // upcoming U, details D1 opened from U, details D2 opened from a Show next pass (no parent)
    const list = [upcoming("U"), details("D1", "U"), details("D2", null)];
    expect(ids(closeWindow(list, "U"))).toEqual(["D2"]);
  });

  it("closing a details window closes only that window, and not its parent or its siblings", () => {
    const list = [upcoming("U"), details("D1", "U"), details("D2", "U")];
    expect(ids(closeWindow(list, "D1"))).toEqual(["U", "D2"]);
  });

  it("closing a window that is not open changes nothing", () => {
    const list = [upcoming("U"), details("D1", "U")];
    expect(closeWindow(list, "X")).toBe(list);
  });

  it("several details windows can be open", () => {
    let list: readonly PassWindow[] = [];
    list = openWindow(list, details("D1", null));
    list = openWindow(list, details("D2", null));
    list = openWindow(list, details("D3", "U"));
    list = openWindow(list, upcoming("U"));
    expect(ids(list)).toEqual(["D1", "D2", "D3", "U"]);
  });

  it("the same pass can be opened twice: each opening has its own window", () => {
    const list = openWindow(openWindow([], details(newId(), null)), details(newId(), null));
    expect(list).toHaveLength(2);
  });

  it("a window that is open already is not added again", () => {
    const list = openWindow([], details("D1", null));
    expect(openWindow(list, details("D1", null))).toBe(list);
  });

  it("a new window goes in front (the end of the list)", () => {
    const list = openWindow([upcoming("U")], details("D1", "U"));
    expect(ids(list).at(-1)).toBe("D1");
  });

  it("gives every window an id of its own", () => {
    const made = new Set(Array.from({ length: 100 }, () => newId()));
    expect(made.size).toBe(100);
  });
});

describe("window titles (ref-P §1.5)", () => {
  it("Pass details for %s (orbit %d)", () => {
    expect(detailsTitle(SAT, PASS)).toBe("Pass details for ISS (ZARYA) (orbit 1234)");
  });
  it("Upcoming passes for %s", () => {
    expect(upcomingTitle(SAT)).toBe("Upcoming passes for ISS (ZARYA)");
  });
});

describe("the columns a window shows", () => {
  it("reads the titles of a column preference", () => {
    expect(columnTitles(["Time", "Az"])).toEqual(["Time", "Az"]);
    expect(columnTitles([])).toEqual([]);
  });

  it("is null for a preference that is not a list of texts (or not there yet)", () => {
    expect(columnTitles(undefined)).toBeNull();
    expect(columnTitles("Time")).toBeNull();
    expect(columnTitles(["Time", 3])).toBeNull();
  });

  it("keeps Gpredict's fixed order whatever the order of the preference", () => {
    const shown = visibleColumns(SINGLE_COLUMNS, ["Footp", "Time", "El", "Az", "Range"]);
    expect(shown.map((c) => c.title)).toEqual(["Time", "Az", "El", "Range", "Footp"]);
  });

  it("leaves out the columns that are off and the titles that are not columns", () => {
    expect(visibleColumns(MULTI_COLUMNS, ["Orbit", "AOS", "Nonsense"]).map((c) => c.title)).toEqual(["AOS", "Orbit"]);
    expect(visibleColumns(MULTI_COLUMNS, [])).toEqual([]);
  });

  it("keeps the alignment of each column", () => {
    const shown = visibleColumns(SINGLE_COLUMNS, ["Time", "Az", "Vel"]);
    expect(shown.map((c) => c.align)).toEqual(["center", "right", "left"]);
  });
});

describe("the row popup of Upcoming passes (ref-P §3.4)", () => {
  it("is Show details, a separator, then Polar plot and Az/El plot, which cannot be chosen", () => {
    const menu = upcomingMenu(() => undefined);
    expect(menu.map((e) => (e.kind === "item" ? e.label : e.kind))).toEqual(["Show details", "separator", "Polar plot", "Az/El plot"]);
    const [show, , polar, azel] = menu;
    expect(show).toMatchObject({ kind: "item" });
    expect(show).not.toHaveProperty("disabled", true);
    expect(polar).toMatchObject({ kind: "item", disabled: true });
    expect(azel).toMatchObject({ kind: "item", disabled: true });
  });

  it("calls the function it is given when Show details is chosen, and nothing for the other two", () => {
    let shown = 0;
    const menu = upcomingMenu(() => {
      shown += 1;
    });
    for (const e of menu) if (e.kind === "item") e.onChoose?.();
    expect(shown).toBe(1);
  });
});

describe("the selected row of Upcoming passes", () => {
  it("Down selects the first row when none is selected, Up the last", () => {
    expect(moveRow(null, 1, 5)).toBe(0);
    expect(moveRow(null, -1, 5)).toBe(4);
  });

  it("moves by one and stops at the first and the last row", () => {
    expect(moveRow(2, 1, 5)).toBe(3);
    expect(moveRow(2, -1, 5)).toBe(1);
    expect(moveRow(4, 1, 5)).toBe(4);
    expect(moveRow(0, -1, 5)).toBe(0);
  });

  it("selects nothing in a list with no rows", () => {
    expect(moveRow(null, 1, 0)).toBeNull();
  });
});

describe("where a new window opens", () => {
  it("cascades, so that windows opened one after another do not hide each other", () => {
    const first = cascadePosition(0);
    const second = cascadePosition(1);
    expect(second.x).toBeGreaterThan(first.x);
    expect(second.y).toBeGreaterThan(first.y);
  });

  it("starts again after a few windows, so that it never leaves the page", () => {
    expect(cascadePosition(8)).toEqual(cascadePosition(0));
  });
});
