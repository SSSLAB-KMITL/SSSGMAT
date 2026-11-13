// REST client: one function per route of the server (spec §7.3). Throws ApiError for status >= 400.

import type {
  ApiMessage,
  Clock,
  ClockUpdate,
  CloneResult,
  Meta,
  ModuleConfig,
  ModuleList,
  PrefsAnswer,
  PrefValue,
  Qth,
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
 * Send a request; throws ApiError if the server cannot be reached or answers with status >= 400.
 * Aborting `signal` (ของเรา: the Cancel of a pass request) is not a failure of the server: the fetch's own AbortError is let through.
 */
async function send(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
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

// ---------------------------------------------------------------- satellites and TLE

export function searchSatellites(q: string, group?: string) {
  const params = new URLSearchParams({ q });
  if (group) params.set("group", group);
  return request<{ satellites: SatRecord[] }>("GET", `/api/satellites?${params}`);
}
export const getSatellite = (norad: number) => request<SatRecord>("GET", `/api/satellites/${norad}`);
export const getTleGroups = () => request<{ groups: TleGroup[] }>("GET", "/api/tle/groups");
export const updateTle = () => request<TleUpdateResult>("POST", "/api/tle/update");

// ---------------------------------------------------------------- modules

export const getModules = () => request<ModuleList>("GET", "/api/modules");
export const getModule = (name: string) => request<ModuleConfig>("GET", moduleUrl(name));
export const putModule = (m: ModuleConfig) => request<ModuleConfig>("PUT", moduleUrl(m.name), m);
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

export const getPrefs = () => request<PrefsAnswer>("GET", "/api/prefs");
/**
 * Set the keys of `set` and remove (back to the default) the keys of `remove`; 422 PREFS_INVALID (ApiError, Thai text, `object` =
 * the key) if one is wrong, and then nothing is written. A key must not be in both: the server refuses that too.
 */
export const putPrefs = (set: Readonly<Record<string, PrefValue>>, remove: readonly string[]) =>
  request<PrefsAnswer>("PUT", "/api/prefs", { set, remove });

// ---------------------------------------------------------------- other

export const getMeta = () => request<Meta>("GET", "/api/meta");
/** (ของเรา) File → Quit stops the server */
export const quit = () => request<void>("POST", "/api/quit");

/** License.txt of the repo (Help → License) */
export async function getLicense(): Promise<string> {
  return (await send("GET", "/api/license")).text();
}

/** README of Gpredict Web (Help → Online help shows it in the page, no link to anywhere else) */
export async function getReadme(): Promise<string> {
  return (await send("GET", "/api/readme")).text();
}
