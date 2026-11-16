// หน้าต่างรายงาน (src/windows/Report): ตารางแบบ virtual, เวลาตาม DateFormat, Refresh/F5, Export ▸ To Excel or CSV Format กับ Setup...,
// Set Animation Time จากช่องเวลา, Dynamic Display, แถบเตือนผลลัพธ์ไม่ตรง (409) กับ Refresh ที่สั่งคำนวณใหม่, style ผิด (422) และป้ายชื่อ

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { installTestHooks } from "../../src/cesium/testHooks";
import { confirm } from "../../src/chrome/Dialogs";
import type { ReportJson } from "../../src/data/reports";
import { labels, STK_HELP_REF, t } from "../../src/labels/labels";
import { msg } from "../../src/labels/messages.th";
import { getPanelDef } from "../../src/layout/panels";
import { useJobs } from "../../src/stores/jobs";
import { useLayout } from "../../src/stores/layout";
import { useMessages } from "../../src/stores/messages";
import { useResults, type ResultsInfo } from "../../src/stores/results";
import { useScenario } from "../../src/stores/scenario";
import { useTime } from "../../src/stores/time";
import { formatTime } from "../../src/time/format";
import { openReport, primeReport, PRIMED_TTL_MS, recomputePlan, Report, registerReportPanel, requestOf, type ReportParams } from "../../src/windows/Report/Report";
import { columnWidths, dynamicRows, flattenRows, prepareDynamic } from "../../src/windows/Report/table";
import { makeDoc, openScenario, resetAll } from "./helpers/chrome";
import { deferred, stubFetch, type Call, type Handler } from "./helpers/fake-fetch";

// กล่องยืนยันของแอป: test ตอบเองแทนการคลิกใน <Dialogs/>
vi.mock("../../src/chrome/Dialogs", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../src/chrome/Dialogs")>()), confirm: vi.fn() }));

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
  vi.mocked(confirm).mockReset();
  user = userEvent.setup();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete window.__gnssStudioTest;
});

/** ฝากผลไว้โดยไม่มีหน้าต่างใดรับ (จำลองผลที่ฝากไว้ก่อนเปิดหน้าต่าง แล้วหน้าต่างไม่ได้เปิด) ใช้ etag ปัจจุบันของ store */
function primeReportUnheard() {
  primeReport("S1", requestOf(PARAMS), accessReport(), { deliver: false });
}

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

  test("uses the report the Report & Graph Manager just made once; the next window asks the server", async () => {
    scenario();
    const f = stubFetch({ [REPORTS]: { json: accessReport() } });
    primeReport("S1", requestOf(PARAMS), accessReport());
    const { container } = mount();
    await screen.findByText("THBK-To-G01");
    expect(f.count(REPORTS)).toBe(0);
    expect(rowTexts(container).length).toBeGreaterThan(0);
    // ใช้ได้ครั้งเดียว: บานใหม่ของคำขอเดียวกันสร้างเอง
    cleanup();
    mount();
    await screen.findByText("THBK-To-G01");
    expect(f.count(REPORTS)).toBe(1);
  });

  test("a primed report of another request or an old one is not used", async () => {
    scenario();
    const f = stubFetch({ [REPORTS]: { json: accessReport() } });
    primeReport("S1", requestOf({ ...PARAMS, objects: [G01] }), accessReport());
    mount();
    await screen.findByText("THBK-To-G01");
    expect(f.count(REPORTS)).toBe(1);
    cleanup();
    const now = vi.spyOn(Date, "now");
    now.mockReturnValue(T0);
    primeReport("S1", requestOf(PARAMS), accessReport());
    now.mockReturnValue(T0 + PRIMED_TTL_MS + 1);
    mount();
    await screen.findByText("THBK-To-G01");
    expect(f.count(REPORTS)).toBe(2);
  });

  // ---------- fix round 1: primeReport ----------

  test("in StrictMode the primed report is still used once: no POST at all", async () => {
    scenario();
    const f = stubFetch({ [REPORTS]: { json: accessReport() } });
    primeReport("S1", requestOf(PARAMS), accessReport());
    render(<StrictMode><Report panelId="report" params={PARAMS} /></StrictMode>);
    await screen.findByText("THBK-To-G01");
    expect(f.count(REPORTS)).toBe(0);
  });

  test("Generate on an already-open window updates it with the new result", async () => {
    scenario();
    const f = stubFetch({ [REPORTS]: { json: accessReport() } });
    const { container } = mount();
    await screen.findByText("THBK-To-G01");
    expect(f.count(REPORTS)).toBe(1);
    const fresh = accessReport();
    fresh.sections[0].rows = [[9, iso(T0 + 20 * HOUR), iso(T0 + 21 * HOUR), 1234.5]];
    act(() => primeReport("S1", requestOf(PARAMS), fresh));
    await waitFor(() => expect(rowTexts(container)).toContainEqual(["9", formatTime(new Date(T0 + 20 * HOUR), "UTCG", "+07:00"), formatTime(new Date(T0 + 21 * HOUR), "UTCG", "+07:00"), "1234.500"]));
    expect(f.count(REPORTS)).toBe(1);
    // ส่งให้หน้าต่างแล้ว ไม่ค้างในช่องฝาก: Refresh ถาม server
    await user.click(screen.getByRole("button", { name: t("report.refresh") }));
    await waitFor(() => expect(f.count(REPORTS)).toBe(2));
  });

  test("Refresh after the first load never takes a primed result", async () => {
    scenario();
    const f = stubFetch({ [REPORTS]: { json: accessReport() } });
    primeReport("S1", requestOf(PARAMS), accessReport());
    mount();
    await screen.findByText("THBK-To-G01");
    expect(f.count(REPORTS)).toBe(0);
    // ช่องฝากของคำขอเดียวกันที่ไม่มีหน้าต่างรับ (เช่นจาก scenario ก่อนแก้) ไม่ถูกหยิบตอน Refresh
    act(() => useScenario.setState({ etag: '"e9"' }));
    primeReportUnheard();
    await user.click(screen.getByRole("button", { name: t("report.refresh") }));
    await waitFor(() => expect(f.count(REPORTS)).toBe(1));
  });

  test("a recompute after the first load does not take a primed result either", async () => {
    scenario();
    let reports = 0;
    const f = stubFetch({
      [REPORTS]: () => (++reports === 1 ? { status: 409, json: { code: "RESULTS_NOT_CURRENT", text: "x", field: null, detail: null } } : { json: accessReport() }),
      [COMPUTE]: { status: 202, json: { job: "j-p", etag: "e2" }, headers: { ETag: '"e2"' } },
    });
    mount({ ...PARAMS, objects: [G01] });
    await screen.findByRole("status");
    await user.click(screen.getByRole("button", { name: t("report.refresh") }));
    await waitFor(() => expect(f.count(COMPUTE)).toBe(1));
    // ระหว่างคำนวณมีผลของคำขอเดียวกันค้างในช่องฝาก (ไม่มีหน้าต่างรับ): การสร้างใหม่หลังคำนวณต้อง POST เอง
    primeReport("S1", requestOf({ ...PARAMS, objects: [G01] }), accessReport(), { deliver: false });
    act(() => useJobs.getState().onJobEvent({ id: "j-p", kind: "analyze", scenario: "S1", state: "succeeded", progress: null }));
    await screen.findByText("THBK-To-G01");
    expect(f.count(REPORTS)).toBe(2);
  });

  test("an interrupted Dynamic Display load does not reuse the primed result", async () => {
    scenario();
    const dyn: ReportParams = { ...PARAMS, style: "AER", objects: [G01], dynamic: true };
    const providers = deferred<{ json: unknown }>();
    const f = stubFetch({ [REPORTS]: { json: aerReport([[iso(T0), 10, 20, 1000]]) }, [PROVIDERS]: () => providers.promise });
    primeReport("S1", requestOf(dyn), aerReport([[iso(T0), 10, 20, 1000]]));
    mount(dyn);
    await waitFor(() => expect(f.count(PROVIDERS)).toBe(1)); // prep รอวิธีประมาณค่าอยู่
    expect(f.count(REPORTS)).toBe(0);
    // Refresh ระหว่าง prep: การโหลดครั้งแรกถูกยกเลิก ผลที่ฝากไว้ต้องไม่ถูกใช้ซ้ำ
    await user.click(screen.getByRole("button", { name: t("report.refresh") }));
    await waitFor(() => expect(f.count(REPORTS)).toBe(1));
    providers.resolve({ json: AER_PROVIDERS });
    await screen.findByText("THBK-To-G01");
  });

  test("a result primed before a scenario edit is not served after it", async () => {
    scenario();
    const f = stubFetch({ [REPORTS]: { json: accessReport() } });
    primeReport("S1", requestOf(PARAMS), accessReport());
    act(() => useScenario.setState({ etag: '"e2"' }));
    mount();
    await screen.findByText("THBK-To-G01");
    expect(f.count(REPORTS)).toBe(1);
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
    await user.click(await screen.findByRole("menuitem", { name: t("report.toExcelOrCsvFormat") }));
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
  // help.agi.com: "Select Export > To Excel or CSV Format" (ผลตรวจคำ 2026-11-15)
  expect(labels["report.export"]).toEqual({ text: "Export", source: "stk", ref: STK_HELP_REF });
  expect(labels["report.toExcelOrCsvFormat"]).toEqual({ text: "To Excel or CSV Format", source: "stk", ref: STK_HELP_REF });
  expect(t("report.setAnimationTime")).toBe("Set Animation Time");
  expect(labels["report.setAnimationTime"]).toEqual({ text: "Set Animation Time", source: "stk", ref: "STK ref §F" });
  expect(labels["report.refresh"]).toEqual({ text: "Refresh", source: "stk", ref: "STK ref §F" });
  expect(labels["report.globalStatistics"]).toEqual({ text: "Global Statistics", source: "stk", ref: "STK ref §F" });
  for (const k of ["report.setup", "report.noData", "report.fieldDelimiter", "report.encloseHeaderFields", "report.writeReportTitle", "report.headers", "window.report"] as const)
    expect(labels[k].source, k).toBe("ours");
});

// ---------- fix round 1 ----------

const THBK = "*/Facility/THBK";
const DOP_PARAMS: ReportParams = { style: "All DOPs", kind: "report", objects: [THBK], time: { mode: "object" }, dynamic: false };
const NOT_CURRENT = { status: 409, json: { code: "RESULTS_NOT_CURRENT", text: "x", field: null, detail: null } };

function planDoc(accesses: object[], objects?: object[]) {
  return makeDoc({
    name: "S1",
    objects: (objects ?? [
      { class: "Facility", name: "THBK", position: { type: "Geodetic", lat_deg: 13.7, lon_deg: 100.5, alt_m: 0 } },
      { class: "Constellation", name: "GPS", system: "G", assigned_objects: ["*/Satellite/G01"] },
      { class: "Constellation", name: "GAL", system: "E", assigned_objects: ["*/Satellite/E11"] },
      { class: "Satellite", name: "G01", norad: 40101 },
      { class: "Satellite", name: "E11", norad: 40102 },
      { class: "Satellite", name: "G02", norad: 40103 },
    ]) as never,
    accesses: accesses as never,
  });
}

describe("recomputePlan", () => {
  const toGps = { from: THBK, to: ["*/Constellation/GPS"], computed: true };

  test("a Facility report with an access computes through that access", () => {
    expect(recomputePlan(planDoc([toGps]), [THBK])).toEqual({ computes: [{ from: THBK, to: ["*/Constellation/GPS"] }], propagate: false, needsAccess: [], unreachable: [] });
  });

  test("a Facility report without an access needs a new access to every Constellation (asked first), never propagate", () => {
    expect(recomputePlan(planDoc([]), [THBK])).toEqual({
      computes: [], propagate: false, unreachable: [],
      needsAccess: [{ from: THBK, to: ["*/Constellation/GPS", "*/Constellation/GAL"], timeline: false }],
    });
  });

  test("without Constellations the new access goes to every Satellite; without satellites the facility cannot be computed", () => {
    const sats = planDoc([], [
      { class: "Facility", name: "THBK", position: { type: "Geodetic", lat_deg: 13.7, lon_deg: 100.5, alt_m: 0 } },
      { class: "Satellite", name: "G01", norad: 40101 },
      { class: "Satellite", name: "E11", norad: 40102 },
    ]);
    expect(recomputePlan(sats, [THBK]).needsAccess).toEqual([{ from: THBK, to: ["*/Satellite/G01", "*/Satellite/E11"], timeline: false }]);
    const none = planDoc([], [{ class: "Facility", name: "THBK", position: { type: "Geodetic", lat_deg: 13.7, lon_deg: 100.5, alt_m: 0 } }]);
    expect(recomputePlan(none, [THBK])).toEqual({ computes: [], propagate: false, needsAccess: [], unreachable: [THBK] });
  });

  test("a Satellite report propagates", () => {
    expect(recomputePlan(planDoc([toGps]), ["*/Satellite/G01"])).toEqual({ computes: [], propagate: true, needsAccess: [], unreachable: [] });
  });

  test("a satellite no access covers reuses an existing access of its facility instead of creating one", () => {
    expect(recomputePlan(planDoc([toGps]), [`${THBK} */Satellite/G02`]).computes).toEqual([{ from: THBK, to: ["*/Constellation/GPS"] }]);
    // ไม่มี access ของ Facility เลย: Compute คู่นั้นเอง (รายงานของ access นั้นคือสิ่งที่ผู้ใช้ขอ)
    expect(recomputePlan(planDoc([]), [`${THBK} */Satellite/G02`]).computes).toEqual([{ from: THBK, to: ["*/Satellite/G02"] }]);
  });
});

describe("facility reports that need an access", () => {
  test("confirm yes computes an access to every Constellation without a Timeline row, then regenerates", async () => {
    openScenario(planDoc([]));
    vi.mocked(confirm).mockResolvedValueOnce(true);
    let reports = 0;
    const f = stubFetch({
      [REPORTS]: () => (++reports === 1 ? NOT_CURRENT : { json: accessReport() }),
      [COMPUTE]: { status: 202, json: { job: "j-3", etag: "e2" } },
      "POST /api/scenarios/S1/propagate": { status: 202, json: { job: "never" } },
    });
    mount(DOP_PARAMS);
    await screen.findByRole("status");
    await user.click(screen.getByRole("button", { name: t("report.refresh") }));
    await waitFor(() => expect(f.count(COMPUTE)).toBe(1));
    expect(vi.mocked(confirm).mock.calls[0][0]).toBe(msg("report.needsAccess", { facility: "THBK" }));
    expect(f.calls.find((c) => `${c.method} ${c.path}` === COMPUTE)!.body).toEqual({ from: THBK, to: ["*/Constellation/GPS", "*/Constellation/GAL"], timeline: false });
    expect(f.count("POST /api/scenarios/S1/propagate")).toBe(0);
    act(() => useJobs.getState().onJobEvent({ id: "j-3", kind: "analyze", scenario: "S1", state: "succeeded", progress: null }));
    await screen.findByText("THBK-To-G01");
    expect(f.count(REPORTS)).toBe(2);
  });

  test("confirm no says so and does nothing else", async () => {
    openScenario(planDoc([]));
    vi.mocked(confirm).mockResolvedValueOnce(false);
    const f = stubFetch({ [REPORTS]: NOT_CURRENT });
    mount(DOP_PARAMS);
    await screen.findByRole("status");
    await user.click(screen.getByRole("button", { name: t("report.refresh") }));
    await waitFor(() => expect(useMessages.getState().items.map((m) => m.text)).toContain(msg("report.needsAccessDeclined")));
    await new Promise((r) => setTimeout(r, 20));
    expect(f.count(REPORTS)).toBe(1);
    expect(f.calls.every((c) => c.method !== "POST" || c.path.endsWith("/reports"))).toBe(true);
    expect(screen.getByRole("button", { name: t("report.refresh") }).hasAttribute("disabled")).toBe(false);
  });
});

describe("column widths", () => {
  test("columns are wide enough for the longest text: LTZG times, statistic names and headers", () => {
    const report = accessReport();
    report.global_statistics.push({ name: "Std Deviation Duration", value: 12.5 });
    const rows = flattenRows(report, "LTZG", "+07:00");
    const widths = columnWidths(rows, 4);
    expect(widths[1]).toBeGreaterThanOrEqual("12 Nov 2026 13:00:00.000 LTZG+07:00".length);
    expect(widths[1]).toBeGreaterThanOrEqual("Start Time (LTZG+07:00)".length);
    expect(widths[3]).toBeGreaterThanOrEqual("Duration (sec)".length);
    // ชื่อสถิติคร่อมคอลัมน์แรกถึงคอลัมน์ก่อนสุดท้าย ค่าอยู่คอลัมน์สุดท้าย
    for (const r of rows.filter((x) => x.kind === "global" || x.kind === "summary")) {
      expect(widths.slice(0, 3).reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(r.cells[0].length);
      expect(widths[3]).toBeGreaterThanOrEqual(r.cells[1].length);
    }
  });

  test("the table has an explicit width from its columns, cells carry their text as a title", async () => {
    scenario({ units: { date_format: "LTZG", ltz_offset: "+07:00" } });
    stubFetch({ [REPORTS]: { json: accessReport() } });
    const { container } = mount();
    await screen.findByText("THBK-To-G01");
    const table = container.querySelector("table")!;
    expect(table.style.width).toMatch(/ch/);
    const cols = [...container.querySelectorAll("col")].map((c) => (c as HTMLElement).style.width);
    expect(cols[1]).toMatch(/^calc\((\d+)ch/);
    expect(Number(/^calc\((\d+)ch/.exec(cols[1])![1])).toBeGreaterThanOrEqual("12 Nov 2026 13:00:00.000 LTZG+07:00".length);
    const cell = screen.getByText("12 Nov 2026 13:00:00.000 LTZG+07:00");
    expect(cell.getAttribute("title")).toBe("12 Nov 2026 13:00:00.000 LTZG+07:00");
    const stat = screen.getByText("Min Duration");
    expect(stat.getAttribute("colspan")).toBe("3");
  });
});

describe("other fixes", () => {
  test("the stale banner follows the results store, not only a 409", async () => {
    scenario();
    stubFetch({ [REPORTS]: { json: accessReport() } });
    mount({ ...PARAMS, objects: [G01] });
    await screen.findByText("THBK-To-G01");
    expect(screen.queryByRole("status")).toBeNull();
    const info = (status: "current" | "stale" | "missing"): ResultsInfo => ({
      ephem: { hash: "h", status: "current", available: ["h"] }, access: { THBK: { hash: "a", status, available: [] } }, error: null,
    });
    act(() => useResults.setState({ status: "current", info: info("stale") }));
    expect((await screen.findByRole("status")).textContent).toContain(msg("banner.stale"));
    act(() => useResults.setState({ status: "current", info: info("missing") }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain(msg("banner.missing")));
    act(() => useResults.setState({ status: "current", info: info("current") }));
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });

  test("the window takes focus when it opens so F5 works at once", async () => {
    scenario();
    const f = stubFetch({ [REPORTS]: { json: accessReport() } });
    const { container } = mount();
    await screen.findByText("THBK-To-G01");
    expect(container.querySelector(".rpt")!.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.activeElement!, { key: "F5" });
    await waitFor(() => expect(f.count(REPORTS)).toBe(2));
  });

  test("dynamic display shows no whole-period statistics for a summary-only section", () => {
    const report = accessReport();
    report.global_statistics = [];
    report.sections = [{ ...report.sections[0], summary_only: true, summary: [{ name: "Total Duration", value: 10800 }] }];
    const rows = dynamicRows(report, prepareDynamic(report, []), T0 + 7 * HOUR, 45_000, "UTCG", "+07:00");
    expect(rows.map((r) => r.kind)).toEqual(["title", "nodata"]);
  });
});
