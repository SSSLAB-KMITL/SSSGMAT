// Features Gpredict has that this sub-project (1: Tracking core) does not: their menu items are shown, disabled, with a
// tooltip that names the sub-project that adds them (spec §8.2).

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

/**
 * Every item of Gpredict's menus that cannot be used yet (the column "กดไม่ได้" of the table in spec §8.2), by its label as
 * Gpredict writes it, and the sub-project that adds it. Help has no News (spec §8.2). Show current pass, Show next pass and
 * Future passes were here until sub-project 2 made them real (Task 13), and so was "Sky at a glance" (Task 14); so were Radio
 * Control, Antenna Control and Update transponder data until sub-project 3 (Task 14); so were Update TLE data from local files
 * (Task 18), "Satellite info" (the popups' item, the bold satellite name and the double click, Task 19) and "Log browser" (File → Log
 * browser, Ctrl+L, Task 20) until sub-project 4.
 */
export const LATER: Readonly<Record<string, 2 | 3 | 4>> = {
  // Module menu
  "Detach module": 4,
  "Full screen": 4,
};

/** The sub-project of a label in LATER; throws for a label that is not there, so that a typo cannot make an item look available. */
export function laterOf(label: string): 2 | 3 | 4 {
  const n = LATER[label];
  if (n === undefined) throw new Error(`"${label}" is not in LATER`);
  return n;
}
