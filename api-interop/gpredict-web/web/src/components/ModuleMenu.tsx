import { useRef, useState } from "react";
import type { RefObject } from "react";
import { moduleMenu, satChoices } from "../moduleMenu";
import type { ModuleAction } from "../moduleMenu";
import type { SatState } from "../types";
import { toEntries } from "./menuEntries";
import { PopupMenu } from "./PopupMenu";

interface Props {
  /** top left corner in client px (the menu moves back into the window if it does not fit) */
  x: number;
  y: number;
  /** the "Module menu" button: a press on it does not close the menu (its own click does) */
  anchor: RefObject<HTMLElement | null>;
  /** Autotrack is on for the module */
  autotrack: boolean;
  /** the satellites of the newest tick, for "Select satellite"; undefined before the first tick */
  sats: readonly SatState[] | undefined;
  /** the module's selected satellite */
  selected: number | null;
  onAction: (action: ModuleAction) => void;
  onClose: (restoreFocus: boolean) => void;
}

/**
 * The Module menu (ref §2), opened by the "Module menu" button of the module header. Its items are built once, when it
 * opens, like GTK builds a popup when it is asked for; the menu closes when an item is chosen.
 */
export function ModuleMenu({ x, y, anchor, autotrack, sats, selected, onAction, onClose }: Props) {
  const latest = useRef(onAction);
  latest.current = onAction;
  const [entries] = useState(() => toEntries(moduleMenu({ autotrack, choices: satChoices(sats), selected }), (action) => latest.current(action)));
  return <PopupMenu x={x} y={y} items={entries} onClose={onClose} anchor={anchor} />;
}
