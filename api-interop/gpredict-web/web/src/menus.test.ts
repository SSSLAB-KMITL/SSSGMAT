import { describe, expect, it } from "vitest";
import { barMenu, MENU_TITLES, shortcutAction } from "./menus";
import { outline } from "./menuSpec";

describe("menu bar (ref §1, spec §8.2)", () => {
  it("has File, Edit and Help in that order", () => {
    expect(MENU_TITLES).toEqual(["File", "Edit", "Help"]);
  });

  it("File: New module, Open module, Log browser, with the accelerators of Gpredict", () => {
    expect(outline(barMenu("File"))).toEqual(["New module [Ctrl+N]", "Open module [Ctrl+O]", "-", "Log browser [Ctrl+L]"]);
  });

  it("has no Quit item (ของเรา: removed)", () => {
    expect(barMenu("File").some((e) => e.kind === "item" && e.label === "Quit")).toBe(false);
  });

  it("File → Log browser is an item that can be chosen, with Ctrl+L, and its action is logBrowser", () => {
    const item = barMenu("File").find((e) => e.kind === "item" && e.label === "Log browser");
    expect(item).toEqual({ kind: "item", label: "Log browser", accel: "Ctrl+L", action: "logBrowser" });
  });

  it("Edit: Update TLE data from network, Update TLE data from local files, Update transponder data and Preferences all work", () => {
    expect(outline(barMenu("Edit"))).toEqual([
      "Update TLE data from network",
      "Update TLE data from local files",
      "Update transponder data",
      "-",
      "Preferences",
    ]);
  });

  it("Edit menu enables Update transponder data: its action opens the Transponder Update dialog", () => {
    const item = barMenu("Edit").find((e) => e.kind === "item" && e.label === "Update transponder data");
    expect(item).toEqual({ kind: "item", label: "Update transponder data", action: "updateTrsp" });
  });

  it("edit menu enables local files: its action opens the box 'Update TLE from files'", () => {
    const item = barMenu("Edit").find((e) => e.kind === "item" && e.label === "Update TLE data from local files");
    expect(item).toEqual({ kind: "item", label: "Update TLE data from local files", action: "updateTleFiles" });
  });

  it("Edit → Preferences is an item that can be chosen, and its action is preferences", () => {
    const item = barMenu("Edit").find((e) => e.kind === "item" && e.label === "Preferences");
    expect(item).toEqual({ kind: "item", label: "Preferences", action: "preferences" });
  });

  it("Help: Online help (F1), License and About Gpredict Web; no News", () => {
    expect(outline(barMenu("Help"))).toEqual(["Online help [F1]", "-", "License", "-", "About Gpredict Web"]);
  });

  it("gives every item an action", () => {
    for (const title of MENU_TITLES) {
      for (const item of barMenu(title)) {
        if (item.kind === "item") expect(item.action, item.label).toBeDefined();
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

  it("Ctrl+N is New module, Ctrl+O Open module, Ctrl+L Log browser and F1 Online help", () => {
    expect(shortcutAction(key("n", { ctrlKey: true }))).toBe("newModule");
    expect(shortcutAction(key("o", { ctrlKey: true }))).toBe("openModule");
    expect(shortcutAction(key("l", { ctrlKey: true }))).toBe("logBrowser");
    expect(shortcutAction(key("F1"))).toBe("onlineHelp");
  });

  it("Ctrl+Q does nothing (ของเรา: the Quit button was removed)", () => {
    expect(shortcutAction(key("q", { ctrlKey: true }))).toBeNull();
  });

  it("does not care about caps lock", () => {
    expect(shortcutAction(key("N", { ctrlKey: true }))).toBe("newModule");
    expect(shortcutAction(key("L", { ctrlKey: true }))).toBe("logBrowser");
  });

  it("finds the key by its place on the keyboard when the layout gives another letter (a Thai layout)", () => {
    expect(shortcutAction(key("ะ", { ctrlKey: true, code: "KeyN" }))).toBe("newModule");
    expect(shortcutAction(key("ส", { ctrlKey: true, code: "KeyL" }))).toBe("logBrowser");
  });

  it("does not use the place of the key on Dvorak either: Ctrl+R (physical KeyO) is not Open module, Ctrl+B (physical KeyN) is not New module", () => {
    expect(shortcutAction(key("r", { ctrlKey: true, code: "KeyO" }))).toBeNull();
    expect(shortcutAction(key("b", { ctrlKey: true, code: "KeyN" }))).toBeNull();
    expect(shortcutAction(key("R", { ctrlKey: true, code: "KeyO" }))).toBeNull();
    expect(shortcutAction(key("n", { ctrlKey: true, code: "KeyL" }))).toBe("newModule"); // Dvorak: the place of L holds N, which is New module
  });

  it("still finds the key by its letter on those layouts: AZERTY and Dvorak have N, O and L elsewhere on the keyboard", () => {
    expect(shortcutAction(key("n", { ctrlKey: true, code: "KeyB" }))).toBe("newModule");
    expect(shortcutAction(key("o", { ctrlKey: true, code: "KeyR" }))).toBe("openModule");
    expect(shortcutAction(key("l", { ctrlKey: true, code: "KeyP" }))).toBe("logBrowser"); // Dvorak
  });

  it("uses the place of the key when the layout gives something that is not a Latin letter (Thai, Cyrillic, a dead key)", () => {
    expect(shortcutAction(key("щ", { ctrlKey: true, code: "KeyO" }))).toBe("openModule");
    expect(shortcutAction(key("Dead", { ctrlKey: true, code: "KeyN" }))).toBe("newModule");
    expect(shortcutAction(key("д", { ctrlKey: true, code: "KeyL" }))).toBe("logBrowser");
  });

  it("is not triggered without Ctrl, or with Shift, Alt or Meta as well", () => {
    expect(shortcutAction(key("n"))).toBeNull();
    expect(shortcutAction(key("n", { ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(shortcutAction(key("n", { ctrlKey: true, altKey: true }))).toBeNull();
    expect(shortcutAction(key("n", { ctrlKey: true, metaKey: true }))).toBeNull();
    expect(shortcutAction(key("F1", { ctrlKey: true }))).toBeNull();
  });

  it("takes Ctrl+L, with no other modifier, from the browser (its address bar): it is Log browser", () => {
    expect(shortcutAction(key("l", { ctrlKey: true }))).toBe("logBrowser");
    expect(shortcutAction(key("l", { ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(shortcutAction(key("l", { ctrlKey: true, altKey: true }))).toBeNull();
    expect(shortcutAction(key("l"))).toBeNull();
  });
});
