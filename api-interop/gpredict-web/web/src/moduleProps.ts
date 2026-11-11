// The module properties the "Module properties" dialog edits (ref §3-§7), kept apart from the satellites and the ground
// station of the module dialog. Pure; ModuleProperties.tsx shows it.
//
// The dialog works on a draft (`ModuleProps`): Cancel drops it, OK hands it to the module dialog, which saves it with the
// module (Create new module: PUT of a new configuration; Edit module: `propsChange` through the page's one `save`).

import { gridFor, parseLayout } from "./layout";
import type { ModuleConfig, Refresh } from "./types";

/** The pages of the notebook, in Gpredict's order (sat-pref-modules.c:65-80). There is none for the event list. */
export type PropsTab = "layout" | "refresh" | "list" | "map" | "polar" | "single";

export const PROPS_TABS: readonly { id: PropsTab; label: string }[] = [
  { id: "layout", label: "Layout" },
  { id: "refresh", label: "Refresh Rates" },
  { id: "list", label: "List View" },
  { id: "map", label: "Map View" },
  { id: "polar", label: "Polar View" },
  { id: "single", label: "Single Sat View" },
];

const MODULE_RESET_TIP = "Reset module settings to the global values.";

/** The tooltip of each page's Reset button in module mode; the Map View page has its own wording (ref §3). */
export const RESET_TIP: Readonly<Record<PropsTab, string>> = {
  layout: MODULE_RESET_TIP,
  refresh: MODULE_RESET_TIP,
  list: MODULE_RESET_TIP,
  map: "Reset module to global settings",
  polar: MODULE_RESET_TIP,
  single: MODULE_RESET_TIP,
};

/** The five rates that have a control (the event list's refresh has none, ref §3). */
export type Rates = Omit<Refresh, "event">;

export interface ModuleProps {
  layout_code: string;
  refresh: Rates;
  list_columns: string[];
  map: { contents: Record<string, boolean>; track_orbits: number; center_lon: number };
  polar: { orientation: string; contents: Record<string, boolean>; auto_skytrack: boolean };
  single_fields: string[];
}

/** A module configuration, or the defaults (which have no name). */
export type PropsSource = Omit<ModuleConfig, "name">;

/** A copy of the properties in a configuration. */
export function propsOf(c: PropsSource): ModuleProps {
  const { event: _event, ...rates } = c.refresh;
  return structuredClone({
    layout_code: c.layout_code,
    refresh: rates,
    list_columns: c.list_columns,
    map: { contents: c.map.contents, track_orbits: c.map.track_orbits, center_lon: c.map.center_lon },
    polar: { orientation: c.polar.orientation, contents: c.polar.contents, auto_skytrack: c.polar.auto_skytrack },
    single_fields: c.single.fields,
  });
}

/** `props` with the page `tab` back at the defaults (Gpredict's global values, which for us are its defaults). */
export function resetTab(props: ModuleProps, tab: PropsTab, defaults: PropsSource): ModuleProps {
  const d = propsOf(defaults);
  switch (tab) {
    case "layout":
      return { ...props, layout_code: d.layout_code };
    case "refresh":
      return { ...props, refresh: d.refresh };
    case "list":
      return { ...props, list_columns: d.list_columns };
    case "map":
      return { ...props, map: d.map };
    case "polar":
      return { ...props, polar: d.polar };
    case "single":
      return { ...props, single_fields: d.single_fields };
  }
}

/** `config` with all the properties set to `props`; the rest of the configuration (sort order, tracks, selection) stays. */
export function applyProps(config: ModuleConfig, props: ModuleProps): ModuleConfig {
  const p = structuredClone(props);
  return {
    ...config,
    layout_code: p.layout_code,
    refresh: { ...config.refresh, ...p.refresh },
    list_columns: p.list_columns,
    map: { ...config.map, ...p.map },
    polar: { ...config.polar, ...p.polar },
    single: { ...config.single, fields: p.single_fields },
  };
}

const same = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);

export function propsEqual(a: ModuleProps, b: ModuleProps): boolean {
  return same(a, b);
}

/** `target` with the entries of `draft` that differ from `initial` (an entry the user did not touch keeps the value `target` has). */
function withChangedEntries<T extends object>(target: T, initial: Partial<T>, draft: Partial<T>): T {
  let next = target;
  for (const key of Object.keys(draft) as (keyof T)[]) {
    if (!same(initial[key], draft[key])) next = { ...next, [key]: draft[key] };
  }
  return next;
}

/**
 * What the user changed in the properties, as a change of the configuration for the one `save`: it applies the differences
 * between `initial` (what the dialog opened with) and `draft` to whatever the newest configuration is, so a property that
 * another view saved meanwhile is not undone by one the user did not touch. The configuration itself comes back when nothing
 * differs.
 */
export function propsChange(initial: ModuleProps, draft: ModuleProps): (config: ModuleConfig) => ModuleConfig {
  return (config) => {
    let next = config;
    if (initial.layout_code !== draft.layout_code) next = { ...next, layout_code: draft.layout_code };
    const refresh = withChangedEntries(next.refresh, initial.refresh, draft.refresh);
    if (refresh !== next.refresh) next = { ...next, refresh };
    if (!same(initial.list_columns, draft.list_columns)) next = { ...next, list_columns: [...draft.list_columns] };
    if (!same(initial.map, draft.map)) {
      const contents = withChangedEntries(next.map.contents, initial.map.contents, draft.map.contents);
      next = {
        ...next,
        map: {
          ...next.map,
          contents,
          track_orbits: initial.map.track_orbits === draft.map.track_orbits ? next.map.track_orbits : draft.map.track_orbits,
          center_lon: initial.map.center_lon === draft.map.center_lon ? next.map.center_lon : draft.map.center_lon,
        },
      };
    }
    if (!same(initial.polar, draft.polar)) {
      next = {
        ...next,
        polar: {
          orientation: initial.polar.orientation === draft.polar.orientation ? next.polar.orientation : draft.polar.orientation,
          contents: withChangedEntries(next.polar.contents, initial.polar.contents, draft.polar.contents),
          auto_skytrack: initial.polar.auto_skytrack === draft.polar.auto_skytrack ? next.polar.auto_skytrack : draft.polar.auto_skytrack,
        },
      };
    }
    if (!same(initial.single_fields, draft.single_fields)) next = { ...next, single: { ...next.single, fields: [...draft.single_fields] } };
    return next;
  };
}

// ---------------------------------------------------------------- the Layout page

/** Larger than any layout of Gpredict's; a code with more columns or rows than this could not be drawn. */
export const MAX_GRID = 64;

const BAD_LAYOUT = "layout code ไม่ถูกต้อง";

/** The reason layout.ts gives (English) in the words the server uses (Thai). A reason it does not know is passed on as it is. */
function thaiReason(reason: string): string {
  if (reason.includes("non-negative integers")) return "ต้องเป็นจำนวนเต็มไม่ติดลบคั่นด้วย ;";
  if (reason.includes("groups of 5")) return "ต้องเป็นกลุ่มละ 5 จำนวน (type;left;right;top;bottom)";
  const type = /^no view type (\d+)/.exec(reason);
  if (type !== null) return `ชนิด view ${type[1]} ไม่มี (ต้องเป็น 0-4)`;
  const cell = /^cell (\d+) needs/.exec(reason);
  if (cell !== null) return `ช่องที่ ${cell[1]} ต้องมี left < right และ top < bottom`;
  return reason;
}

/** Why `code` cannot be a layout code, in Thai, or null if it can. Same rules as the server's. */
export function layoutCodeError(code: string): string | null {
  let cells;
  try {
    cells = parseLayout(code);
  } catch (e) {
    return `${BAD_LAYOUT}: ${thaiReason(e instanceof Error ? e.message : String(e))}`;
  }
  const grid = gridFor(cells);
  if (grid.columns > MAX_GRID || grid.rows > MAX_GRID) return `${BAD_LAYOUT}: ตารางใหญ่เกิน ${MAX_GRID} คอลัมน์หรือ ${MAX_GRID} แถว`;
  return null;
}

/** What Gpredict's layout code entry leaves of the text: only digits and semicolons (it deletes the rest as it is typed). */
export function sanitizeLayoutCode(text: string): string {
  return text.replace(/[^0-9;]/g, "");
}

/** The index of the built-in layout with this code, or the index of "Custom" (after the built-in ones) if there is none. */
export function presetIndexOf(code: string, presets: readonly { code: string }[]): number {
  const i = presets.findIndex((p) => p.code === code);
  return i < 0 ? presets.length : i;
}

// ---------------------------------------------------------------- check boxes

/** The visible fields after `name` was ticked or cleared; they stay in the order of Gpredict's table whatever order they were ticked in. */
export function withVisible(canonical: readonly string[], current: readonly string[], name: string, on: boolean): string[] {
  return canonical.filter((c) => (c === name ? on : current.includes(c)));
}

/** `flags` (the Contents of a view) with one entry set. */
export function withFlag(flags: Readonly<Record<string, boolean>>, name: string, on: boolean): Record<string, boolean> {
  return { ...flags, [name]: on };
}
