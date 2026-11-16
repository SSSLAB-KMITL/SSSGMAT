// หน้าต่าง 3D (task 13c): Show Orbits ของหน้าต่าง (props.showOrbits) ซ่อนเส้นวงโคจรของดาวทุกดวงในหน้าต่างนั้น ทั้ง path ของ Cesium
// และเส้น Inertial by Window ที่หน้าต่างวาดเอง โดยไม่แตะค่าของ object; test hook pathCount นับเส้นที่วาดอยู่
// และลูกโลกที่ไม่ซีด: viewer 3D ปิด ground atmosphere (scene.globe.showGroundAtmosphere = false) ทั้งหน้าต่าง 3D และ Sensor View
// viewer และ CzmlScene เป็นตัวปลอม (ไม่มี WebGL ไม่ต่อเครือข่าย) แบบ scene-loaded.test.ts

import * as Cesium from "cesium";
import { Camera, Color, CzmlDataSource, Ellipsoid, EntityCollection, GeographicProjection, JulianDate, SceneMode, ScreenSpaceEventHandler, type Entity } from "cesium";
import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createViewer, destroyViewer } from "../../src/cesium/viewer";
import { useLayout } from "../../src/stores/layout";
import { useResults, type ResultsInfo } from "../../src/stores/results";
import { useScenario } from "../../src/stores/scenario";
import { useTime } from "../../src/stores/time";
import { resetScenes } from "../../src/windows/Graphics3D/registry";
import { mountScene3D, mountSensorView } from "../../src/windows/Graphics3D/scene3d";
import type { CzmlSceneOptions, SceneUrls } from "../../src/windows/graphics/sceneSource";
import { CATALOG, makeScenarioDoc } from "./helpers/objects";

vi.mock("../../src/cesium/viewer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/cesium/viewer")>()),
  createViewer: vi.fn(),
  destroyViewer: vi.fn(),
}));

let nextScene: CzmlDataSource | null = null;

vi.mock("../../src/windows/graphics/sceneSource", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/windows/graphics/sceneSource")>();
  class FakeCzmlScene {
    private current: CzmlDataSource | null = null;
    private url: string | null | undefined = undefined;
    constructor(private readonly viewer: { dataSources: Cesium.DataSourceCollection }, private readonly opts: CzmlSceneOptions) {}
    get ds(): CzmlDataSource | null {
      return this.current;
    }
    update(urls: SceneUrls): boolean {
      if (urls.sceneUrl === this.url) return false;
      this.url = urls.sceneUrl;
      const ds = urls.sceneUrl !== null && nextScene !== null ? nextScene : new CzmlDataSource("gnss-studio");
      const fromScene = urls.sceneUrl !== null;
      void this.viewer.dataSources.add(ds).then(() => {
        this.current = ds;
        this.opts.adopted(ds, fromScene);
      });
      return true;
    }
    failed(): boolean {
      return false;
    }
    dispose(): void {
      this.current = null;
    }
  }
  return { ...real, CzmlScene: FakeCzmlScene };
});

function fakeViewer() {
  const TweenCollection = (Cesium as unknown as { TweenCollection: new () => unknown }).TweenCollection;
  const scene0: Record<string, unknown> = {
    drawingBufferWidth: 400, drawingBufferHeight: 300, mapProjection: new GeographicProjection(), tweens: new TweenCollection(), mode: SceneMode.SCENE3D,
    ellipsoid: Ellipsoid.WGS84, globe: undefined, screenSpaceCameraController: { minimumZoomDistance: 1, maximumZoomDistance: Infinity }, requestRender: () => undefined,
  };
  const camera = new Camera(scene0 as never);
  const canvas = document.createElement("canvas");
  const scene = {
    canvas,
    // ค่าตั้งต้นของ Cesium: ground atmosphere เปิด
    globe: { baseColor: Color.BLUE, enableLighting: false, ellipsoid: Ellipsoid.WGS84, showGroundAtmosphere: true },
    skyAtmosphere: { show: true },
    light: { intensity: 1 },
    postRender: new Cesium.Event(), preRender: new Cesium.Event(), renderError: new Cesium.Event(), requestRender: () => undefined,
    primitives: new Cesium.PrimitiveCollection(),
    screenSpaceCameraController: { enableInputs: true, enableRotate: true, enableTranslate: true, enableTilt: true, enableLook: true },
  };
  return {
    scene, camera, canvas, clock: new Cesium.Clock(), entities: new EntityCollection(), dataSources: new Cesium.DataSourceCollection(),
    dataSourceDisplay: { update: () => true }, imageryLayers: new Cesium.ImageryLayerCollection(), trackedEntity: undefined as Entity | undefined,
    screenSpaceEventHandler: new ScreenSpaceEventHandler(canvas), isDestroyed: () => false, resize: () => undefined,
  };
}

const R = 26_560_000;

/** scene.czml ที่มีดาว G01 และ G02 วงกลมรัศมี R ตัวอย่างทุก 300 s ±1 วันรอบเวลาปัจจุบัน (แบบ scene-graphics.test.ts) */
async function czml(): Promise<CzmlDataSource> {
  const t0 = JulianDate.addDays(JulianDate.fromDate(useTime.getState().current), -1, new JulianDate());
  const epoch = JulianDate.toIso8601(t0);
  const stop = JulianDate.toIso8601(JulianDate.addDays(t0, 2, new JulianDate()));
  const packet = (prn: string, phase: number) => {
    const cartesian: number[] = [];
    for (let s = 0; s <= 2 * 86_400; s += 300) {
      const a = phase + (2 * Math.PI * s) / 43_078;
      cartesian.push(s, R * Math.cos(a), R * Math.sin(a) * 0.5, R * Math.sin(a) * 0.866);
    }
    return {
      id: `sat/${prn}`, availability: `${epoch}/${stop}`,
      position: { epoch, cartesian, referenceFrame: "FIXED", interpolationAlgorithm: "LAGRANGE", interpolationDegree: 7 },
    };
  };
  return CzmlDataSource.load([{ id: "document", version: "1.0" }, packet("G01", 0), packet("G02", 1)]);
}

const INFO: ResultsInfo = { ephem: { status: "current", hash: "abc" } as ResultsInfo["ephem"], access: {}, error: null };

describe("Show Orbits in a 3D window", () => {
  beforeEach(async () => {
    resetScenes();
    const doc = makeScenarioDoc();
    useScenario.setState({ name: "S1", doc, tree: null, catalog: new Map(CATALOG.map((e) => [e.norad, e])) });
    useTime.getState().init(doc);
    useLayout.setState({ windowProps: { graphics3d: { satelliteModels: false } } });
    useResults.setState({ status: "current", info: null, manifest: null, prnByNorad: new Map() });
    nextScene = await czml();
  });
  afterEach(() => {
    nextScene = null;
    resetScenes();
    useResults.setState({ status: "unknown", info: null, manifest: null, prnByNorad: new Map() });
    useScenario.setState({ name: null, doc: null, tree: null });
    useLayout.setState({ windowProps: {} });
    vi.mocked(createViewer).mockReset();
    vi.mocked(destroyViewer).mockReset();
  });

  /** หน้าต่าง 3D ที่โหลด scene แล้ว (G01 และ G02 ในภาพ ตาม NORAD ของ doc ตัวอย่าง) */
  async function mounted() {
    const viewer = fakeViewer();
    vi.mocked(createViewer).mockReturnValueOnce(viewer as never);
    const scene = mountScene3D("graphics3d", document.createElement("div"));
    const doc = useScenario.getState().doc!;
    const sats = doc.objects.filter((o) => o.class === "Satellite") as { norad: number; name: string }[];
    const prnByNorad = new Map([[sats[0].norad, "G01"], [sats[1].norad, "G02"]]);
    act(() => useResults.setState({ info: INFO, manifest: { satellites: [] } as never, prnByNorad }));
    await vi.waitFor(() => expect(viewer.dataSources.contains(nextScene!)).toBe(true));
    await vi.waitFor(() => expect(scene.pathCount!()).toBeGreaterThan(0));
    return { viewer, scene, sats };
  }
  const setOrbits = (on: boolean) => act(() => useLayout.getState().setWindowProps("graphics3d", { ...useLayout.getState().windowProps.graphics3d, showOrbits: on }));

  test("off hides every orbit line of the window (Cesium paths and the Inertial by Window polyline); on brings back what the objects say", async () => {
    // ดาวดวงที่สองตั้ง Inertial by Window: หน้าต่างวาด polyline เอง (ไม่ใช่ path ของ Cesium)
    const doc = useScenario.getState().doc!;
    const second = doc.objects.filter((o) => o.class === "Satellite")[1];
    const docInertial = {
      ...doc,
      objects: doc.objects.map((o) => (o === second ? { ...o, graphics3d: { ...(o as { graphics3d?: object }).graphics3d, orbit_system: "Inertial by Window" } } : o)),
    };
    useScenario.setState({ doc: docInertial as never });
    const { scene } = await mounted();
    const before = JSON.stringify(useScenario.getState().doc);
    expect(scene.pathCount!()).toBe(2); // G01 (path) + G02 (Inertial by Window)

    setOrbits(false);
    expect(scene.pathCount!()).toBe(0);
    expect(scene.labelShown(second.name)).toBe(true); // ดาวยังอยู่ ป้ายยังแสดง
    expect(JSON.stringify(useScenario.getState().doc)).toBe(before);

    setOrbits(true);
    expect(scene.pathCount!()).toBe(2);
    scene.destroy();
  });

  test("an object whose own 3D Show is off stays without a line when the window's option comes back on", async () => {
    const doc = useScenario.getState().doc!;
    const first = doc.objects.filter((o) => o.class === "Satellite")[0];
    useScenario.setState({ doc: { ...doc, objects: doc.objects.map((o) => (o === first ? { ...o, graphics3d: { show: false } } : o)) } as never });
    const { scene } = await mounted();
    expect(scene.pathCount!()).toBe(1);
    setOrbits(false);
    expect(scene.pathCount!()).toBe(0);
    setOrbits(true);
    expect(scene.pathCount!()).toBe(1);
    scene.destroy();
  });
});

describe("a realistic globe (task 13c)", () => {
  afterEach(() => {
    resetScenes();
    vi.mocked(createViewer).mockReset();
    vi.mocked(destroyViewer).mockReset();
  });

  test("3D windows and Sensor View turn the ground atmosphere off (it washes the imagery out) and keep the sky atmosphere", () => {
    for (const mount of [mountScene3D, mountSensorView]) {
      const viewer = fakeViewer();
      vi.mocked(createViewer).mockReturnValueOnce(viewer as never);
      const handle = mount("graphics3d", document.createElement("div"));
      expect(viewer.scene.globe.showGroundAtmosphere).toBe(false);
      expect(viewer.scene.skyAtmosphere.show).toBe(true);
      handle.destroy();
    }
  });
});
