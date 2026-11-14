// The logic of the Radio Control window that has no DOM (ref-R §2): the read-out formats, the tooltips, the Filter, the edits that
// the server has not answered yet. RadioControl.tsx shows it. Pure functions: nothing here reads the page or calls the server.

import { compareNames } from "../views/cells";
import type { ControllerSat } from "./types";

// ---------------------------------------------------------------- read-out formats (ref-R §2.2, §2.4)

/**
 * C's `%.nf`, which prints the minus sign of a negative zero: `(-0).toFixed(0)` is "0" in JavaScript, `printf("%.0f", -0.0)` prints "-0".
 * The server sends the Doppler shift as -0.0 at a range rate of 0 (`-f * rr / c`).
 */
function fixed(x: number, digits: number): string {
  return Object.is(x, -0) ? `-${(0).toFixed(digits)}` : x.toFixed(digits);
}

const measured = (x: number | null): x is number => x !== null && Number.isFinite(x);

/** `%.0f Hz`; "---- Hz" before the first tick (the server sends null until then, and instead of a number that is not finite). */
export function fmtDoppler(hz: number | null): string {
  return measured(hz) ? `${fixed(hz, 0)} Hz` : "---- Hz";
}

/** `%.0f MHz`, the LO of the radio (whole MHz). */
export function fmtLo(mhz: number): string {
  return `${fixed(mhz, 0)} MHz`;
}

/** `%7.2f°` for Az and El; "   0.00°", what Gpredict starts with, while there is no value. */
export function fmtAngle(v: number | null): string {
  return `${fixed(measured(v) ? v : 0, 2).padStart(7)}°`;
}

/** `%.0f km`; "0 km", what Gpredict starts with, while there is no value (decision 16 of the plan: km until Imperial units come). */
export function fmtRange(km: number | null): string {
  return measured(km) ? `${fixed(km, 0)} km` : "0 km";
}

/** `%.3f km/s`; "0.0 km/s", what Gpredict starts with (one decimal, unlike the format), while there is no value. */
export function fmtRate(kms: number | null): string {
  return measured(kms) ? `${fixed(kms, 3)} km/s` : "0.0 km/s";
}

// ---------------------------------------------------------------- the satellite and transponder combos (ref-R §2.4)

/** The transponder combo's text is at most this many characters wide and ellipsized at the end (`width-chars` and `max-width-chars` 30). */
export const TRANSPONDER_CHARS = 30;

/** `name` shortened to `max` characters with "…" as the last one when it is longer (Pango's PANGO_ELLIPSIZE_END). */
export function ellipsize(name: string, max: number = TRANSPONDER_CHARS): string {
  const chars = Array.from(name); // by character, not by UTF-16 unit
  return chars.length <= max ? name : `${chars.slice(0, Math.max(max - 1, 0)).join("")}…`;
}

/** What GtkSearchEntry waits after the last key before "search-changed" (the Filter of Radio Control and Antenna Control). */
export const FILTER_DELAY_MS = 150;

/**
 * The satellites of the combo for the text of the "Filter..." entry: those whose name has the text, ignoring case (`strcasestr`); an empty
 * text keeps all. In the order of the combo, which is the name order of Sky at a glance (plan decision 17: ignoring case, numbers by
 * value, the same name by NORAD). The server sends them in that order; sorting here makes the combo independent of that.
 */
export function filterSats(sats: readonly ControllerSat[], text: string): ControllerSat[] {
  const needle = text.toLowerCase();
  return sats.filter((s) => s.name.toLowerCase().includes(needle)).sort((a, b) => compareNames(a.name, b.name) || a.norad - b.norad);
}

// ---------------------------------------------------------------- window

/** The title of the window (`gtk-sat-module-popup.c`): the name of the module follows the colon. */
export function radioTitle(module: string): string {
  return `Gpredict Radio Control: ${module}`;
}

/** The count-down before any AOS or LOS time is known (the server's `COUNTDOWN_IDLE`) is "large" like Gpredict's first label; from the first time on it is "xx-large". */
export function countdownSize(text: string): "large" | "xx-large" {
  return text.startsWith("ΔT") ? "large" : "xx-large";
}

const TYPING_TARGETS: ReadonlySet<string> = new Set(["INPUT", "SELECT", "TEXTAREA"]);

/**
 * Does this key press switch PTT? Gpredict's window takes SPACE for an FT817/857/897 (manual) radio (`key_press_cb`), and `spacePtt` says
 * the radio is one. (ของเรา) Not for a space typed into the Filter or the Cycle, or one that opens a list: in GTK the focused entry or
 * combo is given the key first and keeps it. `tag` is the tag name of the element that has the focus, in capitals.
 */
export function isPttSpace(key: string, spacePtt: boolean, tag: string): boolean {
  return spacePtt && key === " " && !TYPING_TARGETS.has(tag);
}

/** What the window does with a key event (`isPttSpace`): "toggle" switches PTT, "swallow" only keeps the key from the page, null lets it pass. */
export type PttKey = "toggle" | "swallow" | null;

/**
 * The window's handling of a SPACE that switches PTT (`type` is the event's type, `keydown` or `keyup`). Both events of that SPACE are
 * swallowed so that the focused button is not pressed: a cancelled keydown is enough in Chrome, but Firefox presses the button on keyup
 * unless the keyup is cancelled too. Only the first keydown switches PTT (ของเรา): a key held down is one switch, not a flood of them.
 */
export function pttKey(type: string, key: string, spacePtt: boolean, tag: string, repeat: boolean): PttKey {
  if (!isPttSpace(key, spacePtt, tag)) return null;
  return type === "keydown" && !repeat ? "toggle" : "swallow";
}

// ---------------------------------------------------------------- edits the server has not answered (the knobs, Cycle)

/**
 * A number the user changed whose requests are still on their way. The knob takes each step from the number it shows, so while a
 * request is in flight the number the user made is shown, not the server's (a click on the next digit would otherwise start from an old
 * number and lose a step, and so would a tick that was made before the server had the request).
 */
export interface Edit {
  /** the last number the user made */
  value: number;
  /** how many requests have not been answered */
  inFlight: number;
}

/** The user made `value` and a request for it is sent. */
export function beginEdit(edit: Edit | undefined, value: number): Edit {
  return { value, inFlight: (edit?.inFlight ?? 0) + 1 };
}

/** A request was answered (or failed): the edit ends with the last one, and the server's number is shown again. */
export function finishEdit(edit: Edit | undefined): Edit | undefined {
  return edit === undefined || edit.inFlight <= 1 ? undefined : { ...edit, inFlight: edit.inFlight - 1 };
}

/** The number to show: the user's while a request is in flight, else the server's. */
export function editedValue(edit: Edit | undefined, server: number): number {
  return edit === undefined ? server : edit.value;
}

/** The edits of a window by name (the numbers a window lets the user change: its knobs, Cycle, Threshold). */
export type Edits<K extends string> = Partial<Record<K, Edit>>;

/** `beginEdit` for the number `key` of `edits`; the others and `edits` itself are not changed. */
export function beginEdits<K extends string>(edits: Edits<K>, key: K, value: number): Edits<K> {
  return { ...edits, [key]: beginEdit(edits[key], value) };
}

/** `finishEdit` for the number `key` of `edits`; the others and `edits` itself are not changed. */
export function finishEdits<K extends string>(edits: Edits<K>, key: K): Edits<K> {
  return { ...edits, [key]: finishEdit(edits[key]) };
}

// ---------------------------------------------------------------- the order of requests and answers

/**
 * The requests of a window are numbered, and an answer is shown only if no answer to a newer request has been shown: two requests can
 * come back in the other order, and the older answer would put back a state that the newer one has already replaced.
 */
export interface RequestOrder {
  /** the number of the newest request that was sent */
  sent: number;
  /** the number of the newest request whose answer was shown */
  applied: number;
}

export const NO_REQUESTS: RequestOrder = { sent: 0, applied: 0 };

/** A request is sent: its number and the order with it. */
export function sendRequest(order: RequestOrder): { n: number; order: RequestOrder } {
  const n = order.sent + 1;
  return { n, order: { ...order, sent: n } };
}

/** The answer to request `n` has come: whether to show it (no newer one was shown) and the order after it. */
export function answerRequest(order: RequestOrder, n: number): { show: boolean; order: RequestOrder } {
  return n > order.applied ? { show: true, order: { ...order, applied: n } } : { show: false, order };
}

// ---------------------------------------------------------------- tooltips (ref-R §2.2 to §2.6, gtk-rig-ctrl.c)

/**
 * Gpredict's tooltips of the window, letter for letter. The knob digits have KNOB_TOOLTIP (knobInput.ts). Two are Gpredict's slips and
 * are kept (ref-R §13 item 17): the uplink Doppler tooltip says "downlink", and device 1's has no space after the dot.
 */
export const RADIO_TOOLTIPS = {
  downDoppler: "The Doppler shift according to the range rate and the currently selected downlink frequency",
  upDoppler: "The Doppler shift according to the range rate and the currently selected downlink frequency",
  satellite: "Select target object",
  track: "Track the satellite transponder.\nEnabling this button will apply Doppler correction to the frequency of the radio.",
  transponder: "Select a transponder",
  tune:
    "Tune the radio to this transponder. The uplink and downlink will be set to the center of the transponder passband. " +
    "In case of beacons, only the downlink will be tuned to the beacon frequency.",
  lock:
    "Lock the uplink and the downlink to each other. Whenever you change the downlink (in the controller or on the dial, " +
    "the uplink will track it according to whether the transponder is inverting or not. Similarly, if you change the uplink " +
    "the downlink will track it automatically.\n\nIf the downlink and uplink are initially out of sync when you enable this " +
    "function, the current downlink frequency will be used as baseline for setting the new uplink frequency.",
  range: "This is the current distance between the satellite and the observer.",
  rate: "The rate of change for the distance between the satellite and the observer.",
  device1: "Select primary radio device.This device will be used for downlink and uplink unless you select a secondary device for uplink",
  engage: "Engage the selected radio device",
  device2: "Select secondary radio device\nThis device will be used for uplink",
  cycle: "This parameter controls the delay between commands sent to the rig.",
  countdown: "The time remaining until the next AOS or LOS event",
} as const;
