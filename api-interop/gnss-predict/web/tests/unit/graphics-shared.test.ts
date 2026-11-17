// ชิ้นส่วนร่วมของหน้าต่าง 3D/2D ที่ไม่ต้องวาด Cesium: ตัวจำกัดความถี่ของการวาดใหม่ (Throttle), ทะเบียนหน้าต่างแบบทั่วไป (createSceneRegistry)
// และตัวตามเมาส์บนแผนที่ 2D (CursorTracker: พิกัดใต้เมาส์ → useSelection.cursorLatLon ไม่เกินหนึ่งครั้งต่อเฟรม)

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useLayout } from "../../src/stores/layout";
import { CursorTracker } from "../../src/windows/Graphics2D/cursor";
import { createSceneRegistry } from "../../src/windows/graphics/sceneRegistry";
import { Throttle } from "../../src/windows/graphics/throttle";
import { resetAll } from "./helpers/chrome";

describe("Throttle", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("the first request runs at once; requests within the interval collapse into one trailing run at its end", () => {
    const run = vi.fn();
    const th = new Throttle(100, run, () => Date.now());
    th.request();
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30);
    th.request();
    th.request();
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(69);
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(500);
    expect(run).toHaveBeenCalledTimes(2);
  });

  test("flush runs now and cancels the pending run; dispose cancels for good", () => {
    const run = vi.fn();
    const th = new Throttle(100, run, () => Date.now());
    th.request();
    th.request();
    th.flush();
    expect(run).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(200);
    expect(run).toHaveBeenCalledTimes(2);
    th.request();
    th.request();
    th.dispose();
    vi.advanceTimersByTime(200);
    th.request();
    expect(run).toHaveBeenCalledTimes(3);
  });
});

describe("createSceneRegistry", () => {
  beforeEach(() => resetAll());

  test("active = the active dockview panel if it is one of these windows, else the last one touched, else the first opened", () => {
    const reg = createSceneRegistry<{ panelId: string }>();
    const a = { panelId: "graphics2d" };
    const b = { panelId: "graphics2d-2" };
    const offA = reg.register(a);
    reg.register(b);
    expect(reg.active()).toBe(a);
    reg.markActive("graphics2d-2");
    expect(reg.active()).toBe(b);
    useLayout.setState({ api: { activePanel: { id: "graphics2d" } } as never });
    expect(reg.active()).toBe(a);
    useLayout.setState({ api: { activePanel: { id: "objectBrowser" } } as never });
    expect(reg.active()).toBe(b);
    offA();
    expect(reg.get("graphics2d")).toBeUndefined();
    expect(reg.first("graphics2d")).toBe(b);
  });

  test("listeners hear registrations and notify(); a stale unregister leaves a newer handle alone", () => {
    const reg = createSceneRegistry<{ panelId: string }>();
    const heard = vi.fn();
    reg.subscribe(heard);
    const v0 = reg.version();
    const off = reg.register({ panelId: "x" });
    const newer = { panelId: "x" };
    reg.register(newer);
    off();
    expect(reg.get("x")).toBe(newer);
    reg.notify();
    expect(heard).toHaveBeenCalledTimes(3);
    expect(reg.version()).toBe(v0 + 3);
    reg.reset();
    expect(reg.active()).toBeUndefined();
  });
});

describe("CursorTracker", () => {
  let frames: (() => void)[];
  const raf = (cb: () => void): number => frames.push(cb);
  const caf = (id: number): void => {
    frames[id - 1] = () => undefined;
  };
  const flushFrames = (): void => {
    const now = frames;
    frames = [];
    for (const f of now) f();
  };
  beforeEach(() => {
    frames = [];
  });

  test("many moves in one frame pick once, at the last position", () => {
    const pick = vi.fn((x: number, y: number): [number, number] | null => [y, x]);
    const set = vi.fn();
    const c = new CursorTracker(pick, set, raf, caf);
    c.move(1, 2);
    c.move(3, 4);
    expect(frames).toHaveLength(1);
    flushFrames();
    expect(pick).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenLastCalledWith([4, 3]);
  });

  test("off the map is null; leaving clears and cancels the pending pick", () => {
    const set = vi.fn();
    const c = new CursorTracker(() => null, set, raf, caf);
    c.move(1, 1);
    flushFrames();
    expect(set).toHaveBeenLastCalledWith(null);
    const c2 = new CursorTracker((x, y) => [x, y], set, raf, caf);
    c2.move(5, 5);
    c2.leave();
    flushFrames();
    expect(set).toHaveBeenLastCalledWith(null);
  });

  test("dispose clears a position this tracker set, and later moves do nothing", () => {
    const set = vi.fn();
    const c = new CursorTracker((x, y) => [x, y], set, raf, caf);
    c.move(5, 6);
    flushFrames();
    c.dispose();
    expect(set).toHaveBeenLastCalledWith(null);
    set.mockClear();
    c.move(1, 1);
    flushFrames();
    expect(set).not.toHaveBeenCalled();
  });
});
