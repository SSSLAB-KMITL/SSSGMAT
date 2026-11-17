import { describe, expect, it } from "vitest";
import { fromLocator, normalizeLocator, toLocator, tryFromLocator } from "./locator";

// THBK, the ground station the server makes on its first start (spec §7.1)
const THBK = { lat: 13.729779, lon: 100.781151 };

describe("toLocator", () => {
  it("gives the 6-character Maidenhead locator of THBK", () => {
    expect(toLocator(THBK.lat, THBK.lon)).toBe("OK03jr");
  });

  it("writes the field in capitals, the subsquare in small letters (the form of the SSP column)", () => {
    expect(toLocator(-34.6, -58.4)).toBe("GF05tj"); // Buenos Aires
  });

  it("covers the corners of the Earth", () => {
    expect(toLocator(-90, -180)).toBe("AA00aa");
    expect(toLocator(0, 0)).toBe("JJ00aa");
    expect(toLocator(90, 179.99)).toBe("RR99xx");
  });

  it("gives the top row for 90 degrees north and the same meridian for 180 degrees east", () => {
    expect(toLocator(90, 0)).toBe("JR09ax");
    expect(toLocator(0, 180)).toBe(toLocator(0, -180));
  });
});

describe("fromLocator", () => {
  it("gives the centre of the subsquare: within 1/48 degree of latitude and 1/24 of longitude of THBK", () => {
    const p = fromLocator("OK03jr");
    expect(Math.abs(p.lat - THBK.lat)).toBeLessThanOrEqual(1 / 48);
    expect(Math.abs(p.lon - THBK.lon)).toBeLessThanOrEqual(1 / 24);
  });

  it("reads the centre exactly (hamlib locator2longlat)", () => {
    const p = fromLocator("OK03jr");
    expect(p.lat).toBeCloseTo(13.729166667, 8);
    expect(p.lon).toBeCloseTo(100.791666667, 8);
  });

  it("reads 2 or 4 characters as the centre of the field or of the square", () => {
    expect(fromLocator("OK")).toEqual({ lat: 15, lon: 110 });
    const square = fromLocator("OK03");
    expect(square.lat).toBeCloseTo(13.5, 10);
    expect(square.lon).toBeCloseTo(101, 10);
  });

  it("reads an odd length as the last whole pair, like Gpredict", () => {
    expect(fromLocator("OK0")).toEqual(fromLocator("OK"));
    expect(fromLocator("OK03j")).toEqual(fromLocator("OK03"));
  });

  it("ignores the case of the letters", () => {
    expect(fromLocator("ok03JR")).toEqual(fromLocator("OK03jr"));
  });

  it("gives negative degrees in the south and the west", () => {
    const p = fromLocator("GF05tj");
    expect(p.lat).toBeLessThan(0);
    expect(p.lon).toBeLessThan(0);
  });

  it("throws for a locator that is not one", () => {
    for (const bad of ["", "O", "ZZ", "OK0x", "OK03zz", "OK03jrAA", "O!", "12"]) {
      expect(() => fromLocator(bad), bad).toThrow();
    }
  });
});

describe("tryFromLocator", () => {
  it("is null instead of throwing", () => {
    expect(tryFromLocator("OK03jr")).toEqual(fromLocator("OK03jr"));
    expect(tryFromLocator("ZZ")).toBeNull();
    expect(tryFromLocator("")).toBeNull();
  });
});

describe("toLocator and fromLocator", () => {
  it("go round: the point is back inside its own subsquare", () => {
    let seed = 12345;
    const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 0; i < 500; i++) {
      const lat = random() * 180 - 90;
      const lon = random() * 360 - 180;
      const back = fromLocator(toLocator(lat, lon));
      expect(Math.abs(back.lat - lat)).toBeLessThanOrEqual(1 / 48 + 1e-6);
      expect(Math.abs(back.lon - lon)).toBeLessThanOrEqual(1 / 24 + 1e-6);
    }
  });
});

describe("normalizeLocator", () => {
  it("writes the field in capitals and the subsquare in small letters as it is typed", () => {
    expect(normalizeLocator("ok03JR")).toBe("OK03jr");
    expect(normalizeLocator("ok")).toBe("OK");
    expect(normalizeLocator("ok0")).toBe("OK0");
  });

  it("keeps at most 6 characters", () => {
    expect(normalizeLocator("OK03jrAB")).toBe("OK03jr");
  });
});
