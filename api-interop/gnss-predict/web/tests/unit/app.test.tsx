import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { startEventWiring } from "../../src/api/events";
import { isEnabled, resetCommands } from "../../src/commands";
import { t } from "../../src/labels/labels";
import { startClock } from "../../src/time/clock";
import { useLayout } from "../../src/stores/layout";
import { App } from "../../src/App";
import { useSettings } from "../../src/stores/settings";
import { stubFetch } from "./helpers/fake-fetch";

vi.mock("../../src/time/clock", () => ({ startClock: vi.fn() }));
vi.mock("../../src/api/events", () => ({ startEventWiring: vi.fn() }));

const stopClock = vi.fn();
const stopEvents = vi.fn();

beforeEach(() => {
  resetCommands();
  useLayout.setState(useLayout.getInitialState(), true);
  useSettings.setState(useSettings.getInitialState(), true);
  stubFetch({ "GET /api/health": { status: 500, json: { code: "X", text: "x" } } }); // the health banner polls; keep it off the network
  vi.mocked(startClock).mockReset().mockReturnValue(stopClock);
  vi.mocked(startEventWiring).mockReset().mockReturnValue(stopEvents);
  stopClock.mockReset();
  stopEvents.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("App renders the workspace with the default layout", async () => {
  const { container } = render(<App />);
  await waitFor(() => expect(useLayout.getState().api?.panels).toHaveLength(5));
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
  // dockview ไม่สร้างใหม่ตอน StrictMode เล่น effect ซ้ำ: store ต้องยังถือ api ตัวเดิมที่ยังทำงานอยู่
  expect(useLayout.getState().api?.panels).toHaveLength(5);
  unmount();
  expect(useLayout.getState().api).toBeNull();
  expect(stopClock).toHaveBeenCalledTimes(vi.mocked(startClock).mock.calls.length);
  expect(stopEvents).toHaveBeenCalledTimes(vi.mocked(startEventWiring).mock.calls.length);
});

test("App puts the menu bar, both toolbars and the status bar around the windows", async () => {
  render(<App />);
  await waitFor(() => expect(useLayout.getState().api?.panels).toHaveLength(5));
  const header = document.querySelector('[data-slot="header"]')!;
  const footer = document.querySelector('[data-slot="footer"]')!;
  expect(within(header as HTMLElement).getByRole("menubar")).toBeDefined();
  expect(within(header as HTMLElement).getByRole("toolbar", { name: t("toolbar.default") })).toBeDefined();
  expect(within(header as HTMLElement).getByRole("toolbar", { name: t("toolbar.animation") })).toBeDefined();
  expect(footer.querySelector('[data-field="activeObject"]')).not.toBeNull();
});

test("App registers the view, window and animation commands, and the others stay disabled", async () => {
  render(<App />);
  await waitFor(() => expect(useLayout.getState().api).not.toBeNull());
  await waitFor(() => expect(isEnabled("view.new3d")).toBe(true));
  expect(isEnabled("window.windows")).toBe(true);
  expect(isEnabled("file.save")).toBe(false);
  expect(isEnabled("analysis.access")).toBe(false);
  // และเมนูตามทัน: รายการ View ที่ลงทะเบียนแล้วไม่ aria-disabled
  expect(screen.getByRole("menubar")).toBeDefined();
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
