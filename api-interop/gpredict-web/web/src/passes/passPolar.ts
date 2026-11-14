// The Polar plot of one pass (Pass details, "Polar" tab; ref-P §5, gtk-polar-plot.c), as plain data. `passPolarScene(null, ...)`
// is the axes and the labels with no pass: the Antenna Control window of sub-project 3 draws its rotor markers over that.
//
// Differences from the Polar View of the core (views/polarGeom.ts, which this reuses for every Az/El <-> pixel conversion):
// the circle is min(width, height) / 2 - 20 px (the View has 25), the background is always white, the satellite is not drawn
// (only its track, from AOS to LOS), the time labels are 5 and the cursor text has two spaces between AZ and EL.

import { cssRgba, POLAR_COLORS } from "../colors";
import type { PolarColours } from "../colors";
import { formatTime, fmtFixed } from "../format";
import { AXIS_EXTRA, azElToXY, cardinalLabels, type Orientation, orientationOf, xyToAzEl } from "../views/polarGeom";
import type { Point, PlotSize, Segment, TextAnchor, TextMark } from "./plotCommon";
import type { PassInfo } from "./types";

/** Space in px between the circle and the edge of the plot (`POLV_DEFAULT_MARGIN`, ref-P §5). */
export const PASS_POLAR_MARGIN = 20;

/** Number of time labels along the track (`TRACK_TICK_NUM` of gtk-polar-plot.h, ref-P §5.3): AOS and four more. The Polar View has 4. */
export const PASS_POLAR_TICKS = 5;

/** The circles at El 0, 30 and 60 degrees, as fractions of the radius (ref-P §5.1). */
const CIRCLES = [1, 0.6667, 0.333] as const;

/** The labels of a track are 5 px from their point, and every one but the first moved 5 px toward the centre of the plot before that (ref-P §5.3). */
const LABEL_GAP = 5;
const LABEL_SHIFT = 5;

/** The station name and the cursor text start this far outside the circle, sideways (`2 * POLV_LINE_EXTRA`). */
const TEXT_GAP = 2 * AXIS_EXTRA;

/** What `passPolarScene` gives: everything a drawing needs, in px of a plot of `width` x `height`. */
export interface PolarScene {
  width: number;
  height: number;
  /** centre and radius of the 0 degree circle: the markers of Antenna Control are placed with these */
  cx: number;
  cy: number;
  r: number;
  background: string;
  axesColor: string;
  /** the circles at El 0, 30 and 60 */
  circles: { x: number; y: number; r: number }[];
  /** the horizontal and the vertical line through the centre, 5 px longer than the circle */
  axes: Segment[];
  /** N, E, S, W, where the orientation puts them */
  cardinals: TextMark[];
  /** the name of the station; null when it is not to be shown */
  qth: TextMark | null;
  /** where the text under the pointer goes (bottom left); the text itself comes from `polarMouseText` */
  cursor: TextAnchor;
  /** the sky track, one point per sample; empty without a pass and for a pass of fewer than two samples */
  track: Point[];
  trackColor: string;
  /** the time labels beside the track, `%H:%M` */
  ticks: TextMark[];
}

/** Centre and radius of the circle in a plot of `size`. As Gpredict has them they are whole numbers (`guint`); the radius is not below 0. */
function geometry(size: PlotSize): { cx: number; cy: number; r: number } {
  return {
    cx: Math.floor(size.width / 2),
    cy: Math.floor(size.height / 2),
    r: Math.max(0, Math.floor(Math.min(size.width, size.height) / 2) - PASS_POLAR_MARGIN),
  };
}

/**
 * The sky track of `p` (ref-P §5.3): the first point is on the circle at the AOS azimuth and the last on the circle at the LOS
 * azimuth, replacing the first and last sample; every sample between uses its own Az and El. A sample that is not above the
 * horizon (El below 0, or no value) keeps the point before it, as Gpredict does.
 */
function skyTrack(p: PassInfo, cx: number, cy: number, r: number, orientation: Orientation): Point[] {
  const rows = p.rows;
  const n = rows.length;
  if (n < 2) return []; // Gpredict draws a track of 2 points and more
  const rim = (az: number | null, row: number) => azElToXY(az ?? rows[row]!.az ?? 0, 0, cx, cy, r, orientation);
  const track: Point[] = [rim(p.aos_az, 0)];
  let at: Point = track[0]!;
  for (let i = 1; i < n - 1; i++) {
    const { az, el } = rows[i]!;
    if (az !== null && el !== null && el >= 0) at = azElToXY(az, el, cx, cy, r, orientation);
    track.push(at);
  }
  track.push(rim(p.los_az, n - 1));
  return track;
}

/**
 * The time labels of `track` (ref-P §5.3): the first at AOS, then four more, at every `floor((samples - 2) / 4)` samples, using
 * that sample's time and point. The text is `%H:%M` whatever the Time format of Preferences, in local time when `local` (ref-D §2.1).
 * Gpredict divides by zero for fewer than 6 samples (UNVERIFIED in the reference); here the step is
 * 1 then, so every inner sample gets one. A label is vertically centred on its point; right of the centre of the plot its text
 * ends 5 px before the point, otherwise it starts 5 px after it.
 */
function timeLabels(p: PassInfo, track: readonly Point[], cx: number, local: boolean, colours: PolarColours): TextMark[] {
  const n = track.length;
  if (n < 2) return [];
  const color = cssRgba(colours.track); // the labels have the track colour
  const label = (iso: string, [x, y]: Point, first: boolean): TextMark => {
    const px = first ? x : x > cx ? x - LABEL_SHIFT : x + LABEL_SHIFT;
    const before = px > cx;
    return { text: formatTime(new Date(iso), "%H:%M", local), x: before ? px - LABEL_GAP : px + LABEL_GAP, y, align: before ? "right" : "left", baseline: "middle", color };
  };
  const labels = [label(p.aos, track[0]!, true)];
  const step = Math.max(1, Math.floor((n - 2) / (PASS_POLAR_TICKS - 1)));
  for (let i = step; i < n - 1 && labels.length < PASS_POLAR_TICKS; i += step) labels.push(label(p.rows[i]!.t, track[i]!, false));
  return labels;
}

/**
 * The Polar plot of `p` in a plot of `size` (ref-P §5). `orientation` is the Polar View's setting ("N/E/S/W", ...); `qthName` is
 * the station name drawn above the top left of the circle, null to leave it out (the "QTH Info" setting is off). `p` null gives
 * the circles, the axes and the letters only. `local` is "Show local time instead of UTC": the time labels are those of the machine's zone.
 * `colours` are those of Preferences → Modules → Polar View, not of any module (plan decision 15; the defaults when left out); the
 * background is white whatever its Background colour is.
 */
export function passPolarScene(
  p: PassInfo | null,
  size: PlotSize,
  orientation: string,
  qthName: string | null,
  local = false,
  colours: PolarColours = POLAR_COLORS,
): PolarScene {
  const o = orientationOf(orientation);
  const { cx, cy, r } = geometry(size);
  const info = cssRgba(colours.info);
  const track = p === null ? [] : skyTrack(p, cx, cy, r, o);
  return {
    width: size.width,
    height: size.height,
    cx,
    cy,
    r,
    background: cssRgba(0xffffffff), // always white, whatever the Polar View's background (ref-P §5.1)
    axesColor: cssRgba(colours.axes),
    circles: CIRCLES.map((f) => ({ x: cx, y: cy, r: f * r })),
    axes: [
      { x1: cx - r - AXIS_EXTRA, y1: cy, x2: cx + r + AXIS_EXTRA, y2: cy },
      { x1: cx, y1: cy - r - AXIS_EXTRA, x2: cx, y2: cy + r + AXIS_EXTRA },
    ],
    cardinals: cardinalLabels(cx, cy, r, o).map((l) => ({ ...l, color: cssRgba(colours.tick) })),
    qth: qthName ? { text: qthName, x: cx - r - TEXT_GAP, y: cy - r - AXIS_EXTRA, align: "left", baseline: "bottom", color: info } : null,
    cursor: { x: cx - r - TEXT_GAP, y: cy + r + AXIS_EXTRA, align: "left", baseline: "top", color: info },
    track,
    trackColor: cssRgba(colours.track),
    ticks: p === null ? [] : timeLabels(p, track, cx, local, colours),
  };
}

/**
 * The text for the pointer at (x, y) px (ref-P §5.4): "AZ: %.0f°  EL: %.0f°" (two spaces) for the Az and El under it, null on
 * or outside the circle (El 0 and below).
 */
export function polarMouseText(x: number, y: number, size: PlotSize, orientation: string): string | null {
  const { cx, cy, r } = geometry(size);
  const [az, el] = xyToAzEl(x, y, cx, cy, r, orientationOf(orientation));
  return el > 0 ? `AZ: ${fmtFixed(az, 0)}°  EL: ${fmtFixed(el, 0)}°` : null;
}
