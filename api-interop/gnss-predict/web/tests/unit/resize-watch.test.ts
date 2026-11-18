// QA-01 (docs/2026-11-17-qa01-2d-black-after-sensor-view.md): viewer ของ Cesium ทุกตัว (3D, 2D, Sensor View) ฟังขนาดจริงของ element ของมันเอง
// ด้วย ResizeObserver: ขนาดเปลี่ยน = viewer.resize() แล้ว scene.requestRender() รวมเป็นครั้งเดียวต่อเฟรม เลิกฟังเมื่อทำลาย
// ไม่พึ่ง onDidDimensionsChange ของ Dockview อย่างเดียว (มันยิงก่อน CSS layout นิ่งได้)

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { watchResize, type ResizeEnv } from "../../src/cesium/resizeWatch";

/** ResizeObserver และเฟรมปลอมที่ test สั่งเอง: change() = ขนาดของ element เปลี่ยน, frame() = browser วาดเฟรมถัดไป */
function fakeEnv() {
  const observers: { callback: ResizeObserverCallback; targets: Element[]; disconnected: boolean }[] = [];
  let frames = new Map<number, FrameRequestCallback>();
  let nextId = 1;
  class FakeObserver {
    private readonly entry: (typeof observers)[number];
    constructor(callback: ResizeObserverCallback) {
      this.entry = { callback, targets: [], disconnected: false };
      observers.push(this.entry);
    }
    observe(target: Element): void {
      this.entry.targets.push(target);
    }
    unobserve(): void {}
    disconnect(): void {
      this.entry.disconnected = true;
    }
  }
  const env: ResizeEnv = {
    ResizeObserver: FakeObserver as unknown as typeof ResizeObserver,
    requestFrame: (cb) => {
      const id = nextId++;
      frames.set(id, cb);
      return id;
    },
    cancelFrame: (id) => void frames.delete(id),
  };
  return {
    env,
    observers,
    pendingFrames: () => frames.size,
    change(target: Element): void {
      for (const o of observers) if (!o.disconnected && o.targets.includes(target)) o.callback([{ target } as ResizeObserverEntry], o as never);
    },
    frame(): void {
      const due = frames;
      frames = new Map();
      for (const cb of due.values()) cb(0);
    },
  };
}

/** viewer ปลอมที่จดลำดับการเรียก */
function fakeViewer() {
  const calls: string[] = [];
  return { calls, viewer: { resize: () => void calls.push("resize"), scene: { requestRender: () => void calls.push("requestRender") } } };
}

describe("watchResize", () => {
  test("observes the element it is given", () => {
    const f = fakeEnv();
    const el = document.createElement("div");
    watchResize(el, fakeViewer().viewer, undefined, f.env);
    expect(f.observers).toHaveLength(1);
    expect(f.observers[0].targets).toEqual([el]);
  });

  test("a size change resizes the viewer and then asks for a render, in the next frame", () => {
    const f = fakeEnv();
    const el = document.createElement("div");
    const { viewer, calls } = fakeViewer();
    watchResize(el, viewer, undefined, f.env);
    f.change(el);
    expect(calls).toEqual([]); // ยังไม่ถึงเฟรม
    f.frame();
    expect(calls).toEqual(["resize", "requestRender"]);
  });

  test("two changes in one frame make one resize and one render", () => {
    const f = fakeEnv();
    const el = document.createElement("div");
    const { viewer, calls } = fakeViewer();
    watchResize(el, viewer, undefined, f.env);
    f.change(el);
    f.change(el);
    expect(f.pendingFrames()).toBe(1);
    f.frame();
    expect(calls).toEqual(["resize", "requestRender"]);
    // เฟรมถัดไปที่ขนาดเปลี่ยนอีก = อีกหนึ่งรอบ
    f.change(el);
    f.frame();
    expect(calls).toEqual(["resize", "requestRender", "resize", "requestRender"]);
  });

  test("afterResize runs between the resize and the render (Sensor View sets its fov for the new aspect)", () => {
    const f = fakeEnv();
    const el = document.createElement("div");
    const { viewer, calls } = fakeViewer();
    watchResize(el, viewer, () => calls.push("after"), f.env);
    f.change(el);
    f.frame();
    expect(calls).toEqual(["resize", "after", "requestRender"]);
  });

  test("stopping disconnects the observer and drops a frame that is still pending", () => {
    const f = fakeEnv();
    const el = document.createElement("div");
    const { viewer, calls } = fakeViewer();
    const stop = watchResize(el, viewer, undefined, f.env);
    f.change(el);
    stop();
    expect(f.observers[0].disconnected).toBe(true);
    expect(f.pendingFrames()).toBe(0);
    f.frame();
    f.change(el);
    f.frame();
    expect(calls).toEqual([]);
  });

  test("a browser without ResizeObserver: nothing is watched and stopping is harmless", () => {
    const { viewer, calls } = fakeViewer();
    const stop = watchResize(document.createElement("div"), viewer, undefined, { ...fakeEnv().env, ResizeObserver: undefined });
    expect(() => stop()).not.toThrow();
    expect(calls).toEqual([]);
  });
});

describe("every Cesium viewer uses it (scene3d.ts and scene2d.ts need real WebGL, so their sources are checked)", () => {
  const source = (file: string) => readFileSync(resolve(__dirname, "../..", file), "utf8");

  test("the 2D window's scene watches its element and stops on destroy", () => {
    const s = source("src/windows/Graphics2D/scene2d.ts");
    expect(s).toMatch(/this\.offs\.push\(watchResize\(el, viewer\)\)/);
  });

  test("the 3D window's scene, which is also the Sensor View's scene, watches its element and fixes the Sensor View fov after a resize", () => {
    const s = source("src/windows/Graphics3D/scene3d.ts");
    expect(s).toMatch(/this\.offs\.push\(watchResize\(el, viewer, \(\) => this\.updateSensorCamera\(\)\)\)/);
    // mountScene3D และ mountSensorView สร้าง Scene3D ผ่าน mount() ตัวเดียวกัน
    expect(s).toMatch(/export function mountScene3D\([^)]*\)[^{]*\{\s*return mount\(/);
    expect(s).toMatch(/export function mountSensorView\([^)]*\)[^{]*\{\s*return mount\(/);
    expect(s.match(/new Scene3D\(/g)).toHaveLength(1);
  });
});
