import { describe, expect, it } from "vitest";
import { DEFAULT_NF } from "../numfmt";
import type { NumberFormat } from "../numfmt";
import { pinTimeZone } from "../pinTimeZone";
import {
  closeSky,
  hitPass,
  needsRedraw,
  NO_SATELLITES,
  openSky,
  pruneSky,
  SKY_MOVE_KM,
  SKY_REDRAW_D,
  skyCursor,
  skyLayout,
  skyPassBody,
  skyScene,
  skyTimeAt,
  skyTitle,
} from "./skyGlance";
import type { PassSummary, SkyGlanceAnswer } from "./types";

// T0 is on the hour; the axis is 8 hours (the default) on a 600 px wide plot: 75 px per hour, 1.25 px per minute
const T0 = Date.parse("2026-11-12T10:00:00.000Z");
const HOUR = 3_600_000;
const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

/** A pass from `startMin` minutes after T0, lasting `lastsMin` minutes. */
function pass(startMin: number, lastsMin = 10): PassSummary {
  const aos = T0 + startMin * MIN;
  return {
    orbit: 100,
    aos: iso(aos),
    tca: iso(aos + (lastsMin * MIN) / 2),
    los: iso(aos + lastsMin * MIN),
    max_el: 45,
    aos_az: 10,
    max_el_az: 90,
    los_az: 170,
    vis: "---",
  };
}

type Sat = SkyGlanceAnswer["sats"][number];
const sat = (norad: number, name: string, colour: string, passes: PassSummary[]): Sat => ({ norad, name, colour, passes });

function answer(sats: Sat[], hours = 8): SkyGlanceAnswer {
  return { status: "ok", t0: iso(T0), hours, sats, messages: [] };
}

const BLUE = "#3c46c8";
const GREEN = "#00500a";
const ONE = answer([sat(25544, "ISS", BLUE, [pass(240)])]); // 240 min = 4 h: the middle of the axis
const THREE = answer([sat(1, "A", BLUE, [pass(240)]), sat(2, "B", GREEN, [pass(60)]), sat(3, "C", "#d5472b", [])]);
const SIZE_3 = skyLayout(3); // 600 x 160

describe("skyLayout (ref-P §7.3)", () => {
  it("window size is 600 x (n*10 + (n+1)*20 + 50)", () => {
    expect(skyLayout(3)).toEqual({ width: 600, height: 3 * 10 + 4 * 20 + 50 });
    expect(skyLayout(1)).toEqual({ width: 600, height: 100 });
    expect(skyLayout(10).height).toBe(10 * 10 + 11 * 20 + 50);
  });
});

describe("skyScene bars", () => {
  it("bars follow time: a pass that starts half way along the axis has its left edge in the middle of the plot", () => {
    const [bar] = skyScene(ONE, skyLayout(1), true).bars;
    expect(bar).toMatchObject({ norad: 25544, aos: ONE.sats[0]!.passes[0]!.aos, x: 300, w: 12.5 });
  });

  it("a bar spans AOS to LOS: 10 px high at the default size, in the row 20 px below the top", () => {
    const [bar] = skyScene(ONE, skyLayout(1), true).bars;
    expect(bar).toMatchObject({ y: 20, h: 10 });
  });

  it("a pass in progress at T0 starts left of the plot and one after the right edge is still placed (the canvas clips them)", () => {
    const a = answer([sat(1, "A", BLUE, [pass(-5, 20), pass(8 * 60 + 30)])]);
    const bars = skyScene(a, skyLayout(1), true).bars;
    expect(bars[0]!.x).toBeCloseTo(-6.25);
    expect(bars[0]!.w).toBeCloseTo(25);
    expect(bars[1]!.x).toBeGreaterThan(600);
  });

  it("every pass of a satellite shares its row", () => {
    const a = answer([sat(1, "A", BLUE, [pass(10), pass(150), pass(300)])]);
    expect(new Set(skyScene(a, skyLayout(1), true).bars.map((b) => b.y))).toEqual(new Set([20]));
  });

  it("rows go to the satellites that have passes only, but n counts every satellite (the bar is 10 px high in a 3-satellite window)", () => {
    const a = answer([sat(1, "A", BLUE, []), sat(2, "B", GREEN, [pass(30)]), sat(3, "C", "#d5472b", [pass(90)])]);
    const bars = skyScene(a, SIZE_3, true).bars;
    expect(bars.map((b) => [b.norad, b.y, b.h])).toEqual([
      [2, 20, 10],
      [3, 50, 10], // k * (pps + 20) + 20 with k = 1
    ]);
  });

  it("when the window is taller the bars are higher: pps = (plot height - 20) / n - 20 with whole numbers", () => {
    // 600 x 260: the plot is 210 px high, (210 - 20) / 3 = 63 (whole), - 20 = 43
    const bars = skyScene(THREE, { width: 600, height: 260 }, true).bars;
    expect(bars.map((b) => [b.norad, b.y, b.h])).toEqual([
      [1, 20, 43],
      [2, 83, 43],
    ]);
  });

  it("a window that is too small for the rows gives bars of no height, never a negative one", () => {
    const bars = skyScene(THREE, { width: 600, height: 80 }, true).bars;
    expect(bars.every((b) => b.h === 0)).toBe(true);
  });

  it("the bar is the satellite's colour: fill at alpha 0xA0, border opaque", () => {
    const [bar] = skyScene(ONE, skyLayout(1), true).bars;
    expect(bar!.border).toBe("rgba(60, 70, 200, 1)");
    expect(bar!.fill).toBe("rgba(60, 70, 200, 0.627)");
  });

  it("each satellite has its own colour, as the server gave it (k counts satellites with no pass too)", () => {
    const bars = skyScene(THREE, SIZE_3, true).bars;
    expect(bars.map((b) => b.border)).toEqual(["rgba(60, 70, 200, 1)", "rgba(0, 80, 10, 1)"]);
  });

  it("the plot is as wide as the canvas: a wider window moves the bar along with it", () => {
    const [bar] = skyScene(ONE, { width: 1200, height: 100 }, true).bars;
    expect(bar).toMatchObject({ x: 600, w: 25 });
  });

  it("a pass whose times cannot be read is left out", () => {
    const bad = { ...pass(10), aos: "soon" };
    expect(skyScene(answer([sat(1, "A", BLUE, [bad, pass(100)])]), skyLayout(1), true).bars).toHaveLength(1);
  });
});

describe("skyScene satellite names (ref-P §7.5)", () => {
  it("name placement: the first bar in the right half puts the name left of it, its right edge 5 px before the bar", () => {
    const [label] = skyScene(ONE, skyLayout(1), true).labels;
    expect(label).toMatchObject({ text: "ISS", x: 295, align: "right", baseline: "middle", color: "rgba(60, 70, 200, 1)" });
  });

  it("the name is centred on the row", () => {
    const [label] = skyScene(ONE, skyLayout(1), true).labels;
    expect(label!.y).toBe(25); // 20 + 10 / 2
  });

  it("a first bar that starts within 100 px of the left edge puts the name right of it, 5 px after the bar", () => {
    const a = answer([sat(1, "Early", BLUE, [pass(10)])]); // x = 12.5, w = 12.5
    expect(skyScene(a, skyLayout(1), true).labels[0]).toMatchObject({ text: "Early", x: 30, align: "left" });
  });

  it("the limit is 100 px: a bar at 99 px has the name on its right, one at 101 px on its left", () => {
    const at = (px: number) => answer([sat(1, "S", BLUE, [pass((px / 600) * 480)])]);
    expect(skyScene(at(99), skyLayout(1), true).labels[0]!.align).toBe("left");
    expect(skyScene(at(101), skyLayout(1), true).labels[0]!.align).toBe("right");
  });

  it("only the first pass decides, not the later ones", () => {
    const a = answer([sat(1, "S", BLUE, [pass(10), pass(400)])]);
    expect(skyScene(a, skyLayout(1), true).labels[0]!.align).toBe("left");
  });

  it("a first pass in progress at T0 (left of the plot) puts the name right of it", () => {
    const a = answer([sat(1, "Now", BLUE, [pass(-5, 20), pass(200)])]);
    expect(skyScene(a, skyLayout(1), true).labels[0]).toMatchObject({ align: "left", x: expect.closeTo(-6.25 + 25 + 5) });
  });

  it("a satellite with no pass has no name", () => {
    expect(skyScene(THREE, SIZE_3, true).labels.map((l) => l.text)).toEqual(["A", "B"]);
  });
});

describe("skyScene footer and time axis (ref-P §7.5)", () => {
  const scene = skyScene(ONE, skyLayout(1), true); // 600 x 100: the plot is 50 px high

  it("the plot is the canvas less the 50 px footer", () => {
    expect(scene).toMatchObject({ width: 600, height: 100, plotHeight: 50 });
    expect(scene.footer).toEqual({ y: 50, height: 50, color: "rgba(0, 0, 64, 1)" });
  });

  it("an hour tick for each hour of the axis, the first at the first whole hour at or after T0 plus a minute", () => {
    expect(scene.hours.map((h) => h.label.text)).toEqual(["10", "11", "12", "13", "14", "15", "16", "17"]);
    expect(scene.hours[0]!.x).toBeCloseTo((0.00069 * 24 * 60) / 480 * 600, 6); // 0.00069 day after T0
    expect(scene.hours[1]!.x - scene.hours[0]!.x).toBeCloseTo(75, 6);
  });

  it("the major tick is 10 px long under the plot and its label sits 12 px under the plot, centred on it, in white", () => {
    const h = scene.hours[1]!;
    expect(h.major).toEqual({ x1: h.x, y1: 50, x2: h.x, y2: 60 });
    expect(h.label).toMatchObject({ x: h.x, y: 62, align: "center", baseline: "top", color: "rgba(255, 255, 255, 1)" });
  });

  it("the minor tick is 5 px long and half an hour after the major one when T0 is less than half an hour before it", () => {
    const h = scene.hours[0]!;
    expect(h.minor.y1).toBe(50);
    expect(h.minor.y2).toBe(55);
    expect(h.minor.x1).toBeCloseTo(h.x + 37.5, 2);
  });

  it("... and half an hour before it when T0 is more than half an hour before the major tick", () => {
    const a = { ...ONE, t0: iso(T0 + 20 * MIN) }; // next whole hour is 40 min away
    const s = skyScene(a, skyLayout(1), true);
    expect(s.hours[0]!.label.text).toBe("11");
    expect(s.hours[0]!.minor.x1).toBeCloseTo(s.hours[0]!.x - 37.5, 2);
  });

  it("T0 exactly on an hour: that hour is the first tick", () => {
    expect(scene.hours[0]!.label.text).toBe("10");
  });

  it("the axis is `hours` long: 3 hours give 3 ticks and 200 px per hour", () => {
    const s = skyScene(answer([sat(1, "S", BLUE, [pass(30)])], 3), skyLayout(1), true);
    expect(s.hours).toHaveLength(3);
    expect(s.hours[1]!.x - s.hours[0]!.x).toBeCloseTo(200, 6);
    expect(s.bars[0]!.x).toBeCloseTo(100); // 30 min of 180
  });

  it("the caption is UTC under the middle of the footer, 5 px above its bottom", () => {
    expect(scene.caption).toMatchObject({ text: "UTC", x: 300, y: 95, align: "center", baseline: "bottom", color: "rgba(255, 255, 255, 1)" });
  });

  it("local time: the caption is TIME and the hour labels are local hours of the same UTC-hour ticks", () => {
    const local = skyScene(ONE, skyLayout(1), false);
    expect(local.caption.text).toBe("TIME");
    expect(local.hours.map((h) => h.x)).toEqual(scene.hours.map((h) => h.x));
    expect(local.hours.map((h) => h.label.text)).toEqual(
      scene.hours.map((_, i) => String(new Date(T0 + i * HOUR + 60_000).getHours()).padStart(2, "0")),
    );
  });
});

describe("skyTimeAt and skyCursor (ref-P §7.5, §7.6)", () => {
  const scene = skyScene(ONE, skyLayout(1), true);

  it("time under the pointer is T0 plus the fraction of the axis", () => {
    expect(skyTimeAt(scene, 0)).toBe(T0);
    expect(skyTimeAt(scene, 300)).toBe(T0 + 4 * HOUR);
    expect(skyTimeAt(scene, 150)).toBe(T0 + 2 * HOUR);
  });

  it("the line spans the plot at the pointer's x, 0.5 px wide, black at 70%", () => {
    const c = skyCursor(scene, 150)!;
    expect(c.line).toEqual({ x1: 150, y1: 0, x2: 150, y2: 50 });
    expect(c.color).toBe("rgba(0, 0, 0, 0.7)");
    expect(c.lineWidth).toBe(0.5);
  });

  it("the time label is HH:MM of the time under the pointer, 5 px right of the line, at the top of the plot", () => {
    expect(skyCursor(scene, 150)!.label).toMatchObject({ text: "12:00", x: 155, y: 0, align: "left", baseline: "top", color: "rgba(0, 0, 0, 0.7)" });
    expect(skyCursor(scene, 82.5)!.label.text).toBe("11:06"); // 82.5 px = 66 min
  });

  it("a line in the right half puts the label left of it, 5 px away", () => {
    expect(skyCursor(scene, 450)!.label).toMatchObject({ text: "16:00", x: 445, align: "right" });
  });

  it("the middle of the plot still counts as the left half, as the whole-number width / 2 of Gpredict does", () => {
    expect(skyCursor(scene, 300)!.label.align).toBe("left");
    expect(skyCursor(scene, 300.5)!.label.align).toBe("right");
    const odd = skyScene(ONE, { width: 601, height: 100 }, true); // 601 / 2 is 300 there
    expect(skyCursor(odd, 300.5)!.label.align).toBe("right");
    expect(skyCursor(odd, 300)!.label.align).toBe("left");
  });

  it("there is no line while the pointer x is not strictly inside the plot width", () => {
    expect(skyCursor(scene, 0)).toBeNull();
    expect(skyCursor(scene, 600)).toBeNull();
    expect(skyCursor(scene, -3)).toBeNull();
    expect(skyCursor(scene, 700)).toBeNull();
    expect(skyCursor(scene, 0.1)).not.toBeNull();
  });
});

describe("hitPass (ref-P §7.6)", () => {
  const scene = skyScene(THREE, SIZE_3, true); // A: x 300..312.5, y 20..30; B: x 75..87.5, y 50..60

  it("hit test: a point in a bar gives its satellite and the AOS and LOS of its pass", () => {
    const [a, b] = [THREE.sats[0]!.passes[0]!, THREE.sats[1]!.passes[0]!];
    expect(hitPass(scene, 305, 25)).toEqual({ norad: 1, aos: a.aos, los: a.los });
    expect(hitPass(scene, 80, 55)).toEqual({ norad: 2, aos: b.aos, los: b.los });
  });

  it("the edges of the box count as in", () => {
    expect(hitPass(scene, 300, 20)).not.toBeNull();
    expect(hitPass(scene, 312.5, 30)).not.toBeNull();
  });

  it("a point just outside, or empty space, hits nothing", () => {
    expect(hitPass(scene, 312.6, 25)).toBeNull();
    expect(hitPass(scene, 299.9, 25)).toBeNull();
    expect(hitPass(scene, 305, 30.1)).toBeNull();
    expect(hitPass(scene, 305, 19.9)).toBeNull();
    expect(hitPass(scene, 10, 10)).toBeNull();
    expect(hitPass(scene, 305, 40)).toBeNull(); // between the rows
  });

  it("the footer is not a bar", () => {
    expect(hitPass(scene, 305, 140)).toBeNull();
  });

  it("the first of overlapping boxes, in creation order, wins", () => {
    const a = answer([sat(1, "A", BLUE, [pass(200, 60), pass(220, 60)])]);
    const s = skyScene(a, skyLayout(1), true);
    const first = a.sats[0]!.passes[0]!;
    expect(hitPass(s, 300, 25)).toEqual({ norad: 1, aos: first.aos, los: first.los }); // x 250..325 and 275..350: both have 300
  });

  it("the request of a click: kind at, from the chart's t0, with the AOS and the LOS (spec §3.2: the days of AOS to LOS)", () => {
    const hit = hitPass(scene, 305, 25)!;
    expect(skyPassBody(hit, THREE.t0)).toEqual({ norad: 1, kind: "at", t: THREE.t0, aos: hit.aos, los: hit.los });
  });

  it("an empty scene hits nothing", () => {
    expect(hitPass(skyScene(answer([]), skyLayout(1), true), 5, 5)).toBeNull();
  });
});

describe("no satellites (ref-P §7.1)", () => {
  it("no satellites text: an answer with no satellites says This module has no satellites!", () => {
    const scene = skyScene(answer([]), skyLayout(0), true);
    expect(NO_SATELLITES).toBe("This module has no satellites!");
    expect(scene.message).toBe("This module has no satellites!");
    expect(scene.bars).toEqual([]);
    expect(scene.labels).toEqual([]);
  });

  it("a scene with satellites has no message, also when none of them has a pass", () => {
    expect(skyScene(ONE, skyLayout(1), true).message).toBeNull();
    expect(skyScene(answer([sat(1, "A", BLUE, [])]), skyLayout(1), true).message).toBeNull();
  });
});

describe("needsRedraw (ref-P §7.7)", () => {
  const at = (s: number, lat = 13.7, lon = 100.5) => ({ t: new Date(T0 + s * 1000), lat, lon });
  const base = at(0);

  it("redraw threshold: 60 s is not enough, 61 s is", () => {
    expect(needsRedraw(base, at(60))).toBe(false);
    expect(needsRedraw(base, at(61))).toBe(true);
  });

  it("the threshold is 7.0e-4 day (60.48 s) in either direction", () => {
    expect(SKY_REDRAW_D).toBe(7.0e-4);
    expect(needsRedraw(at(60), base)).toBe(false);
    expect(needsRedraw(at(61), base)).toBe(true);
    expect(needsRedraw(base, at(-61))).toBe(true);
    expect(needsRedraw(base, at(-60))).toBe(false);
  });

  it("the same time and place needs none", () => {
    expect(needsRedraw(base, at(0))).toBe(false);
  });

  it("the station moving 0.5 km does not redraw, 1.5 km does (1 km is the limit)", () => {
    expect(SKY_MOVE_KM).toBe(1);
    const dLat = (km: number) => km / 111.2; // Gpredict's one degree of arc is 111.2 km
    expect(needsRedraw(base, at(0, 13.7 + dLat(0.5)))).toBe(false);
    expect(needsRedraw(base, at(0, 13.7 + dLat(1.5)))).toBe(true);
    expect(needsRedraw(base, at(0, 13.7 - dLat(1.5)))).toBe(true);
  });

  it("a move east counts too, shorter by the cosine of the latitude", () => {
    const dLon = (km: number) => km / 111.2 / Math.cos((13.7 * Math.PI) / 180);
    expect(needsRedraw(base, at(0, 13.7, 100.5 + dLon(0.5)))).toBe(false);
    expect(needsRedraw(base, at(0, 13.7, 100.5 + dLon(1.5)))).toBe(true);
  });

  it("works at the poles and the antimeridian", () => {
    expect(needsRedraw(at(0, 90, 0), at(0, 90, 120))).toBe(false);
    expect(needsRedraw(at(0, 0, 179.99), at(0, 0, -179.99))).toBe(true); // 2.2 km apart
    expect(needsRedraw(at(0, 0, 179.999), at(0, 0, -179.999))).toBe(false); // 0.2 km apart
  });

  it("a time that is not a date never redraws", () => {
    expect(needsRedraw(base, { t: new Date(NaN), lat: 13.7, lon: 100.5 })).toBe(false);
  });
});

describe("the windows that are open (ref-P §7.1: one window per module, pressing again raises it)", () => {
  it("opens a window once per module and counts every further press, so the window can be raised", () => {
    let open = openSky(new Map(), "A");
    expect([...open]).toEqual([["A", 0]]);
    open = openSky(open, "B");
    open = openSky(open, "A");
    expect([...open]).toEqual([
      ["A", 1],
      ["B", 0],
    ]);
    expect([...openSky(open, "A")]).toContainEqual(["A", 2]);
  });

  it("closes the window of a module and leaves the others; the same map when it is not there", () => {
    const open = openSky(openSky(new Map(), "A"), "B");
    expect([...closeSky(open, "A").keys()]).toEqual(["B"]);
    expect(closeSky(open, "Z")).toBe(open);
  });

  it("forgets the windows of modules that are not open any more; the same map when nothing goes", () => {
    const open = openSky(openSky(new Map(), "A"), "B");
    expect([...pruneSky(open, ["B", "C"]).keys()]).toEqual(["B"]);
    expect(pruneSky(open, ["A", "B"])).toBe(open);
  });
});

describe("skyTitle (ref-P §7.1)", () => {
  it("is The sky at a glance (<module>)", () => {
    expect(skyTitle("Amateur")).toBe("The sky at a glance (Amateur)");
  });
});

describe("sky at a glance and the number format (ref-D §2.1)", () => {
  pinTimeZone("Asia/Kolkata"); // UTC+5:30, no daylight saving: a local hour is not the UTC hour with a whole offset
  const nfOf = (over: Partial<NumberFormat>): NumberFormat => ({ ...DEFAULT_NF, ...over });
  /** how the window builds the scene: `utc` is the opposite of "Show local time instead of UTC" */
  const sceneFor = (nf: NumberFormat) => skyScene(ONE, skyLayout(1), !nf.local);

  it("sky at a glance label", () => {
    expect(sceneFor(nfOf({ local: true })).caption.text).toBe("TIME");
    expect(sceneFor(nfOf({ local: false })).caption.text).toBe("UTC");
    expect(sceneFor(DEFAULT_NF).caption.text).toBe("UTC");
  });

  it("the hour labels are the local hours, in the local zone, of the ticks that stay where they are", () => {
    const utc = sceneFor(DEFAULT_NF);
    const local = sceneFor(nfOf({ local: true }));
    expect(utc.hours.slice(0, 3).map((h) => h.label.text)).toEqual(["10", "11", "12"]);
    expect(local.hours.slice(0, 3).map((h) => h.label.text)).toEqual(["15", "16", "17"]); // 15:31 local at the first tick
    expect(local.hours.map((h) => h.x)).toEqual(utc.hours.map((h) => h.x));
  });

  it("the time beside the cursor is the local %H:%M", () => {
    expect(skyCursor(sceneFor(DEFAULT_NF), 150)!.label.text).toBe("12:00");
    expect(skyCursor(sceneFor(nfOf({ local: true })), 150)!.label.text).toBe("17:30");
  });

  it("Imperial, N/S/E/W and the time format change nothing in the chart", () => {
    const f = nfOf({ imperial: true, nsew: true, timeFormat: "%d" });
    expect(sceneFor(f)).toEqual(sceneFor(DEFAULT_NF));
  });
});
