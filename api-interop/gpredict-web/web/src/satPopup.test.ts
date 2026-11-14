import { describe, expect, it } from "vitest";
import { outline } from "./menuSpec";
import { popupChange, satPopup } from "./satPopup";
import type { PopupSat } from "./satPopup";
import type { ModuleConfig } from "./types";

const lists = (over: Partial<Pick<ModuleConfig, "footprint_off" | "ground_track" | "sky_track">> = {}) => ({
  footprint_off: [],
  ground_track: [],
  sky_track: [],
  ...over,
});
const sat = (over: Partial<PopupSat> = {}): PopupSat => ({ norad: 25544, name: "ISS", el: -10, dir: "↑", ...over });

describe("satPopup (ref §4-§8, spec §8.2)", () => {
  it("List: Satellite info, then Show next pass and Future passes while the satellite is below the horizon (the pass items work since sub-project 2)", () => {
    expect(outline(satPopup("list", sat(), lists()))).toEqual([
      "Satellite info",
      "-",
      "Show next pass",
      "Future passes",
    ]);
  });

  it("List: Show current pass comes first while El > 0", () => {
    expect(outline(satPopup("list", sat({ el: 12.5 }), lists()))).toEqual([
      "Satellite info",
      "-",
      "Show current pass",
      "Show next pass",
      "Future passes",
    ]);
  });

  it("has no Show current pass at El = 0 or without a value", () => {
    expect(outline(satPopup("list", sat({ el: 0 }), lists()))).not.toContain("Show current pass");
    expect(outline(satPopup("list", sat({ el: null }), lists()))).not.toContain("Show current pass");
  });

  it("pass items are enabled in every view", () => {
    const find = (menu: ReturnType<typeof satPopup>, label: string) => menu.find((e) => e.kind === "item" && e.label === label);
    for (const view of ["list", "map", "polar", "single", "event"] as const) {
      const below = satPopup(view, sat({ el: -10 }), lists());
      // enabled: an action and no `later`, so the menu does not grey them out
      expect(find(below, "Show next pass"), view).toEqual({ kind: "item", label: "Show next pass", action: { type: "pass", kind: "next" } });
      expect(find(below, "Future passes"), view).toEqual({ kind: "item", label: "Future passes", action: { type: "pass", kind: "future" } });
      expect(find(below, "Show current pass"), view).toBeUndefined();
      const above = satPopup(view, sat({ el: 0.1 }), lists());
      expect(find(above, "Show current pass"), view).toEqual({ kind: "item", label: "Show current pass", action: { type: "pass", kind: "current" } });
      expect(find(above, "Show next pass"), view).toBeDefined();
      expect(find(above, "Future passes"), view).toBeDefined();
    }
  });

  it("Map: adds Highlight footprint (checked unless the satellite is in footprint_off) and Ground Track (checked if in ground_track)", () => {
    expect(outline(satPopup("map", sat(), lists()))).toEqual([
      "Satellite info",
      "-",
      "Show next pass",
      "Future passes",
      "-",
      "[x] Highlight footprint",
      "[ ] Ground Track",
    ]);
    const other = outline(satPopup("map", sat(), lists({ footprint_off: [25544], ground_track: [25544] })));
    expect(other.slice(-2)).toEqual(["[ ] Highlight footprint", "[x] Ground Track"]);
    // other satellites' settings do not matter
    const elsewhere = outline(satPopup("map", sat(), lists({ footprint_off: [1], ground_track: [1] })));
    expect(elsewhere.slice(-2)).toEqual(["[x] Highlight footprint", "[ ] Ground Track"]);
  });

  it("Polar: adds Sky track (checked if in sky_track)", () => {
    expect(outline(satPopup("polar", sat(), lists())).slice(-2)).toEqual(["-", "[ ] Sky track"]);
    expect(outline(satPopup("polar", sat(), lists({ sky_track: [25544] }))).slice(-1)).toEqual(["[x] Sky track"]);
  });

  it("Polar: Sky track is disabled for a GEO satellite", () => {
    const items = satPopup("polar", sat({ dir: "G" }), lists({ sky_track: [25544] }));
    expect(outline(items).slice(-1)).toEqual(["[x] Sky track (disabled)"]);
  });

  it("Single sat and Event list: the satellite name in bold takes the place of Satellite info", () => {
    for (const view of ["single", "event"] as const) {
      expect(outline(satPopup(view, sat({ name: "OSCAR 7" }), lists()))).toEqual([
        "OSCAR 7 (bold)",
        "-",
        "Show next pass",
        "Future passes",
      ]);
    }
  });

  it("popup items enabled: Satellite info and the bold satellite name have the action satInfo, and are not greyed out", () => {
    for (const view of ["list", "map", "polar"] as const) {
      const first = satPopup(view, sat(), lists())[0];
      expect(first, view).toEqual({ kind: "item", label: "Satellite info", action: { type: "satInfo" } });
    }
    for (const view of ["single", "event"] as const) {
      const first = satPopup(view, sat({ name: "OSCAR 7" }), lists())[0];
      expect(first, view).toEqual({ kind: "item", label: "OSCAR 7", bold: true, action: { type: "satInfo" } });
    }
  });

  it("gives the three check items the action that sets them the other way round", () => {
    const checks = (view: "map" | "polar", s: PopupSat, l = lists()) =>
      satPopup(view, s, l).flatMap((e) => (e.kind === "check" ? [[e.label, e.action]] : []));
    expect(checks("map", sat(), lists())).toEqual([
      ["Highlight footprint", { type: "footprint", on: false }],
      ["Ground Track", { type: "groundTrack", on: true }],
    ]);
    expect(checks("map", sat(), lists({ footprint_off: [25544], ground_track: [25544] }))).toEqual([
      ["Highlight footprint", { type: "footprint", on: true }],
      ["Ground Track", { type: "groundTrack", on: false }],
    ]);
    expect(checks("polar", sat(), lists())).toEqual([["Sky track", { type: "skyTrack", on: true }]]);
  });
});

describe("popupChange", () => {
  const base = {
    name: "m",
    satellites: [1, 2, 3],
    footprint_off: [2],
    ground_track: [1],
    sky_track: [],
  } as unknown as ModuleConfig;

  it("switches the footprint of a satellite off by adding it to footprint_off, and on by removing it", () => {
    expect(popupChange({ type: "footprint", on: false }, 1)(base).footprint_off).toEqual([2, 1]);
    expect(popupChange({ type: "footprint", on: true }, 2)(base).footprint_off).toEqual([]);
  });

  it("switches Ground Track and Sky track on by adding the satellite, and off by removing it", () => {
    expect(popupChange({ type: "groundTrack", on: true }, 3)(base).ground_track).toEqual([1, 3]);
    expect(popupChange({ type: "groundTrack", on: false }, 1)(base).ground_track).toEqual([]);
    expect(popupChange({ type: "skyTrack", on: true }, 2)(base).sky_track).toEqual([2]);
  });

  it("is idempotent, so it can be applied again to another base: no duplicates", () => {
    const once = popupChange({ type: "groundTrack", on: true }, 3)(base);
    expect(popupChange({ type: "groundTrack", on: true }, 3)(once).ground_track).toEqual([1, 3]);
    expect(popupChange({ type: "groundTrack", on: false }, 9)(base).ground_track).toEqual([1]);
  });

  it("leaves the rest of the configuration, and the configuration itself when nothing changes", () => {
    const next = popupChange({ type: "skyTrack", on: true }, 1)(base);
    expect(next).toEqual({ ...base, sky_track: [1] });
    expect(popupChange({ type: "skyTrack", on: false }, 1)(base)).toBe(base);
  });

  it("does not add a satellite that has left the module meanwhile (the server refuses lists with strangers)", () => {
    expect(popupChange({ type: "groundTrack", on: true }, 99)(base)).toBe(base);
  });
});
