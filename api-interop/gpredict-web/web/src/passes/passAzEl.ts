// The Az/El plot of one pass (Pass details, "Az/El" tab; ref-P §6, gtk-azel-plot.c), as plain data: azimuth in blue against the
// left scale, elevation in red against the right one, time along the bottom from AOS to LOS.

import { cssRgba } from "../colors";
import { fmtFixed, formatTime } from "../format";
import { BLACK, WHITE } from "./plotCommon";
import type { PlotSize, Point, Segment, TextAnchor, TextMark } from "./plotCommon";
import type { PassInfo } from "./types";

/** Space in px between the frame and each edge of the plot (`AZEL_X_MARGIN`, `AZEL_Y_MARGIN`, ref-P §6). */
export const AZEL_MARGIN = 40;

/** Tick marks and labels per side (`AZEL_PLOT_NUM_TICKS`, ref-P §6.2): at 1/6 ... 5/6 of the side. */
export const AZEL_TICKS = 5;

/** Length of a tick mark in px, drawn inward from the frame (`MARKER_SIZE`). */
const TICK_LENGTH = 5;

/** The curves have fixed colours, not the Polar View's (ref-P §6.2). */
export const AZ_COLOR = cssRgba(0x0000bfff);
export const EL_COLOR = cssRgba(0xbf0000ff);

/** The frame of the plot: x from `left` to `right`, y from `top` to `bottom` (Gpredict's x0, xmax, ymax and y0). */
export interface Frame {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface AzElScene {
  width: number;
  height: number;
  background: string;
  frame: Frame;
  frameColor: string;
  /** the tick marks, 5 on each side of the frame */
  ticks: Segment[];
  /** top of the left scale: 180, or 360 when a sample has an azimuth above 180 */
  maxAz: 180 | 360;
  /** HH:MM under the frame, Az in blue left of it, El in red right of it */
  xLabels: TextMark[];
  azLabels: TextMark[];
  elLabels: TextMark[];
  /** "Az" left of the top of the frame and "El" right of it */
  legends: TextMark[];
  /** "UTC", or "Local Time" when the times are local, under the frame */
  xLegend: TextMark;
  /** where the text under the pointer goes (top centre); the text itself comes from `azElMouseText` */
  cursor: TextAnchor;
  azColor: string;
  elColor: string;
  /** one point per sample with a value; empty for fewer than two */
  azCurve: Point[];
  elCurve: Point[];
}

/** The frame in a plot of `size`: 40 px from each edge (ref-P §6). */
export function azElFrame(size: PlotSize): Frame {
  return { left: AZEL_MARGIN, right: size.width - AZEL_MARGIN, top: AZEL_MARGIN, bottom: size.height - AZEL_MARGIN };
}

/** Top of the azimuth scale: 360 if any sample has an azimuth above 180, otherwise 180 (ref-P §6.1). The AOS and LOS azimuths do not count. */
function maxAzimuth(p: PassInfo): 180 | 360 {
  return p.rows.some((row) => row.az !== null && row.az > 180) ? 360 : 180;
}

/** The time `across` (0 at AOS, 1 at LOS) of the pass, in milliseconds. */
function timeAcross(p: PassInfo, across: number): number {
  const aos = Date.parse(p.aos);
  return aos + (Date.parse(p.los) - aos) * across;
}

/**
 * The curves (ref-P §6.2). X is linear in time from AOS (left edge) to LOS (right edge). The first and the last point of the
 * azimuth curve are moved to the left and the right edge, so that it spans the frame; the first and the last point of the
 * elevation curve are moved down to El 0 and keep their X, so it ends at the last sample, usually before LOS. The azimuth is
 * drawn as it is, with no wrap handling. Gpredict draws a curve of two points and more.
 */
function curves(p: PassInfo, f: Frame, maxAz: number): { az: Point[]; el: Point[] } {
  const aos = Date.parse(p.aos);
  const span = Date.parse(p.los) - aos;
  const height = f.bottom - f.top;
  // ours: a pass of no length gives no NaN
  const xAt = (iso: string) => (span > 0 ? f.left + ((Date.parse(iso) - aos) / span) * (f.right - f.left) : f.left);
  const az: Point[] = [];
  const el: Point[] = [];
  for (const row of p.rows) {
    if (row.az !== null) az.push([xAt(row.t), f.bottom - (row.az / maxAz) * height]);
    if (row.el !== null) el.push([xAt(row.t), f.bottom - (row.el / 90) * height]);
  }
  if (az.length >= 2) {
    az[0] = [f.left, az[0]![1]];
    az[az.length - 1] = [f.right, az[az.length - 1]![1]];
  }
  if (el.length >= 2) {
    el[0] = [el[0]![0], f.bottom];
    el[el.length - 1] = [el[el.length - 1]![0], f.bottom];
  }
  return { az: az.length >= 2 ? az : [], el: el.length >= 2 ? el : [] };
}

/** The 20 tick marks (ref-P §6.2): 5 on each side at 1/6 ... 5/6 of it, each 5 px long and drawn inward from the frame. */
function tickMarks(f: Frame, xstep: number, ystep: number): Segment[] {
  const ticks: Segment[] = [];
  for (let k = 1; k <= AZEL_TICKS; k++) {
    ticks.push({ x1: f.left + k * xstep, y1: f.bottom, x2: f.left + k * xstep, y2: f.bottom - TICK_LENGTH }); // bottom
    ticks.push({ x1: f.left + k * xstep, y1: f.top, x2: f.left + k * xstep, y2: f.top + TICK_LENGTH }); // top
    ticks.push({ x1: f.left, y1: f.bottom - k * ystep, x2: f.left + TICK_LENGTH, y2: f.bottom - k * ystep }); // left
    ticks.push({ x1: f.right, y1: f.bottom - k * ystep, x2: f.right - TICK_LENGTH, y2: f.bottom - k * ystep }); // right
  }
  return ticks;
}

/**
 * The Az/El plot of `p` in a plot of `size` (ref-P §6). The time labels are `%H:%M` and the legend "UTC"; with `local` ("Show local time
 * instead of UTC") they are local times of the machine and the legend is "Local Time" (ref-D §2.1).
 */
export function azElScene(p: PassInfo, size: PlotSize, local = false): AzElScene {
  const f = azElFrame(size);
  const maxAz = maxAzimuth(p);
  const xstep = (f.right - f.left) / (AZEL_TICKS + 1);
  const ystep = (f.bottom - f.top) / (AZEL_TICKS + 1);
  const [black, blue, red] = [BLACK, AZ_COLOR, EL_COLOR];
  const { az, el } = curves(p, f, maxAz);
  const ks = Array.from({ length: AZEL_TICKS }, (_, i) => i + 1);
  const centre = f.left + (f.right - f.left) / 2;
  return {
    width: size.width,
    height: size.height,
    background: WHITE,
    frame: f,
    frameColor: black,
    ticks: tickMarks(f, xstep, ystep),
    maxAz,
    // the time at k/6 of AOS to LOS, centred under the frame, 5 px below it
    xLabels: ks.map((k) => ({
      text: formatTime(new Date(timeAcross(p, k / (AZEL_TICKS + 1))), "%H:%M", local),
      x: f.left + k * xstep,
      y: f.bottom + 5,
      align: "center",
      baseline: "top",
      color: black,
    })),
    // maxaz/6 * k, right-aligned 5 px left of the frame, centred on the tick
    azLabels: ks.map((k) => ({ text: `${fmtFixed((maxAz / (AZEL_TICKS + 1)) * k, 0)}°`, x: f.left - 5, y: f.bottom - k * ystep, align: "right", baseline: "middle", color: blue })),
    // 90/6 * k, 5 px right of the frame
    elLabels: ks.map((k) => ({ text: `${fmtFixed((90 / (AZEL_TICKS + 1)) * k, 0)}°`, x: f.right + 5, y: f.bottom - k * ystep, align: "left", baseline: "middle", color: red })),
    legends: [
      { text: "Az", x: f.left - 7, y: f.top, align: "right", baseline: "top", color: blue },
      { text: "El", x: f.right + 7, y: f.top, align: "left", baseline: "top", color: red },
    ],
    xLegend: { text: local ? "Local Time" : "UTC", x: centre, y: size.height - 5, align: "center", baseline: "bottom", color: black },
    cursor: { x: centre, y: 5, align: "center", baseline: "top", color: black },
    azColor: blue,
    elColor: red,
    azCurve: az,
    elCurve: el,
  };
}

/**
 * The text for the pointer at (x, y) px (ref-P §6.3): "T: %s, AZ: %.0f°, EL: %.0f°" with the time as %H:%M:%S, for a pointer
 * strictly inside the frame, null otherwise. As in Gpredict the time comes from X and both Az and El from Y, on the left
 * and the right scale: nothing is read from the curves. The time is local when `local`, as the labels of `azElScene`.
 */
export function azElMouseText(x: number, y: number, p: PassInfo, size: PlotSize, local = false): string | null {
  const f = azElFrame(size);
  if (!(x > f.left && x < f.right && y > f.top && y < f.bottom)) return null;
  const up = (f.bottom - y) / (f.bottom - f.top);
  const time = formatTime(new Date(timeAcross(p, (x - f.left) / (f.right - f.left))), "%H:%M:%S", local);
  return `T: ${time}, AZ: ${fmtFixed(maxAzimuth(p) * up, 0)}°, EL: ${fmtFixed(90 * up, 0)}°`;
}
