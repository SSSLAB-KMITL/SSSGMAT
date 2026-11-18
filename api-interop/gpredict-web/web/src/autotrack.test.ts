import { describe, expect, it } from "vitest";
import { autotrackTarget } from "./autotrack";
import type { SatState, Tick } from "./types";

const NOW = "2026-11-12T07:00:00.000Z";
const at = (minutes: number) => new Date(Date.parse(NOW) + minutes * 60_000).toISOString();

const sat = (norad: number, el: number | null, nextAos: string | null = null, over: Partial<SatState> = {}): SatState =>
  ({ norad, name: `S${norad}`, el, next_aos: nextAos, always: null, dir: "↑", ...over }) as SatState;

const tick = (sats: SatState[], over: Partial<Tick> = {}): Tick => ({ t: NOW, status: "ok", sats, ...over }) as Tick;

describe("autotrackTarget (ref §2, gtk-sat-module.c update_autotrack)", () => {
  it("keeps the selection while that satellite is still above the horizon", () => {
    expect(autotrackTarget(tick([sat(1, 5), sat(2, 60)]), 1)).toBe(1);
  });

  it("selects the satellite above the horizon when the selection is below it", () => {
    expect(autotrackTarget(tick([sat(1, -5, at(10)), sat(2, 20)]), 1)).toBe(2);
  });

  it("selects the highest of several satellites above the horizon", () => {
    expect(autotrackTarget(tick([sat(1, 5), sat(2, 60), sat(3, 30)]), null)).toBe(2);
  });

  it("with none above the horizon, selects the one with the earliest AOS", () => {
    expect(autotrackTarget(tick([sat(1, -5, at(40)), sat(2, -20, at(5)), sat(3, -1, at(90))]), null)).toBe(2);
  });

  it("ignores AOS in the past, missing AOS and AOS more than 10 days away", () => {
    const sats = [sat(1, -5, at(-3)), sat(2, -5, null), sat(3, -5, at(11 * 24 * 60)), sat(4, -5, at(600))];
    expect(autotrackTarget(tick(sats), null)).toBe(4);
  });

  it("treats El = 0 as not above the horizon, like a missing El", () => {
    expect(autotrackTarget(tick([sat(1, 0, at(30)), sat(2, null, at(20))]), null)).toBe(2);
  });

  it("keeps the selection when no satellite has an AOS either", () => {
    expect(autotrackTarget(tick([sat(1, -5), sat(2, -9)]), 2)).toBe(2);
    expect(autotrackTarget(tick([sat(1, -5), sat(2, -9)]), null)).toBeNull();
  });

  it("selects a satellite when the selected one is not in the tick any more", () => {
    expect(autotrackTarget(tick([sat(2, 20)]), 99)).toBe(2);
  });

  it("changes nothing without an ok tick", () => {
    expect(autotrackTarget(null, 5)).toBe(5);
    expect(autotrackTarget(tick([sat(1, 50)], { status: "computing" }), 5)).toBe(5);
    expect(autotrackTarget({ ...tick([]), sats: undefined }, null)).toBeNull();
  });
});
