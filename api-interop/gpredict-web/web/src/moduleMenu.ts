// The Module menu (ref §2): Gpredict's items in order. Pure; ModuleMenu.tsx shows it.

import { SEPARATOR } from "./menuSpec";
import type { MenuSpec } from "./menuSpec";
import type { SatState } from "./types";
import { compareNames } from "./views/cells";

/** What an enabled item of the Module menu does. */
export type ModuleAction =
  | { type: "detach" }
  | { type: "attach" }
  | { type: "fullscreen" }
  | { type: "exitFullscreen" }
  | { type: "autotrack"; on: boolean }
  | { type: "select"; norad: number }
  | { type: "skyGlance" }
  | { type: "timeController" }
  | { type: "radio" }
  | { type: "rotator" }
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
  /** where the module is: a tab of the main page, or a window of its own (spec §8.1) */
  place: "docked" | "window";
  /** the page is full screen (the Fullscreen API, spec §8.3) */
  fullscreen: boolean;
  /** Autotrack is on for this module */
  autotrack: boolean;
  /** the satellites to choose from, sorted by name */
  choices: readonly SatChoice[];
  /** the module's selected satellite */
  selected: number | null;
}

/**
 * Gpredict's module popup: Detach module (Attach module), Full screen (Exit full screen), Autotrack, Select satellite, Sky at a glance,
 * Time Controller, Radio Control, Antenna Control, Configure, Clone..., Delete, Close. Every item works since sub-project 4: Detach,
 * Attach and Full screen since Task 23 (spec §8), Sky at a glance since sub-project 2, Radio Control and Antenna Control since 3.
 * Select satellite is off while there is no satellite to choose.
 *
 * The first two follow Gpredict's three states (ref §2): "Detach module" only when docked and not full screen, "Attach module"
 * otherwise; "Exit full screen" while full screen. A module made full screen in its tab is Gpredict's full screen state, so it has
 * "Attach module" (back to the tab as it was) and "Exit full screen" (a window, spec §8.3).
 */
export function moduleMenu({ place, fullscreen, autotrack, choices, selected }: ModuleMenuState): MenuSpec<ModuleAction>[] {
  const docked = place === "docked" && !fullscreen;
  return [
    docked ? { kind: "item", label: "Detach module", action: { type: "detach" } } : { kind: "item", label: "Attach module", action: { type: "attach" } },
    fullscreen ? { kind: "item", label: "Exit full screen", action: { type: "exitFullscreen" } } : { kind: "item", label: "Full screen", action: { type: "fullscreen" } },
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
    { kind: "item", label: "Radio Control", action: { type: "radio" } },
    { kind: "item", label: "Antenna Control", action: { type: "rotator" } },
    SEPARATOR,
    { kind: "item", label: "Configure", action: { type: "configure" } },
    { kind: "item", label: "Clone...", action: { type: "clone" } },
    SEPARATOR,
    { kind: "item", label: "Delete", action: { type: "delete" } },
    { kind: "item", label: "Close", action: { type: "close" } },
  ];
}
