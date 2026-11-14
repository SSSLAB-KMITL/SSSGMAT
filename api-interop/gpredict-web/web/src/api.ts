// REST client: one function per route of the server (spec §7.3). Throws ApiError for status >= 400.

import type {
  ApiMessage,
  Clock,
  ClockUpdate,
  CloneResult,
  LocationsAnswer,
  MapEntry,
  MapList,
  Meta,
  ModuleConfig,
  ModuleList,
  ModulePins,
  PrefsAnswer,
  PrefValue,
  Qth,
  QthBatchAnswer,
  QthList,
  SatRecord,
  SkyTrackResult,
  TleGroup,
  TleUpdateResult,
  TrackResult,
} from "./types";

/** An error answer of the server: {code, level, text, object} (spec §7.4), or a failure to get one. */
export class ApiError extends Error {
  readonly code: string;
  readonly text: string;
  readonly level: string;
  readonly object: string | null;
  /** HTTP status, 0 if the server could not be reached */
  readonly status: number;

  constructor(code: string, text: string, status: number, level = "error", object: string | null = null) {
    super(text);
    this.name = "ApiError";
    this.code = code;
    this.text = text;
    this.status = status;
    this.level = level;
    this.object = object;
  }
}

/** The Thai text to show for any thrown value. */
export function errorText(e: unknown): string {
  return e instanceof ApiError ? e.text : e instanceof Error ? e.message : String(e);
}

function isApiMessage(v: unknown): v is ApiMessage {
  return typeof v === "object" && v !== null && typeof (v as ApiMessage).code === "string" && typeof (v as ApiMessage).text === "string";
}

/**
 * Send a request (`init` has the method, headers and body); throws ApiError if the server cannot be reached or answers with status >= 400.
 * Aborting `signal` (ของเรา: the Cancel of a pass request) is not a failure of the server: the fetch's own AbortError is let through.
 */
async function fetchChecked(path: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(path, { ...init, signal });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new ApiError("NETWORK_ERROR", "ติดต่อ server ไม่ได้ (server ปิดอยู่หรือเครือข่ายขัดข้อง)", 0);
  }
  if (res.status >= 400) {
    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      // not the server's JSON (a proxy's page, for instance)
    }
    if (isApiMessage(parsed)) {
      throw new ApiError(parsed.code, parsed.text, res.status, parsed.level, parsed.object ?? null);
    }
    throw new ApiError(`HTTP_${res.status}`, `คำขอไม่สำเร็จ (HTTP ${res.status})`, res.status);
  }
  return res;
}

/** `fetchChecked` for a request with a JSON body, or none. */
const send = (method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<Response> =>
  fetchChecked(
    path,
    {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    signal,
  );

/** One call of the server: the JSON answer (undefined for a 204). `signal` aborts it. Throws ApiError, or AbortError after an abort. */
export async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await send(method, path, body, signal);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const seg = encodeURIComponent;
export const moduleUrl = (name: string) => `/api/modules/${seg(name)}`;

// ---------------------------------------------------------------- QTH

export const getQthList = () => request<QthList>("GET", "/api/qth");
export const getQth = (name: string) => request<Qth>("GET", `/api/qth/${seg(name)}`);
export const putQth = (q: Qth) => request<Qth>("PUT", `/api/qth/${seg(q.name)}`, q);
export const deleteQth = (name: string) => request<void>("DELETE", `/api/qth/${seg(name)}`);

/**
 * Replaces all the ground stations and the default one in one call (Preferences → Ground Stations, OK): every station is checked first
 * (422 QTH_INVALID for a wrong field, two names that differ only in case, or a default that is not in the list; 422 QTH_LAST for an empty
 * list) and then nothing is written; the stations that are not in the list are deleted. `dryRun`: the same check and answer, nothing written.
 */
export const putQthBatch = (d: { stations: readonly Qth[]; default: string }, o?: WriteOptions) =>
  request<QthBatchAnswer>("PUT", writeUrl("/api/qth/batch", o), { stations: d.stations, default: d.default });

/** The cities and weather stations of the Select buttons of the ground station editor (spec §4.3); about 600 kB, so locations.ts keeps the answer. */
export const getLocations = () => request<LocationsAnswer>("GET", "/api/locations");

// ---------------------------------------------------------------- satellites and TLE

export function searchSatellites(q: string, group?: string) {
  const params = new URLSearchParams({ q });
  if (group) params.set("group", group);
  return request<{ satellites: SatRecord[] }>("GET", `/api/satellites?${params}`);
}
export const getSatellite = (norad: number) => request<SatRecord>("GET", `/api/satellites/${norad}`);
export const getTleGroups = () => request<{ groups: TleGroup[] }>("GET", "/api/tle/groups");
export const updateTle = () => request<TleUpdateResult>("POST", "/api/tle/update");
/** Edit → Update TLE data from local files: the text of the files of the chosen folder (the browser cannot give the server a path, plan decision 2). */
export const updateTleLocal = (body: { files: readonly { name: string; text: string }[] }) => request<TleUpdateResult>("POST", "/api/tle/local", body);

// ---------------------------------------------------------------- modules

export const getModules = () => request<ModuleList>("GET", "/api/modules");
export const getModule = (name: string) => request<ModuleConfig>("GET", moduleUrl(name));
/**
 * Saves the whole configuration; the answer is what the module uses then. `opts`: the paths of `Meta.module_keys` to pin (the module keeps
 * the values sent as its own) and to unpin (it inherits the global values again); a value of a path the module inherits and that is not
 * pinned is not stored (plan decision 3). 422 MODULE_INVALID for a path that is not one of them.
 */
export const putModule = (m: ModuleConfig, opts?: ModulePins) =>
  request<ModuleConfig>("PUT", moduleUrl(m.name), opts === undefined ? m : { ...m, ...opts });
export const deleteModule = (name: string) => request<void>("DELETE", moduleUrl(name));
export const openModule = (name: string) => request<{ open: string[] }>("POST", `${moduleUrl(name)}/open`);
export const closeModule = (name: string) => request<{ open: string[] }>("POST", `${moduleUrl(name)}/close`);
export const cloneModule = (name: string, newName: string, open: boolean) =>
  request<CloneResult>("POST", `${moduleUrl(name)}/clone`, { new_name: newName, open });
export const putTabs = (open: string[]) => request<{ open: string[] }>("PUT", "/api/session/tabs", { open });
/** Re-run the current GMAT window after a failure (ของเรา: the Retry button). */
export const retryModule = (name: string) => request<void>("POST", `${moduleUrl(name)}/retry`);

// ---------------------------------------------------------------- clock and tracks

export const getClock = (name: string) => request<Clock>("GET", `${moduleUrl(name)}/clock`);
export const putClock = (name: string, c: ClockUpdate) => request<Clock>("PUT", `${moduleUrl(name)}/clock`, c);
export const resetClock = (name: string) => request<Clock>("POST", `${moduleUrl(name)}/clock/reset`);
export const getTrack = (name: string, norad: number) => request<TrackResult>("GET", `${moduleUrl(name)}/track/${norad}`);
/** 404 NOT_FOUND (ApiError) while the satellite is below the horizon */
export const getSkyTrack = (name: string, norad: number) =>
  request<SkyTrackResult>("GET", `${moduleUrl(name)}/skytrack/${norad}`);

// ---------------------------------------------------------------- preferences

export interface WriteOptions {
  /** the server checks everything and answers as it would after the write, and writes nothing (and tells no other page of it) */
  dryRun?: boolean;
}

/** `?dry_run=true` for a PUT that checks and answers like the real one but writes nothing (Preferences' OK checks every part first). */
export const writeUrl = (path: string, o?: WriteOptions): string => (o?.dryRun === true ? `${path}?dry_run=true` : path);

export const getPrefs = () => request<PrefsAnswer>("GET", "/api/prefs");
/**
 * Set the keys of `set` and remove (back to the default) the keys of `remove`; 422 PREFS_INVALID (ApiError, Thai text, `object` =
 * the key) if one is wrong, and then nothing is written. A key must not be in both: the server refuses that too.
 * `dryRun`: the same check and answer (the values as they would be), nothing written.
 */
export const putPrefs = (set: Readonly<Record<string, PrefValue>>, remove: readonly string[], o?: WriteOptions) =>
  request<PrefsAnswer>("PUT", writeUrl("/api/prefs", o), { set, remove });

// ---------------------------------------------------------------- background maps

/** The maps of the Map View's "Select Map" dialog (GET /api/maps) and the one the Map View draws by default. */
export const getMaps = () => request<MapList>("GET", "/api/maps");

/**
 * Uploads an image as the map `name` (POST /api/maps?name=): the raw bytes as the body, `contentType` image/png or image/jpeg to match the
 * name's extension, at most MAP_UPLOAD_MAX. Answers the new entry of the list. 422 MAP_INVALID (ApiError, Thai text) for a name, a type, a size or
 * an image the server does not take; a body far over the limit may instead end as a network error (NETWORK_ERROR), the connection being closed.
 */
export async function uploadMap(name: string, contentType: string, image: Blob): Promise<MapEntry> {
  const res = await fetchChecked(`/api/maps?name=${seg(name)}`, { method: "POST", headers: { "Content-Type": contentType }, body: image });
  return (await res.json()) as MapEntry;
}

// ---------------------------------------------------------------- other

export const getMeta = () => request<Meta>("GET", "/api/meta");
/** (ของเรา) File → Quit stops the server */
export const quit = () => request<void>("POST", "/api/quit");

/**
 * File → Log browser: the text of gpredict.log of this run of the server, read once when the window opens; "" when there is no file (or it
 * cannot be read). logParse.ts reads the lines.
 */
export async function getCurrentLog(): Promise<string> {
  return (await send("GET", "/api/logs/current")).text();
}

/**
 * One line for the log (ref-D §7.2): `level` 1 ERROR, 2 WARNING, 3 INFO or 4 DEBUG, the name of the `fn` that writes it
 * (`^[A-Za-z_][A-Za-z0-9_]{0,63}$`) and `text` (1 to 500 characters; a text that begins with "<fn>: " is not given the prefix again, and one
 * of several lines is written as several lines). The server writes it if its level is not above the level of Preferences → Message
 * Logs; 422 LOG_INVALID (ApiError) if something is wrong with the three.
 */
export const postLog = (level: 1 | 2 | 3 | 4, fn: string, text: string) => request<void>("POST", "/api/log", { level, function: fn, text });

/** License.txt of the repo (Help → License) */
export async function getLicense(): Promise<string> {
  return (await send("GET", "/api/license")).text();
}

/** README of Gpredict Web (Help → Online help shows it in the page, no link to anywhere else) */
export async function getReadme(): Promise<string> {
  return (await send("GET", "/api/readme")).text();
}
