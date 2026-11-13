// What the two plots of Pass details (Polar, Az/El; ref-P §5, §6) have in common: the shape of a scene, and the canvas calls that
// paint one. A scene is plain data (pixels, texts, colours as CSS strings) built by the pure functions of passPolar.ts and
// passAzEl.ts, which the tests read; the components only paint it.

import { cssRgba } from "../colors";
import { FONT } from "../views/canvasCommon";

/** Size of a plot in CSS px. */
export interface PlotSize {
  width: number;
  height: number;
}

/** A pixel, y downwards. */
export type Point = readonly [number, number];

/** A straight 1 px line. */
export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Where a text goes: the anchor point and how the text hangs on it (the `textAlign` and `textBaseline` to draw it with). */
export interface TextAnchor {
  x: number;
  y: number;
  align: "left" | "center" | "right";
  baseline: "top" | "middle" | "bottom";
  color: string;
}

export interface TextMark extends TextAnchor {
  text: string;
}

export const WHITE = cssRgba(0xffffffff);
export const BLACK = cssRgba(0x000000ff);

/** Gets `ctx` ready for a plot of `size` on a canvas of round(size * dpr) device pixels: clears it and paints the background. */
export function beginPlot(ctx: CanvasRenderingContext2D, size: PlotSize, dpr: number, background: string): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.font = FONT;
  ctx.lineWidth = 1;
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, size.width, size.height);
}

export function fillText(ctx: CanvasRenderingContext2D, mark: TextMark): void {
  ctx.fillStyle = mark.color;
  ctx.textAlign = mark.align;
  ctx.textBaseline = mark.baseline;
  ctx.fillText(mark.text, mark.x, mark.y);
}

/** All of `segments` in one stroke. */
export function strokeSegments(ctx: CanvasRenderingContext2D, segments: readonly Segment[], color: string): void {
  ctx.strokeStyle = color;
  ctx.beginPath();
  for (const s of segments) {
    ctx.moveTo(s.x1, s.y1);
    ctx.lineTo(s.x2, s.y2);
  }
  ctx.stroke();
}

/** A line through `points`; nothing for fewer than two. */
export function strokePolyline(ctx: CanvasRenderingContext2D, points: readonly Point[], color: string): void {
  if (points.length < 2) return;
  ctx.strokeStyle = color;
  ctx.beginPath();
  points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.stroke();
}

/** The position of a mouse event inside `canvas`, in CSS px. */
export function canvasPosition(canvas: HTMLCanvasElement, e: { clientX: number; clientY: number }): { x: number; y: number } {
  const box = canvas.getBoundingClientRect();
  return { x: e.clientX - box.left, y: e.clientY - box.top };
}
