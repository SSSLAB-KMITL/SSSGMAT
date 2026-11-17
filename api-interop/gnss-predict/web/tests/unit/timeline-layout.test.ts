// รูปทรงของ canvas ใน Timeline View (src/windows/TimelineView/layout.ts): พื้นที่ของแต่ละส่วน สี่เหลี่ยมของแถบช่วงเวลา และตัวหาว่าจุด (x, y) อยู่ที่ไหน
// ฟังก์ชันล้วน ไม่แตะ canvas

import { describe, expect, test } from "vitest";
import {
  BAR_H, BAR_PAD, DISPLAY_TOP, GRAB_PX, LABEL_W, MIN_BAR_PX, PAD_R, ROW_H, SCALE_H, SCROLL_W,
  hitTest, intervalRects, maxScroll, needsScrollbar, plotOf, pointerX, viewPortFrame, type TimelineScene,
} from "../../src/windows/TimelineView/layout";
import { timeToX, xToTime } from "../../src/windows/TimelineView/scale";

const T0 = Date.UTC(2026, 10, 12) / 1000;
const DAY = 86_400;
const HOUR = 3600;

function scene(over: Partial<TimelineScene> = {}): TimelineScene {
  return {
    size: { width: 800, height: 300 },
    rows: [
      { intervals: [{ start: T0 + 6 * HOUR, stop: T0 + 12 * HOUR }, { start: T0 + 18 * HOUR, stop: T0 + 19 * HOUR }] },
      { intervals: [{ start: T0 + 1 * HOUR, stop: T0 + 2 * HOUR }] },
    ],
    view: [T0, T0 + DAY],
    bounds: [T0, T0 + DAY],
    current: T0 + 3 * HOUR,
    scrollY: 0,
    ...over,
  };
}
const plot = (s: TimelineScene) => plotOf(s.size, needsScrollbar(s.size, s.rows.length));

describe("regions", () => {
  test("the three parts stack: Global Time Bar, Global Time Scale, Time Display", () => {
    expect(DISPLAY_TOP).toBe(BAR_H + SCALE_H);
    expect(BAR_H).toBeGreaterThan(0);
    expect(SCALE_H).toBeGreaterThan(0);
  });

  test("the plot starts after the row name column and stops before the right margin", () => {
    const p = plotOf({ width: 800, height: 300 }, false);
    expect(p).toEqual({ left: LABEL_W, right: 800 - PAD_R, width: 800 - PAD_R - LABEL_W });
  });

  test("a scroll bar takes room from the right of the plot", () => {
    expect(plotOf({ width: 800, height: 300 }, true).right).toBe(800 - PAD_R - SCROLL_W);
  });

  test("a window narrower than the label column still has a plot of at least one pixel", () => {
    expect(plotOf({ width: 50, height: 300 }, false).width).toBeGreaterThanOrEqual(1);
  });

  test("a scroll bar is needed only when the rows are taller than the Time Display", () => {
    const size = { width: 800, height: DISPLAY_TOP + 5 * ROW_H };
    expect(needsScrollbar(size, 5)).toBe(false);
    expect(needsScrollbar(size, 6)).toBe(true);
    expect(maxScroll(size, 5)).toBe(0);
    expect(maxScroll(size, 8)).toBe(3 * ROW_H);
  });
});

describe("intervalRects", () => {
  test("is the span of the interval in the view, inside the row", () => {
    const s = scene();
    const p = plot(s);
    const [a, b] = intervalRects(s, 0);
    expect(a.index).toBe(0);
    expect(a.x).toBeCloseTo(p.left + timeToX(T0 + 6 * HOUR, T0, T0 + DAY, p.width), 9);
    expect(a.w).toBeCloseTo(timeToX(6 * HOUR, 0, DAY, p.width), 9); // 6 h of 24 h
    expect(a.y).toBe(DISPLAY_TOP + BAR_PAD);
    expect(a.h).toBe(ROW_H - 2 * BAR_PAD);
    expect(b.index).toBe(1);
    expect(intervalRects(s, 1)[0].y).toBe(DISPLAY_TOP + ROW_H + BAR_PAD);
  });

  test("follows the View Port: a zoomed view stretches the bar", () => {
    const s = scene({ view: [T0 + 6 * HOUR, T0 + 12 * HOUR] });
    const p = plot(s);
    const [a] = intervalRects(s, 0);
    expect(a.x).toBeCloseTo(p.left, 9);
    expect(a.w).toBeCloseTo(p.width, 9);
    expect(intervalRects(s, 1)).toEqual([]); // 01:00-02:00 is out of view
  });

  test("an interval partly in view is clipped to the plot; a very short one is still MIN_BAR_PX wide", () => {
    const s = scene({ view: [T0 + 9 * HOUR, T0 + 15 * HOUR], rows: [{ intervals: [{ start: T0 + 6 * HOUR, stop: T0 + 12 * HOUR }, { start: T0 + 13 * HOUR, stop: T0 + 13 * HOUR + 1 }] }] });
    const p = plot(s);
    const [a, b] = intervalRects(s, 0);
    expect(a.x).toBe(p.left);
    expect(a.x + a.w).toBeCloseTo(p.left + p.width / 2, 6);
    expect(b.w).toBe(MIN_BAR_PX);
  });

  test("scrolling moves the rows up", () => {
    const s = scene({ scrollY: ROW_H });
    expect(intervalRects(s, 1)[0].y).toBe(DISPLAY_TOP + BAR_PAD);
  });

  test("a row that does not exist has no bars", () => {
    expect(intervalRects(scene(), 5)).toEqual([]);
  });
});

describe("hitTest", () => {
  const s = scene();
  const p = plot(s);
  const barY = BAR_H / 2;
  const scaleY = BAR_H + SCALE_H / 2;
  const row0Y = DISPLAY_TOP + ROW_H / 2;
  const row1Y = DISPLAY_TOP + ROW_H + ROW_H / 2;
  const xAt = (t: number, view = s.view) => p.left + timeToX(t, view[0], view[1], p.width);

  test("the Time Display gives the time under the cursor, and the row", () => {
    const hit = hitTest(s, xAt(T0 + 4 * HOUR), row0Y);
    expect(hit).toMatchObject({ part: "display", row: 0, interval: null });
    expect((hit as { time: number }).time).toBeCloseTo(T0 + 4 * HOUR, 6);
    expect(hitTest(s, xAt(T0 + 4 * HOUR), row1Y)).toMatchObject({ part: "display", row: 1, interval: null });
  });

  test("the time under the cursor is xToTime of the position in the plot", () => {
    const x = 400;
    const hit = hitTest(s, x, row0Y) as { time: number };
    expect(hit.time).toBe(xToTime(x - p.left, T0, T0 + DAY, p.width));
  });

  test("over a bar the hit names the interval; between bars it does not", () => {
    expect(hitTest(s, xAt(T0 + 8 * HOUR), row0Y)).toMatchObject({ part: "display", row: 0, interval: 0 });
    expect(hitTest(s, xAt(T0 + 18.5 * HOUR), row0Y)).toMatchObject({ part: "display", row: 0, interval: 1 });
    expect(hitTest(s, xAt(T0 + 14 * HOUR), row0Y)).toMatchObject({ part: "display", row: 0, interval: null });
    // the same x on row 1 is not on a bar of row 0
    expect(hitTest(s, xAt(T0 + 8 * HOUR), row1Y)).toMatchObject({ row: 1, interval: null });
  });

  test("the strip of a row above and below its bar is not the bar", () => {
    expect(hitTest(s, xAt(T0 + 8 * HOUR), DISPLAY_TOP + 0.5)).toMatchObject({ row: 0, interval: null });
  });

  test("below the last row is the Time Display with no row", () => {
    expect(hitTest(s, 400, DISPLAY_TOP + 2 * ROW_H + 10)).toMatchObject({ part: "display", row: null, interval: null });
  });

  test("the row name column is the label part, with the row", () => {
    expect(hitTest(s, 10, row1Y)).toEqual({ part: "label", row: 1 });
    expect(hitTest(s, 10, DISPLAY_TOP + 5 * ROW_H)).toEqual({ part: "label", row: null });
  });

  test("the margin on the right of the plot, and anything outside the canvas, is nothing", () => {
    expect(hitTest(s, 800 - 2, row0Y)).toEqual({ part: "none" });
    expect(hitTest(s, 400, -5)).toEqual({ part: "none" });
    expect(hitTest(s, 400, 301)).toEqual({ part: "none" });
    expect(hitTest(s, -3, row0Y)).toEqual({ part: "none" });
  });

  test("the Global Time Scale gives the time of the View Port", () => {
    const hit = hitTest(scene({ view: [T0 + 6 * HOUR, T0 + 12 * HOUR] }), p.left + p.width / 2, scaleY) as { part: string; time: number };
    expect(hit.part).toBe("scale");
    expect(hit.time).toBeCloseTo(T0 + 9 * HOUR, 6);
  });

  test("scrolling changes which row is under the cursor", () => {
    const scrolled = scene({ scrollY: ROW_H, rows: [...s.rows, { intervals: [] }] });
    expect(hitTest(scrolled, 400, row0Y)).toMatchObject({ part: "display", row: 1 });
  });

  describe("Global Time Bar", () => {
    const narrow = scene({ view: [T0 + 6 * HOUR, T0 + 9 * HOUR] }); // View Port 06:00-09:00, pointer at 03:00
    const barX = (t: number) => p.left + timeToX(t, T0, T0 + DAY, p.width);

    test("the bar is mapped over the whole analysis period, not the View Port", () => {
      const hit = hitTest(narrow, barX(T0 + 20 * HOUR), barY) as { part: string; time: number };
      expect(hit.part).toBe("bar");
      expect(hit.time).toBeCloseTo(T0 + 20 * HOUR, 6);
    });

    test("zones: pointer, edges, View Port body and track", () => {
      expect(hitTest(narrow, barX(T0 + 3 * HOUR), barY)).toMatchObject({ part: "bar", zone: "pointer" });
      expect(hitTest(narrow, barX(T0 + 3 * HOUR) + GRAB_PX - 1, barY)).toMatchObject({ zone: "pointer" });
      expect(hitTest(narrow, barX(T0 + 6 * HOUR) + 1, barY)).toMatchObject({ zone: "edgeLeft" });
      expect(hitTest(narrow, barX(T0 + 9 * HOUR) - 1, barY)).toMatchObject({ zone: "edgeRight" });
      expect(hitTest(narrow, barX(T0 + 7.5 * HOUR), barY)).toMatchObject({ zone: "viewport" });
      expect(hitTest(narrow, barX(T0 + 20 * HOUR), barY)).toMatchObject({ zone: "track" });
    });

    test("the pointer wins over an edge it sits on", () => {
      const onEdge = scene({ view: [T0 + 6 * HOUR, T0 + 9 * HOUR], current: T0 + 6 * HOUR });
      expect(hitTest(onEdge, barX(T0 + 6 * HOUR), barY)).toMatchObject({ zone: "pointer" });
    });

    test("when the View Port is the whole period there is no body to pan: the bar sets the time", () => {
      expect(hitTest(s, barX(T0 + 12 * HOUR), barY)).toMatchObject({ part: "bar", zone: "track" });
    });

    test("a time past the ends of the bar is clamped to the analysis period", () => {
      const hit = hitTest(s, p.left - GRAB_PX + 1, barY) as { time: number };
      expect(hit.time).toBe(T0);
      expect((hitTest(s, p.right + GRAB_PX - 1, barY) as { time: number }).time).toBe(T0 + DAY);
    });

    test("pointerX and viewPortFrame are positions in the bar", () => {
      expect(pointerX(narrow)).toBeCloseTo(barX(T0 + 3 * HOUR), 9);
      const f = viewPortFrame(narrow);
      expect(f.x0).toBeCloseTo(barX(T0 + 6 * HOUR), 9);
      expect(f.x1).toBeCloseTo(barX(T0 + 9 * HOUR), 9);
    });

    test("a pointer outside the analysis period is not grabbed", () => {
      const out = scene({ view: [T0 + 6 * HOUR, T0 + 9 * HOUR], current: T0 - 5 * HOUR });
      expect(hitTest(out, p.left + 1, barY)).not.toMatchObject({ zone: "pointer" });
    });
  });
});
