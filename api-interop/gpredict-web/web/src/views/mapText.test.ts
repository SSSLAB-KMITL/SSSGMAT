import { describe, expect, it } from "vitest";
import type { SatState } from "../types";
import { cursorText, nextEvent, nextEventText, NEXT_PENDING, qthInfoText, selectedEventText } from "./mapText";

const T = "2026-11-12T07:00:00.000Z";
const NOW = Date.parse(T);
const at = (sec: number) => new Date(NOW + sec * 1000).toISOString();

const sat = (over: Partial<SatState> = {}): SatState => ({
  norad: 25544,
  name: "ISS",
  az: 10,
  el: -20,
  dir: "↑",
  ra: 0,
  dec: 0,
  range_km: 5000,
  range_rate_kms: 0,
  lat_deg: 10,
  lon_deg: 20,
  ssp: "JJ00aa",
  footprint_km: 4540,
  alt_km: 418,
  vel_kms: 7.66,
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
});

describe("nextEventText (top right)", () => {
  it("is 'Next: <sat> in MM:SS' for the satellite whose AOS comes first, counted from module time", () => {
    const sats = [
      sat({ norad: 1, name: "AO-91", next_aos: at(1800) }),
      sat({ norad: 2, name: "ISS", next_aos: at(330) }),
      sat({ norad: 3, name: "NOAA 19", next_aos: at(900) }),
    ];
    expect(nextEventText(sats, NOW)).toBe("Next: ISS in 05:30");
    expect(nextEvent(sats, NOW)).toEqual({ sat: sats[1], seconds: 330 });
  });

  it("is 'Next: <sat> in HH:MM:SS' when more than 59 minutes away, MM:SS up to 59:59", () => {
    expect(nextEventText([sat({ next_aos: at(3600 + 5 * 60) })], NOW)).toBe("Next: ISS in 01:05:00");
    expect(nextEventText([sat({ next_aos: at(3599) })], NOW)).toBe("Next: ISS in 59:59");
    expect(nextEventText([sat({ next_aos: at(3600) })], NOW)).toBe("Next: ISS in 01:00:00");
  });

  it("is 'Next: N/A' when no satellite has an upcoming AOS", () => {
    expect(nextEventText([], NOW)).toBe("Next: N/A");
    expect(nextEventText([sat({ next_aos: null }), sat({ norad: 2, always: "in" })], NOW)).toBe("Next: N/A");
    expect(nextEvent([], NOW)).toBeNull();
  });

  it("ignores a decayed satellite and an AOS that is not ahead of module time", () => {
    const sats = [sat({ norad: 1, name: "DEAD", dir: "D", next_aos: at(10) }), sat({ norad: 2, name: "OLD", next_aos: at(-5) }), sat({ norad: 3, name: "OK", next_aos: at(700) })];
    expect(nextEventText(sats, NOW)).toBe("Next: OK in 11:40");
  });

  it("counts from module time, not the wall clock: the same tick always gives the same text", () => {
    const sats = [sat({ next_aos: at(61) })];
    expect(nextEventText(sats, NOW)).toBe("Next: ISS in 01:01");
    expect(nextEventText(sats, NOW + 60_000)).toBe("Next: ISS in 00:01");
  });

  it("shows ' ... ' before there is anything to show", () => {
    expect(NEXT_PENDING).toBe(" ... ");
  });
});

describe("selectedEventText (bottom right)", () => {
  it("below the horizon: ' <sat> AOS in MM:SS '", () => {
    expect(selectedEventText(sat({ el: -5, next_aos: at(125) }), NOW)).toBe(" ISS AOS in 02:05 ");
  });

  it("above the horizon: ' <sat> LOS in MM:SS '", () => {
    expect(selectedEventText(sat({ el: 12, next_aos: at(6000), next_los: at(61) }), NOW)).toBe(" ISS LOS in 01:01 ");
    expect(selectedEventText(sat({ el: 0, next_los: at(30) }), NOW)).toBe(" ISS LOS in 00:30 ");
  });

  it("adds the hours field when an hour or more away", () => {
    expect(selectedEventText(sat({ el: -5, next_aos: at(3600 + 61) }), NOW)).toBe(" ISS AOS in 01:01:01 ");
  });

  it("always in range / always out of range: ' <sat>: Always in range ' / ' <sat>: Always out of range '", () => {
    expect(selectedEventText(sat({ name: "GOES 16", always: "in", el: 30 }), NOW)).toBe(" GOES 16: Always in range ");
    expect(selectedEventText(sat({ name: "GOES 16", always: "out", el: -30 }), NOW)).toBe(" GOES 16: Always out of range ");
  });

  it("is nothing when there is no satellite or no event to count down to", () => {
    expect(selectedEventText(undefined, NOW)).toBeNull();
    expect(selectedEventText(sat({ el: -5 }), NOW)).toBeNull();
    expect(selectedEventText(sat({ el: 5 }), NOW)).toBeNull();
  });
});

describe("cursorText (bottom left)", () => {
  it("is ' LON:%.0f° LAT:%.0f° '", () => {
    expect(cursorText(13.7, 100.4)).toBe(" LON:100° LAT:14° ");
    expect(cursorText(-33.5, -70.6)).toBe(" LON:-71° LAT:-34° ");
    expect(cursorText(0, 0)).toBe(" LON:0° LAT:0° ");
  });
});

describe("qthInfoText (top left)", () => {
  it("is ' <name> · <location> '", () => {
    expect(qthInfoText({ name: "THBK", location: "Bangkok, Thailand" })).toBe(" THBK · Bangkok, Thailand ");
  });
});
