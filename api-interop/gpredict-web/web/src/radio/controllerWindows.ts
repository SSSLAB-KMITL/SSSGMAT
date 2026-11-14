// The Radio Control and Antenna Control windows of the page (ref-R §1, spec §3.3, §4.5, §4.6, decision 2 of the plan) as plain data:
// which windows are open, when one goes, the target of a module and the message boxes. No DOM and no React: App.tsx holds the
// list and ControllerWindowsHost.tsx shows it (not "ControllerWindows.tsx": on a disk that ignores case, that name would be taken
// for this file).
//
// The server owns the controllers. A window is open while its controller is: the list comes from GET /api/controllers when the
// page loads and after every open and close, a window that is open already is brought to the front instead of a second one, and
// a window goes when the ticks of its own socket stop carrying its controller (closed from another browser tab) or the socket is
// closed for good (its module was closed or deleted).

import { ApiError } from "../api";
import type { Selections } from "../selection";
import type { ApiMessage, ModuleConfig, Tick } from "../types";
import { shouldReconnect } from "../useModuleSocket";
import { POLAR_ORIENTATIONS } from "../views/polarGeom";
import type { ControllerKind, ControllerRef, RadioState, RotatorState } from "./types";

// ---------------------------------------------------------------- the open windows

/** An open window: the controller it shows, and a count that goes up when its menu item is chosen again (it then comes to the front). */
export interface ControllerWindow extends ControllerRef {
  raise: number;
}

export const sameRef = (a: ControllerRef, b: ControllerRef): boolean => a.module === b.module && a.kind === b.kind;

/** A key of a controller, for the set of the ones being closed and the keys of the windows. */
export const refKey = (r: ControllerRef): string => `${r.kind}:${r.module}`;

/** The windows with the one of `ref` added at the end, or, if it is open already, raised (ref-R §1: one window per module). */
export function mergeOpen(list: readonly ControllerWindow[], ref: ControllerRef): ControllerWindow[] {
  return list.some((w) => sameRef(w, ref))
    ? list.map((w) => (sameRef(w, ref) ? { ...w, raise: w.raise + 1 } : w))
    : [...list, { module: ref.module, kind: ref.kind, raise: 0 }];
}

/** The windows without the one of `ref`; the same list when it is not there. */
export function dropRef(list: readonly ControllerWindow[], ref: ControllerRef): readonly ControllerWindow[] {
  return list.some((w) => sameRef(w, ref)) ? list.filter((w) => !sameRef(w, ref)) : list;
}

/** The windows without the ones of `module` (closed or deleted from this page); the same list when it has none. */
export function dropModule(list: readonly ControllerWindow[], module: string): readonly ControllerWindow[] {
  return list.some((w) => w.module === module) ? list.filter((w) => w.module !== module) : list;
}

/** The module has a Radio Control or Antenna Control window: its Configure is blocked (ref-R §1, spec §4.6). */
export function hasModule(list: readonly ControllerWindow[], module: string): boolean {
  return list.some((w) => w.module === module);
}

/**
 * The windows of the controllers the server has open (`open`, the answer of GET /api/controllers). A window that is open stays as it
 * is (its place and its count), one whose controller the server does not have goes, and one the server has that is not shown comes at
 * the end. The controllers in `closing` (by `refKey`) are left out: their windows were closed and the server is still closing them.
 * The same list when nothing changes.
 */
export function syncWindows(
  list: readonly ControllerWindow[],
  open: readonly ControllerRef[],
  closing: ReadonlySet<string> = new Set(),
): readonly ControllerWindow[] {
  const wanted = open.filter((r) => !closing.has(refKey(r)));
  const kept = list.filter((w) => wanted.some((r) => sameRef(w, r)));
  const added = wanted.filter((r) => !kept.some((w) => sameRef(w, r)));
  if (added.length === 0 && kept.length === list.length) return list;
  return [...kept, ...added.map((r) => ({ module: r.module, kind: r.kind, raise: 0 }))];
}

// ---------------------------------------------------------------- a window and the ticks of its socket

/** The state of the window's controller in a tick: `radio` for Radio Control, `rotator` for Antenna Control; undefined while it is not open. */
export function controllerOf(tick: Tick | null, kind: "radio"): RadioState | undefined;
export function controllerOf(tick: Tick | null, kind: "rotator"): RotatorState | undefined;
export function controllerOf(tick: Tick | null, kind: ControllerKind): RadioState | RotatorState | undefined;
export function controllerOf(tick: Tick | null, kind: ControllerKind): RadioState | RotatorState | undefined {
  return tick === null ? undefined : kind === "radio" ? tick.radio : tick.rotator;
}

/** What a window has seen of its controller in the ticks of its socket. */
export interface Watch {
  /** a tick has carried the controller */
  seen: boolean;
  /** the ticks in a row, the last ones, that have not */
  missing: number;
}

export const WATCH_START: Watch = { seen: false, missing: 0 };

/**
 * A window that has not had its controller yet goes at the second tick in a row without it, not the first: a tick the server made
 * before it opened the controller can reach the window's new socket after the open has been answered.
 */
const MISSING_BEFORE_SEEN = 2;

/** The watch after one more tick; `has` is whether the tick carries the controller. The same watch when nothing changes. */
export function watchTick(w: Watch, has: boolean): Watch {
  if (has) return w.seen && w.missing === 0 ? w : { seen: true, missing: 0 };
  return { seen: w.seen, missing: w.missing + 1 };
}

/**
 * The window goes: its socket was closed for good (1000: the module was closed or deleted; 1008: it is not open, so it has no
 * controller), or the ticks no longer carry its controller (closed from another browser tab). A socket that reconnects (1001, 1006,
 * ...) keeps the window: the controller runs on in the server without it.
 */
export function windowGone(w: Watch, closeCode: number | null): boolean {
  if (closeCode !== null && !shouldReconnect(closeCode)) return true;
  return w.missing >= (w.seen ? 1 : MISSING_BEFORE_SEEN);
}

/**
 * The Polar plot of Antenna Control is drawn the way the module's Polar view is (ref-R §5.6): its orientation, and the station name
 * at the top left only while the Polar view's "QTH Info" is on. `polar` is null until the module's configuration has arrived (N/E/S/W,
 * no name till then); `qthName` is the station of the window's tick, null before the first one.
 */
export function rotPlotOf(polar: ModuleConfig["polar"] | null, qthName: string | null): { orientation: string; qthName: string | null } {
  if (polar === null) return { orientation: POLAR_ORIENTATIONS[0], qthName: null };
  return { orientation: polar.orientation, qthName: polar.contents["QTH Info"] === true ? qthName : null };
}

// ---------------------------------------------------------------- the target of a module (spec §3.3)

/**
 * The targets to send (POST /api/modules/{name}/target) when the selections of the modules change from `before` to `after` (Select
 * satellite, a click in a view, Autotrack): one for each module whose selected satellite is now another satellite. An unselect
 * (null) sends nothing: the controllers keep their satellite, as Gpredict's do.
 */
export function targetPosts(before: Selections, after: Selections): { module: string; norad: number }[] {
  if (before === after) return [];
  return Object.entries(after).flatMap(([module, norad]) => (norad !== null && before[module] !== norad ? [{ module, norad }] : []));
}

// ---------------------------------------------------------------- the message boxes (ref-R §1)

/** Gpredict's error box when there is no device of the kind (title "ERROR", one OK button). */
export const NO_CONFIG_TEXT: Readonly<Record<ControllerKind, string>> = {
  radio: "You have no radio configuration!\nPlease configure a radio first.",
  rotator: "You have no rotator configuration!\nPlease configure an antenna rotator first.",
};

/** What the server answers (409) to the open of a controller of a kind that has no device. */
const NO_CONFIG_CODE: Readonly<Record<ControllerKind, string>> = { radio: "NO_RADIO_CONFIG", rotator: "NO_ROTATOR_CONFIG" };

/** Gpredict's error box (no title, one OK button) for Configure while a controller window of the module is open. */
export const CONFIGURE_BLOCKED_TEXT =
  "A module can not be configured while the radio or rotator controller is active.\n\nPlease close the radio and rotator controllers and try again.";

/** A message box of the controllers: Gpredict's error dialog, with the title or without one. */
export interface ControllerBox {
  title: string | undefined;
  message: ApiMessage;
}

const errorBox = (title: string | undefined, code: string, text: string): ControllerBox => ({
  title,
  message: { code, level: "error", text, object: null },
});

export const CONFIGURE_BLOCKED_BOX: ControllerBox = errorBox(undefined, "CONTROLLER_ACTIVE", CONFIGURE_BLOCKED_TEXT);

/** The box for a refusal of the open of a controller: Gpredict's "ERROR" box when there is no device of the kind, else null (the server's Thai text goes to the notice strip). */
export function openRefusalBox(kind: ControllerKind, error: unknown): ControllerBox | null {
  return error instanceof ApiError && error.code === NO_CONFIG_CODE[kind] ? errorBox("ERROR", NO_CONFIG_CODE[kind], NO_CONFIG_TEXT[kind]) : null;
}
