import { describe, expect, it } from "vitest";
import { COMMIT_ORDER, FIRST_GROUP, firstView, groupLabel, PREF_GROUPS, switchGroup } from "./prefGroups";
import type { GroupView } from "./prefGroups";

describe("PREF_GROUPS (ref-D §1)", () => {
  it("are General, Modules, Interfaces and Predict, in that order", () => {
    expect(PREF_GROUPS.map((g) => [g.id, g.label])).toEqual([
      ["general", "General"],
      ["modules", "Modules"],
      ["interfaces", "Interfaces"],
      ["predict", "Predict"],
    ]);
  });

  it("every group has a page (spec §10: General, Modules, Interfaces and Predict can be used) and an icon", () => {
    for (const g of PREF_GROUPS) {
      expect(typeof g.page, g.id).toBe("function");
      expect(g.icon, g.id).not.toBe("");
    }
  });

  it("OK runs the groups in Gpredict's order, whichever page was visited first", () => {
    expect(COMMIT_ORDER).toEqual(["general", "modules", "interfaces", "predict"]);
  });

  it("names a group by its label (the failure text of the window)", () => {
    expect(groupLabel("general")).toBe("General");
    expect(groupLabel("interfaces")).toBe("Interfaces");
  });
});

describe("firstView", () => {
  it("opens at General (spec §10)", () => {
    expect(FIRST_GROUP).toBe("general");
    expect(firstView()).toEqual({ active: "general", visited: ["general"] });
  });
});

describe("switchGroup", () => {
  // the window shown at Predict
  const atPredict = (): GroupView => ({ active: "predict", visited: ["predict"] });

  it("shows the group and remembers it was shown, so that its page stays in the window (and its edits with it)", () => {
    const toGeneral = switchGroup(atPredict(), "general");
    expect(toGeneral).toEqual({ active: "general", visited: ["predict", "general"] });
    const back = switchGroup(toGeneral, "predict");
    expect(back).toEqual({ active: "predict", visited: ["predict", "general"] });
  });

  it("does not list a group twice", () => {
    let view = atPredict();
    for (const id of ["general", "predict", "general", "predict"] as const) view = switchGroup(view, id);
    expect(view.visited).toEqual(["predict", "general"]);
  });

  it("shows Modules, which has its page since sub-project 4", () => {
    expect(switchGroup(atPredict(), "modules")).toEqual({ active: "modules", visited: ["predict", "modules"] });
  });

  it("shows Interfaces, and keeps its page in the window when another group is chosen", () => {
    const toInterfaces = switchGroup(atPredict(), "interfaces");
    expect(toInterfaces).toEqual({ active: "interfaces", visited: ["predict", "interfaces"] });
    expect(switchGroup(toInterfaces, "predict")).toEqual({ active: "predict", visited: ["predict", "interfaces"] });
  });

  it("ignores the group that is shown already", () => {
    const view = atPredict();
    expect(switchGroup(view, "predict")).toBe(view);
  });
});
