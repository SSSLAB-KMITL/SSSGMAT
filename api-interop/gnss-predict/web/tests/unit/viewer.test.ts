// viewer ของ Cesium (src/cesium/viewer.ts) โดยไม่มี WebGL: Viewer ของ Cesium ถูกแทนด้วยตัวปลอมที่จำ option ไว้
// - ปิดหน้าต่าง 3D/2D (หรือเปลี่ยน Projection ของ 2D) ต้องคืน WebGL context ทันที: viewer.destroy() ของ Cesium ไม่เรียก WEBGL_lose_context
//   context จึงค้างจน GC และ Chrome ทิ้ง context ที่เก่าที่สุดเมื่อเกินราว 16 ตัว (มักเป็นหน้าต่าง 3D ตั้งต้น)
// - ข้อผิดพลาดตอนวาด (scene.renderError) และ context ที่หายไป (webglcontextlost) ต้องบอกผู้เรียกเพื่อแสดงข้อความไทย ไม่ใช่กล่องอังกฤษของ Cesium

import { Event as CesiumEvent } from "cesium";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test, vi } from "vitest";

const captured = vi.hoisted(() => ({ options: [] as Record<string, unknown>[] }));
vi.mock("cesium", async (importOriginal) => {
  const actual = await importOriginal<typeof import("cesium")>();
  class FakeViewer {
    clock = { shouldAnimate: true };
    constructor(_el: HTMLElement, options: Record<string, unknown>) {
      captured.options.push(options);
    }
  }
  // ภาพโลกไม่โหลดจริง (ไม่มี network ใน test)
  const ImageryLayer = { fromProviderAsync: () => ({ fake: "layer" }) };
  const TileMapServiceImageryProvider = { fromUrl: () => Promise.resolve({}) };
  return { ...actual, Viewer: FakeViewer, ImageryLayer, TileMapServiceImageryProvider };
});

const { createViewer, destroyViewer, watchRenderFailure } = await import("../../src/cesium/viewer");

/** viewer ปลอมที่มีแค่ส่วนที่ destroyViewer / watchRenderFailure ใช้ order จดลำดับการเรียก */
function fakeViewer(gl: unknown = undefined) {
  const order: string[] = [];
  const canvas = document.createElement("canvas");
  const renderError = new CesiumEvent();
  const loseContext = vi.fn(() => void order.push("loseContext"));
  const glContext = gl === undefined ? { getExtension: vi.fn((name: string) => (name === "WEBGL_lose_context" ? { loseContext } : null)) } : gl;
  const viewer = {
    scene: { context: { _gl: glContext }, renderError, canvas },
    destroy: vi.fn(() => void order.push("destroy")),
  };
  return { viewer, order, loseContext, canvas, renderError };
}

describe("createViewer", () => {
  test("turns off Cesium's own English error panel (the window shows a Thai message instead)", () => {
    captured.options.length = 0;
    createViewer(document.createElement("div"), "3d");
    createViewer(document.createElement("div"), "2d", { projection: "mercator" });
    expect(captured.options).toHaveLength(2);
    for (const options of captured.options) expect(options.showRenderLoopErrors).toBe(false);
  });
});

describe("destroyViewer", () => {
  test("loses the WebGL context just before destroying the viewer, so closing a window frees its context at once", () => {
    const { viewer, order, loseContext } = fakeViewer();
    destroyViewer(viewer as never);
    expect(loseContext).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["loseContext", "destroy"]);
  });

  test("still destroys the viewer when the extension is missing, getExtension throws, or there is no GL context", () => {
    for (const gl of [{ getExtension: () => null }, { getExtension: () => { throw new Error("lost"); } }, null]) {
      const { viewer, order } = fakeViewer(gl);
      expect(() => destroyViewer(viewer as never)).not.toThrow();
      expect(order).toEqual(["destroy"]);
    }
  });

  test("still destroys the viewer when loseContext itself throws", () => {
    const gl = { getExtension: () => ({ loseContext: () => { throw new Error("already lost"); } }) };
    const { viewer, order } = fakeViewer(gl);
    expect(() => destroyViewer(viewer as never)).not.toThrow();
    expect(order).toEqual(["destroy"]);
  });
});

describe("watchRenderFailure", () => {
  test("a render error is passed on with its error", () => {
    const { viewer, renderError } = fakeViewer();
    const onFailure = vi.fn();
    watchRenderFailure(viewer as never, onFailure);
    const error = new Error("shader failed");
    renderError.raiseEvent(viewer.scene, error);
    expect(onFailure).toHaveBeenCalledWith("renderError", error);
  });

  test("a lost WebGL context is passed on", () => {
    const { viewer, canvas } = fakeViewer();
    const onFailure = vi.fn();
    watchRenderFailure(viewer as never, onFailure);
    canvas.dispatchEvent(new Event("webglcontextlost"));
    expect(onFailure).toHaveBeenCalledWith("contextLost", undefined);
  });

  test("tells only once (rendering has stopped either way)", () => {
    const { viewer, canvas, renderError } = fakeViewer();
    const onFailure = vi.fn();
    watchRenderFailure(viewer as never, onFailure);
    renderError.raiseEvent(viewer.scene, new Error("a"));
    canvas.dispatchEvent(new Event("webglcontextlost"));
    renderError.raiseEvent(viewer.scene, new Error("b"));
    expect(onFailure).toHaveBeenCalledTimes(1);
  });

  test("the returned function removes both listeners (teardown, before the context is lost on purpose)", () => {
    const { viewer, canvas, renderError } = fakeViewer();
    const onFailure = vi.fn();
    const off = watchRenderFailure(viewer as never, onFailure);
    expect(renderError.numberOfListeners).toBe(1);
    off();
    expect(renderError.numberOfListeners).toBe(0);
    canvas.dispatchEvent(new Event("webglcontextlost"));
    renderError.raiseEvent(viewer.scene, new Error("late"));
    expect(onFailure).not.toHaveBeenCalled();
  });
});

describe("the 3D and 2D windows (scene3d.ts, scene2d.ts need real WebGL, so their sources are checked)", () => {
  test("destroy their viewer only through destroyViewer, and watch for a stopped picture", () => {
    for (const file of ["src/windows/Graphics3D/scene3d.ts", "src/windows/Graphics2D/scene2d.ts"]) {
      const source = readFileSync(resolve(__dirname, "../..", file), "utf8");
      expect(source, file).not.toMatch(/viewer\.destroy\(\)/);
      expect(source, file).toMatch(/destroyViewer\(this\.viewer\)/);
      expect(source, file).toMatch(/destroyViewer\(viewer\)/); // a constructor that throws
      expect(source, file).toMatch(/watchRenderFailure\(viewer,/);
    }
  });
});
