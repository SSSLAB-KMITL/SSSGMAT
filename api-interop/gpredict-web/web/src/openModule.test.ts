import { describe, expect, it } from "vitest";
import { NO_MODULES_TEXT, ALL_OPEN_TEXT, openableModules, openModuleEmptyText } from "./openModule";

describe("openableModules (File → Open module: 'Select a module', one column 'Module')", () => {
  it("lists the modules that are not open, sorted by name ignoring case", () => {
    expect(openableModules(["weather", "Amateur", "Cubesat", "beidou"], ["Cubesat"])).toEqual(["Amateur", "beidou", "weather"]);
  });

  it("is empty when every module is open", () => {
    expect(openableModules(["a", "b"], ["b", "a"])).toEqual([]);
  });
});

describe("openModuleEmptyText", () => {
  it("is the text of Gpredict when there is no module at all", () => {
    expect(NO_MODULES_TEXT).toBe("You do not have any modules set up yet. Please use File->New in order to create a module.");
    expect(openModuleEmptyText([], [])).toBe(NO_MODULES_TEXT);
  });

  it("is a Thai hint when all the modules are open already", () => {
    expect(openModuleEmptyText(["a"], ["a"])).toBe(ALL_OPEN_TEXT);
  });

  it("is null while there is something to choose", () => {
    expect(openModuleEmptyText(["a", "b"], ["a"])).toBeNull();
  });
});
