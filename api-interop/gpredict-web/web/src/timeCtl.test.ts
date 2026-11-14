import { describe, expect, it } from "vitest";
import { pinTimeZone } from "./pinTimeZone";
import {
  applyEdit,
  changeField,
  composeTime,
  dayOf,
  displayFields,
  failEdit,
  fieldsFromTime,
  INITIAL_MODEL,
  monthGrid,
  observeClock,
  shiftMonth,
  shiftYear,
  sliderToDays,
  wrapSpin,
} from "./timeCtl";
import type { TimeFields } from "./timeCtl";
import type { ClockInfo } from "./types";

const utc = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0, ms = 0) => new Date(Date.UTC(y, mo - 1, d, h, mi, s, ms));
const day = (y: number, mo: number, d: number) => utc(y, mo, d);
const iso = (d: Date) => d.toISOString();

describe("wrapSpin", () => {
  it("leaves a value inside the range alone, ends included", () => {
    expect(wrapSpin(0, 0, 59)).toEqual({ value: 0, carry: 0 });
    expect(wrapSpin(30, 0, 59)).toEqual({ value: 30, carry: 0 });
    expect(wrapSpin(59, 0, 59)).toEqual({ value: 59, carry: 0 });
  });

  it("Sec 60 wraps to 0 and carries +1 to Min", () => {
    expect(wrapSpin(60, 0, 59)).toEqual({ value: 0, carry: 1 });
  });

  it("Hour -1 wraps to 23 and carries -1 to the calendar day", () => {
    expect(wrapSpin(-1, 0, 23)).toEqual({ value: 23, carry: -1 });
  });

  it("Msec 1000 wraps to 0 and carries +1 to Sec", () => {
    expect(wrapSpin(1000, 0, 999)).toEqual({ value: 0, carry: 1 });
  });

  it("wraps the other ends too", () => {
    expect(wrapSpin(24, 0, 23)).toEqual({ value: 0, carry: 1 });
    expect(wrapSpin(-1, 0, 59)).toEqual({ value: 59, carry: -1 });
    expect(wrapSpin(-1, 0, 999)).toEqual({ value: 999, carry: -1 });
  });

  it("carries more than one turn for a big step", () => {
    expect(wrapSpin(125, 0, 59)).toEqual({ value: 5, carry: 2 });
    expect(wrapSpin(-61, 0, 59)).toEqual({ value: 59, carry: -2 });
  });

  it("works for a range that does not start at 0", () => {
    expect(wrapSpin(101, 1, 100)).toEqual({ value: 1, carry: 1 });
    expect(wrapSpin(0, 1, 100)).toEqual({ value: 100, carry: -1 });
  });
});

describe("composeTime", () => {
  it("builds the UTC time from the calendar day and the four spin buttons", () => {
    expect(iso(composeTime(day(2026, 11, 12), 7, 8, 9, 10, 0))).toBe("2026-11-12T07:08:09.010Z");
  });

  it("uses only the calendar day of the Date it is given, not its time of day", () => {
    expect(iso(composeTime(utc(2026, 11, 12, 15, 30, 45, 999), 1, 2, 3, 4, 0))).toBe("2026-11-12T01:02:03.004Z");
  });

  it("a slider of 0.1 day is +8640 seconds, -0.1 day is -8640 seconds", () => {
    const base = composeTime(day(2026, 11, 12), 12, 0, 0, 0, 0);
    expect(composeTime(day(2026, 11, 12), 12, 0, 0, 0, 0.1).getTime() - base.getTime()).toBe(8640 * 1000);
    expect(composeTime(day(2026, 11, 12), 12, 0, 0, 0, -0.1).getTime() - base.getTime()).toBe(-8640 * 1000);
  });

  it("one slider step (0.0001 day) is 8.64 seconds", () => {
    const base = composeTime(day(2026, 11, 12), 12, 0, 0, 0, 0);
    expect(composeTime(day(2026, 11, 12), 12, 0, 0, 0, 0.0001).getTime() - base.getTime()).toBe(8640);
    expect(composeTime(day(2026, 11, 12), 12, 0, 0, 0, 0.0003).getTime() - base.getTime()).toBe(25920);
  });

  it("the slider can cross midnight", () => {
    expect(iso(composeTime(day(2026, 11, 12), 23, 0, 0, 0, 0.1))).toBe("2026-11-13T01:24:00.000Z");
  });

  it("is invalid (NaN) for a day that is not a date", () => {
    expect(Number.isNaN(composeTime(new Date(NaN), 0, 0, 0, 0, 0).getTime())).toBe(true);
  });
});

describe("sliderToDays", () => {
  it("rounds to the step of 0.0001 day, so the float noise of the range input does not reach the time", () => {
    expect(sliderToDays(0.30000000000000004 / 3)).toBe(0.1);
    expect(sliderToDays(0.00010000000000000002)).toBe(0.0001);
    expect(sliderToDays(-0.0999999999)).toBe(-0.1);
  });

  it("keeps the range of the slider", () => {
    expect(sliderToDays(0.5)).toBe(0.1);
    expect(sliderToDays(-3)).toBe(-0.1);
  });
});

describe("fieldsFromTime", () => {
  it("splits a time into the calendar day and the four spin buttons (UTC)", () => {
    const f = fieldsFromTime(utc(2026, 11, 12, 7, 8, 9, 10));
    expect(iso(f.day)).toBe("2026-11-12T00:00:00.000Z");
    expect([f.h, f.m, f.s, f.ms]).toEqual([7, 8, 9, 10]);
  });

  it("composes back to the same time", () => {
    const t = utc(2026, 12, 31, 23, 59, 59, 999);
    const f = fieldsFromTime(t);
    expect(composeTime(f.day, f.h, f.m, f.s, f.ms, 0).getTime()).toBe(t.getTime());
  });
});

describe("the time controller fields in local time", () => {
  pinTimeZone("Asia/Bangkok"); // UTC+7 all year, no daylight saving time

  const t = utc(2026, 11, 12, 5, 6, 7, 8); // 12:06:07.008 in Bangkok

  it("time controller fields in local time", () => {
    const f = fieldsFromTime(t, true);
    expect(f.h).toBe(12);
    expect([f.m, f.s, f.ms]).toEqual([6, 7, 8]);
    expect(iso(f.day)).toBe("2026-11-12T00:00:00.000Z"); // a calendar date, held as UTC midnight
    expect(composeTime(f.day, f.h, f.m, f.s, f.ms, 0, true).getTime()).toBe(t.getTime());
  });

  it("the calendar day is the local date: after 17:00 UTC it is already tomorrow", () => {
    const late = utc(2026, 12, 31, 20, 30);
    expect(iso(dayOf(late, true))).toBe("2027-01-01T00:00:00.000Z");
    expect(iso(dayOf(late))).toBe("2026-12-31T00:00:00.000Z");
    expect(iso(dayOf(late, false))).toBe("2026-12-31T00:00:00.000Z");
    const f = fieldsFromTime(late, true);
    expect([f.h, f.m]).toEqual([3, 30]);
    expect(composeTime(f.day, f.h, f.m, f.s, f.ms, 0, true).getTime()).toBe(late.getTime());
  });

  it("composes a local time of day and the date of the calendar into the UTC time", () => {
    expect(iso(composeTime(day(2026, 11, 12), 12, 6, 7, 8, 0, true))).toBe("2026-11-12T05:06:07.008Z");
    expect(iso(composeTime(day(2026, 11, 12), 3, 0, 0, 0, 0, true))).toBe("2026-11-11T20:00:00.000Z");
    // UTC when `local` is off, or left out
    expect(iso(composeTime(day(2026, 11, 12), 12, 6, 7, 8, 0))).toBe("2026-11-12T12:06:07.008Z");
    expect(iso(composeTime(day(2026, 11, 12), 12, 6, 7, 8, 0, false))).toBe("2026-11-12T12:06:07.008Z");
  });

  it("the slider is added to the local time as to the UTC one", () => {
    expect(iso(composeTime(day(2026, 11, 12), 23, 0, 0, 0, 0.1, true))).toBe("2026-11-12T18:24:00.000Z");
  });

  it("is invalid (NaN) for a day that is not a date", () => {
    expect(Number.isNaN(composeTime(new Date(NaN), 0, 0, 0, 0, 0, true).getTime())).toBe(true);
  });

  it("the carry of a spin button crosses the local midnight", () => {
    const f = changeField(fieldsFromTime(utc(2026, 11, 12, 16, 59, 59, 999), true), "ms", ...wrapStep(1000, 0, 999));
    expect([iso(f.day), f.h, f.m, f.s, f.ms]).toEqual(["2026-11-13T00:00:00.000Z", 0, 0, 0, 0]);
    expect(iso(composeTime(f.day, f.h, f.m, f.s, f.ms, 0, true))).toBe("2026-11-12T17:00:00.000Z");
  });

  it("the fields of a running clock follow the module time in local time", () => {
    const running: ClockInfo = { state: "forward", throttle: 1, label: "Real-Time" };
    const m = observeClock(INITIAL_MODEL, running, utc(2026, 11, 12, 5, 6, 7, 456));
    expect(fieldsString(displayFields(m, utc(2000, 1, 1), true))).toBe("2026-11-12 12:6:7.0");
    expect(fieldsString(displayFields(m, utc(2000, 1, 1)))).toBe("2026-11-12 5:6:7.0");
  });

  it("an edit in local time is shown while it composes to the module time, and the time of the server's answer is the same", () => {
    const stopped: ClockInfo = { state: "stop", throttle: 1, label: "Manual Control" };
    const edited = { day: day(2026, 11, 12), h: 1, m: 2, s: 3, ms: 4 }; // 01:02:03.004 Bangkok = 18:02:03.004 UTC the day before
    const m = applyEdit(observeClock(INITIAL_MODEL, stopped, t), edited, 0, true);
    expect(iso(m.time!)).toBe("2026-11-11T18:02:03.004Z");
    expect(fieldsString(displayFields(m, t, true))).toBe("2026-11-12 1:2:3.4");
    // switching to UTC while the window is open: the edit no longer composes to the time, so the fields show the real time in UTC
    expect(fieldsString(displayFields(m, t, false))).toBe("2026-11-11 18:2:3.4");
  });
});

describe("changeField (the carry of a wrapped spin button)", () => {
  const start: TimeFields = fieldsFromTime(utc(2026, 11, 12, 10, 20, 30, 400));
  const show = (f: TimeFields) => `${f.day.toISOString().slice(0, 10)} ${f.h}:${f.m}:${f.s}.${f.ms}`;

  it("changes only the field when there is no carry", () => {
    expect(show(changeField(start, "s", 31, 0))).toBe("2026-11-12 10:20:31.400");
    expect(show(changeField(start, "ms", 401, 0))).toBe("2026-11-12 10:20:30.401");
  });

  it("Sec 59 -> 60 wraps to 0 and adds one to Min", () => {
    const f = changeField({ ...start, s: 59 }, "s", ...wrapStep(60, 0, 59));
    expect(show(f)).toBe("2026-11-12 10:21:0.400");
  });

  it("Msec 999 -> 1000 wraps to 0 and adds one to Sec", () => {
    const f = changeField({ ...start, ms: 999 }, "ms", ...wrapStep(1000, 0, 999));
    expect(show(f)).toBe("2026-11-12 10:20:31.0");
  });

  it("Hour 0 -> -1 wraps to 23 and takes one day off the calendar", () => {
    const f = changeField({ ...start, h: 0 }, "h", ...wrapStep(-1, 0, 23));
    expect(show(f)).toBe("2026-11-11 23:20:30.400");
  });

  it("Hour 23 -> 24 wraps to 0 and adds one day", () => {
    const f = changeField({ ...start, h: 23 }, "h", ...wrapStep(24, 0, 23));
    expect(show(f)).toBe("2026-11-13 0:20:30.400");
  });

  it("the carry goes all the way up: 23:59:59.999 + 1 ms is the next day, 00:00:00.000", () => {
    const f = changeField(fieldsFromTime(utc(2026, 12, 31, 23, 59, 59, 999)), "ms", ...wrapStep(1000, 0, 999));
    expect(show(f)).toBe("2027-01-01 0:0:0.0");
  });

  it("the carry goes all the way down: 00:00:00.000 - 1 ms is the day before, 23:59:59.999", () => {
    const f = changeField(fieldsFromTime(utc(2027, 1, 1)), "ms", ...wrapStep(-1, 0, 999));
    expect(show(f)).toBe("2026-12-31 23:59:59.999");
  });

  it("Min -1 at 00:00 goes back to 23:59 of the day before", () => {
    const f = changeField(fieldsFromTime(utc(2026, 3, 1)), "m", ...wrapStep(-1, 0, 59));
    expect(show(f)).toBe("2026-02-28 23:59:0.0");
  });
});

/** The [value, carry] arguments of changeField for a step to `raw`. */
function wrapStep(raw: number, min: number, max: number): [number, number] {
  const w = wrapSpin(raw, min, max);
  return [w.value, w.carry];
}

describe("monthGrid", () => {
  it("is 6 weeks of 7 days, Sunday first, and starts on the Sunday on or before the 1st", () => {
    const grid = monthGrid(day(2026, 11, 12)); // 1 Nov 2026 is a Sunday
    expect(grid).toHaveLength(42);
    expect(iso(grid[0]!)).toBe("2026-11-01T00:00:00.000Z");
    expect(iso(grid[41]!)).toBe("2026-12-12T00:00:00.000Z");
    expect(grid.every((d) => d.getUTCDay() === grid.indexOf(d) % 7)).toBe(true);
  });

  it("starts in the month before when the 1st is not a Sunday", () => {
    const grid = monthGrid(day(2024, 2, 20)); // 1 Feb 2024 is a Thursday
    expect(iso(grid[0]!)).toBe("2024-01-28T00:00:00.000Z");
    expect(iso(grid[4]!)).toBe("2024-02-01T00:00:00.000Z");
    expect(iso(grid[32]!)).toBe("2024-02-29T00:00:00.000Z"); // leap year
  });
});

describe("shiftMonth and shiftYear", () => {
  it("keeps the day of the month", () => {
    expect(iso(shiftMonth(day(2026, 11, 12), 1))).toBe("2026-12-12T00:00:00.000Z");
    expect(iso(shiftMonth(day(2026, 11, 12), -1))).toBe("2026-10-12T00:00:00.000Z");
  });

  it("crosses the year", () => {
    expect(iso(shiftMonth(day(2026, 12, 15), 1))).toBe("2027-01-15T00:00:00.000Z");
    expect(iso(shiftMonth(day(2026, 1, 15), -1))).toBe("2025-12-15T00:00:00.000Z");
  });

  it("takes the last day of a shorter month", () => {
    expect(iso(shiftMonth(day(2026, 1, 31), 1))).toBe("2026-02-28T00:00:00.000Z");
    expect(iso(shiftMonth(day(2028, 1, 31), 1))).toBe("2028-02-29T00:00:00.000Z");
    expect(iso(shiftMonth(day(2026, 3, 31), -1))).toBe("2026-02-28T00:00:00.000Z");
  });

  it("shifts the year, 29 Feb becoming 28 Feb", () => {
    expect(iso(shiftYear(day(2026, 11, 12), 1))).toBe("2027-11-12T00:00:00.000Z");
    expect(iso(shiftYear(day(2028, 2, 29), 1))).toBe("2029-02-28T00:00:00.000Z");
    expect(iso(shiftYear(day(2028, 2, 29), -4))).toBe("2024-02-29T00:00:00.000Z");
  });
});

describe("the clock model", () => {
  const running: ClockInfo = { state: "forward", throttle: 1, label: "Real-Time" };
  const stopped: ClockInfo = { state: "stop", throttle: 1, label: "Manual Control" };
  const now = utc(2026, 11, 12, 7, 8, 9, 456);

  it("observing keeps the newest state and time", () => {
    const m = observeClock(INITIAL_MODEL, running, now);
    expect(m.clock).toEqual(running);
    expect(m.time?.getTime()).toBe(now.getTime());
  });

  it("shows the module time with the milliseconds cut off while the clock runs (Gpredict: Msec is always 0)", () => {
    const m = observeClock(INITIAL_MODEL, running, now);
    expect(fieldsString(displayFields(m, utc(2000, 1, 1)))).toBe("2026-11-12 7:8:9.0");
  });

  it("shows the module time exactly, milliseconds included, while the clock is stopped", () => {
    const m = observeClock(INITIAL_MODEL, stopped, now);
    expect(fieldsString(displayFields(m, utc(2000, 1, 1)))).toBe("2026-11-12 7:8:9.456");
  });

  it("shows the fallback time before anything is known", () => {
    expect(fieldsString(displayFields(INITIAL_MODEL, utc(2000, 1, 1, 1, 2, 3)))).toBe("2000-01-01 1:2:3.0");
  });

  it("an edit is shown while the clock is stopped at the time it composes to", () => {
    const edited = fieldsFromTime(utc(2026, 11, 12, 1, 2, 3, 4));
    const m = applyEdit(observeClock(INITIAL_MODEL, stopped, now), edited, 0.01);
    expect(m.clock?.state).toBe("stop");
    expect(m.clock?.label).toBe("Manual Control");
    expect(m.slider).toBe(0.01);
    expect(fieldsString(displayFields(m, now))).toBe("2026-11-12 1:2:3.4");
    // the server's answer: the stopped time is the composed one (edit + slider 0.01 day = 864 s)
    const answered = observeClock(m, stopped, composeTime(edited.day, edited.h, edited.m, edited.s, edited.ms, 0.01));
    expect(fieldsString(displayFields(answered, now))).toBe("2026-11-12 1:2:3.4");
    expect(answered.slider).toBe(0.01);
  });

  it("an edit made while the clock runs stops it, and the fields stay as they were shown", () => {
    const shown = displayFields(observeClock(INITIAL_MODEL, running, now), now); // 07:08:09.000
    const m = applyEdit(observeClock(INITIAL_MODEL, running, now), shown, 0.05);
    expect(m.clock?.state).toBe("stop");
    expect(fieldsString(displayFields(m, now))).toBe("2026-11-12 7:8:9.0");
  });

  it("when the server's time is not the edit's (an error, or another browser tab), the fields follow the server", () => {
    const edited = fieldsFromTime(utc(2026, 11, 12, 1, 2, 3, 4));
    const m = applyEdit(observeClock(INITIAL_MODEL, stopped, now), edited, 0);
    const other = observeClock(m, stopped, utc(2027, 1, 1, 5, 0, 0, 0));
    expect(fieldsString(displayFields(other, now))).toBe("2027-01-01 5:0:0.0");
  });

  it("an old edit is not shown when the clock runs and then stops somewhere else", () => {
    const edited = fieldsFromTime(utc(2026, 11, 12, 1, 2, 3, 4));
    let m = applyEdit(observeClock(INITIAL_MODEL, stopped, now), edited, 0);
    m = observeClock(m, running, utc(2026, 11, 12, 1, 2, 10, 0));
    m = observeClock(m, stopped, utc(2026, 11, 12, 1, 2, 12, 345));
    expect(fieldsString(displayFields(m, now))).toBe("2026-11-12 1:2:12.345");
  });

  it("failEdit forgets the edit, centres the slider and takes the throttle back from the clock", () => {
    const edited = fieldsFromTime(utc(2026, 11, 12, 1, 2, 3, 4));
    let m = observeClock(INITIAL_MODEL, { ...stopped, throttle: 7 }, now);
    m = { ...applyEdit(m, edited, 0.02), throttle: 50 };
    const failed = failEdit(m);
    expect(failed.edit).toBeNull();
    expect(failed.slider).toBe(0);
    expect(failed.throttle).toBe(7);
  });

  describe("the Throttle spin button", () => {
    it("takes the throttle of the clock at the first answer", () => {
      expect(observeClock(INITIAL_MODEL, { ...running, throttle: 25 }, now).throttle).toBe(25);
    });

    it("follows a change of the clock's throttle (reset, or another browser tab)", () => {
      let m = observeClock(INITIAL_MODEL, { ...running, throttle: 25 }, now);
      m = observeClock(m, { ...running, throttle: 1 }, now);
      expect(m.throttle).toBe(1);
    });

    it("keeps what the user is setting when the clock still says the old throttle", () => {
      let m = observeClock(INITIAL_MODEL, { ...running, throttle: 25 }, now);
      m = { ...m, throttle: 30 }; // the user stepped the spin button; the request is on its way
      m = observeClock(m, { ...running, throttle: 25 }, now); // a tick that left before the request arrived
      expect(m.throttle).toBe(30);
    });

    it("is left alone when the caller says an answer is not the last one (syncThrottle false)", () => {
      let m = observeClock(INITIAL_MODEL, { ...running, throttle: 25 }, now);
      m = { ...m, throttle: 30 };
      m = observeClock(m, { ...running, throttle: 27 }, now, false);
      expect(m.throttle).toBe(30);
    });
  });
});

function fieldsString(f: TimeFields): string {
  return `${f.day.toISOString().slice(0, 10)} ${f.h}:${f.m}:${f.s}.${f.ms}`;
}
