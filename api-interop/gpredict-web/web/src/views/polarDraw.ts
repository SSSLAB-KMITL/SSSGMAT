// Draws the Polar view on a canvas, in the order of Gpredict's on_draw (ref §6; spec §8.5):
//   1 background, 2 circles and axes, 3 N/E/S/W, 4 info texts, 5 each satellite (sky track with time labels, marker, name).
// All the geometry is in polarGeom.ts and the texts in polarText.ts; this file only paints.

import { cssRgba, POLAR_COLORS } from "../colors";
import { formatTime } from "../format";
import type { NumberFormat } from "../numfmt";
import type { SkyPoint, Tick } from "../types";
import { FONT, LINE_H, MARKER_HALF } from "./canvasCommon";
import type { SatPos } from "./canvasCommon";
import {
  AXIS_EXTRA,
  azElToXY,
  cardinalLabels,
  type Orientation,
  polarRadius,
  trackTicks,
  tickLabelPos,
  visibleSats,
  xyToAzEl,
} from "./polarGeom";
import { cursorText, nextEventText, selectedText } from "./polarText";
import { skyKey, skyTrackWanted } from "./polarTracks";

/** The sky track held for a satellite: the points of the server, and the key (window and pass) they were fetched for. */
export interface SkyTrack {
  key: string;
  points: readonly SkyPoint[];
}

/** Everything one drawing needs. Sizes are CSS px; `dpr` is the device pixel ratio of the canvas. */
export interface PolarScene {
  w: number;
  h: number;
  dpr: number;
  orientation: Orientation;
  contents: Readonly<Record<string, boolean>>;
  /** the tick being shown, null before the first one */
  tick: Tick | null;
  selected: number | null;
  /** satellites with "Sky track" on, and "Show the sky tracks automatically" */
  skyEnabled: ReadonlySet<number>;
  auto: boolean;
  tracks: ReadonlyMap<number, SkyTrack>;
  /** mouse position over the view, null when it is not there */
  cursor: { x: number; y: number } | null;
  /** the number format of Preferences: the time labels of a sky track (always `%H:%M`) are in UTC or local time by it (ref-D §2.1) */
  nf: NumberFormat;
}

/** Gap in px between the end of the axes and the info texts, each side: twice the extra length of the axes (`2 * POLV_LINE_EXTRA`). */
const TEXT_GAP = 2 * AXIS_EXTRA;

/** Paint `scene` on `ctx` (whose canvas is round(w*dpr) x round(h*dpr)). Returns the position of every satellite drawn. */
export function drawPolar(ctx: CanvasRenderingContext2D, scene: PolarScene): SatPos[] {
  const { w, h, dpr, orientation, contents, tick, selected } = scene;
  const on = (name: string) => contents[name] === true;
  const [cx, cy] = [w / 2, h / 2];
  const r = Math.max(0, polarRadius(w, h)); // a view under 50 px has no circle left

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.font = FONT;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";

  // 1: background
  ctx.fillStyle = cssRgba(POLAR_COLORS.background);
  ctx.fillRect(0, 0, w, h);

  // 2: circles at El 0, 30 and 60, and the axes, 5 px longer than the rim, in the axes colour
  ctx.strokeStyle = cssRgba(POLAR_COLORS.axes);
  ctx.lineWidth = 1;
  if (r > 0) {
    for (const radius of [r, 0.6667 * r, 0.333 * r]) {
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
      ctx.stroke();
    }
  }
  const reach = r + AXIS_EXTRA;
  strokeLine(ctx, cx - reach, cy, cx + reach, cy);
  strokeLine(ctx, cx, cy - reach, cx, cy + reach);

  // 3: N, E, S, W in the tick colour
  ctx.fillStyle = cssRgba(POLAR_COLORS.tick);
  for (const label of cardinalLabels(cx, cy, r, orientation)) {
    ctx.textAlign = label.align;
    ctx.textBaseline = label.baseline;
    ctx.fillText(label.text, label.x, label.y);
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "top";

  // 4: info texts in the info colour (Gpredict puts them at the corners of the circle, 10 px outside the axes)
  const nowMs = tick === null ? NaN : Date.parse(tick.t);
  const left = cx - r - TEXT_GAP;
  const right = cx + r + TEXT_GAP;
  ctx.fillStyle = cssRgba(POLAR_COLORS.info);
  if (on("QTH Info") && tick !== null) lines(ctx, tick.qth.name, left, cy - r - AXIS_EXTRA - LINE_H, "left", scene);
  if (on("Cursor Position") && scene.cursor !== null) {
    const [az, el] = xyToAzEl(scene.cursor.x, scene.cursor.y, cx, cy, r, orientation);
    const text = cursorText(az, el);
    if (text !== null) lines(ctx, text, left, cy + r + AXIS_EXTRA, "left", scene);
  }
  if (on("Next Event") && tick !== null) {
    const text = nextEventText(tick.sats ?? [], nowMs);
    lines(ctx, text, right, cy - r - AXIS_EXTRA - (LINE_H * text.split("\n").length) / 2, "right", scene);
  }
  const shownSats = tick === null ? [] : visibleSats(tick.sats ?? []);
  if (selected !== null) {
    const text = selectedText(shownSats.find((s) => s.norad === selected), nowMs);
    if (text !== null) lines(ctx, text, right, cy + r + AXIS_EXTRA, "right", scene);
  }

  // 5: satellites with El >= 0, the selected one last so that it is on top
  const hits: SatPos[] = [];
  if (tick === null) return hits;
  const ordered = [...shownSats.filter((s) => s.norad !== selected), ...shownSats.filter((s) => s.norad === selected)];
  for (const sat of ordered) {
    const [x, y] = azElToXY(sat.az as number, sat.el as number, cx, cy, r, orientation);
    hits.push({ norad: sat.norad, x, y });
    const colour = cssRgba(sat.norad === selected ? POLAR_COLORS.selected : POLAR_COLORS.satellite);

    // sky track: 1 px, track colour, from AOS to LOS of the current pass, with 4 time labels and no AOS/LOS labels
    const track = scene.tracks.get(sat.norad);
    if (track !== undefined && skyTrackWanted(sat, scene.skyEnabled, scene.auto) && track.key === skyKey(tick.window.start, sat)) {
      drawSkyTrack(ctx, track.points, cx, cy, r, orientation, scene.nf.local);
    }

    if (on("Satellite Marker")) {
      ctx.fillStyle = colour;
      ctx.fillRect(Math.round(x) - MARKER_HALF, Math.round(y) - MARKER_HALF, 2 * MARKER_HALF, 2 * MARKER_HALF);
    }
    if (on("Satellite Name")) {
      ctx.fillStyle = colour;
      ctx.fillText(sat.name, x - ctx.measureText(sat.name).width / 2, y + 2);
    }
  }
  return hits;
}

function drawSkyTrack(
  ctx: CanvasRenderingContext2D,
  points: readonly SkyPoint[],
  cx: number,
  cy: number,
  r: number,
  orientation: Orientation,
  local: boolean,
): void {
  const pixels = points
    .filter((p) => Number.isFinite(p.az) && Number.isFinite(p.el))
    .map((p) => ({ t: p.t, xy: azElToXY(p.az, Math.max(0, p.el), cx, cy, r, orientation) })); // El 0 is the rim: a point cannot be outside it
  if (pixels.length === 0) return;
  ctx.strokeStyle = cssRgba(POLAR_COLORS.track);
  ctx.fillStyle = cssRgba(POLAR_COLORS.track);
  ctx.lineWidth = 1;
  ctx.beginPath();
  pixels.forEach(({ xy: [x, y] }, i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.stroke();
  trackTicks(pixels).forEach(({ t, xy: [x, y] }, i) => {
    const text = formatTime(new Date(t), "%H:%M", local);
    const p = tickLabelPos(x, y, cx, ctx.measureText(text).width, LINE_H, i === 0);
    ctx.fillText(text, p.x, p.y);
  });
}

/** `text` (one or more lines) with its top-left (or top-right, `side` "right") corner at (x, y), moved to stay inside the view. */
function lines(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, side: "left" | "right", scene: PolarScene): void {
  const rows = text.split("\n");
  const top = Math.max(0, Math.min(y, scene.h - LINE_H * rows.length));
  ctx.textAlign = side;
  const edge = side === "left" ? Math.max(0, x) : Math.min(scene.w, x);
  rows.forEach((row, i) => ctx.fillText(row, edge, top + i * LINE_H));
  ctx.textAlign = "left";
}

function strokeLine(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number): void {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}
