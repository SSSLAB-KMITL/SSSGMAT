import { describe, expect, it } from "vitest";
import { pinTimeZone } from "../pinTimeZone";
import { azElMouseText, azElScene } from "./passAzEl";
import { AOS_MS, makePass, sample } from "./passPlots.fixture";
import type { PassInfo } from "./types";

// 400 x 300: the frame is x 40..360 and y 40..260 (margins of 40 px, ref-P §6)
const SIZE = { width: 400, height: 300 };
const [LEFT, RIGHT, TOP, BOTTOM] = [40, 360, 40, 260];

/** The same pass with LOS `min` minutes after AOS (the samples stop at the last whole step before it). */
function lasting(p: PassInfo, min: number): PassInfo {
  return { ...p, los: new Date(AOS_MS + min * 60_000).toISOString() };
}

describe("azElScene axes", () => {
  it("az axis 0-180 when the pass stays in one half", () => {
    const scene = azElScene(makePass(30, 150), SIZE);
    expect(scene.maxAz).toBe(180);
    expect(scene.azLabels.map((l) => l.text)).toEqual(["30°", "60°", "90°", "120°", "150°"]);
  });

  it("az axis 0-360 when any sample has an azimuth above 180", () => {
    const scene = azElScene(makePass(170, 190), SIZE);
    expect(scene.maxAz).toBe(360);
    expect(scene.azLabels.map((l) => l.text)).toEqual(["60°", "120°", "180°", "240°", "300°"]);
  });

  it("an azimuth of exactly 180 is still the 0-180 axis, and only the samples count, not the AOS and LOS azimuths", () => {
    const p = makePass(100, 180); // the last sample is at 180; los_az is 180.5
    expect(azElScene(p, SIZE).maxAz).toBe(180);
    p.rows[3] = sample(AOS_MS + 3 * 30_000, 180.001, 10);
    expect(azElScene(p, SIZE).maxAz).toBe(360);
  });

  it("el axis is 0-90 with a label every 15 degrees", () => {
    expect(azElScene(makePass(30, 150), SIZE).elLabels.map((l) => l.text)).toEqual(["15°", "30°", "45°", "60°", "75°"]);
  });

  it("time labels are HH:MM at 1/6 .. 5/6 of AOS to LOS", () => {
    const scene = azElScene(lasting(makePass(30, 150), 12), SIZE);
    expect(scene.xLabels.map((l) => l.text)).toEqual(["10:02", "10:04", "10:06", "10:08", "10:10"]);
    // a pass of 10 min: every 100 s, the seconds are cut off
    expect(azElScene(makePass(30, 150), SIZE).xLabels.map((l) => l.text)).toEqual(["10:01", "10:03", "10:05", "10:06", "10:08"]);
  });
});

describe("azElScene frame, ticks and texts", () => {
  const scene = azElScene(lasting(makePass(30, 150), 12), SIZE);
  const xstep = (RIGHT - LEFT) / 6;
  const ystep = (BOTTOM - TOP) / 6;

  it("az/el ticks and margins", () => {
    expect(scene).toMatchObject({ width: 400, height: 300, background: "rgba(255, 255, 255, 1)" });
    // the frame spans x 40..width-40 and y 40..height-40
    expect(scene.frame).toEqual({ left: LEFT, right: RIGHT, top: TOP, bottom: BOTTOM });
    expect(scene.frameColor).toBe("rgba(0, 0, 0, 1)");
    // 5 ticks on each of the 4 sides, each 5 px long and drawn inward from the frame
    expect(scene.ticks).toHaveLength(20);
    for (let i = 1; i <= 5; i++) {
      expect(scene.ticks).toContainEqual({ x1: LEFT + i * xstep, y1: BOTTOM, x2: LEFT + i * xstep, y2: BOTTOM - 5 }); // bottom
      expect(scene.ticks).toContainEqual({ x1: LEFT + i * xstep, y1: TOP, x2: LEFT + i * xstep, y2: TOP + 5 }); // top
      expect(scene.ticks).toContainEqual({ x1: LEFT, y1: BOTTOM - i * ystep, x2: LEFT + 5, y2: BOTTOM - i * ystep }); // left
      expect(scene.ticks).toContainEqual({ x1: RIGHT, y1: BOTTOM - i * ystep, x2: RIGHT - 5, y2: BOTTOM - i * ystep }); // right
    }
  });

  it("time labels are centred under the frame, 5 px below it, in black", () => {
    scene.xLabels.forEach((l, i) => {
      expect(l).toMatchObject({ x: LEFT + (i + 1) * xstep, y: BOTTOM + 5, align: "center", baseline: "top", color: "rgba(0, 0, 0, 1)" });
    });
  });

  it("az labels are blue and end 5 px left of the frame, el labels are red and start 5 px right of it", () => {
    scene.azLabels.forEach((l, i) => {
      expect(l).toMatchObject({ x: LEFT - 5, y: BOTTOM - (i + 1) * ystep, align: "right", baseline: "middle", color: "rgba(0, 0, 191, 1)" });
    });
    scene.elLabels.forEach((l, i) => {
      expect(l).toMatchObject({ x: RIGHT + 5, y: BOTTOM - (i + 1) * ystep, align: "left", baseline: "middle", color: "rgba(191, 0, 0, 1)" });
    });
  });

  it("legends Az and El at the top of the frame, UTC under it", () => {
    expect(scene.legends).toEqual([
      { text: "Az", x: LEFT - 7, y: TOP, align: "right", baseline: "top", color: "rgba(0, 0, 191, 1)" },
      { text: "El", x: RIGHT + 7, y: TOP, align: "left", baseline: "top", color: "rgba(191, 0, 0, 1)" },
    ]);
    // centred under the frame, ending 5 px above the bottom edge of the widget
    expect(scene.xLegend).toEqual({ text: "UTC", x: (LEFT + RIGHT) / 2, y: 300 - 5, align: "center", baseline: "bottom", color: "rgba(0, 0, 0, 1)" });
  });

  it("the cursor text goes at the top centre, 5 px from the top", () => {
    expect(scene.cursor).toEqual({ x: (LEFT + RIGHT) / 2, y: 5, align: "center", baseline: "top", color: "rgba(0, 0, 0, 1)" });
  });

  it("the frame follows the size of the widget", () => {
    const s = azElScene(makePass(30, 150), { width: 300, height: 300 });
    expect(s.frame).toEqual({ left: 40, right: 260, top: 40, bottom: 260 });
    expect(s.xLegend.y).toBe(295);
  });
});

describe("azElScene curves", () => {
  // 21 samples 30 s apart; LOS 30 s after the last one: the frame is 10.5 min wide
  const p = lasting(makePass(30, 150), 10.5);
  const scene = azElScene(p, SIZE);
  const xOf = (ms: number) => LEFT + ((ms - AOS_MS) / (10.5 * 60_000)) * (RIGHT - LEFT);

  it("has a point per sample, in blue for the azimuth and in red for the elevation", () => {
    expect(scene.azCurve).toHaveLength(21);
    expect(scene.elCurve).toHaveLength(21);
    expect(scene.azColor).toBe("rgba(0, 0, 191, 1)");
    expect(scene.elColor).toBe("rgba(191, 0, 0, 1)");
  });

  it("puts the samples at their time on X, their azimuth on the left scale and their elevation on the right one", () => {
    const row = p.rows[8]!;
    const t = Date.parse(row.t);
    expect(scene.azCurve[8]![0]).toBeCloseTo(xOf(t), 9);
    expect(scene.azCurve[8]![1]).toBeCloseTo(BOTTOM - (row.az! / 180) * (BOTTOM - TOP), 9);
    expect(scene.elCurve[8]![0]).toBeCloseTo(xOf(t), 9);
    expect(scene.elCurve[8]![1]).toBeCloseTo(BOTTOM - (row.el! / 90) * (BOTTOM - TOP), 9);
    // on a 0-360 axis the same azimuth is half as high
    const wide = azElScene(lasting(makePass(30, 190), 10.5), SIZE); // sample 8 is at 30 + 160 * 8 / 20 = 94 degrees
    expect(wide.azCurve[8]![1]).toBeCloseTo(BOTTOM - (94 / 360) * (BOTTOM - TOP), 9);
  });

  it("the blue curve spans the full width: its first and last X are the edges of the frame", () => {
    expect(scene.azCurve[0]![0]).toBe(LEFT);
    expect(scene.azCurve[20]![0]).toBe(RIGHT);
    // Y stays at the azimuth of the sample, not of the AOS and LOS
    expect(scene.azCurve[0]![1]).toBeCloseTo(BOTTOM - (30 / 180) * (BOTTOM - TOP), 9);
  });

  it("the red curve starts and ends at El 0 with X unchanged, so it ends before LOS", () => {
    expect(scene.elCurve[0]![1]).toBe(BOTTOM);
    expect(scene.elCurve[20]![1]).toBe(BOTTOM);
    expect(scene.elCurve[0]![0]).toBe(LEFT);
    expect(scene.elCurve[20]![0]).toBeCloseTo(xOf(AOS_MS + 20 * 30_000), 9);
    expect(scene.elCurve[20]![0]).toBeLessThan(RIGHT);
    // the elevation in between is the sample's
    expect(scene.elCurve[10]![1]).toBeCloseTo(BOTTOM - (60 / 90) * (BOTTOM - TOP), 9);
  });

  it("moves the endpoints even when the samples do not start at AOS or have El 0 there", () => {
    const q = lasting(makePass(30, 150), 10.5);
    q.aos = new Date(AOS_MS - 15_000).toISOString(); // the first sample is 15 s after AOS
    q.rows[0] = sample(AOS_MS, 30, 3);
    q.rows[20] = sample(AOS_MS + 20 * 30_000, 150, 4);
    const s = azElScene(q, SIZE);
    // blue: X to the edges, Y untouched
    expect(s.azCurve[0]![0]).toBe(LEFT);
    expect(s.azCurve[20]![0]).toBe(RIGHT);
    expect(s.azCurve[0]![1]).toBeCloseTo(BOTTOM - (30 / 180) * (BOTTOM - TOP), 9);
    // red: Y to El 0, X untouched
    expect(s.elCurve[0]![1]).toBe(BOTTOM);
    expect(s.elCurve[20]![1]).toBe(BOTTOM);
    expect(s.elCurve[0]![0]).toBeGreaterThan(LEFT);
    expect(s.elCurve[20]![0]).toBeLessThan(RIGHT);
  });

  it("draws the azimuth as it is, with no wrap handling: a pass across north is a near-vertical line", () => {
    const north = makePass(0, 0);
    north.rows.forEach((r, i) => (r.az = (350 + i) % 360)); // 350 .. 359, 0 .. 10
    const s = azElScene(north, SIZE);
    expect(s.maxAz).toBe(360);
    const [a, b] = [s.azCurve[9]!, s.azCurve[10]!]; // 359 then 0
    expect(a[1]).toBeLessThan(TOP + 10);
    expect(b[1]).toBeGreaterThan(BOTTOM - 10);
  });

  it("leaves out a sample without a value and has no curve for fewer than two points", () => {
    const q = makePass(30, 150);
    q.rows[4] = sample(AOS_MS + 4 * 30_000, null, null);
    const s = azElScene(q, SIZE);
    expect(s.azCurve).toHaveLength(20);
    expect(s.elCurve).toHaveLength(20);
    const one = azElScene(makePass(30, 150, 1), SIZE);
    expect(one.azCurve).toEqual([]);
    expect(one.elCurve).toEqual([]);
  });

  it("a pass whose LOS is not after its AOS does not make NaN", () => {
    const zero = { ...makePass(30, 150), los: makePass(30, 150).aos };
    const s = azElScene(zero, SIZE);
    for (const [x, y] of [...s.azCurve, ...s.elCurve]) {
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
    }
  });
});

describe("azElMouseText", () => {
  const p = lasting(makePass(30, 150), 12); // 10:00:00 .. 10:12:00, 0-180 axis
  const midX = (LEFT + RIGHT) / 2;

  it("az/el mouse text uses Y", () => {
    // half way across: 10:06:00; half way up: Az 90 on the 0-180 scale and El 45
    expect(azElMouseText(midX, (TOP + BOTTOM) / 2, p, SIZE)).toBe("T: 10:06:00, AZ: 90°, EL: 45°");
    // 1 px inside the bottom left corner: 720 s * 1/320 = 2.25 s after AOS, 1/220 of the height
    expect(azElMouseText(LEFT + 1, BOTTOM - 1, p, SIZE)).toBe("T: 10:00:02, AZ: 1°, EL: 0°");
    // 1 px inside the top right corner: 717.75 s after AOS, 219/220 of the height
    expect(azElMouseText(RIGHT - 1, TOP + 1, p, SIZE)).toBe("T: 10:11:57, AZ: 179°, EL: 90°");
  });

  it("does not read the curves: the same Y gives the same Az and El wherever the curve is", () => {
    const flat = lasting(makePass(30, 31, 21, 30, 5), 12);
    expect(azElMouseText(midX, TOP + 20, flat, SIZE)).toBe(azElMouseText(midX, TOP + 20, p, SIZE));
  });

  it("the azimuth scale is 0-360 for a pass that has an azimuth above 180", () => {
    const wide = lasting(makePass(170, 190), 12);
    expect(azElMouseText(midX, (TOP + BOTTOM) / 2, wide, SIZE)).toBe("T: 10:06:00, AZ: 180°, EL: 45°");
  });

  it("is nothing outside the frame, and on its edge", () => {
    expect(azElMouseText(LEFT, 150, p, SIZE)).toBeNull();
    expect(azElMouseText(RIGHT, 150, p, SIZE)).toBeNull();
    expect(azElMouseText(midX, TOP, p, SIZE)).toBeNull();
    expect(azElMouseText(midX, BOTTOM, p, SIZE)).toBeNull();
    expect(azElMouseText(10, 10, p, SIZE)).toBeNull();
    expect(azElMouseText(midX, 280, p, SIZE)).toBeNull();
  });
});

describe("the Az/El plot in local time (ref-D §2.1)", () => {
  pinTimeZone("Asia/Kolkata"); // UTC+5:30, no daylight saving: the minutes move too
  const p = lasting(makePass(30, 150), 12);
  const midX = (LEFT + RIGHT) / 2;

  it("az/el legend", () => {
    expect(azElScene(p, SIZE, true).xLegend.text).toBe("Local Time");
    expect(azElScene(p, SIZE, false).xLegend.text).toBe("UTC");
    expect(azElScene(p, SIZE).xLegend.text).toBe("UTC");
    // only the text changes: it stays centred under the frame
    expect(azElScene(p, SIZE, true).xLegend).toEqual({ ...azElScene(p, SIZE).xLegend, text: "Local Time" });
  });

  it("the time labels are %H:%M of the local time", () => {
    expect(azElScene(p, SIZE, true).xLabels.map((l) => l.text)).toEqual(["15:32", "15:34", "15:36", "15:38", "15:40"]);
    expect(azElScene(p, SIZE, false).xLabels.map((l) => l.text)).toEqual(["10:02", "10:04", "10:06", "10:08", "10:10"]);
  });

  it("the text under the pointer has the local time as %H:%M:%S", () => {
    expect(azElMouseText(midX, (TOP + BOTTOM) / 2, p, SIZE, true)).toBe("T: 15:36:00, AZ: 90°, EL: 45°");
    expect(azElMouseText(midX, (TOP + BOTTOM) / 2, p, SIZE, false)).toBe("T: 10:06:00, AZ: 90°, EL: 45°");
    expect(azElMouseText(midX, (TOP + BOTTOM) / 2, p, SIZE)).toBe("T: 10:06:00, AZ: 90°, EL: 45°");
  });

  it("the curves do not move with the zone", () => {
    const [utc, local] = [azElScene(p, SIZE), azElScene(p, SIZE, true)];
    expect(local.azCurve).toEqual(utc.azCurve);
    expect(local.elCurve).toEqual(utc.elCurve);
  });
});
