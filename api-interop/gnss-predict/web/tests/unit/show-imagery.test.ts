// Show Imagery (ข2 Task 7, Ruling f, n, o, p และ amendment x, z): ดาวถ่ายภาพที่มี preset ตาม NORAD
// - GIBS ปิด = ถามด้วยกล่องเดียวกับ Globe Manager ก่อน (enableSourceWithConsent) ยกเลิก = ไม่มีคำขอ ไม่แตะชั้นภาพ ไม่เปิดหน้าต่าง
// - ชั้น GIBS ของดาวแสดง และชั้นทึบที่อยู่เหนือมัน (EOX, OpenStreetMap, ion) ถูกซ่อนพร้อมข้อความไทยหนึ่งข้อความ
// - มี sensor ลูก = เปิด Sensor View ของ sensor ตัวแรก ไม่มี = กล้อง 3D บินไปเหนือจุดใต้ดาว ไม่สร้าง object ใด
// - ไม่ต่อเครือข่ายจริง: fetch ปลอมทุกครั้ง และ confirm ปลอม (ข้อความที่ถามเก็บไว้ตรวจ)

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { confirm } from "../../src/chrome/Dialogs";
import { isEnabled, isRegistered, runCommand } from "../../src/commands";
import { msg } from "../../src/labels/messages.th";
import { OSM_LAYER, useImagery, type ImageryLayerInfo, type ImagerySourceId } from "../../src/stores/imagery";
import { presetOfNorad, useImagingPresets, type ImagingPresetOut } from "../../src/stores/imagingPresets";
import { useLayout } from "../../src/stores/layout";
import { useMessages } from "../../src/stores/messages";
import { useScenario, type InsertBody, type ScenarioDoc } from "../../src/stores/scenario";
import { useSelection } from "../../src/stores/selection";
import { useSettings, type Settings } from "../../src/stores/settings";
import { registerScene, resetScenes, type Scene3DHandle } from "../../src/windows/Graphics3D/registry";
import { registerShowImageryCommand, showImagery } from "../../src/windows/GlobeManager/showImagery";
import { resetAll } from "./helpers/chrome";
import { stubFetch } from "./helpers/fake-fetch";
import { makeScenarioDoc, makeTree, satPath, sensorObj, sensorPath } from "./helpers/objects";

vi.mock("../../src/chrome/Dialogs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/chrome/Dialogs")>()),
  confirm: vi.fn(),
}));

const GIBS = "NASA GIBS / EOSDIS";
const MODIS_TERRA = "MODIS_Terra_CorrectedReflectance_TrueColor";
const LAYERS: ImageryLayerInfo[] = [
  { id: "BlueMarble_NextGeneration", title: "Blue Marble", period: "static", max_level: 8, format: "jpg", credit: GIBS, source: "gibs" },
  { id: "VIIRS_NOAA20_CorrectedReflectance_TrueColor", title: "VIIRS NOAA-20 True Color", period: "daily", max_level: 9, format: "jpg", credit: GIBS, source: "gibs" },
  { id: MODIS_TERRA, title: "MODIS Terra True Color", period: "daily", max_level: 9, format: "jpg", credit: GIBS, source: "gibs" },
  { id: "GOES-West_ABI_GeoColor", title: "GOES-West GeoColor", period: "10min", max_level: 7, format: "jpg", credit: `${GIBS}, NOAA`, source: "gibs" },
  { id: "s2cloudless-2024_3857", title: "Sentinel-2 cloudless 2024", period: "static", max_level: 15, format: "jpg", credit: "EOX", source: "eox" },
];
const EOX_TITLE = "Sentinel-2 cloudless 2024";

/** preset X04 ตามที่ GET /api/imaging/presets ส่ง (task 4 rows[3]) */
const X04: ImagingPresetOut = {
  prn: "X04", norad: 25994, name: "Terra", camera: "MODIS", gibs_layer: MODIS_TERRA,
  sensor: { type: "Rectangular", cone_half_angle: null, vertical_half_angle: 55.0, horizontal_half_angle: 0.41 },
};
const X01: ImagingPresetOut = {
  prn: "X01", norad: 41836, name: "Himawari-9", camera: "AHI", gibs_layer: "Himawari_AHI_Band3_Red_Visible_1km",
  sensor: { type: "Simple Conic", cone_half_angle: 8.7, vertical_half_angle: null, horizontal_half_angle: null },
};

const SETTINGS: Settings = {
  daily: { enabled: false, run_at_utc: "21:00", facility: "THBK", retention_days: 30, validation_retry_hours: 3, validation_give_up_days: 14 },
  cesium_ion_token: "tok-abc",
  online_imagery: { enabled: false, eox: false, osm: false, ion: false },
};
const SOURCES_OFF = { gibs: false, eox: false, osm: false, ion: false };
const PUT = "PUT /api/settings";
const POST_OBJECTS = "POST /api/scenarios/S1/objects";

/** Terra ที่ความสูง 705 km เหนือจุด (0°, 100°E) ในพิกัด Earth-fixed (m) ทรงกลมรัศมี 6371.0088 km */
const R_M = (6371.0088 + 705) * 1000;
const TERRA_ECEF: [number, number, number] = [R_M * Math.cos((100 * Math.PI) / 180), R_M * Math.sin((100 * Math.PI) / 180), 0];

const openPanel = vi.fn((_kind: string, _params?: Record<string, unknown>) => "sensorView-0");

/** scenario S1 ที่มี X04 (Terra) เพิ่มจาก G01–G05 ; sensors = sensor ลูกตามชื่อดาว */
function loadScene(sensors: Record<string, string[]> = { X04: ["MODIS"] }): ScenarioDoc {
  const base = makeScenarioDoc({}, {});
  const doc = {
    ...base,
    objects: [
      ...base.objects,
      { class: "Satellite", name: "X04", norad: 25994 },
      ...Object.entries(sensors).flatMap(([parent, names]) => names.map((name) => sensorObj(name, parent))),
    ],
  } as ScenarioDoc;
  const tree = makeTree({ loose: ["G03", "G04", "G05", "X04"], sensors });
  useScenario.setState({ name: "S1", doc, etag: '"e1"', tree, catalog: new Map() });
  return doc;
}

function server() {
  return stubFetch({
    "GET /api/settings": { json: SETTINGS },
    [PUT]: (call) => ({ json: call.body }),
    [POST_OBJECTS]: { status: 201, json: { created: [sensorPath("Sensor1")], etag: "e2", results_stale: false } },
  });
}
const puts = (f: ReturnType<typeof stubFetch>) => f.calls.filter((c) => `${c.method} ${c.path}` === PUT);
const urls = (f: ReturnType<typeof stubFetch>) => f.fn.mock.calls.map((c) => String(c[0]));
const answer = (ok: boolean) => vi.mocked(confirm).mockResolvedValue(ok);
const messages = (code: string) => useMessages.getState().items.filter((m) => m.code === code);
const sources = (on: Partial<Record<ImagerySourceId, boolean>>) => useImagery.setState({ sources: { ...SOURCES_OFF, ...on } });

/** ชั้นที่ viewer วาดตามลำดับ (ล่างขึ้นบน): แหล่งที่สวิตช์เปิดและ Show ติ๊ก GIBS → EOX → OSM (ลำดับเดียวกับ imageryLayers.ts) */
function drawnLayers(): string[] {
  const order = { gibs: 0, eox: 1, osm: 2 } as const;
  const { sources: on, layers } = useImagery.getState();
  const globe = useLayout.getState().globe.layers;
  return [...layers, OSM_LAYER].filter((l) => on[l.source] && globe[l.id]?.show === true).sort((a, b) => order[a.source] - order[b.source]).map((l) => l.id);
}

/** หน้าต่าง 3D ปลอม: ตำแหน่งของดาวและ flyOver ที่จำคำสั่งไว้ */
function scene3d(positions: Record<string, [number, number, number]>) {
  const flyOver = vi.fn((_lon: number, _lat: number, _heightM: number) => true);
  const handle = { panelId: "graphics3d", entityPositionEcef: (name: string) => positions[name] ?? null, flyOver } as unknown as Scene3DHandle;
  registerScene(handle);
  return flyOver;
}

beforeEach(() => {
  resetAll();
  resetScenes();
  vi.mocked(confirm).mockReset();
  openPanel.mockClear();
  useLayout.setState({ api: { panels: [] } as never, openPanel } as never);
  useImagery.setState(useImagery.getInitialState(), true);
  useImagery.setState({ loaded: true, layers: LAYERS, sources: SOURCES_OFF });
  useSettings.setState({ settings: SETTINGS });
  useImagingPresets.setState({ presets: [X01, X04], loaded: true });
  loadScene();
});
afterEach(() => {
  resetScenes();
  vi.unstubAllGlobals();
  useImagingPresets.setState(useImagingPresets.getInitialState(), true);
});

describe("Show Imagery with GIBS off", () => {
  test("show imagery with GIBS off asks first; cancel does nothing", async () => {
    const f = server();
    answer(false);
    const globe = useLayout.getState().globe;
    await showImagery(satPath("X04"));
    expect(vi.mocked(confirm).mock.calls).toEqual([[msg("globe.consent")]]);
    expect(puts(f)).toHaveLength(0);
    expect(f.calls).toHaveLength(0);
    expect(useLayout.getState().globe).toBe(globe);
    expect(useImagery.getState().sources.gibs).toBe(false);
    expect(openPanel).not.toHaveBeenCalled();
    expect(useMessages.getState().items).toEqual([]);
  });

  test("confirm sends one PUT with online_imagery.enabled true, shows the MODIS Terra layer and opens the Sensor View of */Sensor/MODIS; every request goes to /api/", async () => {
    const f = server();
    answer(true);
    await showImagery(satPath("X04"));
    expect(puts(f)).toHaveLength(1);
    expect((puts(f)[0].body as Settings).online_imagery.enabled).toBe(true);
    expect(useImagery.getState().sources.gibs).toBe(true);
    expect(useLayout.getState().globe.layers[MODIS_TERRA].show).toBe(true);
    expect(openPanel.mock.calls).toEqual([["sensorView", { path: sensorPath("MODIS"), up: "north", display: "camera", zoom: 1 }]]);
    expect(urls(f).length).toBeGreaterThan(0);
    for (const url of urls(f)) expect(url.startsWith("/api/"), url).toBe(true);
  });

  test("a failed save (the store reports it) ends there: no layer change and no window", async () => {
    stubFetch({ "GET /api/settings": { json: SETTINGS }, [PUT]: { status: 500, json: { code: "X", text: "boom" } } });
    answer(true);
    const globe = useLayout.getState().globe;
    await showImagery(satPath("X04"));
    expect(useLayout.getState().globe).toBe(globe);
    expect(openPanel).not.toHaveBeenCalled();
  });
});

describe("Show Imagery with GIBS on", () => {
  test("asks nothing and sends nothing, shows the layer and opens the first sensor's Sensor View", async () => {
    const f = server();
    sources({ gibs: true });
    await showImagery(satPath("X04"));
    expect(confirm).not.toHaveBeenCalled();
    expect(f.calls).toHaveLength(0);
    expect(useLayout.getState().globe.layers[MODIS_TERRA]).toEqual({ show: true, translucency: 0 });
    expect(openPanel.mock.calls).toEqual([["sensorView", { path: sensorPath("MODIS"), up: "north", display: "camera", zoom: 1 }]]);
  });

  test("keeps the layer's % Translucency", async () => {
    server();
    sources({ gibs: true });
    useLayout.getState().setGlobeLayer(MODIS_TERRA, { show: false, translucency: 30 });
    await showImagery(satPath("X04"));
    expect(useLayout.getState().globe.layers[MODIS_TERRA]).toEqual({ show: true, translucency: 30 });
  });

  test("a satellite with two sensors opens the first one in the tree", async () => {
    server();
    sources({ gibs: true });
    loadScene({ X04: ["MODIS", "Extra"] });
    await showImagery(satPath("X04"));
    expect(openPanel.mock.calls[0][1]).toMatchObject({ path: sensorPath("MODIS") });
  });

  test("a layer the server does not list is reported in Thai; the Sensor View still opens", async () => {
    server();
    sources({ gibs: true });
    useImagery.setState({ layers: LAYERS.filter((l) => l.id !== MODIS_TERRA) });
    const globe = useLayout.getState().globe;
    await showImagery(satPath("X04"));
    expect(messages("SHOW_IMAGERY_NO_LAYER").map((m) => [m.level, m.text])).toEqual([["warning", msg("showImagery.noLayer", { layer: MODIS_TERRA })]]);
    expect(msg("showImagery.noLayer", { layer: "L" })).toBe("ชั้นภาพ L ไม่มีในรายการของ server");
    expect(useLayout.getState().globe).toBe(globe);
    expect(openPanel).toHaveBeenCalledTimes(1);
  });
});

describe("opaque layers above the satellite's layer (amendment x, R-03)", () => {
  test("with OSM shown, Show Imagery for X04 hides OSM, MODIS Terra becomes the top shown layer, and one message is posted", async () => {
    server();
    sources({ gibs: true, osm: true });
    useLayout.getState().setGlobeLayer("osm", { show: true });
    await showImagery(satPath("X04"));
    expect(useLayout.getState().globe.layers.osm.show).toBe(false);
    expect(drawnLayers().at(-1)).toBe(MODIS_TERRA);
    expect(useImagery.getState().sources.osm).toBe(true); // สวิตช์แหล่งไม่ถูกแตะ
    const info = useMessages.getState().items;
    expect(info.map((m) => [m.level, m.code, m.text])).toEqual([
      ["info", "SHOW_IMAGERY_UNCOVERED", msg("showImagery.uncovered", { layers: "OpenStreetMap", layer: "MODIS Terra True Color" })],
    ]);
  });

  test("EOX and OSM shown (default EOX tick) are both hidden and named in one message; Blue Marble under the layer stays", async () => {
    server();
    sources({ gibs: true, eox: true, osm: true });
    useLayout.getState().setGlobeLayer("osm", { show: true });
    await showImagery(satPath("X04"));
    const layers = useLayout.getState().globe.layers;
    expect(layers["s2cloudless-2024_3857"].show).toBe(false);
    expect(layers.osm.show).toBe(false);
    expect(layers.BlueMarble_NextGeneration.show).toBe(true);
    expect(drawnLayers().at(-1)).toBe(MODIS_TERRA);
    expect(messages("SHOW_IMAGERY_UNCOVERED").map((m) => m.text)).toEqual([
      msg("showImagery.uncovered", { layers: `${EOX_TITLE}, OpenStreetMap`, layer: "MODIS Terra True Color" }),
    ]);
  });

  test("a translucent EOX, a layer of a source that is off, and a non-opaque GIBS layer above it are left alone, with no message", async () => {
    server();
    sources({ gibs: true, eox: true });
    useLayout.getState().setGlobeLayer("s2cloudless-2024_3857", { show: true, translucency: 50 });
    useLayout.getState().setGlobeLayer("osm", { show: true }); // สวิตช์ OSM ปิด: ไม่ได้วาด
    useLayout.getState().setGlobeLayer("GOES-West_ABI_GeoColor", { show: true }); // ผูกเวลา ไม่ทึบ
    await showImagery(satPath("X04"));
    const layers = useLayout.getState().globe.layers;
    expect(layers["s2cloudless-2024_3857"]).toEqual({ show: true, translucency: 50 });
    expect(layers.osm.show).toBe(true);
    expect(layers["GOES-West_ABI_GeoColor"].show).toBe(true);
    expect(messages("SHOW_IMAGERY_UNCOVERED")).toEqual([]);
  });

  test("Cesium ion shown (exclusive) is put back to None in the Globe Manager state, its switch stays on, and the message names it", async () => {
    server();
    sources({ gibs: true, ion: true });
    useLayout.getState().setGlobeIon(2);
    await showImagery(satPath("X04"));
    expect(useLayout.getState().globe.ion?.assetId ?? null).toBeNull();
    expect(useImagery.getState().sources.ion).toBe(true);
    expect(messages("SHOW_IMAGERY_UNCOVERED").map((m) => m.text)).toEqual([
      msg("showImagery.uncovered", { layers: "Cesium ion", layer: "MODIS Terra True Color" }),
    ]);
  });
});

describe("a satellite with no sensor (amendment z, R-05)", () => {
  test("sends no POST /objects: the GIBS layer is shown and the 3D camera flies over the sub-satellite point", async () => {
    const f = server();
    sources({ gibs: true });
    loadScene({});
    const insert = vi.fn(async (_body: InsertBody) => [sensorPath("Sensor1")]);
    useScenario.setState({ insert } as never);
    const flyOver = scene3d({ X04: TERRA_ECEF });
    await showImagery(satPath("X04"));
    expect(f.count(POST_OBJECTS)).toBe(0);
    expect(insert).not.toHaveBeenCalled();
    expect(openPanel).not.toHaveBeenCalled();
    expect(useLayout.getState().globe.layers[MODIS_TERRA].show).toBe(true);
    expect(flyOver).toHaveBeenCalledTimes(1);
    const [lon, lat, height] = flyOver.mock.calls[0];
    expect(lon).toBeCloseTo(100, 9);
    expect(lat).toBeCloseTo(0, 9);
    expect(height).toBe(3_000_000); // LEO 705 km: อย่างน้อย 3,000 km ให้เห็นแนวถ่ายภาพทั้งแถบ
    expect(useScenario.getState().doc?.objects.some((o) => o.class === "Sensor")).toBe(false);
  });

  test("a GEO satellite is looked at from its own height", async () => {
    server();
    sources({ gibs: true });
    const doc = loadScene({});
    useScenario.setState({ doc: { ...doc, objects: [...doc.objects, { class: "Satellite", name: "X01", norad: 41836 }] } as ScenarioDoc });
    const r = (6371.0088 + 35786) * 1000;
    const flyOver = scene3d({ X01: [0, r, 0] });
    await showImagery(satPath("X01"));
    expect(flyOver.mock.calls[0][0]).toBeCloseTo(90, 9);
    expect(flyOver.mock.calls[0][2]).toBeCloseTo(35_786_000, 0);
  });

  test("with no 3D window holding the satellite's position it says so in Thai, and still creates nothing", async () => {
    const f = server();
    sources({ gibs: true });
    loadScene({});
    scene3d({});
    await showImagery(satPath("X04"));
    expect(f.count(POST_OBJECTS)).toBe(0);
    expect(messages("SHOW_IMAGERY_NO_VIEW").map((m) => [m.level, m.text])).toEqual([
      ["info", msg("showImagery.noView", { satellite: "X04", layer: "MODIS Terra True Color" })],
    ]);
  });
});

describe("the object.showImagery command (Ruling o)", () => {
  let dispose: () => void;
  beforeEach(() => {
    dispose = registerShowImageryCommand();
  });
  afterEach(() => dispose());

  test("is disabled for G01 and for no selection, and enabled for X04", () => {
    expect(isRegistered("object.showImagery")).toBe(true);
    expect(isEnabled("object.showImagery")).toBe(false);
    useSelection.getState().select(satPath("G01"));
    expect(isEnabled("object.showImagery")).toBe(false);
    useSelection.getState().select(satPath("X04"));
    expect(isEnabled("object.showImagery")).toBe(true);
    useSelection.getState().select(sensorPath("MODIS"));
    expect(isEnabled("object.showImagery")).toBe(false);
  });

  test("is disabled with no scenario and while the presets are not loaded", () => {
    useSelection.getState().select(satPath("X04"));
    useImagingPresets.setState({ presets: [], loaded: false });
    expect(isEnabled("object.showImagery")).toBe(false);
    useImagingPresets.setState({ presets: [X04], loaded: true });
    expect(isEnabled("object.showImagery")).toBe(true);
    useScenario.setState({ name: null, doc: null, tree: null });
    expect(isEnabled("object.showImagery")).toBe(false);
  });

  test("running it on X04 does the same as showImagery", async () => {
    server();
    sources({ gibs: true });
    useSelection.getState().select(satPath("X04"));
    runCommand("object.showImagery");
    await vi.waitFor(() => expect(openPanel).toHaveBeenCalled());
    expect(useLayout.getState().globe.layers[MODIS_TERRA].show).toBe(true);
  });
});

describe("the presets store (Ruling p)", () => {
  beforeEach(() => useImagingPresets.setState(useImagingPresets.getInitialState(), true));

  test("loads GET /api/imaging/presets once and finds a preset by NORAD", async () => {
    const f = stubFetch({ "GET /api/imaging/presets": { json: [X01, X04] } });
    expect(useImagingPresets.getState().loaded).toBe(false);
    await useImagingPresets.getState().load();
    expect(f.count("GET /api/imaging/presets")).toBe(1);
    expect(useImagingPresets.getState()).toMatchObject({ presets: [X01, X04], loaded: true });
    expect(presetOfNorad(25994)).toEqual(X04);
    expect(presetOfNorad(40101)).toBeUndefined();
  });

  test("a failed load is a Thai warning, and Show Imagery stays disabled", async () => {
    stubFetch({ "GET /api/imaging/presets": { status: 500, json: { code: "BOOM", text: "down" } } });
    await useImagingPresets.getState().load();
    expect(useImagingPresets.getState()).toMatchObject({ presets: [], loaded: false });
    const warnings = useMessages.getState().items.filter((m) => m.level === "warning");
    expect(warnings).toHaveLength(1);
    const [head, tail] = msg("imaging.presetsFailed", { message: "\u0000" }).split("\u0000");
    expect(warnings[0].text.startsWith(head) && warnings[0].text.endsWith(tail), warnings[0].text).toBe(true);
    expect(warnings[0].text).toContain("down");
    const dispose = registerShowImageryCommand();
    useSelection.getState().select(satPath("X04"));
    expect(isEnabled("object.showImagery")).toBe(false);
    dispose();
  });

  test("a reply that is not a list of presets counts as a failure", async () => {
    stubFetch({ "GET /api/imaging/presets": { json: { nope: 1 } } });
    await useImagingPresets.getState().load();
    expect(useImagingPresets.getState().loaded).toBe(false);
    expect(useMessages.getState().items.map((m) => m.level)).toEqual(["warning"]);
  });
});
