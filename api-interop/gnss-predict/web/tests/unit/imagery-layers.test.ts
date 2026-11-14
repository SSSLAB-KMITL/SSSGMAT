// ชั้นภาพออนไลน์บน viewer 3D (spec imagery §5.2, spec ภาพละเอียด §4, src/cesium/imageryLayers.ts) โดยไม่มี WebGL และไม่ต่อเน็ต:
// ImageryLayer, UrlTemplateImageryProvider, WebMercatorTilingScheme และ IonImageryProvider.fromAssetId ของ Cesium ถูกแทนด้วยตัวปลอมที่จำ option ไว้
// (fromAssetId ปลอมคืน promise ที่ test ตัดสินเอง: ไม่มีคำขอไป api.cesium.com)
// viewer ปลอมมีแค่ imageryLayers (รายการธรรมดา: index 0 = Natural Earth II, ท้ายสุด = เส้น Lat/Lon) กับ scene.requestRender
// - สวิตช์ปิด = ไม่มีชั้น GIBS; ชั้นที่แสดงอยู่เหนือ index 0 เรียงตาม catalog และอยู่ใต้เส้น Lat/Lon เสมอ
// - token ของเวลาเปลี่ยน = เปลี่ยนชั้นนั้นใหม่ ไม่เกิน 1 ครั้งต่อวินาทีต่อ viewer (ครั้งท้ายตามมาเสมอ) ชั้นเดิมอยู่จนชั้นใหม่เริ่มโหลด
// - provider ของแต่ละ viewer เป็นคนละตัว; ชิ้น 404 ไม่ลองซ้ำและนับเป็นไม่มีภาพ; 403 = server ปิดสวิตช์ของแหล่งนั้น เอาชั้นของแหล่งนั้นออกทั้งหมด
// - แหล่ง: GIBS และ EOX ผ่าน server, OpenStreetMap browser ดึงตรง (ตามลำดับนี้ใต้เส้น Lat/Lon) แต่ละแหล่งมีสวิตช์ของตัวเอง
// - Cesium ion แสดงอยู่ = ชั้นอื่นทั้งหมดถูกเอาออกและ Natural Earth II alpha 0 ในทุก viewer จนกว่าจะเลิกแสดง ion

import { Event as CesiumEvent } from "cesium";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

interface FakeProvider {
  options: Record<string, unknown>;
  errorEvent: CesiumEvent;
  requestImage: (x: number, y: number, level: number, request?: unknown) => Promise<unknown> | undefined;
}
interface FakeLayer {
  imageryProvider: FakeProvider;
  alpha: number;
  dayAlpha: number;
  nightAlpha: number;
}

interface IonCall {
  assetId: number;
  options: Record<string, unknown>;
  resolve(p: unknown): void;
  reject(e: unknown): void;
}
const made = vi.hoisted(() => ({ providers: [] as unknown[], schemes: [] as unknown[], ion: [] as IonCall[] }));

vi.mock("cesium", async (importOriginal) => {
  const actual = await importOriginal<typeof import("cesium")>();
  class UrlTemplateImageryProvider {
    errorEvent = new actual.Event();
    requestImage = vi.fn((_x: number, _y: number, _level: number) => Promise.resolve({ image: true }));
    constructor(public options: Record<string, unknown>) {
      made.providers.push(this);
    }
  }
  class WebMercatorTilingScheme {
    constructor() {
      made.schemes.push(this);
    }
  }
  class ImageryLayer {
    alpha = 1;
    dayAlpha = 1;
    nightAlpha = 1;
    constructor(public imageryProvider: unknown, _options?: unknown) {}
  }
  const IonImageryProvider = {
    fromAssetId: vi.fn((assetId: number, options: Record<string, unknown>) =>
      new Promise((resolve, reject) => made.ion.push({ assetId, options, resolve, reject }))),
    /** แทน IonImageryProvider._endpointCache ของ Cesium (promise ของ endpoint ต่อ asset + token + server) */
    _endpointCache: {} as Record<string, unknown>,
  };
  return { ...actual, UrlTemplateImageryProvider, WebMercatorTilingScheme, ImageryLayer, IonImageryProvider };
});

const { Credit, Event: CEvent, ImageryProvider, Ion, IonImageryProvider, NeverTileDiscardPolicy, Resource, WebMercatorTilingScheme } = await import("cesium");
const {
  attachImageryLayers, imageryStatus, ionEndpointCacheKey, resetImageryNoticesForTest, setImageryNightAlpha, TILE_FAILURE_MIN_SETTLED, TILE_FAILURE_RATIO, TOKEN_INTERVAL_MS,
} = await import("../../src/cesium/imageryLayers");
const { getIonFailure, setIonFailure } = await import("../../src/cesium/ionState");
const { useImagery } = await import("../../src/stores/imagery");
const { useSettings } = await import("../../src/stores/settings");
const { useMessages } = await import("../../src/stores/messages");
const { useLayout } = await import("../../src/stores/layout");
const { useTime } = await import("../../src/stores/time");
const { DEFAULT_GLOBE } = await import("../../src/layout/workbook");

const BM = "BlueMarble_NextGeneration";
const VIIRS = "VIIRS_NOAA20_CorrectedReflectance_TrueColor";
const MODIS = "MODIS_Terra_CorrectedReflectance_TrueColor";
const HIMA = "Himawari_AHI_Band3_Red_Visible_1km";
const EOX = "s2cloudless-2024_3857";
const OSM = "osm";
const ION = "ion";
const TOKEN = "tok-SECRET-1234";
const EOX_CREDIT = "Sentinel-2 cloudless - https://s2maps.eu by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2024)";
const OFF = { gibs: false, eox: false, osm: false, ion: false };
const OSM_CREDIT_LINK = '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a>';
const GIBS_ON = { ...OFF, gibs: true };

const CATALOG = [
  { id: BM, title: "Blue Marble", period: "static", max_level: 8, format: "jpg", credit: "NASA GIBS / EOSDIS", source: "gibs" },
  { id: VIIRS, title: "VIIRS NOAA-20 True Color", period: "daily", max_level: 9, format: "jpg", credit: "NASA GIBS / EOSDIS", source: "gibs" },
  { id: MODIS, title: "MODIS Terra True Color", period: "daily", max_level: 9, format: "jpg", credit: "NASA GIBS / EOSDIS", source: "gibs" },
  { id: HIMA, title: "Himawari-9 Red Visible", period: "10min", max_level: 7, format: "png", credit: "NASA GIBS / EOSDIS, JMA", source: "gibs" },
] as const;
const EOX_LAYER = { id: EOX, title: "Sentinel-2 cloudless 2024", period: "static", max_level: 15, format: "jpg", credit: EOX_CREDIT, source: "eox" } as const;

/** viewer ปลอม: imageryLayers แบบ ImageryLayerCollection (add ที่ index แทรก, remove เอาออก) เริ่มด้วยฐานและเส้น Lat/Lon */
function fakeViewer() {
  const base = { name: "NaturalEarthII", alpha: 1, dayAlpha: 1, nightAlpha: 1 };
  const grid = { name: "grid" };
  const list: unknown[] = [base, grid];
  const imageryLayers = {
    get length() {
      return list.length;
    },
    get: (i: number) => list[i],
    indexOf: (l: unknown) => list.indexOf(l),
    contains: (l: unknown) => list.includes(l),
    add: (l: unknown, i?: number) => {
      if (i === undefined) list.push(l);
      else {
        if (i < 0 || i > list.length) throw new Error(`bad index ${i}`);
        list.splice(i, 0, l);
      }
    },
    remove: (l: unknown, _destroy?: boolean) => {
      const i = list.indexOf(l);
      if (i < 0) return false;
      list.splice(i, 1);
      return true;
    },
  };
  const scene = { requestRender: vi.fn() };
  const viewer = { imageryLayers, scene };
  /** ชั้น GIBS ในรายการตามลำดับ (id จาก url ของ provider) */
  const gibs = () => (list.filter((l) => l !== base && l !== grid) as FakeLayer[]);
  const ids = () => gibs().map((l) => idOf(l));
  return { viewer: viewer as never, list, base, grid, gibs, ids, scene };
}

/** id ของชั้นจาก url ของ provider (OSM = "osm") ชั้น ion (provider ไม่มี options) = "ion" */
const idOf = (l: FakeLayer): string => {
  const url = l.imageryProvider.options?.url;
  if (url === undefined) return ION;
  return String(url).startsWith("https://tile.openstreetmap.org/") ? OSM : String(url).split("/")[4];
};
const tokenOf = (l: FakeLayer): string => String(l.imageryProvider.options.url).split("/")[5];
const providers = () => made.providers as FakeProvider[];
const providersOf = (id: string) => providers().filter((p) => String(p.options.url).split("/")[4] === id);

const setTime = (iso: string) => useTime.setState({ current: new Date(iso) });
const show = (layers: Record<string, { show: boolean; translucency: number }>) => useLayout.setState((s) => ({ globe: { ...s.globe, layers } }));
const sources = (on: Partial<typeof OFF>) => useImagery.setState({ sources: { ...OFF, ...on } });

/**
 * แถวของ DEFAULT_GLOBE ที่ translucency 10: ชั้นที่ซ้อนกันยังถูกสร้างทุกชั้น (ชั้นทึบที่ translucency 0 บังชั้นข้างใต้ ซึ่งมี test ของตัวเองใน "occlusion")
 * test เรื่องลำดับวาด token และการนับชิ้นจึงยังเห็นทุกชั้น ชั้นที่ test ตั้งเองก็ใช้ translucency 10 ด้วยเหตุผลเดียวกัน
 */
const SEE_THROUGH_DEFAULT = {
  ...DEFAULT_GLOBE,
  layers: Object.fromEntries(Object.entries(DEFAULT_GLOBE.layers).map(([id, l]) => [id, { ...l, translucency: 10 }])),
};

const offs: (() => void)[] = [];
function attach(viewer: never, nightAlpha?: number) {
  const off = attachImageryLayers(viewer, { now: () => Date.now(), nightAlpha });
  offs.push(off);
  return off;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-14T00:00:00Z"));
  made.providers.length = 0;
  made.schemes.length = 0;
  made.ion.length = 0;
  vi.mocked(IonImageryProvider.fromAssetId).mockClear();
  resetImageryNoticesForTest();
  useImagery.setState({ sources: GIBS_ON, layers: [...CATALOG], loaded: true });
  useMessages.setState(useMessages.getInitialState(), true);
  useLayout.setState({ globe: SEE_THROUGH_DEFAULT });
  setTime("2026-11-11T12:00:00Z");
});
afterEach(() => {
  for (const off of offs.splice(0)) off();
  vi.useRealTimers();
  setIonFailure(null);
  useImagery.setState(useImagery.getInitialState(), true);
  useSettings.setState(useSettings.getInitialState(), true);
});

describe("attachImageryLayers", () => {
  test("switch off: no GIBS layer is added, not even for shown layers", () => {
    useImagery.setState({ sources: OFF });
    const v = fakeViewer();
    attach(v.viewer);
    expect(v.list).toEqual([v.base, v.grid]);
    expect(providers()).toHaveLength(0);
  });

  test("switch on with two layers shown: they sit at indices 1 and 2 in catalog order, the Lat/Lon grid stays last", () => {
    show({ [MODIS]: { show: true, translucency: 10 }, [VIIRS]: { show: true, translucency: 10 }, [BM]: { show: false, translucency: 10 } });
    const v = fakeViewer();
    attach(v.viewer);
    expect(v.list[0]).toBe(v.base);
    expect(v.list.at(-1)).toBe(v.grid);
    expect(v.ids()).toEqual([VIIRS, MODIS]);
    expect(v.list.indexOf(v.gibs()[0])).toBe(1);
    expect(v.list.indexOf(v.gibs()[1])).toBe(2);
    expect(v.scene.requestRender).toHaveBeenCalled();
  });

  test("a layer shown later goes into its catalog place, below the layers after it and below the grid", () => {
    show({ [MODIS]: { show: true, translucency: 10 } });
    const v = fakeViewer();
    attach(v.viewer);
    show({ [MODIS]: { show: true, translucency: 10 }, [BM]: { show: true, translucency: 10 }, [VIIRS]: { show: true, translucency: 10 } });
    expect(v.ids()).toEqual([BM, VIIRS, MODIS]);
    expect(v.list[0]).toBe(v.base);
    expect(v.list.at(-1)).toBe(v.grid);
  });

  test("hiding a layer, turning the switch off, or a catalog without the layer takes it off", () => {
    const v = fakeViewer();
    attach(v.viewer);
    expect(v.ids()).toEqual([BM, VIIRS]);
    show({ [BM]: { show: true, translucency: 10 }, [VIIRS]: { show: false, translucency: 10 } });
    expect(v.ids()).toEqual([BM]);
    useImagery.setState({ layers: CATALOG.filter((l) => l.id !== BM) });
    expect(v.ids()).toEqual([]);
    useImagery.setState({ layers: [...CATALOG] });
    expect(v.ids()).toEqual([BM]);
    useImagery.setState({ sources: OFF });
    expect(v.list).toEqual([v.base, v.grid]);
  });

  test("ids the catalog does not know are ignored", () => {
    show({ Future_Layer: { show: true, translucency: 10 }, [VIIRS]: { show: true, translucency: 10 } });
    const v = fakeViewer();
    attach(v.viewer);
    expect(v.ids()).toEqual([VIIRS]);
  });

  test("translucency 25 gives alpha 0.75, and a later change updates the alpha without a new provider", () => {
    show({ [VIIRS]: { show: true, translucency: 25 } });
    const v = fakeViewer();
    attach(v.viewer);
    expect(v.gibs()[0].alpha).toBe(0.75);
    v.scene.requestRender.mockClear();
    show({ [VIIRS]: { show: true, translucency: 100 } });
    expect(v.gibs()[0].alpha).toBe(0);
    expect(providers()).toHaveLength(1);
    expect(v.scene.requestRender).toHaveBeenCalled();
  });

  test("the provider has the exact same-origin url template, a Web Mercator tiling scheme, the layer's max level and credit", () => {
    show({ [VIIRS]: { show: true, translucency: 10 }, [HIMA]: { show: true, translucency: 10 }, [BM]: { show: true, translucency: 10 } });
    const v = fakeViewer();
    attach(v.viewer);
    const [bm, viirs, hima] = v.gibs().map((l) => l.imageryProvider.options);
    expect(viirs.url).toBe("/api/imagery/tiles/VIIRS_NOAA20_CorrectedReflectance_TrueColor/2026-11-11/{z}/{y}/{x}");
    expect(bm.url).toBe("/api/imagery/tiles/BlueMarble_NextGeneration/default/{z}/{y}/{x}");
    expect(hima.url).toBe("/api/imagery/tiles/Himawari_AHI_Band3_Red_Visible_1km/2026-11-11T12:00:00Z/{z}/{y}/{x}");
    expect(viirs.tilingScheme).toBeInstanceOf(WebMercatorTilingScheme);
    expect(viirs.maximumLevel).toBe(9);
    expect(hima.maximumLevel).toBe(7);
  });

  test("each layer's credit (NASA GIBS / EOSDIS, JMA, NOAA) is shown on screen, not only in Cesium's Data attribution box", () => {
    useImagery.setState({ layers: [...CATALOG, { id: "GOES-East_ABI_GeoColor", title: "GOES-East GeoColor", period: "10min", max_level: 7, format: "jpg", credit: "NASA GIBS / EOSDIS, NOAA", source: "gibs" }] });
    show({ [VIIRS]: { show: true, translucency: 10 }, [HIMA]: { show: true, translucency: 10 }, "GOES-East_ABI_GeoColor": { show: true, translucency: 10 } });
    const v = fakeViewer();
    attach(v.viewer);
    const credits = v.gibs().map((l) => l.imageryProvider.options.credit);
    for (const c of credits) expect(c).toBeInstanceOf(Credit);
    expect(credits.map((c) => (c as InstanceType<typeof Credit>).html)).toEqual(["NASA GIBS / EOSDIS", "NASA GIBS / EOSDIS, JMA", "NASA GIBS / EOSDIS, NOAA"]);
    expect(credits.every((c) => (c as InstanceType<typeof Credit>).showOnScreen)).toBe(true);
  });

  test("each provider has a NeverTileDiscardPolicy, so Cesium loads tiles by XHR (preferBlob) and the HTTP status reaches errorEvent in every browser", () => {
    show({ [VIIRS]: { show: true, translucency: 10 }, [BM]: { show: true, translucency: 10 } });
    const v = fakeViewer();
    attach(v.viewer);
    expect(v.gibs()).toHaveLength(2);
    for (const l of v.gibs()) expect(l.imageryProvider.options.tileDiscardPolicy).toBeInstanceOf(NeverTileDiscardPolicy);
  });

  test("Cesium's own ImageryProvider.loadImage asks for a blob (XHR) when the provider has a tile discard policy", () => {
    const fetchImage = vi.spyOn(Resource.prototype, "fetchImage").mockReturnValue(undefined);
    ImageryProvider.loadImage({ tileDiscardPolicy: new NeverTileDiscardPolicy() } as never, "/api/imagery/tiles/x/default/0/0/0");
    expect(fetchImage).toHaveBeenLastCalledWith(expect.objectContaining({ preferBlob: true }));
    ImageryProvider.loadImage({} as never, "/api/imagery/tiles/x/default/0/0/0");
    expect(fetchImage.mock.lastCall?.[0]).not.toHaveProperty("preferBlob");
    fetchImage.mockRestore();
  });

  test("GIBS layers follow Ambient Level like the base layer: nightAlpha from attach and from later changes, dayAlpha 1 (translucency stays in alpha)", async () => {
    show({ [VIIRS]: { show: true, translucency: 40 }, [BM]: { show: true, translucency: 10 } });
    const v = fakeViewer();
    attach(v.viewer, 0.3);
    expect(v.gibs().map((l) => [l.dayAlpha, l.nightAlpha])).toEqual([[1, 0.3], [1, 0.3]]);
    expect(v.gibs()[1].alpha).toBeCloseTo(0.6, 12);

    v.scene.requestRender.mockClear();
    setImageryNightAlpha(v.viewer, 0.75);
    expect(v.gibs().map((l) => l.nightAlpha)).toEqual([0.75, 0.75]);
    expect(v.scene.requestRender).toHaveBeenCalled();

    // ชั้นที่แสดงทีหลังและชั้นที่เปลี่ยนตามเวลา (ทั้งชั้นใหม่และชั้นเดิมที่รอ) ได้ค่าเดียวกัน
    show({ [VIIRS]: { show: true, translucency: 40 }, [BM]: { show: true, translucency: 10 }, [MODIS]: { show: true, translucency: 10 } });
    expect(v.gibs().map((l) => l.nightAlpha)).toEqual([0.75, 0.75, 0.75]);
    await v.gibs()[1].imageryProvider.requestImage(0, 0, 0);
    setTime("2026-11-12T12:00:00Z");
    setImageryNightAlpha(v.viewer, 0.1);
    expect(v.gibs().length).toBeGreaterThan(3);
    expect(v.gibs().map((l) => l.nightAlpha)).toEqual(v.gibs().map(() => 0.1));
  });

  test("without a night alpha (no lighting settings) GIBS layers keep nightAlpha 1", () => {
    const v = fakeViewer();
    attach(v.viewer);
    expect(v.gibs().map((l) => l.nightAlpha)).toEqual([1, 1]);
    setImageryNightAlpha(fakeViewer().viewer, 0.2); // viewer ที่ไม่ได้ต่อ: ไม่ทำอะไร ไม่โยน
  });

  test("time that moves within the same token replaces nothing", () => {
    show({ [VIIRS]: { show: true, translucency: 10 }, [BM]: { show: true, translucency: 10 } });
    const v = fakeViewer();
    attach(v.viewer);
    const before = [...v.list];
    setTime("2026-11-11T13:00:00Z");
    setTime("2026-11-11T23:59:59Z");
    vi.advanceTimersByTime(5000);
    expect(v.list).toEqual(before);
    expect(providers()).toHaveLength(2);
  });

  test("a token change twice within 1 s: one replacement now, one trailing replacement after the interval", () => {
    expect(TOKEN_INTERVAL_MS).toBe(1000);
    show({ [VIIRS]: { show: true, translucency: 10 }, [BM]: { show: true, translucency: 10 } });
    const v = fakeViewer();
    attach(v.viewer);
    expect(providersOf(VIIRS)).toHaveLength(1);

    setTime("2026-11-12T12:00:00Z");
    expect(providersOf(VIIRS)).toHaveLength(2);
    expect(tokenOf(v.gibs().at(-1)!)).toBe("2026-11-12");

    vi.advanceTimersByTime(300);
    setTime("2026-11-13T12:00:00Z");
    expect(providersOf(VIIRS)).toHaveLength(2); // ยังไม่ครบ 1 วินาที
    vi.advanceTimersByTime(699);
    expect(providersOf(VIIRS)).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(providersOf(VIIRS)).toHaveLength(3); // ครั้งท้ายตามมาเสมอ
    expect(tokenOf(v.gibs().at(-1)!)).toBe("2026-11-13");
    expect(providersOf(BM)).toHaveLength(1); // static ไม่เปลี่ยน
    vi.advanceTimersByTime(5000);
    expect(providers()).toHaveLength(4);
  });

  test("animation at 3600x for 3 s rebuilds a 10-minute layer at most once per second", () => {
    show({ [HIMA]: { show: true, translucency: 10 } });
    const v = fakeViewer();
    attach(v.viewer);
    let t = Date.parse("2026-11-11T12:00:00Z");
    for (let frame = 0; frame < 90; frame++) {
      t += 120_000; // 1/30 s ที่ 3600x
      setTime(new Date(t).toISOString());
      vi.advanceTimersByTime(1000 / 30);
    }
    vi.advanceTimersByTime(1000);
    // ภายใน 3 วินาที: ครั้งแรก + ไม่เกินครั้งละวินาที + ครั้งท้าย
    expect(providersOf(HIMA).length).toBeLessThanOrEqual(1 + 4);
    expect(tokenOf(v.gibs().at(-1)!)).toBe("2026-11-11T15:00:00Z");
    // ชั้นของ id เดียวกันค้างอยู่ไม่เกินสองชั้น (ชั้นใหม่ + ชั้นเดิมที่รอชั้นใหม่เริ่มโหลด)
    expect(v.gibs().length).toBeLessThanOrEqual(2);
  });

  test("the old layer stays below the new one until the new one starts loading, then goes", async () => {
    show({ [VIIRS]: { show: true, translucency: 40 } });
    const v = fakeViewer();
    attach(v.viewer);
    const old = v.gibs()[0];
    await old.imageryProvider.requestImage(0, 0, 0); // ชั้นเดิมมีภาพแสดงอยู่แล้ว
    setTime("2026-11-12T12:00:00Z");
    expect(v.gibs()).toHaveLength(2);
    const fresh = v.gibs()[1];
    expect(v.gibs()[0]).toBe(old);
    expect(tokenOf(fresh)).toBe("2026-11-12");
    expect(fresh.alpha).toBeCloseTo(0.6, 12);
    expect(v.list.at(-1)).toBe(v.grid);

    await fresh.imageryProvider.requestImage(0, 0, 0);
    expect(v.gibs()).toEqual([fresh]);
  });

  test("a layer that never showed anything is not kept when it is replaced (only one older layer waits per id)", () => {
    show({ [VIIRS]: { show: true, translucency: 10 } });
    const v = fakeViewer();
    attach(v.viewer);
    setTime("2026-11-12T12:00:00Z");
    expect(v.gibs().map(tokenOf)).toEqual(["2026-11-12"]);
  });

  test("a tile that fails also counts as the new layer having started (the old one goes)", async () => {
    show({ [VIIRS]: { show: true, translucency: 10 } });
    const v = fakeViewer();
    attach(v.viewer);
    await v.gibs()[0].imageryProvider.requestImage(0, 0, 0);
    setTime("2026-11-12T12:00:00Z");
    expect(v.gibs()).toHaveLength(2);
    v.gibs()[1].imageryProvider.errorEvent.raiseEvent({ retry: true, error: { statusCode: 404 } });
    expect(v.gibs().map(tokenOf)).toEqual(["2026-11-12"]);
  });

  test("two viewers never share a provider or a layer", () => {
    const a = fakeViewer();
    const b = fakeViewer();
    attach(a.viewer);
    attach(b.viewer);
    expect(providers()).toHaveLength(4);
    expect(new Set(providers()).size).toBe(4);
    for (let i = 0; i < 2; i++) {
      expect(a.gibs()[i]).not.toBe(b.gibs()[i]);
      expect(a.gibs()[i].imageryProvider).not.toBe(b.gibs()[i].imageryProvider);
    }
  });

  test("detach removes the layers and stops listening", () => {
    const v = fakeViewer();
    const off = attach(v.viewer);
    expect(v.ids()).toEqual([BM, VIIRS]);
    off();
    expect(v.list).toEqual([v.base, v.grid]);
    const count = providers().length;
    show({ [MODIS]: { show: true, translucency: 10 } });
    setTime("2026-11-20T00:00:00Z");
    useImagery.setState({ sources: OFF });
    useImagery.setState({ sources: GIBS_ON });
    vi.advanceTimersByTime(5000);
    expect(providers()).toHaveLength(count);
    expect(v.list).toEqual([v.base, v.grid]);
    expect(imageryStatus(v.viewer).topLayer).toBeNull();
  });

  test("a 404 tile is not retried and counts as missing for its (layer, token); a loaded tile counts as present", async () => {
    show({ [VIIRS]: { show: true, translucency: 10 } });
    const v = fakeViewer();
    attach(v.viewer);
    const p = v.gibs()[0].imageryProvider;
    await p.requestImage(0, 0, 1);
    for (let i = 0; i < 3; i++) {
      const error = { retry: true, error: { statusCode: 404 } };
      p.errorEvent.raiseEvent(error);
      expect(error.retry).toBe(false);
    }
    expect(imageryStatus(v.viewer).topLayer?.missingRatio).toBeCloseTo(0.75, 12);
    // token ใหม่นับใหม่ (ชั้นเดิมยังอยู่บนจอจนชั้นใหม่ได้ชิ้นแรก จึงยังบอกของชั้นเดิม)
    setTime("2026-11-12T12:00:00Z");
    expect(imageryStatus(v.viewer).topLayer?.missingRatio).toBeCloseTo(0.75, 12);
    await v.gibs().at(-1)!.imageryProvider.requestImage(0, 0, 1);
    expect(imageryStatus(v.viewer).topLayer?.missingRatio).toBe(0);
  });

  test("other tile errors are not retried either and do not count as missing imagery", () => {
    show({ [VIIRS]: { show: true, translucency: 10 } });
    const v = fakeViewer();
    attach(v.viewer);
    const p = v.gibs()[0].imageryProvider;
    for (const error of [{ retry: true, error: { statusCode: 503 } }, { retry: true, error: new Error("network") }, { retry: true }]) {
      p.errorEvent.raiseEvent(error);
      expect(error.retry).toBe(false);
    }
    expect(imageryStatus(v.viewer).topLayer?.missingRatio).toBe(0);
    expect(useImagery.getState().sources).toEqual(GIBS_ON);
  });

  test("a 403 tile (server switch is off) turns the switch off here and takes every GIBS layer off every viewer", async () => {
    const a = fakeViewer();
    const b = fakeViewer();
    attach(a.viewer);
    attach(b.viewer);
    a.gibs()[0].imageryProvider.errorEvent.raiseEvent({ retry: true, error: { statusCode: 403 } });
    await Promise.resolve();
    expect(useImagery.getState().sources).toEqual(OFF);
    expect(a.list).toEqual([a.base, a.grid]);
    expect(b.list).toEqual([b.base, b.grid]);
  });
});

describe("imageryStatus", () => {
  test("the top layer is the last shown layer in catalog order, labelled by its time token", () => {
    show({ [BM]: { show: true, translucency: 10 }, [VIIRS]: { show: true, translucency: 10 } });
    const v = fakeViewer();
    attach(v.viewer);
    expect(imageryStatus(v.viewer).topLayer).toEqual({ id: VIIRS, title: "VIIRS NOAA-20 True Color", label: "2026-11-11", missingRatio: 0, source: "gibs", max_level: 9 });
    show({ [BM]: { show: true, translucency: 10 }, [HIMA]: { show: true, translucency: 10 } });
    expect(imageryStatus(v.viewer).topLayer).toMatchObject({ id: HIMA, label: "2026-11-11 12:00 UTC" });
    show({ [BM]: { show: true, translucency: 10 } });
    expect(imageryStatus(v.viewer).topLayer).toMatchObject({ id: BM, title: "Blue Marble", label: "" });
  });

  test("while the new time's layer has not loaded a tile, the HUD names the older layer still on screen", async () => {
    show({ [VIIRS]: { show: true, translucency: 10 } });
    const v = fakeViewer();
    attach(v.viewer);
    const p = v.gibs()[0].imageryProvider;
    await p.requestImage(0, 0, 1);
    p.errorEvent.raiseEvent({ retry: true, error: { statusCode: 404 } });
    setTime("2026-11-12T12:00:00Z");
    expect(v.gibs()).toHaveLength(2);
    expect(imageryStatus(v.viewer).topLayer).toEqual({ id: VIIRS, title: "VIIRS NOAA-20 True Color", label: "2026-11-11", missingRatio: 0.5, source: "gibs", max_level: 9 });
    // อีกชั้นที่ยังไม่เริ่มโหลดแทนอีกครั้ง: ภาพบนจอยังเป็นชั้นเดิม
    vi.advanceTimersByTime(TOKEN_INTERVAL_MS);
    setTime("2026-11-13T12:00:00Z");
    expect(imageryStatus(v.viewer).topLayer?.label).toBe("2026-11-11");
    await v.gibs().at(-1)!.imageryProvider.requestImage(0, 0, 0);
    expect(v.gibs()).toHaveLength(1);
    expect(imageryStatus(v.viewer).topLayer).toMatchObject({ label: "2026-11-13", missingRatio: 0 });
  });

  test("nothing shown, switch off, or a viewer without the manager: null (the HUD says Natural Earth II)", () => {
    const v = fakeViewer();
    expect(imageryStatus(v.viewer).topLayer).toBeNull();
    attach(v.viewer);
    show({});
    expect(imageryStatus(v.viewer).topLayer).toBeNull();
    show(DEFAULT_GLOBE.layers);
    useImagery.setState({ sources: OFF });
    expect(imageryStatus(v.viewer).topLayer).toBeNull();
  });
});

// ---------- แหล่งภาพ: Sentinel-2 cloudless (EOX), OpenStreetMap, Cesium ion (spec ภาพละเอียด §4) ----------

const SETTINGS = {
  daily: { enabled: false, run_at_utc: "21:00", facility: "THBK", retention_days: 30, validation_retry_hours: 3, validation_give_up_days: 1 },
  cesium_ion_token: TOKEN,
  online_imagery: { enabled: true, eox: true, osm: true, ion: true },
};
const setToken = (token: string) => useSettings.setState({ settings: { ...SETTINGS, cesium_ion_token: token } });
const ionAsset = (id: number | null) => useLayout.getState().setGlobeIon(id);
const warnings = () => useMessages.getState().items.filter((m) => m.level === "warning");
const osmWarnings = () => warnings().filter((m) => m.code === "IMAGERY_OSM_FAILED");
/** viewer ของ test ที่ต้องอ่านชั้น ion ปัจจุบันจากตัวช่วย (test.each ของการลองใหม่) */
let viewer: ReturnType<typeof fakeViewer>;
const currentIon = () => viewer.gibs().find((l) => idOf(l) === ION)!;
const fakeIonProvider = () => ({ errorEvent: new CEvent(), maximumLevel: 20, requestImage: vi.fn((_x: number, _y: number, _level: number) => Promise.resolve({ image: true })) });
/** ทุก promise ของ fromAssetId ที่ค้างอยู่สำเร็จ แล้วรอ then ของ manager */
async function resolveIon() {
  for (const c of made.ion.splice(0)) c.resolve(fakeIonProvider());
  await vi.advanceTimersByTimeAsync(0);
}
async function rejectIon(error: unknown) {
  for (const c of made.ion.splice(0)) c.reject(error);
  await vi.advanceTimersByTimeAsync(0);
}
const ALL_SHOWN = {
  [BM]: { show: true, translucency: 10 }, [VIIRS]: { show: true, translucency: 10 }, [EOX]: { show: true, translucency: 10 }, [OSM]: { show: true, translucency: 30 },
};

describe("sources: Sentinel-2 cloudless (EOX) through the server", () => {
  beforeEach(() => useImagery.setState({ layers: [EOX_LAYER, ...CATALOG] })); // EOX มาก่อนใน catalog: ลำดับวาดยังเป็น GIBS แล้ว EOX

  test("EOX is drawn above every GIBS layer whatever the catalog order, with the same-origin url, max level 15 and its credit on screen", () => {
    sources({ gibs: true, eox: true });
    show(ALL_SHOWN);
    const v = fakeViewer();
    attach(v.viewer);
    expect(v.ids()).toEqual([BM, VIIRS, EOX]);
    expect(v.list.at(-1)).toBe(v.grid);
    const o = v.gibs()[2].imageryProvider.options;
    expect(o.url).toBe("/api/imagery/tiles/s2cloudless-2024_3857/default/{z}/{y}/{x}");
    expect(o.maximumLevel).toBe(15);
    expect(o.tilingScheme).toBeInstanceOf(WebMercatorTilingScheme);
    expect(o.tileDiscardPolicy).toBeInstanceOf(NeverTileDiscardPolicy);
    expect((o.credit as InstanceType<typeof Credit>).html).toBe(EOX_CREDIT);
    expect((o.credit as InstanceType<typeof Credit>).showOnScreen).toBe(true);
  });

  test("each proxied source follows only its own switch", () => {
    show(ALL_SHOWN);
    sources({ gibs: true });
    const v = fakeViewer();
    attach(v.viewer);
    expect(v.ids()).toEqual([BM, VIIRS]);
    sources({ eox: true });
    expect(v.ids()).toEqual([EOX]);
    sources({});
    expect(v.list).toEqual([v.base, v.grid]);
    expect(providersOf(EOX)).toHaveLength(1);
  });

  test("a 403 on an EOX tile turns off only the EOX switch here; GIBS layers stay", async () => {
    sources({ gibs: true, eox: true, osm: true });
    show(ALL_SHOWN);
    const v = fakeViewer();
    attach(v.viewer);
    v.gibs()[2].imageryProvider.errorEvent.raiseEvent({ retry: true, error: { statusCode: 403 } });
    await Promise.resolve();
    expect(useImagery.getState().sources).toEqual({ gibs: true, eox: false, osm: true, ion: false });
    expect(v.ids()).toEqual([BM, VIIRS, OSM]);
  });

  test("the HUD's top layer names its source and finest level", () => {
    sources({ gibs: true, eox: true });
    show(ALL_SHOWN);
    const v = fakeViewer();
    attach(v.viewer);
    expect(imageryStatus(v.viewer).topLayer).toEqual({ id: EOX, title: "Sentinel-2 cloudless 2024", label: "", missingRatio: 0, source: "eox", max_level: 15 });
  });
});

// ชั้นที่ถูกชั้นทึบทับทั้งหมดไม่ถูกสร้าง (รอบเร่งความเร็ว): ไม่มี provider จึงไม่มีคำขอชิ้นภาพของชั้นนั้นเลย
describe("occlusion: layers under an opaque shown layer are not created", () => {
  beforeEach(() => useImagery.setState({ sources: { gibs: true, eox: true, osm: true, ion: false }, layers: [...CATALOG, EOX_LAYER] }));
  const OPAQUE_ALL = {
    [BM]: { show: true, translucency: 0 }, [VIIRS]: { show: true, translucency: 0 }, [EOX]: { show: true, translucency: 0 }, [OSM]: { show: true, translucency: 0 },
  };

  test("Blue Marble + VIIRS + EOX + OSM shown, all at 0 % translucency: only OSM is created, Natural Earth II stays the base", () => {
    show(OPAQUE_ALL);
    const v = fakeViewer();
    attach(v.viewer);
    expect(v.ids()).toEqual([OSM]);
    expect(providers()).toHaveLength(1);
    expect(v.list[0]).toBe(v.base);
    expect(v.list.at(-1)).toBe(v.grid);
    expect(imageryStatus(v.viewer).topLayer).toMatchObject({ id: OSM, source: "osm" });
  });

  test("OSM at 30 % translucency also creates EOX below it (EOX is opaque, so nothing under EOX)", () => {
    show({ ...OPAQUE_ALL, [OSM]: { show: true, translucency: 30 } });
    const v = fakeViewer();
    attach(v.viewer);
    expect(v.ids()).toEqual([EOX, OSM]);
    expect(providersOf(BM)).toHaveLength(0);
    expect(providersOf(VIIRS)).toHaveLength(0);
  });

  test("a translucency change re-evaluates: OSM made see-through brings EOX in below it, made opaque again takes EOX off", () => {
    show(OPAQUE_ALL);
    const v = fakeViewer();
    attach(v.viewer);
    show({ ...OPAQUE_ALL, [OSM]: { show: true, translucency: 30 } });
    expect(v.ids()).toEqual([EOX, OSM]);
    show(OPAQUE_ALL);
    expect(v.ids()).toEqual([OSM]);
  });

  test("a png Himawari layer on top hides nothing: the opaque jpg layer under it and Himawari are both created", () => {
    useImagery.setState({ sources: GIBS_ON });
    show({ [BM]: { show: true, translucency: 0 }, [VIIRS]: { show: true, translucency: 0 }, [HIMA]: { show: true, translucency: 0 } });
    const v = fakeViewer();
    attach(v.viewer);
    expect(v.ids()).toEqual([VIIRS, HIMA]);
  });

  test("a GOES GeoColor layer (jpg, but a geostationary disk: period 10min) hides nothing either", () => {
    const GOES = "GOES-East_ABI_GeoColor";
    useImagery.setState({
      sources: GIBS_ON,
      layers: [...CATALOG, { id: GOES, title: "GOES-East GeoColor", period: "10min", max_level: 7, format: "jpg", credit: "NASA GIBS / EOSDIS, NOAA", source: "gibs" }],
    });
    show({ [BM]: { show: true, translucency: 0 }, [VIIRS]: { show: true, translucency: 0 }, [GOES]: { show: true, translucency: 0 } });
    const v = fakeViewer();
    attach(v.viewer);
    expect(v.ids()).toEqual([VIIRS, GOES]);
  });

  test("switching OSM off re-creates the layers under it down to the next opaque one, in draw order under the grid", () => {
    show({ ...OPAQUE_ALL, [EOX]: { show: true, translucency: 40 } });
    const v = fakeViewer();
    attach(v.viewer);
    expect(v.ids()).toEqual([OSM]);
    sources({ gibs: true, eox: true, osm: false });
    expect(v.ids()).toEqual([VIIRS, EOX]);
    expect(v.list.at(-1)).toBe(v.grid);
    sources({ gibs: true, eox: false, osm: false });
    expect(v.ids()).toEqual([VIIRS]);
    sources({ gibs: true, eox: true, osm: true });
    expect(v.ids()).toEqual([OSM]);
  });
});

describe("sources: OpenStreetMap straight from the browser", () => {
  beforeEach(() => useImagery.setState({ layers: [...CATALOG, EOX_LAYER] }));

  test("switch off: no OpenStreetMap provider even with its row shown", () => {
    sources({ gibs: true, eox: true });
    show(ALL_SHOWN);
    const v = fakeViewer();
    attach(v.viewer);
    expect(v.ids()).not.toContain(OSM);
    expect(providers().filter((p) => String(p.options.url).includes("openstreetmap"))).toHaveLength(0);
  });

  test("switch on and shown: the exact tile url, Web Mercator, max level 19, credit on screen, above EOX and GIBS and below the grid", () => {
    sources({ gibs: true, eox: true, osm: true });
    show(ALL_SHOWN);
    const v = fakeViewer();
    attach(v.viewer);
    expect(v.ids()).toEqual([BM, VIIRS, EOX, OSM]);
    expect(v.list.at(-1)).toBe(v.grid);
    const layer = v.gibs()[3];
    const o = layer.imageryProvider.options;
    expect(o.url).toBe("https://tile.openstreetmap.org/{z}/{x}/{y}.png");
    expect(o.tilingScheme).toBeInstanceOf(WebMercatorTilingScheme);
    expect(o.maximumLevel).toBe(19);
    expect((o.credit as InstanceType<typeof Credit>).html).toBe(OSM_CREDIT_LINK);
    expect((o.credit as InstanceType<typeof Credit>).showOnScreen).toBe(true);
    // นโยบายเดิมของ Cesium (ไม่ตั้งตัวทิ้งชิ้น ไม่ส่ง header เพิ่ม) และ translucency ของแถว osm
    expect(o.tileDiscardPolicy).toBeUndefined();
    expect(layer.alpha).toBeCloseTo(0.7, 12);
    expect(imageryStatus(v.viewer).topLayer).toEqual({ id: OSM, title: "OpenStreetMap", label: "", missingRatio: 0, source: "osm", max_level: 19 });
  });

  test("OSM on alone, shown later or hidden again; its row hidden = no provider", () => {
    sources({ osm: true });
    show({ [OSM]: { show: false, translucency: 10 } });
    const v = fakeViewer();
    attach(v.viewer);
    expect(v.ids()).toEqual([]);
    show({ [OSM]: { show: true, translucency: 10 } });
    expect(v.ids()).toEqual([OSM]);
    expect(v.list.indexOf(v.gibs()[0])).toBe(1);
    show({});
    expect(v.list).toEqual([v.base, v.grid]);
  });

  test("an OpenStreetMap tile error (even 403) is not retried and never turns any switch off", async () => {
    sources({ osm: true });
    show({ [OSM]: { show: true, translucency: 10 } });
    const v = fakeViewer();
    attach(v.viewer);
    for (const error of [{ retry: true, error: { statusCode: 403 } }, { retry: true, error: { statusCode: 429 } }, { retry: true }]) {
      v.gibs()[0].imageryProvider.errorEvent.raiseEvent(error);
      expect(error.retry).toBe(false);
    }
    await Promise.resolve();
    expect(useImagery.getState().sources).toEqual({ ...OFF, osm: true });
    expect(v.ids()).toEqual([OSM]);
  });

  test("the OpenStreetMap credit is an on-screen link to its copyright page; other credits stay escaped text", () => {
    useImagery.setState({ layers: [...CATALOG, EOX_LAYER, { ...EOX_LAYER, id: "x", credit: "A <b>&</b> B", source: "gibs" }] });
    sources({ gibs: true, eox: true, osm: true });
    show({ ...ALL_SHOWN, x: { show: true, translucency: 10 } });
    const v = fakeViewer();
    attach(v.viewer);
    const credit = (id: string) => v.gibs().find((l) => idOf(l) === id)!.imageryProvider.options.credit as InstanceType<typeof Credit>;
    expect(credit(OSM).html).toBe(OSM_CREDIT_LINK);
    expect(credit(OSM).showOnScreen).toBe(true);
    // Cesium วาด credit ผ่าน DOMPurify: ลิงก์ยังอยู่ครบ (href, target, rel) บนจอ
    const a = credit(OSM).element.querySelector("a");
    expect(a?.getAttribute("href")).toBe("https://www.openstreetmap.org/copyright");
    expect(a?.textContent).toBe("© OpenStreetMap contributors");
    expect(credit("x").html).toBe("A &lt;b&gt;&amp;&lt;/b&gt; B");
    expect(credit(EOX).html).toBe(EOX_CREDIT);
  });

  test("the failure rule is the same for every viewer and source: at least 8 settled tiles with at least 75 % failed", () => {
    expect([TILE_FAILURE_MIN_SETTLED, TILE_FAILURE_RATIO]).toEqual([8, 0.75]);
  });

  test("OpenStreetMap tiles failing past the threshold (any status, or none as in Safari): one Thai message per page session, the HUD flags missing imagery, no retry", async () => {
    sources({ osm: true });
    show({ [OSM]: { show: true, translucency: 10 } });
    const a = fakeViewer();
    const b = fakeViewer();
    attach(a.viewer);
    attach(b.viewer);
    const p = a.gibs()[0].imageryProvider;
    await p.requestImage(0, 0, 1);
    const errors = [{ retry: true }, { retry: true, error: { statusCode: 403 } }, { retry: true, error: new Error("Failed to fetch") }, { retry: true, error: { statusCode: 404 } }];
    // 1 ชิ้นได้ + 6 ชิ้นพลาด = 7 ชิ้น: ยังไม่ครบ 8 ชิ้น ไม่แจ้ง
    for (let i = 0; i < 6; i++) {
      const error = { ...errors[i % errors.length] };
      p.errorEvent.raiseEvent(error);
      expect(error.retry).toBe(false);
    }
    await Promise.resolve();
    expect(osmWarnings()).toEqual([]);
    expect(imageryStatus(a.viewer).topLayer?.missingRatio).toBeCloseTo(6 / 7, 12);
    // ชิ้นที่ 8 พลาด: 7/8 ≥ 75 % = ข้อความไทยหนึ่งข้อความ ชั้นยังอยู่ (ไม่เปลี่ยนวิธีขอของ OSM) สวิตช์ไม่ถูกแตะ
    p.errorEvent.raiseEvent({ retry: true });
    await Promise.resolve();
    expect(osmWarnings()).toHaveLength(1);
    expect(osmWarnings()[0].text).toMatch(/[฀-๿]/);
    expect(osmWarnings()[0].text).toContain("OpenStreetMap");
    expect(a.ids()).toEqual([OSM]);
    expect(useImagery.getState().sources).toEqual({ ...OFF, osm: true });
    // อีก viewer ก็พลาดเกินเกณฑ์ หรือเปิดชั้นใหม่: ไม่แจ้งซ้ำในหน้านี้
    for (let i = 0; i < 10; i++) b.gibs()[0].imageryProvider.errorEvent.raiseEvent({ retry: true });
    expect(imageryStatus(b.viewer).topLayer).toMatchObject({ source: "osm", missingRatio: 1 });
    show({});
    show({ [OSM]: { show: true, translucency: 10 } });
    for (let i = 0; i < 10; i++) a.gibs()[0].imageryProvider.errorEvent.raiseEvent({ retry: true });
    await Promise.resolve();
    expect(osmWarnings()).toHaveLength(1);
    expect(providers().every((pr) => pr.options.tileDiscardPolicy === undefined)).toBe(true);
  });

  test("OpenStreetMap below the threshold stays silent: 8 settled tiles with 5 failed (62.5 %)", async () => {
    sources({ osm: true });
    show({ [OSM]: { show: true, translucency: 10 } });
    const v = fakeViewer();
    attach(v.viewer);
    const p = v.gibs()[0].imageryProvider;
    for (let i = 0; i < 3; i++) await p.requestImage(0, 0, 1);
    for (let i = 0; i < 5; i++) p.errorEvent.raiseEvent({ retry: true });
    await Promise.resolve();
    expect(osmWarnings()).toEqual([]);
    expect(imageryStatus(v.viewer).topLayer?.missingRatio).toBeCloseTo(5 / 8, 12);
  });

  test("the app sets no Referrer-Policy (index.html meta or server header), so tile.openstreetmap.org gets the browser's default Referer", () => {
    const root = resolve(__dirname, "../..");
    expect(readFileSync(resolve(root, "index.html"), "utf8").toLowerCase()).not.toContain("referrer");
    const server = resolve(root, "../server/gnss_studio_server");
    const py = readdirSync(server, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".py"));
    expect(py.length).toBeGreaterThan(0);
    for (const f of py) expect(readFileSync(resolve(server, f), "utf8").toLowerCase(), f).not.toContain("referrer-policy");
  });
});

describe("sources: Cesium ion (exclusive)", () => {
  beforeEach(() => {
    useImagery.setState({ layers: [...CATALOG, EOX_LAYER] });
    sources({ gibs: true, eox: true, osm: true });
    show(ALL_SHOWN);
    setToken(TOKEN);
  });

  test("ion shown with a token: fromAssetId(asset, { accessToken }) per viewer, every other layer goes and Natural Earth II alpha is 0 in every viewer", async () => {
    const a = fakeViewer();
    const b = fakeViewer();
    attach(a.viewer);
    attach(b.viewer);
    expect(a.ids()).toEqual([BM, VIIRS, EOX, OSM]);
    sources({ gibs: true, eox: true, osm: true, ion: true });
    expect(IonImageryProvider.fromAssetId).not.toHaveBeenCalled(); // ยังไม่ได้เลือก asset
    ionAsset(3830182);
    expect(vi.mocked(IonImageryProvider.fromAssetId).mock.calls).toEqual([[3830182, { accessToken: TOKEN }], [3830182, { accessToken: TOKEN }]]);
    for (const v of [a, b]) {
      expect(v.ids()).toEqual([]);
      expect(v.base.alpha).toBe(0);
    }
    await resolveIon();
    for (const v of [a, b]) {
      expect(v.ids()).toEqual([ION]);
      expect(v.list).toEqual([v.base, v.gibs()[0], v.grid]);
      expect(v.base.alpha).toBe(0);
      expect(v.gibs()[0].alpha).toBe(1);
      expect(imageryStatus(v.viewer).topLayer).toEqual({ id: ION, title: "Google Maps Satellite", label: "", missingRatio: 0, source: "ion", max_level: 20 });
    }
    expect(a.gibs()[0].imageryProvider).not.toBe(b.gibs()[0].imageryProvider);
    expect(warnings()).toEqual([]);
  });

  test("while ion is shown, time-token changes and Globe Manager edits never bring another layer back", async () => {
    sources({ gibs: true, eox: true, osm: true, ion: true });
    ionAsset(2);
    const v = fakeViewer();
    attach(v.viewer);
    await resolveIon();
    const count = providers().length;
    setTime("2026-11-12T12:00:00Z");
    vi.advanceTimersByTime(5000);
    show({ ...ALL_SHOWN, [MODIS]: { show: true, translucency: 10 } });
    useImagery.setState({ layers: [...CATALOG, EOX_LAYER] });
    expect(providers()).toHaveLength(count);
    expect(v.ids()).toEqual([ION]);
    expect(v.base.alpha).toBe(0);
    expect(imageryStatus(v.viewer).topLayer).toMatchObject({ id: ION, title: "Bing Maps Aerial" });
  });

  test("ion hidden (no asset) or its switch off: the ion layer goes, the other layers come back in order and the base alpha is what it was", async () => {
    const v = fakeViewer();
    v.base.alpha = 0.8;
    attach(v.viewer);
    for (const hide of [() => ionAsset(null), () => sources({ gibs: true, eox: true, osm: true })]) {
      sources({ gibs: true, eox: true, osm: true, ion: true });
      ionAsset(3830184);
      await resolveIon();
      expect(v.ids()).toEqual([ION]);
      expect(v.base.alpha).toBe(0);
      hide();
      expect(v.ids()).toEqual([BM, VIIRS, EOX, OSM]);
      expect(v.list.at(-1)).toBe(v.grid);
      expect(v.base.alpha).toBe(0.8);
      expect(v.gibs()[3].alpha).toBeCloseTo(0.7, 12);
    }
  });

  test("another asset replaces the ion layer; a provider that arrives after it is no longer wanted is never added", async () => {
    sources({ ion: true });
    ionAsset(3830182);
    const v = fakeViewer();
    attach(v.viewer);
    const first = made.ion.splice(0);
    ionAsset(3830183);
    first[0].resolve(fakeIonProvider());
    await vi.advanceTimersByTimeAsync(0);
    expect(v.ids()).toEqual([]);
    await resolveIon();
    expect(v.ids()).toEqual([ION]);
    expect(imageryStatus(v.viewer).topLayer?.title).toBe("Google Maps Satellite with Labels");
    ionAsset(55555);
    await resolveIon();
    expect(v.ids()).toEqual([ION]);
    expect(imageryStatus(v.viewer).topLayer?.title).toBe("Cesium ion 55555");
  });

  test("an empty token: no provider, the other layers and the base stay, one Thai warning however many viewers", () => {
    setToken("   ");
    const a = fakeViewer();
    const b = fakeViewer();
    attach(a.viewer);
    attach(b.viewer);
    sources({ gibs: true, eox: true, osm: true, ion: true });
    ionAsset(3830182);
    expect(IonImageryProvider.fromAssetId).not.toHaveBeenCalled();
    for (const v of [a, b]) {
      expect(v.ids()).toEqual([BM, VIIRS, EOX, OSM]);
      expect(v.base.alpha).toBe(1);
    }
    expect(warnings()).toHaveLength(1);
    expect(warnings()[0].text).toMatch(/[฀-๿]/);
    // token ที่ใส่ทีหลังใช้ทันที
    setToken(TOKEN);
    expect(IonImageryProvider.fromAssetId).toHaveBeenCalledTimes(2);
    expect(a.ids()).toEqual([]);
  });

  test("settings not read yet: nothing happens until the token is known (no provider, no warning)", () => {
    useSettings.setState({ settings: null });
    sources({ ion: true });
    ionAsset(3830182);
    const v = fakeViewer();
    attach(v.viewer);
    expect(IonImageryProvider.fromAssetId).not.toHaveBeenCalled();
    expect(warnings()).toEqual([]);
    setToken(TOKEN);
    expect(IonImageryProvider.fromAssetId).toHaveBeenCalledTimes(1);
  });

  test.each([
    [401, { statusCode: 401 }],
    [404, { statusCode: 404 }],
    ["network", new Error("Failed to fetch")],
  ])("ion refuses (%s): the layer goes in every viewer, the others come back, one Thai message without the token, no retry", async (_name, error) => {
    const a = fakeViewer();
    const b = fakeViewer();
    attach(a.viewer);
    attach(b.viewer);
    sources({ gibs: true, eox: true, osm: true, ion: true });
    ionAsset(3830182);
    expect(a.ids()).toEqual([]);
    await rejectIon(error);
    for (const v of [a, b]) {
      expect(v.ids()).toEqual([BM, VIIRS, EOX, OSM]);
      expect(v.base.alpha).toBe(1);
      expect(imageryStatus(v.viewer).topLayer?.source).toBe("osm");
    }
    expect(warnings()).toHaveLength(1);
    expect(warnings()[0].text).toMatch(/[฀-๿]/);
    expect(warnings()[0].text).toContain("3830182");
    expect(warnings()[0].text).not.toContain(TOKEN);
    expect(JSON.stringify(useMessages.getState().items)).not.toContain(TOKEN);
    // ไม่ลองซ้ำเองกับ asset และ token เดิม
    setTime("2026-11-12T12:00:00Z");
    vi.advanceTimersByTime(5000);
    show({ ...ALL_SHOWN, [MODIS]: { show: true, translucency: 10 } });
    expect(IonImageryProvider.fromAssetId).toHaveBeenCalledTimes(2);
    // token ใหม่ หรือปิดแล้วเปิดสวิตช์ ion ใหม่ = ลองใหม่
    setToken("tok-other");
    expect(IonImageryProvider.fromAssetId).toHaveBeenCalledTimes(4);
    await rejectIon({ statusCode: 401 });
    sources({ gibs: true, eox: true, osm: true });
    sources({ gibs: true, eox: true, osm: true, ion: true });
    expect(IonImageryProvider.fromAssetId).toHaveBeenCalledTimes(6);
  });

  test("the 401 message says the token was refused; the 404 message says the asset was not found", async () => {
    sources({ ion: true });
    ionAsset(3830182);
    attach(fakeViewer().viewer);
    await rejectIon({ statusCode: 401 });
    ionAsset(77);
    await rejectIon({ statusCode: 404 });
    const [refused, missing] = warnings().map((m) => m.text);
    expect(refused).toContain("token");
    expect(refused).toContain("401");
    expect(missing).toContain("404");
    expect(missing).toContain("77");
  });

  test("the token is never put in any url we build and Ion.defaultAccessToken is never set", async () => {
    const before = Ion.defaultAccessToken;
    const v = fakeViewer();
    attach(v.viewer);
    sources({ gibs: true, eox: true, osm: true, ion: true });
    ionAsset(3830182);
    await resolveIon();
    ionAsset(null);
    expect(providers().length).toBeGreaterThan(0);
    for (const p of providers()) expect(JSON.stringify(p.options)).not.toContain(TOKEN);
    for (const [assetId, options] of vi.mocked(IonImageryProvider.fromAssetId).mock.calls) {
      expect(typeof assetId).toBe("number");
      expect(options).toEqual({ accessToken: TOKEN });
    }
    expect(Ion.defaultAccessToken).toBe(before);
  });

  test("the ion layer follows Ambient Level like the others, and its tile errors are not retried", async () => {
    sources({ ion: true });
    ionAsset(3830182);
    const v = fakeViewer();
    attach(v.viewer, 0.4);
    await resolveIon();
    expect([v.gibs()[0].dayAlpha, v.gibs()[0].nightAlpha]).toEqual([1, 0.4]);
    setImageryNightAlpha(v.viewer, 0.9);
    expect(v.gibs()[0].nightAlpha).toBe(0.9);
    const error = { retry: true, error: { statusCode: 500 } };
    v.gibs()[0].imageryProvider.errorEvent.raiseEvent(error);
    expect(error.retry).toBe(false);
    expect(useImagery.getState().sources.ion).toBe(true);
  });

  test("ion tiles failing past the threshold (any status, or none): one Thai message, the ion layer goes in every viewer, the others and the base come back", async () => {
    const a = fakeViewer();
    const b = fakeViewer();
    attach(a.viewer);
    attach(b.viewer);
    sources({ gibs: true, eox: true, osm: true, ion: true });
    ionAsset(3830182);
    await resolveIon();
    const p = a.gibs()[0].imageryProvider;
    await p.requestImage(0, 0, 3);
    const errors = [{ retry: true, error: { statusCode: 500 } }, { retry: true }, { retry: true, error: new Error("Failed to fetch") }, { retry: true, error: { statusCode: 403 } }];
    for (let i = 0; i < 6; i++) {
      const error = { ...errors[i % errors.length] };
      p.errorEvent.raiseEvent(error);
      expect(error.retry).toBe(false);
    }
    await Promise.resolve();
    // 7 ชิ้น (6 พลาด): ยังไม่ถึงเกณฑ์ HUD บอกสัดส่วนจริง
    expect(a.ids()).toEqual([ION]);
    expect(imageryStatus(a.viewer).topLayer?.missingRatio).toBeCloseTo(6 / 7, 12);
    expect(warnings()).toEqual([]);
    p.errorEvent.raiseEvent({ retry: true });
    await vi.advanceTimersByTimeAsync(0);
    for (const v of [a, b]) {
      expect(v.ids()).toEqual([BM, VIIRS, EOX, OSM]);
      expect(v.base.alpha).toBe(1);
    }
    expect(warnings()).toHaveLength(1);
    expect(warnings()[0].text).toMatch(/[฀-๿]/);
    expect(warnings()[0].text).toContain("3830182");
    expect(JSON.stringify(useMessages.getState().items)).not.toContain(TOKEN);
    expect(getIonFailure()).toEqual({ assetId: 3830182, token: TOKEN });
  });

  test("ion below the threshold keeps the layer: 7 failed tiles alone, or 8 settled with 5 failed", async () => {
    sources({ ion: true });
    ionAsset(3830182);
    const v = fakeViewer();
    attach(v.viewer);
    await resolveIon();
    const p = v.gibs()[0].imageryProvider;
    for (let i = 0; i < 7; i++) p.errorEvent.raiseEvent({ retry: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(v.ids()).toEqual([ION]);
    expect(imageryStatus(v.viewer).topLayer?.missingRatio).toBe(1);
    ionAsset(2);
    await resolveIon();
    const q = v.gibs()[0].imageryProvider;
    for (let i = 0; i < 3; i++) await q.requestImage(0, 0, 3);
    for (let i = 0; i < 5; i++) q.errorEvent.raiseEvent({ retry: true, error: { statusCode: 404 } });
    await vi.advanceTimersByTimeAsync(0);
    expect(v.ids()).toEqual([ION]);
    expect(imageryStatus(v.viewer).topLayer?.missingRatio).toBeCloseTo(5 / 8, 12);
    expect(warnings()).toEqual([]);
  });

  test("our endpoint cache key is built exactly as Cesium's IonImageryProvider.fromAssetId builds it (no server option)", async () => {
    const real = (await vi.importActual<typeof import("cesium")>("cesium")).IonImageryProvider as unknown as {
      fromAssetId(id: number, o: object): Promise<unknown>; _endpointCache: Record<string, unknown>;
    };
    const fetchJson = vi.spyOn(Resource.prototype, "fetchJson").mockImplementation(() => new Promise(() => undefined)); // ไม่ต่อเน็ต
    try {
      const options = { accessToken: "tok-key-check" };
      void real.fromAssetId(424242, options).catch(() => undefined);
      expect(fetchJson).toHaveBeenCalledTimes(1);
      const key = ionEndpointCacheKey(424242, "tok-key-check");
      expect(Object.keys(real._endpointCache)).toContain(key);
      delete real._endpointCache[key];
    } finally {
      fetchJson.mockRestore();
    }
  });

  test.each([
    ["the endpoint request fails", async () => void (await rejectIon(new Error("Failed to fetch")))],
    ["its tiles fail past the threshold", async () => {
      await resolveIon();
      const p = currentIon().imageryProvider;
      for (let i = 0; i < 8; i++) p.errorEvent.raiseEvent({ retry: true });
      await vi.advanceTimersByTimeAsync(0);
    }],
  ])("when ion fails (%s), Cesium's cached endpoint promise is dropped, so switch off→on and None→asset make a real new attempt", async (_name, fail) => {
    const cache = (IonImageryProvider as unknown as { _endpointCache: Record<string, unknown> })._endpointCache;
    const key = ionEndpointCacheKey(3830182, TOKEN);
    sources({ ion: true });
    ionAsset(3830182);
    viewer = fakeViewer();
    attach(viewer.viewer);
    cache[key] = Promise.resolve({}); // ที่ Cesium จำไว้ตอนขอครั้งแรก
    cache["other"] = Promise.resolve({});
    await fail();
    expect(getIonFailure()).not.toBeNull();
    expect(key in cache).toBe(false);
    expect("other" in cache).toBe(true);
    expect(IonImageryProvider.fromAssetId).toHaveBeenCalledTimes(1);
    // ปิดแล้วเปิดสวิตช์ ion: ลองใหม่จริง
    sources({});
    sources({ ion: true });
    expect(IonImageryProvider.fromAssetId).toHaveBeenCalledTimes(2);
    cache[key] = Promise.resolve({});
    await rejectIon({ statusCode: 401 });
    expect(key in cache).toBe(false);
    // None แล้วเลือก asset เดิม: ลองใหม่จริง
    ionAsset(null);
    ionAsset(3830182);
    expect(IonImageryProvider.fromAssetId).toHaveBeenCalledTimes(3);
    delete cache["other"];
  });

  test("detach while ion is shown: the ion layer goes, the base alpha comes back, and a late provider adds nothing", async () => {
    sources({ ion: true });
    ionAsset(3830182);
    const v = fakeViewer();
    const off = attach(v.viewer);
    off();
    expect(v.base.alpha).toBe(1);
    await resolveIon();
    expect(v.list).toEqual([v.base, v.grid]);
    const w = fakeViewer();
    const off2 = attach(w.viewer);
    await resolveIon();
    expect(w.ids()).toEqual([ION]);
    off2();
    expect(w.list).toEqual([w.base, w.grid]);
    expect(w.base.alpha).toBe(1);
  });
});
