// The "Number Formats" of Preferences (ref-D §2, spec §3) as the views use them: UTC or local time, the time format, N/S/E/W for
// coordinates and Imperial units. The server sends time in UTC and distances in km; every view formats them with these.

import { useMemo } from "react";
import { DEFAULT_TIME_FORMAT, fmtFixed, formatTime } from "./format";
import { usePrefs } from "./prefs/prefsStore";
import type { PrefValue } from "./types";

/** Kilometres in a mile and feet in a metre: the constants of Gpredict (`gpredict-utils.h:6-9`). */
export const KM_PER_MI = 1.609344;
export const FT_PER_M = 3.2808399;

export interface NumberFormat {
  /** GLOBAL/USE_LOCAL_TIME: times are those of the machine's time zone instead of UTC */
  local: boolean;
  /** GLOBAL/TIME_FORMAT: a C `strftime` format */
  timeFormat: string;
  /** GLOBAL/USE_NSEW: coordinates with a suffix N/S/E/W instead of a sign */
  nsew: boolean;
  /** GLOBAL/USE_IMPERIAL: miles instead of kilometres */
  imperial: boolean;
}

/** Gpredict's defaults (ref-D §2): UTC, `%Y/%m/%d %H:%M:%S`, signs, metric. What a view uses before the Preferences have arrived. */
export const DEFAULT_NF: NumberFormat = { local: false, timeFormat: DEFAULT_TIME_FORMAT, nsew: false, imperial: false };

/** The number format of the `values` of GET /api/prefs; a key that is missing or of the wrong type is at its default. */
export function numberFormatOf(values: Readonly<Record<string, PrefValue>> | null | undefined): NumberFormat {
  const v = values ?? {};
  const flag = (key: string): boolean => v[key] === true;
  const format = v["GLOBAL/TIME_FORMAT"];
  return {
    local: flag("GLOBAL/USE_LOCAL_TIME"),
    timeFormat: typeof format === "string" ? format : DEFAULT_NF.timeFormat,
    nsew: flag("GLOBAL/USE_NSEW"),
    imperial: flag("GLOBAL/USE_IMPERIAL"),
  };
}

/**
 * The number format now in force: the Preferences of the page, DEFAULT_NF until they have arrived. The same object while the
 * four values stay the same, so a view that keeps it in the dependencies of an effect redraws only when one of them changes.
 */
export function useNumberFormat(): NumberFormat {
  const n = numberFormatOf(usePrefs()?.values);
  // `n` is a new object on every answer: its four values are what the memo depends on
  return useMemo(() => n, [n.local, n.timeFormat, n.nsew, n.imperial]);
}

/** A time (ISO 8601 or a Date) in the time format, in UTC or local time. An invalid time is the placeholder of Gpredict's preview. */
export function fmtTimeNf(time: string | Date, nf: NumberFormat): string {
  return formatTime(typeof time === "string" ? new Date(time) : time, nf.timeFormat, nf.local);
}

/**
 * A latitude or longitude as Gpredict writes it (`%.Nf°` and one character, `gtk-sat-list.c:961-1007`): with N/S/E/W on the
 * magnitude and N or S (E or W) by the sign before rounding; off, the sign stays and the character is a space, so the text ends
 * in a space. "-" if there is no value.
 */
export function fmtLatLon(v: number | null, axis: "lat" | "lon", digits: number, nf: NumberFormat): string {
  if (v === null || !Number.isFinite(v)) return "-";
  if (!nf.nsew) return `${fmtFixed(v, digits)}° `;
  const side = axis === "lat" ? (v < 0 ? "S" : "N") : v < 0 ? "W" : "E";
  return `${fmtFixed(Math.abs(v), digits)}°${side}`;
}

/** A distance (or a speed) the server gives in km (km/s) in the unit of the number format; null stays null. */
export function distance(km: number | null, nf: NumberFormat): number | null {
  if (km === null) return null;
  return nf.imperial ? km / KM_PER_MI : km;
}

/** Metres to feet, and back (the altitude of a ground station, `gpredict-utils.h`). */
export const mToFt = (m: number): number => FT_PER_M * m;
export const ftToM = (ft: number): number => ft / FT_PER_M;
