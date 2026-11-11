import { describe, expect, it } from "vitest";
import { fmtCountdown, fmtFixed, formatTime } from "./format";

describe("formatTime", () => {
  const d = new Date(Date.UTC(2026, 10, 12, 7, 5, 9)); // 2026-11-12 07:05:09 UTC

  it("uses Gpredict's default format %Y/%m/%d %H:%M:%S", () => {
    expect(formatTime(d)).toBe("2026/11/12 07:05:09");
  });

  it("supports every code of the Time format tooltip: %Y %m %d %j %H %M %S", () => {
    expect(formatTime(d, "%Y")).toBe("2026");
    expect(formatTime(d, "%m")).toBe("11");
    expect(formatTime(d, "%d")).toBe("12");
    expect(formatTime(d, "%j")).toBe("316"); // 304 days to the end of October + 12
    expect(formatTime(d, "%H")).toBe("07");
    expect(formatTime(d, "%M")).toBe("05");
    expect(formatTime(d, "%S")).toBe("09");
    expect(formatTime(d, "%Y-%j %H:%M:%S")).toBe("2026-316 07:05:09");
  });

  it("is always UTC, whatever the machine's time zone", () => {
    // 23:59:59 UTC is already the next day in UTC+7: the UTC date must still be the 12th
    const late = new Date(Date.UTC(2026, 10, 12, 23, 59, 59));
    expect(formatTime(late)).toBe("2026/11/12 23:59:59");
    const early = new Date(Date.UTC(2026, 10, 12, 0, 0, 0));
    expect(formatTime(early)).toBe("2026/11/12 00:00:00");
  });

  it("%j is the day of the year, three digits, leap years included", () => {
    expect(formatTime(new Date(Date.UTC(2026, 0, 1)), "%j")).toBe("001");
    expect(formatTime(new Date(Date.UTC(2026, 11, 31)), "%j")).toBe("365");
    expect(formatTime(new Date(Date.UTC(2024, 11, 31)), "%j")).toBe("366");
    expect(formatTime(new Date(Date.UTC(2024, 2, 1)), "%j")).toBe("061");
  });

  it("pads month, day and time fields to two digits", () => {
    expect(formatTime(new Date(Date.UTC(2026, 0, 2, 3, 4, 5)))).toBe("2026/01/02 03:04:05");
  });

  it("keeps %% as a literal percent sign and leaves unknown codes alone", () => {
    expect(formatTime(d, "%H%%")).toBe("07%");
    expect(formatTime(d, "%Q %H")).toBe("%Q 07");
    expect(formatTime(d, "no codes")).toBe("no codes");
  });

  it("shows the placeholder of Gpredict's preview for an invalid date", () => {
    expect(formatTime(new Date(NaN))).toBe("--/--/-- --:--:--");
  });
});

describe("fmtCountdown", () => {
  it("is MM:SS below one hour", () => {
    expect(fmtCountdown(0)).toBe("00:00");
    expect(fmtCountdown(5)).toBe("00:05");
    expect(fmtCountdown(59 * 60 + 59)).toBe("59:59");
  });

  it("is HH:MM:SS from one hour on", () => {
    expect(fmtCountdown(3600)).toBe("01:00:00");
    expect(fmtCountdown(3600 + 61)).toBe("01:01:01");
    expect(fmtCountdown(27 * 3600 + 5)).toBe("27:00:05");
  });

  it("drops fractions of a second", () => {
    expect(fmtCountdown(59.9)).toBe("00:59");
    expect(fmtCountdown(3599.99)).toBe("59:59");
  });

  it("does not go below zero and does not invent a number for garbage", () => {
    expect(fmtCountdown(-4)).toBe("00:00");
    expect(fmtCountdown(Number.NaN)).toBe("--:--");
    expect(fmtCountdown(Number.POSITIVE_INFINITY)).toBe("--:--");
  });
});

describe("fmtFixed", () => {
  it("formats like C's %.nf", () => {
    expect(fmtFixed(210.4, 2)).toBe("210.40");
    expect(fmtFixed(1530.2, 0)).toBe("1530");
    expect(fmtFixed(-5.91, 3)).toBe("-5.910");
    expect(fmtFixed(0, 2)).toBe("0.00");
  });

  it("shows '-' (the Single sat placeholder) for a missing or non-finite value", () => {
    expect(fmtFixed(null, 2)).toBe("-");
    expect(fmtFixed(undefined, 2)).toBe("-");
    expect(fmtFixed(Number.NaN, 2)).toBe("-");
    expect(fmtFixed(Number.POSITIVE_INFINITY, 2)).toBe("-");
  });
});
