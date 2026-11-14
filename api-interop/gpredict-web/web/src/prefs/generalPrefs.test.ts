import { describe, expect, it } from "vitest";
import { DEFAULT_TIME_FORMAT, TIME_FORMAT_MAX, TIME_PLACEHOLDER } from "../format";
import { pinTimeZone } from "../pinTimeZone";
import type { PrefsAnswer } from "../types";
import {
  CLEAN_AGE_ITEMS,
  cleanAgeIndex,
  GENERAL_TABS,
  LOG_CLEAN_AGE_TIP,
  LOG_LEVEL_ITEMS,
  LOG_LEVEL_TIP,
  LOG_RESET_TIP,
  logInfoText,
  MESSAGE_LOG_KEYS,
  NUMBER_FORMAT_CONTROLS,
  NUMBER_FORMAT_KEYS,
  PREVIEW_START,
  PREVIEW_TICK_MS,
  previewText,
  TIME_FORMAT_RESET_KEYS,
} from "./generalPrefs";
import { prefPlace } from "./prefPlaces";
import { draftValue, resetInDraft, setInDraft } from "./prefsDraft";
import type { Draft } from "./prefsDraft";

describe("GENERAL_TABS (ref-D §1)", () => {
  it("are in Gpredict's order", () => {
    expect([...GENERAL_TABS]).toEqual(["Number Formats", "Ground Stations", "TLE Update", "Message Logs"]);
  });

  it("name the tab that an error of the window gives for the keys of these two pages", () => {
    for (const key of NUMBER_FORMAT_KEYS) expect(prefPlace(key), key).toEqual({ group: "general", tab: GENERAL_TABS[0] });
    for (const key of MESSAGE_LOG_KEYS) expect(prefPlace(key), key).toEqual({ group: "general", tab: GENERAL_TABS[3] });
  });
});

describe("Number Formats (ref-D §2)", () => {
  it("number format labels and tooltips", () => {
    const c = NUMBER_FORMAT_CONTROLS;
    expect(c.local).toEqual({
      key: "GLOBAL/USE_LOCAL_TIME",
      label: "Show local time instead of UTC.",
      tooltip:
        "Display local time instead of UTC. Note: The local time is that of your operating system and not the local time at the " +
        "location, which you select as tracking reference.",
    });
    expect(c.timeFormat).toEqual({
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
      maxLength: 50,
      resetLabel: "Reset",
      resetTooltip: "Reset to default value",
    });
    expect(c.nsew).toEqual({
      key: "GLOBAL/USE_NSEW",
      label: "Use N/S/E/W for geographical coordinates.",
      tooltip:
        "Checking this box will cause geographical coordinates to be displayed using a suffix instead of sign (eg. 23.43°W instead of -23.43°).",
    });
    expect(c.imperial).toEqual({
      key: "GLOBAL/USE_IMPERIAL",
      label: "Use Imperial units instead of Metric.",
      tooltip: "Display distances using Imperial units, for example miles instead of kilometres.",
    });
  });

  it("the time format entry takes as many characters as the server accepts", () => {
    expect(NUMBER_FORMAT_CONTROLS.timeFormat.maxLength).toBe(TIME_FORMAT_MAX);
    expect(NUMBER_FORMAT_KEYS).toEqual(["GLOBAL/USE_LOCAL_TIME", "GLOBAL/TIME_FORMAT", "GLOBAL/USE_NSEW", "GLOBAL/USE_IMPERIAL"]);
  });

  describe("the preview", () => {
    pinTimeZone("Asia/Bangkok");
    const d = new Date("2026-11-12T05:06:07Z"); // 12:06:07 in Bangkok

    it("preview uses the typed format and box", () => {
      expect(previewText("%H", true, d)).toBe("12");
      expect(previewText("%H", false, d)).toBe("05");
      expect(previewText("at %M:%S", false, d)).toBe("at 06:07");
      expect(previewText(DEFAULT_TIME_FORMAT, true, d)).toBe("2026/11/12 12:06:07");
      // a code that is not one stays as typed, a format with no code is shown as it is, and an empty one is empty
      expect(previewText("%Q", false, d)).toBe("%Q");
      expect(previewText("Z", false, d)).toBe("Z");
      expect(previewText("", false, d)).toBe("");
    });

    it("starts as Gpredict's placeholder, updates every second, and shows it for a time that is not one", () => {
      expect(PREVIEW_START).toBe(TIME_PLACEHOLDER);
      expect(PREVIEW_START).toBe("--/--/-- --:--:--");
      expect(PREVIEW_TICK_MS).toBe(1000);
      expect(previewText(DEFAULT_TIME_FORMAT, false, new Date(Number.NaN))).toBe(TIME_PLACEHOLDER);
    });
  });

  it("time format reset sets the default only", () => {
    const answer: PrefsAnswer = {
      values: {
        "GLOBAL/USE_LOCAL_TIME": true,
        "GLOBAL/TIME_FORMAT": "%H",
        "GLOBAL/USE_NSEW": true,
        "GLOBAL/USE_IMPERIAL": true,
      },
      defaults: {
        "GLOBAL/USE_LOCAL_TIME": false,
        "GLOBAL/TIME_FORMAT": DEFAULT_TIME_FORMAT,
        "GLOBAL/USE_NSEW": false,
        "GLOBAL/USE_IMPERIAL": false,
      },
      user: NUMBER_FORMAT_KEYS.slice(),
    };
    // the user has just ticked the three boxes the other way and typed a format; then presses Reset beside the format
    let draft: Draft = new Map();
    draft = setInDraft(draft, "GLOBAL/USE_LOCAL_TIME", false);
    draft = setInDraft(draft, "GLOBAL/TIME_FORMAT", "%M");
    draft = setInDraft(draft, "GLOBAL/USE_NSEW", false);
    draft = resetInDraft(draft, TIME_FORMAT_RESET_KEYS);

    expect(TIME_FORMAT_RESET_KEYS).toEqual(["GLOBAL/TIME_FORMAT"]);
    expect(draftValue(answer, draft, "GLOBAL/TIME_FORMAT")).toBe(DEFAULT_TIME_FORMAT);
    expect(draftValue(answer, draft, "GLOBAL/USE_LOCAL_TIME")).toBe(false); // as the user left it
    expect(draftValue(answer, draft, "GLOBAL/USE_NSEW")).toBe(false);
    expect(draftValue(answer, draft, "GLOBAL/USE_IMPERIAL")).toBe(true); // untouched
  });
});

describe("Message Logs (ref-D §7.1)", () => {
  it("the debug level combo has Gpredict's five items, in the order of the level", () => {
    expect([...LOG_LEVEL_ITEMS]).toEqual(["Level 0: None", "Level 1: Error", "Level 2: Warning", "Level 3: Info", "Level 4: Debug"]);
    expect(LOG_LEVEL_TIP).toBe("Select the debug level. The higher the level, the more messages will be logged.");
  });

  it("one month is 30 days", () => {
    expect(CLEAN_AGE_ITEMS.map(([label]) => label)).toEqual(["Always delete", "1 day", "1 week", "1 month"]);
    expect(CLEAN_AGE_ITEMS.map(([, seconds]) => seconds)).toEqual([0, 86400, 604800, 2592000]);
    expect(CLEAN_AGE_ITEMS[3]![1]).toBe(30 * 24 * 3600);
    // Gpredict's own "1 month" is 18144000 s (210 days), which this program never stores: it shows as "Always delete"
    expect(cleanAgeIndex(18144000)).toBe(0);
    expect(LOG_CLEAN_AGE_TIP).toBe("Select how often gpredict should delete old log files.");
  });

  it("the age combo shows the item of the stored age, and Always delete for any other value", () => {
    expect([0, 86400, 604800, 2592000].map(cleanAgeIndex)).toEqual([0, 1, 2, 3]);
    for (const other of [-1, 1, 3600, 86401, 31536000]) expect(cleanAgeIndex(other), String(other)).toBe(0);
  });

  it("message logs info text", () => {
    const text = logInfoText("/x/logs");
    expect(text).toBe(
      "Gpredict stores all run-time messages in the /x/logs/\n" +
        "directory. The current log file is called gpredict.log and the file is\n" +
        "always kept until the next execution, so that you can examine it in case\n" +
        "of a failure. If old log files are kept, they are called gpredict-XYZ.log\n" +
        "where XYZ is a unique timestamp.",
    );
    expect(text).toContain("/x/logs/");
    expect(text).not.toContain("<conf dir>");
    // a path that ends in a separator already is not given a second one
    expect(logInfoText("/x/logs/")).toBe(text);
  });

  it("the keys are the two the page writes, and its Reset has Gpredict's tooltip", () => {
    expect([...MESSAGE_LOG_KEYS]).toEqual(["LOG/LEVEL", "LOG/CLEAN_AGE"]);
    expect(LOG_RESET_TIP).toBe("Reset settings to the default values.");
  });
});
