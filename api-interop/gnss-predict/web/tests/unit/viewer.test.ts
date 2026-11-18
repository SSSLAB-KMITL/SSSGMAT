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

const { createViewer, destroyViewer, watchRenderFailure, localServerKey, LOCAL_SERVER_REQUESTS, RENDER_LOOP_POLL_MS, RENDER_RETRY_WINDOW_MS } = await import("../../src/cesium/viewer");
const { RequestScheduler } = await import("cesium");
/** getServerKey ของ Cesium เป็นของภายใน (ไม่อยู่ใน type) แต่เป็นตัวที่ RequestScheduler ใช้หา requestsByServer จริง */
const cesiumServerKey = (url: string): string => (RequestScheduler as unknown as { getServerKey(url: string): string }).getServerKey(url);

/** viewer ปลอมที่มีแค่ส่วนที่ destroyViewer / watchRenderFailure ใช้ order จดลำดับการเรียก */
function fakeViewer(gl: unknown = undefined) {
  const order: string[] = [];
  const canvas = document.createElement("canvas");
  const renderError = new CesiumEvent();
  const loseContext = vi.fn(() => void order.push("loseContext"));
  const glContext = gl === undefined ? { getExtension: vi.fn((name: string) => (name === "WEBGL_lose_context" ? { loseContext } : null)) } : gl;
  const viewer = {
    scene: { context: { _gl: glContext }, renderError, canvas, requestRender: vi.fn() },
    useDefaultRenderLoop: true,
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

// ภาพหยุด (QA-01, follow-up 13b-2): ข้อผิดพลาดตอนวาด, render loop ของ Cesium ที่หยุดเงียบ ๆ (useDefaultRenderLoop เป็น false: Cesium จับข้อผิดพลาด
// นอก Scene.render แล้วหยุด loop โดยไม่ยิง renderError เพราะ showRenderLoopErrors = false) หรือ WebGL context หาย
// ครั้งแรก = เริ่ม loop ใหม่หนึ่งครั้ง (useDefaultRenderLoop = true แล้ว requestRender) และแจ้ง recovering = true; หยุดอีกภายใน 5 วินาที = เลิก แจ้ง false
// context หาย = เลิกทันที (เริ่ม loop ใหม่ไม่ช่วย)
describe("watchRenderFailure", () => {
  /** นาฬิกาและตัวตั้งเวลาปลอม: tick() = ผ่านไปหนึ่งรอบของการตรวจ loop */
  function fakeEnv() {
    let t = 0;
    const polls: (() => void)[] = [];
    let stopped = 0;
    return {
      env: {
        now: () => t,
        every: (_ms: number, cb: () => void) => {
          polls.push(cb);
          return () => void stopped++;
        },
      },
      advance: (ms: number) => void (t += ms),
      tick: () => polls.forEach((cb) => cb()),
      polls,
      stoppedPolls: () => stopped,
    };
  }
  const RETRY = RENDER_RETRY_WINDOW_MS;

  test("polls the render loop every RENDER_LOOP_POLL_MS (1 s) and retries within 5 s", () => {
    expect(RENDER_LOOP_POLL_MS).toBe(1000);
    expect(RETRY).toBe(5000);
  });

  test("a render error: one restart (loop on, render requested) and recovering = true", () => {
    const { viewer, renderError } = fakeViewer();
    const f = fakeEnv();
    const onFailure = vi.fn();
    watchRenderFailure(viewer as never, onFailure, f.env);
    const error = new Error("shader failed");
    renderError.raiseEvent(viewer.scene, error);
    expect(onFailure).toHaveBeenCalledWith("renderError", error, true);
    expect(viewer.scene.requestRender).toHaveBeenCalledTimes(1);
    expect(viewer.useDefaultRenderLoop).toBe(true);
  });

  test("a render loop that stopped silently is found by polling, restarted once, and told as loopStopped", () => {
    const { viewer } = fakeViewer();
    const f = fakeEnv();
    const onFailure = vi.fn();
    watchRenderFailure(viewer as never, onFailure, f.env);
    f.tick();
    expect(onFailure).not.toHaveBeenCalled(); // loop ยังวิ่ง
    viewer.useDefaultRenderLoop = false; // Cesium จับข้อผิดพลาดใน render loop แล้วหยุด
    f.tick();
    expect(onFailure).toHaveBeenCalledWith("loopStopped", undefined, true);
    expect(viewer.useDefaultRenderLoop).toBe(true);
    expect(viewer.scene.requestRender).toHaveBeenCalledTimes(1);
    // loop วิ่งต่อหลังเริ่มใหม่: ไม่แจ้งอีก
    f.advance(1000);
    f.tick();
    expect(onFailure).toHaveBeenCalledTimes(1);
  });

  test("dying again within 5 s gives up (recovering = false) and does not restart in a loop", () => {
    const { viewer } = fakeViewer();
    const f = fakeEnv();
    const onFailure = vi.fn();
    watchRenderFailure(viewer as never, onFailure, f.env);
    viewer.useDefaultRenderLoop = false;
    f.tick();
    f.advance(RETRY - 1000);
    viewer.useDefaultRenderLoop = false;
    f.tick();
    expect(onFailure.mock.calls).toEqual([["loopStopped", undefined, true], ["loopStopped", undefined, false]]);
    expect(viewer.useDefaultRenderLoop).toBe(false); // ไม่เริ่มใหม่ครั้งที่สอง
    f.advance(10_000);
    f.tick();
    expect(onFailure).toHaveBeenCalledTimes(2); // เลิกแล้ว ไม่แจ้งซ้ำ
  });

  test("dying again after more than 5 s is a new stop: restarted again", () => {
    const { viewer, renderError } = fakeViewer();
    const f = fakeEnv();
    const onFailure = vi.fn();
    watchRenderFailure(viewer as never, onFailure, f.env);
    renderError.raiseEvent(viewer.scene, new Error("a"));
    f.advance(RETRY + 1);
    viewer.useDefaultRenderLoop = false;
    f.tick();
    expect(onFailure.mock.calls.map((c) => [c[0], c[2]])).toEqual([["renderError", true], ["loopStopped", true]]);
    expect(viewer.useDefaultRenderLoop).toBe(true);
  });

  test("a lost WebGL context gives up at once (a new loop cannot help)", () => {
    const { viewer, canvas } = fakeViewer();
    const onFailure = vi.fn();
    watchRenderFailure(viewer as never, onFailure, fakeEnv().env);
    canvas.dispatchEvent(new Event("webglcontextlost"));
    expect(onFailure).toHaveBeenCalledWith("contextLost", undefined, false);
    expect(viewer.scene.requestRender).not.toHaveBeenCalled();
  });

  test("a viewer without useDefaultRenderLoop (a test fake) is never taken as stopped", () => {
    const { viewer } = fakeViewer();
    delete (viewer as { useDefaultRenderLoop?: boolean }).useDefaultRenderLoop;
    const f = fakeEnv();
    const onFailure = vi.fn();
    watchRenderFailure(viewer as never, onFailure, f.env);
    f.tick();
    expect(onFailure).not.toHaveBeenCalled();
  });

  test("the returned function removes both listeners and stops polling (teardown, before the context is lost on purpose)", () => {
    const { viewer, canvas, renderError } = fakeViewer();
    const f = fakeEnv();
    const onFailure = vi.fn();
    const off = watchRenderFailure(viewer as never, onFailure, f.env);
    expect(renderError.numberOfListeners).toBe(1);
    off();
    expect(renderError.numberOfListeners).toBe(0);
    expect(f.stoppedPolls()).toBe(1);
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

// browser มี HTTP/1.1 ได้ 6 connection ต่อ server (หนึ่งถูก SSE ของ /api/events ถือไว้) แต่ Cesium ขอได้ 18 ต่อ server
// ชิ้นภาพ GIBS ที่ช้า (server รอ NASA ได้ถึง 20 วินาที) จึงกัน API ทั้งหน้าได้: จำกัดคำขอของ Cesium ไป server ในเครื่องไว้ 4
describe("request cap for the local server", () => {
  test.each([
    ["http://127.0.0.1:8000/api/x", { protocol: "http:", host: "127.0.0.1:8000" }],
    ["http://localhost/", { protocol: "http:", host: "localhost" }],
    ["https://studio.example/", { protocol: "https:", host: "studio.example" }],
    ["https://studio.example:8443/", { protocol: "https:", host: "studio.example:8443" }],
    ["http://[::1]:8000/", { protocol: "http:", host: "[::1]:8000" }],
  ])("the key for %s is the same as Cesium's own RequestScheduler.getServerKey", (url, loc) => {
    expect(localServerKey(loc)).toBe(cesiumServerKey(url));
  });

  test("default ports: http 80, https 443", () => {
    expect(localServerKey({ protocol: "http:", host: "localhost" })).toBe("localhost:80");
    expect(localServerKey({ protocol: "https:", host: "studio.example" })).toBe("studio.example:443");
  });

  test("loading the viewer module caps Cesium's requests to this page's server at 4", () => {
    expect(LOCAL_SERVER_REQUESTS).toBe(4);
    expect(RequestScheduler.requestsByServer[cesiumServerKey(window.location.href)]).toBe(4);
    expect(RequestScheduler.requestsByServer[cesiumServerKey("/api/imagery/tiles/x/default/0/0/0")]).toBe(4);
  });
});
