// The groups of the Preferences window (ref-D §1): the four icons at its left and the page of each. Pure but for the pages.

import type { ReactNode } from "react";
import type { PrefValue } from "../types";
import { PredictPages } from "./PredictPages";

export type PrefGroupId = "general" | "modules" | "interfaces" | "predict";

/** What a page of a group gets from the window: the values it shows and the changes it makes (all go to the window's draft). */
export interface PrefsPageApi {
  /** the value to show for `key`: what this window has set, else the value in effect (the default after a Reset) */
  value<T extends PrefValue>(key: string): T;
  set(key: string, v: PrefValue): void;
  /** the keys go back to their defaults (saved by OK, like every change) */
  reset(keys: readonly string[]): void;
  /**
   * `fn` is run after OK has saved the preferences, for data that is not a key of Preferences (the radio list, say). `key` names
   * what it saves within the page: the latest registration runs, so a page can register an inline closure on every render and the
   * one OK runs sees the newest state. OK runs each key of each page once, in the order of its first registration. If one rejects,
   * the window stays open and shows the error.
   */
  onCommit(key: string, fn: () => Promise<void>): void;
}

export interface PrefGroup {
  id: PrefGroupId;
  /** the label of the icon, and of the title of the window */
  label: string;
  /** the icon: Gpredict has a PNG for each, we have a symbol (ของเรา) */
  icon: string;
  /** null: the group is shown and cannot be chosen yet, its tooltip names the sub-project `later` */
  page: ((api: PrefsPageApi) => ReactNode) | null;
  later?: 2 | 3 | 4;
}

/** In Gpredict's order. The icons are `gpredict-sat-pref.png`, `gpredict-sat-list.png`, `gpredict-oscilloscope.png` and `gpredict-calendar.png` there. */
export const PREF_GROUPS: readonly PrefGroup[] = [
  { id: "general", label: "General", icon: "⚙", page: null, later: 4 },
  { id: "modules", label: "Modules", icon: "☰", page: null, later: 4 },
  { id: "interfaces", label: "Interfaces", icon: "∿", page: null, later: 3 },
  { id: "predict", label: "Predict", icon: "▦", page: PredictPages },
];

/** The group the window opens at: Gpredict opens at General, which has no page yet (sub-project 4 changes this to "general"). */
export const FIRST_GROUP: PrefGroupId = "predict";

/**
 * Which group the window shows, and the groups it has shown. The page of a group that has been shown stays in the window (hidden)
 * until the window closes, so what the page holds is not lost when another group is chosen.
 */
export interface GroupView {
  active: PrefGroupId;
  visited: readonly PrefGroupId[];
}

export const firstView = (): GroupView => ({ active: FIRST_GROUP, visited: [FIRST_GROUP] });

/** The view after choosing `id`; the same view if that group has no page (it cannot be chosen) or is shown already. */
export function switchGroup(view: GroupView, id: PrefGroupId, groups: readonly PrefGroup[] = PREF_GROUPS): GroupView {
  if (id === view.active || groups.find((g) => g.id === id)?.page == null) return view;
  return { active: id, visited: view.visited.includes(id) ? view.visited : [...view.visited, id] };
}
