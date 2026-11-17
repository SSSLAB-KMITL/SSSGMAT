import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { startClock } from "../../src/time/clock";
import { advance, timeFromScenario, useTime, type TimeState } from "../../src/stores/time";

const T = (iso: string) => new Date(iso);
const PERIOD_START = T("2026-11-12T00:00:00Z");
const PERIOD_STOP = T("2026-11-13T00:00:00Z");

// period 2026-11-12T00:00Z–2026-11-13T00:00Z, animStart = periodStart, current = 12:00Z, step 60
const S0: TimeState = {
  current: T("2026-11-12T12:00:00Z"), mode: "normal", direction: 0, step_s: 60, multiplier: 60, cycle: "loop",
  periodStart: PERIOD_START, periodStop: PERIOD_STOP, animStart: PERIOD_START,
};
const ms = (a: Date, b: Date) => +a - +b;

describe("advance", () => {
  test("normal mode moves one step per refresh at 30 Hz", () => expect(+advance({ ...S0, direction: 1 }, 1).current - +S0.current).toBe(1_800_000));

  test("normal mode scales with the step and the real elapsed time", () => {
    expect(ms(advance({ ...S0, direction: 1, step_s: 10 }, 0.5).current, S0.current)).toBe(150_000);
    expect(ms(advance({ ...S0, direction: -1, step_s: 3600 }, 0.1).current, S0.current)).toBe(-10_800_000);
  });

  test("real-time and x real-time follow the wall clock", () => {
    expect(+advance({ ...S0, mode: "realtime", direction: 1 }, 2.5).current - +S0.current).toBe(2_500);
    expect(+advance({ ...S0, mode: "xrealtime", multiplier: 60, direction: -1 }, 1).current - +S0.current).toBe(-60_000);
  });

  test("real-time ignores the step and x real-time ignores it too", () => {
    expect(ms(advance({ ...S0, mode: "realtime", direction: 1, step_s: 3600 }, 1).current, S0.current)).toBe(1_000);
    expect(ms(advance({ ...S0, mode: "xrealtime", direction: 1, multiplier: 3600, step_s: 1 }, 1).current, S0.current)).toBe(3_600_000);
  });

  test("direction 0 returns the very same state, as does a non-positive or invalid dt", () => {
    expect(advance(S0, 1)).toBe(S0);
    expect(advance({ ...S0, direction: 1 }, 0).current).toBe(S0.current);
    expect(advance({ ...S0, direction: 1 }, -1).current).toBe(S0.current);
    expect(advance({ ...S0, direction: 1 }, NaN).current).toBe(S0.current);
  });

  test("does not mutate its input", () => {
    const s: TimeState = { ...S0, direction: 1 };
    const before = +s.current;
    advance(s, 1);
    expect(+s.current).toBe(before);
    expect(s.direction).toBe(1);
  });

  test("cycle stop pauses at the ends", () => {
    const s = advance({ ...S0, current: new Date("2026-11-12T23:59:00Z"), direction: 1, cycle: "stop" }, 1);
    expect(s.current.toISOString()).toBe("2026-11-13T00:00:00.000Z"); expect(s.direction).toBe(0);
  });

  test("cycle stop going backwards pauses at the start, and reaching the end exactly also pauses", () => {
    const back = advance({ ...S0, current: T("2026-11-12T00:10:00Z"), direction: -1, cycle: "stop" }, 1);
    expect(back.current.toISOString()).toBe("2026-11-12T00:00:00.000Z"); expect(back.direction).toBe(0);
    const exact = advance({ ...S0, current: T("2026-11-12T23:30:00Z"), direction: 1, cycle: "stop" }, 1);
    expect(exact.current.toISOString()).toBe("2026-11-13T00:00:00.000Z"); expect(exact.direction).toBe(0);
  });

  test("cycle stop while already at or past the end in the running direction pauses without moving", () => {
    const atEnd = advance({ ...S0, current: PERIOD_STOP, direction: 1, cycle: "stop" }, 1);
    expect(+atEnd.current).toBe(+PERIOD_STOP); expect(atEnd.direction).toBe(0);
    const past = advance({ ...S0, current: T("2026-11-14T00:00:00Z"), direction: 1, cycle: "stop" }, 1);
    expect(past.current.toISOString()).toBe("2026-11-14T00:00:00.000Z"); expect(past.direction).toBe(0);
    const before = advance({ ...S0, current: T("2026-11-11T00:00:00Z"), direction: -1, cycle: "stop" }, 1);
    expect(before.current.toISOString()).toBe("2026-11-11T00:00:00.000Z"); expect(before.direction).toBe(0);
  });

  test("cycle stop still plays toward the period from outside it", () => {
    const s = advance({ ...S0, current: T("2026-11-11T23:00:00Z"), direction: 1, cycle: "stop" }, 1);
    expect(s.current.toISOString()).toBe("2026-11-11T23:30:00.000Z"); expect(s.direction).toBe(1);
  });

  test("cycle loop wraps both ways", () => {
    expect(advance({ ...S0, current: new Date("2026-11-12T23:59:00Z"), direction: 1, cycle: "loop" }, 1).current.toISOString()).toBe("2026-11-12T00:00:00.000Z");
    expect(advance({ ...S0, current: new Date("2026-11-12T00:01:00Z"), direction: -1, cycle: "loop" }, 1).current.toISOString()).toBe("2026-11-13T00:00:00.000Z");
  });

  test("cycle loop keeps playing after the wrap", () => {
    expect(advance({ ...S0, current: T("2026-11-12T23:59:00Z"), direction: 1, cycle: "loop" }, 1).direction).toBe(1);
    expect(advance({ ...S0, current: T("2026-11-12T00:01:00Z"), direction: -1, cycle: "loop" }, 1).direction).toBe(-1);
  });

  test("cycle off runs past the end", () => {
    expect(+advance({ ...S0, current: new Date("2026-11-12T23:59:00Z"), direction: 1, cycle: "off" }, 1).current).toBeGreaterThan(+S0.periodStop);
  });

  test("cycle off runs past the start going backwards and keeps its direction", () => {
    const s = advance({ ...S0, current: T("2026-11-12T00:10:00Z"), direction: -1, cycle: "off" }, 1);
    expect(s.current.toISOString()).toBe("2026-11-11T23:40:00.000Z"); expect(s.direction).toBe(-1);
  });

  test("cycle loop: a jump of more than a whole period lands on the opposite end", () => {
    const fwd = advance({ ...S0, direction: 1, cycle: "loop", step_s: 31536000 }, 1); // about 30 years
    expect(fwd.current.toISOString()).toBe("2026-11-12T00:00:00.000Z"); expect(fwd.direction).toBe(1);
    const back = advance({ ...S0, direction: -1, cycle: "loop", step_s: 31536000 }, 1);
    expect(back.current.toISOString()).toBe("2026-11-13T00:00:00.000Z"); expect(back.direction).toBe(-1);
    // same in real time: 3 days of wall clock in one frame
    expect(advance({ ...S0, mode: "realtime", direction: 1, cycle: "loop" }, 3 * 86_400).current.toISOString()).toBe("2026-11-12T00:00:00.000Z");
    expect(advance({ ...S0, mode: "realtime", direction: -1, cycle: "loop" }, 3 * 86_400).current.toISOString()).toBe("2026-11-13T00:00:00.000Z");
  });

  test("cycle stop: a huge jump clamps to the end it was heading for and pauses", () => {
    const fwd = advance({ ...S0, direction: 1, cycle: "stop", step_s: 31536000 }, 1);
    expect(fwd.current.toISOString()).toBe("2026-11-13T00:00:00.000Z"); expect(fwd.direction).toBe(0);
    const back = advance({ ...S0, direction: -1, cycle: "stop", step_s: 31536000 }, 1);
    expect(back.current.toISOString()).toBe("2026-11-12T00:00:00.000Z"); expect(back.direction).toBe(0);
  });

  test("a move that would leave the Date range keeps the previous time and pauses", () => {
    // cycle off, largest step, normal mode, huge dt: 31536000 * 30 * 1e5 s is far beyond 8.64e15 ms
    const fwd = advance({ ...S0, direction: 1, cycle: "off", step_s: 31536000 }, 1e5);
    expect(fwd.current).toBe(S0.current); expect(fwd.direction).toBe(0);
    const back = advance({ ...S0, direction: -1, cycle: "off", step_s: 31536000 }, 1e5);
    expect(back.current).toBe(S0.current); expect(back.direction).toBe(0);
    // an infinite dt is out of range too
    const inf = advance({ ...S0, direction: 1, cycle: "off" }, Infinity);
    expect(inf.current).toBe(S0.current); expect(inf.direction).toBe(0);
    // a large but representable jump still plays (30 years)
    const ok = advance({ ...S0, direction: 1, cycle: "off", step_s: 31536000 }, 1);
    expect(ok.current.getUTCFullYear()).toBe(2056); expect(ok.direction).toBe(1);
  });

  test("the Date limits themselves: reaching +-8.64e15 ms is allowed, passing it is not", () => {
    const MAX = 8.64e15;
    const nearMax = { ...S0, mode: "realtime" as const, direction: 1 as const, cycle: "off" as const, current: new Date(MAX - 1000) };
    expect(+advance(nearMax, 1).current).toBe(MAX);
    expect(advance(nearMax, 1).direction).toBe(1);
    const over = advance(nearMax, 2);
    expect(+over.current).toBe(MAX - 1000); expect(over.direction).toBe(0);
    const nearMin = { ...nearMax, direction: -1 as const, current: new Date(-MAX + 1000) };
    expect(+advance(nearMin, 1).current).toBe(-MAX);
    const under = advance(nearMin, 2);
    expect(+under.current).toBe(-MAX + 1000); expect(under.direction).toBe(0);
  });

  test("sub-millisecond steps accumulate instead of vanishing (0.0001 s step, 60 frames of 1/60 s = 3 ms)", () => {
    let s: TimeState = { ...S0, direction: 1, step_s: 0.0001 };
    for (let i = 0; i < 60; i++) s = advance(s, 1 / 60);
    expect(ms(s.current, S0.current)).toBe(3);
  });

  test("real-time tracks the wall clock over many frames with non-integer millisecond dt", () => {
    let s: TimeState = { ...S0, mode: "realtime", direction: 1 };
    for (let i = 0; i < 600; i++) s = advance(s, 0.0167); // 10.02 s
    expect(Math.abs(ms(s.current, S0.current) - 10_020)).toBeLessThanOrEqual(1);
  });
});

describe("timeFromScenario", () => {
  const AP = { start: "2026-11-12T00:00:00Z", stop: "2026-11-13T00:00:00Z" };

  test("timeFromScenario maps codes", () => {
    const s = timeFromScenario({
      analysis_period: AP,
      animation: { update_mode: "x_real_time", time_step_s: 300, x_real_time_multiplier: 3600, cycle: "stop", start: "2026-11-12T06:00:00.250Z" },
    });
    expect(s.mode).toBe("xrealtime");
    expect(s.step_s).toBe(300);
    expect(s.multiplier).toBe(3600);
    expect(s.cycle).toBe("stop");
    expect(s.animStart.toISOString()).toBe("2026-11-12T06:00:00.250Z");
    expect(s.current.toISOString()).toBe("2026-11-12T06:00:00.250Z");
    expect(s.periodStart.toISOString()).toBe("2026-11-12T00:00:00.000Z");
    expect(s.periodStop.toISOString()).toBe("2026-11-13T00:00:00.000Z");
    expect(s.direction).toBe(0);
  });

  test("update_mode time_step is normal and real_time is realtime", () => {
    expect(timeFromScenario({ analysis_period: AP, animation: { update_mode: "time_step" } }).mode).toBe("normal");
    expect(timeFromScenario({ analysis_period: AP, animation: { update_mode: "real_time" } }).mode).toBe("realtime");
  });

  test("animation.start null or missing falls back to the start of the analysis period", () => {
    for (const animation of [{ start: null }, {}, undefined, null]) {
      const s = timeFromScenario({ analysis_period: AP, animation });
      expect(s.animStart.toISOString()).toBe("2026-11-12T00:00:00.000Z");
      expect(s.current.toISOString()).toBe("2026-11-12T00:00:00.000Z");
    }
  });

  test("missing animation fields take the server defaults", () => {
    for (const animation of [undefined, null, {}]) {
      const s = timeFromScenario({ analysis_period: AP, animation });
      expect(s.step_s).toBe(60);
      expect(s.mode).toBe("normal");
      expect(s.multiplier).toBe(60);
      expect(s.cycle).toBe("loop");
      expect(s.direction).toBe(0);
    }
    const partial = timeFromScenario({ analysis_period: AP, animation: { time_step_s: 30 } });
    expect(partial.step_s).toBe(30);
    expect(partial.cycle).toBe("loop");
  });

  test("times with and without milliseconds are read as UTC", () => {
    const s = timeFromScenario({ analysis_period: { start: "2026-11-12T00:00:00.500Z", stop: "2026-11-13T00:00:00Z" }, animation: { start: "2026-11-12T01:00:00Z" } });
    expect(s.periodStart.toISOString()).toBe("2026-11-12T00:00:00.500Z");
    expect(s.animStart.toISOString()).toBe("2026-11-12T01:00:00.000Z");
  });

  test("analysis_period and animation.start given with a +hh:mm offset are converted to UTC", () => {
    const s = timeFromScenario({
      analysis_period: { start: "2026-11-12T07:00:00+07:00", stop: "2026-11-13T07:00:00.500+07:00" },
      animation: { start: "2026-11-12T13:00:00+07:00" },
    });
    expect(s.periodStart.toISOString()).toBe("2026-11-12T00:00:00.000Z");
    expect(s.periodStop.toISOString()).toBe("2026-11-13T00:00:00.500Z");
    expect(s.animStart.toISOString()).toBe("2026-11-12T06:00:00.000Z");
    expect(s.current.toISOString()).toBe("2026-11-12T06:00:00.000Z");
    const west = timeFromScenario({ analysis_period: { start: "2026-11-11T19:00:00-05:00", stop: "2026-11-12T19:00:00-05:00" } });
    expect(west.periodStart.toISOString()).toBe("2026-11-12T00:00:00.000Z");
    expect(west.animStart.toISOString()).toBe("2026-11-12T00:00:00.000Z");
  });

  test("an offset form with a bad part still throws", () => {
    expect(() => timeFromScenario({ analysis_period: { start: "2026-13-12T07:00:00+07:00", stop: AP.stop } })).toThrow(RangeError);
    expect(() => timeFromScenario({ analysis_period: { start: AP.start, stop: "2026-11-13T24:00:00+07:00" } })).toThrow(RangeError);
    expect(() => timeFromScenario({ analysis_period: AP, animation: { start: "2026-11-12T07:00:00+25:00" } })).toThrow(RangeError);
  });

  test("a time that is not ISO UTC throws instead of producing an Invalid Date", () => {
    expect(() => timeFromScenario({ analysis_period: { start: "tomorrow", stop: AP.stop } })).toThrow(RangeError);
    expect(() => timeFromScenario({ analysis_period: { start: AP.start, stop: "2026-11-13T00:00:00" } })).toThrow(RangeError);
    expect(() => timeFromScenario({ analysis_period: AP, animation: { start: "12 Nov 2026" } })).toThrow(RangeError);
  });
});

describe("useTime", () => {
  beforeEach(() => useTime.setState({ ...S0, residualMs: undefined }));

  test("buttons: reset", () => {
    const animStart = T("2026-11-12T03:00:00Z");
    useTime.setState({ animStart, direction: 1, step_s: 600 });
    useTime.getState().reset();
    const s = useTime.getState();
    expect(+s.current).toBe(+animStart); expect(s.direction).toBe(0); expect(s.step_s).toBe(600);
  });

  test("buttons: stepForward and stepBackward move one step and stop", () => {
    useTime.setState({ direction: 1 });
    useTime.getState().stepForward();
    expect(ms(useTime.getState().current, S0.current)).toBe(60_000);
    expect(useTime.getState().direction).toBe(0);
    useTime.setState({ direction: -1 });
    useTime.getState().stepBackward();
    useTime.getState().stepBackward();
    expect(ms(useTime.getState().current, S0.current)).toBe(-60_000);
    expect(useTime.getState().direction).toBe(0);
  });

  test("buttons: a step uses the current step size", () => {
    useTime.setState({ step_s: 3600 });
    useTime.getState().stepForward();
    expect(ms(useTime.getState().current, S0.current)).toBe(3_600_000);
  });

  test("buttons: steps apply the cycle rule at the ends like advance does", () => {
    const nearEnd = T("2026-11-12T23:59:30Z");
    useTime.setState({ current: nearEnd, cycle: "stop" });
    useTime.getState().stepForward();
    expect(useTime.getState().current.toISOString()).toBe("2026-11-13T00:00:00.000Z");
    useTime.setState({ current: nearEnd, cycle: "loop" });
    useTime.getState().stepForward();
    expect(useTime.getState().current.toISOString()).toBe("2026-11-12T00:00:00.000Z");
    useTime.setState({ current: nearEnd, cycle: "off" });
    useTime.getState().stepForward();
    expect(useTime.getState().current.toISOString()).toBe("2026-11-13T00:00:30.000Z");

    const nearStart = T("2026-11-12T00:00:30Z");
    useTime.setState({ current: nearStart, cycle: "stop" });
    useTime.getState().stepBackward();
    expect(useTime.getState().current.toISOString()).toBe("2026-11-12T00:00:00.000Z");
    useTime.setState({ current: nearStart, cycle: "loop" });
    useTime.getState().stepBackward();
    expect(useTime.getState().current.toISOString()).toBe("2026-11-13T00:00:00.000Z");
    useTime.setState({ current: nearStart, cycle: "off" });
    useTime.getState().stepBackward();
    expect(useTime.getState().current.toISOString()).toBe("2026-11-11T23:59:30.000Z");
  });

  test("buttons: a step that would leave the Date range keeps the time and stays paused", () => {
    useTime.setState({ cycle: "off", step_s: 1e13, direction: 1 });
    useTime.getState().stepForward();
    expect(useTime.getState().current).toBe(S0.current); expect(useTime.getState().direction).toBe(0);
    useTime.setState({ direction: -1 });
    useTime.getState().stepBackward();
    expect(useTime.getState().current).toBe(S0.current); expect(useTime.getState().direction).toBe(0);
  });

  test("tick with a move beyond the Date range pauses instead of storing an Invalid Date", () => {
    useTime.setState({ cycle: "off", step_s: 31536000, direction: 1 });
    useTime.getState().tick(1e5);
    expect(useTime.getState().current).toBe(S0.current); expect(useTime.getState().direction).toBe(0);
    expect(Number.isFinite(+useTime.getState().current)).toBe(true);
  });

  test("buttons: start and reverse set the direction, pause keeps the current time", () => {
    useTime.getState().start();
    expect(useTime.getState().direction).toBe(1);
    useTime.getState().tick(1);
    const moved = +useTime.getState().current;
    expect(moved).toBe(+S0.current + 1_800_000);
    useTime.getState().reverse();
    expect(useTime.getState().direction).toBe(-1);
    useTime.getState().tick(1);
    expect(+useTime.getState().current).toBe(+S0.current);
    useTime.getState().start();
    useTime.getState().tick(0.5);
    const before = +useTime.getState().current;
    useTime.getState().pause();
    expect(useTime.getState().direction).toBe(0);
    expect(+useTime.getState().current).toBe(before);
    useTime.getState().tick(1);
    expect(+useTime.getState().current).toBe(before);
  });

  test("buttons: increaseStep x3 from 60 gives 600, decreaseStep walks back down, both clamp", () => {
    const { increaseStep, decreaseStep } = useTime.getState();
    increaseStep(); increaseStep(); increaseStep();
    expect(useTime.getState().step_s).toBe(600);
    decreaseStep();
    expect(useTime.getState().step_s).toBe(300);
    useTime.setState({ step_s: 0.0001 });
    decreaseStep();
    expect(useTime.getState().step_s).toBe(0.0001);
    useTime.setState({ step_s: 31536000 });
    increaseStep();
    expect(useTime.getState().step_s).toBe(31536000);
  });

  test("setMode, setMultiplier and setCurrent", () => {
    useTime.getState().setMode("xrealtime");
    expect(useTime.getState().mode).toBe("xrealtime");
    useTime.getState().setMultiplier(3600);
    expect(useTime.getState().multiplier).toBe(3600);
    for (const bad of [0, -5, NaN, Infinity]) {
      useTime.getState().setMultiplier(bad);
      expect(useTime.getState().multiplier).toBe(3600);
    }
    // a time outside the analysis period is accepted (spec: the satellites just have no data there)
    const outside = T("2027-01-01T00:00:00.123Z");
    useTime.getState().setCurrent(outside);
    expect(+useTime.getState().current).toBe(+outside);
    useTime.getState().setCurrent(new Date(NaN));
    expect(+useTime.getState().current).toBe(+outside);
  });

  test("setCurrent during playback keeps the direction", () => {
    useTime.setState({ direction: 1 });
    useTime.getState().setCurrent(T("2026-11-12T05:00:00Z"));
    expect(useTime.getState().direction).toBe(1);
  });

  test("setCurrent and reset clear the sub-millisecond remainder", () => {
    useTime.setState({ direction: 1, step_s: 0.0001 });
    useTime.getState().tick(1 / 60);
    expect(useTime.getState().residualMs).toBeCloseTo(0.05, 6);
    useTime.getState().setCurrent(T("2026-11-12T05:00:00Z"));
    expect(useTime.getState().residualMs ?? 0).toBe(0);
    useTime.getState().tick(1 / 60);
    useTime.getState().reset();
    expect(useTime.getState().residualMs ?? 0).toBe(0);
  });

  test("init loads a scenario: current = Animation Start, stopped", () => {
    useTime.setState({ direction: 1, step_s: 3600 });
    useTime.getState().init({
      analysis_period: { start: "2026-12-01T00:00:00Z", stop: "2026-12-02T00:00:00Z" },
      animation: { update_mode: "real_time", cycle: "off", start: "2026-12-01T06:00:00Z" },
    });
    const s = useTime.getState();
    expect(s.current.toISOString()).toBe("2026-12-01T06:00:00.000Z");
    expect(s.mode).toBe("realtime"); expect(s.cycle).toBe("off"); expect(s.step_s).toBe(60); expect(s.direction).toBe(0);
    expect(s.periodStop.toISOString()).toBe("2026-12-02T00:00:00.000Z");
    expect(typeof s.tick).toBe("function");
  });

  test("tick while stopped leaves the state object untouched", () => {
    const before = useTime.getState();
    useTime.getState().tick(1);
    expect(useTime.getState()).toBe(before);
  });
});

describe("startClock", () => {
  function fakeFrames() {
    let t = 1000;
    let nextId = 1;
    const pending = new Map<number, () => void>();
    return {
      raf: (cb: (t: number) => void) => { const id = nextId++; pending.set(id, () => cb(t)); return id; },
      caf: (id: number) => { pending.delete(id); },
      now: () => t,
      /** wall clock moves by `dtMs`, then every frame requested so far runs once */
      frame(dtMs: number) { t += dtMs; const run = [...pending.values()]; pending.clear(); run.forEach((f) => f()); },
      pending: () => pending.size,
    };
  }
  const stops: Array<() => void> = [];
  const start = (f: ReturnType<typeof fakeFrames>) => { const stop = startClock({ raf: f.raf, caf: f.caf, now: f.now }); stops.push(stop); return stop; };

  beforeEach(() => useTime.setState({ ...S0, mode: "realtime", direction: 1, residualMs: undefined }));
  afterEach(() => { while (stops.length) stops.pop()!(); });

  test("each frame ticks the store with the real seconds elapsed since the previous frame", () => {
    const f = fakeFrames();
    start(f);
    f.frame(100); f.frame(250); f.frame(50);
    expect(ms(useTime.getState().current, S0.current)).toBe(400);
  });

  test("keeps exactly one frame request outstanding", () => {
    const f = fakeFrames();
    start(f);
    expect(f.pending()).toBe(1);
    f.frame(16); f.frame(16);
    expect(f.pending()).toBe(1);
  });

  test("caps dt at 1 s so a backgrounded tab does not jump", () => {
    const f = fakeFrames();
    start(f);
    f.frame(60_000);
    expect(ms(useTime.getState().current, S0.current)).toBe(1_000);
  });

  test("does not advance while paused, then picks up again without a catch-up jump", () => {
    const f = fakeFrames();
    start(f);
    useTime.getState().pause();
    f.frame(500); f.frame(500);
    expect(+useTime.getState().current).toBe(+S0.current);
    useTime.getState().start();
    f.frame(20);
    expect(ms(useTime.getState().current, S0.current)).toBe(20);
  });

  test("stop cancels the pending frame, later frames do nothing, and stopping twice is harmless", () => {
    const f = fakeFrames();
    const stop = start(f);
    f.frame(100);
    stop();
    expect(f.pending()).toBe(0);
    f.frame(100);
    expect(ms(useTime.getState().current, S0.current)).toBe(100);
    expect(() => stop()).not.toThrow();
  });

  test("a second startClock shares the one loop: one request, one tick per frame, stops when the last caller stops", () => {
    const f = fakeFrames();
    const stopA = start(f);
    const stopB = start(f);
    expect(f.pending()).toBe(1);
    f.frame(100);
    expect(ms(useTime.getState().current, S0.current)).toBe(100);
    stopA();
    expect(f.pending()).toBe(1);
    f.frame(100);
    expect(ms(useTime.getState().current, S0.current)).toBe(200);
    stopA(); // the same caller stopping again must not release B's hold
    expect(f.pending()).toBe(1);
    stopB();
    expect(f.pending()).toBe(0);
  });

  test("can be started again after it has been stopped", () => {
    const f = fakeFrames();
    start(f)();
    const g = fakeFrames();
    start(g);
    g.frame(40);
    expect(ms(useTime.getState().current, S0.current)).toBe(40);
  });

  test("defaults to the browser requestAnimationFrame and performance.now", () => {
    const stop = startClock();
    expect(typeof stop).toBe("function");
    stop();
  });
});
