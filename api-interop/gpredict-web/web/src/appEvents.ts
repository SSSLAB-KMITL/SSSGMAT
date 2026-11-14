// The events of the program over WebSocket /ws/app (spec §5.3 and §12): the server tells every page that the Preferences or the list of
// modules changed and that the TLE data is old. (ของเรา: Gpredict is one program and needs no such channel.)
//
// The socket only tells the page to read again (or the text of the warning): what changed is read with the ordinary requests. The server
// does not replay events that were sent before a page connected, so the page reads everything again on every connect (`connected`).

import type { SocketLike } from "./useModuleSocket";

/** The socket is made again this long after it closed, whatever the reason and however often it has failed (plan: APP_WS_RETRY_MS). */
export const APP_WS_RETRY_MS = 2000;

export interface AppEventHandlers {
  /** the Preferences were saved (from this page or another) */
  prefsChanged(): void;
  /** a module was opened, closed, created, deleted, cloned, saved or changed its window */
  modulesChanged(): void;
  /** the TLE data is old: `text` is the message of Gpredict's notice, to show in a box */
  tleOld(text: string): void;
  /** the socket is open, at the first connect and after every reconnect: events sent while it was not are lost, so read the state again */
  connected?(): void;
}

export interface AppEventOptions {
  /** the socket's URL, by default on the page's own host (`appSocketUrl`) */
  url?: string;
  /** how a socket is made, by default the browser's WebSocket */
  createSocket?: (url: string) => SocketLike;
}

/** URL of the socket on the page's own host (in dev the Vite proxy forwards it to the server). */
export function appSocketUrl(loc: { protocol: string; host: string }): string {
  return `${loc.protocol === "https:" ? "wss" : "ws"}://${loc.host}/ws/app`;
}

type AppEvent = { type: "prefs_changed" } | { type: "modules_changed" } | { type: "tle_old"; text: string };

/** The event a message carries, or null for anything else (not JSON, not an object, a type this page does not know, a `tle_old` without text). */
function parseEvent(data: unknown): AppEvent | null {
  if (typeof data !== "string") return null;
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { type, text } = value as { type?: unknown; text?: unknown };
  if (type === "prefs_changed" || type === "modules_changed") return { type };
  return type === "tle_old" && typeof text === "string" ? { type, text } : null;
}

/**
 * Listen to /ws/app and call the handlers for its events; returns the function that stops listening (closes the socket, cancels a
 * reconnect, and nothing is reported after it, not even a late event of the old socket).
 *
 * A socket that closes (the server stopped or restarted, the network dropped, the server could not send to it) is made again after
 * `APP_WS_RETRY_MS`; so is a socket that could not be made. Every open calls `connected`.
 */
export function connectAppEvents(h: AppEventHandlers, options: AppEventOptions = {}): () => void {
  const create = options.createSocket ?? ((url: string) => new WebSocket(url));
  let socket: SocketLike | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let running = true;

  const scheduleRetry = () => {
    if (running) retry = setTimeout(connect, APP_WS_RETRY_MS);
  };

  function connect(): void {
    let made: SocketLike;
    try {
      made = create(options.url ?? appSocketUrl(window.location));
    } catch {
      scheduleRetry();
      return;
    }
    socket = made;
    const current = () => socket === made; // events of a replaced or stopped socket are not heard
    made.onopen = () => {
      if (current()) h.connected?.();
    };
    made.onmessage = (ev) => {
      if (!current()) return;
      const event = parseEvent(ev.data);
      if (event === null) return;
      if (event.type === "prefs_changed") h.prefsChanged();
      else if (event.type === "modules_changed") h.modulesChanged();
      else h.tleOld(event.text);
    };
    made.onerror = () => {
      // the close that follows decides what happens
    };
    made.onclose = () => {
      if (!current()) return;
      socket = null;
      scheduleRetry();
    };
  }

  connect();

  return () => {
    running = false;
    clearTimeout(retry);
    const old = socket;
    socket = null;
    if (old !== null) {
      old.onopen = old.onmessage = old.onclose = old.onerror = null;
      old.close(1000);
    }
  };
}

/**
 * `next`, or `previous` itself when `next` has the same content: a state set to what it already holds (React compares objects by
 * identity) re-renders nothing, so reading a list again after an event that changed nothing leaves the page as it is.
 */
export function keepIfSame<T>(previous: T, next: T): T {
  return JSON.stringify(previous) === JSON.stringify(next) ? previous : next;
}
