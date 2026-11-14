// The Preferences of the server (GET and PUT /api/prefs) as the page holds them: one copy for the whole page, loaded when
// something first uses it. Every write goes through `savePrefs` and shows what the server answers; the page never decides a value.

import { useSyncExternalStore } from "react";
import { getPrefs, putPrefs } from "../api";
import type { PrefsAnswer, PrefValue } from "../types";

/** After a failed first load (the server is not there yet) the next try comes after this long, while someone waits for it. */
const RETRY_MS = 5000;

type Get = () => Promise<PrefsAnswer>;
type Put = (set: Readonly<Record<string, PrefValue>>, remove: readonly string[]) => Promise<PrefsAnswer>;

const same = (a: PrefsAnswer, b: PrefsAnswer): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);

/**
 * The answer of the server, null until it has arrived.
 *
 * - The first `subscribe` loads it (once: a load that is under way is shared, and `reload` joins it). A load that fails is tried
 *   again after `retryMs` for as long as someone is subscribed, and for the next one who subscribes.
 * - `save` sends the changes and takes the answer of the PUT; a refusal rejects with the error and changes nothing.
 * - Answers are taken in the order their requests were sent: a read that was sent before a save and arrives after it is dropped,
 *   so the old values never come back over the saved ones.
 * - `answer` keeps its identity while a read brings the same values, and then nobody is told.
 */
export class PrefsStore {
  private answer: PrefsAnswer | null = null;
  private loading: Promise<void> | null = null;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private sent = 0; // requests sent so far
  private taken = 0; // the newest request whose answer was taken
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly get: Get,
    private readonly put: Put,
    private readonly retryMs = RETRY_MS,
  ) {}

  /** The answer of the server, the same object until it changes in value. (An arrow function: `useSyncExternalStore` takes it as it is.) */
  readonly getSnapshot = (): PrefsAnswer | null => this.answer;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    if (this.answer === null && this.loading === null) this.start();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) clearTimeout(this.retry);
    };
  };

  /** Read the server again. Resolves when its answer is taken; rejects with the error if it cannot be read (what the store has stays). */
  reload(): Promise<void> {
    if (this.loading !== null) return this.loading;
    const n = ++this.sent;
    const reading: Promise<void> = this.get()
      .then((a) => this.take(n, a))
      .finally(() => {
        if (this.loading === reading) this.loading = null;
      });
    this.loading = reading;
    return reading;
  }

  /** Set the keys of `set` and put the keys of `remove` back to their defaults; resolves when the server has done it. */
  async save(set: Readonly<Record<string, PrefValue>>, remove: readonly string[]): Promise<void> {
    const n = ++this.sent;
    this.take(n, await this.put(set, remove));
  }

  private start(): void {
    this.reload().catch(() => {
      if (this.answer !== null || this.listeners.size === 0) return;
      this.retry = setTimeout(() => {
        if (this.answer === null && this.loading === null && this.listeners.size > 0) this.start();
      }, this.retryMs);
    });
  }

  private take(n: number, answer: PrefsAnswer): void {
    if (n < this.taken) return; // an older request, answered after a newer one
    this.taken = n;
    if (this.answer !== null && same(this.answer, answer)) return;
    this.answer = answer;
    for (const listener of [...this.listeners]) listener();
  }
}

const store = new PrefsStore(getPrefs, putPrefs);

/** What react-dom/server renders with (the markup of the tests): no answer yet, as a page before its first load. */
const NO_ANSWER = (): PrefsAnswer | null => null;

/** The Preferences of the server, null until they have arrived; the first user starts the load. */
export const usePrefs = (): PrefsAnswer | null => useSyncExternalStore(store.subscribe, store.getSnapshot, NO_ANSWER);

/** Read the Preferences again (the Preferences window does when it opens, so that its pages start from the current values). */
export const reloadPrefs = (): Promise<void> => store.reload();

/** Set the keys of `set` and put the keys of `remove` back to their defaults (PUT /api/prefs); rejects with the server's error. The page shows the answer. */
export const savePrefs = (set: Readonly<Record<string, PrefValue>>, remove: readonly string[]): Promise<void> => store.save(set, remove);

/**
 * Check what OK would send (a dry run of PUT /api/prefs): rejects with the server's error, as `savePrefs` would, and writes nothing, tells
 * no other page, and changes nothing the page holds (the answer is not taken: it is what the values would be).
 */
export const checkPrefs = async (set: Readonly<Record<string, PrefValue>>, remove: readonly string[]): Promise<void> => {
  await putPrefs(set, remove, { dryRun: true });
};
