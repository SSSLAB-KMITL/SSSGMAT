// คณิตศาสตร์ของ Timeline View (src/windows/TimelineView/scale.ts): แปลงเวลา <-> พิกเซล ขั้นของขีด ซูม/เลื่อน View Port และป้ายขีดเวลา
// เวลาทั้งหมดเป็นวินาทีนับจาก epoch (จำนวนจริง)

import { describe, expect, test } from "vitest";
import {
  MIN_VIEW_S, TICK_STEPS_S, centerViewPort, dragViewPort, panViewPort, tickLabel, tickStepS, tickTimes, timeToX, wheelZoomFactor, xToTime, zoomViewPort, zoneLabel,
} from "../../src/windows/TimelineView/scale";

const T0 = Date.UTC(2026, 10, 12, 0, 0, 0) / 1000;
const DAY = 86_400;

describe("timeToX / xToTime", () => {
  test("xToTime(timeToX(t)) gives t back within 1e-6 s for times in the analysis period", () => {
    const v0 = T0;
    const v1 = T0 + DAY;
    for (const t of [T0, T0 + 0.001, T0 + 12_345.678, T0 + DAY / 3, T0 + DAY - 0.25, T0 + DAY]) {
      for (const width of [1, 333, 1000, 2560]) {
        expect(Math.abs(xToTime(timeToX(t, v0, v1, width), v0, v1, width) - t)).toBeLessThan(1e-6);
      }
    }
  });

  test("the left edge is x = 0 and the right edge is x = width", () => {
    expect(timeToX(T0, T0, T0 + 600, 800)).toBe(0);
    expect(timeToX(T0 + 600, T0, T0 + 600, 800)).toBe(800);
    expect(timeToX(T0 + 300, T0, T0 + 600, 800)).toBe(400);
    expect(xToTime(0, T0, T0 + 600, 800)).toBe(T0);
    expect(xToTime(800, T0, T0 + 600, 800)).toBe(T0 + 600);
  });

  test("a time outside the range maps outside [0, width] (no clamping)", () => {
    expect(timeToX(T0 - 60, T0, T0 + 600, 600)).toBe(-60);
    expect(timeToX(T0 + 660, T0, T0 + 600, 600)).toBe(660);
  });

  test("an empty range or width does not divide by zero", () => {
    expect(timeToX(T0, T0, T0, 100)).toBe(0);
    expect(xToTime(50, T0, T0, 100)).toBe(T0);
    expect(xToTime(50, T0, T0 + 10, 0)).toBe(T0);
  });
});

describe("tickStepS", () => {
  test("is the smallest step of the table that is at least 80 px apart", () => {
    expect(tickStepS(86_400, 1000)).toBe(7200);
    expect(tickStepS(3600, 1000)).toBe(300);
    expect(tickStepS(600, 800)).toBe(60); // 600 * 80 / 800 = 60 -> exactly 80 px
    expect(tickStepS(601, 800)).toBe(300);
    expect(tickStepS(60, 1000)).toBe(5);  // 4.8 s -> 5 s
    expect(tickStepS(10, 1000)).toBe(1);  // never below 1 s
  });

  test("the table is the agreed one and spacing is never below 80 px (unless the table runs out)", () => {
    expect([...TICK_STEPS_S]).toEqual([1, 5, 10, 30, 60, 300, 600, 1800, 3600, 7200, 21600, 43200, 86400, 172800, 604800]);
    for (const span of [30, 100, 3600, 86_400, 3 * 86_400, 20 * 86_400]) {
      for (const width of [200, 640, 1280]) {
        const step = tickStepS(span, width);
        if (step !== 604_800) expect((step * width) / span).toBeGreaterThanOrEqual(80);
        const steps: readonly number[] = TICK_STEPS_S;
        const smaller = steps[steps.indexOf(step) - 1];
        if (smaller !== undefined) expect((smaller * width) / span).toBeLessThan(80);
      }
    }
  });

  test("a span longer than the table covers uses the largest step; a zero span or width does not throw", () => {
    expect(tickStepS(10 * 365 * DAY, 800)).toBe(604_800);
    expect(tickStepS(0, 800)).toBe(1);
    expect(tickStepS(3600, 0)).toBe(604_800);
  });
});

describe("zoomViewPort", () => {
  const bounds: [number, number] = [T0, T0 + DAY];

  test("zooming out far beyond the analysis period gives the full period", () => {
    expect(zoomViewPort(T0 + 1000, T0 + 2000, T0 + 1500, 1e6, bounds)).toEqual(bounds);
    expect(zoomViewPort(T0, T0 + DAY, T0 + 100, 2, bounds)).toEqual(bounds);
  });

  test("zooming in never gives a view narrower than 60 s", () => {
    const [a, b] = zoomViewPort(T0, T0 + DAY, T0 + DAY / 2, 1e-9, bounds);
    expect(b - a).toBe(MIN_VIEW_S);
    expect(MIN_VIEW_S).toBe(60);
    const [c, d] = zoomViewPort(a, b, a + 10, 0.1, bounds);
    expect(d - c).toBe(60);
  });

  test("keeps the time under the cursor at the same place in the view", () => {
    const [a, b] = zoomViewPort(T0, T0 + 1000, T0 + 250, 0.5, [T0, T0 + 1000]);
    expect([a - T0, b - T0]).toEqual([125, 625]);
    expect((250 - 125) / (625 - 125)).toBe(0.25); // the cursor stayed at 25 % of the view
    // zooming out around the same point
    const [c, d] = zoomViewPort(a, b, T0 + 250, 1.2, [T0, T0 + 1000]);
    expect((T0 + 250 - c) / (d - c)).toBeCloseTo(0.25, 12);
    expect(d - c).toBeCloseTo(600, 9);
  });

  test("stays inside the analysis period when the cursor is near an edge", () => {
    const [a, b] = zoomViewPort(T0, T0 + 1000, T0, 4, [T0, T0 + 1000]);
    expect(a).toBe(T0);
    expect(b).toBe(T0 + 1000);
    const [c, d] = zoomViewPort(T0 + 800, T0 + 1000, T0 + 1000, 1.5, [T0, T0 + 1000]);
    expect(d).toBe(T0 + 1000);
    expect(d - c).toBeCloseTo(300, 9);
    expect(c).toBeGreaterThanOrEqual(T0);
  });

  test("an analysis period shorter than 60 s can only show the whole period", () => {
    expect(zoomViewPort(T0, T0 + 30, T0 + 10, 0.1, [T0, T0 + 30])).toEqual([T0, T0 + 30]);
  });

  test("a cursor outside the view zooms about the nearest edge", () => {
    const [a, b] = zoomViewPort(T0 + 100, T0 + 200, T0 + 5000, 0.5, bounds);
    expect(a).toBeGreaterThanOrEqual(T0 + 100);
    expect(b).toBeLessThanOrEqual(T0 + 200);
    expect(b - a).toBe(60); // 100 s * 0.5 = 50 s, raised to the 60 s minimum
  });
});

describe("panViewPort / centerViewPort", () => {
  const bounds: [number, number] = [T0, T0 + 1000];

  test("pan keeps the width and stops at the edges of the analysis period", () => {
    expect(panViewPort([T0 + 100, T0 + 300], 50, bounds)).toEqual([T0 + 150, T0 + 350]);
    expect(panViewPort([T0 + 100, T0 + 300], -500, bounds)).toEqual([T0, T0 + 200]);
    expect(panViewPort([T0 + 100, T0 + 300], 5000, bounds)).toEqual([T0 + 800, T0 + 1000]);
  });

  test("center puts the time in the middle of the view with the same width, inside the period", () => {
    expect(centerViewPort([T0, T0 + 200], T0 + 500, bounds)).toEqual([T0 + 400, T0 + 600]);
    expect(centerViewPort([T0, T0 + 200], T0 + 20, bounds)).toEqual([T0, T0 + 200]);
    expect(centerViewPort([T0, T0 + 200], T0 + 990, bounds)).toEqual([T0 + 800, T0 + 1000]);
  });
});

describe("dragViewPort (Global Time Bar)", () => {
  const bounds: [number, number] = [T0, T0 + DAY];
  const start: [number, number] = [T0 + 3600, T0 + 7200];

  test("dragging the body pans by the time moved", () => {
    expect(dragViewPort("viewport", start, T0 + 5000, T0 + 6000, bounds)).toEqual([T0 + 4600, T0 + 8200]);
    expect(dragViewPort("viewport", start, T0 + 5000, T0 - 99999, bounds)).toEqual([T0, T0 + 3600]);
  });

  test("dragging the left edge moves only the start, never closer than 60 s to the end or outside the period", () => {
    expect(dragViewPort("edgeLeft", start, T0 + 3600, T0 + 1800, bounds)).toEqual([T0 + 1800, T0 + 7200]);
    expect(dragViewPort("edgeLeft", start, T0 + 3600, T0 + 99999, bounds)).toEqual([T0 + 7200 - 60, T0 + 7200]);
    expect(dragViewPort("edgeLeft", start, T0 + 3600, T0 - 500, bounds)).toEqual([T0, T0 + 7200]);
  });

  test("dragging the right edge moves only the end", () => {
    expect(dragViewPort("edgeRight", start, T0 + 7200, T0 + 9000, bounds)).toEqual([T0 + 3600, T0 + 9000]);
    expect(dragViewPort("edgeRight", start, T0 + 7200, T0, bounds)).toEqual([T0 + 3600, T0 + 3600 + 60]);
    expect(dragViewPort("edgeRight", start, T0 + 7200, T0 + 2 * DAY, bounds)).toEqual([T0 + 3600, T0 + DAY]);
  });

  test("an edge drag keeps the offset between where it was grabbed and the edge", () => {
    // grabbed 3 s inside the left edge: the edge follows the pointer, not the pointer position itself
    expect(dragViewPort("edgeLeft", start, T0 + 3603, T0 + 2003, bounds)).toEqual([T0 + 2000, T0 + 7200]);
  });
});

describe("tickTimes", () => {
  test("lists the multiples of the step inside the view, inclusive of both ends", () => {
    expect(tickTimes(T0, T0 + 3600, 1800)).toEqual([T0, T0 + 1800, T0 + 3600]);
    expect(tickTimes(T0 + 10, T0 + 3590, 1800)).toEqual([T0 + 1800]);
  });

  test("with a local offset the ticks fall on local multiples of the step", () => {
    // +07:00 -> local midnight is 17:00 UTC of the day before
    const ticks = tickTimes(T0, T0 + 2 * DAY, DAY, 7 * 3600);
    expect(ticks).toEqual([T0 + 17 * 3600, T0 + 17 * 3600 + DAY]);
  });

  test("never returns a runaway list", () => {
    expect(tickTimes(T0, T0 + 1e9, 1).length).toBeLessThanOrEqual(2000);
    expect(tickTimes(T0, T0, 60)).toEqual([T0]);          // both ends are inclusive
    expect(tickTimes(T0 + 5, T0 + 5, 60)).toEqual([]);
    expect(tickTimes(T0 + 5, T0, 60)).toEqual([]);
  });
});

describe("tickLabel", () => {
  const at = (iso: string) => Date.parse(iso) / 1000;

  test("a day step shows the date only", () => {
    expect(tickLabel(at("2026-11-12T00:00:00Z"), DAY, "UTCG", "+07:00", null)).toEqual({ main: "12 Nov 2026" });
    expect(tickLabel(at("2026-11-14T00:00:00Z"), 172_800, "UTCG", "+07:00", at("2026-11-12T00:00:00Z"))).toEqual({ main: "14 Nov 2026" });
  });

  test("a sub-day step shows the time, with the date on the first tick and after midnight", () => {
    const step = 7200;
    expect(tickLabel(at("2026-11-12T02:00:00Z"), step, "UTCG", "+07:00", null)).toEqual({ main: "02:00", sub: "12 Nov 2026" });
    expect(tickLabel(at("2026-11-12T04:00:00Z"), step, "UTCG", "+07:00", at("2026-11-12T02:00:00Z"))).toEqual({ main: "04:00" });
    expect(tickLabel(at("2026-11-13T00:00:00Z"), step, "UTCG", "+07:00", at("2026-11-12T22:00:00Z"))).toEqual({ main: "00:00", sub: "13 Nov 2026" });
  });

  test("a step under a minute adds the seconds", () => {
    expect(tickLabel(at("2026-11-12T02:00:30Z"), 30, "UTCG", "+07:00", at("2026-11-12T02:00:00Z"))).toEqual({ main: "02:00:30" });
    expect(tickLabel(at("2026-11-12T02:01:00Z"), 60, "UTCG", "+07:00", at("2026-11-12T02:00:00Z"))).toEqual({ main: "02:01" });
  });

  test("LTZG labels use the local time and the local date", () => {
    // 17:00 UTC is 00:00 of the next day at +07:00
    expect(tickLabel(at("2026-11-12T17:00:00Z"), 7200, "LTZG", "+07:00", at("2026-11-12T15:00:00Z"))).toEqual({ main: "00:00", sub: "13 Nov 2026" });
    expect(tickLabel(at("2026-11-12T17:00:00Z"), DAY, "LTZG", "+07:00", null)).toEqual({ main: "13 Nov 2026" });
  });
});

describe("wheelZoomFactor", () => {
  test("scrolling up zooms in and down zooms out, smoothly with the distance", () => {
    expect(wheelZoomFactor(-100, 0)).toBeLessThan(1);
    expect(wheelZoomFactor(100, 0)).toBeGreaterThan(1);
    expect(wheelZoomFactor(0, 0)).toBe(1);
    expect(wheelZoomFactor(-100, 0) * wheelZoomFactor(100, 0)).toBeCloseTo(1, 12);
    expect(wheelZoomFactor(-4, 0)).toBeGreaterThan(wheelZoomFactor(-100, 0)); // a trackpad nudge moves less than a mouse notch
  });

  test("lines and pages are converted to pixels, and one event never moves more than 4x", () => {
    expect(wheelZoomFactor(-3, 1)).toBeCloseTo(wheelZoomFactor(-48, 0), 12);
    expect(wheelZoomFactor(-1, 2)).toBeCloseTo(wheelZoomFactor(-400, 0), 12);
    expect(wheelZoomFactor(1e9, 0)).toBe(4);
    expect(wheelZoomFactor(-1e9, 0)).toBe(0.25);
  });
});

test("zoneLabel is the zone text of the DateFormat", () => {
  expect(zoneLabel("UTCG", "+07:00")).toBe("UTCG");
  expect(zoneLabel("LTZG", "+07:00")).toBe("LTZG+07:00");
});
