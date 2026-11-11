// A menu as data (pure, no React): the menu bar, the Module menu and the satellite popups are built from these, so that their
// items, order, accelerators and the disabled ones of LATER can be tested. components/menuEntries.tsx turns a spec into the
// entries of PopupMenu.

import { laterOf } from "./later";

/** One entry of a menu. `A` is the kind of action an enabled entry performs. */
export type MenuSpec<A> =
  | { kind: "separator" }
  | {
      kind: "item";
      label: string;
      action?: A;
      /** accelerator written at the right, e.g. "Ctrl+N" */
      accel?: string;
      /** shown in bold (the satellite name at the top of a popup) */
      bold?: boolean;
      /** a later sub-project has it: the item is disabled and its tooltip names the sub-project */
      later?: 2 | 3 | 4;
    }
  | { kind: "check"; label: string; checked: boolean; action?: A; disabled?: boolean; hint?: string }
  | { kind: "radio"; label: string; checked: boolean; action: A }
  | { kind: "submenu"; label: string; items: readonly MenuSpec<A>[]; disabled?: boolean };

export const SEPARATOR = { kind: "separator" } as const;

/** A disabled item of a later sub-project; `label` must be one of LATER. */
export function laterItem<A>(label: string, accel?: string): MenuSpec<A> {
  return accel === undefined ? { kind: "item", label, later: laterOf(label) } : { kind: "item", label, accel, later: laterOf(label) };
}

/** A menu as lines of text, for tests and logs: "-" separator, "[x]" / "[ ]" check, "(o)" / "( )" radio, "x >" submenu (its lines indented). */
export function outline<A>(menu: readonly MenuSpec<A>[]): string[] {
  return menu.flatMap((e): string[] => {
    switch (e.kind) {
      case "separator":
        return ["-"];
      case "item":
        return [e.label + (e.accel === undefined ? "" : ` [${e.accel}]`) + (e.bold ? " (bold)" : "") + (e.later === undefined ? "" : ` (later ${e.later})`)];
      case "check":
        return [`[${e.checked ? "x" : " "}] ${e.label}${e.disabled ? " (disabled)" : ""}`];
      case "radio":
        return [`(${e.checked ? "o" : " "}) ${e.label}`];
      case "submenu":
        return [`${e.label} >`, ...outline(e.items).map((line) => `  ${line}`)];
    }
  });
}
