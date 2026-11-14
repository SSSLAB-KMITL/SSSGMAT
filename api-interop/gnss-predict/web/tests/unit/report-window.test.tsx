// หน้าต่างรายงาน (src/windows/Report): ตารางแบบ virtual, เวลาตาม DateFormat, Refresh/F5, Export ▸ To CSV Format... กับ Setup...,
// Set Animation Time จากช่องเวลา, Dynamic Display, แถบเตือนผลลัพธ์ไม่ตรง (409) กับ Refresh ที่สั่งคำนวณใหม่, style ผิด (422) และป้ายชื่อ

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { installTestHooks } from "../../src/cesium/testHooks";
import type { ReportJson } from "../../src/data/reports";
import { labels, t } from "../../src/labels/labels";
import { msg } from "../../src/labels/messages.th";
import { getPanelDef } from "../../src/layout/panels";
import { useJobs } from "../../src/stores/jobs";
import { useLayout } from "../../src/stores/layout";
import { useMessages } from "../../src/stores/messages";
import { useTime } from "../../src/stores/time";
import { formatTime } from "../../src/time/format";
import { openReport, Report, registerReportPanel, type ReportParams } from "../../src/windows/Report/Report";
import { flattenRows } from "../../src/windows/Report/table";
import { makeDoc, openScenario, resetAll } from "./helpers/chrome";
import { stubFetch, type Call, type Handler } from "./helpers/fake-fetch";

const T0 = Date.UTC(2026, 10, 12);
const iso = (ms: number) => new Date(ms).toISOString();
const HOUR = 3_600_000;
const G01 = "*/Facility/THBK */Satellite/G01";
const E11 = "*/Facility/THBK */Satellite/E11";
const REPORTS = "POST /api/scenarios/S1/reports";
const COMPUTE = "POST /api/scenarios/S1/access/compute";
const PROVIDERS = "GET /api/scenarios/S1/dataproviders";

const ACCESS_COLUMNS = [
  { name: "Access", unit: null, kind: "int" as const },
  { name: "Start Time", unit: null, kind: "time" as const },
  { name: "Stop Time", unit: null, kind: "time" as const },
  { name: "Duration", unit: "sec", kind: "number" as const },
];

function accessReport(): ReportJson {
  return {
    scenario: "S1", style: "Access", kind: "report", created_utc: iso(T0), graph: null, dynamic: false,
    sections: [
      {
        object: G01, title: "THBK-To-G01", columns: ACCESS_COLUMNS, summary: [], summary_only: false,
        rows: [
          [1, iso(T0 + 6 * HOUR), iso(T0 + 8 * HOUR), 7200],
          [2, iso(T0 + 14 * HOUR), iso(T0 + 15 * HOUR), 3600.25],
        ],
      },
      { object: E11, title: "THBK-To-E11", columns: ACCESS_COLUMNS, summary: [], summary_only: false, rows: [[1, iso(T0 + 10 * HOUR), iso(T0 + 11 * HOUR), 3600]] },
    ],
    global_statistics: [
      { name: "Min Duration", value: 3600 },
      { name: "Total Duration", value: 14400.25 },
      { name: "Number of Accesses", value: 3 },
    ],
  };
}

function aerReport(rows: (string | number | null)[][]): ReportJson {
  return {
    scenario: "S1", style: "AER", kind: "report", created_utc: iso(T0), graph: null, dynamic: true, global_statistics: [],
    sections: [{
      object: G01, title: "THBK-To-G01", summary: [], summary_only: false, rows,
      columns: [
        { name: "Time", unit: null, kind: "time" },
        { name: "Azimuth", unit: "deg", kind: "number" },
        { name: "Elevation", unit: "deg", kind: "number" },
        { name: "Range", unit: "km", kind: "number" },
      ],
    }],
  };
}

const AER_PROVIDERS = [{
  name: "AER Data", groups: ["Default"], ours: false, uses: ["Reports", "Dynamic Displays"],
  elements: [
    { name: "Time", unit: null, kind: "time", interp: "none" },
    { name: "Azimuth", unit: "deg", kind: "number", interp: "angle" },
    { name: "Elevation", unit: "deg", kind: "number", interp: "linear" },
    { name: "Range", unit: "km", kind: "number", interp: "linear" },
  ],
}];

const PARAMS: ReportParams = { style: "Access", kind: "report", objects: [G01, E11], time: { mode: "object" }, dynamic: false };

function scenario(over: object = {}) {
  return openScenario(makeDoc({
    name: "S1",
    objects: [
      { class: "Facility", name: "THBK", position: { type: "Geodetic", lat_deg: 13.7, lon_deg: 100.5, alt_m: 0 } },
      { class: "Constellation", name: "GPS", system: "G", assigned_objects: ["*/Satellite/G01"] },
      { class: "Satellite", name: "G01", norad: 40101 },
      { class: "Satellite", name: "E11", norad: 40102 },
    ] as never,
    accesses: [
      { from: "*/Facility/THBK", to: ["*/Constellation/GPS"], timeline: true, computed: true, time_period: { mode: "object" } },
    ] as never,
    ...over,
  }));
}

let user: ReturnType<typeof userEvent.setup>;

beforeEach(() => {
  resetAll();
  user = userEvent.setup();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete window.__gnssStudioTest;
});

function mount(params: ReportParams = PARAMS, panelId = "report") {
  return render(<Report panelId={panelId} params={params} />);
}

const rowTexts = (container: HTMLElement) =>
  [...container.querySelectorAll("tbody tr:not(.rpt-spacer)")].map((tr) => [...tr.querySelectorAll("td, th")].map((c) => c.textContent ?? "")).filter((r) => r.length > 0);

describe("report table", () => {
  test("renders sections and global statistics", async () => {
    scenario();
    stubFetch({ [REPORTS]: { json: accessReport() } });
    const { container } = mount();
    await screen.findByText("THBK-To-G01");
    expect(screen.getByText("THBK-To-E11")).toBeTruthy();
    expect(screen.getAllByText("Start Time (UTCG)").length).toBe(2);
    expect(screen.getAllByText("Duration (sec)").length).toBe(2);
    const rows = rowTexts(container);
    expect(rows).toContainEqual(["1", formatTime(new Date(T0 + 6 * HOUR), "UTCG", "+07:00"), formatTime(new Date(T0 + 8 * HOUR), "UTCG", "+07:00"), "7200.000"]);
    expect(rows).toContainEqual(["2", formatTime(new Date(T0 + 14 * HOUR), "UTCG", "+07:00"), formatTime(new Date(T0 + 15 * HOUR), "UTCG", "+07:00"), "3600.250"]);
    // บล็อก Global Statistics อยู่ท้ายตาราง: ชื่อสถิติกับค่า (จำนวนเต็มไม่มีทศนิยม)
    const gs = rows.findIndex((r) => r[0] === t("report.globalStatistics"));
    expect(gs).toBeGreaterThan(rows.findIndex((r) => r[0] === "THBK-To-E11"));
    expect(rows.slice(gs + 1)).toEqual([["Min Duration", "3600.000"], ["Total Duration", "14400.250"], ["Number of Accesses", "3"]]);
  });

  test("scrolls 200000 rows virtually", async () => {
    scenario();
    const rows = Array.from({ length: 200_000 }, (_, i) => [iso(T0 + i * 1000), 10, 20, 1000] as (string | number)[]);
    stubFetch({ [REPORTS]: { json: aerReport(rows) } });
    installTestHooks();
    const { container } = mount({ ...PARAMS, style: "AER", objects: [G01] });
    await screen.findByText("THBK-To-G01");
    expect(container.querySelectorAll("tr").length).toBeLessThanOrEqual(200);
    // test hook เห็นทุกแถว ไม่ขึ้นกับการเลื่อน: หัวส่วน + หัวคอลัมน์ + 200000 แถว
    const all = window.__gnssStudioTest!.reportRows("report");
    expect(all.length).toBe(200_002);
    expect(all[2]).toEqual([formatTime(new Date(T0), "UTCG", "+07:00"), "10.000", "20.000", "1000.000"]);
  }, 30_000);

  test("times follow the scenario DateFormat", async () => {
    scenario({ units: { date_format: "LTZG", ltz_offset: "+07:00" } });
    stubFetch({ [REPORTS]: { json: accessReport() } });
    const { container } = mount();
    await screen.findByText("THBK-To-G01");
    expect(screen.getAllByText("Start Time (LTZG+07:00)").length).toBe(2);
    const first = rowTexts(container).find((r) => r[0] === "1")!;
    expect(first[1]).toBe("12 Nov 2026 13:00:00.000 LTZG+07:00");
    expect(first[1].endsWith("LTZG+07:00")).toBe(true);
  });

  test("an empty section shows its header and No Data, a summary-only section has no table", () => {
    const report = accessReport();
    report.sections[1].rows = [];
    report.sections.push({ object: "*/Facility/THBK */Satellite/G02", title: "THBK-To-G02", columns: ACCESS_COLUMNS, rows: [], summary: [{ name: "Total Duration", value: null }], summary_only: true });
    const flat = flattenRows(report, "UTCG", "+07:00");
    const e11 = flat.filter((r) => r.section === 1);
    expect(e11.map((r) => r.kind)).toEqual(["title", "header", "nodata"]);
    expect(e11[2].cells).toEqual([t("report.noData")]);
    const g02 = flat.filter((r) => r.section === 2);
    expect(g02.map((r) => r.kind)).toEqual(["title", "summary"]);
    expect(g02[1].cells).toEqual(["Total Duration", t("report.notAvailable")]);
    expect(flat.filter((r) => r.section === -1).map((r) => r.kind)).toEqual(["title", "global", "global", "global"]);
  });
});

describe("toolbar", () => {
  test("refresh button and F5 reload", async () => {
    scenario();
    const f = stubFetch({ [REPORTS]: { json: accessReport() } });
    const { container } = mount();
    await screen.findByText("THBK-To-G01");
    expect(f.count(REPORTS)).toBe(1);
    await user.click(screen.getByRole("button", { name: t("report.refresh") }));
    await waitFor(() => expect(f.count(REPORTS)).toBe(2));
    fireEvent.keyDown(container.querySelector(".rpt")!, { key: "F5" });
    await waitFor(() => expect(f.count(REPORTS)).toBe(3));
    fireEvent.keyDown(document.body, { key: "F5" });
    await new Promise((r) => setTimeout(r, 20));
    expect(f.count(REPORTS)).toBe(3);
  });

  test("export to csv uses the setup", async () => {
    scenario();
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:http://localhost/1");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const f = stubFetch({
      [REPORTS]: (call: Call) => ((call.body as { format: string }).format === "csv"
        ? { text: "Access;Start Time (UTCG)\n", headers: { "Content-Disposition": 'attachment; filename="Access.csv"' } }
        : { json: accessReport() }),
    });
    mount();
    await screen.findByText("THBK-To-G01");

    await user.click(screen.getByRole("menuitem", { name: t("report.export") }));
    await user.click(await screen.findByRole("menuitem", { name: t("report.setup") }));
    const dialog = await screen.findByRole("dialog");
    const delimiter = within(dialog).getByLabelText(t("report.fieldDelimiter"));
    expect((delimiter as HTMLInputElement).value).toBe(",");
    await user.clear(delimiter);
    await user.type(delimiter, ";");
    await user.click(within(dialog).getByLabelText(t("report.encloseHeaderFields")));
    await user.click(within(dialog).getByRole("button", { name: t("dialog.ok") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await user.click(screen.getByRole("menuitem", { name: t("report.export") }));
    await user.click(await screen.findByRole("menuitem", { name: t("report.toCsvFormat") }));
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    const csv = f.calls.filter((c) => `${c.method} ${c.path}` === REPORTS).at(-1)!.body as Record<string, unknown>;
    expect(csv.format).toBe("csv");
    expect(csv.export).toEqual({ delimiter: ";", quote_headers: true, title: false, headers: true });
    expect(csv.style).toBe("Access");
    expect(csv.objects).toEqual([G01, E11]);
    // ตั้งค่าเก็บกับหน้าต่าง (workbook)
    expect(useLayout.getState().windowProps.report).toEqual({ exportSetup: { delimiter: ";", quote_headers: true, title: false, headers: true } });
  });

  test("the setup refuses a delimiter that is not one character", async () => {
    scenario();
    stubFetch({ [REPORTS]: { json: accessReport() } });
    mount();
    await screen.findByText("THBK-To-G01");
    await user.click(screen.getByRole("menuitem", { name: t("report.export") }));
    await user.click(await screen.findByRole("menuitem", { name: t("report.setup") }));
    const dialog = await screen.findByRole("dialog");
    const delimiter = within(dialog).getByLabelText(t("report.fieldDelimiter"));
    await user.clear(delimiter);
    await user.click(within(dialog).getByRole("button", { name: t("dialog.ok") }));
    expect(within(dialog).getByRole("alert").textContent).toBe(msg("report.delimiterInvalid"));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});

describe("time", () => {
  test("set animation time from a time cell", async () => {
    scenario();
    stubFetch({ [REPORTS]: { json: accessReport() } });
    mount();
    await screen.findByText("THBK-To-G01");
    const cell = screen.getByText(formatTime(new Date(T0 + 14 * HOUR), "UTCG", "+07:00"));
    fireEvent.contextMenu(cell);
    await screen.findByRole("menu");
    await user.click(screen.getByRole("menuitem", { name: t("report.setAnimationTime") }));
    expect(useTime.getState().current.getTime()).toBe(T0 + 14 * HOUR);
  });

  test("a cell that is not a time has no menu", async () => {
    scenario();
    stubFetch({ [REPORTS]: { json: accessReport() } });
    mount();
    await screen.findByText("THBK-To-G01");
    fireEvent.contextMenu(screen.getByText("7200.000"));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  test("report does not follow animation time", async () => {
    scenario();
    const f = stubFetch({ [REPORTS]: { json: accessReport() } });
    const { container } = mount();
    await screen.findByText("THBK-To-G01");
    const before = rowTexts(container);
    act(() => useTime.getState().setCurrent(new Date(T0 + 7 * HOUR)));
    act(() => useTime.getState().stepForward());
    await new Promise((r) => setTimeout(r, 150));
    expect(f.count(REPORTS)).toBe(1);
    expect(rowTexts(container)).toEqual(before);
  });

  test("dynamic display shows the row at the current time", async () => {
    scenario();
    const f = stubFetch({
      [REPORTS]: { json: aerReport([[iso(T0), 350, 20, 1000], [iso(T0 + 30_000), 10, 40, 2000], [iso(T0 + 60_000), 20, 50, 2500]]) },
      [PROVIDERS]: { json: AER_PROVIDERS },
    });
    installTestHooks();
    const { container } = mount({ style: "AER", kind: "report", objects: [G01], time: { mode: "object" }, dynamic: true });
    act(() => useTime.getState().setCurrent(new Date(T0 + 15_000)));
    // กลางสองจุด: Elevation และ Range ประมาณเชิงเส้น Azimuth ข้ามทิศเหนือ (350 → 10) ได้ 0
    const fmt = (ms: number) => formatTime(new Date(ms), "UTCG", "+07:00");
    await waitFor(() => expect(rowTexts(container).filter((r) => r.length === 4 && r[0] !== "Time (UTCG)")).toEqual([[fmt(T0 + 15_000), "0.000", "30.000", "1500.000"]]));
    expect(f.calls.find((c) => `${c.method} ${c.path}` === REPORTS)!.body).toMatchObject({ dynamic: true });

    for (const ms of [T0 + 30_000, T0 + 45_000, T0 + 52_500]) {
      act(() => useTime.getState().setCurrent(new Date(ms)));
      await new Promise((r) => setTimeout(r, 120));
    }
    await waitFor(() => expect(window.__gnssStudioTest!.reportRows("report").at(-1)).toEqual([fmt(T0 + 52_500), "17.500", "47.500", "2375.000"]));
    expect(f.count(REPORTS)).toBe(1);

    // นอกช่วงข้อมูล: No Data
    act(() => useTime.getState().setCurrent(new Date(T0 + 2 * HOUR)));
    await waitFor(() => expect(window.__gnssStudioTest!.reportRows("report").at(-1)).toEqual([t("report.noData")]));
    expect(f.count(REPORTS)).toBe(1);
  });
});

describe("errors", () => {
  test("stale results show the banner and Refresh computes", async () => {
    scenario();
    let reports = 0;
    const handler: Handler = () => (++reports === 1
      ? { status: 409, json: { code: "RESULTS_NOT_CURRENT", text: "ผลลัพธ์ของ THBK ไม่ตรงกับ scenario", field: null, detail: null } }
      : { json: accessReport() });
    const f = stubFetch({ [REPORTS]: handler, [COMPUTE]: { status: 202, json: { job: "j-1", etag: "e2" }, headers: { ETag: '"e2"' } } });
    mount({ ...PARAMS, objects: [G01] });
    const banner = await screen.findByRole("status");
    expect(banner.textContent).toContain(msg("banner.stale"));

    await user.click(screen.getByRole("button", { name: t("report.refresh") }));
    await waitFor(() => expect(f.count(COMPUTE)).toBe(1));
    const compute = f.calls.find((c) => `${c.method} ${c.path}` === COMPUTE)!;
    expect(compute.headers.get("If-Match")).toBe('"e1"');
    // access ที่มีอยู่แล้วซึ่งครอบ G01 (THBK → GPS) ไม่สร้างรายการใหม่
    expect(compute.body).toEqual({ from: "*/Facility/THBK", to: ["*/Constellation/GPS"] });
    expect(useJobs.getState().jobs["j-1"]?.state).toBe("queued");
    expect(f.count(REPORTS)).toBe(1);

    act(() => useJobs.getState().onJobEvent({ id: "j-1", kind: "analyze", scenario: "S1", state: "running", progress: null }));
    act(() => useJobs.getState().onJobEvent({ id: "j-1", kind: "analyze", scenario: "S1", state: "succeeded", progress: null }));
    await screen.findByText("THBK-To-G01");
    expect(f.count(REPORTS)).toBe(2);
    expect(screen.queryByRole("status")).toBeNull();
  });

  test("a failed compute job leaves the banner and says so", async () => {
    scenario();
    const f = stubFetch({
      [REPORTS]: { status: 409, json: { code: "RESULTS_NOT_CURRENT", text: "x", field: null, detail: null } },
      [COMPUTE]: { status: 202, json: { job: "j-2", etag: "e2" } },
    });
    mount({ ...PARAMS, objects: [G01] });
    await screen.findByRole("status");
    await user.click(screen.getByRole("button", { name: t("report.refresh") }));
    await waitFor(() => expect(f.count(COMPUTE)).toBe(1));
    act(() => useJobs.getState().onJobEvent({ id: "j-2", kind: "analyze", scenario: "S1", state: "failed", progress: null }));
    await waitFor(() => expect(useMessages.getState().items.map((m) => m.text)).toContain(msg("report.computeJobFailed")));
    expect(f.count(REPORTS)).toBe(1);
    expect(screen.getByRole("status")).toBeTruthy();
  });

  test("style error goes to the Message Viewer", async () => {
    scenario();
    stubFetch({ [REPORTS]: { status: 422, json: { code: "STYLE_INVALID", text: "element 'Foo' ไม่มีใน AER Data", field: "content[0].elements[1]", detail: null } } });
    const { container } = mount({ ...PARAMS, style: "Mine" });
    await screen.findByText(msg("report.styleInvalid"));
    const item = useMessages.getState().items.find((m) => m.code === "STYLE_INVALID");
    expect(item?.text).toContain("element 'Foo'");
    expect(container.querySelectorAll("tbody tr td").length).toBe(0);
  });
});

describe("panel", () => {
  test("the report panel kind is an integrated, persisted, scenario-bound window named after the objects and the style", () => {
    registerReportPanel();
    const def = getPanelDef("report")!;
    expect(def.component).toBe(Report);
    expect(def.type).toBe("integrated");
    expect(def.persist).toBe(true);
    expect(def.scenarioBound).toBe(true);
    expect(def.title({ ...PARAMS, objects: [G01] })).toBe("THBK-To-G01: Access");
    expect(def.title(PARAMS)).toBe("Multiple Objects: Access");
    expect(def.instanceKey!(PARAMS)).toBe(JSON.stringify(["Access", "report", [G01, E11], { mode: "object" }, false]));
    expect(def.instanceKey!({ ...PARAMS, dynamic: true })).not.toBe(def.instanceKey!(PARAMS));
  });

  test("openReport opens the report window with the params", () => {
    const open = vi.spyOn(useLayout.getState(), "openPanel").mockImplementation(() => "report");
    useLayout.setState({ openPanel: open });
    openReport(PARAMS);
    expect(open).toHaveBeenCalledWith("report", PARAMS);
  });
});

test("labels", () => {
  expect(t("report.toCsvFormat")).toBe("To CSV Format...");
  expect(labels["report.toCsvFormat"].source).toBe("ours");
  expect(t("report.setAnimationTime")).toBe("Set Animation Time");
  expect(labels["report.setAnimationTime"]).toEqual({ text: "Set Animation Time", source: "stk", ref: "STK ref §F" });
  expect(labels["report.refresh"]).toEqual({ text: "Refresh", source: "stk", ref: "STK ref §F" });
  expect(labels["report.globalStatistics"]).toEqual({ text: "Global Statistics", source: "stk", ref: "STK ref §F" });
  for (const k of ["report.export", "report.setup", "report.noData", "report.fieldDelimiter", "report.encloseHeaderFields", "report.writeReportTitle", "report.headers", "window.report"] as const)
    expect(labels[k].source, k).toBe("ours");
});
