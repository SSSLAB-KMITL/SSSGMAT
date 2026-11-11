// The one owner of a module's configuration on the page (spec §7.1, §8). Pure TypeScript, no DOM and no React: the hook that
// wraps it is useModuleConfig.
//
// EVERY write of a module's configuration (a view saving `list_sort` or `single.selected`, a popup toggling `ground_track`,
// the Configure dialog, ...) must go through `ConfigStore.save` (the `save` of useModuleConfig, `onSaveConfig` of a view).
// A write that builds its own copy of the configuration and PUTs it would send values that are out of date and silently undo
// what the user changed through another view.

import type { ModuleConfig } from "./types";

/** Sends the whole configuration to the server (PUT /api/modules/{name}); rejects if the server refuses. */
export type PutConfig = (config: ModuleConfig) => Promise<unknown>;

interface Pending {
  change: (config: ModuleConfig) => ModuleConfig;
  resolve: () => void;
  reject: (error: unknown) => void;
}

const same = (a: ModuleConfig, b: ModuleConfig): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);

/**
 * A module's configuration as the page shows it, and its saving.
 *
 * - `confirmed` is the configuration the server holds (as far as this page knows): the one read from it, then each one it
 *   accepted. `pending` are the saves not answered yet, oldest first. `config` is what the page shows: `confirmed` with every
 *   pending change applied in order, so a change shows at once and the views never disagree.
 * - `save(change)` queues a change. Requests are sent one at a time in the order of the saves, so a later request can never be
 *   stored before an earlier one, and each is built from `confirmed` when it is sent: the whole configuration with the changes
 *   before it that the server accepted, and not the ones it refused.
 * - A refused save rejects its promise with the error and its change disappears from `config`, which goes back to `confirmed`
 *   with the changes of the saves still pending. A change is never reverted to some earlier copy, so two refused saves in a
 *   row leave the page on what the server holds, and a newer change is never lost with an older one.
 * - `reset(config)` takes a configuration read from the server as the confirmed one (the pending changes stay on top of it); a
 *   refusal that comes later cannot bring back an older copy. A save that was already sent when it was read again still
 *   leaves the server with what it sent, and that becomes the confirmed configuration when the server accepts it.
 * - `config` keeps its identity while a change leaves it equal in value, and then nobody is told.
 */
export class ConfigStore {
  private confirmed: ModuleConfig;
  private shown: ModuleConfig;
  private pending: Pending[] = [];
  private sending = false;
  private readonly listeners = new Set<() => void>();

  constructor(
    initial: ModuleConfig,
    private readonly put: PutConfig,
  ) {
    this.confirmed = initial;
    this.shown = initial;
  }

  /** What the page shows; the same object until it changes in value. */
  get config(): ModuleConfig {
    return this.shown;
  }

  /** `listener` is called whenever `config` changes. Returns the function that stops it. (An arrow function: it can be handed to `useSyncExternalStore` as it is.) */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  /**
   * Applies `change` to the configuration (it shows at once) and saves the result. Resolves when the server has accepted it;
   * rejects with the error when it has not (the change is then gone from `config`). `change` gets the newest configuration
   * and must return a new object; it may be applied again to another base if an earlier save is refused, so it should say
   * what to change ("select satellite 25544"), not what the result is.
   */
  save(change: (config: ModuleConfig) => ModuleConfig): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.pending.push({ change, resolve, reject });
      this.show();
      void this.drain();
    });
  }

  /** Takes `config`, read from the server, as the configuration the server holds. */
  reset(config: ModuleConfig): void {
    this.confirmed = config;
    this.show();
  }

  /** `confirmed` with the pending changes applied. A change that throws is left out (its turn in `drain` rejects its save). */
  private fold(): ModuleConfig {
    let config = this.confirmed;
    for (const { change } of this.pending) {
      try {
        config = change(config);
      } catch {
        // shown without it
      }
    }
    return config;
  }

  private show(): void {
    const next = this.fold();
    if (same(next, this.shown)) return;
    this.shown = next;
    for (const listener of [...this.listeners]) listener();
  }

  /** Sends the pending saves one at a time, oldest first, until there is none. */
  private async drain(): Promise<void> {
    if (this.sending) return;
    this.sending = true;
    try {
      while (this.pending.length > 0) {
        const head = this.pending[0]!;
        let failure: { error: unknown } | null = null;
        try {
          const body = head.change(this.confirmed);
          await this.put(body);
          this.confirmed = body;
        } catch (error) {
          failure = { error };
        }
        this.pending.shift();
        this.show();
        if (failure === null) head.resolve();
        else head.reject(failure.error);
      }
    } finally {
      this.sending = false;
    }
  }
}
