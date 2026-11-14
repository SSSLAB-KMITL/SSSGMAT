// ชั้นข้อมูลของรายงานและกราฟ (spec §5, §6; server POST /reports, GET /styles, /dataproviders)

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ApiError } from "../../src/api/client";
import {
  DECIMALS,
  DEFAULT_DECIMALS,
  DEFAULT_EXPORT_SETUP,
  accessName,
  accessPath,
  decimalsOf,
  deleteMyStyle,
  downloadReport,
  fetchProviders,
  fetchReport,
  fetchStyles,
  reportTitle,
  saveMyStyle,
  type ReportJson,
  type ReportRequest,
  type StyleDef,
} from "../../src/data/reports";
import { labels } from "../../src/labels/labels";
import { stubFetch } from "./helpers/fake-fetch";

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
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push({ href: this.href, download: this.download, inDocument: document.body.contains(this) });
    });
    return { blobs, clicks, revoke };
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
    await new Promise((r) => setTimeout(r, 0)); // URL คืนในรอบถัดไป (ให้เบราว์เซอร์เริ่มดาวน์โหลดก่อน)
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

  test("fetchStyles drops entries that are not named objects", async () => {
    stubFetch({ "GET /api/styles": { json: { installed: [ACCESS_STYLE, null, 3, { kind: "report" }], my: [{ name: "Half" }], scenario: [] } } });
    const tiers = await fetchStyles("Access", null);
    expect(tiers.installed).toEqual([ACCESS_STYLE]);
    expect(tiers.my).toEqual([{ name: "Half" }]);
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
