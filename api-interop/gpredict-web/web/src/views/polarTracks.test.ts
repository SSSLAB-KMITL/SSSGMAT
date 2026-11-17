import { describe, expect, it } from "vitest";
import type { SatState } from "../types";
import { planSkyFetches, SKY_RETRY_MS, skyKey, skyTrackWanted, type SkyRequest } from "./polarTracks";

const START = "2026-11-12T05:00:00.000Z";
const LOS1 = "2026-11-12T07:10:00.000Z";
const LOS2 = "2026-11-12T08:45:00.000Z";
const sat = (norad: number, over: Partial<SatState> = {}): SatState =>
  ({ norad, name: `S${norad}`, az: 10, el: 20, dir: "↑", orbit: 1, next_aos: null, next_los: LOS1, always: null, ...over }) as SatState;
const plan = (over: Partial<Parameters<typeof planSkyFetches>[0]> & { requested?: Map<number, SkyRequest> } = {}) =>
  planSkyFetches({ enabled: [1], auto: false, sats: [sat(1), sat(2)], windowStart: START, requested: new Map(), nowMs: 1_000_000, ...over });

describe("skyKey", () => {
  it("changes with the window start and with the satellite's pass (its LOS)", () => {
    const base = skyKey(START, sat(1));
    expect(skyKey(START, sat(1))).toBe(base);
    expect(skyKey("2026-11-12T06:00:00.000Z", sat(1))).not.toBe(base);
    expect(skyKey(START, sat(1, { next_los: LOS2 }))).not.toBe(base);
    expect(skyKey(START, sat(1, { next_los: null, always: "in" }))).not.toBe(base);
  });
});

describe("skyTrackWanted", () => {
  it("wants a satellite above the horizon that is in sky_track, or any one when auto is on", () => {
    expect(skyTrackWanted(sat(1), new Set([1]), false)).toBe(true);
    expect(skyTrackWanted(sat(2), new Set([1]), false)).toBe(false);
    expect(skyTrackWanted(sat(2), new Set([1]), true)).toBe(true);
  });

  it("does not want one at or below the horizon, without a position, decayed or GEO", () => {
    expect(skyTrackWanted(sat(1, { el: 0 }), new Set([1]), true)).toBe(false);
    expect(skyTrackWanted(sat(1, { el: -3 }), new Set([1]), true)).toBe(false);
    expect(skyTrackWanted(sat(1, { el: null }), new Set([1]), true)).toBe(false);
    expect(skyTrackWanted(sat(1, { dir: "D" }), new Set([1]), true)).toBe(false);
    expect(skyTrackWanted(sat(1, { dir: "G" }), new Set([1]), true)).toBe(false);
  });
});

describe("planSkyFetches", () => {
  it("fetches the track of the enabled satellites above the horizon, once", () => {
    const first = plan();
    expect(first.fetch).toEqual([{ norad: 1, key: skyKey(START, sat(1)) }]);
    expect(first.drop).toEqual([]);
    const requested = new Map<number, SkyRequest>([[1, { key: skyKey(START, sat(1)), failedAt: null }]]);
    expect(plan({ requested })).toEqual({ fetch: [], drop: [] });
  });

  it("fetches every satellite above the horizon when auto is on, but not GEO ones", () => {
    const sats = [sat(1), sat(2), sat(3, { dir: "G" }), sat(4, { el: -5 })];
    expect(plan({ auto: true, sats }).fetch.map((f) => f.norad)).toEqual([1, 2]);
  });

  it("fetches again when the pass changes (the satellite rose again, so its LOS is a new one)", () => {
    const requested = new Map<number, SkyRequest>([[1, { key: skyKey(START, sat(1)), failedAt: null }]]);
    const p = plan({ requested, sats: [sat(1, { next_los: LOS2 })] });
    expect(p.fetch).toEqual([{ norad: 1, key: skyKey(START, sat(1, { next_los: LOS2 })) }]);
  });

  it("fetches again when the window start changes", () => {
    const requested = new Map<number, SkyRequest>([[1, { key: skyKey(START, sat(1)), failedAt: null }]]);
    expect(plan({ requested, windowStart: "2026-11-12T06:00:00.000Z" }).fetch.map((f) => f.norad)).toEqual([1]);
  });

  it("does not ask again at once after a failure (404, error), but 10 s or more later", () => {
    const key = skyKey(START, sat(1));
    const failed = new Map<number, SkyRequest>([[1, { key, failedAt: 1_000_000 }]]);
    expect(plan({ requested: failed, nowMs: 1_000_000 + 1 }).fetch).toEqual([]);
    expect(plan({ requested: failed, nowMs: 1_000_000 + SKY_RETRY_MS - 1 }).fetch).toEqual([]);
    expect(plan({ requested: failed, nowMs: 1_000_000 + SKY_RETRY_MS }).fetch).toEqual([{ norad: 1, key }]);
  });

  it("a new pass is not held back by the failure of the old one", () => {
    const failed = new Map<number, SkyRequest>([[1, { key: skyKey(START, sat(1)), failedAt: 1_000_000 }]]);
    expect(plan({ requested: failed, nowMs: 1_000_001, sats: [sat(1, { next_los: LOS2 })] }).fetch.map((f) => f.norad)).toEqual([1]);
  });

  it("drops what was held for a satellite that is no longer wanted (set, switched off, GEO), so that it is fetched again when it rises", () => {
    const requested = new Map<number, SkyRequest>([
      [1, { key: skyKey(START, sat(1)), failedAt: null }],
      [2, { key: skyKey(START, sat(2)), failedAt: null }],
      [9, { key: "x", failedAt: null }],
    ]);
    const p = plan({ requested, enabled: [1, 2], sats: [sat(1), sat(2, { el: -4 })] });
    expect(p.fetch).toEqual([]);
    expect(p.drop.sort()).toEqual([2, 9]);
  });
});
