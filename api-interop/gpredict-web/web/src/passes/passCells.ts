// The text of the cells of the Data tab of Pass details and of Upcoming passes (ref-P §2.2, §3.2). Pure functions, no DOM and
// no React. Every number comes from the server; a missing one (null) shows as "-" like the cells of the core views.
// The Number Formats of Preferences (ref-D §2.1) shape the cells: the time format and zone of every time, N/S/E/W for Lat and Lon (off,
// they end in a space), miles for Range, Rate, Footp, Alt and Vel (no unit text in a cell). With the default `nf` a cell is as before.

import { fmtFixed } from "../format";
import { DEFAULT_NF, fmtLatLon, fmtTimeNf } from "../numfmt";
import type { NumberFormat } from "../numfmt";
import { lengthText } from "../views/cells";
import type { Align } from "../views/cells";
import type { PassRow, PassSummary } from "./types";

export interface PassColumn {
  title: string;
  /** Gpredict's Hint: not shown in the window, it is the label of the column's check box in Preferences (ref-P §9.2, §9.3) */
  hint: string;
  /** horizontal alignment of the cells (the headers are all centred) */
  align: Align;
}

/** The 19 columns of the Data tab in Gpredict's fixed order (ref-P §2.2, `sat-pass-dialogs.c:98-162`). */
export const SINGLE_COLUMNS: readonly PassColumn[] = [
  { title: "Time", hint: "Time", align: "center" },
  { title: "Az", hint: "Azimuth", align: "right" },
  { title: "El", hint: "Elevation", align: "right" },
  { title: "Ra", hint: "Right Ascension", align: "right" },
  { title: "Dec", hint: "Declination", align: "right" },
  { title: "Range", hint: "Slant Range", align: "right" },
  { title: "Rate", hint: "Range Rate", align: "right" },
  { title: "Lat", hint: "Latitude", align: "right" },
  { title: "Lon", hint: "Longitude", align: "right" },
  { title: "SSP", hint: "Sub-Satellite Point", align: "left" },
  { title: "Footp", hint: "Footprint", align: "right" },
  { title: "Alt", hint: "Altitude", align: "right" },
  { title: "Vel", hint: "Velocity", align: "left" },
  { title: "Dop", hint: "Doppler Shift @ 100MHz", align: "right" },
  { title: "Loss", hint: "Signal Loss @ 100MHz", align: "left" },
  { title: "Del", hint: "Signal Delay", align: "left" },
  { title: "MA", hint: "Mean Anomaly", align: "right" },
  { title: "Phase", hint: "Orbit Phase", align: "right" },
  { title: "Vis", hint: "Visibility", align: "center" },
];

/** The 10 columns of Upcoming passes in Gpredict's fixed order (ref-P §3.2, `sat-pass-dialogs.c:56-94`). */
export const MULTI_COLUMNS: readonly PassColumn[] = [
  { title: "AOS", hint: "Acquisition of signal (AOS)", align: "center" },
  { title: "TCA", hint: "Time of Closest Approach (TCA)", align: "center" },
  { title: "LOS", hint: "Loss of signal (LOS)", align: "center" },
  { title: "Duration", hint: "Duration of pass", align: "center" },
  { title: "Max El", hint: "Maximum elevation", align: "right" },
  { title: "AOS Az", hint: "Azimuth at AOS", align: "right" },
  { title: "Max El Az", hint: "Az at max. elevation", align: "right" },
  { title: "LOS Az", hint: "Azimuth at LOS", align: "right" },
  { title: "Orbit", hint: "Orbit number", align: "right" },
  { title: "Vis", hint: "Visibility during pass", align: "center" },
];

/** `%.2f°`; "-" if missing. */
function degrees(x: number | null): string {
  const text = fmtFixed(x, 2);
  return text === "-" ? text : `${text}°`;
}

/**
 * The text of one cell of the Data tab (ref-P §2.2). `title` is the column's title; a title that is not one of the 19 gives "".
 * Gpredict's "--- N/A ---" for a time that is exactly 0 never comes: the server always sends the time of a row.
 * `nf` is the number format of Preferences (the default: UTC, signs, km).
 */
export function rowCell(row: PassRow, title: string, nf: NumberFormat = DEFAULT_NF): string {
  switch (title) {
    case "Time":
      return fmtTimeNf(row.t, nf);
    case "Az":
      return degrees(row.az);
    case "El":
      return degrees(row.el);
    case "Ra":
      return degrees(row.ra);
    case "Dec":
      return degrees(row.dec);
    case "Range":
      return lengthText(row.range_km, 0, nf);
    case "Rate":
      return lengthText(row.rate_kms, 3, nf);
    case "Lat":
      return fmtLatLon(row.lat_deg, "lat", 2, nf);
    case "Lon":
      return fmtLatLon(row.lon_deg, "lon", 2, nf);
    case "SSP":
      return row.ssp;
    case "Footp":
      return lengthText(row.footprint_km, 0, nf);
    case "Alt":
      return lengthText(row.alt_km, 0, nf);
    case "Vel":
      return lengthText(row.vel_kms, 3, nf);
    case "Dop":
      return fmtFixed(row.doppler_hz, 0);
    case "Loss":
      return fmtFixed(row.loss_db, 2);
    case "Del":
      return fmtFixed(row.delay_ms, 2);
    case "MA":
      return degrees(row.ma);
    case "Phase":
      return degrees(row.phase_deg);
    case "Vis":
      return row.vis;
    default:
      return "";
  }
}

const NO_DURATION = "- N/A -";

/** `%02d:%02d:%02d`, seconds truncated (ref-P §3.2); "- N/A -" if exactly 0 (Gpredict's test) or not a number. */
export function fmtDuration(seconds: number): string {
  if (seconds === 0 || !Number.isFinite(seconds)) return NO_DURATION;
  const total = Math.trunc(seconds);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(Math.floor(total / 3600))}:${two(Math.floor((total % 3600) / 60))}:${two(total % 60)}`;
}

/**
 * The text of one cell of Upcoming passes (ref-P §3.2). `title` is the column's title; a title that is not one of the 10 gives "".
 * `nf` is the number format of Preferences: it gives the time format and zone of AOS, TCA and LOS.
 */
export function passCell(p: PassSummary, title: string, nf: NumberFormat = DEFAULT_NF): string {
  switch (title) {
    case "AOS":
      return fmtTimeNf(p.aos, nf);
    case "TCA":
      return fmtTimeNf(p.tca, nf);
    case "LOS":
      return fmtTimeNf(p.los, nf);
    case "Duration":
      return fmtDuration((Date.parse(p.los) - Date.parse(p.aos)) / 1000);
    case "Max El":
      return degrees(p.max_el);
    case "AOS Az":
      return degrees(p.aos_az);
    case "Max El Az":
      return degrees(p.max_el_az);
    case "LOS Az":
      return degrees(p.los_az);
    case "Orbit":
      return String(p.orbit);
    case "Vis":
      return p.vis;
    default:
      return "";
  }
}
