import { useEffect, useState } from "react";
import { getMeta } from "./api";
import type { Meta } from "./types";

/** After a failed GET /api/meta (the server is not there yet) the next try comes after this long. */
const RETRY_MS = 5000;

let loading: Promise<Meta> | null = null;

/** GET /api/meta, once for the page: the server's constants (names and hints of the columns and fields, defaults, presets). */
function loadMeta(): Promise<Meta> {
  loading ??= getMeta().catch((e: unknown) => {
    loading = null; // the next call tries again
    throw e;
  });
  return loading;
}

/** The server's constants (GET /api/meta), null until they have arrived; a failed request is tried again every 5 s. */
export function useMeta(): Meta | null {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (meta !== null) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    loadMeta().then(
      (m) => {
        if (!cancelled) setMeta(m);
      },
      () => {
        if (!cancelled) timer = setTimeout(() => setAttempt((a) => a + 1), RETRY_MS);
      },
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [meta, attempt]);
  return meta;
}
