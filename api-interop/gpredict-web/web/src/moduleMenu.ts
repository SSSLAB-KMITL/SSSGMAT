// The Module menu (ref §2): Gpredict's items in order. Pure; ModuleMenu.tsx shows it.

import { laterItem, SEPARATOR } from "./menuSpec";
import type { MenuSpec } from "./menuSpec";
import type { SatState } from "./types";
import { compareNames } from "./views/cells";

/** What an enabled item of the Module menu does. */
export type ModuleAction =
  | { type: "autotrack"; on: boolean }
  | { type: "select"; norad: number }
  | { type: "skyGlance" }
  | { type: "timeController" }
  | { type: "configure" }
  | { type: "clone" }
  | { type: "delete" }
  | { type: "close" };

/** A satellite of "Select satellite". */
export interface SatChoice {
  norad: number;
  name: string;
}

/** The satellites of a tick sorted by name (Gpredict: "satellite nicknames sorted by name"); empty before the first tick. */
export function satChoices(sats: readonly SatState[] | undefined): SatChoice[] {
  return (sats ?? []).map((s) => ({ norad: s.norad, name: s.name })).sort((a, b) => compareNames(a.name, b.name) || a.norad - b.norad);
}

export interface ModuleMenuState {
  /** Autotrack is on for this module */
  autotrack: boolean;
  /** the satellites to choose from, sorted by name */
  choices: readonly SatChoice[];
  /** the module's selected satellite */
  selected: number | null;
}

/**
 * Gpredict's module popup, docked: Detach module, Full screen, Autotrack, Select satellite, Sky at a glance, Time Controller,
 * Radio Control, Antenna Control, Configure, Clone..., Delete, Close. Detach, Full screen and the two controls are for later
 * sub-projects (spec §8.2); Sky at a glance opens its window (sub-project 2, Task 14). Select satellite is off while there is no satellite to choose.
 */
export function moduleMenu({ autotrack, choices, selected }: ModuleMenuState): MenuSpec<ModuleAction>[] {
  return [
    laterItem("Detach module"),
    laterItem("Full screen"),
    SEPARATOR,
    { kind: "check", label: "Autotrack", checked: autotrack, action: { type: "autotrack", on: !autotrack } },
    {
      kind: "submenu",
      label: "Select satellite",
      disabled: choices.length === 0,
      items: choices.map((c): MenuSpec<ModuleAction> => ({ kind: "radio", label: c.name, checked: c.norad === selected, action: { type: "select", norad: c.norad } })),
    },
    SEPARATOR,
    { kind: "item", label: "Sky at a glance", action: { type: "skyGlance" } },
    { kind: "item", label: "Time Controller", action: { type: "timeController" } },
    SEPARATOR,
    laterItem("Radio Control"),
    laterItem("Antenna Control"),
    SEPARATOR,
    { kind: "item", label: "Configure", action: { type: "configure" } },
    { kind: "item", label: "Clone...", action: { type: "clone" } },
    SEPARATOR,
    { kind: "item", label: "Delete", action: { type: "delete" } },
    { kind: "item", label: "Close", action: { type: "close" } },
  ];
}
