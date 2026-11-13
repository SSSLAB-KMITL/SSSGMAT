// Geometry of the Polar view (ref §6). Pure functions, no DOM: the web never computes orbits, only how to draw them.
//
// Conventions: azimuth and elevation in degrees, a pixel is [x, y] with y downwards. The centre of the circle is the
// zenith (El 90) and the rim is the horizon (El 0): the distance from the centre is r * (90 - el) / 90.

import type { SatState } from "../types";

/** Space in px between the rim and the edge of the view (`POLV_DEFAULT_MARGIN`, ref §6: r = min(w, h)/2 - 25). */
export const POLAR_MARGIN = 25;

/** The axes run this far beyond the rim, and the letters N/E/S/W sit this far beyond the ends of the axes (`POLV_LINE_EXTRA`, ref §6). */
export const AXIS_EXTRA = 5;

/** Number of time labels along a sky track (`TRACK_TICK_NUM`, ref §6). */
export const TRACK_TICK_NUM = 4;

/** The four orientations of the Polar view, as the server names them (ref §6): the letters tell what is at top, right, bottom and left. */
export const POLAR_ORIENTATIONS = ["N/E/S/W", "N/W/S/E", "S/E/N/W", "S/W/N/E"] as const;
export type Orientation = (typeof POLAR_ORIENTATIONS)[number];

const DEG = Math.PI / 180;

/** Radius of the horizon circle in px for a view `w` x `h` px (ref §6). Not below 0 only for views of 50 px and more: callers clamp. */
export function polarRadius(w: number, h: number): number {
  return Math.min(w, h) / 2 - POLAR_MARGIN;
}

/** The angle, clockwise from straight up, at which azimuth `az` is drawn. An unknown orientation is the default N/E/S/W. */
function screenAngle(az: number, orientation: Orientation): number {
  switch (orientation) {
    case "N/W/S/E":
      return 360 - az;
    case "S/E/N/W":
      return 180 - az;
    case "S/W/N/E":
      return 180 + az;
    default:
      return az;
  }
}

/** The azimuth drawn at screen angle `theta` (clockwise from straight up): the inverse of `screenAngle`, in [0, 360). */
function azimuthAt(theta: number, orientation: Orientation): number {
  let az: number;
  switch (orientation) {
    case "N/W/S/E":
      az = 360 - theta;
      break;
    case "S/E/N/W":
      az = 180 - theta;
      break;
    case "S/W/N/E":
      az = theta - 180;
      break;
    default:
      az = theta;
  }
  return ((az % 360) + 360) % 360;
}

/** Pixel of (az, el) on a polar plot centred on (cx, cy) with horizon radius `r`. Callers draw only El >= 0 (a negative El lands outside the rim). */
export function azElToXY(az: number, el: number, cx: number, cy: number, r: number, orientation: Orientation): [number, number] {
  const rel = (r * (90 - el)) / 90;
  const a = screenAngle(az, orientation) * DEG;
  return [cx + rel * Math.sin(a), cy - rel * Math.cos(a)];
}

/** The inverse of `azElToXY`: [az, el] under pixel (x, y), az in [0, 360); El is negative outside the rim (ref §6: the cursor text needs El > 0). */
export function xyToAzEl(x: number, y: number, cx: number, cy: number, r: number, orientation: Orientation): [number, number] {
  const [dx, dy] = [x - cx, y - cy];
  const el = r > 0 ? (90 * (r - Math.hypot(dx, dy))) / r : -90;
  const theta = (((Math.atan2(dx, cy - y) / DEG) % 360) + 360) % 360; // `cy - y` as Gpredict has it: `-dy` is -0 at the centre, and atan2(0, -0) is 180 degrees
  return [azimuthAt(theta, orientation), el];
}

export interface CardinalLabel {
  text: "N" | "E" | "S" | "W";
  /** the anchor of the text in px */
  x: number;
  y: number;
  /** `textAlign` and `textBaseline` to draw it with */
  align: "left" | "center" | "right";
  baseline: "top" | "middle" | "bottom";
}

/**
 * The letters N, E, S, W (ref §6): each sits just beyond the end of its axis (5 px past the rim and the extra 5 px of the
 * axis), where the orientation draws that direction. N and S are centred on the axis, above or below its end; E and W are
 * centred on the axis vertically, to the left or right of its end.
 */
export function cardinalLabels(cx: number, cy: number, r: number, orientation: Orientation): CardinalLabel[] {
  const flipsVertical = orientation === "S/E/N/W" || orientation === "S/W/N/E";
  const flipsHorizontal = orientation === "N/W/S/E" || orientation === "S/W/N/E";
  const label = (text: CardinalLabel["text"], az: number): CardinalLabel => {
    const [x, y] = azElToXY(az, 0, cx, cy, r, orientation);
    if (text === "N" || text === "S") {
      // the end of the N axis is at the top unless the orientation turns the plot upside down
      const below = text === "N" ? flipsVertical : !flipsVertical;
      return { text, x, y: below ? y + AXIS_EXTRA : y - AXIS_EXTRA, align: "center", baseline: below ? "top" : "bottom" };
    }
    const toLeft = text === "E" ? flipsHorizontal : !flipsHorizontal;
    return { text, x: toLeft ? x - AXIS_EXTRA : x + AXIS_EXTRA, y, align: toLeft ? "right" : "left", baseline: "middle" };
  };
  return [label("N", 0), label("E", 90), label("S", 180), label("W", 270)];
}

/**
 * The points of a sky track that get a time label (ref §6: 4 labels, the first at AOS, the others evenly spaced by index).
 * As in Gpredict the step is floor((n - 2) / 3) points for a track of n points, and the last point (LOS) gets none; a track
 * too short for four labels gets fewer, and an empty one none.
 */
export function trackTicks<T>(points: readonly T[]): T[] {
  const n = points.length;
  if (n === 0) return [];
  const ticks = [points[0]!];
  const step = n > 2 ? Math.floor((n - 2) / (TRACK_TICK_NUM - 1)) : 1;
  if (step === 0) return ticks;
  for (let k = 1; k < TRACK_TICK_NUM; k++) {
    const i = k * step;
    if (i > n - 2) break;
    ticks.push(points[i]!);
  }
  return ticks;
}

/**
 * Top-left corner of the time label (`tw` x `th` px) of the tick at pixel (x, y) of a plot centred at `cx`: the label goes
 * beside the point, towards the centre of the plot (to the left of a point right of the centre, to the right of one left of
 * it), vertically centred on it. Gpredict moves every tick but the first 5 px sideways before it does that, which is kept.
 */
export function tickLabelPos(x: number, y: number, cx: number, tw: number, th: number, first: boolean): { x: number; y: number } {
  const px = first ? x : x > cx ? x - 5 : x + 5;
  return { x: px > cx ? px - tw - 5 : px + 5, y: y - th / 2 };
}

/** The satellites the Polar view draws: El >= 0, not decayed, with a position (ref §6). */
export function visibleSats(sats: readonly SatState[]): SatState[] {
  return sats.filter((s) => s.dir !== "D" && s.az !== null && s.el !== null && s.el >= 0);
}
