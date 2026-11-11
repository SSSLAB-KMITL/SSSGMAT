import { describe, expect, it } from "vitest";
import { activeTab, reorderTabs, windowTitle } from "./tabs";

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
