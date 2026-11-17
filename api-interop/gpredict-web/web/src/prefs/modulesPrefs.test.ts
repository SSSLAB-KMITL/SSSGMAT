import { describe, expect, it } from "vitest";
import { DEFAULTS, META } from "../moduleDefaults.fixture";
import { pagePaths, propsOf, propsValue, PROPS_TABS } from "../moduleProps";
import type { PrefsAnswer, PrefValue } from "../types";
import {
  GLOBAL_RESET_TIP,
  globalProps,
  pageKeys,
  propsToPrefs,
  resetPage,
  setPage,
  WINDOW_PLACEMENTS,
} from "./modulesPrefs";
import { draftToRequest, draftValue, resetInDraft, setInDraft } from "./prefsDraft";
import type { Draft } from "./prefsDraft";

/** Every key of Preferences → Modules at Gpredict's default, as GET /api/prefs answers before anyone has set one. */
const PREF_DEFAULTS: Record<string, PrefValue> = (() => {
  const props = propsOf(DEFAULTS);
  const out: Record<string, PrefValue> = { "MODULES/EVENT_LIST_REFRESH": 1 };
  for (const page of Object.values(META.module_keys)) {
    for (const [path, key] of Object.entries(page)) {
      const v = propsValue(props, path);
      if (v !== undefined) out[key] = v as PrefValue;
    }
  }
  for (const key of META.global_layout_extra) out[key] = false;
  return out;
})();

/** The window's draft as a page sees it (PrefsPageApi's value/set/reset over prefsDraft.ts), and the PUT /api/prefs that OK would send. */
function prefsWindow(answer: PrefsAnswer) {
  let draft: Draft = new Map();
  const api = {
    value: <T extends PrefValue>(key: string) => draftValue(answer, draft, key) as T,
    set: (key: string, v: PrefValue) => void (draft = setInDraft(draft, key, v)),
    reset: (keys: readonly string[]) => void (draft = resetInDraft(draft, keys)),
  };
  return { api, draft: () => draft, request: () => draftToRequest(answer, draft) };
}

const atDefaults = (): PrefsAnswer => ({ values: { ...PREF_DEFAULTS }, defaults: { ...PREF_DEFAULTS }, user: [] });

describe("globalProps (the properties as Preferences → Modules holds them)", () => {
  it("global props come from prefs", () => {
    const values = {
      ...PREF_DEFAULTS,
      "MODULES/MAP_TRACK_NUM": 5,
      "MODULES/GRID": "1;0;2;0;1",
      "MODULES/DATA_TIMEOUT": 1000,
      "MODULES/LIST_COLUMNS": ["Satellite", "El"],
      "MODULES/MAP_SHOW_GRID": false,
      "MODULES/MAP_FILE": "earth_800.png",
      "MODULES/MAP_TERMINATOR_COLOUR": 0x11223344,
      "MODULES/POLAR_CHART_ORIENT": "S/W/N/E",
      "MODULES/POLAR_INFO_COLOUR": 0x55667788,
      "MODULES/SINGLE_SAT_FIELDS": ["Azimuth"],
    };
    const p = globalProps(values, META);
    expect(p.map.track_orbits).toBe(5);
    expect(p.layout_code).toBe("1;0;2;0;1");
    expect(p.refresh.data_ms).toBe(1000);
    expect(p.list_columns).toEqual(["Satellite", "El"]);
    expect(p.map.contents["Grid Lines"]).toBe(false);
    expect(p.map.file).toBe("earth_800.png");
    expect(p.map.colours.terminator).toBe(0x11223344);
    expect(p.polar.orientation).toBe("S/W/N/E");
    expect(p.polar.colours.info).toBe(0x55667788);
    expect(p.single_fields).toEqual(["Azimuth"]);
  });

  it("are Gpredict's defaults when every key is at its default, and for a key the answer does not have", () => {
    expect(globalProps(PREF_DEFAULTS, META)).toEqual(propsOf(DEFAULTS));
    expect(globalProps({}, META)).toEqual(propsOf(DEFAULTS));
  });

  it("copies: changing them never changes the values they were read from", () => {
    const values = { ...PREF_DEFAULTS, "MODULES/LIST_COLUMNS": ["Satellite"] };
    globalProps(values, META).list_columns.push("Az");
    expect(values["MODULES/LIST_COLUMNS"]).toEqual(["Satellite"]);
  });
});

describe("propsToPrefs and pageKeys (the keys of a page of the Modules group)", () => {
  it("are the key of every path of the page, with the value of the properties", () => {
    const p = propsOf(DEFAULTS);
    p.polar.orientation = "N/W/S/E";
    const polar = propsToPrefs(p, "polar", META);
    expect(Object.keys(polar)).toEqual(Object.values(META.module_keys.polar));
    expect(polar["MODULES/POLAR_CHART_ORIENT"]).toBe("N/W/S/E");
    expect(polar["MODULES/POLAR_BGD_COLOUR"]).toBe(0xffffffff);
    expect(propsToPrefs(p, "single", META)).toEqual({ "MODULES/SINGLE_SAT_FIELDS": DEFAULTS.single.fields });
  });

  it("Refresh Rates has the five rates that have a control, not the event list's (sat-pref-refresh.c:109-119)", () => {
    expect(Object.keys(propsToPrefs(propsOf(DEFAULTS), "refresh", META))).toEqual([
      "MODULES/DATA_TIMEOUT",
      "MODULES/LIST_REFRESH",
      "MODULES/MAP_REFRESH",
      "MODULES/POLAR_REFRESH",
      "MODULES/SINGLE_SAT_REFRESH",
    ]);
  });

  it("Layout also has the three Window Placements boxes (sat-pref-layout.c:101-129)", () => {
    expect(pageKeys("layout", META)).toEqual(["MODULES/GRID", ...META.global_layout_extra]);
    expect(pageKeys("map", META)).toEqual(Object.values(META.module_keys.map));
    for (const t of PROPS_TABS) expect(pageKeys(t.id, META).length, t.id).toBeGreaterThanOrEqual(pagePaths(t.id, META).length);
  });
});

describe("the Modules group's changes in the window's draft", () => {
  it("global OK writes page keys or removes them", () => {
    // a change of the Polar View page sets every key of the page (Gpredict writes all of a dirty page, ref-D §10)
    const w = prefsWindow(atDefaults());
    const p = globalProps(PREF_DEFAULTS, META);
    p.polar.orientation = "S/W/N/E";
    setPage(w.api, p, "polar", META);
    expect([...w.draft().keys()]).toEqual(Object.values(META.module_keys.polar));
    expect(w.draft().get("MODULES/POLAR_CHART_ORIENT")).toBe("S/W/N/E");
    expect(w.request()).toEqual({ set: { "MODULES/POLAR_CHART_ORIENT": "S/W/N/E" }, remove: [] }); // the server is sent what differs

    // Reset of the Map View page removes every key of the page, the solar terminator and global shadow colours too (spec §11)
    const mapKeys = Object.values(META.module_keys.map);
    const userSet: PrefsAnswer = {
      values: { ...PREF_DEFAULTS, "MODULES/MAP_TRACK_NUM": 5, "MODULES/MAP_TERMINATOR_COLOUR": 1, "MODULES/MAP_EARTH_SHADOW_COLOUR": 2 },
      defaults: { ...PREF_DEFAULTS },
      user: mapKeys,
    };
    const r = prefsWindow(userSet);
    resetPage(r.api, "map", META);
    expect(r.request().set).toEqual({});
    expect(r.request().remove).toEqual(mapKeys);
    expect(r.request().remove).toContain("MODULES/MAP_TERMINATOR_COLOUR");
    expect(r.request().remove).toContain("MODULES/MAP_EARTH_SHADOW_COLOUR");
    // and the page shows the defaults
    expect(globalProps(Object.fromEntries(mapKeys.map((k) => [k, r.api.value(k)])), META).map).toEqual(DEFAULTS.map);
  });

  it("an edit after Reset writes the page as it is shown: the defaults with the edit", () => {
    const answer: PrefsAnswer = {
      values: { ...PREF_DEFAULTS, "MODULES/MAP_TRACK_NUM": 5, "MODULES/MAP_CENTER": 90 },
      defaults: { ...PREF_DEFAULTS },
      user: ["MODULES/MAP_TRACK_NUM", "MODULES/MAP_CENTER"],
    };
    const w = prefsWindow(answer);
    resetPage(w.api, "map", META);
    const shown = globalProps(Object.fromEntries(pageKeys("map", META).map((k) => [k, w.api.value(k)])), META);
    shown.map.center_lon = -30;
    setPage(w.api, shown, "map", META);
    expect(w.request()).toEqual({ set: { "MODULES/MAP_TRACK_NUM": 3, "MODULES/MAP_CENTER": -30 }, remove: [] });
  });

  it("Layout: a change writes the Window Placements too, and Reset resets the three boxes with the layout", () => {
    const answer: PrefsAnswer = {
      values: { ...PREF_DEFAULTS, "GLOBAL/MOD_STATE": true },
      defaults: { ...PREF_DEFAULTS },
      user: ["GLOBAL/MOD_STATE"],
    };
    const w = prefsWindow(answer);
    const p = globalProps(PREF_DEFAULTS, META);
    p.layout_code = "1;0;2;0;1";
    setPage(w.api, p, "layout", META);
    expect([...w.draft().keys()]).toEqual(["MODULES/GRID", ...META.global_layout_extra]);
    expect(w.draft().get("GLOBAL/MOD_STATE")).toBe(true); // as it was
    const r = prefsWindow(answer);
    resetPage(r.api, "layout", META);
    expect(r.request()).toEqual({ set: {}, remove: ["GLOBAL/MOD_STATE"] });
    expect(r.api.value("GLOBAL/MOD_STATE")).toBe(false);
  });
});

describe("texts of the Modules group (ref-D §10)", () => {
  it("Reset's tooltip in global mode; the Map View page has its own wording", () => {
    for (const t of PROPS_TABS) {
      expect(GLOBAL_RESET_TIP[t.id], t.id).toBe(t.id === "map" ? "Reset settings to default values" : "Reset settings to the default values.");
    }
  });

  it("the Window Placements boxes: label, tooltip and key, in Gpredict's order", () => {
    expect(WINDOW_PLACEMENTS.map((w) => w.key)).toEqual(META.global_layout_extra);
    expect(WINDOW_PLACEMENTS).toEqual([
      {
        key: "GLOBAL/MAIN_WIN_POS",
        label: "Restore position of main window",
        tooltip:
          "If you check this button, gpredict will try to place the main window at the position it was during the last session.\nNote that window managers can ignore this request.",
      },
      {
        key: "GLOBAL/MOD_WIN_POS",
        label: "Restore position of module windows",
        tooltip:
          "If you check this button, gpredict will try to place the module windows at the position they were the last time.\nNote that window managers can ignore this request.",
      },
      {
        key: "GLOBAL/MOD_STATE",
        label: "Restore the state of modules when reopened (docked or window)",
        tooltip: "If you check this button, gpredict will restore the states of the modules from the last time they were used.",
      },
    ]);
  });
});
