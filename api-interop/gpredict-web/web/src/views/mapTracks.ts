// Which ground tracks to ask the server for (ref §5: tracks of the satellites whose "Ground Track" is on; spec §7.3).
// A track starts at the beginning of the satellite's current orbit and is cut at the edge of the GMAT window, so it is
// fetched again when the window changes, when the satellite starts a new orbit and when the number of orbits changes.

import type { SatState } from "../types";

/** What a fetched track depends on: the start of the GMAT window, the satellite's orbit number and the number of orbits shown. */
export function trackKey(windowStart: string, orbit: number, orbits: number): string {
  return `${windowStart}|${orbit}|${orbits}`;
}

export interface TrackPlan {
  /** tracks to ask for now, with the key to remember for each */
  fetch: { norad: number; key: string }[];
  /** satellites held in `requested` whose Ground Track is no longer on: forget them (and their lines) */
  drop: number[];
}

/**
 * `enabled` are the NORAD numbers whose Ground Track is on; `requested` maps a NORAD number to the key of the last request
 * made for it. A satellite that is not in the tick (not in the module any more, or decayed and gone) is left out.
 */
export function planTrackFetches(
  enabled: readonly number[],
  sats: readonly SatState[],
  windowStart: string,
  orbits: number,
  requested: ReadonlyMap<number, string>,
): TrackPlan {
  const byNorad = new Map(sats.map((s) => [s.norad, s]));
  const plan: TrackPlan = { fetch: [], drop: [] };
  for (const norad of enabled) {
    const sat = byNorad.get(norad);
    if (sat === undefined) continue;
    const key = trackKey(windowStart, sat.orbit, orbits);
    if (requested.get(norad) !== key) plan.fetch.push({ norad, key });
  }
  const wanted = new Set(enabled);
  for (const norad of requested.keys()) if (!wanted.has(norad)) plan.drop.push(norad);
  return plan;
}
