// The Create new module / Edit module dialog (ref §3): what OK checks, the ground station combo, the satellite selector's
// lists, and how the form becomes a configuration or a change of an open module's configuration. Pure; ModuleDialog.tsx shows it.

import { isModuleName } from "./moduleName";
import { applyProps, propsChange, propsEqual } from "./moduleProps";
import type { ModuleProps, PropsSource } from "./moduleProps";
import type { ModuleConfig, SatRecord } from "./types";
import { compareNames } from "./views/cells";

// ---------------------------------------------------------------- texts

/** mod-cfg.c:966 */
export const NO_SATS_ERROR = "Please select at least one satellite from the list.";
/** mod-cfg.c:69-70, with the module's name in place of %s */
export const overwriteQuestion = (name: string): string =>
  `There is already a module called ${name}.\nDo you want to overwrite this module?`;

/** mod-cfg.c:734-735 */
export const HINT = "Double click on a satellite to move it to the other box.";
/** gtk-sat-selector.c:736: the first entry of the group combo */
export const GROUP_ALL = "All satellites";
/** (ของเรา) the server lists at most 500 satellites for a search (spec §7.3) */
export const TOO_MANY_HINT = "แสดงเฉพาะ 500 ดวงแรก พิมพ์ค้นหาหรือเลือกกลุ่มเพื่อให้เหลือน้อยลง";
/** the server's limit of the list, which the search shows a hint for */
export const SEARCH_LIMIT = 500;

const BAD_NAME = "ชื่อ module ต้องเป็นตัวอักษร A-Z, a-z, ตัวเลข, _ หรือ - ยาว 1-25 ตัว";

// ---------------------------------------------------------------- OK of Create new module

export interface ValidationResult {
  /** OK cannot go on: why (Gpredict's words where it has them, else Thai) */
  error?: string;
  /** OK needs the user's yes first: the question (Gpredict's words) */
  confirmOverwrite?: string;
}

/**
 * What OK of Create new module does with the form, in Gpredict's order: the name must be valid (its entry only lets valid
 * characters in, and OK is off while it is empty), at least one satellite must be selected, and a module of that name that
 * exists must be confirmed to be overwritten. `existing` are the names of all the modules (open or not), `open` the open ones.
 * A name that differs from a module's only in case is refused like the server does (the files would be one on a disk that
 * ignores case), and so is the name of a module that is open (ของเรา: it must be changed with Configure, not overwritten).
 */
export function validateModuleForm(
  form: { name: string; satellites: readonly unknown[] },
  existing: readonly string[],
  open: readonly string[] = [],
): ValidationResult {
  if (!isModuleName(form.name)) return { error: BAD_NAME };
  if (form.satellites.length === 0) return { error: NO_SATS_ERROR };
  if (!existing.includes(form.name)) {
    const clash = existing.find((n) => n.toLowerCase() === form.name.toLowerCase());
    return clash === undefined ? {} : { error: `มี module ชื่อ ${clash} อยู่แล้ว ชื่อที่ต่างกันแค่ตัวพิมพ์เล็ก-ใหญ่ใช้ด้วยกันไม่ได้` };
  }
  if (open.includes(form.name)) return { error: `module ${form.name} เปิดอยู่ แก้ไขได้จาก Module → Configure (ถ้าจะสร้างใหม่ทับ ให้ปิด module ก่อน)` };
  return { confirmOverwrite: overwriteQuestion(form.name) };
}

// ---------------------------------------------------------------- ground station combo

/** The last entry of the Ground station combo (mod-cfg.c:389): the module uses the default station. */
export const DEFAULT_QTH = "** DEFAULT **";

export interface QthChoice {
  /** the station's name, or null for ** DEFAULT ** */
  value: string | null;
  label: string;
}

/** The entries of the Ground station combo: the stations sorted by name, then ** DEFAULT ** last. */
export function qthChoices(names: readonly string[]): QthChoice[] {
  const sorted = [...names].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()) || (a < b ? -1 : a > b ? 1 : 0));
  return [...sorted.map((n) => ({ value: n, label: n })), { value: null, label: DEFAULT_QTH }];
}

// ---------------------------------------------------------------- satellite selector

/** A satellite in the selected list. */
export interface SelectedSat {
  norad: number;
  name: string;
}

export interface GroupOption {
  /** the group's name; "" for all satellites */
  value: string;
  label: string;
}

/** The group combo: "All satellites", then the CelesTrak groups. */
export function groupOptions(groups: readonly string[]): GroupOption[] {
  return [{ value: "", label: GROUP_ALL }, ...groups.map((g) => ({ value: g, label: g }))];
}

const compareSats = (a: SelectedSat, b: SelectedSat): number => compareNames(a.name, b.name) || a.norad - b.norad;

/** The satellites sorted by name, then catalogue number (the selected list is "sorted by name"). */
export function sortedSats(list: readonly SelectedSat[]): SelectedSat[] {
  return [...list].sort(compareSats);
}

/** The list with `sat` in its place; the same list if it is there already. */
export function addSat(list: readonly SelectedSat[], sat: SelectedSat): readonly SelectedSat[] {
  return list.some((s) => s.norad === sat.norad) ? list : sortedSats([...list, sat]);
}

/** The list without the satellite; the same list if it is not there. */
export function removeSat(list: readonly SelectedSat[], norad: number): readonly SelectedSat[] {
  return list.some((s) => s.norad === norad) ? list.filter((s) => s.norad !== norad) : list;
}

/** What the "Available Satellites" list shows: the server's result without the satellites that are selected (Gpredict hides them). */
export function availableSats(found: readonly SatRecord[], selected: readonly SelectedSat[]): SelectedSat[] {
  const taken = new Set(selected.map((s) => s.norad));
  return found.filter((r) => !taken.has(r.norad)).map((r) => ({ norad: r.norad, name: r.name }));
}

// ---------------------------------------------------------------- the module the form makes

/** What the form holds besides the properties. */
export interface ModuleForm {
  name: string;
  /** null: ** DEFAULT ** */
  qth: string | null;
  satellites: readonly SelectedSat[];
}

/** The new module of OK in Create new module: Gpredict's defaults, then the form, then the properties. */
export function newModuleConfig(form: ModuleForm, props: ModuleProps, defaults: PropsSource): ModuleConfig {
  const base: ModuleConfig = {
    ...structuredClone(defaults),
    name: form.name,
    qth: form.qth,
    satellites: sortedSats(form.satellites).map((s) => s.norad),
  };
  return applyProps(base, props);
}

/** What the dialog edits of an open module: the ground station, the satellites (NORAD numbers) and the properties. */
export interface ModuleDraft {
  qth: string | null;
  satellites: readonly number[];
  props: ModuleProps;
}

/** The same satellites, whatever the order. */
function sameSatellites(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  const inB = new Set(b);
  return inB.size === b.length && a.every((n) => inB.has(n));
}

/** Whether `draft` differs from what the dialog opened with. */
export function hasModuleChanges(initial: ModuleDraft, draft: ModuleDraft): boolean {
  return initial.qth !== draft.qth || !sameSatellites(initial.satellites, draft.satellites) || !propsEqual(initial.props, draft.props);
}

const keepOnly = (list: readonly number[], keep: ReadonlySet<number>): number[] => list.filter((n) => keep.has(n));

/**
 * OK of Edit module as a change of the open module's configuration, for the one `save` of the page: it says what to change
 * (the ground station, the satellites, the properties that differ), not what the result is, so it applies to whatever the
 * newest configuration is. Satellites that leave the module also leave its Highlight footprint / Ground Track / Sky track lists
 * and, if it was the one Single sat shows, `single.selected`, which the server requires to be a satellite of the module.
 */
export function editModuleChange(initial: ModuleDraft, draft: ModuleDraft): (config: ModuleConfig) => ModuleConfig {
  const props = propsChange(initial.props, draft.props);
  return (config) => {
    let next = props(config);
    if (initial.qth !== draft.qth) next = { ...next, qth: draft.qth };
    if (!sameSatellites(initial.satellites, draft.satellites)) {
      const keep = new Set(draft.satellites);
      next = {
        ...next,
        satellites: [...draft.satellites],
        footprint_off: keepOnly(next.footprint_off, keep),
        ground_track: keepOnly(next.ground_track, keep),
        sky_track: keepOnly(next.sky_track, keep),
        single: next.single.selected !== null && !keep.has(next.single.selected) ? { ...next.single, selected: null } : next.single,
      };
    }
    return next;
  };
}
