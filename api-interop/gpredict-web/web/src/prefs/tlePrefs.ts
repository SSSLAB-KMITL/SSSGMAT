// The TLE Update tab of Preferences → General (ref-D §4, sat-pref-tle.c): its labels, items and tooltips copied letter for letter from
// Gpredict, and the three things the list of TLE sources does (Add, Delete, edit a row). Pure: TleUpdatePage.tsx shows it.
// The keys are the server's (server/gpredict_web/prefs.py).

/** The URL that "Add TLE source" appends (`add_tle_cb`, sat-pref-tle.c:134-155; the plan's NEW_SOURCE_URL). */
export const NEW_SOURCE_URL = "http://server.com/file.txt";

/** The keys of the controls. */
export const TLE_KEYS = {
  freq: "TLE/AUTO_UPDATE_FREQ",
  action: "TLE/AUTO_UPDATE_ACTION",
  proxy: "TLE/PROXY",
  urls: "TLE/URLS",
  addNew: "TLE/ADD_NEW_SATS",
} as const;

/** What the page's "Reset" puts back: the five keys (`reset_cb`, `:402-418`). TLE/LAST_UPDATE is not a setting and stays. */
export const TLE_PAGE_KEYS: readonly string[] = [TLE_KEYS.freq, TLE_KEYS.action, TLE_KEYS.proxy, TLE_KEYS.urls, TLE_KEYS.addNew];

// ---------------------------------------------------------------- Auto-Update

/** The bold header of the block (Gpredict writes it as `<b>Auto-Update:</b>`, `:73`). */
export const AUTO_UPDATE_HEADER = "Auto-Update:";

export const FREQ_LABEL = "Check the age of TLE data:";
/** The items of the combo: the index of an item is the value of TLE/AUTO_UPDATE_FREQ (`tle_update_freq_to_str`, tle-update.c:1355-1368). */
export const FREQ_ITEMS: readonly string[] = ["Never", "Monthly", "Weekly", "Daily"];

export const ACTION_LABEL = "If TLEs are too old:";
/** The two radio buttons and the value of TLE/AUTO_UPDATE_ACTION each stands for. */
export const ACTION_ITEMS: readonly { value: number; label: string }[] = [
  { value: 1, label: "Notify me" },
  { value: 2, label: "Perform automatic update in the background" },
];

// ---------------------------------------------------------------- Update from the Internet

/** The bold header of the block (`<b>Update from the Internet:</b>`, `:260-261`). */
export const INTERNET_HEADER = "Update from the Internet:";

export const PROXY_LABEL = "Proxy server:";
export const PROXY_TIP = "Enter URL for local proxy server. e.g.\nhttp://my.proxy.com";
/** The server keeps a proxy of at most this many characters (TLE_PROXY_MAX; Gpredict's entry has no limit, ของเรา). */
export const PROXY_MAX = 200;

export const SOURCES_LABEL = "TLE sources:";
export const SOURCES_TIP = "List of files with TLE data to retrieve from the Internet\nClick twice on a row to edit";

/** The buttons under the list and their tooltips (`create_tle_buttons`, `:204-211`). */
export const SOURCE_BUTTONS = {
  add: { label: "Add TLE source", tip: "Add a new TLE source to the list" },
  delete: { label: "Delete TLE source", tip: "Delete the selected TLE source" },
} as const;

/** The message box of Delete when the list has fewer than two rows (`del_tle_cb`, `:158-198`). */
export const LAST_SOURCE_MESSAGE =
  "Can not delete TLE source!\n\n" +
  "You should have at least one TLE source configured, otherwise Gpredict may not work correctly.\n\n" +
  "If you want to modify the TLE source, click twice on the row to edit it.";

/** The check box under the list (`create_misc`, `:328-337`). */
export const ADD_NEW = {
  label: "Add new satellites to local database",
  tip: "Note that selecting this option may cause previously deleted satellites to be re-added to the database.",
} as const;

export const TLE_RESET_TIP = "Reset settings to the default values.";

// ---------------------------------------------------------------- the list of sources

/** The list with the placeholder URL added at the end (the page selects the new row; it does not start editing it, `:150`). */
export function addSource(urls: readonly string[]): string[] {
  return [...urls, NEW_SOURCE_URL];
}

/**
 * The list without row `i`. With fewer than two rows nothing is deleted and the answer is "last" (the box of `LAST_SOURCE_MESSAGE`; that
 * counts the rows, so it is so whichever row is selected, as in Gpredict). With a row that is not there (nothing is selected) the list is
 * the same as it was.
 */
export function deleteSource(urls: readonly string[], i: number | null): string[] | "last" {
  if (urls.length < 2) return "last";
  return i === null || i < 0 || i >= urls.length ? [...urls] : urls.filter((_, row) => row !== i);
}

/** The list with the text of row `i` replaced by what was typed (`url_edited_cb`, `:121-132`): not checked here, the server checks the list on OK. */
export function editSource(urls: readonly string[], i: number, text: string): string[] {
  return urls.map((url, row) => (row === i ? text : url));
}
