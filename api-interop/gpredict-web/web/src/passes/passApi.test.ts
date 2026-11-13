import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api";
import { getSkyGlance, releaseSkyGlance, requestPass } from "./passApi";
import type { PassBody } from "./types";

type Call = { url: string; init: RequestInit | undefined };

function stubFetch(respond: (url: string, init?: RequestInit) => Response | Promise<Response>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return respond(url, init);
  });
  return calls;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const BODY: PassBody = { norad: 25544, kind: "next", t: "2026-11-12T05:00:00.000Z" };

afterEach(() => vi.unstubAllGlobals());

describe("requestPass", () => {
  it("POSTs the body as JSON to the module's passes route", async () => {
    const answer = { sat: { norad: 25544, name: "ISS" }, qth: { name: "Home" }, message: { code: "PASS_NONE_WITHIN", level: "info", text: "x" } };
    const calls = stubFetch(() => json(answer));
    const r = await requestPass("My Module/1", BODY, new AbortController().signal);
    expect(r).toEqual(answer);
    expect(calls[0]!.url).toBe("/api/modules/My%20Module%2F1/passes");
    expect(calls[0]!.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual(BODY);
    expect(new Headers(calls[0]!.init?.headers).get("Content-Type")).toBe("application/json");
  });

  it("passes the abort signal to fetch", async () => {
    const calls = stubFetch(() => json({}));
    const controller = new AbortController();
    await requestPass("A", BODY, controller.signal);
    expect(calls[0]!.init?.signal).toBe(controller.signal);
  });

  it("an aborted request rejects with AbortError, not ApiError", async () => {
    vi.stubGlobal("fetch", (_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
    }));
    const controller = new AbortController();
    const pending = requestPass("A", BODY, controller.signal);
    controller.abort();
    const e = await pending.catch((err: unknown) => err);
    expect(e).toBeInstanceOf(DOMException);
    expect((e as DOMException).name).toBe("AbortError");
    expect(e).not.toBeInstanceOf(ApiError);
  });

  it("throws the server's error as ApiError", async () => {
    stubFetch(() => json({ code: "GMAT_FAILED", level: "error", text: "GMAT ล้มเหลว", object: "25544" }, 503));
    const e = await requestPass("A", BODY, new AbortController().signal).catch((err: unknown) => err);
    expect(e).toBeInstanceOf(ApiError);
    expect((e as ApiError).code).toBe("GMAT_FAILED");
    expect((e as ApiError).status).toBe(503);
  });

  it("a connection failure that was not an abort is a NETWORK_ERROR", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    const e = await requestPass("A", BODY, new AbortController().signal).catch((err: unknown) => err);
    expect(e).toBeInstanceOf(ApiError);
    expect((e as ApiError).code).toBe("NETWORK_ERROR");
  });
});

describe("getSkyGlance", () => {
  it("GETs the module's skyglance route without t", async () => {
    const answer = { status: "computing", t0: "2026-11-12T05:00:00.000Z", hours: 12, sats: [], messages: [] };
    const calls = stubFetch(() => json(answer));
    expect(await getSkyGlance("A b")).toEqual(answer);
    expect(calls[0]!.url).toBe("/api/modules/A%20b/skyglance");
    expect(calls[0]!.init?.method ?? "GET").toBe("GET");
  });

  it("sends t as a query parameter, URL-encoded", async () => {
    const calls = stubFetch(() => json({ status: "ok", t0: "", hours: 12, sats: [], messages: [] }));
    await getSkyGlance("A", "2026-11-12T05:00:00.000+00:00");
    expect(calls[0]!.url).toBe("/api/modules/A/skyglance?t=2026-11-12T05%3A00%3A00.000%2B00%3A00");
  });
});

describe("releaseSkyGlance", () => {
  it("DELETEs the route and accepts the 204", async () => {
    const calls = stubFetch(() => new Response(null, { status: 204 }));
    await expect(releaseSkyGlance("A b")).resolves.toBeUndefined();
    expect(calls[0]!.url).toBe("/api/modules/A%20b/skyglance");
    expect(calls[0]!.init?.method).toBe("DELETE");
  });
});
