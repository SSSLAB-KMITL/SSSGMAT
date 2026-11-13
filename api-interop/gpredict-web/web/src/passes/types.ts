// JSON shapes of the pass routes of the Gpredict Web server (spec §9): POST /api/modules/{name}/passes and
// GET /api/modules/{name}/skyglance. Times are ISO 8601 UTC strings with milliseconds, ending in "Z".
// The web never computes orbits: every number below comes from the server. A measured number is `number | null`: the server sends
// null instead of NaN/Infinity (as in a tick).

import type { ApiMessage, TickStatus } from "../types";

/** One row of the Data tab of Pass details, in the order of Gpredict's columns (ref-P §2.2). */
export interface PassRow {
  t: string;
  az: number | null;
  el: number | null;
  ra: number | null;
  dec: number | null;
  range_km: number | null;
  rate_kms: number | null;
  lat_deg: number | null;
  lon_deg: number | null;
  /** 6-character Maidenhead locator */
  ssp: string;
  footprint_km: number | null;
  alt_km: number | null;
  vel_kms: number | null;
  doppler_hz: number | null;
  loss_db: number | null;
  delay_ms: number | null;
  /** mean anomaly on Gpredict's 0-256 scale */
  ma: number | null;
  phase_deg: number | null;
  /** "-", "V", "D" or "E" */
  vis: string;
}

/** One pass with its Data rows. */
export interface PassInfo {
  orbit: number;
  aos: string;
  tca: string;
  los: string;
  max_el: number | null;
  aos_az: number | null;
  max_el_az: number | null;
  los_az: number | null;
  /** 3 characters, one per V, D and E: the letter if the pass was in that state, "-" if not (for example "V-E") */
  vis: string;
  rows: PassRow[];
}

/** A pass without its rows (what Sky at a glance gets). */
export type PassSummary = Omit<PassInfo, "rows">;

export interface PassSat {
  norad: number;
  name: string;
}

/** The ground station the passes were found for. */
export interface PassQth {
  name: string;
  location: string;
  lat_deg: number;
  lon_deg: number;
  alt_m: number;
}

/**
 * Body of POST /api/modules/{name}/passes. `t` is the time to start from (the module time of the tick, ISO 8601 UTC).
 * `aos` only with kind "at": the AOS of the pass wanted (Sky at a glance), found within one second.
 */
export interface PassBody {
  norad: number;
  kind: "next" | "current" | "future" | "at";
  t: string;
  aos?: string;
}

/** The kinds of request the satellite popups make: Show current pass, Show next pass and Future passes ("at" is Sky at a glance's). */
export type PassKind = Exclude<PassBody["kind"], "at">;

/**
 * Answer of POST /api/modules/{name}/passes: `pass` (next, current, at), `passes` (future), or `message` when there is none
 * (code PASS_NO_AOS or PASS_NONE_WITHIN, the text is Gpredict's, with its line breaks). The server sends a message with
 * code, level and text only: `object` is not there (undefined), whatever the type says.
 */
export type PassAnswer =
  | { sat: PassSat; qth: PassQth; pass: PassInfo }
  | { sat: PassSat; qth: PassQth; passes: PassInfo[] }
  | { sat: PassSat; qth: PassQth; message: ApiMessage };

/**
 * Answer of GET /api/modules/{name}/skyglance. The server does not wait for GMAT: `status` is "computing" until it has the
 * ephemeris (ask again), "failed" if GMAT could not give it. `sats` is empty unless the status is "ok", then it has every
 * satellite of the module in name order, one with no pass has an empty `passes`; `colour` is that satellite's colour of
 * Preferences. `t0` is the time the passes were found from, `hours` the span of the window.
 */
export interface SkyGlanceAnswer {
  status: TickStatus;
  t0: string;
  hours: number;
  sats: { norad: number; name: string; colour: string; passes: PassSummary[] }[];
  messages: ApiMessage[];
}
