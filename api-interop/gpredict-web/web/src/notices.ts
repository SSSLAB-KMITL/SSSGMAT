// The dismissible notice strip under the tabs (ของเรา: Gpredict has no such strip).

import type { ApiMessage, Level, Tick } from "./types";

export interface Notice {
  id: string;
  level: Level;
  text: string;
  /** the notice has a Retry button that re-runs the failed GMAT calculation of this module */
  retryModule?: string;
  /** the whole text when `text` is shortened (the satellites of a long list); shown as the tooltip of the notice */
  detail?: string;
}

/** NORAD number -> name of the satellites a module has shown (ticks carry the names of the satellites that have a state). */
export type SatNameMap = ReadonlyMap<number, string>;

/** The server's TLE_OLD_DAYS (server/gpredict_web/config.py): a TLE older than this many days is reported with TLE_OLD. */
export const TLE_OLD_DAYS = 7;

/** How many satellite names a notice spells out; the rest is counted ("และอีก 7 ดวง") and the tooltip has them all. */
const MAX_NAMES = 5;

const idOf = (scope: string, m: ApiMessage): string => `${scope}:${m.code}:${m.object ?? ""}:${m.text}`;

/** Messages of GET /api/modules (e.g. the Thai hint to update TLE data after an offline first start). */
export function startupNotices(messages: readonly ApiMessage[]): Notice[] {
  return messages.map((m) => ({ id: idOf("startup", m), level: m.level, text: m.text }));
}

const LEVELS: readonly Level[] = ["info", "warning", "error"];

/** The per-satellite warnings of a tick: one notice per code, naming the satellites (`object` is the NORAD number). */
const PER_SAT: readonly { code: string; text: (n: number, list: string) => string }[] = [
  { code: "SAT_STATE_INVALID", text: (n, list) => `${n} ดวงมีค่าวงโคจรที่ใช้ไม่ได้: ${list}` },
  { code: "SAT_MISSING_FROM_GMAT", text: (n, list) => `GMAT ไม่คืนค่าของ ${n} ดวง: ${list}` },
  {
    code: "TLE_OLD",
    text: (n, list) => `TLE ของ ${n} ดวงเก่ากว่า ${TLE_OLD_DAYS} วัน: ${list} (ควรอัปเดตที่ Edit → Update TLE data from network)`,
  },
];

const byNumber = (a: string, b: string): number => a.localeCompare(b, "en", { numeric: true });

/** The new map if `tick` shows names `known` lacks or has other, else `known` itself (so React sees no change). */
export function rememberNames(known: SatNameMap, tick: Tick | null): SatNameMap {
  let next: Map<number, string> | null = null;
  for (const s of tick?.sats ?? []) {
    if ((next ?? known).get(s.norad) === s.name) continue;
    next ??= new Map(known);
    next.set(s.norad, s.name);
  }
  return next ?? known;
}

/** One notice for all the satellites a code names; its id holds the code and the sorted set of satellites, never the text. */
function perSatNotice(module: string, code: string, text: (n: number, list: string) => string, found: readonly ApiMessage[], names: SatNameMap): Notice {
  const objects = [...new Set(found.map((m) => m.object ?? "?"))].sort(byNumber);
  const label = (object: string): string => names.get(Number(object)) ?? `NORAD ${object}`;
  const shown = objects.slice(0, MAX_NAMES).map(label).join(", ");
  const more = objects.length - MAX_NAMES;
  const list = more > 0 ? `${shown} และอีก ${more} ดวง` : shown;
  const full = objects.map((o) => `${label(o)} (NORAD ${o})`).join(", ");
  const level = found.reduce<Level>((worst, m) => (LEVELS.indexOf(m.level) > LEVELS.indexOf(worst) ? m.level : worst), "info");
  return {
    id: `tick:${module}:${code}:${objects.join(",")}`,
    level,
    text: text(objects.length, list),
    ...(more > 0 ? { detail: text(objects.length, full) } : {}),
  };
}

/**
 * (ของเรา) What a tick tells the user that the views do not show, as notices:
 * - GMAT_FAILED on an ok tick (a failure the views do not stop for, e.g. the next calculation window): a notice with Retry.
 *   Ticks that are not ok are handled by the overlay.
 * - SAT_STATE_INVALID, SAT_MISSING_FROM_GMAT and TLE_OLD, which the server sends once per satellite: one notice per code
 *   that counts and names the satellites ("TLE ของ 12 ดวงเก่ากว่า 7 วัน: ..."), in any status of the tick. The id is the
 *   module, the code and the sorted set of satellites, so a dismissed notice stays dismissed while the set is the same
 *   (the day count in a TLE_OLD text changes all the time) and comes back when the set changes.
 * `names` gives the satellites' names; a satellite it does not know is shown as "NORAD <number>".
 */
export function tickNotices(module: string, tick: Tick | null, names: SatNameMap = new Map()): Notice[] {
  if (tick === null) return [];
  const failed: Notice[] =
    tick.status !== "ok"
      ? []
      : tick.messages
          .filter((m) => m.code === "GMAT_FAILED")
          .map((m) => ({ id: idOf(`tick:${module}`, m), level: m.level, text: m.text, retryModule: module }));
  const perSat = PER_SAT.flatMap(({ code, text }) => {
    const found = tick.messages.filter((m) => m.code === code);
    return found.length === 0 ? [] : [perSatNotice(module, code, text, found, names)];
  });
  return [...failed, ...perSat];
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
