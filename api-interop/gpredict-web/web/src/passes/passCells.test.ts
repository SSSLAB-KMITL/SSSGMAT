import { describe, expect, it } from "vitest";
import { MULTI_PASS_CHECKS, SINGLE_PASS_CHECKS } from "../prefs/predictPrefs";
import { fmtDuration, MULTI_COLUMNS, passCell, rowCell, SINGLE_COLUMNS } from "./passCells";
import type { PassRow, PassSummary } from "./types";

/** A row of the Data tab with a value in every column. */
function row(over: Partial<PassRow> = {}): PassRow {
  return {
    t: "2026-11-12T05:06:07.000Z",
    az: 12.345,
    el: 45.678,
    ra: 123.456,
    dec: -12.345,
    range_km: 1234.56,
    rate_kms: -5.4321,
    lat_deg: -13.75,
    lon_deg: 100.5,
    ssp: "OK86ab",
    footprint_km: 4321.6,
    alt_km: 550.4,
    vel_kms: 7.5912,
    doppler_hz: -2345.6,
    loss_db: 136.123,
    delay_ms: 5.1234,
    ma: 128,
    phase_deg: 45.678,
    vis: "V",
    ...over,
  };
}

/** A pass of 1 h 2 min 5.9 s that is visible at its start and eclipsed at its end. */
function pass(over: Partial<PassSummary> = {}): PassSummary {
  return {
    orbit: 12345,
    aos: "2026-11-12T05:00:00.000Z",
    tca: "2026-11-12T05:31:00.000Z",
    los: "2026-11-12T06:02:05.900Z",
    max_el: 67.891,
    aos_az: 10.004,
    max_el_az: 95.5,
    los_az: 181.236,
    vis: "V-E",
    ...over,
  };
}

describe("rowCell", () => {
  it("degree columns", () => {
    const r = row();
    expect(rowCell(r, "Az")).toBe("12.35°");
    expect(rowCell(r, "El")).toBe("45.68°");
    expect(rowCell(r, "Ra")).toBe("123.46°");
    expect(rowCell(r, "Dec")).toBe("-12.35°");
    expect(rowCell(r, "Phase")).toBe("45.68°");
  });

  it("range and footprint have no unit", () => {
    const r = row();
    expect(rowCell(r, "Range")).toBe("1235");
    expect(rowCell(r, "Footp")).toBe("4322");
    expect(rowCell(r, "Alt")).toBe("550");
    expect(rowCell(r, "Rate")).toBe("-5.432");
    expect(rowCell(r, "Vel")).toBe("7.591");
  });

  it("lat/lon signed with trailing space", () => {
    const r = row();
    expect(rowCell(r, "Lat")).toBe("-13.75° ");
    expect(rowCell(r, "Lon")).toBe("100.50° ");
    expect(rowCell(row({ lat_deg: 51.5 }), "Lat")).toBe("51.50° ");
  });

  it("doppler, loss, delay", () => {
    const r = row();
    expect(rowCell(r, "Dop")).toBe("-2346");
    expect(rowCell(r, "Loss")).toBe("136.12");
    expect(rowCell(r, "Del")).toBe("5.12");
  });

  it("MA uses the 256 scale with a degree sign", () => {
    expect(rowCell(row({ ma: 128 }), "MA")).toBe("128.00°");
  });

  it("time column uses the default format in UTC", () => {
    expect(rowCell(row(), "Time")).toBe("2026/11/12 05:06:07");
  });

  it("SSP and Vis are the server's text", () => {
    expect(rowCell(row(), "SSP")).toBe("OK86ab");
    expect(rowCell(row({ vis: "E" }), "Vis")).toBe("E");
  });

  it("a missing number shows as - like the core views", () => {
    const r = row({
      az: null, el: null, ra: null, dec: null, range_km: null, rate_kms: null, lat_deg: null, lon_deg: null,
      footprint_km: null, alt_km: null, vel_kms: null, doppler_hz: null, loss_db: null, delay_ms: null, ma: null, phase_deg: null,
    });
    for (const c of SINGLE_COLUMNS) {
      if (c.title === "Time" || c.title === "SSP" || c.title === "Vis") continue;
      expect(rowCell(r, c.title), c.title).toBe("-");
    }
  });

  it("every column of the table has a cell and an unknown one is empty", () => {
    for (const c of SINGLE_COLUMNS) expect(rowCell(row(), c.title), c.title).not.toBe("");
    expect(rowCell(row(), "Nope")).toBe("");
  });
});

describe("fmtDuration", () => {
  it("duration", () => {
    expect(fmtDuration(3725.9)).toBe("01:02:05");
    expect(fmtDuration(0)).toBe("- N/A -");
  });

  it("truncates the seconds and pads each part to two digits", () => {
    expect(fmtDuration(59.999)).toBe("00:00:59");
    expect(fmtDuration(0.4)).toBe("00:00:00");
    expect(fmtDuration(600)).toBe("00:10:00");
    expect(fmtDuration(360_000)).toBe("100:00:00");
  });

  it("is N/A when there is no number", () => {
    expect(fmtDuration(Number.NaN)).toBe("- N/A -");
  });
});

describe("passCell", () => {
  it("pass vis and orbit", () => {
    expect(passCell(pass(), "Vis")).toBe("V-E");
    expect(passCell(pass(), "Orbit")).toBe("12345");
  });

  it("times use the default format in UTC", () => {
    expect(passCell(pass(), "AOS")).toBe("2026/11/12 05:00:00");
    expect(passCell(pass(), "TCA")).toBe("2026/11/12 05:31:00");
    expect(passCell(pass(), "LOS")).toBe("2026/11/12 06:02:05");
  });

  it("duration comes from LOS minus AOS", () => {
    expect(passCell(pass(), "Duration")).toBe("01:02:05");
    expect(passCell(pass({ los: "2026-11-12T05:00:00.000Z" }), "Duration")).toBe("- N/A -");
  });

  it("elevation and azimuth columns", () => {
    expect(passCell(pass(), "Max El")).toBe("67.89°");
    expect(passCell(pass(), "AOS Az")).toBe("10.00°");
    expect(passCell(pass(), "Max El Az")).toBe("95.50°");
    expect(passCell(pass(), "LOS Az")).toBe("181.24°");
  });

  it("a missing number shows as -", () => {
    const p = pass({ max_el: null, aos_az: null, max_el_az: null, los_az: null });
    for (const title of ["Max El", "AOS Az", "Max El Az", "LOS Az"]) expect(passCell(p, title), title).toBe("-");
  });

  it("every column of the table has a cell and an unknown one is empty", () => {
    for (const c of MULTI_COLUMNS) expect(passCell(pass(), c.title), c.title).not.toBe("");
    expect(passCell(pass(), "Nope")).toBe("");
  });
});

describe("column tables", () => {
  it("Data tab: 19 columns in Gpredict's fixed order", () => {
    expect(SINGLE_COLUMNS.map((c) => c.title)).toEqual([
      "Time", "Az", "El", "Ra", "Dec", "Range", "Rate", "Lat", "Lon", "SSP",
      "Footp", "Alt", "Vel", "Dop", "Loss", "Del", "MA", "Phase", "Vis",
    ]);
  });

  it("Data tab alignment (ref-P §2.2)", () => {
    const align = Object.fromEntries(SINGLE_COLUMNS.map((c) => [c.title, c.align]));
    expect(align).toEqual({
      Time: "center", Az: "right", El: "right", Ra: "right", Dec: "right", Range: "right", Rate: "right", Lat: "right",
      Lon: "right", SSP: "left", Footp: "right", Alt: "right", Vel: "left", Dop: "right", Loss: "left", Del: "left",
      MA: "right", Phase: "right", Vis: "center",
    });
  });

  it("Upcoming passes: 10 columns with hint and alignment (ref-P §3.2)", () => {
    expect(MULTI_COLUMNS.map((c) => [c.title, c.hint, c.align])).toEqual([
      ["AOS", "Acquisition of signal (AOS)", "center"],
      ["TCA", "Time of Closest Approach (TCA)", "center"],
      ["LOS", "Loss of signal (LOS)", "center"],
      ["Duration", "Duration of pass", "center"],
      ["Max El", "Maximum elevation", "right"],
      ["AOS Az", "Azimuth at AOS", "right"],
      ["Max El Az", "Az at max. elevation", "right"],
      ["LOS Az", "Azimuth at LOS", "right"],
      ["Orbit", "Orbit number", "right"],
      ["Vis", "Visibility during pass", "center"],
    ]);
  });

  it("the hints are the labels of the Visible Columns check boxes of Preferences", () => {
    expect(SINGLE_COLUMNS.map((c) => [c.title, c.hint])).toEqual(SINGLE_PASS_CHECKS.map((c) => [c.name, c.label]));
    expect(MULTI_COLUMNS.map((c) => [c.title, c.hint])).toEqual(MULTI_PASS_CHECKS.map((c) => [c.name, c.label]));
  });
});
