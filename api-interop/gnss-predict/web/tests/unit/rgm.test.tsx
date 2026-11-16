// Report & Graph Manager และหน้าต่างแก้ style (src/windows/ReportGraphManager): Object Type, รายชื่อ object, ต้นไม้ style สามชั้น,
// Generate As, กล่องเวลาก่อน Generate, 409 ถามว่าจะ Compute ก่อนไหม, คลิกขวา (.txt/.csv, Copy to My Styles, Delete), New... / Properties...,
// คำสั่ง analysis.reportGraphManager / object.reportGraphManager และปุ่มใน Access tool

import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Dialogs } from "../../src/chrome/Dialogs";
import { commandTooltip, isEnabled, isRegistered, runCommand } from "../../src/commands";
import { downloadReport, type StyleDef } from "../../src/data/reports";
import { t } from "../../src/labels/labels";
import { msg } from "../../src/labels/messages.th";
import { getPanelDef } from "../../src/layout/panels";
import { useJobs } from "../../src/stores/jobs";
import { useLayout } from "../../src/stores/layout";
import { useMessages } from "../../src/stores/messages";
import { useScenario } from "../../src/stores/scenario";
import { useSelection } from "../../src/stores/selection";
import { formatTime } from "../../src/time/format";
import { AccessTool } from "../../src/windows/AccessTool/AccessTool";
import { openReport, primeReport } from "../../src/windows/Report/Report";
import { registerReportGraphManagerCommands, RGM_KIND, STYLE_EDITOR_KIND, useStyleRevision } from "../../src/windows/ReportGraphManager/commands";
import { ReportGraphManager, registerReportGraphManagerPanel } from "../../src/windows/ReportGraphManager/ReportGraphManager";
import { registerStyleEditorPanel, StyleEditor } from "../../src/windows/ReportGraphManager/StyleEditor";
import { makeDoc, openScenario, resetAll, type ScenarioDoc } from "./helpers/chrome";
import { deferred, stubFetch, type Call, type Handler } from "./helpers/fake-fetch";

vi.mock("../../src/windows/Report/Report", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/windows/Report/Report")>();
  return { ...actual, openReport: vi.fn(), primeReport: vi.fn(actual.primeReport) };
});
vi.mock("../../src/data/reports", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/data/reports")>()),
  downloadReport: vi.fn(async () => undefined),
}));

const INSTALLED = JSON.parse(readFileSync(resolve(__dirname, "../../../gnss_predict/styles/installed.json"), "utf8")) as StyleDef[];
const installed = (name: string, kind: "report" | "graph") => INSTALLED.find((s) => s.name === name && s.kind === kind)!;

const THBK = "*/Facility/THBK";
const GPS = "*/Constellation/GPS";
const G01 = "*/Satellite/G01";
const G02 = "*/Satellite/G02";
const E11 = "*/Satellite/E11";
const THBK_G01 = `${THBK} ${G01}`;
const THBK_E11 = `${THBK} ${E11}`;
const BASE = "/api/scenarios/S1";
const REPORTS = `POST ${BASE}/reports`;
const COMPUTE = `POST ${BASE}/access/compute`;
const STYLES = "GET /api/styles";

const MY: StyleDef = { ...installed("AER", "report"), name: "Az El Mine", ours: false };
const SCENARIO_STYLE: StyleDef = { ...installed("Access", "report"), name: "THBK Day" };
/** My Style ที่ไฟล์มีแต่ชื่อ (ไม่มี kind / content): แสดงเป็นใช้ไม่ได้ ไม่ทำให้หน้าต่างล่ม */
const BROKEN = { name: "Broken" };

function doc(over: Partial<ScenarioDoc> = {}): ScenarioDoc {
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
    accesses: [{ from: THBK, to: [GPS], computed: true }, { from: THBK, to: [E11], computed: true }] as never,
    styles: [SCENARIO_STYLE],
    ...over,
  });
}

const stylesReply = (my: unknown[] = [MY, BROKEN], scenario: unknown[] = [SCENARIO_STYLE]): Handler => ({ json: { installed: INSTALLED, my, scenario } });
const reportJson = { scenario: "S1", style: "Access", kind: "report", created: "2026-11-12T00:00:00Z", sections: [], global_statistics: [], graph: null, dynamic: false };

function server(routes: Record<string, Handler> = {}, after: ScenarioDoc = doc()) {
  return stubFetch({
    [STYLES]: stylesReply(),
    [`GET ${BASE}`]: { json: after, headers: { ETag: '"e2"' } },
    [`GET ${BASE}/objects`]: { json: { path: "*", class: "Scenario", name: "S1", children: [] } },
    ...routes,
  });
}

let user: ReturnType<typeof userEvent.setup>;
let opened: { kind: string; params: Record<string, unknown> }[];

beforeEach(() => {
  resetAll();
  vi.mocked(openReport).mockReset();
  vi.mocked(primeReport).mockClear();
  vi.mocked(downloadReport).mockReset();
  vi.mocked(downloadReport).mockResolvedValue(undefined);
  opened = [];
  // พื้นที่ทำงานปลอม: เก็บว่าเปิดหน้าต่างอะไร (ไม่ mount dockview)
  useLayout.setState({
    openPanel: (kind: string, params: Record<string, unknown> = {}) => {
      opened.push({ kind, params });
      return `${kind}-1`;
    },
    closePanel: vi.fn(),
  } as never);
  user = userEvent.setup();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mount(params: Record<string, unknown> = {}) {
  return render(
    <>
      <ReportGraphManager panelId="rgm" params={params} />
      <Dialogs />
    </>,
  );
}

const objectList = () => screen.getByRole("listbox", { name: t("rgm.objects") });
const optionTexts = () => within(objectList()).queryAllByRole("option").map((o) => o.textContent);
const tree = () => screen.getByRole("tree", { name: t("rgm.styles") });
const tier = (key: "rgm.installedStyles" | "rgm.myStyles" | "rgm.scenarioStyles") => within(tree()).getByRole("group", { name: t(key) });
const items = (root: HTMLElement = tree()) => within(root).queryAllByRole("treeitem");
const styleItem = (name: string, kind: "report" | "graph", root: HTMLElement = tree()) =>
  items(root).find((el) => el.dataset.name === name && el.dataset.kind === kind)!;
const setType = (key: Parameters<typeof t>[0]) => user.selectOptions(screen.getByRole("combobox", { name: t("rgm.objectType") }), t(key));
const button = (key: Parameters<typeof t>[0]) => screen.getByRole("button", { name: t(key) }) as HTMLButtonElement;
const lastBody = (calls: Call[], route: string) => calls.filter((c) => `${c.method} ${c.path}` === route).at(-1)?.body;

/** เลือก object ตามชื่อที่แสดง: ตัวแรกคลิกธรรมดา ที่เหลือ Ctrl+คลิก */
async function pick(...names: string[]) {
  for (const [i, name] of names.entries()) {
    const option = within(objectList()).getByRole("option", { name });
    if (i === 0) await user.click(option);
    else {
      await user.keyboard("{Control>}");
      await user.click(option);
      await user.keyboard("{/Control}");
    }
  }
}

async function ready() {
  await waitFor(() => expect(items().length).toBeGreaterThan(0));
}

describe("objects and styles", () => {
  test("object type filters objects and styles", async () => {
    openScenario(doc());
    server();
    mount();
    await ready();
    // All Types: ทุก object ทุก style
    expect(optionTexts()).toEqual(expect.arrayContaining(["THBK-To-G01", "THBK-To-G02", "THBK-To-E11", "THBK", "KMIT", "G01", "E11", "GPS"]));
    expect(items(tier("rgm.installedStyles"))).toHaveLength(14);

    await setType("rgm.typeAccess");
    expect(optionTexts()).toEqual(["THBK-To-G01", "THBK-To-G02", "THBK-To-E11"]);
    expect(items(tier("rgm.installedStyles")).every((el) => ["Access", "AccessSummary", "AER", "Gaps", "IPP Data", "Elevation Angle", "Az El Polar"].includes(el.dataset.name!))).toBe(true);
    expect(styleItem("All DOPs", "report")).toBeUndefined();

    await setType("ob.class.facility");
    expect(optionTexts()).toEqual(["THBK", "KMIT"]);
    expect(items(tier("rgm.installedStyles")).map((el) => el.dataset.name)).toEqual(["All DOPs", "All DOPs", "N Asset Coverage", "N Asset Coverage"]);

    await setType("ob.class.satellite");
    expect(optionTexts()).toEqual(["G01", "G02", "E11"]);
    expect(items(tier("rgm.installedStyles")).map((el) => el.dataset.name)).toEqual(["LLA Position"]);

    await setType("rgm.constellation");
    expect(optionTexts()).toEqual(["GPS"]);
    expect(items()).toHaveLength(0);
    expect(screen.getByText(msg("rgm.noStyles"))).toBeTruthy();
  });

  test("styles tree has three tiers and filters", async () => {
    openScenario(doc());
    const f = server();
    mount();
    await ready();
    expect(f.calls.find((c) => c.path === "/api/styles")?.query.get("scenario")).toBe("S1");
    expect(within(tree()).getAllByRole("group").map((g) => g.getAttribute("aria-label"))).toEqual([t("rgm.installedStyles"), t("rgm.myStyles"), t("rgm.scenarioStyles")]);
    expect(styleItem("Az El Mine", "report", tier("rgm.myStyles"))).toBeDefined();
    expect(styleItem("THBK Day", "report", tier("rgm.scenarioStyles"))).toBeDefined();
    // IPP Data เป็นของเรา: ต่อท้ายชื่อด้วย (GNSS Studio)
    expect(styleItem("IPP Data", "report").textContent).toContain(t("ob.oursMark"));

    // My Style ที่ไฟล์ไม่ครบ: อยู่ในรายการแต่ใช้ไม่ได้ พร้อมเหตุผลภาษาไทย
    const broken = items(tier("rgm.myStyles")).find((el) => el.dataset.name === "Broken")!;
    expect(broken.getAttribute("aria-disabled")).toBe("true");
    expect(broken.getAttribute("title")).toBe(msg("rgm.unusable", { field: "kind", where: msg("rgm.whereMy") }));

    // Installed ล็อก: Delete ใช้ไม่ได้
    await user.pointer({ keys: "[MouseRight]", target: styleItem("Access", "report") });
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: t("rgm.delete") }).getAttribute("aria-disabled")).toBe("true");
    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("checkbox", { name: t("rgm.showGraphs") }));
    expect(items().some((el) => el.dataset.kind === "graph")).toBe(false);
    expect(items().some((el) => el.dataset.kind === "report")).toBe(true);
    await user.click(screen.getByRole("checkbox", { name: t("rgm.showReports") }));
    expect(items()).toHaveLength(0);
  });

  test("generate as dynamic display greys unsupported styles", async () => {
    openScenario(doc());
    server();
    mount({ objectType: "Access" });
    await ready();
    expect(styleItem("Access", "report").getAttribute("aria-disabled")).toBe(null);
    await user.click(screen.getByRole("radio", { name: t("rgm.dynamicDisplay") }));
    expect(styleItem("Access", "report").getAttribute("aria-disabled")).toBe("true");
    expect(styleItem("Gaps", "report").getAttribute("aria-disabled")).toBe("true");
    expect(styleItem("Az El Polar", "graph").getAttribute("aria-disabled")).toBe("true");
    expect(styleItem("AER", "report").getAttribute("aria-disabled")).toBe(null);
    expect(styleItem("AER", "graph").getAttribute("aria-disabled")).toBe(null);
    // เลือก AER แล้ว Generate ได้ ส่ง dynamic: true
    server({ [REPORTS]: { json: reportJson } });
    await pick("THBK-To-G01");
    await user.click(styleItem("AER", "report"));
    await user.click(button("rgm.generate"));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: t("dialog.ok") }));
    await waitFor(() => expect(openReport).toHaveBeenCalledTimes(1));
    expect(vi.mocked(openReport).mock.calls[0][0]).toMatchObject({ style: "AER", kind: "report", dynamic: true });
  });
});

describe("generate", () => {
  test("generate opens a report window", async () => {
    openScenario(doc());
    const f = server({ [REPORTS]: { json: reportJson } });
    mount();
    await ready();
    await setType("rgm.typeAccess");
    await pick("THBK-To-G01", "THBK-To-E11");
    expect(button("rgm.generate").disabled).toBe(true); // ยังไม่ได้เลือก style
    await user.click(styleItem("Access", "report"));
    await user.click(button("rgm.generate"));
    const dialog = await screen.findByRole("dialog", { name: t("rgm.timeProperties") });
    expect((within(dialog).getByRole("radio", { name: t("access.useObjectTimePeriod") }) as HTMLInputElement).checked).toBe(true);
    expect((within(dialog).getByRole("radio", { name: t("rgm.useDefaultTimePoints") }) as HTMLInputElement).checked).toBe(true);
    await user.click(within(dialog).getByRole("button", { name: t("dialog.ok") }));
    await waitFor(() => expect(openReport).toHaveBeenCalledTimes(1));
    const time = { mode: "object", step_s: null };
    expect(vi.mocked(openReport).mock.calls[0][0]).toEqual({ style: "Access", kind: "report", objects: [THBK_G01, THBK_E11], time, dynamic: false });
    expect(lastBody(f.calls, REPORTS)).toEqual({ style: "Access", kind: "report", objects: [THBK_G01, THBK_E11], time, dynamic: false, format: "json" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("time options", async () => {
    openScenario(doc());
    const f = server({ [REPORTS]: { status: 422, json: { code: "INVALID", text: "step ต้องเป็นจำนวนเท่าของ 60 วินาที", field: "time.step", detail: null } } });
    mount({ objectType: "Access" });
    await ready();
    await pick("THBK-To-G01");
    await user.click(styleItem("AER", "report"));
    await user.click(button("rgm.generate"));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("radio", { name: t("rgm.specifyTimeProperties") }));
    await user.click(within(dialog).getByRole("radio", { name: t("rgm.useStepSize") }));
    const step = within(dialog).getByRole("textbox", { name: t("rgm.step") });
    await user.clear(step);
    await user.type(step, "45");
    await user.click(within(dialog).getByRole("button", { name: t("dialog.ok") }));
    await waitFor(() => expect(step.getAttribute("aria-invalid")).toBe("true"));
    expect(within(dialog).getByText("step ต้องเป็นจำนวนเท่าของ 60 วินาที")).toBeTruthy();
    expect(lastBody(f.calls, REPORTS)).toMatchObject({ time: { mode: "specify", start: "2026-11-12T00:00:00Z", stop: "2026-11-13T00:00:00Z", step_s: 45 } });
    expect(openReport).not.toHaveBeenCalled();
    // แก้ Step = กรอบแดงหาย
    await user.type(step, "0");
    expect(step.getAttribute("aria-invalid")).toBe(null);
  });

  test("the time dialog starts from the style's time and objects with different periods get a Thai message", async () => {
    openScenario(doc());
    const timed: StyleDef = { ...MY, name: "AER Noon", time: { mode: "specify", step_s: 120, start: "2026-11-12T06:00:00Z", stop: "2026-11-12T18:00:00Z" } };
    const f = server({
      [STYLES]: stylesReply([timed]),
      [REPORTS]: { status: 422, json: { code: "INVALID", text: "object ที่เลือกมี Time Period ของ access ไม่เท่ากัน", field: "objects", detail: null } },
    });
    mount({ objectType: "Access" });
    await ready();
    await pick("THBK-To-G01", "THBK-To-E11");
    await user.click(styleItem("AER Noon", "report"));
    await user.click(button("rgm.generate"));
    const dialog = await screen.findByRole("dialog");
    expect((within(dialog).getByRole("radio", { name: t("rgm.specifyTimeProperties") }) as HTMLInputElement).checked).toBe(true);
    expect((within(dialog).getByRole("textbox", { name: t("field.analysisStart") }) as HTMLInputElement).value).toBe(formatTime(new Date("2026-11-12T06:00:00Z"), "UTCG", "+07:00"));
    expect((within(dialog).getByRole("textbox", { name: t("field.analysisStop") }) as HTMLInputElement).value).toBe(formatTime(new Date("2026-11-12T18:00:00Z"), "UTCG", "+07:00"));
    expect((within(dialog).getByRole("radio", { name: t("rgm.useStepSize") }) as HTMLInputElement).checked).toBe(true);
    expect((within(dialog).getByRole("textbox", { name: t("rgm.step") }) as HTMLInputElement).value).toBe("120");
    // กลับไป Use Object Time Period: ยังส่ง time เสมอ
    await user.click(within(dialog).getByRole("radio", { name: t("access.useObjectTimePeriod") }));
    await user.click(within(dialog).getByRole("button", { name: t("dialog.ok") }));
    expect(await within(dialog).findByText(msg("rgm.periodsDiffer"))).toBeTruthy();
    expect(lastBody(f.calls, REPORTS)).toMatchObject({ style: "AER Noon", time: { mode: "object", step_s: 120 } });
  });

  test("generate without results asks to compute first", async () => {
    openScenario(doc());
    let reports = 0;
    const f = server({
      [REPORTS]: () => (++reports === 1 ? { status: 409, json: { code: "RESULTS_NOT_CURRENT", text: "x", field: null, detail: null } } : { json: reportJson }),
      [COMPUTE]: { status: 202, json: { job: "j-1", etag: "e2" }, headers: { ETag: '"e2"' } },
    });
    mount({ objectType: "Access" });
    await ready();
    await pick("THBK-To-G01");
    await user.click(styleItem("Access", "report"));
    await user.click(button("rgm.generate"));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: t("dialog.ok") }));
    const ask = await screen.findByText(msg("rgm.computeFirst", { facility: "THBK" }));
    const box = ask.closest("[role=dialog]") as HTMLElement;
    await user.click(within(box).getByRole("button", { name: t("dialog.yes") }));
    await waitFor(() => expect(f.count(COMPUTE)).toBe(1));
    expect(lastBody(f.calls, COMPUTE)).toEqual({ from: THBK, to: [GPS] });
    expect(openReport).not.toHaveBeenCalled();
    act(() => useJobs.getState().onJobEvent({ id: "j-1", kind: "analyze", scenario: "S1", state: "succeeded", progress: null }));
    await waitFor(() => expect(openReport).toHaveBeenCalledTimes(1));
    expect(reports).toBe(2);

    // No = ปิดเฉย ๆ ไม่ Compute
    reports = 0;
    await user.click(button("rgm.generate"));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: t("dialog.ok") }));
    const again = await screen.findByText(msg("rgm.computeFirst", { facility: "THBK" }));
    await user.click(within(again.closest("[role=dialog]") as HTMLElement).getByRole("button", { name: t("dialog.no") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(f.count(COMPUTE)).toBe(1);
    expect(openReport).toHaveBeenCalledTimes(1);
  });

  test("right click generates files", async () => {
    openScenario(doc());
    server();
    mount({ objectType: "Access" });
    await ready();
    await pick("THBK-To-G01");
    await user.pointer({ keys: "[MouseRight]", target: styleItem("AER", "report") });
    await user.click(await screen.findByRole("menuitem", { name: t("rgm.generateTxt") }));
    await waitFor(() => expect(downloadReport).toHaveBeenCalledTimes(1));
    const time = { mode: "object", step_s: null };
    expect(vi.mocked(downloadReport).mock.calls[0]).toEqual(["S1", { style: "AER", kind: "report", objects: [THBK_G01], time, dynamic: false }, "txt"]);
    await user.pointer({ keys: "[MouseRight]", target: styleItem("Access", "report") });
    await user.click(await screen.findByRole("menuitem", { name: t("rgm.generateCsv") }));
    await waitFor(() => expect(downloadReport).toHaveBeenCalledTimes(2));
    expect(vi.mocked(downloadReport).mock.calls[1]).toEqual(["S1", { style: "Access", kind: "report", objects: [THBK_G01], time, dynamic: false }, "csv"]);
  });
});

describe("style tiers", () => {
  test("copy to my styles and delete", async () => {
    openScenario(doc());
    const f = server({ "PUT /api/styles/AER%20Copy": { json: {} }, "PUT /api/styles/AER%20Copy%202": { json: {} }, "DELETE /api/styles/Az%20El%20Mine": { status: 204 } });
    mount({ objectType: "Access" });
    await ready();
    // server หลัง PUT: My Styles มีสำเนาแล้ว (Manager อ่าน GET /styles ใหม่หลังบันทึก)
    f.routes[STYLES] = stylesReply([MY, { ...installed("AER", "graph"), name: "AER Copy" }]);
    await user.pointer({ keys: "[MouseRight]", target: styleItem("AER", "graph") });
    await user.click(await screen.findByRole("menuitem", { name: t("rgm.copyToMyStyles") }));
    await waitFor(() => expect(f.count("PUT /api/styles/AER%20Copy")).toBe(1));
    expect(lastBody(f.calls, "PUT /api/styles/AER%20Copy")).toEqual({ ...installed("AER", "graph"), name: "AER Copy" });
    expect(useMessages.getState().items.map((m) => m.text)).toContain(msg("rgm.copied", { name: "AER Copy" }));

    // มี AER Copy อยู่แล้ว = AER Copy 2
    await waitFor(() => expect(styleItem("AER Copy", "graph", tier("rgm.myStyles"))).toBeDefined());
    await user.pointer({ keys: "[MouseRight]", target: styleItem("AER", "report") });
    await user.click(await screen.findByRole("menuitem", { name: t("rgm.copyToMyStyles") }));
    await waitFor(() => expect(f.count("PUT /api/styles/AER%20Copy%202")).toBe(1));
    expect((lastBody(f.calls, "PUT /api/styles/AER%20Copy%202") as StyleDef).kind).toBe("report");

    // Delete ของ My Style: ถามก่อน แล้ว DELETE และหายจากต้นไม้
    await user.pointer({ keys: "[MouseRight]", target: styleItem("Az El Mine", "report") });
    await user.click(await screen.findByRole("menuitem", { name: t("rgm.delete") }));
    expect(await screen.findByText(msg("rgm.deleteConfirm", { name: "Az El Mine", tier: t("rgm.myStyles") }))).toBeTruthy();
    f.routes[STYLES] = stylesReply([]);
    await user.click(await screen.findByRole("button", { name: t("dialog.ok") }));
    await waitFor(() => expect(f.count("DELETE /api/styles/Az%20El%20Mine")).toBe(1));
    await waitFor(() => expect(styleItem("Az El Mine", "report")).toBeUndefined());

    // Delete ของ Scenario Style: putDoc ตัดออกจาก doc.styles
    f.routes[`PUT ${BASE}`] = (call) => ({ json: call.body, headers: { ETag: '"e3"' } });
    await user.pointer({ keys: "[MouseRight]", target: styleItem("THBK Day", "report") });
    await user.click(await screen.findByRole("menuitem", { name: t("rgm.delete") }));
    await user.click(await screen.findByRole("button", { name: t("dialog.ok") }));
    await waitFor(() => expect(f.count(`PUT ${BASE}`)).toBe(1));
    expect((lastBody(f.calls, `PUT ${BASE}`) as ScenarioDoc).styles).toEqual([]);
    expect(f.calls.find((c) => c.method === "PUT" && c.path === BASE)?.headers.get("If-Match")).toBe('"e1"');
  });

  test("new and properties open the style editor; OK saves to the chosen tier", async () => {
    openScenario(doc());
    const f = server({
      [`GET ${BASE}/dataproviders`]: { json: [
        { name: "AER Data", groups: ["Default"], uses: ["Reports", "Dynamic Displays"], ours: false, elements: [
          { name: "Time", unit: null, kind: "time", interp: "linear" }, { name: "Azimuth", unit: "deg", kind: "number", interp: "angle" },
          { name: "Elevation", unit: "deg", kind: "number", interp: "linear" }, { name: "Range", unit: "km", kind: "number", interp: "linear" }] },
      ] },
      "PUT /api/styles/Az%20El%20Mine": { json: {} },
      [`PUT ${BASE}`]: (call) => ({ json: call.body, headers: { ETag: '"e3"' } }),
    });
    mount({ objectType: "Access" });
    await ready();
    await user.click(button("rgm.new"));
    expect(opened.at(-1)).toEqual({ kind: STYLE_EDITOR_KIND, params: { kind: "report", objectType: "Access" } });
    await user.click(styleItem("Az El Mine", "report"));
    await user.click(button("rgm.properties"));
    expect(opened.at(-1)).toEqual({ kind: STYLE_EDITOR_KIND, params: { style: MY, tier: "my" } });
    cleanup();

    // Properties ของ My Style → OK = PUT /styles/{name}
    render(<><StyleEditor panelId="se" params={{ style: MY, tier: "my" }} /><Dialogs /></>);
    await waitFor(() => expect(f.count(`GET ${BASE}/dataproviders`)).toBeGreaterThan(0));
    expect((screen.getByRole("textbox", { name: t("field.name") }) as HTMLInputElement).value).toBe("Az El Mine");
    const contents = screen.getByRole("listbox", { name: t("rgm.reportContents") });
    expect(within(contents).getAllByRole("option").map((o) => o.textContent)).toEqual(["Time", "Azimuth", "Elevation", "Range"]);
    await user.click(within(contents).getByRole("option", { name: "Range" }));
    await user.click(button("rgm.up"));
    await user.click(button("dialog.ok"));
    await waitFor(() => expect(f.count("PUT /api/styles/Az%20El%20Mine")).toBe(1));
    expect((lastBody(f.calls, "PUT /api/styles/Az%20El%20Mine") as StyleDef).content[0].elements).toEqual(["Time", "Azimuth", "Range", "Elevation"]);
    expect(useLayout.getState().closePanel).toHaveBeenCalledWith("se");
    cleanup();

    // New... → Scenario Styles → putDoc ใส่ใน doc.styles; ชื่อที่ชนกับ Installed ถูกปฏิเสธเป็นภาษาไทย
    render(<><StyleEditor panelId="se2" params={{ kind: "report", objectType: "Access" }} /><Dialogs /></>);
    await waitFor(() => expect(screen.getByRole("treeitem", { name: "Elevation" })).toBeTruthy());
    await user.click(screen.getByRole("treeitem", { name: "Elevation" }));
    await user.click(button("rgm.add"));
    await user.click(screen.getByRole("radio", { name: t("rgm.scenarioStyles") }));
    const name = screen.getByRole("textbox", { name: t("field.name") });
    await user.type(name, "aer");
    expect(screen.getByText(msg("styleEditor.nameTaken", { name: "aer", tier: t("rgm.installedStyles") }))).toBeTruthy();
    expect(button("dialog.ok").disabled).toBe(true);
    await user.clear(name);
    await user.type(name, "Elev Only");
    await user.click(button("dialog.ok"));
    await waitFor(() => expect(f.count(`PUT ${BASE}`)).toBe(1));
    const saved = (lastBody(f.calls, `PUT ${BASE}`) as ScenarioDoc).styles as StyleDef[];
    expect(saved.map((s) => s.name)).toEqual(["THBK Day", "Elev Only"]);
    expect(saved[1]).toMatchObject({ kind: "report", object_type: "Access", content: [{ provider: "AER Data", group: "Default", elements: ["Elevation"] }], graph: null });
    cleanup();

    // 422 STYLE_INVALID = ข้อความใน Message Viewer หน้าต่างยังเปิดอยู่
    f.routes["PUT /api/styles/Az%20El%20Mine"] = { status: 422, json: { code: "STYLE_INVALID", text: "style ช่อง content[0].elements[1]: ไม่มี element", field: "content[0].elements[1]", detail: null } };
    vi.mocked(useLayout.getState().closePanel).mockClear();
    render(<><StyleEditor panelId="se3" params={{ style: MY, tier: "my" }} /><Dialogs /></>);
    await user.click(button("dialog.ok"));
    await waitFor(() => expect(useMessages.getState().items.map((m) => [m.level, m.code, m.text])).toContainEqual(["error", "STYLE_INVALID", "style ช่อง content[0].elements[1]: ไม่มี element"]));
    expect(useLayout.getState().closePanel).not.toHaveBeenCalled();
  });
});

describe("commands and panels", () => {
  test("the panels are registered with the agreed sizes", () => {
    registerReportGraphManagerPanel();
    registerStyleEditorPanel();
    const rgm = getPanelDef(RGM_KIND)!;
    expect(rgm).toMatchObject({ type: "floating", size: { width: 760, height: 540 }, persist: false, scenarioBound: true, singleton: true });
    expect(rgm.component).toBe(ReportGraphManager);
    expect(rgm.title({})).toBe(t("window.reportGraphManager"));
    const editor = getPanelDef(STYLE_EDITOR_KIND)!;
    expect(editor).toMatchObject({ type: "floating", size: { width: 720, height: 520 }, persist: false, scenarioBound: true });
    // หนึ่งบานต่อ (ชั้น, ชื่อ, ชนิด): AER รายงานกับ AER กราฟเป็นสองบาน; New... แยกตามชนิดและ Object Type
    const aerReport = editor.instanceKey?.({ style: installed("AER", "report"), tier: "installed" });
    const aerGraph = editor.instanceKey?.({ style: installed("AER", "graph"), tier: "installed" });
    expect(aerReport).toBe(JSON.stringify(["installed", "AER", "report"]));
    expect(aerGraph).toBe(JSON.stringify(["installed", "AER", "graph"]));
    expect(editor.instanceKey?.({ style: MY, tier: "my" })).not.toBe(editor.instanceKey?.({ style: MY, tier: "scenario" }));
    expect(editor.instanceKey?.({ kind: "report", objectType: "Access" })).toBe(JSON.stringify(["new", "report", "Access"]));
    expect(editor.instanceKey?.({ kind: "graph", objectType: "Access" })).not.toBe(editor.instanceKey?.({ kind: "report", objectType: "Access" }));
    expect(editor.instanceKey?.({ kind: "report", objectType: "Facility" })).not.toBe(editor.instanceKey?.({ kind: "report", objectType: "Access" }));
  });

  test("analysis.reportGraphManager and object.reportGraphManager open the manager", () => {
    const off = registerReportGraphManagerCommands();
    expect(isRegistered("analysis.reportGraphManager")).toBe(true);
    expect(isEnabled("analysis.reportGraphManager")).toBe(false);
    expect(commandTooltip("analysis.reportGraphManager")).toBe(msg("tooltip.noScenario"));
    openScenario(doc());
    useLayout.setState({ api: {} } as never);
    expect(isEnabled("analysis.reportGraphManager")).toBe(true);
    runCommand("analysis.reportGraphManager");
    expect(opened.at(-1)).toEqual({ kind: RGM_KIND, params: {} });

    // object.reportGraphManager: Object Type ตามชนิด object ที่เลือก และเลือก object นั้นไว้
    expect(isEnabled("object.reportGraphManager")).toBe(false);
    act(() => useSelection.getState().select(G01));
    expect(isEnabled("object.reportGraphManager")).toBe(true);
    runCommand("object.reportGraphManager");
    expect(opened.at(-1)).toEqual({ kind: RGM_KIND, params: { objectType: "Satellite", objects: [G01] } });
    act(() => useSelection.getState().select(GPS));
    runCommand("object.reportGraphManager");
    expect(opened.at(-1)).toEqual({ kind: RGM_KIND, params: { objectType: "Constellation", objects: [GPS] } });
    // QA-02: เมนูของ Scenario (ราก "*") = Object Type All Types ไม่เลือก object ใด
    act(() => useSelection.getState().select("*"));
    expect(isEnabled("object.reportGraphManager")).toBe(true);
    runCommand("object.reportGraphManager");
    expect(opened.at(-1)).toEqual({ kind: RGM_KIND, params: { objectType: "All", objects: [] } });
    off();
    expect(isRegistered("analysis.reportGraphManager")).toBe(false);
  });

  test("params preselect the object type and objects", async () => {
    openScenario(doc());
    server();
    mount({ objectType: "Satellite", objects: [G01, E11] });
    await ready();
    expect((screen.getByRole("combobox", { name: t("rgm.objectType") }) as HTMLSelectElement).value).toBe("Satellite");
    const selected = within(objectList()).getAllByRole("option").filter((o) => o.getAttribute("aria-selected") === "true").map((o) => o.textContent);
    expect(selected).toEqual(["G01", "E11"]);
  });

  test("Close closes the manager window", async () => {
    openScenario(doc());
    server();
    mount();
    await ready();
    await user.click(button("rgm.close"));
    expect(useLayout.getState().closePanel).toHaveBeenCalledWith("rgm");
  });

  test("the Access tool button opens the manager on the checked accesses", async () => {
    openScenario(doc());
    server();
    const off = registerReportGraphManagerCommands();
    useLayout.setState({ api: {} } as never);
    render(<AccessTool panelId="accessTool" params={{ from: THBK }} />);
    await user.click(screen.getByRole("checkbox", { name: "E11" }));
    await user.click(screen.getByRole("button", { name: t("menu.analysis.reportGraphManager") }));
    expect(opened.at(-1)).toEqual({ kind: RGM_KIND, params: { objectType: "Access", objects: [THBK_E11] } });
    off();
  });
});

// ---------- fix round 1 ----------

const AER_PROVIDERS: Handler = { json: [
  { name: "AER Data", groups: ["Default"], uses: ["Reports", "Dynamic Displays"], ours: false, elements: [
    { name: "Time", unit: null, kind: "time", interp: "linear" }, { name: "Azimuth", unit: "deg", kind: "number", interp: "angle" },
    { name: "Elevation", unit: "deg", kind: "number", interp: "linear" }, { name: "Range", unit: "km", kind: "number", interp: "linear" }] },
] };

function editor(params: Record<string, unknown>) {
  return render(<><StyleEditor panelId="se" params={params} /><Dialogs /></>);
}

describe("fix round 1: keyboard", () => {
  test("select objects and a style and Generate using only the keyboard", async () => {
    openScenario(doc());
    server({ [REPORTS]: { json: reportJson } });
    mount({ objectType: "Access" });
    await ready();
    // Tab: Object Type → รายการ object (หนึ่งจุดหยุด) → ต้นไม้ style (หนึ่งจุดหยุด)
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("combobox", { name: t("rgm.objectType") }));
    await user.tab();
    expect(document.activeElement?.textContent).toBe("THBK-To-G01");
    await user.keyboard("{ArrowDown}{End}{Home}");
    expect(document.activeElement?.textContent).toBe("THBK-To-G01");
    await user.keyboard(" ");
    expect(document.activeElement?.getAttribute("aria-selected")).toBe("true");
    await user.tab();
    expect(document.activeElement?.getAttribute("role")).toBe("treeitem");
    // Access (report) เป็นตัวแรก ลงไปหา AER (report) ตัวที่สาม
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect((document.activeElement as HTMLElement).dataset.name).toBe("AER");
    expect(document.activeElement?.getAttribute("aria-selected")).toBe("true");
    await user.keyboard("{Enter}");
    const dialog = await screen.findByRole("dialog", { name: t("rgm.timeProperties") });
    within(dialog).getByRole("button", { name: t("dialog.ok") }).focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(openReport).toHaveBeenCalledTimes(1));
    expect(vi.mocked(openReport).mock.calls[0][0]).toMatchObject({ style: "AER", kind: "report", objects: [THBK_G01] });
  });

  test("Shift+F10 and the context-menu key open the style menu", async () => {
    openScenario(doc());
    server();
    mount({ objectType: "Access" });
    await ready();
    styleItem("Access", "report").focus();
    await user.keyboard("{Shift>}{F10}{/Shift}");
    expect(within(await screen.findByRole("menu")).getByRole("menuitem", { name: t("rgm.delete") }).getAttribute("aria-disabled")).toBe("true");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    styleItem("AER", "report").focus();
    await user.keyboard("{ContextMenu}");
    expect(await screen.findByRole("menuitem", { name: t("rgm.copyToMyStyles") })).toBeTruthy();
  });

  test("move a column Up using only the keyboard", async () => {
    openScenario(doc());
    const f = server({ [`GET ${BASE}/dataproviders`]: AER_PROVIDERS, "PUT /api/styles/Az%20El%20Mine": { json: {} } });
    editor({ style: MY, tier: "my" });
    const contents = screen.getByRole("listbox", { name: t("rgm.reportContents") });
    await screen.findByRole("treeitem", { name: "Time" });
    await tabTo(isContentOption); // เริ่มจาก Tab ไม่ใช่ .focus()
    expect(document.activeElement?.textContent).toBe("Time");
    await user.keyboard("{End}");
    expect(document.activeElement?.textContent).toBe("Range");
    await user.keyboard("{Alt>}{ArrowUp}{/Alt}");
    expect(within(contents).getAllByRole("option").map((o) => o.textContent)).toEqual(["Time", "Azimuth", "Range", "Elevation"]);
    expect(document.activeElement?.textContent).toBe("Range");
    // ปุ่ม Up ก็ใช้ได้ด้วยคีย์บอร์ด
    await user.keyboard("{ArrowUp}");
    expect(document.activeElement?.textContent).toBe("Azimuth");
    button("rgm.down").focus();
    await user.keyboard("{Enter}");
    expect(within(contents).getAllByRole("option").map((o) => o.textContent)).toEqual(["Time", "Range", "Azimuth", "Elevation"]);
    button("dialog.ok").focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(f.count("PUT /api/styles/Az%20El%20Mine")).toBe(1));
  });

  test("Data Providers elements: arrows move, Enter adds", async () => {
    openScenario(doc());
    server({ [`GET ${BASE}/dataproviders`]: AER_PROVIDERS });
    editor({ kind: "report", objectType: "Access" });
    const time = await screen.findByRole("treeitem", { name: "Time" });
    time.focus();
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(document.activeElement?.textContent).toBe("Elevation");
    await user.keyboard("{Enter}");
    expect(within(screen.getByRole("listbox", { name: t("rgm.reportContents") })).getAllByRole("option").map((o) => o.textContent)).toEqual(["Elevation"]);
  });
});

describe("fix round 1: names (P4)", () => {
  test("a Scenario style name created elsewhere while the editor is open is refused, nothing is overwritten", async () => {
    openScenario(doc());
    const f = server({ [`GET ${BASE}/dataproviders`]: AER_PROVIDERS, [`PUT ${BASE}`]: (call) => ({ json: call.body, headers: { ETag: '"e3"' } }) });
    editor({ style: installed("AER", "report"), tier: "installed" });
    await waitFor(() => expect(f.count(STYLES)).toBe(1));
    await user.click(screen.getByRole("radio", { name: t("rgm.scenarioStyles") }));
    const name = screen.getByRole("textbox", { name: t("field.name") }) as HTMLInputElement;
    expect(name.value).toBe("AER Copy");
    // อีกทางหนึ่ง (หน้าต่างอื่น) สร้าง Scenario Style ชื่อ AER Copy: doc เปลี่ยน แต่ GET /styles ยังตอบรายการเก่า
    const taken = { ...installed("AER", "report"), name: "AER Copy" };
    act(() => useScenario.setState({ doc: doc({ styles: [SCENARIO_STYLE, taken] }), etag: '"e2"' }));
    await waitFor(() => expect(f.count(STYLES)).toBe(2)); // อ่านรายการใหม่เมื่อ doc เปลี่ยน
    await user.click(button("dialog.ok"));
    expect(await screen.findByText(msg("styleEditor.nameTaken", { name: "AER Copy", tier: t("rgm.scenarioStyles") }))).toBeTruthy();
    expect(f.count(`PUT ${BASE}`)).toBe(0);
    expect(useLayout.getState().closePanel).not.toHaveBeenCalled();
  });

  test("the editor re-reads the style list when My Styles change elsewhere", async () => {
    openScenario(doc());
    const f = server({ [`GET ${BASE}/dataproviders`]: AER_PROVIDERS });
    editor({ kind: "report", objectType: "Access" });
    await waitFor(() => expect(f.count(STYLES)).toBe(1));
    const name = screen.getByRole("textbox", { name: t("field.name") });
    await user.type(name, "Fresh");
    expect(screen.queryByText(msg("styleEditor.nameTaken", { name: "Fresh", tier: t("rgm.myStyles") }))).toBeNull();
    f.routes[STYLES] = stylesReply([MY, { ...MY, name: "Fresh" }]);
    act(() => useStyleRevision.getState().bump());
    expect(await screen.findByText(msg("styleEditor.nameTaken", { name: "Fresh", tier: t("rgm.myStyles") }))).toBeTruthy();
  });

  test("a My Style may not take the name of a Scenario Style, and the other way round", async () => {
    openScenario(doc());
    const f = server({ [`GET ${BASE}/dataproviders`]: AER_PROVIDERS });
    editor({ style: MY, tier: "my" });
    await waitFor(() => expect(f.count(STYLES)).toBe(1));
    const name = screen.getByRole("textbox", { name: t("field.name") });
    await user.clear(name);
    await user.type(name, "thbk day");
    expect(screen.getByText(msg("styleEditor.nameTaken", { name: "thbk day", tier: t("rgm.scenarioStyles") }))).toBeTruthy();
    expect(button("dialog.ok").disabled).toBe(true);
    cleanup();
    editor({ style: SCENARIO_STYLE, tier: "scenario" });
    await waitFor(() => expect(f.count(STYLES)).toBe(2));
    const other = screen.getByRole("textbox", { name: t("field.name") });
    await user.clear(other);
    await user.type(other, "AZ EL MINE");
    expect(screen.getByText(msg("styleEditor.nameTaken", { name: "AZ EL MINE", tier: t("rgm.myStyles") }))).toBeTruthy();
    expect(button("dialog.ok").disabled).toBe(true);
  });

  test("renaming a Scenario style keeps the old entry; Properties of an Installed style starts a unique copy name", async () => {
    openScenario(doc());
    const f = server({
      [STYLES]: stylesReply([MY, { ...installed("AER", "report"), name: "AER Copy" }]),
      [`GET ${BASE}/dataproviders`]: AER_PROVIDERS,
      [`PUT ${BASE}`]: (call) => ({ json: call.body, headers: { ETag: '"e3"' } }),
    });
    editor({ style: installed("AER", "report"), tier: "installed" });
    await waitFor(() => expect((screen.getByRole("textbox", { name: t("field.name") }) as HTMLInputElement).value).toBe("AER Copy 2"));
    cleanup();
    editor({ style: SCENARIO_STYLE, tier: "scenario" });
    await waitFor(() => expect(f.count(STYLES)).toBe(2));
    const name = screen.getByRole("textbox", { name: t("field.name") });
    await user.clear(name);
    await user.type(name, "THBK Night");
    await user.click(button("dialog.ok"));
    await waitFor(() => expect(f.count(`PUT ${BASE}`)).toBe(1));
    expect(((lastBody(f.calls, `PUT ${BASE}`) as ScenarioDoc).styles as StyleDef[]).map((x) => x.name)).toEqual(["THBK Day", "THBK Night"]);
  });
});

describe("fix round 1: manager paths", () => {
  test("a broken My Style can be deleted; one without a name has its own row, cannot be deleted and says so", async () => {
    openScenario(doc());
    const f = server({ [STYLES]: stylesReply([MY, BROKEN, { kind: "report" }, { kind: "graph" }]), "DELETE /api/styles/Broken": { status: 204 } });
    mount();
    await ready();
    const unnamed = items(tier("rgm.myStyles")).filter((el) => el.dataset.name === "");
    expect(unnamed).toHaveLength(2);
    expect(unnamed[0].getAttribute("title")).toBe(msg("rgm.unusableUnnamed", { field: "name", where: msg("rgm.whereMy") }));
    await user.pointer({ keys: "[MouseRight]", target: unnamed[0] });
    expect(within(await screen.findByRole("menu")).getByRole("menuitem", { name: t("rgm.delete") }).getAttribute("aria-disabled")).toBe("true");
    await user.keyboard("{Escape}");
    f.routes[STYLES] = stylesReply([MY]);
    const broken = items(tier("rgm.myStyles")).find((el) => el.dataset.name === "Broken")!;
    await user.pointer({ keys: "[MouseRight]", target: broken });
    await user.click(await screen.findByRole("menuitem", { name: t("rgm.delete") }));
    await user.click(await screen.findByRole("button", { name: t("dialog.ok") }));
    await waitFor(() => expect(f.count("DELETE /api/styles/Broken")).toBe(1));
    await waitFor(() => expect(items(tier("rgm.myStyles")).some((el) => el.dataset.name === "Broken")).toBe(false));
  });

  test("Generate: STYLE_INVALID goes to the Message Viewer and the dialog", async () => {
    openScenario(doc());
    const text = "style ช่อง content[0].elements[2]: ไม่มี element";
    server({ [REPORTS]: { status: 422, json: { code: "STYLE_INVALID", text, field: "content[0].elements[2]", detail: null } } });
    mount({ objectType: "Access" });
    await ready();
    await pick("THBK-To-G01");
    await user.click(styleItem("Az El Mine", "report"));
    await user.click(button("rgm.generate"));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: t("dialog.ok") }));
    expect(await within(dialog).findByText(text)).toBeTruthy();
    expect(useMessages.getState().items.map((m) => [m.level, m.code, m.text])).toContainEqual(["error", "STYLE_INVALID", text]);
    expect(openReport).not.toHaveBeenCalled();
  });

  test("409 with nothing that can be computed says so in Thai", async () => {
    // Facility ที่ยังไม่มี access และ scenario ไม่มีดาว: คำนวณอะไรไม่ได้
    openScenario(doc({ objects: [{ class: "Facility", name: "THBK" }] as never, accesses: [] as never }));
    server({ [REPORTS]: { status: 409, json: { code: "RESULTS_NOT_CURRENT", text: "x", field: null, detail: null } } });
    mount({ objectType: "Facility" });
    await ready();
    await pick("THBK");
    await user.click(styleItem("All DOPs", "report"));
    await user.click(button("rgm.generate"));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: t("dialog.ok") }));
    await waitFor(() => expect(useMessages.getState().items.map((m) => m.text)).toContain(msg("rgm.nothingToCompute")));
    expect(openReport).not.toHaveBeenCalled();
  });

  test("a scenario switch while Generate is waiting opens nothing", async () => {
    openScenario(doc());
    const reply = deferred<{ json: unknown }>();
    server({ [REPORTS]: () => reply.promise });
    mount({ objectType: "Access" });
    await ready();
    await pick("THBK-To-G01");
    await user.click(styleItem("Access", "report"));
    await user.click(button("rgm.generate"));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: t("dialog.ok") }));
    act(() => useScenario.setState({ name: "S2", doc: doc({ name: "S2" }) }));
    reply.resolve({ json: reportJson });
    await act(async () => { await Promise.resolve(); });
    await new Promise((r) => setTimeout(r, 20));
    expect(openReport).not.toHaveBeenCalled();
  });
});

// ---------- fix round 2 ----------

/** กด Tab จนโฟกัสถึง element ที่ตรงเงื่อนไข (ไม่เกิน 30 ครั้ง) */
async function tabTo(match: (el: Element) => boolean) {
  for (let i = 0; i < 30; i++) {
    await user.tab();
    if (document.activeElement !== null && match(document.activeElement)) return document.activeElement as HTMLElement;
  }
  throw new Error("tab target not reached");
}

const contentTexts = () => within(screen.getByRole("listbox", { name: t("rgm.reportContents") })).getAllByRole("option").map((o) => o.textContent);
const isContentOption = (el: Element) => el.getAttribute("role") === "option" && el.closest("[role=listbox]")?.getAttribute("aria-labelledby") !== null
  && screen.getByRole("listbox", { name: t("rgm.reportContents") }).contains(el);

describe("fix round 2: column focus", () => {
  test("Alt+Down on the last column does nothing, and typing in Name afterwards keeps the focus there", async () => {
    openScenario(doc());
    server({ [`GET ${BASE}/dataproviders`]: AER_PROVIDERS });
    editor({ style: MY, tier: "my" });
    await screen.findByRole("treeitem", { name: "Time" });
    await tabTo(isContentOption); // เริ่มจาก Tab
    expect(document.activeElement?.textContent).toBe("Time");
    await user.keyboard("{End}{Alt>}{ArrowDown}{/Alt}");
    expect(contentTexts()).toEqual(["Time", "Azimuth", "Elevation", "Range"]);
    const name = screen.getByRole("textbox", { name: t("field.name") }) as HTMLInputElement;
    await user.click(name);
    await user.type(name, "xy");
    expect(document.activeElement).toBe(name);
    expect(name.value).toBe("Az El Minexy");
  });

  test("Alt+Up on the first column does nothing, and ArrowDown then moves on", async () => {
    openScenario(doc());
    server({ [`GET ${BASE}/dataproviders`]: AER_PROVIDERS });
    editor({ style: MY, tier: "my" });
    await screen.findByRole("treeitem", { name: "Time" });
    await tabTo(isContentOption);
    await user.keyboard("{Home}{Alt>}{ArrowUp}{/Alt}{ArrowDown}");
    expect(document.activeElement?.textContent).toBe("Azimuth");
    // Alt+Down ย้ายคอลัมน์ลง โฟกัสตามคอลัมน์
    await user.keyboard("{Alt>}{ArrowDown}{/Alt}");
    expect(contentTexts()).toEqual(["Time", "Elevation", "Azimuth", "Range"]);
    expect(document.activeElement?.textContent).toBe("Azimuth");
  });

  test("Delete moves the focus to the neighbouring column, and to the list when it is empty", async () => {
    openScenario(doc());
    server({ [`GET ${BASE}/dataproviders`]: AER_PROVIDERS });
    editor({ style: MY, tier: "my" });
    await screen.findByRole("treeitem", { name: "Time" });
    await tabTo(isContentOption);
    await user.keyboard("{ArrowDown}{Delete}");
    expect(contentTexts()).toEqual(["Time", "Elevation", "Range"]);
    expect(document.activeElement?.textContent).toBe("Elevation");
    await user.keyboard("{End}{Delete}");
    expect(document.activeElement?.textContent).toBe("Elevation"); // ตัวท้าย: ไปตัวก่อนหน้า
    await user.keyboard("{Delete}{Delete}");
    expect(within(screen.getByRole("listbox", { name: t("rgm.reportContents") })).queryAllByRole("option")).toHaveLength(0);
    expect(document.activeElement).toBe(screen.getByRole("listbox", { name: t("rgm.reportContents") }));
  });
});

describe("fix round 2: tree and Generate", () => {
  test("Space on the styles tree selects the focused style (reached with Tab)", async () => {
    openScenario(doc());
    server();
    mount({ objectType: "Access" });
    await ready();
    const first = await tabTo((el) => el.getAttribute("role") === "treeitem");
    expect(first.getAttribute("aria-selected")).toBe("false");
    await user.keyboard(" ");
    expect(first.getAttribute("aria-selected")).toBe("true");
    expect(button("rgm.properties").disabled).toBe(false);
  });

  test("an edit made during the Generate POST: the result is not primed, the window makes its own", async () => {
    openScenario(doc());
    const reply = deferred<{ json: unknown }>();
    server({ [REPORTS]: () => reply.promise });
    mount({ objectType: "Access" });
    await ready();
    await pick("THBK-To-G01");
    await user.click(styleItem("Access", "report"));
    await user.click(button("rgm.generate"));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: t("dialog.ok") }));
    act(() => useScenario.setState({ etag: '"e5"' })); // แก้ scenario ระหว่างรอ
    reply.resolve({ json: reportJson });
    await waitFor(() => expect(openReport).toHaveBeenCalledTimes(1));
    expect(primeReport).not.toHaveBeenCalled();
  });

  test("without an edit the result is primed for the window", async () => {
    openScenario(doc());
    server({ [REPORTS]: { json: reportJson } });
    mount({ objectType: "Access" });
    await ready();
    await pick("THBK-To-G01");
    await user.click(styleItem("Access", "report"));
    await user.click(button("rgm.generate"));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: t("dialog.ok") }));
    await waitFor(() => expect(openReport).toHaveBeenCalledTimes(1));
    expect(primeReport).toHaveBeenCalledTimes(1);
  });
});

describe("fix round 2: unusable wording", () => {
  test("an unusable Installed style is not told to use Delete", () => {
    expect(msg("rgm.unusableLocked", { field: "kind", where: msg("rgm.whereInstalled") })).not.toContain("Delete");
    expect(msg("rgm.unusable", { field: "kind", where: msg("rgm.whereMy") })).toContain("Delete");
  });
});
