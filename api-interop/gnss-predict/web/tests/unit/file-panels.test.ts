import { describe, expect, test } from "vitest";
import { t } from "../../src/labels/labels";
import { getPanelDef, type PanelKind } from "../../src/layout/panels";
import { About } from "../../src/windows/About/About";
import { registerFilePanels } from "../../src/windows/filePanels";
import { NewScenarioWizard } from "../../src/windows/NewScenarioWizard/NewScenarioWizard";
import { StkReference } from "../../src/windows/StkReference/StkReference";
import { Welcome } from "../../src/windows/Welcome/Welcome";

const REAL = {
  welcome: Welcome, newScenarioWizard: NewScenarioWizard, about: About, stkReference: StkReference,
} as const;
const TITLES = {
  welcome: "window.welcome", newScenarioWizard: "window.newScenarioWizard", about: "help.about", stkReference: "help.stkReference",
} as const;

describe("registerFilePanels", () => {
  test.each(Object.keys(REAL) as (keyof typeof REAL)[])("%s is the real window, still a single floating window with its STK title", (kind) => {
    registerFilePanels();
    const def = getPanelDef(kind)!;
    expect(def.component).toBe(REAL[kind]);
    expect(def.type).toBe("floating");
    expect(def.singleton).toBe(true);
    expect(def.title({})).toBe(t(TITLES[kind]));
  });

  test("only those four are replaced; the other windows keep their registration", () => {
    const others = ["objectBrowser", "graphics3d", "insertObjects", "propertiesBrowser", "fetchOrbitData"] as PanelKind[];
    const before = others.map((k) => getPanelDef(k));
    registerFilePanels();
    expect(others.map((k) => getPanelDef(k))).toEqual(before);
  });

  test("each is large enough for what it shows: the Welcome table with its time columns, the About list in three columns", () => {
    registerFilePanels();
    expect(getPanelDef("welcome")!.size!.width).toBeGreaterThanOrEqual(700);
    expect(getPanelDef("about")!.size!.width).toBeGreaterThanOrEqual(620);
    expect(getPanelDef("newScenarioWizard")!.size).toBeDefined();
    expect(getPanelDef("stkReference")!.size).toBeDefined();
  });

  test("registering twice (StrictMode) gives the same result", () => {
    registerFilePanels();
    const first = { ...getPanelDef("welcome")! };
    registerFilePanels();
    expect(getPanelDef("welcome")).toEqual(first);
  });
});
