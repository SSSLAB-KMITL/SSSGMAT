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
import { afterEach, describe, expect, test, vi } from "vitest";
import type { SensorViewPose } from "../../src/cesium/sensorDraw";
import { createViewer, destroyViewer } from "../../src/cesium/viewer";
import { mountScene3D, mountSensorView, placeSensorCamera } from "../../src/windows/Graphics3D/scene3d";

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

describe("Cesium's own click and double-click picking", () => {
  /** viewer ปลอมที่มี handler จริงพร้อมคลิกและดับเบิลคลิกแบบที่ Viewer ใส่ไว้ (scene ว่าง: ภาพหยุดสร้างที่บรรทัดแรก ไม่มี WebGL) */
  function viewerWithPicking() {
    const handler = new ScreenSpaceEventHandler(document.createElement("canvas"));
    handler.setInputAction(() => undefined, ScreenSpaceEventType.LEFT_CLICK);
    handler.setInputAction(() => undefined, ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
    return { screenSpaceEventHandler: handler, scene: {} };
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
