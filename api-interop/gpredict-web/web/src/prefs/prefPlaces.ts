// Where a failure of Preferences belongs: "<group> → <tab>: <Thai text of the server>" (spec §10, ของเรา: Gpredict has no such message).
// Pure. The window shows it when a check before OK, the save or a page's commit fails, and stays open.

import { ApiError, errorText } from "../api";
import { propsTabLabel } from "../moduleProps";
import type { PropsTab } from "../moduleProps";
import { PAGE_KEYS, PREDICT_TABS } from "./predictPrefs";
import type { PrefGroupId } from "./prefGroups";

export interface Place {
  group: PrefGroupId;
  /** the tab of the group's notebook (ref-D §1) */
  tab: string;
}

const NUMBER_FORMATS = new Set(["GLOBAL/USE_LOCAL_TIME", "GLOBAL/TIME_FORMAT", "GLOBAL/USE_NSEW", "GLOBAL/USE_IMPERIAL"]);
/** the "Window Placements" boxes and the layout, which are on the Layout tab of Modules (spec §9.2) */
const LAYOUT = new Set(["GLOBAL/MAIN_WIN_POS", "GLOBAL/MOD_WIN_POS", "GLOBAL/MOD_STATE", "MODULES/GRID"]);

const PREDICT_PLACES = new Map<string, Place>(
  PREDICT_TABS.flatMap((t) => PAGE_KEYS[t.id].map((key): [string, Place] => [key, { group: "predict", tab: t.label }])),
);

/** The group and tab that show `key`, or null for a key no page of Preferences shows (CURRENT_PAGE, LAST_UPDATE, a key that does not exist). */
export function prefPlace(key: string): Place | null {
  const general = (tab: string): Place => ({ group: "general", tab });
  // the tabs of Modules by the labels of the notebook that shows them (Module properties and Preferences → Modules share it)
  const modules = (tab: PropsTab): Place => ({ group: "modules", tab: propsTabLabel(tab) });
  if (NUMBER_FORMATS.has(key)) return general("Number Formats");
  if (LAYOUT.has(key)) return modules("layout");
  if (key === "TLE/LAST_UPDATE") return null; // kept by Update TLE, not a setting
  if (key.startsWith("TLE/")) return general("TLE Update");
  if (key.startsWith("LOG/")) return general("Message Logs");
  if (key === "MODULES/DATA_TIMEOUT" || (key.startsWith("MODULES/") && key.endsWith("_REFRESH"))) return modules("refresh");
  if (key === "MODULES/LIST_COLUMNS") return modules("list");
  if (key.startsWith("MODULES/MAP_")) return modules("map");
  if (key.startsWith("MODULES/POLAR_")) return modules("polar");
  if (key === "MODULES/SINGLE_SAT_FIELDS") return modules("single");
  return PREDICT_PLACES.get(key) ?? null;
}

/**
 * A failure of a page's own check or commit that knows which tab of its group it is about (the Interfaces page tells Radios from
 * Rotators). `message` is the Thai text of the server.
 */
export class TabError extends Error {
  readonly tab: string;

  constructor(tab: string, text: string) {
    super(text);
    this.name = "TabError";
    this.tab = tab;
  }
}

const placed = (group: string, tab: string | null, e: unknown): string =>
  `${group}${tab === null ? "" : ` → ${tab}`}: ${errorText(e)}`;

/** The text for the refusal of the preferences (PUT /api/prefs): placed by the key the server names; the text alone if the key has no place. */
export function prefsFailure(e: unknown, labelOf: (group: PrefGroupId) => string): string {
  const place = e instanceof ApiError && e.object !== null ? prefPlace(e.object) : null;
  return place === null ? errorText(e) : placed(labelOf(place.group), place.tab, e);
}

/** The text for a failure of a page's check or commit: its group, and its tab when the failure names one. */
export function pageFailure(groupLabel: string, e: unknown): string {
  return placed(groupLabel, e instanceof TabError ? e.tab : null, e);
}
