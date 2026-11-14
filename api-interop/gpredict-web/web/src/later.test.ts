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
  // File → Log browser works since sub-project 4 (Task 20), so it is not here any more
  // Edit → Update TLE data from local files works since sub-project 4 (Task 18), so it is not here any more
  // Edit → Preferences works since sub-project 2 (the window and its Predict group), so it is not here any more
  // Help: "ไม่มี News" - there is no News item at all
  ["Detach module", 4, "Module menu"],
  ["Full screen", 4, "Module menu"],
  // Satellite info (the popups of List, Map and Polar, the bold name of Single sat and Event list, the double click) works since
  // sub-project 4 (Task 19), so it is not here any more
  // Show current pass, Show next pass and Future passes work since sub-project 2 (Task 13), and so does Sky at a glance (Task 14);
  // Radio Control, Antenna Control and Update transponder data work since sub-project 3 (Task 14): they are not here any more
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

  it("has no Preferences: Edit → Preferences opens the window", () => {
    expect(LATER).not.toHaveProperty("Preferences");
  });

  it("has no Sky at a glance: Module menu → Sky at a glance opens its window", () => {
    expect(LATER).not.toHaveProperty("Sky at a glance");
  });

  it("has nothing of sub-project 3: Radio Control, Antenna Control and Update transponder data work", () => {
    for (const label of ["Radio Control", "Antenna Control", "Update transponder data"]) expect(LATER, label).not.toHaveProperty(label);
    expect(Object.values(LATER)).not.toContain(3);
  });

  it("has no Log browser: File → Log browser (Ctrl+L) opens the Log Browser window", () => {
    expect(LATER).not.toHaveProperty("Log browser");
  });

  it("has no Update TLE data from local files: Edit → Update TLE data from local files opens its box", () => {
    expect(LATER).not.toHaveProperty("Update TLE data from local files");
  });

  it("has no Satellite info: its popup items, the bold satellite name and the double click open the Satellite Info window", () => {
    expect(LATER).not.toHaveProperty("Satellite info");
  });

  it("has no pass items: Show current pass, Show next pass and Future passes open the pass windows", () => {
    for (const label of ["Show current pass", "Show next pass", "Future passes"]) expect(LATER, label).not.toHaveProperty(label);
  });
});

describe("laterOf", () => {
  it("gives the sub-project of a label in LATER", () => {
    expect(laterOf("Detach module")).toBe(4);
    expect(laterOf("Full screen")).toBe(4);
  });

  it("throws for a label that is not in LATER, so that a typo cannot make an item look available", () => {
    expect(() => laterOf("Preference")).toThrow();
    expect(() => laterOf("Preferences")).toThrow(); // it works now
    expect(() => laterOf("Show next pass")).toThrow(); // so do the pass items
    expect(() => laterOf("Sky at a glance")).toThrow(); // and Sky at a glance
    expect(() => laterOf("Radio Control")).toThrow(); // and the controllers
    expect(() => laterOf("Update TLE data from local files")).toThrow(); // and the update from local files
    expect(() => laterOf("Satellite info")).toThrow(); // and Satellite info
    expect(() => laterOf("Log browser")).toThrow(); // and the Log browser
  });
});
