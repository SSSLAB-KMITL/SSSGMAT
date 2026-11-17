import { describe, expect, test } from "vitest";
import { formatTime, parseOffset } from "../../src/time/format";
import { parseIsoUtc, parseTime } from "../../src/time/parse";

test("UTCG matches the STK manual example", () => {
  expect(formatTime(new Date("2026-01-01T16:00:00Z"), "UTCG", "+07:00")).toBe("1 Jan 2026 16:00:00.000 UTCG");
});

test("LTZG shifts by the offset, crosses midnight and keeps milliseconds", () => {
  expect(formatTime(new Date("2026-11-12T07:00:00Z"), "LTZG", "+07:00")).toBe("12 Nov 2026 14:00:00.000 LTZG+07:00");
  expect(formatTime(new Date("2026-11-12T20:30:00.500Z"), "LTZG", "+07:00")).toBe("13 Nov 2026 03:30:00.500 LTZG+07:00");
  expect(formatTime(new Date("2026-01-01T03:00:00Z"), "LTZG", "-05:00")).toBe("31 Dec 2025 22:00:00.000 LTZG-05:00");
});

test("parse inverts format to the millisecond", () => {
  for (const iso of ["2026-11-12T07:00:00.123Z", "2026-02-28T23:59:59.999Z", "2024-02-29T00:00:00.000Z"])
    for (const f of ["UTCG", "LTZG"] as const)
      expect(parseTime(formatTime(new Date(iso), f, "+07:00"), f, "+07:00")?.toISOString()).toBe(iso);
});

test("parse accepts a missing suffix, a 1-digit day and a lowercase month", () => {
  expect(parseTime("1 jan 2026 16:00:00", "UTCG", "+07:00")?.toISOString()).toBe("2026-01-01T16:00:00.000Z");
  expect(parseTime("12 Nov 2026 14:00:00.000", "LTZG", "+07:00")?.toISOString()).toBe("2026-11-12T07:00:00.000Z");
  expect(parseTime("12 Nov 2026 14:00:00 LTZG+05:00", "LTZG", "+07:00")?.toISOString()).toBe("2026-11-12T09:00:00.000Z");
});

test("parse rejects garbage, impossible dates and the other format", () => {
  for (const s of ["", "tomorrow", "31 Feb 2026 00:00:00", "12 Nov 2026 24:00:00", "12 Nov 2026 07:00:00.1234",
                   "2026-11-12T07:00:00Z", "12 Nov 2026 07:00:00.000 LTZG+07:00"])
    expect(parseTime(s, "UTCG", "+07:00")).toBeNull();
});

describe("format details", () => {
  test("times before 1970 use floor arithmetic", () => {
    expect(formatTime(new Date("1969-12-31T23:59:59.999Z"), "UTCG", "+07:00")).toBe("31 Dec 1969 23:59:59.999 UTCG");
    expect(formatTime(new Date("1969-12-31T20:00:00.000Z"), "LTZG", "+07:00")).toBe("1 Jan 1970 03:00:00.000 LTZG+07:00");
  });

  test("matches the UTC fields of Date over two centuries, including every leap day", () => {
    const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const p = (n: number, w = 2) => String(n).padStart(w, "0");
    // 2^27 ms is not a whole number of days, so the sweep hits every time of day
    for (let ms = Date.UTC(1900, 0, 1); ms < Date.UTC(2100, 0, 1); ms += 134_217_731) {
      const d = new Date(ms);
      const want = `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}.${p(d.getUTCMilliseconds(), 3)} UTCG`;
      expect(formatTime(d, "UTCG", "+07:00")).toBe(want);
    }
    for (const iso of ["1900-03-01T00:00:00.000Z", "2000-02-29T12:00:00.000Z", "2100-03-01T00:00:00.000Z", "2100-02-28T23:59:59.999Z"]) {
      const d = new Date(iso);
      expect(parseTime(formatTime(d, "UTCG", "+07:00"), "UTCG", "+07:00")?.toISOString()).toBe(iso);
    }
  });

  test("an invalid Date prints as Invalid Date and a malformed LTZ offset falls back to a UTCG label", () => {
    expect(formatTime(new Date(NaN), "UTCG", "+07:00")).toBe("Invalid Date");
    expect(formatTime(new Date("2026-11-12T07:00:00Z"), "LTZG", "seven")).toBe("12 Nov 2026 07:00:00.000 UTCG");
  });
});

describe("parse details", () => {
  test("fractions of 1 to 3 digits are read as decimals of a second", () => {
    expect(parseTime("12 Nov 2026 07:00:00.5", "UTCG", "+07:00")?.toISOString()).toBe("2026-11-12T07:00:00.500Z");
    expect(parseTime("12 Nov 2026 07:00:00.05", "UTCG", "+07:00")?.toISOString()).toBe("2026-11-12T07:00:00.050Z");
    expect(parseTime("12 Nov 2026 07:00:00.007", "UTCG", "+07:00")?.toISOString()).toBe("2026-11-12T07:00:00.007Z");
  });

  test("surrounding spaces, repeated spaces and a lowercase suffix are tolerated", () => {
    expect(parseTime("  12   NOV  2026  07:00:00.000   utcg ", "UTCG", "+07:00")?.toISOString()).toBe("2026-11-12T07:00:00.000Z");
    expect(parseTime("12 Nov 2026 14:00:00.000 ltzg+07:00", "LTZG", "+07:00")?.toISOString()).toBe("2026-11-12T07:00:00.000Z");
  });

  test("a suffix that names the other format is rejected both ways", () => {
    expect(parseTime("12 Nov 2026 07:00:00 UTCG", "LTZG", "+07:00")).toBeNull();
    expect(parseTime("12 Nov 2026 07:00:00 UTCG+07:00", "UTCG", "+07:00")).toBeNull();
  });

  test("LTZG: bare LTZG suffix uses the units offset, a negative offset in the text is honoured", () => {
    expect(parseTime("12 Nov 2026 14:00:00 LTZG", "LTZG", "+07:00")?.toISOString()).toBe("2026-11-12T07:00:00.000Z");
    expect(parseTime("31 Dec 2025 22:00:00.000 LTZG-05:00", "LTZG", "+07:00")?.toISOString()).toBe("2026-01-01T03:00:00.000Z");
  });

  test("LTZG: a bad offset in the text, or a bad units offset with none in the text, gives null", () => {
    expect(parseTime("12 Nov 2026 14:00:00 LTZG+25:00", "LTZG", "+07:00")).toBeNull();
    expect(parseTime("12 Nov 2026 14:00:00 LTZG+07:60", "LTZG", "+07:00")).toBeNull();
    expect(parseTime("12 Nov 2026 14:00:00", "LTZG", "seven")).toBeNull();
    expect(parseTime("12 Nov 2026 14:00:00 LTZG+07:00", "LTZG", "seven")?.toISOString()).toBe("2026-11-12T07:00:00.000Z");
  });

  test("calendar limits: leap days, month ends, minutes and seconds", () => {
    expect(parseTime("29 Feb 2024 00:00:00", "UTCG", "+07:00")?.toISOString()).toBe("2024-02-29T00:00:00.000Z");
    for (const s of ["29 Feb 2026 00:00:00", "29 Feb 2100 00:00:00", "31 Apr 2026 00:00:00", "0 Jan 2026 00:00:00",
                     "32 Jan 2026 00:00:00", "1 Foo 2026 00:00:00", "1 Jan 2026 00:60:00", "1 Jan 2026 00:00:60",
                     "1 Jan 26 00:00:00", "1 Jan 2026 0:00:00", "1 Jan 2026 00:00", "1 Jan 2026 00:00:00."])
      expect(parseTime(s, "UTCG", "+07:00"), s).toBeNull();
    expect(parseTime("29 Feb 2000 00:00:00", "UTCG", "+07:00")?.toISOString()).toBe("2000-02-29T00:00:00.000Z");
  });
});

describe("parseOffset", () => {
  test("returns minutes east of UTC for hh:mm with a sign", () => {
    expect(parseOffset("+07:00")).toBe(420);
    expect(parseOffset("-05:30")).toBe(-330);
    expect(parseOffset("+00:00")).toBe(0);
    expect(Object.is(parseOffset("-00:00"), 0)).toBe(true);
  });
  test("rejects anything else", () => {
    for (const s of ["", "07:00", "+7:00", "+07", "+24:00", "+07:60", "+07:00 ", "UTC"]) expect(parseOffset(s), s).toBeNull();
  });
});

describe("parseIsoUtc (API times)", () => {
  test("reads Z times with and without fractional seconds", () => {
    expect(parseIsoUtc("2026-11-12T07:00:00Z")?.toISOString()).toBe("2026-11-12T07:00:00.000Z");
    expect(parseIsoUtc("2026-11-12T07:00:00.250Z")?.toISOString()).toBe("2026-11-12T07:00:00.250Z");
    expect(parseIsoUtc("2026-11-12T07:00:00.123456Z")?.toISOString()).toBe("2026-11-12T07:00:00.123Z");
  });
  test("reads +hh:mm and -hh:mm offsets as the same instant as the Z form", () => {
    const cases: Array<[string, string]> = [
      ["2026-11-12T14:00:00+07:00", "2026-11-12T07:00:00.000Z"],
      ["2026-11-12T00:00:00-05:00", "2026-11-12T05:00:00.000Z"],
      ["2026-11-12T12:30:00.250+05:30", "2026-11-12T07:00:00.250Z"],
      ["2026-11-12T07:00:00.123456+00:00", "2026-11-12T07:00:00.123Z"],
      ["2026-11-12T07:00:00-00:00", "2026-11-12T07:00:00.000Z"],
      ["2026-01-01T03:00:00+07:00", "2025-12-31T20:00:00.000Z"], // crosses the year to the west
      ["2025-12-31T22:00:00-05:00", "2026-01-01T03:00:00.000Z"], // crosses the year to the east
      ["2024-03-01T05:00:00+07:00", "2024-02-29T22:00:00.000Z"], // leap day
      ["2026-11-12T23:59:59.999-23:59", "2026-11-13T23:58:59.999Z"],
    ];
    for (const [text, utc] of cases) expect(parseIsoUtc(text)?.toISOString(), text).toBe(utc);
  });
  test("rejects bad parts in offset forms too, and offsets that are not +-hh:mm", () => {
    for (const s of ["2026-13-01T00:00:00+07:00", "2026-11-32T00:00:00+07:00", "2026-11-12T24:00:00+07:00", "2026-11-12T07:60:00-05:00",
                     "2026-11-12T07:00:60+07:00", "2026-02-30T00:00:00-05:00", "2026-11-12T07:00:00+24:00", "2026-11-12T07:00:00+07:60",
                     "2026-11-12T07:00:00+0700", "2026-11-12T07:00:00+07", "2026-11-12T07:00:00 +07:00", "2026-11-12T07:00:00Z+07:00",
                     "2026-11-12T07:00:00+7:00", "2026-11-12T07:00:00z"])
      expect(parseIsoUtc(s), s).toBeNull();
  });
  test("rejects a missing zone, impossible dates and other shapes", () => {
    for (const s of ["", "2026-11-12T07:00:00", "2026-02-30T00:00:00Z", "2026-11-12T24:00:00Z",
                     "2026-11-12 07:00:00Z", "12 Nov 2026 07:00:00.000 UTCG", "2026-13-01T00:00:00Z", "2026-00-10T00:00:00Z",
                     "2026-11-00T00:00:00Z", "2026-11-12T07:60:00Z", "2026-11-12T07:00:60Z"])
      expect(parseIsoUtc(s), s).toBeNull();
  });
});

test("the suite runs in a DST time zone that is not UTC, so a local-time getter would fail it", () => {
  const jan = new Date("2026-01-15T12:00:00Z").getTimezoneOffset();
  const jul = new Date("2026-07-15T12:00:00Z").getTimezoneOffset();
  expect(jan).not.toBe(0);
  expect(jul).not.toBe(jan);
});
