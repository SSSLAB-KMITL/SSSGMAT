import { describe, expect, it } from "vitest";
import { barMenu, MENU_TITLES, shortcutAction } from "./menus";
import { outline } from "./menuSpec";

describe("menu bar (ref §1, spec §8.2)", () => {
  it("has File, Edit and Help in that order", () => {
    expect(MENU_TITLES).toEqual(["File", "Edit", "Help"]);
  });

  it("File: New module, Open module, Log browser (later 4), Quit, with the accelerators of Gpredict", () => {
    expect(outline(barMenu("File"))).toEqual([
      "New module [Ctrl+N]",
      "Open module [Ctrl+O]",
      "-",
      "Log browser [Ctrl+L] (later 4)",
      "-",
      "Quit [Ctrl+Q]",
    ]);
  });

  it("Edit: Update TLE data from network is the only one that works; the others name their sub-project", () => {
    expect(outline(barMenu("Edit"))).toEqual([
      "Update TLE data from network",
      "Update TLE data from local files (later 4)",
      "Update transponder data (later 3)",
      "-",
      "Preferences (later 4)",
    ]);
  });

  it("Help: Online help (F1), License and About Gpredict Web; no News", () => {
    expect(outline(barMenu("Help"))).toEqual(["Online help [F1]", "-", "License", "-", "About Gpredict Web"]);
  });

  it("gives every working item an action, and no disabled item has one", () => {
    for (const title of MENU_TITLES) {
      for (const item of barMenu(title)) {
        if (item.kind !== "item") continue;
        expect(item.action === undefined, item.label).toBe(item.later !== undefined);
      }
    }
  });
});

describe("shortcutAction", () => {
  const key = (k: string, extra: Partial<{ ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean; code: string }> = {}) => ({
    key: k,
    code: "",
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ...extra,
  });

  it("Ctrl+N is New module, Ctrl+O Open module, Ctrl+Q Quit and F1 Online help", () => {
    expect(shortcutAction(key("n", { ctrlKey: true }))).toBe("newModule");
    expect(shortcutAction(key("o", { ctrlKey: true }))).toBe("openModule");
    expect(shortcutAction(key("q", { ctrlKey: true }))).toBe("quit");
    expect(shortcutAction(key("F1"))).toBe("onlineHelp");
  });

  it("does not care about caps lock", () => {
    expect(shortcutAction(key("N", { ctrlKey: true }))).toBe("newModule");
  });

  it("finds the key by its place on the keyboard when the layout gives another letter (a Thai layout)", () => {
    expect(shortcutAction(key("ะ", { ctrlKey: true, code: "KeyN" }))).toBe("newModule");
    expect(shortcutAction(key("ๆ", { ctrlKey: true, code: "KeyQ" }))).toBe("quit");
  });

  it("is not triggered without Ctrl, or with Shift, Alt or Meta as well", () => {
    expect(shortcutAction(key("n"))).toBeNull();
    expect(shortcutAction(key("n", { ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(shortcutAction(key("n", { ctrlKey: true, altKey: true }))).toBeNull();
    expect(shortcutAction(key("n", { ctrlKey: true, metaKey: true }))).toBeNull();
    expect(shortcutAction(key("F1", { ctrlKey: true }))).toBeNull();
  });

  it("leaves Ctrl+L alone: Log browser is a later sub-project, so the browser keeps the key", () => {
    expect(shortcutAction(key("l", { ctrlKey: true }))).toBeNull();
  });
});
