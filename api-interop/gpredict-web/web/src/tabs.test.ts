import { describe, expect, it } from "vitest";
import { activeTab, initialTab, pageIndex, reorderTabs, tabOrderWithWindows, tabsOf, windowTitle } from "./tabs";

describe("reorderTabs", () => {
  const tabs = ["A", "B", "C", "D"];

  it("drops a tab onto another: it takes that tab's place", () => {
    expect(reorderTabs(tabs, "A", "C")).toEqual(["B", "C", "A", "D"]); // dragged right
    expect(reorderTabs(tabs, "D", "B")).toEqual(["A", "D", "B", "C"]); // dragged left
    expect(reorderTabs(tabs, "B", "A")).toEqual(["B", "A", "C", "D"]);
  });

  it("returns the same order for a drop on itself or on an unknown tab", () => {
    expect(reorderTabs(tabs, "B", "B")).toEqual(tabs);
    expect(reorderTabs(tabs, "B", "Z")).toEqual(tabs);
    expect(reorderTabs(tabs, "Z", "B")).toEqual(tabs);
  });

  it("does not modify its input", () => {
    const copy = [...tabs];
    reorderTabs(tabs, "A", "D");
    expect(tabs).toEqual(copy);
  });
});

describe("windowTitle", () => {
  it("is 'Gpredict Web' or 'Gpredict Web: <tab label>'", () => {
    expect(windowTitle(null)).toBe("Gpredict Web");
    expect(windowTitle("Amateur")).toBe("Gpredict Web: Amateur");
  });
});

describe("activeTab", () => {
  it("keeps the chosen tab while it is open, else falls back to the first open tab", () => {
    expect(activeTab(["A", "B"], "B")).toBe("B");
    expect(activeTab(["A", "B"], "Z")).toBe("A");
    expect(activeTab(["A", "B"], null)).toBe("A");
    expect(activeTab([], "A")).toBeNull();
  });
});

describe("tabsOf (spec §8.1: a detached module leaves the tab bar)", () => {
  it("tabs leave out detached modules", () => {
    expect(tabsOf(["A", "X", "B", "Y"], ["X", "Y"])).toEqual(["A", "B"]);
    expect(tabsOf(["A", "B"], [])).toEqual(["A", "B"]);
    expect(tabsOf(["X"], ["X"])).toEqual([]);
  });

  it("keeps the order of the session, and ignores a window that is not open", () => {
    expect(tabsOf(["B", "A", "C"], ["Z", "A"])).toEqual(["B", "C"]);
  });
});

describe("initialTab (GLOBAL/CURRENT_PAGE, spec §8.4)", () => {
  it("initial tab from CURRENT_PAGE", () => {
    expect(initialTab(["A", "B"], 1)).toBe("B");
    expect(initialTab(["A", "B"], 0)).toBe("A");
  });

  it("is the first tab for -1 (Gpredict's default) or a page past the last tab", () => {
    expect(initialTab(["A", "B"], -1)).toBe("A");
    expect(initialTab(["A", "B"], 2)).toBe("A");
    expect(initialTab(["A", "B"], 999)).toBe("A");
  });

  it("is null without tabs", () => {
    expect(initialTab([], 0)).toBeNull();
    expect(initialTab([], -1)).toBeNull();
  });
});

describe("pageIndex (what GLOBAL/CURRENT_PAGE stores: the place of the shown tab among the tabs)", () => {
  it("is the index of the tab among the tabs, -1 without one", () => {
    expect(pageIndex(["A", "B"], "B")).toBe(1);
    expect(pageIndex(["A", "B"], null)).toBe(-1);
    expect(pageIndex(["A", "B"], "X")).toBe(-1);
  });
});

describe("tabOrderWithWindows (a drag among the tabs, while some modules are windows)", () => {
  it("puts the new order of the tabs in the places of the tabs and leaves the windows where they are in the session", () => {
    // session A X B C, X is a window: tabs A B C; dragging B onto A gives B A C
    expect(tabOrderWithWindows(["A", "X", "B", "C"], ["B", "A", "C"])).toEqual(["B", "X", "A", "C"]);
    expect(tabOrderWithWindows(["X", "A", "B"], ["B", "A"])).toEqual(["X", "B", "A"]);
  });

  it("is the order of the tabs when no module is a window", () => {
    expect(tabOrderWithWindows(["A", "B", "C"], ["C", "A", "B"])).toEqual(["C", "A", "B"]);
  });
});
