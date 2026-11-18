// Autotrack (ref §2): while it is on, the module's target is the satellite above the horizon or else the one with the earliest
// AOS (gtk-sat-module.c update_autotrack). Pure.

import type { Tick } from "./types";

/** Gpredict looks for an AOS within 10 days ("hope there is AOS within 10 days"). */
const AOS_HORIZON_MS = 10 * 24 * 3_600_000;

/**
 * The satellite Autotrack wants selected, given the newest tick and the current selection.
 * - The selection stays while that satellite is above the horizon (El > 0), as in Gpredict, so the target does not jump
 *   between two satellites that are both up.
 * - Otherwise the satellite above the horizon with the highest El.
 * - Otherwise the one whose next AOS is the earliest, after the time of the tick and within 10 days.
 * - Otherwise the selection stays. Without an ok tick nothing changes.
 */
export function autotrackTarget(tick: Tick | null, current: number | null): number | null {
  if (tick === null || tick.status !== "ok" || tick.sats === undefined) return current;
  const now = Date.parse(tick.t);
  const up = (el: number | null): el is number => el !== null && el > 0;

  const selected = tick.sats.find((s) => s.norad === current);
  if (selected !== undefined && up(selected.el)) return selected.norad;

  let best: { norad: number; el: number } | null = null;
  for (const s of tick.sats) {
    if (up(s.el) && (best === null || s.el > best.el)) best = { norad: s.norad, el: s.el };
  }
  if (best !== null) return best.norad;

  let soon: { norad: number; at: number } | null = null;
  for (const s of tick.sats) {
    const at = s.next_aos === null ? NaN : Date.parse(s.next_aos);
    if (at > now && at < now + AOS_HORIZON_MS && (soon === null || at < soon.at)) soon = { norad: s.norad, at };
  }
  return soon?.norad ?? current;
}
