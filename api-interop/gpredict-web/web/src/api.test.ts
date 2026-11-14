import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  cloneModule,
  getClock,
  getLicense,
  getModules,
  getPrefs,
  getReadme,
  putClock,
  putPrefs,
  putTabs,
  retryModule,
  searchSatellites,
} from "./api";

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

afterEach(() => vi.unstubAllGlobals());

describe("api", () => {
  it("GETs JSON", async () => {
    const calls = stubFetch(() => json({ modules: ["Amateur"], open: ["Amateur"], messages: [] }));
    const r = await getModules();
    expect(r.open).toEqual(["Amateur"]);
    expect(calls[0]!.url).toBe("/api/modules");
    expect(calls[0]!.init?.method ?? "GET").toBe("GET");
  });

  it("PUT /api/session/tabs sends {open: [...]} as JSON", async () => {
    const calls = stubFetch(() => json({ open: ["B", "A"] }));
    const r = await putTabs(["B", "A"]);
    expect(r.open).toEqual(["B", "A"]);
    expect(calls[0]!.url).toBe("/api/session/tabs");
    expect(calls[0]!.init?.method).toBe("PUT");
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ open: ["B", "A"] });
    expect(new Headers(calls[0]!.init?.headers).get("Content-Type")).toBe("application/json");
  });

  it("encodes names in the path", async () => {
    const calls = stubFetch(() => json({ state: "forward", throttle: 1, time: "2026-11-12T07:00:00.000Z", label: "Real-Time" }));
    await getClock("a b/c");
    expect(calls[0]!.url).toBe("/api/modules/a%20b%2Fc/clock");
  });

  it("puts the clock and clones a module with the bodies of spec §7.3", async () => {
    const calls = stubFetch(() => json({}));
    await putClock("M", { state: "stop", throttle: 5 });
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ state: "stop", throttle: 5 });
    await cloneModule("M", "M2", true);
    expect(calls[1]!.url).toBe("/api/modules/M/clone");
    expect(calls[1]!.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[1]!.init?.body))).toEqual({ new_name: "M2", open: true });
  });

  it("GETs the preferences, and PUTs {set, remove} with both always in the body", async () => {
    const answer = { values: { "PREDICT/MINIMUM_ELEV": 30 }, defaults: { "PREDICT/MINIMUM_ELEV": 5 }, user: ["PREDICT/MINIMUM_ELEV"] };
    const calls = stubFetch(() => json(answer));
    expect(await getPrefs()).toEqual(answer);
    expect(calls[0]!.url).toBe("/api/prefs");
    expect(calls[0]!.init?.method ?? "GET").toBe("GET");
    expect(await putPrefs({ "PREDICT/LOOK_AHEAD": 7 }, ["PREDICT/MINIMUM_ELEV"])).toEqual(answer);
    expect(calls[1]!.url).toBe("/api/prefs");
    expect(calls[1]!.init?.method).toBe("PUT");
    expect(JSON.parse(String(calls[1]!.init?.body))).toEqual({ set: { "PREDICT/LOOK_AHEAD": 7 }, remove: ["PREDICT/MINIMUM_ELEV"] });
  });

  it("a dry run goes to ?dry_run=true and sends the same body", async () => {
    const calls = stubFetch(() => json({ values: {}, defaults: {}, user: [] }));
    await putPrefs({ "PREDICT/LOOK_AHEAD": 7 }, ["PREDICT/MINIMUM_ELEV"], { dryRun: true });
    expect(calls[0]!.url).toBe("/api/prefs?dry_run=true");
    expect(calls[0]!.init?.method).toBe("PUT");
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ set: { "PREDICT/LOOK_AHEAD": 7 }, remove: ["PREDICT/MINIMUM_ELEV"] });
    await putPrefs({}, [], { dryRun: false });
    await putPrefs({}, [], {});
    expect(calls[1]!.url).toBe("/api/prefs");
    expect(calls[2]!.url).toBe("/api/prefs");
  });

  it("a refused preference is an ApiError with the Thai text and the key", async () => {
    stubFetch(() => json({ code: "PREFS_INVALID", level: "error", text: "ค่าผิด", object: "PREDICT/MINIMUM_ELEV" }, 422));
    await expect(putPrefs({ "PREDICT/MINIMUM_ELEV": 0 }, [])).rejects.toMatchObject({ code: "PREFS_INVALID", text: "ค่าผิด", object: "PREDICT/MINIMUM_ELEV", status: 422 });
  });

  it("builds the satellite search query", async () => {
    const calls = stubFetch(() => json({ satellites: [] }));
    await searchSatellites("ISS (Z", "amateur");
    expect(calls[0]!.url).toBe("/api/satellites?q=ISS+%28Z&group=amateur");
    await searchSatellites("");
    expect(calls[1]!.url).toBe("/api/satellites?q=");
  });

  it("returns undefined for 204 No Content (retry)", async () => {
    const calls = stubFetch(() => new Response(null, { status: 204 }));
    await expect(retryModule("Amateur")).resolves.toBeUndefined();
    expect(calls[0]!.url).toBe("/api/modules/Amateur/retry");
    expect(calls[0]!.init?.method).toBe("POST");
  });

  it("reads the licence as plain text", async () => {
    const calls = stubFetch(() => new Response("GNU GENERAL PUBLIC LICENSE", { status: 200 }));
    await expect(getLicense()).resolves.toBe("GNU GENERAL PUBLIC LICENSE");
    expect(calls[0]!.url).toBe("/api/license");
  });

  it("reads the README as plain text (Help → Online help)", async () => {
    const calls = stubFetch(() => new Response("# Gpredict Web\n\nคู่มือ", { status: 200 }));
    await expect(getReadme()).resolves.toBe("# Gpredict Web\n\nคู่มือ");
    expect(calls[0]!.url).toBe("/api/readme");
  });

  it("a README the server cannot find is an ApiError with its Thai text", async () => {
    stubFetch(() => json({ code: "NOT_FOUND", level: "error", text: "ไม่พบหรืออ่านไฟล์ README.md ของ repo ไม่ได้", object: null }, 404));
    const err = (await getReadme().catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect([err.code, err.status, err.text]).toEqual(["NOT_FOUND", 404, "ไม่พบหรืออ่านไฟล์ README.md ของ repo ไม่ได้"]);
  });

  it("throws ApiError {code, text} for status >= 400, from the server's error body", async () => {
    stubFetch(() =>
      json({ code: "MODULE_INVALID", level: "error", text: "ต้องเลือกดาวอย่างน้อย 1 ดวง", object: "satellites" }, 422),
    );
    const err = await getModules().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    const e = err as ApiError;
    expect(e.code).toBe("MODULE_INVALID");
    expect(e.text).toBe("ต้องเลือกดาวอย่างน้อย 1 ดวง");
    expect(e.status).toBe(422);
    expect(e.object).toBe("satellites");
    expect(e.message).toBe(e.text);
  });

  it("throws ApiError HTTP_<status> when an error response is not the server's JSON", async () => {
    stubFetch(() => new Response("<html>Bad gateway</html>", { status: 502 }));
    const e = (await getModules().catch((x: unknown) => x)) as ApiError;
    expect(e).toBeInstanceOf(ApiError);
    expect(e.code).toBe("HTTP_502");
    expect(e.status).toBe(502);
    expect(e.text).toContain("502");
  });

  it("throws ApiError NETWORK_ERROR when the server cannot be reached", async () => {
    stubFetch(() => {
      throw new TypeError("Failed to fetch");
    });
    const e = (await getModules().catch((x: unknown) => x)) as ApiError;
    expect(e).toBeInstanceOf(ApiError);
    expect(e.code).toBe("NETWORK_ERROR");
    expect(e.status).toBe(0);
  });
});
