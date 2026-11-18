import { describe, expect, it } from "vitest";
import { ApiError } from "../api";
import { META } from "../moduleDefaults.fixture";
import { PROPS_TABS } from "../moduleProps";
import { pageFailure, prefPlace, prefsFailure, prefsSavedParts, savedNote, TabError } from "./prefPlaces";
import { PAGE_KEYS, PREDICT_TABS } from "./predictPrefs";

const labelOf = (g: string) => g.toUpperCase();

describe("prefPlace: the group and tab of a key of Preferences (ref-D §1)", () => {
  it("General: Number Formats, TLE Update, Message Logs", () => {
    expect(prefPlace("GLOBAL/USE_LOCAL_TIME")).toEqual({ group: "general", tab: "Number Formats" });
    expect(prefPlace("GLOBAL/TIME_FORMAT")).toEqual({ group: "general", tab: "Number Formats" });
    expect(prefPlace("GLOBAL/USE_NSEW")).toEqual({ group: "general", tab: "Number Formats" });
    expect(prefPlace("GLOBAL/USE_IMPERIAL")).toEqual({ group: "general", tab: "Number Formats" });
    expect(prefPlace("TLE/PROXY")).toEqual({ group: "general", tab: "TLE Update" });
    expect(prefPlace("TLE/URLS")).toEqual({ group: "general", tab: "TLE Update" });
    expect(prefPlace("LOG/LEVEL")).toEqual({ group: "general", tab: "Message Logs" });
    expect(prefPlace("LOG/CLEAN_AGE")).toEqual({ group: "general", tab: "Message Logs" });
  });

  it("Modules: Window Placements are on Layout, every refresh rate on Refresh Rates, even MAP_REFRESH and POLAR_REFRESH", () => {
    for (const key of ["GLOBAL/MAIN_WIN_POS", "GLOBAL/MOD_WIN_POS", "GLOBAL/MOD_STATE", "MODULES/GRID"]) {
      expect(prefPlace(key), key).toEqual({ group: "modules", tab: "Layout" });
    }
    for (const key of [
      "MODULES/DATA_TIMEOUT",
      "MODULES/LIST_REFRESH",
      "MODULES/MAP_REFRESH",
      "MODULES/POLAR_REFRESH",
      "MODULES/SINGLE_SAT_REFRESH",
      "MODULES/EVENT_LIST_REFRESH",
    ]) {
      expect(prefPlace(key), key).toEqual({ group: "modules", tab: "Refresh Rates" });
    }
    expect(prefPlace("MODULES/LIST_COLUMNS")).toEqual({ group: "modules", tab: "List View" });
    expect(prefPlace("MODULES/MAP_FILE")).toEqual({ group: "modules", tab: "Map View" });
    expect(prefPlace("MODULES/MAP_SAT_COLOUR")).toEqual({ group: "modules", tab: "Map View" });
    expect(prefPlace("MODULES/POLAR_CHART_ORIENT")).toEqual({ group: "modules", tab: "Polar View" });
    expect(prefPlace("MODULES/POLAR_BGD_COLOUR")).toEqual({ group: "modules", tab: "Polar View" });
    expect(prefPlace("MODULES/SINGLE_SAT_FIELDS")).toEqual({ group: "modules", tab: "Single Sat View" });
  });

  it("Modules: every key of a page of the server's (meta.module_keys) is on the tab of that page, by the notebook's own label", () => {
    for (const t of PROPS_TABS) {
      for (const key of Object.values(META.module_keys[t.id])) expect(prefPlace(key), key).toEqual({ group: "modules", tab: t.label });
    }
    for (const key of META.global_layout_extra) expect(prefPlace(key), key).toEqual({ group: "modules", tab: "Layout" });
  });

  it("Predict: the tab that has the key, by its page's keys", () => {
    for (const tab of PREDICT_TABS) {
      for (const key of PAGE_KEYS[tab.id]) expect(prefPlace(key), key).toEqual({ group: "predict", tab: tab.label });
    }
  });

  it("a key that no page of Preferences shows has no place", () => {
    expect(prefPlace("GLOBAL/CURRENT_PAGE")).toBeNull();
    expect(prefPlace("TLE/LAST_UPDATE")).toBeNull();
    expect(prefPlace("NO/SUCH_KEY")).toBeNull();
  });
});

describe("the text of a failure: <group> → <tab>: <Thai text of the server>", () => {
  const refused = (text: string, object: string | null) => new ApiError("PREFS_INVALID", text, 422, "error", object);

  it("a refused preference is placed by its key", () => {
    expect(prefsFailure(refused("Minimum elevation ต้องเป็นจำนวนเต็ม 1–90", "PREDICT/MINIMUM_ELEV"), labelOf)).toBe(
      "PREDICT → Pass Conditions: Minimum elevation ต้องเป็นจำนวนเต็ม 1–90",
    );
    expect(prefsFailure(refused("Time format ยาวเกิน 50 ตัวอักษร", "GLOBAL/TIME_FORMAT"), labelOf)).toBe(
      "GENERAL → Number Formats: Time format ยาวเกิน 50 ตัวอักษร",
    );
  });

  it("is only the text when the key has no place, or the failure is not a refusal of a key", () => {
    expect(prefsFailure(refused("ค่าที่จะตั้ง (set) ต้องเป็น object", "set"), labelOf)).toBe("ค่าที่จะตั้ง (set) ต้องเป็น object");
    expect(prefsFailure(refused("ผิด", null), labelOf)).toBe("ผิด");
    expect(prefsFailure(new ApiError("NETWORK_ERROR", "ติดต่อ server ไม่ได้", 0), labelOf)).toBe("ติดต่อ server ไม่ได้");
    expect(prefsFailure(new Error("boom"), labelOf)).toBe("boom");
  });

  it("a page's failure has its group, and its tab when the page knows it", () => {
    const refusal = new ApiError("HWCONF_INVALID", "Port ต้องเป็นจำนวนเต็ม 1024–65535", 422, "error", "Port");
    expect(pageFailure("Interfaces", refusal)).toBe("Interfaces: Port ต้องเป็นจำนวนเต็ม 1024–65535");
    expect(pageFailure("Interfaces", new TabError("Rotators", "Port ต้องเป็นจำนวนเต็ม 1024–65535"))).toBe(
      "Interfaces → Rotators: Port ต้องเป็นจำนวนเต็ม 1024–65535",
    );
    expect(pageFailure("General", new Error("boom"))).toBe("General: boom");
  });
});

describe("what a failure halfway through OK says is saved already (ของเรา)", () => {
  it("the preferences are named by the places of their keys, each once", () => {
    expect(prefsSavedParts(["GLOBAL/USE_LOCAL_TIME", "GLOBAL/TIME_FORMAT", "MODULES/MAP_CENTER", "LOG/LEVEL"], labelOf)).toEqual([
      "GENERAL → Number Formats",
      "MODULES → Map View",
      "GENERAL → Message Logs",
    ]);
  });

  it("a key with no place is left out, and only such keys are the Preferences", () => {
    expect(prefsSavedParts(["PREDICT/MINIMUM_ELEV", "NO/SUCH_KEY"], labelOf)).toEqual(["PREDICT → Pass Conditions"]);
    expect(prefsSavedParts(["NO/SUCH_KEY"], labelOf)).toEqual(["Preferences"]);
  });

  it("the note lists the parts and says that Cancel does not take them back", () => {
    expect(savedNote(["General → Number Formats", "General → Ground Stations"])).toBe(
      "(บันทึกส่วนเหล่านี้ไปแล้ว กด Cancel ก็ไม่ย้อนกลับ: General → Number Formats, General → Ground Stations)",
    );
  });
});
