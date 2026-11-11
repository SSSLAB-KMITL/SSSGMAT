import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ApiError } from "../../src/api/client";
import { useMessages } from "../../src/stores/messages";
import { useResults } from "../../src/stores/results";
import { useScenario } from "../../src/stores/scenario";
import { useSelection } from "../../src/stores/selection";
import { useTime } from "../../src/stores/time";
import { deferred, stubFetch, type Handler } from "./helpers/fake-fetch";

const THAI = /[฀-๿]/;
const E1 = '"1111111111111111"';
const E2 = '"2222222222222222"';
const E3 = '"3333333333333333"';

const DOC = {
  format: "gnss-studio-scenario/1",
  name: "E2E",
  orbit_snapshot: "20261111T0000Z",
  analysis_period: { start: "2026-11-11T00:00:00Z", stop: "2026-11-12T00:00:00Z" },
  satellite_filter: { show_too_old: false, show_no_broadcast: false },
  objects: [{ class: "Satellite", name: "G01", norad: 37753 }],
};
const TREE = {
  path: "*", class: "Scenario", name: "E2E",
  children: [
    { path: "*/Facility/THBK", class: "Facility", name: "THBK", color: "#ff0000", show: true },
    { path: "*/Satellite/G01", class: "Satellite", name: "G01", color: "#00ff00", show: true },
  ],
};
const CATALOG = [
  { prn: "G01", system: "G", svn: "063", norad: 37753, block: "IIF", celestrak_name: "GPS BIIF-1 (PRN 25)", omm_epoch: "2026-11-10T12:00:00.000Z", age_days: 0.5, flags: [] },
  { prn: "E05", system: "E", svn: "", norad: 40128, block: "FOC", celestrak_name: "GALILEO 7", omm_epoch: "2026-11-10T12:00:00.000Z", age_days: 3, flags: ["stale"] },
];
const RESULTS_MISSING = { ephem: { hash: null, status: "missing", available: [] }, access: {}, error: null };

const BASE = "/api/scenarios/E2E";

/** server ปลอมที่มี scenario E2E; `server.etag` เปลี่ยนได้ระหว่าง test */
function server(over: Record<string, Handler> = {}) {
  const state = { etag: E1, doc: structuredClone(DOC) as Record<string, unknown> };
  const routes: Record<string, Handler> = {
    [`GET ${BASE}`]: () => ({ json: state.doc, headers: { ETag: state.etag } }),
    [`GET ${BASE}/objects`]: () => ({ json: TREE, headers: { ETag: state.etag } }),
    "GET /api/catalog": { json: CATALOG },
    [`GET ${BASE}/results`]: { json: RESULTS_MISSING },
    ...over,
  };
  const f = stubFetch(routes);
  return { ...f, state, routes };
}

const st = () => useScenario.getState();
const paths = (f: { calls: { method: string; path: string }[] }) => f.calls.map((c) => `${c.method} ${c.path}`);

beforeEach(() => {
  useScenario.setState(useScenario.getInitialState(), true);
  useResults.setState(useResults.getInitialState(), true);
  useMessages.setState(useMessages.getInitialState(), true);
  useSelection.setState(useSelection.getInitialState(), true);
});
afterEach(() => vi.unstubAllGlobals());

describe("load", () => {
  test("fetches the doc, the tree and the catalog, starts the clock and refreshes the results", async () => {
    const f = server();
    useSelection.getState().select("*/Satellite/G01");
    expect(await st().load("E2E")).toBe(true);
    expect(st().name).toBe("E2E");
    expect(st().doc?.name).toBe("E2E");
    expect(st().etag).toBe(E1);
    expect(st().tree?.children).toHaveLength(2);
    expect(st().conflict).toBe(false);
    expect([...st().catalog.keys()]).toEqual([37753, 40128]);
    expect(st().catalog.get(37753)?.prn).toBe("G01");
    expect(useTime.getState().current.toISOString()).toBe("2026-11-11T00:00:00.000Z");
    expect(useTime.getState().periodStop.toISOString()).toBe("2026-11-12T00:00:00.000Z");
    expect(useSelection.getState().activePath).toBeNull();
    const cat = f.calls.find((c) => c.path === "/api/catalog");
    expect(cat?.query.get("snapshot")).toBe("20261111T0000Z");
    expect(cat?.query.get("start")).toBe("2026-11-11T00:00:00.000Z");
    expect(cat?.query.get("stop")).toBe("2026-11-12T00:00:00.000Z");
    expect(paths(f)).toContain(`GET ${BASE}/results`);
    expect(useResults.getState().status).toBe("missing");
  });

  test("sends analysis times with an offset to the catalog as UTC", async () => {
    const f = server();
    f.state.doc.analysis_period = { start: "2026-11-11T07:00:00+07:00", stop: "2026-11-12T07:00:00+07:00" };
    await st().load("E2E");
    expect(f.calls.find((c) => c.path === "/api/catalog")?.query.get("start")).toBe("2026-11-11T00:00:00.000Z");
  });

  test("a scenario whose analysis period cannot be read fails cleanly with a Thai error message", async () => {
    const f = server();
    f.state.doc.analysis_period = { start: "2026-11-11", stop: "2026-11-12T00:00:00Z" };
    const before = useTime.getState().current;
    expect(await st().load("E2E")).toBe(false);
    expect(st().name).toBeNull();
    expect(st().doc).toBeNull();
    expect(st().tree).toBeNull();
    expect(st().etag).toBeNull();
    expect(st().catalog.size).toBe(0);
    expect(useTime.getState().current).toBe(before);
    expect(paths(f)).not.toContain("GET /api/catalog");
    const m = useMessages.getState().items;
    expect(m).toHaveLength(1);
    expect(m[0].level).toBe("error");
    expect(m[0].text).toMatch(THAI);
    expect(m[0].text).toContain("E2E");
  });

  test("a doc that is not a scenario at all fails cleanly instead of throwing", async () => {
    server({ [`GET ${BASE}`]: { json: { hello: "world" }, headers: { ETag: E1 } } });
    await expect(st().load("E2E")).resolves.toBe(false);
    expect(st().name).toBeNull();
    expect(useMessages.getState().items[0].level).toBe("error");
  });

  test("a server error is reported with the server text and leaves nothing half loaded", async () => {
    server({ [`GET ${BASE}`]: { status: 404, json: { code: "NOT_FOUND", text: "ไม่พบ scenario E2E" } } });
    expect(await st().load("E2E")).toBe(false);
    expect(st().name).toBeNull();
    expect(st().tree).toBeNull();
    expect(useMessages.getState().items[0].text).toContain("ไม่พบ scenario E2E");
  });

  test("a failing tree request fails the whole open", async () => {
    server({ [`GET ${BASE}/objects`]: { status: 500, json: { code: "INTERNAL", text: "ขัดข้อง" } } });
    expect(await st().load("E2E")).toBe(false);
    expect(st().doc).toBeNull();
    expect(st().name).toBeNull();
  });

  test("a failing catalog (snapshot gone) leaves it empty and warns, but the scenario still opens", async () => {
    const f = server({ "GET /api/catalog": { status: 422, json: { code: "SCENARIO_INVALID", text: "ไม่พบ snapshot", field: "snapshot" } } });
    expect(await st().load("E2E")).toBe(true);
    expect(st().name).toBe("E2E");
    expect(st().catalog.size).toBe(0);
    const warned = useMessages.getState().items.filter((m) => m.level === "warning");
    expect(warned).toHaveLength(1);
    expect(warned[0].text).toMatch(THAI);
    expect(warned[0].text).toContain("ไม่พบ snapshot");
    expect(paths(f)).toContain(`GET ${BASE}/results`);
  });

  test("a failed open keeps the scenario that was already open", async () => {
    server();
    await st().load("E2E");
    stubFetch({ "GET /api/scenarios/BAD": { status: 404, json: { code: "NOT_FOUND", text: "ไม่พบ" } }, "GET /api/scenarios/BAD/objects": { status: 404, json: { code: "NOT_FOUND", text: "ไม่พบ" } } });
    expect(await st().load("BAD")).toBe(false);
    expect(st().name).toBe("E2E");
    expect(st().doc?.name).toBe("E2E");
  });

  test("the answer of an older open is discarded when a newer open has started", async () => {
    const slow = deferred<{ json: unknown; headers: Record<string, string> }>();
    server({ [`GET ${BASE}`]: () => slow.promise });
    const older = st().load("E2E");
    stubFetch({
      "GET /api/scenarios/OTHER": { json: { ...DOC, name: "OTHER" }, headers: { ETag: E2 } },
      "GET /api/scenarios/OTHER/objects": { json: { ...TREE, name: "OTHER" }, headers: { ETag: E2 } },
      "GET /api/catalog": { json: [] },
      "GET /api/scenarios/OTHER/results": { json: RESULTS_MISSING },
    });
    expect(await st().load("OTHER")).toBe(true);
    slow.resolve({ json: DOC, headers: { ETag: E1 } });
    expect(await older).toBe(false);
    expect(st().name).toBe("OTHER");
    expect(st().etag).toBe(E2);
  });

  test("an open that is overtaken after its documents arrived (even if the abort came too late) changes nothing", async () => {
    const slowCatalog = deferred<{ json: unknown }>();
    stubFetch({
      [`GET ${BASE}`]: { json: DOC, headers: { ETag: E1 } },
      [`GET ${BASE}/objects`]: { json: TREE, headers: { ETag: E1 } },
      "GET /api/catalog": () => slowCatalog.promise,
    }, { ignoreAbort: true });
    const older = st().load("E2E");
    await vi.waitFor(() => expect(vi.mocked(fetch).mock.calls.some((c) => String(c[0]).startsWith("/api/catalog"))).toBe(true));
    stubFetch({
      "GET /api/scenarios/OTHER": { json: { ...DOC, name: "OTHER" }, headers: { ETag: E2 } },
      "GET /api/scenarios/OTHER/objects": { json: { ...TREE, name: "OTHER" }, headers: { ETag: E2 } },
      "GET /api/catalog": { json: [] },
      "GET /api/scenarios/OTHER/results": { json: RESULTS_MISSING },
    });
    expect(await st().load("OTHER")).toBe(true);
    slowCatalog.resolve({ json: CATALOG });
    expect(await older).toBe(false);
    expect(st().name).toBe("OTHER");
    expect(st().catalog.size).toBe(0);
  });

  describe("loadFailure (why the last open failed)", () => {
    const NOT_FOUND = { status: 404, json: { code: "NOT_FOUND", text: "ไม่พบ scenario E2E" } };

    test("is empty until an open fails", () => {
      expect(st().loadFailure).toBeNull();
    });

    test("names the scenario, the HTTP status and the server's code when the server refuses", async () => {
      server({ [`GET ${BASE}`]: NOT_FOUND, [`GET ${BASE}/objects`]: NOT_FOUND });
      expect(await st().load("E2E")).toBe(false);
      expect(st().loadFailure).toEqual({ name: "E2E", status: 404, code: "NOT_FOUND" });
    });

    test("uses status 0 for what is not an HTTP answer: a server that cannot be reached, or a document that cannot be used", async () => {
      const f = server();
      f.routes[`GET ${BASE}`] = () => {
        throw new Error("offline");
      };
      expect(await st().load("E2E")).toBe(false);
      expect(st().loadFailure).toMatchObject({ name: "E2E", status: 0, code: "NETWORK" });
      server({ [`GET ${BASE}`]: { json: { hello: "world" }, headers: { ETag: E1 } } });
      expect(await st().load("E2E")).toBe(false);
      expect(st().loadFailure).toEqual({ name: "E2E", status: 0, code: "SCENARIO_UNUSABLE" });
    });

    test("is cleared when the next open starts, and stays empty after a successful open", async () => {
      server({ [`GET ${BASE}`]: NOT_FOUND, [`GET ${BASE}/objects`]: NOT_FOUND });
      await st().load("E2E");
      expect(st().loadFailure).not.toBeNull();
      server();
      expect(await st().load("E2E")).toBe(true);
      expect(st().loadFailure).toBeNull();
    });

    test("is cleared by close, and an open that was overtaken by a newer one does not record anything", async () => {
      server({ [`GET ${BASE}`]: NOT_FOUND, [`GET ${BASE}/objects`]: NOT_FOUND });
      await st().load("E2E");
      st().close();
      expect(st().loadFailure).toBeNull();
      const slow = deferred<{ status: number; json: unknown }>();
      server({ [`GET ${BASE}`]: () => slow.promise });
      const older = st().load("E2E");
      st().close(); // overtakes it
      slow.resolve(NOT_FOUND);
      expect(await older).toBe(false);
      expect(st().loadFailure).toBeNull();
    });
  });

  test("close empties the store and the results", async () => {
    server();
    await st().load("E2E");
    st().close();
    expect(st().name).toBeNull();
    expect(st().doc).toBeNull();
    expect(st().tree).toBeNull();
    expect(st().etag).toBeNull();
    expect(st().catalog.size).toBe(0);
    expect(useResults.getState().status).toBe("unknown");
  });
});

describe("writes", () => {
  beforeEach(async () => {
    server();
    await st().load("E2E");
  });

  test("patchObject sends If-Match with the current ETag, keeps the new ETag and returns stale", async () => {
    const f = stubFetch({
      [`PATCH ${BASE}/objects/Satellite/G01`]: { json: { etag: "2222222222222222", results_stale: true }, headers: { ETag: E2 } },
      [`GET ${BASE}`]: { json: { ...DOC, description: "x" }, headers: { ETag: E2 } },
      [`GET ${BASE}/objects`]: { json: TREE, headers: { ETag: E2 } },
      [`GET ${BASE}/results`]: { json: RESULTS_MISSING },
    });
    const r = await st().patchObject("Satellite", "G01", { graphics2d: { color: "#123456" } });
    expect(r).toEqual({ stale: true });
    const patch = f.calls.find((c) => c.method === "PATCH");
    expect(patch?.headers.get("if-match")).toBe(E1);
    expect(patch?.body).toEqual({ graphics2d: { color: "#123456" } });
    expect(st().etag).toBe(E2);
    expect(st().conflict).toBe(false);
    expect(st().doc?.description).toBe("x"); // doc และ tree ถูกโหลดใหม่หลังบันทึก
    expect(paths(f)).toContain(`GET ${BASE}/objects`);
    expect(paths(f)).toContain(`GET ${BASE}/results`); // ผลไม่ตรงแล้วต้องรู้ทันที
  });

  describe("writes go one after another", () => {
    /** server ปลอมที่รับการเขียนเฉพาะเมื่อ If-Match ตรงกับ ETag ปัจจุบัน (ไม่งั้น 412 เหมือนของจริง) และออก ETag ใหม่ทุกครั้งที่รับ */
    function strictServer(over: Record<string, Handler> = {}) {
      const s = { n: 1, etag: E1 };
      const accept = (call: { headers: Headers }, json: unknown = {}) => {
        if (call.headers.get("if-match") !== s.etag) return { status: 412, json: { code: "ETAG_MISMATCH", text: "ถูกแก้จากที่อื่น" } };
        s.n++;
        s.etag = `"${String(s.n).repeat(16)}"`;
        return { json, headers: { ETag: s.etag } };
      };
      const f = stubFetch({
        [`GET ${BASE}`]: () => ({ json: DOC, headers: { ETag: s.etag } }),
        [`GET ${BASE}/objects`]: () => ({ json: TREE, headers: { ETag: s.etag } }),
        [`GET ${BASE}/results`]: { json: RESULTS_MISSING },
        [`PATCH ${BASE}/objects/Satellite/G01`]: (call) => accept(call, { etag: "x", results_stale: false }),
        [`PATCH ${BASE}/objects/Facility/THBK`]: (call) => accept(call, { etag: "x", results_stale: false }),
        [`POST ${BASE}/objects`]: (call) => accept(call, { created: ["*/Satellite/G02"], etag: "x", results_stale: false }),
        [`POST ${BASE}/objects/Satellite/G01/rename`]: (call) => accept(call, { etag: "x", results_stale: false }),
        [`DELETE ${BASE}/objects/Satellite/G01`]: (call) => accept(call, { etag: "x", results_stale: false }),
        [`POST ${BASE}/groups`]: (call) => accept(call, { etag: "x", results_stale: false }),
        [`PUT ${BASE}`]: (call) => accept(call, DOC),
        ...over,
      });
      return { s, f };
    }
    const sent = (f: { calls: { method: string; path: string }[] }) => f.calls.filter((c) => c.method !== "GET").map((c) => `${c.method} ${c.path}`);

    test("two quick patchObject calls: the second goes out with the ETag the first returned, after the first's reload", async () => {
      const { f } = strictServer();
      const first = st().patchObject("Satellite", "G01", { graphics2d: { show: false } });
      const second = st().patchObject("Facility", "THBK", { graphics2d: { show: false } });
      await Promise.all([first, second]);
      expect(st().conflict).toBe(false);
      const patches = f.calls.filter((c) => c.method === "PATCH");
      expect(patches.map((c) => c.headers.get("if-match"))).toEqual([E1, E2]);
      // the second request is only made once the first write has finished, reload included
      const order = paths(f);
      const secondAt = order.lastIndexOf(`PATCH ${BASE}/objects/Facility/THBK`);
      expect(order.slice(0, secondAt)).toEqual([`PATCH ${BASE}/objects/Satellite/G01`, expect.stringContaining("GET"), expect.stringContaining("GET")].slice(0, 3));
      expect(st().etag).toBe(`"${"3".repeat(16)}"`);
    });

    test("the second request waits for the first response, and is not sent while the first is in flight", async () => {
      const gate = deferred<{ json: unknown; headers: Record<string, string> }>();
      const { f } = strictServer({ [`PATCH ${BASE}/objects/Satellite/G01`]: () => gate.promise });
      const first = st().patchObject("Satellite", "G01", {});
      const second = st().patchObject("Facility", "THBK", {});
      await new Promise((r) => setTimeout(r, 10));
      expect(sent(f)).toEqual([`PATCH ${BASE}/objects/Satellite/G01`]);
      gate.resolve({ json: { etag: "x", results_stale: false }, headers: { ETag: E2 } });
      await Promise.all([first, second]);
      expect(sent(f)).toEqual([`PATCH ${BASE}/objects/Satellite/G01`, `PATCH ${BASE}/objects/Facility/THBK`]);
    });

    test("every kind of write joins the same queue, in the order they were asked", async () => {
      const { f } = strictServer();
      const results = await Promise.all([
        st().patchObject("Satellite", "G01", {}),
        st().insert({ class: "Satellite", method: "Define Properties", name: "G02", norad: 1 }),
        st().setGroup("Mine", []),
        st().putDoc((d) => { d.description = "z"; }),
        st().rename("Satellite", "G01", "G09"),
        st().remove("Satellite", "G01"),
      ]);
      expect(results).toHaveLength(6);
      expect(st().conflict).toBe(false);
      expect(sent(f)).toEqual([
        `PATCH ${BASE}/objects/Satellite/G01`, `POST ${BASE}/objects`, `POST ${BASE}/groups`, `PUT ${BASE}`,
        `POST ${BASE}/objects/Satellite/G01/rename`, `DELETE ${BASE}/objects/Satellite/G01`,
      ]);
    });

    test("a write that fails does not hold up the ones behind it", async () => {
      const { f } = strictServer({
        [`PATCH ${BASE}/objects/Satellite/G01`]: { status: 422, json: { code: "SCENARIO_INVALID", text: "ค่าผิด" } },
      });
      const first = st().patchObject("Satellite", "G01", {}).catch((e: unknown) => e);
      const second = st().patchObject("Facility", "THBK", {});
      expect(await first).toBeInstanceOf(ApiError);
      await second;
      expect(st().conflict).toBe(false);
      expect(f.calls.filter((c) => c.method === "PATCH").map((c) => c.headers.get("if-match"))).toEqual([E1, E1]); // nothing changed on the server, so the same ETag is still right
    });

    test("a write asked for before the scenario was closed is not sent to the one opened after", async () => {
      const gate = deferred<{ json: unknown; headers: Record<string, string> }>();
      const { f } = strictServer({ [`PATCH ${BASE}/objects/Satellite/G01`]: () => gate.promise });
      const first = st().patchObject("Satellite", "G01", {});
      const second = st().patchObject("Facility", "THBK", {}).catch((e: unknown) => e);
      st().close();
      gate.resolve({ json: { etag: "x", results_stale: false }, headers: { ETag: E2 } });
      await first;
      expect(await second).toBeInstanceOf(Error);
      expect(sent(f)).toEqual([`PATCH ${BASE}/objects/Satellite/G01`]);
      expect(st().conflict).toBe(false);
    });
  });

  test("object names are URL-encoded in the path", async () => {
    const f = stubFetch({
      [`PATCH ${BASE}/objects/Satellite/G%2001`]: { json: { etag: "2", results_stale: false }, headers: { ETag: E2 } },
      [`GET ${BASE}`]: { json: DOC, headers: { ETag: E2 } },
      [`GET ${BASE}/objects`]: { json: TREE, headers: { ETag: E2 } },
    });
    await st().patchObject("Satellite", "G 01", {});
    expect(f.calls[0].path).toBe(`${BASE}/objects/Satellite/G%2001`);
  });

  test("412 sets conflict, leaves the doc and ETag untouched and rethrows the ApiError", async () => {
    stubFetch({ [`PATCH ${BASE}/objects/Satellite/G01`]: { status: 412, json: { code: "ETAG_MISMATCH", text: "ถูกแก้จากที่อื่น" } } });
    const before = st().doc;
    const err = await st().patchObject("Satellite", "G01", {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("ETAG_MISMATCH");
    expect(st().conflict).toBe(true);
    expect(st().doc).toBe(before);
    expect(st().etag).toBe(E1);
  });

  test("another kind of error does not set conflict", async () => {
    stubFetch({ [`PATCH ${BASE}/objects/Satellite/G01`]: { status: 422, json: { code: "SCENARIO_INVALID", text: "ค่าผิด", field: "graphics2d.color" } } });
    await expect(st().patchObject("Satellite", "G01", {})).rejects.toMatchObject({ code: "SCENARIO_INVALID", field: "graphics2d.color" });
    expect(st().conflict).toBe(false);
  });

  test("reload fetches again and clears conflict", async () => {
    stubFetch({ [`PATCH ${BASE}/objects/Satellite/G01`]: { status: 412, json: { code: "ETAG_MISMATCH", text: "x" } } });
    await st().patchObject("Satellite", "G01", {}).catch(() => undefined);
    expect(st().conflict).toBe(true);
    const f = stubFetch({
      [`GET ${BASE}`]: { json: { ...DOC, description: "from the other tab" }, headers: { ETag: E3 } },
      [`GET ${BASE}/objects`]: { json: TREE, headers: { ETag: E3 } },
    });
    await st().reload();
    expect(st().conflict).toBe(false);
    expect(st().etag).toBe(E3);
    expect(st().doc?.description).toBe("from the other tab");
    expect(paths(f)).toEqual([`GET ${BASE}`, `GET ${BASE}/objects`]);
  });

  test("reload says true when the fresh doc and tree arrived", async () => {
    stubFetch({
      [`GET ${BASE}`]: { json: DOC, headers: { ETag: E3 } },
      [`GET ${BASE}/objects`]: { json: TREE, headers: { ETag: E3 } },
    });
    await expect(st().reload()).resolves.toBe(true);
  });

  test("reload says false, keeps the doc and the conflict flag, and reports, when the fresh data did not arrive", async () => {
    stubFetch({ [`PATCH ${BASE}/objects/Satellite/G01`]: { status: 412, json: { code: "ETAG_MISMATCH", text: "x" } } });
    await st().patchObject("Satellite", "G01", {}).catch(() => undefined);
    const before = st().doc;
    stubFetch({
      [`GET ${BASE}`]: { status: 500, json: { code: "INTERNAL", text: "อ่านไม่ได้" } },
      [`GET ${BASE}/objects`]: { json: TREE, headers: { ETag: E3 } },
    });
    await expect(st().reload()).resolves.toBe(false);
    expect(st().conflict).toBe(true);
    expect(st().doc).toBe(before);
    expect(st().etag).toBe(E1);
    expect(useMessages.getState().items.some((m) => m.code === "INTERNAL")).toBe(true);
  });

  test("reload says false when no scenario is open", async () => {
    st().close();
    await expect(st().reload()).resolves.toBe(false);
  });

  test("putDoc sends a changed copy with If-Match and reads X-Results-Stale", async () => {
    const f = stubFetch({
      [`PUT ${BASE}`]: (c) => ({ json: c.body, headers: { ETag: E2, "X-Results-Stale": "true" } }),
      [`GET ${BASE}/objects`]: { json: TREE, headers: { ETag: E2 } },
      [`GET ${BASE}/results`]: { json: RESULTS_MISSING },
    });
    const original = st().doc;
    const r = await st().putDoc((d) => { d.description = "edited"; });
    expect(r).toEqual({ stale: true });
    const put = f.calls.find((c) => c.method === "PUT");
    expect(put?.headers.get("if-match")).toBe(E1);
    expect((put?.body as { description: string }).description).toBe("edited");
    expect(original?.description).toBeUndefined(); // แก้บนสำเนา ไม่แตะ doc เดิมก่อนบันทึกสำเร็จ
    expect(st().doc?.description).toBe("edited");
    expect(st().etag).toBe(E2);
  });

  test("putDoc reports stale false when the header says false or is missing", async () => {
    stubFetch({
      [`PUT ${BASE}`]: (c) => ({ json: c.body, headers: { ETag: E2, "X-Results-Stale": "false" } }),
      [`GET ${BASE}/objects`]: { json: TREE, headers: { ETag: E2 } },
    });
    expect(await st().putDoc((d) => { d.description = "a"; })).toEqual({ stale: false });
    stubFetch({
      [`PUT ${BASE}`]: (c) => ({ json: c.body, headers: { ETag: E3 } }),
      [`GET ${BASE}/objects`]: { json: TREE, headers: { ETag: E3 } },
    });
    expect(await st().putDoc((d) => { d.description = "b"; })).toEqual({ stale: false });
  });

  test("putDoc with 412 sets conflict and keeps the doc", async () => {
    stubFetch({ [`PUT ${BASE}`]: { status: 412, json: { code: "ETAG_MISMATCH", text: "x" } } });
    const before = st().doc;
    await expect(st().putDoc((d) => { d.description = "z"; })).rejects.toMatchObject({ status: 412 });
    expect(st().conflict).toBe(true);
    expect(st().doc).toBe(before);
    expect(st().etag).toBe(E1);
  });

  test("putDoc restarts the clock only when the analysis period or animation changed", async () => {
    const put = (c: { body: unknown }) => ({ json: c.body, headers: { ETag: E2, "X-Results-Stale": "false" } });
    stubFetch({ [`PUT ${BASE}`]: put, [`GET ${BASE}/objects`]: { json: TREE, headers: { ETag: E2 } } });
    useTime.getState().setCurrent(new Date("2026-11-11T05:00:00Z"));
    await st().putDoc((d) => { d.description = "only text"; });
    expect(useTime.getState().current.toISOString()).toBe("2026-11-11T05:00:00.000Z");
    await st().putDoc((d) => { d.analysis_period = { start: "2026-11-11T00:00:00Z", stop: "2026-11-13T00:00:00Z" }; });
    expect(useTime.getState().periodStop.toISOString()).toBe("2026-11-13T00:00:00.000Z");
    expect(useTime.getState().current.toISOString()).toBe("2026-11-11T00:00:00.000Z");
  });

  test("insert returns the created paths and keeps the new ETag", async () => {
    const f = stubFetch({
      [`POST ${BASE}/objects`]: { status: 201, json: { created: ["*/Satellite/G02"], etag: "2", results_stale: true }, headers: { ETag: E2 } },
      [`GET ${BASE}`]: { json: DOC, headers: { ETag: E2 } },
      [`GET ${BASE}/objects`]: { json: TREE, headers: { ETag: E2 } },
      [`GET ${BASE}/results`]: { json: RESULTS_MISSING },
    });
    const created = await st().insert({ class: "Satellite", method: "From Satellite Catalog", norads: [37753] });
    expect(created).toEqual(["*/Satellite/G02"]);
    expect(f.calls[0].headers.get("if-match")).toBe(E1);
    expect(f.calls[0].body).toEqual({ class: "Satellite", method: "From Satellite Catalog", norads: [37753] });
    expect(st().etag).toBe(E2);
  });

  test("rename, remove and setGroup send If-Match and the documented bodies", async () => {
    const E4 = '"4444444444444444"';
    let cur = E1; // ETag ปัจจุบันของ server: แต่ละการเขียนเปลี่ยนมัน และ GET หลังเขียนคืนค่าเดียวกัน
    const wrote = (next: string, stale: boolean) => () => { cur = next; return { json: { etag: next.slice(1, -1), results_stale: stale }, headers: { ETag: next } }; };
    const f = stubFetch({
      [`POST ${BASE}/objects/Satellite/G01/rename`]: wrote(E2, false),
      [`DELETE ${BASE}/objects/Satellite/GPS01`]: wrote(E3, true),
      [`POST ${BASE}/groups`]: wrote(E4, false),
      [`GET ${BASE}`]: () => ({ json: DOC, headers: { ETag: cur } }),
      [`GET ${BASE}/objects`]: () => ({ json: TREE, headers: { ETag: cur } }),
      [`GET ${BASE}/results`]: { json: RESULTS_MISSING },
    });
    await st().rename("Satellite", "G01", "GPS01");
    await st().remove("Satellite", "GPS01");
    await st().setGroup("GPS sats", []);
    const call = (method: string, suffix: string) => f.calls.find((c) => c.method === method && c.path.endsWith(suffix))!;
    const rename = call("POST", "/G01/rename");
    const remove = call("DELETE", "/GPS01");
    const group = call("POST", "/groups");
    expect(rename.body).toEqual({ new_name: "GPS01" });
    expect(group.body).toEqual({ name: "GPS sats", members: [] });
    expect(remove.body).toBeUndefined();
    expect(rename.headers.get("if-match")).toBe(E1);
    expect(remove.headers.get("if-match")).toBe(E2); // แต่ละครั้งใช้ ETag ล่าสุด
    expect(group.headers.get("if-match")).toBe(E3);
  });

  test("a write with no scenario open is refused without calling the server", async () => {
    st().close();
    const f = stubFetch({});
    await expect(st().patchObject("Satellite", "G01", {})).rejects.toThrow(/scenario/);
    expect(f.calls).toHaveLength(0);
  });
});

describe("a write whose reload fails", () => {
  /** server ปลอมที่จำค่าที่เขียนไว้จริง: PATCH เปลี่ยน description เป็น "patched", PUT เก็บ body ทั้งก้อน */
  function stateful() {
    const s = { cur: E1, doc: structuredClone(DOC) as Record<string, unknown>, docFails: false, treeFails: false };
    const f = stubFetch({
      [`PATCH ${BASE}/objects/Satellite/G01`]: () => { s.doc = { ...s.doc, description: "patched" }; s.cur = E2; return { json: { etag: "2222222222222222", results_stale: false }, headers: { ETag: E2 } }; },
      [`GET ${BASE}`]: () => (s.docFails ? { status: 500, json: { code: "INTERNAL", text: "ขัดข้อง" } } : { json: s.doc, headers: { ETag: s.cur } }),
      [`GET ${BASE}/objects`]: () => (s.treeFails ? { status: 500, json: { code: "INTERNAL", text: "ขัดข้อง" } } : { json: TREE, headers: { ETag: s.cur } }),
      [`PUT ${BASE}`]: (c) => { s.doc = c.body as Record<string, unknown>; s.cur = s.cur === E1 ? E2 : E3; return { json: s.doc, headers: { ETag: s.cur, "X-Results-Stale": "false" } }; },
      [`GET ${BASE}/results`]: { json: RESULTS_MISSING },
    });
    return { s, f };
  }

  beforeEach(async () => {
    server();
    await st().load("E2E");
    useMessages.setState(useMessages.getInitialState(), true);
  });

  test("the write still succeeds, the ETag moves on, and the doc is marked stale with a warning", async () => {
    const { s } = stateful();
    s.docFails = true;
    expect(await st().patchObject("Satellite", "G01", { basic: { description: "x" } })).toEqual({ stale: false });
    expect(st().etag).toBe(E2);
    expect(st().docStale).toBe(true);
    expect(st().doc?.description).toBeUndefined();
    expect(useMessages.getState().items.some((m) => m.level === "warning")).toBe(true);
  });

  test("the next putDoc reloads first, so the earlier change is not reverted by an old copy of the doc", async () => {
    const { s, f } = stateful();
    s.docFails = true;
    await st().patchObject("Satellite", "G01", { basic: { description: "x" } });
    s.docFails = false;
    await st().putDoc((d) => { d.units = { date_format: "LTZG" }; });
    const put = f.calls.find((c) => c.method === "PUT");
    expect(put?.headers.get("if-match")).toBe(E2);
    expect((put?.body as { description?: string }).description).toBe("patched");
    expect((put?.body as { units?: unknown }).units).toEqual({ date_format: "LTZG" });
    expect(st().docStale).toBe(false);
    expect(st().doc?.description).toBe("patched");
    expect(st().etag).toBe(E3);
  });

  test("a putDoc that cannot get a fresh doc is refused with a Thai message and sends nothing", async () => {
    const { s, f } = stateful();
    s.docFails = true;
    await st().patchObject("Satellite", "G01", { basic: { description: "x" } });
    const err = await st().putDoc((d) => { d.description = "mine"; }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("DOC_STALE");
    expect((err as ApiError).text).toMatch(THAI);
    expect(f.calls.some((c) => c.method === "PUT")).toBe(false);
    expect(st().etag).toBe(E2);
    expect(st().docStale).toBe(true);
    expect(st().conflict).toBe(false);
  });

  test("another object write does not need the doc, so it goes ahead with the new ETag", async () => {
    const { s, f } = stateful();
    s.docFails = true;
    await st().patchObject("Satellite", "G01", {});
    await st().patchObject("Satellite", "G01", {});
    const patches = f.calls.filter((c) => c.method === "PATCH");
    expect(patches[1].headers.get("if-match")).toBe(E2);
  });

  test("a later successful reload clears the stale mark", async () => {
    const { s } = stateful();
    s.docFails = true;
    await st().patchObject("Satellite", "G01", {});
    s.docFails = false;
    await st().reload();
    expect(st().docStale).toBe(false);
    expect(st().doc?.description).toBe("patched");
  });

  test("putDoc keeps the saved doc and its ETag together even when the tree cannot be reloaded", async () => {
    const { s, f } = stateful();
    s.treeFails = true;
    await st().putDoc((d) => { d.description = "first"; });
    expect(st().doc?.description).toBe("first");
    expect(st().etag).toBe(E2);
    expect(st().docStale).toBe(false);
    expect(useMessages.getState().items.some((m) => m.level === "warning")).toBe(true);
    // ครั้งต่อไปต่อยอดจากเอกสารที่เพิ่งบันทึก ไม่ย้อนค่าแรก
    await st().putDoc((d) => { d.units = { date_format: "LTZG" }; });
    const puts = f.calls.filter((c) => c.method === "PUT");
    expect(puts[1].headers.get("if-match")).toBe(E2);
    expect((puts[1].body as { description?: string }).description).toBe("first");
  });

  test("a write that finishes after the scenario was closed leaves the store alone", async () => {
    const gate = deferred<{ json: unknown; headers: Record<string, string> }>();
    const f = stubFetch({
      [`PATCH ${BASE}/objects/Satellite/G01`]: () => gate.promise,
      [`GET ${BASE}`]: { json: DOC, headers: { ETag: E2 } },
      [`GET ${BASE}/objects`]: { json: TREE, headers: { ETag: E2 } },
      [`GET ${BASE}/results`]: { json: RESULTS_MISSING },
    });
    const write = st().patchObject("Satellite", "G01", {});
    st().close();
    gate.resolve({ json: { etag: "2222222222222222", results_stale: true }, headers: { ETag: E2 } });
    expect(await write).toEqual({ stale: true });
    expect(st().name).toBeNull();
    expect(st().etag).toBeNull();
    expect(st().docStale).toBe(false);
    expect(f.calls.map((c) => c.method)).toEqual(["PATCH"]); // ไม่โหลดอะไรต่อ ไม่แตะผลลัพธ์ของ scenario อื่น
  });

  test("the same holds for putDoc, and a 412 that comes back after a switch does not mark the new scenario as conflicting", async () => {
    const gate = deferred<{ status: number; json: unknown }>();
    stubFetch({ [`PUT ${BASE}`]: () => gate.promise });
    const write = st().putDoc((d) => { d.description = "x"; }).catch((e: unknown) => e);
    st().close();
    gate.resolve({ status: 412, json: { code: "ETAG_MISMATCH", text: "x" } });
    expect(await write).toBeInstanceOf(ApiError);
    expect(st().conflict).toBe(false);

    await (async () => {
      server();
      await st().load("E2E");
    })();
    const gate2 = deferred<{ json: unknown; headers: Record<string, string> }>();
    stubFetch({ [`PUT ${BASE}`]: () => gate2.promise });
    const w2 = st().putDoc((d) => { d.description = "y"; });
    st().close();
    gate2.resolve({ json: { ...DOC, description: "y" }, headers: { ETag: E3, "X-Results-Stale": "false" } });
    expect(await w2).toEqual({ stale: false });
    expect(st().doc).toBeNull();
    expect(st().etag).toBeNull();
  });
});

describe("a scenario event that arrives while the scenario is still opening", () => {
  function opening(onSecond: Handler = { json: { ...DOC, description: "newer" }, headers: { ETag: E2 } }) {
    const gate = deferred<{ json: unknown; headers: Record<string, string> }>();
    let docCalls = 0;
    const f = stubFetch({
      [`GET ${BASE}`]: () => (++docCalls === 1 ? gate.promise : typeof onSecond === "function" ? onSecond({} as never) : onSecond),
      [`GET ${BASE}/objects`]: () => ({ json: TREE, headers: { ETag: E1 } }),
      "GET /api/catalog": { json: [] },
      [`GET ${BASE}/results`]: { json: RESULTS_MISSING },
    });
    return { gate, f, docCalls: () => docCalls };
  }

  test("is not dropped: once opened, a different ETag reloads the doc", async () => {
    const { gate, f } = opening();
    const load = st().load("E2E");
    await st().onScenarioEvent({ name: "E2E", etag: "2222222222222222", results_stale: false });
    gate.resolve({ json: DOC, headers: { ETag: E1 } });
    expect(await load).toBe(true);
    expect(st().etag).toBe(E2);
    expect(st().doc?.description).toBe("newer");
    expect(f.calls.filter((c) => c.path === BASE)).toHaveLength(2);
  });

  test("an event with the ETag we already loaded changes nothing", async () => {
    const { gate, f } = opening();
    const load = st().load("E2E");
    await st().onScenarioEvent({ name: "E2E", etag: "1111111111111111", results_stale: false });
    gate.resolve({ json: DOC, headers: { ETag: E1 } });
    await load;
    expect(f.calls.filter((c) => c.path === BASE)).toHaveLength(1);
    expect(st().etag).toBe(E1);
  });

  test("a results_stale flag is honoured after the open", async () => {
    const { gate, f } = opening();
    const load = st().load("E2E");
    await st().onScenarioEvent({ name: "E2E", etag: "1111111111111111", results_stale: true });
    gate.resolve({ json: DOC, headers: { ETag: E1 } });
    await load;
    expect(f.calls.filter((c) => c.path === `${BASE}/results`).length).toBeGreaterThanOrEqual(1);
  });

  test("a deletion that arrives meanwhile closes the scenario right after it opened, with the Thai warning", async () => {
    const { gate } = opening();
    const load = st().load("E2E");
    await st().onScenarioEvent({ name: "E2E", etag: null, results_stale: false });
    gate.resolve({ json: DOC, headers: { ETag: E1 } });
    await load;
    expect(st().name).toBeNull();
    const m = useMessages.getState().items.filter((x) => x.level === "warning");
    expect(m).toHaveLength(1);
    expect(m[0].text).toMatch(THAI);
  });

  test("events for another scenario are not held back, and a failed open drops what was held", async () => {
    server();
    await st().load("E2E");
    const slow = deferred<{ status: number; json: unknown }>();
    stubFetch({
      "GET /api/scenarios/BAD": () => slow.promise,
      "GET /api/scenarios/BAD/objects": { status: 404, json: { code: "NOT_FOUND", text: "ไม่พบ" } },
    });
    const bad = st().load("BAD");
    stubFetch({ [`GET ${BASE}`]: { json: DOC, headers: { ETag: E2 } }, [`GET ${BASE}/objects`]: { json: TREE, headers: { ETag: E2 } } });
    await st().onScenarioEvent({ name: "E2E", etag: "2222222222222222", results_stale: false });
    expect(st().etag).toBe(E2); // E2E ที่เปิดอยู่ ประมวลผลตามปกติ
    await st().onScenarioEvent({ name: "BAD", etag: "3333333333333333", results_stale: false });
    slow.resolve({ status: 404, json: { code: "NOT_FOUND", text: "ไม่พบ" } });
    expect(await bad).toBe(false);
    expect(st().name).toBe("E2E");
  });
});

describe("onScenarioEvent", () => {
  beforeEach(async () => {
    server();
    await st().load("E2E");
  });
  const other = (over: Record<string, Handler> = {}) =>
    stubFetch({
      [`GET ${BASE}`]: { json: { ...DOC, description: "newer" }, headers: { ETag: E2 } },
      [`GET ${BASE}/objects`]: { json: TREE, headers: { ETag: E2 } },
      [`GET ${BASE}/results`]: { json: RESULTS_MISSING },
      ...over,
    });

  test("the same ETag (the event carries it without quotes) changes nothing and fetches nothing", async () => {
    const f = other();
    await st().onScenarioEvent({ name: "E2E", etag: "1111111111111111", results_stale: false });
    expect(f.calls).toHaveLength(0);
  });

  test("a different ETag silently reloads the doc and the tree", async () => {
    const f = other();
    await st().onScenarioEvent({ name: "E2E", etag: "2222222222222222", results_stale: false });
    expect(st().etag).toBe(E2);
    expect(st().doc?.description).toBe("newer");
    expect(paths(f)).toEqual([`GET ${BASE}`, `GET ${BASE}/objects`]);
    expect(useMessages.getState().items).toEqual([]); // เงียบ
  });

  test("a silent reload does not clear a conflict the user is still looking at", async () => {
    useScenario.setState({ conflict: true });
    other();
    await st().onScenarioEvent({ name: "E2E", etag: "2222222222222222", results_stale: false });
    expect(st().conflict).toBe(true);
  });

  test("an event for another scenario is ignored", async () => {
    const f = other();
    await st().onScenarioEvent({ name: "ELSE", etag: "2222222222222222", results_stale: true });
    await st().onScenarioEvent({ name: "ELSE", etag: null, results_stale: false });
    expect(f.calls).toHaveLength(0);
    expect(st().name).toBe("E2E");
  });

  test("etag null (deleted) closes the scenario and warns in Thai", async () => {
    other();
    await st().onScenarioEvent({ name: "E2E", etag: null, results_stale: false });
    expect(st().name).toBeNull();
    expect(st().doc).toBeNull();
    const m = useMessages.getState().items;
    expect(m).toHaveLength(1);
    expect(m[0].level).toBe("warning");
    expect(m[0].text).toMatch(THAI);
    expect(m[0].text).toContain("E2E");
  });

  test("results_stale refreshes the results; false does not", async () => {
    const f = other();
    await st().onScenarioEvent({ name: "E2E", etag: "1111111111111111", results_stale: false });
    expect(paths(f)).not.toContain(`GET ${BASE}/results`);
    await st().onScenarioEvent({ name: "E2E", etag: "1111111111111111", results_stale: true });
    expect(paths(f)).toEqual([`GET ${BASE}/results`]);
  });

  test("an event that arrives while our own write is in flight does not trigger a second reload", async () => {
    const gate = deferred<{ json: unknown; headers: Record<string, string> }>();
    const f = stubFetch({
      [`PATCH ${BASE}/objects/Satellite/G01`]: () => gate.promise,
      [`GET ${BASE}`]: { json: DOC, headers: { ETag: E2 } },
      [`GET ${BASE}/objects`]: { json: TREE, headers: { ETag: E2 } },
    });
    const write = st().patchObject("Satellite", "G01", {});
    await st().onScenarioEvent({ name: "E2E", etag: "2222222222222222", results_stale: false });
    expect(f.calls.filter((c) => c.method === "GET")).toHaveLength(0);
    gate.resolve({ json: { etag: "2222222222222222", results_stale: false }, headers: { ETag: E2 } });
    await write;
    expect(f.calls.filter((c) => c.method === "GET" && c.path === BASE)).toHaveLength(1); // รีโหลดหลังเขียนครั้งเดียว
  });

  test("a failing silent reload warns instead of throwing", async () => {
    other({ [`GET ${BASE}`]: { status: 500, json: { code: "INTERNAL", text: "ขัดข้อง" } } });
    await expect(st().onScenarioEvent({ name: "E2E", etag: "2222222222222222", results_stale: false })).resolves.toBeUndefined();
    expect(useMessages.getState().items[0].level).toBe("warning");
    expect(st().etag).toBe(E1);
  });

  test("a silent reload that changed the snapshot loads the catalog again", async () => {
    const f = other({ [`GET ${BASE}`]: { json: { ...DOC, orbit_snapshot: "20261112T0000Z" }, headers: { ETag: E2 } }, "GET /api/catalog": { json: [CATALOG[0]] } });
    await st().onScenarioEvent({ name: "E2E", etag: "2222222222222222", results_stale: false });
    expect(f.calls.find((c) => c.path === "/api/catalog")?.query.get("snapshot")).toBe("20261112T0000Z");
    expect(st().catalog.size).toBe(1);
  });
});
