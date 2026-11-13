// A pass request of a satellite popup (Show current pass, Show next pass, Future passes): what is sent, and the 500 ms rule of
// the waiting box (spec §4.4, ของเรา: Gpredict answers at once, we may have to wait for GMAT). No React and no DOM: the state of
// the boxes is usePassRequest.ts, the boxes are PassWait.tsx and NoPassMessage.tsx.

import { errorText } from "../api";
import type { ApiMessage, Tick } from "../types";
import { requestPass } from "./passApi";
import { newId } from "./passWindows";
import type { PassWindow } from "./passWindows";
import type { PassAnswer, PassBody, PassKind } from "./types";

/** How long the answer may take before the waiting box comes up (plan Global Constraints). */
export const WAIT_BOX_DELAY_MS = 500;

/** What a pass request tells the page. After `cancel`, and once one of `onDone` and `onError` has been called, it tells nothing more. */
export interface PassHooks {
  /** the answer has not come in WAIT_BOX_DELAY_MS: show the waiting box (not called when the answer or an error comes first) */
  onWaiting(): void;
  onDone(answer: PassAnswer): void;
  /** the request failed (GMAT failed, the server cannot be reached): the Thai text to show in the waiting box, with Retry */
  onError(text: string): void;
}

/**
 * Ask the server for the passes in `body` and report to `hooks`. `cancel` is the Cancel of the waiting box (or the page going away):
 * it aborts the fetch, which makes the server drop the GMAT job that nobody else waits for, and the request tells nothing more,
 * not even the AbortError that follows.
 */
export function runPassRequest(module: string, body: PassBody, hooks: PassHooks): { cancel(): void } {
  const controller = new AbortController();
  let finished = false;
  const timer = setTimeout(() => {
    if (!finished) hooks.onWaiting();
  }, WAIT_BOX_DELAY_MS);
  const finish = (): boolean => {
    if (finished) return false;
    finished = true;
    clearTimeout(timer);
    return true;
  };

  requestPass(module, body, controller.signal).then(
    (answer) => {
      if (finish()) hooks.onDone(answer);
    },
    (e: unknown) => {
      if (finish()) hooks.onError(errorText(e));
    },
  );

  return {
    cancel() {
      if (!finish()) return;
      controller.abort();
    },
  };
}

/**
 * The body of the request that item `kind` of the popup of `norad` makes, or null when the item does nothing. `t` is the time of
 * the view the popup came from (Gpredict gives the pass routines the view's own time stamp); the server decides the start time of
 * each kind from it (plan decision 4). Show current pass checks El > 0 again, on `latest` (the newest tick, at the time of the
 * click): the satellite may have set since the popup was built, and then Gpredict does nothing at all, no dialog (ref-P §1.1).
 */
export function passBody(kind: PassKind, norad: number, t: string, latest: Pick<Tick, "sats"> | null): PassBody | null {
  if (kind === "current") {
    const el = latest?.sats?.find((s) => s.norad === norad)?.el;
    if (el === null || el === undefined || !(el > 0)) return null;
  }
  return { norad, kind, t };
}

/** What an answer shows: a pass window to open, or the box of a satellite that has no pass. */
export type PassOutcome = { kind: "window"; window: PassWindow } | { kind: "message"; message: ApiMessage };

/**
 * What the answer of the server opens (spec §4): a `pass` (Show next pass, Show current pass) opens Pass details, which has no
 * parent window, so it is not closed with any other; `passes` (Future passes) opens Upcoming passes; a `message` is the box
 * NoPassMessage shows.
 */
export function outcomeOf(answer: PassAnswer): PassOutcome {
  if ("pass" in answer) {
    return { kind: "window", window: { id: newId(), kind: "details", answer: { sat: answer.sat, qth: answer.qth, pass: answer.pass }, parent: null } };
  }
  if ("passes" in answer) {
    return { kind: "window", window: { id: newId(), kind: "upcoming", answer: { sat: answer.sat, qth: answer.qth, passes: answer.passes } } };
  }
  return { kind: "message", message: answer.message };
}
