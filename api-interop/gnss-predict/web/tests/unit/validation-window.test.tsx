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
import { loadECharts } from "../../src/windows/Graph/chart";
import { registerValidationCommands, VALIDATION_KIND } from "../../src/windows/Validation/commands";
import { AGE_DAYS_LIMIT } from "../../src/windows/Validation/rows";
import { registerValidationPanel, Validation } from "../../src/windows/Validation/Validation";
import { makeDoc, openScenario, resetAll } from "./helpers/chrome";
import { deferred, stubFetch, type Handler } from "./helpers/fake-fetch";

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
/** PRN ของทุกจุดในกราฟอายุ (option เต็มล่าสุด) */
const agePrns = (c: FakeChart): string[] => ((fullOption(c).series as AnyObj[]).flatMap((s) => s.data) as [number, number, string][]).map((p) => p[2]).sort();

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
const NOT_FOUND = { status: 404, json: { code: "NOT_FOUND", text: "ไม่พบผลการตรวจสอบของ scenario และวันที่นี้", field: null, detail: null } };

function server(over: Record<string, Handler> = {}) {
  return stubFetch({
    [HISTORY_ROUTE]: { json: HISTORY },
    [PENDING_ROUTE]: { json: PENDING },
    [DAY_10]: { json: DOC_10 },
    [DAY_09]: { json: DOC_09 },
    ...over,
  });
}

/** ประวัติ n วัน (วันใหม่สุดคือ 2026-12-31 ย้อนไป) ของ scenario E2E ทุกวันผ่าน และเอกสารรายวันของแต่ละวันมีดาวหนึ่งดวง */
function manyDays(n: number) {
  const days = Array.from({ length: n }, (_, i) => new Date(Date.UTC(2026, 11, 31) - i * 86_400_000).toISOString().slice(0, 10));
  const history = days.map((day) => ({
    day, scenario: "E2E", ephem_hash: "h", truth_file: "T.SP3", pass: true, systems: { G: stats(0.01, 0.1, 0.02, 0.3) }, failing: [], created_utc: `${day}T03:00:00Z`,
  }));
  const routes: Record<string, Handler> = {};
  for (const day of days) routes[`GET /api/validation/E2E/${day}`] = { json: { day, satellites: { [`G${day.slice(-2)}`]: sat({ age_days: Number(day.slice(-2)) / 10, d3_median_km: 0.01 }) } } };
  return { days, history, routes };
}

let user: ReturnType<typeof userEvent.setup>;

beforeEach(() => {
  resetAll();
  fake.charts.length = 0;
  fake.fail = false;
  vi.mocked(loadECharts).mockClear();
  user = userEvent.setup();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const mount = () => render(<Validation panelId="validation" params={{}} />);
const daily = () => screen.findByRole("grid", { name: t("validation.dailyTable") });
const sats = () => screen.findByRole("table", { name: t("validation.satTable") });
const rowOf = (table: HTMLElement, text: string): HTMLElement =>
  within(table).getAllByRole("row").find((r) => r.textContent?.includes(text))!;
const cells = (row: HTMLElement): string[] => [...row.querySelectorAll("td")].map((c) => c.textContent ?? "");
const headers = (table: HTMLElement): string[] => within(table).getAllByRole("columnheader").map((h) => h.textContent ?? "");
const bodyRows = (table: HTMLElement): HTMLElement[] => within(table).getAllByRole("row").slice(1);
const FAILED = ` ✗ ${t("validation.failed")}`;

describe("daily table", () => {
  test("empty history explains when data comes, and does not even ask for ECharts", async () => {
    const f = server({ [HISTORY_ROUTE]: { json: [] }, [PENDING_ROUTE]: { json: [] } });
    mount();
    expect(await screen.findByText(msg("validation.empty"))).toBeTruthy();
    expect(screen.queryByRole("grid")).toBeNull();
    // ไม่มีวันให้ดึงผลรายดวง และไม่เรียกอะไรนอกจากสองรายการ
    expect(f.calls.map((c) => `${c.method} ${c.path}`).sort()).toEqual([HISTORY_ROUTE, PENDING_ROUTE]);
    await act(async () => {});
    expect(loadECharts).not.toHaveBeenCalled();
  });

  test("lists the days newest first, Day, Scenario, Result and Failing up front so a narrow pane still shows the verdict", async () => {
    server();
    mount();
    const table = await daily();
    expect(headers(table)).toEqual([
      t("validation.col.day"), t("validation.col.scenario"), t("validation.col.result"), t("validation.col.failing"), t("validation.col.truth"),
      t("validation.col.systemStats", { system: "GPS", metric: t("validation.metric.el") }),
      t("validation.col.systemStats", { system: "Galileo", metric: t("validation.metric.el") }),
    ]);
    expect(bodyRows(table).map((r) => cells(r).slice(0, 2))).toEqual([
      ["2026-11-11", "daily_20261111"], ["2026-11-10", "E2E"], ["2026-11-09", "E2E"], ["2026-11-08", "daily_20261108"],
    ]);
    // ระบบที่ไม่ผ่านมีเครื่องหมาย ✗ และข้อความที่ซ่อนไว้สำหรับโปรแกรมอ่านจอ (ไม่ใช่แค่สีแดง) ระบบที่ผ่านไม่มี
    expect(cells(rowOf(table, "2026-11-10"))).toEqual([
      "2026-11-10", "E2E", t("validation.result.fail"), "G22", "COD0MGXFIN_20263140000_01D_05M_ORB.SP3", `0.030 / 0.310${FAILED}`, "0.013 / 0.130",
    ]);
    expect(rowOf(table, "2026-11-10").querySelector(".sr-only")?.textContent).toBe(` ${t("validation.failed")}`);
    expect(cells(rowOf(table, "2026-11-09"))[2]).toBe(t("validation.result.pass"));
    expect(cells(rowOf(table, "2026-11-09"))[3]).toBe("");
    expect(cells(rowOf(table, "daily_20261108"))[2]).toContain(t("validation.result.gaveUp"));
    expect(cells(rowOf(table, "daily_20261111"))[2]).toContain(t("validation.result.pending"));
    // ชื่อไฟล์ SP3 ที่ตัดด้วย ... ในจอ ยังอ่านเต็มได้จาก title
    expect(within(rowOf(table, "2026-11-10")).getByText("COD0MGXFIN_20263140000_01D_05M_ORB.SP3").getAttribute("title")).toBe("COD0MGXFIN_20263140000_01D_05M_ORB.SP3");
  });

  test("both scrolling areas are regions a keyboard user can focus", async () => {
    server();
    mount();
    const table = await daily();
    const region = screen.getByRole("region", { name: t("validation.dailyTable") });
    expect(region.tabIndex).toBe(0);
    expect(region.contains(table)).toBe(true);
    await user.click(rowOf(table, "2026-11-10"));
    const satTable = await sats();
    const satRegion = screen.getByRole("region", { name: t("validation.satTable") });
    expect(satRegion.tabIndex).toBe(0);
    expect(satRegion.contains(satTable)).toBe(true);
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
    expect(headers(table)[5]).toBe(t("validation.col.systemStats", { system: "GPS", metric: t("validation.metric.az") }));
    expect(cells(rowOf(table, "2026-11-10"))[5]).toBe(`0.040 / 0.610${FAILED}`);
  });

  test("pending row shows the next attempt time in the scenario's DateFormat", async () => {
    openScenario(makeDoc({ units: { date_format: "LTZG", ltz_offset: "+07:00" } }));
    server();
    mount();
    const table = await daily();
    const next = new Date("2026-11-12T06:00:00Z");
    const local = formatTime(next, "LTZG", "+07:00");
    expect(local).not.toBe(formatTime(next, "UTCG", "+07:00")); // test ไม่ว่างเปล่า: สองรูปแบบต่างกันจริง
    expect(cells(rowOf(table, "daily_20261111"))[2]).toContain(msg("validation.nextAttempt", { time: local }));
    expect(cells(rowOf(table, "daily_20261108"))[2]).not.toContain(msg("validation.nextAttempt", { time: "" }));
  });

  test("a gave-up day says so in visible text in the Result cell (the title only repeats it longer)", async () => {
    server();
    mount();
    const table = await daily();
    const gaveUp = rowOf(table, "daily_20261108");
    expect(cells(gaveUp)[2]).toBe(`${t("validation.result.gaveUp")} ${msg("validation.gaveUpShort")}`);
    expect(gaveUp.getAttribute("title")).toBe(msg("validation.gaveUp"));
  });

  test("without a scenario the next attempt is in UTCG", async () => {
    server();
    mount();
    const table = await daily();
    expect(cells(rowOf(table, "daily_20261111"))[2]).toContain(formatTime(new Date("2026-11-12T06:00:00Z"), "UTCG", "+07:00"));
  });

  test("a pending day with no retry planned says so instead of a time", async () => {
    server({ [PENDING_ROUTE]: { json: [{ ...PENDING[0], next_attempt_utc: null }] } });
    mount();
    const table = await daily();
    expect(cells(rowOf(table, "daily_20261111"))[2]).toContain(msg("validation.noRetry"));
    // null มีสองเหตุ (งานประจำวันปิด หรือเลยกำหนดเลิกลองหลังตรวจล้ม: server e1cac5a) ข้อความจึงไม่อ้างเหตุใดเหตุหนึ่ง
    expect(msg("validation.noRetry")).toBe("ไม่มีรอบลองถัดไป");
    expect(msg("validation.noRetry")).not.toContain("งานประจำวัน");
  });

  test("pending and gave-up days cannot be opened by click or key, fetch nothing and are not highlighted as clickable", async () => {
    const f = server();
    mount();
    const table = await daily();
    const before = f.calls.length;
    for (const name of ["daily_20261111", "daily_20261108"]) {
      const row = rowOf(table, name);
      expect(row.classList.contains("val-open")).toBe(false);
      await user.click(row);
      row.focus();
      await user.keyboard("{Enter}{ }");
    }
    expect(screen.queryByRole("table", { name: t("validation.satTable") })).toBeNull();
    expect(rowOf(table, "2026-11-10").classList.contains("val-open")).toBe(true);
    expect(within(table).queryByRole("button")).toBeNull();
    expect(f.calls.slice(before).filter((c) => c.path.includes("daily_2026"))).toEqual([]);
  });
});

describe("keyboard and click on the daily list", () => {
  /** Tab จนถึงแถวที่เป็นจุดหยุดเดียวของตาราง (กี่ครั้งก็ได้ แต่ต้องเจอ) */
  async function tabToTheList(): Promise<HTMLElement> {
    for (let i = 0; i < 10; i++) {
      await user.tab();
      const active = document.activeElement as HTMLElement | null;
      if (active?.tagName === "TR") return active;
    }
    throw new Error("the list was never reached with Tab");
  }
  const day = (row: Element | null): string => row?.querySelector("td")?.textContent ?? "";

  test("a keyboard-only walk: one tab stop, arrows, Home and End move, Enter and Space open a Pass or Fail day", async () => {
    const f = server();
    mount();
    const table = await daily();

    // หนึ่งจุดหยุดในตารางทั้งตาราง (roving tabindex) แถวแรกก่อนเลือกอะไร
    expect(bodyRows(table).filter((r) => r.tabIndex === 0)).toHaveLength(1);
    const first = await tabToTheList();
    expect(day(first)).toBe("2026-11-11"); // Pending: ถึงได้ (อ่านเวลาลองครั้งถัดไป) แต่เปิดไม่ได้
    await user.keyboard("{Enter}");
    expect(screen.queryByRole("table", { name: t("validation.satTable") })).toBeNull();

    await user.keyboard("{ArrowDown}");
    expect(day(document.activeElement)).toBe("2026-11-10");
    expect(rowOf(table, "2026-11-10").tabIndex).toBe(0);
    expect(first.tabIndex).toBe(-1);
    await user.keyboard("{Enter}");
    const satTable = await sats();
    expect(within(satTable).getAllByRole("row").slice(1).map((r) => cells(r)[0])).toEqual(["G01", "G22", "R03", "E05"]);
    expect(rowOf(table, "2026-11-10").getAttribute("aria-current")).toBe("true");
    expect(rowOf(table, "2026-11-10").hasAttribute("aria-pressed")).toBe(false);
    expect(bodyRows(table).filter((r) => r.hasAttribute("aria-current"))).toHaveLength(1);

    await user.keyboard("{ArrowDown}");
    expect(day(document.activeElement)).toBe("2026-11-09");
    await user.keyboard("{ }");
    await waitFor(() => expect(within(screen.getByRole("table", { name: t("validation.satTable") })).getAllByRole("row").slice(1).map((r) => cells(r)[0])).toEqual(["G01", "C06"]));
    expect(rowOf(table, "2026-11-09").getAttribute("aria-current")).toBe("true");
    expect(rowOf(table, "2026-11-10").hasAttribute("aria-current")).toBe(false);

    await user.keyboard("{End}");
    expect(day(document.activeElement)).toBe("2026-11-08");
    await user.keyboard("{ArrowDown}"); // ไม่เลยปลายรายการ
    expect(day(document.activeElement)).toBe("2026-11-08");
    await user.keyboard("{Home}");
    expect(day(document.activeElement)).toBe("2026-11-11");
    await user.keyboard("{ArrowUp}");
    expect(day(document.activeElement)).toBe("2026-11-11");
    // ลูกศรไม่เลือกวัน: ตารางรายดวงยังเป็นของ 2026-11-09
    expect(rowOf(table, "2026-11-09").getAttribute("aria-current")).toBe("true");
    // การเดินด้วยคีย์ไม่เรียก /validate หรือ /daily/run
    expect(f.calls.every((c) => c.method === "GET")).toBe(true);
  });

  test("a click anywhere on an openable row opens the day", async () => {
    server();
    mount();
    const table = await daily();
    const row = rowOf(table, "2026-11-10");
    await user.click(row.querySelectorAll("td")[2]); // เซลล์ Result ไม่ใช่เซลล์ของวัน
    const satTable = await sats();
    expect(satTable).toBeTruthy();
    expect(row.getAttribute("aria-current")).toBe("true");
  });
});

describe("a day's satellites", () => {
  test("click a day loads its satellites", async () => {
    const f = server();
    mount();
    const table = await daily();
    expect(screen.queryByRole("table", { name: t("validation.satTable") })).toBeNull();
    expect(screen.getByText(msg("validation.selectDay"))).toBeTruthy();
    await user.click(rowOf(table, "2026-11-10"));
    const satTable = await sats();
    expect(f.calls.some((c) => `${c.method} ${c.path}` === DAY_10)).toBe(true);
    expect(headers(satTable)).toEqual(["PRN", "Truth", "Pairs", "ΔEl med/P99", "ΔAz med/P99", "3D med/max (km)", "Age", "Result"]);
    // ลำดับระบบ G R E C เหมือนทั้งหน้า (ไม่ใช่ตามตัวอักษร)
    expect(bodyRows(satTable).map((r) => cells(r)[0])).toEqual(["G01", "G22", "R03", "E05"]);
    expect(cells(rowOf(satTable, "G22"))).toEqual(["G22", "sp3", "800", "0.030 / 0.310", "0.040 / 0.610", "0.052 / 0.400", "1.50", t("validation.result.fail")]);
    expect(cells(rowOf(satTable, "R03"))).toEqual(["R03", "unverified", "0", "—", "—", "—", "—", t("validation.result.unverified")]);
    expect(cells(rowOf(satTable, "E05"))[1]).toBe("brdc");
    expect(rowOf(table, "2026-11-10").getAttribute("aria-current")).toBe("true");
    // ผลวันเดียวกันไม่ถูกดึงซ้ำ (ตัวโหลดของกราฟอายุใช้ที่เก็บเดียวกัน)
    expect(f.calls.filter((c) => `${c.method} ${c.path}` === DAY_10)).toHaveLength(1);
  });

  test("filters by system and by result", async () => {
    server();
    mount();
    const table = await daily();
    await user.click(rowOf(table, "2026-11-10"));
    const satTable = await sats();
    const names = () => bodyRows(satTable).map((r) => cells(r)[0]);

    const system = screen.getByRole("combobox", { name: t("validation.filter.system") });
    // ตัวเลือกของระบบมีเฉพาะที่อยู่ในผลของวันนี้ (G, R, E) ตามลำดับ G R E C และ All
    expect(within(system).getAllByRole("option").map((o) => o.textContent)).toEqual([t("validation.filter.all"), "GPS", "GLONASS", "Galileo"]);
    await user.selectOptions(system, "G");
    expect(names()).toEqual(["G01", "G22"]);
    await user.selectOptions(screen.getByRole("combobox", { name: t("validation.filter.result") }), "fail");
    expect(names()).toEqual(["G22"]);
    await user.selectOptions(system, t("validation.filter.all"));
    expect(names()).toEqual(["G22", "E05"]);
    await user.selectOptions(screen.getByRole("combobox", { name: t("validation.filter.result") }), "unverified");
    expect(names()).toEqual(["R03"]);
    await user.selectOptions(screen.getByRole("combobox", { name: t("validation.filter.result") }), "pass");
    expect(names()).toEqual(["G01"]);
    await user.selectOptions(system, "R");
    expect(screen.getByText(msg("validation.noMatch"))).toBeTruthy();
  });

  test("a day whose result file is gone says why, and the other day still opens", async () => {
    server({ [DAY_10]: NOT_FOUND });
    mount();
    const table = await daily();
    await user.click(rowOf(table, "2026-11-10"));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(msg("validation.dayFailed", { scenario: "E2E", day: "2026-11-10", message: "ไม่พบผลการตรวจสอบของ scenario และวันที่นี้" }));
    await user.click(rowOf(table, "2026-11-09"));
    const satTable = await sats();
    expect(bodyRows(satTable).map((r) => cells(r)[0])).toEqual(["G01", "C06"]);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("clicking the already selected day after an error tries it again", async () => {
    let fixed = false;
    const f = server({ [DAY_10]: () => (fixed ? { json: DOC_10 } : NOT_FOUND) });
    mount();
    const table = await daily();
    await user.click(rowOf(table, "2026-11-10"));
    await screen.findByRole("alert");
    expect(screen.queryByRole("table", { name: t("validation.satTable") })).toBeNull();
    fixed = true;
    const before = f.count(DAY_10);
    await user.click(rowOf(table, "2026-11-10"));
    const satTable = await sats();
    expect(bodyRows(satTable)).toHaveLength(4);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(f.count(DAY_10)).toBe(before + 1);
    // และเมื่อไม่มีข้อผิดพลาด การคลิกวันที่เลือกอยู่แล้วไม่ดึงซ้ำ
    await user.click(rowOf(table, "2026-11-10"));
    expect(f.count(DAY_10)).toBe(before + 1);
  });

  test("a result file that is not a JSON object is reported as unreadable", async () => {
    server({ [DAY_10]: { json: [] } });
    mount();
    const table = await daily();
    await user.click(rowOf(table, "2026-11-10"));
    expect((await screen.findByRole("alert")).textContent).toBe(msg("validation.dayFailed", { scenario: "E2E", day: "2026-11-10", message: msg("validation.dayInvalid") }));
  });
});

describe("loading", () => {
  test("a failed history load shows an alert, and Refresh tries again", async () => {
    let attempts = 0;
    const f = server({ [HISTORY_ROUTE]: () => (++attempts === 1 ? { status: 500, json: { code: "INTERNAL", text: "พัง", field: null, detail: null } } : { json: HISTORY }) });
    mount();
    expect((await screen.findByRole("alert")).textContent).toBe(msg("validation.loadFailed", { message: "พัง" }));
    expect(screen.queryByRole("grid")).toBeNull();
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
    expect(bodyRows(table).map((r) => cells(r)[0])).toEqual(["2026-11-10", "2026-11-09"]);
  });

  test("Refresh reloads both lists", async () => {
    const f = server();
    mount();
    await daily();
    await user.click(screen.getByRole("button", { name: t("report.refresh") }));
    await waitFor(() => expect(f.count(HISTORY_ROUTE)).toBe(2));
    expect(f.count(PENDING_ROUTE)).toBe(2);
  });

  test("a validation job that finishes reloads the lists: the Pending day becomes a Pass, and only GETs were sent", async () => {
    let validated = false;
    const done = {
      day: "2026-11-11", scenario: "daily_20261111", ephem_hash: "ccc333", truth_file: "COD0MGXFIN_20263150000_01D_05M_ORB.SP3", pass: true,
      systems: { G: stats(0.01, 0.1, 0.02, 0.3) }, failing: [], created_utc: "2026-11-14T03:00:00Z",
    };
    const f = server({
      [HISTORY_ROUTE]: () => ({ json: validated ? [...HISTORY, done] : HISTORY }),
      [PENDING_ROUTE]: () => ({ json: validated ? [PENDING[1]] : PENDING }),
      "GET /api/validation/daily_20261111/2026-11-11": { json: { day: "2026-11-11", satellites: {} } },
    });
    mount();
    const table = await daily();
    expect(cells(rowOf(table, "daily_20261111"))[2]).toContain(t("validation.result.pending"));
    const job = { id: "j1", kind: "validate" as const, scenario: "daily_20261111", progress: { stage: null, fraction: null } };
    act(() => useJobs.getState().onJobEvent({ ...job, state: "running" }));
    expect(f.count(HISTORY_ROUTE)).toBe(1);
    validated = true;
    act(() => useJobs.getState().onJobEvent({ ...job, state: "succeeded" }));
    await waitFor(() => expect(f.count(HISTORY_ROUTE)).toBe(2));
    await waitFor(() => expect(cells(rowOf(table, "daily_20261111"))[2]).toBe(t("validation.result.pass")));
    expect(f.count(PENDING_ROUTE)).toBe(2);
    // งานชนิดอื่นไม่ทำให้โหลดใหม่
    act(() => useJobs.getState().onJobEvent({ id: "j2", kind: "analyze", scenario: "E2E", state: "succeeded", progress: { stage: null, fraction: null } }));
    await act(async () => {});
    expect(f.count(HISTORY_ROUTE)).toBe(2);
    // เปิดหน้านี้ ตรวจ และโหลดใหม่ ไม่ส่งอะไรนอกจาก GET (ไม่เรียก /validate หรือ /daily/run)
    expect(f.calls.every((c) => c.method === "GET")).toBe(true);
    expect(f.calls.some((c) => /\/validate$|\/daily\/run$/.test(c.path))).toBe(false);
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
    await waitFor(() => expect(agePrns(chartOf("age")!)).toEqual(["C06", "E05", "G01", "G01", "G22"]));
    // ทุกวันที่ตรวจแล้วดึงครั้งเดียว วันที่ยังรอไม่ถูกดึง
    expect(f.count(DAY_10)).toBe(1);
    expect(f.count(DAY_09)).toBe(1);
  });

  test("the age chart has a text summary and says how many days it reads at most", async () => {
    server();
    mount();
    await daily();
    // 5 ดวง 2 วัน อายุ 0.25 0.5 1.5 3.25 6.5 → ค่ากลาง 1.5
    const summary = t("validation.ageSummary", { points: 5, days: 2, age: "1.50" });
    await waitFor(() => expect(screen.getByText(new RegExp(summary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))).toBeTruthy());
    expect(screen.getByText(new RegExp(t("validation.ageLimit", { n: AGE_DAYS_LIMIT })))).toBeTruthy();
    expect(screen.getByRole("img", { name: new RegExp(`${t("validation.ageTitle")}.*${summary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) })).toBeTruthy();
  });

  test("a day whose file is missing is left out of the age chart without an alert", async () => {
    server({ [DAY_10]: NOT_FOUND });
    mount();
    await daily();
    await waitFor(() => expect(agePrns(chartOf("age")!)).toEqual(["C06", "G01"]));
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

  test("Refresh after the chart library failed to load tries to load it again and draws the charts", async () => {
    fake.fail = true;
    server();
    mount();
    await daily();
    await screen.findByRole("alert");
    expect(chartOf("trend")).toBeUndefined();
    fake.fail = false;
    await user.click(screen.getByRole("button", { name: t("report.refresh") }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    await trendDrawn();
    expect(vi.mocked(loadECharts).mock.calls.length).toBeGreaterThanOrEqual(2);
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

describe("loading every day for the age chart", () => {
  test("more days than one batch all arrive, at most 8 at a time, and the chart is drawn a few times, not once per day", async () => {
    const { days, history, routes } = manyDays(30);
    let inFlight = 0;
    let peak = 0;
    const handlers: Record<string, Handler> = {};
    for (const [route, reply] of Object.entries(routes)) {
      handlers[route] = async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return reply as { json: unknown };
      };
    }
    const f = server({ [HISTORY_ROUTE]: { json: history }, [PENDING_ROUTE]: { json: [] }, ...handlers });
    mount();
    await daily();
    await waitFor(() => expect(agePrns(chartOf("age")!)).toHaveLength(30));
    expect(f.calls.filter((c) => c.path.startsWith("/api/validation/E2E/"))).toHaveLength(30);
    expect(new Set(f.calls.map((c) => c.path)).size).toBe(30 + 2); // 30 วัน + สองรายการ ไม่ซ้ำ
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(8);
    // วาดไม่เกินสองสามครั้ง (เริ่มต้นว่าง + ตอนจบ + อาจมีหนึ่งครั้งระหว่างทาง) ไม่ใช่ 30 ครั้ง
    expect(chartOf("age")!.options.length).toBeLessThanOrEqual(4);
    expect(days).toHaveLength(30);
  });

  test("only the most recent 180 days are read, and the subtitle says so", async () => {
    const { days, history, routes } = manyDays(200);
    const f = server({ [HISTORY_ROUTE]: { json: history }, [PENDING_ROUTE]: { json: [] }, ...routes });
    mount();
    await daily();
    await waitFor(() => expect(agePrns(chartOf("age")!)).toHaveLength(AGE_DAYS_LIMIT));
    const asked = f.calls.filter((c) => c.path.startsWith("/api/validation/E2E/")).map((c) => c.path.slice(-10)).sort();
    expect(asked).toEqual(days.slice(0, AGE_DAYS_LIMIT).sort());
    expect(screen.getByText(new RegExp(t("validation.ageLimited", { n: AGE_DAYS_LIMIT, total: 200 })))).toBeTruthy();
    // วันที่เก่ากว่านั้นยังเปิดดูรายดวงได้เมื่อคลิก
    const table = await daily();
    await user.click(rowOf(table, days[199]));
    await sats();
    expect(f.calls.filter((c) => c.path.endsWith(days[199]))).toHaveLength(1);
  });

  test("closing the window mid-load sends no further requests and aborts the ones in flight", async () => {
    const { history, routes } = manyDays(30);
    const hang = deferred<never>();
    const handlers: Record<string, Handler> = {};
    for (const route of Object.keys(routes)) handlers[route] = () => hang.promise;
    const f = server({ [HISTORY_ROUTE]: { json: history }, [PENDING_ROUTE]: { json: [] }, ...handlers });
    const { unmount } = mount();
    await daily();
    await waitFor(() => expect(f.calls.filter((c) => c.path.startsWith("/api/validation/E2E/"))).toHaveLength(8));
    const inFlight = f.fn.mock.calls.filter(([url]) => String(url).includes("/validation/E2E/")).map(([, init]) => (init as RequestInit).signal as AbortSignal);
    expect(inFlight.every((s) => s.aborted === false)).toBe(true);
    unmount();
    expect(inFlight.every((s) => s.aborted)).toBe(true);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(f.calls.filter((c) => c.path.startsWith("/api/validation/E2E/"))).toHaveLength(8);
  });

  test("a day that failed is not asked for again by the age chart until Refresh", async () => {
    const f = server({ [DAY_10]: NOT_FOUND });
    mount();
    await daily();
    await waitFor(() => expect(f.count(DAY_10)).toBe(1));
    await waitFor(() => expect(agePrns(chartOf("age")!)).toEqual(["C06", "G01"]));
    // งานตรวจจบ = โหลดสองรายการใหม่ แต่วันที่ล้มแล้วไม่ถูกถามซ้ำ (วัน 09 ที่สำเร็จก็ไม่ถูกถามซ้ำ)
    const job = { id: "j1", kind: "validate" as const, scenario: "E2E", progress: { stage: null, fraction: null } };
    act(() => useJobs.getState().onJobEvent({ ...job, state: "running" }));
    act(() => useJobs.getState().onJobEvent({ ...job, state: "succeeded" }));
    await waitFor(() => expect(f.count(HISTORY_ROUTE)).toBe(2));
    await act(async () => {});
    expect(f.count(DAY_10)).toBe(1);
    expect(f.count(DAY_09)).toBe(1);
    // Refresh ล้างความจำนี้
    await user.click(screen.getByRole("button", { name: t("report.refresh") }));
    await waitFor(() => expect(f.count(HISTORY_ROUTE)).toBe(3));
    await waitFor(() => expect(f.count(DAY_10)).toBe(2));
  });

  test("reloading keeps the old points on the chart until the new ones are there (no empty chart in between)", async () => {
    const { history, routes } = manyDays(12);
    server({ [HISTORY_ROUTE]: { json: history }, [PENDING_ROUTE]: { json: [] }, ...routes });
    mount();
    await daily();
    await waitFor(() => expect(agePrns(chartOf("age")!)).toHaveLength(12));
    const chart = chartOf("age")!;
    const from = chart.options.length;
    await user.click(screen.getByRole("button", { name: t("report.refresh") }));
    await waitFor(() => expect(chart.options.length).toBeGreaterThan(from));
    await act(async () => {});
    for (const o of chart.options.slice(from)) expect(((o.option.series as AnyObj[]).flatMap((s) => s.data)).length).toBe(12);
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
