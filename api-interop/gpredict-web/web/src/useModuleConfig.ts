import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { errorText, getModule, putModule } from "./api";
import { ConfigStore } from "./configStore";
import type { ModuleConfig, ModulePins } from "./types";

interface Held {
  name: string | null;
  store: ConfigStore | null;
  error: string | null;
}

const NO_UPDATES = () => () => undefined;

/**
 * The ONE copy of a module's configuration (layout code, refresh rates, view settings), read from GET /api/modules/{name}
 * and kept in a ConfigStore. `config` is null until it has arrived.
 *
 * Every write of the configuration must go through `save(change)`: it shows the change at once, sends the whole configuration
 * with PUT /api/modules/{name} one request at a time, and on a refusal goes back to the configuration the server holds and
 * rejects with the error (see configStore.ts). OK of Module properties gives `save` the paths to pin and unpin as well (`opts`). The views get it as `onSaveConfig`; the dialogs and popups of Task 18 (Module
 * properties, Configure, the satellite popups' Highlight footprint / Ground Track / Sky track) must use it too, and never
 * PUT a configuration of their own: that would send out-of-date values and undo what another view saved.
 *
 * `reload` reads it from the server again; the stored configuration stays (with the saves still pending on top of it) until
 * the new one has arrived, and stays if reading fails (`error` says so).
 */
export function useModuleConfig(name: string | null) {
  const [held, setHeld] = useState<Held>({ name: null, store: null, error: null });
  const [version, setVersion] = useState(0);
  const current = useRef<{ name: string; store: ConfigStore } | null>(null);

  useEffect(() => {
    if (name === null) return;
    let cancelled = false;
    getModule(name).then(
      (config) => {
        if (cancelled) return;
        const known = current.current?.name === name ? current.current.store : null;
        known?.reset(config);
        const store = known ?? new ConfigStore(config, putModule);
        current.current = { name, store };
        setHeld({ name, store, error: null });
      },
      (e: unknown) => {
        if (cancelled) return;
        const known = current.current?.name === name ? current.current.store : null;
        setHeld({ name, store: known, error: errorText(e) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [name, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const mine = held.name === name ? held : null; // never the previous module's config
  const store = mine?.store ?? null;
  const config = useSyncExternalStore(store?.subscribe ?? NO_UPDATES, () => store?.config ?? null);
  const save = useCallback(
    (change: (config: ModuleConfig) => ModuleConfig, opts?: ModulePins): Promise<void> =>
      store === null ? Promise.reject(new Error("the module's configuration has not been loaded")) : store.save(change, opts),
    [store],
  );
  return { config, error: mine?.error ?? null, reload, save };
}
