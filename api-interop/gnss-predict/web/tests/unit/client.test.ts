import { afterEach, describe, expect, test, vi } from "vitest";
import { ApiError, apiGet, apiGetText, apiSend, apiUrl, isAbortError, normalizeEtag } from "../../src/api/client";
import { stubFetch } from "./helpers/fake-fetch";

afterEach(() => vi.unstubAllGlobals());

async function failure(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError);
    return e as ApiError;
  }
  throw new Error("expected the call to fail");
}

describe("apiUrl", () => {
  test("prefixes /api once", () => {
    expect(apiUrl("/scenarios/E2E")).toBe("/api/scenarios/E2E");
    expect(apiUrl("/api/scenarios/E2E")).toBe("/api/scenarios/E2E");
    expect(apiUrl("scenarios/E2E")).toBe("/api/scenarios/E2E");
    expect(apiUrl("/health?x=1")).toBe("/api/health?x=1");
  });
});

describe("apiGet", () => {
  test("returns the data, the ETag header as received (quoted) and the headers", async () => {
    stubFetch({ "GET /api/scenarios/E2E": { json: { name: "E2E" }, headers: { ETag: '"0123456789abcdef"', "X-Results-Stale": "true" } } });
    const r = await apiGet<{ name: string }>("/scenarios/E2E");
    expect(r.data).toEqual({ name: "E2E" });
    expect(r.etag).toBe('"0123456789abcdef"');
    expect(r.headers.get("x-results-stale")).toBe("true");
  });

  test("etag is null when the server sends none", async () => {
    stubFetch({ "GET /api/health": { json: { ok: 1 } } });
    expect((await apiGet("/health")).etag).toBeNull();
  });

  test("an empty success body gives null data", async () => {
    stubFetch({ "GET /api/x": { status: 204 } });
    expect((await apiGet("/x")).data).toBeNull();
  });
});

describe("errors", () => {
  test("422 gives an ApiError that carries the field, code, text and detail of the body", async () => {
    stubFetch({
      "PUT /api/scenarios/E2E": { status: 422, json: { code: "SCENARIO_INVALID", text: "ค่าผิด", field: "analysis_period.start", detail: "x" } },
    });
    const e = await failure(apiSend("PUT", "/scenarios/E2E", {}, '"a"'));
    expect(e.status).toBe(422);
    expect(e.code).toBe("SCENARIO_INVALID");
    expect(e.text).toBe("ค่าผิด");
    expect(e.field).toBe("analysis_period.start");
    expect(e.detail).toBe("x");
    expect(e.message).toBe("ค่าผิด");
  });

  test("412 has the code ETAG_MISMATCH and null field/detail when the body has none", async () => {
    stubFetch({ "PATCH /api/scenarios/E2E/objects/Satellite/G01": { status: 412, json: { code: "ETAG_MISMATCH", text: "ถูกแก้จากที่อื่น" } } });
    const e = await failure(apiSend("PATCH", "/scenarios/E2E/objects/Satellite/G01", {}, '"old"'));
    expect(e.status).toBe(412);
    expect(e.code).toBe("ETAG_MISMATCH");
    expect(e.field).toBeNull();
    expect(e.detail).toBeNull();
  });

  test("a non-string detail is kept as JSON text", async () => {
    stubFetch({ "GET /api/x": { status: 422, json: { code: "SCENARIO_INVALID", text: "t", field: null, detail: [{ loc: ["body"] }] } } });
    expect((await failure(apiGet("/x"))).detail).toBe('[{"loc":["body"]}]');
  });

  test("a body that is not JSON gives HTTP_<status>", async () => {
    stubFetch({ "GET /api/a": { status: 502, text: "<html>Bad Gateway</html>" }, "GET /api/b": { status: 400, text: "Invalid host header" } });
    const a = await failure(apiGet("/a"));
    expect(a.status).toBe(502);
    expect(a.code).toBe("HTTP_502");
    const b = await failure(apiGet("/b"));
    expect(b.code).toBe("HTTP_400");
    expect(b.text).toBe("Invalid host header");
  });

  test("JSON without the error envelope also gives HTTP_<status>", async () => {
    stubFetch({ "GET /api/a": { status: 500, json: { detail: "oops" } } });
    expect((await failure(apiGet("/a"))).code).toBe("HTTP_500");
  });

  test("a 200 whose body is not JSON (the dev server answering with index.html) is an error too", async () => {
    stubFetch({ "GET /api/a": { text: "<!doctype html>" } });
    const e = await failure(apiGet("/a"));
    expect(e.code).toBe("HTTP_200");
    expect(e.status).toBe(200);
  });

  test("a failing fetch gives status 0 and code NETWORK", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const e = await failure(apiGet("/health"));
    expect(e.status).toBe(0);
    expect(e.code).toBe("NETWORK");
    expect(e.text).toMatch(/[฀-๿]/);
    expect(e.detail).toBe("Failed to fetch");
  });

  test("an abort is not turned into an ApiError", async () => {
    stubFetch({ "GET /api/slow": () => new Promise(() => undefined) });
    const ctl = new AbortController();
    const p = apiGet("/slow", { signal: ctl.signal });
    ctl.abort();
    await expect(p).rejects.toSatisfy(isAbortError);
  });
});

describe("apiSend", () => {
  test("sends If-Match exactly as given (quotes included), the JSON body and the method", async () => {
    const f = stubFetch({ "PATCH /api/scenarios/E2E/objects/Satellite/G01": { json: { etag: "b", results_stale: false }, headers: { ETag: '"b"' } } });
    const r = await apiSend<{ etag: string }>("PATCH", "/scenarios/E2E/objects/Satellite/G01", { basic: { description: "x" } }, '"abc123def4567890"');
    expect(r.etag).toBe('"b"');
    expect(r.data.etag).toBe("b");
    const c = f.calls[0];
    expect(c.method).toBe("PATCH");
    expect(c.headers.get("if-match")).toBe('"abc123def4567890"');
    expect(c.headers.get("content-type")).toBe("application/json");
    expect(c.body).toEqual({ basic: { description: "x" } });
  });

  test("sends no If-Match when it is null or missing, and no body when there is none", async () => {
    const f = stubFetch({ "POST /api/jobs/j1/cancel": { json: {} }, "DELETE /api/x": { json: {} } });
    await apiSend("POST", "/jobs/j1/cancel");
    await apiSend("DELETE", "/x", undefined, null);
    expect(f.calls[0].headers.has("if-match")).toBe(false);
    expect(f.calls[0].body).toBeUndefined();
    expect(f.calls[1].headers.has("if-match")).toBe(false);
  });

  test("a send body of 0 or an empty string is still sent", async () => {
    const f = stubFetch({ "PUT /api/x": { json: {} } });
    await apiSend("PUT", "/x", 0);
    expect(f.calls[0].body).toBe(0);
  });
});

describe("apiGetText", () => {
  test("returns the raw text of a success response", async () => {
    stubFetch({ "GET /api/scenarios/E2E/access/THBK/abc/dop.csv": { text: "a,b\n1,2\n" } });
    expect(await apiGetText("/scenarios/E2E/access/THBK/abc/dop.csv")).toBe("a,b\n1,2\n");
  });

  test("an error response is an ApiError with the envelope of the body", async () => {
    stubFetch({ "GET /api/f": { status: 404, json: { code: "NOT_FOUND", text: "ไม่พบไฟล์" } } });
    const e = await failure(apiGetText("/f"));
    expect(e.code).toBe("NOT_FOUND");
    expect(e.status).toBe(404);
  });
});

describe("normalizeEtag", () => {
  test("strips quotes and the weak prefix so a header and an event value compare equal", () => {
    expect(normalizeEtag('"abc"')).toBe("abc");
    expect(normalizeEtag('W/"abc"')).toBe("abc");
    expect(normalizeEtag("abc")).toBe("abc");
  });
});
