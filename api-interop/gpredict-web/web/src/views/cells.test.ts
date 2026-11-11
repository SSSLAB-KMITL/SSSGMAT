import { describe, expect, it } from "vitest";
import type { SatState, Tick } from "../types";
import { directionText, eventRows, inCanonicalOrder, isDecayed, listCell, nextEventOf, singleCell } from "./cells";

const T = new Date("2026-11-12T06:00:00Z");

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
    expect(listCell("Lat", s, T)).toBe("-33.46°");
    expect(listCell("Lon", s, T)).toBe("151.20°");
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
    expect(singleCell("SSP Lat.", s)).toBe("-33.46°");
    expect(singleCell("SSP Lon.", s)).toBe("151.20°");
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

  it("shows - for an empty locator and a field it does not know", () => {
    expect(singleCell("SSP Loc.", sat({ ssp: "" }))).toBe("-");
    expect(singleCell("Nonsense", sat())).toBe("-");
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
