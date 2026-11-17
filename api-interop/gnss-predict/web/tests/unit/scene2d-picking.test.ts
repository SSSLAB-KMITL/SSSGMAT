// หน้าต่าง 2D (follow-up 13b-2): คลิกซ้ายของ Viewer ของ Cesium (เลือก entity, pickImageryLayerFeatures) โยน DeveloperError
// "Ray intersections are only supported in 3D mode" ทุกครั้งที่คลิกบนแผนที่ 2D จึงต้องถอดออกก่อนสร้างภาพ เหมือน Sensor View
// การเลือกดาวด้วยการคลิกในหน้าต่าง 2D ทำเองด้วย pick.ts (selectOnClick) แบบหน้าต่าง 3D (ตรวจใน e2e: graphics2d.spec.ts)

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ScreenSpaceEventHandler, ScreenSpaceEventType } from "cesium";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createViewer, destroyViewer } from "../../src/cesium/viewer";
import { mountScene2D } from "../../src/windows/Graphics2D/scene2d";

vi.mock("../../src/cesium/viewer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/cesium/viewer")>()),
  createViewer: vi.fn(),
  destroyViewer: vi.fn(),
}));

afterEach(() => {
  vi.mocked(createViewer).mockReset();
  vi.mocked(destroyViewer).mockReset();
});

describe("the 2D window's viewer", () => {
  test("has Cesium's own click and double-click picking taken off before its scene is built", () => {
    const handler = new ScreenSpaceEventHandler(document.createElement("canvas"));
    handler.setInputAction(() => undefined, ScreenSpaceEventType.LEFT_CLICK);
    handler.setInputAction(() => undefined, ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
    const viewer = { screenSpaceEventHandler: handler, scene: { canvas: document.createElement("canvas") } };
    vi.mocked(createViewer).mockReturnValueOnce(viewer as never);
    expect(() => mountScene2D("graphics2d", document.createElement("div"), { projection: "equidistantCylindrical", view: null })).toThrow(); // viewer ปลอมสร้างภาพไม่ได้
    expect(handler.getInputAction(ScreenSpaceEventType.LEFT_CLICK)).toBeUndefined();
    expect(handler.getInputAction(ScreenSpaceEventType.LEFT_DOUBLE_CLICK)).toBeUndefined();
    expect(destroyViewer).toHaveBeenCalledWith(viewer);
  });

  test("selects with pick.ts on a left click in Grab mode (Scene2D needs real WebGL, so its source is checked)", () => {
    const s = readFileSync(resolve(__dirname, "../../src/windows/Graphics2D/scene2d.ts"), "utf8");
    expect(s).toMatch(/selectOnClick\(down, at, \(x, y\) => this\.pathAt\(x, y\)\)/);
    expect(s).toMatch(/markersNear\(/);
  });
});
