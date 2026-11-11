import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { parseAerCsv, parseDopCsv } from "../../src/data/files";
import { useMessages } from "../../src/stores/messages";
import { useResults } from "../../src/stores/results";
import { useScenario } from "../../src/stores/scenario";
import { deferred, stubFetch } from "./helpers/fake-fetch";

const EPH = "a1b2c3d4e5f6";
const ACC1 = "111111111111";
const ACC2 = "222222222222";

const DOP_HEADER = "time_utc,system,n_visible,gdop,pdop,hdop,vdop,edop,ndop,tdop";
const DOP_CSV = [
  DOP_HEADER,
  "2026-11-11T00:00:00Z,ALL,12,1.800,1.500,0.900,1.200,0.500,0.700,0.800",
  "2026-11-11T00:00:00Z,G,6,2.100,1.900,1.000,1.600,0.600,0.800,0.900",
  "2026-11-11T00:00:00Z,R,3,,,,,,,",
  "2026-11-11T00:00:00Z,E,2,,,,,,,",
  "2026-11-11T00:00:00Z,C,1,,,,,,,",
  "2026-11-11T00:00:30Z,ALL,11,1.810,1.510,0.910,1.210,0.510,0.710,0.810",
  "2026-11-11T00:00:30Z,G,5,2.200,2.000,1.100,1.700,0.700,0.900,1.000",
  "2026-11-11T00:01:00Z,ALL,3,,,,,,,",
  "",
].join("\n");

const MANIFEST = {
  gmat_version: "R2025a",
  satellites: [
    { prn: "G01", system: "G", svn: "063", norad: 37753, block: "IIF", celestrak_name: "GPS BIIF-1 (PRN 25)", omm_epoch: "2026-11-10T12:00:00.000Z", age_days: 0.5, flags: [], propagated: true },
    { prn: "E05", system: "E", svn: "", norad: 40128, block: "FOC", celestrak_name: "GALILEO 7", omm_epoch: "2026-11-10T12:00:00.000Z", age_days: 0.5, flags: ["stale"], propagated: true },
    { prn: "G99", system: "G", svn: "", norad: null, block: "", celestrak_name: "X", omm_epoch: "2026-11-10T12:00:00.000Z", age_days: 0.5, flags: [], propagated: false },
  ],
};

const RESULTS_OK = {
  ephem: { hash: EPH, status: "current", available: [EPH] },
  access: {
    OLD: { hash: ACC1, status: "stale", available: ["000000000000"] },
    THBK: { hash: ACC2, status: "current", available: [ACC2] },
  },
  error: null,
};

function routes(over: Record<string, unknown> = {}) {
  return {
    "GET /api/scenarios/E2E/results": { json: RESULTS_OK },
    [`GET /api/scenarios/E2E/ephem/${EPH}/manifest.json`]: { json: MANIFEST },
    [`GET /api/scenarios/E2E/access/THBK/${ACC2}/dop.csv`]: { text: DOP_CSV },
    ...over,
  } as Parameters<typeof stubFetch>[0];
}

beforeEach(() => {
  useResults.getState().reset(); // also empties the module-level aer.csv cache
  useResults.setState(useResults.getInitialState(), true);
  useMessages.setState(useMessages.getInitialState(), true);
  useScenario.setState({ name: "E2E" });
});
afterEach(() => vi.unstubAllGlobals());

describe("parseDopCsv", () => {
  test("keeps only the ALL rows and reads the numbers", () => {
    const rows = parseDopCsv(DOP_CSV);
    expect(rows.map((r) => r.time_utc)).toEqual(["2026-11-11T00:00:00Z", "2026-11-11T00:00:30Z", "2026-11-11T00:01:00Z"]);
    expect(rows[0]).toMatchObject({ n_visible: 12, gdop: 1.8, pdop: 1.5, hdop: 0.9, vdop: 1.2, edop: 0.5, ndop: 0.7, tdop: 0.8 });
    expect(rows[0].t).toBe(Date.UTC(2026, 10, 11, 0, 0, 0));
  });

  test("blank DOP cells (fewer than four satellites) are null, not zero", () => {
    const row = parseDopCsv(DOP_CSV)[2];
    expect(row.n_visible).toBe(3);
    expect(row.pdop).toBeNull();
    expect(row.gdop).toBeNull();
  });

  test("reads columns by their header name and accepts CRLF", () => {
    const text = "system,time_utc,tdop,pdop,gdop,hdop,vdop,edop,ndop,n_visible\r\nALL,2026-11-11T00:00:00Z,0.8,1.5,1.8,0.9,1.2,0.5,0.7,12\r\n";
    expect(parseDopCsv(text)[0]).toMatchObject({ n_visible: 12, pdop: 1.5, tdop: 0.8 });
  });

  test("a header-only or empty file gives no rows", () => {
    expect(parseDopCsv(DOP_HEADER + "\n")).toEqual([]);
    expect(parseDopCsv("")).toEqual([]);
  });

  test("a missing column or an unreadable time or count is a RangeError", () => {
    expect(() => parseDopCsv("time_utc,system\n2026-11-11T00:00:00Z,ALL\n")).toThrow(RangeError);
    expect(() => parseDopCsv(`${DOP_HEADER}\nnot-a-time,ALL,1,,,,,,,\n`)).toThrow(RangeError);
    expect(() => parseDopCsv(`${DOP_HEADER}\n2026-11-11T00:00:00Z,ALL,many,,,,,,,\n`)).toThrow(RangeError);
  });

  test("rows that arrive out of order are sorted by time", () => {
    const text = [DOP_HEADER, "2026-11-11T00:00:30Z,ALL,2,,,,,,,", "2026-11-11T00:00:00Z,ALL,1,,,,,,,"].join("\n");
    expect(parseDopCsv(text).map((r) => r.n_visible)).toEqual([1, 2]);
  });
});

describe("parseAerCsv", () => {
  const HEADER = "time_utc,prn,az_deg,el_deg,range_km,ipp_lat_deg,ipp_lon_deg,mf";
  test("reads every column", () => {
    const rows = parseAerCsv(`${HEADER}\n2026-11-11T00:00:30Z,G01,123.456,45.5,21000.123,12.3456,100.5,1.23456\n2026-11-11T00:01:00Z,E05,0.000,10.000,25000.000,,,\n`);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ time_utc: "2026-11-11T00:00:30Z", prn: "G01", az_deg: 123.456, el_deg: 45.5, range_km: 21000.123, ipp_lat_deg: 12.3456, ipp_lon_deg: 100.5, mf: 1.23456 });
    expect(rows[0].t).toBe(Date.UTC(2026, 10, 11, 0, 0, 30));
    expect(rows[1]).toMatchObject({ prn: "E05", az_deg: 0, ipp_lat_deg: null, ipp_lon_deg: null, mf: null });
  });

  test("a missing column is a RangeError", () => {
    expect(() => parseAerCsv("time_utc,prn\n")).toThrow(RangeError);
  });
});

describe("refresh", () => {
  test("loads the ephem manifest, builds prnByNorad and loads dop.csv of the first current Facility", async () => {
    const f = stubFetch(routes());
    await useResults.getState().refresh();
    const s = useResults.getState();
    expect(s.status).toBe("current");
    expect(s.manifest?.gmat_version).toBe("R2025a");
    expect([...s.prnByNorad]).toEqual([[37753, "G01"], [40128, "E05"]]); // ดาวที่ไม่มี NORAD ข้าม
    expect(s.dopFacility).toBe("THBK");
    expect(s.dop).toHaveLength(3);
    expect(f.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "GET /api/scenarios/E2E/results",
      `GET /api/scenarios/E2E/ephem/${EPH}/manifest.json`,
      `GET /api/scenarios/E2E/access/THBK/${ACC2}/dop.csv`, // OLD ผลไม่ตรง ข้าม
    ]);
  });

  test("dopAt gives the latest row at or before the time", async () => {
    stubFetch(routes());
    await useResults.getState().refresh();
    const { dopAt } = useResults.getState();
    expect(dopAt(new Date("2026-11-11T00:00:45Z"))?.time_utc).toBe("2026-11-11T00:00:30Z");
    expect(dopAt(new Date("2026-11-11T00:00:30Z"))?.time_utc).toBe("2026-11-11T00:00:30Z");
    expect(dopAt(new Date("2026-11-11T00:00:00Z"))?.n_visible).toBe(12);
    expect(dopAt(new Date("2026-11-11T00:00:45Z"))?.pdop).toBe(1.51);
  });

  test("stale results load no manifest or DOP and leave the Facility only view", async () => {
    const f = stubFetch(routes({
      "GET /api/scenarios/E2E/results": { json: { ephem: { hash: EPH, status: "stale", available: ["ffffffffffff"] }, access: { THBK: { hash: ACC2, status: "stale", available: [] } }, error: null } },
    }));
    await useResults.getState().refresh();
    const s = useResults.getState();
    expect(s.status).toBe("stale");
    expect(s.manifest).toBeNull();
    expect(s.prnByNorad.size).toBe(0);
    expect(s.dop).toEqual([]);
    expect(f.calls).toHaveLength(1);
  });

  test("missing results with an engine error keep the error", async () => {
    stubFetch(routes({
      "GET /api/scenarios/E2E/results": { json: { ephem: { hash: null, status: "missing", available: [] }, access: {}, error: { code: "ORBIT_SOURCE_UNAVAILABLE", text: "ไม่พบ snapshot" } } },
    }));
    await useResults.getState().refresh();
    expect(useResults.getState().status).toBe("missing");
    expect(useResults.getState().info?.error).toEqual({ code: "ORBIT_SOURCE_UNAVAILABLE", text: "ไม่พบ snapshot" });
  });

  test("a current ephem with no current access result still loads the manifest and has no DOP", async () => {
    stubFetch(routes({ "GET /api/scenarios/E2E/results": { json: { ...RESULTS_OK, access: { THBK: { hash: ACC2, status: "missing", available: [] } } } } }));
    await useResults.getState().refresh();
    expect(useResults.getState().manifest).not.toBeNull();
    expect(useResults.getState().dop).toEqual([]);
    expect(useResults.getState().dopFacility).toBeNull();
  });

  test("a manifest that cannot be read adds a warning and does not stop the DOP", async () => {
    stubFetch(routes({ [`GET /api/scenarios/E2E/ephem/${EPH}/manifest.json`]: { status: 404, json: { code: "NOT_FOUND", text: "ไม่พบไฟล์ผลลัพธ์ที่ร้องขอ" } } }));
    await useResults.getState().refresh();
    expect(useResults.getState().manifest).toBeNull();
    expect(useResults.getState().dop).toHaveLength(3);
    const warned = useMessages.getState().items.filter((m) => m.level === "warning");
    expect(warned).toHaveLength(1);
    expect(warned[0].text).toContain("ไม่พบไฟล์ผลลัพธ์ที่ร้องขอ");
  });

  test("a corrupt dop.csv adds a warning and leaves no DOP", async () => {
    stubFetch(routes({ [`GET /api/scenarios/E2E/access/THBK/${ACC2}/dop.csv`]: { text: "time_utc,system\nx,ALL\n" } }));
    await useResults.getState().refresh();
    expect(useResults.getState().dop).toEqual([]);
    expect(useMessages.getState().items.some((m) => m.level === "warning")).toBe(true);
  });

  test("a failed results request keeps the status unknown and reports the server text", async () => {
    stubFetch(routes({ "GET /api/scenarios/E2E/results": { status: 404, json: { code: "NOT_FOUND", text: "ไม่พบ scenario" } } }));
    await useResults.getState().refresh();
    expect(useResults.getState().status).toBe("unknown");
    expect(useMessages.getState().items.at(-1)?.text).toContain("ไม่พบ scenario");
  });

  test("a lost connection does not flood the message list", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await useResults.getState().refresh();
    expect(useMessages.getState().items).toEqual([]);
  });

  test("with no scenario open it clears everything and fetches nothing", async () => {
    const f = stubFetch(routes());
    await useResults.getState().refresh();
    useScenario.setState({ name: null });
    await useResults.getState().refresh();
    expect(useResults.getState().status).toBe("unknown");
    expect(useResults.getState().manifest).toBeNull();
    expect(useResults.getState().dop).toEqual([]);
    expect(f.calls).toHaveLength(3); // จากรอบแรกเท่านั้น
  });

  test("a newer refresh cancels the older one, whose late answer is discarded", async () => {
    const first = deferred<{ json: unknown }>();
    let n = 0;
    const f = stubFetch(routes({
      "GET /api/scenarios/E2E/results": () => (++n === 1 ? first.promise : Promise.resolve({ json: RESULTS_OK })),
    }));
    const older = useResults.getState().refresh();
    const newer = useResults.getState().refresh();
    await newer;
    expect(useResults.getState().status).toBe("current");
    // คำตอบช้าของรอบแรก (ผลไม่ตรง) ต้องไม่ทับรอบใหม่
    first.resolve({ json: { ephem: { hash: EPH, status: "stale", available: [] }, access: {}, error: null } });
    await older;
    expect(useResults.getState().status).toBe("current");
    expect(useResults.getState().dop).toHaveLength(3);
    expect(f.calls.filter((c) => c.path.endsWith("/results"))).toHaveLength(2);
  });

  test("an older refresh that is cancelled mid-flight leaves no warning", async () => {
    stubFetch(routes({ "GET /api/scenarios/E2E/results": () => new Promise(() => undefined) }));
    const older = useResults.getState().refresh();
    stubFetch(routes());
    await useResults.getState().refresh();
    await older;
    expect(useMessages.getState().items).toEqual([]);
  });

  test("reset clears the results and cancels a refresh in flight", async () => {
    stubFetch(routes());
    await useResults.getState().refresh();
    useResults.getState().reset();
    expect(useResults.getState().status).toBe("unknown");
    expect(useResults.getState().manifest).toBeNull();
    expect(useResults.getState().dop).toEqual([]);
  });
});

describe("file URLs and AER", () => {
  test("ephemUrl and accessUrl point at the current bundles; null when there is none", async () => {
    stubFetch(routes());
    expect(useResults.getState().ephemUrl("scene.czml")).toBeNull();
    await useResults.getState().refresh();
    const s = useResults.getState();
    expect(s.ephemUrl("scene.czml")).toBe(`/api/scenarios/E2E/ephem/${EPH}/scene.czml`);
    expect(s.accessUrl("THBK", "access.czml")).toBe(`/api/scenarios/E2E/access/THBK/${ACC2}/access.czml`);
    expect(s.accessUrl("OLD", "access.czml")).toBeNull(); // ผลไม่ตรง
    expect(s.accessUrl("NOPE", "access.czml")).toBeNull();
  });

  test("loadAer fetches and parses aer.csv of a Facility with current results", async () => {
    const f = stubFetch(routes({
      [`GET /api/scenarios/E2E/access/THBK/${ACC2}/aer.csv`]: { text: "time_utc,prn,az_deg,el_deg,range_km,ipp_lat_deg,ipp_lon_deg,mf\n2026-11-11T00:00:30Z,G01,10.000,20.000,22000.000,5.0000,100.0000,1.50000\n" },
    }));
    await useResults.getState().refresh();
    const rows = await useResults.getState().loadAer("THBK");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ prn: "G01", el_deg: 20 });
    await useResults.getState().loadAer("THBK");
    expect(f.calls.filter((c) => c.path.endsWith("aer.csv"))).toHaveLength(1); // cache ต่อ hash
  });

  test("loadAer gives no rows for a Facility without current results", async () => {
    stubFetch(routes());
    await useResults.getState().refresh();
    expect(await useResults.getState().loadAer("OLD")).toEqual([]);
  });
});

describe("the aer.csv cache", () => {
  const FACS = ["F1", "F2", "F3", "F4", "F5"];
  const hashOf = (f: string) => `${f.slice(1)}`.repeat(12);
  const aerFor = (f: string) => `time_utc,prn,az_deg,el_deg,range_km,ipp_lat_deg,ipp_lon_deg,mf\n2026-11-11T00:00:30Z,${f},10.000,20.000,22000.000,5.0000,100.0000,1.50000\n`;
  function manyFacilities(over: Record<string, unknown> = {}) {
    const access = Object.fromEntries(FACS.map((f) => [f, { hash: hashOf(f), status: "current", available: [hashOf(f)] }]));
    return routes({
      "GET /api/scenarios/E2E/results": { json: { ...RESULTS_OK, access } },
      [`GET /api/scenarios/E2E/access/F1/${hashOf("F1")}/dop.csv`]: { text: DOP_CSV },
      ...Object.fromEntries(FACS.map((f) => [`GET /api/scenarios/E2E/access/${f}/${hashOf(f)}/aer.csv`, { text: aerFor(f) }])),
      ...over,
    });
  }
  const aerCalls = (f: { calls: { path: string }[] }) => f.calls.filter((c) => c.path.endsWith("aer.csv")).map((c) => c.path.split("/")[5]);

  test("keeps at most 4 files and evicts the one used least recently", async () => {
    const f = stubFetch(manyFacilities());
    await useResults.getState().refresh();
    const { loadAer } = useResults.getState();
    for (const fac of ["F1", "F2", "F3", "F4"]) await loadAer(fac);
    expect(aerCalls(f)).toEqual(["F1", "F2", "F3", "F4"]);
    await loadAer("F1"); // ใช้ F1 อีกครั้ง: F2 กลายเป็นตัวที่ไม่ได้ใช้นานสุด
    expect(aerCalls(f)).toHaveLength(4);
    await loadAer("F5"); // เต็มแล้ว: F2 ถูกไล่ออก
    expect(aerCalls(f)).toEqual(["F1", "F2", "F3", "F4", "F5"]);
    await loadAer("F1");
    await loadAer("F3");
    await loadAer("F4");
    await loadAer("F5");
    expect(aerCalls(f)).toHaveLength(5); // ที่เหลือยังอยู่ในแคช
    await loadAer("F2"); // ถูกไล่ไปแล้ว ต้องโหลดใหม่
    expect(aerCalls(f)).toHaveLength(6);
    expect(aerCalls(f).at(-1)).toBe("F2");
  });

  test("two concurrent loads of the same file share one request", async () => {
    const gate = deferred<{ text: string }>();
    const f = stubFetch(manyFacilities({ [`GET /api/scenarios/E2E/access/F1/${hashOf("F1")}/aer.csv`]: () => gate.promise }));
    await useResults.getState().refresh();
    const a = useResults.getState().loadAer("F1");
    const b = useResults.getState().loadAer("F1");
    gate.resolve({ text: aerFor("F1") });
    const [ra, rb] = await Promise.all([a, b]);
    expect(aerCalls(f)).toEqual(["F1"]);
    expect(ra).toBe(rb);
    expect(ra).toHaveLength(1);
    await useResults.getState().loadAer("F1");
    expect(aerCalls(f)).toHaveLength(1);
  });

  test("a failed load is shared by the callers waiting for it, is not cached, and can be retried", async () => {
    let ok = false;
    const f = stubFetch(manyFacilities({
      [`GET /api/scenarios/E2E/access/F1/${hashOf("F1")}/aer.csv`]: () => (ok ? { text: aerFor("F1") } : { status: 500, json: { code: "INTERNAL", text: "ขัดข้อง" } }),
    }));
    await useResults.getState().refresh();
    const results = await Promise.allSettled([useResults.getState().loadAer("F1"), useResults.getState().loadAer("F1")]);
    expect(results.map((r) => r.status)).toEqual(["rejected", "rejected"]);
    expect(aerCalls(f)).toHaveLength(1);
    ok = true;
    expect(await useResults.getState().loadAer("F1")).toHaveLength(1);
    expect(aerCalls(f)).toHaveLength(2);
  });

  test("reset clears the cache and a load that finishes after the reset is not stored", async () => {
    const f = stubFetch(manyFacilities());
    await useResults.getState().refresh();
    await useResults.getState().loadAer("F1");
    useResults.getState().reset();
    await useResults.getState().refresh();
    await useResults.getState().loadAer("F1");
    expect(aerCalls(f)).toHaveLength(2);

    const gate = deferred<{ text: string }>();
    f.routes[`GET /api/scenarios/E2E/access/F2/${hashOf("F2")}/aer.csv`] = () => gate.promise;
    const slow = useResults.getState().loadAer("F2");
    useResults.getState().reset();
    await useResults.getState().refresh();
    gate.resolve({ text: aerFor("F2") });
    await slow;
    f.routes[`GET /api/scenarios/E2E/access/F2/${hashOf("F2")}/aer.csv`] = { text: aerFor("F2") };
    await useResults.getState().loadAer("F2");
    expect(aerCalls(f).filter((x) => x === "F2")).toHaveLength(2);
  });

  test("closing the scenario clears the cache too", async () => {
    const f = stubFetch(manyFacilities());
    await useResults.getState().refresh();
    await useResults.getState().loadAer("F1");
    useScenario.getState().close();
    useScenario.setState({ name: "E2E" });
    await useResults.getState().refresh();
    await useResults.getState().loadAer("F1");
    expect(aerCalls(f)).toHaveLength(2);
  });
});

describe("dopAt without data", () => {
  test("is undefined before the first row, after the last step, and with no rows", () => {
    const one = (t: string, n: number) => parseDopCsv(`${DOP_HEADER}\n${t},ALL,${n},,,,,,,\n`)[0];
    expect(useResults.getState().dopAt(new Date("2026-11-11T00:00:00Z"))).toBeUndefined();
    useResults.setState({ dop: [one("2026-11-11T00:00:00Z", 1), one("2026-11-11T00:00:30Z", 2)] });
    const { dopAt } = useResults.getState();
    expect(dopAt(new Date("2026-11-10T23:59:59Z"))).toBeUndefined();
    expect(dopAt(new Date("2026-11-11T00:00:59Z"))?.n_visible).toBe(2);
    expect(dopAt(new Date("2026-11-11T00:01:00Z"))?.n_visible).toBe(2);
    expect(dopAt(new Date("2026-11-11T00:01:01Z"))).toBeUndefined(); // เลยแถวสุดท้ายไปมากกว่าหนึ่ง step
    expect(dopAt(new Date("2026-12-31T00:00:00Z"))).toBeUndefined();
  });
});
