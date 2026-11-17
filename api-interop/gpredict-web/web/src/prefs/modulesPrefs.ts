// The Modules group of Preferences (ref-D §10, spec §9): the global values that every module inherits until its own Module properties
// change a page. Pure: the keys of each page, the properties as Preferences holds them and how a page's change and Reset go into the
// window's draft. ModulesPrefsPage.tsx shows it with the same six pages as Module properties.

import { pagePaths, propsOf, propsValue, PROPS_TABS, withPropsValue } from "../moduleProps";
import type { ModuleProps, PropsTab } from "../moduleProps";
import type { Meta, PrefValue } from "../types";
import type { PrefsPageApi } from "./prefGroups";

const GLOBAL_RESET = "Reset settings to the default values.";

/** The tooltip of each page's Reset button in global mode; the Map View page has its own wording (ref-D §10). */
export const GLOBAL_RESET_TIP: Readonly<Record<PropsTab, string>> = {
  layout: GLOBAL_RESET,
  refresh: GLOBAL_RESET,
  list: GLOBAL_RESET,
  map: "Reset settings to default values",
  polar: GLOBAL_RESET,
  single: GLOBAL_RESET,
};

/** The "Window Placements" boxes of the Layout page, only in Preferences (sat-pref-layout.c:326-379), in Gpredict's order. */
export const WINDOW_PLACEMENTS: readonly { key: string; label: string; tooltip: string }[] = [
  {
    key: "GLOBAL/MAIN_WIN_POS",
    label: "Restore position of main window",
    tooltip:
      "If you check this button, gpredict will try to place the main window at the position it was during the last session.\nNote that window managers can ignore this request.",
  },
  {
    key: "GLOBAL/MOD_WIN_POS",
    label: "Restore position of module windows",
    tooltip:
      "If you check this button, gpredict will try to place the module windows at the position they were the last time.\nNote that window managers can ignore this request.",
  },
  {
    key: "GLOBAL/MOD_STATE",
    label: "Restore the state of modules when reopened (docked or window)",
    tooltip: "If you check this button, gpredict will restore the states of the modules from the last time they were used.",
  },
];

/** [path, key] of every value a page's controls hold, in the server's order. */
const pageEntries = (page: PropsTab, meta: Meta): [string, string][] =>
  pagePaths(page, meta).map((path) => [path, meta.module_keys[page][path]!]);

/**
 * The properties as Preferences holds them: each value from the key the module inherits it from (`values` of GET /api/prefs, or the
 * values the Preferences window shows), Gpredict's default for a key that `values` does not have. A copy: changing it changes nothing else.
 */
export function globalProps(values: Readonly<Record<string, PrefValue>>, meta: Meta): ModuleProps {
  let props = propsOf(meta.module_defaults);
  for (const { id } of PROPS_TABS) {
    for (const [path, key] of pageEntries(id, meta)) {
      const v = values[key];
      if (v !== undefined) props = withPropsValue(props, path, structuredClone(v));
    }
  }
  return props;
}

/** The keys of Preferences of the page `page` with their values in `props`, in the server's order. */
export function propsToPrefs(props: ModuleProps, page: PropsTab, meta: Meta): Record<string, PrefValue> {
  return Object.fromEntries(pageEntries(page, meta).map(([path, key]) => [key, structuredClone(propsValue(props, path)) as PrefValue]));
}

/** Every key a page of the Modules group writes and resets: its keys, and on the Layout page the Window Placements (sat-pref-layout.c:101-129). */
export function pageKeys(page: PropsTab, meta: Meta): string[] {
  const keys = pageEntries(page, meta).map(([, key]) => key);
  return page === "layout" ? [...keys, ...meta.global_layout_extra] : keys;
}

/** The keys of every page: what the Modules group shows. */
export const allKeys = (meta: Meta): string[] => PROPS_TABS.flatMap((t) => pageKeys(t.id, meta));

/**
 * A control of `page` was changed and the page now shows `props`: every key of the page goes into the window's draft with the value
 * shown (Gpredict writes all of a dirty page, ref-D §10; OK sends the server only what differs). The Layout page's Window Placements
 * keep the values they show, which a box sets afterwards.
 */
export function setPage(api: Pick<PrefsPageApi, "value" | "set">, props: ModuleProps, page: PropsTab, meta: Meta): void {
  for (const [key, v] of Object.entries(propsToPrefs(props, page, meta))) api.set(key, v);
  if (page === "layout") for (const key of meta.global_layout_extra) api.set(key, api.value(key));
}

/**
 * The Reset button of `page` in global mode: every key of the page goes back to its default, the Window Placements with the Layout page
 * (sat-pref-layout.c:426-437), and the Map View page's "Solar terminator:" and "Global shadow:" colours too, which Gpredict leaves (spec §11).
 */
export function resetPage(api: Pick<PrefsPageApi, "reset">, page: PropsTab, meta: Meta): void {
  api.reset(pageKeys(page, meta));
}
