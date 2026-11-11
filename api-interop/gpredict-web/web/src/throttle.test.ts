import { describe, expect, it } from "vitest";
import { MinInterval } from "./throttle";

describe("MinInterval", () => {
  it("lets the first call through, then at most one per interval", () => {
    let now = 10_000;
    const gate = new MinInterval(1000, () => now);
    expect(gate.ready()).toBe(true);
    now += 300;
    expect(gate.ready()).toBe(false);
    now += 600; // 900 ms since the last pass
    expect(gate.ready()).toBe(false);
    now += 100; // exactly 1000 ms
    expect(gate.ready()).toBe(true);
    now += 1;
    expect(gate.ready()).toBe(false);
  });

  it("restarts the interval at each pass, not at each refusal", () => {
    let now = 0;
    const gate = new MinInterval(1000, () => now);
    gate.ready(); // t=0
    for (now = 100; now < 1000; now += 100) expect(gate.ready()).toBe(false);
    now = 1000;
    expect(gate.ready()).toBe(true);
  });

  it("lets a call through when the clock jumped backwards", () => {
    let now = 5000;
    const gate = new MinInterval(1000, () => now);
    gate.ready();
    now = 1000;
    expect(gate.ready()).toBe(true);
  });
});
