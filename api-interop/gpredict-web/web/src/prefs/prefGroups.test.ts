import { describe, expect, it } from "vitest";
import { laterTooltip } from "../later";
import { FIRST_GROUP, firstView, PREF_GROUPS, switchGroup } from "./prefGroups";
import type { PrefGroup } from "./prefGroups";

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

  it("opens at Predict: Gpredict opens at General, which has no page yet", () => {
    expect(FIRST_GROUP).toBe("predict");
    expect(firstView()).toEqual({ active: "predict", visited: ["predict"] });
  });
});

describe("switchGroup", () => {
  // a window in which General has a page too (sub-project 4)
  const page = () => null;
  const groups: readonly PrefGroup[] = PREF_GROUPS.map((g) => (g.id === "general" ? { ...g, page, later: undefined } : g));

  it("shows the group and remembers it was shown, so that its page stays in the window (and its edits with it)", () => {
    const toGeneral = switchGroup(firstView(), "general", groups);
    expect(toGeneral).toEqual({ active: "general", visited: ["predict", "general"] });
    const back = switchGroup(toGeneral, "predict", groups);
    expect(back).toEqual({ active: "predict", visited: ["predict", "general"] });
  });

  it("does not list a group twice", () => {
    let view = firstView();
    for (const id of ["general", "predict", "general", "predict"] as const) view = switchGroup(view, id, groups);
    expect(view.visited).toEqual(["predict", "general"]);
  });

  it("ignores a group without a page: it cannot be pressed", () => {
    const view = firstView();
    expect(switchGroup(view, "modules", groups)).toBe(view);
    expect(switchGroup(view, "general")).toBe(view); // in this sub-project General has no page
  });

  it("shows Interfaces, and keeps its page in the window when another group is chosen", () => {
    const toInterfaces = switchGroup(firstView(), "interfaces");
    expect(toInterfaces).toEqual({ active: "interfaces", visited: ["predict", "interfaces"] });
    expect(switchGroup(toInterfaces, "predict")).toEqual({ active: "predict", visited: ["predict", "interfaces"] });
  });

  it("ignores the group that is shown already", () => {
    const view = firstView();
    expect(switchGroup(view, "predict")).toBe(view);
  });
});
