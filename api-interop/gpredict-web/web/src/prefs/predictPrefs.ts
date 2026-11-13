// The four pages of Preferences → Predict (ref-P §9, sat-pref-predict.c): their labels, ranges, units, tooltips and layouts, copied
// letter for letter from Gpredict. Pure: PredictPages.tsx shows them. The keys are the server's (server/gpredict_web/prefs.py).

export type PredictPageId = "conditions" | "multi" | "single" | "sky";

/** The notebook's tabs, in Gpredict's order (`sat-pref-predict.c:54-65`). */
export const PREDICT_TABS: readonly { id: PredictPageId; label: string }[] = [
  { id: "conditions", label: "Pass Conditions" },
  { id: "multi", label: "Multiple Passes" },
  { id: "single", label: "Single Pass" },
  { id: "sky", label: "Sky at a Glance" },
];

/** The tooltip of the Reset button, the same on all four tabs. */
export const RESET_TIP = "Reset settings to the default values.";

// ---------------------------------------------------------------- Pass Conditions (ref-P §9.1)

interface FieldBase {
  key: string;
  label: string;
  tooltip: string;
  /** a bold header ("<b>Multiple Passes:</b>") that stands above this row */
  header?: string;
  /** a horizontal separator stands above this row (and above its header) */
  separated: boolean;
}

/** A spin button: integers, `unit` is the label after it ("[deg]") or null for none. */
export interface SpinField extends FieldBase {
  kind: "spin";
  min: number;
  max: number;
  step: number;
  unit: string | null;
}

export interface CheckField extends FieldBase {
  kind: "check";
}

export type ConditionField = SpinField | CheckField;

/** The rows of the page in Gpredict's order (`sat-pref-conditions.c:160-330`); the separators and headers are the `separated` and `header` of the row below them. */
export const CONDITION_FIELDS: readonly ConditionField[] = [
  {
    kind: "spin",
    key: "PREDICT/MINIMUM_ELEV",
    label: "Minimum elevation",
    min: 1,
    max: 90,
    step: 1,
    unit: "[deg]",
    tooltip: "Elevation threshold for passes.\nPasses with maximum elevation below this limit will be omitted",
    separated: false,
  },
  {
    kind: "spin",
    key: "PREDICT/NUMBER_OF_PASSES",
    label: "Number of passes to predict",
    min: 5,
    max: 50,
    step: 1,
    unit: null,
    tooltip: "The maximum number of passes to predict.",
    header: "Multiple Passes:",
    separated: true,
  },
  {
    kind: "spin",
    key: "PREDICT/LOOK_AHEAD",
    label: "Passes should occur within",
    min: 1,
    max: 14,
    step: 1,
    unit: "[days]",
    tooltip: "Only passes that occur within the specified number of days will be shown.",
    separated: false,
  },
  {
    kind: "spin",
    key: "PREDICT/TIME_RESOLUTION",
    label: "Time resolution",
    min: 1,
    max: 600,
    step: 1,
    unit: "[sec]",
    tooltip: "Gpredict will try to show the pass details with the specified time resolution.",
    header: "Pass Details:",
    separated: true,
  },
  {
    kind: "spin",
    key: "PREDICT/NUMBER_OF_ENTRIES",
    label: "Number of entries",
    min: 10,
    max: 200,
    step: 1,
    unit: null,
    tooltip: "Gpredict will try to keep the number of rows in the detailed prediction within this limit.",
    separated: false,
  },
  {
    kind: "spin",
    key: "PREDICT/TWILIGHT_THRESHOLD",
    label: "Twilight threshold",
    min: -18,
    max: 0,
    step: 1,
    unit: "[deg]",
    tooltip:
      "Satellites are only considered visible if the elevation of the Sun is below the specified threshold.\n" +
      "  • Astronomical: -18° to -12°\n" +
      "  • Nautical: -12° to -6°\n" +
      "  • Civil: -6° to 0°",
    header: "Satellite Visibility:",
    separated: true,
  },
  {
    kind: "check",
    key: "PREDICT/USE_REAL_T0",
    label: "Always use real time for pass predictions",
    tooltip:
      "Check this box if you want Gpredict to always use the current (real) time as starting time when predicting future satellite passes.\n\n" +
      "If you leave the box unchecked and the time controller is active, Gpredict will use the time from the time controller as starting time for predicting satellite passes.",
    separated: true,
  },
];

// ---------------------------------------------------------------- Multiple Passes and Single Pass (ref-P §9.2, §9.3)

/** A check box of a Visible Columns page: `name` is the column as the server stores it, `label` is Gpredict's Hint for it (ref-P §2.2, §3.2). */
export interface ColumnCheck {
  name: string;
  label: string;
}

/** In the fixed order of the columns of Upcoming passes (ref-P §3.2), which is the order the server keeps `PREDICT/MULTI_PASS_COL` in. */
export const MULTI_PASS_CHECKS: readonly ColumnCheck[] = [
  { name: "AOS", label: "Acquisition of signal (AOS)" },
  { name: "TCA", label: "Time of Closest Approach (TCA)" },
  { name: "LOS", label: "Loss of signal (LOS)" },
  { name: "Duration", label: "Duration of pass" },
  { name: "Max El", label: "Maximum elevation" },
  { name: "AOS Az", label: "Azimuth at AOS" },
  { name: "Max El Az", label: "Az at max. elevation" },
  { name: "LOS Az", label: "Azimuth at LOS" },
  { name: "Orbit", label: "Orbit number" },
  { name: "Vis", label: "Visibility during pass" },
];

/** In the fixed order of the columns of the Data tab of Pass details (ref-P §2.2), which is the order the server keeps `PREDICT/SINGLE_PASS_COL` in. */
export const SINGLE_PASS_CHECKS: readonly ColumnCheck[] = [
  { name: "Time", label: "Time" },
  { name: "Az", label: "Azimuth" },
  { name: "El", label: "Elevation" },
  { name: "Ra", label: "Right Ascension" },
  { name: "Dec", label: "Declination" },
  { name: "Range", label: "Slant Range" },
  { name: "Rate", label: "Range Rate" },
  { name: "Lat", label: "Latitude" },
  { name: "Lon", label: "Longitude" },
  { name: "SSP", label: "Sub-Satellite Point" },
  { name: "Footp", label: "Footprint" },
  { name: "Alt", label: "Altitude" },
  { name: "Vel", label: "Velocity" },
  { name: "Dop", label: "Doppler Shift @ 100MHz" },
  { name: "Loss", label: "Signal Loss @ 100MHz" },
  { name: "Del", label: "Signal Delay" },
  { name: "MA", label: "Mean Anomaly" },
  { name: "Phase", label: "Orbit Phase" },
  { name: "Vis", label: "Visibility" },
];

/** How many columns of check boxes each page has (`sat-pref-multi-pass.c:30`, `sat-pref-single-pass.c:30`). */
export const CHECK_COLUMNS = { multi: 2, single: 3 } as const;

/** `items` in rows of `columns`, filled row by row like Gpredict's grid; the last row may be shorter. */
export function checkRows<T>(items: readonly T[], columns: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += columns) rows.push(items.slice(i, i + columns));
  return rows;
}

/**
 * The columns after the box of `name` was ticked or cleared. They stay in the order of `order` (the fixed order of the columns)
 * whatever order the boxes were ticked in; a `name` that is not in `order` is left out.
 */
export function toggleColumn(cols: readonly string[], name: string, order: readonly string[]): string[] {
  return order.filter((c) => (c === name ? !cols.includes(name) : cols.includes(c)));
}

// ---------------------------------------------------------------- Sky at a Glance (ref-P §9.4)

/** The title of the colour chooser of button `n` (1 to 10): Select colour n. (Gpredict sets button 2's title on button 1; ours is right, spec §10.1.) */
export const colourChooserTitle = (n: number): string => `Select colour ${n}`;

/** The row "Find and show passes that occur within [spin] hours". */
export const SKY_HOURS = {
  key: "SKY_AT_GLANCE/TIME_SPAN_HOURS",
  label: "Find and show passes that occur within",
  unit: "hours",
  min: 1,
  max: 24,
  step: 1,
  tooltip: "The passes shown on the Sky at a Glance chart\nwill begin within this number of hours.",
} as const;

export interface SkyColour {
  key: string;
  /** the label left of the button; the space at its end is Gpredict's */
  label: string;
  tooltip: string;
  chooserTitle: string;
}

/** The ten colour buttons, Satellite 1: to Satellite 10:. The colours are stored as lowercase "#rrggbb". */
export const SKY_COLOURS: readonly SkyColour[] = Array.from({ length: 10 }, (_, i) => ({
  key: `SKY_AT_GLANCE/COLOUR_${String(i + 1).padStart(2, "0")}`,
  label: `Satellite ${i + 1}: `,
  tooltip: "Click to select a colour",
  chooserTitle: colourChooserTitle(i + 1),
}));

/** Five rows of two: Satellite 1 to 5 at the left, Satellite 6 to 10 at the right (`sat-pref-sky-at-glance.c`, rows 4 to 8). */
export const SKY_COLOUR_ROWS: readonly (readonly [SkyColour, SkyColour])[] = Array.from(
  { length: 5 },
  (_, r) => [SKY_COLOURS[r]!, SKY_COLOURS[r + 5]!] as const,
);

// ---------------------------------------------------------------- Reset

/** The keys the Reset button of each page puts back to their defaults (ref-P §9.1: Reset takes the page's own keys only). */
export const PAGE_KEYS: Record<PredictPageId, readonly string[]> = {
  conditions: CONDITION_FIELDS.map((f) => f.key),
  multi: ["PREDICT/MULTI_PASS_COL"],
  single: ["PREDICT/SINGLE_PASS_COL"],
  sky: [SKY_HOURS.key, ...SKY_COLOURS.map((c) => c.key)],
};
