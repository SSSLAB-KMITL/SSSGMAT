// The Ground Stations tab of Preferences → General (ref-D §3, ref §10, sat-pref-qth.c): the list as the window holds it until OK, its rows,
// the default station, Add / Edit / Delete, and the check and the write that OK runs. Pure: GroundStationsPage.tsx shows it.
// Nothing is written until OK: like Gpredict, Delete, Edit, Add and the Default boxes change the list only (Cancel throws it away).

import { ApiError, putQthBatch } from "../api";
import { toLocator } from "../locator";
import { fmtFixed } from "../format";
import { fmtLatLon, mToFt } from "../numfmt";
import type { NumberFormat } from "../numfmt";
import type { Qth, QthList } from "../types";
import { TabError } from "./prefPlaces";

/** The name of the tab, as an error of the window names it ("General → Ground Stations: ..."); the second tab of General (`GENERAL_TABS`). */
export const GROUND_STATIONS_TAB = "Ground Stations";

/** The list as the window holds it: the stations, sorted by name, and the name of the default station (always one of them). */
export interface StationsDraft {
  stations: Qth[];
  default: string;
}

/** Gpredict sorts its list by name, ascending, in the order of the locale: case does not decide, and the code point only breaks a tie. */
const compareStationNames = (a: string, b: string): number =>
  a.toLowerCase().localeCompare(b.toLowerCase()) || (a < b ? -1 : a > b ? 1 : 0);

const byName = (a: Qth, b: Qth): number => compareStationNames(a.name, b.name);

/**
 * The draft for what the server has (GET /api/qth). A server that has no default, or names one that is not in the list, is shown with the
 * first station by name as the default, which is what the server needs when OK writes the list (the default must be one of the stations).
 */
export function initialDraft(list: Pick<QthList, "qth" | "default">): StationsDraft {
  const stations = [...list.qth].sort(byName);
  const named = list.default !== null && stations.some((s) => s.name === list.default);
  return { stations, default: named ? list.default! : (stations[0]?.name ?? "") };
}

// ---------------------------------------------------------------- the table

/** The buttons under the table and their tooltips (`sat-pref-qth.c:498-512`). */
export const STATION_BUTTONS = {
  add: { label: "Add new", tip: "Add a new ground station to the list" },
  edit: { label: "Edit", tip: "Edit the selected ground station" },
  delete: { label: "Delete", tip: "Delete selected ground station" },
} as const;

/** The message box of Delete when the list has one station (`delete_cb`, `sat-pref-qth.c:581-598`). */
export const LAST_STATION_MESSAGE =
  "Can not delete ground station!\n\n" +
  "You need to have at least one ground\n" +
  "station set up, otherwise gpredict may\n" +
  "not work properly.";

/** The header of the altitude column: Gpredict chooses it when the page is built (`sat-pref-qth.c:199-213`); here it follows the Imperial box at once. */
export const altHeader = (imperial: boolean): string => (imperial ? "Alt\n(ft)" : "Alt\n(m)");

/** The headers of the table (GPSD columns exist only in builds with libgps; a "WX" column is commented out in Gpredict). */
export const stationColumns = (imperial: boolean): string[] => ["Name", "Location", "Lat", "Lon", altHeader(imperial), "QRA", "Default"];

export interface StationRow {
  name: string;
  location: string;
  lat: string;
  lon: string;
  alt: string;
  qra: string;
  isDefault: boolean;
}

/**
 * The rows of the table, sorted by name: Lat and Lon as `%.4f°` and the side (or a space, `fmtLatLon`), Alt as `%.0f` in metres or feet
 * (feet with Imperial on), QRA the six-character locator of the coordinates, Default for the default station only. (Gpredict cuts the
 * feet to a whole number; this rounds, because the station keeps its metres and a height typed as 328 ft is 99.97 m, which cutting would show as 327.)
 */
export function stationRows(d: StationsDraft, nf: NumberFormat): StationRow[] {
  return [...d.stations].sort(byName).map((q) => ({
    name: q.name,
    location: q.location,
    lat: fmtLatLon(q.lat_deg, "lat", 4, nf),
    lon: fmtLatLon(q.lon_deg, "lon", 4, nf),
    alt: fmtFixed(nf.imperial ? mToFt(q.alt_m) : q.alt_m, 0),
    qra: toLocator(q.lat_deg, q.lon_deg),
    isDefault: q.name === d.default,
  }));
}

// ---------------------------------------------------------------- default, delete, add and edit

/**
 * `name` becomes the only default station. Ticking the default station again changes nothing (Gpredict ignores it: only an INFO line is logged
 * and the box stays ticked), and neither does a name that is not in the list: the same draft comes back.
 */
export function setDefault(d: StationsDraft, name: string): StationsDraft {
  if (name === d.default || !d.stations.some((s) => s.name === name)) return d;
  return { ...d, default: name };
}

/**
 * The draft without the station `name`; "last" if the list has fewer than two stations (Gpredict counts the rows, selected or not, and shows
 * LAST_STATION_MESSAGE). Deleting the default makes the first station by name the default. A name that is not in the list changes nothing.
 */
export function deleteStation(d: StationsDraft, name: string): StationsDraft | "last" {
  if (d.stations.length < 2) return "last";
  if (!d.stations.some((s) => s.name === name)) return d;
  const stations = d.stations.filter((s) => s.name !== name);
  return { stations, default: name === d.default ? [...stations].sort(byName)[0]!.name : d.default };
}

/**
 * The draft with `q` added (`oldName` null: a new station, never the default) or put in place of the station `oldName` (an edit, which can rename
 * it; renaming the default keeps it the default). The list stays sorted by name. The editor has refused a name that another station has.
 */
export function putStation(d: StationsDraft, oldName: string | null, q: Qth): StationsDraft {
  const others = oldName === null ? d.stations : d.stations.filter((s) => s.name !== oldName);
  return { stations: [...others, q].sort(byName), default: oldName !== null && oldName === d.default ? q.name : d.default };
}

const sameStation = (a: Qth, b: Qth): boolean =>
  a.name === b.name &&
  a.description === b.description &&
  a.location === b.location &&
  a.lat_deg === b.lat_deg &&
  a.lon_deg === b.lon_deg &&
  a.alt_m === b.alt_m &&
  a.weather_station === b.weather_station;

/** Whether the lists differ in a station, a station's field or the default (the order does not count): whether OK has something to write. */
export function stationsChanged(a: StationsDraft, b: StationsDraft): boolean {
  if (a.default !== b.default || a.stations.length !== b.stations.length) return true;
  const other = new Map(b.stations.map((s) => [s.name, s]));
  return a.stations.some((s) => {
    const t = other.get(s.name);
    return t === undefined || !sameStation(s, t);
  });
}

// ---------------------------------------------------------------- what OK does

/** What OK writes: the draft, or null when it is the list the server had (the user changed nothing, or changed it back) and there is nothing to send. */
export const stationsBody = (original: StationsDraft, now: StationsDraft): StationsDraft | null => (stationsChanged(original, now) ? now : null);

/** A refusal of the server (422 QTH_INVALID or QTH_LAST) is shown with the tab it is about; any other failure (the server is not there) as it is. */
const inTab = (e: unknown): unknown => (e instanceof ApiError && e.status === 422 ? new TabError(GROUND_STATIONS_TAB, e.text) : e);

/** The check before OK writes anything: the same list as a dry run (PUT /api/qth/batch?dry_run=true). Rejects with a TabError of this tab if it is refused. */
export async function checkStations(d: StationsDraft, put: typeof putQthBatch = putQthBatch): Promise<void> {
  try {
    await put(d, { dryRun: true });
  } catch (e) {
    throw inTab(e);
  }
}

/** The write: the whole list and the default replace the stations on the server (PUT /api/qth/batch). Rejects like `checkStations`. */
export async function commitStations(d: StationsDraft, put: typeof putQthBatch = putQthBatch): Promise<void> {
  try {
    await put(d);
  } catch (e) {
    throw inTab(e);
  }
}
