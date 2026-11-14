// The list of cities behind the Select buttons of the ground station editor (ref-D §3, loc-tree.c, spec §4.3): the rows of GET /api/locations,
// the tree they make (continent, country, city), the rows on show and the cells of each, copied from Gpredict's "Select Location" dialog.
// Pure but for the loader; components/LocationSelector.tsx shows it.

import { getLocations } from "./api";
import { fmtLatLon } from "./numfmt";
import type { NumberFormat } from "./numfmt";
import type { LocationsAnswer } from "./types";

/** One city (a station of NOAA's list: `icao` is the four letter weather station code). Latitude and longitude in degrees, south and west negative. */
export interface LocationRow {
  continent: string;
  country: string;
  city: string;
  lat: number;
  lon: number;
  alt_m: number;
  icao: string;
}

/** The rows of the answer of GET /api/locations, in the order the server sorted them. */
export function parseLocations(answer: LocationsAnswer): LocationRow[] {
  return answer.locations.map(([continent, country, city, lat, lon, alt_m, icao]) => ({ continent, country, city, lat, lon, alt_m, icao }));
}

/** The text the Select button of Location puts in the Location entry: "<city>, <country>" (`loc_tree_get_selection`, loc-tree.c:540-545). */
export const locationText = (row: LocationRow): string => `${row.city}, ${row.country}`;

// ---------------------------------------------------------------- the tree

export interface CountryNode {
  country: string;
  cities: LocationRow[];
}

export interface ContinentNode {
  continent: string;
  countries: CountryNode[];
}

/**
 * The tree of the rows: continents, the countries in each and the cities in each country, in the order the rows first name them. A country
 * that is in two continents has a node under each (the continents are NOAA's WMO regions, plan decision 11).
 */
export function locationTree(rows: readonly LocationRow[]): ContinentNode[] {
  const tree: ContinentNode[] = [];
  const continents = new Map<string, ContinentNode>();
  const countries = new Map<string, CountryNode>();
  for (const row of rows) {
    let continent = continents.get(row.continent);
    if (continent === undefined) {
      continent = { continent: row.continent, countries: [] };
      continents.set(row.continent, continent);
      tree.push(continent);
    }
    const countryKey = `${row.continent}\u0001${row.country}`;
    let country = countries.get(countryKey);
    if (country === undefined) {
      country = { country: row.country, cities: [] };
      countries.set(countryKey, country);
      continent.countries.push(country);
    }
    country.cities.push(row);
  }
  return tree;
}

/** A row of the tree on show: a continent or a country (which open and close and cannot be chosen) or a city (which can). */
export type TreeNode =
  | { kind: "continent"; key: string; depth: 0; label: string }
  | { kind: "country"; key: string; depth: 1; label: string }
  | { kind: "city"; key: string; depth: 2; label: string; row: LocationRow };

/** The rows that are on show: every continent, the countries of the continents that are open and the cities of the countries that are open. `open` holds keys. */
export function visibleNodes(tree: readonly ContinentNode[], open: ReadonlySet<string>): TreeNode[] {
  const nodes: TreeNode[] = [];
  for (const continent of tree) {
    const continentKey = `c\u0001${continent.continent}`;
    nodes.push({ kind: "continent", key: continentKey, depth: 0, label: continent.continent });
    if (!open.has(continentKey)) continue;
    for (const country of continent.countries) {
      const countryKey = `${continentKey}\u0001${country.country}`;
      nodes.push({ kind: "country", key: countryKey, depth: 1, label: country.country });
      if (!open.has(countryKey)) continue;
      country.cities.forEach((row, i) => nodes.push({ kind: "city", key: `${countryKey}\u0001${i}`, depth: 2, label: row.city, row }));
    }
  }
  return nodes;
}

/** The key of the country a city is in, or of the continent a country is in; null for a continent. */
export function parentKey(node: TreeNode): string | null {
  return node.kind === "continent" ? null : node.key.slice(0, node.key.lastIndexOf("\u0001"));
}

/**
 * The key of the row `delta` rows from the cursor, stopping at the ends; with no cursor (or a row that is not on show any more) the first row
 * going down and the last going up. null when no row is on show.
 */
export function moveCursor(nodes: readonly TreeNode[], cursor: string | null, delta: 1 | -1): string | null {
  if (nodes.length === 0) return null;
  const at = cursor === null ? -1 : nodes.findIndex((n) => n.key === cursor);
  if (at < 0) return (delta > 0 ? nodes[0] : nodes[nodes.length - 1])!.key;
  return nodes[Math.max(0, Math.min(nodes.length - 1, at + delta))]!.key;
}

// ---------------------------------------------------------------- the dialog

export const SELECT_LOCATION_TITLE = "Select Location";

/** The buttons of the dialog (GTK's "_Cancel" and "_OK"); OK is off until a city is chosen. */
export const SELECT_LOCATION_BUTTONS = { cancel: "Cancel", ok: "OK" } as const;

/** Which Select button opened the dialog: the one of Location (it fills the location, coordinates, altitude and weather station) or the one of Weather St. */
export type SelectMode = "location" | "weather";

/**
 * The columns each mode shows (`flags` in sat-pref-qth-editor.c:377-383): Location, Lat, Lon, Alt and WX, or just Location and WX. The Alt
 * column says nothing of the unit and is in metres whatever the Imperial setting is, as in Gpredict.
 */
export const SELECT_COLUMNS: Readonly<Record<SelectMode, readonly string[]>> = {
  location: ["Location", "Lat", "Lon", "Alt", "WX"],
  weather: ["Location", "WX"],
};

/** The cells of a city, one for each column of `mode`: lat and lon as `%.4f°` and the side (or a space), the altitude as a whole number (`%d`), the station. */
export function cityCells(row: LocationRow, mode: SelectMode, nf: NumberFormat): string[] {
  if (mode === "weather") return [row.city, row.icao];
  return [row.city, fmtLatLon(row.lat, "lat", 4, nf), fmtLatLon(row.lon, "lon", 4, nf), String(Math.trunc(row.alt_m)), row.icao];
}

/** The cells of any row: a continent or a country has only its name (Gpredict hides its numbers). */
export function nodeCells(node: TreeNode, mode: SelectMode, nf: NumberFormat): string[] {
  if (node.kind === "city") return cityCells(node.row, mode, nf);
  return [node.label, ...SELECT_COLUMNS[mode].slice(1).map(() => "")];
}

// ---------------------------------------------------------------- reading the list

/**
 * A function that reads the rows once and gives the same rows to every later caller (the list is some 600 kB and does not change while the
 * server runs). Callers that come while the read is under way share it; a read that fails is forgotten, so the next caller asks again.
 */
export function locationsLoader(get: () => Promise<LocationsAnswer>): () => Promise<LocationRow[]> {
  let reading: Promise<LocationRow[]> | null = null;
  return () => {
    if (reading === null) {
      const attempt = get().then(parseLocations);
      reading = attempt;
      attempt.catch(() => {
        if (reading === attempt) reading = null;
      });
    }
    return reading;
  };
}

/** The rows of the server's list. */
export const loadLocations = locationsLoader(getLocations);
