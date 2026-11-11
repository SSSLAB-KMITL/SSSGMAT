import { describe, expect, it } from "vitest";
import type { SatState } from "../types";
import {
  azElToXY,
  cardinalLabels,
  type Orientation,
  POLAR_ORIENTATIONS,
  polarRadius,
  tickLabelPos,
  trackTicks,
  visibleSats,
  xyToAzEl,
} from "./polarGeom";

const CX = 200;
const CY = 150;
const R = 100;

describe("polarRadius", () => {
  it("is min(w, h)/2 - 25 (ref §6)", () => {
    expect(polarRadius(800, 600)).toBe(275);
    expect(polarRadius(600, 800)).toBe(275);
    expect(polarRadius(400, 400)).toBe(175);
    expect(polarRadius(101, 300)).toBe(25.5);
  });
});

describe("azElToXY", () => {
  it("puts El 90 in the centre whatever the azimuth and the orientation", () => {
    for (const o of POLAR_ORIENTATIONS) {
      for (const az of [0, 45, 90, 180, 270, 359]) {
        const [x, y] = azElToXY(az, 90, CX, CY, R, o);
        expect(x).toBeCloseTo(CX, 9);
        expect(y).toBeCloseTo(CY, 9);
      }
    }
  });

  it("puts the distance from the centre at r * (90 - el) / 90", () => {
    for (const o of POLAR_ORIENTATIONS) {
      for (const [el, dist] of [[0, R], [30, (R * 2) / 3], [60, R / 3], [45, R / 2]] as const) {
        const [x, y] = azElToXY(123, el, CX, CY, R, o);
        expect(Math.hypot(x - CX, y - CY)).toBeCloseTo(dist, 9);
      }
    }
  });

  it("Az 0 El 0 is at the top in N/E/S/W and N/W/S/E, at the bottom in S/E/N/W and S/W/N/E", () => {
    for (const o of ["N/E/S/W", "N/W/S/E"] as const) {
      const [x, y] = azElToXY(0, 0, CX, CY, R, o);
      expect(x).toBeCloseTo(CX, 9);
      expect(y).toBeCloseTo(CY - R, 9);
    }
    for (const o of ["S/E/N/W", "S/W/N/E"] as const) {
      const [x, y] = azElToXY(0, 0, CX, CY, R, o);
      expect(x).toBeCloseTo(CX, 9);
      expect(y).toBeCloseTo(CY + R, 9);
    }
  });

  it("Az 90 El 0 is on the right in N/E/S/W and S/E/N/W, on the left in N/W/S/E and S/W/N/E", () => {
    for (const o of ["N/E/S/W", "S/E/N/W"] as const) {
      const [x, y] = azElToXY(90, 0, CX, CY, R, o);
      expect(x).toBeCloseTo(CX + R, 9);
      expect(y).toBeCloseTo(CY, 9);
    }
    for (const o of ["N/W/S/E", "S/W/N/E"] as const) {
      const [x, y] = azElToXY(90, 0, CX, CY, R, o);
      expect(x).toBeCloseTo(CX - R, 9);
      expect(y).toBeCloseTo(CY, 9);
    }
  });

  it("puts N, E, S, W of N/E/S/W at the top, right, bottom and left", () => {
    const at = (az: number) => azElToXY(az, 0, CX, CY, R, "N/E/S/W").map((v) => Math.round(v));
    expect(at(0)).toEqual([CX, CY - R]);
    expect(at(90)).toEqual([CX + R, CY]);
    expect(at(180)).toEqual([CX, CY + R]);
    expect(at(270)).toEqual([CX - R, CY]);
  });

  it("turns the same way as the letters of the orientation name read: N/W/S/E is the mirror image of N/E/S/W", () => {
    // Az 45 is up-right in N/E/S/W and up-left in N/W/S/E
    const ne = azElToXY(45, 0, CX, CY, R, "N/E/S/W");
    const nw = azElToXY(45, 0, CX, CY, R, "N/W/S/E");
    expect(ne[0]).toBeGreaterThan(CX);
    expect(nw[0]).toBeLessThan(CX);
    expect(ne[1]).toBeCloseTo(nw[1], 9);
    // S/E/N/W is N/E/S/W turned upside down (Az 45: down-right)
    const se = azElToXY(45, 0, CX, CY, R, "S/E/N/W");
    expect(se[0]).toBeGreaterThan(CX);
    expect(se[1]).toBeGreaterThan(CY);
    // S/W/N/E is the half turn of N/E/S/W (Az 45: down-left)
    const sw = azElToXY(45, 0, CX, CY, R, "S/W/N/E");
    expect(sw[0]).toBeLessThan(CX);
    expect(sw[1]).toBeGreaterThan(CY);
  });

  it("treats a name that is not an orientation as N/E/S/W", () => {
    expect(azElToXY(90, 0, CX, CY, R, "nonsense" as Orientation)[0]).toBeCloseTo(CX + R, 9);
  });
});

describe("xyToAzEl", () => {
  it("is the inverse of azElToXY in every orientation", () => {
    for (const o of POLAR_ORIENTATIONS) {
      for (const az of [0, 10, 90, 135, 180, 225, 270, 350]) {
        for (const el of [1, 20, 45, 70, 89]) {
          const [x, y] = azElToXY(az, el, CX, CY, R, o);
          const [az2, el2] = xyToAzEl(x, y, CX, CY, R, o);
          expect(el2).toBeCloseTo(el, 6);
          expect(az2).toBeCloseTo(az, 6);
        }
      }
    }
  });

  it("gives El 90 in the centre, 0 on the rim and a negative El outside it", () => {
    expect(xyToAzEl(CX, CY, CX, CY, R, "N/E/S/W")[1]).toBeCloseTo(90, 9);
    expect(xyToAzEl(CX + R, CY, CX, CY, R, "N/E/S/W")[1]).toBeCloseTo(0, 9);
    expect(xyToAzEl(CX + 2 * R, CY, CX, CY, R, "N/E/S/W")[1]).toBeCloseTo(-90, 9);
  });

  it("keeps the azimuth in [0, 360) and reads the top as N and the right as E in N/E/S/W", () => {
    expect(xyToAzEl(CX, CY - 50, CX, CY, R, "N/E/S/W")[0]).toBeCloseTo(0, 9);
    expect(xyToAzEl(CX + 50, CY, CX, CY, R, "N/E/S/W")[0]).toBeCloseTo(90, 9);
    expect(xyToAzEl(CX - 50, CY, CX, CY, R, "N/E/S/W")[0]).toBeCloseTo(270, 9);
    for (const o of POLAR_ORIENTATIONS) {
      const az = xyToAzEl(CX, CY - 50, CX, CY, R, o)[0];
      expect(az).toBeGreaterThanOrEqual(0);
      expect(az).toBeLessThan(360);
    }
  });

  it("does not divide by a radius of 0", () => {
    const [, el] = xyToAzEl(10, 10, 0, 0, 0, "N/E/S/W");
    expect(el).toBeLessThan(0);
  });
});

describe("cardinalLabels", () => {
  const round = (v: number) => Math.round(v * 1e6) / 1e6; // sin/cos leave 1e-14 of noise
  const byText = (o: Orientation) =>
    Object.fromEntries(cardinalLabels(CX, CY, R, o).map((l) => [l.text, { ...l, x: round(l.x), y: round(l.y) }]));

  it("places N above the top end of the axis (anchored by its bottom) and E to the right of the right end in N/E/S/W", () => {
    const l = byText("N/E/S/W");
    expect(l.N).toMatchObject({ x: CX, y: CY - R - 5, align: "center", baseline: "bottom" });
    expect(l.E).toMatchObject({ x: CX + R + 5, y: CY, align: "left", baseline: "middle" });
    expect(l.S).toMatchObject({ x: CX, y: CY + R + 5, align: "center", baseline: "top" });
    expect(l.W).toMatchObject({ x: CX - R - 5, y: CY, align: "right", baseline: "middle" });
  });

  it("swaps E and W in N/W/S/E", () => {
    const l = byText("N/W/S/E");
    expect(l.N).toMatchObject({ x: CX, y: CY - R - 5, baseline: "bottom" });
    expect(l.E).toMatchObject({ x: CX - R - 5, y: CY, align: "right" });
    expect(l.W).toMatchObject({ x: CX + R + 5, y: CY, align: "left" });
    expect(l.S).toMatchObject({ x: CX, y: CY + R + 5, baseline: "top" });
  });

  it("swaps N and S in S/E/N/W", () => {
    const l = byText("S/E/N/W");
    expect(l.N).toMatchObject({ x: CX, y: CY + R + 5, baseline: "top" });
    expect(l.S).toMatchObject({ x: CX, y: CY - R - 5, baseline: "bottom" });
    expect(l.E).toMatchObject({ x: CX + R + 5, y: CY, align: "left" });
    expect(l.W).toMatchObject({ x: CX - R - 5, y: CY, align: "right" });
  });

  it("swaps both pairs in S/W/N/E", () => {
    const l = byText("S/W/N/E");
    expect(l.N).toMatchObject({ x: CX, y: CY + R + 5, baseline: "top" });
    expect(l.S).toMatchObject({ x: CX, y: CY - R - 5, baseline: "bottom" });
    expect(l.E).toMatchObject({ x: CX - R - 5, y: CY, align: "right" });
    expect(l.W).toMatchObject({ x: CX + R + 5, y: CY, align: "left" });
  });

  it("always has the four letters N, E, S, W, in that order", () => {
    for (const o of POLAR_ORIENTATIONS) expect(cardinalLabels(CX, CY, R, o).map((l) => l.text)).toEqual(["N", "E", "S", "W"]);
  });
});

describe("trackTicks", () => {
  const points = (n: number) => Array.from({ length: n }, (_, i) => ({ t: `p${i}`, az: i, el: 0 }));

  it("gives 4 points and the first one is the AOS point", () => {
    const track = points(61); // 10 min at one point every 10 s
    const ticks = trackTicks(track);
    expect(ticks).toHaveLength(4);
    expect(ticks[0]).toBe(track[0]);
  });

  it("spaces the others evenly by index, as Gpredict does: step (n - 2) / 3, rounded down", () => {
    expect(trackTicks(points(61)).map((p) => p.t)).toEqual(["p0", "p19", "p38", "p57"]);
    expect(trackTicks(points(11)).map((p) => p.t)).toEqual(["p0", "p3", "p6", "p9"]);
    expect(trackTicks(points(5)).map((p) => p.t)).toEqual(["p0", "p1", "p2", "p3"]);
  });

  it("never puts a tick at the last point (LOS) and stays in the track", () => {
    for (let n = 5; n < 200; n++) {
      const ticks = trackTicks(points(n));
      expect(ticks).toHaveLength(4);
      expect(Number(ticks[3]!.t.slice(1))).toBeLessThanOrEqual(n - 2);
    }
  });

  it("gives fewer ticks for a track that is too short for four, and none for no track", () => {
    expect(trackTicks(points(4)).map((p) => p.t)).toEqual(["p0"]);
    expect(trackTicks(points(3)).map((p) => p.t)).toEqual(["p0"]);
    expect(trackTicks(points(2)).map((p) => p.t)).toEqual(["p0"]);
    expect(trackTicks(points(1)).map((p) => p.t)).toEqual(["p0"]);
    expect(trackTicks([])).toEqual([]);
  });
});

describe("tickLabelPos", () => {
  it("puts the label of a tick right of the centre to its left, and vice versa, centred on the point's y", () => {
    // first tick (AOS): 5 px from the point
    expect(tickLabelPos(300, 100, 200, 30, 16, true)).toEqual({ x: 265, y: 92 });
    expect(tickLabelPos(100, 100, 200, 30, 16, true)).toEqual({ x: 105, y: 92 });
  });

  it("moves the later ticks 5 px further along (Gpredict shifts the point, then the label)", () => {
    expect(tickLabelPos(300, 100, 200, 30, 16, false)).toEqual({ x: 260, y: 92 });
    expect(tickLabelPos(100, 100, 200, 30, 16, false)).toEqual({ x: 110, y: 92 });
  });
});

describe("visibleSats", () => {
  const sat = (over: Partial<SatState>): SatState => ({ norad: 1, name: "S", az: 10, el: 5, dir: "↑", ...over }) as SatState;

  it("keeps the satellites with El >= 0 that are not decayed and have a position", () => {
    const sats = [
      sat({ norad: 1, el: 5 }),
      sat({ norad: 2, el: 0 }),
      sat({ norad: 3, el: -0.01 }),
      sat({ norad: 4, el: 30, dir: "D" }),
      sat({ norad: 5, el: null }),
      sat({ norad: 6, az: null }),
      sat({ norad: 7, el: 20, dir: "G" }),
    ];
    expect(visibleSats(sats).map((s) => s.norad)).toEqual([1, 2, 7]);
  });
});
