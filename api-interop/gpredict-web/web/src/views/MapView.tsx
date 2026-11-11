import { useEffect, useMemo, useRef, useState } from "react";
import { getTrack } from "../api";
import type { ViewProps } from "../components/ModuleView";
import type { SatPos } from "./canvasCommon";
import { prepareCanvas, useCanvasMouse, useElementSize, useRefreshGate } from "./canvasHooks";
import { drawMap } from "./mapDraw";
import type { Polyline } from "./mapDraw";
import { nightPolygon, terminatorDue } from "./mapGeom";
import { planTrackFetches } from "./mapTracks";

const MAP_IMAGE = `${import.meta.env.BASE_URL}maps/earth_1024.jpg`;

/** After a failed track request the same request may be made again, by the next redraw that comes after this long. */
const TRACK_RETRY_MS = 10_000;

/**
 * The Map view (ref §5, spec §8.4), drawn on a canvas that fills its cell.
 *
 * - It redraws from the tick only every `refresh.map` ticks (the first tick at once); a selection, the mouse cursor, a
 *   resize and a fetched track redraw it from the tick it already shows. A tick that is not "ok" (computing, failed)
 *   leaves the last picture, and the next "ok" tick redraws at once.
 * - Ground tracks come from GET /track/{norad} for the satellites in `config.ground_track`, again when the GMAT window,
 *   the satellite's orbit or the number of orbits changes; a failed request (a network error, an error answer) is
 *   ignored and leaves the old line, if any; it is tried again by a redraw 10 s or more later.
 * - The night side is computed from the sun of the tick, again only when module time has moved 15 s or more.
 * - Left click within 10 px of a satellite selects it, or unselects it if it is the selected one (the double click of a
 *   double click does not toggle again); double click calls `onSatDoubleClick`; right click calls `onSatContextMenu`.
 */
export function MapView({ module, config, tick, selected, onSelect, onSatContextMenu, onSatDoubleClick }: ViewProps) {
  const holder = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const size = useElementSize(holder);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [tracks, setTracks] = useState<ReadonlyMap<number, readonly Polyline[]>>(new Map());
  const hits = useRef<SatPos[]>([]);
  const night = useRef<{ ms: number; polygon: [number, number][] } | null>(null);
  const requested = useRef(new Map<number, string>()); // NORAD -> key of the last track request

  const centerLon = config.map.center_lon;
  const contents = config.map.contents;
  const cursorOn = contents["Cursor Position"] === true;
  const footprintOff = useMemo(() => new Set(config.footprint_off), [config.footprint_off]);
  const groundTrack = useMemo(() => new Set(config.ground_track), [config.ground_track]);

  // the picture
  useEffect(() => {
    const img = new Image();
    img.onload = () => setImage(img);
    img.src = MAP_IMAGE;
    return () => {
      img.onload = null;
    };
  }, []);

  // which ticks redraw: the first, then every refresh.map-th "ok" tick
  const shown = useRefreshGate(tick, config.refresh.map);
  const { cursor, handlers } = useCanvasMouse({ canvas, hits, trackCursor: cursorOn, selected, onSelect, onSatContextMenu, onSatDoubleClick });

  // ground tracks
  useEffect(() => {
    if (shown === null || shown.status !== "ok") return;
    const plan = planTrackFetches(config.ground_track, shown.sats ?? [], shown.window.start, config.map.track_orbits, requested.current);
    if (plan.drop.length > 0) {
      for (const norad of plan.drop) requested.current.delete(norad);
      setTracks((held) => {
        const next = new Map(held);
        for (const norad of plan.drop) next.delete(norad);
        return next;
      });
    }
    for (const { norad, key } of plan.fetch) {
      requested.current.set(norad, key);
      getTrack(module, norad).then(
        (result) => {
          if (requested.current.get(norad) === key) setTracks((held) => new Map(held).set(norad, result.lines));
        },
        () => {
          // no server, ...: no new line (the old one stays), and a redraw after TRACK_RETRY_MS asks again
          setTimeout(() => {
            if (requested.current.get(norad) === key) requested.current.delete(norad);
          }, TRACK_RETRY_MS);
        },
      );
    }
  }, [module, config.ground_track, config.map.track_orbits, shown]);

  // draw
  useEffect(() => {
    const target = prepareCanvas(canvas.current, size);
    if (target === null) return;
    const { ctx, dpr } = target;

    let polygon: [number, number][] | null = null;
    if (contents["Solar Terminator"] === true && shown !== null) {
      const ms = Date.parse(shown.t);
      if (night.current === null || terminatorDue(night.current.ms, ms)) {
        night.current = { ms, polygon: nightPolygon(shown.sun.lat_deg, shown.sun.lon_deg) };
      }
      polygon = night.current.polygon;
    }
    hits.current = drawMap(ctx, {
      w: size.w,
      h: size.h,
      dpr,
      image,
      centerLon,
      contents,
      tick: shown,
      selected,
      footprintOff,
      groundTrack,
      tracks,
      night: polygon,
      cursor,
    });
  }, [size, image, shown, tracks, selected, centerLon, contents, cursor, footprintOff, groundTrack]);

  return (
    <div ref={holder} className="map-view">
      <canvas
        ref={canvas}
        className="map-canvas"
        role="img"
        aria-label="Map"
        style={{ width: size.w, height: size.h }}
        {...handlers}
      />
    </div>
  );
}
