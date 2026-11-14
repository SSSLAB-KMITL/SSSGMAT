// สวิตช์และรายการชั้นภาพ GIBS ของหน้าเว็บ (spec imagery §5.1, src/stores/imagery.ts)
// - load = GET /api/imagery/layers ครั้งเดียวตอนเริ่มแอป ล้มเหลว = ปิดไว้พร้อมคำเตือนไทย
// - setEnabled = GET /api/settings แล้ว PUT ทั้งเอกสารที่แก้แค่ online_imagery.enabled (server ไม่รับเอกสารไม่ครบ)

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useImagery } from "../../src/stores/imagery";
import { useMessages } from "../../src/stores/messages";
import { useSettings, type Settings } from "../../src/stores/settings";
import { stubFetch } from "./helpers/fake-fetch";

const THAI = /[฀-๿]/;

const IMAGERY_OFF = { enabled: false, eox: false, osm: false, ion: false };
const SETTINGS: Settings = {
  daily: { enabled: true, run_at_utc: "21:00", facility: "THBK", retention_days: 30, validation_retry_hours: 3, validation_give_up_days: 14 },
  cesium_ion_token: "tok",
  online_imagery: IMAGERY_OFF,
};

const LAYERS = {
  enabled: true,
  layers: [
    { id: "BlueMarble_NextGeneration", title: "Blue Marble", period: "static", max_level: 8, format: "jpg", credit: "NASA GIBS / EOSDIS" },
    { id: "VIIRS_NOAA20_CorrectedReflectance_TrueColor", title: "VIIRS NOAA-20 True Color", period: "daily", max_level: 9, format: "jpg", credit: "NASA GIBS / EOSDIS" },
  ],
};

beforeEach(() => {
  useImagery.setState(useImagery.getInitialState(), true);
  useSettings.setState(useSettings.getInitialState(), true);
  useMessages.setState(useMessages.getInitialState(), true);
});
afterEach(() => vi.unstubAllGlobals());

const warnings = () => useMessages.getState().items.filter((m) => m.level === "warning");

describe("useImagery", () => {
  test("starts off, empty and not loaded", () => {
    const s = useImagery.getState();
    expect(s.enabled).toBe(false);
    expect(s.layers).toEqual([]);
    expect(s.loaded).toBe(false);
  });

  test("load keeps the switch and the catalog the server sends", async () => {
    const f = stubFetch({ "GET /api/imagery/layers": { json: LAYERS } });
    await useImagery.getState().load();
    expect(f.count("GET /api/imagery/layers")).toBe(1);
    const s = useImagery.getState();
    expect(s.enabled).toBe(true);
    expect(s.loaded).toBe(true);
    expect(s.layers).toEqual(LAYERS.layers);
  });

  test("load that fails keeps the switch off and reports a Thai warning", async () => {
    stubFetch({ "GET /api/imagery/layers": { status: 500, text: "boom" } });
    await useImagery.getState().load();
    expect(useImagery.getState().enabled).toBe(false);
    expect(useImagery.getState().loaded).toBe(false);
    expect(warnings()).toHaveLength(1);
    expect(warnings()[0].text).toMatch(THAI);
  });

  test("setEnabled(true) reads the settings, then PUTs the whole document with online_imagery.enabled true", async () => {
    const f = stubFetch({ "GET /api/settings": { json: SETTINGS }, "PUT /api/settings": (c) => ({ json: c.body }) });
    await useImagery.getState().setEnabled(true);
    expect(f.calls.map((c) => `${c.method} ${c.path}`)).toEqual(["GET /api/settings", "PUT /api/settings"]);
    expect(f.calls[1].body).toEqual({ ...SETTINGS, online_imagery: { ...IMAGERY_OFF, enabled: true } });
    expect(useImagery.getState().enabled).toBe(true);
    // ค่าตั้งที่ store ของค่าตั้งถือไว้ตามทัน (Daily Forecast Settings ส่งค่าที่ store ถือคืนไปตอน Apply ไม่ทับสวิตช์กลับ)
    expect(useSettings.getState().settings?.online_imagery.enabled).toBe(true);
    expect(warnings()).toEqual([]);
  });

  test("setEnabled(false) PUTs enabled false and turns the switch off", async () => {
    useImagery.setState({ enabled: true });
    const f = stubFetch({ "GET /api/settings": { json: { ...SETTINGS, online_imagery: { ...IMAGERY_OFF, enabled: true } } }, "PUT /api/settings": (c) => ({ json: c.body }) });
    await useImagery.getState().setEnabled(false);
    expect(f.calls[1].body).toEqual({ ...SETTINGS, online_imagery: IMAGERY_OFF });
    expect(useImagery.getState().enabled).toBe(false);
  });

  test("setEnabled changes only the GIBS flag: the eox, osm and ion flags and the token travel back as loaded", async () => {
    const others = { eox: true, osm: false, ion: true };
    const loaded = { ...SETTINGS, cesium_ion_token: "tok-keep", online_imagery: { enabled: false, ...others } };
    const f = stubFetch({ "GET /api/settings": { json: loaded }, "PUT /api/settings": (c) => ({ json: c.body }) });
    await useImagery.getState().setEnabled(true);
    expect(f.calls[1].body).toEqual({ ...loaded, online_imagery: { enabled: true, ...others } });
    expect(useSettings.getState().settings?.online_imagery).toEqual({ enabled: true, ...others });
    f.calls.length = 0;
    await useImagery.getState().setEnabled(false);
    expect(f.calls[1].body).toEqual({ ...loaded, online_imagery: { enabled: false, ...others } });
  });

  test("a PUT that fails keeps the switch off and reports a Thai warning", async () => {
    stubFetch({ "GET /api/settings": { json: SETTINGS }, "PUT /api/settings": { status: 422, json: { code: "SETTINGS_INVALID", text: "ค่าผิด", field: null } } });
    await useImagery.getState().setEnabled(true);
    expect(useImagery.getState().enabled).toBe(false);
    expect(warnings()).toHaveLength(1);
    expect(warnings()[0].text).toMatch(THAI);
  });

  test("a GET that fails never PUTs, keeps the switch off and reports a Thai warning", async () => {
    const f = stubFetch({ "GET /api/settings": { status: 500, text: "boom" } });
    await useImagery.getState().setEnabled(true);
    expect(f.count("PUT /api/settings")).toBe(0);
    expect(useImagery.getState().enabled).toBe(false);
    expect(warnings()).toHaveLength(1);
    expect(warnings()[0].text).toMatch(THAI);
  });
});
