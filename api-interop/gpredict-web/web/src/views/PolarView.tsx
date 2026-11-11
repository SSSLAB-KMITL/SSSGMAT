import { useEffect, useMemo, useRef, useState } from "react";
import { getSkyTrack } from "../api";
import type { ViewProps } from "../components/ModuleView";
import type { Tick } from "../types";
import { hitTest, isRefreshTick } from "./mapGeom";
import { drawPolar } from "./polarDraw";
import type { PolarHit, SkyTrack } from "./polarDraw";
import { POLAR_ORIENTATIONS } from "./polarGeom";
import type { Orientation } from "./polarGeom";
import { planSkyFetches } from "./polarTracks";
import type { SkyRequest } from "./polarTracks";

interface Size {
  w: number;
  h: number;
}

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
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  const [shown, setShown] = useState<Tick | null>(null);
  const [tracks, setTracks] = useState<ReadonlyMap<number, SkyTrack>>(new Map());
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const hits = useRef<PolarHit[]>([]);
  const requested = useRef(new Map<number, SkyRequest>()); // NORAD -> the last sky track request
  const tickCount = useRef(0);
  const lastTick = useRef<Tick | null>(null);

  const orientation = orientationOf(config.polar.orientation);
  const contents = config.polar.contents;
  const cursorOn = contents["Cursor Position"] === true;
  const auto = config.polar.auto_skytrack;
  const skyEnabled = useMemo(() => new Set(config.sky_track), [config.sky_track]);

  // the size of the cell
  useEffect(() => {
    const el = holder.current;
    if (el === null) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ w: Math.floor(entry.contentRect.width), h: Math.floor(entry.contentRect.height) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // which ticks redraw: the first, then every refresh.polar-th "ok" tick
  useEffect(() => {
    if (tick === null || tick === lastTick.current) return; // (StrictMode runs effects twice)
    lastTick.current = tick;
    if (tick.status !== "ok") {
      tickCount.current = 0; // the next ok tick draws at once
      return;
    }
    if (isRefreshTick(tickCount.current, config.refresh.polar)) setShown(tick);
    tickCount.current += 1;
  }, [tick, config.refresh.polar]);

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
    const el = canvas.current;
    if (el === null || size.w === 0 || size.h === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const [dw, dh] = [Math.round(size.w * dpr), Math.round(size.h * dpr)];
    if (el.width !== dw) el.width = dw;
    if (el.height !== dh) el.height = dh;
    const ctx = el.getContext("2d");
    if (ctx === null) return;
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
      cursor: cursorOn ? cursor : null,
    });
  }, [size, shown, tracks, selected, orientation, contents, cursor, cursorOn, skyEnabled, auto]);

  // mouse
  const frame = useRef(0);
  const pending = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const position = (e: { clientX: number; clientY: number }) => {
    const box = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - box.left, y: e.clientY - box.top };
  };

  return (
    <div ref={holder} className="polar-view">
      <canvas
        ref={canvas}
        className="polar-canvas"
        role="img"
        aria-label="Polar"
        style={{ width: size.w, height: size.h }}
        onMouseMove={(e) => {
          if (!cursorOn) return;
          pending.current = position(e);
          if (frame.current === 0) {
            frame.current = requestAnimationFrame(() => {
              frame.current = 0;
              setCursor(pending.current);
            });
          }
        }}
        onMouseLeave={() => {
          pending.current = null;
          cancelAnimationFrame(frame.current);
          frame.current = 0;
          setCursor(null);
        }}
        onClick={(e) => {
          if (e.detail > 1) return; // the second click of a double click: the selection stays as the first click left it
          const p = position(e);
          const hit = hitTest(hits.current, p.x, p.y);
          if (hit !== null) onSelect(hit === selected ? null : hit);
        }}
        onDoubleClick={(e) => {
          const p = position(e);
          const hit = hitTest(hits.current, p.x, p.y);
          if (hit !== null) onSatDoubleClick?.(hit);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          const p = position(e);
          const hit = hitTest(hits.current, p.x, p.y);
          if (hit !== null) onSatContextMenu?.(hit, e.clientX, e.clientY);
        }}
      />
    </div>
  );
}
