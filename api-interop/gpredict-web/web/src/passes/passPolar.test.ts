import { describe, expect, it } from "vitest";
import { POLAR_COLORS, cssRgba } from "../colors";
import { pinTimeZone } from "../pinTimeZone";
import { azElToXY, cardinalLabels, POLAR_ORIENTATIONS } from "../views/polarGeom";
import { passPolarScene, polarMouseText } from "./passPolar";
import { AOS_MS, makePass, sample } from "./passPlots.fixture";

const SIZE = { width: 300, height: 300 }; // centre (150, 150), radius 300/2 - 20 = 130 (ref-P §5)
const [CX, CY, R] = [150, 150, 130];

const dist = ([x, y]: readonly [number, number]) => Math.hypot(x - CX, y - CY);

describe("passPolarScene", () => {
  it("track starts and ends on the horizon at AOS/LOS azimuth", () => {
    const p = makePass(30, 150);
    const { track } = passPolarScene(p, SIZE, "N/E/S/W", "Bangkok");
    expect(track).toHaveLength(p.rows.length);
    // the first and the last point are on the 0 degree circle, at the azimuth of the AOS and of the LOS, not of the samples
    expect(dist(track[0]!)).toBeCloseTo(R, 9);
    expect(dist(track.at(-1)!)).toBeCloseTo(R, 9);
    expect(track[0]).toEqual(azElToXY(29.5, 0, CX, CY, R, "N/E/S/W"));
    expect(track.at(-1)).toEqual(azElToXY(150.5, 0, CX, CY, R, "N/E/S/W"));
    // the samples in between use their own azimuth and elevation
    const mid = p.rows[10]!;
    expect(track[10]).toEqual(azElToXY(mid.az!, mid.el!, CX, CY, R, "N/E/S/W"));
    expect(dist(track[10]!)).toBeLessThan(R / 2); // 60 degrees at the top of the pass: a third of the radius
  });

  it("track follows the orientation", () => {
    const p = makePass(30, 150);
    for (const o of POLAR_ORIENTATIONS.slice(1)) {
      const { track } = passPolarScene(p, SIZE, o, null);
      expect(track[0]).toEqual(azElToXY(29.5, 0, CX, CY, R, o));
      expect(track[5]).toEqual(azElToXY(p.rows[5]!.az!, p.rows[5]!.el!, CX, CY, R, o));
    }
    // an orientation the server does not know is the default N/E/S/W
    expect(passPolarScene(p, SIZE, "up", null).track).toEqual(passPolarScene(p, SIZE, "N/E/S/W", null).track);
  });

  it("a sample below the horizon keeps the point before it, as Gpredict does", () => {
    const p = makePass(30, 150);
    p.rows[7] = sample(AOS_MS + 7 * 30_000, 80, -0.4);
    p.rows[8] = sample(AOS_MS + 8 * 30_000, null, null);
    const { track } = passPolarScene(p, SIZE, "N/E/S/W", null);
    expect(track).toHaveLength(21);
    expect(track[7]).toEqual(track[6]);
    expect(track[8]).toEqual(track[6]);
  });

  it("five time labels", () => {
    // 21 samples 30 s apart: every (21 - 2) / 4 = 4th sample after the first, AOS 10:00 then 10:02, 10:04, 10:06, 10:08
    const p = makePass(30, 150);
    const { ticks, track } = passPolarScene(p, SIZE, "N/E/S/W", null);
    expect(ticks.map((t) => t.text)).toEqual(["10:00", "10:02", "10:04", "10:06", "10:08"]);
    for (const t of ticks) expect(t.text).toMatch(/^\d\d:\d\d$/);
    // every label is vertically centred on its point; the track is right of the centre, so the text ends before the point
    ticks.forEach((t, i) => {
      const k = i * 4; // index of the sample
      expect(t.y).toBe(track[k]![1]);
      expect(t.baseline).toBe("middle");
      expect(t.align).toBe("right");
      expect(t.color).toBe(cssRgba(POLAR_COLORS.track));
    });
    // the first label is 5 px from its point; the others also moved 5 px toward the centre first (update_track), so 10 px
    expect(ticks[0]!.x).toBeCloseTo(track[0]![0] - 5, 9);
    for (let i = 1; i < 5; i++) expect(ticks[i]!.x).toBeCloseTo(track[i * 4]![0] - 10, 9);
  });

  it("labels left of the centre start after their point", () => {
    const p = makePass(210, 330); // west of the station: the track is left of the centre
    const { ticks, track } = passPolarScene(p, SIZE, "N/E/S/W", null);
    expect(ticks).toHaveLength(5);
    ticks.forEach((t, i) => {
      expect(t.align).toBe("left");
      expect(t.x).toBeCloseTo(track[i * 4]![0] + (i === 0 ? 5 : 10), 9);
    });
  });

  it("the number of labels and their spacing follow the number of samples", () => {
    // n = 10: (10 - 2) / 4 = 2 -> samples 0, 2, 4, 6, 8 (the last sample, LOS, never has one)
    const ten = passPolarScene(makePass(30, 150, 10, 60), SIZE, "N/E/S/W", null).ticks;
    expect(ten.map((t) => t.text)).toEqual(["10:00", "10:02", "10:04", "10:06", "10:08"]);
    // n = 23: (23 - 2) / 4 = 5 (integer division) -> samples 0, 5, 10, 15, 20
    const many = passPolarScene(makePass(30, 150, 23, 10), SIZE, "N/E/S/W", null).ticks;
    expect(many.map((t) => t.text)).toEqual(["10:00", "10:00", "10:01", "10:02", "10:03"]);
  });

  it("a pass of fewer than 6 samples gets a label on each inner sample instead of dividing by zero", () => {
    // ours: Gpredict divides by zero here (ref-P §5.3, UNVERIFIED)
    expect(passPolarScene(makePass(30, 150, 5, 60), SIZE, "N/E/S/W", null).ticks.map((t) => t.text)).toEqual(["10:00", "10:01", "10:02", "10:03"]);
    expect(passPolarScene(makePass(30, 150, 3, 60), SIZE, "N/E/S/W", null).ticks.map((t) => t.text)).toEqual(["10:00", "10:01"]);
    expect(passPolarScene(makePass(30, 150, 2, 60), SIZE, "N/E/S/W", null).ticks.map((t) => t.text)).toEqual(["10:00"]);
  });

  it("a pass with one sample or none has no track and no labels", () => {
    expect(passPolarScene(makePass(30, 150, 1), SIZE, "N/E/S/W", null)).toMatchObject({ track: [], ticks: [] });
    const empty = makePass(30, 150);
    empty.rows = [];
    expect(passPolarScene(empty, SIZE, "N/E/S/W", null)).toMatchObject({ track: [], ticks: [] });
  });

  it("null pass draws axes only", () => {
    const scene = passPolarScene(null, SIZE, "N/E/S/W", "Bangkok");
    // three 1 px circles at El 0, 30 and 60 degrees; El 90 is the centre
    expect(scene.circles.map((c) => c.r)).toEqual([R, 0.6667 * R, 0.333 * R]);
    expect(scene.circles.every((c) => c.x === CX && c.y === CY)).toBe(true);
    // a horizontal and a vertical line through the centre, 5 px beyond the 0 degree circle
    expect(scene.axes).toEqual([
      { x1: CX - R - 5, y1: CY, x2: CX + R + 5, y2: CY },
      { x1: CX, y1: CY - R - 5, x2: CX, y2: CY + R + 5 },
    ]);
    expect(scene.cardinals.map((c) => c.text)).toEqual(["N", "E", "S", "W"]);
    expect(scene.cardinals.every((c) => c.color === cssRgba(POLAR_COLORS.tick))).toBe(true);
    expect(scene.qth).toMatchObject({ text: "Bangkok", color: cssRgba(POLAR_COLORS.info) });
    expect(scene.track).toEqual([]);
    expect(scene.ticks).toEqual([]);
  });

  it("is on a white background, with the default colours of the Polar view", () => {
    const scene = passPolarScene(makePass(30, 150), SIZE, "N/E/S/W", "Bangkok");
    expect(scene.background).toBe("rgba(255, 255, 255, 1)");
    expect(scene.axesColor).toBe(cssRgba(POLAR_COLORS.axes));
    expect(scene.trackColor).toBe(cssRgba(POLAR_COLORS.track));
  });

  it("is drawn in the colours it is given, the global colours of the Polar View (plan decision 15), on a white background still", () => {
    const colours = { ...POLAR_COLORS, background: 0x12345678, axes: 0x11223344, tick: 0x55667788, track: 0x99aabbcc, info: 0xddeeff01 };
    const scene = passPolarScene(makePass(30, 150), SIZE, "N/E/S/W", "Bangkok", false, colours);
    expect(scene.background).toBe("rgba(255, 255, 255, 1)");
    expect(scene.axesColor).toBe(cssRgba(0x11223344));
    expect(scene.trackColor).toBe(cssRgba(0x99aabbcc));
    expect(scene.cardinals.every((c) => c.color === cssRgba(0x55667788))).toBe(true);
    expect(scene.qth!.color).toBe(cssRgba(0xddeeff01));
    expect(scene.cursor.color).toBe(cssRgba(0xddeeff01));
    expect(scene.ticks.length).toBeGreaterThan(0);
    expect(scene.ticks.every((t) => t.color === cssRgba(0x99aabbcc))).toBe(true); // the time labels have the track colour
  });

  it("the circle is min(width, height) / 2 - 20 px, centred in the area", () => {
    const wide = passPolarScene(null, { width: 401, height: 300 }, "N/E/S/W", null);
    expect(wide).toMatchObject({ width: 401, height: 300, cx: 200, cy: 150, r: 130 }); // integer centre, as Gpredict (guint)
    expect(passPolarScene(null, { width: 200, height: 200 }, "N/E/S/W", null).r).toBe(80);
    expect(passPolarScene(null, { width: 30, height: 30 }, "N/E/S/W", null).r).toBe(0); // never negative
  });

  it("N, E, S and W sit where the orientation puts them, as in the Polar view", () => {
    for (const o of POLAR_ORIENTATIONS) {
      const scene = passPolarScene(null, SIZE, o, null);
      expect(scene.cardinals.map(({ text, x, y, align, baseline }) => ({ text, x, y, align, baseline }))).toEqual(cardinalLabels(CX, CY, R, o));
    }
    // S/E/N/W: N is at the bottom of the circle, S at the top
    const flipped = passPolarScene(null, SIZE, "S/E/N/W", null).cardinals;
    expect(flipped.find((c) => c.text === "N")!.y).toBeGreaterThan(CY + R);
    expect(flipped.find((c) => c.text === "S")!.y).toBeLessThan(CY - R);
  });

  it("the station name is above the top left of the circle, the cursor text below the bottom left", () => {
    const scene = passPolarScene(null, SIZE, "N/E/S/W", "Bangkok");
    // x = centre - r - 10, the text ends 5 px above the circle; the cursor text starts 5 px below it
    expect(scene.qth).toMatchObject({ x: CX - R - 10, y: CY - R - 5, align: "left", baseline: "bottom" });
    expect(scene.cursor).toMatchObject({ x: CX - R - 10, y: CY + R + 5, align: "left", baseline: "top", color: cssRgba(POLAR_COLORS.info) });
  });

  it("no station name when there is none to show", () => {
    expect(passPolarScene(null, SIZE, "N/E/S/W", null).qth).toBeNull();
  });
});

describe("polarMouseText", () => {
  it("polar mouse text", () => {
    expect(polarMouseText(CX, CY, SIZE, "N/E/S/W")).toBe("AZ: 0°  EL: 90°"); // two spaces
    // the centre is South in an orientation with S at the top
    expect(polarMouseText(CX, CY, SIZE, "S/E/N/W")).toBe("AZ: 180°  EL: 90°");
  });

  it("is the azimuth and elevation under the pointer, for the orientation", () => {
    // half way from the centre to the circle: El 45
    expect(polarMouseText(CX + R / 2, CY, SIZE, "N/E/S/W")).toBe("AZ: 90°  EL: 45°"); // east is on the right
    expect(polarMouseText(CX + R / 2, CY, SIZE, "N/W/S/E")).toBe("AZ: 270°  EL: 45°");
    expect(polarMouseText(CX, CY - R / 2, SIZE, "N/E/S/W")).toBe("AZ: 0°  EL: 45°"); // north is up
    expect(polarMouseText(CX, CY - R / 2, SIZE, "S/E/N/W")).toBe("AZ: 180°  EL: 45°");
    expect(polarMouseText(CX - R / 2, CY, SIZE, "N/E/S/W")).toBe("AZ: 270°  EL: 45°");
  });

  it("is nothing on or outside the circle (El 0 and below)", () => {
    expect(polarMouseText(CX + R, CY, SIZE, "N/E/S/W")).toBeNull(); // El is 0 on the circle
    expect(polarMouseText(CX + R + 1, CY, SIZE, "N/E/S/W")).toBeNull();
    expect(polarMouseText(0, 0, SIZE, "N/E/S/W")).toBeNull();
    expect(polarMouseText(CX, CY, { width: 30, height: 30 }, "N/E/S/W")).toBeNull(); // no circle at all
  });
});

describe("passPolarScene time labels in local time (ref-D §2.1)", () => {
  pinTimeZone("Asia/Kolkata"); // UTC+5:30, no daylight saving: the minutes move too

  it("the labels are %H:%M of the local time, and UTC without it", () => {
    const p = makePass(30, 150);
    expect(passPolarScene(p, SIZE, "N/E/S/W", null, true).ticks.map((t) => t.text)).toEqual(["15:30", "15:32", "15:34", "15:36", "15:38"]);
    expect(passPolarScene(p, SIZE, "N/E/S/W", null, false).ticks.map((t) => t.text)).toEqual(["10:00", "10:02", "10:04", "10:06", "10:08"]);
    expect(passPolarScene(p, SIZE, "N/E/S/W", null).ticks.map((t) => t.text)).toEqual(["10:00", "10:02", "10:04", "10:06", "10:08"]);
  });

  it("where the labels stand does not depend on the zone", () => {
    const p = makePass(30, 150);
    const [utc, local] = [passPolarScene(p, SIZE, "N/E/S/W", "Home"), passPolarScene(p, SIZE, "N/E/S/W", "Home", true)];
    expect(local.ticks.map(({ text: _, ...at }) => at)).toEqual(utc.ticks.map(({ text: _, ...at }) => at));
    expect(local.track).toEqual(utc.track);
  });

  it("a scene with no pass still takes the four arguments of Antenna Control", () => {
    expect(passPolarScene(null, SIZE, "N/E/S/W", null)).toMatchObject({ track: [], ticks: [], cx: CX, cy: CY, r: R });
  });
});
