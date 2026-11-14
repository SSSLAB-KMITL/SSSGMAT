// กล้องที่ล็อกของ Sensor View ในส่วน Cesium (scene3d.ts) โดยไม่มี WebGL: Camera, ScreenSpaceEventHandler และ TweenCollection ของ Cesium จริง
// บน scene ปลอมที่มีแค่ส่วนที่ Camera ใช้
// - Viewer ของ Cesium ใส่คลิกซ้าย (เลือก entity) และดับเบิลคลิก (pickAndTrackObject: ตาม entity หรือ zoomTo บินไปหา) ไว้ใน handler ของมันเอง
//   screenSpaceCameraController.enableInputs = false ไม่ได้ปิดสองอย่างนี้ ดับเบิลคลิกใน Sensor View จึงทำให้กล้องหลุดจาก sensor ไม่กลับมา
// - viewer ของ Sensor View ต้องไม่มีสองอย่างนี้ (หน้าต่าง 3D ยังมีตามเดิม) และการวางกล้องทุกครั้งต้องเลิกตาม entity ยกเลิกการบิน และคืน transform

import * as Cesium from "cesium";
import {
  Camera, Cartesian3, Ellipsoid, Entity, GeographicProjection, Math as CesiumMath, Matrix4, PerspectiveFrustum, SceneMode, ScreenSpaceEventHandler,
  ScreenSpaceEventType,
} from "cesium";
import { act } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { SensorViewPose } from "../../src/cesium/sensorDraw";
import { sensorViewFovDeg, sensorViewShortFovDeg } from "../../src/cesium/sensorGeometry";
import { createViewer, destroyViewer } from "../../src/cesium/viewer";
import { DEFAULT_GLOBE } from "../../src/layout/workbook";
import { useImagery, type ImageryLayerInfo } from "../../src/stores/imagery";
import { useLayout } from "../../src/stores/layout";
import { useResults } from "../../src/stores/results";
import { useScenario } from "../../src/stores/scenario";
import { useTime } from "../../src/stores/time";
import { GLOBE_TILE_CACHE_SIZE, mountScene3D, mountSensorView, placeSensorCamera, releaseContextMenu } from "../../src/windows/Graphics3D/scene3d";
import { sensorViewScenes } from "../../src/windows/SensorView/registry";
import { CATALOG, makeScenarioDoc } from "./helpers/objects";

vi.mock("../../src/cesium/viewer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/cesium/viewer")>()),
  createViewer: vi.fn(),
  destroyViewer: vi.fn(),
}));

afterEach(() => {
  vi.mocked(createViewer).mockReset();
  vi.mocked(destroyViewer).mockReset();
});

/** TweenCollection ของ Cesium (มีใน build แต่ไม่อยู่ใน type ที่ประกาศ) ที่ Camera.flyTo ใส่การบินไว้ */
const { TweenCollection } = Cesium as unknown as { TweenCollection: new () => { readonly length: number; update(): void } };

/** Camera จริงบน scene ปลอม (การบินใช้ TweenCollection จริงของ scene) */
function realCamera() {
  const tweens = new TweenCollection();
  const scene: Record<string, unknown> = {
    drawingBufferWidth: 400, drawingBufferHeight: 300, mapProjection: new GeographicProjection(), tweens, mode: SceneMode.SCENE3D,
    ellipsoid: Ellipsoid.WGS84, globe: undefined, screenSpaceCameraController: { minimumZoomDistance: 1, maximumZoomDistance: Infinity },
    requestRender: () => undefined,
  };
  const camera = new Camera(scene as never);
  scene.camera = camera;
  return { camera, tweens };
}

const R = 26_560_000;
/** ดาว GPS เหนือ (0°, 0°) มองลงศูนย์กลางโลก ด้านบนทิศเหนือ */
const POSE: SensorViewPose = { position: { x: R, y: 0, z: 0 }, direction: { x: -1, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 }, fovDeg: 40 };

function expectNear(c: Cartesian3, v: { x: number; y: number; z: number }, digits: number): void {
  expect(c.x).toBeCloseTo(v.x, digits);
  expect(c.y).toBeCloseTo(v.y, digits);
  expect(c.z).toBeCloseTo(v.z, digits);
}

describe("placeSensorCamera", () => {
  test("a double-click that started tracking an entity is undone: tracking off, transform back to identity, camera on the satellite", () => {
    const { camera } = realCamera();
    // แบบที่ EntityView ทำกับกล้องเมื่อ trackedEntity ถูกตั้ง: transform ที่ตำแหน่งของ entity
    camera.lookAtTransform(Matrix4.fromTranslation(new Cartesian3(6_378_137, 0, 0)), new Cartesian3(0, -1e6, 1e6));
    expect(Matrix4.equals(camera.transform, Matrix4.IDENTITY)).toBe(false);
    const viewer = { trackedEntity: new Entity({ id: "fac/THBK" }) as Entity | undefined, camera };
    placeSensorCamera(viewer, POSE, 1);
    expect(viewer.trackedEntity).toBeUndefined();
    expect(Matrix4.equals(camera.transform, Matrix4.IDENTITY)).toBe(true);
    expectNear(camera.positionWC, POSE.position, 3);
    expectNear(camera.directionWC, POSE.direction, 12);
    expectNear(camera.upWC, POSE.up, 12);
    const frustum = camera.frustum as PerspectiveFrustum;
    expect(frustum.near).toBe(1);
    expect(frustum.fov).toBeCloseTo(CesiumMath.toRadians(40), 12);
  });

  test("a double-click that started a flight (zoomTo of the ring, which has no position) is cancelled on the next update", () => {
    const { camera, tweens } = realCamera();
    camera.flyTo({ destination: new Cartesian3(3e7, 1e7, 0), duration: 3 });
    expect(tweens.length).toBe(1);
    placeSensorCamera({ trackedEntity: undefined, camera }, POSE, 1);
    expect(tweens.length).toBe(0);
    tweens.update(); // เฟรมถัดไป: ไม่มีการบินมาดึงกล้องไปที่อื่น
    expectNear(camera.positionWC, POSE.position, 3);
  });

  test("a picture without a size keeps the fov it had", () => {
    const { camera } = realCamera();
    placeSensorCamera({ trackedEntity: undefined, camera }, POSE, 1);
    placeSensorCamera({ trackedEntity: undefined, camera }, { ...POSE, fovDeg: null }, 1);
    expect((camera.frustum as PerspectiveFrustum).fov).toBeCloseTo(CesiumMath.toRadians(40), 12);
  });
});

/** ตัวที่ CesiumWidget ตั้งไว้ที่ canvas (canvas.oncontextmenu = () => false) */
const cesiumOwn = (): boolean => false;

describe("Cesium's own click and double-click picking", () => {
  /** viewer ปลอมที่มี handler จริงพร้อมคลิกและดับเบิลคลิกแบบที่ Viewer ใส่ไว้ (scene ว่าง: ภาพหยุดสร้างที่บรรทัดแรก ไม่มี WebGL) */
  function viewerWithPicking() {
    const handler = new ScreenSpaceEventHandler(document.createElement("canvas"));
    handler.setInputAction(() => undefined, ScreenSpaceEventType.LEFT_CLICK);
    handler.setInputAction(() => undefined, ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
    return { screenSpaceEventHandler: handler, scene: { canvas: { oncontextmenu: cesiumOwn } } };
  }
  const picking = (v: ReturnType<typeof viewerWithPicking>) => [
    typeof v.screenSpaceEventHandler.getInputAction(ScreenSpaceEventType.LEFT_CLICK),
    typeof v.screenSpaceEventHandler.getInputAction(ScreenSpaceEventType.LEFT_DOUBLE_CLICK),
  ];

  test("are taken off a Sensor View's viewer before its scene is built, and kept on a 3D window's", () => {
    const sensor = viewerWithPicking();
    vi.mocked(createViewer).mockReturnValueOnce(sensor as never);
    expect(() => mountSensorView("sensorView", document.createElement("div"))).toThrow(); // viewer ปลอมสร้างภาพไม่ได้ (ไม่มี globe)
    expect(picking(sensor)).toEqual(["undefined", "undefined"]);
    expect(destroyViewer).toHaveBeenCalledWith(sensor);

    const window3d = viewerWithPicking();
    vi.mocked(createViewer).mockReturnValueOnce(window3d as never);
    expect(() => mountScene3D("graphics3d", document.createElement("div"))).toThrow();
    expect(picking(window3d)).toEqual(["function", "function"]);
  });
});

describe("the right-click menu of a 3D window", () => {
  // Cesium ยกเลิกเมนูของ browser ที่ canvas ก่อน event ถึง React และ Radix ไม่เปิดเมนูของ object เมื่อ event ถูกยกเลิกไปแล้ว
  const canvasOf = (v: ReturnType<typeof viewerWith>) => v.scene.canvas;
  const viewerWith = () => ({ screenSpaceEventHandler: new ScreenSpaceEventHandler(document.createElement("canvas")), scene: { canvas: { oncontextmenu: cesiumOwn } } });

  test("releaseContextMenu takes Cesium's handler off the canvas", () => {
    const viewer = viewerWith();
    releaseContextMenu(viewer as never);
    expect(canvasOf(viewer).oncontextmenu).toBeNull();
  });

  test("a 3D window's canvas is released before its scene is built; a Sensor View's keeps Cesium's handler (it has no menu)", () => {
    const window3d = viewerWith();
    vi.mocked(createViewer).mockReturnValueOnce(window3d as never);
    expect(() => mountScene3D("graphics3d", document.createElement("div"))).toThrow();
    expect(canvasOf(window3d).oncontextmenu).toBeNull();

    const sensor = viewerWith();
    vi.mocked(createViewer).mockReturnValueOnce(sensor as never);
    expect(() => mountSensorView("sensorView", document.createElement("div"))).toThrow();
    expect(canvasOf(sensor).oncontextmenu).toBe(cesiumOwn);
  });
});

// ---------- โหมด Camera (imagery spec §5.3, Review Focus 5) ----------
// scene จริง (Scene3D) สองตัวบน viewer ปลอมที่มี EntityCollection, DataSourceCollection, Clock และ Camera ของ Cesium จริง (ไม่มี WebGL):
// หน้าต่าง 3D หลัก + Sensor View ของ Sensor1 บนดาว G01 ในภาพมีดาว G01 G02 G05 (G05 ผู้ใช้ซ่อนไว้), Facility THBK, เส้น access และ sensor ของ G02

describe("Camera display of a Sensor View", () => {
  const ORBIT_R = 26_560_000;
  const OMEGA = (2 * Math.PI) / 43_082;

  function fakeViewer() {
    const { camera } = realCamera();
    const canvas = document.createElement("canvas");
    Object.defineProperty(canvas, "clientWidth", { value: 400 });
    Object.defineProperty(canvas, "clientHeight", { value: 300 });
    const scene = {
      canvas,
      globe: { baseColor: Cesium.Color.BLUE, enableLighting: false, ellipsoid: Ellipsoid.WGS84 },
      light: { intensity: 1 },
      postRender: new Cesium.Event(),
      preRender: new Cesium.Event(),
      primitives: new Cesium.PrimitiveCollection(),
      renderError: new Cesium.Event(),
      requestRender: () => undefined,
      screenSpaceCameraController: { enableInputs: true, enableRotate: true, enableTranslate: true, enableTilt: true, enableLook: true },
    };
    return {
      scene, camera, canvas,
      clock: new Cesium.Clock(),
      entities: new Cesium.EntityCollection(),
      dataSources: new Cesium.DataSourceCollection(),
      dataSourceDisplay: { update: () => true },
      imageryLayers: new Cesium.ImageryLayerCollection(),
      trackedEntity: undefined as Entity | undefined,
      screenSpaceEventHandler: new ScreenSpaceEventHandler(canvas),
      isDestroyed: () => false,
      resize: () => undefined,
    };
  }
  type FakeViewer = ReturnType<typeof fakeViewer>;

  /** ตำแหน่งดาวในวงโคจรวงกลมบนเส้นศูนย์สูตร (ตัวอย่างทุก 60 s ±20 นาทีรอบเวลาปัจจุบัน) */
  function orbit(phase: number): Cesium.SampledPositionProperty {
    const p = new Cesium.SampledPositionProperty();
    const now = Cesium.JulianDate.fromDate(useTime.getState().current);
    for (let s = -1200; s <= 1200; s += 60) {
      const a = OMEGA * s + phase;
      p.addSample(Cesium.JulianDate.addSeconds(now, s, new Cesium.JulianDate()), new Cartesian3(ORBIT_R * Math.cos(a), ORBIT_R * Math.sin(a), 0));
    }
    return p;
  }

  /** ใส่ดาวและเส้น access ใน data source ของ viewer (แทน scene.czml) แล้วให้ scene ตั้งกราฟิกใหม่ (doc ใหม่) */
  function fillScene(viewer: FakeViewer): void {
    const ds = viewer.dataSources.get(0);
    ds.entities.add(new Entity({ id: "sat/G01", position: orbit(1.75) }));
    ds.entities.add(new Entity({ id: "sat/G02", position: orbit(1.9) }));
    ds.entities.add(new Entity({ id: "sat/G05", position: orbit(2.2) }));
    ds.entities.add(new Entity({ id: "access/THBK/G01", polyline: new Cesium.PolylineGraphics({ positions: [new Cartesian3(1, 0, 0), new Cartesian3(2, 0, 0)] }) }));
  }

  const shown = (viewer: FakeViewer): string[] => {
    const out: string[] = [];
    for (let i = 0; i < viewer.dataSources.length; i++) for (const e of viewer.dataSources.get(i).entities.values) if (e.isShowing) out.push(e.id);
    for (const e of viewer.entities.values) if (e.isShowing) out.push(e.id);
    return out.sort();
  };

  /** doc ของ S1: Sensor1 บน G01, Sensor2 บน G02, G05 ปิด Show ของหน้า 3D */
  function scenarioDoc() {
    const doc = makeScenarioDoc({}, { G01: ["Sensor1"], G02: ["Sensor2"] });
    for (const o of doc.objects as { name: string; graphics3d?: unknown }[]) if (o.name === "G05") o.graphics3d = { show: false };
    return doc;
  }

  async function mountBoth() {
    const doc = scenarioDoc();
    useScenario.setState({ name: "S1", doc, tree: null, catalog: new Map(CATALOG.map((e) => [e.norad, e])) });
    useTime.getState().init(doc);
    useResults.setState({ prnByNorad: new Map([[40101, "G01"], [40102, "G02"], [40105, "G05"]]) });
    const main = fakeViewer();
    const sensor = fakeViewer();
    vi.mocked(createViewer).mockReturnValueOnce(main as never).mockReturnValueOnce(sensor as never);
    const mainScene = mountScene3D("graphics3d", document.createElement("div"));
    const sensorScene = mountSensorView("sensorView", document.createElement("div"));
    await vi.waitFor(() => expect([main.dataSources.length, sensor.dataSources.length]).toEqual([1, 1]));
    fillScene(main);
    fillScene(sensor);
    act(() => useScenario.setState({ doc: scenarioDoc() })); // restyle ทั้งสองภาพ
    return { main, sensor, mainScene, sensorScene };
  }

  afterEach(() => {
    useResults.setState({ prnByNorad: new Map() });
    useScenario.setState({ name: null, doc: null, tree: null });
  });

  test("hides everything in its own viewer only; Sensor brings back exactly what the scenario shows (user-hidden stays hidden)", async () => {
    const { main, sensor, mainScene, sensorScene } = await mountBoth();
    const mainBefore = shown(main);
    expect(mainBefore).toEqual(expect.arrayContaining(["sat/G01", "sat/G02", "fac/THBK", "access/THBK/G01", "sensor/Sensor1/ring", "sensor/Sensor2/ring"]));
    expect(mainBefore).not.toContain("sat/G05");

    expect(sensorScene.viewFromSensor("*/Sensor/Sensor1", "north", "sensor", 1)).toBe("ok");
    const sensorMode = shown(sensor);
    expect(sensorMode).toEqual(expect.arrayContaining(["sat/G02", "fac/THBK", "access/THBK/G01", "sensor/Sensor2/ring"]));
    expect(sensorMode.filter((id) => id.startsWith("sensor/Sensor1/"))).toEqual([]);
    expect(sensorMode).not.toContain("sat/G05");
    expect(sensorScene.sensorCamera()?.visibleEntityCount).toBe(sensorMode.length);

    sensorScene.viewFromSensor("*/Sensor/Sensor1", "north", "camera", 1);
    expect(shown(sensor)).toEqual([]);
    expect(sensorScene.sensorCamera()).toMatchObject({ display: "camera", zoom: 1, visibleEntityCount: 0 });
    expect(shown(main)).toEqual(mainBefore); // หน้าต่าง 3D หลักไม่ถูกแตะ

    // doc ใหม่ เวลาเปลี่ยน และ data source ใหม่ระหว่างอยู่ในโหมด Camera ยังไม่มีอะไรโผล่
    act(() => useScenario.setState({ doc: scenarioDoc() }));
    act(() => useTime.getState().setCurrent(new Date(useTime.getState().current.getTime() + 60_000)));
    await sensor.dataSources.add(new Cesium.CustomDataSource("late"));
    sensor.dataSources.get(1).entities.add(new Entity({ id: "late/1" }));
    expect(shown(sensor)).toEqual([]);
    expect(shown(main)).toEqual(mainBefore);
    sensor.dataSources.remove(sensor.dataSources.get(1));

    sensorScene.viewFromSensor("*/Sensor/Sensor1", "north", "sensor", 1);
    expect(shown(sensor)).toEqual(sensorMode);
    expect(shown(sensor)).not.toContain("sat/G05");

    mainScene.destroy();
    sensorScene.destroy();
  });

  test("zoom divides the short-side fov of the camera; position and direction stay on the satellite", async () => {
    const { mainScene, sensorScene } = await mountBoth();
    sensorScene.viewFromSensor("*/Sensor/Sensor1", "north", "camera", 1);
    const wide = sensorScene.sensorCamera()!;
    expect(wide.fovDeg).toBeCloseTo(sensorViewFovDeg(45, 400 / 300), 9);
    sensorScene.viewFromSensor("*/Sensor/Sensor1", "north", "camera", 8);
    const narrow = sensorScene.sensorCamera()!;
    expect(narrow.zoom).toBe(8);
    expect(narrow.fovDeg).toBeCloseTo(sensorViewFovDeg(45, 400 / 300, 8), 9);
    for (let i = 0; i < 3; i++) {
      expect(narrow.position[i]).toBeCloseTo(wide.position[i], 3);
      expect(narrow.direction[i]).toBeCloseTo(wide.direction[i], 12);
    }
    const hud = sensorScene.sensorHud()!;
    expect(hud).toMatchObject({ zoom: 8, imagery: null });
    expect(hud.fovDeg).toBeCloseTo(sensorViewShortFovDeg(45, 8), 12);
    mainScene.destroy();
    sensorScene.destroy();
  });
  test("a zoom or Up change moves only the camera: no restyle (no entity redraw), the fov and the HUD still follow", async () => {
    const { mainScene, sensorScene } = await mountBoth();
    sensorScene.viewFromSensor("*/Sensor/Sensor1", "north", "camera", 1);
    const restyle = vi.spyOn(sensorScene as unknown as { restyle(): void }, "restyle");
    const notified = vi.fn();
    const off = sensorViewScenes.subscribe(notified);
    try {
      sensorScene.viewFromSensor("*/Sensor/Sensor1", "north", "camera", Math.SQRT2);
      expect(sensorScene.sensorCamera()!.fovDeg).toBeCloseTo(sensorViewFovDeg(45, 400 / 300, Math.SQRT2), 9);
      expect(sensorScene.sensorHud()!.fovDeg).toBeCloseTo(sensorViewShortFovDeg(45, Math.SQRT2), 12);
      sensorScene.viewFromSensor("*/Sensor/Sensor1", "velocity", "camera", 2);
      expect(sensorScene.sensorCamera()).toMatchObject({ zoom: 2, display: "camera", visibleEntityCount: 0 });
      expect(sensorScene.sensorCamera()!.fovDeg).toBeCloseTo(sensorViewFovDeg(45, 400 / 300, 2), 9);
      expect(restyle).not.toHaveBeenCalled();
      expect(notified).toHaveBeenCalled(); // HUD อ่านใหม่
      // Display และ path ยังผ่าน restyle
      sensorScene.viewFromSensor("*/Sensor/Sensor1", "velocity", "sensor", 2);
      expect(restyle).toHaveBeenCalledTimes(1);
    } finally {
      off();
      mainScene.destroy();
      sensorScene.destroy();
    }
  });

  test("the globe keeps 1000 tiles in its cache in 3D windows and Sensor Views (Cesium's default is 100)", async () => {
    const { main, sensor, mainScene, sensorScene } = await mountBoth();
    expect(GLOBE_TILE_CACHE_SIZE).toBe(1000);
    expect((main.scene.globe as { tileCacheSize?: number }).tileCacheSize).toBe(1000);
    expect((sensor.scene.globe as { tileCacheSize?: number }).tileCacheSize).toBe(1000);
    mainScene.destroy();
    sensorScene.destroy();
  });

  test("zoom ×262144 (the deepest): the boresight does not move (1e-9) and the fov is the ×1 fov / 262144", async () => {
    const { mainScene, sensorScene } = await mountBoth();
    sensorScene.viewFromSensor("*/Sensor/Sensor1", "north", "camera", 1);
    const wide = sensorScene.sensorCamera()!;
    sensorScene.viewFromSensor("*/Sensor/Sensor1", "north", "camera", 262144);
    const deepest = sensorScene.sensorCamera()!;
    expect(deepest.zoom).toBe(262144);
    expect(deepest.fovDeg).toBeCloseTo(sensorViewFovDeg(45, 400 / 300, 262144), 12);
    expect(deepest.fovDeg).toBeGreaterThan(0);
    for (let i = 0; i < 3; i++) {
      expect(Math.abs(deepest.direction[i] - wide.direction[i])).toBeLessThan(1e-9);
      expect(Math.abs(deepest.up[i] - wide.up[i])).toBeLessThan(1e-9);
      expect(deepest.position[i]).toBeCloseTo(wide.position[i], 3);
    }
    mainScene.destroy();
    sensorScene.destroy();
  });

  test("zoom ×8192: the boresight and the position do not move, only the fov narrows; the HUD carries the view size", async () => {
    const { mainScene, sensorScene } = await mountBoth();
    sensorScene.viewFromSensor("*/Sensor/Sensor1", "north", "camera", 1);
    const wide = sensorScene.sensorCamera()!;
    sensorScene.viewFromSensor("*/Sensor/Sensor1", "north", "camera", 8192);
    const deepest = sensorScene.sensorCamera()!;
    expect(deepest.zoom).toBe(8192);
    expect(deepest.fovDeg).toBeCloseTo(sensorViewFovDeg(45, 400 / 300, 8192), 12);
    expect(deepest.fovDeg).toBeGreaterThan(0);
    expect(deepest.fovDeg).toBeLessThan(0.02);
    for (let i = 0; i < 3; i++) {
      expect(deepest.position[i]).toBeCloseTo(wide.position[i], 3);
      expect(deepest.direction[i]).toBeCloseTo(wide.direction[i], 9);
      expect(deepest.up[i]).toBeCloseTo(wide.up[i], 9);
    }
    // ทิศกล้องยังชี้ลงศูนย์กลางโลก (nadir) ที่ ×8192 ไม่เกิน 0.01° (Review Focus 5)
    const [px, py, pz] = deepest.position;
    const r = Math.hypot(px, py, pz);
    const cos = -(deepest.direction[0] * px + deepest.direction[1] * py + deepest.direction[2] * pz) / r;
    expect((Math.acos(Math.min(1, cos)) * 180) / Math.PI).toBeLessThan(0.01);
    const hud = sensorScene.sensorHud()!;
    expect(hud).toMatchObject({ zoom: 8192, imagery: null, shortSidePx: 300 }); // canvas ปลอมกว้าง 400 สูง 300: ด้านสั้น 300 px
    expect(hud.fovDeg).toBeCloseTo(sensorViewShortFovDeg(45, 8192), 12);
    mainScene.destroy();
    sensorScene.destroy();
  });

  test("the HUD imagery carries the source and max level of the top layer (GIBS, EOX, OSM)", async () => {
    const layers: ImageryLayerInfo[] = [
      { id: "BlueMarble_NextGeneration", title: "Blue Marble", period: "static", max_level: 8, format: "jpg", credit: "NASA GIBS / EOSDIS", source: "gibs" },
      { id: "s2cloudless-2024_3857", title: "Sentinel-2 cloudless 2024", period: "static", max_level: 15, format: "jpg", credit: "EOX", source: "eox" },
    ];
    useImagery.setState({ sources: { gibs: true, eox: false, osm: false, ion: false }, layers, loaded: true });
    useLayout.setState({ globe: { layers: { BlueMarble_NextGeneration: { show: true, translucency: 0 }, "s2cloudless-2024_3857": { show: true, translucency: 0 } }, ion: { assetId: null } } });
    const { mainScene, sensorScene } = await mountBoth();
    try {
      sensorScene.viewFromSensor("*/Sensor/Sensor1", "north", "camera", 1);
      expect(sensorScene.sensorHud()!.imagery).toMatchObject({ title: "Blue Marble", source: "gibs", maxLevel: 8 });
      act(() => useImagery.setState({ sources: { gibs: true, eox: true, osm: false, ion: false } }));
      expect(sensorScene.sensorHud()!.imagery).toMatchObject({ title: "Sentinel-2 cloudless 2024", source: "eox", maxLevel: 15 }); // EOX วาดทับ GIBS
    } finally {
      mainScene.destroy();
      sensorScene.destroy();
      useImagery.setState(useImagery.getInitialState(), true);
      useLayout.setState({ globe: DEFAULT_GLOBE });
    }
  });

  // Ambient Level (3D Graphics Window Properties) ทำให้ด้านกลางคืนจาง: ชั้น GIBS ต้องจางเท่าภาพฐาน (index 0) ไม่ใช่สว่างทั้งลูก
  test("Ambient Level sets the night alpha of the GIBS layers like the base layer, at mount and when the window properties change", async () => {
    useImagery.setState({
      sources: { gibs: true, eox: false, osm: false, ion: false },
      layers: [{ id: "BlueMarble_NextGeneration", title: "Blue Marble", period: "static", max_level: 8, format: "jpg", credit: "NASA GIBS / EOSDIS", source: "gibs" }],
      loaded: true,
    });
    useLayout.setState({ globe: { layers: { BlueMarble_NextGeneration: { show: true, translucency: 20 } }, ion: { assetId: null } }, windowProps: { graphics3d: { enableLighting: true, ambientLevel: 30, latLonLines: false } } });
    const viewer = fakeViewer();
    const base = new Cesium.ImageryLayer(new Cesium.UrlTemplateImageryProvider({ url: "/base/{z}/{x}/{y}.png" })); // ภาพฐาน (Natural Earth II) ปลอม ไม่โหลดชิ้นใด
    viewer.imageryLayers.add(base);
    vi.mocked(createViewer).mockReturnValueOnce(viewer as never);
    const scene = mountScene3D("graphics3d", document.createElement("div"));
    try {
      const gibs = () => Array.from({ length: viewer.imageryLayers.length }, (_, i) => viewer.imageryLayers.get(i)).filter((l) => l !== base);
      expect(gibs()).toHaveLength(1);
      expect(base.nightAlpha).toBeCloseTo(0.3, 12);
      expect(gibs()[0].nightAlpha).toBeCloseTo(0.3, 12);
      expect(gibs()[0].dayAlpha).toBe(1);
      expect(gibs()[0].alpha).toBeCloseTo(0.8, 12);
      act(() => useLayout.setState({ windowProps: { graphics3d: { enableLighting: true, ambientLevel: 70, latLonLines: false } } }));
      expect(base.nightAlpha).toBeCloseTo(0.7, 12);
      expect(gibs()[0].nightAlpha).toBeCloseTo(0.7, 12);
    } finally {
      scene.destroy();
      useImagery.setState(useImagery.getInitialState(), true);
      useLayout.setState({ globe: DEFAULT_GLOBE, windowProps: {} });
    }
  });
});
