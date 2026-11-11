// The texts of the Polar view (ref §6, "Info texts"). Pure functions; every string is as Gpredict shows it.
//
// The countdowns count from module time (the `t` of the tick, as milliseconds), never from the wall clock.

import { fmtCountdown, fmtFixed } from "../format";
import type { SatState } from "../types";
import { nextEvent } from "./mapText";

/** Top right: "Next: <sat>\nin MM:SS" ("in HH:MM:SS" from one hour on), or "Next: N/A" when no satellite has an upcoming AOS. */
export function nextEventText(sats: readonly SatState[], nowMs: number): string {
  const next = nextEvent(sats, nowMs);
  return next === null ? "Next: N/A" : `Next: ${next.sat.name}\nin ${fmtCountdown(next.seconds)}`;
}

/**
 * Bottom right, the selected satellite (which is above the horizon): "<sat>\nLOS in MM:SS" (an hours field is added from one
 * hour on), "<sat>\nAlways in range" for a satellite with no LOS. Null when there is nothing to say: no satellite, or no LOS
 * known (outside the computed window).
 */
export function selectedText(sat: SatState | undefined, nowMs: number): string | null {
  if (sat === undefined) return null;
  if (sat.always === "in") return `${sat.name}\nAlways in range`;
  if (sat.next_los === null) return null;
  const ms = Date.parse(sat.next_los);
  if (Number.isNaN(ms)) return null;
  return `${sat.name}\nLOS in ${fmtCountdown((ms - nowMs) / 1000)}`;
}

/** Bottom left, the cursor: "AZ: %.0f°   EL: %.0f°", shown only above the horizon (El > 0), null otherwise. */
export function cursorText(az: number, el: number): string | null {
  return el > 0 ? `AZ: ${fmtFixed(az, 0)}°   EL: ${fmtFixed(el, 0)}°` : null;
}
