// สวิตช์ต่อแหล่งและรายการชั้นภาพออนไลน์ของหน้าเว็บ (spec imagery §5.1, spec ภาพละเอียด §2, §4, src/stores/imagery.ts)
// - load = GET /api/imagery/layers ครั้งเดียวตอนเริ่มแอป ล้มเหลว = ปิดทุกแหล่งพร้อมคำเตือนไทย
// - setSource(id, on) = GET /api/settings แล้ว PUT ทั้งเอกสารที่แก้แค่สวิตช์ของแหล่งนั้น (server ไม่รับเอกสารไม่ครบ)
// - updateSettings(patch) = ตัวช่วยเดียวกันที่ setSource ใช้ (GET แล้ว PUT ทั้งเอกสารที่แก้ด้วย patch แล้วตั้งสวิตช์ตามเอกสารที่ server ตอบ) ใช้กับ token ของ Cesium ion ด้วย

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

const SOURCES_OFF = { gibs: false, eox: false, osm: false, ion: false };
const EOX = {
  id: "s2cloudless-2024_3857", title: "Sentinel-2 cloudless 2024", period: "static", max_level: 15, format: "jpg",
  credit: "Sentinel-2 cloudless - https://s2maps.eu by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2024)", source: "eox",
};
const LAYERS = {
  enabled: true,
  sources: { ...SOURCES_OFF, gibs: true },
  layers: [
    { id: "BlueMarble_NextGeneration", title: "Blue Marble", period: "static", max_level: 8, format: "jpg", credit: "NASA GIBS / EOSDIS", source: "gibs" },
    { id: "VIIRS_NOAA20_CorrectedReflectance_TrueColor", title: "VIIRS NOAA-20 True Color", period: "daily", max_level: 9, format: "jpg", credit: "NASA GIBS / EOSDIS", source: "gibs" },
    EOX,
  ],
};
const FLAG = { gibs: "enabled", eox: "eox", osm: "osm", ion: "ion" } as const;

beforeEach(() => {
  useImagery.setState(useImagery.getInitialState(), true);
  useSettings.setState(useSettings.getInitialState(), true);
  useMessages.setState(useMessages.getInitialState(), true);
});
afterEach(() => vi.unstubAllGlobals());

const warnings = () => useMessages.getState().items.filter((m) => m.level === "warning");

describe("useImagery", () => {
  test("starts with every source off, empty and not loaded", () => {
    const s = useImagery.getState();
    expect(s.sources).toEqual(SOURCES_OFF);
    expect(s.layers).toEqual([]);
    expect(s.loaded).toBe(false);
  });

  test("load keeps every source switch and the catalog (with each layer's source) the server sends", async () => {
    const f = stubFetch({ "GET /api/imagery/layers": { json: { ...LAYERS, sources: { gibs: true, eox: true, osm: false, ion: false } } } });
    await useImagery.getState().load();
    expect(f.count("GET /api/imagery/layers")).toBe(1);
    const s = useImagery.getState();
    expect(s.sources).toEqual({ gibs: true, eox: true, osm: false, ion: false });
    expect(s.loaded).toBe(true);
    expect(s.layers).toEqual(LAYERS.layers);
    expect(f.count("GET /api/settings")).toBe(0); // ion ปิด: ไม่ต้องอ่าน token
  });

  test("load: a flag that is not exactly true is off; a layer without source is GIBS (older payload); unknown sources are dropped", async () => {
    const bare = { id: "X", title: "X", period: "static", max_level: 3, format: "jpg", credit: "c" };
    stubFetch({
      "GET /api/imagery/layers": {
        json: { enabled: true, sources: { gibs: true, eox: "yes", osm: 1, ion: null }, layers: [bare, { ...bare, id: "Y", source: "mars" }, EOX] },
      },
    });
    await useImagery.getState().load();
    expect(useImagery.getState().sources).toEqual({ ...SOURCES_OFF, gibs: true });
    expect(useImagery.getState().layers).toEqual([{ ...bare, source: "gibs" }, EOX]);
  });

  test("load with Cesium ion on also reads the settings (the token lives there) once", async () => {
    const f = stubFetch({
      "GET /api/imagery/layers": { json: { ...LAYERS, sources: { ...SOURCES_OFF, ion: true } } },
      "GET /api/settings": { json: { ...SETTINGS, online_imagery: { ...IMAGERY_OFF, ion: true } } },
    });
    await useImagery.getState().load();
    expect(f.count("GET /api/settings")).toBe(1);
    expect(useSettings.getState().settings?.cesium_ion_token).toBe("tok");
    expect(warnings()).toEqual([]);
  });

  test("load with ion on whose settings read fails: a Thai warning without the token, the switches stay as loaded", async () => {
    stubFetch({ "GET /api/imagery/layers": { json: { ...LAYERS, sources: { ...SOURCES_OFF, ion: true } } }, "GET /api/settings": { status: 500, text: "boom" } });
    await useImagery.getState().load();
    expect(useImagery.getState().sources.ion).toBe(true);
    expect(warnings()).toHaveLength(1);
    expect(warnings()[0].text).toMatch(THAI);
  });

  test("load that fails keeps every source off and reports a Thai warning", async () => {
    stubFetch({ "GET /api/imagery/layers": { status: 500, text: "boom" } });
    await useImagery.getState().load();
    expect(useImagery.getState().sources).toEqual(SOURCES_OFF);
    expect(useImagery.getState().loaded).toBe(false);
    expect(warnings()).toHaveLength(1);
    expect(warnings()[0].text).toMatch(THAI);
  });

  test.each(["gibs", "eox", "osm", "ion"] as const)("setSource(%s, true) reads the settings, then PUTs the whole document with only that flag changed", async (id) => {
    const loaded = { ...SETTINGS, cesium_ion_token: "tok-keep" };
    const f = stubFetch({ "GET /api/settings": { json: loaded }, "PUT /api/settings": (c) => ({ json: c.body }) });
    await useImagery.getState().setSource(id, true);
    expect(f.calls.map((c) => `${c.method} ${c.path}`)).toEqual(["GET /api/settings", "PUT /api/settings"]);
    expect(f.calls[1].body).toEqual({ ...loaded, online_imagery: { ...IMAGERY_OFF, [FLAG[id]]: true } });
    expect(useImagery.getState().sources).toEqual({ ...SOURCES_OFF, [id]: true });
    // ค่าตั้งที่ store ของค่าตั้งถือไว้ตามทัน (Daily Forecast Settings ส่งค่าที่ store ถือคืนไปตอน Apply ไม่ทับสวิตช์กลับ)
    expect(useSettings.getState().settings?.online_imagery[FLAG[id]]).toBe(true);
    expect(useSettings.getState().settings?.cesium_ion_token).toBe("tok-keep");
    expect(warnings()).toEqual([]);
  });

  test("setSource(gibs, false) PUTs enabled false and turns only that switch off", async () => {
    useImagery.setState({ sources: { gibs: true, eox: true, osm: true, ion: true } });
    const all = { enabled: true, eox: true, osm: true, ion: true };
    const f = stubFetch({ "GET /api/settings": { json: { ...SETTINGS, online_imagery: all } }, "PUT /api/settings": (c) => ({ json: c.body }) });
    await useImagery.getState().setSource("gibs", false);
    expect(f.calls[1].body).toEqual({ ...SETTINGS, online_imagery: { ...all, enabled: false } });
    expect(useImagery.getState().sources).toEqual({ gibs: false, eox: true, osm: true, ion: true });
  });

  test("setSource changes only its own flag: the other flags and the token travel back as loaded", async () => {
    const others = { enabled: true, osm: false, ion: true };
    const loaded = { ...SETTINGS, cesium_ion_token: "tok-keep", online_imagery: { eox: false, ...others } };
    const f = stubFetch({ "GET /api/settings": { json: loaded }, "PUT /api/settings": (c) => ({ json: c.body }) });
    await useImagery.getState().setSource("eox", true);
    expect(f.calls[1].body).toEqual({ ...loaded, online_imagery: { eox: true, ...others } });
    expect(useSettings.getState().settings?.online_imagery).toEqual({ eox: true, ...others });
    // สวิตช์ทั้งหมดตามเอกสารที่ server ตอบ (ไม่มีแหล่งใดเปิดเพราะอีกแหล่งเปิด)
    expect(useImagery.getState().sources).toEqual({ gibs: true, eox: true, osm: false, ion: true });
    f.calls.length = 0;
    await useImagery.getState().setSource("eox", false);
    expect(f.calls[1].body).toEqual({ ...loaded, online_imagery: { eox: false, ...others } });
  });

  test("a PUT that fails keeps the switch as it was and reports a Thai warning naming the source", async () => {
    stubFetch({ "GET /api/settings": { json: SETTINGS }, "PUT /api/settings": { status: 422, json: { code: "SETTINGS_INVALID", text: "ค่าผิด", field: null } } });
    await useImagery.getState().setSource("osm", true);
    expect(useImagery.getState().sources).toEqual(SOURCES_OFF);
    expect(warnings()).toHaveLength(1);
    expect(warnings()[0].text).toMatch(THAI);
    expect(warnings()[0].text).toContain("OpenStreetMap");
    expect(warnings()[0].text).not.toContain("tok");
  });

  test("a GET that fails never PUTs, keeps the switch off and reports a Thai warning", async () => {
    const f = stubFetch({ "GET /api/settings": { status: 500, text: "boom" } });
    await useImagery.getState().setSource("gibs", true);
    expect(f.count("PUT /api/settings")).toBe(0);
    expect(useImagery.getState().sources.gibs).toBe(false);
    expect(warnings()).toHaveLength(1);
    expect(warnings()[0].text).toMatch(THAI);
    expect(warnings()[0].text).toContain("NASA GIBS");
  });
});

describe("useImagery.updateSettings", () => {
  test("reads the settings, PUTs the whole document changed by the patch, and takes every switch from the document the server answered", async () => {
    // อีกเครื่อง/หน้าต่างเปิด eox ไว้ที่ server แล้ว: store ของสวิตช์ยังเป็นปิด การบันทึก token ต้องตามให้ทัน
    const onServer = { ...SETTINGS, online_imagery: { enabled: false, eox: true, osm: false, ion: true } };
    const f = stubFetch({ "GET /api/settings": { json: onServer }, "PUT /api/settings": (c) => ({ json: c.body }) });
    await useImagery.getState().updateSettings((current) => ({ ...current, cesium_ion_token: "tok-new" }));
    expect(f.calls.map((c) => `${c.method} ${c.path}`)).toEqual(["GET /api/settings", "PUT /api/settings"]);
    expect(f.calls[1].body).toEqual({ ...onServer, cesium_ion_token: "tok-new" });
    expect(useImagery.getState().sources).toEqual({ gibs: false, eox: true, osm: false, ion: true });
    expect(useSettings.getState().settings?.cesium_ion_token).toBe("tok-new");
    expect(warnings()).toEqual([]);
  });

  test("a failed PUT throws, leaves the switches as they were and reports nothing (the caller shows it)", async () => {
    useImagery.setState({ sources: { ...SOURCES_OFF, gibs: true } });
    stubFetch({
      "GET /api/settings": { json: { ...SETTINGS, online_imagery: { ...IMAGERY_OFF, eox: true } } },
      "PUT /api/settings": { status: 500, json: { code: "INTERNAL", text: "พัง", field: null, detail: null } },
    });
    await expect(useImagery.getState().updateSettings((c) => ({ ...c, cesium_ion_token: "t" }))).rejects.toMatchObject({ text: "พัง" });
    expect(useImagery.getState().sources).toEqual({ ...SOURCES_OFF, gibs: true });
    expect(warnings()).toEqual([]);
  });

  test("a failed GET throws before any PUT", async () => {
    const f = stubFetch({ "GET /api/settings": { status: 500, text: "boom" } });
    await expect(useImagery.getState().updateSettings((c) => c)).rejects.toBeDefined();
    expect(f.count("PUT /api/settings")).toBe(0);
  });
});
