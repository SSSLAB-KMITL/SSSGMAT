// File → Open module (ref §1): the dialog "Select a module" with one column "Module". Pure; OpenModuleDialog.tsx shows it.

import { compareNames } from "./views/cells";

/** What Gpredict says when there is no module file at all. */
export const NO_MODULES_TEXT = "You do not have any modules set up yet. Please use File->New in order to create a module.";

/** (ของเรา) every module is open already, so there is nothing to choose; Gpredict would raise the open one's tab instead. */
export const ALL_OPEN_TEXT = "module ทุกตัวเปิดอยู่แล้ว";

/** The modules to choose from: the ones that are not open, sorted by name. */
export function openableModules(all: readonly string[], open: readonly string[]): string[] {
  return all.filter((m) => !open.includes(m)).sort(compareNames);
}

/** The text that replaces the list when there is nothing to choose, null if there is something. */
export function openModuleEmptyText(all: readonly string[], open: readonly string[]): string | null {
  if (all.length === 0) return NO_MODULES_TEXT;
  return openableModules(all, open).length === 0 ? ALL_OPEN_TEXT : null;
}
