import { describe, expect, it } from "vitest";
import type { SatState } from "../types";
import { nextSort, sortSats } from "./listSort";

function sat(norad: number, name: string, over: Partial<SatState> = {}): SatState {
  return {
    norad,
    name,
    az: 0,
    el: 0,
    dir: "↑",
    ra: 0,
    dec: 0,
    range_km: 1000,
    range_rate_kms: 0,
    lat_deg: 0,
    lon_deg: 0,
    ssp: "AA00aa",
    footprint_km: 0,
    alt_km: 500,
    vel_kms: 7,
    doppler_hz: 0,
    loss_db: 0,
    delay_ms: 0,
    ma: 0,
    phase_deg: 0,
    orbit: 1,
    vis: "-",
    next_aos: null,
    next_los: null,
    always: null,
    ...over,
  };
}

const names = (sats: SatState[]) => sats.map((s) => s.name);

describe("sortSats", () => {
  it("sorts by name, ignoring case and reading numbers by value", () => {
    const sats = [sat(1, "gps 10"), sat(2, "GPS 2"), sat(3, "Beidou"), sat(4, "ISS")];
    expect(names(sortSats(sats, "Satellite", true))).toEqual(["Beidou", "GPS 2", "gps 10", "ISS"]);
    expect(names(sortSats(sats, "Satellite", false))).toEqual(["ISS", "gps 10", "GPS 2", "Beidou"]);
  });

  it("sorts numeric columns by value, not by text", () => {
    const sats = [sat(1, "A", { range_km: 100 }), sat(2, "B", { range_km: 20 }), sat(3, "C", { range_km: 3 })];
    expect(names(sortSats(sats, "Range", true))).toEqual(["C", "B", "A"]);
    expect(names(sortSats(sats, "Range", false))).toEqual(["A", "B", "C"]);
    const orbits = [sat(1, "A", { orbit: 100 }), sat(2, "B", { orbit: 9 })];
    expect(names(sortSats(orbits, "Orbit", true))).toEqual(["B", "A"]);
    const catnums = [sat(100, "A"), sat(9, "B")];
    expect(names(sortSats(catnums, "Catnum", true))).toEqual(["B", "A"]);
  });

  it("puts a missing number last, whichever way it sorts", () => {
    const sats = [sat(1, "A", { az: null }), sat(2, "B", { az: 30 }), sat(3, "C", { az: 10 })];
    expect(names(sortSats(sats, "Az", true))).toEqual(["C", "B", "A"]);
    expect(names(sortSats(sats, "Az", false))).toEqual(["B", "C", "A"]);
  });

  it("sorts Next AOS and Next LOS by time, with the ones without an event last", () => {
    const sats = [
      sat(1, "NONE", { next_aos: null, next_los: null }),
      // "...:00.500Z" is before "...:00Z" as text ('.' < 'Z') but after it as time
      sat(2, "B", { next_aos: "2026-11-12T08:40:00.500Z", next_los: "2026-11-12T09:00:00Z" }),
      sat(3, "A", { next_aos: "2026-11-12T08:40:00Z", next_los: "2026-11-12T10:00:00Z" }),
    ];
    expect(names(sortSats(sats, "Next AOS", true))).toEqual(["A", "B", "NONE"]);
    expect(names(sortSats(sats, "Next AOS", false))).toEqual(["B", "A", "NONE"]);
    expect(names(sortSats(sats, "Next LOS", true))).toEqual(["B", "A", "NONE"]);
    expect(names(sortSats(sats, "Next LOS", false))).toEqual(["A", "B", "NONE"]);
  });

  it("sorts Next Event by the time of the next event", () => {
    const sats = [
      sat(1, "NONE"),
      sat(2, "LATE", { next_aos: "2026-11-12T12:00:00Z", next_los: "2026-11-12T13:00:00Z" }),
      // in a pass: its LOS is the next event, although its AOS is later than the others' events
      sat(3, "SETS", { next_aos: "2026-11-12T15:00:00Z", next_los: "2026-11-12T07:00:00Z" }),
      sat(4, "ONLY_LOS", { next_los: "2026-11-12T09:00:00Z" }),
    ];
    expect(names(sortSats(sats, "Next Event", true))).toEqual(["SETS", "ONLY_LOS", "LATE", "NONE"]);
    expect(names(sortSats(sats, "Next Event", false))).toEqual(["LATE", "ONLY_LOS", "SETS", "NONE"]);
  });

  it("sorts text columns as text", () => {
    const sats = [sat(1, "A", { vis: "V" }), sat(2, "B", { vis: "D" }), sat(3, "C", { vis: "E" })];
    expect(names(sortSats(sats, "Vis", true))).toEqual(["B", "C", "A"]);
    const ssp = [sat(1, "A", { ssp: "QF56od" }), sat(2, "B", { ssp: "JO65ab" })];
    expect(names(sortSats(ssp, "SSP", true))).toEqual(["B", "A"]);
  });

  it("keeps equal rows in order of name and then NORAD number, in either direction", () => {
    const sats = [sat(3, "B", { el: 5 }), sat(2, "A", { el: 5 }), sat(1, "A", { el: 5 })];
    expect(sortSats(sats, "El", true).map((s) => s.norad)).toEqual([1, 2, 3]);
    expect(sortSats(sats, "El", false).map((s) => s.norad)).toEqual([1, 2, 3]);
  });

  it("sorts by name for a column with no values to tell rows apart (Status, Decayed) or one it does not know", () => {
    const sats = [sat(1, "B"), sat(2, "A")];
    for (const column of ["Status", "Decayed", "Nonsense"]) {
      expect(names(sortSats(sats, column, true)), column).toEqual(["A", "B"]);
    }
  });

  it("does not change the list it is given", () => {
    const sats = [sat(1, "B"), sat(2, "A")];
    sortSats(sats, "Satellite", true);
    expect(names(sats)).toEqual(["B", "A"]);
  });
});

describe("nextSort", () => {
  it("toggles the direction of the sorted column", () => {
    expect(nextSort({ column: "Satellite", ascending: true }, "Satellite")).toEqual({ column: "Satellite", ascending: false });
    expect(nextSort({ column: "Satellite", ascending: false }, "Satellite")).toEqual({ column: "Satellite", ascending: true });
  });

  it("sorts another column ascending", () => {
    expect(nextSort({ column: "Satellite", ascending: false }, "El")).toEqual({ column: "El", ascending: true });
  });
});
