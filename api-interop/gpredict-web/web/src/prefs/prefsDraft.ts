// What the Preferences window has changed and not saved yet (spec §8.1: OK saves every page that changed, Cancel saves nothing).
// Pure: no React, no requests. The window keeps one Draft for all its pages; `draftToRequest` makes the body of PUT /api/prefs.

import type { PrefsAnswer, PrefValue } from "../types";
import { savedNote } from "./prefPlaces";

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

/** A function a page registers with the window: an onCommit (run after the preferences are saved) or an onCheck (run before anything is). */
export type Commit = () => Promise<void>;

interface Entry {
  page: string;
  key: string;
  fn: Commit;
}

/**
 * The onCommit functions of one Preferences window, or its onCheck functions (the window keeps one list of each): one per page and
 * key, the latest registration of a (page, key) replacing the one before (a page registers on every render, so the newest closure,
 * which sees the newest state, is the one that runs). OK runs each (page, key) once, ordered by group as in `order` (Gpredict's: General,
 * Modules, Interfaces, Predict) whichever page was visited and registered first, and within a group by the first registration. A group
 * that `order` does not name runs after the others.
 */
export class CommitList {
  private readonly registered: Entry[] = [];

  constructor(private readonly order: readonly string[]) {}

  add(page: string, key: string, fn: Commit): void {
    const entry = this.registered.find((e) => e.page === page && e.key === key);
    if (entry === undefined) this.registered.push({ page, key, fn });
    else entry.fn = fn;
  }

  /** The entries in the order they run in. */
  get entries(): readonly Entry[] {
    const rank = (page: string) => {
      const i = this.order.indexOf(page);
      return i < 0 ? this.order.length : i;
    };
    return [...this.registered].sort((a, b) => rank(a.page) - rank(b.page)); // (a sort is stable: registration order within a group)
  }

  get all(): readonly Commit[] {
    return this.entries.map((e) => e.fn);
  }
}

/** What OK of the Preferences window does, as functions (the window makes them; `commitPreferences` only orders them). */
export interface CommitSteps {
  /** the dry run of the preferences (PUT /api/prefs?dry_run=true) */
  checkPrefs: Commit;
  /** the dry runs of what the pages save themselves (their onCheck) */
  checks: readonly Commit[];
  savePrefs: Commit;
  /** what the pages save themselves (their onCommit) */
  commits: readonly Commit[];
}

/**
 * OK of the Preferences window, all or nothing (spec §10, plan decision 6): every part is checked first, with dry runs that write
 * nothing, and only when all of them pass is anything written. In this order, one at a time, and the first step that rejects ends it
 * (its error is what rejects here): checkPrefs, every check, savePrefs, every commit. A check that fails therefore leaves every file as
 * it was; a write that fails after others (the server went away, a file could not be written) says what they saved (`commitSteps`).
 */
export async function commitPreferences(steps: CommitSteps): Promise<void> {
  await steps.checkPrefs();
  for (const check of steps.checks) await check();
  await steps.savePrefs();
  for (const commit of steps.commits) await commit();
}

/** What the window has to make the steps of OK. */
export interface PreferenceParts {
  /** the draft changes a preference: when it does not there is nothing to check or save (the pages' own steps are still run) */
  changed: boolean;
  checkPrefs: Commit;
  savePrefs: Commit;
  checks: CommitList;
  commits: CommitList;
  /** the text to show for a failure of the preferences (checking or saving them): where it belongs, then the server's text */
  prefsFailedAs(e: unknown): string;
  /** the text to show for a failure of a page's check or commit; `page` is the group that registered it */
  pageFailedAs(page: string, e: unknown): string;
  /** what `savePrefs` saves, as the note of a failure after it names it (prefPlaces.ts `prefsSavedParts`) */
  prefsPart: string;
  /** what the commit of `page` registered under `key` saves, as the same note names it */
  pagePart(page: string, key: string): string;
}

/** The step that does what `step` does and fails with the Error of `text(failure)`, which is what the window shows (and what rejects `commitPreferences`). */
const failingAs =
  (text: (failure: unknown) => string, step: Commit): Commit =>
  async () => {
    try {
      await step();
    } catch (e) {
      throw new Error(text(e));
    }
  };

/**
 * The steps for `commitPreferences`, each failing with a text that says where the failure is (spec §10: "<group> → <tab>: <text>"). A
 * write that fails after other writes of the same OK adds what those saved (prefPlaces.ts `savedNote`): Cancel does not take it back,
 * and OK again sends only what is still to save.
 */
export function commitSteps(p: PreferenceParts): CommitSteps {
  const nothing: Commit = async () => {};
  const saved: string[] = []; // what the writes of this OK have saved so far
  const writing =
    (text: (failure: unknown) => string, step: Commit, part: string): Commit =>
    async () => {
      try {
        await step();
      } catch (e) {
        throw new Error(saved.length === 0 ? text(e) : `${text(e)} ${savedNote(saved)}`);
      }
      saved.push(part);
    };
  const pageText = (page: string) => (failure: unknown) => p.pageFailedAs(page, failure);
  return {
    checkPrefs: p.changed ? failingAs(p.prefsFailedAs, p.checkPrefs) : nothing,
    checks: p.checks.entries.map((e) => failingAs(pageText(e.page), e.fn)),
    savePrefs: p.changed ? writing(p.prefsFailedAs, p.savePrefs, p.prefsPart) : nothing,
    commits: p.commits.entries.map((e) => writing(pageText(e.page), e.fn, p.pagePart(e.page, e.key))),
  };
}
