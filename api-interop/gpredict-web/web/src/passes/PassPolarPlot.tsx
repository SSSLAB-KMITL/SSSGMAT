import { useEffect, useMemo, useRef, useState } from "react";
import { useNumberFormat } from "../numfmt";
import { useGlobalPolar } from "../prefs/globalPolar";
import { prepareCanvas, useElementSize } from "../views/canvasHooks";
import { POLAR_ORIENTATIONS } from "../views/polarGeom";
import { passPolarScene, polarMouseText } from "./passPolar";
import type { PolarScene } from "./passPolar";
import { beginPlot, canvasPosition, fillText, strokePolyline, strokeSegments } from "./plotCommon";
import type { PassInfo } from "./types";

const HOLDER = { width: "100%", height: "100%", overflow: "hidden" } as const;

/**
 * Paints `scene` on `ctx` (whose canvas is round(width * dpr) x round(height * dpr)) in the order of Gpredict's on_draw
 * (ref-P §5.1): background, circles, axes, N/E/S/W, station name, cursor text (`cursorText`, null for none), sky track, time labels.
 * Antenna Control (sub-project 3) paints its markers over this (PassPolarPlot's `overlay`).
 */
export function drawPolarScene(ctx: CanvasRenderingContext2D, scene: PolarScene, dpr: number, cursorText: string | null): void {
  beginPlot(ctx, scene, dpr, scene.background);
  ctx.strokeStyle = scene.axesColor;
  for (const c of scene.circles) {
    if (c.r <= 0) continue; // a plot under 40 px has no circle left
    ctx.beginPath();
    ctx.arc(c.x, c.y, c.r, 0, 2 * Math.PI);
    ctx.stroke();
  }
  strokeSegments(ctx, scene.axes, scene.axesColor);
  for (const mark of scene.cardinals) fillText(ctx, mark);
  if (scene.qth !== null) fillText(ctx, scene.qth);
  if (cursorText !== null) fillText(ctx, { ...scene.cursor, text: cursorText });
  strokePolyline(ctx, scene.track, scene.trackColor);
  for (const mark of scene.ticks) fillText(ctx, mark);
}

export interface PassPolarPlotProps {
  /** the pass to draw; null draws the circles, the axes and the letters only */
  pass: PassInfo | null;
  /** the name of the station, drawn above the top left of the circle; null leaves it out (the "QTH Info" setting is off) */
  qthName: string | null;
  /** the orientation of Preferences → Modules → Polar View ("N/E/S/W", ...), which the caller reads (`useGlobalPolar`); N/E/S/W when left out */
  orientation?: string;
  /**
   * Paints over the plot once the scene is drawn (Antenna Control's markers). `scene` has the size of the plot and the centre and radius
   * of the circle; `ctx` is in CSS px. It must keep its identity while what it paints is the same (useCallback): the plot is redrawn when it changes.
   */
  overlay?: (ctx: CanvasRenderingContext2D, scene: PolarScene) => void;
}

/**
 * The Polar plot of one pass (Pass details, "Polar" tab; ref-P §5): white, 200 x 200 px at least in Gpredict, here as big as its
 * parent (which must have a height). The mouse text `AZ: %.0f°  EL: %.0f°` shows the Az and El under the pointer inside the
 * circle; as in Gpredict it stays where it was when the pointer leaves the plot, and goes when the pointer moves out of the
 * circle (ref-P §5.4). There are no clicks. The time labels of the track are local times with "Show local time instead of UTC".
 * The colours are those of Preferences → Modules → Polar View, not of any module's Polar view (plan decision 15).
 */
export function PassPolarPlot({ pass, qthName, orientation = POLAR_ORIENTATIONS[0], overlay }: PassPolarPlotProps) {
  const holder = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const size = useElementSize(holder);
  const [cursorText, setCursorText] = useState<string | null>(null);
  const { local } = useNumberFormat();
  const { colours } = useGlobalPolar();

  const scene = useMemo(
    () => passPolarScene(pass, { width: size.w, height: size.h }, orientation, qthName, local, colours),
    [pass, size.w, size.h, orientation, qthName, local, colours],
  );

  useEffect(() => {
    const target = prepareCanvas(canvas.current, size);
    if (target === null) return;
    drawPolarScene(target.ctx, scene, target.dpr, cursorText);
    overlay?.(target.ctx, scene);
  }, [size, scene, cursorText, overlay]);

  return (
    <div ref={holder} style={HOLDER}>
      <canvas
        ref={canvas}
        role="img"
        aria-label="Polar"
        style={{ display: "block", width: size.w, height: size.h }}
        onMouseMove={(e) => {
          const { x, y } = canvasPosition(e.currentTarget, e);
          setCursorText(polarMouseText(x, y, { width: size.w, height: size.h }, orientation));
        }}
      />
    </div>
  );
}
