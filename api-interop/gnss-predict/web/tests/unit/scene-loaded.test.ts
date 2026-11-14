// sceneLoadedAt (window.__gnssStudioTest.sceneLoadedAt, e2e waitForScene) หมายถึง "ดาวใน scene หาได้ตามชื่อแล้ว": scene.czml ถูกใช้ในหน้าต่าง 3D
// และ manifest (NORAD → PRN) มาแล้ว ทั้งสองอย่างมาคนละคำขอ (results.refresh ตั้ง info ก่อน แล้วโหลด manifest.json กับ dop.csv คู่กัน
// ส่วนหน้าต่างเริ่มโหลด scene.czml ทันทีที่ info มา) ลำดับไหนมาก่อนก็ได้ ก่อนหน้านี้ sceneLoadedAt ตั้งตอน scene.czml มาถึงแม้ยังไม่มี manifest
// และค่าเป็นของทั้งหน้า: File → Open โหลด scenario (รอผลลัพธ์และ manifest) แล้วจึงจัดหน้าต่างตาม workbook (restoreFor) ซึ่งแทนหน้าต่าง 3D ตัวเดิม
// ด้วยตัวใหม่ที่ยังไม่มี scene sceneLoadedAt ของตัวเก่าค้างอยู่ จึงทำให้ labelShown("G01") ใน e2e เป็น null (properties.spec สะดุดเป็นครั้งคราว)
// ตอนนี้ sceneLoadedAt = เวลาที่หน้าต่าง 3D ตัวแรก (ที่ลงทะเบียนอยู่ตอนนี้) โหลดเสร็จ
// viewer และ CzmlScene เป็นตัวปลอม (ไม่มี WebGL ไม่ต่อเครือข่าย): CzmlScene ปลอมใช้ data source ใหม่ทันทีที่ URL ของ scene เปลี่ยน

import * as Cesium from "cesium";
import {
  Camera, Cartesian3, Color, CzmlDataSource, Ellipsoid, Entity, EntityCollection, GeographicProjection, JulianDate, ReferenceFrame, SampledPositionProperty,
  SceneMode, ScreenSpaceEventHandler,
} from "cesium";
import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createViewer, destroyViewer } from "../../src/cesium/viewer";
import { useLayout } from "../../src/stores/layout";
import { useResults, type ResultsInfo } from "../../src/stores/results";
import { useScenario } from "../../src/stores/scenario";
import { useTime } from "../../src/stores/time";
import { registerScene, resetScenes, sceneLoadedAt } from "../../src/windows/Graphics3D/registry";
import { mountScene3D } from "../../src/windows/Graphics3D/scene3d";
import type { CzmlSceneOptions, SceneUrls } from "../../src/windows/graphics/sceneSource";
import { CATALOG, makeScenarioDoc } from "./helpers/objects";

vi.mock("../../src/cesium/viewer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/cesium/viewer")>()),
  createViewer: vi.fn(),
  destroyViewer: vi.fn(),
}));

/** data source ที่ CzmlScene ปลอมจะใช้เมื่อ URL ของ scene เปลี่ยน (test ใส่ entity ก่อน) */
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

const GPS_R = 26_560_000;

function fakeViewer() {
  const TweenCollection = (Cesium as unknown as { TweenCollection: new () => unknown }).TweenCollection;
  const scene0: Record<string, unknown> = {
    drawingBufferWidth: 400, drawingBufferHeight: 300, mapProjection: new GeographicProjection(), tweens: new TweenCollection(), mode: SceneMode.SCENE3D,
    ellipsoid: Ellipsoid.WGS84, globe: undefined, screenSpaceCameraController: { minimumZoomDistance: 1, maximumZoomDistance: Infinity }, requestRender: () => undefined,
  };
  const camera = new Camera(scene0 as never);
  const canvas = document.createElement("canvas");
  const scene = {
    canvas, globe: { baseColor: Color.BLUE, enableLighting: false, ellipsoid: Ellipsoid.WGS84 }, light: { intensity: 1 },
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

/** data source แบบ scene.czml ที่มีดาว G01 */
function czmlWithG01(): CzmlDataSource {
  const ds = new CzmlDataSource("gnss-studio");
  const p = new SampledPositionProperty(ReferenceFrame.FIXED);
  const now = JulianDate.fromDate(useTime.getState().current);
  for (let s = -600; s <= 600; s += 60) p.addSample(JulianDate.addSeconds(now, s, new JulianDate()), new Cartesian3(GPS_R, s * 1000, 0));
  ds.entities.add(new Entity({ id: "sat/G01", position: p }));
  return ds;
}

const INFO: ResultsInfo = {
  ephem: { status: "current", hash: "abc" } as ResultsInfo["ephem"],
  access: {},
  error: null,
};
const MANIFEST = { satellites: [{ norad: 40101, prn: "G01" }] } as never;

describe("sceneLoadedAt: the first 3D window's satellites can be found by name", () => {
  beforeEach(() => {
    resetScenes();
    const doc = makeScenarioDoc();
    useScenario.setState({ name: "S1", doc, tree: null, catalog: new Map(CATALOG.map((e) => [e.norad, e])) });
    useTime.getState().init(doc);
    useLayout.setState({ windowProps: { graphics3d: { satelliteModels: false } } });
    useResults.setState({ status: "current", info: null, manifest: null, prnByNorad: new Map() });
    nextScene = czmlWithG01();
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

  /** แบบ useSceneMount: สร้างแล้วลงทะเบียน ทำลาย = ถอนทะเบียนก่อน */
  function mount(panelId = "graphics3d") {
    const viewer = fakeViewer();
    vi.mocked(createViewer).mockReturnValueOnce(viewer as never);
    const scene = mountScene3D(panelId, document.createElement("div"));
    const off = registerScene(scene);
    return { viewer, scene, unmount: () => { off(); scene.destroy(); } };
  }

  test("scene.czml first, manifest later: not loaded until the manifest is in; then G01 is found and its label shown", async () => {
    const { viewer, scene, unmount } = mount();
    act(() => useResults.setState({ info: INFO }));
    await vi.waitFor(() => expect(viewer.dataSources.contains(nextScene!)).toBe(true));
    await new Promise((r) => setTimeout(r, 20));
    expect(sceneLoadedAt()).toBeNull();
    expect(scene.labelShown("G01")).toBeNull(); // หาดาวตามชื่อไม่ได้: ยังไม่ใช่ "โหลดแล้ว"
    act(() => useResults.setState({ manifest: MANIFEST, prnByNorad: new Map([[40101, "G01"]]) }));
    expect(sceneLoadedAt()).not.toBeNull();
    expect(scene.labelShown("G01")).toBe(true);
    unmount();
  });

  test("manifest first, scene.czml later: loaded when the scene is adopted", async () => {
    const { viewer, scene, unmount } = mount();
    act(() => useResults.setState({ manifest: MANIFEST, prnByNorad: new Map([[40101, "G01"]]) }));
    await new Promise((r) => setTimeout(r, 20));
    expect(sceneLoadedAt()).toBeNull(); // data source ว่าง (ยังไม่มี scene.czml) ไม่นับ
    act(() => useResults.setState({ info: INFO }));
    await vi.waitFor(() => expect(sceneLoadedAt()).not.toBeNull());
    expect(viewer.dataSources.contains(nextScene!)).toBe(true);
    expect(scene.labelShown("G01")).toBe(true);
    unmount();
  });

  test("a 3D window that replaces a loaded one (File → Open restores the workbook after the results are in) is not loaded until its own scene is", async () => {
    const first = mount();
    act(() => useResults.setState({ info: INFO, manifest: MANIFEST, prnByNorad: new Map([[40101, "G01"]]) }));
    await vi.waitFor(() => expect(sceneLoadedAt()).not.toBeNull());
    first.unmount();
    expect(sceneLoadedAt()).toBeNull(); // ไม่มีหน้าต่าง 3D
    nextScene = czmlWithG01();
    const second = mount();
    expect(sceneLoadedAt()).toBeNull(); // หน้าต่างใหม่ยังไม่มี scene.czml: labelShown("G01") ยังเป็น null
    expect(second.scene.labelShown("G01")).toBeNull();
    await vi.waitFor(() => expect(sceneLoadedAt()).not.toBeNull());
    expect(second.scene.labelShown("G01")).toBe(true);
    second.unmount();
  });
});
