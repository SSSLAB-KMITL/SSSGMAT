// แถบเมนู แถบเครื่องมือ และแถบสถานะที่โยน exception ตอนวาดต้องไม่ทำให้หน้าต่างทั้งหมดหาย (App ห่อส่วนเหล่านี้ด้วย error boundary)
// แถบสถานะปลอมโยนเมื่อ crash = true (ตัวอย่างจริง: progress null ของ job, manifest ที่ satellites ไม่ใช่รายการ)

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { App } from "../../src/App";
import { resetCommands } from "../../src/commands";
import { t } from "../../src/labels/labels";
import { msg } from "../../src/labels/messages.th";
import { useLayout } from "../../src/stores/layout";
import { useMessages } from "../../src/stores/messages";
import { useScenario } from "../../src/stores/scenario";
import { useSettings } from "../../src/stores/settings";
import { stubFetch } from "./helpers/fake-fetch";
import { setUrl } from "./helpers/files";
import { takeReportedErrors } from "./helpers/reported-errors";

const state = vi.hoisted(() => ({ crash: true }));
vi.mock("../../src/time/clock", () => ({ startClock: () => () => undefined }));
vi.mock("../../src/api/events", () => ({ startEventWiring: () => () => undefined }));
vi.mock("../../src/chrome/StatusBar", () => ({
  StatusBar: () => {
    if (state.crash) throw new TypeError("manifest.satellites.flatMap is not a function");
    return <div>status bar is back</div>;
  },
}));

const DEFAULT_IDS = ["graphics2d", "graphics3d", "messageViewer", "objectBrowser", "timelineView"];
let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  state.crash = true;
  resetCommands();
  localStorage.clear();
  setUrl("");
  useLayout.setState(useLayout.getInitialState(), true);
  useScenario.setState(useScenario.getInitialState(), true);
  useSettings.setState(useSettings.getInitialState(), true);
  useMessages.setState(useMessages.getInitialState(), true);
  stubFetch({
    "GET /api/health": { status: 500, json: { code: "X", text: "x" } },
    "GET /api/scenarios": { json: [] },
  });
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  consoleError.mockRestore();
});

/** the boundary hands every caught error to window.reportError (setup.ts fails a test that leaves any): these tests crash on purpose */
const reportedMessages = () => takeReportedErrors().map((e) => (e instanceof Error ? e.message : String(e)));
const CRASH = "manifest.satellites.flatMap is not a function";

test("a status bar that throws leaves the menu bar and every window alive, shows the Thai message there and reports it", async () => {
  render(<App />);
  await waitFor(() => expect((useLayout.getState().api?.panels ?? []).map((p) => p.id)).toEqual(expect.arrayContaining(DEFAULT_IDS)));
  expect(screen.getByRole("menubar")).toBeDefined();
  const footer = document.querySelector<HTMLElement>('[data-slot="footer"]')!;
  expect(footer.textContent).toContain(msg("chrome.crashed", { part: msg("chrome.part.footer") }));
  await waitFor(() => expect(useMessages.getState().items.map((m) => m.code)).toContain("CHROME_CRASH"));
  expect(useMessages.getState().items.find((m) => m.code === "CHROME_CRASH")!.text).toBe(
    msg("chrome.crashedLog", { part: msg("chrome.part.footer"), message: "manifest.satellites.flatMap is not a function" }),
  );
  expect(reportedMessages()).toEqual([CRASH]); // also an uncaught error of the page, so e2e (pageerror) and setup.ts see it
});

test("Retry draws the status bar again", async () => {
  render(<App />);
  const retry = await screen.findByRole("button", { name: t("dialog.retry") });
  state.crash = false;
  fireEvent.click(retry);
  expect(await screen.findByText("status bar is back")).toBeDefined();
  expect(reportedMessages()).toEqual([CRASH]); // the first try only
});
