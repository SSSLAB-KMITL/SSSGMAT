// Colours as Gpredict stores them (ref-D §11): one integer 0xRRGGBBAA, red in the top byte and alpha in the low byte, and the labels
// and tooltips of the colour buttons of the Map View and Polar View pages. Pure; ColourButton.tsx shows them.

import type { MapColours, PolarColours } from "./colors";

/** A colour as a colour input has it (`#rrggbb`) and its alpha, 0 (transparent) to 255 (opaque). */
export interface SplitRgba {
  hex: string;
  alpha: number;
}

const byte = (c: number, shift: number): string => ((c >>> shift) & 0xff).toString(16).padStart(2, "0");

/** The `#rrggbb` and the alpha of the colour `c` (0xRRGGBBAA). */
export function splitRgba(c: number): SplitRgba {
  return { hex: `#${byte(c, 24)}${byte(c, 16)}${byte(c, 8)}`, alpha: c & 0xff };
}

/**
 * The colour `0xRRGGBBAA` (always a positive number) of `hex` (`#rrggbb`, either case) and `alpha`, which is cut to a whole number
 * from 0 to 255 (Gpredict's chooser truncates its channels, `(uint)(x * 255)`, gpredict-utils.c:517-550).
 */
export function joinRgba(hex: string, alpha: number): number {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) throw new RangeError(`not a colour: ${hex}`);
  const a = Math.min(255, Math.max(0, Math.trunc(alpha)));
  return ((Number.parseInt(hex.slice(1), 16) << 8) | a) >>> 0;
}

/**
 * The background of the info texts of the map: the colour without its alpha, as `#rrggbb`. Gpredict builds it by `rgba2html` without
 * padding a byte below 0x10 to two digits (gpredict-utils.c:406-426), so Pango reads a shorter text; here every byte has two digits
 * (data design §11, ของเรา).
 */
export function infoBgHex(c: number): string {
  return splitRgba(c).hex;
}

// ---------------------------------------------------------------- the buttons of the pages

/** One colour button of a page: the name of the colour in `config.map.colours` or `config.polar.colours`, Gpredict's label and its tooltip. */
export interface ColourSpec<K extends string> {
  key: K;
  label: string;
  tooltip: string;
}

/** The colour buttons of the Map View page in the order of the grid, three to a row (sat-pref-map-view.c:1035-1268, ref-D §11). */
export const MAP_COLOUR_BUTTONS: readonly ColourSpec<keyof MapColours>[] = [
  { key: "groundStation", label: "Ground Station:", tooltip: "Select the ground station colour" },
  { key: "grid", label: "Grid:", tooltip: "Select the grid colour" },
  { key: "tick", label: "Tick Labels:", tooltip: "Select a colour for tick labels" },
  { key: "satellite", label: "Satellite:", tooltip: "Select the satellite colour" },
  { key: "selected", label: "Selected Sat.:", tooltip: "Select colour for selected satellites" },
  { key: "track", label: "Ground Track:", tooltip: "Select ground track colour" },
  { key: "footprint", label: "Footprint:", tooltip: "Select colour for satellite footprint area.\nHint: Make it transparent" },
  { key: "infoFg", label: "Info Text FG:", tooltip: "Select info text foreground colour" },
  { key: "infoBg", label: "Info Text BG:", tooltip: "Select info text background colour" },
  { key: "terminator", label: "Solar terminator:", tooltip: "Select solar terminator colour" },
  { key: "earthShadow", label: "Global shadow:", tooltip: "Select Earth shadow colour" },
];

/** The "Shadow:" row under them: the slider of the alpha of the shadow under the satellites, from "Transp." to "Opaque" (sat-pref-map-view.c:1292-1324). */
export const SHADOW_ROW = {
  label: "Shadow:",
  low: "Transp.",
  high: "Opaque",
  tooltip:
    "Shadow transparency under the satellite marker.\n\nThe shadow improves the visibility of the satellites where the colour of the background is light, e.g. the South Pole. Fully transparent is the same as no shadow.",
} as const;

/**
 * The colour buttons of the Polar View page in the order of the grid (sat-pref-polar-view.c:567-729, ref-D §12). The tooltip of
 * "Info Text:" is that of "Background:", as Gpredict's is (a copy and paste in its source).
 */
export const POLAR_COLOUR_BUTTONS: readonly ColourSpec<keyof PolarColours>[] = [
  { key: "background", label: "Background:", tooltip: "Click to select background colour" },
  { key: "axes", label: "Axes/Circles:", tooltip: "Click to select the axis colour" },
  { key: "tick", label: "Tick Labels:", tooltip: "Click to select the colour for tick labels" },
  { key: "satellite", label: "Satellite:", tooltip: "Click to select satellite colour" },
  { key: "selected", label: "Selected Sat.:", tooltip: "Click to select colour for selected satellites" },
  { key: "track", label: "Sky Track:", tooltip: "Click to select track colour" },
  { key: "info", label: "Info Text:", tooltip: "Click to select background colour" },
];
