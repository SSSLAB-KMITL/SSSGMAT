// The "Edit ground station data" dialog (ref §10): the form, the tooltips and how latitude, longitude and locator follow each
// other. Pure; QthEditor.tsx shows it.

import { normalizeLocator, toLocator, tryFromLocator } from "./locator";
import { isModuleName } from "./moduleName";
import { roundTo } from "./spin";
import type { Qth } from "./types";

/** The limits of the entries and spin buttons (sat-pref-qth-editor.c; the same limits the server checks, spec §7.1). */
export const QTH_LIMITS = { name: 25, description: 256, location: 50, weather: 4, locator: 6, lat: 90, lon: 180, alt: 5000 } as const;

/** Decimal places of the latitude and longitude spin buttons. */
export const COORDINATE_DIGITS = 4;

/** Gpredict's tooltips of the editor (ref §10). */
export const QTH_TIPS = {
  name: "Enter a short name for this ground station, e.g. callsign.\nAllowed characters: 0..9, a..z, A..Z, - and _",
  description: "Enter an optional description for this ground station.",
  location: "Optional location of the ground station, e.g. Copenhagen, Denmark.",
  selectLocation: "Select a location from a list",
  lat: "Select the latitude of the ground station in decimal degrees.",
  lon: "Select the longitude of the ground station in decimal degrees.",
  locator: "Maidenhead locator grid.",
  alt: "Select the altitude of the ground station in meters or feet depending on your settings",
  weather: "Four letter code for weather station",
  selectWeather: "Select a weather station",
} as const;

/** (ของเรา) the Select buttons stay off: this version has no list of cities and no list of weather stations. */
export const NO_CITY_LIST_TIP = "ยังไม่มีรายชื่อเมืองให้เลือก ให้พิมพ์ Location เอง";
export const NO_WEATHER_LIST_TIP = "ยังไม่มีรายชื่อสถานีอากาศให้เลือก ให้พิมพ์รหัส 4 ตัวอักษรเอง";

/**
 * What the editor shows. Latitude and longitude are the numbers of the spin buttons (0 to 90 and 0 to 180); South and West
 * are the combos next to them. `locator` is the text of the Locator entry.
 */
export interface QthForm {
  name: string;
  description: string;
  location: string;
  lat: number;
  south: boolean;
  lon: number;
  west: boolean;
  alt: number;
  weather: string;
  locator: string;
}

/** Nothing entered, North and East (a new station, and what Clear leaves). */
export const EMPTY_QTH_FORM: QthForm = {
  name: "",
  description: "",
  location: "",
  lat: 0,
  south: false,
  lon: 0,
  west: false,
  alt: 0,
  weather: "",
  locator: "",
};

const signed = (magnitude: number, negative: boolean): number => (negative ? -magnitude : magnitude);

/** The form for a station: the sign of the degrees goes into South / West, the altitude is whole metres, the locator is worked out. */
export function qthToForm(q: Qth): QthForm {
  return {
    name: q.name,
    description: q.description,
    location: q.location,
    lat: Math.abs(q.lat_deg),
    south: q.lat_deg < 0,
    lon: Math.abs(q.lon_deg),
    west: q.lon_deg < 0,
    alt: Math.round(q.alt_m),
    weather: q.weather_station,
    locator: toLocator(q.lat_deg, q.lon_deg),
  };
}

/** The station the form describes, for the server: South and West as negative degrees. */
export function formToQth(f: QthForm): Qth {
  return {
    name: f.name,
    description: f.description,
    location: f.location,
    lat_deg: signed(f.lat, f.south),
    lon_deg: signed(f.lon, f.west),
    alt_m: f.alt,
    weather_station: f.weather,
  };
}

/** The form after latitude, longitude, South or West changed: the locator follows (Gpredict's latlon_changed). */
export function editCoordinates(f: QthForm, change: Partial<Pick<QthForm, "lat" | "south" | "lon" | "west">>): QthForm {
  const next = { ...f, ...change };
  return { ...next, locator: toLocator(signed(next.lat, next.south), signed(next.lon, next.west)) };
}

/**
 * The form after the Locator entry changed to `text`: the entry shows it in the usual case (at most 6 characters), and while it
 * is a locator the coordinates follow, rounded to the spin buttons' four decimals (Gpredict's qra_changed). Text that is not a
 * locator yet leaves the coordinates alone.
 */
export function editLocator(f: QthForm, text: string): QthForm {
  const locator = normalizeLocator(text);
  const point = tryFromLocator(locator);
  if (point === null) return { ...f, locator };
  return {
    ...f,
    locator,
    lat: roundTo(Math.abs(point.lat), COORDINATE_DIGITS),
    south: point.lat < 0,
    lon: roundTo(Math.abs(point.lon), COORDINATE_DIGITS),
    west: point.lon < 0,
  };
}

/** What the Clear button leaves. */
export function clearQthForm(): QthForm {
  return { ...EMPTY_QTH_FORM };
}

/** Whether OK works: Gpredict switches it on once a name has been entered (its entry only lets valid characters in). */
export function canSaveQth(f: QthForm): boolean {
  return isModuleName(f.name);
}

/**
 * (ของเรา) Why a station cannot get `name`, in Thai, or null: Gpredict writes the station's file over an old one of that name
 * without a word, which here would change a station that modules use. `existing` are the names of the stations.
 */
export function qthNameError(name: string, existing: readonly string[]): string | null {
  if (name === "") return null;
  const same = existing.find((n) => n.toLowerCase() === name.toLowerCase());
  return same === undefined ? null : `มี ground station ชื่อ ${same} อยู่แล้ว`;
}
