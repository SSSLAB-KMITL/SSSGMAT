import { describe, expect, it } from "vitest";
import { fallbackName, loadSatNames } from "./satNames";

describe("loadSatNames (Edit module: the names of the satellites the module has)", () => {
  it("looks every satellite up and gives them back in the order asked", async () => {
    const names: Record<number, string> = { 25544: "ISS (ZARYA)", 7530: "AO-7", 40967: "FOX-1A" };
    const r = await loadSatNames([25544, 7530, 40967], async (n) => ({ name: names[n]! }));
    expect(r.sats).toEqual([
      { norad: 25544, name: "ISS (ZARYA)" },
      { norad: 7530, name: "AO-7" },
      { norad: 40967, name: "FOX-1A" },
    ]);
    expect(r.failures).toEqual([]);
  });

  it("has nothing to do for no satellites", async () => {
    expect(await loadSatNames([], async () => ({ name: "x" }))).toEqual({ sats: [], failures: [] });
  });

  it("asks for only a few at a time", async () => {
    let running = 0;
    let most = 0;
    const get = async (n: number) => {
      running++;
      most = Math.max(most, running);
      await new Promise((r) => setTimeout(r, 1));
      running--;
      return { name: `S${n}` };
    };
    const r = await loadSatNames(
      Array.from({ length: 50 }, (_, i) => i + 1),
      get,
      4,
    );
    expect(r.sats).toHaveLength(50);
    expect(most).toBeLessThanOrEqual(4);
    expect(most).toBeGreaterThan(1);
  });

  it("keeps a satellite whose name could not be read, under its catalogue number, and reports why", async () => {
    const boom = new Error("not in the index");
    const r = await loadSatNames([1, 2, 3], async (n) => {
      if (n === 2) throw boom;
      return { name: `S${n}` };
    });
    expect(r.sats).toEqual([
      { norad: 1, name: "S1" },
      { norad: 2, name: fallbackName(2) },
      { norad: 3, name: "S3" },
    ]);
    expect(r.failures).toEqual([{ norad: 2, error: boom }]);
  });
});

describe("fallbackName", () => {
  it("is NORAD and the number", () => {
    expect(fallbackName(25544)).toBe("NORAD 25544");
  });
});
