// Features Gpredict has that a sub-project had not made yet were shown, disabled, with a tooltip that names the sub-project that
// adds them (spec §8.2). Since sub-project 4 (Task 23: Detach module and Full screen) no menu item is left: the table of those
// labels (LATER) and the helpers that made such items (laterOf, menuSpec's laterItem) are gone. A menu item or a group of Preferences
// can still be marked `later` (menuSpec.ts, prefs/prefGroups.ts) and gets this tooltip; later.test.ts checks that no menu item is.

/** Names of the later sub-projects, by number (spec §1: 2 Pass predictions, 3 Radio & Rotator, 4 Data & Preferences). */
const SUB_PROJECTS: Readonly<Record<2 | 3 | 4, string>> = {
  2: "Pass predictions",
  3: "Radio & Rotator",
  4: "Data & Preferences",
};

/** The tooltip of a menu item that belongs to sub-project `n`. */
export function laterTooltip(n: 2 | 3 | 4): string {
  return `อยู่ในงานย่อยที่ ${n}: ${SUB_PROJECTS[n]}`;
}
