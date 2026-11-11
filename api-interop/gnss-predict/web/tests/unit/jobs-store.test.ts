import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useJobs, type JobEvent } from "../../src/stores/jobs";
import { stubFetch } from "./helpers/fake-fetch";

const ev = (over: Partial<JobEvent> = {}): JobEvent => ({
  id: "j1", kind: "propagate", scenario: "E2E", state: "running", progress: { stage: "gmat", fraction: 0.4 }, ...over,
});

beforeEach(() => useJobs.setState(useJobs.getInitialState(), true));
afterEach(() => vi.unstubAllGlobals());

describe("useJobs", () => {
  test("a job event creates the job and later events update it in place", () => {
    useJobs.getState().onJobEvent(ev());
    expect(useJobs.getState().jobs.j1).toMatchObject({ state: "running", progress: { stage: "gmat", fraction: 0.4 }, error: null });
    useJobs.getState().onJobEvent(ev({ state: "failed", progress: { stage: "gmat", fraction: 0.5 }, error: { code: "GMAT_FAILED", text: "ล้ม", detail: null } }));
    const j = useJobs.getState().jobs.j1;
    expect(Object.keys(useJobs.getState().jobs)).toEqual(["j1"]);
    expect(j.state).toBe("failed");
    expect(j.error?.code).toBe("GMAT_FAILED");
    expect(j.kind).toBe("propagate");
  });

  test("an event keeps the fields of the full record that the event does not carry", () => {
    useJobs.setState({ jobs: { j1: { ...ev(), params: { a: 1 }, created_utc: "2026-11-12T00:00:00.000Z", origin: "user" } as never } });
    useJobs.getState().onJobEvent(ev({ state: "succeeded" }));
    expect(useJobs.getState().jobs.j1).toMatchObject({ state: "succeeded", origin: "user", created_utc: "2026-11-12T00:00:00.000Z" });
  });

  test("activeFor gives the running job of a scenario, else a queued one, else nothing", () => {
    expect(useJobs.getState().activeFor("E2E")).toBeUndefined();
    useJobs.getState().onJobEvent(ev({ id: "q1", state: "queued" }));
    useJobs.getState().onJobEvent(ev({ id: "d1", state: "succeeded" }));
    useJobs.getState().onJobEvent(ev({ id: "o1", scenario: "OTHER", state: "running" }));
    expect(useJobs.getState().activeFor("E2E")?.id).toBe("q1");
    useJobs.getState().onJobEvent(ev({ id: "r1", state: "running" }));
    expect(useJobs.getState().activeFor("E2E")?.id).toBe("r1");
    expect(useJobs.getState().activeFor("NOPE")).toBeUndefined();
  });

  test("cancel posts to the job and stores the record the server sends back", async () => {
    const f = stubFetch({ "POST /api/jobs/j1/cancel": { json: { ...ev({ state: "cancelled" }), messages: [] } } });
    useJobs.getState().onJobEvent(ev());
    await useJobs.getState().cancel("j1");
    expect(f.calls[0].method).toBe("POST");
    expect(useJobs.getState().jobs.j1.state).toBe("cancelled");
  });

  test("refresh loads the job list from the server", async () => {
    stubFetch({ "GET /api/jobs": { json: [{ ...ev({ id: "a", state: "running" }), messages: [] }, { ...ev({ id: "b", state: "succeeded" }), messages: [] }] } });
    await useJobs.getState().refresh();
    expect(Object.keys(useJobs.getState().jobs).sort()).toEqual(["a", "b"]);
  });

  test("a failing refresh keeps what is there and does not throw", async () => {
    useJobs.getState().onJobEvent(ev());
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await expect(useJobs.getState().refresh()).resolves.toBeUndefined();
    expect(useJobs.getState().jobs.j1).toBeDefined();
  });

  test("onDailyEvent stores the daily status", () => {
    const daily = { state: "ok" as const, last_run_utc: "2026-11-12T00:00:00.000Z", next_run_utc: "2026-11-13T21:00:00.000Z", for_date: "2026-11-13" };
    expect(useJobs.getState().daily).toBeNull();
    useJobs.getState().onDailyEvent(daily);
    expect(useJobs.getState().daily).toEqual(daily);
  });
});
