// หน้าต่าง Access tool (src/windows/AccessTool): Compute / Clear / Remove ผ่าน /access/* พร้อม If-Match, ปุ่มเทาระหว่างมี job ของ scenario,
// ตัวหนา, ช่วงเวลา, Auto Add / Add Timeline, กราฟิก, ปุ่มรายงาน/กราฟ, 412, Select All, Select Object... และคำสั่ง analysis.access / object.access

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Dialogs } from "../../src/chrome/Dialogs";
import { commandTooltip, isEnabled, isRegistered, runCommand } from "../../src/commands";
import { labels, t } from "../../src/labels/labels";
import { msg } from "../../src/labels/messages.th";
import { getPanelDef } from "../../src/layout/panels";
import { useJobs } from "../../src/stores/jobs";
import { useLayout } from "../../src/stores/layout";
import { useMessages } from "../../src/stores/messages";
import { useResults, type ResultsInfo } from "../../src/stores/results";
import { useScenario } from "../../src/stores/scenario";
import { useSelection } from "../../src/stores/selection";
import { AccessTool, registerAccessToolPanel } from "../../src/windows/AccessTool/AccessTool";
import { registerAccessCommands } from "../../src/windows/AccessTool/commands";
import { openReport } from "../../src/windows/Report/Report";
import { makeDoc, openScenario, resetAll, type ScenarioDoc } from "./helpers/chrome";
import { stubFetch, type Call, type Handler } from "./helpers/fake-fetch";

vi.mock("../../src/windows/Report/Report", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/windows/Report/Report")>()),
  openReport: vi.fn(),
}));

const THBK = "*/Facility/THBK";
const KMIT = "*/Facility/KMIT";
const GPS = "*/Constellation/GPS";
const G01 = "*/Satellite/G01";
const G02 = "*/Satellite/G02";
const E11 = "*/Satellite/E11";
const BASE = "/api/scenarios/S1";
const COMPUTE = `POST ${BASE}/access/compute`;
const CLEAR = `POST ${BASE}/access/clear`;
const REMOVE = `POST ${BASE}/access/remove`;
const GRAPHICS = { show: true, static_highlight: false, animate_highlight: false, animate_line: true, color_mode: "object", custom_color: null, inherit: true };

function doc(accesses: unknown[] = []): ScenarioDoc {
  return makeDoc({
    name: "S1",
    objects: [
      { class: "Facility", name: "THBK" },
      { class: "Facility", name: "KMIT" },
      { class: "Constellation", name: "GPS", assigned_objects: [G01, G02] },
      { class: "Satellite", name: "G01" },
      { class: "Satellite", name: "G02" },
      { class: "Satellite", name: "E11" },
    ] as never,
    accesses: accesses as never,
  });
}

function results(status: "current" | "stale" | "missing"): ResultsInfo {
  return {
    ephem: { hash: "h", status: "current", available: [] },
    access: { THBK: { hash: status === "missing" ? null : "a", status, available: [] } },
    error: null,
  };
}

/** server ปลอม: route ของ test + GET doc/tree ที่ resync ใช้หลังเขียน (doc ใหม่ = after, ETag "e2") */
function server(routes: Record<string, Handler>, after: ScenarioDoc = doc()) {
  return stubFetch({
    [`GET ${BASE}`]: { json: after, headers: { ETag: '"e2"' } },
    [`GET ${BASE}/objects`]: { json: { path: "*", class: "Scenario", name: "S1", children: [] } },
    ...routes,
  });
}

const ok = (json: object, status = 200): Handler => ({ status, json, headers: { ETag: '"e2"' } });

let user: ReturnType<typeof userEvent.setup>;

beforeEach(() => {
  resetAll();
  vi.mocked(openReport).mockReset();
  user = userEvent.setup();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mount(from: string | null = THBK) {
  return render(
    <>
      <AccessTool panelId="accessTool" params={{ from }} />
      <Dialogs />
    </>,
  );
}

const button = (key: Parameters<typeof t>[0]) => screen.getByRole("button", { name: t(key) }) as HTMLButtonElement;
const box = (name: string) => screen.getByRole("checkbox", { name }) as HTMLInputElement;
const group = (key: Parameters<typeof t>[0]) => screen.getByRole("group", { name: t(key) });
const lastBody = (calls: Call[], route: string) => calls.filter((c) => `${c.method} ${c.path}` === route).at(-1)?.body;

describe("compute", () => {
  test("compute posts the checked targets with If-Match", async () => {
    openScenario(doc());
    const f = server({ [COMPUTE]: ok({ computed: ["G01"], etag: "e2" }) });
    mount();
    await user.click(box("G01"));
    await user.click(button("access.compute"));
    await waitFor(() => expect(f.count(COMPUTE)).toBe(1));
    const call = f.calls.find((c) => `${c.method} ${c.path}` === COMPUTE)!;
    expect(call.body).toEqual({ from: THBK, to: [G01], time_period: { mode: "object" }, graphics: GRAPHICS, timeline: true });
    expect(call.headers.get("If-Match")).toBe('"e1"');
    // หลังเขียน: doc ใหม่ถูกดึงมา (resync) ไม่ใช้ ETag เก่าเขียนซ้ำ
    await waitFor(() => expect(useScenario.getState().etag).toBe('"e2"'));
  });

  test("a whole constellation is sent as its path", async () => {
    openScenario(doc());
    const f = server({ [COMPUTE]: ok({ computed: ["G01", "G02"], etag: "e2" }) });
    mount();
    await user.click(box("GPS"));
    expect(box("G01").checked).toBe(true);
    expect(box("G02").checked).toBe(true);
    await user.click(button("access.compute"));
    await waitFor(() => expect(f.count(COMPUTE)).toBe(1));
    expect((lastBody(f.calls, COMPUTE) as { to: string[] }).to).toEqual([GPS]);
  });

  test("compute 202 greys the buttons while the job runs", async () => {
    openScenario(doc());
    server({ [COMPUTE]: ok({ job: "j1", etag: "e2" }, 202) }, doc([{ from: THBK, to: [G01], computed: true, timeline: true }]));
    mount();
    await user.click(box("G01"));
    await user.click(button("access.compute"));
    await waitFor(() => expect(button("access.compute").disabled).toBe(true));
    for (const key of ["access.clear", "access.remove", "access.clearAll", "access.removeAll", "access.addTimeline"] as const) expect(button(key).disabled, key).toBe(true);
    expect(useJobs.getState().jobs.j1).toMatchObject({ kind: "analyze", scenario: "S1", state: "queued" });
    expect(screen.getByText("G01").closest("[data-computed]")?.getAttribute("data-computed")).toBe("false");
    act(() => {
      useJobs.getState().onJobEvent({ id: "j1", kind: "analyze", scenario: "S1", state: "succeeded", progress: null });
      useResults.setState({ info: results("current") });
    });
    await waitFor(() => expect(button("access.compute").disabled).toBe(false));
    expect(button("access.clear").disabled).toBe(false);
    await waitFor(() => expect(screen.getByText("G01").closest("[data-computed]")?.getAttribute("data-computed")).toBe("true"));
    expect(screen.getByText("G02").closest("[data-computed]")?.getAttribute("data-computed")).toBe("false");
  });

  test("bold needs current results", () => {
    openScenario(doc([{ from: THBK, to: [GPS], computed: true }]));
    useResults.setState({ info: results("stale") });
    mount();
    expect(screen.getByText("G01").closest("[data-computed]")?.getAttribute("data-computed")).toBe("false");
    act(() => useResults.setState({ info: results("current") }));
    expect(screen.getByText("G01").closest("[data-computed]")?.getAttribute("data-computed")).toBe("true");
    expect(screen.getByText("GPS").closest("[data-computed]")?.getAttribute("data-computed")).toBe("true");
  });

  test("buttons are disabled while any job of the scenario runs", () => {
    openScenario(doc());
    useJobs.getState().onJobEvent({ id: "p1", kind: "propagate", scenario: "S1", state: "running", progress: null });
    useJobs.getState().onJobEvent({ id: "f1", kind: "fetch", scenario: null, state: "running", progress: null });
    mount();
    fireEvent.click(box("G01"));
    expect(button("access.compute").disabled).toBe(true);
    expect(button("access.clearAll").disabled).toBe(true);
    act(() => useJobs.getState().onJobEvent({ id: "p1", kind: "propagate", scenario: "S1", state: "failed", progress: null }));
    expect(button("access.compute").disabled).toBe(false); // job ที่ไม่ผูกกับ scenario (fetch) ไม่ขวาง
  });

  test("nothing ticked or no access-for leaves the selection buttons off", () => {
    openScenario(doc());
    const { unmount } = mount();
    for (const key of ["access.compute", "access.clear", "access.remove", "access.addTimeline"] as const) expect(button(key).disabled, key).toBe(true);
    expect(button("access.clearAll").disabled).toBe(false);
    for (const g of ["access.reports", "access.graphs"] as const) {
      for (const b of within(group(g)).getAllByRole("button")) expect((b as HTMLButtonElement).disabled, g).toBe(true);
    }
    unmount();
    mount(null);
    expect(button("access.clearAll").disabled).toBe(true);
    expect(screen.getByText(msg("access.selectAccessFor"))).toBeTruthy();
  });
});

describe("clear and remove", () => {
  test("clear and remove send the same targets", async () => {
    openScenario(doc());
    const f = server({ [CLEAR]: ok({ cleared: 1, etag: "e2" }), [REMOVE]: ok({ removed: 1, etag: "e3" }) });
    mount();
    await user.click(box("GPS"));
    await user.click(box("E11"));
    await user.click(button("access.clear"));
    await waitFor(() => expect(f.count(CLEAR)).toBe(1));
    expect(lastBody(f.calls, CLEAR)).toEqual({ from: THBK, to: [GPS, E11] });
    await waitFor(() => expect(button("access.remove").disabled).toBe(false));
    await user.click(button("access.remove"));
    await waitFor(() => expect(f.count(REMOVE)).toBe(1));
    expect(lastBody(f.calls, REMOVE)).toEqual({ from: THBK, to: [GPS, E11] });
    expect(f.calls.find((c) => `${c.method} ${c.path}` === REMOVE)!.headers.get("If-Match")).toBe('"e2"');
  });

  test("clear all and remove all send \"all\"", async () => {
    openScenario(doc());
    const f = server({ [CLEAR]: ok({ cleared: 2, etag: "e2" }), [REMOVE]: ok({ removed: 2, etag: "e3" }) });
    mount();
    await user.click(button("access.clearAll"));
    await waitFor(() => expect(f.count(CLEAR)).toBe(1));
    expect(lastBody(f.calls, CLEAR)).toEqual({ from: THBK, to: "all" });
    await waitFor(() => expect(button("access.removeAll").disabled).toBe(false));
    await user.click(button("access.removeAll"));
    await waitFor(() => expect(f.count(REMOVE)).toBe(1));
    expect(lastBody(f.calls, REMOVE)).toEqual({ from: THBK, to: "all" });
  });

  test("nothing matching is an info message, not an error", async () => {
    openScenario(doc());
    const f = server({ [CLEAR]: ok({ cleared: 0, etag: "e1" }), [REMOVE]: ok({ removed: 0, etag: "e1" }) });
    mount();
    await user.click(box("G01"));
    await user.click(button("access.clear"));
    await waitFor(() => expect(useMessages.getState().items.map((m) => [m.level, m.text])).toContainEqual(["info", msg("access.nothingToClear")]));
    await waitFor(() => expect(button("access.remove").disabled).toBe(false));
    await user.click(button("access.remove"));
    await waitFor(() => expect(useMessages.getState().items.map((m) => [m.level, m.text])).toContainEqual(["info", msg("access.nothingToRemove")]));
    expect(useMessages.getState().items.some((m) => m.level === "error")).toBe(false);
    expect(f.count(`GET ${BASE}`)).toBe(0); // ไม่มีอะไรเปลี่ยน: ไม่ดึง doc ใหม่
  });

  test("a satellite's access-for sends one facility-to-satellite request per facility, chaining the ETag", async () => {
    const stored = doc([{ from: KMIT, to: [G01], computed: true }]);
    openScenario(stored);
    let n = 1;
    const compute: Handler = () => {
      n += 1;
      return { json: { computed: ["G01"], etag: `e${n}` }, headers: { ETag: `"e${n}"` } };
    };
    const f = server({ [COMPUTE]: compute, [CLEAR]: ok({ cleared: 1, etag: "e9" }) }, stored);
    mount(G01);
    expect(screen.getAllByRole("checkbox").slice(0, 2).map((b) => b.getAttribute("aria-label"))).toEqual(["THBK", "KMIT"]);
    await user.click(box("THBK"));
    await user.click(box("KMIT"));
    await user.click(button("access.compute"));
    await waitFor(() => expect(f.count(COMPUTE)).toBe(2));
    const computes = f.calls.filter((c) => `${c.method} ${c.path}` === COMPUTE);
    expect(computes.map((c) => (c.body as { from: string; to: string[] }).from)).toEqual([THBK, KMIT]);
    expect(computes.map((c) => (c.body as { to: string[] }).to)).toEqual([[G01], [G01]]);
    expect(computes.map((c) => c.headers.get("If-Match"))).toEqual(['"e1"', '"e2"']);
    await waitFor(() => expect(button("access.clearAll").disabled).toBe(false));
    await user.click(button("access.clearAll"));
    await waitFor(() => expect(f.count(CLEAR)).toBe(1));
    expect(lastBody(f.calls, CLEAR)).toEqual({ from: KMIT, to: [G01] });
  });
});

describe("time period and timeline", () => {
  test("specify time period sends start and stop", async () => {
    openScenario(doc());
    const f = server({ [COMPUTE]: ok({ computed: ["G01"], etag: "e2" }) });
    mount();
    await user.click(box("G01"));
    const start = screen.getByLabelText(t("field.analysisStart")) as HTMLInputElement;
    expect(start.disabled).toBe(true);
    await user.click(screen.getByRole("radio", { name: t("access.specifyTimePeriod") }));
    expect(start.disabled).toBe(false);
    expect(start.value).toBe("12 Nov 2026 00:00:00.000 UTCG");
    await user.clear(start);
    await user.type(start, "12 Nov 2026 06:00:00");
    const stop = screen.getByLabelText(t("field.analysisStop")) as HTMLInputElement;
    await user.clear(stop);
    await user.type(stop, "12 Nov 2026 18:30:00.250");
    await user.click(button("access.compute"));
    await waitFor(() => expect(f.count(COMPUTE)).toBe(1));
    expect((lastBody(f.calls, COMPUTE) as { time_period: unknown }).time_period).toEqual({
      mode: "specify", start: "2026-11-12T06:00:00Z", stop: "2026-11-12T18:30:00.250Z",
    });
  });

  test("an unreadable or reversed period marks the field and blocks Compute", async () => {
    openScenario(doc());
    mount();
    await user.click(box("G01"));
    await user.click(screen.getByRole("radio", { name: t("access.specifyTimePeriod") }));
    const stop = screen.getByLabelText(t("field.analysisStop")) as HTMLInputElement;
    await user.clear(stop);
    await user.type(stop, "11 Nov 2026 00:00:00");
    expect(stop.getAttribute("aria-invalid")).toBe("true");
    expect(button("access.compute").disabled).toBe(true);
    await user.clear(stop);
    await user.type(stop, "garbage");
    expect(stop.getAttribute("aria-invalid")).toBe("true");
    await user.click(screen.getByRole("radio", { name: t("access.useObjectTimePeriod") }));
    expect(button("access.compute").disabled).toBe(false);
  });

  test("auto add to timeline off sends timeline false; Add Timeline computes the selection with timeline true", async () => {
    openScenario(doc());
    const f = server({ [COMPUTE]: ok({ computed: ["G01"], etag: "e2" }) });
    mount();
    await user.click(box("G01"));
    const auto = box(t("access.autoAddToTimeline"));
    expect(auto.checked).toBe(true);
    await user.click(auto);
    await user.click(button("access.compute"));
    await waitFor(() => expect(f.count(COMPUTE)).toBe(1));
    expect((lastBody(f.calls, COMPUTE) as { timeline: boolean }).timeline).toBe(false);
    await waitFor(() => expect(button("access.addTimeline").disabled).toBe(false));
    await user.click(button("access.addTimeline"));
    await waitFor(() => expect(f.count(COMPUTE)).toBe(2));
    // Add Timeline แก้แค่ timeline ของรายการเดิม: ไม่ส่งช่วงเวลาและกราฟิก (server คงค่าเดิม)
    expect(lastBody(f.calls, COMPUTE)).toEqual({ from: THBK, to: [G01], timeline: true });
  });
});

describe("graphics", () => {
  test("graphics options map to the access graphics", async () => {
    openScenario(doc());
    const f = server({ [COMPUTE]: ok({ computed: ["G01"], etag: "e2" }) });
    mount();
    await user.click(box("G01"));
    const g = group("access.animationGraphics");
    await user.click(within(g).getByRole("checkbox", { name: t("ob.show") }));
    await user.click(within(g).getByRole("checkbox", { name: t("access.staticHighlight") }));
    await user.click(within(g).getByRole("checkbox", { name: t("access.animateHighlight") }));
    await user.click(within(g).getByRole("checkbox", { name: t("access.showAnimateLine") }));
    const color = within(g).getByLabelText(t("field.color")) as HTMLInputElement;
    expect(color.disabled).toBe(true);
    await user.click(within(g).getByRole("radio", { name: t("access.useCustomColor") }));
    expect(color.disabled).toBe(false);
    fireEvent.change(color, { target: { value: "#ff8800" } });
    await user.click(within(g).getByRole("checkbox", { name: t("access.inheritSettings") }));
    await user.click(button("access.compute"));
    await waitFor(() => expect(f.count(COMPUTE)).toBe(1));
    expect((lastBody(f.calls, COMPUTE) as { graphics: unknown }).graphics).toEqual({
      show: false, static_highlight: true, animate_highlight: true, animate_line: false, color_mode: "custom", custom_color: "#ff8800", inherit: false,
    });
  });

  test("object colors send no custom color", async () => {
    openScenario(doc());
    const f = server({ [COMPUTE]: ok({ computed: ["G01"], etag: "e2" }) });
    mount();
    await user.click(box("G01"));
    const g = group("access.animationGraphics");
    await user.click(within(g).getByRole("radio", { name: t("access.useCustomColor") }));
    await user.click(within(g).getByRole("radio", { name: t("access.useObjectColors") }));
    await user.click(button("access.compute"));
    await waitFor(() => expect(f.count(COMPUTE)).toBe(1));
    expect((lastBody(f.calls, COMPUTE) as { graphics: { color_mode: string; custom_color: unknown } }).graphics).toMatchObject({ color_mode: "object", custom_color: null });
  });
});

describe("reports, graphs and other buttons", () => {
  test("reports and graphs buttons open windows", async () => {
    openScenario(doc());
    mount();
    await user.click(box("G01"));
    await user.click(within(group("access.reports")).getByRole("button", { name: t("access.accessDots") }));
    expect(openReport).toHaveBeenLastCalledWith({ style: "Access", kind: "report", objects: [`${THBK} ${G01}`], time: { mode: "object" }, dynamic: false });
    await user.click(within(group("access.reports")).getByRole("button", { name: t("access.aerDots") }));
    expect(openReport).toHaveBeenLastCalledWith({ style: "AER", kind: "report", objects: [`${THBK} ${G01}`], time: { mode: "object" }, dynamic: false });
    await user.click(box("E11"));
    await user.click(within(group("access.graphs")).getByRole("button", { name: t("access.accessDots") }));
    expect(openReport).toHaveBeenLastCalledWith({ style: "Access", kind: "graph", objects: [`${THBK} ${G01}`, `${THBK} ${E11}`], time: { mode: "object" }, dynamic: false });
    await user.click(within(group("access.graphs")).getByRole("button", { name: t("access.aerDots") }));
    expect(openReport).toHaveBeenLastCalledWith({ style: "AER", kind: "graph", objects: [`${THBK} ${G01}`, `${THBK} ${E11}`], time: { mode: "object" }, dynamic: false });
    expect(openReport).toHaveBeenCalledTimes(4);
  });

  test("Report & Graph Manager... follows its command", () => {
    openScenario(doc());
    mount();
    expect(button("menu.analysis.reportGraphManager").disabled).toBe(true); // ยังไม่ลงทะเบียน (งานถัดไป)
  });
});

describe("errors", () => {
  test("412 shows the conflict dialog", async () => {
    openScenario(doc());
    const f = server({ [COMPUTE]: { status: 412, json: { code: "PRECONDITION_FAILED", text: "เก่า", field: null, detail: null } } });
    mount();
    await user.click(box("G01"));
    await user.click(button("access.compute"));
    await screen.findByText(msg("conflict.title"));
    expect(useScenario.getState().conflict).toBe(true);
    expect(useMessages.getState().items).toEqual([]); // กล่องเป็นตัวแจ้ง ไม่ลง Message Viewer ซ้ำ
    expect(f.count(`GET ${BASE}`)).toBe(0);
    // กล่องเปิดอยู่ทำให้ส่วนอื่น aria-hidden: หาปุ่มแบบรวมที่ซ่อน
    await waitFor(() => expect((screen.getByRole("button", { name: t("access.compute"), hidden: true }) as HTMLButtonElement).disabled).toBe(false));
  });

  test("other failures go to the Message Viewer in Thai", async () => {
    openScenario(doc());
    server({ [COMPUTE]: { status: 422, json: { code: "SCENARIO_INVALID", text: "ไม่พบ object", field: "to", detail: null } } });
    mount();
    await user.click(box("G01"));
    await user.click(button("access.compute"));
    await waitFor(() => expect(useMessages.getState().items.map((m) => [m.level, m.code])).toContainEqual(["error", "SCENARIO_INVALID"]));
    expect(useMessages.getState().items[0].text).toBe(msg("access.failed", { message: "ไม่พบ object" }));
  });
});

describe("associated objects", () => {
  test("select all from the context menu", async () => {
    openScenario(doc());
    mount();
    await user.pointer({ keys: "[MouseRight]", target: screen.getByText("E11") });
    await user.click(await screen.findByRole("menuitem", { name: t("access.selectAll") }));
    for (const name of ["GPS", "G01", "G02", "E11"]) expect(box(name).checked, name).toBe(true);
  });

  test("a partly ticked constellation is indeterminate, and unticking it clears its members", async () => {
    openScenario(doc());
    mount();
    await user.click(box("G01"));
    expect(box("GPS").indeterminate).toBe(true);
    expect(box("GPS").checked).toBe(false);
    await user.click(box("G02"));
    expect(box("GPS").checked).toBe(true);
    await user.click(box("GPS"));
    expect(box("G01").checked).toBe(false);
    expect(box("G02").checked).toBe(false);
  });

  test("access for shows the object and changing it clears the ticks", async () => {
    openScenario(doc());
    const { rerender } = mount();
    expect((screen.getByLabelText(t("access.accessFor")) as HTMLInputElement).value).toBe("Facility/THBK");
    await user.click(box("G01"));
    rerender(
      <>
        <AccessTool panelId="accessTool" params={{ from: G01 }} />
        <Dialogs />
      </>,
    );
    expect((screen.getByLabelText(t("access.accessFor")) as HTMLInputElement).value).toBe("Satellite/G01");
    expect(box("THBK").checked).toBe(false);
  });

  test("Select Object... lists facilities and satellites and reopens the tool for the choice", async () => {
    openScenario(doc());
    const openPanel = vi.fn(() => "accessTool");
    useLayout.setState({ openPanel });
    mount();
    await user.click(button("access.selectObject"));
    const dialog = await screen.findByRole("dialog");
    const options = within(dialog).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["THBK", "KMIT", "G01", "G02", "E11"]);
    await user.selectOptions(within(dialog).getByRole("listbox"), KMIT);
    await user.click(within(dialog).getByRole("button", { name: t("dialog.ok") }));
    expect(openPanel).toHaveBeenCalledWith("accessTool", { from: KMIT });
  });
});

describe("panel and commands", () => {
  test("the panel is a floating, scenario-bound, unsaved Access window", () => {
    registerAccessToolPanel();
    const def = getPanelDef("accessTool")!;
    expect(def).toMatchObject({ type: "floating", size: { width: 640, height: 560 }, persist: false, scenarioBound: true, singleton: true });
    expect(def.title({ from: THBK })).toBe(t("toolbar.access"));
  });

  test("analysis.access opens the tool for the selected facility or satellite", () => {
    const dispose = registerAccessCommands();
    try {
      expect(isRegistered("analysis.access")).toBe(true);
      expect(isEnabled("analysis.access")).toBe(false);
      expect(commandTooltip("analysis.access")).toBe(msg("tooltip.noScenario"));
      openScenario(doc());
      const openPanel = vi.fn(() => "accessTool");
      useLayout.setState({ api: {} as never, openPanel });
      expect(isEnabled("analysis.access")).toBe(true);
      expect(commandTooltip("analysis.access")).toBeUndefined();
      useSelection.getState().select(G01);
      runCommand("analysis.access");
      expect(openPanel).toHaveBeenLastCalledWith("accessTool", { from: G01 });
      useSelection.getState().select(GPS);
      runCommand("analysis.access");
      expect(openPanel).toHaveBeenLastCalledWith("accessTool", {}); // ไม่ใช่ Facility/Satellite: ไม่เปลี่ยน Access For ของหน้าต่างที่เปิดอยู่
    } finally {
      dispose();
    }
    expect(isRegistered("analysis.access")).toBe(false);
  });

  test("object.access is enabled only for a facility or a satellite", () => {
    const dispose = registerAccessCommands();
    try {
      openScenario(doc());
      const openPanel = vi.fn(() => "accessTool");
      useLayout.setState({ api: {} as never, openPanel });
      useSelection.getState().select(GPS);
      expect(isEnabled("object.access")).toBe(false);
      expect(commandTooltip("object.access")).toBe(msg("access.forFacilityOrSatellite"));
      useSelection.getState().select(THBK);
      expect(isEnabled("object.access")).toBe(true);
      expect(commandTooltip("object.access")).toBeUndefined();
      runCommand("object.access");
      expect(openPanel).toHaveBeenLastCalledWith("accessTool", { from: THBK });
      useSelection.getState().select("*/Facility/GONE");
      expect(isEnabled("object.access")).toBe(false);
    } finally {
      dispose();
    }
  });

  test("labels of the Access tool", () => {
    for (const [k, text] of [["access.accessFor", "Access For"], ["access.selectObject", "Select Object..."], ["access.associatedObjects", "Associated Objects"],
        ["access.compute", "Compute"], ["access.clear", "Clear"], ["access.clearAll", "Clear All"], ["access.remove", "Remove"], ["access.removeAll", "Remove All"],
        ["access.useObjectTimePeriod", "Use Object Time Period"], ["access.specifyTimePeriod", "Specify Time Period"], ["access.aerDots", "AER..."],
        ["access.addTimeline", "Add Timeline"], ["access.autoAddToTimeline", "Auto Add to Timeline"], ["access.staticHighlight", "Static Highlight"],
        ["access.animateHighlight", "Animate Highlight"], ["access.showAnimateLine", "Show Animate Line"], ["access.useObjectColors", "Use Object Colors"],
        ["access.useCustomColor", "Use Custom Color"], ["access.reports", "Reports"], ["access.graphs", "Graphs"], ["access.accessDots", "Access..."]] as const) {
      expect(labels[k], k).toEqual({ text, source: "stk", ref: "STK ref §F" });
    }
    for (const [k, text] of [["access.inheritSettings", "Inherit Settings from Scenario"], ["access.selectAll", "Select All"], ["access.timePeriod", "Time Period"],
        ["access.animationGraphics", "Animation Graphics"]] as const) {
      expect(labels[k], k).toEqual({ text, source: "ours" });
    }
  });
});
