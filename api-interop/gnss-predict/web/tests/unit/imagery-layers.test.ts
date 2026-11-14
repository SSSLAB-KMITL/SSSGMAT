// ชั้นภาพ GIBS บน viewer 3D (spec imagery §5.2, src/cesium/imageryLayers.ts) โดยไม่มี WebGL และไม่ต่อเน็ต:
// ImageryLayer, UrlTemplateImageryProvider และ WebMercatorTilingScheme ของ Cesium ถูกแทนด้วยตัวปลอมที่จำ option ไว้
// viewer ปลอมมีแค่ imageryLayers (รายการธรรมดา: index 0 = Natural Earth II, ท้ายสุด = เส้น Lat/Lon) กับ scene.requestRender
// - สวิตช์ปิด = ไม่มีชั้น GIBS; ชั้นที่แสดงอยู่เหนือ index 0 เรียงตาม catalog และอยู่ใต้เส้น Lat/Lon เสมอ
// - token ของเวลาเปลี่ยน = เปลี่ยนชั้นนั้นใหม่ ไม่เกิน 1 ครั้งต่อวินาทีต่อ viewer (ครั้งท้ายตามมาเสมอ) ชั้นเดิมอยู่จนชั้นใหม่เริ่มโหลด
// - provider ของแต่ละ viewer เป็นคนละตัว; ชิ้น 404 ไม่ลองซ้ำและนับเป็นไม่มีภาพ; 403 = server ปิดสวิตช์ เอาชั้นออกทั้งหมด

import { Event as CesiumEvent } from "cesium";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

interface FakeProvider {
  options: Record<string, unknown>;
  errorEvent: CesiumEvent;
  requestImage: (x: number, y: number, level: number, request?: unknown) => Promise<unknown> | undefined;
}
interface FakeLayer {
  imageryProvider: FakeProvider;
  alpha: number;
}

const made = vi.hoisted(() => ({ providers: [] as unknown[], schemes: [] as unknown[] }));

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
    constructor(public imageryProvider: unknown, _options?: unknown) {}
  }
  return { ...actual, UrlTemplateImageryProvider, WebMercatorTilingScheme, ImageryLayer };
});

const { WebMercatorTilingScheme } = await import("cesium");
const { attachImageryLayers, imageryStatus, TOKEN_INTERVAL_MS } = await import("../../src/cesium/imageryLayers");
const { useImagery } = await import("../../src/stores/imagery");
const { useLayout } = await import("../../src/stores/layout");
const { useTime } = await import("../../src/stores/time");
const { DEFAULT_GLOBE } = await import("../../src/layout/workbook");

const BM = "BlueMarble_NextGeneration";
const VIIRS = "VIIRS_NOAA20_CorrectedReflectance_TrueColor";
const MODIS = "MODIS_Terra_CorrectedReflectance_TrueColor";
const HIMA = "Himawari_AHI_Band3_Red_Visible_1km";

const CATALOG = [
  { id: BM, title: "Blue Marble", period: "static", max_level: 8, format: "jpg", credit: "NASA GIBS / EOSDIS" },
  { id: VIIRS, title: "VIIRS NOAA-20 True Color", period: "daily", max_level: 9, format: "jpg", credit: "NASA GIBS / EOSDIS" },
  { id: MODIS, title: "MODIS Terra True Color", period: "daily", max_level: 9, format: "jpg", credit: "NASA GIBS / EOSDIS" },
  { id: HIMA, title: "Himawari-9 Red Visible", period: "10min", max_level: 7, format: "png", credit: "NASA GIBS / EOSDIS, JMA" },
] as const;

/** viewer ปลอม: imageryLayers แบบ ImageryLayerCollection (add ที่ index แทรก, remove เอาออก) เริ่มด้วยฐานและเส้น Lat/Lon */
function fakeViewer() {
  const base = { name: "NaturalEarthII" };
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

const idOf = (l: FakeLayer): string => String(l.imageryProvider.options.url).split("/")[4];
const tokenOf = (l: FakeLayer): string => String(l.imageryProvider.options.url).split("/")[5];
const providers = () => made.providers as FakeProvider[];
const providersOf = (id: string) => providers().filter((p) => String(p.options.url).split("/")[4] === id);

const setTime = (iso: string) => useTime.setState({ current: new Date(iso) });
const show = (layers: Record<string, { show: boolean; translucency: number }>) => useLayout.setState({ globe: { layers } });

const offs: (() => void)[] = [];
function attach(viewer: never) {
  const off = attachImageryLayers(viewer, { now: () => Date.now() });
  offs.push(off);
  return off;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-14T00:00:00Z"));
  made.providers.length = 0;
  made.schemes.length = 0;
  useImagery.setState({ enabled: true, layers: [...CATALOG], loaded: true });
  useLayout.setState({ globe: DEFAULT_GLOBE });
  setTime("2026-11-11T12:00:00Z");
});
afterEach(() => {
  for (const off of offs.splice(0)) off();
  vi.useRealTimers();
  useImagery.setState(useImagery.getInitialState(), true);
});

describe("attachImageryLayers", () => {
  test("switch off: no GIBS layer is added, not even for shown layers", () => {
    useImagery.setState({ enabled: false });
    const v = fakeViewer();
    attach(v.viewer);
    expect(v.list).toEqual([v.base, v.grid]);
    expect(providers()).toHaveLength(0);
  });

  test("switch on with two layers shown: they sit at indices 1 and 2 in catalog order, the Lat/Lon grid stays last", () => {
    show({ [MODIS]: { show: true, translucency: 0 }, [VIIRS]: { show: true, translucency: 0 }, [BM]: { show: false, translucency: 0 } });
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
    show({ [MODIS]: { show: true, translucency: 0 } });
    const v = fakeViewer();
    attach(v.viewer);
    show({ [MODIS]: { show: true, translucency: 0 }, [BM]: { show: true, translucency: 0 }, [VIIRS]: { show: true, translucency: 0 } });
    expect(v.ids()).toEqual([BM, VIIRS, MODIS]);
    expect(v.list[0]).toBe(v.base);
    expect(v.list.at(-1)).toBe(v.grid);
  });

  test("hiding a layer, turning the switch off, or a catalog without the layer takes it off", () => {
    const v = fakeViewer();
    attach(v.viewer);
    expect(v.ids()).toEqual([BM, VIIRS]);
    show({ [BM]: { show: true, translucency: 0 }, [VIIRS]: { show: false, translucency: 0 } });
    expect(v.ids()).toEqual([BM]);
    useImagery.setState({ layers: CATALOG.filter((l) => l.id !== BM) });
    expect(v.ids()).toEqual([]);
    useImagery.setState({ layers: [...CATALOG] });
    expect(v.ids()).toEqual([BM]);
    useImagery.setState({ enabled: false });
    expect(v.list).toEqual([v.base, v.grid]);
  });

  test("ids the catalog does not know are ignored", () => {
    show({ Future_Layer: { show: true, translucency: 0 }, [VIIRS]: { show: true, translucency: 0 } });
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
    show({ [VIIRS]: { show: true, translucency: 0 }, [HIMA]: { show: true, translucency: 0 }, [BM]: { show: true, translucency: 0 } });
    const v = fakeViewer();
    attach(v.viewer);
    const [bm, viirs, hima] = v.gibs().map((l) => l.imageryProvider.options);
    expect(viirs.url).toBe("/api/imagery/tiles/VIIRS_NOAA20_CorrectedReflectance_TrueColor/2026-11-11/{z}/{y}/{x}");
    expect(bm.url).toBe("/api/imagery/tiles/BlueMarble_NextGeneration/default/{z}/{y}/{x}");
    expect(hima.url).toBe("/api/imagery/tiles/Himawari_AHI_Band3_Red_Visible_1km/2026-11-11T12:00:00Z/{z}/{y}/{x}");
    expect(viirs.tilingScheme).toBeInstanceOf(WebMercatorTilingScheme);
    expect(viirs.maximumLevel).toBe(9);
    expect(hima.maximumLevel).toBe(7);
    expect(viirs.credit).toBe("NASA GIBS / EOSDIS");
    expect(hima.credit).toBe("NASA GIBS / EOSDIS, JMA");
  });

  test("time that moves within the same token replaces nothing", () => {
    show({ [VIIRS]: { show: true, translucency: 0 }, [BM]: { show: true, translucency: 0 } });
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
    show({ [VIIRS]: { show: true, translucency: 0 }, [BM]: { show: true, translucency: 0 } });
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
    show({ [HIMA]: { show: true, translucency: 0 } });
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
    show({ [VIIRS]: { show: true, translucency: 0 } });
    const v = fakeViewer();
    attach(v.viewer);
    setTime("2026-11-12T12:00:00Z");
    expect(v.gibs().map(tokenOf)).toEqual(["2026-11-12"]);
  });

  test("a tile that fails also counts as the new layer having started (the old one goes)", async () => {
    show({ [VIIRS]: { show: true, translucency: 0 } });
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
    show({ [MODIS]: { show: true, translucency: 0 } });
    setTime("2026-11-20T00:00:00Z");
    useImagery.setState({ enabled: false });
    useImagery.setState({ enabled: true });
    vi.advanceTimersByTime(5000);
    expect(providers()).toHaveLength(count);
    expect(v.list).toEqual([v.base, v.grid]);
    expect(imageryStatus(v.viewer).topLayer).toBeNull();
  });

  test("a 404 tile is not retried and counts as missing for its (layer, token); a loaded tile counts as present", async () => {
    show({ [VIIRS]: { show: true, translucency: 0 } });
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
    // token ใหม่นับใหม่
    setTime("2026-11-12T12:00:00Z");
    expect(imageryStatus(v.viewer).topLayer?.missingRatio).toBe(0);
  });

  test("other tile errors are not retried either and do not count as missing imagery", () => {
    show({ [VIIRS]: { show: true, translucency: 0 } });
    const v = fakeViewer();
    attach(v.viewer);
    const p = v.gibs()[0].imageryProvider;
    for (const error of [{ retry: true, error: { statusCode: 503 } }, { retry: true, error: new Error("network") }, { retry: true }]) {
      p.errorEvent.raiseEvent(error);
      expect(error.retry).toBe(false);
    }
    expect(imageryStatus(v.viewer).topLayer?.missingRatio).toBe(0);
    expect(useImagery.getState().enabled).toBe(true);
  });

  test("a 403 tile (server switch is off) turns the switch off here and takes every GIBS layer off every viewer", async () => {
    const a = fakeViewer();
    const b = fakeViewer();
    attach(a.viewer);
    attach(b.viewer);
    a.gibs()[0].imageryProvider.errorEvent.raiseEvent({ retry: true, error: { statusCode: 403 } });
    await Promise.resolve();
    expect(useImagery.getState().enabled).toBe(false);
    expect(a.list).toEqual([a.base, a.grid]);
    expect(b.list).toEqual([b.base, b.grid]);
  });
});

describe("imageryStatus", () => {
  test("the top layer is the last shown layer in catalog order, labelled by its time token", () => {
    show({ [BM]: { show: true, translucency: 0 }, [VIIRS]: { show: true, translucency: 0 } });
    const v = fakeViewer();
    attach(v.viewer);
    expect(imageryStatus(v.viewer).topLayer).toEqual({ id: VIIRS, title: "VIIRS NOAA-20 True Color", label: "2026-11-11", missingRatio: 0 });
    show({ [BM]: { show: true, translucency: 0 }, [HIMA]: { show: true, translucency: 0 } });
    expect(imageryStatus(v.viewer).topLayer).toMatchObject({ id: HIMA, label: "2026-11-11 12:00 UTC" });
    show({ [BM]: { show: true, translucency: 0 } });
    expect(imageryStatus(v.viewer).topLayer).toMatchObject({ id: BM, title: "Blue Marble", label: "" });
  });

  test("nothing shown, switch off, or a viewer without the manager: null (the HUD says Natural Earth II)", () => {
    const v = fakeViewer();
    expect(imageryStatus(v.viewer).topLayer).toBeNull();
    attach(v.viewer);
    show({});
    expect(imageryStatus(v.viewer).topLayer).toBeNull();
    show(DEFAULT_GLOBE.layers);
    useImagery.setState({ enabled: false });
    expect(imageryStatus(v.viewer).topLayer).toBeNull();
  });
});
