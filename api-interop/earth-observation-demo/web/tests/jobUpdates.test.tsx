import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useJobUpdates } from "../src/useJobUpdates";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("uses short requests, refreshes completed work and leaves background tabs quiet", async () => {
  vi.useFakeTimers();
  let hidden = false,
    state = "queued";
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  const stream = vi.fn();
  vi.stubGlobal("EventSource", stream);
  const fetcher = vi.fn(async () => ({
    ok: true,
    json: async () => [{ id: "job", state }],
  }));
  vi.stubGlobal("fetch", fetcher);
  const jobs = vi.fn(),
    refresh = vi.fn(async () => {});
  function Harness({ enabled = true }) {
    useJobUpdates(jobs, refresh, enabled);
    return null;
  }
  const { rerender } = render(<Harness />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(stream).not.toHaveBeenCalled();
  expect(fetcher).toHaveBeenCalledTimes(1);
  state = "completed";
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(refresh).toHaveBeenCalledTimes(1);
  hidden = true;
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  const before = fetcher.mock.calls.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30000);
  });
  expect(fetcher).toHaveBeenCalledTimes(before);
  hidden = false;
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(fetcher).toHaveBeenCalledTimes(before + 1);
  rerender(<Harness enabled={false} />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30000);
  });
  expect(fetcher).toHaveBeenCalledTimes(before + 1);
});
