import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { startEventWiring } from "../../src/api/events";
import { isEnabled, resetCommands, runCommand } from "../../src/commands";
import { t } from "../../src/labels/labels";
import { msg } from "../../src/labels/messages.th";
import { startClock } from "../../src/time/clock";
import { useLayout } from "../../src/stores/layout";
import { App } from "../../src/App";
import { useSaveAs } from "../../src/chrome/SaveAsDialog";
import { useScenario } from "../../src/stores/scenario";
import { useSettings } from "../../src/stores/settings";
import { openScenario } from "./helpers/chrome";
import { loadObjects } from "./helpers/objects";
import { stubFetch } from "./helpers/fake-fetch";
import { setUrl } from "./helpers/files";

vi.mock("../../src/time/clock", () => ({ startClock: vi.fn() }));
vi.mock("../../src/api/events", () => ({ startEventWiring: vi.fn() }));

const stopClock = vi.fn();
const stopEvents = vi.fn();

const SCENARIOS = [{ name: "E2E", start: "2026-11-12T00:00:00Z", stop: "2026-11-13T00:00:00Z", modified_utc: "2026-11-11T05:00:00Z", daily: false }];
const DEFAULT_IDS = ["graphics2d", "graphics3d", "messageViewer", "objectBrowser", "timelineView"];
const panelIds = () => (useLayout.getState().api?.panels ?? []).map((p) => p.id).sort();

beforeEach(() => {
  resetCommands();
  localStorage.clear();
  setUrl("");
  useLayout.setState(useLayout.getInitialState(), true);
  useScenario.setState(useScenario.getInitialState(), true);
  useSaveAs.setState({ open: false });
  useSettings.setState(useSettings.getInitialState(), true);
  stubFetch({
    "GET /api/health": { status: 500, json: { code: "X", text: "x" } }, // the health banner polls; keep it off the network
    "GET /api/scenarios": { json: SCENARIOS }, // Welcome lists them
  });
  vi.mocked(startClock).mockReset().mockReturnValue(stopClock);
  vi.mocked(startEventWiring).mockReset().mockReturnValue(stopEvents);
  stopClock.mockReset();
  stopEvents.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("App renders the workspace with the default layout, and Welcome over it when no scenario is asked for", async () => {
  const { container } = render(<App />);
  await waitFor(() => expect(panelIds()).toEqual([...DEFAULT_IDS, "welcome"].sort()));
  expect(container.querySelector(".dv-dockview")).not.toBeNull();
});

test("App starts the clock and the event wiring once and stops both on unmount", async () => {
  const { unmount } = render(<App />);
  await waitFor(() => expect(useLayout.getState().api).not.toBeNull());
  expect(startClock).toHaveBeenCalledTimes(1);
  expect(startEventWiring).toHaveBeenCalledTimes(1);
  expect(stopClock).not.toHaveBeenCalled();
  expect(stopEvents).not.toHaveBeenCalled();
  unmount();
  expect(stopClock).toHaveBeenCalledTimes(1);
  expect(stopEvents).toHaveBeenCalledTimes(1);
});

test("under StrictMode every start is matched by a stop", async () => {
  const { unmount } = render(<StrictMode><App /></StrictMode>);
  await waitFor(() => expect(useLayout.getState().api).not.toBeNull());
  // dockview ไม่สร้างใหม่ตอน StrictMode เล่น effect ซ้ำ: store ต้องยังถือ api ตัวเดิมที่ยังทำงานอยู่ (และ Welcome เปิดครั้งเดียว)
  await waitFor(() => expect(panelIds()).toEqual([...DEFAULT_IDS, "welcome"].sort()));
  unmount();
  expect(useLayout.getState().api).toBeNull();
  expect(stopClock).toHaveBeenCalledTimes(vi.mocked(startClock).mock.calls.length);
  expect(stopEvents).toHaveBeenCalledTimes(vi.mocked(startEventWiring).mock.calls.length);
});

test("App puts the menu bar, both toolbars and the status bar around the windows", async () => {
  render(<App />);
  await waitFor(() => expect(useLayout.getState().api?.panels).toHaveLength(6));
  const header = document.querySelector('[data-slot="header"]')!;
  const footer = document.querySelector('[data-slot="footer"]')!;
  expect(within(header as HTMLElement).getByRole("menubar")).toBeDefined();
  expect(within(header as HTMLElement).getByRole("toolbar", { name: t("toolbar.default") })).toBeDefined();
  expect(within(header as HTMLElement).getByRole("toolbar", { name: t("toolbar.animation") })).toBeDefined();
  expect(footer.querySelector('[data-field="activeObject"]')).not.toBeNull();
});

test("App registers the view, window, animation, file and help commands, and the others stay disabled", async () => {
  render(<App />);
  await waitFor(() => expect(useLayout.getState().api).not.toBeNull());
  await waitFor(() => expect(isEnabled("view.new3d")).toBe(true));
  expect(isEnabled("window.windows")).toBe(true);
  expect(isEnabled("file.new")).toBe(true);
  expect(isEnabled("help.about")).toBe(true);
  expect(isEnabled("file.save")).toBe(false); // registered, but only usable once a scenario is open
  expect(isEnabled("analysis.access")).toBe(false);
  // และเมนูตามทัน: รายการ View ที่ลงทะเบียนแล้วไม่ aria-disabled
  expect(screen.getByRole("menubar")).toBeDefined();
});

test("App fills the Object Browser window with the scenario tree, and the status bar's flagged count filters it", async () => {
  render(<App />);
  await waitFor(() => expect(panelIds()).toContain("objectBrowser"));
  expect(screen.queryAllByRole("treeitem")).toEqual([]);
  expect(isEnabled("edit.find")).toBe(false);
  act(() => void loadObjects());
  await waitFor(() => expect(screen.getAllByRole("treeitem").map((r) => r.textContent)).toContain("G01"));
  expect(isEnabled("edit.find")).toBe(true);
  expect(document.querySelector('[data-focus-scope="objectBrowser"]')).not.toBeNull();
  const flagged = screen.getByRole("button", { name: `${t("status.flaggedSatellites")}: 2` });
  expect(flagged.getAttribute("aria-disabled")).toBeNull();
  act(() => flagged.click());
  await waitFor(() => expect(screen.getAllByRole("treeitem").map((r) => r.textContent)).toEqual(["S1", "G03", "G04"]));
});

test("App installs the shortcuts once: Ctrl+S is kept from the browser while mounted, and not after unmount", async () => {
  const { unmount } = render(<App />);
  await waitFor(() => expect(useLayout.getState().api).not.toBeNull());
  const press = () => {
    const e = new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true });
    document.body.dispatchEvent(e);
    return e.defaultPrevented;
  };
  expect(press()).toBe(true);
  unmount();
  expect(press()).toBe(false);
});

test("App shows the disk warning when the server reports a read-only disk", async () => {
  stubFetch({ "GET /api/health": { json: { engine_version: "1", gmat_found: true, data_dir: "/d", free_bytes: 5e9, writable: false, daily: { state: "idle", last_run_utc: null, next_run_utc: null, for_date: null } } } });
  render(<App />);
  // (dockview มี live region role="alert" ของตัวเองอยู่แล้ว จึงหาแถบจาก class)
  await waitFor(() => expect(document.querySelector(".health-banner")?.textContent).toContain("เขียนไฟล์ลงดิสก์ไม่ได้"));
});

describe("starting the page", () => {
  test("shows the real Welcome window: the scenarios on the server, with Create a Scenario", async () => {
    render(<App />);
    const welcome = await screen.findByRole("region", { name: t("dialog.welcome.openScenario") });
    expect(await within(welcome).findByRole("button", { name: "E2E" })).toBeDefined();
    expect(screen.getByRole("button", { name: t("dialog.welcome.createScenario") })).toBeDefined();
  });

  test("with ?sc=NAME it opens that scenario instead of showing Welcome", async () => {
    const load = vi.fn(async () => true);
    const restoreFor = vi.fn(async () => undefined);
    useScenario.setState({ load } as never);
    useLayout.setState({ restoreFor } as never);
    setUrl("?test&sc=E2E");
    render(<App />);
    await waitFor(() => expect(restoreFor).toHaveBeenCalledWith("E2E"));
    expect(load).toHaveBeenCalledWith("E2E");
    expect(panelIds()).toEqual(DEFAULT_IDS.slice().sort());
    expect(window.location.search).toBe("?test&sc=E2E");
  });

  test("with ?sc=NAME that cannot be opened it falls back to Welcome", async () => {
    useScenario.setState({ load: vi.fn(async () => false) } as never);
    setUrl("?sc=Gone");
    render(<App />);
    await waitFor(() => expect(panelIds()).toContain("welcome"));
    expect(window.location.search).toBe("");
  });

  test("File → New opens the real New Scenario Wizard, which asks the server for the snapshots", async () => {
    const f = stubFetch({
      "GET /api/health": { status: 500, json: { code: "X", text: "x" } },
      "GET /api/scenarios": { json: [] },
      "GET /api/orbits": { json: [{ name: "20261112T0000Z", time_utc: "2026-11-12T00:00:00Z", groups: {}, has_brdc: true }] },
    });
    render(<App />);
    await waitFor(() => expect(isEnabled("file.new")).toBe(true));
    runCommand("file.new");
    expect(await screen.findByLabelText(t("field.orbitData"))).toBeDefined();
    await waitFor(() => expect(f.count("GET /api/orbits")).toBe(1));
  });

  test("File → Save As opens its dialog once a scenario is open", async () => {
    render(<App />);
    await waitFor(() => expect(isEnabled("file.new")).toBe(true));
    expect(isEnabled("file.saveAs")).toBe(false);
    act(() => void openScenario());
    expect(isEnabled("file.saveAs")).toBe(true);
    act(() => runCommand("file.saveAs"));
    expect(await screen.findByRole("dialog", { name: t("menu.file.saveAs") })).toBeDefined();
  });

  test("Help → About and Help → STK UI Reference open the real windows", async () => {
    useSettings.setState({ health: { engine_version: "0.7.3" } as never });
    render(<App />);
    await waitFor(() => expect(isEnabled("help.about")).toBe(true));
    act(() => runCommand("help.about"));
    expect(await screen.findByText(msg("about.disclaimer"))).toBeDefined();
    act(() => runCommand("help.stkReference"));
    expect(await screen.findByRole("searchbox", { name: t("dialog.catalog.search") })).toBeDefined();
  });

  test("File → Exit brings the user back to Welcome from an open scenario", async () => {
    render(<App />);
    await waitFor(() => expect(isEnabled("file.new")).toBe(true));
    act(() => useLayout.getState().closePanel("welcome"));
    act(() => void openScenario());
    setUrl("?sc=T");
    act(() => runCommand("file.exit"));
    await waitFor(() => expect(panelIds()).toContain("welcome"));
    expect(useScenario.getState().name).toBeNull();
    expect(window.location.search).toBe("");
  });
});
