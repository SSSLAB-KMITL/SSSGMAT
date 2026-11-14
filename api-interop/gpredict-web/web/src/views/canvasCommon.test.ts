import { describe, expect, it } from "vitest";
import type { SatState, Tick } from "../types";
import {
  canvasPixels,
  clickSelection,
  hitTest,
  INITIAL_GATE,
  isRefreshTick,
  matchesSatFilter,
  nextEvent,
  stepRefreshGate,
} from "./canvasCommon";
import type { RefreshGate } from "./canvasCommon";

describe("hitTest", () => {
  const sats = [
    { norad: 25544, x: 100, y: 100 },
    { norad: 43013, x: 300, y: 300 },
  ];

  it("selects a satellite 10 px away", () => {
    expect(hitTest(sats, 110, 100)).toBe(25544);
    expect(hitTest(sats, 106, 108)).toBe(25544); // 6-8-10 triangle: exactly 10 px
    expect(hitTest(sats, 100, 90)).toBe(25544);
  });

  it("does not select one 11 px away", () => {
    expect(hitTest(sats, 111, 100)).toBeNull();
    expect(hitTest(sats, 100, 89)).toBeNull();
  });

  it("selects the nearest of several within the radius", () => {
    const close = [
      { norad: 1, x: 100, y: 100 },
      { norad: 2, x: 106, y: 100 },
    ];
    expect(hitTest(close, 104, 100)).toBe(2);
    expect(hitTest(close, 101, 100)).toBe(1);
  });

  it("is null for nothing there and for no satellites", () => {
    expect(hitTest(sats, 200, 200)).toBeNull();
    expect(hitTest([], 0, 0)).toBeNull();
  });

  it("takes the radius as a parameter", () => {
    expect(hitTest(sats, 115, 100, 20)).toBe(25544);
    expect(hitTest(sats, 105, 100, 4)).toBeNull();
  });
});

describe("isRefreshTick", () => {
  it("redraws on the first tick and then every N ticks", () => {
    const drawn = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].filter((i) => isRefreshTick(i, 10));
    expect(drawn).toEqual([0, 10]);
    expect([0, 1, 2, 3].filter((i) => isRefreshTick(i, 1))).toEqual([0, 1, 2, 3]);
  });

  it("treats a missing or bad N as every tick", () => {
    expect(isRefreshTick(3, 0)).toBe(true);
    expect(isRefreshTick(3, Number.NaN)).toBe(true);
  });
});

describe("stepRefreshGate", () => {
  const ok = (n: number): Tick => ({ status: "ok", t: `t${n}` }) as unknown as Tick;
  const computing = (n: number): Tick => ({ status: "computing", t: `t${n}` }) as unknown as Tick;
  const failed = (n: number): Tick => ({ status: "failed", t: `t${n}` }) as unknown as Tick;

  /** Feed `ticks` one by one (as the effect does) and tell which of them draw. `every` may differ per tick. */
  function run(ticks: readonly Tick[], every: number | readonly number[]): number[] {
    let gate: RefreshGate = INITIAL_GATE;
    const drawn: number[] = [];
    ticks.forEach((tick, i) => {
      const step = stepRefreshGate(gate, tick, typeof every === "number" ? every : (every[i] as number));
      gate = step.gate;
      if (step.draw) drawn.push(i);
    });
    return drawn;
  }

  it("draws the first ok tick at once", () => {
    expect(run([ok(0)], 1000)).toEqual([0]);
  });

  it("then draws every N-th ok tick", () => {
    const ticks = Array.from({ length: 10 }, (_, i) => ok(i));
    expect(run(ticks, 3)).toEqual([0, 3, 6, 9]);
    expect(run(ticks, 1)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(run(ticks, 1000)).toEqual([0]);
  });

  it("a tick that is not ok never draws and starts the count again, so the next ok tick draws at once", () => {
    expect(run([ok(0), ok(1), ok(2), computing(3), ok(4), ok(5)], 1000)).toEqual([0, 4]);
    expect(run([ok(0), ok(1), failed(2), ok(3), ok(4), ok(5), ok(6)], 3)).toEqual([0, 3, 6]);
  });

  it("draws nothing before the first ok tick, and then the first ok tick draws", () => {
    expect(run([computing(0), computing(1), ok(2)], 5)).toEqual([2]);
    expect(run([failed(0)], 1)).toEqual([]);
  });

  it("does not count a tick it has already seen (the effect runs twice in StrictMode, and again when N changes)", () => {
    const a = ok(0);
    const b = ok(1);
    const c = ok(2);
    const seen = [a, a, b, b, b, c];
    expect(run(seen, 2)).toEqual([0, 5]); // a is count 0, b count 1, c count 2: every second one
    // a repeated tick right after a non-ok one does not reset or draw twice
    const x = computing(5);
    expect(run([x, x, a, a], 1000)).toEqual([2]);
  });

  it("does nothing for no tick", () => {
    const step = stepRefreshGate({ last: null, count: 4 }, null, 3);
    expect(step).toEqual({ gate: { last: null, count: 4 }, draw: false });
  });

  it("uses the N of the moment: a changed refresh setting applies from the next tick on", () => {
    const ticks = Array.from({ length: 6 }, (_, i) => ok(i));
    // counts 0..5: with N = 10 only count 0 draws; N = 2 from tick 3 on: counts 3 (no), 4 (yes), 5 (no)
    expect(run(ticks, [10, 10, 10, 2, 2, 2])).toEqual([0, 4]);
  });
});

describe("clickSelection", () => {
  it("selects the satellite under a first click", () => {
    expect(clickSelection(1, 25544, null)).toEqual({ norad: 25544 });
    expect(clickSelection(1, 25544, 43013)).toEqual({ norad: 25544 });
  });

  it("unselects it when it is the selected one", () => {
    expect(clickSelection(1, 25544, 25544)).toEqual({ norad: null });
  });

  it("does nothing for a click on nothing", () => {
    expect(clickSelection(1, null, 25544)).toBeNull();
    expect(clickSelection(1, null, null)).toBeNull();
  });

  it("ignores the second click of a double click: the selection stays as the first click left it", () => {
    expect(clickSelection(2, 25544, 25544)).toBeNull();
    expect(clickSelection(2, 25544, null)).toBeNull();
    expect(clickSelection(3, 25544, null)).toBeNull();
  });
});

describe("canvasPixels", () => {
  it("is the size in CSS px times the device pixel ratio, rounded", () => {
    expect(canvasPixels({ w: 700, h: 500 }, 1)).toEqual([700, 500]);
    expect(canvasPixels({ w: 700, h: 500 }, 2)).toEqual([1400, 1000]);
    expect(canvasPixels({ w: 333, h: 111 }, 1.5)).toEqual([500, 167]);
  });
});

describe("nextEvent", () => {
  const NOW = Date.parse("2026-11-12T07:00:00.000Z");
  const at = (sec: number) => new Date(NOW + sec * 1000).toISOString();
  const sat = (norad: number, over: Partial<SatState> = {}): SatState => ({ norad, name: `S${norad}`, dir: "↑", next_aos: null, ...over }) as SatState;

  it("is the satellite whose next AOS comes first, with the seconds until it", () => {
    const sats = [sat(1, { next_aos: at(1800) }), sat(2, { next_aos: at(330) }), sat(3, { next_aos: at(900) })];
    expect(nextEvent(sats, NOW)).toEqual({ sat: sats[1], seconds: 330 });
  });

  it("leaves out decayed satellites, AOS in the past, AOS not known and times that do not parse", () => {
    const sats = [
      sat(1, { dir: "D", next_aos: at(10) }),
      sat(2, { next_aos: at(-10) }),
      sat(3, { next_aos: null }),
      sat(4, { next_aos: "not a time" }),
      sat(5, { next_aos: at(60) }),
    ];
    expect(nextEvent(sats, NOW)?.sat.norad).toBe(5);
    expect(nextEvent(sats.slice(0, 4), NOW)).toBeNull();
    expect(nextEvent([], NOW)).toBeNull();
  });
});

describe("matchesSatFilter", () => {
  it("matches everything when the filter text is empty", () => {
    expect(matchesSatFilter("ISS (ZARYA)", "")).toBe(true);
  });

  it("matches a name that has the text, ignoring case", () => {
    expect(matchesSatFilter("ISS (ZARYA)", "zarya")).toBe(true);
    expect(matchesSatFilter("ISS (ZARYA)", "ISS")).toBe(true);
    expect(matchesSatFilter("ISS (ZARYA)", "iss (zarya)")).toBe(true);
  });

  it("does not match a name that lacks the text", () => {
    expect(matchesSatFilter("ISS (ZARYA)", "NOAA")).toBe(false);
  });
});
