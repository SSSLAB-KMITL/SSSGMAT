// Sorting of the List view (ref §4): by the column the module remembers, the AOS / LOS / Next Event columns numerically by
// time. Pure functions, no DOM and no React.

import { errorText } from "../api";
import type { SatState } from "../types";
import { compareNames, nextEventOf } from "./cells";

/** The module's `list_sort`. */
export interface ListSort {
  column: string;
  ascending: boolean;
}

type Key = number | string | null;

const timeKey = (iso: string | null): number | null => {
  if (iso === null) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
};

/**
 * What a row is sorted by in `column`: a number, a text, or null for "no value" (a missing number, a time that is not there),
 * which sorts last. Next AOS, Next LOS and Next Event are times, so that they sort by when and not by how they are written.
 * Status and Decayed are the same in every row, and a column this does not know has no key: the rows then go by name.
 */
function sortKey(column: string, s: SatState): Key {
  switch (column) {
    case "Satellite":
      return s.name;
    case "Catnum":
      return s.norad;
    case "Az":
      return s.az;
    case "El":
      return s.el;
    case "Dir":
      return s.dir;
    case "Ra":
      return s.ra;
    case "Dec":
      return s.dec;
    case "Range":
      return s.range_km;
    case "Rate":
      return s.range_rate_kms;
    case "Next Event": {
      const next = nextEventOf(s);
      return next === null ? null : timeKey(next.at);
    }
    case "Next AOS":
      return timeKey(s.next_aos);
    case "Next LOS":
      return timeKey(s.next_los);
    case "Lat":
      return s.lat_deg;
    case "Lon":
      return s.lon_deg;
    case "SSP":
      return s.ssp;
    case "Footp":
      return s.footprint_km;
    case "Alt":
      return s.alt_km;
    case "Vel":
      return s.vel_kms;
    case "Dop":
      return s.doppler_hz;
    case "Loss":
      return s.loss_db;
    case "Del":
      return s.delay_ms;
    case "MA":
      return s.ma;
    case "Phase":
      return s.phase_deg;
    case "Orbit":
      return s.orbit;
    case "Vis":
      return s.vis;
    default:
      return null;
  }
}

/** A key as a number if it is a finite one, else null. */
const finite = (k: Key): Key => (typeof k === "number" && !Number.isFinite(k) ? null : k);

/** Ascending order of two keys; null is not compared here. */
function compareKeys(a: string | number, b: string | number): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

/**
 * The rows of the List in the order of `column`, ascending or descending, as a new array. A row with no value in the column
 * is last whichever way it sorts; rows that are equal go by name and then NORAD number, also whichever way it sorts.
 */
export function sortSats(sats: readonly SatState[], column: string, ascending: boolean): SatState[] {
  const keyed = sats.map((s) => ({ s, key: finite(sortKey(column, s)) }));
  keyed.sort((x, y) => {
    if (x.key !== null && y.key !== null) {
      const c = column === "Satellite" ? compareNames(String(x.key), String(y.key)) : compareKeys(x.key, y.key);
      if (c !== 0) return ascending ? c : -c;
    } else if (x.key !== y.key) {
      return x.key === null ? 1 : -1;
    }
    return compareNames(x.s.name, y.s.name) || x.s.norad - y.s.norad;
  });
  return keyed.map((k) => k.s);
}

/** What a click on the header of `clicked` does to the sort: the sorted column changes direction, another column sorts ascending. */
export function nextSort(current: ListSort, clicked: string): ListSort {
  return current.column === clicked ? { column: clicked, ascending: !current.ascending } : { column: clicked, ascending: true };
}

/** The Thai text for the notice strip when the module's new sort order could not be saved (the list is sorted again as before). */
export function sortSaveFailureText(error: unknown): string {
  return `บันทึกการเรียงลำดับของ List ไม่สำเร็จ: ${errorText(error)}`;
}
