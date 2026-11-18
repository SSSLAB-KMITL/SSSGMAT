// The text of the cells of the List, Single sat and Event list views (ref §4, §7, §8). Pure functions, no DOM and no React.
// Every number comes from the server (SatState); a missing one (null) shows as "-".

import { fmtCountdown, fmtFixed, formatTime } from "../format";
import { DEFAULT_NF, distance, fmtLatLon, fmtTimeNf } from "../numfmt";
import type { NumberFormat } from "../numfmt";
import type { SatState, Tick } from "../types";

export type Align = "left" | "center" | "right";

const NAMES = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

/** Order of satellite names as Gpredict's Single sat sorts them (`strnatcasecmp`): ignoring case, numbers by value. */
export function compareNames(a: string, b: string): number {
  return NAMES.compare(a, b);
}

/** Gpredict hides decayed satellites in every view (ref §4, §8); the server does not send them, this only makes it certain. */
export function isDecayed(s: SatState): boolean {
  return s.dir === "D";
}

// ---------------------------------------------------------------- shared formats

/** `%.2f°`; with `width`, padded on the left to that many characters before the degree sign like `%6.2f°`. "-" if missing. */
function degrees(x: number | null, width = 0): string {
  const text = fmtFixed(x, 2);
  return text === "-" ? text : `${text.padStart(width)}°`;
}

/** A time in the time format and zone of `nf`, `empty` if there is none. */
function timeOr(iso: string | null, empty: string, nf: NumberFormat): string {
  return iso === null ? empty : fmtTimeNf(iso, nf);
}

/** `text` unless it is missing. */
function withUnit(value: number | null, decimals: number, unit: string): string {
  const text = fmtFixed(value, decimals);
  return text === "-" ? text : `${text} ${unit}`;
}

/** A distance of the server (km) in the unit of `nf`, with `decimals` decimals and no unit text ("-" if missing): the List and the pass tables. */
export function lengthText(km: number | null, decimals: number, nf: NumberFormat): string {
  return fmtFixed(distance(km, nf), decimals);
}

/** The same with its unit, `km` or `mi` (a speed: `km/sec` or `mi/sec`): the Single sat view. */
function withLength(km: number | null, decimals: number, nf: NumberFormat, speed = false): string {
  const unit = speed ? (nf.imperial ? "mi/sec" : "km/sec") : nf.imperial ? "mi" : "km";
  return withUnit(distance(km, nf), decimals, unit);
}

export interface NextEvent {
  kind: "AOS" | "LOS";
  /** ISO 8601 time of the event */
  at: string;
}

/**
 * The next event of a satellite: the earlier of its next AOS and next LOS (Gpredict: LOS if AOS comes after it, else AOS).
 * When only one of them is known it is that one: the LOS of a pass in progress is the next event even when the next AOS is
 * beyond the calculation window. Null if neither is known.
 */
export function nextEventOf(s: SatState): NextEvent | null {
  const { next_aos: aos, next_los: los } = s;
  if (los === null) return aos === null ? null : { kind: "AOS", at: aos };
  if (aos === null) return { kind: "LOS", at: los };
  return Date.parse(aos) > Date.parse(los) ? { kind: "LOS", at: los } : { kind: "AOS", at: aos };
}

// ---------------------------------------------------------------- List

/**
 * Horizontal alignment of the cells of each column of the List (`SAT_LIST_COL_XALIGN`, gtk-sat-list.c:113). The headers
 * are all centered. A column that is not here is left aligned.
 */
export const LIST_ALIGN: Readonly<Record<string, Align>> = {
  Catnum: "center",
  Az: "right",
  El: "right",
  Dir: "center",
  Range: "right",
  Rate: "right",
  "Next Event": "center",
  "Next AOS": "center",
  "Next LOS": "center",
  Lat: "right",
  Lon: "right",
  SSP: "center",
  Footp: "center",
  Alt: "right",
  Orbit: "right",
  Vis: "center",
};

const NO_EVENT = "--- N/A ---";

/**
 * The text of one cell of the List (ref §4, ref-D §2.1). `column` is the column's title. `t` is the module time of the tick:
 * every time in a cell comes from the server, so it is not needed today. A column this does not know is empty.
 * `nf` is the number format: the time format and zone of the times, N/S/E/W for Lat and Lon (off, they end in a space), miles for
 * Range, Rate, Footp, Alt and Vel (no unit text in the cell).
 * Status is "Unknown" (no source of operational status yet) and Decayed is empty (decayed satellites are never listed).
 */
export function listCell(column: string, s: SatState, _t: Date, nf: NumberFormat = DEFAULT_NF): string {
  switch (column) {
    case "Satellite":
      return s.name;
    case "Catnum":
      return String(s.norad);
    case "Az":
      return degrees(s.az);
    case "El":
      return degrees(s.el);
    case "Dir":
      return s.dir;
    case "Ra":
      return degrees(s.ra);
    case "Dec":
      return degrees(s.dec);
    case "Range":
      return lengthText(s.range_km, 0, nf);
    case "Rate":
      return lengthText(s.range_rate_kms, 3, nf);
    case "Next Event": {
      // Gpredict appends " (AOS)" or " (LOS)" to the format before it formats, so the cut at 49 characters includes it
      const next = nextEventOf(s);
      return next === null ? NO_EVENT : formatTime(new Date(next.at), `${nf.timeFormat} (${next.kind})`, nf.local);
    }
    case "Next AOS":
      return timeOr(s.next_aos, NO_EVENT, nf);
    case "Next LOS":
      return timeOr(s.next_los, NO_EVENT, nf);
    case "Lat":
      return fmtLatLon(s.lat_deg, "lat", 2, nf);
    case "Lon":
      return fmtLatLon(s.lon_deg, "lon", 2, nf);
    case "SSP":
      return s.ssp;
    case "Footp":
      return lengthText(s.footprint_km, 0, nf);
    case "Alt":
      return lengthText(s.alt_km, 0, nf);
    case "Vel":
      return lengthText(s.vel_kms, 3, nf);
    case "Dop":
      return fmtFixed(s.doppler_hz, 0);
    case "Loss":
      return fmtFixed(s.loss_db, 2);
    case "Del":
      return fmtFixed(s.delay_ms, 2);
    case "MA":
      return degrees(s.ma);
    case "Phase":
      return degrees(s.phase_deg);
    case "Orbit":
      return String(s.orbit);
    case "Vis":
      return s.vis;
    case "Decayed":
      return "";
    case "Status":
      return "Unknown";
    default:
      return "";
  }
}

/** The entries of `canonical` (the order of /api/meta) whose name is in `visible`, in the canonical order, whatever the order of `visible`. */
export function inCanonicalOrder<T extends { name: string }>(canonical: readonly T[], visible: readonly string[]): T[] {
  const wanted = new Set(visible);
  return canonical.filter((c) => wanted.has(c.name));
}

// ---------------------------------------------------------------- Single sat

const VISIBILITY: Readonly<Record<string, string>> = { "-": "Unknown", V: "Visible", D: "Daylight", E: "Eclipsed" };

/**
 * The Direction text of the Single sat view (gtk-single-sat.c): "Geostationary", "Decayed", "Receding", "Approaching" or "N/A".
 * The Dir symbols settle all but the turning ones (↺ ↷, range rate within 0.001 km/s of 0), which Gpredict tells by the
 * sign of the range rate: "N/A" when there is none or it is exactly 0.
 */
export function directionText(dir: string, rangeRate: number | null): string {
  switch (dir) {
    case "G":
      return "Geostationary";
    case "D":
      return "Decayed";
    case "↓":
      return "Receding";
    case "↑":
      return "Approaching";
    case "↺":
    case "↷":
      if (rangeRate === null) return "N/A";
      return rangeRate > 0 ? "Receding" : rangeRate < 0 ? "Approaching" : "N/A";
    default:
      return "N/A";
  }
}

/**
 * The value of one field of the Single sat view (ref §7, ref-D §2.1), with its unit (`mi` and `mi/sec` for Imperial). `field` is
 * the field's title. Undefined `s` is a satellite that is not in the tick (dropped by GMAT): every field is "-", as before the
 * first update. `nf` is the number format: the time format and zone of the times, N/S/E/W for SSP Lat. and SSP Lon.
 */
export function singleCell(field: string, s: SatState | undefined, nf: NumberFormat = DEFAULT_NF): string {
  if (s === undefined) return "-";
  switch (field) {
    case "Azimuth":
      return degrees(s.az, 6);
    case "Elevation":
      return degrees(s.el, 6);
    case "Direction":
      return directionText(s.dir, s.range_rate_kms);
    case "Right Asc.":
      return degrees(s.ra, 6);
    case "Declination":
      return degrees(s.dec, 6);
    case "Slant Range":
      return withLength(s.range_km, 0, nf);
    case "Range Rate":
      return withLength(s.range_rate_kms, 3, nf, true);
    case "Next Event": {
      const next = nextEventOf(s);
      return next === null ? "N/A" : `${next.kind}: ${fmtTimeNf(next.at, nf)}`;
    }
    case "Next AOS":
      return timeOr(s.next_aos, "N/A", nf);
    case "Next LOS":
      return timeOr(s.next_los, "N/A", nf);
    case "SSP Lat.":
      return fmtLatLon(s.lat_deg, "lat", 2, nf);
    case "SSP Lon.":
      return fmtLatLon(s.lon_deg, "lon", 2, nf);
    case "SSP Loc.":
      return s.ssp === "" ? "-" : s.ssp;
    case "Footprint":
      return withLength(s.footprint_km, 0, nf);
    case "Altitude":
      return withLength(s.alt_km, 0, nf);
    case "Velocity":
      return withLength(s.vel_kms, 3, nf, true);
    case "Doppler@100M":
      return withUnit(s.doppler_hz, 0, "Hz");
    case "Sig. Loss":
      return withUnit(s.loss_db, 2, "dB");
    case "Sig. Delay":
      return withUnit(s.delay_ms, 2, "msec");
    case "Mean Anom.":
      return degrees(s.ma);
    case "Orbit Phase":
      return degrees(s.phase_deg);
    case "Orbit Num.":
      return String(s.orbit);
    case "Visibility":
      return VISIBILITY[s.vis] ?? "-";
    default:
      return "-";
  }
}

// ---------------------------------------------------------------- Event list

/** The columns of the Event list "Upcoming passes" (ref §8): title, hint (tooltip of the header), alignment of the cells and of the header. */
export const EVENT_COLUMNS: readonly { title: string; hint: string; align: Align; headAlign: Align }[] = [
  { title: "Satellite", hint: "Satellite Name", align: "left", headAlign: "left" },
  { title: "Az", hint: "Azimuth", align: "right", headAlign: "center" },
  { title: "El", hint: "Elevation", align: "right", headAlign: "center" },
  { title: "AOS/LOS", hint: "Countdown until next event", align: "right", headAlign: "right" },
];

/** One row of the Event list. */
export interface EventRow {
  norad: number;
  name: string;
  az: string;
  el: string;
  /** "MM:SS", "HH:MM:SS" or "Never" */
  countdown: string;
  /** seconds from the tick's time to the event, null if there is none ("Never") */
  seconds: number | null;
  /** El > 0 */
  bold: boolean;
}

/**
 * The rows of the Event list for a tick (ref §8): a satellite above the horizon (El > 0) counts down to its LOS, one that is
 * not to its AOS, from the module time of the tick; "Never" when that event is not known. Smallest countdown first, "Never"
 * last (the order is by name within equal countdowns). Decayed satellites are left out.
 */
export function eventRows(tick: Tick): EventRow[] {
  const nowMs = Date.parse(tick.t);
  const rows = (tick.sats ?? [])
    .filter((s) => !isDecayed(s))
    .map((s): EventRow => {
      const above = s.el !== null && s.el > 0;
      const at = above ? s.next_los : s.next_aos;
      const seconds = at === null ? null : (Date.parse(at) - nowMs) / 1000;
      const known = seconds !== null && Number.isFinite(seconds);
      return {
        norad: s.norad,
        name: s.name,
        az: degrees(s.az),
        el: degrees(s.el),
        countdown: known ? fmtCountdown(seconds) : "Never",
        seconds: known ? seconds : null,
        bold: above,
      };
    });
  return rows.sort((a, b) => {
    if (a.seconds !== b.seconds) {
      if (a.seconds === null) return 1;
      if (b.seconds === null) return -1;
      return a.seconds - b.seconds;
    }
    return compareNames(a.name, b.name) || a.norad - b.norad;
  });
}
