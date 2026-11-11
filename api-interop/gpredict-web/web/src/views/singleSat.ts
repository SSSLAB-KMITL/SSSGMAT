// What the Single sat view shows, apart from the values (cells.ts): which satellites it offers and which one it shows.
// Pure functions, no DOM and no React.

import type { SatState } from "../types";
import { compareNames } from "./cells";

/** A satellite of the module, as the Single sat popup lists it. */
export interface SatChoice {
  norad: number;
  name: string;
}

/**
 * The module's satellites sorted by name (Gpredict sorts the Single sat's list by nickname), for the radio items of the popup.
 * A satellite whose name is not known (yet) is named by its NORAD number.
 */
export function singleChoices(satellites: readonly number[], names: ReadonlyMap<number, string>): SatChoice[] {
  return satellites
    .map((norad) => ({ norad, name: names.get(norad) ?? String(norad) }))
    .sort((a, b) => compareNames(a.name, b.name) || a.norad - b.norad);
}

/** The satellite the view shows: the module's `single.selected` if it is in the module, else the first by name; null if the module has none. */
export function shownSatellite(selected: number | null, choices: readonly SatChoice[]): number | null {
  if (selected !== null && choices.some((c) => c.norad === selected)) return selected;
  return choices[0]?.norad ?? null;
}

/** `held` with the names of the satellites of a tick added or renamed; the same map when nothing changes. */
export function mergeNames(held: ReadonlyMap<number, string>, sats: readonly SatState[]): ReadonlyMap<number, string> {
  let next: Map<number, string> | null = null;
  for (const s of sats) {
    if ((next ?? held).get(s.norad) === s.name) continue;
    next ??= new Map(held);
    next.set(s.norad, s.name);
  }
  return next ?? held;
}
