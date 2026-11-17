import { describe, expect, it } from "vitest";
import { pinTimeZone } from "./pinTimeZone";
import {
  DEFAULT_NF,
  distance,
  fmtLatLon,
  fmtTimeNf,
  FT_PER_M,
  ftToM,
  KM_PER_MI,
  mToFt,
  numberFormatOf,
} from "./numfmt";
import type { NumberFormat } from "./numfmt";

const nf = (over: Partial<NumberFormat> = {}): NumberFormat => ({ ...DEFAULT_NF, ...over });

describe("numberFormatOf", () => {
  it("the defaults are Gpredict's: UTC, %Y/%m/%d %H:%M:%S, signs, metric", () => {
    expect(DEFAULT_NF).toEqual({ local: false, timeFormat: "%Y/%m/%d %H:%M:%S", nsew: false, imperial: false });
    expect(numberFormatOf(null)).toEqual(DEFAULT_NF);
    expect(numberFormatOf({})).toEqual(DEFAULT_NF);
  });

  it("reads the four keys of Preferences", () => {
    expect(
      numberFormatOf({
        "GLOBAL/USE_LOCAL_TIME": true,
        "GLOBAL/TIME_FORMAT": "%H:%M",
        "GLOBAL/USE_NSEW": true,
        "GLOBAL/USE_IMPERIAL": true,
        "GLOBAL/OTHER": 3,
      }),
    ).toEqual({ local: true, timeFormat: "%H:%M", nsew: true, imperial: true });
  });

  it("keeps an empty format (Gpredict then shows an empty text) and ignores values of the wrong type", () => {
    expect(numberFormatOf({ "GLOBAL/TIME_FORMAT": "" }).timeFormat).toBe("");
    expect(numberFormatOf({ "GLOBAL/TIME_FORMAT": 5, "GLOBAL/USE_NSEW": "yes", "GLOBAL/USE_IMPERIAL": 1 })).toEqual(DEFAULT_NF);
  });
});

describe("fmtTimeNf", () => {
  it("formats an ISO time or a Date in the time format, in UTC", () => {
    expect(fmtTimeNf("2026-11-12T05:06:07Z", DEFAULT_NF)).toBe("2026/11/12 05:06:07");
    expect(fmtTimeNf(new Date("2026-11-12T05:06:07Z"), nf({ timeFormat: "%d %b %Y" }))).toBe("12 Nov 2026");
  });

  it("shows the placeholder of Gpredict's preview for a time it cannot read", () => {
    expect(fmtTimeNf("not a time", DEFAULT_NF)).toBe("--/--/-- --:--:--");
  });

  describe("in local time", () => {
    pinTimeZone("Asia/Bangkok");

    it("uses the time zone of the machine", () => {
      expect(fmtTimeNf("2026-11-12T05:06:07Z", nf({ local: true }))).toBe("2026/11/12 12:06:07");
      expect(fmtTimeNf("2026-11-12T05:06:07Z", nf({ local: true, timeFormat: "%H %z" }))).toBe("12 +0700");
    });
  });
});

describe("fmtLatLon", () => {
  it("lat/lon", () => {
    expect(fmtLatLon(-13.75, "lat", 2, nf())).toBe("-13.75° ");
    expect(fmtLatLon(-13.75, "lat", 2, nf({ nsew: true }))).toBe("13.75°S");
    expect(fmtLatLon(100.5, "lon", 2, nf({ nsew: true }))).toBe("100.50°E");
  });

  it("with the signs on, the text ends in a space (Gpredict's %c of ' ')", () => {
    expect(fmtLatLon(13.75, "lat", 2, nf())).toBe("13.75° ");
    expect(fmtLatLon(-100.5, "lon", 4, nf())).toBe("-100.5000° ");
  });

  it("N and E for zero and above, S and W below", () => {
    expect(fmtLatLon(0, "lat", 2, nf({ nsew: true }))).toBe("0.00°N");
    expect(fmtLatLon(0, "lon", 2, nf({ nsew: true }))).toBe("0.00°E");
    expect(fmtLatLon(13.75, "lat", 2, nf({ nsew: true }))).toBe("13.75°N");
    expect(fmtLatLon(-100.5, "lon", 2, nf({ nsew: true }))).toBe("100.50°W");
  });

  it("decides the side before it rounds, as C does", () => {
    expect(fmtLatLon(-0.001, "lat", 2, nf({ nsew: true }))).toBe("0.00°S");
    expect(fmtLatLon(-0.001, "lat", 2, nf())).toBe("-0.00° ");
  });

  it("the digits are the caller's: 0 for the map grid, 4 for the ground stations", () => {
    expect(fmtLatLon(-30, "lat", 0, nf())).toBe("-30° ");
    expect(fmtLatLon(-30, "lat", 0, nf({ nsew: true }))).toBe("30°S");
    expect(fmtLatLon(-96.9, "lon", 0, nf({ nsew: true }))).toBe("97°W");
    expect(fmtLatLon(13.7563, "lat", 4, nf({ nsew: true }))).toBe("13.7563°N");
  });

  it("is - for a value that is missing", () => {
    expect(fmtLatLon(null, "lat", 2, nf())).toBe("-");
    expect(fmtLatLon(null, "lon", 2, nf({ nsew: true }))).toBe("-");
    expect(fmtLatLon(Number.NaN, "lon", 2, nf())).toBe("-");
  });
});

describe("distance and the conversions of gpredict-utils.h", () => {
  it("has Gpredict's constants", () => {
    expect(KM_PER_MI).toBe(1.609344);
    expect(FT_PER_M).toBe(3.2808399);
  });

  it("keeps kilometres in metric and converts to miles in imperial", () => {
    expect(distance(1609.344, DEFAULT_NF)).toBe(1609.344);
    expect(distance(1609.344, nf({ imperial: true }))).toBeCloseTo(1000, 9);
    expect(distance(-5.91, nf({ imperial: true }))).toBeCloseTo(-5.91 / 1.609344, 12);
  });

  it("is null for a distance that is missing", () => {
    expect(distance(null, DEFAULT_NF)).toBeNull();
    expect(distance(null, nf({ imperial: true }))).toBeNull();
  });

  it("metres to feet is 3.2808399 x, and back", () => {
    expect(mToFt(100)).toBeCloseTo(328.08399, 9);
    expect(ftToM(mToFt(123.4))).toBeCloseTo(123.4, 9);
    expect(mToFt(0)).toBe(0);
  });
});
