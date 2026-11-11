// JSON shapes of the Gpredict Web server (spec §7.1-7.4). Times are ISO 8601 UTC strings ending in "Z".
// The web never computes orbits: every number below comes from the server.

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
  map: { contents: Record<string, boolean>; track_orbits: number; center_lon: number };
  polar: { orientation: string; contents: Record<string, boolean>; auto_skytrack: boolean };
  single: { fields: string[]; selected: number | null };
  /** satellites with Highlight footprint switched off (on by default) */
  footprint_off: number[];
  ground_track: number[];
  sky_track: number[];
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
 * One satellite of a tick. Numbers are plain JSON numbers; the server sends null instead of NaN/Infinity
 * (a rare, logged case), which `fmtFixed` shows as "-".
 */
export interface SatState {
  norad: number;
  name: string;
  az: number;
  el: number;
  /** "↑" approaching, "↓" receding, "G" GEO, "D" decayed, "↺" / "↷" turning */
  dir: string;
  ra: number;
  dec: number;
  range_km: number;
  range_rate_kms: number;
  lat_deg: number;
  lon_deg: number;
  /** 6-character Maidenhead locator */
  ssp: string;
  footprint_km: number;
  alt_km: number;
  vel_kms: number;
  doppler_hz: number;
  loss_db: number;
  delay_ms: number;
  ma: number;
  phase_deg: number;
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
}
