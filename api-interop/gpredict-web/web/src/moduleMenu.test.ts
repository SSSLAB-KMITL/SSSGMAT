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

  it("has the items of Gpredict's module popup in order; Autotrack, Select satellite, Sky at a glance, Time Controller, Configure, Clone, Delete and Close work", () => {
    expect(outline(moduleMenu({ autotrack: false, choices, selected: null }))).toEqual([
      "Detach module (later 4)",
      "Full screen (later 4)",
      "-",
      "[ ] Autotrack",
      "Select satellite >",
      "  ( ) ISS",
      "  ( ) OSCAR 7",
      "-",
      "Sky at a glance",
      "Time Controller",
      "-",
      "Radio Control (later 3)",
      "Antenna Control (later 3)",
      "-",
      "Configure",
      "Clone...",
      "-",
      "Delete",
      "Close",
    ]);
  });

  it("shows Autotrack checked while it is on", () => {
    expect(outline(moduleMenu({ autotrack: true, choices, selected: null }))).toContain("[x] Autotrack");
  });

  it("checks the selected satellite in Select satellite", () => {
    const lines = outline(moduleMenu({ autotrack: false, choices, selected: 7530 }));
    expect(lines).toContain("  (o) OSCAR 7");
    expect(lines).toContain("  ( ) ISS");
  });

  it("selects a satellite when it is chosen", () => {
    const select = moduleMenu({ autotrack: false, choices, selected: null }).find((e) => e.kind === "submenu");
    expect(select?.kind === "submenu" && select.items[1]).toMatchObject({ kind: "radio", label: "OSCAR 7", action: { type: "select", norad: 7530 } });
  });

  it("disables Select satellite while the module has no satellites (no tick yet)", () => {
    const select = moduleMenu({ autotrack: false, choices: [], selected: null }).find((e) => e.kind === "submenu");
    expect(select).toMatchObject({ label: "Select satellite", disabled: true });
  });

  it("maps the working items to their actions", () => {
    const actions = moduleMenu({ autotrack: false, choices, selected: null }).flatMap((e) => (e.kind === "item" || e.kind === "check" ? [[e.label, e.action]] : []));
    expect(actions).toEqual([
      ["Detach module", undefined],
      ["Full screen", undefined],
      ["Autotrack", { type: "autotrack", on: true }],
      ["Sky at a glance", { type: "skyGlance" }],
      ["Time Controller", { type: "timeController" }],
      ["Radio Control", undefined],
      ["Antenna Control", undefined],
      ["Configure", { type: "configure" }],
      ["Clone...", { type: "clone" }],
      ["Delete", { type: "delete" }],
      ["Close", { type: "close" }],
    ]);
  });

  it("module menu enables Sky at a glance: it is not a later item and its action opens the window", () => {
    const item = moduleMenu({ autotrack: false, choices, selected: null }).find((e) => e.kind === "item" && e.label === "Sky at a glance");
    expect(item).toEqual({ kind: "item", label: "Sky at a glance", action: { type: "skyGlance" } });
    expect(item).not.toHaveProperty("later");
  });

  it("turns Autotrack off when it is chosen while on", () => {
    const item = moduleMenu({ autotrack: true, choices, selected: null }).find((e) => e.kind === "check");
    expect(item).toMatchObject({ action: { type: "autotrack", on: false } });
  });
});
