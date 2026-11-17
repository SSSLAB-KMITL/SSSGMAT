// Sky at a glance (ref-P §7, gtk-sky-glance.c) as plain data: the size of the window, the picture of an answer of the server (bars,
// names, hour ticks, caption), the cursor, the hit test of a click and the rule for drawing the chart again. No DOM and no React:
// SkyGlanceWindow.tsx paints a scene and asks the server (skyGlanceFeed.ts). The positions are pixels of the canvas, y downwards.

import { cssRgba } from "../colors";
import { WHITE } from "./plotCommon";
import type { PlotSize, Segment, TextMark } from "./plotCommon";
import type { PassBody, SkyGlanceAnswer } from "./types";

/** Width of the window as it opens (`SKG_DEFAULT_WIDTH`). */
export const SKY_WIDTH = 600;
/** Height of a bar at the size the window opens with (`SKG_PIX_PER_SAT`). */
const PIX_PER_SAT = 10;
/** Space above the first row, between the rows and below the last (`SKG_MARGIN`). */
const MARGIN = 20;
/** Height of the dark footer with the hour ticks (`SKG_FOOTER`). */
const FOOTER = 50;
/** Width of the cursor line (`SKG_CURSOR_WIDTH`). */
const CURSOR_WIDTH = 0.5;

/** The chart is drawn again when the module time moves by more than this many days (about 60.5 s) since it was built (ref-P §7.7; plan Global Constraints). */
export const SKY_REDRAW_D = 7.0e-4;
/** ... or the ground station moves by more than this many km. */
export const SKY_MOVE_KM = 1;

/** What the window says instead of a chart when the module has no satellites (`gtk_sky_glance_new`, ref-P §7.1). */
export const NO_SATELLITES = "This module has no satellites!";

/** The title of the window (ref-P §7.1). */
export const skyTitle = (module: string): string => `The sky at a glance (${module})`;

/** (ของเรา) What the window says while GMAT computes the first drawing, the same words as the box of the pass requests. */
export const SKY_WAITING_TEXT = "กำลังคำนวณวงโคจรด้วย GMAT…";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
/** Gpredict starts the ticks 0.00069 day (about a minute) after the whole hour (`create_time_ticks`: "workaround for bug 1839140"). */
const TICK_OFFSET_MS = 0.00069 * DAY_MS;
/** The minor tick is this far from the major one (0.0208333 day, half an hour less a few milliseconds). */
const MINOR_OFFSET_MS = 0.0208333 * DAY_MS;
const MAJOR_TICK = 10;
const MINOR_TICK = 5;
/** The labels of the ticks are this far under the plot, and the caption this far above the bottom of the footer. */
const TICK_LABEL_Y = 12;
const CAPTION_BOTTOM = 5;
/** A satellite's name is this far from its first bar, and goes to the left of it when the bar starts further than this from the left edge. */
const NAME_GAP = 5;
const NAME_SIDE_X = 100;
/** The pass boxes are filled at this alpha (0xA0 of 0xFF); their border is opaque. */
const FILL_ALPHA = 0xa0;

const FOOTER_COLOR = cssRgba(0x000040ff); // cairo (0, 0, 0.25)
const CURSOR_COLOR = "rgba(0, 0, 0, 0.7)";

/**
 * The size the window opens with for a module of `n` satellites, counting those with no pass (ref-P §7.3): 600 wide and
 * n x 10 + (n + 1) x 20 high for the plot, and 50 for the footer.
 */
export function skyLayout(n: number): { width: 600; height: number } {
  return { width: SKY_WIDTH, height: n * PIX_PER_SAT + (n + 1) * MARGIN + FOOTER };
}

/** A pass box. `norad` and `aos` say which pass it is: they are what a click asks the server for. */
export interface SkyBar {
  norad: number;
  aos: string;
  los: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
  border: string;
}

/** An hour of the axis: where its tick is (`x`), the two ticks, and the label of the major one. */
export interface SkyHour {
  x: number;
  major: Segment;
  minor: Segment;
  label: TextMark;
}

/** What `skyScene` gives: everything a drawing needs. */
export interface SkyScene {
  /** the canvas: the plot and the footer under it */
  width: number;
  height: number;
  plotHeight: number;
  /** the pass boxes in the order of creation (satellite by satellite, pass by pass) */
  bars: SkyBar[];
  /** the name of each satellite that has a pass, beside its first bar */
  labels: TextMark[];
  /** the dark band under the plot */
  footer: { y: number; height: number; color: string };
  /** one for each hour of the axis, the first at the first whole hour at or after T0; the ones right of the plot are clipped by the canvas */
  hours: SkyHour[];
  /** "UTC", or "TIME" when the times are local */
  caption: TextMark;
  /** the text that stands instead of a chart (no satellites), null with a chart */
  message: string | null;
  /** the time axis: T0 in ms since 1970, and the length of the axis in ms */
  t0: number;
  span: number;
  /** the hour labels and the time under the pointer are in UTC (true) or in local time (false) */
  utc: boolean;
}

/** The colour of a satellite as 0xRRGGBB; the server only sends "#rrggbb" (a value that is not one is black). */
function rgbOf(colour: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(colour);
  return m === null ? 0 : parseInt(m[1]!, 16);
}

/** A colour 0xRRGGBB with an alpha, as a CSS colour. */
const withAlpha = (rgb: number, alpha: number): string => cssRgba(((rgb << 8) | alpha) >>> 0);

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** The hour of day of `ms` in UTC or in local time, two digits (`%H`). */
const hourText = (ms: number, utc: boolean): string => pad2(utc ? new Date(ms).getUTCHours() : new Date(ms).getHours());

/** `%H:%M` of `ms` in UTC or in local time. */
const clockText = (ms: number, utc: boolean): string => {
  const d = new Date(ms);
  return utc ? `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}` : `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

/**
 * The picture of an "ok" answer in a canvas of `size` (ref-P §7.3-§7.5). The plot is the canvas less the footer; the time axis runs
 * over its whole width from T0 to T0 + `hours`. Row k (counting the satellites that have passes) is at y = k x (pps + 20) + 20 and its
 * bars are pps high, where pps = (plot height - 20) / n - 20 in whole numbers and n counts every satellite, those with no pass too.
 * The name of a satellite is left of its first bar, ending 5 px before it, if the bar starts more than 100 px from the left edge, and
 * 5 px right of it otherwise. An answer with no satellites is the text `NO_SATELLITES` and nothing else but the footer.
 */
export function skyScene(a: SkyGlanceAnswer, size: PlotSize, utc: boolean): SkyScene {
  const width = size.width;
  const height = size.height;
  const plotHeight = Math.max(0, height - FOOTER);
  const t0 = Date.parse(a.t0);
  const span = a.hours * HOUR_MS;
  const toX = (ms: number): number => ((ms - t0) / span) * width;

  const n = a.sats.length;
  const pps = n === 0 ? 0 : Math.max(0, Math.floor((plotHeight - MARGIN) / n) - MARGIN); // whole numbers, as Gpredict's unsigned ones
  const bars: SkyBar[] = [];
  const labels: TextMark[] = [];
  let row = 0;
  for (const sat of a.sats) {
    const rgb = rgbOf(sat.colour);
    const border = withAlpha(rgb, 0xff);
    const fill = withAlpha(rgb, FILL_ALPHA);
    const y = row * (pps + MARGIN) + MARGIN;
    let first = true;
    for (const p of sat.passes) {
      const x = toX(Date.parse(p.aos));
      const w = toX(Date.parse(p.los)) - x;
      if (!Number.isFinite(x) || !Number.isFinite(w)) continue; // times we cannot read
      bars.push({ norad: sat.norad, aos: p.aos, los: p.los, x, y, w, h: pps, fill, border });
      if (first) {
        first = false;
        const left = x > NAME_SIDE_X;
        labels.push({ text: sat.name, x: left ? x - NAME_GAP : x + w + NAME_GAP, y: y + pps / 2, align: left ? "right" : "left", baseline: "middle", color: border });
      }
    }
    if (!first) row++;
  }

  const hours: SkyHour[] = [];
  if (n > 0) {
    let major = Math.ceil(t0 / HOUR_MS) * HOUR_MS + TICK_OFFSET_MS;
    const minorStep = major - t0 > MINOR_OFFSET_MS ? -MINOR_OFFSET_MS : MINOR_OFFSET_MS; // before the major tick, or after it when T0 is too near
    for (let i = 0; i < a.hours; i++, major += HOUR_MS) {
      const x = toX(major);
      const minorX = toX(major + minorStep);
      hours.push({
        x,
        major: { x1: x, y1: plotHeight, x2: x, y2: plotHeight + MAJOR_TICK },
        minor: { x1: minorX, y1: plotHeight, x2: minorX, y2: plotHeight + MINOR_TICK },
        label: { text: hourText(major, utc), x, y: plotHeight + TICK_LABEL_Y, align: "center", baseline: "top", color: WHITE },
      });
    }
  }

  return {
    width,
    height,
    plotHeight,
    bars,
    labels,
    footer: { y: plotHeight, height: FOOTER, color: FOOTER_COLOR },
    hours,
    caption: { text: utc ? "UTC" : "TIME", x: Math.floor(width / 2), y: height - CAPTION_BOTTOM, align: "center", baseline: "bottom", color: WHITE },
    message: n === 0 ? NO_SATELLITES : null,
    t0,
    span,
    utc,
  };
}

/** The time (ms since 1970) at pixel `x` of the plot. */
export const skyTimeAt = (scene: SkyScene, x: number): number => scene.t0 + (x / scene.width) * scene.span;

/** The cursor line and the time beside it. */
export interface SkyCursor {
  line: Segment;
  lineWidth: number;
  color: string;
  label: TextMark;
}

/**
 * The line that follows the pointer and the `%H:%M` of the time under it (ref-P §7.5): only while x is strictly inside the plot's
 * width. The label is 5 px right of the line at the top of the plot, or 5 px left of it when the line is past the middle; Gpredict
 * takes the middle as the whole-number half of the width.
 */
export function skyCursor(scene: SkyScene, x: number): SkyCursor | null {
  if (!(x > 0 && x < scene.width)) return null;
  const right = x > Math.floor(scene.width / 2);
  return {
    line: { x1: x, y1: 0, x2: x, y2: scene.plotHeight },
    lineWidth: CURSOR_WIDTH,
    color: CURSOR_COLOR,
    label: { text: clockText(skyTimeAt(scene, x), scene.utc), x: right ? x - 5 : x + 5, y: 0, align: right ? "right" : "left", baseline: "top", color: CURSOR_COLOR },
  };
}

/** The pass of a box: its satellite, AOS and LOS. */
export type SkyHit = Pick<SkyBar, "norad" | "aos" | "los">;

/** The pass whose box is at (x, y): the first in the order of creation, the edges of the box counting as in (ref-P §7.6). Null if there is none. */
export function hitPass(scene: SkyScene, x: number, y: number): SkyHit | null {
  const bar = scene.bars.find((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
  return bar === undefined ? null : { norad: bar.norad, aos: bar.aos, los: bar.los };
}

/**
 * The request that a click on the box of `hit` makes (Pass details of that pass, `t0` is the chart's). The LOS goes too, so the
 * server reads the days of AOS to LOS (spec §3.2), which the chart holds already, instead of a day either side of the AOS.
 */
export const skyPassBody = (hit: SkyHit, t0: string): PassBody => ({
  norad: hit.norad,
  kind: "at",
  t: t0,
  aos: hit.aos,
  los: hit.los,
});

// ---------------------------------------------------------------- drawing it again (ref-P §7.7)

/** The module time and the ground station at the time the chart was built. */
export interface SkyBuild {
  t: Date;
  lat: number;
  lon: number;
}

/** Gpredict's one degree of arc (`ARC_IN_KM` of locator.c), in km. */
const ARC_IN_KM = 111.2;

/** The distance in km between two points of the Earth as `qrb()` of Gpredict gives it: the short path, one degree of arc being 111.2 km. */
function distanceKm(a: SkyBuild, b: SkyBuild): number {
  const rad = Math.PI / 180;
  const lat1 = Math.max(Math.min(a.lat, 89.999999999), -89.999999999) * rad; // acos() of a pole
  const lat2 = Math.max(Math.min(b.lat, 89.999999999), -89.999999999) * rad;
  const cosArc = Math.sin(lat1) * Math.sin(lat2) + Math.cos(lat1) * Math.cos(lat2) * Math.cos((b.lon - a.lon) * rad);
  if (cosArc > 0.999999999999999) return 0; // the same place
  if (cosArc < -0.999999) return 180 * ARC_IN_KM; // opposite
  return ARC_IN_KM * (Math.acos(cosArc) / rad);
}

/**
 * Whether the module's tick `next` makes the chart built at `prev` out of date (`update_skg`, ref-P §7.7): the module time is more
 * than SKY_REDRAW_D days away from it, in either direction, or the ground station is more than SKY_MOVE_KM km away. A time that is
 * not a date never does.
 */
export function needsRedraw(prev: SkyBuild, next: SkyBuild): boolean {
  return Math.abs(next.t.getTime() - prev.t.getTime()) / DAY_MS > SKY_REDRAW_D || distanceKm(prev, next) > SKY_MOVE_KM;
}

// ---------------------------------------------------------------- the windows that are open (ref-P §7.1)

/**
 * The Sky at a glance windows of the page: module name -> how many times the menu item was chosen after the window opened (0 at
 * first). A module has one window; choosing the item again changes the number, which brings the window to the front.
 */
export type SkyOpen = ReadonlyMap<string, number>;

/** `open` with the window of `module` added, or its count raised if it is open already. */
export function openSky(open: SkyOpen, module: string): SkyOpen {
  const next = new Map(open);
  next.set(module, open.has(module) ? open.get(module)! + 1 : 0);
  return next;
}

/** `open` without the window of `module`; the same map if it is not there. */
export function closeSky(open: SkyOpen, module: string): SkyOpen {
  if (!open.has(module)) return open;
  const next = new Map(open);
  next.delete(module);
  return next;
}

/** `open` without the windows of the modules that are not in `modules` (not open any more); the same map when nothing goes. */
export function pruneSky(open: SkyOpen, modules: readonly string[]): SkyOpen {
  const gone = [...open.keys()].filter((m) => !modules.includes(m));
  if (gone.length === 0) return open;
  const next = new Map(open);
  for (const m of gone) next.delete(m);
  return next;
}
