// What the Preferences window has changed and not saved yet (spec §8.1: OK saves every page that changed, Cancel saves nothing).
// Pure: no React, no requests. The window keeps one Draft for all its pages; `draftToRequest` makes the body of PUT /api/prefs.

import type { PrefsAnswer, PrefValue } from "../types";

/** A page asked for a key to go back to its default (a Reset button). */
export const RESET = Symbol("RESET");

/**
 * The changes: a key maps to the value a page set, or to RESET. A key is in the map once: setting a key after its Reset
 * replaces the RESET (and the other way round), so the last thing a page did to a key is all that is left of it.
 */
export type Draft = ReadonlyMap<string, PrefValue | typeof RESET>;

const sameValue = (a: PrefValue, b: PrefValue): boolean =>
  Array.isArray(a) ? Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]) : a === b;

/** The value a page shows for `key`: what it has set, the default if it has reset the key, else the value in effect. */
export function draftValue(answer: PrefsAnswer, draft: Draft, key: string): PrefValue {
  const change = draft.get(key);
  const value = change === RESET ? answer.defaults[key] : (change ?? answer.values[key]);
  if (value === undefined) throw new Error(`"${key}" is not a preference`); // a typo in a page, not something to show as a value
  return value;
}

/** The draft with `key` set to `value`. */
export function setInDraft(draft: Draft, key: string, value: PrefValue): Draft {
  return new Map(draft).set(key, value);
}

/** The draft with every key of `keys` back at its default. */
export function resetInDraft(draft: Draft, keys: readonly string[]): Draft {
  const next = new Map(draft);
  for (const key of keys) next.set(key, RESET);
  return next;
}

/**
 * The body of PUT /api/prefs for the draft (spec §8.2). Only what differs from the answer is sent: a value equal to the one in
 * effect is left out, a Reset of a key the user has set removes it, a Reset of a key that is at its default sends nothing, and
 * a key that was reset and then set is sent as `set` only (the server refuses a key in both).
 */
export function draftToRequest(answer: PrefsAnswer, draft: Draft): { set: Record<string, PrefValue>; remove: string[] } {
  const set: Record<string, PrefValue> = {};
  const remove: string[] = [];
  for (const [key, change] of draft) {
    if (change === RESET) {
      if (answer.user.includes(key)) remove.push(key);
      continue;
    }
    const now = answer.values[key];
    if (now === undefined || !sameValue(change, now)) set[key] = change; // (an unknown key goes to the server, which says so)
  }
  return { set, remove };
}

/** A function a page wants run when OK has saved the preferences (PrefsPageApi.onCommit). */
export type Commit = () => Promise<void>;

/**
 * The onCommit functions of one Preferences window, in the order they were registered. A page registers on every render, so the
 * same function from the same page is kept once.
 */
export class CommitList {
  private readonly entries: { page: string; fn: Commit }[] = [];

  add(page: string, fn: Commit): void {
    if (!this.entries.some((e) => e.page === page && e.fn === fn)) this.entries.push({ page, fn });
  }

  get all(): readonly Commit[] {
    return this.entries.map((e) => e.fn);
  }
}
