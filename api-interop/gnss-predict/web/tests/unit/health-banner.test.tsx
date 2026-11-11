import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { HealthBanner, LOW_DISK_BYTES } from "../../src/chrome/HealthBanner";
import { msg } from "../../src/labels/messages.th";
import { useSettings, type HealthInfo } from "../../src/stores/settings";
import { resetAll } from "./helpers/chrome";
import { stubFetch } from "./helpers/fake-fetch";

const health = (over: Partial<HealthInfo> = {}): HealthInfo => ({
  engine_version: "1", gmat_found: true, data_dir: "/d", free_bytes: 10_000_000_000, writable: true,
  daily: { state: "idle", last_run_utc: null, next_run_utc: null, for_date: null }, ...over,
});

beforeEach(() => {
  resetAll();
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** แสดงแถบโดยให้การดึง /health ตอบค่าที่กำหนด แล้วรอให้การดึงครั้งแรกเสร็จ */
async function show(h: HealthInfo | null) {
  const api = stubFetch({ "GET /api/health": h === null ? { status: 500, json: { code: "X", text: "x" } } : { json: h } });
  render(<HealthBanner />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  return api;
}

describe("HealthBanner", () => {
  test("is absent when the disk is writable and has room", async () => {
    await show(health());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("is absent before health is known", async () => {
    await show(null);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("warns in Thai when the server cannot write", async () => {
    await show(health({ writable: false }));
    expect(screen.getByRole("alert").textContent).toContain(msg("disk.notWritable"));
  });

  test("warns in Thai with the free megabytes when free_bytes is under 500 MB", async () => {
    await show(health({ free_bytes: 120_500_000 }));
    expect(screen.getByRole("alert").textContent).toBe(msg("disk.low", { free_mb: 120 }));
  });

  test("500 MB exactly is enough; 1 byte less is not", async () => {
    await show(health({ free_bytes: LOW_DISK_BYTES }));
    expect(screen.queryByRole("alert")).toBeNull();
    act(() => useSettings.setState({ health: health({ free_bytes: LOW_DISK_BYTES - 1 }) }));
    expect(screen.getByRole("alert")).toBeDefined();
  });

  test("an unknown free size (null) is not a warning", async () => {
    await show(health({ free_bytes: null }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("shows both lines when the disk is read-only and nearly full", async () => {
    await show(health({ writable: false, free_bytes: 1_000_000 }));
    const text = screen.getByRole("alert").textContent!;
    expect(text).toContain(msg("disk.notWritable"));
    expect(text).toContain(msg("disk.low", { free_mb: 1 }));
  });

  test("goes away when health recovers", async () => {
    await show(health({ writable: false }));
    act(() => useSettings.setState({ health: health() }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("loads health on start and again every 60 seconds, and stops when removed", async () => {
    const api = await show(health());
    expect(api.count("GET /api/health")).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(59_000);
    });
    expect(api.count("GET /api/health")).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(api.count("GET /api/health")).toBe(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(api.count("GET /api/health")).toBe(3);
    cleanup();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(api.count("GET /api/health")).toBe(3);
  });
});
