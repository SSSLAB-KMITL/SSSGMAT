// Which sky tracks to ask the server for (ref §6: a sky track is drawn for the satellites whose "Sky track" is on, or for
// all of them with "Show the sky tracks automatically"; spec §7.3). A sky track is the current pass, from AOS to LOS, so it
// is fetched again when the pass changes (the satellite rose again) and when the GMAT window changes.

import type { SatState } from "../types";

/** After a failed request (a 404 at the horizon, no server, ...) the same request is made again no sooner than this. */
export const SKY_RETRY_MS = 10_000;

/** What a fetched sky track depends on: the start of the GMAT window and the LOS of the satellite's current pass. */
export function skyKey(windowStart: string, sat: SatState): string {
  return `${windowStart}|${sat.next_los ?? ""}|${sat.always ?? ""}`;
}

/** Whether a sky track is wanted for `sat`: it is above the horizon (El > 0), not decayed, not GEO, and its Sky track is on or `auto` is. */
export function skyTrackWanted(sat: SatState, enabled: ReadonlySet<number>, auto: boolean): boolean {
  return sat.el !== null && sat.el > 0 && sat.dir !== "G" && sat.dir !== "D" && (auto || enabled.has(sat.norad));
}

/** What was last asked for a satellite: the key, and when (wall clock ms) the request failed, null while it is in flight or after it succeeded. */
export interface SkyRequest {
  key: string;
  failedAt: number | null;
}

export interface SkyPlan {
  /** tracks to ask for now, with the key to remember for each */
  fetch: { norad: number; key: string }[];
  /** satellites held in `requested` that are no longer wanted: forget them (and their points), so that they are asked for again when they rise */
  drop: number[];
}

export function planSkyFetches(args: {
  /** NORAD numbers whose Sky track is on (module config `sky_track`) */
  enabled: readonly number[];
  /** "Show the sky tracks automatically" */
  auto: boolean;
  sats: readonly SatState[];
  windowStart: string;
  requested: ReadonlyMap<number, SkyRequest>;
  nowMs: number;
}): SkyPlan {
  const { sats, windowStart, requested, nowMs } = args;
  const enabled = new Set(args.enabled);
  const plan: SkyPlan = { fetch: [], drop: [] };
  const wanted = new Set<number>();
  for (const sat of sats) {
    if (!skyTrackWanted(sat, enabled, args.auto)) continue;
    wanted.add(sat.norad);
    const key = skyKey(windowStart, sat);
    const last = requested.get(sat.norad);
    const retry = last !== undefined && last.key === key && last.failedAt !== null && nowMs - last.failedAt >= SKY_RETRY_MS;
    if (last === undefined || last.key !== key || retry) plan.fetch.push({ norad: sat.norad, key });
  }
  for (const norad of requested.keys()) if (!wanted.has(norad)) plan.drop.push(norad);
  return plan;
}
