import { describe, it, expect } from "vitest";
import {
  groundEcef,
  targetLook,
  inFootprint,
  selectedGround,
  validGroundPoint,
} from "../src/viewingGeometry";

describe("WGS84 satellite-to-selected-coordinate geometry", () => {
  it("matches WGS84 axis points and a known overhead/east looking direction", () => {
    const target = { lon: 0, lat: 0, height_m: 0 };
    expect(groundEcef(target)).toEqual([6378137, 0, 0]);
    expect(groundEcef({ lon: 0, lat: 90, height_m: 0 })[2]).toBeCloseTo(
      6356752.314245,
      5,
    );
    expect(targetLook([6878137, 0, 0], target).range_m).toBeCloseTo(500000, 8);
    expect(targetLook([6878137, 0, 0], target).elevation_deg).toBeCloseTo(
      90,
      8,
    );
    const east = targetLook([6878137, 500000, 0], target);
    expect(east.azimuth_deg).toBeCloseTo(90, 8);
    expect(east.elevation_deg).toBeCloseTo(45, 8);
    expect(targetLook([-6878137, 0, 0], target).elevation_deg).toBeLessThan(0);
  });
  it("matches the independent pyproj-derived SICD reference for Suvarnabhumi", () => {
    const target = {
      lon: 100.75001599887742,
      lat: 13.690679209121773,
      height_m: -30.68180978205055,
    };
    const look = targetLook(
      [-1607723.464166924, 6492075.896834618, 1573517.7605828037],
      target,
    );
    expect(look.range_m).toBeCloseTo(609642.3102256259, 5);
    expect(look.azimuth_deg).toBeCloseTo(96.48922398673163, 7);
    expect(look.elevation_deg).toBeCloseTo(52.52032165687811, 7);
  });
  it("distinguishes image coverage, boundary points and a dateline footprint", () => {
    const ring = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
      [-1, -1],
    ];
    expect(inFootprint({ lon: 0, lat: 0, height_m: 0 }, ring)).toBe(true);
    expect(inFootprint({ lon: 1, lat: 0, height_m: 0 }, ring)).toBe(true);
    expect(inFootprint({ lon: 2, lat: 0, height_m: 0 }, ring)).toBe(false);
    expect(inFootprint({ lon: 180, lat: 0, height_m: 0 }, ring)).toBe(false);
    expect(
      inFootprint({ lon: 179.9, lat: 0, height_m: 0 }, [
        [179, -1],
        [-179, -1],
        [-179, 1],
        [179, 1],
        [179, -1],
      ]),
    ).toBe(true);
  });
  it("does not reuse another acquisition target and validates coordinate input", () => {
    const state = {
      groundTarget: null,
      selected: { id: "new" },
      detail: { id: "old", preview: { roi: { lat: 70, lon: 70 } } },
      site: { lat: 13.69, lon: 100.75 },
    };
    expect(selectedGround(state)).toEqual({
      lat: 13.69,
      lon: 100.75,
      height_m: 0,
    });
    expect(validGroundPoint({ lat: 91, lon: 100, height_m: 0 })).toBe(false);
    expect(validGroundPoint({ lat: 13, lon: NaN, height_m: 0 })).toBe(false);
  });
});
