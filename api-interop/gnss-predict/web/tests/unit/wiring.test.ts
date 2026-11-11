import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { startEventWiring } from "../../src/api/events";
import { useJobs } from "../../src/stores/jobs";
import { useMessages, type Message } from "../../src/stores/messages";
import { useResults } from "../../src/stores/results";
import { useScenario } from "../../src/stores/scenario";
import { useSettings } from "../../src/stores/settings";
import { deferred, stubFetch, type Handler } from "./helpers/fake-fetch";
import { FakeES, FakeEventSource } from "./helpers/fake-event-source";

const m = (sec: number, code = "C", level: Message["level"] = "info"): Message => ({
  time: new Date(Date.UTC(2026, 10, 12, 1, 0, 0) + sec * 1000 + (sec === 5 ? 250 : 0)).toISOString(), level, code, text: code, object: null,
});
const HEALTH = { engine_version: "1", gmat_found: true, data_dir: "/d", free_bytes: 1e12, writable: true, daily: { state: "idle", last_run_utc: null, next_run_utc: null, for_date: null } };
const RESULTS_MISSING = { ephem: { hash: null, status: "missing", available: [] }, access: {}, error: null };

const flush = () => vi.advanceTimersByTimeAsync(0);
const codes = () => useMessages.getState().items.map((x) => x.code);

function server(over: Record<string, Handler> = {}) {
  return stubFetch({
    "GET /api/messages": { json: [] },
    "GET /api/health": { json: HEALTH },
    "GET /api/jobs": { json: [] },
    "GET /api/scenarios/E2E/results": { json: RESULTS_MISSING },
    ...over,
  });
}

let stop: (() => void) | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("EventSource", FakeES);
  FakeEventSource.reset();
  useJobs.setState(useJobs.getInitialState(), true);
  useMessages.setState(useMessages.getInitialState(), true);
  useResults.setState(useResults.getInitialState(), true);
  useScenario.setState(useScenario.getInitialState(), true);
  useSettings.setState(useSettings.getInitialState(), true);
});
afterEach(() => {
  stop?.();
  stop = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("startEventWiring", () => {
  test("connected follows the stream status", async () => {
    server();
    stop = startEventWiring();
    expect(useSettings.getState().connected).toBe(false);
    FakeEventSource.last.open();
    await flush();
    expect(useSettings.getState().connected).toBe(true);
    FakeEventSource.last.fail();
    expect(useSettings.getState().connected).toBe(false);
    stop();
    stop = undefined;
  });

  test("the first connection loads the message history, the health and the jobs", async () => {
    const f = server({ "GET /api/messages": { json: [m(1, "A"), m(2, "B")] }, "GET /api/jobs": { json: [{ id: "j1", kind: "propagate", scenario: "E2E", state: "running", progress: { stage: "gmat", fraction: 0.1 }, error: null, messages: [] }] } });
    stop = startEventWiring();
    FakeEventSource.last.open();
    await flush();
    const first = f.calls.find((c) => c.path === "/api/messages")!;
    expect(first.query.has("since")).toBe(false);
    expect(codes()).toEqual(["A", "B"]);
    expect(useSettings.getState().health?.engine_version).toBe("1");
    expect(useJobs.getState().jobs.j1.state).toBe("running");
    expect(useJobs.getState().daily?.state).toBe("idle");
  });

  test("a reconnect backfills from just before the newest message and drops the ones already held", async () => {
    let answer: Message[] = [m(1, "A"), m(5, "B")];
    const f = server({ "GET /api/messages": () => ({ json: answer }) });
    stop = startEventWiring();
    FakeEventSource.last.open();
    await flush();
    expect(codes()).toEqual(["A", "B"]);

    FakeEventSource.last.fail();
    expect(useSettings.getState().connected).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    // ระหว่างที่หลุดมีข้อความใหม่สองข้อความ ข้อความหนึ่งเกิดในมิลลิวินาทีเดียวกับ B
    answer = [{ ...m(5, "B2") }, m(5, "B"), m(9, "D")];
    FakeEventSource.last.open();
    await flush();
    const second = f.calls.filter((c) => c.path === "/api/messages")[1];
    expect(second.query.get("since")).toBe("2026-11-12T01:00:05.249Z"); // ถอย 1 ms กันข้อความที่เกิดในมิลลิวินาทีเดียวกัน
    expect(codes()).toEqual(["A", "B", "B2", "D"]); // B ที่ซ้ำไม่ถูกเพิ่ม
    expect(useSettings.getState().connected).toBe(true);
  });

  test("live messages wait for the backfill, so the list is never out of order", async () => {
    const gate = deferred<{ json: Message[] }>();
    server({ "GET /api/messages": () => gate.promise });
    stop = startEventWiring();
    FakeEventSource.last.open();
    FakeEventSource.last.emit("message", m(3, "LIVE"));
    await flush();
    expect(codes()).toEqual([]);
    gate.resolve({ json: [m(1, "OLD")] });
    await flush();
    expect(codes()).toEqual(["OLD", "LIVE"]);
    FakeEventSource.last.emit("message", m(4, "LIVE2"));
    await flush();
    expect(codes()).toEqual(["OLD", "LIVE", "LIVE2"]);
  });

  test("a message event that is not a message is ignored", async () => {
    server();
    stop = startEventWiring();
    FakeEventSource.last.open();
    await flush();
    FakeEventSource.last.emit("message", { hello: 1 });
    FakeEventSource.last.emit("message", m(2, "OK"));
    await flush();
    expect(codes()).toEqual(["OK"]);
  });

  test("job events go to the jobs store; a success on the open scenario refreshes the results", async () => {
    const f = server();
    useScenario.setState({ name: "E2E" });
    stop = startEventWiring();
    FakeEventSource.last.open();
    await flush();
    const job = (over: object) => ({ id: "j1", kind: "propagate", scenario: "E2E", state: "running", progress: { stage: "gmat", fraction: 0.5 }, ...over });
    FakeEventSource.last.emit("job", job({}));
    await flush();
    expect(useJobs.getState().jobs.j1.state).toBe("running");
    expect(f.count("GET /api/scenarios/E2E/results")).toBe(0);
    FakeEventSource.last.emit("job", job({ id: "j2", scenario: "OTHER", state: "succeeded" }));
    FakeEventSource.last.emit("job", job({ id: "j3", scenario: "E2E", state: "failed" }));
    await flush();
    expect(f.count("GET /api/scenarios/E2E/results")).toBe(0);
    FakeEventSource.last.emit("job", job({ state: "succeeded" }));
    await flush();
    expect(useJobs.getState().jobs.j1.state).toBe("succeeded");
    expect(f.count("GET /api/scenarios/E2E/results")).toBe(1);
  });

  test("scenario events go to the scenario store and daily events to the jobs store", async () => {
    const f = server();
    useScenario.setState({ name: "E2E", etag: '"1111111111111111"' });
    stop = startEventWiring();
    FakeEventSource.last.open();
    await flush();
    FakeEventSource.last.emit("scenario", { name: "E2E", etag: "1111111111111111", results_stale: true });
    FakeEventSource.last.emit("daily", { state: "running", last_run_utc: null, next_run_utc: null, for_date: "2026-11-13" });
    FakeEventSource.last.emit("ping", {});
    await flush();
    expect(f.count("GET /api/scenarios/E2E/results")).toBe(1);
    expect(useJobs.getState().daily?.state).toBe("running");
  });

  test("a reconnect also resyncs the open scenario, the results, the jobs and the health", async () => {
    const f = server({
      "GET /api/scenarios/E2E": { json: { name: "E2E" }, headers: { ETag: '"1111111111111111"' } },
    });
    useScenario.setState({ name: "E2E", etag: '"1111111111111111"' });
    stop = startEventWiring();
    FakeEventSource.last.open();
    await flush();
    expect(f.count("GET /api/scenarios/E2E/results")).toBe(0); // ต่อครั้งแรกไม่ต้อง (load ทำไปแล้ว)
    FakeEventSource.last.fail();
    await vi.advanceTimersByTimeAsync(1000);
    FakeEventSource.last.open();
    await flush();
    expect(f.count("GET /api/scenarios/E2E/results")).toBe(1);
    expect(f.count("GET /api/scenarios/E2E")).toBe(1); // เทียบ ETag ว่าพลาด event หรือไม่ (เท่ากัน จึงไม่โหลด tree)
    expect(f.count("GET /api/scenarios/E2E/objects")).toBe(0);
    expect(f.count("GET /api/jobs")).toBe(2);
    expect(f.count("GET /api/health")).toBe(2);
  });

  test("the stop function closes the stream and marks the server disconnected", async () => {
    server();
    stop = startEventWiring();
    FakeEventSource.last.open();
    await flush();
    const es = FakeEventSource.last;
    stop();
    stop = undefined;
    expect(es.closed).toBe(true);
    expect(useSettings.getState().connected).toBe(false);
  });
});
