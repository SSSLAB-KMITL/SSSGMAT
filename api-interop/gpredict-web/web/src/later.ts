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
 * Gpredict writes it, and the sub-project that adds it. "Satellite info" is also the bold satellite name of the Single sat and
 * Event list popups and the double click on a satellite. Help has no News (spec §8.2).
 */
export const LATER: Readonly<Record<string, 2 | 3 | 4>> = {
  // File
  "Log browser": 4,
  // Edit
  "Update TLE data from local files": 4,
  "Update transponder data": 3,
  // Module menu
  "Detach module": 4,
  "Full screen": 4,
  "Sky at a glance": 2,
  "Radio Control": 3,
  "Antenna Control": 3,
  // the satellite popups
  "Satellite info": 4,
  "Show current pass": 2,
  "Show next pass": 2,
  "Future passes": 2,
};

/** The sub-project of a label in LATER; throws for a label that is not there, so that a typo cannot make an item look available. */
export function laterOf(label: string): 2 | 3 | 4 {
  const n = LATER[label];
  if (n === undefined) throw new Error(`"${label}" is not in LATER`);
  return n;
}
