// JSON shapes of the Gpredict Web server (spec §7.1-7.4). Times are ISO 8601 UTC strings ending in "Z".
// The web never computes orbits: every number below comes from the server.

import type { RadioState, RotatorState } from "./radio/types";

export type Level = "info" | "warning" | "error";

/** Message(code, level, text, object) of the engine; also the body of every API error (spec §7.4). */
export interface ApiMessage {
  code: string;
  level: Level;
  text: string;
  object: string | null;
}

// ---------------------------------------------------------------- QTH

export interface Qth {
  name: string;
  description: string;
  location: string;
  lat_deg: number;
  lon_deg: number;
  alt_m: number;
  weather_station: string;
}

export interface QthList {
  qth: Qth[];
  /** name of the default station ("** DEFAULT **"), null if there is none */
  default: string | null;
  /** one warning (QTH_INVALID, object = file name) for each QTH file the server skipped because it could not be read */
  messages: ApiMessage[];
}

/** The answer of PUT /api/qth/batch (also as a dry run): the stations as they are (sorted by name) and the default, and the modules that had to change. */
export interface QthBatchAnswer {
  qth: Qth[];
  default: string;
  /** modules that used a station that is gone and now say ** DEFAULT ** */
  changed_modules: string[];
}

/** One city of GET /api/locations: [continent, country, city, lat, lon, alt_m, icao] (lat and lon in degrees, south and west negative). */
export type LocationTuple = [continent: string, country: string, city: string, lat: number, lon: number, alt_m: number, icao: string];

/** GET /api/locations: the list behind the Select buttons of the ground station editor (sorted by continent, country, city). */
export interface LocationsAnswer {
  source: string;
  downloaded: string;
  locations: LocationTuple[];
}

// ---------------------------------------------------------------- satellites and TLE

export interface SatRecord {
  norad: number;
  name: string;
  groups: string[];
  epoch: string | null;
  updated: string | null;
  /** only from GET /api/satellites/{norad} */
  tle?: [string, string];
  /** only from GET /api/satellites/{norad}: Gpredict's operational status ("Operational", "Non-operational", ..., "Unknown") */
  status?: string;
  /** only from GET /api/satellites/{norad}: the Orbit Info of Satellite Info; null when the stored TLE cannot be read */
  orbit_info?: OrbitInfo | null;
}

/**
 * The "orbit_info" of GET /api/satellites/{norad} (ref-D §8.1): the values of the TLE as numbers, in the order of the rows of the
 * Orbit Info tab; the web writes them (satInfo.ts). `intl_designator` is the 8 raw characters of columns 10-17 (trailing spaces
 * included), `epoch` ISO 8601 UTC, `ecc` is at least 1e-6, `ndot2` is ½ d/dt and `nddot6` 1/6 d²/dt² of the mean motion, `bstar` is B* × ae.
 */
export interface OrbitInfo {
  name: string;
  status: string;
  catnum: number;
  intl_designator: string;
  element_set: number;
  epoch: string;
  revnum: number;
  incl_deg: number;
  raan_deg: number;
  ecc: number;
  argp_deg: number;
  ma_deg: number;
  mean_motion: number;
  ndot2: number;
  nddot6: number;
  bstar: number;
}

export interface TleGroup {
  name: string;
  last_request: string | null;
  last_success: string | null;
}

export interface TleUpdateResult {
  updated: number;
  skipped: number;
  missing: number;
  /** satellites added to the database; 0 unless `add_new` */
  new: number;
  /** satellites may be added (TLE/ADD_NEW_SATS): the box shows the line "New Satellites:"; false when no source answered */
  add_new: boolean;
  messages: ApiMessage[];
}

// ---------------------------------------------------------------- module

export interface Refresh {
  data_ms: number;
  list: number;
  map: number;
  polar: number;
  single: number;
  event: number;
}

export interface ModuleConfig {
  name: string;
  /** null = "** DEFAULT **" */
  qth: string | null;
  /** NORAD numbers */
  satellites: number[];
  layout_code: string;
  refresh: Refresh;
  list_columns: string[];
  list_sort: { column: string; ascending: boolean };
  map: {
    contents: Record<string, boolean>;
    track_orbits: number;
    center_lon: number;
    /** the background map: a file of Gpredict's maps or one uploaded to data/maps/ */
    file: string;
    /** the colours of the Map View page by the names of colors.ts' MAP_COLORS, each 0xRRGGBBAA (plan decision 5) */
    colours: Record<string, number>;
    /** "Shadow:" under the satellite markers, 0 (transparent) to 255 (opaque) */
    shadow_alpha: number;
  };
  polar: {
    orientation: string;
    contents: Record<string, boolean>;
    auto_skytrack: boolean;
    /** the colours of the Polar View page by the names of colors.ts' POLAR_COLORS, each 0xRRGGBBAA */
    colours: Record<string, number>;
  };
  single: { fields: string[]; selected: number | null };
  /** satellites with Highlight footprint switched off (on by default) */
  footprint_off: number[];
  ground_track: number[];
  sky_track: number[];
}

/**
 * What PUT /api/modules/{name} pins and unpins besides the configuration (paths of `Meta.module_keys`, plan decision 3): a pinned path
 * keeps the value sent as the module's own; an unpinned one is removed from the module, which inherits the global value again. A value
 * sent for a path that the module inherits and that is not pinned is not stored (the module goes on inheriting).
 */
export interface ModulePins {
  pin?: readonly string[];
  unpin?: readonly string[];
}

export interface ModuleList {
  modules: string[];
  /** open modules in tab order */
  open: string[];
  /** e.g. the Thai hint after an offline first start; empty once the user has created or edited a module */
  messages: ApiMessage[];
}

export interface CloneResult {
  module: ModuleConfig;
  open: string[];
}

/** One cell of a layout code: view `type` on grid lines left..right and top..bottom (right and bottom exclusive). */
export interface ViewCell {
  /** 0 List, 1 Map, 2 Polar, 3 Single sat, 4 Event list */
  type: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

// ---------------------------------------------------------------- clock

export type ClockState = "forward" | "backward" | "stop";

export interface ClockInfo {
  state: ClockState;
  throttle: number;
  /** "Real-Time", "Simulated Real-Time" or "Manual Control" */
  label: string;
}

export interface Clock extends ClockInfo {
  /** module time */
  time: string;
}

/** body of PUT /api/modules/{name}/clock: a missing or null field is left unchanged */
export interface ClockUpdate {
  state?: ClockState | null;
  throttle?: number | null;
  time?: string | null;
}

// ---------------------------------------------------------------- tick (WebSocket)

export type TickStatus = "ok" | "computing" | "failed";

/**
 * One satellite of a tick. The measured numbers are `number | null`: the server sends null instead of NaN/Infinity
 * (a rare, logged case, app.py `_finite`), so a view must handle null (`fmtFixed` shows it as "-"). `norad` and `orbit`
 * are always integers; `next_aos`, `next_los` and `always` are null when there is no such event.
 */
export interface SatState {
  norad: number;
  name: string;
  az: number | null;
  el: number | null;
  /** "↑" approaching, "↓" receding, "G" GEO, "D" decayed, "↺" / "↷" turning */
  dir: string;
  ra: number | null;
  dec: number | null;
  range_km: number | null;
  range_rate_kms: number | null;
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
  ma: number | null;
  phase_deg: number | null;
  orbit: number;
  /** "-", "V", "D" or "E" */
  vis: string;
  next_aos: string | null;
  next_los: string | null;
  /** "in" = always in range, "out" = always out of range, null = neither (no AOS/LOS in the window or normal pass) */
  always: "in" | "out" | null;
}

export interface Tick {
  /** module time */
  t: string;
  clock: ClockInfo;
  status: TickStatus;
  qth: { name: string; location: string; lat_deg: number; lon_deg: number; alt_m: number };
  /** sub-solar point */
  sun: { lat_deg: number; lon_deg: number };
  window: { start: string; stop: string };
  /** only when status is "ok" */
  sats?: SatState[];
  messages: ApiMessage[];
  /** only while the Radio Control of the module is open (sub-project 3): the state of its controller */
  radio?: RadioState;
  /** only while the Antenna Control of the module is open */
  rotator?: RotatorState;
}

// ---------------------------------------------------------------- tracks

/** GET /api/modules/{name}/track/{norad}: polylines of [lat, lon], split where they cross 180 degrees */
export interface TrackResult {
  lines: [number, number][][];
}

export interface SkyPoint {
  t: string;
  az: number;
  el: number;
}

export interface SkyTrackResult {
  points: SkyPoint[];
}

// ---------------------------------------------------------------- preferences

/** One value of Preferences: a number, a flag, a text (a colour "#rrggbb") or a list of names (the columns of a pass table). */
export type PrefValue = number | boolean | string | string[];

/**
 * GET and PUT /api/prefs (spec §8.2): `values` holds every key with the value in effect, `defaults` every key's default (so the
 * page needs no copy of them for its Reset buttons), `user` the keys the user has set (the others are at their default).
 */
export interface PrefsAnswer {
  values: Record<string, PrefValue>;
  defaults: Record<string, PrefValue>;
  user: string[];
}

// ---------------------------------------------------------------- GET /api/maps

/** A background map of the Map View: one of Gpredict's (`stock`) or one uploaded to data/maps/. `width` and `height` are in pixels. */
export interface MapEntry {
  file: string;
  stock: boolean;
  width: number;
  height: number;
  bytes: number;
}

/** GET /api/maps: the maps (Gpredict's first, in their order, then the uploaded ones by name) and the file the Map View draws by default. */
export interface MapList {
  maps: MapEntry[];
  default: string;
}

// ---------------------------------------------------------------- GET /api/meta

export interface Meta {
  list_columns: { name: string; hint: string }[];
  list_default: string[];
  list_sort_default: { column: string; ascending: boolean };
  single_fields: { name: string; hint: string }[];
  single_default: string[];
  map_contents: string[];
  map_track_orbits: { min: number; max: number; default: number };
  map_center_lon: { min: number; max: number; default: number };
  polar_orientations: string[];
  polar_contents: string[];
  layout_presets: { name: string; code: string }[];
  refresh_labels: Record<keyof Refresh, string>;
  refresh_ranges: { data_ms: [number, number]; cycle: [number, number] };
  module_defaults: Omit<ModuleConfig, "name">;
  max_sats: number;
  tle_groups: string[];
  qth_limits: {
    lat_deg: [number, number];
    lon_deg: [number, number];
    alt_m: [number, number];
    description: number;
    location: number;
    weather_station: number;
  };
  /**
   * The pages of Module properties and of Preferences → Modules: for each, the path of every value of a module it holds ("map.colours.grid")
   * and the key of Preferences the module inherits it from ("MODULES/MAP_GRID_COLOUR"), in the order of the page (spec §9.1)
   */
  module_keys: Record<"layout" | "refresh" | "list" | "map" | "polar" | "single", Record<string, string>>;
  /** the keys the Layout page of Preferences → Modules writes besides MODULES/GRID: the three Window Placements boxes (ref-D §10) */
  global_layout_extra: string[];
  /** the folder of the log files, which the Message Logs page names where Gpredict writes "<conf dir>/logs/" (plan decision 17) */
  log_dir: string;
}
