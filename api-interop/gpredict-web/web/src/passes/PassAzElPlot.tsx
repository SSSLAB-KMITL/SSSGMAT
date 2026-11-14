import { useEffect, useMemo, useRef, useState } from "react";
import { useNumberFormat } from "../numfmt";
import { prepareCanvas, useElementSize } from "../views/canvasHooks";
import { azElMouseText, azElScene } from "./passAzEl";
import type { AzElScene } from "./passAzEl";
import { beginPlot, canvasPosition, fillText, strokePolyline, strokeSegments } from "./plotCommon";
import type { PassInfo } from "./types";

const HOLDER = { width: "100%", height: "100%", overflow: "hidden" } as const;

/**
 * Paints `scene` on `ctx` (whose canvas is round(width * dpr) x round(height * dpr)) in the order of Gpredict's on_draw
 * (ref-P §6.2): background, frame, tick marks, labels, legends, cursor text (`cursorText`, null for none), azimuth curve, elevation curve.
 */
export function drawAzElScene(ctx: CanvasRenderingContext2D, scene: AzElScene, dpr: number, cursorText: string | null): void {
  beginPlot(ctx, scene, dpr, scene.background);
  const { left, right, top, bottom } = scene.frame;
  ctx.strokeStyle = scene.frameColor;
  ctx.strokeRect(left, top, right - left, bottom - top);
  strokeSegments(ctx, scene.ticks, scene.frameColor);
  for (const mark of [...scene.xLabels, ...scene.azLabels, ...scene.elLabels, ...scene.legends, scene.xLegend]) fillText(ctx, mark);
  if (cursorText !== null) fillText(ctx, { ...scene.cursor, text: cursorText });
  strokePolyline(ctx, scene.azCurve, scene.azColor);
  strokePolyline(ctx, scene.elCurve, scene.elColor);
}

/**
 * The Az/El plot of one pass (Pass details, "Az/El" tab; ref-P §6): white, 300 x 300 px at least in Gpredict, here as big as its
 * parent (which must have a height). The mouse text `T: %s, AZ: %.0f°, EL: %.0f°` is shown while the pointer is strictly inside the
 * frame; as in Gpredict it stays where it was when the pointer leaves the plot, and goes when the pointer moves out of the frame
 * (ref-P §6.3). There are no clicks. The times are local, and the legend says "Local Time", with "Show local time instead of UTC".
 */
export function PassAzElPlot({ pass }: { pass: PassInfo }) {
  const holder = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const size = useElementSize(holder);
  const [cursorText, setCursorText] = useState<string | null>(null);
  const { local } = useNumberFormat();

  const scene = useMemo(() => azElScene(pass, { width: size.w, height: size.h }, local), [pass, size.w, size.h, local]);

  useEffect(() => {
    const target = prepareCanvas(canvas.current, size);
    if (target !== null) drawAzElScene(target.ctx, scene, target.dpr, cursorText);
  }, [size, scene, cursorText]);

  return (
    <div ref={holder} style={HOLDER}>
      <canvas
        ref={canvas}
        role="img"
        aria-label="Az/El"
        style={{ display: "block", width: size.w, height: size.h }}
        onMouseMove={(e) => {
          const { x, y } = canvasPosition(e.currentTarget, e);
          setCursorText(azElMouseText(x, y, pass, { width: size.w, height: size.h }, local));
        }}
      />
    </div>
  );
}
