import { describe, expect, it } from "vitest";
import {
  CHECK_COLUMNS,
  checkRows,
  colourChooserTitle,
  CONDITION_FIELDS,
  MULTI_PASS_CHECKS,
  PAGE_KEYS,
  PREDICT_TABS,
  RESET_TIP,
  SINGLE_PASS_CHECKS,
  SKY_COLOUR_ROWS,
  SKY_COLOURS,
  SKY_HOURS,
  toggleColumn,
} from "./predictPrefs";

const SINGLE = SINGLE_PASS_CHECKS.map((c) => c.name);
const MULTI = MULTI_PASS_CHECKS.map((c) => c.name);

describe("PREDICT_TABS (ref-P §9)", () => {
  it("tab labels are Gpredict's", () => {
    expect(PREDICT_TABS.map((t) => t.label)).toEqual(["Pass Conditions", "Multiple Passes", "Single Pass", "Sky at a Glance"]);
    expect(PREDICT_TABS.map((t) => t.id)).toEqual(["conditions", "multi", "single", "sky"]);
  });

  it("the Reset button of every tab has Gpredict's tooltip", () => {
    expect(RESET_TIP).toBe("Reset settings to the default values.");
  });
});

describe("CONDITION_FIELDS (ref-P §9.1)", () => {
  it("condition fields match ref-P §9.1", () => {
    const spins = CONDITION_FIELDS.filter((f) => f.kind === "spin");
    expect(spins.map((f) => [f.key, f.label, f.min, f.max, f.step, f.unit, f.tooltip])).toEqual([
      [
        "PREDICT/MINIMUM_ELEV",
        "Minimum elevation",
        1,
        90,
        1,
        "[deg]",
        "Elevation threshold for passes.\nPasses with maximum elevation below this limit will be omitted",
      ],
      ["PREDICT/NUMBER_OF_PASSES", "Number of passes to predict", 5, 50, 1, null, "The maximum number of passes to predict."],
      [
        "PREDICT/LOOK_AHEAD",
        "Passes should occur within",
        1,
        14,
        1,
        "[days]",
        "Only passes that occur within the specified number of days will be shown.",
      ],
      [
        "PREDICT/TIME_RESOLUTION",
        "Time resolution",
        1,
        600,
        1,
        "[sec]",
        "Gpredict will try to show the pass details with the specified time resolution.",
      ],
      [
        "PREDICT/NUMBER_OF_ENTRIES",
        "Number of entries",
        10,
        200,
        1,
        null,
        "Gpredict will try to keep the number of rows in the detailed prediction within this limit.",
      ],
      [
        "PREDICT/TWILIGHT_THRESHOLD",
        "Twilight threshold",
        -18,
        0,
        1,
        "[deg]",
        "Satellites are only considered visible if the elevation of the Sun is below the specified threshold.\n" +
          "  • Astronomical: -18° to -12°\n" +
          "  • Nautical: -12° to -6°\n" +
          "  • Civil: -6° to 0°",
      ],
    ]);
    const check = CONDITION_FIELDS.filter((f) => f.kind === "check");
    expect(check.map((f) => [f.key, f.label, f.tooltip])).toEqual([
      [
        "PREDICT/USE_REAL_T0",
        "Always use real time for pass predictions",
        "Check this box if you want Gpredict to always use the current (real) time as starting time when predicting future satellite passes.\n\n" +
          "If you leave the box unchecked and the time controller is active, Gpredict will use the time from the time controller as starting time for predicting satellite passes.",
      ],
    ]);
  });

  it("is in Gpredict's row order, under the headers Multiple Passes:, Pass Details: and Satellite Visibility:", () => {
    expect(CONDITION_FIELDS.map((f) => [f.label, f.header ?? null, f.separated])).toEqual([
      ["Minimum elevation", null, false],
      ["Number of passes to predict", "Multiple Passes:", true],
      ["Passes should occur within", null, false],
      ["Time resolution", "Pass Details:", true],
      ["Number of entries", null, false],
      ["Twilight threshold", "Satellite Visibility:", true],
      ["Always use real time for pass predictions", null, true],
    ]);
  });
});

describe("the Visible Columns pages (ref-P §9.2, §9.3)", () => {
  it("Multiple Passes: the hints of ref-P §3.2 are the labels, in 2 columns filled row by row", () => {
    expect(MULTI).toEqual(["AOS", "TCA", "LOS", "Duration", "Max El", "AOS Az", "Max El Az", "LOS Az", "Orbit", "Vis"]);
    expect(CHECK_COLUMNS.multi).toBe(2);
    expect(checkRows(MULTI_PASS_CHECKS, CHECK_COLUMNS.multi).map((row) => row.map((c) => c.label))).toEqual([
      ["Acquisition of signal (AOS)", "Time of Closest Approach (TCA)"],
      ["Loss of signal (LOS)", "Duration of pass"],
      ["Maximum elevation", "Azimuth at AOS"],
      ["Az at max. elevation", "Azimuth at LOS"],
      ["Orbit number", "Visibility during pass"],
    ]);
  });

  it("single pass layout is 3 columns of 19", () => {
    expect(SINGLE_PASS_CHECKS).toHaveLength(19);
    expect(CHECK_COLUMNS.single).toBe(3);
    const rows = checkRows(SINGLE_PASS_CHECKS, CHECK_COLUMNS.single).map((row) => row.map((c) => c.label));
    expect(rows[0]).toEqual(["Time", "Azimuth", "Elevation"]);
    expect(rows).toEqual([
      ["Time", "Azimuth", "Elevation"],
      ["Right Ascension", "Declination", "Slant Range"],
      ["Range Rate", "Latitude", "Longitude"],
      ["Sub-Satellite Point", "Footprint", "Altitude"],
      ["Velocity", "Doppler Shift @ 100MHz", "Signal Loss @ 100MHz"],
      ["Signal Delay", "Mean Anomaly", "Orbit Phase"],
      ["Visibility"],
    ]);
  });

  it("the columns are the names the server stores, in its fixed order", () => {
    expect(SINGLE).toEqual([
      "Time", "Az", "El", "Ra", "Dec", "Range", "Rate", "Lat", "Lon", "SSP",
      "Footp", "Alt", "Vel", "Dop", "Loss", "Del", "MA", "Phase", "Vis",
    ]); // prettier-ignore
  });
});

describe("toggleColumn", () => {
  it("toggleColumn keeps fixed order", () => {
    expect(toggleColumn(["Time", "El"], "Az", SINGLE)).toEqual(["Time", "Az", "El"]);
    expect(toggleColumn(["Time", "Az", "El"], "El", SINGLE)).toEqual(["Time", "Az"]);
  });

  it("whatever order the boxes were ticked in", () => {
    let cols: string[] = [];
    for (const name of ["Vis", "Time", "MA", "Az"]) cols = toggleColumn(cols, name, SINGLE);
    expect(cols).toEqual(["Time", "Az", "MA", "Vis"]);
  });

  it("works the same for the Multiple Passes columns, and leaves a name that is not a column out", () => {
    expect(toggleColumn(["AOS", "LOS", "Duration"], "TCA", MULTI)).toEqual(["AOS", "TCA", "LOS", "Duration"]);
    expect(toggleColumn(["AOS"], "Nonsense", MULTI)).toEqual(["AOS"]);
  });

  it("does not change what it was given", () => {
    const cols = ["Time", "El"];
    toggleColumn(cols, "Az", SINGLE);
    expect(cols).toEqual(["Time", "El"]);
  });
});

describe("Sky at a Glance (ref-P §9.4)", () => {
  it("has the hours spin of Gpredict", () => {
    expect(SKY_HOURS).toEqual({
      key: "SKY_AT_GLANCE/TIME_SPAN_HOURS",
      label: "Find and show passes that occur within",
      unit: "hours",
      min: 1,
      max: 24,
      step: 1,
      tooltip: "The passes shown on the Sky at a Glance chart\nwill begin within this number of hours.",
    });
  });

  it("has ten colour buttons, labelled Satellite 1: to Satellite 10:, with Gpredict's tooltip", () => {
    expect(SKY_COLOURS.map((c) => [c.key, c.label])).toEqual(
      Array.from({ length: 10 }, (_, i) => [`SKY_AT_GLANCE/COLOUR_${String(i + 1).padStart(2, "0")}`, `Satellite ${i + 1}: `]),
    );
    for (const c of SKY_COLOURS) expect(c.tooltip).toBe("Click to select a colour");
  });

  it("is laid out as two columns of five: Satellite 1 to 5 at the left, 6 to 10 at the right", () => {
    expect(SKY_COLOUR_ROWS.map((row) => row.map((c) => c.label))).toEqual([
      ["Satellite 1: ", "Satellite 6: "],
      ["Satellite 2: ", "Satellite 7: "],
      ["Satellite 3: ", "Satellite 8: "],
      ["Satellite 4: ", "Satellite 9: "],
      ["Satellite 5: ", "Satellite 10: "],
    ]);
  });

  it("the chooser of button N is titled Select colour N (Gpredict swaps buttons 1 and 2, spec §10.1)", () => {
    expect(SKY_COLOURS.map((c) => c.chooserTitle)).toEqual(Array.from({ length: 10 }, (_, i) => `Select colour ${i + 1}`));
    expect(colourChooserTitle(1)).toBe("Select colour 1");
    expect(colourChooserTitle(2)).toBe("Select colour 2");
    expect(colourChooserTitle(10)).toBe("Select colour 10");
  });
});

describe("PAGE_KEYS: what the Reset button of each tab puts back", () => {
  it("reset keys per page", () => {
    expect(PAGE_KEYS.sky).toEqual([
      "SKY_AT_GLANCE/TIME_SPAN_HOURS",
      ...Array.from({ length: 10 }, (_, i) => `SKY_AT_GLANCE/COLOUR_${String(i + 1).padStart(2, "0")}`),
    ]);
    expect(PAGE_KEYS.conditions).toEqual([
      "PREDICT/MINIMUM_ELEV",
      "PREDICT/NUMBER_OF_PASSES",
      "PREDICT/LOOK_AHEAD",
      "PREDICT/TIME_RESOLUTION",
      "PREDICT/NUMBER_OF_ENTRIES",
      "PREDICT/TWILIGHT_THRESHOLD",
      "PREDICT/USE_REAL_T0",
    ]);
    expect(PAGE_KEYS.multi).toEqual(["PREDICT/MULTI_PASS_COL"]);
    expect(PAGE_KEYS.single).toEqual(["PREDICT/SINGLE_PASS_COL"]);
  });

  it("no key is on two pages, and every tab has keys", () => {
    const all = Object.values(PAGE_KEYS).flat();
    expect(new Set(all).size).toBe(all.length);
    expect(Object.keys(PAGE_KEYS)).toEqual(PREDICT_TABS.map((t) => t.id));
  });
});
