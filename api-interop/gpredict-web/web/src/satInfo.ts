// Satellite Info (ref-D §8, sat-info.c): the rows of the "Orbit Info" tab, the lines of each transponder of the "Transponders" tab, and
// the list of the windows that are open. Pure, no DOM and no React (components/SatInfoWindow.tsx draws them). The server sends the
// values of the TLE as numbers (`orbit_info` of GET /api/satellites/{norad}); every text here is written by the web, as Gpredict
// writes it, with the time in the number format of Preferences.

import { fmtFixed } from "./format";
import { fmtTimeNf } from "./numfmt";
import type { NumberFormat } from "./numfmt";
import type { Transponder } from "./radio/types";
import type { OrbitInfo } from "./types";

// ---------------------------------------------------------------- Orbit Info

/**
 * One row of the Orbit Info tab: the label on the left, the value on the right. `bold` is the first row (the satellite name).
 * `markup` says that `label` and `value` have `<sub>` and `<sup>` in them, as Gpredict's Pango markup has (the exponent of the units,
 * the 2s of "1/6 d²/dt²"): draw them with `scriptParts`. A text that is not marked as markup is written as it is (a satellite's name
 * may have any characters in it).
 */
export interface InfoRow {
  label: string;
  value: string;
  bold?: boolean;
  markup?: boolean;
}

/** The separator comes after this row (the seventh, "Orbit number @ epoch:"): the first row is 0 (ref-D §8.1). */
export const ORBIT_SEPARATOR_AFTER = 6;

/** The words Gpredict has for the operational status of a satellite (`sat-info.c:304-343`); anything else is "Unknown". */
const STATUSES: readonly string[] = ["Operational", "Non-operational", "Partially operational", "Backup/Standby", "Spare", "Extended Mission"];

/** "Operational Status:" as Gpredict says it. */
export const statusText = (status: string): string => (STATUSES.includes(status) ? status : "Unknown");

/** (ของเรา) What the Orbit Info tab says under the rows it can still show when the server could not read the satellite's TLE (`orbit_info` is null). */
export const UNREADABLE_TEXT = "อ่าน TLE ของดาวดวงนี้ไม่ได้ จึงแสดงค่าวงโคจรไม่ได้ (ตรวจไฟล์ satdb.json หรือ Update TLE data อีกครั้ง)";

/** C's `%.5e`: the exponent has a sign and at least two digits ("1.67170e-04"). "-" for a value that is not a number. */
function fmtExp(x: number, digits: number): string {
  if (!Number.isFinite(x)) return "-";
  const [mantissa, exponent] = x.toExponential(digits).split("e") as [string, string];
  return `${mantissa}e${exponent[0]}${exponent.slice(1).padStart(2, "0")}`;
}

/** `%.4f°`; "-" for a value that is not a number. */
const fmtDeg = (x: number): string => (Number.isFinite(x) ? `${fmtFixed(x, 4)}°` : "-");

/** `<number> [<unit>]`; "-" for a value that is not a number. */
const withUnit = (number: string, unit: string): string => (number === "-" ? "-" : `${number} [${unit}]`);

/**
 * The time of the epoch in the Time format of Preferences, UTC or local as the number format says. Gpredict builds it from the
 * year, the day and the fraction of the day (floored to the second), so a fraction of a second is not shown. A time that cannot be
 * read gives the placeholder of Gpredict's preview.
 */
function epochText(epoch: string, nf: NumberFormat): string {
  return fmtTimeNf(new Date(Math.floor(Date.parse(epoch) / 1000) * 1000), nf);
}

/**
 * The 16 rows of the Orbit Info tab, top to bottom (ref-D §8.1, `sat-info.c:291-510`); the separator goes after row
 * `ORBIT_SEPARATOR_AFTER`. "Epoch time:" is the epoch the server read (decision 12 of the plan), written in `nf`. Not shown, as in
 * Gpredict: period, current orbit number, decay, orbit type, next event.
 */
export function orbitInfoRows(info: OrbitInfo, nf: NumberFormat): InfoRow[] {
  return [
    { label: "Satellite name:", value: info.name, bold: true },
    { label: "Operational Status:", value: statusText(info.status) },
    { label: "Catalogue number:", value: String(info.catnum) },
    { label: "International designator:", value: info.intl_designator },
    { label: "Element set number:", value: String(info.element_set) },
    { label: "Epoch time:", value: epochText(info.epoch, nf) },
    { label: "Orbit number @ epoch:", value: String(info.revnum) },
    { label: "Inclination:", value: fmtDeg(info.incl_deg) },
    { label: "RAAN:", value: fmtDeg(info.raan_deg) },
    { label: "Eccentricity:", value: fmtFixed(info.ecc, 7) },
    { label: "Arg. of perigee:", value: fmtDeg(info.argp_deg) },
    { label: "Mean anomaly:", value: fmtDeg(info.ma_deg) },
    { label: "Mean motion:", value: withUnit(fmtFixed(info.mean_motion, 8), "rev/day") },
    { label: "½ d/dt (mean motion):", value: withUnit(fmtExp(info.ndot2, 5), "rev/day<sup>2</sup>"), markup: true },
    { label: "1/6 d<sup>2</sup>/dt<sup>2</sup> (mean motion):", value: withUnit(fmtExp(info.nddot6, 5), "rev/day<sup>3</sup>"), markup: true },
    { label: "B* drag term:", value: withUnit(fmtExp(info.bstar, 5), "R<sub>E</sub><sup>-1</sup>"), markup: true },
  ];
}

/**
 * (ของเรา) The rows Gpredict can still show when the TLE cannot be read (`orbit_info` is null): its name, status and catalogue number,
 * which come from the satellite's record. Gpredict itself does not open the window for a satellite it cannot read.
 */
export function unreadableRows(record: { norad: number; name: string; status?: string }): InfoRow[] {
  return [
    { label: "Satellite name:", value: record.name, bold: true },
    { label: "Operational Status:", value: statusText(record.status ?? "") },
    { label: "Catalogue number:", value: String(record.norad) },
  ];
}

/** A piece of a text with `<sub>` and `<sup>` in it: plain, or `script` "sub" (subscript) or "sup" (superscript). */
export interface ScriptPart {
  text: string;
  script?: "sub" | "sup";
}

/** Splits `text` at its `<sub>…</sub>` and `<sup>…</sup>`. Any other tag, and a tag that is not closed, stays in the text as it is. */
export function scriptParts(text: string): ScriptPart[] {
  const parts: ScriptPart[] = [];
  let from = 0;
  for (const m of text.matchAll(/<(sub|sup)>([^<]*)<\/\1>/g)) {
    if (m.index > from) parts.push({ text: text.slice(from, m.index) });
    parts.push({ text: m[2]!, script: m[1] as "sub" | "sup" });
    from = m.index + m[0].length;
  }
  if (from < text.length) parts.push({ text: text.slice(from) });
  return parts;
}

// ---------------------------------------------------------------- Transponders

/** A frequency in Hz as `%.4f` MHz. */
const mhz = (hz: number): string => fmtFixed(hz / 1e6, 4);

/** "Uplink: 145.8000 ‒ 145.9000 MHz" for a range (the dash is U+2012), "Uplink: 145.9000 MHz" for one frequency, nothing when the lower is 0. */
function linkLine(name: "Uplink" | "Downlink", low: number, high: number): string[] {
  if (!(low > 0)) return [];
  return [high > low ? `${name}: ${mhz(low)} ‒ ${mhz(high)} MHz` : `${name}: ${mhz(low)} MHz`];
}

/**
 * The lines under the name of a transponder, in Gpredict's order and words (ref-D §8.2, `sat-info.c:100-177`): Uplink, Downlink,
 * "Inverting: YES" or "NO" (only when both are ranges), "Mode: %s" (when there is a mode: the server sends "" for none, and the number
 * 0 as text when SatNOGS gave no mode, like Gpredict) and "Baudrate: %9.2f" (when it is not 0).
 */
export function transponderLines(t: Transponder): string[] {
  const lines = [...linkLine("Uplink", t.up_low, t.up_high), ...linkLine("Downlink", t.down_low, t.down_high)];
  if (t.down_high > t.down_low && t.up_high > t.up_low) lines.push(`Inverting: ${t.invert ? "YES" : "NO"}`);
  if (t.mode !== "") lines.push(`Mode: ${t.mode}`);
  if (t.baud !== 0) lines.push(`Baudrate: ${fmtFixed(t.baud, 2).padStart(9)}`);
  return lines;
}

// ---------------------------------------------------------------- the open windows

/** A Satellite Info window that is open. Any number can be: each opening makes a window of its own (ref-D §8), also for a satellite that has one. */
export interface SatInfoOpen {
  id: string;
  norad: number;
}

let lastId = 0;

/** The list with a new window for satellite `norad` added at the end (in front). */
export function openSatInfo(list: readonly SatInfoOpen[], norad: number): readonly SatInfoOpen[] {
  return [...list, { id: `satinfo:${++lastId}`, norad }];
}

/** The list without window `id`; the list itself if it is not there. */
export function closeSatInfo(list: readonly SatInfoOpen[], id: string): readonly SatInfoOpen[] {
  return list.some((w) => w.id === id) ? list.filter((w) => w.id !== id) : list;
}
