import { describe, expect, it } from "vitest";
import { laterTooltip } from "../later";
import { COMMIT_ORDER, FIRST_GROUP, firstView, groupLabel, PREF_GROUPS, switchGroup } from "./prefGroups";
import type { GroupView, PrefGroup } from "./prefGroups";

describe("PREF_GROUPS (ref-D §1)", () => {
  it("are General, Modules, Interfaces and Predict, in that order", () => {
    expect(PREF_GROUPS.map((g) => [g.id, g.label])).toEqual([
      ["general", "General"],
      ["modules", "Modules"],
      ["interfaces", "Interfaces"],
      ["predict", "Predict"],
    ]);
  });

  it("Interfaces and Predict have a page; General and Modules name the sub-project that adds them", () => {
    expect(PREF_GROUPS.map((g) => [g.id, g.page === null, g.later])).toEqual([
      ["general", true, 4],
      ["modules", true, 4],
      ["interfaces", false, undefined],
      ["predict", false, undefined],
    ]);
    expect(laterTooltip(4)).toBe("อยู่ในงานย่อยที่ 4: Data & Preferences");
  });

  it("every group has an icon, and a group without a page can say which sub-project has it", () => {
    for (const g of PREF_GROUPS) {
      expect(g.icon, g.id).not.toBe("");
      if (g.page === null) expect(g.later, g.id).toBeDefined();
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
  // a window in which every group has a page
  const page = () => null;
  const all: readonly PrefGroup[] = PREF_GROUPS.map((g) => ({ ...g, page, later: undefined }));

  it("opens at General (spec §10)", () => {
    expect(FIRST_GROUP).toBe("general");
    expect(firstView(all)).toEqual({ active: "general", visited: ["general"] });
  });

  it("does not open on a group without a page: the first group that has one, until General has its page", () => {
    const noGeneral = all.map((g) => (g.id === "general" ? { ...g, page: null } : g));
    expect(firstView(noGeneral)).toEqual({ active: "modules", visited: ["modules"] });
    const onlyPredict = all.map((g) => (g.id === "predict" ? g : { ...g, page: null }));
    expect(firstView(onlyPredict)).toEqual({ active: "predict", visited: ["predict"] });
  });

  it("in the window as it is, General and Modules have no page, so it opens at Interfaces", () => {
    expect(PREF_GROUPS.find((g) => g.id === FIRST_GROUP)!.page).toBeNull();
    expect(firstView()).toEqual({ active: "interfaces", visited: ["interfaces"] });
  });
});

describe("switchGroup", () => {
  // a window in which General has a page too (sub-project 4), shown at Predict
  const page = () => null;
  const groups: readonly PrefGroup[] = PREF_GROUPS.map((g) => (g.id === "general" ? { ...g, page, later: undefined } : g));
  const atPredict = (): GroupView => ({ active: "predict", visited: ["predict"] });

  it("shows the group and remembers it was shown, so that its page stays in the window (and its edits with it)", () => {
    const toGeneral = switchGroup(atPredict(), "general", groups);
    expect(toGeneral).toEqual({ active: "general", visited: ["predict", "general"] });
    const back = switchGroup(toGeneral, "predict", groups);
    expect(back).toEqual({ active: "predict", visited: ["predict", "general"] });
  });

  it("does not list a group twice", () => {
    let view = atPredict();
    for (const id of ["general", "predict", "general", "predict"] as const) view = switchGroup(view, id, groups);
    expect(view.visited).toEqual(["predict", "general"]);
  });

  it("ignores a group without a page: it cannot be pressed", () => {
    const view = atPredict();
    expect(switchGroup(view, "modules", groups)).toBe(view);
    expect(switchGroup(view, "general")).toBe(view); // in this sub-project General has no page
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
