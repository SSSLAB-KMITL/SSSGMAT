import { cleanup, render, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { startEventWiring } from "../../src/api/events";
import { startClock } from "../../src/time/clock";
import { useLayout } from "../../src/stores/layout";
import { App } from "../../src/App";

vi.mock("../../src/time/clock", () => ({ startClock: vi.fn() }));
vi.mock("../../src/api/events", () => ({ startEventWiring: vi.fn() }));

const stopClock = vi.fn();
const stopEvents = vi.fn();

beforeEach(() => {
  useLayout.setState(useLayout.getInitialState(), true);
  vi.mocked(startClock).mockReset().mockReturnValue(stopClock);
  vi.mocked(startEventWiring).mockReset().mockReturnValue(stopEvents);
  stopClock.mockReset();
  stopEvents.mockReset();
});
afterEach(cleanup);

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
