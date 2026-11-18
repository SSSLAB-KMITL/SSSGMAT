// The module properties the "Module properties" dialog edits (ref §3-§7), kept apart from the satellites and the ground
// station of the module dialog. Pure; ModuleProperties.tsx shows it.
//
// The dialog works on a draft (`ModuleProps`): Cancel drops it, OK hands it to the module dialog, which saves it with the
// module (Create new module: PUT of a new configuration; Edit module: `propsSave`'s change and pins through the page's one `save`).
//
// A module inherits the global values of Preferences → Modules until a page of its Module properties is changed (ref-D §10): OK
// pins every value of a page the user changed to the module, and a page that was Reset and not changed afterwards inherits again
// (`propsSave`, plan decision 3). The same pages edit the global values in Preferences → Modules (prefs/modulesPrefs.ts).

import { gridFor, parseLayout } from "./layout";
import type { Meta, ModuleConfig, Refresh } from "./types";

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

/** The label of a page of the notebook (also the tab Preferences names in a failure). */
export const propsTabLabel = (tab: PropsTab): string => PROPS_TABS.find((t) => t.id === tab)!.label;

const MODULE_RESET_TIP = "Reset module settings to the global values.";

/** The tooltip of each page's Reset button in module mode; the Map View page has its own wording (ref-D §10). */
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
  /** contents, orbits, centre, and the background map, colours and shadow of the Map View page (sub-project 4, ref-D §11) */
  map: ModuleConfig["map"];
  /** orientation, contents, sky tracks, and the colours of the Polar View page (ref-D §12) */
  polar: ModuleConfig["polar"];
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
    map: c.map,
    polar: c.polar,
    single_fields: c.single.fields,
  });
}

/** `props` with the page `tab` set to the values of `to` (a copy): in module mode Reset gives the page the global values. */
export function resetTab(props: ModuleProps, tab: PropsTab, to: ModuleProps): ModuleProps {
  const v = structuredClone(to);
  switch (tab) {
    case "layout":
      return { ...props, layout_code: v.layout_code };
    case "refresh":
      return { ...props, refresh: v.refresh };
    case "list":
      return { ...props, list_columns: v.list_columns };
    case "map":
      return { ...props, map: v.map };
    case "polar":
      return { ...props, polar: v.polar };
    case "single":
      return { ...props, single_fields: v.single_fields };
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

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * `target` with what differs between `initial` and `draft`: objects are followed key by key, anything else (a number, a list of
 * fields) is taken from `draft` as a whole. What does not differ keeps the value `target` has, and `target` itself comes back when
 * nothing differs.
 */
function withChanges<T>(target: T, initial: T, draft: T): T {
  if (same(initial, draft)) return target;
  if (!isRecord(target) || !isRecord(initial) || !isRecord(draft)) return structuredClone(draft);
  let next: Record<string, unknown> = target;
  for (const key of Object.keys(draft)) {
    const v = withChanges(target[key], initial[key], draft[key]);
    if (v !== target[key]) next = { ...next, [key]: v };
  }
  return next as T;
}

/**
 * What the user changed in the properties, as a change of the configuration for the one `save`: it applies the differences
 * between `initial` (what the dialog opened with) and `draft` to whatever the newest configuration is, so a property that
 * another view saved meanwhile is not undone by one the user did not touch. The configuration itself comes back when nothing
 * differs.
 */
export function propsChange(initial: ModuleProps, draft: ModuleProps): (config: ModuleConfig) => ModuleConfig {
  return (config) => {
    const parts: Partial<ModuleConfig> = {};
    const layout_code = withChanges(config.layout_code, initial.layout_code, draft.layout_code);
    if (layout_code !== config.layout_code) parts.layout_code = layout_code;
    const rates = withChanges<Rates>(config.refresh, initial.refresh, draft.refresh);
    if (rates !== config.refresh) parts.refresh = { ...config.refresh, ...rates };
    const list_columns = withChanges(config.list_columns, initial.list_columns, draft.list_columns);
    if (list_columns !== config.list_columns) parts.list_columns = list_columns;
    const map = withChanges(config.map, initial.map, draft.map);
    if (map !== config.map) parts.map = map;
    const polar = withChanges(config.polar, initial.polar, draft.polar);
    if (polar !== config.polar) parts.polar = polar;
    const fields = withChanges(config.single.fields, initial.single_fields, draft.single_fields);
    if (fields !== config.single.fields) parts.single = { ...config.single, fields };
    return Object.keys(parts).length === 0 ? config : { ...config, ...parts };
  };
}

// ---------------------------------------------------------------- the paths of the server (meta.module_keys)

/** The keys into a ModuleConfig of a path of the server's ("map.contents.Grid Lines" → map, contents, Grid Lines). */
function pathKeys(path: string): string[] {
  const [head, ...rest] = path.split(".");
  // (the last part is a name, which may have a space; the server's paths have at most three parts)
  return rest.length <= 1 ? [head!, ...rest] : [head!, rest[0]!, rest.slice(1).join(".")];
}

/** The keys into ModuleProps of a path of the server's; Single Sat's fields are `single_fields` here. */
const propsKeys = (path: string): string[] => (path === "single.fields" ? ["single_fields"] : pathKeys(path));

/** `obj` with the value at `keys` replaced by `value`: the objects on the way are copies, everything else is shared. */
function setIn<T>(obj: T, keys: readonly string[], value: unknown): T {
  const put = (o: unknown, [key, ...rest]: readonly string[]): unknown => {
    const r = isRecord(o) ? o : {};
    return { ...r, [key!]: rest.length === 0 ? value : put(r[key!], rest) };
  };
  return put(obj, keys) as T;
}

/** The value at `path` (a path of `meta.module_keys`) in the properties; undefined for one they do not hold (the event list's refresh). */
export function propsValue(props: ModuleProps, path: string): unknown {
  let v: unknown = props;
  for (const key of propsKeys(path)) {
    if (!isRecord(v) || !(key in v)) return undefined;
    v = v[key];
  }
  return v;
}

/** `props` with the value at `path` replaced by `value`: the objects on the path are copies, everything else is shared. */
export function withPropsValue(props: ModuleProps, path: string, value: unknown): ModuleProps {
  return setIn(props, propsKeys(path), value);
}

/**
 * The paths of a page that its controls hold, in the server's order: every path of `meta.module_keys[page]` but the event list's
 * refresh, for which Gpredict's Refresh Rates page has no control and which it neither writes nor resets (sat-pref-refresh.c:52-119).
 */
export function pagePaths(page: PropsTab, meta: Meta): string[] {
  const held = propsOf(meta.module_defaults);
  return Object.keys(meta.module_keys[page]).filter((path) => propsValue(held, path) !== undefined);
}

// ---------------------------------------------------------------- OK of Module properties: pin and unpin

/**
 * What the user did to the pages of one Module properties dialog (sat-pref-*.c `dirty` and `reset`): `dirty` the pages changed since
 * their last Reset, `reset` the pages whose Reset was pressed. A Reset clears the page's `dirty`; a change after a Reset keeps the
 * `reset`, and the change wins (ref-D §10).
 */
export interface PropsMarks {
  dirty: ReadonlySet<PropsTab>;
  reset: ReadonlySet<PropsTab>;
}

export const NO_MARKS: PropsMarks = { dirty: new Set(), reset: new Set() };

/** The marks after a control of `tab` was changed; the same object if the page is dirty already. */
export function markEdited(marks: PropsMarks, tab: PropsTab): PropsMarks {
  return marks.dirty.has(tab) ? marks : { dirty: new Set([...marks.dirty, tab]), reset: marks.reset };
}

/** The marks after the Reset of `tab`. */
export function markReset(marks: PropsMarks, tab: PropsTab): PropsMarks {
  const dirty = new Set(marks.dirty);
  dirty.delete(tab);
  return { dirty, reset: new Set([...marks.reset, tab]) };
}

/** The pages whose dirty mark only counts while the ticked fields differ from the opening (sat-pref-list-view.c:115-124, sat-pref-single-sat.c:90-99). */
const FIELD_PAGES: Partial<Record<PropsTab, (p: ModuleProps) => unknown>> = {
  list: (p) => p.list_columns,
  single: (p) => p.single_fields,
};

export interface PropsSave {
  /** the change of the configuration: every value of the pages pinned or unpinned as the dialog shows it, the rest `propsChange` */
  change: (config: ModuleConfig) => ModuleConfig;
  /** the paths of the pages that were changed: the module keeps all of the page's values as its own */
  pin: string[];
  /** the paths of the pages that were Reset and not changed afterwards: the module inherits them again */
  unpin: string[];
}

/**
 * OK of Module properties as a save of the module (ref-D §10 "What OK writes"), for each page in the order of the notebook: a dirty
 * page pins all its paths, even the values left as they were; a page that was Reset and is not dirty unpins them; a page the user did
 * not touch is neither (a value it inherits goes on being inherited). List View and Single Sat View are dirty only while their fields
 * differ from `initial`, so ticking a box and clearing it again changes nothing.
 *
 * The change writes every value of a pinned or unpinned page from `draft`, what the dialog showed, and not only the differences: the
 * configuration it is applied to may hold an inherited value the page read before the global one changed, and a pin must never keep
 * that one (plan decision 3). Other pages get only what differs (`propsChange`).
 */
export function propsSave(
  initial: ModuleProps,
  draft: ModuleProps,
  dirty: ReadonlySet<PropsTab>,
  reset: ReadonlySet<PropsTab>,
  meta: Meta,
): PropsSave {
  const pin: string[] = [];
  const unpin: string[] = [];
  for (const { id } of PROPS_TABS) {
    const fields = FIELD_PAGES[id];
    if (dirty.has(id) && (fields === undefined || !same(fields(initial), fields(draft)))) pin.push(...pagePaths(id, meta));
    else if (reset.has(id)) unpin.push(...pagePaths(id, meta));
  }
  const differences = propsChange(initial, draft);
  const written = [...pin, ...unpin];
  const change =
    written.length === 0
      ? differences
      : (config: ModuleConfig) =>
          written.reduce((c, path) => setIn(c, pathKeys(path), structuredClone(propsValue(draft, path))), differences(config));
  return { change, pin, unpin };
}

/**
 * The pins of Create new module, also over a closed module of that name: the paths of `pin` (the pages the user changed) and every
 * other path of `meta.module_keys` unpinned (the event list's refresh too, which no page has but an old file can), so that the module
 * has only what it was given, as Gpredict's new .mod file (mod-cfg.c:769-824), and keeps nothing of the file it replaces.
 */
export function newModulePins(pin: readonly string[], meta: Meta): { pin: string[]; unpin: string[] } {
  const all = Object.values(meta.module_keys).flatMap((page) => Object.keys(page));
  return { pin: [...pin], unpin: all.filter((path) => !pin.includes(path)) };
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
