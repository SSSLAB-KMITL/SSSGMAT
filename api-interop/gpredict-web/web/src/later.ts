// Features Gpredict has that this sub-project (1: Tracking core) does not: their menu items are shown, disabled, with a
// tooltip that names the sub-project that adds them (spec §8.2). Task 18 adds the map of item names to sub-projects here.

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
