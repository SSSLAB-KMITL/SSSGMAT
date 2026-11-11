import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useSettings } from "../../src/stores/settings";
import { stubFetch } from "./helpers/fake-fetch";

const HEALTH = {
  engine_version: "1.0.0", gmat_found: true, data_dir: "/data", free_bytes: 5e9, writable: true,
  daily: { state: "idle", last_run_utc: null, next_run_utc: "2026-11-12T21:00:00.000Z", for_date: null },
};
const SETTINGS = {
  daily: { enabled: false, run_at_utc: "21:00", facility: "THBK", retention_days: 30, validation_retry_hours: 3, validation_give_up_days: 14 },
  cesium_ion_token: "",
};

beforeEach(() => useSettings.setState(useSettings.getInitialState(), true));
afterEach(() => vi.unstubAllGlobals());

describe("useSettings", () => {
  test("starts disconnected with nothing loaded", () => {
    const s = useSettings.getState();
    expect(s.connected).toBe(false);
    expect(s.health).toBeNull();
    expect(s.settings).toBeNull();
  });

  test("loadHealth and loadSettings store what the server sends", async () => {
    stubFetch({ "GET /api/health": { json: HEALTH }, "GET /api/settings": { json: SETTINGS } });
    await useSettings.getState().loadHealth();
    await useSettings.getState().loadSettings();
    expect(useSettings.getState().health?.free_bytes).toBe(5e9);
    expect(useSettings.getState().settings?.daily.run_at_utc).toBe("21:00");
  });

  test("saveSettings PUTs the settings and keeps the saved copy", async () => {
    const f = stubFetch({ "PUT /api/settings": (c) => ({ json: c.body }) });
    await useSettings.getState().saveSettings({ ...SETTINGS, cesium_ion_token: "t" });
    expect(f.calls[0].body).toEqual({ ...SETTINGS, cesium_ion_token: "t" });
    expect(useSettings.getState().settings?.cesium_ion_token).toBe("t");
  });

  test("saveSettings with a rejected value throws the ApiError and keeps the old settings", async () => {
    stubFetch({ "GET /api/settings": { json: SETTINGS }, "PUT /api/settings": { status: 422, json: { code: "SCENARIO_INVALID", text: "ค่าผิด", field: "daily.facility" } } });
    await useSettings.getState().loadSettings();
    await expect(useSettings.getState().saveSettings({ ...SETTINGS, daily: { ...SETTINGS.daily, facility: "X" } })).rejects.toMatchObject({ field: "daily.facility" });
    expect(useSettings.getState().settings?.daily.facility).toBe("THBK");
  });

  test("loadHealth never throws (the status bar polls it) and keeps the last health", async () => {
    stubFetch({ "GET /api/health": { json: HEALTH } });
    await useSettings.getState().loadHealth();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await expect(useSettings.getState().loadHealth()).resolves.toBeUndefined();
    expect(useSettings.getState().health?.engine_version).toBe("1.0.0");
  });

  test("loadSettings lets the error through so a dialog can show it", async () => {
    stubFetch({ "GET /api/settings": { status: 500, json: { code: "INTERNAL", text: "ขัดข้อง" } } });
    await expect(useSettings.getState().loadSettings()).rejects.toMatchObject({ code: "INTERNAL" });
  });
});
