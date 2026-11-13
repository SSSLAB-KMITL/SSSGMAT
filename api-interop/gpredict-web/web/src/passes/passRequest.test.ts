import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tick } from "../types";
import { outcomeOf, passBody, runPassRequest, WAIT_BOX_DELAY_MS } from "./passRequest";
import type { PassAnswer, PassBody, PassInfo } from "./types";

const BODY: PassBody = { norad: 25544, kind: "future", t: "2026-11-12T05:00:00.000Z" };

const ANSWER: PassAnswer = {
  sat: { norad: 25544, name: "ISS" },
  qth: { name: "Home", location: "IO91wm", lat_deg: 51.5, lon_deg: -0.1, alt_m: 10 },
  message: { code: "PASS_NONE_WITHIN", level: "info", text: "Satellite ISS has no passes\nwithin the next 3 days", object: null },
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** A fetch that answers when the test says so; an abort rejects it with the signal's reason, as the real fetch does. */
function fakeFetch() {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const resolvers: ((r: Response) => void)[] = [];
  vi.stubGlobal(
    "fetch",
    (url: string, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        calls.push({ url, init });
        resolvers.push(resolve);
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
      }),
  );
  return { calls, answer: (res: Response, index = 0) => resolvers[index]!(res) };
}

function hooks() {
  return { onWaiting: vi.fn<() => void>(), onDone: vi.fn<(a: PassAnswer) => void>(), onError: vi.fn<(text: string) => void>() };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("runPassRequest", () => {
  it("waits 500 ms before showing the waiting box (WAIT_BOX_DELAY_MS)", () => {
    expect(WAIT_BOX_DELAY_MS).toBe(500);
  });

  it("POSTs the body to the passes route of the module", async () => {
    const f = fakeFetch();
    runPassRequest("My Module", BODY, hooks());
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.url).toBe("/api/modules/My%20Module/passes");
    expect(JSON.parse(String(f.calls[0]!.init?.body))).toEqual(BODY);
  });

  it("no waiting box when the answer comes within 500 ms", async () => {
    const f = fakeFetch();
    const h = hooks();
    runPassRequest("A", BODY, h);
    await vi.advanceTimersByTimeAsync(WAIT_BOX_DELAY_MS - 1);
    f.answer(json(ANSWER));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.onDone).toHaveBeenCalledTimes(1);
    expect(h.onDone).toHaveBeenCalledWith(ANSWER);
    // the timer of the box is gone with the answer: it never fires
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.onWaiting).not.toHaveBeenCalled();
    expect(h.onError).not.toHaveBeenCalled();
  });

  it("waiting box after 500 ms", async () => {
    const f = fakeFetch();
    const h = hooks();
    runPassRequest("A", BODY, h);
    await vi.advanceTimersByTimeAsync(WAIT_BOX_DELAY_MS - 1);
    expect(h.onWaiting).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(h.onWaiting).toHaveBeenCalledTimes(1);
    expect(h.onDone).not.toHaveBeenCalled();
    // GMAT can take long: the box stays, and the answer still arrives
    await vi.advanceTimersByTimeAsync(20_000);
    expect(h.onWaiting).toHaveBeenCalledTimes(1);
    f.answer(json(ANSWER));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.onDone).toHaveBeenCalledTimes(1);
    expect(h.onDone).toHaveBeenCalledWith(ANSWER);
    expect(h.onError).not.toHaveBeenCalled();
  });

  it("cancel aborts the request and reports nothing", async () => {
    const f = fakeFetch();
    const h = hooks();
    const run = runPassRequest("A", BODY, h);
    await vi.advanceTimersByTimeAsync(100);
    run.cancel();
    expect(f.calls[0]!.init?.signal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.onWaiting).not.toHaveBeenCalled(); // the timer of the box was cleared too
    expect(h.onDone).not.toHaveBeenCalled();
    expect(h.onError).not.toHaveBeenCalled(); // the AbortError is not an error to show
  });

  it("cancel from the waiting box aborts the request and reports nothing more", async () => {
    const f = fakeFetch();
    const h = hooks();
    const run = runPassRequest("A", BODY, h);
    await vi.advanceTimersByTimeAsync(WAIT_BOX_DELAY_MS);
    expect(h.onWaiting).toHaveBeenCalledTimes(1);
    run.cancel();
    expect(f.calls[0]!.init?.signal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.onDone).not.toHaveBeenCalled();
    expect(h.onError).not.toHaveBeenCalled();
  });

  it("an answer that comes after cancel is dropped", async () => {
    // a fetch that does not obey the abort (a response already on its way)
    let respond: (r: Response) => void = () => undefined;
    vi.stubGlobal("fetch", () => new Promise<Response>((resolve) => (respond = resolve)));
    const h = hooks();
    const run = runPassRequest("A", BODY, h);
    run.cancel();
    respond(json(ANSWER));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.onDone).not.toHaveBeenCalled();
    expect(h.onError).not.toHaveBeenCalled();
  });

  it("cancel after the answer does nothing", async () => {
    const f = fakeFetch();
    const h = hooks();
    const run = runPassRequest("A", BODY, h);
    f.answer(json(ANSWER));
    await vi.advanceTimersByTimeAsync(0);
    run.cancel();
    run.cancel();
    expect(h.onDone).toHaveBeenCalledTimes(1);
    expect(h.onError).not.toHaveBeenCalled();
  });

  it("waiting box shows the error and Retry", async () => {
    // fetch answers 503 GMAT_FAILED after the box is up: the Thai text of the server goes to onError
    const f = fakeFetch();
    const h = hooks();
    runPassRequest("A", BODY, h);
    await vi.advanceTimersByTimeAsync(WAIT_BOX_DELAY_MS);
    expect(h.onWaiting).toHaveBeenCalledTimes(1);
    f.answer(json({ code: "GMAT_FAILED", level: "error", text: "GMAT คำนวณวงโคจรไม่สำเร็จ", object: "25544" }, 503));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.onError).toHaveBeenCalledTimes(1);
    expect(h.onError).toHaveBeenCalledWith("GMAT คำนวณวงโคจรไม่สำเร็จ");
    expect(h.onDone).not.toHaveBeenCalled();

    // Retry is the same request run again: a second run with the same body answers
    const retry = hooks();
    runPassRequest("A", BODY, retry);
    expect(f.calls).toHaveLength(2);
    expect(JSON.parse(String(f.calls[1]!.init?.body))).toEqual(BODY);
    f.answer(json(ANSWER), 1);
    await vi.advanceTimersByTimeAsync(0);
    expect(retry.onDone).toHaveBeenCalledWith(ANSWER);
    expect(retry.onError).not.toHaveBeenCalled();
  });

  it("an error before the box is up is reported at once, and the box never comes", async () => {
    const f = fakeFetch();
    const h = hooks();
    runPassRequest("A", BODY, h);
    f.answer(json({ code: "GMAT_FAILED", level: "error", text: "GMAT ล้มเหลว", object: null }, 503));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.onError).toHaveBeenCalledWith("GMAT ล้มเหลว");
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.onWaiting).not.toHaveBeenCalled();
  });

  it("a server that cannot be reached is an error with the Thai text of api.ts", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
    const h = hooks();
    runPassRequest("A", BODY, h);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.onError).toHaveBeenCalledTimes(1);
    expect(h.onError.mock.calls[0]![0]).toBe("ติดต่อ server ไม่ได้ (server ปิดอยู่หรือเครือข่ายขัดข้อง)");
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.onWaiting).not.toHaveBeenCalled();
  });
});

describe("passBody", () => {
  const T = "2026-11-12T05:00:00.000Z";
  const tick = (el: number | null, norad = 25544) =>
    ({ t: "2026-11-12T05:00:09.000Z", sats: [{ norad, el }] }) as unknown as Pick<Tick, "sats">;

  it("builds the body of the request: the satellite, the kind and the time of the view", () => {
    expect(passBody("next", 25544, T, tick(-5))).toEqual({ norad: 25544, kind: "next", t: T });
    expect(passBody("future", 25544, T, tick(-5))).toEqual({ norad: 25544, kind: "future", t: T });
    // Show next pass and Future passes do not look at El: the server decides (plan decision 4)
    expect(passBody("next", 25544, T, null)).toEqual({ norad: 25544, kind: "next", t: T });
  });

  it("current pass click does nothing when El is no longer > 0", () => {
    // the El of the newest tick at the click counts, not the El the menu was built with
    expect(passBody("current", 25544, T, tick(-0.5))).toBeNull();
    expect(passBody("current", 25544, T, tick(0))).toBeNull();
    expect(passBody("current", 25544, T, tick(null))).toBeNull();
    expect(passBody("current", 25544, T, tick(12.3, 99))).toBeNull(); // the satellite is not in the tick
    expect(passBody("current", 25544, T, { sats: undefined })).toBeNull(); // a tick that is not "ok"
    expect(passBody("current", 25544, T, null)).toBeNull();
  });

  it("current pass goes on while El is > 0", () => {
    expect(passBody("current", 25544, T, tick(0.01))).toEqual({ norad: 25544, kind: "current", t: T });
  });
});

describe("outcomeOf", () => {
  const pass = { orbit: 7, aos: "2026-11-12T06:00:00.000Z", tca: "2026-11-12T06:05:00.000Z", los: "2026-11-12T06:10:00.000Z", rows: [] } as unknown as PassInfo;

  it("a pass opens Pass details with no parent window", () => {
    const o = outcomeOf({ sat: ANSWER.sat, qth: ANSWER.qth, pass });
    expect(o.kind).toBe("window");
    if (o.kind !== "window") return;
    expect(o.window).toMatchObject({ kind: "details", parent: null, answer: { sat: ANSWER.sat, qth: ANSWER.qth, pass } });
  });

  it("passes open Upcoming passes", () => {
    const o = outcomeOf({ sat: ANSWER.sat, qth: ANSWER.qth, passes: [pass, pass] });
    expect(o.kind).toBe("window");
    if (o.kind !== "window") return;
    expect(o.window).toMatchObject({ kind: "upcoming", answer: { sat: ANSWER.sat, qth: ANSWER.qth, passes: [pass, pass] } });
  });

  it("a message opens the no-pass box with the message as it is", () => {
    expect(outcomeOf(ANSWER)).toEqual({ kind: "message", message: (ANSWER as { message: unknown }).message });
  });

  it("every window it opens has an id of its own (the same pass can be opened again, as Gpredict does)", () => {
    const a = outcomeOf({ sat: ANSWER.sat, qth: ANSWER.qth, pass });
    const b = outcomeOf({ sat: ANSWER.sat, qth: ANSWER.qth, pass });
    expect(a.kind === "window" && b.kind === "window" && a.window.id !== b.window.id).toBe(true);
  });
});
