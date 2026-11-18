// The General group of Preferences, the pages Number Formats and Message Logs (ref-D §2 and §7.1, sat-pref-formats.c and
// sat-pref-debug.c): their labels, tooltips, items and texts, copied letter for letter from Gpredict. Pure: GeneralPages.tsx shows them.
// The keys are the server's (server/gpredict_web/prefs.py).

import { TIME_FORMAT_MAX, TIME_PLACEHOLDER, formatTime } from "../format";

/**
 * The notebook's tabs, in Gpredict's order (`sat-pref-general.c:50-61`). `GeneralPages` shows those that have a page so far; the names
 * are the ones `prefPlaces.ts` gives in an error of the window ("General → Message Logs: ...").
 */
export const GENERAL_TABS = ["Number Formats", "Ground Stations", "TLE Update", "Message Logs"] as const;

export type GeneralTab = (typeof GENERAL_TABS)[number];

// ---------------------------------------------------------------- Number Formats (ref-D §2)

/** The four settings of the page, in the order of the page; the time format has its own "Reset" button beside it. */
export const NUMBER_FORMAT_CONTROLS = {
  local: {
    key: "GLOBAL/USE_LOCAL_TIME",
    label: "Show local time instead of UTC.",
    tooltip:
      "Display local time instead of UTC. Note: The local time is that of your operating system and not the local time at the " +
      "location, which you select as tracking reference.",
  },
  timeFormat: {
    key: "GLOBAL/TIME_FORMAT",
    label: "Time format:",
    tooltip:
      "Enter a format string using the following codes:\n\n" +
      "\t%Y\tYear with century.\n" +
      "\t%m\tMonth (01-12).\n" +
      "\t%d\tDay of the month (01-31).\n" +
      "\t%j\tDay of the year (001-366).\n" +
      "\t%H\tHour (00-23).\n" +
      "\t%M\tMinute (00-59).\n" +
      "\t%S\tSeconds (00-59).\n\n" +
      "See the user manual for more codes and examples.",
    maxLength: TIME_FORMAT_MAX,
    resetLabel: "Reset",
    resetTooltip: "Reset to default value",
  },
  nsew: {
    key: "GLOBAL/USE_NSEW",
    label: "Use N/S/E/W for geographical coordinates.",
    tooltip:
      "Checking this box will cause geographical coordinates to be displayed using a suffix instead of sign (eg. 23.43°W instead of -23.43°).",
  },
  imperial: {
    key: "GLOBAL/USE_IMPERIAL",
    label: "Use Imperial units instead of Metric.",
    tooltip: "Display distances using Imperial units, for example miles instead of kilometres.",
  },
} as const;

/** The keys of the page. The page has no Reset of its own: Gpredict has none either. */
export const NUMBER_FORMAT_KEYS: readonly string[] = [
  NUMBER_FORMAT_CONTROLS.local.key,
  NUMBER_FORMAT_CONTROLS.timeFormat.key,
  NUMBER_FORMAT_CONTROLS.nsew.key,
  NUMBER_FORMAT_CONTROLS.imperial.key,
];

/** What the "Reset" beside the time format puts back: the format and nothing else (`reset_cb`, sat-pref-formats.c:207-217). */
export const TIME_FORMAT_RESET_KEYS: readonly string[] = [NUMBER_FORMAT_CONTROLS.timeFormat.key];

/** What the preview label reads until its first update, one second after the page opens (`:92`). */
export const PREVIEW_START = TIME_PLACEHOLDER;

/** The preview is rewritten every second (`:95`). */
export const PREVIEW_TICK_MS = 1000;

/**
 * The preview of the time format: `now` formatted by the text `fmt` as typed (not yet saved), in local time or UTC as the box is
 * ticked (not yet saved) (`tfprev_cb`, `:171-194`). A time that is not one gives the placeholder.
 * (Gpredict's preview uses GLib's formatter and does not cut the text; ours is the formatter of the views, which does at 49 characters.)
 */
export function previewText(fmt: string, local: boolean, now: Date): string {
  return formatTime(now, fmt, local);
}

// ---------------------------------------------------------------- Message Logs (ref-D §7.1)

export const LOG_LEVEL_LABEL = "Debug level:";
export const LOG_LEVEL_KEY = "LOG/LEVEL";
/** "Level 0: None" to "Level 4: Debug": the index of an item is the level (`:171-194`). */
export const LOG_LEVEL_ITEMS: readonly string[] = ["Level 0: None", "Level 1: Error", "Level 2: Warning", "Level 3: Info", "Level 4: Debug"];
/** The tooltip of the combo (Gpredict puts it on the combo's button). */
export const LOG_LEVEL_TIP = "Select the debug level. The higher the level, the more messages will be logged.";

export const LOG_CLEAN_AGE_LABEL = "Delete log files older than:";
export const LOG_CLEAN_AGE_KEY = "LOG/CLEAN_AGE";
/**
 * The items of the age combo and the age in seconds each stands for. Gpredict's "1 month" is 18144000 s (210 days, `:33`), a
 * mistake of its own; the server keeps `LOG_CLEAN_AGES`, where a month is 30 days (ref-D §7.1).
 */
export const CLEAN_AGE_ITEMS: readonly (readonly [string, number])[] = [
  ["Always delete", 0],
  ["1 day", 86400],
  ["1 week", 604800],
  ["1 month", 2592000],
];
export const LOG_CLEAN_AGE_TIP = "Select how often gpredict should delete old log files.";

/** The item that shows a stored age; any other value shows "Always delete" (`select_age`, `:82-98`). */
export function cleanAgeIndex(seconds: number): number {
  const i = CLEAN_AGE_ITEMS.findIndex(([, age]) => age === seconds);
  return i < 0 ? 0 : i;
}

/** The keys the page's "Reset" puts back. */
export const MESSAGE_LOG_KEYS: readonly string[] = [LOG_LEVEL_KEY, LOG_CLEAN_AGE_KEY];
export const LOG_RESET_TIP = "Reset settings to the default values.";

/**
 * The text below the separator (`:225-238`). Gpredict writes the user conf dir and `logs` where this text has `logDir`
 * (`<conf dir>/logs`, GET /api/meta `log_dir`, plan decision 17), followed by one separator.
 */
export function logInfoText(logDir: string): string {
  const sep = logDir.includes("\\") && !logDir.includes("/") ? "\\" : "/";
  const dir = logDir.endsWith("/") || logDir.endsWith("\\") ? logDir : `${logDir}${sep}`;
  return (
    `Gpredict stores all run-time messages in the ${dir}\n` +
    "directory. The current log file is called gpredict.log and the file is\n" +
    "always kept until the next execution, so that you can examine it in case\n" +
    "of a failure. If old log files are kept, they are called gpredict-XYZ.log\n" +
    "where XYZ is a unique timestamp."
  );
}
