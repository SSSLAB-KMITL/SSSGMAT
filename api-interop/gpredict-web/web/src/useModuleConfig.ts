import { useCallback, useEffect, useState } from "react";
import { errorText, getModule } from "./api";
import type { ModuleConfig } from "./types";

interface Held {
  name: string | null;
  config: ModuleConfig | null;
  error: string | null;
}

/**
 * The saved configuration of a module (layout code, refresh rates, view settings), read from GET /api/modules/{name}.
 * `reload` reads it again (after Configure, Task 18); the old config stays until the new one has arrived.
 */
export function useModuleConfig(name: string | null) {
  const [held, setHeld] = useState<Held>({ name: null, config: null, error: null });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (name === null) return;
    let cancelled = false;
    getModule(name).then(
      (config) => {
        if (!cancelled) setHeld({ name, config, error: null });
      },
      (e: unknown) => {
        if (!cancelled) setHeld({ name, config: null, error: errorText(e) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [name, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const mine = held.name === name ? held : null; // never the previous module's config
  return { config: mine?.config ?? null, error: mine?.error ?? null, reload };
}
