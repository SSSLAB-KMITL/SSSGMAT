// What the canvas views (Map, Polar) have in common. Pure functions and constants, no DOM and no React: the hooks that use
// them are in canvasHooks.ts.

import type { SatState, Tick } from "../types";

/** The page's font (styles.css); Gpredict uses the GTK default font and ignores its MAP_FONT / POLAR_FONT settings (ref §5, §6). */
export const FONT = '13px system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Noto Sans Thai", sans-serif';

/** Height in px of a line of text in the info texts. */
export const LINE_H = 16;

/** Half the size of the 6x6 px satellite markers (`MARKER_SIZE_HALF`, ref §5, §6) and of the Map's ground station square. */
export const MARKER_HALF = 3;

/** A left click within this many pixels of a satellite selects it (ref §5, §6). */
export const HIT_RADIUS_PX = 10;

/** Size of a view's cell in CSS px. */
export interface Size {
  w: number;
  h: number;
}

/** Where a satellite marker is in a view, for hit testing. */
export interface SatPos {
  norad: number;
  x: number;
  y: number;
}

/** NORAD number of the satellite nearest to (x, y) and within `px` pixels of it (10, ref §5, §6), null if there is none. */
export function hitTest(sats: readonly SatPos[], x: number, y: number, px = HIT_RADIUS_PX): number | null {
  let best: number | null = null;
  let bestD2 = px * px;
  for (const s of sats) {
    const d2 = (s.x - x) ** 2 + (s.y - y) ** 2;
    if (d2 <= bestD2) {
      best = s.norad;
      bestD2 = d2;
    }
  }
  return best;
}

/**
 * What a click does to the selection (ref §5, §6: a left click on a satellite selects it, or unselects it if it is the selected
 * one). `clickCount` is the `detail` of the click event: the second click of a double click (2 or more) changes nothing, so
 * that the selection stays as the first click left it. `hit` is the satellite under the mouse, null if none. Null result:
 * leave the selection; otherwise the new selection (a NORAD number, or null for none).
 */
export function clickSelection(clickCount: number, hit: number | null, selected: number | null): { norad: number | null } | null {
  if (clickCount > 1 || hit === null) return null;
  return { norad: hit === selected ? null : hit };
}

/** The satellite whose next AOS comes first after `nowMs`, and the seconds until it; null if none has one. Decayed satellites are left out. */
export function nextEvent(sats: readonly SatState[], nowMs: number): { sat: SatState; seconds: number } | null {
  let best: { sat: SatState; seconds: number } | null = null;
  for (const sat of sats) {
    if (sat.dir === "D" || sat.next_aos === null) continue;
    const aosMs = Date.parse(sat.next_aos);
    if (!(aosMs > nowMs)) continue; // also false for an unparseable time (NaN)
    const seconds = (aosMs - nowMs) / 1000;
    if (best === null || seconds < best.seconds) best = { sat, seconds };
  }
  return best;
}

/** The size of a canvas in device pixels for a view of `size` CSS px on a screen with this device pixel ratio. */
export function canvasPixels(size: Size, dpr: number): [number, number] {
  return [Math.round(size.w * dpr), Math.round(size.h * dpr)];
}

// ---------------------------------------------------------------- refresh gate

/** Whether tick number `index` (0 is the first) redraws a view: the first, then every `every`-th (the "refresh every N cycles" setting). */
export function isRefreshTick(index: number, every: number): boolean {
  const n = Number.isFinite(every) && every >= 1 ? Math.floor(every) : 1;
  return index % n === 0;
}

/** What the gate remembers between ticks: the last tick it saw, and how many ok ticks it has counted since a tick that was not ok. */
export interface RefreshGate {
  last: Tick | null;
  count: number;
}

export const INITIAL_GATE: RefreshGate = { last: null, count: 0 };

/**
 * One step of the redraw gate of a view: the tick that has just arrived, and the "refresh every `every` cycles" setting.
 * - A tick the gate has already seen (the effect runs twice in StrictMode, and again when the setting changes) changes nothing.
 * - A tick that is not "ok" (computing, failed) never draws and starts the count again, so the next ok tick draws at once.
 * - An ok tick draws when it is the first, or the every-N-th, since the count started.
 */
export function stepRefreshGate(gate: RefreshGate, tick: Tick | null, every: number): { gate: RefreshGate; draw: boolean } {
  if (tick === null || tick === gate.last) return { gate, draw: false };
  if (tick.status !== "ok") return { gate: { last: tick, count: 0 }, draw: false };
  return { gate: { last: tick, count: gate.count + 1 }, draw: isRefreshTick(gate.count, every) };
}
