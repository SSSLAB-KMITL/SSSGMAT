// The dismissible notice strip under the tabs (ของเรา: Gpredict has no such strip).

import type { ApiMessage, Level, Tick } from "./types";

export interface Notice {
  id: string;
  level: Level;
  text: string;
  /** the notice has a Retry button that re-runs the failed GMAT calculation of this module */
  retryModule?: string;
}

const idOf = (scope: string, m: ApiMessage): string => `${scope}:${m.code}:${m.object ?? ""}:${m.text}`;

/** Messages of GET /api/modules (e.g. the Thai hint to update TLE data after an offline first start). */
export function startupNotices(messages: readonly ApiMessage[]): Notice[] {
  return messages.map((m) => ({ id: idOf("startup", m), level: m.level, text: m.text }));
}

/**
 * (ของเรา) GMAT_FAILED arriving on an ok tick (a failure the views do not stop for, e.g. the next calculation window):
 * a notice with Retry. Ticks that are not ok are handled by the overlay; other messages belong to the views.
 */
export function tickNotices(module: string, tick: Tick | null): Notice[] {
  if (tick === null || tick.status !== "ok") return [];
  return tick.messages
    .filter((m) => m.code === "GMAT_FAILED")
    .map((m) => ({ id: idOf(`tick:${module}`, m), level: m.level, text: m.text, retryModule: module }));
}

export function visibleNotices(notices: readonly Notice[], dismissed: ReadonlySet<string>): Notice[] {
  return notices.filter((n) => !dismissed.has(n.id));
}

/** Forgets dismissed notices that are gone, so a notice that comes back is shown again. Same Set if nothing changed. */
export function pruneDismissed(dismissed: ReadonlySet<string>, live: readonly Notice[]): ReadonlySet<string> {
  const liveIds = new Set(live.map((n) => n.id));
  const kept = [...dismissed].filter((id) => liveIds.has(id));
  return kept.length === dismissed.size ? dismissed : new Set(kept);
}
