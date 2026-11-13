import { describe, expect, it } from "vitest";
import { LATER, laterOf, laterTooltip } from "./later";

describe("laterTooltip", () => {
  it("names the sub-project that has the feature", () => {
    expect(laterTooltip(2)).toBe("อยู่ในงานย่อยที่ 2: Pass predictions");
    expect(laterTooltip(3)).toBe("อยู่ในงานย่อยที่ 3: Radio & Rotator");
    expect(laterTooltip(4)).toBe("อยู่ในงานย่อยที่ 4: Data & Preferences");
  });
});

/** The column "กดไม่ได้" of the table in spec §8.2, row by row (the sub-project number is the one in brackets there). */
const SPEC_8_2: [label: string, subProject: 2 | 3 | 4, where: string][] = [
  ["Log browser", 4, "File"],
  ["Update TLE data from local files", 4, "Edit"],
  ["Update transponder data", 3, "Edit"],
  // Edit → Preferences works since sub-project 2 (the window and its Predict group), so it is not here any more
  // Help: "ไม่มี News" - there is no News item at all
  ["Detach module", 4, "Module menu"],
  ["Full screen", 4, "Module menu"],
  ["Sky at a glance", 2, "Module menu"],
  ["Radio Control", 3, "Module menu"],
  ["Antenna Control", 3, "Module menu"],
  ["Satellite info", 4, "popups of List, Map, Polar; the bold name of Single sat and Event list; the double click"],
  ["Show current pass", 2, "satellite popups"],
  ["Show next pass", 2, "satellite popups"],
  ["Future passes", 2, "satellite popups"],
];

describe("LATER (spec §8.2)", () => {
  it.each(SPEC_8_2)("has %s in sub-project %i (%s)", (label, subProject) => {
    expect(LATER[label]).toBe(subProject);
  });

  it("has every 'กดไม่ได้' item of spec §8.2 and nothing else", () => {
    expect(Object.keys(LATER).sort()).toEqual(SPEC_8_2.map(([label]) => label).sort());
  });

  it("has no News (Help has none: ref §1 lists it, spec §8.2 leaves it out)", () => {
    expect(LATER).not.toHaveProperty("News");
  });

  it("has no Preferences: Edit → Preferences opens the window (the pass items and Sky at a glance follow in their own tasks)", () => {
    expect(LATER).not.toHaveProperty("Preferences");
    for (const label of ["Sky at a glance", "Show current pass", "Show next pass", "Future passes"]) expect(LATER, label).toHaveProperty(label);
  });
});

describe("laterOf", () => {
  it("gives the sub-project of a label in LATER", () => {
    expect(laterOf("Sky at a glance")).toBe(2);
    expect(laterOf("Radio Control")).toBe(3);
    expect(laterOf("Update TLE data from local files")).toBe(4);
  });

  it("throws for a label that is not in LATER, so that a typo cannot make an item look available", () => {
    expect(() => laterOf("Preference")).toThrow();
    expect(() => laterOf("Preferences")).toThrow(); // it works now
  });
});
