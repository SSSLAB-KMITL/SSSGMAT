import { describe, expect, it } from "vitest";
import { TimeLabel } from "./timeLabel";

describe("TimeLabel.update", () => {
  it("shows the first text at once", () => {
    const label = new TimeLabel(1000);
    expect(label.update("2026/11/12 07:00:00", 5000)).toEqual({ show: "2026/11/12 07:00:00", waitMs: null });
  });

  it("does nothing when the text is the one on screen", () => {
    const label = new TimeLabel(1000);
    label.update("A", 0);
    expect(label.update("A", 300)).toEqual({ show: null, waitMs: null });
    expect(label.update("A", 5000)).toEqual({ show: null, waitMs: null });
  });

  it("changes the text at most once per interval, and says how long to wait for the newest text", () => {
    const label = new TimeLabel(1000);
    label.update("A", 0);
    expect(label.update("B", 300)).toEqual({ show: null, waitMs: 700 });
    expect(label.update("B", 900)).toEqual({ show: null, waitMs: 100 });
    expect(label.update("B", 1000)).toEqual({ show: "B", waitMs: null }); // exactly one interval after A
    expect(label.update("C", 1001)).toEqual({ show: null, waitMs: 999 }); // the interval restarts at each change
  });

  it("shows at once when the clock went backwards", () => {
    const label = new TimeLabel(1000);
    label.update("A", 5000);
    expect(label.update("B", 1000)).toEqual({ show: "B", waitMs: null });
  });
});

/**
 * The header's loop, as the component runs it: every tick calls update with the newest text, and a refused update
 * is retried by a timer with the text of the tick that set it. Returns what is on screen at every millisecond.
 */
function run(ticks: { at: number; text: string }[], until: number): string[] {
  const label = new TimeLabel(1000);
  const screen: string[] = [];
  let shown = "";
  const pending: { timer: { at: number; text: string } | null } = { timer: null };
  const apply = (text: string, now: number) => {
    const d = label.update(text, now);
    if (d.show !== null) shown = d.show;
    pending.timer = d.waitMs === null ? null : { at: now + d.waitMs, text };
  };
  for (let now = 0; now <= until; now++) {
    const tick = ticks.find((t) => t.at === now);
    if (tick) apply(tick.text, now); // a new tick cancels the old timer (effect cleanup) and applies itself
    else if (pending.timer !== null && pending.timer.at === now) apply(pending.timer.text, now);
    screen.push(shown);
  }
  return screen;
}

const every300 = (from: string, to: string, change: number, count: number) =>
  Array.from({ length: count }, (_, i) => ({ at: i * 300, text: i * 300 < change ? from : to }));

describe("the header never sticks on a stale text", () => {
  it("module stopped: identical times after a refused update still end up on screen within 1 s", () => {
    // 07:00:00 is on screen; at 300 ms the user sets a stopped time 3 days later; every later tick carries the same time
    const screen = run(every300("07:00:00", "3 days later", 300, 12), 3300);
    expect(screen[0]).toBe("07:00:00");
    expect(screen[299]).toBe("07:00:00"); // refused: the last change was at 0 ms
    expect(screen[1000]).toBe("3 days later"); // one interval after the last change, no further tick needed
    expect(screen.slice(1000).every((s) => s === "3 days later")).toBe(true);
  });

  it("a jump inside the gate: the newest time is shown within 1 s of the previous change", () => {
    // B on screen from 0, jump to C at 500 ms (ticks keep coming every 300 ms, jumping once)
    const ticks = [
      { at: 0, text: "B" },
      { at: 300, text: "B" },
      { at: 600, text: "C" },
      { at: 900, text: "C" },
      { at: 1200, text: "C" },
    ];
    const screen = run(ticks, 1500);
    expect(screen[999]).toBe("B");
    expect(screen[1000]).toBe("C");
  });

  it("never shows two different texts less than one interval apart", () => {
    const ticks = Array.from({ length: 40 }, (_, i) => ({ at: i * 300, text: `t${Math.floor(i / 2)}` }));
    const screen = run(ticks, 12_000);
    let lastChange = 0;
    for (let ms = 1; ms < screen.length; ms++) {
      if (screen[ms] !== screen[ms - 1]) {
        expect(ms - lastChange).toBeGreaterThanOrEqual(1000);
        lastChange = ms;
      }
    }
    // and it follows the newest text: at the end the screen shows the last tick's text
    expect(screen.at(-1)).toBe("t19");
  });
});
