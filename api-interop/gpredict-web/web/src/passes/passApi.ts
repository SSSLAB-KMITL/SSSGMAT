// REST client of the pass routes (spec §9). Throws ApiError for status >= 400, like api.ts.

import { moduleUrl, request, seg } from "../api";
import type { PassAnswer, PassBody, SkyGlanceAnswer } from "./types";

/**
 * Show next pass, Show current pass, Future passes, and a pass of Sky at a glance (kind "at"). The server waits for GMAT, which
 * can take long: `signal` is the Cancel of the waiting box. Aborting it rejects with the fetch's AbortError (not an ApiError)
 * and the server drops the job. 503 GMAT_FAILED when GMAT failed; 404 NOT_FOUND for a satellite that is not in the module.
 */
export const requestPass = (module: string, body: PassBody, signal: AbortSignal) =>
  request<PassAnswer>("POST", `${moduleUrl(module)}/passes`, body, signal);

/**
 * Sky at a glance of the module from `t` (ISO 8601 UTC; without it, from the time of the module). Answers at once with
 * status "computing" while GMAT works: ask again about every second.
 */
export function getSkyGlance(module: string, t?: string): Promise<SkyGlanceAnswer> {
  const query = t === undefined ? "" : `?t=${seg(t)}`;
  return request<SkyGlanceAnswer>("GET", `${moduleUrl(module)}/skyglance${query}`);
}

/** Closing the Sky at a glance window: lets the server drop the ephemeris it holds for it. */
export const releaseSkyGlance = (module: string) => request<void>("DELETE", `${moduleUrl(module)}/skyglance`);
