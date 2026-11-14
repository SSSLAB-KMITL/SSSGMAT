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

  it("Edit: Update TLE data from network, Update transponder data and Preferences work; the other names its sub-project", () => {
    expect(outline(barMenu("Edit"))).toEqual([
      "Update TLE data from network",
      "Update TLE data from local files (later 4)",
      "Update transponder data",
      "-",
      "Preferences",
    ]);
  });

  it("Edit menu enables Update transponder data: its action opens the Transponder Update dialog", () => {
    const item = barMenu("Edit").find((e) => e.kind === "item" && e.label === "Update transponder data");
    expect(item).toEqual({ kind: "item", label: "Update transponder data", action: "updateTrsp" });
  });

  it("Edit → Preferences is an item that can be chosen, and its action is preferences", () => {
    const item = barMenu("Edit").find((e) => e.kind === "item" && e.label === "Preferences");
    expect(item).toEqual({ kind: "item", label: "Preferences", action: "preferences" });
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

  it("does not use the place of the key when the layout gives a Latin letter: on AZERTY, Ctrl+A (physical KeyQ) is not Quit", () => {
    expect(shortcutAction(key("a", { ctrlKey: true, code: "KeyQ" }))).toBeNull();
  });

  it("does not use the place of the key on Dvorak either: Ctrl+R (physical KeyO) is not Open module, Ctrl+B (physical KeyN) is not New module", () => {
    expect(shortcutAction(key("r", { ctrlKey: true, code: "KeyO" }))).toBeNull();
    expect(shortcutAction(key("b", { ctrlKey: true, code: "KeyN" }))).toBeNull();
    expect(shortcutAction(key("R", { ctrlKey: true, code: "KeyO" }))).toBeNull();
  });

  it("still finds the key by its letter on those layouts: AZERTY and Dvorak have N, O and Q elsewhere on the keyboard", () => {
    expect(shortcutAction(key("q", { ctrlKey: true, code: "KeyA" }))).toBe("quit");
    expect(shortcutAction(key("n", { ctrlKey: true, code: "KeyB" }))).toBe("newModule");
    expect(shortcutAction(key("o", { ctrlKey: true, code: "KeyR" }))).toBe("openModule");
  });

  it("uses the place of the key when the layout gives something that is not a Latin letter (Thai, Cyrillic, a dead key)", () => {
    expect(shortcutAction(key("щ", { ctrlKey: true, code: "KeyO" }))).toBe("openModule");
    expect(shortcutAction(key("Dead", { ctrlKey: true, code: "KeyN" }))).toBe("newModule");
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
