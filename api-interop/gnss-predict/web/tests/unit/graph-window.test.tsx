// หน้าต่างกราฟ (src/windows/Graph/Graph.tsx): ECharts ปลอมแทน chart.ts (jsdom วาด canvas ไม่ได้) จด setOption/getDataURL/dispatchAction
// ตรวจแถบเครื่องมือ (Save, Copy to Clipboard, Zoom Out, Refresh, Toggle Animation Timeline, Crosshair Cursor), เมนูคลิกขวา, Strip Chart ที่ตามนาฬิกา,
// chunk ของ ECharts โหลดไม่ได้, แถบเตือนผลลัพธ์ไม่ตรง (409) และ panel/ป้ายชื่อ

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { installTestHooks } from "../../src/cesium/testHooks";
import type { ReportJson } from "../../src/data/reports";
import { labels, STK_HELP_REF, t } from "../../src/labels/labels";
import { msg } from "../../src/labels/messages.th";
import { getPanelDef } from "../../src/layout/panels";
import { useJobs } from "../../src/stores/jobs";
import { useLayout } from "../../src/stores/layout";
import { useMessages } from "../../src/stores/messages";
import { useScenario } from "../../src/stores/scenario";
import { useTime } from "../../src/stores/time";
import { Graph, registerGraphPanel } from "../../src/windows/Graph/Graph";
import { openReport, type ReportParams } from "../../src/windows/Report/Report";
import { makeDoc, openScenario, resetAll } from "./helpers/chrome";
import { stubFetch, type Handler } from "./helpers/fake-fetch";

// ---------- ECharts ปลอม ----------

type AnyObj = Record<string, any>;

interface FakeChart {
  options: { option: AnyObj; opts: unknown }[];
  setOption: ReturnType<typeof vi.fn>;
  getDataURL: ReturnType<typeof vi.fn>;
  dispatchAction: ReturnType<typeof vi.fn>;
  convertFromPixel: ReturnType<typeof vi.fn>;
  containPixel: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}

const fake = vi.hoisted(() => ({
  charts: [] as FakeChart[],
  fail: false,
}));

const PNG_URL = "data:image/png;base64,iVBORw0KGgo=";

vi.mock("../../src/windows/Graph/chart", () => ({
  loadECharts: vi.fn(async () => {
    if (fake.fail) throw new TypeError("Failed to fetch dynamically imported module: /assets/echarts-x.js");
    return {
      init: vi.fn(() => {
        const options: FakeChart["options"] = [];
        const chart: FakeChart = {
          options,
          setOption: vi.fn((option: AnyObj, opts: unknown) => void options.push({ option, opts })),
          getDataURL: vi.fn(() => PNG_URL),
          dispatchAction: vi.fn(),
          convertFromPixel: vi.fn(() => [CLICK_TIME, 12]),
          containPixel: vi.fn(() => true),
          resize: vi.fn(),
          clear: vi.fn(),
          dispose: vi.fn(),
        };
        fake.charts.push(chart);
        return chart;
      }),
    };
  }),
}));

// ---------- ข้อมูล ----------

const T0 = Date.UTC(2026, 10, 12);
const MIN = 60_000;
const CLICK_TIME = T0 + 7 * MIN;
const iso = (ms: number) => new Date(ms).toISOString();
const G01 = "*/Facility/THBK */Satellite/G01";
const REPORTS = "POST /api/scenarios/S1/reports";
const COMPUTE = "POST /api/scenarios/S1/access/compute";

function aerGraph(dynamic = false): ReportJson {
  return {
    scenario: "S1", style: "AER", kind: "graph", created_utc: iso(T0), dynamic, global_statistics: [],
    graph: { type: "time_xy", y1: ["Azimuth", "Elevation"], y2: ["Range"], stack: false },
    sections: [{
      object: G01, title: "THBK-To-G01", summary: [], summary_only: false,
      columns: [
        { name: "Time", unit: null, kind: "time" },
        { name: "Azimuth", unit: "deg", kind: "number" },
        { name: "Elevation", unit: "deg", kind: "number" },
        { name: "Range", unit: "km", kind: "number" },
      ],
      rows: Array.from({ length: 11 }, (_, i) => [iso(T0 + i * MIN), 100 + i, 10 + i, 22000 - i]),
    }],
  };
}

function polarGraph(): ReportJson {
  const r = aerGraph();
  return {
    ...r, style: "Az El Polar", graph: { type: "polar90", y1: [], y2: [], stack: false },
    sections: r.sections.map((s) => ({ ...s, columns: s.columns.slice(0, 3), rows: s.rows.map((row) => row.slice(0, 3)) })),
  };
}

const PARAMS: ReportParams = { style: "AER", kind: "graph", objects: [G01], time: { mode: "object" }, dynamic: false };

function scenario() {
  return openScenario(makeDoc({
    name: "S1",
    step_s: 60, // ตรงกับระยะระหว่างแถวของข้อมูลตัวอย่าง (maxGap = 90 s)
    objects: [
      { class: "Facility", name: "THBK", position: { type: "Geodetic", lat_deg: 13.7, lon_deg: 100.5, alt_m: 0 } },
      { class: "Constellation", name: "GPS", system: "G", assigned_objects: ["*/Satellite/G01"] },
      { class: "Satellite", name: "G01", norad: 40101 },
    ] as never,
    accesses: [
      { from: "*/Facility/THBK", to: ["*/Constellation/GPS"], timeline: true, computed: true, time_period: { mode: "object" } },
    ] as never,
  }));
}

let user: ReturnType<typeof userEvent.setup>;

beforeEach(() => {
  resetAll();
  fake.charts.length = 0;
  fake.fail = false;
  user = userEvent.setup();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete window.__gnssStudioTest;
});

function mount(params: ReportParams = PARAMS, panelId = "graph") {
  return render(<Graph panelId={panelId} params={params} />);
}

/** รอจนกราฟวาดครั้งแรก คืน chart ปลอมของหน้าต่าง */
async function ready(): Promise<FakeChart> {
  await waitFor(() => expect(fake.charts[0]?.options.length ?? 0).toBeGreaterThan(0));
  return fake.charts[0];
}

const lastOption = (c: FakeChart): AnyObj => c.options.at(-1)!.option;
/** option เต็มล่าสุด (notMerge) */
const lastFull = (c: FakeChart): AnyObj => [...c.options].reverse().find((o) => (o.opts as AnyObj)?.notMerge === true)!.option;
const markLine = (o: AnyObj): number[] => ((o.series as AnyObj[]).find((s) => s.id === "timeLine")?.markLine?.data ?? []).map((d: AnyObj) => d.xAxis);

describe("graph window", () => {
  test("draws the graph from the report once", async () => {
    scenario();
    act(() => useTime.getState().setCurrent(new Date(T0 + 5 * MIN)));
    const f = stubFetch({ [REPORTS]: { json: aerGraph() } });
    mount();
    const chart = await ready();
    const option = lastFull(chart);
    expect((option.series as AnyObj[]).filter((s) => s.type === "line" && s.id !== "timeLine").map((s) => s.name))
      .toEqual(["THBK-To-G01 Azimuth", "THBK-To-G01 Elevation", "THBK-To-G01 Range"]);
    expect(markLine(option)).toEqual([T0 + 5 * MIN]);
    expect(f.calls.find((c) => `${c.method} ${c.path}` === REPORTS)!.body).toEqual({ ...PARAMS, format: "json" });
    // กราฟธรรมดาไม่สร้างใหม่ตามเวลา: เส้นเวลาเลื่อน แต่ไม่มี POST ใหม่
    act(() => useTime.getState().setCurrent(new Date(T0 + 6 * MIN)));
    await waitFor(() => expect(markLine(lastOption(chart))).toEqual([T0 + 6 * MIN]));
    expect(f.count(REPORTS)).toBe(1);
  });

  test("toolbar buttons", async () => {
    scenario();
    act(() => useTime.getState().setCurrent(new Date(T0 + 5 * MIN)));
    stubFetch({ [REPORTS]: { json: aerGraph() } });
    mount();
    const chart = await ready();

    // Save: PNG จาก getDataURL ดาวน์โหลดผ่าน <a download>
    const clicks: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { clicks.push(this); });
    await user.click(screen.getByRole("button", { name: t("graph.save") }));
    expect(chart.getDataURL).toHaveBeenCalledWith(expect.objectContaining({ type: "png" }));
    expect(clicks).toHaveLength(1);
    expect(clicks[0].href).toBe(PNG_URL);
    expect(clicks[0].download).toBe("THBK-To-G01_AER.png");

    // Copy to Clipboard: รูป PNG ลง clipboard
    const write = vi.fn(async () => {});
    class FakeItem { constructor(public items: Record<string, Blob>) {} }
    vi.stubGlobal("ClipboardItem", FakeItem);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { write } });
    await user.click(screen.getByRole("button", { name: t("graph.copyToClipboard") }));
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    const item = (write.mock.calls[0] as unknown as [FakeItem[]])[0][0];
    expect(item).toBeInstanceOf(FakeItem);
    expect(item.items["image/png"].type).toBe("image/png");

    // Zoom Out: เลิกซูม
    await user.click(screen.getByRole("button", { name: t("graph.zoomOut") }));
    expect(chart.dispatchAction).toHaveBeenCalledWith({ type: "dataZoom", start: 0, end: 100 });

    // Toggle Animation Timeline: สลับเส้นเวลา (จำใน windowProps) แบบ merge ไม่วาดใหม่ทั้งกราฟ (ซูมของผู้ใช้คงอยู่)
    const fulls = () => chart.options.filter((o) => (o.opts as AnyObj)?.notMerge === true).length;
    const before = fulls();
    const toggle = screen.getByRole("button", { name: t("graph.toggleAnimationTimeline") });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    await user.click(toggle);
    await waitFor(() => expect(markLine(lastOption(chart))).toEqual([]));
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(useLayout.getState().windowProps.graph?.showTimeLine).toBe(false);
    await user.click(toggle);
    await waitFor(() => expect(markLine(lastOption(chart))).toEqual([T0 + 5 * MIN]));

    // Crosshair Cursor (merge)
    expect(lastFull(chart).tooltip.axisPointer.type).toBe("line");
    await user.click(screen.getByRole("button", { name: t("graph.crosshairCursor") }));
    await waitFor(() => expect(lastOption(chart).tooltip?.axisPointer?.type).toBe("cross"));
    expect(fulls()).toBe(before);
  });

  test("scenario edits that do not change colours keep the graph (and its zoom)", async () => {
    const doc = scenario();
    stubFetch({ [REPORTS]: { json: aerGraph() } });
    mount();
    const chart = await ready();
    const fulls = () => chart.options.filter((o) => (o.opts as AnyObj)?.notMerge === true).length;
    const before = fulls();
    act(() => useScenario.setState({ doc: { ...doc, description: "edited" } }));
    await act(async () => {});
    expect(fulls()).toBe(before);
    // สีของดาวเปลี่ยน = วาดใหม่ด้วยสีใหม่
    act(() => useScenario.setState({
      doc: { ...doc, objects: doc.objects.map((o) => (o.name === "G01" ? { ...o, graphics2d: { inherit: false, color: "#123456" } } : o)) as never },
    }));
    await waitFor(() => expect(fulls()).toBe(before + 1));
    expect((lastFull(chart).series as AnyObj[]).find((s) => s.name === "THBK-To-G01 Azimuth")!.color).toBe("#123456");
  });

  test("copy to clipboard without clipboard support says so", async () => {
    scenario();
    stubFetch({ [REPORTS]: { json: aerGraph() } });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    mount();
    await ready();
    await user.click(screen.getByRole("button", { name: t("graph.copyToClipboard") }));
    await waitFor(() => expect(useMessages.getState().items.map((m) => m.text)).toContain(msg("graph.clipboardUnavailable")));
  });

  test("right click menu", async () => {
    scenario();
    act(() => useTime.getState().setCurrent(new Date(T0 + 5 * MIN)));
    const f = stubFetch({
      [REPORTS]: (call) => ((call.body as AnyObj).format === "csv"
        ? { text: "Time,Azimuth\n", headers: { "Content-Disposition": 'attachment; filename="THBK-To-G01_AER.csv"' } }
        : { json: aerGraph() }),
    });
    const { container } = mount();
    const chart = await ready();
    const surface = container.querySelector(".graph-chart")!;

    // Show Animation Time Line สลับ
    fireEvent.contextMenu(surface, { clientX: 40, clientY: 30 });
    await user.click(await screen.findByRole("menuitemcheckbox", { name: t("graph.showAnimationTimeLine") }));
    await waitFor(() => expect(markLine(lastOption(chart))).toEqual([]));

    // Set Animation Time = เวลาที่ตำแหน่งคลิก
    fireEvent.contextMenu(surface, { clientX: 40, clientY: 30 });
    await user.click(await screen.findByRole("menuitem", { name: t("report.setAnimationTime") }));
    expect(chart.convertFromPixel).toHaveBeenCalledWith({ gridIndex: 0 }, [40, 30]);
    expect(useTime.getState().current.getTime()).toBe(CLICK_TIME);

    // Export = ข้อมูลกราฟเป็นไฟล์ CSV
    const clicks: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { clicks.push(this); });
    fireEvent.contextMenu(surface, { clientX: 40, clientY: 30 });
    await user.click(await screen.findByRole("menuitem", { name: t("graph.export") }));
    await waitFor(() => expect(clicks).toHaveLength(1));
    const csv = f.calls.filter((c) => `${c.method} ${c.path}` === REPORTS).at(-1)!;
    expect(csv.body).toEqual({ ...PARAMS, format: "csv" });
    expect(clicks[0].download).toBe("THBK-To-G01_AER.csv");
  });

  test("set animation time is not offered outside the plot or on a polar graph", async () => {
    scenario();
    stubFetch({ [REPORTS]: { json: polarGraph() } });
    const { container } = mount({ ...PARAMS, style: "Az El Polar" });
    await ready();
    fireEvent.contextMenu(container.querySelector(".graph-chart")!, { clientX: 40, clientY: 30 });
    await screen.findByRole("menuitem", { name: t("graph.export") });
    expect(screen.queryByRole("menuitem", { name: t("report.setAnimationTime") })).toBeNull();
    // polar ไม่มีการซูมตามแกนเวลา: Zoom Out ใช้ไม่ได้
    await user.keyboard("{Escape}");
    expect((screen.getByRole("button", { name: t("graph.zoomOut") }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: t("graph.save") }) as HTMLButtonElement).disabled).toBe(false);
  });

  test("graph windows log under GRAPH_* codes", async () => {
    scenario();
    const f = stubFetch({
      [REPORTS]: { status: 409, json: { code: "RESULTS_NOT_CURRENT", text: "x", field: null, detail: null } },
      [COMPUTE]: { status: 202, json: { job: "j-3", etag: "e2" } },
    });
    mount();
    await screen.findByRole("status");
    await user.click(screen.getByRole("button", { name: t("report.refresh") }));
    await waitFor(() => expect(f.count(COMPUTE)).toBe(1));
    act(() => useJobs.getState().onJobEvent({ id: "j-3", kind: "analyze", scenario: "S1", state: "failed", progress: null }));
    await waitFor(() => expect(useMessages.getState().items.find((m) => m.text === msg("graph.computeJobFailed"))?.code).toBe("GRAPH_COMPUTE"));
    expect(useMessages.getState().items.some((m) => m.code.startsWith("REPORT_"))).toBe(false);
  });

  test("strip chart follows the clock", async () => {
    scenario();
    act(() => useTime.getState().setCurrent(new Date(T0 + 5 * MIN)));
    const f = stubFetch({ [REPORTS]: { json: aerGraph(true) } });
    mount({ ...PARAMS, dynamic: true });
    const chart = await ready();
    const axis = (o: AnyObj) => (Array.isArray(o.xAxis) ? o.xAxis[0] : o.xAxis);
    expect(axis(lastOption(chart))).toMatchObject({ min: T0 + 5 * MIN - 3_600_000, max: T0 + 5 * MIN });
    const before = chart.options.length;
    for (const m of [6, 7, 8]) {
      act(() => useTime.getState().setCurrent(new Date(T0 + m * MIN)));
      await waitFor(() => expect(axis(lastOption(chart)).max).toBe(T0 + m * MIN), { timeout: 2000 });
    }
    expect(chart.options.length).toBeGreaterThan(before);
    expect(axis(lastOption(chart)).min).toBe(T0 + 8 * MIN - 3_600_000);
    // อัปเดตตามเวลาเป็นบางส่วน (merge) ไม่ส่งข้อมูลทั้งหมดซ้ำ
    expect((chart.options.at(-1)!.opts as AnyObj)?.notMerge).not.toBe(true);
    expect(f.count(REPORTS)).toBe(1);
  });

  test("time updates are throttled to 250 ms", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    try {
      scenario();
      stubFetch({ [REPORTS]: { json: aerGraph(true) } });
      mount({ ...PARAMS, dynamic: true });
      await vi.waitFor(() => expect(fake.charts[0]?.options.length ?? 0).toBeGreaterThan(0));
      const chart = fake.charts[0];
      act(() => useTime.getState().setCurrent(new Date(T0 + MIN)));
      const n = chart.options.length;
      for (let i = 2; i < 10; i++) act(() => useTime.getState().setCurrent(new Date(T0 + i * MIN)));
      expect(chart.options.length).toBe(n);
      await act(async () => { vi.advanceTimersByTime(150); });
      expect(chart.options.length).toBe(n); // ยังไม่ครบ 250 ms
      await act(async () => { vi.advanceTimersByTime(110); });
      expect(chart.options.length).toBe(n + 1);
    } finally {
      vi.useRealTimers();
    }
  });

  test("chunk failure shows a Thai message", async () => {
    scenario();
    fake.fail = true;
    stubFetch({ [REPORTS]: { json: aerGraph() } });
    mount();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(msg("graph.chunkFailed"));
    // Refresh ลองโหลดใหม่
    fake.fail = false;
    await user.click(screen.getByRole("button", { name: t("report.refresh") }));
    await ready();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("stale results show the banner", async () => {
    scenario();
    let reports = 0;
    const handler: Handler = () => (++reports === 1
      ? { status: 409, json: { code: "RESULTS_NOT_CURRENT", text: "ผลลัพธ์ของ THBK ไม่ตรงกับ scenario", field: null, detail: null } }
      : { json: aerGraph() });
    const f = stubFetch({ [REPORTS]: handler, [COMPUTE]: { status: 202, json: { job: "j-1", etag: "e2" }, headers: { ETag: '"e2"' } } });
    mount();
    const banner = await screen.findByRole("status");
    expect(banner.textContent).toContain(msg("banner.stale"));
    expect(screen.getByText(msg("graph.notCurrent"))).toBeTruthy();

    await user.click(screen.getByRole("button", { name: t("report.refresh") }));
    await waitFor(() => expect(f.count(COMPUTE)).toBe(1));
    const compute = f.calls.find((c) => `${c.method} ${c.path}` === COMPUTE)!;
    expect(compute.headers.get("If-Match")).toBe('"e1"');
    expect(compute.body).toEqual({ from: "*/Facility/THBK", to: ["*/Constellation/GPS"] });
    expect(useJobs.getState().jobs["j-1"]?.state).toBe("queued");

    act(() => useJobs.getState().onJobEvent({ id: "j-1", kind: "analyze", scenario: "S1", state: "succeeded", progress: null }));
    await ready();
    expect(f.count(REPORTS)).toBe(2);
    expect(screen.queryByRole("status")).toBeNull();
  });

  test("style error goes to the Message Viewer", async () => {
    scenario();
    stubFetch({ [REPORTS]: { status: 422, json: { code: "STYLE_INVALID", text: "element 'Foo' ไม่มีใน AER Data", field: "content[0].elements[1]", detail: null } } });
    mount({ ...PARAMS, style: "Mine" });
    await screen.findByText(msg("graph.styleInvalid"));
    expect(useMessages.getState().items.find((m) => m.code === "STYLE_INVALID")?.text).toContain("element 'Foo'");
  });

  test("a style without a graph definition says so", async () => {
    scenario();
    stubFetch({ [REPORTS]: { json: { ...aerGraph(), graph: null } } });
    mount();
    await screen.findByText(msg("graph.noGraph"));
    expect(fake.charts[0]?.options.length ?? 0).toBe(0);
  });

  test("resizes with the panel and disposes on close", async () => {
    scenario();
    stubFetch({ [REPORTS]: { json: aerGraph() } });
    let resized: ((size: { width: number; height: number }) => void) | null = null;
    useLayout.setState({ onPanelResize: (_id: string, cb: (size: { width: number; height: number }) => void) => ((resized = cb), () => undefined) } as never);
    const { unmount } = mount();
    const chart = await ready();
    expect(resized).not.toBeNull();
    act(() => resized!({ width: 500, height: 300 }));
    expect(chart.resize).toHaveBeenCalled();
    unmount();
    expect(chart.dispose).toHaveBeenCalled();
  });

  test("graphState test hook", async () => {
    scenario();
    act(() => useTime.getState().setCurrent(new Date(T0 + 5 * MIN + 30_000)));
    stubFetch({ [REPORTS]: { json: polarGraph() } });
    installTestHooks();
    expect(window.__gnssStudioTest!.graphState("polar")).toBeNull();
    mount({ ...PARAMS, style: "Az El Polar" }, "polar");
    await ready();
    const state = window.__gnssStudioTest!.graphState("polar")!;
    expect(state.type).toBe("polar90");
    expect(state.series).toEqual(["THBK-To-G01"]);
    expect(state.timeLine).toBeNull();
    expect(state.currentPoint![0]).toBeCloseTo(15.5, 9);
    expect(state.currentPoint![1]).toBeCloseTo(105.5, 9);
  });
});

describe("panel", () => {
  test("the graph panel kind mirrors the report window", () => {
    registerGraphPanel();
    const def = getPanelDef("graph")!;
    expect(def.component).toBe(Graph);
    expect(def.type).toBe("integrated");
    expect(def.persist).toBe(true);
    expect(def.scenarioBound).toBe(true);
    expect(def.singleton).toBe(true);
    expect(def.title(PARAMS)).toBe("THBK-To-G01: AER");
    expect(def.instanceKey!(PARAMS)).toBe(JSON.stringify(["AER", "graph", [G01], { mode: "object" }, false]));
  });

  test("openReport routes graph styles to the graph window", () => {
    const open = vi.spyOn(useLayout.getState(), "openPanel").mockImplementation(() => "graph");
    useLayout.setState({ openPanel: open });
    openReport(PARAMS);
    expect(open).toHaveBeenCalledWith("graph", PARAMS);
  });
});

test("labels", () => {
  expect(labels["window.graph"]).toEqual({ text: "Graph", source: "ours" });
  expect(labels["graph.toggleAnimationTimeline"]).toEqual({ text: "Toggle Animation Timeline", source: "stk", ref: "STK ref §F" });
  expect(labels["graph.showAnimationTimeLine"]).toEqual({ text: "Show Animation Time Line", source: "stk", ref: "STK ref §F" });
  for (const k of ["graph.save", "graph.copyToClipboard", "graph.zoomOut", "graph.crosshairCursor"] as const)
    expect(labels[k].source, k).toBe("ours");
  // help.agi.com: เมนูคลิกขวาของกราฟชื่อ Export (เปิด Export Dialog) ผลตรวจคำ 2026-11-15
  expect(labels["graph.export"]).toEqual({ text: "Export", source: "stk", ref: STK_HELP_REF });
});
