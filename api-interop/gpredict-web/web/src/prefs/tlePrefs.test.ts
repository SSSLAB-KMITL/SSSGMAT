import { describe, expect, it } from "vitest";
import { GENERAL_TABS } from "./generalPrefs";
import { prefPlace } from "./prefPlaces";
import {
  ACTION_ITEMS,
  ACTION_LABEL,
  ADD_NEW,
  addSource,
  AUTO_UPDATE_HEADER,
  deleteSource,
  editSource,
  FREQ_ITEMS,
  FREQ_LABEL,
  INTERNET_HEADER,
  LAST_SOURCE_MESSAGE,
  NEW_SOURCE_URL,
  PROXY_LABEL,
  PROXY_TIP,
  SOURCE_BUTTONS,
  SOURCES_LABEL,
  SOURCES_TIP,
  TLE_KEYS,
  TLE_PAGE_KEYS,
  TLE_RESET_TIP,
} from "./tlePrefs";

describe("TLE Update page (ref-D §4, sat-pref-tle.c)", () => {
  it("TLE_PAGE_KEYS are the five keys Reset puts back", () => {
    expect([...TLE_PAGE_KEYS]).toEqual(["TLE/AUTO_UPDATE_FREQ", "TLE/AUTO_UPDATE_ACTION", "TLE/PROXY", "TLE/URLS", "TLE/ADD_NEW_SATS"]);
  });

  it("every key of the page is shown by the General → TLE Update tab of an error of the window", () => {
    for (const key of TLE_PAGE_KEYS) expect(prefPlace(key), key).toEqual({ group: "general", tab: GENERAL_TABS[2] });
    expect(GENERAL_TABS[2]).toBe("TLE Update");
  });

  it("names the keys of the controls", () => {
    expect(TLE_KEYS).toEqual({
      freq: "TLE/AUTO_UPDATE_FREQ",
      action: "TLE/AUTO_UPDATE_ACTION",
      proxy: "TLE/PROXY",
      urls: "TLE/URLS",
      addNew: "TLE/ADD_NEW_SATS",
    });
  });

  it("has the labels of Gpredict, letter for letter", () => {
    expect(AUTO_UPDATE_HEADER).toBe("Auto-Update:");
    expect(FREQ_LABEL).toBe("Check the age of TLE data:");
    expect([...FREQ_ITEMS]).toEqual(["Never", "Monthly", "Weekly", "Daily"]); // the index is the value 0-3
    expect(ACTION_LABEL).toBe("If TLEs are too old:");
    expect(ACTION_ITEMS).toEqual([
      { value: 1, label: "Notify me" },
      { value: 2, label: "Perform automatic update in the background" },
    ]);
    expect(INTERNET_HEADER).toBe("Update from the Internet:");
    expect(PROXY_LABEL).toBe("Proxy server:");
    expect(SOURCES_LABEL).toBe("TLE sources:");
    expect(ADD_NEW.label).toBe("Add new satellites to local database");
  });

  it("has the tooltips of Gpredict, letter for letter", () => {
    expect(PROXY_TIP).toBe("Enter URL for local proxy server. e.g.\nhttp://my.proxy.com");
    expect(SOURCES_TIP).toBe("List of files with TLE data to retrieve from the Internet\nClick twice on a row to edit");
    expect(SOURCE_BUTTONS).toEqual({
      add: { label: "Add TLE source", tip: "Add a new TLE source to the list" },
      delete: { label: "Delete TLE source", tip: "Delete the selected TLE source" },
    });
    expect(ADD_NEW.tip).toBe("Note that selecting this option may cause previously deleted satellites to be re-added to the database.");
    expect(TLE_RESET_TIP).toBe("Reset settings to the default values.");
  });

  it("has the message of Delete with a single source, letter for letter", () => {
    expect(LAST_SOURCE_MESSAGE).toBe(
      "Can not delete TLE source!\n\n" +
        "You should have at least one TLE source configured, otherwise Gpredict may not work correctly.\n\n" +
        "If you want to modify the TLE source, click twice on the row to edit it.",
    );
  });
});

describe("the list of TLE sources (add_tle_cb, del_tle_cb, url_edited_cb)", () => {
  it("add source appends the placeholder", () => {
    expect(NEW_SOURCE_URL).toBe("http://server.com/file.txt");
    expect(addSource(["a"])).toEqual(["a", "http://server.com/file.txt"]);
    expect(addSource(["a", "b"])).toEqual(["a", "b", "http://server.com/file.txt"]);
  });

  it("add source leaves the list it was given as it was", () => {
    const urls = ["a"];
    addSource(urls);
    expect(urls).toEqual(["a"]);
  });

  it("cannot delete the last source", () => {
    expect(deleteSource(["a"], 0)).toBe("last");
    expect(deleteSource([], 0)).toBe("last"); // (fewer than two rows, as Gpredict counts)
    expect(deleteSource(["a"], null)).toBe("last"); // with no row selected too: the count is what decides
  });

  it("deletes the selected row and keeps the order of the others", () => {
    expect(deleteSource(["a", "b", "c"], 1)).toEqual(["a", "c"]);
    expect(deleteSource(["a", "b"], 0)).toEqual(["b"]);
    expect(deleteSource(["a", "b"], 1)).toEqual(["a"]);
  });

  it("deleting with no row selected, or a row that is not there, changes nothing", () => {
    const urls = ["a", "b"];
    expect(deleteSource(urls, null)).toEqual(["a", "b"]);
    expect(deleteSource(urls, 5)).toEqual(["a", "b"]);
    expect(deleteSource(urls, -1)).toEqual(["a", "b"]);
  });

  it("edits the text of a row in place", () => {
    expect(editSource(["a", "b", "c"], 1, "http://x/y.txt")).toEqual(["a", "http://x/y.txt", "c"]);
  });

  it("edit keeps whatever text it is given (the server checks the list on OK) and ignores a row that is not there", () => {
    expect(editSource(["a", "b"], 0, "")).toEqual(["", "b"]);
    expect(editSource(["a", "b"], 2, "z")).toEqual(["a", "b"]);
  });
});
