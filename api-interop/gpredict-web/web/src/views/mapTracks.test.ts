import { describe, expect, it } from "vitest";
import type { SatState } from "../types";
import { planTrackFetches, trackKey } from "./mapTracks";

const sat = (norad: number, orbit: number): SatState => ({ norad, orbit }) as SatState;
const START = "2026-11-12T05:00:00.000Z";

describe("trackKey", () => {
  it("changes with the window, the orbit number and the number of orbits", () => {
    const base = trackKey(START, 100, 3);
    expect(trackKey(START, 100, 3)).toBe(base);
    expect(trackKey("2026-11-12T06:00:00.000Z", 100, 3)).not.toBe(base);
    expect(trackKey(START, 101, 3)).not.toBe(base);
    expect(trackKey(START, 100, 4)).not.toBe(base);
  });
});

describe("planTrackFetches", () => {
  const sats = [sat(25544, 100), sat(43013, 7)];

  it("fetches the track of every satellite whose Ground Track is on, once", () => {
    const requested = new Map<number, string>();
    const first = planTrackFetches([25544], sats, START, 3, requested);
    expect(first.fetch).toEqual([{ norad: 25544, key: trackKey(START, 100, 3) }]);
    expect(first.drop).toEqual([]);
    requested.set(25544, trackKey(START, 100, 3));
    expect(planTrackFetches([25544], sats, START, 3, requested)).toEqual({ fetch: [], drop: [] });
  });

  it("fetches again when the window start changes (a new GMAT window)", () => {
    const requested = new Map([[25544, trackKey(START, 100, 3)]]);
    const plan = planTrackFetches([25544], sats, "2026-11-12T06:00:00.000Z", 3, requested);
    expect(plan.fetch.map((f) => f.norad)).toEqual([25544]);
  });

  it("fetches again when the satellite starts a new orbit (the track begins at the start of the current orbit)", () => {
    const requested = new Map([[25544, trackKey(START, 100, 3)]]);
    expect(planTrackFetches([25544], [sat(25544, 101)], START, 3, requested).fetch.map((f) => f.norad)).toEqual([25544]);
  });

  it("fetches a track that was just switched on, not the ones already held", () => {
    const requested = new Map([[25544, trackKey(START, 100, 3)]]);
    const plan = planTrackFetches([25544, 43013], sats, START, 3, requested);
    expect(plan.fetch).toEqual([{ norad: 43013, key: trackKey(START, 7, 3) }]);
  });

  it("drops what was held for a track that was switched off, so that switching it on again fetches it", () => {
    const requested = new Map([
      [25544, trackKey(START, 100, 3)],
      [43013, trackKey(START, 7, 3)],
    ]);
    expect(planTrackFetches([25544], sats, START, 3, requested)).toEqual({ fetch: [], drop: [43013] });
  });

  it("leaves out a satellite that is not in the tick (nothing to ask the server about)", () => {
    expect(planTrackFetches([99999], sats, START, 3, new Map())).toEqual({ fetch: [], drop: [] });
  });
});
