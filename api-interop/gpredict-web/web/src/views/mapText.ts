// The texts of the Map view (ref §5, "Info texts"). Pure functions; every string is as Gpredict shows it.
//
// The countdowns count from module time (the `t` of the tick, as milliseconds), never from the wall clock: with the clock
// stopped, running backwards or throttled, the text is what module time says.

import { fmtCountdown, fmtFixed } from "../format";
import type { SatState } from "../types";

/** What the top-right text shows before the first tick (ref §5: initially " ... "). */
export const NEXT_PENDING = " ... ";

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

/** Top right: "Next: <sat> in MM:SS" ("in HH:MM:SS" from one hour on), or "Next: N/A" when there is no upcoming event. */
export function nextEventText(sats: readonly SatState[], nowMs: number): string {
  const next = nextEvent(sats, nowMs);
  return next === null ? "Next: N/A" : `Next: ${next.sat.name} in ${fmtCountdown(next.seconds)}`;
}

/**
 * Bottom right, the selected satellite: " <sat> AOS in MM:SS " below the horizon, " <sat> LOS in MM:SS " from El 0 up
 * (an hours field is added when needed), " <sat>: Always in range " / " <sat>: Always out of range " for a satellite with
 * no AOS or LOS. Null when there is nothing to say: no satellite, or no event known (outside the computed window).
 */
export function selectedEventText(sat: SatState | undefined, nowMs: number): string | null {
  if (sat === undefined) return null;
  if (sat.always === "in") return ` ${sat.name}: Always in range `;
  if (sat.always === "out") return ` ${sat.name}: Always out of range `;
  const above = sat.el !== null && sat.el >= 0;
  const [kind, when] = above ? (["LOS", sat.next_los] as const) : (["AOS", sat.next_aos] as const);
  if (when === null) return null;
  const ms = Date.parse(when);
  if (Number.isNaN(ms)) return null;
  return ` ${sat.name} ${kind} in ${fmtCountdown((ms - nowMs) / 1000)} `;
}

/** Bottom left, the cursor: " LON:%.0f° LAT:%.0f° ". */
export function cursorText(lat: number, lon: number): string {
  return ` LON:${fmtFixed(lon, 0)}° LAT:${fmtFixed(lat, 0)}° `;
}

/** Top left, the ground station: " <name> · <location> ". */
export function qthInfoText(qth: { name: string; location: string }): string {
  return ` ${qth.name} · ${qth.location} `;
}
