// ชั้นข้อมูลของรายงานและกราฟ (spec §5, §6; server POST /reports, GET /styles, /dataproviders)

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ApiError } from "../../src/api/client";
import {
  DECIMALS,
  DEFAULT_DECIMALS,
  DEFAULT_EXPORT_SETUP,
  REVOKE_DELAY_MS,
  accessName,
  accessPath,
  decimalsOf,
  deleteMyStyle,
  downloadReport,
  fetchProviders,
  fetchReport,
  fetchStyleList,
  fetchStyles,
  reportTitle,
  saveMyStyle,
  type ReportJson,
  type ReportRequest,
  type StyleDef,
} from "../../src/data/reports";
import { labels } from "../../src/labels/labels";
import { useMessages } from "../../src/stores/messages";
import { stubFetch } from "./helpers/fake-fetch";

beforeEach(() => useMessages.setState(useMessages.getInitialState(), true));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const G01 = "*/Facility/THBK */Satellite/G01";

const REQUEST: ReportRequest = { style: "Access", kind: "report", objects: [G01], time: { mode: "object" }, dynamic: false };

const REPORT: ReportJson = {
  scenario: "S1",
  style: "Access",
  kind: "report",
  created_utc: "2026-11-15T00:00:00.000Z",
  sections: [{
    object: G01,
    title: "THBK-To-G01",
    columns: [
      { name: "Access", unit: null, kind: "int" },
      { name: "Start Time", unit: null, kind: "time" },
      { name: "Stop Time", unit: null, kind: "time" },
      { name: "Duration", unit: "sec", kind: "number" },
    ],
    rows: [[1, "2026-11-15T02:38:00.000Z", "2026-11-15T06:00:00.000Z", 12120.123456]],
    summary: [],
    summary_only: false,
  }],
  global_statistics: [{ name: "Min Duration", value: 12120.123456 }],
  graph: null,
  dynamic: false,
};

const ACCESS_STYLE: StyleDef = {
  name: "Mine",
  kind: "report",
  object_type: "Access",
  content: [{ provider: "Access Data", group: null, elements: ["Access Number", "Duration"] }],
  time: { mode: "object_period", step_s: null },
  summary: { per_object: [], global_statistics: [], summary_only: false },
  graph: null,
  dynamic: false,
  derive: null,
  ours: false,
};

describe("fetchReport", () => {
  test("fetchReport posts the request", async () => {
    const fake = stubFetch({ "POST /api/scenarios/S1/reports": { json: REPORT } });
    const report = await fetchReport("S1", REQUEST);
    expect(report).toEqual(REPORT);
    expect(report.sections[0].summary_only).toBe(false);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].body).toEqual({ ...REQUEST, format: "json" });
    expect(fake.calls[0].headers.get("Content-Type")).toBe("application/json");
  });

  test("scenario names are encoded and errors are ApiError", async () => {
    stubFetch({
      "POST /api/scenarios/A%20B/reports": {
        status: 409, json: { code: "RESULTS_NOT_CURRENT", text: "ผลลัพธ์ไม่ตรง", field: null, detail: null },
      },
    });
    const err = await fetchReport("A B", REQUEST).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("RESULTS_NOT_CURRENT");
    expect((err as ApiError).status).toBe(409);
  });

  test("abort passes through", async () => {
    stubFetch({ "POST /api/scenarios/S1/reports": () => new Promise(() => {}) });
    const ctl = new AbortController();
    const p = fetchReport("S1", REQUEST, ctl.signal);
    ctl.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("downloadReport", () => {
  function captureDownloads() {
    const blobs: Blob[] = [];
    const clicks: { href: string; download: string; inDocument: boolean }[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((b) => {
      blobs.push(b as Blob);
      return `blob:http://localhost/${blobs.length}`;
    });
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    // ตัวตั้งเวลาคืน URL เก็บไว้ให้ test สั่งเอง (ตัวอื่นผ่านไปที่ setTimeout จริง)
    const timers: { fn: () => void; ms: number | undefined }[] = [];
    const realSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, ms?: number, ...rest: unknown[]) => {
      if (ms === REVOKE_DELAY_MS) {
        timers.push({ fn, ms });
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }
      return realSetTimeout(fn, ms, ...rest);
    }) as typeof setTimeout);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push({ href: this.href, download: this.download, inDocument: document.body.contains(this) });
    });
    return { blobs, clicks, revoke, timers };
  }

  test("downloadReport names the file from Content-Disposition", async () => {
    const text = "S1    15 Nov 2026 00:00:00.000\n\nTHBK-To-G01:  Access\n";
    const fake = stubFetch({
      "POST /api/scenarios/S1/reports": {
        text,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": 'attachment; filename="THBK-To-G01_Access.txt"' },
      },
    });
    const dl = captureDownloads();
    await downloadReport("S1", REQUEST, "txt");
    expect(fake.calls[0].body).toEqual({ ...REQUEST, format: "txt" });
    expect(dl.clicks).toEqual([{ href: "blob:http://localhost/1", download: "THBK-To-G01_Access.txt", inDocument: true }]);
    expect(await dl.blobs[0].text()).toBe(text);
    expect(dl.blobs[0].type).toBe("text/plain;charset=utf-8");
    // URL คืนหลังราว 30 วินาที (เบราว์เซอร์อ่าน Blob หลัง click) ไม่ใช่ทันที
    expect(REVOKE_DELAY_MS).toBe(30_000);
    expect(dl.revoke).not.toHaveBeenCalled();
    expect(dl.timers).toHaveLength(1);
    dl.timers[0].fn();
    expect(dl.revoke).toHaveBeenCalledWith("blob:http://localhost/1");
    expect(document.querySelectorAll("a[download]")).toHaveLength(0);
  });

  test("csv sends the Export Setup and falls back to a file name of the style", async () => {
    const fake = stubFetch({ "POST /api/scenarios/S1/reports": { text: "a;b\n", headers: { "Content-Type": "text/csv; charset=utf-8" } } });
    const dl = captureDownloads();
    const setup = { ...DEFAULT_EXPORT_SETUP, delimiter: ";" };
    await downloadReport("S1", REQUEST, "csv", setup);
    expect(fake.calls[0].body).toEqual({ ...REQUEST, format: "csv", export: setup });
    expect(dl.clicks[0].download).toBe("Access.csv");
    expect(dl.blobs[0].type).toBe("text/csv;charset=utf-8");
  });

  test("an RFC 5987 file name is decoded and path parts are dropped", async () => {
    stubFetch({
      "POST /api/scenarios/S1/reports": {
        text: "x",
        headers: { "Content-Disposition": "attachment; filename=\"plain.txt\"; filename*=UTF-8''Az%20El%20..%2Fx.txt" },
      },
    });
    const dl = captureDownloads();
    await downloadReport("S1", REQUEST, "txt");
    expect(dl.clicks[0].download).toBe("Az El .._x.txt");
  });

  test("a failure while saving leaves no anchor and no URL behind", async () => {
    stubFetch({ "POST /api/scenarios/S1/reports": { text: "x" } });
    const dl = captureDownloads();
    vi.mocked(URL.createObjectURL).mockImplementation(() => {
      throw new Error("quota");
    });
    await expect(downloadReport("S1", REQUEST, "txt")).rejects.toThrow("quota");
    expect(document.querySelectorAll("a")).toHaveLength(0);
    expect(dl.timers).toEqual([]);
    vi.mocked(URL.createObjectURL).mockImplementation(() => "blob:http://localhost/9");
    vi.mocked(HTMLAnchorElement.prototype.click).mockImplementation(() => {
      throw new Error("blocked");
    });
    await expect(downloadReport("S1", REQUEST, "txt")).rejects.toThrow("blocked");
    expect(document.querySelectorAll("a")).toHaveLength(0);
    expect(dl.timers).toHaveLength(1);
    dl.timers[0].fn();
    expect(dl.revoke).toHaveBeenCalledWith("blob:http://localhost/9");
  });

  test("errors are ApiError and nothing is downloaded", async () => {
    stubFetch({
      "POST /api/scenarios/S1/reports": {
        status: 422, json: { code: "STYLE_INVALID", text: "style ผิด", field: "content[0].elements[1]", detail: null },
      },
    });
    const dl = captureDownloads();
    const err = await downloadReport("S1", REQUEST, "csv").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).field).toBe("content[0].elements[1]");
    expect(dl.clicks).toEqual([]);
  });
});

describe("names", () => {
  test("accessPath and accessName", () => {
    expect(accessPath("THBK", "G01")).toBe(G01);
    expect(accessName(G01)).toBe("THBK-To-G01");
    expect(accessName("*/Facility/THBK")).toBe("THBK");
    expect(accessName("*/Satellite/G01")).toBe("G01");
    expect(accessName("*/Satellite/G01 */Facility/THBK")).toBe("THBK-To-G01");
    expect(accessName("not a path")).toBe("not a path");
  });

  test("reportTitle", () => {
    expect(reportTitle([G01], "Access")).toBe("THBK-To-G01: Access");
    expect(reportTitle([G01, "*/Facility/THBK */Satellite/E11"], "Access")).toBe("Multiple Objects: Access");
    expect(reportTitle(["*/Facility/THBK"], "All DOPs")).toBe("THBK: All DOPs");
    expect(labels["window.multipleObjects"]).toEqual({ text: "Multiple Objects", source: "ours" });
  });
});

describe("styles and providers", () => {
  test("fetchStyles query object_type=Access&scenario=S1", async () => {
    const tiers = { installed: [ACCESS_STYLE], my: [], scenario: [] };
    const fake = stubFetch({ "GET /api/styles": { json: tiers } });
    expect(await fetchStyles("Access", "S1")).toEqual(tiers);
    expect(fake.calls[0].query.toString()).toBe("object_type=Access&scenario=S1");
    await fetchStyles(null, null);
    expect(fake.calls[1].query.toString()).toBe("");
  });

  test("fetchStyles drops malformed styles with one Thai warning each", async () => {
    // My Styles แก้มือได้ และ Scenario Styles อยู่ใน scenario.json: server ตรวจแค่ว่าเป็น object จึงต้องตรวจโครงที่นี่
    const lean = { name: "Lean", kind: "report", object_type: "Access", content: [{ provider: "Access Data", elements: ["Duration"] }] };
    const graphContent = [{ provider: "AER Data", group: "Default", elements: ["Time", "Elevation"] }];
    stubFetch({
      "GET /api/styles": {
        json: {
          installed: [ACCESS_STYLE],
          my: [{ name: "Half" }, lean, { ...ACCESS_STYLE, name: "BadKind", kind: "table" }],
          scenario: [
            { name: "NoGraph", kind: "graph", object_type: "Access", content: graphContent },
            { name: "Elev", kind: "graph", object_type: "Access", content: graphContent, graph: { type: "time_xy", y1: ["Elevation"] } },
            null,
            { kind: "report" },
          ],
        },
      },
    });
    const tiers = await fetchStyles("Access", "S1");
    expect(tiers.installed).toEqual([ACCESS_STYLE]);
    // style ที่ถูกต้องแต่ละช่องที่ engine ไม่บังคับ ได้ค่าตั้งต้นของ engine
    expect(tiers.my).toEqual([{
      ...ACCESS_STYLE, name: "Lean", content: [{ provider: "Access Data", group: null, elements: ["Duration"] }],
      summary: { per_object: [], global_statistics: [], summary_only: false },
    }]);
    expect(tiers.scenario).toEqual([{
      name: "Elev", kind: "graph", object_type: "Access", content: graphContent,
      time: { mode: "object_period", step_s: null }, summary: { per_object: [], global_statistics: [], summary_only: false },
      graph: { type: "time_xy", y1: ["Elevation"], y2: [] }, dynamic: false, derive: null, ours: false,
    }]);
    const warnings = useMessages.getState().items;
    expect(warnings.map((m) => [m.level, m.code])).toEqual(Array(5).fill(["warning", "STYLE_MALFORMED"]));
    for (const name of ["Half", "BadKind", "NoGraph"]) {
      expect(warnings.filter((m) => m.text.includes(`"${name}"`)), name).toHaveLength(1);
    }
    expect(warnings.every((m) => /[\u0E00-\u0E7F]/.test(m.text))).toBe(true);
    expect(warnings.filter((m) => m.text.includes("My Styles"))).toHaveLength(2);
    expect(warnings.filter((m) => m.text.includes("Scenario Styles"))).toHaveLength(3);
  });

  test("fetchStyleList keeps incomplete styles as unusable with the first bad field, without Message Viewer warnings", async () => {
    // ไฟล์ใน data/styles ที่มีแต่ชื่อ (ไม่มี kind / content) server ส่งมาตามตัว: Report & Graph Manager แสดงเป็นรายการที่ใช้ไม่ได้
    stubFetch({ "GET /api/styles": { json: { installed: [ACCESS_STYLE], my: [{ name: "Half" }, { kind: "report" }], scenario: [{ ...ACCESS_STYLE, name: "Mine", content: [] }] } } });
    const { tiers, unusable } = await fetchStyleList(null, "S1");
    expect(tiers).toEqual({ installed: [ACCESS_STYLE], my: [], scenario: [] });
    expect(unusable).toEqual([
      { tier: "my", name: "Half", field: "kind" },
      { tier: "my", name: null, field: "name" },
      { tier: "scenario", name: "Mine", field: "content" },
    ]);
    expect(useMessages.getState().items).toEqual([]);
  });

  test.each([
    ["no kind", { kind: undefined }],
    ["unknown object type", { object_type: "Constellation" }],
    ["object type not a string", { object_type: 3 }],
    ["empty content", { content: [] }],
    ["content not an array", { content: { provider: "Access Data" } }],
    ["content entry not an object", { content: ["Access Data"] }],
    ["provider not a string", { content: [{ provider: 1, group: null, elements: ["Duration"] }] }],
    ["group a number", { content: [{ provider: "Access Data", group: 2, elements: ["Duration"] }] }],
    ["elements not strings", { content: [{ provider: "Access Data", group: null, elements: ["Duration", 4] }] }],
    ["elements missing", { content: [{ provider: "Access Data", group: null }] }],
    ["time not an object", { time: "object_period" }],
    ["time mode unknown", { time: { mode: "later", step_s: null } }],
    ["summary not an object", { summary: [] }],
    ["summary lists not strings", { summary: { per_object: [1], global_statistics: [], summary_only: false } }],
    ["report with a graph", { graph: { type: "time_xy", y1: ["Duration"], y2: [] } }],
    ["graph style without a graph", { kind: "graph", graph: null }],
    ["graph type unknown", { kind: "graph", graph: { type: "pie", y1: [], y2: [] } }],
    ["dynamic not a boolean", { dynamic: "yes" }],
    ["derive unknown", { derive: "holes" }],
    ["empty name", { name: "" }],
  ])("a style with %s is dropped", async (_case, patch) => {
    stubFetch({ "GET /api/styles": { json: { installed: [], my: [{ ...ACCESS_STYLE, ...patch }], scenario: [] } } });
    expect((await fetchStyles(null, null)).my).toEqual([]);
    expect(useMessages.getState().items.map((m) => m.code)).toEqual(["STYLE_MALFORMED"]);
  });

  test("saveMyStyle puts and deleteMyStyle deletes by encoded name", async () => {
    const fake = stubFetch({
      "PUT /api/styles/Az%20El%20Mine": { json: { ...ACCESS_STYLE, name: "Az El Mine" } },
      "DELETE /api/styles/Az%20El%20Mine": { status: 204 },
    });
    await saveMyStyle({ ...ACCESS_STYLE, name: "Az El Mine" });
    await deleteMyStyle("Az El Mine");
    expect(fake.calls.map((c) => c.method)).toEqual(["PUT", "DELETE"]);
    expect(fake.calls[0].body).toEqual({ ...ACCESS_STYLE, name: "Az El Mine" });
  });

  test("fetchProviders asks by class and name", async () => {
    const providers = [{
      name: "AER Data", groups: ["Default"], uses: ["Reports", "Dynamic Displays"], ours: false,
      elements: [{ name: "Azimuth", unit: "deg", kind: "number", interp: "angle" }],
    }];
    const fake = stubFetch({ "GET /api/scenarios/S1/dataproviders": { json: providers } });
    expect(await fetchProviders("S1", "Access", G01)).toEqual(providers);
    expect(fake.calls[0].query.get("class")).toBe("Access");
    expect(fake.calls[0].query.get("name")).toBe(G01);
    await fetchProviders("S1", "Access", null);
    expect(fake.calls[1].query.has("name")).toBe(false);
  });
});

describe("decimals (P9)", () => {
  test("decimalsOf follows report_format.DECIMALS", () => {
    expect(decimalsOf("Azimuth")).toBe(3);
    expect(decimalsOf("IPP Lat")).toBe(4);
    expect(decimalsOf("MF")).toBe(5);
    expect(decimalsOf("Alt Rate")).toBe(6);
    expect(DEFAULT_DECIMALS).toBe(3);
  });

  test("DECIMALS mirrors the engine table", () => {
    const py = readFileSync(resolve(import.meta.dirname, "../../../gnss_predict/report_format.py"), "utf8");
    const dict = /^DECIMALS = \{([^}]*)\}/m.exec(py)?.[1];
    expect(dict).toBeDefined();
    const engine = Object.fromEntries([...(dict as string).matchAll(/"([^"]+)":\s*(\d+)/g)].map((m) => [m[1], Number(m[2])]));
    expect(DECIMALS).toEqual(engine);
    expect(Number(/^DEFAULT_DECIMALS = (\d+)/m.exec(py)?.[1])).toBe(DEFAULT_DECIMALS);
  });
});
