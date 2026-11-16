// หน้าต่าง Validation (src/windows/Validation/Validation.tsx, spec §7): ตารางรายวัน (history + pending) สลับ ΔEl/ΔAz, ตารางรายดวงของวันที่คลิก
// พร้อมตัวกรอง, กราฟแนวโน้ม P99 กับกราฟอายุ/ความคลาด (ECharts ปลอมแทน chart.ts) ไม่เรียก /validate หรือ /daily/run จริง: fetch เป็นของปลอมทั้งหมด

import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { commandTooltip, isEnabled, isRegistered, runCommand } from "../../src/commands";
import { labels, t } from "../../src/labels/labels";
import { msg } from "../../src/labels/messages.th";
import { getPanelDef } from "../../src/layout/panels";
import { useJobs } from "../../src/stores/jobs";
import { useLayout } from "../../src/stores/layout";
import { formatTime } from "../../src/time/format";
import { registerValidationCommands, VALIDATION_KIND } from "../../src/windows/Validation/commands";
import { registerValidationPanel, Validation } from "../../src/windows/Validation/Validation";
import { makeDoc, openScenario, resetAll } from "./helpers/chrome";
import { stubFetch, type Handler } from "./helpers/fake-fetch";

// ---------- ECharts ปลอม ----------

type AnyObj = Record<string, any>;

interface FakeChart {
  el: HTMLElement;
  options: { option: AnyObj; opts: unknown }[];
  setOption: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}

const fake = vi.hoisted(() => ({ charts: [] as FakeChart[], fail: false }));

vi.mock("../../src/windows/Graph/chart", () => ({
  loadECharts: vi.fn(async () => {
    if (fake.fail) throw new TypeError("Failed to fetch dynamically imported module: /assets/echarts-x.js");
    return {
      init: vi.fn((el: HTMLElement) => {
        const options: FakeChart["options"] = [];
        const chart: FakeChart = {
          el, options, setOption: vi.fn((option: AnyObj, opts: unknown) => void options.push({ option, opts })),
          resize: vi.fn(), clear: vi.fn(), dispose: vi.fn(),
        };
        fake.charts.push(chart);
        return chart;
      }),
    };
  }),
}));

const chartOf = (name: "trend" | "age"): FakeChart | undefined => fake.charts.find((c) => c.el.dataset.chart === name && c.el.isConnected);
const fullOption = (c: FakeChart): AnyObj => [...c.options].reverse().find((o) => (o.opts as AnyObj)?.notMerge === true)!.option;
const trendDrawn = async (): Promise<AnyObj> => {
  await waitFor(() => expect(chartOf("trend")?.options.length ?? 0).toBeGreaterThan(0));
  return fullOption(chartOf("trend")!);
};

// ---------- ข้อมูล ----------

const stats = (el_median: number, el_p99: number, az_median: number, az_p99: number, pass = true) =>
  ({ sats: 30, pairs: 1000, az_pairs: 900, el_median, el_p99, az_median, az_p99, pass });

const HISTORY = [
  {
    day: "2026-11-09", scenario: "E2E", ephem_hash: "aaa111", truth_file: "COD0MGXFIN_20263130000_01D_05M_ORB.SP3", pass: true,
    systems: { G: stats(0.011, 0.11, 0.021, 0.31), E: stats(0.012, 0.12, 0.022, 0.32) }, failing: [], created_utc: "2026-11-12T03:00:00Z",
  },
  {
    day: "2026-11-10", scenario: "E2E", ephem_hash: "bbb222", truth_file: "COD0MGXFIN_20263140000_01D_05M_ORB.SP3", pass: false,
    systems: { G: stats(0.03, 0.31, 0.04, 0.61, false), E: stats(0.013, 0.13, 0.023, 0.33) }, failing: ["G22"], created_utc: "2026-11-13T03:00:00Z",
  },
];
const PENDING = [
  { scenario: "daily_20261111", day: "2026-11-11", state: "pending", next_attempt_utc: "2026-11-12T06:00:00Z" },
  { scenario: "daily_20261108", day: "2026-11-08", state: "gave_up", next_attempt_utc: null },
];

const sat = (over: AnyObj) => ({ truth: "sp3", pairs: 900, az_pairs: 800, el_median: 0.01, el_p99: 0.1, az_median: 0.02, az_p99: 0.3, d3_median_km: 0.011, d3_max_km: 0.09, age_days: 0.5, flags: [], result: "pass", ...over });
const DOC_10 = {
  day: "2026-11-10", scenario: "E2E",
  satellites: {
    R03: sat({ truth: "unverified", pairs: 0, az_pairs: 0, el_median: null, el_p99: null, az_median: null, az_p99: null, d3_median_km: null, d3_max_km: null, age_days: null, result: "unverified" }),
    G22: sat({ pairs: 800, el_median: 0.03, el_p99: 0.31, az_median: 0.04, az_p99: 0.61, d3_median_km: 0.052, d3_max_km: 0.4, age_days: 1.5, result: "fail" }),
    G01: sat({}),
    E05: sat({ truth: "brdc", pairs: 500, d3_median_km: 0.02, age_days: 3.25, result: "fail" }),
  },
};
const DOC_09 = { day: "2026-11-09", scenario: "E2E", satellites: { G01: sat({ age_days: 0.25, d3_median_km: 0.01 }), C06: sat({ age_days: 6.5, d3_median_km: 0.31, result: "fail" }) } };

const HISTORY_ROUTE = "GET /api/validation/history";
const PENDING_ROUTE = "GET /api/validation/pending";
const DAY_10 = "GET /api/validation/E2E/2026-11-10";
const DAY_09 = "GET /api/validation/E2E/2026-11-09";

function server(over: Record<string, Handler> = {}) {
  return stubFetch({
    [HISTORY_ROUTE]: { json: HISTORY },
    [PENDING_ROUTE]: { json: PENDING },
    [DAY_10]: { json: DOC_10 },
    [DAY_09]: { json: DOC_09 },
    ...over,
  });
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
});

const mount = () => render(<Validation panelId="validation" params={{}} />);
const daily = () => screen.findByRole("table", { name: t("validation.dailyTable") });
const rowOf = (table: HTMLElement, text: string): HTMLElement =>
  within(table).getAllByRole("row").find((r) => r.textContent?.includes(text))!;
const cells = (row: HTMLElement): string[] => within(row).getAllByRole("cell").map((c) => c.textContent ?? "");
const headers = (table: HTMLElement): string[] => within(table).getAllByRole("columnheader").map((h) => h.textContent ?? "");

describe("daily table", () => {
  test("empty history explains when data comes", async () => {
    const f = server({ [HISTORY_ROUTE]: { json: [] }, [PENDING_ROUTE]: { json: [] } });
    mount();
    expect(await screen.findByText(msg("validation.empty"))).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    // ไม่มีวันให้ดึงผลรายดวง และไม่เรียกอะไรนอกจากสองรายการ
    expect(f.calls.map((c) => `${c.method} ${c.path}`).sort()).toEqual([HISTORY_ROUTE, PENDING_ROUTE]);
  });

  test("lists the days newest first with Pass, Fail, Pending and Gave up", async () => {
    server();
    mount();
    const table = await daily();
    expect(headers(table)).toEqual([
      t("validation.col.day"), t("validation.col.scenario"), t("validation.col.truth"),
      t("validation.col.systemStats", { system: "GPS", metric: t("validation.metric.el") }),
      t("validation.col.systemStats", { system: "Galileo", metric: t("validation.metric.el") }),
      t("validation.col.result"), t("validation.col.failing"),
    ]);
    const body = within(table).getAllByRole("row").slice(1);
    expect(body.map((r) => cells(r).slice(0, 2))).toEqual([
      ["2026-11-11", "daily_20261111"], ["2026-11-10", "E2E"], ["2026-11-09", "E2E"], ["2026-11-08", "daily_20261108"],
    ]);
    const fail = cells(rowOf(table, "2026-11-10"));
    expect(fail).toEqual([
      "2026-11-10", "E2E", "COD0MGXFIN_20263140000_01D_05M_ORB.SP3", "0.030 / 0.310", "0.013 / 0.130", t("validation.result.fail"), "G22",
    ]);
    expect(cells(rowOf(table, "2026-11-09")).at(-2)).toBe(t("validation.result.pass"));
    expect(cells(rowOf(table, "2026-11-09")).at(-1)).toBe("");
    expect(cells(rowOf(table, "daily_20261108")).at(-2)).toBe(t("validation.result.gaveUp"));
    expect(cells(rowOf(table, "daily_20261111")).at(-2)).toContain(t("validation.result.pending"));
    // ชื่อไฟล์ SP3 ที่ตัดด้วย ... ในจอ ยังอ่านเต็มได้จาก title
    expect(within(rowOf(table, "2026-11-10")).getByText("COD0MGXFIN_20263140000_01D_05M_ORB.SP3").getAttribute("title")).toBe("COD0MGXFIN_20263140000_01D_05M_ORB.SP3");
  });

  test("the metric switch shows ΔAz instead of ΔEl", async () => {
    server();
    mount();
    const table = await daily();
    const el = screen.getByRole("button", { name: t("validation.metric.el") });
    const az = screen.getByRole("button", { name: t("validation.metric.az") });
    expect(el.getAttribute("aria-pressed")).toBe("true");
    expect(az.getAttribute("aria-pressed")).toBe("false");
    await user.click(az);
    expect(az.getAttribute("aria-pressed")).toBe("true");
    expect(headers(table)[3]).toBe(t("validation.col.systemStats", { system: "GPS", metric: t("validation.metric.az") }));
    expect(cells(rowOf(table, "2026-11-10"))[3]).toBe("0.040 / 0.610");
  });

  test("pending row shows the next attempt time in the scenario's DateFormat", async () => {
    openScenario(makeDoc({ units: { date_format: "LTZG", ltz_offset: "+07:00" } }));
    server();
    mount();
    const table = await daily();
    const next = new Date("2026-11-12T06:00:00Z");
    const local = formatTime(next, "LTZG", "+07:00");
    expect(local).not.toBe(formatTime(next, "UTCG", "+07:00")); // test ไม่ว่างเปล่า: สองรูปแบบต่างกันจริง
    const pending = rowOf(table, "daily_20261111");
    expect(cells(pending).at(-2)).toContain(msg("validation.nextAttempt", { time: local }));
    // gave up: ไม่มีเวลาลองครั้งถัดไป แต่บอกเหตุ
    const gaveUp = rowOf(table, "daily_20261108");
    expect(cells(gaveUp).at(-2)).not.toContain(msg("validation.nextAttempt", { time: "" }));
    expect(gaveUp.getAttribute("title")).toBe(msg("validation.gaveUp"));
  });

  test("without a scenario the next attempt is in UTCG", async () => {
    server();
    mount();
    const table = await daily();
    expect(cells(rowOf(table, "daily_20261111")).at(-2)).toContain(formatTime(new Date("2026-11-12T06:00:00Z"), "UTCG", "+07:00"));
  });

  test("a pending day with no retry planned says so instead of a time", async () => {
    server({ [PENDING_ROUTE]: { json: [{ ...PENDING[0], next_attempt_utc: null }] } });
    mount();
    const table = await daily();
    expect(cells(rowOf(table, "daily_20261111")).at(-2)).toContain(msg("validation.noRetry"));
  });

  test("pending and gave-up days cannot be opened and fetch nothing", async () => {
    const f = server();
    mount();
    const table = await daily();
    expect(within(rowOf(table, "daily_20261111")).queryByRole("button")).toBeNull();
    expect(within(rowOf(table, "daily_20261108")).queryByRole("button")).toBeNull();
    expect(f.calls.some((c) => c.path.includes("daily_2026"))).toBe(false);
  });
});

describe("a day's satellites", () => {
  test("click a day loads its satellites", async () => {
    const f = server();
    mount();
    const table = await daily();
    expect(screen.queryByRole("table", { name: t("validation.satTable") })).toBeNull();
    expect(screen.getByText(msg("validation.selectDay"))).toBeTruthy();
    await user.click(within(rowOf(table, "2026-11-10")).getByRole("button", { name: "2026-11-10" }));
    const sats = await screen.findByRole("table", { name: t("validation.satTable") });
    expect(f.calls.some((c) => `${c.method} ${c.path}` === DAY_10)).toBe(true);
    expect(headers(sats)).toEqual(["PRN", "Truth", "Pairs", "ΔEl med/P99", "ΔAz med/P99", "3D med/max (km)", "Age", "Result"]);
    const body = within(sats).getAllByRole("row").slice(1);
    expect(body.map((r) => cells(r)[0])).toEqual(["E05", "G01", "G22", "R03"]);
    expect(cells(rowOf(sats, "G22"))).toEqual(["G22", "sp3", "800", "0.030 / 0.310", "0.040 / 0.610", "0.052 / 0.400", "1.50", t("validation.result.fail")]);
    expect(cells(rowOf(sats, "R03"))).toEqual(["R03", "unverified", "0", "—", "—", "—", "—", t("validation.result.unverified")]);
    expect(cells(rowOf(sats, "E05"))[1]).toBe("brdc");
    expect(within(table).getByRole("button", { name: "2026-11-10" }).getAttribute("aria-pressed")).toBe("true");
    // ผลวันเดียวกันไม่ถูกดึงซ้ำ (ตัวโหลดของกราฟอายุใช้ที่เก็บเดียวกัน)
    expect(f.calls.filter((c) => `${c.method} ${c.path}` === DAY_10)).toHaveLength(1);
  });

  test("filters by system and by result", async () => {
    server();
    mount();
    const table = await daily();
    await user.click(within(rowOf(table, "2026-11-10")).getByRole("button", { name: "2026-11-10" }));
    const sats = await screen.findByRole("table", { name: t("validation.satTable") });
    const names = () => within(sats).getAllByRole("row").slice(1).map((r) => cells(r)[0]);

    const system = screen.getByRole("combobox", { name: t("validation.filter.system") });
    // ตัวเลือกของระบบมีเฉพาะที่อยู่ในผลของวันนี้ (E, G, R) และ All
    expect(within(system).getAllByRole("option").map((o) => o.textContent)).toEqual([t("validation.filter.all"), "GPS", "GLONASS", "Galileo"]);
    await user.selectOptions(system, "G");
    expect(names()).toEqual(["G01", "G22"]);
    await user.selectOptions(screen.getByRole("combobox", { name: t("validation.filter.result") }), "fail");
    expect(names()).toEqual(["G22"]);
    await user.selectOptions(system, t("validation.filter.all"));
    expect(names()).toEqual(["E05", "G22"]);
    await user.selectOptions(screen.getByRole("combobox", { name: t("validation.filter.result") }), "unverified");
    expect(names()).toEqual(["R03"]);
    await user.selectOptions(screen.getByRole("combobox", { name: t("validation.filter.result") }), "pass");
    expect(names()).toEqual(["G01"]);
    await user.selectOptions(system, "R");
    expect(screen.getByText(msg("validation.noMatch"))).toBeTruthy();
  });

  test("a day whose result file is gone says why, and the other day still opens", async () => {
    server({ [DAY_10]: { status: 404, json: { code: "NOT_FOUND", text: "ไม่พบผลการตรวจสอบของ scenario และวันที่นี้", field: null, detail: null } } });
    mount();
    const table = await daily();
    await user.click(within(rowOf(table, "2026-11-10")).getByRole("button", { name: "2026-11-10" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(msg("validation.dayFailed", { scenario: "E2E", day: "2026-11-10", message: "ไม่พบผลการตรวจสอบของ scenario และวันที่นี้" }));
    await user.click(within(rowOf(table, "2026-11-09")).getByRole("button", { name: "2026-11-09" }));
    const sats = await screen.findByRole("table", { name: t("validation.satTable") });
    expect(within(sats).getAllByRole("row").slice(1).map((r) => cells(r)[0])).toEqual(["C06", "G01"]);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("loading", () => {
  test("a failed history load shows an alert, and Refresh tries again", async () => {
    let attempts = 0;
    const f = server({ [HISTORY_ROUTE]: () => (++attempts === 1 ? { status: 500, json: { code: "INTERNAL", text: "พัง", field: null, detail: null } } : { json: HISTORY }) });
    mount();
    expect((await screen.findByRole("alert")).textContent).toBe(msg("validation.loadFailed", { message: "พัง" }));
    expect(screen.queryByRole("table")).toBeNull();
    await user.click(screen.getByRole("button", { name: t("report.refresh") }));
    await daily();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(f.count(HISTORY_ROUTE)).toBe(2);
  });

  test("a failed pending load keeps the history and says what is missing", async () => {
    server({ [PENDING_ROUTE]: { status: 500, json: { code: "INTERNAL", text: "พัง", field: null, detail: null } } });
    mount();
    const table = await daily();
    expect((await screen.findByRole("alert")).textContent).toBe(msg("validation.pendingFailed", { message: "พัง" }));
    expect(within(table).getAllByRole("row").slice(1).map((r) => cells(r)[0])).toEqual(["2026-11-10", "2026-11-09"]);
  });

  test("Refresh reloads both lists", async () => {
    const f = server();
    mount();
    await daily();
    await user.click(screen.getByRole("button", { name: t("report.refresh") }));
    await waitFor(() => expect(f.count(HISTORY_ROUTE)).toBe(2));
    expect(f.count(PENDING_ROUTE)).toBe(2);
  });

  test("a validation job that finishes reloads the lists (a Pending day becomes a result)", async () => {
    const f = server();
    mount();
    await daily();
    const job = { id: "j1", kind: "validate" as const, scenario: "daily_20261111", progress: { stage: null, fraction: null } };
    act(() => useJobs.getState().onJobEvent({ ...job, state: "running" }));
    expect(f.count(HISTORY_ROUTE)).toBe(1);
    act(() => useJobs.getState().onJobEvent({ ...job, state: "succeeded" }));
    await waitFor(() => expect(f.count(HISTORY_ROUTE)).toBe(2));
    // งานชนิดอื่นไม่ทำให้โหลดใหม่
    act(() => useJobs.getState().onJobEvent({ id: "j2", kind: "analyze", scenario: "E2E", state: "succeeded", progress: { stage: null, fraction: null } }));
    await act(async () => {});
    expect(f.count(HISTORY_ROUTE)).toBe(2);
  });
});

describe("charts", () => {
  test("the trend chart has a line per system and the 0.2 limit, and 0.5 for ΔAz", async () => {
    server();
    mount();
    const option = await trendDrawn();
    expect(option.xAxis.data).toEqual(["2026-11-09", "2026-11-10"]);
    expect((option.series as AnyObj[]).filter((s) => s.id !== "limit").map((s) => [s.name, s.data])).toEqual([["GPS", [0.11, 0.31]], ["Galileo", [0.12, 0.13]]]);
    expect((option.series as AnyObj[]).find((s) => s.id === "limit")!.markLine.data[0].yAxis).toBe(0.2);
    await user.click(screen.getByRole("button", { name: t("validation.metric.az") }));
    await waitFor(() => expect((fullOption(chartOf("trend")!).series as AnyObj[]).find((s) => s.id === "limit")!.markLine.data[0].yAxis).toBe(0.5));
    expect((fullOption(chartOf("trend")!).series as AnyObj[]).find((s) => s.name === "GPS")!.data).toEqual([0.31, 0.61]);
  });

  test("the age chart pools the satellites of every day, skipping the ones with no age or no 3D median", async () => {
    const f = server();
    mount();
    await daily();
    await waitFor(() => expect(chartOf("age")?.options.length ?? 0).toBeGreaterThan(0));
    await waitFor(() => {
      const points = ((fullOption(chartOf("age")!).series as AnyObj[]).flatMap((s) => s.data) as [number, number, string][]).map((p) => p[2]).sort();
      expect(points).toEqual(["C06", "E05", "G01", "G01", "G22"]);
    });
    // ทุกวันที่ตรวจแล้วดึงครั้งเดียว วันที่ยังรอไม่ถูกดึง
    expect(f.count(DAY_10)).toBe(1);
    expect(f.count(DAY_09)).toBe(1);
  });

  test("a day whose file is missing is left out of the age chart without an alert", async () => {
    server({ [DAY_10]: { status: 404, json: { code: "NOT_FOUND", text: "ไม่พบ", field: null, detail: null } } });
    mount();
    await daily();
    await waitFor(() => {
      const points = ((fullOption(chartOf("age")!).series as AnyObj[]).flatMap((s) => s.data) as [number, number, string][]).map((p) => p[2]).sort();
      expect(points).toEqual(["C06", "G01"]);
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("a chart library that cannot load says so in Thai, and the tables still work", async () => {
    fake.fail = true;
    server();
    mount();
    const table = await daily();
    expect((await screen.findByRole("alert")).textContent).toBe(msg("graph.chunkFailed"));
    expect(within(table).getAllByRole("row")).toHaveLength(5);
  });

  test("the charts are disposed when the window closes", async () => {
    server();
    const { unmount } = mount();
    await trendDrawn();
    const charts = [...fake.charts];
    unmount();
    expect(charts.length).toBe(2);
    for (const c of charts) expect(c.dispose).toHaveBeenCalledTimes(1);
  });
});

describe("panel and command", () => {
  test("Validation is an integrated, unsaved window that needs no scenario", () => {
    registerValidationPanel();
    const def = getPanelDef(VALIDATION_KIND)!;
    expect(def).toMatchObject({ type: "integrated", persist: false, scenarioBound: false, singleton: true });
    expect(def.component).toBe(Validation);
    expect(def.title({})).toBe("Validation");
    expect(labels["window.validation"].source).toBe("ours");
  });

  test("analysis.validation opens the window once the workspace is there, scenario or not", () => {
    const off = registerValidationCommands();
    try {
      expect(isRegistered("analysis.validation")).toBe(true);
      expect(isEnabled("analysis.validation")).toBe(false); // ยังไม่มีพื้นที่ทำงาน
      const openPanel = vi.fn(() => "validation");
      useLayout.setState({ api: {} as never, openPanel });
      expect(isEnabled("analysis.validation")).toBe(true);
      expect(commandTooltip("analysis.validation")).toBeUndefined();
      runCommand("analysis.validation");
      expect(openPanel).toHaveBeenCalledWith(VALIDATION_KIND, {});
    } finally {
      off();
    }
    expect(isRegistered("analysis.validation")).toBe(false);
  });
});
