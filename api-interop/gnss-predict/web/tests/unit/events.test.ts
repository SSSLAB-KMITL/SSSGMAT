import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { connectEvents } from "../../src/api/events";
import { deferred } from "./helpers/fake-fetch";
import { FakeES, FakeEventSource } from "./helpers/fake-event-source";

type Ev = [string, unknown];

beforeEach(() => {
  vi.useFakeTimers();
  FakeEventSource.reset();
});
afterEach(() => vi.useRealTimers());

const flush = () => vi.advanceTimersByTimeAsync(0);
const T1 = "2026-11-12T01:00:00.000Z";
const T2 = "2026-11-12T01:00:05.250Z";

function setup(backfill?: (since: string | null) => Promise<void>, backoffS?: number[]) {
  const events: Ev[] = [];
  const statuses: boolean[] = [];
  const stop = connectEvents(
    { onEvent: (name, data) => events.push([name, data]), onStatus: (c) => statuses.push(c) },
    { EventSourceImpl: FakeES, backfill, backoffS },
  );
  return { events, statuses, stop };
}

describe("connectEvents", () => {
  test("connects to /api/events and passes the five event kinds with parsed data", async () => {
    const { events } = setup();
    expect(FakeEventSource.last.url).toBe("/api/events");
    FakeEventSource.last.open();
    await flush();
    const es = FakeEventSource.last;
    es.emit("ping", {});
    es.emit("job", { id: "j1", state: "running" });
    es.emit("message", { time: T1, level: "info", code: "X", text: "t", object: null });
    es.emit("scenario", { name: "E2E", etag: "abc", results_stale: false });
    es.emit("daily", { state: "ok" });
    await flush();
    expect(events.map((e) => e[0])).toEqual(["ping", "job", "message", "scenario", "daily"]);
    expect(events[1][1]).toEqual({ id: "j1", state: "running" });
  });

  test("an event whose data is not JSON is dropped without breaking the stream", async () => {
    const { events } = setup();
    FakeEventSource.last.open();
    FakeEventSource.last.emit("job", "{not json");
    FakeEventSource.last.emit("ping", {});
    await flush();
    expect(events.map((e) => e[0])).toEqual(["ping"]);
  });

  test("events reconnect with backoff and backfills missed messages", async () => {
    const backfill = vi.fn(async (_since: string | null) => undefined);
    const { statuses } = setup(backfill);

    // ต่อได้ครั้งแรก: backfill เรียกด้วย null (ยังไม่เคยเห็นข้อความ) แล้วเห็นข้อความสองข้อความสด
    FakeEventSource.last.open();
    await flush();
    expect(statuses).toEqual([true]);
    expect(backfill).toHaveBeenCalledTimes(1);
    expect(backfill).toHaveBeenLastCalledWith(null);
    FakeEventSource.last.emit("message", { time: T1, level: "info", code: "A", text: "a", object: null });
    FakeEventSource.last.emit("message", { time: T2, level: "info", code: "B", text: "b", object: null });
    await flush();

    // error 7 ครั้งติด: หน่วง 1, 2, 4, 8, 16, 30, 30 วินาที (ครั้งแรกหน่วง 1 s เพราะเพิ่งต่อสำเร็จ)
    const delays = [1, 2, 4, 8, 16, 30, 30];
    for (const [i, s] of delays.entries()) {
      const before = FakeEventSource.instances.length;
      FakeEventSource.last.fail();
      expect(FakeEventSource.last.closed, `failure ${i + 1} closes the source`).toBe(true);
      await vi.advanceTimersByTimeAsync(s * 1000 - 1);
      expect(FakeEventSource.instances.length, `before ${s} s (failure ${i + 1})`).toBe(before);
      await vi.advanceTimersByTimeAsync(1);
      expect(FakeEventSource.instances.length, `after ${s} s (failure ${i + 1})`).toBe(before + 1);
    }
    expect(statuses).toEqual([true, false]); // false ครั้งเดียว ไม่ซ้ำทุก error
    expect(backfill).toHaveBeenCalledTimes(1); // ยังไม่ต่อได้ จึงยังไม่ backfill

    // ต่อได้แล้ว: onStatus(true), backfill ด้วยเวลาของข้อความสดล่าสุด
    FakeEventSource.last.open();
    await flush();
    expect(statuses).toEqual([true, false, true]);
    expect(backfill).toHaveBeenCalledTimes(2);
    expect(backfill).toHaveBeenLastCalledWith(T2);

    // ต่อสำเร็จแล้ว backoff กลับเป็น 1 s
    const before = FakeEventSource.instances.length;
    FakeEventSource.last.fail();
    await vi.advanceTimersByTimeAsync(999);
    expect(FakeEventSource.instances.length).toBe(before);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeEventSource.instances.length).toBe(before + 1);
  });

  test("onStatus(false) is reported when the very first attempt fails", async () => {
    const { statuses } = setup();
    FakeEventSource.last.fail();
    expect(statuses).toEqual([false]);
  });

  test("backoff stays on the last value and honours a custom list", async () => {
    setup(undefined, [0.5, 1]);
    for (const s of [0.5, 1, 1]) {
      const before = FakeEventSource.instances.length;
      FakeEventSource.last.fail();
      await vi.advanceTimersByTimeAsync(s * 1000);
      expect(FakeEventSource.instances.length).toBe(before + 1);
    }
  });

  test("backfill is awaited before live events are applied, so order stays monotonic", async () => {
    const gate = deferred<void>();
    const order: string[] = [];
    const events: Ev[] = [];
    connectEvents(
      { onEvent: (name, data) => { order.push(`live:${name}`); events.push([name, data]); }, onStatus: () => undefined },
      { EventSourceImpl: FakeES, backfill: async () => { await gate.promise; order.push("backfill-done"); } },
    );
    FakeEventSource.last.open();
    FakeEventSource.last.emit("ping", {});
    FakeEventSource.last.emit("message", { time: T1, level: "info", code: "A", text: "a", object: null });
    await flush();
    expect(order).toEqual([]); // ยังไม่ปล่อยจนกว่า backfill จะเสร็จ
    gate.resolve();
    await flush();
    expect(order).toEqual(["backfill-done", "live:ping", "live:message"]);
    // หลัง backfill เสร็จ event สดส่งต่อทันที
    FakeEventSource.last.emit("job", { id: "j1" });
    await flush();
    expect(order.at(-1)).toBe("live:job");
  });

  test("a failing backfill does not stop the live events or the connection", async () => {
    const { events, statuses } = setup(async () => { throw new Error("boom"); });
    FakeEventSource.last.open();
    FakeEventSource.last.emit("job", { id: "j1" });
    await flush();
    expect(events.map((e) => e[0])).toEqual(["job"]);
    expect(statuses).toEqual([true]);
  });

  test("a throwing handler does not stop later events", async () => {
    const seen: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    connectEvents(
      { onEvent: (name) => { seen.push(name); if (name === "job") throw new Error("bad handler"); }, onStatus: () => undefined },
      { EventSourceImpl: FakeES },
    );
    FakeEventSource.last.open();
    FakeEventSource.last.emit("job", {});
    FakeEventSource.last.emit("ping", {});
    await flush();
    expect(seen).toEqual(["job", "ping"]);
    spy.mockRestore();
  });

  test("the returned function closes the stream, cancels a pending reconnect and silences events", async () => {
    const { events, stop } = setup();
    FakeEventSource.last.open();
    await flush();
    const first = FakeEventSource.last;
    first.fail();
    stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeEventSource.instances).toHaveLength(1); // ไม่มี reconnect หลัง stop

    const again = setup();
    FakeEventSource.last.open();
    await flush();
    const live = FakeEventSource.last;
    live.emit("job", { id: "x" });
    again.stop();
    await flush();
    expect(live.closed).toBe(true);
    expect(again.events).toEqual([]); // event ที่ค้างอยู่ตอน stop ไม่ถูกส่ง
    expect(events).toEqual([]);
  });
});
