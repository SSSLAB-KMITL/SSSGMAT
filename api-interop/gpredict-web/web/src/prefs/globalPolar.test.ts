import { describe, expect, it } from "vitest";
import { POLAR_COLORS } from "../colors";
import { DEFAULTS, META } from "../moduleDefaults.fixture";
import { propsOf, propsValue } from "../moduleProps";
import type { PrefValue } from "../types";
import { globalPolarOf } from "./globalPolar";

/** GET /api/prefs `values` at Gpredict's defaults for the keys of the Polar View page. */
const POLAR_DEFAULTS: Record<string, PrefValue> = (() => {
  const props = propsOf(DEFAULTS);
  const out: Record<string, PrefValue> = {};
  for (const [path, key] of Object.entries(META.module_keys.polar)) out[key] = propsValue(props, path) as PrefValue;
  return out;
})();

describe("globalPolarOf (plan decision 15: the polar plots of Pass details and Antenna Control use Preferences' values, not a module's)", () => {
  it("is Gpredict's defaults until the Preferences and the constants of the server have arrived", () => {
    const defaults = { orientation: "N/E/S/W", qthInfo: true, colours: POLAR_COLORS };
    expect(globalPolarOf(undefined, META)).toEqual(defaults);
    expect(globalPolarOf(POLAR_DEFAULTS, null)).toEqual(defaults);
    expect(globalPolarOf(undefined, null)).toEqual(defaults);
  });

  it("polar plots use the global MODULES/POLAR_* orientation, colours and QTH Info", () => {
    const values = {
      ...POLAR_DEFAULTS,
      "MODULES/POLAR_CHART_ORIENT": "S/W/N/E",
      "MODULES/POLAR_QTH_INFO": false,
      "MODULES/POLAR_AXIS_COLOUR": 0x11223344,
      "MODULES/POLAR_TICK_COLOUR": 0x01020304,
      "MODULES/POLAR_TRACK_COLOUR": 0xaabbccdd,
      "MODULES/POLAR_INFO_COLOUR": 0x55667788,
      "MODULES/POLAR_SAT_COLOUR": 0x99aabbcc,
    };
    expect(globalPolarOf(values, META)).toEqual({
      orientation: "S/W/N/E",
      qthInfo: false,
      colours: { ...POLAR_COLORS, axes: 0x11223344, tick: 0x01020304, track: 0xaabbccdd, info: 0x55667788, satellite: 0x99aabbcc },
    });
  });

  it("is the defaults for a key Preferences does not hold", () => {
    expect(globalPolarOf({ "MODULES/POLAR_CHART_ORIENT": "N/W/S/E" }, META)).toEqual({ orientation: "N/W/S/E", qthInfo: true, colours: POLAR_COLORS });
  });
});
