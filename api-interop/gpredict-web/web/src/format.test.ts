import { describe, expect, it } from "vitest";
import { fmtCountdown, fmtFixed, formatTime } from "./format";
import { pinTimeZone } from "./pinTimeZone";
import fixture from "./strftime.fixture.json";

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

describe("formatTime against Python's strftime in the C locale (tools/strftime_fixture.py)", () => {
  pinTimeZone(fixture.tz);

  it("formatTime matches Python strftime in locale C", () => {
    const wrong = fixture.cases
      .map((c) => ({ ...c, got: formatTime(new Date(c.iso), c.fmt, c.local) }))
      .filter((c) => c.got !== c.out)
      .map((c) => `${c.local ? "local" : "UTC"} ${c.iso} ${JSON.stringify(c.fmt)}: want ${JSON.stringify(c.out)}, got ${JSON.stringify(c.got)}`);
    expect(wrong).toEqual([]);
  });

  it("covers every code of spec 3.2 in UTC and in local time, in and out of daylight saving time", () => {
    const codes = [..."aAbBcCdDeFHIjklmMnprRStTuUVwWgGyYxXzZ%"];
    for (const local of [false, true]) {
      const rows = fixture.cases.filter((c) => c.local === local);
      for (const code of codes) expect(rows.some((c) => c.fmt === `%${code}`), `${local} %${code}`).toBe(true);
    }
    const zones = fixture.cases.filter((c) => c.local && c.fmt === "%Z").map((c) => c.out);
    expect(zones).toContain("EST");
    expect(zones).toContain("EDT");
  });

  it("formatTime leaves unknown codes, a trailing % and truncates to 49", () => {
    const d = new Date(Date.UTC(2026, 10, 12, 5, 6, 7));
    expect(formatTime(d, "%Q")).toBe("%Q");
    expect(formatTime(d, "abc%")).toBe("abc%");
    expect(formatTime(d, "%")).toBe("%");
    expect(formatTime(d, "%%%")).toBe("%%");
    expect(formatTime(d, "%Ey %-d %_H %5Y")).toBe("%Ey %-d %_H %5Y");
    expect(formatTime(d, "%Y".repeat(20))).toHaveLength(49);
    expect(formatTime(d, "%Y".repeat(20))).toBe("2026".repeat(20).slice(0, 49));
    expect(formatTime(d, "x".repeat(60))).toBe("x".repeat(49));
    expect(formatTime(d, "x".repeat(49))).toBe("x".repeat(49));
    expect(formatTime(d, "x".repeat(48) + "%H")).toBe("x".repeat(48) + "0");
    expect(formatTime(d, "")).toBe("");
  });

  it("does not cut a character in two when it truncates", () => {
    const d = new Date(Date.UTC(2026, 10, 12, 5, 6, 7));
    const text = formatTime(d, "x".repeat(48) + "\u{1F6F0}\u{1F6F0}");
    expect([...text]).toHaveLength(49);
    expect(text.endsWith("\u{1F6F0}")).toBe(true);
  });

  it("%Z is UTC in UTC time", () => {
    expect(formatTime(new Date(Date.UTC(2026, 0, 1)), "%Z %z")).toBe("UTC +0000");
  });
});

describe("formatTime in local time", () => {
  pinTimeZone("Asia/Bangkok");

  it("local time", () => {
    const d = new Date("2026-11-12T05:06:07Z");
    expect(formatTime(d, "%H %z", true)).toBe("12 +0700");
    expect(formatTime(d, "%H %z", false)).toBe("05 +0000");
    expect(formatTime(d, undefined, true)).toBe("2026/11/12 12:06:07");
  });

  it("moves the date with the time of day", () => {
    const d = new Date("2026-12-31T20:30:00Z"); // 03:30 on 1 January in Bangkok
    expect(formatTime(d, "%Y-%m-%d %j %a", true)).toBe("2027-01-01 001 Fri");
    expect(formatTime(d, "%Y-%m-%d %j %a", false)).toBe("2026-12-31 365 Thu");
  });

  it("%Z names the zone with the short name of Intl", () => {
    const zone = formatTime(new Date("2026-11-12T05:06:07Z"), "%Z", true);
    expect(zone).not.toBe("");
    expect(zone).not.toBe("%Z");
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
