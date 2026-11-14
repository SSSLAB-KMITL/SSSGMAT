import { describe, expect, it } from "vitest";
import { moduleMenu, satChoices } from "./moduleMenu";
import { outline } from "./menuSpec";
import type { SatState } from "./types";

const sat = (norad: number, name: string) => ({ norad, name }) as SatState;

describe("satChoices", () => {
  it("lists the satellites of a tick sorted by name, ignoring case and numbers by value", () => {
    expect(satChoices([sat(3, "ISS"), sat(1, "beidou 10"), sat(2, "Beidou 2")])).toEqual([
      { norad: 2, name: "Beidou 2" },
      { norad: 1, name: "beidou 10" },
      { norad: 3, name: "ISS" },
    ]);
  });

  it("is empty before the first tick", () => {
    expect(satChoices(undefined)).toEqual([]);
  });
});

describe("moduleMenu (ref §2)", () => {
  const choices = [
    { norad: 25544, name: "ISS" },
    { norad: 7530, name: "OSCAR 7" },
  ];
  /** a docked module, not full screen */
  const docked = { place: "docked", fullscreen: false } as const;

  it("has the items of Gpredict's module popup in order, and every item works (no item is left for a later sub-project)", () => {
    expect(outline(moduleMenu({ autotrack: false, choices, selected: null, ...docked }))).toEqual([
      "Detach module",
      "Full screen",
      "-",
      "[ ] Autotrack",
      "Select satellite >",
      "  ( ) ISS",
      "  ( ) OSCAR 7",
      "-",
      "Sky at a glance",
      "Time Controller",
      "-",
      "Radio Control",
      "Antenna Control",
      "-",
      "Configure",
      "Clone...",
      "-",
      "Delete",
      "Close",
    ]);
  });

  it("shows Autotrack checked while it is on", () => {
    expect(outline(moduleMenu({ autotrack: true, choices, selected: null, ...docked }))).toContain("[x] Autotrack");
  });

  it("checks the selected satellite in Select satellite", () => {
    const lines = outline(moduleMenu({ autotrack: false, choices, selected: 7530, ...docked }));
    expect(lines).toContain("  (o) OSCAR 7");
    expect(lines).toContain("  ( ) ISS");
  });

  it("selects a satellite when it is chosen", () => {
    const select = moduleMenu({ autotrack: false, choices, selected: null, ...docked }).find((e) => e.kind === "submenu");
    expect(select?.kind === "submenu" && select.items[1]).toMatchObject({ kind: "radio", label: "OSCAR 7", action: { type: "select", norad: 7530 } });
  });

  it("disables Select satellite while the module has no satellites (no tick yet)", () => {
    const select = moduleMenu({ autotrack: false, choices: [], selected: null, ...docked }).find((e) => e.kind === "submenu");
    expect(select).toMatchObject({ label: "Select satellite", disabled: true });
  });

  it("maps the working items to their actions", () => {
    const actions = moduleMenu({ autotrack: false, choices, selected: null, ...docked }).flatMap((e) => (e.kind === "item" || e.kind === "check" ? [[e.label, e.action]] : []));
    expect(actions).toEqual([
      ["Detach module", { type: "detach" }],
      ["Full screen", { type: "fullscreen" }],
      ["Autotrack", { type: "autotrack", on: true }],
      ["Sky at a glance", { type: "skyGlance" }],
      ["Time Controller", { type: "timeController" }],
      ["Radio Control", { type: "radio" }],
      ["Antenna Control", { type: "rotator" }],
      ["Configure", { type: "configure" }],
      ["Clone...", { type: "clone" }],
      ["Delete", { type: "delete" }],
      ["Close", { type: "close" }],
    ]);
  });

  it("module menu enables Sky at a glance: it is not a later item and its action opens the window", () => {
    const item = moduleMenu({ autotrack: false, choices, selected: null, ...docked }).find((e) => e.kind === "item" && e.label === "Sky at a glance");
    expect(item).toEqual({ kind: "item", label: "Sky at a glance", action: { type: "skyGlance" } });
    expect(item).not.toHaveProperty("later");
  });

  it("module menu enables Radio Control and Antenna Control: they are not later items and their actions open the windows", () => {
    const menu = moduleMenu({ autotrack: false, choices, selected: null, ...docked });
    expect(outline(menu).filter((l) => l.includes("later 3"))).toEqual([]);
    expect(menu.find((e) => e.kind === "item" && e.label === "Radio Control")).toEqual({ kind: "item", label: "Radio Control", action: { type: "radio" } });
    expect(menu.find((e) => e.kind === "item" && e.label === "Antenna Control")).toEqual({ kind: "item", label: "Antenna Control", action: { type: "rotator" } });
  });

  it("menu items per state", () => {
    const firstTwo = (place: "docked" | "window", fullscreen: boolean) =>
      moduleMenu({ autotrack: false, choices, selected: null, place, fullscreen })
        .slice(0, 2)
        .map((e) => (e.kind === "item" ? [e.label, e.action] : e.kind));
    // ref §2: "Detach module" when docked, "Attach module" otherwise; "Exit full screen" while full screen, "Full screen" otherwise
    expect(firstTwo("docked", false)).toEqual([
      ["Detach module", { type: "detach" }],
      ["Full screen", { type: "fullscreen" }],
    ]);
    expect(firstTwo("window", true)).toEqual([
      ["Attach module", { type: "attach" }],
      ["Exit full screen", { type: "exitFullscreen" }],
    ]);
    expect(firstTwo("window", false)).toEqual([
      ["Attach module", { type: "attach" }],
      ["Full screen", { type: "fullscreen" }],
    ]);
    // full screen from the tab (spec §8.3): no longer docked in Gpredict's sense, so "Attach module" (back into the tab as it was)
    expect(firstTwo("docked", true)).toEqual([
      ["Attach module", { type: "attach" }],
      ["Exit full screen", { type: "exitFullscreen" }],
    ]);
  });

  it("has no item of a later sub-project in any state", () => {
    for (const place of ["docked", "window"] as const) {
      for (const fullscreen of [false, true]) {
        const lines = outline(moduleMenu({ autotrack: false, choices, selected: null, place, fullscreen }));
        expect(lines.filter((l) => l.includes("(later")), `${place} ${fullscreen}`).toEqual([]);
      }
    }
  });

  it("turns Autotrack off when it is chosen while on", () => {
    const item = moduleMenu({ autotrack: true, choices, selected: null, ...docked }).find((e) => e.kind === "check");
    expect(item).toMatchObject({ action: { type: "autotrack", on: false } });
  });
});
