import { useEffect, useMemo, useRef, useState } from "react";
import { getSkyTrack } from "../api";
import type { ViewProps } from "../components/ModuleView";
import type { SatPos } from "./canvasCommon";
import { prepareCanvas, useCanvasMouse, useElementSize, useRefreshGate } from "./canvasHooks";
import { drawPolar } from "./polarDraw";
import type { SkyTrack } from "./polarDraw";
import { POLAR_ORIENTATIONS } from "./polarGeom";
import type { Orientation } from "./polarGeom";
import { planSkyFetches } from "./polarTracks";
import type { SkyRequest } from "./polarTracks";

/** The orientation of the module, N/E/S/W if the config holds something else. */
function orientationOf(name: string): Orientation {
  return (POLAR_ORIENTATIONS as readonly string[]).includes(name) ? (name as Orientation) : POLAR_ORIENTATIONS[0];
}

/**
 * The Polar view (ref §6, spec §8.5), drawn on a canvas that fills its cell.
 *
 * - It redraws from the tick only every `refresh.polar` ticks (the first tick at once); a selection, the mouse cursor, a
 *   resize and a fetched sky track redraw it from the tick it already shows. A tick that is not "ok" (computing, failed)
 *   leaves the last picture, and the next "ok" tick redraws at once.
 * - Only satellites with El >= 0 are drawn. Sky tracks come from GET /skytrack/{norad} for the satellites above the horizon
 *   that are in `config.sky_track` (all of them when `polar.auto_skytrack` is on), except GEO ones; a track is fetched again
 *   when the satellite's pass changes (its LOS) or the GMAT window changes. A failed request (404 at the horizon, no server,
 *   ...) is ignored, and a redraw 10 s or more later asks again.
 * - Left click within 10 px of a satellite selects it, or unselects it if it is the selected one (the double click of a
 *   double click does not toggle again); double click calls `onSatDoubleClick`; right click calls `onSatContextMenu`.
 *   The selection is the module's, shared with the Map and the List.
 * - "Extra Az Ticks" draws nothing: Gpredict 2.7 reads the setting and never draws it (ref §6).
 */
export function PolarView({ module, config, tick, selected, onSelect, onSatContextMenu, onSatDoubleClick }: ViewProps) {
  const holder = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const size = useElementSize(holder);
  const [tracks, setTracks] = useState<ReadonlyMap<number, SkyTrack>>(new Map());
  const hits = useRef<SatPos[]>([]);
  const requested = useRef(new Map<number, SkyRequest>()); // NORAD -> the last sky track request

  const orientation = orientationOf(config.polar.orientation);
  const contents = config.polar.contents;
  const cursorOn = contents["Cursor Position"] === true;
  const auto = config.polar.auto_skytrack;
  const skyEnabled = useMemo(() => new Set(config.sky_track), [config.sky_track]);

  // which ticks redraw: the first, then every refresh.polar-th "ok" tick
  const shown = useRefreshGate(tick, config.refresh.polar);
  const { cursor, handlers } = useCanvasMouse({ canvas, hits, trackCursor: cursorOn, selected, onSelect, onSatContextMenu, onSatDoubleClick });

  // sky tracks
  useEffect(() => {
    if (shown === null || shown.status !== "ok") return;
    const plan = planSkyFetches({
      enabled: config.sky_track,
      auto,
      sats: shown.sats ?? [],
      windowStart: shown.window.start,
      requested: requested.current,
      nowMs: Date.now(),
    });
    if (plan.drop.length > 0) {
      for (const norad of plan.drop) requested.current.delete(norad);
      setTracks((held) => {
        if (!plan.drop.some((norad) => held.has(norad))) return held;
        const next = new Map(held);
        for (const norad of plan.drop) next.delete(norad);
        return next;
      });
    }
    for (const { norad, key } of plan.fetch) {
      requested.current.set(norad, { key, failedAt: null });
      getSkyTrack(module, norad).then(
        (result) => {
          if (requested.current.get(norad)?.key === key) setTracks((held) => new Map(held).set(norad, { key, points: result.points }));
        },
        () => {
          // 404 below the horizon, no server, ...: no track, and a redraw 10 s or more later asks again
          if (requested.current.get(norad)?.key === key) requested.current.set(norad, { key, failedAt: Date.now() });
        },
      );
    }
  }, [module, config.sky_track, auto, shown]);

  // draw
  useEffect(() => {
    const target = prepareCanvas(canvas.current, size);
    if (target === null) return;
    const { ctx, dpr } = target;
    hits.current = drawPolar(ctx, {
      w: size.w,
      h: size.h,
      dpr,
      orientation,
      contents,
      tick: shown,
      selected,
      skyEnabled,
      auto,
      tracks,
      cursor,
    });
  }, [size, shown, tracks, selected, orientation, contents, cursor, skyEnabled, auto]);

  return (
    <div ref={holder} className="polar-view">
      <canvas
        ref={canvas}
        className="polar-canvas"
        role="img"
        aria-label="Polar"
        style={{ width: size.w, height: size.h }}
        {...handlers}
      />
    </div>
  );
}
