import { describe, expect, it } from "vitest";
import { ClockSender } from "./clockSender";
import type { ClockOp } from "./clockSender";
import type { Clock } from "./types";

const clock = (time: string): Clock => ({ state: "stop", throttle: 1, label: "Manual Control", time });

/** A sender whose requests are answered by the test, one by one. */
function setup() {
  const started: ClockOp[] = [];
  const pending: { resolve: (c: Clock) => void; reject: (e: unknown) => void }[] = [];
  const results: { op: ClockOp; clock: Clock; idle: boolean }[] = [];
  const errors: { op: ClockOp; error: unknown; idle: boolean }[] = [];
  const sender = new ClockSender({
    run: (op) => {
      started.push(op);
      return new Promise<Clock>((resolve, reject) => pending.push({ resolve, reject }));
    },
    onResult: (op, c, idle) => results.push({ op, clock: c, idle }),
    onError: (op, error, idle) => errors.push({ op, error, idle }),
  });
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return { sender, started, pending, results, errors, flush };
}

const put = (body: object): ClockOp => ({ kind: "put", body });

describe("ClockSender", () => {
  it("sends a request at once when nothing is in flight", () => {
    const { sender, started } = setup();
    expect(sender.busy).toBe(false);
    sender.send(put({ state: "forward" }));
    expect(started).toEqual([put({ state: "forward" })]);
    expect(sender.busy).toBe(true);
  });

  it("runs one request at a time and in order, so an old answer cannot overtake a newer request", async () => {
    const { sender, started, pending, results, flush } = setup();
    sender.send(put({ state: "forward" }));
    sender.send({ kind: "reset" });
    sender.send(put({ throttle: 5 }));
    expect(started).toHaveLength(1);
    pending[0]!.resolve(clock("A"));
    await flush();
    expect(started).toEqual([put({ state: "forward" }), { kind: "reset" }]);
    pending[1]!.resolve(clock("B"));
    await flush();
    expect(started).toHaveLength(3);
    pending[2]!.resolve(clock("C"));
    await flush();
    expect(results.map((r) => r.clock.time)).toEqual(["A", "B", "C"]);
    expect(sender.busy).toBe(false);
  });

  it("merges the requests that wait into one, the newest value of each field winning", async () => {
    const { sender, started, pending, results, flush } = setup();
    sender.send(put({ state: "stop", time: "T0" })); // in flight
    sender.send(put({ state: "stop", time: "T1" }));
    sender.send(put({ state: "stop", time: "T2" })); // a slider drag
    sender.send(put({ throttle: 7 }));
    pending[0]!.resolve(clock("A"));
    await flush();
    expect(started).toEqual([put({ state: "stop", time: "T0" }), put({ state: "stop", time: "T2", throttle: 7 })]);
    pending[1]!.resolve(clock("B"));
    await flush();
    expect(results.map((r) => r.clock.time)).toEqual(["A", "B"]);
  });

  it("does not merge across a reset", async () => {
    const { sender, started, pending, flush } = setup();
    sender.send(put({ throttle: 2 })); // in flight
    sender.send(put({ throttle: 3 }));
    sender.send({ kind: "reset" });
    sender.send(put({ throttle: 4 }));
    for (let i = 0; i < 4; i++) {
      pending[i]!.resolve(clock(String(i)));
      await flush();
    }
    expect(started).toEqual([put({ throttle: 2 }), put({ throttle: 3 }), { kind: "reset" }, put({ throttle: 4 })]);
  });

  it("says which answer is the last one (idle), so the window applies only that one", async () => {
    const { sender, pending, results, flush } = setup();
    sender.send(put({ throttle: 2 }));
    sender.send(put({ throttle: 3 }));
    pending[0]!.resolve(clock("A"));
    await flush();
    pending[1]!.resolve(clock("B"));
    await flush();
    expect(results.map((r) => r.idle)).toEqual([false, true]);
  });

  it("reports an error and goes on with the next request", async () => {
    const { sender, started, pending, results, errors, flush } = setup();
    const boom = new Error("CLOCK_INVALID");
    sender.send(put({ time: "bad" }));
    sender.send({ kind: "reset" });
    pending[0]!.reject(boom);
    await flush();
    expect(errors).toEqual([{ op: put({ time: "bad" }), error: boom, idle: false }]);
    expect(started).toHaveLength(2);
    pending[1]!.resolve(clock("B"));
    await flush();
    expect(results).toHaveLength(1);
    expect(sender.busy).toBe(false);
  });

  it("dispose drops the waiting requests and silences the answer in flight", async () => {
    const { sender, started, pending, results, errors, flush } = setup();
    sender.send(put({ throttle: 2 }));
    sender.send(put({ throttle: 3 }));
    sender.dispose();
    pending[0]!.resolve(clock("A"));
    await flush();
    expect(started).toHaveLength(1);
    expect(results).toEqual([]);
    expect(errors).toEqual([]);
    sender.send(put({ throttle: 9 })); // a disposed sender sends nothing more
    expect(started).toHaveLength(1);
  });

  it("finish sends the reset of closing the window after the request in flight, and drops the waiting ones", async () => {
    const { sender, started, pending, results, flush } = setup();
    sender.send(put({ state: "stop", time: "T0" })); // in flight
    sender.send(put({ state: "stop", time: "T1" })); // never sent: closing resets anyway
    const done = sender.finish();
    await flush();
    expect(started).toEqual([put({ state: "stop", time: "T0" })]); // the reset waits for the request in flight
    pending[0]!.resolve(clock("A"));
    await flush();
    expect(started).toEqual([put({ state: "stop", time: "T0" }), { kind: "reset" }]);
    pending[1]!.resolve(clock("R"));
    await expect(done).resolves.toEqual(clock("R"));
    expect(results).toEqual([]); // the window is gone: nobody is told
  });

  it("finish resets even if the request in flight fails, and rejects if the reset fails", async () => {
    const { sender, started, pending, errors, flush } = setup();
    sender.send(put({ time: "bad" }));
    const done = sender.finish();
    const outcome = expect(done).rejects.toThrow("down");
    pending[0]!.reject(new Error("CLOCK_INVALID"));
    await flush();
    expect(started).toEqual([put({ time: "bad" }), { kind: "reset" }]);
    pending[1]!.reject(new Error("down"));
    await outcome;
    expect(errors).toEqual([]);
  });

  it("finish with nothing in flight resets at once", () => {
    const { sender, started } = setup();
    void sender.finish().catch(() => undefined);
    expect(started).toEqual([{ kind: "reset" }]);
  });
});
