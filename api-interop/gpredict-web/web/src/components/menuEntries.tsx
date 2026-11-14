import type { MenuSpec } from "../menuSpec";
import type { MenuEntry } from "./PopupMenu";

/** The entries of PopupMenu for a menu spec: choosing an item calls `run` with its action. */
export function toEntries<A>(spec: readonly MenuSpec<A>[], run: (action: A) => void): MenuEntry[] {
  return spec.map((e): MenuEntry => {
    switch (e.kind) {
      case "separator":
        return { kind: "separator" };
      case "item": {
        const label = e.bold ? <b>{e.label}</b> : e.label;
        const action = e.action;
        return { kind: "item", label, accel: e.accel, onChoose: action === undefined ? undefined : () => run(action) };
      }
      case "check": {
        const action = e.action;
        return { kind: "check", label: e.label, checked: e.checked, disabled: e.disabled, title: e.hint, onChoose: () => action !== undefined && run(action) };
      }
      case "radio":
        return { kind: "radio", label: e.label, checked: e.checked, onChoose: () => run(e.action) };
      case "submenu":
        return { kind: "submenu", label: e.label, items: toEntries(e.items, run), disabled: e.disabled };
    }
  });
}
