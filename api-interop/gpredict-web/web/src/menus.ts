// The menu bar (ref §1, spec §8.2): File, Edit and Help, with the accelerators of Gpredict. Pure; MenuBar.tsx shows it.

import { laterItem, SEPARATOR } from "./menuSpec";
import type { MenuSpec } from "./menuSpec";

export const MENU_TITLES = ["File", "Edit", "Help"] as const;
export type MenuTitle = (typeof MENU_TITLES)[number];

/** What an enabled item of the menu bar does. */
export type BarAction = "newModule" | "openModule" | "quit" | "updateTle" | "preferences" | "onlineHelp" | "license" | "about";

/** Accelerators that work: Gpredict's Ctrl+N, Ctrl+O, Ctrl+Q and F1 (Online help). Log browser's Ctrl+L is shown but not used. */
const ACCEL: Readonly<Record<BarAction, string | undefined>> = {
  newModule: "Ctrl+N",
  openModule: "Ctrl+O",
  quit: "Ctrl+Q",
  updateTle: undefined,
  preferences: undefined,
  onlineHelp: "F1",
  license: undefined,
  about: undefined,
};

function item(label: string, action: BarAction): MenuSpec<BarAction> {
  const accel = ACCEL[action];
  return accel === undefined ? { kind: "item", label, action } : { kind: "item", label, action, accel };
}

/** The items of a menu in Gpredict's order. Labels are Gpredict's (menubar.c); "About Gpredict Web" and the lack of News are ours. */
export function barMenu(title: MenuTitle): MenuSpec<BarAction>[] {
  switch (title) {
    case "File":
      return [item("New module", "newModule"), item("Open module", "openModule"), SEPARATOR, laterItem("Log browser", "Ctrl+L"), SEPARATOR, item("Quit", "quit")];
    case "Edit":
      return [
        item("Update TLE data from network", "updateTle"),
        laterItem("Update TLE data from local files"),
        laterItem("Update transponder data"),
        SEPARATOR,
        item("Preferences", "preferences"),
      ];
    case "Help":
      return [item("Online help", "onlineHelp"), SEPARATOR, item("License", "license"), SEPARATOR, item("About Gpredict Web", "about")];
  }
}

/** What `shortcutAction` needs of a keyboard event. */
export interface KeyInfo {
  key: string;
  code: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

const CTRL_LETTER: Readonly<Record<string, { key: string; code: string; action: BarAction }>> = {
  n: { key: "n", code: "KeyN", action: "newModule" },
  o: { key: "o", code: "KeyO", action: "openModule" },
  q: { key: "q", code: "KeyQ", action: "quit" },
};

const LATIN_LETTER = /^[a-z]$/i;

/**
 * The action a key press stands for, or null. Ctrl+N, Ctrl+O, Ctrl+Q and F1, with no other modifier. The letter is the key
 * itself. Only when the layout gives something that is not a Latin letter (Thai, Cyrillic, a dead key) is the key found by its
 * place on the keyboard: on AZERTY or Dvorak the place of N, O or Q holds another Latin letter, and Ctrl+that letter must not
 * be taken for them (Ctrl+A on AZERTY sits where Ctrl+Q does on QWERTY).
 */
export function shortcutAction(e: KeyInfo): BarAction | null {
  if (e.shiftKey || e.altKey || e.metaKey) return null;
  if (!e.ctrlKey) return e.key === "F1" ? "onlineHelp" : null;
  const latin = LATIN_LETTER.test(e.key);
  const key = e.key.toLowerCase();
  for (const s of Object.values(CTRL_LETTER)) {
    if (latin ? key === s.key : e.code === s.code) return s.action;
  }
  return null;
}
