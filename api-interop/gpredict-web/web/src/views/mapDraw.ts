// Draws the Map view on a canvas, in the order of Gpredict's on_draw (ref §5; spec §8.4):
//   1 background image, 2 grid, 3 solar terminator, 4 ground station, 5 each satellite (ground track, footprint, marker,
//   name), 6 info texts. All the geometry is in mapGeom.ts and the texts in mapText.ts; this file only paints.

import { cssRgba, MAP_COLORS, MAP_SHADOW_ALPHA } from "../colors";
import { fmtFixed } from "../format";
import type { Tick } from "../types";
import {
  footprintRings,
  fromXY,
  GRID_LATITUDES,
  gridLongitudes,
  labelPos,
  lonToX,
  MARKER_HALF,
  projectLine,
  toXY,
  wrapLon,
} from "./mapGeom";
import { cursorText, NEXT_PENDING, nextEventText, qthInfoText, selectedEventText } from "./mapText";

/** The page's font (styles.css); Gpredict uses the GTK default font and ignores its MAP_FONT setting (ref §5). */
export const FONT = '13px system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Noto Sans Thai", sans-serif';
export const LINE_H = 16;
/** Behind the picture until it has loaded. */
const FALLBACK_BACKGROUND = "#10243f";

export type Polyline = readonly (readonly [number, number])[];

/** Everything one drawing needs. Sizes are CSS px; `dpr` is the device pixel ratio of the canvas. */
export interface MapScene {
  w: number;
  h: number;
  dpr: number;
  image: CanvasImageSource | null;
  centerLon: number;
  contents: Readonly<Record<string, boolean>>;
  /** the tick being shown, null before the first one */
  tick: Tick | null;
  selected: number | null;
  /** satellites with "Highlight footprint" off */
  footprintOff: ReadonlySet<number>;
  /** satellites with "Ground Track" on */
  groundTrack: ReadonlySet<number>;
  tracks: ReadonlyMap<number, readonly Polyline[]>;
  /** the night side ([lat, lon] polygon of nightPolygon) when it was computed, null if not */
  night: readonly (readonly [number, number])[] | null;
  /** mouse position over the map, null when it is not there */
  cursor: { x: number; y: number } | null;
}

/** Where a satellite marker is on the map, for hit testing. */
export interface SatPos {
  norad: number;
  x: number;
  y: number;
}

/** Paint `scene` on `ctx` (whose canvas is round(w*dpr) x round(h*dpr)). Returns the position of every satellite drawn. */
export function drawMap(ctx: CanvasRenderingContext2D, scene: MapScene): SatPos[] {
  const { w, h, dpr, centerLon, contents, tick, selected } = scene;
  const on = (name: string) => contents[name] === true;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  drawBackground(ctx, scene);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.font = FONT;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";

  if (on("Grid Lines")) drawGrid(ctx, scene);
  if (on("Solar Terminator") && scene.night !== null) drawTerminator(ctx, scene.night, scene);

  const hits: SatPos[] = [];
  if (tick !== null) {
    drawStation(ctx, tick, scene);
    const sats = (tick.sats ?? []).filter((s) => s.dir !== "D" && s.lat_deg !== null && s.lon_deg !== null);
    // the selected satellite last, so that it is on top
    const ordered = [...sats.filter((s) => s.norad !== selected), ...sats.filter((s) => s.norad === selected)];
    for (const sat of ordered) {
      const isSelected = sat.norad === selected;
      const lat = sat.lat_deg as number;
      const lon = sat.lon_deg as number;
      const [x, y] = toXY(lat, lon, w, h, centerLon);
      hits.push({ norad: sat.norad, x, y });
      const colour = cssRgba(isSelected ? MAP_COLORS.selected : MAP_COLORS.satellite);

      // ground track: 1 px, track colour
      const lines = scene.groundTrack.has(sat.norad) ? scene.tracks.get(sat.norad) : undefined;
      if (lines !== undefined) {
        ctx.strokeStyle = cssRgba(MAP_COLORS.track);
        ctx.lineWidth = 1;
        for (const line of lines) for (const px of projectLine(line, w, h, centerLon)) strokePath(ctx, px);
      }

      // footprint: the selected satellite always shows it (unless "Highlight footprint" is off for it)
      if ((on("Satellite Footprint") || isSelected) && !scene.footprintOff.has(sat.norad) && sat.footprint_km !== null) {
        ctx.fillStyle = cssRgba(MAP_COLORS.footprint);
        ctx.strokeStyle = colour;
        ctx.lineWidth = 1;
        for (const ring of footprintRings(lat, lon, sat.footprint_km, centerLon)) {
          ctx.beginPath();
          ring.forEach(([la, lo], i) => {
            const [rx, ry] = toXY(la, lo, w, h, centerLon);
            if (i === 0) ctx.moveTo(rx, ry);
            else ctx.lineTo(rx, ry);
          });
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
      }

      // marker: a shadow square, then the 6x6 px square
      const [mx, my] = [Math.round(x), Math.round(y)];
      if (on("Satellite Marker") || isSelected) {
        ctx.fillStyle = cssRgba(0x000000ff, MAP_SHADOW_ALPHA);
        ctx.fillRect(mx - MARKER_HALF + 1, my - MARKER_HALF + 1, 2 * MARKER_HALF, 2 * MARKER_HALF);
        ctx.fillStyle = colour;
        ctx.fillRect(mx - MARKER_HALF, my - MARKER_HALF, 2 * MARKER_HALF, 2 * MARKER_HALF);
      }

      // name, with a shadow
      if (on("Satellite Name") || isSelected) {
        const tw = ctx.measureText(sat.name).width;
        const p = labelPos(mx, my, tw, LINE_H, w, h);
        ctx.fillStyle = cssRgba(0x000000ff, MAP_SHADOW_ALPHA);
        ctx.fillText(sat.name, p.x + 1, p.y + 1);
        ctx.fillStyle = colour;
        ctx.fillText(sat.name, p.x, p.y);
      }
    }
  }

  drawInfoTexts(ctx, scene);
  return hits;
}

/** 1: the picture fills the view and is shifted so that the centre longitude is in the middle (two blits). Drawn in device pixels so the blits meet. */
function drawBackground(ctx: CanvasRenderingContext2D, scene: MapScene): void {
  const [dw, dh] = [ctx.canvas.width, ctx.canvas.height];
  if (scene.image === null) {
    ctx.fillStyle = FALLBACK_BACKGROUND;
    ctx.fillRect(0, 0, dw, dh);
    return;
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const x0 = Math.round((-scene.centerLon / 360) * dw); // where longitude -180 of the picture lands
  ctx.drawImage(scene.image, x0, 0, dw, dh);
  if (x0 > 0) ctx.drawImage(scene.image, x0 - dw, 0, dw, dh);
  else if (x0 < 0) ctx.drawImage(scene.image, x0 + dw, 0, dw, dh);
}

/** 2: lines every 30 degrees (0.5 px) and their labels "%.0f°" in the grid colour. */
function drawGrid(ctx: CanvasRenderingContext2D, scene: MapScene): void {
  const { w, h, centerLon } = scene;
  const colour = cssRgba(MAP_COLORS.grid);
  ctx.strokeStyle = colour;
  ctx.fillStyle = colour;
  ctx.lineWidth = 0.5;
  ctx.textBaseline = "bottom";
  for (const lat of GRID_LATITUDES) {
    const y = toXY(lat, 0, w, h, centerLon)[1];
    strokePath(ctx, [[0, y], [w, y]]);
    ctx.fillText(`${fmtFixed(lat, 0)}°`, 15, y - 1);
  }
  for (const lon of gridLongitudes(centerLon)) {
    const x = lonToX(lon, w, centerLon);
    strokePath(ctx, [[x, 0], [x, h]]);
    const shown = wrapLon(lon) === -180 ? 180 : wrapLon(lon);
    ctx.fillText(`${fmtFixed(shown, 0)}°`, x + 2, h - 2);
  }
  ctx.textBaseline = "top";
}

/** 3: the night side filled with the "Global shadow" colour and the terminator line in the terminator colour. */
function drawTerminator(ctx: CanvasRenderingContext2D, night: NonNullable<MapScene["night"]>, scene: MapScene): void {
  const { w, h, centerLon } = scene;
  const px = night.map(([lat, lon]): [number, number] => [lonToX(lon, w, centerLon), ((90 - lat) / 180) * h]);
  ctx.beginPath();
  px.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
  ctx.fillStyle = cssRgba(MAP_COLORS.earthShadow);
  ctx.fill();
  ctx.strokeStyle = cssRgba(MAP_COLORS.terminator);
  ctx.lineWidth = 1;
  strokePath(ctx, px.slice(0, -2)); // the last two points only close the polygon along the pole line
}

/** 4: the ground station, a 6x6 px square with its name centred below it, both in the ground station colour. */
function drawStation(ctx: CanvasRenderingContext2D, tick: Tick, scene: MapScene): void {
  const { w, h, centerLon } = scene;
  const [x, y] = toXY(tick.qth.lat_deg, tick.qth.lon_deg, w, h, centerLon).map(Math.round) as [number, number];
  ctx.fillStyle = cssRgba(MAP_COLORS.groundStation);
  ctx.fillRect(x - MARKER_HALF, y - MARKER_HALF, 2 * MARKER_HALF, 2 * MARKER_HALF);
  const p = labelPos(x, y, ctx.measureText(tick.qth.name).width, LINE_H, w, h);
  ctx.fillText(tick.qth.name, p.x, p.y);
}

/** 6: info texts in the info colours, on a rectangle of the info background colour. */
function drawInfoTexts(ctx: CanvasRenderingContext2D, scene: MapScene): void {
  const { w, h, contents, tick, selected } = scene;
  const box = (text: string, x: number, y: number, rightAligned = false) => {
    const tw = ctx.measureText(text).width;
    const left = rightAligned ? x - tw : x;
    ctx.fillStyle = cssRgba(MAP_COLORS.infoBg);
    ctx.fillRect(left, y, tw, LINE_H);
    ctx.fillStyle = cssRgba(MAP_COLORS.infoFg);
    ctx.fillText(text, left, y + (LINE_H - 13) / 2);
  };
  ctx.font = FONT;
  ctx.textBaseline = "top";
  const nowMs = tick === null ? NaN : Date.parse(tick.t);

  if (contents["QTH Info"] === true && tick !== null) box(qthInfoText(tick.qth), 0, 0);
  if (contents["Next Event"] === true) box(tick === null ? NEXT_PENDING : nextEventText(tick.sats ?? [], nowMs), w, 0, true);
  if (contents["Cursor Position"] === true && scene.cursor !== null) {
    const [lat, lon] = fromXY(scene.cursor.x, scene.cursor.y, w, h, scene.centerLon);
    box(cursorText(lat, lon), 0, h - LINE_H);
  }
  if (selected !== null && tick !== null) {
    const text = selectedEventText(tick.sats?.find((s) => s.norad === selected), nowMs);
    if (text !== null) box(text, w, h - LINE_H, true);
  }
}

function strokePath(ctx: CanvasRenderingContext2D, points: Polyline): void {
  if (points.length < 2) return;
  ctx.beginPath();
  points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.stroke();
}
