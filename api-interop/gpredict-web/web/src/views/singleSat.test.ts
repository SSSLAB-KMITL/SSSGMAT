import { describe, expect, it } from "vitest";
import type { SatState } from "../types";
import { mergeNames, shownSatellite, singleChoices } from "./singleSat";

const sat = (norad: number, name: string) => ({ norad, name }) as SatState;

describe("singleChoices", () => {
  it("lists the satellites of the module sorted by name", () => {
    const names = new Map([
      [3, "ISS"],
      [1, "beidou 2"],
      [2, "Beidou 10"],
    ]);
    expect(singleChoices([3, 1, 2], names)).toEqual([
      { norad: 1, name: "beidou 2" },
      { norad: 2, name: "Beidou 10" },
      { norad: 3, name: "ISS" },
    ]);
  });

  it("names a satellite whose name is not known yet by its NORAD number", () => {
    expect(singleChoices([25544, 7], new Map([[25544, "ISS"]]))).toEqual([
      { norad: 7, name: "7" },
      { norad: 25544, name: "ISS" },
    ]);
  });

  it("is empty for a module without satellites", () => {
    expect(singleChoices([], new Map())).toEqual([]);
  });
});

describe("shownSatellite", () => {
  const choices = [
    { norad: 1, name: "A" },
    { norad: 2, name: "B" },
  ];

  it("is the selected satellite if it is in the module", () => {
    expect(shownSatellite(2, choices)).toBe(2);
  });

  it("is the first by name if nothing is selected or the selected one is not in the module", () => {
    expect(shownSatellite(null, choices)).toBe(1);
    expect(shownSatellite(99, choices)).toBe(1);
  });

  it("is null when the module has no satellites", () => {
    expect(shownSatellite(null, [])).toBeNull();
    expect(shownSatellite(5, [])).toBeNull();
  });
});

describe("mergeNames", () => {
  it("adds and renames from the satellites of a tick, keeping the ones the tick lacks", () => {
    const held = new Map([
      [1, "OLD"],
      [2, "KEEP"],
    ]);
    const merged = mergeNames(held, [sat(1, "NEW"), sat(3, "THREE")]);
    expect([...merged]).toEqual([
      [1, "NEW"],
      [2, "KEEP"],
      [3, "THREE"],
    ]);
    expect(held.get(1)).toBe("OLD"); // the held map is not changed
  });

  it("returns the same map when nothing changes, so that nothing is rendered again", () => {
    const held = new Map([[1, "A"]]);
    expect(mergeNames(held, [sat(1, "A")])).toBe(held);
    expect(mergeNames(held, [])).toBe(held);
  });
});
