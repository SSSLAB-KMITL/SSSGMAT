import { describe, expect, it } from "vitest";
import type { SatState } from "../types";
import { cursorText, nextEventText, selectedText } from "./polarText";

const T = "2026-11-12T07:00:00.000Z";
const NOW = Date.parse(T);
const at = (sec: number) => new Date(NOW + sec * 1000).toISOString();

const sat = (over: Partial<SatState> = {}): SatState =>
  ({ norad: 25544, name: "ISS", az: 10, el: 20, dir: "↑", orbit: 1, next_aos: null, next_los: null, always: null, ...over }) as SatState;

describe("nextEventText (top right)", () => {
  it("is 'Next: <sat>' and 'in MM:SS' on two lines, for the satellite whose AOS comes first", () => {
    const sats = [sat({ norad: 1, name: "AO-91", next_aos: at(1800) }), sat({ norad: 2, name: "ISS", next_aos: at(330) })];
    expect(nextEventText(sats, NOW)).toBe("Next: ISS\nin 05:30");
  });

  it("is 'in HH:MM:SS' from one hour on", () => {
    expect(nextEventText([sat({ next_aos: at(3600 + 5 * 60 + 7) })], NOW)).toBe("Next: ISS\nin 01:05:07");
    expect(nextEventText([sat({ next_aos: at(3599) })], NOW)).toBe("Next: ISS\nin 59:59");
  });

  it("counts from the time of the tick, not from the wall clock", () => {
    const later = NOW + 60_000;
    expect(nextEventText([sat({ next_aos: at(330) })], later)).toBe("Next: ISS\nin 04:30");
  });

  it("is 'Next: N/A' when there is no upcoming AOS", () => {
    expect(nextEventText([], NOW)).toBe("Next: N/A");
    expect(nextEventText([sat({ next_aos: null }), sat({ norad: 2, next_aos: at(-5) })], NOW)).toBe("Next: N/A");
  });
});

describe("selectedText (bottom right)", () => {
  it("is '<sat>' and 'LOS in MM:SS' on two lines", () => {
    expect(selectedText(sat({ next_los: at(615) }), NOW)).toBe("ISS\nLOS in 10:15");
  });

  it("adds the hours field from one hour on", () => {
    expect(selectedText(sat({ next_los: at(3725) }), NOW)).toBe("ISS\nLOS in 01:02:05");
  });

  it("is '<sat>' and 'Always in range' for a satellite with no LOS", () => {
    expect(selectedText(sat({ always: "in", next_los: null }), NOW)).toBe("ISS\nAlways in range");
  });

  it("is null when no LOS is known (outside the computed window) or there is no satellite", () => {
    expect(selectedText(sat({ next_los: null, always: null }), NOW)).toBeNull();
    expect(selectedText(undefined, NOW)).toBeNull();
    expect(selectedText(sat({ next_los: "not a time" }), NOW)).toBeNull();
  });

  it("counts from the time of the tick", () => {
    expect(selectedText(sat({ next_los: at(615) }), NOW + 15_000)).toBe("ISS\nLOS in 10:00");
  });
});

describe("cursorText (bottom left)", () => {
  it("is 'AZ: %.0f°   EL: %.0f°' (three spaces) above the horizon", () => {
    expect(cursorText(123.4, 45.6)).toBe("AZ: 123°   EL: 46°");
    expect(cursorText(0, 89.9)).toBe("AZ: 0°   EL: 90°");
  });

  it("is null at or below the horizon", () => {
    expect(cursorText(10, 0)).toBeNull();
    expect(cursorText(10, -5)).toBeNull();
  });
});
