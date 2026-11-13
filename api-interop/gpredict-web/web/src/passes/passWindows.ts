// The pass windows that are open (Pass details, Upcoming passes) and the small decisions they make: titles, the columns shown,
// the selected row and the row popup. Pure, no DOM and no React (PassWindows.tsx draws them).

import type { MenuEntry } from "../components/PopupMenu";
import type { PassColumn } from "./passCells";
import type { PassInfo, PassQth, PassSat } from "./types";

/**
 * A pass window. Pass details shows one pass; its `parent` is the Upcoming passes window it was opened from (it closes with it,
 * ref-P §2.1), or null when it was opened by Show next pass, Show current pass or Sky at a glance. Upcoming passes shows all the passes
 * of the answer. Both keep the answer they were opened with: the module can be closed or the satellite taken out while they are open.
 */
export type PassWindow =
  | { id: string; kind: "details"; answer: { sat: PassSat; qth: PassQth; pass: PassInfo }; parent: string | null }
  | { id: string; kind: "upcoming"; answer: { sat: PassSat; qth: PassQth; passes: PassInfo[] } };

let lastId = 0;

/** An id no other window has had in this page. */
export const newId = (): string => `pass-window:${++lastId}`;

/**
 * The list with `w` added at the end (in front). Several windows can be open, also for the same pass (each opening makes its own,
 * as Gpredict does): only a window with the same id, which is the same window, is not added again.
 */
export function openWindow(list: readonly PassWindow[], w: PassWindow): readonly PassWindow[] {
  return list.some((o) => o.id === w.id) ? list : [...list, w];
}

/** The list without window `id` and without the details windows opened from it (Gpredict destroys them with their parent). */
export function closeWindow(list: readonly PassWindow[], id: string): readonly PassWindow[] {
  if (!list.some((w) => w.id === id)) return list;
  return list.filter((w) => w.id !== id && !(w.kind === "details" && w.parent === id));
}

// ---------------------------------------------------------------- titles (ref-P §1.5)

/** `Pass details for %s (orbit %d)`, the title of the window and of the print-out. */
export const detailsTitle = (sat: PassSat, pass: PassInfo): string => `Pass details for ${sat.name} (orbit ${pass.orbit})`;

/** `Upcoming passes for %s` */
export const upcomingTitle = (sat: PassSat): string => `Upcoming passes for ${sat.name}`;

// ---------------------------------------------------------------- the columns

/** The titles in a column preference (`PREDICT/SINGLE_PASS_COL`, `PREDICT/MULTI_PASS_COL`); null if it is not a list of texts (or not loaded). */
export function columnTitles(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((t): t is string => typeof t === "string") ? value : null;
}

/** The columns of `all` whose title is in `titles`, in the fixed order of `all` (Gpredict's order, whatever the order in the preference). */
export const visibleColumns = (all: readonly PassColumn[], titles: readonly string[]): PassColumn[] => all.filter((c) => titles.includes(c.title));

// ---------------------------------------------------------------- Upcoming passes: rows and popup

/**
 * The selected row after the key that moves it by `delta` (-1 up, 1 down) in a list of `count` rows: it stops at the first and the last
 * row. With no row selected, Down selects the first and Up the last. Null if there is no row to select.
 */
export function moveRow(selected: number | null, delta: -1 | 1, count: number): number | null {
  if (count <= 0) return null;
  if (selected === null) return delta > 0 ? 0 : count - 1;
  return Math.min(Math.max(selected + delta, 0), count - 1);
}

/**
 * The popup of a row of Upcoming passes (ref-P §3.4): "Show details", a separator, "Polar plot" and "Az/El plot". The last two are
 * disabled: Gpredict's handlers for them are stubs, so they can never run (the plots are on the tabs of Pass details).
 */
export function upcomingMenu(onShowDetails: () => void): MenuEntry[] {
  return [
    { kind: "item", label: "Show details", onChoose: onShowDetails },
    { kind: "separator" },
    { kind: "item", label: "Polar plot", disabled: true },
    { kind: "item", label: "Az/El plot", disabled: true },
  ];
}

// ---------------------------------------------------------------- where a window opens

const CASCADE_STEP = 24;
const CASCADE_COUNT = 8;

/**
 * Where the `index`-th pass window opens, in client px (ของเรา: Gpredict leaves it to the window manager). Each window is a step
 * lower and to the right of the one before, so several windows opened one after another do not hide each other; after a few
 * the position starts again at the first, so it never leaves the page.
 */
export function cascadePosition(index: number): { x: number; y: number } {
  const step = (index % CASCADE_COUNT) * CASCADE_STEP;
  return { x: 120 + step, y: 90 + step };
}
