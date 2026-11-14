import { describe, expect, it } from "vitest";
import { DEFAULT_NF } from "../numfmt";
import type { NumberFormat } from "../numfmt";
import { pinTimeZone } from "../pinTimeZone";
import type { SatState, Tick } from "../types";
import { directionText, eventRows, inCanonicalOrder, isDecayed, listCell, nextEventOf, singleCell } from "./cells";

const T = new Date("2026-11-12T06:00:00Z");
const nf = (over: Partial<NumberFormat> = {}): NumberFormat => ({ ...DEFAULT_NF, ...over });

/** A satellite 12 degrees above the horizon, approaching, that sets at 07:06:12 and rises again at 08:40:00. */
function sat(over: Partial<SatState> = {}): SatState {
  return {
    norad: 25544,
    name: "ISS",
    az: 210.4,
    el: 12.3,
    dir: "↑",
    ra: 123.456,
    dec: -12.345,
    range_km: 1530.2,
    range_rate_kms: -5.91,
    lat_deg: -33.456,
    lon_deg: 151.2,
    ssp: "QF56od",
    footprint_km: 4321.6,
    alt_km: 550.4,
    vel_kms: 7.5912,
    doppler_hz: 1971.3,
    loss_db: 136.1,
    delay_ms: 5.1,
    ma: 100.123,
    phase_deg: 45.678,
    orbit: 12345,
    vis: "D",
    next_aos: "2026-11-12T08:40:00.000Z",
    next_los: "2026-11-12T07:06:12.000Z",
    always: null,
    ...over,
  };
}

describe("listCell", () => {
  it("formats the numbers as Gpredict's list does (ref §4)", () => {
    const s = sat();
    expect(listCell("Satellite", s, T)).toBe("ISS");
    expect(listCell("Catnum", s, T)).toBe("25544");
    expect(listCell("Az", s, T)).toBe("210.40°");
    expect(listCell("El", s, T)).toBe("12.30°");
    expect(listCell("Dir", s, T)).toBe("↑");
    expect(listCell("Ra", s, T)).toBe("123.46°");
    expect(listCell("Dec", s, T)).toBe("-12.35°");
    expect(listCell("Lat", s, T)).toBe("-33.46° "); // the sign stays and the suffix is a space (ref-D 2.1)
    expect(listCell("Lon", s, T)).toBe("151.20° ");
    expect(listCell("SSP", s, T)).toBe("QF56od");
    expect(listCell("MA", s, T)).toBe("100.12°");
    expect(listCell("Phase", s, T)).toBe("45.68°");
    expect(listCell("Orbit", s, T)).toBe("12345");
  });

  it("prints distances and velocities with no unit (ref §4)", () => {
    const s = sat();
    expect(listCell("Range", s, T)).toBe("1530");
    expect(listCell("Footp", s, T)).toBe("4322");
    expect(listCell("Alt", s, T)).toBe("550");
    expect(listCell("Rate", s, T)).toBe("-5.910");
    expect(listCell("Vel", s, T)).toBe("7.591");
  });

  it("prints Doppler with 0 decimals and loss and delay with 2", () => {
    const s = sat();
    expect(listCell("Dop", s, T)).toBe("1971");
    expect(listCell("Loss", s, T)).toBe("136.10");
    expect(listCell("Del", s, T)).toBe("5.10");
  });

  it("shows the earlier of AOS and LOS as Next Event, in UTC", () => {
    expect(listCell("Next Event", sat(), T)).toBe("2026/11/12 07:06:12 (LOS)");
    expect(listCell("Next Event", sat({ next_aos: "2026-11-12T06:30:00Z", next_los: "2026-11-12T06:40:00Z" }), T)).toBe(
      "2026/11/12 06:30:00 (AOS)",
    );
  });

  it("shows --- N/A --- when there is no event", () => {
    expect(listCell("Next Event", sat({ next_aos: null, next_los: null }), T)).toBe("--- N/A ---");
    expect(listCell("Next AOS", sat({ next_aos: null }), T)).toBe("--- N/A ---");
    expect(listCell("Next LOS", sat({ next_los: null }), T)).toBe("--- N/A ---");
  });

  it("shows the only event there is, whichever it is", () => {
    // in a pass that ends in the window, the next pass is beyond it
    expect(listCell("Next Event", sat({ next_aos: null }), T)).toBe("2026/11/12 07:06:12 (LOS)");
    expect(listCell("Next Event", sat({ next_los: null }), T)).toBe("2026/11/12 08:40:00 (AOS)");
  });

  it("shows Next AOS and Next LOS in the time format", () => {
    expect(listCell("Next AOS", sat(), T)).toBe("2026/11/12 08:40:00");
    expect(listCell("Next LOS", sat(), T)).toBe("2026/11/12 07:06:12");
  });

  it("shows the visibility character, Status as Unknown and Decayed as empty", () => {
    expect(listCell("Vis", sat(), T)).toBe("D");
    expect(listCell("Vis", sat({ vis: "-" }), T)).toBe("-");
    expect(listCell("Status", sat(), T)).toBe("Unknown");
    expect(listCell("Decayed", sat(), T)).toBe("");
  });

  it("shows - for a number the server sent as null", () => {
    const s = sat({ az: null, range_km: null, range_rate_kms: null, doppler_hz: null });
    expect(listCell("Az", s, T)).toBe("-");
    expect(listCell("Range", s, T)).toBe("-");
    expect(listCell("Rate", s, T)).toBe("-");
    expect(listCell("Dop", s, T)).toBe("-");
  });

  it("is empty for a column it does not know", () => {
    expect(listCell("Nonsense", sat(), T)).toBe("");
  });
});

describe("list cells follow ref-D 2.1", () => {
  const miles = nf({ imperial: true });
  // 1609.344 km is exactly 1000 mi
  const far = sat({ range_km: 1609.344, range_rate_kms: -1.609344, footprint_km: 3218.688, alt_km: 804.672, vel_kms: 8.04672 });

  it("imperial: Range, Footp and Alt in miles with 0 decimals, Rate and Vel in mi/s with 3, no unit text", () => {
    expect(listCell("Range", far, T, miles)).toBe("1000");
    expect(listCell("Footp", far, T, miles)).toBe("2000");
    expect(listCell("Alt", far, T, miles)).toBe("500");
    expect(listCell("Rate", far, T, miles)).toBe("-1.000");
    expect(listCell("Vel", far, T, miles)).toBe("5.000");
    expect(listCell("Rate", sat(), T, miles)).toBe((-5.91 / 1.609344).toFixed(3));
  });

  it("metric (the default) keeps kilometres", () => {
    expect(listCell("Range", far, T)).toBe("1609");
    expect(listCell("Range", far, T, DEFAULT_NF)).toBe("1609");
    expect(listCell("Alt", far, T, nf({ nsew: true }))).toBe("805");
  });

  it("imperial leaves a missing number as -", () => {
    expect(listCell("Range", sat({ range_km: null, vel_kms: null }), T, miles)).toBe("-");
    expect(listCell("Vel", sat({ vel_kms: null }), T, miles)).toBe("-");
  });

  it("Lat and Lon end in a space while N/S/E/W is off, with a suffix instead of a sign when it is on", () => {
    const s = sat({ lat_deg: -13.75, lon_deg: 100.5 });
    expect(listCell("Lat", s, T)).toBe("-13.75° ");
    expect(listCell("Lon", s, T)).toBe("100.50° ");
    expect(listCell("Lat", s, T, nf({ nsew: true }))).toBe("13.75°S");
    expect(listCell("Lon", s, T, nf({ nsew: true }))).toBe("100.50°E");
    expect(listCell("Lon", sat({ lon_deg: -70.25 }), T, nf({ nsew: true }))).toBe("70.25°W");
  });

  it("a Lat or Lon that is missing is -", () => {
    expect(listCell("Lat", sat({ lat_deg: null }), T, nf({ nsew: true }))).toBe("-");
    expect(listCell("Lon", sat({ lon_deg: null }), T)).toBe("-");
  });

  it("angles and the other columns do not change with the number format", () => {
    const all = nf({ nsew: true, imperial: true, local: true, timeFormat: "%H" });
    for (const column of ["Az", "El", "Ra", "Dec", "MA", "Phase", "Dop", "Loss", "Del", "Orbit", "SSP", "Vis", "Dir"]) {
      expect(listCell(column, sat(), T, all), column).toBe(listCell(column, sat(), T));
    }
  });
});

describe("nextEventOf", () => {
  it("is LOS when LOS comes first, AOS when AOS does or when they are the same moment", () => {
    expect(nextEventOf(sat())).toEqual({ kind: "LOS", at: "2026-11-12T07:06:12.000Z" });
    expect(nextEventOf(sat({ next_aos: "2026-11-12T06:30:00Z", next_los: "2026-11-12T06:40:00Z" }))).toEqual({
      kind: "AOS",
      at: "2026-11-12T06:30:00Z",
    });
    expect(nextEventOf(sat({ next_aos: "2026-11-12T07:00:00Z", next_los: "2026-11-12T07:00:00Z" }))?.kind).toBe("AOS");
  });

  it("is null when there is neither", () => {
    expect(nextEventOf(sat({ next_aos: null, next_los: null }))).toBeNull();
  });
});

describe("singleCell", () => {
  it("formats the values with their units (ref §7)", () => {
    const s = sat();
    expect(singleCell("Slant Range", s)).toBe("1530 km");
    expect(singleCell("Range Rate", s)).toBe("-5.910 km/sec");
    expect(singleCell("Doppler@100M", s)).toBe("1971 Hz");
    expect(singleCell("Sig. Loss", s)).toBe("136.10 dB");
    expect(singleCell("Sig. Delay", s)).toBe("5.10 msec");
    expect(singleCell("Footprint", s)).toBe("4322 km");
    expect(singleCell("Altitude", s)).toBe("550 km");
    expect(singleCell("Velocity", s)).toBe("7.591 km/sec");
    expect(singleCell("Mean Anom.", s)).toBe("100.12°");
    expect(singleCell("Orbit Phase", s)).toBe("45.68°");
    expect(singleCell("Orbit Num.", s)).toBe("12345");
    expect(singleCell("SSP Loc.", s)).toBe("QF56od");
    expect(singleCell("SSP Lat.", s)).toBe("-33.46° ");
    expect(singleCell("SSP Lon.", s)).toBe("151.20° ");
  });

  it("pads angles to six characters like Gpredict's %6.2f", () => {
    expect(singleCell("Azimuth", sat())).toBe("210.40°");
    expect(singleCell("Azimuth", sat({ az: 5.2 }))).toBe("  5.20°");
    expect(singleCell("Elevation", sat({ el: -4.5 }))).toBe(" -4.50°");
    expect(singleCell("Right Asc.", sat())).toBe("123.46°");
    expect(singleCell("Declination", sat())).toBe("-12.35°");
  });

  it("says Approaching, Receding, Geostationary, Decayed or N/A for the direction", () => {
    expect(singleCell("Direction", sat({ dir: "↑" }))).toBe("Approaching");
    expect(singleCell("Direction", sat({ dir: "↓", range_rate_kms: 5.9 }))).toBe("Receding");
    expect(singleCell("Direction", sat({ dir: "G" }))).toBe("Geostationary");
    expect(singleCell("Direction", sat({ dir: "D" }))).toBe("Decayed");
  });

  it("decides a turning satellite by the sign of its range rate, N/A when there is none", () => {
    expect(directionText("↺", -0.0004)).toBe("Approaching");
    expect(directionText("↷", 0.0004)).toBe("Receding");
    expect(directionText("↷", 0)).toBe("N/A");
    expect(directionText("↷", null)).toBe("N/A");
    expect(directionText("?", 1)).toBe("N/A");
  });

  it("shows Next Event as AOS: or LOS: and the time, or N/A", () => {
    expect(singleCell("Next Event", sat())).toBe("LOS: 2026/11/12 07:06:12");
    expect(singleCell("Next Event", sat({ next_los: null }))).toBe("AOS: 2026/11/12 08:40:00");
    expect(singleCell("Next Event", sat({ next_aos: null, next_los: null }))).toBe("N/A");
  });

  it("shows Next AOS and Next LOS as times, or N/A", () => {
    expect(singleCell("Next AOS", sat())).toBe("2026/11/12 08:40:00");
    expect(singleCell("Next LOS", sat())).toBe("2026/11/12 07:06:12");
    expect(singleCell("Next AOS", sat({ next_aos: null }))).toBe("N/A");
    expect(singleCell("Next LOS", sat({ next_los: null }))).toBe("N/A");
  });

  it("spells out the visibility", () => {
    expect(singleCell("Visibility", sat({ vis: "-" }))).toBe("Unknown");
    expect(singleCell("Visibility", sat({ vis: "V" }))).toBe("Visible");
    expect(singleCell("Visibility", sat({ vis: "D" }))).toBe("Daylight");
    expect(singleCell("Visibility", sat({ vis: "E" }))).toBe("Eclipsed");
  });

  it("shows - for every field of a satellite that is not in the tick", () => {
    for (const field of [
      "Azimuth",
      "Elevation",
      "Direction",
      "Right Asc.",
      "Declination",
      "Slant Range",
      "Range Rate",
      "Next Event",
      "Next AOS",
      "Next LOS",
      "SSP Lat.",
      "SSP Lon.",
      "SSP Loc.",
      "Footprint",
      "Altitude",
      "Velocity",
      "Doppler@100M",
      "Sig. Loss",
      "Sig. Delay",
      "Mean Anom.",
      "Orbit Phase",
      "Orbit Num.",
      "Visibility",
    ]) {
      expect(singleCell(field, undefined), field).toBe("-");
    }
  });

  it("shows - for a number the server sent as null", () => {
    const s = sat({ az: null, range_km: null, loss_db: null, delay_ms: null, vel_kms: null });
    expect(singleCell("Azimuth", s)).toBe("-");
    expect(singleCell("Slant Range", s)).toBe("-");
    expect(singleCell("Sig. Loss", s)).toBe("-");
    expect(singleCell("Sig. Delay", s)).toBe("-");
    expect(singleCell("Velocity", s)).toBe("-");
  });

  it("single sat units", () => {
    const far = sat({ range_km: 1609.344, range_rate_kms: -1.609344, footprint_km: 3218.688, alt_km: 804.672, vel_kms: 8.04672 });
    const miles = nf({ imperial: true });
    expect(singleCell("Slant Range", far, miles)).toBe("1000 mi");
    expect(singleCell("Footprint", far, miles)).toBe("2000 mi");
    expect(singleCell("Altitude", far, miles)).toBe("500 mi");
    expect(singleCell("Range Rate", far, miles)).toBe("-1.000 mi/sec");
    expect(singleCell("Velocity", far, miles)).toBe("5.000 mi/sec");
    expect(singleCell("Velocity", sat(), miles)).toBe(`${(7.5912 / 1.609344).toFixed(3)} mi/sec`);
    // metric keeps km and km/sec
    expect(singleCell("Slant Range", far, DEFAULT_NF)).toBe("1609 km");
    expect(singleCell("Velocity", far, nf({ nsew: true }))).toBe("8.047 km/sec");
    // the other fields are not distances
    expect(singleCell("Doppler@100M", sat(), miles)).toBe("1971 Hz");
  });

  it("single sat shows - without a unit for a distance that is missing, in miles too", () => {
    expect(singleCell("Slant Range", sat({ range_km: null }), nf({ imperial: true }))).toBe("-");
    expect(singleCell("Velocity", sat({ vel_kms: null }), nf({ imperial: true }))).toBe("-");
  });

  it("SSP Lat. and SSP Lon. follow N/S/E/W like the list (%.2f then a suffix or a space)", () => {
    const s = sat({ lat_deg: -13.75, lon_deg: 100.5 });
    expect(singleCell("SSP Lat.", s, DEFAULT_NF)).toBe("-13.75° ");
    expect(singleCell("SSP Lat.", s, nf({ nsew: true }))).toBe("13.75°S");
    expect(singleCell("SSP Lon.", s, nf({ nsew: true }))).toBe("100.50°E");
    expect(singleCell("SSP Lon.", sat({ lon_deg: null }), nf({ nsew: true }))).toBe("-");
  });

  it("shows - for an empty locator and a field it does not know", () => {
    expect(singleCell("SSP Loc.", sat({ ssp: "" }))).toBe("-");
    expect(singleCell("Nonsense", sat())).toBe("-");
  });
});

describe("next event uses the time format and local time", () => {
  const next = sat(); // LOS 2026-11-12T07:06:12Z comes before AOS 08:40:00Z

  it("List: the format with ' (AOS)' or ' (LOS)' appended is what is formatted", () => {
    const f = nf({ timeFormat: "%d %b %H:%M" });
    expect(listCell("Next Event", next, T, f)).toBe("12 Nov 07:06 (LOS)");
    expect(listCell("Next AOS", next, T, f)).toBe("12 Nov 08:40");
    expect(listCell("Next LOS", next, T, f)).toBe("12 Nov 07:06");
  });

  it("List: the whole text is cut at 49 characters, the suffix with it", () => {
    const f = nf({ timeFormat: "%Y".repeat(12) }); // 48 characters, then " (LOS)" is cut to a space
    const text = listCell("Next Event", next, T, f);
    expect(text).toHaveLength(49);
    expect(text).toBe("2026".repeat(12) + " ");
    expect(listCell("Next AOS", next, T, nf({ timeFormat: "%Y".repeat(20) }))).toHaveLength(49);
  });

  it("Single sat: AOS: or LOS: before the time, which is cut at 49 characters on its own", () => {
    const f = nf({ timeFormat: "%H:%M %Z" });
    expect(singleCell("Next Event", next, f)).toBe("LOS: 07:06 UTC");
    expect(singleCell("Next AOS", next, f)).toBe("08:40 UTC");
    expect(singleCell("Next LOS", next, f)).toBe("07:06 UTC");
    expect(singleCell("Next Event", next, nf({ timeFormat: "%Y".repeat(20) }))).toBe(`LOS: ${"2026".repeat(20).slice(0, 49)}`);
  });

  it("the N/A texts stay when there is no event, whatever the format", () => {
    const none = sat({ next_aos: null, next_los: null });
    const f = nf({ timeFormat: "%H", local: true });
    expect(listCell("Next Event", none, T, f)).toBe("--- N/A ---");
    expect(listCell("Next AOS", none, T, f)).toBe("--- N/A ---");
    expect(singleCell("Next Event", none, f)).toBe("N/A");
    expect(singleCell("Next LOS", none, f)).toBe("N/A");
  });

  describe("in local time", () => {
    pinTimeZone("Asia/Bangkok");

    it("shows the time of the machine's zone", () => {
      const local = nf({ local: true });
      expect(listCell("Next Event", next, T, local)).toBe("2026/11/12 14:06:12 (LOS)");
      expect(listCell("Next AOS", next, T, local)).toBe("2026/11/12 15:40:00");
      expect(listCell("Next LOS", next, T, local)).toBe("2026/11/12 14:06:12");
      expect(singleCell("Next Event", next, local)).toBe("LOS: 2026/11/12 14:06:12");
      expect(singleCell("Next AOS", next, nf({ local: true, timeFormat: "%H:%M %z" }))).toBe("15:40 +0700");
    });

    it("and UTC when local time is off", () => {
      expect(listCell("Next Event", next, T, DEFAULT_NF)).toBe("2026/11/12 07:06:12 (LOS)");
    });
  });
});

describe("inCanonicalOrder", () => {
  const all = [
    { name: "Satellite", hint: "Satellite Name" },
    { name: "Az", hint: "Azimuth" },
    { name: "El", hint: "Elevation" },
    { name: "Dir", hint: "Direction" },
  ];

  it("keeps the canonical order whatever the order of the stored names", () => {
    expect(inCanonicalOrder(all, ["Dir", "Satellite", "El"]).map((c) => c.name)).toEqual(["Satellite", "El", "Dir"]);
  });

  it("drops names it does not know and keeps the hints", () => {
    expect(inCanonicalOrder(all, ["Az", "Nonsense"])).toEqual([{ name: "Az", hint: "Azimuth" }]);
  });

  it("is empty when nothing is visible", () => {
    expect(inCanonicalOrder(all, [])).toEqual([]);
  });
});

describe("isDecayed", () => {
  it("is true only for the D direction", () => {
    expect(isDecayed(sat({ dir: "D" }))).toBe(true);
    expect(isDecayed(sat({ dir: "G" }))).toBe(false);
    expect(isDecayed(sat())).toBe(false);
  });
});

describe("eventRows", () => {
  const NOW = "2026-11-12T06:00:00.000Z";
  const tick = (sats: SatState[] | undefined): Tick =>
    ({ t: NOW, status: sats === undefined ? "computing" : "ok", sats }) as unknown as Tick;

  it("counts down to LOS for a satellite above the horizon and to AOS for one below", () => {
    const rows = eventRows(
      tick([
        sat({ norad: 1, name: "UP", el: 10, next_los: "2026-11-12T06:10:30Z", next_aos: "2026-11-12T09:00:00Z" }),
        sat({ norad: 2, name: "DOWN", el: -10, next_los: "2026-11-12T08:00:00Z", next_aos: "2026-11-12T07:30:00Z" }),
      ]),
    );
    expect(rows.map((r) => [r.name, r.countdown])).toEqual([
      ["UP", "10:30"],
      ["DOWN", "01:30:00"],
    ]);
  });

  it("is ordered by the countdown, smallest first, and Never comes last", () => {
    const rows = eventRows(
      tick([
        sat({ norad: 1, name: "NEVER", el: -5, next_aos: null, next_los: null }),
        sat({ norad: 2, name: "LATE", el: -5, next_aos: "2026-11-12T10:00:00Z" }),
        sat({ norad: 3, name: "SOON", el: -5, next_aos: "2026-11-12T06:05:00Z" }),
        sat({ norad: 4, name: "NOW", el: 30, next_los: "2026-11-12T06:00:45Z" }),
      ]),
    );
    expect(rows.map((r) => r.name)).toEqual(["NOW", "SOON", "LATE", "NEVER"]);
    expect(rows.map((r) => r.countdown)).toEqual(["00:45", "05:00", "04:00:00", "Never"]);
  });

  it("says Never when there is no event on the side that counts", () => {
    const rows = eventRows(
      tick([
        // above the horizon, the pass has no known LOS: only the AOS of the next pass is known, and it does not count
        sat({ norad: 1, name: "UP", el: 10, next_los: null, next_aos: "2026-11-12T09:00:00Z" }),
        sat({ norad: 2, name: "DOWN", el: -10, next_aos: null, next_los: "2026-11-12T07:00:00Z" }),
      ]),
    );
    expect(rows.map((r) => r.countdown)).toEqual(["Never", "Never"]);
  });

  it("breaks a tie by name", () => {
    const rows = eventRows(
      tick([
        sat({ norad: 2, name: "B", el: -1, next_aos: "2026-11-12T07:00:00Z" }),
        sat({ norad: 1, name: "A", el: -1, next_aos: "2026-11-12T07:00:00Z" }),
      ]),
    );
    expect(rows.map((r) => r.name)).toEqual(["A", "B"]);
  });

  it("formats Az and El and makes the rows with El > 0 bold", () => {
    const rows = eventRows(
      tick([
        sat({ norad: 1, name: "UP", el: 0.01, az: 5.2 }),
        sat({ norad: 2, name: "ZERO", el: 0, next_aos: "2026-11-12T07:00:00Z" }),
        sat({ norad: 3, name: "DOWN", el: -3, next_aos: "2026-11-12T07:30:00Z" }),
      ]),
    );
    const up = rows.find((r) => r.name === "UP")!;
    expect(up).toMatchObject({ norad: 1, az: "5.20°", el: "0.01°", bold: true });
    expect(rows.find((r) => r.name === "ZERO")!.bold).toBe(false);
    expect(rows.find((r) => r.name === "DOWN")!.bold).toBe(false);
  });

  it("does not list decayed satellites, and is empty without satellites", () => {
    expect(eventRows(tick([sat({ dir: "D" })]))).toEqual([]);
    expect(eventRows(tick(undefined))).toEqual([]);
    expect(eventRows(tick([]))).toEqual([]);
  });

  it("has a countdown of 00:00 rather than a negative one", () => {
    const rows = eventRows(tick([sat({ el: -1, next_aos: "2026-11-12T05:59:59Z" })]));
    expect(rows[0]?.countdown).toBe("00:00");
  });
});
