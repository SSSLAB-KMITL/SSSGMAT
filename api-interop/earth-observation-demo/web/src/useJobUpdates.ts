import { useEffect, useRef } from "react";
import { request, type Job } from "./state";

/** Finite, visibility-aware requests leave HTTP/1 slots free for Cesium workers. */
export function useJobUpdates(
  onJobs: (jobs: Job[]) => void,
  onChanged: () => Promise<void>,
  enabled: boolean,
) {
  const callbacks = useRef({ onJobs, onChanged });
  callbacks.current = { onJobs, onChanged };
  useEffect(() => {
    if (!enabled) return;
    let stopped = false,
      generation = 0,
      previous = "";
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    async function poll() {
      if (stopped || document.hidden) return;
      const token = ++generation;
      controller = new AbortController();
      let delay = 8000;
      try {
        const rows: Job[] = await request("/jobs", {
          signal: controller.signal,
        });
        if (stopped || token !== generation) return;
        if (!Array.isArray(rows))
          throw new Error("Invalid job status response");
        callbacks.current.onJobs(rows);
        const next = JSON.stringify(rows.map((j) => [j.id, j.state]));
        if (previous && previous !== next) void callbacks.current.onChanged();
        previous = next;
        if (rows.some((j) => j.state === "queued" || j.state === "running"))
          delay = 1000;
      } catch {
        // A temporary status failure must not blank imagery or the globe.
      } finally {
        if (!stopped && token === generation && !document.hidden)
          timer = setTimeout(poll, delay);
      }
    }
    function visibility() {
      generation++;
      clearTimeout(timer);
      controller?.abort();
      if (!document.hidden) void poll();
    }
    void poll();
    document.addEventListener("visibilitychange", visibility);
    return () => {
      stopped = true;
      generation++;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [enabled]);
}
