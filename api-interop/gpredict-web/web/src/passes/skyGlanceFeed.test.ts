import { describe, expect, it } from "vitest";
import { ApiError } from "../api";
import type { Timer } from "../useModuleSocket";
import { SKY_POLL_MS, SkyGlanceFeed } from "./skyGlanceFeed";
import type { SkyApi, SkyView } from "./skyGlanceFeed";
import type { SkyGlanceAnswer } from "./types";

// ---- fakes --------------------------------------------------------------------------------------

/** A timer that runs nothing until the test says so. */
class FakeTimer implements Timer {
  private next = 1;
  readonly pending = new Map<number, { fn: () => void; ms: number }>();
  set(fn: () => void, ms: number): unknown {
    const id = this.next++;
    this.pending.set(id, { fn, ms });
    return id;
  }
  clear(handle: unknown): void {
    this.pending.delete(handle as number);
  }
  /** The delays of the timers that are waiting. */
  get delays(): number[] {
    return [...this.pending.values()].map((t) => t.ms);
  }
  /** Run the timers that are waiting now. */
  fire(): void {
    const due = [...this.pending.entries()];
    this.pending.clear();
    for (const [, t] of due) t.fn();
  }
}

/** The server: `get` answers what the test queued, in order, and remembers what it was asked. */
class FakeApi implements SkyApi {
  readonly calls: (string | undefined)[] = [];
  readonly log: string[] = [];
  releases = 0;
  releaseFails = false;
  private readonly queue: (SkyGlanceAnswer | Error)[] = [];
  private readonly waiting: { resolve: (a: SkyGlanceAnswer) => void; reject: (e: unknown) => void }[] = [];

  /** Queue answers for the next calls. */
  answers(...a: (SkyGlanceAnswer | Error)[]): this {
    this.queue.push(...a);
    return this;
  }
  /** The next call stays open until `settle`. */
  hold(): this {
    this.queue.push(HOLD as unknown as SkyGlanceAnswer);
    return this;
  }
  settle(a: SkyGlanceAnswer | Error): void {
    const w = this.waiting.shift()!;
    if (a instanceof Error) w.reject(a);
    else w.resolve(a);
  }

  get(t?: string): Promise<SkyGlanceAnswer> {
    this.calls.push(t);
    this.log.push(`get ${t ?? "-"}`);
    const next = this.queue.shift();
    if (next === (HOLD as unknown)) return new Promise((resolve, reject) => this.waiting.push({ resolve, reject }));
    if (next === undefined) return Promise.reject(new Error("no answer queued"));
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  }

  release(): Promise<void> {
    this.releases++;
    this.log.push("release");
    return this.releaseFails ? Promise.reject(new Error("release failed")) : Promise.resolve();
  }
}
const HOLD = Symbol("hold");

const T = "2026-11-12T10:00:00.000Z";
const reply = (status: SkyGlanceAnswer["status"], extra: Partial<SkyGlanceAnswer> = {}): SkyGlanceAnswer => ({
  status,
  t0: T,
  hours: 8,
  sats: [],
  messages: [],
  ...extra,
});
const ok = (name = "A"): SkyGlanceAnswer => reply("ok", { sats: [{ norad: 1, name, colour: "#3c46c8", passes: [] }] });

/** Lets the promises that have settled run their handlers. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0)); // the feed has its own FakeTimer, this one is the real one

function setup() {
  const api = new FakeApi();
  const timer = new FakeTimer();
  const views: SkyView[] = [];
  const feed = new SkyGlanceFeed(api, (v) => views.push(v), timer);
  return { api, timer, views, feed, last: () => views[views.length - 1]! };
}

describe("the first drawing (controller ruling on t, ref-P §7.1, §7.7)", () => {
  it("asks with t, and with the same t at every poll while that drawing is computing", async () => {
    const { api, timer, feed, last } = setup();
    api.answers(reply("computing"), reply("computing"), ok());
    feed.first(T);
    await flush();
    expect(api.calls).toEqual([T]);
    expect(timer.delays).toEqual([SKY_POLL_MS]);
    timer.fire();
    await flush();
    timer.fire();
    await flush();
    expect(api.calls).toEqual([T, T, T]);
    expect(last().answer?.status).toBe("ok");
    expect(timer.pending.size).toBe(0); // done: no more polls
  });

  it("polls every second", () => {
    expect(SKY_POLL_MS).toBe(1000);
  });

  it("while it computes the view says so and has no picture yet", async () => {
    const { api, feed, views, last } = setup();
    api.answers(reply("computing"));
    feed.first(T);
    expect(views).toEqual([{ answer: null, computing: true, error: null }]);
    await flush();
    expect(last()).toEqual({ answer: null, computing: true, error: null });
  });

  it("when GMAT has it at once, the first answer is the picture", async () => {
    const { api, feed, last } = setup();
    const a = ok();
    api.answers(a);
    feed.first(T);
    await flush();
    expect(last()).toEqual({ answer: a, computing: false, error: null });
    expect(api.calls).toEqual([T]);
  });
});

describe("later drawings", () => {
  it("a rebuild asks without t, and polls without t", async () => {
    const { api, timer, feed, last } = setup();
    const first = ok("first");
    const second = ok("second");
    api.answers(first, reply("computing"), second);
    feed.first(T);
    await flush();
    feed.rebuild();
    await flush();
    timer.fire();
    await flush();
    expect(api.calls).toEqual([T, undefined, undefined]);
    expect(last().answer).toBe(second);
  });

  it("while a rebuild computes the old picture stays", async () => {
    const { api, feed, views, last } = setup();
    const first = ok("first");
    api.answers(first, reply("computing"));
    feed.first(T);
    await flush();
    feed.rebuild();
    expect(last()).toEqual({ answer: first, computing: true, error: null });
    await flush();
    expect(last()).toEqual({ answer: first, computing: true, error: null });
    expect(views.every((v) => v.answer === null || v.answer === first)).toBe(true);
  });

  it("a rebuild while the first drawing computes takes over: the answers of the first are dropped", async () => {
    const { api, timer, feed, last } = setup();
    const second = ok("second");
    api.answers(reply("computing"), second);
    feed.first(T);
    await flush();
    expect(timer.pending.size).toBe(1);
    feed.rebuild();
    expect(timer.pending.size).toBe(0); // the poll of the first is gone
    await flush();
    expect(api.calls).toEqual([T, undefined]);
    expect(last().answer).toBe(second);
  });

  it("an answer that comes after a newer request was made is dropped", async () => {
    const { api, feed, last } = setup();
    const newer = ok("newer");
    api.hold().answers(newer);
    feed.first(T);
    feed.rebuild();
    await flush();
    api.settle(ok("older"));
    await flush();
    expect(last().answer).toBe(newer);
  });
});

describe("one request at a time (the server builds every drawing it is asked for)", () => {
  it("a rebuild while a request is open waits for its answer, then asks once without t", async () => {
    const { api, feed, last } = setup();
    const newer = ok("newer");
    api.hold().answers(newer);
    feed.first(T);
    feed.rebuild();
    feed.rebuild();
    await flush();
    expect(api.calls).toEqual([T]); // nothing more while the first is open
    expect(last()).toEqual({ answer: null, computing: true, error: null });
    api.settle(ok("older"));
    await flush();
    expect(api.calls).toEqual([T, undefined]); // two rebuilds, one request
    expect(last()).toEqual({ answer: newer, computing: false, error: null });
  });

  it("a rebuild while a poll is open waits for it too", async () => {
    const { api, timer, feed, last } = setup();
    const first = ok("first");
    const second = ok("second");
    api.answers(first, reply("computing")).hold().answers(second);
    feed.first(T);
    await flush();
    feed.rebuild();
    await flush();
    timer.fire(); // the poll of the rebuild is open
    await flush();
    feed.rebuild();
    feed.rebuild();
    await flush();
    expect(api.calls).toEqual([T, undefined, undefined]);
    api.settle(reply("computing"));
    await flush();
    expect(api.calls).toEqual([T, undefined, undefined, undefined]);
    expect(timer.pending.size).toBe(0); // the answer of the open poll was dropped: no poll for it
    expect(last()).toEqual({ answer: second, computing: false, error: null });
  });

  it("the failure of the open request is dropped when a rebuild waits", async () => {
    const { api, feed, last } = setup();
    const newer = ok("newer");
    api.hold().answers(newer);
    feed.first(T);
    feed.rebuild();
    api.settle(new Error("the server went away"));
    await flush();
    expect(api.calls).toEqual([T, undefined]);
    expect(last()).toEqual({ answer: newer, computing: false, error: null });
  });

  it("closing the window while a rebuild waits asks for nothing more", async () => {
    const { api, feed } = setup();
    api.hold();
    feed.first(T);
    feed.rebuild();
    feed.stop();
    api.settle(ok());
    await flush();
    expect(api.calls).toEqual([T]);
  });

  it("Retry while a request is open waits for it too", async () => {
    const { api, feed, last } = setup();
    const second = ok("second");
    api.answers(reply("failed")).hold().answers(second);
    feed.first(T);
    await flush();
    feed.rebuild(); // open
    feed.retry(); // the release goes now, the request after the open one lands
    await flush();
    expect(api.log).toEqual([`get ${T}`, "get -", "release"]);
    api.settle(ok("dropped"));
    await flush();
    expect(api.log).toEqual([`get ${T}`, "get -", "release", "get -"]);
    expect(last().answer).toBe(second);
  });
});

describe("failure", () => {
  it("failed shows the error text of the server and stops polling", async () => {
    const { api, timer, feed, last } = setup();
    api.answers(
      reply("failed", {
        messages: [
          { code: "GMAT_FAILED", level: "error", text: "GMAT ล้มเหลว", object: null },
          { code: "SAT_MISSING_FROM_GMAT", level: "warning", text: "ไม่มีดาว", object: "1" },
        ],
      }),
    );
    feed.first(T);
    await flush();
    expect(last()).toEqual({ answer: null, computing: false, error: "GMAT ล้มเหลว" });
    expect(timer.pending.size).toBe(0);
  });

  it("failed without a message still says something", async () => {
    const { api, feed, last } = setup();
    api.answers(reply("failed"));
    feed.first(T);
    await flush();
    expect(last().error).toBe("GMAT คำนวณวงโคจรไม่สำเร็จ");
  });

  it("a failed rebuild leaves the old picture, with the error beside it", async () => {
    const { api, feed, last } = setup();
    const first = ok();
    api.answers(first, reply("failed", { messages: [{ code: "GMAT_FAILED", level: "error", text: "ล้ม", object: null }] }));
    feed.first(T);
    await flush();
    feed.rebuild();
    await flush();
    expect(last()).toEqual({ answer: first, computing: false, error: "ล้ม" });
  });

  it("a request that fails (the server is not there, the module is not open) shows its text and stops", async () => {
    const { api, timer, feed, last } = setup();
    api.answers(new ApiError("MODULE_NOT_OPEN", "module ไม่ได้เปิดอยู่", 404));
    feed.first(T);
    await flush();
    expect(last()).toEqual({ answer: null, computing: false, error: "module ไม่ได้เปิดอยู่" });
    expect(timer.pending.size).toBe(0);
  });

  it("Retry releases what the server holds, then asks again as the failed request did: the first drawing with the same t", async () => {
    const { api, feed, last } = setup();
    api.answers(reply("failed"), ok());
    feed.first(T);
    await flush();
    feed.retry();
    expect(last()).toEqual({ answer: null, computing: true, error: null });
    await flush();
    expect(api.log).toEqual([`get ${T}`, "release", `get ${T}`]);
    expect(last().answer?.status).toBe("ok");
  });

  it("Retry of a failed rebuild asks without t", async () => {
    const { api, feed } = setup();
    api.answers(ok(), reply("failed"), ok());
    feed.first(T);
    await flush();
    feed.rebuild();
    await flush();
    feed.retry();
    await flush();
    expect(api.log).toEqual([`get ${T}`, "get -", "release", "get -"]);
  });

  it("Retry goes on when the release fails", async () => {
    const { api, feed, last } = setup();
    api.releaseFails = true;
    api.answers(reply("failed"), ok());
    feed.first(T);
    await flush();
    feed.retry();
    await flush();
    expect(last().answer?.status).toBe("ok");
  });
});

describe("stop (closing the window)", () => {
  it("releases the server's work", async () => {
    const { api, feed } = setup();
    api.answers(ok());
    feed.first(T);
    await flush();
    feed.stop();
    expect(api.releases).toBe(1);
  });

  it("drops the poll that was waiting and the answer that was on its way, and tells nothing more", async () => {
    const { api, timer, feed, views } = setup();
    api.answers(reply("computing")).hold();
    feed.first(T);
    await flush();
    timer.fire();
    await flush(); // the second request is open
    const told = views.length;
    feed.stop();
    api.settle(ok());
    await flush();
    expect(views).toHaveLength(told);
    expect(timer.pending.size).toBe(0);
  });

  it("cancels a poll that is waiting", async () => {
    const { api, timer, feed } = setup();
    api.answers(reply("computing"));
    feed.first(T);
    await flush();
    expect(timer.pending.size).toBe(1);
    feed.stop();
    expect(timer.pending.size).toBe(0);
  });

  it("is not stopped by a release that fails", async () => {
    const { api, feed } = setup();
    api.releaseFails = true;
    api.answers(ok());
    feed.first(T);
    await flush();
    expect(() => feed.stop()).not.toThrow();
    await flush(); // an unhandled rejection would fail the run here
  });

  it("a stopped feed asks for nothing more", async () => {
    const { api, feed } = setup();
    feed.stop();
    feed.first(T);
    feed.rebuild();
    feed.retry();
    await flush();
    expect(api.calls).toEqual([]);
  });
});
