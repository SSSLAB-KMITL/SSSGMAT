// The groups of the Preferences window (ref-D §1): the four icons at its left and the page of each. Pure but for the pages.

import type { ReactNode } from "react";
import { InterfacesPages } from "../radio/InterfacesPages";
import type { PrefValue } from "../types";
import { GeneralPages } from "./GeneralPages";
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
   * one OK runs sees the newest state. OK runs each key of each page once, in the group order of OK (`COMMIT_ORDER`: General, Modules, Interfaces, Predict) and within a group in the order of its first registration. If one rejects,
   * the window stays open and shows the error.
   */
  onCommit(key: string, fn: () => Promise<void>): void;
  /**
   * `fn` is run when OK is pressed, before anything is saved, to check what the page will save itself in its `onCommit` without writing it
   * (a dry run: PUT /api/hwconf?dry_run=true, say), and rejects with the error to show if it is wrong. If any page's check fails, nothing
   * of the window is saved (spec §10). A page that has an `onCommit` of its own for a `key` registers the check under the same `key`. Keyed
   * like `onCommit`: the latest registration of a key runs, once, in the group order of OK. A rejection of a `TabError` names the tab.
   */
  onCheck(key: string, fn: () => Promise<void>): void;
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
  { id: "general", label: "General", icon: "⚙", page: GeneralPages },
  { id: "modules", label: "Modules", icon: "☰", page: null, later: 4 },
  { id: "interfaces", label: "Interfaces", icon: "∿", page: InterfacesPages },
  { id: "predict", label: "Predict", icon: "▦", page: PredictPages },
];

/** The group the window opens at (spec §10): Gpredict opens at General. */
export const FIRST_GROUP: PrefGroupId = "general";

/** The order OK saves the groups in (ref-D §1: General, Modules, Interfaces, Predict), whichever page was visited or registered first. */
export const COMMIT_ORDER: readonly PrefGroupId[] = PREF_GROUPS.map((g) => g.id);

/** The label of a group: the name of the icon, of the title of the window and of the group in a failure text. */
export const groupLabel = (id: PrefGroupId): string => PREF_GROUPS.find((g) => g.id === id)!.label;

/**
 * Which group the window shows, and the groups it has shown. The page of a group that has been shown stays in the window (hidden)
 * until the window closes, so what the page holds is not lost when another group is chosen.
 */
export interface GroupView {
  active: PrefGroupId;
  visited: readonly PrefGroupId[];
}

/**
 * The view when the window opens: at General, or, if General has no page, at the first group that has one, never on one that is
 * disabled (General has its page since sub-project 4; a window built with other groups can still lack it).
 */
export function firstView(groups: readonly PrefGroup[] = PREF_GROUPS): GroupView {
  const first = groups.find((g) => g.id === FIRST_GROUP && g.page !== null) ?? groups.find((g) => g.page !== null);
  const active = first?.id ?? FIRST_GROUP; // (every group without a page: nothing to show, which does not happen)
  return { active, visited: [active] };
}

/** The view after choosing `id`; the same view if that group has no page (it cannot be chosen) or is shown already. */
export function switchGroup(view: GroupView, id: PrefGroupId, groups: readonly PrefGroup[] = PREF_GROUPS): GroupView {
  if (id === view.active || groups.find((g) => g.id === id)?.page == null) return view;
  return { active: id, visited: view.visited.includes(id) ? view.visited : [...view.visited, id] };
}
