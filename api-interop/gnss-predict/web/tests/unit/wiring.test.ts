import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { startEventWiring } from "../../src/api/events";
import { useJobs } from "../../src/stores/jobs";
import { useMessages, type Message } from "../../src/stores/messages";
import { useResults } from "../../src/stores/results";
import { useScenario } from "../../src/stores/scenario";
import { useSettings } from "../../src/stores/settings";
import { makeDoc } from "./helpers/chrome";
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
  vi.setSystemTime(new Date("2026-12-01T00:00:00Z")); // หลังเวลาของข้อความ server ใน test ทั้งหมด (ข้อความที่หน้าเว็บสร้างเองจึงใหม่กว่าเสมอ)
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

  describe("a failed backfill", () => {
    const serverCodes = () => codes().filter((c) => c !== "BACKFILL");
    const warnings = () => useMessages.getState().items.filter((x) => x.level === "warning");
    let answer: Message[] | "fail" = [];
    const reply = () => (answer === "fail" ? { status: 500, json: { code: "INTERNAL", text: "ขัดข้อง" } } : { json: answer });

    test("warns once in Thai, retries from the last good point and recovers the missed messages with no gap and no duplicates", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      answer = [m(1, "A"), m(5, "B")];
      const f = server({ "GET /api/messages": reply });
      stop = startEventWiring();
      FakeEventSource.last.open();
      await flush();
      expect(serverCodes()).toEqual(["A", "B"]);

      FakeEventSource.last.fail();
      await vi.advanceTimersByTimeAsync(1000);
      answer = "fail";
      FakeEventSource.last.open();
      await flush();
      expect(warnings()).toHaveLength(1);
      expect(warnings()[0].text).toMatch(/[\u0E00-\u0E7F]/);

      // ข้อความสดมาถึงระหว่างที่ backfill ยังล้ม: แสดงทันที แต่ไม่ทำให้จุดเริ่มของ backfill ขยับ
      FakeEventSource.last.emit("message", m(10, "C"));
      await flush();
      expect(serverCodes()).toEqual(["A", "B", "C"]);
      await vi.advanceTimersByTimeAsync(1000); // ลองใหม่ครั้งที่ 1 ล้มอีก
      expect(warnings()).toHaveLength(1); // เตือนครั้งเดียวต่อช่วงที่ล้ม ไม่ซ้ำทุกรอบ

      answer = [m(5, "B"), m(7, "MISSED"), m(10, "C")];
      await vi.advanceTimersByTimeAsync(2000); // ลองใหม่ครั้งที่ 2 สำเร็จ
      expect(serverCodes()).toEqual(["A", "B", "MISSED", "C"]);
      const sinces = f.calls.filter((c) => c.path === "/api/messages").map((c) => c.query.get("since"));
      expect(sinces).toEqual([null, "2026-11-12T01:00:05.249Z", "2026-11-12T01:00:05.249Z", "2026-11-12T01:00:05.249Z"]);
      expect(warnings()).toHaveLength(1);
      spy.mockRestore();
    });

    test("after it recovers, the next backfill starts from the newest server message, not from a locally generated one", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      answer = [m(1, "A")];
      const f = server({ "GET /api/messages": reply });
      stop = startEventWiring();
      FakeEventSource.last.open();
      await flush();
      FakeEventSource.last.fail();
      await vi.advanceTimersByTimeAsync(1000);
      answer = "fail";
      FakeEventSource.last.open();
      await flush();
      answer = [m(1, "A"), m(3, "D")];
      await vi.advanceTimersByTimeAsync(1000);
      expect(serverCodes()).toEqual(["A", "D"]);
      // คำเตือนที่หน้าเว็บสร้างเองใช้นาฬิกาของเครื่องนี้ (ใหม่กว่าข้อความของ server มาก) ต้องไม่ถูกใช้เป็นจุดเริ่ม
      expect(Date.parse(useMessages.getState().lastTime ?? "")).toBeGreaterThan(Date.parse(useMessages.getState().lastServerTime ?? ""));
      FakeEventSource.last.fail();
      await vi.advanceTimersByTimeAsync(1000);
      FakeEventSource.last.open();
      await flush();
      expect(f.calls.filter((c) => c.path === "/api/messages").at(-1)?.query.get("since")).toBe("2026-11-12T01:00:02.999Z");
      spy.mockRestore();
    });

    test("a hung request times out after 10 s, the held live events arrive and the backfill is retried", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      let hang = true;
      const f = server({ "GET /api/messages": () => (hang ? new Promise(() => undefined) : { json: [m(2, "LATE")] }) });
      stop = startEventWiring();
      FakeEventSource.last.open();
      FakeEventSource.last.emit("message", m(3, "LIVE"));
      await vi.advanceTimersByTimeAsync(9_999);
      expect(serverCodes()).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      expect(serverCodes()).toEqual(["LIVE"]);
      expect(warnings()).toHaveLength(1);
      hang = false;
      await vi.advanceTimersByTimeAsync(1000);
      expect(serverCodes()).toEqual(["LATE", "LIVE"]);
      expect(f.calls.filter((c) => c.path === "/api/messages")).toHaveLength(2);
      spy.mockRestore();
    });
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

  test("a live message counts as a server message, a warning made by the page does not", async () => {
    server();
    stop = startEventWiring();
    FakeEventSource.last.open();
    await flush();
    FakeEventSource.last.emit("message", m(2, "LIVE"));
    await flush();
    expect(useMessages.getState().lastServerTime).toBe(m(2).time);
    useMessages.getState().add({ time: "2026-12-01T00:00:00.000Z", level: "warning", code: "LOCAL", text: "x", object: null });
    expect(useMessages.getState().lastServerTime).toBe(m(2).time);
    expect(useMessages.getState().lastTime).toBe("2026-12-01T00:00:00.000Z");
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

  describe("a daily job that succeeds (the daily writes send no scenario event, and the job has scenario null)", () => {
    const DAILY = "daily_20261113";
    const dailyDoc = (over: object = {}) => makeDoc({ name: DAILY, daily: { for_date: "2026-11-13", created_utc: "2026-11-12T21:00:00Z" }, ...over } as never);
    const tree = { path: "*", class: "Scenario", name: DAILY, children: [] };
    const dailyJob = (state: string) => ({ id: "d1", kind: "daily", scenario: null, state, progress: { stage: "analyze", fraction: 1 } });

    function dailyServer() {
      return server({
        [`GET /api/scenarios/${DAILY}`]: { json: dailyDoc(), headers: { ETag: '"2222222222222222"' } },
        [`GET /api/scenarios/${DAILY}/objects`]: { json: tree },
        [`GET /api/scenarios/${DAILY}/results`]: { json: RESULTS_MISSING },
      });
    }

    test("reloads the open daily scenario and its results, so the next Apply does not hit a surprise 412", async () => {
      const f = dailyServer();
      useScenario.setState({ name: DAILY, doc: dailyDoc(), etag: '"1111111111111111"' });
      stop = startEventWiring();
      FakeEventSource.last.open();
      await flush();
      FakeEventSource.last.emit("job", dailyJob("running"));
      await flush();
      expect(f.count(`GET /api/scenarios/${DAILY}`)).toBe(0);
      expect(f.count(`GET /api/scenarios/${DAILY}/results`)).toBe(0);
      FakeEventSource.last.emit("job", dailyJob("succeeded"));
      await flush();
      expect(f.count(`GET /api/scenarios/${DAILY}`)).toBe(1);
      expect(f.count(`GET /api/scenarios/${DAILY}/objects`)).toBe(1);
      expect(f.count(`GET /api/scenarios/${DAILY}/results`)).toBe(1);
      expect(useScenario.getState().etag).toBe('"2222222222222222"');
    });

    test("a scenario named daily_<YYYYMMDD> counts as a daily one even if its doc has no daily field", async () => {
      const f = dailyServer();
      useScenario.setState({ name: DAILY, doc: makeDoc({ name: DAILY }), etag: '"1111111111111111"' });
      stop = startEventWiring();
      FakeEventSource.last.open();
      await flush();
      FakeEventSource.last.emit("job", dailyJob("succeeded"));
      await flush();
      expect(f.count(`GET /api/scenarios/${DAILY}`)).toBe(1);
      expect(f.count(`GET /api/scenarios/${DAILY}/results`)).toBe(1);
    });

    test("leaves a scenario that is not a daily one alone, and so does a daily job that fails or is cancelled", async () => {
      const f = server({ "GET /api/scenarios/E2E": { json: makeDoc({ name: "E2E" }), headers: { ETag: '"2222222222222222"' } } });
      useScenario.setState({ name: "E2E", doc: makeDoc({ name: "E2E" }), etag: '"1111111111111111"' });
      stop = startEventWiring();
      FakeEventSource.last.open();
      await flush();
      FakeEventSource.last.emit("job", dailyJob("succeeded"));
      await flush();
      expect(f.count("GET /api/scenarios/E2E")).toBe(0);
      expect(f.count("GET /api/scenarios/E2E/results")).toBe(0);

      stop();
      const g = dailyServer();
      useScenario.setState({ name: DAILY, doc: dailyDoc(), etag: '"1111111111111111"' });
      stop = startEventWiring();
      FakeEventSource.last.open();
      await flush();
      FakeEventSource.last.emit("job", { ...dailyJob("failed"), id: "d2" });
      FakeEventSource.last.emit("job", { ...dailyJob("cancelled"), id: "d3" });
      await flush();
      expect(g.count(`GET /api/scenarios/${DAILY}`)).toBe(0);
      expect(g.count(`GET /api/scenarios/${DAILY}/results`)).toBe(0);
    });

    test("does nothing with no scenario open", async () => {
      const f = dailyServer();
      stop = startEventWiring();
      FakeEventSource.last.open();
      await flush();
      FakeEventSource.last.emit("job", dailyJob("succeeded"));
      await flush();
      expect(f.calls.filter((c) => c.path.startsWith("/api/scenarios"))).toEqual([]);
    });
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
