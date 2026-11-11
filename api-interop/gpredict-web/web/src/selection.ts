// What the page holds per module and does not save: the selected satellite and whether Autotrack is on. Pure.

import type { ModuleConfig } from "./types";

/** The selected satellite (NORAD number, null: none) of each module that has had one. */
export type Selections = Readonly<Record<string, number | null>>;

/** `selections` with the selection of `module` set; the same object when nothing changes. */
export function withSelection(selections: Selections, module: string, norad: number | null): Selections {
  if (module in selections && selections[module] === norad) return selections;
  return { ...selections, [module]: norad };
}

/** `selections` without the modules that are not open any more; the same object when nothing goes. */
export function pruneToOpen(selections: Selections, open: readonly string[]): Selections {
  const keys = Object.keys(selections);
  const kept = keys.filter((k) => open.includes(k));
  return kept.length === keys.length ? selections : Object.fromEntries(kept.map((k) => [k, selections[k]!]));
}

/** `set` with `name` in it or not; the same set when nothing changes. */
export function withMember(set: ReadonlySet<string>, name: string, member: boolean): ReadonlySet<string> {
  if (set.has(name) === member) return set;
  const next = new Set(set);
  if (member) next.add(name);
  else next.delete(name);
  return next;
}

/**
 * The change of the module configuration that makes Single sat show `norad` (`single.selected`, which the module remembers),
 * for `save` of useModuleConfig. It says what to do, not what the result is. The same configuration comes back when Single sat
 * shows that satellite already or the satellite is not in the module.
 */
export function singleSatChange(norad: number): (config: ModuleConfig) => ModuleConfig {
  return (config) =>
    config.single.selected === norad || !config.satellites.includes(norad) ? config : { ...config, single: { ...config.single, selected: norad } };
}
