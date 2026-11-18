import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULTS } from "./moduleDefaults.fixture";
import {
  ApiError,
  cloneModule,
  getClock,
  getCurrentLog,
  getLicense,
  getLocations,
  getMaps,
  getModule,
  getModuleFresh,
  getModules,
  getPrefs,
  getReadme,
  postLog,
  putClock,
  putModule,
  putPrefs,
  putQthBatch,
  putTabs,
  retryModule,
  searchSatellites,
  uploadMap,
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

  it("PUTs a module with the paths to pin and unpin beside its configuration, and without them when there are none", async () => {
    const m = { ...structuredClone(DEFAULTS), name: "Amateur", satellites: [25544] };
    const calls = stubFetch(() => json(m));
    await putModule(m, { pin: ["map.center_lon"], unpin: ["list_columns"] });
    expect(calls[0]!.url).toBe("/api/modules/Amateur");
    expect(calls[0]!.init?.method).toBe("PUT");
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ ...m, pin: ["map.center_lon"], unpin: ["list_columns"] });
    await putModule(m);
    expect(JSON.parse(String(calls[1]!.init?.body))).toEqual(m);
  });

  it("PUTs Configure → OK to ?recreate=true with the configuration and the pins, and without recreate in the body", async () => {
    const m = { ...structuredClone(DEFAULTS), name: "Amateur", satellites: [25544] };
    const calls = stubFetch(() => json(m));
    await putModule(m, { pin: ["layout_code"], unpin: ["list_columns"], recreate: true });
    expect(calls[0]!.url).toBe("/api/modules/Amateur?recreate=true");
    expect(calls[0]!.init?.method).toBe("PUT");
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ ...m, pin: ["layout_code"], unpin: ["list_columns"] });
    await putModule(m, { recreate: true });
    expect(calls[1]!.url).toBe("/api/modules/Amateur?recreate=true");
    expect(JSON.parse(String(calls[1]!.init?.body))).toEqual(m);
    await putModule(m, { recreate: false });
    expect(calls[2]!.url).toBe("/api/modules/Amateur");
  });

  it("reads a module plainly (an open one: what it runs with), and freshly for Edit module (?fresh=1)", async () => {
    const calls = stubFetch(() => json({}));
    await getModule("a b");
    await getModuleFresh("a b");
    expect(calls.map((c) => c.url)).toEqual(["/api/modules/a%20b", "/api/modules/a%20b?fresh=1"]);
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

  it("PUTs the stations and the default to /api/qth/batch, and a dry run to ?dry_run=true, with the same body", async () => {
    const thbk = { name: "THBK", description: "", location: "Bangkok", lat_deg: 13.7, lon_deg: 100.8, alt_m: 6, weather_station: "VTBS" };
    const calls = stubFetch(() => json({ qth: [thbk], default: "THBK", changed_modules: [] }));
    expect(await putQthBatch({ stations: [thbk], default: "THBK" })).toEqual({ qth: [thbk], default: "THBK", changed_modules: [] });
    await putQthBatch({ stations: [thbk], default: "THBK" }, { dryRun: true });
    expect(calls.map((c) => [c.url, c.init?.method])).toEqual([
      ["/api/qth/batch", "PUT"],
      ["/api/qth/batch?dry_run=true", "PUT"],
    ]);
    for (const c of calls) expect(JSON.parse(String(c.init?.body))).toEqual({ stations: [thbk], default: "THBK" });
  });

  it("sends nothing but the stations and the default to /api/qth/batch", async () => {
    const calls = stubFetch(() => json({}));
    await putQthBatch({ stations: [], default: "x", extra: 1 } as { stations: []; default: string });
    expect(Object.keys(JSON.parse(String(calls[0]!.init?.body))).sort()).toEqual(["default", "stations"]);
  });

  it("GETs the list of cities", async () => {
    const answer = { source: "NOAA", downloaded: "2026-11-14T12:05:40Z", locations: [["Asia", "Thailand", "Chiang Mai", 18.78, 98.98, 312, "VTCC"]] };
    const calls = stubFetch(() => json(answer));
    expect(await getLocations()).toEqual(answer);
    expect(calls[0]!.url).toBe("/api/locations");
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

  it("reads the current log as plain text, empty when there is no file (File → Log browser)", async () => {
    const text = "2026/11/12 05:06:07|3|sat_log_init: Session started\n";
    const calls = stubFetch(() => new Response(text, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } }));
    await expect(getCurrentLog()).resolves.toBe(text);
    expect(calls[0]!.url).toBe("/api/logs/current");
    expect(calls[0]!.init?.method).toBe("GET");
    stubFetch(() => new Response("", { status: 200 }));
    await expect(getCurrentLog()).resolves.toBe("");
  });

  it("sends a line of the log as {level, function, text} and gets nothing back (204)", async () => {
    const calls = stubFetch(() => new Response(null, { status: 204 }));
    await expect(postLog(1, "multi_pass_response", "multi_pass_response: PRINT not implemented")).resolves.toBeUndefined();
    expect(calls[0]!.url).toBe("/api/log");
    expect(calls[0]!.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({
      level: 1,
      function: "multi_pass_response",
      text: "multi_pass_response: PRINT not implemented",
    });
    expect(new Headers(calls[0]!.init?.headers).get("Content-Type")).toBe("application/json");
  });

  it("a line of the log the server refuses is an ApiError LOG_INVALID", async () => {
    stubFetch(() => json({ code: "LOG_INVALID", level: "error", text: "ข้อความ (text) ต้องยาว 1-500 ตัวอักษร", object: "text" }, 422));
    const err = (await postLog(3, "f", "").catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect([err.code, err.status, err.object]).toEqual(["LOG_INVALID", 422, "text"]);
  });

  it("reads the list of the background maps", async () => {
    const list = { maps: [{ file: "earth_800.png", stock: true, width: 800, height: 400, bytes: 3000 }], default: "nasa-bmng-07_1024.jpg" };
    const calls = stubFetch(() => json(list));
    await expect(getMaps()).resolves.toEqual(list);
    expect(calls[0]!.url).toBe("/api/maps");
    expect(calls[0]!.init?.method).toBe("GET");
  });

  it("uploads a map as the raw bytes with the content type given, the name in the query, and gets its entry", async () => {
    const entry = { file: "my map.png", stock: false, width: 4, height: 2, bytes: 9 };
    const calls = stubFetch(() => json(entry));
    const image = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])]);
    await expect(uploadMap("my map.png", "image/png", image)).resolves.toEqual(entry);
    expect(calls[0]!.url).toBe("/api/maps?name=my%20map.png");
    expect(calls[0]!.init?.method).toBe("POST");
    expect(calls[0]!.init?.body).toBe(image);
    expect(new Headers(calls[0]!.init?.headers).get("Content-Type")).toBe("image/png");
  });

  it("an upload the server refuses is an ApiError MAP_INVALID with its Thai text", async () => {
    stubFetch(() => json({ code: "MAP_INVALID", level: "error", text: "ภาพต้องไม่เกิน 10 MB", object: "body" }, 422));
    const err = (await uploadMap("a.jpg", "image/jpeg", new Blob(["x"])).catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect([err.code, err.status, err.text, err.object]).toEqual(["MAP_INVALID", 422, "ภาพต้องไม่เกิน 10 MB", "body"]);
  });

  it("an upload whose connection is closed (an oversize body) is an ApiError NETWORK_ERROR, not a crash", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    const err = (await uploadMap("a.jpg", "image/jpeg", new Blob(["x"])).catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect([err.code, err.status]).toEqual(["NETWORK_ERROR", 0]);
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
